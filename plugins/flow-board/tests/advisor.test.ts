import { expect, mock, test } from 'claude-code/testing'

import { advisorCostOf } from '../hooks/cost.ts'
import { applyRebuilt, cleanRebuilt, runRegistry, unionRebuilt, withRun } from '../hooks/history.ts'
import { ADVISOR_CALLS_MAX, MAIN, addAdvisorCalls, catchUpAdvisor, cleanRegistry, emptyRegistry, mergeRegistry, openSegment, closeSegment, spawnAgent, startCall } from '../hooks/registry.ts'
import { catchUp, laneFromTranscript } from '../hooks/transcript.ts'
import type { SessionRegistry } from '../types'

const PLUGIN = 'flow-board'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const
const ALL = ['terminal', 'desktop', 'vscode', 'mobile'] as const

/** Le moteur sous le plugin : la session « s-adv », un stockage en mémoire. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-adv' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  return mem
}

/**
 * Une requête au modèle de l'orchestrateur (ou du sous-agent `agentId`) : 3 s de réflexion, dont
 * un appel à l'advisor de la 1re à la 2e seconde, que le moteur ne donne qu'à la fin de l'étape.
 * Le hook du moteur se pose avant tout appel à `$` ; la requête part par la fonction rendue.
 */
const advisedSteps = (on: any, clock: any) => {
  const plan = { t0: 0, id: '' }
  on('turn.step', async function* (_$: unknown, e: any) {
    yield { kind: 'thinking', index: 0, text: '' }
    await clock.advance(3_000)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], serverToolUses: [{ id: plan.id, name: 'advisor', input: {}, startedAt: plan.t0 + 1_000, endedAt: plan.t0 + 2_000 }], stopReason: 'end_turn', usage: null }
  })
  return async ($: any, t0: number, agentId?: string, id = 'adv-1') => {
    Object.assign(plan, { t0, id })
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })) {
      // la réponse
    }
    return t0
  }
}

test('un appel à l’advisor pose, à la fin de l’étape, sa ligne et une attente « consulte l’advisor » sur l’orchestrateur', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 50_000_000 })
  const mem = world(on)
  const step = advisedSteps(on, clock)
  const t0 = await step($, 50_000_000)
  await clock.advance(1_000)
  const reg = mem['agents:s-adv'] as SessionRegistry
  expect(reg.advisor?.calls).toEqual([{ id: 'adv-1', s: t0 + 1_000, e: t0 + 2_000, by: MAIN }])
  // La réflexion qui couvrait l'appel est coupée par l'attente.
  expect(reg.main!.segments!.map(s => `${s.k}:${s.s - t0}-${(s.e ?? NaN) - t0}`)).toEqual(['think:0-1000', 'waitAdvisor:1000-2000', 'think:2000-3000'])
  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Button', text: /✦\sadvisor\s·\srelecteur/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /consulte\sl’advisor/ })).toBeDefined()
    if (surface !== 'terminal') {
      const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt).replace(/ /g, ' '))
      expect(alts).toContain('Orchestrateur : réflexion, consulte l’advisor, réflexion')
      expect(alts.some(alt => alt.startsWith('advisor · relecteur : 1 appel'))).toBe(true)
    }
    // Sa carte : le nombre d'appels, l'heure et l'appelant de chacun.
    await ui.press({ key: 'lane-advisor' })
    expect(await ui.find({ type: 'Text', text: /1\sappel/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Orchestrateur/ })).toBeDefined()
    await ui.press({ key: 'lane-advisor' })
    await ui.unmount()
  }
})

