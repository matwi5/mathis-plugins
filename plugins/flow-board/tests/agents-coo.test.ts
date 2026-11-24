// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { C } from '../hooks/catalog.ts'
import { cooAgentRows, cooStatement, type CooAgentRow } from '../hooks/coo.ts'
import { agentsListRows } from '../hooks/coo-view.tsx'
import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import { workerLabel } from '../hooks/worker-label.ts'
import type { Board, Relay, Run, TicketGroup } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'

// Chez le COO, l'onglet Agents est la liste des managers (une ligne par mission en cours ou en pause) et, sous chacun,
// de ses workers (un par groupe que le relevé tient pour un worker), avec le compteur du groupe et l'état du worker dans
// les mots de la ligne du groupe de la page Mission. Ni frise, ni sélecteur, ni spécialiste, ni ligne pour le COO.

const T0 = 950_000_000
const NB = ' '
const nb = (t: string | undefined): string => (t ?? '').replace(/ /g, ' ')

/** Une mission à trois groupes (A : 1 et 2, B : 3, C : 4), `over` pour son statut, ses groupes et le reste. */
const missionOf = (title: string, at: number, over: Partial<Run> = {}, groups: (g: TicketGroup) => TicketGroup = g => g): Run => {
  const run = newRun('implement', at - 10_000, title)
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = {
    tickets: [1, 2, 3, 4].map(n => ({ id: String(n), name: `T${n}`, files: [`f${n}.ts`] })),
    groups: [
      { id: 'A', name: 'A', tickets: ['1', '2'] },
      { id: 'B', name: 'B', tickets: ['3'] },
      { id: 'C', name: 'C', tickets: ['4'] },
    ],
  }
  const planned = applyReport(base, report as any, at - 9_000).board.runs[0] as Run
  return { ...planned, status: 'active', owner: `owner-${title}`, updatedAt: at, groups: planned.groups!.map(groups), ...over }
}
const linked = (session?: string) => ({ linked: { at: T0 - 40_000, ...(session ? { session } : {}) } })
const relayWith = (runId: string, entries: Record<string, Record<string, unknown>>): Relay =>
  ({
    v: 1,
    run: runId,
    sessions: Object.fromEntries(Object.entries(entries).map(([session, e]) => [session, { startedAt: T0 - 30_000, at: T0 - 5_000, commits: 0, tickets: {}, ...e }])),
  }) as unknown as Relay
const boardOf = (runs: Run[]): Board => ({ ...emptyBoard('', 'p'), deleted: [], runs })
const textOf = (r: CooAgentRow): string => (r.kind === 'manager' ? `${r.tag} ${r.title} ${r.phase} ${r.state?.text ?? ''}`.trim() : `${r.group} ${r.done}/${r.total} ${nb(r.state.text)}`)

// ─── La fonction pure ────────────────────────────────────────────────────────

test('les missions listées : en cours puis en pause, les plus récentes en tête ; ni close ni archivée ; un worker par groupe tenu pour un worker', () => {
  const old = missionOf('Ancienne', T0 - 5000)
  const recent = missionOf('Récente', T0 - 1000, {}, g => (g.id === 'A' ? { ...g, ...linked('session-W') } : g.id === 'B' ? { ...g, delegated: { at: T0 - 60_000, session: 'w-b' } } as TicketGroup : g))
  const paused = missionOf('En pause', T0, { status: 'paused' })
  const closed = missionOf('Close', T0, { status: 'done' })
  const archived = missionOf('Archivée', T0, { archivedAt: T0 - 10 })
  const s = cooStatement(boardOf([old, paused, closed, archived, recent]), { now: T0 })
  expect(cooAgentRows(s).map(textOf)).toEqual([
    'Récente implement',
    'A 0/2 en cours',
    'B 0/1 rendu',
    'Ancienne implement',
    'En pause implement en pause',
  ])
})

