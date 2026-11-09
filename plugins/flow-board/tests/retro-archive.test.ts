// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { closeDelivered, emptyBoard, isAwaitingArchive, newRun } from '../hooks/model.ts'
import { soundCard } from '../hooks/launch.ts'
import { retroCard, retroCardId } from '../hooks/retro-coo.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// Lancer la rétro d'une mission livrée archive cette mission, au clic, une fois. Invariant : « Une mission livrée est
// toujours close comme livrée (Version et Push ne lui sont plus jamais proposés), qu'elle soit ouverte, en pause ou
// reprise. Aucune mission n'est archivée sans ton choix (« Archiver », ou sa rétro lancée). Sur une mission en pause, le
// mod du COO n'écrit que cette clôture. »

const T0 = 1_000_000_000
const ARCHIVED_BY_RETRO = 'Archivée : sa rétro est lancée'

/** Une mission au rapport validé, sa phase « Version et push » à faire, en pause : prête à livrer. */
const validated = (now: number, title: string): Run => {
  const run = newRun('implement', now - 90_000, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: now - 50_000, finishedAt: now - 40_000, steps: [], items: [] }
  const version = newRun('project:version', run.startedAt, 'v').phases[0]!
  const pending = { ...version, status: 'pending' as const, startedAt: undefined, steps: version.steps.map(s => ({ id: s.id, status: 'pending' as const })) }
  return { ...run, phases: [done, report, pending], cursor: 1, status: 'paused', reportValidatedAt: now - 40_000, updatedAt: now - 1_000 } as Run
}

/** Le COO livre la mission (close comme livrée, carte de rétro posée). */
const deliver = async ($: any, clock: any, w: World, run: Run) => {
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }], steps: [{ key: 'version', status: 'done', at: T0 - 5_000, detail: '0.80.0' }, { key: 'push', status: 'done', at: T0 - 4_000 }, { key: 'project', status: 'running', at: T0 - 3_000 }], startedAt: T0 - 9_000 }
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  await $.tool.call({ tool: TOOL, delivery: { step: 'project', ok: true } } as any)
  await settle(clock, 2)
}

/** Une autre discussion change la mission dans le fichier, datée après la clôture par le COO. */
const elsewhere = async (clock: any, w: World, id: string, change: (r: Run) => Run) => {
  await settle(clock, 12)
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === id ? change({ ...r, updatedAt: T0 + 20_000 }) : r)) }))
  await settle(clock, 40)
}

const launch = async ($: any, run: Run) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: `coo-card-auto-${retroCardId(run.id)}` })
  await pane.unmount()
}

test('livrée et pas archivée : le lancement de sa rétro l’archive, une fois, et le lancement suit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0, 'Mission de B')
  await deliver($, clock, w, run)
  await launch($, run)
  await settle(clock, 2)
  const after = stored(w).runs.find(r => r.id === run.id)!
  expect(after.archivedAt).toBeDefined()
  expect(after.log[0]!.text).toBe(ARCHIVED_BY_RETRO)
  // Le lancement suit : sa demande est dans le prompt, et le toast dit l'archivage.
  expect(w.fills.some(t => t.includes('Rétrospective · Mission de B'))).toBe(true)
  expect(w.toasts.some(t => t.includes('La mission étudiée est archivée ; la demande d’archiver sa discussion dans l’app suit dans le prompt.'))).toBe(true)
  // La demande d'archiver sa discussion dans l'app suit celle du lancement, sans la remplacer.
  expect(w.box.text.indexOf('Rétrospective · Mission de B')).toBeLessThan(w.box.text.indexOf('cette mission livrée est archivée'))
  // Reprise ensuite, puis close de nouveau comme livrée, sa rétro déjà lancée : aucun relevé ne la réarchive.
  await elsewhere(clock, w, run.id, r => ({ ...r, archivedAt: undefined, status: 'done', finishedAt: T0 + 20_000 }))
  await openCoo($, clock)
  await settle(clock, 10)
  expect(stored(w).runs.find(r => r.id === run.id)!.archivedAt).toBeUndefined()
  // Elle attend de nouveau « ✓ Archiver » : la garde porte bien sur une mission archivable.
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: `coo-archive-${run.id}` })).toBeDefined()
  await pane.unmount()
})

test('reprise ailleurs entre l’affichage et le clic (la copie d’ici la croit livrée) : rien n’est archivé, et le toast le dit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0, 'Mission de B')
  await deliver($, clock, w, run)
  await settle(clock, 12)
  // La reprise n'arrive dans le fichier qu'à la relecture du clic.
  w.probe.onBoardRead = () => {
    w.probe.onBoardRead = undefined
    writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === run.id ? { ...r, status: 'active', owner: 'session-B', updatedAt: T0 + 20_000 } : r)) }))
  }
  await launch($, run)
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === run.id)!.archivedAt).toBeUndefined()
  expect(w.fills.some(t => t.includes('Rétrospective · Mission de B'))).toBe(true)
  expect(w.toasts.some(t => t.includes('La mission étudiée n’est pas archivée'))).toBe(true)
})

