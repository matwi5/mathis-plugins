// Registre des agents : ce que chaque session tient de ses sous-agents, pour l'onglet Agents.
//
// - Un fichier par session, écrit par elle seule (Q7) ; les fonctions d'ici sont pures, le
//   chargement et l'écriture vivent dans register.tsx.
// - Une même session peut tourner dans deux processus (reprise) : chaque écriture relit le
//   fichier et fusionne, l'état le plus avancé de chaque sous-agent l'emporte (S7).
// - Un fichier illisible est réécrit avec ce que la session sait (S8) ; le rattrapage par
//   transcript (catch-up.ts) rendra ce qui manque.
// - Sur le disque, jamais de rapport ni de texte de message : la description, le prompt (Q8), des chiffres.

import type { AdvisorCall, AdvisorFigures, AdvisorLane, AgentLane, AgentMark, AgentSegment, AgentStatus, AgentType, CarrySpan, LinkedLaunch, RegistryAgent, RegistryPart, Run, SessionRegistry } from '../types'
import { maskSecrets } from './timeline.ts'

/** Longueur gardée d'un prompt (S11) : environ 300 sous-agents tiennent sous la limite de 4 Mio d'une écriture. */
export const PROMPT_MAX = 8_000
/** Ce qui est lu au-delà de PROMPT_MAX pour masquer un jeton coupé par la tranche (S16). */
const PROMPT_MARGIN = 400
const STATUSES: readonly string[] = ['running', 'done', 'failed', 'cancelled']
const NAME_MAX = 120

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

export const emptyRegistry = (session: string, root: string, now: number): SessionRegistry => ({
  v: 1,
  session,
  root,
  agents: [],
  updatedAt: now,
})

// ─── Lecture validée (F3) ─────────────────────────────────────────────────
//
// Un fichier se relit entrée par entrée : un en-tête abîmé le rend illisible (S8), une entrée de
// sous-agent, un segment ou un repère abîmé est seulement ignoré, sans casser l'onglet.

const SEGMENT_KINDS: readonly string[] = ['think', 'write', 'tool', 'waitAgent', 'waitPerson', 'waitBg', 'waitAdvisor']
const FAMILIES: readonly string[] = ['read', 'edit', 'run', 'web', 'agent', 'other']
const MARK_KINDS: readonly string[] = ['fail', 'stop', 'relay', 'back', 'compact', 'msg', 'commit', 'test']
const AGENT_TYPES: readonly string[] = ['explore', 'research', 'implement', 'review', 'security', 'merge', 'plan', 'transcripts', 'other']

type Loose = Record<string, unknown>
const isObject = (x: unknown): x is Loose => x !== null && typeof x === 'object' && !Array.isArray(x)
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isText = (x: unknown): x is string => typeof x === 'string'

/** Recopie dans `to` les champs texte de `from` qui le sont. */
const copyTexts = (from: Loose, to: Loose, keys: readonly string[]) => {
  for (const k of keys) if (isText(from[k])) to[k] = from[k]
}

const cleanSegment = (x: unknown): AgentSegment | null => {
  if (!isObject(x) || !isText(x.k) || !SEGMENT_KINDS.includes(x.k) || !isNum(x.s)) return null
  const seg: AgentSegment = { k: x.k as AgentSegment['k'], s: x.s }
  if (x.e !== undefined) {
    if (!isNum(x.e)) return null
    seg.e = x.e
  }
  if (isText(x.f) && FAMILIES.includes(x.f)) seg.f = x.f as AgentSegment['f']
  copyTexts(x, seg as Loose, ['t', 'a'])
  if (x.x === true) seg.x = true
  if (isNum(x.n) && x.n >= 1) seg.n = Math.floor(x.n)
  if (x.est === true) seg.est = true
  return seg
}

const cleanMark = (x: unknown): AgentMark | null => {
  if (!isObject(x) || !isText(x.k) || !MARK_KINDS.includes(x.k) || !isNum(x.at)) return null
  const mark: AgentMark = { k: x.k as AgentMark['k'], at: x.at }
  if (typeof x.ok === 'boolean') mark.ok = x.ok
  if (isText(x.to)) mark.to = x.to
  return mark
}

const cleanList = <T>(x: unknown, clean: (item: unknown) => T | null): T[] | undefined =>
  Array.isArray(x) ? x.map(clean).filter((v): v is T => v !== null) : undefined

/** Ce qu'une piste porte de valide : segments, repères, effort, modèles, tokens, lignes. */
export const cleanLane = (x: Loose): AgentLane => {
  const lane: AgentLane = {}
  const segments = cleanList(x.segments, cleanSegment)
  if (segments) lane.segments = segments
  const marks = cleanList(x.marks, cleanMark)
  if (marks) lane.marks = marks
  if (isText(x.effort)) lane.effort = x.effort
  if (Array.isArray(x.models) && x.models.every(isText)) lane.models = x.models as string[]
  const t = x.tokens
  if (isObject(t) && isNum(t.input) && isNum(t.output) && isNum(t.cacheRead) && isNum(t.cacheWrite)) lane.tokens = { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite }
  const l = x.lines
  if (isObject(l) && isNum(l.added) && isNum(l.removed)) lane.lines = { added: l.added, removed: l.removed }
  return lane
}

export const cleanAgent = (x: unknown): RegistryAgent | null => {
  if (!isObject(x) || !isText(x.key) || !isText(x.name) || !isNum(x.startedAt) || !isText(x.status) || !STATUSES.includes(x.status)) return null
  const agent: RegistryAgent = {
    ...cleanLane(x),
    key: x.key,
    name: x.name,
    isBackground: x.isBackground !== false,
    status: x.status as AgentStatus,
    startedAt: x.startedAt,
    source: x.source === 'transcript' ? 'transcript' : 'live',
  }
  copyTexts(x, agent as Loose, ['agentId', 'parent', 'workflow', 'subagentType', 'prompt', 'model', 'run'])
  if (isNum(x.finishedAt)) agent.finishedAt = x.finishedAt
  if (x.isEndUnseen === true) agent.isEndUnseen = true
  if (isNum(x.wakes) && x.wakes > 0) agent.wakes = Math.floor(x.wakes)
  if (isText(x.type) && AGENT_TYPES.includes(x.type)) agent.type = x.type as AgentType
  return agent
}

/** Au plus tant d'appels gardés sur la ligne advisor : les plus récents. */
export const ADVISOR_CALLS_MAX = 2_000

/** Un instant plausible, en ms : après 2020, avant 2200 (un nombre hors de là est abîmé). */
const isTime = (x: unknown): x is number => isNum(x) && x >= 1_577_836_800_000 && x < 7_258_118_400_000

/** Un compte de tokens plausible : entier, positif, sous le milliard. */
const isCount = (x: unknown): x is number => isNum(x) && x >= 0 && x < 1e9

/**
 * Les chiffres d'un appel lus sur le disque, bornés : un id, des heures plausibles, la fin après le
 * début ; un modèle et des tokens seulement s'ils se lisent en entier.
 */
export const cleanAdvisorFigures = (x: unknown): AdvisorFigures | null => {
  if (!isObject(x) || !isText(x.id) || x.id === '' || !isTime(x.s) || (x.e !== undefined && (!isTime(x.e) || x.e < x.s))) return null
  const call: AdvisorFigures = { id: x.id.slice(0, 200), s: x.s }
  if (isTime(x.e)) call.e = x.e
  if (isText(x.model) && x.model !== '') call.model = x.model.slice(0, 100)
  const t = x.tokens
  if (isObject(t) && isCount(t.input) && isCount(t.output) && isCount(t.cacheRead) && isCount(t.cacheWrite)) call.tokens = { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite }
  return call
}

