// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { applyReport, archiveRun, clampFuture, detachOnLoad, emptyBoard, isAutoOn, mergeBoards, openHandoff, openRun, parkActive, resumeRun, setAsideActive } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// Une mission ne vit que dans sa discussion (choix de Mathis du 09/11/2026). Constat (quatre discussions, du
// 03/11 au 09/11/2026) : chaque réponse « No mission is active » reçue par un manager suit une sortie de son
// processus (ligne `cost-state` du transcript), puis une relance sous le même id, parfois avec une nouvelle
// version de Claude Code ou deux jours plus tard ; la mission avait été mise en pause à la sortie
// (`session.end`), ou au chargement, et rien ne la rendait à la discussion relancée : il fallait cliquer
// « ↻ Reprendre ici ». Désormais ni la fin d'une discussion ni le silence ne la mettent en pause.

const TOOL = 'mcp__flow-board__flow'
const KEY = 'board:'

const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')

/**
 * Le moteur sous le plugin, avec un stockage en mémoire : le fichier commun des missions quand le mod sait
 * où est ~/.claude (`disk`), `$.store` sinon (`mem`, clé `board:`) ; `ids.now` est l'id de la discussion.
 */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const disk: { board?: string; isUsed: boolean } = { isUsed: false }
  const files: Record<string, string> = {}
  const ids = { now: 'session-A' }
  on('session.end', () => ({ sessionId: ids.now }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('ui.toast', () => ({ value: undefined }))
  on('session.id', () => ({ value: ids.now }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isBoardFile(e.path) ? disk.board !== undefined : e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      if (disk.board === undefined) throw new Error(`ENOENT ${e.path}`)
      return { value: disk.board } as any
    }
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      disk.board = e.text
    } else files[e.path] = e.text
    return { value: undefined } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  return { mem, disk, ids }
}

const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
type World = ReturnType<typeof world>
/** Le board enregistré : dans le fichier commun s'il sert, sinon dans `$.store`. */
const stored = (w: Pick<World, 'mem' | 'disk'>): Board => (w.disk.isUsed && w.disk.board !== undefined ? JSON.parse(w.disk.board) : w.mem[KEY]) as Board

/** Ce que le fichier des missions garde quand le processus repart : les deux stockages, comme `seed` de mode-auto. */
const seed = (w: Pick<World, 'mem' | 'disk'>, value: Board) => {
  w.mem[KEY] = JSON.parse(JSON.stringify(value))
  w.disk.board = JSON.stringify(value)
}

const T0 = 200_000_000
const MIN = 60 * 1000
const LATER = T0 + 46 * MIN
const NO_MISSION = /No mission is active in this discussion/

/** La mission du manager, ouverte par la discussion A à T0 (le vrai chemin de l'outil, `openRun`). */
const managerBoard = (): { board: Board; id: string } => {
  const opened = openRun({ ...emptyBoard('', 'projet'), session: 'session-A', boot: 'boot-P1', deleted: [] }, { title: 'Mission du manager' }, T0)
  return { board: opened.board, id: opened.board.activeId! }
}
/** Le board tel qu'une autre discussion le tient : même fichier, son id, rien d'actif chez elle. */
const asSeenBy = (board: Board, session: string): Board => ({ ...board, session, activeId: null })

/** Le processus de la discussion repart (un nouveau module), puis Claude écrit dans sa mission. */
const restart = async ($: any, clock: { advance: (ms: number) => Promise<void> }): Promise<string> => {
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await settle(clock, 6)
  const r = await $.tool.call({ tool: TOOL, note: 'Groupe D rendu' } as any)
  await settle(clock, 2)
  return String(r.result)
}

// ─── La discussion relancée retrouve sa mission ──────────────────────────

test('la fin de la discussion (session.end) ne met plus sa mission en pause, et la discussion relancée sous le même id la retrouve', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  const { board, id } = managerBoard()
  // La fin du processus : `parkActive`, comme le hook `session.end` (register.tsx).
  const ended = parkActive(board, T0 + MIN)!.board
  expect(ended.runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
  expect(ended.activeId).toBeNull()
  seed(w, ended)
  expect(await restart($, clock)).not.toMatch(NO_MISSION)
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
})

test('tuée sans session.end, la discussion relancée sous le même id retrouve sa mission', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  const { board, id } = managerBoard()
  seed(w, board)
  expect(await restart($, clock)).not.toMatch(NO_MISSION)
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
})