test('la demande pas mise dans le prompt (à taper) : rien n’est archivé, « ✓ Archiver » reste possible', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0, 'Mission de B')
  await deliver($, clock, w, run)
  // Une demande de lancement dont l'id ne se lit plus attend dans le prompt : rien ne se remplit.
  w.box.text = '◆ COO : lance maintenant la mission « Autre » (ligne retouchée)'
  await launch($, run)
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === run.id)!.archivedAt).toBeUndefined()
  expect(w.toasts.some(t => t.startsWith('▶ Demande à taper') && t.includes('« ✓ Archiver » reste possible'))).toBe(true)
})

test('valide mais inconnue du fichier des missions : le lancement part, rien n’est archivé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0, 'Mission de B')
  await deliver($, clock, w, run)
  // Une autre discussion supprime la mission (sa pierre tombale va avec).
  await settle(clock, 12)
  writeBoard(w, b => ({ ...b, runs: b.runs.filter(r => r.id !== run.id), deleted: [...(b.deleted ?? []), { id: run.id, at: T0 + 20_000 }] }))
  await settle(clock, 40)
  await launch($, run)
  await settle(clock, 2)
  expect(stored(w).runs.some(r => r.id === run.id)).toBe(false)
  expect(w.fills.some(t => t.includes('Rétrospective · Mission de B'))).toBe(true)
})

test('connue mais plus livrée (reprise ailleurs) : le lancement part, rien n’est archivé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0, 'Mission de B')
  await deliver($, clock, w, run)
  await elsewhere(clock, w, run.id, r => ({ ...r, status: 'active', owner: 'session-B' }))
  await launch($, run)
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === run.id)!.archivedAt).toBeUndefined()
  expect(w.fills.some(t => t.includes('Rétrospective · Mission de B'))).toBe(true)
})

test('une carte sans « of » (une mission proposée par Claude) : le lancement n’archive rien', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  // Une mission livrée, qui attend son archivage : le lancement d'une autre carte ne la touche pas.
  const base = validated(T0, 'Mission livrée')
  const other = closeDelivered({ ...emptyBoard('', 'projet'), runs: [base] }, base.id, T0 - 500, { version: '0.80.0', push: 'main' })!.board.runs[0]!
  expect(isAwaitingArchive(other)).toBe(true)
  writeBoard(w, b => ({ ...b, runs: [other] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const CARD = { title: 'Export CSV', start: 'grill-with-docs', askMatt: 'l. 19 : une idée encore floue → /grill-with-docs', alts: [], mode: 'manual', modeWhy: 'cadrage', effort: 'high', effortWhy: 'cadrage', folder: 'export-csv' }
  const r = String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result)
  const id = /Launch card (k[a-z0-9]+)/.exec(r)?.[1] ?? ''
  expect(id).not.toBe('')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: `coo-card-manual-${id}` })
  await pane.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.every(x => x.archivedAt === undefined)).toBe(true)
  expect(w.fills.some(t => t.includes('Export CSV'))).toBe(true)
})

test('une carte gardée au « of » hors forme ne se relit pas : elle ne se montre ni ne se lance, rien n’est archivé', () => {
  const run = { ...validated(T0, 'Mission de B'), status: 'done' as const }
  const card = { ...retroCard(run, null, T0), of: '../x' }
  expect(soundCard(card)).toBeNull()
  expect(soundCard(retroCard(run, null, T0))).not.toBeNull()
})

test('l’écriture de l’archivage refusée au lancement : le lancement suit, et le toast ne dit pas la mission archivée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0, 'Mission de B')
  await deliver($, clock, w, run)
  await settle(clock, 12)
  // Seule l'écriture qui porterait l'archivage est refusée : la copie d'ici la porte, pas le fichier.
  w.probe.refuseBoard = text => text.includes(ARCHIVED_BY_RETRO)
  await launch($, run)
  await settle(clock, 2)
  expect(w.fills.some(t => t.includes('Rétrospective · Mission de B'))).toBe(true)
  const toast = w.toasts.find(t => t.includes('Lancement de « Rétrospective')) ?? ''
  expect(toast).toContain('L’archivage de la mission étudiée n’est peut-être pas encore écrit')
  expect(toast).toContain('Sa discussion dans l’app ne t’est pas proposée à l’archivage : archive-la à la main si tu veux.')
  expect(toast).not.toContain('La mission étudiée est archivée')
  // Ni demande d'archiver sa discussion dans l'app tant que le fichier ne porte pas l'archivage.
  expect(w.box.text).not.toContain('cette mission livrée est archivée')
  w.probe.refuseBoard = undefined
})