test('l’appel d’un sous-agent va sur la même ligne, avec son nom pour appelant ; pas de ligne sans appel', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 51_000_000 })
  const mem = world(on)
  const step = advisedSteps(on, clock)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }))
  await $.tool.call({ tool: 'Agent', description: 'Relecteur du lot', prompt: 'p', run_in_background: true, tool_use_id: 'call-1' } as any)
  await ($ as any).agent.spawn({ prompt: 'p', description: 'Relecteur du lot', background: true, tool_use_id: 'call-1' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ key: 'lane-advisor' })).toBeUndefined()
  const t0 = await step($, 51_000_000, 'a1', 'adv-2')
  await clock.advance(1_000)
  const reg = mem['agents:s-adv'] as SessionRegistry
  expect(reg.advisor?.calls).toEqual([{ id: 'adv-2', s: t0 + 1_000, e: t0 + 2_000, by: 'a1' }])
  expect(reg.agents[0]!.segments!.some(s => s.k === 'waitAdvisor')).toBe(true)
  await ui.press({ key: 'lane-advisor' })
  expect(await ui.find({ type: 'Text', text: /Relecteur\sdu\slot/ })).toBeDefined()
  await ui.unmount()
})

test('un appel sans fin court jusqu’à la fin de l’étape ; le même appel ne compte qu’une fois', () => {
  let reg = openSegment(emptyRegistry('s', '/p', 0), MAIN, { k: 'think', s: 0 }, 0)!
  reg = closeSegment(reg, MAIN, () => true, 5_000)!
  reg = addAdvisorCalls(reg, MAIN, [{ id: 'x', name: 'advisor', startedAt: 1_000 }], 5_000)!
  expect(reg.advisor!.calls).toEqual([{ id: 'x', s: 1_000, e: 5_000, by: MAIN }])
  expect(addAdvisorCalls(reg, MAIN, [{ id: 'x', name: 'advisor', startedAt: 1_000 }], 5_000)).toBeNull()
  // Un autre outil du serveur n'est pas l'advisor.
  expect(addAdvisorCalls(reg, MAIN, [{ id: 'w', name: 'web_search', startedAt: 1_000, endedAt: 2_000 }], 5_000)).toBeNull()
})

test('un registre d’avant se lit sans ligne advisor ; deux processus réunissent leurs appels', () => {
  const old = cleanRegistry({ v: 1, session: 's', root: '/p', agents: [], updatedAt: 1 })!
  expect(old.advisor).toBeUndefined()
  // Une ligne abîmée est écartée, appel par appel : forme, heure hors de toute plage, fin avant le début.
  const T = 1_800_000_000_000
  const torn = cleanRegistry({
    v: 1,
    session: 's',
    root: '/p',
    agents: [],
    updatedAt: 1,
    advisor: { calls: [{ id: 'a', s: T, e: T + 1, by: 'main' }, { id: 3 }, 'x', { id: 'b', s: 1e400, by: 'main' }, { id: 'c', s: 5, by: 'main' }, { id: 'd', s: T + 9, e: T, by: 'main' }] },
  })!
  expect(torn.advisor!.calls).toEqual([{ id: 'a', s: T, e: T + 1, by: 'main' }])
  // Au plus ADVISOR_CALLS_MAX appels, les plus récents.
  const many = cleanRegistry({ v: 1, session: 's', root: '/p', agents: [], updatedAt: 1, advisor: { calls: Array.from({ length: ADVISOR_CALLS_MAX + 5 }, (_, i) => ({ id: `c${i}`, s: T + i, by: 'main' })) } })!
  expect(many.advisor!.calls.length).toBe(ADVISOR_CALLS_MAX)
  expect(many.advisor!.calls[0]!.id).toBe('c5')
  const here = addAdvisorCalls(emptyRegistry('s', '/p', 0), MAIN, [{ id: 'a', name: 'advisor', startedAt: 1, endedAt: 2 }], 2)!
  const there = addAdvisorCalls(emptyRegistry('s', '/p', 0), 'a1', [{ id: 'b', name: 'advisor', startedAt: 3, endedAt: 4 }], 4)!
  expect(mergeRegistry(here, there).advisor!.calls.map(c => c.id)).toEqual(['a', 'b'])
})

