import { expect, mock, test } from 'claude-code/testing'

import { agentsOfRun, runRegistry, withRun } from '../hooks/history.ts'
import { emptyBoard, newRun, stripRunAgents } from '../hooks/model.ts'
import { laneFromTranscript } from '../hooks/transcript.ts'
import { emptyRegistry, rowsFromRun, startCall } from '../hooks/registry.ts'
import type { AgentRow, Board, Run, SessionRegistry } from '../types'

const PLUGIN = 'flow-board'
/** Le board du projet `/p` dans le stockage simulé (la racine de la session, voir `session.root`). */
const BOARD_KEY = 'board:/p'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const ROWS: AgentRow[] = [
  { key: 'call-1', agentId: 'a1', name: 'Explorer le module', role: 'exploration', model: 'haiku', isBackground: true, status: 'done', startedAt: 1_000, finishedAt: 9_000 },
  { key: 'call-2', name: 'Relecture', isBackground: false, status: 'running', startedAt: 2_000 },
  { key: 'call-3', agentId: 'a3', name: 'Ancien échec', isBackground: true, status: 'failed', startedAt: 3_000, finishedAt: 4_000, isEndUnseen: true },
]

/** Un parcours tel que les versions d'avant l'enregistraient : ses sous-agents dans son propre champ. */
const legacyRun = (title: string, now: number, extra: Partial<Run> = {}): Run => ({ ...newRun('implement', now, title), agents: ROWS, ...extra }) as Run

test('S1 : les lignes de l’ancien champ deviennent des entrées du registre de leur parcours, sans rien perdre', () => {
  const run = legacyRun('Lot', 500)
  const rows = rowsFromRun(run)
  expect(rows.map(r => [r.key, r.agentId, r.status, r.run, r.source])).toEqual([
    ['call-1', 'a1', 'done', run.id, 'live'],
    ['call-2', undefined, 'running', run.id, 'live'],
    ['call-3', 'a3', 'failed', run.id, 'live'],
  ])
  expect(rows[0]).toMatchObject({ name: 'Explorer le module', model: 'haiku', startedAt: 1_000, finishedAt: 9_000, type: 'explore' })
  expect(rows[2]!.isEndUnseen).toBe(true)
  // Un parcours sans ancien champ n'en donne aucune.
  expect(rowsFromRun(newRun('implement', 1, 'Neuf'))).toEqual([])
})

test('S1 et S21 : le champ se vide dans les parcours qui l’ont (liste vide) ; un board où il est vide ne change pas', () => {
  const board: Board = { ...emptyBoard('/p', 'p'), runs: [legacyRun('Lot', 500), newRun('implement', 600, 'Neuf')] }
  const stripped = stripRunAgents(board)!
  expect(stripped.runs.map(r => r.agents)).toEqual([[], []])
  expect(stripped.runs[0]!.title).toBe('Lot')
  expect(stripRunAgents(stripped)).toBeNull()
})

const world = (on: any, seed: Record<string, unknown>) => {
  const mem: Record<string, unknown> = { ...seed }
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-hist' }))
  on('session.root', () => ({ value: '/p' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  return mem
}

const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}

test('S1, S18 et S21 : au chargement, les lignes d’un ancien parcours vont dans le fichier du parcours, puis le champ se vide dans le board', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 70_000_000 })
  const run = legacyRun('Ancien lot', 69_000_000, { status: 'done', archivedAt: 69_500_000 })
  const mem = world(on, { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] } })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const file = mem[`agents:run-${run.id}:rebuilt`] as { rows: { key: string }[] }
  expect(file.rows.map(r => r.key)).toEqual(['call-1', 'call-2', 'call-3'])
  expect((mem[BOARD_KEY] as Board).runs.find(r => r.id === run.id)!.agents).toEqual([])
})

test('l’onglet Historique a un bouton « ◆ Agents » par parcours, archivés compris, qui ouvre l’onglet Agents sur ce parcours', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 71_000_000 })
  const run = legacyRun('Ancien lot', 70_000_000, { status: 'done', archivedAt: 70_500_000 })
  world(on, { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] } })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-history' })
    // Les archivés se montrent à la demande.
    if (!(await ui.find({ key: `agents-of-${run.id}` }))) await ui.press({ key: 'archived-toggle' })
    await ui.press({ key: `agents-of-${run.id}` })
    await clock.advance(300)
    // L'onglet Agents, sur ce parcours : ses anciens sous-agents, recopiés.
    expect(await ui.find({ type: 'Button', text: /Explorer le module$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ancien lot/ })).toBeDefined()
    // Retour à « Ici, maintenant » par le sélecteur.
    await ui.press({ key: 'agents-history' })
    await ui.press({ key: 'agents-history-now' })
    expect(await ui.find({ type: 'Button', text: /Explorer le module$/ })).toBeUndefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})

