// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { cooStatement, isRetroCardRemovable, statementText } from '../hooks/coo.ts'
import { archiveAwaiting, awaitingArchivePrint, closeDelivered, emptyBoard, isAwaitingArchive, newRun } from '../hooks/model.ts'
import { retroCard, retroCardId } from '../hooks/retro-coo.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// « ✓ Archiver » et « ✓ Tout archiver (n) » dans la vue Coordination. Invariant : « Une mission livrée est toujours
// close comme livrée (Version et Push ne lui sont plus jamais proposés), qu'elle soit ouverte, en pause ou reprise.
// Aucune mission n'est archivée sans ton choix (« Archiver », ou sa rétro lancée). Sur une mission en pause, le mod du
// COO n'écrit que cette clôture. »

const T0 = 800_000_000
const CHANGED = "La liste a changé depuis : rien n'est archivé, regarde-la de nouveau"

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

/** Une mission au rapport validé, sa phase « Version et push » à faire, en pause : prête à livrer. */
const validated = (now: number, title: string): Run => {
  const run = newRun('implement', now - 90_000, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: now - 50_000, finishedAt: now - 40_000, steps: [], items: [] }
  const version = newRun('project:version', run.startedAt, 'v').phases[0]!
  const pending = { ...version, status: 'pending' as const, startedAt: undefined, steps: version.steps.map(s => ({ id: s.id, status: 'pending' as const })) }
  return { ...run, phases: [done, report, pending], cursor: 1, status: 'paused', reportValidatedAt: now - 40_000, updatedAt: now - 1_000 } as Run
}

/** La même, close comme livrée par le COO. */
const delivered = (now: number, title: string): Run => {
  const run = validated(now, title)
  const board: Board = { ...emptyBoard('', 'projet'), runs: [run] }
  return closeDelivered(board, run.id, now - 500, { version: '0.80.0', push: 'main' })!.board.runs[0]!
}

const pane = (p: string) => ({ plugin: PLUGIN, surface: 'desktop' as const, ...PANE, key: p })

