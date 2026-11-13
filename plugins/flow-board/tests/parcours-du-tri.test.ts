import { expect, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { runOfCard } from '../hooks/launch.ts'
import { applyReport, applySkill, attachLaunch, autoActionOf, emptyBoard, markAutoSent, markAutoStarted, suggestionsFor } from '../hooks/model.ts'
import type { Board, RunLaunch } from '../types'

// Le parcours d'un tri avec corrections, de bout en bout, dans une seule mission lancée par une carte du COO : tri,
// partage, tickets tirés du tri, deux groupes, Implémentation, compte rendu. Garde contre le retour de R96 (le tri sans
// ticket envoyait /implement à un lot vide) et R97 (repasser à /to-tickets ouvrait une seconde mission), et seul travail
// de cette mission pour R163 (la carte de lancement qui montre une autre mission que la sienne).

const T0 = 10_000_000
const LAUNCH: RunLaunch = { id: 'labcdefgh12', card: 'kcarte123', at: T0 - 1_000, folder: 'bugs-du-parcours', start: 'triage', mode: 'auto' }
const TICKETS = [
  { id: 't1', name: 'Corriger le hook', blockedBy: [] },
  { id: 't2', name: 'Corriger le script', blockedBy: [] },
]
const GROUPS = [
  { id: 'A', name: 'Hook', tickets: ['t1'] },
  { id: 'B', name: 'Script', tickets: ['t2'] },
]
const TRIAGE_STEPS = ['context', 'verify', 'recommend', 'grill', 'sensitive', 'partition', 'apply']

/** Après chaque pas : une seule mission, la même, et la carte la retrouve. */
const sameMission = (board: Board, id: string) => {
  expect(board.runs.length).toBe(1)
  expect(board.runs[0]!.id).toBe(id)
  expect(activeRun(board)?.id).toBe(id)
  expect(runOfCard(board.runs, LAUNCH.card)?.id).toBe(id)
}

/**
 * Le parcours entier ; `byAuto` : /to-tickets part comme l'envoie l'auto (l'action de l'auto, sa marque « envoyée »
 * posée avant l'envoi, puis « démarrée » au chargement du skill), sinon la personne le tape.
 */
const playJourney = (byAuto: boolean) => {
  // La mission naît du premier message de la carte, puis se rattache à elle.
  let board = applySkill({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [], activeId: null }, 'mattpocock-skills:triage', { now: T0, isMain: true, isLaunched: true })!.board
  board = attachLaunch(board, LAUNCH, T0 + 100)!.board
  const id = activeRun(board)!.id
  sameMission(board, id)
  board = applyReport(board, { title: 'Bugs du parcours de mission' }, T0 + 200).board
  sameMission(board, id)

  // Le tri : ses étapes jusqu'à apply, les entrées triées, puis la fin sans ticket.
  // Les étapes neuves du tri, chacune acceptée et en cours à son tour (une étape inconnue laisserait la précédente).
  for (const [i, step] of TRIAGE_STEPS.entries()) {
    const out = applyReport(board, { step }, T0 + 1_000 * (i + 1))
    expect(out.text).not.toContain('is not a step')
    board = out.board
    sameMission(board, id)
    expect(activeRun(board)!.phases[0]!.steps.find(s => s.status === 'active')?.id).toBe(step)
  }
  board = applyReport(board, { items: [{ id: 'R96', label: 'R96 Lot vide', status: 'done' }, { id: 'R62-a', label: 'R62-a Lien', status: 'done' }] }, T0 + 9_000).board
  expect(activeRun(board)!.phases[0]!.items.map(i => i.id)).toEqual(['R96', 'R62-a'])
  board = applyReport(board, { complete: true }, T0 + 10_000).board
  sameMission(board, id)
  const afterTriage = activeRun(board)!
  expect(afterTriage.phases.find(p => p.skill === 'triage')!.status).toBe('done')
  expect(afterTriage.tickets.length).toBe(0)
  expect(suggestionsFor(afterTriage).primary).toBe('to-tickets')

  // Le découpage : par l'auto ou tapé par la personne, même mission.
  const action = autoActionOf(activeRun(board)!)
  expect(action?.kind === 'command' ? action.skill : null).toBe('to-tickets')
  if (byAuto) {
    board = markAutoSent(board, action!, T0 + 10_500)!.board
    sameMission(board, id)
  }
  board = applySkill(board, 'mattpocock-skills:to-tickets', { now: T0 + 11_000, isMain: true })!.board
  if (byAuto) board = markAutoStarted(board, m => m.key === action!.key, T0 + 11_000)!.board
  sameMission(board, id)
  if (byAuto) expect((activeRun(board)!.autoSent ?? []).find(m => m.key === action!.key)?.startedAt).toBe(T0 + 11_000)
  expect(activeRun(board)!.phases[activeRun(board)!.cursor]!.skill).toBe('to-tickets')
  board = applyReport(board, { tickets: TICKETS, groups: GROUPS }, T0 + 12_000).board
  sameMission(board, id)
  board = applyReport(board, { complete: true }, T0 + 13_000).board
  sameMission(board, id)
  expect(activeRun(board)!.tickets.map(t => t.id)).toEqual(['t1', 't2'])
  expect((activeRun(board)!.groups ?? []).map(g => g.id)).toEqual(['A', 'B'])
  expect(suggestionsFor(activeRun(board)!).primary).toBe('implement')

  // L'Implémentation : les tickets faits ; le compte rendu n'est plus facultatif dès que le code a commencé.
  board = applySkill(board, 'mattpocock-skills:implement', { now: T0 + 14_000, isMain: true })!.board
  sameMission(board, id)
  expect(activeRun(board)!.phases.find(p => p.skill === 'compte-rendu')!.isOptional).toBe(false)
  board = applyReport(board, { set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'done' }] }, T0 + 15_000).board
  sameMission(board, id)
  expect(activeRun(board)!.tickets.every(t => t.status === 'done')).toBe(true)

  // Le compte rendu, dans la même mission.
  board = applySkill(board, 'flow-board:compte-rendu', { now: T0 + 16_000, isMain: true })!.board
  sameMission(board, id)
  const run = activeRun(board)!
  expect(run.phases[run.cursor]!.skill).toBe('compte-rendu')
  expect(run.phases.find(p => p.skill === 'triage')!.status).toBe('done')
  expect(run.phases.find(p => p.skill === 'to-tickets')!.status).toBe('done')
}

test('le parcours du tri de bout en bout, /to-tickets envoyé par l’auto : une seule mission, la même, que sa carte retrouve', () => {
  playJourney(true)
})

test('le même parcours, /to-tickets tapé par la personne : une seule mission, la même', () => {
  playJourney(false)
})
