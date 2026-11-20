import { expect, mock, test } from 'claude-code/testing'
import { memoryDisk } from './disque-memoire.ts'

import { applyReport, emptyBoard, groupPlan, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

/** Une mission de trois groupes d'un ticket, réglés par le test. */
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

/** La réponse de l'outil à l'envoi d'un plan, et la mission qu'il laisse. */
const sendPlan = (groups: { id: string; tickets: string[]; files?: string[]; resources?: string[] }[], blocked: Record<string, string[]> = {}) => {
  const run = newRun('implement', 1_000)
  const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const ids = groups.flatMap(g => g.tickets)
  return applyReport(
    board,
    { tickets: ids.map(id => ({ id, name: `Ticket ${id}`, status: 'todo', blockedBy: blocked[id] ?? [] })), groups: groups.map(g => ({ name: `Groupe ${g.id}`, ...g })) },
    2_000,
  )
}

// Piste « on peut lancer plusieurs groupes en parallèle ? » : un découpage dont tous les groupes
// touchaient un même fichier ne se découvrait qu'au moment de les lancer.
test('à l’envoi des groupes, la réponse nomme la première vague de groupes qui partent ensemble', () => {
  const out = sendPlan([
    { id: 'A', tickets: ['a1'], files: ['hooks/a.ts'] },
    { id: 'B', tickets: ['b1'], files: ['hooks/b.ts'] },
  ])
  expect(out.text).toContain('groups: first wave, groups that can start together: A, B')
  expect(out.text).not.toContain('no group can run with another')
})

test('à l’envoi des groupes, tout en série : la réponse le dit et nomme le fichier que le plus de groupes partagent', () => {
  const out = sendPlan([
    { id: 'A', tickets: ['a1'], files: ['hooks/register.tsx', 'hooks/a.ts'] },
    { id: 'B', tickets: ['b1'], files: ['hooks/register.tsx'] },
    { id: 'C', tickets: ['c1'], files: ['hooks/c.ts', 'hooks/register.tsx'] },
  ])
  expect(out.text).toContain('groups: no group can run with another: every group goes in series; the file or resource the most groups share is "hooks/register.tsx" (3 groups)')
  expect(out.text).not.toContain('first wave')
  // Une ressource compte comme un fichier, par le même recouvrement que le lancement.
  const app = sendPlan([
    { id: 'A', tickets: ['a1'], files: ['a.ts'], resources: ['PowerBI Desktop'] },
    { id: 'B', tickets: ['b1'], files: ['b.ts'], resources: ['powerbi desktop'] },
  ])
  expect(app.text).toContain('the file or resource the most groups share is "PowerBI Desktop" (2 groups)')
  // Des groupes en chaîne sans fichier commun : en série, sans fichier à nommer.
  const chain = sendPlan([{ id: 'A', tickets: ['a1'], files: ['a.ts'] }, { id: 'B', tickets: ['b1'], files: ['b.ts'] }], { b1: ['a1'] })
  expect(chain.text).toContain('groups: no group can run with another: every group goes in series, each waiting for a group before it')
})

test('plan renvoyé, un groupe dans un worker : la réponse ne promet ni lot ni série', () => {
  const first = sendPlan([{ id: 'A', tickets: ['a1'], files: ['a.ts'] }, { id: 'B', tickets: ['b1'], files: ['b.ts'] }])
  const run = first.board.runs[0] as Run
  const sent: Board = { ...first.board, runs: [{ ...run, groups: run.groups!.map(g => (g.id === 'A' ? { ...g, linked: { at: 2_500 } } : g)) }] }
  const again = applyReport(sent, { groups: [{ id: 'A', name: 'Groupe A', tickets: ['a1'], files: ['a.ts'] }, { id: 'B', name: 'Groupe B', tickets: ['b1'], files: ['b.ts'] }] }, 3_000)
  expect(again.text).toContain('groups: no two groups can start together now (a group in a worker or started here, or a blocker, holds the others), but groups of a same wave that share no file can still run side by side')
  expect(again.text).not.toContain('first wave')
  expect(again.text).not.toContain('every group goes in series')
})

test('plan envoyé avec un ticket mis en cours dans le même appel : la vague dite attend ce groupe, commencé ici', () => {
  const run = newRun('implement', 1_000)
  const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const out = applyReport(
    board,
    {
      tickets: ['a1', 'b1', 'c1'].map(id => ({ id, name: `Ticket ${id}`, status: 'todo' })),
      groups: [
        { id: 'A', name: 'Groupe A', tickets: ['a1'], files: ['a.ts'] },
        { id: 'B', name: 'Groupe B', tickets: ['b1'], files: ['b.ts'] },
        { id: 'C', name: 'Groupe C', tickets: ['c1'], files: ['c.ts'] },
      ],
      set: [{ id: 'a1', status: 'doing' }],
    },
    2_000,
  )
  // Le `set` du même appel compte : A est commencé ici, B et C partent une fois A fini.
  expect(out.text).toContain('groups: next wave, groups that can start together once A (started here) is done: B, C')
  expect(out.text).not.toContain('first wave')
})

test('à l’envoi des groupes, un plan d’un seul groupe ou refusé garde sa réponse, et rien de plus n’est enregistré', () => {
  const one = sendPlan([{ id: 'A', tickets: ['a1', 'b1'], files: ['a.ts'] }])
  expect(one.text).toContain('groups: one group only, so no groups')
  expect(one.text).not.toContain('first wave')
  expect(one.text).not.toContain('no group can run with another')
  const refused = sendPlan([{ id: 'A!', tickets: ['a1'] }, { id: 'B', tickets: ['b1'] }])
  expect(refused.text).toContain('plan refused, group ids out of form')
  expect(refused.text).not.toContain('first wave')
  // Le plan gardé est le même avec ou sans la phrase : aucun champ de vague dans les groupes.
  const kept = sendPlan([{ id: 'A', tickets: ['a1'], files: ['a.ts'] }, { id: 'B', tickets: ['b1'], files: ['b.ts'] }])
  for (const g of kept.board.runs[0]!.groups ?? []) expect(Object.keys(g).sort()).toEqual(['files', 'id', 'name', 'tickets'])
})

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

test('le panneau : ⇉ seulement pour le lot, dans des workers', async ($, on) => {
  mock.clock(on, { now: 120_000_000 })
  memoryDisk(on)
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
  expect(await ui.find({ key: 'launch-parallel' })).toBeUndefined()
  expect(String((await ui.find({ key: 'launch-parallel-linked' }))?.props.label)).toMatch(/^⇉.A ∥ C en parallèle · workers$/)
  await ui.press({ key: 'launch-parallel-linked' })
  await ui.unmount()
  const text = filled.at(-1)!
  expect(text).toMatch(/Groupe A \(Worker\) : 1\) a1 — Un — effort calculé : medium ∥ Groupe C \(App\) : 1\) c1 — Trois/)
  expect(text).not.toMatch(/Résumé/)

  // A et C commencés : plus de ⇉, B attend qu'ils soient finis.
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'doing' }, { id: 'c1', status: 'doing' }] } as any)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await after.find({ key: 'launch-parallel-linked' })).toBeUndefined()
  await after.unmount()
})

test('lot retenu par un groupe en cours : le panneau le dit', async ($, on) => {
  mock.clock(on, { now: 121_000_000 })
  memoryDisk(on)
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
    expect(await ui.find({ key: 'launch-parallel-linked' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^⇉.B ∥ C en parallèle une fois A fini$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /« Worker » : Claude lance une session qui fait le groupe/ })).toBeDefined()
    await ui.unmount()
  }
})

test('la consigne de /to-tickets décrit les deux sortes de groupes', async ($, on) => {
  mock.clock(on, { now: 122_000_000 })
  memoryDisk(on)
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text
  expect(note).toMatch(/its worker does them in a row with \/implement/)
  expect(note).toMatch(/a group of one ticket is fine when its context is its own/)
  expect(note).toMatch(/can later run at the same time, one worker per group\./)
  // Un fichier très partagé : relevé avant le regroupement, ses tickets dans le moins de groupes possible.
  expect(note).toContain('Before grouping, list the files the most tickets touch: the tickets that share such a widely shared file go into as few groups as possible')
  expect(note).toContain('the breakdown you show says which groups can run together')
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
