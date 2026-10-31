// Une trace de suppression (`deleted`) relue du fichier de parcours partagé. Invariant : un parcours
// n'est effacé par une trace de suppression que si cette trace est une vraie date (au plus une minute
// dans le futur, la tolérance de toutes les dates relues), postérieure à sa dernière modification. Une
// trace datée à plus d'une minute dans le futur, ou mal formée (sans id texte, sans date numérique),
// n'est jamais appliquée, tombe à la lecture, et le fichier se réécrit sans elle.

import { expect, mock, test } from 'claude-code/testing'

import { clampFuture, detachOnLoad, dropRun, emptyBoard, mergeBoards, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const NOW = 200_000_000
const MIN = 60_000

const runAt = (id: string, updatedAt: number): Run => ({ ...newRun('implement', NOW - 60 * MIN, id), id, updatedAt })
const board = (runs: Run[], deleted: unknown, activeId: string | null = null): Board =>
  ({ ...emptyBoard('', 'p'), session: 's', runs, activeId, deleted }) as unknown as Board

/** La lecture d'une copie du stockage, puis sa fusion avec la copie d'ici, comme la sauvegarde et la relecture. */
const readThenMerge = (local: Board, stored: Board, now = NOW): Board => mergeBoards(clampFuture(local, now), clampFuture(stored, now))

test('Une vraie suppression marche comme avant : une copie plus ancienne qui revient reste effacée ; un parcours touché après survit et sa trace tombe', () => {
  const old = runAt('r1', NOW - 10 * MIN)
  const gone = board([], [{ id: 'r1', at: NOW - MIN }])
  // L'effet d'abord : la copie qui revient, plus ancienne que la trace, est effacée, dans les deux sens.
  expect(readThenMerge(board([old], []), gone).runs.map(r => r.id)).toEqual([])
  expect(readThenMerge(gone, board([old], [])).runs.map(r => r.id)).toEqual([])
  // Même le parcours actif ici.
  expect(readThenMerge(board([old], [], 'r1'), gone).runs.map(r => r.id)).toEqual([])
  // Touché après la trace : il survit, et la trace tombe.
  const touched = runAt('r1', NOW - 30_000)
  const kept = readThenMerge(board([touched], []), gone)
  expect(kept.runs.map(r => r.id)).toEqual(['r1'])
  expect(kept.deleted).toEqual([])
  // « Supprimer définitivement » d'ici : la trace se pose à maintenant et efface toute copie d'avant.
  const dropped = dropRun(board([old], [], null), 'r1', NOW)!.board
  expect(readThenMerge(dropped, board([old], [])).runs).toEqual([])
})

test('Une trace datée à plus d’une minute dans le futur n’efface jamais le parcours vivant qu’elle vise, et tombe à la lecture', () => {
  const live = runAt('r1', NOW - 5 * MIN)
  const forged = board([], [{ id: 'r1', at: NOW + 60 * MIN }])
  for (const [a, b] of [[board([live], [], 'r1'), forged], [forged, board([live], [])], [board([live], []), forged]] as const) {
    const merged = readThenMerge(a, b)
    expect(merged.runs.map(r => r.id)).toEqual(['r1'])
    expect(merged.deleted).toEqual([])
  }
  // Lue seule, la copie forgée perd sa trace.
  expect(clampFuture(forged, NOW).deleted).toEqual([])
  // Au chargement aussi, la trace tombe.
  expect(detachOnLoad(board([live], [{ id: 'r1', at: NOW + 60 * MIN }]), NOW, 's').deleted).toEqual([])
  // Dans la tolérance d'une minute (horloge à peine en avance), elle s'applique comme une vraie.
  const near = board([], [{ id: 'r1', at: NOW + 30_000 }])
  expect(readThenMerge(board([live], []), near).runs).toEqual([])
})

test('Une trace mal formée (sans id texte, sans date numérique, pas un objet, une liste qui n’en est pas une) n’est jamais appliquée et ne fait rien tomber', () => {
  const live = runAt('r1', NOW - 5 * MIN)
  const malformed: unknown[] = [
    { id: 42, at: NOW - MIN },
    { id: 'r1', at: 'hier' },
    { id: 'r1', at: Infinity },
    { id: 'r1', at: -1 },
    { id: 'r1' },
    { at: NOW - MIN },
    { id: '', at: NOW - MIN },
    null,
    'r1',
  ]
  for (const t of malformed) {
    const merged = readThenMerge(board([live], [], 'r1'), board([], [t]))
    expect({ t, runs: merged.runs.map(r => r.id) }).toEqual({ t, runs: ['r1'] })
    expect(merged.deleted).toEqual([])
  }
  // Une liste de traces qui n'est pas une liste : rien n'est appliqué, rien ne tombe.
  for (const deleted of [{ r1: NOW - MIN }, 'r1', 42]) {
    const merged = readThenMerge(board([live], []), board([], deleted))
    expect(merged.runs.map(r => r.id)).toEqual(['r1'])
    expect(detachOnLoad(board([live], deleted), NOW, 's').deleted).toEqual([])
  }
  // À côté d'une trace mal formée, une vraie suppression d'un autre parcours s'applique.
  const other = runAt('r2', NOW - 10 * MIN)
  const mixed = readThenMerge(board([live, other], []), board([], [{ id: 42, at: NOW - MIN }, { id: 'r2', at: NOW - MIN }]))
  expect(mixed.runs.map(r => r.id)).toEqual(['r1'])
})

test('Une trace future tombée à la lecture fait réécrire le fichier sans elle : quand l’horloge rattrape sa date, rien n’est effacé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const mem: Record<string, unknown> = {}
  const disk: { board?: string; isUsed: boolean } = { isUsed: false }
  const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')
  on('session.id', () => ({ value: 'sa' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isBoardFile(e.path) && disk.board !== undefined }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!isBoardFile(e.path) || disk.board === undefined) throw new Error(`ENOENT ${e.path}`)
    disk.isUsed = true
    return { value: disk.board } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      disk.board = e.text
    }
    return { value: undefined } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  const stored = (): Board => (disk.isUsed && disk.board !== undefined ? JSON.parse(disk.board) : mem['board:']) as Board
  const seeded = board([{ ...runAt('r1', NOW - 5 * MIN), status: 'paused', owner: undefined }], [{ id: 'r1', at: NOW + 10 * MIN }])
  // Le stockage du parcours, au fichier commun ou dans `$.store` selon le dossier du mod ; l'ancien stockage
  // déjà versé : ce n'est pas le versement qui réécrit le fichier.
  mem['board:'] = JSON.parse(JSON.stringify(seeded))
  mem['migrated:board:'] = true
  disk.board = JSON.stringify(seeded)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  for (let i = 0; i < 7; i++) await clock.advance(1000)
  // L'effet d'abord : le fichier a été réécrit, sans la trace, le parcours gardé.
  expect(stored().deleted).toEqual([])
  expect(stored().runs.map(r => r.id)).toEqual(['r1'])
  // Dix minutes plus tard, la date de l'ancienne trace passée : le parcours est toujours là.
  for (let i = 0; i < 11; i++) await clock.advance(MIN)
  for (let i = 0; i < 7; i++) await clock.advance(1000)
  expect(stored().runs.map(r => r.id)).toEqual(['r1'])
})
