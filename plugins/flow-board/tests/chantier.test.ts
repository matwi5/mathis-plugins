import { expect, test } from 'claude-code/testing'

import { activeRun, applySkill, emptyBoard, isRunComplete, newRun } from '../hooks/model.ts'
import type { Board } from '../types'

const boardWith = (entry: string): Board => {
  const run = newRun(entry, 1_000)
  run.owner = 'session-A'
  return { ...emptyBoard('c:/dev/p', 'p'), session: 'session-A', runs: [run], activeId: run.id, deleted: [] }
}

const shape = (board: Board) => activeRun(board)!.phases.map(p => `${p.skill}${p.isOptional ? '?' : ''}`)

test('Santé du code et Triage finissent comme les autres : compte rendu, version, pull request', () => {
  expect(shape(boardWith('improve-codebase-architecture'))).toEqual([
    'improve-codebase-architecture',
    'grill-with-docs?',
    'to-spec?',
    'to-tickets?',
    'implement?',
    'compte-rendu?',
    'project:version?',
    'project:pr?',
  ])
  expect(shape(boardWith('triage'))).toEqual(['triage', 'implement?', 'compte-rendu?', 'project:version?', 'project:pr?'])
})

test('sans code, le parcours se clôt au triage ; dès que l’Implémentation démarre, le compte rendu devient obligatoire', () => {
  const board = boardWith('triage')
  // Le triage est fait, rien n'a été codé : le parcours peut se clore.
  const mapped = structuredClone(board)
  const run = activeRun(mapped)!
  run.phases[0]!.status = 'done'
  expect(isRunComplete(run)).toBe(true)

  // L'Implémentation démarre : le compte rendu qui suit n'est plus facultatif.
  const coding = applySkill(board, 'mattpocock-skills:implement', { now: 2_000, isMain: true })!.board
  const phases = activeRun(coding)!.phases
  expect(phases.find(p => p.skill === 'compte-rendu')!.isOptional).toBe(false)
  expect(phases.find(p => p.skill === 'project:version')!.isOptional).toBe(true)
  phases.find(p => p.skill === 'implement')!.status = 'done'
  expect(isRunComplete(activeRun(coding)!)).toBe(false)
})

test('le parcours « Nouvelle fonctionnalité » garde son compte rendu obligatoire dès le départ', () => {
  expect(shape(boardWith('grill-with-docs'))).toContain('compte-rendu')
})
