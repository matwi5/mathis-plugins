// Assemble la scène et écrit ce que le mod en lit : hooks/scene.js (et son .d.ts),
// plus les deux aperçus du README (apercu/jour.png, apercu/nuit.png).
//   node plugins/morkie-paris/dessin/build.mjs
//   node plugins/morkie-paris/dessin/build.mjs --relecture <dossier>
// Avec --relecture, le dossier reçoit aussi des gros plans PNG et les SVG des trois
// scènes (auto, jour, nuit), à ouvrir dans un navigateur pour relire l'animation.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Raster, encode, composite, writePng } from './engine.mjs'
import { emitScene } from './emit.mjs'
import { PAL } from './palette.mjs'
import * as S from './scene.mjs'
import * as D from './dog.mjs'
import * as K from './cat.mjs'
import * as RT from './rat.mjs'

const { W, H } = S
const LIMIT = 126000 // la limite dure est 131 072 caractères
const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APERCU = path.join(PLUGIN, 'apercu')
const at = process.argv.indexOf('--relecture')
const OUT = at > 0 ? process.argv[at + 1] : undefined
if (at > 0 && !OUT) throw new Error('--relecture demande un dossier')
fs.mkdirSync(APERCU, { recursive: true })
if (OUT) fs.mkdirSync(OUT, { recursive: true })

let rectTotal = 0
const sizes = {}
const enc = (name, r, ox = 0, oy = 0) => {
  const e = encode(r, ox, oy)
  rectTotal += e.rects
  sizes[name] = (sizes[name] ?? 0) + e.svg.length
  return e.svg
}
const g = (cls, inner) => `<g class="${cls}">${inner}</g>`

// ------------------------------------------------------------ pièces
const sky = S.skyRaster()
const stars = S.stars()
const sun = S.sun()
const rays = S.sunRays()
const moon = S.moon()
const clouds = [
  { r: S.cloud(1, 46), y: 30, dur: 280, at: 0.12 },
  { r: S.cloud(2, 62), y: 62, dur: 360, at: 0.52 },
  { r: S.cloud(3, 38), y: 92, dur: 320, at: 0.3 },
  { r: S.cloud(4, 54), y: 14, dur: 400, at: 0.78 },
  { r: S.cloud(5, 30), y: 116, dur: 440, at: 0.63 },
]
const birds = [S.birds(0), S.birds(1)]
const back = S.back()
const backNight = S.backNight()
const sparkles = S.sparkles()
const shimmer = S.shimmer()
const boat = S.boat()
const front = S.front()
const frontNight = S.frontNight()
const pigeons = [S.pigeon(0), S.pigeon(1)]
const smoke = S.smoke()
const dogBase = D.dogBase()
const dogTails = [D.dogTail(0), D.dogTail(1)]
const legs = [0, 1, 2, 3].map(D.legsFrame)
const sit = D.dogSit()
const sitTails = [D.sitTail(0), D.sitTail(1)]
const shadow = D.dogShadow()
const heart = K.heart()
// Les calques de chaque acteur, et où poser son ombre et sa pose assise dans sa case.
const DOG = {
  walk: legs,
  run: [D.dogRunLegs(0), D.dogRunLegs(1)],
  stand: D.dogStandLegs(),
  tails: dogTails,
  base: dogBase,
  sit,
  sitTails,
  sitAt: [3, 0],
  shadow,
  shadowAt: [4, 26],
}
const CAT = {
  walk: [0, 1, 2, 3].map(K.catWalkLegs),
  run: [K.catRunLegs(0), K.catRunLegs(1)],
  stand: K.catStandLegs(),
  tails: [K.catTail(0), K.catTail(1)],
  base: K.catBase(),
  sit: K.catSit(),
  sitTails: [K.catSitTail(0), K.catSitTail(1)],
  sitAt: [2, 3],
  shadow: D.dogShadow(22),
  shadowAt: [4, 20],
}
// Le même dessin, retourné : pour les aperçus, où rien ne bouge.
const mirror = r => {
  const m = new Raster(PAL, r.w, r.h)
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) m.px(r.w - 1 - x, y, r.get(x, y))
  return m
}

