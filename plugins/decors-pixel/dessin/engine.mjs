// Petit moteur de pixel art : une grille de couleurs nommées, un encodeur SVG
// compact (un chemin par couleur) et un export PNG pour relire le dessin.
import zlib from 'node:zlib'
import fs from 'node:fs'

// Palette : nom -> [jour, nuit, opacité?]. L'ordre fixe l'indice et la classe CSS.
export class Palette {
  constructor(defs) {
    this.names = Object.keys(defs)
    this.defs = defs
    this.index = new Map(this.names.map((n, i) => [n, i]))
  }
  id(name) {
    const i = this.index.get(name)
    if (i === undefined) throw new Error(`couleur inconnue : ${name}`)
    return i
  }
  cls(i) {
    return 'k' + i.toString(36)
  }
  css(mode) {
    const col = mode === 'n' ? 1 : 0
    let out = ''
    this.names.forEach((n, i) => {
      const d = this.defs[n]
      if (mode === 'n' && d[1] === d[0]) return
      out += `.${this.cls(i)}{color:${d[col]}}`
    })
    return out
  }
  cssOpacity() {
    let out = ''
    this.names.forEach((n, i) => {
      const d = this.defs[n]
      if (d[2] !== undefined) out += `.${this.cls(i)}{opacity:${d[2]}}`
    })
    return out
  }
}

export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Raster {
  constructor(pal, w, h) {
    this.pal = pal
    this.w = w
    this.h = h
    this.d = new Int16Array(w * h).fill(-1)
  }
  px(x, y, c) {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.d[y * this.w + x] = c === null ? -1 : this.pal.id(c)
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null
    const v = this.d[y * this.w + x]
    return v < 0 ? null : this.pal.names[v]
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c)
  }
  hl(x, y, w, c) {
    this.rect(x, y, w, 1, c)
  }
  vl(x, y, h, c) {
    this.rect(x, y, 1, h, c)
  }
  // Ellipse pleine, centre au demi-pixel possible.
  ell(cx, cy, rx, ry, c, test) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx
        const dy = (y + 0.5 - cy) / ry
        if (dx * dx + dy * dy <= 1 && (!test || test(x, y))) this.px(x, y, c)
      }
  }
  disc(cx, cy, r, c, test) {
    this.ell(cx, cy, r, r, c, test)
  }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n
      this.px(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c)
    }
  }
  // Dessin à partir de lignes de texte ; legend : caractère -> couleur.
  spr(lines, x, y, legend, flip = false) {
    lines.forEach((row, j) => {
      const w = row.length
      for (let i = 0; i < w; i++) {
        const ch = row[flip ? w - 1 - i : i]
        if (ch === '.' || ch === ' ') continue
        const c = legend[ch]
        if (c === undefined) throw new Error(`caractère sans couleur : "${ch}"`)
        this.px(x + i, y + j, c)
      }
    })
  }
  blit(src, x, y) {
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const v = src.d[j * src.w + i]
        if (v >= 0) this.px(x + i, y + j, src.pal.names[v])
      }
  }
  // Remplace une couleur là où le test passe.
  each(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(x, y, this.get(x, y))
  }
  count() {
    let n = 0
    for (const v of this.d) if (v >= 0) n++
    return n
  }
}

const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '111101101101111', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', ' ': '000000000000000',
}
// Texte en police 3x5 ; « É » pose un accent au-dessus du E.
export function text(r, str, x, y, c) {
  let cx = x
  for (const ch of str) {
    const base = ch === 'É' ? 'E' : ch
    const g = FONT[base]
    if (!g) throw new Error(`lettre absente : ${ch}`)
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') r.px(cx + i, y + j, c)
    if (ch === 'É') {
      r.px(cx + 1, y - 2, c)
      r.px(cx + 2, y - 3, c)
    }
    cx += ch === ' ' ? 3 : 4
  }
  return cx - x - 1
}
export function textWidth(str) {
  let w = 0
  for (const ch of str) w += ch === ' ' ? 3 : 4
  return w - 1
}

