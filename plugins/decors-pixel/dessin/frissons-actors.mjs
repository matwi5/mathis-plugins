// Les acteurs de « Frissons 80 » : quatre enfants à vélo, lampes allumées, et la
// bête des bois qui sort de la faille. Dessins originaux : des gamins et des vélos
// de l'époque, une créature de légende à crâne de cerf.
import { Raster } from './engine.mjs'
import { FPAL as PAL } from './frissons-palette.mjs'
import { limb } from './frissons-scene.mjs'

// ---------------------------------------------------------------- les enfants
export const KID = { w: 22, h: 26, gap: 20 }
const BEAM = 50
export const CONVOY = { w: KID.gap * 3 + KID.w + BEAM, h: KID.h, kids: KID.gap * 3 + KID.w }

// Le buste et la tête, tournés vers la droite ; h cheveux, s peau, k œil, j veste, b sac, a bras.
const BODY = [
  '..........hhhh........',
  '.........hhhhhh.......',
  '.........hhssss.......',
  '.........hssksss......',
  '..........ssss........',
  '.........jjjj.........',
  '........jjjjjj........',
  '.......bjjjjjjj.......',
  '......bbjjjjjajj......',
  '......bbjjjj..ajs.....',
  '.......jjjjj..........',
  '.......ppppp..........',
]
// Les têtes : casquette, cheveux frisés, cheveux longs au vent, coupe au bol.
const HEADS = {
  cap: ['..........cccc........', '.........ccccccCC.....', '.........hhssss.......', '.........hssksss......'],
  curly: ['.........hhhhhh.......', '........hhhhhhhh......', '........hhhssss.......', '........hhssksss......'],
  long: ['..........hhhh........', '.........hhhhhh.......', '........hhhssss.......', '......hhhhssksss......', '.....hhh..ssss........', '....hh...jjjj.........'],
  bowl: ['..........hhhh........', '.........hhhhhh.......', '.........hhhhss.......', '.........hssksss......'],
}
export const KIDS = [
  { head: 'cap', hair: 'hBr', skin: 'sk1', jacket: 'jB', pack: 'pack2', bike: 'fR', light: false },
  { head: 'curly', hair: 'hBk', skin: 'sk2', jacket: 'jG', pack: 'pack', bike: 'fB', light: true },
  { head: 'long', hair: 'hRd', skin: 'sk1', jacket: 'jD', pack: 'pack2', bike: 'fP', light: false },
  { head: 'bowl', hair: 'hBl', skin: 'sk1', jacket: 'jY', pack: 'pack', bike: 'fY', light: true },
]

const HUBS = [5, 16]
const HUB_Y = 21

function wheels(r, ox, frame) {
  for (const hx of HUBS) {
    for (let j = -5; j <= 5; j++)
      for (let i = -5; i <= 5; i++) {
        const d = Math.hypot(i, j)
        if (d >= 3.4 && d <= 4.5) r.px(ox + hx + i, HUB_Y + j, 'tyre')
      }
    // les rayons tournent : en croix, puis en diagonale
    for (let k = 1; k <= 2; k++) {
      if (frame) { r.px(ox + hx + k, HUB_Y + k, 'spoke'); r.px(ox + hx - k, HUB_Y - k, 'spoke'); r.px(ox + hx + k, HUB_Y - k, 'spoke'); r.px(ox + hx - k, HUB_Y + k, 'spoke') }
      else { r.px(ox + hx + k + 1, HUB_Y, 'spoke'); r.px(ox + hx - k - 1, HUB_Y, 'spoke'); r.px(ox + hx, HUB_Y + k + 1, 'spoke'); r.px(ox + hx, HUB_Y - k - 1, 'spoke') }
    }
    r.px(ox + hx, HUB_Y, 'spoke')
  }
}

function frameAndRider(r, ox, kid) {
  const f = kid.bike
  r.line(ox + 5, 21, ox + 10, 20, f); r.line(ox + 8, 13, ox + 10, 20, f); r.line(ox + 8, 14, ox + 14, 13, f)
  r.line(ox + 14, 14, ox + 10, 20, f); r.line(ox + 8, 14, ox + 5, 21, f); r.line(ox + 14, 12, ox + 16, 21, f)
  r.line(ox + 14, 12, ox + 15, 10, 'post2'); r.hl(ox + 15, 10, 3, 'post2'); r.hl(ox + 6, 12, 4, 'tyre')
  const rows = BODY.map((row, i) => HEADS[kid.head][i] ?? row)
  r.spr(rows, ox, 0, { h: kid.hair, s: kid.skin, k: 'tyre', j: kid.jacket, b: kid.pack, a: kid.jacket, p: 'pant', c: 'cap', C: 'jR' })
  if (kid.light) r.px(ox + 18, 10, 'head')
}

// Les jambes : celle du fond d'abord, plus sombre. Deux temps de pédalage, puis le pied à terre.
function legs(r, ox, pose) {
  const leg = (knee, foot, c) => {
    limb(r, ox + 9, 11, ox + knee[0], knee[1], 2, 2, c)
    limb(r, ox + knee[0], knee[1], ox + foot[0], foot[1], 2, 2, c)
    r.hl(ox + foot[0] - 1, foot[1] + 1, 3, 'shoe')
  }
  const down = [[12, 16], [11, 21]]
  const up = [[11, 14], [9, 17]]
  if (pose === 'stop') {
    leg(up[0], up[1], 'pant2')
    leg([9, 17], [8, 23], 'pant')
  } else {
    const [far, near] = pose === 0 ? [up, down] : [down, up]
    leg(far[0], far[1], 'pant2')
    leg(near[0], near[1], 'pant')
  }
}

