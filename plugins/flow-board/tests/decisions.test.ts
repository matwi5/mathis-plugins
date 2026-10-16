import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
}

test('un choix fait sans la personne s’affiche à relire, dans le panneau et le bandeau, jusqu’à « ✓ Relu »', async ($, on) => {
  mock.clock(on, { now: 80_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    decided: [{ what: 'Corrigé le rattrapage sans T0 avant le ticket 4', why: 'il faussait le recalcul des résumés' }],
  } as any)
  // Renvoyé une seconde fois : compté une fois.
  await $.tool.call({ tool: TOOL, decided: [{ what: 'Corrigé le rattrapage sans T0 avant le ticket 4' }] } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^⚑.Décidé sans toi$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1.à relire$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Corrigé le rattrapage sans T0 avant le ticket 4$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^car : il faussait le recalcul des résumés$/ })).toBeDefined()
    await ui.unmount()
  }
  let band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Text', text: /^⚑.1.à.relire$/ })).toBeDefined()
  await band.unmount()

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'decided-seen' })
  expect(await ui.find({ key: 'decided-seen' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^1.relu$/ })).toBeDefined()
  // Relu : la ligne se replie.
  expect(await ui.find({ type: 'Text', text: /^Corrigé le rattrapage/ })).toBeUndefined()
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Text', text: /Décidé sans toi : Corrigé le rattrapage/ })).toBeDefined()
  await ui.unmount()

  band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Text', text: /à.relire/ })).toBeUndefined()
  await band.unmount()
})

test('un choix vide est ignoré', async ($, on) => {
  mock.clock(on, { now: 81_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  const answer = await $.tool.call({ tool: TOOL, decided: [{ what: '' }] } as any)
  expect(JSON.stringify(answer)).not.toMatch(/error/i)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Décidé sans toi/ })).toBeUndefined()
  await ui.unmount()
})
