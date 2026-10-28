// Moteur du tableau de bord : des transitions pures. Chacune prend le Board courant
// (gelé par l'hôte), le clone, applique un signal et rend le nouveau Board avec les
// effets d'interface à jouer (toasts, ouverture du panneau, note pour Claude), ou null
// quand le signal ne change rien.

import type {
  Artifact,
  ArtifactKind,
  Board,
  Detour,
  ExternalBlocker,
  FlowItem,
  FlowPhase,
  FlowStep,
  FoundTask,
  ItemStatus,
  Relay,
  RelayEntry,
  Run,
  SecurityCheck,
  SoloDecision,
  SyncState,
  Ticket,
  TicketGroup,
  TicketStatus,
  UiState,
  Tone,
} from '../types'
import { SKILLS, agree, skillIdOf, type PhaseSpec, type SkillDef } from './catalog.ts'
import { ownPart } from './linked.ts'
import { maxOf, minOf } from './timeline.ts'

/** Longueur gardée d'un texte affiché en entier (élément, ticket, raison, choix, entrée du journal). */
const TEXT_MAX = 300

export const LIMITS = {
  runs: 15,
  log: 80,
  artifacts: 40,
  tests: 40,
  tickets: 150,
  items: 60,
  touched: 300,
  detours: 6,
  tombstones: 50,
  groups: 12,
  groupFiles: 12,
  groupResources: 6,
  ticketFiles: 12,
  /** Autres lots parallèles proposés, en plus du lot principal. */
  otherBatches: 3,
  found: 40,
  /** Parcours archivés gardés par projet, au-delà des 15 parcours vivants. */
  archived: 100,
  decided: 30,
} as const

/** Ce que l'interface doit jouer après une transition. */
export type Effects = {
  toasts: string[]
  openPane: boolean
  /** Note à ajouter au texte du skill pour Claude : celle d'une phase, d'un détour, ou rien. */
  note: 'none' | 'phase' | 'detour'
  /**
   * Le titre que cette discussion doit prendre (série 1, Q14) : le mod le garde pour elle seule,
   * hors du board partagé (série 5, Q2), et le renvoie au moteur au prochain message ou à la reprise.
   */
  discussionTitle?: string
}

export type Outcome = { board: Board; fx: Effects } | null

