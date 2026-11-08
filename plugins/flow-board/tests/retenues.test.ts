// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, test } from 'claude-code/testing'

import { LOT_KEY, nextCommandSkill, unitsOfTickets, applyReport, autoDecision, crossedLaunches, emptyBoard, forceHold, groupPlan, holdMapOf, mergeBoards, newRun, nextLaunchFor, outsideHolds } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { mock } from 'claude-code/testing'
import { cooStatement, statementText } from '../hooks/coo.ts'
import { CORPUS } from './corpus.mjs'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// Les retenues entre missions. Invariant : « Un groupe retenu ne part que si le groupe attendu est clos
// ou si tu as forcé ; une lecture ratée du fichier des missions ne lance rien. »

const T0 = 300_000_000

/** Une mission dans l'implémentation, avec ses tickets (et leurs fichiers) et ses groupes, réglés par le test. */
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
/** Le groupe `id` confié à un worker (en cours). */
const sent = (run: Run, id: string): Run => ({ ...run, groups: run.groups!.map(g => (g.id === id ? { ...g, linked: { at: T0 } } : g)) })
/** Un lot pas encore parti : sans file, sa phase de code pas commencée. */
const notStarted = (run: Run): Run => ({ ...run, queue: undefined, phases: run.phases.map(p => ({ ...p, status: 'pending' as const })) })
const boardOf = (...runs: Run[]): Board => ({ ...emptyBoard('/p', 'p'), session: 's', deleted: [], runs, activeId: runs[0]!.id })

test('un groupe qui touche un fichier d’un groupe en cours d’une autre mission est retenu ; l’autre groupe part', () => {
  const here = twoGroups('Ici', T0, ['plugins/x/hooks/model.ts', 'plugins/x/hooks/view.tsx'])
  const there = sent(twoGroups('Là-bas', T0, ['plugins/x/hooks/model.ts', 'docs/a.md']), 'A')
  const holds = outsideHolds(boardOf(here, there), here.id)
  expect(holds).toEqual([{ held: 'A', run: there.id, title: 'Là-bas', group: 'A', shared: 'model.ts', on: 'file' }])
  const outside = holdMapOf(holds)
  const plan = groupPlan(here, outside)!
  expect(plan.groups.find(g => g.group.id === 'A')!.state).toBe('waiting')
  expect(plan.groups.find(g => g.group.id === 'A')!.waitsElsewhere).toEqual(holds)
  // Sans retenue, A et B partaient ensemble ; retenu, seul B part.
  expect(nextLaunchFor(here)).toEqual({ kind: 'parallel', groups: ['A', 'B'] })
  expect(nextLaunchFor(here, outside)).toEqual({ kind: 'group', group: 'B', isDelegable: true })
})

test('la retenue se lève quand le groupe attendu est clos ou annulé, ou sa mission close ou archivée sans worker en vol', () => {
  const here = twoGroups('Ici', T0, ['a.ts', 'b.ts'])
  const there = sent(twoGroups('Là-bas', T0, ['a.ts', 'z.ts']), 'A')
  expect(outsideHolds(boardOf(here, there), here.id)).toHaveLength(1)
  // Annulé (le lien retiré) : plus rien.
  const cancelled = { ...there, groups: there.groups!.map(g => ({ ...g, linked: undefined })) }
  expect(outsideHolds(boardOf(here, cancelled), here.id)).toEqual([])
  // Rendu, pas clos : retient encore ; clos : plus rien.
  const returned = { ...there, groups: there.groups!.map(g => (g.id === 'A' ? { ...g, linked: undefined, delegated: { at: T0 } } : g)) }
  expect(outsideHolds(boardOf(here, returned), here.id)).toHaveLength(1)
  const closed = { ...there, groups: there.groups!.map(g => (g.id === 'A' ? { ...g, linked: undefined, delegated: { at: T0, closing: { state: 'closed' as const, at: T0 } } } : g)) }
  expect(outsideHolds(boardOf(here, closed), here.id)).toEqual([])
  // Close ou archivée : son groupe encore confié à un worker (ou rendu, pas clos) retient encore, le worker peut écrire.
  expect(outsideHolds(boardOf(here, { ...there, status: 'done' }), here.id)).toHaveLength(1)
  expect(outsideHolds(boardOf(here, { ...there, archivedAt: T0 }), here.id)).toHaveLength(1)
  expect(outsideHolds(boardOf(here, { ...returned, archivedAt: T0 }), here.id)).toHaveLength(1)
  // Sans worker en vol, une mission close ou archivée ne retient plus rien, même un ticket resté « en cours ».
  const doing = { ...there, groups: there.groups!.map(g => ({ ...g, linked: undefined })), tickets: there.tickets.map(t => ({ ...t, status: 'doing' as const })) }
  expect(outsideHolds(boardOf(here, doing), here.id)).toHaveLength(1)
  expect(outsideHolds(boardOf(here, { ...doing, status: 'done' }), here.id)).toEqual([])
  expect(outsideHolds(boardOf(here, { ...closed, archivedAt: T0 }), here.id)).toEqual([])
})

