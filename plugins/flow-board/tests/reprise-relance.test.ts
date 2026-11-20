// Stockage : les deux modes (scripts/check.sh relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { AUTO_STOPS, RELAUNCH_WINDOW_MS, applyReport, autoTurnedOffOnLoad, detachOnLoad, emptyBoard, isAutoOn, mergeBoards, newRun, parkActive, relaunchStillDue, relaunchVerdict, retakenPaused, resumeRun, setAsideActive, openRun, switchOnAuto } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { findAllAny, pressAny } from './page-coo.ts'
import { settle } from './horloge.ts'

// La reprise de l'auto à la relance de sa discussion. Invariant (validé par Mathis) : « À la relance de sa discussion,
// l'auto d'une mission ne repart sans clic que dans la discussion qui le portait, relancée sous son id par un nouveau
// processus, pour l'allumage que Mathis avait donné, au plus 24 h après la dernière activité de la mission, et
// seulement si rien d'autre ne l'a éteint depuis (coupure de Mathis ou du COO, mise de côté, clôture, archivage,
// reprise dans une autre discussion, quota, rapport prêt). Une lecture ou une écriture ratée le laisse éteint. Deux
// processus d'une même discussion ne le font jamais repartir tous les deux. La reprise d'une pause « plus rien ne
// peut avancer sans toi » dans le processus qui l'a posée garde sa règle d'aujourd'hui. »
//
// Chaque test est le monde d'une discussion relancée : le fichier des missions et la mémoire du mod (`$.store`) tels
// que l'ancien processus (`boot-P1`) les a laissés, puis le démarrage du mod de ce test, un nouveau processus.

const TOOL = 'mcp__flow-board__flow'
const PLUGIN = 'flow-board'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 140, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')

/** Le moteur sous le plugin (celui d'envoi-auto.test.ts) : fichier des missions, `$.store`, coordination, envois et notifications captés. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const disk: { board?: string; isUsed: boolean } = { isUsed: false }
  const ids = { now: 'sa' }
  const flags = { unreadable: false, unwritable: false, storeRefuses: false, proofUnreadable: false, coordUnreadable: false, traceUnreadable: false, traceRefuses: false, notifyThrows: false, notifyNoSurface: false }
  // Le fichier de coordination du COO, quand le test en pose un (une coupure écrite pendant l'arrêt).
  const coord: { text?: string } = {}
  const isCoord = (path: string): boolean => path.includes('/flow-board/coordination/') && !path.includes('feuille-de-route') && !path.includes('.nuit') && !path.includes('.numeros') && !path.includes('.cartes')
  const prompts: { text: string; origin: any }[] = []
  const runs: { command: string; args: string }[] = []
  const notices: string[] = []
  const stored = (): Board | undefined => (disk.isUsed && disk.board !== undefined ? JSON.parse(disk.board) : (mem['board:'] as Board | undefined))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: ids.now }))
  on('store.get', (_$: unknown, e: { key: string }) => {
    if (flags.unreadable && e.key === 'board:') throw new Error('EIO')
    if (flags.proofUnreadable && e.key.startsWith('auto-confirm:')) throw new Error('EIO')
    if (flags.traceUnreadable && e.key.startsWith('auto-resume:')) throw new Error('EIO')
    if (flags.coordUnreadable && e.key.startsWith('coo-coordination:')) return { value: 'coupé' }
    if (e.key.startsWith('coo-coordination:') && coord.text !== undefined) return { value: JSON.parse(coord.text) }
    return { value: mem[e.key] }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (flags.storeRefuses && e.key.startsWith('auto-confirm:')) throw new Error('EACCES')
    if (flags.unwritable && e.key === 'board:') throw new Error('EROFS')
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    if (flags.storeRefuses && e.key.startsWith('auto-confirm:')) throw new Error('EACCES')
    if (flags.traceRefuses && e.key.startsWith('auto-resume:')) throw new Error('EACCES')
    delete mem[e.key]
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isBoardFile(e.path) ? disk.board !== undefined : ((flags.coordUnreadable || coord.text !== undefined) && isCoord(e.path)) || e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      if (flags.unreadable || disk.board === undefined) throw new Error(`EIO ${e.path}`)
      return { value: disk.board } as any
    }
    if (flags.coordUnreadable && isCoord(e.path)) return { value: '{"v":1,"ro' } as any
    if (coord.text !== undefined && isCoord(e.path)) return { value: coord.text } as any
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      if (flags.unwritable) throw new Error(`EROFS ${e.path}`)
      disk.board = e.text
    } else if (coord.text !== undefined && isCoord(e.path)) coord.text = e.text
    else files[e.path] = e.text
    return { value: undefined } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: ids.now }))
  on('command.list', () => ({ value: [] }))
  on('command.run', (_$: unknown, e: { command: string; args: string }) => {
    runs.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('prompt.fill', () => ({ isFilled: true }))
  on('prompt.submit', (_$: unknown, e: { text: string; origin?: any }) => {
    prompts.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  on('prompt.suggest', () => ({ isShown: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.notify', (_$: unknown, e: { text: string }) => {
    if (flags.notifyThrows) throw new Error('pas de surface')
    // Le vrai moteur sans surface : la notification ne part pas, sans lever.
    if (flags.notifyNoSurface) return { value: { isSent: false, reason: 'no-surface' } }
    notices.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('classic.StopFailure', () => ({}))
  on('classic.SessionStart', () => ({}))
  return { mem, disk, ids, flags, runs, notices, stored, prompts, files, coord }
}
type World = ReturnType<typeof world>

const T0 = 300_000_000
const MIN = 60_000
const HOUR = 60 * MIN

/** Le fichier des missions et la mémoire du mod (`$.store`), tels que l'ancien processus les a laissés. */
const seed = (w: World, value: Board) => {
  w.mem['board:'] = JSON.parse(JSON.stringify(value))
  w.disk.board = JSON.stringify(value)
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
const bandText = async ($: any): Promise<string> => {
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  const texts = (await findAllAny(band, { type: 'Text' })).map((t: any) => String(t.text ?? '')).join(' | ')
  await band.unmount()
  return texts
}
const turnEnd = async ($: any, clock: { advance: (ms: number) => Promise<void> }, turnId = 't1') => {
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId, reason: 'answer' })
  await settle(clock, 1)
}
const autoOf = (w: World) => w.stored()?.runs[0]?.auto
const logOf = (w: World): string[] => (w.stored()?.runs[0]?.log ?? []).map(l => l.text)

/**
 * La mission de la discussion « sa », prise par l'ancien processus `boot-P1` à T0, auto allumé par un clic de « sa »
 * à T0 + 1 s (la date du clic gardée dans `$.store`, au nom de « sa » et de `boot-P1`), sa phase Spec finie ou non.
 */
