import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const START = 'mcp__ccd_session__start_session'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const
const bandAt = (bodyColumns: number) =>
  ({
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  }) as const
const SURFACES = ['terminal', 'desktop'] as const
/** Les boutons que le bandeau a toujours : « ▸ Ouvrir » et « x ». */
const BAND_KEYS = ['band-open', 'band-hide']

/** Le moteur sous le plugin ; les demandes mises dans le prompt sont gardées dans l'ordre. */
const world = (on: any) => {
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('tool.call', { tool: START }, (_$: unknown, e: { title: string }) => ({
    result: { text: `Started session local_${/Groupe (\w+)/.exec(e.title)?.[1] ?? 'x'}42.` },
  }))
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

/** Les clés des boutons du bandeau, hors « ▸ Ouvrir » et « x ». */
const extraKeys = async (ui: any): Promise<string[]> =>
  (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key ?? b.props.key)).filter((key: string) => !BAND_KEYS.includes(key))

/**
 * Le bouton `key` du bandeau a le libellé de celui de la carte « Ensuite », sur les deux surfaces, le
 * style principal sur l'ordinateur ; c'est le seul bouton ajouté au bandeau. Rend le libellé.
 */
const expectSameAsCard = async ($: any, key: string, label: RegExp): Promise<void> => {
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    const inCard = String((await pane.find({ key }))?.props.label)
    expect(inCard).toMatch(label)
    await pane.unmount()
    const band = await $.ui.mount({ plugin: PLUGIN, surface, ...bandAt(120) })
    const inBand = await band.find({ key })
    expect(inBand?.props.label).toBe(inCard)
    if (surface === 'desktop') expect(inBand?.props.variant).toBe('primary')
    expect(await extraKeys(band)).toEqual([key])
    await band.unmount()
  }
}

/** Ce que met dans le prompt l'appui sur `key`, au panneau ou au bandeau. */
const pressed = async ($: any, filled: string[], key: string, where: 'pane' | 'band'): Promise<string | undefined> => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...(where === 'pane' ? PANE : bandAt(120)) })
  filled.push('')
  await ui.press({ key })
  await ui.unmount()
  return filled.at(-1)
}

const expectNoStepButton = async ($: any) => {
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: PLUGIN, surface, ...bandAt(120) })
    expect(await band.find({ key: 'band-open' })).toBeDefined()
    expect(await extraKeys(band)).toEqual([])
    await band.unmount()
  }
}

const SHARED_SERVICE = ['Service du porteur']
/** Trois groupes qui pilotent le même service : un seul part à la fois. */
const CHAIN = {
  tickets: [
    { id: 'a1', name: 'File' },
    { id: 'b1', name: 'Lots', blockedBy: ['a1'] },
    { id: 'c1', name: 'Prompts' },
  ],
  groups: [
    { id: 'A', name: 'File', tickets: ['a1'], resources: SHARED_SERVICE },
    { id: 'B', name: 'Lots', tickets: ['b1'], resources: SHARED_SERVICE },
    { id: 'C', name: 'Prompts', tickets: ['c1'], resources: SHARED_SERVICE },
  ],
}

test('en pleine étape, rien au bandeau ; l’étape finie, il reprend le bouton principal de la carte', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 70_000_000 })
  const filled = world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  // La carte s'intitule « Ensuite » : la suite n'est qu'annoncée.
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await pane.find({ type: 'Text', text: 'Ensuite' })).toBeDefined()
  expect(await pane.find({ key: 'go-compte-rendu' })).toBeDefined()
  await pane.unmount()
  await expectNoStepButton($)
  await $.tool.call({ tool: TOOL, complete: true })
  await expectSameAsCard($, 'go-compte-rendu', /^▶ Compte rendu$/)
  // Même effet : la demande va dans le prompt, la même qu'au panneau.
  const fromCard = await pressed($, filled, 'go-compte-rendu', 'pane')
  expect(fromCard).toMatch(/compte-rendu/)
  expect(await pressed($, filled, 'go-compte-rendu', 'band')).toBe(fromCard)
})

test('un groupe prêt : le bandeau propose sa session liée, sans « xhigh », la compaction ni la rétro', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 71_000_000 })
  const filled = world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, ...CHAIN } as any)
  await expectSameAsCard($, 'next-linked-A', /^↗.Groupe A · session liée$/)
  // L'appui au bandeau lance le groupe comme au panneau : la demande va dans le prompt.
  expect(await pressed($, filled, 'next-linked-A', 'band')).toMatch(/^Confie ce groupe à une session liée/)
})