/** Un appel lu sur le disque : ses chiffres bornés, et un appelant. */
const cleanAdvisorCall = (x: unknown): AdvisorCall | null => {
  const figures = cleanAdvisorFigures(x)
  if (!figures || !isObject(x) || !isText(x.by) || x.by === '') return null
  return { ...figures, by: x.by.slice(0, 200), ...(x.isRead === true ? { isRead: true } : {}) }
}

/** Une liste d'appels lue sur le disque, ADVISOR_CALLS_MAX au plus (les plus récents), chacun borné. */
export const cleanAdvisorList = <T>(x: unknown, clean: (item: unknown) => T | null): T[] =>
  Array.isArray(x) ? x.slice(-ADVISOR_CALLS_MAX).map(clean).filter((c): c is T => c !== null) : []

/** La ligne advisor lue appel par appel. */
const cleanAdvisor = (x: Loose): AdvisorLane => ({ calls: cleanAdvisorList(x.calls, cleanAdvisorCall) })

const cleanLaunch = (x: unknown): LinkedLaunch | null => {
  if (!isObject(x) || !isText(x.id) || x.id === '' || !isNum(x.at) || (x.via !== 'bg' && x.via !== 'desktop')) return null
  const launch: LinkedLaunch = { id: x.id, at: x.at, via: x.via }
  if (isText(x.title)) launch.title = x.title
  return launch
}

/** Un registre lu entrée par entrée ; null quand son en-tête ne se lit pas (écriture coupée, autre format). */
export const cleanRegistry = (value: unknown): SessionRegistry | null => {
  if (!isObject(value) || value.v !== 1 || !isText(value.session) || !isText(value.root) || !Array.isArray(value.agents)) return null
  const reg: SessionRegistry = {
    v: 1,
    session: value.session,
    root: value.root,
    agents: cleanList(value.agents, cleanAgent)!,
    updatedAt: isNum(value.updatedAt) ? value.updatedAt : 0,
  }
  copyTexts(value, reg as Loose, ['title', 'transcript', 'run', 'group'])
  if (isObject(value.main)) reg.main = cleanLane(value.main)
  if (isObject(value.advisor)) reg.advisor = cleanAdvisor(value.advisor)
  if (isNum(value.parts) && value.parts > 1) reg.parts = Math.min(PARTS_MAX, Math.floor(value.parts))
  const linked = cleanList(value.linked, cleanLaunch)
  if (linked && linked.length > 0) reg.linked = linked
  if (Array.isArray(value.carried)) {
    const carried = value.carried.filter(isText).slice(0, CARRIED_MAX)
    if (carried.length > 0) reg.carried = carried
    // S31, S37 : les périodes des seuls parcours notés, deux nombres chacune, la fin après le début.
    if (isObject(value.carriedAt)) {
      const spans: Record<string, CarrySpan[]> = {}
      for (const id of carried) {
        const list = value.carriedAt[id]
        if (!Array.isArray(list)) continue
        const kept = list.filter((s): s is CarrySpan => isObject(s) && isNum(s.from) && isNum(s.to) && s.from <= s.to).map(s => ({ from: s.from, to: s.to }))
        if (kept.length > 0) spans[id] = normalizeSpans(kept)
      }
      if (Object.keys(spans).length > 0) reg.carriedAt = spans
    }
    if (reg.carriedAt && isNum(value.carriedNotedAt)) reg.carriedNotedAt = value.carriedNotedAt
  }
  return reg
}

/** Au plus tant d'ids de parcours portés dans un en-tête (S28) : un nombre lu au-delà est abîmé (F3). */
const CARRIED_MAX = 500

/** S37 : une nouvelle période de portage s'ouvre après plus de tant sans porter le parcours (la marge Q14). */
export const CARRY_GAP_MS = 10 * 60_000
/** S37 : au plus tant de périodes par parcours ; au-delà, les deux plus anciennes se fondent. */
const SPANS_MAX = 20

/** Des périodes triées, celles qui se recouvrent fondues, SPANS_MAX au plus. */
const normalizeSpans = (spans: readonly CarrySpan[]): CarrySpan[] => {
  const out: CarrySpan[] = []
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1)
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to)
    else out.push({ ...s })
  }
  while (out.length > SPANS_MAX) out.splice(0, 2, { from: out[0]!.from, to: Math.max(out[0]!.to, out[1]!.to) })
  return out
}

/**
 * S28 : les parcours que la session porte, ajoutés à ceux de l'en-tête ; rien quand ils y sont déjà.
 * S31, S37, S40 : avec `now`, un parcours nouveau ouvre sa première période ; un parcours déjà daté
 * en ouvre une nouvelle s'il n'était plus porté par une écriture faite depuis sa dernière période
 * (`carriedNotedAt`) et plus de CARRY_GAP_MS après elle ; sinon sa dernière période s'allonge
 * jusqu'à `now`. Un id noté sans dates (en-tête d'avant) le reste.
 */
export const noteCarried = (reg: SessionRegistry, runs: readonly string[], now?: number): SessionRegistry | null => {
  const ids = [...new Set(runs.filter(id => id !== ''))]
  const added = ids.filter(id => !(reg.carried ?? []).includes(id))
  const spans: Record<string, CarrySpan[]> = { ...reg.carriedAt }
  let isSpanChanged = false
  let notedAt = reg.carriedNotedAt
  if (now !== undefined) {
    for (const id of ids) {
      const list = spans[id]
      const last = list?.at(-1)
      if (added.includes(id)) spans[id] = [{ from: now, to: now }]
      else if (!list || !last || last.to >= now) continue
      else if (notedAt !== undefined && notedAt > last.to && now - last.to > CARRY_GAP_MS) spans[id] = normalizeSpans([...list, { from: now, to: now }])
      else spans[id] = [...list.slice(0, -1), { ...last, to: now }]
      isSpanChanged = true
    }
    // La première écriture qui ne porte plus un parcours daté, après sa dernière période, est notée.
    const isLeft = Object.entries(spans).some(([id, list]) => !ids.includes(id) && (list.at(-1)?.to ?? Infinity) >= (notedAt ?? -Infinity) && (list.at(-1)?.to ?? Infinity) < now)
    if (isLeft) {
      notedAt = now
      isSpanChanged = true
    }
  }
  if (added.length === 0 && !isSpanChanged) return null
  const carried = [...(reg.carried ?? []), ...added].slice(-CARRIED_MAX)
  const next: SessionRegistry = { ...reg, carried }
  const kept = Object.fromEntries(Object.entries(spans).filter(([id]) => carried.includes(id)))
  if (Object.keys(kept).length > 0) next.carriedAt = kept
  else delete next.carriedAt
  if (next.carriedAt && notedAt !== undefined) next.carriedNotedAt = notedAt
  else delete next.carriedNotedAt
  return next
}

/** S31, S37 : les périodes de deux processus de la même session, réunies (celles qui se recouvrent fondues). */
const mergeSpans = (a: Readonly<Record<string, CarrySpan[]>> | undefined, b: Readonly<Record<string, CarrySpan[]>> | undefined): Record<string, CarrySpan[]> => {
  const out: Record<string, CarrySpan[]> = { ...a }
  for (const [id, list] of Object.entries(b ?? {})) out[id] = out[id] ? normalizeSpans([...out[id]!, ...list]) : list
  return out
}

