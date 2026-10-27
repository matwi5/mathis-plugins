// Rattrapage par transcripts : les transcripts de Claude Code font foi pour les
// chiffres. Fonctions pures ; la lecture des fichiers vit dans register.tsx.
//
// Ce que les lignes JSONL donnent (vérifié sur le disque le 26/10/2026, noms de champs seulement) :
// - `api-request` : le départ d'une requête au modèle (`timestamp`) ;
// - `assistant` : un bloc de la réponse par ligne (`thinking`, `text`, `tool_use`), à l'heure où il
//   finit ; les blocs d'une même réponse partagent `message.id` et répètent son `usage` ; `effort` ;
// - `user` : les résultats d'outils (`tool_result`, `tool_use_id`, `is_error`) ;
// - `.meta.json` d'un sous-agent : `agentType`, `description`, `toolUseId`, `finished`.
// Les blocs n'ont que l'heure de leur fin : la réflexion va du départ de la requête à la fin de son
// bloc, estimée (`est`), comme le dit la spec.

import type { AgentLane, AgentSegment, AgentTokens, RegistryAgent, SessionRegistry } from '../types'
import { CMD_UNSAFE } from './erase.ts'
import { agentTypeOf, linesOf } from './registry.ts'
import { shortArg, toolFamily } from './timeline.ts'

/** Ce qu'un transcript dit d'une piste : ses segments et chiffres, son début et sa fin. */
export type TranscriptLane = AgentLane & { startedAt?: number; endedAt?: number; toolCount: number }

/** Le `.meta.json` d'un sous-agent. */
export type TranscriptMeta = { agentType?: string; description?: string; toolUseId?: string; isFinished?: boolean; parentAgentId?: string }

/**
 * Un transcript sans ligne depuis plus longtemps, sans `finished` dans son `.meta.json` : son
 * sous-agent a fini (processus planté, agent tué), comme une session fermée (S9, S19).
 */
export const TRANSCRIPT_QUIET_MS = 30 * 60_000

type Line = Record<string, unknown>
const SHORT_MS = 1_000

const timeOf = (line: Line): number | undefined => {
  const t = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN
  return Number.isFinite(t) ? t : undefined
}

/** Les lignes lisibles d'un JSONL ; une ligne coupée ou étrangère est sautée. */
const linesIn = (text: string): Line[] => {
  const out: Line[] = []
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    try {
      const value: unknown = JSON.parse(raw)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) out.push(value as Line)
    } catch {
      // Ligne coupée (écriture en cours) : sautée.
    }
  }
  return out
}

/** Un segment de plus ; un appel court qui suit un appel court de la même famille s'y fond (essai, point 13). */
const push = (segs: AgentSegment[], seg: AgentSegment) => {
  const prev = segs[segs.length - 1]
  const isShort = (s: AgentSegment) => s.e !== undefined && s.e - s.s < SHORT_MS && s.x !== true
  if (seg.k === 'tool' && prev?.k === 'tool' && prev.f === seg.f && isShort(prev) && isShort(seg)) {
    segs[segs.length - 1] = { ...prev, e: seg.e, n: (prev.n ?? 1) + 1 }
    return
  }
  segs.push(seg)
}

/**
 * La piste d'un transcript : celle d'un sous-agent (son fichier entier), ou celle de la session
 * (`isMain` : les lignes hors des sous-agents). Réflexion estimée, rédaction et appels d'outils
 * datés ; tokens comptés une fois par réponse ; modèles, effort, lignes modifiées.
 */