test('une autre discussion qui charge ne met plus en pause la mission muette depuis 46 minutes, et la discussion relancée la retrouve', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  const { board, id } = managerBoard()
  seed(w, detachOnLoad(asSeenBy(board, 'session-B'), T0 + 46 * MIN, 'session-B'))
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
  expect(await restart($, clock)).not.toMatch(NO_MISSION)
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
})

// ─── Jamais celle d'une autre ni celle qu'on a rangée ────────────────────

test('reprise ailleurs (secours dans B) puis B finie : la mission reste à B, A relancée ne la reprend pas', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  const { board, id } = managerBoard()
  const takenByB = resumeRun(asSeenBy(board, 'session-B'), id, T0 + 2 * MIN)!.board
  seed(w, parkActive(takenByB, T0 + 3 * MIN)!.board)
  expect(await restart($, clock)).toMatch(NO_MISSION)
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-B' })
})

test('mise de côté ou archivée : la discussion relancée ne la reprend pas', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  const { board, id } = managerBoard()
  const aside = setAsideActive(board, T0 + MIN)!.board
  const second = openRun(aside, { title: 'Deuxième mission' }, T0 + 2 * MIN)
  const archived = archiveRun(second.board, second.board.activeId!, T0 + 3 * MIN)!.board
  seed(w, archived)
  expect(await restart($, clock)).toMatch(NO_MISSION)
  expect(stored(w).runs.find(x => x.id === id)?.status).toBe('paused')
  expect(stored(w).runs.find(x => x.id === second.board.activeId)?.archivedAt).toBeDefined()
})

test('laissée pour une autre mission de la même discussion : la discussion relancée reprend la dernière, jamais l’ancienne', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  const { board, id } = managerBoard()
  const second = openRun(board, { title: 'Deuxième mission' }, T0 + MIN)
  const secondId = second.board.activeId!
  seed(w, parkActive(second.board, T0 + 2 * MIN)!.board)
  expect(await restart($, clock)).not.toMatch(NO_MISSION)
  expect(stored(w).runs.find(x => x.id === secondId)).toMatchObject({ status: 'active', owner: 'session-A' })
  expect(stored(w).runs.find(x => x.id === id)?.status).toBe('paused')
})

test('une discussion neuve qui charge après la fin de A ne prend rien', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  w.ids.now = 'session-C'
  const { board, id } = managerBoard()
  seed(w, parkActive(board, T0 + MIN)!.board)
  expect(await restart($, clock)).toMatch(NO_MISSION)
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
})

test('la discussion du COO relancée ne reprend pas la mission qu’elle tenait', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  const { board, id } = managerBoard()
  w.mem['coo-here:session-A'] = true
  seed(w, { ...parkActive(board, T0 + MIN)!.board, coo: { by: 'session-A', at: LATER - 1000, seenAt: LATER - 1000 } })
  await restart($, clock)
  expect(stored(w).runs.find(x => x.id === id)?.status).toBe('paused')
})

// ─── Une discussion vivante ──────────────────────────────────────────────

test('vivante et muette, la discussion garde sa mission quand une autre charge le fichier', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.tool.call({ tool: TOOL, open: { title: 'Mission du manager' } } as any)
  await settle(clock, 2)
  const id = stored(w).runs[0]!.id
  await clock.advance(31 * MIN)
  seed(w, detachOnLoad(asSeenBy(stored(w), 'session-B'), T0 + 31 * MIN + 2_000, 'session-B'))
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
  await settle(clock, 12)
  const r = await $.tool.call({ tool: TOOL, note: 'Groupe D rendu' } as any)
  expect(String(r.result)).not.toMatch(NO_MISSION)
})