/** Deux listes de périodes identiques. */
const sameSpans = (a: readonly CarrySpan[] | undefined, b: readonly CarrySpan[] | undefined): boolean =>
  (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((s, i) => s.from === b![i]!.from && s.to === b![i]!.to)

/** Un registre lisible ; un fichier coupé ou étranger ne l'est pas (S8 : il sera réécrit). */
export const isRegistry = (value: unknown): value is SessionRegistry => cleanRegistry(value) !== null

/** Le registre d'un texte de fichier, ou null quand il ne se lit pas (écriture coupée, autre format). */
export const parseRegistry = (text: unknown): SessionRegistry | null => {
  if (typeof text !== 'string') return cleanRegistry(text)
  try {
    return cleanRegistry(JSON.parse(text))
  } catch {
    return null
  }
}

/** Le nom de fichier d'une session dans le dossier du registre : son id, chaque signe hors `[a-z0-9_-]` en tiret. */
export const registrySlug = (session: string): string => session.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * Le registre lu dans le fichier (ou la clé) de la session `id` ; null aussi quand son en-tête se
 * dit d'une autre session que celle de son nom (F6) : un en-tête forgé ne vise pas une autre session.
 */
export const parseOwnRegistry = (text: unknown, id: string): SessionRegistry | null => {
  const reg = parseRegistry(text)
  return reg && registrySlug(reg.session) === registrySlug(id) ? reg : null
}

/**
 * Q-c : les sous-agents en échec d'un parcours, dans les registres de toutes les discussions qui
 * l'ont servi (cette discussion et ses sessions liées), chacun compté une fois par session.
 */
export const failedAgentsOf = (run: string, regs: readonly (SessionRegistry | null | undefined)[]): number => {
  const seen = new Set<string>()
  for (const reg of regs) for (const a of reg?.agents ?? []) if (a.run === run && a.status === 'failed') seen.add(`${reg!.session}|${a.key}`)
  return seen.size
}

export const runningOf = (reg: SessionRegistry | null): RegistryAgent[] => (reg ? reg.agents.filter(a => a.status === 'running') : [])

const change = (reg: SessionRegistry, agents: RegistryAgent[], now: number): SessionRegistry => ({ ...reg, agents, updatedAt: now })

export type CallStart = {
  /** tool_use_id de l'appel Agent. */
  key: string
  name: string
  model?: string
  subagentType?: string
  prompt?: string
  isBackground: boolean
  /** L'agent qui lance (`agentId` de l'appel) ; absent pour le fil principal. */
  parent?: string
  workflow?: string
  run?: string
  /** Ce que flow-board a lui-même demandé à ce moment (revue de sécurité, revue du groupe…), pour son type. */
  asked?: AgentType
}

/** Un appel Agent part : un sous-agent au travail, sans limite de nombre. Un appel déjà connu ne change rien. */
export const startCall = (reg: SessionRegistry, start: CallStart, now: number): SessionRegistry | null => {
  if (reg.agents.some(a => a.key === start.key)) return null
  const row: RegistryAgent = {
    key: start.key,
    name: cut(start.name.trim() || 'Sous-agent', NAME_MAX),
    isBackground: start.isBackground,
    status: 'running',
    startedAt: now,
    source: 'live',
  }
  if (start.parent !== undefined) row.parent = start.parent
  if (start.workflow !== undefined) row.workflow = start.workflow
  if (start.subagentType !== undefined && start.subagentType !== '') row.subagentType = start.subagentType
  // Les secrets du prompt sont masqués avant d'être gardés (S16).
  // Seule la tranche gardée (plus de quoi finir un jeton coupé) passe au masque. Le masque raccourcit
  // le texte : le bout coupé en fin de tranche, trop court pour être reconnu, ne doit pas remonter
  // dans ce qui est gardé. Il reste donc toujours au moins la marge après la coupe.
  if (start.prompt !== undefined && start.prompt !== '') {
    const slice = start.prompt.slice(0, PROMPT_MAX + PROMPT_MARGIN)
    const masked = maskSecrets(slice)
    const keep = slice.length < start.prompt.length ? Math.max(1, Math.min(PROMPT_MAX, masked.length - PROMPT_MARGIN)) : PROMPT_MAX
    row.prompt = cut(masked, keep)
  }
  if (start.model !== undefined && start.model !== '') row.model = start.model
  if (start.run !== undefined) row.run = start.run
  row.type = agentTypeOf(row.subagentType, start.asked, row.name)
  return change(reg, [...reg.agents, row], now)
}

/**
 * Les segments d'un sous-agent qui finit, fermés à `now` (comme closeOpen sur sa piste) : une fin
 * vue par l'appel ou rattrapée par la liste du moteur ne laisse rien s'allonger sans fin. Rien
 * quand aucun n'est ouvert.
 */
const closedSegments = (a: RegistryAgent, now: number): Pick<RegistryAgent, 'segments'> =>
  a.segments?.some(s => s.e === undefined) ? { segments: a.segments.map(s => (s.e === undefined ? { ...s, e: Math.max(now, s.s) } : s)) } : {}

export type CallEnd = { agentId?: string; model?: string; isFailed: boolean; isFinished: boolean; isCancelled?: boolean }

/**
 * L'appel Agent rend : l'id du sous-agent est connu ; il est fini s'il a rendu « completed »,
 * échoué ou annulé si l'appel l'est. Une entrée créée entre-temps pour le même id (son
 * `agent.spawn`, vu avant le retour de l'appel) se fond dans celle de l'appel.
 */
export const endCall = (reg: SessionRegistry, key: string, end: CallEnd, now: number): SessionRegistry | null => {
  const own = reg.agents.find(a => a.key === key)
  if (!own) return null
  // Seule une entrée née d'un `agent.spawn` (clé `agent:<id>`) se fond ; l'entrée d'un autre appel reste à elle.
  const twin = end.agentId !== undefined ? reg.agents.find(a => a.key === `agent:${end.agentId}`) : undefined
  const status: AgentStatus = end.isCancelled ? 'cancelled' : end.isFailed ? 'failed' : end.isFinished ? 'done' : own.status
  const isEnded = end.isCancelled === true || end.isFailed || end.isFinished
  const next: RegistryAgent = {
    ...(twin ?? {}),
    ...own,
    ...(end.agentId !== undefined ? { agentId: end.agentId } : {}),
    ...(end.model !== undefined && end.model !== '' ? { model: end.model } : twin?.model !== undefined && own.model === undefined ? { model: twin.model } : {}),
    status: twin && !isEnded ? twin.status : status,
  }
  if (isEnded) Object.assign(next, closedSegments(next, now), { finishedAt: now })
  else if (twin?.finishedAt !== undefined) next.finishedAt = twin.finishedAt
  return change(
    reg,
    reg.agents.filter(a => a !== twin).map(a => (a === own ? next : a)),
    now,
  )
}

export type Spawn = {
  agentId: string
  /** Le `tool_use_id` de l'appel Agent qui le lance (`agent.spawn`). */
  callKey?: string
  parent?: string
  name?: string
  subagentType?: string
  model?: string
  isBackground: boolean
  workflow?: string
  run?: string
  /** Un coéquipier d'une équipe d'agents (`teammate` de `agent.spawn`) : type « Autre » (user story 38). */
  isTeammate?: boolean
}

/**
 * `agent.spawn` : le premier d'un id donne son identité ; un suivant est un réveil (l'agent
 * reçoit la notification d'une de ses tâches) qui le rouvre. Un id inconnu se rattache à l'appel
 * en cours (`inFlight`) de même description, sinon il devient une entrée à lui (Workflow).
 */
export const spawnAgent = (reg: SessionRegistry, spawn: Spawn, inFlight: ReadonlySet<string>, now: number): SessionRegistry | null => {
  const known = reg.agents.find(a => a.agentId === spawn.agentId)
  if (known) {
    if (known.status === 'running') return null
    const woken: RegistryAgent = { ...known, status: 'running', wakes: (known.wakes ?? 0) + 1 }
    delete woken.finishedAt
    delete woken.isEndUnseen
    return change(reg, reg.agents.map(a => (a === known ? woken : a)), now)
  }
  // L'appel qu'il sert, par son `tool_use_id` ; sans lui (version qui ne le donne pas), par sa
  // description parmi les appels en vol. Jamais pour un agent de Workflow, qui a son entrée à lui.
  const pending = reg.agents.filter(a => a.agentId === undefined && a.status === 'running' && inFlight.has(a.key))
  const call =
    spawn.workflow !== undefined
      ? undefined
      : spawn.callKey !== undefined
        ? reg.agents.find(a => a.key === spawn.callKey && a.agentId === undefined)
        : pending.find(a => spawn.name !== undefined && a.name === cut(spawn.name.trim(), NAME_MAX))
  if (call) {
    const named: RegistryAgent = { ...call, agentId: spawn.agentId }
    if (spawn.isTeammate === true) named.type = 'other'
    if (named.model === undefined && spawn.model) named.model = spawn.model
    if (named.parent === undefined && spawn.parent !== undefined) named.parent = spawn.parent
    return change(reg, reg.agents.map(a => (a === call ? named : a)), now)
  }
  const started = startCall(
    reg,
    {
      key: `agent:${spawn.agentId}`,
      name: spawn.name ?? '',
      model: spawn.model,
      subagentType: spawn.subagentType,
      // Jamais le prompt d'un `agent.spawn` : à un réveil, c'est la notification d'un enfant,
      // donc son rapport (Q8). Le prompt vient de l'appel Agent seul.
      isBackground: spawn.isBackground,
      parent: spawn.parent,
      workflow: spawn.workflow,
      run: spawn.run,
    },
    now,
  )
  return started && change(started, started.agents.map(a => (a.key === `agent:${spawn.agentId}` ? { ...a, agentId: spawn.agentId } : a)), now)
}

/**
 * Fin d'un tour du sous-agent (`classic.SubagentStop`, `turn.complete` portant son id) : il est
 * fini, jusqu'à un éventuel réveil. Une fin seulement constatée (liste du moteur) prend l'heure
 * de cette vraie fin. Un id inconnu est un agent interne du moteur : ignoré.
 */
export const stopAgent = (reg: SessionRegistry, agentId: string, now: number): SessionRegistry | null => {
  const known = reg.agents.find(a => a.agentId === agentId && (a.status === 'running' || a.isEndUnseen === true))
  if (!known) return null
  const stopped: RegistryAgent = { ...known, status: known.status === 'running' ? 'done' : known.status, finishedAt: now }
  delete stopped.isEndUnseen
  return change(reg, reg.agents.map(a => (a === known ? stopped : a)), now)
}

/** Un sous-agent tel que `$.agent.list()` le donne. */
export type LiveAgentInfo = { id: string; description: string; status: string }

const ENDED: Record<string, AgentStatus> = { completed: 'done', failed: 'failed', killed: 'cancelled' }

/**
 * Rattrape les fins manquées, dans toute session : un sous-agent « au travail » absent de la
 * liste, ou qu'elle dit fini, est fini (fin constatée après coup). `inFlight` garde les appels pas
 * encore rendus ; `own` limite le rattrapage aux sous-agents que ce processus connaît (pas ceux
 * qu'un autre processus de la même session a écrits et que la fusion a apportés).
 */
export const reconcileAgents = (
  reg: SessionRegistry,
  live: readonly LiveAgentInfo[],
  inFlight: ReadonlySet<string>,
  own: ReadonlySet<string>,
  now: number,
): SessionRegistry | null => {
  const taken = new Set(reg.agents.map(a => a.agentId).filter((id): id is string => id !== undefined))
  let moved = 0
  const agents = reg.agents.map(a => {
    if (a.status !== 'running' || inFlight.has(a.key) || !own.has(a.key)) return a
    const found = a.agentId !== undefined ? live.find(x => x.id === a.agentId) : live.find(x => !taken.has(x.id) && x.description === a.name)
    if (found && a.agentId === undefined) taken.add(found.id)
    const ended = found ? ENDED[found.status] : 'done'
    if (ended === undefined) return found && a.agentId === undefined ? { ...a, agentId: found.id } : a
    moved += 1
    return { ...a, ...closedSegments(a, now), agentId: a.agentId ?? found?.id, status: ended, finishedAt: now, isEndUnseen: true }
  })
  return moved === 0 ? null : change(reg, agents, now)
}

/** Où en est un sous-agent : ses réveils d'abord, puis fini plutôt qu'au travail, puis une vraie fin plutôt qu'une fin constatée. */
const progress = (a: RegistryAgent): number =>
  (a.wakes ?? 0) * 10 + (a.status === 'running' ? 0 : a.isEndUnseen === true ? 1 : 2)

/**
 * Fusionne le registre de ce processus avec celui du fichier (S7) : union par clé d'appel, et pour
 * une même clé l'état le plus avancé l'emporte (à égalité, celui d'ici). L'en-tête est celui d'ici,
 * complété par le fichier. Rend `local` tel quel quand le fichier n'apporte rien.
 */
export const mergeRegistry = (local: SessionRegistry, stored: SessionRegistry | null): SessionRegistry => {
  if (!stored || stored.session !== local.session) return local
  let isChanged = false
  const byKey = new Map(local.agents.map(a => [a.key, a]))
  for (const theirs of stored.agents) {
    const mine = byKey.get(theirs.key)
    // À égalité, celui d'ici, sauf si seul le fichier sait déjà quel sous-agent l'appel a lancé.
    const isTieWithId = mine !== undefined && progress(theirs) === progress(mine) && mine.agentId === undefined && theirs.agentId !== undefined
    if (mine === undefined || progress(theirs) > progress(mine) || isTieWithId) {
      byKey.set(theirs.key, theirs)
      isChanged = true
    }
  }
  // Une entrée née d'un `agent.spawn` (clé `agent:<id>`) qu'un appel a absorbée, d'un côté ou de
  // l'autre, ne revient pas : le même sous-agent ne compte qu'une fois.
  const called = new Set([...byKey.values()].filter(a => a.agentId !== undefined && a.key !== `agent:${a.agentId}`).map(a => `agent:${a.agentId}`))
  for (const key of called) {
    if (!byKey.has(key)) continue
    byKey.delete(key)
    isChanged = isChanged || local.agents.some(a => a.key === key)
  }
  const header = {
    title: local.title ?? stored.title,
    transcript: local.transcript ?? stored.transcript,
    run: local.run ?? stored.run,
    group: local.group ?? stored.group,
  }
  const isHeaderChanged = (Object.keys(header) as (keyof typeof header)[]).some(k => header[k] !== local[k])
  // Les sessions liées lancées par l'un ou l'autre processus (S7) : union par id de lancement.
  const launches = [...(local.linked ?? [])]
  for (const l of stored.linked ?? []) if (!launches.some(x => x.id === l.id)) launches.push(l)
  const isLinkedChanged = launches.length !== (local.linked ?? []).length
  // Les parcours portés, notés par l'un ou l'autre processus (S28) : union.
  const carried = [...new Set([...(local.carried ?? []), ...(stored.carried ?? [])])]
  const spans = mergeSpans(local.carriedAt, stored.carriedAt)
  const notedAt = Math.max(local.carriedNotedAt ?? -Infinity, stored.carriedNotedAt ?? -Infinity)
  const isCarriedChanged =
    carried.length !== (local.carried ?? []).length ||
    Object.entries(spans).some(([id, s]) => !sameSpans(local.carriedAt?.[id], s)) ||
    (Number.isFinite(notedAt) && notedAt !== local.carriedNotedAt)
  // La piste de l'orchestrateur se fusionne aussi (S12), et la ligne advisor.
  const main = mergeLane(local.main, stored.main)
  const advisor = mergeAdvisor(local.advisor, stored.advisor)
  if (!isChanged && !isHeaderChanged && !isLinkedChanged && !isCarriedChanged && main === local.main && advisor === local.advisor) return local
  const merged: SessionRegistry = {
    ...local,
    agents: [...byKey.values()].sort((a, b) => a.startedAt - b.startedAt),
    updatedAt: Math.max(local.updatedAt, stored.updatedAt),
  }
  if (main !== undefined) merged.main = main
  if (advisor !== undefined) merged.advisor = advisor
  if (launches.length > 0) merged.linked = launches.sort((a, b) => a.at - b.at)
  if (carried.length > 0) merged.carried = carried
  if (Object.keys(spans).length > 0) merged.carriedAt = spans
  if (Object.keys(spans).length > 0 && Number.isFinite(notedAt)) merged.carriedNotedAt = notedAt
  for (const k of Object.keys(header) as (keyof typeof header)[]) {
    const value = header[k]
    if (value !== undefined) merged[k] = value
  }
  return merged
}

/**
 * La piste de l'orchestrateur de deux processus de la même session (S12) : union des segments
 * (même sorte et même début : un seul, fermé de préférence) et des repères, sans doublon. Rend
 * `mine` tel quel quand l'autre n'apporte rien.
 */
const mergeLane = (mine: AgentLane | undefined, theirs: AgentLane | undefined): AgentLane | undefined => {
  if (!theirs) return mine
  if (!mine) return theirs
  let isChanged = false
  // La clé d'union (sorte et début) d'un segment change après coup, et une écriture d'avant le
  // changement garde l'ancienne copie, ouverte, qui s'allongerait jusqu'à la fin du tour :
  // - un appel court réuni à l'appel court qui le précède (closeSegment, essai point 13) ;
  // - l'appel Agent qui a attendu son sous-agent, passé de « tool » à « waitAgent » à son retour.
  // Cette copie ne revient pas, d'un côté comme de l'autre.
  const all = [...(mine.segments ?? []), ...(theirs.segments ?? [])]
  const fused = all.filter(f => f.k === 'tool' && f.e !== undefined && (f.n ?? 1) > 1)
  const waited = new Set(all.filter(f => f.k === 'waitAgent').map(f => f.s))
  const isStale = (s: AgentSegment): boolean =>
    s.k === 'tool' && s.e === undefined && (waited.has(s.s) || fused.some(f => f.f === s.f && f.s < s.s && s.s <= f.e!))
  const segs = new Map((mine.segments ?? []).map(s => [`${s.k}|${s.s}`, s]))
  for (const s of theirs.segments ?? []) {
    const key = `${s.k}|${s.s}`
    const own = segs.get(key)
    if (isStale(s)) continue
    // Fermé plutôt qu'ouvert ; entre deux fermés, celui qui a réuni le plus d'appels.
    if (own === undefined || (own.e === undefined && s.e !== undefined) || (own.e !== undefined && s.e !== undefined && (s.n ?? 1) > (own.n ?? 1))) {
      segs.set(key, s)
      isChanged = true
    }
  }
  for (const [key, s] of segs) {
    if (!isStale(s)) continue
    segs.delete(key)
    isChanged = true
  }
  const marks = new Map((mine.marks ?? []).map(m => [`${m.k}|${m.at}|${m.to ?? ''}`, m]))
  for (const m of theirs.marks ?? []) {
    const key = `${m.k}|${m.at}|${m.to ?? ''}`
    if (!marks.has(key)) {
      marks.set(key, m)
      isChanged = true
    }
  }
  if (!isChanged) return mine
  return { ...mine, segments: [...segs.values()].sort((a, b) => a.s - b.s), marks: [...marks.values()].sort((a, b) => a.at - b.at) }
}

/**
 * Un appel connu complété par un autre relevé du même appel : la fin quand elle manquait, le
 * modèle et les tokens quand ils manquaient, la marque « relu ». null quand l'autre n'apporte rien.
 */
const fillCall = (own: AdvisorCall, other: AdvisorCall): AdvisorCall | null => {
  const next: AdvisorCall = { ...own }
  if (own.e === undefined && other.e !== undefined) next.e = Math.max(own.s, other.e)
  if (own.model === undefined && other.model !== undefined) next.model = other.model
  if (own.tokens === undefined && other.tokens !== undefined) next.tokens = other.tokens
  if (own.isRead !== true && other.isRead === true) next.isRead = true
  return next.e !== own.e || next.model !== own.model || next.tokens !== own.tokens || next.isRead !== own.isRead ? next : null
}

/**
 * Des appels ajoutés à la ligne advisor : un appel déjà connu (même id) est complété, un nouveau
 * s'ajoute ; ADVISOR_CALLS_MAX au plus, les plus récents. `lane` tel quel quand rien ne change.
 */
const withCalls = (lane: AdvisorLane | undefined, calls: readonly AdvisorCall[]): AdvisorLane | undefined => {
  if (calls.length === 0) return lane
  const byId = new Map((lane?.calls ?? []).map(c => [c.id, c]))
  let isChanged = false
  for (const c of calls) {
    const own = byId.get(c.id)
    const next = own === undefined ? c : fillCall(own, c)
    if (next === null) continue
    byId.set(c.id, next)
    isChanged = true
  }
  return isChanged ? { calls: [...byId.values()].sort((a, b) => a.s - b.s).slice(-ADVISOR_CALLS_MAX) } : lane
}

/** La ligne advisor de deux processus de la même session : union des appels par id, chacun complété par l'autre. */
const mergeAdvisor = (mine: AdvisorLane | undefined, theirs: AdvisorLane | undefined): AdvisorLane | undefined =>
  theirs ? withCalls(mine, theirs.calls) : mine

/**
 * Les appels à l'advisor qu'un transcript donne pour l'appelant `by` : chacun complète l'appel vu
 * en direct (même id), ou s'ajoute quand le direct ne l'a pas vu (discussion passée, autre
 * processus). Les tokens de l'advisor ne vont jamais sur la piste de l'appelant. null quand rien ne change.
 */
export const catchUpAdvisor = (reg: SessionRegistry, by: string, found: readonly AdvisorFigures[] | undefined, now: number): SessionRegistry | null => {
  const advisor = withCalls(reg.advisor, (found ?? []).map(c => ({ ...c, by, isRead: true })))
  return advisor === reg.advisor || advisor === undefined ? null : { ...reg, advisor, updatedAt: now }
}

// ─── Morceaux du registre (R1) ────────────────────────────────────────────
//
// Une lecture ou une écriture de plus de 4 Mio est refusée : au-delà de PART_MAX_BYTES, le
// registre d'une session se découpe en morceaux numérotés, sans rien compacter ni perdre.
// - L'unité est un sous-agent, un segment ou un repère de la piste de l'orchestrateur.
// - Chacune garde le morceau où elle a été lue ; une nouvelle va au dernier ; le trop-plein d'un
//   morceau (ses unités les plus récentes) monte au suivant, jamais l'inverse. Écrits du dernier au
//   premier, les morceaux ne perdent rien si une écriture se coupe : une unité qui monte est en
//   double un instant, et la lecture n'en garde qu'une.

/** La taille d'un morceau, en octets : loin sous les 4 Mio d'une écriture. */
export const PART_MAX_BYTES = 3_000_000
/** Au plus tant de morceaux par session (près de 200 Mo) : un nombre lu au-delà est abîmé (F3). */
export const PARTS_MAX = 64

/** La longueur d'un texte en octets UTF-8, comme les 4 Mio des lectures et écritures la comptent. */
export const utf8Length = (text: string): number => {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4
      i += 1
    } else n += 3
  }
  return n
}

