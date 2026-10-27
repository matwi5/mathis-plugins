import { expect, mock, test } from 'claude-code/testing'

import { emptyRegistry, endCall, parseRegistry, startCall } from '../hooks/registry.ts'
import { catchUp, laneFromTranscript, metaFromText, subagentsDirOf } from '../hooks/transcript.ts'

// Des extraits de transcripts écrits à la main, aux noms de champs relevés sur le disque
// (26/10/2026), sans aucun texte réel de message.
const T0 = Date.parse('2026-10-26T15:32:56.000Z')
const iso = (ms: number) => new Date(T0 + ms).toISOString()
const usage = (output: number) => ({ input_tokens: 10, output_tokens: output, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 50 })
const lines = (...rows: Record<string, unknown>[]) => rows.map(r => JSON.stringify(r)).join('\n')
const req = (ms: number) => ({ type: 'api-request', id: `r${ms}`, timestamp: iso(ms) })
const block = (ms: number, msg: string, content: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'assistant',
  isSidechain: true,
  agentId: 'a1',
  timestamp: iso(ms),
  effort: 'high',
  message: { id: msg, model: 'claude-haiku-5-5', role: 'assistant', content: [content], usage: usage(300) },
  ...extra,
})
const result = (ms: number, id: string, isError = false) => ({ type: 'user', isSidechain: true, timestamp: iso(ms), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x', is_error: isError }] } })

const AGENT = lines(
  { type: 'user', isSidechain: true, timestamp: iso(0), message: { role: 'user', content: 'brief' } },
  req(100),
  block(900, 'm1', { type: 'thinking', thinking: '', signature: 's' }),
  block(1_300, 'm1', { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/p/hooks/view.tsx' } }),
  result(1_500, 't1'),
  req(1_520),
  block(2_400, 'm2', { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/p/a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' } }),
  result(3_000, 't2'),
  req(3_020),
  block(3_800, 'm3', { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test' } }),
  result(6_000, 't3', true),
  req(6_100),
  block(7_000, 'm4', { type: 'text', text: '' }),
)

test('un transcript de sous-agent devient une piste : réflexion estimée, appels d’outils datés, tokens comptés une fois par réponse', () => {
  const lane = laneFromTranscript(AGENT)
  expect(lane.segments!.map(s => `${s.k}${s.est ? '~' : ''}${s.f ? `/${s.f}` : ''}:${s.e! - s.s}${s.x ? ':x' : ''}`)).toEqual([
    'think~:800',
    'tool/read:600',
    'tool/edit:1480',
    'tool/run:2980:x',
    'write:900',
  ])
  // Quatre réponses : leurs tokens une fois chacune, même quand une réponse a deux blocs.
  expect(lane.tokens).toEqual({ input: 40, output: 1_200, cacheRead: 4_000, cacheWrite: 200 })
  expect(lane).toMatchObject({ models: ['claude-haiku-5-5'], effort: 'high', lines: { added: 2, removed: 1 }, toolCount: 3, startedAt: T0, endedAt: T0 + 7_000 })
  expect(lane.segments![1]!.a).toBe('hooks/view.tsx')
})

test('un transcript partiel ou illisible : les lignes coupées sont sautées, un appel sans résultat ne fait pas de segment', () => {
  const partial = `${AGENT.split('\n').slice(0, 7).join('\n')}\n{"type":"assistant","timest`
  const lane = laneFromTranscript(partial)
  expect(lane.segments!.map(s => s.k)).toEqual(['think', 'tool'])
  expect(laneFromTranscript('pas du json\n\n{').segments).toEqual([])
  expect(metaFromText('{"agentType":"agents:explorer","description":"Explorer","toolUseId":"call-1","finished":true}')).toEqual({ agentType: 'agents:explorer', description: 'Explorer', toolUseId: 'call-1', isFinished: true })
  expect(metaFromText('{coupé')).toEqual({})
  expect(subagentsDirOf('/h/.claude/projects/-p/abc.jsonl')).toBe('/h/.claude/projects/-p/abc/subagents')
})

test('le rattrapage clôt une fin manquée, donne ses totaux à un sous-agent de fond, et ajoute un sous-agent jamais vu', () => {
  let reg = startCall(emptyRegistry('s1', '/p', 0), { key: 'call-1', name: 'Explorer', isBackground: true }, T0)!
  reg = endCall(reg, 'call-1', { agentId: 'a1', isFailed: false, isFinished: false }, T0 + 10)!
  const lane = laneFromTranscript(AGENT)
  const next = catchUp(
    reg,
    [
      { agentId: 'a1', lane, meta: { toolUseId: 'call-1', isFinished: true } },
      { agentId: 'a9', lane, meta: { agentType: 'agents:researcher', description: 'Chercher la doc', toolUseId: 'call-9', isFinished: true } },
    ],
    T0 + 20_000,
  )!
  const a1 = next.agents.find(a => a.agentId === 'a1')!
  expect(a1).toMatchObject({ status: 'done', finishedAt: T0 + 7_000, tokens: { input: 40, output: 1_200, cacheRead: 4_000, cacheWrite: 200 }, source: 'live' })
  // Le direct n'avait aucun segment : ceux du transcript.
  expect(a1.segments).toHaveLength(5)
  const a9 = next.agents.find(a => a.agentId === 'a9')!
  expect(a9).toMatchObject({ key: 'call-9', name: 'Chercher la doc', type: 'research', status: 'done', source: 'transcript' })
  // Rien de neuf : rien ne change.
  expect(catchUp(next, [{ agentId: 'a1', lane, meta: { toolUseId: 'call-1', isFinished: true } }], T0 + 30_000)).toBeNull()
})

test('le direct garde ses segments (attentes d’autorisation comprises) et un appel encore en vol ici n’est pas clos', () => {
  let reg = startCall(emptyRegistry('s1', '/p', 0), { key: 'call-1', name: 'Explorer', isBackground: true }, T0)!
  reg = endCall(reg, 'call-1', { agentId: 'a1', isFailed: false, isFinished: false }, T0 + 10)!
  reg = { ...reg, agents: reg.agents.map(a => ({ ...a, segments: [{ k: 'waitPerson' as const, s: T0 + 100, e: T0 + 900 }] })) }
  const next = catchUp(reg, [{ agentId: 'a1', lane: laneFromTranscript(AGENT), meta: { toolUseId: 'call-1', isFinished: true } }], T0 + 20_000, new Set(['call-1']))!
  const a1 = next.agents[0]!
  expect(a1.segments).toEqual([{ k: 'waitPerson', s: T0 + 100, e: T0 + 900 }])
  expect(a1.status).toBe('running')
  expect(a1.tokens?.output).toBe(1_200)
})

test('sans « finished » dans son .meta.json, un transcript resté muet 30 min dit son sous-agent fini ; récent, il reste au travail', () => {
  let reg = startCall(emptyRegistry('s1', '/p', 0), { key: 'call-1', name: 'Explorer', isBackground: true }, T0)!
  reg = endCall(reg, 'call-1', { agentId: 'a1', isFailed: false, isFinished: false }, T0 + 10)!
  const lane = laneFromTranscript(AGENT)
  expect(catchUp(reg, [{ agentId: 'a1', lane, meta: { toolUseId: 'call-1' } }], T0 + 7_000 + 31 * 60_000)!.agents[0]).toMatchObject({ status: 'done', finishedAt: T0 + 7_000 })
  expect(catchUp(reg, [{ agentId: 'a1', lane, meta: { toolUseId: 'call-1' } }], T0 + 60_000)!.agents[0]!.status).toBe('running')
})

test('un registre illisible (point d’entrée 2) : reparti de zéro, le rattrapage rend ses sous-agents, imbrication comprise', () => {
  const lane = laneFromTranscript(AGENT)
  const rebuilt = catchUp(emptyRegistry('s1', '/p', 0), [
    { agentId: 'a1', lane, meta: { toolUseId: 'call-1', description: 'Relecteur du groupe', isFinished: true } },
    { agentId: 'a2', lane, meta: { description: 'Axe Standards', parentAgentId: 'a1', isFinished: true } },
  ], T0 + 60_000)!
  expect(rebuilt.agents.map(a => [a.key, a.parent, a.status, a.source])).toEqual([
    ['call-1', undefined, 'done', 'transcript'],
    ['agent:a2', 'a1', 'done', 'transcript'],
  ])
})

// ─── Par le mod entier ─────────────────────────────────────────────────────

const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const META = JSON.stringify({ agentType: 'agents:explorer', isBuiltIn: false, description: 'Explorer le module', toolUseId: 'call-1', spawnDepth: 1, finished: true })
const MAIN = lines(
  { type: 'user', isSidechain: false, timestamp: iso(0), message: { role: 'user', content: 'demande' } },
  req(100),
  { ...block(800, 'm0', { type: 'tool_use', id: 'tA', name: 'Agent', input: { description: 'Explorer le module' } }), isSidechain: false },
  { ...result(1_000, 'tA'), isSidechain: false },
  req(1_100),
  { ...block(2_000, 'm9', { type: 'text', text: '' }), isSidechain: false },
)

/** Le moteur sous le plugin, et les transcripts de la session `s-rat` sur un disque simulé. */
const world = (on: any, seed: Record<string, unknown> = {}, extra: Record<string, string> = {}) => {
  mock.env(on, { CLAUDE_CONFIG_DIR: '/t' })
  const mem: Record<string, unknown> = { ...seed }
  const files: Record<string, string> = { '/t/projects/-p/s-rat.jsonl': MAIN, '/t/projects/-p/s-rat/subagents/agent-a1.jsonl': AGENT, '/t/projects/-p/s-rat/subagents/agent-a1.meta.json': META, ...extra }
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-rat' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.list', (_$: unknown, e: { path?: string }) => {
    const dir = `${String(e.path ?? '').replace(/\/$/, '')}/`
    const names = Object.keys(files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    if (names.length === 0) throw new Error(`ENOENT ${e.path}`)
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file', size: files[p]!.length, mtimeMs: 1, isLink: false })) } as any
  })
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.SubagentStop', () => ({}))
  return mem
}

const prompt = ($: any) =>
  $.classic.UserPromptSubmit({ session_id: 's-rat', transcript_path: '/t/projects/-p/s-rat.jsonl', cwd: '/p', hook_event_name: 'UserPromptSubmit', prompt: 'x' })

test('à l’ouverture de l’onglet, un sous-agent de fond reçoit ses chiffres de son transcript, et sa fin manquée se clôt', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60_000 })
  world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await prompt($)
  await $.tool.call({ tool: 'Agent', description: 'Explorer le module', prompt: 'p', run_in_background: true, tool_use_id: 'call-1' } as any)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await clock.advance(200)
  expect(await ui.find({ type: 'Text', text: /1\sagent\s·\sau\srepos/ })).toBeDefined()
  await ui.press({ key: 'lane-call-1' })
  expect(await ui.find({ type: 'Text', text: /sortie 1,2\sk/ })).toBeDefined()
  await ui.press({ key: 'lane-call-1' })
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('à la fin d’un sous-agent dont les chiffres manquent, son transcript les donne', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60_000 })
  const mem = world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await prompt($)
  await $.tool.call({ tool: 'Agent', description: 'Explorer le module', prompt: 'p', run_in_background: true, tool_use_id: 'call-1' } as any)
  await ($ as any).classic.SubagentStop({ agent_id: 'a1', agent_type: 'agents:explorer', agent_transcript_path: '/t/projects/-p/s-rat/subagents/agent-a1.jsonl', stop_hook_active: false })
  await clock.advance(1_000)
  const a1 = parseRegistry(mem['agents:s-rat'])!.agents[0]!
  expect(a1.tokens).toEqual({ input: 40, output: 1_200, cacheRead: 4_000, cacheWrite: 200 })
  expect(a1.lines).toEqual({ added: 2, removed: 1 })
})

test('un fichier de registre illisible est reconstruit depuis le transcript par sa propre session', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60_000 })
  const mem = world(on, { 'agents:s-rat': '{"v":1,"session":"s-rat","agents":[{"key"' })
  await prompt($)
  await clock.advance(1_000)
  const reg = parseRegistry(mem['agents:s-rat'])!
  expect(reg.agents.map(a => [a.key, a.name, a.status, a.source])).toEqual([['call-1', 'Explorer le module', 'done', 'transcript']])
  // La piste de la session elle-même revient aussi : la rédaction de sa réponse.
  expect(reg.main?.segments?.some(x => x.k === 'write')).toBe(true)
})

test('S13 : pour une session liée affichée, le rattrapage écrit son fichier à part, jamais le sien, et la frise en profite', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60_000 })
  const LINKED = '9f3e21aa-1111-2222-3333-444455556666'
  const linkedReg = { ...startCall({ ...emptyRegistry(LINKED, '/p', T0), title: 'Explorer le cache', transcript: '/t/projects/-p/lie.jsonl' }, { key: 'call-1', name: 'Explorer le module', isBackground: true }, T0 + 50)!, updatedAt: T0 + 59_000 }
  const mem = world(on, { [`agents:${LINKED}`]: { ...linkedReg, agents: linkedReg.agents.map(a => ({ ...a, agentId: 'a1' })) } }, { '/t/projects/-p/lie/subagents/agent-a1.jsonl': AGENT, '/t/projects/-p/lie/subagents/agent-a1.meta.json': META })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'backgrounded · 9f3e21aa · Explorer le cache\n' } }))
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  const before = JSON.stringify(mem[`agents:${LINKED}`])
  await $.tool.call({ tool: 'Bash', command: 'claude --bg -n "Explorer le cache" "go"' } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-session-9f3e21aa' })
  await clock.advance(200)
  // Le fichier à part porte le rattrapage ; celui de la session liée n'a pas bougé (Q7).
  expect((mem[`agents:${LINKED}:rebuilt`] as { agents: unknown[] }).agents).toHaveLength(1)
  expect(JSON.stringify(mem[`agents:${LINKED}`])).toBe(before)
  await clock.advance(1_000)
  await ui.press({ key: 'lane-call-1' })
  expect(await ui.find({ type: 'Text', text: /sortie 1,2\sk/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})
