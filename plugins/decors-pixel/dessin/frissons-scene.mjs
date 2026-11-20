// Le décor « Frissons 80 » : la lisière d'une petite ville, une nuit de novembre
// des années 80. À gauche une maison et sa guirlande, à droite la forêt et sa
// faille, entre les deux une route, sous un orage rouge. Dessin original, dans
// l'esprit des films d'aventure et d'épouvante de l'époque : ni logo, ni lettrage,
// ni personnage, ni créature repris d'une œuvre.
import { Raster, rng } from './engine.mjs'
import { FPAL as PAL } from './frissons-palette.mjs'

export const W = 480
export const H = 270
// La route : ses deux bords, et la ligne où roulent les vélos.
export const ROAD = { top: 236, bottom: 258, wheel: 253 }
export const FIELD = 204

const R = () => new Raster(PAL, W, H)
const hash = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Un trait épais qui s'affine : membres, branches, troncs.
export function limb(r, x0, y0, x1, y1, w0, w1, c) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const w = w0 + (w1 - w0) * t
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    r.rect(Math.round(x - w / 2), Math.round(y), Math.max(1, Math.round(w)), 1, c)
  }
}

// ---------------------------------------------------------------- ciel
export const SKY = [[0, 's1'], [30, 's2'], [62, 's3'], [92, 's4'], [120, 's5'], [146, 's6'], [170, 's7']]
export const SKY_END = 206

export function skyRaster() {
  const r = R()
  SKY.forEach(([y, c], i) => r.rect(0, y, W, (i + 1 < SKY.length ? SKY[i + 1][0] : SKY_END) - y, c))
  for (let i = 1; i < SKY.length; i++) {
    const yb = SKY[i][0]
    for (let x = 0; x < W; x++) {
      if (x % 4 === 0) r.px(x, yb - 2, SKY[i][1])
      if (x % 2 === 1) r.px(x, yb - 1, SKY[i][1])
      if (x % 4 === 2) r.px(x, yb, SKY[i - 1][1])
    }
  }
  return r
}
export function skySvg() {
  let out = ''
  const k = c => PAL.cls(PAL.id(c))
  SKY.forEach(([y, c], i) => {
    const y1 = i + 1 < SKY.length ? SKY[i + 1][0] : SKY_END
    out += `<path class="${k(c)}" d="M0 ${y}h${W}v${y1 - y}h-${W}z"/>`
  })
  for (let i = 1; i < SKY.length; i++) {
    const yb = SKY[i][0]
    out += `<path class="${k(SKY[i][1])} s a" d="M0 ${yb - 2}.5h${W}"/>`
    out += `<path class="${k(SKY[i][1])} s b" d="M1 ${yb - 1}.5h${W - 1}"/>`
    out += `<path class="${k(SKY[i - 1][1])} s a" d="M2 ${yb}.5h${W - 2}"/>`
  }
  return out
}

export function stars() {
  const rand = rng(1983)
  const groups = [R(), R(), R()]
  for (let i = 0; i < 130; i++) {
    const x = Math.floor(rand() * W)
    const y = Math.floor(rand() * rand() * 160)
    const g = groups[i % 3]
    const c = ['st1', 'st1', 'st2', 'st3'][Math.floor(rand() * 4)]
    g.px(x, y, c)
    if (rand() < 0.08) {
      g.px(x - 1, y, c); g.px(x + 1, y, c); g.px(x, y - 1, c); g.px(x, y + 1, c)
    }
  }
  return groups
}

export const MOON = { x: 92, y: 50 }
export function moon() {
  const r = new Raster(PAL, 64, 64)
  const c = 32
  r.disc(c, c, 30, 'moH')
  r.disc(c, c, 23, 'moH')
  r.disc(c, c, 17, 'moH')
  r.disc(c, c, 13.6, 'mo1')
  // mers et cratères
  r.disc(c - 4, c - 3, 3.2, 'mo2'); r.disc(c + 4, c + 4, 2.6, 'mo2'); r.disc(c + 5, c - 5, 1.8, 'mo2')
  r.disc(c - 6, c + 5, 1.6, 'mo2'); r.px(c - 1, c + 8, 'mo3'); r.px(c - 8, c - 1, 'mo3'); r.px(c + 9, c, 'mo2')
  r.each((x, y, v) => {
    if (v === 'mo1' && (x - c) + (y - c) > 13) r.px(x, y, 'mo2')
  })
  return r
}

export function cloud(seed, w, tones = ['cl1', 'cl2', 'cl3']) {
  const rand = rng(seed)
  const h = 14
  const r = new Raster(PAL, w, h)
  const base = h - 2
  const n = Math.max(3, Math.round(w / 9))
  for (let i = 0; i < n; i++) {
    const cx = 6 + ((w - 12) * i) / (n - 1)
    const rad = 3 + rand() * 4 * (1 - Math.abs(i / (n - 1) - 0.5))
    r.disc(cx, base - rad * 0.7, rad, tones[0], (x, y) => y < base)
  }
  r.rect(3, base - 3, w - 6, 3, tones[0])
  r.each((x, y, c) => {
    if (!c) return
    if (y >= base - 2) r.px(x, y, tones[1])
    if (y === base - 1 && x > 4 && x < w - 5) r.px(x, y, tones[2])
  })
  return r
}

