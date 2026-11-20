// Le décor : Paris vu d'un quai de Seine, à hauteur de chien.
import { Raster, rng, text, textWidth } from './engine.mjs'
import { PAL } from './palette.mjs'

export const W = 480
export const H = 270
export const GROUND = 252 // pied du mobilier, sur le trottoir
export const CAFE_W = 84

const R = () => new Raster(PAL, W, H)
const hash = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// ---------------------------------------------------------------- ciel
export const SKY = [
  [0, 'sky1'], [24, 'sky2'], [50, 'sky3'], [76, 'sky4'], [100, 'sky5'], [122, 'sky6'], [144, 'sky7'],
]
export const SKY_END = 206

export function skyRaster() {
  const r = R()
  SKY.forEach(([y, c], i) => {
    const y1 = i + 1 < SKY.length ? SKY[i + 1][0] : SKY_END
    r.rect(0, y, W, y1 - y, c)
  })
  for (let i = 1; i < SKY.length; i++) {
    const yb = SKY[i][0]
    const up = SKY[i - 1][1]
    const lo = SKY[i][1]
    for (let x = 0; x < W; x++) {
      if (x % 4 === 0) r.px(x, yb - 2, lo)
      if (x % 2 === 1) r.px(x, yb - 1, lo)
      if (x % 4 === 2) r.px(x, yb, up)
    }
  }
  return r
}
// Le même ciel, écrit court : des bandes et des pointillés.
export function skySvg() {
  let out = ''
  SKY.forEach(([y, c], i) => {
    const y1 = i + 1 < SKY.length ? SKY[i + 1][0] : SKY_END
    out += `<path class="${PAL.cls(PAL.id(c))}" d="M0 ${y}h${W}v${y1 - y}h-${W}z"/>`
  })
  for (let i = 1; i < SKY.length; i++) {
    const yb = SKY[i][0]
    const up = PAL.cls(PAL.id(SKY[i - 1][1]))
    const lo = PAL.cls(PAL.id(SKY[i][1]))
    out += `<path class="${lo} s a" d="M0 ${yb - 2}.5h${W}"/>`
    out += `<path class="${lo} s b" d="M1 ${yb - 1}.5h${W - 1}"/>`
    out += `<path class="${up} s a" d="M2 ${yb}.5h${W - 2}"/>`
  }
  return out
}

export function stars() {
  const rand = rng(77)
  const groups = [R(), R(), R()]
  for (let i = 0; i < 95; i++) {
    const x = Math.floor(rand() * W)
    const y = Math.floor(rand() * rand() * 150)
    const g = groups[i % 3]
    const c = ['star1', 'star1', 'star2', 'star3'][Math.floor(rand() * 4)]
    g.px(x, y, c)
    if (rand() < 0.1) {
      g.px(x - 1, y, c)
      g.px(x + 1, y, c)
      g.px(x, y - 1, c)
      g.px(x, y + 1, c)
    }
  }
  return groups
}

export const SUN = { x: 196, y: 46 }
export function sun() {
  const r = new Raster(PAL, 44, 44)
  const c = 22
  r.disc(c, c, 17, 'sunH')
  r.disc(c, c, 11, 'sun2')
  r.disc(c, c, 9.6, 'sun1')
  return r
}
export function sunRays() {
  const r = new Raster(PAL, 44, 44)
  const c = 22
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4
    for (let d = 14; d <= 18; d++) r.px(c + Math.cos(a) * d - 0.5, c + Math.sin(a) * d - 0.5, 'sun2')
  }
  return r
}
export function moon() {
  const r = new Raster(PAL, 44, 44)
  const c = 22
  r.disc(c, c, 18, 'moonH')
  r.disc(c, c, 13, 'moonH')
  r.disc(c, c, 9.6, 'moon1')
  // le croissant : un disque décalé reprend la teinte du halo
  for (let y = 0; y < 44; y++)
    for (let x = 0; x < 44; x++) {
      const dx = x + 0.5 - (c + 5)
      const dy = y + 0.5 - (c - 3)
      if (dx * dx + dy * dy <= 8.2 * 8.2 && r.get(x, y) === 'moon1') r.px(x, y, 'moonH')
    }
  r.px(c - 5, c + 1, 'moon2')
  r.px(c - 6, c - 2, 'moon2')
  r.px(c - 3, c + 5, 'moon2')
  r.px(c - 4, c + 4, 'moon2')
  return r
}

export function cloud(seed, w) {
  const rand = rng(seed)
  const h = 16
  const r = new Raster(PAL, w, h)
  const base = h - 2
  const n = Math.max(3, Math.round(w / 9))
  for (let i = 0; i < n; i++) {
    const cx = 6 + ((w - 12) * i) / (n - 1)
    const rad = 4 + rand() * 4 * (1 - Math.abs(i / (n - 1) - 0.5))
    r.disc(cx, base - rad * 0.7, rad, 'cl1', (x, y) => y < base)
  }
  r.rect(3, base - 3, w - 6, 3, 'cl1')
  r.each((x, y, c) => {
    if (!c) return
    if (y >= base - 2) r.px(x, y, 'cl2')
    if (y === base - 1 && x > 4 && x < w - 5) r.px(x, y, 'cl3')
  })
  r.each((x, y, c) => {
    if (c === 'cl1' && r.get(x + 1, y + 1) === null && r.get(x + 1, y)) r.px(x, y, 'cl2')
  })
  return r
}

export function birds(frame) {
  const r = new Raster(PAL, 40, 14)
  const at = [[4, 8], [13, 4], [22, 9], [30, 3], [35, 10]]
  for (const [x, y] of at) {
    if (frame === 0) {
      r.px(x - 2, y - 1, 'iron'); r.px(x - 1, y, 'iron'); r.px(x, y + 1, 'iron'); r.px(x + 1, y, 'iron'); r.px(x + 2, y - 1, 'iron')
    } else {
      r.px(x - 2, y + 1, 'iron'); r.px(x - 1, y, 'iron'); r.px(x, y, 'iron'); r.px(x + 1, y, 'iron'); r.px(x + 2, y + 1, 'iron')
    }
  }
  return r
}

// ---------------------------------------------------------------- arbres
// Feuillage : une union de disques, éclairée en haut à gauche, par touffes.
function foliage(r, discs, tones, seed, cw, ch) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const [cx, cy, rad] of discs) {
    x0 = Math.min(x0, cx - rad); x1 = Math.max(x1, cx + rad)
    y0 = Math.min(y0, cy - rad); y1 = Math.max(y1, cy + rad)
  }
  const inside = (x, y) => discs.some(([cx, cy, rad]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rad * rad)
  for (let y = Math.floor(y0); y <= y1; y++)
    for (let x = Math.floor(x0); x <= x1; x++) {
      if (!inside(x, y)) continue
      const row = Math.floor(y / ch)
      const cellX = Math.floor((x + (row % 2) * (cw / 2)) / cw)
      const n = hash(cellX, row, seed) - 0.5
      // chaque disque a sa propre lumière : on prend la plus claire
      let v = 1e9
      for (const [cx, cy, rad] of discs) {
        const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
        if (d <= rad * rad) v = Math.min(v, ((x - cx) * 0.6 + (y - cy)) / rad)
      }
      const t = v + n * 0.9
      let c = t < -0.45 ? tones[0] : t < 0.3 ? tones[1] : t < 0.75 ? tones[2] : tones[3] ?? tones[2]
      if (!inside(x, y + 1) || !inside(x + 1, y)) c = tones[3] ?? tones[2]
      r.px(x, y, c)
    }
}
const AUTUMN = ['lf2', 'lf1', 'lf3', 'lf4']
const GREEN = ['gr2', 'gr1', 'gr3', 'gr3']

