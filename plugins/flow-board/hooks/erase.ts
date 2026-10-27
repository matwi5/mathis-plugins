// Effacement de l'historique des agents (ticket 10). Fonctions pures ; les fichiers, les commandes
// système et la file d'écriture vivent dans register.tsx.
//
// - Supprimer un parcours efface ses agents, ceux de ses sessions liées et ses fichiers de relais
//   et de choix (Q6 a1, S3) ; « ✗ Oublier » efface une discussion et ses sessions liées (S2).
// - Une trace garde l'id effacé et la date, rien d'autre (S5) : toute lecture et tout rattrapage
//   ignorent ce qu'elle couvre ; ce qui arrive après dans la même discussion est suivi normalement.
// - Le fichier d'une session ouverte n'est jamais touché par une autre : elle relit les traces
//   avant chacune de ses écritures et se compacte elle-même (S6). Fermée (S19 : rien écrit depuis
//   30 min, aucun sous-agent au travail, ou sa fin connue), son fichier s'efface tout de suite ;
//   l'orchestrateur fermé d'un parcours supprimé est réécrit sans ce parcours (S14).

import type { AgentLane, RegistryAgent, SessionRegistry } from '../types'
import type { Rebuilt } from './history.ts'

/**
 * Une trace d'effacement : l'id d'une session, `run:<parcours>`, celui d'un sous-agent effacé avec
 * son parcours (`agent:<id>`, `call:<clé d'appel>`, S22) ou d'un lancement de ses sessions liées
 * (`launch:<id de lancement>`, S25), et la date (S5).
 */
export type Trace = { id: string; at: number }

/** Les traces d'un sous-agent effacé avec son parcours (S22) : par son id et par sa clé d'appel. */
export const agentTraces = (a: Pick<RegistryAgent, 'key' | 'agentId'>, at: number): Trace[] => [
  { id: `call:${a.key}`, at },
  ...(a.agentId !== undefined ? [{ id: `agent:${a.agentId}`, at }] : []),
]

/** Sans écriture depuis plus longtemps, sans sous-agent au travail, une session est fermée (S19). */
export const CLOSED_MS = 30 * 60_000

/** Une trace relue entrée par entrée ; null quand elle ne se lit pas. */
export const cleanTrace = (raw: unknown): Trace | null =>
  raw !== null && typeof raw === 'object' && typeof (raw as Trace).id === 'string' && (raw as Trace).id !== '' && typeof (raw as Trace).at === 'number' && Number.isFinite((raw as Trace).at)
    ? { id: (raw as Trace).id, at: (raw as Trace).at }
    : null

/** La date jusqu'à laquelle une trace couvre cet id ; la plus récente quand il y en a plusieurs. */
const coverOf = (traces: readonly Trace[], id: string): number => traces.reduce((at, t) => (t.id === id && t.at > at ? t.at : at), -Infinity)

/** Ce qu'une session couvre d'elle-même, de ses parcours et de ses sous-agents effacés un à un. */
type Cover = { session: number; run: (run: string | undefined) => number; agents: ReadonlySet<string> }

const coverFor = (session: string, traces: readonly Trace[], headRun?: string): Cover => {
  // Une session liée d'un parcours effacé est couverte toute entière, jusqu'à la trace du parcours.
  const session0 = Math.max(coverOf(traces, session), headRun !== undefined ? coverOf(traces, `run:${headRun}`) : -Infinity)
  const agents = new Set(traces.filter(t => t.id.startsWith('agent:') || t.id.startsWith('call:') || t.id.startsWith('launch:')).map(t => t.id))
  return { session: session0, run: run => (run !== undefined ? coverOf(traces, `run:${run}`) : -Infinity), agents }
}

const isAgentCovered = (a: Pick<RegistryAgent, 'startedAt' | 'run'> & { key?: string; agentId?: string }, c: Cover): boolean =>
  a.startedAt < c.session ||
  a.startedAt < c.run(a.run) ||
  (a.key !== undefined && c.agents.has(`call:${a.key}`)) ||
  (a.agentId !== undefined && c.agents.has(`agent:${a.agentId}`))

