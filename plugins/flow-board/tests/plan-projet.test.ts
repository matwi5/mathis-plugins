// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { hasWaitCycle, projectPlan, soundPlanWait, waitsKey, type PlanUnit } from '../hooks/plan-projet.ts'
import { applyReport, emptyBoard, groupPlan, holdMapOf, newRun, nextLaunchFor, outsideHolds, planHolds, projectUnits, unitsOverlap } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, seatOf, settle, start, stored, world, writeBoard } from './monde-coordination.ts'
import { cooStatement, statementText } from '../hooks/coo.ts'
import { CORPUS } from './corpus.mjs'

// Le plan des vagues du projet, calculé par le code. Invariant : « Un groupe ne part jamais avant ce que
// le plan validé lui fait attendre, sauf forçage ; un plan illisible ne lance rien, et les retenues de
// fichiers restent. »

const unit = (run: string, group: string, over: Partial<PlanUnit> = {}): PlanUnit => ({ run, title: `Mission ${run}`, group, isBusy: false, after: [], ...over })
/** Les conflits, par paires de clés « mission/groupe ». */
const conflicts = (pairs: [string, string][]) => (a: PlanUnit, b: PlanUnit) =>
  pairs.some(([x, y]) => (x === `${a.run}/${a.group}` && y === `${b.run}/${b.group}`) || (y === `${a.run}/${a.group}` && x === `${b.run}/${b.group}`))
const waveNames = (p: ReturnType<typeof projectPlan>) => p.waves.map(w => w.units.map(u => `${u.run}/${u.group}`).sort().join(' ∥ '))

test('l’exemple du ticket : la mission 1 propose A ∥ B ∥ C, et C touche les fichiers de D et E de la mission 2 ; le plan fait partir A ∥ B ∥ D ∥ E, puis C', () => {
  const plan = projectPlan([unit('m1', 'A'), unit('m1', 'B'), unit('m1', 'C'), unit('m2', 'D'), unit('m2', 'E')], conflicts([['m1/C', 'm2/D'], ['m1/C', 'm2/E']]))
  expect(waveNames(plan)).toEqual(['m1/A ∥ m1/B ∥ m2/D ∥ m2/E', 'm1/C'])
  expect(plan.waits).toEqual([
    { run: 'm1', group: 'C', awaited: { run: 'm2', group: 'D' } },
    { run: 'm1', group: 'C', awaited: { run: 'm2', group: 'E' } },
  ])
  // La mission 2 finit à la première vague : sa livraison suit cette vague ; la mission 1 se livre après la seconde.
  expect(plan.waves[0]!.deliveries.map(d => d.run)).toEqual(['m2'])
  expect(plan.waves[1]!.deliveries.map(d => d.run)).toEqual(['m1'])
})

test('sans conflit, tout part ensemble et rien n’attend ; un conflit de ressource compte comme un fichier', () => {
  const free = projectPlan([unit('m1', 'A'), unit('m2', 'D')], () => false)
  expect(waveNames(free)).toEqual(['m1/A ∥ m2/D'])
  expect(free.waits).toEqual([])
  // Le conflit (fichier ou ressource) est ce que dit `overlaps` : une seule paire, une seule attente.
  const held = projectPlan([unit('m1', 'A'), unit('m2', 'D')], conflicts([['m1/A', 'm2/D']]))
  expect(waveNames(held)).toEqual(['m1/A', 'm2/D'])
  expect(held.waits).toEqual([{ run: 'm2', group: 'D', awaited: { run: 'm1', group: 'A' } }])
})

test('les dépendances d’une mission sont gardées, et un groupe déjà parti reste dans la première vague', () => {
  // B attend A dans la mission 1 ; D est déjà parti dans la mission 2 et touche les fichiers de A.
  const plan = projectPlan([unit('m1', 'A'), unit('m1', 'B', { after: ['A'] }), unit('m2', 'D', { isBusy: true })], conflicts([['m1/A', 'm2/D']]))
  expect(waveNames(plan)).toEqual(['m2/D', 'm1/A', 'm1/B'])
  expect(plan.waits).toEqual([{ run: 'm1', group: 'A', awaited: { run: 'm2', group: 'D' } }])
  // Un groupe déjà parti n'attend jamais.
  expect(plan.waits.some(w => w.group === 'D')).toBe(false)
})