test('la carte nomme l’appelant même quand il est dans un Workflow replié, sans piste à lui', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 52_000_000 })
  world(on)
  const step = advisedSteps(on, clock)
  on('agent.spawn', () => ({ agentId: 'w1', model: 'claude-haiku-5-5' }))
  // Un agent lancé par un Workflow : sa piste est repliée avec celles des autres agents du Workflow.
  await ($ as any).agent.spawn({ prompt: 'p', description: 'Membre du Workflow', background: true, workflow: { runId: 'wf-1', agentIndex: 0 } })
  await step($, 52_000_000, 'w1', 'adv-w')
  await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Button', text: /Membre\sdu\sWorkflow/ })).toBeUndefined()
  await ui.press({ key: 'lane-advisor' })
  expect(await ui.find({ type: 'Text', text: /Membre\sdu\sWorkflow/ })).toBeDefined()
  await ui.unmount()
})

// ─── Rattrapage : modèle, tokens et coût (forme relevée sur un transcript du 27/10/2026) ───

const T1 = Date.parse('2026-10-27T10:00:00.000Z')
const at = (ms: number) => new Date(T1 + ms).toISOString()
/** L'usage d'une réponse qui a consulté l'advisor : le sien en premier niveau, celui de l'advisor dans `iterations`. */
const advisedUsage = (advisor: Record<string, unknown>) => ({
  input_tokens: 10,
  output_tokens: 300,
  cache_read_input_tokens: 1_000,
  cache_creation_input_tokens: 50,
  iterations: [{ type: 'message', input_tokens: 10, output_tokens: 300, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 50 }, { type: 'advisor_message', ...advisor }],
})
const FABLE = { model: 'claude-fable-5-1', input_tokens: 156_265, output_tokens: 6_473, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const advisedTranscript = (advisor: Record<string, unknown>, sidechain = true) =>
  [
    { type: 'api-request', timestamp: at(0) },
    { type: 'assistant', isSidechain: sidechain, timestamp: at(500), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }], usage: advisedUsage(advisor) } },
    { type: 'assistant', isSidechain: sidechain, timestamp: at(1_000), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'server_tool_use', id: 'srv-1', name: 'advisor', input: {} }], usage: advisedUsage(advisor) } },
    { type: 'assistant', isSidechain: sidechain, timestamp: at(9_000), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'advisor_tool_result', tool_use_id: 'srv-1', content: { type: 'advisor_redacted_result' } }], usage: advisedUsage(advisor) } },
    { type: 'assistant', isSidechain: sidechain, timestamp: at(9_500), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'text', text: '' }], usage: advisedUsage(advisor) } },
  ]
    .map(l => JSON.stringify(l))
    .join('\n')

test('un transcript donne chaque appel à l’advisor avec ses heures, son modèle et ses tokens, sans gonfler l’appelant', () => {
  const lane = laneFromTranscript(advisedTranscript(FABLE))
  expect(lane.tokens).toEqual({ input: 10, output: 300, cacheRead: 1_000, cacheWrite: 50 })
  expect(lane.advisor).toEqual([{ id: 'srv-1', s: T1 + 1_000, e: T1 + 9_000, model: 'claude-fable-5-1', tokens: { input: 156_265, output: 6_473, cacheRead: 0, cacheWrite: 0 } }])
  // Une entrée sans modèle ni tokens compte quand même, sans prix ni erreur.
  expect(laneFromTranscript(advisedTranscript({ input_tokens: 'x' })).advisor).toEqual([{ id: 'srv-1', s: T1 + 1_000, e: T1 + 9_000 }])
})

