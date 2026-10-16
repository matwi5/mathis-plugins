// Graphiques SVG des surfaces distantes (desktop, VS Code, mobile). La base (échappement,
// barre segmentée, anneau, indicateur) est copiée de git-board (hooks/svg.ts) ; les
// graphiques de statistiques suivent.
//
// - Les dessins sont des images (jamais `isInteractive`, qui dessine dans un cadre à fond
//   blanc rechargé à chaque redessin).
// - Rien qui change chaque seconde dans un SVG : un SVG identique n'est pas rechargé.
// - Couleurs mi-tons et gris neutre, opacités plutôt que teintes claires ou foncées :
//   lisibles sur fond clair comme sombre.
// - Chaque SVG reste sous 131 072 caractères et compte dans les 100 000 du panneau : valeurs
//   arrondies au dixième, pas d'attribut inutile.

const FONT = `font-family="'Segoe UI', system-ui, -apple-system, sans-serif"`
const MUTED = '#8B8B93'
const WHITE = '#FFFFFF'

export const esc = (text: string): string =>
  text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c)

const svg = (width: number, height: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`

const r1 = (n: number): number => Math.round(n * 10) / 10

export type Drawn = { source: string; width: number; height: number }

/** Un plafond rond pour un axe : 1, 2, 2,5 ou 5 fois une puissance de dix. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= value) return m * pow
  return 10 * pow
}

// ─── Base copiée de git-board ───────────────────────────────────────────────

export type BarPart = { value: number; color: string }

/** Barre segmentée arrondie. */
export const barSvg = (parts: readonly BarPart[], total: number, width: number, height = 9): Drawn => {
  const w = Math.max(40, Math.round(width))
  const sum = Math.max(total, parts.reduce((n, p) => n + p.value, 0), 1e-9)
  let x = 0
  const segs: string[] = []
  for (const part of parts) {
    if (part.value <= 0) continue
    const sw = (part.value / sum) * w
    segs.push(`<rect x="${r1(x)}" width="${r1(Math.max(1, sw))}" height="${height}" fill="${part.color}"/>`)
    x += sw
  }
  const body =
    `<defs><clipPath id="b"><rect width="${w}" height="${height}" rx="${height / 2}"/></clipPath></defs>` +
    `<g clip-path="url(#b)"><rect width="${w}" height="${height}" fill="${MUTED}" fill-opacity="0.2"/>${segs.join('')}</g>`
  return { source: svg(w, height, body), width: w, height }
}

/** Anneau de progression, le pourcentage au centre. */
export const ringSvg = (ratio: number, color: string, size = 56, label?: string): Drawn => {
  const r = size / 2 - 6
  const c = 2 * Math.PI * r
  const value = Math.min(1, Math.max(0, ratio))
  const mid = size / 2
  const body =
    `<circle cx="${mid}" cy="${mid}" r="${r1(r)}" fill="none" stroke="${MUTED}" stroke-opacity="0.22" stroke-width="6"/>` +
    (value > 0
      ? `<circle cx="${mid}" cy="${mid}" r="${r1(r)}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${r1(c * value)} ${r1(c)}" transform="rotate(-90 ${mid} ${mid})"/>`
      : '') +
    `<text x="${mid}" y="${mid + 4.5}" text-anchor="middle" ${FONT} font-size="13" font-weight="700" fill="${color}">${esc(label ?? `${Math.round(value * 100)}%`)}</text>`
  return { source: svg(size, size, body), width: size, height: size }
}

/** Un arc qui tourne : un relevé en cours. */
export const spinnerSvg = (color: string, size = 12): Drawn => {
  const m = size / 2
  const r = m - 2
  const body =
    `<circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.22" stroke-width="2"/>` +
    `<circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${r1(r * 2)} ${r1(r * 5)}"><animateTransform attributeName="transform" type="rotate" from="0 ${m} ${m}" to="360 ${m} ${m}" dur="0.9s" repeatCount="indefinite"/></circle>`
  return { source: svg(size, size, body), width: size, height: size }
}

// ─── Courbes ────────────────────────────────────────────────────────────────