test('une attente vers un groupe que le plan ne connaît pas (fini) est passée ; une attente circulaire ne bloque pas le calcul', () => {
  expect(waveNames(projectPlan([unit('m1', 'B', { after: ['A'] })], () => false))).toEqual(['m1/B'])
  const loop = projectPlan([unit('m1', 'A', { after: ['B'] }), unit('m1', 'B', { after: ['A'] })], () => false)
  expect(waveNames(loop)).toEqual(['m1/A ∥ m1/B'])
})

test('une attente relue se contrôle ; deux plans aux mêmes attentes ont la même clé', () => {
  expect(soundPlanWait({ run: 'm1', held: 'C', awaited: { run: 'm2', group: 'D' } })).toEqual({ run: 'm1', group: 'C', awaited: { run: 'm2', group: 'D' } })
  for (const bad of [{ run: '../m1', held: 'C', awaited: { run: 'm2', group: 'D' } }, { run: 'm1', held: 'C D', awaited: { run: 'm2', group: 'D' } }, { run: 'm1', held: 'C', awaited: { run: 'm1', group: 'D' } }, null, 'x'])
    expect(soundPlanWait(bad)).toBeNull()
  const a = [{ run: 'm1', group: 'C', awaited: { run: 'm2', group: 'D' } }, { run: 'm1', group: 'C', awaited: { run: 'm2', group: 'E' } }]
  expect(waitsKey(a)).toBe(waitsKey([...a].reverse()))
  expect(waitsKey(a)).not.toBe(waitsKey(a.slice(1)))
})

// ─── Sur les missions du projet ───────────────────────────────────────────

const T0 = 500_000_000

/** La mission 1 de l'exemple : A, B, et C, qui touche les fichiers de D et de E de la mission 2. */
const example1 = (at: number, owner?: string): Run => {
  const m = mission('Mission 1', at, { A: 'a.ts', B: 'b.ts', C: 'd.ts' }, owner)
  return { ...m, groups: m.groups!.map(g => (g.id === 'C' ? { ...g, files: ['e.ts'] } : g)) }
}

/** Une mission dans l'implémentation, avec ses tickets (et leurs fichiers) et ses groupes. */
const mission = (title: string, at: number, groups: Record<string, string>, owner?: string): Run => {
  const run = newRun('implement', at, title)
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const ids = Object.keys(groups)
  const report = { tickets: ids.map(g => ({ id: `t${g}`, name: g, files: [groups[g]!] })), groups: ids.map(g => ({ id: g, name: g, tickets: [`t${g}`] })) }
  return { ...(applyReport(board, report, at + 1).board.runs[0] as Run), status: 'active', ...(owner ? { owner } : {}) }
}

