import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs, Timer } from 'claude-code'

import type { Dressing } from '../types'
import { FRISSONS, PARIS } from './palettes.js'
import { SCENE as FRISSONS_SVG } from './scene-frissons.js'
import {
  AMBIENT,
  CSS_DAY,
  CSS_NIGHT,
  LOOP_CLASSES,
  LOOP_SECONDS,
  RAT_AT,
  RAT_BODY,
  RAT_CSS,
  SVG_BODY,
  SVG_END,
  SVG_OPEN,
} from './scene-paris.js'

// Deux décors en pixel art animé, derrière la conversation de l'app :
// « Morkie à Paris », un petit chien sur un quai de Seine (le jour en mode
// clair, la nuit en mode sombre), et « Frissons 80 », une nuit des années 80.

const PLUGIN = 'decors-pixel'
const COMMAND = 'decor'

type Decor = 'paris' | 'frissons'
type Variant = 'auto' | 'jour' | 'nuit' | 'heure'
type ParisScene = Exclude<Variant, 'heure'>

const PARIS_SCENES: Record<ParisScene, string> = {
  auto: 'paris-auto',
  jour: 'paris-jour',
  nuit: 'paris-nuit',
}
const FRISSONS_SCENE = 'frissons-80'

// Le voile et le flou se règlent par lumière : chaque décor, en clair (jour) et en
// sombre (nuit). Un thème clair et un thème sombre ne demandent pas le même voile.
type Light = `${Decor}-${'jour' | 'nuit'}`

// Le voile (en %) et le flou de départ de chaque lumière ; chacune garde les siens.
// Paris de nuit sans flou : ses pixels restent nets derrière les panneaux.
const GLASS: Record<Light, { veil: number; blur: number }> = {
  'paris-jour': { veil: 60, blur: 5 },
  'paris-nuit': { veil: 60, blur: 0 },
  'frissons-jour': { veil: 70, blur: 3 },
  'frissons-nuit': { veil: 50, blur: 2 },
}
// Le voile de plus sous les bandeaux, en %, au départ : aucun.
const BAND_VEIL: Record<Light, number> = { 'paris-jour': 0, 'paris-nuit': 0, 'frissons-jour': 0, 'frissons-nuit': 0 }
// À 0, les panneaux de l'app sont tout à fait transparents : le texte est posé sur le décor.
const VEIL_MIN = 0
const VEIL_MAX = 95
const BLUR_MAX = 16
// Mode « heure » : le jour de 8 h à 21 h, la nuit le reste du temps.
const DAY_FROM = 8
const DAY_UNTIL = 21
const CHECK_EVERY_MS = 60_000

type Drawing = { source: string; alt: string }

const PARIS_ALT =
  'Pixel art : un Morkie crème et un chat gris jouent sur un quai de Seine, devant la tour Eiffel ; une horloge de rue donne l\'heure.'
const PARIS_NIGHT_ALT =
  'Pixel art : un Morkie crème et un chat gris jouent la nuit sur un quai de Seine, devant la tour Eiffel illuminée ; une horloge de rue donne l\'heure.'

// Une fois par heure, à la demie, un rat traverse la rue de Paris, et le chien et le
// chat le prennent en chasse : ce tour remplace un tour de leur boucle. Il a sa scène,
// du nom de celle de Paris suivi de cette marque ; quand « /decor rat » le rejoue,
// la seconde de son départ suit la marque. C'est le changement de nom de la scène
// qui fait redessiner le décor par l'app, au début du tour puis à sa fin.
const RAT_MARK = '-rat'
const RAT_ALT = ' Un rat traverse la rue, le chien et le chat à ses trousses.'

const secondsOf = (now: Date) => Math.floor(now.getTime() / 1000)
const inHourOf = (now: Date) => now.getMinutes() * 60 + now.getSeconds()

// Le tour du rat en cours à cet instant, comme la fin d'un nom de scène : rien, la
// marque seule (le tour de la demie), ou la marque et la seconde où on l'a rejoué.
function chaseOf(now: Date, replay: number | undefined): string {
  if (replay !== undefined && secondsOf(now) - replay < LOOP_SECONDS) {
    return `${RAT_MARK}-${replay}`
  }
  const inHour = inHourOf(now)

  return inHour >= RAT_AT && inHour < RAT_AT + LOOP_SECONDS ? RAT_MARK : ''
}

