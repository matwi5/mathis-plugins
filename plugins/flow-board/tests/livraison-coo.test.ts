// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { closeDelivered, emptyBoard, isDeliveredRun, newRun } from '../hooks/model.ts'
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

/** La même, avec sa phase « Version et push » encore à faire, comme les parcours du catalogue qui ont un compte rendu. */
const withVersion = (run: Run): Run => {
  const version = newRun('project:version', run.startedAt, 'v').phases[0]!
  return { ...run, phases: [...run.phases, { ...version, status: 'pending' as const, startedAt: undefined, steps: version.steps.map(s => ({ id: s.id, status: 'pending' as const })) }] } as Run
}

/** Livre d'un bout à l'autre, chaque étape réussie. */
const deliverAll = async ($: any, clock: any) => {
  await press($, 'coo-deliver')
  await report($, 'version', true, 'flow-board 0.80.0')
  await settle(clock, 6)
  await report($, 'push', true, 'main → origin/main')
  await settle(clock, 6)
  return report($, 'project', true, 'export public fait')
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

test('livrée, la mission ouverte reçoit sa clôture avec le résultat ; la mission en pause est close comme livrée par le COO, sans archivage', { timeoutMs: 20000 }, async ($, on) => {
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
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'closing', run: open.id, delivered: { version: 'flow-board 0.80.0', push: 'main → origin/main' }, report: open.reportValidatedAt })])
  const closed = stored(w).runs.find(r => r.id === paused.id)!
  expect(closed.status).toBe('done')
  expect(closed.archivedAt).toBeUndefined()
  expect(JSON.stringify(closed.log)).toContain('Livrée par le COO : version flow-board 0.80.0 · push main → origin/main')
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
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'closing', run: run.id, delivered: { version: '0.80.0', push: 'main' } })])
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

test('livraison finie : la mission active ailleurs puis mise en pause et celle en pause sont livrées, aucune archivée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const open = withVersion(validated(T0))
  const paused = withVersion(validated(T0, 'paused', 'Mission en pause'))
  await atDelivery($, clock, w, [open, paused])
  const text = await deliverAll($, clock)
  expect(text).toMatch(/closed as delivered by the dashboard, not archived/)
  await settle(clock, 2)
  expect(isDeliveredRun(stored(w).runs.find(r => r.id === paused.id)!)).toBe(true)
  // La mission ouverte attend sa discussion ; celle-ci la met en pause avant d'appliquer l'entrée : le COO la clôt lui-même.
  expect(stored(w).runs.find(r => r.id === open.id)!.status).toBe('active')
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === open.id ? { ...r, status: 'paused', owner: undefined, updatedAt: T0 + 30_000 } : r)) }))
  await settle(clock, 11)
  const after = stored(w).runs.filter(r => r.id === open.id || r.id === paused.id)
  expect(after.map(isDeliveredRun)).toEqual([true, true])
  expect(after.map(r => r.archivedAt)).toEqual([undefined, undefined])
  expect(entries(w)).toEqual([expect.objectContaining({ run: open.id, doneAt: expect.any(Number) })])
  // Relevés suivants : plus rien ne s'écrit sur les missions closes comme livrées.
  const writes = stored(w).runs.map(r => r.updatedAt)
  await settle(clock, 11)
  expect(stored(w).runs.map(r => r.updatedAt)).toEqual(writes)
})

test('une mission reprise dans sa discussion juste avant la fin de la livraison n’est pas touchée par le COO : elle reçoit l’entrée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const paused = withVersion(validated(T0, 'paused', 'Mission en pause'))
  await atDelivery($, clock, w, [paused])
  await press($, 'coo-deliver')
  await report($, 'version', true, 'flow-board 0.80.0')
  await settle(clock, 6)
  await report($, 'push', true, 'main → origin/main')
  await settle(clock, 6)
  // B reprend la mission avant la fin : le COO relit le fichier et lui écrit l'entrée, sans toucher la mission.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === paused.id ? { ...r, status: 'active', owner: 'session-B', updatedAt: T0 + 20_000 } : r)) }))
  const before = JSON.stringify(stored(w).runs.find(r => r.id === paused.id))
  expect(await report($, 'project', true, 'export public fait')).toMatch(/close requested with the result/)
  await settle(clock, 6)
  expect(JSON.stringify(stored(w).runs.find(r => r.id === paused.id))).toBe(before)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'closing', run: paused.id, delivered: expect.any(Object) })])
})