test('l’état d’un manager, premier cas vrai : en pause, discussion arrêtée, pause de l’auto, attend ta réponse, sinon rien', () => {
  const stateOf = (run: Run, ctx: Partial<Parameters<typeof cooStatement>[1]> = {}) => {
    const rows = cooAgentRows(cooStatement(boardOf([run]), { now: T0, ...ctx }))
    const m = rows[0]
    return m?.kind === 'manager' ? m.state?.text : 'absent'
  }
  // En pause passe avant la discussion arrêtée.
  const paused = missionOf('P', T0, { status: 'paused' })
  expect(stateOf(paused, { liveness: () => 'stopped' })).toBe('en pause')
  expect(stateOf(missionOf('S', T0), { liveness: () => 'stopped' })).toBe('discussion arrêtée')
  // La pause de l'auto posée par le mod : son libellé tel quel.
  const parked = missionOf('Q', T0, { auto: { onAt: T0 - 100, onBy: 'x', offAt: T0 - 50, offWhy: 'lecture du parcours ratée' } } as any)
  expect(stateOf(parked)).toBe('lecture de la mission ratée')
  // Le signal « t'attend » du manager.
  const waits = missionOf('W', T0, { waitsUser: { kind: 'validation', since: T0 - 100 } } as any)
  expect(stateOf(waits)).toBe('attend ta réponse')
  // Une question bloquante ouverte en auto.
  const asked = missionOf('A', T0, { auto: { onAt: T0 - 100, onBy: 'owner-A' }, waiting: [{ id: 'q1', text: 'Oui ?', at: T0 - 50, blocks: { phase: 'implement' } }] } as any)
  expect(stateOf(asked)).toBe('attend ta réponse')
  // Le texte et sa couleur décidés ensemble : ambre pour ce qui attend la personne, gris sinon.
  const colorOf = (run: Run) => (cooAgentRows(cooStatement(boardOf([run]), { now: T0 }))[0] as any).state?.color
  expect(colorOf(asked)).toBe(C.amber)
  expect(colorOf(paused)).toBe(C.gray)
  expect(stateOf(missionOf('R', T0))).toBeUndefined()
})

test('l’état d’un worker, dans les mots de la page Mission : à lancer, en cours, arrêté (rouge), terminé, à rendre, rendu', () => {
  const ids = (s: string) => ({ ...linked(s) })
  const run = missionOf('Workers', T0, {}, g => (g.id === 'A' ? { ...g, ...linked() } : g.id === 'B' ? { ...g, ...ids('w-b') } : { ...g, ...ids('w-c') }))
  const relay = relayWith(run.id, {
    'w-b': { group: 'B', last: { kind: 'note', text: 'worker arrêté : /login', at: T0 - 6000 } },
    'w-c': { group: 'C', endedAt: T0 - 120_000 },
  })
  const rows = cooAgentRows(cooStatement(boardOf([run]), { now: T0, relayOf: () => relay })).filter(r => r.kind === 'worker')
  expect(rows.map(textOf)).toEqual(['A 0/2 worker à lancer', 'B 0/1 ⚠ worker arrêté : /login', 'C 0/1 worker terminé il y a 2 min'])
  expect(rows.map(r => (r.kind === 'worker' ? r.state.color : ''))).toEqual([C.blue, C.red, C.amber])
  // Rien d'ouvert à la fin de sa session : « à rendre » ; au travail : « en cours ».
  const link = { at: T0 - 40_000, session: 's' }
  expect(nb(workerLabel(link, { endedAt: T0 - 1000 }, 0, T0).list)).toBe('worker terminé · à rendre')
  expect(nb(workerLabel(link, { }, 1, T0).list)).toBe('en cours')
  // Le groupe dont le compte rendu est au relais : « rendu ».
  const reported = cooAgentRows(cooStatement(boardOf([run]), { now: T0, relayOf: () => relay, reported: () => ['C'] })).filter(r => r.kind === 'worker')
  expect(textOf(reported[2]!)).toBe('C 0/1 rendu')
})

test('une seule fonction pour la page Mission et le COO : le texte de la page Mission ne change pas', () => {
  const link = { at: T0 - 40_000, session: 's' }
  expect(workerLabel({ at: T0 - 40_000 }, null, 1, T0)).toEqual({ page: `↗${NB}worker à lancer`, list: `worker${NB}à${NB}lancer`, color: C.blue, isWorking: false })
  expect(workerLabel(link, null, 1, T0).isWorking).toBe(true)
  expect(workerLabel(link, null, 1, T0).page).toBe(`↗${NB}en cours · worker`)
  expect(workerLabel(link, { last: { kind: 'note', text: 'worker arrêté : /login', at: T0 - 10 } }, 1, T0)).toMatchObject({ page: `⚠${NB}worker${NB}arrêté${NB}:${NB}/login`, color: C.red })
  expect(workerLabel(link, { endedAt: T0 - 60_000 }, 1, T0)).toMatchObject({ page: `↗${NB}worker terminé il y a ${'1 min'}`, color: C.amber })
  expect(workerLabel(link, { endedAt: T0 - 60_000 }, 0, T0)).toMatchObject({ page: `↗${NB}worker terminé · à rendre`, color: C.blue })
})