// Le banc de nuages de l'orage, à droite, rougi par en dessous.
export function storm() {
  const r = R()
  const rand = rng(66)
  const discs = []
  for (let i = 0; i < 26; i++) discs.push([262 + i * 9 + rand() * 8, 18 + rand() * 30 + Math.abs(i - 14) * 1.3, 12 + rand() * 12])
  for (const [cx, cy, rad] of discs) r.disc(cx, cy, rad, 'r1')
  // sombre en haut, rougi seulement par en dessous, là où couve l'éclair
  const tone = new Map()
  r.each((x, y, c) => {
    if (c !== 'r1') return
    const n = hash(Math.floor(x / 6), Math.floor(y / 2), 9)
    let below = 0
    while (below < 14 && r.get(x, y + below + 1)) below++
    let above = 0
    while (above < 14 && r.get(x, y - above - 1)) above++
    if (below < 1 && n > 0.45) tone.set(x + ':' + y, 'r4')
    else if (below < 2 + n * 2) tone.set(x + ':' + y, 'r3')
    else if (below < 6 + n * 4) tone.set(x + ':' + y, 'r2')
    else if (above < 7 + n * 7) tone.set(x + ':' + y, 'r0')
  })
  for (const [key, c] of tone) {
    const [x, y] = key.split(':').map(Number)
    r.px(x, y, c)
  }
  return r
}

// Un éclair : une ligne brisée, un cœur clair bordé de rouge, une branche.
export function bolt(seed, x0, y0, y1) {
  const r = R()
  const rand = rng(seed)
  const strike = (x, ya, yb, wide) => {
    let cx = x
    for (let y = ya; y < yb; y++) {
      if ((y - ya) % 5 === 0) cx += Math.floor(rand() * 9) - 4
      if (wide) { r.px(cx - 1, y, 'bolt'); r.px(cx + 1, y, 'bolt') }
      r.px(cx, y, wide ? 'bolt2' : 'bolt')
      if (wide && y === Math.floor((ya + yb) / 2)) strike(cx + 2, y, y + 34, false)
    }
  }
  strike(x0, y0, y1, true)
  return r
}

// La silhouette immense que l'éclair découpe dans l'orage : une tête à bois, des épaules.
// Elle se dresse derrière la colline du laboratoire, le temps d'un éclair.
export const GIANT = { x: 300, y: 92 }
export function giant() {
  const r = R()
  const { x: cx, y } = GIANT
  limb(r, cx, y + 6, cx, y + 110, 16, 62, 'giant')
  r.ell(cx, y, 8, 11, 'giant')
  limb(r, cx - 3, y + 8, cx - 9, y + 20, 5, 3, 'giant')
  const antler = side => {
    limb(r, cx + side * 5, y - 8, cx + side * 24, y - 32, 3, 2, 'giant')
    limb(r, cx + side * 12, y - 18, cx + side * 13, y - 40, 2, 1, 'giant')
    limb(r, cx + side * 19, y - 26, cx + side * 33, y - 36, 2, 1, 'giant')
    limb(r, cx + side * 24, y - 32, cx + side * 28, y - 48, 2, 1, 'giant')
    limb(r, cx + side * 9, y - 12, cx + side * 21, y - 14, 2, 1, 'giant')
  }
  antler(-1); antler(1)
  limb(r, cx - 27, y + 32, cx - 46, y + 96, 10, 5, 'giant')
  limb(r, cx + 27, y + 32, cx + 48, y + 94, 10, 5, 'giant')
  return r
}
export function giantEyes() {
  const r = R()
  r.rect(GIANT.x - 4, GIANT.y - 2, 2, 2, 'eye'); r.rect(GIANT.x + 3, GIANT.y - 2, 2, 2, 'eye')
  return r
}

// ---------------------------------------------------------------- arrière-plan
export const hillY = x =>
  Math.round(176 - 8 * Math.sin(x / 62 + 0.6) - 4 * Math.sin(x / 27 + 2) - 16 * Math.exp(-(((x - 292) / 58) ** 2)))

function pine(r, cx, base, h, c, rimC) {
  for (let y = 0; y < h; y++) {
    const layer = Math.floor(y / 6)
    const hw = Math.round(layer * 1.3 + (y % 6) * 0.75)
    r.hl(cx - hw, base - h + y, hw * 2 + 1, c)
    if (rimC && y % 6 >= 3 && hw > 0) r.px(cx - hw, base - h + y, rimC)
  }
  r.rect(cx, base, 1, 3, c)
}

