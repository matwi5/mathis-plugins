import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { FRISSONS, PARIS } from '../hooks/palettes.js'
import { LOOP_CLASSES, LOOP_SECONDS } from '../hooks/scene-paris.js'

const BACKDROP = {
  plugin: 'decors-pixel',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'paris-auto', plugin: 'decors-pixel', glass: { blur: 0, opacity: 0.62 } },
} as const

// La limite d'un Svg : au-delà, la scène entière est refusée.
const SVG_LIMIT = 131072

// Les scènes de Paris, celles du tour du rat (les plus longues) et Frissons 80.
const SCENES = ['paris-auto', 'paris-jour', 'paris-nuit', 'paris-auto-rat', 'paris-jour-rat', 'paris-nuit-rat', 'frissons-80']

test('chaque scène est un Svg complet, sous la limite de taille', async ($, on) => {
  on('clock.now', () => ({ value: new Date(2026, 10, 16, 12, 0).getTime() }))
  for (const scene of SCENES) {
    const ui = await $.ui.mount({ ...BACKDROP, props: { ...BACKDROP.props, scene }, surface: 'desktop' })
    const svg = await ui.find({ type: 'Svg' })
    const source = String(svg?.props.source ?? '')

    expect(source.startsWith('<svg')).toBe(true)
    expect(source.endsWith('</svg>')).toBe(true)
    expect(source.length < SVG_LIMIT).toBe(true)
    // Paris : la nuit n'arrive par le mode sombre qu'en « auto »
    expect(source.includes('prefers-color-scheme')).toBe(scene.startsWith('paris-auto'))
    await ui.unmount()
  }
})

const sourceOf = async ($: Parameters<TestBody>[0], scene: string) => {
  const ui = await $.ui.mount({ ...BACKDROP, props: { ...BACKDROP.props, scene }, surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source ?? '')

  await ui.unmount()

  return source
}

test("l'horloge de Paris est mise à l'heure du poste", async ($, on) => {
  // 15 h 30 min 20 s : 1 820 s dans l'heure, 12 620 s depuis midi
  on('clock.now', () => ({ value: new Date(2026, 10, 16, 15, 30, 20).getTime() }))
  for (const scene of ['paris-auto', 'paris-jour', 'paris-nuit']) {
    const ui = await $.ui.mount({ ...BACKDROP, props: { ...BACKDROP.props, scene }, surface: 'desktop' })
    const source = String((await ui.find({ type: 'Svg' }))?.props.source ?? '')

    // l'horloge, et le scintillement de la tour, calé sur l'heure pile
    expect(source.includes('.hM{animation-delay:-1820s}.hH{animation-delay:-12620s}.sk{animation-delay:-1820s}</style>')).toBe(
      true,
    )
    expect(source.includes('.sk{animation:sk 3600s step-end infinite}')).toBe(true)
    // la boucle du chien et du chat, calée de même : 1 820 s, soit 20 s dans son tour
    expect(LOOP_SECONDS).toBe(150)
    expect(source.includes(`${LOOP_CLASSES}{animation-delay:-20s}`)).toBe(true)
    // et ce qui dérive (ici un nuage), pour qu'un dessin refait reprenne où il en était
    expect(/\.x0\{animation-delay:-[0-9.]+s\}/.test(source)).toBe(true)
    await ui.unmount()
  }
})

test('le tour du rat est une scène de Paris de plus, jouée une fois depuis la demie', async ($, on) => {
  // 12 h 30 min 40 s : la poursuite a commencé depuis 40 s
  const now = new Date(2026, 10, 16, 12, 30, 40).getTime()

  on('clock.now', () => ({ value: now }))
  for (const scene of ['paris-auto-rat', 'paris-jour-rat', 'paris-nuit-rat']) {
    const source = await sourceOf($, scene)

    // le rat et ses images clés, la poursuite à sa 40e seconde, jouée une seule fois
    expect(source.includes('@keyframes RX{')).toBe(true)
    expect(source.includes('<g class="RX">')).toBe(true)
    expect(source.includes(`${LOOP_CLASSES}{animation-delay:-40s}`)).toBe(true)
    expect(source.includes(`${LOOP_CLASSES}{animation-iteration-count:1;animation-fill-mode:forwards}`)).toBe(true)
    expect(source.length < SVG_LIMIT).toBe(true)
  }
  // la scène ordinaire, au même instant, n'a pas le rat
  expect((await sourceOf($, 'paris-nuit')).includes('@keyframes RX{')).toBe(false)
  // rejouée : la seconde de son départ est dans le nom de la scène
  const seconds = Math.floor(now / 1000)

  expect((await sourceOf($, `paris-nuit-rat-${seconds - 25}`)).includes(`${LOOP_CLASSES}{animation-delay:-25s}`)).toBe(true)
  // passé sa durée, le dessin reste sur sa dernière image : tout le monde hors champ
  expect((await sourceOf($, `paris-nuit-rat-${seconds - 500}`)).includes(`${LOOP_CLASSES}{animation-delay:-150s}`)).toBe(true)
  expect((await sourceOf($, 'paris-nuit-rat-hier')).includes(`${LOOP_CLASSES}{animation-delay:-150s}`)).toBe(true)
})

test('le téléphone reçoit les mêmes scènes', async ($, on) => {
  on('clock.now', () => ({ value: new Date(2026, 10, 16, 12, 0).getTime() }))
  for (const scene of ['paris-auto', 'frissons-80']) {
    const ui = await $.ui.mount({ ...BACKDROP, props: { ...BACKDROP.props, scene }, surface: 'mobile' })

    expect((await ui.find({ type: 'Svg' }))?.type).toBe('Svg')
    await ui.unmount()
  }
})

test("le décor d'un autre mod est laissé à son auteur", async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>autre</Text>
  })
  const ui = await $.ui.mount({
    ...BACKDROP,
    props: { ...BACKDROP.props, plugin: 'un-autre-mod', scene: 'frissons-80' },
    surface: 'desktop',
  })

  expect((await ui.find({ type: 'Text', text: /autre/ }))?.text).toBe('autre')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

