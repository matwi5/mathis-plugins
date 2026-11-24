// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { archiveRun, closeDelivered, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, seatOf, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'
import { storageMode } from './stockage.ts'

// L'étape « rangement » de la livraison gardée, menée par le tableau de bord. Invariant : « L'étape de rangement ne part
// jamais avant que les étapes qui livrent soient faites, ne change jamais leur issue, et son arrêt ou son abandon ne
// défait rien de ce qui est livré. » ; et celui de la livraison : « Rien n'est poussé sans un clic ▶ Livrer ; une étape
// ne part que si la précédente a réussi ; une seule livraison à la fois. »

const T0 = 500_000_000
const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const KEY = 'coo-delivery:'

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

/** Une mission d'une autre discussion, son rapport validé, en pause : elle attend sa livraison. */
const validated = (now: number, title = 'Mission de B', id?: string): Run => {
  const run = newRun('implement', now - 90_000, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: now - 50_000, finishedAt: now - 40_000, steps: [], items: [] }
  return { ...run, ...(id ? { id } : {}), phases: [done, report], cursor: 1, status: 'paused', reportValidatedAt: now - 40_000, updatedAt: now - 1_000 } as Run
}

/** Une mission livrée puis archivée par un clic, née dans la discussion UUID : sa discussion est à fermer. */
const toClose = (now: number): Run => {
  const run = { ...validated(now, 'Mission archivée', 'mission-archivee'), bornIn: UUID }
  const board: Board = { ...emptyBoard('', 'projet'), runs: [run] }
  const closed = closeDelivered(board, run.id, now - 800, { push: 'main' })!.board
  return archiveRun(closed, run.id, now - 700, 'Mission archivée', 'clic')!.board.runs[0]!
}

const atDelivery = async ($: any, clock: any, w: World, runs: Run[]) => {
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
}

const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key })
  await pane.unmount()
}

const report = async ($: any, step: string, ok: boolean, detail = '') => String(((await $.tool.call({ tool: TOOL, delivery: { step, ok, detail } } as any)) as any).result)

/** Livre les étapes qui livrent, chacune réussie ; rend l'issue de la dernière. */
const ship = async ($: any, clock: any) => {
  await press($, 'coo-deliver')
  await report($, 'version', true, 'flow-board 0.80.0')
  await settle(clock, 6)
  await report($, 'push', true, 'main → origin/main')
  await settle(clock, 6)
  return report($, 'project', true, 'export public fait')
}

/** Ces missions notées relevées (une entrée « gleaned » datée après toute clôture) : leur relevé n'est plus dû. */
const gleaned = (w: World, ids: string[]) => {
  w.coord.text = coordFile([...entries(w), ...ids.map((run, i) => ({ id: `cgleaned${i}`, kind: 'gleaned', run, at: T0 + 100_000_000 }))])
}

/**
 * La ligne « Jalons » de la livraison écrite dans la feuille de route : la tâche « Jalons » n'est plus due. La feuille de
 * route vit sur le poste (fichier) : en mode `$.store`, rien ne la garde, et la tâche « Jalons » n'a pas lieu (`canProveJalons`).
 */
const canProveJalons = storageMode() === 'fichier'
const jalon = (w: World) => {
  w.files['flow-board/coordination/sans-projet-811c9dc5.feuille-de-route.md'] = ['# Feuille de route', '', '## Jalons', '- [J1] en cours · 2026-11-20 · Mathis · Livraison 0.80.0 — fin : rangée', '', '## Prochaines étapes', '', '## Idées', '', '## À reprendre', ''].join('\n')
}

const tidyOf = (w: World) => (w.mem[KEY] as any)?.steps?.find((s: any) => s.key === 'rangement')

/** Une livraison gardée, ses étapes qui livrent faites, le rangement dans l'état donné. */
const kept = (run: Run, tidy: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
  v: 1,
  id: 'd1',
  missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }],
  steps: [{ key: 'version', status: 'done', detail: '0.80.0' }, { key: 'push', status: 'done', detail: 'main' }, { key: 'project', status: 'done' }, { key: 'rangement', ...tidy }],
  startedAt: T0 - 9_000,
  ...more,
})