export const LAB = { x: 266, w: 52 }
export const ANTENNA = { x: 334 }
function hills(r) {
  for (let x = 0; x < W; x++) r.vl(x, hillY(x), 215 - hillY(x), 'h1')
  // le château d'eau, sur sa colline
  const wx = 184
  const wy = hillY(wx)
  r.ell(wx, wy - 26, 11, 6.5, 'tw1')
  r.rect(wx - 11, wy - 27, 22, 5, 'tw1')
  r.hl(wx - 10, wy - 31, 20, 'tw2')
  r.vl(wx - 11, wy - 28, 6, 'tw2')
  r.rect(wx - 2, wy - 35, 4, 4, 'tw1'); r.px(wx - 1, wy - 36, 'tw1')
  for (const lx of [-9, -4, 4, 9]) limb(r, wx + lx, wy - 20, wx + lx * 1.25, wy + 2, 1, 1, 'tw1')
  r.hl(wx - 10, wy - 10, 21, 'tw1')
  r.line(wx - 10, wy - 20, wx + 11, wy - 4, 'tw1'); r.line(wx + 9, wy - 20, wx - 11, wy - 4, 'tw1')
  // le laboratoire, bas et long, derrière sa clôture
  const lx = LAB.x
  const ly = hillY(lx + 26) - 1
  r.rect(lx, ly - 11, LAB.w, 12, 'lab1')
  r.hl(lx, ly - 11, LAB.w, 'lab2')
  r.rect(lx + 32, ly - 17, 16, 6, 'lab1'); r.hl(lx + 32, ly - 17, 16, 'lab2')
  for (let i = 0; i < 10; i++) if (i !== 3 && i !== 7) r.rect(lx + 3 + i * 5, ly - 8, 3, 2, 'labW')
  r.rect(lx + 36, ly - 14, 2, 2, 'labW'); r.rect(lx + 42, ly - 14, 2, 2, 'labW')
  // parabole et cheminées
  r.line(lx + 8, ly - 12, lx + 8, ly - 17, 'lab2')
  r.line(lx + 5, ly - 19, lx + 11, ly - 16, 'lab2'); r.px(lx + 7, ly - 18, 'lab2'); r.px(lx + 9, ly - 18, 'lab2')
  r.rect(lx + 20, ly - 15, 2, 4, 'lab1'); r.rect(lx + 25, ly - 14, 2, 3, 'lab1')
  for (let x = lx - 10; x < lx + LAB.w + 10; x += 4) r.vl(x, ly - 3, 4, 'h2')
  r.hl(lx - 10, ly - 3, LAB.w + 20, 'h2')
  // l'antenne et son feu rouge
  const ax = ANTENNA.x
  const ay = hillY(ax)
  for (let y = 0; y < 62; y++) {
    const hw = Math.round((y / 62) * 4)
    r.px(ax - hw, ay - 62 + y, 'tw1'); r.px(ax + hw, ay - 62 + y, 'tw1')
    if (y % 6 === 0) r.hl(ax - hw, ay - 62 + y, hw * 2 + 1, 'tw1')
    if (y % 6 === 3 && hw > 0) r.px(ax, ay - 62 + y, 'tw1')
  }
  r.vl(ax, ay - 68, 6, 'tw1')
}
export const antennaTop = () => ({ x: ANTENNA.x, y: hillY(ANTENNA.x) - 69 })
export const labRoof = () => ({ x: LAB.x + 40, y: hillY(LAB.x + 26) - 18 })

function forest(r) {
  const rand = rng(404)
  // une crête de sapins lointains, puis une lisière plus proche
  for (let x = -4; x < W + 6; x += 5 + Math.floor(rand() * 4)) pine(r, x, 199 + Math.floor(rand() * 4), 14 + Math.floor(rand() * 12), 'h2')
  r.rect(0, 200, W, 8, 'h2')
  for (let x = -6; x < W + 8; x += 6 + Math.floor(rand() * 6)) {
    const edge = Math.min(1, Math.abs(x - 240) / 240)
    pine(r, x, 205 + Math.floor(rand() * 3), 16 + Math.floor(rand() * 10 + edge * 16), 'p1', rand() < 0.5 ? 'rim' : null)
  }
  r.rect(0, 204, W, 6, 'p1')
  diner(r)
}

function field(r) {
  const rand = rng(77)
  r.rect(0, FIELD + 4, W, ROAD.top - FIELD - 4, 'g1')
  for (let y = FIELD + 5; y < ROAD.top; y++)
    for (let x = 0; x < W; x++) {
      const n = hash(Math.floor(x / 3), y, 5)
      if (n > 0.86) r.px(x, y, 'g2')
      else if (n < 0.05 && y > FIELD + 12) r.px(x, y, 'g0')
    }
  // touffes d'herbe, éclairées par la lune
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rand() * W)
    const y = FIELD + 8 + Math.floor(rand() * (ROAD.top - FIELD - 10))
    r.px(x, y, 'g3'); r.px(x + 1, y - 1, 'g3'); r.px(x - 1, y - 1, 'g2')
    if (rand() < 0.3) r.px(x, y - 2, 'g4')
  }
}