test('les documents communs ne retiennent pas : README, DECISIONS.md, ETAT_DU_PROJET.md, GLOSSARY.md ; une ressource commune retient', () => {
  const here = mission('Ici', T0, { tickets: [{ id: 't1', name: 'Un', files: ['README.md', 'ETAT_DU_PROJET.md', 'GLOSSARY.md', 'travail/x/DECISIONS.md'] }, { id: 't2', name: 'Deux', files: ['ici.ts'] }], groups: [{ id: 'A', name: 'A', tickets: ['t1'], resources: ['PowerBI Desktop'] }, { id: 'B', name: 'B', tickets: ['t2'] }] })
  const there = sent(mission('Là-bas', T0, { tickets: [{ id: 't1', name: 'Un', files: ['README.md', 'ETAT_DU_PROJET.md', 'GLOSSARY.md', 'travail/y/DECISIONS.md'] }, { id: 't2', name: 'Deux', files: ['la-bas.ts'] }], groups: [{ id: 'A', name: 'A', tickets: ['t1'] }, { id: 'B', name: 'B', tickets: ['t2'] }] }), 'A')
  expect(outsideHolds(boardOf(here, there), here.id)).toEqual([])
  const withResource = { ...there, groups: there.groups!.map(g => (g.id === 'A' ? { ...g, resources: ['powerbi  desktop'] } : g)) }
  expect(outsideHolds(boardOf(here, withResource), here.id)).toEqual([expect.objectContaining({ held: 'A', group: 'A', shared: 'powerbi  desktop', on: 'resource' })])
})

test('un lot sans groupes compte comme un groupe : il retient (même en pause) et peut être retenu', () => {
  const lot = { ...mission('Lot', T0, { tickets: [{ id: 'l1', name: 'Un', files: ['src/a.ts'] }, { id: 'l2', name: 'Deux', status: 'done', files: ['src/done.ts'] }] }), queue: ['l1'] }
  const groups = twoGroups('Groupes', T0, ['src/a.ts', 'src/done.ts'])
  // Le lot en cours retient le groupe A (fichier d'un ticket pas fait), pas B (ticket du lot fait).
  expect(outsideHolds(boardOf(groups, lot), groups.id)).toEqual([expect.objectContaining({ held: 'A', run: lot.id, group: LOT_KEY, shared: 'a.ts' })])
  expect(outsideHolds(boardOf(groups, { ...lot, status: 'paused' }), groups.id)).toHaveLength(1)
  // Tous ses tickets faits : il ne retient plus.
  const done = { ...lot, tickets: lot.tickets.map(t => ({ ...t, status: 'done' as const })) }
  expect(outsideHolds(boardOf(groups, done), groups.id)).toEqual([])
  // Pas encore parti (ni file, ni phase de code commencée), il est retenu à son tour par un groupe en cours d'une autre mission.
  const busy = sent(groups, 'A')
  expect(outsideHolds(boardOf(notStarted(lot), busy), lot.id)).toEqual([expect.objectContaining({ held: LOT_KEY, run: busy.id, group: 'A' })])
})

test('un groupe déjà parti n’attend jamais : pas de blocage croisé ; deux départs croisés sont relevés', () => {
  const a = sent(twoGroups('Un', T0, ['x.ts', 'y.ts']), 'A')
  const b = sent(twoGroups('Deux', T0, ['x.ts', 'w.ts']), 'A')
  expect(outsideHolds(boardOf(a, b), a.id).filter(h => h.held === 'A')).toEqual([])
  expect(crossedLaunches(boardOf(a, b))).toEqual([{ a: { run: a.id, title: 'Un', group: 'A' }, b: { run: b.id, title: 'Deux', group: 'A' }, shared: 'x.ts' }])
})

