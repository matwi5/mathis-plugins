// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { AUTO_STOPS, autoPauseLabel, cutAutoOf, emptyBoard, isAutoOn, isCutDue, mergeBoards, newRun, stopLabel } from '../hooks/model.ts'
import { soundEntry } from '../hooks/coordination.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// Couper l'auto d'une mission depuis la vue Coordination ou par le Claude du COO. Invariant : « L'auto
// d'une mission ne s'allume jamais sans un clic de Mathis […] » ; une coupure ne fait qu'éteindre.

const T0 = 400_000_000

/** Une mission en auto d'une autre discussion. */
const autoMission = (now: number, auto: Record<string, unknown> = { onAt: now - 30_000, onBy: 'session-B' }): Run =>
  ({ ...newRun('implement', now - 60_000, 'Mission de B'), status: 'active', owner: 'session-B', updatedAt: now - 1_000, auto }) as unknown as Run

const boardOf = (run: Run): Board => ({ ...emptyBoard('', 'p'), deleted: [], runs: [run], activeId: run.id })

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

// ─── Le modèle ────────────────────────────────────────────────────────────

test('« coupé par le COO » est une raison connue, montrée comme une pause ; la coupure éteint un auto allumé', () => {
  expect(AUTO_STOPS.coo).toBe('coupé par le COO')
  expect(stopLabel(AUTO_STOPS.coo)).toBe('coupé par le COO')
  const run = autoMission(T0)
  const out = cutAutoOf(boardOf(run), run.id, AUTO_STOPS.coo, T0, T0 + 5)
  const after = out!.board.runs[0]!
  expect(isAutoOn(after)).toBe(false)
  expect(after.auto).toMatchObject({ offWhy: 'coupé par le COO', offAt: T0 + 5 })
  expect(autoPauseLabel(after)).toBe('coupé par le COO')
  // Rejouée : rien de plus.
  expect(cutAutoOf(out!.board, run.id, AUTO_STOPS.coo, T0, T0 + 9)).toBeNull()
  // Un clic « coupé par toi » : un geste, pas une pause montrée.
  const clicked = cutAutoOf(boardOf(run), run.id, AUTO_STOPS.click, T0, T0 + 5)!.board.runs[0]!
  expect(clicked.auto).toMatchObject({ offWhy: 'coupé par toi' })
  expect(autoPauseLabel(clicked)).toBeUndefined()
})

test('une coupure remplace la raison d’une pause « plus rien ne peut avancer sans toi » et avance « éteint à »', () => {
  const run = autoMission(T0, { onAt: T0 - 30_000, onBy: 'session-B', offAt: T0 - 10_000, offWhy: AUTO_STOPS.stuck })
  for (const why of [AUTO_STOPS.coo, AUTO_STOPS.click]) {
    const after = cutAutoOf(boardOf(run), run.id, why, T0, T0)!.board.runs[0]!
    expect(after.auto).toMatchObject({ offWhy: why, offAt: T0 })
    expect(after.auto!.onAt).toBe(T0 - 30_000)
    expect(isAutoOn(after)).toBe(false)
  }
})

test('aucune coupure n’allume : auto déjà éteint par un geste, jamais allumé, ou rallumé après la coupure', () => {
  const off = autoMission(T0, { onAt: T0 - 30_000, onBy: 'session-B', offAt: T0 - 20_000, offWhy: AUTO_STOPS.click })
  const never = { ...autoMission(T0), auto: undefined } as Run
  const relit = autoMission(T0, { onAt: T0 + 1_000, onBy: 'session-B', offAt: T0 - 5_000, offWhy: AUTO_STOPS.coo })
  for (const run of [off, never, relit]) {
    expect(isCutDue(run, AUTO_STOPS.coo, T0)).toBe(false)
    expect(cutAutoOf(boardOf(run), run.id, AUTO_STOPS.coo, T0, T0 + 2_000)).toBeNull()
  }
  // Une copie plus ancienne, encore allumée, fusionnée avec la copie coupée : l'auto reste éteint.
  const run = autoMission(T0)
  const cut = cutAutoOf(boardOf(run), run.id, AUTO_STOPS.coo, T0, T0 + 5)!.board
  for (const merged of [mergeBoards(cut, boardOf(run)), mergeBoards(boardOf(run), cut)]) expect(isAutoOn(merged.runs[0]!)).toBe(false)
})

