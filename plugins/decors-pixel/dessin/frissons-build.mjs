// Assemble le décor « Frissons 80 » et écrit ce que le mod en lit : hooks/scene-frissons.js
// (et son .d.ts), plus l'aperçu du README (apercu/frissons.png).
//   node plugins/decors-pixel/dessin/frissons-build.mjs
//   node plugins/decors-pixel/dessin/frissons-build.mjs --relecture <dossier>
// Avec --relecture, le dossier reçoit aussi des gros plans PNG et des SVG à ouvrir
// dans un navigateur : la scène, et la rencontre avancée à ses moments clés.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Raster, encode, composite, writePng } from './engine.mjs'
import { FPAL as PAL } from './frissons-palette.mjs'
import * as S from './frissons-scene.mjs'
import * as A from './frissons-actors.mjs'

const { W, H, ROAD } = S
const LIMIT = 126000 // la limite dure est 131 072 caractères
const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = process.argv.indexOf('--relecture')
const OUT = at > 0 ? process.argv[at + 1] : undefined
if (at > 0 && !OUT) throw new Error('--relecture demande un dossier')
if (OUT) fs.mkdirSync(OUT, { recursive: true })

const sizes = {}
const enc = (name, r, ox = 0, oy = 0) => {
  const e = encode(r, ox, oy)
  sizes[name] = (sizes[name] ?? 0) + e.svg.length
  return e.svg
}
const g = (cls, inner) => `<g class="${cls}">${inner}</g>`
const f = n => (Math.round(n * 1000) / 1000).toString()
const k = name => PAL.cls(PAL.id(name))
const mirror = r => {
  const m = new Raster(PAL, r.w, r.h)
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) m.px(r.w - 1 - x, y, r.get(x, y))
  return m
}

// ------------------------------------------------------------ pièces
const sky = S.skyRaster()
const stars = S.stars()
const moon = S.moon()
const MOONX = S.MOON.x - 32
const MOONY = S.MOON.y - 32
const clouds = [
  { r: S.cloud(11, 52), y: 34, dur: 420, at: 0.3 },
  { r: S.cloud(12, 38), y: 70, dur: 520, at: 0.05 },
  { r: S.cloud(13, 64), y: 96, dur: 600, at: 0.55 },
  { r: S.cloud(14, 44), y: 16, dur: 480, at: 0.8 },
]
const storm = S.storm()
const bolts = [S.bolt(3, 352, 64, 198), S.bolt(8, 430, 70, 150)]
const giant = S.giant()
const giantEyes = S.giantEyes()
const back = S.back()
const neon = S.dinerNeon()
const veins = S.riftVeins(back)
const shooting = S.shootingStar()
const garland = S.garland()
const tv = S.tvGlow()
const antenna = S.antennaLight()
const owl = S.owlEyes()
const lampLights = S.LAMPS.map(l => S.lampLight(l.x))
const rift = S.riftGlow()
const swing = S.tyreSwing()
const smoke = S.smoke()
const bats = [S.bat(0), S.bat(1)]
const front = S.front()
const fogs = [
  { r: S.fog(1, 300), x: 20, y: 214, dur: 46 },
  { r: S.fog(2, 340), x: 150, y: 226, dur: 60 },
  { r: S.fog(3, 260), x: -40, y: 241, dur: 52 },
  { r: S.fog(4, 320), x: 190, y: 202, dur: 70 },
  { r: S.fog(5, 280), x: 220, y: 248, dur: 56 },
]
const SPORES = 8
const spores = Array.from({ length: SPORES }, (_, i) => S.spores(i))
const convoy = { base: A.convoyBase(), ride: [A.convoyRide(0), A.convoyRide(1)], stop: A.convoyStop(), beams: A.convoyBeams(), shadow: A.convoyShadow() }
const beast = [A.beast(0), A.beast(1)]
const beastEyes = A.beastEyes()

const KIDS_Y = ROAD.wheel - (A.KID.h - 1)
const BEAST_Y = ROAD.top + 3 - (A.BEAST.h - 1)
const lab = S.labRoof()

