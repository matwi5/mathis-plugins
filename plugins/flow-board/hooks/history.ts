// Historique de l'onglet Agents : retrouver les agents d'un parcours passé ou d'une
// ancienne discussion. Fonctions pures ; la lecture des fichiers vit dans register.tsx.
//
// - Le sélecteur liste « Ici, maintenant », les parcours du projet (archivés compris), puis les
//   discussions sans parcours qui ont lancé au moins un sous-agent ou une session liée (Q12).
// - Ce que la reprise reconstruit pour une autre session va dans son fichier à part,
//   `<session>.rebuilt.json` (S13) ; les lignes de l'ancien champ d'un parcours dont la session est
//   introuvable vont dans celui du parcours, `run-<parcours>.rebuilt.json` (S18).

import type { AdvisorFigures, AgentLane, AgentSegment, Board, RegistryAgent, Run, SessionRegistry } from '../types'
import { isSameProject } from './linked.ts'
import { MAIN, catchUpAdvisor, cleanAdvisorFigures, cleanAdvisorList, cleanAgent, cleanLane, emptyRegistry, mergeRegistry } from './registry.ts'
import { catchUp, type TranscriptAgent } from './transcript.ts'

/** Le fichier à part d'une session (ou d'un parcours) : ce que le rattrapage et la reprise ont reconstruit. */
export type Rebuilt = {
  v: 1
  /** L'id de la session, ou `run:<parcours>` pour le fichier d'un parcours (S18). */
  session: string
  /** Les sous-agents relus dans les transcripts. */
  agents: TranscriptAgent[]
  /** Les lignes de l'ancien champ des sous-agents d'un parcours (S1), en entrées du registre. */
  rows?: RegistryAgent[]
  /** La piste de la session relue dans son transcript, sur les périodes des parcours repris, et ses appels à l'advisor. */
  main?: AgentLane & { advisor?: AdvisorFigures[] }
  /** Les parcours repris dans ce fichier. */
  runs?: string[]
}

/** L'id du fichier à part d'un parcours (S18). */
export const runFileId = (run: string): string => `run-${run.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}`

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** Un fichier à part relu entrée par entrée (F3) ; null quand il ne se lit pas. */
export const cleanRebuilt = (raw: unknown, session: string): Rebuilt | null => {
  if (!isObj(raw) || raw.session !== session || !Array.isArray(raw.agents)) return null
  const agents: TranscriptAgent[] = []
  for (const x of raw.agents) {
    if (!isObj(x) || typeof x.agentId !== 'string' || !isObj(x.lane)) continue
    const lane = x.lane
    const meta = isObj(x.meta) ? x.meta : {}
    const text = (k: string) => (typeof meta[k] === 'string' ? { [k]: meta[k] as string } : {})
    agents.push({
      agentId: x.agentId,
      lane: {
        ...cleanLane(lane),
        toolCount: typeof lane.toolCount === 'number' ? lane.toolCount : 0,
        ...(typeof lane.startedAt === 'number' ? { startedAt: lane.startedAt } : {}),
        ...(typeof lane.endedAt === 'number' ? { endedAt: lane.endedAt } : {}),
        ...(Array.isArray(lane.advisor) ? { advisor: cleanAdvisorList(lane.advisor, cleanAdvisorFigures) } : {}),
      },
      meta: { ...text('agentType'), ...text('description'), ...text('toolUseId'), ...text('parentAgentId'), ...(typeof meta.isFinished === 'boolean' ? { isFinished: meta.isFinished } : {}) },
      ...(typeof x.run === 'string' ? { run: x.run } : {}),
    })
  }
  const out: Rebuilt = { v: 1, session, agents }
  if (Array.isArray(raw.rows)) out.rows = raw.rows.map(cleanAgent).filter((r): r is RegistryAgent => r !== null)
  if (isObj(raw.main)) out.main = { ...cleanLane(raw.main), ...(Array.isArray(raw.main.advisor) ? { advisor: cleanAdvisorList(raw.main.advisor, cleanAdvisorFigures) } : {}) }
  if (Array.isArray(raw.runs)) out.runs = raw.runs.filter((r): r is string => typeof r === 'string')
  return out
}

/**
 * Le registre d'une session complété par son fichier à part : sous-agents, lignes recopiées, piste.
 * `inFlight` : les appels Agent encore en vol dans ce processus, que le transcript ne clôt pas.
 */