function smallTree(r, cx, base, rad, tones, seed) {
  r.rect(cx, base - rad - 2, 2, rad + 2, 'tk2')
  foliage(
    r,
    [[cx + 1, base - rad - 6, rad], [cx - rad * 0.6, base - rad - 2, rad * 0.75], [cx + rad * 0.8, base - rad - 3, rad * 0.75]],
    tones, seed, 3, 2,
  )
}

// ---------------------------------------------------------------- lointains
function farSkyline(r) {
  const rand = rng(5)
  // la butte Montmartre et sa basilique blanche
  for (let x = CAFE_W; x < 236; x++) {
    const top = Math.round(152 - 17 * Math.exp(-(((x - 150) / 42) ** 2)))
    r.vl(x, top, 200 - top, 'far2')
  }
  const bx = 150
  r.rect(bx - 9, 124, 19, 12, 'far1')
  r.ell(bx + 0.5, 118, 5, 8, 'far1')
  r.rect(bx, 104, 1, 6, 'far1')
  r.ell(bx - 8, 123, 3, 4, 'far1')
  r.ell(bx + 9, 123, 3, 4, 'far1')
  r.rect(bx + 13, 111, 4, 25, 'far1')
  r.px(bx + 14, 109, 'far1'); r.px(bx + 15, 109, 'far1'); r.px(bx + 14, 110, 'far1'); r.px(bx + 15, 110, 'far1'); r.px(bx + 14, 107, 'far1'); r.px(bx + 14, 108, 'far1')
  // toits lointains, avec leurs cheminées
  let x = CAFE_W
  while (x < W) {
    const w = 7 + Math.floor(rand() * 10)
    const top = 137 + Math.floor(rand() * 9)
    r.rect(x, top, w, 200 - top, 'far3')
    if (rand() < 0.6) r.rect(x + 1 + Math.floor(rand() * (w - 3)), top - 3, 2, 3, 'far3')
    x += w
  }
  // un dôme doré
  const dx = 250
  r.rect(dx - 8, 138, 17, 12, 'far3')
  r.ell(dx + 0.5, 138, 7, 9, 'gold', (px, py) => py < 138)
  r.rect(dx, 124, 1, 6, 'gold')
  r.px(dx, 122, 'gold'); r.px(dx, 123, 'gold')
  r.hl(dx - 7, 138, 15, 'far2')
}

// Immeuble haussmannien de la rive d'en face.
function haussmann(r, x, w, top, base, seed) {
  const rand = rng(seed)
  const stone = ['stA', 'stB', 'stC'][seed % 3]
  const roofH = 9
  // toit de zinc mansardé
  r.rect(x, top, w, roofH, 'zn1')
  r.hl(x + 1, top, w - 2, 'zn2')
  r.px(x, top, null); r.px(x + w - 1, top, null)
  r.px(x, top + 1, null); r.px(x + w - 1, top + 1, null)
  for (let i = x + 4; i < x + w - 1; i += 5) r.vl(i, top + 1, roofH - 1, 'zn3')
  // souches de cheminée et leurs mitrons
  const nch = 1 + (w > 36 ? 1 : 0)
  for (let i = 0; i < nch; i++) {
    const cx = x + 3 + Math.floor(rand() * (w - 12)) + i * 3
    r.rect(cx, top - 5, 6, 6, 'brk')
    r.hl(cx, top - 5, 6, 'stS')
    for (let k = 0; k < 3; k++) r.rect(cx + k * 2, top - 7, 1, 2, 'pot')
  }
  const fy = top + roofH
  r.rect(x, fy, w, base - fy, stone)
  r.hl(x, fy, w, 'stH')
  r.hl(x, fy + 1, w, 'stS')
  r.vl(x + w - 1, fy, base - fy, 'stS')
  r.vl(x, fy + 2, base - fy - 2, 'stH')
  const groundH = 11
  const gy = base - groundH
  const nF = Math.max(3, Math.round((gy - fy - 2) / 8))
  const fh = (gy - fy - 2) / nF
  const cols = Math.floor((w - 2) / 6)
  const mx = x + Math.round((w - (cols * 6 - 3)) / 2)
  for (let c = 0; c < cols; c++) {
    const wx = mx + c * 6
    // lucarne dans le toit, une colonne sur deux
    if (c % 2 === seed % 2) {
      r.rect(wx - 1, top + 2, 5, 6, 'stC')
      r.rect(wx, top + 3, 3, 5, rand() < 0.4 ? 'wA' : 'wB')
      r.hl(wx - 1, top + 2, 5, 'stH')
    }
    for (let f = 0; f < nF; f++) {
      const wy = Math.round(fy + 2 + f * fh) + 1
      const k = rand()
      r.rect(wx, wy, 3, 5, k < 0.42 ? 'wA' : k < 0.86 ? 'wB' : 'wC')
      r.hl(wx, wy + 5, 3, 'stH')
      if (rand() < 0.12) r.hl(wx, wy + 4, 3, 'red')
    }
  }
  // balcons filants : étage noble et dernier étage
  for (const f of [0, nF - 1]) {
    const by = Math.round(fy + 2 + f * fh) + 6
    r.hl(x + 1, by, w - 2, 'iron')
    for (let i = x + 1; i < x + w - 1; i += 2) r.px(i, by - 1, 'iron')
  }
  for (let f = 1; f < nF - 1; f++) r.hl(x + 1, Math.round(fy + 2 + f * fh) + 7, w - 2, 'stS')
  // rez-de-chaussée : boutique sous son auvent
  const aw = ['awR', 'awG', 'awB', 'awY', 'awR'][Math.floor(rand() * 5)]
  r.rect(x + 1, gy, w - 2, groundH, 'stS')
  r.rect(x + 2, gy + 4, w - 4, 6, 'wC')
  for (let i = x + 2 + 5; i < x + w - 3; i += 6) r.vl(i, gy + 4, 6, 'iron')
  const door = x + 3 + Math.floor(rand() * (w - 10))
  r.rect(door, gy + 4, 3, 7, 'wood')
  r.rect(x + 1, gy, w - 2, 3, aw)
  for (let i = x + 1; i < x + w - 1; i += 2) r.px(i, gy + 3, aw)
  r.hl(x + 1, gy - 1, w - 2, 'stH')
  r.hl(x, base - 1, w, 'q3')
}