test('les étapes qui livrent faites : clôtures et cartes de rétro sans attendre ; rien de dû, le rangement se rend fait lui-même et la livraison finit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  await atDelivery($, clock, w, [run])
  const text = await ship($, clock)
  // Avant tout rangement : la mission est close comme livrée, le résultat noté, et l'issue dit que le tableau de bord mène la suite.
  expect(text).toMatch(/Delivery done/)
  expect(text).toMatch(/closed as delivered by the dashboard, not archived/)
  expect(text).toMatch(/« rangement », is run by the dashboard itself[^]*never report its outcome/)
  // La carte de rétro de la mission livrée est posée avant le rangement.
  expect(text).toMatch(/offers the retro of each delivered mission/)
  expect(stored(w).runs.find(r => r.id === run.id)!.status).toBe('done')
  expect(tidyOf(w).status).toBe('todo')
  gleaned(w, [run.id])
  jalon(w)
  await settle(clock, 6)
  if (!canProveJalons) return
  // Rien de dû : faite par le tableau de bord, la livraison finie, aucun message envoyé.
  expect(tidyOf(w)).toEqual(expect.objectContaining({ status: 'done', detail: 'rien à ranger' }))
  expect((w.mem[KEY] as any).finishedAt).toBeDefined()
  expect(w.prompts.filter(p => /rangement|Tidy-up/.test(p))).toEqual([])
  expect(w.runs).toEqual(['project:version', 'project:push'])
})

test('quelque chose est dû : le rangement reste en cours, la livraison ouverte (pas d’archivage, pas d’autre livraison) ; Claude ne rend pas son issue', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  const other = validated(T0, 'Autre mission', 'autre-mission')
  await atDelivery($, clock, w, [run, toClose(T0)])
  await ship($, clock)
  await settle(clock, 6)
  expect(tidyOf(w).status).toBe('running')
  expect((w.mem[KEY] as any).finishedAt).toBeUndefined()
  // L'issue rendue par Claude est refusée.
  expect(await report($, 'rangement', true, 'fait')).toMatch(/refused: the « rangement » step is run by the dashboard itself/)
  expect(tidyOf(w).status).toBe('running')
  // Une mission livrée ne s'archive pas pendant le rangement ; une autre livraison ne part pas.
  writeBoard(w, b => ({ ...b, runs: [...b.runs, other] }))
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const shown = await texts(pane)
  expect(shown).toMatch(/rangement en cours/)
  // Le pas à pas mène l'étape : pas de reprise à proposer, seulement la sortie.
  expect(await pane.find({ key: 'coo-deliver-resume' })).toBeUndefined()
  expect(await pane.find({ key: 'coo-deliver-finish' })).toBeDefined()
  expect(await pane.find({ key: 'coo-deliver-check' })).toBeUndefined()
  expect(await pane.find({ key: 'coo-deliver-drop' })).toBeUndefined()
  expect(await pane.find({ key: 'coo-deliver' })).toBeUndefined()
  expect(shown).not.toMatch(/✓ Archiver/)
  await pane.unmount()
  // Le relevé dit que le tableau de bord la mène.
  const said = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(said).toMatch(/its last step, « rangement » \(tidy-up\), is run by the dashboard itself/)
  expect(said).toMatch(/never report it with the flow tool/)
})

test('« ✕ Finir sans ranger » : la livraison finit, rien de livré ne change, le rangement noté fini sans ranger ; une livraison suivante a son rangement', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  await atDelivery($, clock, w, [run, toClose(T0)])
  await ship($, clock)
  await settle(clock, 6)
  const before = stored(w).runs.find(r => r.id === run.id)
  const coordBefore = entries(w)
  await press($, 'coo-deliver-finish')
  const d = w.mem[KEY] as any
  expect(d.finishedAt).toBeDefined()
  expect(d.steps.slice(0, 3).map((s: any) => s.status)).toEqual(['done', 'done', 'done'])
  expect(tidyOf(w)).toEqual(expect.objectContaining({ status: 'failed', detail: 'fini sans ranger' }))
  expect(stored(w).runs.find(r => r.id === run.id)).toEqual(before)
  expect(entries(w)).toEqual(coordBefore)
  expect(w.toasts.some(t => t.includes('Livraison finie sans ranger'))).toBe(true)
  // La livraison suivante part, avec son étape de rangement.
  writeBoard(w, b => ({ ...b, runs: [...b.runs, validated(T0, 'Mission suivante', 'mission-suivante')] }))
  await settle(clock, 6)
  await press($, 'coo-deliver')
  expect((w.mem[KEY] as any).steps.map((s: any) => s.key)).toEqual(['version', 'push', 'project', 'rangement'])
})

