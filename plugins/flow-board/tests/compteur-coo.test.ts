// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { cooStatement, statementText } from '../hooks/coo.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { applyReport, emptyBoard, linkedGroupProgress, newRun } from '../hooks/model.ts'
import type { Board, Relay, Run } from '../types'
import { PANE, PLUGIN, entries, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// Le compteur d'un groupe chez le COO : « ↗A 2/3 » dès que son worker a fait deux tickets dans sa branche, le même nombre
// que la pastille de la page Mission (`linkedGroupProgress`), et le compte de la mission entière à la même règle.
// Invariant du ticket : « Le nombre relayé d'un groupe ne change jamais un statut stocké et ne déclenche jamais une
// action : il ne sert qu'à l'affichage et au relevé du COO. »

const T0 = 940_000_000
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const nb = (t: string | undefined): string => (t ?? '').replace(/ /g, ' ')

/** La mission du manager (session-B) : les tickets 1 à 3 au groupe A, confié à session-W ; le 4 au groupe B, pas confié. */
const missionOf = (): Run => {
  const run = newRun('implement', T0 - 60_000, 'Compteur')
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = {
    tickets: [1, 2, 3, 4].map(n => ({ id: String(n), name: `T${n}`, files: [`f${n}.ts`] })),
    groups: [
      { id: 'A', name: 'A', tickets: ['1', '2', '3'] },
      { id: 'B', name: 'B', tickets: ['4'] },
    ],
  }
  const planned = applyReport(base, report as any, T0 - 50_000).board.runs[0] as Run
  return {
    ...planned,
    status: 'active',
    owner: 'session-B',
    updatedAt: T0 - 1000,
    groups: planned.groups!.map(g => (g.id === 'A' ? { ...g, linked: { at: T0 - 40_000, session: 'session-W' } } : g)),
  }
}

/** L'entrée de relais du worker du groupe A, avec ces tickets « fait ». */
const entryOf = (runId: string, done: readonly string[], run = runId) => ({
  v: 1 as const,
  run,
  session: 'session-W',
  entry: { group: 'A', startedAt: T0 - 30_000, at: T0 - 5_000, commits: done.length, tickets: Object.fromEntries(done.map(id => [id, { status: 'done', at: T0 - 6_000 }])) },
})
const relayOf = (runId: string, done: readonly string[]): Relay => ({ v: 1, run: runId, sessions: { 'session-W': entryOf(runId, done).entry } }) as unknown as Relay

// ─── Le relevé et la ligne de mission, purs ───────────────────────────────────

test('une seule fonction rend le compteur d’un groupe : la pastille de la page Mission et le relevé du COO ont le même nombre', () => {
  const run = missionOf()
  const relay = relayOf(run.id, ['1', '2'])
  const a = run.groups!.find(g => g.id === 'A')!
  expect(linkedGroupProgress(run, a, relay)).toMatchObject({ done: 2, total: 3 })
  const s = cooStatement({ ...emptyBoard('', 'p'), deleted: [], runs: [run] }, { now: T0, relayOf: id => (id === run.id ? relay : null) })
  const w = s.missions[0]!.workers.find(x => x.group === 'A')!
  expect(w).toMatchObject({ done: 0, total: 3, relayed: { done: 2, total: 3 }, state: 'working' })
  // La mission entière : « fait dans la mission ou au relais », comme la page Mission.
  expect(s.missions[0]).toMatchObject({ done: 0, total: 4, relayedDone: 2 })
})

test('le texte du relevé garde le nombre stocké et ajoute le relayé seulement quand il diffère, avec les mots de Z5', () => {
  const run = missionOf()
  const board: Board = { ...emptyBoard('', 'p'), deleted: [], runs: [run] }
  const text = statementText(cooStatement(board, { now: T0, relayOf: () => relayOf(run.id, ['1', '2']) }))
  expect(text).toContain('tickets 0/4 done (2/4 with the progress its workers relayed, not yet recorded by the manager)')
  expect(text).toContain('group « A » 0/3 (2/3 relayed by its worker) (working)')
  // Égaux, ou sans relais lisible : le texte d'aujourd'hui.
  const bare = statementText(cooStatement(board, { now: T0 }))
  expect(statementText(cooStatement(board, { now: T0, relayOf: () => relayOf(run.id, []) }))).toBe(bare)
  expect(statementText(cooStatement(board, { now: T0, relayOf: () => null }))).toBe(bare)
  expect(bare).toContain('tickets 0/4 done, workers: group « A » 0/3 (working)')
})

test('la ligne de mission de la vue affiche le compte relayé du groupe et de la mission, le stocké sans relais', () => {
  const run = missionOf()
  const board: Board = { ...emptyBoard('', 'p'), deleted: [], runs: [run] }
  const line = (relay: Relay | null) => {
    const rows = coordinationRows(cooStatement(board, { now: T0, relayOf: () => relay }), { page: 'overview' })
    return nb((rows.find(r => r.key === `coo-mission-${run.id}-state`)?.parts ?? []).map(p => p.text).join(' '))
  }
  expect(line(relayOf(run.id, ['1', '2']))).toContain('↗A 2/3')
  expect(line(relayOf(run.id, ['1', '2']))).toContain('2/4 tickets')
  expect(line(null)).toContain('↗A 0/3')
  expect(line(null)).toContain('0/4 tickets')
})

test('un groupe relancé : les tickets déjà enregistrés faits par le manager comptent, la session neuve n’ayant relayé que le sien', () => {
  // Revue du ticket : le compteur comptait les tickets du groupe d'après le seul relais, et un groupe relancé retombait à 0/3.
  const base = missionOf()
  const run: Run = { ...base, tickets: base.tickets.map(t => (t.id === '1' || t.id === '2' ? { ...t, status: 'done' } : t)) }
  const relay = { v: 1, run: run.id, sessions: { 'session-W': { group: 'A', startedAt: T0 - 30_000, at: T0 - 5_000, commits: 0, tickets: { '3': { status: 'doing', at: T0 - 6_000 } } } } } as unknown as Relay
  const a = run.groups!.find(g => g.id === 'A')!
  expect(linkedGroupProgress(run, a, relay)).toMatchObject({ done: 2, total: 3 })
  const s = cooStatement({ ...emptyBoard('', 'p'), deleted: [], runs: [run] }, { now: T0, relayOf: () => relay })
  expect(s.missions[0]!.workers.find(x => x.group === 'A')).toMatchObject({ done: 2, total: 3, relayed: { done: 2, total: 3 } })
  // Égaux : le texte ne dit rien de relayé.
  expect(statementText(s)).toContain('group « A » 2/3 (working)')
})

test('un relais lisible où aucune session du groupe n’est : rien n’est dit relayé', () => {
  const run = missionOf()
  const empty = { v: 1, run: run.id, sessions: {} } as unknown as Relay
  const s = cooStatement({ ...emptyBoard('', 'p'), deleted: [], runs: [run] }, { now: T0, relayOf: () => empty })
  expect(s.missions[0]!.workers.find(x => x.group === 'A')!.relayed).toBeUndefined()
  expect(statementText(s)).not.toContain('relayed by its worker')
})

// ─── Le panneau du COO et celui du manager, sur le même relais ──────────────────

const seed = (w: World, run: Run, entry: unknown, key = 'session-W') => {
  writeBoard(w, b => ({ ...b, runs: [run] }))
  w.mem[`relay:${run.id}:${key}`] = entry
}

/** Le texte des lignes du panneau monté, une chaîne par Text. */
const textsOf = async (ui: any): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map((t: any) => nb(String(t.text ?? '')))

test('le COO, son panneau rendu : « ↗A 2/3 » et « 2/4 tickets » dès que le worker a relayé deux tickets', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = missionOf()
  seed(w, run, entryOf(run.id, ['1', '2']))
  w.ids.now = 'session-C'
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-page-overview' })
  await settle(clock, 2)
  const texts = await textsOf(pane)
  expect(texts).toContain('↗A 2/3')
  expect(texts).toContain('2/4 tickets')
  await pane.unmount()
})