test('des groupes indépendants : le bandeau propose le lot parallèle', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 72_000_000 })
  const filled = world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: [{ id: 'x1', name: 'Un', files: ['app'] }, { id: 'y1', name: 'Deux', files: ['worker'] }],
    groups: [{ id: 'X', name: 'App', tickets: ['x1'] }, { id: 'Y', name: 'Worker', tickets: ['y1'] }],
  } as any)
  await expectSameAsCard($, 'next-parallel-linked', /^⇉.X ∥ Y en parallèle · sessions liées$/)
  expect(await pressed($, filled, 'next-parallel-linked', 'band')).toMatch(/sessions? liées?/)
})

test('un groupe en cours ici, en session liée, ou des revues qui attendent : rien au bandeau', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 73_000_000 })
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, ...CHAIN } as any)
  // A en cours dans la discussion.
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'doing' }] } as any)
  await expectNoStepButton($)
  // Tout fait ici : les revues des groupes attendent, sur leur ligne.
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }, { id: 'b1', status: 'done' }, { id: 'c1', status: 'done' }] } as any)
  await expectNoStepButton($)
})

test('un groupe en session liée et un autre prêt, sans rien en commun : le bandeau propose le second, comme la carte', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 77_000_000 })
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    title: 'Boutique',
    tickets: [{ id: 'a1', name: 'File', files: ['app'] }, { id: 'c1', name: 'Prompts', files: ['worker'] }],
    groups: [{ id: 'A', name: 'File', tickets: ['a1'] }, { id: 'C', name: 'Prompts', tickets: ['c1'] }],
  } as any)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await pane.press({ key: 'launch-linked-A' })
  await pane.unmount()
  await $.tool.call({ tool: START, title: 'Boutique > Groupe A · File' } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  await expectSameAsCard($, 'next-linked-C', /^↗.Groupe C · session liée$/)
  // La pastille « ↗A 0/1 » et le compte « 0/2 » ne se coupent pas : le bouton (30 cellules) ne
  // vient qu'une fois leur place gardée, 40 + 7 + 4 + 30 = 81 colonnes.
  for (const [columns, hasStep] of [[80, false], [81, true]] as const) {
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandAt(columns) })
    await band.drawn()
    expect(await band.find({ type: 'Text', text: /^↗A.0\/1$/ })).toBeDefined()
    expect(Boolean(await band.find({ key: 'next-linked-C' }))).toBe(hasStep)
    // Le bouton trop large pour venir garde sa place : la frise ne vient pas à sa place.
    expect(await band.find({ type: 'Text', text: /^[●◉◎○]$/ })).toBeUndefined()
    await band.unmount()
  }
})

test('un groupe parti en session liée : rien au bandeau tant qu’il travaille', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 74_000_000 })
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...CHAIN } as any)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await pane.press({ key: 'launch-linked-A' })
  await pane.unmount()
  await $.tool.call({ tool: START, title: 'Boutique > Groupe A · File' } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  await expectNoStepButton($)
})

test('la largeur manque : la frise tombe avant le bouton, qui tombe sous le seuil où le bandeau garde ses boutons', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 76_000_000 })
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', complete: true } as any)
  // « ▶ Compte rendu » : 14 cellules, 18 entre crochets au terminal, 19 avec sa marge. La frise
  // vient à 64 colonnes et le titre à 90, plus la place du bouton quand il est là.
  const tiers = [
    [58, false, false, false],
    [59, true, false, false],
    [82, true, false, false],
    [83, true, true, false],
    [108, true, true, false],
    [109, true, true, true],
  ] as const
  for (const [columns, hasStep, hasMini, hasTitle] of tiers) {
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandAt(columns) })
    await band.drawn()
    expect(Boolean(await band.find({ key: 'go-compte-rendu' }))).toBe(hasStep)
    expect(Boolean(await band.find({ type: 'Text', text: '●' }))).toBe(hasMini)
    expect(Boolean(await band.find({ type: 'Text', text: 'Boutique' }))).toBe(hasTitle)
    expect(await band.find({ key: 'band-open' })).toBeDefined()
    expect(await band.find({ key: 'band-hide' })).toBeDefined()
    await band.unmount()
  }
})