test('du travail relancé dans une mission pendant sa livraison : la fin de la livraison ne la marque pas livrée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const paused = withVersion(validated(T0, 'paused', 'Mission en pause'))
  await atDelivery($, clock, w, [paused])
  await press($, 'coo-deliver')
  await report($, 'version', true, 'flow-board 0.80.0')
  await settle(clock, 6)
  await report($, 'push', true, 'main → origin/main')
  await settle(clock, 6)
  // Un /implement sur ses tickets, avant la dernière étape : l'Implémentation rouverte, le compte rendu à refaire.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === paused.id ? { ...r, phases: r.phases.map(p => (p.skill === 'implement' ? { ...p, status: 'active' as const } : p.skill === 'compte-rendu' ? { ...p, status: 'pending' as const } : p)), cursor: 0, updatedAt: T0 + 20_000 } : r)) }))
  expect(await report($, 'project', true, 'export public fait')).toMatch(/work was relaunched in it since the delivery started/)
  await settle(clock, 11)
  const after = stored(w).runs.find(r => r.id === paused.id)!
  expect(after.status).toBe('paused')
  expect(isDeliveredRun(after)).toBe(false)
  expect(entries(w)).toEqual([])
})

// ─── Le rattrapage des clôtures ratées ────────────────────────────────────

/** Une livraison finie et poussée, gardée dans le stockage du COO, qui a emporté ces missions. */
const pushedDelivery = (runs: Run[], id = 'd1') => ({ v: 1, id, missions: runs.map(r => ({ id: r.id, title: r.title, validatedAt: r.reportValidatedAt })), steps: [{ key: 'version', status: 'done', detail: '0.80.0' }, { key: 'push', status: 'done', detail: 'main' }, { key: 'project', status: 'done' }], startedAt: T0 - 9_000, finishedAt: T0 - 1_000 })

test('l’écriture du fichier des missions refusée à la fin de la livraison : la mission est livrée au relevé suivant', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const paused = withVersion(validated(T0, 'paused', 'Mission en pause'))
  await atDelivery($, clock, w, [paused])
  await press($, 'coo-deliver')
  await report($, 'version', true, 'flow-board 0.80.0')
  await settle(clock, 6)
  await report($, 'push', true, 'main → origin/main')
  await settle(clock, 6)
  // Toute écriture qui clôt la mission est refusée.
  w.probe.refuseBoard = text => (JSON.parse(text) as { runs: Run[] }).runs.some(r => r.id === paused.id && r.status === 'done')
  w.probe.refuseStore = key => key === 'board:' && w.probe.refuseBoard !== undefined
  expect(await report($, 'project', true, 'export public fait')).toMatch(/could not be closed just now: the dashboard retries by itself/)
  await settle(clock, 6)
  expect(stored(w).runs.find(r => r.id === paused.id)!.status).toBe('paused')
  // L'entrée garde la clôture à faire, même une fois une autre livraison partie.
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'closing', run: paused.id, report: paused.reportValidatedAt })])
  // L'écriture acceptée de nouveau : le relevé suivant la clôt comme livrée.
  w.probe.refuseBoard = undefined
  w.probe.refuseStore = undefined
  await settle(clock, 11)
  expect(isDeliveredRun(stored(w).runs.find(r => r.id === paused.id)!)).toBe(true)
  expect(stored(w).runs.find(r => r.id === paused.id)!.archivedAt).toBeUndefined()
  expect(entries(w)).toEqual([expect.objectContaining({ run: paused.id, doneAt: expect.any(Number) })])
})

test('une demande restée d’un rapport dont le travail a été relancé ne retient pas l’entrée de la dernière livraison', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const open = withVersion(validated(T0))
  // Une demande d'une livraison plus ancienne, d'un rapport d'avant le travail refait depuis, jamais notée faite.
  w.coord.text = JSON.stringify({ v: 1, root: '', entries: [{ id: 'cold1234', kind: 'closing', run: open.id, at: T0 - 95_000, delivered: { push: 'main' }, report: T0 - 90_000 }] })
  w.mem['coo-delivery:'] = pushedDelivery([open])
  await atDelivery($, clock, w, [open])
  await settle(clock, 11)
  expect(entries(w).filter(e => e.run === open.id && e.report === open.reportValidatedAt)).toHaveLength(1)
})

