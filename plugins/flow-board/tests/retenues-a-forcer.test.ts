// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { cooPoint, cooStatement, statementText } from '../hooks/coo.ts'
import { cooBandParts } from '../hooks/coo-view.tsx'
import { NIGHT_DEAD_MS, isPairDead, nightBlocks, type NightMissionView } from '../hooks/night.ts'
import { relayFileSlug } from '../hooks/closing.ts'
import { relayEntryFileName } from '../hooks/relay.ts'
import { PANE, PLUGIN, entries, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'

// Les retenues « à forcer » de la vue du COO. Invariant : « La marque « à forcer » ne se pose jamais sur une retenue
// dont la mission attendue est ouverte dans une discussion, dont le worker n'a pas de fin lisible ou a fini depuis
// moins de 30 minutes ; et la surveillance de nuit rend les mêmes blocages qu'avant ce ticket. »

const T0 = 300_000_000
const NOW = T0 + 3 * 3_600_000

const mission = (title: string, at: number, report: Record<string, unknown>): Run => {
  const run = newRun('implement', at, title)
  const board: Board = { ...emptyBoard('/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return { ...(applyReport(board, report, at + 1).board.runs[0] as Run), status: 'active' }
}
const twoGroups = (title: string, at: number, files: [string, string]) =>
  mission(title, at, {
    tickets: [
      { id: 't1', name: 'Un', files: [files[0]] },
      { id: 't2', name: 'Deux', files: [files[1]] },
    ],
    groups: [
      { id: 'A', name: 'Alpha', tickets: ['t1'] },
      { id: 'B', name: 'Bêta', tickets: ['t2'] },
    ],
  })
const sent = (run: Run, id: string): Run => ({ ...run, groups: run.groups!.map(g => (g.id === id ? { ...g, linked: { at: T0 } } : g)) })
const boardOf = (...runs: Run[]): Board => ({ ...emptyBoard('/p', 'p'), session: 's', deleted: [], runs, activeId: runs[0]!.id })

/** « Retenue » (groupe A) attend le groupe A de « Occupée », ouverte nulle part sauf `owner` donné. */
const pair = (owner?: string) => {
  const held = { ...twoGroups('Retenue', T0, ['x.ts', 'y.ts']), owner: 'session-B' }
  const busy = { ...sent(twoGroups('Occupée', T0, ['x.ts', 'q.ts']), 'A'), owner }
  return { held, busy, board: boardOf(held, busy) }
}
const deadAt = (run: string, group: string, at: number) => (m: string, g: string) => (m === run && g === group ? at : undefined)

test('le test d’une paire, le seul : ouverte nulle part, un worker, fini depuis plus de 30 minutes', () => {
  expect(isPairDead({ isOpen: false }, 'A', NOW - NIGHT_DEAD_MS - 1, NOW)).toBe(true)
  // Ouverte dans une discussion, absente, lot sans groupes, sans fin lisible, fin trop récente (30 min pile compris) : non.
  expect(isPairDead({ isOpen: true }, 'A', NOW - NIGHT_DEAD_MS - 1, NOW)).toBe(false)
  expect(isPairDead(undefined, 'A', NOW - NIGHT_DEAD_MS - 1, NOW)).toBe(false)
  expect(isPairDead({ isOpen: false }, '*', NOW - NIGHT_DEAD_MS - 1, NOW)).toBe(false)
  expect(isPairDead({ isOpen: false }, 'A', undefined, NOW)).toBe(false)
  expect(isPairDead({ isOpen: false }, 'A', NOW - NIGHT_DEAD_MS, NOW)).toBe(false)
})

test('marque « à forcer » : mission attendue ouverte nulle part, fin lisible de plus de 30 minutes, avec la date', () => {
  const { busy, board } = pair()
  const since = NOW - 52 * 60_000
  const s = cooStatement(board, { now: NOW, deadSince: deadAt(busy.id, 'A', since) })
  expect(s.holds).toEqual([expect.objectContaining({ run: busy.id, group: 'A', deadSince: since, isToForce: true })])
})

test('grise : mission attendue ouverte dans une discussion', () => {
  const { busy, board } = pair('session-C')
  const s = cooStatement(board, { now: NOW, deadSince: deadAt(busy.id, 'A', NOW - 52 * 60_000) })
  expect(s.holds).toHaveLength(1)
  expect(s.holds[0]!.isToForce).toBeUndefined()
})

test('grise : fin de moins de 30 minutes (la date reste au relevé)', () => {
  const { busy, board } = pair()
  const since = NOW - 10 * 60_000
  const s = cooStatement(board, { now: NOW, deadSince: deadAt(busy.id, 'A', since) })
  expect(s.holds[0]).toEqual(expect.objectContaining({ deadSince: since }))
  expect(s.holds[0]!.isToForce).toBeUndefined()
})

test('grise : relais illisible ou sans signe sûr de fin (aucune date), et sans lecture du tout', () => {
  const { board } = pair()
  for (const s of [cooStatement(board, { now: NOW, deadSince: () => undefined }), cooStatement(board, { now: NOW })]) {
    expect(s.holds).toHaveLength(1)
    expect(s.holds[0]!.isToForce).toBeUndefined()
    expect(s.holds[0]!.deadSince).toBeUndefined()
  }
})

test('grise : la retenue attend le lot sans groupes (« * ») d’une mission', () => {
  const { busy, board } = pair()
  // La forme d'une retenue d'un lot : le relevé reçoit une date pour « * » (jamais en vrai), la marque reste grise.
  const lot: Run = { ...busy, groups: [] }
  const s = cooStatement(boardOf(board.runs[0]!, lot), { now: NOW, deadSince: () => NOW - 52 * 60_000 })
  const lots = s.holds.filter(h => h.group === '*')
  expect(lots.length).toBeGreaterThan(0)
  for (const h of lots) expect(h.isToForce).toBeUndefined()
})

test('grise : mission attendue absente du fichier des missions ; « à forcer » : mission attendue close dont le groupe lié retient encore', () => {
  const { busy, board } = pair()
  // Absente : le test d'une paire ne la connaît pas.
  expect(isPairDead(undefined, 'A', NOW - 52 * 60_000, NOW)).toBe(false)
  // Close, son groupe encore lié : ouverte nulle part, plus aucun manager ne lève la retenue.
  const closed = cooStatement(boardOf(board.runs[0]!, { ...busy, status: 'done' }), { now: NOW, deadSince: deadAt(busy.id, 'A', NOW - 52 * 60_000) })
  expect(closed.holds.length).toBeGreaterThan(0)
  for (const h of closed.holds) expect(h.isToForce).toBe(true)
})

test('une mission rouverte ou un worker relancé fait redevenir grise une retenue marquée', () => {
  const { busy, board } = pair()
  const marked = cooStatement(board, { now: NOW, deadSince: deadAt(busy.id, 'A', NOW - 52 * 60_000) })
  expect(marked.holds[0]!.isToForce).toBe(true)
  const reopened = boardOf(board.runs[0]!, { ...busy, owner: 'session-C' })
  expect(cooStatement(reopened, { now: NOW, deadSince: deadAt(busy.id, 'A', NOW - 52 * 60_000) }).holds[0]!.isToForce).toBeUndefined()
  // Relancé : son activité relayée récente devient la date lue, de moins de 30 minutes.
  expect(cooStatement(board, { now: NOW, deadSince: deadAt(busy.id, 'A', NOW - 60_000) }).holds[0]!.isToForce).toBeUndefined()
})

test('grise : une date lue avant le lien en cours du groupe attendu (worker relancé depuis la lecture) n’est pas sa fin', () => {
  const { busy, board } = pair()
  const relinked: Run = { ...busy, groups: busy.groups!.map(g => (g.id === 'A' ? { ...g, linked: { at: NOW - 60_000 } } : g)) }
  const s = cooStatement(boardOf(board.runs[0]!, relinked), { now: NOW, deadSince: deadAt(busy.id, 'A', NOW - 52 * 60_000) })
  expect(s.holds).toHaveLength(1)
  expect(s.holds[0]!.isToForce).toBeUndefined()
  expect(s.holds[0]!.deadSince).toBeUndefined()
})

test('les comptes (en-tête, point, bandeau) comptent les retenues « à forcer », pas les grises', () => {
  const { busy, board } = pair()
  const grey = cooStatement(board, { now: NOW })
  expect(cooPoint(grey)[1]).toBe('Rien ne t’attend.')
  expect(JSON.stringify(cooBandParts(grey, undefined))).not.toMatch(/t’attend/)
  const marked = cooStatement(board, { now: NOW, deadSince: deadAt(busy.id, 'A', NOW - 52 * 60_000) })
  expect(cooPoint(marked)[1]).toBe('1 chose t’attend : 1 retenue à forcer (Retenue).')
  expect(JSON.stringify(cooBandParts(marked, undefined))).toMatch(/1 t’attend/)
})

test('le relevé du COO dit la date de fin et la marque, sans jamais dire qu’un forçage est sans risque', () => {
  const { busy, board } = pair()
  const text = statementText(cooStatement(board, { now: NOW, deadSince: deadAt(busy.id, 'A', NOW - 52 * 60_000) }))
  expect(text).toMatch(/its worker finished 52 min ago/)
  expect(text).toMatch(/« à forcer »/)
  expect(text).not.toMatch(/safe|sans risque/i)
})

test('la nuit rend les mêmes blocages : une paire morte force, une paire ouverte, récente, sans date ou au lot ne force pas', () => {
  const view = (id: string, over: Partial<NightMissionView> = {}): NightMissionView => ({ id, title: id, isAuto: false, isPaused: false, isOpen: false, isEnded: false, isRelaunchPause: false, heldByUser: [], hasOpenGroups: true, questions: [], waveDue: [], holds: [], ...over })
  const held = view('m1', { isAuto: true, isOpen: true, holds: [{ held: 'A', mission: 'm2', group: 'B', isPlan: false }] })
  const old = (m: string, g: string) => (m === 'm2' && g === 'B' ? NOW - NIGHT_DEAD_MS - 1 : undefined)
  expect(nightBlocks([held, view('m2')], old, NOW)).toEqual([{ mission: 'm1', title: 'm1', act: 'force', group: 'A', awaited: [{ mission: 'm2', group: 'B' }] }])
  expect(nightBlocks([held, view('m2', { isOpen: true })], old, NOW)).toEqual([])
  expect(nightBlocks([held, view('m2')], () => NOW - NIGHT_DEAD_MS, NOW)).toEqual([])
  expect(nightBlocks([held, view('m2')], () => undefined, NOW)).toEqual([])
  expect(nightBlocks([{ ...held, holds: [{ held: 'A', mission: 'm2', group: '*', isPlan: false }] }, view('m2')], () => NOW - NIGHT_DEAD_MS - 1, NOW)).toEqual([])
})

/** La clé du « ⇥ Forcer » d'une paire : elle nomme la paire, pas sa place dans la liste. */
const forceKey = (mission: string, held: string, run: string, group = 'A', on = 'file') => `coo-force-${[mission, held, run, group, on].join('~')}`

const texts = async (ui: any): Promise<string> => (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '')).join(' | ')

/** Le relais du worker du groupe A de `run`, sa session finie à `ended`. */
const relayOf = (w: World, run: Run, ended: number, at = T0 + 1000) => {
  const relay = { v: 1, run: run.id, sessions: { 'sess-w': { group: 'A', tickets: { t1: { status: 'doing', at: T0 + 1000 } }, commits: 0, startedAt: T0 + 500, at, endedAt: ended } } }
  w.files[`flow-board/relais/${relayFileSlug(run.id)}.json`] = JSON.stringify(relay)
  w.mem[`relay:${run.id}`] = relay
}

test('la vue : les retenues dans le couloir de la mission qui attend, « à forcer » d’abord avec son temps et « ⇥ Forcer » principal, puis les grises ; plus d’en-tête des retenues', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const held = { ...twoGroups('Retenue', T0, ['x.ts', 'y.ts']), owner: 'session-B' }
  // « Occupée » ouverte nulle part, son worker fini il y a 52 minutes ; « Ailleurs » ouverte dans une discussion.
  const busy = { ...sent(twoGroups('Occupée', T0, ['x.ts', 'q.ts']), 'A'), owner: undefined }
  const open = { ...sent(twoGroups('Ailleurs', T0, ['y.ts', 'r.ts']), 'A'), owner: 'session-C' }
  writeBoard(w, b => ({ ...b, runs: [held, open, busy] }))
  relayOf(w, busy, NOW - 52 * 60_000)
  relayOf(w, open, NOW - 52 * 60_000)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await pane.press({ key: 'coo-page-overview' })
    const all = await texts(pane)
    expect(all, surface).not.toMatch(/Retenues entre missions/)
    // Comptée par la pastille « Vue d'ensemble » : la seule « à forcer ».
    expect(String((await pane.find({ key: 'coo-page-overview' }))?.props.label).replace(/\u00a0/g, ' '), surface).toMatch(/Vue d'ensemble · 1$/)
    // La retenue « à forcer » d'abord, puis la grise, toutes deux dans le couloir de la mission qui attend, après l'en-tête des missions.
    const first = all.indexOf('à\u00a0forcer')
    expect(first, surface).toBeGreaterThan(all.indexOf('Missions'))
    expect(all.indexOf('« Occupée »', first), surface).toBeGreaterThan(first)
    expect(all.indexOf('« Ailleurs »', first), surface).toBeGreaterThan(all.indexOf('« Occupée »', first))
    expect(all, surface).toMatch(/son worker a fini depuis 52 min/)
    expect(all, surface).not.toMatch(/sans risque/)
    expect((await pane.find({ key: forceKey(held.id, 'A', busy.id) }))?.props.variant, surface).toBe('primary')
    const grey = await pane.find({ key: forceKey(held.id, 'B', open.id) })
    expect([grey?.props.plain, grey?.props.variant], surface).toEqual([undefined, undefined])
    await pane.unmount()
  }
  // Le relevé porte la date de fin de chaque retenue, la mission attendue ouverte comprise (sans la marque).
  const said = JSON.stringify(await $.prompt.submit({ text: 'et alors ?', origin: { kind: 'composer' } } as any))
  expect(said).toMatch(/group « B », waits for group « A » of mission « Ailleurs » \(file in common: « y\.ts »\); its worker finished 52 min ago; the user/)
  expect(said).toMatch(/mission « Occupée » \(file in common: « x\.ts »\); its worker finished 52 min ago, and its mission is open nowhere: marked « à forcer »/)
  // « ⇥ Forcer » de la retenue grise ne change pas : le geste écrit l'entrée de forçage de cette paire.
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-page-overview' })
  await pane.press({ key: forceKey(held.id, 'B', open.id) })
  await pane.unmount()
  await settle(clock, 2)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'force', run: held.id, held: 'B', awaited: { run: open.id, group: 'A' } })])
})

