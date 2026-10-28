// Graphiques du terminal en grille de cases (`Raster`) : une case = un caractère, une couleur
// de texte et une couleur de fond, empaquetés selon `RasterProps` (triplets u32 little-endian
// `[point de code, avant-plan, fond]`, rangée par rangée, en base64 standard). Une seule
// feuille par graphique, au lieu d'un Text par série de cases. Fonctions pures : la vue
// (view.tsx) les pose dans l'arbre, seulement quand la table de la surface a `Raster`.

import { C, maxOf } from './model.ts'
import type { BarPart, HeatCell } from './svg.ts'

/** La couleur par défaut du terminal (bit 24 seul). */
export const DEFAULT = 0x01000000
/** Les niveaux du calendrier, comme les opacités du SVG (heatmapSvg). */
export const HEAT_OPACITY = [0.14, 0.32, 0.52, 0.76, 1] as const

const SPACE = 0x20
const FULL = 0x2588
/** ▁ à █ : U+2581 à U+2588. */
const eighth = (fill: number): number => 0x2580 + Math.max(1, Math.min(8, fill))

export type RasterCells = { columns: number; rows: number; cells: string }
type Cell = readonly [codePoint: number, foreground: number, background: number]

/** `#RRGGBB` en `0x00RRGGBB`. */
export const rgb = (hex: string): number => {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  return Number.isFinite(n) ? n & 0xffffff : DEFAULT
}

/**
 * `color` posé à l'opacité `alpha` sur un fond foncé (C.ink). Le terminal n'a pas de
 * transparence : les niveaux du SVG deviennent des teintes pleines.
 */
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

/**
 * Le calendrier : 7 rangées (lundi en haut), une semaine sur `cell` colonnes (la dernière vide
 * quand `cell` > 1, comme les glyphes), chaque jour une case pleine à la teinte de son niveau
 * (niveau 0 en gris). Les jours hors période restent vides.
 */
export const heatCells = (weeks: readonly HeatCell[][], color: string, cell: number): RasterCells => {
  const shades = HEAT_OPACITY.map((o, i) => (i === 0 ? tint(C.gray, 0.45) : tint(color, o)))
  const grid: Cell[][] = []
  for (let d = 0; d < 7; d++) {
    const row: Cell[] = []
    for (const week of weeks) {
      const day = week[d]
      for (let j = 0; j < cell; j++) row.push(day && (j < cell - 1 || cell === 1) ? [FULL, shades[day.level] ?? shades[4]!, DEFAULT] : [SPACE, DEFAULT, DEFAULT])
    }
    grid.push(row)
  }
  return pack(grid)
}

/** La légende du calendrier : les cinq teintes, une case chacune. */
export const heatLegendCells = (color: string): RasterCells =>
  pack([HEAT_OPACITY.map((o, i) => [FULL, i === 0 ? tint(C.gray, 0.45) : tint(color, o), DEFAULT] as Cell)])

/**
 * Colonnes sur `height` rangées, en huitièmes de case ; `cell` cases par colonne (la dernière
 * vide quand `cell` > 1). Avec `stacks` (les parts de chaque colonne, du bas vers le haut),
 * une case pleine coupée par deux parts prend la part du bas en avant-plan et celle du haut en
 * fond : la frontière entre modèles tombe au huitième près.
 */
export const columnsCells = (
  values: readonly number[],
  height: number,
  color: string,
  cell = 1,
  highlight = -1,
  stacks: readonly (readonly BarPart[])[] | null = null,
): RasterCells => {
  const max = maxOf(values, 1e-9)
  const tall = values.map((v) => (v > 0 ? Math.max(1, Math.round((v / max) * height * 8)) : 0))
  // La couleur du huitième `at8` (compté depuis le bas) de la colonne `i`.
  const colorAt = (i: number, at8: number): string => {
    const parts = stacks?.[i]
    const all = values[i] ?? 0
    if (!parts || all <= 0) return i === highlight ? C.coral : color
    let top = 0
    for (const p of parts) {
      top += (Math.max(0, p.value) / all) * (tall[i] ?? 0)
      if (at8 < top) return p.color
    }
    return parts[parts.length - 1]?.color ?? color
  }
  const grid: Cell[][] = []
  for (let r = height - 1; r >= 0; r--) {
    const row: Cell[] = []
    tall.forEach((h8, i) => {
      const fill = Math.max(0, Math.min(8, h8 - r * 8))
      let glyph: Cell = [SPACE, DEFAULT, DEFAULT]
      if (fill === 8) {
        // Case pleine : une frontière entre deux parts devient un huitième bicolore.
        const low = colorAt(i, r * 8 + 0.5)
        let cut = 0
        for (let j = 1; j < 8 && !cut; j++) if (colorAt(i, r * 8 + j + 0.5) !== low) cut = j
        glyph = cut ? [eighth(cut), rgb(low), rgb(colorAt(i, r * 8 + cut + 0.5))] : [FULL, rgb(low), DEFAULT]
      } else if (fill > 0) {
        glyph = [eighth(fill), rgb(colorAt(i, r * 8 + fill / 2)), DEFAULT]
      }
      for (let j = 0; j < cell; j++) row.push(j < cell - 1 || cell === 1 ? glyph : [SPACE, DEFAULT, DEFAULT])
    })
    grid.push(row)
  }
  return pack(grid)
}
