// Frise du terminal : une piste = une rangée de cases (glyphe, couleur de texte, couleur de fond).
// Posée dans une grille `Raster` quand la surface l'a, sinon en Text colorés (barres en blocs).
// Repris de la méthode de stats-board (raster.ts), sans en dépendre : chaque plugin reste seul.

import { C } from './catalog.ts'
import type { AgentMark, SegmentKind, ToolFamily } from '../types'
import type { LanePart } from './timeline.ts'

/** La couleur par défaut du terminal (bit 24 seul). */
export const DEFAULT = 0x01000000
const SPACE = 0x20

export type Cell = readonly [codePoint: number, foreground: number, background: number]
export type RasterCells = { columns: number; rows: number; cells: string }

/** `#RRGGBB` en `0x00RRGGBB`. */
export const rgb = (hex: string): number => {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  return Number.isFinite(n) ? n & 0xffffff : DEFAULT
}

/** `color` à l'opacité `alpha` sur le fond foncé (C.ink) : le terminal n'a pas de transparence. */
export const tint = (hex: string, alpha: number): number => {
  const a = rgb(C.ink)
  const b = rgb(hex)
  const ch = (shift: number): number => {
    const x = (a >> shift) & 0xff
    const y = (b >> shift) & 0xff
    return Math.round(x + (y - x) * alpha) & 0xff
  }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 standard avec bourrage, écrit à la main (pas de `toBase64` ni de `btoa` supposés). */
const base64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '='
    out += i + 2 < bytes.length ? B64[c & 63]! : '='
  }
  return out
}

/** Empaquette une grille rangée par rangée ; toutes les rangées ont `columns` cases. */
export const pack = (grid: readonly (readonly Cell[])[]): RasterCells => {
  const rows = grid.length
  const columns = grid[0]?.length ?? 0
  const bytes = new Uint8Array(columns * rows * 12)
  const view = new DataView(bytes.buffer)
  let at = 0
  for (const row of grid) {
    for (let x = 0; x < columns; x++) {
      const cell = row[x] ?? [SPACE, DEFAULT, DEFAULT]
      view.setUint32(at, cell[0], true)
      view.setUint32(at + 4, cell[1] >>> 0, true)
      view.setUint32(at + 8, cell[2] >>> 0, true)
      at += 12
    }
  }
  return { columns, rows, cells: base64(bytes) }
}

/** Le glyphe d'une famille d'outils au terminal : une case de large (🌐 en prend deux, d'où ◍). */
export const FAMILY_CELL: Record<ToolFamily, string> = { read: '⌕', edit: '✎', run: '❯', web: '◍', agent: '⇢', other: '•' }

/** La couleur des hachures d'attente : grise pour un sous-agent, ambre pour la personne, bleue pour une tâche de fond, or pour l'advisor. */
export const WAIT_COLOR: Record<'waitAgent' | 'waitPerson' | 'waitBg' | 'waitAdvisor', string> = { waitAgent: C.gray, waitPerson: C.amber, waitBg: C.blue, waitAdvisor: C.gold }

/** Le glyphe d'une attente : hachure, sauf l'advisor en pointillés, que l'or et l'ambre ne confondent pas. */
export const WAIT_GLYPH: Record<'waitAgent' | 'waitPerson' | 'waitBg' | 'waitAdvisor', string> = { waitAgent: '╱', waitPerson: '╱', waitBg: '╱', waitAdvisor: '┄' }

/** Le glyphe d'une barre cerclée (ligne advisor) au terminal. */
export const OUTLINED_CELL = '▭'

/** Le glyphe et la couleur d'un repère. */
export const markLook = (m: AgentMark, color: string): { glyph: string; color: string } =>
  m.k === 'fail'
    ? { glyph: '✗', color: C.red }
    : m.k === 'stop'
      ? { glyph: '⊘', color: C.gray }
      : m.k === 'relay'
        ? { glyph: '↳', color }
        : m.k === 'back'
          ? { glyph: '↲', color }
          : m.k === 'compact'
            ? { glyph: '⇣', color: C.slate }
            : m.k === 'msg'
              ? { glyph: '✉', color: C.blue }
              : m.k === 'commit'
                ? { glyph: '⎇', color: C.green }
                : { glyph: m.ok === false ? '✗' : '✓', color: m.ok === false ? C.red : C.green }

/**
 * Une case de piste : son glyphe, sa couleur (à l'opacité `alpha` sur le fond foncé, 1 par défaut),
 * son fond (chaîne vide : celui du terminal).
 */
export type LaneCell = { glyph: string; color: string; alpha?: number; bg: string }

const KIND_CELL: Record<'think' | 'write' | 'tool', { glyph: string; alpha: number }> = {
  think: { glyph: '▒', alpha: 0.55 },
  write: { glyph: '█', alpha: 1 },
  tool: { glyph: '█', alpha: 0.75 },
}

