// Suivi des requêtes de la discussion : chaque message de l'utilisateur ouvre une requête, qui
// compte ses appels au modèle (tokens, coût au tarif, durée API, temps de génération), ceux de ses
// sous-agents, et sa durée réelle, de l'envoi à la fin de son dernier tour, tours relancés par ses
// tâches de fond compris. Les mots sont ceux de `GLOSSARY.md` ; l'ordre des événements et la
// filiation, ceux de `docs/evenements-moteur.md` (« Ordre des événements », « Filiation »).
//
// Même filiation que le chrono de session-tools (`plugins/session-tools/hooks/register.tsx`), à
// garder alignés à la main, ici et dans register.tsx : un prompt reçu au repos retrouve son
// `turn.start` par le texte (`prompt.submit` rend la main après) ; les origines d'un message de
// l'utilisateur (`USER_ORIGINS`, `fromUser`) ; une notification reconnue par son origine
// (`task-notification` et son `<task-id>`, `peer` et son `<agent-message from>`), ou par son seul texte
// après un rechargement ; un agent rattaché à son premier `agent.spawn` ; une tâche de fond à sa
// première apparition dans `background_tasks` ; la fin quand le fil principal est au repos et que la
// dernière liste n'a plus de tâche de la requête ; sur une interruption ou une erreur (sans
// `classic.Stop`), les tâches connues plus les agents `running`, `pending` ou `waiting` ; une
// requête finie normalement jamais rouverte par une tâche inconnue. Le chrono ne suit que la dernière
// requête, ce module toutes : une règle changée d'un côté se change de l'autre, puis dans la doc.
//
// Des fonctions pures sur un `Tracker`, gardé par l'hôte (`$.state`) : register.tsx leur passe les
// événements du moteur et écrit le relevé (`RequestLog`) dans le fichier de la session. Aucun texte
// de message ici : le début du message reste dans une variable de register.tsx.

import type { CallStats, RequestLog, RequestRecord, Tracker } from '../types'
import { estimateUnknown, isPriced, priceOf, trackedUnits, type CallUsage } from './pricing.ts'

/** Format du fichier de relevé (`RequestLog.schema`). */
export const REQUEST_SCHEMA = 1

/** Le dossier des relevés, sous le dossier de Claude Code : un fichier par ouverture de session. */
export const REQUESTS_DIR = 'stats-board/requetes'

/** Le travail hors de toute requête (tâche planifiée, message d'une autre session) : l'entrée `outside` du relevé. */
export const OUTSIDE = 0

export const EMPTY_TRACKER: Tracker = { log: null, current: null, turns: {}, agents: {}, tasks: {}, running: [], interrupted: [] }

/** Un appel au modèle tel que `turn.step` le donne : le modèle qui a répondu, ses tokens, ses durées. */
export type Call = { model: string; usage: CallUsage; apiMs: number; genMs: number }

/**
 * Ce qui relance un tour du fil principal sans message de l'utilisateur : la notification d'une
 * tâche (`task`, son id), le message de retour d'un agent (`peer`, son id), une simple reprise du
 * travail en cours (`continue` : relance sans texte, `auto-continuation`), ou autre chose (`other` :
 * tâche planifiée, canal…).
 */
export type Relaunch = { kind: 'task' | 'peer' | 'continue' | 'other'; id: string | null }

/** Le fichier d'une ouverture de session : son id (sans caractère interdit dans un nom de fichier) et l'heure d'ouverture, en ms. */
export const requestFile = (session: string, openedAt: number): string => `${session.replace(/[^A-Za-z0-9_-]/g, '_')}_${openedAt}.json`

const emptyStats = (): CallStats => ({ calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, apiMs: 0, genMs: 0, cost: 0, isEstimated: false, speeds: {} })

/** La classe de vitesse d'un appel (10 tokens/s de large), ou null sans génération mesurée. */
export const speedClass = (output: number, genMs: number): string | null => {
  const speed = output > 0 ? weightedSpeed(output, genMs) : null
  return speed === null ? null : String(Math.floor(speed / 10) * 10)
}

/** Une vitesse : des tokens générés sur leur temps de génération, en tokens/s ; null sans génération. */
export const weightedSpeed = (output: number, genMs: number): number | null => (genMs > 0 ? (output * 1000) / genMs : null)

/** Des vitesses par classes ajoutées à d'autres (en place). */
export function mergeSpeeds(into: Record<string, number>, from: Readonly<Record<string, number>> | undefined): Record<string, number> {
  for (const [k, n] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + n
  return into
}

/**
 * L'entrée `key` d'une table du suivi, seulement si elle lui est propre : un identifiant tiré d'un
 * texte (`constructor`, `__proto__`) ne doit jamais rendre une propriété héritée d'objet.
 */
const ownOf = <T,>(table: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined)

/** Pose l'entrée `key` comme propriété propre, même pour `__proto__` (qu'une affectation ignorerait). */
const setOwn = <T,>(table: Record<string, T>, key: string, value: T): void => {
  Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true })
}