test('après un rechargement, la mission en pause d’une livraison poussée restée non close est livrée au relevé ; le second relevé n’écrit rien', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const paused = withVersion(validated(T0, 'paused', 'Mission en pause'))
  // Une mission ancienne, sans phase « Version et push », dans la même livraison.
  const old = validated(T0, 'paused', 'Mission ancienne')
  w.mem['coo-delivery:'] = pushedDelivery([paused, old])
  await atDelivery($, clock, w, [paused, old])
  await settle(clock, 6)
  const after = stored(w).runs
  expect(isDeliveredRun(after.find(r => r.id === paused.id)!)).toBe(true)
  expect(after.find(r => r.id === old.id)!.status).toBe('done')
  expect(after.map(r => r.archivedAt)).toEqual([undefined, undefined])
  const text = w.disk.board ?? JSON.stringify(w.mem['board:'])
  await settle(clock, 11)
  expect(w.disk.board ?? JSON.stringify(w.mem['board:'])).toBe(text)
  expect(w.coord.writes).toEqual([])
})

test('la mission d’une livraison poussée active ailleurs sans entrée qui attend : une seule entrée réécrite, puis rien ; reprise ou travail relancé : rien', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const open = withVersion(validated(T0))
  const relaunched = { ...withVersion(validated(T0, 'paused', 'Mission relancée')), id: 'mission-relancee' }
  const relaunchedNow = { ...relaunched, cursor: 0, phases: relaunched.phases.map(p => (p.skill === 'implement' ? { ...p, status: 'active' as const } : p.skill === 'compte-rendu' ? { ...p, status: 'pending' as const } : p)) } as Run
  // Relancé puis fini depuis : l'Implémentation refaite après le rapport livré, le compte rendu à refaire.
  const finished = { ...withVersion(validated(T0, 'paused', 'Mission refaite')), id: 'mission-refaite' }
  const finishedNow = { ...finished, cursor: 1, phases: finished.phases.map(p => (p.skill === 'implement' ? { ...p, status: 'done' as const, finishedAt: T0 - 500 } : p.skill === 'compte-rendu' ? { ...p, status: 'active' as const } : p)) } as Run
  // Livrée puis reprise dans une autre discussion : sa livraison marquée, active de nouveau.
  const shipped = { ...withVersion(validated(T0, 'paused', 'Mission reprise')), id: 'mission-reprise' }
  const shippedNow = { ...closeDelivered({ ...emptyBoard('', 'p'), runs: [shipped], activeId: null, session: 'coo' }, shipped.id, T0 - 800, { push: 'main' })!.board.runs[0]!, status: 'active' as const, owner: 'session-C', updatedAt: T0 - 700 }
  w.mem['coo-delivery:'] = pushedDelivery([open, relaunched, finished, shipped])
  await atDelivery($, clock, w, [open, relaunchedNow, finishedNow, shippedNow])
  await settle(clock, 11)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'closing', run: open.id, delivered: expect.any(Object), report: open.reportValidatedAt })])
  expect(w.sends.filter(s => s.to && JSON.stringify(s.to).includes('session-B'))).toHaveLength(1)
  // Le travail relancé n'est jamais marqué livré.
  expect(stored(w).runs.find(r => r.id === relaunched.id)!.status).toBe('paused')
  expect(isDeliveredRun(stored(w).runs.find(r => r.id === relaunched.id)!)).toBe(false)
  expect(stored(w).runs.find(r => r.id === finished.id)!.status).toBe('paused')
  // La mission livrée puis reprise : ni entrée ni réveil, rien d'écrit.
  expect(JSON.stringify(stored(w).runs.find(r => r.id === shipped.id))).toBe(JSON.stringify(shippedNow))
  expect(w.sends.filter(s => s.to && JSON.stringify(s.to).includes('session-C'))).toEqual([])
})

test('une mission de la livraison d’avant restée non close entre dans la carte « ▶ Livrer » suivante et en sort livrée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const left = withVersion(validated(T0, 'paused', 'Mission oubliée'))
  // La mission oubliée vient d'une livraison plus ancienne, que la dernière poussée (qui n'a emporté qu'une autre
  // mission, close depuis) a remplacée dans l'état gardé : elle revient à la carte, et cette livraison la clôt.
  const otherDone = { ...validated(T0, 'done', 'Autre mission'), id: 'autre-mission' }
  w.mem['coo-delivery:'] = pushedDelivery([otherDone], 'd0')
  writeBoard(w, b => ({ ...b, runs: [left, otherDone] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/Mission oubliée/)
  await pane.unmount()
  expect(await deliverAll($, clock)).toMatch(/Delivery done/)
  await settle(clock, 6)
  expect(isDeliveredRun(stored(w).runs.find(r => r.id === left.id)!)).toBe(true)
  // L'autre mission, close et sans rien à marquer, n'a pas été réécrite.
  expect(stored(w).runs.find(r => r.id === otherDone.id)!.updatedAt).toBe(otherDone.updatedAt)
})