const litByP1 = (o: { isDone?: boolean } = {}): { board: Board; id: string; onAt: number } => {
  const run: Run = { ...newRun('to-spec', T0, 'Boutique'), owner: 'sa', bornIn: 'sa', claim: { boot: 'boot-P1', at: T0 } }
  const base: Board = { ...emptyBoard('', 'projet'), session: 'sa', boot: 'boot-P1', deleted: [], runs: [run], activeId: run.id }
  const done = o.isDone ? applyReport(base, { complete: true } as any, T0 + 500).board : base
  const board = switchOnAuto(done, 'sa', T0 + 1000)!.board
  return { board, id: run.id, onAt: board.runs[0]!.auto!.onAt! }
}
const proofOf = (w: World, id: string, onAt: number, by = 'sa', boot = 'boot-P1') => {
  w.mem[`auto-confirm:${id}`] = { by, onAt, boot }
}
/** Le fichier des missions laissé par une fin propre de la discussion : la pause « discussion fermée » écrite. */
const endedByP1 = (board: Board, at: number): Board => parkActive(board, at)!.board

// ─── Le verdict, fonction pure ───────────────────────────────────────────

test('le verdict : reprise due pour un nouveau processus, allumé ou en pause « discussion fermée » par cette discussion, à 24 h juste ; pas de reprise sinon', () => {
  const { board, id, onAt } = litByP1()
  const at = T0 + HOUR
  expect(relaunchVerdict(board, at, 'sa', 'boot-P2')).toEqual({ kind: 'due', run: id, onAt, claim: { boot: 'boot-P2', at }, wasOn: true })
  const ended = endedByP1(board, T0 + 2000)
  expect(relaunchVerdict(ended, at, 'sa', 'boot-P2')).toMatchObject({ kind: 'due', wasOn: false })
  // 24 h juste après la dernière activité : la reprise vaut ; une milliseconde de plus, refus définitif.
  const last = ended.runs[0]!.updatedAt
  expect(relaunchVerdict(ended, last + RELAUNCH_WINDOW_MS, 'sa', 'boot-P2').kind).toBe('due')
  expect(relaunchVerdict(ended, last + RELAUNCH_WINDOW_MS + 1, 'sa', 'boot-P2')).toEqual({ kind: 'none', expired: { run: id, onAt }, wasOn: false })
  // Le même processus revenu à sa discussion, ou un processus sans id : aucun verdict.
  expect(relaunchVerdict(ended, at, 'sa', 'boot-P1')).toEqual({ kind: 'none' })
  expect(relaunchVerdict(ended, at, 'sa', '')).toEqual({ kind: 'none' })
  // Une autre discussion ; « allumé par » une autre discussion ; date d'activité absente : pas de reprise.
  expect(relaunchVerdict(ended, at, 'sb', 'boot-P2')).toEqual({ kind: 'none' })
  const otherBy: Board = { ...ended, runs: ended.runs.map(r => ({ ...r, auto: { ...r.auto!, onBy: 'sb' } })) }
  expect(relaunchVerdict(otherBy, at, 'sa', 'boot-P2')).toEqual({ kind: 'none' })
  const noDate = { ...ended, runs: ended.runs.map(r => ({ ...r, updatedAt: 'hier' as unknown as number })) }
  expect(relaunchVerdict(noDate, at, 'sa', 'boot-P2')).toEqual({ kind: 'none' })
  // Une date d'activité future : ramenée à maintenant, la reprise vaut.
  const ahead = { ...ended, runs: ended.runs.map(r => ({ ...r, updatedAt: at + 10 * HOUR })) }
  expect(relaunchVerdict(ahead, at, 'sa', 'boot-P2').kind).toBe('due')
})

test('le verdict : une pause d’une autre raison ne reprend pas, un cas par raison ; un état abîmé non plus', () => {
  const { board } = litByP1()
  const reasons = [AUTO_STOPS.click, AUTO_STOPS.coo, AUTO_STOPS.quota, AUTO_STOPS.report, AUTO_STOPS.limit, AUTO_STOPS.unreadable, AUTO_STOPS.unwritten, AUTO_STOPS.unbriefed]
  for (const why of reasons) {
    const off: Board = { ...board, runs: board.runs.map(r => ({ ...r, auto: { ...r.auto!, offAt: T0 + 2000, offWhy: why } })) }
    expect([why, relaunchVerdict(off, T0 + HOUR, 'sa', 'boot-P2').kind]).toEqual([why, 'none'])
  }
  const damaged: Board = { ...board, runs: board.runs.map(r => ({ ...r, auto: { onAt: 'x', onBy: 'sa' } as any })) }
  expect(relaunchVerdict(damaged, T0 + HOUR, 'sa', 'boot-P2').kind).toBe('none')
})

test('la pause du verdict : la prise de ce chargement inchangée, la même pause ; une prise explicite ensuite la fait oublier', () => {
  const { board, id } = litByP1()
  const at = T0 + HOUR
  const v = relaunchVerdict(board, at, 'sa', 'boot-P2')
  if (v.kind !== 'due') throw new Error('due attendu')
  const loaded = detachOnLoad(board, at, 'sa', 'boot-P2')
  expect(relaunchStillDue(loaded, 'sa', v)).toBe(true)
  expect(relaunchStillDue(loaded, 'sb', v)).toBe(false)
  // Mise de côté, puis reprise explicite : la prise change, la pause n'est plus celle du verdict, et la date du clic s'oublie.
  const aside = setAsideActive(loaded, at + 1)!.board
  expect(relaunchStillDue(aside, 'sa', v)).toBe(false)
  const ended = endedByP1(board, T0 + 2000)
  const loadedEnded = detachOnLoad(ended, at, 'sa', 'boot-P2')
  const away = openRun(loadedEnded, { title: 'Autre' }, at + 1).board
  const back = resumeRun(away, id, at + 2)!.board
  expect(relaunchStillDue(back, 'sa', v)).toBe(false)
  expect(retakenPaused(away, back, 'boot-P2')).toEqual([id])
  // Un auto allumé (mis en pause par l'ouverture d'une autre mission, puis revenu) n'est pas concerné.
  const litAgain = switchOnAuto(loadedEnded, 'sa', at + 1)!.board
  expect(retakenPaused(openRun(litAgain, { title: 'Autre' }, at + 2).board, resumeRun(openRun(litAgain, { title: 'Autre' }, at + 2).board, id, at + 3)!.board, 'boot-P2')).toEqual([])
})