test('vivante et muette, la discussion garde sa mission qu’une discussion d’une version d’avant a mise en pause dans le fichier, et l’y redit active à sa prochaine écriture', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.tool.call({ tool: TOOL, open: { title: 'Mission du manager' } } as any)
  await settle(clock, 2)
  const id = stored(w).runs[0]!.id
  await clock.advance(31 * MIN)
  // Ce qu'écrivait la mise en pause au chargement d'avant le 09/11/2026 : en pause, sans titulaire, datée.
  const old = stored(w)
  seed(w, { ...old, runs: old.runs.map(r => (r.id === id ? { ...r, status: 'paused' as const, owner: undefined, updatedAt: T0 + 31 * MIN + 2_000 } : r)) })
  await settle(clock, 12)
  const r = await $.tool.call({ tool: TOOL, note: 'Groupe D rendu' } as any)
  expect(String(r.result)).not.toMatch(NO_MISSION)
  await settle(clock, 2)
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
})

// ─── Le mode auto et les processus ───────────────────────────────────────

test('tuée en auto (sans session.end), la discussion relancée retrouve sa mission avec l’auto éteint : il ne repart que sur deux clics', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  const { board, id } = managerBoard()
  const lit: Board = { ...board, runs: board.runs.map(r => ({ ...r, auto: { onAt: T0 + 1000, onBy: 'session-A' } })) }
  expect(isAutoOn(lit.runs[0]!)).toBe(true)
  seed(w, lit)
  expect(await restart($, clock)).not.toMatch(NO_MISSION)
  const run = stored(w).runs.find(x => x.id === id)!
  expect(run).toMatchObject({ status: 'active', owner: 'session-A' })
  expect(isAutoOn(run)).toBe(false)
})

test('deux processus d’une même discussion : le dernier qui la prend tient la mission, l’autre la lui laisse à sa relecture', () => {
  const { board, id } = managerBoard()
  expect(board.runs.find(x => x.id === id)?.claim).toEqual({ boot: 'boot-P1', at: T0 })
  // P2 charge le fichier (reprise au terminal pendant que l'app garde P1) : il prend la mission.
  const p2 = detachOnLoad(asSeenBy(board, 'session-A'), T0 + 5 * MIN, 'session-A', 'boot-P2')
  expect(p2.activeId).toBe(id)
  expect(p2.runs.find(x => x.id === id)).toMatchObject({ claim: { boot: 'boot-P2', at: T0 + 5 * MIN }, updatedAt: T0 + 5 * MIN })
  // P1 relit le fichier : il la laisse.
  expect(mergeBoards(board, p2).activeId).toBeNull()
  // P1 a écrit après le chargement de P2 (sa copie plus récente) : sa sauvegarde garde la prise de P2, et il la laisse.
  const p1Later = applyReport(board, { note: 'avancée de P1' }, T0 + 6 * MIN).board
  const savedByP1 = mergeBoards(p1Later, p2)
  expect(savedByP1.activeId).toBeNull()
  expect(savedByP1.runs.find(x => x.id === id)?.claim).toEqual({ boot: 'boot-P2', at: T0 + 5 * MIN })
  // P2 relit ce fichier, puis sa propre écriture : il la garde.
  expect(mergeBoards(p2, savedByP1).activeId).toBe(id)
  expect(mergeBoards(p2, p2).activeId).toBe(id)
  // P1 la reprend ensuite (« ↻ Reprendre ici ») : sa prise est la plus récente, P2 la laisse à son tour.
  const retaken = resumeRun({ ...savedByP1, boot: 'boot-P1' }, id, T0 + 8 * MIN)!.board
  expect(retaken.runs.find(x => x.id === id)?.claim).toEqual({ boot: 'boot-P1', at: T0 + 8 * MIN })
  expect(mergeBoards(p2, retaken).activeId).toBeNull()
  expect(mergeBoards(retaken, p2).activeId).toBe(id)
})