test('une entrée « cutAuto » se relit bornée : un auteur hors liste ou une mission hors forme ne s’appliquent pas', () => {
  expect(soundEntry({ id: 'cabc1234', kind: 'cutAuto', run: 'r1', at: T0, by: 'coo' })).toEqual({ id: 'cabc1234', kind: 'cutAuto', run: 'r1', at: T0, by: 'coo' })
  expect(soundEntry({ id: 'cabc1234', kind: 'cutAuto', run: 'r1', at: T0, by: 'personne', extra: 1 })).toBeNull()
  expect(soundEntry({ id: 'cabc1234', kind: 'cutAuto', run: '../x', at: T0, by: 'click' })).toBeNull()
})

// ─── Chez le COO ──────────────────────────────────────────────────────────

test('chez le COO, une mission en auto porte « ✋ Couper l’auto » ; le clic écrit une coupure, une seule fois', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = autoMission(T0)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect((await pane.find({ key: `coo-cut-auto-${run.id}` }))?.props.label).toMatch(/Couper l’auto/)
  await pane.press({ key: `coo-cut-auto-${run.id}` })
  await pane.unmount()
  await settle(clock, 2)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'cutAuto', run: run.id, by: 'click' })])
  expect(w.toasts.join('\n')).toMatch(/Coupure notée : « Mission de B » coupe son auto d’elle-même/)
  // Un second clic avant que la mission l'applique : rien de plus.
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await again.press({ key: `coo-cut-auto-${run.id}` })
  await again.unmount()
  await settle(clock, 2)
  expect(entries(w)).toHaveLength(1)
  // Le COO ne touche jamais l'état auto de la mission lui-même.
  expect(stored(w).runs.find(r => r.id === run.id)!.auto).toEqual(run.auto)
})

test('chez le COO, une mission en pause montre « ✋ Manuel · <raison> » ; éteinte sans raison, « ✋ Manuel » seul, sans bouton de coupure', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const paused = autoMission(T0, { onAt: T0 - 30_000, onBy: 'session-B', offAt: T0 - 2_000, offWhy: AUTO_STOPS.stuck })
  const cut = { ...autoMission(T0, { onAt: T0 - 30_000, onBy: 'session-C', offAt: T0 - 2_000, offWhy: AUTO_STOPS.click }), title: 'Mission de C', owner: 'session-C' } as Run
  writeBoard(w, b => ({ ...b, runs: [paused, cut] }))
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const all = await texts(pane)
  expect(all).toMatch(/✋\sManuel · plus rien ne peut avancer sans toi/)
  expect(all.split('\n').filter(t => /^✋\sManuel$/.test(t))).toHaveLength(1)
  expect(await pane.find({ key: `coo-cut-auto-${paused.id}` })).toBeUndefined()
  expect(await pane.find({ key: `coo-cut-auto-${cut.id}` })).toBeUndefined()
  await pane.unmount()
  // Au terminal, la même ligne.
  const term = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await texts(term)).toMatch(/Manuel · plus rien ne peut avancer sans toi/)
  await term.unmount()
})

test('« coordinate.cutAuto » : le Claude du COO coupe une mission en auto ou en pause, jamais une mission éteinte par un geste', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const lit = autoMission(T0)
  const paused = { ...autoMission(T0, { onAt: T0 - 30_000, onBy: 'session-C', offAt: T0 - 2_000, offWhy: AUTO_STOPS.stuck }), title: 'Mission de C', owner: 'session-C' } as Run
  const off = { ...autoMission(T0, { onAt: T0 - 30_000, onBy: 'session-D', offAt: T0 - 2_000, offWhy: AUTO_STOPS.click }), title: 'Mission de D', owner: 'session-D' } as Run
  writeBoard(w, b => ({ ...b, runs: [lit, paused, off] }))
  await start($)
  await openCoo($, clock)
  const call = async (mission: string) => String(((await $.tool.call({ tool: TOOL, coordinate: { cutAuto: [{ mission }] } } as any)) as any).result)
  const said = await call(lit.id)
  expect(said).toMatch(/Auto cut recorded/)
  expect(said).toMatch(/Tell the user/)
  expect(await call(paused.id)).toMatch(/Auto cut recorded/)
  expect(await call(off.id)).toMatch(/already off/)
  expect(await call(lit.id)).toMatch(/already recorded/)
  expect(await call('inconnue')).toMatch(/not in the missions file/)
  expect(entries(w).map(e => [e.kind, e.run, e.by])).toEqual([
    ['cutAuto', lit.id, 'coo'],
    ['cutAuto', paused.id, 'coo'],
  ])
})