test('deux processus d’une même discussion relancés à la même milliseconde : après fusion, un seul tient la prise et voit son auto repartir, dans les deux ordres', () => {
  const { board, id } = litByP1()
  const ended = endedByP1(board, T0 + 2000)
  const at = T0 + HOUR
  // P2 et P3 chargent le même fichier à la même milliseconde : chacun a son verdict « due », à sa prise.
  const v2 = relaunchVerdict(ended, at, 'sa', 'boot-P2')
  const v3 = relaunchVerdict(ended, at, 'sa', 'boot-P3')
  if (v2.kind !== 'due' || v3.kind !== 'due') throw new Error('due attendu')
  const p2 = detachOnLoad(ended, at, 'sa', 'boot-P2')
  const p3 = detachOnLoad(ended, at, 'sa', 'boot-P3')
  // Chacun relit la copie de l'autre : la même prise partout, celle de P3 (le plus grand `boot`).
  const seenByP2 = mergeBoards(p2, p3)
  const seenByP3 = mergeBoards(p3, p2)
  expect(seenByP2.runs.find(r => r.id === id)?.claim).toEqual({ boot: 'boot-P3', at })
  expect(seenByP3.runs.find(r => r.id === id)?.claim).toEqual({ boot: 'boot-P3', at })
  // Seul P3 voit sa reprise toujours due ; P2 laisse la mission et n'allume rien.
  expect(relaunchStillDue(seenByP3, 'sa', v3)).toBe(true)
  expect(relaunchStillDue(seenByP2, 'sa', v2)).toBe(false)
  expect(seenByP2.activeId).toBeNull()
})

// ─── Les formes, dans le monde d'une discussion relancée ─────────────────

/** Relance : le mod de ce test démarre (un nouveau processus) sur le fichier et la mémoire posés, puis 3 s passent. */
const relaunch = async ($: any, on: any, w: World, board: Board, now: number) => {
  const clock = mock.clock(on, { now })
  seed(w, board)
  await start($)
  await settle(clock, 3)
  return clock
}

test('tuée en auto (aucune fin écrite), puis relancée : l’auto repart sans clic, une fois, et le dit', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  const auto = autoOf(w)!
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  expect(auto).toMatchObject({ onBy: 'sa', onWhy: 'resumed', offWhy: 'discussion fermée' })
  expect(auto.onAt!).toBeGreaterThan(onAt)
  // La date neuve gardée, liée à ce processus.
  const proof = w.mem[`auto-confirm:${id}`] as { by: string; onAt: number; boot: string }
  expect(proof).toMatchObject({ by: 'sa', onAt: auto.onAt })
  expect(proof.boot).not.toBe('boot-P1')
  expect(logOf(w)).toEqual(expect.arrayContaining(['Mode auto éteint : discussion arrêtée', 'Mode auto repris : discussion relancée']))
  expect(await bandText($)).toMatch(/⚡\sAuto\s·\srepris\s:\sdiscussion\srelancée/)
  // Claude reçoit la consigne entière du mode auto, au repos.
  expect(w.prompts.some(p => p.text.startsWith('⚡ flow-board: the auto mode instructions'))).toBe(true)
  // Une fois : rien ne se rallume ensuite.
  await settle(clock, 12)
  expect(autoOf(w)!.onAt).toBe(auto.onAt)
})

test('arrêtée proprement en auto (la pause écrite), puis relancée : l’auto repart sans clic', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  expect(autoOf(w)).toMatchObject({ onBy: 'sa', onWhy: 'resumed' })
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('relancée par un message qui ouvre un tour aussitôt : l’auto repart pendant le tour, la réponse de l’outil donne la consigne, et la suite part à la fin du tour', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1({ isDone: true })
  proofOf(w, id, onAt)
  const clock = mock.clock(on, { now: T0 + HOUR })
  seed(w, endedByP1(board, T0 + 2000))
  await start($)
  await $.turn.start({ turnId: 'msg' } as any)
  const call = $.tool.call({ tool: TOOL, note: 'Message du worker lu' } as any)
  await settle(clock, 3)
  const r = String((await call).result)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  expect(r).toMatch(/Auto mode is ON/)
  // Rien n'est envoyé pendant le tour ; la suite part à sa fin.
  expect(w.runs).toEqual([])
  await turnEnd($, clock, 'msg')
  await settle(clock, 2)
  expect(w.runs.map(x => x.command)).toEqual(['mattpocock-skills:to-tickets'])
})

/** Relancée avec cette date du clic dans la mémoire du mod (`undefined` : aucune) : l'auto reste éteint. */
const staysOff = async ($: any, on: any, proof: unknown, board?: Board) => {
  const w = world(on)
  const lit = litByP1()
  if (proof !== undefined) w.mem[`auto-confirm:${lit.id}`] = typeof proof === 'function' ? proof(lit.onAt) : proof
  const clock = await relaunch($, on, w, board ?? lit.board, T0 + HOUR)
  await settle(clock, 6)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(autoOf(w)).toMatchObject({ offWhy: 'discussion fermée' })
  return { w, ...lit }
}

test('sans date du clic gardée, un fichier seul ne rallume rien', { timeoutMs: 30000 }, async ($, on) => {
  await staysOff($, on, undefined)
})
test('une date du clic d’une autre discussion ne sert pas ici, et n’est pas effacée', { timeoutMs: 30000 }, async ($, on) => {
  const { w, id } = await staysOff($, on, (onAt: number) => ({ by: 'sb', onAt, boot: 'boot-P1' }))
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ by: 'sb' })
})
test('une date du clic d’un autre allumage ne rallume rien', { timeoutMs: 30000 }, async ($, on) => {
  await staysOff($, on, (onAt: number) => ({ by: 'sa', onAt: onAt + 5, boot: 'boot-P1' }))
})
test('une date du clic hors forme ne rallume rien : pas un objet, date illisible, id vide, id trop long', { timeoutMs: 30000 }, async ($, on) => {
  await staysOff($, on, 'sa')
})
test('une date du clic hors forme ne rallume rien : date illisible', { timeoutMs: 30000 }, async ($, on) => {
  await staysOff($, on, { by: 'sa', onAt: 'hier', boot: 'boot-P1' })
})
test('une date du clic hors forme ne rallume rien : id vide', { timeoutMs: 30000 }, async ($, on) => {
  await staysOff($, on, (onAt: number) => ({ by: '', onAt, boot: 'boot-P1' }))
})
test('une date du clic hors forme ne rallume rien : id trop long', { timeoutMs: 30000 }, async ($, on) => {
  await staysOff($, on, (onAt: number) => ({ by: 'x'.repeat(201), onAt, boot: 'boot-P1' }))
})

test('« allumé par » une autre discussion dans le fichier : pas de reprise', { timeoutMs: 30000 }, async ($, on) => {
  const { board } = litByP1()
  const other: Board = { ...board, runs: board.runs.map(r => ({ ...r, auto: { ...r.auto!, onBy: 'sb' } })) }
  const w = world(on)
  w.mem[`auto-confirm:${board.runs[0]!.id}`] = { by: 'sa', onAt: board.runs[0]!.auto!.onAt, boot: 'boot-P1' }
  await relaunch($, on, w, other, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
})

test('fichier des missions illisible au chargement : pas de reprise, même relu ensuite', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  w.flags.unreadable = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  w.flags.unreadable = false
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
})