// Dans combien de millisecondes la scène change d'elle-même : au début du prochain
// tour du rat, ou à la fin de celui qui se joue.
function untilNextTurn(now: Date, replay: number | undefined): number {
  const inHour = inHourOf(now) + now.getMilliseconds() / 1000
  const hourly =
    inHour < RAT_AT
      ? RAT_AT - inHour
      : inHour < RAT_AT + LOOP_SECONDS
        ? RAT_AT + LOOP_SECONDS - inHour
        : 3600 - inHour + RAT_AT
  const replayed = replay === undefined ? hourly : replay + LOOP_SECONDS - now.getTime() / 1000

  // un rien après l'heure dite : la scène se relit à la seconde entière
  return Math.ceil(Math.max(0, Math.min(hourly, replayed)) * 1000) + 50
}

// Ce que l'heure du poste règle dans la scène de Paris, à chaque dessin : chaque
// animation part d'autant de secondes qu'il s'en est écoulé, pour qu'un dessin refait
// reprenne là où le précédent en était. La boucle du chien et du chat (`loopAt`
// secondes après son début), ce qui dérive lentement (nuages, bateau, oiseaux,
// feuilles), puis l'horloge de rue, dont une aiguille tourne en une heure et l'autre
// en douze, et la tour, qui scintille cinq minutes à chaque heure pile.
function timingCss(now: Date, loopAt: number): string {
  const inHour = inHourOf(now)
  const inHalfDay = (now.getHours() % 12) * 3600 + inHour
  const seconds = secondsOf(now)
  const drift = AMBIENT.map(([name, period, phase]) => {
    const at = ((seconds % period) + phase * period) % period

    return `.${name}{animation-delay:-${Math.round(at * 10) / 10}s}`
  }).join('')

  return `${LOOP_CLASSES}{animation-delay:-${loopAt}s}${drift}.hM{animation-delay:-${inHour}s}.hH{animation-delay:-${inHalfDay}s}.sk{animation-delay:-${inHour}s}`
}

// Le dessin d'une scène, par son nom. Paris a le même dessin le jour et la
// nuit : seules les couleurs changent, et « auto » suit le mode de l'app.
function drawingOf(scene: string, now: Date): Drawing | undefined {
  if (scene === FRISSONS_SCENE) {
    return {
      source: FRISSONS_SVG,
      alt: 'Pixel art, une nuit des années 80 : des enfants à vélo au bord d\'une forêt, une bête à crâne de cerf sortie d\'une faille rouge, un orage, une maison à la guirlande.',
    }
  }
  const mark = scene.indexOf(RAT_MARK)
  const paris = mark < 0 ? scene : scene.slice(0, mark)
  let colors: string

  if (paris === PARIS_SCENES.auto) {
    colors = `${CSS_DAY}@media (prefers-color-scheme:dark){${CSS_NIGHT}}`
  } else if (paris === PARIS_SCENES.jour) {
    colors = CSS_DAY
  } else if (paris === PARIS_SCENES.nuit) {
    colors = CSS_DAY + CSS_NIGHT
  } else {
    return undefined
  }
  const alt = paris === PARIS_SCENES.nuit ? PARIS_NIGHT_ALT : PARIS_ALT

  if (mark < 0) {
    return { source: SVG_OPEN + colors + timingCss(now, inHourOf(now) % LOOP_SECONDS) + SVG_BODY + SVG_END, alt }
  }
  // Le tour du rat : commencé à la demie, ou à la seconde que porte le nom de la scène.
  // Il ne se joue qu'une fois : passé sa durée, le dessin reste sur sa dernière image.
  const from = scene.slice(mark + RAT_MARK.length + 1)
  const since = from === '' ? inHourOf(now) - RAT_AT : secondsOf(now) - Number(from)
  const loopAt = since >= 0 && since < LOOP_SECONDS ? since : LOOP_SECONDS

  return {
    source: SVG_OPEN + colors + RAT_CSS + timingCss(now, loopAt) + SVG_BODY + RAT_BODY + SVG_END,
    alt: alt + RAT_ALT,
  }
}

