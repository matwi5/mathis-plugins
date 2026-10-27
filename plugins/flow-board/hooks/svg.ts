// Dessins SVG des surfaces distantes (desktop, VS Code, mobile) : feuille de route,
// anneau de progression, barre segmentée, points de tests, indicateurs vivants.
//
// - Les animations sont en SMIL (`isInteractive` sur l'élément Svg) : elles tournent
//   sans redessin. Le texte qui change chaque seconde (durées) reste hors des SVG, pour
//   qu'un SVG identique ne soit pas rechargé à chaque tic.
// - Couleurs mi-tons et gris neutre : lisibles sur fond clair comme sombre.

const FONT = `font-family="'Segoe UI', system-ui, -apple-system, sans-serif"`
const MUTED = '#8B8B93'
const WHITE = '#FFFFFF'

export const esc = (text: string): string =>
  text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c)

const cut = (text: string, max: number): string =>
  max <= 1 ? '' : text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`

const svg = (width: number, height: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`

/** Coupe un libellé en deux lignes au plus, aux espaces ; la seconde se termine par « … » s'il en reste. */
const wrap2 = (text: string, max: number): string[] => {
  if (text.length <= max) return [text]
  const words = text.split(/\s+/)
  let first = ''
  let i = 0
  while (i < words.length) {
    const next = first ? `${first} ${words[i]}` : words[i]!
    if (next.length > max && first) break
    first = next
    i += 1
  }
  const rest = words.slice(i).join(' ')
  return rest ? [cut(first, max), cut(rest, max)] : [cut(first, max)]
}

/** Largeur moyenne d'un caractère à 11,5 px (Segoe UI, system-ui). */
const CHAR_PX = 6.2

const r1 = (n: number): number => Math.round(n * 10) / 10

export type NodeState = 'done' | 'active' | 'next' | 'pending' | 'skipped'

export type RoadNode = {
  label: string
  sub?: string
  color: string
  state: NodeState
  isOptional?: boolean
  detours?: { label: string; color: string; isActive: boolean }[]
}

export type Drawn = { source: string; width: number; height: number }

const check = (x: number, y: number, size: number, color: string): string =>
  `<path d="M${r1(x - size * 0.45)} ${r1(y + size * 0.02)} l${r1(size * 0.32)} ${r1(size * 0.32)} l${r1(size * 0.6)} ${r1(-size * 0.62)}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`

/**
 * La feuille de route : une station par phase (ou par étape pour un parcours d'une
 * phase), reliées par une ligne. Station faite pleine et cochée, station en cours
 * pulsante, segment en cours animé vers la suite, suites facultatives en pointillé,
 * détours en bulles au-dessus de leur station.
 */