const agentUnit = (a: RegistryAgent): string => `a|${a.key}`
const segmentUnit = (s: AgentSegment): string => `m|${s.k}|${s.s}`
const markUnit = (m: AgentMark): string => `k|${m.k}|${m.at}|${m.to ?? ''}`

/** Un morceau lu entrée par entrée (F3) ; null quand il ne se lit pas. */
export const cleanPart = (value: unknown): RegistryPart | null => {
  if (!isObject(value) || value.v !== 1 || !isText(value.session) || !isNum(value.part) || value.part < 1 || value.part >= PARTS_MAX || !Array.isArray(value.agents)) return null
  const part: RegistryPart = { v: 1, session: value.session, part: Math.floor(value.part), agents: cleanList(value.agents, cleanAgent)! }
  if (isObject(value.main)) {
    const lane = cleanLane(value.main)
    part.main = { ...(lane.segments ? { segments: lane.segments } : {}), ...(lane.marks ? { marks: lane.marks } : {}) }
  }
  return part
}

/** Le morceau d'un texte de fichier, ou null. */
export const parsePart = (text: unknown): RegistryPart | null => {
  if (typeof text !== 'string') return cleanPart(text)
  try {
    return cleanPart(JSON.parse(text))
  } catch {
    return null
  }
}

/**
 * Réunit le premier morceau (l'en-tête) et les suivants : union comme la fusion de S7. Un morceau
 * absent ou illisible (null) est sauté. `placed` dit, pour chaque unité, le morceau où elle est.
 */
