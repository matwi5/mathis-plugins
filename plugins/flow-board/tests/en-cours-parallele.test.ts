import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyAsana, applyReport, doingOf, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const LOT = [
  { id: 'a1', name: 'Worker SC' },
  { id: 'a2', name: 'Worker VSC', blockedBy: ['a1'] },
  { id: 'b1', name: 'Écran des fermetures' },
]
const GROUPS = [
  { id: 'A', name: 'Worker', tickets: ['a1', 'a2'], files: ['worker'] },
  { id: 'B', name: 'App', tickets: ['b1'], files: ['app'] },
]

const lot = (): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, { tickets: LOT, groups: GROUPS }, 1_500).board
}

test('chaque ticket en cours garde la discussion qui l’a lancé et son groupe ; fini, il la perd', () => {
  let board = lot()
  board = applyReport(board, { set: [{ id: 'a1', status: 'doing' }] }, 2_000).board
  // Une autre discussion (session « t ») passe b1 en cours sur le même parcours.
  board = applyReport({ ...board, session: 't' }, { set: [{ id: 'b1', status: 'doing' }] }, 2_100).board
  const run = activeRun(board)!
  expect(run.tickets.find(t => t.id === 'a1')!.by).toBe('s')
  expect(run.tickets.find(t => t.id === 'b1')!.by).toBe('t')
  expect(doingOf(run).map(d => [d.ticket.id, d.group?.id])).toEqual([
    ['a1', 'A'],
    ['b1', 'B'],
  ])
  // Fait (ici par Asana) : plus de discussion attachée.
  const done = activeRun(applyAsana(board, [{ task: 'a1', completed: true }], 2_200)!.board)!
  expect(done.tickets.find(t => t.id === 'a1')!.status).toBe('done')
  expect(done.tickets.find(t => t.id === 'a1')!.by).toBeUndefined()
  expect(doingOf(done).map(d => d.ticket.id)).toEqual(['b1'])
})

test('un ticket qui rejoint un ticket déjà en cours ne remet pas ses étapes à zéro', () => {
  let board = lot()
  board = applyReport(board, { set: [{ id: 'a1', status: 'doing' }] }, 2_000).board
  board = applyReport(board, { step: 'checks' }, 2_050).board
  board = applyReport(board, { set: [{ id: 'b1', status: 'doing' }] }, 2_100).board
  const steps = activeRun(board)!.phases[0]!.steps
  expect(steps.find(s => s.id === 'checks')!.status).toBe('active')
  // En séquence (a1 fini, a2 commence), elles repartent bien de la première.
  board = applyReport(board, { set: [{ id: 'b1', status: 'done' }] }, 2_200).board
  board = applyReport(board, { set: [{ id: 'a1', status: 'done' }, { id: 'a2', status: 'doing' }] }, 2_300).board
  expect(activeRun(board)!.phases[0]!.steps[0]!.status).toBe('active')
  expect(activeRun(board)!.phases[0]!.steps.find(s => s.id === 'checks')!.status).toBe('pending')
})

test('les tickets en cours se lisent dans leur groupe ; ni le panneau ni le bandeau ne les répètent à part', async ($, on) => {
  mock.clock(on, { now: 400_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot parallèle', tickets: LOT, groups: GROUPS } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'doing' }, { id: 'b1', status: 'doing' }] } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    // Implémentation : plus de suivi ticket par ticket, les vagues et les groupes suffisent.
    expect(await ui.find({ type: 'Text', text: /tickets en cours en parallèle/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^▸/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Worker SC' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Écran des fermetures' })).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: /^◉\sen cours$/ })).length).toBe(2)
    expect(await ui.find({ type: 'Text', text: /^A\s·\sWorker$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^B\s·\sApp$/ })).toBeDefined()
    await ui.unmount()
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /en\scours/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('un ticket laissé en cours par une autre discussion est marqué comme tel sur sa ligne', async ($, on) => {
  mock.clock(on, { now: 401_000_000 })
  // Le parcours en pause qu'une autre discussion (session-B) a laissé avec un ticket en cours.
  const saved = lot()
  const run0 = activeRun(applyReport({ ...saved, session: 'session-B' }, { set: [{ id: 'a1', status: 'doing' }] }, 2_000).board)!
  const stored: Board = { ...emptyBoard('', 'projet'), deleted: [], runs: [{ ...run0, status: 'paused', owner: undefined, updatedAt: 400_999_000 }], activeId: null }
  mock.store(on, { 'board:': stored })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  // Cette discussion le reprend et passe b1 en cours.
  await $.tool.call({ tool: TOOL, resume: run0.id, set: [{ id: 'b1', status: 'doing' }] } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect((await ui.findAll({ type: 'Text', text: /^⇆\sautre discussion$/ })).length).toBe(1)
  await ui.unmount()
})
