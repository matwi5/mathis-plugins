import { expect, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun, renameRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const boardOf = (runs: Run[], activeId: string | null = null): Board => ({ ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs, activeId })

test('renommer remplace un titre déjà posé, et un titre envoyé ensuite ne l’écrase pas', () => {
  const run = { ...newRun('implement', 1_000, 'crée un parcours de ces tickets. Ne commence pas'), status: 'active' as const, owner: 's' }
  expect(run.isTitled).toBe(true)
  const out = renameRun(boardOf([run], run.id), run.id, '  Tickets de test   et règles  ', 2_000)!
  const renamed = out.board.runs[0]!
  expect(renamed.title).toBe('Tickets de test et règles')
  expect(renamed.isTitled).toBe(true)
  expect(renamed.updatedAt).toBe(2_000)
  expect(out.fx.toasts).toEqual(['✎ Renommé : Tickets de test et règles'])
  // Le titre envoyé plus tard par l'outil reste sans effet.
  const after = applyReport(out.board, { title: 'Autre titre' }, 3_000)
  expect((after?.board ?? out.board).runs[0]!.title).toBe('Tickets de test et règles')
})

test('renommer : titre vide ou parcours inconnu, rien ne bouge ; titre long tronqué à 70', () => {
  const run = { ...newRun('implement', 1_000), status: 'active' as const, owner: 's' }
  const board = boardOf([run], run.id)
  expect(renameRun(board, run.id, '   ', 2_000)).toBeNull()
  expect(renameRun(board, 'inconnu', 'Titre', 2_000)).toBeNull()
  const long = renameRun(board, run.id, 'x'.repeat(100), 2_000)!.board.runs[0]!
  expect(long.title.length).toBe(70)
  expect(long.title.endsWith('…')).toBe(true)
})
