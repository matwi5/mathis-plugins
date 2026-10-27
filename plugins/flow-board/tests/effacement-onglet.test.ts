import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, newRun } from '../hooks/model.ts'
import { emptyRegistry, parseRegistry, startCall } from '../hooks/registry.ts'
import type { Board, Run, SessionRegistry } from '../types'

const PLUGIN = 'flow-board'
const BOARD_KEY = 'board:/p'
const NOW = 80_000_000
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

/** Le moteur sous le plugin, la session `s-del` du projet `/p`, et un stockage en mémoire. */
const world = (on: any, seed: Record<string, unknown>, processRun?: (_$: unknown, e: { argv: string[] }) => unknown, toasts: string[] = []) => {
  const mem: Record<string, unknown> = { ...seed }
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-del' }))
  on('session.root', () => ({ value: '/p' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    // `refuseTraces` : le stockage refuse les traces (disque plein, droits).
    if (mem.refuseTraces === true && e.key.endsWith(':erased')) throw new Error('refusé')
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    delete mem[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('process.run', processRun ?? (() => ({ value: { exitCode: 0, stdout: '', stderr: '' } })))
  on('ui.toast', (_$: unknown, e: unknown) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  return mem
}

const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}

/** Un registre d'une session du projet, ses sous-agents finis, écrit pour la dernière fois à `updatedAt`. */
const reg = (session: string, updatedAt: number, agents: { key: string; name: string; run?: string; status?: 'running' | 'done' }[], patch: Partial<SessionRegistry> = {}): SessionRegistry => {
  let r: SessionRegistry = { ...emptyRegistry(session, '/p', updatedAt - 1_000), ...patch }
  for (const a of agents) r = startCall(r, { key: a.key, name: a.name, isBackground: true, ...(a.run ? { run: a.run } : {}) }, updatedAt - 500)!
  return { ...r, agents: r.agents.map(a => ({ ...a, agentId: `id-${a.key}`, status: agents.find(x => x.key === a.key)?.status ?? 'done' })), updatedAt }
}

const traces = (mem: Record<string, unknown>): string[] =>
  Object.entries(mem)
    .filter(([k]) => k.endsWith(':erased'))
    .map(([, v]) => (v as { id: string }).id)
    .sort()

test('supprimer un parcours efface ses agents, ses sessions liées fermées, son relais et ses fichiers à part ; une session liée ouverte n’est pas touchée', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const run = { ...newRun('implement', NOW - 9_000_000, 'Lot à jeter'), status: 'done', archivedAt: NOW - 8_000_000, agents: [] } as Run
  const old = NOW - 2 * 3_600_000
  const mem = world(on, {
    [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] },
    // Cette discussion a porté le parcours : elle se compacte elle-même.
    'agents:s-del': reg('s-del', NOW - 5_000, [{ key: 'ici-p', name: 'Ici, du parcours', run: run.id }, { key: 'ici-h', name: 'Ici, hors parcours' }]),
    // Un autre orchestrateur, fermé : réécrit sans le parcours (S14).
    'agents:orch-ferme': reg('orch-ferme', old, [{ key: 'o-p', name: 'Orch, du parcours', run: run.id }, { key: 'o-h', name: 'Orch, hors parcours' }]),
    // Ses sessions liées : la fermée part, l'ouverte attend de se compacter elle-même (S6).
    'agents:fille-fermee': reg('fille-fermee', old, [{ key: 'f1', name: 'Fille fermée' }], { run: run.id }),
    'agents:fille-ouverte': reg('fille-ouverte', NOW - 60_000, [{ key: 'f2', name: 'Fille ouverte', status: 'running' }], { run: run.id }),
    [`relay:${run.id}`]: { v: 1, run: run.id, sessions: {} },
    [`agents:run-${run.id}:rebuilt`]: { v: 1, session: `run:${run.id}`, agents: [], rows: [{ key: 'vieux', name: 'Vieille ligne', isBackground: true, status: 'done', startedAt: 1, source: 'live', run: run.id }] },
  })
  const before = JSON.stringify(mem['agents:fille-ouverte'])
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: 'archived-toggle' })
  await ui.press({ key: `drop-${run.id}` })
  await ui.press({ key: `drop-yes-${run.id}` })
  await settle(clock, 2)
  await ui.unmount()
  expect((mem[BOARD_KEY] as Board).runs.find(r => r.id === run.id)).toBeUndefined()
  // Le relais, le fichier du parcours et la session liée fermée sont partis.
  expect(mem[`relay:${run.id}`]).toBeUndefined()
  expect(mem[`agents:run-${run.id}:rebuilt`]).toBeUndefined()
  expect(mem['agents:fille-fermee']).toBeUndefined()
  // L'ouverte n'est pas touchée : la trace du parcours la couvrira à sa prochaine écriture.
  expect(JSON.stringify(mem['agents:fille-ouverte'])).toBe(before)
  expect(parseRegistry(mem['agents:orch-ferme'])!.agents.map(a => a.name)).toEqual(['Orch, hors parcours'])
  expect(parseRegistry(mem['agents:s-del'])!.agents.map(a => a.name)).toEqual(['Ici, hors parcours'])
  // Les traces : le parcours, ses sessions liées, et chaque sous-agent effacé (S5, S22) ; ni nom ni prompt.
  expect(traces(mem)).toEqual(expect.arrayContaining([`run:${run.id}`, 'fille-fermee', 'fille-ouverte', 'call:ici-p', 'agent:id-ici-p', 'call:o-p']))
  for (const [k, v] of Object.entries(mem)) if (k.endsWith(':erased')) expect(Object.keys(v as object).sort()).toEqual(['at', 'id'])
})