// Un faux moteur, sans l'heure : le rangement en mémoire et les thèmes posés.
function shelves(on: Parameters<TestBody>[1]) {
  const kept = new Map<string, unknown>()
  const themes: Record<string, unknown>[] = []

  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => {
    kept.set(e.key, e.value)

    return { value: undefined }
  })
  on('theme.set', (_, e) => {
    themes.push(e)

    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  const scenes = () => themes.map(theme => (theme.backdrop as { scene?: string }).scene)

  return { kept, themes, scenes }
}

// Le même, à une heure du poste que le test change : dix minutes après l'heure, hors
// du tour du rat.
function world(on: Parameters<TestBody>[1], clock: { hour: number }) {
  on('clock.now', () => ({ value: new Date(2026, 10, 16, clock.hour, 10).getTime() }))

  return shelves(on)
}

// Une session ouverte sur une horloge que le test avance : ses minuteries tournent.
async function session($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], now: Date) {
  const time = mock.clock(on, { now: now.getTime() })
  const kept = shelves(on)

  on('session.start', (_, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: {} }) as never)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/w' } as never)
  await time.settle()

  return { time, ...kept }
}

test('à la demie, la scène de Paris passe au tour du rat, puis revient', async ($, on) => {
  const { time, scenes } = await session($, on, new Date(2026, 10, 16, 12, 29, 30))

  expect(scenes()).toEqual(['paris-auto'])
  // 12 h 30 min 1 s : le rat entre
  await time.advance(31_000)
  expect(scenes()).toEqual(['paris-auto', 'paris-auto-rat'])
  // la poursuite finie, la scène ordinaire revient, et rien d'autre ne bouge jusqu'à la demie suivante
  await time.advance(LOOP_SECONDS * 1000)
  expect(scenes()).toEqual(['paris-auto', 'paris-auto-rat', 'paris-auto'])
  await time.advance(50 * 60_000)
  expect(scenes()).toEqual(['paris-auto', 'paris-auto-rat', 'paris-auto'])
  await time.advance(8 * 60_000)
  expect(scenes().at(-1)).toBe('paris-auto-rat')
})

