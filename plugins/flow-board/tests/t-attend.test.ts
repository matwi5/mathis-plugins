// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { applyReport, archiveRun, clearWaitsUser, detachOnLoad, dropRun, emptyBoard, finishActive, mergeBoards, newRun, openRun, parkActive, resumeRun, setAsideActive, setWaitsUser, switchOnAuto } from '../hooks/model.ts'
import { cooStatement, statementText } from '../hooks/coo.ts'
import type { Board, Run } from '../types'
import { CORPUS } from './corpus.mjs'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// Le signal « t'attend ». Invariant : « Un signal "t'attend" ne survit jamais à la reprise du travail de
// la mission, ni à sa pause, sa clôture, son archivage ou sa suppression ; une attente n'est notifiée
// qu'une fois. »

const NOW = 600_000_000

/** Un board où la mission d'ici attend la personne. */
const waitingBoard = (): { board: Board; id: string } => {
  const run = { ...newRun('implement', NOW - 9000, 'Ici'), owner: 's' }
  const board: Board = { ...emptyBoard('/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return { board: setWaitsUser(board, 'question', NOW)!.board, id: run.id }
}
const signalOf = (board: Board, id: string) => board.runs.find(r => r.id === id)?.waitsUser

// ─── Le modèle : chaque chemin qui l'efface ───────────────────────────────

test('le signal se pose une fois par attente (même catégorie : sa date reste), et s’efface au tour suivant', () => {
  const { board, id } = waitingBoard()
  expect(signalOf(board, id)).toEqual({ since: NOW, kind: 'question' })
  expect(setWaitsUser(board, 'question', NOW + 50)).toBeNull()
  expect(signalOf(clearWaitsUser(board, NOW + 60)!.board, id)).toBeUndefined()
})

test('la pause, la mise de côté, la clôture, l’archivage et la suppression effacent le signal', () => {
  const { board, id } = waitingBoard()
  // Mise en pause : une autre mission ouverte ici, la reprise d'une autre.
  expect(signalOf(openRun(board, { title: 'Autre' }, NOW + 1).board, id)).toBeUndefined()
  const other: Run = { ...newRun('implement', NOW - 9000, 'Autre'), status: 'paused' }
  expect(signalOf(resumeRun({ ...board, runs: [...board.runs, other] }, other.id, NOW + 1)!.board, id)).toBeUndefined()
  expect(signalOf(setAsideActive(board, NOW + 1)!.board, id)).toBeUndefined()
  expect(signalOf(finishActive(board, NOW + 1)!.board, id)).toBeUndefined()
  expect(signalOf(archiveRun(board, id, NOW + 1)!.board, id)).toBeUndefined()
  expect(dropRun(board, id, NOW + 1)!.board.runs).toEqual([])
})

test('l’allumage de l’auto, la reprise de la mission et sa fin par l’outil effacent le signal', () => {
  const { board, id } = waitingBoard()
  expect(signalOf(switchOnAuto(board, 's', NOW + 1)!.board, id)).toBeUndefined()
  // Reprise de la mission elle-même, depuis une autre discussion : l'attente d'avant ne la suit pas.
  const parked: Board = { ...board, activeId: null, runs: board.runs.map(r => ({ ...r, status: 'paused' as const })) }
  expect(signalOf(resumeRun(parked, id, NOW + 1)!.board, id)).toBeUndefined()
  const last = board.runs[0]!.phases.length - 1
  const atLast: Board = { ...board, runs: board.runs.map(r => ({ ...r, cursor: last, phases: r.phases.map((p, i) => (i === last ? { ...p, status: 'active' as const } : p)) })) }
  const done = applyReport(atLast, { complete: true }, NOW + 1).board
  expect(done.runs[0]!.status).toBe('done')
  expect(signalOf(done, id)).toBeUndefined()
})

test('à la fusion, le signal suit le reste de la mission : la copie la plus récente l’emporte, vue d’une autre discussion', () => {
  const { board, id } = waitingBoard()
  const resumed = clearWaitsUser(board, NOW + 100)!.board
  // Vu d'une autre discussion (elle ne porte pas la mission) : la copie la plus récente, dans les deux sens.
  const elsewhere = (b: Board): Board => ({ ...b, session: 'autre', activeId: null })
  expect(signalOf(mergeBoards(elsewhere(board), resumed), id)).toBeUndefined()
  expect(signalOf(mergeBoards(elsewhere(resumed), board), id)).toBeUndefined()
  const later = setWaitsUser(resumed, 'report', NOW + 200)!.board
  expect(signalOf(mergeBoards(elsewhere(resumed), later), id)).toEqual({ since: NOW + 200, kind: 'report' })
})

// ─── Le mod de la mission ─────────────────────────────────────────────────

test('en manuel, un tour qui finit sur une question pose le signal ; le tour suivant l’efface', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  await $.turn.start({ text: 'x', turnId: 't1' } as any)
  await $.turn.complete({ answer: 'On garde quelle option ?', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await settle(clock, 2)
  const here = () => stored(w).runs.find(r => r.title === 'Ma mission')!
  expect(here().waitsUser).toEqual({ since: expect.any(Number), kind: 'question' })
  await $.turn.start({ text: 'la seconde', turnId: 't2' } as any)
  await settle(clock, 2)
  expect(here().waitsUser).toBeUndefined()
  // Un message en file : le tour suivant commence pendant la fin de celui-ci, rien ne se pose derrière lui.
  const ending = $.turn.complete({ answer: 'Et ensuite ?', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' } as any)
  await $.turn.start({ text: 'en file', turnId: 't3' } as any)
  await ending
  await settle(clock, 2)
  expect(here().waitsUser).toBeUndefined()
  // Un tour interrompu ne pose rien.
  await $.turn.complete({ answer: 'Et ensuite ?', durationMs: 10, isAborted: true, turnId: 't3', reason: 'aborted' } as any)
  await settle(clock, 2)
  expect(here().waitsUser).toBeUndefined()
})

test('une question à boutons pendant un tour : la mission attend la validation, le temps que la personne réponde', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const during: unknown[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async () => {
    // Le temps que la personne réponde : la mission enregistrée porte l'attente.
    await settle(clock, 2)
    during.push(stored(w).runs.find(r => r.title === 'Ma mission')?.waitsUser)
    return { result: 'ok' }
  })
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  await settle(clock, 1)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  await settle(clock, 1)
  expect(during).toEqual([{ since: expect.any(Number), kind: 'validation' }])
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.title === 'Ma mission')!.waitsUser).toBeUndefined()
})

test('à la fin d’un tour, la catégorie suit la suggestion grisée : l’étape suivante d’une phase finie, puis le rapport à valider', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Ma mission' } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  const here = () => stored(w).runs.find(r => r.title === 'Ma mission')!
  await $.turn.start({ text: 'x', turnId: 't1' } as any)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await settle(clock, 2)
  expect(here().waitsUser).toEqual({ since: expect.any(Number), kind: 'step' })
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })
  await $.turn.start({ text: 'r', turnId: 't2' } as any)
  await $.turn.complete({ answer: 'Voici le rapport.', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' } as any)
  await settle(clock, 2)
  expect(here().waitsUser).toEqual({ since: expect.any(Number), kind: 'report' })
})

test('l’auto éteint, la mission redevient manuelle : un tour fini sur une question pose le signal', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Éteinte' } as any)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'auto-on' })
  await pane.press({ key: 'auto-confirm' })
  await pane.press({ key: 'auto-off' })
  await pane.unmount()
  await settle(clock, 2)
  await $.turn.start({ text: 'x', turnId: 't1' } as any)
  await $.turn.complete({ answer: 'On garde laquelle ?', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await settle(clock, 2)
  const here = stored(w).runs.find(r => r.title === 'Éteinte')!
  expect(here.auto?.offAt).toBeDefined()
  expect(here.waitsUser).toEqual({ since: expect.any(Number), kind: 'question' })
})

// ─── Le COO ───────────────────────────────────────────────────────────────

test('le COO montre la mission qui l’attend et la notifie une fois par attente ; une mission en pause paraît « en pause, à reprendre »', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const notices = w.notices
  const waiting: Run = { ...newRun('implement', NOW - 9000, 'Mission « ] qui attend'), status: 'active', owner: 'session-B', waitsUser: { since: NOW - 60_000, kind: 'step' } }
  const paused: Run = { ...newRun('implement', NOW - 9000, 'En pause'), status: 'paused' }
  writeBoard(w, b => ({ ...b, runs: [waiting, paused] }))
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/Missions waiting for the user, their turn over and the next step theirs \(1\):/)
  expect(opening).toMatch(/- mission « Mission “ \) qui attend »: the next step, since/)
  await settle(clock, 12)
  expect(notices.filter(n => /elle t'attend/.test(n))).toEqual(['Mission Mission “ ) qui attend : elle t\'attend'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await pane.find({ type: 'Text', text: /La mission « Mission « \] qui attend » t’attend : l’étape suivante, depuis/ }), surface).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^en pause, à reprendre$/ }), surface).toBeDefined()
    await pane.unmount()
  }
  // Le fichier de coordination devenu illisible n'arrête pas la notification d'une nouvelle attente.
  w.coord.unread = true
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === waiting.id ? { ...r, waitsUser: { since: NOW + 20_000, kind: 'report' }, updatedAt: NOW + 20_000 } : r)) }))
  await settle(clock, 12)
  expect(notices.filter(n => /elle t'attend/.test(n))).toHaveLength(2)
  w.coord.unread = false
  // Une nouvelle attente (une autre date) se notifie de nouveau, une fois.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === waiting.id ? { ...r, waitsUser: { since: NOW + 30_000, kind: 'question' }, updatedAt: NOW + 30_000 } : r)) }))
  await settle(clock, 12)
  expect(notices.filter(n => /elle t'attend/.test(n))).toHaveLength(3)
  // Un board d'avant relu ensuite (une attente plus ancienne) : rien ne se renotifie, ni l'ancienne ni la nouvelle.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === waiting.id ? { ...r, waitsUser: { since: NOW + 20_000, kind: 'report' }, updatedAt: NOW + 40_000 } : r)) }))
  await settle(clock, 12)
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === waiting.id ? { ...r, waitsUser: { since: NOW + 30_000, kind: 'question' }, updatedAt: NOW + 50_000 } : r)) }))
  await settle(clock, 12)
  expect(notices.filter(n => /elle t'attend/.test(n))).toHaveLength(3)
})