function isDecor(value: unknown): value is Decor {
  return value === 'paris' || value === 'frissons'
}

function isVariant(value: unknown): value is Variant {
  return value === 'auto' || value === 'jour' || value === 'nuit' || value === 'heure'
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.NaN

  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

// Le décor choisi, la scène de Paris, la lumière affichée, son voile, son flou, et
// le voile de plus sous les bandeaux.
type Settings = { decor: Decor; variant: Variant; light: Light; veil: number; blur: number; bandVeil: number }

// Le jour, la nuit, ou « auto » : en mode « heure », l'heure locale du poste décide.
// Pour Paris, c'est la scène et le thème de l'app ; pour Frissons 80, le thème seul
// (clair ou sombre), son décor restant de nuit.
function phaseOf(variant: Variant, hour: number): ParisScene {
  if (variant !== 'heure') {
    return variant
  }

  return hour >= DAY_FROM && hour < DAY_UNTIL ? 'jour' : 'nuit'
}

// La lumière dont on prend le voile et le flou. « auto » suit le mode de l'app, que
// le mod ne voit pas : il prend les réglages de la nuit.
function lightOf(decor: Decor, variant: Variant, hour: number): Light {
  return `${decor}-${phaseOf(variant, hour) === 'jour' ? 'jour' : 'nuit'}`
}

async function readGlass($: EngineInterface, light: Light): Promise<Pick<Settings, 'light' | 'veil' | 'blur' | 'bandVeil'>> {
  return {
    light,
    veil: clamp(await $.store.get(`voile-${light}`), VEIL_MIN, VEIL_MAX, GLASS[light].veil),
    blur: clamp(await $.store.get(`flou-${light}`), 0, BLUR_MAX, GLASS[light].blur),
    bandVeil: clamp(await $.store.get(`fond-${light}`), 0, VEIL_MAX, BAND_VEIL[light]),
  }
}

async function readSettings($: EngineInterface, hour: number): Promise<Settings> {
  const kept = await $.store.get('decor')
  const scene = await $.store.get('variant')
  const decor: Decor = isDecor(kept) ? kept : 'paris'
  const variant: Variant = isVariant(scene) ? scene : 'auto'

  return { decor, variant, ...(await readGlass($, lightOf(decor, variant, hour))) }
}

// Le nom de la scène affichée pour ces réglages, à cette heure ; `chase` : le tour du
// rat en cours (`chaseOf`), que seul Paris connaît.
function sceneOf(settings: Settings, hour: number, chase: string): string {
  return settings.decor === 'frissons' ? FRISSONS_SCENE : PARIS_SCENES[phaseOf(settings.variant, hour)] + chase
}

function look(settings: Settings, hour: number, chase: string): ThemeSetArgs {
  // Le voile prend la couleur des panneaux de l'app, claire ou sombre.
  const backdrop = {
    scene: sceneOf(settings, hour, chase),
    glass: { blur: settings.blur, opacity: settings.veil / 100 },
  }

  const colors = settings.decor === 'frissons' ? FRISSONS : PARIS
  const phase = phaseOf(settings.variant, hour)

  if (phase === 'jour') {
    return { colors, overrideColorScheme: 'light', backdrop }
  }
  if (phase === 'nuit') {
    return { colors, overrideColorScheme: 'dark', backdrop }
  }

  // « auto » : l'app garde son mode, et prend la moitié des couleurs qui lui va.
  return { colors, backdrop }
}

function describe(settings: Settings): string {
  const of = settings.light.endsWith('-jour') ? ' (réglages du jour)' : ' (réglages de la nuit)'
  const glass = `voile ${settings.veil} %, flou ${settings.blur}${of}`
  const hours = `de ${DAY_FROM} h à ${DAY_UNTIL} h`

  if (settings.decor === 'frissons') {
    const theme =
      settings.variant === 'auto'
        ? "celui de l'app"
        : settings.variant === 'heure'
          ? `selon l'heure (clair ${hours}, sombre ensuite)`
          : settings.variant === 'jour'
            ? 'clair'
            : 'sombre'

    return `Décor Frissons 80 : thème ${theme}, ${glass}.`
  }
  const scene =
    settings.variant === 'auto'
      ? 'automatique (jour en mode clair, nuit en mode sombre)'
      : settings.variant === 'heure'
        ? `selon l'heure (jour ${hours}, nuit ensuite)`
        : settings.variant

  return `Décor Morkie à Paris : scène ${scene}, ${glass}.`
}

// L'habillage du texte par-dessus le décor : les bandeaux des autres mods, au-dessus
// de la saisie, sont aérés (un peu d'espace entre leurs lignes) et peuvent recevoir
// un voile de plus, à eux seuls. Le dessin le lit dans l'état de la session ;
// `$.store` garde les choix d'une session à l'autre.
const DRESSING_START: Dressing = { bands: true, veil: 0, tone: 'auto' }
// La marque change quand les champs changent : elle écarte ce qu'une version d'avant
// a laissé dans l'état de la session, qui survit à un rechargement du mod.
const dressing = atom({ plugin: 'decors-pixel', key: 'dressing' } as const, DRESSING_START, { shape: 'habillage-8' })
// La teinte du voile des bandeaux, celle des panneaux de l'app : papier en clair,
// nuit en sombre. Le moteur ne floute pas une zone plus qu'une autre ; ce voile
// éclaircit ou assombrit la sienne, par-dessus le voile et le flou de la fenêtre.
const BAND_TINT = { light: '252, 249, 243', dark: '11, 13, 26' }

async function readBands($: EngineInterface): Promise<boolean> {
  return (await $.store.get('bandeaux')) !== false
}

// Le mode de l'app sous ces réglages, quand le mod le connaît.
function toneOf(settings: Settings, hour: number): Dressing['tone'] {
  const phase = phaseOf(settings.variant, hour)

  return phase === 'jour' ? 'light' : phase === 'nuit' ? 'dark' : 'auto'
}

function describeBands(bands: boolean, settings: Settings, hour: number): string {
  const veil =
    settings.bandVeil === 0
      ? 'sans fond'
      : toneOf(settings, hour) === 'auto'
        ? `fond ${settings.bandVeil} %, qui ne se pose pas en « auto » (choisir heure, jour ou nuit)`
        : `fond ${settings.bandVeil} %`

  return `Bandeaux : ${bands ? 'aérés' : 'serrés'}, ${veil}.`
}

// Pose le thème de ces réglages et met l'habillage à jour : l'écriture de l'état
// redessine d'elle-même les bandeaux.
async function show($: EngineInterface, settings: Settings, hour: number, chase: string) {
  const bands = await readBands($)
  const tone = toneOf(settings, hour)

  await update($, dressing, () => ({ bands, veil: settings.bandVeil, tone }))

  return $.theme.set(look(settings, hour, chase))
}

// La durée d'un tour du rat, en clair.
const CHASE_LASTS =
  LOOP_SECONDS % 60 === 0 ? `${LOOP_SECONDS / 60} min` : `${Math.floor(LOOP_SECONDS / 60)} min ${LOOP_SECONDS % 60} s`

const HELP =
  'Usage : /decor paris | frissons pour choisir le décor ; /decor auto | jour | nuit | heure pour le jour ou la nuit (Paris : la scène et le thème ; Frissons 80 : le thème clair ou sombre seul ; heure : jour de 8 h à 21 h) ; /decor voile 0-95 et /decor flou 0-16 pour régler le décor affiché (voile plus bas = décor plus visible) ; /decor bandeaux oui | non pour aérer les lignes des bandeaux et /decor fond 0-95 pour un voile de plus sous eux seuls (0 : aucun) ; /decor rat pour rejouer tout de suite la poursuite du rat, qui passe dans Paris une fois par heure, à la demie.'

const isCount = (word: string | undefined): word is string => word !== undefined && /^[0-9]+$/.test(word)

// Ce que demande une ligne de commande, mot par mot ; un mot inconnu annule tout.
type Ask =
  | { decor: Decor }
  | { variant: Variant }
  | { veil: number }
  | { blur: number }
  | { bandVeil: number }
  | { bands: boolean }
  | { replay: true }

const isYesNo = (word: string | undefined): word is 'oui' | 'non' => word === 'oui' || word === 'non'

function parse(args: string): Ask[] | { unknown: string } {
  const words = args.toLowerCase().split(' ').filter(Boolean)
  const asks: Ask[] = []

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const amount = words[i + 1]

    if (isDecor(word)) {
      asks.push({ decor: word })
    } else if (isVariant(word)) {
      asks.push({ variant: word })
    } else if (word === 'voile' && isCount(amount)) {
      asks.push({ veil: Number(amount) })
      i++
    } else if (word === 'flou' && isCount(amount)) {
      asks.push({ blur: Number(amount) })
      i++
    } else if (word === 'fond' && isCount(amount)) {
      asks.push({ bandVeil: Number(amount) })
      i++
    } else if ((word === 'bandeaux' || word === 'bandeau') && isYesNo(amount)) {
      asks.push({ bands: amount === 'oui' })
      i++
    } else if (word === 'rat') {
      asks.push({ replay: true })
    } else {
      return { unknown: word ?? '' }
    }
  }

  return asks
}