const DOG_Y = 236
const CAT_Y = 242
const SUNX = S.SUN.x - 22
const SUNY = S.SUN.y - 22
const LEAVES = [
  { x: 420, y: 132, dx: -30, dur: 11, at: 0 },
  { x: 452, y: 120, dx: -18, dur: 14, at: 0.35 },
  { x: 468, y: 140, dx: -44, dur: 12, at: 0.7 },
  { x: 404, y: 146, dx: -12, dur: 16, at: 0.5 },
  { x: 436, y: 110, dx: -60, dur: 18, at: 0.15 },
  { x: 474, y: 126, dx: -26, dur: 13, at: 0.85 },
]
const PIGEONS = [{ x: 302, y: 255, peck: true }, { x: 358, y: 220, peck: false }, { x: 424, y: 257, peck: true }]
// Les aiguilles de l'horloge de rue : deux traits qui tournent autour du centre du cadran.
// Sans réglage, il est midi ; le mod décale chaque animation pour donner l'heure du poste.
const HANDS = { minute: 6, hour: 4 }
const hand = (cls, len) =>
  `<path class="${PAL.cls(PAL.id('iron'))} s ${cls}" d="M${S.CLOCK.x} ${S.CLOCK.y}v-${len}"/>`

// ------------------------------------------------------------ aperçus PNG
function still(mode, dogX, catX) {
  const L = [{ r: sky }]
  stars.forEach(r => L.push({ r, only: 'n' }))
  L.push({ r: moon, x: SUNX, y: SUNY, only: 'n' })
  L.push({ r: sun, x: SUNX, y: SUNY, only: 'd' }, { r: rays, x: SUNX, y: SUNY, only: 'd' })
  clouds.forEach(c => L.push({ r: c.r, x: Math.round(-90 + c.at * 580), y: c.y }))
  L.push({ r: birds[0], x: 250, y: 58, only: 'd' })
  L.push({ r: back })
  L.push({ r: backNight, only: 'n' }, { r: sparkles[0], only: 'n' }, { r: sparkles[1], only: 'n' })
  L.push({ r: shimmer[0] })
  L.push({ r: boat, x: 252, y: S.BOAT.y })
  L.push({ r: front })
  L.push({ r: frontNight, only: 'n' })
  PIGEONS.forEach((p, i) => L.push({ r: pigeons[i % 2], x: p.x, y: p.y }))
  LEAVES.forEach((l, i) => L.push({ r: S.leaf(i), x: l.x + l.dx / 2, y: l.y + 50 }))
  L.push({ r: smoke, x: 66, y: 2 }, { r: smoke, x: 71, y: -6 })
  // la rencontre : le chat, tourné vers la gauche, nez à nez avec le chien
  L.push({ r: CAT.shadow, x: catX + 4, y: CAT_Y + 20 })
  for (const r of [CAT.stand, CAT.tails[0], CAT.base]) L.push({ r: mirror(r), x: catX, y: CAT_Y })
  L.push({ r: shadow, x: dogX + 4, y: DOG_Y + 26 })
  L.push({ r: DOG.stand, x: dogX, y: DOG_Y }, { r: dogTails[0], x: dogX, y: DOG_Y }, { r: dogBase, x: dogX, y: DOG_Y })
  L.push({ r: heart, x: dogX + 32, y: DOG_Y - 9 })
  return composite(PAL, W, H, L, mode)
}
for (const mode of ['d', 'n']) {
  const buf = still(mode, 22, 60)
  writePng(path.join(APERCU, mode === 'd' ? 'jour.png' : 'nuit.png'), buf, W, H, 3)
  if (!OUT) continue
  writePng(`${OUT}/zoomL-${mode}.png`, buf, W, H, 6, { x: 0, y: 130, w: 240, h: 140 })
  writePng(`${OUT}/zoomR-${mode}.png`, buf, W, H, 6, { x: 240, y: 130, w: 240, h: 140 })
  writePng(`${OUT}/zoomT-${mode}.png`, buf, W, H, 6, { x: 200, y: 0, w: 240, h: 140 })
  writePng(`${OUT}/zoomC-${mode}.png`, buf, W, H, 6, { x: 0, y: 0, w: 200, h: 140 })
}

// ------------------------------------------------------------ SVG
const f = n => (Math.round(n * 1000) / 1000).toString()
let body = ''
let css = ''
let timing = ''