// La tour : treillis à jour, le ciel passe au travers.
export const TOWER = { cx: 322, base: 196, h: 182 }
function eiffel(r) {
  const { cx, base, h } = TOWER
  const prof = [
    [0, 34], [0.05, 30.5], [0.1, 27], [0.175, 21], [0.25, 15.5], [0.345, 10.5],
    [0.45, 7], [0.6, 4.6], [0.75, 3.1], [0.84, 2.4], [0.9, 1.2], [1, 0.5],
  ]
  const hwAt = t => {
    for (let i = 1; i < prof.length; i++)
      if (t <= prof[i][0]) {
        const [t0, a] = prof[i - 1]
        const [t1, b] = prof[i]
        return a + ((b - a) * (t - t0)) / (t1 - t0)
      }
    return 0.5
  }
  const yOf = t => Math.round(base - t * h)
  const p1 = yOf(0.175), p2 = yOf(0.345), p3 = yOf(0.84)
  const lattice = (x, y, a, b) => {
    const u = x - a
    const v = b - 1 - x
    return (u + y) % 4 === 0 || (v + y) % 4 === 0
  }
  const leg = (y, a, b, flipLight) => {
    for (let x = a; x < b; x++) {
      const edgeOut = flipLight ? x === b - 1 : x === a
      const edgeIn = flipLight ? x === a : x === b - 1
      if (edgeOut) r.px(x, y, flipLight ? 'ef3' : 'ef2')
      else if (edgeIn) r.px(x, y, 'ef3')
      else if (lattice(x, y, a, b)) r.px(x, y, 'ef1')
      else if (y % 6 === 0) r.px(x, y, 'ef1')
    }
  }
  // l'arche décorative, sous le premier étage
  const arx = 24, ary = p1 - 3
  for (let y = p1; y < base - 2; y++)
    for (let x = cx - 26; x <= cx + 26; x++) {
      const dx = (x + 0.5 - cx) / arx
      const dy = (y - (base - 1)) / (base - 1 - ary)
      const d = dx * dx + dy * dy
      if (d <= 1 && d >= 0.8) r.px(x, y, d > 0.93 ? 'ef3' : 'ef1')
      else if (d > 1 && y < p1 + 12 && (x + y) % 2 === 0 && Math.abs(x + 0.5 - cx) < hwAt((base - y) / h) - 1) r.px(x, y, 'ef1')
    }
  for (let y = base - 1; y >= 0; y--) {
    const t = (base - y) / h
    if (t > 1) break
    const hw = hwAt(t)
    const L = Math.round(cx - hw)
    const Rr = Math.round(cx + hw)
    if (t < 0.175) {
      const lw = Math.round(12 - (t / 0.175) * 4)
      leg(y, L, L + lw, false)
      leg(y, Rr - lw, Rr, true)
    } else if (t < 0.345) {
      const u = (t - 0.175) / 0.17
      const lw = Math.round(8 - u * 3)
      leg(y, L, L + lw, false)
      leg(y, Rr - lw, Rr, true)
      if (y === Math.round((p1 + p2) / 2)) r.hl(L, y, Rr - L, 'ef3')
    } else if (t < 0.5) {
      const u = (t - 0.345) / 0.155
      const gap = Math.round(5 * (1 - u))
      const mid = Math.round(cx)
      if (gap > 1) {
        leg(y, L, mid - gap + 1, false)
        leg(y, mid + gap - 1, Rr, true)
      } else leg(y, L, Rr, false)
    } else if (t < 0.84) {
      leg(y, L, Rr, false)
    } else {
      r.hl(L, y, Math.max(1, Rr - L), 'ef1')
    }
  }
  // les trois étages
  const deck = (y, hw, tall) => {
    r.rect(cx - hw, y, hw * 2, tall, 'ef3')
    r.hl(cx - hw, y, hw * 2, 'ef2')
    for (let x = cx - hw + 1; x < cx + hw - 1; x += 2) r.px(x, y + 1, 'efL')
  }
  deck(p1 - 2, 24, 5)
  deck(p2 - 2, 13, 4)
  deck(p3 - 1, 5, 3)
  r.rect(cx - 2, p3 - 6, 4, 5, 'ef1')
  r.hl(cx - 2, p3 - 6, 4, 'ef2')
  r.px(cx - 1, p3 - 4, 'efL'); r.px(cx, p3 - 4, 'efL')
  // le phare
  r.px(cx - 1, yOf(1) - 1, 'efL'); r.px(cx, yOf(1) - 1, 'efL')
}

export function back() {
  const r = R()
  const base = 196
  farSkyline(r)
  // rive gauche du tableau
  let x = CAFE_W
  const left = [[38, 147], [44, 151], [34, 144], [46, 149], [24, 153]]
  left.forEach(([w, top], i) => {
    haussmann(r, x, w, top, base, 11 + i)
    x += w
  })
  // rive droite du tableau
  x = 372
  const right = [[40, 148], [36, 144], [34, 150]]
  right.forEach(([w, top], i) => {
    haussmann(r, x, w, top, base, 31 + i)
    x += w
  })
  eiffel(r)
  // pelouses et arbres au pied de la tour
  r.rect(270, base - 3, 102, 3, 'gr3')
  r.hl(270, base - 4, 102, 'gr1')
  foliage(r, [[296, base - 5, 4], [303, base - 6, 5], [311, base - 5, 4]], GREEN, 3, 3, 2)
  foliage(r, [[333, base - 5, 4], [340, base - 6, 5], [348, base - 5, 4]], GREEN, 4, 3, 2)
  smallTree(r, 275, base, 7, GREEN, 21)
  smallTree(r, 366, base, 7, GREEN, 22)
  // platanes du quai, en habits d'automne
  ;[[100, 6, 1], [128, 7, 2], [171, 6, 3], [197, 7, 4], [238, 6, 5], [259, 7, 6], [392, 6, 7], [418, 7, 8]].forEach(
    ([tx, rad, s]) => smallTree(r, tx, base, rad, s % 3 === 0 ? GREEN : AUTUMN, 40 + s),
  )
  // réverbères du quai d'en face
  for (let lx = 112; lx < W; lx += 34) {
    if (lx > 280 && lx < 364) continue
    r.vl(lx, base - 9, 9, 'iron')
    r.px(lx, base - 10, 'lampG')
    r.px(lx - 1, base - 10, 'iron'); r.px(lx + 1, base - 10, 'iron')
    r.px(lx, base - 11, 'iron')
  }
  // mur du quai
  const qy = base
  r.hl(CAFE_W, qy, W - CAFE_W, 'q1')
  r.rect(CAFE_W, qy + 1, W - CAFE_W, 9, 'q2')
  r.hl(CAFE_W, qy + 5, W - CAFE_W, 'q3')
  for (let i = CAFE_W; i < W; i += 9) {
    r.vl(i, qy + 1, 4, 'q3')
    r.vl(i + 4, qy + 6, 4, 'q3')
  }
  r.hl(CAFE_W, qy + 9, W - CAFE_W, 'q4')
  const rand = rng(9)
  for (let i = 0; i < 26; i++) r.px(CAFE_W + Math.floor(rand() * (W - CAFE_W)), qy + 8, 'moss')
  // escalier vers la berge
  for (let i = 0; i < 8; i++) r.hl(360 + i, qy + 1 + i, 4, 'q4')
  // Seine
  const sy = qy + 10
  const sh = 228 - sy
  r.rect(CAFE_W, sy, W - CAFE_W, sh, 'w1')
  r.hl(CAFE_W, sy, W - CAFE_W, 'w3')
  for (let y = sy + 1; y < sy + sh; y++) {
    const n = 3 + Math.floor(rand() * 3)
    for (let i = 0; i < n; i++) {
      const len = 5 + Math.floor(rand() * 14)
      const xx = CAFE_W + Math.floor(rand() * (W - CAFE_W - len))
      r.hl(xx, y, len, rand() < (y < sy + 4 ? 0.8 : 0.35) ? 'w3' : 'w2')
    }
  }
  // reflet de la tour
  for (let y = sy + 1; y < sy + sh; y += 1) {
    if (y % 2) continue
    const wd = Math.max(2, 9 - Math.floor((y - sy) / 3))
    const jx = Math.floor(rand() * 5) - 2
    r.hl(TOWER.cx - Math.floor(wd / 2) + jx, y, wd, 'wr')
  }
  // péniche amarrée
  const px = 176, py = qy + 4
  r.rect(px, py + 3, 58, 4, 'hull2')
  r.px(px, py + 3, null); r.px(px + 1, py + 3, null); r.px(px, py + 4, null); r.px(px + 57, py + 3, null)
  r.hl(px + 1, py + 6, 56, 'red')
  r.hl(px + 2, py + 3, 55, 'white')
  r.rect(px + 12, py - 2, 30, 5, 'hull')
  r.hl(px + 11, py - 3, 32, 'zn3')
  for (let i = 0; i < 6; i++) r.rect(px + 14 + i * 5, py - 1, 3, 2, i % 3 === 1 ? 'wB' : 'wA')
  r.rect(px + 45, py - 5, 8, 8, 'hull')
  r.hl(px + 44, py - 6, 10, 'zn3')
  r.rect(px + 47, py - 4, 4, 3, 'wA')
  r.px(px + 4, py + 2, 'gr1'); r.px(px + 5, py + 1, 'gr2'); r.px(px + 6, py + 2, 'gr1'); r.px(px + 7, py + 2, 'red'); r.px(px + 9, py + 2, 'gr1')
  r.vl(px + 56, py - 4, 7, 'iron'); r.hl(px + 53, py - 4, 3, 'red')
  return r
}

