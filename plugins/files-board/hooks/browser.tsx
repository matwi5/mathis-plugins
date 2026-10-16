// La région interactive du navigateur de fichiers : barre d'onglets, arborescence, recherche
// de fichiers, éditeur, menus. Elle dessine tout elle-même, rangée par rangée, et lit le
// clavier (après un clic : Échap rend le focus au prompt) et la souris (clic, double clic,
// clic droit, glisser). Elle n'a pas `$` : fichiers, presse-papiers et prompt passent par des
// messages au module des hooks (register.tsx), renvoyés tant qu'ils ne sont pas accusés (`ack`).
//
// Un seul modèle par instance, gardé au niveau du module : les gestionnaires et la minuterie
// le lisent toujours à jour, même quand deux touches tombent dans la même image.

import type { ClientKeyEvent, ClientModule, ClientPointerEvent, ClientSurface } from 'claude-code'

import type { DocView, Op, Sent, View } from '../types'
import {
  type Caret,
  type Glyph,
  type HlState,
  type MenuItem,
  type TreeRow,
  ancestors,
  touchedMarks,
  baseName,
  clamp,
  colOf,
  decodeRows,
  deleteBack,
  deleteForward,
  detectIndent,
  indentStep,
  entryMenu,
  findMatches,
  glyphs,
  glyphsWidth,
  indent,
  indexAt,
  insertText,
  isMarkdown,
  langOf,
  languageLabel,
  mdBlocks,
  menuWidth,
  newline,
  outdent,
  pad,
  parentOf,
  smartHome,
  strWidth,
  tabMenu,
  tokenize,
  viewMenu,
  wordLeft,
  wordRight,
  wrapRows,
  fit,
} from './model.ts'

// ─── Modèle local ───────────────────────────────────────────────────────────

type Focus = 'tree' | 'search' | 'editor' | 'find'

type Snap = { text: string; cy: number; cx: number }

type Buf = Caret & {
  path: string
  /** Colonne visée par haut et bas (dans la rangée), -1 sans visée. */
  want: number
  /** Première rangée visuelle affichée (première ligne pour un fichier volumineux). */
  top: number
  /** Décalage horizontal, sans retour à la ligne. */
  left: number
  rev: number
  dirty: boolean
  /** Monte à chaque modification : clé des caches. */
  ver: number
  lastEdit: number
  draftSent: boolean
  pinSent: boolean
  /** Le fichier a changé sur le disque pendant des modifications. */
  conflict: boolean
  undo: Snap[]
  redo: Snap[]
  lastKind: string
  lastKindAt: number
  /** Unité d'indentation lue dans le fichier ; null : des espaces de la taille de tabulation. */
  detected: string | null
  readOnly: boolean
  /** Fichier volumineux : nombre de lignes et fenêtre reçue. */
  large: { count: number; from: number; lines: string[]; asked: number } | null
  wrapKey: string
  prefix: number[]
  hlKey: string
  hlStates: HlState[]
  matchKey: string
  matches: [number, number, number][]
  mdKey: string
  blocks: { start: number; text: string }[]
}

type SubMenu = { items: MenuItem[]; x: number; y: number; w: number; sel: number }
type Menu = SubMenu & { kind: 'view' | 'entry' | 'tab'; path: string; isDir: boolean; sub: SubMenu | null }

type Zone = { x0: number; x1: number; y0: number; y1: number; id: string; data?: unknown }

type Layout = {
  W: number
  H: number
  treeShown: boolean
  contentShown: boolean
  S: number
  cx0: number
  CW: number
  listY: number
  listH: number
  edY: number
  edH: number
  gutter: number
  textX: number
  textW: number
}

type Model = {
  inst: string
  seq: number
  outbox: Sent[]
  needPost: boolean
  lastPost: number
  /** Horloge de la région, en ms : avancée par sa minuterie (celle du dessin, que les tests avancent). */
  clock: number
  v: number
  props: View
  surface: ClientSurface<St>
  focus: Focus
  treeSel: string | null
  treeTop: number
  rowsRef: readonly string[] | null
  rows: TreeRow[]
  search: { text: string; cx: number; sel: number; top: number }
  bufs: Map<string, Buf>
  menu: Menu | null
  zones: Zone[]
  lastClick: { t: number; x: number; y: number } | null
  confirm: string | null
  find: { open: boolean; text: string; cx: number; idx: number }
  mdSource: Set<string>
  mdTop: Map<string, number>
  drag: { kind: 'split' | 'sbTree' | 'sbEdit' } | null
  sideW: number | null
  wheelN: number
  revealN: number
  pendingReveal: string | null
  tabStart: number
  layout: Layout | null
}

type St = { inst: string; v: number }

let M: Model | null = null

const now = () => Date.now()

// ─── Couleurs ───────────────────────────────────────────────────────────────

const ACCENT = 'cyan'
/** La marque d'un fichier que Claude a modifié depuis le dernier message (◆), et de ses dossiers (◇). */
const CLAUDE_MARK = 'magenta'
const SYNTAX: Record<string, string> = {
  c: '#6A9955',
  s: '#CE9178',
  n: '#B5CEA8',
  k: '#569CD6',
  K: '#C586C0',
  t: '#4EC9B0',
  f: '#DCDCAA',
  p: '#9CDCFE',
  h: '#569CD6',
  b: '#D7BA7D',
  m: '#CE9178',
  l: '#4EC9B0',
  g: '#569CD6',
  a: '#9CDCFE',
  v: '#9CDCFE',
  o: '#569CD6',
}
// Les caractères de contrôle qu'un Text refuse (un Markdown garde tabulation et saut de ligne).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const CONTROL_MD = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

const MATCH_BG = '#5A4A1E'
const CURRENT_BG = '#B5892E'

// ─── Entrée de la région ────────────────────────────────────────────────────

const Browser: ClientModule<View, St> = (props, surface) => {
  const state = surface.state
  if (!M || !state || state.inst !== M.inst) {
    M = createModel(props, surface, state?.inst)
    if (!state) {
      surface.setState({ inst: M.inst, v: 0 })
      surface.every(TICK, tick)
    }
  }
  const m = M
  m.props = props
  m.surface = surface
  sync(m)
  surface.onKey((k) => run(m, () => onKey(m, k)))
  surface.onPointer((p) => run(m, () => onPointer(m, p)))
  return draw(m)
}

export default Browser