export const joinRegistry = (head: SessionRegistry, parts: readonly (RegistryPart | null | undefined)[]): { reg: SessionRegistry; placed: Map<string, number> } => {
  const placed = new Map<string, number>()
  const note = (agents: readonly RegistryAgent[], main: Pick<AgentLane, 'segments' | 'marks'> | undefined, at: number) => {
    const put = (unit: string) => placed.set(unit, Math.max(at, placed.get(unit) ?? 0))
    for (const a of agents) put(agentUnit(a))
    for (const seg of main?.segments ?? []) put(segmentUnit(seg))
    for (const m of main?.marks ?? []) put(markUnit(m))
  }
  note(head.agents, head.main, 0)
  let reg = head
  for (const p of parts) {
    if (!p || p.session !== head.session) continue
    note(p.agents, p.main, p.part)
    reg = mergeRegistry(reg, { ...reg, agents: p.agents, main: p.main })
  }
  return { reg, placed }
}

type Unit = { id: string; at: number; bytes: number; agent?: RegistryAgent; segment?: AgentSegment; mark?: AgentMark }

/**
 * Découpe le registre en morceaux de moins de `max` octets : le premier porte l'en-tête et le
 * nombre de morceaux, jamais moins que `minParts` (un morceau vidé reste, pour qu'un ancien n'y
 * survive pas). Une unité plus grosse qu'un morceau à elle seule y reste seule.
 */