test('« ✕ Finir sans ranger » cliqué pendant un tour : accepté, la livraison finit à la fin du tour', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem[KEY] = kept(run, { status: 'running', at: T0 - 1_000 })
  await atDelivery($, clock, w, [run, toClose(T0)])
  await $.turn.start({ turnId: 't1', text: 'un tour' } as any)
  await press($, 'coo-deliver-finish')
  expect((w.mem[KEY] as any).finishedAt).toBeUndefined()
  expect(w.toasts.some(t => t.includes('la livraison finit à la fin du tour'))).toBe(true)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((w.mem[KEY] as any).finishedAt).toBeDefined()
  expect(tidyOf(w).detail).toBe('fini sans ranger')
})

test('reprise après rechargement : la carte propose « ▶ Reprendre à rangement » et la sortie, jamais « ↻ Demander l’issue » ; la reprise ne change pas l’étape', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem[KEY] = kept(run, { status: 'running', at: T0 - 1_000 })
  await atDelivery($, clock, w, [run, toClose(T0)])
  await settle(clock, 6)
  // Rien ne repart sans clic.
  expect(tidyOf(w).status).toBe('running')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/rangement en cours/)
  expect(await pane.find({ key: 'coo-deliver-check' })).toBeUndefined()
  await pane.press({ key: 'coo-deliver-resume' })
  await pane.unmount()
  // Encore dû : l'étape reste en cours, rien d'écrit ne change.
  expect(tidyOf(w)).toEqual({ key: 'rangement', status: 'running', at: T0 - 1_000 })
})

test('reprise après rechargement, rien de dû : le rangement se rend fait et la livraison finit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem[KEY] = kept(run, { status: 'running', at: T0 - 1_000 })
  gleaned(w, [run.id])
  jalon(w)
  await atDelivery($, clock, w, [run])
  // Le rattrapage des clôtures continue pendant le rangement : la mission en pause est close comme livrée.
  expect(stored(w).runs.find(r => r.id === run.id)!.status).toBe('done')
  await press($, 'coo-deliver-resume')
  if (!canProveJalons) return
  expect(tidyOf(w).status).toBe('done')
  expect((w.mem[KEY] as any).finishedAt).toBeDefined()
})

test('étape arrêtée : « ↻ Réessayer » la relance sur la liste recalculée, « ✕ Finir sans ranger » finit la livraison', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem[KEY] = kept(run, { status: 'failed', at: T0 - 1_000, detail: 'fermetures pas faites' })
  gleaned(w, [run.id])
  jalon(w)
  await atDelivery($, clock, w, [run])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/arrêtée à rangement/)
  expect(await pane.find({ key: 'coo-deliver-finish' })).toBeDefined()
  expect(await pane.find({ key: 'coo-deliver-drop' })).toBeUndefined()
  await pane.press({ key: 'coo-deliver-retry' })
  await pane.unmount()
  if (!canProveJalons) return
  // Plus rien de dû à la relance : faite.
  expect(tidyOf(w).status).toBe('done')
  expect((w.mem[KEY] as any).finishedAt).toBeDefined()
})

test('l’écriture de l’étape ratée : rien ne part, le message le dit ; la lecture ratée : la carte le dit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  await atDelivery($, clock, w, [run])
  await ship($, clock)
  w.probe.refuseStore = key => key === KEY
  await settle(clock, 6)
  w.probe.refuseStore = undefined
  expect(tidyOf(w).status).toBe('todo')
  expect(w.toasts.some(t => t.includes('l’état de la livraison ne s’écrit pas'))).toBe(true)
  w.mem[KEY] = { v: 1, id: 'd1', steps: 'x' }
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/L’état de la livraison ne se lit pas/)
  await pane.unmount()
})

test('une livraison gardée d’avant le rangement finit à sa dernière étape du projet, sans rangement', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem[KEY] = { ...kept(run, {}), steps: [{ key: 'version', status: 'done' }, { key: 'push', status: 'done' }, { key: 'project', status: 'running', at: T0 - 1_000 }] }
  await atDelivery($, clock, w, [run, toClose(T0)])
  expect(await report($, 'project', true, 'fait')).toMatch(/Delivery done/)
  expect((w.mem[KEY] as any).finishedAt).toBeDefined()
  expect(tidyOf(w)).toBeUndefined()
  await settle(clock, 6)
  expect(w.prompts.filter(p => /Tidy-up task/.test(p))).toEqual([])
})

test('un rangement marqué fait dans une copie forgée : il ne part pas par la livraison, ce qui est dû revient en tête du relevé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem[KEY] = kept(run, { status: 'done' }, { finishedAt: T0 - 500 })
  await atDelivery($, clock, w, [run, toClose(T0)])
  await settle(clock, 6)
  expect(w.prompts.filter(p => /Tidy-up task/.test(p))).toEqual([])
  const said = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(said).toContain('TIDY-UP TASK DUE NOW')
  expect(said).toContain(UUID)
})

