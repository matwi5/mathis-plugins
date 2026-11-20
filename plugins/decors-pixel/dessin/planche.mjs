// Planche de relecture des deux animaux : toutes leurs poses, en gros plan.
//   node plugins/decors-pixel/dessin/planche.mjs <dossier>
// Écrit planche-jour.png et planche-nuit.png dans le dossier.
import fs from 'node:fs'
import path from 'node:path'
import { Raster, composite, writePng } from './engine.mjs'
import { PAL } from './palette.mjs'
import * as D from './dog.mjs'
import * as C from './cat.mjs'

const out = process.argv[2]
if (!out) throw new Error('usage : node planche.mjs <dossier>')
fs.mkdirSync(out, { recursive: true })

const W = 300
const H = 80
for (const mode of ['d', 'n']) {
  const bg = new Raster(PAL, W, H)
  bg.rect(0, 0, W, H, 'pv1')
  bg.rect(0, 0, W, 10, 'q2')
  bg.rect(0, 40, W, 10, 'q2')
  const L = [{ r: bg }]
  // le chien : quatre pas, deux foulées, l'arrêt, assis
  const dogLegs = [0, 1, 2, 3].map(D.legsFrame).concat([D.dogRunLegs(0), D.dogRunLegs(1), D.dogStandLegs()])
  dogLegs.forEach((legs, i) => {
    const x = 2 + i * 37
    L.push({ r: legs, x, y: 10 }, { r: D.dogTail(i % 2), x, y: 10 - (i % 2) }, { r: D.dogBase(), x, y: 10 - (i % 2) })
  })
  L.push({ r: D.sitTail(0), x: 264, y: 10 }, { r: D.dogSit(), x: 264, y: 10 })
  // le chat : les mêmes poses
  const catLegs = [0, 1, 2, 3].map(C.catWalkLegs).concat([C.catRunLegs(0), C.catRunLegs(1), C.catStandLegs()])
  catLegs.forEach((legs, i) => {
    const x = 4 + i * 37
    L.push({ r: legs, x, y: 54 }, { r: C.catTail(i % 2), x, y: 54 - (i % 2) }, { r: C.catBase(), x, y: 54 - (i % 2) })
  })
  L.push({ r: C.catSitTail(0), x: 240, y: 58 }, { r: C.catSit(), x: 240, y: 58 })
  L.push({ r: C.catSitTail(1), x: 270, y: 58 }, { r: C.catSit(), x: 270, y: 58 })
  L.push({ r: C.heart(), x: 262, y: 48 })
  writePng(path.join(out, mode === 'd' ? 'planche-jour.png' : 'planche-nuit.png'), composite(PAL, W, H, L, mode), W, H, 5)
}
