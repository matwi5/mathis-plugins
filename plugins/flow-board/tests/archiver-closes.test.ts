// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { isRetroCardRemovable } from '../hooks/coo.ts'
import { archiveAwaiting, archiveMarkOf, awaitingArchivePrint, closeDelivered, closeIdleRun, deliveredByCooLine, emptyBoard, isArchivable, isAwaitingArchive, newRun } from '../hooks/model.ts'
import { retroCardId } from '../hooks/retro-coo.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, coordFile, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'
import { findAllAny, findAny, pressAny } from './page-coo.ts'

// « ✓ Archiver » et « ✓ Tout archiver (n) » valent aussi pour une mission close sans livraison qui a droit à sa carte
// de rétro. Invariant : « Une mission livrée est toujours close comme livrée (Version et Push ne lui sont plus jamais
// proposés), qu'elle soit ouverte, en pause ou reprise. Aucune mission n'est archivée sans ton choix (« Archiver », ou
// sa rétro lancée). Sur une mission en pause, le mod du COO n'écrit que cette clôture. »

const T0 = 960_000_000
const MIN = 60_000
const CHANGED = "La liste a changé depuis : rien n'est archivé, regarde-la de nouveau"

const texts = async (pane: any): Promise<string> => ((await findAllAny(pane, { type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')
const pane = (key: string) => ({ plugin: PLUGIN, surface: 'desktop' as const, ...PANE, key })

/** Une mission close sans livraison : finie dans sa discussion (ses phases restantes sautées). */
const closed = (title: string, extra: Partial<Run> = {}): Run => ({ ...newRun('prototype', T0 - 10 * MIN, title), status: 'done', finishedAt: T0 - 9 * MIN, updatedAt: T0 - 9 * MIN, ...extra })
/** Une rétro lancée par le COO sur la mission `of`. */
const retroOfMission = (of: string, status: Run['status']): Run =>
  ({
    ...newRun('retro', T0 - 5 * MIN, `Rétrospective · ${of}`),
    status,
    ...(status === 'done' ? { finishedAt: T0 - 4 * MIN } : {}),
    launch: { id: 'labcdefgh1', card: retroCardId(of), at: T0 - 5 * MIN, folder: 'retro-x', start: 'retro', mode: 'auto', of },
  }) as unknown as Run
/** Une mission livrée : rapport validé, close comme livrée par le COO. */
const delivered = (title: string): Run => {
  const run = newRun('implement', T0 - 20 * MIN, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: T0 - 15 * MIN }
  const version = newRun('project:version', run.startedAt, 'v').phases[0]!
  const pending = { ...version, status: 'pending' as const, startedAt: undefined, steps: version.steps.map(s => ({ id: s.id, status: 'pending' as const })) }
  const paused = { ...run, phases: [done, pending], cursor: 1, status: 'paused', reportValidatedAt: T0 - 14 * MIN, updatedAt: T0 - 14 * MIN } as Run
  return closeDelivered({ ...emptyBoard('', 'p'), runs: [paused] }, paused.id, T0 - 12 * MIN, { version: '0.80.0', push: 'main' })!.board.runs[0]!
}
const boardOf = (runs: Run[]): Board => ({ ...emptyBoard('', 'p'), runs, activeId: null, session: 'coo' })
const scopeOf = (carded: string[], held: string[] = []) => ({ carded: new Set(carded), held: new Set(held) })
/** Les boutons « ✓ Archiver » montrés (cartes de rétro et lignes), sans « ✓ Tout archiver ». */
const archiveButtons = async (view: any): Promise<string[]> =>
  ((await findAllAny(view, { type: 'Button' })) as any[]).map(b => String(b.key ?? '')).filter(k => (k.startsWith('coo-card-archive-') || k.startsWith('coo-archive-')) && k !== 'coo-archive-all')

test('isArchivable : une mission close sans livraison attend « ✓ Archiver » avec sa carte prête, sans groupe chez un worker ni phase de livraison en cours', () => {
  const m = closed('Close')
  const runs = [m]
  expect(isAwaitingArchive(m)).toBe(false)
  expect(isArchivable(m, runs, scopeOf([m.id]))).toBe(true)
  // Sans carte prête ici (aucun bouton ne la montre), ou visée par une clôture ou une livraison en cours : non.
  expect(isArchivable(m, runs, scopeOf([]))).toBe(false)
  expect(isArchivable(m, runs)).toBe(false)
  expect(isArchivable(m, runs, scopeOf([m.id], [m.id]))).toBe(false)
  // Reprise, en pause, archivée, id hors forme : non.
  for (const other of [{ ...m, status: 'active' as const }, { ...m, status: 'paused' as const }, { ...m, archivedAt: T0 }, { ...m, id: '../x' }]) expect(isArchivable(other, [other], scopeOf([other.id]))).toBe(false)
  // Un groupe chez un worker, ou rendu sans être fermé : non.
  const linked = { ...m, groups: [{ id: 'A', name: 'a', tickets: [], linked: { session: 'bbbb1111-2222-3333-4444-555566667777', at: T0 - MIN } }] } as unknown as Run
  expect(isArchivable(linked, [linked], scopeOf([m.id]))).toBe(false)
  const returned = { ...m, groups: [{ id: 'A', name: 'a', tickets: [], delegated: { session: 'bbbb1111-2222-3333-4444-555566667777', at: T0 - MIN } }] } as unknown as Run
  expect(isArchivable(returned, [returned], scopeOf([m.id]))).toBe(false)
  // Une phase de livraison restée à faire (fermée avec sa discussion, ou close par le COO hors livraison) ne la retient
  // pas : une mission close ne se livre plus. Une phase de livraison en cours, si.
  const version = newRun('project:version', m.startedAt, 'v').phases[0]!
  const idle = { ...m, phases: [...m.phases, { ...version, status: 'pending' as const }] } as Run
  expect(isArchivable(idle, [idle], scopeOf([m.id]))).toBe(true)
  const shipping = { ...m, phases: [...m.phases, { ...version, status: 'active' as const }] } as Run
  expect(isArchivable(shipping, [shipping], scopeOf([m.id]))).toBe(false)
  // Une rétro close, et une mission close qui a déjà sa rétro (close ou en cours) : non.
  const retro = retroOfMission(m.id, 'done')
  expect(isArchivable(retro, [m, retro], scopeOf([m.id, retro.id]))).toBe(false)
  expect(isArchivable(m, [m, retro], scopeOf([m.id]))).toBe(false)
  expect(isArchivable(m, [m, retroOfMission(m.id, 'active')], scopeOf([m.id]))).toBe(false)
})

test('une mission livrée garde exactement ses conditions d’aujourd’hui, carte ou non, retenue ou non', () => {
  const d = delivered('Livrée')
  expect(isAwaitingArchive(d)).toBe(true)
  for (const scope of [undefined, scopeOf([]), scopeOf([d.id]), scopeOf([], [d.id])]) expect(isArchivable(d, [d], scope)).toBe(true)
  // Un groupe confié à un worker depuis le push la retient, comme aujourd'hui.
  const sent = { ...d, groups: [{ id: 'A', name: 'a', tickets: [], linked: { session: 'bbbb1111-2222-3333-4444-555566667777', at: T0 } }] } as unknown as Run
  expect(isArchivable(sent, [sent], scopeOf([d.id]))).toBe(false)
  // La ligne de sa discussion reste celle d'une mission livrée.
  expect(deliveredByCooLine(T0, closed('Close'))).not.toMatch(/Coordination/)
})

test('archiveAwaiting : la mission close sans livraison s’archive avec sa marque, seulement sur sa carte prête et la liste montrée inchangée', () => {
  const m = closed('Close')
  const board = boardOf([m])
  const scope = scopeOf([m.id])
  const print = awaitingArchivePrint(board.runs, scope)
  const out = archiveAwaiting(board, [m.id], print, T0, undefined, 'clic', scope)!.board.runs[0]!
  expect(out.archivedAt).toBe(T0)
  expect(archiveMarkOf(out)).toBe('clic')
  // Sans le contexte du COO, ou sa carte partie : rien.
  expect(archiveAwaiting(board, [m.id], null, T0)).toBeNull()
  expect(archiveAwaiting(board, [m.id], print, T0, undefined, 'clic', scopeOf([]))).toBeNull()
  // Visée depuis par une clôture ou la livraison : la liste a changé, rien.
  expect(archiveAwaiting(board, [m.id], print, T0, undefined, 'clic', scopeOf([m.id], [m.id]))).toBeNull()
  // Active dans la discussion du COO : jamais.
  expect(archiveAwaiting({ ...board, activeId: m.id }, [m.id], print, T0, undefined, 'clic', scope)).toBeNull()
})

test('la carte d’une mission close sans livraison qui attend « ✓ Archiver », ou retenue par un groupe chez un worker, n’a pas « ✕ Retirer » (elle reviendrait au relevé)', () => {
  const m = closed('Close')
  expect(isRetroCardRemovable(m.id, [m])).toBe(false)
  const linked = { ...m, groups: [{ id: 'A', name: 'a', tickets: [], linked: { session: 'bbbb1111-2222-3333-4444-555566667777', at: T0 } }] } as unknown as Run
  expect(isRetroCardRemovable(m.id, [linked])).toBe(false)
  expect(isRetroCardRemovable(m.id, [{ ...m, archivedAt: T0 }])).toBe(true)
  expect(isRetroCardRemovable(m.id, [{ ...m, status: 'active' }])).toBe(true)
})

// --- Dans le monde du COO ------------------------------------------------------

test('monde · livrée, close sans livraison, rétro close, mission dont la rétro tourne : n est le nombre de « ✓ Archiver » montrés, et seules les deux premières s’archivent', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered('Mission livrée')
  const n = closed('Mission close')
  const studied = closed('Mission étudiée')
  const running = retroOfMission(studied.id, 'active')
  // La mission étudiée par la rétro close, reprise ailleurs : la fin de cette rétro attend (elle n'archive rien seule).
  const other = { ...closed('Autre'), status: 'active', owner: 'cccc1111-2222-3333-4444-555566667777', finishedAt: undefined } as Run
  const doneRetro = retroOfMission(other.id, 'done')
  writeBoard(w, b => ({ ...b, runs: [a, n, studied, running, doneRetro, other] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  const buttons = await archiveButtons(view)
  expect(buttons.sort()).toEqual([`coo-card-archive-${retroCardId(a.id)}`, `coo-card-archive-${retroCardId(n.id)}`].sort())
  const all = await findAny(view, { key: 'coo-archive-all' })
  expect(String(all?.props.label ?? '').replace(/\s/g, ' ')).toBe(`✓ Tout archiver (${buttons.length})`)
  // Les libellés : la carte porte « ✓ Archiver » ; la ligne « « M » livrée » reste réservée à une mission livrée.
  const shown = await texts(view)
  expect(shown).not.toContain('« Mission close » livrée')
  // La phrase dit « closes » dès qu'une mission non livrée est comptée.
  expect(shown).toContain('2 missions closes attendent leur rétro ou leur archivage')
  expect(shown).not.toContain('missions livrées attendent')
  await pressAny(view, { key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  const after = stored(w).runs
  expect(archiveMarkOf(after.find(r => r.id === a.id)!)).toBe('clic')
  expect(archiveMarkOf(after.find(r => r.id === n.id)!)).toBe('clic')
  for (const id of [studied.id, running.id, doneRetro.id]) expect(after.find(r => r.id === id)!.archivedAt).toBeUndefined()
})

test('monde · deux missions livrées seulement : la phrase reste « livrées »', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: [delivered('Livrée A'), delivered('Livrée B')] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  expect(await texts(view)).toContain('2 missions livrées attendent leur rétro ou leur archivage')
  await view.unmount()
})

test('monde · « ✓ Archiver » sur la carte d’une mission close sans livraison l’archive avec « clic »', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const n = closed('Mission close')
  writeBoard(w, b => ({ ...b, runs: [n] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  await pressAny(view, { key: `coo-card-archive-${retroCardId(n.id)}` })
  await view.unmount()
  await settle(clock, 2)
  const after = stored(w).runs.find(r => r.id === n.id)!
  expect(after.archivedAt).toBeDefined()
  expect(archiveMarkOf(after)).toBe('clic')
  expect(after.status).toBe('done')
})

test('monde · un clic resté d’un affichage ancien n’archive rien : groupe reparti chez un worker, mission reprise, rétro lancée depuis', { timeoutMs: 30000 }, async ($, on) => {
  const changes: [string, (r: Run) => Run[]][] = [
    ['groupe chez un worker', r => [{ ...r, groups: [{ id: 'A', name: 'a', tickets: [], linked: { session: 'bbbb1111-2222-3333-4444-555566667777', at: T0 } }], updatedAt: T0 } as unknown as Run]],
    ['reprise', r => [{ ...r, status: 'active', owner: 'session-B', updatedAt: T0 }]],
    ['rétro lancée', r => [r, retroOfMission(r.id, 'active')]],
  ]
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runs = changes.map(([title]) => closed(`Mission ${title}`))
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  for (const r of runs) expect(await findAny(view, { key: `coo-card-archive-${retroCardId(r.id)}` })).toBeDefined()
  // Entre l'affichage et le clic, chaque mission change dans une autre discussion.
  writeBoard(w, b => ({ ...b, runs: b.runs.flatMap(r => { const i = runs.findIndex(x => x.id === r.id); return i < 0 ? [r] : changes[i]![1](r) }) }))
  await pressAny(view, { key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  for (const r of runs) expect(stored(w).runs.find(x => x.id === r.id)!.archivedAt).toBeUndefined()
  expect(w.toasts).toContain(CHANGED)
})

test('monde · une mission close sans livraison que la livraison en cours vise n’a pas « ✓ Archiver » : sa clôture comme livrée doit pouvoir venir', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const n = closed('Mission en livraison', { reportValidatedAt: T0 - 8 * MIN })
  const free = closed('Mission libre')
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: n.id, title: n.title, validatedAt: T0 - 8 * MIN }], steps: [{ key: 'version', status: 'done', at: T0 - 5_000, detail: '0.80.0' }, { key: 'push', status: 'running', at: T0 - 4_000 }, { key: 'project', status: 'todo' }], startedAt: T0 - 9_000 }
  writeBoard(w, b => ({ ...b, runs: [n, free] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  expect(await archiveButtons(view)).toEqual([`coo-card-archive-${retroCardId(free.id)}`])
  await view.unmount()
})

test('monde · une demande de clôture écrite après le dernier relevé : le clic relit le fichier de coordination et n’archive rien', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const n = closed('Mission à clore comme livrée')
  writeBoard(w, b => ({ ...b, runs: [n] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  expect(await findAny(view, { key: `coo-card-archive-${retroCardId(n.id)}` })).toBeDefined()
  // Le Claude du COO demande sa clôture comme livrée ; le relevé suivant ne l'a pas encore lue.
  w.coord.text = coordFile([{ id: 'cclose001', kind: 'close', run: n.id, at: T0, delivered: { version: '0.80.0', push: 'main' } }])
  await pressAny(view, { key: `coo-card-archive-${retroCardId(n.id)}` })
  await view.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === n.id)!.archivedAt).toBeUndefined()
  expect(w.toasts).toContain(CHANGED)
})

test('monde · une mission du parcours implement close par le COO hors livraison (phases de livraison restées à faire) a « ✓ Archiver »', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const paused = { ...newRun('implement', T0 - 20 * MIN, 'Mission close par le COO'), status: 'paused' as const, updatedAt: T0 - 15 * MIN }
  const idle = closeIdleRun(boardOf([paused]), paused.id, T0 - 10 * MIN)!.board.runs[0]!
  expect(idle.phases.some(p => p.skill === 'project:version' && p.status === 'pending')).toBe(true)
  writeBoard(w, b => ({ ...b, runs: [idle] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  await pressAny(view, { key: `coo-card-archive-${retroCardId(idle.id)}` })
  await view.unmount()
  await settle(clock, 2)
  expect(archiveMarkOf(stored(w).runs.find(r => r.id === idle.id)!)).toBe('clic')
})