// Lumières de la nuit, côté rive d'en face.
export function backNight() {
  const r = R()
  const base = 196
  const rand = rng(31)
  for (let lx = 112; lx < W; lx += 34) {
    if (lx > 280 && lx < 364) continue
    r.disc(lx + 0.5, base - 9.5, 4.5, 'halo')
    r.disc(lx + 0.5, base - 9.5, 2.5, 'halo2')
    // reflet dans l'eau
    for (let y = 208; y < 226; y += 2) if (rand() < 0.75) r.hl(lx - 1 + Math.floor(rand() * 3) - 1, y, 2 + Math.floor(rand() * 2), 'wh')
  }
  return r
}
export function sparkles() {
  const rand = rng(404)
  const groups = [R(), R(), R()]
  const b = back()
  let n = 0
  for (let tries = 0; tries < 6000 && n < 96; tries++) {
    const y = 16 + Math.floor(rand() * 176)
    const x = TOWER.cx - 34 + Math.floor(rand() * 68)
    const c = b.get(x, y)
    if (c === 'ef1' || c === 'ef2' || c === 'ef3') {
      groups[n % 3].px(x, y, 'star1')
      n++
    }
  }
  return groups
}
export function shimmer() {
  const rand = rng(88)
  const groups = [R(), R()]
  for (let i = 0; i < 46; i++) {
    const x = CAFE_W + 4 + Math.floor(rand() * (W - CAFE_W - 12))
    const y = 209 + Math.floor(rand() * 18)
    groups[i % 2].hl(x, y, 2 + Math.floor(rand() * 4), 'wh')
  }
  return groups
}

// ---------------------------------------------------------------- bateau
export const BOAT = { w: 92, h: 20, y: 207 }
export function boat() {
  const r = new Raster(PAL, BOAT.w, BOAT.h)
  const w = BOAT.w
  // coque (la proue pointe à gauche)
  r.rect(6, 12, w - 10, 5, 'hull')
  r.rect(3, 12, 3, 3, 'hull'); r.px(2, 12, 'hull'); r.px(4, 15, 'hull'); r.px(5, 15, 'hull'); r.px(5, 16, 'hull')
  r.hl(2, 11, w - 5, 'hull2')
  r.hl(6, 16, w - 10, 'red')
  r.hl(5, 17, w - 9, 'hull2')
  // verrière
  r.rect(14, 5, w - 30, 6, 'wA')
  r.hl(13, 4, w - 28, 'hull')
  r.hl(13, 3, w - 28, 'hull2')
  for (let x = 14; x < w - 16; x += 6) r.vl(x, 5, 6, 'hull')
  // passagers
  const rand = rng(12)
  for (let x = 16; x < w - 18; x += 3) if (rand() < 0.6) r.px(x + (x % 6 === 2 ? 1 : 0), 9, ['iron', 'red', 'blue', 'wood2'][Math.floor(rand() * 4)])
  // pont arrière, pavillon tricolore
  r.rect(w - 15, 8, 9, 3, 'hull')
  r.vl(w - 6, 2, 9, 'iron')
  r.rect(w - 5, 2, 2, 3, 'blue'); r.rect(w - 3, 2, 2, 3, 'white'); r.rect(w - 1, 2, 1, 3, 'red')
  // guirlande
  for (let x = 16; x < w - 16; x += 4) r.px(x, 2, x % 8 === 0 ? 'lampG' : 'yel')
  // écume
  r.hl(0, 17, 5, 'wh'); r.hl(1, 18, 9, 'wh'); r.hl(w - 6, 17, 6, 'wh'); r.hl(8, 19, 20, 'wh')
  return r
}

// ---------------------------------------------------------------- premier plan
export const LAMPS = [114, 240, 372]
const LANTERN = [
  '....oo....',
  '...oooo...',
  '..oooooo..',
  '.oooooooo.',
  '.oGGGGGGo.',
  '.oGGyyGGo.',
  '..oGyyGo..',
  '..oGGGGo..',
  '...oGGo...',
  '...oooo...',
  '....oo....',
]
function lamp(r, x) {
  const b = GROUND
  r.rect(x - 4, b - 2, 8, 2, 'gi3')
  r.rect(x - 3, b - 8, 6, 6, 'gi1')
  r.vl(x - 3, b - 8, 6, 'gi2')
  r.rect(x - 2, b - 12, 4, 4, 'gi1')
  r.vl(x - 2, b - 12, 4, 'gi2')
  r.hl(x - 3, b - 9, 6, 'gi3')
  for (let y = b - 62; y < b - 12; y++) {
    r.px(x - 1, y, 'gi2')
    r.px(x, y, 'gi3')
  }
  for (const ry of [b - 28, b - 46]) {
    r.rect(x - 2, ry, 4, 2, 'gi1')
    r.px(x - 2, ry, 'gi2')
  }
  r.hl(x - 5, b - 58, 10, 'gi1'); r.px(x - 5, b - 59, 'gi3'); r.px(x + 4, b - 59, 'gi3')
  r.rect(x - 2, b - 63, 4, 2, 'gi3')
  r.spr(LANTERN, x - 5, b - 74, { o: 'gi3', G: 'lampG', y: 'yel' })
}
export const lampGlow = x => ({ x: x - 0.0, y: GROUND - 68.5 })