const noFx = (): Effects => ({ toasts: [], openPane: false, note: 'none' })

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const clip = (text: string, max: number): string =>
  max <= 0 ? '' : text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`

const str = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

export const emptyBoard = (root: string, name: string): Board => ({ v: 1, root, name, runs: [], activeId: null })

export const isBoard = (value: unknown): value is Board =>
  typeof value === 'object' &&
  value !== null &&
  (value as Board).v === 1 &&
  typeof (value as Board).root === 'string' &&
  Array.isArray((value as Board).runs)

// ─── Lecture ──────────────────────────────────────────────────────────────

export const activeRun = (board: Board | null | undefined): Run | null =>
  board?.activeId ? (board.runs.find(r => r.id === board.activeId && r.status === 'active') ?? null) : null

export const currentPhase = (run: Run): FlowPhase => run.phases[Math.min(run.cursor, run.phases.length - 1)]!

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

/** Avancement du parcours, de 0 à 1 : phases faites, plus la part d'étapes de la phase en cours. */
export const runProgress = (run: Run): number => {
  if (run.status === 'done') return 1
  if (run.phases.length === 1) {
    const only = run.phases[0]!
    return only.status === 'done' ? 1 : stepRatio(only.steps)
  }
  const counted = run.phases.filter(p => p.status !== 'skipped' && !(p.isOptional && p.status === 'pending'))
  if (counted.length === 0) return 0
  const sum = counted.reduce(
    (n, p) => n + (p.status === 'done' ? 1 : p.status === 'active' ? Math.min(0.9, stepRatio(p.steps)) : 0),
    0,
  )
  return sum / counted.length
}

export const isRunComplete = (run: Run): boolean =>
  run.phases.every(p => p.status === 'done' || p.status === 'skipped' || (p.isOptional && p.status === 'pending'))

export type Suggestions = {
  /** La suite logique : la prochaine phase du parcours, sinon la première suite du skill. */
  primary: string | null
  others: string[]
  /** Toutes les phases requises sont faites (ou on en est à « Version et push ») : le parcours peut se clore. */
  canFinish: boolean
  /** À la livraison, ce que la mesure des versions dit de /project:version (déjà posée, ou à poser). */
  versionNote?: string
}

/** Ce que la carte « Ensuite » sait du dépôt : GitHub (pour la PR), versions déjà posées face au distant. */
export type SuggestOpts = { hasPullRequests?: boolean; isVersionSet?: boolean | null }

/**
 * Sans GitHub (distant ailleurs, ou aucun), la PR par /project:pr n'a pas de sens : le parcours
 * montré à l'écran perd sa phase « Pull request » à venir. Le parcours stocké, lui, la garde.
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
  if (next) {
    add(next.skill)
    next.alts.forEach(add)
  }
  ;(SKILLS[phase.skill]?.next ?? []).forEach(add)
  // Livrer (ou en rendre compte) avant d'avoir fini les tickets n'a pas de sens : tout attend le dernier.
  const t = countTickets(run.tickets)
  // Un groupe encore confié à une session liée n'est pas fini ici, même ses tickets relayés faits (affichage).
  const isUnfinished = (t.total > t.done || (run.groups ?? []).some(g => g.linked !== undefined)) && SKILLS[phase.skill]?.hasTickets === true
  // Un groupe fini attend sa revue (/code-review) ; la livraison attend qu'elles soient toutes faites.
  const isReviewDue = SKILLS[phase.skill]?.hasTickets === true && needsReview(run)
  // Un compte rendu ouvert attend la validation de la personne : pas de livraison avant.
  const isReportOpen = phase.skill === 'compte-rendu' && phase.status !== 'done'
  // Avec des groupes, la revue se lance depuis la ligne du groupe (/code-review ici, ou sa session
  // liée pour un groupe qu'elle a fait) : la suite proposée reste le lancement des groupes.
  const isReviewHere = isReviewDue && (run.groups ?? []).length === 0
  const kept = [
    ...(isReviewHere ? ['final-review'] : []),
    ...(isUnfinished || isReviewDue ? list.filter(skill => !AFTER_TICKETS.has(skill)) : list)
      .filter(skill => skill !== 'final-review')
      .filter(skill => !(isReportOpen && DELIVERY.has(skill))),
  ]
  // Version faite, push pas encore : la suite est /project:push, avant la pull request, et
  // /project:version reste à côté.
  if (phase.skill === 'project:version' && phase.status !== 'done' && !isPushed(phase)) {
    // La pull request attend le push : elle n'est même pas proposée en second.
    const rest = kept.filter(skill => skill !== 'project:push' && skill !== 'project:version' && skill !== 'project:pr' && skill !== 'pr')
    kept.splice(0, kept.length, 'project:push', 'project:version', ...rest)
  }
  // Version et push toujours côte à côte, au choix : une version déjà posée par le lot (chaque
  // plugin ou paquet changé a une nouvelle version face au distant) met le push en tête.
  let versionNote: string | undefined
  if (kept[0] === 'project:version' && phase.skill !== 'project:version') {
    const rest = kept.slice(1).filter(skill => skill !== 'project:push' && skill !== 'project:version')
    if (opts.isVersionSet === true) {
      kept.splice(0, kept.length, 'project:push', 'project:version', ...rest)
      versionNote = 'version déjà posée : chaque plugin changé a une nouvelle version face au distant'
    } else {
      kept.splice(0, kept.length, 'project:version', 'project:push', ...rest)
      if (opts.isVersionSet === false) versionNote = 'un plugin changé n’a pas encore de nouvelle version : /project:version, ou /project:push sans version'
    }
  }
  // La rétro n'est plus une étape du parcours, mais reste à portée de main.
  if (opts.hasPullRequests === false) kept.splice(0, kept.length, ...kept.filter(skill => skill !== 'project:pr'))
  const others = kept.slice(1, 4).filter(skill => skill !== 'retro')
  if (phase.skill !== 'retro' && kept[0] !== 'retro') others.push('retro')
  // Pendant « Version et push », la clôture se propose à côté du push et de la pull request.
  const canFinish =
    (phase.status === 'done' || phase.skill === 'project:version') &&
    !run.phases.slice(run.cursor + 1).some(p => p.status === 'pending' && !p.isOptional)
  // Avec des groupes, une revue qui manque n'a pas de skill pour suite : elle se lance sur la ligne du groupe.
  const primary = isReviewDue && !isUnfinished && (run.groups ?? []).length > 0 ? null : (kept[0] ?? null)
  return { primary, others, canFinish, ...(versionNote ? { versionNote } : {}) }
}

/**
 * La suite recommandée pendant l'Implémentation d'un parcours à groupes, à la place des skills :
 * - `parallel` : le lot de groupes à lancer ensemble (sessions liées) ;
 * - `group` : le prochain groupe, le groupe commencé ici d'abord, sinon le premier prêt sans
 *   fichier ni ressource en commun avec un groupe en cours ;
 * - `busy` : un ticket est en cours ici, rien d'autre ne part ;
 * - `linked` : il ne reste qu'à attendre les groupes confiés à des sessions liées ;
 * - `review` : tout est fait, il manque la revue de ces groupes (bouton sur leur ligne).
 * Null hors d'une phase à tickets, sans groupes, ou quand la suite est un skill (compte rendu).
 */
export type NextLaunch =
  | { kind: 'parallel'; groups: string[] }
  | { kind: 'group'; group: string; isDelegable: boolean }
  | { kind: 'busy' | 'linked' | 'review'; groups: string[] }

export const nextLaunchFor = (run: Run): NextLaunch | null => {
  const phase = currentPhase(run)
  if (SKILLS[phase.skill]?.hasTickets !== true) return null
  const plan = groupPlan(run)
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
  const unreviewed = (run.groups ?? []).filter(g => g.linked === undefined && awaitsReview(run, g))
  if (unreviewed.length > 0 && run.tickets.every(t => t.status === 'done')) return { kind: 'review', groups: unreviewed.map(g => g.id) }
  return null
}

/**
 * Le skill dont la commande se propose, grisée dans le prompt vide, à la fin d'un tour : celui du
 * bouton principal de la carte « Ensuite ». Null quand la suite n'est pas une commande (lancer un
 * groupe, attendre une session liée, revue sur la ligne d'un groupe) ou qu'il n'y a pas de suite.
 */
export const nextCommandSkill = (run: Run, opts: SuggestOpts = {}): string | null =>
  nextLaunchFor(run) !== null ? null : suggestionsFor(run, opts).primary

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
  const units = manifests.map(m => ({ manifest: m, dir: unitOf(m) })).sort((a, b) => b.dir.length - a.dir.length)
  const touched = new Set<string>()
  for (const path of changed) {
    const unit = units.find(u => u.dir === '' || path === u.dir || path.startsWith(`${u.dir}/`))
    // Un fichier hors de tout dossier versionné (la marketplace, la doc de la racine) ne demande rien.
    if (unit) touched.add(unit.manifest)
  }
  return [...touched].every(m => bumped.includes(m))
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
  if (open && typeof open === 'object') parts.push(str(open.title) ? `parcours ouvert « ${clip(str(open.title), 40)} »` : 'parcours ouvert')
  if (str(at.resume)) parts.push('reprise du parcours')
  if (str(at.delegate)) parts.push(str(at.group) ? `session liée · groupe ${clip(str(at.group), 12)}` : 'session liée')
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
  if (list('reviewed').length > 0) parts.push(`relu ${list('reviewed').map(str).filter(Boolean).join(', ')}`)
  if (list('returned').length > 0) parts.push(`rendu ${list('returned').map(str).filter(Boolean).join(', ')}`)
  if (str(at.note)) parts.push('note')
  if (at.complete === true) parts.push('phase terminée')
  return clip(['flow-board', ...parts].join(' · '), 120)
}

/** Ce qui vient après les tickets : version, push, pull request, corps de PR. */
const DELIVERY = new Set(['project:version', 'project:push', 'project:pr', 'pr'])

/** Ce qui attend que les tickets soient faits et relus : la livraison, et le compte rendu qui la précède. */
const AFTER_TICKETS = new Set([...DELIVERY, 'compte-rendu'])

/**
 * Remet un parcours créé par une version antérieure à la forme actuelle, sans toucher à ce qui est
 * fait ou en cours : la rétro à venir disparaît des étapes, et un « Corps de PR » à venir laisse la
 * place à « Version et push » puis « Pull request » (/project:pr).
 */
export const upgradeRun = (run: Run): Run => repairRun(upgradePhases(retireSkills(run)))

/**
 * Les skills retirés de la copie mattpocock-skills (1.3.1-mathis.1), et celui qui les remplace dans
 * un parcours enregistré avant : /implement-spec par /implement (mêmes tickets), /wayfinder par
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

/** Un parcours ouvert par un skill retiré, ou qui en a une phase : sans lui, le panneau ne le dessinerait pas. */
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
  const groups = run.groups?.map(g => (returnedAt.has(g.id) ? { ...g, delegated: { at: returnedAt.get(g.id)! } } : g))
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

const SENT = /^Groupes? (.+?) confiés? à (?:une session liée|des sessions liées)$/
const RETURNED = /^Groupes? (.+?) rendus? par (?:sa session liée|leurs sessions liées)$/
const idsIn = (text: string, pattern: RegExp): string[] => pattern.exec(text)?.[1]!.split(', ') ?? []

/**
 * Les groupes rendus par leur session liée avant la 0.39.0, qui n'en gardaient pas la trace
 * (`delegated`) : le journal du parcours le dit (« ↩ Groupe A rendu par sa session liée »). Sans
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

const isAllDone = (run: Run, ids: readonly string[]): boolean =>
  ids.length > 0 && ids.every(id => run.tickets.find(t => sameTicket(t.id, id))?.status === 'done')

/**
 * Un groupe d'un seul ticket dit ni sensible ni avec logique (une icône, un document) : la revue de
 * son ticket est sa seule revue. Elle avait été suivie d'une revue du groupe sur le même diff.
 */
export const isTicketReviewEnough = (run: Run, group: TicketGroup): boolean => {
  if (group.tickets.length !== 1) return false
  const ticket = run.tickets.find(t => sameTicket(t.id, group.tickets[0]!))
  return ticket?.sensitive === false && ticket.logic === false
}

/** Un groupe relu : par /code-review, ou par la revue de son seul ticket. */
export const isGroupReviewed = (run: Run, g: TicketGroup): boolean => g.reviewedAt !== undefined || isTicketReviewEnough(run, g)

/** Un groupe fini attend encore sa revue. */
const awaitsReview = (run: Run, g: TicketGroup): boolean => !isGroupReviewed(run, g) && isAllDone(run, g.tickets)

/** Un ticket sensible, ou qui ne l'a pas dit : dans le doute, il compte comme sensible (Mathis, 26/10/2026). */
const isSensitiveTicket = (ticket: Ticket | undefined): boolean => ticket?.sensitive !== false

/** Un groupe dont un ticket touche une zone sensible, ou ne l'a pas dit : sa revue tourne sans --fix. */
export const isSensitiveGroup = (run: Run, group: TicketGroup): boolean =>
  group.tickets.some(id => isSensitiveTicket(run.tickets.find(t => sameTicket(t.id, id))))

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

/** Un groupe fini n'a pas encore eu sa revue ; sans groupes, le lot entier fini et pas relu. */
export const needsReview = (run: Run): boolean => {
  const groups = run.groups ?? []
  // Un groupe encore confié n'est pas fini ici, même ses tickets relayés faits.
  if (groups.length > 0) return groups.some(g => g.linked === undefined && awaitsReview(run, g))
  return run.reviewedAt === undefined && isAllDone(run, run.tickets.map(t => t.id))
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
 * `/code-review` vient d'être lancé : les groupes finis et pas encore relus le sont, en priorité
 * ceux de la file lancée dans cette discussion. Rend leurs noms.
 */
const markReviewed = (run: Run, now: number): string[] => {
  const queue = run.queue ?? []
  const due = (run.groups ?? []).filter(g => awaitsReview(run, g))
  const fromQueue = due.filter(g => g.tickets.some(id => queue.includes(id)))
  const targets = fromQueue.length > 0 ? fromQueue : due
  for (const g of targets) g.reviewedAt = now
  if (isAllDone(run, run.tickets.map(t => t.id))) run.reviewedAt = now
  return targets.map(g => `${g.id} (${g.name})`)
}

/**
 * Le groupe dont parle Claude quand il donne son avis de sécurité ou en rend le résultat : celui
 * qu'il nomme, sinon le dernier groupe fini (en priorité ceux de la file de cette discussion).
 * `null` sans groupes : l'avis porte alors sur le lot entier.
 */
const securityGroupOf = (run: Run, id: string): TicketGroup | null => {
  const groups = run.groups ?? []
  const named = id ? groups.find(g => g.id.toLowerCase() === id.toLowerCase()) : undefined
  if (named) return named
  const queue = run.queue ?? []
  const done = groups.filter(g => isAllDone(run, g.tickets))
  const fromQueue = done.filter(g => g.tickets.some(t => queue.includes(t)))
  const pool = fromQueue.length > 0 ? fromQueue : done
  return [...pool].sort((x, y) => (y.reviewedAt ?? 0) - (x.reviewedAt ?? 0))[0] ?? null
}

/**
 * `/security-review` vient d'être lancé : les groupes finis où il n'a pas encore tourné, en priorité
 * ceux qui sont relus et ceux de la file de cette discussion. Rend leurs noms.
 */
const markSecured = (run: Run, now: number): string[] => {
  const groups = run.groups ?? []
  if (groups.length === 0) {
    run.security = { ...run.security, ranAt: now }
    return []
  }
  const queue = run.queue ?? []
  const due = groups.filter(g => g.security?.ranAt === undefined && isAllDone(run, g.tickets))
  const pick = (list: TicketGroup[]) => {
    const fromQueue = list.filter(g => g.tickets.some(id => queue.includes(id)))
    return fromQueue.length > 0 ? fromQueue : list
  }
  const reviewed = due.filter(g => isGroupReviewed(run, g))
  const targets = pick(reviewed.length > 0 ? reviewed : due)
  for (const g of targets) g.security = { ...g.security, ranAt: now }
  return targets.map(g => `${g.id} (${g.name})`)
}

/** L'état de la revue de sécurité, pour le compte rendu. */
const securityText = (check: SecurityCheck | undefined): string => {
  if (check?.ranAt !== undefined) {
    const counts = check.findings !== undefined ? ` (${check.findings} findings, ${check.fixed ?? 0} fixed)` : ''
    return `security review run${counts}`
  }
  if (check?.isAdvised === true) return `security review advised but not run${check.why ? ` (${check.why})` : ''}`
  if (check?.isAdvised === false) return `security review judged not needed${check.why ? ` (${check.why})` : ''}`
  return ''
}

export const countTickets = (tickets: readonly Ticket[]) => ({
  total: tickets.length,
  done: tickets.filter(t => t.status === 'done').length,
  doing: tickets.filter(t => t.status === 'doing').length,
  blocked: tickets.filter(t => t.status === 'blocked').length,
  todo: tickets.filter(t => t.status === 'todo').length,
})

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

const stepsFor = (skill: string, now?: number): FlowStep[] =>
  (SKILLS[skill]?.steps ?? []).map((s, i) =>
    now !== undefined && i === 0 ? { id: s.id, status: 'active', at: now } : { id: s.id, status: 'pending' },
  )

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

const log = (run: Run, now: number, glyph: string, text: string, tone: Tone = 'info') => {
  run.log = [{ at: now, glyph, text: clip(text, TEXT_MAX), tone }, ...run.log].slice(0, LIMITS.log)
}

/**
 * Ouvre l'étape `id` ; une étape active d'après redevient à faire. Avant elle, l'étape qui était
 * en cours passe faite. Les étapes jamais atteintes passent faites quand Claude a signalé l'étape
 * lui-même (`isReported`), sautées quand le saut est déduit d'un signal (commit, tests, sous-skill).
 */
const setStep = (target: { steps: FlowStep[] }, id: string, now: number, isReported = false): boolean => {
  const at = target.steps.findIndex(s => s.id === id)
  if (at < 0) return false
  target.steps = target.steps.map((s, i): FlowStep => {
    if (i < at) {
      if (s.status === 'done' || s.status === 'skipped') return s
      return s.status === 'active' || isReported ? { id: s.id, status: 'done', at: s.at } : { id: s.id, status: 'skipped' }
    }
    if (i === at) return { id: s.id, status: 'active', at: s.status === 'active' ? s.at : now }
    return s.status === 'active' ? { id: s.id, status: 'pending' } : s
  })
  return true
}

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

/** Met le parcours de côté : terminé si ses phases requises sont faites, sinon en pause. */
const shelve = (run: Run, now: number) => {
  closeDetours(currentPhase(run), now)
  if (isRunComplete(run)) {
    run.status = 'done'
    run.finishedAt = now
  } else {
    run.status = 'paused'
  }
  run.owner = undefined
  run.updatedAt = now
}

const prune = (board: Board) => {
  // Les archives ne comptent pas : on ne les perd pas parce que d'autres parcours arrivent.
  const live = board.runs.filter(r => r.archivedAt === undefined)
  const archived = board.runs
    .filter(r => r.archivedAt !== undefined)
    .sort((x, y) => (y.archivedAt ?? 0) - (x.archivedAt ?? 0))
    .slice(0, LIMITS.archived)
  if (live.length <= LIMITS.runs && archived.length === board.runs.length - live.length) return
  const open = live.filter(r => r.status !== 'done')
  const done = live
    .filter(r => r.status === 'done')
    .sort((x, y) => (y.finishedAt ?? y.updatedAt) - (x.finishedAt ?? x.updatedAt))
  const keep = new Set([...open, ...done].slice(0, LIMITS.runs).map(r => r.id).concat(archived.map(r => r.id)))
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
    phase.steps = stepsFor(id, now)
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
 * Des tickets partent en implémentation hors de cette discussion (sessions liées) : la phase
 * Implémentation devient la phase en cours, si le parcours n'y est pas déjà.
 */
const enterImplementation = (run: Run, now: number, fx: Effects) => {
  const at = run.phases.findIndex(p => p.skill === 'implement')
  if (at < 0) return
  const phase = run.phases[at]!
  if (at > run.cursor || (at === run.cursor && phase.status === 'pending')) moveTo(run, at, phase.skill, now, fx)
  else if (at < run.cursor) reopenSkipped(run, phase.skill, now, fx)
}

/** Les groupes et les tickets du parcours que nomment les arguments d'une commande (« groupe B », un id de ticket). */
const namedInArgs = (run: Run, args: string): string[] => {
  const groups = (run.groups ?? []).filter(g => /[A-Za-z0-9]/.test(g.id) && new RegExp(`\\b(?:groupe?|group)\\s+${g.id.replace(/[^A-Za-z0-9]/g, '')}\\b`, 'i').test(args)).map(g => `groupe ${g.id}`)
  const tokens = new Set(args.split(/[\s,;:()[\]«»"']+/).filter(Boolean))
  const tickets = run.tickets.filter(t => tokens.has(t.id)).map(t => t.id)
  return [...groups, ...tickets]
}

/**
 * `/implement` lancé pour un groupe ou des tickets du parcours de cette discussion, une fois
 * l'implémentation passée (compte rendu en cours ou fait) : le parcours revient à son
 * implémentation, et son compte rendu, comme les phases d'après, est à refaire. Lancé pour un
 * groupe d'un parcours en phase compte rendu, il en ouvrait un second. Faux quand rien ne s'applique.
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
  /** Chargé dans la boucle principale (un skill chargé par un sous-agent ne bouge rien). */
  isMain: boolean
  /** Arguments de la commande ou de l'outil Skill. */
  args?: string
}

/**
 * Un skill du plugin vient d'être chargé. Dans l'ordre : sous-skill de la phase en cours,
 * phase suivante du parcours, détour, reprise d'un parcours en pause, nouveau parcours.
 */
export const applySkill = (board: Board, name: string, ctx: SkillContext): Outcome => {
  const raw = skillIdOf(name)
  // Une session liée qui travaille pour un parcours resté ailleurs n'en ouvre ni n'en reprend aucun.
  if (!raw || !ctx.isMain || board.delegate) return null
  // `/code-review` de Claude Code sans parcours actif ici : la relecture d'une branche, pas la revue d'un groupe.
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
  // Une commande de livraison n'ouvre jamais de parcours à elle seule.
  if (def.role === 'step') return null

  // Une suite proposée par la phase en cours la clôt, même quand elle ouvre un autre parcours :
  // le parcours quitté est alors terminé, plus seulement en pause, s'il ne lui reste rien d'obligatoire.
  const followed = run && (SKILLS[currentPhase(run).skill]?.next ?? []).includes(id) ? run : null
  if (run) {
    const phase = currentPhase(run)
    if (phase.status === 'active' && followed) {
      finishPhase(phase, now)
      log(run, now, '✓', `${SKILLS[phase.skill]!.label} ${agree(SKILLS[phase.skill]!, 'terminé')}`, 'ok')
    }
  }

  // La suite du parcours de cette discussion, et la rétro lancée pendant qu'il est actif ici, portent
  // son titre et ne reprennent pas un autre parcours en pause qui aurait la même phase : une rétro
  // lancée dans la discussion « Onglet Agents » avait repris le parcours « Durée des requêtes ».
  const parent = followed ?? (id === 'retro' ? run : null)
  // Jamais les arguments de la commande (souvent un long prompt) : Claude envoie un titre réfléchi.
  const title = parent ? clip(`${def.flowLabel} · ${parent.title}`, 70) : undefined
  const paused = parent
    ? undefined
    : b.runs
    // Un parcours mis de côté ne revient qu'à la demande de la personne : un skill ouvre alors le sien.
    .filter(r => r.archivedAt === undefined && r.asideAt === undefined)
    .filter(r => r.status === 'paused' || (r.status === 'active' && r.id !== b.activeId && now - r.updatedAt > ORPHAN_MS))
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .find(r => findPhase(r, id, r.cursor) >= 0)
  if (paused) {
    if (run) shelve(run, now)
    paused.status = 'active'
    paused.owner = b.session
    b.activeId = paused.id
    log(paused, now, '↻', 'Parcours repris', 'accent')
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
  log(created, now, def.glyph, `Parcours lancé par /${id}`, 'accent')
  fx.toasts.push(`${def.glyph} ${def.flowLabel} : parcours lancé`)
  fx.openPane = true
  fx.note = 'phase'
  prune(b)
  return { board: b, fx }
}

// ─── Rapports de Claude (outil flow) ──────────────────────────────────────

const TICKET_STATUSES: readonly TicketStatus[] = ['todo', 'doing', 'done', 'blocked']
const ITEM_STATUSES: readonly ItemStatus[] = ['todo', 'doing', 'done', 'dropped']

const asList = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((one): one is Record<string, unknown> => typeof one === 'object' && one !== null)
    : []

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

type StatusChange = { id: string; status: TicketStatus; why?: string }

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

const parseChanges = (value: unknown): StatusChange[] =>
  asList(value)
    .map(c => ({ id: str(c.id), status: str(c.status) as TicketStatus, why: clip(str(c.why), TEXT_MAX) || undefined }))
    .filter(c => c.id !== '' && TICKET_STATUSES.includes(c.status))

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

/** `#12`, `12` et `012` désignent le même ticket. */
const sameTicket = (a: string, b: string): boolean => {
  if (a === b) return true
  const na = a.replace(/^#/, '').replace(/^0+(?=\d)/, '')
  const nb = b.replace(/^#/, '').replace(/^0+(?=\d)/, '')
  return na !== '' && na === nb
}

/** Date UTC à la minute : `2026-10-06 10:40`. */
const isoMinute = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

/**
 * Où en est le compte rendu du parcours, pour que Claude le lise au lieu de le deviner. Une phase
 * de compte rendu « faite » sur le parcours actif ne vient que de « ✓ Valider le rapport » : Claude
 * ne peut pas la clore, un saut vers la livraison la passe « sautée », et clore le parcours le
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
    `Dashboard: ${run.title}`,
    `${skill.label}${stepLabel ? ` > ${stepLabel}` : ''} (${target.status === 'done' ? 'done' : 'in progress'})`,
    t.total > 0 ? `tickets ${t.done}/${t.total} done` : '',
    reportStateOf(run),
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Le groupe qui s'exécute : celui d'un ticket « en cours », sinon du premier ticket ouvert de la
 * file ; aucun s'il y en a plusieurs ou si le parcours n'a pas de groupes.
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
 * Ouvre un parcours à la demande de Claude (outil `flow`, champ `open`), sans qu'un skill soit
 * lancé, même si un autre est actif ici : celui-ci est mis en pause comme quand un autre skill de
 * départ ouvre un parcours (terminé s'il ne lui reste rien d'obligatoire), avec tout ce qu'il a.
 * Le parcours prend la forme de `entry` (un skill de départ du catalogue), `implement` sinon.
 */
export const openRun = (board: Board, ask: { entry?: string; title?: string }, now: number): { board: Board; fx: Effects; text: string } => {
  const b = clone(board)
  const fx = noFx()
  const wanted = str(ask.entry)
  const found = catalogId(wanted)
  const role = found ? SKILLS[found]!.role : null
  const entry = found && (role === 'flow' || role === 'detour') ? found : 'implement'
  const fallback = wanted !== '' && entry !== found ? ` "${wanted}" is not a starting skill: the workflow follows /implement.` : ''
  const previous = activeRun(b)
  if (previous) shelve(previous, now)
  const title = clip(str(ask.title), 70)
  const run = newRun(entry, now, title || undefined)
  run.owner = b.session
  run.bornIn = b.session
  b.runs.unshift(run)
  b.activeId = run.id
  log(run, now, '✚', `Parcours ouvert par Claude${previous ? ` (« ${previous.title} » ${previous.status === 'done' ? 'terminé' : 'en pause'})` : ''}`, 'accent')
  fx.toasts.push(`✚ Parcours ouvert : ${run.title}`)
  fx.openPane = true
  prune(b)
  const left = previous ? ` "${previous.title}" was ${previous.status === 'done' ? 'closed (nothing required left)' : 'paused'}, untouched; the user resumes it from the History tab.` : ''
  const named = title ? nameDiscussion(b, run, fx) : ' Send {"fix": {"title": "..."}} to name it.'
  return { board: b, fx, text: `New workflow "${run.title}" (${SKILLS[entry]!.flowLabel}) opened in this discussion; the rest of this call went to it.${left}${fallback}${named}` }
}

/**
 * Corrige un parcours (champ `fix`), à la demande de la personne ou après une erreur : le titre,
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
      notes.push(`phase "${wantedPhase}" is not in this workflow (phases: ${run.phases.map(p => p.skill).join(', ')})`)
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
      done.push(`phase ${SKILLS[phase.skill]?.label ?? phase.skill}`)
    }
  }
  const stepId = str(fix.step)
  if (stepId) {
    const at = phase.steps.findIndex(s => s.id === stepId)
    if (at < 0) {
      notes.push(`step "${stepId}" is not a step of ${phase.skill} (${phase.steps.map(s => s.id).join(', ') || 'no steps'})`)
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
    fx.toasts.push(`✎ Parcours corrigé : ${done.join(', ')}`)
  }
  run.status = 'active'
  run.finishedAt = undefined
  return [done.length > 0 ? ` · fixed: ${done.length} change(s)` : '', named, notes.length > 0 ? ` · not fixed: ${notes.join('; ')}` : ''].join('')
}

/**
 * Un appel de l'outil `flow`. `resume` reprend d'abord un parcours du projet dans cette discussion,
 * comme « ↻ Reprendre ici » : une session liée lancée pour un groupe n'a pas de bouton à cliquer.
 */
export const applyReport = (
  board: Board,
  input: Readonly<Record<string, unknown>>,
  now: number,
  opts: { hasPullRequests?: boolean; isVersionSet?: boolean | null; delegateTitle?: string; relay?: unknown; seenReports?: ReadonlySet<string> } = {},
): { board: Board; fx: Effects; text: string } => {
  const out = reportOnce(board, input, now, opts)
  if (board.delegate || str(input.delegate) !== '') return out
  // Un compte rendu par SendMessage peut se perdre (discussion renommée, redémarrée) : le relais le garde.
  const run = activeRun(out.board)
  const reports = run ? relayedReportsText(run, isRelay(opts.relay, run.id) ? opts.relay : null, opts.seenReports) : ''
  return reports ? { ...out, text: `${out.text}${reports}` } : out
}

const reportOnce = (
  board: Board,
  input: Readonly<Record<string, unknown>>,
  now: number,
  opts: { hasPullRequests?: boolean; isVersionSet?: boolean | null; delegateTitle?: string; relay?: unknown; seenReports?: ReadonlySet<string> },
): { board: Board; fx: Effects; text: string } => {
  // Une session liée qui travaille pour un groupe d'un parcours resté ailleurs : rien ne s'écrit ici.
  const delegateId = str(input.delegate)
  if (delegateId !== '') return delegateHere(board, delegateId, now, opts.delegateTitle, str(input.group) || undefined, str(input.main) || undefined)
  if (board.delegate) return { board, fx: noFx(), text: delegatedReportText(board, input) }
  // `open` passe avant tout : le reste de l'appel va au parcours qu'il ouvre.
  const open = input.open !== null && typeof input.open === 'object' ? (input.open as Record<string, unknown>) : null
  if (open || input.open === true) {
    const opened = openRun(board, { entry: str(open?.entry), title: str(open?.title) || str(input.title) }, now)
    const { open: _, resume: __, ...rest } = input
    const out = reportHere(opened.board, rest, now, opts)
    const ignored = str(input.resume) !== '' ? ' "resume" was ignored: "open" starts a new workflow.' : ''
    return { board: out.board, fx: { ...out.fx, openPane: true, toasts: [...opened.fx.toasts, ...out.fx.toasts], ...(opened.fx.discussionTitle !== undefined && out.fx.discussionTitle === undefined ? { discussionTitle: opened.fx.discussionTitle } : {}) }, text: `${opened.text}${ignored} ${out.text}` }
  }
  const resumeId = str(input.resume)
  if (resumeId === '' || resumeId === board.activeId) return reportHere(board, input, now, opts)
  const resumed = resumeRun(board, resumeId, now)
  if (!resumed) return { board, fx: noFx(), text: `No workflow "${resumeId}" in this project: nothing was resumed nor recorded. ${noActiveText(board)}` }
  const out = reportHere(resumed.board, input, now, opts)
  const title = resumed.board.runs.find(r => r.id === resumeId)?.title ?? resumeId
  return { board: out.board, fx: { ...out.fx, toasts: [...resumed.fx.toasts, ...out.fx.toasts] }, text: `Workflow "${title}" resumed in this discussion. ${out.text}` }
}

/** Les comptes rendus finals déposés au relais par les sessions des groupes encore confiés. */
const relayedReports = (run: Run, relay: Relay | null | undefined) =>
  (run.groups ?? [])
    .map(g => {
      const relayed = relayForGroup(relay, g)
      return { g, report: relayed?.report, session: relayed?.reportSession }
    })
    .filter((x): x is { g: TicketGroup; report: NonNullable<RelayEntry['report']>; session: string | undefined } => x.report !== undefined)

/** Un compte rendu coupé dans le relais le dit, avec le fichier qui le garde entier. */
const reportCutText = (run: Run, report: NonNullable<RelayEntry['report']>, session: string | undefined): string =>
  report.length === undefined
    ? ''
    : report.isWhole && session !== undefined
      ? ` [cut at ${REPORT_MAX} of ${report.length} characters: the whole report is in ~/.claude/flow-board/relais/${reportFileName(run.id, session)}; read it with the Read tool before acting on it]`
      : ` [cut at ${REPORT_MAX} of ${report.length} characters, and the whole text could not be written to a file: ask the session for the rest]`

/** La clé d'un compte rendu déjà cité en entier : parcours, groupe, heure du dépôt. */
const reportKey = (run: Run, group: string, at: number): string => `${run.id}:${group}:${at}`

/** Les clés des comptes rendus que `relayedReportsText` vient de citer. */
export const relayedReportKeys = (run: Run, relay: Relay | null | undefined): string[] => relayedReports(run, relay).map(x => reportKey(run, x.g.id, x.report.at))

/**
 * Les comptes rendus finals déposés au relais, pour Claude dans la discussion principale, tant que
 * leur groupe n'est pas rendu : en entier la première fois (`seen` ne les a pas), puis en une ligne,
 * pour ne pas recopier des milliers de caractères dans chaque réponse.
 */
export const relayedReportsText = (run: Run, relay: Relay | null | undefined, seen?: ReadonlySet<string>): string => {
  const all = relayedReports(run, relay)
  const fresh = all.filter(x => !seen?.has(reportKey(run, x.g.id, x.report.at)))
  const known = all.filter(x => seen?.has(reportKey(run, x.g.id, x.report.at)))
  const parts: string[] = []
  if (fresh.length > 0) {
    parts.push(
      ` · Final report(s) left in the relay by linked sessions whose group is not returned yet (their SendMessage may never have reached you): ${fresh.map(x => `Group ${x.g.id} (${isoMinute(x.report.at)} UTC): ${x.report.text}${reportCutText(run, x.report, x.session)}`).join(' ∥ ')} · Check each one's work as its report would have asked, then send "returned" for its group.`,
    )
  }
  if (known.length > 0) {
    parts.push(
      ` · Not returned yet, final report already given above: ${known.map(x => `group ${x.g.id} (${isoMinute(x.report.at)} UTC)`).join(', ')}; its full text stays in the "report" field of this run's relay file (~/.claude/flow-board/relais/), or, for a report cut at 8000 characters, in its own file there (${known.filter(x => x.report.isWhole && x.session).map(x => reportFileName(run.id, x.session!)).join(', ') || 'none written'}).`,
    )
  }
  return parts.join('')
}

/** Au-delà, une délégation gardée ne revient plus au chargement (une session de groupe tient rarement plus d'un jour). */
const DELEGATE_KEEP_MS = 3 * 24 * 60 * 60 * 1000

/** Les tickets faits d'un groupe, parmi ceux du lot (même comparaison d'ids que le reste du modèle). */
export const groupDone = (run: Run, group: TicketGroup): { done: number; total: number } => {
  const tickets = group.tickets.map(id => ticketOf(run, id)).filter((t): t is Ticket => t !== undefined)
  return { done: tickets.filter(t => t.status === 'done').length, total: tickets.length }
}

/**
 * La délégation gardée pour cette session (`$.store`, clé `delegate:<session>`), remise sur un board
 * chargé du stockage : sans elle, un rechargement du mod dans une session liée la perdait, et ses
 * skills pouvaient ouvrir un parcours. Une forme inconnue est ignorée.
 */
export const restoreDelegate = (board: Board, kept: unknown, now?: number): Board => {
  if (board.delegate || kept === null || typeof kept !== 'object') return board
  const d = kept as Record<string, unknown>
  if (typeof d.run !== 'string' || d.run === '' || typeof d.at !== 'number') return board
  // Une délégation ancienne ou sur un parcours fini ne revient pas : sinon la session ne la quitterait jamais.
  if ((now !== undefined && now - d.at > DELEGATE_KEEP_MS) || board.runs.some(r => r.id === d.run && r.status === 'done')) return board
  const text = (key: string) => (typeof d[key] === 'string' && d[key] !== '' ? { [key]: d[key] as string } : {})
  return { ...board, activeId: null, delegate: { run: d.run, at: d.at, ...text('title'), ...text('group'), ...text('main') } }
}

/**
 * La première réponse de l'outil après un rechargement du mod : l'état retrouvé. Le 22/10, la
 * discussion avait tout renvoyé par précaution alors que rien n'était perdu. Vide sans parcours actif.
 */
export const reloadText = (board: Board): string => {
  if (board.delegate) {
    const group = board.delegate.group ? `, group ${board.delegate.group}` : ''
    return `State found after a plugin reload: delegate mode kept for the workflow "${delegatedTitle(board)}"${group}; nothing to send again.`
  }
  const run = activeRun(board)
  if (!run) return ''
  const phase = currentPhase(run)
  return `State found after a plugin reload: ${run.tickets.length} tickets, ${(run.groups ?? []).length} groups, phase ${SKILLS[phase.skill]?.label ?? phase.skill}; nothing to send again.`
}

/** Le titre du parcours pour lequel la discussion travaille : dans ce board, sinon celui relevé à la déclaration. */
export const delegatedTitle = (board: Board): string =>
  board.runs.find(r => r.id === board.delegate?.run)?.title ?? board.delegate?.title ?? board.delegate?.run ?? ''

/**
 * Comment joindre la discussion principale : son nom peut changer (renommage), pas sa référence
 * `[ref]`. SendMessage ne résout une référence que lue à l'instant dans ListAgents : la session
 * relit donc la liste et envoie à la ligne de cette référence, sous son nom du moment.
 */
const reachText = (board: Board): string => {
  const main = board.delegate?.main
  // Une référence suivie depuis (`mainAt`) remplace celle du brief, à chaque réponse.
  const isFollowed = board.delegate?.mainAt !== undefined
  const how = `call ListAgents, find the row whose [ref] is ${main ? 'that one' : 'the one your brief gives'}, and send to that row's "<name> [ref]" exactly as listed (its name can change, its [ref] does not); if no row has it, say so in the first line of your final message.`
  return main
    ? `Reach the main discussion, "${main}" ${isFollowed ? '(its reference of the moment, newer than your brief\'s)' : 'in your brief'}, by its [ref]: ${how}`
    : `Reach the main discussion by the [ref] your brief gives: ${how}`
}

const delegateText = (board: Board): string => {
  const title = delegatedTitle(board)
  return (
    `This discussion works for the workflow "${title}", which stays in the main discussion: nothing is recorded on it from here (skills, steps, phases). ` +
    'Your progress is relayed to the main discussion\'s dashboard on its own: ticket statuses from your Asana updates (« Statut : » line, completion), your commits and your test runs. ' +
    'Only if a ticket\'s status changes without an Asana update, send it here with {"set": [{"id": "<ticket id>", "status": "doing|done|blocked", "why": "<if blocked>"}]}. ' +
    'Each choice you make that the user neither asked for nor approved goes here at once, in {"decided": [{"what": "<the choice>", "why": "<why>"}]}: the main dashboard shows it for review right away; a choice that touches a sensitive area (privacy, data deletion, encryption, concurrency) is never declared: ask the user. ' +
    'End with your report, one line per ticket (done, or not done and why): leave your whole report here, {"report": "<the whole report>"}: it is kept in the run\'s relay file, which the main discussion reads; then send the main discussion one line that points to it with SendMessage (that message wakes it up), and end on that same line. The main discussion checks your work and records the statuses. Nothing else is accepted. ' +
    reachText(board)
  )
}

/** La réponse à un appel de l'outil dans une session liée : seuls `set`, `decided`, `report` et `note` partent au relais (écrit par l'enregistrement). */
const delegatedReportText = (board: Board, input: Readonly<Record<string, unknown>>): string => {
  const changes = parseChanges(input.set)
  const decided = reportedDecisions(input)
  const note = str(input.note)
  const report = reportedReport(input)
  const counts = reportedCounts(input)
  const withdrawn = reportedWithdrawals(input)
  if (changes.length === 0 && decided.length === 0 && withdrawn.length === 0 && note === '' && report === '' && !counts.review && !counts.security) return delegateText(board)
  const parts = [
    changes.length > 0 ? `${changes.length} ticket status(es)` : '',
    decided.length > 0 ? `${decided.length} choice(s) made without the user` : '',
    withdrawn.length > 0 ? `${withdrawn.length} withdrawn choice(s)` : '',
    counts.review ? 'the review findings' : '',
    counts.security ? 'the security review' : '',
    report !== '' ? 'the final report' : '',
    note !== '' ? 'the note' : '',
  ]
    .filter(Boolean)
    .join(' and ')
  return `Relayed to the main discussion's dashboard: ${parts}. Nothing else of this call was recorded. ${reachText(board)}`
}

/**
 * La session liée d'un groupe se déclare (`delegate`) : elle travaille pour un parcours qui reste
 * dans la discussion principale. Ses skills n'ouvrent ni ne reprennent aucun parcours, et ses
 * rapports ne s'écrivent pas : un seul écrivain par parcours.
 *
 * Un parcours absent de ce board ne l'empêche pas : une session lancée dans un worktree a son
 * propre fichier (sa racine est celle du worktree), où le parcours n'est pas. Ne rien enregistrer
 * reste le plus sûr ; `title` est alors lu dans le board du dépôt principal, s'il l'a.
 */
const delegateHere = (board: Board, runId: string, now: number, title?: string, group?: string, main?: string): { board: Board; fx: Effects; text: string } => {
  const target = board.runs.find(r => r.id === runId)
  const b = clone(board)
  const here = activeRun(b)
  if (here && here.id !== runId) shelve(here, now)
  b.activeId = null
  b.delegate = { run: runId, at: now, ...(!target && title ? { title } : {}), ...(group ? { group: clip(group, 20) } : {}), ...(main ? { main: clip(main, 120) } : {}) }
  const elsewhere = target ? '' : ' (The workflow is not on this folder\'s dashboard, e.g. a worktree has its own: that changes nothing for you.)'
  return { board: b, fx: noFx(), text: `${delegateText(b)}${elsewhere}` }
}

/** Un appel de l'outil `flow` sur le parcours actif ici : titre, étape, éléments, tickets, note, fin de phase. */
const reportHere = (
  board: Board,
  input: Readonly<Record<string, unknown>>,
  now: number,
  opts: { hasPullRequests?: boolean; isVersionSet?: boolean | null; relay?: unknown } = {},
): { board: Board; fx: Effects; text: string } => {
  const b = clone(board)
  const fx = noFx()
  const tickets = parseTickets(input.tickets)
  let run = activeRun(b)
  if (!run) {
    // Un parcours en pause ou suivi par une autre discussion : ne rien écrire, et le dire à Claude
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
    const isOnTarget = setStep(target, stepId, now, true)
    if (!isOnTarget && detour) setStep(phase, stepId, now, true)
    if (isOnTarget && target === phase && phase.status === 'done') {
      phase.status = 'active'
      phase.finishedAt = undefined
    }
  }

  // Les éléments qu'une session liée lancée rend « à faire » dans cet appel : ils reviennent au choix.
  let backToChoice = 0
  if (Array.isArray(input.items)) {
    const before = target.items
    target.items = parseItems(input.items)
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
      const back = linked.items.filter(id => phase.items.find(i => i.id === id)?.status === 'todo')
      backToChoice = back.length
      if (back.length > 0) {
        const left = linked.items.filter(id => !back.includes(id))
        phase.linked = left.length > 0 ? { ...linked, items: left } : undefined
        const names = back.map(id => phase.items.find(i => i.id === id)!.label)
        log(run, now, '↩', `À choisir de nouveau, pas fait par la session liée : ${names.join(' ; ')}`, 'info')
      }
    }
  }

  const ticketsBefore = run.tickets
  let removeText = ''
  const removing = (Array.isArray(input.remove) ? input.remove : []).map(x => String(x).trim()).filter(Boolean)
  if (removing.length > 0) {
    const gone = run.tickets.filter(t => removing.some(id => sameTicket(id, t.id)))
    const goneFound = (run.found ?? []).filter(f => removing.some(id => sameTicket(id, f.id)))
    const isGone = (id: string) => gone.some(t => sameTicket(t.id, id)) || goneFound.some(f => sameTicket(f.id, id))
    if (goneFound.length > 0) run.found = run.found!.filter(f => !goneFound.includes(f))
    if (gone.length > 0) {
      run.tickets = run.tickets
        .filter(t => !isGone(t.id))
        .map(t => (t.blockedBy ? { ...t, blockedBy: t.blockedBy.filter(id => !isGone(id)) } : t))
      if (run.groups) run.groups = run.groups.map(g => ({ ...g, tickets: g.tickets.filter(id => !isGone(id)) })).filter(g => g.tickets.length > 0)
      if (run.queue) run.queue = run.queue.filter(id => !isGone(id))
      const names = gone.map(t => t.name)
      log(run, now, '−', `${gone.length} ticket${gone.length > 1 ? 's retirés' : ' retiré'} : ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`, 'warn')
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

  const externals = asList(input.externals)
    .map(one => ({
      id: str(one.id),
      name: clip(str(one.name) || str(one.id), TEXT_MAX),
      status: (str(one.status) === 'done' ? 'done' : 'todo') as ExternalBlocker['status'],
      isDecision: str(one.kind) === 'decision',
      // Sans type précisé (une simple mise à jour de statut), l'étiquette connue est gardée.
      hasKind: str(one.kind) !== '',
    }))
    .filter(x => x.id !== '')
    .map(({ hasKind, ...x }) => ({ ...x, isDecision: hasKind ? x.isDecision : (externalOf(run, x.id)?.isDecision ?? false) }))
  if (externals.length > 0) {
    const known = run.externals ?? []
    const updated = known.map(k => externals.find(x => sameTicket(x.id, k.id)) ?? k)
    const added = externals.filter(x => !known.some(k => sameTicket(k.id, x.id)))
    run.externals = [...updated, ...added].slice(0, LIMITS.tickets)
    for (const x of externals) {
      const was = known.find(k => sameTicket(k.id, x.id))
      if (x.status === 'done' && was?.status !== 'done') log(run, now, '✓', `Dépendance externe levée : ${x.name}`, 'ok')
    }
  }

  let groupText = ''
  const parsed = Array.isArray(input.groups) ? parseGroups(run, input.groups) : null
  // Un seul groupe n'apporte rien (série 1, Q11) : le plan est ignoré avant d'être enregistré, et
  // celui en place, lancé ou non, reste tel quel (série 2, Q5). Les tickets restés hors du groupe
  // ne font pas un deuxième groupe.
  const isPlanKept = parsed !== null && parsed.groups.length >= 2
  if (parsed && !isPlanKept) {
    const rest = (run.groups ?? []).length > 0 ? 'the plan already in place stays' : 'the lot is done in this discussion with /implement'
    // Des ids inconnus ont fait tomber le compte : la cause d'abord, pour que Claude renvoie le plan.
    groupText =
      parsed.unknown.length > 0
        ? ` · groups: plan ignored, ${parsed.groups.length} group(s) left once the unknown ticket ids are removed (${parsed.unknown.join(', ')}); send those tickets first, then the groups again`
        : parsed.groups.length === 1
          ? ` · groups: one group only, so no groups: ${rest}`
          : ` · groups: an empty plan is ignored: ${rest}`
  } else if (parsed) {
    // Ce que les revues ont marqué sur un groupe, et sa session liée, survivent à un plan renvoyé.
    const before = new Map((run.groups ?? []).map(g => [g.id, g]))
    run.groups = parsed.groups.map(g => {
      const was = before.get(g.id)
      return {
        ...g,
        ...(was?.reviewedAt !== undefined ? { reviewedAt: was.reviewedAt } : {}),
        ...(was?.security !== undefined ? { security: was.security } : {}),
        ...(was?.linked !== undefined ? { linked: was.linked } : {}),
        ...(was?.delegated !== undefined ? { delegated: was.delegated } : {}),
      }
    })
    log(run, now, '▦', `Plan : ${parsed.groups.map(g => `${g.id} (${g.tickets.length})`).join(', ')}`, 'accent')
    if (parsed.unknown.length > 0) {
      log(run, now, '!', `Groupes : tickets inconnus ignorés (${parsed.unknown.slice(0, 3).join(', ')})`, 'warn')
      groupText = ` · groups: unknown ticket ids ignored (${parsed.unknown.join(', ')}); send those tickets first`
    }
    const wide = wideFolders(run, run.groups)
    if (wide.length > 0) {
      groupText += ` · groups: ${wide.slice(0, 3).join('; ')}${wide.length > 3 ? '…' : ''}. A folder blocks every group that names a file inside it: list the files the group really touches instead, unless it creates files in that folder`
    }
  }
  if (addedIds.length > 0 && !isPlanKept) placeInRunningGroup(run, addedIds, ticketsBeforeAdd, now)

  const changes = parseChanges(input.set)
  if (changes.length > 0) setTickets(run, changes, now, b.session)
  // Une tâche trouvée en route change aussi de statut par `set`, sans entrer dans le lot.
  if (changes.length > 0 && (run.found ?? []).length > 0) setFound(run, changes, now)
  restartTicketSteps(run, ticketsBefore, now)

  // Les groupes que leurs sessions liées ont rendus (leurs statuts arrivent dans `set`).
  let returnText = ''
  const returned: string[] = []
  if (input.returned !== undefined) {
    const back = returnGroups(run, input.returned, now, opts.relay)
    if (back.unknown.length > 0) returnText = ` · returned: no group in a linked session among ${back.unknown.join(', ')}`
    returned.push(...back.back)
  }

  // Des groupes finis relus ailleurs (leur session liée, après leur retour) : la revue vaut ici.
  let reviewedText = ''
  if (input.reviewed !== undefined) {
    const ids = (Array.isArray(input.reviewed) ? input.reviewed : []).map(x => String(x).trim()).filter(Boolean)
    const marked: string[] = []
    const refused: string[] = []
    for (const id of ids) {
      const g = (run.groups ?? []).find(x => x.id.toLowerCase() === id.toLowerCase())
      if (!g || !isAllDone(run, g.tickets)) refused.push(id)
      else if (g.reviewedAt === undefined) {
        g.reviewedAt = now
        marked.push(g.id)
      }
    }
    if (marked.length > 0) log(run, now, '◆', `Revue du groupe faite ailleurs : ${marked.join(', ')}`, 'accent')
    if (refused.length > 0) reviewedText = ` · reviewed: no finished group among ${refused.join(', ')}`
  }
  // Après `reviewed` : une revue que le compte rendu de la session confirme, envoyée avec `returned`, vaut.
  const unreviewed = returned.filter(id => {
    const g = run.groups!.find(x => x.id === id)
    return g !== undefined && !isGroupReviewed(run, g)
  })
  if (unreviewed.length > 0) {
    const ids = unreviewed.map(id => `"${id}"`).join(', ')
    returnText += ` · returned without a /code-review relayed by its linked session: ${unreviewed.join(', ')}. If its final report says the group review ran there, send {"reviewed": [${ids}]}: the review button then goes away. Otherwise the group still needs its review, in its linked session (its branch is merged here): tell the user, the dashboard's « Revue du groupe · session liée » button asks for it`
  }

  const review = input.review !== null && typeof input.review === 'object' ? (input.review as Record<string, unknown>) : null
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
  if (review) {
    const st = count(review.standards)
    const sp = count(review.spec)
    const fixed = count(review.fixed)
    const stats = phase.stats
    stats.reviews = (stats.reviews ?? 0) + 1
    stats.standards = Math.max(0, stats.standards) + st
    stats.spec = Math.max(0, stats.spec) + sp
    stats.fixed = (stats.fixed ?? 0) + fixed
    log(run, now, '◈', `Revue : ${st} Standards · ${sp} Spec${fixed > 0 ? ` · ${fixed} corrigé${fixed > 1 ? 's' : ''}` : ''}`, st + sp > fixed ? 'warn' : 'ok')
    reachStep(phase, 'review', now)
  }

  const security = input.security !== null && typeof input.security === 'object' ? (input.security as Record<string, unknown>) : null
  if (security) {
    const group = securityGroupOf(run, str(security.group))
    const was = (group ? group.security : run.security) ?? {}
    const next: SecurityCheck = { ...was }
    if (typeof security.advised === 'boolean') next.isAdvised = security.advised
    const why = clip(str(security.why), 160)
    if (why) next.why = why
    const hasCounts = typeof security.findings === 'number' || typeof security.fixed === 'number'
    if (hasCounts) {
      next.findings = count(security.findings)
      next.fixed = count(security.fixed)
      // Un résultat sans lancement vu (une autre discussion, un nom de commande inattendu) le vaut.
      if (next.ranAt === undefined) next.ranAt = now
    }
    if (group) group.security = next
    else run.security = next
    const who = group ? `${group.id} : ` : ''
    if (hasCounts) {
      log(run, now, '⛨', `Sécurité ${who}${next.findings} constat${next.findings! > 1 ? 's' : ''}${next.fixed! > 0 ? ` · ${next.fixed} corrigé${next.fixed! > 1 ? 's' : ''}` : ''}`, next.findings! > next.fixed! ? 'warn' : 'ok')
    } else if (typeof security.advised === 'boolean') {
      log(run, now, '⛨', `Sécurité ${who}${security.advised ? 'revue conseillée' : 'revue jugée inutile'}${why ? ` (${why})` : ''}`, security.advised ? 'accent' : 'info')
    }
  }

  let withdrawnText = ''
  for (const w of reportedWithdrawals(input)) {
    // Un choix relayé par une session liée et pas encore gardé ici se garde, retiré.
    const relayed = relayedDecisions(run, isRelay(opts.relay, run.id) ? opts.relay : null).find(d => sameChoice(d.what, w.what))
    if (relayed) keepDecisions(run, [relayed])
    const kept = (run.decided ?? []).find(d => sameChoice(d.what, w.what) && d.withdrawnAt === undefined)
    if (!kept) {
      withdrawnText += ` · "withdrawn": no choice in force reads "${w.what}" (send it as it was declared)`
      continue
    }
    kept.withdrawnAt = now
    kept.withdrawnWhy = w.replacedBy ? `${w.why ? `${w.why} ; ` : ''}remplacé par « ${w.replacedBy} »` : w.why
    log(run, now, '⚑', `Choix retiré : ${kept.what}${w.why ? ` (${w.why})` : ''}`, 'info')
    if (w.replacedBy && !(run.decided ?? []).some(x => sameChoice(x.what, w.replacedBy!) && x.withdrawnAt === undefined)) {
      run.decided = [...(run.decided ?? []), { at: now, what: w.replacedBy, ...(w.why ? { why: w.why } : {}) }].slice(-LIMITS.decided)
      log(run, now, '⚑', `Décidé sans toi : ${w.replacedBy}`, 'warn')
    }
  }
  for (const d of reportedDecisions(input)) {
    // Le même choix renvoyé deux fois n'est compté qu'une fois.
    if ((run.decided ?? []).some(x => x.what === d.what)) continue
    run.decided = [...(run.decided ?? []), { at: now, what: d.what, ...(d.why ? { why: d.why } : {}) }].slice(-LIMITS.decided)
    log(run, now, '⚑', `Décidé sans toi : ${d.what}`, 'warn')
  }

  const note = str(input.note)
  if (note) log(run, now, '✎', note, 'info')

  // Le compte rendu ne se valide que dans le panneau, par la personne.
  const isReportGate = input.complete === true && !detour && phase.skill === 'compte-rendu'
  // Un groupe fini n'est pas la fin de la phase : elle reste ouverte tant que des tickets du lot le sont.
  const stillOpen = run.tickets.filter(t => t.status !== 'done')
  const isTicketGate = input.complete === true && !detour && phase.skill === 'implement' && stillOpen.length > 0
  // « Version et push » est une seule phase : la fin de /project:version n'en est que la moitié.
  const isPushGate = input.complete === true && !detour && phase.skill === 'project:version' && !isPushed(phase)
  // Des pistes confiées à une session liée et pas encore rendues : la phase attend sa note de fin.
  const inFlight = !detour ? linkedInFlight(phase) : []
  // Rendus au choix dans le même appel : la personne les rechoisit avant toute clôture.
  const isLinkedGate = input.complete === true && (inFlight.length > 0 || backToChoice > 0)
  if (input.complete === true && !isReportGate && !isTicketGate && !isPushGate && !isLinkedGate) {
    if (detour) {
      finishDetour(detour, now)
      log(run, now, '✓', `Détour terminé : ${def.label}`, 'ok')
      fx.toasts.push(`✓ ${def.label} ${agree(def, 'terminé')}`)
    } else if (phase.status === 'active') {
      finishPhase(phase, now)
      log(run, now, '✓', `${def.label} ${agree(def, 'terminé')}`, 'ok')
      const isLast = run.cursor === run.phases.length - 1
      if (isLast) {
        run.status = 'done'
        run.finishedAt = now
        log(run, now, '★', 'Parcours terminé', 'ok')
        fx.toasts.push(`★ Parcours terminé : ${run.title}`)
      } else {
        const next = suggestionsFor(run, opts).primary
        fx.toasts.push(`✓ ${def.label} ${agree(def, 'terminé')}${next ? ` · suite : ${SKILLS[next]!.label}` : ''}`)
      }
    }
  }

  run.updatedAt = now
  const gateText = isReportGate
    ? ' · the report is validated by the user from the dashboard (✓ Valider le rapport), not by you: wait for it'
    : isTicketGate
      ? ` · not finished: ${stillOpen.length} ticket(s) of the lot still open (${stillOpen.slice(0, 4).map(t => t.name).join('; ')}${stillOpen.length > 4 ? '…' : ''}). A finished group is not the end of the phase: tell the user to launch the next group from the dashboard, in its linked session (↗ Session liée), not /flow-board:compte-rendu nor the delivery`
      : isPushGate
        ? ' · version done; the phase stays open until /project:push, which the user runs: tell them to run it, or to close the run from the dashboard (✓ Clore le parcours) if they deliver no further'
        : isLinkedGate
          ? inFlight.length === 0
            ? ` · not finished: ${backToChoice} item(s) just went back to the user's choice (todo). Do not complete: tell the user, who sends them again or decides to give them up`
            : phase.linked?.session === undefined
            ? ` · not finished: ${inFlight.length} item(s) sent to a linked session that was never launched (${inFlight.slice(0, 4).map(i => i.label).join('; ')}${inFlight.length > 4 ? '…' : ''}). Do not mark them done or dropped: launch the session, or tell the user, who resends the request or cancels the send from the dashboard (« Redemander », « Annuler »)`
            : ` · not finished: ${inFlight.length} item(s) still being applied by the linked session (${inFlight.slice(0, 4).map(i => i.label).join('; ')}${inFlight.length > 4 ? '…' : ''}). Wait for its final note, check its work, send the full items list with each status (done if done and checked; todo if not done: it goes back to the user's choice; dropped only when the user gives it up), then complete unless some went back to todo`
          : ''
  // Une session lancée a des éléments : Claude ne les voit pas passer « doing », il le lit ici.
  const withSession = !isLinkedGate && phase.linked?.session !== undefined ? inFlight : []
  const linkedText =
    withSession.length > 0
      ? ` · with the linked session until its final note, keep them "doing" in any items list: ${withSession.slice(0, 4).map(i => i.label).join('; ')}${withSession.length > 4 ? '…' : ''}`
      : ''
  return { board: b, fx, text: `${summaryOf(run)}${namedText}${fixText}${removeText}${groupText}${returnText}${reviewedText}${gateText}${linkedText}${withdrawnText}` }
}

// ─── Éléments confiés à une session liée ──────────────────────────────────

/** Les éléments confiés à une session liée et pas encore rendus (ni faits ni écartés). */
export const linkedInFlight = (phase: FlowPhase): FlowItem[] => {
  const ids = phase.linked?.items ?? []
  return phase.items.filter(i => ids.includes(i.id) && i.status !== 'done' && i.status !== 'dropped')
}

/**
 * Les éléments que le panneau peut encore confier : ni faits, ni écartés, ni déjà confiés. Aucun
 * tant qu'une session lancée a des éléments : une nouvelle demande lancerait une seconde session
 * que le tableau de bord ne saurait pas suivre.
 */
export const pickableItems = (phase: FlowPhase): FlowItem[] => {
  const sent = linkedInFlight(phase).map(i => i.id)
  if (sent.length > 0 && phase.linked?.session !== undefined) return []
  return phase.items.filter(i => i.status !== 'done' && i.status !== 'dropped' && !sent.includes(i.id))
}

/**
 * Les éléments passent « en cours » et l'étape de la phase prévue pour une session liée s'ouvre :
 * au lancement de la session, pas à l'envoi de la demande.
 */
const openLinkedWork = (phase: FlowPhase, ids: readonly string[], now: number) => {
  const stepId = SKILLS[phase.skill]?.items?.linkedStep
  if (!stepId) return
  // Un parcours ouvert avant que l'étape existe la reçoit à la fin de ses étapes.
  if (!phase.steps.some(s => s.id === stepId)) phase.steps = [...phase.steps, { id: stepId, status: 'pending' }]
  setStep(phase, stepId, now, true)
  if (phase.status === 'done') {
    phase.status = 'active'
    phase.finishedAt = undefined
  }
  phase.items = phase.items.map(i => (ids.includes(i.id) && i.status === 'todo' ? { ...i, status: 'doing' as const } : i))
}

/**
 * Le panneau confie des éléments de la phase en cours à une session liée : la demande part dans le
 * prompt, et les éléments attendent que Claude lance la session (`linkSession`) pour passer « en
 * cours ». Ajoutés à un envoi encore sans session, ils le rejoignent : la demande les reprend tous.
 * Le parcours reste dans cette discussion.
 */
export const startLinkedItems = (board: Board, ids: readonly string[], now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.status !== 'active') return null
  const phase0 = currentPhase(run0)
  const stepId = SKILLS[phase0.skill]?.items?.linkedStep
  const allowed = new Set(pickableItems(phase0).map(i => i.id))
  const picked = ids.filter(id => allowed.has(id))
  if (!stepId || activeDetour(phase0) || picked.length === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  const still = linkedInFlight(phase).map(i => i.id)
  const order = phase.items.map(i => i.id).filter(id => still.includes(id) || picked.includes(id))
  phase.linked = { items: order, at: now }
  const label = SKILLS[phase.skill]?.items?.label.toLowerCase() ?? 'éléments'
  log(run, now, '↗', `Session liée demandée pour ${picked.length} ${label} : la demande est dans le prompt`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * Les sessions filles d'un parcours : une par groupe confié ou rendu, une par envoi de pistes
 * encore suivi, et les ids relevés à leur lancement. Une session de diagnostic de bug n'y laisse
 * pas de trace : seul son titre la relie au parcours.
 */
export const linkedSessionsOf = (run: Run): { count: number; ids: string[] } => {
  const links = [...(run.groups ?? []).map(g => g.linked ?? g.delegated), ...run.phases.map(p => p.linked)].filter(
    (l): l is NonNullable<typeof l> => l !== undefined,
  )
  const ids = [...new Set(links.map(l => l.session).filter((id): id is string => id !== undefined && id !== ''))]
  return { count: links.length, ids }
}

/**
 * La session liée est lancée : son id, relevé dans la réponse de start_session ou dans la sortie
 * de `claude --bg`, est gardé, et les éléments passent « en cours ». Une session dont le titre
 * nomme un groupe ou un bug (« … > Groupe A · », « … > Bug · ») n'est pas celle des éléments.
 */
export const linkSession = (board: Board, session: string, now: number, title = ''): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.status !== 'active') return null
  const phase0 = currentPhase(run0)
  if (!phase0.linked || phase0.linked.session !== undefined || linkedInFlight(phase0).length === 0) return null
  // Après le dernier séparateur (« > », ou un ancien) ; une page de code peut déformer « · » en « Â· ».
  const own = ownPart(title)
  if (/^\s*(?:groupe\s+\S+|bug)\s*(?:Â)?·/i.test(own)) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  const { missedAt: _, ...linked } = phase.linked!
  phase.linked = { ...linked, session }
  run.linkedAt ??= now
  const ids = linkedInFlight(phase).map(i => i.id)
  openLinkedWork(phase, ids, now)
  const label = SKILLS[phase.skill]?.items?.label.toLowerCase() ?? 'éléments'
  log(run, now, '↗', `Session liée lancée : ${ids.length} ${label} en cours`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * Un tour de la discussion commencé après l'envoi (`turnAt`) s'est fini sans lancer de session :
 * Claude a pu poser une question d'abord, ou ne pas la lancer du tout. Le panneau le montre au lieu
 * de laisser croire la demande en route ; le lancement, même plus tard, efface la marque.
 */
export const noteUnlaunched = (board: Board, turnAt: number, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.status !== 'active') return null
  const phase0 = currentPhase(run0)
  const linked0 = phase0.linked
  if (!linked0 || linked0.session !== undefined || linked0.missedAt !== undefined || turnAt < linked0.at) return null
  const count = linkedInFlight(phase0).length
  if (count === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  phase.linked = { ...phase.linked!, missedAt: now }
  const label = SKILLS[phase.skill]?.items?.label.toLowerCase() ?? 'éléments'
  log(run, now, '!', `Aucune session liée lancée pour ${count} ${label} : Claude a rendu la main sans la lancer`, 'warn')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** La personne redemande le lancement d'une session pour les éléments restés sans session. */
export const retryLinked = (board: Board, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0 || run0.status !== 'active') return null
  const phase0 = currentPhase(run0)
  if (!phase0.linked || phase0.linked.session !== undefined || linkedInFlight(phase0).length === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  const { missedAt: _, ...linked } = phase.linked!
  phase.linked = { ...linked, at: now }
  log(run, now, '↗', 'Session liée redemandée : la demande est dans le prompt', 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/**
 * Annule un envoi resté sans session : les éléments confiés redeviennent à faire, au choix de la
 * personne. Un envoi d'avant la 0.51.0 avait déjà ouvert l'étape prévue : la phase revient à celle d'avant.
 */
export const cancelLinked = (board: Board, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0) return null
  const phase0 = currentPhase(run0)
  if (!phase0.linked || phase0.linked.session !== undefined) return null
  const b = clone(board)
  const run = activeRun(b)!
  const phase = currentPhase(run)
  const back = linkedInFlight(phase).map(i => i.id)
  phase.items = phase.items.map(i => (back.includes(i.id) ? { ...i, status: 'todo' as const } : i))
  phase.linked = undefined
  const stepId = SKILLS[phase.skill]?.items?.linkedStep
  const at = phase.steps.findIndex(s => s.id === stepId)
  if (at > 0 && phase.steps[at]!.status === 'active') setStep(phase, phase.steps[at - 1]!.id, now)
  log(run, now, '↺', 'Envoi à la session liée annulé', 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

// ─── Groupes confiés à des sessions liées ─────────────────────────────────

/** Un groupe qu'une session liée peut prendre : prêt, pas déjà confié, sans ticket en cours ici. */
export const isDelegable = (v: GroupView): boolean =>
  !v.isFallback && v.state === 'ready' && !v.isDelegated && v.open.length > 0 && !v.open.some(t => t.status === 'doing')

/**
 * Le panneau confie des groupes prêts à des sessions liées, une par groupe : le parcours reste
 * dans cette discussion, qui suit les sessions et rend les statuts de leurs tickets à leur note de
 * fin. Un groupe commencé ici peut partir pour ses tickets restants, pas avec un ticket en cours.
 */
export const startLinkedGroups = (board: Board, ids: readonly string[], now: number): Outcome => {
  const run0 = activeRun(board)
  const plan = run0 ? groupPlan(run0) : null
  if (!run0 || !plan) return null
  const picked = ids.filter(id => plan.groups.some(v => v.group.id === id && isDelegable(v)))
  if (picked.length === 0) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.groups = (run.groups ?? []).map(g => (picked.includes(g.id) ? { ...g, linked: { at: now } } : g))
  log(run, now, '↗', `${picked.length > 1 ? `Groupes ${picked.join(', ')} confiés` : `Groupe ${picked[0]} confié`} à ${picked.length > 1 ? 'des sessions liées' : 'une session liée'}`, 'info')
  const fx = noFx()
  enterImplementation(run, now, fx)
  run.updatedAt = now
  return { board: b, fx }
}

/**
 * Une session liée est lancée : son id va au groupe que son titre nomme (« <parcours> > Groupe A · … »),
 * sinon au seul groupe confié qui n'a pas encore de session. Rien quand on ne sait pas lequel. Seule
 * compte la partie après le dernier séparateur : le titre du parcours, en tête, peut lui-même dire
 * « groupe … ».
 */
export const linkGroupSession = (board: Board, title: string, session: string, now: number): Outcome => {
  const run0 = activeRun(board)
  if (!run0) return null
  const pending = (run0.groups ?? []).filter(g => g.linked !== undefined && g.linked.session === undefined)
  if (pending.length === 0) return null
  // Après le dernier séparateur : le titre du parcours, devant, ne nomme pas le groupe de la session.
  const own = ownPart(title)
  const named = [...own.matchAll(/\bgroupe\s+([^\s·:,()]+)/gi)].map(m => m[1]!.toLowerCase())
  const target =
    named.length > 0
      ? [...named].reverse().map(n => pending.find(g => g.id.toLowerCase() === n)).find(g => g !== undefined)
      : pending.length === 1
        ? pending[0]
        : undefined
  if (!target) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.groups = run.groups!.map(g => (g.id === target.id ? { ...g, linked: { ...g.linked!, session } } : g))
  run.linkedAt ??= now
  log(run, now, '↗', `Session liée lancée pour le groupe ${target.id}`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** Un groupe rendu par sa session liée : la fermeture de sa session et de son worktree est demandée. */
export const askCloseLinkedGroup = (board: Board, id: string, now: number): Outcome => {
  const was = activeRun(board)?.groups?.find(g => g.id === id)
  if (!was?.delegated || was.delegated.closeAskedAt !== undefined) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.groups = run.groups!.map(g => (g.id === id ? { ...g, delegated: { ...g.delegated!, closeAskedAt: now } } : g))
  log(run, now, '✕', `Fermeture de la session et du worktree du groupe ${id} demandée`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

/** Annule l'envoi d'un groupe à une session liée qui n'a pas été lancée : il redevient à lancer. */
export const cancelLinkedGroup = (board: Board, id: string, now: number): Outcome => {
  const run0 = activeRun(board)
  const was = run0?.groups?.find(g => g.id === id)
  if (!run0 || !was?.linked || was.linked.session !== undefined) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.groups = run.groups!.map(g => (g.id === id ? withoutLink(g) : g))
  log(run, now, '↺', `Envoi du groupe ${id} à une session liée annulé`, 'info')
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

const withoutLink = (group: TicketGroup): TicketGroup => {
  const { linked: _, ...rest } = group
  return rest
}

/**
 * Les ids reçus dans `returned` : les groupes que leurs sessions liées ont rendus. Une revue
 * (`/code-review`, `/security-review`) que la session a relayée vaut celle du groupe.
 */
const returnGroups = (run: Run, value: unknown, now: number, stored?: unknown): { back: string[]; unknown: string[] } => {
  const relay = isRelay(stored, run.id) ? stored : null
  const ids = (Array.isArray(value) ? value : []).map(x => String(x).trim()).filter(Boolean)
  const back: string[] = []
  const unknown: string[] = []
  for (const id of ids) {
    const g = (run.groups ?? []).find(x => x.id.toLowerCase() === id.toLowerCase())
    if (!g?.linked) {
      unknown.push(id)
      continue
    }
    back.push(g.id)
  }
  if (back.length > 0) {
    // Avant de défaire le lien : le relais d'un groupe ne se lit que tant qu'il est confié.
    const decided = relayedDecisions({ ...run, groups: run.groups!.filter(g => back.includes(g.id)) }, relay)
    keepDecisions(run, decided)
    for (const d of decided) log(run, now, '⚑', `Décidé sans toi (groupe ${d.relayedFrom}) : ${d.what}`, 'warn')
    const reviewedThere: string[] = []
    const impl = run.phases.find(p => p.skill === 'implement')
    run.groups = run.groups!.map(g => {
      if (!back.includes(g.id)) return g
      const relayed = relayForGroup(relay, g)
      if (g.reviewedAt === undefined && relayed?.reviewedAt !== undefined) reviewedThere.push(g.id)
      const reviewedAt = g.reviewedAt ?? relayed?.reviewedAt
      const ranAt = g.security?.ranAt ?? relayed?.securedAt
      // Les constats relayés comptent dans la phase d'implémentation, une fois (le groupe n'est rendu qu'une fois).
      if (relayed?.reviews && impl) {
        const s = impl.stats
        s.reviews = (s.reviews ?? 0) + relayed.reviews.count
        s.standards = Math.max(0, s.standards) + relayed.reviews.standards
        s.spec = Math.max(0, s.spec) + relayed.reviews.spec
        s.fixed = (s.fixed ?? 0) + relayed.reviews.fixed
        log(run, now, '◈', `Revues du groupe ${g.id} (session liée) : ${relayed.reviews.standards} Standards · ${relayed.reviews.spec} Spec · ${relayed.reviews.fixed} corrigé(s)`, 'info')
      }
      // La revue de sécurité relayée vaut celle que la discussion n'a pas encore reçue (un envoi d'ici l'emporte).
      const sec = relayed?.security
      const security: SecurityCheck | undefined =
        sec && g.security?.findings === undefined
          ? {
              ...(sec.advised !== undefined ? { isAdvised: sec.advised } : {}),
              ...(sec.why !== undefined ? { why: sec.why } : {}),
              ...(sec.findings !== undefined ? { findings: sec.findings, fixed: sec.fixed ?? 0 } : {}),
              ...g.security,
              ...(ranAt !== undefined ? { ranAt } : {}),
            }
          : ranAt !== undefined
            ? { ...g.security, ranAt }
            : g.security
      return withoutLink({
        ...g,
        delegated: g.linked!,
        ...(reviewedAt !== undefined ? { reviewedAt } : {}),
        ...(security !== undefined ? { security } : {}),
      })
    })
    if (reviewedThere.length > 0) log(run, now, '◆', `Revue du groupe faite dans sa session liée : ${reviewedThere.join(', ')}`, 'accent')
    log(run, now, '↩', `${back.length > 1 ? `Groupes ${back.join(', ')} rendus` : `Groupe ${back[0]} rendu`} par ${back.length > 1 ? 'leurs sessions liées' : 'sa session liée'}`, 'ok')
  }
  return { back, unknown }
}

// ─── Relais des sessions liées ────────────────────────────────────────────
//
// Une session liée n'écrit pas sur le parcours (un seul écrivain) : elle relaie son avancement
// dans un fichier à part, une entrée par session, que la discussion principale lit et affiche
// sur le groupe. Les statuts relayés n'entrent jamais dans les tickets du parcours : un ticket
// « fait » dans un worktree pas encore fusionné ne doit pas libérer les tickets qui l'attendent.

export type RelayEvent =
  | { kind: 'start'; group?: string }
  | { kind: 'tickets'; changes: { id: string; status: TicketStatus; why?: string }[] }
  | { kind: 'command'; commit?: string; test?: boolean }
  | { kind: 'note'; text: string }
  | { kind: 'decided'; items: { what: string; why?: string }[] }
  | { kind: 'withdrawn'; items: { what: string; why?: string; replacedBy?: string }[] }
  | { kind: 'report'; text: string; isWhole?: boolean }
  | { kind: 'counts'; review?: { standards: number; spec: number; fixed: number }; security?: { advised?: boolean; why?: string; findings?: number; fixed?: number } }
  | { kind: 'review' }
  | { kind: 'security' }
  | { kind: 'end' }

const isRelay = (value: unknown, runId: string): value is Relay =>
  value !== null && typeof value === 'object' && (value as Relay).run === runId && typeof (value as Relay).sessions === 'object' && (value as Relay).sessions !== null

/** Les changements de statut qu'un `update_tasks` d'Asana porte : cochage, ou ligne « Statut : ». */
export const asanaChanges = (tasks: unknown): StatusChange[] =>
  asList(tasks)
    .map(asanaChange)
    .filter((c): c is StatusChange => c !== null)

/**
 * Les fichiers de tickets locaux (`…/issues/<NN>-<nom>.md`, le tracker en fichiers de
 * `/to-tickets`) que nomme une commande shell : un `sed` sur la ligne de statut, par exemple.
 */
export const ticketFilesIn = (command: string): string[] =>
  [...new Set([...command.matchAll(/[^\s'"`]*issues[\\/]\d+-[^\s'"`\\/]+\.md/g)].map(m => m[0]))]

/**
 * Le statut d'un ticket en fichier local, d'après sa ligne `**Status:**` (ou « Statut : »).
 * Son id est le numéro du fichier (`03-vue.md` → `03`). Null hors d'un dossier `issues`, ou
 * sans ligne de statut lisible. « en attente (porteur) » reste « en cours » : le ticket attend
 * un geste prévu par son groupe, pas un blocage externe.
 */
export const localTicketChange = (path: string, text: string): StatusChange | null => {
  const file = /(?:^|[\\/])issues[\\/](\d+)-[^\\/]+\.md$/.exec(path)
  const line = /^\s*(?:\*\*Status:\*\*|\*\*Statut\s*:\*\*|Statut\s*:)\s*(.+)$/im.exec(text)
  if (!file || !line) return null
  const value = line[1]!.trim().toLowerCase()
  const status: TicketStatus | null = /^(fait|done|terminé)/.test(value)
    ? 'done'
    : /^(en cours|en attente|doing|in progress)/.test(value)
      ? 'doing'
      : /^(bloqué|blocked)/.test(value)
        ? 'blocked'
        : /^(ready-for-agent|à faire|todo|ready)/.test(value)
          ? 'todo'
          : null
  if (!status) return null
  const why = status === 'blocked' ? clip(line[1]!.trim().replace(/^(bloqué|blocked)\s*[:(—-]?\s*/i, '').replace(/\)$/, ''), TEXT_MAX) : ''
  return why ? { id: file[1]!, status, why } : { id: file[1]!, status }
}

/** Les statuts envoyés par `set` dans un appel de l'outil. */
export const reportedChanges = (input: Readonly<Record<string, unknown>>): StatusChange[] => parseChanges(input.set)

/** Un compte envoyé à l'outil : un nombre fini et positif, arrondi ; absent sinon. */
const countOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined)

/**
 * Les constats d'une revue (`review`) et la revue de sécurité (`security`) qu'une session liée
 * envoie : ils partent au relais (r12 de la rétro de l'onglet Agents : le groupe B ne les avait pas
 * envoyés, l'outil les ignorait en session liée), et la discussion principale les reprend au retour du groupe.
 */
export const reportedCounts = (input: Readonly<Record<string, unknown>>): Extract<RelayEvent, { kind: 'counts' }> => {
  const review = input.review !== null && typeof input.review === 'object' ? (input.review as Record<string, unknown>) : null
  const security = input.security !== null && typeof input.security === 'object' ? (input.security as Record<string, unknown>) : null
  const sec = security
    ? {
        ...(typeof security.advised === 'boolean' ? { advised: security.advised } : {}),
        ...(str(security.why) !== '' ? { why: str(security.why) } : {}),
        ...(countOf(security.findings) !== undefined ? { findings: countOf(security.findings) } : {}),
        ...(countOf(security.fixed) !== undefined ? { fixed: countOf(security.fixed) } : {}),
      }
    : null
  return {
    kind: 'counts',
    ...(review ? { review: { standards: countOf(review.standards) ?? 0, spec: countOf(review.spec) ?? 0, fixed: countOf(review.fixed) ?? 0 } } : {}),
    ...(sec && Object.keys(sec).length > 0 ? { security: sec } : {}),
  }
}

/** Deux choix sont le même quand leurs textes le sont, sans la casse ni les espaces. */
const sameChoice = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Les choix déclarés qui ne tiennent plus, envoyés par `withdrawn` (p13 de la rétro « Durée des
 * requêtes » : un choix devenu faux restait dans le fichier des choix), avec ce qui les remplace.
 */
export const reportedWithdrawals = (input: Readonly<Record<string, unknown>>): { what: string; why?: string; replacedBy?: string }[] =>
  asList(input.withdrawn)
    .map(w => ({ what: clip(str(w.what), TEXT_MAX), why: clip(str(w.why), TEXT_MAX) || undefined, replacedBy: clip(str(w.replacedBy), TEXT_MAX) || undefined }))
    .filter(w => w.what !== '')
    .map(w => ({ what: w.what, ...(w.why ? { why: w.why } : {}), ...(w.replacedBy ? { replacedBy: w.replacedBy } : {}) }))

/** Les choix en vigueur : ni retirés ici, ni retirés par une session liée dans le relais. */
export const inForce = (list: readonly SoloDecision[], relay?: Relay | null): SoloDecision[] => {
  const gone = Object.values(relay?.sessions ?? {}).flatMap(e => e.withdrawn ?? [])
  return list.filter(d => d.withdrawnAt === undefined && !gone.some(w => sameChoice(w.what, d.what)))
}

/** Les choix faits sans la personne envoyés par `decided` dans un appel de l'outil. */
export const reportedDecisions = (input: Readonly<Record<string, unknown>>): { what: string; why?: string }[] =>
  asList(input.decided)
    .map(d => ({ what: clip(str(d.what) || str(d.text), TEXT_MAX), why: clip(str(d.why), TEXT_MAX) || undefined }))
    .filter(d => d.what !== '')
    .map(d => (d.why ? d : { what: d.what }))

/**
 * Ajoute un signal à l'entrée de la session `session` dans le relais du parcours `runId`.
 * `stored` : le relais lu (ou rien). Null quand le signal ne change rien.
 */
export const applyRelay = (stored: unknown, runId: string, session: string, event: RelayEvent, now: number): Relay | null => {
  const relay: Relay = isRelay(stored, runId) ? JSON.parse(JSON.stringify(stored)) : { v: 1, run: runId, sessions: {} }
  const was = relay.sessions[session]
  const entry: RelayEntry = was ?? { tickets: {}, commits: 0, startedAt: now, at: now }
  if (event.kind === 'start') {
    const group = event.group ? clip(event.group, 20) : undefined
    if (was && was.endedAt === undefined && (group === undefined || was.group === group)) return null
    if (group !== undefined) entry.group = group
    delete entry.endedAt
  } else if (event.kind === 'tickets') {
    const moved = event.changes.filter(c => {
      const now0 = entry.tickets[c.id]
      return !now0 || now0.status !== c.status || now0.why !== c.why
    })
    if (moved.length === 0) return null
    for (const c of moved) entry.tickets[c.id] = { status: c.status, ...(c.why ? { why: c.why } : {}), at: now }
    // Un ticket qui démarre : une revue relayée avant lui était la passe « bogues » d'un ticket (ou
    // une revue lancée trop tôt), pas la revue du groupe, qui vient une fois tous ses tickets faits.
    if (moved.some(c => c.status === 'doing')) delete entry.reviewedAt
    const last = moved[moved.length - 1]!
    entry.last = { kind: 'ticket', text: TICKET_WORDS[last.status], ticket: last.id, at: now }
  } else if (event.kind === 'command') {
    if (event.commit === undefined && event.test === undefined) return null
    if (event.test !== undefined) {
      entry.test = { ok: event.test, at: now }
      entry.last = { kind: 'test', text: event.test ? 'tests verts' : 'tests en échec', at: now }
    }
    if (event.commit !== undefined) {
      entry.commits += 1
      if (event.commit !== '') entry.lastCommit = clip(event.commit, 100)
      entry.last = { kind: 'commit', text: event.commit !== '' ? clip(event.commit, 100) : 'commit', at: now }
    }
  } else if (event.kind === 'note') {
    if (event.text === '') return null
    entry.last = { kind: 'note', text: clip(event.text, 160), at: now }
  } else if (event.kind === 'decided') {
    // Le même choix renvoyé deux fois n'est gardé qu'une fois.
    const fresh = event.items.filter(d => !(entry.decided ?? []).some(x => x.what === d.what))
    if (fresh.length === 0) return null
    entry.decided = [...(entry.decided ?? []), ...fresh.map(d => ({ ...d, at: now }))].slice(-LIMITS.decided)
    entry.last = { kind: 'decided', text: `décidé sans toi : ${clip(fresh[fresh.length - 1]!.what, 140)}`, at: now }
  } else if (event.kind === 'withdrawn') {
    const fresh = event.items.filter(w => !(entry.withdrawn ?? []).some(x => sameChoice(x.what, w.what)))
    if (fresh.length === 0) return null
    entry.withdrawn = [...(entry.withdrawn ?? []), ...fresh.map(w => ({ what: w.what, ...(w.why ? { why: w.why } : {}), at: now }))].slice(-LIMITS.decided)
    // Un choix qui en remplace un autre arrive comme un choix déclaré.
    const replacing = fresh.filter(w => w.replacedBy).map(w => ({ what: w.replacedBy!, ...(w.why ? { why: w.why } : {}), at: now }))
    entry.decided = [...(entry.decided ?? []).filter(d => !fresh.some(w => sameChoice(w.what, d.what))), ...replacing].slice(-LIMITS.decided)
    entry.last = { kind: 'decided', text: `choix retiré : ${clip(fresh[fresh.length - 1]!.what, 140)}`, at: now }
  } else if (event.kind === 'report') {
    const length = event.text.length > REPORT_MAX ? event.text.length : undefined
    if (event.text === '' || (entry.report?.text === clip(event.text, REPORT_MAX) && entry.report.length === length)) return null
    entry.report = { text: clip(event.text, REPORT_MAX), at: now, ...(length !== undefined ? { length } : {}), ...(event.isWhole ? { isWhole: true } : {}) }
    entry.last = { kind: 'report', text: 'compte rendu final déposé', at: now }
  } else if (event.kind === 'counts') {
    if (!event.review && !event.security) return null
    if (event.review) {
      const was = entry.reviews ?? { count: 0, standards: 0, spec: 0, fixed: 0 }
      entry.reviews = { count: was.count + 1, standards: was.standards + event.review.standards, spec: was.spec + event.review.spec, fixed: was.fixed + event.review.fixed }
      entry.last = { kind: 'review', text: `revue : ${event.review.standards + event.review.spec} constat(s), ${event.review.fixed} corrigé(s)`, at: now }
    }
    if (event.security) {
      const why = event.security.why !== undefined ? clip(event.security.why, 160) : undefined
      entry.security = { ...entry.security, ...event.security, ...(why !== undefined ? { why } : {}), at: now }
      if (event.security.findings !== undefined || event.security.fixed !== undefined) entry.securedAt = now
      entry.last = { kind: 'review', text: 'revue de sécurité', at: now }
    }
  } else if (event.kind === 'review') {
    // Pendant un ticket en cours, `/code-review` est la passe « bogues » de ce ticket (zone
    // sensible), pas la revue du groupe : le groupe n'est pas relu pour autant.
    if (Object.values(entry.tickets).some(t => t.status === 'doing')) {
      entry.last = { kind: 'review', text: 'passe « bogues » du ticket', at: now }
    } else {
      entry.reviewedAt = now
      entry.last = { kind: 'review', text: 'revue /code-review', at: now }
    }
  } else if (event.kind === 'security') {
    entry.securedAt = now
    entry.last = { kind: 'review', text: 'revue /security-review', at: now }
  } else {
    if (!was || was.endedAt !== undefined) return null
    entry.endedAt = now
  }
  entry.at = now
  relay.sessions[session] = entry
  // Une vingtaine de sessions au plus par parcours : les plus anciennes tombent.
  const keep = Object.entries(relay.sessions).sort((x, y) => y[1].at - x[1].at).slice(0, 20)
  relay.sessions = Object.fromEntries(keep)
  return relay
}

const TICKET_WORDS: Record<TicketStatus, string> = { todo: 'à faire', doing: 'en cours', done: 'fait', blocked: 'bloqué' }

/** Un id en nom de fichier du relais : minuscules, chaque suite de signes hors `[a-z0-9]` en tiret. */
export const relayFileSlug = (id: string): string => id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * Le fichier du compte rendu entier d'une session liée, à côté du relais : écrit par elle seule
 * (r11 : un compte rendu coupé à 8 000 caractères avait perdu la fin de celui du groupe B).
 */
export const reportFileName = (runId: string, session: string): string => `${relayFileSlug(runId)}.${relayFileSlug(session)}.report.md`

/**
 * Le fichier de la référence du moment de la discussion principale, à côté du relais, écrit par
 * elle seule à la reprise (r10 : sa référence change quand elle redémarre).
 */
export const mainRefFileName = (runId: string): string => `${relayFileSlug(runId)}.main.json`

/** Ce que dit ce fichier : la référence « [ref] » de la discussion principale, et quand elle l'a écrite. */
export type MainRef = { v: 1; run: string; main: string; at: number }

/** Le fichier de la référence, lu sur le disque : borné avant usage, null quand il ne se lit pas. */
export const parseMainRef = (value: unknown, runId: string): MainRef | null => {
  if (value === null || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  // Une date au-delà de l'an 2286 (1e13 ms) ne se lit pas : elle figerait la référence pour toujours.
  if (v.run !== runId || typeof v.main !== 'string' || typeof v.at !== 'number' || !Number.isFinite(v.at) || v.at < 0 || v.at > 1e13) return null
  const main = clip(v.main.trim(), 120)
  return main === '' ? null : { v: 1, run: runId, main, at: v.at }
}

/**
 * Dans une session liée : la référence de la discussion principale lue à côté du relais, plus
 * récente que celle connue, remplace celle du brief. Null quand rien ne change.
 */
export const updateDelegateMain = (board: Board, ref: MainRef | null): Board | null => {
  const d = board.delegate
  if (!d || !ref || ref.run !== d.run || ref.main === d.main || ref.at <= (d.mainAt ?? d.at)) return null
  return { ...board, delegate: { ...d, main: ref.main, mainAt: ref.at } }
}

/** Longueur gardée du compte rendu final d'une session liée. */
const REPORT_MAX = 8000

/** Le compte rendu final envoyé par `report` dans un appel de l'outil (session liée). */
export const reportedReport = (input: Readonly<Record<string, unknown>>): string => str(input.report)

/** Ce que le panneau montre d'un groupe confié : l'avancement relayé par sa session. */
export type GroupRelay = {
  tickets: Record<string, { status: TicketStatus; why?: string }>
  done: number
  doing: number
  total: number
  commits: number
  lastCommit?: string
  test?: { ok: boolean; at: number }
  reviewedAt?: number
  securedAt?: number
  decided: NonNullable<RelayEntry['decided']>
  report?: RelayEntry['report']
  /** La session qui a déposé `report` : le nom de son fichier entier en dépend. */
  reportSession?: string
  reviews?: RelayEntry['reviews']
  security?: RelayEntry['security']
  last?: RelayEntry['last']
  at: number
  endedAt?: number
}

/**
 * L'avancement relayé pour un groupe confié : l'entrée de session la plus récente qui le nomme,
 * ou qui a touché un de ses tickets. Une entrée d'avant l'envoi du groupe (une session
 * précédente, quand le groupe a été confié de nouveau) ne compte pas.
 */
export const relayForGroup = (relay: Relay | null | undefined, group: TicketGroup): GroupRelay | null => {
  if (!relay || !group.linked) return null
  const since = group.linked.at
  const ids = group.tickets
  // « E », « Groupe E », « E · Enquêtes » nomment le même groupe ; un nom qui ne dit rien laisse les tickets décider.
  const named = (e: RelayEntry) => (e.group === undefined ? '' : (/^(?:groupe\s+)?([^\s·:,()]+)/i.exec(e.group.trim())?.[1] ?? '').toLowerCase())
  const touches = (e: RelayEntry) => Object.keys(e.tickets).some(id => ids.some(t => sameTicket(t, id)))
  const mineWithIds = Object.entries(relay.sessions)
    .filter(([, e]) => e.startedAt >= since)
    .filter(([, e]) => named(e) === group.id.toLowerCase() || touches(e))
    .sort((x, y) => y[1].at - x[1].at)
  const mine = mineWithIds.map(([, e]) => e)
  const entry = mine[0]
  if (!entry) return null
  // Une session redémarrée sous un autre id ne masque pas le compte rendu déposé par la précédente.
  const reported = mineWithIds.filter(([, e]) => e.report !== undefined).sort((x, y) => y[1].report!.at - x[1].report!.at)[0]
  const report = reported?.[1].report
  // Les constats envoyés par toutes les sessions du groupe (une session redémarrée en garde une part).
  // Un fichier d'une autre session : chaque nombre est borné avant d'être additionné.
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000 ? Math.round(v) : 0)
  const reviews = mine.reduce<RelayEntry['reviews']>((sum, e) => (e.reviews && typeof e.reviews === 'object' ? { count: (sum?.count ?? 0) + n(e.reviews.count), standards: (sum?.standards ?? 0) + n(e.reviews.standards), spec: (sum?.spec ?? 0) + n(e.reviews.spec), fixed: (sum?.fixed ?? 0) + n(e.reviews.fixed) } : sum), undefined)
  const latest = mine.map(e => e.security).filter(s => s !== undefined && typeof s === 'object' && typeof s.at === 'number').sort((x, y) => y!.at - x!.at)[0]
  const security = latest
    ? {
        at: latest.at,
        ...(typeof latest.advised === 'boolean' ? { advised: latest.advised } : {}),
        ...(typeof latest.why === 'string' ? { why: clip(latest.why, 160) } : {}),
        ...(latest.findings !== undefined ? { findings: n(latest.findings) } : {}),
        ...(latest.fixed !== undefined ? { fixed: n(latest.fixed) } : {}),
      }
    : undefined
  const tickets: GroupRelay['tickets'] = {}
  for (const id of ids) {
    const key = Object.keys(entry.tickets).find(k => sameTicket(k, id))
    if (key !== undefined) {
      const t = entry.tickets[key]!
      tickets[id] = { status: t.status, ...(t.why ? { why: t.why } : {}) }
    }
  }
  const statuses = Object.values(tickets).map(t => t.status)
  return {
    tickets,
    done: statuses.filter(s => s === 'done').length,
    doing: statuses.filter(s => s === 'doing').length,
    total: ids.length,
    commits: entry.commits,
    ...(entry.lastCommit !== undefined ? { lastCommit: entry.lastCommit } : {}),
    ...(entry.test ? { test: entry.test } : {}),
    ...(entry.reviewedAt !== undefined ? { reviewedAt: entry.reviewedAt } : {}),
    ...(entry.securedAt !== undefined ? { securedAt: entry.securedAt } : {}),
    ...(entry.last ? { last: entry.last } : {}),
    decided: entry.decided ?? [],
    ...(report ? { report, reportSession: reported![0] } : {}),
    ...(reviews ? { reviews } : {}),
    ...(security ? { security } : {}),
    at: entry.at,
    ...(entry.endedAt !== undefined ? { endedAt: entry.endedAt } : {}),
  }
}

/**
 * Le parcours tel que le panneau le montre : un ticket d'un groupe confié prend le statut que sa
 * session relaie (fait, en cours), avec `relayedFrom`. Jamais enregistré : le parcours n'avance
 * qu'au retour du groupe. Fait ainsi, un ticket ne lève ses dépendances que dans son groupe.
 */
export const withRelay = (run: Run, relay: Relay | null | undefined): Run => {
  if (!relay) return run
  const moved = new Map<string, { status: TicketStatus; group: string }>()
  for (const g of run.groups ?? []) {
    const relayed = relayForGroup(relay, g)
    if (!relayed) continue
    for (const [id, t] of Object.entries(relayed.tickets)) {
      if (t.status === 'done' || t.status === 'doing') moved.set(id, { status: t.status, group: g.id })
    }
  }
  const decided = relayedDecisions(run, relay)
  if (moved.size === 0 && decided.length === 0) return run
  return {
    ...run,
    tickets:
      moved.size === 0
        ? run.tickets
        : run.tickets.map(t => {
            const m = moved.get(t.id)
            return m && t.status !== 'done' ? { ...t, status: m.status, relayedFrom: m.group } : t
          }),
    ...(decided.length > 0 ? { decided: [...(run.decided ?? []), ...decided].slice(-LIMITS.decided) } : {}),
  }
}

/**
 * Les choix que les sessions liées des groupes confiés ont relayés et que le parcours n'a pas
 * encore (même `what`), à relire tout de suite : marqués `relayedFrom`, jamais enregistrés tels quels.
 */
const relayedDecisions = (run: Run, relay: Relay | null | undefined): SoloDecision[] => {
  const known = new Set((run.decided ?? []).map(d => d.what))
  const gone = Object.values(relay?.sessions ?? {}).flatMap(e => e.withdrawn ?? [])
  const out: SoloDecision[] = []
  for (const g of run.groups ?? []) {
    for (const d of relayForGroup(relay, g)?.decided ?? []) {
      if (known.has(d.what) || gone.some(w => sameChoice(w.what, d.what))) continue
      known.add(d.what)
      out.push({ at: d.at, what: d.what, ...(d.why ? { why: d.why } : {}), relayedFrom: g.id })
    }
  }
  return out.sort((x, y) => x.at - y.at)
}

/**
 * Le fichier des choix déjà déclarés d'un parcours (Markdown) : ceux du parcours et ceux que les
 * sessions des groupes confiés ont relayés. Les briefs et les consignes de revue le citent par son
 * chemin au lieu de recopier la liste, qui se périmait d'une consigne à l'autre.
 */
export const decidedFileText = (run: Run, relay: Relay | null | undefined): string => {
  const all = inForce(withRelay(run, relay).decided ?? [], relay)
  const line = (d: SoloDecision) => `- ${d.what}${d.why ? ` — ${d.why}` : ''} (${d.relayedFrom ? `groupe ${d.relayedFrom}, ` : ''}${isoMinute(d.at)} UTC)`
  return [
    `# Choix déjà déclarés · ${run.title}`,
    '',
    "Tenu par flow-board d'après le champ « decided » de l'outil flow (discussion principale et sessions liées), réécrit à chaque changement : ne pas le modifier à la main. Ces choix ont été faits sans le porteur et attendent sa relecture : une revue ne les défait pas par préférence (une passe --fix non plus), mais signale tout cas où l'un d'eux produit un défaut, avec son scénario.",
    '',
    ...(all.length > 0 ? all.map(line) : ["Aucun choix déclaré pour l'instant."]),
    '',
  ].join('\n')
}

/** Enregistre dans le parcours des choix relayés, sans leur marque d'affichage. */
const keepDecisions = (run: Run, list: readonly SoloDecision[], seenAt?: number) => {
  if (list.length === 0) return
  const stored = list.map(({ relayedFrom: _from, ...d }) => (seenAt !== undefined ? { ...d, seenAt } : d))
  run.decided = [...(run.decided ?? []), ...stored].slice(-LIMITS.decided)
}

/** Les parcours du projet qu'une discussion peut reprendre : en pause, ou suivis ailleurs. */
export const resumable = (board: Board): Run[] =>
  board.runs.filter(r => r.id !== board.activeId && r.archivedAt === undefined && (r.status === 'active' || r.status === 'paused'))

const ticketCount = (run: Run): string => {
  const t = countTickets(run.tickets)
  return t.total > 0 ? `${t.done}/${t.total} tickets` : 'no tickets'
}

/** Pour Claude, quand cette discussion n'a pas de parcours actif. */
export const noActiveText = (board: Board): string => {
  const waiting = resumable(board)
  if (waiting.length === 0) return 'No workflow is running on the dashboard: it starts when a mattpocock skill loads.'
  const state = (r: Run) => (r.status === 'active' ? 'in progress in another discussion' : r.asideAt !== undefined ? 'set aside by the user' : 'paused')
  const list = waiting
    .map(r => `"${r.title}" (${state(r)}, ${ticketCount(r)}, phase ${SKILLS[currentPhase(r).skill]?.label ?? currentPhase(r).skill}, id ${r.id})`)
    .join('; ')
  return `No workflow is active in this discussion, so nothing was recorded. This project already has: ${list}. Do not start another lot nor look for tickets elsewhere: ask the user which one to resume (/flow-board:flow, History tab, "↻ Reprendre ici"), then send your report again. Only if the user asks for a new workflow, send {"open": {"title": "..."}} with the report.`
}

/** Pour la personne (réponse de /flow), quand cette discussion n'a pas de parcours actif. */
export const noActiveFrench = (board: Board): string => {
  const waiting = resumable(board)
  if (waiting.length === 0) return 'Tableau de bord ouvert : aucun parcours en cours.'
  const list = waiting
    .map(r => {
      const t = countTickets(r.tickets)
      return `« ${r.title} » (${r.status === 'active' ? 'suivi dans une autre discussion' : r.asideAt !== undefined ? 'mis de côté' : 'en pause'}${t.total > 0 ? `, ${t.done}/${t.total} tickets` : ''})`
    })
    .join(', ')
  return `Aucun parcours actif dans cette discussion. À reprendre (onglet Historique, « ↻ Reprendre ici ») : ${list}.`
}

/**
 * Une date d'activité dans le futur (fichier retouché à la main, horloge d'une autre machine)
 * gagnerait toutes les fusions et annulerait chaque reprise : elle est ramenée à la dernière
 * activité réelle du parcours.
 */
export const clampFuture = (board: Board, now: number): Board => {
  const isAhead = (r: Run) => r.updatedAt > now + 60_000
  if (!board.runs.some(isAhead)) return board
  const b = clone(board)
  for (const r of b.runs) {
    if (isAhead(r)) r.updatedAt = Math.min(now, maxOf(r.log.map(e => e.at).filter(at => at <= now), r.startedAt))
  }
  return b
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
 * le titre que la commande affiche, pour relier chaque session liée à son groupe.
 */
export const backgroundLaunches = (command: string, out: string): { id: string; title: string }[] => {
  const heads = withVariables(splitCommand(command)).map(seg => head(seg.text))
  if (!heads.some(h => BG_START.test(h))) return []
  return [...out.matchAll(BG_OUT)].map(m => ({ id: m[1]!, title: m[2]! }))
}

/**
 * Ce qu'une commande dit pour le relais d'une session liée : un commit (son message, vide sans
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

/**
 * Première ligne « Statut : » d'une tâche Asana -> statut du ticket ; un blocage garde le texte
 * de la ligne comme raison (« à confirmer (porteur) »).
 */
const statusLine = (notes: unknown): { status: TicketStatus; why?: string } | undefined => {
  if (typeof notes !== 'string') return undefined
  const first = notes.trimStart().split('\n')[0]!.trim()
  if (!first.toLowerCase().startsWith('statut :')) return undefined
  const raw = first.slice('statut :'.length).trim()
  const value = raw.toLowerCase()
  if (value.startsWith('en cours')) return { status: 'doing' }
  if (value.startsWith('à faire')) return { status: 'todo' }
  if (value.startsWith('en attente') || value.startsWith('à trancher') || value.startsWith('à confirmer')) {
    return { status: 'blocked', why: clip(raw, TEXT_MAX) }
  }
  return undefined
}

/** Statut d'une tâche Asana mise à jour : cochée ou décochée, sinon sa ligne « Statut : ». */
const asanaChange = (t: Record<string, unknown>): StatusChange | null => {
  const id = typeof t.task === 'string' ? t.task : ''
  if (id === '') return null
  if (t.completed === true) return { id, status: 'done' }
  if (t.completed === false) return { id, status: 'todo' }
  const line = statusLine(t.notes)
  return line ? { id, ...line } : null
}

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
 * pas des trouvailles.
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
    (run.externals ?? []).some(x => sameTicket(x.id, id)) ||
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
 * Des tâches créées dans Asana pendant le parcours (hors des skills qui publient le lot) : elles
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
  if (!run0 || (run0.tickets.length === 0 && (run0.externals ?? []).length === 0 && (run0.found ?? []).length === 0)) return null
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
    const at = (run.externals ?? []).findIndex(x => sameTicket(x.id, id))
    if (at < 0) continue
    const x = run.externals![at]!
    const status: 'todo' | 'done' = t.completed === true ? 'done' : t.completed === false ? 'todo' : x.status
    const isDecision = typeof t.notes === 'string' ? isDecisionNote(t.notes) : x.isDecision
    if (status === x.status && isDecision === x.isDecision) continue
    if (status === 'done' && x.status !== 'done') log(run, now, '✓', `Dépendance externe levée : ${x.name}`, 'ok')
    run.externals![at] = { ...x, status, isDecision }
    moved += 1
  }
  if (moved === 0) return null
  run.updatedAt = now
  return { board: b, fx: noFx() }
}

// ─── Sous-agents ──────────────────────────────────────────────────────────

export type AgentStart = {
  key: string
  name: string
  model?: string
  /** `subagent_type` de l'appel. */
  type?: string
  isBackground: boolean
}

/**
 * Un appel Agent part pendant le parcours actif : ses étapes avancent (relecteurs, alternatives,
 * exploration, sources). Le sous-agent lui-même vit dans le registre de la session, plus dans le parcours (S1).
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

/** Un sous-agent tel que `$.agent.list()` le donne : son id, sa description, où en est sa boucle. */
export type LiveAgent = { id: string; description: string; status: string }

/**
 * Le board dont l'ancien champ des sous-agents est vidé (S1, S21 : une liste vide, qu'une version
 * d'avant lit sans casser), seulement pour les parcours dont toutes les lignes sont déjà recopiées
 * (`isCopied`) ; null quand aucun ne change.
 */
export const stripRunAgents = (board: Board, isCopied: (run: Run) => boolean = () => true): Board | null => {
  const isDue = (r: Run) => (r.agents?.length ?? 0) > 0 && isCopied(r)
  if (!board.runs.some(isDue)) return null
  return { ...board, runs: board.runs.map(r => (isDue(r) ? { ...r, agents: [] } : r)) }
}

/** Un sous-agent du parcours actif a fini : le parcours a vécu (son seuil d'abandon repart). */
export const applyAgentActivity = (board: Board, now: number): Outcome => {
  if (!activeRun(board)) return null
  const b = clone(board)
  activeRun(b)!.updatedAt = now
  return { board: b, fx: noFx() }
}

// ─── Chargement ───────────────────────────────────────────────────────────

/**
 * Sans activité depuis plus longtemps, un parcours actif est tenu pour abandonné (discussion
 * fermée sans fin propre) : au chargement il passe en pause, et un skill peut le reprendre.
 */
const ORPHAN_MS = 30 * 60 * 1000

/**
 * Le board tel qu'une discussion le charge du stockage partagé : aucun parcours actif ici ;
 * les actifs abandonnés passent en pause ; ceux qu'une autre discussion fait vivre restent
 * actifs (« dans une autre discussion »).
 */
export const detachOnLoad = (board: Board, now: number, session: string): Board => {
  const b = clone(clampFuture(board, now))
  b.activeId = null
  b.session = session
  // Propre à la discussion qui l'a déclaré : une copie lue du stockage ne le garde pas.
  delete b.delegate
  b.deleted = b.deleted ?? []
  b.runs = b.runs.map(upgradeRun)
  for (const run of b.runs) {
    if (run.status === 'active' && (!run.owner || run.owner === session || now - run.updatedAt > ORPHAN_MS)) shelve(run, now)
  }
  return b
}

/**
 * Fusionne la copie de cette discussion avec le stockage partagé. Pour chaque parcours, la
 * version la plus récente l'emporte, sauf le parcours actif ici, qui garde la version locale
 * tant qu'une autre discussion ne l'a pas repris. Les suppressions (traces) gagnent toujours.
 * L'écriture qui suit n'est pas atomique entre discussions : la fusion suivante rattrape.
 */
export const mergeBoards = (local: Board, stored: Board): Board => {
  const deleted = [...(local.deleted ?? []), ...(stored.deleted ?? [])]
    .sort((x, y) => y.at - x.at)
    .filter((t, i, all) => all.findIndex(o => o.id === t.id) === i)
    .slice(0, LIMITS.tombstones)
  // Une trace de suppression efface les copies plus anciennes qu'elle ; un parcours touché après
  // (restauré des sauvegardes, par exemple) survit, et sa trace tombe.
  const goneAt = new Map(deleted.map(t => [t.id, t.at]))
  const isGone = (run: Run) => (goneAt.get(run.id) ?? -Infinity) >= run.updatedAt
  const byId = new Map<string, Run>()
  for (const run of stored.runs) if (!isGone(run)) byId.set(run.id, run)
  let activeId = local.activeId
  for (const run of local.runs) {
    if (isGone(run)) continue
    const other = byId.get(run.id)
    if (run.id === local.activeId) {
      const isTakenOver =
        other !== undefined && other.status === 'active' && other.owner !== undefined && other.owner !== local.session && other.updatedAt > run.updatedAt
      if (isTakenOver) activeId = null
      else byId.set(run.id, run)
      continue
    }
    if (!other || run.updatedAt >= other.updatedAt) byId.set(run.id, run)
  }
  if (activeId !== null && !byId.has(activeId)) activeId = null
  const merged: Board = {
    ...local,
    runs: [...byId.values()].map(upgradeRun).sort((x, y) => y.startedAt - x.startedAt),
    activeId,
    deleted: deleted.filter(t => !byId.has(t.id)),
  }
  prune(merged)
  return merged
}

/** Fin de discussion : son parcours actif passe en pause, pour la prochaine discussion du projet. */
export const parkActive = (board: Board, now: number): Outcome => {
  if (!activeRun(board)) return null
  const b = clone(board)
  shelve(activeRun(b)!, now)
  b.activeId = null
  return { board: b, fx: noFx() }
}

// ─── Gestes de la personne (panneau, /flow) ───────────────────────────────

/**
 * Met de côté le parcours actif ici (`/flow pause`, « ‖ Mettre de côté ») : il passe en pause tel
 * quel, sans être clos même si tout est fait, ni archivé, et la discussion n'a plus de parcours
 * actif. Seule la personne le reprend (« Reprendre », champ `resume`) ; un skill n'y revient pas.
 */
export const setAsideActive = (board: Board, now: number): Outcome => {
  if (!activeRun(board)) return null
  const b = clone(board)
  const run = activeRun(b)!
  run.status = 'paused'
  run.owner = undefined
  run.asideAt = now
  run.updatedAt = now
  b.activeId = null
  log(run, now, '‖', 'Parcours mis de côté', 'info')
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
  b.activeId = null
  log(run, now, '★', 'Parcours clos', 'ok')
  return { board: b, fx: { ...noFx(), toasts: [`★ Parcours clos : ${run.title}`] } }
}

/** Les choix faits sans la personne qu'elle n'a pas encore relus. */
export const unseenDecisions = (run: Run, relay?: Relay | null): number => inForce(run.decided ?? [], relay).filter(d => d.seenAt === undefined).length

/**
 * La personne a relu les choix faits sans elle, y compris ceux que les sessions liées ont relayés
 * (`stored` : le relais du parcours) : ceux-là sont enregistrés relus, pour ne plus revenir.
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
  log(run, now, '✓', 'Compte rendu validé', 'ok')
  // Les choix faits sans la personne sont dans le rapport : les valider, c'est les avoir relus.
  if (run.decided) run.decided = run.decided.map(d => (d.seenAt === undefined ? { ...d, seenAt: now } : d))
  run.updatedAt = now
  return { board: b, fx: { ...noFx(), toasts: ['✓ Compte rendu validé · suite : Version et push'] } }
}

/**
 * Ce que le tableau de bord sait du parcours, donné à Claude quand le compte rendu se charge :
 * il part de ces faits et les complète par git et le tracker.
 */
export const reportFacts = (run: Run, failedAgents = 0): string[] => {
  const lines = [`- Run "${run.title}", started ${isoMinute(run.startedAt)} UTC (use it for git log --since).`]
  const ticket = (t: Ticket) =>
    `${t.name} [${t.id}]: ${t.status}${t.why ? ` (waits for: ${t.why})` : ''}${t.startedAt !== undefined && t.finishedAt !== undefined ? `, ${Math.round((t.finishedAt - t.startedAt) / 60_000)} min` : ''}`
  if (run.tickets.length > 0) lines.push(`- Tickets of the lot: ${run.tickets.map(ticket).join('; ')}.`)
  const groups = run.groups ?? []
  if (groups.length > 0) {
    const state = (g: TicketGroup) => {
      const done = g.tickets.filter(id => ticketOf(run, id)?.status === 'done').length
      const sec = securityText(g.security)
      return `${g.id} (${g.name}): ${done}/${g.tickets.length} done${g.reviewedAt !== undefined ? ', reviewed by /code-review' : isTicketReviewEnough(run, g) ? ', reviewed by its single ticket review (no logic, not sensitive)' : ''}${sec ? `, ${sec}` : ''}`
    }
    lines.push(`- Groups, each usually run in its own discussion: ${groups.map(state).join('; ')}. Report every group, not only the one of this discussion: write « Fait » group by group.`)
  }
  const lotSecurity = groups.length === 0 ? securityText(run.security) : ''
  if (lotSecurity) lines.push(`- Lot: ${lotSecurity}.`)
  const tracking = run.artifacts.filter(a => a.kind === 'tracking')
  lines.push(
    tracking.length > 0
      ? `- Tracking files of this run (one per discussion; read them all, they hold what the other discussions did, found and decided): ${tracking.map(a => `${a.path}${a.detail ? ` (${a.detail})` : ''}`).join('; ')}. Also look in travail/tasks/ for others changed since the run started (git log).`
      : '- Tracking files: look in travail/tasks/ for every file changed since the run started (git log): one per discussion, they hold what the other discussions did, found and decided.',
  )
  const found = run.found ?? []
  if (found.length > 0) lines.push(`- Found on the way (tracker tasks created during the run, outside the lot): ${found.map(f => `${f.name} [${f.id}]: ${f.status}${f.why ? ` (${f.why})` : ''}${f.isForUser ? ', assigned to the user' : ''}`).join('; ')}.`)
  const decided = inForce(run.decided ?? [])
  const withdrawn = (run.decided ?? []).filter(d => d.withdrawnAt !== undefined)
  lines.push(
    decided.length > 0
      ? `- Choices reported as made without the user: ${decided.map(d => `${d.what}${d.why ? ` (because ${d.why})` : ''}`).join('; ')}. Put every one in « Décidé sans toi », and add the ones missing from this list.`
      : '- No choice was reported as made without the user: check the work for any, and put them in « Décidé sans toi ».',
  )
  if (withdrawn.length > 0) lines.push(`- Choices withdrawn during the run (no longer in force; say so apart in « Décidé sans toi », with why): ${withdrawn.map(d => `${d.what}${d.withdrawnWhy ? ` (${d.withdrawnWhy})` : ''}`).join('; ')}.`)
  const plans = run.artifacts.filter(a => a.kind === 'plan')
  if (plans.length > 0) lines.push(`- Plans written: ${plans.map(a => `${a.path}${a.detail ? ` (${a.detail})` : ''}`).join('; ')}.`)
  const tests = run.tests.filter(t => t.kind === 'test')
  if (tests.length > 0) lines.push(`- Test runs seen: ${tests.length}, ${tests.filter(t => !t.ok).length} red; last one ${tests.at(-1)!.ok ? 'green' : 'RED'}.`)
  if (failedAgents > 0) lines.push(`- Subagents that failed: ${failedAgents}.`)
  const warnings = run.log.filter(l => l.tone === 'warn' || l.tone === 'error').slice(0, 8)
  if (warnings.length > 0) lines.push(`- Warnings in the dashboard log: ${warnings.map(l => l.text).join('; ')}.`)
  return lines
}

export const resumeRun = (board: Board, id: string, now: number): Outcome => {
  const target0 = board.runs.find(r => r.id === id)
  if (!target0 || target0.id === board.activeId) return null
  const b = clone(board)
  const current = activeRun(b)
  if (current) shelve(current, now)
  const run = b.runs.find(r => r.id === id)!
  // Reprendre un parcours archivé le sort des archives ; mis de côté, il revient tel qu'il était.
  delete run.archivedAt
  delete run.asideAt
  run.status = 'active'
  run.owner = b.session
  run.finishedAt = undefined
  run.updatedAt = now
  b.activeId = run.id
  log(run, now, '↻', 'Parcours repris', 'accent')
  return { board: b, fx: { ...noFx(), toasts: [`↻ Reprise : ${run.title}`] } }
}

/**
 * Range un parcours aux archives : il quitte l'historique visible, n'est plus proposé à la reprise
 * et n'est jamais élagué. Le parcours en cours ici est d'abord mis en pause.
 */
export const archiveRun = (board: Board, id: string, now: number): Outcome => {
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
  log(run, now, '▣', 'Parcours archivé', 'info')
  return { board: b, fx: { ...noFx(), toasts: [`▣ Archivé : ${run.title}`] } }
}

/**
 * Une session liée a été demandée ou lancée par ce parcours (groupe ou éléments d'une phase) : son
 * brief nomme la discussion, dès la demande mise dans le prompt. Une demande en cours se lit sur le
 * groupe ou la phase (« Annuler » la retire) ; une session lancée, sur `linkedAt`, gardé même quand
 * ses éléments reviennent ensuite à faire ; les groupes confiés avant ce champ comptent aussi.
 */
const hasLaunchedLinked = (run: Run): boolean =>
  run.linkedAt !== undefined || (run.groups ?? []).some(g => g.linked !== undefined || g.delegated !== undefined) || run.phases.some(p => p.linked !== undefined)

/**
 * La discussion prend le titre du parcours (série 1, Q14 et Q15) : le parcours y est né, aucun
 * autre n'y est né (actif, en pause, fini ou archivé ; un parcours supprimé a quitté le board), et
 * ce n'est pas une session liée ; et, au premier titre comme plus tard (`fix.title`, `/flow rename`),
 * aucune session liée n'a été demandée par ce parcours : son brief nomme la discussion (série 2, Q6 ;
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
  return ` · name this discussion "${run.title}": if you have a tool that renames it (in the app: set_session_title), call it now with this title; otherwise the dashboard renames it at the user's next message`
}

/**
 * Renomme un parcours, titre automatique ou posé compris (`/flow rename <titre>`). Le titre reste
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
  log(run, now, '✎', `Parcours renommé : ${run.title}`, 'info')
  return { board: b, fx }
}

/** Sort un parcours des archives : il revient dans l'historique, tel qu'il était. */
export const unarchiveRun = (board: Board, id: string, now: number): Outcome => {
  const run0 = board.runs.find(r => r.id === id)
  if (!run0 || run0.archivedAt === undefined) return null
  const b = clone(board)
  const run = b.runs.find(r => r.id === id)!
  delete run.archivedAt
  run.updatedAt = now
  log(run, now, '▢', 'Parcours désarchivé', 'info')
  return { board: b, fx: { ...noFx(), toasts: [`▢ Désarchivé : ${run.title}`] } }
}

export const dropRun = (board: Board, id: string, now: number): Outcome => {
  if (!board.runs.some(r => r.id === id)) return null
  const b = clone(board)
  b.runs = b.runs.filter(r => r.id !== id)
  b.deleted = [{ id, at: now }, ...(b.deleted ?? []).filter(t => t.id !== id)].slice(0, LIMITS.tombstones)
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
    // Fait dans la branche d'une session liée : levé pour son groupe, pas pour les autres, sur une autre branche.
    if (inLot) return inLot.status !== 'done' || (inLot.relayedFrom !== undefined && inLot.relayedFrom !== groupIdOf(run, ticket.id))
    // Hors du lot : levé quand la dépendance externe est faite ; inconnu, il bloque par prudence.
    return externalOf(run, id)?.status !== 'done'
  })

/** Le groupe déclaré qui contient le ticket `id`. */
const groupIdOf = (run: Run, id: string): string | undefined => (run.groups ?? []).find(g => g.tickets.some(x => sameTicket(x, id)))?.id

/** La dépendance externe d'id `id`, si le parcours la connaît. */
export const externalOf = (run: Run, id: string): ExternalBlocker | undefined => (run.externals ?? []).find(x => sameTicket(x.id, id))

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
const sharedOf = (a: { group: TicketGroup; open: readonly Ticket[] }, b: { group: TicketGroup; open: readonly Ticket[] }): string | null => {
  const zb = zonesOf(b)
  for (const x of zonesOf(a)) {
    for (const y of zb) {
      if (x.key === y.key || y.key.startsWith(`${x.key}/`)) return tailOf(x.raw)
      if (x.key.startsWith(`${y.key}/`)) return tailOf(y.raw)
    }
  }
  // Le nom tel que l'autre groupe l'écrit : c'est lui qu'on cite (« ∦ A : PowerBI Desktop »).
  const ra = new Set((a.group.resources ?? []).map(resourceKey))
  return (b.group.resources ?? []).find(r => ra.has(resourceKey(r))) ?? null
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

/** Une ressource comparable : espaces resserrés, en minuscules. */
const resourceKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Le plan envoyé par Claude : chaque ticket connu dans un seul groupe (le premier qui le cite),
 * les ids inconnus mis de côté pour le lui dire. Un `continuesHere` reçu est ignoré : un groupe
 * ne se fait qu'en session liée.
 */
const parseGroups = (run: Run, value: unknown): { groups: TicketGroup[]; unknown: string[] } => {
  const groups: TicketGroup[] = []
  const unknown: string[] = []
  const seen = new Set<string>()
  for (const one of asList(value)) {
    const id = clip(str(one.id), 12)
    if (!id || groups.some(g => g.id === id)) continue
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
  return { groups, unknown }
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
  /** Vague d'exécution (0 = la première) ; -1 pour un groupe fait. */
  wave: number
  /** Pris dans une attente circulaire entre groupes : l'ordre est à revoir. */
  isCyclic: boolean
  /** Aucun ticket du groupe n'est commencé ni fait : il peut encore partir en parallèle. */
  isFresh: boolean
  /** Les autres groupes du lot parallèle, quand ce groupe en fait partie. */
  parallelWith: string[]
  /** Confié à une session liée qui ne l'a pas encore rendu : ni relancé, ni pris dans un lot. */
  isDelegated: boolean
  /**
   * Prêt et pas commencé : les groupes avec qui il a un fichier ou une ressource en commun, parmi
   * ceux du lot (quand il n'en est pas), ceux confiés à une session liée et ceux en cours ici.
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
  /** Le lot possible, mis en attente parce qu'un groupe du parcours est en cours. */
  heldBatch: string[]
  /** Les groupes commencés et pas finis : tant qu'il y en a, rien ne part en parallèle. */
  busy: string[]
  /** D'autres lots possibles, chacun ouvert par un groupe prêt resté hors du lot principal. */
  otherBatches: string[][]
  /** Les groupes confiés à une session liée et pas encore rendus. */
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
 * Le plan d'exécution du parcours, ou null sans groupes déclarés. Un groupe en attend un autre
 * quand l'un de ses tickets a un bloqueur encore ouvert dans cet autre ; les vagues en découlent.
 */
export const groupPlan = (run: Run): GroupPlan | null => {
  const declared = (run.groups ?? [])
    .map(g => ({ ...g, tickets: g.tickets.filter(id => ticketOf(run, id) !== undefined) }))
    .filter(g => g.tickets.length > 0)
  if (declared.length === 0) return null
  // « Commencé » se juge sur les tickets déclarés : un ticket rattaché ne rend pas un groupe commencé.
  const declaredIds = new Map(declared.map(g => [g.id, [...g.tickets]]))
  attachLoose(run, declared)
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
    return {
      group,
      isFallback,
      tickets,
      open,
      // Un groupe confié reste au travail tant qu'il n'est pas rendu, même tous ses tickets relayés faits.
      state: open.length === 0 && group.linked === undefined ? 'done' : waitsOn.size === 0 && waitsOutside.size === 0 ? 'ready' : 'waiting',
      waitsOn: [...waitsOn],
      waitsOutside: [...waitsOutside],
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

  // Chaque groupe se fait dans sa session liée, ses tickets en séquence, partageant leur contexte ;
  // des groupes indépendants partent ensemble, une session liée chacun.
  // Le lot réunit, dans l'ordre, les groupes prêts (aucun bloqueur encore ouvert) et pas encore
  // commencés, chacun retenu s'il n'a ni fichier ni ressource en commun avec un groupe déjà retenu
  // ou confié à une session liée : un fichier ou une ressource en commun vaut dépendance.
  const candidates = views.filter(v => !v.isFallback && v.state === 'ready' && v.isFresh && !v.isCyclic && !v.isDelegated)
  const inFlight = views.filter(v => v.isDelegated)
  const lotFrom = (order: GroupView[]): GroupView[] => {
    const kept: GroupView[] = []
    for (const v of order) if (![...inFlight, ...kept].some(o => sharedOf(v, o) !== null)) kept.push(v)
    return kept
  }
  const batch = lotFrom(candidates)
  const lot = batch.length >= 2 ? batch.map(v => v.group.id) : []
  // Un groupe commencé et pas fini occupe le parcours (une discussion à la fois) : le lot attend.
  // Un groupe confié à une session liée ne l'occupe pas : le parcours reste ici.
  const busyViews = views.filter(v => v.state !== 'done' && !v.isFresh && !v.isDelegated)
  const busy = busyViews.map(v => v.group.id)
  if (busy.length === 0) for (const v of batch) if (lot.includes(v.group.id)) v.parallelWith = lot.filter(id => id !== v.group.id)
  // Ce qui retient chaque groupe prêt : le lot (quand il n'en est pas), les sessions liées, le travail d'ici.
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
 * le plan, pour la couleur. Plusieurs à la fois : sessions liées des groupes, ticket laissé en
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