// ------------------------------------------------------------ le scénario
// Les enfants arrivent de la gauche, roulent jusqu'à la lisière, tombent sur la
// bête qui sort de la faille, s'enfuient et se regroupent devant la maison, puis
// repartent. Ils ne s'arrêtent qu'aux deux bords, hors de la colonne du texte.
const T = 100 // la boucle entière, en secondes
const RIDE = 0.1 // un temps de pédalage, et 2 pixels de trajet ; 4 pixels en fuite
const pct = t => f((t / T) * 100) + '%'
const KIDS = [
  { t: 0, x: -150, to: -150, pace: 'stop', face: 'r' },
  { t: 2, x: -150, to: 348, pace: 'ride', face: 'r' },
  { t: 26.9, x: 348, to: 348, pace: 'stop', face: 'r' }, // à la lisière, lampes braquées sur la faille
  { t: 33, x: 348, to: 12, pace: 'flee', face: 'l' },
  { t: 41.4, x: 12, to: 12, pace: 'stop', face: 'l' }, // devant la maison
  { t: 54, x: 12, to: -150, pace: 'ride', face: 'l' },
  { t: 62.1, x: -150, to: -150, pace: 'stop', face: 'r' },
]
const KIDS_HOPS = [31.1, 43, 44.2]
// La bête : elle sort de la faille, se dresse, avance de quelques pas, puis s'efface.
const BEAST = { from: 452, stand: 436, reach: 412, rise: 29.5, up: 31, walk: 33, stop: 37, gone: 38.5 }
// Le grand éclair, juste avant la fuite : deux éclats, et la silhouette dans l'orage.
const STRIKE = [31, 31.15, 31.3, 31.75]

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
function convoyCss() {
  let move = ''
  KIDS.forEach((s, i) => {
    const end = i + 1 < KIDS.length ? KIDS[i + 1].t : T
    const dx = Math.abs(s.to - s.x)
    const per = s.pace === 'flee' ? 4 : 2
    if (dx) {
      const want = (dx / per) * RIDE
      if (Math.abs(want - (end - s.t)) > 0.011) throw new Error(`enfants, scène ${i} : ${f(end - s.t)} s prévues pour ${f(want)} s de trajet`)
      if (i + 1 < KIDS.length && KIDS[i + 1].x !== s.to) throw new Error(`enfants, scène ${i} : la suivante ne part pas de ${s.to}`)
    }
    move += `${pct(s.t)}{transform:translate(${s.x}px,${KIDS_Y}px);animation-timing-function:${dx ? `steps(${Math.round(dx / per)})` : 'step-end'}}`
  })
  move += `100%{transform:translate(${KIDS[0].x}px,${KIDS_Y}px)}`
  let hop = '0%{transform:none}'
  for (const h of KIDS_HOPS) hop += `${pct(h)}{transform:translateY(-2px)}${pct(h + 0.12)}{transform:translateY(-3px)}${pct(h + 0.24)}{transform:none}`
  const rules = {
    KX: [move, ''],
    KF: [steps(KIDS, s => (s.face === 'r' ? 'transform:none' : `transform:translateX(${A.CONVOY.kids}px) scaleX(-1)`)), ' step-end'],
    KH: [hop, ' step-end'],
    KR: [steps(KIDS, s => `opacity:${s.pace === 'stop' ? 0 : 1}`), ' step-end'],
    KS: [steps(KIDS, s => `opacity:${s.pace === 'stop' ? 1 : 0}`), ' step-end'],
  }
  return Object.entries(rules)
    .map(([c, [frames, ease]]) => `@keyframes ${c}{${frames}}.${c}{animation:${c} ${T}s${ease} infinite}`)
    .join('')
}
function beastCss() {
  const b = BEAST
  const at = x => `transform:translate(${x}px,${BEAST_Y}px)`
  const move =
    `0%{${at(b.from)}}${pct(b.rise)}{${at(b.from)};animation-timing-function:steps(${(b.from - b.stand) / 2})}` +
    `${pct(b.up)}{${at(b.stand)}}${pct(b.walk)}{${at(b.stand)};animation-timing-function:steps(${(b.stand - b.reach) / 2})}` +
    `${pct(b.stop)}{${at(b.reach)}}${pct(b.gone)}{${at(b.from)}}100%{${at(b.from)}}`
  const show =
    `0%{opacity:0}${pct(b.rise)}{opacity:.35}${pct(b.rise + 0.5)}{opacity:.7}${pct(b.rise + 1)}{opacity:1}` +
    `${pct(b.stop + 0.5)}{opacity:.6}${pct(b.stop + 1)}{opacity:.3}${pct(b.gone)}{opacity:0}`
  return `@keyframes MX{${move}}.MX{animation:MX ${T}s step-end infinite}@keyframes MO{${show}}.MO{animation:MO ${T}s step-end infinite}`
}
// Visible seulement pendant le grand éclair.
const strikeFrames = `0%{opacity:0}${pct(STRIKE[0])}{opacity:1}${pct(STRIKE[1])}{opacity:0}${pct(STRIKE[2])}{opacity:1}${pct(STRIKE[3])}{opacity:0}`
// Le réverbère de la lisière s'éteint quand la bête approche.
const blackout = `0%{opacity:1}${pct(30.2)}{opacity:0}${pct(30.5)}{opacity:1}${pct(30.8)}{opacity:0}${pct(34.5)}{opacity:1}${pct(34.7)}{opacity:0}${pct(35)}{opacity:1}`

