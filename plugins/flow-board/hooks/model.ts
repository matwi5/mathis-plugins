// Moteur du tableau de bord : des transitions pures. Chacune prend le Board courant
// (gelé par l'hôte), le clone, applique un signal et rend le nouveau Board avec les
// effets d'interface à jouer (toasts, ouverture du panneau, note pour Claude), ou null
// quand le signal ne change rien.

import type {
  Artifact,
  ArtifactKind,
  Board,
  ClosedLink,
  Closing,
  Detour,
  ExternalBlocker,
  FlowItem,
  FlowPhase,
  FlowStep,
  FoundTask,
  GroupLink,
  ItemStatus,
  Relay,
  Run,
  RunAuto,
  SecurityCheck,
  SoloDecision,
  SyncState,
  Ticket,
  TicketGroup,
  TicketStatus,
  Tombstone,
  UiState,
  VersionCommit,
  VersionUnit,
  GestureKind,
  WaitTarget,
  WaitingQuestion,
  AutoMark,
  ForcedHold,
  WaitsUser,
  RunLaunch,
} from '../types'
import { CODE_SKILLS, SECURITY_OFF_REPLY, SENSITIVE_AREAS, SKILLS, agree, skillIdOf, type PhaseSpec, type SkillDef } from './catalog.ts'
import { GROUP_ID_FORM, asciiJson, closingScript, isScriptPath, neutralInPrompt, neutralLine, neutralRelayed, closedHint, closingProcedure, isGroupId, isKeptForReport, isQuestionIdForm, isSafeId, sendNumber } from './closing.ts'
import { maxOf, minOf } from './timeline.ts'
import { isSeatAhead, mergeSeat, seatState, soundSeat } from './seat.ts'
import { soundRunLaunch } from './launch.ts'
import type { SecurityReview } from './security-setting.ts'
import type { PlanUnit, PlanWait } from './plan-projet.ts'
import { activeRun, isReportValidated, addedCount, asanaChange, asList, AUTO_CHOICES_MAX, formText, choiceRoom, clip, clone, countTickets, currentPhase, type Effects, hasBeenAuto, hasGroupReview, hasUnreadableCounts, isAdvisedUnrun, isAllDone, isoMinute, isSecurityCount, isSecuritySettled, isSecuritySettledFor, isTime, keepChoices, LIMITS, log, noFx, ORIGIN_LABELS, originOf, type Outcome, parseChanges, recordedGroup, reviewTimeOf, sameTicket, sentGroupOf, setStep, shownGroupId, shownGroupName, type StatusChange, statusLine, str, TEXT_MAX, TICKET_STATUSES, unreadableCounts, BUGS_REFUSED, bugsText, isBugCount, BUGS_MAX } from './basics.ts'
import { type GroupRelay, ignoredOrigins, inForce, isRelay, parseMainRef, isSameRelayedChoice, keepDecisions, refusedRelayText, relayForGroup, relayedDecisions, REPORT_MAX, relayedReportsText, relayedSentence, reportedDecisions, reportedWithdrawals, sameChoice } from './relay.ts'
import { CLOSE_STATES, closingOf, closingWhy, confidedIds, earlierOf, groupSendSeq, hasLaunchedLinked, holdsItemsSession, inFlightWhy, isClosedLink, isHoldingGroup, isItemsCloseCandidate, isKeptGroup, isResentInFlight, isRetried, isRetriedSince, isSentGroup, keepClosings, linkedInFlight, previousSecurityText, returnGroups, returnedLink, sendGroups, touchedLink, withCloseAsked, withClosing, withEarlierClosing, withItems, withoutLink, keptGroupFields } from './link.ts'

export const emptyBoard = (root: string, name: string): Board => ({ v: 1, root, name, runs: [], activeId: null })

/** Cette discussion tient le siège du COO du projet (`hooks/seat.ts`) : aucune mission ne s'y ouvre ni ne s'y reprend. */
export const isCooDiscussion = (board: Board, now: number): boolean => board.cooHere !== undefined && seatState(board.coo, board.cooHere, now) === 'mine'

/** La réponse à une mission demandée dans la discussion du COO. */
export const COO_NO_MISSION =
  'This discussion holds the COO seat: no mission opens or resumes here (the COO coordinates missions, it never carries one). Nothing was recorded. Launch the mission in another discussion; the COO will offer a launch card for it.'

export const isBoard = (value: unknown): value is Board =>
  typeof value === 'object' &&
  value !== null &&
  (value as Board).v === 1 &&
  typeof (value as Board).root === 'string' &&
  Array.isArray((value as Board).runs)

// ─── Lecture ──────────────────────────────────────────────────────────────

export const activeDetour = (phase: FlowPhase): Detour | null => phase.detours.find(d => d.status === 'active') ?? null

/** Ce sur quoi Claude travaille : le détour actif, sinon la phase. */
export const focusOf = (run: Run): { phase: FlowPhase; detour: Detour | null; skill: SkillDef } => {
  const phase = currentPhase(run)
  const detour = activeDetour(phase)
  return { phase, detour, skill: SKILLS[detour?.skill ?? phase.skill]! }
}

export const stepRatio = (steps: readonly FlowStep[]): number =>
  steps.length === 0
    ? 0
    : (steps.filter(s => s.status === 'done' || s.status === 'skipped').length + (steps.some(s => s.status === 'active') ? 0.5 : 0)) / steps.length

/** Avancement de la mission, de 0 à 1 : phases faites, plus la part d'étapes de la phase en cours. */
export const runProgress = (run: Run): number => {
  if (run.status === 'done') return 1
  if (run.phases.length === 1) {
    const only = run.phases[0]!
    return only.status === 'done' ? 1 : stepRatio(only.steps)
  }
  const counted = run.phases.filter(p => p.status !== 'skipped' && !(isPhaseOptional(run, p) && p.status === 'pending'))
  if (counted.length === 0) return 0
  const sum = counted.reduce(
    (n, p) => n + (p.status === 'done' ? 1 : p.status === 'active' ? Math.min(0.9, stepRatio(p.steps)) : 0),
    0,
  )
  return sum / counted.length
}

export const isRunComplete = (run: Run): boolean =>
  run.phases.every(p => p.status === 'done' || p.status === 'skipped' || (isPhaseOptional(run, p) && p.status === 'pending'))

/** Une phase facultative : notée telle, et pas une Implémentation qu'un lot pas fini rend due (`hasOpenLot`). */
export const isPhaseOptional = (run: Run, p: FlowPhase): boolean => p.isOptional && !(p.skill === 'implement' && hasOpenLot(run))

/**
 * Un lot dont un ticket n'est pas fait : l'Implémentation qui suit n'est plus facultative (Rétro, Triage,
 * « Santé du code »), qu'il soit arrivé avant la fin de la phase ou après. Sinon, toutes les phases
 * suivantes facultatives, la mission passait « terminé » à la fin de la discussion, avant le premier groupe.
 */
const hasOpenLot = (run: Run): boolean => run.tickets.some(t => t.status !== 'done')

/** Ce que la définition de la mission (celle de son skill d'entrée) dit d'une phase : facultative ou non. */
const isDefinedOptional = (run: Run, p: FlowPhase): boolean => (SKILLS[run.entry]?.flow ?? []).find(s => s.skill === p.skill)?.isOptional === true

/** Une mission ouverte par /retro, à côté de la mission qu'elle étudie : ses pistes choisies deviennent son lot. */
export const isRetroRun = (run: Run): boolean => run.entry === 'retro'

export type Suggestions = {
  /** La suite logique : la prochaine phase de la mission, sinon la première suite du skill. */
  primary: string | null
  others: string[]
  /** Toutes les phases requises sont faites (ou on en est à « Version et push ») : la mission peut se clore. */
  canFinish: boolean
  /** À la livraison, ce que la mesure des versions dit de /project:version (déjà posée, ou à poser). */
  versionNote?: string
  /** À la livraison, sous les boutons Version et Push : « ancienne → nouvelle » par partie versionnée (`versionPreview`). */
  versionPreview?: string[]
}

/**
 * Ce que la carte « Ensuite » sait du dépôt : GitHub (pour la PR), versions déjà posées face au
 * distant (null : le projet n'a pas de fichier de version ; absent : pas encore mesuré), parties
 * versionnées changées (pour l'aperçu). `security` : le réglage « revue de sécurité » du projet, relu juste avant la décision (le module ne lit
 * jamais le moteur) ; absent, `on` ou `unread` (une lecture ratée) : la revue reste due, seul `off` la désactive.
 */
export type SuggestOpts = { hasPullRequests?: boolean; isVersionSet?: boolean | null; versionUnits?: readonly VersionUnit[] | null; security?: SecurityReview }

/**
 * Sans GitHub (distant ailleurs, ou aucun), la PR par /project:pr n'a pas de sens : la mission
 * montrée à l'écran perd sa phase « Pull request » à venir. La mission stockée, elle, la garde.
 */
export const withoutPullRequest = (run: Run): Run => {
  const phases = run.phases.filter((p, i) => !(i > run.cursor && p.status === 'pending' && p.skill === 'project:pr'))
  return phases.length === run.phases.length ? run : { ...run, phases }
}

export const suggestionsFor = (run: Run, opts: SuggestOpts = {}): Suggestions => {
  const phase = currentPhase(run)
  const next = run.phases.slice(run.cursor + 1).find(p => p.status === 'pending')
  const list: string[] = []
  const add = (skill: string) => {
    if (skill in SKILLS && !list.includes(skill)) list.push(skill)
  }
  // Des éléments chez un worker pas encore fermé : quitter la phase rangerait sa note de fin
  // dans une autre, et la session ne serait plus attendue ni fermée. Aucune suite avant sa fermeture.
  if (holdsItemsSession(phase)) return { primary: null, others: [], canFinish: false }
  if (next) {
    add(next.skill)
    next.alts.forEach(add)
  }
  ;(SKILLS[phase.skill]?.next ?? []).forEach(add)
  // Livrer (ou en rendre compte) avant d'avoir fini les tickets n'a pas de sens : tout attend le dernier.
  const t = countTickets(run.tickets)
  // Un groupe encore confié à un worker n'est pas fini ici, même ses tickets relayés faits (affichage).
  const isUnfinished = (t.total > t.done || (run.groups ?? []).some(g => g.linked !== undefined)) && SKILLS[phase.skill]?.hasTickets === true
  // Un groupe fini attend sa revue (/code-review) ; la livraison attend qu'elles soient toutes faites.
  const isReviewDue = SKILLS[phase.skill]?.hasTickets === true && needsReview(run)
  // Un compte rendu ouvert attend la validation de la personne : pas de livraison avant.
  const isReportOpen = phase.skill === 'compte-rendu' && phase.status !== 'done'
  // Avec des groupes, la revue se lance depuis la ligne du groupe (/code-review ici, ou son
  // worker pour un groupe qu'il a fait) : la suite proposée reste le lancement des groupes.
  const isReviewHere = isReviewDue && (run.groups ?? []).length === 0
  // Sans groupes, le lot relu attend encore sa sécurité tranchée, comme un groupe pas clos : le compte
  // rendu ne se propose pas avant (la ligne de sécurité du lot porte la suite).
  const isLotSecurityHeld = SKILLS[phase.skill]?.hasTickets === true && isLotSecurityDue(run, opts.security)
  const kept = [
    ...(isReviewHere ? ['final-review'] : []),
    ...(isUnfinished || isReviewDue || isLotSecurityHeld ? list.filter(skill => !AFTER_TICKETS.has(skill)) : list)
      .filter(skill => skill !== 'final-review')
      .filter(skill => !(isReportOpen && DELIVERY.has(skill)))
      // Livrée (phases de livraison faites, push compris), même reprise ensuite : ce qui est parti ne se relivre
      // pas (invariant des missions livrées) ; un travail que la personne relance les rouvre.
      .filter(skill => !(isShipped(run) && DELIVERY.has(skill))),
  ]
  // Version faite, push pas encore : la suite est /project:push, avant la pull request, et
  // /project:version reste à côté.
  let isDelivery = false
  if (phase.skill === 'project:version' && phase.status !== 'done' && !isPushed(phase)) {
    // La pull request attend le push : elle n'est même pas proposée en second.
    const rest = kept.filter(skill => skill !== 'project:push' && skill !== 'project:version' && skill !== 'project:pr' && skill !== 'pr')
    kept.splice(0, kept.length, 'project:push', 'project:version', ...rest)
    isDelivery = true
  }
  // Version et push toujours côte à côte, au choix (Mathis, V1 de la rétro de la mission xhigh) :
  // Version en tête tant qu'une partie changée n'a pas sa nouvelle version ; Push en tête quand la
  // version est déjà posée (chaque plugin ou paquet changé en a une nouvelle face au distant) ou que
  // le projet n'a pas de fichier de version. Pas encore mesuré : Version en tête, comme avant.
  let versionNote: string | undefined
  if (kept[0] === 'project:version' && phase.skill !== 'project:version') {
    const rest = kept.slice(1).filter(skill => skill !== 'project:push' && skill !== 'project:version')
    isDelivery = true
    if (opts.isVersionSet === true) {
      kept.splice(0, kept.length, 'project:push', 'project:version', ...rest)
      versionNote = 'version déjà posée : chaque plugin changé a une nouvelle version face au distant'
    } else if (opts.isVersionSet === null) {
      kept.splice(0, kept.length, 'project:push', 'project:version', ...rest)
      versionNote = 'pas de fichier de version dans le projet : /project:push, ou /project:version pour en poser une'
    } else {
      kept.splice(0, kept.length, 'project:version', 'project:push', ...rest)
      if (opts.isVersionSet === false) versionNote = 'un plugin changé n’a pas encore de nouvelle version : /project:version, ou /project:push sans version'
    }
  }
  const preview = isDelivery ? versionPreview(opts.versionUnits ?? []) : []
  // La rétro n'est plus une étape de la mission, mais reste à portée de main.
  if (opts.hasPullRequests === false) kept.splice(0, kept.length, ...kept.filter(skill => skill !== 'project:pr'))
  const others = kept.slice(1, 4).filter(skill => skill !== 'retro')
  // Une fois le rapport validé, plus de « Rétro » nue (le seul /retro, sans brief) : la rétro vient de la livraison,
  // chez le COO, avec son brief entier.
  if (phase.skill !== 'retro' && kept[0] !== 'retro' && !isReportValidated(run)) others.push('retro')
  // Pendant « Version et push », la clôture se propose à côté du push et de la pull request.
  const canFinish =
    (phase.status === 'done' || phase.skill === 'project:version') &&
    !run.phases.slice(run.cursor + 1).some(p => p.status === 'pending' && !isPhaseOptional(run, p))
  // Avec des groupes, une revue qui manque n'a pas de skill pour suite : elle se lance sur la ligne du groupe.
  const primary = (isReviewDue && !isUnfinished && (run.groups ?? []).length > 0) || isLotSecurityHeld ? null : (kept[0] ?? null)
  return { primary, others, canFinish, ...(versionNote ? { versionNote } : {}), ...(preview.length > 0 ? { versionPreview: preview } : {}) }
}

/**
 * La suite recommandée pendant l'Implémentation d'une mission à groupes, à la place des skills :
 * - `parallel` : le lot de groupes à lancer ensemble (workers) ;
 * - `group` : le prochain groupe, le groupe commencé ici d'abord, sinon le premier prêt sans
 *   fichier ni ressource en commun avec un groupe en cours ;
 * - `busy` : un ticket est en cours ici, rien d'autre ne part ;
 * - `linked` : il ne reste qu'à attendre les groupes confiés à des workers ;
 * - `review` : tout est fait, il manque la revue de ces groupes (bouton sur leur ligne).
 * Null hors d'une phase à tickets, sans groupes, ou quand la suite est un skill (compte rendu).
 */
export type NextLaunch =
  | { kind: 'parallel'; groups: string[] }
  | { kind: 'group'; group: string; isDelegable: boolean }
  | { kind: 'busy' | 'linked' | 'review'; groups: string[] }
  | { kind: 'held'; groups: string[]; holds: OutsideHold[] }

export const nextLaunchFor = (run: Run, outside?: ReadonlyMap<string, readonly OutsideHold[]>): NextLaunch | null => {
  const phase = currentPhase(run)
  if (SKILLS[phase.skill]?.hasTickets !== true) return null
  const plan = groupPlan(run, outside)
  if (!plan) return null
  if (plan.parallelBatch.length >= 2) return { kind: 'parallel', groups: plan.parallelBatch }
  const declared = plan.groups.filter(g => !g.isFallback && g.state !== 'done')
  const doing = declared.filter(g => !g.isDelegated && g.open.some(t => t.status === 'doing'))
  if (doing.length > 0) return { kind: 'busy', groups: doing.map(g => g.group.id) }
  const started = declared.find(g => plan.busy.includes(g.group.id) && g.state === 'ready')
  if (started) return { kind: 'group', group: started.group.id, isDelegable: isDelegable(started) }
  const held = new Set([...plan.delegated, ...plan.busy])
  const ready = declared
    .filter(g => g.state === 'ready' && !g.isDelegated && !g.isCyclic && !g.conflicts.some(c => held.has(c.with)))
    .sort((a, b) => a.wave - b.wave)[0]
  if (ready) return { kind: 'group', group: ready.group.id, isDelegable: isDelegable(ready) }
  if (plan.delegated.length > 0) return { kind: 'linked', groups: plan.delegated }
  // Retenus par une autre mission : rien ne part, la suite attend que le groupe attendu soit clos (ou un forçage).
  const retained = declared.filter(g => g.waitsElsewhere.length > 0)
  if (retained.length > 0) return { kind: 'held', groups: retained.map(g => g.group.id), holds: retained.flatMap(g => g.waitsElsewhere) }
  const unreviewed = (run.groups ?? []).filter(g => g.linked === undefined && awaitsReview(run, g))
  if (unreviewed.length > 0 && run.tickets.every(t => t.status === 'done')) return { kind: 'review', groups: unreviewed.map(g => g.id) }
  return null
}

/**
 * Le skill dont la commande se propose, grisée dans le prompt vide, à la fin d'un tour : celui du
 * bouton principal de la carte « Ensuite ». Null quand la suite n'est pas une commande (lancer un
 * groupe, attendre un worker, revue sur la ligne d'un groupe) ou qu'il n'y a pas de suite.
 */
export const nextCommandSkill = (run: Run, opts: SuggestOpts = {}, outside?: ReadonlyMap<string, readonly OutsideHold[]>): string | null => {
  if (nextLaunchFor(run, outside) !== null) return null
  const primary = suggestionsFor(run, opts).primary
  // Le lot sans groupes retenu par une autre mission : sa phase de code ne se propose pas.
  return primary !== null && CODE_SKILLS.has(primary) && outside?.has(LOT_KEY) === true ? null : primary
}

/** Les manifestes qui portent la version d'un plugin ou d'un paquet. */
export const VERSION_MANIFESTS = ['.claude-plugin/plugin.json', 'package.json', 'pyproject.toml', 'Cargo.toml']

/** Le dossier que versionne un manifeste : celui du plugin pour `.claude-plugin/plugin.json`. */
const unitOf = (manifest: string): string => {
  const dir = manifest.endsWith('.claude-plugin/plugin.json') ? manifest.slice(0, -'.claude-plugin/plugin.json'.length) : manifest.replace(/[^/]*$/, '')
  return dir.replace(/\/+$/, '')
}

/**
 * Les versions sont-elles déjà posées face au distant ? Chaque fichier changé (`changed`) relève du
 * manifeste le plus proche au-dessus de lui (`manifests`, chemins depuis la racine du dépôt) ; vrai
 * quand chacun de ces manifestes a changé sa ligne de version (`bumped`). Null sans manifeste
 * (rien à mesurer) ; un dépôt dont aucun dossier versionné n'a changé n'a rien à poser : vrai.
 */
export const versionSet = (changed: readonly string[], manifests: readonly string[], bumped: readonly string[]): boolean | null => {
  if (manifests.length === 0) return null
  return touchedManifests(changed, manifests).every(m => bumped.includes(m))
}

/** Les manifestes dont le dossier versionné a un fichier changé, dans l'ordre de `manifests`. */
export const touchedManifests = (changed: readonly string[], manifests: readonly string[]): string[] => {
  const units = manifests.map(m => ({ manifest: m, dir: unitOf(m) })).sort((a, b) => b.dir.length - a.dir.length)
  const touched = new Set<string>()
  for (const path of changed) {
    const unit = units.find(u => u.dir === '' || path === u.dir || path.startsWith(`${u.dir}/`))
    // Un fichier hors de tout dossier versionné (la marketplace, la doc de la racine) ne demande rien.
    if (unit) touched.add(unit.manifest)
  }
  return manifests.filter(m => touched.has(m))
}

/** La montée proposée d'une partie versionnée, d'après ses commits : la nouvelle version, sa sorte, et ce qui la justifie. */
export type Bump = { next: string; kind: 'majeure' | 'mineure' | 'correctif' | 'pré-version'; breaking: number; feat: number; fix: number; total: number }

/** Un commit cassant : `!` avant les deux-points du titre (`feat!:`, `fix(api)!:`), ou `BREAKING CHANGE` dans le corps. */
const isBreakingCommit = (c: VersionCommit): boolean => c.isBreaking || /^\w+(\([^)]*\))?!:/.test(c.subject)

/**
 * La version que /project:version proposerait, selon ses règles : un commit cassant donne une
 * version majeure (sous la 1.0.0, une mineure : la majeure reste 0), un `feat` une mineure, `fix` et
 * le reste un correctif ; une pré-version qui finit par un nombre (`1.3.1-mathis.2`) avance ce
 * nombre. Null sans commit, ou pour une version hors de ces formes. Un aperçu seulement :
 * /project:version garde la décision.
 */
export const proposeBump = (version: string, commits: readonly VersionCommit[]): Bump | null => {
  if (commits.length === 0) return null
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.*?)(\d+))?$/.exec(version)
  if (!m) return null
  const breaking = commits.filter(isBreakingCommit).length
  const feat = commits.filter(c => !isBreakingCommit(c) && /^feat(\(|:)/.test(c.subject)).length
  const fix = commits.filter(c => !isBreakingCommit(c) && /^fix(\(|:)/.test(c.subject)).length
  const counts = { breaking, feat, fix, total: commits.length }
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (m[5] !== undefined) return { next: `${major}.${minor}.${patch}-${m[4]}${Number(m[5]) + 1}`, kind: 'pré-version', ...counts }
  if (breaking > 0 && major > 0) return { next: `${major + 1}.0.0`, kind: 'majeure', ...counts }
  if (breaking > 0 || feat > 0) return { next: `${major}.${minor + 1}.0`, kind: 'mineure', ...counts }
  return { next: `${major}.${minor}.${patch + 1}`, kind: 'correctif', ...counts }
}

/** Les lignes de l'aperçu au plus ; au-delà, « + N autres ». */
export const VERSION_PREVIEW_LINES = 3

/**
 * L'aperçu de la version sous les boutons Version et Push (Mathis, V2 et V3) : une ligne par
 * partie versionnée changée, « flow-board 0.67.0 → 0.68.0 · mineure : 3 feat, 2 fix », ou « déjà
 * posée : 0.65.1 → 0.67.0 » quand sa version a déjà changé ; trois lignes au plus, puis « + N autres ».
 */
export const versionPreview = (units: readonly VersionUnit[]): string[] => {
  const lines: string[] = []
  for (const u of units) {
    if (u.from !== undefined) {
      lines.push(`${u.name} déjà posée : ${u.from} → ${u.version}`)
      continue
    }
    const commits = u.commits ?? []
    if (commits.length === 0) continue
    const bump = proposeBump(u.version, commits)
    const why = bump
      ? [bump.breaking > 0 ? counted(bump.breaking, 'cassant', 'cassants') : '', bump.feat > 0 ? `${bump.feat} feat` : '', bump.fix > 0 ? `${bump.fix} fix` : ''].filter(Boolean).join(', ')
      : ''
    const said = why || counted(commits.length, 'commit', 'commits')
    lines.push(bump ? `${u.name} ${u.version} → ${bump.next} · ${bump.kind} : ${said}` : `${u.name} ${u.version} · ${said}`)
  }
  if (lines.length <= VERSION_PREVIEW_LINES) return lines
  const more = lines.length - VERSION_PREVIEW_LINES
  return [...lines.slice(0, VERSION_PREVIEW_LINES), `+ ${more} ${more > 1 ? 'autres' : 'autre'}`]
}

const counted = (count: number, one: string, many: string): string => `${count} ${count > 1 ? many : one}`

/** Les mots d'un changement de statut de ticket, au singulier et au pluriel. */
const SET_WORDS: Record<string, [string, string]> = {
  done: ['ticket fait', 'tickets faits'],
  doing: ['ticket en cours', 'tickets en cours'],
  blocked: ['ticket bloqué', 'tickets bloqués'],
  todo: ['ticket à faire', 'tickets à faire'],
}

/**
 * Ce qu'un appel de l'outil `flow` enregistre, en mots courts, pour sa ligne compacte dans la
 * conversation : « flow-board · étape review · 2 tickets faits ». Lu sur l'entrée de l'appel.
 */
export const flowCallLabel = (input: unknown): string => {
  const at = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const list = (key: string): unknown[] => (Array.isArray(at[key]) ? (at[key] as unknown[]) : [])
  const parts: string[] = []
  const open = at.open as { title?: unknown } | undefined
  if (open && typeof open === 'object') parts.push(str(open.title) ? `mission ouverte « ${clip(str(open.title), 40)} »` : 'mission ouverte')
  if (str(at.resume)) parts.push('reprise de la mission')
  if (str(at.delegate)) parts.push(str(at.group) ? `worker · groupe ${clip(str(at.group), 12)}` : 'worker')
  if (at.fix && typeof at.fix === 'object') parts.push('correction')
  if (str(at.title) && parts.length === 0 && Object.keys(at).length === 1) parts.push('titre')
  if (str(at.step)) parts.push(`étape ${clip(str(at.step), 30)}`)
  if (list('tickets').length > 0) parts.push(counted(list('tickets').length, 'ticket', 'tickets'))
  const byStatus = new Map<string, number>()
  for (const change of list('set')) {
    const status = str((change as { status?: unknown } | null)?.status)
    if (status in SET_WORDS) byStatus.set(status, (byStatus.get(status) ?? 0) + 1)
  }
  for (const [status, words] of Object.entries(SET_WORDS)) {
    const count = byStatus.get(status)
    if (count) parts.push(counted(count, words[0], words[1]))
  }
  if (list('remove').length > 0) parts.push(counted(list('remove').length, 'ticket retiré', 'tickets retirés'))
  if (list('groups').length > 0) parts.push(counted(list('groups').length, 'groupe', 'groupes'))
  if (list('items').length > 0) parts.push(counted(list('items').length, 'élément', 'éléments'))
  if (list('externals').length > 0) parts.push(counted(list('externals').length, 'tâche externe', 'tâches externes'))
  if (at.review && typeof at.review === 'object') parts.push('revue')
  if (at.security && typeof at.security === 'object') parts.push('sécurité')
  if (list('decided').length > 0) parts.push(counted(list('decided').length, 'décision', 'décisions'))
  const asked = list('waiting').filter(q => (q as { answered?: unknown } | null)?.answered !== true).length
  const answered = list('waiting').length - asked
  if (asked > 0) parts.push(counted(asked, 'question en attente', 'questions en attente'))
  if (answered > 0) parts.push(counted(answered, 'question répondue', 'questions répondues'))
  if (list('reviewed').length > 0) parts.push(`relu ${list('reviewed').map(str).filter(Boolean).join(', ')}`)
  if (list('returned').length > 0) parts.push(`rendu ${list('returned').map(str).filter(Boolean).join(', ')}`)
  if (str(at.note)) parts.push('note')
  if (at.complete === true) parts.push('phase terminée')
  return clip(['flow-board', ...parts].join(' · '), 120)
}

/** Ce qui vient après les tickets : version, push, pull request, corps de PR. */
export const DELIVERY = new Set(['project:version', 'project:push', 'project:pr', 'pr'])

/** Ce qui attend que les tickets soient faits et relus : la livraison, et le compte rendu qui la précède. */
const AFTER_TICKETS = new Set([...DELIVERY, 'compte-rendu'])

/**
 * Remet une mission créée par une version antérieure à la forme actuelle, sans toucher à ce qui est
 * fait ou en cours : la rétro à venir disparaît des étapes, un « Corps de PR » à venir laisse la
 * place à « Version et push » puis « Pull request » (/project:pr), et une rétro qui n'avait que sa
 * phase reçoit la suite d'une rétro neuve (`extendRetro`).
 */
export const upgradeRun = (run: Run): Run => repairRun(upgradePhases(extendRetro(retireSkills(run))))

/**
 * Une rétro créée quand elle n'avait que sa phase reçoit la suite d'une rétro neuve (Implémentation,
 * Compte rendu, Version, PR), à faire, sans date : ses pistes choisies peuvent devenir des tickets
 * sans relancer /retro. Invariant : rien que des phases ajoutées après la rétro ; aucune phase, aucun
 * lien de pistes ni aucune piste n'est retiré ou réécrit. Seulement une rétro pas terminée dont la
 * Rétro est la dernière phase : relue deux fois, ou fusionnée de deux copies, elle donne la même mission.
 * Pas tant que sa session de pistes n'est pas fermée : une phase suivante permettrait de quitter la
 * Rétro avant la note de fin (un lancement, /implement, une discussion d'une version antérieure), qui
 * se rangerait ailleurs, et la session ne serait plus attendue ni fermée. La suite vient dès que la
 * fermeture est enregistrée ici (`extendActive`), sinon à la lecture suivante.
 */
const extendRetro = (run: Run): Run => {
  const last = run.phases.at(-1)
  if (!isRetroRun(run) || run.status === 'done' || last?.skill !== 'retro' || holdsItemsSession(last)) return run
  const rest = (SKILLS.retro?.flow ?? []).slice(1).map(spec => newPhase(spec))
  return rest.length === 0 ? run : { ...run, phases: [...run.phases, ...rest] }
}

/**
 * La mission active d'un board cloné reçoit tout de suite la suite d'une rétro dont la session de
 * pistes vient de se fermer (ou de s'annuler) : sans attendre la lecture suivante, un `complete` du
 * même appel aurait fini une mission à une seule phase. Les phases d'avant gardent leurs objets.
 */
const extendActive = (run: Run) => {
  const extended = extendRetro(run)
  if (extended !== run) run.phases = extended.phases
}

/**
 * Les skills retirés de la copie mattpocock-skills (1.3.1-mathis.1), et celui qui les remplace dans
 * une mission enregistrée avant : /implement-spec par /implement (mêmes tickets), /wayfinder par
 * /grill-with-docs (même suite ; ses éléments restent des décisions).
 */
const RETIRED = new Map([
  ['implement-spec', 'implement'],
  ['wayfinder', 'grill-with-docs'],
])

/**
 * Une phase d'un skill retiré prend son remplaçant, avec ses étapes : toutes faites si la phase
 * l'est, la première en cours si elle l'est.
 */
const retiredPhase = (p: FlowPhase): FlowPhase => {
  const skill = RETIRED.get(p.skill) ?? p.skill
  const alts = p.alts.filter(a => !RETIRED.has(a) && a !== skill)
  const detours = p.detours.filter(d => !RETIRED.has(d.skill))
  if (skill === p.skill && alts.length === p.alts.length && detours.length === p.detours.length) return p
  const fresh = stepsFor(skill, p.status === 'active' ? (p.startedAt ?? 0) : undefined)
  const steps = skill === p.skill ? p.steps : p.status === 'done' ? fresh.map(s => ({ ...s, status: 'done' as const })) : fresh
  return { ...p, skill, alts, detours, steps }
}

/** Une mission ouverte par un skill retiré, ou qui en a une phase : sans lui, le panneau ne la dessinerait pas. */
const retireSkills = (run: Run): Run => {
  const phases = run.phases.map(retiredPhase)
  const entry = RETIRED.get(run.entry) ?? run.entry
  if (entry === run.entry && phases.every((p, i) => p === run.phases[i])) return run
  return { ...run, entry, phases }
}

/** Les étapes de /project:push dans la phase « Version et push ». */
const PUSH_STEPS = new Set(['push', 'checks', 'docs', 'pushed'])

/** Le push de la phase « Version et push » a eu lieu (ou est en cours). */
const isPushed = (phase: FlowPhase): boolean =>
  phase.steps.some(s => s.id === 'pushed' && (s.status === 'done' || s.status === 'active'))

/**
 * Répare ce que des versions antérieures ont laissé de faux, sans rien changer d'autre :
 * - une Implémentation close à la fin d'un groupe alors que le lot a encore des tickets ouverts
 *   (avant la 0.18.3) redevient en cours, ses étapes prêtes pour le ticket suivant ;
 * - des compteurs de revue lus dans le texte des réponses (avant la 0.19.0), faux, sont effacés.
 */
const repairRun = (run: Run): Run => {
  const at = run.cursor
  const current = run.phases[at]
  const isClosedTooSoon =
    run.status !== 'done' &&
    current !== undefined &&
    current.skill === 'implement' &&
    current.status === 'done' &&
    run.tickets.some(t => t.status !== 'done')
  const hasGuessedReview = run.phases.some(p => p.stats.reviews === undefined && p.stats.standards >= 0)
  const isPushSkipped =
    run.status !== 'done' &&
    current !== undefined &&
    current.skill === 'project:version' &&
    current.status === 'done' &&
    current.steps.some(s => s.id === 'tag' && s.status === 'done') &&
    current.steps.filter(s => PUSH_STEPS.has(s.id)).every(s => s.status === 'skipped')
  const returnedAt = returnedWithoutTrace(run)
  if (!isClosedTooSoon && !hasGuessedReview && !isPushSkipped && returnedAt.size === 0) return run
  const groups = run.groups?.map(g => (returnedAt.has(g.id) ? { ...g, delegated: returnedLink(returnedAt.get(g.id)!) } : g))
  const phases = run.phases.map((p, i): FlowPhase => {
    let next = p
    if (i === at && isPushSkipped) {
      next = { ...next, status: 'active', finishedAt: undefined, steps: next.steps.map(s => (PUSH_STEPS.has(s.id) ? { id: s.id, status: 'pending' as const } : s)) }
    }
    if (i === at && isClosedTooSoon) {
      next = { ...next, status: 'active', finishedAt: undefined, steps: next.steps.map(s => ({ id: s.id, status: 'pending' as const })) }
    }
    if (next.stats.reviews === undefined && next.stats.standards >= 0) next = { ...next, stats: { ...next.stats, standards: -1, spec: -1 } }
    return next
  })
  return { ...run, phases, ...(groups ? { groups } : {}) }
}

// Le journal enregistré garde l'ancien libellé des envois et des retours : les deux se relisent.
const SENT = /^Groupes? (.+?) confiés? à (?:un worker|des workers|une session liée|des sessions liées)$/
const RETURNED = /^Groupes? (.+?) rendus? par (?:son worker|leurs workers|sa session liée|leurs sessions liées)$/
const idsIn = (text: string, pattern: RegExp): string[] => pattern.exec(text)?.[1]!.split(', ') ?? []

/**
 * Les groupes rendus par leur worker avant la 0.39.0, qui n'en gardaient pas la trace
 * (`delegated`) : le journal de la mission le dit (« ↩ Groupe A rendu par son worker »). Sans
 * elle, leur revue se proposait par /code-review ici, sur une branche déjà fusionnée. Par groupe
 * fini, pas relu et pas confié : quand il a été confié (« ↗ Groupe A confié… »), sinon rendu.
 */
const returnedWithoutTrace = (run: Run): Map<string, number> => {
  const found = new Map<string, number>()
  const candidates = (run.groups ?? []).filter(
    g => g.delegated === undefined && g.linked === undefined && awaitsReview(run, g),
  )
  if (candidates.length === 0) return found
  for (const entry of run.log) {
    for (const id of idsIn(entry.text, RETURNED)) {
      if (!candidates.some(g => g.id === id) || found.has(id)) continue
      const sent = run.log.filter(l => l.at <= entry.at && idsIn(l.text, SENT).includes(id)).map(l => l.at)
      found.set(id, sent.length > 0 ? maxOf(sent) : entry.at)
    }
  }
  return found
}

const upgradePhases = (run: Run): Run => {
  const later = run.phases.slice(run.cursor + 1)
  const hasDelivery = run.phases.some(p => p.skill === 'project:version' || p.skill === 'project:pr')
  // La « Revue finale » de la 0.13.0 n'est plus une phase : la revue se fait par groupe.
  const isDropped = (p: FlowPhase) => p.status === 'pending' && (p.skill === 'retro' || p.skill === 'final-review')
  // Le compte rendu (0.18.0) précède toute livraison encore à venir.
  const hasReport = run.phases.some(p => p.skill === 'compte-rendu')
  const isVersionAhead = (p: FlowPhase) => run.status !== 'done' && p.status === 'pending' && p.skill === 'project:version' && !hasReport
  const isOld = later.some(p => isDropped(p) || isVersionAhead(p) || (p.status === 'pending' && p.skill === 'pr' && !hasDelivery))
  if (!isOld) return run
  const phases: FlowPhase[] = run.phases.slice(0, run.cursor + 1)
  for (const p of later) {
    if (isDropped(p)) continue
    if (p.status === 'pending' && p.skill === 'pr' && !hasDelivery) {
      if (!hasReport) phases.push(newPhase({ skill: 'compte-rendu' }))
      phases.push(newPhase({ skill: 'project:version', isOptional: true }), newPhase({ skill: 'project:pr', isOptional: true }))
      continue
    }
    if (isVersionAhead(p)) phases.push(newPhase({ skill: 'compte-rendu' }))
    phases.push(p)
  }
  return { ...run, phases }
}

/** Les tickets d'un groupe : ceux enregistrés, plus ceux que le plan lui rattache après coup (`attachLoose`), comme le panneau les montre. */
const groupTicketIds = (run: Run, group: TicketGroup): string[] => {
  const attached = groupTicketsOf(run).get(group.id) ?? []
  return [...new Set([...group.tickets, ...attached])]
}

/**
 * Un groupe fini : chacun de ses tickets fait, ceux que le plan lui rattache compris (invariant : un
 * groupe n'est jamais tenu pour fini, relu, clos ni fermé tant qu'un ticket rattaché est ouvert).
 */
const isGroupDone = (run: Run, g: TicketGroup): boolean => isAllDone(run, groupTicketIds(run, g))

/** Les ids que le plan rattache à un groupe sans qu'il les ait enregistrés. */
export const attachedIdsOf = (run: Run, g: TicketGroup): string[] => groupTicketIds(run, g).filter(id => !g.tickets.some(x => sameTicket(x, id)))

/** Les tickets ouverts que le plan rattache à un groupe sans qu'il les ait enregistrés, nommés « nom [id] ». */
const openAttachedOf = (run: Run, g: TicketGroup): string[] =>
  groupTicketIds(run, g)
    .filter(id => !g.tickets.some(x => sameTicket(x, id)))
    .map(id => ticketOf(run, id))
    .filter((t): t is Ticket => t !== undefined && t.status !== 'done')
    .map(t => `${neutralRelayed(t.name)} [${neutralRelayed(t.id)}]`)

/**
 * Les tickets des groupes déclarés (ceux qui citent au moins un ticket connu), rattachés compris
 * (`attachLoose`), dans l'ordre de `run.groups` (null pour un groupe sans ticket connu) et par id.
 * Calculés une fois par état du lot, pas à chaque appel : la clé est tout ce qu'`attachLoose` lit
 * (ids et bloqueurs des tickets, ids et tickets des groupes), relue à chaque appel, si bien qu'un lot
 * changé sur place (un ticket ajouté, un bloqueur) refait le calcul.
 */
type GroupTickets = { key: string; byIndex: readonly (readonly string[] | null)[]; byId: ReadonlyMap<string, readonly string[]> }
const groupTicketsMemo = new WeakMap<Run, GroupTickets>()

const groupTicketsOfRun = (run: Run): GroupTickets => {
  const groups = run.groups ?? []
  const key = JSON.stringify([run.tickets.map(t => [t.id, t.blockedBy ?? []]), groups.map(g => [g.id, g.tickets])])
  const kept = groupTicketsMemo.get(run)
  if (kept?.key === key) return kept
  const declared = groups.map(g => ({ ...g, tickets: g.tickets.filter(id => ticketOf(run, id) !== undefined) }))
  attachLoose(run, declared.filter(g => g.tickets.length > 0))
  const byIndex = declared.map(g => (g.tickets.length > 0 ? g.tickets : null))
  const byId = new Map<string, readonly string[]>()
  for (const g of declared) if (g.tickets.length > 0 && !byId.has(g.id)) byId.set(g.id, g.tickets)
  const value = { key, byIndex, byId }
  groupTicketsMemo.set(run, value)
  return value
}

/** Les tickets de chaque groupe déclaré, rattachés compris, par id (le premier groupe d'un id). */
export const groupTicketsOf = (run: Run): ReadonlyMap<string, readonly string[]> => groupTicketsOfRun(run).byId

/**
 * Un groupe dont chaque ticket est dit ni sensible ni avec logique (des documents, une icône, une
 * règle qui ne fait rien lancer) : ni revue du groupe ni revue de sécurité, sa sécurité est réputée
 * tranchée sans avis (`closeMissing`). Invariant : un groupe dont un ticket a de la logique, une zone
 * sensible, ou ne dit pas l'un des deux, n'est jamais réputé de sécurité tranchée sans un avis de
 * sécurité envoyé ; un groupe vide, ou qui cite un ticket inconnu, non plus. Ses tickets sont aussi
 * ceux que le plan lui rattache (`attachLoose`), comme le panneau les montre.
 */
export const isNoLogicGroup = (run: Run, group: TicketGroup): boolean => {
  if (group.tickets.length === 0) return false
  return groupTicketIds(run, group).every(id => {
    const ticket = run.tickets.find(t => sameTicket(t.id, id))
    return ticket?.sensitive === false && ticket.logic === false
  })
}

/** Un groupe d'un seul ticket connu, rattachés compris : sa revue du groupe relirait le diff de son ticket. */
const isSingleTicketGroup = (run: Run, group: TicketGroup): boolean => {
  const ids = groupTicketIds(run, group)
  return ids.length === 1 && run.tickets.some(t => sameTicket(t.id, ids[0]!))
}

/**
 * Les revues des tickets suffisent pour la revue du groupe : un groupe sans logique ni zone sensible,
 * ou un groupe d'un seul ticket quels que soient ses drapeaux (Mathis, 01/11/2026 : sa revue du groupe
 * relisait le même diff). Invariant : un groupe de deux tickets ou plus, rattachés compris, n'est
 * jamais réputé relu sans sa revue du groupe s'il a un ticket avec de la logique, en zone sensible ou
 * muet ; l'avis de sécurité, lui, reste dû hors d'un groupe sans logique (`isNoLogicGroup`).
 */
export const isTicketReviewEnough = (run: Run, group: TicketGroup): boolean => isNoLogicGroup(run, group) || isSingleTicketGroup(run, group)

/** Un groupe relu : par /code-review, ou par les revues de ses tickets (groupe sans logique ni zone sensible, ou d'un seul ticket). */
export const isGroupReviewed = (run: Run, g: TicketGroup): boolean => hasGroupReview(g) || isTicketReviewEnough(run, g)

/** Un groupe fini attend encore sa revue. */
const awaitsReview = (run: Run, g: TicketGroup): boolean => !isGroupReviewed(run, g) && isGroupDone(run, g)

/** Un ticket sensible, ou qui ne l'a pas dit : dans le doute, il compte comme sensible (Mathis, 26/10/2026). */
const isSensitiveTicket = (ticket: Ticket | undefined): boolean => ticket?.sensitive !== false

/**
 * Un groupe dont un ticket touche une zone sensible, ou ne l'a pas dit : sa revue tourne sans --fix.
 * Ses tickets sont aussi ceux que le plan lui rattache, comme pour un groupe sans logique.
 */
export const isSensitiveGroup = (run: Run, group: TicketGroup): boolean =>
  groupTicketIds(run, group).some(id => isSensitiveTicket(run.tickets.find(t => sameTicket(t.id, id))))

/** Les arguments de la revue d'un groupe, sans --fix quand elle est sensible : le relecteur applique ce qu'il retient. */
const reviewArgs = (isSensitive: boolean): string => {
  const args = SKILLS['final-review']?.args ?? ''
  return isSensitive ? args.replace(/\s*--fix\b/, '') : args
}

export const groupReviewArgs = (run: Run, group: TicketGroup): string => reviewArgs(isSensitiveGroup(run, group))

/**
 * Les arguments d'une commande lancée du tableau de bord : ceux du skill, sauf la revue, sans --fix
 * quand un groupe qui l'attend est sensible, ou, dans un lot sans groupes, un de ses tickets.
 */
export const commandArgsOf = (run: Run | null, skill: string): string => {
  if (skill !== 'final-review' || run === null) return SKILLS[skill]?.args ?? ''
  const groups = run.groups ?? []
  const isSensitive =
    groups.length === 0
      ? run.tickets.some(isSensitiveTicket)
      : groups.some(g => g.linked === undefined && awaitsReview(run, g) && isSensitiveGroup(run, g))
  return reviewArgs(isSensitive)
}

/**
 * La dernière fin de ticket du lot : la plus récente des dates de fin lisibles de ses tickets faits.
 * Un ticket fait sans date lisible (relu hors forme, ou d'avant les dates) n'en donne aucune.
 */
export const lastTicketFinishOf = (run: Run): number | undefined => {
  const ends = run.tickets.filter(t => t.status === 'done' && isTime(t.finishedAt)).map(t => t.finishedAt as number)
  return ends.length > 0 ? ends.reduce((x, y) => (y > x ? y : x)) : undefined
}

/** Un plan de groupes arrivé pendant l'Implémentation d'un lot jusque-là sans groupes (réponse de l'outil, une fois). */
export const LOT_PLAN_NOTICE =
  'this Implementation ran without groups until now: the no-groups procedure of the /implement instructions no longer applies (procedure-groupe.md followed in this discussion, the lot review launched by you); the groups go to workers, as the dashboard plans them'

/**
 * Un lot sans groupes dispensé de revue et de sécurité : chacun de ses tickets dit ni sensible ni avec
 * logique, la règle d'un groupe sans logique (`isNoLogicGroup`). Un lot vide, ou dont un ticket
 * ne dit pas l'un des deux, ne l'est jamais.
 */
export const isLotReviewEnough = (run: Run): boolean => run.tickets.length > 0 && run.tickets.every(t => t.sensitive === false && t.logic === false)

/**
 * Un lot sans groupes à relire : tous ses tickets faits, et jamais relu, ou relu à une date future
 * (une revue à refaire, `clampFuture`), ou un ticket fini après sa dernière revue (un ticket ajouté
 * puis fini après elle). Calculé : rien ne s'enregistre pour un nouveau passage, la date de la dernière
 * revue le désigne. Faux avec des groupes.
 */
export const isLotToReview = (run: Run): boolean => {
  if ((run.groups ?? []).length > 0 || !isAllDone(run, run.tickets.map(t => t.id))) return false
  const reviewed = reviewTimeOf(run)
  if (reviewed === undefined) return true
  const last = lastTicketFinishOf(run)
  return last !== undefined && last > reviewed
}

/**
 * La date de l'avis de sécurité du lot : la sienne, ou, pour un avis sans date (d'avant les dates),
 * celle de la dernière revue du lot, puisqu'un avis vient après sa revue. Rien sans avis, ni pour un
 * avis sans date d'un lot jamais relu.
 */
const lotAdviceTimeOf = (run: Run): number | undefined => {
  const sec: unknown = run.security
  if (sec === null || typeof sec !== 'object') return undefined
  const at = (sec as SecurityCheck).at
  return isTime(at) ? at : reviewTimeOf(run)
}

/**
 * L'avis de sécurité du lot vaut pour le passage en cours : postérieur à la dernière fin de ticket et à
 * la dernière revue du lot (une fin ou une revue à la même milliseconde compte comme avant lui). Invariant : un avis antérieur à la dernière
 * fin de ticket ne rend jamais la sécurité du lot tranchée.
 */
export const isLotAdviceCurrent = (run: Run): boolean => {
  const at = lotAdviceTimeOf(run)
  if (at === undefined) return false
  const last = lastTicketFinishOf(run)
  // Il suit aussi la dernière revue du lot : un /security-review tapé avant le /code-review du passage,
  // ou une réponse tardive au passage précédent, ne compte pas.
  const reviewed = reviewTimeOf(run)
  return (last === undefined || at >= last) && (reviewed === undefined || at >= reviewed)
}

/** Le lot a un avis de sécurité enregistré qui ne vaut pas pour le passage en cours. */
export const isLotAdvicePrevious = (run: Run): boolean => run.security !== undefined && !isLotAdviceCurrent(run)

/**
 * La sécurité d'un lot sans groupes tranchée : son avis du passage en cours, comme celui d'un groupe
 * (`isSecuritySettled`), ou, sans aucun envoi, un lot dispensé ; un envoi explicite l'emporte sur la
 * dispense, comme pour un groupe (`closeMissing`), même d'un passage précédent.
 */
export const isLotSecuritySettled = (run: Run, review: SecurityReview = 'on'): boolean =>
  (run.security === undefined && isLotReviewEnough(run)) || (isLotAdviceCurrent(run) && isSecuritySettledFor(run.security, review))

/**
 * Un lot sans groupes relu (ou dispensé) dont la sécurité n'est pas tranchée : le compte rendu attend
 * encore, comme un groupe pas clos. Faux avec des groupes, ou tant qu'un ticket est ouvert.
 */
export const isLotSecurityDue = (run: Run, review: SecurityReview = 'on'): boolean =>
  (run.groups ?? []).length === 0 && isAllDone(run, run.tickets.map(t => t.id)) && !needsReview(run) && !isLotSecuritySettled(run, review)

/**
 * Un groupe clos par sa session (`closed`, l'envoi en cours) alors que la revue de sécurité était désactivée :
 * sa fermeture porte `securityOff`, posé une fois, à sa première fermeture, sur une lecture « désactivée » de
 * son avis conseillé sans revue (jamais d'après des dates : une marque de l'avis, la revue réactivée avant la
 * fermeture, ne compte pas). Il garde sa ligne « désactivée » au compte rendu, quel que soit le réglage ensuite.
 */
export const isClosedTurnedOff = (g: TicketGroup): boolean => {
  const closing = g.delegated?.closing
  return closing?.state === 'closed' && closing.securityOff === true
}

/**
 * Pose la marque « revue désactivée » d'un avis conseillé sans revue faite, seulement si le réglage lu à cet
 * instant dit « désactivée » (jamais sur une lecture ratée) : à la réception de l'avis (une marque déjà là
 * reste), ou à la fermeture du groupe (`isClosing` : posée à l'heure de la fermeture). Rien d'autre ne la pose.
 */
const markSecurityOff = (check: SecurityCheck | undefined, review: SecurityReview | undefined, now: number, isClosing = false): SecurityCheck | undefined =>
  review === 'off' && isAdvisedUnrun(check) && (isClosing || check.offAt === undefined) ? { ...check, offAt: now } : check

/** La marque `offAt` d'un avis relu datée à plus d'une minute dans le futur (la tolérance de toutes les dates relues). */
const isMarkAhead = (check: unknown, now: number): boolean =>
  check !== null && typeof check === 'object' && isTime((check as SecurityCheck).offAt) && (check as SecurityCheck).offAt! > now + 60_000

/** L'avis sans sa marque « revue désactivée ». */
const withoutMark = (check: SecurityCheck): SecurityCheck => {
  const { offAt: _dropped, ...rest } = check
  return rest
}

/** Un groupe fini n'a pas encore eu sa revue ; sans groupes, le lot à relire et pas dispensé. */
export const needsReview = (run: Run): boolean => {
  const groups = run.groups ?? []
  // Un groupe encore confié n'est pas fini ici, même ses tickets relayés faits.
  if (groups.length > 0) return groups.some(g => g.linked === undefined && awaitsReview(run, g))
  return isLotToReview(run) && !isLotReviewEnough(run)
}

/**
 * `/code-review` pendant un ticket en cours ici (Implémentation), une fois ses contrôles lancés : la
 * passe « bogues » de ce ticket, partie avec sa revue pour une zone sensible, pas la revue d'un
 * groupe. Plus tôt dans le ticket (lecture, TDD), c'est la revue d'un groupe fini, lancée depuis sa
 * ligne. `session` : cette discussion ; un ticket porté par une autre discussion ne compte pas.
 */
export const isBugPass = (run: Run, session?: string): boolean => {
  const phase = currentPhase(run)
  if (SKILLS[phase.skill]?.hasTickets !== true) return false
  const at = phase.steps.find(s => s.status === 'active')?.id
  if (at !== 'checks' && at !== 'review') return false
  return run.tickets.some(t => t.status === 'doing' && (t.by === undefined || session === undefined || t.by === session))
}

/**
 * `/code-review` vient d'être lancé : les groupes finis ici et pas encore relus le sont, en priorité
 * ceux de la file lancée dans cette discussion, et toujours ceux que nomme une revue lancée (la marque
 * démarrée de l'auto ou d'un bouton) ; jamais un groupe confié à un worker (sa revue se fait
 * là-bas, puis `reviewed`), en vol ou rendu. Rend leurs noms.
 */
const markReviewed = (run: Run, now: number): string[] => {
  const queue = run.queue ?? []
  // Seulement les groupes finis ici : la revue d'un groupe confié se fait dans son worker (sa branche
  // est fusionnée ici), et un groupe en vol n'est pas fini ; sinon un groupe renvoyé serait clos sans la
  // revue de son dernier envoi.
  const due = (run.groups ?? []).filter(g => g.linked === undefined && g.delegated === undefined && awaitsReview(run, g))
  const fromQueue = due.filter(g => g.tickets.some(id => queue.includes(id)))
  // Un groupe que nomme une revue lancée (marque démarrée de l'auto ou d'un bouton) est relu par elle, file ou non :
  // sinon l'auto attendrait pour toujours une revue qu'il ne redemande pas.
  const named = due.filter(g => readMarks(run).marks.some(m => m.startedAt !== undefined && m.key.startsWith('review:') && m.key.slice('review:'.length).split('+').includes(hereUnitOf(g))))
  const targets = fromQueue.length > 0 ? [...fromQueue, ...named.filter(g => !fromQueue.includes(g))] : due
  for (const g of targets) g.reviewedAt = now
  if (isAllDone(run, run.tickets.map(t => t.id))) {
    // Un avis du lot encore sans date (d'avant les dates) se date par la revue d'avant, 0 sans elle, avant
    // que celle-ci la remplace : daté par la nouvelle, il couvrirait un passage qu'il n'a jamais lu. Seul
    // `at` s'écrit.
    const sec: unknown = run.security
    if ((run.groups ?? []).length === 0 && sec !== null && typeof sec === 'object' && !isTime((sec as SecurityCheck).at)) {
      run.security = { ...(sec as SecurityCheck), at: reviewTimeOf(run) ?? 0 }
    }
    run.reviewedAt = now
  }
  return targets.map(g => `${g.id} (${g.name})`)
}

/**
 * Le groupe dont parle Claude quand il donne son avis de sécurité ou en rend le résultat : celui
 * qu'il nomme, sinon le dernier groupe fini (en priorité ceux de la file de cette discussion).
 * `null` sans groupes : l'avis porte alors sur le lot entier. Un id nommé inconnu est refusé avant
 * (`applyReport`) : ce repli ne vaut que sans `group`.
 */
const securityGroupOf = (run: Run, id: string): TicketGroup | null => {
  const groups = run.groups ?? []
  const named = id ? recordedGroup(run, id) : undefined
  if (named) return named
  const queue = run.queue ?? []
  const done = groups.filter(g => isGroupDone(run, g))
  const fromQueue = done.filter(g => g.tickets.some(t => queue.includes(t)))
  const pool = fromQueue.length > 0 ? fromQueue : done
  return [...pool].sort((x, y) => (reviewTimeOf(y) ?? 0) - (reviewTimeOf(x) ?? 0))[0] ?? null
}

/**
 * `/security-review` vient d'être lancé : les groupes finis où il n'a pas encore tourné, en priorité
 * ceux qui en ont besoin (un groupe sans logique ni zone sensible seulement s'il est le seul), ceux
 * qui sont relus et ceux de la file de cette discussion. Rend leurs noms.
 */
const markSecured = (run: Run, now: number): string[] => {
  const groups = run.groups ?? []
  if (groups.length === 0) {
    // Daté comme un envoi ; sur un nouveau passage, il repart de zéro (anciens comptes au journal), son
    // lancement gardé : jamais un compte d'un passage précédent daté de celui-ci.
    const isNewPass = isLotAdvicePrevious(run)
    if (isNewPass) logPreviousLotSecurity(run, now)
    run.security = { ...(isNewPass ? {} : run.security), ranAt: now, at: now }
    return []
  }
  const queue = run.queue ?? []
  // Jamais un groupe en vol : son envoi en cours n'est pas encore fusionné, ni rendu.
  const finished = groups.filter(g => g.linked === undefined && g.security?.ranAt === undefined && isGroupDone(run, g))
  // Un groupe sans logique ni zone sensible, sans avis, n'a pas de revue de sécurité : il n'est visé
  // que s'il est le seul fini (sinon des comptes jamais envoyés retiendraient sa fermeture).
  const needed = finished.filter(g => !(g.security === undefined && isNoLogicGroup(run, g)))
  const due = needed.length > 0 ? needed : finished
  const pick = (list: TicketGroup[]) => {
    const fromQueue = list.filter(g => g.tickets.some(id => queue.includes(id)))
    return fromQueue.length > 0 ? fromQueue : list
  }
  const reviewed = due.filter(g => isGroupReviewed(run, g))
  const targets = pick(reviewed.length > 0 ? reviewed : due)
  for (const g of targets) g.security = { ...g.security, ranAt: now }
  return targets.map(g => `${g.id} (${g.name})`)
}

/**
 * Un nouveau passage du lot (l'avis enregistré précède la dernière fin de ticket ou la dernière revue
 * du lot) : les comptes de l'avis
 * précédent, qui ne comptent plus, vont au journal avant que le nouvel avis le remplace.
 */
const logPreviousLotSecurity = (run: Run, now: number) =>
  log(run, now, '⛨', `Sécurité du lot : nouveau passage, l'avis enregistré (${previousSecurityText(run.security)}) précède la dernière fin de ticket ou la dernière revue du lot, et ne compte plus`, 'info')

/**
 * Les comptes d'une revue de sécurité lancée, en clair : « 2 findings, 1 fixed, 1 dismissed ».
 * Un compte relu hors forme ne s'écrit jamais comme un nombre.
 */
const securityCounts = (check: SecurityCheck): string =>
  hasUnreadableCounts(check)
    ? `counts read back out of form (${unreadableCounts(check).join(', ')}): send "findings" and "fixed" again`
    : `${check.findings} finding${check.findings === 1 ? '' : 's'}, ${check.fixed ?? 0} fixed${(check.dismissed ?? 0) > 0 ? `, ${check.dismissed} dismissed` : ''}`

/**
 * L'état de la revue de sécurité, pour le compte rendu. Un avis « inutile » prime sur des comptes envoyés
 * avec lui (un worker envoyait l'avis et des comptes à zéro) ; des failles trouvées quand même se disent à côté.
 */
const securityText = (check: SecurityCheck | undefined, review: SecurityReview = 'on', isClosedOff = false, unit: 'le groupe' | 'le lot' = 'le groupe'): string => {
  if (check && typeof check === 'object' && hasUnreadableCounts(check)) return `security review not settled: ${securityCounts(check)}`
  if (check?.isAdvised === false) {
    const anyway = (check.findings ?? 0) > 0 ? `, run anyway (${securityCounts(check)})` : ''
    return `security review judged not needed${check.why ? ` (${shownInNote(check.why)})` : ''}${anyway}`
  }
  if (check?.ranAt !== undefined) {
    const counts = check.findings !== undefined ? ` (${securityCounts(check)})` : ''
    return `security review run${counts}`
  }
  // Conseillée sans revue, la revue désactivée pour le projet (groupe clos avec sa marque, ou réglage relu « off ») :
  // la ligne fixe du compte rendu, avec la zone que l'avis a nommée.
  if (check?.isAdvised === true && (isClosedOff || review === 'off')) return `security review turned off for this project, write « revue de sécurité désactivée pour ce projet ; ${unit} touchait : ${check.why ? shownInNote(check.why) : 'zone non dite'} »`
  // Une marque d'avant une réactivation : la revue redevient due, et la ligne le dit ; un réglage illisible n'est pas une réactivation.
  if (check?.isAdvised === true && isTime(check.offAt) && review === 'unread') return `security review advised but not run, its setting unreadable now (counted as on)${check.why ? ` (${shownInNote(check.why)})` : ''}`
  if (check?.isAdvised === true && isTime(check.offAt)) return `security review advised but not run, turned back on since the advice${check.why ? ` (${shownInNote(check.why)})` : ''}`
  // La raison, relue du fichier partagé, sur une seule ligne : ce texte entre dans les faits du compte rendu.
  if (check?.isAdvised === true) return `security review advised but not run${check.why ? ` (${shownInNote(check.why)})` : ''}`
  return ''
}

/** Bloqué sans raison derrière un ticket encore ouvert : une attente, pas un blocage. */
export const isWaitingTicket = (run: Run, t: Ticket): boolean =>
  (t.status === 'todo' || (t.status === 'blocked' && !t.why)) && openBlockers(run, t).length > 0

/** Les tickets vraiment bloqués, par quelque chose hors du lot : ceux qui comptent en ambre. */
export const blockedCount = (run: Run): number => run.tickets.filter(t => t.status === 'blocked' && !isWaitingTicket(run, t)).length

/** Cycles rouge → vert : chaque passage d'un test en échec à un test réussi. */
export const tddCycles = (run: Run): number => {
  let cycles = 0
  let wasRed = false
  for (const t of run.tests) {
    if (t.kind !== 'test') continue
    if (!t.ok) wasRed = true
    else if (wasRed) {
      cycles += 1
      wasRed = false
    }
  }
  return cycles
}

// ─── Construction ─────────────────────────────────────────────────────────

/** Les étapes neuves d'un skill ; `withLegacy` garde celles d'un ancien chemin (une phase qui le suit encore). */
const stepsFor = (skill: string, now?: number, withLegacy = false): FlowStep[] =>
  (SKILLS[skill]?.steps ?? [])
    .filter(s => withLegacy || !s.isLegacy)
    .map((s, i) => (now !== undefined && i === 0 ? { id: s.id, status: 'active', at: now } : { id: s.id, status: 'pending' }))

const newPhase = (spec: PhaseSpec, now?: number): FlowPhase => ({
  skill: spec.skill,
  alts: spec.alts ?? [],
  isOptional: spec.isOptional === true,
  status: now !== undefined ? 'active' : 'pending',
  steps: stepsFor(spec.skill, now),
  items: [],
  round: now !== undefined ? 1 : 0,
  startedAt: now,
  detours: [],
  stats: { questions: 0, rounds: 0, answers: 0, standards: -1, spec: -1 },
})

export const newRun = (entry: string, now: number, title?: string): Run => {
  const def = SKILLS[entry]!
  const specs = def.flow ?? [{ skill: entry }]
  return {
    id: `${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    entry,
    title: title ? clip(title, 70) : def.flowLabel,
    isTitled: Boolean(title),
    status: 'active',
    phases: specs.map((spec, i) => newPhase(spec, i === 0 ? now : undefined)),
    cursor: 0,
    tickets: [],
    // Toujours vide (S21) : une version d'avant lit ce champ sans garde.
    agents: [],
    artifacts: [],
    tests: [],
    log: [],
    counters: { commits: 0, merges: 0, worktrees: 0, terms: 0, adrs: 0, testFiles: 0, repitches: 0 },
    touched: [],
    startedAt: now,
    updatedAt: now,
  }
}

// ─── Mutations internes (sur un clone) ────────────────────────────────────

/**
 * Avance vers `id` seulement si l'étape active est avant elle. Une phase finie ne bouge plus sur
 * un signal déduit (un commit après sa clôture n'y rallume pas « Commit ») : seul Claude la rouvre.
 */
const reachStep = (target: { steps: FlowStep[]; status?: string }, id: string, now: number) => {
  if (target.status === 'done') return
  const at = target.steps.findIndex(s => s.id === id)
  if (at < 0 || target.steps[at]!.status !== 'pending') return
  const active = target.steps.findIndex(s => s.status === 'active')
  if (active > at) return
  setStep(target, id, now)
}

const activeStepId = (target: { steps: FlowStep[] }): string | undefined => target.steps.find(s => s.status === 'active')?.id

/**
 * Une étape du skill que la phase n'a pas, ouverte avant que l'étape existe (le découpage d'une
 * rétro qui finit par l'ancienne étape de worker) : elle prend sa place dans l'ordre du skill,
 * avant les étapes qui la suivent. Une étape de l'ancien chemin n'est jamais ajoutée ainsi.
 */
const addSkillStep = (target: { skill: string; steps: FlowStep[] }, id: string) => {
  const defs = SKILLS[target.skill]?.steps ?? []
  const at = defs.findIndex(s => s.id === id)
  if (at < 0 || defs[at]!.isLegacy || target.steps.some(s => s.id === id)) return
  const rank = (stepId: string) => defs.findIndex(s => s.id === stepId)
  const after = target.steps.findIndex(s => rank(s.id) > at)
  const added: FlowStep = { id, status: 'pending' }
  target.steps = after < 0 ? [...target.steps, added] : [...target.steps.slice(0, after), added, ...target.steps.slice(after)]
}

/** Clôture : l'étape en cours est faite ; toute étape jamais atteinte, où qu'elle soit, est sautée. */
const finishSteps = (steps: FlowStep[]): FlowStep[] =>
  steps.map((step): FlowStep =>
    step.status === 'active'
      ? { id: step.id, status: 'done', at: step.at }
      : step.status === 'pending'
        ? { id: step.id, status: 'skipped' }
        : step,
  )

const finishDetour = (detour: Detour, now: number) => {
  detour.status = 'done'
  detour.finishedAt = now
  detour.steps = finishSteps(detour.steps)
}

const closeDetours = (phase: FlowPhase, now: number) => {
  for (const d of phase.detours) if (d.status === 'active') finishDetour(d, now)
}

const finishPhase = (phase: FlowPhase, now: number) => {
  phase.status = 'done'
  phase.finishedAt = now
  phase.steps = finishSteps(phase.steps)
  closeDetours(phase, now)
}

const findPhase = (run: Run, id: string, from: number): number =>
  run.phases.findIndex((p, i) => i >= from && (p.skill === id || p.alts.includes(id)))

/** Met la mission de côté : terminé si ses phases requises sont faites, sinon en pause. */
const shelve = (run: Run, now: number) => {
  closeDetours(currentPhase(run), now)
  if (isRunComplete(run)) {
    run.status = 'done'
    run.finishedAt = now
    // Terminé, il ne se rouvre plus en auto sans un nouveau second clic.
    stopAuto(run, now, AUTO_STOPS.finished)
  } else {
    run.status = 'paused'
  }
  run.owner = undefined
  run.updatedAt = now
  // Mise en pause ou close : la mission n'attend plus la personne dans une discussion.
  delete run.waitsUser
}

/** Les catégories du signal « t'attend » : une liste fermée. */
const WAITS_KINDS = new Set(['question', 'validation', 'step', 'report'])

/** Le signal relu d'une mission : seulement en forme (une valeur hors forme ne se montre ni ne se notifie). */
export const soundWaitsUser = (v: unknown): WaitsUser | null =>
  v !== null && typeof v === 'object' && isTime((v as WaitsUser).since) && WAITS_KINDS.has((v as WaitsUser).kind) ? { since: (v as WaitsUser).since, kind: (v as WaitsUser).kind } : null

/**
 * Pose le signal « t'attend » sur la mission active ici, à la fin d'un tour dont la suite demande la
 * personne, à la pause de l'auto hors d'un tour, ou le temps d'une question à boutons. Rien quand il y
 * est déjà pour la même chose (sa date reste celle du début de l'attente).
 */
export const setWaitsUser = (board: Board, kind: WaitsUser['kind'], now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.status !== 'active') return null
  if (soundWaitsUser(run0.waitsUser)?.kind === kind) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.waitsUser = { since: now, kind }
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** Efface le signal « t'attend » de la mission active ici : la personne a repris le travail (un tour commence). */
export const clearWaitsUser = (board: Board, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.waitsUser === undefined) return null
  const b = clone(board)
  const run = activeRun(b)!
  delete run.waitsUser
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

const prune = (board: Board) => {
  // Les archives ne comptent pas : on ne les perd pas parce que d'autres missions arrivent. Une mission livrée
  // et pas encore archivée non plus : elle reste dans le fichier jusqu'à « Archiver » ou sa rétro (rien n'est
  // effacé), la livraison ne l'archivant plus.
  const isKeptDelivered = (r: Run) => r.archivedAt === undefined && isDeliveredRun(r)
  const live = board.runs.filter(r => r.archivedAt === undefined && !isKeptDelivered(r))
  const delivered = board.runs.filter(isKeptDelivered)
  const archived = board.runs
    .filter(r => r.archivedAt !== undefined)
    .sort((x, y) => (y.archivedAt ?? 0) - (x.archivedAt ?? 0))
    .slice(0, LIMITS.archived)
  if (live.length <= LIMITS.runs && archived.length + delivered.length === board.runs.length - live.length) return
  const open = live.filter(r => r.status !== 'done')
  const done = live
    .filter(r => r.status === 'done')
    .sort((x, y) => (y.finishedAt ?? y.updatedAt) - (x.finishedAt ?? x.updatedAt))
  const keep = new Set([...open, ...done].slice(0, LIMITS.runs).map(r => r.id).concat(archived.map(r => r.id), delivered.map(r => r.id)))
  board.runs = board.runs.filter(r => keep.has(r.id))
}

/** Le compte rendu pas encore validé qu'un saut jusqu'à la phase `at` laisserait derrière lui. */
const reportBefore = (run: Run, at: number): FlowPhase | undefined =>
  run.phases.slice(run.cursor, at).find(p => p.skill === 'compte-rendu' && (p.status === 'pending' || p.status === 'active'))

/** Livrer sans rapport validé : le compte rendu est sauté, et le panneau le dit. */
const markReportSkipped = (run: Run, report: FlowPhase | undefined, now: number, fx: Effects) => {
  if (!report) return
  report.status = 'skipped'
  log(run, now, '!', 'Compte rendu sauté : livraison sans rapport validé', 'warn')
  fx.toasts.push('! Compte rendu non validé : livraison sans rapport')
}

/** Place le curseur sur la phase `at` : les phases sautées le sont, celle qu'on quitte est faite. */
const moveTo = (run: Run, at: number, id: string, now: number, fx: Effects) => {
  const def = SKILLS[id]!
  if (at === run.cursor) {
    const phase = run.phases[at]!
    const isAgain = phase.status === 'active' || phase.status === 'done'
    closeDetours(phase, now)
    phase.skill = id
    phase.status = 'active'
    phase.finishedAt = undefined
    phase.startedAt = phase.startedAt ?? now
    phase.round = isAgain ? phase.round + 1 : 1
    // Une phase qui suit encore le worker d'un ancien envoi garde son étape.
    phase.steps = stepsFor(id, now, holdsItemsSession(phase))
    log(run, now, def.glyph, isAgain ? `${def.label} ${agree(def, 'relancé')} (tour ${phase.round})` : `${def.label} ${agree(def, 'démarré')}`, 'accent')
    fx.toasts.push(isAgain ? `${def.glyph} ${def.label} · tour ${phase.round}` : `${def.glyph} ${def.label}`)
  } else {
    const left = SKILLS[currentPhase(run).skill]
    for (let i = run.cursor; i < at; i++) {
      const p = run.phases[i]!
      if (p.status === 'active') finishPhase(p, now)
      else if (p.status === 'pending') p.status = 'skipped'
    }
    const phase = run.phases[at]!
    phase.skill = id
    phase.status = 'active'
    phase.startedAt = now
    phase.finishedAt = undefined
    phase.round = 1
    phase.steps = stepsFor(id, now)
    run.cursor = at
    log(run, now, def.glyph, `${def.label} ${agree(def, 'démarré')}`, 'accent')
    fx.toasts.push(`${left ? `${left.glyph} ${left.label} → ` : ''}${def.glyph} ${def.label}`)
  }
  // Du code s'écrit : le compte rendu qui suit n'est plus facultatif (Triage, Santé du code).
  if (id === 'implement') {
    for (const p of run.phases.slice(at + 1)) if (p.skill === 'compte-rendu') p.isOptional = false
  }
  run.status = 'active'
  run.finishedAt = undefined
  run.updatedAt = now
}

/** Les phases d'après `at` redeviennent à faire, sans leurs étapes ni leurs dates. */
const resetAfter = (run: Run, at: number, now: number) => {
  for (const p of run.phases.slice(at + 1)) {
    closeDetours(p, now)
    p.status = 'pending'
    p.steps = stepsFor(p.skill)
    p.round = 0
    p.startedAt = undefined
    p.finishedAt = undefined
  }
}

/**
 * Revient à la phase sautée du skill `id` quand rien n'a été fait depuis, hors livraison : un
 * `/project:push` des documents du découpage enjambe l'implémentation, qui commence ensuite.
 * Les phases d'après redeviennent à faire. Faux quand il n'y a pas de telle phase.
 */
const reopenSkipped = (run: Run, id: string, now: number, fx: Effects): boolean => {
  const at = run.phases.findIndex((p, i) => i < run.cursor && p.status === 'skipped' && (p.skill === id || p.alts.includes(id)))
  if (at < 0) return false
  const since = run.phases.slice(at + 1, run.cursor + 1)
  if (!since.every(p => p.status === 'skipped' || p.status === 'pending' || DELIVERY.has(p.skill))) return false
  resetAfter(run, at, now)
  const def = SKILLS[id]!
  const phase = run.phases[at]!
  phase.skill = id
  phase.status = 'active'
  phase.startedAt = now
  phase.finishedAt = undefined
  phase.round = 1
  phase.steps = stepsFor(id, now)
  run.cursor = at
  // Du code s'écrit : le compte rendu qui suit n'est plus facultatif, comme dans moveTo.
  if (id === 'implement') {
    for (const p of run.phases.slice(at + 1)) if (p.skill === 'compte-rendu') p.isOptional = false
  }
  run.status = 'active'
  run.finishedAt = undefined
  run.updatedAt = now
  log(run, now, def.glyph, `${def.label} ${agree(def, 'démarré')} (la livraison passée avant redevient à faire)`, 'accent')
  fx.toasts.push(`${def.glyph} ${def.label}`)
  return true
}

/**
 * Des tickets partent en implémentation hors de cette discussion (workers) : la phase
 * Implémentation devient la phase en cours, si la mission n'y est pas déjà.
 */
const enterImplementation = (run: Run, now: number, fx: Effects) => {
  const at = run.phases.findIndex(p => p.skill === 'implement')
  if (at < 0) return
  const phase = run.phases[at]!
  if (at > run.cursor || (at === run.cursor && phase.status === 'pending')) moveTo(run, at, phase.skill, now, fx)
  else if (at < run.cursor) reopenSkipped(run, phase.skill, now, fx)
}

/** Les groupes et les tickets de la mission que nomment les arguments d'une commande (« groupe B », un id de ticket). */
const namedInArgs = (run: Run, args: string): string[] => {
  const groups = (run.groups ?? []).filter(g => /[A-Za-z0-9]/.test(g.id) && new RegExp(`\\b(?:groupe?|group)\\s+${g.id.replace(/[^A-Za-z0-9]/g, '')}\\b`, 'i').test(args)).map(g => `groupe ${g.id}`)
  const tokens = new Set(args.split(/[\s,;:()[\]«»"']+/).filter(Boolean))
  const tickets = run.tickets.filter(t => tokens.has(t.id)).map(t => t.id)
  return [...groups, ...tickets]
}

/**
 * Les unités qu'une commande de code nomme dans ses arguments (« groupe A », un id de ticket, aux mêmes formes
 * que `namedInArgs`) : les groupes nommés, et ceux qui portent les tickets nommés pas encore faits.
 */
export const unitsNamedInArgs = (run: Run, args: string): string[] => {
  const named = namedInArgs(run, args)
  const groups = named.filter(x => x.startsWith('groupe ')).map(x => x.slice('groupe '.length))
  const tickets = run.tickets.filter(t => t.status !== 'done' && named.includes(t.id)).map(t => t.id)
  return [...new Set([...groups, ...(tickets.length > 0 ? unitsOfTickets(run, tickets) : [])])]
}

/**
 * `/implement` lancé pour un groupe ou des tickets de la mission de cette discussion, une fois
 * l'implémentation passée (compte rendu en cours ou fait) : la mission revient à son
 * implémentation, et son compte rendu, comme les phases d'après, est à refaire. Lancé pour un
 * groupe d'une mission en phase compte rendu, il en ouvrait une seconde. Faux quand rien ne s'applique.
 */
const backToImplementation = (run: Run, id: string, args: string, now: number, fx: Effects): boolean => {
  if (id !== 'implement') return false
  const at = run.phases.findIndex(p => p.skill === 'implement')
  if (at < 0 || at >= run.cursor) return false
  const named = namedInArgs(run, args)
  if (named.length === 0) return false
  resetAfter(run, at, now)
  for (const p of run.phases.slice(at + 1)) if (p.skill === 'compte-rendu') p.isOptional = false
  const def = SKILLS[id]!
  const phase = run.phases[at]!
  closeDetours(phase, now)
  phase.skill = id
  phase.status = 'active'
  phase.finishedAt = undefined
  phase.startedAt = phase.startedAt ?? now
  phase.round = phase.round + 1
  phase.steps = stepsFor(id, now)
  run.cursor = at
  run.status = 'active'
  run.finishedAt = undefined
  run.updatedAt = now
  log(run, now, def.glyph, `${def.label} ${agree(def, 'relancé')} pour ${named.join(', ')} (tour ${phase.round}) : le compte rendu est à refaire`, 'accent')
  fx.toasts.push(`${def.glyph} ${def.label} · tour ${phase.round} · compte rendu à refaire`)
  return true
}

const startDetour = (run: Run, phase: FlowPhase, id: string, now: number, fx: Effects) => {
  const def = SKILLS[id]!
  closeDetours(phase, now)
  phase.detours = [
    ...phase.detours,
    { skill: id, status: 'active' as const, startedAt: now, steps: stepsFor(id, now), items: [] },
  ].slice(-LIMITS.detours)
  log(run, now, '↳', `Détour : ${def.label}`, 'accent')
  fx.toasts.push(`↳ Détour : ${def.label}`)
  run.updatedAt = now
}

// ─── Skills ───────────────────────────────────────────────────────────────

export type SkillContext = {
  now: number
  /** Chargé dans la boucle principale (un skill chargé par un spécialiste ne bouge rien). */
  isMain: boolean
  /** Arguments de la commande ou de l'outil Skill. */
  args?: string
  /** Le premier message d'une mission lancée par le COO (il porte l'id d'un lancement) : une mission neuve s'ouvre, aucune en pause n'est reprise. */
  isLaunched?: boolean
}

/**
 * Un skill du plugin vient d'être chargé. Dans l'ordre : sous-skill de la phase en cours,
 * phase suivante de la mission, détour, reprise d'une mission en pause née ici, nouvelle mission.
 */
export const applySkill = (board: Board, name: string, ctx: SkillContext): Outcome => {
  const raw = skillIdOf(name)
  // Un worker qui travaille pour une mission restée ailleurs n'en ouvre ni n'en reprend aucune.
  if (!raw || !ctx.isMain || board.delegate || isCooDiscussion(board, ctx.now)) return null
  // `/code-review` de Claude Code sans mission active ici : la relecture d'une branche, pas la revue d'un groupe.
  const id = raw === 'final-review' && !activeRun(board) ? 'branch-review' : raw
  const def = SKILLS[id]!
  const b = clone(board)
  const fx = noFx()
  const now = ctx.now
  const run = activeRun(b)

  if (def.role === 'event') {
    if (!run) return null
    if (id === 'final-review') {
      // La passe « bogues » d'un ticket ne relit aucun groupe : une ligne du journal, rien d'autre.
      if (isBugPass(run, b.session)) {
        log(run, now, def.glyph, 'Passe « bogues » du ticket en cours (/code-review)', 'info')
        run.updatedAt = now
        return { board: b, fx }
      }
      const names = markReviewed(run, now)
      log(run, now, def.glyph, names.length > 0 ? `Revue du groupe : ${names.join(', ')}` : 'Revue de code (/code-review)', 'accent')
      run.updatedAt = now
      return { board: b, fx }
    }
    if (id === 'security-review') {
      const names = markSecured(run, now)
      log(run, now, def.glyph, names.length > 0 ? `Revue de sécurité : ${names.join(', ')}` : 'Revue de sécurité (/security-review)', 'accent')
      run.updatedAt = now
      return { board: b, fx }
    }
    if (id === 'wait-what') run.counters.repitches += 1
    log(run, now, def.glyph, id === 'wait-what' ? 'Reformulation demandée (/wait-what)' : 'Orientation demandée à ask-matt', 'info')
    run.updatedAt = now
    return { board: b, fx }
  }

  if (run) {
    const phase = currentPhase(run)
    const detour = activeDetour(phase)
    const owner = SKILLS[detour?.skill ?? phase.skill]
    if (owner?.uses && Object.prototype.hasOwnProperty.call(owner.uses, id)) {
      const stepId = owner.uses[id]
      if (stepId) setStep(detour ?? phase, stepId, now)
      log(run, now, '↳', `${def.label} ${agree(def, 'chargé')} par ${owner.label}`, 'info')
      run.updatedAt = now
      return { board: b, fx }
    }
    if (def.partOf) {
      const parentAt = findPhase(run, def.partOf.skill, run.cursor)
      if (parentAt >= 0) {
        const report = reportBefore(run, parentAt)
        moveTo(run, parentAt, def.partOf.skill, now, fx)
        markReportSkipped(run, report, now, fx)
        const parent = run.phases[parentAt]!
        // Les étapes d'avant n'ont pas été faites : elles passent sautées, pas cochées.
        parent.steps = parent.steps.map((s): FlowStep => ({ id: s.id, status: 'pending' }))
        setStep(parent, def.partOf.step, now)
        fx.note = 'phase'
        return { board: b, fx }
      }
    }
    const at = findPhase(run, id, run.cursor)
    if (at >= 0) {
      const report = reportBefore(run, at)
      moveTo(run, at, id, now, fx)
      markReportSkipped(run, report, now, fx)
      fx.note = 'phase'
      return { board: b, fx }
    }
    if (backToImplementation(run, id, str(ctx.args), now, fx)) {
      fx.note = 'phase'
      return { board: b, fx }
    }
    if (reopenSkipped(run, id, now, fx)) {
      fx.note = 'phase'
      return { board: b, fx }
    }
    if (def.role === 'detour' || (def.detourIn ?? []).includes(phase.skill)) {
      startDetour(run, phase, id, now, fx)
      fx.note = 'detour'
      return { board: b, fx }
    }
    if (def.role === 'step') {
      log(run, now, def.glyph, `/${id}`, 'info')
      run.updatedAt = now
      return { board: b, fx }
    }
  }
  // Une commande de livraison n'ouvre jamais de mission à elle seule.
  if (def.role === 'step') return null

  // Une suite proposée par la phase en cours la clôt, même quand elle ouvre une autre mission :
  // la mission quittée est alors terminée, plus seulement en pause, s'il ne lui reste rien d'obligatoire.
  const followed = run && (SKILLS[currentPhase(run).skill]?.next ?? []).includes(id) ? run : null
  if (run) {
    const phase = currentPhase(run)
    if (phase.status === 'active' && followed) {
      finishPhase(phase, now)
      log(run, now, '✓', `${SKILLS[phase.skill]!.label} ${agree(SKILLS[phase.skill]!, 'terminé')}`, 'ok')
    }
  }

  // La suite de la mission de cette discussion, et la rétro lancée pendant qu'elle est active ici, portent
  // son titre et ne reprennent pas une autre mission en pause qui aurait la même phase : une rétro
  // lancée dans la discussion « Onglet Agents » avait repris la mission « Durée des requêtes ».
  const parent = followed ?? (id === 'retro' ? run : null)
  // Jamais les arguments de la commande (souvent un long prompt) : Claude envoie un titre réfléchi.
  const title = parent ? clip(`${def.flowLabel} · ${parent.title}`, 70) : undefined
  const paused = parent || ctx.isLaunched
    ? undefined
    : b.runs
    // Une mission mise de côté ne revient qu'à la demande de la personne : un skill ouvre alors la sienne.
    .filter(r => r.archivedAt === undefined && r.asideAt === undefined)
    // Seule une mission tenue ici, ou née ici et tenue par personne, revient d'office ; celle d'une autre discussion,
    // même muette ou close, se reprend par « ↻ Reprendre ici » : un /grill-with-docs lancé dans une discussion neuve
    // avait repris la mission de cadrage d'une autre discussion, muette depuis trois jours, et y avait écrit ses points
    // (06/11/2026). Née ici mais reprise ailleurs par le bouton, elle est à l'autre discussion tant qu'elle la tient.
    .filter(r => b.session !== undefined && (r.owner === b.session || (r.owner === undefined && r.bornIn === b.session)))
    .filter(r => r.status === 'paused' || (r.status === 'active' && r.id !== b.activeId && now - r.updatedAt > ORPHAN_MS))
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .find(r => findPhase(r, id, r.cursor) >= 0)
  if (paused) {
    if (run) shelve(run, now)
    paused.status = 'active'
    paused.owner = b.session
    delete paused.waitsUser
    b.activeId = paused.id
    log(paused, now, '↻', 'Mission reprise', 'accent')
    const at = findPhase(paused, id, paused.cursor)
    const resumed = paused.phases[at]!
    if (at === paused.cursor && resumed.status === 'active' && resumed.skill === id) {
      // Le travail reprend où il en était : ni nouveau tour, ni étapes remises à zéro.
      paused.updatedAt = now
    } else {
      moveTo(paused, at, id, now, fx)
    }
    fx.toasts.unshift(`↻ Reprise : ${paused.title}`)
    fx.openPane = true
    fx.note = 'phase'
    return { board: b, fx }
  }

  if (run) shelve(run, now)
  const created = newRun(id, now, title)
  created.owner = b.session
  created.bornIn = b.session
  b.runs.unshift(created)
  b.activeId = created.id
  log(created, now, def.glyph, `Mission lancée par /${id}`, 'accent')
  fx.toasts.push(`${def.glyph} ${def.flowLabel} : mission lancée`)
  fx.openPane = true
  fx.note = 'phase'
  prune(b)
  return { board: b, fx }
}

// ─── Rapports de Claude (outil flow) ──────────────────────────────────────

const ITEM_STATUSES: readonly ItemStatus[] = ['todo', 'doing', 'done', 'dropped']

const parseItems = (value: unknown): FlowItem[] =>
  asList(value)
    .map((one, i): FlowItem => {
      const label = str(one.label) || str(one.name) || str(one.id)
      const status = str(one.status) as ItemStatus
      return {
        id: str(one.id) || `i${i + 1}`,
        label: clip(label, TEXT_MAX),
        status: ITEM_STATUSES.includes(status) ? status : 'todo',
      }
    })
    .filter(item => item.label !== '')
    .slice(0, LIMITS.items)

/**
 * L'id généré d'une piste dont l'id d'origine est hors forme : « p » puis une empreinte de cet id en
 * base 36 (FNV-1a sur 32 bits, 7 signes au plus), puis un rang quand l'id est déjà pris (`formItemIds`) ;
 * toujours en forme d'id de groupe (12 signes au plus). Rien d'autre ne s'enregistre (décision de
 * Mathis du 31/10/2026 : dérivé, sans champ).
 */
export const derivedItemId = (raw: string, rank = 0): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) hash = Math.imul(hash ^ raw.charCodeAt(i), 0x01000193) >>> 0
  return `p${hash.toString(36)}${rank > 0 ? rank.toString(36) : ''}`
}

/**
 * Les pistes d'un envoi dont l'id est nouveau et hors forme (celle d'un id de groupe) prennent un id
 * dérivé du leur (`derivedItemId`) ; rend ce qui est renommé. Un id dérivé se garde pour une piste
 * qui a déjà cet id enregistré sous le même libellé (la même piste, renvoyée) ; pris dans l'envoi, ou
 * enregistré pour une autre piste (un autre libellé, ou cité par un lien sans piste), il passe au rang
 * suivant : jamais l'id d'une autre piste de la liste (une piste sortie de la liste libère le sien : rien
 * d'autre n'est enregistré). Une piste renvoyée sous son id d'origine retrouve donc son id tant que son
 * libellé ne change pas (changé, elle en reçoit un autre). Invariant : un id déjà
 * enregistré dans la mission (éléments d'une phase ou d'un détour, liste d'un lien de pistes) n'est
 * jamais réécrit, même hors forme : la piste renvoyée sous cet id s'y retrouve, comme celle renvoyée
 * sous la forme que la demande en a montrée (`neutralInPrompt`), quand un seul id enregistré la donne ;
 * une forme montrée commune à plusieurs n'en choisit aucun : la piste prend un id généré, et la réponse
 * donne leurs ids exacts, sous lesquels Claude renvoie chaque piste. Un id enregistré renvoyé exact se
 * garde toujours, et la réponse dit les autres ids de même forme montrée.
 */
const formItemIds = (run: Run, sent: FlowItem[]): { raw: string; id: string; candidates: string[]; label: string }[] => {
  const items = run.phases.flatMap(p => [...p.items, ...(p.detours ?? []).flatMap(d => d.items)])
  const recorded = new Set(items.map(i => i.id).concat(run.phases.flatMap(p => confidedIds(p.linked))))
  // Les libellés enregistrés sous chaque id, à la casse près ; un id cité par un lien sans piste n'en a aucun.
  const labels = new Map<string, string[]>()
  for (const id of recorded) labels.set(id.toLowerCase(), [])
  for (const i of items) labels.get(i.id.toLowerCase())!.push(i.label)
  // La forme montrée, nettoyée comme l'est un id renvoyé (`str`), pour qu'elle se compare à lui.
  const shown = new Map<string, string[]>()
  for (const id of recorded) {
    const key = str(neutralInPrompt(id))
    shown.set(key, [...(shown.get(key) ?? []), id])
  }
  // Les ids que cet envoi porte déjà, à la casse près : un id dérivé ne prend jamais celui d'une autre piste de l'envoi.
  const taken = new Set(sent.map(i => i.id.toLowerCase()))
  const renamed: { raw: string; id: string; candidates: string[]; label: string }[] = []
  const exact = new Set(sent.map(i => i.id))
  for (const item of sent) {
    const same = shown.get(item.id) ?? []
    // Un id enregistré renvoyé exact se garde ; d'autres ids enregistrés de même forme montrée se disent (rendu sans renommage).
    if (recorded.has(item.id)) {
      if (same.length > 1) renamed.push({ raw: item.id, id: item.id, candidates: same, label: item.label })
      continue
    }
    // La forme montrée d'un seul id enregistré se lit comme lui, sauf s'il est aussi renvoyé exact : pas de doublon.
    if (same.length === 1 && !exact.has(same[0]!)) {
      item.id = same[0]!
      continue
    }
    if (same.length === 0 && isGroupId(item.id)) continue
    // Libre : ni pris dans l'envoi, ni enregistré pour une autre piste (la même piste, c'est le même libellé).
    const isFree = (id: string) => !taken.has(id) && (labels.get(id)?.every(label => label === item.label) ?? true) && (labels.get(id)?.length ?? 1) > 0
    let rank = 0
    while (!isFree(derivedItemId(item.id, rank))) rank++
    const id = derivedItemId(item.id, rank)
    taken.add(id)
    renamed.push({ raw: item.id, id, candidates: same.length > 1 ? same : [], label: item.label })
    item.id = id
  }
  return renamed
}

type IncomingTicket = { id: string; name: string; status?: TicketStatus; blockedBy?: string[]; why?: string; files?: string[]; sensitive?: boolean; logic?: boolean }

/** Une liste de chemins reçue de Claude : chaînes non vides, sans doublon, bornée. */
const parsePaths = (value: unknown, max: number): string[] | undefined =>
  Array.isArray(value) ? [...new Set(value.map(str).filter(Boolean))].slice(0, max) : undefined

const parseTickets = (value: unknown): IncomingTicket[] =>
  asList(value)
    .map(one => {
      const status = str(one.status) as TicketStatus
      return {
        id: str(one.id),
        name: clip(str(one.name) || str(one.title) || str(one.id), TEXT_MAX),
        status: TICKET_STATUSES.includes(status) ? status : undefined,
        blockedBy: Array.isArray(one.blockedBy) ? one.blockedBy.map(str).filter(id => id !== '') : undefined,
        why: clip(str(one.why), TEXT_MAX) || undefined,
        files: parsePaths(one.files, LIMITS.ticketFiles),
        sensitive: typeof one.sensitive === 'boolean' ? one.sensitive : undefined,
        logic: typeof one.logic === 'boolean' ? one.logic : undefined,
      }
    })
    .filter(t => t.id !== '' && t.name !== '')
    .slice(0, LIMITS.tickets)

/** La raison d'un blocage ne survit pas au blocage. */
const keepWhy = <T extends { status: TicketStatus; why?: string }>(ticket: T): T => {
  if (ticket.status === 'blocked' || ticket.why === undefined) return ticket
  const { why: _, ...rest } = ticket
  return rest as T
}

/**
 * Le ticket dans son nouvel état. `by` : la discussion qui le passe « en cours », gardée tant
 * qu'il l'est, pour montrer qui porte chacun des tickets en cours.
 */
const withStatus = (ticket: Ticket, status: TicketStatus, now: number, by?: string): Ticket => {
  const { by: was, ...rest } = ticket
  const owner = status === 'doing' ? (by ?? was) : undefined
  return keepWhy({
    ...rest,
    status,
    ...(owner !== undefined ? { by: owner } : {}),
    startedAt: ticket.startedAt ?? (status === 'doing' || status === 'done' ? now : undefined),
    finishedAt: status === 'done' ? (ticket.finishedAt ?? now) : undefined,
  })
}

/**
 * Ajoute ou met à jour les tickets reçus ; ceux qui ne sont pas dans la liste restent. Une
 * discussion qui n'implémente que 2 tickets d'un lot de 10 n'efface pas les 8 autres.
 */
const mergeTickets = (current: readonly Ticket[], incoming: IncomingTicket[], now: number, by?: string): Ticket[] => {
  const apply = (base: Ticket, t: IncomingTicket): Ticket => {
    const named: Ticket = {
      ...base,
      name: t.name,
      ...(t.blockedBy ? { blockedBy: t.blockedBy } : {}),
      ...(t.why ? { why: t.why } : {}),
      ...(t.files ? { files: t.files } : {}),
      ...(t.sensitive !== undefined ? { sensitive: t.sensitive } : {}),
      ...(t.logic !== undefined ? { logic: t.logic } : {}),
    }
    return t.status && t.status !== named.status ? withStatus(named, t.status, now, by) : keepWhy(named)
  }
  const updated = current.map(c => {
    const t = incoming.find(x => sameTicket(x.id, c.id))
    return t ? apply(c, t) : c
  })
  const added = incoming
    .filter(t => !current.some(c => sameTicket(c.id, t.id)))
    .map(t => apply({ id: t.id, name: t.name, status: 'todo' }, t))
  return [...updated, ...added].slice(0, LIMITS.tickets)
}

const setTickets = (run: Run, changes: StatusChange[], now: number, by?: string): number => {
  let moved = 0
  run.tickets = run.tickets.map(t => {
    const change = changes.find(c => sameTicket(c.id, t.id))
    if (!change) return t
    if (change.status === t.status) {
      // Toujours bloqué, pour une autre raison.
      if (change.status !== 'blocked' || change.why === undefined || change.why === t.why) return t
      moved += 1
      return { ...t, why: change.why }
    }
    moved += 1
    if (change.status === 'done') log(run, now, '✓', `Ticket fait : ${t.name}`, 'ok')
    else if (change.status === 'doing') log(run, now, '▸', `Ticket en cours : ${t.name}`, 'accent')
    else if (change.status === 'blocked') log(run, now, '!', `Ticket bloqué : ${t.name}${change.why ? ` (${change.why})` : ''}`, 'warn')
    return withStatus(change.why ? { ...t, why: change.why } : t, change.status, now, by)
  })
  return moved
}

/**
 * Un lot s'implémente ticket par ticket : quand un ticket passe en cours après un autre, les
 * étapes repartent de la première (lire le ticket, TDD, vérifications, revue, commit). Un ticket
 * qui rejoint d'autres tickets déjà en cours (parallèle) ne remet pas leurs étapes à zéro.
 */
const restartTicketSteps = (run: Run, before: readonly Ticket[], now: number) => {
  const { phase, detour } = focusOf(run)
  if (detour || phase.skill !== 'implement' || phase.status !== 'active') return
  if (run.tickets.some(t => t.status === 'doing' && before.find(x => x.id === t.id)?.status === 'doing')) return
  const started = run.tickets.some(t => t.status === 'doing' && before.find(x => x.id === t.id)?.status !== 'doing')
  const hasProgress = phase.steps.some((s, i) => i > 0 && s.status !== 'pending')
  if (!started || !hasProgress) return
  phase.steps = phase.steps.map((s, i): FlowStep => (i === 0 ? { id: s.id, status: 'active', at: now } : { id: s.id, status: 'pending' }))
}

/**
 * Où en est le compte rendu de la mission, pour que Claude le lise au lieu de le deviner. Une phase
 * de compte rendu « faite » sur la mission active ne vient que de « ✓ Valider le rapport » : Claude
 * ne peut pas la clore, un saut vers la livraison la passe « sautée », et clore la mission le
 * retire de la discussion. Sans phase de compte rendu, rien.
 */
const reportStateOf = (run: Run): string => {
  const reports = run.phases.filter(p => p.skill === 'compte-rendu')
  const report = reports.find(p => p.status === 'active') ?? reports.at(-1)
  if (!report) return ''
  switch (report.status) {
    case 'done':
      return `rapport : validé${report.finishedAt !== undefined ? ` (${isoMinute(report.finishedAt)} UTC)` : ''}`
    case 'active':
      return 'rapport : en attente de validation'
    case 'skipped':
      return 'rapport : non validé (sauté)'
    default:
      return 'rapport : pas encore rédigé'
  }
}

export const summaryOf = (run: Run): string => {
  const { phase, detour, skill } = focusOf(run)
  const target = detour ?? phase
  const stepId = activeStepId(target)
  const stepLabel = skill.steps.find(s => s.id === stepId)?.label
  const t = countTickets(run.tickets)
  return [
    // Le titre, relu du fichier partagé pour une mission reprise, cité neutralisé : il n'ouvre aucune section.
    `Dashboard: ${shownText(run.title)}`,
    `${skill.label}${stepLabel ? ` > ${stepLabel}` : ''} (${target.status === 'done' ? 'done' : 'in progress'})`,
    t.total > 0 ? `tickets ${t.done}/${t.total} done` : '',
    reportStateOf(run),
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Le groupe qui s'exécute : celui d'un ticket « en cours », sinon du premier ticket ouvert de la
 * file ; aucun s'il y en a plusieurs ou si la mission n'a pas de groupes.
 */
const runningGroupOf = (run: Run, tickets: readonly Ticket[]): TicketGroup | undefined => {
  if (!run.groups || run.groups.length === 0) return undefined
  const groupOf = (id: string) => run.groups!.find(g => g.tickets.some(x => sameTicket(x, id)))
  const doing = tickets.filter(t => t.status === 'doing').map(t => groupOf(t.id)).filter(g => g !== undefined)
  const queued = (run.queue ?? []).map(id => tickets.find(t => sameTicket(t.id, id))).find(t => t !== undefined && t.status !== 'done')
  const running = [...new Set(doing.length > 0 ? doing : queued ? [groupOf(queued.id)].filter(g => g !== undefined) : [])]
  return running.length === 1 ? running[0] : undefined
}

/**
 * Des tickets ajoutés au lot pendant l'exécution d'un groupe, sans que Claude dise où les ranger :
 * ils rejoignent ce groupe (avant le premier de ses tickets qu'ils retiennent, sinon à la fin).
 * Le groupe en cours est celui d'un ticket « en cours », sinon du premier ticket ouvert de la file ;
 * rien ne bouge si ce n'est pas un seul groupe, ni pendant les skills qui publient le lot.
 */
const placeInRunningGroup = (run: Run, ids: readonly string[], before: readonly Ticket[], now: number) => {
  if (!run.groups || run.groups.length === 0 || !isFindingTime(run)) return
  const groupOf = (id: string) => run.groups!.find(g => g.tickets.some(x => sameTicket(x, id)))
  const loose = ids.filter(id => !groupOf(id))
  if (loose.length === 0) return
  // Le groupe en cours se juge sur l'état d'avant l'appel : un ticket qui passe « bloqué » dans le même appel compte encore.
  const g = runningGroupOf(run, before.filter(t => !loose.includes(t.id)))
  if (!g) return
  // À la fin d'abord, puis chacun remonte avant le premier ticket qu'il retient : une chaîne de
  // tickets ajoutés ensemble (rattrapage, puis recalage, puis recalcul) garde son ordre.
  g.tickets = [...g.tickets, ...loose]
  for (let pass = 0; pass <= loose.length; pass++) {
    let isMoved = false
    for (const id of loose) {
      const at = g.tickets.indexOf(id)
      const held = g.tickets.findIndex(x => (ticketOf(run, x)?.blockedBy ?? []).some(b => sameTicket(b, id)))
      if (held >= 0 && held < at) {
        g.tickets = [...g.tickets.slice(0, held), id, ...g.tickets.slice(held).filter(x => x !== id)]
        isMoved = true
      }
    }
    if (!isMoved) break
  }
  log(run, now, '▦', `Rangé dans le groupe ${g.id} : ${loose.map(id => ticketOf(run, id)?.name ?? id).join(', ')}`, 'info')
}

/** Un id de skill tel que Claude l'écrit (`/implement`, `mattpocock-skills:implement`) : celui du catalogue, ou null. */
const catalogId = (value: string): string | null => {
  const name = value.replace(/^\//, '').trim()
  if (name === '') return null
  if (name === 'flow-board:compte-rendu') return 'compte-rendu'
  if (name.startsWith('project:')) return name in SKILLS ? name : null
  const id = name.slice(name.lastIndexOf(':') + 1)
  return id in SKILLS ? id : null
}

/**
 * Ouvre une mission à la demande de Claude (outil `flow`, champ `open`), sans qu'un skill soit
 * lancé, même si une autre est active ici : celle-ci est mise en pause comme quand un autre skill de
 * départ ouvre une mission (terminée s'il ne lui reste rien d'obligatoire), avec tout ce qu'elle a.
 * La mission prend la forme de `entry` (un skill de départ du catalogue), `implement` sinon.
 */
export const openRun = (board: Board, ask: { entry?: string; title?: string }, now: number): { board: Board; fx: Effects; text: string } => {
  if (isCooDiscussion(board, now)) return { board, fx: noFx(), text: COO_NO_MISSION }
  const b = clone(board)
  const fx = noFx()
  const wanted = str(ask.entry)
  const found = catalogId(wanted)
  const role = found ? SKILLS[found]!.role : null
  const entry = found && (role === 'flow' || role === 'detour') ? found : 'implement'
  const fallback = wanted !== '' && entry !== found ? ` "${wanted}" is not a starting skill: the mission follows /implement.` : ''
  const previous = activeRun(b)
  if (previous) shelve(previous, now)
  const title = clip(str(ask.title), 70)
  const run = newRun(entry, now, title || undefined)
  run.owner = b.session
  run.bornIn = b.session
  b.runs.unshift(run)
  b.activeId = run.id
  log(run, now, '✚', `Mission ouverte par Claude${previous ? ` (« ${previous.title} » ${previous.status === 'done' ? 'terminée' : 'en pause'})` : ''}`, 'accent')
  fx.toasts.push(`✚ Mission ouverte : ${run.title}`)
  fx.openPane = true
  prune(b)
  const left = previous ? ` ${JSON.stringify(shownText(previous.title))} was ${previous.status === 'done' ? 'closed (nothing required left)' : 'paused'}, untouched; the user resumes it from the History tab.` : ''
  const named = title ? nameDiscussion(b, run, fx) : ' Send {"fix": {"title": "..."}} to name it.'
  return { board: b, fx, text: `New mission ${JSON.stringify(shownText(run.title))} (${SKILLS[entry]!.flowLabel}) opened in this discussion; the rest of this call went to it.${left}${fallback}${named}` }
}

/**
 * Corrige une mission (champ `fix`), à la demande de la personne ou après une erreur : le titre,
 * même déjà posé ; la phase en cours, en avant comme en arrière ; l'étape, en arrière comprise.
 * Revenir en arrière remet à faire les phases d'après ; avancer saute ou clôt celles d'avant,
 * sauf le compte rendu, qui reste réservé à la personne et passe « sauté ».
 */
const fixRun = (board: Board, run: Run, fix: Record<string, unknown>, now: number, fx: Effects): string => {
  const done: string[] = []
  const notes: string[] = []
  const title = clip(str(fix.title), 70)
  let named = ''
  if (title && title !== run.title) {
    run.title = title
    run.isTitled = true
    done.push(`titre « ${title} »`)
    named = nameDiscussion(board, run, fx)
  }
  const wantedPhase = str(fix.phase)
  let phase = currentPhase(run)
  if (wantedPhase) {
    const id = catalogId(wantedPhase)
    const at = id ? run.phases.findIndex(p => p.skill === id || p.alts.includes(id)) : -1
    if (at < 0) {
      notes.push(`phase "${wantedPhase}" is not in this mission (phases: ${run.phases.map(p => p.skill).join(', ')})`)
    } else if (at !== run.cursor) {
      if (at < run.cursor) {
        // En arrière : les phases d'après redeviennent à faire.
        resetAfter(run, at, now)
      } else {
        const report = reportBefore(run, at)
        for (let i = run.cursor; i < at; i++) {
          const p = run.phases[i]!
          if (p === report) continue
          if (p.status === 'active') finishPhase(p, now)
          else if (p.status === 'pending') p.status = 'skipped'
        }
        if (report) {
          closeDetours(report, now)
          markReportSkipped(run, report, now, fx)
        }
      }
      phase = run.phases[at]!
      if (id && phase.skill !== id && SKILLS[id]) phase.skill = id
      if (phase.status === 'pending' || phase.status === 'skipped') {
        phase.steps = stepsFor(phase.skill, now)
        phase.round = Math.max(1, phase.round)
        phase.startedAt = now
      }
      phase.status = 'active'
      phase.finishedAt = undefined
      run.cursor = at
      done.push(`phase ${phaseLabel(phase.skill)}`)
    }
  }
  const stepId = str(fix.step)
  if (stepId) {
    addSkillStep(phase, stepId)
    const at = phase.steps.findIndex(s => s.id === stepId)
    if (at < 0) {
      notes.push(`step "${stepId}" is not a step of ${shownText(phase.skill)} (${phase.steps.map(s => shownText(s.id)).join(', ') || 'no steps'})`)
    } else {
      // Les étapes d'après redeviennent à faire : une correction peut revenir en arrière.
      phase.steps = phase.steps.map((s, i): FlowStep =>
        i < at ? (s.status === 'done' || s.status === 'skipped' ? s : { id: s.id, status: 'done', at: s.at }) : i === at ? { id: s.id, status: 'active', at: s.status === 'active' ? s.at : now } : { id: s.id, status: 'pending' },
      )
      if (phase.status === 'done' && phase.skill !== 'compte-rendu') {
        phase.status = 'active'
        phase.finishedAt = undefined
      }
      done.push(`étape ${SKILLS[phase.skill]?.steps.find(s => s.id === stepId)?.label ?? stepId}`)
    }
  }
  if (done.length > 0) {
    log(run, now, '✎', `Corrigé : ${done.join(', ')}`, 'info')
    fx.toasts.push(`✎ Mission corrigée : ${done.join(', ')}`)
  }
  run.status = 'active'
  run.finishedAt = undefined
  return [done.length > 0 ? ` · fixed: ${done.length} change(s)` : '', named, notes.length > 0 ? ` · not fixed: ${notes.join('; ')}` : ''].join('')
}

/**
 * Un appel de l'outil `flow`. `resume` reprend d'abord une mission du projet dans cette discussion,
 * comme « ↻ Reprendre ici » : un worker lancé pour un groupe n'a pas de bouton à cliquer.
 */
export const applyReport = (
  board: Board,
  input: Readonly<Record<string, unknown>>,
  now: number,
  opts: { hasPullRequests?: boolean; isVersionSet?: boolean | null; delegateTitle?: string; relay?: unknown; seenReports?: ReadonlySet<string>; isRepo?: boolean; security?: SecurityReview } = {},
): { board: Board; fx: Effects; text: string } => {
  const out = reportOnce(board, input, now, opts)
  if (board.delegate || str(input.delegate) !== '' || out.board.delegate) return out
  // Un compte rendu par SendMessage peut se perdre (discussion renommée, redémarrée) : le relais le garde.
  const run = activeRun(out.board)
  const relay = run && isRelay(opts.relay, run.id) ? opts.relay : null
  const reports = run ? relayedReportsText(run, relay, opts.seenReports) : ''
  // Puis les groupes rendus à fermer, et ce qui manque aux autres.
  const closing = run ? closingText(run, relay, opts.isRepo !== false, opts.security) : ''
  // Enfin les rappels : un ticket fait ici sans revue envoyée, et les tickets bloqués.
  const reminders = run ? `${unreviewedDoneText(activeRun(board), run, input)}${blockedText(run)}` : ''
  return reports || closing || reminders ? { ...out, text: `${out.text}${reports}${closing}${reminders}` } : out
}

/**
 * Les tickets bloqués, rappelés à chaque réponse dans la discussion de la mission : un ticket était
 * resté « bloqué » au tableau de bord après la décision qui le débloquait.
 */
const blockedText = (run: Run): string => {
  if (run.status !== 'active') return ''
  const blocked = run.tickets.filter(t => t.status === 'blocked')
  if (blocked.length === 0) return ''
  const list = blocked.map(t => `${neutralRelayed(t.name)} [${neutralRelayed(t.id)}]${t.why ? ` (${neutralRelayed(t.why)})` : ''}`).join('; ')
  return ` · Still blocked: ${list}. Once what blocks one is settled, send its new status in "set".`
}

/** Un ticket fait par un worker : sa revue est relayée par lui, pas envoyée ici. */
const isLinkedTicket = (run: Run, id: string): boolean => (run.groups ?? []).some(g => g.tickets.some(x => sameTicket(x, id)) && (g.linked !== undefined || g.delegated !== undefined))

/**
 * Un ticket passé « fait » ici par cet appel, sans `review` dans le même appel : un ticket était
 * passé « fait » sans revue envoyée, sans aucun rappel. Le rappel ne compte rien (le compteur de
 * revues de la phase mêle revues relayées, passes « bogues » et revues de groupe) : il se dit à
 * chaque ticket fait ici sans revue dans l'appel, et une revue envoyée plus tôt le rend sans objet.
 */
const unreviewedDoneText = (before: Run | null, run: Run, input: Readonly<Record<string, unknown>>): string => {
  if (input.review !== undefined && input.review !== null) return ''
  const was = new Map((before?.id === run.id ? before.tickets : []).map(t => [t.id, t.status]))
  const fresh = run.tickets.filter(t => t.status === 'done' && was.has(t.id) && was.get(t.id) !== 'done' && !isLinkedTicket(run, t.id))
  if (fresh.length === 0) return ''
  const ids = fresh.map(t => `${neutralRelayed(t.name)} [${neutralRelayed(t.id)}]`).join(', ')
  return ` · Done here without a review in this call: ${ids}. If its review was sent earlier, nothing to do; otherwise send its findings in "review", or run it before the next ticket.`
}

const reportOnce = (
  board: Board,
  input: Readonly<Record<string, unknown>>,
  now: number,
  opts: { hasPullRequests?: boolean; isVersionSet?: boolean | null; delegateTitle?: string; relay?: unknown; seenReports?: ReadonlySet<string>; isRepo?: boolean; security?: SecurityReview },
): { board: Board; fx: Effects; text: string } => {
  // Un worker qui travaille pour un groupe d'une mission restée ailleurs : rien ne s'écrit ici.
  const delegateId = str(input.delegate)
  if (delegateId !== '') {
    const out = delegateHere(board, delegateId, now, opts.delegateTitle, str(input.group) || undefined, str(input.main) || undefined)
    // Ce qui arrive avec "delegate" (set, decided, report…) part aussi au relais : la session du groupe C
    // renvoyait "delegate" à chaque appel, et tout le reste se perdait sans que la réponse le dise.
    const sentence = relayedSentence(input)
    return { ...out, text: `${out.text}${sentence !== '' ? ` ${sentence}` : ''}${refusedRelayText(input)}` }
  }
  if (board.delegate) return { board, fx: noFx(), text: delegatedReportText(board, input) }
  // La discussion du COO ne porte jamais de mission : ni ouverture, ni reprise, ni compte d'une mission.
  if (isCooDiscussion(board, now)) return { board, fx: noFx(), text: COO_NO_MISSION }
  // `open` passe avant tout : le reste de l'appel va à la mission qu'elle ouvre.
  const open = input.open !== null && typeof input.open === 'object' ? (input.open as Record<string, unknown>) : null
  if (open || input.open === true) {
    const opened = openRun(board, { entry: str(open?.entry), title: str(open?.title) || str(input.title) }, now)
    const { open: _, resume: __, ...rest } = input
    const out = reportHere(opened.board, rest, now, opts)
    const ignored = str(input.resume) !== '' ? ' "resume" was ignored: "open" starts a new mission.' : ''
    return { board: out.board, fx: { ...out.fx, openPane: true, toasts: [...opened.fx.toasts, ...out.fx.toasts], ...(opened.fx.discussionTitle !== undefined && out.fx.discussionTitle === undefined ? { discussionTitle: opened.fx.discussionTitle } : {}) }, text: `${opened.text}${ignored} ${out.text}` }
  }
  const resumeId = str(input.resume)
  if (resumeId === '' || resumeId === board.activeId) return reportHere(board, input, now, opts)
  const resumed = resumeRun(board, resumeId, now)
  if (!resumed) return { board, fx: noFx(), text: `No mission "${resumeId}" in this project: nothing was resumed nor recorded. ${noActiveText(board)}` }
  const out = reportHere(resumed.board, input, now, opts)
  // Le titre, relu du fichier partagé, cité neutralisé comme dans `summaryOf`.
  const title = resumed.board.runs.find(r => r.id === resumeId)?.title ?? resumeId
  return { board: out.board, fx: { ...out.fx, toasts: [...resumed.fx.toasts, ...out.fx.toasts] }, text: `Workflow ${JSON.stringify(shownText(title))} resumed in this discussion. ${out.text}` }
}

/** Au-delà, une délégation gardée ne revient plus au chargement (une session de groupe tient rarement plus d'un jour). */
const DELEGATE_KEEP_MS = 3 * 24 * 60 * 60 * 1000

/** Les tickets faits d'un groupe, parmi ceux du lot (même comparaison d'ids que le reste du modèle). */
export const groupDone = (run: Run, group: TicketGroup): { done: number; total: number } => {
  const tickets = groupTicketIds(run, group).map(id => ticketOf(run, id)).filter((t): t is Ticket => t !== undefined)
  return { done: tickets.filter(t => t.status === 'done').length, total: tickets.length }
}

/**
 * L'avancement d'un groupe confié, pour sa pastille du bandeau : ses tickets enregistrés d'après le
 * relais de sa session, plus ceux que le plan lui rattache d'après la mission (sa session ne les
 * relaie pas) ; sans relais, celui de la mission (`groupDone`).
 */
export const groupProgress = (run: Run, g: TicketGroup, relay: GroupRelay | null): { done: number; total: number } => {
  if (!relay) return groupDone(run, g)
  const attached = groupTicketIds(run, g)
    .filter(id => !g.tickets.some(x => sameTicket(x, id)))
    .map(id => ticketOf(run, id))
    .filter((t): t is Ticket => t !== undefined)
  // Un rattaché que la session a reçu dans son brief se relaie : son statut relayé vaut, sinon celui de la mission.
  const isDone = (t: Ticket) => t.status === 'done' || relay.tickets[t.id]?.status === 'done'
  return { done: relay.done + attached.filter(isDone).length, total: relay.total + attached.length }
}

/**
 * La délégation gardée pour cette session (`$.store`, clé `delegate:<session>`), remise sur un board
 * chargé du stockage : sans elle, un rechargement du mod dans un worker la perdait, et ses
 * skills pouvaient ouvrir une mission. Une forme inconnue est ignorée.
 */
export const restoreDelegate = (board: Board, kept: unknown, now?: number): Board => {
  if (board.delegate || kept === null || typeof kept !== 'object') return board
  const d = kept as Record<string, unknown>
  if (typeof d.run !== 'string' || d.run === '' || typeof d.at !== 'number') return board
  // Une délégation ancienne ou sur une mission finie ne revient pas : sinon la session ne la quitterait jamais.
  if ((now !== undefined && now - d.at > DELEGATE_KEEP_MS) || board.runs.some(r => r.id === d.run && r.status === 'done')) return board
  const text = (key: string) => (typeof d[key] === 'string' && d[key] !== '' ? { [key]: d[key] as string } : {})
  // La date de la référence suivie (`mainAt`) revient avec elle : sinon, après un rechargement, une référence plus
  // ancienne que celle déjà suivie passerait pour nouvelle. Bornée comme une référence lue (`parseMainRef`, sa marge
  // dans le futur comprise).
  const mainAt =
    typeof d.main === 'string' && d.main !== '' && typeof d.mainAt === 'number' && parseMainRef({ run: d.run, main: d.main, at: d.mainAt }, d.run, now) !== null && d.mainAt >= d.at ? { mainAt: d.mainAt } : {}
  return { ...board, activeId: null, delegate: { run: d.run, at: d.at, ...text('title'), ...text('group'), ...text('main'), ...mainAt } }
}

/**
 * La première réponse de l'outil après un rechargement du mod : l'état retrouvé. Le 22/10, la
 * discussion avait tout renvoyé par précaution alors que rien n'était perdu. Vide sans mission active.
 */
export const reloadText = (board: Board): string => {
  if (board.delegate) {
    const group = board.delegate.group ? `, group ${board.delegate.group}` : ''
    return `State found after a plugin reload: delegate mode kept for the mission ${JSON.stringify(shownText(delegatedTitle(board)))}${group}; nothing to send again.`
  }
  const run = activeRun(board)
  if (!run) return ''
  const phase = currentPhase(run)
  return `State found after a plugin reload: ${run.tickets.length} tickets, ${(run.groups ?? []).length} groups, phase ${phaseLabel(phase.skill)}; nothing to send again.`
}

/** Le titre de la mission pour lequel la discussion travaille : dans ce board, sinon celui relevé à la déclaration. */
export const delegatedTitle = (board: Board): string =>
  board.runs.find(r => r.id === board.delegate?.run)?.title ?? board.delegate?.title ?? board.delegate?.run ?? ''

/**
 * Comment joindre le manager : son nom peut changer (renommage), pas sa référence
 * `[ref]`. SendMessage ne résout une référence que lue à l'instant dans ListAgents : la session
 * relit donc la liste et envoie à la ligne de cette référence, sous son nom du moment.
 */
const reachText = (board: Board): string => {
  const main = board.delegate?.main
  // Une référence suivie depuis (`mainAt`) remplace celle du brief, à chaque réponse.
  const isFollowed = board.delegate?.mainAt !== undefined
  const how = `call ListAgents, find the row whose [ref] is ${main ? 'that one' : 'the one your brief gives'}, and send to that row's "<name> [ref]" exactly as listed (its name can change, its [ref] does not); if no row has it, say so in the first line of your final message.`
  return main
    ? `Reach the manager, ${asciiJson(main)} ${isFollowed ? '(its reference of the moment, newer than your brief\'s)' : 'in your brief'}, by its [ref]: ${how}`
    : `Reach the manager by the [ref] your brief gives: ${how}`
}

/** Le rappel court de l'adresse, aux relais : le paragraphe entier n'est que dans la réponse à `delegate`. */
const reachLine = (board: Board): string => {
  const main = board.delegate?.main
  const isFollowed = board.delegate?.mainAt !== undefined
  return main
    ? `The manager: ${asciiJson(main)}${isFollowed ? " (its reference of the moment, newer than your brief's)" : ''}, reached by its [ref] in ListAgents, as the delegate answer says.`
    : 'The manager: reached by the [ref] your brief gives, in ListAgents, as the delegate answer says.'
}

const delegateText = (board: Board): string => {
  const title = delegatedTitle(board)
  return (
    `This discussion works for the mission ${JSON.stringify(shownText(title))}, which stays in the manager: nothing is recorded on it from here (skills, steps, phases). ` +
    'Your progress is relayed to the manager\'s dashboard on its own: ticket statuses from your ticket files or Asana updates (their « **Status:** » or « Statut : » line, completion), your commits and your test runs. ' +
    'Only if a ticket\'s status changes without a ticket file or Asana update, send it here with {"set": [{"id": "<ticket id>", "status": "doing|done|blocked", "why": "<if blocked>"}]}. ' +
    'Each choice you make that the user neither asked for nor approved goes here at once, in {"decided": [{"what": "<the choice>", "why": "<why>"}]}: the main dashboard shows it for review right away; a choice that touches a sensitive area (' +
    SENSITIVE_AREAS +
    ') is never declared: ask the user; except when your prompt says you are a worker of a mission in auto mode: there section « Worker autonome » of your procedure (procedure-groupe-autonome.md) says when it is settled by its recommended option and declared. ' +
    'End with your report, one line per ticket (done, or not done and why): leave your whole report here, {"report": "<the whole report>"} (or, when it is already in a .md or .txt file under your worktree or your temporary folder CLAUDE_JOB_DIR, {"reportPath": "<its absolute path>"}, without pasting it again): it is kept in your relay file, next to the mission\'s, which the manager reads; then send the manager one line that points to it with SendMessage (that message wakes it up), and end on that same line. The manager checks your work and records the statuses. Nothing else is accepted. ' +
    reachText(board)
  )
}

/**
 * La réponse à un appel de l'outil dans un worker : seuls `set`, `decided`, `withdrawn`,
 * `review`, `security`, `report` et `note` partent au relais (écrit par l'enregistrement, qui remplace
 * `relayedSentence(input)` par `relayedSentence(input, lost)` quand une part n'a pas été gardée).
 */
const delegatedReportText = (board: Board, input: Readonly<Record<string, unknown>>): string => {
  const sentence = relayedSentence(input)
  // Un worker ne déclare pas de question bloquante : le manager la déclare.
  const waiting = input.waiting !== undefined ? ' · "waiting" is not recorded in a worker: send your question to the manager by SendMessage, which declares it there.' : ''
  return sentence === '' ? `${delegateText(board)}${refusedRelayText(input)}${waiting}` : `${sentence} ${reachLine(board)}${refusedRelayText(input)}${waiting}`
}

/**
 * Le worker d'un groupe se déclare (`delegate`) : il travaille pour une mission qui reste
 * dans le manager. Ses skills n'ouvrent ni ne reprennent aucune mission, et ses
 * rapports ne s'écrivent pas : un seul écrivain par mission.
 *
 * Une mission absente de ce board ne l'empêche pas : une session lancée dans un worktree a son
 * propre fichier (sa racine est celle du worktree), où la mission n'est pas. Ne rien enregistrer
 * reste le plus sûr ; `title` est alors lu dans le board du dépôt principal, s'il l'a.
 */
const delegateHere = (board: Board, runId: string, now: number, title?: string, group?: string, main?: string): { board: Board; fx: Effects; text: string } => {
  const target = board.runs.find(r => r.id === runId)
  const b = clone(board)
  const here = activeRun(b)
  if (here && here.id !== runId) shelve(here, now)
  b.activeId = null
  b.delegate = { run: runId, at: now, ...(!target && title ? { title } : {}), ...(group ? { group: clip(group, 20) } : {}), ...(main ? { main: clip(main, 120) } : {}) }
  const elsewhere = target ? '' : ' (The mission is not on this folder\'s dashboard, e.g. a worktree has its own: that changes nothing for you.)'
  return { board: b, fx: noFx(), text: `${delegateText(b)}${elsewhere}` }
}

/** Un appel de l'outil `flow` sur la mission active ici : titre, étape, éléments, tickets, note, fin de phase. */
const reportHere = (
  board: Board,
  input: Readonly<Record<string, unknown>>,
  now: number,
  opts: { hasPullRequests?: boolean; isVersionSet?: boolean | null; relay?: unknown; security?: SecurityReview } = {},
): { board: Board; fx: Effects; text: string } => {
  const b = clone(board)
  const fx = noFx()
  const tickets = parseTickets(input.tickets)
  let run = activeRun(b)
  if (!run) {
    // Une mission en pause ou suivie par une autre discussion : ne rien écrire, et le dire à Claude
    // plutôt que de le laisser deviner un autre lot (il était allé chercher d'autres tickets).
    if (tickets.length === 0 || resumable(b).length > 0) return { board, fx, text: noActiveText(b) }
    // Un lot de tickets sans skill chargé : suivi comme une implémentation (l'usage de ticket-board).
    // Son titre vient plus bas, comme un premier titre : la discussion le prend aussi.
    run = newRun('implement', now)
    run.owner = b.session
    run.bornIn = b.session
    b.runs.unshift(run)
    b.activeId = run.id
    log(run, now, '⚙', 'Lot de tickets suivi', 'accent')
    fx.openPane = true
    prune(b)
  }
  // Une rétro dont la session de pistes s'est fermée ou annulée depuis la dernière lecture.
  extendActive(run)
  // Les choix d'avant l'appel, relayés compris : l'auto se met en pause au passage des 200 (plus bas).
  const choiceRelay = isRelay(opts.relay, run.id) ? opts.relay : null
  const choicesBefore = (run.decided ?? []).length + relayedDecisions(run, choiceRelay).length

  // Une correction d'abord : la phase qu'elle choisit reçoit le reste de l'appel.
  const fix = input.fix !== null && typeof input.fix === 'object' ? (input.fix as Record<string, unknown>) : null
  const fixText = fix ? fixRun(b, run, fix, now, fx) : ''

  const phase = currentPhase(run)
  const detour = activeDetour(phase)
  const target = detour ?? phase
  const def = SKILLS[target.skill]!

  // Le premier titre seulement : un titre posé ne se change que par `fix` (ou /flow rename).
  const title = str(input.title)
  let namedText = ''
  if (title && !run.isTitled) {
    run.title = clip(title, 70)
    run.isTitled = true
    namedText = nameDiscussion(b, run, fx)
  }

  const stepId = str(input.step)
  if (stepId) {
    addSkillStep(target, stepId)
    const isOnTarget = setStep(target, stepId, now, true)
    if (!isOnTarget && detour) setStep(phase, stepId, now, true)
    if (isOnTarget && target === phase && phase.status === 'done') {
      phase.status = 'active'
      phase.finishedAt = undefined
    }
    // Le rapport du compte rendu est écrit : l'auto s'arrête là, sans le valider (« rapport prêt »).
    if (isOnTarget && target === phase && phase.skill === 'compte-rendu' && stepId === 'validate') stopAuto(run, now, AUTO_STOPS.report)
  }

  // Les éléments qu'un worker lancé rend « à faire » dans cet appel : ils reviennent au choix.
  let backToChoice = 0
  let itemsText = ''
  if (Array.isArray(input.items)) {
    const before = target.items
    const sent = parseItems(input.items)
    // Les pistes (éléments confiés à un worker) : un id nouveau hors forme prend un id généré.
    const renamed = def.items?.linkedStep ? formItemIds(run, sent) : []
    // Une piste en cours, ou confiée sans verdict, que l'envoi omet reste telle quelle (D3) : sinon la
    // session qui la traite ne serait plus attendue, ni sa fermeture retenue.
    const confided = target === phase ? confidedIds(phase.linked) : []
    const kept = before.filter(i => !sent.some(x => x.id === i.id) && (i.status === 'doing' || (confided.includes(i.id) && i.status !== 'done' && i.status !== 'dropped')))
    // La borne ne coupe jamais une piste confiée ou en cours : seulement les autres, en fin d'envoi.
    const isHeld = (i: FlowItem) => i.status === 'doing' || (confided.includes(i.id) && i.status !== 'done' && i.status !== 'dropped')
    let room = LIMITS.items - kept.length - sent.filter(isHeld).length
    target.items = [...sent.filter(i => isHeld(i) || room-- > 0), ...kept]
    // Annoncés seulement pour les pistes que la borne a gardées, chacune nommée par son libellé entier.
    const isKept = (id: string) => target.items.some(i => i.id === id)
    const shared = renamed.filter(r => r.id === r.raw && isKept(r.id))
    if (shared.length > 0)
      itemsText += ` · items: ${shared.map(r => `${JSON.stringify(neutralRelayed(clip(r.raw, 40)))} is also the shown form of other recorded items: send each under its exact id: ${asciiJson(r.candidates)}`).join('; ')}`
    const moved = renamed.filter(r => r.id !== r.raw && isKept(r.id))
    if (moved.length > 0)
      itemsText += ` · items: ids out of form (${GROUP_ID_FORM}) recorded under new ids: ${moved.map(r => `${JSON.stringify(neutralRelayed(clip(r.raw, 40)))} (label ${JSON.stringify(neutralRelayed(r.label))}) → ${r.id}${r.candidates.length > 0 ? ` (the shown form of several recorded items, send each under its exact id: ${asciiJson(r.candidates)})` : ''}`).join(', ')}; send these items under these ids from now on`
    if (kept.length > 0) {
      log(run, now, '!', `Pistes gardées, omises de l'envoi : ${kept.map(i => i.label).join(' ; ')}`, 'warn')
      itemsText += ` · items: kept (in progress, or given to the worker without a verdict yet): ${kept.map(i => neutralRelayed(i.label)).join('; ')}; send them with their status`
    }
    for (const item of target.items) {
      const was = before.find(x => x.id === item.id)
      if (was && was.status !== item.status && (item.status === 'done' || item.status === 'dropped')) {
        log(run, now, item.status === 'done' ? '✓' : '✗', `${item.label}`, item.status === 'done' ? 'ok' : 'info')
      }
    }
    // Une fois la session lancée, un élément confié rendu « à faire » quitte l'envoi : il revient au
    // choix de la personne. Avant le lancement, « à faire » est son état normal : il reste confié.
    const linked = target === phase ? phase.linked : undefined
    if (linked?.session !== undefined) {
      // Rendus « à faire » dans cet envoi : une piste gardée parce qu'omise n'en est pas.
      const back = confidedIds(linked).filter(id => sent.find(i => i.id === id)?.status === 'todo')
      backToChoice = back.length
      if (back.length > 0) {
        const left = confidedIds(linked).filter(id => !back.includes(id))
        // La session reste notée même sans élément : elle se ferme une fois ses éléments jugés.
        phase.linked = withItems(linked, left)
        const names = back.map(id => (phase.items.find(i => i.id === id) ?? sent.find(i => i.id === id))?.label ?? id)
        log(run, now, '↩', `À choisir de nouveau, pas fait par le worker : ${names.join(' ; ')}`, 'info')
      }
    }
    // Un envoi des éléments touche la session : une fermeture arrêtée redevient à faire.
    if (target === phase && phase.linked?.closing?.state === 'stopped') phase.linked = touchedLink(phase.linked, now)
  }

  const ticketsBefore = run.tickets
  let removeText = ''
  // Un retrait qui laisse le lot sans ticket ouvert : la mission peut finir, une fois l'appel entier lu.
  let isLotRemoved = false
  const removing = (Array.isArray(input.remove) ? input.remove : []).map(x => String(x).trim()).filter(Boolean)
  if (removing.length > 0) {
    const gone = run.tickets.filter(t => removing.some(id => sameTicket(id, t.id)))
    const goneFound = (run.found ?? []).filter(f => removing.some(id => sameTicket(id, f.id)))
    const isGone = (id: string) => gone.some(t => sameTicket(t.id, id)) || goneFound.some(f => sameTicket(f.id, id))
    if (goneFound.length > 0) run.found = run.found!.filter(f => !goneFound.includes(f))
    if (gone.length > 0) {
      // Un lot ouvert avant ce retrait : seul son retrait rend l'Implémentation facultative et peut finir
      // la mission (le retrait d'un ticket fait, dans un lot déjà fini, ne change rien).
      const wasLotOpen = hasOpenLot(run)
      run.tickets = run.tickets
        .filter(t => !isGone(t.id))
        .map(t => (t.blockedBy ? { ...t, blockedBy: t.blockedBy.filter(id => !isGone(id)) } : t))
      if (run.groups) run.groups = run.groups.map(g => ({ ...g, tickets: g.tickets.filter(id => !isGone(id)) })).filter(isKeptGroup)
      if (run.queue) run.queue = run.queue.filter(id => !isGone(id))
      const names = gone.map(t => t.name)
      log(run, now, '−', `${gone.length} ticket${gone.length > 1 ? 's retirés' : ' retiré'} : ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`, 'warn')
      // Plus aucun lot ouvert : l'Implémentation que la fin d'une phase avait rendue due (miroir de
      // cette écriture, plus bas) redevient ce que la définition de la mission en dit.
      if (wasLotOpen && !hasOpenLot(run)) {
        for (const p of run.phases.slice(run.cursor + 1)) if (p.skill === 'implement' && p.status === 'pending') p.isOptional = isDefinedOptional(run, p)
        isLotRemoved = true
      }
    }
    const missed = removing.filter(id => !isGone(id))
    removeText = ` · removed ${gone.length + goneFound.length} ticket(s)${missed.length > 0 ? `; not on the dashboard: ${missed.join(', ')}` : ''}`
  }

  // Les tickets nouveaux de cet appel, et le lot d'avant : ils rejoignent un groupe en cours une fois
  // le sort des groupes reçus connu (un plan ignoré compte comme pas de plan).
  let addedIds: string[] = []
  let ticketsBeforeAdd = run.tickets
  if (tickets.length > 0) {
    // Une tâche trouvée en route que Claude envoie dans le lot : elle quitte « Trouvé en route »
    // et garde son statut connu, sauf s'il en envoie un.
    const joining = (run.found ?? []).filter(f => tickets.some(t => sameTicket(t.id, f.id)))
    const incoming = tickets.map(t => {
      const was = joining.find(f => sameTicket(f.id, t.id))
      return was && !t.status ? { ...t, status: was.status, why: t.why ?? was.why } : t
    })
    const before = run.tickets.length
    const previous = run.tickets
    const known = new Set(previous.map(t => t.id))
    run.tickets = mergeTickets(run.tickets, incoming, now, b.session)
    const added = run.tickets.length - before
    addedIds = run.tickets.filter(t => !known.has(t.id)).map(t => t.id)
    ticketsBeforeAdd = previous
    if (added > 0) log(run, now, '▦', before === 0 ? `${added} tickets suivis` : `+${added} ticket${added > 1 ? 's' : ''}`, 'accent')
    if (joining.length > 0) {
      run.found = run.found!.filter(f => !joining.includes(f))
      for (const f of joining) log(run, now, '▦', `Entré dans le lot : ${f.name}`, 'accent')
    }
  }

  const externals = externalsSent(input.externals)
  let externalText = ''
  if (externals.length > 0) {
    const kept = externalsOf(run).length
    const out = mergeExternals(externalsOf(run), externals, now)
    run.externals = out.list
    for (const x of out.lifted) log(run, now, '✓', `Dépendance externe levée : ${x.name}`, 'ok')
    for (const x of out.reopened) log(run, now, '↺', `Dépendance externe rouverte : ${x.name}`, 'warn')
    if (out.refused.length > 0) externalText = ` · externals: not recorded, the mission keeps ${out.list.length} external blockers (at most ${LIMITS.tickets}; ${kept} before this call): ${out.refused.map(x => asciiJson(x.id)).join(', ')}; the updates of the kept ones were applied`
  }

  let groupText = ''
  const parsed = Array.isArray(input.groups) ? parseGroups(run, input.groups) : null
  // Un seul groupe n'apporte rien (série 1, Q11) : le plan est ignoré avant d'être enregistré, et
  // celui en place, lancé ou non, reste tel quel (série 2, Q5). Les tickets restés hors du groupe
  // ne font pas un deuxième groupe. Le lot d'une rétro, lui, part toujours dans un worker : un
  // seul groupe y suffit.
  const isPlanKept = parsed !== null && parsed.invalid.length === 0 && parsed.groups.length >= (isRetroRun(run) ? 1 : 2)
  // Le découpage d'une rétro part en un seul appel (pistes jugées, tickets, groupes, fin de phase) :
  // un plan refusé n'en laisse rien, sinon des pistes passaient « faites » sans groupe à lancer. Un
  // détour ouvert sur la Rétro ne change rien : le lot reste celui de la rétro.
  const cutRefusal = parsed && isRetroRun(run) && phase.skill === 'retro' ? retroPlanRefusal(parsed, isPlanKept) : ''
  if (cutRefusal !== '') return refusedCut(board, `groups: plan refused: ${cutRefusal}. The items stay as they were, at the user's choice; send the whole call again with the plan fixed`)
  if (parsed && parsed.invalid.length > 0) {
    // Un plan à moitié écrit tromperait : refusé en entier, celui en place reste (D1).
    const rest = (run.groups ?? []).length > 0 ? 'the plan already in place stays' : 'no groups yet'
    groupText = ` · groups: plan refused, group ids out of form (${parsed.invalid.map(id => JSON.stringify(id)).join(', ')}): a group id has ${GROUP_ID_FORM}, nothing else; ${rest}; send the plan again with such ids`
  } else if (parsed && !isPlanKept) {
    const rest = (run.groups ?? []).length > 0 ? 'the plan already in place stays' : 'the lot is done in this discussion with /implement'
    // Des ids inconnus ont fait tomber le compte : la cause d'abord, pour que Claude renvoie le plan.
    groupText =
      parsed.unknown.length > 0
        ? ` · groups: plan ignored, ${parsed.groups.length} group(s) left once the unknown ticket ids are removed (${parsed.unknown.join(', ')}); send those tickets first, then the groups again`
        : parsed.groups.length === 1
          ? ` · groups: one group only, so no groups: ${rest}`
          : ` · groups: an empty plan is ignored: ${rest}`
  } else if (parsed) {
    // Ce que les revues ont marqué sur un groupe, et son worker, survivent à un plan renvoyé.
    // `parseGroups` a déjà ramené chaque id à celui qui est enregistré : la reprise se fait à l'id exact.
    const before = new Map((run.groups ?? []).map(g => [g.id, g]))
    // La consigne d'/implement a figé « sans groupes » à son chargement (texte écrit à un moment et lu
    // plus tard) : le premier plan enregistré pendant l'Implémentation le dit, une fois.
    // Finie trop tôt (`{"complete": true}`), l'Implémentation reste la phase en cours : sa consigne aussi.
    if (before.size === 0 && phase.skill === 'implement' && (phase.status === 'active' || phase.status === 'done')) {
      groupText += ` · groups: ${LOT_PLAN_NOTICE}`
    }
    const merged = parsed.groups.map(g => {
      const was = before.get(g.id)
      return { ...g, ...keptGroupFields(was) }
    })
    // Un groupe déjà confié à un worker (en cours, rendu, fermé, ou à l'envoi annulé) n'est
    // jamais retiré : omis, il reste à la fin (D2 (a), série 16, Q2 (b)), avec son lien et son compteur
    // d'envois (un envoi suivant au même id ne reprend pas le nom d'une branche gardée). Seul un groupe
    // en cours, ou rendu sans être fermé, garde aussi ses tickets contre le plan : sa session les
    // traite, ou sa fermeture les attend. Un groupe fermé ou à l'envoi annulé les laisse au plan, et
    // reste, même vide (série 17, Q5 (b)).
    const sent = (run.groups ?? []).filter(isSentGroup)
    const holding = sent.filter(isHoldingGroup)
    const omitted = sent.filter(g => !merged.some(f => f.id === g.id))
    const held = new Map(holding.flatMap(g => g.tickets.map(t => [t, g.id] as const)))
    const moved = new Set<string>()
    const fresh = merged.map(g => {
      const own = holding.find(u => u.id === g.id)?.tickets ?? []
      const tickets = [...own, ...g.tickets.filter(t => !own.includes(t))].filter(t => {
        const holder = held.get(t)
        if (holder !== undefined && holder !== g.id) moved.add(`${t} stays in ${holder}`)
        return holder === undefined || holder === g.id
      })
      return { ...g, tickets }
    })
    // Un ticket dans un seul groupe : celui qu'un groupe fermé omis avait et que le plan donne ailleurs le quitte.
    const claimed = new Set(fresh.flatMap(g => g.tickets))
    const kept = omitted.map(g => (isHoldingGroup(g) ? g : { ...g, tickets: g.tickets.filter(t => !claimed.has(t)) }))
    run.groups = [...fresh.filter(isKeptGroup), ...kept]
    log(run, now, '▦', `Plan : ${parsed.groups.map(g => `${g.id} (${g.tickets.length})`).join(', ')}`, 'accent')
    if (omitted.length > 0) {
      const why = (g: TicketGroup) =>
        g.linked !== undefined ? 'in flight' : g.delegated === undefined ? 'send cancelled, its number kept' : isClosedLink(g.delegated) ? 'returned and closed' : 'returned, not closed'
      log(run, now, '!', `Groupes gardés hors du nouveau plan, déjà confiés à un worker : ${omitted.map(g => g.id).join(', ')}`, 'warn')
      groupText += ` · groups: kept at the end of the plan, as they were sent to a worker: ${omitted.map(g => `${shownGroupId(g.id)} (${why(g)})`).join(', ')}`
    }
    if (moved.size > 0) groupText += ` · groups: tickets kept with a group whose worker is in flight or not closed: ${[...moved].join(', ')}`
    if (parsed.merged.length > 0) groupText += ` · groups: ids that differ only by case name one group, tickets merged: ${parsed.merged.join(', ')}`
    if (parsed.unknown.length > 0) {
      log(run, now, '!', `Groupes : tickets inconnus ignorés (${parsed.unknown.slice(0, 3).join(', ')})`, 'warn')
      groupText += ` · groups: unknown ticket ids ignored (${parsed.unknown.join(', ')}); send those tickets first`
    }
    const wide = wideFolders(run, run.groups)
    if (wide.length > 0) {
      groupText += ` · groups: ${wide.slice(0, 3).join('; ')}${wide.length > 3 ? '…' : ''}. A folder blocks every group that names a file inside it: list the files the group really touches instead, unless it creates files in that folder`
    }
    const disorder = lettersOutOfOrder(run)
    if (disorder.length > 0) {
      groupText += ` · groups: letters out of execution order: ${disorder.join('; ')}; letter the groups in the order they run (A first) and send the plan again with the new ids`
    }
  }
  if (addedIds.length > 0 && !isPlanKept) placeInRunningGroup(run, addedIds, ticketsBeforeAdd, now)

  const changes = parseChanges(input.set)
  if (changes.length > 0) setTickets(run, changes, now, b.session)
  // Une tâche trouvée en route change aussi de statut par `set`, sans entrer dans le lot.
  if (changes.length > 0 && (run.found ?? []).length > 0) setFound(run, changes, now)
  restartTicketSteps(run, ticketsBefore, now)

  // Les groupes que leurs workers ont rendus (leurs statuts arrivent dans `set`).
  let returnText = ''
  const returned: string[] = []
  if (input.returned !== undefined) {
    const back = returnGroups(run, input.returned, now, opts.relay)
    if (back.unknown.length > 0) returnText = ` · returned: no group in a worker among ${back.unknown.join(', ')}`
    returned.push(...back.back)
    // L'avis « conseillée » relayé par le worker, reçu ici alors que la revue est désactivée : sa marque.
    for (const g of run.groups ?? []) if (back.back.includes(g.id)) g.security = markSecurityOff(g.security, opts.security, now)
  }

  // Des groupes finis relus ailleurs (leur worker, après leur retour) : la revue vaut ici.
  let reviewedText = ''
  if (input.reviewed !== undefined) {
    const ids = (Array.isArray(input.reviewed) ? input.reviewed : []).filter(x => String(x).trim() !== '')
    const marked: string[] = []
    const refused: string[] = []
    const waiting: string[] = []
    const inFlight: string[] = []
    for (const id of ids) {
      const g = sentGroupOf(run, id)
      // En vol après une remise à zéro (renvoi, ou premier envoi d'un groupe relu) : une revue qui arrive maintenant peut être celle d'avant l'envoi.
      if (g && isResentInFlight(g)) inFlight.push(`group ${shownGroupId(g.id)} ${inFlightWhy(g)}: send its review with its return`)
      else if (!g || !isAllDone(run, g.tickets)) refused.push(shownGroupId(id))
      else if (!isGroupDone(run, g))
        waiting.push(`group ${shownGroupId(g.id)} not finished, still open (attached to it by the plan): ${openAttachedOf(run, g).join(', ')}${hasGroupReview(g) ? ' (its review date is kept and counts once they are done)' : ''}`)
      else if (!hasGroupReview(g)) {
        g.reviewedAt = now
        marked.push(g.id)
      }
    }
    if (marked.length > 0) log(run, now, '◆', `Revue du groupe faite ailleurs : ${marked.join(', ')}`, 'accent')
    if (refused.length > 0) reviewedText = ` · reviewed: no finished group among ${refused.join(', ')}`
    if (waiting.length > 0) reviewedText += ` · reviewed: ${waiting.join('; ')}; send it once they are done`
    if (inFlight.length > 0) reviewedText += ` · reviewed: ${inFlight.join('; ')}; nothing recorded`
  }
  // Après `reviewed` : une revue que le compte rendu de la session confirme, envoyée avec `returned`, vaut.
  const unreviewed = returned.filter(id => {
    const g = run.groups!.find(x => x.id === id)
    return g !== undefined && !isGroupReviewed(run, g)
  })
  // Un rattaché ouvert : « reviewed » serait refusé ; il se dit avec ce qu'il attend.
  const waitingAttached = unreviewed.filter(id => openAttachedOf(run, run.groups!.find(x => x.id === id)!).length > 0)
  if (waitingAttached.length > 0)
    returnText += ` · returned with tickets the plan attaches to it still open: ${waitingAttached.map(id => `${shownGroupId(id)} (${openAttachedOf(run, run.groups!.find(x => x.id === id)!).join(', ')})`).join('; ')}: send {"reviewed": [...]} for it only once they are done, if its final report says the group review ran there`
  if (unreviewed.some(id => !waitingAttached.includes(id))) {
    const ids = unreviewed.filter(id => !waitingAttached.includes(id)).map(id => asciiJson(id)).join(', ')
    returnText += ` · returned without a /code-review relayed by its worker: ${unreviewed.filter(id => !waitingAttached.includes(id)).map(shownGroupId).join(', ')}. If its final report says the group review ran there, send {"reviewed": [${ids}]}: the review button then goes away. Otherwise the group still needs its review, in its worker (its branch is merged here): tell the user, the dashboard's « Revue du groupe · worker » button asks for it`
  }

  const review = input.review !== null && typeof input.review === 'object' ? (input.review as Record<string, unknown>) : null
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
  let reviewReply = ''
  if (review) {
    const st = count(review.standards)
    const sp = count(review.spec)
    // Un compte de bogues hors forme n'est pas noté, au lieu de valoir 0 (`isBugCount`), et la réponse le dit.
    const bugs = isBugCount(review.bugs) ? review.bugs : undefined
    if (review.bugs !== undefined && bugs === undefined) reviewReply = ` · bugs ignored: ${BUGS_REFUSED}; the rest of this review is recorded: do not send it again, put the bug count in your report`
    // De même pour les constats de la relecture du fond et de la forme : absents ou hors forme, jamais 0.
    const form = isBugCount(review.form) ? review.form : undefined
    if (review.form !== undefined && form === undefined) reviewReply += ` · form ignored: ${BUGS_REFUSED}; the rest of this review is recorded: do not send it again, put the form count in your report`
    const reviewGroup = typeof review.group === 'string' ? str(review.group) : typeof review.group === 'number' ? String(review.group) : ''
    const fixed = count(review.fixed)
    const stats = phase.stats
    stats.reviews = (stats.reviews ?? 0) + 1
    stats.standards = Math.max(0, stats.standards) + st
    stats.spec = Math.max(0, stats.spec) + sp
    stats.fixed = (stats.fixed ?? 0) + fixed
    // Posé à la première relecture qui en envoie, jamais touché par une revue qui n'en envoie pas.
    if (form !== undefined) stats.form = addedCount(stats.form, form)
    const what = reviewGroup !== '' && recordedGroup(run, reviewGroup) ? `Revue du groupe ${recordedGroup(run, reviewGroup)!.id}` : 'Revue'
    log(run, now, '◈', `${what} : ${st} Standards · ${sp} Spec${bugsText(bugs)}${formText(form)}${fixed > 0 ? ` · ${fixed} corrigé${fixed > 1 ? 's' : ''}` : ''}`, st + sp + (bugs ?? 0) + (form ?? 0) > fixed ? 'warn' : 'ok')
    reachStep(phase, 'review', now)
  }

  const security = input.security !== null && typeof input.security === 'object' ? (input.security as Record<string, unknown>) : null
  let securityReply = ''
  let securityGroup: string | null = null
  // Un id en chiffres peut arriver en nombre ; tout autre type n'est pas un id : refusé, jamais un repli.
  const sentGroup = security?.group
  const named = typeof sentGroup === 'string' ? str(sentGroup) : typeof sentGroup === 'number' ? String(sentGroup) : ''
  const isBadGroup = sentGroup !== undefined && typeof sentGroup !== 'string' && typeof sentGroup !== 'number'
  const sentTarget = named !== '' ? sentGroupOf(run, sentGroup) : undefined
  const isUnknownGroup = named !== '' && !sentTarget
  const outOfRange = security ? unreadableCounts(security) : []
  if (security && isBadGroup) {
    securityReply = ` · security: "group" must be a group id (a string), not ${JSON.stringify(sentGroup)}; nothing recorded`
  } else if (security && isUnknownGroup) {
    const ids = (run.groups ?? []).map(g => shownGroupId(g.id))
    securityReply = ` · security: no group ${asciiJson(typeof sentGroup === 'string' ? sentGroup : named)} in this mission (${ids.length > 0 ? `groups: ${ids.join(', ')}` : 'no groups: send it without "group" for the whole lot'}); nothing recorded`
  } else if (security && named === '' && (run.groups ?? []).length > 0 && securityGroupOf(run, '') === null) {
    // Une mission à groupes sans groupe fini (rattachés compris) : l'avis n'irait qu'au lot, que rien ne lit alors.
    securityReply = ` · security: no finished group to give it to (groups: ${run.groups!.map(g => shownGroupId(g.id)).join(', ')}); send it with "group"; nothing recorded`
  } else if (security && outOfRange.length > 0) {
    securityReply = ` · security: refused, counts out of range (${outOfRange.join(', ')}): each is a whole number from 0 to ${BUGS_MAX}; nothing recorded`
  } else if (security && isResentInFlight(sentTarget ?? (named === '' ? securityGroupOf(run, '') : null))) {
    // En vol après une remise à zéro (renvoi, ou premier envoi d'un groupe relu) : un avis qui arrive maintenant
    // peut être celui d'avant l'envoi ; posé sur l'envoi en cours, il le clorait sans sa propre revue de sécurité.
    // Un premier envoi en vol d'un groupe parti sans revue ni avis garde l'avis envoyé d'ici, qui l'emporte sur le relais (inchangé).
    const target = (sentTarget ?? securityGroupOf(run, ''))!
    securityReply = ` · security: group ${shownGroupId(target.id)} ${inFlightWhy(target)}: its security advice and counts come with its return (send them with "returned"); nothing recorded`
  } else if (security) {
    const group = sentTarget ?? securityGroupOf(run, '')
    securityGroup = group?.id ?? null
    // Le lot sans groupes, l'avis enregistré antérieur à la dernière fin de ticket ou à la dernière revue du lot : seul un avis (`advised`)
    // ouvre le nouveau passage, et repart de zéro, les comptes de l'ancien au journal ; l'avis est remplacé
    // par celui reçu, jamais effacé ni réécrit vide. Un autre envoi (des comptes ou des failles laissées
    // arrivés en retard, une raison seule) va sur l'avis enregistré sans le dater du passage : il ne
    // tranche rien pour lui.
    const isOldAdvice = !group && isLotAdvicePrevious(run)
    const isNewPass = isOldAdvice && typeof security.advised === 'boolean'
    if (isNewPass) logPreviousLotSecurity(run, now)
    const was = (group ? group.security : isNewPass ? {} : run.security) ?? {}
    const next: SecurityCheck = { ...was }
    // Chaque envoi de sécurité du lot le date, même un envoi qui ne change que les comptes ; sur l'avis
    // d'un passage précédent, il garde la date qu'il a (celle de sa revue pour un avis sans date).
    if (!group) next.at = isOldAdvice && !isNewPass ? (lotAdviceTimeOf(run) ?? 0) : now
    if (typeof security.advised === 'boolean') next.isAdvised = security.advised
    const why = clip(str(security.why), 160)
    if (why) next.why = why
    // Les comptes envoyés sont en forme (sinon l'envoi est refusé plus haut). L'envoi qui ouvre un nouveau
    // passage du lot n'en prend aucun : ils viennent d'une revue de sécurité lancée avant cet avis, qui ne
    // compte pas pour lui ; ceux d'une revue lancée après suivent dans un autre envoi.
    const isCountsDropped = isNewPass && (security.findings !== undefined || security.fixed !== undefined || security.dismissed !== undefined)
    const findings = isNewPass ? undefined : (security.findings as number | undefined)
    const fixedSent = isNewPass ? undefined : (security.fixed as number | undefined)
    const hasCounts = findings !== undefined || fixedSent !== undefined
    if (hasCounts) {
      // Un compte absent de l'envoi garde sa valeur : « fixed » seul ne remet pas les failles à zéro.
      if (findings !== undefined) next.findings = findings
      next.fixed = fixedSent ?? next.fixed ?? 0

      // Un résultat sans lancement vu (une autre discussion, un nom de commande inattendu) le vaut.
      if (next.ranAt === undefined) next.ranAt = now
    }
    // Les failles laissées par la personne : un envoi qui les nomme les change ; un envoi qui change
    // les failles gardées sans elles les remet à 0 (une nouvelle revue, d'autres failles) ; un envoi
    // des mêmes comptes les garde. Elles ne disent pas que la revue a tourné.
    const dismissed = isNewPass ? undefined : (security.dismissed as number | undefined)
    const isNewFindings = findings !== undefined && was.findings !== undefined && findings !== was.findings
    if (dismissed !== undefined) next.dismissed = dismissed
    else if (isNewFindings && next.dismissed !== undefined) next.dismissed = 0
    // Un renvoi des comptes (celui que la réponse demande) répare un « dismissed » relu hors forme
    // qu'il ne nomme pas : aucune faille laissée, comme la réponse le dit. Un « findings » ou un
    // « fixed » illisible non renvoyé le reste (jamais écrit 0), et la réponse le redemande.
    if (hasCounts && next.dismissed !== undefined && !isSecurityCount(next.dismissed)) delete next.dismissed
    // Seul un envoi d'ici tranche : la proposition d'un worker tombe, comme après d'autres failles.
    if (dismissed !== undefined || isNewFindings) delete next.proposedDismissed
    // Un avis « conseillée » reçu alors que la revue est désactivée pour le projet : sa marque.
    const marked = security.advised === true ? markSecurityOff(next, opts.security, now)! : next
    if (group) group.security = marked
    else run.security = marked
    // Un avis « conseillée » gardé sans comptes, la revue relue « désactivée » : la réponse le dit, pour que la
    // discussion ne lance pas de relecteur sur une consigne chargée avant le clic.
    const isOffNotice = security.advised === true && opts.security === 'off' && isAdvisedUnrun(marked)
    const who = group ? `${shownGroupId(group.id)} : ` : ''
    const isOpen = !isSecuritySettled(next)
    const target = group ? `group ${shownGroupId(group.id)}` : 'the lot'
    if (isOffNotice) securityReply = ` · security of ${target}: ${SECURITY_OFF_REPLY.replace('<unit>', group ? 'le groupe' : 'le lot')}`
    if (next.findings !== undefined && (hasCounts || dismissed !== undefined)) securityReply = ` · security of ${target}: ${securityCounts(next)}`
    else if (dismissed !== undefined) securityReply = ` · security of ${target}: ${dismissed} dismissed, kept, but its review has sent no counts yet (send "findings" and "fixed")`
    // Le lot encore à relire : un avis ne compte qu'après sa revue, et une revue de sécurité lancée avant elle non plus.
    const reviewFirst = needsReview(run) ? '; the lot needs its review first (/code-review): an advice, and a security review, count only when they come after it' : ''
    if (isNewPass)
      securityReply += ` · security of the lot: new pass (the recorded advice precedes the last ticket end or the last lot review): the counts of the previous pass no longer count; this advice starts the new pass${isCountsDropped ? '; the counts sent with it are not recorded (a security review launched before this advice does not count): send those of a security review launched after it' : ''}${reviewFirst}`
    else if (isOldAdvice)
      securityReply += ` · security of the lot: the recorded advice is older than the last ticket end or the last lot review: this send is kept on it and settles nothing for the current pass; ${reviewFirst ? 'review the lot first (/code-review), then send' : 'send'} this pass's advice ("advised"), then the counts of a security review launched after it (one launched before does not count: relaunch it)`
    if (hasCounts && hasUnreadableCounts(next)) {
      log(run, now, '⛨', `Sécurité ${who}comptes relus hors forme, à renvoyer`, 'warn')
    } else if (hasCounts) {
      log(run, now, '⛨', `Sécurité ${who}${next.findings} constat${next.findings! > 1 ? 's' : ''}${next.fixed! > 0 ? ` · ${next.fixed} corrigé${next.fixed! > 1 ? 's' : ''}` : ''}${(next.dismissed ?? 0) > 0 ? ` · ${next.dismissed} laissée${next.dismissed! > 1 ? 's' : ''}` : ''}`, isOpen ? 'warn' : 'ok')
    } else if (dismissed !== undefined) {
      log(run, now, '⛨', `Sécurité ${group ? `du groupe ${group.id}` : 'du lot'} : ${dismissed} laissée${dismissed > 1 ? 's' : ''}`, isOpen ? 'warn' : 'ok')
    } else if (typeof security.advised === 'boolean') {
      log(run, now, '⛨', `Sécurité ${who}${security.advised ? 'revue conseillée' : 'revue jugée inutile'}${why ? ` (${why})` : ''}`, security.advised ? 'accent' : 'info')
    }
  }

  // Les groupes que cet appel touche : une fermeture arrêtée avant redevient à faire (S3).
  const touched = new Set<string>([...returned, ...(securityGroup ? [securityGroup] : [])])
  if (input.returned !== undefined) for (const id of Array.isArray(input.returned) ? input.returned : []) touched.add(String(id).trim().toLowerCase())
  if (input.reviewed !== undefined) for (const id of Array.isArray(input.reviewed) ? input.reviewed : []) touched.add(String(id).trim().toLowerCase())
  for (const g of run.groups ?? []) {
    if (changes.some(c => g.tickets.some(t => sameTicket(t, c.id))) || review) touched.add(g.id)
  }
  const touchedIds = new Set([...touched].map(id => id.toLowerCase()))
  for (const g of run.groups ?? []) {
    const hasStopped = g.delegated?.closing?.state === 'stopped' || earlierOf(g.delegated).some(x => x.closing?.state === 'stopped')
    if (g.delegated && hasStopped && touchedIds.has(g.id.toLowerCase())) g.delegated = touchedLink(g.delegated, now)
  }
  const closedText = applyClosed(run, input.closed, now, b.root, opts.security)
  // La session de pistes fermée par cet appel : la suite de la rétro arrive avant son `complete`.
  extendActive(run)
  // Le découpage d'une rétro attend la fermeture de sa session de pistes (celle de cet appel compte) :
  // un lot reçu avant finirait, avec une mission restée à sa seule phase, dans une mission « terminée ».
  if (isRetroRun(run) && phase.skill === 'retro' && holdsItemsSession(phase) && (tickets.length > 0 || Array.isArray(input.groups))) {
    return refusedCut(board, `tickets and groups: refused, the pistes session of this retro is not closed yet: ${heldRemedy(phase)}. Once it is closed, send the whole call again`)
  }

  let withdrawnText = ''
  for (const w of reportedWithdrawals(input)) {
    // Un choix relayé par un worker et pas encore gardé ici se garde, retiré. Il est gardé
    // neutralisé, et son retrait peut arriver tel que la session l'a écrit : les deux formes comptent.
    const isIt = (what: string) => isSameRelayedChoice(what, w.what)
    const relayed = relayedDecisions(run, isRelay(opts.relay, run.id) ? opts.relay : null).find(d => isIt(d.what))
    if (relayed) keepDecisions(run, [relayed])
    const kept = (run.decided ?? []).find(d => isIt(d.what) && d.withdrawnAt === undefined)
    if (!kept) {
      withdrawnText += ` · "withdrawn": no choice in force reads "${w.what}" (send it as it was declared)`
      continue
    }
    const isReplacing = w.replacedBy !== undefined && !(run.decided ?? []).some(x => x !== kept && sameChoice(x.what, w.replacedBy!) && x.withdrawnAt === undefined)
    // Au plafond, le remplaçant ne tiendrait pas : le choix d'origine reste en vigueur, et la réponse le dit.
    const refusal = isReplacing ? choiceRefusal(run) : ''
    if (refusal !== '') {
      withdrawnText += ` · "withdrawn": "${clip(w.what, 60)}" kept in force, its replacement "${clip(w.replacedBy!, 60)}": ${refusal}`
      continue
    }
    kept.withdrawnAt = now
    kept.withdrawnWhy = w.replacedBy ? `${w.why ? `${w.why} ; ` : ''}remplacé par « ${w.replacedBy} »` : w.why
    log(run, now, '⚑', `Choix retiré : ${kept.what}${w.why ? ` (${w.why})` : ''}`, 'info')
    if (isReplacing) {
      run.decided = keepChoices([...(run.decided ?? []), { at: now, what: w.replacedBy!, ...(w.why ? { why: w.why } : {}) }], choiceRoom(run))
      log(run, now, '⚑', `Décidé sans toi : ${w.replacedBy!}`, 'warn')
    }
  }
  let decidedText = ''
  const ignored = ignoredOrigins(input)
  if (ignored.length > 0) decidedText += ` · decided: origin ${ignored.map(o => JSON.stringify(o)).join(', ')} ignored (one of ${Object.keys(ORIGIN_LABELS).join(', ')}); the choice is kept without it`
  let refusedChoices = 0
  for (const d of reportedDecisions(input)) {
    // Le même choix renvoyé deux fois n'est compté qu'une fois.
    if ((run.decided ?? []).some(x => x.what === d.what)) continue
    if (choiceRefusal(run) !== '') {
      refusedChoices += 1
      continue
    }
    run.decided = keepChoices([...(run.decided ?? []), { at: now, what: d.what, ...(d.why ? { why: d.why } : {}), ...(d.origin ? { origin: d.origin } : {}) }], choiceRoom(run))
    log(run, now, '⚑', `Décidé sans toi : ${d.what}`, 'warn')
  }
  if (refusedChoices > 0) decidedText += ` · decided: ${refusedChoices} choice(s) refused: ${choiceRefusal(run)}`
  // Au passage des 200 choix, relayés compris, l'auto se met en pause au lieu d'en couper.
  pauseAtChoiceLimit(run, choicesBefore, (run.decided ?? []).length + relayedDecisions(run, choiceRelay).length, now)

  const waitingText = input.waiting !== undefined ? applyWaiting(run, input.waiting, now) : ''

  const note = str(input.note)
  if (note) log(run, now, '✎', note, 'info')

  // Le compte rendu ne se valide que dans le panneau, par la personne.
  const isReportGate = input.complete === true && !detour && phase.skill === 'compte-rendu'
  // Un groupe fini n'est pas la fin de la phase : elle reste ouverte tant que des tickets du lot le sont.
  const stillOpen = run.tickets.filter(t => t.status !== 'done')
  const isTicketGate = input.complete === true && !detour && phase.skill === 'implement' && stillOpen.length > 0
  // « Version et push » est une seule phase : la fin de /project:version n'en est que la moitié.
  const isPushGate = input.complete === true && !detour && phase.skill === 'project:version' && !isPushed(phase)
  // Des pistes confiées à un worker et pas encore rendues : la phase attend sa note de fin.
  const inFlight = !detour ? linkedInFlight(phase) : []
  // Rendus au choix dans le même appel : la personne les rechoisit avant toute clôture.
  // La session des éléments, ses éléments jugés, se ferme avant la clôture : après, plus de mission active pour la noter.
  const isClosingGate = input.complete === true && !detour && (isItemsCloseCandidate(phase) || phase.linked?.closing?.state === 'app')
  const isLinkedGate = input.complete === true && (inFlight.length > 0 || backToChoice > 0 || isClosingGate)
  if (input.complete === true && !isReportGate && !isTicketGate && !isPushGate && !isLinkedGate) {
    if (detour) {
      finishDetour(detour, now)
      log(run, now, '✓', `Détour terminé : ${def.label}`, 'ok')
      fx.toasts.push(`✓ ${def.label} ${agree(def, 'terminé')}`)
    } else if (phase.status === 'active') {
      finishPhase(phase, now)
      log(run, now, '✓', `${def.label} ${agree(def, 'terminé')}`, 'ok')
      // Une phase qui laisse un lot pas fini (`hasOpenLot`) : l'Implémentation qui suit se montre due.
      if (hasOpenLot(run)) for (const p of run.phases.slice(run.cursor + 1)) if (p.skill === 'implement') p.isOptional = false
      // Une rétro sans ticket n'a pas de lot : les phases facultatives qui suivent ne servent qu'à lui.
      const isLast = run.cursor === run.phases.length - 1 || (phase.skill === 'retro' && run.tickets.length === 0 && isRunComplete(run))
      if (isLast) {
        run.status = 'done'
        run.finishedAt = now
        delete run.waitsUser
        stopAuto(run, now, AUTO_STOPS.finished)
        log(run, now, '★', 'Mission terminée', 'ok')
        fx.toasts.push(`★ Mission terminée : ${run.title}`)
      } else {
        const next = suggestionsFor(run, opts).primary
        fx.toasts.push(`✓ ${def.label} ${agree(def, 'terminé')}${next ? ` · suite : ${SKILLS[next]!.label}` : ''}`)
      }
    }
  }
  // Le lot retiré en entier, la phase en cours faite et plus rien de dû : la mission se termine comme
  // une rétro sans ticket (un lot ajouté par le même appel le retient).
  if (isLotRemoved && run.status === 'active' && phase.status === 'done' && !hasOpenLot(run) && isRunComplete(run)) {
    run.status = 'done'
    run.finishedAt = now
    delete run.waitsUser
    stopAuto(run, now, AUTO_STOPS.finished)
    log(run, now, '★', 'Mission terminée', 'ok')
    fx.toasts.push(`★ Mission terminée : ${run.title}`)
  }

  run.updatedAt = now
  const gateText = isReportGate
    ? ' · the report is validated by the user from the dashboard (✓ Valider le rapport), not by you: wait for it'
    : isTicketGate
      ? ` · not finished: ${stillOpen.length} ticket(s) of the lot still open (${stillOpen.slice(0, 4).map(t => t.name).join('; ')}${stillOpen.length > 4 ? '…' : ''}). A finished group is not the end of the phase: tell the user to launch the next group from the dashboard, in its worker (↗ Worker), not /flow-board:compte-rendu nor the delivery`
      : isPushGate
        ? ' · version done; the phase stays open until /project:push, which the user runs: tell them to run it, or to close the mission from the dashboard (✓ Clore la mission) if they deliver no further'
        : isLinkedGate
          ? inFlight.length === 0 && backToChoice === 0
            ? ' · not finished: the worker of the items is not closed yet. Close it first by the procedure under « Close now » below (or, once the user archived it in the app, by the line « To archive in the app »), send {"closed": [...]} with its result, then complete (a stopped closing lets you complete)'
            : inFlight.length === 0
            ? ` · not finished: ${backToChoice} item(s) just went back to the user's choice (todo). Do not complete: tell the user, who sends them again or decides to give them up`
            : phase.linked?.session === undefined
            ? ` · not finished: ${inFlight.length} item(s) sent to a worker that was never launched (${inFlight.slice(0, 4).map(i => i.label).join('; ')}${inFlight.length > 4 ? '…' : ''}). Do not mark them done or dropped: launch the session, or tell the user, who resends the request or cancels the send from the dashboard (« Redemander », « Annuler »)`
            : ` · not finished: ${inFlight.length} item(s) still being applied by the worker (${inFlight.slice(0, 4).map(i => i.label).join('; ')}${inFlight.length > 4 ? '…' : ''}). Wait for its final note, check its work, send the full items list with each status (done if done and checked; todo if not done: it goes back to the user's choice; dropped only when the user gives it up), then complete unless some went back to todo`
          : ''
  // Une session lancée a des éléments : Claude ne les voit pas passer « doing », il le lit ici.
  const withSession = !isLinkedGate && phase.linked?.session !== undefined ? inFlight : []
  const linkedText =
    withSession.length > 0
      ? ` · with the worker until its final note, keep them "doing" in any items list: ${withSession.slice(0, 4).map(i => i.label).join('; ')}${withSession.length > 4 ? '…' : ''}`
      : ''
  return { board: b, fx, text: `${summaryOf(run)}${namedText}${fixText}${removeText}${itemsText}${externalText}${groupText}${returnText}${reviewedText}${reviewReply}${securityReply}${closedText}${gateText}${linkedText}${withdrawnText}${decidedText}${waitingText}` }
}

// ─── Groupes confiés à des workers ─────────────────────────────────

/** Un groupe qu'un worker peut prendre : prêt, pas déjà confié, sans ticket en cours ici. */
export const isDelegable = (v: GroupView): boolean =>
  !v.isFallback && v.state === 'ready' && !v.isDelegated && v.open.length > 0 && !v.open.some(t => t.status === 'doing')

/**
 * Le panneau confie des groupes prêts à des workers, un par groupe : la mission reste
 * dans cette discussion, qui suit les sessions et rend les statuts de leurs tickets à leur note de
 * fin. Un groupe commencé ici peut partir pour ses tickets restants, pas avec un ticket en cours.
 */
export const startLinkedGroups = (board: Board, ids: readonly string[], now: number): Outcome => {
  const run0 = activeRun(board)
  const plan = run0 ? groupPlan(run0) : null
  if (!run0 || !plan) return null
  // Un id hors forme, enregistré avant la règle (D1), ne se lance pas : sa session ne se fermerait
  // jamais d'office, la procédure refusant son nom de worktree (série 16, Q3).
  const picked = ids.filter(id => isGroupId(id) && plan.groups.some(v => v.group.id === id && isDelegable(v)))
  if (picked.length === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  sendGroups(run, picked, now)
  // Relancé (par la personne, après la question d'un renvoi de trop) : la question du mode auto a sa réponse.
  for (const id of picked) for (const q of readWaiting(run).filter(x => x.id.startsWith(`${RELAUNCH_PREFIX}${id}#`))) withdrawQuestion(run, q.id, now)
  const fx = noFx()
  enterImplementation(run, now, fx)
  run.updatedAt = now
  return { board: b, fx }
}

/**
 * « ↻ Relancer la fermeture » sur un groupe rendu dont la fermeture s'est arrêtée : elle redevient
 * à faire, et la réponse de l'outil la repropose. Rien pour une fermeture faite ou à archiver.
 */
export const askCloseLinkedGroup = (board: Board, id: string, now: number): Outcome => {
  const was = activeRun(board)?.groups?.find(g => g.id === id)
  if (!was?.delegated || was.delegated.closing?.state !== 'stopped' || (was.delegated.closeAskedAt ?? 0) > was.delegated.closing.at) return null
  // Un ticket que le plan lui rattache est encore ouvert : la fermeture attend, même relancée d'un ancien rendu du panneau.
  if (openAttachedOf(activeRun(board)!, was).length > 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.groups = run.groups!.map(g => (g.id === id ? { ...g, delegated: withCloseAsked(g.delegated!, now) } : g))
  log(run, now, '↻', `Fermeture de la session et du worktree du groupe ${id} relancée`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

// ─── Fermeture des groupes rendus ─────────────────────────────────────────
//
// Un groupe rendu, relu et à la sécurité tranchée est clos : la réponse de l'outil le liste « à
// fermer maintenant », avec la procédure de `closing.ts`, et Claude rapporte le résultat (`closed`).
// Invariant : l'état de fermeture d'un groupe n'est jamais perdu ni reculé par un renvoi des
// groupes, un retour, une reprise ou une fusion de copies : un groupe noté fermé ne redevient
// jamais à fermer, et seul un nouvel envoi de `closed` pour ce groupe le change.

/** Ce qui manque à un groupe rendu pour être clos, du côté que le tableau de bord voit : vide s'il l'est. */
const closeMissing = (run: Run, g: TicketGroup, review: SecurityReview = 'on'): string[] => {
  const missing: string[] = []
  if (!isGroupReviewed(run, g)) {
    // Un `reviewed` refusé tant qu'un ticket était ouvert : rappelé une fois le groupe fini.
    missing.push(isGroupDone(run, g) ? `its group review (if its worker ran it, send {"reviewed": [${asciiJson(g.id)}]})` : 'its group review, once its tickets are done')
  }
  const sec = g.security
  // Sans logique ni zone sensible et sans aucun envoi de sécurité, sa sécurité est réputée tranchée ;
  // un envoi explicite, lui, l'emporte (Mathis, 30/10/2026) : rien ne se ferme plus tôt qu'avant.
  if (sec === undefined && isNoLogicGroup(run, g)) return missing
  if (sec && typeof sec === 'object' && hasUnreadableCounts(sec)) {
    missing.push(
      `its security counts read back out of form (${unreadableCounts(sec).join(', ')}; each must be a whole number from 0 to ${BUGS_MAX}): send {"security": {"group": ${asciiJson(g.id)}, "findings": <kept findings>, "fixed": <fixed>}} again, with "dismissed" if some are left unfixed (an unreadable "dismissed" not sent again counts as 0)`,
    )
  } else if (!isSecuritySettledFor(sec, review, isClosedTurnedOff(g))) {
    if (sec?.findings !== undefined) {
      const open = sec.findings - (sec.fixed ?? 0) - (sec.dismissed ?? 0)
      const proposal = sec.proposedDismissed !== undefined ? ` — its worker proposes ${sec.proposedDismissed} dismissed: confirm with the user, then send {"security": {"group": ${asciiJson(g.id)}, "dismissed": <n>}}` : ''
      missing.push(`a decision on ${open} kept security finding(s) (fixed or dismissed)${proposal}`)
    } else if (sec?.ranAt !== undefined) missing.push('the counts of its security review (findings, fixed)')
    else if (sec?.isAdvised === true) missing.push('the security review it was advised')
    else missing.push('the security advice')
  }
  return missing
}

/**
 * La session d'un groupe rendu travaille encore : le relais montre une activité postérieure à son
 * dernier compte rendu déposé (S1, signe (a)). Sans compte rendu au relais, rien ne se mesure.
 */
const isStillActive = (relay: Relay | null, g: TicketGroup, plan: readonly TicketGroup[] | undefined, link: { at: number } | undefined = g.delegated, until = Infinity): boolean => {
  const relayed = relayForGroup(relay, g, plan, link as GroupLink | undefined, until)
  if (relayed?.report === undefined || relayed.last === undefined) return false
  // Une date relue hors forme ne mesure rien : dans le doute, la session compte encore active.
  if (!isTime(relayed.report.at) || !isTime(relayed.last.at) || (relayed.endedAt !== undefined && !isTime(relayed.endedAt))) return true
  if (relayed.last.kind === 'report' || relayed.last.at <= relayed.report.at) return false
  // Une session terminée après ce travail ne travaille plus.
  return relayed.endedAt === undefined || relayed.endedAt < relayed.last.at
}

/**
 * La date du compte rendu de la session que la fermeture vise, s'il est au relais ; undefined sinon. Sans lui, la
 * fermeture ne lance jamais `claude rm` (invariant de `closingProcedure`). Au relais veut dire :
 * - déposé par cette session même : l'entrée qui le porte a pour id son id de session, dont l'id court de son
 *   lancement par `claude --bg` (`link.session`, 8 signes au moins) est le début ; un id inconnu, ou celui d'une
 *   session de l'app (`local_…`), ne se rapproche d'aucune entrée : absent ;
 * - entier, ou coupé avec son fichier (`isWhole`) ; un texte de `REPORT_MAX` signes ou plus sans longueur notée
 *   (une entrée d'une version qui le coupait sans le dire) compte comme coupé sans fichier : absent ;
 * - relais lisible et de cette mission.
 * `link` et `until` : la fenêtre d'un envoi, comme pour `isStillActive`.
 */
export const relayedReportAt = (relay: Relay | null, g: TicketGroup, plan: readonly TicketGroup[] | undefined, link: { at: number; session?: string } | undefined = g.delegated, until = Infinity): number | undefined => {
  const session = link?.session
  if (typeof session !== 'string' || session.length < 8 || session.startsWith('local_')) return undefined
  const relayed = relayForGroup(relay, g, plan, link as GroupLink | undefined, until)
  const report = relayed?.report
  if (report === undefined || report === null || typeof report !== 'object' || !isTime(report.at) || typeof report.text !== 'string') return undefined
  const by = relayed!.reportSession
  if (typeof by !== 'string' || !by.toLowerCase().startsWith(session.toLowerCase())) return undefined
  const isWhole = report.isWhole === true || (report.length === undefined && report.text.length < REPORT_MAX)
  return isWhole ? report.at : undefined
}

/**
 * Une fermeture gardée faute de compte rendu (`isKeptForReport`) dont le compte rendu est au relais : elle se repropose
 * d'elle-même, et la suivante lance `claude rm`. Sans comparer les dates : un compte rendu déposé entre la demande du
 * point 10 et le rapport « stopped » de cette fermeture la repropose aussi.
 */
const isReportedSinceKept = (run: Run, g: TicketGroup, link: { at: number; seq?: number; closing?: Closing }, reportAt: number | undefined): boolean =>
  reportAt !== undefined && isKeptForReport(run, { kind: 'group', id: g.id, name: g.name }, link.seq, link.closing)

/** Un groupe rendu, relu, à la sécurité tranchée, sans fermeture en cours : candidat à la fermeture. */
export const isCloseCandidate = (run: Run, g: TicketGroup, relay: Relay | null = null, review: SecurityReview = 'on'): boolean => {
  const link = g.delegated
  if (!link || typeof link !== 'object' || g.linked !== undefined || !isGroupDone(run, g) || closeMissing(run, g, review).length > 0 || isStillActive(relay, g, run.groups)) return false
  // Une fermeture relue hors forme (null, un autre type) n'est ni à faire ni relancée.
  return (
    link.closing === undefined ||
    (link.closing !== null && typeof link.closing === 'object' && link.closing.state === 'stopped' && (isRetried(link) || isReportedSinceKept(run, g, link, relayedReportAt(relay, g, run.groups))))
  )
}

/** Ce que la réponse de l'outil ajoute, dans la discussion de la mission : les groupes à fermer, et ce qui manque aux autres. */
export const closingText = (run: Run, relay: Relay | null, isRepo: boolean, review: SecurityReview = 'on'): string => {
  const parts: string[] = []
  // Une session archivée dans l'app : son worktree se retire par la procédure, sans git il n'y en a pas.
  const archived = (procedure: string) =>
    isRepo && isScriptPath(closingScript.path)
      ? `once the user says it is archived, remove its worktree only by its step 2 (the same script with --apres-arret, removal only on SÛR): ${procedure}`
      : isRepo
      ? `once the user says it is archived, remove its worktree only by the closing procedure from its point 8 on (re-check the merge, the tree and the snapshots, unlock only its own stale lock, git worktree remove without any option): ${procedure}`
      : 'once the user says it is archived (no git here, so no worktree to remove),'
  for (const g of run.groups ?? []) {
    const link = g.delegated
    // Les sessions précédentes d'un groupe confié de nouveau : celle du lien rendu pendant que la
    // nouvelle travaille, puis celles gardées dans `earlier` ; aucune n'est oubliée.
    // Chacune jugée sur son seul relais : jusqu'à l'envoi qui a pris sa place.
    const sends = [...earlierOf(link).map(x => x.at), ...(link ? [link.at] : []), ...(g.linked ? [g.linked.at] : [])]
    const nextSend = (at: number) => sends.filter(x => x > at).sort((x, y) => x - y)[0] ?? Infinity
    const previous: { prev: ClosedLink; key?: number; isRetried: boolean }[] = [
      ...earlierOf(link).map(prev => ({ prev, key: prev.at, isRetried: isRetriedSince(prev.closing, link?.touchedAt, undefined) })),
      ...(link && g.linked !== undefined ? [{ prev: link as ClosedLink, key: link.at, isRetried: isRetried(link) }] : []),
    ]
    for (const { prev, key, isRetried: retried } of previous) {
      if (prev.closing?.state === 'closed') continue
      const target = { kind: 'group', id: g.id, name: g.name } as const
      // Le compte rendu de cette session précédente, dans la fenêtre de son envoi : sans lui, pas de claude rm.
      const prevReportAt = relayedReportAt(relay, g, run.groups, prev, nextSend(prev.at))
      const procedure = closingProcedure({ run, target, isRepo, ...(prev.session ? { session: prev.session } : {}), ...(prev.seq !== undefined ? { seq: prev.seq } : {}), hasReport: prevReportAt !== undefined, noted: prev.closing })
      // Un id hors forme : la procédure se réduit à son refus, sans consigne autour qui retirerait un worktree.
      if (!isGroupId(g.id) && (prev.closing === undefined || prev.closing?.state === 'app' || retried)) {
        // Comme pour un id en forme : une session qui travaille encore n'a rien à rapporter, elle attend.
        if (!isStillActive(relay, g, run.groups, prev, nextSend(prev.at))) parts.push(` · Do not close: ${procedure} ${closedHint(target, key)}`)
        continue
      }
      const name = `the previous worker of group ${shownGroupId(g.id)} (${shownGroupName(g.name)}), replaced by a new send (sent at ${isoMinute(prev.at)} UTC)`
      if (prev.closing?.state === 'app') {
        parts.push(` · To archive in the app: ${name}${closingWhy(prev.closing.why)}; ${archived(procedure)} ${closedHint(target, key)}`)
      } else if ((prev.closing === undefined || retried || isReportedSinceKept(run, g, prev, prevReportAt)) && !isStillActive(relay, g, run.groups, prev, nextSend(prev.at))) {
        parts.push(
          ` · Close now: ${name}: its work came back with its group, a new session took its place. Only in the discussion that leads the mission, never in a worker (a bug-diagnosis session that resumed the mission included: there, ignore this section). The new session of the group may work in a worktree of the same name: the worktree to close is the one of this previous session only, found by its branch and its session's cwd; if that worktree is the new session's (its cwd, or the new session's branch), stop the closing and tell the user. ${procedure} ${closedHint(target, key)}`,
        )
      }
    }
    // Confié de nouveau : sa nouvelle session travaille, rien d'autre à fermer ni à réclamer.
    if (!link || g.linked !== undefined || link.closing?.state === 'closed') continue
    if (!isGroupId(g.id) && (link.closing?.state === 'app' || isCloseCandidate(run, g, relay, review))) {
      const target = { kind: 'group', id: g.id, name: g.name } as const
      parts.push(` · Do not close: ${closingProcedure({ run, target, isRepo, hasReport: false })} ${closedHint(target)}`)
      continue
    }
    const name = `group ${shownGroupId(g.id)} (${shownGroupName(g.name)})`
    // Un ticket que le plan lui rattache est encore ouvert : rien ne se ferme, pas même une session
    // archivée dans l'app (son worktree attend) ; une fermeture arrêtée et pas relancée reste muette.
    const attachedOpen = openAttachedOf(run, g)
    if (attachedOpen.length > 0) {
      if (!(link.closing?.state === 'stopped' && !isRetried(link))) {
        const missing = closeMissing(run, g, review)
        const after = isGroupId(g.id) ? '' : '; then nothing is closed from here either (its id is out of form)'
        parts.push(` · Not closed yet: ${name} — still open, attached to it by the plan: ${attachedOpen.join(', ')}; closing waits for it${after}${missing.length > 0 ? `; it also lacks: ${missing.join('; ')}` : ''}.`)
      }
      continue
    }
    // Le compte rendu de sa session au relais : sans lui, la procédure ne lance pas claude rm (session gardée).
    const hasReport = relayedReportAt(relay, g, run.groups) !== undefined
    if (link.closing?.state === 'app') {
      const procedure = closingProcedure({ run, target: { kind: 'group', id: g.id, name: g.name }, isRepo, ...(link.session ? { session: link.session } : {}), ...(link.seq !== undefined ? { seq: link.seq } : {}), hasReport, noted: link.closing })
      parts.push(` · To archive in the app: ${name}${closingWhy(link.closing.why)}; ${archived(procedure)} Then send {"closed": [{"group": ${asciiJson(g.id)}, "state": "closed", "sessionId": "<full sessionId>", "branch": "<kept branch>", "worktree": "<removed worktree path>"}]} (the last three when known).`)
      continue
    }
    if (isCloseCandidate(run, g, relay, review)) {
      const procedure = closingProcedure({ run, target: { kind: 'group', id: g.id, name: g.name }, isRepo, ...(link.session ? { session: link.session } : {}), ...(link.seq !== undefined ? { seq: link.seq } : {}), hasReport, noted: link.closing })
      parts.push(
        ` · Close now: ${name} is closed (returned, reviewed, security settled). Only in the discussion that leads the mission, never in a worker (a bug-diagnosis session that resumed the mission included: there, ignore this section). ${procedure} ${closedHint({ kind: 'group', id: g.id, name: g.name })}`,
      )
      continue
    }
    // Une fermeture arrêtée ne se repropose pas à chaque appel ; relancée, elle dit ce qui manque encore.
    if (link.closing?.state === 'stopped' && !isRetried(link)) continue
    if (isStillActive(relay, g, run.groups) && closeMissing(run, g, review).length === 0) {
      parts.push(
        ` · Not closed yet: ${name} — its worker is still active (relayed activity after its final report): closing waits. Once its work is done and checked, ask it by SendMessage to leave its final report in the relay again, updated with that work (its procedure says so after any later fix; the same text again is ignored): ${isGroupId(g.id) ? 'the next call then closes it' : 'the next call then gives its refusal to report (its id is out of form: nothing is closed from here)'}.`,
      )
      continue
    }
    const missing = closeMissing(run, g, review)
    if (missing.length > 0) parts.push(` · Not closed yet: ${name} lacks: ${missing.join('; ')}.`)
  }
  for (const phase of run.phases) {
    const link = phase.linked
    const def = SKILLS[phase.skill]
    if (!link?.session || !def?.items || link.closing?.state === 'closed') continue
    const target = { kind: 'items', skill: phase.skill } as const
    // Relu du tableau de bord : l'id n'est cité que s'il a une forme sûre, comme dans la procédure.
    const name = `the worker of the ${def.items.label} of phase ${def.label} (session ${isSafeId(link.session) ? link.session : 'id de session hors forme'})`
    // La session des pistes ne dépose pas de compte rendu au relais : jamais de claude rm (closingProcedure).
    const procedure = closingProcedure({ run, target, isRepo, session: link.session, ...(link.seq !== undefined ? { seq: link.seq } : {}), hasReport: false })
    if (link.closing?.state === 'app') {
      parts.push(` · To archive in the app: ${name}${closingWhy(link.closing.why)}; ${archived(procedure)} ${closedHint(target)}`)
    } else if (isItemsCloseCandidate(phase)) {
      parts.push(` · Close now: ${name} is closed (every item judged). Only in the discussion that leads the mission, never in a worker (a bug-diagnosis session that resumed the mission included: there, ignore this section). Before completing the phase. ${procedure} ${closedHint(target)}`)
    }
  }
  return parts.join('')
}

/** Les entrées `closed` : notées sur le lien du groupe rendu ; « closed » ne recule jamais (T2). */
const applyClosed = (run: Run, value: unknown, now: number, root: string, review?: SecurityReview): string => {
  if (value === undefined) return ''
  const noted: string[] = []
  const notedItems: string[] = []
  const refused: string[] = []
  // Les champs refusés d'une entrée notée : l'état et les autres champs sont gardés.
  const badFields: string[] = []
  const closingFor = (e: Record<string, unknown>, state: Closing['state'], was: Closing | undefined, name: string): Closing => {
    const bad: string[] = []
    const closing = closingOf(e, state, was, now, root, bad)
    if (bad.length > 0) badFields.push(`${name}: ${bad.join(', ')}`)
    return closing
  }
  for (const raw of asList(value)) {
    const e = raw as Record<string, unknown>
    const id = str(e.group)
    const state = str(e.state) as Closing['state']
    if (id === '' && str(e.items) !== '') {
      const skill = skillIdOf(str(e.items)) ?? str(e.items)
      const phase = [...run.phases].reverse().find(p => p.skill === skill && SKILLS[p.skill]?.items)
      const name = phase ? `${SKILLS[skill]!.items!.label} of phase ${SKILLS[skill]!.label}` : `items of ${str(e.items)}`
      if (!phase?.linked?.session) refused.push(`${name} (no worker to close)`)
      else if (linkedInFlight(phase).length > 0) refused.push(`${name} (items still in progress: send their verdicts first)`)
      else if (!CLOSE_STATES.includes(state)) refused.push(`${name} (state must be closed, app or stopped)`)
      else if (phase.linked.closing?.state === 'closed' && state !== 'closed') refused.push(`${name} (already closed: a closed session never goes back)`)
      else {
        phase.linked = withClosing(phase.linked, closingFor(e, state, phase.linked.closing, name))
        notedItems.push(`${name} noted ${state}`)
        log(run, now, state === 'closed' ? '✕' : state === 'app' ? '⧗' : '!', `Session des ${SKILLS[skill]!.items!.label.toLowerCase()} : ${state === 'closed' ? 'session et worktree fermés' : state === 'app' ? "à archiver dans l'app" : `fermeture arrêtée${phase.linked.closing!.why ? ` : ${phase.linked.closing!.why}` : ''}`}`, state === 'stopped' ? 'warn' : state === 'closed' ? 'ok' : 'info')
      }
      continue
    }
    const g = sentGroupOf(run, e.group)
    const linkAt = typeof e.link === 'number' ? e.link : typeof e.link === 'string' && /^\d+$/.test(e.link) ? Number(e.link) : undefined
    if (e.link !== undefined && linkAt === undefined) {
      refused.push(`${g ? shownGroupId(g.id) : id ? shownGroupId(e.group) : '?'} ("link" must be the number given in the answer: ${JSON.stringify(e.link)} is not)`)
      continue
    }
    if (g?.delegated && linkAt !== undefined && linkAt !== g.delegated.at) {
      const list = earlierOf(g.delegated)
      const at = list.findIndex(x => x.at === linkAt)
      const prev = list[at]
      const shown = shownGroupId(g.id)
      if (!prev) refused.push(`${shown} (no previous session sent at ${linkAt})`)
      else if (!CLOSE_STATES.includes(state)) refused.push(`${shown} (state must be closed, app or stopped)`)
      else if (prev.closing?.state === 'closed' && state !== 'closed') refused.push(`${shown} (sent at ${linkAt}: already closed: a closed session never goes back)`)
      // Un id hors forme : rien ne se ferme d'ici, pour une session précédente non plus (décision de Mathis du 31/10/2026).
      else if (!isGroupId(g.id) && state !== 'stopped') refused.push(`${shown} (sent at ${linkAt}: its id is out of form: nothing is closed from here, only "stopped" is noted)`)
      else {
        const closing = closingFor(e, state, prev.closing, `previous session of group ${shown} (sent at ${linkAt})`)
        g.delegated = withEarlierClosing(g.delegated, list, at, closing)
        notedItems.push(`previous session of group ${shown} (sent at ${linkAt}) noted ${state}`)
        log(run, now, state === 'closed' ? '✕' : state === 'app' ? '⧗' : '!', `Groupe ${g.id}, session précédente : ${state === 'closed' ? 'session et worktree fermés' : state === 'app' ? "à archiver dans l'app" : `fermeture arrêtée${closing.why ? ` : ${closing.why}` : ''}`}`, state === 'stopped' ? 'warn' : state === 'closed' ? 'ok' : 'info')
      }
      continue
    }
    if (!g) refused.push(`${id ? shownGroupId(e.group) : '?'} (unknown group)`)
    else if (!g.delegated) refused.push(`${shownGroupId(g.id)} (not returned by a worker)`)
    else if (!CLOSE_STATES.includes(state)) refused.push(`${shownGroupId(g.id)} (state must be closed, app or stopped)`)
    else if (g.delegated.closing?.state === 'closed' && state !== 'closed') refused.push(`${shownGroupId(g.id)} (already closed: a closed group never goes back)`)
    // Un id hors forme : rien ne se ferme d'ici, seul l'arrêt se note (décision de Mathis du 31/10/2026).
    else if (!isGroupId(g.id) && state !== 'stopped') refused.push(`${shownGroupId(g.id)} (its id is out of form: nothing is closed from here, only "stopped" is noted)`)
    // Un ticket que le plan lui rattache est encore ouvert : le groupe n'est pas fini, rien ne se note fermé ni à archiver.
    else if (state !== 'stopped' && g.delegated.closing?.state !== 'closed' && openAttachedOf(run, g).length > 0)
      refused.push(`${shownGroupId(g.id)} (still open, attached to it by the plan: ${openAttachedOf(run, g).join(', ')}; a group is closed only once they are done)`)
    else {
      const closing = closingFor(e, state, g.delegated.closing, `group ${shownGroupId(g.id)}`)
      // Première fermeture alors que la revue de sécurité est désactivée (lue « off » à l'instant), l'avis conseillé
      // sans revue : la fermeture le garde (`securityOff`), avec la marque de l'avis à l'heure de la fermeture. Un
      // « closed » renvoyé pour un groupe déjà clos (sa branche, sa session) garde l'état de la première
      // (`closingOf`), sans relire le réglage ni toucher à la marque.
      const isFirstClose = state === 'closed' && g.delegated.closing?.state !== 'closed'
      const marked = isFirstClose ? markSecurityOff(g.security, review, now, true) : g.security
      const isOff = isFirstClose && marked !== g.security
      g.delegated = withClosing(g.delegated, isOff ? { ...closing, securityOff: true } : closing)
      if (isOff) g.security = marked
      noted.push(g.id)
      const words = { closed: 'session et worktree fermés', app: "à archiver dans l'app", stopped: `fermeture arrêtée${closing.why ? ` : ${closing.why}` : ''}` }
      log(run, now, state === 'closed' ? '✕' : state === 'app' ? '⧗' : '!', `Groupe ${g.id} : ${words[state]}`, state === 'stopped' ? 'warn' : state === 'closed' ? 'ok' : 'info')
    }
  }
  return [
    noted.length > 0 ? ` · closed: group${noted.length > 1 ? 's' : ''} ${noted.map(shownGroupId).join(', ')} noted ${noted.map(id => run.groups!.find(g => g.id === id)!.delegated!.closing!.state).join(', ')}` : '',
    notedItems.length > 0 ? ` · closed: ${notedItems.join(', ')}` : '',
    refused.length > 0 ? ` · closed: refused for ${refused.join(', ')}` : '',
    badFields.length > 0 ? ` · closed: field refused for ${badFields.join('; ')}` : '',
  ].join('')
}

// ─── Mission à reprendre, dates futures et traces relues ──────────────────

/** Les missions du projet qu'une discussion peut reprendre : en pause, ou suivies ailleurs. */
export const resumable = (board: Board): Run[] =>
  board.runs.filter(r => r.id !== board.activeId && r.archivedAt === undefined && (r.status === 'active' || r.status === 'paused'))

const ticketCount = (run: Run): string => {
  const t = countTickets(run.tickets)
  return t.total > 0 ? `${t.done}/${t.total} tickets` : 'no tickets'
}

/** L'id d'une mission relue du fichier partagé, dans une réponse de l'outil : tel quel en forme, sinon échappé (JSON). */
const shownRunId = (id: unknown): string => (isSafeId(id) ? id : asciiJson(id))

/**
 * Un texte relu du fichier partagé (titre d'une mission, phase), dans une réponse de l'outil :
 * neutralisé comme un texte relayé, il n'y ouvre aucune section (« · ») ni ligne.
 */
const shownText = (text: unknown): string => neutralRelayed(typeof text === 'string' ? text : '')

/**
 * Un texte relu du fichier partagé (titre, nom ou id d'un ticket, choix déclaré, chemin), dans une
 * consigne donnée à Claude avec un skill, où seule la ligne fait structure : il n'y ouvre aucune
 * ligne, et garde ses guillemets « » et ses « · » (`neutralLine`).
 */
const shownInNote = (text: unknown): string => neutralLine(typeof text === 'string' ? text : '')

/** Le nom d'une phase relue : son libellé connu, sinon son id neutralisé. */
const phaseLabel = (skill: unknown): string => (typeof skill === 'string' ? SKILLS[skill]?.label : undefined) ?? shownText(skill)

/** Pour Claude, quand cette discussion n'a pas de mission active : titres et ids des missions relues neutralisés. */
export const noActiveText = (board: Board): string => {
  const waiting = resumable(board)
  const delivered = lastDeliveredHere(board)
  if (waiting.length === 0) return `No mission is running on the dashboard: it starts when a mattpocock skill loads.${delivered}`
  const state = (r: Run) => (r.status === 'active' ? 'in progress in another discussion' : r.asideAt !== undefined ? 'set aside by the user' : 'paused')
  const list = waiting
    .map(r => `${JSON.stringify(shownText(r.title))} (${state(r)}, ${ticketCount(r)}, phase ${phaseLabel(currentPhase(r).skill)}, id ${shownRunId(r.id)})`)
    .join('; ')
  return `No mission is active in this discussion, so nothing was recorded. This project already has: ${list}. Do not start another lot nor look for tickets elsewhere: ask the user which one to resume (/flow-board:flow, History tab, "↻ Reprendre ici"), then send your report again. Only if the user asks for a new mission, send {"open": {"title": "..."}} with the report.${delivered}`
}

/**
 * La dernière mission de cette discussion (née ou portée ici), quand le COO l'a livrée et qu'elle attend sa rétro ou
 * son archivage : la phrase qui le dit, à rendre telle quelle ; vide sinon.
 */
const lastDeliveredHere = (board: Board): string => {
  const mine = board.runs.filter(r => board.session !== '' && (r.owner === board.session || r.bornIn === board.session))
  const last = [...mine].sort((a, b) => (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt))[0]
  const at = last ? deliveredByCooAt(last) : null
  return last && at !== null ? ` The last mission of this discussion, ${JSON.stringify(shownText(last.title))}, was delivered by the COO: tell the user « ${deliveredByCooLine(at, last)} » (nothing to do here).` : ''
}

/**
 * La date de la livraison d'une mission par le COO, lue sur sa ligne de journal « Livrée par le COO » ; null pour une
 * mission qui n'est plus livrée (reprise), archivée (plus rien à choisir), livrée à la main (sans cette ligne, ou avec
 * une ligne plus ancienne que sa dernière clôture), ou dont la ligne est sortie du journal plafonné.
 */
export const deliveredByCooAt = (run: Run): number | null => {
  if (run.archivedAt !== undefined || !isDeliveredRun(run)) return null
  const line = run.log.find(l => l.text.startsWith(DELIVERED_BY_COO))
  // La ligne de sa dernière clôture seulement (`closeDelivered` les date du même instant) : une mission reprise puis
  // livrée de nouveau à la main garde une vieille ligne, qui ne vaut plus.
  return line && isTime(line.at) && line.at >= (run.finishedAt ?? 0) ? line.at : null
}

/** Le début de la ligne de journal qu'écrit la clôture d'une mission livrée par le COO (`closeDelivered`). */
const DELIVERED_BY_COO = 'Livrée par le COO'

/**
 * La ligne du tableau de bord d'une mission livrée par le COO, sans bouton : ce qui se choisit chez le COO, seulement
 * quand la vue Coordination le propose (« ✓ Archiver » pour une mission qui attend son archivage ; une rétro n'a pas
 * de rétro) ; la date seule sinon (un groupe reparti depuis le push, une étape de livraison à faire).
 */
export const deliveredByCooLine = (at: number, run: Run): string => {
  const day = `${DELIVERED_BY_COO} le ${new Date(at).toLocaleDateString('fr-FR')}`
  if (!isAwaitingArchive(run)) return day
  return `${day} : ${run.phases[0]?.skill === 'retro' ? 'archivage' : 'rétro ou archivage'} dans la vue Coordination`
}

/** Pour la personne (réponse de /flow), quand cette discussion n'a pas de mission active. */
export const noActiveFrench = (board: Board): string => {
  const waiting = resumable(board)
  if (waiting.length === 0) return 'Tableau de bord ouvert : aucune mission en cours.'
  const list = waiting
    .map(r => {
      const t = countTickets(r.tickets)
      return `« ${neutralInPrompt(typeof r.title === 'string' ? r.title : '')} » (${r.status === 'active' ? 'suivi dans une autre discussion' : r.asideAt !== undefined ? 'mis de côté' : 'en pause'}${t.total > 0 ? `, ${t.done}/${t.total} tickets` : ''})`
    })
    .join(', ')
  return `Aucune mission active dans cette discussion. À reprendre (onglet Historique, « ↻ Reprendre ici ») : ${list}.`
}

/**
 * Une date d'activité dans le futur (fichier retouché à la main, horloge d'une autre machine)
 * gagnerait toutes les fusions et annulerait chaque reprise : elle est ramenée à la dernière
 * activité réelle de la mission ; de même l'état auto et les traces de retrait. Le seul point où une
 * trace de suppression datée à plus d'une minute dans le futur tombe : jamais appliquée (`mergeBoards`
 * et `dropRun` ne relisent que la forme, et écartent une trace mal formée ; `detachOnLoad` passe par ici). La lecture qui en fait tomber une fait réécrire le fichier
 * (`hasUnsoundTombstones`), pour qu'une lecture plus tardive, l'horloge rattrapant la date, ne l'applique pas.
 */
export const clampFuture = (board: Board, now: number): Board => {
  const isAhead = (r: Run) => r.updatedAt > now + 60_000
  const isDeletedSound = !hasUnsoundTombstones(board, now)
  // L'avis de sécurité du lot daté au-delà de la tolérance : sa date ne se croit pas, il ne vaut plus pour
  // aucun passage (0, comme un avis d'un lot jamais relu), et ne gagne plus les fusions.
  const isAdviceAhead = (r: Run) => {
    const sec: unknown = r.security
    return sec !== null && typeof sec === 'object' && isTime((sec as SecurityCheck).at) && (sec as SecurityCheck).at! > now + 60_000
  }
  // Une fin de ticket datée au-delà de la tolérance, ramenée à maintenant : sinon chaque revue du lot,
  // datée avant elle, le laisserait à relire, et l'auto renverrait la revue à chaque tour.
  const isTicketAhead = (r: Run) => r.tickets.some(t => isTime(t.finishedAt) && t.finishedAt > now + 60_000)
  // Un changement de statut d'un bloqueur externe daté au-delà de la tolérance : un « todo » perd sa date (jamais
  // ramenée à l'heure de la lecture, qui gagnerait chaque fusion sur une levée), et sans date il ne gagne aucune
  // fusion sur un changement daté (`keepExternals`) ; une levée, elle, est ramenée à maintenant, pour ne pas perdre
  // contre un « todo » daté plus ancien.
  const isExternalAhead = (x: unknown) => isSoundExternal(x) && isTime(x.statusAt) && x.statusAt > now + 60_000
  const areExternalsAhead = (r: Run) => externalsOf(r).some(isExternalAhead)
  // Une revue du lot datée au-delà de la tolérance compte comme une revue à refaire : sa date est gardée,
  // en négatif (rien n'est effacé), illisible comme date de revue ; le lot redevient à relire, sous une clé
  // de passage qui la nomme (jamais `lot@0`), et la revue suivante la remplace.
  const isReviewAhead = (r: Run) => isTime(r.reviewedAt) && r.reviewedAt > now + 60_000
  // Un siège du COO daté au-delà de la tolérance : ses dates sont ramenées à maintenant (il ne gagne plus
  // toute prise), jamais effacées.
  const isSeatFuture = isSeatAhead(board.coo, now)
  const areMarksAhead = (r: Run) => isMarkAhead(r.security, now) || (r.groups ?? []).some(g => isMarkAhead(g.security, now))
  if (isDeletedSound && !isSeatFuture && !board.runs.some(r => isAhead(r) || isAutoAhead(r, now) || areTracesAhead(r, now) || isAdviceAhead(r) || isTicketAhead(r) || areExternalsAhead(r) || isReviewAhead(r) || areMarksAhead(r))) return board
  const b = clone(board)
  if (isSeatFuture) b.coo = soundSeat(board.coo, now)
  // Une trace de suppression datée dans le futur, ou mal formée, tombe à la lecture : jamais appliquée.
  if (!isDeletedSound) b.deleted = soundTombstones(b.deleted, now)
  for (const r of b.runs) {
    if (isAhead(r)) r.updatedAt = Math.min(now, maxOf(r.log.map(e => e.at).filter(at => at <= now), r.startedAt))
    if (isAutoAhead(r, now)) r.auto = autoAtMost(r, now)
    if (isAdviceAhead(r)) r.security = { ...r.security, at: 0 }
    // Une marque « revue désactivée » datée au-delà de la tolérance (horloge en avance) tombe : elle pourrait
    // dater une fermeture faite revue réactivée ; sans elle, l'avis redevient dû tant que la lecture ne dit pas « off ».
    if (isMarkAhead(r.security, now)) r.security = withoutMark(r.security!)
    for (const g of r.groups ?? []) if (isMarkAhead(g.security, now)) g.security = withoutMark(g.security!)
    if (isReviewAhead(r)) r.reviewedAt = -r.reviewedAt!
    if (isTicketAhead(r)) r.tickets = r.tickets.map(t => (isTime(t.finishedAt) && t.finishedAt > now + 60_000 ? { ...t, finishedAt: now } : t))
    if (areExternalsAhead(r)) r.externals = externalsOf(r).map(x => (!isExternalAhead(x) ? x : x.status === 'done' ? { ...x, statusAt: now } : undated(x)))
    if (areTracesAhead(r, now)) {
      r.autoResent = tracesAtMost(r.autoResent, now) as Run['autoResent']
      r.answered = tracesAtMost(r.answered, now) as Run['answered']
    }
  }
  return b
}

/**
 * Les traces de suppression relues, bornées ici : un id texte non vide et une vraie date (`isTime`) ;
 * avec `now`, une date à plus d'une minute dans le futur aussi écartée (les fichiers de mission sont
 * propres au poste : une telle date vient d'une retouche ou d'un recul de l'horloge ; la minute de
 * tolérance est celle de toutes les dates relues). Invariant : une mission
 * n'est effacée par une trace de suppression que si cette trace est une vraie date (au plus une minute
 * dans le futur), postérieure à sa dernière modification. Une liste qui n'en est pas une n'a aucune trace.
 */
export const soundTombstones = (list: unknown, now?: number): Tombstone[] =>
  (Array.isArray(list) ? (list as unknown[]) : []).filter((t): t is Tombstone => {
    if (t === null || typeof t !== 'object') return false
    const x = t as Record<string, unknown>
    return typeof x.id === 'string' && x.id !== '' && isTime(x.at) && (now === undefined || x.at <= now + 60_000)
  })

/** La liste des traces de suppression d'une copie relue en porte une qui tombe à la lecture (mal formée ou future), ou n'est pas une liste. */
export const hasUnsoundTombstones = (board: Board, now: number): boolean =>
  board.deleted !== undefined && (!Array.isArray(board.deleted) || soundTombstones(board.deleted, now).length !== board.deleted.length)

/** Une trace de retrait relue datée au-delà de la tolérance d'une minute. */
const isTraceAhead = (t: unknown, now: number): boolean =>
  t !== null && typeof t === 'object' && isTime((t as { at?: unknown }).at) && (t as { at: number }).at > now + 60_000

/** La mission porte une trace « ↻ Renvoyer » ou « répondue » datée dans le futur (fichier retouché, horloge recalée). */
const areTracesAhead = (run: Run, now: number): boolean =>
  [run.autoResent, run.answered].some(list => Array.isArray(list) && (list as unknown[]).some(t => isTraceAhead(t, now)))

/**
 * Les traces de retrait ramenées à maintenant : une trace future effacerait, à chaque fusion, toute
 * marque ou question de son id posée avant elle, et pousserait leurs dates après elle. Les autres
 * entrées restent telles quelles.
 */
const tracesAtMost = (list: unknown, now: number): unknown =>
  Array.isArray(list) ? (list as unknown[]).map(t => (isTraceAhead(t, now) ? { ...(t as object), at: now } : t)) : list

/** L'état auto porte une date dans le futur (fichier retouché, horloge recalée). */
const isAutoAhead = (run: Run, now: number): boolean => {
  const auto = autoOf(run)
  return (auto?.onAt ?? 0) > now + 60_000 || (auto?.offAt ?? 0) > now + 60_000
}

/**
 * L'état auto ramené à maintenant : une date future gagnerait toute fusion, et un « allumé à » futur
 * l'emporterait sur une coupure posée après lui. « Allumé à » descend à maintenant (il ne peut que
 * s'éteindre plus tôt) ; « éteint à » descend sans repasser avant « allumé à » : éteint, il le reste.
 */
const autoAtMost = (run: Run, now: number): RunAuto | undefined => {
  const auto = autoOf(run)
  if (!auto) return auto
  const limit = now + 60_000
  const onAt = auto.onAt !== undefined && auto.onAt > limit ? now : auto.onAt
  const offAt = auto.offAt !== undefined && auto.offAt > limit ? Math.max(now, onAt ?? now) : auto.offAt
  return { ...auto, ...(onAt !== undefined ? { onAt } : {}), ...(offAt !== undefined ? { offAt } : {}) }
}

// ─── Fin de tour : questions du grilling, synthèse de revue ───────────────

const QUESTION = /❓\s*\*{0,2}\s*Q(\d+)/g

const sectionCount = (text: string, name: string): number => {
  const lines = text.split(/\r?\n/)
  const head = new RegExp(`^#{1,4}\\s*${name}\\b`, 'i')
  const start = lines.findIndex(l => head.test(l.trim()))
  if (start < 0) return -1
  let count = 0
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,4}\s/.test(line.trim())) break
    if (/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)) count += 1
  }
  return count
}

/** Lit la réponse finale d'un tour : questions posées (`❓ **Qn**`) et synthèse `## Standards` / `## Spec`. */
export const applyAnswer = (board: Board, answer: string, now: number): { board: Board; ask: string | null } | null => {
  if (!activeRun(board) || answer.trim() === '') return null
  const numbers = [...answer.matchAll(QUESTION)].map(m => Number(m[1]))
  const standards = sectionCount(answer, 'Standards')
  if (numbers.length === 0 && standards < 0) return null

  const b = clone(board)
  const run = activeRun(b)!
  const { phase, detour } = focusOf(run)
  const target = detour ?? phase
  let ask: string | null = null

  if (numbers.length > 0) {
    phase.stats.questions += numbers.length
    phase.stats.rounds += 1
    const lo = minOf(numbers)
    const hi = maxOf(numbers)
    ask = lo === hi ? `Q${lo}` : `Q${lo}–Q${hi}`
    if (target.steps.some(s => s.id === 'rounds')) reachStep(target, 'rounds', now)
    else if (target.steps.some(s => s.id === 'grill')) reachStep(target, 'grill', now)
  }

  // Une synthèse de revue fait avancer l'étape ; ses chiffres viennent de Claude (champ `review` de
  // l'outil), pas du texte, dont les puces mêlent constats, sous-points et « rien à signaler ».
  if (standards >= 0) {
    if (target.steps.some(s => s.id === 'report')) setStep(target, 'report', now)
    else if (target.steps.some(s => s.id === 'review')) reachStep(target, 'review', now)
  }

  run.updatedAt = now
  return { board: b, ask }
}

/** La personne répond pendant un interview : une réponse de plus sur la phase. */
export const applyUserAnswer = (board: Board, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0) return null
  const phase0 = currentPhase(run0)
  if (phase0.stats.rounds <= phase0.stats.answers) return null
  const b = clone(board)
  const run = activeRun(b)!
  currentPhase(run).stats.answers += 1
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

// ─── Tests, commandes git et gh ───────────────────────────────────────────

const TEST_RE =
  /\b(?:vitest|jest|pytest|py\.test|mocha|ava|phpunit|rspec|playwright\s+test|cypress\s+run|go\s+test|cargo\s+(?:nextest\s+run|test)|dotnet\s+test|mvn\b[^|;&]*\btest|gradlew?\b[^|;&]*\btest|deno\s+test|bun\s+test|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?)\b/i
const CHECK_RE =
  /\b(?:tsc|vue-tsc|mypy|pyright|eslint|biome\s+(?:check|lint)|ruff\s+check|cargo\s+(?:check|clippy)|go\s+vet|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|check|typecheck|type-check|types))\b/i

/** Un segment d'une ligne de commande et le séparateur qui le suit (`&&`, `||`, `;`, `|` ; vide en fin). */
type Segment = { text: string; next: string }

/** Un heredoc ouvert : `<<EOF`, `<<-EOF`, `<<'EOF'`, `<< "EOF"` (pas la chaîne `<<<`). */
const HEREDOC = /^<<(-?)[ \t]*(['"]?)([A-Za-z_][\w.-]*)\2/

/**
 * Découpe une commande shell aux séparateurs, sans couper à l'intérieur des guillemets. Le corps
 * d'un heredoc est du texte, pas des commandes : il est sauté, sinon une apostrophe de prose
 * ouvrait une fausse chaîne qui avalait la suite de la commande (le `claude --bg` d'après).
 */
export const splitCommand = (command: string): Segment[] => {
  const segments: Segment[] = []
  let current = ''
  let quote = ''
  const heredocs: { word: string; isIndented: boolean }[] = []
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (!quote && ch === '\n' && heredocs.length > 0) {
      // Saute les corps des heredocs ouverts sur cette ligne, jusqu'à leur ligne de fin.
      let at = i + 1
      for (const doc of heredocs) {
        while (at < command.length) {
          const end = command.indexOf('\n', at)
          const line = command.slice(at, end < 0 ? command.length : end)
          at = end < 0 ? command.length : end + 1
          if ((doc.isIndented ? line.replace(/^\t+/, '') : line).replace(/\r$/, '') === doc.word) break
        }
      }
      heredocs.length = 0
      segments.push({ text: current.trim(), next: '\n' })
      current = ''
      i = at - 1
      continue
    }
    if (!quote && ch === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      const doc = HEREDOC.exec(command.slice(i))
      if (doc) {
        heredocs.push({ word: doc[3]!, isIndented: doc[1] === '-' })
        current += doc[0]
        i += doc[0].length - 1
        continue
      }
    }
    if (quote) {
      current += ch
      if (ch === '\\' && quote === '"' && i + 1 < command.length) current += command[++i]
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    const two = command.slice(i, i + 2)
    const sep = two === '&&' || two === '||' ? two : ch === '&' ? ';' : ch === ';' || ch === '|' || ch === '\n' ? ch : ''
    if (sep) {
      segments.push({ text: current.trim(), next: sep })
      current = ''
      if (two === '&&' || two === '||') i += 1
      continue
    }
    current += ch
  }
  segments.push({ text: current.trim(), next: '' })
  return segments.filter(seg => seg.text !== '')
}

/** Ce qui peut précéder la vraie commande d'un segment : parenthèse, variables, `npx`, `python -m`… */
const LEAD = /^(?:\(\s*|(?:[A-Za-z_]\w*=\S*|sudo|time|env)\s+|(?:npx|pnpx|bunx|pnpm\s+(?:exec|dlx)|yarn\s+dlx|uv\s+run|poetry\s+run|(?:\S*[\\/])?python(?:3(?:\.\d+)?)?(?:\.exe)?\s+-m)\s+)*/i
const head = (segment: string): string => segment.replace(LEAD, '')

/** `PY=.venv/bin/python; $PY -m pytest` : la variable posée plus tôt dans la commande est remplacée. */
const withVariables = (segments: Segment[]): Segment[] => {
  const vars = new Map<string, string>()
  return segments.map(seg => {
    const text = seg.text.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (all, name: string) => vars.get(name) ?? all)
    const set = /^([A-Za-z_]\w*)=("[^"]*"|'[^']*'|\S+)$/.exec(text)
    if (set) vars.set(set[1]!, set[2]!.replace(/^["']|["']$/g, ''))
    return { ...seg, text }
  })
}

/** Des tests ciblés (un fichier, un filtre) appartiennent à la boucle TDD ; la suite complète aux vérifications. */
const TARGETED = /\S+\.(?:py|[cm]?[jt]sx?|go|rs|rb|php)\b|::|\s(?:-k|-t|--grep|--testNamePattern|-run)[\s=]|\stests?[\\/]/i

const TEST_START = new RegExp(`^${TEST_RE.source}`, 'i')
const CHECK_START = new RegExp(`^${CHECK_RE.source}`, 'i')
// Le verbe finit au premier espace : `git merge-base` (une question, pas un merge) ne compte pas.
const GIT_START = /^git(?:\s+-[Cc]\s+\S+)*\s+(commit|checkout\s+-b|switch\s+-c|worktree\s+(?:add|remove|prune)|merge|bisect|push)(?![\w-])/
const GH_START = /^(gh|glab)\s+(issue|pr|mr)\s+(create|close|ready|merge)\b/
const BG_START = /^claude(?:\.exe)?\s(?:[\s\S]*\s)?--(?:bg|background)\b/i
// « backgrounded · 60481870 · Lot SC > Groupe A · Synchro » ; le point médian peut arriver déformé (page de code).
const BG_OUT = /^\s*backgrounded\s+\S+\s+([0-9a-f]{6,})\s+\S+\s+(.+?)\s*$/gim

/**
 * Les sessions de fond lancées par `claude --bg` (le CLI, qui n'a pas `start_session`) : l'id et
 * le titre que la commande affiche, pour relier chaque worker à son groupe.
 */
export const backgroundLaunches = (command: string, out: string): { id: string; title: string }[] => {
  const heads = withVariables(splitCommand(command)).map(seg => head(seg.text))
  if (!heads.some(h => BG_START.test(h))) return []
  return [...out.matchAll(BG_OUT)].map(m => ({ id: m[1]!, title: m[2]! }))
}

/**
 * Ce qu'une commande dit pour le relais d'un worker : un commit (son message, vide sans
 * `-m`), le verdict de tests ou de vérifications. Les mêmes règles que `applyCommand`.
 */
export const commandSignals = (command: string, ok: boolean, out: string): { commit?: string; test?: boolean } => {
  const segments = withVariables(splitCommand(command))
  const heads = segments.map(seg => head(seg.text))
  const testAt = heads.findIndex(h => TEST_START.test(h))
  const verdictAt = testAt >= 0 ? testAt : heads.findIndex(h => CHECK_START.test(h))
  const verdict = verdictAt >= 0 ? testVerdict(segments, verdictAt, ok, out) : null
  const gitAt = heads.findIndex(h => GIT_START.exec(h)?.[1] === 'commit')
  const isCommit = ok && gitAt >= 0 && !/--dry-run/.test(heads[gitAt]!)
  return {
    ...(isCommit ? { commit: flag(heads[gitAt]!, ['-m', '--message']).split(/\r?\n/)[0] ?? '' } : {}),
    ...(verdict !== null ? { test: verdict } : {}),
  }
}

const FAIL_OUT = /\b[1-9]\d*\s+(?:failed|failing|failures?)\b|\bFAIL(?:ED)?\b|npm ERR!|ÉCHEC|AssertionError|Tests?:\s+[1-9]\d*\s+failed/
const PASS_OUT = /\b[1-9]\d*\s+(?:passed|passing)\b|\bPASS(?:ED)?\b|Tests?:\s+\d+\s+passed|\bOK\b/

/**
 * Verdict d'un lancement de tests. Le code de sortie ne compte que si rien ne le masque après le
 * segment de test (seulement des `&&`) ; sinon la sortie décide, et sans indice on s'abstient.
 */
const testVerdict = (segments: Segment[], at: number, ok: boolean, out: string): boolean | null => {
  const isReliable = segments.slice(at).every(seg => seg.next === '' || seg.next === '&&')
  if (isReliable) return ok
  if (FAIL_OUT.test(out)) return false
  if (PASS_OUT.test(out)) return true
  return null
}

const flag = (command: string, names: string[]): string => {
  for (const name of names) {
    const m = command.match(new RegExp(`(?:^|\\s)${name}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`))
    if (m) return (m[1] ?? m[2] ?? m[3] ?? '').trim()
  }
  return ''
}

const lastNumber = (text: string, pattern: RegExp): string => {
  const all = [...text.matchAll(pattern)]
  return all.length > 0 ? (all[all.length - 1]![1] ?? '') : ''
}

const addArtifact = (run: Run, artifact: Artifact) => {
  run.artifacts = [artifact, ...run.artifacts.filter(a => a.path !== artifact.path)].slice(0, LIMITS.artifacts)
}

const recordTest = (run: Run, ok: boolean, kind: 'test' | 'check', now: number, isFullSuite = false) => {
  const previous = [...run.tests].reverse().find(t => t.kind === kind)
  run.tests = [...run.tests, { at: now, ok, kind }].slice(-LIMITS.tests)
  if (kind === 'test' && previous && previous.ok !== ok) {
    log(run, now, ok ? '✓' : '✗', ok ? 'Tests au vert' : 'Tests au rouge', ok ? 'ok' : 'error')
  }
  const { phase, detour } = focusOf(run)
  const target = detour ?? phase
  if (kind === 'test') {
    if (target.skill === 'tdd') reachStep(target, 'cycles', now)
    if (target.skill === 'implement') reachStep(target, 'tdd', now)
  }
  // Lint, typecheck, ou toute la suite au vert : les vérifications avant le commit.
  if (ok && (kind === 'check' || isFullSuite) && target.skill === 'implement') reachStep(target, 'checks', now)
}

/**
 * Une commande shell vient de finir. `ok` : pas d'erreur ; `out` : sa sortie standard.
 * Repère les tests, les commits, branches, worktrees et merges, les issues et PR (gh, glab).
 */
export const applyCommand = (board: Board, command: string, ok: boolean, out: string, now: number): Outcome => {
  if (!activeRun(board)) return null
  // Seul le début de chaque segment compte : `grep "git commit"` n'est pas un commit.
  const segments = withVariables(splitCommand(command))
  const heads = segments.map(seg => head(seg.text))
  const testAt = heads.findIndex(h => TEST_START.test(h))
  const checkAt = testAt >= 0 ? -1 : heads.findIndex(h => CHECK_START.test(h))
  // Chaque segment git compte : `git commit … && git push`, ou un push après un fetch, dans un seul appel.
  const gits = heads.flatMap(h => {
    const git = GIT_START.exec(h)
    return git ? [{ command: h, verb: git[1]! }] : []
  })
  const ghAt = heads.findIndex(h => GH_START.test(h))
  const gh = ghAt >= 0 ? GH_START.exec(heads[ghAt]!) : null
  const verdictAt = testAt >= 0 ? testAt : checkAt
  const verdict = verdictAt >= 0 ? testVerdict(segments, verdictAt, ok, out) : null
  if (verdict === null && gits.length === 0 && !gh) return null

  const b = clone(board)
  const run = activeRun(b)!
  const fx = noFx()
  const { phase, detour } = focusOf(run)
  const target = detour ?? phase

  const isFullSuite = testAt >= 0 && !TARGETED.test(heads[testAt]!)
  if (verdict !== null) recordTest(run, verdict, testAt >= 0 ? 'test' : 'check', now, isFullSuite)

  for (const { command, verb } of ok ? gits : []) {
    if (verb === 'commit' && !/--dry-run/.test(command)) {
      run.counters.commits += 1
      const message = flag(command, ['-m', '--message']).split(/\r?\n/)[0] ?? ''
      log(run, now, '⎇', message ? `Commit : ${message}` : 'Commit', 'ok')
      if (target.skill === 'implement' && target.status !== 'done') setStep(target, 'commit', now)
    } else if (verb.startsWith('checkout') || verb.startsWith('switch')) {
      const name = /\b(?:checkout\s+-b|switch\s+-c)\s+(\S+)/.exec(command)?.[1] ?? ''
      log(run, now, '⎇', `Branche ${name}`, 'info')
    } else if (verb.startsWith('worktree')) {
      if (/worktree\s+add/.test(command)) run.counters.worktrees += 1
      else run.counters.worktrees = Math.max(0, run.counters.worktrees - 1)
    } else if (verb === 'merge') {
      run.counters.merges += 1
      log(run, now, '⤞', 'Merge', 'ok')
    } else if (verb === 'bisect') {
      log(run, now, '⌁', 'git bisect', 'info')
    } else if (verb === 'push') {
      log(run, now, '⬆', 'Push', 'ok')
      if (target.skill === 'project:version') reachStep(target, 'pushed', now)
    }
  }

  if (gh && ok) {
    const command = heads[ghAt]!
    const [, , noun, verb] = gh
    if (noun === 'issue' && verb === 'create') {
      const title = flag(command, ['--title', '-t'])
      const number = lastNumber(out, /\/(?:issues|-\/issues)\/(\d+)/g)
      const url = (/https?:\/\/\S+\/issues\/\d+/.exec(out) ?? [''])[0]
      const id = number ? `#${number}` : title
      if (phase.skill === 'to-spec' && !detour) {
        addArtifact(run, { path: url || `spec:${id}`, kind: 'spec', label: number ? `Spec #${number}` : 'Spec publiée', detail: title || undefined, at: now })
        log(run, now, '▤', `Spec publiée${number ? ` (#${number})` : ''}`, 'ok')
        reachStep(phase, 'publish', now)
      } else if (id && isFindingTime(run)) {
        // Hors des skills qui publient le lot : une trouvaille, pas un ticket du lot.
        addFound(run, { id, name: clip(title || id, TEXT_MAX), status: 'todo', ...(url ? { url } : {}) }, now)
      } else if (id) {
        const isNew = !run.tickets.some(t => sameTicket(t.id, id))
        if (isNew) run.tickets = [...run.tickets, { id, name: clip(title || id, TEXT_MAX), status: 'todo' as const }].slice(0, LIMITS.tickets)
        if (phase.skill === 'to-tickets') reachStep(phase, 'publish', now)
        log(run, now, '▦', `Ticket créé : ${title || id}`, 'info')
      }
    } else if (noun === 'issue' && verb === 'close') {
      const number = /\bclose\s+#?(\d+)/.exec(command)?.[1]
      if (number) {
        setTickets(run, [{ id: `#${number}`, status: 'done' }], now, b.session)
        setFound(run, [{ id: `#${number}`, status: 'done' }], now)
        target.items = target.items.map(i => (sameTicket(i.id, `#${number}`) ? { ...i, status: 'done' as const } : i))
      }
    } else if ((noun === 'pr' || noun === 'mr') && verb === 'create') {
      const number = lastNumber(out, /\/(?:pull|merge_requests)\/(\d+)/g)
      const url = (/https?:\/\/\S+\/(?:pull|merge_requests)\/\d+/.exec(out) ?? [''])[0]
      addArtifact(run, { path: url || `pr:${now}`, kind: 'pr', label: number ? `PR #${number}` : 'Pull request', detail: flag(command, ['--title', '-t']) || undefined, at: now })
      log(run, now, '⇄', `PR ouverte${number ? ` (#${number})` : ''}`, 'ok')
      if (phase.skill === 'project:pr' && phase.status === 'active') {
        finishPhase(phase, now)
        fx.toasts.push(`⇄ PR ouverte${number ? ` · #${number}` : ''}`)
      }
    } else if ((noun === 'pr' || noun === 'mr') && (verb === 'ready' || verb === 'merge')) {
      log(run, now, '⇄', verb === 'ready' ? 'PR prête à relire' : 'PR fusionnée', 'ok')
    }
  }

  run.updatedAt = now
  return { board: b, fx }
}

// ─── Fichiers écrits ──────────────────────────────────────────────────────

export type FileChange = {
  path: string
  /** Contenu entier (Write). */
  content?: string
  /** Ancien et nouveau fragment (Edit). */
  before?: string
  after?: string
}

/** Une entrée de glossaire : `**Terme** : …`, ou `- Terme : …` en liste. */
const TERM_BOLD = /^\s*(?:[-*]\s*)?\*\*[^*\n]{1,80}\*\*\s*[:—–]/gm
const TERM_LIST = /^\s*[-*]\s+[A-Za-zÀ-ÿ0-9][^:*\n]{0,59}?\s*[:—–]\s+\S/gm
const countTerms = (text: string | undefined): number =>
  text ? [...text.matchAll(TERM_BOLD)].length + [...text.matchAll(TERM_LIST)].length : 0

const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:_test\.(?:go|py)$)|(?:(?:^|\/)test_[^/]+\.py$)|(?:(?:^|\/)__tests__\/)/i

const statusFromFile = (text: string | undefined): TicketStatus | undefined => {
  const m = text ? /Status:?\**\s*:?\s*([A-Za-z-]+)/.exec(text) : null
  const value = (m?.[1] ?? '').toLowerCase()
  if (!value) return undefined
  if (/^(claimed|in-progress|doing|wip|started)$/.test(value)) return 'doing'
  if (/^(resolved|done|closed|fixed|merged|wontfix)$/.test(value)) return 'done'
  if (/^blocked$/.test(value)) return 'blocked'
  return 'todo'
}

const words = (slug: string): string => slug.replace(/[-_]+/g, ' ').trim()

/** Le ticket qu'un plan cite en tête, avant sa première section : du lot ou trouvé en route. */
const planTicket = (run: Run, content: string | undefined): string | undefined => {
  if (content === undefined) return undefined
  const head = content.split(/\n##\s/)[0]!.slice(0, 1500)
  for (const id of head.match(/#\d+|\b\d{10,20}\b/g) ?? []) {
    const hit = run.tickets.find(t => sameTicket(t.id, id)) ?? (run.found ?? []).find(f => sameTicket(f.id, id))
    if (hit) return hit.name
  }
  return undefined
}

/** Un fichier écrit ou modifié : livrables du workflow, tickets locaux, compteurs. */
export const applyFileChange = (board: Board, change: FileChange, now: number): Outcome => {
  if (!activeRun(board)) return null
  const b = clone(board)
  const run = activeRun(b)!
  const fx = noFx()
  const { phase, detour } = focusOf(run)
  const target = detour ?? phase
  const focus = target.skill
  const norm = change.path.replace(/\\/g, '/')
  const lower = norm.toLowerCase()
  const rootNorm = b.root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  // Hors du projet, seuls comptent les écrits que les skills placent ailleurs exprès.
  const isInside = rootNorm === '' || lower.startsWith(`${rootNorm}/`)
  if (!isInside && focus !== 'handoff' && !/architecture-review-[^/]*\.html$/i.test(norm)) return null
  const shown = lower.startsWith(`${rootNorm}/`) ? norm.slice(rootNorm.length + 1) : norm.split('/').slice(-3).join('/')
  const text = change.content ?? change.after
  const known = run.artifacts.find(a => a.path === norm)
  const add = (kind: ArtifactKind, label: string, detail?: string) =>
    addArtifact(run, { path: norm, kind, label, detail, at: now })

  let m: RegExpExecArray | null
  if ((m = /(?:^|\/)(GLOSSARY(?:-MAP)?)\.md$/i.exec(norm))) {
    const added =
      change.content !== undefined
        ? Math.max(0, countTerms(change.content) - Number(known?.detail?.match(/^\d+/)?.[0] ?? 0))
        : Math.max(0, countTerms(change.after) - countTerms(change.before))
    run.counters.terms += added
    const total = change.content !== undefined ? countTerms(change.content) : Number(known?.detail?.match(/^\d+/)?.[0] ?? 0) + added
    add('glossary', shown, `${total} terme${total > 1 ? 's' : ''}`)
    if (added > 0) log(run, now, '§', `Glossaire : +${added} terme${added > 1 ? 's' : ''}`, 'info')
    if (focus === 'domain-modeling') reachStep(target, 'record', now)
  } else if ((m = /(?:^|\/)docs\/adr\/(\d{3,4})-([^/]+)\.md$/i.exec(norm))) {
    if (!known) {
      run.counters.adrs += 1
      log(run, now, '▲', `ADR ${m[1]} : ${words(m[2]!)}`, 'accent')
    }
    add('adr', `ADR ${m[1]}`, words(m[2]!))
  } else if ((m = /(?:^|\/)travail\/tasks\/(?:\d{4}-\d{2}-\d{2}_)?([^/]+)\.md$/i.exec(norm))) {
    // Un fichier de suivi par discussion : le compte rendu les relit tous, groupe par groupe.
    const group = runningGroupOf(run, run.tickets)
    if (!known) log(run, now, '▥', `Fichier de suivi : ${words(m[1]!)}`, 'info')
    add('tracking', `Suivi · ${words(m[1]!)}`, group ? `groupe ${group.id} · ${shown}` : (known?.detail ?? shown))
  } else if ((m = /(?:^|\/)docs\/plans\/(?:\d{4}-\d{2}-\d{2}_)?([^/]+)\.md$/i.exec(norm))) {
    const cited = planTicket(run, change.content)
    if (!known) log(run, now, '▤', `Plan écrit : ${words(m[1]!)}`, 'ok')
    add('plan', `Plan · ${words(m[1]!)}`, cited ? `pour : ${cited}` : (known?.detail ?? shown))
  } else if ((m = /(?:^|\/)\.scratch\/([^/]+)\/issues\/(\d+)-([^/]+)\.md$/i.exec(norm))) {
    const id = m[2]!
    const heading = /^#\s+(.+)$/m.exec(change.content ?? '')?.[1]?.trim()
    const status = statusFromFile(text)
    const was = run.tickets.find(t => sameTicket(t.id, id))
    if (!was) {
      run.tickets = [...run.tickets, { id, name: clip(heading ?? words(m[3]!), TEXT_MAX), status: status ?? 'todo' }].slice(0, LIMITS.tickets)
      if (phase.skill === 'to-tickets') reachStep(phase, 'publish', now)
    } else if (status && status !== was.status) {
      setTickets(run, [{ id: was.id, status }], now, b.session)
    }
  } else if ((m = /(?:^|\/)\.scratch\/([^/]+)\/spec\.md$/i.exec(norm))) {
    if (!known) log(run, now, '▤', `Spec écrite : ${words(m[1]!)}`, 'ok')
    add('spec', `Spec · ${words(m[1]!)}`, shown)
    if (phase.skill === 'to-spec') reachStep(phase, 'publish', now)
  } else if (/architecture-review-[^/]*\.html$/i.test(norm)) {
    if (!known) log(run, now, '▲', 'Rapport d’architecture écrit', 'ok')
    add('report', 'Rapport d’architecture', norm.split('/').pop())
    if (focus === 'improve-codebase-architecture') reachStep(target, 'report', now)
  } else if (/(?:^|\/)to-questionnaire-[^/]+\.md$/i.test(norm)) {
    add('questionnaire', 'Questionnaire', shown)
    if (focus === 'to-questionnaire') reachStep(target, 'write', now)
  } else if (/(?:^|\/)lessons\/\d{3,4}-[^/]+\.html$/i.test(norm)) {
    if (!known) log(run, now, '✎', `Leçon : ${norm.split('/').pop()}`, 'ok')
    add('lesson', 'Leçon', norm.split('/').pop())
    if (focus === 'teach') reachStep(target, 'lesson', now)
  } else if (/(?:^|\/)learning-records\/[^/]+\.md$/i.test(norm)) {
    add('doc', 'Acquis', norm.split('/').pop())
    if (focus === 'teach') reachStep(target, 'record', now)
  } else if (/(?:^|\/)docs\/agents\/[^/]+\.md$/i.test(norm)) {
    add('config', `Config · ${norm.split('/').pop()}`, shown)
    if (focus === 'setup-matt-pocock-skills') reachStep(target, 'write', now)
  } else if (/(?:^|\/)(?:CODING_STANDARDS|CLAUDE|AGENTS|SKILL|MISSION|RESOURCES)\.md$/i.test(norm)) {
    add('doc', norm.split('/').pop() ?? shown, shown)
    if (focus === 'writing-for-agents') reachStep(target, 'write', now)
  } else if (focus === 'research' && /\.md$/i.test(norm)) {
    if (!known) log(run, now, '✧', `Rapport de recherche : ${norm.split('/').pop()}`, 'ok')
    add('research', 'Recherche', shown)
    reachStep(target, 'write', now)
  } else if (focus === 'handoff' && /(?:\/temp\/|\/tmp\/|\/tmpdir\/)/i.test(lower)) {
    add('handoff', 'Document de passation', norm.split('/').pop())
    reachStep(target, 'save', now)
  } else if (focus === 'prototype' && (/\.(?:html|[jt]sx|vue|svelte)$/i.test(norm) || /prototype/i.test(norm))) {
    if (!known) log(run, now, '✦', `Prototype : ${norm.split('/').pop()}`, 'accent')
    add('prototype', 'Prototype', shown)
    reachStep(target, 'build', now)
  } else if (focus === 'wizard' && /\.sh$/i.test(norm)) {
    add('script', 'Script guidé', shown)
    reachStep(target, 'script', now)
  } else if (TEST_FILE.test(norm)) {
    if (!run.touched.includes(lower)) run.counters.testFiles += 1
    if (focus === 'tdd') reachStep(target, 'cycles', now)
    if (focus === 'implement') reachStep(target, 'tdd', now)
  }

  if (!run.touched.includes(lower)) run.touched = [...run.touched, lower].slice(-LIMITS.touched)
  run.updatedAt = now
  return { board: b, fx }
}

// ─── Asana (update_tasks), repris de ticket-board ─────────────────────────

const setFound = (run: Run, changes: StatusChange[], now: number) => {
  if (!run.found || run.found.length === 0) return
  run.found = run.found.map(f => {
    const change = changes.find(c => sameTicket(c.id, f.id))
    if (!change || (change.status === f.status && change.why === f.why)) return f
    if (change.status === 'done' && f.status !== 'done') log(run, now, '✓', `Trouvé en route, fait : ${f.name}`, 'ok')
    return keepWhy({ ...f, status: change.status, ...(change.why ? { why: change.why } : {}) })
  })
}

/**
 * Les skills qui publient le lot lui-même : ce qu'ils créent dans le tracker, ce sont les tickets,
 * pas des trouvailles. Pas la rétro : elle publie aussi des issues sur un autre dépôt, et son lot
 * arrive par l'outil (une trouvaille qu'il envoie dans les tickets entre dans le lot).
 */
const LOT_SKILLS = new Set(['to-tickets', 'to-spec', 'triage'])

const isFindingTime = (run: Run): boolean => {
  const { phase, detour } = focusOf(run)
  return !LOT_SKILLS.has((detour ?? phase).skill)
}

/** Ajoute une trouvaille, sauf si la tâche est déjà au tableau (lot, externe, trouvée). */
const addFound = (run: Run, task: Omit<FoundTask, 'at'>, now: number): boolean => {
  const isKnown = (id: string) =>
    run.tickets.some(t => sameTicket(t.id, id)) ||
    externalsOf(run).some(x => isSoundExternal(x) && sameTicket(x.id, id)) ||
    (run.found ?? []).some(f => sameTicket(f.id, id))
  if (task.id === '' || isKnown(task.id)) return false
  run.found = [...(run.found ?? []), { ...task, at: now }].slice(-LIMITS.found)
  log(run, now, '✚', `Trouvé en route : ${task.name}`, 'info')
  return true
}

/** Le texte d'un résultat d'outil MCP : chaîne, blocs `{ type, text }`, ou `{ content }`. */
const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textOf).join('\n')
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.text === 'string') return o.text
    if (o.content !== undefined) return textOf(o.content)
  }
  return ''
}

/** Les tâches que `create_tasks` d'Asana dit avoir créées : `{ data: [{ gid, name }] }`. */
const createdTasks = (result: unknown): { id: string; name: string }[] => {
  let data: unknown = result !== null && typeof result === 'object' && !Array.isArray(result) ? (result as { data?: unknown }).data : undefined
  if (!Array.isArray(data)) {
    try {
      data = (JSON.parse(textOf(result)) as { data?: unknown }).data
    } catch {
      data = undefined
    }
  }
  return asList(data)
    .map(d => ({ id: typeof d.gid === 'string' ? d.gid : '', name: str(d.name) }))
    .filter(d => /^\d{6,20}$/.test(d.id))
}

/**
 * Des tâches créées dans Asana pendant la mission (hors des skills qui publient le lot) : elles
 * vont dans « Trouvé en route », avec le statut de leur ligne « Statut : ».
 */
export const applyCreatedTasks = (board: Board, tasks: unknown, result: unknown, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || !isFindingTime(run0)) return null
  const created = createdTasks(result)
  if (created.length === 0) return null
  const input = asList(tasks)
  const b = clone(board)
  const run = activeRun(b)!
  let added = 0
  created.forEach((c, i) => {
    const source = input.find(t => str(t.name) === c.name) ?? input[i]
    const line = statusLine(source?.notes)
    const isAdded = addFound(
      run,
      {
        id: c.id,
        name: clip(c.name || str(source?.name) || c.id, TEXT_MAX),
        status: source?.completed === true ? 'done' : (line?.status ?? 'todo'),
        ...(line?.why ? { why: line.why } : {}),
        ...(str(source?.assignee) !== '' ? { isForUser: true } : {}),
      },
      now,
    )
    if (isAdded) added += 1
  })
  if (added === 0) return null
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** « Statut : à trancher » ou « à confirmer » en tête des notes Asana : une décision attendue. */
const isDecisionNote = (notes: unknown): boolean => {
  if (typeof notes !== 'string') return false
  const line = notes.trimStart().toLowerCase()
  return line.startsWith('statut :') && /^(?:à trancher|à confirmer)/.test(line.slice('statut :'.length).trim())
}

export const applyAsana = (board: Board, tasks: unknown, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || (run0.tickets.length === 0 && externalsOf(run0).length === 0 && (run0.found ?? []).length === 0)) return null
  const changes = asList(tasks)
    .map(asanaChange)
    .filter((c): c is StatusChange => c !== null)
  const b = clone(board)
  const run = activeRun(b)!
  const ticketsBefore = run.tickets
  let moved = changes.length > 0 ? setTickets(run, changes, now, b.session) : 0
  restartTicketSteps(run, ticketsBefore, now)
  if (changes.length > 0 && (run.found ?? []).length > 0) {
    const foundBefore = JSON.stringify(run.found)
    setFound(run, changes, now)
    if (JSON.stringify(run.found) !== foundBefore) moved += 1
  }
  for (const t of asList(tasks)) {
    const id = typeof t.task === 'string' ? t.task : ''
    const list = externalsOf(run)
    const at = list.findIndex(x => isSoundExternal(x) && sameTicket(x.id, id))
    if (at < 0) continue
    const x = list[at]!
    // Cochée, la tâche lève le bloqueur ; décochée, elle le rouvre (décision de Mathis du 08/11/2026) : avec un envoi
    // explicite "status": "todo", les deux seuls chemins de réouverture. Daté dans les deux cas.
    const status: 'todo' | 'done' = t.completed === true ? 'done' : t.completed === false ? 'todo' : x.status
    const isDecision = typeof t.notes === 'string' ? isDecisionNote(t.notes) : x.isDecision
    if (status === x.status && isDecision === x.isDecision) continue
    if (status === 'done' && x.status !== 'done') log(run, now, '✓', `Dépendance externe levée : ${x.name}`, 'ok')
    if (status === 'todo' && x.status === 'done') log(run, now, '↺', `Dépendance externe rouverte : ${x.name}`, 'warn')
    list[at] = { ...x, status, isDecision, ...(status !== x.status ? { statusAt: now } : {}) }
    moved += 1
  }
  if (moved === 0) return null
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

// ─── Spécialistes ──────────────────────────────────────────────────────────

export type AgentStart = {
  key: string
  name: string
  model?: string
  /** `subagent_type` de l'appel. */
  type?: string
  isBackground: boolean
}

/**
 * Un appel Agent part pendant la mission active : ses étapes avancent (relecteurs, alternatives,
 * exploration, sources). Le spécialiste lui-même vit dans le registre de la session, plus dans la mission (S1).
 */
export const applyAgentStart = (board: Board, start: AgentStart, now: number): Outcome => {
  if (!activeRun(board)) return null
  const b = clone(board)
  const run = activeRun(b)!
  const { phase, detour } = focusOf(run)
  const target = detour ?? phase
  const focus = target.skill
  if (focus === 'code-review') reachStep(target, 'reviewers', now)
  if (focus === 'codebase-design') reachStep(target, 'alternatives', now)
  if (focus === 'improve-codebase-architecture') reachStep(target, 'explore', now)
  if (focus === 'research') reachStep(target, 'sources', now)
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** Un spécialiste tel que `$.agent.list()` le donne : son id, sa description, où en est sa boucle. */
export type LiveAgent = { id: string; description: string; status: string }

/**
 * Le board dont l'ancien champ des spécialistes est vidé (S1, S21 : une liste vide, qu'une version
 * d'avant lit sans casser), seulement pour les missions dont toutes les lignes sont déjà recopiées
 * (`isCopied`) ; null quand aucun ne change.
 */
export const stripRunAgents = (board: Board, isCopied: (run: Run) => boolean = () => true): Board | null => {
  const isDue = (r: Run) => (r.agents?.length ?? 0) > 0 && isCopied(r)
  if (!board.runs.some(isDue)) return null
  return { ...board, runs: board.runs.map(r => (isDue(r) ? { ...r, agents: [] } : r)) }
}

/** Un spécialiste de la mission active a fini : la mission a vécu (son seuil d'abandon repart). */
export const applyAgentActivity = (board: Board, now: number): Outcome => {
  if (!activeRun(board)) return null
  const b = clone(board)
  activeRun(b)!.updatedAt = now
  return { board: b, fx: noFx() }
}

// ─── Mode auto ────────────────────────────────────────────────────────────
//
// L'auto d'une mission tient en deux dates : « allumé à », posée seulement par un clic de la personne
// (« Confirmer », ou « Lancer en auto » sur une carte du COO, que la discussion lancée applique), et « éteint à ». Il est actif quand la première est plus récente que la seconde. Chaque
// date se fusionne à la plus récente des deux copies (`keepAuto`), jamais par la copie la plus récente
// de la mission : une copie en retard ne rallume rien. Une date hors forme le dit éteint. L'état relu
// passe par un seul point de bornage (`readAuto`) : chaque lecture le reçoit propre.

/**
 * Les raisons d'un arrêt de l'auto, telles qu'elles s'enregistrent (`offWhy`) : un champ enregistré,
 * relu par des copies plus anciennes du mod, qui ne change pas avec le vocabulaire. Le bandeau les dit
 * par `stopLabel` (« ⚡ Auto en pause : <raison> »).
 */
export const AUTO_STOPS = {
  click: 'coupé par toi',
  aside: 'parcours mis de côté',
  closed: 'parcours clos',
  finished: 'parcours terminé',
  archived: 'parcours archivé',
  ended: 'discussion fermée',
  unreadable: 'lecture du parcours ratée',
  unwritten: 'écriture du parcours ratée',
  limit: 'limite de 200 choix atteinte',
  report: 'rapport prêt',
  quota: 'quota atteint',
  stuck: 'plus rien ne peut avancer sans toi',
  /** Le message du mod qui donne à Claude la consigne de l'allumage n'est pas entré dans la session. */
  unbriefed: 'Claude pas prévenu',
} as const

/** Ce que le bandeau et les notifications disent d'une raison enregistrée dans l'ancien vocabulaire. */
const STOP_LABELS: Readonly<Record<string, string>> = {
  [AUTO_STOPS.aside]: 'mission mise de côté',
  [AUTO_STOPS.closed]: 'mission close',
  [AUTO_STOPS.finished]: 'mission terminée',
  [AUTO_STOPS.archived]: 'mission archivée',
  [AUTO_STOPS.unreadable]: 'lecture de la mission ratée',
  [AUTO_STOPS.unwritten]: 'écriture de la mission ratée',
}

/** Le libellé d'une raison d'arrêt : la raison elle-même, sauf celles que `STOP_LABELS` renomme. */
export const stopLabel = (why: string): string => STOP_LABELS[why] ?? why

/** Les pauses déduites, sans écriture : l'auto reste allumé, mais cette discussion n'envoie pas. */
export const AUTO_PAUSES = {
  changed: 'discussion changée',
  paused: 'mission en pause',
  /** Allumé au nom de cette discussion, sans la date de son clic gardée ici : un fichier seul ne rallume rien. */
  unconfirmed: 'allumage non confirmé ici',
} as const

/**
 * Les arrêts qui ne sont pas des pauses : un geste de la personne, ou la mission qui se termine.
 * L'auto est éteint, et ni le bandeau ni une notification n'en disent rien.
 */
const QUIET_STOPS: ReadonlySet<string> = new Set([AUTO_STOPS.click, AUTO_STOPS.aside, AUTO_STOPS.closed, AUTO_STOPS.finished, AUTO_STOPS.archived])

/** Longueur gardée de l'id de la discussion qui l'a allumé : bien au-delà d'un id réel. */
const AUTO_ID_MAX = 200

/** Les raisons qu'un arrêt peut porter ; une raison relue hors de cette liste se lit `UNKNOWN_STOP`. */
const KNOWN_STOPS: ReadonlySet<string> = new Set(Object.values(AUTO_STOPS))
const UNKNOWN_STOP = 'raison inconnue'

/** La pause d'un groupe revenu trop de fois pour repartir seul : « deuxième échec du groupe <id> ». */
const GROUP_FAIL_PREFIX = 'deuxième échec du groupe '
export const groupFailStop = (id: string): string => `${GROUP_FAIL_PREFIX}${id}`

/** Une raison d'arrêt connue : une de `AUTO_STOPS`, ou le deuxième échec d'un groupe à l'id en forme. */
const isKnownStop = (why: string): boolean => KNOWN_STOPS.has(why) || (why.startsWith(GROUP_FAIL_PREFIX) && isGroupId(why.slice(GROUP_FAIL_PREFIX.length)))

/**
 * L'état auto relu d'une mission, borné ici et nulle part ailleurs : des dates lisibles, l'id de la
 * discussion qui l'a allumé, une raison prise dans `AUTO_STOPS`. `isDamaged` : l'état est là mais
 * abîmé (pas un objet, une date hors forme). Un « éteint à » hors forme est ramené au dernier
 * « allumé à » lisible, pour que l'auto se lise éteint ; sans « allumé à » lisible, l'état n'a plus de
 * date d'allumage, et l'auto reste éteint, ici comme à la fusion (`mergeAuto`).
 */
const readAuto = (raw: unknown): { auto?: RunAuto; isDamaged: boolean } => {
  if (raw === undefined) return { isDamaged: false }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { isDamaged: true }
  const x = raw as Record<string, unknown>
  const onAt = isTime(x.onAt) ? x.onAt : undefined
  const isOffDamaged = x.offAt !== undefined && !isTime(x.offAt)
  const isDamaged = isOffDamaged || (x.onAt !== undefined && onAt === undefined)
  const offAt = isTime(x.offAt) ? x.offAt : isOffDamaged ? onAt : undefined
  const onBy = clip(str(x.onBy), AUTO_ID_MAX)
  const why = str(x.offWhy)
  const offWhy = isOffDamaged && offAt !== undefined ? AUTO_STOPS.unreadable : why === '' ? '' : isKnownStop(why) ? why : UNKNOWN_STOP
  const auto: RunAuto = {
    ...(onAt !== undefined ? { onAt, ...(onBy !== '' ? { onBy } : {}) } : {}),
    ...(offAt !== undefined ? { offAt, ...(offWhy !== '' ? { offWhy } : {}) } : {}),
  }
  return Object.keys(auto).length > 0 ? { auto, isDamaged } : { isDamaged }
}

const autoOf = (run: Run): RunAuto | undefined => readAuto(run.auto).auto

/** Un état éteint par une pause posée par le mod ou la fin de la discussion : ni un geste de la personne, ni la fin de la mission. */
export const isStoredPause = (auto: RunAuto | undefined): boolean => !isAutoOnIn(auto) && auto?.offWhy !== undefined && !QUIET_STOPS.has(auto.offWhy)

/** L'auto est actif : « allumé à » plus récent que « éteint à ». */
const isAutoOnIn = (auto: RunAuto | undefined): boolean => auto?.onAt !== undefined && (auto.offAt === undefined || auto.onAt > auto.offAt)

export const isAutoOn = (run: Run): boolean => isAutoOnIn(autoOf(run))

/**
 * Ce que l'auto d'une mission fait vu de la discussion `here` (son id du moment, lu après un `/clear`) :
 * la seule fonction qui dit s'il envoie ici (`on`). Il envoie quand il est actif, que cette discussion
 * est celle qui l'a allumé, et que la mission y est active. Sinon : `elsewhere`, allumé sur une mission
 * suivie par une autre discussion (rien n'y dit si elle est celle qui l'a allumé) ; `paused`, une pause
 * déduite (discussion changée, mission en pause) ou posée par un arrêt qui n'est ni un geste de la
 * personne ni la fin de la mission ; `off`, éteint.
 */
export type AutoView = { kind: 'off' } | { kind: 'on' } | { kind: 'elsewhere' } | { kind: 'paused'; why: string }

/**
 * `confirmedAt` : la date du second clic que cette discussion garde à part (`$.store`), null sans clic
 * gardé ; l'auto n'envoie d'ici que si l'« allumé à » fusionné la vaut : un fichier de mission seule,
 * forgé ou rejoué, ne le rallume jamais. Absent : pas vérifié (une lecture qui n'envoie rien).
 */
export const autoStateOf = (run: Run, board: Board, here: string, confirmedAt?: number | null): AutoView => {
  const auto = autoOf(run)
  if (!auto) return { kind: 'off' }
  if (!isAutoOnIn(auto)) return isStoredPause(auto) ? { kind: 'paused', why: stopLabel(auto.offWhy!) } : { kind: 'off' }
  const isHere = board.delegate === undefined && board.activeId === run.id && run.status === 'active'
  if (!isHere) return run.status === 'active' ? { kind: 'elsewhere' } : { kind: 'paused', why: AUTO_PAUSES.paused }
  if (auto.onBy === undefined || auto.onBy !== clip(str(here), AUTO_ID_MAX)) return { kind: 'paused', why: AUTO_PAUSES.changed }
  return confirmedAt === undefined || confirmedAt === auto.onAt ? { kind: 'on' } : { kind: 'paused', why: AUTO_PAUSES.unconfirmed }
}

/**
 * L'auto d'une mission est allumé au nom de la discussion `here`, avec la date de son clic gardée ici
 * (`confirmedAt`) : il envoie d'ici, ou y reprendra sans nouveau clic (pause déduite : la mission mise
 * en pause par l'ouverture d'une autre). Pour la fusion d'ici, seules les traces de retrait écrites ici
 * s'appliquent alors à cette mission ; l'union revient dès que l'auto s'éteint. `unread` : la date du clic
 * ne s'est pas lue ce coup-ci ; dans le doute, l'auto compte allumé d'ici (sens sûr : une trace
 * d'ailleurs ne retire rien pendant une lecture ratée).
 */
export const isAutoLitBy = (run: Run, here: string, confirmedAt: number | null | 'unread'): boolean => {
  const auto = autoOf(run)
  const isConfirmed = confirmedAt === 'unread' || (confirmedAt !== null && confirmedAt === auto?.onAt)
  return isAutoOnIn(auto) && auto?.onBy !== undefined && str(here) !== '' && auto.onBy === clip(str(here), AUTO_ID_MAX) && isConfirmed
}

/**
 * L'« allumé à » que poserait un second clic maintenant : après « éteint à » et après l'allumage
 * précédent, même quand l'horloge les place avant. La discussion le garde à part avant d'allumer.
 */
export const nextAutoOnAt = (run: Run, now: number): number => {
  const was = autoOf(run)
  return Math.max(now, (was?.offAt ?? -1) + 1, (was?.onAt ?? -1) + 1)
}

/**
 * Éteint l'auto d'une mission active : « éteint à » après « allumé à » (et après la coupure d'avant),
 * même quand l'horloge le place avant (date venue d'ailleurs), pour que l'arrêt tienne. Éteint, il
 * n'écrit rien, sauf pour remplacer la raison d'une pause par celle d'un geste de la personne. Rend
 * vrai s'il a écrit.
 */
const stopAuto = (run: Run, now: number, why: string): boolean => {
  const auto = autoOf(run)
  // Déjà éteint par une pause (fin de discussion, lecture ratée) : un geste de la personne remplace sa
  // raison, pour que le bandeau ne redise plus la pause qu'elle vient de trancher.
  const isRelabel = isStoredPause(auto) && QUIET_STOPS.has(why)
  if (!isAutoOnIn(auto) && !isRelabel) return false
  run.auto = { ...auto, offAt: Math.max(now, (auto!.onAt ?? -1) + 1, (auto!.offAt ?? -1) + 1), offWhy: why }
  log(run, now, '⚡', `Mode auto éteint : ${stopLabel(why)}`, 'info')
  return true
}

/**
 * Le second clic de la personne (« Confirmer ») sur la mission active ici : « allumé à » et « allumé
 * par » (`here`, l'id de la discussion du clic). « Allumé à » passe après « éteint à » et après
 * l'allumage précédent, même quand l'horloge les place avant ; l'état est réécrit borné.
 */
export const switchOnAuto = (board: Board, here: string, now: number, confirmedAt?: number | null): Outcome => {
  const run0 = activeRun(board)
  // Déjà allumé d'ici, avec la date de son clic gardée ici (`confirmedAt`) : rien à faire ; sans elle, le clic rallume.
  if (!run0 || board.delegate || str(here) === '' || autoStateOf(run0, board, here, confirmedAt).kind === 'on') return null
  const b = clone(board)
  const run = activeRun(b)!
  const was = autoOf(run)
  const onAt = nextAutoOnAt(run, now)
  run.auto = { onAt, onBy: clip(str(here), AUTO_ID_MAX), ...(was?.offAt !== undefined ? { offAt: was.offAt, ...(was.offWhy !== undefined ? { offWhy: was.offWhy } : {}) } : {}) }
  delete run.waitsUser
  run.updatedAt = now
  log(run, now, '⚡', 'Mode auto allumé', 'accent')
  return { board: b, fx: { ...noFx(), toasts: [`⚡ Auto allumé : ${run.title}`] } }
}

/**
 * Le fichier de mission ne s'est pas lu (une lecture ratée éteint l'auto, jamais l'inverse), au
 * chargement, à la sauvegarde ou à la relecture périodique : la copie de cette discussion éteint l'auto
 * de chacune de ses missions, raison « lecture de la mission ratée ». Null quand aucun n'était allumé.
 */
export const stopAutoUnread = (board: Board, now: number): Board | null => {
  if (!board.runs.some(isAutoOn)) return null
  const b = clone(board)
  // Sans toucher à `updatedAt` : la copie, peut-être périmée, ne doit pas l'emporter pour le reste de la
  // mission ; la coupure, elle, passe par la fusion date par date.
  for (const run of b.runs) stopAuto(run, now, AUTO_STOPS.unreadable)
  return b
}

/**
 * Le clic de coupure sur la mission active ici, en auto, qu'il envoie d'ici ou soit en pause déduite
 * (allumé par une autre discussion) : « éteint à », raison « coupé par toi ». Sur une pause posée par
 * le mod (fin de discussion, lecture ratée, limite), le même clic remplace sa raison : le bandeau n'en
 * dit plus rien.
 */
export const switchOffAuto = (board: Board, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || !(isAutoOn(run0) || isAutoPauseStored(run0))) return null
  const b = clone(board)
  const run = activeRun(b)!
  stopAuto(run, now, AUTO_STOPS.click)
  run.updatedAt = now
  return { board: b, fx: { ...noFx(), toasts: [`⚡ Auto coupé : ${run.title}`] } }
}

/** L'auto est éteint par une pause du mod (ni un geste de la personne ni la fin de la mission) : le bandeau la montre. */
export const isAutoPauseStored = (run: Run): boolean => isStoredPause(autoOf(run))

/** Éteint l'auto de la mission active ici, pour une raison du mod (`AUTO_STOPS`) ; null quand il n'était pas allumé. */
export const stopActiveAuto = (board: Board, why: string, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || !isAutoOn(run0)) return null
  const b = clone(board)
  const run = activeRun(b)!
  stopAuto(run, now, why)
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

// ─── Envois du mode auto ──────────────────────────────────────────────────
//
// Chaque action que l'auto envoie a une clé stable et une marque dans la mission, posée avant l'envoi :
// « envoyée », puis « démarrée » quand son tour commence. Invariant : une même action auto (phase,
// vague, groupe, revue) n'est jamais envoyée deux fois. Les marques ne se coupent jamais : seuls
// « ↻ Renvoyer », le retrait d'une marque qui n'est pas partie (écriture ratée, auto éteint avant
// l'envoi) et l'effacement de la mission en retirent. Deux copies s'unissent marque par marque, l'état le
// plus avancé gagnant, et chaque retrait laisse une trace datée (les 100 plus récentes) qu'une copie en
// retard ne défait pas. Une liste relue abîmée bloque tout envoi (le sens sûr).

/** Les traces de retrait (« ↻ Renvoyer », marque qui n'est pas partie) gardées, les plus récentes : une copie plus en retard ferait revenir une marque, et l'action ne repartirait pas (sens sûr). */
export const AUTO_RESENT_MAX = 100

/** Longueur la plus grande d'une clé relue : au-delà, l'entrée est abîmée. */
const AUTO_KEY_MAX = 200

/** Sans démarrage après ce délai, la discussion au repos, une marque « envoyée » devient la question « envoi resté sans suite ». */
export const AUTO_STALE_MS = 2 * 60_000

/** Les phases que l'auto lance lui-même ; jamais la livraison, la rétro, la clôture ni la validation du rapport. */
export const AUTO_PHASES: ReadonlySet<string> = new Set(['to-spec', 'to-tickets', 'implement', 'compte-rendu'])

/** Le préfixe de l'id de la question « envoi resté sans suite » d'une marque : suivi de sa clé. */
export const STALE_PREFIX = 'sans-suite:'

/** Le début de l'id de la question d'une opposition entre missions, posée par le mod. */
export const OPPOSITION_PREFIX = 'opposition:'

/**
 * Les pistes non cochées chez le COO d'une rétro portée ici, une fois écrites dans la boîte « À reprendre » :
 * écartées de sa phase de rétro en cours (ni découpées, ni recopiées une seconde fois à sa clôture). Seulement
 * des pistes encore à faire.
 */
export const setAsidePistes = (board: Board, runId: string, ids: readonly string[], now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.id !== runId || currentPhase(run0).skill !== 'retro' || !currentPhase(run0).items.some(i => ids.includes(i.id) && i.status === 'todo')) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  const moved = phase.items.filter(i => ids.includes(i.id) && i.status === 'todo').map(i => i.id)
  phase.items = phase.items.map(i => (moved.includes(i.id) ? { ...i, status: 'dropped' as const } : i))
  run.updatedAt = now
  log(run, now, '↺', `Pistes non cochées chez le COO, parties dans « À reprendre » : ${moved.join(', ')}`, 'info')
  return { board: b, fx: noFx() }
}

/** Retire, par le mod, la question d'une opposition une fois la réponse relayée par le COO entrée dans la discussion. */
export const withdrawOpposition = (board: Board, runId: string, id: string, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.id !== runId || !id.startsWith(OPPOSITION_PREFIX) || !readWaiting(run0).some(q => q.id === id)) return null
  const b = clone(board)
  const run = activeRun(b)!
  withdrawQuestion(run, id, now)
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * Une action que l'auto peut envoyer : sa clé, ce qu'elle est en mots, ce qu'elle bloque ; la commande
 * d'une phase (ou `/code-review` d'un lot sans groupes), ou un texte : les groupes d'une vague confiés à
 * leurs workers, la revue d'un groupe rendu, sa revue de sécurité (celle du lot, groupe « lot ») ; ou la
 * compaction d'après un découpage (`/compact`, lancée par le mod, sans texte).
 */
export type AutoAction = { key: string; what: string; blocks: WaitTarget } & (
  | { kind: 'command'; skill: string }
  | { kind: 'groups'; groups: string[] }
  | { kind: 'review'; group: string }
  | { kind: 'security'; group: string }
  | { kind: 'compact' }
)

/** Une marque relue : bornée ici et nulle part ailleurs ; `raw`, l'entrée telle qu'elle est enregistrée. */
type ReadMark = { mark: AutoMark | null; raw: unknown }

const readMark = (raw: unknown): ReadMark => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { mark: null, raw }
  const x = raw as Record<string, unknown>
  const key = str(x.key)
  if (key === '' || key.length > AUTO_KEY_MAX || !isTime(x.at)) return { mark: null, raw }
  // Une date de démarrage ou de « sans suite » présente mais illisible : la marque est abîmée, jamais lue « en attente ».
  if ((x.startedAt !== undefined && !isTime(x.startedAt)) || (x.staleAt !== undefined && !isTime(x.staleAt))) return { mark: null, raw }
  const b = x.blocks !== null && typeof x.blocks === 'object' ? (x.blocks as Record<string, unknown>) : {}
  const kind = WAIT_KINDS.find(k => k === b.kind)
  const target = kind && typeof b.id === 'string' && b.id !== '' && b.id.length <= AUTO_KEY_MAX ? { kind, id: b.id } : undefined
  const mark: AutoMark = {
    key,
    at: x.at,
    ...(isTime(x.startedAt) ? { startedAt: x.startedAt } : {}),
    ...(isTime(x.staleAt) ? { staleAt: x.staleAt } : {}),
    ...(typeof x.what === 'string' && x.what !== '' ? { what: clip(x.what, TEXT_MAX) } : {}),
    ...(target ? { blocks: target } : {}),
  }
  return { mark, raw }
}

/** Les marques relues d'une mission ; `isDamaged` : la liste n'est pas un tableau, ou une entrée ne se lit pas. */
const readMarks = (run: Run): { marks: AutoMark[]; entries: ReadMark[]; isDamaged: boolean } => {
  const raw: unknown = run.autoSent
  if (raw === undefined) return { marks: [], entries: [], isDamaged: false }
  if (!Array.isArray(raw)) return { marks: [], entries: [{ mark: null, raw }], isDamaged: true }
  const entries = raw.map(readMark)
  return { marks: entries.flatMap(e => (e.mark ? [e.mark] : [])), entries, isDamaged: entries.some(e => e.mark === null) }
}

/** Les traces de « ↻ Renvoyer » relues : une clé et une date lisibles, la plus récente par clé. */
const readResent = (list: readonly unknown[]): { key: string; at: number }[] => {
  const byKey = new Map<string, number>()
  for (const t of list) {
    if (t === null || typeof t !== 'object') continue
    const x = t as Record<string, unknown>
    const key = str(x.key)
    if (key === '' || key.length > AUTO_KEY_MAX || !isTime(x.at)) continue
    byKey.set(key, Math.max(byKey.get(key) ?? -1, x.at))
  }
  return [...byKey].map(([key, at]) => ({ key, at }))
}

const resentOf = (run: Run): { key: string; at: number }[] => readResent(Array.isArray(run.autoResent) ? (run.autoResent as unknown[]) : [])

/** Les marques d'envoi de la mission, lues : pour l'affichage et les tests. */
export const autoMarksOf = (run: Run): AutoMark[] => readMarks(run).marks

/** L'action de cette clé est déjà partie (ou la liste des marques est abîmée : rien ne part). */
const isMarked = (run: Run, key: string): boolean => {
  const read = readMarks(run)
  return read.isDamaged || read.marks.some(m => m.key === key)
}

/** Une marque « envoyée » dont le tour n'a pas commencé : tant qu'il y en a une, rien d'autre ne part. */
export const pendingAutoMarks = (run: Run): AutoMark[] => readMarks(run).marks.filter(m => m.startedAt === undefined)

/** La clé d'une phase envoyée : son skill et son rang parmi les phases de ce skill de la mission, stable quand d'autres s'insèrent. */
const phaseKey = (run: Run, at: number): string => {
  const skill = run.phases[at]!.skill
  const rank = run.phases.slice(0, at + 1).filter(p => p.skill === skill).length
  return `phase:${skill}#${rank}`
}

/**
 * L'action que l'auto enverrait maintenant, la suite du bouton de l'étape suivante : la phase qui suit,
 * une fois la phase en cours finie (ou un lot de groupes clos, `isGroupLotOver`), quand c'est une des phases que l'auto lance. Null sinon (pas finie,
 * une suite qui n'est pas une commande, la livraison, la rétro, la clôture).
 */
export const autoActionOf = (run: Run, opts: SuggestOpts = {}, outside?: ReadonlyMap<string, readonly OutsideHold[]>): AutoAction | null => {
  const phase = currentPhase(run)
  if ((phase.status !== 'done' && !isGroupLotOver(run, opts.security)) || run.status !== 'active') return null
  const skill = nextCommandSkill(run, opts, outside)
  if (skill === null || !AUTO_PHASES.has(skill)) return null
  const at = run.phases.findIndex((p, i) => i > run.cursor && p.status === 'pending' && (p.skill === skill || p.alts.includes(skill)))
  const key = at >= 0 ? phaseKey(run, at) : `phase:${skill}#next-${run.cursor}`
  return { kind: 'command', key, skill, what: `/${skill}`, blocks: { kind: 'phase', id: skill } }
}

/**
 * Revenu ce nombre de fois de son worker (`returnsOf`, un envoi annulé ne compte pas), un groupe
 * aux tickets ouverts ne repart plus seul : il est renvoyé une fois, puis une question le bloque.
 */
export const AUTO_GROUP_SENDS = 2

/** Le préfixe de l'id de la question d'un groupe revenu trop de fois pour repartir seul : suivi de `<groupe>#<envoi>`. */
export const RELAUNCH_PREFIX = 'relance:'

/** Une unité (`A#2`) est déjà nommée par une marque de cette sorte (`groups:`, `review:`) : une clé `groups:A#1+B#1` couvre chacun de ses groupes. */
const isUnitMarked = (run: Run, prefix: string, unit: string): boolean => {
  const read = readMarks(run)
  return read.isDamaged || read.marks.some(m => m.key.startsWith(prefix) && m.key.slice(prefix.length).split('+').includes(unit))
}

/** L'envoi d'un groupe (`A#2`) est déjà parti dans une vague. */
const isGroupSendMarked = (run: Run, unit: string): boolean => isUnitMarked(run, 'groups:', unit)

/**
 * Une phase où l'auto agit sur les groupes : l'implémentation, ou le découpage une fois fini (la carte « Ensuite »
 * propose alors les groupes), celui d'une rétro compris (ses pistes découpées, la Rétro finie) ; jamais une autre
 * phase à tickets. La même pour l'action des groupes, la garde des ids hors forme, le lot bloqué et les tâches attendues.
 */
const isGroupActionPhase = (phase: FlowPhase): boolean => phase.skill === 'implement' || ((phase.skill === 'to-tickets' || phase.skill === 'retro') && phase.status === 'done')

/**
 * Ce que l'auto ferait pour les groupes d'une phase à tickets, la suite des boutons de la ligne d'un
 * groupe et de la carte « Ensuite » : la revue d'un groupe rendu fini qui l'attend (texte de « ◆ Revue
 * du groupe · worker »), puis sa revue de sécurité conseillée et pas encore lancée ; sinon, quand
 * aucun groupe n'est en vol ni rendu fini sans être clos (la vague en cours close), la vague prête (le
 * lot parallèle, ou le seul groupe prêt), sans les groupes bloqués par une question ; `relaunch` : les
 * groupes revenus trop de fois pour repartir seuls, que l'auto ne lance pas (une question les bloque).
 */
export const autoGroupActionOf = (run: Run, outside?: ReadonlyMap<string, readonly OutsideHold[]>, review: SecurityReview = 'on'): { action: AutoAction | null; relaunch: string[] } => {
  const none = { action: null, relaunch: [] as string[] }
  const phase = currentPhase(run)
  if (!isGroupActionPhase(phase) || run.status !== 'active' || isBlocked(run, { kind: 'phase', id: phase.skill })) return none
  const groups = run.groups ?? []
  if (!groupPlan(run)) return none
  const finished = groups.filter(x => x.linked === undefined && isGroupDone(run, x) && isGroupId(x.id) && !isBlocked(run, { kind: 'group', id: x.id }))
  // Finis ici, sans worker : un seul /code-review les relit tous (« ◆ Revue du groupe »), une fois.
  // Un groupe déjà nommé par une marque de revue n'en reçoit pas d'autre, même si cette revue ne l'a pas marqué relu.
  const here = finished.filter(g => g.delegated === undefined && !isGroupReviewed(run, g) && !isUnitMarked(run, 'review:', hereUnitOf(g)))
  const hereKey = `review:${here.map(g => hereUnitOf(g)).join('+')}`
  if (here.length > 0 && !isMarked(run, hereKey)) {
    return { action: { kind: 'command', skill: 'final-review', key: hereKey, what: `/code-review des groupes ${here.map(g => g.id).join(', ')}`, blocks: { kind: 'group', id: here[0]!.id } }, relaunch: [] }
  }
  for (const g of finished.filter(x => x.delegated !== undefined)) {
    const seq = sendNumber(g.delegated?.seq) ?? 1
    const blocks: WaitTarget = { kind: 'group', id: g.id }
    if (!isGroupReviewed(run, g)) {
      // Rendu par son worker : sa revue se fait là-bas (« ◆ Revue du groupe · worker »).
      const key = `review:${g.id}#${seq}`
      if (!isMarked(run, key)) return { action: { kind: 'review', group: g.id, key, what: `revue du groupe ${g.id}`, blocks }, relaunch: [] }
      continue
    }
    const sec = g.security
    // La revue de sécurité désactivée pour le projet (relue « off »), ou le groupe clos alors qu'elle l'était
    // (`isClosedTurnedOff`) : l'auto ne la lance pas ; réactivée, elle redevient due pour tout autre groupe,
    // clos sans revue compris (comme avant le réglage).
    if (review !== 'off' && !isClosedTurnedOff(g) && g.delegated !== undefined && sec && typeof sec === 'object' && sec.isAdvised === true && sec.ranAt === undefined && sec.findings === undefined) {
      const key = `security:${g.id}#${seq}`
      if (!isMarked(run, key)) return { action: { kind: 'security', group: g.id, key, what: `revue de sécurité du groupe ${g.id}`, blocks }, relaunch: [] }
    }
  }
  // Une nouvelle vague attend que celle en cours soit close : rien en vol, rien de fini sans être clos.
  const returned = groups.filter(g => g.linked === undefined && g.delegated !== undefined && isGroupDone(run, g))
  if (groups.some(g => g.linked !== undefined) || returned.some(g => closeMissing(run, g, review).length > 0)) return none
  const rec = nextLaunchFor(run, outside)
  const picked = rec?.kind === 'parallel' ? rec.groups : rec?.kind === 'group' && rec.isDelegable ? [rec.group] : []
  const relaunch: string[] = []
  const units: string[] = []
  for (const id of picked) {
    const g = groups.find(x => x.id === id)
    if (!g || !isGroupId(id) || isBlocked(run, { kind: 'group', id })) continue
    const seq = groupSendSeq(g)
    // Ses envois revenus avec des tickets ouverts (un envoi annulé n'en est pas un) : un renvoi, pas deux.
    if (returnsOf(g) >= AUTO_GROUP_SENDS) {
      relaunch.push(`${id}#${seq}`)
      continue
    }
    if (!isGroupSendMarked(run, `${id}#${seq}`)) units.push(`${id}#${seq}`)
  }
  // Le lot proposé ne part pas parce qu'un groupe bloqué par une question y tenait la place : le premier
  // autre groupe prêt part seul. Jamais quand rien n'était proposé (un ticket en cours ici, rien de prêt).
  const isHeldOnly = picked.length > 0 && picked.every(id => isBlocked(run, { kind: 'group', id }))
  if (units.length === 0 && relaunch.length === 0 && isHeldOnly) {
    const other = groupPlan(run, outside)!.groups.find(v => isDelegable(v) && !v.isCyclic && isGroupId(v.group.id) && !picked.includes(v.group.id) && !isBlocked(run, { kind: 'group', id: v.group.id }) && returnsOf(v.group) < AUTO_GROUP_SENDS)
    if (other && !isGroupSendMarked(run, `${other.group.id}#${groupSendSeq(other.group)}`)) units.push(`${other.group.id}#${groupSendSeq(other.group)}`)
  }
  if (units.length === 0) return { action: null, relaunch }
  const ids = units.map(u => u.replace(/#\d+$/, ''))
  const what = `${ids.length > 1 ? 'groupes' : 'groupe'} ${ids.join(', ')} dans un worker`
  return { action: { kind: 'groups', groups: ids, key: `groups:${units.join('+')}`, what, blocks: { kind: 'group', id: ids[0]! } }, relaunch }
}

/** Ce que bloquent les actions de l'auto pour un lot sans groupes : la phase Implémentation. */
const LOT_BLOCKS: WaitTarget = { kind: 'phase', id: 'implement' }

/**
 * Le passage du lot qu'une marque nomme : la date de la dernière revue du lot, 0 sans revue ; une revue
 * à refaire (datée dans le futur, gardée en négatif à la lecture) nomme sa propre date, jamais `lot@0`,
 * pour qu'une marque d'un passage sans revue ne la retienne pas.
 */
const lotPassOf = (run: Run): string => {
  const raw: unknown = run.reviewedAt
  return `lot@${isTime(raw) || (typeof raw === 'number' && isTime(-raw)) ? raw : 0}`
}

/**
 * La clé de la revue d'un lot à relire : `review:lot@<dernière revue>~<dernière fin de ticket, 0 sans>~<empreinte
 * des tickets faits>`. La revue d'un lot qui a vu d'autres tickets a une autre clé : après une revue refusée à la fusion
 * (elle n'avait pas vu un ticket fini ici), la marque que l'autre copie a posée sur la même revue de base
 * ne retient pas celle d'ici. La même pour l'auto et pour « ◆ Revue ».
 */
const lotReviewKeyOf = (run: Run): string => `review:${lotPassOf(run)}~${lastTicketFinishOf(run) ?? 0}~${doneTicketsPrint(run)}`

/**
 * L'empreinte des tickets faits du lot (leurs ids et leurs dates de fin, triés), courte : deux lots qui
 * n'ont pas vu les mêmes tickets finis ont deux empreintes, même quand le ticket qui manque n'est pas
 * la dernière fin (un ticket sans date lisible, une horloge reculée, la même milliseconde).
 */
const doneTicketsPrint = (run: Run): string => {
  const seen = run.tickets
    .filter(t => t.status === 'done')
    .map(t => `${t.id}:${isTime(t.finishedAt) ? t.finishedAt : '-'}`)
    .sort()
    .join('|')
  let hash = 0x811c9dc5
  for (let i = 0; i < seen.length; i++) hash = Math.imul(hash ^ seen.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(36)
}

/**
 * Ce que l'auto ferait pour un lot sans groupes pendant l'Implémentation, quel que soit son état (finie
 * par un `{"complete": true}` envoyé trop tôt comprise) : la revue du lot à relire, une fois par passage
 * (`lotReviewKeyOf`), avant le compte rendu ; puis sa
 * revue de sécurité conseillée, postérieure à la dernière fin de ticket et pas lancée
 * (`security:lot@<date de la dernière revue, celle du passage relu>`), une fois par revue du lot : un
 * `/code-review` rechargé fait tomber l'avis (il doit suivre la dernière revue), et l'avis de cette
 * revue fait relancer la sécurité sous sa clé. Rien tant qu'une tâche de fond tourne (`inFlight` :
 * un spécialiste que Claude a lancé ne pose aucune date de lancement), ni quand une question bloque la
 * phase, ni pour un lot dispensé, même avec un avis explicite. Invariant : une revue du lot n'est jamais
 * envoyée deux fois par l'auto pour le même passage, et une marque d'un passage précédent n'empêche
 * jamais la revue d'un passage suivant (la clé change avec la date de la revue et les tickets faits).
 */
const autoLotActionOf = (run: Run, inFlight: boolean, review: SecurityReview = 'on'): AutoAction | null => {
  const phase = currentPhase(run)
  if (phase.skill !== 'implement' || run.status !== 'active' || (run.groups ?? []).length > 0 || inFlight || isBlocked(run, LOT_BLOCKS) || isLotReviewEnough(run)) return null
  if (needsReview(run)) {
    const key = lotReviewKeyOf(run)
    return isMarked(run, key) ? null : { kind: 'command', skill: 'final-review', key, what: '/code-review du lot', blocks: LOT_BLOCKS }
  }
  // La revue de sécurité désactivée pour le projet : l'auto ne la lance pas.
  if (review === 'off') return null
  const sec: unknown = run.security
  if (sec === null || typeof sec !== 'object' || !isLotAdviceCurrent(run) || !isAllDone(run, run.tickets.map(t => t.id))) return null
  const check = sec as SecurityCheck
  if (check.isAdvised !== true || check.ranAt !== undefined || check.findings !== undefined) return null
  // Une revue de sécurité par revue du lot : l'avis ne compte que s'il suit la dernière revue, si bien
  // qu'une revue rechargée en demande une nouvelle, sous sa clé ; la marque d'une autre revue (rechargée
  // depuis, datée dans le futur, ou d'une copie dont la revue a été refusée à la fusion) ne la couvre pas.
  const key = `security:${lotPassOf(run)}`
  return isMarked(run, key) ? null : { kind: 'security', group: 'lot', key, what: 'revue de sécurité du lot', blocks: LOT_BLOCKS }
}

/**
 * Un groupe à l'id hors forme (relu du fichier partagé) que l'auto aurait encore à faire avancer, dans
 * une phase où il agit sur les groupes : confié, pas fini, ou fini sans être clos. Son id n'entre dans
 * aucun texte : rien ne part, et l'auto se met en pause « lecture de la mission ratée » au lieu de
 * l'écarter en silence. Un tel groupe fini et clos ne retient rien.
 */
const hasUnsafeOpenGroup = (run: Run, review: SecurityReview = 'on'): boolean => {
  return isGroupActionPhase(currentPhase(run)) && run.status === 'active' && (run.groups ?? []).some(g => !isGroupId(g.id) && (g.linked !== undefined || !isGroupDone(run, g) || closeMissing(run, g, review).length > 0))
}

/**
 * La question d'un renvoi de trop (`relance:<groupe>#<envoi>`) attend encore : son groupe a des tickets
 * ouverts dans le plan, sans être confié de nouveau (l'envoi qu'elle nomme est toujours le prochain).
 * Faux une fois le groupe vidé, ses tickets faits, relancé, ou disparu du plan.
 */
const isRelaunchAwaited = (run: Run, id: string): boolean => {
  const unit = /^(.+)#(\d+)$/.exec(id.slice(RELAUNCH_PREFIX.length))
  const g = unit ? recordedGroup(run, unit[1]!) : undefined
  if (!unit || !g || g.linked !== undefined || groupSendSeq(g) !== Number(unit[2])) return false
  return groupTicketIds(run, g).some(tid => {
    const t = ticketOf(run, tid)
    return t !== undefined && t.status !== 'done'
  })
}

/** Une marque d'envoi que poserait l'auto pour une revue : sa clé, ce qu'elle est en mots, ce qu'elle bloque. */
export type AutoMarkSpec = { key: string; what: string; blocks: WaitTarget }

/** La marque de la revue d'un groupe rendu par son worker (« ◆ Revue du groupe · worker »), sous la clé de son dernier envoi. */
export const linkedReviewMark = (run: Run, groupId: string): AutoMarkSpec | null => {
  const g = (run.groups ?? []).find(x => x.id === groupId)
  if (!g?.delegated || !isGroupId(g.id)) return null
  return { key: `review:${g.id}#${sendNumber(g.delegated.seq) ?? 1}`, what: `revue du groupe ${g.id}`, blocks: { kind: 'group', id: g.id } }
}

/** La marque de la revue de sécurité d'un groupe (« ⛨ Revue de sécurité »), sous la clé de son dernier envoi rendu (l'unité d'ici pour un groupe jamais rendu) ; sans groupes, celle du lot (« lot »), sous la date de sa dernière revue. */
export const securityReviewMark = (run: Run, groupId: string): AutoMarkSpec | null => {
  // Sans groupes, le lot : la clé de son passage, celle que l'auto enverrait.
  if (groupId === 'lot' && (run.groups ?? []).length === 0) return { key: `security:${lotPassOf(run)}`, what: 'revue de sécurité du lot', blocks: LOT_BLOCKS }
  const g = (run.groups ?? []).find(x => x.id === groupId)
  if (!g || !isGroupId(g.id)) return null
  return { key: `security:${g.delegated !== undefined ? `${g.id}#${sendNumber(g.delegated?.seq) ?? 1}` : hereUnitOf(g)}`, what: `revue de sécurité du groupe ${g.id}`, blocks: { kind: 'group', id: g.id } }
}

/**
 * L'unité d'une revue faite ici, sur un groupe jamais rendu par un worker : `<groupe>#<n>`, n les
 * envois commencés (0 pour un groupe jamais confié, un envoi annulé gardant son numéro). Relu ici puis
 * confié, le groupe demande la revue de cet envoi (`#<n+1>`, celle de sa session) ; confié, annulé puis fini
 * ici, une nouvelle revue d'ici (`#<n>`, que l'envoi annulé n'a jamais eue : sa revue suit son retour).
 */
const hereUnitOf = (g: TicketGroup): string => `${g.id}#${groupSendSeq({ ...g, linked: undefined }) - 1}`

/** La marque du /code-review des groupes finis ici et pas relus (« ◆ Revue du groupe »), celle de l'envoi auto de cette revue ; sans groupes, celle du lot à relire (« ◆ Revue »), sous la clé de son passage. */
export const hereReviewMark = (run: Run): AutoMarkSpec | null => {
  // Sans groupes, le lot à relire : la clé de son passage, celle que l'auto enverrait.
  if ((run.groups ?? []).length === 0) return needsReview(run) ? { key: lotReviewKeyOf(run), what: '/code-review du lot', blocks: LOT_BLOCKS } : null
  const here = (run.groups ?? []).filter(g => g.linked === undefined && g.delegated === undefined && isGroupId(g.id) && isGroupDone(run, g) && !isGroupReviewed(run, g))
  if (here.length === 0) return null
  return { key: `review:${here.map(g => hereUnitOf(g)).join('+')}`, what: `/code-review des groupes ${here.map(g => g.id).join(', ')}`, blocks: { kind: 'group', id: here[0]!.id } }
}

/**
 * Un bouton (« ◆ Revue du groupe », « ⛨ Revue de sécurité ») lance à la main une revue que l'auto
 * enverrait : sa marque, sous la même clé, se pose déjà démarrée (le mod ne voit pas l'Entrée de la
 * personne), sur une mission qui a été en auto ; l'auto ne redemande jamais cette revue. Null sans
 * marque à poser (pas d'auto, déjà marquée, liste de marques illisible).
 */
export const markAutoLaunched = (board: Board, mark: AutoMarkSpec | null, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!mark || !run0 || run0.auto === undefined) return null
  // Une marque de la même clé qui attend son démarrage (envoi resté sans suite) : lancée à la main, elle démarre
  // et sa question se retire, sans que « ↻ Renvoyer » fasse redemander la même revue.
  if (pendingAutoMarks(run0).some(m => m.key === mark.key)) return markAutoStarted(board, m => m.key === mark.key, now)
  if (isUnitsMarked(run0, mark.key)) return null
  const b = clone(board)
  const run = activeRun(b)!
  const at = Math.max(now, (resentOf(run).find(t => t.key === mark.key)?.at ?? -1) + 1)
  run.autoSent = [...(Array.isArray(run.autoSent) ? run.autoSent : []), { key: mark.key, at, startedAt: at, what: mark.what, blocks: mark.blocks }]
  log(run, now, '⚡', `Lancé à la main, l'auto ne le redemande pas : ${mark.what}`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** Chaque unité d'une clé (`review:A#1+B#1`) est déjà nommée par une marque de sa sorte (ou la liste est illisible). */
const isUnitsMarked = (run: Run, key: string): boolean => {
  const at = key.indexOf(':')
  const prefix = key.slice(0, at + 1)
  return isMarked(run, key) || key.slice(at + 1).split('+').every(unit => isUnitMarked(run, prefix, unit))
}

/**
 * Un lot à groupes que plus rien ne fait avancer sans un geste de la personne : dans une phase où l'auto
 * agit sur les groupes, rien en vol (`inFlight` : une tâche de fond ; un groupe confié), aucune question
 * ni marque qui attend, le lot pas clos, et aucune action à envoyer ; et aucune revue lancée dont le
 * résultat n'est pas encore là. Par exemple un groupe relu sans avis de sécurité envoyé, un groupe fini
 * ici avec une revue de sécurité conseillée et pas lancée, un groupe gardé vide après un envoi annulé.
 * Jamais quand l'auto attend une tâche externe pas faite dont la levée le ferait avancer
 * (`awaitedExternals`) : il l'attend, sans pause.
 */
export const isGroupLotStuck = (run: Run, inFlight: boolean, review: SecurityReview = 'on'): boolean => {
  const groups = run.groups ?? []
  if (!isGroupActionPhase(currentPhase(run)) || run.status !== 'active' || groups.length === 0 || !groupPlan(run)) return false
  if (inFlight || groups.some(g => g.linked !== undefined)) return false
  const read = readMarks(run)
  if (read.isDamaged || read.marks.some(m => m.startedAt === undefined) || readWaiting(run).length > 0) return false
  if (isGroupLotOver(run, review)) return false
  // Rien à envoyer : ni action prête (une action déjà marquée ne repart pas), ni relance à poser.
  // Une relance encore sans question est posée à la fin du tour, avant ce guet : une relance sans question
  // à poser (répondue ici, puis redevenue nécessaire) laisse le lot bloqué.
  const decision = autoDecision(run, { security: review }, inFlight)
  if (decision.kind !== 'none') return false
  // Une tâche externe pas faite dont la levée ferait avancer le lot (un envoi, ou une relance) : l'auto l'attend, sans pause ; seule une
  // décision externe, ou un bloqueur qu'aucune tâche ne lève, laisse le lot bloqué.
  if (awaitedExternals(run, inFlight, undefined, review).length > 0) return false
  // Une revue ou une revue de sécurité lancée (marque démarrée) dont le résultat n'est pas encore là : on l'attend.
  const isAwaiting = groups.some(g => {
    const unit = g.delegated !== undefined ? `${g.id}#${sendNumber(g.delegated?.seq) ?? 1}` : hereUnitOf(g)
    if (!isGroupReviewed(run, g) && isUnitMarked(run, 'review:', unit)) return true
    const sec = g.security
    return sec !== undefined && sec !== null && typeof sec === 'object' && sec.isAdvised === true && sec.findings === undefined && isUnitMarked(run, 'security:', unit)
  })
  return !isAwaiting
}

/**
 * Les tâches externes (`kind` « task », ou sans type) pas faites qu'attend l'auto : celles qui bloquent un
 * ticket ouvert, dans une phase où l'auto agit sur les tickets (l'implémentation, ou le découpage fini),
 * quand rien n'est en vol et que leur levée laisserait avancer le lot. Un lot à groupes : l'auto, rejoué
 * sur une copie où ces tâches sont faites, enverrait quelque chose qu'il n'envoie pas aujourd'hui, ou
 * ouvrirait une relance (un groupe revenu deux fois, dont la question se pose alors) ; un groupe qui attend
 * aussi un autre bloqueur, ou un groupe qui en attend un autre bloqué, ne part pas : rien n'est nommé. Un lot sans groupes : chaque ticket ouvert est bloqué, et l'un au moins ne
 * l'est plus une fois ces tâches faites. Une décision externe n'y est jamais : elle attend la personne.
 * Lecture seule : la mission n'est jamais modifiée.
 */
export const awaitedExternals = (run: Run, inFlight: boolean, outside?: ReadonlyMap<string, readonly OutsideHold[]>, review: SecurityReview = 'on'): ExternalBlocker[] => {
  // Seulement dans une phase où l'auto agit sur les tickets (comme `isGroupLotStuck`) : pendant un découpage
  // ou un compte rendu, l'auto n'attend aucune tâche.
  if (inFlight || !isGroupActionPhase(currentPhase(run))) return []
  const open = run.tickets.filter(t => t.status !== 'done')
  const blocking = new Set(open.flatMap(t => openBlockers(run, t)))
  // Relues du fichier partagé : une entrée hors forme (pas un objet, id pas texte) n'est jamais attendue ; un nom illisible
  // ne l'écarte pas (elle reste une tâche, nommée par son id).
  const tasks = externalsOf(run).filter(x => isSoundExternal(x) && x.status !== 'done' && x.isDecision !== true && [...blocking].some(id => sameTicket(id, x.id)))
  if (tasks.length === 0) return []
  // Une décision externe pas tranchée qui bloque un ticket ouvert attend la personne : rien n'est attendu, la
  // pause « plus rien ne peut avancer sans toi » la fait voir, comme une question ouverte.
  if (externalsOf(run).some(x => isSoundExternal(x) && x.status !== 'done' && x.isDecision === true && [...blocking].some(id => sameTicket(id, x.id)))) return []
  const lifted: Run = { ...run, externals: externalsOf(run).map(x => (tasks.includes(x) ? { ...x, status: 'done' as const } : x)) }
  const groups = run.groups ?? []
  if (groups.length === 0) {
    const isAllBlocked = open.length > 0 && open.every(t => openBlockers(run, t).length > 0)
    return isAllBlocked && open.some(t => openBlockers(lifted, t).length === 0) ? tasks : []
  }
  if (groups.some(g => g.linked !== undefined)) return []
  const now = autoDecision(run, { security: review }, inFlight, outside)
  if (now.kind !== 'none') return []
  // La levée fait avancer le lot : un envoi, ou une relance qu'elle seule ouvre (un groupe revenu deux fois,
  // dont la question se pose alors).
  const then = autoDecision(lifted, { security: review }, inFlight, outside)
  return then.kind === 'send' || then.relaunch.some(r => !now.relaunch.includes(r)) ? tasks : []
}

/** Les envois d'un groupe revenus de leur worker (le dernier et les précédents gardés) ; un envoi annulé n'en est pas un. */
export const returnsOf = (g: TicketGroup): number => (g.delegated !== undefined && g.delegated !== null && typeof g.delegated === 'object' ? 1 + earlierOf(g.delegated).length : 0)

/**
 * Les questions bloquantes d'un groupe revenu trop de fois pour repartir seul (`<groupe>#<envoi>`), posées
 * par le mod une fois chacune (une question déjà répondue ne revient pas) : l'auto ne le relance pas.
 * `own` : les traces de retrait écrites par cette discussion ; pour une mission dont l'auto est allumé au nom de cette discussion (`isAutoLitBy`),
 * seule une réponse donnée ici empêche de la reposer (une trace d'ailleurs ne la retire pas). Reposée,
 * elle est datée après la trace de son id, qu'aucune fusion ne l'efface.
 */
export const raiseRelaunchQuestions = (board: Board, units: readonly string[], now: number, own?: OwnTraces | null): Outcome => {
  const run0 = activeRun(board)
  if (!run0) return null
  const traces = readAnswered(run0)
  const answered = new Set((own && own.runId === run0.id ? own.answered : traces).map(t => t.id))
  const open = new Set(readWaiting(run0).map(q => q.id))
  const fresh = units.filter(u => !answered.has(`${RELAUNCH_PREFIX}${u}`) && !open.has(`${RELAUNCH_PREFIX}${u}`))
  if (fresh.length === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  const added: WaitingQuestion[] = fresh.map(u => {
    const id = u.replace(/#\d+$/, '')
    const returns = returnsOf(run.groups?.find(g => g.id === id) ?? { id, name: '', tickets: [] })
    const traceAt = traces.find(t => t.id === `${RELAUNCH_PREFIX}${u}`)?.at
    return { id: `${RELAUNCH_PREFIX}${u}`, blocks: { kind: 'group', id }, text: `Le groupe ${id} est revenu ${returns} fois de son worker avec des tickets ouverts : l'auto ne le renvoie plus. Relance-le toi-même (« ↗ Worker »), ou dis à Claude quoi en faire.`, at: Math.max(now, (traceAt ?? -1) + 1) }
  })
  run.waiting = [...readWaiting(run).map(q => q.raw as WaitingQuestion), ...added]
  for (const u of fresh) {
    const id = u.replace(/#\d+$/, '')
    log(run, now, '❓', `Groupe ${id} revenu ${returnsOf(run.groups?.find(g => g.id === id) ?? { id, name: '', tickets: [] })} fois : une question le bloque`, 'warn')
  }
  run.updatedAt = now
  return { board: b, fx: noFx() }
}
/**
 * Une implémentation à groupes dont tout est fini : chaque ticket fait, chaque groupe rendu et clos (relu,
 * sécurité tranchée), aucun en vol. Lancés depuis le tableau de bord, ses groupes ne chargent jamais la
 * consigne de /implement qui fait envoyer `complete` : sa suite (le compte rendu, dont le lancement clôt
 * la phase) part comme celle d'une phase finie.
 */
const isGroupLotOver = (run: Run, review: SecurityReview = 'on'): boolean => {
  const phase = currentPhase(run)
  const groups = run.groups ?? []
  if (phase.skill !== 'implement' || phase.status !== 'active' || groups.length === 0 || run.tickets.length === 0) return false
  if (!run.tickets.every(t => t.status === 'done')) return false
  return groups.every(g => g.linked === undefined && closeMissing(run, g, review).length === 0) && nextLaunchFor(run) === null
}

/** Ce que l'auto fait à la fin d'un tour : envoyer une action, se mettre en pause, ou rien ; `relaunch` : les questions d'un renvoi de trop à poser d'abord. */
export type AutoDecision = ({ kind: 'send'; action: AutoAction } | { kind: 'stop'; why: string } | { kind: 'none' }) & { relaunch: string[] }

/**
 * La décision de l'auto à la fin d'un tour, sur la mission relue : rien tant qu'une marque attend son
 * démarrage ; l'action des groupes, sinon celle d'un lot sans groupes (sa revue, sa revue de sécurité),
 * sinon celle de la phase, si elle n'est ni marquée ni bloquée par une
 * question ; sinon, quand des questions attendent et que rien n'est en vol (`inFlight` : une tâche de
 * fond ; un worker au travail compte aussi), la pause « plus rien ne peut avancer sans toi », ou
 * « deuxième échec du groupe <id> » quand c'est la question d'un renvoi de trop qui retient. Une liste
 * de marques abîmée : la pause « lecture de la mission ratée », rien ne part.
 */
export const autoDecision = (run: Run, opts: SuggestOpts, inFlight: boolean, outside?: ReadonlyMap<string, readonly OutsideHold[]>): AutoDecision => {
  const read = readMarks(run)
  if (read.isDamaged) return { kind: 'stop', why: AUTO_STOPS.unreadable, relaunch: [] }
  if (read.marks.some(m => m.startedAt === undefined)) return { kind: 'none', relaunch: [] }
  const review = opts.security ?? 'on'
  if (hasUnsafeOpenGroup(run, review)) return { kind: 'stop', why: AUTO_STOPS.unreadable, relaunch: [] }
  const grouped = autoGroupActionOf(run, outside, review)
  if (grouped.action) return { kind: 'send', action: grouped.action, relaunch: grouped.relaunch }
  // Une retenue entre missions : seule la branche retenue attend, sans pause ; elle repart quand la retenue tombe.
  const isHeldElsewhere = (outside?.size ?? 0) > 0
  // Un lot sans groupes : sa revue, puis sa revue de sécurité, avant la phase suivante.
  const lot = autoLotActionOf(run, inFlight, review)
  if (lot) return { kind: 'send', action: lot, relaunch: grouped.relaunch }
  const action = autoActionOf(run, opts, outside)
  const phase = currentPhase(run)
  // Le lot sans groupes retenu : sa phase de code ne part pas.
  const isLotHeld = action !== null && action.kind === 'command' && CODE_SKILLS.has(action.skill) && outside?.has(LOT_KEY) === true
  const isHeld = action !== null && (isLotHeld || isBlocked(run, action.blocks) || isBlocked(run, { kind: 'phase', id: phase.skill }))
  if (action && !isHeld && !isMarked(run, action.key)) return { kind: 'send', action, relaunch: grouped.relaunch }
  const isAway = inFlight || isHeldElsewhere || (run.groups ?? []).some(g => g.linked !== undefined)
  const open = readWaiting(run)
  if (!isAway && open.length > 0) {
    const relaunched = open.find(q => q.id.startsWith(RELAUNCH_PREFIX))
    const why = relaunched?.blocks?.kind === 'group' && isGroupId(relaunched.blocks.id) ? groupFailStop(relaunched.blocks.id) : AUTO_STOPS.stuck
    return { kind: 'stop', why, relaunch: grouped.relaunch }
  }
  return { kind: 'none', relaunch: grouped.relaunch }
}
/** La marque « envoyée » d'une action, posée sur la mission active ici avant l'envoi. Null quand elle y est déjà. */
export const markAutoSent = (board: Board, action: AutoAction, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || isMarked(run0, action.key)) return null
  const b = clone(board)
  const run = activeRun(b)!
  // Après la trace d'un « ↻ Renvoyer » de la même clé, même face à une horloge en retard : la fusion ne l'efface pas.
  const at = Math.max(now, (resentOf(run).find(t => t.key === action.key)?.at ?? -1) + 1)
  run.autoSent = [...(Array.isArray(run.autoSent) ? run.autoSent : []), { key: action.key, at, what: action.what, blocks: action.blocks }]
  log(run, now, '⚡', `Envoi auto : ${action.what}`, 'accent')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * Retire la marque d'une action qui n'est pas partie (l'écriture du fichier a raté, ou l'auto s'est
 * éteint entre la relecture et l'envoi), avec une trace datée, comme « ↻ Renvoyer » : la marque a pu
 * déjà s'écrire dans le fichier, et la fusion suivante la ferait revenir, « envoyée » sans l'être.
 */
export const unmarkAutoSent = (board: Board, key: string, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || !pendingAutoMarks(run0).some(m => m.key === key)) return null
  const b = clone(board)
  const run = activeRun(b)!
  retractPending(run, key, now)
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * Retire les marques en attente d'une clé, avec une trace datée après elles, qu'une copie en retard ne
 * défait pas. Une marque démarrée de la même clé reste : la trace n'efface jamais une marque démarrée
 * (`keepAutoSent`), l'action partie ne repart pas.
 */
const retractPending = (run: Run, key: string, now: number) => {
  const pending = readMarks(run).marks.filter(m => m.key === key && m.startedAt === undefined)
  run.autoSent = readMarks(run).entries.filter(e => !(e.mark?.key === key && e.mark.startedAt === undefined)).map(e => e.raw as AutoMark)
  const at = maxOf([now, ...pending.map(m => m.at + 1), (resentOf(run).find(t => t.key === key)?.at ?? -1) + 1])
  run.autoResent = [...resentOf(run).filter(t => t.key !== key), { key, at }].sort((p, q) => q.at - p.at).slice(0, AUTO_RESENT_MAX)
}

/**
 * Le tour d'une action envoyée a commencé : sa marque passe « démarrée » (la plus ancienne qui attend
 * et que `isIt` reconnaît), et sa question « envoi resté sans suite », s'il y en a une, se retire.
 */
export const markAutoStarted = (board: Board, isIt: (m: AutoMark) => boolean, now: number): Outcome => {
  const run0 = activeRun(board)
  const target = run0 ? pendingAutoMarks(run0).filter(isIt).sort((x, y) => x.at - y.at)[0] : undefined
  if (!run0 || !target) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.autoSent = readMarks(run).entries.map(e => (e.mark && e.mark.key === target.key && e.mark.at === target.at ? { ...(e.raw as AutoMark), startedAt: now } : (e.raw as AutoMark)))
  withdrawQuestion(run, `${STALE_PREFIX}${target.key}`, now)
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * Les marques « envoyées » sans démarrage depuis `AUTO_STALE_MS` (ou toutes celles qui attendent, quand
 * `isNow` : l'envoi a été refusé) deviennent chacune la question bloquante « envoi resté sans suite »,
 * une fois : rien ne repart sans « ↻ Renvoyer ». Null quand aucune ne l'est devenue.
 */
export const raiseStaleAutoSends = (board: Board, now: number, isNow = false): Outcome => {
  const run0 = activeRun(board)
  const stale = run0 ? pendingAutoMarks(run0).filter(m => m.staleAt === undefined && (isNow || now - m.at >= AUTO_STALE_MS)) : []
  if (!run0 || stale.length === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  const keys = new Set(stale.map(m => m.key))
  run.autoSent = readMarks(run).entries.map(e => (e.mark && keys.has(e.mark.key) && e.mark.startedAt === undefined && e.mark.staleAt === undefined ? { ...(e.raw as AutoMark), staleAt: now } : (e.raw as AutoMark)))
  const open = readWaiting(run)
  const traces = readAnswered(run)
  const added: WaitingQuestion[] = stale
    .filter(m => !open.some(q => q.id === `${STALE_PREFIX}${m.key}`))
    .map(m => {
      const id = `${STALE_PREFIX}${m.key}`
      const traceAt = traces.find(t => t.id === id)?.at
      return { id, blocks: m.blocks ?? { kind: 'phase', id: currentPhase(run).skill }, text: `Envoi resté sans suite : ${m.what ?? m.key}. « ↻ Renvoyer » le relance une fois ; sinon, lance la suite toi-même.`, at: Math.max(now, (traceAt ?? -1) + 1) }
    })
  run.waiting = [...open.map(q => q.raw as WaitingQuestion), ...added]
  for (const m of stale) log(run, now, '❓', `Envoi auto resté sans suite : ${m.what ?? m.key}`, 'warn')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * La question d'une contradiction relevée par le COO, posée par le mod sur la phase en cours de la mission
 * portée ici (seule cette partie attend) : une fois, jamais une question déjà ouverte ni déjà répondue (sa trace).
 */
export const poseContradiction = (board: Board, runId: string, id: string, text: string, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.id !== runId) return null
  if (readWaiting(run0).some(q => q.id === id) || readAnswered(run0).some(t => t.id === id)) return null
  const b = clone(board)
  const run = activeRun(b)!
  const added: WaitingQuestion = { id, blocks: { kind: 'phase', id: currentPhase(run).skill }, text, at: now }
  run.waiting = [...readWaiting(run).map(q => q.raw as WaitingQuestion), added]
  log(run, now, '❓', 'Décision opposée à celle d’une autre mission : question posée', 'warn')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * « ↻ Renvoyer » sur la question « envoi resté sans suite » d'une marque : la marque s'efface, avec une
 * trace datée qu'une copie en retard ne défait pas, et la question se retire ; l'auto peut renvoyer
 * l'action. Seulement une marque qui attend encore son démarrage.
 */
export const resendAutoMark = (board: Board, runId: string, key: string, now: number): Outcome => {
  const run0 = activeRun(board)
  // La mission du bouton, active ici : une clé (`phase:to-tickets#1`) se retrouve dans d'autres missions.
  if (!run0 || run0.id !== runId || !pendingAutoMarks(run0).some(m => m.key === key && m.staleAt !== undefined)) return null
  const b = clone(board)
  const run = activeRun(b)!
  retractPending(run, key, now)
  // Une vague restée sans suite : ses groupes, liés sans session lancée, redeviennent à lancer (comme « Annuler »).
  // Seulement le lien de cet envoi même (son numéro), jamais un lien posé après par un bouton.
  if (key.startsWith('groups:')) {
    const units = key.slice('groups:'.length).split('+')
    run.groups = (run.groups ?? []).map(g => (g.linked !== undefined && g.linked.session === undefined && units.includes(`${g.id}#${sendNumber(g.linked.seq) ?? 1}`) ? withoutLink(g) : g))
  }
  withdrawQuestion(run, `${STALE_PREFIX}${key}`, now)
  log(run, now, '↻', `Envoi auto à refaire : ${key}`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * La mission gardée par la fusion reçoit les marques des deux copies : chaque entrée face à la trace de
 * sa clé d'abord (une trace efface les marques en attente posées avant elle, jamais une démarrée), puis une marque par clé et date, la
 * plus avancée (« démarrée » l'emporte, la question « sans suite » aussi) ; une entrée abîmée gardée
 * telle quelle ; l'union des traces, les 100 plus récentes. Rendu tel quel quand rien ne change.
 * `own` : pour une mission dont l'auto est allumé au nom de cette discussion (`isAutoLitBy`), les traces que cette discussion a écrites, seules
 * à retirer une marque (une trace d'ailleurs, forgée ou rejouée, ne fait rien repartir).
 */
const keepAutoSent =(kept: Run, other: Run | undefined, own?: OwnTraces['resent']): Run => {
  if (!other || (other.autoSent === undefined && other.autoResent === undefined)) return kept
  const traces = readResent([...(Array.isArray(kept.autoResent) ? kept.autoResent : []), ...(Array.isArray(other.autoResent) ? other.autoResent : [])])
  // Pour une mission dont l'auto est allumé d'ici, seules les traces écrites ici retirent une marque ; les traces gardées restent l'union.
  // Une trace d'ici ne compte jamais plus tard que celle de la mission de même clé, ramenée à maintenant à la lecture.
  const unionAt = new Map(traces.map(t => [t.key, t.at]))
  const traceAt = new Map((own ? readResent(own) : traces).map(t => [t.key, Math.min(t.at, unionAt.get(t.key) ?? t.at)]))
  const autoResent = traces.sort((p, q) => q.at - p.at).slice(0, AUTO_RESENT_MAX)
  const byKey = new Map<string, unknown>()
  const marksById = new Map<string, AutoMark>()
  for (const e of [...readMarks(kept).entries, ...readMarks(other).entries]) {
    if (!e.mark) {
      byKey.set(`raw:${JSON.stringify(e.raw)}`, e.raw)
      continue
    }
    const m = e.mark
    // Une trace n'efface qu'une marque en attente : une marque démarrée (l'action est partie) reste, d'où qu'elle vienne.
    if (m.startedAt === undefined && (traceAt.get(m.key) ?? -Infinity) >= m.at) continue
    const id = `mark:${m.key}|${m.at}`
    // Les deux versions d'une marque se fusionnent lues (bornées), jamais depuis l'entrée brute.
    const was = marksById.get(id)
    if (!was) {
      marksById.set(id, m)
      byKey.set(id, e.raw)
      continue
    }
    const startedAt = was.startedAt !== undefined && m.startedAt !== undefined ? Math.min(was.startedAt, m.startedAt) : (was.startedAt ?? m.startedAt)
    const staleAt = was.staleAt !== undefined && m.staleAt !== undefined ? Math.min(was.staleAt, m.staleAt) : (was.staleAt ?? m.staleAt)
    // Rien de plus que la première version : son entrée telle quelle, pour que la relecture ne croie pas à un changement.
    if (startedAt === was.startedAt && staleAt === was.staleAt) continue
    const merged: AutoMark = { ...was, ...(startedAt !== undefined ? { startedAt } : {}), ...(staleAt !== undefined ? { staleAt } : {}) }
    marksById.set(id, merged)
    byKey.set(id, merged)
  }
  const autoSent = [...byKey.values()] as AutoMark[]
  const isSame = JSON.stringify(autoSent) === JSON.stringify(kept.autoSent ?? []) && JSON.stringify(autoResent) === JSON.stringify(kept.autoResent ?? [])
  return isSame ? kept : { ...kept, autoSent, autoResent }
}

/** La plus récente des dates des deux copies, avec ce qui l'accompagne (auteur, raison). */
const latestOf = <K extends 'onAt' | 'offAt'>(key: K, ...autos: (RunAuto | undefined)[]): RunAuto | undefined =>
  autos.filter((x): x is RunAuto => x !== undefined && x[key] !== undefined).sort((x, y) => y[key]! - x[key]!)[0]

/**
 * La fusion de l'état auto de deux copies, date par date : « allumé à » et « éteint à », chacun le plus
 * récent des deux, avec son auteur et sa raison. Une copie abîmée (une date illisible) éteint l'auto
 * fusionné : on ne sait pas quand elle l'a coupé, peut-être après un second clic de l'autre copie. La
 * coupure prend la date du dernier allumage ; l'état écrit ensuite est propre, et le clic suivant
 * rallume.
 */
const mergeAuto = (ours: unknown, theirs: unknown): RunAuto | undefined => {
  const a = readAuto(ours)
  const b = readAuto(theirs)
  if (!a.auto && !b.auto && !a.isDamaged && !b.isDamaged) return undefined
  const on = latestOf('onAt', a.auto, b.auto)
  const off = latestOf('offAt', a.auto, b.auto)
  const merged: RunAuto = {
    ...(on ? { onAt: on.onAt!, ...(on.onBy !== undefined ? { onBy: on.onBy } : {}) } : {}),
    ...(off ? { offAt: off.offAt!, ...(off.offWhy !== undefined ? { offWhy: off.offWhy } : {}) } : {}),
  }
  if ((a.isDamaged || b.isDamaged) && isAutoOnIn(merged)) {
    merged.offAt = merged.onAt
    merged.offWhy = AUTO_STOPS.unreadable
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * La mission gardée par la fusion de deux copies reçoit l'état auto fusionné des deux (`mergeAuto`) ;
 * rendu tel quel quand rien ne change, pour que la relecture ne croie pas à un changement.
 */
const keepAuto = (kept: Run, other: Run | undefined): Run => {
  if (kept.auto === undefined && other?.auto === undefined) return kept
  const merged = mergeAuto(kept.auto, other?.auto)
  // Rien de lisible (deux états abîmés) : l'état présent reste tel quel, jamais retiré. Il se lit
  // éteint, et la mission reste « a été en auto », pour que ses choix ne soient pas coupés à 30.
  if (merged === undefined) return kept.auto !== undefined ? kept : { ...kept, auto: other!.auto }
  return JSON.stringify(merged) === JSON.stringify(kept.auto) ? kept : { ...kept, auto: merged }
}

/**
 * La marque de validation du rapport d'une copie ou de l'autre : une validation faite ne se perd pas
 * à la fusion (le plafond de 200 d'une mission en auto vient après elle). Rendu tel quel sans changement.
 */
const keepReportMark = (kept: Run, other: Run | undefined): Run => {
  const theirs = other && isTime(other.reportValidatedAt) ? other.reportValidatedAt : undefined
  if (theirs === undefined || (isTime(kept.reportValidatedAt) && kept.reportValidatedAt >= theirs)) return kept
  return { ...kept, reportValidatedAt: theirs }
}

/**
 * La revue et l'avis de sécurité du lot sans groupes d'une copie ou de l'autre : la dernière revue la
 * plus récente des deux, celle de l'autre copie seulement si elle a vu chaque ticket fini de la copie
 * gardée (fini là-bas aussi, à une date lisible, avant elle, et pas avant la fin d'ici : un ticket rouvert
 * puis refini ici n'est pas couvert) : sinon la copie gardée garde la sienne, et
 * le lot est à relire (au pire une revue de plus, jamais une revue manquée) ; l'avis de sécurité de date
 * la plus récente, en entier, un avis daté avant un avis sans date, celui de la copie gardée à date
 * égale ou sans date des deux côtés, celui de l'autre copie seulement si elle avait vu, avant lui,
 * chaque ticket fini de la copie gardée (sinon la copie gardée garde le sien ; sans avis, elle reprend
 * celui de l'autre daté 0, qui ne vaut pour aucun passage d'ici). Aucune copie ne vide l'avis : une copie sans avis garde celui de
 * l'autre. Rendu tel quel sans changement.
 */
const keepLotReview = (kept: Run, other: Run | undefined): Run => {
  if (!other) return kept
  const isNewer = isTime(other.reviewedAt) && !(isTime(kept.reviewedAt) && kept.reviewedAt >= other.reviewedAt)
  // Vu fini là-bas, à une date lisible, au plus tard à la date donnée (sa revue, ou son avis), et pas avant la fin d'ici (un ticket
  // rouvert puis refini ici après que l'autre copie l'a vu fini n'est pas couvert).
  const hasSeenAll = (at: number) =>
    kept.tickets
      .filter(t => t.status === 'done')
      .every(t => {
        const seen = other.tickets.find(o => sameTicket(o.id, t.id))
        return seen?.status === 'done' && isTime(seen.finishedAt) && seen.finishedAt <= at && isTime(t.finishedAt) && seen.finishedAt >= t.finishedAt
      })
  const theirReview = isNewer && hasSeenAll(other.reviewedAt as number) ? (other.reviewedAt as number) : undefined
  const ours: unknown = kept.security
  const theirs: unknown = other.security
  const dateOf = (sec: unknown): number | undefined => (sec !== null && typeof sec === 'object' && isTime((sec as SecurityCheck).at) ? (sec as SecurityCheck).at : undefined)
  const isLater = theirs !== undefined && (ours === undefined || (dateOf(theirs) !== undefined && (dateOf(ours) === undefined || dateOf(theirs)! > dateOf(ours)!)))
  // La même règle pour l'avis : celui de l'autre copie n'est repris que si elle avait vu, avant lui
  // (sa date, ou celle de sa revue pour un avis sans date), chaque ticket fini de la copie gardée.
  const theirAt = dateOf(theirs) ?? reviewTimeOf(other)
  const isTheirs = isLater && theirAt !== undefined && hasSeenAll(theirAt)
  // La copie gardée sans avis : celui de l'autre, qui n'a pas vu ses tickets, n'est pas perdu (ses failles
  // ouvertes comprises) mais ne vaut pour aucun passage d'ici : il est repris daté 0, comme un avis daté
  // dans le futur ; le prochain avis d'ici ouvre un nouveau passage et note ses comptes au journal.
  const isCarried = !isTheirs && ours === undefined && theirs !== null && typeof theirs === 'object'
  if (isCarried) {
    const carried = { ...(theirs as SecurityCheck), at: 0 }
    return { ...kept, ...(theirReview !== undefined ? { reviewedAt: theirReview } : {}), security: carried }
  }
  if (theirReview === undefined && !isTheirs) return kept
  // Un avis sans date gardé à côté d'une revue venue d'une autre copie : daté d'abord par la revue de sa
  // propre copie (0 sans elle), comme à la revue (`markReviewed`), pour que la nouvelle revue ne le date
  // pas d'un passage qu'il n'a jamais lu.
  const source = isTheirs ? other : kept
  const review = theirReview ?? kept.reviewedAt
  const sec = isTheirs ? theirs : ours
  const isUndated = sec !== null && typeof sec === 'object' && dateOf(sec) === undefined && reviewTimeOf(source) !== reviewTimeOf({ reviewedAt: review })
  const security = isUndated ? { ...(sec as SecurityCheck), at: reviewTimeOf(source) ?? 0 } : (sec as SecurityCheck)
  return { ...kept, ...(theirReview !== undefined ? { reviewedAt: theirReview } : {}), ...(isTheirs || isUndated ? { security } : {}) }
}

/**
 * La fusion de deux copies d'une même mission : la plus récente, avec les champs qui se fusionnent à
 * part. `own` : les traces de retrait écrites par cette discussion, pour chaque mission dont l'auto est
 * allumé en son nom (celui qu'elles nomment) ; seules elles y retirent une marque ou une question.
 */
const keepRun = (kept: Run, other: Run | undefined, own: readonly OwnTraces[] = [], isKeptLocal = true): Run => {
  const mine = own.find(o => o.runId === kept.id)
  return keepExternals(keepLaunch(keepForced(keepAutoSent(keepDecided(keepWaiting(keepAuto(keepLotReview(keepReportMark(keepClosings(kept, other), other), other), other), other, mine?.answered, isKeptLocal), other), other, mine?.resent), other), other), other)
}

/**
 * La fusion du rattachement à une carte de lancement (`Run.launch`) : posé une fois, jamais changé. La
 * copie gardée sans rattachement en forme reprend celui de l'autre ; deux rattachements en forme : le
 * plus ancien clic l'emporte (le même, d'ordinaire).
 */
const keepLaunch = (kept: Run, other: Run | undefined): Run => {
  const ours = soundRunLaunch(kept.launch)
  const theirs = soundRunLaunch(other?.launch)
  if (!theirs) return kept
  // Le même lancement : sa perte (une autre mission l'a emporté) ne se défait jamais.
  if (ours && ours.id === theirs.id) {
    const lostAt = ours.lostAt ?? theirs.lostAt
    return lostAt === ours.lostAt ? kept : { ...kept, launch: { ...ours, lostAt: lostAt! } }
  }
  if (ours && ours.at <= theirs.at) return kept
  return { ...kept, launch: theirs }
}

/**
 * Une autre mission, qui la précède, porte le même lancement, la même carte ou le même dossier : le
 * rattachement de la mission active ici est marqué perdu (son id reste, il ne se consomme plus jamais).
 */
export const loseLaunch = (board: Board, runId: string, now: number): Outcome => {
  const run0 = board.runs.find(r => r.id === runId)
  const was = run0 ? soundRunLaunch(run0.launch) : null
  if (!run0 || board.delegate || !was || was.lostAt !== undefined) return null
  const b = clone(board)
  const run = b.runs.find(r => r.id === runId)!
  run.launch = { ...was, lostAt: now }
  run.updatedAt = now
  log(run, now, '◆', 'Lancement du COO déjà pris par une autre mission : celle-ci reste en manuel, sans carte', 'warn')
  return { board: b, fx: noFx() }
}

/**
 * Rattache la mission active ici à la carte de lancement dont elle est née, une seule fois : rien quand
 * elle l'est déjà, ou que le rattachement est hors forme.
 */
export const attachLaunch = (board: Board, launch: RunLaunch, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || board.delegate || run0.launch !== undefined || !soundRunLaunch(launch)) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.launch = { ...launch }
  run.updatedAt = now
  log(run, now, '◆', `Mission lancée par le COO (carte ${launch.card}, mode ${launch.mode === 'auto' ? 'auto' : 'manuel'})`, 'info')
  return { board: b, fx: noFx() }
}

// ─── Traces de retrait écrites ici ────────────────────────────────────────
//
// Invariant : une trace lue dans le fichier partagé, que la discussion d'où l'auto agit n'a pas écrite,
// ne fait jamais repartir une action ni retirer une question pour l'auto de cette discussion. La
// discussion garde à part (`$.store`, avec son id et celui du processus, comme la date du clic) les
// traces qu'elle écrit ; tant que l'auto d'une mission est allumé en son nom, la date du clic gardée ici (même mis en pause par l'ouverture d'une autre mission), la fusion ne lui applique qu'elles. Les traces
// gardées dans la mission restent l'union : les autres discussions les appliquent toutes.

/** Les traces de retrait qu'une discussion a écrites pour une mission : « ↻ Renvoyer » (`resent`), questions retirées (`answered`). */
export type OwnTraces = {
  runId: string
  resent: readonly { key: string; at: number }[]
  answered: readonly { id: string; at: number; isUndated?: true }[]
}

/** Les traces gardées ici au plus, les plus récentes de chaque sorte, comme celles de la mission. */
export const OWN_TRACES_MAX = 100

/**
 * Les traces de retrait qu'un changement local du board a écrites sur la mission active : celles qui
 * apparaissent, ou dont la date avance, entre `before` et `after`. Null sans mission active.
 * Seulement pour un changement fait ici (une transition, pas une fusion) : une fusion apporterait les
 * traces des autres copies.
 */
export const writtenTraces = (before: Board, after: Board): OwnTraces | null => {
  const run = activeRun(after)
  if (!run) return null
  const was = before.runs.find(r => r.id === run.id)
  const wasResent = new Map((was ? resentOf(was) : []).map(t => [t.key, t.at]))
  const wasAnswered = new Map((was ? readAnswered(was) : []).map(t => [t.id, t.at]))
  return {
    runId: run.id,
    resent: resentOf(run).filter(t => (wasResent.get(t.key) ?? -1) < t.at),
    answered: readAnswered(run).filter(t => (wasAnswered.get(t.id) ?? -1) < t.at),
  }
}

/** Des traces gardées ici, avec celles qu'un changement vient d'écrire : une par clé ou id, la plus récente, les 100 plus récentes de chaque sorte. */
export const addOwnTraces = (kept: OwnTraces, added: OwnTraces): OwnTraces => ({
  runId: added.runId,
  resent: readResent([...kept.resent, ...added.resent])
    .sort((p, q) => q.at - p.at)
    .slice(0, OWN_TRACES_MAX),
  answered: mergeTraces([...kept.answered, ...added.answered])
    .sort((p, q) => q.at - p.at)
    .slice(0, OWN_TRACES_MAX),
})

// ─── Questions bloquantes ─────────────────────────────────────────────────
//
// Claude déclare chaque question qui attend la personne (`waiting` de l'outil), avec ce qu'elle bloque,
// et la retire une fois répondue (`answered`). Invariant : une question ne disparaît jamais par une
// fusion ou une reconstruction ; seuls son retrait ou l'effacement de la mission la font disparaître.
// Les copies se fusionnent question par question (union), et chaque retrait laisse une trace datée.

/**
 * L'id d'une question relue (l'union des copies l'apporte), dans la réponse de l'outil : tel quel s'il a la
 * forme d'un id de question (`isQuestionIdForm`), sinon échappé en JSON : réversible, Claude la retire par
 * son id exact, et il n'ouvre ni ligne ni section.
 */
const shownQuestionId = (id: string): string => (isQuestionIdForm(id) ? id : asciiJson(id))

/** Les questions ouvertes au plus : au-delà, une nouvelle est refusée, jamais une ancienne coupée. */
export const WAITING_MAX = 50

/** Les traces de retrait gardées, les plus récentes : une copie plus en retard pourrait faire revenir une question (sens sûr : elle bloque). */
const ANSWERED_MAX = 100

/** Longueur la plus grande d'un id de question ou de sa cible envoyé par l'outil : au-delà, refusé (jamais rogné). */
const WAIT_ID_MAX = 60

/** Longueur la plus grande d'un id relu : au-delà, l'entrée se lit sous un id calculé, jamais rognée sur une autre. */
const WAIT_READ_MAX = 200

const WAIT_KINDS: readonly WaitTarget['kind'][] = ['phase', 'group', 'ticket']

/** Un id tel qu'il est écrit : une chaîne non vide (rognée de ses blancs autour), ou un nombre fini ; sinon ''. */
const idText = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : ''

/** Une empreinte courte et stable d'une valeur relue, pour l'id d'une entrée qui n'en a pas de lisible. */
const fingerprint = (value: unknown): string => {
  let hash = 5381
  for (const ch of JSON.stringify(value) ?? String(value)) hash = ((hash * 33) ^ ch.codePointAt(0)!) >>> 0
  return hash.toString(36)
}

/**
 * Une question relue, bornée ici et nulle part ailleurs : un id, sa cible (null quand elle est
 * illisible : la question bloque alors tout, le sens sûr), son texte, sa date (null quand elle est
 * illisible : aucune trace de retrait ne l'efface alors, seul un retrait explicite). `raw` : l'entrée
 * telle qu'elle est enregistrée, réécrite telle quelle à la fusion et par l'outil, jamais reconstruite.
 */
export type OpenQuestion = { id: string; blocks: WaitTarget | null; text: string; at: number | null; raw: unknown; gesture?: QuestionGesture }

/** Le geste d'une question relue : son genre, et pour une faille le total des failles laissées. */
export type QuestionGesture = { kind: GestureKind; dismissed?: number }

const GESTURES: readonly GestureKind[] = ['spend', 'external', 'flaw']

/** Le geste relu d'une question : un genre connu (une faille, avec son total en forme) ; sinon aucun. */
const readGesture = (x: Record<string, unknown>): QuestionGesture | undefined => {
  const kind = GESTURES.find(k => k === x.gesture)
  if (!kind) return undefined
  if (kind !== 'flaw') return { kind }
  return isSecurityCount(x.dismissed) ? { kind, dismissed: x.dismissed } : undefined
}

/**
 * L'empreinte d'une question telle que la personne la voit : son texte, sa cible et son geste, et la date
 * de sa pose (une question reformulée la garde ; une question du mod retirée puis reposée sous le même id en a
 * une neuve ; une question répondue, sa trace gardée, ne se repose pas sous son id par `waiting`). Un geste ou une réponse porte celle de la version lue : une question changée depuis, ou reposée
 * depuis, a une autre empreinte et n'est pas répondue (invariant des gestes chez le COO).
 */
export const questionPrint = (q: Pick<OpenQuestion, 'text' | 'blocks' | 'gesture' | 'at'>): string =>
  `q${fingerprint({ t: q.text, b: q.blocks ? [q.blocks.kind, q.blocks.id] : null, g: q.gesture ? [q.gesture.kind, q.gesture.dismissed ?? null] : null, a: q.at })}`

/** Le rang d'une question parmi celles du même id : la plus récente ; une date illisible passe après toute date lisible. */
const questionRank = (q: OpenQuestion): number => q.at ?? -1

/** Une question par id, la mieux classée (`questionRank`), dans l'ordre de leur première apparition. */
const oneById = (list: readonly OpenQuestion[]): OpenQuestion[] => {
  const byId = new Map<string, OpenQuestion>()
  for (const q of list) {
    const was = byId.get(q.id)
    if (!was || questionRank(q) > questionRank(was)) byId.set(q.id, q)
  }
  return [...byId.values()]
}

/** Une trace de retrait relue : sa date, et `isUndated` quand elle retire aussi une question de cet id sans date lisible. */
type AnswerTrace = { id: string; at: number; isUndated?: true }

/**
 * Une trace de retrait efface la question : datée, posée avant ou au moment du retrait ; sans date
 * lisible, seulement par la trace d'un retrait explicite de cette question (`isUndated`), jamais par
 * une trace plus ancienne de son id.
 */
const isAnsweredBy = (q: OpenQuestion, trace: AnswerTrace | undefined): boolean =>
  trace !== undefined && (q.at === null ? trace.isUndated === true : trace.at >= q.at)

const readQuestion = (raw: unknown): OpenQuestion => {
  const x = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const written = idText(x.id)
  const id = written !== '' && written.length <= WAIT_READ_MAX ? written : `illisible-${fingerprint(raw)}`
  const b = x.blocks !== null && typeof x.blocks === 'object' ? (x.blocks as Record<string, unknown>) : {}
  const kind = WAIT_KINDS.find(k => k === b.kind)
  const targetId = idText(b.id)
  const target = kind && targetId !== '' && targetId.length <= WAIT_READ_MAX ? { kind, id: targetId } : null
  const gesture = readGesture(x)
  return { id, blocks: target, text: clip(str(x.text), TEXT_MAX), at: isTime(x.at) ? x.at : null, raw, ...(gesture ? { gesture } : {}) }
}

/**
 * Les questions relues d'une mission, une par id (la plus récente). Une liste qui n'est pas un tableau
 * (fichier abîmé) se lit comme une seule question sans cible ni date, qui bloque tout et garde la
 * valeur entière (`damaged`) : réécrite par la fusion ou l'outil, rien n'en est perdu.
 */
const readWaiting = (run: Run): OpenQuestion[] => oneById(readEntries(run))

/** Toutes les entrées relues de la liste, sans en retirer aucune (`readWaiting` en garde une par id). */
const readEntries = (run: Run): OpenQuestion[] => {
  const raw: unknown = run.waiting
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    const id = `illisible-${fingerprint(raw)}`
    return [{ id, blocks: null, text: '', at: null, raw: { id, damaged: raw } }]
  }
  return raw.map(readQuestion)
}

/** Les questions ouvertes de la mission. */
export const openQuestions = (run: Run): OpenQuestion[] => readWaiting(run)

/** Les traces de retrait relues : un id et une date lisibles, la plus récente par id ; `isUndated` d'une seule suffit. */
const readAnswered = (run: Run): AnswerTrace[] => mergeTraces(Array.isArray(run.answered) ? (run.answered as unknown[]) : [])

/** Les traces de plusieurs listes réunies : une par id, la date la plus récente, `isUndated` dès qu'une le porte. */
const mergeTraces = (list: readonly unknown[]): AnswerTrace[] => {
  const byId = new Map<string, AnswerTrace>()
  for (const t of list) {
    if (t === null || typeof t !== 'object') continue
    const x = t as Record<string, unknown>
    const id = idText(x.id)
    if (id === '' || id.length > WAIT_READ_MAX || !isTime(x.at)) continue
    const was = byId.get(id)
    const isUndated = x.isUndated === true || was?.isUndated === true
    byId.set(id, { id, at: Math.max(was?.at ?? -1, x.at), ...(isUndated ? { isUndated: true as const } : {}) })
  }
  return [...byId.values()]
}

/** Deux ids de groupe, à la casse près ; un id relu qui n'est pas une chaîne n'est l'id d'aucun groupe. */
const sameGroupId = (a: unknown, b: unknown): boolean => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

/**
 * Les questions qui bloquent une action, la seule fonction qui le dit : une phase, par les questions
 * posées sur elle ; un groupe, par les siennes, celles de ses tickets (rattachés compris) et celles de
 * la phase Implémentation ; un ticket, par les siennes, celles de son groupe et celles de la phase
 * Implémentation. Une question à la cible illisible bloque tout.
 */
export const blockingQuestions = (run: Run, target: WaitTarget): OpenQuestion[] => {
  const group = target.kind === 'group' ? recordedGroup(run, target.id) : (run.groups ?? []).find(g => groupTicketIds(run, g).some(id => sameTicket(id, target.id)))
  const groupTickets = target.kind === 'group' && group ? groupTicketIds(run, group) : []
  return readWaiting(run).filter(q => {
    const b = q.blocks
    if (!b) return true
    if (target.kind === 'phase') return b.kind === 'phase' && b.id === target.id
    if (b.kind === 'phase') return b.id === 'implement'
    if (target.kind === 'group') return (b.kind === 'group' && sameGroupId(b.id, target.id)) || (b.kind === 'ticket' && groupTickets.some(id => sameTicket(id, b.id)))
    return (b.kind === 'ticket' && sameTicket(b.id, target.id)) || (b.kind === 'group' && group !== undefined && sameGroupId(b.id, group.id))
  })
}

/** Une action est bloquée par au moins une question ouverte. */
export const isBlocked = (run: Run, target: WaitTarget): boolean => blockingQuestions(run, target).length > 0

/** Ce qu'une question bloque, en mots : « le ticket Deux », « le groupe A · Code », « la phase Tickets ». */
export const waitTargetLabel = (run: Run, q: OpenQuestion): string => {
  const b = q.blocks
  if (!b) return 'tout (cible illisible)'
  if (b.kind === 'ticket') return `le ticket ${ticketOf(run, b.id)?.name ?? b.id}`
  if (b.kind === 'group') {
    const g = recordedGroup(run, b.id)
    return `le groupe ${b.id}${g?.name ? ` · ${shownGroupName(g.name)}` : ''}`
  }
  return `la phase ${SKILLS[b.id]?.label ?? b.id}`
}

/** La cible d'une question envoyée, telle que la mission la connaît, ou pourquoi elle est refusée. */
const waitTargetOf = (run: Run, kind: WaitTarget['kind'], raw: string): WaitTarget | string => {
  if (kind === 'ticket') {
    const t = ticketOf(run, raw)
    return t ? { kind, id: t.id } : `no ticket "${clip(raw, WAIT_ID_MAX)}" in this mission`
  }
  if (kind === 'group') {
    const g = recordedGroup(run, raw)
    return g ? { kind, id: g.id } : `no group "${clip(raw, WAIT_ID_MAX)}" in this mission`
  }
  const id = catalogId(raw)
  const phase = id ? run.phases.find(p => p.skill === id || p.alts.includes(id)) : undefined
  return phase ? { kind, id: phase.skill } : `no phase "${clip(raw, WAIT_ID_MAX)}" in this mission (phases: ${run.phases.map(p => p.skill).join(', ')})`
}

/**
 * Retire la question ouverte `id` de la mission, avec la trace datée de son retrait (une copie en retard
 * ne la fait pas revenir) : la réponse de Claude (`answered`), ou le mod pour une question qu'il a posée
 * (« envoi resté sans suite »). Rend faux quand aucune question ouverte ne porte cet id.
 */
const withdrawQuestion = (run: Run, id: string, now: number): boolean => {
  const open = readWaiting(run)
  const was = open.find(q => q.id === id)
  if (!was) return false
  run.waiting = open.filter(q => q.id !== id).map(q => q.raw as WaitingQuestion)
  const before = readAnswered(run).find(t => t.id === id)
  const trace: AnswerTrace = { id, at: Math.max(now, was.at ?? 0, before?.at ?? 0), ...(was.at === null || before?.isUndated ? { isUndated: true as const } : {}) }
  run.answered = [...readAnswered(run).filter(t => t.id !== id), trace].sort((p, q) => q.at - p.at).slice(0, ANSWERED_MAX)
  log(run, now, '✓', `Question répondue : ${id}`, 'ok')
  return true
}

/**
 * Les questions envoyées par `waiting` sur la mission active ici : `{ id, phase | group | ticket, text }`
 * en ajoute une (ou met à jour la question ouverte du même id), `{ id, answered: true }` la retire et en
 * garde la trace. Une entrée hors forme, une cible inconnue, une question de plus que la borne, l'id d'une question
 * déjà répondue (sa trace) sans question ouverte de cet id : refusées,
 * et la réponse le dit. Rend la phrase de la réponse.
 */
const applyWaiting = (run: Run, value: unknown, now: number): string => {
  const sent = Array.isArray(value) ? value : [value]
  const refused: string[] = []
  const missed: string[] = []
  for (const one of sent) {
    const x = one !== null && typeof one === 'object' && !Array.isArray(one) ? (one as Record<string, unknown>) : null
    const id = x ? idText(x.id) : ''
    if (!x || id === '') {
      refused.push('an entry without "id"')
      continue
    }
    const open = readWaiting(run)
    const was = open.find(q => q.id === id)
    if (x.answered === true) {
      // La question « envoi resté sans suite » est celle du mod : « ↻ Renvoyer », ou l'étape lancée à la main, y répond.
      if (id.startsWith(STALE_PREFIX) && was) refused.push(`"${id}": a question of the mod; the user answers it with « ↻ Renvoyer » on the dashboard, or by launching the step: do not withdraw it`)
      // La question d'une opposition entre missions ne se retire qu'à l'application de la réponse relayée par le COO.
      else if (id.startsWith(OPPOSITION_PREFIX) && was) refused.push(`"${id}": opposed decisions of two missions; the user answers at the COO, and the dashboard withdraws this question itself once that answer is applied: do not withdraw it`)
      // La question d'un renvoi de trop tient tant que le groupe attend sa relance : la retirer laisserait le groupe écarté sans question.
      else if (id.startsWith(RELAUNCH_PREFIX) && was && isRelaunchAwaited(run, id))
        refused.push(`"${id}": the group still waits for its relaunch: relaunch the group (« ↗ Worker »), or answer otherwise (its open tickets set done, or removed from the lot with "remove"); then withdraw the question`)
      else if (!withdrawQuestion(run, id, now)) missed.push(id)
      continue
    }
    // Posée par le mod seul : Claude ne la pose ni ne la change (une autre cible ou un autre texte la ferait cesser de bloquer).
    if (id.startsWith(OPPOSITION_PREFIX)) {
      refused.push(`"${id}": a question of opposed decisions, posed by the dashboard itself: never posed nor changed here`)
      continue
    }
    // Une question répondue (sa trace) ne se rouvre jamais par le renvoi de son id : une nouvelle question prend un
    // nouvel id. Une question encore ouverte ici que sa trace répond (gardée seulement par les traces d'ici, auto
    // allumé) l'est aussi : sa mise à jour serait effacée par la fusion d'une autre copie. Une question ouverte que
    // sa trace ne répond pas (posée après elle, ou à la date illisible) se met à jour sur place.
    const trace = readAnswered(run).find(t => t.id === id)
    if (trace && (!was || isAnsweredBy(was, trace))) {
      refused.push(`"${id}" a été répondue le ${isoMinute(Math.min(trace.at, now))} UTC : une nouvelle question prend un nouvel id`)
      continue
    }
    if (!was && id.length > WAIT_ID_MAX) {
      refused.push(`"${clip(id, 40)}": an id has ${WAIT_ID_MAX} characters at most`)
      continue
    }
    const kinds = WAIT_KINDS.filter(k => idText(x[k]) !== '')
    if (kinds.length !== 1) {
      refused.push(`"${id}": give exactly one of "phase", "group" or "ticket"`)
      continue
    }
    const target = waitTargetOf(run, kinds[0]!, idText(x[kinds[0]!]))
    if (typeof target === 'string') {
      refused.push(`"${id}": ${target}`)
      continue
    }
    const text = clip(str(x.text), TEXT_MAX)
    if (text === '') {
      refused.push(`"${id}": no "text"`)
      continue
    }
    if (!was && open.length >= WAITING_MAX) {
      refused.push(`"${id}": ${WAITING_MAX} open questions at most; withdraw an answered one first`)
      continue
    }
    // Un geste que la personne peut faire d'un clic chez le COO : un genre connu, et pour une faille le total laissé.
    if (x.gesture !== undefined && x.gesture !== null && !GESTURES.some(k => k === x.gesture)) {
      refused.push(`"${id}": "gesture" is one of ${GESTURES.map(k => `"${k}"`).join(', ')}`)
      continue
    }
    if (x.gesture === 'flaw' && !isSecurityCount(x.dismissed)) {
      refused.push(`"${id}": a "flaw" gesture needs "dismissed", the total of kept findings left unfixed once the user agrees (a whole number)`)
      continue
    }
    if (x.gesture === 'flaw' && (kinds[0] === 'ticket' || (kinds[0] === 'phase' && (run.groups ?? []).length > 0))) {
      refused.push(`"${id}": a "flaw" gesture blocks its group ("group"), or this phase in a mission without groups ("phase"), never a ticket`)
      continue
    }
    const gesture = readGesture(x)
    // Une question ouverte garde sa date ; à la date illisible, mise à jour face à une trace de son id (une fusion, une
    // horloge en avance), elle passe après cette trace : la fusion ne l'efface pas. Une question nouvelle : maintenant.
    const at = was ? (was.at ?? Math.max(now, (trace?.at ?? -1) + 1)) : now
    const question: WaitingQuestion = { id, blocks: target, text, at, ...(gesture ? { gesture: gesture.kind, ...(gesture.dismissed !== undefined ? { dismissed: gesture.dismissed } : {}) } : {}) }
    run.waiting = was ? open.map(q => (q.id === id ? question : (q.raw as WaitingQuestion))) : [...open.map(q => q.raw as WaitingQuestion), question]
    if (!was) log(run, now, '❓', `Question en attente (${id}) : bloque ${waitTargetLabel(run, readQuestion(question))}`, 'warn')
  }
  const open = readWaiting(run)
  return [
    ` · waiting: ${open.length} question(s) waiting for the user${open.length > 0 ? ` (${open.map(q => shownQuestionId(q.id)).join(', ')})` : ''}`,
    refused.length > 0 ? ` · waiting refused: ${refused.join('; ')}; nothing recorded for these` : '',
    missed.length > 0 ? ` · waiting: no open question ${missed.map(m => `"${m}"`).join(', ')}` : '',
  ].join('')
}

/**
 * La mission gardée par la fusion reçoit les questions des deux copies : l'union, une par id (la
 * plus récente), moins celles qu'une trace de retrait, d'une copie ou de l'autre, a retirées après leur
 * pose ; et l'union des traces, les plus récentes. Rendu tel quel quand rien ne change. `own` : pour
 * une mission dont l'auto est allumé au nom de cette discussion, les traces qu'elle a écrites, seules à retirer
 * une question (une trace d'ailleurs, forgée ou rejouée, ne retire rien), et l'entrée ouverte d'ici d'une
 * question l'emporte sur celle de même id de l'autre copie, même plus récente (une copie forgée ne la recible
 * pas) ; les ids qui ne sont pas ouverts ici s'ajoutent. `isKeptLocal` : `kept` est la copie d'ici.
 */
const keepWaiting = (kept: Run, other: Run | undefined, own?: OwnTraces['answered'], isKeptLocal = true): Run => {
  if (!other || (other.waiting === undefined && other.answered === undefined)) return kept
  const merged = mergeTraces([...readAnswered(kept), ...readAnswered(other)])
  // Une trace d'ici ne compte jamais plus tard que celle de la mission de même id, ramenée à maintenant à la lecture.
  const unionAt = new Map(merged.map(t => [t.id, t.at]))
  const traces = new Map((own ? mergeTraces(own) : merged).map(t => [t.id, { ...t, at: Math.min(t.at, unionAt.get(t.id) ?? t.at) }]))
  const answered = merged.sort((p, q) => q.at - p.at).slice(0, ANSWERED_MAX)
  // Chaque entrée des deux copies face à la trace de son id d'abord, puis une par id parmi celles qui restent :
  // une entrée retirée ne cache jamais une autre du même id qui, elle, est encore ouverte. Avec `own`,
  // l'entrée ouverte d'ici passe avant toute entrée de même id de l'autre copie.
  const isOpen = (q: OpenQuestion) => !isAnsweredBy(q, traces.get(q.id))
  const here = (isKeptLocal ? readEntries(kept) : readEntries(other)).filter(isOpen)
  const there = (isKeptLocal ? readEntries(other) : readEntries(kept)).filter(isOpen)
  const open = own ? [...here, ...there.filter(q => !here.some(l => l.id === q.id))] : [...readEntries(kept), ...readEntries(other)].filter(isOpen)
  const waiting = oneById(open).map(q => q.raw as WaitingQuestion)
  const isSame = JSON.stringify(waiting) === JSON.stringify(kept.waiting ?? []) && JSON.stringify(answered) === JSON.stringify(kept.answered ?? [])
  if (isSame) return kept
  return { ...kept, waiting, answered }
}

/**
 * Les notifications d'un changement du board, au texte fixé, sans texte de question ni code : une
 * question qui apparaît sur une mission en auto (« Mission <titre> : N question(s) t'attendent ») ;
 * un auto qui s'éteint sans un geste de la personne ni la fin de la mission (« Mission <titre> : auto
 * en pause (<raison>) »). Rien hors auto, rien pour une question retirée ou redéclarée.
 */
export const autoNotices = (before: Board, after: Board): string[] => {
  const out: string[] = []
  for (const run of after.runs) {
    const was = before.runs.find(r => r.id === run.id)
    if (!was) continue
    const why = autoOf(run)?.offWhy
    if (isAutoOn(was) && !isAutoOn(run) && why !== undefined && !QUIET_STOPS.has(why)) out.push(autoPauseNotice(run.title, stopLabel(why)))
    const known = new Set(readWaiting(was).map(q => q.id))
    const open = readWaiting(run)
    if (isAutoOn(run) && open.some(q => !known.has(q.id))) out.push(autoQuestionsNotice(run.title, open.length))
  }
  return out
}

/**
 * Le texte fixé de la notification d'une question bloquante, le seul : le mod (`$.ui.notify`) et la
 * consigne de Claude (`PushNotification`) le tirent d'ici, le titre neutralisé de la même façon.
 */
export const autoQuestionsNotice = (title: string, count: number | string): string => `Mission ${neutralInPrompt(title)} : ${count} question(s) t'attendent`

/** Le texte fixé de la notification d'une pause de l'auto. */
export const autoPauseNotice = (title: string, why: string): string => `Mission ${neutralInPrompt(title)} : auto en pause (${why})`

// ─── Décidé sans toi : plafond et origine ─────────────────────────────────
//
// Une seule règle coupe les choix, partout où une liste de choix s'écrit (`keepChoices`, avec `choiceRoom`,
// dans basics.ts ; l'origine d'un choix aussi, `ORIGIN_LABELS` et `originOf`). Invariant :
// en auto, aucun choix déclaré n'est coupé avant la validation du rapport. Une mission qui a été en
// auto (son état auto est là, même éteint ou abîmé) ne coupe rien avant « ✓ Valider le rapport » ; au
// passage des 200 choix, son auto se met en pause ; au-delà de 1 000, un nouveau choix déclaré ici est
// refusé, jamais un ancien coupé (les choix relayés se gardent tous, le relais les borne à 200 par
// session) ; une fois le rapport validé, il garde les 200 plus récents. Hors auto, les 30 plus récents.

/** Les choix listés au plus, dans la carte de la phase et les faits du compte rendu ; au-delà, comptés. */
export const CHOICES_LISTED = 40
/** Le début du texte d'un choix en zone sensible tranché en auto par la reco : le compte rendu les range à part. */
export const SENSITIVE_CHOICE_MARK = 'Zone sensible :'

/** Avant la validation du rapport, au-delà, un nouveau choix déclaré ici est refusé avec un message, jamais un ancien coupé (les choix relayés se gardent tous). */
export const CHOICES_CEILING = 1000

/** Un nouveau choix ne tient plus : la mission, qui ne coupe rien, en a déjà 1 000. Rend le refus, ou ''. */
const choiceRefusal = (run: Run): string =>
  choiceRoom(run) === null && (run.decided ?? []).length >= CHOICES_CEILING
    ? `this mission keeps ${CHOICES_CEILING} choices at most until its report is validated, and cuts none: not recorded; put it in the report yourself`
    : ''

/**
 * Au passage des 200 choix (relayés compris), l'auto d'une mission allumé se met en pause, au lieu
 * d'en couper. Au passage seulement : rallumé ensuite par deux clics, il ne retombe pas à chaque appel.
 */
const pauseAtChoiceLimit = (run: Run, before: number, after: number, now: number) => {
  if (isAutoOn(run) && before < AUTO_CHOICES_MAX && after >= AUTO_CHOICES_MAX) stopAuto(run, now, AUTO_STOPS.limit)
}

/** Deux versions d'un même choix (même texte) : la plus ancienne date, et ce que l'une ou l'autre a appris (relu, retiré, origine). */
const mergeChoice = (a: SoloDecision, b: SoloDecision): SoloDecision => {
  const withdrawn = a.withdrawnAt !== undefined ? a : b.withdrawnAt !== undefined ? b : undefined
  const at = isTime(a.at) && isTime(b.at) ? Math.min(a.at, b.at) : isTime(a.at) ? a.at : b.at
  const seenAt = a.seenAt ?? b.seenAt
  const origin = originOf(a.origin) ?? originOf(b.origin)
  const why = a.why ?? b.why
  return {
    ...a,
    at,
    ...(why !== undefined ? { why } : {}),
    ...(seenAt !== undefined ? { seenAt } : {}),
    ...(origin !== undefined ? { origin } : { origin: undefined }),
    ...(withdrawn ? { withdrawnAt: withdrawn.withdrawnAt, ...(withdrawn.withdrawnWhy !== undefined ? { withdrawnWhy: withdrawn.withdrawnWhy } : {}) } : {}),
  }
}

/**
 * La fusion des choix de deux copies d'une mission qui a été en auto (l'une ou l'autre) : l'union, un
 * par texte et date (le même choix porte la même date dans les deux copies ; un choix remis en vigueur
 * sous le texte d'un choix retiré en est un autre), chacun avec ce que l'une ou l'autre copie a appris ;
 * une entrée hors forme est gardée telle quelle. Puis la règle de coupe (aucune avant le rapport). Hors auto, la copie gardée, comme
 * avant. Rendu tel quel quand rien ne change.
 */
const keepDecided = (kept: Run, other: Run | undefined): Run => {
  if (!other || !(hasBeenAuto(kept) || hasBeenAuto(other))) return kept
  const theirs = Array.isArray(other.decided) ? other.decided : []
  if (theirs.length === 0) return kept
  const mine = Array.isArray(kept.decided) ? kept.decided : []
  const byKey = new Map<string, SoloDecision>()
  for (const d of [...mine, ...theirs]) {
    const isSound = d !== null && typeof d === 'object' && typeof d.what === 'string'
    const key = isSound ? `what:${d.what}|at:${String(d.at)}` : `raw:${JSON.stringify(d)}`
    const was = byKey.get(key)
    byKey.set(key, was && isSound ? mergeChoice(was, d) : (was ?? d))
  }
  const rank = (d: SoloDecision) => (d !== null && typeof d === 'object' && isTime(d.at) ? d.at : Number.POSITIVE_INFINITY)
  const union = [...byKey.values()].sort((x, y) => rank(x) - rank(y))
  const decided = keepChoices(union, choiceRoom(kept))
  return JSON.stringify(decided) === JSON.stringify(kept.decided ?? []) ? kept : { ...kept, decided }
}

// ─── Chargement ───────────────────────────────────────────────────────────

/**
 * Sans activité depuis plus longtemps, une mission active est tenue pour abandonnée (discussion
 * fermée sans fin propre) : au chargement elle passe en pause, même tenue par une autre discussion encore
 * ouverte (choix de Mathis du 06/11/2026, faute d'un signal de vie des discussions), et seul un skill de la
 * discussion où elle est née peut la reprendre.
 */
const ORPHAN_MS = 30 * 60 * 1000

/**
 * Le board tel qu'une discussion le charge du stockage partagé : aucune mission active ici ;
 * les actives abandonnées passent en pause ; celles qu'une autre discussion fait vivre restent
 * actives (« dans une autre discussion »).
 */
export const detachOnLoad = (board: Board, now: number, session: string): Board => {
  const b = clone(clampFuture(board, now))
  b.activeId = null
  b.session = session
  // Propres à la discussion qui les a posés : une copie lue du stockage ne les garde pas.
  delete b.delegate
  delete b.cooHere
  b.deleted = soundTombstones(b.deleted, now)
  // Le siège du COO reste tel quel (un /reload-plugins le garde) ; mal formé, il ne s'applique jamais,
  // sans être effacé.
  const seat = soundSeat(b.coo)
  if (seat) b.coo = seat
  b.runs = b.runs.map(upgradeRun)
  for (const run of b.runs) {
    if (run.status === 'active' && (!run.owner || run.owner === session || now - run.updatedAt > ORPHAN_MS)) shelve(run, now)
  }
  return b
}

/**
 * Fusionne la copie de cette discussion avec le stockage partagé. Pour chaque mission, la
 * version la plus récente l'emporte, sauf la mission active ici, qui garde la version locale
 * tant qu'une autre discussion ne l'a pas repris. Une trace de suppression bien formée l'emporte sur
 * toute copie qui n'est pas plus récente qu'elle ; une trace mal formée ne s'applique jamais, et une
 * trace future est tombée à la lecture (`clampFuture`).
 * Certains champs se fusionnent à part, quelle que soit la copie gardée (`keepRun`) : les fermetures
 * des workers, qui ne reculent jamais, l'état auto, date par date, les questions bloquantes,
 * une par une, retraits tracés, pour une mission qui a été en auto, les choix « décidé sans toi »,
 * un par un, et les bloqueurs externes, unis, au statut changé le plus tard (`keepExternals`). `own` : les traces de retrait que cette discussion a écrites, pour chaque mission dont
 * l'auto est allumé en son nom (`isAutoLitBy`) : seules elles y retirent une marque en attente ou une
 * question (`keepRun`) ; les autres missions reçoivent l'union des traces.
 * L'écriture qui suit n'est pas atomique entre discussions : la fusion suivante rattrape.
 */
export const mergeBoards = (local: Board, stored: Board, ownTraces?: OwnTraces | readonly OwnTraces[] | null): Board => {
  const own: readonly OwnTraces[] = ownTraces == null ? [] : Array.isArray(ownTraces) ? ownTraces : [ownTraces as OwnTraces]
  // Seules des traces bien formées s'appliquent (`soundTombstones`) ; une trace future est déjà tombée à la lecture (`clampFuture`).
  const deleted = [...soundTombstones(local.deleted), ...soundTombstones(stored.deleted)]
    .sort((x, y) => y.at - x.at)
    .filter((t, i, all) => all.findIndex(o => o.id === t.id) === i)
    .slice(0, LIMITS.tombstones)
  // Une trace de suppression efface les copies plus anciennes qu'elle ; une mission touchée après
  // (restaurée des sauvegardes, par exemple) survit, et sa trace tombe.
  const goneAt = new Map(deleted.map(t => [t.id, t.at]))
  const isGone = (run: Run) => (goneAt.get(run.id) ?? -Infinity) >= run.updatedAt
  const byId = new Map<string, Run>()
  for (const run of stored.runs) if (!isGone(run)) byId.set(run.id, run)
  let activeId = local.activeId
  for (const run of local.runs) {
    if (isGone(run)) continue
    const other = byId.get(run.id)
    if (run.id === local.activeId) {
      // Une copie en pause n'a pas d'auteur lisible (`shelve` efface `owner`) : la pause d'une discussion
      // qui a repris la mission puis fini ne se distingue pas de celle d'un orphelin par une autre
      // discussion. Seule une copie active d'une autre discussion l'emporte (question au porteur).
      const isTakenOver =
        other !== undefined && other.status === 'active' && other.owner !== undefined && other.owner !== local.session && other.updatedAt > run.updatedAt
      // Close comme livrée ailleurs depuis (le mod du COO, sur la mission mise en pause par une autre discussion
      // pendant que celle-ci se taisait) : la copie relue, plus récente, l'emporte, et Version et Push ne se
      // proposent plus ici (invariant des missions livrées). Une livraison rouverte ici depuis reste plus récente.
      const isDeliveredElsewhere = other !== undefined && other.status === 'done' && isShipped(other) && !isShipped(run) && other.updatedAt > run.updatedAt
      if (isTakenOver || isDeliveredElsewhere) {
        activeId = null
        byId.set(run.id, keepRun(other, run, own, false))
      } else byId.set(run.id, keepRun(run, other, own))
      continue
    }
    byId.set(run.id, !other || run.updatedAt >= other.updatedAt ? keepRun(run, other, own) : keepRun(other, run, own, false))
  }
  if (activeId !== null && !byId.has(activeId)) activeId = null
  const merged: Board = {
    ...local,
    runs: [...byId.values()].map(upgradeRun).sort((x, y) => y.startedAt - x.startedAt),
    activeId,
    deleted: deleted.filter(t => !byId.has(t.id)),
  }
  // Le siège du COO : la prise la plus récente l'emporte, quelle que soit la copie (`mergeSeat`) ; un
  // siège mal formé des deux côtés reste tel quel (ignoré à la lecture, jamais effacé sur un doute).
  const coo = mergeSeat(local.coo, stored.coo)
  if (coo) merged.coo = coo
  else if (local.coo !== undefined || stored.coo !== undefined) merged.coo = local.coo ?? stored.coo
  prune(merged)
  return merged
}

/** Fin de discussion : sa mission active passe en pause ; un de ses skills la reprend dans cette discussion, « ↻ Reprendre ici » ailleurs. */
export const parkActive = (board: Board, now: number): Outcome => {
  if (!activeRun(board)) return null
  const b = clone(board)
  const run = activeRun(b)!
  // La discussion qui porte la mission se ferme : son auto s'éteint ; un /clear n'arrive pas ici.
  stopAuto(run, now, AUTO_STOPS.ended)
  shelve(run, now)
  b.activeId = null
  return { board: b, fx: noFx() }
}

// ─── Gestes de la personne (panneau, /flow) ───────────────────────────────

/**
 * Met de côté la mission active ici (`/flow pause`, « ‖ Mettre de côté ») : elle passe en pause telle
 * quelle, sans être close même si tout est fait, ni archivée, et la discussion n'a plus de mission
 * active. Seule la personne la reprend (« Reprendre », champ `resume`) ; un skill n'y revient pas.
 */
export const setAsideActive = (board: Board, now: number): Outcome => {
  if (!activeRun(board)) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.status = 'paused'
  run.owner = undefined
  run.asideAt = now
  run.updatedAt = now
  delete run.waitsUser
  stopAuto(run, now, AUTO_STOPS.aside)
  b.activeId = null
  log(run, now, '‖', 'Mission mise de côté', 'info')
  return { board: b, fx: { ...noFx(), toasts: [`‖ Mis de côté : ${run.title}`] } }
}

export const finishActive = (board: Board, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  if (phase.status === 'active') finishPhase(phase, now)
  for (const p of run.phases) if (p.status === 'pending') p.status = 'skipped'
  run.status = 'done'
  run.finishedAt = now
  run.updatedAt = now
  delete run.waitsUser
  stopAuto(run, now, AUTO_STOPS.closed)
  b.activeId = null
  log(run, now, '★', 'Mission close', 'ok')
  return { board: b, fx: { ...noFx(), toasts: [`★ Mission close : ${run.title}`] } }
}

/** Les choix faits sans la personne qu'elle n'a pas encore relus. */
export const unseenDecisions = (run: Run, relay?: Relay | null): number => inForce(run.decided ?? [], relay).filter(d => d.seenAt === undefined).length

/**
 * La personne a relu les choix faits sans elle, y compris ceux que les workers ont relayés
 * (`stored` : le relais de la mission) : ceux-là sont enregistrés relus, pour ne plus revenir.
 */
export const markDecisionsSeen = (board: Board, now: number, stored?: unknown): Outcome => {
  const run0 = activeRun(board)
  if (!run0) return null
  const relayed = relayedDecisions(run0, isRelay(stored, run0.id) ? stored : null)
  if (unseenDecisions(run0) === 0 && relayed.length === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.decided = (run.decided ?? []).map(d => (d.seenAt === undefined ? { ...d, seenAt: now } : d))
  keepDecisions(run, relayed, now)
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** La personne a lu le compte rendu et le valide : la phase est faite, la livraison peut venir. */
export const validateReport = (board: Board, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0) return null
  const at0 = run0.phases.findIndex(p => p.skill === 'compte-rendu' && p.status === 'active')
  if (at0 < 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = run.phases[at0]!
  finishPhase(phase, now)
  // La fin même de la phase (finishPhase vient de la poser à `now`) : la validation se lit par égalité.
  run.reportValidatedAt = now
  log(run, now, '✓', 'Compte rendu validé', 'ok')
  // Les choix faits sans la personne sont dans le rapport : les valider, c'est les avoir relus.
  if (run.decided) run.decided = run.decided.map(d => (d.seenAt === undefined ? { ...d, seenAt: now } : d))
  run.updatedAt = now
  return { board: b, fx: { ...noFx(), toasts: ['✓ Compte rendu validé · suite : Version et push'] } }
}

/**
 * Ce que le tableau de bord sait de la mission, donné à Claude quand le compte rendu se charge :
 * il part de ces faits et les complète par git et le tracker.
 */
export const reportFacts = (run: Run, failedAgents = 0, decidedFile: string | null = null, review: SecurityReview = 'on'): string[] => {
  const lines = [`- Run ${JSON.stringify(shownInNote(run.title))}, started ${isoMinute(run.startedAt)} UTC (use it for git log --since).`]
  const ticket = (t: Ticket) =>
    `${shownInNote(t.name)} [${shownInNote(t.id)}]: ${shownInNote(t.status)}${t.why ? ` (waits for: ${shownInNote(t.why)})` : ''}${t.startedAt !== undefined && t.finishedAt !== undefined ? `, ${Math.round((t.finishedAt - t.startedAt) / 60_000)} min` : ''}`
  if (run.tickets.length > 0) lines.push(`- Tickets of the lot: ${run.tickets.map(ticket).join('; ')}.`)
  const groups = run.groups ?? []
  if (groups.length > 0) {
    const state = (g: TicketGroup) => {
      // Rattachés compris ; un id inconnu compte dans le total, comme pour sa fin (`isGroupDone`).
      const ids = groupTicketIds(run, g)
      const done = ids.filter(id => ticketOf(run, id)?.status === 'done').length
      const total = ids.length
      // La même lecture que la fermeture, l'auto et la vue (`closeMissing`, `securityRow`) : un groupe clos avec sa
      // marque reste « désactivée » ; sans elle, le réglage lu à l'instant décide, comme pour un groupe ouvert.
      const sec = securityText(g.security, review, isClosedTurnedOff(g))
      // « relu » seulement pour un groupe fini, rattachés compris : une date posée recompte une fois le groupe fini.
      const isDone = isGroupDone(run, g)
      return `${shownGroupId(g.id)} (${shownGroupName(g.name)}): ${done}/${total} done${isDone && hasGroupReview(g) ? ', reviewed by /code-review' : isDone && isNoLogicGroup(run, g) ? `, reviewed by its ticket reviews (no logic, not sensitive)${g.security === undefined ? ', no group review nor security review needed' : ''}` : isDone && isTicketReviewEnough(run, g) ? `, reviewed by its ticket review (a group of one ticket)${g.security === undefined ? ', its security advice still due' : ''}` : ''}${sec ? `, ${sec}` : ''}`
    }
    lines.push(`- Groups, each usually run in its own discussion: ${groups.map(state).join('; ')}. Report every group, not only the one of this discussion: write « Fait » group by group.`)
  }
  if (groups.length === 0 && run.tickets.length > 0) {
    // Le lot sans groupes se dit comme un groupe : relu, dispensé, ou à relire, puis sa sécurité.
    const isDone = isAllDone(run, run.tickets.map(t => t.id))
    // Un avis antérieur à la dernière fin de ticket ou à la dernière revue du lot ne compte plus : il ne se dit pas comme celui du passage.
    const lotSecurity =
      isLotAdvicePrevious(run) ? 'security advice older than the last ticket end or the last lot review, not settled for the current pass (its own advice is due)' : securityText(run.security, review, false, 'le lot')
    const reviewed = !isDone
      ? ''
      : isLotReviewEnough(run)
        ? `reviewed by its ticket reviews (no logic, not sensitive)${run.security === undefined ? ', no lot review nor security review needed' : ''}`
        : needsReview(run)
          ? `lot review due (${reviewTimeOf(run) !== undefined ? 'a ticket finished after its last review' : typeof run.reviewedAt === 'number' && isTime(-run.reviewedAt) ? 'its last review was dated in the future, to redo' : 'never reviewed'})`
          : 'reviewed by /code-review'
    const parts = [reviewed, lotSecurity].filter(x => x !== '')
    if (parts.length > 0) lines.push(`- Lot: ${parts.join(', ')}.`)
  } else if (groups.length === 0) {
    const lotSecurity = securityText(run.security, review, false, 'le lot')
    if (lotSecurity) lines.push(`- Lot: ${lotSecurity}.`)
  }
  const tracking = run.artifacts.filter(a => a.kind === 'tracking')
  lines.push(
    tracking.length > 0
      ? `- Tracking files of this mission (one per discussion; read them all, they hold what the other discussions did, found and decided): ${tracking.map(a => `${shownInNote(a.path)}${a.detail ? ` (${shownInNote(a.detail)})` : ''}`).join('; ')}. Also look where the project's CLAUDE.md keeps tracking files (for example travail/<subject>/: spec, tickets, DECISIONS.md; else travail/tasks/) for others changed since the mission started (git log).`
      : '- Tracking files: look where the project\'s CLAUDE.md keeps them (for example travail/<subject>/: spec, tickets, DECISIONS.md; else travail/tasks/) for every file changed since the mission started (git log): they hold what the other discussions did, found and decided.',
  )
  const found = run.found ?? []
  if (found.length > 0) lines.push(`- Found on the way (tracker tasks created during the mission, outside the lot): ${found.map(f => `${shownInNote(f.name)} [${shownInNote(f.id)}]: ${shownInNote(f.status)}${f.why ? ` (${shownInNote(f.why)})` : ''}${f.isForUser ? ', assigned to the user' : ''}`).join('; ')}.`)
  const all = inForce(run.decided ?? [])
  // Une mission en auto en déclare des centaines : les 40 plus récents ici, tous dans le fichier des choix.
  const decided = all.slice(-CHOICES_LISTED)
  const withdrawn = (run.decided ?? []).filter(d => d.withdrawnAt !== undefined)
  if (all.length > decided.length) {
    const counts = Object.entries(ORIGIN_LABELS).map(([key, label]) => `${all.filter(d => originOf(d.origin) === key).length} « ${label} »`)
    lines.push(
      `- ${all.length} choices reported as made without the user (${counts.join(', ')}, ${all.filter(d => !originOf(d.origin)).length} without origin): only the ${decided.length} latest are listed below; ${decidedFile ? `read them all in the file of declared choices, ${decidedFile}` : 'the dashboard (⚑ Décidé sans toi) shows them all'}.`,
    )
  }
  lines.push(
    decided.length > 0
      ? `- Choices reported as made without the user: ${decided.map(d => `${shownInNote(d.what)}${d.why ? ` (because ${shownInNote(d.why)})` : ''}${originOf(d.origin) ? ` [origin: ${ORIGIN_LABELS[originOf(d.origin)!]}]` : ''}`).join('; ')}. Put every one in « Décidé sans toi », and add the ones missing from this list.${all.some(d => originOf(d.origin)) ? ' Some have an origin: group « Décidé sans toi » by origin, one subheading each (« Reco prise », « Validation sautée » with the path or link of the validated text, « Choix de worker »), then the others under « Autres ».' : ''}`
      : '- No choice was reported as made without the user: check the work for any, and put them in « Décidé sans toi ».',
  )
  // Les choix en zone sensible tranchés en auto, marqués par leur texte : tous, à part, pour que la personne les relise d'un coup.
  const sensitive = all.filter(d => d.what.startsWith(SENSITIVE_CHOICE_MARK))
  if (sensitive.length > 0) lines.push(`- Sensitive choices settled in auto (${sensitive.length}), to list first and apart in « Décidé sans toi », under « Zone sensible, tranché en auto », and nowhere else: ${sensitive.map(d => `${shownInNote(d.what)}${d.why ? ` (because ${shownInNote(d.why)})` : ''}`).join('; ')}.`)
  if (withdrawn.length > 0) lines.push(`- Choices withdrawn during the mission (no longer in force; say so apart in « Décidé sans toi », with why): ${withdrawn.map(d => `${shownInNote(d.what)}${d.withdrawnWhy ? ` (${shownInNote(d.withdrawnWhy)})` : ''}`).join('; ')}.`)
  const plans = run.artifacts.filter(a => a.kind === 'plan')
  if (plans.length > 0) lines.push(`- Plans written: ${plans.map(a => `${shownInNote(a.path)}${a.detail ? ` (${shownInNote(a.detail)})` : ''}`).join('; ')}.`)
  const tests = run.tests.filter(t => t.kind === 'test')
  if (tests.length > 0) lines.push(`- Test runs seen: ${tests.length}, ${tests.filter(t => !t.ok).length} red; last one ${tests.at(-1)!.ok ? 'green' : 'RED'}.`)
  if (failedAgents > 0) lines.push(`- Subagents that failed: ${failedAgents}.`)
  const warnings = run.log.filter(l => l.tone === 'warn' || l.tone === 'error').slice(0, 8)
  if (warnings.length > 0) lines.push(`- Warnings in the dashboard log: ${warnings.map(l => shownInNote(l.text)).join('; ')}.`)
  return lines
}

export const resumeRun = (board: Board, id: string, now: number): Outcome => {
  const target0 = board.runs.find(r => r.id === id)
  // La discussion du COO ne reprend jamais une mission (bouton du panneau compris).
  if (!target0 || target0.id === board.activeId || isCooDiscussion(board, now)) return null
  const b = clone(board)
  const current = activeRun(b)
  if (current) shelve(current, now)
  const run = b.runs.find(r => r.id === id)!
  // Reprendre une mission archivée la sort des archives ; mise de côté, elle revient telle qu'elle était.
  delete run.archivedAt
  delete run.asideAt
  delete run.waitsUser
  run.status = 'active'
  run.owner = b.session
  run.finishedAt = undefined
  run.updatedAt = now
  b.activeId = run.id
  log(run, now, '↻', 'Mission reprise', 'accent')
  return { board: b, fx: { ...noFx(), toasts: [`↻ Reprise : ${run.title}`] } }
}

/**
 * Range une mission aux archives : elle quitte l'historique visible, n'est plus proposée à la reprise
 * et n'est jamais élaguée. La mission en cours ici est d'abord mise en pause.
 */
export const archiveRun = (board: Board, id: string, now: number, why = 'Mission archivée'): Outcome => {
  const run0 = board.runs.find(r => r.id === id)
  if (!run0 || run0.archivedAt !== undefined) return null
  const b = clone(board)
  const run = b.runs.find(r => r.id === id)!
  if (b.activeId === id) {
    b.activeId = null
    if (run.status === 'active') run.status = 'paused'
    run.owner = undefined
  }
  run.archivedAt = now
  run.updatedAt = now
  delete run.waitsUser
  stopAuto(run, now, AUTO_STOPS.archived)
  log(run, now, '▣', why, 'info')
  return { board: b, fx: { ...noFx(), toasts: [`▣ Archivé : ${run.title}`] } }
}

/**
 * Une mission livrée : close, sa phase
 * « Version et push » (`project:version`) faite et son étape « Sync et push » (`pushed`) faite. Une mission
 * versionnée puis close sans push n'est pas livrée (sa clôture a sauté l'étape jamais atteinte), ni une mission
 * close sans cette phase. Aucun champ gardé : lu sur les phases.
 */
export const isDeliveredRun = (run: Run): boolean => run.status === 'done' && run.phases.some(p => p.skill === 'project:version' && p.status === 'done' && isPushDone(p))

/**
 * Une mission livrée et pas encore archivée, qui attend la rétro ou « ✓ Archiver » (la livraison n'archive plus) :
 * son id en forme (`isSafeId`), aucune phase de livraison encore à faire ou en cours (une « Pull request » sautée,
 * comme après une livraison à la main, ne compte pas), et aucun groupe confié à un worker depuis le push (du travail
 * pas parti, que l'archivage cacherait ; une date du push illisible compte comme un doute). Dans le doute, elle ne
 * s'archive pas par ces boutons.
 */
export const isAwaitingArchive = (run: Run): boolean =>
  run.archivedAt === undefined &&
  isSafeId(run.id) &&
  isDeliveredRun(run) &&
  // Une phase de livraison encore à faire ou en cours (une clôture par le COO pas encore appliquée, qui la marquera) :
  // l'archivage attend, pour ne jamais couper cette clôture.
  !run.phases.some(p => DELIVERY.has(p.skill) && (p.status === 'pending' || p.status === 'active')) &&
  isNothingSentSincePush(run, false)

/**
 * L'empreinte de la liste des missions livrées et pas archivées (leurs ids, triés) : un bouton « ✓ Archiver » ou
 * « ✓ Tout archiver (n) » la porte ; recalculée au clic sur le fichier relu, une liste changée n'archive rien.
 */
export const awaitingArchivePrint = (runs: readonly Run[]): string => `a${fingerprint(runs.filter(isAwaitingArchive).map(r => r.id).sort())}`

/**
 * Archive, d'un seul geste de la personne, les missions qu'elle a vues livrées et pas archivées : seulement si la
 * liste du board est encore celle de l'affichage (`print`, null pour le lancement d'une rétro, qui ne vise que sa
 * mission) et que chaque id en fait partie ; chacune par
 * `archiveRun` (rien d'autre n'est écrit), tout ou rien. Null sinon.
 */
export const archiveAwaiting = (board: Board, ids: readonly string[], print: string | null, now: number, why?: string): Outcome => {
  // `print` null : un geste qui ne vise pas une liste montrée (le lancement d'une rétro, sur sa seule mission).
  if (ids.length === 0 || (print !== null && awaitingArchivePrint(board.runs) !== print)) return null
  // Une mission active ici (`archiveRun` la mettrait d'abord en pause) n'est jamais archivée par ce geste.
  if (!ids.every(id => id !== board.activeId && board.runs.some(r => r.id === id && isAwaitingArchive(r)))) return null
  let b = board
  for (const id of new Set(ids)) {
    const out = archiveRun(b, id, now, why)
    if (!out) return null
    b = out.board
  }
  return { board: b, fx: noFx() }
}

/** L'étape « Sync et push » d'une phase « Version et push » est faite (le code est parti). */
const isPushDone = (phase: FlowPhase): boolean => phase.steps.some(s => s.id === 'pushed' && s.status === 'done')

/**
 * La livraison d'une mission est marquée : chacune de ses phases de livraison présentes (`DELIVERY`)
 * est faite, avec l'étape `pushed` faite pour une phase `project:version`. Sans statut : une mission reprise
 * (`resumeRun`) le garde, et ne se voit plus proposer Version ni Push (invariant des missions livrées).
 */
const isDeliveryMarked = (run: Run): boolean => run.phases.every(p => !DELIVERY.has(p.skill) || (p.status === 'done' && (p.skill !== 'project:version' || isPushDone(p))))

/** Une mission dont la livraison est marquée et qui a une phase « Version et push » : ses suites ne proposent plus la livraison. */
const isShipped = (run: Run): boolean => {
  if (!run.phases.some(p => p.skill === 'project:version') || !isDeliveryMarked(run)) return false
  return isNothingSentSincePush(run, true)
}

/**
 * Aucun groupe confié à un worker depuis le push (un travail lancé du tableau de bord, qui ne rouvre aucune phase,
 * n'est pas parti) ; `ifUnknown` quand la date du push ne se lit pas (`pushTimeOf`).
 */
const isNothingSentSincePush = (run: Run, ifUnknown: boolean): boolean => {
  const at = pushTimeOf(run)
  return at === undefined ? ifUnknown : !hasGroupSentAfter(run, at)
}

/**
 * La date du push d'une mission dont « Version et push » est faite et poussée : l'étape « Sync et push », ou à
 * défaut la fin de cette phase, chacune contrôlée (`isTime`) ; undefined sinon.
 */
const pushTimeOf = (run: Run): number | undefined => {
  const phase = run.phases.find(p => p.skill === 'project:version' && p.status === 'done' && isPushDone(p))
  const step = phase?.steps.find(s => s.id === 'pushed')
  return isTime(step?.at) ? step!.at : isTime(phase?.finishedAt) ? phase!.finishedAt : undefined
}

/** Un groupe de la mission confié à un worker après `at` : sa session en cours, rendue ou une d'avant, datée après. */
const hasGroupSentAfter = (run: Run, at: number): boolean =>
  (run.groups ?? []).some(g => [...(g.linked ? [g.linked] : []), ...(g.delegated ? [g.delegated, ...earlierOf(g.delegated)] : [])].some(s => isTime(s.at) && s.at > at))

/**
 * La clôture comme livrée est faite : la mission est close et sa livraison marquée. Vraie aussi
 * pour une mission ancienne sans phase `project:version` : le rattrapage s'arrête là, sans la réécrire à
 * chaque relevé.
 */
export const isCloseDone = (run: Run): boolean => run.status === 'done' && isDeliveryMarked(run)

/**
 * Plus rien à clore pour une livraison : la clôture est faite, ou la mission a sa livraison marquée (push compris)
 * même reprise depuis (`resumeRun` la remet active sans toucher ses phases). Une mission livrée puis reprise
 * n'est jamais refermée par une demande de clôture restée à appliquer ni par le rattrapage : la reprise est le
 * geste de la personne. Un travail qu'elle relance rouvre la livraison, et la mission redevient à livrer.
 */
export const isDeliveryOver = (run: Run): boolean => isCloseDone(run) || isShipped(run)

/**
 * Ce qu'une livraison a emporté est encore ce que porte la mission (`report` : la date de validation de son rapport,
 * gardée avec la livraison et dans la demande de clôture) : le même rapport validé, ou rien de relancé depuis. Un
 * travail relancé (`/implement` sur ses tickets, qui rouvre une phase à tickets d'avant le compte rendu) n'est pas
 * parti, ni pendant qu'il tourne, ni une fois fini : la clôture de cette livraison ne le marque jamais livré. Un
 * compte rendu seulement rouvert ou validé de nouveau ne change pas ce qui est parti : la clôture le marque livré
 * (ce qui a été livré ne se relivre jamais). Sans `report` (une demande d'une version d'avant, qui ne le gardait
 * pas) : rien à comparer.
 */
export const isReportShipped = (run: Run, report: number | undefined): boolean =>
  report === undefined || (!hasGroupSentAfter(run, report) && ((isReportValidated(run) && run.reportValidatedAt === report) || !isWorkRelaunched(run, report)))

/**
 * Du travail relancé dans la mission depuis le rapport validé à `report` : une phase à tickets d'avant le dernier
 * compte rendu rouverte (en cours ou à refaire), ou finie après lui (rouverte puis finie depuis), ou un groupe
 * confié à un worker après lui (lancé du tableau de bord, sans rouvrir de phase).
 */
const isWorkRelaunched = (run: Run, report: number): boolean => {
  const at = run.phases.map(p => p.skill).lastIndexOf('compte-rendu')
  return run.phases.some((p, i) => (at < 0 || i < at) && SKILLS[p.skill]?.hasTickets === true && (p.status === 'active' || p.status === 'pending' || (p.finishedAt ?? 0) > report)) || hasGroupSentAfter(run, report)
}

/**
 * La clôture d'une mission livrée par le COO (invariant des missions livrées : « Sur une mission en pause, le mod
 * du COO n'écrit que cette clôture ») : active ici, elle passe d'abord par `finishActive` ; puis ses phases de livraison
 * faites, l'étape « Sync et push » faite (le COO a poussé), `status: 'done'`, `finishedAt`, `updatedAt`,
 * `waitsUser` effacé, l'auto arrêté et la ligne « Livrée par le COO : <résultat> ». Rien d'autre : ni
 * `archivedAt`, ni `owner`, ni `bornIn`, ni les autres phases d'une mission en pause ; jamais d'archivage.
 * Null pour une mission absente, archivée, dont la clôture est faite ou livrée puis reprise (`isDeliveryOver`) :
 * une entrée rejouée n'écrit rien.
 */
export const closeDelivered = (board: Board, id: string, now: number, delivered: DeliveredResult): Outcome => {
  const run0 = board.runs.find(r => r.id === id)
  if (!run0 || run0.archivedAt !== undefined || isDeliveryOver(run0)) return null
  const finished = board.activeId === id ? finishActive(board, now) : null
  const b = finished ? finished.board : clone(board)
  const run = b.runs.find(r => r.id === id)!
  for (const p of run.phases) {
    if (!DELIVERY.has(p.skill)) continue
    if (p.status !== 'done') finishPhase(p, now)
    if (p.skill !== 'project:version' || isPushDone(p)) continue
    const at = p.steps.findIndex(s => s.id === 'pushed')
    const pushed: FlowStep = { id: 'pushed', status: 'done', at: now }
    p.steps = at < 0 ? [...p.steps, pushed] : p.steps.map((s, i) => (i === at ? pushed : s))
  }
  if (!finished) {
    run.status = 'done'
    run.finishedAt = now
    delete run.waitsUser
    stopAuto(run, now, AUTO_STOPS.closed)
  }
  run.updatedAt = now
  log(run, now, '⬆', `${DELIVERED_BY_COO} : ${deliveredText(delivered)}`, 'ok')
  return { board: b, fx: { ...noFx(), toasts: finished?.fx.toasts ?? [`★ Livrée : ${neutralLine(run.title)}`] } }
}

/**
 * Le geste « clore » du COO hors livraison (`coordinate.close`) sur une mission qui n'est active
 * nulle part : `status: 'done'`, `finishedAt`, `updatedAt`, `waitsUser` effacé, l'auto arrêté et une ligne de
 * journal ; ni phases de livraison, ni étape `pushed`, ni archivage. Null pour une mission absente, archivée,
 * active ou déjà close. (Active ici, sa discussion la clôt par `finishActive` seul.)
 */
export const closeIdleRun = (board: Board, id: string, now: number): Outcome => {
  const run0 = board.runs.find(r => r.id === id)
  if (!run0 || run0.archivedAt !== undefined || run0.status === 'done' || run0.status === 'active') return null
  const b = clone(board)
  const run = b.runs.find(r => r.id === id)!
  run.status = 'done'
  run.finishedAt = now
  run.updatedAt = now
  delete run.waitsUser
  stopAuto(run, now, AUTO_STOPS.closed)
  log(run, now, '★', 'Mission close à la demande du COO', 'ok')
  return { board: b, fx: { ...noFx(), toasts: [`★ Mission close : ${neutralLine(run.title)}`] } }
}

/** Ce qu'une livraison du COO a fait partir : la version posée, le push, l'adresse de la pull request (textes rendus par Claude). */
export type DeliveredResult = { version?: string; push?: string; pr?: string }

/** Le résultat d'une livraison en une ligne : chaque étape rendue, coupée court. */
export const deliveredText = (r: DeliveredResult): string =>
  [r.version ? `version ${neutralLine(clip(r.version, 80))}` : '', r.push ? `push ${neutralLine(clip(r.push, 80))}` : '', r.pr ? `PR ${neutralLine(clip(r.pr, 120))}` : ''].filter(Boolean).join(' · ') || 'faite'

/**
 * La discussion prend le titre de la mission (série 1, Q14 et Q15) : la mission y est née, aucune
 * autre n'y est née (active, en pause, finie ou archivée ; une mission supprimée a quitté le board), et
 * ce n'est pas un worker ; et, au premier titre comme plus tard (`fix.title`, `/flow rename`),
 * aucun worker n'a été demandé par cette mission : son brief nomme la discussion (série 2, Q6 ;
 * user story 75). Le titre attend alors le moteur (`fx.discussionTitle`) ; rend la ligne qui le dit
 * à Claude.
 */
const nameDiscussion = (board: Board, run: Run, fx: Effects): string => {
  const session = board.session
  const isHere =
    session !== undefined &&
    board.delegate === undefined &&
    run.bornIn === session &&
    !board.runs.some(r => r.id !== run.id && r.bornIn === session) &&
    !hasLaunchedLinked(run)
  if (!isHere) return ' · this discussion keeps its name'
  fx.discussionTitle = run.title
  return ` · name this discussion ${JSON.stringify(run.title)}: if you have a tool that renames it (in the app: set_session_title), call it now with this title; otherwise the dashboard renames it itself (/rename at the end of this turn when the session has it, else at the user's next message)`
}

/**
 * Renomme une mission, titre automatique ou posé compris (`/flow rename <titre>`). Le titre reste
 * ensuite posé : un titre envoyé plus tard par l'outil ne l'écrase pas. La discussion suit, aux
 * conditions de `nameDiscussion`.
 */
export const renameRun = (board: Board, id: string, title: string, now: number): Outcome => {
  const text = str(title)
  const run0 = board.runs.find(r => r.id === id)
  if (!run0 || !text) return null
  const b = clone(board)
  const run = b.runs.find(r => r.id === id)!
  run.title = clip(text, 70)
  run.isTitled = true
  const fx = { ...noFx(), toasts: [`✎ Renommé : ${run.title}`] }
  nameDiscussion(b, run, fx)
  run.updatedAt = now
  log(run, now, '✎', `Mission renommée : ${run.title}`, 'info')
  return { board: b, fx }
}

/** Sort une mission des archives : elle revient dans l'historique, telle qu'elle était. */
export const unarchiveRun = (board: Board, id: string, now: number): Outcome => {
  const run0 = board.runs.find(r => r.id === id)
  if (!run0 || run0.archivedAt === undefined) return null
  const b = clone(board)
  const run = b.runs.find(r => r.id === id)!
  delete run.archivedAt
  run.updatedAt = now
  log(run, now, '▢', 'Mission désarchivée', 'info')
  return { board: b, fx: { ...noFx(), toasts: [`▢ Désarchivé : ${run.title}`] } }
}

export const dropRun = (board: Board, id: string, now: number): Outcome => {
  if (!board.runs.some(r => r.id === id)) return null
  const b = clone(board)
  b.runs = b.runs.filter(r => r.id !== id)
  b.deleted = [{ id, at: now }, ...soundTombstones(b.deleted).filter(t => t.id !== id)].slice(0, LIMITS.tombstones)
  if (b.activeId === id) b.activeId = null
  return { board: b, fx: noFx() }
}

// ─── Synchronisation avec le distant ──────────────────────────────────────

/** L'état de l'interface au départ (onglet, volets, sélection) : le défaut de chaque déclaration de son atome. */
export const EMPTY_UI: UiState = {
  tab: 'flow',
  isBandHidden: false,
  isPaneDismissed: false,
  showAllTickets: false,
  showAllLog: false,
  showDecided: false,
  showFound: false,
  selection: [],
}

export const EMPTY_SYNC: SyncState = {
  behindMain: null,
  behindUpstream: null,
  branch: null,
  main: null,
  isOnMain: false,
  aheadMain: null,
  dir: null,
  remoteKey: null,
  askedFor: null,
  checkedAt: null,
  hasRemote: null,
  isGitHub: null,
}

/**
 * Une étape du conseil : un skill réservé à l'utilisateur (`/project:sync`), ou une commande git
 * à lancer dans un dossier (`git pull --ff-only`, avance rapide d'une branche principale en retard).
 */
export type SyncStep = { skill: string; args: string } | { shell: string; dir: string | null }

export type SyncAdvice = {
  /** Les commandes à lancer, dans l'ordre (`project:sync`, puis `project:sync base`). */
  commands: SyncStep[]
  /** Ce qui manque, en une ligne : « main a 3 nouveaux commits ». */
  reason: string
}

const commits = (n: number): string => `${n} nouveau${n > 1 ? 'x' : ''} commit${n > 1 ? 's' : ''}`

/**
 * Faut-il un /project:sync ? Oui seulement quand le distant a des commits que la branche n'a pas :
 * main (une PR fusionnée), ou la branche distante suivie (un push d'ailleurs). Les modifications
 * locales ne comptent pas, le sync s'en charge. Sur main, `/project:sync` suffit ; ailleurs, main
 * s'intègre par `/project:sync base` (sans argument, sync ne ramène que la branche distante suivie).
 * Quand la branche distante a bougé, `/project:sync` seul d'abord : elle a souvent été remise sur
 * main après la fusion (comme `dev` par sync-dev.yml dans polepredict). Le retard est remesuré
 * après, et `base` n'est proposé que si main est encore en avance. Sur main sans commit local en
 * avance (dossier principal d'un dépôt qui code dans un worktree), une avance rapide suffit :
 * `git pull --ff-only`. Avance inconnue (null) : `/project:sync`, par prudence.
 */
export const syncAdvice = (state: SyncState): SyncAdvice | null => {
  const main = state.behindMain ?? 0
  const upstream = state.behindUpstream ?? 0
  const name = state.main ?? 'main'
  if (state.isOnMain) {
    if (main === 0) return null
    const step: SyncStep = state.aheadMain === 0 ? { shell: 'git pull --ff-only', dir: state.dir ?? null } : { skill: 'project:sync', args: '' }
    return { commands: [step], reason: `${name} a ${commits(main)}` }
  }
  const commands: SyncStep[] = []
  const reasons: string[] = []
  if (upstream > 0) {
    commands.push({ skill: 'project:sync', args: '' })
    reasons.push(`ta branche distante a ${commits(upstream)}`)
    if (main > 0) reasons.push(`${name} a ${commits(main)}`)
    return { commands, reason: reasons.join(' et ') }
  }
  if (main > 0) {
    commands.push({ skill: 'project:sync', args: 'base' })
    reasons.push(`${name} a ${commits(main)}`)
  }
  return commands.length > 0 ? { commands, reason: reasons.join(' et ') } : null
}

export const commandText = (c: SyncStep): string => ('shell' in c ? c.shell : `/${c.skill}${c.args ? ` ${c.args}` : ''}`)

// ─── Choix des tickets à lancer ───────────────────────────────────────────

const ticketOf = (run: Run, id: string): Ticket | undefined => run.tickets.find(t => sameTicket(t.id, id))

/** Les bloqueurs d'un ticket qui ne sont pas encore faits. */
export const openBlockers = (run: Run, ticket: Ticket): string[] =>
  (ticket.blockedBy ?? []).filter(id => {
    const inLot = ticketOf(run, id)
    // Fait dans la branche d'un worker : levé pour son groupe, pas pour les autres, sur une autre branche.
    if (inLot) return inLot.status !== 'done' || (inLot.relayedFrom !== undefined && inLot.relayedFrom !== groupIdOf(run, ticket.id))
    // Hors du lot : levé quand la dépendance externe est faite ; inconnu, il bloque par prudence.
    return externalOf(run, id)?.status !== 'done'
  })

/** Le groupe déclaré qui contient le ticket `id`. */
const groupIdOf = (run: Run, id: string): string | undefined => (run.groups ?? []).find(g => g.tickets.some(x => sameTicket(x, id)))?.id

/** La dépendance externe d'id `id`, si la mission la connaît. */
export const externalOf = (run: Run, id: string): ExternalBlocker | undefined => externalsOf(run).find(x => isSoundExternal(x) && sameTicket(x.id, id))

/**
 * Une dépendance externe relue du fichier partagé, en forme pour être lue : un objet dont l'id est un texte.
 * Hors forme, elle n'est ni trouvée (un ticket qu'elle bloque reste bloqué, par prudence) ni attendue ;
 * son nom, lui, peut manquer (il se montre alors par son id).
 */
const isSoundExternal = (x: unknown): x is ExternalBlocker => x !== null && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string'

/** Un bloqueur externe tel qu'un envoi le donne : chaque champ seulement s'il est donné et en forme. */
type SentExternal = { id: string; name?: string; status?: ExternalBlocker['status']; isDecision?: boolean }

/**
 * Les bloqueurs externes d'un envoi (`externals`) : un id non vide ; le statut seulement s'il vaut
 * exactement « todo » ou « done » (absent ou autre, le statut gardé reste) ; le nom s'il n'est pas vide ;
 * le type (`kind`) s'il est donné.
 */
const externalsSent = (raw: unknown): SentExternal[] =>
  asList(raw)
    .map((one): SentExternal => {
      const name = clip(str(one.name), TEXT_MAX)
      const kind = str(one.kind)
      return {
        id: str(one.id),
        ...(name !== '' ? { name } : {}),
        ...(one.status === 'done' || one.status === 'todo' ? { status: one.status } : {}),
        ...(kind !== '' ? { isDecision: kind === 'decision' } : {}),
      }
    })
    .filter(x => x.id !== '')

/**
 * Un envoi de bloqueurs externes appliqué, dans l'ordre, à ceux que la mission garde, champ par champ :
 * un bloqueur connu (même id, `sameTicket`) ne prend que les champs envoyés, et son statut ne change, daté
 * (`statusAt`), que sur un « todo » ou un « done » explicite ; un nouveau est à faire sans statut envoyé,
 * son id pour nom. Au plafond (`LIMITS.tickets`), un nouveau est refusé, jamais un bloqueur gardé rogné ;
 * une entrée gardée hors forme reste telle quelle.
 */
const mergeExternals = (known: readonly ExternalBlocker[], sent: readonly SentExternal[], now: number) => {
  const list = [...known]
  const lifted: ExternalBlocker[] = []
  const reopened: ExternalBlocker[] = []
  const refused: SentExternal[] = []
  for (const x of sent) {
    const at = list.findIndex(k => isSoundExternal(k) && sameTicket(k.id, x.id))
    if (at < 0) {
      if (list.length >= LIMITS.tickets) {
        refused.push(x)
        continue
      }
      // Daté seulement sur un statut envoyé : un ajout « à faire » par défaut (le bloqueur renvoyé sans status à
      // une copie qui ne le connaissait pas) ne rouvre jamais, à la fusion, un bloqueur levé ailleurs.
      const added: ExternalBlocker = { id: x.id, name: x.name ?? clip(x.id, TEXT_MAX), status: x.status ?? 'todo', isDecision: x.isDecision ?? false, ...(x.status ? { statusAt: now } : {}) }
      list.push(added)
      if (added.status === 'done') lifted.push(added)
      continue
    }
    const was = list[at]!
    const status = x.status ?? was.status
    const isMoved = status !== was.status
    // Un nom gardé illisible (relu du fichier partagé) prend l'id, comme à l'ajout, quand l'envoi n'en donne pas.
    const isNameRead = typeof was.name === 'string' && was.name !== ''
    const next: ExternalBlocker = {
      ...was,
      ...(x.name !== undefined ? { name: x.name } : isNameRead ? {} : { name: clip(was.id, TEXT_MAX) }),
      ...(x.isDecision !== undefined ? { isDecision: x.isDecision } : {}),
      ...(isMoved ? { status, statusAt: now } : {}),
    }
    list[at] = next
    if (isMoved && status === 'done') lifted.push(next)
    if (isMoved && status === 'todo') reopened.push(next)
  }
  return { list, lifted, reopened, refused }
}

/** La date du dernier changement de statut d'un bloqueur externe ; sans date lisible, avant toutes les autres. */
const statusTime = (x: ExternalBlocker): number => (isTime(x.statusAt) ? x.statusAt : -1)

/** Un bloqueur externe sans sa date de changement de statut. */
const undated = (x: ExternalBlocker): ExternalBlocker => {
  const y = { ...x }
  delete y.statusAt
  return y
}

/** Un statut de bloqueur externe en forme. */
const isBlockerStatus = (s: unknown): s is ExternalBlocker['status'] => s === 'todo' || s === 'done'

/** Les bloqueurs externes d'une mission, une liste vide quand le champ relu n'en est pas une. */
const externalsOf = (run: Run | undefined): ExternalBlocker[] => (Array.isArray(run?.externals) ? run.externals : [])

/**
 * La fusion des bloqueurs externes de deux copies d'une même mission : l'union par id (`sameTicket`), ceux
 * de la copie gardée d'abord, jamais rognée ; pour un bloqueur des deux copies, le statut changé le plus
 * tard (`statusAt`, une date l'emporte sur son absence), et à date égale ou sans date, le levé. Une copie en
 * retard ne rouvre donc jamais un bloqueur levé ailleurs, et un « todo » explicite plus récent tient.
 */
const keepExternals = (kept: Run, other: Run | undefined): Run => {
  const theirs = externalsOf(other).filter(isSoundExternal)
  if (theirs.length === 0) return kept
  // Une liste gardée hors forme (relue du fichier partagé) ne porte aucun bloqueur lisible : ceux de l'autre copie
  // la remplacent, sinon ils seraient effacés à l'écriture.
  if (kept.externals !== undefined && !Array.isArray(kept.externals)) return { ...kept, externals: [...theirs] }
  const ours = externalsOf(kept)
  let isChanged = false
  const list = ours.map(k => {
    const t = isSoundExternal(k) ? theirs.find(x => sameTicket(x.id, k.id)) : undefined
    // Un statut hors forme de l'autre copie ne remplace jamais celui-ci.
    if (!t || !isBlockerStatus(t.status)) return k
    if (t.status === k.status) {
      // Même statut : la date du dernier changement est la plus récente des deux, pour les fusions suivantes.
      if (statusTime(t) <= statusTime(k)) return k
      isChanged = true
      return { ...k, statusAt: t.statusAt }
    }
    const isLater = !isBlockerStatus(k.status) || statusTime(t) > statusTime(k) || (statusTime(t) === statusTime(k) && t.status === 'done')
    if (!isLater) return k
    isChanged = true
    // Sans date lisible de l'autre côté, la copie gardée n'en avait pas non plus (égalité) : rien à dater.
    return { ...k, status: t.status, ...(isTime(t.statusAt) ? { statusAt: t.statusAt } : {}) }
  })
  for (const t of theirs) {
    if (list.some(k => isSoundExternal(k) && sameTicket(k.id, t.id))) continue
    list.push(t)
    isChanged = true
  }
  return isChanged ? { ...kept, externals: list } : kept
}

/**
 * Un ticket peut entrer dans la sélection s'il n'est pas fait et que chacun de ses bloqueurs est
 * fait, ou déjà sélectionné avant lui : il passera après dans l'ordre d'exécution.
 */
export const isPickable = (run: Run, selection: readonly string[], ticket: Ticket): boolean =>
  ticket.status !== 'done' && openBlockers(run, ticket).every(b => selection.some(s => sameTicket(s, b)))

/**
 * Ajoute le ticket à la fin de la sélection, ou l'en retire. Retirer un ticket retire aussi ceux
 * qui ne tenaient que grâce à lui (sélectionnés après et bloqués par lui).
 */
export const togglePick = (run: Run, selection: readonly string[], id: string): string[] => {
  const ticket = ticketOf(run, id)
  if (!ticket) return [...selection]
  if (!selection.some(s => sameTicket(s, id))) return isPickable(run, selection, ticket) ? [...selection, ticket.id] : [...selection]
  const kept: string[] = []
  for (const s of selection) {
    if (sameTicket(s, id)) continue
    const t = ticketOf(run, s)
    if (t && isPickable(run, kept, t)) kept.push(s)
  }
  return kept
}

// ─── Groupes, vagues et parallélisme ──────────────────────────────────────

/** Un chemin de dépôt comparable : barres obliques, sans `./` ni barre finale, en minuscules. */
const zoneOf = (path: string): string => path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()

/** Le dernier segment d'un chemin, pour le dire court dans le panneau. */
const tailOf = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || path

type Zone = { key: string; raw: string }

/**
 * Les documents que presque tous les tickets citent (README, fichier de décisions, carte du code) :
 * ils bloquaient tout groupe en parallèle, alors que leurs ajouts se fusionnent sans peine.
 */
const COMMON_DOCS = new Set(['readme.md', 'decisions.md', 'carte-du-code.md', 'codemap.md'])

/** Un chemin comparable (`zoneOf`, en minuscules) qui désigne un document commun, où qu'il soit. */
const isCommonDoc = (key: string): boolean => COMMON_DOCS.has(tailOf(key))

/** Les fichiers d'un groupe : les siens et ceux de ses tickets encore ouverts, sans doublon. */
const zonesOf = (v: { group: TicketGroup; open: readonly Ticket[] }): Zone[] => {
  const out: Zone[] = []
  for (const raw of [...(v.group.files ?? []), ...v.open.flatMap(t => t.files ?? [])]) {
    const key = zoneOf(raw)
    if (key !== '' && !isCommonDoc(key) && !out.some(z => z.key === key)) out.push({ key, raw })
  }
  return out
}

/**
 * Le premier fichier ou la première ressource que deux groupes ont en commun, dit court ; null
 * sans recouvrement. Même chemin, ou un dossier qui contient l'autre : c'est le dossier qu'on cite.
 */
const sharedOf = (a: { group: TicketGroup; open: readonly Ticket[] }, b: { group: TicketGroup; open: readonly Ticket[] }): string | null =>
  overlapOf({ zones: zonesOf(a), resources: a.group.resources ?? [] }, { zones: zonesOf(b), resources: b.group.resources ?? [] })

/** Ce que deux unités de travail ont en commun, dit court : un fichier (ou le dossier qui le contient), sinon une ressource ; null sans rien. */
const overlapOf = (a: { zones: readonly Zone[]; resources: readonly string[] }, b: { zones: readonly Zone[]; resources: readonly string[] }): string | null => {
  for (const x of a.zones) {
    for (const y of b.zones) {
      if (x.key === y.key || y.key.startsWith(`${x.key}/`)) return tailOf(x.raw)
      if (x.key.startsWith(`${y.key}/`)) return tailOf(y.raw)
    }
  }
  // Le nom tel que l'autre groupe l'écrit : c'est lui qu'on cite (« ∦ A : PowerBI Desktop »).
  const ra = new Set(a.resources.map(resourceKey))
  return b.resources.find(r => ra.has(resourceKey(r))) ?? null
}

// ─── Retenues entre missions ──────────────────────────────────────────────
//
// Un groupe pas encore parti (ou le lot sans groupes d'une mission) qui touche un fichier ou une
// ressource d'un groupe en cours d'une autre mission attend que ce groupe soit clos ou annulé, sauf
// forçage de la paire. La retenue n'est pas enregistrée : chaque lecteur la calcule sur le fichier des
// missions. Invariant : « Un groupe retenu ne part que si le groupe attendu est clos ou si tu as forcé ;
// une lecture ratée du fichier des missions ne lance rien. »

/** Le lot sans groupes d'une mission, dans une retenue : la clé qui le nomme à la place d'un id de groupe. */
export const LOT_KEY = '*'

/** Les documents que toutes les missions écrivent : hors des retenues entre missions, en plus des documents communs d'une mission. */
const CROSS_DOCS = new Set(['etat_du_projet.md', 'glossary.md'])

/** Une liste de chemins ou de noms relue d'une autre mission : seulement ses textes (une valeur hors forme ne casse aucun calcul). */
const textsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Les fichiers d'une unité, comparables, sans les documents communs. */
export const crossZones = (files: readonly string[]): Zone[] => {
  const out: Zone[] = []
  for (const raw of files) {
    if (typeof raw !== 'string') continue
    const key = zoneOf(raw)
    if (key !== '' && !isCommonDoc(key) && !CROSS_DOCS.has(tailOf(key)) && !out.some(z => z.key === key)) out.push({ key, raw })
  }
  return out
}

/** Une unité de travail d'une mission : un groupe, ou son lot sans groupes (`LOT_KEY`), avec ses fichiers et ses ressources. */
type Unit = { run: Run; group: string; zones: Zone[]; resources: string[] }

const openFilesOf = (run: Run, ids: readonly string[]): string[] =>
  ids.flatMap(id => {
    const t = ticketOf(run, id)
    return t && t.status !== 'done' ? textsOf(t.files) : []
  })

/**
 * Le lot sans groupes d'une mission est en cours : pas de groupes, un ticket pas fait, et le travail
 * commencé (une file posée, ou une phase de code commencée). Une mission en pause le garde.
 */
export const isLotUnderway = (run: Run): boolean =>
  (run.groups ?? []).length === 0 &&
  run.tickets.some(t => t.status !== 'done') &&
  ((run.queue ?? []).length > 0 || run.phases.some(p => CODE_SKILLS.has(p.skill) && p.status !== 'pending'))

/**
 * Un groupe en cours : confié à un worker, rendu et pas encore clos, ou commencé ici sans jamais avoir
 * été confié (un de ses tickets dans la file posée, ou en cours) ; un groupe rendu et clos ne l'est plus,
 * même un ticket resté « en cours ».
 */
const isGroupUnderway = (run: Run, g: TicketGroup): boolean => {
  if (g.linked !== undefined) return true
  if (g.delegated !== undefined) return !isClosedLink(g.delegated)
  const ids = groupTicketIds(run, g)
  return ids.some(id => ticketOf(run, id)?.status === 'doing' || ((run.queue ?? []).some(q => sameTicket(q, id)) && ticketOf(run, id)?.status !== 'done'))
}

/**
 * Les unités qu'un lancement de tickets choisis fait partir : les groupes qui les portent, rattachés
 * compris (comme le plan les compte), ou le lot d'une mission sans groupes.
 */
export const unitsOfTickets = (run: Run, ids: readonly string[]): string[] => {
  const groups = run.groups ?? []
  if (groups.length === 0) return [LOT_KEY]
  return groups.filter(g => groupTicketIds(run, g).some(x => ids.some(id => sameTicket(id, x)))).map(g => g.id)
}

/**
 * La date du push d'une mission livrée (`isDeliveredRun`) : l'étape « Sync et push » de sa phase « Version et
 * push », ou à défaut la fin de cette phase, chacune contrôlée (`isTime`) ; undefined pour une mission qui n'est
 * pas livrée ou sans date lisible (elle suit alors la règle des missions archivées).
 */
const shippedAtOf = (run: Run): number | undefined => (isDeliveredRun(run) ? pushTimeOf(run) : undefined)

/**
 * Les unités en cours d'une mission, qui retiennent les autres missions ; pour une mission close, seuls ses
 * groupes encore confiés à un worker ou rendus sans être clos ; pour une mission archivée, seuls ceux encore
 * confiés (pas rendus) ; pour une mission livrée, ceux encore confiés et ceux dont une session confiée après le
 * push n'est pas close.
 */
const busyUnitsOf = (run: Run): Unit[] => {
  const groups = run.groups ?? []
  // Close : seuls ses groupes encore confiés à un worker (ou rendus, pas clos) retiennent encore ; le worker peut
  // écrire ses fichiers après la clôture de sa mission. Archivée, ou livrée (close, « Version et push » faite et
  // poussée : `isDeliveredRun`) et pas encore archivée, puisque la livraison n'archive plus (décision « une mission
  // livrée retient comme une archivée ») : un groupe rendu ne retient plus, même jamais clos (ce que son worker
  // écrirait reste dans son worktree, qui n'atteint main que par une fusion) ; sans quoi une fermeture jamais
  // enregistrée retenait les autres missions pour toujours. Close sans livraison (versionnée sans push comprise) :
  // la règle des missions closes. Livrée puis reprise et close de nouveau, une session de worker confiée après le
  // push et pas close (du travail qui n'est pas parti) retient encore, comme celle d'une mission close ; une
  // session d'avant le push ne retient plus, même jamais close.
  if (run.archivedAt !== undefined || run.status === 'done') {
    const isArchived = run.archivedAt !== undefined
    const shippedAt = isArchived ? undefined : shippedAtOf(run)
    const isHeldAfterShip = (link: GroupLink) => [link, ...earlierOf(link)].some(s => isTime(s.at) && s.at > shippedAt! && s.closing?.state !== 'closed')
    return groups
      .filter(g => g.linked !== undefined || (!isArchived && g.delegated !== undefined && !isClosedLink(g.delegated) && (shippedAt === undefined || isHeldAfterShip(g.delegated))))
      .map(g => ({ run, group: g.id, zones: crossZones([...textsOf(g.files), ...openFilesOf(run, groupTicketIds(run, g))]), resources: textsOf(g.resources) }))
  }
  if (groups.length === 0) return isLotUnderway(run) ? [{ run, group: LOT_KEY, zones: crossZones(openFilesOf(run, run.tickets.map(t => t.id))), resources: [] }] : []
  return groups.filter(g => isGroupUnderway(run, g)).map(g => ({ run, group: g.id, zones: crossZones([...textsOf(g.files), ...openFilesOf(run, groupTicketIds(run, g))]), resources: textsOf(g.resources) }))
}

/** Les unités d'une mission qui ne sont pas encore parties : ses groupes ni confiés ni rendus et pas finis, ou son lot sans groupes. */
const startingUnitsOf = (run: Run): Unit[] => {
  const groups = run.groups ?? []
  // Un lot déjà en cours n'attend jamais : seul celui qui n'est pas encore parti attend.
  if (groups.length === 0) return run.tickets.some(t => t.status !== 'done') && !isLotUnderway(run) ? [{ run, group: LOT_KEY, zones: crossZones(openFilesOf(run, run.tickets.map(t => t.id))), resources: [] }] : []
  return groups
    .filter(g => !isGroupUnderway(run, g))
    .map(g => ({ g, open: openFilesOf(run, groupTicketIds(run, g)) }))
    .filter(x => groupTicketIds(run, x.g).some(id => ticketOf(run, id)?.status !== 'done'))
    .map(({ g, open }) => ({ run, group: g.id, zones: crossZones([...textsOf(g.files), ...open]), resources: textsOf(g.resources) }))
}

/** Une paire forcée : le groupe retenu ici (ou `LOT_KEY`), la mission et le groupe attendus. */
export type ForcedPair = { held: string; run: string; group: string; on?: 'plan' }

/** Les forçages relus d'une mission : seulement ceux en forme (une paire hors forme ne lève rien). */
export const soundForced = (v: unknown): ForcedHold[] =>
  Array.isArray(v)
    ? v.filter(
        (f): f is ForcedHold =>
          f !== null && typeof f === 'object' && (isGroupId(f.held) || f.held === LOT_KEY) && isSafeId(f.run) && (isGroupId(f.group) || f.group === LOT_KEY) && isTime(f.at) && (f.on === undefined || f.on === 'plan'),
      )
    : []

/** Ce qu'une unité pas encore partie attend dans une autre mission, et ce qu'elles ont en commun. */
export type OutsideHold = { held: string; run: string; title: string; group: string; shared: string; on: 'file' | 'resource' | 'plan' }

/**
 * Les retenues de la mission `runId` d'après le board relu : pour chaque unité pas encore partie, chaque
 * unité en cours d'une autre mission qui touche un même fichier ou une même ressource, sauf les paires
 * forcées (celles de la mission et `extra`, venues du fichier de coordination).
 */
export const outsideHolds = (board: Board, runId: string, extra: readonly ForcedPair[] = []): OutsideHold[] => {
  const run = board.runs.find(r => r.id === runId)
  if (!run || run.archivedAt !== undefined || run.status === 'done') return []
  const busy = board.runs.filter(r => r.id !== runId).flatMap(busyUnitsOf)
  if (busy.length === 0) return []
  // Un forçage du plan (`on: 'plan'`) ne lève jamais une retenue de fichier : elle reste en dessous.
  const forced = [...soundForced(run.forced), ...extra].filter(f => f.on !== 'plan')
  const out: OutsideHold[] = []
  for (const c of startingUnitsOf(run)) {
    for (const b of busy) {
      if (forced.some(f => f.held === c.group && f.run === b.run.id && f.group === b.group)) continue
      const shared = overlapOf(c, b)
      if (shared === null) continue
      const on = overlapOf({ zones: c.zones, resources: [] }, { zones: b.zones, resources: [] }) !== null ? 'file' : 'resource'
      out.push({ held: c.group, run: b.run.id, title: b.run.title, group: b.group, shared, on })
    }
  }
  return out
}

/** Les retenues rangées par unité retenue. */
export const holdMapOf = (holds: readonly OutsideHold[]): Map<string, OutsideHold[]> => {
  const out = new Map<string, OutsideHold[]>()
  for (const h of holds) out.set(h.held, [...(out.get(h.held) ?? []), h])
  return out
}

/**
 * Deux unités en cours de deux missions qui ont un fichier ou une ressource en commun : deux lancements
 * presque simultanés sont passés tous les deux (le COO le signale).
 */
export const crossedLaunches = (board: Board, extra: (runId: string) => readonly ForcedPair[] = () => []): { a: { run: string; title: string; group: string }; b: { run: string; title: string; group: string }; shared: string }[] => {
  const busy = board.runs.flatMap(busyUnitsOf)
  // Une paire forcée est partie ensemble sur décision de la personne : rien à signaler.
  const isForced = (x: Unit, y: Unit): boolean => [...soundForced(x.run.forced), ...extra(x.run.id)].some(f => f.on !== 'plan' && f.held === x.group && f.run === y.run.id && f.group === y.group)
  const out: { a: { run: string; title: string; group: string }; b: { run: string; title: string; group: string }; shared: string }[] = []
  for (let i = 0; i < busy.length; i++) {
    for (let j = i + 1; j < busy.length; j++) {
      const a = busy[i]!
      const b = busy[j]!
      if (a.run.id === b.run.id || isForced(a, b) || isForced(b, a)) continue
      const shared = overlapOf(a, b)
      if (shared !== null) out.push({ a: { run: a.run.id, title: a.run.title, group: a.group }, b: { run: b.run.id, title: b.run.title, group: b.group }, shared })
    }
  }
  return out
}

/** Un groupe d'une autre mission confié à un worker et pas encore rendu, avec ses fichiers (mêmes exclusions que les retenues). */
export type InFlightElsewhere = { run: string; title: string; group: string; files: string[] }

/**
 * Les groupes des autres missions du projet confiés à un worker et pas encore rendus (`linked`), d'après
 * le board relu, archivées comprises (leur worker écrit encore) : ce qu'une discussion qui code ici risque
 * de recouper. Calculés à la demande, jamais gardés ; un groupe sans fichier n'y est pas.
 */
export const inFlightElsewhere = (board: Board, runId: string): InFlightElsewhere[] =>
  board.runs
    .filter(r => r.id !== runId)
    .flatMap(run =>
      (run.groups ?? [])
        .filter(g => g.linked !== undefined)
        .map(g => ({ run: run.id, title: String(run.title), group: String(g.id), files: crossZones([...textsOf(g.files), ...openFilesOf(run, groupTicketIds(run, g))]).map(z => z.raw) })),
    )
    .filter(u => u.files.length > 0)

// ─── Plan des vagues du projet (`hooks/plan-projet.ts`) ────────────────────
//
// Les unités que le plan range, relevées sur le board, et les attentes qu'un plan validé impose à une
// mission. Invariant : « Un groupe ne part jamais avant ce que le plan validé lui fait attendre, sauf
// forçage ; un plan illisible ne lance rien, et les retenues de fichiers restent. »

/** Une unité du plan, avec ce qu'elle touche (fichiers et ressources, mêmes exclusions que les retenues). */
export type ProjectUnit = PlanUnit & { zones: Zone[]; resources: string[] }

/**
 * Les unités pas encore finies de toutes les missions non archivées : celles déjà parties (`isBusy`), et
 * celles à lancer avec les groupes de leur mission qu'elles attendent ; une mission close ne garde que ses
 * groupes encore confiés à un worker ou rendus sans être clos, une mission livrée que ceux encore confiés et
 * ceux qu'une session confiée après le push, pas close, retient (`busyUnitsOf`).
 */
export const projectUnits = (board: Board): ProjectUnit[] =>
  board.runs
    .filter(r => r.archivedAt === undefined)
    .flatMap(run => {
      const busy = busyUnitsOf(run).filter(u => u.group === LOT_KEY || isGroupId(u.group)).map(u => ({ run: run.id, title: run.title, group: u.group, isBusy: true, after: [] as string[], zones: u.zones, resources: u.resources, ...(run.status === 'done' ? { isClosed: true } : {}) }))
      if (run.status === 'done') return busy
      const plan = groupPlan(run)
      // Un id de groupe hors forme n'entre dans aucun plan (il n'entrerait dans aucune entrée) : ce groupe reste aux retenues de fichiers.
      const starting = startingUnitsOf(run).filter(u => u.group === LOT_KEY || isGroupId(u.group)).map(u => ({ run: run.id, title: run.title, group: u.group, isBusy: false, after: plan?.groups.find(v => v.group.id === u.group)?.waitsOn ?? [], zones: u.zones, resources: u.resources }))
      return [...busy, ...starting]
    })

/** Deux unités du plan ont un fichier ou une ressource en commun. */
export const unitsOverlap = (a: ProjectUnit, b: ProjectUnit): boolean => overlapOf(a, b) !== null

/** Ce que disent un lancement refusé et la carte « Ensuite » quand le plan du projet ne se lit pas. */
export const PLAN_UNREAD_TEXT = 'Plan du projet illisible : aucun départ, retenues gardées'

/** Ce que dit une attente du plan à la place du fichier en commun. */
export const PLAN_SHARED = 'plan du projet'

/**
 * L'unité attendue n'attend plus rien d'elle : sa mission est absente, archivée ou close, l'unité n'est
 * plus dans le plan de sa mission (retirée), ou elle est finie (ses tickets faits, aucun worker en vol ni
 * rendu sans être clos). Un envoi annulé laisse le groupe à lancer : il est encore attendu.
 */
const isAwaitedOver = (board: Board, runId: string, group: string): boolean => {
  const run = board.runs.find(r => r.id === runId)
  if (!run || run.archivedAt !== undefined || run.status === 'done') return true
  const groups = run.groups ?? []
  if (group === LOT_KEY) return groups.length > 0 || run.tickets.every(t => t.status === 'done')
  const g = groups.find(x => x.id === group)
  if (!g) return true
  return isGroupDone(run, g) && g.linked === undefined && (g.delegated === undefined || isClosedLink(g.delegated))
}

/**
 * Les attentes que le plan validé impose à la mission `runId` (`waits`, relues du fichier de
 * coordination) : pour chacune de ses unités pas encore parties, chaque unité attendue d'une autre mission
 * qui ne l'est pas encore, sauf les paires forcées (celles de la mission et `extra`). Comme une retenue,
 * elles se lèvent seules ; elles se montrent « plan du projet ».
 */
export const planHolds = (board: Board, runId: string, waits: readonly PlanWait[], extra: readonly ForcedPair[] = []): OutsideHold[] => {
  const run = board.runs.find(r => r.id === runId)
  if (!run || run.archivedAt !== undefined || run.status === 'done') return []
  const starting = new Set(startingUnitsOf(run).map(u => u.group))
  // Seul un forçage du plan lève une attente du plan ; celui d'une retenue de fichier ne la lève pas.
  const forced = [...soundForced(run.forced), ...extra].filter(f => f.on === 'plan')
  const out: OutsideHold[] = []
  for (const w of waits) {
    if (w.run !== runId || !starting.has(w.group) || isAwaitedOver(board, w.awaited.run, w.awaited.group)) continue
    if (forced.some(f => f.held === w.group && f.run === w.awaited.run && f.group === w.awaited.group)) continue
    if (out.some(h => h.held === w.group && h.run === w.awaited.run && h.group === w.awaited.group)) continue
    const title = board.runs.find(r => r.id === w.awaited.run)?.title ?? w.awaited.run
    out.push({ held: w.group, run: w.awaited.run, title, group: w.awaited.group, shared: PLAN_SHARED, on: 'plan' })
  }
  return out
}

/** Les attentes d'un plan qui comptent encore : celles dont l'unité attendue n'est pas finie. */
export const liveWaits = (board: Board, waits: readonly PlanWait[]): PlanWait[] => waits.filter(w => !isAwaitedOver(board, w.awaited.run, w.awaited.group))

/** Force une retenue dans la mission active ici, pour la seule paire nommée. Rien quand elle l'est déjà ou que la paire est hors forme. */
export const forceHold = (board: Board, pair: ForcedPair, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || soundForced([{ ...pair, at: now }]).length === 0) return null
  if (soundForced(run0.forced).some(f => f.held === pair.held && f.run === pair.run && f.group === pair.group && f.on === pair.on)) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.forced = [...soundForced(run.forced), { held: pair.held, run: pair.run, group: pair.group, at: now, ...(pair.on === 'plan' ? { on: 'plan' as const } : {}) }]
  run.updatedAt = now
  const other = board.runs.find(r => r.id === pair.run)
  log(run, now, '⇥', `${pair.on === 'plan' ? 'Plan du projet forcé' : 'Retenue forcée'} : ${pair.held === LOT_KEY ? 'le lot' : `groupe ${pair.held}`} part sans attendre ${pair.group === LOT_KEY ? 'le lot' : `le groupe ${pair.group}`} de « ${neutralLine(other?.title ?? pair.run)} »`, 'warn')
  return { board: b, fx: noFx() }
}

/** La fusion des forçages de deux copies d'une mission : l'union, une paire une fois (la date la plus ancienne). */
const keepForced = (kept: Run, other: Run | undefined): Run => {
  const theirs = soundForced(other?.forced)
  if (theirs.length === 0) return kept
  const byPair = new Map<string, ForcedHold>()
  for (const f of [...soundForced(kept.forced), ...theirs]) {
    const key = `${f.held}|${f.run}|${f.group}|${f.on ?? ''}`
    const was = byPair.get(key)
    if (!was || f.at < was.at) byPair.set(key, f)
  }
  const forced = [...byPair.values()].sort((x, y) => x.at - y.at)
  return JSON.stringify(forced) === JSON.stringify(kept.forced ?? []) ? kept : { ...kept, forced }
}

/**
 * Les dossiers trop larges d'un plan : un groupe qui déclare un dossier contenant des fichiers
 * nommés par un autre groupe. Rend une phrase par cas, pour le dire à Claude.
 */
const wideFolders = (run: Run, groups: readonly TicketGroup[]): string[] => {
  const views = groups.map(group => ({ group, open: group.tickets.map(id => ticketOf(run, id)).filter((t): t is Ticket => t !== undefined && t.status !== 'done') }))
  const out: string[] = []
  for (const a of views) {
    for (const x of zonesOf(a)) {
      for (const b of views) {
        if (b === a) continue
        const inside = zonesOf(b).find(y => y.key.startsWith(`${x.key}/`))
        if (inside) out.push(`${a.group.id} declares the folder "${x.raw}", which covers ${b.group.id}'s "${inside.raw}"`)
      }
    }
  }
  return out
}

/**
 * Les lettres d'un plan qui contredisent l'ordre d'exécution : un groupe qui attend un groupe de
 * lettre plus loin, ou qu'une dépendance hors du lot retient alors qu'un groupe de lettre plus loin
 * est prêt. Rien une fois un groupe confié à un worker : ses lettres nomment déjà sa session et sa branche.
 */
const lettersOutOfOrder = (run: Run): string[] => {
  if ((run.groups ?? []).some(isSentGroup)) return []
  const plan = groupPlan(run)
  if (!plan) return []
  const before = (x: string, y: string): boolean => x.localeCompare(y, 'en', { numeric: true }) < 0
  const views = plan.groups.filter(v => !v.isFallback && v.state !== 'done')
  const out: string[] = []
  for (const v of views) {
    const id = v.group.id
    const later = v.waitsOn.filter(w => before(id, w))
    if (later.length > 0) {
      out.push(`${id} waits for ${later.join(', ')}`)
      continue
    }
    if (v.waitsOutside.length === 0 && v.waitsElsewhere.length === 0) continue
    const ready = views.filter(r => r.state === 'ready' && before(id, r.group.id)).map(r => r.group.id)
    if (ready.length > 0) out.push(`${id} waits outside the lot, ${ready.join(', ')} ${ready.length > 1 ? 'are' : 'is'} ready`)
  }
  return out
}

/** Une ressource comparable : espaces resserrés, en minuscules. */
const resourceKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Le plan envoyé par Claude : chaque ticket connu dans un seul groupe (le premier qui le cite),
 * les ids inconnus mis de côté pour le lui dire. Un `continuesHere` reçu est ignoré : un groupe
 * ne se fait que dans un worker.
 */
const parseGroups = (run: Run, value: unknown): { groups: TicketGroup[]; unknown: string[]; invalid: string[]; merged: string[] } => {
  const groups: TicketGroup[] = []
  const unknown: string[] = []
  const invalid: string[] = []
  const merged: string[] = []
  const seen = new Set<string>()
  for (const one of asList(value)) {
    const raw = str(one.id)
    // Un id qui ne change que de casse est le groupe déjà enregistré : il garde son id, qui nomme
    // son worktree et sa branche (un id enregistré n'est jamais renommé). L'id exact d'abord : une
    // mission d'avant peut porter deux ids qui ne diffèrent que de casse ; alors seul l'exact vaut.
    const recorded = recordedGroup(run, raw)
    // Hors forme, l'id casserait un nom de worktree, un titre ou une commande (D1) : refusé, jamais
    // nettoyé ; seul un id déjà enregistré (une mission d'avant) reste accepté tel quel.
    if (!isGroupId(raw) && !recorded) {
      invalid.push(raw)
      continue
    }
    const id = recorded?.id ?? raw
    // Deux ids qui ne diffèrent que de casse nommeraient le même worktree (macOS, Windows) : un seul
    // groupe, qui reçoit aussi les tickets du second (dit dans la réponse).
    // Deux groupes enregistrés tous deux (une mission d'avant) restent deux groupes.
    const isRecorded = (gid: string) => (run.groups ?? []).some(g => g.id === gid)
    const twin = groups.find(g => g.id.toLowerCase() === id.toLowerCase() && !(g.id !== id && isRecorded(g.id) && isRecorded(id)))
    if (twin) {
      for (const one_ of Array.isArray(one.tickets) ? one.tickets : []) {
        const t = ticketOf(run, String(one_))
        if (!t) unknown.push(String(one_))
        else if (!seen.has(t.id)) {
          seen.add(t.id)
          twin.tickets.push(t.id)
        }
      }
      const files = [...(twin.files ?? []), ...(parsePaths(one.files, LIMITS.groupFiles) ?? [])].filter((f, i, all) => all.indexOf(f) === i).slice(0, LIMITS.groupFiles)
      if (files.length > 0) twin.files = files
      const resources = [...(twin.resources ?? []), ...(Array.isArray(one.resources) ? one.resources : []).map(r => clip(str(r).replace(/\s+/g, ' '), 40))]
        .filter((r, i, all) => r !== '' && all.findIndex(o => resourceKey(o) === resourceKey(r)) === i)
        .slice(0, LIMITS.groupResources)
      if (resources.length > 0) twin.resources = resources
      merged.push(`${raw} into ${twin.id}`)
      continue
    }
    const tickets: string[] = []
    for (const raw of Array.isArray(one.tickets) ? one.tickets : []) {
      const t = ticketOf(run, String(raw))
      if (!t) {
        unknown.push(String(raw))
        continue
      }
      if (!seen.has(t.id)) {
        seen.add(t.id)
        tickets.push(t.id)
      }
    }
    if (tickets.length === 0) continue
    const files = parsePaths(one.files, LIMITS.groupFiles) ?? []
    const resources = (Array.isArray(one.resources) ? one.resources : [])
      .map(r => clip(str(r).replace(/\s+/g, ' '), 40))
      .filter((r, i, all) => r !== '' && all.findIndex(o => resourceKey(o) === resourceKey(r)) === i)
      .slice(0, LIMITS.groupResources)
    const why = str(one.why)
    groups.push({
      id,
      name: clip(str(one.name) || id, 60),
      tickets,
      ...(why ? { why: clip(why, 160) } : {}),
      ...(files.length > 0 ? { files } : {}),
      ...(resources.length > 0 ? { resources } : {}),
    })
    if (groups.length >= LIMITS.groups) break
  }
  return { groups, unknown, invalid, merged }
}

/**
 * Ce qui fait refuser le plan du découpage d'une rétro, vide quand il est gardé tel quel : un id de
 * groupe hors forme, un ticket que l'appel n'apporte pas, ou aucun groupe.
 */
const retroPlanRefusal = (parsed: ReturnType<typeof parseGroups>, isKept: boolean): string =>
  parsed.invalid.length > 0
    ? `group ids out of form (${parsed.invalid.map(id => JSON.stringify(id)).join(', ')}): a group id has ${GROUP_ID_FORM}, nothing else`
    : parsed.unknown.length > 0
      ? `unknown ticket ids in the groups (${parsed.unknown.join(', ')}): each one is among the tickets of this call or already on the dashboard`
      : isKept
        ? ''
        : 'an empty plan: at least one group, every ticket in exactly one group'

/**
 * Un découpage de rétro refusé : le tableau de bord d'avant l'appel, sans effet, et la réponse dit
 * pourquoi. Rien de l'appel n'est enregistré, quoi qu'il porte d'autre (choix déclarés, note, statuts).
 */
const refusedCut = (board: Board, why: string): { board: Board; fx: Effects; text: string } => {
  const was = activeRun(board)
  return { board, fx: noFx(), text: `${was ? summaryOf(was) : ''} · nothing of this call was recorded, whatever it carried · ${why}` }
}

/** Ce qui ferme la session de pistes qui retient la phase, selon où elle en est (comme la fin de phase refusée). */
const heldRemedy = (phase: FlowPhase): string => {
  const link = phase.linked
  if (link?.session === undefined) return 'its worker was never launched: launch it, or tell the user, who sends the request again or cancels the send from the dashboard (« Redemander », « Annuler »)'
  if (linkedInFlight(phase).length > 0) return 'its worker is still applying items: wait for its final note, check its work, send the full items list with each verdict, then close it by the procedure under « Close now » and send "closed"'
  if (link.closing?.state === 'app') return 'its session is to archive in the app: once the user says it is archived, close it by the procedure (line « To archive in the app ») and send "closed"'
  if (link.closing?.state === 'stopped') return 'its closing stopped: the user relaunches it from the dashboard (« ↻ Relancer la fermeture »), then close it by the procedure under « Close now » and send "closed"'
  return 'its items are judged: close it by the procedure under « Close now » and send "closed"'
}

export type GroupState = 'done' | 'ready' | 'waiting'

/** Ce qui retient un groupe prêt hors d'un lot : l'autre groupe, et le fichier ou la ressource en commun, dit court. */
export type GroupConflict = { with: string; on: string }

/** Un groupe tel que le panneau le montre : ses tickets, son état, sa vague, ses voisins ∥. */
export type GroupView = {
  group: TicketGroup
  /** Les tickets qu'aucun groupe ne cite, rassemblés pour ne rien perdre de vue. */
  isFallback: boolean
  tickets: Ticket[]
  open: Ticket[]
  state: GroupState
  /** Groupes dont un ticket ouvert bloque l'un des siens. */
  waitsOn: string[]
  /** Bloqueurs hors du lot encore ouverts (décisions, tâches d'autrui, inconnus). */
  waitsOutside: string[]
  /** Les groupes en cours d'autres missions qu'il attend (retenue entre missions : un fichier ou une ressource en commun). */
  waitsElsewhere: OutsideHold[]
  /** Vague d'exécution (0 = la première) ; -1 pour un groupe fait. */
  wave: number
  /** Pris dans une attente circulaire entre groupes : l'ordre est à revoir. */
  isCyclic: boolean
  /** Aucun ticket du groupe n'est commencé ni fait : il peut encore partir en parallèle. */
  isFresh: boolean
  /** Les autres groupes du lot parallèle, quand ce groupe en fait partie. */
  parallelWith: string[]
  /** Confié à un worker qui ne l'a pas encore rendu : ni relancé, ni pris dans un lot. */
  isDelegated: boolean
  /**
   * Prêt et pas commencé : les groupes avec qui il a un fichier ou une ressource en commun, parmi
   * ceux du lot (quand il n'en est pas), ceux confiés à un worker et ceux en cours ici.
   */
  conflicts: GroupConflict[]
}

export type GroupPlan = {
  groups: GroupView[]
  waves: number
  /**
   * Une vague veut dire « en parallèle » (glossaire) : au moins un niveau d'attente a deux groupes
   * qui peuvent avancer ensemble, sans fichier ni ressource en commun. Sinon, pas de titre « Vague N ».
   */
  hasParallelWave: boolean
  /** Le lot à lancer ensemble (deux groupes au moins), vide sinon. */
  parallelBatch: string[]
  /** Le lot possible, mis en attente parce qu'un groupe de la mission est en cours. */
  heldBatch: string[]
  /** Les groupes commencés et pas finis : tant qu'il y en a, rien ne part en parallèle. */
  busy: string[]
  /** D'autres lots possibles, chacun ouvert par un groupe prêt resté hors du lot principal. */
  otherBatches: string[][]
  /** Les groupes confiés à un worker et pas encore rendus. */
  delegated: string[]
}

export const FALLBACK_GROUP = '…'

/**
 * Un ticket ajouté au lot après le plan, sans groupe (un ticket trouvé en route qui retient le lot,
 * par exemple) : il rejoint le groupe dont il fait partie de la chaîne. D'abord le groupe des
 * tickets qu'il retient, placé avant le premier ; sinon le groupe des tickets qu'il attend, à la
 * fin. Seulement quand ce groupe est unique : sinon il reste dans « Autres ».
 */
const attachLoose = (run: Run, groups: TicketGroup[]) => {
  const owner = (id: string): TicketGroup | undefined => groups.find(g => g.tickets.some(x => sameTicket(x, id)))
  let isMoved = true
  while (isMoved) {
    isMoved = false
    for (const t of run.tickets) {
      if (owner(t.id)) continue
      const held = run.tickets.filter(x => owner(x.id) && (x.blockedBy ?? []).some(b => sameTicket(b, t.id)))
      const awaited = (t.blockedBy ?? []).map(b => ticketOf(run, b)).filter((x): x is Ticket => x !== undefined && owner(x.id) !== undefined)
      const targets = [...new Set((held.length > 0 ? held : awaited).map(x => owner(x.id)!))]
      if (targets.length !== 1) continue
      const g = targets[0]!
      const at = held.length > 0 ? minOf(held.map(x => g.tickets.findIndex(id => sameTicket(id, x.id))).filter(i => i >= 0)) : g.tickets.length
      g.tickets = [...g.tickets.slice(0, at), t.id, ...g.tickets.slice(at)]
      isMoved = true
    }
  }
}

/**
 * Le plan d'exécution de la mission, ou null sans groupes déclarés. Un groupe en attend un autre
 * quand l'un de ses tickets a un bloqueur encore ouvert dans cet autre ; les vagues en découlent.
 */
export const groupPlan = (run: Run, outside?: ReadonlyMap<string, readonly OutsideHold[]>): GroupPlan | null => {
  // Les tickets de chaque groupe, rattachés compris, viennent d'un seul calcul (`groupTicketsOfRun`).
  const attached = groupTicketsOfRun(run).byIndex
  const groups = run.groups ?? []
  const declared = groups.flatMap((g, i) => (attached[i] ? [{ ...g, tickets: [...attached[i]!] }] : []))
  if (declared.length === 0) return null
  // « Commencé » se juge sur les tickets déclarés : un ticket rattaché ne rend pas un groupe commencé.
  const declaredIds = new Map(groups.filter((_, i) => attached[i]).map(g => [g.id, g.tickets.filter(id => ticketOf(run, id) !== undefined)]))
  const cited = new Set(declared.flatMap(g => g.tickets))
  const rest = run.tickets.filter(t => !cited.has(t.id)).map(t => t.id)
  const all: { group: TicketGroup; isFallback: boolean }[] = declared.map(group => ({ group, isFallback: false }))
  if (rest.length > 0) all.push({ group: { id: FALLBACK_GROUP, name: 'Autres', tickets: rest }, isFallback: true })
  const groupOf = new Map<string, string>()
  for (const { group } of all) for (const id of group.tickets) groupOf.set(id, group.id)

  const views: GroupView[] = all.map(({ group, isFallback }) => {
    const tickets = group.tickets.map(id => ticketOf(run, id)!)
    const open = tickets.filter(t => t.status !== 'done')
    const waitsOn = new Set<string>()
    const waitsOutside = new Set<string>()
    for (const t of open) {
      for (const b of openBlockers(run, t)) {
        const inLot = ticketOf(run, b)
        const owner = inLot ? groupOf.get(inLot.id) : undefined
        if (owner === undefined) waitsOutside.add(b)
        else if (owner !== group.id) waitsOn.add(owner)
      }
    }
    // Un groupe déjà parti n'attend jamais une autre mission : seul celui qui n'est pas encore parti attend.
    const waitsElsewhere = isFallback || group.linked !== undefined ? [] : [...(outside?.get(group.id) ?? [])]
    return {
      group,
      isFallback,
      tickets,
      open,
      // Un groupe confié reste au travail tant qu'il n'est pas rendu, même tous ses tickets relayés faits.
      state: open.length === 0 && group.linked === undefined ? 'done' : waitsOn.size === 0 && waitsOutside.size === 0 && waitsElsewhere.length === 0 ? 'ready' : 'waiting',
      waitsOn: [...waitsOn],
      waitsOutside: [...waitsOutside],
      waitsElsewhere,
      wave: -1,
      isCyclic: false,
      isFresh: (declaredIds.get(group.id) ?? group.tickets)
        .map(id => ticketOf(run, id)!)
        .every(t => t.status !== 'doing' && t.status !== 'done'),
      parallelWith: [],
      isDelegated: group.linked !== undefined,
      conflicts: [],
    }
  })

  // Vagues : un groupe passe dès que ceux qu'il attend sont passés. Une attente circulaire ne
  // bloque pas le calcul : ses groupes passent ensemble au niveau suivant, marqués « à revoir ».
  let remaining = views.filter(v => v.state !== 'done')
  let wave = 0
  while (remaining.length > 0) {
    const ids = new Set(remaining.map(v => v.group.id))
    let layer = remaining.filter(v => v.waitsOn.every(w => !ids.has(w)))
    if (layer.length === 0) {
      layer = remaining
      for (const v of layer) v.isCyclic = true
    }
    for (const v of layer) v.wave = wave
    remaining = remaining.filter(v => !layer.includes(v))
    wave += 1
  }

  // Chaque groupe se fait dans son worker, ses tickets en séquence, partageant leur contexte ;
  // des groupes indépendants partent ensemble, un worker chacun.
  // Le lot réunit, dans l'ordre, les groupes prêts (aucun bloqueur encore ouvert) et pas encore
  // commencés, chacun retenu s'il n'a ni fichier ni ressource en commun avec un groupe déjà retenu
  // ou confié à un worker : un fichier ou une ressource en commun vaut dépendance.
  const candidates = views.filter(v => !v.isFallback && v.state === 'ready' && v.isFresh && !v.isCyclic && !v.isDelegated)
  const inFlight = views.filter(v => v.isDelegated)
  const lotFrom = (order: GroupView[]): GroupView[] => {
    const kept: GroupView[] = []
    for (const v of order) if (![...inFlight, ...kept].some(o => sharedOf(v, o) !== null)) kept.push(v)
    return kept
  }
  const batch = lotFrom(candidates)
  const lot = batch.length >= 2 ? batch.map(v => v.group.id) : []
  // Un groupe commencé et pas fini occupe la mission (une discussion à la fois) : le lot attend.
  // Un groupe confié à un worker ne l'occupe pas : la mission reste ici.
  const busyViews = views.filter(v => v.state !== 'done' && !v.isFresh && !v.isDelegated)
  const busy = busyViews.map(v => v.group.id)
  if (busy.length === 0) for (const v of batch) if (lot.includes(v.group.id)) v.parallelWith = lot.filter(id => id !== v.group.id)
  // Ce qui retient chaque groupe prêt : le lot (quand il n'en est pas), les workers, le travail d'ici.
  for (const v of candidates) {
    const others = [...(batch.includes(v) ? [] : batch), ...inFlight, ...busyViews]
    v.conflicts = others.flatMap(o => {
      const on = sharedOf(v, o)
      return on === null ? [] : [{ with: o.isFallback ? 'Autres' : o.group.id, on }]
    })
  }
  // D'autres lots : chacun ouvert par un groupe prêt resté hors du lot principal.
  const keyOf = (ids: readonly string[]) => [...ids].sort().join('\u0000')
  const otherBatches: string[][] = []
  if (busy.length === 0) {
    for (const v of candidates) {
      if (batch.includes(v) || otherBatches.length >= LIMITS.otherBatches) continue
      const alt = lotFrom([v, ...candidates.filter(o => o !== v)]).map(o => o.group.id)
      if (alt.length < 2 || keyOf(alt) === keyOf(lot) || otherBatches.some(o => keyOf(o) === keyOf(alt))) continue
      otherBatches.push(alt)
    }
  }
  // Un groupe circulaire attend les autres de son niveau : il n'avance avec aucun.
  const hasParallelWave = Array.from({ length: wave }, (_, w) => views.filter(v => v.wave === w && !v.isFallback && !v.isCyclic)).some(level =>
    level.some((v, i) => level.slice(i + 1).some(o => sharedOf(v, o) === null)),
  )
  return {
    groups: views,
    waves: wave,
    hasParallelWave,
    parallelBatch: busy.length === 0 ? lot : [],
    heldBatch: busy.length > 0 ? lot : [],
    busy,
    otherBatches,
    delegated: inFlight.map(v => v.group.id),
  }
}

/**
 * Les tickets en cours, avec le groupe de chacun (null hors des groupes déclarés) et sa place dans
 * le plan, pour la couleur. Plusieurs à la fois : workers des groupes, ticket laissé en
 * cours par une autre discussion.
 */
export const doingOf = (run: Run): { ticket: Ticket; group: TicketGroup | null; groupAt: number }[] => {
  const doing = run.tickets.filter(t => t.status === 'doing')
  if (doing.length === 0) return []
  const plan = groupPlan(run)
  return doing.map(ticket => {
    const at = plan ? plan.groups.findIndex(g => !g.isFallback && g.tickets.some(x => x.id === ticket.id)) : -1
    return { ticket, group: at >= 0 ? plan!.groups[at]!.group : null, groupAt: at }
  })
}

/** Enregistre la file lancée depuis le panneau, dans l'ordre choisi. */
export const setQueue = (board: Board, ids: readonly string[], now: number): Outcome => {
  if (!activeRun(board) || ids.length === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.queue = [...ids]
  log(run, now, '▶', `File lancée : ${ids.map((id, i) => `${i + 1}) ${ticketOf(run, id)?.name ?? id}`).join(', ')}`, 'accent')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** Un GID Asana (identifiant numérique long) : son lien direct. */
export const asanaUrl = (id: string): string | null => (/^\d{10,20}$/.test(id) ? `https://app.asana.com/0/0/${id}` : null)
