// Frise des agents : des segments datés du registre aux parts à dessiner. Fonctions pures.
//
// - L'axe est en temps réel, sauf les pauses de plus de PAUSE_MS sans aucun segment actif : elles
//   prennent une largeur fixe et portent leur durée (« ⫽ 2 h »).
// - « dernière heure » ouvre l'axe une heure avant maintenant ; « tout » montre tout.
// - Le résumé compte le gain par rapport à une exécution en série sur l'union des périodes
//   d'activité des sous-agents, pour que les heures creuses ne comptent pas.

import type { AgentLane, AgentMark, RegistryAgent, SegmentKind, ToolFamily } from '../types'

/** Une pause plus longue, sans aucun segment actif, est compressée (seuil à régler à l'essai). */
export const PAUSE_MS = 5 * 60_000
export const HOUR_MS = 3_600_000
/** La largeur d'une pause compressée, en part de l'axe ; toutes ensemble n'en prennent pas plus de PAUSES_MAX. */
const PAUSE_SHARE = 0.04
const PAUSES_MAX = 0.24
/** L'argument court d'un outil : de quoi le reconnaître, sans recopier son contenu. */
const ARG_MAX = 80

/** La famille d'un outil, d'après son nom : son glyphe se pose sur le segment. */
export const toolFamily = (name: string): ToolFamily => {
  if (/^(Read|Grep|Glob|LS|NotebookRead|ToolSearch|ListMcpResourcesTool|ReadMcpResourceTool)$/.test(name)) return 'read'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return 'edit'
  if (/^(Bash|PowerShell|BashOutput|KillShell|Monitor|TaskStop)$/.test(name)) return 'run'
  if (/^(WebFetch|WebSearch)$/.test(name)) return 'web'
  if (/^(Agent|Task|SubagentHandback|SendMessage|Workflow)$/.test(name)) return 'agent'
  return 'other'
}

const clipArg = (text: string): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= ARG_MAX ? one : `${one.slice(0, ARG_MAX - 1)}…`
}

/** Les deux derniers éléments d'un chemin : assez pour reconnaître un fichier. */
const tailOfPath = (path: string): string => path.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')

/** Ce qui remplace un secret dans ce que le registre garde (F2, S16). */
export const MASKED = '‹masqué›'

/**
 * Les jetons reconnaissables à leur forme : clés d'API, jetons GitHub, GitLab, Slack, npm, AWS,
 * Google, Stripe (`sk_live_`), Hugging Face (`hf_`), JWT.
 */
const KNOWN_TOKENS =
  /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|hf_[A-Za-z0-9]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|npm_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g
/** Un nom de variable, de champ ou d'option qui dit un secret. */
const SECRET_NAME = '[\\w.-]{0,40}(?:token|passw(?:or)?d|secret|api[_-]?key|access[_-]?key|private[_-]?key|credential)[\\w.-]{0,40}'
/**
 * Une valeur : entre guillemets, en entier (espaces compris, F5), sinon jusqu'au premier blanc.
 * Des guillemets qui ne se ferment pas sur la ligne en 400 signes (jeton long, guillemet ouvert,
 * valeur sur plusieurs lignes) laissent au moins masquer le premier mot (F1 de la revue de
 * sécurité du groupe C, option a).
 */
const VALUE = `(?:"[^"\\n]{0,400}"|'[^'\\n]{0,400}'|["']?[^\\s'"]+)`
/** La valeur masquée, ses guillemets gardés : le fermant seulement s'il était là. */
const maskValue = (value: string): string => {
  const q = value[0]
  if (q !== '"' && q !== "'") return MASKED
  return value.length > 1 && value.endsWith(q) ? `${q}${MASKED}${q}` : `${q}${MASKED}`
}

/**
 * Les secrets d'un texte masqués (F2, S16, F5) : blocs PEM (jusqu'à leur fin, ou celle du texte
 * quand elle est coupée), en-têtes `Authorization` et `Cookie`, `Bearer x` seul, options `--token`,
 * `--password`…, affectations `NOM_DU_SECRET=…`, champs `"api_key": "…"` et `token: …`,
 * `curl -u nom:mot`, `mysql -pmot`, mot de passe d'une adresse, jetons reconnaissables. Une valeur
 * entre guillemets est masquée en entier. Le reste du texte est intact.
 */