export const applyRebuilt = (reg: SessionRegistry, rebuilt: Rebuilt | null, now: number, inFlight?: ReadonlySet<string>): SessionRegistry => {
  if (!rebuilt) return reg
  let next = catchUp(reg, rebuilt.agents, now, inFlight) ?? reg
  if ((rebuilt.rows ?? []).length > 0) next = mergeRegistry(next, { ...next, agents: rebuilt.rows! })
  if ((rebuilt.main?.segments ?? []).length > 0) {
    // La piste vécue reste ; la reprise rend ce qui la précède.
    const live = next.main?.segments ?? []
    const since = live.length > 0 ? Math.min(...live.map(x => x.s)) : Infinity
    const before = rebuilt.main!.segments!.filter(x => (x.e ?? x.s) <= since)
    const { advisor: _calls, ...lane } = rebuilt.main!
    next = { ...next, main: { ...lane, ...next.main, segments: [...before, ...live].sort((a, b) => a.s - b.s) } }
  }
  // Les appels à l'advisor de la session elle-même : sur sa ligne advisor.
  return catchUpAdvisor(next, MAIN, rebuilt.main?.advisor, now) ?? next
}

/** La période d'un parcours, une marge comprise après sa dernière activité. */
export const runWindow = (run: Run): { s: number; e: number } => ({ s: run.startedAt - BEFORE_MS, e: (run.finishedAt ?? run.updatedAt) + AFTER_MS })

/** Les segments d'une piste (et ses appels à l'advisor) qui touchent la période. */
export const clipLane = <L extends AgentLane & { advisor?: AdvisorFigures[] }>(lane: L | undefined, w: { s: number; e: number }): L => {
  const inside = (x: { s: number; e?: number }) => (x.e ?? x.s) >= w.s && x.s <= w.e
  return {
    ...lane,
    segments: (lane?.segments ?? []).filter(inside),
    marks: (lane?.marks ?? []).filter(m => m.at >= w.s && m.at <= w.e),
    ...(lane?.advisor ? { advisor: lane.advisor.filter(inside) } : {}),
  } as L
}

/**
 * Les sous-agents relus d'une session qui ont travaillé pendant le parcours, rattachés à lui (Q14).
 * Deux parcours dont les périodes se recouvrent (l'un mis en pause pendant l'autre) : un sous-agent
 * va à celui des deux qui a commencé le plus tard avant lui.
 */
export const agentsOfRun = (found: readonly TranscriptAgent[], run: Run, runs: readonly Run[] = [run]): TranscriptAgent[] =>
  found.filter(a => a.lane.startedAt !== undefined && runAt(runs, a.lane.startedAt) === run.id).map(a => ({ ...a, run: run.id }))

/** Le parcours dont la période contient `at` ; deux qui se recouvrent : celui qui a commencé le plus tard. */
export const runAt = (runs: readonly Run[], at: number): string | undefined => {
  let best: Run | undefined
  for (const r of runs) {
    const w = runWindow(r)
    if (at >= w.s && at <= w.e && (best === undefined || r.startedAt > best.startedAt)) best = r
  }
  return best?.id
}

/**
 * Les parcours qu'une discussion a portés (S27, S28) : ceux dont elle est propriétaire, dont elle a
 * des sous-agents suivis en direct, dont elle a un ticket « en cours », ou que son en-tête a notés.
 */
export const runsCarriedBy = (runs: readonly Run[], self: Pick<SessionRegistry, 'session' | 'agents' | 'carried'>): Run[] =>
  runs.filter(
    r => r.owner === self.session || (self.carried ?? []).includes(r.id) || self.agents.some(a => a.run === r.id && a.source === 'live') || r.tickets.some(t => t.by === self.session),
  )

/** La marge de Q14 autour d'une période : 1 min avant son début, 10 min après sa fin. */
const BEFORE_MS = 60_000
const AFTER_MS = 10 * 60_000

/**
 * Le parcours porté par la discussion dont la période contient `at` (S27) ; deux qui se recouvrent :
 * celui qui a commencé le plus tard. R3 (S31, S37) : `at` doit aussi tomber dans une des périodes où
 * la discussion le portait, marge Q14 comprise ; la dernière sans fin tant qu'elle le porte encore
 * (propriétaire, ou un ticket « en cours » par elle) ; sans dates notées (en-tête d'avant), la
 * période du parcours seule.
 */
