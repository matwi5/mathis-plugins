import { expect, mock, test } from 'claude-code/testing'

// Après l'Implémentation d'un lot sans groupes fait par le manager, le tableau de bord ne propose pas la
// « Revue de code » de Matt (`go-code-review`) : chaque ticket a eu sa revue, et le lot la sienne, par
// /code-review de Claude Code ; la suite proposée est « compte rendu, implémentation, rétro ». Un contrôle
// positif, la suite d'une mission TDD, montre que ce bouton existe bien là où la suite le propose.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
}

test('un lot sans groupes de deux tickets, relu et sa sécurité tranchée : le compte rendu, pas la « Revue de code » de Matt', async ($, on) => {
  mock.clock(on, { now: 98_100_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'T1', name: 'Un', status: 'done' }, { id: 'T2', name: 'Deux', status: 'done' }] } as any)
  // La revue du lot, puis son avis de sécurité.
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, security: { advised: false, why: 'que du texte' } } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-final-review' })).toBeUndefined()
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeDefined()
  expect(await ui.find({ key: 'go-code-review' })).toBeUndefined()
  await ui.unmount()
})

test('contrôle positif : une mission TDD finie propose la « Revue de code » (go-code-review)', async ($, on) => {
  mock.clock(on, { now: 98_150_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'x' })
  await $.tool.call({ tool: TOOL, complete: true } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-code-review' })).toBeDefined()
  await ui.unmount()
})
