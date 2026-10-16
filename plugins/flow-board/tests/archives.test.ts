import { expect, test } from 'claude-code/testing'

import { archiveRun, emptyBoard, mergeBoards, newRun, resumable, resumeRun, unarchiveRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const boardOf = (runs: Run[], activeId: string | null = null): Board => ({ ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs, activeId })

test('archiver : caché de la reprise, jamais élagué, et le parcours en cours ici passe en pause', () => {
  const active = { ...newRun('implement', 1_000), status: 'active' as const, owner: 's' }
  const paused = { ...newRun('tdd', 2_000), status: 'paused' as const }
  let board = boardOf([active, paused], active.id)
  board = archiveRun(board, active.id, 3_000)!.board
  expect(board.activeId).toBeNull()
  const archived = board.runs.find(r => r.id === active.id)!
  expect(archived.archivedAt).toBe(3_000)
  expect(archived.status).toBe('paused')
  expect(resumable(board).map(r => r.id)).toEqual([paused.id])
  // Déjà archivé : rien ne bouge.
  expect(archiveRun(board, active.id, 4_000)).toBeNull()
})

test('désarchiver le remet tel quel ; reprendre un archivé le sort aussi des archives', () => {
  const run = { ...newRun('tdd', 1_000), status: 'done' as const, archivedAt: 2_000 }
  const back = unarchiveRun(boardOf([run]), run.id, 3_000)!.board.runs[0]!
  expect(back.archivedAt).toBeUndefined()
  expect(back.status).toBe('done')
  const resumed = resumeRun(boardOf([{ ...run, status: 'paused' }]), run.id, 4_000)!.board.runs[0]!
  expect(resumed.archivedAt).toBeUndefined()
  expect(resumed.status).toBe('active')
})

test('un parcours touché après sa trace de suppression survit à la fusion, et la trace tombe', () => {
  const run = { ...newRun('tdd', 1_000), status: 'done' as const, updatedAt: 5_000, archivedAt: 5_000 }
  const local = boardOf([run])
  const stale: Board = { ...boardOf([]), deleted: [{ id: run.id, at: 3_000 }] }
  const merged = mergeBoards(local, stale)
  expect(merged.runs.map(r => r.id)).toEqual([run.id])
  expect(merged.deleted).toEqual([])
  // Une copie plus ancienne que la trace, elle, reste effacée.
  const old = mergeBoards(boardOf([{ ...run, updatedAt: 2_000 }]), stale)
  expect(old.runs).toEqual([])
})