test('deux missions livrées : leurs lignes « livrée », « ✓ Tout archiver (2) », puis les deux archivées d’un clic', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A')
  const b = delivered(T0, 'Mission B')
  const open = { ...validated(T0, 'Mission C'), status: 'done' as const }
  writeBoard(w, x => ({ ...x, runs: [a, b, open] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  const shown = await texts(view)
  expect(shown).toContain('« Mission A » livrée')
  expect(shown).toContain('« Mission B » livrée')
  // Close sans livraison : jamais « ✓ Archiver ».
  expect(shown).not.toContain('« Mission C » livrée')
  expect(await view.find({ key: `coo-archive-${a.id}` })).toBeDefined()
  expect(await view.find({ key: `coo-archive-${open.id}` })).toBeUndefined()
  const all = await view.find({ key: 'coo-archive-all' })
  expect(String(all?.props.label ?? '').replace(/\s/g, ' ')).toBe('✓ Tout archiver (2)')
  await view.press({ key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  const after = stored(w)
  expect(after.runs.find(r => r.id === a.id)!.archivedAt).toBeDefined()
  expect(after.runs.find(r => r.id === b.id)!.archivedAt).toBeDefined()
  expect(after.runs.find(r => r.id === open.id)!.archivedAt).toBeUndefined()
  // Ce qu'écrit l'archivage : celui d'`archiveRun`, rien d'autre (les phases de livraison restent faites).
  const archived = after.runs.find(r => r.id === a.id)!
  expect(archived.status).toBe('done')
  expect(archived.phases.map(p => p.status)).toEqual(a.phases.map(p => p.status))
  expect(archived.log[0]!.text).toBe('Mission archivée')
  const again = await $.ui.mount(pane('b'))
  expect(await texts(again)).not.toContain('« Mission A » livrée')
  expect(await again.find({ key: 'coo-archive-all' })).toBeUndefined()
  await again.unmount()
})

test('une mission livrée de plus entre l’affichage et le clic : rien n’est archivé, et le toast le dit', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A')
  const b = delivered(T0, 'Mission B')
  writeBoard(w, x => ({ ...x, runs: [a, b] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('c'))
  expect(await view.find({ key: 'coo-archive-all' })).toBeDefined()
  // Une autre discussion livre une troisième mission entre l’affichage et le clic : le clic relit le fichier, qui l’a.
  const c = delivered(T0, 'Mission D')
  w.probe.onBoardRead = () => {
    w.probe.onBoardRead = undefined
    writeBoard(w, x => ({ ...x, runs: [...x.runs, c] }))
  }
  await view.press({ key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.map(r => r.archivedAt)).toEqual([undefined, undefined, undefined])
  expect(w.toasts).toContain(CHANGED)
})

test('une mission reprise entre l’affichage et le clic n’est pas archivée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A')
  writeBoard(w, x => ({ ...x, runs: [a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('d'))
  expect(await view.find({ key: `coo-archive-${a.id}` })).toBeDefined()
  // Seule mission livrée : pas de « Tout archiver ».
  expect(await view.find({ key: 'coo-archive-all' })).toBeUndefined()
  // Reprise dans une autre discussion entre l’affichage et le clic.
  w.probe.onBoardRead = () => {
    w.probe.onBoardRead = undefined
    writeBoard(w, x => ({ ...x, runs: x.runs.map(r => (r.id === a.id ? { ...r, status: 'active', owner: 'session-B', updatedAt: T0 + 10 } : r)) }))
  }
  await view.press({ key: `coo-archive-${a.id}` })
  await view.unmount()
  await settle(clock, 2)
  expect(stored(w).runs[0]!.archivedAt).toBeUndefined()
  expect(w.toasts).toContain(CHANGED)
})

test('la carte de rétro d’une mission livrée a « ✓ Archiver », qui archive la mission et retire la carte', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0, 'Mission de B')
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }], steps: [{ key: 'version', status: 'done', at: T0 - 5_000, detail: '0.80.0' }, { key: 'push', status: 'done', at: T0 - 4_000 }, { key: 'project', status: 'running', at: T0 - 3_000 }], startedAt: T0 - 9_000 }
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const done = String(((await $.tool.call({ tool: TOOL, delivery: { step: 'project', ok: true } } as any)) as any).result)
  expect(done).toMatch(/« ✓ Archiver »/)
  expect(done).not.toMatch(/Pas de rétro/)
  await settle(clock, 2)
  const view = await $.ui.mount(pane('e'))
  const shown = await texts(view)
  expect(shown).toContain('Rétrospective · Mission de B')
  // Sa carte prête lui tient lieu de ligne « livrée ».
  expect(shown).not.toContain('« Mission de B » livrée')
  expect(await view.find({ key: `coo-card-dismiss-${retroCardId(run.id)}` })).toBeUndefined()
  const button = await view.find({ key: `coo-card-archive-${retroCardId(run.id)}` })
  expect(String(button?.props.label ?? '').replace(/\s/g, ' ')).toBe('✓ Archiver')
  await view.press({ key: `coo-card-archive-${retroCardId(run.id)}` })
  await view.unmount()
  await settle(clock, 2)
  expect(stored(w).runs[0]!.archivedAt).toBeDefined()
  const after = await $.ui.mount(pane('f'))
  expect(await texts(after)).not.toContain('Rétrospective · Mission de B')
  await after.unmount()
})

test('le relevé du COO nomme les missions livrées et pas archivées, sans jamais les archiver lui-même', () => {
  const a = delivered(T0, 'Mission A')
  const b = delivered(T0, 'Mission B')
  const board: Board = { ...emptyBoard('', 'projet'), runs: [a, b, { ...a, id: 'mold01', title: 'Vieille', archivedAt: T0 - 9 }] }
  const s = cooStatement(board, { now: T0 })
  expect(s.delivered?.list.map(d => d.id).sort()).toEqual([a.id, b.id].sort())
  const text = statementText(s)
  expect(text).toMatch(/Delivered missions not archived \(2\): « Mission [AB] », « Mission [AB] »/)
  expect(text).toMatch(/never archive one yourself/)
  expect(text).not.toMatch(/Vieille/)
})

test('une mission livrée dont un groupe est reparti depuis le push, ou à l’id hors forme, n’attend pas l’archivage', () => {
  const a = delivered(T0, 'Mission A')
  expect(isAwaitingArchive(a)).toBe(true)
  const resent = { ...a, groups: [{ id: 'A', name: 'a', tickets: [], delegated: { session: 'bbbb1111-2222-3333-4444-555566667777', at: T0 + 5_000 } }] } as unknown as Run
  expect(isAwaitingArchive(resent)).toBe(false)
  expect(isAwaitingArchive({ ...a, id: 'pas un id;rm' })).toBe(false)
  // Livrée à la main, sa « Pull request » sautée : elle attend l’archivage comme les autres.
  const pr = { ...a.phases[2]!, skill: 'project:pr', status: 'skipped' as const, steps: [] }
  expect(isAwaitingArchive({ ...a, phases: [...a.phases, pr] })).toBe(true)
  // Active dans cette discussion : le geste n’archive rien.
  const board: Board = { ...emptyBoard('', 'projet'), runs: [a], activeId: a.id }
  expect(archiveAwaiting(board, [a.id], awaitingArchivePrint(board.runs), T0)).toBeNull()
})

test('deux missions livrées, chacune sa carte de rétro : « ✓ Tout archiver (2) » est là, et son clic retire les deux cartes', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = validated(T0, 'Mission A')
  const b = validated(T0, 'Mission B')
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [a, b].map(r => ({ id: r.id, title: r.title, validatedAt: r.reportValidatedAt })), steps: [{ key: 'version', status: 'done', at: T0 - 5_000, detail: '0.80.0' }, { key: 'push', status: 'done', at: T0 - 4_000 }, { key: 'project', status: 'running', at: T0 - 3_000 }], startedAt: T0 - 9_000 }
  writeBoard(w, x => ({ ...x, runs: [a, b] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  await $.tool.call({ tool: TOOL, delivery: { step: 'project', ok: true } } as any)
  await settle(clock, 2)
  const view = await $.ui.mount(pane('g'))
  const shown = await texts(view)
  expect(shown).toContain('Rétrospective · Mission A')
  expect(shown).toContain('Rétrospective · Mission B')
  expect(shown).not.toContain('« Mission A » livrée')
  expect(shown).not.toContain('Rien pour l’instant.')
  const all = await view.find({ key: 'coo-archive-all' })
  expect(String(all?.props.label ?? '').replace(/\s/g, ' ')).toBe('✓ Tout archiver (2)')
  await view.press({ key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.every(r => r.archivedAt !== undefined)).toBe(true)
  const after = await $.ui.mount(pane('h'))
  const left = await texts(after)
  expect(left).not.toContain('Rétrospective · Mission A')
  expect(left).not.toContain('Rétrospective · Mission B')
  await after.unmount()
})

test('la carte de rétro encore prête d’une mission archivée ailleurs reste lançable, sans « ✓ Archiver » ; une « Pull request » à faire retient l’archivage', () => {
  const a = { ...delivered(T0, 'Mission A'), archivedAt: T0 - 10 }
  const board: Board = { ...emptyBoard('', 'projet'), runs: [a] }
  const card = retroCard(a, null, T0 - 100)
  const s = cooStatement(board, { now: T0, cards: [card] })
  expect((s.cards ?? []).map(c => c.id)).toEqual([card.id])
  expect(s.delivered).toBeUndefined()
  // Sa clôture par le COO pas encore appliquée (« Pull request » à faire) : elle n’attend pas encore l’archivage.
  const live = delivered(T0, 'Mission B')
  const pr = { ...live.phases[2]!, skill: 'project:pr', status: 'pending' as const, steps: [] }
  expect(isAwaitingArchive({ ...live, phases: [...live.phases, pr] })).toBe(false)
})

test('une rétro livrée ne reçoit pas de carte de rétro : seule l’autre mission en a une, et la rétro a sa ligne « livrée »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = validated(T0, 'Mission A')
  const base = validated(T0, 'Rétrospective · Mission Z')
  const retro = { ...base, entry: 'retro', phases: [{ ...base.phases[0]!, skill: 'retro' }, ...base.phases.slice(1)] } as Run
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [a, retro].map(r => ({ id: r.id, title: r.title, validatedAt: r.reportValidatedAt })), steps: [{ key: 'version', status: 'done', at: T0 - 5_000, detail: '0.80.0' }, { key: 'push', status: 'done', at: T0 - 4_000 }, { key: 'project', status: 'running', at: T0 - 3_000 }], startedAt: T0 - 9_000 }
  writeBoard(w, x => ({ ...x, runs: [a, retro] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const done = String(((await $.tool.call({ tool: TOOL, delivery: { step: 'project', ok: true } } as any)) as any).result)
  expect(done).toMatch(/offers the retro of each delivered mission that is not itself a retro \(1 card/)
  await settle(clock, 2)
  const view = await $.ui.mount(pane('i'))
  const shown = await texts(view)
  expect(shown).toContain('Rétrospective · Mission A')
  expect(shown).not.toContain('Rétrospective · Rétrospective · Mission Z')
  expect(shown).toContain('« Rétrospective · Mission Z » livrée')
  expect(await view.find({ key: `coo-card-auto-${retroCardId(retro.id)}` })).toBeUndefined()
  await view.unmount()
})

test('la carte de rétro d’une mission archivée ailleurs a « ✕ Retirer » : la carte part, la mission reste telle quelle', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0, 'Mission de B')
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }], steps: [{ key: 'version', status: 'done', at: T0 - 5_000, detail: '0.80.0' }, { key: 'push', status: 'done', at: T0 - 4_000 }, { key: 'project', status: 'running', at: T0 - 3_000 }], startedAt: T0 - 9_000 }
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  await $.tool.call({ tool: TOOL, delivery: { step: 'project', ok: true } } as any)
  await settle(clock, 2)
  // Une autre discussion archive la mission depuis son panneau, après sa clôture par le COO.
  await settle(clock, 12)
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === run.id ? { ...r, archivedAt: T0 + 20_000, updatedAt: T0 + 20_000 } : r)) }))
  await settle(clock, 40)
  const view = await $.ui.mount(pane('j'))
  expect(await texts(view)).toContain('Rétrospective · Mission de B')
  expect(await view.find({ key: `coo-card-archive-${retroCardId(run.id)}` })).toBeUndefined()
  // Elle reste lançable.
  expect(await view.find({ key: `coo-card-auto-${retroCardId(run.id)}` })).toBeDefined()
  const remove = await view.find({ key: `coo-card-remove-${retroCardId(run.id)}` })
  expect(String(remove?.props.label ?? '').replace(/\s/g, ' ')).toBe('✕ Retirer')
  const before = JSON.stringify(stored(w).runs[0])
  await view.press({ key: `coo-card-remove-${retroCardId(run.id)}` })
  await view.unmount()
  await settle(clock, 2)
  expect(JSON.stringify(stored(w).runs[0])).toBe(before)
  const after = await $.ui.mount(pane('k'))
  expect(await texts(after)).not.toContain('Rétrospective · Mission de B')
  await after.unmount()
})