/** Les points d'une courbe dans un cadre ; une valeur seule devient un plateau. */
const points = (values: readonly number[], x0: number, x1: number, y0: number, y1: number): [number, number][] => {
  const max = Math.max(...values, 1e-9)
  const n = values.length
  return values.map((v, i) => [r1(n > 1 ? x0 + (i * (x1 - x0)) / (n - 1) : (x0 + x1) / 2), r1(y1 - (v / max) * (y1 - y0))])
}

const area = (pts: readonly [number, number][], base: number, color: string, id: string): string => {
  if (pts.length === 0) return ''
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  return (
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.38"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${line}L${last[0]} ${base}L${first[0]} ${base}Z" fill="url(#${id})"/>` +
    `<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${last[0]}" cy="${last[1]}" r="3.2" fill="${color}"/>`
  )
}

/** Courbe compacte d'une tuile. */
export const sparkSvg = (values: readonly number[], color: string, width: number, height = 26): Drawn => {
  const w = Math.max(40, Math.round(width))
  const body = values.length > 1 ? area(points(values, 3, w - 4, 4, height - 2), height, color, 's') : ''
  return { source: svg(w, height, body), width: w, height }
}

/**
 * La carte de tête : un libellé, un grand chiffre, sa variation et une ligne de détail à
 * gauche ; la courbe de la période à droite, quand la place le permet.
 */
export function heroSvg(o: { label: string; value: string; sub: string; delta: string | null; deltaColor: string; values: readonly number[]; color: string; width: number }): Drawn {
  const w = Math.max(220, Math.round(o.width))
  const h = 86
  const valueW = o.value.length * 17.5
  const hasCurve = w >= 380 && o.values.length > 1
  const text =
    `<text x="2" y="16" ${FONT} font-size="10.5" font-weight="700" letter-spacing="0.8" fill="${MUTED}">${esc(o.label.toUpperCase())}</text>` +
    `<text x="0" y="52" ${FONT} font-size="32" font-weight="700" fill="${o.color}">${esc(o.value)}</text>` +
    (o.delta ? `<text x="${r1(valueW + 10)}" y="50" ${FONT} font-size="12.5" font-weight="700" fill="${o.deltaColor}">${esc(o.delta)}</text>` : '') +
    `<text x="2" y="76" ${FONT} font-size="11.5" fill="${MUTED}">${esc(o.sub)}</text>`
  const curve = hasCurve ? area(points(o.values, w * 0.55, w - 6, 10, 70), 78, o.color, 'h') : ''
  return { source: svg(w, h, curve + text), width: w, height: h }
}

// ─── Calendrier d'activité ──────────────────────────────────────────────────

export type HeatCell = { date: string; level: number; isToday: boolean } | null

/**
 * Le calendrier : une colonne par semaine (lundi en haut), une case par jour, cinq
 * niveaux d'intensité. `weeks[i][d]` est null hors de la période.
 */
export function heatmapSvg(weeks: readonly HeatCell[][], months: readonly { index: number; label: string }[], color: string, width: number): Drawn {
  const n = Math.max(1, weeks.length)
  const left = 22
  const top = 16
  const step = Math.max(7, Math.min(16, Math.floor((Math.max(160, width) - left - 4) / n)))
  const size = step - 3
  const w = left + n * step + 2
  const h = top + 7 * step + 22
  const OPACITY = [0.14, 0.32, 0.52, 0.76, 1]
  const cells: string[] = []
  weeks.forEach((week, i) => {
    week.forEach((cell, d) => {
      if (!cell) return
      const x = left + i * step
      const y = top + d * step
      const fill = cell.level === 0 ? MUTED : color
      cells.push(
        `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2.5" fill="${fill}" fill-opacity="${OPACITY[cell.level] ?? 1}"${cell.isToday ? ` stroke="${color}" stroke-width="1.6"` : ''}/>`,
      )
    })
  })
  const labels = months
    .filter((m, i, all) => i === 0 || m.index - all[i - 1]!.index >= 3)
    .map((m) => `<text x="${left + m.index * step}" y="11" ${FONT} font-size="10" fill="${MUTED}">${esc(m.label)}</text>`)
  const days = ['L', '', 'M', '', 'V', '', '']
    .map((d, i) => (d ? `<text x="2" y="${top + i * step + size - 1}" ${FONT} font-size="9.5" fill="${MUTED}">${d}</text>` : ''))
    .join('')
  const ly = top + 7 * step + 8
  const lx = w - 5 * (size + 3) - 44
  const legend =
    `<text x="${lx - 4}" y="${ly + size - 1}" text-anchor="end" ${FONT} font-size="9.5" fill="${MUTED}">Moins</text>` +
    OPACITY.map((o, i) => `<rect x="${lx + i * (size + 3)}" y="${ly}" width="${size}" height="${size}" rx="2.5" fill="${i === 0 ? MUTED : color}" fill-opacity="${o}"/>`).join('') +
    `<text x="${lx + 5 * (size + 3) + 2}" y="${ly + size - 1}" ${FONT} font-size="9.5" fill="${MUTED}">Plus</text>`
  return { source: svg(w, h, labels.join('') + days + cells.join('') + legend), width: w, height: h }
}

