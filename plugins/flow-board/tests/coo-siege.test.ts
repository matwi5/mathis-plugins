import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, mergeBoards } from '../hooks/model.ts'
import { SEAT_STALE_MS, mergeSeat, seatHolder } from '../hooks/seat.ts'
import type { Board, CooSeat } from '../types'

// Le siège du COO. Invariant : « Jamais deux discussions
// n'écrivent comme COO du même projet sur le même poste. Celle qui a perdu le siège n'écrit plus
// rien : ni fichier de coordination, ni feuille de route, ni décision relayée, ni lancement. Une
// consigne qu'elle a écrite reste en vigueur, et le nouveau titulaire la reprend telle quelle. »

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const KEY = 'board:'
const COO = 'flow-board:coo'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const SURFACES = ['terminal', 'desktop'] as const

const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')

/**
 * Le moteur sous le plugin, avec un stockage en mémoire que le test modifie pour jouer l'autre
 * discussion (B) : le fichier commun des missions quand le mod sait où est ~/.claude (`disk`),
 * `$.store` sinon (`mem`, clé `board:`) ; `ids.now` est l'id de cette discussion (A), changé par un
 * /clear ; `unread` fait échouer la lecture du stockage ; `writes` garde chaque board écrit.
 */
const world = (on: any, roots?: { root: string; repo: string | 'throws'; gitFile?: boolean }) => {
  const mem: Record<string, unknown> = {}
  const disk: { board?: string; isUsed: boolean } = { isUsed: false }
  const files: Record<string, string> = {}
  const ids = { now: 'session-A' }
  const fault = { unread: false }
  const writes: Board[] = []
  const commands: string[] = []
  const sent: { text: string; context?: readonly string[] }[] = []
  on('session.end', () => ({ sessionId: ids.now }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    sent.push(e)
    return { text: e.text }
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: ids.now }))
  on('store.get', (_$: unknown, e: { key: string }) => {
    if (fault.unread && e.key === KEY) throw new Error('lecture ratée')
    return { value: mem[e.key] }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    if (e.key === KEY) writes.push(mem[e.key] as Board)
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isBoardFile(e.path) ? fault.unread || disk.board !== undefined : e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      if (fault.unread || disk.board === undefined) throw new Error(`EIO ${e.path}`)
      return { value: disk.board } as any
    }
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      disk.board = e.text
      writes.push(JSON.parse(e.text) as Board)
    } else files[e.path] = e.text
    return { value: undefined } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  if (roots) {
    on('session.root', () => ({ value: roots.root }))
    on('session.repo', () => {
      if (roots.repo === 'throws') throw new Error('pas de réponse')
      return { value: { root: roots.repo, remote: null, internal: false, name: null } }
    })
    on('fs.stat', (_$: unknown, e: { path: string }) => {
      if (roots.gitFile && e.path.endsWith('/.git')) return { value: { kind: 'file', size: 40, mtimeMs: 1 } } as any
      throw new Error(`ENOENT ${e.path}`)
    })
  }
  on('command.list', () => ({ value: [] }))
  on('command.run', { command: COO }, (_$: unknown, e: { command: string }) => {
    commands.push(e.command)
    return { text: '' }
  })
  return { mem, disk, ids, fault, writes, commands, sent }
}

