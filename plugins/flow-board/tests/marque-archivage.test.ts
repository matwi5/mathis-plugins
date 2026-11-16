// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { archiveAwaiting, archiveMarkOf, archiveRun, closeDelivered, emptyBoard, mergeBoards, newRun, paneArchiveMark, resumeRun, unarchiveRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// La marque du chemin d'un archivage (`archivedBy`). Invariant : « Une mission ne porte la marque d'un archivage par clic
// ou par rétro que si elle a été archivée par ce chemin ; la marque part avec l'archivage ; une marque absente ou
// illisible ne fait jamais fermer une discussion d'office ; et un archivage fait ailleurs sur une mission close n'est
// jamais défait par la copie de sa discussion, tandis qu'une mission en cours n'est jamais archivée sous elle. »

const T0 = 950_000_000
const MIN = 60_000

const pane = (key: string) => ({ plugin: PLUGIN, surface: 'desktop' as const, ...PANE, key })
const closed = (title: string, extra: Partial<Run> = {}): Run => ({ ...newRun('prototype', T0 - 10 * MIN, title), status: 'done', finishedAt: T0 - 9 * MIN, updatedAt: T0 - 9 * MIN, ...extra })
const boardOf = (runs: Run[], session = 'session-A'): Board => ({ ...emptyBoard('', 'p'), runs, activeId: null, session })

test('archiveRun pose la marque de son appelant dans la même écriture que la date ; sans chemin, aucune', () => {
  const m = closed('M')
  const marked = archiveRun(boardOf([m]), m.id, T0, undefined, 'clic')!.board.runs[0]!
  expect(marked.archivedAt).toBe(T0)
  expect(marked.archivedBy).toEqual({ by: 'clic', at: T0 })
  expect(archiveMarkOf(marked)).toBe('clic')
  // Le chemin de la fin d'une rétro est déjà accepté.
  expect(archiveMarkOf(archiveRun(boardOf([m]), m.id, T0, undefined, 'retro')!.board.runs[0]!)).toBe('retro')
  // Un appelant qui ne dit rien (`/flow reset`) : la date seule.
  const plain = archiveRun(boardOf([m]), m.id, T0)!.board.runs[0]!
  expect(plain.archivedAt).toBe(T0)
  expect(plain.archivedBy).toBeUndefined()
  expect(archiveMarkOf(plain)).toBeUndefined()
})

test('une mission en cours ailleurs n’est jamais archivée, avec ou sans chemin ; celle que cette discussion tient (/flow reset) l’est, sans marque', () => {
  const m = { ...closed('M'), status: 'active' as const, owner: 'session-B' }
  expect(archiveRun(boardOf([m]), m.id, T0, undefined, 'clic')).toBeNull()
  expect(archiveRun(boardOf([m]), m.id, T0)).toBeNull()
  const held = { ...m, owner: 'session-A' }
  const here = { ...boardOf([held]), activeId: held.id }
  expect(archiveRun(here, held.id, T0, undefined, 'clic')).toBeNull()
  const reset = archiveRun(here, held.id, T0)!.board.runs[0]!
  expect(reset.archivedAt).toBe(T0)
  expect(reset.archivedBy).toBeUndefined()
})

