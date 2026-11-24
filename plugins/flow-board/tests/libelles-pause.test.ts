import { expect, test } from 'claude-code/testing'

import { cooStatement, nightViewsOf } from '../hooks/coo.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { AUTO_STOPS, autoNotices, autoPauseWhy, autoResumedLabel, autoStateOf, emptyBoard, isEndedPause, newRun, parkActive, resumedLabel, stopLabel, switchOnAuto } from '../hooks/model.ts'
import { nightBlocks } from '../hooks/night.ts'
import type { Board, Run } from '../types'

// La pause posée par la fin d'une discussion se montre « discussion arrêtée » ; sa valeur enregistrée reste
// « discussion fermée », que relisent les copies plus anciennes du mod. Un auto reparti de lui-même dit pourquoi :
// « repris : discussion relancée » après cette pause, « repris : questions répondues » sinon.

const T0 = 1_000_000

const boardWith = (over: Partial<Run> = {}): Board => {
  const run: Run = { ...newRun('implement', T0, 'Boutique'), owner: 'sa', ...over }
  return { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
}
const runOf = (board: Board): Run => board.runs[0]!

const rowOf = (run: Run): string => {
  const board: Board = { ...emptyBoard('', 'p'), deleted: [], runs: [{ ...run, status: 'active', owner: 'sb' }] }
  const row = coordinationRows(cooStatement(board, { now: T0 + 10_000 }), { page: 'overview' }).find(r => r.key === `coo-mission-${run.id}`)!
  return row.parts.map(p => p.text).join(' ')
}

test('la valeur enregistrée reste « discussion fermée » ; seul le libellé dit « discussion arrêtée »', () => {
  expect(AUTO_STOPS.ended).toBe('discussion fermée')
  expect(stopLabel(AUTO_STOPS.ended)).toBe('discussion arrêtée')
  const on = switchOnAuto(boardWith(), 'sa', T0 + 1)!.board
  const parked = parkActive(on, T0 + 2)!.board
  // La fin de la discussion écrit toujours la valeur enregistrée.
  expect(runOf(parked).auto).toMatchObject({ offWhy: 'discussion fermée' })
  expect(autoPauseWhy(runOf(parked))).toBe('discussion fermée')
  // Le bandeau, la notification et la ligne de journal nouvelle disent « discussion arrêtée ».
  expect(autoStateOf(runOf(parked), parked, 'sa')).toEqual({ kind: 'paused', why: 'discussion arrêtée' })
  expect(autoNotices(on, parked)).toEqual(['Mission Boutique : auto en pause (discussion arrêtée)'])
  expect(runOf(parked).log.map(l => l.text)).toContain('Mode auto éteint : discussion arrêtée')
})

test('un fichier des missions écrit avant se relit sans rien réécrire : la valeur et les lignes de journal déjà écrites restent', () => {
  const old = boardWith({ auto: { onAt: T0, onBy: 'sa', offAt: T0 + 1, offWhy: 'discussion fermée' }, log: [{ at: T0 + 1, glyph: '⚡', text: 'Mode auto éteint : discussion fermée', tone: 'info' }] } as Partial<Run>)
  const before = JSON.stringify(old)
  expect(autoStateOf(runOf(old), old, 'sa')).toEqual({ kind: 'paused', why: 'discussion arrêtée' })
  expect(JSON.stringify(old)).toBe(before)
  expect(runOf(old).log.map(l => l.text)).toEqual(['Mode auto éteint : discussion fermée'])
})

test('la vue Coordination montre « discussion arrêtée » pour une mission en manuel sous cette pause', () => {
  const run = runOf(boardWith({ auto: { onAt: T0, onBy: 'sb', offAt: T0 + 1, offWhy: 'discussion fermée' } } as Partial<Run>))
  expect(rowOf(run)).toMatch(/Manuel · discussion arrêtée/)
  expect(rowOf(run)).not.toMatch(/fermée/)
})

test('le blocage de nuit « à rouvrir » lit la valeur enregistrée, pas le libellé', () => {
  // En pause sous la valeur enregistrée, posée par la fin de sa discussion après la dernière prise du processus.
  const run = runOf(boardWith({ auto: { onAt: T0, onBy: 'sa', offAt: T0 + 5, offWhy: 'discussion fermée' }, claim: { boot: 'b1', at: T0 + 1 }, groups: [{ id: 'A', name: 'A', tickets: ['1'] }, { id: 'B', name: 'B', tickets: ['2'] }], tickets: [{ id: '1', name: 'un', status: 'todo' }, { id: '2', name: 'deux', status: 'todo' }] } as Partial<Run>))
  expect(isEndedPause(run)).toBe(true)
  const board: Board = { ...emptyBoard('', 'p'), deleted: [], runs: [run] }
  const views = nightViewsOf(board, { waveDue: () => [] })
  expect(views[0]).toMatchObject({ isEnded: true, isPaused: true })
  expect(nightBlocks(views, () => undefined, T0 + 10).map(b => b.act)).toEqual(['reopen'])
})

test('un auto reparti de lui-même après la pause « discussion fermée » dit « repris : discussion relancée » : toast, journal, vue Coordination', () => {
  const paused = boardWith({ auto: { onAt: T0, onBy: 'sa', offAt: T0 + 1, offWhy: 'discussion fermée' } } as Partial<Run>)
  const out = switchOnAuto(paused, 'sa', T0 + 2, null, 'resumed')!
  expect(out.fx.toasts).toEqual(['⚡ Auto · repris : discussion relancée : Boutique'])
  expect(runOf(out.board).log.map(l => l.text)).toContain('Mode auto repris : discussion relancée')
  expect(autoResumedLabel(runOf(out.board))).toBe('repris : discussion relancée')
  expect(rowOf(runOf(out.board))).toMatch(/⚡\sAuto · repris : discussion relancée/)
})

test('un auto reparti après la pause « plus rien ne peut avancer sans toi » dit toujours « repris : questions répondues »', () => {
  const paused = boardWith({ auto: { onAt: T0, onBy: 'sa', offAt: T0 + 1, offWhy: AUTO_STOPS.stuck } } as Partial<Run>)
  const out = switchOnAuto(paused, 'sa', T0 + 2, null, 'resumed')!
  expect(out.fx.toasts).toEqual(['⚡ Auto · repris : questions répondues : Boutique'])
  expect(runOf(out.board).log.map(l => l.text)).toContain('Mode auto repris : questions répondues')
  expect(rowOf(runOf(out.board))).toMatch(/⚡\sAuto · repris : questions répondues/)
  // Le libellé se déduit de la seule raison enregistrée de la pause d'avant.
  expect(resumedLabel(AUTO_STOPS.ended)).toBe('repris : discussion relancée')
  expect(resumedLabel(AUTO_STOPS.stuck)).toBe('repris : questions répondues')
  // Un allumage d'un clic ne dit aucune reprise.
  expect(autoResumedLabel(runOf(switchOnAuto(boardWith(), 'sa', T0 + 2)!.board))).toBeUndefined()
})