test('le sélecteur liste « Ici, maintenant », les parcours puis les discussions sans parcours qui ont lancé des agents, les plus récentes d’abord', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 72_000_000 })
  const run = { ...newRun('implement', 71_000_000, 'Lot du jour'), status: 'done' } as Run
  const withAgents = (session: string, at: number, title: string, root = '/p/.claude/worktrees/x'): SessionRegistry => ({
    ...startCall({ ...emptyRegistry(session, root, at), title }, { key: `k-${session}`, name: `Agent de ${title}`, isBackground: true }, at)!,
    updatedAt: at,
  })
  const mem = world(on, {
    [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] },
    'agents:old-1': withAgents('old-1', 71_100_000, 'Vieille discussion'),
    'agents:new-2': withAgents('new-2', 71_900_000, 'Discussion récente'),
    'agents:empty-3': { ...emptyRegistry('empty-3', '/p', 71_950_000), title: 'Sans agent' },
    // D'un autre projet : jamais dans ce sélecteur (S17).
    'agents:ailleurs-4': withAgents('ailleurs-4', 71_990_000, 'Autre projet', '/autre'),
  })
  void mem
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-history' })
  const keys = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.key ?? '')).filter(k => k.startsWith('agents-history-'))
  expect(keys).toEqual(['agents-history-now', `agents-history-run:${run.id}`, 'agents-history-session:new-2', 'agents-history-session:old-1'])
  await ui.press({ key: 'agents-history-session:old-1' })
  await clock.advance(300)
  expect(await ui.find({ type: 'Button', text: /Agent de Vieille discussion$/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

// ─── Reprise des parcours existants (Q14) ─────────────────────────────────

const T0 = Date.parse('2026-10-26T15:32:56.000Z')
const iso = (ms: number) => new Date(T0 + ms).toISOString()
const jsonl = (...rows: Record<string, unknown>[]) => rows.map(r => JSON.stringify(r)).join('\n')
const AGENT = jsonl(
  { type: 'user', isSidechain: true, timestamp: iso(0), message: { role: 'user', content: 'brief' } },
  { type: 'api-request', id: 'r1', timestamp: iso(100) },
  { type: 'assistant', isSidechain: true, timestamp: iso(900), message: { id: 'm1', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/p/a.ts' } }], usage: { input_tokens: 1, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  { type: 'user', isSidechain: true, timestamp: iso(1_500), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x', is_error: false }] } },
)
const META = JSON.stringify({ agentType: 'agents:explorer', description: 'Explorer le module', toolUseId: 'call-old', finished: true })

test('Q14 (point d’entrée 2) : les sous-agents relus pendant un parcours lui sont rattachés ; hors de sa période, non', () => {
  const run = { ...newRun('implement', T0 - 1_000, 'Ancien lot'), updatedAt: T0 + 10_000 } as Run
  const lane = laneFromTranscript(AGENT)
  const kept = agentsOfRun([{ agentId: 'a1', lane, meta: {} }, { agentId: 'tard', lane: { ...lane, startedAt: T0 + 3_600_000 }, meta: {} }], run)
  expect(kept.map(a => [a.agentId, a.run])).toEqual([['a1', run.id]])
  // Le fichier à part garde ce qu'il avait (lignes, autres parcours) et ajoute ce parcours.
  const file = withRun({ v: 1, session: 's1', agents: [], runs: ['autre'], rows: [] }, 's1', run, kept, { segments: [{ k: 'think', s: T0, e: T0 + 10 }] })
  expect(file.runs).toEqual(['autre', run.id])
  expect(file.agents.map(a => a.agentId)).toEqual(['a1'])
  // La vue du parcours : ses sous-agents relus, avec leurs chiffres, rattachés à lui.
  const carrier: SessionRegistry = {
    ...emptyRegistry('s1', '', T0),
    agents: [
      { key: 'k1', name: 'De ce parcours', isBackground: true, status: 'done', startedAt: T0, source: 'live', run: run.id },
      { key: 'k2', name: 'D’un autre', isBackground: true, status: 'done', startedAt: T0, source: 'live', run: 'autre' },
    ],
    main: { segments: [{ k: 'think', s: T0, e: T0 + 5 }, { k: 'think', s: T0 + 7_200_000, e: T0 + 7_200_005 }] },
  }
  const view = runRegistry(run, [carrier], null, T0 + 10_000)
  expect(view.agents.map(a => a.name)).toEqual(['De ce parcours'])
  expect(view.main!.segments).toEqual([{ k: 'think', s: T0, e: T0 + 5 }])
})

test('Q14 : au premier affichage de l’onglet, un parcours existant retrouve ses sous-agents depuis les transcripts, une fois seulement', { timeoutMs: 15000 }, async ($, on) => {
  mock.env(on, { CLAUDE_CONFIG_DIR: '/t' })
  const clock = mock.clock(on, { now: T0 + 3_600_000 })
  const run = { ...newRun('implement', T0 - 1_000, 'Ancien lot'), status: 'done', updatedAt: T0 + 10_000, finishedAt: T0 + 10_000, agents: [{ key: 'call-old', name: 'Explorer le module', isBackground: true, status: 'running', startedAt: T0 }] } as Run
  const head: SessionRegistry = { ...emptyRegistry('sess-old', '', T0), transcript: '/t/projects/-p/old.jsonl', agents: [{ key: 'vu', name: 'Vu en direct', isBackground: true, status: 'done', startedAt: T0, finishedAt: T0 + 5, source: 'live', run: run.id }], updatedAt: T0 + 10_000 }
  const mem = world(on, { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] }, 'agents:sess-old': head })
  const files: Record<string, string> = { '/t/projects/-p/old/subagents/agent-a1.jsonl': AGENT, '/t/projects/-p/old/subagents/agent-a1.meta.json': META }
  let listed = 0
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.list', (_$: unknown, e: { path?: string }) => {
    if (e.path !== '/t/projects/-p/old/subagents') throw new Error('ENOENT')
    listed += 1
    return { value: [{ name: 'agent-a1.jsonl', kind: 'file', size: 1, mtimeMs: 1, isLink: false }, { name: 'agent-a1.meta.json', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] } as any
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await clock.advance(500)
  // Le fichier à part de la discussion qui le portait : ses sous-agents relus, rattachés au parcours.
  const file = mem['agents:sess-old:rebuilt'] as { runs: string[]; agents: { agentId: string; run?: string }[] }
  expect(file.runs).toEqual([run.id])
  expect(file.agents.map(a => [a.agentId, a.run])).toEqual([['a1', run.id]])
  expect((mem.agentsRebuiltRuns as { done: string[] }).done).toEqual([run.id])
  // S18 : l'ancienne ligne retrouvée dans le transcript de sa session a quitté le fichier du parcours.
  expect((mem[`agents:run-${run.id}:rebuilt`] as { rows: unknown[] }).rows).toEqual([])
  // Sa vue : ce qui a été vu en direct et ce qui a été repris.
  await ui.press({ key: 'agents-history' })
  await ui.press({ key: `agents-history-run:${run.id}` })
  await clock.advance(300)
  expect(await ui.find({ type: 'Button', text: /Vu en direct$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Explorer le module$/ })).toBeDefined()
  // Une seconde ouverture ne refait rien.
  const before = listed
  await ui.press({ key: 'tab-flow' })
  await ui.press({ key: 'tab-agents' })
  await clock.advance(500)
  expect(listed).toBe(before)
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('S1 : si la copie ne s’écrit pas, le champ reste dans le parcours', async ($, on) => {
  const clock = mock.clock(on, { now: 73_000_000 })
  const run = legacyRun('Ancien lot', 72_000_000, { status: 'done' })
  const mem: Record<string, unknown> = { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] } }
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-hist' }))
  on('session.root', () => ({ value: '/p' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (e.key.endsWith(':rebuilt')) throw new Error('refusé')
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  expect(mem[`agents:run-${run.id}:rebuilt`]).toBeUndefined()
  expect(((mem[BOARD_KEY] as Board).runs[0] as Run).agents?.map(a => a.key)).toEqual(['call-1', 'call-2', 'call-3'])
})