function createModel(props: View, surface: ClientSurface<St>, inst?: string): Model {
  return {
    inst: inst ?? `${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    seq: 0,
    outbox: [],
    needPost: false,
    lastPost: 0,
    clock: 0,
    v: 0,
    props,
    surface,
    focus: props.active ? 'editor' : 'tree',
    treeSel: null,
    treeTop: 0,
    rowsRef: null,
    rows: [],
    search: { text: '', cx: 0, sel: 0, top: 0 },
    bufs: new Map(),
    menu: null,
    zones: [],
    lastClick: null,
    confirm: null,
    find: { open: false, text: '', cx: 0, idx: 0 },
    mdSource: new Set(),
    mdTop: new Map(),
    drag: null,
    sideW: null,
    wheelN: props.wheel.n,
    revealN: props.reveal.n,
    pendingReveal: null,
    tabStart: 0,
    layout: null,
  }
}

/** Exécute un gestionnaire, envoie les demandes en attente et redessine s'il a changé quelque chose. */
function run(m: Model, fn: () => boolean | void) {
  const changed = fn()
  flush(m)
  if (changed !== false) redraw(m)
}

function redraw(m: Model) {
  m.v += 1
  m.surface.setState({ inst: m.inst, v: m.v })
}

// ─── Messages au module des hooks ───────────────────────────────────────────

function send(m: Model, op: Op) {
  // Une demande qui en remplace une autre encore en file : seule la dernière compte.
  if (op.k === 'find') m.outbox = m.outbox.filter((o) => o.k !== 'find')
  if (op.k === 'draft' || op.k === 'save') m.outbox = m.outbox.filter((o) => !(o.k === 'draft' && o.path === op.path))
  if (op.k === 'window') m.outbox = m.outbox.filter((o) => !(o.k === 'window' && o.path === op.path))
  m.seq += 1
  m.outbox.push({ ...op, seq: m.seq } as Sent)
  m.needPost = true
}

/** Un envoi par image au plus, borné en taille : le reste part après l'accusé. */
function flush(m: Model) {
  if (!m.needPost || !m.outbox.length) return
  m.needPost = false
  m.lastPost = m.clock
  const ops: Sent[] = []
  let size = 0
  for (const op of m.outbox) {
    const s = JSON.stringify(op).length
    if (ops.length && size + s > 90_000) break
    ops.push(op)
    size += s
  }
  m.surface.post({ inst: m.inst, ops } as never)
}

const TICK = 150

/** Toutes les 150 ms : brouillons, enregistrement automatique, renvoi des demandes non accusées. */
function tick() {
  const m = M
  if (!m) return
  m.clock += TICK
  const t = m.clock
  let changed = false
  for (const b of m.bufs.values()) {
    if (!b.dirty || b.readOnly) continue
    if (m.props.options.autoSave && !b.conflict && t - b.lastEdit >= 1000) {
      save(m, b)
      changed = true
    } else if (!b.draftSent && t - b.lastEdit >= 700) {
      send(m, { k: 'draft', path: b.path, text: b.lines.join('\n') })
      b.draftSent = true
    }
  }
  if (m.outbox.length && t - m.lastPost > 1000) m.needPost = true
  flush(m)
  if (changed) redraw(m)
}

function save(m: Model, b: Buf) {
  if (b.readOnly) return
  send(m, { k: 'save', path: b.path, text: b.lines.join('\n') })
  b.dirty = false
  b.draftSent = true
}

// ─── Synchronisation avec les props ─────────────────────────────────────────

function sync(m: Model) {
  const p = m.props
  if (p.ack.inst === m.inst) m.outbox = m.outbox.filter((o) => o.seq > p.ack.seq)
  if (p.rows !== m.rowsRef) {
    m.rows = decodeRows(p.rows)
    m.rowsRef = p.rows
  }
  // Onglets fermés : leurs tampons partent avec eux.
  const open = new Set(p.tabs.map((t) => t.path))
  for (const path of m.bufs.keys()) if (!open.has(path)) m.bufs.delete(path)
  if (m.confirm && !open.has(m.confirm)) m.confirm = null
  if (p.doc) syncDoc(m, p.doc)
  if (!p.active && (m.focus === 'editor' || m.focus === 'find')) m.focus = 'tree'
  if (p.wheel.n !== m.wheelN) {
    m.wheelN = p.wheel.n
    wheel(m, p.wheel.by, p.wheel.column)
  }
  if (p.reveal.n !== m.revealN) {
    m.revealN = p.reveal.n
    m.pendingReveal = p.reveal.path
    m.search = { text: '', cx: 0, sel: 0, top: 0 }
    m.focus = 'tree'
  }
  if (m.pendingReveal !== null) {
    const i = m.rows.findIndex((r) => r.path === m.pendingReveal && r.kind !== 'x' && r.kind !== 'l')
    if (i >= 0) {
      m.treeSel = m.pendingReveal
      m.pendingReveal = null
      showTreeRow(m, i)
    }
  }
}

function syncDoc(m: Model, d: DocView) {
  let b = m.bufs.get(d.path)
  if (d.state === 'large' && d.window) {
    const lines = d.window.text.split('\n')
    if (!b) {
      b = newBuf(m, d, [''])
      b.readOnly = true
      m.bufs.set(d.path, b)
    }
    b.large = { count: d.lineCount, from: d.window.from, lines, asked: b.large?.asked ?? -1 }
    b.rev = d.rev
    return
  }
  if (d.state !== 'ready') return
  if (!b || b.large) {
    b = newBuf(m, d, d.text.split('\n'))
    m.bufs.set(d.path, b)
    return
  }
  // Tant qu'une réponse à la bannière (garder, recharger) attend son accusé, elle reste fermée.
  const isAnswered = m.outbox.some((o) => (o.k === 'keep' || o.k === 'reload') && o.path === d.path)
  if (d.changedOnDisk && !isAnswered) b.conflict = true
  if (d.rev === b.rev) return
  if (d.origin.startsWith(`save:${m.inst}:`)) {
    // Notre propre enregistrement : rien à relire.
    b.rev = d.rev
    return
  }
  if (!b.dirty) {
    replaceText(b, d.text)
    b.rev = d.rev
    b.conflict = false
    return
  }
  // Modifié sur le disque pendant nos modifications : la bannière propose de choisir.
  b.conflict = true
}

function newBuf(m: Model, d: DocView, lines: string[]): Buf {
  return {
    path: d.path,
    lines,
    cy: 0,
    cx: 0,
    want: -1,
    top: 0,
    left: 0,
    rev: d.rev,
    dirty: d.isDirty,
    ver: 0,
    lastEdit: 0,
    draftSent: true,
    pinSent: false,
    conflict: d.changedOnDisk,
    undo: [],
    redo: [],
    lastKind: '',
    lastKindAt: 0,
    detected: detectIndent(lines),
    readOnly: false,
    large: null,
    wrapKey: '',
    prefix: [],
    hlKey: '',
    hlStates: [],
    matchKey: '',
    matches: [],
    mdKey: '',
    blocks: [],
  }
}

function replaceText(b: Buf, text: string) {
  b.lines = text.split('\n')
  b.cy = clamp(b.cy, 0, b.lines.length - 1)
  b.cx = clamp(b.cx, 0, (b.lines[b.cy] ?? '').length)
  b.ver += 1
  b.dirty = false
}

// ─── Disposition ────────────────────────────────────────────────────────────

/** L'unité d'indentation d'un tampon : celle du fichier, sinon la taille de tabulation. */
const unitOf = (m: Model, b: Buf) => b.detected ?? ' '.repeat(m.props.options.tabSize)

const activeBuf = (m: Model) => (m.props.active ? m.bufs.get(m.props.active) : undefined)
const isRendered = (m: Model, path: string) => isMarkdown(path) && !m.mdSource.has(path)

function computeLayout(m: Model): Layout {
  const W = Math.max(24, m.surface.columns || m.props.columns || 80)
  const H = Math.max(6, m.surface.rows || m.props.lines || 24)
  const o = m.props.options
  const hasDoc = Boolean(m.props.active)
  const narrow = W < 70
  let treeShown = o.showTree
  let contentShown = true
  if (narrow) {
    // Étroit : l'arborescence ou le fichier, pas les deux.
    treeShown = o.showTree && (!hasDoc || m.focus === 'tree' || m.focus === 'search')
    contentShown = !treeShown
  }
  const auto = o.sidebarWidth || Math.round(W * 0.28)
  const S = treeShown ? (narrow ? W : clamp(m.sideW ?? auto, 16, W - 40)) : 0
  const cx0 = treeShown && contentShown ? S + 1 : 0
  const CW = contentShown ? W - cx0 : 0
  const b = activeBuf(m)
  const banners = (b?.conflict ? 1 : 0) + (m.confirm ? 1 : 0) + (m.find.open && b && !b.large ? 1 : 0)
  const edY = 2 + banners
  const edH = Math.max(1, H - 1 - edY)
  const count = b ? (b.large ? b.large.count : b.lines.length) : 1
  const gutter = String(Math.max(count, 9)).length + 2
  return { W, H, treeShown, contentShown, S, cx0, CW, listY: 2, listH: Math.max(1, H - 2), edY, edH, gutter, textX: cx0 + gutter, textW: Math.max(4, CW - gutter - 1) }
}

// ─── Caches de l'éditeur ────────────────────────────────────────────────────

/** Première rangée visuelle de chaque ligne ; `prefix[n]` est le total. */
function prefixOf(m: Model, b: Buf, L: Layout): number[] {
  const o = m.props.options
  const wrap = o.wordWrap && !b.large
  const key = `${b.ver}:${wrap ? L.textW : 0}:${o.tabSize}`
  if (b.wrapKey === key) return b.prefix
  const n = b.large ? b.large.count : b.lines.length
  const prefix = new Array<number>(n + 1)
  prefix[0] = 0
  for (let i = 0; i < n; i++) {
    const rows = wrap ? wrapRows(glyphs(b.lines[i] ?? '', o.tabSize), L.textW).length : 1
    prefix[i + 1] = prefix[i]! + rows
  }
  b.wrapKey = key
  b.prefix = prefix
  return prefix
}

function lineAtRow(prefix: number[], vr: number): number {
  let lo = 0
  let hi = prefix.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (prefix[mid]! <= vr) lo = mid
    else hi = mid - 1
  }
  return Math.max(0, lo)
}

function lineText(b: Buf, i: number): string | null {
  if (!b.large) return b.lines[i] ?? ''
  const j = i - b.large.from
  return j >= 0 && j < b.large.lines.length ? (b.large.lines[j] ?? '') : null
}

/** L'état de coloration au début de la ligne `upTo`, calculé depuis le haut et gardé. */
function hlStateAt(b: Buf, upTo: number): HlState {
  const lang = langOf(b.path)
  const key = `${b.ver}:${lang}`
  if (b.hlKey !== key) {
    b.hlKey = key
    b.hlStates = ['']
  }
  if (b.large) return ''
  while (b.hlStates.length <= upTo && b.hlStates.length <= b.lines.length) {
    const i = b.hlStates.length - 1
    b.hlStates.push(tokenize(b.lines[i] ?? '', lang, b.hlStates[i] ?? '').state)
  }
  return b.hlStates[Math.min(upTo, b.hlStates.length - 1)] ?? ''
}

function matchesOf(m: Model, b: Buf): [number, number, number][] {
  if (!m.find.open || !m.find.text || b.large) return []
  const key = `${b.ver}:${m.find.text}`
  if (b.matchKey !== key) {
    b.matchKey = key
    b.matches = findMatches(b.lines, m.find.text)
  }
  return b.matches
}

function blocksOf(b: Buf) {
  const key = String(b.ver)
  if (b.mdKey !== key) {
    b.mdKey = key
    b.blocks = mdBlocks(b.lines)
  }
  return b.blocks
}

// ─── Curseur et défilement ──────────────────────────────────────────────────

/** Rangée visuelle et colonne (dans la rangée) du curseur. */
function visualOf(m: Model, b: Buf, L: Layout): { vr: number; col: number } {
  const prefix = prefixOf(m, b, L)
  const gl = glyphs(b.lines[b.cy] ?? '', m.props.options.tabSize)
  const c = colOf(gl, b.cx)
  if (!m.props.options.wordWrap) return { vr: b.cy, col: c }
  const starts = wrapRows(gl, L.textW)
  let sub = 0
  for (let s = 1; s < starts.length; s++) if ((gl[starts[s]!]?.i ?? Infinity) <= b.cx) sub = s
  return { vr: (prefix[b.cy] ?? 0) + sub, col: c - (gl[starts[sub]!]?.col ?? 0) }
}

/** Place le curseur à la rangée visuelle `vr`, colonne `col` dans la rangée. */
function placeAt(m: Model, b: Buf, L: Layout, vr: number, col: number) {
  const prefix = prefixOf(m, b, L)
  const total = prefix[prefix.length - 1] ?? 1
  const row = clamp(vr, 0, Math.max(0, total - 1))
  const li = lineAtRow(prefix, row)
  const line = b.lines[li] ?? ''
  const gl = glyphs(line, m.props.options.tabSize)
  b.cy = li
  if (!m.props.options.wordWrap) {
    b.cx = indexAt(gl, col, line.length)
    return
  }
  const starts = wrapRows(gl, L.textW)
  const sub = clamp(row - (prefix[li] ?? 0), 0, starts.length - 1)
  const from = starts[sub] ?? 0
  const to = starts[sub + 1] ?? gl.length
  const part = gl.slice(from, to)
  const base = gl[from]?.col ?? 0
  const ci = indexAt(part, base + col, line.length)
  // Au-delà de la fin d'une rangée qui n'est pas la dernière : le curseur reste sur elle.
  b.cx = to < gl.length && ci >= (gl[to]?.i ?? line.length) ? (part[part.length - 1]?.i ?? 0) : ci
}

function maxTop(m: Model, b: Buf, L: Layout): number {
  const total = b.large ? b.large.count : (prefixOf(m, b, L)[b.lines.length] ?? 1)
  return m.props.options.scrollBeyondLastLine ? Math.max(0, total - 1) : Math.max(0, total - L.edH)
}

function showCursor(m: Model, b: Buf) {
  const L = m.layout
  if (!L || b.large) return
  const { vr } = visualOf(m, b, L)
  if (vr < b.top) b.top = vr
  if (vr >= b.top + L.edH) b.top = vr - L.edH + 1
  if (!m.props.options.wordWrap) {
    const c = colOf(glyphs(b.lines[b.cy] ?? '', m.props.options.tabSize), b.cx)
    if (c < b.left) b.left = Math.max(0, c - 4)
    if (c >= b.left + L.textW) b.left = c - L.textW + 5
  } else b.left = 0
}

function scrollEditor(m: Model, b: Buf, by: number) {
  const L = m.layout
  if (!L) return
  if (b.large) {
    b.top = clamp(b.top + by, 0, maxTop(m, b, L))
    return
  }
  b.top = clamp(b.top + by, 0, maxTop(m, b, L))
}

function moveVertical(m: Model, b: Buf, by: number) {
  const L = m.layout
  if (!L) return
  if (b.large) return scrollEditor(m, b, by)
  const { vr, col } = visualOf(m, b, L)
  if (b.want < 0) b.want = col
  placeAt(m, b, L, vr + by, b.want)
  showCursor(m, b)
}

// ─── Édition ────────────────────────────────────────────────────────────────

const snap = (b: Buf): Snap => ({ text: b.lines.join('\n'), cy: b.cy, cx: b.cx })

function restore(b: Buf, s: Snap) {
  b.lines = s.text.split('\n')
  b.cy = clamp(s.cy, 0, b.lines.length - 1)
  b.cx = clamp(s.cx, 0, (b.lines[b.cy] ?? '').length)
}

function touched(m: Model, b: Buf) {
  b.ver += 1
  b.dirty = true
  b.lastEdit = m.clock
  b.draftSent = false
  b.want = -1
  if (!b.pinSent && m.props.tabs.some((t) => t.path === b.path && t.isPreview)) {
    send(m, { k: 'pin', path: b.path })
    b.pinSent = true
  }
  showCursor(m, b)
}

/** Une modification ; les frappes d'une même sorte, rapprochées, s'annulent ensemble. */
function edit(m: Model, b: Buf, kind: string, fn: (c: Caret) => void) {
  if (b.readOnly) return
  const t = now()
  if (kind !== b.lastKind || t - b.lastKindAt > 1000 || kind === 'enter' || kind === 'paste') {
    b.undo.push(snap(b))
    if (b.undo.length > 200) b.undo.shift()
  }
  b.lastKind = kind
  b.lastKindAt = t
  b.redo = []
  fn(b)
  touched(m, b)
}

function undo(m: Model, b: Buf, isRedo: boolean) {
  const from = isRedo ? b.redo : b.undo
  const to = isRedo ? b.undo : b.redo
  const s = from.pop()
  if (!s || b.readOnly) return
  to.push(snap(b))
  restore(b, s)
  b.lastKind = ''
  touched(m, b)
}

// ─── Clavier ────────────────────────────────────────────────────────────────

const SPECIAL = new Set([
  'up', 'down', 'left', 'right', 'return', 'enter', 'tab', 'backspace', 'delete', 'pageup', 'pagedown', 'home', 'end',
  'escape', 'insert', 'clear', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
])

function keyName(k: ClientKeyEvent): string {
  const key = k.key === 'enter' ? 'return' : k.key === 'space' ? ' ' : k.key
  return SPECIAL.has(key.toLowerCase()) ? key.toLowerCase() : key
}

const isText = (k: ClientKeyEvent, key: string) => !k.ctrl && !k.meta && key.length > 0 && !SPECIAL.has(key)

function onKey(m: Model, k: ClientKeyEvent): boolean | void {
  const key = keyName(k)
  const lower = key.toLowerCase()
  if (m.menu) return menuKey(m, key)
  if (m.confirm) return confirmKey(m, key)
  // Raccourcis valables partout.
  if (k.ctrl && lower === 'y' && (k.shift || key === 'Y')) return send(m, { k: 'option', key: 'showTree', value: !m.props.options.showTree })
  if (k.ctrl && lower === 's') {
    const b = activeBuf(m)
    if (b?.dirty) save(m, b)
    return
  }
  if (k.ctrl && lower === 'f') return toggleFind(m)
  if (k.ctrl && lower === 'p') {
    m.focus = 'search'
    return
  }
  if (k.ctrl && lower === 'w') return m.props.active ? requestClose(m, m.props.active) : undefined
  if (k.ctrl && (key === 'pagedown' || key === 'pageup')) return cycleTab(m, key === 'pagedown' ? 1 : -1)
  if ((key === 'f10' && k.shift) || lower === 'menu' || lower === 'contextmenu') return keyMenu(m)
  if (key === 'tab' && !(m.focus === 'editor' && m.props.options.tabIndents && activeBuf(m) && !activeBuf(m)!.readOnly && !isRendered(m, m.props.active ?? ''))) {
    return cycleFocus(m, k.shift ? -1 : 1)
  }
  if (m.focus === 'search') return searchKey(m, k, key)
  if (m.focus === 'find') return findKey(m, k, key)
  if (m.focus === 'tree') return treeKey(m, k, key)
  return editorKey(m, k, key)
}

function cycleFocus(m: Model, dir: number) {
  const order: Focus[] = []
  if (m.props.options.showTree) order.push('search', 'tree')
  if (m.props.active) order.push('editor')
  if (!order.length) return
  const i = order.indexOf(m.focus === 'find' ? 'editor' : m.focus)
  m.focus = order[(i + dir + order.length) % order.length]!
}

function cycleTab(m: Model, dir: number) {
  const tabs = m.props.tabs
  if (!tabs.length) return
  const i = tabs.findIndex((t) => t.path === m.props.active)
  const next = tabs[(i + dir + tabs.length) % tabs.length]
  if (next) send(m, { k: 'activate', path: next.path })
}

/** Édite une ligne de saisie (recherche) ; vrai quand le texte a changé. */
function lineEdit(state: { text: string; cx: number }, k: ClientKeyEvent, key: string): boolean | null {
  const { text, cx } = state
  if (key === 'left') state.cx = k.ctrl ? wordLeft(text, cx) : Math.max(0, cx - 1)
  else if (key === 'right') state.cx = k.ctrl ? wordRight(text, cx) : Math.min(text.length, cx + 1)
  else if (key === 'home') state.cx = 0
  else if (key === 'end') state.cx = text.length
  else if (key === 'backspace') {
    if (!cx) return false
    const from = k.ctrl ? wordLeft(text, cx) : cx - 1
    state.text = text.slice(0, from) + text.slice(cx)
    state.cx = from
    return true
  } else if (key === 'delete') {
    if (cx >= text.length) return false
    state.text = text.slice(0, cx) + text.slice(cx + 1)
    return true
  } else if (k.ctrl && key.toLowerCase() === 'u') {
    state.text = ''
    state.cx = 0
    return true
  } else if (isText(k, key)) {
    const add = key.replace(/[\r\n\t]+/g, ' ')
    state.text = text.slice(0, cx) + add + text.slice(cx)
    state.cx = cx + add.length
    return true
  } else return null
  return false
}

function searchKey(m: Model, k: ClientKeyEvent, key: string) {
  const s = m.search
  const results = s.text.trim() ? m.props.find.results : []
  if (key === 'down') {
    if (!results.length) m.focus = 'tree'
    else s.sel = Math.min(results.length - 1, s.sel + 1)
    return
  }
  if (key === 'up') {
    s.sel = Math.max(0, s.sel - 1)
    return
  }
  if (key === 'pagedown' || key === 'pageup') {
    const page = Math.max(1, (m.layout?.listH ?? 10) - 1)
    s.sel = clamp(s.sel + (key === 'pagedown' ? page : -page), 0, Math.max(0, results.length - 1))
    return
  }
  if (key === 'return') {
    const path = results[s.sel] ?? results[0]
    if (path) openResult(m, path, true)
    return
  }
  const changed = lineEdit(s, k, key)
  if (changed === null) return false
  if (changed) {
    s.sel = 0
    s.top = 0
    send(m, { k: 'find', query: s.text })
  }
}

function openResult(m: Model, path: string, focusEditor: boolean) {
  if (path.endsWith('/')) {
    const dir = path.slice(0, -1)
    send(m, { k: 'expand', paths: [...ancestors(dir), dir] })
    m.search = { text: '', cx: 0, sel: 0, top: 0 }
    m.pendingReveal = dir
    m.focus = 'tree'
    return
  }
  send(m, { k: 'open', path, preview: !focusEditor })
  send(m, { k: 'expand', paths: ancestors(path) })
  m.treeSel = path
  if (focusEditor) m.focus = 'editor'
}

function treeKey(m: Model, k: ClientKeyEvent, key: string) {
  const rows = m.rows
  if (!rows.length) return
  let i = rows.findIndex((r) => r.path === m.treeSel && r.kind !== 'x' && r.kind !== 'l')
  const row = rows[i]
  const page = Math.max(1, (m.layout?.listH ?? 10) - 1)
  const select = (j: number) => {
    i = clamp(j, 0, rows.length - 1)
    m.treeSel = rows[i]!.path
    showTreeRow(m, i)
  }
  if (key === 'down') return select(i + 1)
  if (key === 'up') return select(i < 0 ? 0 : i - 1)
  if (key === 'pagedown') return select(i + page)
  if (key === 'pageup') return select(i - page)
  if (key === 'home') return select(0)
  if (key === 'end') return select(rows.length - 1)
  if (!row) {
    if (isText(k, key)) return typeIntoSearch(m, key)
    return select(0)
  }
  if (key === 'right') {
    if (row.kind === 'd') return send(m, { k: 'toggle', path: row.path })
    if (row.kind === 'o') return select(i + 1)
    return
  }
  if (key === 'left') {
    if (row.kind === 'o') return send(m, { k: 'toggle', path: row.path })
    const parent = parentOf(row.path)
    const j = rows.findIndex((r) => r.path === parent && r.kind === 'o')
    if (j >= 0) select(j)
    return
  }
  if (key === 'return' || key === ' ') {
    if (row.kind === 'd' || row.kind === 'o') return send(m, { k: 'toggle', path: row.path })
    if (row.kind === 'f') {
      send(m, { k: 'open', path: row.path, preview: key === ' ' })
      if (key === 'return') m.focus = 'editor'
    }
    return
  }
  if (isText(k, key)) return typeIntoSearch(m, key)
  return false
}

function typeIntoSearch(m: Model, key: string) {
  m.focus = 'search'
  m.search = { text: key, cx: key.length, sel: 0, top: 0 }
  send(m, { k: 'find', query: key })
}

function showTreeRow(m: Model, i: number) {
  const h = m.layout?.listH ?? 10
  if (i < m.treeTop) m.treeTop = i
  if (i >= m.treeTop + h) m.treeTop = i - h + 1
}

function editorKey(m: Model, k: ClientKeyEvent, key: string): boolean | void {
  const b = activeBuf(m)
  const L = m.layout
  if (!b || !L) return false
  const path = b.path
  if (isRendered(m, path)) {
    const blocks = blocksOf(b)
    const top = m.mdTop.get(path) ?? 0
    const by = key === 'down' ? 1 : key === 'up' ? -1 : key === 'pagedown' ? 5 : key === 'pageup' ? -5 : key === 'home' ? -top : key === 'end' ? blocks.length : 0
    if (!by) return false
    m.mdTop.set(path, clamp(top + by, 0, Math.max(0, blocks.length - 1)))
    return
  }
  if (b.large) {
    const by = key === 'down' ? 1 : key === 'up' ? -1 : key === 'pagedown' ? L.edH - 1 : key === 'pageup' ? 1 - L.edH : key === 'home' ? -b.top : key === 'end' ? b.large.count : 0
    if (!by) return false
    scrollEditor(m, b, by)
    return
  }
  const line = b.lines[b.cy] ?? ''
  const lower = key.toLowerCase()
  const tabSize = m.props.options.tabSize
  const unit = unitOf(m, b)
  if (k.ctrl && lower === 'z') return k.shift ? undo(m, b, true) : undo(m, b, false)
  if (k.ctrl && lower === 'y') return undo(m, b, true)
  const move = (fn: () => void) => {
    fn()
    b.want = -1
    showCursor(m, b)
  }
  switch (key) {
    case 'left':
      return move(() => {
        if (k.ctrl || k.meta) b.cx = wordLeft(line, b.cx)
        else if (b.cx > 0) b.cx -= /[\uDC00-\uDFFF]/.test(line[b.cx - 1] ?? '') ? 2 : 1
        else if (b.cy > 0) {
          b.cy -= 1
          b.cx = (b.lines[b.cy] ?? '').length
        }
      })
    case 'right':
      return move(() => {
        if (k.ctrl || k.meta) b.cx = wordRight(line, b.cx)
        else if (b.cx < line.length) b.cx += /[\uD800-\uDBFF]/.test(line[b.cx] ?? '') ? 2 : 1
        else if (b.cy < b.lines.length - 1) {
          b.cy += 1
          b.cx = 0
        }
      })
    case 'up':
      return moveVertical(m, b, -1)
    case 'down':
      return moveVertical(m, b, 1)
    case 'pageup':
      b.top = Math.max(0, b.top - (L.edH - 1))
      return moveVertical(m, b, -(L.edH - 1))
    case 'pagedown':
      b.top = Math.min(maxTop(m, b, L), b.top + (L.edH - 1))
      return moveVertical(m, b, L.edH - 1)
    case 'home':
      return move(() => {
        if (k.ctrl) b.cy = 0
        b.cx = k.ctrl ? 0 : smartHome(line, b.cx)
      })
    case 'end':
      return move(() => {
        if (k.ctrl) b.cy = b.lines.length - 1
        b.cx = (b.lines[b.cy] ?? '').length
      })
    case 'return':
      return edit(m, b, 'enter', (c) => newline(c, unit, langOf(path)))
    case 'backspace':
      return edit(m, b, 'delete', (c) => {
        if (k.ctrl && c.cx > 0) {
          const from = wordLeft(line, c.cx)
          c.lines[c.cy] = line.slice(0, from) + line.slice(c.cx)
          c.cx = from
        } else deleteBack(c, indentStep(unit, tabSize))
      })
    case 'delete':
      return edit(m, b, 'delete', (c) => deleteForward(c))
    case 'tab':
      return edit(m, b, 'indent', (c) => (k.shift ? outdent(c, unit, tabSize) : indent(c, unit, tabSize)))
  }
  if (isText(k, key)) return edit(m, b, key.length > 1 ? 'paste' : 'type', (c) => insertText(c, key))
  return false
}

// ─── Recherche dans le fichier ──────────────────────────────────────────────

function toggleFind(m: Model) {
  const b = activeBuf(m)
  if (!b || b.large) return
  if (m.find.open && m.focus === 'find') {
    m.find.open = false
    m.focus = 'editor'
    return
  }
  if (isRendered(m, b.path)) m.mdSource.add(b.path)
  m.find.open = true
  m.focus = 'find'
  m.find.cx = m.find.text.length
}

function findKey(m: Model, k: ClientKeyEvent, key: string) {
  const b = activeBuf(m)
  if (!b) return
  if (key === 'return' || key === 'down') return gotoMatch(m, b, k.shift && key === 'return' ? -1 : 1)
  if (key === 'up') return gotoMatch(m, b, -1)
  const changed = lineEdit(m.find, k, key)
  if (changed === null) return false
  if (changed) {
    const matches = matchesOf(m, b)
    const at = matches.findIndex(([y, x]) => y > b.cy || (y === b.cy && x >= b.cx))
    m.find.idx = at < 0 ? 0 : at
    const hit = matches[m.find.idx]
    if (hit) revealMatch(m, b, hit)
  }
}

function gotoMatch(m: Model, b: Buf, dir: number) {
  const matches = matchesOf(m, b)
  if (!matches.length) return
  m.find.idx = (m.find.idx + dir + matches.length) % matches.length
  revealMatch(m, b, matches[m.find.idx]!)
}

function revealMatch(m: Model, b: Buf, hit: [number, number, number]) {
  b.cy = hit[0]
  b.cx = hit[1]
  b.want = -1
  showCursor(m, b)
}

// ─── Fermeture d'onglet ─────────────────────────────────────────────────────

function requestClose(m: Model, path: string) {
  const b = m.bufs.get(path)
  if ((b && b.dirty) || m.props.dirty.includes(path)) {
    m.confirm = path
    return
  }
  send(m, { k: 'close', path })
}

function confirmKey(m: Model, key: string) {
  const lower = key.toLowerCase()
  if (lower === 'return' || lower === 'e' || lower === 'o') return answerConfirm(m, 'save')
  if (lower === 'n') return answerConfirm(m, 'discard')
  return answerConfirm(m, 'cancel')
}

function answerConfirm(m: Model, choice: 'save' | 'discard' | 'cancel') {
  const path = m.confirm
  m.confirm = null
  if (!path || choice === 'cancel') return
  const b = m.bufs.get(path)
  if (choice === 'save' && b) save(m, b)
  if (b) b.dirty = false
  send(m, { k: 'close', path })
}

// ─── Menus ──────────────────────────────────────────────────────────────────

const selectable = (it: MenuItem | undefined) => Boolean(it && !it.isSeparator && !it.isDisabled)

function firstSel(items: MenuItem[]) {
  const i = items.findIndex(selectable)
  return i < 0 ? 0 : i
}

function openMenu(m: Model, kind: Menu['kind'], path: string, isDir: boolean, x: number, y: number) {
  const L = m.layout
  const p = m.props
  const tab = p.tabs.find((t) => t.path === path)
  const items = kind === 'view' ? viewMenu(p.options) : kind === 'tab' ? tabMenu(Boolean(tab?.isPreview), p.apps, p.os) : entryMenu(isDir, p.apps, p.os)
  const w = menuWidth(items)
  const W = L?.W ?? 80
  const H = L?.H ?? 24
  const h = items.length + 2
  m.menu = {
    kind,
    path,
    isDir,
    items,
    w,
    x: clamp(x, 0, Math.max(0, W - w - 2)),
    y: clamp(y, 1, Math.max(1, H - h)),
    sel: firstSel(items),
    sub: null,
  }
}

function keyMenu(m: Model) {
  if (m.focus === 'tree') {
    const i = m.rows.findIndex((r) => r.path === m.treeSel && (r.kind === 'f' || r.kind === 'd' || r.kind === 'o'))
    const row = m.rows[i]
    if (row) return openMenu(m, 'entry', row.path, row.kind !== 'f', 2 + row.depth * 2, m.layout ? m.layout.listY + i - m.treeTop + 1 : 3)
  }
  if (m.props.active) return openMenu(m, 'tab', m.props.active, false, (m.layout?.cx0 ?? 0) + 2, 1)
  return openMenu(m, 'view', '', false, (m.layout?.W ?? 80) - 40, 1)
}

function openSub(m: Model) {
  const menu = m.menu
  if (!menu) return
  const it = menu.items[menu.sel]
  if (!it?.sub) return
  const W = m.layout?.W ?? 80
  const w = menuWidth(it.sub)
  const right = menu.x + menu.w + 2
  const x = right + w + 2 <= W ? right - 1 : Math.max(0, menu.x - w - 1)
  menu.sub = { items: it.sub, x, y: clamp(menu.y + menu.sel, 1, Math.max(1, (m.layout?.H ?? 24) - it.sub.length - 2)), w, sel: firstSel(it.sub) }
}

function menuKey(m: Model, key: string) {
  const menu = m.menu!
  const level: SubMenu = menu.sub ?? menu
  const step = (dir: number) => {
    const n = level.items.length
    for (let j = 1; j <= n; j++) {
      const i = (level.sel + dir * j + n * 2) % n
      if (selectable(level.items[i])) {
        level.sel = i
        return
      }
    }
  }
  if (key === 'down') return step(1)
  if (key === 'up') return step(-1)
  if (key === 'right' && !menu.sub) return openSub(m)
  if (key === 'left') {
    if (menu.sub) menu.sub = null
    else m.menu = null
    return
  }
  if (key === 'return' || key === ' ') return chooseItem(m, level.items[level.sel], level === menu)
  if (key === 'tab') {
    m.menu = null
    return
  }
  return false
}

function chooseItem(m: Model, it: MenuItem | undefined, isTop: boolean) {
  const menu = m.menu
  if (!menu || !it || !selectable(it)) return
  if (it.sub && isTop) {
    menu.sel = menu.items.indexOf(it)
    return openSub(m)
  }
  m.menu = null
  const { path, isDir } = menu
  const id = it.id
  if (id.startsWith('opt:')) {
    const key = id.slice(4) as keyof View['options']
    return send(m, { k: 'option', key, value: !m.props.options[key] })
  }
  if (id.startsWith('tabSize:')) return send(m, { k: 'option', key: 'tabSize', value: Number(id.slice(8)) })
  if (id === 'find') {
    if (m.props.active !== path) send(m, { k: 'activate', path })
    return toggleFind(m)
  }
  if (id === 'reload') {
    const b = m.bufs.get(path)
    if (b) {
      b.dirty = false
      b.conflict = false
      b.rev = -1
    }
    return send(m, { k: 'reload', path })
  }
  if (id === 'keepOpen') return send(m, { k: 'pin', path })
  if (id === 'close') return requestClose(m, path)
  send(m, { k: 'act', id, path, isDir })
}

// ─── Souris ─────────────────────────────────────────────────────────────────

function hit(m: Model, x: number, y: number): Zone | undefined {
  for (let i = m.zones.length - 1; i >= 0; i--) {
    const z = m.zones[i]!
    if (x >= z.x0 && x < z.x1 && y >= z.y0 && y < z.y1) return z
  }
  return undefined
}

function onPointer(m: Model, p: ClientPointerEvent): boolean | void {
  if (p.type === 'move') {
    if (m.drag) return dragTo(m, p.x, p.y)
    if (!m.menu) return false
    const z = hit(m, p.x, p.y)
    if (z?.id !== 'menuItem') return false
    const { level, index } = z.data as { level: number; index: number }
    const target = level === 0 ? m.menu : m.menu.sub
    if (!target || index < 0 || target.sel === index || !selectable(target.items[index])) return false
    target.sel = index
    if (level === 0 && m.menu.sub && m.menu.items[index]?.sub !== m.menu.sub.items) m.menu.sub = null
    return true
  }
  if (p.type === 'up') {
    if (!m.drag) return false
    if (m.drag.kind === 'split' && m.sideW !== null) send(m, { k: 'option', key: 'sidebarWidth', value: m.sideW })
    m.drag = null
    return true
  }
  if (p.type !== 'down') return false
  const z = hit(m, p.x, p.y)
  const t = now()
  const isDouble = Boolean(m.lastClick && t - m.lastClick.t < 450 && Math.abs(m.lastClick.x - p.x) <= 1 && m.lastClick.y === p.y)
  m.lastClick = { t, x: p.x, y: p.y }
  if (m.menu && z?.id !== 'menuItem') {
    m.menu = null
    return true
  }
  if (p.button === 'right') return rightClick(m, z, p)
  if (p.button === 'middle') {
    if (z?.id === 'tab' || z?.id === 'tabx') requestClose(m, z.data as string)
    return
  }
  return leftClick(m, z, p, isDouble)
}

function rightClick(m: Model, z: Zone | undefined, p: ClientPointerEvent) {
  if (!z) return false
  if (z.id === 'row') {
    const row = m.rows[z.data as number]
    if (!row || row.kind === 'x' || row.kind === 'l') return false
    m.treeSel = row.path
    m.focus = 'tree'
    return openMenu(m, 'entry', row.path, row.kind !== 'f', p.x, p.y + 1)
  }
  if (z.id === 'result') {
    const path = z.data as string
    const isDir = path.endsWith('/')
    return openMenu(m, 'entry', isDir ? path.slice(0, -1) : path, isDir, p.x, p.y + 1)
  }
  if (z.id === 'tab' || z.id === 'tabx') return openMenu(m, 'tab', z.data as string, false, p.x, p.y + 1)
  if ((z.id === 'edit' || z.id === 'md' || z.id === 'crumbFile') && m.props.active) return openMenu(m, 'tab', m.props.active, false, p.x, p.y + 1)
  return false
}

function leftClick(m: Model, z: Zone | undefined, p: ClientPointerEvent, isDouble: boolean): boolean | void {
  if (!z) return false
  const b = activeBuf(m)
  switch (z.id) {
    case 'treeToggle':
      return send(m, { k: 'option', key: 'showTree', value: !m.props.options.showTree })
    case 'tab': {
      const path = z.data as string
      if (path !== m.props.active) send(m, { k: 'activate', path })
      if (isDouble) send(m, { k: 'pin', path })
      m.focus = 'editor'
      return
    }
    case 'tabx':
      return requestClose(m, z.data as string)
    case 'tabprev':
      m.tabStart = Math.max(0, m.tabStart - 1)
      return
    case 'tabnext':
      m.tabStart += 1
      return
    case 'icon:find':
      return toggleFind(m)
    case 'icon:menu': {
      if (m.menu?.kind === 'view') {
        m.menu = null
        return
      }
      const L = m.layout
      return openMenu(m, 'view', '', false, (L?.W ?? 80) - menuWidth(viewMenu(m.props.options)) - 2, 1)
    }
    case 'icon:max':
      return send(m, { k: 'pane', what: 'maximize' })
    case 'icon:close':
      return send(m, { k: 'pane', what: 'close' })
    case 'search':
      m.focus = 'search'
      m.search.cx = m.search.text.length
      return
    case 'row': {
      const row = m.rows[z.data as number]
      if (!row || row.kind === 'x' || row.kind === 'l') return false
      m.treeSel = row.path
      m.focus = 'tree'
      if (row.kind === 'd' || row.kind === 'o') return send(m, { k: 'toggle', path: row.path })
      send(m, { k: 'open', path: row.path, preview: !isDouble })
      if (isDouble) m.focus = 'editor'
      return
    }
    case 'result': {
      const path = z.data as string
      m.search.sel = m.props.find.results.indexOf(path)
      return openResult(m, path, isDouble)
    }
    case 'crumb':
      return send(m, { k: 'act', id: 'revealInTree', path: z.data as string, isDir: true })
    case 'mdToggle': {
      const path = z.data as string
      if (m.mdSource.has(path)) m.mdSource.delete(path)
      else m.mdSource.add(path)
      return
    }
    case 'edit': {
      m.focus = 'editor'
      const L = m.layout
      if (!b || !L || b.large) return
      const col = Math.max(0, p.x - L.textX) + (m.props.options.wordWrap ? 0 : b.left)
      placeAt(m, b, L, b.top + (p.y - L.edY), col)
      b.want = -1
      return
    }
    case 'md': {
      m.focus = 'editor'
      if (isDouble && b) {
        // Double clic dans l'aperçu : le source, au début du bloc affiché en haut.
        const block = blocksOf(b)[m.mdTop.get(b.path) ?? 0]
        m.mdSource.add(b.path)
        b.cy = block?.start ?? 0
        b.cx = 0
        if (m.layout) b.top = prefixOf(m, b, m.layout)[b.cy] ?? 0
      }
      return
    }
    case 'sbEdit':
    case 'sbTree':
    case 'split':
      m.drag = { kind: z.id }
      return dragTo(m, p.x, p.y)
    case 'reloadDisk':
      if (b) {
        b.dirty = false
        b.conflict = false
        b.rev = -1
        send(m, { k: 'reload', path: b.path })
      }
      return
    case 'keepMine':
      if (b) {
        b.conflict = false
        b.rev = m.props.doc?.rev ?? b.rev
        b.draftSent = false
        send(m, { k: 'keep', path: b.path })
      }
      return
    case 'confirm':
      return answerConfirm(m, z.data as 'save' | 'discard' | 'cancel')
    case 'findInput':
      m.focus = 'find'
      return
    case 'findPrev':
    case 'findNext':
      if (b) gotoMatch(m, b, z.id === 'findNext' ? 1 : -1)
      return
    case 'findClose':
      m.find.open = false
      m.focus = 'editor'
      return
    case 'openDefault':
      return send(m, { k: 'act', id: 'openIn:default', path: z.data as string, isDir: false })
    case 'menuItem': {
      const { level, index } = z.data as { level: number; index: number }
      const menu = m.menu
      if (!menu || index < 0) return false
      const items = level === 0 ? menu.items : (menu.sub?.items ?? [])
      if (level === 0) menu.sel = index
      else if (menu.sub) menu.sub.sel = index
      return chooseItem(m, items[index], level === 0)
    }
    case 'content':
      m.focus = 'editor'
      return
    case 'list':
      m.focus = 'tree'
      return
  }
  return false
}

function dragTo(m: Model, x: number, y: number) {
  const L = m.layout
  if (!L || !m.drag) return false
  if (m.drag.kind === 'split') {
    m.sideW = clamp(x, 16, L.W - 40)
    return
  }
  const ratio = (y - (m.drag.kind === 'sbTree' ? L.listY : L.edY)) / Math.max(1, (m.drag.kind === 'sbTree' ? L.listH : L.edH) - 1)
  const r = clamp(ratio, 0, 1)
  if (m.drag.kind === 'sbTree') {
    m.treeTop = Math.round(r * Math.max(0, listLength(m) - L.listH))
    return
  }
  const b = activeBuf(m)
  if (!b) return
  if (b.path && isRendered(m, b.path)) {
    m.mdTop.set(b.path, Math.round(r * Math.max(0, blocksOf(b).length - 1)))
    return
  }
  b.top = Math.round(r * maxTop(m, b, L))
}

function wheel(m: Model, by: number, column: number) {
  const L = m.layout
  if (!L) return
  const step = by * 3
  if (L.treeShown && column < L.S) {
    m.treeTop = clamp(m.treeTop + step, 0, Math.max(0, listLength(m) - L.listH))
    return
  }
  const b = activeBuf(m)
  if (!b) return
  if (isRendered(m, b.path)) {
    m.mdTop.set(b.path, clamp((m.mdTop.get(b.path) ?? 0) + by, 0, Math.max(0, blocksOf(b).length - 1)))
    return
  }
  scrollEditor(m, b, step)
}

const listLength = (m: Model) => (m.search.text.trim() ? m.props.find.results.length : m.rows.length)

// ─── Dessin ─────────────────────────────────────────────────────────────────

type Seg = { t: string; color?: string; bg?: string; dim?: boolean; bold?: boolean; inv?: boolean; it?: boolean; ul?: boolean }

const sameStyle = (a: Seg, b: Seg) =>
  a.color === b.color && a.bg === b.bg && a.dim === b.dim && a.bold === b.bold && a.inv === b.inv && a.it === b.it && a.ul === b.ul

function merge(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    if (!s.t) continue
    const last = out[out.length - 1]
    if (last && sameStyle(last, s)) last.t += s.t
    else out.push({ ...s })
  }
  return out
}

const segsWidth = (segs: readonly Seg[]) => segs.reduce((w, s) => w + strWidth(s.t), 0)

/** Complète ou coupe une rangée à `width` colonnes. */
function fill(segs: Seg[], width: number, style: Omit<Seg, 't'> = {}): Seg[] {
  const out: Seg[] = []
  let w = 0
  for (const s of segs) {
    if (w >= width) break
    const sw = strWidth(s.t)
    if (w + sw <= width) {
      out.push(s)
      w += sw
    } else {
      out.push({ ...s, t: fit(s.t, width - w) })
      w = width
    }
  }
  if (w < width) out.push({ ...style, t: ' '.repeat(width - w) })
  return out
}

function draw(m: Model) {
  const E = m.surface.elements as any
  const L = computeLayout(m)
  m.layout = L
  m.zones = []
  const zone = (x0: number, x1: number, y0: number, y1: number, id: string, data?: unknown) => m.zones.push({ x0, x1, y0, y1, id, data })

  const textEl = (s: Seg) => {
    // Un caractère de contrôle (dans un nom de fichier) ferait refuser tout le dessin.
    const props: Record<string, unknown> = { children: s.t.replace(CONTROL, '�') }
    if (s.color) props.color = s.color
    if (s.bg) props.backgroundColor = s.bg
    if (s.dim) props.dimColor = true
    if (s.bold) props.bold = true
    if (s.inv) props.inverse = true
    if (s.it) props.italic = true
    if (s.ul) props.underline = true
    return E.Text(props)
  }
  const rowEl = (segs: Seg[], width: number) =>
    E.Box({ height: 1, width, flexShrink: 0, overflow: 'hidden', children: merge(fill(segs, width)).map(textEl) })

  if (L.H < 6 || L.W < 24) return E.Text({ dimColor: true, children: 'Panneau trop petit pour le navigateur de fichiers.' })

  const children: unknown[] = [rowEl(drawToolbar(m, L, zone), L.W)]
  const body: unknown[] = []
  if (L.treeShown) {
    body.push(E.Box({ flexDirection: 'column', width: L.S, height: L.H - 1, flexShrink: 0, children: drawSidebar(m, L, zone).map((r) => rowEl(r, L.S)) }))
  }
  if (L.treeShown && L.contentShown) {
    zone(L.S, L.S + 1, 1, L.H, 'split')
    const sep = Array.from({ length: L.H - 1 }, () => rowEl([{ t: '│', dim: true }], 1))
    body.push(E.Box({ flexDirection: 'column', width: 1, height: L.H - 1, flexShrink: 0, children: sep }))
  }
  if (L.contentShown) body.push(E.Box({ flexDirection: 'column', width: L.CW, height: L.H - 1, flexShrink: 0, children: drawContent(m, L, zone, rowEl, E) }))
  children.push(E.Box({ flexDirection: 'row', height: L.H - 1, width: L.W, children: body }))
  if (m.menu) children.push(...drawMenu(m, zone, rowEl, E))
  return E.Box({ flexDirection: 'column', width: L.W, height: L.H, overflow: 'hidden', children })
}

type ZoneFn = (x0: number, x1: number, y0: number, y1: number, id: string, data?: unknown) => void
type RowFn = (segs: Seg[], width: number) => unknown

/** Le nom d'un onglet ; deux fichiers de même nom ajoutent leur dossier. */
function tabName(path: string, all: readonly { path: string }[]) {
  const name = baseName(path)
  const twins = all.filter((t) => baseName(t.path) === name).length > 1
  return twins ? `${name} · ${baseName(parentOf(path)) || '/'}` : name
}

function drawToolbar(m: Model, L: Layout, zone: ZoneFn): Seg[] {
  const p = m.props
  const segs: Seg[] = [{ t: '≡', bold: true, color: p.options.showTree ? ACCENT : undefined }, { t: ' ' }]
  zone(0, 2, 0, 1, 'treeToggle')
  const right = 9
  const avail = L.W - 2 - right
  const tabs = p.tabs.map((t) => {
    const name = tabName(t.path, p.tabs)
    // Un seul signe par onglet : le brouillon d'abord, puis la marque de Claude, sinon la croix.
    const mark = p.dirty.includes(t.path) || m.bufs.get(t.path)?.dirty ? '●' : p.touched.includes(t.path) ? '◆' : '×'
    return { t, name, mark, w: strWidth(name) + 4 }
  })
  const ai = tabs.findIndex((x) => x.t.path === p.active)
  let start = clamp(m.tabStart, 0, Math.max(0, tabs.length - 1))
  if (ai >= 0 && ai < start) start = ai
  const widthFrom = (s: number, e: number) => tabs.slice(s, e + 1).reduce((w, x) => w + x.w, 0) + (s > 0 ? 2 : 0)
  while (ai >= 0 && start < ai && widthFrom(start, ai) > avail - 2) start += 1
  m.tabStart = start
  let x = 2
  if (start > 0) {
    segs.push({ t: '‹ ', dim: true })
    zone(x, x + 2, 0, 1, 'tabprev')
    x += 2
  }
  let i = start
  for (; i < tabs.length; i++) {
    const tab = tabs[i]!
    if (x + tab.w > 2 + avail - (i < tabs.length - 1 ? 2 : 0)) break
    const isActive = tab.t.path === p.active
    const style: Omit<Seg, 't'> = { inv: isActive, it: tab.t.isPreview, dim: !isActive }
    segs.push({ ...style, t: ` ${tab.name} ` }, { ...style, t: tab.mark, color: tab.mark === '●' ? 'yellow' : tab.mark === '◆' ? CLAUDE_MARK : undefined }, { ...style, t: ' ' })
    zone(x, x + tab.w - 2, 0, 1, 'tab', tab.t.path)
    zone(x + tab.w - 2, x + tab.w, 0, 1, 'tabx', tab.t.path)
    x += tab.w
  }
  if (i < tabs.length) {
    segs.push({ t: ' ›', dim: true })
    zone(x, x + 2, 0, 1, 'tabnext')
    x += 2
  }
  if (!tabs.length) segs.push({ t: p.rootName, dim: true })
  const fixed = fill(segs, L.W - right)
  const icons: [string, string][] = [
    ['icon:find', '⌕'],
    ['icon:menu', '⋮'],
    ['icon:max', p.isMaximized ? '▣' : '□'],
    ['icon:close', '×'],
  ]
  const tail: Seg[] = [{ t: ' ' }]
  icons.forEach(([id, glyph], j) => {
    const at = L.W - right + 1 + j * 2
    const isOn = (id === 'icon:menu' && m.menu?.kind === 'view') || (id === 'icon:find' && m.find.open)
    tail.push({ t: ` ${glyph}`, bold: true, color: isOn ? ACCENT : undefined })
    zone(at, at + 2, 0, 1, id)
  })
  return [...fixed, ...tail]
}

function drawSidebar(m: Model, L: Layout, zone: ZoneFn): Seg[][] {
  const W = L.S
  const rows: Seg[][] = []
  const s = m.search
  const isFocused = m.focus === 'search'
  // La case de recherche.
  const field: Seg[] = [{ t: ' ⌕ ', color: isFocused ? ACCENT : undefined, dim: !isFocused }]
  if (!s.text && !isFocused) field.push({ t: 'Rechercher des fichiers', dim: true })
  else field.push(...cursorLine(s.text, isFocused ? s.cx : -1, W - 4))
  rows.push(fill(field, W, { ul: false }))
  zone(0, W, 1, 2, 'search')
  const H = L.listH
  const query = s.text.trim()
  const list: Seg[][] = []
  const kinds: { id: string; data: unknown }[] = []
  if (query) {
    const f = m.props.find
    const results = f.results
    const isStale = f.query !== s.text
    s.sel = clamp(s.sel, 0, Math.max(0, results.length - 1))
    if (s.sel < s.top) s.top = s.sel
    if (s.sel >= s.top + H - 3) s.top = s.sel - (H - 3) + 1
    const notes: Seg[][] = []
    if ((f.isLoading || isStale) && !results.length) notes.push([{ t: '  Recherche…', dim: true, it: true }])
    else if (!results.length) notes.push([{ t: '  Aucun fichier ne correspond.', dim: true, it: true }])
    if (f.total > results.length) {
      for (const line of wrapWords('Certaines entrées peuvent ne pas être affichées. Continuez à saisir pour affiner.', W - 3)) notes.push([{ t: `  ${line}`, dim: true }])
    }
    const room = Math.max(1, H - notes.length)
    results.slice(s.top, s.top + room).forEach((path, j) => {
      const i = s.top + j
      const isDir = path.endsWith('/')
      const clean = isDir ? path.slice(0, -1) : path
      const sel = i === s.sel
      const name = baseName(clean) + (isDir ? '/' : '')
      const dir = parentOf(clean)
      list.push([
        { t: ' ', inv: sel && isFocused },
        { t: isDir ? '▸ ' : '  ', inv: sel && isFocused, dim: !sel },
        { t: name, bold: true, inv: sel && isFocused, color: sel && !isFocused ? ACCENT : undefined },
        { t: dir ? `  ${dir}` : '', dim: true, inv: sel && isFocused },
      ])
      kinds.push({ id: 'result', data: path })
    })
    list.push(...notes)
    notes.forEach(() => kinds.push({ id: 'list', data: null }))
  } else {
    const rowsAll = m.rows
    m.treeTop = clamp(m.treeTop, 0, Math.max(0, rowsAll.length + (m.props.rowsHidden ? 1 : 0) - H))
    const activePath = m.props.active
    const marks = touchedMarks(m.props.touched)
    for (let j = 0; j < H && m.treeTop + j < rowsAll.length; j++) {
      const i = m.treeTop + j
      const r = rowsAll[i]!
      const isNote = r.kind === 'x' || r.kind === 'l'
      const sel = !isNote && r.path === m.treeSel
      const inv = sel && m.focus === 'tree'
      const chevron = r.kind === 'o' ? '▾ ' : r.kind === 'd' ? '▸ ' : '  '
      const isDirty = r.kind === 'f' && (m.props.dirty.includes(r.path) || Boolean(m.bufs.get(r.path)?.dirty))
      list.push([
        { t: ' '.repeat(1 + r.depth * 2), inv },
        { t: chevron, dim: !inv, inv },
        {
          t: r.name,
          inv,
          dim: isNote,
          it: isNote,
          bold: sel && !inv,
          color: isNote ? undefined : r.path === activePath && !inv ? ACCENT : undefined,
        },
        { t: isDirty ? ' ●' : '', color: 'yellow', inv },
        { t: r.kind === 'f' ? (marks.files.has(r.path) ? ' ◆' : '') : (r.kind === 'd' || r.kind === 'o') && marks.dirs.has(r.path) ? ' ◇' : '', color: CLAUDE_MARK, inv },
      ])
      kinds.push({ id: 'row', data: i })
    }
    if (m.props.rowsHidden && list.length < H) {
      list.push([{ t: `  … ${m.props.rowsHidden} lignes non affichées : repliez des dossiers`, dim: true, it: true }])
      kinds.push({ id: 'list', data: null })
    }
  }
  const total = query ? m.props.find.results.length : m.rows.length
  const top = query ? s.top : m.treeTop
  const bar = scrollbar(total, top, H)
  for (let j = 0; j < H; j++) {
    const y = L.listY + j
    const segs = list[j] ?? []
    const thumb = bar(j)
    rows.push([...fill(segs, W - 1), { t: thumb ? '▐' : ' ', dim: true }])
    const k = kinds[j]
    zone(0, W - 1, y, y + 1, k?.id ?? 'list', k?.data)
  }
  if (total > H) zone(W - 1, W, L.listY, L.listY + H, 'sbTree')
  return rows
}

/** Une ligne de saisie avec son curseur (inversé), coupée autour de lui. */
function cursorLine(text: string, cx: number, width: number): Seg[] {
  if (cx < 0) return [{ t: fit(text, width) }]
  let from = 0
  while (strWidth(text.slice(from, cx)) > width - 1) from += 1
  const before = text.slice(from, cx)
  const at = text[cx] ?? ' '
  const after = text.slice(cx + 1)
  return [{ t: before }, { t: at, inv: true }, { t: fit(after, Math.max(0, width - strWidth(before) - 1)) }]
}

function wrapWords(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const w of text.split(' ')) {
    if (line && strWidth(`${line} ${w}`) > width) {
      out.push(line)
      line = w
    } else line = line ? `${line} ${w}` : w
  }
  if (line) out.push(line)
  return out
}

/** Où dessiner le pouce d'une barre de défilement de `rows` rangées. */
function scrollbar(total: number, top: number, rows: number): (j: number) => boolean {
  if (total <= rows || rows < 2) return () => false
  const size = Math.max(1, Math.round((rows * rows) / total))
  const at = Math.round((top / Math.max(1, total - rows)) * (rows - size))
  return (j) => j >= at && j < at + size
}

function drawContent(m: Model, L: Layout, zone: ZoneFn, rowEl: RowFn, E: any): unknown[] {
  const p = m.props
  const W = L.CW
  const x0 = L.cx0
  const out: unknown[] = []
  const doc = p.doc && p.doc.path === p.active ? p.doc : null
  const b = activeBuf(m)
  zone(x0, x0 + W, 1, L.H, 'content')
  // Fil d'Ariane : les dossiers du fichier, cliquables, et la bascule aperçu/source.
  const crumb: Seg[] = [{ t: ' ' }]
  let x = x0 + 1
  if (p.active) {
    const parts = p.active.split('/')
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1
      const text = fit(part, 40)
      crumb.push({ t: text, dim: !isLast, bold: isLast })
      zone(x, x + strWidth(text), 1, 2, isLast ? 'crumbFile' : 'crumb', parts.slice(0, i + 1).join('/'))
      x += strWidth(text)
      if (!isLast) {
        crumb.push({ t: ` ${p.sep} `, dim: true })
        x += 3
      }
    })
  } else crumb.push({ t: p.root, dim: true })
  // Claude a modifié le fichier depuis le dernier message : le fil d'Ariane le dit, et dit aussi
  // le rechargement de l'onglet, qui sinon passerait inaperçu.
  if (p.active && doc && !b?.dirty && p.touched.includes(p.active)) {
    crumb.push({ t: doc.origin === 'claude' ? '  ◆ Rechargé : modifié par Claude' : '  ◆ Modifié par Claude', color: CLAUDE_MARK })
  }
  const md = p.active && isMarkdown(p.active)
  if (md && p.active) {
    const toggle = isRendered(m, p.active) ? ' </> ' : ' Aperçu '
    const left = fill(crumb, W - strWidth(toggle))
    out.push(rowEl([...left, { t: toggle, color: ACCENT, bold: true }], W))
    zone(x0 + W - strWidth(toggle), x0 + W, 1, 2, 'mdToggle', p.active)
  } else out.push(rowEl(crumb, W))
  let y = 2
  if (b?.conflict) {
    const segs: Seg[] = [{ t: ' ⚠ Modifié sur le disque pendant vos modifications. ', color: 'yellow' }]
    const a = x0 + segsWidth(segs)
    segs.push({ t: '[Recharger]', color: ACCENT }, { t: '  ' }, { t: '[Garder les miennes]', color: ACCENT })
    zone(a, a + 11, y, y + 1, 'reloadDisk')
    zone(a + 13, a + 33, y, y + 1, 'keepMine')
    out.push(rowEl(segs, W))
    y += 1
  }
  if (m.confirm) {
    const segs: Seg[] = [{ t: ` « ${baseName(m.confirm)} » n'est pas enregistré : `, color: 'yellow' }]
    let a = x0 + segsWidth(segs)
    for (const [label, choice] of [
      ['[Enregistrer]', 'save'],
      ['[Ne pas enregistrer]', 'discard'],
      ['[Annuler]', 'cancel'],
    ] as const) {
      segs.push({ t: label, color: ACCENT }, { t: ' ' })
      zone(a, a + strWidth(label), y, y + 1, 'confirm', choice)
      a += strWidth(label) + 1
    }
    out.push(rowEl(segs, W))
    y += 1
  }
  if (m.find.open && b && !b.large) {
    const matches = matchesOf(m, b)
    const isFocused = m.focus === 'find'
    const count = !m.find.text ? '' : matches.length ? `${Math.min(m.find.idx + 1, matches.length)}/${matches.length}` : 'Aucun résultat'
    const tail: Seg[] = [{ t: ` ${count} `, dim: !matches.length }, { t: ' ↑ ' }, { t: ' ↓ ' }, { t: ' × ' }]
    const tw = segsWidth(tail)
    const inputW = Math.max(6, W - 4 - tw)
    const segs: Seg[] = [{ t: ' ⌕ ', color: isFocused ? ACCENT : undefined }, ...fill(cursorLine(m.find.text, isFocused ? m.find.cx : -1, inputW), inputW), ...tail]
    zone(x0, x0 + 3 + inputW, y, y + 1, 'findInput')
    const t0 = x0 + 3 + inputW + strWidth(` ${count} `)
    zone(t0, t0 + 3, y, y + 1, 'findPrev')
    zone(t0 + 3, t0 + 6, y, y + 1, 'findNext')
    zone(t0 + 6, t0 + 9, y, y + 1, 'findClose')
    out.push(rowEl(segs, W))
    y += 1
  }
  // La zone d'édition.
  if (!p.active) out.push(...drawEmpty(m, L, rowEl))
  else if (!doc || doc.state === 'loading') out.push(...messageRows(L.edH, [[{ t: '  Lecture…', dim: true, it: true }]], rowEl, W))
  else if (doc.state === 'binary' || doc.state === 'error') {
    const lines: Seg[][] = [
      [{ t: doc.state === 'binary' ? "  Fichier binaire : pas d'aperçu dans le terminal." : `  ${doc.error ?? 'Lecture impossible.'}`, color: doc.state === 'error' ? 'red' : undefined, dim: doc.state === 'binary' }],
      [{ t: '' }],
      [{ t: '  ' }, { t: "[Ouvrir dans l'application par défaut]", color: ACCENT }],
    ]
    zone(x0 + 2, x0 + 40, L.edY + 2, L.edY + 3, 'openDefault', doc.path)
    out.push(...messageRows(L.edH, lines, rowEl, W))
  } else if (b && isRendered(m, b.path)) out.push(drawMarkdown(m, b, L, zone, E, rowEl))
  else if (b) out.push(...drawEditor(m, b, L, zone, rowEl))
  else out.push(...messageRows(L.edH, [[{ t: '  Lecture…', dim: true, it: true }]], rowEl, W))
  out.push(rowEl(drawStatus(m, b, doc, W), W))
  return out
}