export const maskSecrets = (text: string): string =>
  text
    .replace(/-----BEGIN [A-Z0-9 ]{1,60}-----[\s\S]*?(?:-----END [A-Z0-9 ]{1,60}-----|$)/g, MASKED)
    // Une valeur entre guillemets d'abord, en entier (F5) : `Authorization: "Bearer a b"`, `Cookie: 'sid=…'`.
    .replace(/(["']?(?:authorization|(?:set-)?cookie)["']?\s*[:=][ \t]*)("[^"\n]{0,400}"|'[^'\n]{0,400}')/gi, (_m, head: string, value: string) => `${head}${maskValue(value)}`)
    .replace(/(["']?authorization["']?\s*[:=]\s*["']?)(?:(bearer|basic|token|digest)\s+)?("[^"\n]{0,400}"|'[^'\n]{0,400}'|[^\s'"]+)/gi, (_m, head: string, scheme: string | undefined, value: string) => `${head}${scheme ? `${scheme} ` : ''}${maskValue(value)}`)
    .replace(/(\b(?:set-)?cookie["']?\s*:)(?![ \t]*["'])([ \t]*)[^'"\n]+/gi, `$1$2${MASKED}`)
    .replace(/(\bbearer\s+)(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${MASKED}`)
    .replace(/(\bx-[\w-]{0,40}(?:key|token)\s*:\s*)[^\s'"]+/gi, `$1${MASKED}`)
    .replace(new RegExp(`(--?${SECRET_NAME}(?:=|\\s+))(?!-)(${VALUE})`, 'gi'), (_m, head: string, value: string) => `${head}${maskValue(value)}`)
    .replace(new RegExp(`(\\b${SECRET_NAME}=)(${VALUE.replace("[^\\s'\"]+", "[^\\s'\"&;]+")})`, 'gi'), (_m, head: string, value: string) => `${head}${maskValue(value)}`)
    .replace(new RegExp(`(["']${SECRET_NAME}["']\\s*:\\s*["'])[^"']+`, 'gi'), `$1${MASKED}`)
    // Le nom entre guillemets et la valeur sans (`"client_secret": abc`, trouvé par le test de propriétés) : masquée aussi.
    .replace(new RegExp(`(\\b${SECRET_NAME}["']?\\s*:[ \\t]*)(${VALUE})`, 'gi'), (_m, head: string, value: string) => `${head}${maskValue(value)}`)
    .replace(/((?:^|\s)(?:-u|--user)(?:\s+|=)(["'])[^\s:'"]{1,200}:)[^"'\n]{1,400}(?=\2)/g, `$1${MASKED}`)
    .replace(/((?:^|\s)(?:-u|--user)(?:\s+|=)[^\s:'"]{1,200}:)[^\s'"]+/g, `$1${MASKED}`)
    .replace(/(\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n;|&]{0,400}?\s-p)(?=\S)(?!-)("[^"\n]{0,400}"|'[^'\n]{0,400}'|[^\s'"]+)/g, (_m, head: string, value: string) => `${head}${maskValue(value)}`)
    .replace(/(\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s:/@]{1,200}:)[^\s@/]{1,200}@/gi, `$1${MASKED}@`)
    .replace(KNOWN_TOKENS, MASKED)

/**
 * L'argument court d'un appel d'outil (Q8 : les arguments courts, jamais un contenu) : le fichier,
 * le motif, la commande, l'adresse, la description ; undefined sinon. Ses secrets sont masqués
 * avant qu'il soit coupé, pour qu'aucun début de jeton ne reste (F2).
 */
export const shortArg = (tool: string, input: Readonly<Record<string, unknown>>): string | undefined => {
  const str = (k: string): string | undefined => (typeof input[k] === 'string' && input[k] !== '' ? (input[k] as string) : undefined)
  const path = str('file_path') ?? str('notebook_path') ?? str('path')
  if (path !== undefined && toolFamily(tool) !== 'run') return clipArg(maskSecrets(tailOfPath(path)))
  const url = str('url')
  if (url !== undefined) return clipArg(maskSecrets(url).replace(/^[a-z]+:\/\//i, '').replace(/[?#].*$/, ''))
  const text = str('command') ?? str('pattern') ?? str('query') ?? str('description') ?? str('skill')
  return text === undefined ? undefined : clipArg(maskSecrets(text))
}

export type Interval = { s: number; e: number }

/** Les intervalles réunis et triés : leur union. */
export const unionOf = (list: readonly Interval[]): Interval[] => {
  const out: Interval[] = []
  for (const i of [...list].filter(x => x.e > x.s).sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1]
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e)
    else out.push({ s: i.s, e: i.e })
  }
  return out
}

const total = (list: readonly Interval[]): number => list.reduce((n, i) => n + (i.e - i.s), 0)

/** Un morceau de l'axe : du temps réel, ou une pause compressée (`pause` : sa durée réelle). */
export type AxisPiece = { s: number; e: number; x0: number; x1: number; pause?: number }
export type Axis = { start: number; end: number; pieces: AxisPiece[] }

/**
 * L'axe de la frise, de `start` à `end` (x de 0 à 1) : les tronçons d'activité en temps réel, les
 * écarts de plus de PAUSE_MS entre eux réduits à une largeur fixe. Les bords vides de moins de
 * PAUSE_MS restent à l'échelle ; au-delà, l'axe commence au premier tronçon et finit au dernier.
 */
export const buildAxis = (active: readonly Interval[], start: number, end: number): Axis => {
  const s0 = start
  const e0 = Math.max(end, start + 1)
  const clipped = unionOf(active.map(i => ({ s: Math.max(i.s, s0), e: Math.min(i.e, e0) })))
  const stretches: Interval[] = []
  for (const i of clipped) {
    const last = stretches[stretches.length - 1]
    if (last && i.s - last.e <= PAUSE_MS) last.e = i.e
    else stretches.push({ ...i })
  }
  if (stretches.length === 0) return { start: s0, end: e0, pieces: [{ s: s0, e: e0, x0: 0, x1: 1 }] }
  const first = stretches[0]!
  const last = stretches[stretches.length - 1]!
  if (first.s - s0 <= PAUSE_MS) first.s = s0
  if (e0 - last.e <= PAUSE_MS) last.e = e0
  const pauses = stretches.length - 1
  const pauseShare = pauses === 0 ? 0 : Math.min(PAUSE_SHARE, PAUSES_MAX / pauses)
  const realShare = 1 - pauseShare * pauses
  const real = Math.max(1, total(stretches))
  const pieces: AxisPiece[] = []
  let x = 0
  stretches.forEach((st, i) => {
    if (i > 0) {
      const prev = stretches[i - 1]!
      pieces.push({ s: prev.e, e: st.s, x0: x, x1: x + pauseShare, pause: st.s - prev.e })
      x += pauseShare
    }
    const w = ((st.e - st.s) / real) * realShare
    pieces.push({ s: st.s, e: st.e, x0: x, x1: x + w })
    x += w
  })
  pieces[pieces.length - 1]!.x1 = 1
  return { start: first.s, end: last.e, pieces }
}

/** La position (0 à 1) d'un instant sur l'axe ; dans une pause, il glisse d'un bord à l'autre. */
export const xOf = (axis: Axis, t: number): number => {
  if (t <= axis.start) return 0
  if (t >= axis.end) return 1
  const p = axis.pieces.find(x => t <= x.e) ?? axis.pieces[axis.pieces.length - 1]!
  return p.x0 + ((t - p.s) / Math.max(1, p.e - p.s)) * (p.x1 - p.x0)
}

/** Une part à dessiner d'une piste : x de 0 à 1 ; `isLive` pour le segment en cours. */
export type LanePart = { kind: SegmentKind; x0: number; x1: number; family?: ToolFamily; isLive?: boolean; isError?: boolean; s: number; e: number }

/**
 * Les parts d'une piste sur l'axe. Des segments qui se chevauchent se coupent : chacun s'arrête au
 * début du suivant. Un segment ouvert court jusqu'à maintenant. Hors de l'axe, rien.
 */
export const laneParts = (lane: AgentLane, axis: Axis, now: number): LanePart[] => {
  const segs = [...(lane.segments ?? [])].sort((a, b) => a.s - b.s)
  const parts: LanePart[] = []
  segs.forEach((seg, i) => {
    const next = segs[i + 1]
    const end = Math.min(seg.e ?? now, next ? next.s : Infinity)
    const s = Math.max(seg.s, axis.start)
    const e = Math.min(end, axis.end)
    if (e <= s) return
    const part: LanePart = { kind: seg.k, x0: xOf(axis, s), x1: xOf(axis, e), s, e }
    if (seg.f !== undefined) part.family = seg.f
    if (seg.e === undefined) part.isLive = true
    if (seg.x === true) part.isError = true
    parts.push(part)
  })
  return parts
}

/** Les repères d'une piste sur l'axe. */
export const laneMarks = (lane: AgentLane, axis: Axis): (AgentMark & { x: number })[] =>
  (lane.marks ?? []).filter(m => m.at >= axis.start && m.at <= axis.end).map(m => ({ ...m, x: xOf(axis, m.at) }))

/**
 * La période d'un sous-agent, de son départ à sa fin. Une fin seulement constatée (`isEndUnseen`)
 * porte l'heure du rattrapage, pas la vraie : la période s'arrête alors à la fin de son dernier segment.
 */
const periodOf = (a: RegistryAgent, now: number): Interval => {
  if (a.status === 'running') return { s: a.startedAt, e: now }
  if (a.isEndUnseen === true) return { s: a.startedAt, e: Math.max(a.startedAt, ...(a.segments ?? []).map(s => s.e ?? a.startedAt)) }
  return { s: a.startedAt, e: a.finishedAt ?? a.startedAt }
}

/** Les périodes d'activité de la frise : chaque segment, et chaque sous-agent de son départ à sa fin. */
export const activityOf = (lanes: readonly AgentLane[], agents: readonly RegistryAgent[], now: number): Interval[] => [
  ...lanes.flatMap(l => (l.segments ?? []).map(s => ({ s: s.s, e: s.e ?? now }))),
  ...agents.map(a => periodOf(a, now)),
]

export type Summary = {
  agents: number
  running: number
  /** Le temps où au moins un sous-agent travaillait (union de leurs périodes). */
  activeMs: number
  /** La somme de leurs durées : ce qu'aurait pris une exécution en série. */
  serialMs: number
  /** serialMs / activeMs ; null sans durée. */
  gain: number | null
}

/** Le résumé de la frise : nombre d'agents, durée active, gain par rapport à une exécution en série. */
export const summaryOf = (agents: readonly RegistryAgent[], now: number): Summary => {
  const periods = agents.map(a => periodOf(a, now))
  const activeMs = total(unionOf(periods))
  const serialMs = total(periods)
  return {
    agents: agents.length,
    running: agents.filter(a => a.status === 'running').length,
    activeMs,
    serialMs,
    gain: activeMs > 0 ? serialMs / activeMs : null,
  }
}

/**
 * Une rangée de la frise, dans l'ordre d'affichage : un sous-agent, ou la piste repliable d'un
 * Workflow (ses agents réunis). `depth` : le retrait sous le parent.
 */
export type TreeRow =
  | { kind: 'agent'; agent: RegistryAgent; depth: number }
  | { kind: 'workflow'; id: string; agents: RegistryAgent[]; depth: number; isOpen: boolean }

/**
 * L'ordre des pistes (Q13) : les sous-agents par ordre de départ, les enfants d'un sous-agent en
 * retrait sous lui (`parent`, à toute profondeur) ; les agents d'un même Workflow réunis en une
 * piste repliée, que `openWorkflows` déplie. Un parent inconnu (autre session, effacé) laisse
 * l'agent à la racine.
 */
export const laneTree = (agents: readonly RegistryAgent[], openWorkflows: ReadonlySet<string>): TreeRow[] => {
  const ids = new Set(agents.map(a => a.agentId).filter((id): id is string => id !== undefined))
  const parentOf = (a: RegistryAgent): string => (a.parent !== undefined && ids.has(a.parent) && a.parent !== a.agentId ? a.parent : '')
  // Les nœuds sous chaque parent : un agent seul, ou le groupe d'un Workflow.
  type Node = { start: number; agent?: RegistryAgent; workflow?: string; members?: RegistryAgent[] }
  const children = new Map<string, Node[]>()
  const groups = new Map<string, Node>()
  for (const a of [...agents].sort((x, y) => x.startedAt - y.startedAt)) {
    const under = parentOf(a)
    const list = children.get(under) ?? []
    if (a.workflow !== undefined) {
      const group = groups.get(a.workflow)
      if (group) group.members!.push(a)
      else {
        const node: Node = { start: a.startedAt, workflow: a.workflow, members: [a] }
        groups.set(a.workflow, node)
        list.push(node)
      }
    } else list.push({ start: a.startedAt, agent: a })
    children.set(under, list)
  }
  const rows: TreeRow[] = []
  const seen = new Set<string>()
  const walk = (under: string, depth: number) => {
    for (const node of children.get(under) ?? []) {
      if (node.agent) {
        if (seen.has(node.agent.key)) continue
        seen.add(node.agent.key)
        rows.push({ kind: 'agent', agent: node.agent, depth })
        if (node.agent.agentId !== undefined) walk(node.agent.agentId, depth + 1)
        continue
      }
      const isOpen = openWorkflows.has(node.workflow!)
      rows.push({ kind: 'workflow', id: node.workflow!, agents: node.members!, depth, isOpen })
      if (!isOpen) continue
      for (const m of node.members!) {
        if (seen.has(m.key)) continue
        seen.add(m.key)
        rows.push({ kind: 'agent', agent: m, depth: depth + 1 })
        if (m.agentId !== undefined) walk(m.agentId, depth + 2)
      }
    }
  }
  walk('', 0)
  return rows
}