/** Une piste sans ce qui précède `before` (segments, repères). */
const laneAfter = (lane: AgentLane | undefined, before: number): AgentLane | undefined => {
  if (!lane || before === -Infinity) return lane
  return { ...lane, segments: (lane.segments ?? []).filter(x => x.s >= before), marks: (lane.marks ?? []).filter(m => m.at >= before) }
}

/**
 * Le registre d'une session sans ce que les traces couvrent : ses sous-agents d'avant la trace
 * de la session, ceux d'un parcours effacé d'avant sa trace, sa piste et ses lancements d'avant.
 * Rend null quand rien n'est couvert.
 */
export const applyTraces = (reg: SessionRegistry, traces: readonly Trace[]): SessionRegistry | null => {
  if (traces.length === 0) return null
  const c = coverFor(reg.session, traces, reg.run)
  const agents = reg.agents.filter(a => !isAgentCovered(a, c))
  const main = laneAfter(reg.main, c.session)
  const linked = (reg.linked ?? []).filter(l => l.at >= c.session && !c.agents.has(`launch:${l.id}`))
  // Un parcours effacé quitte la liste des parcours portés (S28).
  const carried = (reg.carried ?? []).filter(id => c.run(id) === -Infinity)
  const spans = Object.fromEntries(Object.entries(reg.carriedAt ?? {}).filter(([id]) => carried.includes(id)))
  const isSame =
    agents.length === reg.agents.length &&
    linked.length === (reg.linked ?? []).length &&
    carried.length === (reg.carried ?? []).length &&
    Object.keys(spans).length === Object.keys(reg.carriedAt ?? {}).length &&
    (main?.segments ?? []).length === (reg.main?.segments ?? []).length &&
    (main?.marks ?? []).length === (reg.main?.marks ?? []).length
  if (isSame) return null
  const next: SessionRegistry = { ...reg, agents }
  if (main) next.main = main
  if (linked.length > 0) next.linked = linked
  else delete next.linked
  if (carried.length > 0) next.carried = carried
  else delete next.carried
  if (Object.keys(spans).length > 0) next.carriedAt = spans
  else {
    delete next.carriedAt
    delete next.carriedNotedAt
  }
  return next
}

/** Le fichier à part d'une session (ou d'un parcours) sans ce que les traces couvrent ; null quand rien ne l'est. */
export const applyTracesToRebuilt = (rebuilt: Rebuilt, traces: readonly Trace[]): Rebuilt | null => {
  if (traces.length === 0) return null
  const runOf = rebuilt.session.startsWith('run:') ? rebuilt.session.slice(4) : undefined
  const c = coverFor(rebuilt.session, traces, runOf)
  // Un sous-agent sans date ne se situe pas : une trace de la session le couvre quand même.
  const agents = rebuilt.agents.filter(a => !isAgentCovered({ startedAt: a.lane.startedAt ?? (c.session > -Infinity ? -Infinity : Infinity), run: a.run, agentId: a.agentId, ...(a.meta.toolUseId !== undefined ? { key: a.meta.toolUseId } : {}) }, c))
  const rows = rebuilt.rows?.filter(r => !isAgentCovered(r, c))
  const main = laneAfter(rebuilt.main, c.session)
  // Un parcours effacé ne reste pas dans la liste des parcours repris.
  const runs = rebuilt.runs?.filter(r => c.run(r) === -Infinity)
  const isSame =
    agents.length === rebuilt.agents.length &&
    (rows?.length ?? 0) === (rebuilt.rows?.length ?? 0) &&
    (main?.segments ?? []).length === (rebuilt.main?.segments ?? []).length &&
    (main?.marks ?? []).length === (rebuilt.main?.marks ?? []).length &&
    (runs?.length ?? 0) === (rebuilt.runs?.length ?? 0)
  if (isSame) return null
  const next: Rebuilt = { ...rebuilt, agents }
  if (rows) next.rows = rows
  if (main) next.main = main
  if (runs) next.runs = runs
  return next
}

