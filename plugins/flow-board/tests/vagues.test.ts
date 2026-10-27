import { expect, mock, test } from 'claude-code/testing'

// Une vague veut dire « en parallèle » (spec « Groupes et vagues », série 1 Q12) : ses titres ne
// s'affichent que si au moins une vague a deux groupes qui peuvent avancer ensemble.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
}

const showPlan = async ($: any, input: Record<string, unknown>, check: (ui: any) => Promise<void>) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot', ...input } as any)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await check(ui)
    await ui.unmount()
  }
}

test('une chaîne A → B → C sans parallélisme : aucun titre « Vague », les groupes se suivent avec « attend »', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 90_000_000 })
  mock.store(on)
  world(on)
  await showPlan(
    $,
    {
      tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux', blockedBy: ['a1'] }, { id: 'c1', name: 'Trois', blockedBy: ['b1'] }],
      groups: [
        { id: 'A', name: 'Premier', tickets: ['a1'], files: ['a'] },
        { id: 'B', name: 'Deuxième', tickets: ['b1'], files: ['b'] },
        { id: 'C', name: 'Troisième', tickets: ['c1'], files: ['c'] },
      ],
    },
    async ui => {
      expect(await ui.find({ type: 'Text', text: /^Vague/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /attend A$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /attend B$/ })).toBeDefined()
    },
  )
})

test('deux groupes en parallèle à un niveau : « Vague 1 » et « Vague 2 »', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 91_000_000 })
  mock.store(on)
  world(on)
  await showPlan(
    $,
    {
      tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }, { id: 'c1', name: 'Trois', blockedBy: ['a1', 'b1'] }],
      groups: [
        { id: 'A', name: 'Premier', tickets: ['a1'], files: ['a'] },
        { id: 'B', name: 'Deuxième', tickets: ['b1'], files: ['b'] },
        { id: 'C', name: 'Troisième', tickets: ['c1'], files: ['c'] },
      ],
    },
    async ui => {
      expect(await ui.find({ type: 'Text', text: /^Vague 1/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Vague 2/ })).toBeDefined()
    },
  )
})

test('deux groupes au même niveau qui partagent un fichier : aucun titre « Vague »', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 92_000_000 })
  mock.store(on)
  world(on)
  await showPlan(
    $,
    {
      tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }, { id: 'c1', name: 'Trois', blockedBy: ['a1', 'b1'] }],
      groups: [
        { id: 'A', name: 'Premier', tickets: ['a1'], files: ['app/commun.ts'] },
        { id: 'B', name: 'Deuxième', tickets: ['b1'], files: ['app/commun.ts'] },
        { id: 'C', name: 'Troisième', tickets: ['c1'], files: ['c'] },
      ],
    },
    async ui => {
      expect(await ui.find({ type: 'Text', text: /^Vague/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /attend A, B$/ })).toBeDefined()
    },
  )
})

test('une ressource partagée au même niveau empêche aussi les titres « Vague »', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 93_000_000 })
  mock.store(on)
  world(on)
  await showPlan(
    $,
    {
      tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }, { id: 'c1', name: 'Trois', blockedBy: ['a1'] }],
      groups: [
        { id: 'A', name: 'Premier', tickets: ['a1'], files: ['a'], resources: ['PowerBI Desktop'] },
        { id: 'B', name: 'Deuxième', tickets: ['b1'], files: ['b'], resources: ['PowerBI Desktop'] },
        { id: 'C', name: 'Troisième', tickets: ['c1'], files: ['c'] },
      ],
    },
    async ui => {
      expect(await ui.find({ type: 'Text', text: /^Vague/ })).toBeUndefined()
    },
  )
})
