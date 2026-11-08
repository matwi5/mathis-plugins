// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { newRun } from '../hooks/model.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, entries, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// La livraison lancée chez le COO (« ▶ Livrer »). Invariant : « Rien n'est poussé sans un clic "▶ Livrer" de
// l'utilisateur ; une étape de la livraison ne part que si la précédente a réussi ; une seule livraison à la fois. »

const T0 = 500_000_000

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

/** Une mission d'une autre discussion, son rapport validé : elle attend sa livraison. */
const validated = (now: number, status: Run['status'] = 'active', title = 'Mission de B'): Run => {
  const run = newRun('implement', now - 90_000, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: now - 50_000, finishedAt: now - 40_000, steps: [], items: [] }
  return { ...run, phases: [done, report], cursor: 1, status, reportValidatedAt: now - 40_000, ...(status === 'active' ? { owner: 'session-B' } : {}), updatedAt: now - 1_000 } as Run
}

/** Le COO tient le siège, une mission au rapport validé. */
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

test('la carte « ▶ Livrer » paraît pour un rapport validé ; rien ne part sans le clic', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await atDelivery($, clock, w, [validated(T0)])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/Livraison de « Mission de B »/)
  expect(await pane.find({ key: 'coo-deliver' })).toBeDefined()
  await pane.unmount()
  await settle(clock, 10)
  expect(w.runs).toEqual([])
  // Une issue rendue sans livraison lancée ne lance rien.
  expect(await report($, 'version', true)).toMatch(/refused/)
  await settle(clock, 6)
  expect(w.runs).toEqual([])
})

test('le clic lance /project:version, puis chaque étape seulement sur la réussite de la précédente', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await atDelivery($, clock, w, [validated(T0)])
  await press($, 'coo-deliver')
  expect(w.runs).toEqual(['project:version'])
  // Le skill de l'étape dit à Claude de rendre son issue, et de ne lancer rien d'autre.
  expect((await $.skill.prompt({ skill: 'project:version', text: 'v' })).text).toMatch(/report its outcome[\s\S]*Never run the next step yourself/)
  // Pas d'issue rendue : rien d'autre ne part.
  await settle(clock, 10)
  expect(w.runs).toEqual(['project:version'])
  expect(await report($, 'version', true, 'flow-board 0.80.0')).toMatch(/recorded as done/)
  await settle(clock, 6)
  expect(w.runs).toEqual(['project:version', 'project:push'])
  // L'échec arrête la suite : ni l'étape du projet, ni rien d'autre.
  expect(await report($, 'push', false, 'rejeté par le distant')).toMatch(/stopped/)
  await settle(clock, 10)
  expect(w.runs).toEqual(['project:version', 'project:push'])
  expect(w.prompts.some(p => /Livraison lancée chez le COO/.test(p))).toBe(false)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/arrêtée à \/project:push/)
  await pane.unmount()
  // « ↻ Réessayer » refait l'étape échouée seule, jamais la version déjà posée.
  await press($, 'coo-deliver-retry')
  expect(w.runs).toEqual(['project:version', 'project:push', 'project:push'])
})

test('une seule livraison à la fois : un second clic ne lance rien', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await atDelivery($, clock, w, [validated(T0)])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  // Deux clics croisés : un seul /project:version, une seule livraison.
  await Promise.all([pane.press({ key: 'coo-deliver' }), pane.press({ key: 'coo-deliver' })])
  await pane.unmount()
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await again.find({ key: 'coo-deliver' })).toBeUndefined()
  await again.unmount()
  await settle(clock, 10)
  expect(w.runs).toEqual(['project:version'])
})

test('rechargé pendant une livraison : la carte dit où elle en était et ne reprend que sur un clic, à l’étape suivante', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  // L'état d'avant le rechargement : la version faite, le push pas encore lancé.
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }], steps: [{ key: 'version', status: 'done', at: T0 - 5_000, detail: '0.80.0' }, { key: 'push', status: 'todo' }, { key: 'project', status: 'todo' }], startedAt: T0 - 9_000 }
  await atDelivery($, clock, w, [run])
  await settle(clock, 10)
  expect(w.runs).toEqual([])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/à reprendre à \/project:push/)
  await pane.press({ key: 'coo-deliver-resume' })
  await pane.unmount()
  expect(w.runs).toEqual(['project:push'])
})