/** Les listes du suivi, vides quand l'état d'un chargement d'avant les a écrites sans elles. */
const listsOf = (t: Tracker) => ({ agents: t.agents ?? {}, tasks: t.tasks ?? {}, running: t.running ?? [], interrupted: t.interrupted ?? [] })

const changeRequest = (t: Tracker, id: number, change: (r: RequestRecord) => RequestRecord): Tracker =>
  t.log ? { ...t, log: { ...t.log, requests: t.log.requests.map((r) => (r.id === id ? change(r) : r)) } } : t

/** Le nombre de tâches de fond encore en cours de chaque requête, d'après la dernière liste. */
function recount(t: Tracker): Tracker {
  if (!t.log) return t
  const { tasks, running } = listsOf(t)
  const count = new Map<number, number>()
  for (const id of running) {
    const owner = ownOf(tasks, id)
    if (owner !== undefined) count.set(owner, (count.get(owner) ?? 0) + 1)
  }
  return { ...t, log: { ...t.log, requests: t.log.requests.map((r) => ((count.get(r.id) ?? 0) === (r.tasks ?? 0) ? r : { ...r, tasks: count.get(r.id) ?? 0 })) } }
}

/** La fin du travail du fil principal pour une requête, à `at` : sa durée réelle va jusque-là. */
const close = (r: RequestRecord, at: number): RequestRecord => {
  const endedAt = Math.max(r.endedAt ?? r.sentAt, at)
  return { ...r, endedAt, realMs: endedAt - r.sentAt, isOpen: false }
}

/** La requête pour laquelle travaille le fil principal en ce moment : celle du tour en cours, à défaut la dernière ouverte. */
export const ownerNow = (t: Tracker): number | null => (t.active !== undefined ? (ownOf(t.turns, t.active) ?? t.current) : t.current)

/**
 * Un message de l'utilisateur ouvre une requête. Une autre session (après `/clear`) commence un
 * nouveau relevé, ouvert à `now`. Envoyé pendant un tour (`turnId`), le message clôt à cet instant
 * le travail du fil principal pour la requête d'avant : le reste du tour revient à la nouvelle.
 */
export function openRequest(t: Tracker, o: { session: string; project: string | null; at: number; now: number; turnId?: string }): Tracker {
  const isSame = t.log !== null && t.log.session === o.session
  const log: RequestLog = isSame ? t.log! : { schema: REQUEST_SCHEMA, session: o.session, openedAt: o.now, project: o.project, requests: [], outside: {} }
  let next: Tracker = isSame ? t : { ...EMPTY_TRACKER, log }
  const previous = next.current !== null ? next.log!.requests.find((r) => r.id === next.current) : undefined
  if (previous?.isOpen) next = changeRequest(next, previous.id, (r) => close(r, o.turnId ? o.at : (r.endedAt ?? o.at)))
  // Le tour en cours peut travailler pour une autre requête (rouverte par sa tâche) : elle s'arrête aussi.
  const ofTurn = o.turnId !== undefined ? ownOf(next.turns, o.turnId) : undefined
  if (ofTurn !== undefined && ofTurn !== OUTSIDE && ofTurn !== previous?.id) next = changeRequest(next, ofTurn, (r) => (r.isOpen ? close(r, o.at) : r))
  const id = next.log!.requests.length + 1
  const request: RequestRecord = { id, sentAt: o.at, endedAt: null, realMs: 0, isOpen: true, tasks: 0, apiMs: 0, agents: 0, models: {} }
  return {
    ...next,
    log: { ...next.log!, requests: [...next.log!.requests, request] },
    current: id,
    turns: o.turnId ? { ...next.turns, [o.turnId]: id } : next.turns,
  }
}

/** Le tour `turnId` du fil principal commence et travaille pour la requête `id` (ou hors requête) : elle reprend. */
export function startTurn(t: Tracker, turnId: string, id: number): Tracker {
  const next = { ...t, turns: { ...t.turns, [turnId]: id }, active: turnId }
  return id === OUTSIDE ? next : changeRequest(next, id, (r) => ({ ...r, isOpen: true }))
}

/** La requête pour laquelle travaille le tour `turnId` du fil principal, s'il en a une (0 : hors requête). */
export const requestOfTurn = (t: Tracker, turnId: string): number | undefined => ownOf(t.turns, turnId)

/**
 * La requête d'un tour relancé sans message (docs/evenements-moteur.md, « Filiation ») : celle de la tâche notifiée ou
 * de l'agent qui rend la main ; pour une tâche que personne n'a vue, la requête courante seulement
 * si elle a fini par une interruption ; la requête courante pour une reprise ; sinon hors requête.
 */