test('fusion · archivée ici sur une copie qui ne voyait pas encore sa reprise ailleurs : la copie en cours l’emporte, sans date ni marque d’archivage', () => {
  const m = closed('M')
  // B reprend M à T0 ; A, qui ne l'a pas encore relue, l'archive à T0 + 300 ms (« ▣ Archiver », marque « clic »).
  const resumed = { ...m, status: 'active' as const, owner: 'session-B', updatedAt: T0 }
  const archived = archiveRun(boardOf([m]), m.id, T0 + 300, undefined, 'clic')!.board
  // Côté B, la mission reprise est celle que sa discussion montre (`activeId`).
  const inB = { ...boardOf([resumed], 'session-B'), activeId: m.id }
  for (const merged of [mergeBoards(archived, inB), mergeBoards(inB, archived)]) {
    const out = merged.runs[0]!
    expect(out.status).toBe('active')
    expect(out.archivedAt).toBeUndefined()
    expect(archiveMarkOf(out)).toBeUndefined()
  }
  // Une copie en cours plus ancienne que le travail d'ici avant l'archivage (B resté muet ; reprise ici, close puis
  // archivée) ne reprend rien : le travail d'ici et son archivage restent.
  const worked = { ...m, log: [{ at: T0 + 100, glyph: '★', text: 'Mission close', tone: 'ok' as const }, ...m.log], finishedAt: T0 + 100, updatedAt: T0 + 100 }
  const archivedAfterWork = archiveRun(boardOf([worked]), m.id, T0 + 200, undefined, 'clic')!.board
  const kept = mergeBoards(archivedAfterWork, inB).runs[0]!
  expect(kept.archivedAt).toBe(T0 + 200)
  expect(kept.finishedAt).toBe(T0 + 100)
  // Un autre processus de cette même discussion (sa prise, d'un autre démarrage) tient la copie en cours : elle l'emporte aussi.
  const otherProcess = { ...resumed, owner: 'session-A', claim: { boot: 'terminal', at: T0 } } as Run
  const app = { ...archived, boot: 'app' }
  const held = mergeBoards(app, boardOf([otherProcess], 'session-A')).runs[0]!
  expect(held.status).toBe('active')
  expect(held.archivedAt).toBeUndefined()
  // Une copie relue close (pas en cours) ne retient rien : l'archivage plus récent d'ici l'emporte.
  const closedThere = { ...m, updatedAt: T0 }
  expect(mergeBoards(archived, boardOf([closedThere], 'session-B')).runs[0]!.archivedAt).toBe(T0 + 300)
})

test('désarchiver et reprendre effacent la date et la marque dans la même écriture', () => {
  const m = closed('M')
  const archived = archiveRun(boardOf([m]), m.id, T0, undefined, 'clic')!.board
  const out = unarchiveRun(archived, m.id, T0 + MIN)!.board.runs[0]!
  expect(out.archivedAt).toBeUndefined()
  expect(out.archivedBy).toBeUndefined()
  const resumed = resumeRun(archived, m.id, T0 + MIN)!.board.runs[0]!
  expect(resumed.archivedAt).toBeUndefined()
  expect(resumed.archivedBy).toBeUndefined()
})

test('archivée de nouveau, la mission reçoit la marque du nouveau chemin : clic, puis reset, plus de marque', () => {
  const m = closed('M')
  const first = archiveRun(boardOf([m]), m.id, T0, undefined, 'clic')!.board
  const back = unarchiveRun(first, m.id, T0 + MIN)!.board
  const reset = archiveRun(back, m.id, T0 + 2 * MIN)!.board.runs[0]!
  expect(reset.archivedAt).toBe(T0 + 2 * MIN)
  expect(archiveMarkOf(reset)).toBeUndefined()
  // Une marque laissée par une version d'avant (désarchivage qui ne l'efface pas) : l'archivage sans chemin la retire.
  const leftover = { ...m, archivedBy: { by: 'clic', at: T0 } } as Run
  expect(archiveRun(boardOf([leftover]), m.id, T0 + 3 * MIN)!.board.runs[0]!.archivedBy).toBeUndefined()
})

