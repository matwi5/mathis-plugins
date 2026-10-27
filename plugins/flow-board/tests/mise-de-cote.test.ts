import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyReport, applySkill, emptyBoard, newRun, resumeRun, setAsideActive } from '../hooks/model.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('command.run', { command: 'flow' }, async (_$: unknown, e: unknown, next: (e: unknown) => unknown) => next(e))
}

const lot = (): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot de la semaine'), owner: 's' }
  const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, { tickets: [{ id: 'T1', name: 'Premier', status: 'done' }, { id: 'T2', name: 'Second', status: 'doing' }], step: 'tdd' }, 1_500).board
}

test('mis de côté : en pause tel quel, sans parcours actif ici ; « Reprendre » le rend dans le même état', () => {
  const board = lot()
  const before = activeRun(board)!
  const out = setAsideActive(board, 2_000)!
  expect(out.board.activeId).toBeNull()
  const aside = out.board.runs[0]!
  expect(aside.status).toBe('paused')
  expect(aside.asideAt).toBe(2_000)
  expect(aside.owner).toBeUndefined()
  expect(out.fx.toasts).toEqual(['‖ Mis de côté : Lot de la semaine'])
  expect(setAsideActive(out.board, 2_100)).toBeNull()

  const back = resumeRun(out.board, aside.id, 3_000)!
  const run = activeRun(back.board)!
  expect(run.id).toBe(before.id)
  expect(run.asideAt).toBeUndefined()
  expect(run.cursor).toBe(before.cursor)
  expect(run.tickets).toEqual(before.tickets)
  expect(run.phases[0]!.steps).toEqual(before.phases[0]!.steps)
})

test('mis de côté même quand tout est fait : il n’est pas clos', () => {
  const run = { ...newRun('grill-me', 1_000, 'Questionnaire'), owner: 's' }
  let board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = applyReport(board, { complete: true }, 1_500).board
  // Une phase unique finie : le parcours est terminé ; on part d'un parcours encore actif dont tout est fait.
  const done = board.runs[0]!
  const active: Board = { ...board, runs: [{ ...done, status: 'active', finishedAt: undefined }], activeId: done.id }
  const out = setAsideActive(active, 2_000)!
  expect(out.board.runs[0]!.status).toBe('paused')
})

test('un skill lancé après la mise de côté ouvre un nouveau parcours au lieu de reprendre l’ancien', () => {
  const aside = setAsideActive(lot(), 2_000)!.board
  const out = applySkill(aside, 'mattpocock-skills:implement', { now: 3_000, isMain: true, args: 'Autre lot' })!
  const run = activeRun(out.board)!
  expect(out.board.runs).toHaveLength(2)
  expect(run.title).toBe('Autre lot')
  expect(run.tickets).toHaveLength(0)
  const old = out.board.runs.find(r => r.id !== run.id)!
  expect(old.status).toBe('paused')
  expect(old.asideAt).toBe(2_000)
  // Sans mise de côté, le même skill reprenait le parcours en pause.
  const paused = { ...lot(), activeId: null }
  paused.runs = paused.runs.map(r => ({ ...r, status: 'paused' as const, owner: undefined }))
  expect(activeRun(applySkill(paused, 'mattpocock-skills:implement', { now: 3_000, isMain: true })!.board)!.id).toBe(paused.runs[0]!.id)
})

test('un rapport de l’outil sans parcours actif n’écrit rien sur le parcours mis de côté, et le dit', () => {
  const aside = setAsideActive(lot(), 2_000)!.board
  const out = applyReport(aside, { set: [{ id: 'T2', status: 'done' }], tickets: [{ id: 'T3', name: 'Nouveau' }] }, 3_000)
  expect(out.board).toBe(aside)
  expect(out.text).toMatch(/"Lot de la semaine" \(set aside by the user, 1\/2 tickets/)
  expect(out.text).toMatch(/send \{"open"/)
  // `resume` le rend explicitement, et le rapport s'y applique.
  const resumed = applyReport(aside, { resume: aside.runs[0]!.id, set: [{ id: 'T2', status: 'done' }] }, 3_100)
  expect(activeRun(resumed.board)!.tickets.every(t => t.status === 'done')).toBe(true)
  expect(activeRun(resumed.board)!.asideAt).toBeUndefined()
})

test('/flow pause et le bouton « ‖ Mettre de côté » ; l’historique le montre mis de côté, à reprendre', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 500_000_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot de la semaine', tickets: [{ id: 'T1', name: 'Premier' }] } as any)

  const answer = await $.command.run({ command: 'flow', args: 'pause' } as any)
  expect(String(answer.text)).toBe('Parcours mis de côté : Lot de la semaine (Historique, « Reprendre », pour le rouvrir tel quel).')
  expect(String((await $.command.run({ command: 'flow', args: 'pause' } as any)).text)).toBe('Aucun parcours en cours.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Le dernier parcours, « .+ », est mis de côté/ })).toBeDefined()
    await ui.press({ key: 'tab-history' })
    expect(await ui.find({ type: 'Text', text: /^‖\smis de côté$/ })).toBeDefined()
    // « Reprendre » le rouvre ici, tel qu'il était.
    await ui.press({ key: (await ui.findAll({ type: 'Button' })).find(b => String(b.key ?? '').startsWith('resume-'))!.key as string })
    await ui.press({ key: 'tab-flow' })
    expect(await ui.find({ type: 'Text', text: /Premier/ })).toBeDefined()
    // Le bouton du panneau le remet de côté.
    await ui.press({ key: 'set-aside' })
    expect(await ui.find({ type: 'Text', text: /Le dernier parcours, « .+ », est mis de côté/ })).toBeDefined()
    await ui.unmount()
  }
})