// ------------------------------------------------------------ aperçus PNG
function still({ kidsX, left = false, monster = false, strike = false }) {
  const L = [{ r: sky }]
  stars.forEach(r => L.push({ r }))
  L.push({ r: moon, x: MOONX, y: MOONY })
  clouds.forEach(c => L.push({ r: c.r, x: Math.round(-80 + c.at * 560), y: c.y }))
  L.push({ r: storm })
  if (strike) {
    const flash = new Raster(PAL, W, S.SKY_END)
    flash.rect(0, 0, W, S.SKY_END, 'flash')
    L.push({ r: flash }, { r: flash }, { r: giant }, { r: giantEyes }, { r: bolts[1] })
  }
  L.push({ r: back }, { r: neon }, { r: veins })
  garland.forEach((r, i) => i % 2 === 0 && L.push({ r }))
  L.push({ r: tv }, { r: antenna }, { r: owl }, { r: rift }, { r: lampLights[0] })
  if (!strike) L.push({ r: lampLights[1] })
  L.push({ r: swing, x: S.TREE.branch.x - 4, y: S.TREE.branch.y })
  if (monster) L.push({ r: beast[0], x: BEAST.stand, y: BEAST_Y }, { r: beastEyes, x: BEAST.stand, y: BEAST_Y })
  if (kidsX !== undefined) {
    const turn = r => (left ? mirror(r) : r)
    const x = left ? kidsX - (A.CONVOY.w - A.CONVOY.kids) : kidsX
    L.push({ r: convoy.shadow, x: left ? x + (A.CONVOY.w - A.CONVOY.kids) : x, y: KIDS_Y + A.KID.h - 1, alpha: 0.5 })
    L.push({ r: turn(convoy.beams), x, y: KIDS_Y }, { r: turn(convoy.stop), x, y: KIDS_Y }, { r: turn(convoy.base), x, y: KIDS_Y })
  }
  L.push({ r: front })
  fogs.forEach(fg => L.push({ r: fg.r, x: fg.x, y: fg.y }))
  spores.forEach((r, i) => i % 2 === 0 && L.push({ r, alpha: 0.8 }))
  return composite(PAL, W, H, L, 'd')
}
fs.mkdirSync(path.join(PLUGIN, 'apercu'), { recursive: true })
writePng(path.join(PLUGIN, 'apercu', 'frissons.png'), still({ kidsX: 348, monster: true }), W, H, 3)
if (OUT) {
  const shots = { rencontre: { kidsX: 348, monster: true }, eclair: { kidsX: 348, monster: true, strike: true }, maison: { kidsX: 12, left: true } }
  for (const [name, opts] of Object.entries(shots)) {
    const buf = still(opts)
    writePng(`${OUT}/f-${name}.png`, buf, W, H, 3)
    writePng(`${OUT}/f-${name}-gauche.png`, buf, W, H, 6, { x: 0, y: 110, w: 240, h: 160 })
    writePng(`${OUT}/f-${name}-droite.png`, buf, W, H, 6, { x: 240, y: 110, w: 240, h: 160 })
    writePng(`${OUT}/f-${name}-ciel.png`, buf, W, H, 4, { x: 120, y: 0, w: 360, h: 180 })
  }
}