test('relue du fichier, une marque d’une autre valeur, d’un autre type, d’une autre date, ou sans date d’archivage se lit comme absente', () => {
  const at = T0
  const archived = (archivedBy: unknown, archivedAt: unknown = at) => ({ ...closed('M'), archivedAt, archivedBy }) as unknown as Run
  expect(archiveMarkOf(archived({ by: 'clic', at }))).toBe('clic')
  // Une autre valeur.
  expect(archiveMarkOf(archived({ by: 'click', at }))).toBeUndefined()
  expect(archiveMarkOf(archived({ by: 'rétro', at }))).toBeUndefined()
  // Un autre type.
  for (const bad of ['clic', 42, true, null, [], { by: 42, at }, { by: 'clic', at: String(at) }]) expect(archiveMarkOf(archived(bad))).toBeUndefined()
  // La marque d'un archivage précédent (une autre date).
  expect(archiveMarkOf(archived({ by: 'clic', at: at - 1 }))).toBeUndefined()
  // Sans date d'archivage, ou une date illisible : ignorée.
  expect(archiveMarkOf({ ...closed('M'), archivedBy: { by: 'clic', at } } as Run)).toBeUndefined()
  expect(archiveMarkOf(archived({ by: 'clic', at: Number.NaN }, Number.NaN))).toBeUndefined()
})

test('« ▣ Archiver » : clic ailleurs ; rien dans la discussion où la mission est née ou qui la tient, ni sur un id illisible', () => {
  const m = closed('M', { bornIn: 'session-A' })
  expect(paneArchiveMark(boardOf([m], 'session-B'), m)).toBe('clic')
  expect(paneArchiveMark(boardOf([m], 'session-A'), m)).toBeUndefined()
  const owned = closed('N', { bornIn: 'session-C', owner: 'session-A' })
  expect(paneArchiveMark(boardOf([owned], 'session-A'), owned)).toBeUndefined()
  expect(paneArchiveMark(boardOf([owned], 'session-B'), owned)).toBe('clic')
  for (const bad of ['', undefined, 42]) expect(paneArchiveMark({ ...boardOf([m]), session: bad } as unknown as Board, m)).toBeUndefined()
})

test('archiveAwaiting passe le chemin de son appelant ; sans lui, aucune marque', () => {
  const run = { ...newRun('implement', T0 - 9 * MIN, 'Livrée'), status: 'paused' as const }
  const board = boardOf([run], 'coo')
  const delivered = closeDelivered(board, run.id, T0 - 5 * MIN, { version: '0.80.0', push: 'main' })!.board
  expect(archiveMarkOf(archiveAwaiting(delivered, [run.id], null, T0, undefined, 'clic')!.board.runs[0]!)).toBe('clic')
  expect(archiveMarkOf(archiveAwaiting(delivered, [run.id], null, T0, 'Archivée sans chemin')!.board.runs[0]!)).toBeUndefined()
})

// --- Dans le monde : les gestes ------------------------------------------------

test('monde · « ▣ Archiver » d’une mission née ailleurs pose « clic » ; celle née ici, rien ; le journal garde sa ligne', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const elsewhere = closed('Née ailleurs', { bornIn: 'session-B' })
  const here = closed('Née ici', { bornIn: 'session-A' })
  writeBoard(w, b => ({ ...b, runs: [elsewhere, here] }))
  await start($)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  await view.press({ key: 'tab-history' })
  await view.press({ key: `archive-${elsewhere.id}` })
  await view.press({ key: `archive-${here.id}` })
  await view.unmount()
  await settle(clock, 6)
  const after = stored(w)
  const a = after.runs.find(r => r.id === elsewhere.id)!
  const b = after.runs.find(r => r.id === here.id)!
  expect(a.archivedAt).toBeDefined()
  expect(archiveMarkOf(a)).toBe('clic')
  expect(b.archivedAt).toBeDefined()
  expect(b.archivedBy).toBeUndefined()
  expect(a.log[0]!.text).toBe('Mission archivée')
})