test('« ✗ Oublier » une discussion : la confirmation dit ce qu’elle efface, puis sa session et ses sessions liées sûres partent, pas celle reconnue par son titre seul', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const old = NOW - 2 * 3_600_000
  const LINKED = '9f3e21aa-1111-2222-3333-444455556666'
  const mem = world(on, {
    [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [] },
    'agents:vieille': reg('vieille', old, [{ key: 'v1', name: 'Un' }, { key: 'v2', name: 'Deux' }], {
      title: 'Vieille discussion',
      linked: [
        { id: '9f3e21aa', title: 'Explorer le cache', at: old - 900, via: 'bg' },
        { id: 'local_9z', title: 'Pistes de rétro', at: old - 800, via: 'desktop' },
      ],
    }),
    [`agents:${LINKED}`]: reg(LINKED, old, [{ key: 'l1', name: 'Trois' }], { title: 'Explorer le cache' }),
    'agents:par-titre': reg('par-titre', old, [{ key: 't1', name: 'Quatre' }], { title: 'Pistes de rétro' }),
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-history' })
  await ui.press({ key: 'agents-history-session:vieille' })
  await clock.advance(300)
  await ui.press({ key: 'agents-forget' })
  expect(await ui.find({ type: 'Text', text: /2 sessions et 3 sous-agents seront effacés définitivement\. 1 session liée reconnue par le titre seul n’est pas comprise\./ })).toBeDefined()
  await ui.press({ key: 'agents-forget-yes' })
  await settle(clock, 2)
  expect(mem['agents:vieille']).toBeUndefined()
  expect(mem[`agents:${LINKED}`]).toBeUndefined()
  expect(parseRegistry(mem['agents:par-titre'])!.agents.map(a => a.name)).toEqual(['Quatre'])
  expect(traces(mem)).toEqual(expect.arrayContaining(['vieille', LINKED]))
  // Le sélecteur ne la liste plus, et l'onglet revient « ici ».
  await ui.press({ key: 'agents-history' })
  expect(await ui.find({ key: 'agents-history-session:vieille' })).toBeUndefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('S5 : après l’effacement, le rattrapage par transcripts ne fait rien revenir ; ce qui arrive ensuite est suivi normalement', async ($, on) => {
  mock.env(on, { CLAUDE_CONFIG_DIR: '/t' })
  const clock = mock.clock(on, { now: NOW })
  const run = { ...newRun('implement', NOW - 9_000_000, 'Lot à jeter'), status: 'done', archivedAt: NOW - 8_000_000, agents: [] } as Run
  const mem = world(on, {
    [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] },
    'agents:s-del': reg('s-del', NOW - 5_000, [{ key: 'ici-p', name: 'Ici, du parcours', run: run.id }], { transcript: '/t/projects/-p/s-del.jsonl' }),
  })
  // Le transcript du sous-agent effacé reste (hors périmètre) : le rattrapage le relit à l'ouverture de l'onglet.
  const T0 = NOW - 6_000
  const agent = [
    { type: 'api-request', id: 'r', timestamp: new Date(T0).toISOString() },
    { type: 'assistant', isSidechain: true, timestamp: new Date(T0 + 500).toISOString(), message: { id: 'm', model: 'claude-haiku-5-5', content: [{ type: 'text', text: '' }], usage: { input_tokens: 1, output_tokens: 1 } } },
  ]
    .map(r => JSON.stringify(r))
    .join('\n')
  const files: Record<string, string> = { '/t/projects/-p/s-del/subagents/agent-id-ici-p.jsonl': agent, '/t/projects/-p/s-del/subagents/agent-id-ici-p.meta.json': JSON.stringify({ description: 'Ici, du parcours', toolUseId: 'ici-p', finished: true }) }
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.list', (_$: unknown, e: { path?: string }) => {
    if (e.path !== '/t/projects/-p/s-del/subagents') throw new Error('ENOENT')
    return { value: Object.keys(files).map(p => ({ name: p.split('/').pop(), kind: 'file', size: 1, mtimeMs: 1, isLink: false })) } as any
  })
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'neuf' } }))
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: 'archived-toggle' })
  await ui.press({ key: `drop-${run.id}` })
  await ui.press({ key: `drop-yes-${run.id}` })
  await settle(clock, 2)
  await ui.press({ key: 'tab-agents' })
  await settle(clock, 2)
  expect(await ui.find({ type: 'Button', text: /Ici, du parcours$/ })).toBeUndefined()
  // Un nouveau sous-agent, lancé après : suivi normalement.
  await $.tool.call({ tool: 'Agent', description: 'Après l’effacement', prompt: 'p', run_in_background: true } as any)
  await settle(clock, 2)
  expect(await ui.find({ type: 'Button', text: /Après l’effacement$/ })).toBeDefined()
  expect(parseRegistry(mem['agents:s-del'])!.agents.map(a => a.name)).toEqual(['Après l’effacement'])
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('S4 par le mod (disque et commande simulés) : le fichier d’une discussion fermée est réécrit vide puis supprimé par rm ; si rm échoue, le fichier vide reste', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const steps: string[] = []
  let isRmOk = false
  const mem = world(on, { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [] } }, (_$: unknown, e: { argv: string[] }) => {
    if (e.argv[0] === 'rm') {
      steps.push(`rm ${String(e.argv.at(-1)).split('/').pop()}`)
      if (isRmOk) delete files[String(e.argv.at(-1))]
      return { value: { exitCode: isRmOk ? 0 : 1, stdout: '', stderr: isRmOk ? '' : 'refusé' } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (e.text === '') steps.push(`vide ${e.path.split('/').pop()}`)
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('fs.list', (_$: unknown, e: { path?: string }) => {
    const dir = `${String(e.path ?? '').replace(/\/$/, '')}/`
    const names = Object.keys(files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    if (names.length === 0) throw new Error(`ENOENT ${e.path}`)
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file', size: files[p]!.length, mtimeMs: NOW - 3_600_000, isLink: false })) } as any
  })
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  // Un premier lancement écrit le registre de cette session : il dit où est le dossier du registre.
  await $.tool.call({ tool: 'Agent', description: 'Ici', prompt: 'p', run_in_background: true } as any)
  await settle(clock, 2)
  const own = Object.keys(files).find(p => p.endsWith('/flow-board/agents/s-del.json'))
  // Le dossier du mod ne dit pas toujours où est ~/.claude (clone hors de ~/.claude) : rien sur le disque alors.
  if (own === undefined) return
  const dir = own.replace(/\/s-del\.json$/, '')
  const old = NOW - 2 * 3_600_000
  for (const [id, title] of [['vieille-a', 'Discussion A'], ['vieille-b', 'Discussion B']] as const) files[`${dir}/${id}.json`] = JSON.stringify(reg(id, old, [{ key: `${id}-k`, name: title }], { title }))
  await settle(clock, 6)
  const forget = async (id: string) => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
    await ui.press({ key: 'tab-agents' })
    await ui.press({ key: 'agents-history' })
    await ui.press({ key: `agents-history-session:${id}` })
    await clock.advance(300)
    await ui.press({ key: 'agents-forget' })
    await ui.press({ key: 'agents-forget-yes' })
    await settle(clock, 2)
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
  isRmOk = true
  await forget('vieille-a')
  expect(steps.filter(x => x.includes('vieille-a.json'))).toEqual(['vide vieille-a.json', 'rm vieille-a.json'])
  expect(`${dir}/vieille-a.json` in files).toBe(false)
  isRmOk = false
  await forget('vieille-b')
  expect(steps.filter(x => x.includes('vieille-b.json'))).toEqual(['vide vieille-b.json', 'rm vieille-b.json'])
  expect(files[`${dir}/vieille-b.json`]).toBe('')
  // Les traces sont sur le disque, à côté du registre, un fichier par couple (id, date) : l'id et la date.
  const trace = Object.keys(files).find(p => /\/vieille-b\.\d+\.erased\.json$/.test(p))
  expect(JSON.parse(files[trace!]!)).toEqual({ id: 'vieille-b', at: expect.any(Number) })
  void mem
})

test('S24 : si les traces ne s’écrivent pas, rien n’est effacé et le parcours reste', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const run = { ...newRun('implement', NOW - 9_000_000, 'Lot gardé'), status: 'done', archivedAt: NOW - 8_000_000, agents: [] } as Run
  const toasts: string[] = []
  const mem = world(
    on,
    {
      [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] },
      'agents:s-del': reg('s-del', NOW - 5_000, [{ key: 'ici-p', name: 'Ici, du parcours', run: run.id }]),
      [`relay:${run.id}`]: { v: 1, run: run.id, sessions: {} },
      refuseTraces: true,
    },
    undefined,
    toasts,
  )
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: 'archived-toggle' })
  await ui.press({ key: `drop-${run.id}` })
  await ui.press({ key: `drop-yes-${run.id}` })
  await settle(clock, 2)
  await ui.unmount()
  expect((mem[BOARD_KEY] as Board).runs.some(r => r.id === run.id)).toBe(true)
  expect(mem[`relay:${run.id}`]).toBeDefined()
  expect(parseRegistry(mem['agents:s-del'])!.agents.map(a => a.name)).toEqual(['Ici, du parcours'])
  expect(toasts.some(t => /rien n’a été effacé/.test(t))).toBe(true)
})