function messageRows(h: number, lines: Seg[][], rowEl: RowFn, W: number): unknown[] {
  return Array.from({ length: h }, (_, j) => rowEl(lines[j] ?? [], W))
}

function drawEmpty(m: Model, L: Layout, rowEl: RowFn): unknown[] {
  const lines: Seg[][] = [
    [],
    [{ t: '  Aucun fichier ouvert', bold: true }],
    [],
    [{ t: "  Clic sur un fichier de l'arborescence : aperçu ; double clic : ouvert.", dim: true }],
    [{ t: '  Clic droit : joindre comme contexte, copier, ouvrir dans…', dim: true }],
    [{ t: "  Tapez dans l'arborescence (ou Ctrl+P) pour rechercher un fichier.", dim: true }],
    [{ t: "  ⋮ : options d'affichage · Échap : rendre le clavier au prompt", dim: true }],
    [],
    [{ t: `  ${m.props.root}`, dim: true, it: true }],
  ]
  return messageRows(L.edH, lines, rowEl, L.CW)
}

function drawMarkdown(m: Model, b: Buf, L: Layout, zone: ZoneFn, E: any, rowEl: RowFn): unknown {
  const blocks = blocksOf(b)
  const top = clamp(m.mdTop.get(b.path) ?? 0, 0, Math.max(0, blocks.length - 1))
  m.mdTop.set(b.path, top)
  const parts: string[] = []
  let size = 0
  for (let i = top; i < blocks.length && size < 9000 && parts.length < 80; i++) {
    const text = blocks[i]!.text
    if (size + text.length > 9500 && parts.length) break
    parts.push(text)
    size += text.length + 2
  }
  zone(L.cx0, L.cx0 + L.CW - 1, L.edY, L.edY + L.edH, 'md')
  // L'aperçu défile par blocs : le pouce montre la part des blocs affichés.
  const isAll = top === 0 && parts.length >= blocks.length
  const thumb = Math.max(1, Math.round((L.edH * parts.length) / Math.max(1, blocks.length)))
  const at = Math.min(L.edH - thumb, Math.round((top / Math.max(1, blocks.length)) * L.edH))
  const bar = (j: number) => !isAll && j >= at && j < at + thumb
  if (!isAll) zone(L.cx0 + L.CW - 1, L.cx0 + L.CW, L.edY, L.edY + L.edH, 'sbEdit')
  const text = parts.join('\n\n').replace(CONTROL_MD, '�') || '_Document vide._'
  return E.Box({
    flexDirection: 'row',
    height: L.edH,
    width: L.CW,
    flexShrink: 0,
    children: [
      E.Box({ height: L.edH, width: L.CW - 1, overflow: 'hidden', flexDirection: 'column', paddingLeft: 1, children: [E.Markdown({ text })] }),
      E.Box({ flexDirection: 'column', width: 1, height: L.edH, children: Array.from({ length: L.edH }, (_, j) => rowEl([{ t: bar(j) ? '▐' : ' ', dim: true }], 1)) }),
    ],
  })
}