/** « ▣ Archiver » cliqué dans la discussion A sur une mission reprise dans B entre l'affichage et le clic. */
const resumedElsewhere = async ($: any, on: any, born: (w: ReturnType<typeof world>) => string) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m = closed('Reprise ailleurs', { bornIn: born(w) })
  writeBoard(w, b => ({ ...b, runs: [m] }))
  await start($)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  await view.press({ key: 'tab-history' })
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === m.id ? { ...r, status: 'active', owner: 'session-B', updatedAt: T0 + 5_000 } : r)) }))
  await view.press({ key: `archive-${m.id}` })
  await view.unmount()
  await settle(clock, 6)
  const after = stored(w).runs.find(r => r.id === m.id)!
  expect(after.status).toBe('active')
  expect(after.archivedAt).toBeUndefined()
  expect(after.archivedBy).toBeUndefined()
}

test('monde · « ▣ Archiver » sur une mission née ailleurs, reprise ailleurs depuis l’affichage : rien n’est archivé ni marqué', { timeoutMs: 20000 }, async ($, on) => {
  await resumedElsewhere($, on, () => 'session-B')
})

test('monde · « ▣ Archiver » sur une mission née ici, reprise ailleurs depuis l’affichage : rien n’est archivé non plus', { timeoutMs: 20000 }, async ($, on) => {
  // Née dans cette discussion, « ▣ » n'y porte aucune marque : en cours ailleurs, elle n'est pas archivée pour autant.
  await resumedElsewhere($, on, w => w.ids.now)
})

test('monde · « ▣ Archiver » quand le fichier des missions ne se relit pas : archivage sans marque ; une reprise ailleurs que la copie d’ici ignorait l’emporte à la fusion', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m = closed('Reprise ailleurs', { bornIn: 'session-B' })
  const n = closed('Close ailleurs', { bornIn: 'session-B' })
  writeBoard(w, b => ({ ...b, runs: [m, n] }))
  await start($)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  await view.press({ key: 'tab-history' })
  // B reprend M dans le fichier, que la discussion A ne relit plus.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === m.id ? { ...r, status: 'active', owner: 'session-B', updatedAt: T0 + 1_000 } : r)) }))
  w.disk.unreadable = true
  await view.press({ key: `archive-${m.id}` })
  await view.press({ key: `archive-${n.id}` })
  await view.unmount()
  w.disk.unreadable = false
  await settle(clock, 8)
  const runs = stored(w).runs
  const resumed = runs.find(r => r.id === m.id)!
  expect(resumed.status).toBe('active')
  expect(resumed.archivedAt).toBeUndefined()
  const plain = runs.find(r => r.id === n.id)!
  expect(plain.archivedAt).toBeDefined()
  expect(plain.archivedBy).toBeUndefined()
})

test('monde · /flow reset archive la mission en cours sans marque', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await settle(clock, 2)
  await $.skill.prompt({ skill: 'mattpocock-skills:prototype', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Abandonnée' } as any)
  await settle(clock, 2)
  await $.command.run({ command: 'flow', args: 'reset' } as any).catch(() => undefined)
  await settle(clock, 6)
  const run = stored(w).runs.find(r => r.title === 'Abandonnée')!
  expect(run.archivedAt).toBeDefined()
  expect(run.archivedBy).toBeUndefined()
})

test('monde · « ✓ Archiver » chez le COO pose « clic » dans la même écriture que la date', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = { ...newRun('implement', T0 - 9 * MIN, 'Livrée'), status: 'paused' as const }
  const delivered = closeDelivered(boardOf([run], 'coo'), run.id, T0 - 5 * MIN, { version: '0.80.0', push: 'main' })!.board.runs[0]!
  const other = closeDelivered(boardOf([{ ...run, id: `${run.id}b`, title: 'Livrée 2' }], 'coo'), `${run.id}b`, T0 - 5 * MIN, { version: '0.80.0', push: 'main' })!.board.runs[0]!
  writeBoard(w, b => ({ ...b, runs: [delivered, other] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  await view.press({ key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  for (const r of stored(w).runs) {
    expect(archiveMarkOf(r)).toBe('clic')
    expect(r.archivedBy!.at).toBe(r.archivedAt!)
  }
})