/** Une session est fermée (S19) : sa fin est connue, ou rien n'a été écrit depuis CLOSED_MS et aucun sous-agent n'y travaille. */
export const isClosedSession = (reg: SessionRegistry | null, lastWrite: number, now: number, isEnded = false): boolean =>
  isEnded || (now - lastWrite > CLOSED_MS && !(reg?.agents ?? []).some(a => a.status === 'running'))

/** Ce qu'« Oublier » efface, pour la confirmation (S2) : des sessions et des sous-agents ; les sessions reconnues par leur titre seul ne sont pas comprises (S15). */
export type ForgetCount = { sessions: number; agents: number; byTitle: number }

/** Les nombres de la confirmation d'« Oublier » : la discussion et ses sessions liées sûres. */
export const forgetCount = (self: SessionRegistry, sure: readonly (SessionRegistry | null)[], byTitle: number): ForgetCount => ({
  sessions: 1 + sure.length,
  agents: self.agents.length + sure.reduce((n, r) => n + (r?.agents.length ?? 0), 0),
  byTitle,
})

/** Les mots de la confirmation d'« Oublier » : « 3 sessions et 12 sous-agents… ». */
export const forgetText = (n: ForgetCount): string => {
  const s = (k: number, one: string, many: string) => `${k} ${k > 1 ? many : one}`
  const base = `Oublier cette discussion ? ${s(n.sessions, 'session', 'sessions')} et ${s(n.agents, 'sous-agent', 'sous-agents')} seront effacés définitivement.`
  return n.byTitle > 0 ? `${base} ${s(n.byTitle, 'session liée reconnue', 'sessions liées reconnues')} par le titre seul ${n.byTitle > 1 ? 'ne sont' : 'n’est'} pas comprise${n.byTitle > 1 ? 's' : ''}.` : base
}

/**
 * Ce que `cmd.exe` interprète dans un chemin passé à une commande interne (`del`, `type`) :
 * `&`, `|`, `^`, `%`, `<`, `>` et `"`, et les séparateurs d'arguments `;`, `,` et `=` (S30). Un
 * chemin qui en contient n'a pas de commande.
 */
export const CMD_UNSAFE = /[&|^%<>";,=]/

/**
 * La commande qui supprime un fichier (S4), une fois réécrit vide : `rm` sur Mac et Linux, le
 * chemin en dernier argument, sans shell. Sous Windows, `del` passe par `cmd.exe` : un chemin qui
 * contient un signe de CMD_UNSAFE n'a pas de commande (null), et le fichier vide reste.
 */
export const removeArgv = (path: string): string[] | null => {
  if (!/^[a-z]:[\\/]/i.test(path)) return ['rm', '-f', '--', path]
  return CMD_UNSAFE.test(path) ? null : ['cmd.exe', '/d', '/c', 'del', '/f', '/q', path.replace(/\//g, '\\')]
}

/** Ce qu'il faut pour effacer un fichier : le réécrire, le supprimer par commande (absent : pas de commande). */
export type EraseIo = { write: (path: string, text: string) => Promise<void>; remove?: (path: string) => Promise<boolean> }

/**
 * Efface un fichier (S4) : réécrit vide d'abord, puis supprimé par une commande système. Si la
 * commande échoue ou manque, le fichier vide reste, sans aucune donnée. Rend ce qui a pu se faire.
 */
export const eraseWith = async (io: EraseIo, path: string): Promise<{ isEmptied: boolean; isRemoved: boolean }> => {
  try {
    await io.write(path, '')
  } catch {
    return { isEmptied: false, isRemoved: false }
  }
  if (!io.remove) return { isEmptied: true, isRemoved: false }
  try {
    return { isEmptied: true, isRemoved: await io.remove(path) }
  } catch {
    return { isEmptied: true, isRemoved: false }
  }
}
