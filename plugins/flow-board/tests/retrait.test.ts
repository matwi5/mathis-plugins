import { expect, mock, test } from 'claude-code/testing'

import { applyReport, clampFuture, detachOnLoad, emptyBoard, mergeBoards, newRun, noActiveText, resumeRun } from '../hooks/model.ts'
import type { Board } from '../types'

const TOOL = 'mcp__flow-board__flow'

/** Un board avec un parcours actif ici : 3 tickets en chaîne, deux groupes, une file. */
const boardWithRun = (): Board => {
  const run = newRun('to-tickets', 1_000, 'Lot SC')
  run.owner = 'session-A'
  run.tickets = [
    { id: 'A1', name: 'Un', status: 'todo' },
    { id: 'B2', name: 'Deux', status: 'todo', blockedBy: ['A1'] },
    { id: 'C3', name: 'Trois', status: 'todo', blockedBy: ['A1', 'B2'] },
  ]
  run.groups = [
    { id: 'A', name: 'Bon', tickets: ['A1', 'C3'] },
    { id: 'X', name: 'Erreur', tickets: ['B2'] },
  ]
  run.queue = ['A1', 'B2']
  return { ...emptyBoard('c:/dev/p', 'p'), session: 'session-A', runs: [run], activeId: run.id, deleted: [] }
}

test('« remove » retire les tickets, et les enlève des groupes, de la file et des dépendances', () => {
  const out = applyReport(boardWithRun(), { remove: ['B2', 'ZZ'] }, 2_000)
  const run = out.board.runs[0]!
  expect(run.tickets.map(t => t.id)).toEqual(['A1', 'C3'])
  expect(run.tickets.find(t => t.id === 'C3')!.blockedBy).toEqual(['A1'])
  expect(run.groups!.map(g => g.id)).toEqual(['A'])
  expect(run.queue).toEqual(['A1'])
  expect(run.log[0]!.text).toMatch(/1 ticket retiré : Deux/)
  expect(out.text).toMatch(/removed 1 ticket\(s\); not on the dashboard: ZZ/)
})

test('le retrait l’emporte à la fusion avec une discussion qui avait encore l’ancien lot', () => {
  const before = boardWithRun()
  const cleaned = applyReport(before, { remove: ['B2'] }, 5_000).board
  // L'autre discussion relit le stockage : la version la plus récente gagne, sans truquer la date.
  const other = { ...before, session: 'session-B', activeId: null }
  const merged = mergeBoards(other, cleaned)
  expect(merged.runs[0]!.tickets.map(t => t.id)).toEqual(['A1', 'C3'])
})

test('« resume » : une session liée reprend le parcours et enregistre dans le même appel ; la discussion principale le reprend ensuite', () => {
  const stored = boardWithRun()
  const runId = stored.runs[0]!.id
  // La session liée (B) charge le projet : le parcours de A y est suivi ailleurs.
  const linked = detachOnLoad(stored, 3_000, 'session-B')
  const out = applyReport(linked, { resume: runId, set: [{ id: 'A1', status: 'doing' }] }, 3_100)
  expect(out.board.activeId).toBe(runId)
  expect(out.board.runs[0]!.owner).toBe('session-B')
  expect(out.board.runs[0]!.tickets.find(t => t.id === 'A1')!.status).toBe('doing')
  expect(out.text).toMatch(/^Workflow "Lot SC" resumed in this discussion\./)
  expect(out.fx.toasts[0]).toMatch(/Reprise : Lot SC/)
  // A relit le stockage : la reprise par B lui retire le parcours…
  const main = mergeBoards(stored, out.board)
  expect(main.activeId).toBeNull()
  // … qu'il reprend à son tour, avec l'avancement de B.
  const back = applyReport(main, { resume: runId }, 4_000)
  expect(back.board.activeId).toBe(runId)
  expect(back.board.runs[0]!.owner).toBe('session-A')
  expect(back.board.runs[0]!.tickets.find(t => t.id === 'A1')!.status).toBe('doing')
  // Déjà actif ici : la reprise ne change rien d'autre que le reste du rapport.
  expect(applyReport(back.board, { resume: runId, note: 'ok' }, 4_100).text).not.toMatch(/resumed/)
  // Id inconnu : rien n'est écrit, et Claude le sait.
  const unknown = applyReport(linked, { resume: 'nope', set: [{ id: 'A1', status: 'done' }] }, 3_200)
  expect(unknown.board).toBe(linked)
  expect(unknown.text).toMatch(/No workflow "nope" in this project: nothing was resumed nor recorded/)
})

test('sans parcours actif ici mais avec un parcours à reprendre, l’outil n’enregistre rien et le dit', () => {
  const stored = boardWithRun()
  // Une nouvelle discussion charge le projet : le parcours de A y apparaît suivi ailleurs.
  const here = detachOnLoad(stored, 3_000, 'session-B')
  expect(here.activeId).toBeNull()
  const out = applyReport(here, { tickets: [{ id: 'Q1', name: 'Autre lot' }] }, 3_100)
  expect(out.board).toBe(here)
  expect(out.text).toMatch(/No workflow is active in this discussion, so nothing was recorded/)
  expect(out.text).toMatch(/"Lot SC" \(in progress in another discussion, 0\/3 tickets/)
  expect(out.text).toMatch(/Reprendre ici/)
  // Sans aucun parcours dans le projet, un lot de tickets ouvre toujours un parcours.
  const empty = { ...emptyBoard('c:/dev/p', 'p'), session: 'session-B', deleted: [] }
  expect(applyReport(empty, { tickets: [{ id: 'Q1', name: 'Autre lot' }] }, 3_200).board.runs).toHaveLength(1)
  expect(noActiveText(empty)).toMatch(/No workflow is running/)
})

test('une date dans le futur ne fait plus échouer les reprises', () => {
  const now = 10_000_000
  const b = boardWithRun()
  const run = b.runs[0]!
  run.log = [{ at: now - 60_000, glyph: '↻', text: 'Parcours repris', tone: 'accent' }]
  run.updatedAt = now + 10 * 60_000
  run.owner = 'manual-cleanup'
  const stored = clampFuture(b, now)
  expect(stored.runs[0]!.updatedAt).toBe(now - 60_000)

  // La discussion B reprend le parcours : sa reprise tient face au stockage relu.
  const here = detachOnLoad(b, now, 'session-B')
  const resumed = resumeRun(here, run.id, now + 1_000)!.board
  const merged = mergeBoards(resumed, clampFuture(b, now + 2_000))
  expect(merged.activeId).toBe(run.id)
  expect(merged.runs[0]!.owner).toBe('session-B')
})

test('/flow-board:flow nomme les parcours à reprendre au lieu de « aucun parcours »', async ($, on) => {
  mock.clock(on, { now: 80_000_000 })
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-B' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('command.run', { command: 'flow-board:flow' }, async (_$: unknown, e: unknown, next: (e: unknown) => unknown) => next(e))
  const stored = boardWithRun()
  mem['board:'] = { ...stored, root: '', runs: [{ ...stored.runs[0]!, status: 'paused', owner: undefined, updatedAt: 79_000_000 }], activeId: null }

  const answer = await $.command.run({ command: 'flow-board:flow', args: '' })
  expect(String(answer.text)).toMatch(/Aucun parcours actif dans cette discussion\. À reprendre .*« Lot SC » \(en pause, 0\/3 tickets\)/)
  const tool = await $.tool.call({ tool: TOOL, tickets: [{ id: 'Q1', name: 'Autre lot' }] } as any)
  expect(JSON.stringify(tool)).toMatch(/nothing was recorded/)
})
