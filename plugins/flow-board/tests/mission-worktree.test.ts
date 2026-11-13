import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// La discussion qui porte une mission la garde en entrant dans un worktree du même dépôt. Invariant :
// « Une mission active n'est jamais mise en pause, dupliquée ni perdue parce que sa discussion change de
// dossier dans le même dépôt, et le fichier des missions d'un dossier n'est jamais réécrit avec les
// missions d'un autre dossier. »

const TOOL = 'mcp__flow-board__flow'
const T0 = 700_000_000
const MAIN = '/w/proj'
const TREE = '/w/proj/.claude/worktrees/diag'

/** Le nom du fichier des missions d'une racine, comme le mod le tire (`sharedPath`). */
const slugOf = (root: string): string => root.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const slugOfPath = (path: string): string | null => /\/flow-board\/parcours\/([^/]+)\.json$/.exec(path)?.[1] ?? null

/**
 * Le moteur : un fichier des missions par racine (au fichier quand le mod trouve ~/.claude, sinon dans
 * `$.store`), la racine de la session qui change (`where`), le dépôt principal fixe, et une lecture ratée
 * du fichier du dépôt principal (`fault`). `writes` : chaque écriture d'un fichier des missions, par racine.
 */
const world = (on: any) => {
  const files: Record<string, string> = {}
  const mem: Record<string, unknown> = {}
  const where = { root: MAIN }
  const fault = { mainUnread: false, repoThrows: false }
  const writes: string[] = []
  /** Le mod a touché un fichier des missions : il les tient au fichier (il sait où est ~/.claude), sinon dans `$.store`. */
  const seen = { fs: false }
  const isMainKey = (key: string) => key === `board:${MAIN}`
  on('session.id', () => ({ value: 'session-A' }))
  on('session.end', () => ({ sessionId: 'session-A' }))
  on('classic.SessionStart', () => ({}))
  on('session.root', () => ({ value: where.root }))
  on('session.repo', () => {
    if (fault.repoThrows) throw new Error('pas de réponse')
    return { value: { root: MAIN, remote: null, internal: false, name: null } }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('ui.toast', () => ({ value: undefined }))
  on('command.list', () => ({ value: [] }))
  on('store.get', (_$: unknown, e: { key: string }) => {
    if (fault.mainUnread && isMainKey(e.key)) throw new Error('EIO')
    return { value: mem[e.key] }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (e.key.startsWith('board:')) writes.push(e.key.slice('board:'.length))
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('store.delete', (_$: unknown, e: { key: string }) => {
    delete mem[e.key]
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => {
    const slug = slugOfPath(e.path)
    if (slug !== null) seen.fs = true
    if (slug !== null && fault.mainUnread && slug === slugOf(MAIN)) throw new Error('EIO')
    return { value: slug !== null ? slug in files : e.path in files } as any
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const slug = slugOfPath(e.path)
    if (slug !== null) seen.fs = true
    if (slug !== null && fault.mainUnread && slug === slugOf(MAIN)) throw new Error('EIO')
    const key = slug ?? e.path
    if (!(key in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[key] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    const slug = slugOfPath(e.path)
    if (slug !== null) seen.fs = true
    if (slug !== null) writes.push(slug === slugOf(MAIN) ? MAIN : slug === slugOf(TREE) ? TREE : slug)
    files[slug ?? e.path] = e.text
    return { value: undefined } as any
  })
  on('fs.list', () => ({ value: [] }) as any)
  return { files, mem, where, fault, writes, seen }
}
type World = ReturnType<typeof world>

/** Le board enregistré d'une racine : son fichier quand le mod l'écrit, sinon `$.store`. */
const boardAt = (w: World, root: string): Board | undefined => {
  const file = w.files[slugOf(root)]
  if (!w.seen.fs) return w.mem[`board:${root}`] as Board | undefined
  return (file !== undefined ? JSON.parse(file) : undefined) as Board | undefined
}
/**
 * Ce qu'une autre discussion (ou un état d'avant) écrit dans le fichier d'une racine : là où le mod
 * l'écrit (le fichier quand il sert déjà), aux deux endroits avant toute écriture du mod.
 */
const putBoard = (w: World, board: Board) => {
  const isFileUsed = Object.keys(w.files).some(k => k.startsWith(slugOf(MAIN)))
  const isStoreUsed = Object.keys(w.mem).some(k => k.startsWith('board:'))
  if (isFileUsed || !isStoreUsed) w.files[slugOf(board.root)] = JSON.stringify(board)
  if (isStoreUsed || !isFileUsed) w.mem[`board:${board.root}`] = board
}

const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
const say = async ($: any, input: Record<string, unknown>): Promise<string> => JSON.stringify(await $.tool.call({ tool: TOOL, ...input } as any))

/** Une discussion à la racine ouvre sa mission, enregistrée dans le fichier du dépôt principal. */
const carrying = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await say($, { open: { title: 'Ici', entry: 'implement' }, tickets: [{ id: 't1', name: 'Un' }] })
  await settle(clock, 2)
  const run = boardAt(w, MAIN)!.runs.find(r => r.title === 'Ici')!
  expect(run.status).toBe('active')
  return { clock, w, id: run.id }
}

/** La discussion entre dans le worktree : sa racine change, le cache de la racine passe. */
const moveTo = async (clock: any, w: World, root: string) => {
  w.where.root = root
  await settle(clock, 6)
}

const runsOf = (b: Board | undefined, id: string): Run[] => (b?.runs ?? []).filter(r => r.id === id)

test('entrée dans un worktree du dépôt : l’outil répond sur la même mission, ses écritures vont au fichier du dépôt principal, celui du worktree n’est pas créé', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, id } = await carrying($, on)
  await moveTo(clock, w, TREE)
  const answer = await say($, { note: 'dans le worktree', set: [{ id: 't1', status: 'doing' }] })
  expect(answer).toMatch(/Dashboard: Ici/)
  expect(answer).not.toMatch(/Dashboard unavailable/)
  await settle(clock, 2)
  const main = boardAt(w, MAIN)!
  expect(runsOf(main, id)).toHaveLength(1)
  expect(runsOf(main, id)[0]!.status).toBe('active')
  expect(runsOf(main, id)[0]!.tickets.find(t => t.id === 't1')!.status).toBe('doing')
  expect(boardAt(w, TREE)).toBeUndefined()
  expect(w.writes).not.toContain(TREE)
})

test('sortie du worktree : la mission est toujours active, ni en pause ni dupliquée', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, id } = await carrying($, on)
  await moveTo(clock, w, TREE)
  await say($, { note: 'dedans' })
  await moveTo(clock, w, MAIN)
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await settle(clock, 2)
  const runs = runsOf(boardAt(w, MAIN), id)
  expect(runs).toHaveLength(1)
  expect(runs[0]!.status).toBe('active')
  expect(runs[0]!.tickets.find(t => t.id === 't1')!.status).toBe('doing')
  expect(boardAt(w, TREE)).toBeUndefined()
})

test('/reload-plugins dans le worktree : la mission est retrouvée, sans pause', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, id } = await carrying($, on)
  await moveTo(clock, w, TREE)
  await say($, { note: 'dedans' })
  await start($)
  await settle(clock, 1)
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await settle(clock, 2)
  const runs = runsOf(boardAt(w, MAIN), id)
  expect(runs).toHaveLength(1)
  expect(runs[0]!.status).toBe('active')
  expect(runs[0]!.tickets.find(t => t.id === 't1')!.status).toBe('doing')
  expect(boardAt(w, TREE)).toBeUndefined()
})

