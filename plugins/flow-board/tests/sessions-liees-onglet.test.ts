import { expect, mock, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import { emptyRegistry, startCall } from '../hooks/registry.ts'
import type { Board, SessionRegistry } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const LINKED = '9f3e21aa-1111-2222-3333-444455556666'

/** Le moteur sous le plugin : la session `id`, un stockage en mémoire où le test écrit les fichiers des autres sessions. */
const world = (on: any, id = 's-orch') => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: id }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  return mem
}

const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}

/** Le registre d'une session liée, tel que son fichier le garde : sa piste, un sous-agent au travail. */
const linkedRegistry = (session: string, now: number, patch: Partial<SessionRegistry> = {}): SessionRegistry => {
  const reg = startCall({ ...emptyRegistry(session, '/p', now - 60_000), title: 'Explorer le cache', ...patch }, { key: 'c-1', name: 'Chercheur web', isBackground: true }, now - 50_000)!
  return { ...reg, agents: reg.agents.map(a => ({ ...a, agentId: 'x1' })), main: { segments: [{ k: 'think', s: now - 55_000, e: now - 54_000 }, { k: 'tool', s: now - 54_000, e: now - 40_000, f: 'run', t: 'Bash' }] }, updatedAt: now - 1_000 }
}

test('sans parcours, une session lancée par claude --bg a sa pastille, sa piste dans la frise de l’orchestrateur et sa propre frise à la sélection', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 60_000_000 })
  const mem = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'backgrounded · 9f3e21aa · Explorer le cache\n' } }))
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'claude --bg -n "Explorer le cache" "$(cat /tmp/brief.txt)"' } as any)
  mem[`agents:${LINKED}`] = linkedRegistry(LINKED, 60_000_000)
  await settle(clock, 6)
  // L'orchestrateur garde son lancement dans son propre fichier.
  expect((mem['agents:s-orch'] as SessionRegistry).linked).toEqual([{ id: '9f3e21aa', title: 'Explorer le cache', at: 60_000_000, via: 'bg' }])
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ key: 'agents-session-main' })).toBeDefined()
    expect(await ui.find({ key: 'agents-session-9f3e21aa', text: /Explorer le cache/ })).toBeDefined()
    // Dans la frise de l'orchestrateur, une piste pour la session liée.
    expect(await ui.find({ key: 'lane-linked-9f3e21aa' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Chercheur web$/ })).toBeUndefined()
    // Sélectionnée, sa propre frise : ses sous-agents ; la sélection survit aux rafraîchissements.
    await ui.press({ key: 'agents-session-9f3e21aa' })
    expect(await ui.find({ type: 'Button', text: /Chercheur web$/ })).toBeDefined()
    await settle(clock, 6)
    expect(await ui.find({ type: 'Button', text: /Chercheur web$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /au\stravail/ })).toBeDefined()
    await ui.press({ key: 'agents-session-main' })
    expect(await ui.find({ type: 'Button', text: /Chercheur web$/ })).toBeUndefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})

test('un fichier d’une autre session lu à moitié écrit est ignoré, sans erreur, jusqu’à la relecture suivante', async ($, on) => {
  const clock = mock.clock(on, { now: 61_000_000 })
  const mem = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'backgrounded · 9f3e21aa · Explorer le cache\n' } }))
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'claude --bg -n "Explorer le cache" "go"' } as any)
  mem[`agents:${LINKED}`] = JSON.stringify(linkedRegistry(LINKED, 61_000_000)).slice(0, 120)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  // Lancée mais sans fichier lisible : la pastille est là, sa frise est vide pour l'instant.
  await ui.press({ key: 'agents-session-9f3e21aa' })
  expect(await ui.find({ type: 'Button', text: /Chercheur web$/ })).toBeUndefined()
  // Le fichier devient lisible : la sélection tient (même pastille), sa frise se montre.
  mem[`agents:${LINKED}`] = linkedRegistry(LINKED, 61_000_000)
  await settle(clock, 6)
  expect(await ui.find({ type: 'Button', text: /Chercheur web$/ })).toBeDefined()
  // Relu de nouveau à moitié écrit : la lecture d'avant reste.
  mem[`agents:${LINKED}`] = JSON.stringify(linkedRegistry(LINKED, 61_000_000)).slice(0, 200)
  await settle(clock, 6)
  expect(await ui.find({ type: 'Button', text: /Chercheur web$/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('avec un parcours, la session liée que son fichier déclare a sa pastille, et rendue, elle le dit', async ($, on) => {
  const clock = mock.clock(on, { now: 62_000_000 })
  const mem = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', tickets: [{ id: 'a1', name: 'Synchro' }], groups: [{ id: 'A', name: 'Synchro', tickets: ['a1'] }] } as any)
  await settle(clock, 1)
  const runId = (mem['board:'] as Board).runs.find(r => r.title === 'Boutique')!.id
  mem['agents:sess-fille'] = linkedRegistry('sess-fille', 62_000_000, { title: 'Boutique › Groupe A · Synchro', run: runId, group: 'A' })
  mem[`relay:${runId}`] = { v: 1, run: runId, sessions: { 'sess-fille': { group: 'A', tickets: {}, commits: 0, startedAt: 62_000_000, at: 62_000_500, report: { text: 'fini', at: 62_000_800 } } } }
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ key: 'agents-session-sess-fille', text: /Groupe A · Synchro/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /rendue/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('une session liée enregistre ses sous-agents avec son parcours et son groupe, et son onglet dit de qui elle est la session liée', async ($, on) => {
  const clock = mock.clock(on, { now: 63_000_000 })
  const mem = world(on, 's-fille')
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's-orch' }
  const board: Board = applyReport({ ...emptyBoard('', 'p'), session: 's-orch', deleted: [], runs: [run], activeId: run.id }, { tickets: [{ id: 'b1', name: 'Export' }], groups: [{ id: 'B', name: 'Export', tickets: ['b1'] }] }, 2_000).board
  mem['board:'] = { ...board, activeId: null }
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await start($)
  await $.tool.call({ tool: TOOL, delegate: run.id, group: 'B', main: 'Lot principal [abc123]' } as any)
  await $.tool.call({ tool: 'Agent', description: 'Relecture du ticket', prompt: 'p', run_in_background: true } as any)
  await settle(clock, 2)
  expect(mem['agents:s-fille']).toMatchObject({ run: run.id, group: 'B' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /session\sliée\sde\sLot principal \[abc123\]/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Relecture du ticket$/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})