test('siège perdu pendant le rangement : rien ne part d’ici, la carte reste « à reprendre » pour qui prend le siège', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem[KEY] = kept(run, { status: 'running', at: T0 - 1_000 })
  await atDelivery($, clock, w, [run])
  writeBoard(w, b => ({ ...b, coo: seatOf('session-B', T0 + 1_000) }))
  await settle(clock, 6)
  // La carte n'offre plus rien d'ici, et rien n'a changé dans l'état gardé, que la discussion qui tient le siège relira.
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'coo-deliver-resume' })).toBeUndefined()
  expect(await pane.find({ key: 'coo-deliver-finish' })).toBeUndefined()
  await pane.unmount()
  expect(tidyOf(w)).toEqual({ key: 'rangement', status: 'running', at: T0 - 1_000 })
  expect((w.mem[KEY] as any).finishedAt).toBeUndefined()
})

/** Le tour d'un message de tâche : commencé, puis fini. */
let turnNo = 0
const turn = async ($: any, isAborted = false) => {
  const turnId = `r${++turnNo}`
  await $.turn.start({ turnId, text: 'tâche' } as any)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted, turnId, reason: isAborted ? 'aborted' : 'answer' })
}

const coordinate = async ($: any, input: unknown) => String(((await $.tool.call({ tool: TOOL, coordinate: input } as any)) as any).result)

/** Les messages de tâche envoyés, par leur nature (« Jalons », « fermetures », « relevé »…), dans l'ordre. */
const kinds = (w: World): string[] => w.prompts.flatMap(p => /Tidy-up task « ([^»]+) »/.exec(p)?.[1] ?? [])

/** Fait la dernière tâche envoyée, comme le Claude du COO, sauf celles nommées dans `skip`. */
const doLast = async ($: any, w: World, skip: string[] = []) => {
  const last = w.prompts.at(-1) ?? ''
  const kind = /Tidy-up task « ([^»]+) »/.exec(last)?.[1] ?? ''
  if (skip.includes(kind)) return
  if (kind === 'Jalons') jalon(w)
  if (kind === 'fermetures') {
    await coordinate($, { toClose: [UUID] })
    await coordinate($, { discussionsClosed: [{ session: UUID, state: 'closed' }] })
  }
  const mission = /\(mission id « ([^»]+) »\)/.exec(last)?.[1]
  if (kind === 'relevé' && mission) gleaned(w, [...entries(w).filter((e: any) => e.kind === 'gleaned').map((e: any) => e.run), mission])
}

test('le rangement d’une livraison, pas à pas : Jalons, fermetures, chaque mission close à relever ; la carte dit où il en est ; fait, la livraison finit ; jamais ni version, ni push, ni archivage pendant l’étape', { timeoutMs: 60000 }, async ($, on) => {
  if (!canProveJalons) return
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = validated(T0, 'Mission A', 'mission-a')
  const b = validated(T0, 'Mission B', 'mission-b')
  await atDelivery($, clock, w, [a, b, toClose(T0)])
  await ship($, clock)
  const commands = w.runs.length
  await settle(clock, 6)
  expect(tidyOf(w).status).toBe('running')
  const labels: string[] = []
  for (let i = 0; i < 8 && tidyOf(w).status === 'running'; i++) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
    labels.push(await texts(pane))
    await pane.unmount()
    // Aucune mission de la livraison archivée pendant l'étape.
    expect(stored(w).runs.filter(r => r.id === a.id || r.id === b.id).every(r => r.archivedAt === undefined)).toBe(true)
    await doLast($, w)
    await turn($)
    await settle(clock, 6)
  }
  const sent = kinds(w)
  expect(sent[0]).toBe('Jalons')
  expect(sent[1]).toBe('fermetures')
  expect(sent.filter(k => k === 'relevé').length).toBeGreaterThanOrEqual(2)
  expect(sent.every((k, i) => sent.indexOf(k) === i || k === 'relevé')).toBe(true)
  // La carte a dit la tâche en cours, dont un relevé avec son rang.
  expect(labels.join('\n')).toMatch(/fermetures/)
  expect(labels.join('\n')).toMatch(/relevé de « Mission [AB] » \(\d sur \d\)/)
  expect(tidyOf(w).status).toBe('done')
  expect((w.mem[KEY] as any).finishedAt).toBeDefined()
  // Ni version ni push lancés pendant l'étape.
  expect(w.runs.slice(commands)).toEqual([])
})