test('le rattrapage complète l’appel vu en direct (même id) et ajoute celui qu’il n’avait pas vu ; l’appelant garde ses tokens', () => {
  let reg = startCall(emptyRegistry('s', '/p', T1), { key: 'call-1', name: 'Relecteur', isBackground: true }, T1)!
  reg = spawnAgent(reg, { agentId: 'a1', callKey: 'call-1', isBackground: true }, new Set(), T1)!
  reg = addAdvisorCalls(reg, 'a1', [{ id: 'srv-1', name: 'advisor', startedAt: T1 + 900, endedAt: T1 + 9_100 }], T1 + 9_500)!
  const lane = laneFromTranscript(advisedTranscript(FABLE))
  const caught = catchUp(reg, [{ agentId: 'a1', lane, meta: {} }], T1 + 20_000)!
  expect(caught.advisor!.calls).toEqual([{ id: 'srv-1', s: T1 + 900, e: T1 + 9_100, by: 'a1', model: 'claude-fable-5-1', tokens: { input: 156_265, output: 6_473, cacheRead: 0, cacheWrite: 0 }, isRead: true }])
  expect(caught.agents[0]!.tokens).toEqual({ input: 10, output: 300, cacheRead: 1_000, cacheWrite: 50 })
  // Sans le direct (une discussion passée) : l'appel vient du transcript seul.
  const fresh = catchUp(emptyRegistry('s', '/p', T1), [{ agentId: 'a2', lane, meta: {} }], T1 + 20_000)!
  expect(fresh.advisor!.calls.map(c => [c.id, c.by])).toEqual([['srv-1', 'a2']])
  // Relu deux fois, rien ne change.
  expect(catchUp(caught, [{ agentId: 'a1', lane, meta: {} }], T1 + 30_000)).toBeNull()
})

test('la ligne advisor d’une discussion passée vient de son fichier à part, piste de la discussion comprise', () => {
  const main = laneFromTranscript(advisedTranscript(FABLE, false), true)
  const rebuilt = cleanRebuilt(JSON.parse(JSON.stringify({ v: 1, session: 's', agents: [], main })), 's')!
  const reg = applyRebuilt(emptyRegistry('s', '/p', T1), rebuilt, T1 + 20_000)
  expect(reg.advisor!.calls.map(c => [c.id, c.by, c.model])).toEqual([['srv-1', MAIN, 'claude-fable-5-1']])
})

/**
 * Une session au registre déjà relu : un sous-agent qui a consulté l'advisor, ses tokens et ceux
 * de l'appel connus ; les prix gardés du jour, sans relancer ccusage.
 */
const relu = (on: any, advisorModel: string) => {
  const now = T1 + 60_000
  const reg = {
    v: 1,
    session: 's-adv',
    root: '/p',
    updatedAt: now,
    main: { segments: [{ k: 'write', s: T1, e: T1 + 20_000 }] },
    agents: [
      { key: 'call-1', agentId: 'a1', name: 'Relecteur du lot', isBackground: true, status: 'done', startedAt: T1, finishedAt: T1 + 20_000, source: 'live', model: 'claude-opus-5-5', models: ['claude-opus-5-5'], tokens: { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0 }, segments: [{ k: 'think', s: T1, e: T1 + 1_000 }, { k: 'waitAdvisor', s: T1 + 1_000, e: T1 + 9_000, t: 'advisor' }] },
    ],
    advisor: { calls: [{ id: 'srv-1', s: T1 + 1_000, e: T1 + 9_000, by: 'a1', model: advisorModel, tokens: { input: 156_265, output: 6_473, cacheRead: 0, cacheWrite: 0 } }] },
  }
  // $ par token : 1 000 tokens d'entrée de l'opus coûtent 0,01 $ ; l'appel à l'advisor, 1,89 $.
  const prices = { 'claude-opus-5-5': { input: 10e-6, output: 50e-6, cacheRead: 1e-6, cacheWrite: 12.5e-6 }, 'claude-fable-5-1': { input: 10e-6, output: 50e-6, cacheRead: 1e-6, cacheWrite: 12.5e-6 } }
  const mem = world(on)
  mem['agents:s-adv'] = reg
  mem.agentPrices = { at: now, triedAt: now, prices }
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  return now
}