function road(r) {
  const rand = rng(5)
  r.rect(0, ROAD.top, W, ROAD.bottom - ROAD.top, 'a1')
  r.hl(0, ROAD.top, W, 'a3')
  r.hl(0, ROAD.top + 1, W, 'a2')
  r.hl(0, ROAD.bottom - 1, W, 'a3')
  for (let i = 0; i < 160; i++) {
    const x = Math.floor(rand() * W)
    const y = ROAD.top + 2 + Math.floor(rand() * (ROAD.bottom - ROAD.top - 4))
    r.hl(x, y, 1 + Math.floor(rand() * 4), rand() < 0.75 ? 'a2' : 'a3')
  }
  // la ligne jaune, en pointillés
  for (let x = 6; x < W; x += 22) r.hl(x, ROAD.top + 10, 11, 'yl')
  // fissures
  r.line(120, ROAD.top + 4, 138, ROAD.top + 15, 'g0'); r.line(290, ROAD.top + 17, 306, ROAD.top + 6, 'g0')
  // le bas-côté, au premier plan
  r.rect(0, ROAD.bottom, W, H - ROAD.bottom, 'g0')
}

// L'arbre nu près de la maison : des branches qui se divisent.
function bareTree(r, x, y) {
  const rand = rng(31)
  const grow = (bx, by, angle, len, w, depth) => {
    const ex = bx + Math.cos(angle) * len
    const ey = by + Math.sin(angle) * len
    limb(r, bx, by, ex, ey, w, Math.max(1, w * 0.6), 'bark')
    if (w >= 3) limb(r, bx - w / 2 + 0.5, by, ex - w * 0.3, ey, 1, 1, 'rim')
    if (depth === 0 || len < 5) return
    const n = depth > 3 ? 2 : 2 + (rand() < 0.4 ? 1 : 0)
    for (let i = 0; i < n; i++) grow(ex, ey, angle + (i - (n - 1) / 2) * 0.62 + (rand() - 0.5) * 0.4, len * (0.66 + rand() * 0.16), w * 0.62, depth - 1)
  }
  grow(x, y, -Math.PI / 2 + 0.06, 30, 7, 5)
  r.rect(x - 5, y - 3, 10, 4, 'bark')
}
export const TREE = { x: 122, branch: { x: 143, y: 168 }, owl: { x: 106, y: 153 } }

export const HOUSE = { x: 14, w: 78, ground: 224 }
// Les ampoules de la guirlande : sous l'avant-toit de la véranda, puis le long du pignon.
export function bulbs() {
  const out = []
  const posts = [10, 36, 62, 88, 100]
  for (let s = 0; s + 1 < posts.length; s++) {
    const a = posts[s]
    const b = posts[s + 1]
    for (let x = a + 2; x < b; x += 4) {
      const t = (x - a) / (b - a)
      out.push([x, Math.round(185 + Math.sin(t * Math.PI) * 3)])
    }
  }
  for (let i = 1; i < 12; i++) out.push([Math.round(7 + i * 3.9), Math.round(151 - i * 2.42)])
  for (let i = 1; i < 12; i++) out.push([Math.round(99 - i * 3.9), Math.round(151 - i * 2.42)])
  return out.map(([x, y], i) => ({ x, y, hue: i % 4 }))
}