test('passé 24 h, la reprise est refusée pour de bon : la date du clic s’efface, et le reste aux relances suivantes', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const ended = endedByP1(board, T0 + 2000)
  const clock = await relaunch($, on, w, ended, ended.runs[0]!.updatedAt + RELAUNCH_WINDOW_MS + 1)
  await settle(clock, 6)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
})

test('à 24 h juste, la reprise vaut', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const ended = endedByP1(board, T0 + 2000)
  await relaunch($, on, w, ended, ended.runs[0]!.updatedAt + RELAUNCH_WINDOW_MS)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('une date d’activité future est ramenée à la relance : la reprise vaut, la date du clic à la même date restant exigée', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const ended = endedByP1(board, T0 + 2000)
  const ahead: Board = { ...ended, runs: ended.runs.map(r => ({ ...r, updatedAt: T0 + 30 * HOUR })) }
  await relaunch($, on, w, ahead, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('une lecture ratée de la date gardée ne rallume rien ce coup-ci ; la tentative suivante réessaie', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  w.flags.proofUnreadable = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  await settle(clock, 6)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  w.flags.proofUnreadable = false
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('coordination illisible : la reprise attend, puis reprend une fois relue', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  w.flags.coordUnreadable = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  await settle(clock, 6)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  w.flags.coordUnreadable = false
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('un allumage raté (la date neuve ne se garde pas) laisse l’auto éteint et ne se retente pas', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  w.flags.storeRefuses = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  await settle(clock, 6)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  // La preuve est consommée : une fois `$.store` de nouveau d'accord, l'effacement se refait, et rien ne se rallume.
  w.flags.storeRefuses = false
  await settle(clock, 12)
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
})

test('un allumage raté (le fichier des missions refuse l’écriture) laisse l’auto éteint, « écriture ratée », et ne se retente pas', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = mock.clock(on, { now: T0 + HOUR })
  seed(w, endedByP1(board, T0 + 2000))
  await start($)
  // Le chargement écrit sa prise ; puis le fichier refuse toute écriture.
  await settle(clock, 1)
  w.flags.unwritable = true
  await settle(clock, 6)
  w.flags.unwritable = false
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
  // La pause se dit une fois, sous une seule raison.
  expect(w.notices.filter(t => t.includes('auto en pause')).length).toBe(1)
})

test('une coupure demandée pendant l’arrêt l’emporte : la pause change de raison, l’auto ne repart pas (processus tué)', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  // La coupure du COO écrite pendant l'arrêt, dans le fichier de coordination.
  w.coord.text = JSON.stringify({ v: 1, root: '', entries: [{ id: 'ccut0001', kind: 'cutAuto', run: id, at: T0 + 10 * MIN, by: 'coo' }] })
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(autoOf(w)).toMatchObject({ offWhy: 'coupé par le COO' })
})

test('une coupure demandée pendant l’arrêt l’emporte aussi après une fin propre', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  w.coord.text = JSON.stringify({ v: 1, root: '', entries: [{ id: 'ccut0001', kind: 'cutAuto', run: id, at: T0 + 10 * MIN, by: 'click' }] })
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(autoOf(w)).toMatchObject({ offWhy: 'coupé par toi' })
})

test('deux processus d’une même discussion : seul celui qui tient la prise reprend ; l’autre laisse la mission', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = mock.clock(on, { now: T0 + HOUR })
  seed(w, endedByP1(board, T0 + 2000))
  await start($)
  // Pendant l'attente de la prise relue, un autre processus de la même discussion (P3) charge le fichier et le prend.
  await settle(clock, 1)
  const taken = detachOnLoad(w.stored()!, T0 + HOUR + 1000, 'sa', 'boot-P3')
  seed(w, taken)
  await settle(clock, 12)
  // Ce processus laisse la mission (sa relecture voit la prise de P3) et n'allume rien.
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(w.stored()!.runs[0]!.claim).toMatchObject({ boot: 'boot-P3' })
})

test('arrêtée avant d’avoir repris : rien n’est consommé, la relance suivante reprend', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  // P2 a chargé (sa prise, la pause « discussion fermée »), puis s'est arrêté avant toute tentative réussie.
  const byP2 = detachOnLoad(endedByP1(board, T0 + 2000), T0 + 30 * MIN, 'sa', 'boot-P2')
  await relaunch($, on, w, byP2, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('une mission reprise dans une autre discussion puis revenue ne repart pas à la relance suivante', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const ended = endedByP1(board, T0 + 2000)
  // « ↻ Reprendre ici » dans « sb », qui en ouvre une autre (la mission passe en pause), puis « sa » la reprend.
  const inB = resumeRun({ ...ended, session: 'sb', boot: 'boot-B', activeId: null }, id, T0 + 3000)!.board
  const shelvedByB = openRun(inB, { title: 'Autre' }, T0 + 4000).board
  const backInA = resumeRun({ ...shelvedByB, session: 'sa', boot: 'boot-P2', activeId: null }, id, T0 + 5000)!.board
  // La reprise explicite dans « sa » (ici simulée sur le fichier) a oublié la date du clic.
  expect(retakenPaused({ ...shelvedByB, session: 'sa' }, backInA, 'boot-P2')).toEqual([id])
  delete w.mem[`auto-confirm:${id}`]
  await relaunch($, on, w, parkActive(backInA, T0 + 6000)!.board, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!.id === id ? w.stored()!.runs[0]! : w.stored()!.runs.find(r => r.id === id)!)).toBe(false)
})

test('une mission mise de côté pendant l’arrêt ne reprend pas', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  await relaunch($, on, w, setAsideActive({ ...endedByP1(board, T0 + 2000), activeId: id }, T0 + 3000)!.board, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs.find(r => r.id === id)!)).toBe(false)
})

test('les traces de retrait d’avant la relance ne retirent aucune marque après la reprise', { timeoutMs: 30000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  // Une trace « répondue » gardée par l'ancien processus.
  // Une trace « répondue » gardée par l'ancien processus, plus récente que la question.
  w.mem[`auto-traces:${id}`] = { by: 'sa', boot: 'boot-P1', resent: [], answered: [{ id: 'q1', at: T0 + 3000 }] }
  const withQuestion: Board = { ...board, runs: board.runs.map(r => ({ ...r, waiting: [{ id: 'q1', blocks: { kind: 'phase', id: 'to-tickets' }, text: 'Question ?', at: T0 + 2500 }] })) }
  const clock = await relaunch($, on, w, withQuestion, T0 + HOUR)
  expect(autoOf(w)).toMatchObject({ onWhy: 'resumed' })
  // Des relectures après la reprise : la question reste ouverte.
  await settle(clock, 12)
  expect(w.stored()!.runs[0]!.waiting?.map(q => q.id)).toEqual(['q1'])
})

test('après /reload-plugins, rien ne s’éteint et aucun verdict nouveau ; après /clear, rien ne s’allume au nom du nouvel id', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  const lit = autoOf(w)!
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  await start($)
  await settle(clock, 8)
  expect(autoOf(w)!.onAt).toBe(lit.onAt)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  await $.session.end({ reason: 'clear' } as any)
  w.ids.now = 'sa-apres-clear'
  await settle(clock, 12)
  expect(autoOf(w)!.onBy).toBe('sa')
})