body += S.skySvg()
sizes.sky = body.length
body += g('N', enc('stars', stars[0]) + g('t1', enc('stars', stars[1])) + g('t2', enc('stars', stars[2])) + enc('moon', moon, SUNX, SUNY))
body += g('D', enc('sun', sun, SUNX, SUNY) + g('ry', enc('sun', rays, SUNX, SUNY)))
clouds.forEach((c, i) => {
  body += g(`cl x${i}`, enc('clouds', c.r, 0, c.y))
  timing += `.x${i}{animation-duration:${c.dur}s;animation-delay:-${f(c.dur * c.at)}s}`
})
body += g('D', g('bd', g('f0', enc('birds', birds[0], 0, 58)) + g('f1', enc('birds', birds[1], 0, 58))))
body += enc('back', back)
// Le scintillement de la tour, la nuit : cinq minutes à chaque heure pile, comme la vraie.
body += g('N', enc('backNight', backNight) + g('sk', sparkles.map((r, i) => g('e' + i, enc('sparkles', r))).join('')))
body += g('h0', enc('shimmer', shimmer[0])) + g('h1', enc('shimmer', shimmer[1]))
body += g('bt', enc('boat', boat, 0, S.BOAT.y))
body += enc('front', front)
body += hand('hH', HANDS.hour) + hand('hM', HANDS.minute)
body += g('N', enc('frontNight', frontNight))
;[0, 1, 2].forEach(i => {
  body += g(`sm m${i}`, enc('smoke', smoke, 66, 4))
  timing += `.m${i}{animation-delay:-${f(i * 2.4)}s}`
})
PIGEONS.forEach((p, i) => {
  if (p.peck) {
    body += g(`pa q${i}`, enc('pigeons', pigeons[0], p.x, p.y)) + g(`pb q${i}`, enc('pigeons', pigeons[1], p.x, p.y))
    timing += `.q${i}{animation-delay:-${f(i * 1.7)}s}`
  } else body += enc('pigeons', pigeons[0], p.x, p.y)
})
LEAVES.forEach((l, i) => {
  body += g(`lv v${i}`, enc('leaves', S.leaf(i), l.x, l.y))
  timing += `@keyframes lv${i}{0%{transform:translate(0,0);opacity:0}6%{opacity:1}92%{opacity:1}100%{transform:translate(${l.dx}px,128px);opacity:0}}`
  timing += `.v${i}{animation-name:lv${i};animation-duration:${l.dur}s;animation-delay:-${f(l.dur * l.at)}s}`
})

// Le chien et le chat : une rencontre sur le trottoir, écrite seconde par seconde.
// Chacun arrive de son côté, ils se flairent, sautillent, se courent après dans
// un sens puis dans l'autre, s'assoient côte à côte, puis repartent.
const STEP = 0.15 // une pose de marche, et 2 pixels de trajet
const STRIDE = 0.1 // une foulée de course, et 4 pixels de trajet
// La boucle entière, en secondes : un diviseur de l'heure, pour que le mod la cale
// sur l'heure du poste et qu'un de ses tours, à la demie, soit la poursuite du rat.
// 150 et non 120 : la rencontre garde tout son temps, et les deux restent assis
// côte à côte un peu plus longtemps.
const T = 150
const pct = t => f((t / T) * 100) + '%'