export const splitRegistry = (
  reg: SessionRegistry,
  placed: ReadonlyMap<string, number>,
  max: number = PART_MAX_BYTES,
  minParts: number = reg.parts ?? 1,
): { head: SessionRegistry; parts: RegistryPart[] } => {
  const size = (x: unknown) => utf8Length(JSON.stringify(x)) + 1
  const units: Unit[] = [
    ...reg.agents.map(a => ({ id: agentUnit(a), at: a.startedAt, bytes: size(a), agent: a })),
    ...(reg.main?.segments ?? []).map(seg => ({ id: segmentUnit(seg), at: seg.s, bytes: size(seg), segment: seg })),
    ...(reg.main?.marks ?? []).map(m => ({ id: markUnit(m), at: m.at, bytes: size(m), mark: m })),
  ]
  const known = units.map(u => placed.get(u.id)).filter((i): i is number => i !== undefined)
  // Une boucle, pas `Math.max(...known)` : au-delà de 100 000 unités, l'étalement lève une erreur.
  let last = 0
  for (const i of known) if (i > last) last = i
  const bins: Unit[][] = [[]]
  for (const u of units) (bins[placed.get(u.id) ?? last] ??= []).push(u)
  const emptyMain = reg.main ? { ...reg.main, segments: [], marks: [] } : undefined
  const headBytes = size({ ...reg, agents: [], main: emptyMain, parts: 1_000_000 })
  const partBytes = size({ v: 1, session: reg.session, part: 1_000_000, agents: [], main: { segments: [], marks: [] } })
  for (let i = 0; i < bins.length; i++) {
    const bin = (bins[i] ??= []).sort((a, b) => a.at - b.at)
    const budget = max - (i === 0 ? headBytes : partBytes)
    let total = bin.reduce((n, u) => n + u.bytes, 0)
    while (total > budget && bin.length > 1) {
      const u = bin.pop()!
      total -= u.bytes
      ;(bins[i + 1] ??= []).push(u)
    }
  }
  const count = Math.max(bins.length, minParts)
  const take = (bin: readonly Unit[]) => ({
    agents: bin.flatMap(u => (u.agent ? [u.agent] : [])),
    segments: bin.flatMap(u => (u.segment ? [u.segment] : [])),
    marks: bin.flatMap(u => (u.mark ? [u.mark] : [])),
  })
  const first = take(bins[0] ?? [])
  const head: SessionRegistry = { ...reg, agents: first.agents }
  if (reg.main) head.main = { ...reg.main, segments: first.segments, marks: first.marks }
  if (count > 1) head.parts = count
  else delete head.parts
  const parts: RegistryPart[] = []
  for (let i = 1; i < count; i++) {
    const bin = take(bins[i] ?? [])
    const part: RegistryPart = { v: 1, session: reg.session, part: i, agents: bin.agents }
    if (bin.segments.length > 0 || bin.marks.length > 0) part.main = { segments: bin.segments, marks: bin.marks }
    parts.push(part)
  }
  return { head, parts }
}

/**
 * Les lignes de l'ancien champ des sous-agents d'un parcours (S1), en entrées du registre
 * rattachées à ce parcours ; aucune pour un parcours qui ne l'a pas.
 */
export const rowsFromRun = (run: Run): RegistryAgent[] =>
  (Array.isArray(run.agents) ? run.agents : []).flatMap(a => {
    const row = cleanAgent({ ...a, source: 'live', run: run.id })
    if (!row) return []
    row.type = agentTypeOf(undefined, undefined, row.name)
    return [row]
  })

/** Une session liée lancée par cette session (`start_session`, `claude --bg`) ; un lancement déjà connu ne change rien. */
export const noteLaunch = (reg: SessionRegistry, launch: LinkedLaunch, now: number): SessionRegistry | null =>
  (reg.linked ?? []).some(l => l.id === launch.id) ? null : { ...reg, linked: [...(reg.linked ?? []), launch], updatedAt: now }

