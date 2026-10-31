import { expect, test } from 'claude-code/testing'

import { activeRun, applyReport, applySkill, emptyBoard, groupTicketsOf, isPhaseOptional, needsReview, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// Les revues et les phases jugées par une seule règle : la date de revue d'un groupe ou d'un lot
// relue partout par la même forme, l'Implémentation qui redevient facultative quand son lot est
// retiré, et les tickets d'un groupe calculés une fois par état du lot.

const T0 = 90_000_000

const lotBoard = (tickets: object[], groups?: object[]): Board => {
  const run = { ...newRun('implement', T0, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, { tickets, ...(groups ? { groups } : {}) }, T0 + 1).board
}

test('un lot sans groupes dont la date de revue est hors forme attend encore sa revue', () => {
  const run = activeRun(lotBoard([{ id: 'a1', name: 'Un', status: 'done' }]))!
  expect(needsReview(run)).toBe(true)
  for (const reviewedAt of ['hier', -5, 1e300, null]) expect(needsReview({ ...run, reviewedAt } as unknown as Run)).toBe(true)
  expect(needsReview({ ...run, reviewedAt: T0 + 2 })).toBe(false)
})

test('un avis de sécurité sans groupe ne va pas au groupe dont la date de revue est hors forme', () => {
  const board = lotBoard(
    [
      { id: 'a1', name: 'Un', status: 'done' },
      { id: 'b1', name: 'Deux', status: 'done' },
    ],
    [
      { id: 'A', name: 'Alpha', tickets: ['a1'] },
      { id: 'B', name: 'Bêta', tickets: ['b1'] },
    ],
  )
  const run = activeRun(board)!
  // A porte une date que Date ne sait pas écrire : il n'est pas « le dernier relu ».
  run.groups = run.groups!.map(g => (g.id === 'A' ? { ...g, reviewedAt: 1e300 } : { ...g, reviewedAt: T0 + 5 }))
  const after = activeRun(applyReport(board, { security: { advised: true, why: 'chemins relus' } }, T0 + 10).board)!
  expect(after.groups!.find(g => g.id === 'B')!.security?.isAdvised).toBe(true)
  expect(after.groups!.find(g => g.id === 'A')!.security).toBeUndefined()
})

/** Une rétro dont la Rétro a fini avec un lot : son Implémentation est due. */
const retroWithLot = (): Board => {
  const lot = { ...newRun('implement', 1_000, 'Fermeture auto'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [lot], activeId: lot.id }
  const retro = applySkill(board, 'mattpocock-skills:retro', { now: 2_000, isMain: true })!.board
  return applyReport(
    retro,
    {
      items: [{ id: 'r1', label: 'Hooks', status: 'done' }],
      tickets: [
        { id: '06', name: 'Revue des pistes', sensitive: false, logic: true },
        { id: '07', name: 'Délai des contrôles', sensitive: false, logic: true },
      ],
      groups: [
        { id: 'A', name: 'Hooks', tickets: ['06'] },
        { id: 'B', name: 'Contrôles', tickets: ['07'] },
      ],
      complete: true,
    },
    3_000,
  ).board
}
const implementOf = (run: Run) => run.phases.find(p => p.skill === 'implement')!

test('une Implémentation rendue due par un lot redevient facultative quand ses tickets sont tous retirés, et la rétro se termine', () => {
  const board = retroWithLot()
  const due = activeRun(board)!
  expect(isPhaseOptional(due, implementOf(due))).toBe(false)
  expect(due.status).toBe('active')
  const out = applyReport(board, { remove: ['06', '07'] }, 4_000)
  const run = out.board.runs.find(r => r.id === due.id)!
  expect(implementOf(run).isOptional).toBe(true)
  expect(isPhaseOptional(run, implementOf(run))).toBe(true)
  // Comme une rétro sans ticket : le parcours est terminé, pas en pause.
  expect(run.status).toBe('done')
  expect(run.finishedAt).toBe(4_000)
})

test('un seul ticket retiré, ou un lot retiré puis remplacé dans le même appel : l’Implémentation reste due', () => {
  const board = retroWithLot()
  const id = activeRun(board)!.id
  const one = applyReport(board, { remove: ['06'] }, 4_000).board.runs.find(r => r.id === id)!
  expect(isPhaseOptional(one, implementOf(one))).toBe(false)
  expect(one.status).toBe('active')
  const swapped = applyReport(board, { remove: ['06', '07'], tickets: [{ id: '08', name: 'Nouveau', sensitive: false, logic: true }] }, 4_000).board.runs.find(r => r.id === id)!
  expect(isPhaseOptional(swapped, implementOf(swapped))).toBe(false)
  expect(swapped.status).toBe('active')
})

test('les tickets d’un groupe se calculent une fois par état du lot, rattachés compris', () => {
  const board = lotBoard(
    [
      { id: 'a1', name: 'Un' },
      { id: 'b1', name: 'Deux' },
    ],
    [
      { id: 'A', name: 'Alpha', tickets: ['a1'] },
      { id: 'B', name: 'Bêta', tickets: ['b1'] },
    ],
  )
  const run = activeRun(board)!
  const first = groupTicketsOf(run)
  // Rien n'a changé : le même calcul sert, sans refaire le plan.
  expect(groupTicketsOf(run)).toBe(first)
  expect(first.get('A')).toEqual(['a1'])
  // Un ticket ajouté qui attend a1 rejoint A : le calcul change avec le lot.
  run.tickets = [...run.tickets, { ...run.tickets[0]!, id: 'x1', name: 'Rattaché', status: 'todo', blockedBy: ['a1'] }]
  const second = groupTicketsOf(run)
  expect(second).not.toBe(first)
  expect(second.get('A')).toEqual(['a1', 'x1'])
  expect(second.get('B')).toEqual(['b1'])
})

test('le retrait d’un ticket déjà fait, dans un lot fini, ne termine pas le parcours', () => {
  const board = retroWithLot()
  const id = activeRun(board)!.id
  // Le lot entier fait : plus rien d'ouvert, l'Implémentation n'est plus retenue par lui.
  const done = applyReport(board, { set: [{ id: '06', status: 'done' }, { id: '07', status: 'done' }] }, 3_500).board
  const before = done.runs.find(r => r.id === id)!
  const out = applyReport(done, { remove: ['07'] }, 4_000).board.runs.find(r => r.id === id)!
  expect(out.status).toBe(before.status)
  expect(out.finishedAt).toBe(before.finishedAt)
  expect(implementOf(out).isOptional).toBe(implementOf(before).isOptional)
})