test('le titre relu d’une mission qui attend ne coupe ni la ligne ni la citation du relevé, pour chaque entrée du corpus hostile', () => {
  const lines = (title: string) => {
    const run: Run = { ...newRun('implement', NOW - 9000, title), status: 'active', waitsUser: { since: NOW, kind: 'report' } }
    return statementText(cooStatement({ ...emptyBoard('', 'p'), runs: [run], activeId: null }, { now: NOW })).split('\n')
  }
  const base = lines('ok')
  const leaks = Object.entries(CORPUS).filter(([, token]) => {
    const got = lines(`a${token}b`)
    return got.length !== base.length || got.join('').split('«').length !== base.join('').split('«').length
  })
  expect(leaks.map(([name]) => name)).toEqual([])
})

test('le COO lit le signal tel que la mission l’a posé : une mission à l’auto allumé mais en pause dans sa discussion paraît et se notifie, une fois', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  // L'auto allumé dans une discussion d'avant (/clear) : en pause dans la nouvelle, qui a posé le signal.
  const lit: Run = { ...newRun('implement', NOW - 9000, 'Allumée ailleurs'), status: 'active', owner: 'session-B', auto: { onAt: NOW - 5000, onBy: 'avant-clear' }, waitsUser: { since: NOW - 60_000, kind: 'question' } }
  const manual: Run = { ...newRun('implement', NOW - 9000, 'En manuel'), status: 'active', owner: 'session-C', waitsUser: { since: NOW - 60_000, kind: 'question' } }
  writeBoard(w, b => ({ ...b, runs: [lit, manual] }))
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/Missions waiting for the user, their turn over and the next step theirs \(2\):/)
  await settle(clock, 12)
  const notified = () => w.notices.filter(n => /elle t'attend/.test(n)).sort()
  expect(notified()).toEqual(["Mission Allumée ailleurs : elle t'attend", "Mission En manuel : elle t'attend"])
  // Les relevés suivants (relecture des 5 s, message au COO) ne les renotifient pas.
  await $.prompt.submit({ text: 'le point ?' } as any)
  await settle(clock, 12)
  expect(notified()).toHaveLength(2)
})