export const roadmapSvg = (nodes: readonly RoadNode[], width: number): Drawn => {
  const n = nodes.length
  const w = Math.max(200, Math.round(width))
  const hasDetours = nodes.some(x => (x.detours?.length ?? 0) > 0)
  const top = hasDetours ? 34 : 8
  const cy = top + 14
  const pad = n > 1 ? Math.max(34, Math.min(64, w / (n * 2))) : w / 2
  const xs = nodes.map((_, i) => (n > 1 ? pad + (i * (w - 2 * pad)) / (n - 1) : w / 2))
  const slot = n > 1 ? (w - 2 * pad) / (n - 1) : w
  const charsAt = (i: number): number => {
    const isEdge = n > 1 && (i === 0 || i === n - 1)
    const room = n > 1 ? (isEdge ? Math.min(slot, pad + slot / 2) : slot) : Math.min(w, 260)
    return Math.max(3, Math.floor((room - 6) / CHAR_PX))
  }
  const labels = nodes.map((node, i) => wrap2(node.label, charsAt(i)))
  const isTall = labels.some(l => l.length > 1)
  const subY = cy + (isTall ? 58 : 45)
  const height = cy + (isTall ? 64 : 50)
  const defs: string[] = []
  const lines: string[] = []
  const marks: string[] = []
  const texts: string[] = []
  const bubbles: string[] = []

  for (let i = 0; i < n - 1; i++) {
    const a = nodes[i]!
    const b = nodes[i + 1]!
    const x1 = r1(xs[i]! + 15)
    const x2 = r1(xs[i + 1]! - 15)
    if (x2 <= x1) continue
    const isDone = (a.state === 'done' || a.state === 'skipped') && (b.state === 'done' || b.state === 'active' || b.state === 'skipped')
    if (isDone) {
      defs.push(
        `<linearGradient id="g${i}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="0" x2="${x2}" y2="0"><stop offset="0" stop-color="${a.color}"/><stop offset="1" stop-color="${b.color}"/></linearGradient>`,
      )
      lines.push(`<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" stroke="url(#g${i})" stroke-width="3" stroke-linecap="round"/>`)
    } else if (a.state === 'active' || (a.state === 'done' && b.state === 'next')) {
      lines.push(
        `<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" stroke="${a.color}" stroke-opacity="0.8" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="6 7"><animate attributeName="stroke-dashoffset" from="13" to="0" dur="0.9s" repeatCount="indefinite"/></line>`,
      )
    } else {
      lines.push(
        `<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" stroke="${MUTED}" stroke-opacity="0.5" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 6"/>`,
      )
    }
  }

  nodes.forEach((node, i) => {
    const x = r1(xs[i]!)
    const c = node.color
    switch (node.state) {
      case 'done':
        marks.push(`<circle cx="${x}" cy="${cy}" r="11" fill="${c}"/>${check(x, cy, 10, WHITE)}`)
        break
      case 'active':
        marks.push(
          `<circle cx="${x}" cy="${cy}" r="12" fill="${c}" opacity="0.4"><animate attributeName="r" values="12;21" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.45;0" dur="1.8s" repeatCount="indefinite"/></circle>` +
            `<circle cx="${x}" cy="${cy}" r="12" fill="${c}"/><circle cx="${x}" cy="${cy}" r="4.5" fill="${WHITE}"/>`,
        )
        break
      case 'next':
        marks.push(
          `<circle cx="${x}" cy="${cy}" r="10.5" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="2.4"><animate attributeName="stroke-opacity" values="1;0.35;1" dur="2.2s" repeatCount="indefinite"/></circle>` +
            `<path d="M${r1(x - 3)} ${r1(cy - 4.5)} l7 4.5 l-7 4.5 z" fill="${c}"/>`,
        )
        break
      case 'skipped':
        marks.push(
          `<circle cx="${x}" cy="${cy}" r="8" fill="none" stroke="${MUTED}" stroke-opacity="0.65" stroke-width="1.6" stroke-dasharray="2 3"/>` +
            `<line x1="${x - 4}" y1="${cy + 4}" x2="${x + 4}" y2="${cy - 4}" stroke="${MUTED}" stroke-opacity="0.65" stroke-width="1.6" stroke-linecap="round"/>`,
        )
        break
      default:
        marks.push(
          `<circle cx="${x}" cy="${cy}" r="9.5" fill="${c}" fill-opacity="0.08" stroke="${c}" stroke-opacity="${node.isOptional ? 0.5 : 0.7}" stroke-width="1.8"${node.isOptional ? ' stroke-dasharray="3 3"' : ''}/>` +
            `<text x="${x}" y="${r1(cy + 3.5)}" text-anchor="middle" ${FONT} font-size="10" font-weight="700" fill="${c}" fill-opacity="0.85">${i + 1}</text>`,
        )
    }

    // Libellés : centrés, sauf aux bords où ils s'alignent sur la station pour rester entiers.
    const isEdgeLeft = n > 1 && i === 0
    const isEdgeRight = n > 1 && i === n - 1
    const chars = charsAt(i)
    const anchor = isEdgeLeft && pad < 46 ? 'start' : isEdgeRight && pad < 46 ? 'end' : 'middle'
    const tx = anchor === 'start' ? r1(x - 12) : anchor === 'end' ? r1(x + 12) : x
    const isLit = node.state === 'active' || node.state === 'done' || node.state === 'next'
    const weight = node.state === 'active' ? 700 : isLit ? 600 : 500
    const lines = labels[i]!
    texts.push(
      `<text x="${tx}" y="${cy + 30}" text-anchor="${anchor}" ${FONT} font-size="11.5" font-weight="${weight}" fill="${isLit ? c : MUTED}"${node.state === 'skipped' ? ' fill-opacity="0.7"' : ''}>` +
        lines.map((l, j) => `<tspan x="${tx}" dy="${j === 0 ? 0 : 13}">${esc(l)}</tspan>`).join('') +
        '</text>',
    )
    if (node.sub) {
      texts.push(
        `<text x="${tx}" y="${subY}" text-anchor="${anchor}" ${FONT} font-size="10" font-weight="${node.state === 'active' ? 600 : 400}" fill="${node.state === 'active' ? c : MUTED}">${esc(cut(node.sub, chars + 2))}</text>`,
      )
    }

    // Détours : la dernière bulle au-dessus de la station, avec le nombre des autres.
    const detours = node.detours ?? []
    if (detours.length > 0) {
      const last = detours[detours.length - 1]!
      const label = `↳ ${last.label}${detours.length > 1 ? ` +${detours.length - 1}` : ''}`
      const shown = cut(label, Math.max(6, Math.floor((slot - 10) / 6)))
      const bw = Math.round(shown.length * 6.1 + 16)
      const bx = Math.min(Math.max(2, x - bw / 2), w - bw - 2)
      const by = 3
      bubbles.push(
        `<line x1="${x}" y1="${by + 18}" x2="${x}" y2="${cy - 13}" stroke="${last.color}" stroke-opacity="0.55" stroke-width="1.4" stroke-dasharray="2 2"/>` +
          `<rect x="${r1(bx)}" y="${by}" width="${bw}" height="18" rx="9" fill="${last.color}" fill-opacity="0.14" stroke="${last.color}" stroke-opacity="0.75" stroke-width="1.2">${last.isActive ? '<animate attributeName="stroke-opacity" values="0.9;0.3;0.9" dur="1.6s" repeatCount="indefinite"/>' : ''}</rect>` +
          `<text x="${r1(bx + bw / 2)}" y="${by + 12.5}" text-anchor="middle" ${FONT} font-size="10" font-weight="600" fill="${last.color}">${esc(shown)}</text>`,
      )
    }
  })

  const body = `${defs.length > 0 ? `<defs>${defs.join('')}</defs>` : ''}${lines.join('')}${bubbles.join('')}${marks.join('')}${texts.join('')}`
  return { source: svg(w, height, body), width: w, height }
}