const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
type World = ReturnType<typeof world>
/** Le board enregistré : dans le fichier commun s'il sert, sinon dans `$.store`. */
const stored = (w: Pick<World, 'mem' | 'disk'>): Board => (w.disk.isUsed && w.disk.board !== undefined ? JSON.parse(w.disk.board) : w.mem[KEY]) as Board
/** Ce que la discussion B écrit dans le fichier des missions : son siège, au fichier commun comme dans `$.store`. */
const seatOfB = (w: Pick<World, 'mem' | 'disk'>, seat: CooSeat) => {
  const base = stored(w) ?? { ...emptyBoard('', 'projet'), deleted: [] }
  const next = { ...base, coo: seat }
  w.mem[KEY] = next
  w.disk.board = JSON.stringify(next)
}
/** `/flow-board:coo` chargé : sa prise relit le siège un peu après (l'horloge avance pendant ce temps). */
const openCoo = async ($: any, clock: { advance: (ms: number) => Promise<void> }): Promise<string> => {
  const loading = $.skill.prompt({ skill: COO, text: 'consignes du COO' })
  await settle(clock, 4)
  return (await loading).text
}
/** Le tour que lance « ↻ Reprendre ici » : la commande du skill du COO, avec son argument, puis son chargement. */
const retakeTurn = async ($: any, clock: { advance: (ms: number) => Promise<void> }): Promise<string> => {
  await $.prompt.submit({ text: '/flow-board:coo reprendre', origin: { kind: 'plugin', name: PLUGIN }, command: { name: COO, args: 'reprendre' } } as any)
  return openCoo($, clock)
}

/** Le bandeau, sur les deux surfaces : ce que voit la personne. */
const band = async ($: any, surface: (typeof SURFACES)[number]) => $.ui.mount({ plugin: PLUGIN, surface, ...BAND })

// ─── Les règles de fusion ─────────────────────────────────────────────────

test('deux prises croisées finissent sur un seul titulaire, dans les deux sens de fusion', () => {
  const a: CooSeat = { by: 'session-A', at: 1_000, seenAt: 1_000 }
  const b: CooSeat = { by: 'session-B', at: 1_200, seenAt: 1_200 }
  expect(mergeSeat(a, b)).toEqual(b)
  expect(mergeSeat(b, a)).toEqual(b)
  // À la même milliseconde, l'id le plus grand, quel que soit l'ordre.
  const b2 = { ...b, at: 1_000, seenAt: 1_000 }
  expect(mergeSeat(a, b2)).toEqual(mergeSeat(b2, a))
  // Par le board entier : la copie d'ici et celle du stockage tranchent pareil.
  const local: Board = { ...emptyBoard('/p', 'p'), session: 'session-A', coo: a }
  const other: Board = { ...emptyBoard('/p', 'p'), session: 'session-B', coo: b }
  expect(mergeBoards(local, other).coo).toEqual(b)
  expect(mergeBoards(other, local).coo).toEqual(b)
})

test('un rafraîchissement ou une libération de l’ancien titulaire ne touche pas la prise plus récente', () => {
  const taken: CooSeat = { by: 'session-B', at: 2_000, seenAt: 2_000 }
  const refreshedOld: CooSeat = { by: 'session-A', at: 1_000, seenAt: 5_000 }
  const releasedOld: CooSeat = { by: 'session-A', at: 1_000, seenAt: 6_000, releasedAt: 6_000 }
  expect(mergeSeat(refreshedOld, taken)).toEqual(taken)
  expect(mergeSeat(releasedOld, taken)).toEqual(taken)
  // Dans une même prise : la libération l'emporte, et la fusion est idempotente.
  const live: CooSeat = { by: 'session-A', at: 1_000, seenAt: 7_000 }
  expect(mergeSeat(live, releasedOld)).toEqual({ by: 'session-A', at: 1_000, seenAt: 7_000, releasedAt: 6_000 })
  expect(mergeSeat(mergeSeat(live, releasedOld), releasedOld)).toEqual(mergeSeat(live, releasedOld))
  // Un siège mal formé (relu d'un fichier écrit ailleurs) ne s'applique jamais.
  expect(mergeSeat({ by: '../x', at: 9_000, seenAt: 9_000 }, live)).toEqual(live)
  expect(seatHolder(live, 7_000 + SEAT_STALE_MS + 1)).toBeNull()
})

// ─── Le mod ───────────────────────────────────────────────────────────────