test('une coupure vue après la reprise coupe encore : fin propre (datée pendant l’arrêt), processus tué (datée après le chargement)', { timeoutMs: 60000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  // Fin propre : la pause datée de la fin (T0 + 2 s) ; une coupure datée pendant l'arrêt, écrite seulement maintenant.
  w.coord.text = JSON.stringify({ v: 1, root: '', entries: [{ id: 'ccut0001', kind: 'cutAuto', run: id, at: T0 + 10 * MIN, by: 'coo' }] })
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(autoOf(w)).toMatchObject({ offWhy: 'coupé par le COO' })
})

test('processus tué, puis relancé : une coupure datée après le chargement et vue après la reprise coupe encore', { timeoutMs: 60000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  // Toute coupure écrite pendant l'arrêt est dans le fichier relu juste avant l'allumage, appliquée d'abord (test plus
  // haut) ; une coupure écrite ensuite est datée après le chargement.
  w.coord.text = JSON.stringify({ v: 1, root: '', entries: [{ id: 'ccut0002', kind: 'cutAuto', run: id, at: T0 + HOUR + 500, by: 'click' }] })
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
})

test('la fin de la discussion garde la date du clic (preuve de la relance) et oublie les traces de retrait ; une mise de côté efface la date', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  const lit = autoOf(w)!
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  const proof = w.mem[`auto-confirm:${id}`] as { boot: string }
  // Une trace de retrait gardée ici.
  w.mem[`auto-traces:${id}`] = { by: 'sa', boot: proof.boot, resent: [], answered: [] }
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  await settle(clock, 1)
  expect(autoOf(w)).toMatchObject({ offWhy: 'discussion fermée' })
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ by: 'sa', onAt: lit.onAt })
  expect(w.mem[`auto-traces:${id}`]).toBeUndefined()
})

test('une mise de côté de l’auto allumé efface la date du clic, comme avant', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(pane, { key: 'set-aside' })
  await pane.unmount()
  await settle(clock, 2)
  expect(autoOf(w)).toMatchObject({ offWhy: 'parcours mis de côté' })
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
})

test('un /clear pendant la tentative (reprise due) : rien ne s’allume, ni sous l’ancien id ni sous le nouveau', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = mock.clock(on, { now: T0 + HOUR })
  seed(w, endedByP1(board, T0 + 2000))
  await start($)
  // La tentative attend sa prise relue (1,5 s) : le /clear arrive pendant ce temps.
  await settle(clock, 1)
  await $.session.end({ reason: 'clear' } as any)
  w.ids.now = 'sa-apres-clear'
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(autoOf(w)!.onBy).toBe('sa')
  // La tentative finie après le /clear ne dit rien au nom de l'ancienne discussion.
  expect(w.notices.filter(t => t.includes('auto en pause'))).toEqual([])
})

test('une reprise explicite dans le mod d’une mission en pause « discussion arrêtée » oublie la date du clic', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  // Mise en pause (une autre mission ouverte ailleurs puis revenue) : elle n'est active nulle part au chargement.
  const ended = endedByP1(board, T0 + 2000)
  const paused: Board = { ...ended, runs: ended.runs.map(r => ({ ...r, status: 'paused' as const })) }
  const clock = await relaunch($, on, w, paused, T0 + HOUR)
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ onAt })
  await $.tool.call({ tool: TOOL, resume: id } as any)
  await settle(clock, 6)
  expect(w.stored()!.runs[0]!.status).toBe('active')
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
})

test('le même processus revenu à sa discussion après sa fin ne reprend pas (aucun verdict) ; la tentative tournait bien avant', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  await settle(clock, 1)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  // Le même processus revient (le mod redémarre sans nouveau processus) : la pause reste, deux clics.
  await start($)
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(autoOf(w)).toMatchObject({ offWhy: 'discussion fermée' })
})

test('un verdict encore dû survit à /reload-plugins : relu de l’état du mod, il reprend une fois la coordination lisible', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  w.flags.coordUnreadable = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  await start($)
  await settle(clock, 6)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  w.flags.coordUnreadable = false
  await settle(clock, 10)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('après un /clear, la fin du processus oublie la date du clic de l’id qu’il n’a plus : une relance de cet ancien id ne reprendrait pas', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ by: 'sa' })
  await $.session.end({ reason: 'clear' } as any)
  w.ids.now = 'sa-apres-clear'
  await settle(clock, 2)
  // Le /clear seul la garde (le même processus peut revenir à cet id) ; la fin du processus sous le nouvel id l'oublie.
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ by: 'sa' })
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  await settle(clock, 1)
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
})

test('un effacement raté de la date du clic (reprise explicite) se note et se refait à la tentative suivante', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const ended = endedByP1(board, T0 + 2000)
  const paused: Board = { ...ended, runs: ended.runs.map(r => ({ ...r, status: 'paused' as const })) }
  const clock = await relaunch($, on, w, paused, T0 + HOUR)
  w.flags.storeRefuses = true
  await $.tool.call({ tool: TOOL, resume: id } as any)
  await settle(clock, 6)
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ onAt })
  w.flags.storeRefuses = false
  await settle(clock, 8)
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
})

test('un effacement raté à la fin d’un processus après /clear se note et se refait ensuite, sous l’ancien id', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  await $.session.end({ reason: 'clear' } as any)
  w.ids.now = 'sa-apres-clear'
  w.flags.storeRefuses = true
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  await settle(clock, 6)
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ by: 'sa' })
  w.flags.storeRefuses = false
  await settle(clock, 8)
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
})

// ─── La pause « plus rien ne peut avancer sans toi », reprise après une relance ──
//
// La preuve est alors la trace de reprise gardée pour cette pause (`auto-resume:<mission>`), au nom de cette discussion
// et à la date « allumé à » du fichier ; son processus et son « éteint à » ne sont pas comparés. Elle ne fait repartir
// l'auto que quand plus aucune question n'est ouverte.

const QUESTION = { id: 'q1', blocks: { kind: 'phase' as const, id: 'to-spec' }, text: 'Question ?', at: T0 + 1500 }

/** La mission de `litByP1`, mise en pause « plus rien ne peut avancer sans toi » à T0 + 2 s, la question q1 ouverte ou non. */
const stuckByP1 = (o: { isOpen?: boolean } = {}) => {
  const lit = litByP1()
  const board: Board = {
    ...lit.board,
    runs: lit.board.runs.map(r => ({ ...r, auto: { ...r.auto!, offAt: T0 + 2000, offWhy: AUTO_STOPS.stuck }, ...(o.isOpen === false ? {} : { waiting: [QUESTION] }) })),
  }
  return { ...lit, board }
}
const traceOf = (w: World, id: string, onAt: number, o: { by?: string; boot?: string } = {}) => {
  w.mem[`auto-resume:${id}`] = { by: o.by ?? 'sa', boot: o.boot ?? 'boot-P1', onAt, offAt: T0 + 2000, questions: ['q1'] }
}