test('un forçage vaut pour la seule paire nommée ; un autre conflit retient de nouveau ; il se garde à la fusion', () => {
  const here = twoGroups('Ici', T0, ['x.ts', 'y.ts'])
  const one = sent(twoGroups('Un', T0, ['x.ts', 'q.ts']), 'A')
  const two = sent(twoGroups('Deux', T0, ['x.ts', 'r.ts']), 'A')
  const board = boardOf(here, one, two)
  expect(outsideHolds(board, here.id).map(h => h.run)).toEqual([one.id, two.id])
  const forced = forceHold(board, { held: 'A', run: one.id, group: 'A' }, T0 + 5)!.board
  expect(outsideHolds(forced, here.id).map(h => h.run)).toEqual([two.id])
  // Une paire hors forme ne force rien.
  expect(forceHold(board, { held: 'A', run: '../x', group: 'A' }, T0 + 5)).toBeNull()
  // La copie d'une autre discussion, sans le forçage, ne le fait pas tomber, dans les deux sens de fusion.
  const other: Board = { ...board, runs: board.runs.map(r => (r.id === here.id ? { ...r, updatedAt: T0 + 9 } : r)) }
  expect(mergeBoards(forced, other).runs.find(r => r.id === here.id)!.forced).toEqual([{ held: 'A', run: one.id, group: 'A', at: T0 + 5 }])
  expect(mergeBoards(other, forced).runs.find(r => r.id === here.id)!.forced).toEqual([{ held: 'A', run: one.id, group: 'A', at: T0 + 5 }])
  // Un forçage venu du fichier de coordination compte aussi.
  expect(outsideHolds(board, here.id, [{ held: 'A', run: two.id, group: 'A' }]).map(h => h.run)).toEqual([one.id])
})

test('en auto, seule la branche retenue attend : l’autre groupe part ; tout retenu, rien ne part, sans pause', () => {
  const here = twoGroups('Ici', T0, ['x.ts', 'y.ts'])
  const one = sent(twoGroups('Un', T0, ['x.ts', 'q.ts']), 'A')
  const outside = holdMapOf(outsideHolds(boardOf(here, one), here.id))
  const decision = autoDecision(here, {}, false, outside)
  expect(decision).toMatchObject({ kind: 'send', action: { kind: 'groups', groups: ['B'] } })
  const both = sent(twoGroups('Deux', T0, ['y.ts', 'r.ts']), 'A')
  const all = holdMapOf(outsideHolds(boardOf(here, one, both), here.id))
  expect(autoDecision(here, {}, false, all)).toMatchObject({ kind: 'none' })
  expect(nextLaunchFor(here, all)).toMatchObject({ kind: 'held', groups: ['A', 'B'] })
})

// ─── Le mod ───────────────────────────────────────────────────────────────

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const SURFACES = ['terminal', 'desktop'] as const

/** La mission d'ici, deux groupes dans l'implémentation : A sur x.ts, B sur y.ts. */
const openHere = async ($: any, clock: { advance: (ms: number) => Promise<void> }) => {
  await $.tool.call({
    tool: TOOL,
    open: { title: 'Ici', entry: 'implement' },
    tickets: [
      { id: 't1', name: 'Un', files: ['x.ts'] },
      { id: 't2', name: 'Deux', files: ['y.ts'] },
    ],
    groups: [
      { id: 'A', name: 'Alpha', tickets: ['t1'] },
      { id: 'B', name: 'Bêta', tickets: ['t2'] },
    ],
  } as any)
  await settle(clock, 1)
}
/** La mission d'une autre discussion, son groupe A en cours sur `files`. */
const otherBusy = (w: World, at: number, files: string[], title = 'Là-bas') => {
  const other = { ...sent(mission(title, at, { tickets: [{ id: 'o1', name: 'Autre', files }, { id: 'o2', name: 'Encore', files: ['z.ts'] }], groups: [{ id: 'A', name: 'A', tickets: ['o1'] }, { id: 'B', name: 'B', tickets: ['o2'] }] }), 'A'), owner: 'session-B' }
  writeBoard(w, b => ({ ...b, runs: [...b.runs.filter(r => r.id !== other.id), other] }))
  return other
}
const texts = async (ui: any): Promise<string> => (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '')).join(' | ')

