// La règle d'effort des workers, en un seul endroit : le mod calcule l'effort de chaque groupe et
// l'écrit sur sa ligne de la demande de lancement (Claude n'y juge que le choix de conception restant ; xhigh vient
// du drapeau « Jugement » d'un ticket, le temps du ticket, et Fable du seul bouton « ↗ Fable »),
// et il l'applique lui-même à un manager qui fait le travail d'un worker (un lot
// sans groupes, un départ `/implement` ou `/tdd`, un diagnostic de bug), requête par requête. Un
// changement de la règle vaut ainsi pour les deux. Un ticket sensible ne compte pas au lancement : le
// mod d'un worker passe en high au moins chaque requête faite pendant un ticket sensible en cours
// (`workerTicketEffort`), et un lot sans groupes de même ; pendant un ticket « Jugement : oui » en cours
// (`isJudgmentTicket`), en xhigh au moins, chez un worker comme dans un lot. Hors de ce travail, l'effort d'une requête suit le
// rôle et la phase (`leadEffort`) : le COO en medium ; le manager d'une mission à groupes en medium de
// la fin du découpage au début du compte rendu ; un manager en cadrage sur Fable 5.2 medium, high quand l'auto de la
// mission envoie de sa discussion, quand le mod peut réécrire le modèle (sinon high au moins, xhigh au moins pour un
// cadrage en auto dont Fable a été éteint par le repli) ; high au moins dans toute autre phase d'un manager.
// Le mod n'impose xhigh que pendant un ticket « Jugement : oui » en cours (le drapeau qu'envoie la discussion qui
// tient la mission), au repli d'un worker Fable et au repli d'un cadrage en auto ; il ne choisit jamais le worker Fable.
//
// Module pur.

import type { Run, Ticket } from '../types'
import { currentPhase, isJudgmentTicket, sameTicket } from './basics.ts'
import { isSafeId } from './closing.ts'
import { activeDetour } from './model.ts'

/** L'effort de lancement d'un worker que calcule la règle : jamais xhigh (il vient du drapeau d'un ticket, pendant ce ticket). */
export type WorkerEffort = 'medium' | 'high'

/**
 * Ce qui fait lancer un worker de groupe en high plutôt qu'en medium (règle « Effort d'un worker de groupe »,
 * section 11 de la procédure, dans reference/effort-workers.md) ; `isMultiModule` : plusieurs modules de code (`codeModuleOf`).
 * Un ticket sensible n'y compte pas : le mod passe le worker en high pendant ce ticket (`workerTicketEffort`).
 */
export type GroupEffortInputs = { hasDesignChoices: boolean; isMultiModule: boolean }

/** La règle d'un worker de groupe au lancement : medium par défaut ; high pour des choix de conception ou plusieurs modules de code. */
export const groupEffortLevel = (x: GroupEffortInputs): WorkerEffort => (x.hasDesignChoices || x.isMultiModule ? 'high' : 'medium')

/** La règle d'un worker de diagnostic de bug : high ; xhigh seulement proposé, à la deuxième tentative. */
export const diagnosisEffortLevel = (): WorkerEffort => 'high'

/** Les dossiers qui regroupent des paquets : sous eux, un module est le paquet (`plugins/flow-board`). */
const PACKAGE_ROOTS = new Set(['plugins', 'packages'])

/** Les dossiers de premier niveau qui ne portent pas de code : leurs fichiers ne comptent pas. */
const DOC_ROOTS = new Set(['travail', 'docs'])

/**
 * Le module de code d'un fichier, pour « plusieurs modules de code à la fois » (`ticketsEffort`) : son
 * dossier de premier niveau (`scripts`, `config`, `.claude`, `src`…), ou son paquet sous `plugins/` ou
 * `packages/` ; « racine » pour un fichier à la racine ; null pour la documentation (`.md`, `.txt`) et
 * pour un fichier sous `travail/` ou `docs/`, qui ne comptent pas. Un dossier (`scripts/`, `plugins/x/`, ou
 * `plugins/x` sans extension, que `files` permet) compte pour le module qu'il désigne.
 */
export const codeModuleOf = (path: string): string | null => {
  const clean = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  const parts = clean.split('/').filter(p => p !== '')
  const isFolder = clean.endsWith('/')
  if (parts.length === 0 || (!isFolder && /\.(md|txt)$/i.test(parts[parts.length - 1]!)) || DOC_ROOTS.has(parts[0]!)) return null
  if (parts.length === 1) return isFolder ? parts[0]! : 'racine'
  const isPackage = PACKAGE_ROOTS.has(parts[0]!) && (parts.length > 2 || isFolder || !parts[1]!.includes('.'))
  return isPackage ? `${parts[0]}/${parts[1]}` : parts[0]!
}