const kidX = i => i * KID.gap

// Le convoi : les quatre enfants, le meneur à droite. Trois calques : ce qui ne
// bouge pas, ce qui tourne en pédalant (deux temps), et l'arrêt, pied à terre.
export function convoyBase() {
  const r = new Raster(PAL, CONVOY.w, CONVOY.h)
  KIDS.forEach((kid, i) => frameAndRider(r, kidX(i), kid))
  return r
}
export function convoyRide(frame) {
  const r = new Raster(PAL, CONVOY.w, CONVOY.h)
  KIDS.forEach((kid, i) => {
    wheels(r, kidX(i), (frame + i) % 2)
    legs(r, kidX(i), (frame + i) % 2)
  })
  return r
}
export function convoyStop() {
  const r = new Raster(PAL, CONVOY.w, CONVOY.h)
  KIDS.forEach((kid, i) => {
    wheels(r, kidX(i), 0)
    legs(r, kidX(i), 'stop')
  })
  return r
}
// Les faisceaux des lampes : deux cônes pâles devant les vélos qui en portent une.
export function convoyBeams() {
  const r = new Raster(PAL, CONVOY.w, CONVOY.h)
  KIDS.forEach((kid, i) => {
    if (!kid.light) return
    const x0 = kidX(i) + 19
    for (let dx = 0; dx < BEAM; dx++) {
      const cy = 10 + dx * 0.16
      const hh = 1 + dx * 0.2
      for (let y = Math.round(cy - hh); y <= Math.round(cy + hh); y++) r.px(x0 + dx, y, 'light')
      for (let y = Math.round(cy - hh * 0.45); y <= Math.round(cy + hh * 0.45); y++) r.px(x0 + dx, y, 'light2')
    }
  })
  return r
}
export function convoyShadow() {
  const r = new Raster(PAL, CONVOY.w, 3)
  KIDS.forEach((_, i) => {
    r.hl(kidX(i) + 2, 0, 18, 'tyre')
    r.hl(kidX(i) + 4, 1, 14, 'tyre')
  })
  return r
}

// ---------------------------------------------------------------- la bête
export const BEAST = { w: 34, h: 60 }
// Le crâne, tourné vers la gauche : b os, B os dans l'ombre, k orbite.
const SKULL = [
  '....bbbbbb..',
  '..bbbbbbbbb.',
  '.bbbkkbbbbbb',
  'bbbbkkbbbbB.',
  'bBbbbbbbBB..',
  '.BbBbBbB....',
  '..B.B.B.....',
]
export const BEAST_EYE = { x: 6, y: 9 }

export function beast(frame) {
  const r = new Raster(PAL, BEAST.w, BEAST.h)
  const s = frame ? 1 : 0
  const claws = (x, y) => {
    limb(r, x, y, x - 2, y + 5, 1, 1, 'mb'); limb(r, x + 1, y, x + 1, y + 6, 1, 1, 'mb'); limb(r, x + 2, y, x + 4, y + 5, 1, 1, 'mb')
  }
  // le bras du fond
  limb(r, 21, 21, 25, 33, 4, 3, 'mb2'); limb(r, 25, 33, 22 - s, 45, 3, 2, 'mb2'); claws(22 - s, 45)
  // les pattes, pliées comme celles d'une bête
  limb(r, 18, 37, 13, 46, 5, 4, 'mb'); limb(r, 13, 46, 16, 53, 4, 3, 'mb'); limb(r, 16, 53, 12, 58, 3, 2, 'mb'); r.hl(8, 59, 6, 'mb')
  limb(r, 22, 37, 20, 47, 5, 4, 'mb'); limb(r, 20, 47, 24, 54, 4, 3, 'mb'); limb(r, 24, 54, 20, 58, 3, 2, 'mb'); r.hl(16, 59, 6, 'mb')
  // le tronc, voûté, les côtes saillantes
  limb(r, 20, 38, 16, 19, 7, 11, 'mb')
  // le bras de devant
  limb(r, 12, 20, 7, 31, 4, 3, 'mb'); limb(r, 7, 31, 6 + s, 43, 3, 2, 'mb'); claws(6 + s, 43)
  // le cou, les bois, le crâne
  limb(r, 15, 19, 11, 13, 5, 4, 'mb')
  limb(r, 10, 8, 15, 1, 2, 1, 'bone2'); limb(r, 12, 5, 17, 4, 1, 1, 'bone2'); limb(r, 13, 3, 12, 0, 1, 1, 'bone2')
  limb(r, 8, 7, 9, 0, 2, 1, 'bone2'); limb(r, 9, 4, 5, 1, 1, 1, 'bone2'); limb(r, 15, 1, 19, 0, 1, 1, 'bone2')
  r.spr(SKULL, 1, 7, { b: 'bone', B: 'bone2', k: 'mb' })
  // la lune l'ourle à gauche, la faille à droite
  const body = new Set(['mb', 'mb2'])
  const edges = []
  r.each((x, y, c) => {
    if (!body.has(c) || y > 58) return
    if (r.get(x + 1, y) === null && y % 2 === 0) edges.push([x, y, 'mred'])
    else if (r.get(x - 1, y) === null && y % 3 === 0) edges.push([x, y, 'mrim'])
  })
  for (const [x, y, c] of edges) r.px(x, y, c)
  for (let i = 0; i < 4; i++) r.hl(14 + i, 25 + i * 3, 3, 'mrim')
  return r
}
export function beastEyes() {
  const r = new Raster(PAL, BEAST.w, BEAST.h)
  const { x, y } = BEAST_EYE
  r.disc(x, y + 1, 4, 'eyeH')
  r.rect(x - 1, y, 2, 2, 'eye')
  return r
}
