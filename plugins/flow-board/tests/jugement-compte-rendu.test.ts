// Les tickets de jugement dans les faits du compte rendu : les tickets que la mission dit « Jugement : oui »
// (drapeau `judgment` à `true`), traités en xhigh le temps du ticket (sur Fable 5.2 high dans un groupe parti par
// « ↗ Fable »), nommés avec leurs groupes, pour que le
// rapport donne le coût de ces groupes (le mod ne chiffre pas un ticket seul). Rien quand la mission n'en a aucun.

import { expect, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun, reportFacts } from '../hooks/model.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board } from '../types'

/** Une mission découpée, avec les tickets et les groupes donnés. */
const mission = (input: Record<string, unknown>): ReturnType<typeof activeRun> => {
  const run = newRun('implement', 1_000, 'Lot')
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return activeRun(applyReport(board, input, 2_000).board)
}

const GROUPS = [
  { id: 'A', name: 'Mod', tickets: ['a1', 'a2'] },
  { id: 'B', name: 'Textes', tickets: ['b1'] },
]

const line = (facts: string[]): string | undefined => facts.find(l => l.startsWith('- Judgement tickets'))

test('les tickets « Jugement : oui » sont nommés avec leur groupe, et seulement eux', () => {
  const run = mission({
    tickets: [
      { id: 'a1', name: 'Drapeau', judgment: true },
      { id: 'a2', name: 'Effort' },
      { id: 'b1', name: 'Règle', judgment: true },
    ],
    groups: GROUPS,
  })!
  expect(line(reportFacts(run))).toBe(
    '- Judgement tickets (« Jugement : oui »: run in xhigh while in progress, or on Fable 5.2 high when their group was launched by « ↗ Fable »): Drapeau [a1] (group A); Règle [b1] (group B). Name them in the report with the path and the cost of their groups (the cost of a group, never of a ticket alone), as the report instructions say.',
  )
})

test('sans groupes, un ticket de jugement est dit dans le lot', () => {
  const run = mission({ tickets: [{ id: 'x1', name: 'Refonte', judgment: true }, { id: 'x2', name: 'Autre', judgment: false }] })!
  expect(line(reportFacts(run))).toBe(
    '- Judgement tickets (« Jugement : oui »: run in xhigh while in progress, or on Fable 5.2 high when their group was launched by « ↗ Fable »): Refonte [x1] (the lot, no groups). Name them in the report with the path and the cost of their groups (the cost of a group, never of a ticket alone), as the report instructions say.',
  )
})

test('aucune ligne quand la mission n’a aucun ticket de jugement, drapeau absent ou à false', () => {
  const run = mission({ tickets: [{ id: 'a1', name: 'Drapeau', judgment: false }, { id: 'a2', name: 'Effort' }, { id: 'b1', name: 'Règle' }], groups: GROUPS })!
  expect(line(reportFacts(run))).toBeUndefined()
})