/** Anneau de progression, le pourcentage au centre. */
export const ringSvg = (ratio: number, color: string, size = 60): Drawn => {
  const r = size / 2 - 6
  const c = 2 * Math.PI * r
  const value = Math.min(1, Math.max(0, ratio))
  const len = r1(c * value)
  const mid = size / 2
  const body =
    `<circle cx="${mid}" cy="${mid}" r="${r1(r)}" fill="none" stroke="${MUTED}" stroke-opacity="0.22" stroke-width="7"/>` +
    (value > 0
      ? `<circle cx="${mid}" cy="${mid}" r="${r1(r)}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${len} ${r1(c)}" transform="rotate(-90 ${mid} ${mid})"/>`
      : '') +
    `<text x="${mid}" y="${mid + 5}" text-anchor="middle" ${FONT} font-size="14" font-weight="700" fill="${color}">${Math.round(value * 100)}%</text>`
  return { source: svg(size, size, body), width: size, height: size }
}

export type BarPart = { value: number; color: string; isLive?: boolean }

/** Barre segmentée arrondie (fait, en cours, bloqué…), la part vivante qui respire. */
export const barSvg = (parts: readonly BarPart[], total: number, width: number, height = 9): Drawn => {
  const w = Math.max(60, Math.round(width))
  const sum = Math.max(total, parts.reduce((n, p) => n + p.value, 0), 1)
  let x = 0
  const segs: string[] = []
  for (const part of parts) {
    if (part.value <= 0) continue
    const sw = (part.value / sum) * w
    segs.push(
      `<rect x="${r1(x)}" y="0" width="${r1(sw)}" height="${height}" fill="${part.color}">${part.isLive ? '<animate attributeName="opacity" values="1;0.55;1" dur="1.6s" repeatCount="indefinite"/>' : ''}</rect>`,
    )
    x += sw
  }
  const body =
    `<defs><clipPath id="bar"><rect width="${w}" height="${height}" rx="${height / 2}"/></clipPath></defs>` +
    `<g clip-path="url(#bar)"><rect width="${w}" height="${height}" fill="${MUTED}" fill-opacity="0.22"/>${segs.join('')}</g>`
  return { source: svg(w, height, body), width: w, height }
}

/** Les derniers lancements de tests : un point vert ou rouge chacun, le dernier qui pulse. */
export const dotsSvg = (runs: readonly { ok: boolean }[], width: number, green: string, red: string): Drawn => {
  const step = 12
  const max = Math.max(1, Math.floor((Math.max(80, width) - 10) / step))
  const shown = runs.slice(-max)
  const w = Math.max(20, shown.length * step + 8)
  const h = 16
  const dots = shown.map((run, i) => {
    const x = 8 + i * step
    const c = run.ok ? green : red
    const isLast = i === shown.length - 1
    return (
      (isLast
        ? `<circle cx="${x}" cy="8" r="4" fill="${c}" opacity="0.4"><animate attributeName="r" values="4;8" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.45;0" dur="1.8s" repeatCount="indefinite"/></circle>`
        : '') + `<circle cx="${x}" cy="8" r="${isLast ? 4.6 : 3.8}" fill="${c}"/>`
    )
  })
  return { source: svg(w, h, dots.join('')), width: w, height: h }
}