test('sur les missions du projet : l’exemple, puis l’attente imposée à la mission retenue ; elle se lève quand le groupe attendu est clos', () => {
  const m1 = example1(T0)
  const m2b = mission('Mission 2', T0, { D: 'd.ts', E: 'e.ts' })
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [m1, m2b], activeId: m1.id }
  const plan = projectPlan(projectUnits(board), unitsOverlap)
  expect(plan.waves.map(w => w.units.map(u => `${u.title}/${u.group}`).sort())).toEqual([['Mission 1/A', 'Mission 1/B', 'Mission 2/D', 'Mission 2/E'], ['Mission 1/C']])
  const holds = planHolds(board, m1.id, plan.waits)
  expect(holds.map(h => `${h.held}>${h.group}:${h.on}`)).toEqual(['C>D:plan', 'C>E:plan'])
  // La mission 1 ne propose que A ∥ B ; C attend.
  expect(nextLaunchFor(m1, holdMapOf(holds))).toEqual({ kind: 'parallel', groups: ['A', 'B'] })
  expect(groupPlan(m1, holdMapOf(holds))!.groups.find(g => g.group.id === 'C')!.state).toBe('waiting')
  // D clos (rendu, worker fermé) : l'attente se lève d'elle-même, sans COO.
  const closed: Run = { ...m2b, tickets: m2b.tickets.map(t => (t.id === 'tD' ? { ...t, status: 'done' as const } : t)), groups: m2b.groups!.map(g => (g.id === 'D' ? { ...g, delegated: { at: T0, closing: { state: 'closed' as const, at: T0 + 1 } } } : g)) }
  expect(planHolds({ ...board, runs: [m1, closed] }, m1.id, plan.waits).map(h => h.group)).toEqual(['E'])
  // Un forçage du plan pour la paire la lève aussi, cette paire seulement ; celui d'une retenue de fichier ne la lève pas.
  expect(planHolds(board, m1.id, plan.waits, [{ held: 'C', run: m2b.id, group: 'D', on: 'plan' }]).map(h => h.group)).toEqual(['E'])
  expect(planHolds(board, m1.id, plan.waits, [{ held: 'C', run: m2b.id, group: 'D' }]).map(h => h.group)).toEqual(['D', 'E'])
  // Et un forçage du plan ne lève jamais la retenue de fichier : D parti, C reste retenu par le fichier en commun.
  const dGone: Run = { ...m2b, groups: m2b.groups!.map(g => (g.id === 'D' ? { ...g, linked: { at: T0 } } : g)) }
  const both = { ...board, runs: [{ ...m1, forced: [{ held: 'C', run: m2b.id, group: 'D', at: T0, on: 'plan' as const }] }, dGone] }
  expect(outsideHolds(both, m1.id).map(h => `${h.held}>${h.group}:${h.on}`)).toEqual(['C>D:file'])
  expect(planHolds(both, m1.id, plan.waits).map(h => h.group)).toEqual(['E'])
  // Une ressource commune compte comme un fichier.
  const r1 = mission('R1', T0, { A: 'r1.ts', B: 'r1b.ts' })
  const r2 = mission('R2', T0, { D: 'r2.ts', E: 'r2e.ts' })
  const withRes = (r: Run, g: string): Run => ({ ...r, groups: r.groups!.map(x => (x.id === g ? { ...x, resources: ['PowerBI Desktop'] } : x)) })
  const resBoard: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [withRes(r1, 'B'), withRes(r2, 'D')], activeId: r1.id }
  expect(projectPlan(projectUnits(resBoard), unitsOverlap).waits.map(x => `${x.group}>${x.awaited.group}`)).toHaveLength(1)
  // Un groupe déjà parti n'attend jamais.
  const started: Run = { ...m1, groups: m1.groups!.map(g => (g.id === 'C' ? { ...g, linked: { at: T0 } } : g)) }
  expect(planHolds({ ...board, runs: [started, m2b] }, m1.id, plan.waits)).toEqual([])
})

/** La mission d'ici (A sur x.ts, B sur y.ts) et l'entrée de plan qui fait attendre A au groupe D d'une autre mission. */
const setUp = async ($: any, on: any, withSeat = true) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const other = mission('Là-bas', T0 - 6000, { D: 'z.ts', E: 'q.ts' }, 'session-B')
  // Le projet a un COO (son siège, tenu par une autre discussion) : il a donc un fichier de coordination.
  writeBoard(w, b => ({ ...b, runs: [other], ...(withSeat ? { coo: seatOf('session-COO', T0 - 1000) } : {}) }))
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ici', entry: 'implement' }, tickets: [{ id: 't1', name: 'Un', files: ['x.ts'] }, { id: 't2', name: 'Deux', files: ['y.ts'] }], groups: [{ id: 'A', name: 'Alpha', tickets: ['t1'] }, { id: 'B', name: 'Bêta', tickets: ['t2'] }] } as any)
  await settle(clock, 1)
  const here = stored(w).runs.find(r => r.title === 'Ici')!
  w.coord.text = coordFile([{ id: 'cplan0001', kind: 'plan', run: here.id, at: T0, held: 'A', awaited: { run: other.id, group: 'D' } }])
  await settle(clock, 6)
  return { clock, w, here, other }
}
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const texts = async (ui: any): Promise<string> => (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '')).join(' | ')