// ─── Barres empilées ────────────────────────────────────────────────────────

export type StackBucket = { label: string; parts: readonly BarPart[] }

/**
 * Barres empilées (une couleur par modèle) avec un axe gradué et, en option, la courbe du
 * cumul sur sa propre échelle, sa valeur finale au bout.
 */
export function stackSvg(o: {
  buckets: readonly StackBucket[]
  width: number
  height?: number
  fmt: (v: number) => string
  cumulative?: { values: readonly number[]; color: string; label: string } | null
  /** Plafond imposé de l'axe (1 pour des parts) ; absent, un plafond rond au-dessus du maximum. */
  max?: number
}): Drawn {
  const w = Math.max(240, Math.round(o.width))
  const h = o.height ?? 168
  const left = 44
  const right = o.cumulative ? 58 : 8
  const top = 10
  const bottom = 18
  const pw = w - left - right
  const ph = h - top - bottom
  const n = Math.max(1, o.buckets.length)
  const totals = o.buckets.map((b) => b.parts.reduce((s, p) => s + Math.max(0, p.value), 0))
  const max = o.max ?? niceMax(Math.max(...totals, 0))
  const slot = pw / n
  const bw = Math.max(1, Math.min(22, slot * 0.72))
  const parts: string[] = []
  // Graduations : 0, la moitié et le plafond.
  for (const f of [0, 0.5, 1]) {
    const y = r1(top + ph - f * ph)
    parts.push(`<line x1="${left}" y1="${y}" x2="${left + pw}" y2="${y}" stroke="${MUTED}" stroke-opacity="${f === 0 ? 0.45 : 0.22}" stroke-dasharray="${f === 0 ? '' : '3 4'}"/>`)
    parts.push(`<text x="${left - 6}" y="${r1(y + 3.5)}" text-anchor="end" ${FONT} font-size="10" fill="${MUTED}">${esc(o.fmt(max * f))}</text>`)
  }
  o.buckets.forEach((b, i) => {
    let y = top + ph
    const x = r1(left + i * slot + (slot - bw) / 2)
    for (const p of b.parts) {
      if (p.value <= 0) continue
      const bh = Math.min(y - top, (p.value / max) * ph)
      y -= bh
      parts.push(`<rect x="${x}" y="${r1(y)}" width="${r1(bw)}" height="${r1(Math.max(0.6, bh))}" fill="${p.color}"/>`)
    }
  })
  // Libellés de l'axe des x : six au plus, le premier et le dernier compris.
  const every = Math.max(1, Math.ceil(n / 6))
  o.buckets.forEach((b, i) => {
    if (i % every !== 0 && i !== n - 1) return
    if (i !== n - 1 && n - 1 - i < every / 2) return
    const x = r1(left + i * slot + slot / 2)
    const anchor = i === 0 && slot < 30 ? 'start' : i === n - 1 && slot < 30 ? 'end' : 'middle'
    parts.push(`<text x="${anchor === 'start' ? left : anchor === 'end' ? left + pw : x}" y="${h - 4}" text-anchor="${anchor}" ${FONT} font-size="10" fill="${MUTED}">${esc(b.label)}</text>`)
  })
  if (o.cumulative && o.cumulative.values.length > 1) {
    const vals = o.cumulative.values
    const cmax = Math.max(...vals, 1e-9)
    const pts = vals.map((v, i) => [r1(left + i * slot + slot / 2), r1(top + ph - (v / cmax) * ph)] as const)
    const last = pts[pts.length - 1]!
    parts.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${o.cumulative.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`)
    parts.push(`<circle cx="${last[0]}" cy="${last[1]}" r="3.4" fill="${o.cumulative.color}"/>`)
    parts.push(`<text x="${r1(last[0] + 7)}" y="${r1(Math.max(top + 9, last[1] + 4))}" ${FONT} font-size="10.5" font-weight="700" fill="${o.cumulative.color}">${esc(o.cumulative.label)}</text>`)
  }
  return { source: svg(w, h, parts.join('')), width: w, height: h }
}

// ─── Anneau de répartition ──────────────────────────────────────────────────

/** Un anneau en parts (un modèle par part), un chiffre et un mot au centre. */
export function donutSvg(parts: readonly BarPart[], size: number, center: string, sub: string, color: string): Drawn {
  const s = Math.max(90, Math.round(size))
  const mid = s / 2
  const r = mid - 10
  const c = 2 * Math.PI * r
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0)
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 1.6 : 0
  let at = 0
  const arcs: string[] = [`<circle cx="${mid}" cy="${mid}" r="${r1(r)}" fill="none" stroke="${MUTED}" stroke-opacity="0.18" stroke-width="13"/>`]
  if (total > 0) {
    for (const p of parts) {
      if (p.value <= 0) continue
      const len = (p.value / total) * c
      const shown = Math.max(0.8, len - gap)
      arcs.push(
        `<circle cx="${mid}" cy="${mid}" r="${r1(r)}" fill="none" stroke="${p.color}" stroke-width="13" stroke-dasharray="${r1(shown)} ${r1(c)}" stroke-dashoffset="${r1(-at)}" transform="rotate(-90 ${mid} ${mid})"/>`,
      )
      at += len
    }
  }
  const body =
    arcs.join('') +
    `<text x="${mid}" y="${mid + 2}" text-anchor="middle" ${FONT} font-size="${center.length > 7 ? 14 : 17}" font-weight="700" fill="${color}">${esc(center)}</text>` +
    `<text x="${mid}" y="${mid + 17}" text-anchor="middle" ${FONT} font-size="10" fill="${MUTED}">${esc(sub)}</text>`
  return { source: svg(s, s, body), width: s, height: s }
}

// ─── Colonnes ───────────────────────────────────────────────────────────────

/**
 * Des colonnes simples (heures, jours de la semaine, blocs de 5 h) : la plus haute porte sa
 * valeur et sa couleur pleine, les autres sont adoucies ; `labels` vides sautés.
 */
export function columnsSvg(o: { values: readonly number[]; labels: readonly string[]; color: string; width: number; height?: number; fmt: (v: number) => string; highlight?: number }): Drawn {
  const w = Math.max(160, Math.round(o.width))
  const h = o.height ?? 112
  const top = 16
  const bottom = 16
  const ph = h - top - bottom
  const n = Math.max(1, o.values.length)
  const slot = (w - 4) / n
  const bw = Math.max(2, Math.min(34, slot * 0.66))
  const max = Math.max(...o.values, 1e-9)
  const peak = o.highlight ?? o.values.indexOf(Math.max(...o.values))
  const parts: string[] = [`<line x1="2" y1="${top + ph + 0.5}" x2="${w - 2}" y2="${top + ph + 0.5}" stroke="${MUTED}" stroke-opacity="0.4"/>`]
  o.values.forEach((v, i) => {
    const bh = v > 0 ? Math.max(2, (v / max) * ph) : 0
    const x = r1(2 + i * slot + (slot - bw) / 2)
    const isPeak = i === peak && v > 0
    if (bh > 0) parts.push(`<rect x="${x}" y="${r1(top + ph - bh)}" width="${r1(bw)}" height="${r1(bh)}" rx="${r1(Math.min(3, bw / 3))}" fill="${o.color}" fill-opacity="${isPeak ? 1 : 0.5}"/>`)
    if (isPeak) parts.push(`<text x="${r1(x + bw / 2)}" y="${r1(top + ph - bh - 4)}" text-anchor="middle" ${FONT} font-size="10" font-weight="700" fill="${o.color}">${esc(o.fmt(v))}</text>`)
    const label = o.labels[i]
    if (label) parts.push(`<text x="${r1(x + bw / 2)}" y="${h - 3}" text-anchor="middle" ${FONT} font-size="10" fill="${isPeak ? o.color : MUTED}"${isPeak ? ' font-weight="700"' : ''}>${esc(label)}</text>`)
  })
  return { source: svg(w, h, parts.join('')), width: w, height: h }
}

// ─── Bloc de 5 h ────────────────────────────────────────────────────────────

/**
 * Le bloc de facturation en cours : la piste de 5 h, la part écoulée pleine, la fin projetée
 * en pointillé, l'heure de début, de fin et « maintenant ».
 */
export function blockSvg(o: { elapsed: number; startLabel: string; endLabel: string; nowLabel: string; color: string; width: number }): Drawn {
  const w = Math.max(200, Math.round(o.width))
  const h = 38
  const x0 = 4
  const x1 = w - 4
  const ratio = Math.min(1, Math.max(0, o.elapsed))
  const xn = r1(x0 + ratio * (x1 - x0))
  const body =
    `<rect x="${x0}" y="6" width="${x1 - x0}" height="9" rx="4.5" fill="${MUTED}" fill-opacity="0.2"/>` +
    `<rect x="${x0}" y="6" width="${r1(Math.max(4.5, xn - x0))}" height="9" rx="4.5" fill="${o.color}"/>` +
    `<line x1="${xn}" y1="2" x2="${xn}" y2="19" stroke="${o.color}" stroke-width="2" stroke-linecap="round"/>` +
    `<text x="${x0}" y="33" ${FONT} font-size="10" fill="${MUTED}">${esc(o.startLabel)}</text>` +
    `<text x="${x1}" y="33" text-anchor="end" ${FONT} font-size="10" fill="${MUTED}">${esc(o.endLabel)}</text>` +
    (ratio > 0.12 && ratio < 0.88 ? `<text x="${xn}" y="33" text-anchor="middle" ${FONT} font-size="10" font-weight="700" fill="${o.color}">${esc(o.nowLabel)}</text>` : '')
  return { source: svg(w, h, body), width: w, height: h }
}

// ─── Rythme horaire : flamme et jauge ───────────────────────────────────────

/** Les teintes de chaque niveau, du bout de la flamme à sa base. */
const FIRE: readonly { tip: string; base: string; scale: number }[] = [
  { tip: MUTED, base: MUTED, scale: 0.62 },
  { tip: '#F7D774', base: '#D9A520', scale: 0.72 },
  { tip: '#FFC46B', base: '#E8913A', scale: 0.84 },
  { tip: '#FFB07A', base: '#EF5B3C', scale: 0.94 },
  { tip: '#FFE27A', base: '#E5383B', scale: 1 },
]

// Une flamme dans une boîte de 24 × 30 : le corps, puis son cœur clair.
const FLAME = 'M12 1C13.6 6 19.5 9.4 19.5 17.5A7.5 7.5 0 0 1 4.5 17.5C4.5 12.8 7.6 10.6 8.8 7C9.9 9.6 10.9 10.3 11.5 11.2C12.6 8.1 12.6 4.6 12 1Z'
const CORE = 'M12 13.2C13.1 15.7 15.6 16.8 15.6 19.8A3.6 3.6 0 0 1 8.4 19.8C8.4 17.8 9.9 16.7 10.4 15.2C10.9 16.2 11.4 16.5 11.8 16.8C12.2 15.6 12.3 14.4 12 13.2Z'

const flameAt = (x: number, scale: number, level: number, id: string): string => {
  const f = FIRE[level] ?? FIRE[0]!
  const t = `translate(${r1(x + 12 * (1 - scale))} ${r1(30 * (1 - scale))}) scale(${scale})`
  if (level === 0) return `<path d="${FLAME}" transform="${t}" fill="none" stroke="${MUTED}" stroke-opacity="0.7" stroke-width="1.8" stroke-linejoin="round"/>`
  return (
    `<path d="${FLAME}" transform="${t}" fill="url(#${id})"/>` +
    (level >= 2 ? `<path d="${CORE}" transform="${t}" fill="#FFF3C4" fill-opacity="${level >= 3 ? 0.9 : 0.65}"/>` : '')
  )
}

/**
 * La flamme du rythme horaire : éteinte (contour gris) au calme, puis plus haute et plus rouge à
 * chaque niveau ; « en feu », un halo et deux flammèches de part et d'autre.
 */
export function flameSvg(level: number, height = 16): Drawn {
  const lv = Math.max(0, Math.min(4, Math.round(level)))
  const f = FIRE[lv]!
  const isWide = lv === 4
  const vw = isWide ? 40 : 24
  const grad = `<defs><linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${f.tip}"/><stop offset="1" stop-color="${f.base}"/></linearGradient></defs>`
  const body = isWide
    ? `<path d="${FLAME}" transform="translate(5 -2.2) scale(1.25)" fill="${f.base}" fill-opacity="0.22"/>` + flameAt(-1, 0.6, 3, 'fl') + flameAt(17, 0.6, 3, 'fl') + flameAt(8, 1, 4, 'fl')
    : flameAt(0, f.scale, lv, 'fl')
  const w = Math.round((height * vw) / 30)
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 ${vw} 30">${grad}${body}</svg>`, width: w, height }
}

/**
 * La jauge du rythme : cinq zones de même largeur (calme → en feu) en dégradé, les seuils
 * marqués, une flèche et la valeur au rythme courant.
 */
export function heatGaugeSvg(o: { perHour: number; thresholds: readonly number[]; colors: readonly string[]; width: number }): Drawn {
  const w = Math.max(200, Math.round(o.width))
  const h = 40
  const x0 = 4
  const x1 = w - 4
  const zone = (x1 - x0) / 5
  const edges = [0, ...o.thresholds, (o.thresholds[o.thresholds.length - 1] ?? 32) * 2]
  // Position par zones : chaque niveau a la même place, quelle que soit sa plage en $/h.
  let at = x1
  for (let i = 0; i < 5; i++) {
    const lo = edges[i]!
    const hi = edges[i + 1]!
    if (o.perHour < hi) {
      at = x0 + zone * (i + Math.max(0, o.perHour - lo) / Math.max(1e-9, hi - lo))
      break
    }
  }
  const stops = o.colors.map((c, i) => `<stop offset="${r1((i + 0.5) / o.colors.length)}" stop-color="${c}"/>`).join('')
  const ticks = o.thresholds
    .map((t, i) => {
      const x = r1(x0 + zone * (i + 1))
      return `<line x1="${x}" y1="14" x2="${x}" y2="24" stroke="${MUTED}" stroke-opacity="0.6"/><text x="${x}" y="36" text-anchor="middle" ${FONT} font-size="9.5" fill="${MUTED}">${t}</text>`
    })
    .join('')
  const ax = r1(at)
  const body =
    // Le dégradé sur toute la piste : une jauge peu remplie reste verte au lieu de résumer toutes les couleurs.
    `<defs><linearGradient id="hg" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0">${stops}</linearGradient><clipPath id="hc"><rect x="${x0}" y="15" width="${x1 - x0}" height="8" rx="4"/></clipPath></defs>` +
    `<rect x="${x0}" y="15" width="${x1 - x0}" height="8" rx="4" fill="url(#hg)" fill-opacity="0.28"/>` +
    `<rect x="${x0}" y="15" width="${r1(Math.max(4, ax - x0))}" height="8" fill="url(#hg)" clip-path="url(#hc)"/>` +
    ticks +
    `<path d="M${ax} 13 l-4.5 -6 h9 z" fill="${o.colors[Math.min(o.colors.length - 1, Math.floor((at - x0) / zone))] ?? MUTED}"/>`
  return { source: svg(w, h, body), width: w, height: h }
}

/** Point d'état plein. */
export const dotSvg = (color: string, size = 10): Drawn => {
  const m = size / 2
  return { source: svg(size, size, `<circle cx="${m}" cy="${m}" r="${m - 1}" fill="${color}"/><circle cx="${m}" cy="${m}" r="${r1(m / 3)}" fill="${WHITE}" fill-opacity="0.35"/>`), width: size, height: size }
}