// --- Encodage SVG ---------------------------------------------------------
// Par couleur : des rectangles hauts (chemin rempli) et des traits d'un pixel
// (chemin tracé, plus court à écrire). Tout est en déplacements relatifs.
function rectsOf(r, ci) {
  const open = new Map()
  const out = []
  for (let y = 0; y <= r.h; y++) {
    const seen = new Set()
    if (y < r.h) {
      let x = 0
      while (x < r.w) {
        if (r.d[y * r.w + x] !== ci) {
          x++
          continue
        }
        let x1 = x
        while (x1 < r.w && r.d[y * r.w + x1] === ci) x1++
        const key = x + ':' + (x1 - x)
        seen.add(key)
        if (open.has(key)) open.get(key).h++
        else open.set(key, { x, y, w: x1 - x, h: 1 })
        x = x1
      }
    }
    for (const [key, rc] of open)
      if (!seen.has(key)) {
        out.push(rc)
        open.delete(key)
      }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}
const num = v => (Object.is(v, -0) ? '0' : String(v))
const pair = (a, b) => num(a) + (b < 0 ? '' : ' ') + num(b)

export function encode(r, ox = 0, oy = 0) {
  let out = ''
  let rects = 0
  for (let ci = 0; ci < r.pal.names.length; ci++) {
    const all = rectsOf(r, ci)
    if (!all.length) continue
    rects += all.length
    const fills = all.filter(q => q.h > 1)
    const lines = all.filter(q => q.h === 1)
    const k = r.pal.cls(ci)
    if (fills.length) {
      let d = ''
      let px = 0
      let py = 0
      fills.forEach((q, i) => {
        const x = q.x + ox
        const y = q.y + oy
        d += i === 0 ? `M${pair(x, y)}` : `m${pair(x - px, y - py)}`
        d += `h${q.w}v${q.h}h-${q.w}z`
        px = x
        py = y
      })
      out += `<path class="${k}" d="${d}"/>`
    }
    if (lines.length) {
      let d = ''
      let px = 0
      let py = 0
      lines.forEach((q, i) => {
        const x = q.x + ox
        const y = q.y + oy
        d += i === 0 ? `M${num(x)} ${num(y)}.5` : `m${pair(x - px, y - py)}`
        d += `h${q.w}`
        px = x + q.w
        py = y
      })
      out += `<path class="${k} s" d="${d}"/>`
    }
  }
  return { svg: out, rects }
}

// --- PNG de relecture -----------------------------------------------------
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

// layers : [{ r, x, y, only?: 'd' | 'n', alpha? }], peints dans l'ordre.
export function composite(pal, w, h, layers, mode) {
  const buf = new Float32Array(w * h * 3)
  const col = mode === 'n' ? 1 : 0
  const rgb = pal.names.map(n => hex(pal.defs[n][col]))
  const op = pal.names.map(n => pal.defs[n][2] ?? 1)
  for (const L of layers) {
    if (L.only && L.only !== mode) continue
    const { r } = L
    for (let j = 0; j < r.h; j++)
      for (let i = 0; i < r.w; i++) {
        const v = r.d[j * r.w + i]
        if (v < 0) continue
        const X = i + (L.x ?? 0)
        const Y = j + (L.y ?? 0)
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue
        const a = op[v] * (L.alpha ?? 1)
        const o = (Y * w + X) * 3
        for (let c = 0; c < 3; c++) buf[o + c] = buf[o + c] * (1 - a) + rgb[v][c] * a
      }
  }
  return buf
}

export function writePng(file, buf, w, h, scale = 1, crop) {
  const c = crop ?? { x: 0, y: 0, w, h }
  const W = c.w * scale
  const H = c.h * scale
  const raw = Buffer.alloc((W * 3 + 1) * H)
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1)
    raw[row] = 0
    const sy = c.y + Math.floor(y / scale)
    for (let x = 0; x < W; x++) {
      const sx = c.x + Math.floor(x / scale)
      const o = (sy * w + sx) * 3
      raw[row + 1 + x * 3] = buf[o]
      raw[row + 2 + x * 3] = buf[o + 1]
      raw[row + 3 + x * 3] = buf[o + 2]
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}
