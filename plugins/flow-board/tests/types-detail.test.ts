import { expect, mock, test } from 'claude-code/testing'

import { addUsage, agentTypeOf, emptyRegistry, linesOf, spawnAgent, startCall } from '../hooks/registry.ts'
import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'

const PLUGIN = 'flow-board'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

test('le type d’un sous-agent : son subagent_type, puis ce que flow-board a demandé, puis sa description', () => {
  expect(agentTypeOf('agents:explorer', 'review', 'Relecture du diff')).toBe('explore')
  expect(agentTypeOf('Explore', undefined, 'x')).toBe('explore')
  expect(agentTypeOf('agents:researcher', undefined, 'x')).toBe('research')
  expect(agentTypeOf('claude-code-guide', undefined, 'x')).toBe('research')
  expect(agentTypeOf('agents:worker', undefined, 'x')).toBe('implement')
  expect(agentTypeOf('Plan', undefined, 'x')).toBe('plan')
  // Un coéquipier d'une équipe d'agents : « Autre ».
  expect(agentTypeOf('teammate', undefined, 'Relecture')).toBe('other')
  // general-purpose ne dit rien : ce que flow-board a demandé l'emporte sur la description.
  expect(agentTypeOf('general-purpose', 'security', 'Relecture du groupe')).toBe('security')
  expect(agentTypeOf('general-purpose', undefined, 'Revue de sécurité du groupe A')).toBe('security')
  expect(agentTypeOf('general-purpose', undefined, 'Revue 02 axe Standards')).toBe('review')
  expect(agentTypeOf('general-purpose', undefined, 'Merge des groupes')).toBe('merge')
  expect(agentTypeOf('general-purpose', undefined, 'Rétro : transcript de la session B')).toBe('transcripts')
  expect(agentTypeOf('general-purpose', undefined, 'Cartographier le module')).toBe('explore')
  expect(agentTypeOf('general-purpose', undefined, 'Chercher la doc du SDK')).toBe('research')
  expect(agentTypeOf('general-purpose', undefined, 'Implement ticket #12')).toBe('implement')
  expect(agentTypeOf(undefined, undefined, 'Quelque chose')).toBe('other')
})

test('les tokens s’additionnent requête par requête ; modèles et effort sont relevés', () => {
  let r = startCall(emptyRegistry('s1', '/p', 0), { key: 't1', name: 'X', isBackground: true }, 1)!
  r = spawnAgent(r, { agentId: 'a1', callKey: 't1', isBackground: true }, new Set(), 1)!
  r = addUsage(r, 'a1', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7, model: 'claude-haiku-5-5' }, 'medium', 2)!
  r = addUsage(r, 'a1', { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }, 'medium', 3)!
  expect(r.agents[0]).toMatchObject({ tokens: { input: 11, output: 7, cacheRead: 100, cacheWrite: 7 }, models: ['claude-haiku-5-5', 'claude-sonnet-5-5'], effort: 'medium' })
  // Seules les lignes changées comptent, pas le contexte que le remplacement recopie.
  expect(linesOf('Edit', { old_string: 'a\nb', new_string: 'a\nb\nc' })).toEqual({ added: 1, removed: 0 })
  expect(linesOf('Edit', { old_string: 'a\nx\nb', new_string: 'a\ny\nz\nb' })).toEqual({ added: 2, removed: 1 })
  expect(linesOf('Write', { content: 'x\ny' })).toEqual({ added: 2, removed: 0 })
  expect(linesOf('Read', { file_path: 'x' })).toEqual({ added: 0, removed: 0 })
})