/**
 * L'effort que la règle d'un worker de groupe donne à des tickets ouverts, avec ses raisons (aucune pour
 * medium) : plusieurs modules de code (`codeModuleOf`) parmi leurs fichiers et ceux que le groupe déclare
 * en plus (`files`). Un ticket sensible n'y compte pas (le high vient pendant ce ticket seulement). Un choix
 * de conception restant n'est pas connu du mod : Claude en juge au lancement.
 */
const ticketsEffort = (tickets: readonly Ticket[], files: readonly string[] = []): { level: WorkerEffort; reasons: string[] } => {
  const all = [...tickets.flatMap(t => t.files ?? []), ...files]
  const modules = new Set(all.map(codeModuleOf).filter((m): m is string => m !== null))
  const reasons = modules.size > 1 ? ['plusieurs modules de code'] : []
  return { level: groupEffortLevel({ hasDesignChoices: false, isMultiModule: modules.size > 1 }), reasons }
}

/**
 * Ce qu'ajoute la ligne d'un groupe dans la demande de lancement : l'effort imposé par un bouton, qui
 * l'emporte (Opus xhigh, ou Fable 5.2 high pour « ↗ Fable » : jamais Sonnet, une tâche de jugement) ; Sonnet high pour un groupe sans
 * logique (`isNoLogic`, l'option fusion, que l'appelant ne donne jamais à un groupe qui porte un ticket de jugement) ;
 * sinon l'effort calculé (`ticketsEffort` de ses tickets ouverts et des fichiers qu'il déclare) et ses raisons, suivi
 * de « , xhigh pendant un ticket de jugement » quand un ticket ouvert est « Jugement : oui » (`isJudgmentTicket`).
 * Des textes fixes seulement : aucun nom ni chemin de ticket n'y entre.
 */
export const groupLaunchNote = (open: readonly Ticket[], files: readonly string[], imposed: ImposedEffort | undefined, isNoLogic: boolean): string => {
  if (imposed === 'fable') return ' — Fable 5.2 high, imposé'
  if (imposed) return ` — effort : ${imposed}, imposé`
  if (isNoLogic) return ' — Sonnet high, sans logique'
  const x = ticketsEffort(open, files)
  return ` — effort calculé : ${x.level}${x.reasons.length > 0 ? ` (${x.reasons.join(', ')})` : ''}${open.some(isJudgmentTicket) ? ', xhigh pendant un ticket de jugement' : ''}`
}

/** Les phases où un manager fait le travail d'un worker de groupe, quand sa mission n'a pas de groupes. */
const LOT_PHASES = new Set(['implement', 'tdd'])

/**
 * L'effort que prend un manager qui fait lui-même le travail d'un worker, par la règle de ce worker,
 * d'après ce sur quoi il travaille (le détour actif d'abord) : celle d'un worker de groupe pour un lot
 * (mission sans groupes en `/implement` ou `/tdd`, tant qu'un ticket reste ouvert : xhigh au moins quand le
 * ticket en cours, le dernier passé « doing », est de jugement (`isJudgmentTicket` ; `ticket` : celui-là, quand
 * le bandeau peut l'écrire) ;
 * high pendant un ticket « doing » sensible, ou qui ne dit pas s'il l'est, comme le mod d'un worker ; sinon
 * l'effort calculé sur les tickets ouverts, sans le critère « sensible »), celle d'un worker de diagnostic pour
 * `/diagnosing-bugs` (un plancher : high au moins, un effort plus haut de la discussion, comme la deuxième
 * tentative d'un worker de diagnostic en xhigh, reste). Rien hors de ce travail.
 */
export const managerWorkEffort = (run: Run): { level: WorkerEffort | 'xhigh'; rule: 'group' | 'diagnosis' | 'judgment'; ticket?: string } | null => {
  if (run.status !== 'active') return null
  const phase = currentPhase(run)
  if (phase.status !== 'active') return null
  const skill = activeDetour(phase)?.skill ?? phase.skill
  if (skill === 'diagnosing-bugs') return { level: diagnosisEffortLevel(), rule: 'diagnosis' }
  if (!LOT_PHASES.has(skill) || (run.groups ?? []).length > 0) return null
  const open = run.tickets.filter(t => t.status !== 'done')
  // Le lot fini (revue du lot, compte rendu encore dans la phase) : plus le travail d'un worker.
  if (run.tickets.length > 0 && open.length === 0) return null
  // Un détour pris pendant le ticket (un diagnostic, un /grilling) suit sa propre règle, comme pour un ticket sensible :
  // xhigh ne vaut que pour le travail du lot lui-même.
  // Le ticket en cours : le dernier passé « doing » (ex aequo compris) ; un ticket fini mais en attente de sa revue
  // reste « doing » pendant le suivant, qui ne prend pas son xhigh.
  const doing = run.tickets.filter(t => t.status === 'doing')
  const latest = doing.reduce((max, t) => Math.max(max, t.startedAt ?? 0), 0)
  const judgment = doing.find(t => (t.startedAt ?? 0) === latest && isJudgmentTicket(t))
  if (judgment) return { level: 'xhigh', rule: 'judgment', ...(isShownId(judgment.id) ? { ticket: judgment.id } : {}) }
  const isSensitiveDoing = run.tickets.some(t => t.status === 'doing' && t.sensitive !== false)
  return { level: isSensitiveDoing ? 'high' : ticketsEffort(open).level, rule: 'group' }
}