test('chez le manager : le groupe retenu par le plan dit ce qu’il attend, ne part pas, et repart quand le groupe attendu est clos, sans COO', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, other } = await setUp($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    const all = await texts(pane)
    expect(all, surface).toMatch(/⏸.attend.groupe.D.de « Là-bas » \(plan du projet\)/)
    // La carte « Ensuite » le dit aussi.
    expect(all, surface).toMatch(/retenu par une autre mission : groupe.A attend groupe.D de « Là-bas » \(plan du projet\)/)
    expect(await pane.find({ key: 'launch-linked-A' }), surface).toBeUndefined()
    expect(await pane.find({ key: 'launch-linked-B' }), surface).toBeDefined()
    await pane.unmount()
    const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await texts(band), surface).toMatch(/⏸.groupe.A.attend.groupe.D.de « Là-bas » \(plan du projet\)/)
    await band.unmount()
  }
  // Rechargé (/reload-plugins), le plan est relu : A attend toujours.
  await start($)
  await settle(clock, 6)
  const reloaded = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await reloaded.find({ key: 'launch-linked-A' })).toBeUndefined()
  await reloaded.unmount()
  // Le groupe attendu clos dans l'autre mission : l'attente tombe, A se propose de nouveau.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === other.id ? { ...r, updatedAt: T0 + 60_000, tickets: r.tickets.map(t => (t.id === 'tD' ? { ...t, status: 'done' as const } : t)), groups: r.groups!.map(g => (g.id === 'D' ? { ...g, delegated: { at: T0, closing: { state: 'closed' as const, at: T0 + 50_000 } } } : g)) } : r)) }))
  await settle(clock, 6)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await after.find({ key: 'launch-linked-A' })).toBeDefined()
  await after.unmount()
})

test('chez le manager : « ⇥ Forcer » fait partir le groupe malgré le plan', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here, other } = await setUp($, on)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: `force-A-${other.id}-D-plan` })
  await pane.unmount()
  await settle(clock, 2)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await after.find({ key: 'launch-linked-A' })).toBeDefined()
  await after.unmount()
  expect(stored(w).runs.find(r => r.id === here.id)!.forced).toEqual([{ held: 'A', run: other.id, group: 'D', at: expect.any(Number), on: 'plan' }])
})

test('un plan illisible (fichier de coordination, ou entrée de plan hors forme) ne lance rien, même à la main ; relu, tout repart', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await setUp($, on)
  w.coord.text = coordFile([{ id: 'cplan0002', kind: 'plan', run: here.id, at: T0, held: 'A B', awaited: { run: 'x', group: 'D' } }])
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'launch-linked-B' })
  await pane.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === here.id)!.groups!.find(g => g.id === 'B')!.linked).toBeUndefined()
  w.coord.unread = true
  await settle(clock, 6)
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await again.press({ key: 'launch-linked-B' })
  await again.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === here.id)!.groups!.find(g => g.id === 'B')!.linked).toBeUndefined()
  // Relu, sans plan : B part (le témoin).
  w.coord.unread = false
  w.coord.text = coordFile([])
  await settle(clock, 6)
  const ok = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ok.press({ key: 'launch-linked-B' })
  await ok.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === here.id)!.groups!.find(g => g.id === 'B')!.linked).toBeDefined()
})

test('chez le COO : le plan proposé se montre vague par vague, « ✓ Valider le plan » l’écrit, et il n’est plus reproposé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m1 = example1(T0 - 6000, 'session-B')
  const m2 = mission('Mission 2', T0 - 6000, { D: 'd.ts', E: 'e.ts' }, 'session-C')
  writeBoard(w, b => ({ ...b, runs: [m1, m2] }))
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/Plan of the project PROPOSED/)
  expect(opening).toMatch(/wave 1: « Mission 1 » : A, B · « Mission 2 » : D, E/)
  expect(opening).toMatch(/wave 2: « Mission 1 » : C; then deliver « Mission 1 »/)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/Plan du projet proposé · 2 vagues/)
  await pane.press({ key: 'coo-plan-validate' })
  await pane.unmount()
  await settle(clock, 2)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'plan', run: m1.id, held: 'C', awaited: { run: m2.id, group: 'D' } }), expect.objectContaining({ kind: 'plan', run: m1.id, held: 'C', awaited: { run: m2.id, group: 'E' } })])
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(after)).toMatch(/Plan du projet · 2 vagues/)
  expect(await after.find({ key: 'coo-plan-validate' })).toBeUndefined()
  await after.unmount()
})