export const carriedRunAt = (carried: readonly Run[], reg: Pick<SessionRegistry, 'session' | 'carriedAt'>, at: number): string | undefined => {
  let best: Run | undefined
  for (const r of carried) {
    const w = runWindow(r)
    if (at < w.s || at > w.e) continue
    const spans = reg.carriedAt?.[r.id]
    const isCarrying = r.owner === reg.session || r.tickets.some(t => t.by === reg.session)
    const isInSpan = !spans || spans.some((s, i) => at >= s.from - BEFORE_MS && (at <= s.to + AFTER_MS || (isCarrying && i === spans.length - 1)))
    if (isInSpan && (best === undefined || r.startedAt > best.startedAt)) best = r
  }
  return best?.id
}

/**
 * Q-a (S27) : les sous-agents relus dans les transcripts de cette discussion qui manquent à son
 * registre se rattachent au parcours qu'elle portait à leur départ ; les autres ne changent pas.
 */
export const withCarriedRuns = (found: readonly TranscriptAgent[], reg: SessionRegistry, carried: readonly Run[]): TranscriptAgent[] =>
  found.map(a => {
    const isKnown = reg.agents.some(x => x.agentId === a.agentId || (a.meta.toolUseId !== undefined && x.key === a.meta.toolUseId))
    const run = isKnown || a.run !== undefined || a.lane.startedAt === undefined ? undefined : carriedRunAt(carried, reg, a.lane.startedAt)
    return run !== undefined ? { ...a, run } : a
  })

/**
 * R2 (S32) : à chaque rattrapage, une entrée venue des transcripts sans parcours (rattrapée plus tôt)
 * rejoint le parcours porté dont la période contient son départ. Une entrée suivie en direct sans
 * parcours le reste. Null quand rien ne change.
 */
export const attachCarried = (reg: SessionRegistry, carried: readonly Run[]): SessionRegistry | null => {
  let isChanged = false
  const agents = reg.agents.map(a => {
    if (a.source !== 'transcript' || a.run !== undefined) return a
    const run = carriedRunAt(carried, reg, a.startedAt)
    if (run === undefined) return a
    isChanged = true
    return { ...a, run }
  })
  return isChanged ? { ...reg, agents } : null
}

/**
 * Deux versions d'un fichier à part réunies (S20) : rien ne se retire par une fusion. Les sous-agents
 * s'unissent par id (les chiffres du plus récent, le parcours déjà rattaché garde le sien), les
 * parcours repris, les lignes recopiées (par clé) et les segments de la piste aussi.
 */
export const unionRebuilt = (before: Rebuilt | null, next: Rebuilt): Rebuilt => {
  if (!before) return next
  const byId = new Map(before.agents.map(a => [a.agentId, a]))
  for (const a of next.agents) {
    const was = byId.get(a.agentId)
    const run = was?.run ?? a.run
    byId.set(a.agentId, run !== undefined ? { ...a, run } : a)
  }
  const out: Rebuilt = { v: 1, session: next.session, agents: [...byId.values()] }
  const runs = [...new Set([...(before.runs ?? []), ...(next.runs ?? [])])]
  if (runs.length > 0) out.runs = runs
  const rows = new Map((before.rows ?? []).map(r => [r.key, r]))
  for (const r of next.rows ?? []) if (!rows.has(r.key)) rows.set(r.key, r)
  if (rows.size > 0) out.rows = [...rows.values()]
  const segs = new Map<string, AgentSegment>()
  for (const x of [...(before.main?.segments ?? []), ...(next.main?.segments ?? [])]) if (!segs.has(`${x.k}|${x.s}`)) segs.set(`${x.k}|${x.s}`, x)
  // Les appels à l'advisor de la piste de la session : union par id, le plus récent relevé gagne.
  const calls = new Map<string, AdvisorFigures>()
  for (const c of [...(before.main?.advisor ?? []), ...(next.main?.advisor ?? [])]) calls.set(c.id, c)
  if (segs.size > 0 || calls.size > 0) {
    out.main = {
      ...(segs.size > 0 ? { segments: [...segs.values()].sort((a, b) => a.s - b.s) } : {}),
      ...(calls.size > 0 ? { advisor: [...calls.values()].sort((a, b) => a.s - b.s) } : {}),
    }
  }
  return out
}

/** Ce que la reprise d'un parcours apporte au fichier à part d'une session : ses sous-agents, sa piste et ses appels à l'advisor, le parcours. */
export const withRun = (before: Rebuilt | null, session: string, run: Run, agents: readonly TranscriptAgent[], main: (AgentLane & { advisor?: AdvisorFigures[] }) | null): Rebuilt =>
  unionRebuilt(before, {
    v: 1,
    session,
    agents: [...agents],
    runs: [run.id],
    ...((main?.segments ?? []).length > 0 || (main?.advisor ?? []).length > 0
      ? { main: { ...((main?.segments ?? []).length > 0 ? { segments: main!.segments! } : {}), ...((main?.advisor ?? []).length > 0 ? { advisor: main!.advisor! } : {}) } }
      : {}),
  })