/** Un id de ticket que le bandeau peut écrire tel quel : la forme de `isSafeId`, bornée à 24 signes ; sinon il se tait. */
const isShownId = (id: string): boolean => isSafeId(id) && id.length <= 24

/**
 * L'effort qu'impose le mod d'un worker de groupe à une requête de son fil principal, d'après ses tickets
 * en cours (`doing` : ceux que son relais dit « doing » ; null quand son relais ne se lit pas), son ticket en
 * cours parmi eux (`current` : le dernier passé « doing », ex aequo compris ; tous par défaut : un ticket fini
 * mais en attente de sa revue reste « doing » pendant le suivant) et la mission pour laquelle il travaille
 * (`mission`, absente quand elle ne se lit pas) : xhigh au moins quand son ticket en cours est un ticket
 * que la mission dit « Jugement : oui » (`isJudgmentTicket` : seul un drapeau à `true` ; un ticket absent de la
 * mission, une mission ou un relais illisible n'en donnent jamais) ; sinon high au moins (un effort plus
 * haut de la session reste) pendant un ticket sensible, ou dont la sensibilité ne se lit pas (ticket muet,
 * absent de la mission, mission ou relais illisible) ; rien d'imposé sans ticket en cours, ni pendant un
 * ticket dit non sensible. `ticket` : celui qui l'impose, pour le bandeau ; `isUnknown` : sa sensibilité
 * ne se lit pas.
 */
export const workerTicketEffort = (doing: readonly string[] | null, mission: Run | undefined, current: readonly string[] | null = doing): LeadEffort | null => {
  const high = (ticket: string | undefined, isUnknown: boolean): LeadEffort => ({
    level: 'high',
    rule: 'sensitive',
    how: 'floor',
    ...(ticket !== undefined && isShownId(ticket) ? { ticket } : {}),
    ...(isUnknown ? { isUnknown: true } : {}),
  })
  if (doing === null) return high(undefined, true)
  const judgment = (current ?? doing).find(id => isJudgmentTicket(mission?.tickets.find(t => sameTicket(t.id, id))))
  if (judgment !== undefined) return { level: 'xhigh', rule: 'judgment', how: 'floor', ...(isShownId(judgment) ? { ticket: judgment } : {}) }
  const flags = doing.map(id => ({ id, sensitive: mission?.tickets.find(t => sameTicket(t.id, id))?.sensitive }))
  const sensitive = flags.find(f => f.sensitive === true)
  if (sensitive) return high(sensitive.id, false)
  const unknown = flags.find(f => f.sensitive !== false)
  return unknown ? high(unknown.id, true) : null
}

// ─── L'effort d'une requête du fil principal, selon le rôle et la phase ──────────────────────

/**
 * Pourquoi le mod impose un effort, dit au bandeau : la règle d'un worker (un lot, un diagnostic),
 * celle du COO, le suivi des groupes d'une mission à groupes, la phase d'un manager (cadrage,
 * cadrage dont l'auto envoie d'ici (`framingAuto`), compte rendu, rétrospective, toute autre phase), un ticket
 * sensible en cours chez un worker, ou un ticket de jugement en cours (`judgment`, chez un worker ou dans un lot).
 */
export type LeadRule = 'group' | 'diagnosis' | 'coo' | 'groups' | 'framing' | 'framingAuto' | 'report' | 'retro' | 'other' | 'sensitive' | 'judgment' | 'fable' | 'fableOff'

/**
 * Comment l'effort se pose : `exact`, l'effort de la règle quel que soit celui de la discussion (un lot,
 * jamais xhigh) ; `floor`, `level` au moins (high ou xhigh), un effort plus haut restant ; `medium`, medium imposé (low et
 * high ramenés à medium), xhigh et max laissés, un choix délibéré de la personne. `ticket` et `isUnknown` :
 * pour les règles `sensitive` et `judgment`, le ticket en cours qui l'impose et si sa sensibilité ne se lit pas. `model` :
 * le modèle imposé à la requête (Fable 5.2, `FABLE_MODEL`), toujours avec un effort `exact` ; absent, la
 * requête garde le sien. `level` xhigh : le repli d'un worker Fable quand Fable est indisponible
 * (`FABLE_OFF_WORKER_EFFORT`), le remplaçant d'Opus xhigh que Mathis a choisi, le plancher d'un ticket de
 * jugement en cours (`judgment`) et celui d'un cadrage en auto dont Fable a été éteint par le repli
 * (`framingAuto`) ; jamais autrement.
 */