/**
 * Les cases d'une piste sur `columns` colonnes : chaque case prend la part qui couvre son milieu.
 * Une pause compressée coupe le rail : « ┊ » à ses bords, sa durée entre eux quand elle tient, sinon
 * du vide ; une attente qui la traverse se dessine entre les deux traits, et sur une pause de deux
 * cases ou moins, à la place du second trait (ou des deux), pour rester visible. Le glyphe de l'outil se
 * pose sur la première case d'un appel seulement quand la piste a la place (`withGlyphs`). La ligne
 * advisor (`isOutlined`) pose OUTLINED_CELL à la place des blocs pleins. Les repères passent par-dessus.
 */
export const laneCells = (
  parts: readonly LanePart[],
  marks: readonly (AgentMark & { x: number })[],
  pauses: readonly { x0: number; x1: number; label?: string }[],
  columns: number,
  color: string,
  withGlyphs: boolean,
  isOutlined = false,
): LaneCell[] => {
  const cells: LaneCell[] = Array.from({ length: columns }, () => ({ glyph: '·', color: C.gray, alpha: 0.45, bg: '' }))
  const at = (x: number) => Math.min(columns - 1, Math.max(0, Math.floor(x * columns)))
  const edges = pauses.map(p => [at(p.x0), at(Math.max(p.x0, p.x1 - 1e-9))] as const)
  pauses.forEach((p, i) => {
    const [c0, c1] = edges[i]!
    const label = [...(p.label ?? '')]
    const inner = c1 - c0 - 1
    const pad = label.length <= inner ? Math.floor((inner - label.length) / 2) : inner
    for (let c = c0 + 1; c < c1; c++) cells[c] = { glyph: label[c - c0 - 1 - pad] ?? ' ', color: C.gray, alpha: 0.7, bg: '' }
  })
  const drawn = new Set<number>()
  for (const part of parts) {
    const c0 = at(part.x0)
    const c1 = Math.max(c0, at(Math.max(part.x0, part.x1 - 1e-9)))
    for (let c = c0; c <= c1; c++) {
      const mid = (c + 0.5) / columns
      if (c !== c0 && (mid < part.x0 || mid > part.x1)) continue
      cells[c] = isOutlined && !part.kind.startsWith('wait') ? { glyph: OUTLINED_CELL, color, bg: '' } : cellOf(part.kind, color)
      drawn.add(c)
    }
    if (withGlyphs && part.kind === 'tool' && part.family !== undefined && c1 > c0) cells[c0] = { glyph: FAMILY_CELL[part.family], color: C.ink, bg: color }
  }
  for (const [c0, c1] of edges) {
    // Sans case libre entre les traits, une part dessinée garde ce qu'elle peut de la pause.
    const isCovered = [c0, c1].some(c => drawn.has(c))
    const ticks = !isCovered || c1 - c0 >= 2 ? [c0, c1] : c1 > c0 ? [c0] : []
    for (const c of ticks) cells[c] = { glyph: '┊', color: C.gray, alpha: 0.7, bg: '' }
  }
  for (const m of marks) {
    const look = markLook(m, color)
    cells[at(m.x)] = { glyph: look.glyph, color: look.color, bg: '' }
  }
  return cells
}

const cellOf = (kind: SegmentKind, color: string): LaneCell => {
  if (kind === 'waitAgent' || kind === 'waitPerson' || kind === 'waitBg' || kind === 'waitAdvisor') return { glyph: WAIT_GLYPH[kind], color: WAIT_COLOR[kind], bg: '' }
  const look = KIND_CELL[kind]
  return { glyph: look.glyph, color, alpha: look.alpha, bg: '' }
}

const fgOf = (c: LaneCell): number => (c.alpha !== undefined && c.alpha < 1 ? tint(c.color, c.alpha) : rgb(c.color))

/** Les cases d'une piste, prêtes pour un `Raster` d'une rangée. */
export const laneRaster = (cells: readonly LaneCell[]): RasterCells =>
  pack([cells.map(c => [c.glyph.codePointAt(0) ?? SPACE, fgOf(c), c.bg === '' ? DEFAULT : rgb(c.bg)] as Cell)])

/** La couleur d'une case pour un Text (barres en blocs) : la teinte rendue en `#RRGGBB`. */
export const textColorOf = (c: LaneCell): string => `#${fgOf(c).toString(16).padStart(6, '0')}`

/**
 * La règle graduée au terminal, sur `columns` cases : « ╵ » à chaque graduation et l'heure juste
 * après quand elle tient sans toucher la suivante ; « ┊ » aux bords des pauses compressées. Les
 * blancs sont insécables.
 */
export const rulerCells = (ticks: readonly { x: number; label: string }[], pauses: readonly { x0: number; x1: number }[], columns: number): string => {
  const out = Array.from({ length: columns }, () => '\u00a0')
  const at = (x: number) => Math.min(columns - 1, Math.max(0, Math.floor(x * columns)))
  const cols = ticks.map(t => at(t.x))
  cols.forEach((c, i) => {
    out[c] = '╵'
    const label = [...ticks[i]!.label]
    const next = cols[i + 1] ?? columns
    if (c + label.length < next && c + label.length < columns) label.forEach((ch, j) => (out[c + 1 + j] = ch))
  })
  for (const p of pauses) for (const c of [at(p.x0), at(Math.max(p.x0, p.x1 - 1e-9))]) out[c] = '┊'
  return out.join('')
}
