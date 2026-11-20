// Le rat de la poursuite, une fois par heure, et le point d'exclamation de qui l'aperçoit.
import { Raster } from './engine.mjs'
import { PAL } from './palette.mjs'

export const RAT_W = 17
export const RAT_H = 6

// Tourné vers la droite, en deux foulées : b pelage, B dos plus clair, e oreille,
// E son creux, k œil, n museau, w menton, t queue, p pattes.
const RUN = [
  ['............ee...', '....bbbbbb.eEe...', '..bbBBBBBBbbbbb..', 'tt.bBBBBBBbbbkbbn', '..tbbbbbbbbbbww..', '...p..p....p..p..'],
  ['............ee...', '....bbbbbb.eEe...', '..bbBBBBBBbbbbb..', '.ttbBBBBBBbbbkbbn', 't..bbbbbbbbbbww..', '....pp......pp...'],
]
export function ratRun(i) {
  const r = new Raster(PAL, RAT_W, RAT_H)
  r.spr(RUN[i], 0, 0, { b: 'rt1', B: 'rt2', e: 'rt3', E: 'pink', k: 'blk', n: 'pink', w: 'rt2', t: 'pink', p: 'rt3' })
  return r
}

export function alert() {
  const r = new Raster(PAL, 5, 8)
  r.spr(['.www.', 'wrrrw', 'wrrrw', 'wrrrw', '.wrw.', '.www.', '.wrw.', '.www.'], 0, 0, { w: 'signW', r: 'al' })
  return r
}