export type LeadEffort = { level: WorkerEffort | 'xhigh'; rule: LeadRule; how: 'exact' | 'floor' | 'medium'; ticket?: string; isUnknown?: true; model?: typeof FABLE_MODEL }

/**
 * Le modèle que le mod impose à une requête du fil principal : l'alias `fable`, Fable 5.2 depuis Claude Code
 * 2.1.321 (celui que la sonde de `docs/evenements-moteur.md`, « Modèle réécrit par `turn.step` », a essayé).
 */
export const FABLE_MODEL = 'fable'

/** Le début de l'id complet d'un modèle Fable (`claude-fable-5-2`), sans son numéro de version. */
const FABLE_ID_PREFIX = 'claude-fable-'

/** L'id complet d'un modèle (celui de `$.session.model()`) est un Fable ; un id illisible ou un alias : non. */
export const isFableModelId = (id: unknown): boolean => typeof id === 'string' && id.startsWith(FABLE_ID_PREFIX)

/** Les mots que montre le rappel d'un manager resté sur Fable après le cadrage (bandeau et demande de lancement). */
export const FABLE_STUCK_WORDS = 'tape /model opus'

/** La discussion qui tient le siège du COO : medium à chaque requête, xhigh et max laissés. */
export const COO_EFFORT: LeadEffort = { level: 'medium', rule: 'coo', how: 'medium' }

/**
 * La règle d'un worker Fable (sa délégation porte la marque « worker Fable »), quand le mod peut réécrire le
 * modèle : chaque requête de son fil principal sur Fable 5.2 en high, exact, ticket sensible en cours ou non.
 */
export const FABLE_WORKER_EFFORT: LeadEffort = { level: 'high', rule: 'fable', how: 'exact', model: FABLE_MODEL }

/**
 * Le repli d'un worker Fable quand Fable est indisponible (limite atteinte, usage supplémentaire coupé) : le
 * modèle de la session, en xhigh exact, jusqu'à la fin de la session, choix de Mathis du 09/11/2026.
 */
export const FABLE_OFF_WORKER_EFFORT: LeadEffort = { level: 'xhigh', rule: 'fableOff', how: 'exact' }

/**
 * Les phases de cadrage d'un manager (grilling et ses variantes, spec, découpage). Le tri (`triage`) n'y est pas,
 * exprès : il est un cadrage pour les consignes (`FRAMING_SKILLS` de `register.tsx`), pas pour le modèle ; il reste
 * sur Opus, plancher high, règle « other » (choix du 13/11/2026 : l'élargir à Fable serait une dépense nouvelle).
 */
const FRAMING = new Set(['grilling', 'grill-with-docs', 'grill-me', 'to-questionnaire', 'to-spec', 'to-tickets', 'domain-modeling'])

/**
 * La fenêtre du cadrage sur Fable : la phase du curseur est une phase de cadrage, active ou faite tant que la
 * suivante n'a pas commencé, sauf le découpage fini (le retour sur Opus se fait à sa fin), et la mission
 * n'est pas en suivi des groupes. Un détour ne la change pas : le modèle ne change que deux fois, chaque
 * changement faisant relire tout le contexte sans cache.
 */
const isFramingWindow = (run: Run): boolean => {
  const phase = currentPhase(run)
  if (!FRAMING.has(phase.skill) || (phase.status !== 'active' && phase.status !== 'done')) return false
  if (phase.skill === 'to-tickets' && phase.status === 'done') return false
  return !isGroupsFollowUp(run)
}

/** Les phases qui closent le suivi des groupes : le compte rendu, la rétrospective, la livraison (`project:*`). */
const endsFollowUp = (skill: string): boolean => skill === 'compte-rendu' || skill === 'retro' || skill.startsWith('project:')

/**
 * Une mission à groupes entre la fin de son découpage et le début de son compte rendu : la dernière
 * phase de découpage faite (avec sa date de fin) au curseur ou avant, « Tickets » ou une rétro dont les
 * pistes sont découpées en groupes (comme `compactionMoment`), et aucune phase de compte rendu, de
 * rétrospective ou de livraison entre elle et le curseur. Une compaction n'y change rien.
 */
const isGroupsFollowUp = (run: Run): boolean => {
  if ((run.groups ?? []).length === 0) return false
  let cut = -1
  run.phases.forEach((p, i) => {
    if (i <= run.cursor && (p.skill === 'to-tickets' || p.skill === 'retro') && p.status === 'done' && p.finishedAt !== undefined) cut = i
  })
  return cut >= 0 && !run.phases.slice(cut + 1, run.cursor + 1).some(p => endsFollowUp(p.skill))
}

/**
 * Le rappel « tape /model opus » est dû chez un manager : sa mission active, le découpage fini, au suivi ou au
 * lancement de ses groupes (`isGroupsFollowUp`), hors d'un cadrage en cours (la règle du manager, `leadEffort`, n'y
 * impose alors plus Fable), et le modèle de la session (`sessionModel`, l'id complet relu à chaque fois) un Fable.
 * Le mod ne change jamais ce modèle lui-même : un `/model` tapé reste respecté, seule la personne le retape.
 */
