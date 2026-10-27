import { expect, mock, test } from 'claude-code/testing'

import { costOf, costText, pricesFor, pricesFromCcusage } from '../hooks/cost.ts'

const PLUGIN = 'flow-board'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

/** Des discussions dont le coût suit des prix connus (en $ par million de tokens) : la vérité du test. */
const TRUE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }
const session = (input: number, output: number, cacheRead: number, cacheWrite: number, model = 'claude-opus-5-5') => ({
  modelBreakdowns: [
    {
      modelName: model,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheWrite,
      cost: (input * TRUE.input + output * TRUE.output + cacheRead * TRUE.cacheRead + cacheWrite * TRUE.cacheWrite) / 1e6,
    },
  ],
})
const SESSIONS = {
  sessions: [session(1_000, 20_000, 3_000_000, 90_000), session(40_000, 5_000, 800_000, 300_000), session(2_000, 90_000, 9_000_000, 50_000), session(500_000, 1_000, 100_000, 10_000), session(30, 400, 60_000, 20_000)],
}

test('les prix unitaires d’un modèle se tirent des coûts de ccusage, discussion par discussion', () => {
  const prices = pricesFromCcusage(SESSIONS)
  const opus = prices['claude-opus-5-5']!
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) expect(Math.abs(opus[k] * 1e6 - TRUE[k])).toBeLessThan(1e-6)
  // Le coût d'un sous-agent : ses tokens aux prix de son modèle, toujours « ≈ ».
  const usd = costOf({ input: 10, output: 2_000, cacheRead: 400_000, cacheWrite: 30_000 }, pricesFor(prices, 'claude-opus-5-5'))!
  expect(Math.abs(usd - (10 * 5 + 2_000 * 25 + 400_000 * 0.5 + 30_000 * 6.25) / 1e6)).toBeLessThan(1e-9)
  expect(costText(usd)).toBe('≈ 0,44 $')
  // Un alias de l'appel (`opus`) ou un id daté se rapproche du nom de ccusage.
  expect(pricesFor(prices, 'opus')).toBe(opus)
  expect(pricesFor(prices, 'claude-opus-5-5-20261001')).toBe(opus)
})

test('ccusage absent, illisible ou trop peu de discussions pour un modèle : pas de prix, pas d’erreur', () => {
  expect(pricesFromCcusage(null)).toEqual({})
  expect(pricesFromCcusage('pas du json')).toEqual({})
  expect(pricesFromCcusage({ sessions: [session(1, 2, 3, 4, 'claude-rare')] })).toEqual({})
  expect(costOf({ input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, undefined)).toBeNull()
})

const world = (on: any, ccusage: (argv: string[]) => unknown) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-cout' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  const calls: string[][] = []
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    calls.push([...e.argv])
    return ccusage([...e.argv])
  })
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-opus-5-5' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  on('turn.step', async function* (_$: unknown, e: any) {
    const usage = { input_tokens: 10, output_tokens: 2_000, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 30_000, model: 'claude-opus-5-5' }
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  return { mem, calls }
}

const launchAndWork = async ($: any) => {
  await $.tool.call({ tool: 'Agent', description: 'Implement ticket #5', subagent_type: 'agents:worker', model: 'opus', prompt: 'p', run_in_background: true, tool_use_id: 'call-1' })
  await $.agent.spawn({ prompt: 'p', description: 'Implement ticket #5', background: true, tool_use_id: 'call-1' })
  for await (const _ of $.turn.step({ turnId: 'ta', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'a1' })) {
    // la réponse
  }
}

test('le coût estimé « ≈ » de chaque sous-agent dans sa carte, et le total dans le résumé', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 60_000_000 })
  // npx peut écrire avant le JSON : la sortie se lit quand même.
  const { calls } = world(on, argv => ({ value: { exitCode: 0, stdout: `npm warn exec The following package was not found and will be installed: ccusage\n${JSON.stringify(SESSIONS)}`, stderr: '' } }))
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await clock.advance(2_000)
  // Un relevé ccusage, une seule fois : `npx -y ccusage@<version> claude session --json`.
  expect(calls.filter(c => c.some(a => a.startsWith('ccusage@')))).toHaveLength(1)
  expect(calls[0]!.slice(-4, -2)).toEqual(['session', '--json'])
  await launchAndWork($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Text', text: /≈\s0,44\s\$/ })).toBeDefined()
    await ui.press({ key: 'lane-call-1' })
    expect(await ui.find({ type: 'Text', text: /^≈\s0,44\s\$$/ })).toBeDefined()
    await ui.press({ key: 'lane-call-1' })
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
  // Le lendemain seulement, un nouveau relevé.
  await clock.advance(3_600_000)
  expect(calls.filter(c => c.some(a => a.startsWith('ccusage@')))).toHaveLength(1)
})

test('sans ccusage (npx absent, en échec, ou sans `process.run`) : « coût indisponible » et les tokens, sans erreur', async ($, on) => {
  const clock = mock.clock(on, { now: 61_000_000 })
  world(on, () => {
    throw new Error('npx introuvable')
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await clock.advance(2_000)
  await launchAndWork($)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'lane-call-1' })
  expect(await ui.find({ type: 'Text', text: /coût indisponible/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /entrée 10 · sortie 2\sk/ })).toBeDefined()
  await ui.press({ key: 'lane-call-1' })
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})