test('le verdict : une pause « plus rien ne peut avancer sans toi » allumée par cette discussion est une reprise due, comme « discussion fermée »', () => {
  const { board, id, onAt } = stuckByP1()
  expect(relaunchVerdict(board, T0 + HOUR, 'sa', 'boot-P2')).toMatchObject({ kind: 'due', run: id, onAt, wasOn: false })
  // Après le chargement, la pause porte la raison enregistrée « discussion fermée » (la trace la reconnaît, pas sa raison).
  expect(detachOnLoad(board, T0 + HOUR, 'sa', 'boot-P2').runs[0]!.auto).toMatchObject({ offWhy: 'discussion fermée' })
})

test('relancée avec des questions ouvertes (processus tué) : elle ne repart qu’à la dernière réponse, et dit « repris : discussion relancée »', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1()
  traceOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  // Rien n'est consommé tant que la question est ouverte.
  expect(w.mem[`auto-resume:${id}`]).toMatchObject({ by: 'sa', onAt })
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', answered: true }] } as any)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  expect(autoOf(w)).toMatchObject({ onWhy: 'resumed' })
  expect(w.mem[`auto-resume:${id}`]).toBeUndefined()
  expect(await bandText($)).toMatch(/⚡\sAuto\s·\srepris\s:\sdiscussion\srelancée/)
})

test('relancée après les réponses (fin propre) : elle repart dès le chargement', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1({ isOpen: false })
  traceOf(w, id, onAt)
  await relaunch($, on, w, endedByP1(board, T0 + 3000), T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('la date du clic et la trace toutes deux à la bonne date, une question ouverte : la règle de la trace vaut, pas d’allumage', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1()
  traceOf(w, id, onAt)
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  // Le contrôle : la question répondue, l'auto repart.
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', answered: true }] } as any)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('une trace d’une autre discussion ne fait rien repartir', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1({ isOpen: false })
  expect(relaunchVerdict(board, T0 + HOUR, 'sa', 'boot-P2')).toMatchObject({ kind: 'due', run: id })
  w.mem[`auto-resume:${id}`] = { by: 'sb', boot: 'boot-P1', onAt, offAt: T0 + 2000, questions: ['q1'] }
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(w.mem[`auto-resume:${id}`]).toMatchObject({ by: 'sb' })
})


test('une pause « plus rien ne peut avancer sans toi » lue telle quelle (processus tué), sans trace : la date du clic seule ne la fait pas repartir', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1({ isOpen: false })
  // Le contrôle : la reprise est due, et marquée « plus rien ne peut avancer sans toi » (sa trace seule la prouve).
  expect(relaunchVerdict(board, T0 + HOUR, 'sa', 'boot-P2')).toMatchObject({ kind: 'due', run: id, stuck: true })
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
})

test('une trace hors forme, à la bonne date et au nom de cette discussion, ne fait rien repartir (en forme : « relancée après les réponses »)', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1({ isOpen: false })
  const ended = endedByP1(board, T0 + 3000)
  expect(relaunchVerdict(ended, T0 + HOUR, 'sa', 'boot-P2')).toMatchObject({ kind: 'due', run: id })
  // Des questions vides : hors forme (`soundStuckResume`), tout le reste juste.
  w.mem[`auto-resume:${id}`] = { by: 'sa', boot: 'boot-P1', onAt, offAt: T0 + 2000, questions: [] }
  const clock = await relaunch($, on, w, ended, T0 + HOUR)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
})

test('une trace illisible fait réessayer, jamais la date du clic à sa place ; relisible, la reprise part', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1({ isOpen: false })
  traceOf(w, id, onAt)
  proofOf(w, id, onAt)
  w.flags.traceUnreadable = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 3000), T0 + HOUR)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  w.flags.traceUnreadable = false
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('un effacement refusé de la trace avant l’allumage n’allume rien ; accepté, la reprise part', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1({ isOpen: false })
  traceOf(w, id, onAt)
  w.flags.traceRefuses = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 3000), T0 + HOUR)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(w.mem[`auto-resume:${id}`]).toMatchObject({ by: 'sa', onAt })
  w.flags.traceRefuses = false
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  expect(w.mem[`auto-resume:${id}`]).toBeUndefined()
})

test('une pause « plus rien ne peut avancer sans toi » reprise explicitement ici, d’un autre processus, est prise de nouveau (`retakenPaused`)', () => {
  const { board, id } = stuckByP1()
  // « sb » l'a reprise (la pause reste « plus rien ne peut avancer sans toi » dans le fichier), puis « sa » la reprend
  // dans un nouveau processus : la trace de P1 s'y oublie (`pruneConfirms`).
  const inB = resumeRun({ ...board, session: 'sb', boot: 'boot-B', activeId: null }, id, T0 + 3000)!.board
  const backInA = resumeRun({ ...inB, session: 'sa', boot: 'boot-P3', activeId: null }, id, T0 + 5000)!.board
  expect(backInA.runs.find(r => r.id === id)!.auto).toMatchObject({ offWhy: AUTO_STOPS.stuck })
  expect(retakenPaused({ ...inB, session: 'sa' }, backInA, 'boot-P3')).toEqual([id])
})

test('une pause « plus rien ne peut avancer sans toi » reprise par « ↻ Reprendre ici » dans un nouveau processus : la date du clic et la trace d’un autre processus s’oublient', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1()
  // « sb » tient la mission ; la pause reste « plus rien ne peut avancer sans toi » dans le fichier.
  const inB = resumeRun({ ...board, session: 'sb', boot: 'boot-B', activeId: null }, id, T0 + 3000)!.board
  traceOf(w, id, onAt)
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, inB, T0 + HOUR)
  // Le contrôle : sans reprise explicite, rien n'est effacé.
  expect(w.mem[`auto-resume:${id}`]).toMatchObject({ by: 'sa', boot: 'boot-P1' })
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ by: 'sa', onAt })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(pane, { key: `resume-${id}` })
  await pane.unmount()
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(again, { key: `resume-confirm-${id}` })
  await again.unmount()
  await settle(clock, 3)
  const run = w.stored()!.runs.find(r => r.id === id)!
  expect(run).toMatchObject({ status: 'active', owner: 'sa' })
  expect(run.auto).toMatchObject({ offWhy: AUTO_STOPS.stuck })
  expect(w.mem[`auto-resume:${id}`]).toBeUndefined()
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
})