export const isFableStuck = (run: Run | null, sessionModel: unknown): boolean =>
  run !== null && run.status === 'active' && isGroupsFollowUp(run) && leadEffort(run)?.rule !== 'framing' && isFableModelId(sessionModel)

/**
 * Ce que la règle d'un manager lit de sa discussion, en plus de la mission : `isAutoHere`, l'auto de la mission
 * envoie d'ici (l'état qui met le bloc « mode auto » dans sa consigne : allumé par un geste de Mathis pour cette
 * discussion, la mission y étant active) ; `isFableOff`, Fable éteint par le repli « Fable indisponible », sans
 * `/model` tapé. Absents : non.
 */
export type LeadContext = { isAutoHere?: boolean; isFableOff?: boolean }

/**
 * L'effort qu'impose le mod à une requête du fil principal d'un manager, mission active ici : la règle
 * d'un worker quand il en fait le travail (`managerWorkEffort`, inchangée, sur le modèle de la session) ;
 * pendant la fenêtre du cadrage (`isFramingWindow`), quand `isFableOn` dit que le mod peut réécrire le modèle
 * (pas de `/model` tapé, Fable pas éteint, la requête sur le modèle de la session), Fable 5.2 en high exact si
 * l'auto envoie d'ici (`here.isAutoHere`), en medium exact sinon ; dans cette fenêtre, Fable éteint par le
 * repli (`here.isFableOff`) et l'auto envoyant d'ici, xhigh au moins ; medium pendant le suivi des groupes d'une
 * mission à groupes ; sinon high au moins, avec la raison de la phase. Rien sans mission active (`null`). Le
 * COO, qui n'a pas de mission, a `COO_EFFORT`. Sans `isFableOn`, jamais de modèle : dans le doute, la requête
 * garde le sien.
 */
export const leadEffort = (run: Run | null, isFableOn = false, here: LeadContext = {}): LeadEffort | null => {
  if (!run || run.status !== 'active') return null
  const work = managerWorkEffort(run)
  if (work) return { level: work.level, rule: work.rule, how: work.rule === 'group' ? 'exact' : 'floor', ...(work.ticket !== undefined ? { ticket: work.ticket } : {}) }
  if (isFramingWindow(run)) {
    if (isFableOn) return here.isAutoHere === true ? { level: 'high', rule: 'framingAuto', how: 'exact', model: FABLE_MODEL } : { level: 'medium', rule: 'framing', how: 'exact', model: FABLE_MODEL }
    if (here.isAutoHere === true && here.isFableOff === true) return { level: 'xhigh', rule: 'framingAuto', how: 'floor' }
  }
  // Un cadrage en cours, en détour (/grilling sur une question remontée) ou en phase active, passe avant le suivi des groupes.
  const phase = currentPhase(run)
  const framing = activeDetour(phase)?.skill ?? (phase.status === 'active' ? phase.skill : null)
  if (framing !== null && FRAMING.has(framing)) return { level: 'high', rule: 'framing', how: 'floor' }
  if (isGroupsFollowUp(run)) return { level: 'medium', rule: 'groups', how: 'medium' }
  const skill = phase.skill
  const rule: LeadRule = FRAMING.has(skill) ? 'framing' : skill === 'compte-rendu' ? 'report' : skill === 'retro' ? 'retro' : 'other'
  return { level: 'high', rule, how: 'floor' }
}

/** Les niveaux d'effort nommés, du plus bas au plus haut ; un effort relevé hors de cette liste (un budget numérique) part tel quel. */
const EFFORT_ORDER: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_LEVELS = new Set(EFFORT_ORDER)

/**
 * L'effort qui part, d'après la règle et l'effort de la requête : un lot et un ticket de jugement en cours
 * (`judgment`) imposent leur niveau même sur un effort numérique (un budget) ; les autres règles laissent tel
 * quel un effort hors de `EFFORT_LEVELS`,
 * nombre ou texte (le registre et le relevé du COO gardent un budget en texte : « 32000 ») ; un plancher
 * (`floor`) monte un effort plus bas que le sien à son niveau et laisse un effort égal ou plus haut.
 */
export const effortSent = <E extends string | number>(x: LeadEffort, current: E): E | WorkerEffort | 'xhigh' =>
  x.how === 'exact'
    ? x.level
    : typeof current !== 'string' || !EFFORT_LEVELS.has(current)
      ? typeof current === 'number' && x.rule === 'judgment'
        ? x.level
        : current
      : x.how === 'floor'
      ? EFFORT_ORDER.indexOf(current) < EFFORT_ORDER.indexOf(x.level)
        ? x.level
        : current
      : current === 'xhigh' || current === 'max'
        ? current
        : 'medium'