function bench(r, x) {
  const b = GROUND
  for (let i = 0; i < 3; i++) r.rect(x, b - 21 + i * 3, 40, 2, i % 2 ? 'gi1' : 'gi2')
  r.rect(x - 1, b - 10, 42, 2, 'gi2')
  r.hl(x - 1, b - 8, 42, 'gi3')
  for (const ex of [x + 1, x + 38]) {
    r.vl(ex, b - 22, 22, 'iron')
    r.hl(ex - 1, b - 1, 3, 'iron')
  }
  r.vl(x + 5, b - 7, 7, 'iron'); r.vl(x + 34, b - 7, 7, 'iron')
  r.hl(x - 2, b - 13, 6, 'iron'); r.hl(x + 36, b - 13, 6, 'iron')
}

function morris(r, x0) {
  const b = GROUND
  r.rect(x0, b - 5, 20, 5, 'gi3')
  r.hl(x0, b - 5, 20, 'gi2')
  r.rect(x0 + 1, b - 48, 18, 43, 'gi1')
  r.vl(x0 + 1, b - 48, 43, 'gi2')
  r.rect(x0 + 17, b - 48, 2, 43, 'gi3')
  // affiches
  r.rect(x0 + 3, b - 45, 7, 17, 'awY')
  r.rect(x0 + 4, b - 43, 5, 5, 'red'); r.hl(x0 + 4, b - 36, 5, 'blk'); r.hl(x0 + 4, b - 34, 4, 'blk'); r.hl(x0 + 4, b - 32, 5, 'blk')
  r.rect(x0 + 11, b - 45, 6, 17, 'white')
  r.rect(x0 + 12, b - 43, 4, 7, 'blue'); r.hl(x0 + 12, b - 34, 4, 'red'); r.hl(x0 + 12, b - 32, 3, 'blk')
  r.rect(x0 + 3, b - 26, 14, 18, 'red')
  r.disc(x0 + 10, b - 19, 4, 'yel'); r.hl(x0 + 5, b - 12, 10, 'white'); r.hl(x0 + 6, b - 10, 8, 'white')
  // frise et marquise
  r.rect(x0, b - 52, 20, 4, 'gi3')
  for (let i = x0 + 1; i < x0 + 19; i += 2) r.px(i, b - 50, 'yel')
  r.rect(x0 - 2, b - 55, 24, 3, 'gi2')
  r.hl(x0 - 2, b - 53, 24, 'gi3')
  for (let i = x0 - 2; i < x0 + 22; i += 2) r.px(i, b - 52, 'gi3')
  // dôme à écailles
  r.ell(x0 + 10, b - 55, 10, 10, 'gi1', (x, y) => y < b - 55)
  r.each((x, y, c) => {
    if (c === 'gi1' && y < b - 55 && y > b - 66 && x >= x0 && x < x0 + 20) {
      if ((x + y * 2) % 4 === 0) r.px(x, y, 'gi2')
      if (x > x0 + 14) r.px(x, y, 'gi3')
    }
  })
  r.rect(x0 + 9, b - 69, 2, 4, 'gi3')
  r.px(x0 + 9, b - 70, 'yel'); r.px(x0 + 10, b - 70, 'yel')
}

function wallace(r, x) {
  const b = GROUND
  r.rect(x, b - 5, 14, 5, 'gi3')
  r.hl(x, b - 5, 14, 'gi2')
  r.rect(x + 1, b - 12, 12, 7, 'gi1')
  r.vl(x + 1, b - 12, 7, 'gi2')
  r.rect(x + 2, b - 16, 10, 4, 'gi2')
  r.hl(x + 2, b - 13, 10, 'gi3')
  for (const cx of [x + 3, x + 9]) {
    r.vl(cx, b - 28, 12, 'gi2')
    r.vl(cx + 1, b - 28, 12, 'gi1')
    r.px(cx, b - 25, 'gi3'); r.px(cx + 1, b - 22, 'gi3')
  }
  r.vl(x + 6, b - 27, 11, 'chalk'); r.vl(x + 7, b - 26, 10, 'w2')
  r.rect(x + 1, b - 31, 12, 3, 'gi1')
  r.hl(x + 1, b - 31, 12, 'gi2')
  r.ell(x + 7, b - 31, 6, 6, 'gi1', (px, py) => py < b - 31)
  r.px(x + 4, b - 34, 'gi2'); r.px(x + 6, b - 35, 'gi2'); r.px(x + 9, b - 33, 'gi3'); r.px(x + 10, b - 32, 'gi3')
  r.rect(x + 6, b - 40, 2, 4, 'gi3')
  r.px(x + 6, b - 41, 'gi2')
}

function metro(r, x) {
  const b = GROUND
  for (let y = b - 56; y < b; y++) {
    r.px(x, y, 'gi2')
    r.px(x + 1, y, 'gi3')
  }
  r.rect(x - 2, b - 4, 6, 4, 'gi3')
  r.rect(x - 1, b - 8, 4, 4, 'gi1')
  const sw = textWidth('METRO') + 6
  const sx = x + 1 - Math.floor(sw / 2)
  r.rect(sx, b - 68, sw, 11, 'awR2')
  r.rect(sx + 1, b - 67, sw - 2, 9, 'red')
  text(r, 'METRO', sx + 3, b - 65, 'signW')
  // volutes de fer et globe
  r.px(sx - 1, b - 63, 'gi3'); r.px(sx + sw, b - 63, 'gi3'); r.px(sx - 2, b - 62, 'gi3'); r.px(sx + sw + 1, b - 62, 'gi3')
  r.rect(x - 1, b - 71, 4, 3, 'gi3')
  r.disc(x + 1, b - 76, 4.6, 'lampG')
  r.px(x, b - 78, 'white')
  r.hl(x - 1, b - 81, 4, 'gi3')
}
export const METRO_X = 404

