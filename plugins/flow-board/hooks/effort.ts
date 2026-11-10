// La règle d'effort des workers, en un seul endroit : le mod calcule l'effort de chaque groupe et
// l'écrit sur sa ligne de la demande de lancement (Claude n'y juge que le choix de conception restant, et propose Fable 5.2 high ou Opus xhigh hors auto),
// et il l'applique lui-même à un manager qui fait le travail d'un worker (un lot
// sans groupes, un départ `/implement` ou `/tdd`, un diagnostic de bug), requête par requête. Un
// changement de la règle vaut ainsi pour les deux. Un ticket sensible ne compte pas au lancement : le
// mod d'un worker passe en high au moins chaque requête faite pendant un ticket sensible en cours
// (`workerTicketEffort`), et un lot sans groupes de même. Hors de ce travail, l'effort d'une requête suit le
// rôle et la phase (`leadEffort`) : le COO en medium ; le manager d'une mission à groupes en medium de
// la fin du découpage au début du compte rendu ; un manager en cadrage sur Fable 5.2 medium, quand le mod
// peut réécrire le modèle (sinon high au moins) ; high au moins dans toute autre phase d'un manager.
// Ni xhigh ni le worker Fable ne sont jamais choisis par le mod : ils se proposent, jamais en auto.
//
// Module pur.

import type { Run, Ticket } from '../types'
import { currentPhase, sameTicket } from './basics.ts'
import { isSafeId } from './closing.ts'
import { activeDetour } from './model.ts'