test('le coût de l’advisor : une part à part du total, sa carte, et une ligne sur la carte de l’appelant hors de son coût', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T1 + 60_000 })
  relu(on, 'claude-fable-5-1')
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await clock.advance(2_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    // Le total des sous-agents, puis la part de l'advisor, nommée.
    expect(await ui.find({ type: 'Text', text: /^·\s≈\s0,01\s\$$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /advisor\s≈\s1,89\s\$/ })).toBeDefined()
    // La carte de la ligne advisor : modèle, tokens, coût.
    await ui.press({ key: 'lane-advisor' })
    expect(await ui.find({ type: 'Text', text: /fable-5-1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /entrée\s156,3\sk/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^≈\s1,89\s\$$/ })).toBeDefined()
    await ui.press({ key: 'lane-advisor' })
    // La carte de l'appelant : son coût seul, et l'advisor à part.
    await ui.press({ key: 'lane-call-1' })
    expect(await ui.find({ type: 'Text', text: /^≈\s0,01\s\$$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\sappel,\s≈\s1,89\s\$/ })).toBeDefined()
    await ui.press({ key: 'lane-call-1' })
    await ui.unmount()
  }
})

test('sans prix pour le modèle de l’advisor : « coût inconnu » et ses tokens, aucun prix inventé', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T1 + 60_000 })
  relu(on, 'claude-inconnu-9')
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await clock.advance(2_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /advisor\s:\scoût\sinconnu/ })).toBeDefined()
  await ui.press({ key: 'lane-advisor' })
  expect(await ui.find({ type: 'Text', text: /coût\sinconnu/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /entrée\s156,3\sk/ })).toBeDefined()
  await ui.unmount()
})

test('un appel relu sans modèle ni tokens compte sans prix : « coût inconnu », pas « pas encore relu »', () => {
  let reg = addAdvisorCalls(emptyRegistry('s', '/p', T1), MAIN, [{ id: 'srv-1', name: 'advisor', startedAt: T1 + 900, endedAt: T1 + 9_100 }], T1 + 9_500)!
  // Vu en direct seulement : pas encore relu.
  expect(advisorCostOf(reg.advisor!.calls, {})).toMatchObject({ unread: 1, isUnknown: false, cost: null })
  const lane = laneFromTranscript(advisedTranscript({ input_tokens: 'x' }))
  reg = catchUp(reg, [{ agentId: 'a1', lane, meta: {} }], T1 + 20_000) ?? reg
  // L'appel de l'orchestrateur n'est pas celui du sous-agent : on relit la piste de la discussion.
  reg = applyRebuilt(reg, { v: 1, session: 's', agents: [], main: { advisor: lane.advisor! } }, T1 + 20_000)
  expect(reg.advisor!.calls[0]!.isRead).toBe(true)
  expect(advisorCostOf(reg.advisor!.calls, {})).toMatchObject({ unread: 0, isUnknown: true, cost: null })
})

test('l’historique d’un parcours garde la ligne advisor : fichier à part et registres des discussions porteuses', () => {
  const main = laneFromTranscript(advisedTranscript(FABLE, false), true)
  // La reprise d'un parcours garde les appels de la piste de la discussion, et une union n'en perd aucun.
  const run = { id: 'r1', startedAt: T1 - 60_000, updatedAt: T1 + 60_000, status: 'done', finishedAt: T1 + 60_000, title: 'Parcours', tickets: [], log: [] } as any
  const kept = withRun(null, 's', run, [], main)
  expect(kept.main?.advisor?.map(c => c.id)).toEqual(['srv-1'])
  expect(unionRebuilt(kept, { v: 1, session: 's', agents: [] }).main?.advisor?.map(c => c.id)).toEqual(['srv-1'])
  // La vue du parcours reprend les appels des discussions qui le portaient, dans sa période.
  const reg = { ...emptyRegistry('s', '/p', T1), main: { segments: [{ k: 'write' as const, s: T1, e: T1 + 10_000 }] }, advisor: { calls: [{ id: 'srv-1', s: T1 + 1_000, e: T1 + 9_000, by: MAIN }, { id: 'srv-old', s: T1 - 3_600_000, e: T1 - 3_599_000, by: MAIN }] } }
  expect(runRegistry(run, [reg], null, T1 + 120_000).advisor?.calls.map(c => c.id)).toEqual(['srv-1'])
})