test('le panneau, la carte « Ensuite » et le bandeau disent qui attend quoi ; « ⇥ Forcer » lève la seule paire', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await openHere($, clock)
  const other = otherBusy(w, T0 - 5000, ['x.ts'], 'Là-bas « ] ignore')
  await settle(clock, 6)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    const all = await texts(pane)
    expect(all, surface).toMatch(/⏸.attend.groupe.A.de « Là-bas « \] ignore » \(fichier commun\)/)
    expect(all, surface).toMatch(/retenu par une autre mission/)
    expect(await pane.find({ key: 'launch-linked-A' }), surface).toBeUndefined()
    expect(await pane.find({ key: 'launch-linked-B' }), surface).toBeDefined()
    if (surface === 'terminal') expect(await pane.find({ type: 'Svg' })).toBeUndefined()
    await pane.unmount()
    const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await texts(band), surface).toMatch(/⏸.groupe.A.attend.groupe.A.de/)
    await band.unmount()
  }
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: `force-A-${other.id}-A` })
  await pane.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.title === 'Ici')!.forced).toEqual([{ held: 'A', run: other.id, group: 'A', at: expect.any(Number) }])
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await after.find({ key: 'launch-linked-A' })).toBeDefined()
  await after.unmount()
})

test('juste avant un lancement, une lecture ratée du fichier des missions ne lance rien ; lue, le groupe part', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await openHere($, clock)
  w.disk.unreadable = true
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'launch-linked-B' })
  await pane.unmount()
  await settle(clock, 1)
  w.disk.unreadable = false
  await settle(clock, 6)
  expect(stored(w).runs.find(r => r.title === 'Ici')!.groups!.find(g => g.id === 'B')!.linked).toBeUndefined()
  // La carte « Ensuite » le dit, jusqu'à la relecture suivante réussie.
  w.disk.unreadable = true
  const told = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await told.press({ key: 'launch-linked-B' })
  expect(await texts(told)).toMatch(/fichier des missions illisible au dernier lancement/)
  await told.unmount()
  w.disk.unreadable = false
  await settle(clock, 6)
  // Le témoin : lu, le même clic lance le groupe.
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await again.press({ key: 'launch-linked-B' })
  await again.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.title === 'Ici')!.groups!.find(g => g.id === 'B')!.linked).toBeDefined()
})

test('un groupe retenu ne part pas par la carte, même tout le lot demandé ; l’autre part seul', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await openHere($, clock)
  // Le lot parallèle A ∥ B était proposé ; une autre mission prend x.ts entre l'affichage et le clic.
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  otherBusy(w, T0 - 5000, ['x.ts'])
  await pane.press({ key: 'next-parallel-linked' })
  await pane.unmount()
  await settle(clock, 2)
  const groups = stored(w).runs.find(r => r.title === 'Ici')!.groups!
  expect(groups.find(g => g.id === 'A')!.linked).toBeUndefined()
  expect(groups.find(g => g.id === 'B')!.linked).toBeDefined()
})

test('en auto : tout retenu, rien ne part et sans pause ; le groupe attendu clos, l’auto relance de lui-même', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await openHere($, clock)
  const other = otherBusy(w, T0 - 5000, ['x.ts', 'y.ts'])
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
  const here = () => stored(w).runs.find(r => r.title === 'Ici')!
  expect(here().auto?.offAt).toBeUndefined()
  // Le groupe attendu est clos dans l'autre mission : la retenue tombe, et l'auto lance la vague.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === other.id ? { ...r, updatedAt: T0 + 60_000, groups: r.groups!.map(g => (g.id === 'A' ? { ...g, linked: undefined, delegated: { at: T0, closing: { state: 'closed' as const, at: T0 + 50_000 } } } : g)) } : r)) }))
  await settle(clock, 7)
  expect(w.prompts.slice(sentBefore).join('\n')).toMatch(/Groupe A/)
  expect(here().groups!.find(g => g.id === 'A')!.linked).toBeDefined()
})

