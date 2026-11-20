// Le chat : un chartreux gris-bleu aux yeux ambre, tête ronde et queue épaisse.
import { Raster } from './engine.mjs'
import { PAL } from './palette.mjs'

const L = { o: 'cO', G: 'cG', L: 'cL', D: 'cD', E: 'cE', K: 'cK', P: 'cP' }

export const CAT_W = 30
export const CAT_H = 22

// Tête de trois quarts, tournée vers la droite.
const HEAD = [
  '.oo.....oo...',
  'oDGo...oGDo..',
  'oDGGoooGGDo..',
  'oGGLLLLLLGGo.',
  'oGLLLLLLLLGo.',
  'oLEELLLEELGo.',
  'oLEKLLLEKLGo.',
  'oGLLLPKLLLGo.',
  '.oGLLLLLLGo..',
  '..oGGGGGGo...',
  '...oooooo....',
]
const BODY = [
  '...oooooooooo...',
  '.ooGGGGGGGGGGo..',
  'oGGGLLLLLLLGGGo.',
  'oGGLLLLLLLLLGGo.',
  'oGGLLLLLLLLLGGo.',
  'oGGGLLLLLLLGGGo.',
  'oDGGGGGGGGGGGGo.',
  '.oDDGGGGGGGGDo..',
  '..oooooooooooo..',
]
// La queue dressée, signe d'un chat content ; sa pointe ondule.
const TAIL = [
  '..ooo..',
  '.oLGGo.',
  '.oGGGo.',
  '..oGGo.',
  '..oGGo.',
  '.oGGGo.',
  '.oGGo..',
  'oGGGo..',
  'oGGGo..',
  '.oGGGo.',
  '..oGGGo',
]
const TAIL2 = [
  '.ooo...',
  'oLGGo..',
  'oGGGo..',
  '.oGGo..',
  '..oGGo.',
  '.oGGGo.',
  '.oGGo..',
  'oGGGo..',
  'oGGGo..',
  '.oGGGo.',
  '..oGGGo',
]

function leg(r, x, shift, lift, near) {
  const top = 14
  const bottom = 20 - lift
  const fill = near ? ['cG', 'cL', 'cG'] : ['cD', 'cD', 'cD']
  for (let y = top; y < bottom; y++) {
    const t = Math.max(0, (y - 15) / (bottom - 15))
    const xx = x + Math.round(shift * t)
    r.px(xx - 1, y, 'cO')
    fill.forEach((c, i) => r.px(xx + i, y, c))
    r.px(xx + 3, y, 'cO')
  }
  const xx = x + shift
  r.px(xx - 1, bottom - 1, 'cO')
  r.px(xx + 3, bottom - 1, near ? 'cL' : 'cD')
  r.px(xx + 4, bottom - 1, 'cO')
  r.hl(xx, bottom, 4, 'cO')
}

// Pattes : [décalage, levée] pour l'avant et l'arrière, côté proche (n) et côté loin (f).
const WALK = [
  { nf: [3, 0], nr: [-2, 0], ff: [-2, 0], fr: [2, 0] },
  { nf: [0, 0], nr: [0, 0], ff: [1, 1], fr: [0, 1] },
  { nf: [-2, 0], nr: [2, 0], ff: [3, 0], fr: [-2, 0] },
  { nf: [1, 1], nr: [0, 1], ff: [0, 0], fr: [0, 0] },
]
// Le galop : allongé, puis ramassé.
const RUN = [
  { nf: [5, 0], nr: [-5, 0], ff: [4, 1], fr: [-4, 1] },
  { nf: [-3, 2], nr: [3, 2], ff: [-2, 2], fr: [2, 2] },
]
const STAND = { nf: [0, 0], nr: [0, 0], ff: [0, 0], fr: [0, 0] }

function legs(s) {
  const r = new Raster(PAL, CAT_W, CAT_H)
  leg(r, 17, s.ff[0], s.ff[1], false)
  leg(r, 9, s.fr[0], s.fr[1], false)
  leg(r, 7, s.nr[0], s.nr[1], true)
  leg(r, 19, s.nf[0], s.nf[1], true)
  return r
}
export const catWalkLegs = i => legs(WALK[i])
export const catRunLegs = i => legs(RUN[i])
export const catStandLegs = () => legs(STAND)

export function catTail(i) {
  const r = new Raster(PAL, CAT_W, CAT_H)
  r.spr(i ? TAIL2 : TAIL, 0, 0, L)
  return r
}
export function catBase() {
  const r = new Raster(PAL, CAT_W, CAT_H)
  r.spr(BODY, 5, 7, L)
  r.spr(HEAD, 17, 1, L)
  return r
}

// Assis de face : moitié gauche, l'autre en miroir.
const SIT_HALF = [
  '.oo......',
  'oDGo.....',
  'oDGGooooo',
  'oGGLLLLLL',
  'oGLLLLLLL',
  'oLLEELLLL',
  'oLLKELLLL',
  'oGLLLLLLP',
  '.oGLLLLLL',
  '..oGGGGGG',
  '..oGLLLLL',
  '.oGGLLLLL',
  '.oGGLLLLL',
  '.oGGLLLLL',
  'oGGGLLoLL',
  'oGGGLLoLL',
  'oDGGLLoLL',
  '.ooooo.oo',
]
export const CAT_SIT_W = 26
export const CAT_SIT_H = 18
export function catSit() {
  const r = new Raster(PAL, CAT_SIT_W, CAT_SIT_H)
  r.spr(SIT_HALF.map(h => h + [...h].reverse().join('')), 0, 0, L)
  // le bout du nez
  r.px(8, 7, 'cP'); r.px(9, 7, 'cK')
  return r
}
// La queue, enroulée autour des pattes, dont le bout bat.
export function catSitTail(i) {
  const r = new Raster(PAL, CAT_SIT_W, CAT_SIT_H)
  const tail = i
    ? ['....oo.', '...oGLo', '...oGGo', '..oGGo.', '.oGGGo.', 'oGGGo..', '.ooo...']
    : ['.......', '.....oo', '...ooLo', '..oGGGo', '.oGGGo.', 'oGGGo..', '.ooo...']
  r.spr(tail, 17, 11, L)
  return r
}

export function heart() {
  const r = new Raster(PAL, 7, 6)
  r.spr(['.rr.rr.', 'rpRrRRr', 'rRRRRRr', '.rRRRr.', '..rRr..', '...r...'], 0, 0, { r: 'awR2', R: 'red', p: 'pink' })
  return r
}