test('chez le COO : pour une mission en auto, le plan s’écrit d’office', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m1: Run = { ...example1(T0 - 6000, 'session-B'), auto: { onAt: T0 - 5000, onBy: 'session-B' } }
  const m2 = mission('Mission 2', T0 - 6000, { D: 'd.ts', E: 'e.ts' }, 'session-C')
  writeBoard(w, b => ({ ...b, runs: [m1, m2] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  // Le plan fait attendre C de la mission 1, en auto : son entrée s'écrit sans clic.
  expect(entries(w).filter(e => e.kind === 'plan').map(e => `${e.held}>${e.awaited.group}`)).toEqual(['C>D', 'C>E'])
})

test('en auto, le groupe que le plan fait attendre ne part pas ; l’autre part seul quand son attente tombe', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here, other } = await setUp($, on)
  const planA = { id: 'cplan0001', kind: 'plan', run: here.id, at: T0, held: 'A', awaited: { run: other.id, group: 'D' } }
  // A et B attendent tous deux : rien ne part.
  w.coord.text = coordFile([planA, { id: 'cplan0003', kind: 'plan', run: here.id, at: T0, held: 'B', awaited: { run: other.id, group: 'E' } }])
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'auto-on' })
  await pane.press({ key: 'auto-confirm' })
  await pane.unmount()
  await settle(clock, 1)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 'consigne', reason: 'answer' })
  await settle(clock, 2)
  const sentBefore = w.prompts.length
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle(clock, 2)
  expect(w.prompts.length).toBe(sentBefore)
  // Le plan validé suivant ne fait plus attendre B : l'auto le lance, et lui seul.
  w.coord.text = coordFile([planA])
  await settle(clock, 7)
  const sent = w.prompts.slice(sentBefore).join('\n')
  expect(sent).toMatch(/Groupe B/)
  expect(sent).not.toMatch(/Groupe A/)
})

test('un plan qui ne change pas l’ordre n’est pas reproposé : un groupe parti entre-temps ne fait rien revalider', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m1 = example1(T0 - 6000, 'session-B')
  const m2 = mission('Mission 2', T0 - 6000, { D: 'd.ts', E: 'e.ts' }, 'session-C')
  writeBoard(w, b => ({ ...b, runs: [m1, m2] }))
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-plan-validate' })
  await pane.unmount()
  await settle(clock, 2)
  // A part dans la mission 1, D dans la mission 2 : l'ordre ne change pas.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => ({ ...r, updatedAt: T0 + 30_000, groups: r.groups!.map(g => (g.id === 'A' || g.id === 'D' ? { ...g, linked: { at: T0 + 20_000 } } : g)) })) }))
  await settle(clock, 6)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await after.find({ key: 'coo-plan-validate' })).toBeUndefined()
  await after.unmount()
})

test('le titre relu d’une mission, dans le plan du relevé du COO, ne coupe ni la ligne ni la citation, pour chaque entrée du corpus hostile', () => {
  const lineCount = (title: string) => {
    const m1 = { ...example1(T0), title }
    const m2 = mission('Mission 2', T0, { D: 'd.ts', E: 'e.ts' })
    const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [m1, m2], activeId: m1.id }
    const computed = projectPlan(projectUnits(board), unitsOverlap)
    const text = statementText(cooStatement(board, { now: T0, plan: { computed, key: waitsKey(computed.waits), isValidated: false } }))
    const line = text.split('\n').find(l => l.startsWith('- wave 2:')) ?? ''
    return { lines: text.split('\n').length, line }
  }
  const base = lineCount('Mission 1')
  const quotes = (line: string, mark: string) => line.split(mark).length - 1
  expect(quotes(base.line, '«')).toBe(2)
  const leaks = Object.entries(CORPUS).filter(([, token]) => {
    const out = lineCount(`ab${token}cd`)
    return out.lines !== base.lines || quotes(out.line, '«') !== 2 || quotes(out.line, '»') !== 2
  })
  expect(leaks.map(([name]) => name)).toEqual([])
})