test('la carte de rétro d’une mission reprise ailleurs a aussi « ✕ Retirer » ; celle d’une mission qui attend « ✓ Archiver » ne l’a pas', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0, 'Mission de B')
  const other = validated(T0, 'Mission de C')
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [run, other].map(r => ({ id: r.id, title: r.title, validatedAt: r.reportValidatedAt })), steps: [{ key: 'version', status: 'done', at: T0 - 5_000, detail: '0.80.0' }, { key: 'push', status: 'done', at: T0 - 4_000 }, { key: 'project', status: 'running', at: T0 - 3_000 }], startedAt: T0 - 9_000 }
  writeBoard(w, b => ({ ...b, runs: [run, other] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  await $.tool.call({ tool: TOOL, delivery: { step: 'project', ok: true } } as any)
  await settle(clock, 2)
  // Elle attend « ✓ Archiver » : ce bouton-là, pas « ✕ Retirer ».
  const first = await $.ui.mount(pane('l'))
  expect(await first.find({ key: `coo-card-archive-${retroCardId(run.id)}` })).toBeDefined()
  expect(await first.find({ key: `coo-card-remove-${retroCardId(run.id)}` })).toBeUndefined()
  await first.unmount()
  // Reprise dans une autre discussion : plus de « ✓ Archiver », et « ✕ Retirer » retire la carte sans toucher la mission.
  await settle(clock, 12)
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === run.id ? { ...r, status: 'active', owner: 'session-B', updatedAt: T0 + 20_000 } : r)) }))
  await settle(clock, 40)
  const view = await $.ui.mount(pane('m'))
  expect(await view.find({ key: `coo-card-archive-${retroCardId(run.id)}` })).toBeUndefined()
  expect(await view.find({ key: `coo-card-remove-${retroCardId(run.id)}` })).toBeDefined()
  const before = JSON.stringify(stored(w).runs[0])
  await view.press({ key: `coo-card-remove-${retroCardId(run.id)}` })
  await view.unmount()
  await settle(clock, 2)
  expect(w.toasts.some(t => t.startsWith('◆ Carte retirée'))).toBe(true)
  expect(JSON.stringify(stored(w).runs[0])).toBe(before)
  const after = await $.ui.mount(pane('n'))
  expect(await texts(after)).not.toContain('Rétrospective · Mission de B')
  // Seule la carte cliquée part : celle de C, qui attend « ✓ Archiver », reste avec ce bouton.
  expect(await texts(after)).toContain('Rétrospective · Mission de C')
  expect(await after.find({ key: `coo-card-archive-${retroCardId(other.id)}` })).toBeDefined()
  expect(await after.find({ key: `coo-card-remove-${retroCardId(other.id)}` })).toBeUndefined()
  await after.unmount()
})

test('isRetroCardRemovable : la garde du clic refuse la carte d’une mission qui attend « ✓ Archiver », et seulement elle', () => {
  const waiting = delivered(T0, 'Attend')
  expect(isRetroCardRemovable(waiting.id, [waiting])).toBe(false)
  expect(isRetroCardRemovable(waiting.id, [{ ...waiting, archivedAt: T0 }])).toBe(true)
  expect(isRetroCardRemovable(waiting.id, [{ ...waiting, status: 'active' }])).toBe(true)
  expect(isRetroCardRemovable(waiting.id, [])).toBe(true)
  expect(isRetroCardRemovable(undefined, [waiting])).toBe(false)
})