test('mise de côté dans le worktree : la pause part dans le fichier du dépôt principal avant que la discussion passe au fichier du worktree, qui n’est pas créé', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, id } = await carrying($, on)
  await moveTo(clock, w, TREE)
  await say($, { note: 'dedans' })
  await settle(clock, 2)
  await $.command.run({ command: 'flow', args: 'pause' } as any).catch(() => undefined)
  // Tout de suite, avant la sauvegarde programmée : la discussion n'a plus de mission ici et passe au fichier du worktree.
  await say($, { note: 'après' })
  await settle(clock, 3)
  const runs = runsOf(boardAt(w, MAIN), id)
  expect(runs).toHaveLength(1)
  expect(runs[0]!.status).toBe('paused')
  expect(runsOf(boardAt(w, TREE), id)).toHaveLength(0)
  expect(w.writes).not.toContain(TREE)
})

test('deux discussions, l’une dans le worktree, l’autre à la racine, écrivent le même fichier : les deux missions y restent', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, id } = await carrying($, on)
  await moveTo(clock, w, TREE)
  const other = { ...newRun('implement', T0 + 1000, 'Là-bas'), status: 'active' as const, owner: 'session-B', updatedAt: T0 + 9000 }
  putBoard(w, { ...boardAt(w, MAIN)!, runs: [...boardAt(w, MAIN)!.runs, other] })
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await settle(clock, 2)
  const main = boardAt(w, MAIN)!
  expect(runsOf(main, id)).toHaveLength(1)
  expect(runsOf(main, id)[0]!.status).toBe('active')
  expect(runsOf(main, id)[0]!.tickets.find(t => t.id === 't1')!.status).toBe('doing')
  expect(runsOf(main, other.id)).toHaveLength(1)
  expect(boardAt(w, TREE)).toBeUndefined()
})

/** Le fichier du dépôt principal porte la mission active de cette discussion ; la discussion démarre dans le worktree. */
const mainWithMine = (): { board: Board; id: string } => {
  const run = { ...newRun('implement', T0 - 5000, 'Ici'), status: 'active' as const, owner: 'session-A', updatedAt: T0 - 1000 }
  return { board: { ...emptyBoard(MAIN, 'proj'), session: 'session-A', deleted: [], runs: [run], activeId: run.id }, id: run.id }
}