// Une scène d'un acteur : à partir de t, de x à to, dans une allure (walk, run,
// stand : debout sans bouger, sit : assis de face), tourné à droite (r) ou à gauche (l).
// Ils ne s'arrêtent et ne jouent qu'à deux endroits, de part et d'autre de la
// colonne où l'app pose le texte et la saisie : devant le café, à gauche, et devant
// le métro, à droite, entre son panneau et l'arbre. Entre les deux, ils ne font que passer.
const DOG_SCRIPT = [
  { t: 0, x: -40, to: -40, pace: 'stand', face: 'r' },
  { t: 28.35, x: -40, to: 22, pace: 'walk', face: 'r' },
  { t: 33, x: 22, to: 22, pace: 'stand', face: 'r' }, // devant le café : nez à nez, puis le jeu
  { t: 41.8, x: 22, to: 522, pace: 'run', face: 'r' }, // il poursuit le chat
  { t: 54.3, x: 522, to: 522, pace: 'stand', face: 'l' },
  { t: 55, x: 524, to: 524, pace: 'stand', face: 'l' },
  { t: 55.7, x: 524, to: -48, pace: 'run', face: 'l' }, // retour, le chat à ses trousses
  { t: 70, x: -48, to: -48, pace: 'stand', face: 'r' },
  { t: 71.9, x: -48, to: 400, pace: 'run', face: 'r' }, // et encore dans l'autre sens
  { t: 83.1, x: 400, to: 400, pace: 'sit', face: 'r' }, // assis côte à côte, entre le panneau du métro et l'arbre
  { t: 102.6, x: 400, to: -40, pace: 'walk', face: 'l' },
  { t: 135.6, x: -40, to: -40, pace: 'stand', face: 'r' },
]
const CAT_SCRIPT = [
  { t: 0, x: 500, to: 60, pace: 'walk', face: 'l' },
  { t: 33, x: 60, to: 60, pace: 'stand', face: 'l' },
  { t: 41.2, x: 60, to: 520, pace: 'run', face: 'r' },
  { t: 52.7, x: 520, to: 520, pace: 'stand', face: 'l' },
  { t: 54.2, x: 544, to: 544, pace: 'stand', face: 'l' },
  { t: 56.5, x: 544, to: -40, pace: 'run', face: 'l' },
  { t: 71.1, x: -40, to: -40, pace: 'stand', face: 'r' },
  { t: 71.3, x: -40, to: 428, pace: 'run', face: 'r' },
  { t: 83, x: 428, to: 428, pace: 'sit', face: 'r' },
  { t: 102.6, x: 428, to: 500, pace: 'walk', face: 'r' },
  { t: 108, x: 500, to: 500, pace: 'stand', face: 'l' },
]
// Les petits sauts du jeu, chacun son tour.
const DOG_HOPS = [37.2, 38.4, 39.6]
const CAT_HOPS = [37.8, 39, 40.2]
// Les cœurs : au premier flair, puis quand ils sont assis côte à côte.
const HEARTS = [
  { x: 55, y: 227, from: 34.5, to: 36.9 },
  { x: 425, y: 222, from: 84.5, to: 87.5 },
  { x: 430, y: 224, from: 88.5, to: 91.5 },
  { x: 425, y: 222, from: 94, to: 97 },
  { x: 430, y: 224, from: 98, to: 101 },
]