/** Met à jour l'en-tête ; rien quand il est déjà tel. */
export const withHeader = (
  reg: SessionRegistry,
  patch: Partial<Pick<SessionRegistry, 'root' | 'title' | 'transcript' | 'run' | 'group'>>,
): SessionRegistry | null => {
  const keys = (Object.keys(patch) as (keyof typeof patch)[]).filter(k => patch[k] !== undefined && patch[k] !== '' && patch[k] !== reg[k])
  if (keys.length === 0) return null
  const next = { ...reg }
  for (const k of keys) next[k] = patch[k] as string
  return next
}

// ─── Pistes de la frise ───────────────────────────────────────────────────
//
// Une piste est celle d'un sous-agent (son agentId) ou celle de la session elle-même (MAIN).

/** La piste de la session elle-même : l'orchestrateur. */
export const MAIN = 'main'

/** Deux outils consécutifs d'une même famille, chacun de moins de SHORT_MS, se réunissent (essai, point 13). */
const SHORT_MS = 1_000

const laneOf = (reg: SessionRegistry, lane: string): AgentLane | undefined =>
  lane === MAIN ? (reg.main ?? {}) : reg.agents.find(a => a.agentId === lane)

const withLane = (reg: SessionRegistry, lane: string, next: AgentLane, now: number): SessionRegistry => {
  // Aucune clé à undefined : seules les clés données changent.
  const patch = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as AgentLane
  return lane === MAIN
    ? { ...reg, main: { ...(reg.main ?? {}), ...patch }, updatedAt: now }
    : { ...reg, agents: reg.agents.map(a => (a.agentId === lane ? { ...a, ...patch } : a)), updatedAt: now }
}

/** Ouvre un segment, sans fin : il s'allonge jusqu'à maintenant. Une piste inconnue ne change rien. */
export const openSegment = (reg: SessionRegistry, lane: string, seg: AgentSegment, now: number): SessionRegistry | null => {
  const l = laneOf(reg, lane)
  return l ? withLane(reg, lane, { segments: [...(l.segments ?? []), seg] }, now) : null
}

/**
 * Ferme, à `end`, le dernier segment ouvert de la piste qui répond à `match`, complété par `patch`.
 * Un outil court qui suit un outil court de la même famille s'y fond (`n` : le nombre d'appels).
 */
export const closeSegment = (
  reg: SessionRegistry,
  lane: string,
  match: (s: AgentSegment) => boolean,
  end: number,
  patch: Partial<AgentSegment> = {},
): SessionRegistry | null => {
  const segs = laneOf(reg, lane)?.segments ?? []
  let at = -1
  for (let i = segs.length - 1; i >= 0 && at < 0; i--) if (segs[i]!.e === undefined && match(segs[i]!)) at = i
  if (at < 0) return null
  const closed: AgentSegment = { ...segs[at]!, ...patch, e: Math.max(end, segs[at]!.s) }
  const prev = at > 0 ? segs[at - 1] : undefined
  const isShort = (s: AgentSegment) => s.e !== undefined && s.e - s.s < SHORT_MS && s.x !== true
  if (closed.k === 'tool' && prev?.k === 'tool' && prev.f === closed.f && isShort(prev) && isShort(closed) && at === segs.length - 1) {
    const merged: AgentSegment = { ...prev, e: closed.e, n: (prev.n ?? 1) + 1 }
    return withLane(reg, lane, { segments: [...segs.slice(0, at - 1), merged] }, end)
  }
  return withLane(reg, lane, { segments: segs.map((s, i) => (i === at ? closed : s)) }, end)
}

/**
 * Ferme à `end` tous les segments encore ouverts de la piste (sauf ceux que `keep` garde) : un
 * tour fini, interrompu ou en erreur ne laisse rien s'allonger sans fin.
 */
export const closeOpen = (reg: SessionRegistry, lane: string, end: number, keep: (s: AgentSegment) => boolean = () => false): SessionRegistry | null => {
  const segs = laneOf(reg, lane)?.segments ?? []
  if (!segs.some(s => s.e === undefined && !keep(s))) return null
  return withLane(reg, lane, { segments: segs.map(s => (s.e === undefined && !keep(s) ? { ...s, e: Math.max(end, s.s) } : s)) }, end)
}

/** Un outil que l'API a lancé elle-même dans une requête (`serverToolUses` d'une étape). */
export type ServerToolUse = { id: string; name: string; startedAt: number; endedAt?: number }

/**
 * La réflexion ou la rédaction qui couvrait un appel à l'advisor s'y coupe : l'agent attendait
 * l'advisor ; l'attente « consulte l'advisor » prend sa place.
 */
const cutForAdvisor = (segs: readonly AgentSegment[], call: AdvisorCall & { e: number }): AgentSegment[] => {
  const out: AgentSegment[] = []
  for (const seg of segs) {
    if ((seg.k === 'think' || seg.k === 'write') && seg.e !== undefined && seg.s < call.e && seg.e > call.s) {
      if (call.s > seg.s) out.push({ ...seg, e: call.s })
      if (seg.e > call.e) out.push({ ...seg, s: call.e })
    } else out.push(seg)
  }
  out.push({ k: 'waitAdvisor', s: call.s, e: call.e, t: 'advisor' })
  return out.sort((a, b) => a.s - b.s)
}

/**
 * Les appels à l'advisor d'une étape du modèle de la piste `lane`, appris à sa fin : chacun sur la
 * ligne advisor (sa fin, ou celle de l'étape quand elle manque), et sur la piste de l'appelant une
 * attente « consulte l'advisor » dans le même intervalle. Un appel déjà noté ne compte qu'une
 * fois ; null quand rien ne change.
 */
export const addAdvisorCalls = (reg: SessionRegistry, lane: string, uses: readonly ServerToolUse[], stepEnd: number): SessionRegistry | null => {
  const known = new Set((reg.advisor?.calls ?? []).map(c => c.id))
  const calls = uses
    .filter(u => u.name === 'advisor' && isText(u.id) && !known.has(u.id) && isNum(u.startedAt))
    .map(u => ({ id: u.id, s: u.startedAt, e: Math.max(u.startedAt, isNum(u.endedAt) ? u.endedAt : stepEnd), by: lane }))
  if (calls.length === 0) return null
  const advisor: AdvisorLane = { ...(reg.advisor ?? {}), calls: [...(reg.advisor?.calls ?? []), ...calls].sort((a, b) => a.s - b.s).slice(-ADVISOR_CALLS_MAX) }
  const next: SessionRegistry = { ...reg, advisor, updatedAt: stepEnd }
  const l = laneOf(next, lane)
  if (!l) return next
  return withLane(next, lane, { segments: calls.reduce<AgentSegment[]>((segs, c) => cutForAdvisor(segs, c), [...(l.segments ?? [])]) }, stepEnd)
}

/**
 * L'heure de la dernière compaction de la discussion : le plus récent repère ⇣ de la piste de
 * l'orchestrateur, que seule une vraie compaction pose ; null sans repère ni registre.
 */
export const lastCompactionAt = (reg: SessionRegistry | null | undefined): number | null => {
  const ats = (reg?.main?.marks ?? []).filter(m => m.k === 'compact').map(m => m.at)
  return ats.length > 0 ? ats.reduce((a, b) => (b > a ? b : a)) : null
}

