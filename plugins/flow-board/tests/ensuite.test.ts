import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyReport, emptyBoard, newRun, nextLaunchFor, startLinkedGroups, suggestionsFor, upgradeRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const boardWith = (input: Record<string, unknown>): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}
const report = (board: Board, input: Record<string, unknown>, now: number) => applyReport(board, input, now).board
const runOf = (board: Board) => activeRun(board)!

// Le cas de qwen-image-local : quatre groupes qui pilotent le même service, donc jamais en parallèle.
const SERVICE = ['Service macOS du porteur']
const SHARED = {
  tickets: [
    { id: 'a1', name: 'File' },
    { id: 'b1', name: 'Lots', blockedBy: ['a1'] },
    { id: 'c1', name: 'Prompts' },
  ],
  groups: [
    { id: 'A', name: 'File', tickets: ['a1'], resources: SERVICE },
    { id: 'B', name: 'Lots', tickets: ['b1'], resources: SERVICE },
    { id: 'C', name: 'Prompts', tickets: ['c1'], resources: SERVICE },
  ],
}

test('la suite recommandée suit les groupes : le prochain, l’attente d’une session liée, puis les revues', () => {
  let board = boardWith(SHARED)
  expect(nextLaunchFor(runOf(board))).toEqual({ kind: 'group', group: 'A', isDelegable: true })
  // A part en session liée : C est prêt, mais partage le service avec A ; B attend A.
  board = startLinkedGroups(board, ['A'], 3_000)!.board
  expect(nextLaunchFor(runOf(board))).toEqual({ kind: 'linked', groups: ['A'] })
  // A rendu sans revue : le suivant est prêt, et la revue de A ne se propose pas à sa place.
  board = report(board, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 4_000)
  expect(nextLaunchFor(runOf(board))).toMatchObject({ kind: 'group', isDelegable: true })
  expect([suggestionsFor(runOf(board)).primary, ...suggestionsFor(runOf(board)).others]).not.toContain('final-review')
  // Un ticket en cours ici : rien d'autre ne part.
  board = report(board, { set: [{ id: 'b1', status: 'doing' }] }, 5_000)
  expect(nextLaunchFor(runOf(board))).toEqual({ kind: 'busy', groups: ['B'] })
  // Tout fait : il manque les revues ; ni groupe ni compte rendu.
  board = report(board, { set: [{ id: 'b1', status: 'done' }, { id: 'c1', status: 'done' }] }, 6_000)
  expect(nextLaunchFor(runOf(board))).toEqual({ kind: 'review', groups: ['A', 'B', 'C'] })
  expect(suggestionsFor(runOf(board)).primary).not.toBe('compte-rendu')
  // Toutes relues : la carte revient aux skills, le compte rendu en tête.
  board = report(board, { reviewed: ['A', 'B', 'C'] }, 7_000)
  expect(nextLaunchFor(runOf(board))).toBeNull()
  expect(suggestionsFor(runOf(board)).primary).toBe('compte-rendu')
})

test('des groupes indépendants : la suite recommandée est le lot parallèle', () => {
  const board = boardWith({
    tickets: [{ id: 'x1', name: 'Un', files: ['app'] }, { id: 'y1', name: 'Deux', files: ['worker'] }],
    groups: [{ id: 'X', name: 'App', tickets: ['x1'] }, { id: 'Y', name: 'Worker', tickets: ['y1'] }],
  })
  expect(nextLaunchFor(runOf(board))).toEqual({ kind: 'parallel', groups: ['X', 'Y'] })
})

test('un groupe rendu par sa session liée avant la 0.39.0 retrouve sa trace dans le journal', () => {
  const board = report(boardWith(SHARED), { set: [{ id: 'a1', status: 'done' }, { id: 'c1', status: 'done' }] }, 3_000)
  const run: Run = runOf(board)
  run.log.push(
    { at: 2_500, glyph: '↗', text: 'Groupe A confié à une session liée', tone: 'info' },
    { at: 3_000, glyph: '↩', text: 'Groupe A rendu par sa session liée', tone: 'ok' },
  )
  const repaired = upgradeRun(run)
  expect(repaired.groups!.find(g => g.id === 'A')!.delegated).toEqual({ at: 2_500 })
  // C, fait dans la discussion, garde sa revue ici.
  expect(repaired.groups!.find(g => g.id === 'C')!.delegated).toBeUndefined()
  // Déjà relu : rien à réparer.
  run.groups = run.groups!.map(g => (g.id === 'A' ? { ...g, reviewedAt: 2_800 } : g))
  expect(upgradeRun(run).groups!.find(g => g.id === 'A')!.delegated).toBeUndefined()
})

test('le panneau : « Ensuite » propose le groupe suivant, sans /code-review ni /implement', async ($, on) => {
  mock.clock(on, { now: 99_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, ...SHARED } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }] } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    // A, fait ici, garde sa revue sur sa ligne ; la carte propose B (ou C), par session liée ou ici.
    expect(await ui.find({ key: 'review-group-A' })).toBeDefined()
    expect(await ui.find({ key: 'go-final-review' })).toBeUndefined()
    expect(await ui.find({ key: 'go-implement' })).toBeUndefined()
    expect(await ui.find({ key: 'go-retro' })).toBeDefined()
    expect((await ui.find({ key: 'next-linked-B' }))?.props).toMatchObject({ label: expect.stringMatching(/^↗.Groupe B · session liée$/), variant: 'primary' })
    expect((await ui.find({ key: 'next-group-B' }))?.props).toMatchObject({ label: expect.stringMatching(/^▶.Lancer B ici$/) })
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'next-group-B' })
  await ui.unmount()
  expect(filled.at(-1)).toMatch(/^\/mattpocock-skills:implement /)
})

test('un groupe gardé pour cette discussion se lance d’abord ici ; la session liée vient en second', async ($, on) => {
  mock.clock(on, { now: 99_500_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, ...SHARED, groups: SHARED.groups.map(g => (g.id === 'A' ? { ...g, continuesHere: true } : g)) } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect((await ui.find({ key: 'next-group-A' }))?.props).toMatchObject({ variant: 'primary' })
  expect((await ui.find({ key: 'next-linked-A' }))?.props.variant).toBeUndefined()
  await ui.unmount()
})

test('des revues qui manquent, tickets faits : pas de skill pour suite (ni /implement ni compte rendu)', () => {
  let board = boardWith(SHARED)
  board = report(board, { set: ['a1', 'b1', 'c1'].map(id => ({ id, status: 'done' })) }, 3_000)
  expect(suggestionsFor(runOf(board)).primary).toBeNull()
  expect(nextLaunchFor(runOf(board))).toEqual({ kind: 'review', groups: ['A', 'B', 'C'] })
})