export const laneFromTranscript = (text: string, isMain = false): TranscriptLane => {
  const segs: AgentSegment[] = []
  const tokens: AgentTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const counted = new Set<string>()
  const models: string[] = []
  const lines = { added: 0, removed: 0 }
  const open = new Map<string, { start: number; name: string; input: Record<string, unknown> }>()
  let effort: string | undefined
  let startedAt: number | undefined
  let endedAt: number | undefined
  let prevEnd: number | undefined
  let hasTokens = false
  let toolCount = 0
  for (const line of linesIn(text)) {
    if (isMain && line.isSidechain === true) continue
    const at = timeOf(line)
    if (at === undefined) continue
    if (line.type === 'api-request') {
      prevEnd = at
      startedAt ??= at
      continue
    }
    if (line.type !== 'assistant' && line.type !== 'user') continue
    startedAt ??= at
    endedAt = Math.max(endedAt ?? at, at)
    const message = (line.message ?? {}) as { id?: unknown; model?: unknown; content?: unknown; usage?: Record<string, unknown> }
    const blocks = Array.isArray(message.content) ? (message.content as Record<string, unknown>[]) : []
    if (line.type === 'assistant') {
      if (typeof line.effort === 'string') effort = line.effort
      if (typeof message.model === 'string' && message.model !== '<synthetic>' && !models.includes(message.model)) models.push(message.model)
      const id = typeof message.id === 'string' ? message.id : undefined
      if (id !== undefined && !counted.has(id) && message.usage) {
        counted.add(id)
        hasTokens = true
        const n = (k: string) => (typeof message.usage![k] === 'number' ? (message.usage![k] as number) : 0)
        tokens.input += n('input_tokens')
        tokens.output += n('output_tokens')
        tokens.cacheRead += n('cache_read_input_tokens')
        tokens.cacheWrite += n('cache_creation_input_tokens')
      }
      const from = prevEnd ?? at
      for (const b of blocks) {
        if (b.type === 'thinking') segs.push({ k: 'think', s: from, e: Math.max(from, at), est: true })
        else if (b.type === 'text') segs.push({ k: 'write', s: from, e: Math.max(from, at) })
        else if (b.type === 'tool_use' && typeof b.id === 'string') open.set(b.id, { start: from, name: String(b.name ?? ''), input: (b.input ?? {}) as Record<string, unknown> })
      }
      prevEnd = at
      continue
    }
    // Les résultats d'outils : chaque appel ouvert se ferme à son résultat.
    for (const b of blocks) {
      if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue
      const call = open.get(b.tool_use_id)
      if (!call) continue
      open.delete(b.tool_use_id)
      toolCount += 1
      const isError = b.is_error === true
      const seg: AgentSegment = { k: call.name === 'AskUserQuestion' ? 'waitPerson' : 'tool', s: call.start, e: Math.max(call.start, at), f: toolFamily(call.name), t: call.name }
      const arg = shortArg(call.name, call.input)
      if (arg !== undefined) seg.a = arg
      if (isError) seg.x = true
      push(segs, seg)
      if (!isError) {
        const changed = linesOf(call.name, call.input)
        lines.added += changed.added
        lines.removed += changed.removed
      }
    }
    prevEnd = at
  }
  const lane: TranscriptLane = { segments: segs.sort((a, b) => a.s - b.s), toolCount }
  if (hasTokens) lane.tokens = tokens
  if (models.length > 0) lane.models = models
  if (effort !== undefined) lane.effort = effort
  if (lines.added > 0 || lines.removed > 0) lane.lines = lines
  if (startedAt !== undefined) lane.startedAt = startedAt
  if (endedAt !== undefined) lane.endedAt = endedAt
  return lane
}

/** Le `.meta.json` d'un sous-agent ; un fichier illisible n'apporte rien. */
export const metaFromText = (text: string): TranscriptMeta => {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const meta: TranscriptMeta = {}
    if (typeof raw.agentType === 'string') meta.agentType = raw.agentType
    if (typeof raw.description === 'string') meta.description = raw.description
    if (typeof raw.toolUseId === 'string') meta.toolUseId = raw.toolUseId
    if (typeof raw.finished === 'boolean') meta.isFinished = raw.finished
    if (typeof raw.parentAgentId === 'string' && raw.parentAgentId !== '') meta.parentAgentId = raw.parentAgentId
    return meta
  } catch {
    return {}
  }
}