const LEAD_REASON: Record<LeadRule, string> = {
  group: 'règle des workers',
  diagnosis: 'règle des workers',
  coo: 'règle du COO',
  groups: 'suivi des groupes',
  framing: 'cadrage',
  framingAuto: 'cadrage en auto',
  report: 'compte rendu',
  retro: 'rétrospective',
  other: 'règle du manager',
  sensitive: 'ticket sensible en cours',
  judgment: 'ticket de jugement en cours',
  fable: 'worker Fable',
  fableOff: 'repli sur Opus',
}

/**
 * La raison d'un ticket sensible en cours chez un worker : « ticket sensible <id> en cours » ; « ticket <id> en
 * cours, sensibilité inconnue » quand elle ne se lit pas ; « ticket en cours illisible » sans id (relais illisible).
 */
const sensitiveReason = (x: LeadEffort): string =>
  x.ticket === undefined
    ? x.isUnknown
      ? 'ticket en cours illisible'
      : LEAD_REASON.sensitive
    : x.isUnknown
      ? `ticket ${x.ticket} en cours, sensibilité inconnue`
      : `ticket sensible ${x.ticket} en cours`

/** La raison d'un ticket de jugement en cours : « ticket de jugement <id> en cours », sans id quand le bandeau ne peut pas l'écrire. */
const judgmentReason = (x: LeadEffort): string => (x.ticket === undefined ? LEAD_REASON.judgment : `ticket de jugement ${x.ticket} en cours`)

/**
 * Le texte du bandeau : l'effort imposé et sa raison (« effort : medium, suivi des groupes »), espaces comprises ;
 * avec un modèle imposé, le modèle d'abord (« modèle : Fable 5.2 medium, cadrage », « modèle : Fable 5.2 high,
 * cadrage en auto »).
 */
const leadEffortText = (x: LeadEffort): string =>
  x.model
    ? `modèle : Fable 5.2 ${x.level}, ${LEAD_REASON[x.rule]}`
    : `effort${x.rule === 'group' ? ' du lot' : x.rule === 'diagnosis' ? ' du diagnostic' : ''} : ${x.level}, ${x.rule === 'sensitive' ? sensitiveReason(x) : x.rule === 'judgment' ? judgmentReason(x) : LEAD_REASON[x.rule]}`

/**
 * Le texte du bandeau quand la règle joue : un lot et un diagnostic se disent toujours, comme avant ;
 * les autres règles (un ticket de jugement en cours compris, chez un worker comme dans un lot), seulement
 * quand l'effort qui part diffère de l'effort relevé de la discussion (le
 * registre garde l'effort d'origine, en texte) : rien sur un effort inconnu ou numérique, ni sur xhigh ou
 * max laissés.
 */
export const leadEffortPill = (x: LeadEffort, current: string | undefined): string | null => {
  if (x.model || x.how === 'exact' || x.rule === 'diagnosis') return leadEffortText(x)
  return current !== undefined && effortSent(x, current) !== current ? leadEffortText(x) : null
}

// ─── Le quota de la discussion, avant un lancement ─────────────────────────────────────────────

/**
 * Une fenêtre de quota telle que le moteur la donne (`$.session.usage().rateLimits`) : `five_hour`,
 * `seven_day` (ou `spend_limit` d'une passerelle, laissé de côté), le pourcentage utilisé, la remise à zéro.
 */
export type QuotaWindow = { kind: string; percentUsed: number; resetsAt?: string }

/** Les fenêtres montrées, dans cet ordre, avec leur nom court. */
const QUOTA_WINDOWS: readonly (readonly [string, string])[] = [
  ['five_hour', '5 h'],
  ['seven_day', '7 j'],
]

