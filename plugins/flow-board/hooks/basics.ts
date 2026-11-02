// Petits outils du modèle de flow-board : copie, textes, dates, journal, comptes, lectures simples du
// tableau de bord, et la règle qui coupe les choix « décidé sans toi » avec leur origine. Module
// feuille : il n'importe ni le modèle, ni le relais, ni le lien, que ces modules importent (un test le
// vérifie).

import type { Board, DecisionOrigin, FlowPhase, FlowStep, Run, SecurityCheck, Ticket, TicketGroup, TicketStatus, Tone } from '../types'
import { asciiJson, isGroupId, neutralRelayed } from './closing.ts'

/** Longueur gardée d'un texte affiché en entier (élément, ticket, raison, choix, entrée du journal). */
export const TEXT_MAX = 300

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
  /** Missions archivées gardées par projet, au-delà des 15 missions vivantes. */
  archived: 100,
  decided: 30,
  /** Les choix gardés d'une mission qui a été en auto, une fois son rapport validé. */
  autoDecided: 200,
} as const

/** Ce que l'interface doit jouer après une transition. */
export type Effects = {
  toasts: string[]
  openPane: boolean
  /** Note à ajouter au texte du skill pour Claude : celle d'une phase, d'un détour, ou rien. */
  note: 'none' | 'phase' | 'detour'
  /**
   * Le titre que cette discussion doit prendre : le mod le garde pour elle seule, hors du board
   * partagé, et le renvoie au moteur au prochain message ou à la reprise.
   */
  discussionTitle?: string
}

export type Outcome = { board: Board; fx: Effects } | null