test('/flow-board:coo prend un siège libre : le fichier des missions le dit, et le bandeau montre ◆ COO', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 100_000_000 })
  const w = world(on)
  await start($)
  const text = await openCoo($, clock)
  expect(text).toMatch(/consignes du COO/)
  expect(text).toMatch(/COO seat: held by this discussion/)
  await settle(clock, 1)
  expect(stored(w).coo).toMatchObject({ by: 'session-A', at: 100_000_000 })
  // La demande du siège est gardée par discussion : retrouvée après un redémarrage.
  expect(w.mem['coo-here:session-A']).toBe(true)
  for (const surface of SURFACES) {
    const ui = await band($, surface)
    expect(await ui.find({ type: 'Text', text: /◆.COO/ })).toBeDefined()
    expect(await ui.find({ key: 'band-coo-take' })).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
})

test('un siège tenu ailleurs ne se prend pas seul : « ↻ Reprendre ici » le prend, et B le voit perdu', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 101_000_000 })
  const w = world(on)
  seatOfB(w, { by: 'session-B', at: 100_990_000, seenAt: 100_999_000 })
  await start($)
  const text = await openCoo($, clock)
  expect(text).toMatch(/held by another live discussion/)
  expect(stored(w).coo?.by).toBe('session-B')
  for (const surface of SURFACES) {
    const ui = await band($, surface)
    expect(await ui.find({ type: 'Text', text: /tenu.par.une.autre.discussion/ })).toBeDefined()
    expect((await ui.find({ key: 'band-coo-take' }))?.props.label).toMatch(/^↻.Reprendre.ici$/)
    await ui.unmount()
  }
  const { commands } = w
  const ui = await band($, 'desktop')
  await ui.press({ key: 'band-coo-take' })
  await ui.unmount()
  // Le bouton relance le skill (ses consignes reviennent à Claude) ; son chargement reprend le siège.
  expect(commands).toEqual([COO])
  expect(await retakeTurn($, clock)).toMatch(/held by this discussion/)
  expect(stored(w).coo?.by).toBe('session-A')
  // Vu de B : le siège n'est plus le sien.
  expect(seatHolder(stored(w).coo, 101_010_000)).toBe('session-A')
})

test('un siège abandonné depuis plus de 30 minutes se prend sans « Reprendre ici »', { timeoutMs: 15000 }, async ($, on) => {
  const now = 102_000_000
  const clock = mock.clock(on, { now })
  const w = world(on)
  seatOfB(w, { by: 'session-B', at: now - SEAT_STALE_MS - 120_000, seenAt: now - SEAT_STALE_MS - 60_000 })
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 1)
  expect(stored(w).coo?.by).toBe('session-A')
})

test('le titulaire se montre au moins toutes les 5 minutes', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 103_000_000 })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await settle(clock, 1)
  const first = stored(w).coo!.seenAt
  await clock.advance(5 * 60_000)
  await settle(clock, 6)
  expect(stored(w).coo!.seenAt).toBeGreaterThanOrEqual(first + 5 * 60_000)
  expect(stored(w).coo!.by).toBe('session-A')
})

test('après la perte du siège, A ne réécrit plus jamais le siège à son nom, ni à son rafraîchissement ni à ses sauvegardes', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 104_000_000 })
  const w = world(on)
  const { writes, sent } = w
  await start($)
  await openCoo($, clock)
  await settle(clock, 1)
  // Contrôle positif : A a bien écrit sa prise.
  expect(writes.some(w => w.coo?.by === 'session-A')).toBe(true)
  // B reprend le siège.
  seatOfB(w, { by: 'session-B', at: 104_002_000, seenAt: 104_002_000 })
  const lostAt = writes.length
  await settle(clock, 6)
  for (const surface of SURFACES) {
    const ui = await band($, surface)
    expect(await ui.find({ type: 'Text', text: /tenu.par.une.autre.discussion/ })).toBeDefined()
    await ui.unmount()
  }
  // Claude le lit avec chaque tour du fil principal : un message, comme la fin d'une tâche de fond.
  await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any)
  expect(sent.at(-1)?.context?.some(c => /NOT held by this discussion/.test(c))).toBe(true)
  await $.prompt.submit({ text: '<task-notification>fini</task-notification>', origin: { kind: 'task-notification' } } as any)
  expect(sent.at(-1)?.context?.some(c => /NOT held by this discussion/.test(c))).toBe(true)
  // A continue de vivre : son rafraîchissement passe, une sauvegarde de son board aussi.
  await clock.advance(6 * 60_000)
  await settle(clock, 6)
  await $.tool.call({ tool: TOOL, open: { title: 'Mission de A' } } as any)
  await settle(clock, 2)
  const after = writes.slice(lostAt)
  // Contrôle positif : A a bien écrit après la perte (la mission qu'il ouvre, permise hors du siège), sans jamais remettre sa prise.
  expect(after.length).toBeGreaterThan(0)
  expect(after.every(w => w.coo?.by === 'session-B')).toBe(true)
  expect(stored(w).coo).toMatchObject({ by: 'session-B', at: 104_002_000 })
})