export function relaunchOwner(t: Tracker, why: Relaunch): number {
  const { agents, tasks, interrupted } = listsOf(t)
  if (why.kind === 'continue') return t.current ?? OUTSIDE
  if (why.kind === 'other' || why.id === null) return OUTSIDE
  const known = ownOf(tasks, why.id) ?? ownOf(agents, why.id)?.request
  if (known !== undefined) return known
  // Un message d'un pair inconnu vient d'une autre session.
  if (why.kind === 'peer') return OUTSIDE
  return t.current !== null && interrupted.includes(t.current) ? t.current : OUTSIDE
}

/**
 * Un agent rattaché à sa requête : celle de son parent (`parent`, un autre agent), à défaut celle
 * pour laquelle travaille le fil principal. Seul le premier `agent.spawn` d'un id compte (un agent
 * réveillé en reçoit un autre) ; un agent vu sans `agent.spawn` (`isSpawn` faux : son premier tour,
 * un agent interne de Claude Code) est rattaché en attendant, et ne compte pas comme sous-agent.
 */
export function attachAgent(t: Tracker, agentId: string, o: { parent?: string; isSpawn: boolean }): Tracker {
  const { agents } = listsOf(t)
  const known = ownOf(agents, agentId)
  if (known?.isSpawned || (known && !o.isSpawn)) return t
  const request = (o.parent !== undefined ? ownOf(agents, o.parent)?.request : undefined) ?? ownerNow(t) ?? OUTSIDE
  const next: Tracker = { ...t, agents: { ...agents, [agentId]: { request, isSpawned: o.isSpawn } } }
  return o.isSpawn && request !== OUTSIDE ? changeRequest(next, request, (r) => ({ ...r, agents: r.agents + 1 })) : next
}

/** La requête d'un agent : celle de son rattachement, à défaut celle du fil principal en ce moment. */
export const requestOfAgent = (t: Tracker, agentId: string): number | undefined => ownOf(listsOf(t).agents, agentId)?.request ?? ownerNow(t) ?? undefined

/**
 * La liste des tâches de fond encore en cours, vue à un arrêt (fil principal ou agent). Une tâche
 * vue pour la première fois est rattachée à son agent si elle en est un, sinon à `owner` : la
 * requête du tour qui s'arrête (celle pour laquelle travaillait le fil principal, ou l'agent).
 */
export function noteTasks(t: Tracker, ids: readonly string[], owner: number | null): Tracker {
  const { agents, tasks } = listsOf(t)
  const seen = { ...tasks }
  for (const id of ids) if (!Object.hasOwn(seen, id)) setOwn(seen, id, ownOf(agents, id)?.request ?? owner ?? OUTSIDE)
  return recount({ ...t, tasks: seen, running: [...ids] })
}

/** La tâche `id` a notifié sa fin : elle ne retient plus sa requête. */
export function finishTask(t: Tracker, id: string | null): Tracker {
  const { running } = listsOf(t)
  if (id === null || !running.includes(id)) return t
  return recount({ ...t, running: running.filter((x) => x !== id) })
}

/**
 * Un appel au modèle, compté dans la requête `id` : celle de son tour (ou de son agent) à l'entrée
 * de l'appel, un message envoyé pendant l'appel ne le lui prend pas. `OUTSIDE` : l'entrée hors
 * requête du relevé. Sans requête ni relevé, il ne compte pas.
 */
export function recordCall(t: Tracker, id: number | undefined, call: Call): Tracker {
  if (id === undefined || !t.log) return t
  if (id === OUTSIDE) return { ...t, log: { ...t.log, outside: { ...t.log.outside, [call.model]: addCall(t.log.outside[call.model] ?? emptyStats(), call) } } }
  return changeRequest(t, id, (r) => ({ ...r, apiMs: r.apiMs + call.apiMs, models: { ...r.models, [call.model]: addCall(r.models[call.model] ?? emptyStats(), call) } }))
}

const addCall = (s: CallStats, c: Call): CallStats => {
  const price = priceOf(c.model, c.usage)
  const u = c.usage
  const hasTokens = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens > 0
  return {
    calls: s.calls + 1,
    input: s.input + c.usage.input_tokens,
    output: s.output + c.usage.output_tokens,
    cacheWrite: s.cacheWrite + c.usage.cache_creation_input_tokens,
    cacheRead: s.cacheRead + c.usage.cache_read_input_tokens,
    apiMs: s.apiMs + c.apiMs,
    genMs: s.genMs + c.genMs,
    // Un modèle inconnu de la table : son coût est estimé au relevé (`costed`).
    cost: s.cost + (price ?? 0),
    isEstimated: s.isEstimated || (price === null && hasTokens),
    speeds: addSpeed(s.speeds ?? {}, speedClass(u.output_tokens, c.genMs)),
  }
}