function bouquiniste(r, x, w, open) {
  const top = 228
  if (!open) {
    r.rect(x, top - 12, w, 12, 'gi1')
    r.hl(x, top - 12, w, 'gi2')
    r.hl(x, top - 1, w, 'gi3')
    for (let i = x + 9; i < x + w - 2; i += 10) r.vl(i, top - 11, 10, 'gi3')
    r.px(x + Math.floor(w / 2), top - 6, 'yel')
    r.px(x + Math.floor(w / 2), top - 5, 'yel')
    return
  }
  const rand = rng(x)
  // couvercle levé : il sert de présentoir
  r.rect(x, top - 26, w, 17, 'gi3')
  r.hl(x, top - 26, w, 'gi2')
  r.vl(x, top - 26, 17, 'gi1'); r.vl(x + w - 1, top - 26, 17, 'gi1')
  const prints = ['white', 'awY', 'red', 'blue', 'chalk', 'pink']
  for (let px = x + 2; px < x + w - 5; px += 6) {
    const c = prints[Math.floor(rand() * prints.length)]
    r.rect(px, top - 24, 5, 6, c)
    r.rect(px + 1, top - 23, 3, 2, rand() < 0.5 ? 'blk' : 'gr1')
    const c2 = prints[Math.floor(rand() * prints.length)]
    r.rect(px, top - 16, 5, 6, c2)
    r.hl(px + 1, top - 14, 3, 'blk'); r.hl(px + 1, top - 12, 2, 'blk')
  }
  // la boîte et ses dos de livres
  r.rect(x, top - 9, w, 9, 'gi1')
  r.hl(x, top - 1, w, 'gi3')
  const spines = ['red', 'awY', 'blue', 'white', 'wood2', 'gr1', 'awR2', 'chalk']
  for (let px = x + 1; px < x + w - 1; px++) {
    const c = spines[Math.floor(rand() * spines.length)]
    const hgt = 4 + Math.floor(rand() * 3)
    r.vl(px, top - 3 - hgt, hgt, c)
  }
  r.hl(x, top - 3, w, 'gi2')
}

function planeTree(r) {
  const b = GROUND
  // tronc tacheté du platane
  for (let y = 150; y < b; y++) {
    const lean = Math.round(Math.sin((y - 150) / 34) * 2)
    const wd = 8 + Math.floor((y - 150) / 40)
    const x0 = 444 + lean - Math.floor((wd - 8) / 2)
    for (let i = 0; i < wd; i++) {
      const n = hash(Math.floor((x0 + i) / 3), Math.floor(y / 5), 7)
      let c = i < 2 ? 'tk3' : i >= wd - 2 ? 'tk2' : 'tk1'
      if (n > 0.78 && i >= 1 && i < wd - 2) c = 'tk3'
      if (n < 0.14 && i >= 2) c = 'tk2'
      r.px(x0 + i, y, c)
    }
  }
  // branches
  r.line(447, 152, 430, 132, 'tk2'); r.line(448, 152, 431, 132, 'tk1')
  r.line(451, 150, 466, 126, 'tk2'); r.line(450, 150, 465, 126, 'tk1')
  r.line(448, 148, 446, 118, 'tk2'); r.line(449, 148, 447, 118, 'tk1')
  foliage(
    r,
    [[428, 128, 25], [463, 116, 27], [446, 96, 24], [408, 142, 14], [476, 142, 17], [418, 104, 13]],
    AUTUMN, 99, 5, 3,
  )
  // grille au pied
  r.hl(436, b, 26, 'pv4')
  r.hl(438, b + 1, 22, 'iron')
  for (let i = 439; i < 460; i += 2) r.px(i, b + 2, 'iron')
}

function cafe(r) {
  const w = CAFE_W
  const b = GROUND
  // toit de zinc, lucarne, souche de cheminée
  r.rect(0, 36, w, 24, 'zn1')
  r.hl(0, 36, w - 2, 'zn2')
  for (let x = 5; x < w; x += 7) r.vl(x, 37, 23, 'zn3')
  r.rect(w - 2, 36, 2, 24, 'zn3')
  r.rect(28, 40, 26, 20, 'fs1')
  r.rect(26, 38, 30, 3, 'fsH'); r.hl(26, 41, 30, 'fs3')
  r.rect(32, 44, 18, 16, 'white')
  r.rect(34, 46, 6, 14, 'wB'); r.rect(42, 46, 6, 14, 'wB')
  r.hl(34, 52, 14, 'white')
  r.rect(60, 18, 20, 18, 'brk')
  r.hl(60, 18, 20, 'fs3'); r.hl(60, 19, 20, 'fsH')
  for (let y = 23; y < 36; y += 4) r.hl(60, y, 20, 'awR2')
  for (let i = 0; i < 4; i++) {
    r.rect(62 + i * 5, 11, 3, 7, 'pot')
    r.vl(64 + i * 5, 11, 7, 'brk')
    r.hl(61 + i * 5, 10, 5, 'brk')
  }
  // corniche
  r.rect(0, 60, w + 2, 2, 'fsH')
  r.hl(0, 62, w + 2, 'fs3')
  r.hl(0, 63, w, 'fs2')
  // façade
  r.rect(0, 64, w, 124, 'fs1')
  r.rect(w - 2, 64, 2, 124, 'fs2')
  for (let y = 66; y < 186; y += 12) {
    r.rect(w - 7, y, 7, 6, 'fs2')
    r.hl(w - 7, y, 7, 'fsH')
    r.hl(w - 7, y + 6, 7, 'fs3')
  }
  const floors = [64, 106, 147]
  floors.forEach((fy, fi) => {
    // bandeau d'étage
    if (fi > 0) {
      r.rect(0, fy - 3, w, 2, 'fsH')
      r.hl(0, fy - 1, w, 'fs3')
    }
    for (const wx of [9, 49]) {
      const wy = fy + 5
      const ww = 18
      const wh = 30
      // encadrement et clé
      r.rect(wx - 2, wy - 2, ww + 4, wh + 2, 'fs2')
      r.hl(wx - 3, wy - 3, ww + 6, 'fsH')
      r.rect(wx + ww / 2 - 2, wy - 5, 4, 3, 'fsH'); r.hl(wx + ww / 2 - 2, wy - 2, 4, 'fs3')
      r.rect(wx, wy, ww, wh, 'white')
      const lit = (fi + (wx > 20 ? 1 : 0)) % 3
      const glass = lit === 0 ? 'wA' : lit === 1 ? 'wB' : 'wC'
      for (const [gx, gw] of [[wx + 1, 7], [wx + 10, 7]])
        for (const [gy, gh] of [[wy + 1, 8], [wy + 10, 9], [wy + 20, 9]]) r.rect(gx, gy, gw, gh, glass)
      // rideau
      if (lit !== 1) { r.rect(wx + 1, wy + 1, 2, 28, 'chalk'); r.rect(wx + 15, wy + 1, 2, 28, 'chalk') }
      // garde-corps en fer forgé
      const ry = wy + wh - 9
      r.hl(wx - 2, ry, ww + 4, 'iron')
      r.hl(wx - 2, ry + 8, ww + 4, 'iron')
      for (let x = wx - 2; x < wx + ww + 2; x += 2) r.vl(x, ry, 9, 'iron')
      for (let x = wx - 1; x < wx + ww + 2; x += 4) r.px(x, ry + 4, 'iron')
      // jardinière de géraniums
      if ((fi + (wx > 20 ? 1 : 0)) % 2 === 0) {
        r.rect(wx - 2, ry - 2, ww + 4, 2, 'gr3')
        for (let x = wx - 2; x < wx + ww + 2; x++) {
          const n = hash(x, fi, 3)
          if (n < 0.45) r.px(x, ry - 3, n < 0.2 ? 'red' : 'pink')
          else if (n < 0.75) r.px(x, ry - 3, 'gr2')
          if (n > 0.6) r.px(x, ry - 4, n > 0.85 ? 'red' : 'gr1')
        }
      }
      r.hl(wx - 3, wy + wh, ww + 6, 'fs3')
    }
  })
  // devanture : bandeau, enseigne, auvent
  r.rect(0, 186, w, 12, 'wood3')
  r.hl(0, 186, w, 'wood2')
  text(r, 'VIVA LA VITA', Math.floor((w - textWidth('VIVA LA VITA')) / 2), 190, 'awY')
  r.rect(0, 198, w + 4, 9, 'awR')
  for (let x = 4; x < w + 4; x += 8) r.rect(x, 198, 4, 9, 'white')
  r.hl(0, 198, w + 4, 'awR2')
  for (let x = 0; x < w + 4; x++) {
    const k = x % 8
    const c = x % 8 >= 4 ? 'white' : 'awR'
    r.px(x, 207, c); r.px(x, 208, c)
    if (k % 4 === 1 || k % 4 === 2) r.px(x, 209, c)
  }
  r.hl(0, 210, w, 'wood3')
  // boiseries
  r.rect(0, 211, w, b - 211, 'wood')
  r.rect(w - 2, 211, 2, b - 211, 'wood3')
  // grande vitrine
  r.rect(5, 214, 44, 26, 'wood3')
  r.rect(6, 215, 42, 24, 'cafe')
  r.rect(6, 215, 42, 6, 'cafe2')
  for (const lx of [14, 27, 40]) { r.vl(lx, 215, 4, 'blk'); r.rect(lx - 1, 219, 3, 2, 'lampG') }
  // étagère de bouteilles, silhouettes attablées
  r.hl(8, 228, 16, 'wood3')
  for (let x = 9; x < 23; x += 2) r.vl(x, 224 + (x % 3), 4 - (x % 3), ['gr3', 'awR2', 'wood2'][x % 3])
  r.rect(31, 229, 4, 5, 'wood3'); r.rect(30, 234, 6, 5, 'wood3'); r.rect(40, 230, 4, 4, 'wood3'); r.rect(39, 234, 6, 5, 'wood3')
  r.vl(20, 215, 24, 'wood3'); r.vl(34, 215, 24, 'wood3')
  r.rect(5, 241, 44, 9, 'wood2')
  r.rect(7, 243, 18, 5, 'wood'); r.rect(29, 243, 18, 5, 'wood')
  // porte vitrée
  r.rect(54, 213, 24, b - 213, 'wood3')
  r.rect(56, 215, 20, 24, 'cafe')
  r.rect(56, 215, 20, 5, 'cafe2')
  r.vl(66, 215, 24, 'wood3')
  r.rect(56, 241, 9, 9, 'wood2'); r.rect(67, 241, 9, 9, 'wood2')
  r.px(64, 232, 'yel'); r.px(64, 233, 'yel'); r.px(67, 232, 'yel'); r.px(67, 233, 'yel')
  // lanterne d'applique
  r.rect(80, 214, 3, 5, 'lampG'); r.hl(79, 213, 5, 'iron'); r.hl(80, 219, 3, 'iron')
  r.hl(0, b - 1, w, 'wood3')
}