test('une écriture croisée qui recouvre la prise d’ici d’une prise plus ancienne : le titulaire la réécrit aussitôt', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 104_500_000 })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  expect(stored(w).coo?.by).toBe('session-A')
  // Une autre discussion, partie d'une copie antérieure, réécrit le fichier avec une prise plus ancienne.
  seatOfB(w, { by: 'session-C', at: 104_400_000, seenAt: 104_400_000 })
  await settle(clock, 7)
  expect(stored(w).coo).toMatchObject({ by: 'session-A', at: 104_500_000 })
})

test('un siège daté loin dans le futur est ramené à maintenant, jamais effacé : « ↻ Reprendre ici » le remplace', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 104_700_000 })
  const w = world(on)
  seatOfB(w, { by: 'session-B', at: 104_700_000 + 2 * 3_600_000, seenAt: 104_700_000 + 2 * 3_600_000 })
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by another live discussion/)
  expect(stored(w).coo?.by).toBe('session-B')
  expect(await retakeTurn($, clock)).toMatch(/held by this discussion/)
  expect(stored(w).coo?.by).toBe('session-A')
})

test('une relecture ratée au moment d’un message : Claude lit que le siège est inconnu et n’écrit rien comme COO', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 104_800_000 })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await $.prompt.submit({ text: 'et maintenant ?', origin: { kind: 'composer' } } as any)
  expect(w.sent.at(-1)?.context?.some(c => /held by this discussion/.test(c))).toBe(true)
  w.fault.unread = true
  await $.prompt.submit({ text: 'et maintenant ?', origin: { kind: 'composer' } } as any)
  expect(w.sent.at(-1)?.context?.some(c => /could not be read/.test(c) && /Siège du COO illisible/.test(c))).toBe(true)
})

test('le COO ne s’ouvre qu’à la racine du dossier principal du dépôt : ni dans un sous-dossier, ni dans un worktree', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 104_900_000 })
  const w = world(on, { root: '/proj/plugins/x', repo: '/proj' })
  await start($)
  expect(await openCoo($, clock)).toMatch(/does not run at the root of the main working tree/)
  expect(stored(w)?.coo).toBeUndefined()
})

test('dans un worktree, le COO ne s’ouvre pas : la racine du dépôt est celle du dossier principal', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 104_950_000 })
  const w = world(on, { root: '/proj/.claude/worktrees/x', repo: '/proj' })
  await start($)
  expect(await openCoo($, clock)).toMatch(/does not run at the root of the main working tree/)
  expect(stored(w)?.coo).toBeUndefined()
})

test('sans réponse du moteur sur le dépôt, un worktree se reconnaît encore à son .git, un fichier', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 104_970_000 })
  const w = world(on, { root: '/proj/.claude/worktrees/x', repo: 'throws', gitFile: true })
  await start($)
  expect(await openCoo($, clock)).toMatch(/does not run at the root of the main working tree/)
  expect(stored(w)?.coo).toBeUndefined()
})

