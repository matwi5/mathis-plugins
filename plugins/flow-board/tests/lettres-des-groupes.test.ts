import { expect, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board } from '../types'

// Les lettres des groupes suivent l'ordre d'exécution : A part le premier, un groupe qui en attend un
// autre (un ticket bloqué par un ticket de l'autre groupe, ou par une dépendance hors du lot) porte une
// lettre plus loin. Un plan aux lettres dans le désordre est gardé, et la réponse le dit à Claude.

const boardWith = (input: Record<string, unknown>): Board => {
  const run = { ...newRun('to-tickets', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}
const LINE = 'groups: letters out of execution order'

test('un groupe qui attend un groupe de lettre plus loin : la réponse le dit et demande de renommer', () => {
  const tickets = [
    { id: 'a1', name: 'Script', files: ['a.ts'] },
    { id: 'b1', name: 'Contrôle', blockedBy: ['c1'], files: ['b.ts'] },
    { id: 'c1', name: 'Vérification', files: ['c.ts'] },
  ]
  const out = applyReport(boardWith({ tickets }), { groups: [
    { id: 'A', name: 'Script', tickets: ['a1'] },
    { id: 'B', name: 'Contrôle', tickets: ['b1'] },
    { id: 'C', name: 'Vérification', tickets: ['c1'] },
  ] }, 3_000)
  expect(out.text).toContain(`${LINE}: B waits for C`)
  expect(out.text).toContain('letter the groups in the order they run (A first)')
})

test('un groupe retenu par une dépendance hors du lot passe après les groupes prêts', () => {
  const tickets = [
    { id: 'a1', name: 'Script', files: ['a.ts'] },
    { id: 'b1', name: 'Contrôle', blockedBy: ['x9'], files: ['b.ts'] },
    { id: 'c1', name: 'Vérification', files: ['c.ts'] },
  ]
  const externals = [{ id: 'x9', name: 'Réponse du client', kind: 'decision', status: 'todo' }]
  const out = applyReport(boardWith({ tickets, externals }), { groups: [
    { id: 'A', name: 'Script', tickets: ['a1'] },
    { id: 'B', name: 'Contrôle', tickets: ['b1'] },
    { id: 'C', name: 'Vérification', tickets: ['c1'] },
  ] }, 3_000)
  expect(out.text).toContain(`${LINE}: B waits outside the lot, C is ready`)
})

test('des lettres dans l’ordre d’exécution : rien à dire', () => {
  const tickets = [
    { id: 'a1', name: 'Script', files: ['a.ts'] },
    { id: 'b1', name: 'Vérification', files: ['b.ts'] },
    { id: 'c1', name: 'Contrôle', blockedBy: ['b1'], files: ['c.ts'] },
  ]
  const out = applyReport(boardWith({ tickets }), { groups: [
    { id: 'A', name: 'Script', tickets: ['a1'] },
    { id: 'B', name: 'Vérification', tickets: ['b1'] },
    { id: 'C', name: 'Contrôle', tickets: ['c1'] },
  ] }, 3_000)
  expect(out.text).not.toContain(LINE)
})
