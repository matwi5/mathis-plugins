import { expect, mock, test } from 'claude-code/testing'

import { emptyRegistry, endCall, startCall } from '../hooks/registry.ts'
import type { SessionRegistry } from '../types'

const PLUGIN = 'flow-board'
const KEY = 'agents:s-test'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

/** Le moteur sous le plugin : la session « s-test », un stockage en mémoire que le test lit et modifie. */
const world = (on: any, seed: Record<string, unknown> = {}, session = () => 's-test') => {
  const mem: Record<string, unknown> = { ...seed }
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: session() }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  return mem
}

const stored = (mem: Record<string, unknown>): SessionRegistry => {
  const value = mem[KEY]
  return (typeof value === 'string' ? JSON.parse(value) : value) as SessionRegistry
}

const launch = ($: any, description: string) => $.tool.call({ tool: 'Agent', description, prompt: `Brief de ${description}`, run_in_background: true })

test('le registre de la session s’écrit peu après un lancement, prompt compris, sans parcours', async ($, on) => {
  const clock = mock.clock(on, { now: 30_000_000 })
  const mem = world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await launch($, 'Explorer le module')
  await clock.advance(1_000)
  const reg = stored(mem)
  expect(reg.session).toBe('s-test')
  expect(reg.agents).toHaveLength(1)
  expect(reg.agents[0]).toMatchObject({ name: 'Explorer le module', agentId: 'a1', prompt: 'Brief de Explorer le module', status: 'running' })
})

test('l’onglet montre tous les sous-agents, sans limite ni « tout voir »', async ($, on) => {
  mock.clock(on, { now: 30_500_000 })
  world(on)
  let n = 0
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'completed', agentId: `a${++n}` } }))
  for (let i = 1; i <= 15; i++) await launch($, `Agent numéro ${i}`)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /15\sagents\s·\sau\srepos/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Agent numéro 1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Agent numéro 15$/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('S7 : une écriture relit le fichier et garde les sous-agents d’un autre processus de la même session', async ($, on) => {
  const clock = mock.clock(on, { now: 31_000_000 })
  const other = endCall(startCall(emptyRegistry('s-test', '', 1), { key: 'autre', name: 'Lancé ailleurs', isBackground: true }, 2)!, 'autre', { isFailed: false, isFinished: true }, 3)!
  const mem = world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await launch($, 'Lancé ici')
  // L'autre processus écrit après le chargement de celui-ci : la fusion le retrouve.
  mem[KEY] = other
  await launch($, 'Encore ici')
  await clock.advance(1_000)
  expect(stored(mem).agents.map(a => a.name).sort()).toEqual(['Encore ici', 'Lancé ailleurs', 'Lancé ici'])
  // Et l'onglet le montre aussi.
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Button', text: /Lancé ailleurs/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('S8 : un fichier illisible au démarrage est réécrit avec ce que la session sait', async ($, on) => {
  const clock = mock.clock(on, { now: 32_000_000 })
  const mem = world(on, { [KEY]: '{"v":1,"session":"s-test","agents":[{"key"' })
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await launch($, 'Après la coupure')
  await clock.advance(1_000)
  expect(stored(mem).agents.map(a => a.name)).toEqual(['Après la coupure'])
})

test('après un /clear, la discussion suivante a son propre registre ; l’en-tête porte son titre et son transcript', async ($, on) => {
  const clock = mock.clock(on, { now: 34_000_000 })
  let id = 's-test'
  const mem = world(on, {}, () => id)
  on('session.end', () => ({ sessionId: 's-test' }))
  on('classic.UserPromptSubmit', () => ({}))
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await ($ as any).classic.UserPromptSubmit({ session_id: 's-test', transcript_path: '/t/s-test.jsonl', cwd: '/p', hook_event_name: 'UserPromptSubmit', prompt: 'x', session_title: 'Avant le clear' })
  await launch($, 'Avant le clear')
  await clock.advance(1_000)
  await $.session.end({ reason: 'clear' } as any)
  id = 's-apres'
  await launch($, 'Après le clear')
  await clock.advance(1_000)
  expect(stored(mem)).toMatchObject({ title: 'Avant le clear', transcript: '/t/s-test.jsonl' })
  expect(stored(mem).agents.map(a => a.name)).toEqual(['Avant le clear'])
  expect((mem['agents:s-apres'] as SessionRegistry).agents.map(a => a.name)).toEqual(['Après le clear'])
})