test('S25 et S26 : les lancements des sessions liées partent avec le parcours ; une session liée ouverte à l’effacement l’est plus tard, une fois fermée', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const run = { ...newRun('implement', NOW - 9_000_000, 'Lot à jeter'), status: 'done', archivedAt: NOW - 8_000_000, agents: [] } as Run
  const LINKED = '9f3e21aa-1111-2222-3333-444455556666'
  const mem = world(on, {
    [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] },
    'agents:s-del': reg('s-del', NOW - 5_000, [{ key: 'ici-p', name: 'Ici, du parcours', run: run.id }], { linked: [{ id: '9f3e21aa', title: 'Lot › Groupe A · Synchro', at: NOW - 8_900_000, via: 'bg' }] }),
    [`agents:${LINKED}`]: reg(LINKED, NOW - 60_000, [{ key: 'f1', name: 'Fille ouverte' }], { run: run.id, group: 'A' }),
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: 'archived-toggle' })
  await ui.press({ key: `drop-${run.id}` })
  await ui.press({ key: `drop-yes-${run.id}` })
  await settle(clock, 2)
  // Le lancement de la session liée du parcours est parti avec lui (S25).
  expect(parseRegistry(mem['agents:s-del'])!.linked).toBeUndefined()
  // Ouverte à l'effacement : pas touchée.
  expect(mem[`agents:${LINKED}`]).toBeDefined()
  // 31 minutes plus tard, l'onglet Agents ouvert : fermée, elle s'efface (S26).
  await ui.press({ key: 'tab-agents' })
  await clock.advance(31 * 60_000)
  await settle(clock, 6)
  expect(mem[`agents:${LINKED}`]).toBeUndefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('S23 : une session liée qui voit la trace de son parcours le lâche : son relais ne revient pas, ses sous-agents ne sont plus rattachés à lui', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const run = { ...newRun('implement', NOW - 9_000_000, 'Lot effacé'), owner: 's-orch', agents: [] } as Run
  const mem = world(on, { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), session: 's-orch', runs: [run], activeId: null } })
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a9' } }))
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await $.tool.call({ tool: 'mcp__flow-board__flow', delegate: run.id, group: 'B' } as any)
  // Le parcours est supprimé ailleurs : sa trace arrive, son relais est effacé.
  mem[`agents:run-${run.id}:erased`] = { id: `run:${run.id}`, at: NOW + 1_000 }
  delete mem[`relay:${run.id}`]
  await clock.advance(2_000)
  await settle(clock, 6)
  await $.tool.call({ tool: 'mcp__flow-board__flow', note: 'encore là' } as any)
  await $.tool.call({ tool: 'Agent', description: 'Après la suppression', prompt: 'p', run_in_background: true } as any)
  await settle(clock, 2)
  expect(mem[`relay:${run.id}`]).toBeUndefined()
  const after = parseRegistry(mem['agents:s-del'])!
  expect(after.agents.map(a => [a.name, a.run])).toEqual([['Après la suppression', undefined]])
  expect(after.run).toBeUndefined()
})