// ------------------------------------------------------------ SVG
let body = ''
let css = ''
let timing = ''

body += S.skySvg()
sizes.sky = body.length
body += enc('stars', stars[0]) + g('t1', enc('stars', stars[1])) + g('t2', enc('stars', stars[2]))
body += enc('moon', moon, MOONX, MOONY)
body += g('bt', g('f0', enc('bats', bats[0], 0, 0) + enc('bats', bats[0], 12, 7) + enc('bats', bats[0], -6, 10)) + g('f1', enc('bats', bats[1], 0, 0) + enc('bats', bats[1], 12, 7) + enc('bats', bats[1], -6, 10)))
clouds.forEach((c, i) => {
  body += g(`cl x${i}`, enc('clouds', c.r, 0, c.y))
  timing += `.x${i}{animation-duration:${c.dur}s;animation-delay:-${f(c.dur * c.at)}s}`
})
body += g('ss', enc('stars', shooting, 150, 20))
body += enc('storm', storm)
const skyRect = `d="M0 0h${W}v${S.SKY_END}h-${W}z"`
body += g('fl', `<path class="${k('flash')}" ${skyRect}/>`) + g('fs', `<path class="${k('flash')}" ${skyRect}/><path class="${k('flash')}" ${skyRect}/>`)
// La silhouette géante, noire sur le ciel rougi, le temps du grand éclair.
body += g('gi', enc('giant', giant) + enc('giant', giantEyes))
body += g('b1', enc('bolts', bolts[0])) + g('b2', enc('bolts', bolts[1]))
// Le projecteur du laboratoire balaie le ciel.
body += g('sw', `<path class="${k('beam')}" d="M${lab.x} ${lab.y}l-26 -150l34 -4z"/>`)
body += enc('back', back)
garland.forEach((r, i) => {
  body += g(`gl y${i}`, enc('garland', r))
  timing += `.y${i}{animation-delay:-${f(i * 0.6)}s}`
})
body += g('tv', enc('lights', tv)) + g('an', enc('lights', antenna)) + g('ow', enc('lights', owl))
body += g('la', enc('lamps', lampLights[0])) + g('lo', g('lb', enc('lamps', lampLights[1])))
body += g('rg', enc('rift', rift)) + g('rv', enc('rift', veins))
body += g('ne', enc('lights', neon))
body += g('ty', enc('swing', swing, S.TREE.branch.x - 4, S.TREE.branch.y))
;[0, 1, 2].forEach(i => {
  body += g(`sm m${i}`, enc('smoke', smoke, 73, 108))
  timing += `.m${i}{animation-delay:-${f(i * 2.4)}s}`
})
body += g('MX', g('MO', g('f0', enc('beast', beast[0])) + g('f1', enc('beast', beast[1])) + g('ey', enc('beast', beastEyes))))
body += g(
  'KX',
  `<g class="sh">${enc('kids', convoy.shadow, 0, A.KID.h - 1)}</g>` +
    g(
      'KF',
      g(
        'KH',
        g('kb', enc('kids', convoy.beams)) +
          g('KR', g('f0', enc('kids', convoy.ride[0])) + g('f1', enc('kids', convoy.ride[1]))) +
          g('KS', enc('kids', convoy.stop)) +
          enc('kids', convoy.base),
      ),
    ),
)
body += enc('front', front)
fogs.forEach((fg, i) => {
  body += g(`fg w${i}`, enc('fog', fg.r, fg.x, fg.y))
  timing += `.w${i}{animation-duration:${fg.dur}s;animation-delay:-${f(fg.dur * 0.37 * (i + 1))}s}`
})
spores.forEach((r, i) => {
  body += g(`sp z${i}`, enc('spores', r))
  timing += `.z${i}{animation-delay:-${f((16 / SPORES) * i)}s}`
})
// L'écran cathodique : des lignes de balayage, et une barre qui descend.
const scan = `<defs><pattern id="scan" width="1" height="1" patternUnits="userSpaceOnUse"><rect y=".5" width="1" height=".5" fill="#000"/></pattern></defs>`
body += `<rect width="${W}" height="${H}" fill="url(#scan)" opacity=".14"/><rect class="ro" width="${W}" height="2" fill="#fff" opacity=".04"/>`