test('/decor rat rejoue la poursuite tout de suite, dans Paris seulement', async ($, on) => {
  const { time, scenes } = await session($, on, new Date(2026, 10, 16, 12, 10))
  const from = Math.floor(time.now() / 1000)
  const ran = await run($, 'nuit rat')

  expect(String(ran.text)).toContain('Un rat traverse la rue : la poursuite se joue maintenant, pendant 2 min 30 s.')
  expect(scenes().at(-1)).toBe(`paris-nuit-rat-${from}`)
  // 40 s plus tard, un dessin refait en est à la 40e seconde de la poursuite
  await time.advance(40_000)
  expect((await sourceOf($, `paris-nuit-rat-${from}`)).includes(`${LOOP_CLASSES}{animation-delay:-40s}`)).toBe(true)
  // un autre réglage, pendant la poursuite, ne l'arrête pas
  await run($, 'voile 30')
  expect(scenes().at(-1)).toBe(`paris-nuit-rat-${from}`)
  // à sa fin, la scène ordinaire revient d'elle-même
  await time.advance((LOOP_SECONDS - 40) * 1000 + 1000)
  expect(scenes().at(-1)).toBe('paris-nuit')
  // Frissons 80 n'a pas de rat
  const refused = await run($, 'frissons rat')

  expect(String(refused.text)).toContain('Le rat ne passe que dans Paris')
  expect(scenes().at(-1)).toBe('frissons-80')
})

test('Frissons 80 ne change pas à la demie', async ($, on) => {
  const { time, scenes } = await session($, on, new Date(2026, 10, 16, 12, 29, 30))

  await run($, 'frissons')
  const before = scenes().length

  await time.advance(5 * 60_000)
  expect(scenes()).toHaveLength(before)
  expect(scenes().at(-1)).toBe('frissons-80')
})