function bike(r, x) {
  const y = GROUND - 15
  for (const cx of [5, 18])
    for (let j = -6; j <= 6; j++)
      for (let i = -6; i <= 6; i++) {
        const d = Math.hypot(i, j)
        if (d >= 4.3 && d <= 5.4) r.px(x + cx + i, y + 9 + j, 'iron')
      }
  const fr = 'awB'
  r.line(x + 8, y + 3, x + 11, y + 9, fr); r.line(x + 8, y + 4, x + 16, y + 4, fr); r.line(x + 16, y + 4, x + 11, y + 9, fr)
  r.line(x + 11, y + 9, x + 5, y + 9, fr); r.line(x + 8, y + 4, x + 5, y + 9, fr)
  r.line(x + 17, y + 2, x + 18, y + 9, 'iron')
  r.hl(x + 15, y + 1, 4, 'iron'); r.hl(x + 6, y + 2, 4, 'blk')
  r.px(x + 5, y + 9, 'pv3'); r.px(x + 18, y + 9, 'pv3')
  // panier d'osier et sa baguette
  r.rect(x + 19, y + 2, 5, 4, 'wood2')
  r.px(x + 20, y + 3, 'awY'); r.px(x + 22, y + 3, 'awY'); r.px(x + 21, y + 4, 'awY'); r.px(x + 23, y + 4, 'awY')
  r.line(x + 20, y + 2, x + 23, y - 3, 'awY')
  r.px(x + 21, y, 'wood2'); r.px(x + 22, y - 2, 'wood2')
}

function cat(r, x, y) {
  r.spr(['.k..k.', '.kkkk.', '.ykyk.', '..kkk.', '.kkkkk', '.kkkkk', 'kkkkkk'], x, y, { k: 'blk', y: 'yel' })
}

function terrace(r) {
  const b = GROUND
  const table = x => {
    r.hl(x - 5, b - 13, 11, 'white')
    r.hl(x - 5, b - 12, 11, 'pv4')
    r.vl(x, b - 11, 10, 'iron')
    r.hl(x - 3, b - 1, 7, 'iron')
    // tasse et carafe
    r.px(x - 2, b - 14, 'white'); r.px(x - 3, b - 14, 'white')
    r.vl(x + 2, b - 16, 3, 'w2')
  }
  const chair = (x, dir) => {
    r.vl(x, b - 21, 12, 'awY')
    r.vl(x + dir, b - 21, 3, 'wood2')
    r.px(x, b - 22, 'wood2')
    r.rect(Math.min(x, x + dir * 6), b - 9, 7, 2, 'awY')
    r.hl(Math.min(x, x + dir * 6), b - 8, 7, 'wood2')
    r.vl(x, b - 7, 7, 'wood2')
    r.vl(x + dir * 6, b - 7, 7, 'wood2')
    for (let y = b - 20; y < b - 10; y += 2) r.px(x, y, 'wood2')
  }
  chair(8, 1); table(21); chair(34, -1)
  chair(39, 1); table(51);
  // ardoise du jour
  r.rect(86, b - 17, 11, 15, 'blk')
  r.hl(86, b - 17, 11, 'wood2'); r.vl(86, b - 17, 17, 'wood2'); r.vl(96, b - 17, 17, 'wood2')
  r.hl(88, b - 14, 7, 'chalk'); r.hl(88, b - 11, 5, 'chalk'); r.hl(88, b - 9, 6, 'chalk'); r.hl(88, b - 6, 4, 'awY')
}