test('les lignes dessinées : le manager en tête, ses workers en retrait, « aucune mission en cours » pour une liste vide', () => {
  const run = missionOf('Vue Agents', T0, { waitsUser: { kind: 'question', since: T0 - 10 } } as any, g => (g.id === 'A' ? { ...g, ...linked('w-a') } : g))
  const s = cooStatement(boardOf([run]), { now: T0, numbers: { v: 1, root: '', next: 13, runs: { [run.id]: 12 }, cards: {} } as any })
  const lines = agentsListRows(s).map(r => nb(r.parts.map(p => p.text).join(' ')))
  expect(lines).toEqual(['◆ M12 Vue Agents · ⚙ Implémentation · attend ta réponse', '   ↗ A 0/2 · en cours'])
  expect(agentsListRows(cooStatement(boardOf([]), { now: T0 })).map(r => r.parts.map(p => p.text).join(' '))).toEqual(['aucune mission en cours'])
})

// ─── Le panneau du COO rendu ───────────────────────────────────────────────────

const textsOf = async (ui: any): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map((t: any) => nb(String(t.text ?? '')))
const labelOf = async (ui: any, key: string): Promise<string> => nb(String((await ui.find({ key }))?.props.label ?? ''))

const cooWorld = async ($: any, on: any, runs: Run[], relays: Record<string, unknown> = {}): Promise<{ w: World; clock: any }> => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs }))
  for (const [key, value] of Object.entries(relays)) w.mem[key] = value
  w.ids.now = 'session-C'
  await start($)
  await openCoo($, clock)
  return { w, clock }
}

test('chez le COO, l’onglet Agents montre la liste : deux groupes confiés, une mission en pause, une close absente ; son compte est le nombre de lignes', { timeoutMs: 20000 }, async ($, on) => {
  const active = missionOf('Active', T0 - 1000, {}, g => (g.id === 'A' ? { ...g, ...linked('w-a') } : g.id === 'B' ? { ...g, ...linked() } : g))
  const paused = missionOf('Pausée', T0 - 2000, { status: 'paused' })
  const closed = missionOf('Close', T0 - 3000, { status: 'done' })
  const entry = { v: 1, run: active.id, session: 'w-a', entry: { group: 'A', startedAt: T0 - 30_000, at: T0 - 5_000, commits: 1, tickets: { '1': { status: 'done', at: T0 - 6000 } } } }
  const { clock } = await cooWorld($, on, [active, paused, closed], { [`relay:${active.id}:w-a`]: entry })
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await pane.press({ key: 'tab-agents' })
    await settle(clock, 2)
    const texts = await textsOf(pane)
    expect(texts.filter(t => /^◆ M\d+$/.test(t)), surface).toHaveLength(2)
    for (const text of ['Active', '· ⚙ Implémentation', '   ↗ A 1/2', '· en cours', '   ↗ B 0/1', '· worker à lancer', 'Pausée', '· en pause']) expect(texts, `${surface} ${text}`).toContain(text)
    expect(texts, surface).not.toContain('Close')
    // Ni frise, ni sélecteur, ni pastille de manager, ni ligne de spécialiste.
    expect(await pane.find({ key: 'agents-head' }), surface).toBeUndefined()
    expect(await pane.find({ key: 'agents-body' }), surface).toBeUndefined()
    expect(texts.some(t => /Ici, maintenant|◆ Manager|spécialiste/.test(t)), surface).toBe(false)
    expect(await labelOf(pane, 'tab-agents')).toBe('▸ Agents · 4')
    await pane.unmount()
  }
})

test('chez le COO, sans mission en cours ni en pause : « aucune mission en cours », et l’onglet sans compte', { timeoutMs: 20000 }, async ($, on) => {
  const { clock } = await cooWorld($, on, [missionOf('Close', T0, { status: 'done' })])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'tab-agents' })
  await settle(clock, 1)
  expect(await textsOf(pane)).toContain('aucune mission en cours')
  expect(await labelOf(pane, 'tab-agents')).toBe('▸ Agents')
  await pane.unmount()
})