test('le manager, son panneau rendu sur le même relais : la même pastille « ↗A 2/3 »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = missionOf()
  seed(w, run, entryOf(run.id, ['1', '2']))
  w.ids.now = 'session-B'
  w.mem['board:'] = { ...(stored(w) as Board), activeId: run.id }
  w.disk.board = JSON.stringify(w.mem['board:'])
  await start($)
  await settle(clock, 3)
  // La pastille du bandeau de la page Mission (`relayPills`), le panneau ouvert (il relit le relais tout de suite).
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await settle(clock, 2)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  await settle(clock, 2)
  expect(await textsOf(band)).toContain('↗A 2/3')
  await band.unmount()
  await pane.unmount()
})

test('relais d’une autre mission : le compte stocké, sans erreur', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = missionOf()
  seed(w, run, entryOf(run.id, ['1', '2', '3'], 'une-autre-mission'))
  w.ids.now = 'session-C'
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-page-overview' })
  await settle(clock, 2)
  const texts = await textsOf(pane)
  expect(texts).toContain('↗A 0/3')
  expect(texts).toContain('0/4 tickets')
  await pane.unmount()
})

test('invariant : un relais qui dit tous les tickets du groupe faits ne change aucun statut stocké, ne rend pas le groupe et ne lance ni groupe suivant ni fermeture', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = missionOf()
  seed(w, run, entryOf(run.id, ['1', '2', '3']))
  w.ids.now = 'session-C'
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-page-overview' })
  await settle(clock, 10)
  expect(await textsOf(pane)).toContain('↗A 3/3')
  await pane.unmount()
  // Le tableau des missions relu après : les statuts du manager, le groupe toujours confié, rien de rendu ni de fermé.
  const after = stored(w).runs.find(r => r.id === run.id)!
  expect(after.tickets.map(t => [t.id, t.status])).toEqual(run.tickets.map(t => [t.id, t.status]))
  expect(after.status).toBe('active')
  const a = after.groups!.find(g => g.id === 'A')!
  expect(a.linked).toBeDefined()
  expect(a.delegated).toBeUndefined()
  expect(after.groups!.find(g => g.id === 'B')!.linked).toBeUndefined()
  // Aucun envoi ni commande lancés par le mod, aucune entrée de coordination (clôture, consigne).
  // Sur tout le test, démarrage et ouverture du COO compris (la première lecture du relais).
  expect(w.prompts).toEqual([])
  expect(w.runs).toEqual([])
  expect(entries(w)).toEqual([])
  // Le relevé du COO : le nombre stocké d'abord, le relayé à part.
  const text = statementText(cooStatement(stored(w), { now: T0, relayOf: () => relayOf(run.id, ['1', '2', '3']) }))
  expect(text).toContain('tickets 0/4 done (3/4 with the progress its workers relayed, not yet recorded by the manager)')
  expect(text).toContain('group « A » 0/3 (3/3 relayed by its worker) (working)')
})