/** Un arc qui tourne : un sous-agent au travail. */
export const spinnerSvg = (color: string, size = 14): Drawn => {
  const m = size / 2
  const r = m - 2
  const body =
    `<circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.22" stroke-width="2"/>` +
    `<circle cx="${m}" cy="${m}" r="${r}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${r1(r * 2)} ${r1(r * 5)}"><animateTransform attributeName="transform" type="rotate" from="0 ${m} ${m}" to="360 ${m} ${m}" dur="0.9s" repeatCount="indefinite"/></circle>`
  return { source: svg(size, size, body), width: size, height: size }
}

/** Point d'état ; pulsant quand quelque chose tourne. */
export const pulseSvg = (color: string, isPulsing: boolean, size = 12): Drawn => {
  const m = size / 2
  const body =
    (isPulsing
      ? `<circle cx="${m}" cy="${m}" r="3" fill="${color}" opacity="0.5"><animate attributeName="r" values="3;${m}" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.55;0" dur="1.4s" repeatCount="indefinite"/></circle>`
      : '') + `<circle cx="${m}" cy="${m}" r="3.4" fill="${color}"/>`
  return { source: svg(size, size, body), width: size, height: size }
}

/** La feuille de route du bandeau : des pastilles, sans libellés. */
export const miniRoadSvg = (nodes: readonly { color: string; state: NodeState; isOptional?: boolean }[]): Drawn => {
  const gap = 17
  const h = 16
  const w = Math.max(16, (nodes.length - 1) * gap + 16)
  const cy = h / 2
  const parts: string[] = []
  nodes.forEach((node, i) => {
    if (i === nodes.length - 1) return
    const next = nodes[i + 1]!
    const x1 = 8 + i * gap + 6
    const x2 = 8 + (i + 1) * gap - 6
    const isDone = node.state === 'done' || node.state === 'skipped'
    parts.push(
      isDone && next.state !== 'pending' && next.state !== 'next'
        ? `<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" stroke="${node.color}" stroke-width="2" stroke-linecap="round"/>`
        : `<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" stroke="${MUTED}" stroke-opacity="0.5" stroke-width="1.6" stroke-dasharray="2 3"/>`,
    )
  })
  nodes.forEach((node, i) => {
    const x = 8 + i * gap
    const c = node.color
    if (node.state === 'done') parts.push(`<circle cx="${x}" cy="${cy}" r="4.6" fill="${c}"/>`)
    else if (node.state === 'active')
      parts.push(
        `<circle cx="${x}" cy="${cy}" r="5" fill="${c}" opacity="0.4"><animate attributeName="r" values="5;8" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0" dur="1.6s" repeatCount="indefinite"/></circle><circle cx="${x}" cy="${cy}" r="5.2" fill="${c}"/><circle cx="${x}" cy="${cy}" r="2" fill="${WHITE}"/>`,
      )
    else if (node.state === 'next') parts.push(`<circle cx="${x}" cy="${cy}" r="4.4" fill="none" stroke="${c}" stroke-width="2"/>`)
    else if (node.state === 'skipped') parts.push(`<circle cx="${x}" cy="${cy}" r="3" fill="${MUTED}" fill-opacity="0.5"/>`)
    else
      parts.push(
        `<circle cx="${x}" cy="${cy}" r="4.2" fill="none" stroke="${c}" stroke-opacity="${node.isOptional ? 0.45 : 0.7}" stroke-width="1.5"${node.isOptional ? ' stroke-dasharray="2 2"' : ''}/>`,
      )
  })
  return { source: svg(w, h, parts.join('')), width: w, height: h }
}

/** Une part de piste à dessiner (voir timeline.ts) : x de 0 à 1. */
export type LaneDrawPart = { x0: number; x1: number; kind: 'think' | 'write' | 'tool' | 'waitAgent' | 'waitPerson' | 'waitBg'; glyph?: string; isLive?: boolean; isError?: boolean }

/** Un repère d'une piste : son glyphe au-dessus, ou un point de relais sur le rail. */
export type LaneDrawMark = { x: number; glyph: string; color: string; isRelay?: boolean; isStart?: boolean }