test('une pause « plus rien ne peut avancer sans toi » reprise par « ↻ Reprendre ici » dans un nouveau processus : sans trace, la date du clic s’oublie quand même', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1()
  // « sb » tient la mission ; la pause reste « plus rien ne peut avancer sans toi » dans le fichier.
  const inB = resumeRun({ ...board, session: 'sb', boot: 'boot-B', activeId: null }, id, T0 + 3000)!.board
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, inB, T0 + HOUR)
  // Le contrôle : sans reprise explicite, rien n'est effacé.
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ by: 'sa', onAt })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(pane, { key: `resume-${id}` })
  await pane.unmount()
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(again, { key: `resume-confirm-${id}` })
  await again.unmount()
  await settle(clock, 3)
  const run = w.stored()!.runs.find(r => r.id === id)!
  expect(run).toMatchObject({ status: 'active', owner: 'sa' })
  expect(run.auto).toMatchObject({ offWhy: AUTO_STOPS.stuck })
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
})

test('une pause « plus rien ne peut avancer sans toi » reprise explicitement dans le processus qui a posé sa trace : la trace reste (règle du processus vivant)', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id } = stuckByP1()
  const inB = resumeRun({ ...board, session: 'sb', boot: 'boot-B', activeId: null }, id, T0 + 3000)!.board
  const clock = await relaunch($, on, w, inB, T0 + HOUR)
  const take = async () => {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
    await pressAny(pane, { key: `resume-${id}` })
    await pane.unmount()
    const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
    await pressAny(again, { key: `resume-confirm-${id}` })
    await again.unmount()
    await settle(clock, 3)
  }
  // Une première reprise ici donne l'id de ce processus (sa prise).
  await take()
  const boot = w.stored()!.runs.find(r => r.id === id)!.claim!.boot
  // « sb » la reprend de nouveau ; la trace de la pause est maintenant celle de ce processus.
  const now = T0 + HOUR + 10_000
  seed(w, resumeRun({ ...w.stored()!, session: 'sb', boot: 'boot-B', activeId: null }, id, now)!.board)
  await settle(clock, 6)
  expect(w.stored()!.runs.find(r => r.id === id)).toMatchObject({ owner: 'sb' })
  const onAt = w.stored()!.runs.find(r => r.id === id)!.auto!.onAt!
  w.mem[`auto-resume:${id}`] = { by: 'sa', boot, onAt, offAt: T0 + 2000, questions: ['q1'] }
  await take()
  expect(w.stored()!.runs.find(r => r.id === id)).toMatchObject({ owner: 'sa' })
  expect(w.mem[`auto-resume:${id}`]).toMatchObject({ by: 'sa', boot })
})
test('une trace d’une autre date ne fait rien repartir', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1({ isOpen: false })
  expect(relaunchVerdict(board, T0 + HOUR, 'sa', 'boot-P2')).toMatchObject({ kind: 'due', run: id })
  traceOf(w, id, onAt + 7)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
})

test('passé 24 h, la trace s’efface : refus définitif', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1({ isOpen: false })
  traceOf(w, id, onAt)
  const ended = endedByP1(board, T0 + 3000)
  const clock = await relaunch($, on, w, ended, ended.runs[0]!.updatedAt + RELAUNCH_WINDOW_MS + 1)
  await settle(clock, 4)
  expect(w.mem[`auto-resume:${id}`]).toBeUndefined()
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
})

test('une coupure du COO pendant la pause empêche la reprise après la relance', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1({ isOpen: false })
  expect(relaunchVerdict(board, T0 + HOUR, 'sa', 'boot-P2')).toMatchObject({ kind: 'due', run: id })
  traceOf(w, id, onAt)
  w.coord.text = JSON.stringify({ v: 1, root: '', entries: [{ id: 'ccut0003', kind: 'cutAuto', run: id, at: T0 + 10 * MIN, by: 'coo' }] })
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(autoOf(w)).toMatchObject({ offWhy: 'coupé par le COO' })
})

test('une question encore ouverte après /reload-plugins : la reprise reste due, et part à la dernière réponse', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1()
  traceOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await start($)
  await settle(clock, 6)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', answered: true }] } as any)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
})

test('une lecture ratée du fichier des missions pendant la pause consomme la trace et la date du clic : plus de reprise', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1()
  traceOf(w, id, onAt)
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  w.flags.unreadable = true
  await settle(clock, 6)
  w.flags.unreadable = false
  expect(w.mem[`auto-resume:${id}`]).toBeUndefined()
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', answered: true }] } as any)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
})

// ─── La pause laissée par la relance, dite ────────────────────────────────
//
// Une relance qui laisse l'auto en pause le dit une fois par verdict, jamais pendant le chargement : la notification
// « Mission <titre> : auto en pause (discussion arrêtée) » et le signal « t'attend ». Rien quand l'auto repart, ni
// quand la mission n'attend que des réponses.

const PAUSE_SAID = 'Mission Boutique : auto en pause (discussion arrêtée)'
const saidCount = (w: World) => w.notices.filter(t => t === PAUSE_SAID).length

test('tuée en auto, sans date du clic : pas de reprise, la pause se dit une fois après le chargement, avec « t’attend »', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board } = litByP1()
  const clock = mock.clock(on, { now: T0 + HOUR })
  seed(w, board)
  await start($)
  // Pendant le chargement : rien.
  expect(saidCount(w)).toBe(0)
  await settle(clock, 8)
  expect(saidCount(w)).toBe(1)
  expect(w.stored()!.runs[0]!.waitsUser).toMatchObject({ kind: 'step' })
  await settle(clock, 12)
  expect(saidCount(w)).toBe(1)
  // /reload-plugins (un nouveau démarrage du mod, même processus) : pas une seconde fois.
  await start($)
  await settle(clock, 12)
  expect(saidCount(w)).toBe(1)
})

test('passé 24 h, avec la date du clic de cette discussion : la pause se dit', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const ended = endedByP1(board, T0 + 2000)
  const clock = await relaunch($, on, w, ended, ended.runs[0]!.updatedAt + RELAUNCH_WINDOW_MS + 1)
  await settle(clock, 8)
  expect(saidCount(w)).toBe(1)
})

test('passé 24 h, une pause « discussion arrêtée » sans preuve (déjà refusée à une relance d’avant) : rien ne se dit', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  const ended = endedByP1(board, T0 + 2000)
  const at = ended.runs[0]!.updatedAt + RELAUNCH_WINDOW_MS + 1
  // Le contrôle : le même verdict (refus définitif) que le test d'avant, qui la dit avec la date du clic.
  expect(relaunchVerdict(ended, at, 'sa', 'boot-P2')).toEqual({ kind: 'none', expired: { run: id, onAt }, wasOn: false })
  const clock = await relaunch($, on, w, ended, at)
  await settle(clock, 12)
  expect(saidCount(w)).toBe(0)
})

test('un allumage raté : la pause se dit', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  w.flags.storeRefuses = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(saidCount(w)).toBe(1)
})