test('une entrée de plan hors forme se montre chez le COO comme un plan à valider ; le valider la remplace, et la mission repart', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m1 = example1(T0 - 6000, 'session-B')
  const m2 = mission('Mission 2', T0 - 6000, { D: 'd.ts', E: 'e.ts' }, 'session-C')
  writeBoard(w, b => ({ ...b, runs: [m1, m2] }))
  w.coord.text = coordFile([{ id: 'cplan0009', kind: 'plan', run: m1.id, at: T0, held: 'C C', awaited: { run: m2.id, group: 'D' } }])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/Plan du projet proposé/)
  await pane.press({ key: 'coo-plan-validate' })
  await pane.unmount()
  await settle(clock, 2)
  // L'entrée hors forme est remplacée par le plan validé.
  expect(entries(w).map(e => e.held)).toEqual(['C', 'C'])
})

test('chez le manager en auto, une entrée de plan hors forme met l’auto en pause, et le bandeau le dit', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here, other } = await setUp($, on)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'auto-on' })
  await pane.press({ key: 'auto-confirm' })
  await pane.unmount()
  await settle(clock, 1)
  w.coord.text = coordFile([{ id: 'cplan0002', kind: 'plan', run: here.id, at: T0, held: 'A B', awaited: { run: other.id, group: 'D' } }])
  await settle(clock, 6)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await texts(band)).toMatch(/Auto.en.pause.:.plan.du.projet.illisible/)
  await band.unmount()
})

test('des attentes qui se bouclent sont repérées : d’office, le COO ne les écrit pas', () => {
  const w = (run: string, group: string, ar: string, ag: string) => ({ run, group, awaited: { run: ar, group: ag } })
  expect(hasWaitCycle([w('m1', 'C', 'm2', 'D'), w('m2', 'D', 'm1', 'C')])).toBe(true)
  expect(hasWaitCycle([w('m1', 'C', 'm2', 'D'), w('m2', 'D', 'm3', 'Y'), w('m3', 'Y', 'm1', 'C')])).toBe(true)
  expect(hasWaitCycle([w('m1', 'C', 'm2', 'D'), w('m1', 'C', 'm2', 'E')])).toBe(false)
})

test('/implement tapé sur les tickets d’un groupe que le plan fait attendre ne démarre pas : Claude lit pourquoi', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await setUp($, on)
  const text = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text
  await settle(clock, 1)
  // Sans tickets nommés, rien n'est contrôlé ici (la file du panneau le fait) ; avec le ticket de A, retenu par le plan :
  expect(text).not.toMatch(/held by another mission or by the plan/)
  for (const args of ['t1', 'groupe A', '(t1)', '"t1"', 't1, t2']) {
    await $.command.run({ command: 'mattpocock-skills:implement', args } as any)
    const held = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text
    expect(held, args).toMatch(/held by another mission or by the plan of the project/)
  }
  expect(stored(w).runs.find(r => r.id === here.id)!.tickets.find(t => t.id === 't1')!.status).not.toBe('doing')
})

test('un fichier de coordination présent mais illisible ne lance rien, même sans siège lisible du COO', { timeoutMs: 30000 }, async ($, on) => {
  // Aucun siège dans le fichier des missions (perdu, ou hors forme et écarté à la fusion) : le fichier présent suffit.
  const { clock, w, here } = await setUp($, on, false)
  w.coord.unread = true
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'launch-linked-B' })
  await pane.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === here.id)!.groups!.find(g => g.id === 'B')!.linked).toBeUndefined()
})