// La poursuite du rat : une fois par heure, à la demie, elle remplace un tour de la
// boucle. Le chat attend près du métro, le chien devant le café ; un rat traverse la
// rue, le chat le prend en chasse, le rat tombe nez à nez avec le chien, file sous
// le chat et repart, les deux à ses trousses. Il retraverse la rue dans un sens,
// puis dans l'autre, et leur échappe : ils s'assoient, bredouilles, près du métro.
// Le tour commence et finit comme les autres (le chien hors champ à gauche, le chat
// à droite), et sa fin, à partir de la dernière course, est celle de la boucle.
const RAT_AT = 1800 // secondes après l'heure pile
const RAT_STRIDE = 0.08 // le rat court plus vite : 4 pixels en moins de temps
const DOG_RAT = [
  { t: 0, x: -40, to: 22, pace: 'walk', face: 'r' },
  { t: 4.65, x: 22, to: 22, pace: 'sit', face: 'r' },
  { t: 19.6, x: 22, to: 22, pace: 'stand', face: 'r' }, // le rat est sous son nez
  { t: 22.4, x: 22, to: 522, pace: 'run', face: 'r' },
  { t: 34.9, x: 522, to: 522, pace: 'stand', face: 'l' },
  { t: 45, x: 524, to: 524, pace: 'stand', face: 'l' },
  { t: 46, x: 524, to: -48, pace: 'run', face: 'l' }, // le rat repasse : tout le monde à gauche
  { t: 60.3, x: -48, to: -48, pace: 'stand', face: 'r' },
  { t: 71.9, x: -48, to: 400, pace: 'run', face: 'r' }, // et encore à droite, où il leur échappe
  { t: 83.1, x: 400, to: 400, pace: 'sit', face: 'r' },
  { t: 102.6, x: 400, to: -40, pace: 'walk', face: 'l' },
  { t: 135.6, x: -40, to: -40, pace: 'stand', face: 'r' },
]
const CAT_RAT = [
  { t: 0, x: 500, to: 500, pace: 'stand', face: 'l' },
  { t: 1, x: 500, to: 428, pace: 'walk', face: 'l' },
  { t: 6.4, x: 428, to: 428, pace: 'sit', face: 'l' },
  { t: 11.6, x: 428, to: 428, pace: 'stand', face: 'l' }, // le rat vient de passer
  // Il croise le rat en pleine course, qui lui file entre les pattes, et ne s'arrête
  // que devant le café, nez à nez avec le chien : jamais dans la colonne du texte.
  { t: 12.2, x: 428, to: 60, pace: 'run', face: 'l' },
  { t: 21.4, x: 60, to: 60, pace: 'stand', face: 'l' },
  { t: 22, x: 60, to: 524, pace: 'run', face: 'r' },
  { t: 33.6, x: 524, to: 524, pace: 'stand', face: 'l' },
  { t: 45.4, x: 524, to: -40, pace: 'run', face: 'l' },
  { t: 59.5, x: -40, to: -40, pace: 'stand', face: 'r' },
  { t: 71.3, x: -40, to: 428, pace: 'run', face: 'r' },
  { t: 83, x: 428, to: 428, pace: 'sit', face: 'r' },
  { t: 102.6, x: 428, to: 500, pace: 'walk', face: 'r' },
  { t: 108, x: 500, to: 500, pace: 'stand', face: 'l' },
]
const RAT_SCRIPT = [
  { t: 0, x: 520, to: 520, pace: 'stand', face: 'l' },
  { t: 10, x: 520, to: 72, pace: 'run', face: 'l' },
  { t: 18.96, x: 72, to: 72, pace: 'stand', face: 'l' },
  { t: 20.2, x: 72, to: 524, pace: 'run', face: 'r' },
  { t: 29.24, x: 524, to: 524, pace: 'stand', face: 'l' },
  { t: 44, x: 524, to: -32, pace: 'run', face: 'l' },
  { t: 55.12, x: -32, to: -32, pace: 'stand', face: 'r' },
  { t: 69.5, x: -32, to: 524, pace: 'run', face: 'r' },
  { t: 80.62, x: 524, to: 524, pace: 'stand', face: 'l' },
]
// Qui l'aperçoit sursaute : un point d'exclamation, puis un petit saut.
const ALERTS = [
  { x: 438, y: CAT_Y - 9, from: 11.2, to: 12.2 },
  { x: 40, y: DOG_Y - 9, from: 19.2, to: 20.5 },
]

// Les images clés d'une valeur qui ne change qu'à certaines scènes.
const steps = (script, value) => {
  let out = ''
  let last
  for (const s of script) {
    const v = value(s)
    if (v !== last) out += `${pct(s.t)}{${v}}`
    last = v
  }
  return out
}

// Les animations d'un acteur : trajet, sens, sauts, et l'allure qui montre ses calques.
// Avec un suffixe, ce sont les images clés d'un autre scénario pour le même acteur :
// elles prennent la place des siennes, sans rien changer d'autre à ses animations.
function actorCss(id, script, y, width, hops, { suffix = '', stride = STRIDE } = {}) {
  let move = ''
  script.forEach((s, i) => {
    const end = i + 1 < script.length ? script[i + 1].t : T
    const dx = Math.abs(s.to - s.x)
    const per = s.pace === 'run' ? 4 : 2
    if (dx) {
      const want = (dx / per) * (s.pace === 'run' ? stride : STEP)
      if (Math.abs(want - (end - s.t)) > 0.011) throw new Error(`${id}, scène ${i} : ${f(end - s.t)} s prévues pour ${f(want)} s de trajet`)
      if (i + 1 < script.length && script[i + 1].x !== s.to) throw new Error(`${id}, scène ${i} : la suivante ne part pas de ${s.to}`)
    }
    move += `${pct(s.t)}{transform:translate(${s.x}px,${y}px);animation-timing-function:${dx ? `steps(${Math.round(dx / per)})` : 'step-end'}}`
  })
  move += `100%{transform:translate(${script[0].x}px,${y}px)}`
  const flipped = `transform:translateX(${width}px) scaleX(-1)`
  let hop = '0%{transform:none}'
  for (const h of hops)
    hop += `${pct(h)}{transform:translateY(-3px)}${pct(h + 0.1)}{transform:translateY(-5px)}${pct(h + 0.2)}{transform:translateY(-3px)}${pct(h + 0.3)}{transform:none}`
  const shown = pace => steps(script, s => `opacity:${s.pace === pace ? 1 : 0}`)
  const rules = {
    X: [move, ''],
    F: [steps(script, s => (s.face === 'r' ? 'transform:none' : flipped)), ' step-end'],
    H: [hop, ' step-end'],
    W: [shown('walk'), ' step-end'],
    R: [shown('run'), ' step-end'],
    S: [shown('stand'), ' step-end'],
    Z: [shown('sit'), ' step-end'],
    B: [steps(script, s => `opacity:${s.pace === 'sit' ? 0 : 1}`), ' step-end'],
  }
  return Object.entries(rules)
    .map(([k, [frames, ease]]) =>
      suffix
        ? `@keyframes ${id}${k}${suffix}{${frames}}.${id}${k}{animation-name:${id}${k}${suffix}}`
        : `@keyframes ${id}${k}{${frames}}.${id}${k}{animation:${id}${k} ${T}s${ease} infinite}`,
    )
    .join('')
}

