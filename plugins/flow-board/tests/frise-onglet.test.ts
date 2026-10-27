import { expect, mock, test } from 'claude-code/testing'

import type { SessionRegistry } from '../types'

const PLUGIN = 'flow-board'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const
const ALL = ['terminal', 'desktop', 'vscode', 'mobile'] as const

/** Le moteur sous le plugin : la session « s-frise », un stockage en mémoire. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-frise' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  return mem
}

/**
 * Un sous-agent qui réfléchit 2 s, écrit un Read (0,5 s), le lance (0,3 s), puis demande une
 * commande : l'autorisation le fait attendre 5 s, la commande tourne 1 s ; il rédige 1 s, puis finit.
 */
const scenario = async ($: any, on: any, clock: any) => {
  let plan: 'read' | 'bash' | 'report' = 'read'
  on('turn.step', async function* (_$: unknown, e: any) {
    if (e.agentId === undefined) return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    yield { kind: 'thinking', index: 0, text: '' }
    await clock.advance(2_000)
    if (plan === 'report') {
      yield { kind: 'text', index: 1, text: 'Rapport' }
      await clock.advance(1_000)
    } else {
      yield { kind: 'tool', index: 1, id: plan === 'read' ? 'tu-read' : 'tu-bash', name: plan === 'read' ? 'Read' : 'Bash' }
      await clock.advance(500)
    }
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' }
    yield { kind: 'stop', stopReason: plan === 'report' ? 'end_turn' : 'tool_use', usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  on('tool.call', { tool: 'Read' }, async () => {
    await clock.advance(300)
    return { result: { ok: true } }
  })
  on('tool.call', { tool: 'Bash' }, async () => {
    // L'autorisation demandée, accordée 5 s plus tard, puis 1 s de commande.
    await $.classic.PermissionRequest({ tool_name: 'Bash', agent_id: 'a1', tool_input: {}, session_id: 's-frise', transcript_path: 't', cwd: '/p', hook_event_name: 'PermissionRequest' })
    await clock.advance(6_000)
    await $.classic.PostToolUse({ tool_name: 'Bash', tool_use_id: 'tu-bash', duration_ms: 1_000, agent_id: 'a1', tool_input: {}, tool_response: {}, session_id: 's-frise', transcript_path: 't', cwd: '/p', hook_event_name: 'PostToolUse' })
    return { result: { stdout: 'ok' } }
  })
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }))

  await $.tool.call({ tool: 'Agent', description: 'Explorer le module', prompt: 'p', run_in_background: true, tool_use_id: 'call-1' })
  const step = async (index: number) => {
    for await (const _ of $.turn.step({ turnId: 'ta', index, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' })) {
      // la réponse du sous-agent
    }
  }
  await step(0)
  await $.tool.call({ tool: 'Read', file_path: '/p/hooks/view.tsx', tool_use_id: 'tu-read', agentId: 'a1' })
  plan = 'bash'
  await step(1)
  await $.tool.call({ tool: 'Bash', command: 'touch b.txt', tool_use_id: 'tu-bash', agentId: 'a1' })
  plan = 'report'
  await step(2)
}

test('les requêtes et les outils d’un sous-agent deviennent des segments datés de sa piste', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 40_000_000 })
  const mem = world(on)
  await scenario($, on, clock)
  await clock.advance(1_000)
  const reg = mem['agents:s-frise'] as SessionRegistry
  const segs = reg.agents[0]!.segments!.map(s => `${s.k}${s.f ? `/${s.f}` : ''}:${(s.e ?? NaN) - s.s}${s.a ? `:${s.a}` : ''}`)
  expect(segs).toEqual(['think:2000', 'tool/read:800:hooks/view.tsx', 'think:2000', 'tool/run:500:touch b.txt', 'waitPerson:5000', 'tool/run:1000:touch b.txt', 'think:2000', 'write:1000'])
  // Le départ est relevé sur la piste de l'orchestrateur.
  expect(reg.main?.marks?.map(m => m.k)).toEqual(['relay'])
})

test('la frise se dessine sur les 4 surfaces : SVG décrit par son texte alt, cases au terminal, réglage « dernière heure »', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 41_000_000 })
  world(on)
  await scenario($, on, clock)
  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Button', text: /Orchestrateur$/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Explorer le module$/ })).toBeDefined()
    if (surface === 'terminal') {
      // Une grille de cases, ou à défaut des barres de glyphes : la réflexion « ▒ » s'y lit.
      const drawn = JSON.stringify(await ui.drawn())
      expect(/"Raster"|▒/.test(drawn)).toBe(true)
    } else {
      const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
      expect(alts).toContain('Explorer le module : réflexion, outil ⌕, réflexion, outil ❯, attente de toi, outil ❯, réflexion, rédaction')
    }
    expect(await ui.find({ type: 'Text', text: /rédaction/ })).toBeDefined()
    await ui.press({ key: 'agents-range' })
    expect(await ui.find({ key: 'agents-range' })).toBeDefined()
    await ui.press({ key: 'agents-range' })
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})

test('un sous-agent sans fin vue garde son segment en cours, qui s’allonge', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 42_000_000 })
  const mem = world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }))
  on('tool.call', { tool: 'Grep' as any }, async () => {
    await clock.advance(60_000)
    return { result: {} }
  })
  await $.tool.call({ tool: 'Agent', description: 'Chercheur', prompt: 'p', run_in_background: true, tool_use_id: 'call-1' } as any)
  await ($ as any).agent.spawn({ prompt: 'p', description: 'Chercheur', background: true, tool_use_id: 'call-1' })
  const pending = $.tool.call({ tool: 'Grep', pattern: 'x', tool_use_id: 'tu-1', agentId: 'a1' } as any)
  await clock.advance(1_000)
  const reg = mem['agents:s-frise'] as SessionRegistry
  expect(reg.agents[0]!.segments?.[0]).toMatchObject({ k: 'tool', f: 'read', a: 'x' })
  expect(reg.agents[0]!.segments?.[0]!.e).toBeUndefined()
  await pending
})

test('le retour d’un sous-agent se pose sur la piste du lanceur quand son message arrive ; un tour interrompu ferme ses segments', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 43_000_000 })
  const mem = world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }))
  on('classic.SubagentStop', () => ({}))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.step', async function* (_$: unknown, e: any) {
    yield { kind: 'thinking', index: 0, text: '' }
    await clock.advance(1_000)
    throw new Error('interrompu')
  })
  await $.tool.call({ tool: 'Agent', description: 'Chercheur', prompt: 'p', run_in_background: true, tool_use_id: 'call-1' } as any)
  await ($ as any).agent.spawn({ prompt: 'p', description: 'Chercheur', background: true, tool_use_id: 'call-1' })
  try {
    for await (const _ of $.turn.step({ turnId: 'ta', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' } as any)) {
      // la réponse, coupée
    }
  } catch {
    // l'interruption remonte au moteur
  }
  // Une fin de tour du sous-agent ne pose pas de retour : il n'a encore rien rendu au fil principal.
  await ($ as any).classic.SubagentStop({ agent_id: 'a1', agent_type: 'general-purpose', agent_transcript_path: 'x', stop_hook_active: false })
  await $.prompt.submit({ text: '<agent-message from="a1">Rapport</agent-message>', origin: { kind: 'peer' } } as any)
  await clock.advance(1_000)
  const reg = mem['agents:s-frise'] as SessionRegistry
  expect(reg.agents[0]!.segments!.every(s => s.e !== undefined)).toBe(true)
  expect(reg.main!.marks!.map(m => m.k)).toEqual(['relay', 'back'])
})