test('un appel sans résultat dans le transcript (réponse coupée) finit avec sa réponse : jamais de barre ouverte', () => {
  const cut = advisedTranscript(FABLE).split('\n').filter(l => !l.includes('advisor_tool_result')).join('\n')
  expect(laneFromTranscript(cut).advisor).toEqual([{ id: 'srv-1', s: T1 + 1_000, e: T1 + 9_500, model: 'claude-fable-5-1', tokens: { input: 156_265, output: 6_473, cacheRead: 0, cacheWrite: 0 } }])
})

test('l’orchestrateur seul a consulté l’advisor : le résumé montre quand même sa part', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T1 + 60_000 })
  const mem = world(on)
  mem['agents:s-adv'] = {
    v: 1,
    session: 's-adv',
    root: '/p',
    updatedAt: T1 + 60_000,
    agents: [],
    main: { segments: [{ k: 'write', s: T1, e: T1 + 20_000 }] },
    advisor: { calls: [{ id: 'srv-1', s: T1 + 1_000, e: T1 + 9_000, by: 'main', model: 'claude-fable-5-1', tokens: { input: 156_265, output: 6_473, cacheRead: 0, cacheWrite: 0 }, isRead: true }] },
  }
  mem.agentPrices = { at: T1 + 60_000, triedAt: T1 + 60_000, prices: { 'claude-fable-5-1': { input: 10e-6, output: 50e-6, cacheRead: 1e-6, cacheWrite: 12.5e-6 } } }
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await clock.advance(2_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /advisor\s≈\s1,89\s\$/ })).toBeDefined()
  await ui.unmount()
})