// Les calques d'un acteur, pattes sous le corps : marche, course, arrêt, corps, assis.
function actorSvg(id, name, p) {
  const e = (r, ox = 0, oy = 0) => enc(name, r, ox, oy)
  return g(
    `${id}X`,
    e(p.shadow, p.shadowAt[0], p.shadowAt[1]) +
      g(
        `${id}F`,
        g(
          `${id}H`,
          g(`${id}W`, p.walk.map((r, i) => g(`lg g${i}`, e(r))).join('')) +
            g(`${id}R`, g('u0', e(p.run[0])) + g('u1', e(p.run[1]))) +
            g(`${id}S`, e(p.stand)) +
            // le corps ne tressaute pas : à l'arrêt, sur des pattes immobiles, il tremblait
            g(`${id}B`, g('f0', e(p.tails[0])) + g('f1', e(p.tails[1])) + e(p.base)) +
            g(`${id}Z`, g('f0', e(p.sitTails[0], ...p.sitAt)) + g('f1', e(p.sitTails[1], ...p.sitAt)) + e(p.sit, ...p.sitAt)),
        ),
      ),
  )
}

// Le chat passe derrière le chien.
body += actorSvg('C', 'cat', CAT)
body += actorSvg('A', 'dog', DOG)
let actors = actorCss('C', CAT_SCRIPT, CAT_Y, K.CAT_W, CAT_HOPS) + actorCss('A', DOG_SCRIPT, DOG_Y, D.DOG_W, DOG_HOPS)
HEARTS.forEach((h, i) => {
  body += g(`ht y${i}`, enc('hearts', heart, h.x, h.y))
  const up = Math.round((h.to - h.from) / 0.3)
  actors += `@keyframes y${i}{0%{opacity:0;transform:none}${pct(h.from)}{opacity:1;transform:none;animation-timing-function:steps(${up})}${pct(h.to)}{opacity:0;transform:translateY(-${up}px)}100%{opacity:0;transform:none}}`
  actors += `.y${i}{animation:y${i} ${T}s step-end infinite}`
})
legs.forEach((_, i) => {
  timing += `.g${i}{animation-delay:-${f(4 * STEP - i * STEP)}s}`
})

// Ce que la poursuite du rat ajoute à la scène, le temps de son tour : d'autres
// images clés pour le chien et le chat, le rat et ses animations, les sursauts.
// Le mod ne l'insère que pendant ce tour : la scène ordinaire n'en porte pas le poids.
const ratRun = [RT.ratRun(0), RT.ratRun(1)]
const RAT_Y = DOG_Y + 26 - (RT.RAT_H - 1)
let ratCss =
  actorCss('C', CAT_RAT, CAT_Y, K.CAT_W, [20.6], { suffix: 'r' }) +
  actorCss('A', DOG_RAT, DOG_Y, D.DOG_W, [19.5], { suffix: 'r' }) +
  actorCss('R', RAT_SCRIPT, RAT_Y, RT.RAT_W, [], { stride: RAT_STRIDE }) +
  // le cœur de la rencontre devant le café n'a pas lieu ; ceux des deux assis, si
  '.y0{display:none}'