test('après /reload-plugins, le siège reste ici sans « Reprendre ici »', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 105_000_000 })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await settle(clock, 1)
  // Le mod rechargé : un nouveau `session.start`, l'état de la discussion intact.
  await start($)
  await settle(clock, 6)
  expect(stored(w).coo).toMatchObject({ by: 'session-A' })
  const ui = await band($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /◆.COO/ })).toBeDefined()
  expect(await ui.find({ key: 'band-coo-take' })).toBeUndefined()
  await ui.unmount()
})

test('après /clear, le nouvel id voit le siège tenu par l’ancien et propose « ↻ Reprendre ici »', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 106_000_000 })
  const w = world(on)
  const { ids } = w
  await start($)
  await openCoo($, clock)
  await settle(clock, 1)
  await $.session.end({ reason: 'clear' } as any)
  ids.now = 'session-A2'
  await ($ as any).classic.SessionStart({ session_id: 'session-A2', transcript_path: '/t', cwd: '', hook_event_name: 'SessionStart', source: 'clear' })
  await settle(clock, 6)
  // Le /clear ne libère rien : le siège reste à l'ancien id.
  expect(stored(w).coo).toMatchObject({ by: 'session-A' })
  expect(stored(w).coo?.releasedAt).toBeUndefined()
  // Le nouvel id n'est pas le COO : une mission s'ouvrirait ici ; Claude lit qu'il n'écrit rien comme COO.
  await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any)
  expect(w.sent.at(-1)?.context?.some(c => /NOT held by this discussion/.test(c))).toBe(true)
  const ui = await band($, 'desktop')
  expect((await ui.find({ key: 'band-coo-take' }))?.props.label).toMatch(/^↻.Reprendre.ici$/)
  await ui.press({ key: 'band-coo-take' })
  await ui.unmount()
  expect(await retakeTurn($, clock)).toMatch(/held by this discussion/)
  expect(stored(w).coo?.by).toBe('session-A2')
})

test('deux prises presque simultanées : celle qui relit une prise plus récente que la sienne ne se dit pas COO', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 106_500_000 })
  const w = world(on)
  await start($)
  const loading = $.skill.prompt({ skill: COO, text: 'consignes du COO' })
  await settle(clock, 1)
  // B prend le siège juste après A, pendant que A relit le sien.
  seatOfB(w, { by: 'session-B', at: 106_500_500, seenAt: 106_500_500 })
  await settle(clock, 4)
  expect((await loading).text).toMatch(/another discussion took it at the same moment/)
  expect(stored(w).coo?.by).toBe('session-B')
})

test('après un redémarrage (--continue), une discussion qui tenait le siège et l’a perdu le dit encore à Claude', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 106_700_000 })
  const w = world(on)
  // Avant le redémarrage, A avait pris le siège : sa demande est gardée par discussion (contrôle positif
  // dans le test de la prise) ; B l'a repris pendant que A était arrêté. Le processus d'A repart du fichier.
  w.mem['coo-here:session-A'] = true
  seatOfB(w, { by: 'session-B', at: 106_690_000, seenAt: 106_699_000 })
  await start($)
  await settle(clock, 6)
  await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any)
  expect(w.sent.at(-1)?.context?.some(c => /NOT held by this discussion/.test(c))).toBe(true)
})

test('un siège mal formé n’est jamais effacé par une sauvegarde : il est seulement ignoré', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 106_900_000 })
  const w = world(on)
  seatOfB(w, { by: '../x', at: 106_800_000, seenAt: 106_800_000 } as CooSeat)
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Une mission' } } as any)
  await settle(clock, 2)
  expect(stored(w).runs.length).toBe(1)
  expect(stored(w).coo).toEqual({ by: '../x', at: 106_800_000, seenAt: 106_800_000 })
})