function run($: Parameters<TestBody>[0], args: string) {
  return $.command.run({
    command: 'decor',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

test('la commande retient la scène de Paris, son voile et son flou', async ($, on) => {
  const { kept, themes } = world(on, { hour: 12 })
  const ran = await run($, 'nuit voile 80 flou 3')

  expect(String(ran.text)).toContain('nuit')
  expect(kept.get('variant')).toBe('nuit')
  expect(kept.get('voile-paris-nuit')).toBe(80)
  expect(kept.get('flou-paris-nuit')).toBe(3)
  expect(themes).toHaveLength(1)
  expect(themes[0]).toMatchObject({
    overrideColorScheme: 'dark',
    backdrop: { scene: 'paris-nuit', glass: { blur: 3, opacity: 0.8 } },
  })
})

test('Frissons 80 a son voile et son flou, sans toucher à ceux de Paris', async ($, on) => {
  const { kept, themes } = world(on, { hour: 12 })

  await run($, 'voile 40')
  // sans réglage : le voile et le flou de départ de Frissons 80
  await run($, 'frissons')
  expect(themes[1]).toMatchObject({ backdrop: { scene: 'frissons-80', glass: { blur: 2, opacity: 0.5 } } })
  // en « auto », l'app garde son mode : le thème ne lui en impose aucun
  expect(themes[1]?.overrideColorScheme).toBeUndefined()
  const ran = await run($, 'voile 35 flou 6')

  expect(String(ran.text)).toContain("Décor Frissons 80 : thème celui de l'app")
  expect(kept.get('decor')).toBe('frissons')
  expect(kept.get('voile-frissons-nuit')).toBe(35)
  expect(kept.get('flou-frissons-nuit')).toBe(6)
  expect(themes[2]).toMatchObject({ backdrop: { scene: 'frissons-80', glass: { blur: 6, opacity: 0.35 } } })
  // le retour à Paris retrouve son voile (en « auto », celui de la nuit)
  await run($, 'paris')
  expect(kept.get('voile-paris-nuit')).toBe(40)
  expect(themes[3]).toMatchObject({ backdrop: { scene: 'paris-auto', glass: { blur: 0, opacity: 0.4 } } })
})

test('Frissons 80 a un thème clair et un thème sombre, sous le même décor', async ($, on) => {
  const clock = { hour: 12 }
  const { themes } = world(on, clock)
  const colors = () => Object.keys((themes.at(-1)?.colors as typeof FRISSONS).inputs).sort()

  // jour : le thème clair, son voile et son flou ; le décor reste celui de la nuit
  expect(String((await run($, 'frissons jour')).text)).toContain('Décor Frissons 80 : thème clair, voile 70 %, flou 3')
  expect(themes.at(-1)).toMatchObject({
    overrideColorScheme: 'light',
    backdrop: { scene: 'frissons-80', glass: { blur: 3, opacity: 0.7 } },
  })
  expect(colors()).toEqual(['dark', 'light'])
  // nuit : le thème sombre, le même décor
  await run($, 'nuit')
  expect(themes.at(-1)).toMatchObject({
    overrideColorScheme: 'dark',
    backdrop: { scene: 'frissons-80', glass: { blur: 2, opacity: 0.5 } },
  })
  // heure : clair de 8 h à 21 h, sombre ensuite
  await run($, 'heure')
  expect(themes.at(-1)).toMatchObject({ overrideColorScheme: 'light', backdrop: { scene: 'frissons-80' } })
  clock.hour = 22
  await run($, 'heure')
  expect(themes.at(-1)).toMatchObject({ overrideColorScheme: 'dark', backdrop: { scene: 'frissons-80' } })
})

test('Paris a un voile et un flou pour le jour, et d\'autres pour la nuit', async ($, on) => {
  const { kept, themes } = world(on, { hour: 12 })

  // au départ : le même voile, du flou le jour, net la nuit
  await run($, 'jour')
  expect(themes[0]).toMatchObject({ backdrop: { scene: 'paris-jour', glass: { blur: 5, opacity: 0.6 } } })
  await run($, 'nuit')
  expect(themes[1]).toMatchObject({ backdrop: { scene: 'paris-nuit', glass: { blur: 0, opacity: 0.6 } } })
  // un réglage vaut pour la lumière affichée, sans toucher à l'autre
  const ran = await run($, 'jour voile 35')

  expect(String(ran.text)).toContain('voile 35 %, flou 5 (réglages du jour)')
  expect(kept.get('voile-paris-jour')).toBe(35)
  expect(kept.get('voile-paris-nuit')).toBeUndefined()
  await run($, 'nuit')
  expect(themes[3]).toMatchObject({ backdrop: { scene: 'paris-nuit', glass: { blur: 0, opacity: 0.6 } } })
})

test('un mot inconnu ne change rien', async ($, on) => {
  const { kept, themes } = world(on, { hour: 12 })
  // « voile » sans nombre n'est pas compris, et « frissons », avant lui, n'est pas appliqué
  const ran = await run($, 'frissons voile beaucoup')

  expect(String(ran.text)).toContain('« voile »')
  expect(kept.size).toBe(0)
  expect(themes).toHaveLength(0)
})

test("en mode heure, la scène de Paris suit l'heure du poste : jour de 8 h à 21 h", async ($, on) => {
  const clock = { hour: 12 }
  const { kept, themes } = world(on, clock)

  for (const hour of [12, 20, 21, 7, 8]) {
    clock.hour = hour
    await run($, 'heure')
  }
  expect(kept.get('variant')).toBe('heure')
  expect(themes.map(theme => (theme.backdrop as { scene?: string }).scene)).toEqual([
    'paris-jour',
    'paris-jour',
    'paris-nuit',
    'paris-nuit',
    'paris-jour',
  ])
})

test('les palettes générées sont entières, en clair et en sombre', () => {
  const modes = (palette: typeof PARIS) => Object.keys(palette.inputs).sort()

  expect(modes(PARIS)).toEqual(['dark', 'light'])
  expect(modes(FRISSONS)).toEqual(['dark', 'light'])
  for (const inputs of [PARIS.inputs.light, PARIS.inputs.dark, FRISSONS.inputs.light, FRISSONS.inputs.dark]) {
    const colors = Object.values(inputs ?? {})

    // une centaine de couleurs par mode, chacune en hexadécimal à six chiffres
    expect(colors.length > 90).toBe(true)
    expect(colors.filter(color => !/^#[0-9a-f]{6}$/i.test(color))).toEqual([])
  }
})

test('les bandeaux ont un voile à eux, aucun au départ, que /decor fond règle', async ($, on) => {
  const { kept } = world(on, { hour: 12 })
  const row = (plugin: string) => ({ plugin, tree: { type: 'Text', props: {}, children: [plugin] } }) as never
  const props = { ...BANDS.props, rows: [row('git-board'), row('stats-board')] }
  const fills = async () => {
    const ui = await $.ui.mount({ ...BANDS, props, surface: 'desktop' })
    const found = (await ui.findAll({ type: 'Box' })).map(box => box.props.backgroundColor)

    await ui.unmount()

    return found.filter(fill => fill !== undefined)
  }

  // aucun au départ ; de jour, il est clair
  expect(String((await run($, 'jour')).text)).toContain('Bandeaux : aérés, sans fond.')
  expect(await fills()).toEqual([])
  // réglé pour le jour seulement
  await run($, 'fond 80')
  expect(kept.get('fond-paris-jour')).toBe(80)
  expect(await fills()).toEqual(['rgba(252, 249, 243, 0.8)'])
  // la nuit : aucun au départ, sombre quand on en demande un
  expect(String((await run($, 'nuit')).text)).toContain('Bandeaux : aérés, sans fond.')
  expect(await fills()).toEqual([])
  await run($, 'fond 40')
  expect(await fills()).toEqual(['rgba(11, 13, 26, 0.4)'])
  // en « auto », le mod ne voit pas le mode de l'app : pas de voile, et la commande le dit
  expect(String((await run($, 'auto')).text)).toContain('qui ne se pose pas en « auto »')
  expect(await fills()).toEqual([])
})

const BANDS = {
  plugin: 'decors-pixel',
  component: 'AbovePromptList',
  requestId: 'bandeaux',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

test("les bandeaux sont aérés ligne par ligne, sans fond, tant qu'on ne le coupe pas", async ($, on) => {
  const { kept } = world(on, { hour: 12 })
  // Une ligne par mod, telle que le moteur la passe : il les empile lui-même.
  const row = (plugin: string) => ({ plugin, tree: { type: 'Text', props: {}, children: [plugin] } }) as never
  const props = { ...BANDS.props, rows: [row('git-board'), row('flow-board'), row('stats-board')] }
  const ui = await $.ui.mount({ ...BANDS, props, surface: 'desktop' })

  // les lignes, dans l'ordre, réunies dans une boîte qui les espace, sans couleur de fond
  expect((await ui.findAll({ type: 'Text' })).map(found => found.text)).toEqual(['git-board', 'flow-board', 'stats-board'])
  const spaced = (await ui.findAll({ type: 'Box' })).filter(found => found.props.rowGap !== undefined)

  expect(spaced).toHaveLength(1)
  expect(spaced[0]?.props).toEqual({ flexDirection: 'column', rowGap: 'sm' })
  expect(spaced[0]?.children).toHaveLength(3)
  await ui.unmount()

  // coupé : le moteur empile tout d'un coup, comme sans le mod (le singulier est compris aussi)
  expect(String((await run($, 'bandeau non')).text)).toContain('Bandeaux : serrés, sans fond.')
  expect(kept.get('bandeaux')).toBe(false)
  const plain = await $.ui.mount({ ...BANDS, props, surface: 'desktop' })

  expect((await plain.findAll({ type: 'Text' })).map(found => found.text)).toEqual(['git-board', 'flow-board', 'stats-board'])
  expect((await plain.findAll({ type: 'Box' })).filter(found => found.props.rowGap !== undefined)).toHaveLength(0)
  await plain.unmount()
})