test('le même processus qui revient au fichier (changement de racine) garde sa mission telle quelle, auto compris', () => {
  const { board, id } = managerBoard()
  const lit: Board = { ...board, runs: board.runs.map(r => ({ ...r, auto: { onAt: T0 + 1000, onBy: 'session-A' } })) }
  const back = detachOnLoad(asSeenBy(lit, 'session-A'), T0 + 5 * MIN, 'session-A', 'boot-P1')
  expect(back.activeId).toBe(id)
  const run = back.runs.find(x => x.id === id)!
  expect(isAutoOn(run)).toBe(true)
  expect(run.updatedAt).toBe(lit.runs.find(x => x.id === id)!.updatedAt)
  expect(run.claim).toEqual({ boot: 'boot-P1', at: T0 })
})

// ─── La fusion de la prise (`keepClaim`) ───────────────────────────────────

/** La copie de P1 (active ici) et celle du fichier, où la prise de la mission est `claim`. */
const withClaimOf = (claim: unknown): { p1: Board; file: Board; id: string } => {
  const { board, id } = managerBoard()
  const file = { ...board, runs: board.runs.map(r => ({ ...r, claim, updatedAt: T0 + 5 * MIN }) as Run) }
  return { p1: board, file, id }
}

test('prise · date illisible : une prise d’un autre processus sans date lisible ne retire pas la mission', () => {
  const { p1, file, id } = withClaimOf({ boot: 'boot-P2', at: 'demain' })
  const merged = mergeBoards(p1, file)
  expect(merged.activeId).toBe(id)
  expect(merged.runs.find(x => x.id === id)?.claim).toEqual({ boot: 'boot-P1', at: T0 })
})

test('prise · date future : ramenée à maintenant à la lecture, elle ne gagne plus toutes les fusions', () => {
  const { file, id } = withClaimOf({ boot: 'boot-P2', at: T0 + 99 * MIN })
  expect(clampFuture(file, T0 + 6 * MIN).runs.find(x => x.id === id)?.claim).toEqual({ boot: 'boot-P2', at: T0 + 6 * MIN })
})

test('prise · valeur absente : une copie sans prise garde la prise de l’autre, et ne retire pas la mission', () => {
  const { p1, file, id } = withClaimOf(undefined)
  const merged = mergeBoards(p1, file)
  expect(merged.activeId).toBe(id)
  expect(merged.runs.find(x => x.id === id)?.claim).toEqual({ boot: 'boot-P1', at: T0 })
})

test('prise · valeur abîmée : une prise qui n’est pas un objet ne compte pas', () => {
  for (const claim of ['boot-P2', 7, { boot: '', at: T0 + MIN }, { boot: 3, at: T0 + MIN }]) {
    const { p1, file, id } = withClaimOf(claim)
    expect(mergeBoards(p1, file).activeId).toBe(id)
  }
})

// ─── La reprise ailleurs : un secours ─────────────────────────────────────

const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const
const pane = async ($: any) => $.ui.mount({ plugin: 'flow-board', surface: 'desktop', ...PANE })