/** Un sous-agent tel que son transcript le donne : son id, sa piste, son `.meta.json` ; `run` : le parcours repris auquel il appartient (Q14). */
export type TranscriptAgent = { agentId: string; lane: TranscriptLane; meta: TranscriptMeta; run?: string }

/**
 * Le registre complété par les transcripts (le transcript fait foi pour les chiffres) :
 * - un sous-agent connu prend ses tokens, modèles, effort et lignes du transcript ; ses segments
 *   du direct restent (ils portent les attentes d'autorisation), sauf s'il n'en a pas ;
 * - un sous-agent « au travail » que son transcript dit fini l'est, à l'heure de sa dernière ligne ;
 *   une fin constatée après coup prend cette heure ;
 * - un sous-agent inconnu devient une entrée rattrapée (`source: 'transcript'`).
 * `inFlight` : les appels Agent de ce processus encore en vol, que le transcript ne clôt pas. Rend null
 * quand rien ne change.
 */
export const catchUp = (reg: SessionRegistry, found: readonly TranscriptAgent[], now: number, inFlight: ReadonlySet<string> = new Set()): SessionRegistry | null => {
  let isChanged = false
  const agents = [...reg.agents]
  for (const { agentId, lane, meta, run } of found) {
    const at = agents.findIndex(a => a.agentId === agentId || (meta.toolUseId !== undefined && a.key === meta.toolUseId))
    const figures: Partial<RegistryAgent> = {}
    if (lane.tokens) figures.tokens = lane.tokens
    if (lane.models) figures.models = lane.models
    if (lane.effort !== undefined) figures.effort = lane.effort
    if (lane.lines) figures.lines = lane.lines
    // Fini d'après son `.meta.json`, ou faute de ligne depuis TRANSCRIPT_QUIET_MS (le drapeau manque alors).
    const isEnded = meta.isFinished === true || (meta.isFinished === undefined && lane.endedAt !== undefined && now - lane.endedAt > TRANSCRIPT_QUIET_MS)
    if (at < 0) {
      if (lane.startedAt === undefined) continue
      const row: RegistryAgent = {
        key: meta.toolUseId ?? `agent:${agentId}`,
        agentId,
        name: (meta.description ?? '').trim() || 'Sous-agent',
        isBackground: true,
        status: isEnded ? 'done' : 'running',
        startedAt: lane.startedAt,
        source: 'transcript',
        segments: lane.segments ?? [],
        ...figures,
      }
      if (meta.agentType !== undefined && meta.agentType !== '') row.subagentType = meta.agentType
      if (meta.parentAgentId !== undefined) row.parent = meta.parentAgentId
      if (run !== undefined) row.run = run
      row.type = agentTypeOf(row.subagentType, undefined, row.name)
      if (isEnded && lane.endedAt !== undefined) row.finishedAt = lane.endedAt
      agents.push(row)
      isChanged = true
      continue
    }
    const was = agents[at]!
    const next: RegistryAgent = { ...was, ...figures, agentId: was.agentId ?? agentId, ...(was.run === undefined && run !== undefined ? { run } : {}) }
    if ((was.segments ?? []).length === 0 && (lane.segments ?? []).length > 0) next.segments = lane.segments
    const isOpen = inFlight.has(was.key)
    if (isEnded && lane.endedAt !== undefined && !isOpen && (was.status === 'running' || was.isEndUnseen === true)) {
      next.status = was.status === 'running' ? 'done' : was.status
      next.finishedAt = lane.endedAt
      delete next.isEndUnseen
      next.segments = (next.segments ?? []).map(s => (s.e === undefined ? { ...s, e: Math.max(s.s, lane.endedAt!) } : s))
    }
    if (JSON.stringify(next) !== JSON.stringify(was)) {
      agents[at] = next
      isChanged = true
    }
  }
  return isChanged ? { ...reg, agents: agents.sort((a, b) => a.startedAt - b.startedAt), updatedAt: now } : null
}

