// Le Morkie : pelage crème, oreilles caramel tombantes, tête ronde frisée.
import { Raster } from './engine.mjs'
import { PAL } from './palette.mjs'

const L = {
  o: 'dO', W: 'dW', C: 'dC', c: 'dc', s: 'ds', E: 'dE', e: 'de', D: 'dD',
  K: 'dK', G: 'dG', P: 'dP', B: 'dB', S: 'dS',
}

export const DOG_W = 34
export const DOG_H = 28

// Tête de trois quarts, tournée vers la droite.
const HEAD = [
  '......oo.ooo.....',
  '...oooWWoWWWoo...',
  '..oWWWCWWWWCWWo..',
  '.oWWCWWWWWWWWWWo.',
  '.oWWWWWCWWWWWCWo.',
  'oEEoWWWWWWWWWWWoo',
  'oEEEoCWWWWWWWCWoE',
  'oEeEoWWGKWWWGKWoE',
  'oDEEoWWKKWWWKKWoD',
  'oDEeEoCWWWWWWWCo.',
  'oDEEEoWWWWKKKWWo.',
  '.oDEEoCWWWKKKWCo.',
  '.oDEEocWWcWKWcWo.',
  '..oDEoocWWcccWo..',
  '..oDo..ooCCCoo...',
  '...o.....ooo.....',
]
const BODY = [
  '....ooooooooooo......',
  '..ooCCWWWWWWWCCoo....',
  '.oCCWWWWWWWWWWWCCo...',
  '.oCWWWWWWWWWWWWWCCo..',
  'oCCWWWWWWWWWWWWWWCCo.',
  'oCWWWWWWCWWWWWWWWWCo.',
  'oCWWWCWWWWWWWCWWWWCCo',
  'ocCWWWWWWWWWWWWWWWCCo',
  'ocCCWWWWWWCWWWWWWCCco',
  '.occCCWWWWWWWWWCCCco.',
  '..ooccCCCCCCCCCccoo..',
]
const TAIL = [
  '...ooo..',
  '..oWWCo.',
  '.oWWCCo.',
  'oWWCCco.',
  'oWCCco..',
  'oCCEco..',
  '.oCEEo..',
  '.ocCEeo.',
  '..occCCo',
  '...ooooo',
]
const TAIL2 = [
  '....ooo.',
  '...oWWCo',
  '..oWWCCo',
  '.oWWCCco',
  '.oWCCco.',
  'oCCCEo..',
  'oCCEEo..',
  '.ocCEeo.',
  '..occCCo',
  '...ooooo',
]

function leg(r, x, shift, lift, near) {
  const top = 17
  const bottom = 26 - lift
  const fill = near ? ['dC', 'dW', 'dW', 'dC'] : ['dc', 'dc', 'dc', 'ds']
  for (let y = top; y < bottom; y++) {
    const t = Math.max(0, (y - 19) / (bottom - 19))
    const xx = x + Math.round(shift * t)
    r.px(xx - 1, y, 'dO')
    fill.forEach((c, i) => r.px(xx + i, y, c))
    r.px(xx + 4, y, 'dO')
  }
  const xx = x + shift
  // la patte, un peu plus large vers l'avant
  r.px(xx - 1, bottom - 1, 'dO')
  r.px(xx + 4, bottom - 1, near ? 'dW' : 'dc')
  r.px(xx + 5, bottom - 1, 'dO')
  r.hl(xx, bottom, 5, 'dO')
}

// Les quatre poses de pattes du trot.
const STEPS = [
  { nf: [3, 0], nr: [-2, 0], ff: [-3, 0], fr: [2, 0] },
  { nf: [0, 0], nr: [0, 0], ff: [1, 2], fr: [0, 1] },
  { nf: [-3, 0], nr: [2, 0], ff: [3, 0], fr: [-2, 0] },
  { nf: [1, 2], nr: [0, 1], ff: [0, 0], fr: [0, 0] },
]
// Le galop : allongé, puis ramassé.
const RUN = [
  { nf: [5, 0], nr: [-5, 0], ff: [4, 1], fr: [-4, 1] },
  { nf: [-3, 2], nr: [3, 2], ff: [-2, 2], fr: [2, 2] },
]
const STAND = { nf: [0, 0], nr: [0, 0], ff: [0, 0], fr: [0, 0] }