test('livrée, la mission ouverte reçoit sa clôture avec le résultat ; la mission en pause est archivée par le COO', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const open = validated(T0)
  const paused = validated(T0, 'paused', 'Mission en pause')
  await atDelivery($, clock, w, [open, paused])
  await press($, 'coo-deliver')
  await report($, 'version', true, 'flow-board 0.80.0')
  await settle(clock, 6)
  await report($, 'push', true, 'main → origin/main')
  await settle(clock, 6)
  // La dernière étape, celles du CLAUDE.md du projet : un message du mod à son Claude.
  expect(w.prompts.filter(p => /Livraison lancée chez le COO/.test(p))).toHaveLength(1)
  expect(await report($, 'project', true, 'export public fait')).toMatch(/Delivery done/)
  await settle(clock, 2)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'close', run: open.id, delivered: { version: 'flow-board 0.80.0', push: 'main → origin/main' } })])
  expect(stored(w).runs.find(r => r.id === paused.id)?.archivedAt).toBeDefined()
  // Rien ne repart après la fin.
  await settle(clock, 10)
  expect(w.runs).toEqual(['project:version', 'project:push'])
})

test('« ↻ Demander l’issue » fait seulement vérifier l’étape lancée : réussie, la suite attend « ▶ Reprendre »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  // Rechargé pendant /project:version : lancée, son issue pas revenue.
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }], steps: [{ key: 'version', status: 'running', at: T0 - 5_000 }, { key: 'push', status: 'todo' }, { key: 'project', status: 'todo' }], startedAt: T0 - 9_000 }
  await atDelivery($, clock, w, [run])
  await press($, 'coo-deliver-check')
  expect(w.prompts.filter(p => /Ne la refais pas/.test(p))).toHaveLength(1)
  expect(w.runs).toEqual([])
  expect(await report($, 'version', true, '0.80.0')).toMatch(/recorded as done/)
  await settle(clock, 10)
  // Rien ne part sans « ▶ Reprendre ».
  expect(w.runs).toEqual([])
  await press($, 'coo-deliver-resume')
  expect(w.runs).toEqual(['project:push'])
})

test('une mission livrée ne redevient pas livrable, même sans fichier de coordination lisible', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }], steps: [{ key: 'version', status: 'done' }, { key: 'push', status: 'done' }, { key: 'project', status: 'done' }], startedAt: T0 - 9_000, finishedAt: T0 - 1_000 }
  await atDelivery($, clock, w, [run])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'coo-deliver' })).toBeUndefined()
  await pane.unmount()
})

test('abandonnée après le push réussi : les missions se closent avec ce qui est fait, et ne se relivrent pas', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }], steps: [{ key: 'version', status: 'done', detail: '0.80.0' }, { key: 'push', status: 'done', detail: 'main' }, { key: 'pr', status: 'failed', detail: 'refusée' }, { key: 'project', status: 'todo' }], startedAt: T0 - 9_000 }
  await atDelivery($, clock, w, [run])
  await press($, 'coo-deliver-drop')
  await settle(clock, 2)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'close', run: run.id, delivered: { version: '0.80.0', push: 'main' } })])
  w.coord.text = undefined
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'coo-deliver' })).toBeUndefined()
  await pane.unmount()
  expect(w.runs).toEqual([])
})

test('une mission qui a livré dans sa propre discussion n’est pas proposée à « ▶ Livrer »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  const versioned = { ...run, phases: [...run.phases, { ...run.phases[1]!, skill: 'project:version', status: 'done' as const }] } as Run
  await atDelivery($, clock, w, [versioned])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'coo-deliver' })).toBeUndefined()
  await pane.unmount()
})