let ratBody = g('RX', g('RF', g('RR', g('u0', enc('rat', ratRun[0])) + g('u1', enc('rat', ratRun[1]))) + g('RS', enc('rat', ratRun[0]))))
ALERTS.forEach((a, i) => {
  ratBody += g(`n${i}`, enc('rat', RT.alert(), a.x, a.y))
  ratCss += `@keyframes n${i}{0%{opacity:0}${pct(a.from)}{opacity:1}${pct(a.to)}{opacity:0}100%{opacity:0}}.n${i}{animation:n${i} ${T}s step-end infinite}`
})
// Ce que le mod cale sur l'heure du poste : la boucle des acteurs (et du rat), puis
// ce qui dérive lentement, pour qu'un nouveau dessin de la scène reprenne là où il en était.
const LOOP_CLASSES = ['A', 'C', 'R']
  .flatMap(id => [...'XFHWRSZB'].map(c => `.${id}${c}`))
  .concat(HEARTS.map((_, i) => `.y${i}`), ALERTS.map((_, i) => `.n${i}`))
  .join(',')
const AMBIENT = clouds
  .map((c, i) => [`x${i}`, c.dur, c.at])
  .concat([['bt', 150, 40 / 150], ['bd', 80, 0.25]])
  .concat(LEAVES.map((l, i) => [`v${i}`, l.dur, l.at]), [0, 1, 2].map(i => [`m${i}`, 7.2, i / 3]))
// Le tour du rat ne se joue qu'une fois, et s'arrête sur sa dernière image (tout le
// monde hors champ) : si le mod tarde à remettre la scène ordinaire, rien ne repart.
ratCss += `${LOOP_CLASSES}{animation-iteration-count:1;animation-fill-mode:forwards}`

const C = 2 * STEP
css += 'path{fill:currentColor}.s{fill:none;stroke:currentColor}.a{stroke-dasharray:1 3}.b{stroke-dasharray:1 1}'
css += '.N{display:none}'
css += PAL.cssOpacity()
css += `@keyframes cl{from{transform:translateX(-90px)}to{transform:translateX(${W + 10}px)}}.cl{animation:cl 300s steps(${(W + 100) / 1}) infinite}`
css += '@keyframes tw{0%{opacity:1}50%{opacity:.25}}.t1{animation:tw 3.2s step-end infinite}.t2{animation:tw 4.6s step-end -2s infinite}.ry{animation:tw 5s step-end infinite}'
css += '@keyframes sp{0%{opacity:1}34%{opacity:0}}.e0,.e1,.e2{animation:sp 1.2s step-end infinite}.e1{animation-delay:-.4s}.e2{animation-delay:-.8s}'
css += '@keyframes ha{0%{opacity:1}50%{opacity:0}}@keyframes hb{0%{opacity:0}50%{opacity:1}}.h0{animation:ha 1.8s step-end infinite}.h1{animation:hb 1.8s step-end infinite}'
css += `.f0{animation:ha ${f(C)}s step-end infinite}.f1{animation:hb ${f(C)}s step-end infinite}.bd .f0,.bd .f1{animation-duration:.5s}.AZ .f0,.AZ .f1,.CZ .f0,.CZ .f1{animation-duration:.36s}.u0{animation:ha ${f(2 * STRIDE)}s step-end infinite}.u1{animation:hb ${f(2 * STRIDE)}s step-end infinite}`
css += `@keyframes bt{from{transform:translateX(${W + 20}px)}to{transform:translateX(-${S.BOAT.w + 150}px)}}.bt{animation:bt 150s steps(${(W + 170 + S.BOAT.w) / 2}) -40s infinite}`
css += `@keyframes bd{from{transform:translate(-50px,0)}to{transform:translate(${W + 10}px,-34px)}}.bd{animation:bd 80s steps(270) -20s infinite}`
css += '@keyframes pa{0%,22%,40%,58%{opacity:1}16%,34%,52%{opacity:0}}@keyframes pb{0%,22%,40%,58%{opacity:0}16%,34%,52%{opacity:1}}.pa{animation:pa 5.2s step-end infinite}.pb{animation:pb 5.2s step-end infinite}'
css += '.lv{animation:lv0 12s steps(64) infinite}'
css += '@keyframes sm{0%{transform:translate(0,0);opacity:0}15%{opacity:1}100%{transform:translate(9px,-24px);opacity:0}}.sm{animation:sm 7.2s steps(24) infinite}'
css += actors
// Une animation d'une heure, visible ses cinq premières minutes ; le mod la cale sur l'heure du poste.
css += `@keyframes sk{0%{opacity:1}${f(100 / 12)}%{opacity:0}}.sk{animation:sk 3600s step-end infinite}`
// L'aiguille des minutes avance d'un cran par minute, celle des heures toutes les cinq minutes.
css += `@keyframes hr{to{transform:rotate(360deg)}}.hM,.hH{transform-origin:${S.CLOCK.x}px ${S.CLOCK.y}px}.hM{animation:hr 3600s steps(60) infinite}.hH{stroke-width:1.5;animation:hr 43200s steps(144) infinite}`
css += `@keyframes lg{0%{opacity:1}25%{opacity:0}}.lg{animation:lg ${f(4 * STEP)}s step-end infinite}`