// ─── Chez le manager : le mod applique la coupure, une fois ───────────────

/** Ouvre une mission ici et allume son auto des deux clics, comme la personne. */
const openLit = async ($: any, clock: any, w: ReturnType<typeof world>): Promise<string> => {
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  await settle(clock, 1)
  for (const key of ['auto-on', 'auto-confirm']) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
    await pane.press({ key })
    await pane.unmount()
  }
  await settle(clock, 2)
  const id = stored(w).activeId!
  expect(isAutoOn(stored(w).runs.find(r => r.id === id)!)).toBe(true)
  return id
}

test('le mod de la mission applique une coupure du COO : l’auto s’éteint, raison « coupé par le COO », une fois ; rejouée, rien ne bouge', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openLit($, clock, w)
  const onAt = stored(w).runs.find(r => r.id === runId)!.auto!.onAt!
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'cutAuto', run: runId, at: onAt + 1, by: 'coo' }])
  await settle(clock, 6)
  const run = stored(w).runs.find(r => r.id === runId)!
  expect(isAutoOn(run)).toBe(false)
  expect(run.auto).toMatchObject({ offWhy: 'coupé par le COO' })
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
  const offAt = run.auto!.offAt
  await settle(clock, 10)
  expect(stored(w).runs.find(r => r.id === runId)!.auto!.offAt).toBe(offAt)
  // Le manager n'écrit jamais le fichier de coordination.
  expect(w.coord.writes).toEqual([])
})

test('une coupure plus ancienne que l’allumage en cours, ou forgée, ne coupe rien et n’allume rien', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openLit($, clock, w)
  const onAt = stored(w).runs.find(r => r.id === runId)!.auto!.onAt!
  w.coord.text = coordFile([
    { id: 'cabc1234', kind: 'cutAuto', run: runId, at: onAt - 1, by: 'click' },
    { id: 'cdef5678', kind: 'cutAuto', run: runId, at: onAt + 1, by: 'allume' },
  ])
  await settle(clock, 6)
  expect(isAutoOn(stored(w).runs.find(r => r.id === runId)!)).toBe(true)
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
})

test('une coupure sur une mission déjà éteinte par un clic : notée appliquée, l’auto reste éteint', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openLit($, clock, w)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'auto-off' })
  await pane.unmount()
  await settle(clock, 2)
  const before = stored(w).runs.find(r => r.id === runId)!.auto
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'cutAuto', run: runId, at: (before!.offAt ?? 0) + 1, by: 'coo' }])
  await settle(clock, 6)
  const run = stored(w).runs.find(r => r.id === runId)!
  expect(isAutoOn(run)).toBe(false)
  expect(run.auto).toEqual(before)
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
})

test('une coupure datée loin dans le futur attend : elle ne coupe pas l’auto en cours et ne se note pas appliquée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openLit($, clock, w)
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'cutAuto', run: runId, at: T0 + 86_400_000, by: 'coo' }])
  await settle(clock, 6)
  expect(isAutoOn(stored(w).runs.find(r => r.id === runId)!)).toBe(true)
  expect(w.mem[`coo-applied:${runId}`] ?? []).toEqual([])
  // La relecture tourne bien : une coupure datée de maintenant, ajoutée au même fichier, s'applique, seule.
  w.coord.text = coordFile([
    { id: 'cabc1234', kind: 'cutAuto', run: runId, at: T0 + 86_400_000, by: 'coo' },
    { id: 'cdef5678', kind: 'cutAuto', run: runId, at: T0 + 10_000, by: 'coo' },
  ])
  await settle(clock, 6)
  expect(isAutoOn(stored(w).runs.find(r => r.id === runId)!)).toBe(false)
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cdef5678'])
})

test('chez le COO, une coupure datée loin dans le futur ne compte pas comme déjà notée : une nouvelle coupure s’écrit', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = autoMission(T0)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'cutAuto', run: run.id, at: T0 + 86_400_000, by: 'coo' }])
  await start($)
  await openCoo($, clock)
  const said = String(((await $.tool.call({ tool: TOOL, coordinate: { cutAuto: [{ mission: run.id }] } } as any)) as any).result)
  expect(said).toMatch(/Auto cut recorded/)
  expect(entries(w)).toHaveLength(2)
})