test('le bouton d’une piste ouvre sa carte de détail, puis la referme ; la carte survit aux rafraîchissements', async ($, on) => {
  const clock = mock.clock(on, { now: 50_000_000 })
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-carte' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value
    return { value: undefined }
  })
  const viewed: unknown[] = []
  on('ui.view', (_$: unknown, e: unknown) => {
    viewed.push(e)
    return { value: {} }
  })
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  on('tool.call', { tool: 'Edit' }, async () => {
    await clock.advance(400)
    return { result: {} }
  })
  on('tool.call', { tool: 'Grep' as any }, () => ({ isError: true, result: 'boom', text: 'boom' }))
  on('turn.step', stoppedStep(stepUsage('claude-haiku-5-5', { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 45_000, cache_creation_input_tokens: 800 })))
  const prompt = ['Relis le diff du ticket 02.', 'Ligne deux.', 'Ligne trois.', 'Ligne quatre, cachée au départ.'].join('\n')
  await $.tool.call({ tool: 'Agent', description: 'Revue 02 axe Standards', subagent_type: 'general-purpose', prompt, run_in_background: true, tool_use_id: 'call-1' } as any)
  await ($ as any).agent.spawn({ prompt, description: 'Revue 02 axe Standards', background: true, tool_use_id: 'call-1' })
  await playStep($, { turnId: 'ta', model: 'claude-haiku-5-5', agentId: 'a1', effort: 'high' })
  await $.tool.call({ tool: 'Edit', file_path: '/p/hooks/view.tsx', old_string: 'a', new_string: 'a\nb', tool_use_id: 'e1', agentId: 'a1' } as any)
  await $.tool.call({ tool: 'Grep', pattern: 'agentCard', tool_use_id: 'g1', agentId: 'a1' } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  // Le type donne son glyphe au bouton : une relecture (mots-clés de la description).
  expect(await ui.find({ type: 'Button', text: /^◇\sRevue 02 axe Standards$/ })).toBeDefined()
  await ui.press({ key: 'lane-call-1' })
  expect(await ui.find({ type: 'Text', text: /Relecture de code/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /entrée 1,2\sk · sortie 340 · cache lu 45\sk · cache écrit 800/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '−0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /claude-haiku-5-5|haiku-5-5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Orchestrateur$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^hooks\/view\.tsx$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^erreur$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^high$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Ligne quatre/ })).toBeUndefined()
  await ui.press({ key: 'prompt-call-1' })
  expect(await ui.find({ type: 'Text', text: /Ligne quatre/ })).toBeDefined()
  // Rafraîchi, la carte reste ouverte.
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: /Relecture de code/ })).toBeDefined()
  await ui.press({ key: 'transcript-call-1' })
  expect(viewed).toEqual([{ agentId: 'a1' }])
  // La carte se referme par son bouton.
  await ui.press({ key: 'lane-call-1' })
  expect(await ui.find({ type: 'Text', text: /Relecture de code/ })).toBeUndefined()
  // L'orchestrateur a sa carte, sans transcription à ouvrir d'ici.
  await ui.press({ key: 'lane-main' })
  expect(await ui.find({ key: 'card-main' })).toBeDefined()
  expect(await ui.find({ key: 'transcript-main' })).toBeUndefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('un coéquipier d’une équipe d’agents est « Autre », quelle que soit sa description', () => {
  let r = startCall(emptyRegistry('s1', '/p', 0), { key: 't1', name: 'Relecture du lot', isBackground: true }, 1)!
  expect(r.agents[0]!.type).toBe('review')
  r = spawnAgent(r, { agentId: 'a1', callKey: 't1', isBackground: true, isTeammate: true }, new Set(), 2)!
  expect(r.agents[0]!.type).toBe('other')
})

test('ce que flow-board a demandé : pendant une revue, un sous-agent general-purpose est une relecture', async ($, on) => {
  mock.clock(on, { now: 51_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await $.skill.prompt({ skill: 'mattpocock-skills:code-review', text: 'x' })
  await $.tool.call({ tool: 'Agent', description: 'Chercher les appels', subagent_type: 'general-purpose', prompt: 'p', run_in_background: true, tool_use_id: 'call-r' } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Button', text: /^◇\sChercher les appels$/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})