/** L'effort d'une requête que le mod peut imposer : jamais xhigh. */
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
 * logique (`isNoLogic`, l'option fusion) ; sinon l'effort calculé (`ticketsEffort` de ses tickets ouverts et
 * des fichiers qu'il déclare) et ses raisons. Des textes fixes seulement : aucun nom ni chemin de ticket n'y entre.
 */
export const groupLaunchNote = (open: readonly Ticket[], files: readonly string[], imposed: ImposedEffort | undefined, isNoLogic: boolean): string => {
  if (imposed === 'fable') return ' — Fable 5.2 high, imposé'
  if (imposed) return ` — effort : ${imposed}, imposé`
  if (isNoLogic) return ' — Sonnet high, sans logique'
  const x = ticketsEffort(open, files)
  return ` — effort calculé : ${x.level}${x.reasons.length > 0 ? ` (${x.reasons.join(', ')})` : ''}`
}

/** Les phases où un manager fait le travail d'un worker de groupe, quand sa mission n'a pas de groupes. */
const LOT_PHASES = new Set(['implement', 'tdd'])

/**
 * L'effort que prend un manager qui fait lui-même le travail d'un worker, par la règle de ce worker,
 * d'après ce sur quoi il travaille (le détour actif d'abord) : celle d'un worker de groupe pour un lot
 * (mission sans groupes en `/implement` ou `/tdd`, tant qu'un ticket reste ouvert : high pendant un ticket
 * « doing » sensible, ou qui ne dit pas s'il l'est, comme le mod d'un worker ; sinon l'effort calculé sur
 * les tickets ouverts, sans le critère « sensible »), celle d'un worker de diagnostic pour
 * `/diagnosing-bugs` (un plancher : high au moins, un effort plus haut de la discussion, comme la deuxième
 * tentative d'un worker de diagnostic en xhigh, reste). Rien hors de ce travail.
 */
export const managerWorkEffort = (run: Run): { level: WorkerEffort; rule: 'group' | 'diagnosis' } | null => {
  if (run.status !== 'active') return null
  const phase = currentPhase(run)
  if (phase.status !== 'active') return null
  const skill = activeDetour(phase)?.skill ?? phase.skill
  if (skill === 'diagnosing-bugs') return { level: diagnosisEffortLevel(), rule: 'diagnosis' }
  if (!LOT_PHASES.has(skill) || (run.groups ?? []).length > 0) return null
  const open = run.tickets.filter(t => t.status !== 'done')
  // Le lot fini (revue du lot, compte rendu encore dans la phase) : plus le travail d'un worker.
  if (run.tickets.length > 0 && open.length === 0) return null
  const isSensitiveDoing = run.tickets.some(t => t.status === 'doing' && t.sensitive !== false)
  return { level: isSensitiveDoing ? 'high' : ticketsEffort(open).level, rule: 'group' }
}

/** Un id de ticket que le bandeau peut écrire tel quel : la forme de `isSafeId`, bornée à 24 signes ; sinon il se tait. */
const isShownId = (id: string): boolean => isSafeId(id) && id.length <= 24

/**
 * L'effort qu'impose le mod d'un worker de groupe à une requête de son fil principal, d'après ses tickets
 * en cours (`doing` : ceux que son relais dit « doing » ; null quand son relais ne se lit pas) et la mission
 * pour laquelle il travaille (`mission`, absente quand elle ne se lit pas) : high au moins (un effort plus
 * haut de la session reste) pendant un ticket sensible, ou dont la sensibilité ne se lit pas (ticket muet,
 * absent de la mission, mission ou relais illisible) ; rien d'imposé sans ticket en cours, ni pendant un
 * ticket dit non sensible. `ticket` : celui qui l'impose, pour le bandeau ; `isUnknown` : sa sensibilité
 * ne se lit pas.
 */
export const workerTicketEffort = (doing: readonly string[] | null, mission: Run | undefined): LeadEffort | null => {
  const high = (ticket: string | undefined, isUnknown: boolean): LeadEffort => ({
    level: 'high',
    rule: 'sensitive',
    how: 'floor',
    ...(ticket !== undefined && isShownId(ticket) ? { ticket } : {}),
    ...(isUnknown ? { isUnknown: true } : {}),
  })
  if (doing === null) return high(undefined, true)
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
 * compte rendu, rétrospective, toute autre phase), ou un ticket sensible en cours chez un worker.
 */
export type LeadRule = 'group' | 'diagnosis' | 'coo' | 'groups' | 'framing' | 'report' | 'retro' | 'other' | 'sensitive' | 'fable' | 'fableOff'

/**
 * Comment l'effort se pose : `exact`, l'effort de la règle quel que soit celui de la discussion (un lot,
 * jamais xhigh) ; `floor`, high au moins, un effort plus haut restant ; `medium`, medium imposé (low et
 * high ramenés à medium), xhigh et max laissés, un choix délibéré de la personne. `ticket` et `isUnknown` :
 * pour la règle `sensitive`, le ticket en cours qui l'impose et si sa sensibilité ne se lit pas. `model` :
 * le modèle imposé à la requête (Fable 5.2, `FABLE_MODEL`), toujours avec un effort `exact` ; absent, la
 * requête garde le sien. `level` xhigh : seulement le repli d'un worker Fable quand Fable est indisponible
 * (`FABLE_OFF_WORKER_EFFORT`), le remplaçant d'Opus xhigh que Mathis a choisi ; jamais autrement.
 */
export type LeadEffort = { level: WorkerEffort | 'xhigh'; rule: LeadRule; how: 'exact' | 'floor' | 'medium'; ticket?: string; isUnknown?: true; model?: typeof FABLE_MODEL }

/**
 * Le modèle que le mod impose à une requête du fil principal : l'alias `fable`, Fable 5.2 depuis Claude Code
 * 2.1.321 (celui que la sonde de `docs/evenements-moteur.md`, « Modèle réécrit par `turn.step` », a essayé).
 */
export const FABLE_MODEL = 'fable'

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

/** Les phases de cadrage d'un manager (grilling et ses variantes, spec, découpage). */
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
 * L'effort qu'impose le mod à une requête du fil principal d'un manager, mission active ici : la règle
 * d'un worker quand il en fait le travail (`managerWorkEffort`, inchangée, sur le modèle de la session) ;
 * Fable 5.2 en medium exact pendant la fenêtre du cadrage (`isFramingWindow`), quand `isFableOn` dit que
 * le mod peut réécrire le modèle (pas de `/model` tapé, Fable pas éteint, la requête sur le modèle de la
 * session) ; medium pendant le suivi des groupes d'une mission à groupes ; sinon high au moins, avec la
 * raison de la phase. Rien sans mission active (`null`). Le COO, qui n'a pas de mission, a `COO_EFFORT`.
 * Sans `isFableOn`, jamais de modèle : dans le doute, la requête garde le sien.
 */
export const leadEffort = (run: Run | null, isFableOn = false): LeadEffort | null => {
  if (!run || run.status !== 'active') return null
  const work = managerWorkEffort(run)
  if (work) return { level: work.level, rule: work.rule, how: work.rule === 'group' ? 'exact' : 'floor' }
  if (isFableOn && isFramingWindow(run)) return { level: 'medium', rule: 'framing', how: 'exact', model: FABLE_MODEL }
  // Un cadrage en cours, en détour (/grilling sur une question remontée) ou en phase active, passe avant le suivi des groupes.
  const phase = currentPhase(run)
  const framing = activeDetour(phase)?.skill ?? (phase.status === 'active' ? phase.skill : null)
  if (framing !== null && FRAMING.has(framing)) return { level: 'high', rule: 'framing', how: 'floor' }
  if (isGroupsFollowUp(run)) return { level: 'medium', rule: 'groups', how: 'medium' }
  const skill = phase.skill
  const rule: LeadRule = FRAMING.has(skill) ? 'framing' : skill === 'compte-rendu' ? 'report' : skill === 'retro' ? 'retro' : 'other'
  return { level: 'high', rule, how: 'floor' }
}

/** Les niveaux d'effort nommés ; un effort relevé hors de cette liste (un budget numérique) part tel quel. */
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * L'effort qui part, d'après la règle et l'effort de la requête : un lot impose son niveau même sur un
 * effort numérique (un budget) ; les autres règles laissent tel quel un effort hors de `EFFORT_LEVELS`,
 * nombre ou texte (le registre et le relevé du COO gardent un budget en texte : « 32000 »).
 */
export const effortSent = <E extends string | number>(x: LeadEffort, current: E): E | WorkerEffort | 'xhigh' =>
  x.how === 'exact'
    ? x.level
    : typeof current !== 'string' || !EFFORT_LEVELS.has(current)
      ? current
      : x.how === 'floor'
      ? current === 'low' || current === 'medium'
        ? 'high'
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
  report: 'compte rendu',
  retro: 'rétrospective',
  other: 'règle du manager',
  sensitive: 'ticket sensible en cours',
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

/**
 * Le texte du bandeau : l'effort imposé et sa raison (« effort : medium, suivi des groupes »), espaces comprises ;
 * avec un modèle imposé, le modèle d'abord (« modèle : Fable 5.2 medium, cadrage »).
 */
const leadEffortText = (x: LeadEffort): string =>
  x.model
    ? `modèle : Fable 5.2 ${x.level}, ${LEAD_REASON[x.rule]}`
    : `effort${x.rule === 'group' ? ' du lot' : x.rule === 'diagnosis' ? ' du diagnostic' : ''} : ${x.level}, ${x.rule === 'sensitive' ? sensitiveReason(x) : LEAD_REASON[x.rule]}`

/**
 * Le texte du bandeau quand la règle joue : un lot et un diagnostic se disent toujours, comme avant ;
 * les autres règles, seulement quand l'effort qui part diffère de l'effort relevé de la discussion (le
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

/** Le quota cité dans la question d'effort xhigh et sous un xhigh imposé : relevé à l'écriture de la demande. */
const QUOTA_NOTE = (quota: string): string =>
  `le quota de cette discussion, relevé à l'écriture de cette demande (${quota}) : une session xhigh l'use vite, et une limite atteinte arrête le worker en plein travail`

// ─── Les textes de la règle, donnés à Claude dans le brief d'un worker de groupe ──────────────

/**
 * Le chemin qu'un bouton du tableau de bord impose à la session d'un groupe : `xhigh` (« ↗ xhigh », Opus
 * xhigh) ou `fable` (« ↗ Fable », le worker Fable : Fable 5.2 high par son mod) ; sans lui, Claude le choisit.
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

/** Les deux questions à boutons d'un groupe de jugement, telles que la personne les lit. */
export const FABLE_QUESTION = '« Fable 5.2 high (Recommandé) / Opus high »'
export const XHIGH_QUESTION = '« Opus xhigh (Recommandé) / Opus high »'

/**
 * Le modèle Sonnet d'un worker de groupe sans logique (option fusion), écrit une seule fois : l'id que prend
 * `model` de `start_session` dans l'app (un modèle de la même famille ou moins cher que celui de la
 * discussion ; un plus cher est ignoré) et l'alias de `--model` de `claude --bg`. À revoir à la sortie d'un
 * nouveau Sonnet : l'alias suit seul le dernier Sonnet, l'id non.
 */
export const SONNET_APP_ID = 'claude-sonnet-5-5'
export const SONNET_CLI_ALIAS = 'sonnet'

/**
 * Comment lancer un groupe sans logique : Sonnet en high, dans l'app comme dans le CLI ; les autres groupes
 * ne reçoivent aucun modèle et héritent de celui de la discussion (Opus), comme un groupe que la personne fait
 * passer en xhigh par la question à boutons. Dit seulement quand la demande en porte un, et jamais sous un effort imposé.
 */
export const SONNET_LAUNCH_FR =
  `Un groupe annoncé « Sonnet high » part sur Sonnet : model "${SONNET_APP_ID}" et effort "high" dans start_session, --model ${SONNET_CLI_ALIAS} --effort high dans claude --bg ; aucun modèle pour les autres groupes, ni pour un groupe que je fais passer en Opus xhigh (ils partent sur celui de cette discussion : une tâche de jugement ne va jamais à Sonnet). `

/**
 * Ce que dit la consigne d'effort, hors effort imposé : l'effort se lit sur la ligne du groupe
 * (`groupLaunchNote`) ; Claude ne juge que ce que le mod ne sait pas, un choix de conception restant (high),
 * et dit l'effort pris et tout écart ; un ticket sensible ne compte pas, le mod de la session la passant en
 * high pendant ce ticket. Les critères du calcul et l'arbitrage high / xhigh vivent dans la section 11 de la
 * procédure, dans son annexe pour le manager, citée par `effortFile` (le chemin de `reference/effort-workers.md`).
 */
const CALCULATED_EFFORT = (many: boolean, effortFile: string): string =>
  `Effort de ${many ? 'chaque session (<effort>)' : 'la session (<effort>)'} : l’effort calculé sur la ligne ${many ? 'de son' : 'du'} groupe ; high si un choix de conception reste à faire ${many ? 'à son' : 'au'} groupe. ` +
  'Pendant un ticket sensible, le mod de la session la passe lui-même en high : ne relève pas son effort pour ce ticket. ' +
  `Dis-moi en une ligne${many ? ', pour chaque groupe,' : ''} l'effort pris et, s'il s'écarte du calcul, pourquoi. ` +
  `Critères du calcul, tâche de jugement et arbitrage high / xhigh : section 11 de ${effortFile}, à lire avant de lancer. `

/**
 * L'effort d'une session de groupe : celui que calcule le mod (medium par défaut, high pour un groupe
 * délicat), high pour un choix de conception restant ; pour une tâche de jugement, l'un des deux chemins
 * proposé par une question à boutons, jamais choisi par Claude seul : Fable 5.2 high pour un jugement de
 * code (`FABLE_QUESTION`), Opus xhigh pour un jugement sur la sécurité, un document lu par d'autres ou du
 * design (`XHIGH_QUESTION`). Imposé par un bouton (« ↗ xhigh », « ↗ Fable »), sans question. `quota`
 * (`quotaText`, les fenêtres du compte, pas la part de Fable) : cité dans la question xhigh, ou avant un
 * lancement en xhigh imposé ; null, rien n'en est dit.
 */
export const GROUP_EFFORT = (many: boolean, imposed: ImposedEffort | undefined, current: string | undefined, effortFile: string, quota: string | null = null): string =>
  imposed === 'fable'
    ? `Effort de ${many ? 'chaque session (<effort>)' : 'la session (<effort>)'} : high, pour le worker Fable (Fable 5.2 high, choisi par moi au tableau de bord ; ne me pose aucune question sur l'effort). ${FABLE_LAUNCH(many)}`
    : imposed
      ? `Effort de ${many ? 'chaque session (<effort>)' : 'la session (<effort>)'} : ${imposed}, choisi par moi au tableau de bord ; ne me pose aucune question sur l'effort${quota ? ` ; en lançant, cite-moi en une ligne, sans attendre de réponse, ${QUOTA_NOTE(quota)}` : ''}. ${XHIGH_LAUNCH(many, current)}`
      : CALCULATED_EFFORT(many, effortFile) +
        `Tu ne choisis jamais toi-même ni Fable ni xhigh : quand un ticket ${many ? 'de son' : 'du'} groupe est une tâche de jugement (jamais pour une tâche d'exécution), avant de lancer, pose-moi une question à boutons${many ? ' par groupe concerné, quatre au plus par encadré, chacune' : ''} avec une ligne qui nomme le ticket et la sorte de jugement : ` +
        `${FABLE_QUESTION} pour un jugement de code ; ${XHIGH_QUESTION} pour un jugement sur la sécurité, un document lu par d'autres ou du design${quota ? `, avec une ligne qui cite ${QUOTA_NOTE(quota)}` : ''} ; cette question est permise, le bouton cliqué n'ayant pas fixé l'effort. ` +
        `Si je réponds Fable 5.2 high : ${FABLE_LAUNCH(many)} ` +
        `Si je réponds Opus xhigh : ${XHIGH_LAUNCH(many, current)}`

/**
 * L'effort d'une session de groupe lancée par le mode auto : la même règle sans Fable ni xhigh ni leurs
 * questions, l'absence de proposition déclarée.
 */
export const AUTO_GROUP_EFFORT = (many: boolean, effortFile: string): string =>
  CALCULATED_EFFORT(many, effortFile) +
  `La mission est en mode auto : jamais Fable ni xhigh ; ne me pose aucune des deux questions d'effort (${FABLE_QUESTION}, ${XHIGH_QUESTION}) ; quand un ticket relèverait de l'un des deux chemins (une tâche de jugement), lance-le sur Opus en high et déclare dans decided que ni Fable ni xhigh n’ont été proposés. `