test('en auto actif, rien ne se pose : seules ses questions bloquantes attendent, notifiées par la mission', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'En auto' } as any)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'auto-on' })
  await pane.press({ key: 'auto-confirm' })
  await pane.unmount()
  await settle(clock, 1)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 'consigne', reason: 'answer' } as any)
  await settle(clock, 2)
  await $.turn.start({ text: 'x', turnId: 't1' } as any)
  await $.turn.complete({ answer: 'Je te pose une question ?', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await settle(clock, 2)
  const here = stored(w).runs.find(r => r.title === 'En auto')!
  expect(here.auto?.onAt).toBeDefined()
  expect(here.waitsUser).toBeUndefined()
})

test('à la fin d’un tour, une suite toute retenue par une autre mission ne pose pas « l’étape suivante » : rien à faire avant qu’elle parte', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  // Une autre mission a un groupe confié à un worker sur src/a.ts.
  const other = { ...newRun('implement', NOW - 9000, 'Autre'), status: 'active' as const, owner: 'session-B', tickets: [{ id: 'o1', name: 'O', status: 'todo' as const, files: ['src/a.ts'] }], groups: [{ id: 'A', name: 'A', tickets: ['o1'], files: ['src/a.ts'], linked: { at: NOW - 5000, session: 'w-o' } }, { id: 'B', name: 'B', tickets: [], files: ['src/z.ts'] }] } as unknown as Run
  writeBoard(w, b => ({ ...b, runs: [other] }))
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Ma mission', tickets: [{ id: 't1', name: 'Un', files: ['src/a.ts'] }, { id: 't2', name: 'Deux', files: ['src/a.ts'] }], groups: [{ id: 'A', name: 'Un', tickets: ['t1'] }, { id: 'B', name: 'Deux', tickets: ['t2'] }] } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  const here = () => stored(w).runs.find(r => r.title === 'Ma mission')!
  await $.turn.start({ text: 'x', turnId: 't1' } as any)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  await settle(clock, 2)
  expect(here().phases.find(p => p.skill === 'to-tickets')?.status).toBe('done')
  expect(here().waitsUser).toBeUndefined()
})

test('la fin de la discussion, sa relance et le chargement d’une autre gardent le signal : la mission reste à sa discussion', () => {
  const { board, id } = waitingBoard()
  // Une mission ne vit que dans sa discussion (choix de Mathis du 09/11/2026) : ni la fin
  // de la discussion ni le chargement ne la mettent en pause ; elle attend toujours la personne, et le COO le dit.
  expect(signalOf(parkActive(board, NOW + 1)!.board, id)).toBeDefined()
  expect(signalOf(detachOnLoad(board, NOW + 1, 's'), id)).toBeDefined()
  expect(signalOf(detachOnLoad(board, NOW + 1, 'autre'), id)).toBeDefined()
})