test('S23 : l’en-tête d’une session liée, écrit avec son parcours, le perd une fois la trace du parcours vue', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const run = { ...newRun('implement', NOW - 9_000_000, 'Lot effacé'), owner: 's-orch', agents: [] } as Run
  const mem = world(on, { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), session: 's-orch', runs: [run], activeId: null } })
  let n = 0
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: `a${++n}` } }))
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await $.tool.call({ tool: 'mcp__flow-board__flow', delegate: run.id, group: 'B' } as any)
  await $.tool.call({ tool: 'Agent', description: 'Avant la suppression', prompt: 'p', run_in_background: true } as any)
  await settle(clock, 2)
  expect(parseRegistry(mem['agents:s-del'])).toMatchObject({ run: run.id, group: 'B' })
  mem[`agents:run-${run.id}:erased`] = { id: `run:${run.id}`, at: NOW + 3_000 }
  await clock.advance(2_000)
  await $.tool.call({ tool: 'Agent', description: 'Après la suppression', prompt: 'p', run_in_background: true } as any)
  await settle(clock, 2)
  const after = parseRegistry(mem['agents:s-del'])!
  expect(after.run).toBeUndefined()
  expect(after.group).toBeUndefined()
  expect(after.agents.map(a => a.name)).toEqual(['Après la suppression'])
})
