import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const RECALCUL = '1200000000000113'
const SCPERIODS = '1200000000000109'
const DECISION = '1200000000000110'
const NETTOYAGES = '1200000000000115'

test('une dépendance hors du lot bloque jusqu’à ce que la tâche soit cochée dans Asana', async ($, on) => {
  mock.clock(on, { now: 60_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('tool.call', { tool: 'mcp__asana__update_tasks' }, () => ({ result: { data: [] } }))

  const note = await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  expect(note.text).toMatch(/outside this lot/)
  await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: RECALCUL, name: 'Données : recalcul des résumés', blockedBy: [DECISION] },
      { id: SCPERIODS, name: 'App : scPeriods.ts aligné', blockedBy: [NETTOYAGES] },
    ],
    externals: [
      { id: DECISION, name: 'Feu vert du recalcul en prod', kind: 'decision' },
      { id: NETTOYAGES, name: 'Nettoyages de la revue', kind: 'task' },
    ],
  } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ key: `pick-${RECALCUL}` })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Décision à prendre : Feu vert du recalcul en prod/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /après : Nettoyages de la revue \(externe\)/ })).toBeDefined()
    await ui.unmount()
  }

  // La décision est prise et cochée dans Asana : le recalcul se déverrouille.
  await $.tool.call({ tool: 'mcp__asana__update_tasks', tasks: [{ task: DECISION, completed: true }] } as any)
  // Les nettoyages passent « à trancher » : ils deviennent une décision.
  await $.tool.call({ tool: 'mcp__asana__update_tasks', tasks: [{ task: NETTOYAGES, notes: 'Statut : à trancher (porteur)' }] } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: `pick-${RECALCUL}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Décision à prendre : Feu vert/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Décision à prendre : Nettoyages de la revue/ })).toBeDefined()
  expect(await ui.find({ key: `pick-${SCPERIODS}` })).toBeUndefined()
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Text', text: /Dépendance externe levée : Feu vert du recalcul en prod/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('un bloqueur inconnu du parcours bloque par prudence et s’affiche comme inconnu', async ($, on) => {
  mock.clock(on, { now: 61_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: RECALCUL, name: 'Recalcul', blockedBy: ['999'] }] } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: `pick-${RECALCUL}` })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /après : 999 \(inconnu\)/ })).toBeDefined()
  await ui.unmount()
})

test('une mise à jour de statut sans type garde l’étiquette « décision »', async ($, on) => {
  mock.clock(on, { now: 62_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: [{ id: RECALCUL, name: 'Recalcul', blockedBy: [DECISION, NETTOYAGES] }],
    externals: [
      { id: DECISION, name: 'Feu vert', kind: 'decision' },
      { id: NETTOYAGES, name: 'Nettoyages', kind: 'task' },
    ],
  } as any)
  await $.tool.call({ tool: TOOL, externals: [{ id: NETTOYAGES, name: 'Nettoyages', status: 'done' }, { id: DECISION, name: 'Feu vert' }] } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Décision à prendre : Feu vert/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Nettoyages \(externe\) ✓/ })).toBeDefined()
  await ui.unmount()
})