test('« ↻ Reprendre ici » d’une mission tenue par une autre discussion demande « Confirmer (secours) » ; le second clic la prend', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  w.ids.now = 'session-B'
  const { board, id } = managerBoard()
  seed(w, board)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await settle(clock, 2)
  let ui = await pane($)
  await ui.press({ key: `resume-${id}` })
  await ui.unmount()
  await settle(clock, 2)
  // L'effet d'abord : rien n'a bougé, la confirmation est proposée.
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
  ui = await pane($)
  expect(await ui.find({ key: `resume-confirm-${id}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Secours : cette mission vit dans une autre discussion/ })).toBeDefined()
  await ui.press({ key: `resume-cancel-${id}` })
  await ui.unmount()
  ui = await pane($)
  expect(await ui.find({ key: `resume-confirm-${id}` })).toBeUndefined()
  await ui.press({ key: `resume-${id}` })
  await ui.unmount()
  ui = await pane($)
  await ui.press({ key: `resume-confirm-${id}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-B' })
})

test('une mission née ici et laissée pour une autre se reprend d’un clic, sans confirmation', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  const { board, id } = managerBoard()
  const second = openRun(board, { title: 'Deuxième mission' }, T0 + MIN)
  seed(w, setAsideActive(second.board, T0 + 2 * MIN)!.board)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await settle(clock, 2)
  let ui = await pane($)
  await ui.press({ key: 'tab-history' })
  await ui.unmount()
  ui = await pane($)
  await ui.press({ key: `resume-${id}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
})

test('« ↻ Reprendre » d’une mission née ici mais reprise ailleurs entre-temps (le fichier le dit, pas encore la copie d’ici) demande la confirmation', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  const { board, id } = managerBoard()
  const second = openRun(board, { title: 'Deuxième mission' }, T0 + MIN)
  seed(w, second.board)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await settle(clock, 2)
  let ui = await pane($)
  await ui.press({ key: 'tab-history' })
  await ui.unmount()
  // Une autre discussion la reprend en secours : le fichier le dit, la copie en mémoire d'ici pas encore.
  const inB = resumeRun(asSeenBy(stored(w), 'session-B'), id, LATER)!.board
  seed(w, { ...inB, session: 'session-A', activeId: stored(w).activeId })
  ui = await pane($)
  await ui.press({ key: `resume-${id}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-B' })
  ui = await pane($)
  expect(ui.find({ key: `resume-confirm-${id}` })).toBeDefined()
  await ui.press({ key: `resume-confirm-${id}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
})

test('le champ resume de l’outil ne prend pas la mission d’une autre discussion : rien n’est repris ni enregistré', () => {
  const { board, id } = managerBoard()
  const there = asSeenBy(board, 'session-B')
  const out = applyReport(there, { resume: id, note: 'x' }, T0 + MIN)
  expect(out.text).toMatch(/lives in another discussion: nothing was resumed nor recorded/)
  expect(out.text).toMatch(/« ↻ Reprendre ici » then « Confirmer \(secours\) »/)
  expect(out.board.runs.find(x => x.id === id)).toMatchObject({ status: 'active', owner: 'session-A' })
  expect(out.board.activeId).toBeNull()
})

test('« 🐞 Bug · worker » ouvre le passage : la session de diagnostic prend la mission une fois, dans l’heure ; la discussion qui l’a ouvert la reprend ensuite, elle seule', () => {
  const { board, id } = managerBoard()
  const opened = openHandoff(board, T0 + MIN)!.board
  expect(opened.runs.find(x => x.id === id)?.handoff).toEqual({ at: T0 + MIN, from: 'session-A' })
  // Passé l'heure : refusé.
  expect(applyReport(asSeenBy(opened, 'session-W'), { resume: id }, T0 + 62 * MIN).text).toMatch(/lives in another discussion/)
  // Dans l'heure : la session de diagnostic la prend ; le passage garde son adresse de retour.
  const taken = applyReport(asSeenBy(opened, 'session-W'), { resume: id }, T0 + 2 * MIN).board
  expect(taken.activeId).toBe(id)
  expect(taken.runs.find(x => x.id === id)).toMatchObject({ owner: 'session-W' })
  expect(taken.runs.find(x => x.id === id)?.handoff).toEqual({ at: T0 + MIN, from: 'session-A', by: 'session-W', byAt: T0 + 2 * MIN })
  // Une deuxième session ne la prend plus, ni une discussion qui n'a pas ouvert le passage.
  expect(applyReport(asSeenBy(taken, 'session-W2'), { resume: id }, T0 + 3 * MIN).text).toMatch(/lives in another discussion/)
  // La discussion qui l'a ouvert la reprend à la fin du diagnostic, et le passage se ferme.
  const back = applyReport(asSeenBy(taken, 'session-A'), { resume: id }, T0 + 4 * MIN).board
  expect(back.activeId).toBe(id)
  expect(back.runs.find(x => x.id === id)).toMatchObject({ owner: 'session-A' })
  expect(back.runs.find(x => x.id === id)?.handoff).toEqual({ at: T0 + MIN, from: 'session-A', by: 'session-W', byAt: T0 + 2 * MIN, closedAt: T0 + 4 * MIN })
  // Fermé : ni la session de diagnostic ni une autre ne la reprend plus par `resume`.
  expect(applyReport(asSeenBy(back, 'session-W'), { resume: id }, T0 + 5 * MIN).text).toMatch(/lives in another discussion/)
})

test('passage : il ne se prend plus une fois la mission reprise ailleurs en secours (copie qui ne l’a pas vu), ni close', () => {
  const { board, id } = managerBoard()
  const opened = openHandoff(board, T0 + MIN)!.board
  // B confirme la reprise de secours sur une copie d'avant le passage ; la fusion garde le passage ouvert de A.
  const inB = resumeRun(asSeenBy(board, 'session-B'), id, T0 + 2 * MIN)!.board
  const merged = mergeBoards(inB, opened)
  expect(merged.runs.find(x => x.id === id)).toMatchObject({ owner: 'session-B' })
  expect(applyReport(asSeenBy(merged, 'session-W'), { resume: id }, T0 + 3 * MIN).text).toMatch(/lives in another discussion/)
  // Close (sans que la clôture ait fermé le passage) : pas de prise qui la rouvrirait.
  const done = { ...opened, activeId: null, runs: opened.runs.map(r => ({ ...r, status: 'done' }) as Run) }
  expect(applyReport(asSeenBy(done, 'session-W'), { resume: id }, T0 + 3 * MIN).board.runs.find(x => x.id === id)?.status).toBe('done')
})

test('passage : la discussion qui l’a ouvert reprend sa propre mission sans que la session de diagnostic l’ait prise : le passage se ferme', () => {
  const { board, id } = managerBoard()
  const opened = openHandoff(board, T0 + MIN)!.board
  const back = applyReport(opened, { resume: id }, T0 + 3 * MIN).board
  expect(back.runs.find(x => x.id === id)?.handoff).toEqual({ at: T0 + MIN, from: 'session-A', closedAt: T0 + 3 * MIN })
  expect(applyReport(asSeenBy(back, 'session-W'), { resume: id }, T0 + 4 * MIN).text).toMatch(/lives in another discussion/)
})

test('passage : sans prise par la session de diagnostic, la discussion de naissance n’a pas de retour à faire sur une mission reprise ailleurs en secours', () => {
  const { board, id } = managerBoard()
  // Reprise en secours dans B (resumeRun : le geste confirmé), sans passage : A ne la reprend pas par `resume`.
  const inB = resumeRun(asSeenBy(board, 'session-B'), id, T0 + MIN)!.board
  expect(applyReport(asSeenBy(inB, 'session-A'), { resume: id }, T0 + 2 * MIN).text).toMatch(/lives in another discussion/)
})

test('passage : une mise de côté le ferme ; le passage d’une mission d’avant (sans `from`) ne s’ouvre à personne', () => {
  const { board, id } = managerBoard()
  const opened = openHandoff(board, T0 + MIN)!.board
  const aside = setAsideActive(opened, T0 + 2 * MIN)!.board
  expect(aside.runs.find(x => x.id === id)?.handoff).toMatchObject({ closedAt: T0 + 2 * MIN })
  const old = { ...board, runs: board.runs.map(r => ({ ...r, handoff: { at: T0 + MIN } }) as unknown as Run) }
  expect(applyReport(asSeenBy(old, 'session-W'), { resume: id }, T0 + 2 * MIN).text).toMatch(/lives in another discussion/)
})

// ─── La fusion du passage (`keepHandoff`) ──────────────────────────────────

/** La copie d'ici (passage ouvert par A à T0+1) et celle du fichier, où le passage est `handoff`. */
const withHandoffOf = (handoff: unknown): { here: Board; file: Board; id: string } => {
  const { board, id } = managerBoard()
  const here = openHandoff(board, T0 + MIN)!.board
  const file = { ...here, runs: here.runs.map(r => ({ ...r, handoff, updatedAt: T0 + 5 * MIN }) as Run) }
  return { here, file, id }
}
const OPENED = { at: T0 + MIN, from: 'session-A' }

test('passage · date illisible : un passage du fichier sans date lisible ne compte pas', () => {
  const { here, file, id } = withHandoffOf({ at: 'demain', from: 'session-A', by: 'session-W', byAt: 'demain' })
  expect(mergeBoards(here, file).runs.find(x => x.id === id)?.handoff).toEqual(OPENED)
})

test('passage · date future : ramené à maintenant à la lecture, il ne gagne plus toutes les fusions', () => {
  const { file, id } = withHandoffOf({ at: T0 + 99 * MIN, from: 'session-A', by: 'session-W', byAt: T0 + 99 * MIN })
  expect(clampFuture(file, T0 + 6 * MIN).runs.find(x => x.id === id)?.handoff).toEqual({ at: T0 + 6 * MIN, from: 'session-A', by: 'session-W', byAt: T0 + 6 * MIN })
})

test('passage · valeur absente : une copie sans passage garde celui de l’autre', () => {
  const { here, file, id } = withHandoffOf(undefined)
  expect(mergeBoards(here, file).runs.find(x => x.id === id)?.handoff).toEqual(OPENED)
  expect(mergeBoards(file, here).runs.find(x => x.id === id)?.handoff).toEqual(OPENED)
})

test('passage · valeur abîmée : un passage hors forme ne compte pas', () => {
  for (const handoff of ['ouvert', 7, { at: T0 + 2 * MIN, from: '' }, { at: T0 + 2 * MIN, from: 'session-A', by: 'session-W' }, { at: T0 + 2 * MIN, from: 'session-A', closedAt: 'hier' }]) {
    const { here, file, id } = withHandoffOf(handoff)
    expect(mergeBoards(here, file).runs.find(x => x.id === id)?.handoff).toEqual(OPENED)
  }
})

test('passage · deux ordres : une copie en retard ne rouvre ni un passage pris, ni un passage fermé', () => {
  const taken = { ...OPENED, by: 'session-W', byAt: T0 + 2 * MIN }
  const closed = { ...taken, closedAt: T0 + 4 * MIN }
  // À date égale (horloge en retard au retour), le passage fermé l'emporte encore.
  const closedSame = { ...taken, closedAt: T0 + 2 * MIN }
  for (const [older, newer] of [[OPENED, taken], [taken, closed], [OPENED, closed], [taken, closedSame]]) {
    const { here, file, id } = withHandoffOf(newer)
    const stale = { ...here, runs: here.runs.map(r => ({ ...r, handoff: older }) as Run) }
    expect(mergeBoards(stale, file).runs.find(x => x.id === id)?.handoff).toEqual(newer)
    expect(mergeBoards(file, stale).runs.find(x => x.id === id)?.handoff).toEqual(newer)
  }
})

test('« 🐞 Bug · worker » au panneau ouvre le passage de la mission dans le fichier', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.tool.call({ tool: TOOL, open: { title: 'Mission du manager' } } as any)
  await settle(clock, 2)
  const ui = await pane($)
  await ui.press({ key: 'any-bug' })
  await ui.unmount()
  await settle(clock, 2)
  expect(stored(w).runs[0]!.handoff).toEqual({ at: expect.any(Number), from: 'session-A' })
})