/** Pose un repère sur la piste. */
export const addMark = (reg: SessionRegistry, lane: string, mark: AgentMark, now: number): SessionRegistry | null => {
  const l = laneOf(reg, lane)
  return l ? withLane(reg, lane, { marks: [...(l.marks ?? []), mark] }, now) : null
}

/** La piste d'un sous-agent par sa clé d'appel : son id, pour poser segments et repères. */
export const laneIdOf = (reg: SessionRegistry, key: string): string | undefined => reg.agents.find(a => a.key === key)?.agentId

export type ToolEnd = {
  /** Fin de l'appel. */
  end: number
  /** Ce que le retour ajoute au segment (argument court, erreur, sorte : attente d'un sous-agent au premier plan). */
  patch?: Partial<AgentSegment>
  /**
   * L'outil a attendu une autorisation (`classic.PermissionRequest` à `at`) et n'a tourné que
   * `execMs` (`duration_ms`) : le segment se coupe, l'attente de la personne au milieu (essai, point 5).
   */
  permission?: { at: number; execMs: number }
  /** Le début du segment de cet appel : des appels parallèles du même outil ne se ferment pas l'un l'autre. */
  start?: number
}

/**
 * Ferme le segment d'un appel d'outil ouvert sur la piste : celui de ce nom qui a commencé à
 * `start`, sinon (aucun, ou début inconnu) le dernier ouvert de ce nom.
 */
export const closeToolCall = (reg: SessionRegistry, lane: string, tool: string, done: ToolEnd): SessionRegistry | null => {
  const isNamed = (s: AgentSegment) => (s.k === 'tool' || s.k === 'waitPerson' || s.k === 'waitAgent') && s.t === tool
  const isOwn = (s: AgentSegment) => isNamed(s) && s.s === done.start
  const isOpen = done.start !== undefined && (laneOf(reg, lane)?.segments ?? []).some(s => s.e === undefined && isOwn(s)) ? isOwn : isNamed
  const p = done.permission
  const execStart = p ? Math.max(p.at, done.end - Math.max(0, p.execMs)) : 0
  if (!p || execStart <= p.at) return closeSegment(reg, lane, isOpen, done.end, done.patch)
  const opened = (laneOf(reg, lane)?.segments ?? []).filter(s => s.e === undefined && isOpen(s)).pop()
  const before = closeSegment(reg, lane, isOpen, p.at)
  if (!before || !opened) return before
  const waiting = withLane(before, lane, { segments: [...(laneOf(before, lane)?.segments ?? []), { k: 'waitPerson', s: p.at, e: execStart }] }, done.end)
  const tail: AgentSegment = { ...opened, ...done.patch, s: execStart, e: done.end }
  delete tail.n
  return withLane(waiting, lane, { segments: [...(laneOf(waiting, lane)?.segments ?? []), tail] }, done.end)
}

// ─── Types et chiffres d'un sous-agent ────────────────────────────────────

const BY_SUBAGENT_TYPE: Record<string, AgentType> = {
  'agents:explorer': 'explore',
  explore: 'explore',
  'agents:researcher': 'research',
  'claude-code-guide': 'research',
  'agents:worker': 'implement',
  plan: 'plan',
  teammate: 'other',
}

/**
 * Le type d'un sous-agent (Q9), dans l'ordre : son `subagent_type` ; ce que flow-board a lui-même
 * demandé (`asked` : revue de sécurité, revue du groupe, implémenteur, merger, rétro des sessions
 * liées) ; des mots-clés de sa description ; sinon « Autre » (coéquipiers d'une équipe d'agents compris).
 */
export const agentTypeOf = (subagentType: string | undefined, asked: AgentType | undefined, description: string): AgentType => {
  const byType = subagentType !== undefined ? BY_SUBAGENT_TYPE[subagentType.toLowerCase()] : undefined
  if (byType !== undefined) return byType
  if (asked !== undefined) return asked
  const d = description.toLowerCase()
  if (/s[ée]curit|security/.test(d)) return 'security'
  if (/\bmerg|fusion/.test(d)) return 'merge'
  if (/review|relect|relis|revue|standards|\bspec\b|bogue/.test(d)) return 'review'
  if (/transcript|r[ée]tro/.test(d)) return 'transcripts'
  if (/explor|cartograph|\bmap\b|inventaire|cherche dans le code/.test(d)) return 'explore'
  if (/research|recherch|\bdoc\b|documentation|web|sources?/.test(d)) return 'research'
  if (/\bplan\b|design|alternativ|maquette/.test(d)) return 'plan'
  if (/implement|ticket|#\d|corrig|\bfix/.test(d)) return 'implement'
  return 'other'
}

/** Les tokens d'une réponse du modèle, tels que l'API les rend (usage de `turn.step`). */
export type StepUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; model?: string }

/** Une réponse du modèle de plus sur la piste : ses tokens s'ajoutent, son modèle et l'effort demandé sont relevés. */
export const addUsage = (reg: SessionRegistry, lane: string, usage: StepUsage | null, effort: string | undefined, now: number): SessionRegistry | null => {
  const l = laneOf(reg, lane)
  if (!l || (usage === null && effort === undefined)) return null
  const t = l.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  const next: AgentLane = {
    tokens: usage
      ? { input: t.input + n(usage.input_tokens), output: t.output + n(usage.output_tokens), cacheRead: t.cacheRead + n(usage.cache_read_input_tokens), cacheWrite: t.cacheWrite + n(usage.cache_creation_input_tokens) }
      : t,
  }
  if (usage?.model && !(l.models ?? []).includes(usage.model)) next.models = [...(l.models ?? []), usage.model]
  if (effort !== undefined) next.effort = effort
  return withLane(reg, lane, next, now)
}

/** Des lignes ajoutées et retirées par une modification de fichier de la piste. */
export const addLines = (reg: SessionRegistry, lane: string, added: number, removed: number, now: number): SessionRegistry | null => {
  const l = laneOf(reg, lane)
  if (!l || (added === 0 && removed === 0)) return null
  const was = l.lines ?? { added: 0, removed: 0 }
  return withLane(reg, lane, { lines: { added: was.added + added, removed: was.removed + removed } }, now)
}

/** Les lignes qu'un appel d'outil ajoute et retire (Write : son contenu ; Edit : l'ancien et le nouveau texte). */
export const linesOf = (tool: string, input: Readonly<Record<string, unknown>>): { added: number; removed: number } => {
  const linesIn = (x: unknown): string[] => (typeof x === 'string' && x !== '' ? x.split('\n') : [])
  // Ce qu'un remplacement change vraiment : les lignes communes du début et de la fin ne comptent pas.
  const changed = (before: unknown, after: unknown): { added: number; removed: number } => {
    const a = linesIn(before)
    const b = linesIn(after)
    let head = 0
    while (head < a.length && head < b.length && a[head] === b[head]) head += 1
    let tail = 0
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
    return { added: b.length - head - tail, removed: a.length - head - tail }
  }
  // Write : tout le contenu, l'ancien fichier n'étant pas connu du hook.
  if (tool === 'Write') return { added: linesIn(input.content).length, removed: 0 }
  if (tool === 'Edit') return changed(input.old_string, input.new_string)
  if (tool === 'MultiEdit' && Array.isArray(input.edits))
    return (input.edits as Record<string, unknown>[]).reduce<{ added: number; removed: number }>(
      (sum, e) => {
        const one = changed(e.old_string, e.new_string)
        return { added: sum.added + one.added, removed: sum.removed + one.removed }
      },
      { added: 0, removed: 0 },
    )
  return { added: 0, removed: 0 }
}