test('une tâche pas faite après son renvoi : l’étape passe en échec, son détail nomme la tâche et ce qui manque ; « ↻ Réessayer » repart', { timeoutMs: 60000 }, async ($, on) => {
  if (!canProveJalons) return
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = validated(T0, 'Mission A', 'mission-a')
  await atDelivery($, clock, w, [a])
  await ship($, clock)
  await settle(clock, 6)
  expect(kinds(w)).toEqual(['Jalons'])
  await turn($)
  await settle(clock, 6)
  expect(w.prompts.at(-1)).toMatch(/^Not done yet after the previous message/)
  await turn($)
  await settle(clock, 6)
  expect(tidyOf(w)).toEqual(expect.objectContaining({ status: 'failed' }))
  expect(tidyOf(w).detail).toMatch(/tâche « jalon » pas faite : aucune entrée de « Jalons »/)
  // « ↻ Réessayer » : la liste recalculée, la ligne écrite entre-temps, plus rien de dû hors du relevé.
  jalon(w)
  gleaned(w, [a.id])
  await press($, 'coo-deliver-retry')
  await settle(clock, 6)
  expect(tidyOf(w).status).toBe('done')
})

test('un message de la personne pendant le rangement le désarme : la carte propose « ▶ Reprendre à rangement », qui réarme le pas à pas sur la liste recalculée', { timeoutMs: 60000 }, async ($, on) => {
  if (!canProveJalons) return
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = validated(T0, 'Mission A', 'mission-a')
  await atDelivery($, clock, w, [a])
  await ship($, clock)
  await settle(clock, 6)
  expect(kinds(w)).toEqual(['Jalons'])
  await $.prompt.submit({ text: 'attends', origin: { kind: 'composer' } } as any)
  await turn($)
  await settle(clock, 6)
  // Désarmé : rien de plus ne part, la carte propose la reprise.
  expect(kinds(w)).toEqual(['Jalons'])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'coo-deliver-resume' })).toBeDefined()
  await pane.unmount()
  await press($, 'coo-deliver-resume')
  await settle(clock, 6)
  expect(kinds(w)).toEqual(['Jalons', 'Jalons'])
})

test('une mission de la livraison pas encore close : pas donnée ; l’attente bornée à 2 minutes, puis l’étape finit en la nommant', { timeoutMs: 60000 }, async ($, on) => {
  if (!canProveJalons) return
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  // Ouverte dans une autre discussion : sa clôture passe par le fichier de coordination, que personne n'applique ici.
  const a = { ...validated(T0, 'Mission A', 'mission-a'), status: 'active', owner: 'session-B' } as Run
  await atDelivery($, clock, w, [a])
  await ship($, clock)
  jalon(w)
  await settle(clock, 6)
  expect(kinds(w)).toEqual([])
  expect(tidyOf(w).status).toBe('running')
  await settle(clock, 125)
  expect(tidyOf(w)).toEqual(expect.objectContaining({ status: 'done' }))
  expect(tidyOf(w).detail).toMatch(/restent à relever : « Mission A »/)
})

test('la tâche des décisions note la liste montrée quand son texte part : la réponse marque cette liste vue, la tâche est faite, la suivante part', { timeoutMs: 60000 }, async ($, on) => {
  if (!canProveJalons) return
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = validated(T0, 'Mission A', 'mission-a')
  await atDelivery($, clock, w, [a])
  // Le choix arrive après le dernier relevé donné à Claude (comme après un rechargement : aucun relevé ne l'a montré) :
  // c'est le message de la tâche qui note la liste que la réponse marque vue (son texte, et le relevé qui l'accompagne).
  writeBoard(w, x => ({ ...x, runs: x.runs.map(r => (r.id === a.id ? ({ ...r, updatedAt: T0 + 2_000, decided: [{ what: 'Choix nouveau de la mission A', at: T0 + 1_000 }] } as Run) : r)) }))
  await settle(clock, 6)
  await ship($, clock)
  await settle(clock, 6)
  expect(kinds(w)).toEqual(['décisions'])
  expect(w.prompts.at(-1)).toMatch(/Choix nouveau de la mission A/)
  // Aucun relevé donné entre-temps : la liste marquée est celle que la tâche a montrée.
  expect(await coordinate($, { decisionsSeen: true })).toMatch(/Reviewed: 1 decision\(s\) marked as seen/)
  await turn($)
  await settle(clock, 6)
  expect(kinds(w)).toEqual(['décisions', 'Jalons'])
})