test('S9 : la liste du moteur ne clôt pas un sous-agent chargé du fichier, seulement ceux lancés ici', async ($, on) => {
  const clock = mock.clock(on, { now: 35_000_000 })
  const elsewhere = startCall(emptyRegistry('s-test', '', 1), { key: 'ailleurs', name: 'Au travail ailleurs', isBackground: true }, 2)!
  const mem = world(on, { [KEY]: elsewhere })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await launch($, 'Lancé ici')
  await $.turn.start({ text: 'suite', turnId: 't1' } as any)
  await clock.advance(1_000)
  const byName = Object.fromEntries(stored(mem).agents.map(a => [a.name, a.status]))
  expect(byName).toEqual({ 'Au travail ailleurs': 'running', 'Lancé ici': 'done' })
})

test('deux appels parallèles de même description gardent chacun leur sous-agent (tool_use_id)', async ($, on) => {
  mock.clock(on, { now: 36_000_000 })
  world(on)
  on('classic.SubagentStop', () => ({}))
  let next = ''
  on('agent.spawn', () => ({ agentId: next, model: 'claude-haiku-5-5' }))
  // Des appels qui ne rendent pas l'id : seul le tool_use_id de agent.spawn dit quel sous-agent sert quel appel.
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched' } }))
  await $.tool.call({ tool: 'Agent', description: 'Relecture', prompt: 'axe 1', run_in_background: true, tool_use_id: 'call-1' } as any)
  await $.tool.call({ tool: 'Agent', description: 'Relecture', prompt: 'axe 2', run_in_background: true, tool_use_id: 'call-2' } as any)
  // Dans l'ordre inverse des appels.
  next = 'a2'
  await ($ as any).agent.spawn({ prompt: 'p', description: 'Relecture', background: true, tool_use_id: 'call-2' })
  next = 'a1'
  await ($ as any).agent.spawn({ prompt: 'p', description: 'Relecture', background: true, tool_use_id: 'call-1' })
  await ($ as any).classic.SubagentStop({ agent_id: 'a1', agent_type: 'general-purpose', agent_transcript_path: 'x', stop_hook_active: false })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /2\sagents\s·\s1\sau\stravail/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('S11 : une écriture refusée se dit dans l’onglet', async ($, on) => {
  const clock = mock.clock(on, { now: 37_000_000 })
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's-test' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (e.key.startsWith('agents:')) throw new Error('trop gros')
    mem[e.key] = e.value
    return { value: undefined }
  })
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await launch($, 'Un de trop')
  await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /n’est plus enregistré/ })).toBeDefined()
  // Le suivi en mémoire continue.
  expect(await ui.find({ type: 'Button', text: /Un de trop/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('un sous-agent réveillé par la notification d’un de ses enfants repasse au travail', async ($, on) => {
  const clock = mock.clock(on, { now: 33_000_000 })
  world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  on('classic.SubagentStop', () => ({}))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }))
  await launch($, 'Relecteur du groupe')
  await ($ as any).classic.SubagentStop({ agent_id: 'a1', agent_type: 'general-purpose', agent_transcript_path: 'x', stop_hook_active: false })
  // Un agent interne du moteur, jamais lancé par Agent : sa fin ne change rien.
  await ($ as any).classic.SubagentStop({ agent_id: 'interne', agent_type: 'general-purpose', agent_transcript_path: 'y', stop_hook_active: false })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /1\sagent\s·\sau\srepos/ })).toBeDefined()
  await ($ as any).agent.spawn({ prompt: 'notification', background: true })
  await clock.advance(100)
  expect(await ui.find({ type: 'Text', text: /1\sagent\s·\s1\sau\stravail/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})
