import { expect, mock, test } from 'claude-code/testing'

import { applyReport, emptyBoard, groupPlan, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

/** Un parcours de trois groupes d'un ticket, réglés par le test. */
const plan3 = (opts: { files: [string, string, string]; blocked?: boolean; statuses?: [string, string, string] }) => {
  const run = newRun('implement', 1_000)
  const st = opts.statuses ?? ['todo', 'todo', 'todo']
  const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const out = applyReport(
    board,
    {
      tickets: [
        { id: 'a1', name: 'Un', status: st[0] },
        { id: 'b1', name: 'Deux', status: st[1], blockedBy: opts.blocked ? ['a1'] : [] },
        { id: 'c1', name: 'Trois', status: st[2], blockedBy: opts.blocked ? ['a1'] : [] },
      ],
      groups: [
        { id: 'A', name: 'Worker', tickets: ['a1'], files: [opts.files[0]] },
        { id: 'B', name: 'App', tickets: ['b1'], files: [opts.files[1]] },
        { id: 'C', name: 'Données', tickets: ['c1'], files: [opts.files[2]] },
      ],
    },
    2_000,
  )
  return groupPlan(out.board.runs[0] as Run)!
}

test('deux groupes qui partagent un fichier ne partent pas ensemble : le lot garde A et C', () => {
  const plan = plan3({ files: ['worker', 'worker/sc.py', 'data'] })
  expect(plan.parallelBatch).toEqual(['A', 'C'])
  expect(plan.groups.find(g => g.group.id === 'B')!.parallelWith).toEqual([])
  expect(plan.groups.find(g => g.group.id === 'A')!.parallelWith).toEqual(['C'])
})

test('un groupe en cours retient le lot, sans rien lancer', () => {
  const plan = plan3({ files: ['worker', 'app', 'data'], statuses: ['doing', 'todo', 'todo'] })
  expect(plan.parallelBatch).toEqual([])
  expect(plan.heldBatch).toEqual(['B', 'C'])
  expect(plan.busy).toEqual(['A'])
  // Un groupe dont un ticket est fait, mais pas tous, est aussi en cours.
  const half = plan3({ files: ['worker', 'app', 'data'], statuses: ['done', 'todo', 'todo'] })
  expect(half.parallelBatch).toEqual(['B', 'C'])
})

test('une dépendance levée ne compte plus : B et C deviennent parallélisables une fois A fini', () => {
  const before = plan3({ files: ['worker', 'app', 'data'], blocked: true })
  expect(before.parallelBatch).toEqual([])
  const after = plan3({ files: ['worker', 'app', 'data'], blocked: true, statuses: ['done', 'todo', 'todo'] })
  expect(after.parallelBatch).toEqual(['B', 'C'])
})

test('le panneau : ⇉ seulement pour le lot, et la raison quand un groupe est en cours', async ($, on) => {
  mock.clock(on, { now: 120_000_000 })
  mock.store(on)
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: 'a1', name: 'Un' },
      { id: 'b1', name: 'Deux' },
      { id: 'c1', name: 'Trois' },
    ],
    groups: [
      { id: 'A', name: 'Worker', tickets: ['a1'], files: ['worker'] },
      { id: 'B', name: 'Résumé', tickets: ['b1'], files: ['worker/summary.py'] },
      { id: 'C', name: 'App', tickets: ['c1'], files: ['app'] },
    ],
  } as any)

  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(String((await ui.find({ key: 'launch-parallel' }))?.props.label)).toMatch(/^⇉.A ∥ C en parallèle · \/implement-spec$/)
  await ui.press({ key: 'launch-parallel' })
  await ui.unmount()
  const text = filled.at(-1)!
  expect(text).toMatch(/A \(Worker\) : 1\) a1 — Un ∥ C \(App\) : 1\) c1 — Trois/)
  expect(text).not.toMatch(/Résumé/)
  // La file ne contient que le lot.
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:implement-spec', text: 'y' })).text
  expect(note).toMatch(/Ticket queue chosen by the user, in order: 1\) Un \[a1\]; 2\) Trois \[c1\]\./)

  // A et C commencés : plus de ⇉, B attend qu'ils soient finis.
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'doing' }, { id: 'c1', status: 'doing' }] } as any)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await after.find({ key: 'launch-parallel' })).toBeUndefined()
  await after.unmount()
})