css += 'path{fill:currentColor}.s{fill:none;stroke:currentColor}.a{stroke-dasharray:1 3}.b{stroke-dasharray:1 1}'
css += PAL.cssOpacity()
// Sans animation (mouvement réduit), les acteurs restent hors de la scène.
css += `.KX{transform:translate(-200px,${KIDS_Y}px)}.MO,.gi,.fl,.fs,.b1,.b2,.bt,.ss{opacity:0}.sh{opacity:.5}`
css += `@keyframes cl{from{transform:translateX(-80px)}to{transform:translateX(${W + 10}px)}}.cl{animation:cl 400s steps(${W + 90}) infinite}`
css += '@keyframes tw{0%{opacity:1}50%{opacity:.2}}.t1{animation:tw 3.4s step-end infinite}.t2{animation:tw 5.2s step-end -2s infinite}'
css += '@keyframes ha{0%{opacity:1}50%{opacity:0}}@keyframes hb{0%{opacity:0}50%{opacity:1}}'
css += `.f0{animation:ha ${f(RIDE * 3)}s step-end infinite}.f1{animation:hb ${f(RIDE * 3)}s step-end infinite}.MO .f0,.MO .f1{animation-duration:1.4s}.bt .f0,.bt .f1{animation-duration:.3s}`
// L'orage : un éclair toutes les onze secondes, le ciel rougit deux fois.
css += '@keyframes fl{0%{opacity:0}79%{opacity:.8}80%{opacity:0}81%{opacity:.5}84%{opacity:0}}.fl{animation:fl 11s step-end infinite}'
css += '@keyframes b1{0%{opacity:0}79%{opacity:1}80%{opacity:0}81%{opacity:.8}82.5%{opacity:0}}.b1{animation:b1 11s step-end infinite}'
css += `@keyframes st{${strikeFrames}}.fs,.b2,.gi{animation:st ${T}s step-end infinite}`
css += `@keyframes sw{from{transform:rotate(-14deg)}to{transform:rotate(20deg)}}.sw{transform-origin:${lab.x}px ${lab.y}px;animation:sw 13s ease-in-out infinite alternate}`
css += '@keyframes gl{0%{opacity:1}50%{opacity:.1}}.gl{animation:gl 2.4s step-end infinite}'
css += '@keyframes tv{0%{opacity:.5}9%{opacity:.9}17%{opacity:.3}26%{opacity:.75}41%{opacity:.2}48%{opacity:.85}63%{opacity:.45}71%{opacity:1}84%{opacity:.35}92%{opacity:.7}}.tv{animation:tv 4.3s step-end infinite}'
css += '@keyframes an{0%{opacity:1}55%{opacity:0}}.an{animation:an 1.8s step-end infinite}'
css += '@keyframes ow{0%{opacity:1}46%{opacity:0}48%{opacity:1}88%{opacity:0}89.5%{opacity:1}93%{opacity:0}94.5%{opacity:1}}.ow{animation:ow 7s step-end infinite}'
css += '@keyframes la{0%{opacity:1}91%{opacity:.8}93%{opacity:1}}.la{animation:la 9s step-end infinite}'
css += '@keyframes lb{0%{opacity:1}62%{opacity:.15}63%{opacity:1}65%{opacity:.1}68%{opacity:1}88%{opacity:.4}89%{opacity:1}}.lb{animation:lb 7s step-end infinite}'
css += `@keyframes lo{${blackout}}.lo{animation:lo ${T}s step-end infinite}`
css += '@keyframes rg{from{opacity:.45}to{opacity:1}}.rg{animation:rg 2.6s ease-in-out infinite alternate}'
css += '@keyframes rv{from{opacity:0}to{opacity:.9}}.rv{animation:rv 1.3s ease-in-out infinite alternate}'
css += '@keyframes ne{0%{opacity:1}71%{opacity:.2}72%{opacity:1}74%{opacity:.3}76%{opacity:1}}.ne{animation:ne 5.5s step-end infinite}'
css += '@keyframes ss{0%{transform:translate(0,0);opacity:0}1%{opacity:1;animation-timing-function:steps(18)}4%{transform:translate(72px,36px);opacity:1}4.1%{opacity:0}100%{transform:translate(0,0);opacity:0}}.ss{animation:ss 47s step-end infinite}'
css += `@keyframes ty{from{transform:rotate(-5deg)}to{transform:rotate(5deg)}}.ty{transform-origin:${S.TREE.branch.x + 0.5}px ${S.TREE.branch.y}px;animation:ty 3.6s ease-in-out infinite alternate}`
css += '@keyframes sm{0%{transform:translate(0,0);opacity:0}15%{opacity:1}100%{transform:translate(-8px,-26px);opacity:0}}.sm{animation:sm 7.2s steps(24) infinite}'
css += `@keyframes bt{0%{transform:translate(20px,74px);opacity:1;animation-timing-function:steps(60)}22%{transform:translate(190px,26px);opacity:1}22.1%{opacity:0}100%{transform:translate(20px,74px);opacity:0}}.bt{animation:bt 31s infinite}`
css += '@keyframes ey{0%{opacity:1}50%{opacity:.55}}.ey{animation:ey .8s step-end infinite}'
css += '@keyframes kb{0%{opacity:1}93%{opacity:.7}95%{opacity:1}}.kb{animation:kb 2.3s step-end infinite}'
css += '@keyframes fg{from{transform:translateX(-36px)}to{transform:translateX(36px)}}.fg{animation:fg 50s linear infinite alternate}'
css += '@keyframes sp{0%{transform:translateY(10px);opacity:0}14%{opacity:.9}78%{opacity:.5}100%{transform:translateY(-46px);opacity:0}}.sp{animation:sp 16s steps(56) infinite}'
css += `@keyframes ro{from{transform:translateY(-4px)}to{transform:translateY(${H + 4}px)}}.ro{animation:ro 9s steps(${H + 8}) infinite}`
css += convoyCss() + beastCss()
// Les décalages propres à chaque élément, après les règles « animation » qu'ils précisent.
css += timing
css += '@media (max-aspect-ratio:3/4){.wd{transform:translateX(-170px)}}'
css += '@media (prefers-reduced-motion:reduce){*{animation:none!important}}'
css += PAL.css('d')