/** Le dossier des transcripts des sous-agents d'une session, d'après le chemin de son transcript. */
export const subagentsDirOf = (transcript: string): string | null => (/\.jsonl$/.test(transcript) ? `${transcript.replace(/\.jsonl$/, '')}/subagents` : null)

// ─── Garde des chemins (F4) ───────────────────────────────────────────────
//
// Un chemin de transcript vient d'un en-tête de registre (écrit par une autre session) ou d'un
// hook : il n'est lu que sous `<dossier Claude>/projects/`, sans `..`, et un fichier de sous-agent
// n'a qu'un nom strict.

/** Le nom de fichier d'un transcript de sous-agent : `agent-<id>.jsonl`, l'id en lettres, chiffres, `_` et `-`. */
export const SUBAGENT_FILE = /^agent-([A-Za-z0-9_-]+)\.jsonl$/

const isWindowsPath = (path: string): boolean => /^[a-z]:[\\/]/i.test(path)
/** Un chemin Windows absolu : à lettre de lecteur, UNC (`\\serveur\…`) ou long (`\\?\C:\…`, `//?/C:/…`). */
const isWindowsAbsolute = (path: string): boolean => isWindowsPath(path) || /^[\\/]{2}[^\\/]/.test(path)

/**
 * Un transcript qui peut se lire : un `.jsonl` sous `<claudeDir>/projects/`, chemin absolu, sans
 * segment `..` ni `.`. Windows se reconnaît au seul dossier Claude : là, le chemin est comparé sans
 * la casse ni le sens des barres ; ailleurs, un `\` n'est pas un séparateur et le chemin est refusé.
 * Sans dossier Claude connu, aucun.
 */
export const isTranscriptPath = (path: string, claudeDir: string | null): boolean => {
  if (!claudeDir || !/\.jsonl$/i.test(path)) return false
  const isWin = isWindowsAbsolute(claudeDir)
  if (isWin ? !isWindowsAbsolute(path) : !path.startsWith('/') || path.includes('\\')) return false
  const norm = (p: string) => {
    // Les barres doublées comptent pour une : `<dossier>//projects/…` reste sous `<dossier>/projects/`.
    const slashed = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
    // Sous Windows, le préfixe des chemins longs (`\\?\`) ne change pas le fichier visé.
    return isWin ? slashed.replace(/^\/\?\//, '').toLowerCase() : slashed
  }
  const target = norm(path)
  if (target.split('/').some(part => part === '..' || part === '.')) return false
  const base = `${norm(claudeDir).replace(/\/+$/, '')}/projects/`
  return target.startsWith(base) && target.length > base.length
}

/**
 * La commande qui lit un transcript trop gros pour une lecture : `cat --` sur Mac et Linux ; sous
 * Windows `type` par `cmd.exe` : un chemin qui contient un signe qu'il interprète n'a pas de
 * commande (null), avec la même garde que `del` (S4, S30).
 */
export const readArgv = (path: string): string[] | null => {
  if (!isWindowsPath(path)) return ['cat', '--', path]
  return CMD_UNSAFE.test(path) ? null : ['cmd.exe', '/d', '/c', 'type', path.replace(/\//g, '\\')]
}

/**
 * Le texte qu'une commande écrit sur sa sortie, jusqu'à sa fin ou jusqu'à `deadline` : passé ce
 * délai, le flux est abandonné (la commande s'arrête avec lui) et rien n'est rendu (null).
 */
export const drainWithin = async (stream: AsyncIterable<{ stream?: string; text?: unknown }>, deadline: Promise<void>): Promise<string | null> => {
  const it = stream[Symbol.asyncIterator]()
  const late = deadline.then(() => 'late' as const)
  let text = ''
  for (;;) {
    const next = await Promise.race([it.next(), late])
    if (next === 'late') {
      void Promise.resolve(it.return?.()).catch(() => undefined)
      return null
    }
    if (next.done) return text
    if (next.value?.stream === 'stdout') text += String(next.value.text ?? '')
  }
}