export type HistoryEntry = { key: string; kind: 'now' | 'run' | 'session'; title: string; at?: number; isArchived?: boolean; agents?: number }

/**
 * Le sélecteur de l'onglet : « Ici, maintenant », les parcours du projet, archivés compris (les
 * plus récents d'abord), puis les discussions sans parcours du projet qui ont lancé au moins un
 * sous-agent ou une session liée, les plus récentes d'abord. `heads` : les en-têtes du dossier.
 */
export const historyEntries = (board: Board | null, self: { session: string; root: string }, heads: readonly SessionRegistry[]): HistoryEntry[] => {
  const runs = [...(board?.runs ?? [])].sort((a, b) => (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt))
  // Le projet ou ses worktrees seulement (dans l'esprit de S17) ; sans racine connue, aucune.
  const isMine = (o: SessionRegistry) => isSameProject(self.root, o.root)
  // Sans parcours : ni session liée d'un parcours, ni discussion qui en a porté un.
  const discussions = heads
    .filter(o => o.session !== self.session && o.run === undefined && isMine(o) && !o.agents.some(a => a.run !== undefined))
    .filter(o => o.agents.length > 0 || (o.linked ?? []).length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return [
    { key: 'now', kind: 'now', title: 'Ici, maintenant' },
    ...runs.map(r => ({ key: `run:${r.id}`, kind: 'run' as const, title: r.title, at: r.finishedAt ?? r.updatedAt, ...(r.archivedAt !== undefined ? { isArchived: true } : {}) })),
    ...discussions.map(o => ({ key: `session:${o.session}`, kind: 'session' as const, title: o.title ?? o.session.slice(0, 8), at: o.updatedAt, agents: o.agents.length })),
  ]
}

/**
 * La vue d'orchestrateur d'un parcours passé : les registres des discussions qui l'ont porté, leurs
 * sous-agents de ce parcours et leur piste sur sa période, complétés par les fichiers à part ;
 * sans aucune, un registre fait des seules lignes recopiées.
 */
export const runRegistry = (run: Run, regs: readonly SessionRegistry[], runFile: Rebuilt | null, now: number): SessionRegistry => {
  const w = runWindow(run)
  let out: SessionRegistry = { ...emptyRegistry(`run:${run.id}`, '', run.updatedAt), title: run.title }
  for (const reg of regs) {
    const own = reg.agents.filter(a => a.run === run.id)
    const main = clipLane(reg.main, w)
    // Les appels à l'advisor du parcours : ceux de ses sous-agents, et ceux de la discussion dans sa période.
    const ids = new Set(own.flatMap(a => (a.agentId !== undefined ? [a.agentId] : [])))
    const calls = (reg.advisor?.calls ?? []).filter(c => (c.by === MAIN ? (c.e ?? c.s) >= w.s && c.s <= w.e : ids.has(c.by)))
    if (own.length === 0 && (main.segments ?? []).length === 0 && calls.length === 0) continue
    out = mergeRegistry(out, { ...out, agents: own, main, ...(calls.length > 0 ? { advisor: { calls } } : {}) })
  }
  out = applyRebuilt(out, runFile, now)
  return run.status === 'active' ? out : settledRun(out, run.finishedAt ?? run.updatedAt)
}

/**
 * La vue d'un parcours qui ne tourne plus ne s'allonge plus : ses segments restés ouverts se
 * ferment à sa fin, et un sous-agent resté « au travail » (fin jamais vue) y est fini, sans durée.
 */
const settledRun = (reg: SessionRegistry, end: number): SessionRegistry => {
  const close = (segs: readonly AgentSegment[] | undefined) => (segs ?? []).map(x => (x.e === undefined ? { ...x, e: Math.max(x.s, end) } : x))
  return {
    ...reg,
    ...(reg.main ? { main: { ...reg.main, segments: close(reg.main.segments) } } : {}),
    agents: reg.agents.map(a => (a.status === 'running' ? { ...a, status: 'done' as const, finishedAt: Math.max(a.startedAt, end), isEndUnseen: true, segments: close(a.segments) } : { ...a, segments: close(a.segments) })),
  }
}