test('lecture ratée du fichier du dépôt principal depuis le worktree : aucune écriture dans l’un ou l’autre fichier, et la réponse le dit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { board } = mainWithMine()
  putBoard(w, board)
  const before = JSON.stringify(boardAt(w, MAIN))
  w.where.root = TREE
  w.fault.mainUnread = true
  await start($)
  const answer = await say($, { open: { title: 'Nouvelle', entry: 'implement' }, note: 'x' })
  expect(answer).toMatch(/missions file of the main repository could not be read/)
  // /flow le dit aussi, sans lever d'erreur.
  expect(String((await $.command.run({ command: 'flow', args: '' } as any)).text)).toMatch(/dépôt principal illisible/)
  await settle(clock, 3)
  expect(w.writes).toEqual([])
  w.fault.mainUnread = false
  expect(JSON.stringify(boardAt(w, MAIN))).toBe(before)
  expect(boardAt(w, TREE)).toBeUndefined()
})

test('reprise de la discussion dans le worktree : la mission du dépôt principal n’est ni dupliquée ni recopiée dans le fichier du worktree', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { board, id } = mainWithMine()
  putBoard(w, board)
  w.where.root = TREE
  await start($)
  await say($, { note: 'reprise' })
  await settle(clock, 3)
  expect(runsOf(boardAt(w, MAIN), id)).toHaveLength(1)
  // Comme à la racine : la discussion relancée sous son id garde la mission qu'elle tenait, dans le fichier du dépôt
  // principal (avant le 09/11/2026, la reprise la mettait en pause : il fallait « ↻ Reprendre ici »).
  expect(runsOf(boardAt(w, MAIN), id)[0]!).toMatchObject({ status: 'active', owner: 'session-A' })
  expect(runsOf(boardAt(w, TREE), id)).toHaveLength(0)
})

test('le moteur ne dit pas le dépôt au moment d’entrer dans le worktree : la discussion garde sa mission, sans bascule', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, id } = await carrying($, on)
  w.fault.repoThrows = true
  await moveTo(clock, w, TREE)
  const answer = await say($, { set: [{ id: 't1', status: 'doing' }] })
  expect(answer).toMatch(/Dashboard: Ici/)
  await settle(clock, 2)
  expect(w.writes).not.toContain(TREE)
  const runs = runsOf(boardAt(w, MAIN), id)
  expect(runs).toHaveLength(1)
  expect(runs[0]!.status).toBe('active')
  expect(runs[0]!.tickets.find(t => t.id === 't1')!.status).toBe('doing')
  expect(boardAt(w, TREE)).toBeUndefined()
})

test('dans un worktree au board du worktree, la consigne de code lit les groupes en cours du fichier du dépôt principal et dit de garder le travail sur la branche du worktree', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const base = newRun('implement', T0 - 6000, 'Là-bas')
  const other: Run = {
    ...base,
    status: 'active',
    owner: 'session-B',
    updatedAt: T0 - 1000,
    tickets: [{ id: 'tD', name: 'D', status: 'doing', files: ['a.ts'] } as any],
    groups: [{ id: 'D', name: 'D', tickets: ['tD'], linked: { at: T0 - 2000 } } as any, { id: 'E', name: 'E', tickets: [] } as any],
  }
  putBoard(w, { ...emptyBoard(MAIN, 'proj'), session: 'session-B', deleted: [], runs: [other], activeId: null })
  w.where.root = TREE
  await start($)
  await settle(clock, 1)
  const text = (await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'x' })).text
  const line = text.split('\n').find(l => l.startsWith('- Groups of other missions of this project are in flight')) ?? ''
  expect(line).toContain('« a.ts »')
  expect(line).toContain('« Là-bas »')
  expect(line).toMatch(/already runs in a worktree/)
  expect(line).not.toMatch(/do it in a worktree \(EnterWorktree\)/)
  // La fusion revient à la discussion, selon la façon dont elle est entrée dans le worktree.
  expect(line).toContain(
    'Once it is finished and reviewed, the merge is yours, not the user\'s: if this session entered the worktree by EnterWorktree, leave it (ExitWorktree, action keep: this instruction is the user\'s standing request for it), then run git merge <this worktree\'s branch> in the main clone; if the session was launched in the worktree, or ExitWorktree has no effect (a worktree entered in a previous session), the manager that launched this session as a worker merges it; without such a manager (a session the user started in the worktree, or launched from a COO launch card), give the user the exact command to type in the main clone (git merge <this worktree\'s branch>).',
  )
  // Le fichier du dépôt principal est lu, pas réécrit.
  expect(w.writes).not.toContain(MAIN)
})