test('un appel posé après des outils de la session, sans résultat ni entrée d’usage, n’a pas eu de réponse : ni coût, ni « coût inconnu »', () => {
  // Une réponse : un appel qui répond (srv-1), puis un second posé après un outil Write, jamais parti (srv-2).
  const text = [
    ...advisedTranscript(FABLE, false).split('\n'),
    JSON.stringify({ type: 'assistant', isSidechain: false, timestamp: at(9_600), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: {} }], usage: advisedUsage(FABLE) } }),
    JSON.stringify({ type: 'assistant', isSidechain: false, timestamp: at(9_700), message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'server_tool_use', id: 'srv-2', name: 'advisor', input: {} }], usage: advisedUsage(FABLE) } }),
  ]
  // Dernière ligne du transcript : la réponse s'écrit peut-être encore, l'appel n'est pas rendu.
  expect(laneFromTranscript(text.join('\n'), true).advisor!.map(c => c.id)).toEqual(['srv-1'])
  // Une ligne écrite après (le résultat de Write) : la réponse est close, l'appel n'en aura jamais.
  const lane = laneFromTranscript([...text, JSON.stringify({ type: 'user', isSidechain: false, timestamp: at(9_800), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'x' }] } })].join('\n'), true)
  expect(lane.advisor).toEqual([
    { id: 'srv-1', s: T1 + 1_000, e: T1 + 9_000, model: 'claude-fable-5-1', tokens: { input: 156_265, output: 6_473, cacheRead: 0, cacheWrite: 0 } },
    { id: 'srv-2', s: T1 + 9_700, e: T1 + 9_700, isVoid: true },
  ])
  // Vu en direct, puis relu : la marque se garde, sur le disque comme à la fusion.
  let reg = addAdvisorCalls(emptyRegistry('s', '/p', T1), MAIN, [{ id: 'srv-2', name: 'advisor', startedAt: T1 + 9_700, endedAt: T1 + 9_725 }], T1 + 9_800)!
  reg = applyRebuilt(reg, { v: 1, session: 's', agents: [], main: { advisor: lane.advisor! } }, T1 + 20_000)
  const kept = cleanRegistry(JSON.parse(JSON.stringify(reg)))!
  expect(kept.advisor!.calls.map(c => [c.id, c.isVoid === true])).toEqual([['srv-1', false], ['srv-2', true]])
  const prices = { 'claude-fable-5-1': { input: 10e-6, output: 50e-6, cacheRead: 1e-6, cacheWrite: 12.5e-6 } }
  expect(advisorCostOf(kept.advisor!.calls, prices)).toMatchObject({ isUnknown: false, unread: 0 })
  expect(Math.round(advisorCostOf(kept.advisor!.calls, prices).cost! * 1000)).toBe(1886)
  // Des chiffres arrivés ensuite pour le même appel lèvent la marque.
  const answered = catchUpAdvisor(kept, MAIN, [{ id: 'srv-2', s: T1 + 9_700, model: 'claude-fable-5-1', tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }], T1 + 30_000)!
  expect(answered.advisor!.calls.find(c => c.id === 'srv-2')).toMatchObject({ model: 'claude-fable-5-1', isRead: true })
  expect(answered.advisor!.calls.find(c => c.id === 'srv-2')!.isVoid).toBeUndefined()
  // Une réponse interrompue pendant l'advisor, sans outil de la session : l'appel a pu coûter, il reste sans prix.
  const stopped = [
    JSON.stringify({ type: 'assistant', isSidechain: false, timestamp: at(1_000), message: { id: 'm3', model: 'claude-opus-5-5', content: [{ type: 'server_tool_use', id: 'srv-3', name: 'advisor', input: {} }] } }),
    JSON.stringify({ type: 'user', isSidechain: false, timestamp: at(2_000), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
  ].join('\n')
  expect(laneFromTranscript(stopped, true).advisor).toEqual([{ id: 'srv-3', s: T1 + 1_000, e: T1 + 1_000 }])
  // Une réponse coupée qui a son entrée d'usage reste un appel chiffré, pas un appel sans réponse.
  const cut = advisedTranscript(FABLE).split('\n').filter(l => !l.includes('advisor_tool_result')).join('\n')
  expect(laneFromTranscript(cut).advisor![0]!.isVoid).toBeUndefined()
})

test('un appel sans réponse ne se montre pas sur la ligne advisor, et le résumé garde le coût des autres', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T1 + 60_000 })
  const mem = world(on)
  mem['agents:s-adv'] = {
    v: 1,
    session: 's-adv',
    root: '/p',
    updatedAt: T1 + 60_000,
    agents: [],
    main: { segments: [{ k: 'write', s: T1, e: T1 + 500 }, { k: 'waitAdvisor', s: T1 + 500, e: T1 + 525, t: 'advisor' }, { k: 'write', s: T1 + 525, e: T1 + 20_000 }] },
    advisor: {
      calls: [
        { id: 'srv-0', s: T1 + 500, e: T1 + 525, by: 'main', isRead: true, isVoid: true },
        { id: 'srv-1', s: T1 + 1_000, e: T1 + 9_000, by: 'main', model: 'claude-fable-5-1', tokens: { input: 156_265, output: 6_473, cacheRead: 0, cacheWrite: 0 }, isRead: true },
      ],
    },
  }
  mem.agentPrices = { at: T1 + 60_000, triedAt: T1 + 60_000, prices: { 'claude-fable-5-1': { input: 10e-6, output: 50e-6, cacheRead: 1e-6, cacheWrite: 12.5e-6 } } }
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await clock.advance(2_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /advisor\s≈\s1,89\s\$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /coût\sinconnu/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^1\sappel$/ })).toBeDefined()
  // L'attente posée en direct pour l'appel sans réponse ne reste pas sur la piste de l'appelant.
  const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt).replace(/ /g, ' '))
  expect(alts.find(alt => alt.startsWith('Orchestrateur :'))).toBe('Orchestrateur : rédaction')
  await ui.unmount()
})