const WAIT_TINT: Record<'waitAgent' | 'waitPerson' | 'waitBg', string> = { waitAgent: '#8B8B93', waitPerson: '#D9A520', waitBg: '#4A9EE8' }

/**
 * Une piste de la frise : une barre fine et arrondie par segment sur un rail pâle (variante A de
 * la planche `travail/onglet-agents/planches/frise.html`). Réflexion pâle, rédaction pleine, outil
 * mi-teinte avec le glyphe de sa famille quand la place le permet, attentes hachurées en trois
 * teintes ; repères au-dessus, points de relais sur le rail, « ⫽ » sur les pauses compressées.
 * Les parts de moins d'un pixel se fondent dans la précédente de même sorte : un SVG reste petit
 * (131 072 caractères au plus), quel que soit le nombre de segments.
 */
export const laneSvg = (
  parts: readonly LaneDrawPart[],
  marks: readonly LaneDrawMark[],
  pauses: readonly { x0: number; x1: number }[],
  width: number,
  color: string,
  id: string,
): Drawn => {
  const w = Math.max(80, Math.round(width))
  const h = 22
  const y = 10
  const bh = 9
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '')
  const usedWaits = new Set(parts.filter(p => p.kind.startsWith('wait')).map(p => p.kind as keyof typeof WAIT_TINT))
  const defs = [...usedWaits]
    .map(k => `<pattern id="${safe}-${k}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="${WAIT_TINT[k]}" fill-opacity="0.18"/><line x1="0" y1="0" x2="0" y2="4" stroke="${WAIT_TINT[k]}" stroke-width="1.6"/></pattern>`)
    .join('')
  const merged: LaneDrawPart[] = []
  for (const p of parts) {
    const last = merged[merged.length - 1]
    // Quelle que soit sa sorte : au plus une part par pixel, donc un SVG borné.
    if (last && (p.x1 - p.x0) * w < 1 && (p.x0 - last.x1) * w < 1) last.x1 = Math.max(last.x1, p.x1)
    else merged.push({ ...p })
  }
  const rects = merged.map(p => {
    const x = p.x0 * w
    const pw = Math.max(1.5, (p.x1 - p.x0) * w)
    const fill = p.kind.startsWith('wait') ? `url(#${safe}-${p.kind})` : p.isError ? '#E5534B' : color
    const op = p.kind === 'think' ? 0.38 : p.kind === 'tool' ? 0.75 : 1
    const anim = p.isLive ? '<animate attributeName="opacity" values="1;0.5;1" dur="1.6s" repeatCount="indefinite"/>' : ''
    const glyph = p.glyph && pw >= 12 ? `<text x="${r1(x + pw / 2)}" y="${y + bh - 1.5}" text-anchor="middle" ${FONT} font-size="8" fill="#17171C">${esc(p.glyph)}</text>` : ''
    return `<rect x="${r1(x)}" y="${y}" width="${r1(pw)}" height="${bh}" rx="2" fill="${fill}" fill-opacity="${op}">${anim}</rect>${glyph}`
  })
  const rail = `<rect x="0" y="${y + bh / 2 - 0.5}" width="${w}" height="1" fill="${MUTED}" fill-opacity="0.25"/>`
  const cuts = pauses.map(p => `<text x="${r1(((p.x0 + p.x1) / 2) * w)}" y="${y + bh - 1}" text-anchor="middle" ${FONT} font-size="10" fill="${MUTED}">⫽</text>`)
  const seen = new Set<string>()
  const placed = marks.filter(m => {
    const key = `${Math.round(m.x * w)}|${m.glyph}|${m.isRelay === true}|${m.isStart === true}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const dots = placed
    .filter(m => m.isRelay)
    .map(m => `<circle cx="${r1(m.x * w)}" cy="${y + bh / 2}" r="2.6" fill="${m.isStart ? color : WHITE}" stroke="${color}" stroke-width="1.2"/>`)
  const glyphs = placed
    .filter(m => !m.isRelay)
    .map(m => `<text x="${r1(Math.min(w - 4, Math.max(4, m.x * w)))}" y="8" text-anchor="middle" ${FONT} font-size="9" font-weight="700" fill="${m.color}">${esc(m.glyph)}</text>`)
  return { source: svg(w, h, `${defs ? `<defs>${defs}</defs>` : ''}${rail}${rects.join('')}${cuts.join('')}${dots.join('')}${glyphs.join('')}`), width: w, height: h }
}