// L'horloge de rue : le cadran est dessiné ici, les aiguilles tournent à part
// (dessin/build.mjs), autour de ce centre, et le mod les met à l'heure du poste.
export const CLOCK = { x: 345.5, y: 203.5 }
function streetClock(r) {
  const b = GROUND
  const x = Math.floor(CLOCK.x)
  r.rect(x - 3, b - 2, 8, 2, 'gi3')
  r.rect(x - 2, b - 8, 6, 6, 'gi1')
  r.vl(x - 2, b - 8, 6, 'gi2')
  for (let y = CLOCK.y + 9; y < b - 8; y++) {
    r.px(x, y, 'gi2')
    r.px(x + 1, y, 'gi3')
  }
  r.rect(x - 1, CLOCK.y - 12, 3, 3, 'gi3')
  r.px(x, CLOCK.y - 13, 'yel')
  r.disc(CLOCK.x, CLOCK.y, 9.6, 'gi3')
  r.disc(CLOCK.x, CLOCK.y, 8.6, 'gi2')
  r.disc(CLOCK.x, CLOCK.y, 7.4, 'lampG')
  // les quatre repères : midi, trois heures, six heures, neuf heures
  r.px(x, CLOCK.y - 7, 'iron'); r.px(x, CLOCK.y + 6, 'iron'); r.px(x - 7, CLOCK.y, 'iron'); r.px(x + 6, CLOCK.y, 'iron')
}

export function front() {
  const r = R()
  const rand = rng(2024)
  // parapet du quai : margelle et pierres
  const py = 228
  r.hl(CAFE_W, py, W - CAFE_W, 'fsH')
  r.rect(CAFE_W, py + 1, W - CAFE_W, 3, 'q1')
  r.hl(CAFE_W, py + 4, W - CAFE_W, 'q4')
  r.rect(CAFE_W, py + 5, W - CAFE_W, GROUND - 2 - py - 5, 'q2')
  for (const [jy, off] of [[py + 5, 0], [py + 11, 12], [py + 17, 0]]) {
    r.hl(CAFE_W, jy + 5, W - CAFE_W, 'q3')
    for (let x = CAFE_W + off; x < W; x += 24) r.vl(x, jy, 5, 'q3')
  }
  for (let i = 0; i < 16; i++) {
    const bx = CAFE_W + 1 + Math.floor(rand() * 16) * 24 + (i % 2 ? 12 : 0)
    const by = py + 5 + (i % 3) * 6 + (i % 2 && i % 3 !== 1 ? 0 : 0)
    if (bx + 23 < W && r.get(bx, by) === 'q2' && r.get(bx + 22, by) === 'q2') r.rect(bx, by, 23, 5, i % 4 === 0 ? 'q3' : 'q1')
  }
  for (let i = 0; i < 40; i++) r.px(CAFE_W + Math.floor(rand() * (W - CAFE_W)), GROUND - 3, 'moss')
  r.hl(CAFE_W, GROUND - 2, W - CAFE_W, 'q4')
  // trottoir
  r.rect(0, GROUND - 2, CAFE_W, 2, 'pv2')
  r.rect(0, GROUND, W, H - GROUND, 'pv1')
  r.hl(0, GROUND, W, 'pv2')
  r.hl(0, GROUND + 7, W, 'pv2')
  for (let x = 14; x < W; x += 32) {
    r.vl(x, GROUND + 1, 6, 'pv2')
    r.vl(x + 16, GROUND + 8, 6, 'pv2')
  }
  r.hl(0, GROUND + 14, W, 'pv3')
  r.rect(0, GROUND + 15, W, 3, 'pv4')
  for (let x = 30; x < W; x += 44) r.vl(x, GROUND + 15, 3, 'pv2')
  // feuilles tombées
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(rand() * W)
    const y = GROUND + 1 + Math.floor(rand() * 13)
    const near = 1 - Math.min(1, Math.abs(x - 446) / 260)
    if (rand() > 0.25 + near * 0.75) continue
    const c = ['lf1', 'lf2', 'lf3'][Math.floor(rand() * 3)]
    r.px(x, y, c)
    if (rand() < 0.6) r.px(x + 1, y, c)
  }
  // plaque de rue émaillée
  const pw = textWidth('QUAI DE SEINE') + 6
  r.rect(132, 236, pw, 11, 'gi1')
  r.rect(133, 237, pw - 2, 9, 'blue')
  text(r, 'QUAI DE SEINE', 135, 239, 'signW')
  bouquiniste(r, 124, 28, false)
  bouquiniste(r, 154, 34, true)
  bouquiniste(r, 456, 24, false)
  LAMPS.forEach(x => lamp(r, x))
  morris(r, 196)
  bike(r, 217)
  bench(r, 258)
  wallace(r, 318)
  streetClock(r)
  metro(r, METRO_X)
  planeTree(r)
  cafe(r)
  cat(r, 53, 147 + 5 + 21 - 7)
  terrace(r)
  return r
}

// Lumières de la nuit, premier plan.
export function frontNight() {
  const r = R()
  for (const x of LAMPS) {
    const g = lampGlow(x)
    r.disc(g.x, g.y, 20, 'halo')
    r.disc(g.x, g.y, 11, 'halo2')
    r.ell(x, GROUND + 6, 30, 6, 'pool')
    r.ell(x, GROUND + 6, 16, 3.4, 'pool')
  }
  r.disc(METRO_X + 1, GROUND - 76, 12, 'halo')
  r.disc(METRO_X + 1, GROUND - 76, 7, 'halo2')
  r.disc(CLOCK.x, CLOCK.y, 14, 'halo')
  // la lumière du café s'étale sur le trottoir
  for (let y = GROUND; y < GROUND + 14; y++) r.hl(2, y, 82 + (y - GROUND) * 2, 'pool')
  r.disc(81.5, 216, 9, 'halo')
  return r
}

// ---------------------------------------------------------------- petits acteurs
export function pigeon(frame) {
  const r = new Raster(PAL, 11, 8)
  const L = { a: 'pg1', b: 'pg2', c: 'pg3', k: 'blk', p: 'pink', y: 'awY' }
  const up = [
    '.......bb..',
    '......bbkb.',
    '..aaaabbbyy',
    '.caaaaabb..',
    'ccaaaaaa...',
    '.cc.aaaa...',
    '.....p.p...',
    '....pp.pp..',
  ]
  const down = [
    '...........',
    '...........',
    '..aaaaa....',
    '.caaaaabb..',
    'ccaaaaabbb.',
    '.cc.aaabkb.',
    '.....p.pby.',
    '....pp.ppy.',
  ]
  r.spr(frame ? down : up, 0, 0, L)
  return r
}
export function leaf(i) {
  const r = new Raster(PAL, 3, 2)
  const c = ['lf1', 'lf2', 'lf3'][i % 3]
  r.px(0, 0, c); r.px(1, 0, c); r.px(1, 1, c)
  if (i % 2) r.px(2, 1, c)
  return r
}
export function smoke() {
  const r = new Raster(PAL, 7, 5)
  r.hl(2, 0, 3, 'smoke'); r.hl(1, 1, 5, 'smoke'); r.hl(0, 2, 7, 'smoke'); r.hl(1, 3, 5, 'smoke'); r.hl(2, 4, 2, 'smoke')
  return r
}