test('chez le COO, le panneau rendu dit chaque état : attend ta réponse, pause de l’auto, arrêt d’un worker en rouge, worker terminé', { timeoutMs: 20000 }, async ($, on) => {
  const waits = missionOf('Attend', T0 - 1000, { waitsUser: { kind: 'validation', since: T0 - 100 } } as any, g => (g.id === 'B' ? { ...g, ...linked('w-b') } : g.id === 'C' ? { ...g, ...linked('w-c') } : g))
  const parked = missionOf('Parquée', T0 - 2000, { auto: { onAt: T0 - 100, onBy: 'x', offAt: T0 - 50, offWhy: 'lecture du parcours ratée' } } as any)
  const entryOf = (session: string, group: string, extra: Record<string, unknown>) => ({ v: 1, run: waits.id, session, entry: { group, startedAt: T0 - 30_000, at: T0 - 5_000, commits: 0, tickets: {}, ...extra } })
  const { clock } = await cooWorld($, on, [waits, parked], {
    [`relay:${waits.id}:w-b`]: entryOf('w-b', 'B', { last: { kind: 'note', text: 'worker arrêté : /login', at: T0 - 6000 } }),
    [`relay:${waits.id}:w-c`]: entryOf('w-c', 'C', { endedAt: T0 - 120_000 }),
  })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'tab-agents' })
  await settle(clock, 2)
  const texts = await textsOf(pane)
  for (const text of ['· attend ta réponse', '· lecture de la mission ratée', '· ⚠ worker arrêté : /login', '· worker terminé il y a 2 min']) expect(texts, text).toContain(text)
  expect((await pane.find({ type: 'Text', text: /⚠.worker.arrêté/ }))?.props.color).toBe(C.red)
  await pane.unmount()
})

/** L'onglet Agents d'une discussion qui ne tient pas le siège : ses textes, de son en-tête à sa légende. */
const agentsTabOf = async ($: any, clock: any): Promise<string[]> => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'tab-agents' })
  await settle(clock, 1)
  const texts = await textsOf(pane)
  const label = await labelOf(pane, 'tab-agents')
  await pane.unmount()
  const from = texts.findIndex(t => /Manager|worker/.test(t))
  return [label, ...texts.slice(Math.max(0, from - 1), Math.max(0, from - 1) + 6)]
}

// Le même rendu avant et après ce ticket : les trois tests qui suivent passent aussi contre le code d'avant la liste des agents du COO
// (vérifié par `scripts/check.sh --test <copie de ces seuls tests> --contre 8e88bde4 flow-board`, 3 pass).
test('dans une discussion qui ne tient pas le siège (ordinaire, manager, worker), l’onglet Agents est le même qu’avant : sa frise', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = missionOf('Ailleurs', T0, { owner: 'session-M' }, g => (g.id === 'A' ? { ...g, ...linked('session-W') } : g))
  writeBoard(w, b => ({ ...b, runs: [run] }))
  // Une discussion ordinaire.
  w.ids.now = 'session-X'
  await start($)
  await settle(clock, 2)
  expect(await agentsTabOf($, clock)).toEqual([
    '▸ Agents',
    'Reprends-en une depuis l’onglet Historique, ou lance un skill pour en démarrer une.',
    ' ◆ Manager ',
    'cette discussion',
    'Aucun spécialiste dans cette discussion pour l’instant.',
    'tout',
    'heure',
  ])
})

test('le manager d’une mission en cours : son onglet Agents est le même qu’avant', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = missionOf('Ailleurs', T0, { owner: 'session-M' }, g => (g.id === 'A' ? { ...g, ...linked('session-W') } : g))
  writeBoard(w, b => ({ ...b, runs: [run], activeId: run.id }))
  w.ids.now = 'session-M'
  await start($)
  await settle(clock, 2)
  expect(await agentsTabOf($, clock)).toEqual(EXPECTED_MANAGER)
})

test('un worker : son onglet Agents est le même qu’avant', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = missionOf('Ailleurs', T0, { owner: 'session-M' }, g => (g.id === 'A' ? { ...g, ...linked('session-W') } : g))
  writeBoard(w, b => ({ ...b, runs: [run] }))
  w.ids.now = 'session-W'
  await start($)
  await $.tool.call({ tool: TOOL, delegate: run.id, group: 'A', main: '[abc123]' } as any)
  await settle(clock, 2)
  expect(await agentsTabOf($, clock)).toEqual(EXPECTED_WORKER)
})

const EXPECTED_MANAGER: string[] = ['▸ Agents', '/implement  ·  12 s  ·  phase 1/4', ' ◆ Manager ', 'cette discussion', 'Aucun spécialiste dans cette discussion pour l’instant.', 'tout', 'heure']
const EXPECTED_WORKER: string[] = [
  '▸ Agents',
  'Le manager suit cette mission : il rend les statuts des tickets à la fin de cette session.',
  ' ◆ Manager ',
  'worker de [abc123]',
  'Aucun spécialiste dans cette discussion pour l’instant.',
  'tout',
  'heure',
]
