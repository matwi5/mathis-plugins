// Frise des agents : des segments datés du registre aux parts à dessiner. Fonctions pures.
//
// - L'axe est en temps réel, sauf les pauses de plus de PAUSE_MS où personne ne travaille (aucun
//   segment de WORKING_KINDS, sur aucune piste) : elles prennent une largeur fixe et coupent le
//   rail en portant leur durée (« ┊ 2 h ┊ »). Attendre la réponse de la personne ou son prochain message est une pause.
// - La fenêtre de vue (zoom, déplacement, « dernière heure », « tout ») découpe une partie de l'axe
//   entier ; voir « Zoom et navigation » en bas.
// - Le résumé compte le gain par rapport à une exécution en série sur l'union des périodes
//   d'activité des sous-agents, pour que les heures creuses ne comptent pas.

import type { AgentLane, AgentMark, AgentsWindow, RegistryAgent, SegmentKind, ToolFamily } from '../types'

/**
 * Les sortes de segments qui travaillent : réfléchir, rédiger, lancer un outil, attendre un
 * sous-agent ou une tâche de fond, consulter l'advisor. Elles seules empêchent une pause de se
 * compresser ; attendre la réponse de la personne n'en est pas.
 */
export const WORKING_KINDS: ReadonlySet<SegmentKind> = new Set<SegmentKind>(['think', 'write', 'tool', 'waitAgent', 'waitBg', 'waitAdvisor'])

/**
 * `Math.min(bound, ...values)` et `Math.max(bound, ...values)` par une boucle : au-delà de 100 000
 * éléments, l'étalement lève une erreur (`scripts/check.py` le refuse).
 */
export const minOf = (values: Iterable<number>, bound = Infinity): number => {
  let min = bound
  for (const v of values) if (v < min) min = v
  return min
}
export const maxOf = (values: Iterable<number>, bound = -Infinity): number => {
  let max = bound
  for (const v of values) if (v > max) max = v
  return max
}

/** Une pause plus longue, où personne ne travaille, est compressée. */
export const PAUSE_MS = 60_000
export const HOUR_MS = 3_600_000
/** La largeur d'une pause compressée, en part de l'axe ; toutes ensemble n'en prennent pas plus de PAUSES_MAX. */
const PAUSE_SHARE = 0.04
const PAUSES_MAX = 0.24
/** L'argument court d'un outil : de quoi le reconnaître, sans recopier son contenu. */
const ARG_MAX = 80

/**
 * Les outils de chaque famille : la frise en tire la famille d'un outil, la légende détaillée la
 * liste telle quelle. Tout autre outil est de la famille « autre ».
 */
export const TOOL_FAMILIES: Readonly<Record<Exclude<ToolFamily, 'other'>, readonly string[]>> = {
  read: ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool'],
  edit: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  run: ['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'Monitor', 'TaskStop'],
  web: ['WebFetch', 'WebSearch'],
  agent: ['Agent', 'Task', 'SubagentHandback', 'SendMessage', 'Workflow'],
}

const FAMILY_BY_TOOL = new Map(Object.entries(TOOL_FAMILIES).flatMap(([family, tools]) => tools.map(tool => [tool, family as ToolFamily] as const)))

/** La famille d'un outil, d'après son nom : son glyphe se pose sur le segment. */
export const toolFamily = (name: string): ToolFamily => FAMILY_BY_TOOL.get(name) ?? 'other'

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
 * écarts de plus de PAUSE_MS entre eux réduits à une largeur fixe. Les bords sans activité de
 * moins de PAUSE_MS restent à l'échelle ; au-delà, ils deviennent eux aussi des pauses compressées,
 * pour qu'une attente de la personne en tête ou en queue reste visible.
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
  const head = first.s > s0
  const tail = last.e < e0
  const pauses = stretches.length - 1 + Number(head) + Number(tail)
  const pauseShare = pauses === 0 ? 0 : Math.min(PAUSE_SHARE, PAUSES_MAX / pauses)
  const realShare = 1 - pauseShare * pauses
  const real = Math.max(1, total(stretches))
  const pieces: AxisPiece[] = []
  let x = 0
  const pause = (s: number, e: number) => {
    pieces.push({ s, e, x0: x, x1: x + pauseShare, pause: e - s })
    x += pauseShare
  }
  if (head) pause(s0, first.s)
  stretches.forEach((st, i) => {
    if (i > 0) pause(stretches[i - 1]!.e, st.s)
    const w = ((st.e - st.s) / real) * realShare
    pieces.push({ s: st.s, e: st.e, x0: x, x1: x + w })
    x += w
  })
  if (tail) pause(last.e, e0)
  pieces[pieces.length - 1]!.x1 = 1
  return { start: s0, end: e0, pieces }
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
  if (a.isEndUnseen === true) return { s: a.startedAt, e: maxOf((a.segments ?? []).map(s => s.e ?? a.startedAt), a.startedAt) }
  return { s: a.startedAt, e: a.finishedAt ?? a.startedAt }
}