test('le COO montre qui attend qui, et son « ⇥ Forcer » écrit une entrée que le manager applique', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const held = { ...twoGroups('Retenue', T0 - 6000, ['x.ts', 'y.ts']), owner: 'session-B' }
  const busy = { ...sent(twoGroups('Occupée', T0 - 6000, ['x.ts', 'q.ts']), 'A'), owner: 'session-C' }
  writeBoard(w, b => ({ ...b, runs: [held, busy] }))
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/mission « Retenue », group « A », waits for group « A » of mission « Occupée » \(file in common: « x\.ts »\)/)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await texts(pane), surface).toMatch(/groupe.A de « Retenue » attend groupe.A de « Occupée »/)
    if (surface === 'desktop') await pane.press({ key: 'coo-force-0' })
    await pane.unmount()
  }
  await settle(clock, 2)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'force', run: held.id, held: 'A', awaited: { run: busy.id, group: 'A' } })])
  // Vu du manager (le fichier relu) : la paire forcée ne retient plus.
  const forces = entries(w).map(e => ({ held: e.held, run: e.awaited.run, group: e.awaited.group }))
  expect(outsideHolds(stored(w), held.id, forces)).toEqual([])
  // Le groupe forcé part : les deux tournent sur x.ts, par décision de la personne ; rien à signaler.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === held.id ? { ...sent(r, 'A'), updatedAt: T0 + 60_000 } : r)) }))
  await settle(clock, 6)
  const forced = await $.prompt.submit({ text: 'et alors ?', origin: { kind: 'composer' } } as any)
  expect(JSON.stringify(forced)).not.toMatch(/LAUNCHED TOGETHER/)
  // Sans forçage, deux départs croisés sur x.ts : le COO le signale.
  const third = { ...sent(twoGroups('Troisième', T0 - 6000, ['x.ts', 'w.ts']), 'A'), owner: 'session-D', updatedAt: T0 + 61_000 }
  writeBoard(w, b => ({ ...b, runs: [...b.runs, third] }))
  await settle(clock, 6)
  const crossed = await $.prompt.submit({ text: 'et maintenant ?', origin: { kind: 'composer' } } as any)
  expect(JSON.stringify(crossed)).toMatch(/LAUNCHED TOGETHER/)
  expect(JSON.stringify(crossed)).toMatch(/Troisième/)
})

test('le forçage écrit par le COO, relu par le mod du manager, lance le groupe retenu', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await openHere($, clock)
  const other = otherBusy(w, T0 - 5000, ['x.ts'])
  await settle(clock, 6)
  const before = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await before.find({ key: 'launch-linked-A' })).toBeUndefined()
  await before.unmount()
  const here = stored(w).runs.find(r => r.title === 'Ici')!
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'force', run: here.id, at: T0, held: 'A', awaited: { run: other.id, group: 'A' } }])
  await settle(clock, 6)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await after.find({ key: 'launch-linked-A' })).toBeDefined()
  await after.unmount()
  // Le fichier de coordination illisible : le forçage ne s'applique plus, la retenue revient.
  w.coord.unread = true
  await settle(clock, 6)
  const unread = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await unread.find({ key: 'launch-linked-A' })).toBeUndefined()
  await unread.unmount()
})

test('un lot déjà en cours n’attend jamais ; un lot pas parti, retenu, ne se voit pas proposer /implement', () => {
  const lot = { ...mission('Lot', T0, { tickets: [{ id: 'l1', name: 'Un', files: ['src/a.ts'] }] }), queue: ['l1'] }
  const busy = sent(twoGroups('Groupes', T0, ['src/a.ts', 'b.ts']), 'A')
  expect(outsideHolds(boardOf(lot, busy), lot.id)).toEqual([])
  const fresh = notStarted(mission('Pas parti', T0, { tickets: [{ id: 'l1', name: 'Un', files: ['src/a.ts'] }] }))
  const outside = holdMapOf(outsideHolds(boardOf(fresh, busy), fresh.id))
  expect(outside.has(LOT_KEY)).toBe(true)
  // Le témoin : sans retenue, /implement se propose ; retenu, rien.
  expect(nextCommandSkill(fresh, {})).toBe('implement')
  expect(nextCommandSkill(fresh, {}, outside)).toBeNull()
})