test('lot retenu par un groupe en cours : le panneau le dit', async ($, on) => {
  mock.clock(on, { now: 121_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: 'a1', name: 'Un', status: 'doing' },
      { id: 'b1', name: 'Deux' },
      { id: 'c1', name: 'Trois' },
    ],
    groups: [
      { id: 'A', name: 'Worker', tickets: ['a1'], files: ['worker'] },
      { id: 'B', name: 'App', tickets: ['b1'], files: ['app'] },
      { id: 'C', name: 'Données', tickets: ['c1'], files: ['data'] },
    ],
  } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ key: 'launch-parallel' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^⇉.B ∥ C en parallèle une fois A fini$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /« Session liée » : Claude lance une session qui fait le groupe/ })).toBeDefined()
    await ui.unmount()
  }
})

test('la consigne de /to-tickets décrit les deux sortes de groupes', async ($, on) => {
  mock.clock(on, { now: 122_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text
  expect(note).toMatch(/one discussion does them in a row with \/implement/)
  expect(note).toMatch(/a group of one ticket is fine when its context is its own/)
  expect(note).toMatch(/one linked session per group \(or \/implement-spec, one subagent per group, in a git repository only\)/)
  // Ressources exclusives et fichiers par ticket.
  expect(note).toMatch(/"resources": what a group cannot share with another group working at the same time/)
  expect(note).toMatch(/"PowerBI Desktop"/)
  expect(note).toMatch(/Give each ticket the repo paths it touches, read from its acceptance criteria/)
})

/** Le cas polepredict : deux tickets ajoutés en cours de route retiennent le dernier ticket de A. */
const looseRun = () => {
  const run = newRun('implement', 1_000)
  const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const out = applyReport(
    board,
    {
      tickets: [
        { id: 'a1', name: 'Règle', status: 'done' },
        { id: 'a4', name: 'Recalcul', status: 'blocked', blockedBy: ['x2'] },
        { id: 'b1', name: 'App', status: 'todo' },
        { id: 'c1', name: 'Données', status: 'todo' },
        { id: 'x1', name: 'Rattrapage', status: 'done' },
        { id: 'x2', name: 'Recalage', status: 'blocked', why: 'ton accord', blockedBy: ['x1'] },
        { id: 'y1', name: 'Entre deux', status: 'todo', blockedBy: [] },
      ],
      groups: [
        { id: 'A', name: 'Worker', tickets: ['a1', 'a4'], files: ['worker'] },
        { id: 'B', name: 'App', tickets: ['b1'], files: ['app'] },
        { id: 'C', name: 'Données', tickets: ['c1'], files: ['data'] },
      ],
    },
    2_000,
  )
  return out.board.runs[0] as Run
}

test('un ticket ajouté sans groupe rejoint la chaîne qu’il retient, avant le ticket retenu', () => {
  const plan = groupPlan(looseRun())!
  const a = plan.groups.find(g => g.group.id === 'A')!
  expect(a.group.tickets).toEqual(['a1', 'x1', 'x2', 'a4'])
  // A n'attend plus « Autres » : il est prêt, dans la première vague.
  expect(a.state).toBe('ready')
  expect(a.wave).toBe(0)
  // Un ticket qui ne tient à aucun groupe reste dans « Autres ».
  expect(plan.groups.find(g => g.isFallback)?.group.tickets).toEqual(['y1'])
})

test('un ticket qui retient deux groupes reste dans « Autres » ; un ticket fait rattaché ne rend pas un groupe commencé', () => {
  const run = looseRun()
  run.tickets.push({ id: 'z1', name: 'Commun', status: 'todo' })
  run.tickets = run.tickets.map(t => (t.id === 'b1' || t.id === 'c1' ? { ...t, blockedBy: ['z1'] } : t))
  run.tickets.push({ id: 'w1', name: 'Fait avant B', status: 'done' })
  run.tickets = run.tickets.map(t => (t.id === 'b1' ? { ...t, blockedBy: ['z1', 'w1'] } : t))
  const plan = groupPlan(run)!
  expect(plan.groups.find(g => g.isFallback)?.group.tickets).toEqual(['y1', 'z1'])
  const b = plan.groups.find(g => g.group.id === 'B')!
  expect(b.group.tickets).toEqual(['w1', 'b1'])
  expect(b.isFresh).toBe(true)
})