/** Les moments où une piste travaille : ses segments de WORKING_KINDS. */
const workOf = (lane: AgentLane, now: number): Interval[] =>
  (lane.segments ?? []).filter(s => WORKING_KINDS.has(s.k)).map(s => ({ s: s.s, e: s.e ?? now }))

/**
 * Les moments où quelqu'un travaille, sur toutes les pistes affichées et chez tous les
 * sous-agents : leurs segments qui travaillent, pas leurs périodes entières. Seule garde : un
 * sous-agent en cours qui n'a encore aucun segment travaille depuis son départ.
 */
export const activityOf = (lanes: readonly AgentLane[], agents: readonly RegistryAgent[], now: number): Interval[] => [
  ...lanes.flatMap(l => workOf(l, now)),
  ...agents.flatMap(a => (a.status === 'running' && (a.segments ?? []).length === 0 ? [{ s: a.startedAt, e: now }] : workOf(a, now))),
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

// ─── Zoom et navigation ─────────────────────────────────────────────────────
//
// La fenêtre de vue se garde en temps réel : figée, ses deux bornes ; quand elle suit le direct,
// sa durée, posée chaque fois au bout de l'axe. Zoom et déplacement se calculent sur l'axe
// affiché (pauses déjà compressées) : la fenêtre y passe par `xOf`, l'opération s'y fait, et le
// résultat revient en temps réel par `timeOf`.

/** Le zoom le plus fort : une minute de temps réel. */
export const ZOOM_MIN_MS = 60_000

/** L'instant d'une position (0 à 1) sur l'axe : l'inverse de `xOf` ; une pause se répartit linéairement sur sa largeur. */
export const timeOf = (axis: Axis, x: number): number => {
  if (x <= 0) return axis.start
  if (x >= 1) return axis.end
  const p = axis.pieces.find(piece => x <= piece.x1) ?? axis.pieces[axis.pieces.length - 1]!
  return p.s + ((x - p.x0) / Math.max(1e-12, p.x1 - p.x0)) * (p.e - p.s)
}

/** Les bornes d'une fenêtre sur l'axe entier, de 0 à 1 ; sans fenêtre (« tout »), tout l'axe. */
export const windowBounds = (axis: Axis, win: AgentsWindow | null | undefined): { a: number; b: number } => {
  if (!win) return { a: 0, b: 1 }
  if (win.isLive) return { a: xOf(axis, axis.end - (win.end - win.start)), b: 1 }
  const a = xOf(axis, win.start)
  const b = xOf(axis, win.end)
  return b > a ? { a, b } : { a: 0, b: 1 }
}

/** La partie `a`–`b` de l'axe, ramenée de 0 à 1 ; une pause coupée garde sa durée entière. */
export const sliceAxis = (axis: Axis, { a, b }: { a: number; b: number }): Axis => {
  if (a <= 0 && b >= 1) return axis
  const span = Math.max(1e-12, b - a)
  const pieces = axis.pieces
    .filter(p => p.x1 > a && p.x0 < b)
    .map(p => {
      const x0 = Math.max(p.x0, a)
      const x1 = Math.min(p.x1, b)
      const at = (x: number) => p.s + ((x - p.x0) / Math.max(1e-12, p.x1 - p.x0)) * (p.e - p.s)
      return { ...p, s: at(x0), e: at(x1), x0: (x0 - a) / span, x1: (x1 - a) / span }
    })
  if (pieces.length === 0) return axis
  pieces[0]!.x0 = 0
  pieces[pieces.length - 1]!.x1 = 1
  return { start: timeOf(axis, a), end: timeOf(axis, b), pieces }
}

/**
 * Le zoom ou le déplacement d'une fenêtre, sur l'axe affiché. `in` divise sa largeur par deux et
 * `out` la double, autour de son centre ; une fenêtre qui suit le direct garde sa fin au bout de
 * l'axe. `left` et `right` la décalent d'une demi-largeur, bornée aux extrémités : vers le passé
 * elle se fige, revenue au bout elle suit à nouveau le direct. null : tout l'axe. Au plus fort, une
 * minute de temps réel ; un axe plus court ne se zoome pas.
 */
export const zoomWindow = (axis: Axis, win: AgentsWindow | null | undefined, op: 'in' | 'out' | 'left' | 'right'): AgentsWindow | null => {
  const { a, b } = windowBounds(axis, win)
  const w = b - a
  const wasLive = !win || win.isLive
  let [na, nb] = [a, b]
  if (op === 'in' || op === 'out') {
    const nw = Math.min(1, op === 'in' ? w / 2 : w * 2)
    const c = (a + b) / 2
    ;[na, nb] = wasLive ? [1 - nw, 1] : [c - nw / 2, c + nw / 2]
  } else {
    const shift = (op === 'left' ? -w : w) / 2
    ;[na, nb] = [a + shift, b + shift]
  }
  // Ramenée dans l'axe, sans changer sa largeur.
  if (na < 0) [na, nb] = [0, nb - na]
  if (nb > 1) [na, nb] = [Math.max(0, na - (nb - 1)), 1]
  if (na <= 1e-9 && nb >= 1 - 1e-9) return null
  const isLive = nb >= 1 - 1e-9 && op !== 'left'
  let start = timeOf(axis, na)
  let end = isLive ? axis.end : timeOf(axis, nb)
  if (end - start < ZOOM_MIN_MS) {
    if (axis.end - axis.start <= ZOOM_MIN_MS) return win ?? null
    const c = isLive ? axis.end - ZOOM_MIN_MS / 2 : (start + end) / 2
    start = Math.max(axis.start, Math.min(axis.end - ZOOM_MIN_MS, c - ZOOM_MIN_MS / 2))
    end = start + ZOOM_MIN_MS
  }
  return { start, end, isLive }
}

/** Les pas de la règle graduée, du plus fin au plus large. */
const RULER_STEPS = [1, 5, 15, 30, 60, 180, 360].map(m => m * 60_000)

/** Une graduation : son instant, sa position, son heure (hh:mm, à l'heure locale). */
export type RulerTick = { at: number; x: number; label: string }

const hhmm = (t: number): string => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Les graduations d'un pas sur les tronçons de temps réel de l'axe, alignées sur l'heure locale. */
const ticksAt = (axis: Axis, step: number): RulerTick[] =>
  axis.pieces
    .filter(p => p.pause === undefined)
    .flatMap(p => {
      const offset = new Date(p.s).getTimezoneOffset() * 60_000
      const out: RulerTick[] = []
      for (let t = Math.ceil((p.s - offset) / step) * step + offset; t <= p.e; t += step) out.push({ at: t, x: xOf(axis, t), label: hhmm(t) })
      return out
    })
    .filter((t, i, all) => i === 0 || t.at !== all[i - 1]!.at)

/**
 * La règle graduée : le plus petit pas de RULER_STEPS qui ne donne pas plus de `max` graduations,
 * sinon le plus large ; aucune graduation dans une pause compressée.
 */
export const rulerTicks = (axis: Axis, max: number): { step: number; ticks: RulerTick[] } => {
  const real = axis.pieces.filter(p => p.pause === undefined).reduce((n, p) => n + (p.e - p.s), 0)
  for (const step of RULER_STEPS) {
    // Un pas qui en donnerait bien trop n'est même pas posé.
    if (real / step > max + axis.pieces.length) continue
    const ticks = ticksAt(axis, step)
    if (ticks.length <= max) return { step, ticks }
  }
  const step = RULER_STEPS[RULER_STEPS.length - 1]!
  return { step, ticks: ticksAt(axis, step) }
}
