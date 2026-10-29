import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyReport, emptyBoard, groupPlan, newRun, startLinkedGroups } from '../hooks/model.ts'
import type { Board } from '../types'

// Un lot qui n'aurait qu'un groupe n'en a pas (spec « Groupes et vagues », série 1 Q11, série 2 Q5).

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const boardWith = (input: Record<string, unknown>): Board => {
  const run = { ...newRun('to-tickets', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}
const groupsOf = (board: Board) => activeRun(board)!.groups ?? []

const TICKETS = [
  { id: 'a1', name: 'Un' },
  { id: 'a2', name: 'Deux', blockedBy: ['a1'] },
  { id: 'b1', name: 'Trois' },
]
const ONE_LINE = 'groups: one group only, so no groups'

test('un plan d’un seul groupe est ignoré, et Claude le sait', () => {
  const out = applyReport(boardWith({ tickets: TICKETS }), { groups: [{ id: 'A', name: 'Tout', tickets: ['a1', 'a2', 'b1'] }] }, 3_000)
  expect(groupsOf(out.board)).toEqual([])
  expect(groupPlan(activeRun(out.board)!)).toBeNull()
  expect(out.text).toContain(ONE_LINE)
})

test('un groupe déclaré plus des tickets restés sans groupe compte aussi pour un seul', () => {
  const out = applyReport(boardWith({ tickets: TICKETS }), { groups: [{ id: 'A', name: 'Moitié', tickets: ['a1', 'a2'] }] }, 3_000)
  expect(groupsOf(out.board)).toEqual([])
  expect(out.text).toContain(ONE_LINE)
  // Un ticket inconnu ne fait pas un groupe de plus ; la réponse dit pourquoi le plan tombe.
  const unknown = applyReport(boardWith({ tickets: TICKETS }), { groups: [{ id: 'A', name: 'Un', tickets: ['a1'] }, { id: 'Z', name: 'Fantôme', tickets: ['z9'] }] }, 3_000)
  expect(groupsOf(unknown.board)).toEqual([])
  expect(unknown.text).toContain('groups: plan ignored, 1 group(s) left once the unknown ticket ids are removed (z9)')
})

test('des ids inconnus qui font tomber le compte : la réponse en donne la cause, pas « one group only »', () => {
  const out = applyReport(boardWith({ tickets: TICKETS }), { groups: [{ id: 'X', name: 'Un', tickets: ['x1'] }, { id: 'Y', name: 'Deux', tickets: ['y1'] }] }, 3_000)
  expect(groupsOf(out.board)).toEqual([])
  expect(out.text).toContain('groups: plan ignored, 0 group(s) left once the unknown ticket ids are removed (x1, y1); send those tickets first, then the groups again')
  expect(out.text).not.toContain(ONE_LINE)
  expect(out.text).not.toContain('done in this discussion')
})

test('un ticket ajouté avec un plan ignoré rejoint quand même le groupe en cours', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  let board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = applyReport(board, { tickets: TICKETS, groups: [{ id: 'A', name: 'Un', tickets: ['a1', 'a2'] }, { id: 'B', name: 'Deux', tickets: ['b1'] }] }, 2_000).board
  board = applyReport(board, { set: [{ id: 'a1', status: 'doing' }] }, 2_500).board
  const out = applyReport(board, { tickets: [{ id: 'a3', name: 'Trouvé' }], groups: [{ id: 'A', name: 'Un', tickets: ['a1', 'a2', 'a3'] }] }, 3_000)
  expect(out.text).toContain(ONE_LINE)
  expect(groupsOf(out.board).find(g => g.id === 'A')!.tickets).toEqual(['a1', 'a2', 'a3'])
  expect(groupsOf(out.board).find(g => g.id === 'B')!.tickets).toEqual(['b1'])
})

test('deux groupes déclarés sont gardés, sans la ligne', () => {
  const out = applyReport(boardWith({ tickets: TICKETS }), { groups: [{ id: 'A', name: 'Un', tickets: ['a1', 'a2'] }, { id: 'B', name: 'Deux', tickets: ['b1'] }] }, 3_000)
  expect(groupsOf(out.board).map(g => g.id)).toEqual(['A', 'B'])
  expect(out.text).not.toContain(ONE_LINE)
})

test('un plan en place dont un groupe est lancé n’est ni remplacé ni vidé par un plan d’un seul groupe', () => {
  let board = boardWith({ tickets: TICKETS, groups: [{ id: 'A', name: 'Un', tickets: ['a1', 'a2'] }, { id: 'B', name: 'Deux', tickets: ['b1'] }] })
  board = startLinkedGroups(board, ['A'], 2_500)!.board
  const out = applyReport(board, { groups: [{ id: 'T', name: 'Tout', tickets: ['a1', 'a2', 'b1'] }] }, 3_000)
  expect(groupsOf(out.board).map(g => g.id)).toEqual(['A', 'B'])
  expect(groupsOf(out.board).find(g => g.id === 'A')!.linked).toEqual({ at: 2_500 })
  expect(out.text).toContain(ONE_LINE)
})

test('la consigne de /to-tickets : pas de groupes quand il n’y en aurait qu’un', async ($, on) => {
  mock.clock(on, { now: 80_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text
  expect(note).toContain('Send no groups when there would be only one')
})

test('« ▶ Tout implémenter ici » lance /implement sur les tickets ouverts, dans l’ordre du lot', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 81_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  const answer = await $.tool.call({ tool: TOOL, title: 'Lot', tickets: TICKETS, groups: [{ id: 'A', name: 'Tout', tickets: ['b1', 'a1', 'a2'] }] } as any)
  expect(JSON.stringify(answer)).toContain(ONE_LINE)
  // Pendant le découpage, les groupes peuvent encore venir : pas de lancement du lot entier.
  const cutting = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await cutting.find({ key: 'launch-all' })).toBeUndefined()
  await cutting.unmount()
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }] } as any)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(String((await ui.find({ key: 'launch-all' }))?.props.label)).toMatch(/^▶.Tout implémenter ici$/)
    expect(await ui.find({ key: 'launch-linked-A' })).toBeUndefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'launch-all' })
  await ui.unmount()
  expect(filled.at(-1)).toBe('/mattpocock-skills:implement Tickets à traiter, un par un et dans cet ordre : 1) a2 — Deux ; 2) b1 — Trois')
  // Tout fait : plus de bouton.
  await $.tool.call({ tool: TOOL, set: [{ id: 'a2', status: 'done' }, { id: 'b1', status: 'done' }] } as any)
  const done = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await done.find({ key: 'launch-all' })).toBeUndefined()
  await done.unmount()
})

test('un lot à groupes n’a pas « Tout implémenter ici »', async ($, on) => {
  mock.clock(on, { now: 82_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot', tickets: TICKETS, groups: [{ id: 'A', name: 'Un', tickets: ['a1', 'a2'] }, { id: 'B', name: 'Deux', tickets: ['b1'] }] } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'launch-all' })).toBeUndefined()
  await ui.unmount()
})