function legs(s) {
  const r = new Raster(PAL, DOG_W, DOG_H)
  leg(r, 18, s.ff[0], s.ff[1], false)
  leg(r, 9, s.fr[0], s.fr[1], false)
  leg(r, 6, s.nr[0], s.nr[1], true)
  leg(r, 21, s.nf[0], s.nf[1], true)
  return r
}
export const legsFrame = i => legs(STEPS[i])
export const dogRunLegs = i => legs(RUN[i])
export const dogStandLegs = () => legs(STAND)

// Corps, queue et tête : commun aux quatre poses.
export function dogTail(i) {
  const r = new Raster(PAL, DOG_W, DOG_H)
  r.spr(i ? TAIL2 : TAIL, 0, 3, L)
  return r
}
export function dogBase() {
  const r = new Raster(PAL, DOG_W, DOG_H)
  r.spr(BODY, 3, 9, L)
  r.spr(HEAD, 16, 0, L)
  // collier noir et son petit boîtier
  r.hl(19, 15, 4, 'dB')
  r.px(22, 16, 'dB')
  r.px(23, 16, 'dS')
  return r
}

// Assis de face, comme sur la photo : moitié gauche, l'autre en miroir.
const SIT_HALF = [
  '......ooooo',
  '....ooWWWWW',
  '...oWWWCWWW',
  '..oWWCWWWWW',
  '.ooWWWWWWCW',
  'oeEoWWWWWWW',
  'oEEeoCWWWWW',
  'oEEEoWcKKWW',
  'oDEEoWWKKWC',
  'oDEEeoCWWWW',
  'oDEEEoWWWWK',
  '.oDEEoCWWWK',
  '.oDEEoocWcW',
  '..oDEo.ocWc',
  '..ooo..oBBB',
  '.....ooCCBB',
  '....oCCWWWW',
  '...oCCWWWWW',
  '...oCWWWWWW',
  '...oCWWWCWW',
  '..oCCWWWWWW',
  '..oCCWWcWWW',
  '..ocCWWcWWW',
  '..ocCCWoWWW',
  '...oCCWoWWW',
  '...oWWWoWWW',
  '....ooo.ooo',
]
export const SIT_W = 22
export const SIT_H = 28
// la queue dépasse à gauche et remue
export function sitTail(wag) {
  const r = new Raster(PAL, SIT_W + 6, SIT_H)
  const tail = wag
    ? ['.oo...', 'oWCo..', 'oWCCo.', '.oCEo.', '..oEco', '...oo.']
    : ['..oo..', '.oWWo.', 'oWCCo.', 'oCCEo.', '.oEEco', '..ooo.']
  r.spr(tail, 0, wag ? 19 : 18, L)
  return r
}
export function dogSit() {
  const r = new Raster(PAL, SIT_W + 6, SIT_H)
  const ox = 4
  const rows = SIT_HALF.map(h => h + [...h].reverse().join(''))
  r.spr(rows, ox, 1, L)
  // reflets des yeux, du même côté
  r.px(ox + 7, 8, 'dG')
  r.px(ox + 13, 8, 'dG')
  // le boîtier du collier, au milieu
  r.px(ox + 10, 16, 'dS')
  r.px(ox + 11, 16, 'dS')
  // la langue
  r.px(ox + 10, 14, 'dP')
  r.px(ox + 11, 14, 'dP')
  return r
}

export function dogShadow(w = 26) {
  const r = new Raster(PAL, w, 3)
  r.hl(2, 0, w - 4, 'shadow')
  r.hl(0, 1, w, 'shadow')
  r.hl(2, 2, w - 4, 'shadow')
  return r
}
