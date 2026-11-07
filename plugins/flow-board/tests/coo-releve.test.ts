import { expect, test } from 'claude-code/testing'

import { cooPoint, cooStatement, statementText } from '../hooks/coo.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { CORPUS } from './corpus.mjs'

// Le relevé d'état du COO : calculé par le code, il ne recopie aucun texte d'une mission comme une
// consigne (corpus hostile).

const NOW = 200_000_000

/** Une mission en auto, avec une question bloquante ouverte. */
const inAuto = (title: string, question: string): Run => ({
  ...newRun('implement', NOW - 60_000, title),
  status: 'active',
  owner: 'session-M',
  auto: { onAt: NOW - 30_000, onBy: 'session-M' },
  waiting: [{ id: 'q3', blocks: { phase: 'implement' }, text: question, at: NOW - 10_000 }],
  tickets: [
    { id: '1', name: 'Un', status: 'done' },
    { id: '2', name: 'Deux', status: 'todo' },
  ],
} as unknown as Run)

const inManual = (title: string): Run => ({ ...newRun('grill-with-docs', NOW - 90_000, title), status: 'paused' }) as Run

const board = (...runs: Run[]): Board => ({ ...emptyBoard('/p', 'p'), runs })

test('le relevé liste chaque mission non archivée et les questions bloquantes des missions en auto', () => {
  const archived = { ...inManual('Vieille mission'), archivedAt: NOW - 1 } as Run
  const s = cooStatement(board(inAuto('Mode auto', 'Garder le refus ?'), inManual('Idée floue'), archived), { now: NOW, effort: 'high', hasBrief: false })
  expect(s.missions.map(m => [m.title, m.mode, m.done, m.total, m.waiting])).toEqual([
    ['Mode auto', 'auto', 1, 2, 1],
    ['Idée floue', 'manual', 0, 0, 0],
  ])
  expect(s.waits.map(w => [w.mission, w.id, w.text])).toEqual([['Mode auto', 'q3', 'Garder le refus ?']])
  const text = statementText(s)
  expect(text).toMatch(/Missions not archived \(2\)/)
  expect(text).toMatch(/« Mode auto »: in progress, phase .+, mode auto, tickets 1\/2 done, waiting for the user: 1 blocking question/)
  expect(text).toMatch(/question « q3 »: « Garder le refus \? »/)
  expect(text).toMatch(/Effort chosen in this discussion: high; the mod sends its requests in medium \(COO rule\)\./)
  expect(text).toMatch(/BRIEF\.md at the project root: missing/)
  expect(text).not.toMatch(/Vieille mission/)
  expect(cooPoint(s)).toEqual(['1 mission en cours, 1 en pause, 1 en auto.', '1 chose t’attend : 1 question bloquante (Mode auto).', 'Prochaine étape du projet : à confirmer (pas encore de feuille de route).'])
})

test('les workers d’une mission : un groupe confié au travail, un groupe rendu, pas un groupe fermé ; tickets rattachés comptés', () => {
  const run = {
    ...inAuto('Mission à groupes', 'Q ?'),
    tickets: [
      { id: '1', name: 'Un', status: 'done' },
      { id: '2', name: 'Deux', status: 'todo' },
      { id: '3', name: 'Trois', status: 'done' },
      { id: '4', name: 'Quatre', status: 'done' },
    ],
    groups: [
      { id: 'A', name: 'A', tickets: ['1', '2'], linked: { at: NOW - 5_000, session: 'w-a' } },
      { id: 'B', name: 'B', tickets: ['3'], delegated: { at: NOW - 9_000, session: 'w-b' } },
      { id: 'C', name: 'C', tickets: ['4'], delegated: { at: NOW - 9_000, session: 'w-c', closing: { state: 'closed', at: NOW - 1_000 } } },
    ],
  } as unknown as Run
  const s = cooStatement(board(run), { now: NOW })
  expect(s.missions[0]!.workers).toEqual([
    { group: 'A', done: 1, total: 2, state: 'working' },
    { group: 'B', done: 1, total: 1, state: 'returned' },
  ])
  expect(statementText(s)).toMatch(/workers: group « A » 1\/2 \(working\), group « B » 1\/1 \(returned\)/)
})

test('un effort inconnu fait demander à la personne une fois ; rien en cours, rien n’attend', () => {
  const s = cooStatement(board(), { now: NOW })
  expect(statementText(s)).toMatch(/Effort chosen in this discussion: unknown \(ask the user once\)/)
  expect(cooPoint(s).slice(0, 2)).toEqual(['Aucune mission en cours.', 'Rien ne t’attend.'])
})

test('un titre ou une question relus d’une mission n’ajoutent ni ligne ni citation au relevé (corpus hostile)', () => {
  const reference = statementText(cooStatement(board(inAuto('Titre', 'Question')), { now: NOW, effort: 'high', hasBrief: true }))
  for (const [name, token] of Object.entries(CORPUS)) {
    const s = cooStatement(board(inAuto(`Titre${token}x`, `Question${token}x`)), { now: NOW, effort: 'high', hasBrief: true })
    const text = statementText(s)
    expect(text.split('\n').length, name).toBe(reference.split('\n').length)
    // Les seules citations « … » sont celles du relevé : 2 dans la ligne de la mission, 3 dans celle de la question.
    expect((text.match(/«/g) ?? []).length, name).toBe((reference.match(/«/g) ?? []).length)
  }
})

test('le relevé dit l’état de l’archivage d’office et renvoie à /flow archive, jamais à un fichier du store', () => {
  const on = statementText(cooStatement(board(), { now: NOW, archive: Date.UTC(2026, 10, 2, 9) }))
  expect(on).toMatch(/Archivage d’office : allumé depuis le 2026-11-02\b/)
  const off = statementText(cooStatement(board(), { now: NOW, archive: null }))
  expect(off).toMatch(/Archivage d’office : éteint\b/)
  expect(off).not.toMatch(/allumé/)
  // Pas relu (lecture ratée) : le relevé ne devine pas, il renvoie à la commande.
  const unread = statementText(cooStatement(board(), { now: NOW }))
  expect(unread).toMatch(/Archivage d’office : état pas relu\b/)
  for (const text of [on, off, unread]) {
    expect(text).toMatch(/\/flow archive \(no argument\)/)
    expect(text).toMatch(/never by reading a file of flow-board's store/)
  }
})

test('un budget gardé en texte par le registre (« 32000 ») part tel quel : le relevé ne dit pas que le mod envoie en medium', () => {
  const text = statementText(cooStatement(board(), { now: NOW, effort: '32000' }))
  expect(text).toMatch(/Effort chosen in this discussion: 32000\./)
  expect(text).not.toMatch(/the mod sends its requests in/)
})