test('des tickets choisis dans un groupe retenu ne partent pas par la sélection', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await openHere($, clock)
  otherBusy(w, T0 - 5000, ['x.ts'])
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'pick-t1' })
  await pane.press({ key: 'launch-picks' })
  await pane.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.title === 'Ici')!.queue ?? []).toEqual([])
  // Un ticket que le plan rattache au groupe retenu (il attend t1) ne part pas non plus.
  await $.tool.call({ tool: TOOL, tickets: [{ id: 't3', name: 'Trois', blockedBy: ['t1'] }] } as any)
  await settle(clock, 1)
  expect(unitsOfTickets(stored(w).runs.find(r => r.title === 'Ici')!, ['t3'])).toEqual(['A'])
  const attached = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  // La sélection d'avant (t1, retenu) reste : elle se défait d'abord.
  await attached.press({ key: 'pick-t1' })
  await attached.press({ key: 'pick-t2' })
  await attached.press({ key: 'launch-picks' })
  await attached.unmount()
  await settle(clock, 2)
  // Le témoin : t2, du groupe B qui n'est pas retenu, part bien par la sélection.
  expect(stored(w).runs.find(r => r.title === 'Ici')!.queue).toEqual(['t2'])
})

test('/implement tapé sur un lot sans groupes retenu ne démarre pas : Claude lit pourquoi', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot ici', tickets: [{ id: 't1', name: 'Un', files: ['x.ts'] }], complete: true } as any)
  otherBusy(w, T0 - 5000, ['x.ts'])
  await settle(clock, 6)
  const loaded = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'consignes' })).text
  expect(loaded).toMatch(/this lot is held by another mission/)
  expect(stored(w).runs.find(r => r.title === 'Lot ici')!.phases.find(p => p.skill === 'implement')!.status).toBe('pending')
})

test('le titre relu de l’autre mission, dans le relevé du COO, ne coupe ni la ligne ni la citation, pour chaque entrée du corpus hostile', () => {
  const here = twoGroups('Ici', T0, ['x.ts', 'y.ts'])
  const lineCount = (title: string) => {
    const there = sent(twoGroups(title, T0, ['x.ts', 'q.ts']), 'A')
    const text = statementText(cooStatement(boardOf(here, there), { now: T0 }))
    const line = text.split('\n').find(l => l.startsWith('- mission « Ici », group'))
    return { lines: text.split('\n').length, line: line ?? '' }
  }
  const base = lineCount('Là-bas')
  const quotes = (line: string, mark: string) => line.split(mark).length - 1
  expect(quotes(base.line, '«')).toBe(5)
  const leaks = Object.entries(CORPUS).filter(([, token]) => {
    const out = lineCount(`ab${token}cd`)
    return out.lines !== base.lines || quotes(out.line, '«') !== 5 || quotes(out.line, '»') !== 5
  })
  expect(leaks.map(([name]) => name)).toEqual([])
})

test('le lot sans groupes, retenu, ne part pas : la carte le dit et ne propose que de forcer ; « ▶ » d’avant ne le lance pas', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot ici', tickets: [{ id: 't1', name: 'Un', files: ['x.ts'] }], complete: true } as any)
  await settle(clock, 2)
  // La carte, dessinée avant la retenue, propose l'implémentation.
  const before = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await before.find({ key: 'go-implement' })).toBeDefined()
  // Une autre mission lance un groupe sur x.ts ; le clic sur le bouton d'avant ne lance rien.
  otherBusy(w, T0 - 5000, ['x.ts'])
  await before.press({ key: 'go-implement' })
  await before.unmount()
  await settle(clock, 2)
  expect(w.fills).toEqual([])
  expect(w.runs).toEqual([])
  await settle(clock, 6)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await after.find({ key: 'go-implement' })).toBeUndefined()
  expect(await texts(after)).toMatch(/le.lot attend groupe.A de « Là-bas » \(fichier commun\)/)
  // Le témoin : forcé, la carte propose de nouveau l'implémentation, et son clic la lance.
  await after.press({ key: 'next-force-*-' + stored(w).runs.find(r => r.title === 'Là-bas')!.id + '-A' })
  await after.unmount()
  await settle(clock, 2)
  const forced = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await forced.press({ key: 'go-implement' })
  await forced.unmount()
  await settle(clock, 2)
  expect(w.fills.length + w.runs.length).toBeGreaterThan(0)
})