const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges">`
const scene = `${open}${scan}<style>${css}</style><g class="wd">${body}</g></svg>`
if (/style=|var\(/.test(scene)) throw new Error('style en attribut ou variable CSS dans la scène')
if (OUT) {
  fs.writeFileSync(`${OUT}/frissons.svg`, scene)
  // Relecture de la rencontre : la même scène, avancée à ses moments clés.
  const cast = ['KX', 'KF', 'KH', 'KR', 'KS', 'MX', 'MO', 'fs', 'b2', 'gi', 'lo'].map(c => `.${c}`).join(',')
  for (const sec of [14, 29, 31, 35, 45, 58]) {
    fs.writeFileSync(`${OUT}/frissons-${sec}s.svg`, scene.replace('</style>', `${cast}{animation-delay:-${sec}s}</style>`))
  }
}

console.log('pièces :', Object.entries(sizes).map(([n, v]) => `${n} ${v}`).join(', '))
console.log(`css ${css.length}, total ${scene.length} / 131072`)
if (scene.length > LIMIT) {
  console.error(`TROP LONG : ${scene.length} > ${LIMIT}`)
  process.exitCode = 1
}

const hooks = path.join(PLUGIN, 'hooks')
fs.writeFileSync(
  path.join(hooks, 'scene-frissons.js'),
  `// Généré par dessin/frissons-build.mjs : ne pas modifier à la main.\nexport const SCENE = ${JSON.stringify(scene)}\n`,
)
fs.writeFileSync(path.join(hooks, 'scene-frissons.d.ts'), 'export const SCENE: string\n')