/** Les colonnes de l'indentation d'une ligne ; une ligne blanche prend celle de la suivante. */
function indentWidth(b: Buf, i: number, tabSize: number): number {
  for (let j = i; j < Math.min(b.lines.length, i + 50); j++) {
    const line = lineText(b, j) ?? ''
    if (line.trim()) return colOf(glyphs(line, tabSize), (/^[ \t]*/.exec(line)?.[0] ?? '').length)
  }
  return 0
}

type Cell = { ch: string; w: number; cls: string; ws: boolean; guide: boolean; match: 0 | 1 | 2; cursor: boolean }

function drawEditor(m: Model, b: Buf, L: Layout, zone: ZoneFn, rowEl: RowFn): unknown[] {
  const o = m.props.options
  const tabSize = o.tabSize
  const wrap = o.wordWrap && !b.large
  const prefix = prefixOf(m, b, L)
  const total = b.large ? b.large.count : (prefix[b.lines.length] ?? 1)
  b.top = clamp(b.top, 0, maxTop(m, b, L))
  const lang = langOf(b.path)
  const matches = matchesOf(m, b)
  const current = matches[m.find.idx]
  const isFocused = m.focus === 'editor' && !b.readOnly
  const rows: unknown[] = []
  const gutterW = L.gutter
  const step = indentStep(unitOf(m, b), tabSize)
  // Un fichier volumineux : demander la fenêtre qui couvre l'écran quand elle manque.
  if (b.large) {
    const need = b.top
    const lg = b.large
    if ((need < lg.from || need + L.edH > lg.from + lg.lines.length) && lg.asked !== need) {
      lg.asked = need
      send(m, { k: 'window', path: b.path, from: Math.max(0, need - 100) })
    }
  }
  const bar = scrollbar(total + (o.scrollBeyondLastLine ? L.edH - 1 : 0), b.top, L.edH)
  let tokLine = -1
  let toks: [number, number, string][] = []
  let state: HlState = ''
  for (let r = 0; r < L.edH; r++) {
    const vr = b.top + r
    const y = L.edY + r
    const thumb: Seg = { t: bar(r) ? '▐' : ' ', dim: true }
    if (vr >= total) {
      rows.push(rowEl([{ t: ' '.repeat(L.CW - 1) }, thumb], L.CW))
      continue
    }
    const li = b.large ? vr : lineAtRow(prefix, vr)
    const sub = b.large ? 0 : vr - (prefix[li] ?? 0)
    const line = lineText(b, li)
    const isCursorLine = li === b.cy && !b.large
    const num = sub === 0 ? String(li + 1).padStart(gutterW - 1) : ' '.repeat(gutterW - 1)
    const gutter: Seg = { t: `${num} `, dim: !isCursorLine }
    if (line === null) {
      rows.push(rowEl([gutter, { t: '…', dim: true }, ...fill([], L.textW - 1), thumb], L.CW))
      continue
    }
    if (tokLine !== li) {
      if (!b.large) state = hlStateAt(b, li)
      else if (li !== tokLine + 1) state = ''
      const res = tokenize(line, lang, state)
      toks = res.toks
      state = res.state
      tokLine = li
    }
    const gl = glyphs(line, tabSize)
    const starts = wrap ? wrapRows(gl, L.textW) : [0]
    const from = starts[sub] ?? 0
    const to = starts[sub + 1] ?? gl.length
    const cls = new Array<string>(line.length).fill('')
    for (const [s, e, c] of toks) for (let i = s; i < e && i < line.length; i++) cls[i] = c
    const lead = o.indentGuides ? indentWidth(b, li, tabSize) : 0
    const lineMatches = matches.filter((mt) => mt[0] === li)
    const cells: Cell[] = []
    const base = gl[from]?.col ?? (from >= gl.length ? glyphsWidth(gl) : 0)
    const cursorCol = isCursorLine ? colOf(gl, b.cx) : -1
    for (let g = from; g < to; g++) {
      const x = gl[g]!
      const inMatch = lineMatches.find((mt) => x.i >= mt[1] && x.i < mt[2])
      const match: Cell['match'] = inMatch ? (inMatch === current ? 2 : 1) : 0
      const isWs = x.ch === ' ' || x.ch === '\t'
      for (let c = 0; c < Math.max(1, x.w); c++) {
        const col = x.col + c
        let ch = x.ch
        if (x.ch === '\t') ch = o.showWhitespace && c === 0 ? '→' : ' '
        else if (x.ch === ' ') ch = o.showWhitespace ? '·' : ' '
        else if (c > 0) continue
        const guide = isWs && col < lead && col % step === 0 && (ch === ' ' || ch === '·')
        cells.push({ ch: guide ? '│' : ch, w: x.ch === '\t' || x.ch === ' ' ? 1 : x.w, cls: cls[x.i] ?? '', ws: isWs, guide, match, cursor: isFocused && col === cursorCol && c === 0 })
        if (x.w === 0) break
      }
    }
    // Le curseur en fin de ligne : une case vide inversée, sur la dernière rangée de la ligne.
    if (isFocused && isCursorLine && cursorCol >= glyphsWidth(gl) && sub === starts.length - 1) {
      cells.push({ ch: ' ', w: 1, cls: '', ws: false, guide: false, match: 0, cursor: true })
    }
    const segs: Seg[] = [gutter]
    let colAt = base
    let used = 0
    for (const cell of cells) {
      const cellCol = colAt
      colAt += cell.w
      if (!wrap && (cellCol < b.left || cellCol >= b.left + L.textW)) continue
      if (used + cell.w > L.textW) break
      used += cell.w
      const seg: Seg = { t: cell.ch }
      if (cell.guide || (cell.ws && o.showWhitespace)) seg.dim = true
      else if (cell.cls) {
        seg.color = SYNTAX[cell.cls]
        if (cell.cls === 'h' || cell.cls === 'b') seg.bold = true
      }
      if (cell.match === 1) seg.bg = MATCH_BG
      if (cell.match === 2) {
        seg.bg = CURRENT_BG
        seg.color = 'black'
      }
      if (cell.cursor) seg.inv = true
      segs.push(seg)
    }
    rows.push(rowEl([...fill(segs, L.CW - 1), thumb], L.CW))
    zone(L.cx0, L.cx0 + L.CW - 1, y, y + 1, 'edit')
  }
  if (total > L.edH) zone(L.cx0 + L.CW - 1, L.cx0 + L.CW, L.edY, L.edY + L.edH, 'sbEdit')
  return rows
}

