// Les cases de la matrice de fusion (champs-persistes.test.mjs, `MERGE_MATRIX`) qu'aucun test voisin
// ne couvrait : pour un champ que `mergeBoards` fusionne à part, une date illisible, une date future,
// une valeur absente ou abîmée dans une copie, et les deux ordres de fusion. Chaque titre commence par
// « matrice · <champ> · <cas> », que la matrice cite. Deux copies d'une même mission, aucune active
// ici : la plus récente est gardée (`keepRun`), l'autre lui apporte ses champs fusionnés à part. « Les
// deux ordres » échangent la copie gardée et l'autre (chacune à son tour la plus récente), et aussi la
// copie d'ici et celle du stockage : une valeur fautive se trouve ainsi une fois dans la copie gardée,
// une fois dans l'autre.

import { expect, test } from 'claude-code/testing'

import { clampFuture, emptyBoard, mergeBoards, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const T0 = 91_000_000
const FUTURE = T0 + 1e12

const base = (): Run => ({ ...newRun('implement', T0, 'Boutique'), status: 'paused' })
/** Deux copies d'une même mission : `a` plus ancienne, `b` plus récente ; aucune active ici. */
const copies = (a: Partial<Run> | Record<string, unknown>, b: Partial<Run> | Record<string, unknown>): [Board, Board] => {
  const run = base()
  const board = (fields: object, at: number, session: string): Board => ({
    ...emptyBoard('/p', 'p'),
    session,
    activeId: null,
    runs: [{ ...run, ...fields, updatedAt: at } as Run],
  })
  return [board(a, T0 + 1, 'sa'), board(b, T0 + 2, 'sb')]
}
/** La mission fusionnée, dans les deux ordres : `b` gardée (la plus récente, d'ici), puis `a` gardée (la plus récente, du stockage). */
const bothWays = (a: Partial<Run> | Record<string, unknown>, b: Partial<Run> | Record<string, unknown>): [Run, Run] => {
  const [olderA, newerB] = copies(a, b)
  const [olderB, newerA] = copies(b, a)
  return [mergeBoards(newerB, olderA).runs[0]!, mergeBoards(olderB, newerA).runs[0]!]
}

test('matrice · les deux ordres échangent la copie gardée : la plus récente l’emporte une fois de chaque côté', () => {
  const [keptB, keptA] = bothWays({ title: 'A' }, { title: 'B' })
  expect(keptB.title).toBe('B')
  expect(keptA.title).toBe('A')
})

// --- reportValidatedAt (keepReportMark) --------------------------------------

test('matrice · reportValidatedAt · date illisible : une marque illisible ne fait pas perdre la validation lue de l’autre copie, dans les deux ordres', () => {
  for (const run of bothWays({ reportValidatedAt: 'hier' }, { reportValidatedAt: T0 + 5 })) expect(run.reportValidatedAt).toBe(T0 + 5)
  for (const run of bothWays({ reportValidatedAt: T0 + 5 }, { reportValidatedAt: Number.NaN })) expect(run.reportValidatedAt).toBe(T0 + 5)
})

test('matrice · reportValidatedAt · valeur abîmée : une marque qui n’est pas une date ne remplace jamais une validation lue, dans les deux ordres', () => {
  for (const bad of [{}, [], null, '2026']) for (const run of bothWays({ reportValidatedAt: bad }, { reportValidatedAt: T0 + 5 })) expect(run.reportValidatedAt).toBe(T0 + 5)
})

test('matrice · reportValidatedAt · deux ordres : la validation d’une seule copie se garde, quelle que soit la copie gardée', () => {
  for (const run of bothWays({ reportValidatedAt: T0 + 5 }, {})) expect(run.reportValidatedAt).toBe(T0 + 5)
  for (const run of bothWays({}, { reportValidatedAt: T0 + 5 })) expect(run.reportValidatedAt).toBe(T0 + 5)
})

// --- decided (keepDecided), pour une mission qui a été en auto ---------------

const AUTO = { auto: { onAt: T0, onBy: 'sa' } }
const choice = (what: string, at: unknown) => ({ what, at, origin: 'recommendation' })
const whats = (run: Run) => (run.decided ?? []).map(d => (d && typeof d === 'object' ? d.what : String(d))).sort()

test('matrice · decided · date illisible : un choix à la date illisible et les choix lus de l’autre copie restent tous, dans les deux ordres', () => {
  for (const run of bothWays({ ...AUTO, decided: [choice('Un', 'hier')] }, { ...AUTO, decided: [choice('Deux', T0 + 3)] })) expect(whats(run)).toEqual(['Deux', 'Un'])
})

test('matrice · decided · date future : un choix daté loin dans le futur ne fait perdre aucun choix de l’autre copie, dans les deux ordres', () => {
  for (const run of bothWays({ ...AUTO, decided: [choice('Futur', FUTURE)] }, { ...AUTO, decided: [choice('Un', T0 + 3), choice('Deux', T0 + 4)] })) expect(whats(run)).toEqual(['Deux', 'Futur', 'Un'])
})

test('matrice · decided · valeur absente : une copie sans choix ne vide pas ceux de l’autre, dans les deux ordres', () => {
  for (const run of bothWays({ ...AUTO }, { ...AUTO, decided: [choice('Un', T0 + 3)] })) expect(whats(run)).toEqual(['Un'])
  for (const run of bothWays({ ...AUTO, decided: [choice('Un', T0 + 3)] }, { ...AUTO })) expect(whats(run)).toEqual(['Un'])
})

test('matrice · decided · valeur abîmée : une liste qui n’en est pas une ou une entrée hors forme ne fait perdre aucun choix lu, dans les deux ordres', () => {
  for (const run of bothWays({ ...AUTO, decided: 'x' }, { ...AUTO, decided: [choice('Un', T0 + 3)] })) expect(whats(run)).toContain('Un')
  for (const run of bothWays({ ...AUTO, decided: [42, null, { what: 7 }] }, { ...AUTO, decided: [choice('Un', T0 + 3)] })) expect(whats(run)).toContain('Un')
})

// --- forced (keepForced) -----------------------------------------------------

const hold = (at: unknown) => ({ held: 'A', run: 'r-autre', group: 'B', at })

test('matrice · forced · date illisible : un forçage à la date illisible ne compte pas, celui lu de l’autre copie reste, dans les deux ordres', () => {
  for (const run of bothWays({ forced: [hold('hier')] }, { forced: [hold(T0 + 5)] })) expect(run.forced).toEqual([hold(T0 + 5)])
  for (const run of bothWays({ forced: [hold(T0 + 5)] }, { forced: [hold(Number.NaN)] })) expect(run.forced).toEqual([hold(T0 + 5)])
})

test('matrice · forced · date future : la même paire datée loin dans le futur ne remplace pas sa date lue (la plus ancienne reste), dans les deux ordres', () => {
  for (const run of bothWays({ forced: [hold(FUTURE)] }, { forced: [hold(T0 + 5)] })) expect(run.forced).toEqual([hold(T0 + 5)])
})

test('matrice · forced · valeur abîmée : une liste ou une paire hors forme ne fait tomber aucun forçage lu, dans les deux ordres', () => {
  for (const bad of ['x', {}, [null, 42, { held: '../x', run: 'r', group: 'B', at: T0 }]]) for (const run of bothWays({ forced: bad }, { forced: [hold(T0 + 5)] })) expect(run.forced).toEqual([hold(T0 + 5)])
})

// --- instructed (keepInstructed) ---------------------------------------------

test('matrice · instructed · valeur absente : une copie sans trace des consignes reçues ne vide pas celle de l’autre, dans les deux ordres', () => {
  for (const run of bothWays({}, { instructed: ['cabc1234'] })) expect(run.instructed).toEqual(['cabc1234'])
  for (const run of bothWays({ instructed: ['cabc1234'] }, {})) expect(run.instructed).toEqual(['cabc1234'])
})

test('matrice · instructed · valeur abîmée : une trace qui n’est pas une liste, ou des ids hors forme, ne font tomber aucun id lu, dans les deux ordres', () => {
  for (const bad of ['x', {}, [null, 42, '../x', 'C-PAS-UN-ID']]) for (const run of bothWays({ instructed: bad }, { instructed: ['cabc1234'] })) expect(run.instructed).toEqual(['cabc1234'])
})

test('matrice · instructed · deux ordres : les traces des deux copies s’unissent, sans doublon, quelle que soit la copie gardée', () => {
  for (const run of bothWays({ instructed: ['cabc1234', 'cdef5678'] }, { instructed: ['cdef5678', 'cghi9012'] })) expect([...(run.instructed ?? [])].sort()).toEqual(['cabc1234', 'cdef5678', 'cghi9012'])
})

// --- launch (keepLaunch) -----------------------------------------------------

const launch = (at: unknown, id = 'labcdefgh1') => ({ id, card: 'kabcdef1', at, folder: 'export-csv', start: 'grill-with-docs', mode: 'manual' })

test('matrice · launch · date illisible : un rattachement à la date illisible ne remplace jamais celui en forme de l’autre copie, dans les deux ordres', () => {
  for (const run of bothWays({ launch: launch('hier') }, { launch: launch(T0 + 5) })) expect(run.launch).toEqual(launch(T0 + 5))
})

test('matrice · launch · date future : deux rattachements en forme, le plus ancien clic l’emporte sur un clic daté loin dans le futur, dans les deux ordres', () => {
  for (const run of bothWays({ launch: launch(FUTURE, 'lzzzzzzzz9') }, { launch: launch(T0 + 5) })) expect(run.launch).toEqual(launch(T0 + 5))
})

test('matrice · launch · valeur abîmée : un rattachement hors forme ne remplace jamais celui en forme de l’autre copie, dans les deux ordres', () => {
  for (const bad of ['x', 42, [], { ...launch(T0 + 1), id: '../x' }, { ...launch(T0 + 1), lostAt: 'hier' }]) for (const run of bothWays({ launch: bad }, { launch: launch(T0 + 5) })) expect(run.launch).toEqual(launch(T0 + 5))
})

test('matrice · launch · deux ordres : le rattachement d’une seule copie se garde, quelle que soit la copie gardée', () => {
  for (const run of bothWays({ launch: launch(T0 + 5) }, {})) expect(run.launch).toEqual(launch(T0 + 5))
  for (const run of bothWays({}, { launch: launch(T0 + 5) })) expect(run.launch).toEqual(launch(T0 + 5))
})

// --- waiting (keepWaiting) ---------------------------------------------------

const question = (id: string, at: number) => ({ id, blocks: { kind: 'phase', id: 'implement' }, text: `${id} ?`, at })

test('matrice · waiting · valeur absente : une copie sans liste de questions ne fait perdre aucune question ouverte de l’autre, dans les deux ordres', () => {
  const open = (run: Run) => (run.waiting ?? []).map(q => q.id).sort()
  for (const run of bothWays({ waiting: undefined, answered: undefined }, { waiting: [question('q1', T0 + 3)] })) expect(open(run)).toEqual(['q1'])
  for (const run of bothWays({ waiting: [question('q1', T0 + 3)] }, { waiting: undefined, answered: undefined })) expect(open(run)).toEqual(['q1'])
})

test('matrice · waiting · date future : une trace « répondue » datée dans le futur, ramenée à maintenant à la lecture, n’efface pas la question reposée ensuite, dans les deux ordres', () => {
  const now = T0 + 5
  const open = (run: Run) => (run.waiting ?? []).map(q => q.id)
  const forged = { answered: [{ id: 'q1', at: FUTURE }] }
  const reasked = { waiting: [question('q1', T0 + 10)] }
  for (const [x, y] of [copies(forged, reasked), copies(reasked, forged)]) {
    const read = (b: Board) => clampFuture(b, now)
    expect(open(mergeBoards(read(y!), read(x!)).runs[0]!)).toEqual(['q1'])
    expect(open(mergeBoards(read(x!), read(y!)).runs[0]!)).toEqual(['q1'])
  }
})

// --- auto (keepAuto) ---------------------------------------------------------

test('matrice · auto · valeur absente : une copie sans état auto ne rallume ni n’éteint celui de l’autre, dans les deux ordres', () => {
  const on = { auto: { onAt: T0 + 3, onBy: 'sa' } }
  for (const run of bothWays({}, on)) expect(run.auto).toMatchObject({ onAt: T0 + 3, onBy: 'sa' })
  for (const run of bothWays(on, {})) expect(run.auto).toMatchObject({ onAt: T0 + 3, onBy: 'sa' })
  for (const run of bothWays({}, {})) expect(run.auto).toBeUndefined()
})

// --- autoSent (keepAutoSent) -------------------------------------------------

const mark = { key: 'k1', at: T0 + 3 }
const keysOf = (run: Run) => (Array.isArray(run.autoSent) ? run.autoSent : []).flatMap(m => (m && typeof m === 'object' && typeof (m as { key?: unknown }).key === 'string' ? [(m as { key: string }).key] : []))

test('matrice · autoSent · date illisible : une marque à la date illisible ne fait perdre aucune marque lue de l’autre copie, dans les deux ordres', () => {
  for (const run of bothWays({ autoSent: [{ key: 'k2', at: 'hier' }] }, { autoSent: [mark] })) expect(keysOf(run)).toContain('k1')
  for (const run of bothWays({ autoSent: [{ key: 'k1', at: T0 + 3, startedAt: 'hier' }] }, { autoSent: [mark] })) expect(keysOf(run)).toContain('k1')
})

test('matrice · autoSent · valeur abîmée : une liste de marques qui n’en est pas une ne fait perdre aucune marque lue, dans les deux ordres', () => {
  for (const bad of ['x', 42, {}, [null, 42]]) for (const run of bothWays({ autoSent: bad }, { autoSent: [mark] })) expect(keysOf(run)).toContain('k1')
})

// --- externals (keepExternals) -----------------------------------------------

const blocker = { id: '1200000000000001', name: 'Décision', status: 'done', statusAt: T0 + 5, isDecision: true }

test('matrice · externals · date illisible : un statut à la date illisible compte comme sans date, et le statut daté de l’autre copie l’emporte, dans les deux ordres', () => {
  const lostDate = { ...blocker, status: 'todo', statusAt: 'hier' }
  for (const run of bothWays({ externals: [lostDate] }, { externals: [blocker] })) expect(run.externals![0]).toMatchObject({ status: 'done', statusAt: T0 + 5 })
  const lifted = { ...blocker, statusAt: Number.NaN }
  const reopened = { ...blocker, status: 'todo', statusAt: T0 + 7 }
  for (const run of bothWays({ externals: [lifted] }, { externals: [reopened] })) expect(run.externals![0]).toMatchObject({ status: 'todo', statusAt: T0 + 7 })
})

test('matrice · externals · valeur absente : une copie sans bloqueurs ne fait perdre aucun bloqueur de l’autre, dans les deux ordres', () => {
  for (const run of bothWays({ externals: undefined }, { externals: [blocker] })) expect(run.externals).toEqual([blocker])
  for (const run of bothWays({ externals: [blocker] }, { externals: undefined })) expect(run.externals).toEqual([blocker])
})

// --- coo (mergeSeat, siège du COO) -------------------------------------------

const seatBoards = (a: unknown, b: unknown): Board[] => [
  { ...emptyBoard('/p', 'p'), session: 'sa', ...(a !== undefined ? { coo: a } : {}) } as Board,
  { ...emptyBoard('/p', 'p'), session: 'sb', ...(b !== undefined ? { coo: b } : {}) } as Board,
]
const SEAT = { by: 'session-B', at: T0 + 5, seenAt: T0 + 5 }

test('matrice · coo · date illisible : un siège à la date illisible ne l’emporte jamais sur un siège lu, dans les deux ordres', () => {
  for (const bad of [{ by: 'session-A', at: 'hier', seenAt: T0 }, { by: 'session-A', at: Number.NaN, seenAt: Number.NaN }]) {
    const [x, y] = seatBoards(bad, SEAT)
    expect(mergeBoards(x!, y!).coo).toEqual(SEAT)
    expect(mergeBoards(y!, x!).coo).toEqual(SEAT)
  }
})

test('matrice · coo · valeur abîmée : un siège hors forme ne l’emporte jamais sur un siège lu, par mergeBoards, dans les deux ordres', () => {
  for (const bad of ['x', 42, [], { by: '../x', at: T0 + 9, seenAt: T0 + 9 }, { by: 'session-A' }]) {
    const [x, y] = seatBoards(bad, SEAT)
    expect(mergeBoards(x!, y!).coo).toEqual(SEAT)
    expect(mergeBoards(y!, x!).coo).toEqual(SEAT)
  }
})

test('matrice · coo · valeur absente : un board sans siège garde celui de l’autre copie, dans les deux ordres', () => {
  const [x, y] = seatBoards(undefined, SEAT)
  expect(mergeBoards(x!, y!).coo).toEqual(SEAT)
  expect(mergeBoards(y!, x!).coo).toEqual(SEAT)
})

// --- deleted (soundTombstones, traces d'effacement) --------------------------

test('matrice · deleted · valeur absente : un board sans liste de traces n’empêche pas la trace de l’autre d’effacer la copie plus ancienne, dans les deux ordres', () => {
  const run = { ...base(), updatedAt: T0 + 1 }
  const old: Board = { ...emptyBoard('/p', 'p'), session: 'sa', activeId: null, runs: [run] }
  delete (old as { deleted?: unknown }).deleted
  const gone: Board = { ...emptyBoard('/p', 'p'), session: 'sb', activeId: null, runs: [], deleted: [{ id: run.id, at: T0 + 5 }] }
  expect(mergeBoards(old, gone).runs).toEqual([])
  expect(mergeBoards(gone, old).runs).toEqual([])
})