test('la fin de la discussion libère son siège', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 107_000_000 })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await settle(clock, 1)
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  expect(stored(w).coo?.by).toBe('session-A')
  expect(stored(w).coo?.releasedAt).toBeGreaterThan(107_000_000)
  expect(seatHolder(stored(w).coo, 107_010_000)).toBeNull()
})

test('une discussion plantée laisse un siège que personne ne tient plus au bout de 30 minutes', () => {
  const seat: CooSeat = { by: 'session-A', at: 1_000_000, seenAt: 1_000_000 }
  expect(seatHolder(seat, 1_000_000 + SEAT_STALE_MS)).toBe('session-A')
  expect(seatHolder(seat, 1_000_000 + SEAT_STALE_MS + 1)).toBeNull()
})

test('une lecture ratée du fichier des missions n’écrit rien et le dit', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 108_000_000 })
  const { fault, writes } = world(on)
  await start($)
  await settle(clock, 1)
  fault.unread = true
  const before = writes.length
  const text = await openCoo($, clock)
  expect(text).toMatch(/Siège du COO illisible : rien n’est écrit, réessaie/)
  await settle(clock, 2)
  expect(writes.slice(before).some(w => w.coo !== undefined)).toBe(false)
})

test('la discussion qui tient le siège n’ouvre aucune mission : ni par l’outil, ni par un skill de départ', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 109_000_000 })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  await settle(clock, 1)
  const r = await $.tool.call({ tool: TOOL, open: { title: 'Une mission' } } as any)
  expect(String((r as any).result)).toMatch(/no mission opens or resumes here/)
  const loaded = await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  expect(loaded.text).toMatch(/no mission opens or resumes here/)
  await settle(clock, 1)
  expect(stored(w).runs).toEqual([])
})

test('témoin : hors de la discussion du COO, le même skill de départ ouvre bien une mission', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 109_500_000 })
  const w = world(on)
  await start($)
  const loaded = await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  expect(loaded.text).not.toMatch(/no mission opens or resumes here/)
  await settle(clock, 2)
  expect(stored(w).runs.length).toBe(1)
})

test('dans un bandeau étroit du terminal, « ◆ COO » garde sa place', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 109_700_000 })
  world(on)
  await start($)
  const narrow = { ...BAND, props: { ...BAND.props, bodyColumns: 48 } }
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...narrow })
  expect((await ui.find({ key: 'band-coo' }))?.props.label).toMatch(/^◆.COO$/)
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('une discussion sans mission montre « ◆ COO » au bandeau d’accueil, qui lance /flow-board:coo', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 110_000_000 })
  const { commands } = world(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await band($, surface)
    expect((await ui.find({ key: 'band-coo' }))?.props.label).toMatch(/^◆.COO$/)
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
  const ui = await band($, 'desktop')
  await ui.press({ key: 'band-coo' })
  await ui.unmount()
  expect(commands).toEqual([COO])
})

test('« Laisser » : une discussion qui a demandé le siège sans le tenir redevient ordinaire, et le siège n’est pas touché', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 111_000_000 })
  const w = world(on)
  seatOfB(w, { by: 'session-B', at: 110_990_000, seenAt: 110_999_000 })
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by another live discussion/)
  const ui = await band($, 'desktop')
  expect(await ui.find({ key: 'band-coo-take' })).toBeDefined()
  await ui.press({ key: 'band-coo-leave' })
  await ui.unmount()
  await settle(clock, 6)
  const after = await band($, 'desktop')
  expect(await after.find({ key: 'band-coo-take' })).toBeUndefined()
  expect((await after.find({ key: 'band-coo' }))?.props.label).toMatch(/^◆.COO$/)
  await after.unmount()
  expect(stored(w).coo?.by).toBe('session-B')
  expect(w.mem['coo-here:session-A']).toBe(false)
  // Plus de ligne du siège pour Claude.
  await $.prompt.submit({ text: 'bonjour', origin: { kind: 'composer' } } as any)
  expect((w.sent.at(-1)?.context ?? []).some(c => /COO seat/.test(c))).toBe(false)
})