function drawStatus(m: Model, b: Buf | undefined, doc: DocView | null, W: number): Seg[] {
  const p = m.props
  const items: string[] = []
  let note = ''
  if (doc && !b) {
    note = doc.state === 'binary' ? 'Fichier binaire' : doc.state === 'error' ? 'Lecture impossible' : 'Lecture…'
    if (doc.size) items.push(`${doc.size} octets`)
  } else if (b && doc) {
    if (b.large) note = `Lecture seule : fichier volumineux (${b.large.count} lignes)`
    else if (isRendered(m, b.path)) note = 'Aperçu Markdown'
    else {
      const col = colOf(glyphs(b.lines[b.cy] ?? '', p.options.tabSize), b.cx)
      items.push(`Ln ${b.cy + 1}, Col ${col + 1}`)
      const unit = unitOf(m, b)
      items.push(unit === '\t' ? `Tabulations : ${p.options.tabSize}` : `Espaces : ${unit.length}`)
    }
    items.push(doc.eol === '\r\n' ? 'CRLF' : 'LF', languageLabel(b.path))
    if (!b.large) items.push(b.dirty ? '● Modifié' : p.options.autoSave ? '✓ Enregistrement auto' : '✓ Enregistré')
  } else if (!p.isFullscreen) note = "Affichage principal : la souris n'atteint pas le navigateur."
  else if (m.focus === 'tree' || m.focus === 'search') note = '↑↓ naviguer · → ← déplier · Entrée ouvrir · Maj+F10 menu'
  const right = items.join('  ·  ')
  const left = fit(note ? ` ${note}` : '', Math.max(0, W - strWidth(right) - 2))
  const gap = Math.max(1, W - strWidth(left) - strWidth(right) - 1)
  return [{ t: left, dim: true, it: true }, { t: ' '.repeat(gap) }, { t: right, dim: true }, { t: ' ' }]
}

