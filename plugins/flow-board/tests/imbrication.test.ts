import { expect, mock, test } from 'claude-code/testing'

import { laneTree } from '../hooks/timeline.ts'
import type { RegistryAgent } from '../types'

const agent = (key: string, start: number, extra: Partial<RegistryAgent> = {}): RegistryAgent => ({
  key,
  agentId: `id-${key}`,
  name: key,
  isBackground: true,
  status: 'done',
  startedAt: start,
  finishedAt: start + 10,
  source: 'live',
  ...extra,
})

const shape = (rows: ReturnType<typeof laneTree>): string[] =>
  rows.map(r => `${'  '.repeat(r.depth)}${r.kind === 'agent' ? r.agent.key : `⚙${r.agents.length}${r.isOpen ? '▾' : '▸'}`}`)

test('les sous-agents d’un sous-agent se rangent en retrait sous leur parent, à toute profondeur', () => {
  const agents = [
    agent('relecteur', 1),
    agent('autre', 2),
    agent('axe-spec', 4, { parent: 'id-relecteur' }),
    agent('axe-standards', 3, { parent: 'id-relecteur' }),
    agent('petit-enfant', 5, { parent: 'id-axe-spec' }),
    // Un parent inconnu (d'une autre session, effacé) : l'agent reste à la racine.
    agent('orphelin', 6, { parent: 'id-absent' }),
  ]
  expect(shape(laneTree(agents, new Set()))).toEqual(['relecteur', '  axe-standards', '  axe-spec', '    petit-enfant', 'autre', 'orphelin'])
})

test('les 30 agents d’un Workflow se replient en une piste, qui se déplie', () => {
  const members = Array.from({ length: 30 }, (_, i) => agent(`w${i}`, 10 + i, { workflow: 'run-1' }))
  const agents = [agent('avant', 1), ...members, agent('après', 100)]
  expect(shape(laneTree(agents, new Set()))).toEqual(['avant', '⚙30▸', 'après'])
  const open = laneTree(agents, new Set(['run-1']))
  expect(open).toHaveLength(33)
  expect(shape(open).slice(0, 3)).toEqual(['avant', '⚙30▾', '  w0'])
})

test('une piste « ⚙ Workflow » repliée se déplie au bouton, et le reste aux rafraîchissements', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 70_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  let n = 0
  on('agent.spawn', () => ({ agentId: `w${++n}`, model: 'claude-haiku-5-5' }))
  for (let i = 0; i < 3; i++) await ($ as any).agent.spawn({ prompt: 'p', description: `Étape ${i + 1}`, background: true, tool_use_id: 'wf-call', workflow: { runId: 'run-9', agentIndex: i } })
  const PANE = {
    component: 'Pane',
    requestId: 'flow-board',
    props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  } as const
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Button', text: /⚙\sWorkflow\s·\s3\sagents/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Étape 2$/ })).toBeUndefined()
    await ui.press({ key: 'workflow-run-9' })
    expect(await ui.find({ type: 'Button', text: /Étape 2$/ })).toBeDefined()
    await clock.advance(10_000)
    expect(await ui.find({ type: 'Button', text: /Étape 2$/ })).toBeDefined()
    await ui.press({ key: 'workflow-run-9' })
    expect(await ui.find({ type: 'Button', text: /Étape 2$/ })).toBeUndefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})

const PLUGIN = 'flow-board'