function house(r) {
  const { x, w, ground } = HOUSE
  const top = 150
  // le pignon et le toit
  for (let y = 122; y < top; y++) {
    const hw = Math.round(((y - 122) / 28) * 45)
    r.hl(53 - hw, y, hw * 2 + 1, y % 4 === 1 ? 'rf1' : 'rf2')
    r.px(53 - hw, y, 'rf3')
  }
  for (let y = 130; y < top; y++) {
    const hw = Math.round(((y - 130) / 20) * 31)
    r.hl(53 - hw, y, hw * 2 + 1, y % 3 === 0 ? 'w2' : 'w1')
  }
  // cheminée
  r.rect(72, 118, 9, 16, 'brick'); r.hl(71, 117, 11, 'rf3'); r.hl(72, 123, 9, 'rf1'); r.hl(72, 129, 9, 'rf1')
  // l'œil-de-bœuf du grenier
  r.disc(53.5, 139.5, 4.2, 'trim'); r.disc(53.5, 139.5, 3.1, 'w4'); r.vl(53, 137, 6, 'trim'); r.hl(51, 139, 6, 'trim')
  // les murs, en clins
  r.rect(x, top, w, ground - top, 'w1')
  for (let y = top + 2; y < ground; y += 3) r.hl(x, y, w, 'w2')
  r.vl(x, top, ground - top, 'w3'); r.vl(x + 1, top, ground - top, 'w3')
  r.rect(x + w - 3, top, 3, ground - top, 'w4')
  r.rect(x - 6, top - 1, w + 12, 2, 'rf3')
  // fenêtres de l'étage
  const win = (wx, wy, ww, wh, kind) => {
    r.rect(wx - 1, wy - 1, ww + 2, wh + 2, 'trim')
    r.rect(wx, wy, ww, wh, kind === 'dark' ? 'w4' : 'wl')
    if (kind !== 'dark') {
      r.rect(wx, wy + wh - 4, ww, 4, 'wl2')
      // rideaux
      r.rect(wx, wy, 2, wh, 'wl3'); r.rect(wx + ww - 2, wy, 2, wh, 'wl3')
    }
    r.vl(wx + Math.floor(ww / 2), wy, wh, 'trim'); r.hl(wx, wy + Math.floor(wh / 2), ww, 'trim')
    r.hl(wx - 2, wy + wh + 1, ww + 4, 'w3')
  }
  win(24, 156, 13, 16, 'lit')
  win(68, 156, 13, 16, 'tv')
  // la véranda : son toit, ses poteaux, son plancher
  r.rect(8, 176, 94, 5, 'rf2'); r.hl(8, 176, 94, 'rf3'); r.hl(8, 181, 94, 'rf1')
  for (let px = 10; px < 102; px += 3) r.px(px, 178, 'rf1')
  win(22, 191, 14, 17, 'lit')
  win(70, 191, 14, 17, 'lit')
  // une silhouette derrière le rideau
  r.rect(27, 197, 4, 4, 'wl3'); r.rect(26, 201, 6, 7, 'wl3')
  // la porte et son carreau
  r.rect(45, 190, 16, 30, 'trim'); r.rect(46, 191, 14, 29, 'door'); r.rect(48, 193, 10, 8, 'wl2'); r.rect(49, 194, 8, 6, 'wl')
  r.vl(53, 193, 8, 'door'); r.rect(48, 204, 10, 13, 'door2'); r.px(57, 207, 'wl')
  // la lanterne de la véranda
  r.rect(40, 186, 3, 4, 'lamp'); r.hl(39, 185, 5, 'post')
  for (const px of [10, 36, 62, 88, 99]) {
    r.rect(px, 181, 3, 39, 'trim'); r.vl(px + 2, 181, 39, 'w2')
  }
  for (let px = 13; px < 99; px += 3) if (px < 43 || px > 62) r.vl(px, 210, 9, 'w3')
  r.hl(10, 209, 34, 'trim'); r.hl(62, 209, 40, 'trim')
  r.rect(6, 219, 98, 3, 'w3'); r.hl(6, 222, 98, 'w4'); r.rect(6, 223, 98, 2, 'w4')
  // les marches et leurs citrouilles
  r.rect(42, 222, 22, 2, 'w3'); r.rect(40, 224, 26, 2, 'trim'); r.rect(38, 226, 30, 2, 'w3')
  r.rect(36, 222, 4, 3, 'pump'); r.px(37, 221, 'bG0'); r.rect(67, 223, 3, 2, 'pump'); r.px(68, 222, 'bG0')
  // la guirlande éteinte : le fil et ses ampoules
  const all = bulbs()
  all.forEach((b, i) => {
    if (i > 0 && Math.abs(all[i - 1].x - b.x) < 6) r.line(all[i - 1].x, all[i - 1].y - 1, b.x, b.y - 1, 'gw')
    r.px(b.x, b.y, ['bR0', 'bG0', 'bB0', 'bY0'][b.hue])
  })
}

export const LAMPS = [{ x: 134, flick: false }, { x: 352, flick: true }]
function lampPost(r, x) {
  const base = ROAD.top
  for (let y = base - 66; y < base; y++) { r.px(x, y, 'post2'); r.px(x + 1, y, 'post') }
  r.rect(x - 1, base - 4, 4, 4, 'post')
  // le col de cygne, vers la route
  r.line(x, base - 66, x + 3, base - 70, 'post2'); r.line(x + 3, base - 70, x + 9, base - 70, 'post2')
  r.rect(x + 7, base - 69, 7, 2, 'post'); r.hl(x + 8, base - 67, 5, 'lamp')
}
export function lampLight(x) {
  const r = R()
  const top = ROAD.top - 66
  for (let y = top; y < ROAD.top + 12; y++) {
    const hw = Math.round(2 + ((y - top) / 78) * 26)
    r.hl(x + 10 - hw, y, hw * 2 + 1, 'cone')
  }
  for (let y = top; y < ROAD.top + 8; y++) {
    const hw = Math.round(1 + ((y - top) / 78) * 13)
    r.hl(x + 10 - hw, y, hw * 2 + 1, 'cone2')
  }
  r.ell(x + 10, ROAD.top + 9, 30, 6, 'cone2')
  r.hl(x + 8, top + 1, 5, 'lamp')
  return r
}