export const noFx = (): Effects => ({ toasts: [], openPane: false, note: 'none' })

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const clip = (text: string, max: number): string =>
  max <= 0 ? '' : text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`

export const str = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

export const activeRun = (board: Board | null | undefined): Run | null =>
  board?.activeId ? (board.runs.find(r => r.id === board.activeId && r.status === 'active') ?? null) : null

export const currentPhase = (run: Run): FlowPhase => run.phases[Math.min(run.cursor, run.phases.length - 1)]!

export const isAllDone = (run: Run, ids: readonly string[]): boolean =>
  ids.length > 0 && ids.every(id => run.tickets.find(t => sameTicket(t.id, id))?.status === 'done')

/**
 * La date de revue d'un groupe ou d'un lot, relue par une seule règle : une date que `isTime` accepte,
 * sinon rien (null, texte, négative, hors de ce que Date sait écrire : jamais « relu »).
 */
export const reviewTimeOf = (x: { reviewedAt?: unknown }): number | undefined => (isTime(x.reviewedAt) ? x.reviewedAt : undefined)

/** Un groupe relu par /code-review : sa date de revue, relue hors forme, ne compte pas. */
export const hasGroupReview = (g: TicketGroup): boolean => reviewTimeOf(g) !== undefined

/**
 * La sécurité d'un groupe (ou du lot) est tranchée : relue avec chacune de ses failles gardées
 * corrigée ou laissée par la personne, ou, sans comptes rendus, jugée inutile (`/security-review`
 * pose `ranAt` sur les groupes finis, même ceux qu'il ne visait pas, `markSecured`). Un avis absent, une revue
 * conseillée pas lancée, ou lancée sans comptes rendus, ne l'est pas.
 */
export const isSecuritySettled = (check: SecurityCheck | undefined): boolean => {
  if (!check || typeof check !== 'object' || hasUnreadableCounts(check)) return false
  if (check.findings !== undefined) return check.findings <= (check.fixed ?? 0) + (check.dismissed ?? 0)
  return check.isAdvised === false
}

/** Le plus grand compte de sécurité plausible, à l'envoi comme à la relecture (relais compris). */
export const SECURITY_COUNT_MAX = 10_000

/** Un compte de sécurité en forme : un entier de 0 à 10 000, sans arrondi (-0,4 n'est pas 0). */
export const isSecurityCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= SECURITY_COUNT_MAX

/**
 * Un compte de bogues en forme (`review.bugs`, la passe « bogues ») : la règle d'un compte de sécurité,
 * la même à l'envoi (discussion de la mission, relais) et à la lecture du relais. Hors forme, il est ignoré,
 * jamais lu 0 : 0 dirait une passe faite sans bogue.
 */
export const isBugCount = isSecurityCount

/** La borne d'un compte de bogues, écrite pour la réponse : « 10 000 ». */
export const BUGS_MAX = String(SECURITY_COUNT_MAX).replace(/\B(?=(\d{3})+$)/g, ' ')

/** Pourquoi un compte de bogues est ignoré, dans la réponse de l'outil. */
export const BUGS_REFUSED = `not a whole number from 0 to ${BUGS_MAX}`

/** Les bogues d'une ligne de journal de revue, ou rien sans passe « bogues » : « · 2 bogues (passe « bogues ») ». */
export const bugsText = (bugs: number | undefined): string => (bugs === undefined ? '' : ` · ${bugs} bogue${bugs > 1 ? 's' : ''} (passe « bogues »)`)

/**
 * Les comptes présents mais hors forme d'un avis de sécurité : envoyé (refusé), relu du tableau de
 * bord ou venu du relais (un fichier partagé ; jamais tranché, `closeMissing` le dit).
 */
export const unreadableCounts = (check: { findings?: unknown; fixed?: unknown; dismissed?: unknown }): string[] =>
  (['findings', 'fixed', 'dismissed'] as const).filter(k => check[k] !== undefined && !isSecurityCount(check[k]))

/** Un avis de sécurité dont un compte est hors forme : dans le doute, il n'est pas tranché. */
export const hasUnreadableCounts = (check: SecurityCheck): boolean => unreadableCounts(check).length > 0

/** Une date relue (relais, tableau de bord) : un nombre fini que `Date` sait écrire. */
export const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8.64e15

export const countTickets = (tickets: readonly Ticket[]) => ({
  total: tickets.length,
  done: tickets.filter(t => t.status === 'done').length,
  doing: tickets.filter(t => t.status === 'doing').length,
  blocked: tickets.filter(t => t.status === 'blocked').length,
  todo: tickets.filter(t => t.status === 'todo').length,
})

export const log = (run: Run, now: number, glyph: string, text: string, tone: Tone = 'info') => {
  run.log = [{ at: now, glyph, text: clip(text, TEXT_MAX), tone }, ...run.log].slice(0, LIMITS.log)
}

/**
 * Ouvre l'étape `id` ; une étape active d'après redevient à faire. Avant elle, l'étape qui était
 * en cours passe faite. Les étapes jamais atteintes passent faites quand Claude a signalé l'étape
 * lui-même (`isReported`), sautées quand le saut est déduit d'un signal (commit, tests, sous-skill).
 */
export const setStep = (target: { steps: FlowStep[] }, id: string, now: number, isReported = false): boolean => {
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

export const TICKET_STATUSES: readonly TicketStatus[] = ['todo', 'doing', 'done', 'blocked']

export const asList = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((one): one is Record<string, unknown> => typeof one === 'object' && one !== null)
    : []

export type StatusChange = { id: string; status: TicketStatus; why?: string }

export const parseChanges = (value: unknown): StatusChange[] =>
  asList(value)
    .map(c => ({ id: str(c.id), status: str(c.status) as TicketStatus, why: clip(str(c.why), TEXT_MAX) || undefined }))
    .filter(c => c.id !== '' && TICKET_STATUSES.includes(c.status))

/** `#12`, `12` et `012` désignent le même ticket. */
export const sameTicket = (a: string, b: string): boolean => {
  if (a === b) return true
  const na = a.replace(/^#/, '').replace(/^0+(?=\d)/, '')
  const nb = b.replace(/^#/, '').replace(/^0+(?=\d)/, '')
  return na !== '' && na === nb
}

/**
 * Date UTC à la minute : `2026-10-06 10:40`. Une date relue (relais, tableau de bord) peut être
 * abîmée : une date que `isTime` refuse (négative comprise) se dit « date inconnue » plutôt qu'une
 * exception ou une date d'avant 1970.
 */
export const isoMinute = (ms: number): string => (isTime(ms) ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : 'date inconnue')

/**
 * Première ligne « Statut : » d'une tâche Asana -> statut du ticket ; un blocage garde le texte
 * de la ligne comme raison (« à confirmer (porteur) »).
 */
export const statusLine = (notes: unknown): { status: TicketStatus; why?: string } | undefined => {
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
export const asanaChange = (t: Record<string, unknown>): StatusChange | null => {
  const id = typeof t.task === 'string' ? t.task : ''
  if (id === '') return null
  if (t.completed === true) return { id, status: 'done' }
  if (t.completed === false) return { id, status: 'todo' }
  const line = statusLine(t.notes)
  return line ? { id, ...line } : null
}

/** Le groupe enregistré qu'un id renvoyé désigne : le même id, sinon le seul qui ne diffère que de casse. */
export const recordedGroup = (run: Run, id: string): TicketGroup | undefined => {
  const groups = run.groups ?? []
  const exact = groups.find(g => g.id === id)
  if (exact) return exact
  // Relu d'un fichier partagé, un id enregistré qui n'est pas une chaîne n'est l'id de personne.
  const near = groups.filter(g => typeof g.id === 'string' && g.id.toLowerCase() === id.toLowerCase())
  return near.length === 1 ? near[0] : undefined
}

/**
 * Le groupe qu'un id envoyé à l'outil désigne : d'abord l'id enregistré égal à la valeur brute, sans
 * rognage ni casse (« A » avec un blanc, quand il est enregistré, ne s'inscrit jamais sur « A ») ; sinon
 * comme `recordedGroup` (un id envoyé avec un blanc qu'aucun groupe ne porte se lit rogné).
 * Une valeur qui n'est ni une chaîne ni un nombre ne désigne aucun groupe.
 */
export const sentGroupOf = (run: Run, raw: unknown): TicketGroup | undefined => {
  if (typeof raw === 'string') {
    const exact = (run.groups ?? []).find(g => g.id === raw)
    if (exact) return exact
  }
  const id = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? str(raw) : ''
  return id !== '' ? recordedGroup(run, id) : undefined
}

/** Un nom de groupe dans une réponse de l'outil, neutralisé ; relu autrement qu'en chaîne, échappé en JSON (rien ne tombe). */
export const shownGroupName = (name: unknown): string => (typeof name === 'string' ? neutralRelayed(name) : asciiJson(name))

/** Un id de groupe dans une réponse de l'outil : tel quel en forme, sinon échappé en JSON (exact, distinct, sans rien glisser). */
export const shownGroupId = (id: unknown): string => (isGroupId(id) ? id : asciiJson(id))

/** Les choix gardés d'une mission qui a été en auto, une fois son rapport validé ; le seuil de la pause de l'auto. */
export const AUTO_CHOICES_MAX = LIMITS.autoDecided

/** Les origines d'un choix, telles que le rapport et le fichier des choix les disent. */
export const ORIGIN_LABELS: Record<DecisionOrigin, string> = {
  recommendation: 'reco prise',
  'skipped-validation': 'validation sautée',
  'linked-session': 'choix de worker',
}

/** L'origine relue d'un choix : une des trois, sinon aucune. */
export const originOf = (value: unknown): DecisionOrigin | undefined =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ORIGIN_LABELS, value) ? (value as DecisionOrigin) : undefined

/** La mission a été en auto : son état auto est là, même éteint, et même abîmé (dans le doute, rien n'est coupé). */
export const hasBeenAuto = (run: Run): boolean => run.auto !== undefined

/**
 * Le compte rendu de la mission est validé par la personne (« ✓ Valider le rapport ») : sa marque, que
 * seule la validation pose (une clôture ou une suite proposée finit aussi la phase, sans elle), égale
 * à la fin de la dernière phase de compte rendu (rouverte, puis finie autrement, son rapport est à
 * valider de nouveau).
 */
export const isReportValidated = (run: Run): boolean => {
  const report = run.phases.filter(p => p.skill === 'compte-rendu').at(-1)
  // La marque est la fin même de la phase que « ✓ Valider le rapport » a finie : rouverte, puis finie
  // autrement (une clôture), sa fin change et la marque ne vaut plus, quelle que soit l'horloge.
  return isTime(run.reportValidatedAt) && report?.status === 'done' && report.finishedAt === run.reportValidatedAt
}

/**
 * La place des choix d'une mission, la règle de toutes les coupes : les 30 plus récents hors auto ;
 * pour une mission qui a été en auto, aucune coupe avant la validation du rapport (null), les 200 plus
 * récents ensuite.
 */
export const choiceRoom = (run: Run): number | null => (!hasBeenAuto(run) ? LIMITS.decided : isReportValidated(run) ? AUTO_CHOICES_MAX : null)

/** Une liste de choix coupée à sa place (les plus récents), ou entière quand rien ne se coupe. */
export const keepChoices = <T,>(list: readonly T[], room: number | null): T[] => (room === null ? [...list] : list.slice(-room))

