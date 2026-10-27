import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
}

const LOT = [
  { id: 'A1', name: 'LIGHTS ON/OFF', blockedBy: [] },
  { id: 'A2', name: 'Règle SC/VSC', blockedBy: ['A1'] },
  { id: 'A3', name: 'Fermetures VSC', blockedBy: ['A2'] },
]

test('après une interruption, la consigne de file dit ce qui est fait et ce qui était en cours', async ($, on) => {
  mock.clock(on, { now: 110_000_000 })
  mock.store(on)
  world(on)
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: LOT, groups: [{ id: 'A', name: 'Worker', tickets: ['A1', 'A2', 'A3'] }] } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  for (const id of ['A1', 'A2', 'A3']) await ui.press({ key: `pick-${id}` })
  await ui.press({ key: 'launch-picks' })
  await ui.unmount()
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })
  // Le ticket 1 est commité, le 2 en cours quand la discussion s'arrête.
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }, { id: 'A2', status: 'doing' }] } as any)

  // Nouvelle discussion (ou nouveau tour) : /implement relancé.
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'z' })).text
  expect(note).toMatch(/1\) LIGHTS ON\/OFF \[A1\] \(done and committed: skip it\)/)
  expect(note).toMatch(/2\) Règle SC\/VSC \[A2\] \(in progress: partial work may already be uncommitted/)
  expect(note).toMatch(/3\) Fermetures VSC \[A3\];?/)
  expect(note).not.toMatch(/Fermetures VSC \[A3\] \(/)
  expect(note).toMatch(/Already in progress when this skill loaded: Règle SC\/VSC \[A2\]/)
  expect(note).toMatch(/check git status and git diff/)
  expect(note).not.toMatch(/Without git/)
})

test('sans git, la reprise d’un ticket en cours compare ses copies aux fichiers actuels', async ($, on) => {
  mock.clock(on, { now: 110_500_000 })
  mock.store(on)
  world(on)
  on('session.repo', () => ({ value: null }))
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })
  await $.tool.call({ tool: TOOL, tickets: LOT } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'doing' }] } as any)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'z' })).text
  expect(note).toContain('A previous discussion may have stopped in the middle: compare its copies with the current files ("Without git") before writing anything')
  expect(note).not.toMatch(/git status/)
})

test('sans ticket en cours, pas d’avertissement de reprise', async ($, on) => {
  mock.clock(on, { now: 111_000_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'T1', name: 'Seul' }] } as any)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })).text
  expect(note).not.toMatch(/Already in progress/)
})