export const POLE = { x: 232 }
function powerLine(r) {
  const x = POLE.x
  r.rect(x, 116, 3, ROAD.top - 116, 'wood'); r.vl(x, 116, ROAD.top - 116, 'wood2')
  r.rect(x - 10, 121, 23, 2, 'wood'); r.hl(x - 10, 121, 23, 'wood2')
  for (const ix of [-9, -3, 5, 11]) r.rect(x + ix, 118, 1, 3, 'post2')
  // les fils, qui pendent d'un appui à l'autre
  const sag = (x0, y0, x1, y1, drop) => {
    for (let px = x0; px <= x1; px++) {
      const t = (px - x0) / (x1 - x0)
      r.px(px, Math.round(y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * drop), 'wire')
    }
  }
  sag(96, 150, x - 9, 118, 14); sag(96, 152, x - 3, 118, 17)
  sag(x + 5, 118, W - 1, 104, 20); sag(x + 11, 118, W - 1, 110, 23)
  // trois oiseaux sur le fil
  for (const bx of [286, 292, 303]) {
    const t = (bx - (x + 5)) / (W - 1 - x - 5)
    const by = Math.round(118 + (104 - 118) * t + Math.sin(t * Math.PI) * 20)
    r.rect(bx, by - 3, 2, 3, 'wire'); r.px(bx + 2, by - 3, 'wire')
  }
}

function fence(r) {
  for (let x = 150; x < 396; x += 21) {
    r.rect(x, ROAD.top - 10, 2, 10, 'wood'); r.px(x, ROAD.top - 10, 'wood2')
  }
  r.hl(150, ROAD.top - 8, 246, 'wood'); r.hl(150, ROAD.top - 4, 246, 'wood')
  // la boîte aux lettres
  r.rect(124, ROAD.top - 12, 1, 12, 'wood2'); r.rect(120, ROAD.top - 16, 9, 5, 'w3'); r.hl(120, ROAD.top - 16, 9, 'trim'); r.rect(128, ROAD.top - 18, 1, 4, 'bR')
}

// Un grand sapin de la lisière : un tronc épais, des branches basses qui retombent.
function bigPine(r, cx, base, tw, top) {
  for (let y = top; y < base; y++) {
    const w = Math.round(tw * (0.55 + (0.45 * (y - top)) / (base - top)))
    const x0 = cx - Math.floor(w / 2)
    for (let i = 0; i < w; i++) r.px(x0 + i, y, hash(x0 + i, Math.floor(y / 7), 3) > 0.7 ? 'bark2' : 'bark')
    r.px(x0, y, 'rim')
    if (hash(cx, y, 8) > 0.55) r.px(x0 + 1, y, 'rim')
  }
  let layer = 0
  for (let y = top - 8; y < base - 46; y += 13) {
    const reach = 16 + layer * 5
    for (let i = 0; i < 16; i++) {
      const hw = Math.round((i / 16) * reach)
      r.hl(cx - hw, y + i, hw * 2 + 1, layer % 2 ? 'p2' : 'p3')
      if (i > 3 && i % 3 === 0) { r.px(cx - hw, y + i, 'rim'); r.px(cx - hw + 2, y + i - 1, 'rim') }
      if (i === 15) for (let k = -hw; k <= hw; k += 3) r.px(cx + k, y + i + 1, 'p3')
    }
    layer++
  }
}

// L'arbre creux et sa faille : une plaie rouge dans le tronc, des veines qui en partent.
export const RIFT = { x: 460, top: 196, bottom: 230 }
function hollowTree(r) {
  const cx = RIFT.x
  bigPine(r, cx, ROAD.top + 1, 22, 96)
  for (let y = 150; y < ROAD.top + 1; y++) {
    const w = 22 + Math.round(((y - 150) / 86) ** 2 * 10)
    const x0 = cx - Math.floor(w / 2)
    for (let i = 0; i < w; i++) r.px(x0 + i, y, hash(x0 + i, Math.floor(y / 6), 4) > 0.72 ? 'bark2' : 'bark')
    r.px(x0, y, 'rim'); r.px(x0 + 1, y, hash(cx, y, 2) > 0.5 ? 'rim' : 'bark')
  }
  // des veines sombres courent sur l'écorce et dans l'herbe
  const rand = rng(13)
  for (let i = 0; i < 9; i++) {
    let x = cx + Math.floor(rand() * 9) - 4
    let y = RIFT.top + Math.floor(rand() * 20)
    const dir = rand() < 0.5 ? -1 : 1
    for (let k = 0; k < 22 + rand() * 20; k++) {
      r.px(x, y, k % 5 === 0 ? 'vein2' : 'vein')
      x += rand() < 0.6 ? dir : 0
      y += rand() < (i < 5 ? 0.7 : 0.25) ? (i < 5 ? -1 : 1) : 0
      if (y > ROAD.top - 1) y = ROAD.top - 1
    }
  }
  // la faille
  for (let y = RIFT.top; y < RIFT.bottom; y++) {
    const t = (y - RIFT.top) / (RIFT.bottom - RIFT.top)
    const hw = Math.round(Math.sin(t * Math.PI) * 4.4 + hash(1, y, 6) * 1.2)
    r.hl(cx - hw - 1, y, hw * 2 + 3, 'vein')
    r.hl(cx - hw, y, hw * 2 + 1, 'rf')
    if (hw > 1) r.hl(cx - hw + 1, y, hw * 2 - 1, 'rf2x')
    if (hw > 3) r.hl(cx - 1, y, 3, 'rf3x')
  }
}
export function riftGlow() {
  const r = R()
  const cy = (RIFT.top + RIFT.bottom) / 2
  r.ell(RIFT.x, cy, 24, 36, 'rfH')
  r.ell(RIFT.x, cy, 16, 27, 'rfH')
  r.ell(RIFT.x, cy, 9, 20, 'rfH')
  r.ell(RIFT.x - 16, ROAD.top + 7, 44, 6, 'rfH')
  return r
}
// Les veines les plus proches de la faille, qui battent avec elle.
export function riftVeins(base) {
  const r = R()
  base.each((x, y, c) => {
    if ((c === 'vein' || c === 'vein2') && Math.hypot(x - RIFT.x, (y - (RIFT.top + RIFT.bottom) / 2) * 0.7) < 22) r.px(x, y, 'rf')
  })
  return r
}