// Les décalages propres à chaque élément, après les règles « animation » qu'ils précisent.
css += timing
css += '@media (max-aspect-ratio:3/4){.wd{transform:translateX(-130px)}}'
css += PAL.css('d')
const cssNight = '.N{display:inline}.D{display:none}' + PAL.css('n')

const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges"><style>`
const middle = `</style><g class="wd">${body}`
const end = '</g></svg>'
const close = middle + end
const variants = {
  auto: open + css + `@media (prefers-color-scheme:dark){${cssNight}}` + close,
  jour: open + css + close,
  nuit: open + css + cssNight + close,
}
if (OUT) {
  for (const [k, v] of Object.entries(variants)) fs.writeFileSync(`${OUT}/paris-${k}.svg`, v)
  // Relecture du retour du chien : la même scène, avancée dans le temps.
  // Relecture de la rencontre : la même scène, avancée à ses moments clés.
  const cast = ['A', 'C'].flatMap(id => [...'XFHWRSZB'].map(k => `.${id}${k}`)).concat(HEARTS.map((_, i) => `.y${i}`))
  for (const sec of [20, 35, 38, 47, 62, 77, 86, 100]) {
    const skip = `${cast.join(',')}{animation-delay:-${sec}s}`
    fs.writeFileSync(`${OUT}/essai-${sec}s.svg`, open + css + skip + (sec === 86 ? cssNight : '') + close)
  }
  // Relecture de la poursuite du rat, à ses moments clés.
  for (const sec of [5, 11, 16, 19, 19.8, 20.7, 21.7, 26, 47, 52, 73, 90, 149]) {
    const skip = `${LOOP_CLASSES}{animation-delay:-${sec}s}`
    const night = sec === 16 || sec === 52 ? cssNight : ''
    fs.writeFileSync(`${OUT}/rat-${sec}s.svg`, open + css + night + ratCss + skip + middle + ratBody + end)
  }
}
// Rien ne dit que l'app garde un style en attribut ou une variable CSS : tout passe par des classes.
if (/style=|var\(/.test(variants.auto)) throw new Error('style en attribut ou variable CSS dans la scène')

const total = variants.auto.length
console.log('pièces :', Object.entries(sizes).map(([k, v]) => `${k} ${v}`).join(', '))
console.log(`rectangles ${rectTotal}, css ${css.length} + nuit ${cssNight.length}, total (auto) ${total} / 131072`)
if (total > LIMIT) {
  console.error(`TROP LONG : ${total} > ${LIMIT}`)
  process.exitCode = 1
}
// Le tour du rat pèse plus : la scène, ce qu'il ajoute, et les décalages que pose le mod.
const ratTotal = total + ratCss.length + ratBody.length + 2000
console.log(`avec le rat : ${ratTotal} / 131072`)
if (ratTotal > 130000) {
  console.error(`TROP LONG avec le rat : ${ratTotal}`)
  process.exitCode = 1
}

emitScene(path.join(PLUGIN, 'hooks'), {
  open,
  css,
  cssNight,
  body: middle,
  end,
  loop: { seconds: T, classes: LOOP_CLASSES },
  rat: { at: RAT_AT, css: ratCss, body: ratBody },
  ambient: AMBIENT,
})