test('par le vrai relais : un worker relancé ou un fichier de relais illisible fait redevenir grise une retenue « à forcer »', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const held = { ...twoGroups('Retenue', T0, ['x.ts', 'y.ts']), owner: 'session-B' }
  const busy = { ...sent(twoGroups('Occupée', T0, ['x.ts', 'q.ts']), 'A'), owner: undefined }
  writeBoard(w, b => ({ ...b, runs: [held, busy] }))
  relayOf(w, busy, NOW - 52 * 60_000)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const seen = async () => {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
    await pane.press({ key: 'coo-page-overview' })
    const all = await texts(pane)
    const pill = String((await pane.find({ key: 'coo-page-overview' }))?.props.label).replace(/\u00a0/g, ' ')
    await pane.unmount()
    return `${pill}\n${all}`
  }
  expect(await seen()).toMatch(/à forcer/)
  // Le worker relancé : sa session reprend, son activité relayée date d'une minute.
  relayOf(w, busy, NOW - 52 * 60_000, NOW + 5000)
  await settle(clock, 6)
  expect(await seen(), 'relancé').not.toMatch(/à forcer/)
  expect(await seen()).toMatch(/Vue d'ensemble · 0\n/)
  // De nouveau finie depuis longtemps, mais le fichier d'une autre session du groupe ne se lit pas : aucune date, grise.
  relayOf(w, busy, NOW - 52 * 60_000)
  w.files[`flow-board/relais/${relayEntryFileName(busy.id, 'sess-x')}`] = '{coupé'
  w.probe.list = dir => (dir.endsWith('/flow-board/relais') && `flow-board/relais/${relayEntryFileName(busy.id, 'sess-x')}` in w.files ? [relayEntryFileName(busy.id, 'sess-x')] : undefined)
  // Sous `$.store`, la même entrée est une clé qui ne se lit pas.
  const key = `relay:${busy.id}:sess-x`
  w.mem[key] = {}
  w.probe.refuseRead = k => k === key && key in w.mem
  await settle(clock, 6)
  expect(await seen(), 'illisible').not.toMatch(/à forcer/)
  delete w.files[`flow-board/relais/${relayEntryFileName(busy.id, 'sess-x')}`]
  delete w.mem[key]
  await settle(clock, 6)
  expect(await seen()).toMatch(/à forcer/)
  // Une entrée qui se lit mais hors forme : comptée comme illisible, grise.
  w.mem[key] = { pas: 'une entrée' }
  w.probe.refuseRead = undefined
  await settle(clock, 6)
  expect(await seen(), 'hors forme').not.toMatch(/à forcer/)
})
