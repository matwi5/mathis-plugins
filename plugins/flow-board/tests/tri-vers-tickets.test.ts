import { expect, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { applyReport, applySkill, AUTO_EMPTY_LOT_NOTE, autoActionOf, autoDecision, emptyBoard, newRun, noteAutoHold, suggestionsFor, upgradeRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// Après le tri de la mission « Durcir les scripts du dépôt » (16 corrections, aucun ticket), flow-board avait envoyé
// /implement à un lot vide ; repasser à /to-tickets avait ouvert une autre mission, où l'auto s'était perdu. Le tri
// reçoit une phase Tickets facultative avant l'Implémentation, et l'auto n'envoie jamais /implement sans ticket.

const T0 = 1_000

const boardOf = (skill: string): Board => applySkill({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [], activeId: null }, skill, { now: T0, isMain: true })!.board

const shape = (run: Run): string[] => run.phases.map(p => `${p.skill}${p.isOptional ? '?' : ''}`)

const TICKETS = [{ id: 't1', name: 'Corriger le script' }]

test('le parcours du tri : Tri → Tickets (facultative) → Implémentation (facultative) → Compte rendu → Version et PR', () => {
  const run = activeRun(boardOf('mattpocock-skills:triage'))!
  expect(shape(run)).toEqual(['triage', 'to-tickets?', 'implement?', 'compte-rendu?', 'project:version?', 'project:pr?'])
})

test('tri fini en auto avec zéro ticket : la phase Tickets part, jamais l’Implémentation', () => {
  const done = applyReport(boardOf('mattpocock-skills:triage'), { complete: true }, T0 + 1_000).board
  const run = activeRun(done)!
  expect(suggestionsFor(run).primary).toBe('to-tickets')
  const action = autoActionOf(run)
  expect(action?.kind === 'command' ? action.skill : null).toBe('to-tickets')
})

test('tri puis découpage : l’Implémentation part', () => {
  let board = applyReport(boardOf('mattpocock-skills:triage'), { complete: true }, T0 + 1_000).board
  board = applySkill(board, 'mattpocock-skills:to-tickets', { now: T0 + 2_000, isMain: true })!.board
  board = applyReport(board, { tickets: TICKETS, complete: true }, T0 + 3_000).board
  const action = autoActionOf(activeRun(board)!)
  expect(action?.kind === 'command' ? action.skill : null).toBe('implement')
})

test('un tri qui a envoyé ses tickets : la phase Tickets ne se propose pas, l’Implémentation part comme avant', () => {
  const run = activeRun(applyReport(boardOf('mattpocock-skills:triage'), { tickets: TICKETS, complete: true }, T0 + 1_000).board)!
  expect(suggestionsFor(run).primary).toBe('implement')
  const action = autoActionOf(run)
  expect(action?.kind === 'command' ? action.skill : null).toBe('implement')
})

test('un tri qui a envoyé ses tickets : /to-tickets ne se propose pas non plus à côté', () => {
  const run = activeRun(applyReport(boardOf('mattpocock-skills:triage'), { tickets: TICKETS, complete: true }, T0 + 1_000).board)!
  expect(suggestionsFor(run).others.includes('to-tickets')).toBe(false)
})

test('hors du tri, une phase Tickets facultative se propose comme avant, même avec des tickets au tableau de bord', () => {
  // Nouvelle fonctionnalité : des tickets envoyés pendant le cadrage n'en sautent pas le découpage.
  const run = activeRun(applyReport(boardOf('mattpocock-skills:grill-with-docs'), { tickets: TICKETS }, T0 + 500).board)!
  run.phases[0]!.status = 'done'
  for (const p of run.phases) if (p.skill === 'to-spec') p.status = 'skipped'
  expect(suggestionsFor(run).primary).toBe('to-tickets')
})

test('la consigne de /to-tickets rejouée : un tri sans correction, /to-tickets fini sans ticket, se clôt comme un tri sans code ; l’auto n’envoie rien et le dit une fois', () => {
  let board = applyReport(boardOf('mattpocock-skills:triage'), { title: 'Tri', complete: true }, T0 + 1_000).board
  board = applySkill(board, 'mattpocock-skills:to-tickets', { now: T0 + 2_000, isMain: true })!.board
  board = applyReport(board, { complete: true }, T0 + 3_000).board
  const run = activeRun(board)!
  expect(run.phases.find(p => p.skill === 'to-tickets')!.status).toBe('done')
  expect(suggestionsFor(run).canFinish).toBe(true)
  const d = autoDecision(run, {}, false)
  expect(d.kind === 'none' ? d.note : undefined).toBe(AUTO_EMPTY_LOT_NOTE)
  // La note s'écrit une fois au journal : un second tour ne la répète pas.
  const once = noteAutoHold(board, AUTO_EMPTY_LOT_NOTE, T0 + 4_000)!.board
  expect(activeRun(once)!.log[0]!.text).toBe(AUTO_EMPTY_LOT_NOTE)
  expect(noteAutoHold(once, AUTO_EMPTY_LOT_NOTE, T0 + 5_000)).toBe(null)
})

test('rétro en auto sans ticket : rien ne part vers l’Implémentation', () => {
  const run = activeRun(boardOf('mattpocock-skills:retro'))!
  run.phases[0]!.status = 'done'
  expect(autoActionOf(run)).toBe(null)
})

test('un tri d’avant, à l’ancien parcours : l’auto n’envoie plus /implement sans ticket, et la mission n’est pas réécrite', () => {
  const old = newRun('triage', T0)
  // L'ancien parcours, tel qu'enregistré : Tri → Implémentation facultative → …
  old.phases = old.phases.filter(p => p.skill !== 'to-tickets')
  old.phases[0]!.status = 'done'
  const before = JSON.stringify(old.phases.map(p => p.skill))
  const read = upgradeRun(structuredClone(old))
  expect(JSON.stringify(read.phases.map(p => p.skill))).toBe(before)
  expect(suggestionsFor(read).primary).toBe('implement')
  expect(autoActionOf(read)).toBe(null)
  // Avec un ticket, elle part comme aujourd'hui.
  read.tickets = [{ id: 't1', name: 'Un ticket', status: 'todo' } as Run['tickets'][number]]
  const action = autoActionOf(read)
  expect(action?.kind === 'command' ? action.skill : null).toBe('implement')
})

test('une Implémentation obligatoire : la carte la propose comme aujourd’hui ; sans ticket, l’auto ne l’envoie pas, et sa pause la nomme', () => {
  const run = activeRun(boardOf('mattpocock-skills:to-tickets'))!
  run.phases[0]!.status = 'done'
  expect(suggestionsFor(run).primary).toBe('implement')
  expect(autoActionOf(run)).toBe(null)
  const d = autoDecision(run, {}, false)
  expect(d.kind === 'stop' ? d.why : '').toContain('/mattpocock-skills:implement')
})

test('hors auto, la carte « Ensuite » d’un tri fini propose /to-tickets, puis /implement à côté', () => {
  const run = activeRun(applyReport(boardOf('mattpocock-skills:triage'), { complete: true }, T0 + 1_000).board)!
  const s = suggestionsFor(run)
  expect(s.primary).toBe('to-tickets')
  expect(s.others.includes('implement')).toBe(true)
})

test('un tri fini sans ticket se clôt comme aujourd’hui', () => {
  const done = applyReport(boardOf('mattpocock-skills:triage'), { complete: true }, T0 + 1_000).board
  expect(suggestionsFor(activeRun(done)!).canFinish).toBe(true)
})

test('la décision de l’auto dit pourquoi l’Implémentation ne part pas sans ticket', () => {
  const old = newRun('triage', T0)
  old.phases = old.phases.filter(p => p.skill !== 'to-tickets')
  old.phases[0]!.status = 'done'
  const d = autoDecision(old, {}, false)
  expect(d.kind).toBe('none')
  expect(d.kind === 'none' ? d.note : undefined).toContain('aucun ticket')
})