/** Un délai jusqu'à la remise à zéro, dit court : « dans 40 min », « dans 3 h 05 », « dans 2 j ». */
const resetIn = (ms: number): string => {
  const m = Math.max(1, Math.round(ms / 60_000))
  if (m < 60) return `dans ${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `dans ${h} h ${String(m % 60).padStart(2, '0')}` : `dans ${Math.floor(h / 24)} j`
}

/**
 * Le quota de la discussion en une ligne : « 5 h : 42 % (remise dans 3 h 05) · 7 j : 80 % (remise dans 2 j) ».
 * Seulement les fenêtres de 5 heures et de 7 jours que le moteur donne avec un pourcentage lisible ; null sans
 * aucune (hors abonnement, avant la première réponse) : rien ne s'affiche ni ne se cite alors. Une remise
 * illisible ou passée est tue.
 */
export const quotaText = (limits: readonly QuotaWindow[] | null | undefined, now: number): string | null => {
  if (!Array.isArray(limits)) return null
  const parts = QUOTA_WINDOWS.flatMap(([kind, label]) => {
    const w = limits.find(l => l !== null && typeof l === 'object' && l.kind === kind)
    if (!w || typeof w.percentUsed !== 'number' || !Number.isFinite(w.percentUsed)) return []
    const at = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : NaN
    const reset = Number.isFinite(at) && at > now ? ` (remise ${resetIn(at - now)})` : ''
    return [`${label} : ${Math.round(w.percentUsed)} %${reset}`]
  })
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Le quota cité sous un xhigh imposé : relevé à l'écriture de la demande. */
const QUOTA_NOTE = (quota: string): string =>
  `le quota de cette discussion, relevé à l'écriture de cette demande (${quota}) : une session xhigh l'use vite, et une limite atteinte arrête le worker en plein travail`

// ─── Les textes de la règle, donnés à Claude dans le brief d'un worker de groupe ──────────────

/**
 * Le chemin qu'un bouton du tableau de bord impose à la session d'un groupe : `xhigh` (« ↗ xhigh », Opus
 * xhigh) ou `fable` (« ↗ Fable », le worker Fable : Fable 5.2 high par son mod) ; sans lui, l'effort calculé, et
 * xhigh le temps d'un ticket de jugement par le mod de la session.
 */
export type ImposedEffort = 'xhigh' | 'fable'

/**
 * Ce qu'ajoute un effort xhigh retenu : la session est autonome, et l'app la plafonne à l'effort
 * de cette discussion (start_session ne lui en donne jamais un plus haut, constaté en 0.53.0) ;
 * une fois la session lancée, rappeler que l'effort de cette discussion peut redescendre.
 */
export const XHIGH_LAUNCH = (many: boolean, current: string | undefined): string =>
  `${many ? 'Une session lancée en xhigh' : 'Lancée en xhigh, la session'} est un worker autonome : son prompt le dit (point 3 ci-dessous). ` +
  `Dans l'app Desktop, start_session ne donne jamais à une session un effort plus haut que celui de cette discussion${current ? ` (son effort relevé à l'écriture de cette demande : ${current} ; je l'ai peut-être monté depuis, avant Entrée)` : ''} : si le tien est sous xhigh, arrête-toi avant de lancer et demande-moi de passer cette discussion en xhigh, puis seulement lance ; claude --bg --effort xhigh, dans le CLI, n'a pas ce plafond. ` +
  `Une fois ${many ? 'une session xhigh lancée' : 'la session lancée'}, rappelle-moi en une ligne que je peux redescendre l'effort de cette discussion : sinon tu ferais le reste de la mission en xhigh.`

/**
 * Ce qu'ajoute le chemin Fable retenu : la session est un worker Fable et un worker autonome ; elle part
 * sur Opus avec son brief Fable (son appel `delegate` porte `"model": "fable"`), et son mod envoie chaque
 * requête de son fil principal sur Fable 5.2 high. Aucun modèle au lancement, et aucun effort à monter dans
 * cette discussion : le mod impose l'effort par requête, et l'app ne plafonne pas ce qu'il impose.
 */
export const FABLE_LAUNCH = (many: boolean): string =>
  `${many ? 'Une session lancée sur Fable' : 'Lancée sur Fable, la session'} est un worker Fable et un worker autonome : son brief Fable, effort high, aucun model dans start_session ni dans claude --bg (son mod la passe sur Fable 5.2 high) ; rien à monter ici.`


/**
 * Le modèle Sonnet d'un worker de groupe sans logique (option fusion), écrit une seule fois : l'id que prend
 * `model` de `start_session` dans l'app (un modèle de la même famille ou moins cher que celui de la
 * discussion ; un plus cher est ignoré) et l'alias de `--model` de `claude --bg`. À revoir à la sortie d'un
 * nouveau Sonnet : l'alias suit seul le dernier Sonnet, l'id non.
 */
export const SONNET_APP_ID = 'claude-sonnet-5-5'
export const SONNET_CLI_ALIAS = 'sonnet'

/**
 * Le modèle Opus d'un worker de groupe qui ne part ni sur Sonnet ni sur Fable, écrit une seule fois, à côté de
 * Sonnet : l'id que prend `model` de `start_session` dans l'app et l'alias de `--model` de `claude --bg`. Écrit au
 * lancement, il fait partir le groupe sur Opus même quand Fable est devenu le modèle de la discussion ou le défaut
 * du poste (un `/model fable` tapé au cadrage). À revoir à la sortie d'un nouvel Opus : l'alias suit seul le dernier
 * Opus, l'id non.
 */
export const OPUS_APP_ID = 'claude-opus-5-5'
export const OPUS_CLI_ALIAS = 'opus'

/**
 * Comment lancer un groupe sans logique : Sonnet en high, dans l'app comme dans le CLI ; les autres groupes
 * partent sur Opus (`OPUS_LAUNCH_FR`), comme un groupe qui porte un ticket de jugement. Dit seulement quand la
 * demande en porte un, et jamais sous un effort imposé.
 */
export const SONNET_LAUNCH_FR =
  `Un groupe annoncé « Sonnet high » part sur Sonnet : model "${SONNET_APP_ID}" et effort "high" dans start_session, --model ${SONNET_CLI_ALIAS} --effort high dans claude --bg ; les autres groupes partent sur Opus (un groupe qui porte un ticket de jugement ne va jamais à Sonnet). `

/**
 * Comment lancer un groupe Opus : tout groupe qui n'est ni annoncé « Sonnet high » ni lancé par « ↗ Fable », en
 * mode auto comme hors auto, effort imposé (« ↗ xhigh ») compris, reçoit le modèle Opus, dans l'app comme dans le
 * CLI. Dit quand la demande porte un tel groupe ; jamais pour un worker Fable, qui part sans modèle (`FABLE_LAUNCH`).
 */
export const OPUS_LAUNCH_FR =
  `Un groupe dont la ligne ne nomme pas un autre modèle part sur Opus, quel que soit le modèle de cette discussion ou du poste : model "${OPUS_APP_ID}" dans start_session, --model ${OPUS_CLI_ALIAS} dans claude --bg. `

/**
 * Ce que dit la consigne d'effort, hors effort imposé : l'effort se lit sur la ligne du groupe
 * (`groupLaunchNote`) ; Claude ne juge que ce que le mod ne sait pas, un choix de conception restant (high),
 * et dit l'effort pris et tout écart ; ni un ticket sensible ni un ticket de jugement ne comptent, le mod de la
 * session la passant en high pendant un ticket sensible et en xhigh pendant un ticket « Jugement : oui ». Plus
 * aucune question d'effort. Les critères du calcul et de la tâche de jugement vivent dans la section 11 de la
 * procédure, dans son annexe pour le manager, citée par `effortFile` (le chemin de `reference/effort-workers.md`).
 */
const CALCULATED_EFFORT = (many: boolean, effortFile: string): string =>
  `Effort de ${many ? 'chaque session (<effort>)' : 'la session (<effort>)'} : l’effort calculé sur la ligne ${many ? 'de son' : 'du'} groupe ; high si un choix de conception reste à faire ${many ? 'à son' : 'au'} groupe. ` +
  'Pendant un ticket sensible, le mod de la session la passe lui-même en high, et pendant un ticket « Jugement : oui », en xhigh : ne relève pas son effort pour ces tickets. ' +
  `Ne me pose aucune question sur l'effort. Dis-moi en une ligne${many ? ', pour chaque groupe,' : ''} l'effort pris et, s'il s'écarte du calcul, pourquoi. ` +
  `Critères du calcul, de la tâche de jugement et de la tâche d'exécution : section 11 de ${effortFile}, à lire avant de lancer. `

/**
 * L'effort d'une session de groupe : celui que calcule le mod (medium par défaut, high pour un groupe
 * délicat), high pour un choix de conception restant ; une tâche de jugement ne change pas l'effort de
 * lancement (le mod de la session la passe en xhigh le temps du ticket), et Claude ne prend jamais Fable seul : il ne
 * le suggère que pour relancer un ticket qui bute (section 11, « Ticket qui bute »). Imposé par un bouton (« ↗ xhigh », « ↗ Fable »), sans question. `quota` (`quotaText`, les fenêtres du
 * compte, pas la part de Fable) : cité avant un lancement en xhigh imposé ; null, rien n'en est dit.
 */
export const GROUP_EFFORT = (many: boolean, imposed: ImposedEffort | undefined, current: string | undefined, effortFile: string, quota: string | null = null): string =>
  imposed === 'fable'
    ? `Effort de ${many ? 'chaque session (<effort>)' : 'la session (<effort>)'} : high, pour le worker Fable (Fable 5.2 high, choisi par moi au tableau de bord ; ne me pose aucune question sur l'effort). ${FABLE_LAUNCH(many)}`
    : imposed
      ? `Effort de ${many ? 'chaque session (<effort>)' : 'la session (<effort>)'} : ${imposed}, choisi par moi au tableau de bord ; ne me pose aucune question sur l'effort${quota ? ` ; en lançant, cite-moi en une ligne, sans attendre de réponse, ${QUOTA_NOTE(quota)}` : ''}. ${XHIGH_LAUNCH(many, current)}`
      : CALCULATED_EFFORT(many, effortFile) + 'Tu ne prends jamais Fable seul : seul mon bouton « ↗ Fable » le donne, et tu ne le suggères que pour relancer un ticket qui bute après trois approches (section 11, « Ticket qui bute »). '

/**
 * L'effort d'une session de groupe lancée par le mode auto : la même règle, jamais Fable ; xhigh vient du drapeau
 * « Jugement » d'un ticket, que le mod de la session applique le temps du ticket.
 */
export const AUTO_GROUP_EFFORT = (many: boolean, effortFile: string): string =>
  CALCULATED_EFFORT(many, effortFile) + 'La mission est en mode auto : jamais Fable ; xhigh vient de la ligne « Jugement » d’un ticket, que le mod de la session applique le temps du ticket. '