// Ce que le mod retient le temps d'une session ; un rechargement le remet à zéro.
const stage: {
  // Ce que le décor montre (sa scène et sa lumière), pour ne le reposer que s'il change.
  shown: string
  // « /decor rat » : la seconde où la poursuite rejouée a commencé.
  replay: number | undefined
  // La minuterie armée sur le prochain changement de scène.
  wake: Timer | undefined
  // Posée au démarrage de la session : relit l'heure et réarme la minuterie.
  recheck: (() => Promise<void>) | undefined
} = { shown: '', replay: undefined, wake: undefined, recheck: undefined }

function keyOf(settings: Settings, hour: number, chase: string): string {
  return `${sceneOf(settings, hour, chase)} ${settings.light}`
}

// Regarde l'heure et repose le décor s'il doit changer : le jour ou la nuit qui
// tombe en mode « heure », le tour du rat qui commence ou qui finit. Puis s'arme
// pour le prochain changement.
async function refresh($: EngineInterface): Promise<void> {
  const now = new Date(await $.clock.now())
  const hour = now.getHours()
  // relus à cette heure : le jour et la nuit ont chacun leur voile et leur flou
  const settings = await readSettings($, hour)

  if (stage.replay !== undefined && secondsOf(now) - stage.replay >= LOOP_SECONDS) {
    stage.replay = undefined
  }
  const chase = chaseOf(now, stage.replay)
  const key = keyOf(settings, hour, chase)

  if (key !== stage.shown) {
    stage.shown = key
    await show($, settings, hour, chase)
  }
  stage.wake?.cancel()
  stage.wake = $.clock.after(untilNextTurn(now, stage.replay), () => refresh($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        'Décors en pixel art : choisir le décor (paris, frissons), la scène de Paris, le voile, le flou ou les bandeaux aérés',
      argumentHint:
        'paris | frissons | auto | jour | nuit | heure | voile 0-95 | flou 0-16 | bandeaux oui/non | fond 0-95 | rat',
    })

    // une session qui commence repart de zéro, même sans rechargement du mod
    stage.wake?.cancel()
    stage.shown = ''
    stage.replay = undefined
    stage.recheck = () => refresh($)
    await refresh($)
    // Un filet, chaque minute : la minuterie du prochain changement peut manquer son
    // heure (poste en veille), et un réglage a pu changer depuis une autre session.
    $.clock.every(CHECK_EVERY_MS, () => refresh($))

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const asks = parse(e.args)

    if (!Array.isArray(asks)) {
      return { text: `Je ne connais pas « ${asks.unknown} ».\n${HELP}` }
    }
    const now = new Date(await $.clock.now())
    const hour = now.getHours()
    let settings = await readSettings($, hour)
    let bands = await readBands($)
    let wantsChase = false

    if (asks.length === 0) {
      return { text: `${describe(settings)}\n${describeBands(bands, settings, hour)}\n${HELP}` }
    }
    // Dans l'ordre des mots : « frissons voile 40 » règle le voile de Frissons 80,
    // « jour voile 30 » celui du jour.
    for (const ask of asks) {
      if ('decor' in ask) {
        await $.store.set('decor', ask.decor)
        settings = { ...settings, decor: ask.decor, ...(await readGlass($, lightOf(ask.decor, settings.variant, hour))) }
      } else if ('variant' in ask) {
        await $.store.set('variant', ask.variant)
        settings = { ...settings, variant: ask.variant, ...(await readGlass($, lightOf(settings.decor, ask.variant, hour))) }
      } else if ('veil' in ask) {
        settings = { ...settings, veil: clamp(ask.veil, VEIL_MIN, VEIL_MAX, GLASS[settings.light].veil) }
        await $.store.set(`voile-${settings.light}`, settings.veil)
      } else if ('blur' in ask) {
        settings = { ...settings, blur: clamp(ask.blur, 0, BLUR_MAX, GLASS[settings.light].blur) }
        await $.store.set(`flou-${settings.light}`, settings.blur)
      } else if ('bandVeil' in ask) {
        settings = { ...settings, bandVeil: clamp(ask.bandVeil, 0, VEIL_MAX, BAND_VEIL[settings.light]) }
        await $.store.set(`fond-${settings.light}`, settings.bandVeil)
      } else if ('bands' in ask) {
        bands = ask.bands
        await $.store.set('bandeaux', bands)
      } else {
        wantsChase = true
      }
    }
    // Le rat ne passe que dans Paris : la poursuite part de cette seconde.
    let chased = ''

    if (wantsChase && settings.decor === 'paris') {
      stage.replay = secondsOf(now)
      chased = `\nUn rat traverse la rue : la poursuite se joue maintenant, pendant ${CHASE_LASTS}.`
    } else if (wantsChase) {
      chased = '\nLe rat ne passe que dans Paris : /decor paris rat.'
    }
    const chase = chaseOf(now, stage.replay)

    stage.shown = keyOf(settings, hour, chase)
    const set = await show($, settings, hour, chase)
    const note = set.isDrawn ? '' : `\n(Rien ne l'affiche ici : ${set.reason})`

    // la minuterie de la session se règle sur la fin de la poursuite rejouée
    await stage.recheck?.()

    return { text: `${describe(settings)}\n${describeBands(bands, settings, hour)}${chased}${note}` }
  })


  // Les bandeaux des autres mods : aérés (un peu d'espace entre leurs lignes) et, à
  // la demande, posés sur un voile à eux. Le moteur empile les lignes qu'on lui
  // passe ; pour glisser l'espace entre elles, on les lui passe une à une.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    const dress = await read($, dressing)
    const isSpaced = dress.bands && e.props.rows.length > 1
    // Paris en « auto » suit le mode de l'app, que le mod ne voit pas : pas de voile.
    const fill =
      dress.veil > 0 && dress.tone !== 'auto' && e.props.rows.length > 0
        ? `rgba(${BAND_TINT[dress.tone]}, ${dress.veil / 100})`
        : undefined

    if (!isSpaced && fill === undefined) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    const lines = []

    if (isSpaced) {
      for (const row of e.props.rows) {
        lines.push(await next({ ...e, props: { ...e.props, rows: [row] } }))
      }
    } else {
      lines.push(await next(e))
    }
    const spaced = isSpaced ? ({ rowGap: 'sm' } as const) : {}
    const veiled = fill === undefined ? {} : ({ backgroundColor: fill, paddingX: 1, paddingY: 'xs' } as const)

    return (
      <Box flexDirection="column" {...spaced} {...veiled}>
        {lines}
      </Box>
    )
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    // Le décor d'un autre mod reste à son auteur.
    if (e.props.plugin !== PLUGIN) {
      return next(e)
    }
    const drawing = drawingOf(e.props.scene, new Date(await $.clock.now()))

    if (drawing === undefined) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return <Svg source={drawing.source} alt={drawing.alt} isInteractive />
  })
}