const addSpeed = (speeds: Record<string, number>, key: string | null): Record<string, number> => (key === null ? speeds : { ...speeds, [key]: (speeds[key] ?? 0) + 1 })

/**
 * Fin du tour `turnId` du fil principal, à `at` : sa requête a fini pour le fil principal. Hors
 * d'une fin normale (`isInterrupted` : interruption, erreur), aucune liste à jour n'arrive : ses
 * tâches restent celles déjà connues, plus ses agents encore actifs (`activeAgents`), et elle peut
 * se rouvrir pour une tâche inconnue. Une fin normale le lui retire.
 */
export function endTurn(t: Tracker, turnId: string, at: number, o: { isInterrupted?: boolean; activeAgents?: readonly string[] } = {}): Tracker {
  const id = ownOf(t.turns, turnId)
  if (id === undefined) return t
  const { [turnId]: _, ...turns } = t.turns
  let next: Tracker = { ...t, turns, active: t.active === turnId ? undefined : t.active }
  if (id === OUTSIDE) return next
  next = changeRequest(next, id, (r) => close(r, at))
  const { agents, tasks, running, interrupted } = listsOf(next)
  if (!o.isInterrupted) return { ...next, interrupted: interrupted.filter((x) => x !== id) }
  const own = (o.activeAgents ?? []).filter((a) => ownOf(agents, a)?.request === id && !running.includes(a))
  const seen = { ...tasks }
  for (const a of own) if (!Object.hasOwn(seen, a)) setOwn(seen, a, id)
  return recount({ ...next, tasks: seen, running: [...running, ...own], interrupted: interrupted.includes(id) ? interrupted : [...interrupted, id] })
}

/**
 * Le relevé avec le coût des modèles inconnus estimé au prorata de `sessionCost` (le coût du
 * moteur) : ce que les appels chiffrés n'expliquent pas, réparti selon leurs unités pondérées.
 */
export function costed(log: RequestLog, sessionCost: number | null): RequestLog {
  const all = [...log.requests.flatMap((r) => Object.entries(r.models)), ...Object.entries(log.outside)]
  const unknown = all.filter(([m]) => !isPriced(m))
  const priced = all.filter(([m]) => isPriced(m)).reduce((n, [, s]) => n + s.cost, 0)
  const shares = estimateUnknown(sessionCost, priced, unknown.map(([, s]) => trackedUnits(s.input, s.output, s.cacheWrite, s.cacheRead)))
  // Par objet : les mêmes chiffres d'un modèle peuvent revenir dans deux requêtes, chacune garde sa part.
  const estimate = new Map(unknown.map(([, s], i) => [s, shares[i]!] as const))
  const fill = (models: Record<string, CallStats>) => Object.fromEntries(Object.entries(models).map(([m, s]) => [m, estimate.has(s) ? { ...s, cost: estimate.get(s)!, isEstimated: true } : s]))
  return { ...log, requests: log.requests.map((r) => ({ ...r, models: fill(r.models) })), outside: fill(log.outside) }
}

// ─── Lecture d'une requête ──────────────────────────────────────────────────

const tokensOf = (s: CallStats): number => s.input + s.output + s.cacheWrite + s.cacheRead

export const requestCost = (r: RequestRecord): number => Object.values(r.models).reduce((n, s) => n + s.cost, 0)
export const requestTokens = (r: RequestRecord): number => Object.values(r.models).reduce((n, s) => n + tokensOf(s), 0)
export const isEstimated = (r: RequestRecord): boolean => Object.values(r.models).some((s) => s.isEstimated)

/** Le modèle principal d'une requête : celui qui a coûté le plus, à défaut le plus de tokens. */
export function mainModel(r: RequestRecord): string | null {
  const ranked = Object.entries(r.models).sort(([, a], [, b]) => b.cost - a.cost || tokensOf(b) - tokensOf(a))
  return ranked[0]?.[0] ?? null
}

/** La durée réelle d'une requête ; encore en cours, jusqu'à `now`. */
export const realMsOf = (r: RequestRecord, now: number): number => (r.isOpen ? Math.max(r.realMs, now - r.sentAt) : r.realMs)

/** L'intervalle [envoi, fin] d'une requête ; encore en cours, jusqu'à `now`. */
export const spanOf = (r: RequestRecord, now: number): [number, number] => [r.sentAt, r.sentAt + realMsOf(r, now)]

// ─── Calculs ────────────────────────────────────────────────────────────────

/** La médiane ; null pour une liste vide. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Le temps actif : la durée de l'union des intervalles, les chevauchements comptés une fois. */
export function activeMs(spans: readonly (readonly [number, number])[]): number {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0
  let end = -Infinity
  for (const [a, b] of sorted) {
    if (b <= end) continue
    total += b - Math.max(a, end)
    end = b
  }
  return total
}
