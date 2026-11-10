import { expect, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { applyReport, applySkill, detachOnLoad, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// Un skill chargé dans une discussion sans mission ne reprend d'office qu'une mission tenue ici, ou née ici et
// tenue par personne. Depuis le 09/11/2026 (choix de Mathis : une mission ne vit que dans sa discussion), le
// chargement ne touche plus jamais la mission d'une autre discussion, même muette.
// Constaté le 06/11/2026 : un /grill-with-docs lancé dans une discussion neuve avait repris une mission active dans une autre discussion mais muette depuis trois jours :
// son propriétaire avait changé, et des points étrangers y avaient été écrits.

const HOUR = 60 * 60 * 1000
const NOW = 100 * HOUR

const boardOf = (runs: Run[], session: string): Board => ({ ...emptyBoard('c:/dev/p', 'p'), session, runs, activeId: null, deleted: [] })

test('une mission active dans une autre discussion, muette depuis plus de 30 min, n’est pas reprise par un skill de cadrage', () => {
  const a = newRun('grill-with-docs', NOW - 72 * HOUR, 'Retours sur le tableau de bord')
  a.owner = 'X'
  a.bornIn = 'X'
  // La discussion Y relit le stockage : A, muette, reste à X (une mission ne vit que dans sa discussion,
  // choix de Mathis du 09/11/2026) ; Y n'y écrit rien, ni au chargement ni par le skill.
  const before = JSON.stringify(a)
  const here = detachOnLoad(boardOf([a], 'X'), NOW, 'Y')
  expect(JSON.stringify(here.runs.find(r => r.id === a.id))).toBe(before)
  const after = applySkill(here, 'mattpocock-skills:grill-with-docs', { now: NOW, isMain: true })!.board
  const kept = after.runs.find(r => r.id === a.id)!
  expect(JSON.stringify(kept)).toBe(before)
  expect(kept.owner).toBe('X')
  expect(kept.status).toBe('active')
  // Une nouvelle mission s'ouvre ici (décision de Mathis du 06/11/2026).
  const opened = activeRun(after)!
  expect(opened.id === a.id).toBe(false)
  expect(opened.bornIn).toBe('Y')
  expect(after.runs).toHaveLength(2)
  // Les points envoyés ensuite par Claude n'entrent pas dans A.
  const sent = applyReport(after, { items: [{ id: 'q1', label: 'Alléger le modèle' }] }, NOW + 1_000)
  expect(sent.board.runs.find(r => r.id === a.id)!.phases.flatMap(p => p.items).map(i => i.id)).toEqual([])
})

test('une mission en pause née dans une autre discussion n’est pas reprise par /implement', () => {
  const b = { ...newRun('implement', NOW - 2 * HOUR, 'Lot de X'), status: 'paused' as const }
  b.bornIn = 'X'
  const here = detachOnLoad(boardOf([b], 'X'), NOW, 'Y')
  const after = applySkill(here, 'mattpocock-skills:implement', { now: NOW, isMain: true })!.board
  expect(activeRun(after)!.id === b.id).toBe(false)
  expect(activeRun(after)!.bornIn).toBe('Y')
  expect(after.runs.find(r => r.id === b.id)!.status).toBe('paused')
})

test('une mission restée active ailleurs, muette, arrivée par la relecture du stockage, n’est pas reprise non plus', () => {
  // Pas passée par detachOnLoad : la fusion des 5 secondes l'apporte active, au nom de X.
  const a = { ...newRun('implement', NOW - 2 * HOUR, 'Lot de X'), owner: 'X', bornIn: 'X' }
  const after = applySkill(boardOf([a], 'Y'), 'mattpocock-skills:implement', { now: NOW, isMain: true })!.board
  expect(after.runs.find(r => r.id === a.id)!.owner).toBe('X')
  expect(activeRun(after)!.id === a.id).toBe(false)
})

test('une mission en pause née dans cette discussion est reprise par le skill de sa phase', () => {
  const c = { ...newRun('implement', NOW - 2 * HOUR, 'Lot de Y'), status: 'paused' as const }
  c.bornIn = 'Y'
  const here = detachOnLoad(boardOf([c], 'Y'), NOW, 'Y')
  const out = applySkill(here, 'mattpocock-skills:implement', { now: NOW, isMain: true })!
  expect(activeRun(out.board)!.id).toBe(c.id)
  expect(activeRun(out.board)!.owner).toBe('Y')
})

test('une mission née ici mais tenue par une autre discussion, muette, n’est pas reprise d’office', () => {
  // Née dans Y, prise dans X par « ↻ Reprendre ici » ; la fusion l'apporte active au nom de X.
  const m = { ...newRun('implement', NOW - 2 * HOUR, 'Lot de Y repris par X'), owner: 'X', bornIn: 'Y' }
  const after = applySkill(boardOf([m], 'Y'), 'mattpocock-skills:implement', { now: NOW, isMain: true })!.board
  expect(after.runs.find(r => r.id === m.id)!.owner).toBe('X')
  expect(activeRun(after)!.id === m.id).toBe(false)
})

test('une mission active muette encore tenue par cette discussion est reprise par le skill de sa phase', () => {
  const d = { ...newRun('implement', NOW - 2 * HOUR, 'Lot de Y'), owner: 'Y' }
  const out = applySkill(boardOf([d], 'Y'), 'mattpocock-skills:implement', { now: NOW, isMain: true })!
  expect(activeRun(out.board)!.id).toBe(d.id)
})

test('un board sans id de discussion ne reprend aucune mission d’office', () => {
  const e = { ...newRun('implement', NOW - 2 * HOUR, 'Lot sans trace'), status: 'paused' as const }
  const board: Board = { ...emptyBoard('c:/dev/p', 'p'), runs: [e], activeId: null, deleted: [] }
  const after = applySkill(board, 'mattpocock-skills:implement', { now: NOW, isMain: true })!.board
  expect(activeRun(after)!.id === e.id).toBe(false)
})
