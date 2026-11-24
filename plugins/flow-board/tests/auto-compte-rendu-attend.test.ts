import { expect, test } from 'claude-code/testing'

import { autoActionOf, autoDecision, autoReportWaitsNote, AUTO_STOPS, emptyBoard, markAutoSent, newRun, type AutoAction } from '../hooks/model.ts'
import type { Run } from '../types'

// En auto, le compte rendu attend toute question bloquante ouverte, quelle que soit sa cible, et toute fermeture
// arrêtée (réponse (a) de la personne à CR-AUTO) : le 18/11, il était parti avec la question COURSE-05 ouverte, posée
// sur le groupe B, et la fermeture du worker B arrêtée à cause d'elle.

/** Une mission dont toutes les phases avant le compte rendu sont faites : la suite de l'auto est le compte rendu. */
const atReport = (): Run => {
  const run = { ...newRun('to-spec', 1_000, 'Course'), owner: 's' }
  const at = run.phases.findIndex(p => p.skill === 'compte-rendu')
  return { ...run, cursor: at - 1, phases: run.phases.map((p, i) => (i <= at - 1 ? { ...p, status: 'done' as const } : p)) }
}

/** Le groupe B rendu, sa fermeture dans l'état donné. */
const withClosing = (run: Run, closing: NonNullable<NonNullable<Run['groups']>[number]['delegated']>['closing']): Run => ({
  ...run,
  groups: [
    { id: 'B', name: 'Course', tickets: [], delegated: { at: 2_000, ...(closing ? { closing } : {}) } },
    { id: 'C', name: 'Code', tickets: [], delegated: { at: 2_000, closing: { state: 'closed', at: 3_000 } } },
  ],
})

test('rien n’attend : le compte rendu part', () => {
  const run = atReport()
  expect(autoActionOf(run)).toMatchObject({ kind: 'command', skill: 'compte-rendu' })
  expect(autoDecision(run, {}, false)).toMatchObject({ kind: 'send', action: { kind: 'command', skill: 'compte-rendu' } })
  // Toutes les fermetures faites : il part aussi.
  expect(autoDecision(withClosing(run, { state: 'closed', at: 3_000 }), {}, false)).toMatchObject({ kind: 'send', action: { skill: 'compte-rendu' } })
})

test('une question posée sur un groupe retient le compte rendu : la pause « plus rien ne peut avancer sans toi », qui reprend d’elle-même', () => {
  const run = { ...atReport(), waiting: [{ id: 'COURSE-05', blocks: { kind: 'group' as const, id: 'B' }, text: 'La course se garde-t-elle ?', at: 2_500 }] }
  expect(autoDecision(run, {}, false)).toEqual({ kind: 'stop', why: AUTO_STOPS.stuck, relaunch: [] })
  // Un worker encore au travail : rien ne part, sans pause.
  expect(autoDecision(run, {}, true)).toMatchObject({ kind: 'none' })
  // Répondue : le compte rendu part (une fois : dernier test).
  expect(autoDecision({ ...run, waiting: [] }, {}, false)).toMatchObject({ kind: 'send', action: { skill: 'compte-rendu' } })
})

test('une fermeture arrêtée retient le compte rendu, et le journal dit laquelle ; reprise et close, il part', () => {
  const run = withClosing(atReport(), { state: 'stopped', at: 3_000, why: 'question COURSE-05 ouverte' })
  const held = autoDecision(run, {}, false)
  expect(held).toEqual({ kind: 'none', relaunch: [], note: autoReportWaitsNote(['du groupe B']) })
  expect(autoReportWaitsNote(['du groupe B'])).toBe('Auto : le compte rendu attend la fermeture arrêtée du groupe B (relance-la : « ↻ Relancer la fermeture »)')
  expect(autoDecision(withClosing(atReport(), { state: 'closed', at: 4_000 }), {}, false)).toMatchObject({ kind: 'send', action: { skill: 'compte-rendu' } })
})

test('une fermeture arrêtée d’un envoi précédent, qu’aucun bouton ne relance, ne retient pas le compte rendu pour toujours', () => {
  const run = withClosing(atReport(), { state: 'closed', at: 4_000 })
  run.groups![1]!.delegated = { at: 4_000, closing: { state: 'closed', at: 5_000 }, earlier: [{ at: 2_000, seq: 1, closing: { state: 'stopped', at: 3_000, why: 'arbre pas propre' } }] } as never
  expect(autoDecision(run, {}, false)).toMatchObject({ kind: 'send', action: { skill: 'compte-rendu' } })
})

test('le compte rendu ne part qu’une fois : sa marque posée, l’auto ne le renvoie pas', () => {
  const run = atReport()
  const decision = autoDecision(run, {}, false)
  expect(decision.kind).toBe('send')
  const board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const marked = markAutoSent(board, (decision as { action: AutoAction }).action, 5_000)!.board
  expect(autoDecision(marked.runs[0]!, {}, false).kind).not.toBe('send')
})

test('une fermeture arrêtée sur une question déclarée (« question ouverte ») : la pause « plus rien ne peut avancer sans toi », pas la seule ligne du journal', () => {
  const run = { ...withClosing(atReport(), { state: 'stopped', at: 3_000, why: 'question ouverte' }), waiting: [{ id: 'COURSE-05', blocks: { kind: 'group' as const, id: 'B' }, text: 'La course se garde-t-elle ?', at: 2_500 }] }
  expect(autoDecision(run, {}, false)).toEqual({ kind: 'stop', why: AUTO_STOPS.stuck, relaunch: [] })
})

test('le compte rendu déjà envoyé : une fermeture arrêtée ensuite ne fait pas dire au journal qu’il attend', () => {
  const run = atReport()
  const decision = autoDecision(run, {}, false)
  const board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const marked = markAutoSent(board, (decision as { action: AutoAction }).action, 5_000)!.board.runs[0]!
  const after = autoDecision(withClosing(marked, { state: 'stopped', at: 6_000, why: 'arbre pas propre' }), {}, false) as { note?: string }
  expect(after.note).not.toBe(autoReportWaitsNote(['du groupe B']))
})