function drawMenu(m: Model, zone: ZoneFn, rowEl: RowFn, E: any): unknown[] {
  const menu = m.menu!
  const out: unknown[] = []
  const box = (level: SubMenu, depth: number) => {
    // Le fond du menu absorbe les clics qui ne tombent sur aucune entrée (index -1).
    zone(level.x, level.x + level.w + 2, level.y, level.y + level.items.length + 2, 'menuItem', { level: depth, index: -1 })
    const rows = level.items.map((it, i) => {
      const y = level.y + 1 + i
      if (it.isSeparator) return rowEl([{ t: '─'.repeat(level.w), dim: true }], level.w)
      const sel = i === level.sel
      const check = it.check === undefined ? '  ' : it.check ? '✓ ' : '  '
      const hint = it.sub ? `${it.hint ? `${it.hint} ` : ''}›` : (it.hint ?? '')
      const label = pad(`${check}${it.label}`, Math.max(0, level.w - strWidth(hint) - 1))
      zone(level.x + 1, level.x + 1 + level.w, y, y + 1, 'menuItem', { level: depth, index: i })
      return rowEl([{ t: label, inv: sel, dim: it.isDisabled }, { t: hint, inv: sel, dim: !sel }, { t: ' ', inv: sel }], level.w)
    })
    out.push(
      E.Box({
        position: 'absolute',
        top: level.y,
        left: level.x,
        width: level.w + 2,
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: 'gray',
        children: rows,
      }),
    )
  }
  box(menu, 0)
  if (menu.sub) box(menu.sub, 1)
  return out
}