// La vieille familiale garée devant la maison : flancs en faux bois.
function wagon(r, x) {
  const y = ROAD.top - 16
  r.rect(x + 1, y + 6, 46, 7, 'w3')
  r.rect(x + 12, y, 24, 6, 'w4')
  r.hl(x + 11, y, 26, 'trim'); r.line(x + 11, y, x + 7, y + 6, 'trim'); r.line(x + 36, y, x + 41, y + 6, 'trim')
  r.vl(x + 20, y + 1, 5, 'trim'); r.vl(x + 29, y + 1, 5, 'trim')
  r.px(x + 14, y + 2, 'rim'); r.px(x + 15, y + 1, 'rim'); r.px(x + 23, y + 2, 'rim'); r.px(x + 32, y + 2, 'rim')
  r.rect(x + 3, y + 8, 42, 3, 'wood2'); r.hl(x + 3, y + 8, 42, 'wood')
  r.hl(x + 1, y + 6, 46, 'trim')
  r.rect(x, y + 11, 48, 2, 'post2')
  r.rect(x, y + 7, 1, 3, 'red'); r.rect(x + 47, y + 7, 1, 2, 'lamp')
  for (const wx of [x + 9, x + 37]) {
    r.disc(wx + 0.5, y + 12.5, 3.6, 'tyre'); r.px(wx, y + 12, 'spoke')
  }
}

// Au loin, au bord du champ : un restaurant de bord de route et son enseigne au néon.
export const DINER = { x: 206, y: 199 }
function diner(r) {
  const { x, y } = DINER
  r.rect(x, y, 34, 8, 'lab1'); r.hl(x - 1, y, 36, 'lab2')
  for (let i = 0; i < 5; i++) r.rect(x + 2 + i * 6, y + 2, 4, 3, 'wl')
  r.vl(x + 31, y - 12, 12, 'post')
  r.rect(x + 22, y - 13, 19, 7, 'gw')
}
export function dinerNeon() {
  const r = R()
  const { x, y } = DINER
  r.hl(x - 1, y - 1, 36, 'bR')
  for (let i = 0; i < 5; i++) r.rect(x + 24 + i * 3, y - 11, 2, 3, i % 2 ? 'bB' : 'bR')
  r.disc(x + 31, y - 10, 5.5, 'hR')
  return r
}
export function shootingStar() {
  const r = new Raster(PAL, 9, 5)
  r.px(8, 4, 'st1'); r.px(7, 3, 'st1'); r.px(6, 3, 'st2'); r.px(5, 2, 'st2'); r.px(3, 1, 'st2'); r.px(1, 0, 'st2')
  return r
}

export function back() {
  const r = R()
  hills(r)
  forest(r)
  field(r)
  road(r)
  bareTree(r, TREE.x, HOUSE.ground + 2)
  // la balançoire : un pneu au bout d'une corde (immobile ici, elle bouge à part)
  house(r)
  powerLine(r)
  fence(r)
  wagon(r, 150)
  // des flaques, sous les réverbères
  for (const l of LAMPS) {
    r.hl(l.x + 2, ROAD.top + 7, 14, 'a3'); r.hl(l.x + 6, ROAD.top + 8, 12, 'a4'); r.hl(l.x - 2, ROAD.top + 15, 9, 'a3')
  }
  // la lisière, à droite : la forêt commence
  bigPine(r, 396, ROAD.top - 2, 9, 84)
  bigPine(r, 428, ROAD.top + 1, 12, 70)
  hollowTree(r)
  LAMPS.forEach(l => lampPost(r, l.x))
  // la chouette sur sa branche
  const o = TREE.owl
  r.spr(['.a.a.', 'aaaaa', 'abbba', 'abbba', '.aaa.', '.a.a.'], o.x, o.y, { a: 'owl1', b: 'owl2' })
  return r
}
export function owlEyes() {
  const r = R()
  r.px(TREE.owl.x + 1, TREE.owl.y + 2, 'owlE'); r.px(TREE.owl.x + 3, TREE.owl.y + 2, 'owlE')
  return r
}