test('une reprise due, la date du clic gardée, pas encore partie à la première relecture (coordination illisible) : dite ; repartie ensuite, « t’attend » s’efface et rien ne se redit', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  w.flags.coordUnreadable = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  await settle(clock, 8)
  expect(saidCount(w)).toBe(1)
  expect(w.stored()!.runs[0]!.waitsUser).toMatchObject({ kind: 'step' })
  w.flags.coordUnreadable = false
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  expect(w.stored()!.runs[0]!.waitsUser).toBeUndefined()
  expect(saidCount(w)).toBe(1)
})

test('repartie à la relance, ou n’attendant que des réponses : rien ne se dit', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1()
  traceOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(saidCount(w)).toBe(0)
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', answered: true }] } as any)
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  expect(saidCount(w)).toBe(0)
})

test('une notification non envoyée (sans surface : `isSent: false`) : « t’attend » se pose quand même, et rien ne lève', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board } = litByP1()
  w.flags.notifyNoSurface = true
  const clock = mock.clock(on, { now: T0 + HOUR })
  seed(w, board)
  await start($)
  await settle(clock, 8)
  expect(w.notices).toEqual([])
  expect(w.stored()!.runs[0]!.waitsUser).toMatchObject({ kind: 'step' })
})

test('une notification qui lève : « t’attend » se pose quand même, et rien ne lève', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board } = litByP1()
  w.flags.notifyThrows = true
  const clock = mock.clock(on, { now: T0 + HOUR })
  seed(w, board)
  await start($)
  await settle(clock, 8)
  expect(w.notices).toEqual([])
  expect(w.stored()!.runs[0]!.waitsUser).toMatchObject({ kind: 'step' })
})

test('une coupure du COO pendant l’arrêt (une pause d’une autre raison) : rien ne se dit', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id } = litByP1()
  w.coord.text = JSON.stringify({ v: 1, root: '', entries: [{ id: 'ccut0004', kind: 'cutAuto', run: id, at: T0 + 10 * MIN, by: 'coo' }] })
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await settle(clock, 12)
  // Le contrôle : la coupure est passée (le même monde sans elle dit la pause : premier test de cette section).
  expect(autoOf(w)).toMatchObject({ offWhy: 'coupé par le COO' })
  expect(saidCount(w)).toBe(0)
})

test('dite pendant un tour : la notification part, « t’attend » attend la fin du tour', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board } = litByP1()
  const clock = mock.clock(on, { now: T0 + HOUR })
  seed(w, board)
  await start($)
  await $.turn.start({ turnId: 't1' } as any)
  await settle(clock, 8)
  expect(saidCount(w)).toBe(1)
  expect(w.stored()!.runs[0]!.waitsUser).toBeUndefined()
  await turnEnd($, clock, 't1')
  await settle(clock, 4)
  expect(w.stored()!.runs[0]!.waitsUser).toMatchObject({ kind: 'step' })
})

test('une pause « plus rien ne peut avancer sans toi » fermée proprement, relancée sans date du clic (coordination illisible) : rien ne se dit, elle attend ses réponses', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1({ isOpen: false })
  traceOf(w, id, onAt)
  w.flags.coordUnreadable = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 3000), T0 + HOUR)
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(saidCount(w)).toBe(0)
  // Le contrôle : la coordination relisible, la reprise part (la trace la prouvait).
  w.flags.coordUnreadable = false
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  expect(saidCount(w)).toBe(0)
})

test('tuée en auto, relancée après 24 h sans date du clic : le chargement a éteint l’auto, la pause se dit (`autoTurnedOffOnLoad`)', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  const at = board.runs[0]!.updatedAt + RELAUNCH_WINDOW_MS + 1
  expect(relaunchVerdict(board, at, 'sa', 'boot-P2')).toEqual({ kind: 'none', expired: { run: id, onAt }, wasOn: true })
  expect(autoTurnedOffOnLoad(board, detachOnLoad(board, at, 'sa', 'boot-P2'), 'sa')).toEqual({ run: id, onAt })
  expect(autoTurnedOffOnLoad(board, detachOnLoad(board, at, 'sa', 'boot-P2'), 'sb')).toBeNull()
  const clock = await relaunch($, on, w, board, at)
  await settle(clock, 8)
  expect(saidCount(w)).toBe(1)
})

test('passé 24 h, une trace de reprise de cette discussion (questions encore ouvertes) compte comme preuve : la pause se dit', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1()
  traceOf(w, id, onAt)
  const ended = endedByP1(board, T0 + 3000)
  const clock = await relaunch($, on, w, ended, ended.runs[0]!.updatedAt + RELAUNCH_WINDOW_MS + 1)
  await settle(clock, 8)
  expect(saidCount(w)).toBe(1)
  expect(w.mem[`auto-resume:${id}`]).toBeUndefined()
})

test('repartie à la relance par la date du clic : rien ne se dit', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  await settle(clock, 12)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  expect(saidCount(w)).toBe(0)
})

test('tuée en pause « plus rien ne peut avancer sans toi », relancée après 24 h : la trace s’efface et la pause se dit', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = stuckByP1()
  traceOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, board.runs[0]!.updatedAt + RELAUNCH_WINDOW_MS + 1)
  await settle(clock, 8)
  expect(w.mem[`auto-resume:${id}`]).toBeUndefined()
  expect(saidCount(w)).toBe(1)
})

test('un allumage raté après un /reload-plugins pendant la tentative : la pause se dit quand même', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  w.flags.storeRefuses = true
  const clock = mock.clock(on, { now: T0 + HOUR })
  seed(w, endedByP1(board, T0 + 2000))
  await start($)
  await settle(clock, 1)
  await start($)
  await settle(clock, 10)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(saidCount(w)).toBe(1)
})

test('après un /clear puis un /resume vers l’id d’avant, la date du clic reste ; une vraie fin sous un autre id l’oublie', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  const clock = await relaunch($, on, w, board, T0 + HOUR)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(true)
  await $.session.end({ reason: 'clear' } as any)
  w.ids.now = 'sa-apres-clear'
  await settle(clock, 2)
  // Le /resume finit la discussion vidée (raison « resume ») et revient à « sa » : la date du clic reste.
  await $.session.end({ reason: 'resume' } as any)
  w.ids.now = 'sa'
  await settle(clock, 2)
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ by: 'sa' })
  // Le contrôle : une vraie fin sous un autre id l'oublie.
  w.ids.now = 'sa-ailleurs'
  await $.session.end({ reason: 'exit' } as any)
  await settle(clock, 2)
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
})

test('la mémoire du mod illisible à la première relecture (date du clic et trace) : la reprise encore due se dit', { timeoutMs: 40000 }, async ($, on) => {
  const w = world(on)
  const { board, id, onAt } = litByP1()
  proofOf(w, id, onAt)
  w.flags.proofUnreadable = true
  w.flags.traceUnreadable = true
  const clock = await relaunch($, on, w, endedByP1(board, T0 + 2000), T0 + HOUR)
  await settle(clock, 8)
  expect(isAutoOn(w.stored()!.runs[0]!)).toBe(false)
  expect(saidCount(w)).toBe(1)
})