// Les ampoules allumées, une couleur par calque, chacune avec son halo.
export function garland() {
  const lit = [R(), R(), R(), R()]
  const hue = [['bR', 'hR'], ['bG', 'hG'], ['bB', 'hB'], ['bY', 'hY']]
  for (const b of bulbs()) {
    const [c, h] = hue[b.hue]
    lit[b.hue].disc(b.x + 0.5, b.y + 0.5, 2.6, h)
    lit[b.hue].px(b.x, b.y, c)
    lit[b.hue].px(b.x, b.y + 1, c)
  }
  return lit
}
export function tvGlow() {
  const r = R()
  r.rect(68, 156, 13, 16, 'tv')
  return r
}
export function antennaLight() {
  const r = R()
  const a = antennaTop()
  r.disc(a.x + 0.5, a.y + 0.5, 4.5, 'redH'); r.disc(a.x + 0.5, a.y + 0.5, 2.2, 'redH')
  r.px(a.x, a.y, 'red')
  return r
}
export function tyreSwing() {
  const r = new Raster(PAL, 9, 30)
  r.vl(4, 0, 22, 'wire')
  r.disc(4.5, 25.5, 4.4, 'tyre'); r.disc(4.5, 25.5, 2.2, null)
  r.px(2, 23, 'rim'); r.px(1, 25, 'rim')
  return r
}

// Le premier plan : herbes hautes et fougères, en ombres, devant la route.
export function front() {
  const r = R()
  const rand = rng(909)
  for (let x = 0; x < W; x++) {
    const edge = Math.max(0, 1 - Math.min(x, W - x) / 90)
    const tall = 3 + Math.floor(hash(Math.floor(x / 2), 1, 7) * 5 + edge * edge * 22 * hash(Math.floor(x / 3), 2, 7))
    r.vl(x, H - tall, tall, 'g0')
    if (hash(x, 3, 7) > 0.8) r.px(x, H - tall, 'g2')
  }
  // des fougères dans les coins
  const fern = (fx, fy, dir, len) => {
    for (let i = 0; i < len; i++) {
      const x = fx + dir * i
      const y = fy - Math.round(Math.sin((i / len) * 2.2) * len * 0.5)
      r.px(x, y, 'g0')
      if (i % 2 === 0) { r.vl(x, y - 3, 3, 'g0'); r.vl(x, y + 1, 2, 'g0') }
      if (i % 4 === 0) r.px(x, y - 3, 'g2')
    }
  }
  for (let i = 0; i < 5; i++) fern(4 + i * 7, H - 4, 1, 14 + Math.floor(rand() * 8))
  for (let i = 0; i < 6; i++) fern(W - 4 - i * 7, H - 3, -1, 14 + Math.floor(rand() * 10))
  return r
}

// La brume : de longues nappes basses.
export function fog(seed, w) {
  const r = new Raster(PAL, w, 12)
  const rand = rng(seed)
  for (let i = 0; i < 6; i++) r.ell(20 + rand() * (w - 40), 6, 30 + rand() * 40, 2 + rand() * 3, 'fog')
  return r
}

// Les spores qui montent : des poussières pâles, plus denses près de la faille.
export function spores(group, groups) {
  const r = R()
  const rand = rng(300 + group)
  const n = 22
  for (let i = 0; i < n; i++) {
    const near = rand() < 0.5
    const x = near ? 360 + Math.floor(rand() * 120) : Math.floor(rand() * W)
    const y = 60 + Math.floor(rand() * 200)
    const c = rand() < 0.75 ? 'sp1' : 'sp2'
    r.px(x, y, c)
    if (rand() < 0.22) r.px(x + 1, y, c)
  }
  return r
}

export function bat(frame) {
  const r = new Raster(PAL, 7, 4)
  r.spr(frame ? ['.......', 'b..b..b', '.bbbbb.', '..b.b..'] : ['bb...bb', '.bbbbb.', '...b...', '.......'], 0, 0, { b: 'bat' })
  return r
}
export function smoke() {
  const r = new Raster(PAL, 7, 5)
  r.hl(2, 0, 3, 'smoke'); r.hl(1, 1, 5, 'smoke'); r.hl(0, 2, 7, 'smoke'); r.hl(1, 3, 5, 'smoke'); r.hl(2, 4, 2, 'smoke')
  return r
}
