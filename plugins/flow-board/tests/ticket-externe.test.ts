import { expect, mock, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { isFileLiftable, isNamedTicket, liftableTickets, liftByTickets, ticketReadsText, type TicketRead } from '../hooks/externes.ts'
import { applyAsana, applyReport, clampFuture, emptyBoard, mergeBoards, newRun } from '../hooks/model.ts'
import { TOOL_SCHEMA } from '../hooks/tool-schema.ts'
import type { Board, ExternalBlocker, Run } from '../types'
import { settle } from './horloge.ts'

// Un bloqueur externe peut nommer le ticket d'une autre mission (« <dossier>/<numéro> ») et se lève quand le fichier
// de ce ticket dit « fait ».
// Invariant (validé par le porteur le 21/11/2026) : « Un bloqueur externe qui nomme
// un ticket d'une autre mission ne se lève seul que lorsque le fichier de ce ticket, lu dans `travail/<dossier>/issues/`
// sous la racine du projet, dit « fait » ; le ticket nommé ne change plus une fois noté ; un bloqueur levé ne redevient
// à faire que par un envoi explicite "status": "todo" ou par sa tâche Asana décochée, et n'est jamais effacé hors de
// l'effacement de la mission. »

const T0 = 80_000_000
const ROOT = '/proj'
const ID = 'titres-stables-09'
const NAMED = 'titres-stables/09'
const LOT = {
  tickets: [
    { id: 'a1', name: 'Premier', files: ['a.ts'] },
    { id: 'b1', name: 'Second', files: ['b.ts'], blockedBy: [ID] },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Données', tickets: ['b1'] },
  ],
}

const boardWith = (externals: unknown[] = [{ id: ID, name: 'Ticket 09 de « Titres stables »', kind: 'task', ticket: NAMED }]): Board => {
  const run = newRun('implement', T0, 'Boutique')
  const b: Board = { ...emptyBoard(ROOT, 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(b, { ...LOT, externals }, T0 + 1).board
}
const ext = (b: Board): ExternalBlocker[] => activeRun(b)!.externals ?? []
const one = (b: Board, id = ID) => ext(b).find(x => x.id === id)
const runIdOf = (b: Board) => activeRun(b)!.id
const done: TicketRead[] = [{ ticket: NAMED, state: 'done' }]

// ─── La notation du ticket nommé ──────────────────────────────────────────

test('le ticket nommé se note au premier envoi, daté ; le même renvoyé ne change rien ; un autre est refusé et dit', () => {
  const b = boardWith()
  expect(one(b)).toEqual({ id: ID, name: 'Ticket 09 de « Titres stables »', status: 'todo', isDecision: false, ticket: NAMED, ticketAt: T0 + 1 })
  const same = applyReport(b, { externals: [{ id: ID, ticket: NAMED }] }, T0 + 2)
  expect(one(same.board)).toEqual(one(b))
  expect(same.text).not.toContain('"ticket"')
  const other = applyReport(b, { externals: [{ id: ID, ticket: 'autre-mission/3' }] }, T0 + 3)
  expect(one(other.board)!.ticket).toBe(NAMED)
  expect(other.text).toContain(`"${ID}": "ticket" not changed, this blocker already names "${NAMED}": the named ticket never changes once noted`)
  // Un bloqueur gardé sans ticket le prend au premier envoi.
  const plain = boardWith([{ id: ID, name: 'Sans ticket' }])
  expect(one(applyReport(plain, { externals: [{ id: ID, ticket: NAMED }] }, T0 + 4).board)).toMatchObject({ ticket: NAMED, ticketAt: T0 + 4, status: 'todo' })
})

test('un ticket nommé hors forme est refusé et dit, rien n’est noté ; le reste du bloqueur s’enregistre', () => {
  for (const bad of ['../etc/09', 'titres-stables/../09', '/abs/09', 'titres-stables/09/x', 'titres stables/09', 'titres-stables/12345', 'titres-stables/', '/09', 'titres-stables/０９', 'Ⅼ/09', 42, ['a/1'], { folder: 'a' }, 'titres-stables\\09', 'titres-stables/09\n']) {
    const out = applyReport(boardWith([]), { externals: [{ id: ID, name: 'X', ticket: bad }] }, T0 + 2)
    expect(one(out.board)).toEqual({ id: ID, name: 'X', status: 'todo', isDecision: false })
    expect(out.text).toContain(`"${ID}": "ticket" not recorded, it must be "<folder>/<number>"`)
    expect(out.text).toContain('nothing was read')
  }
  for (const good of ['titres-stables/09', 'a/1', 'Pistes-de-retro-mwp8/0001']) expect(isNamedTicket(good)).toBe(true)
})

test('un bloqueur dont l’id est celui d’un ticket du lot, ou qui nomme le dossier de la mission elle-même, voit son ticket refusé et dit', () => {
  const lot = applyReport(boardWith([]), { externals: [{ id: 'b1', ticket: NAMED }] }, T0 + 2)
  expect(one(lot.board, 'b1')!.ticket).toBeUndefined()
  expect(lot.text).toContain('"b1": "ticket" not recorded, this id is also a ticket of this lot')
  const b = boardWith([])
  const run = activeRun(b)!
  const launched: Board = { ...b, runs: [{ ...run, launch: { id: 'lxxxxxx0001', card: 'kcard0001', folder: 'boutique', start: 'to-tickets', mode: 'manual', at: T0 } } as Run] }
  const own = applyReport(launched, { externals: [{ id: 'x-own', ticket: 'boutique/01' }, { id: 'x-casse', ticket: 'Boutique/02' }] }, T0 + 3)
  expect(one(own.board, 'x-own')!.ticket).toBeUndefined()
  expect(own.text).toContain('"boutique" is the folder of this mission itself')
  // Sans la casse (macOS et Windows l'ignorent) : refusé aussi.
  expect(one(own.board, 'x-casse')!.ticket).toBeUndefined()
  expect(own.text).toContain('"Boutique" is the folder of this mission itself')
})

// ─── La relecture du fichier, par le mod ──────────────────────────────────
// Le `$` d'un test n'a pas de `fs` : la relecture se vérifie par l'outil et par le passage de 5 s du mod.

const TOOL = 'mcp__flow-board__flow'
type Disk = { mem: Record<string, unknown>; files: Record<string, string>; kinds: Record<string, string>; real: Record<string, string>; sizes: Record<string, number>; bump: Set<string>; mtimes: Record<string, number>; swap: Record<string, string>; hang: Set<string>; failRead: Set<string>; calls: string[] }

/**
 * Le moteur sous le mod : le stockage, les fichiers par chemin entier, leur type, où chacun se résout, leur taille, et
 * ceux qui changent pendant leur lecture (`bump`). Chaque appel au disque est noté (`calls`), où qu'il aille.
 */
const world = (on: any): Disk => {
  const w: Disk = { mem: {}, files: {}, kinds: {}, real: {}, sizes: {}, bump: new Set(), mtimes: {}, swap: {}, hang: new Set(), failRead: new Set(), calls: [] }
  const isDir = (path: string) => path === ROOT || Object.keys(w.files).some(p => p.startsWith(`${path}/`))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.root', () => ({ value: ROOT }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'session-A' }))
  on('command.list', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }) as any)
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: w.mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    w.mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in w.files || isDir(e.path) }) as any)
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    w.calls.push(`stat ${e.path}`)
    if (!(e.path in w.files) && !isDir(e.path)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: isDir(e.path) ? 'dir' : 'file', size: w.sizes[e.path] ?? 1, mtimeMs: w.mtimes[e.path] ?? 1, isLink: false, realPath: w.real[e.path] ?? e.path } } as any
  })
  on('fs.list', (_$: unknown, e: { path: string }) => {
    w.calls.push(`list ${e.path}`)
    const dir = `${e.path}/`
    return { value: Object.keys(w.files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/')).map(p => ({ name: p.slice(dir.length), kind: w.kinds[p] ?? 'file', size: 1, mtimeMs: 1 })) } as any
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    w.calls.push(`read ${e.path}`)
    if (w.bump.has(e.path)) w.mtimes[e.path] = (w.mtimes[e.path] ?? 1) + 1
    // Un lien posé sur le fichier pendant sa lecture : il se résout ailleurs ensuite.
    if (e.path in w.swap) w.real[e.path] = w.swap[e.path]!
    // Un tube qui bloque la lecture : elle ne rend jamais la main.
    if (w.hang.has(e.path)) return new Promise(() => undefined) as any
    if (w.failRead.has(e.path) || !(e.path in w.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: w.files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    w.files[e.path] = e.text
    return { value: undefined } as any
  })
  on('prompt.fill', () => ({ isFilled: true }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  return w
}

/** Le board enregistré : le fichier commun des missions s'il s'écrit, sinon le stockage. */
const savedOf = (w: Disk): Board => {
  const shared = Object.entries(w.files).find(([p]) => p.includes('/flow-board/parcours/'))?.[1]
  return (shared ? JSON.parse(shared) : w.mem['board:']) as Board
}
const ticketFile = (status: string) => `# 09: Titres\n\n**Status:** ${status}\n`
const at = (folder: string, name: string) => `${ROOT}/travail/${folder}/issues/${name}`

/** Les bloqueurs de l'essai, un par forme du tableau du ticket, chacun son id et son ticket nommé. */
const FORMS: [string, string][] = [
  ['x-fait', 'fait/9'],
  ['x-encours', 'encours/1'],
  ['x-absent', 'absent/1'],
  ['x-vide', 'vide/1'],
  ['x-lien', 'lien/1'],
  ['x-dehors', 'dehors/1'],
  ['x-double', 'double/1'],
  ['x-casse', 'casse/1'],
  ['x-fuite', 'fuite/1'],
  ['x-gros', 'gros/1'],
  ['x-bouge', 'bouge/1'],
  ['x-bascule', 'bascule/1'],
  ['x-horsforme', '../etc/1'],
]

test('relecture par le mod : « fait » lève au passage de 5 s ; autre statut, fichier absent, lien, dossier hors de la racine, doublon, lecture qui lève : à faire, et la réponse le dit ; hors forme, rien n’est lu', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.files[at('fait', '09-titres.md')] = ticketFile('fait')
  w.files[at('encours', '01-x.md')] = ticketFile('en cours')
  w.files[at('vide', 'README.md')] = 'x'
  w.files[at('lien', '01-x.md')] = ticketFile('fait')
  w.kinds[at('lien', '01-x.md')] = 'other'
  w.files[at('dehors', '01-x.md')] = ticketFile('fait')
  w.real[`${ROOT}/travail/dehors/issues`] = '/ailleurs/travail/dehors/issues'
  w.files[at('double', '01-a.md')] = ticketFile('fait')
  w.files[at('double', '001-b.md')] = ticketFile('fait')
  w.files[at('casse', '01-x.md')] = ticketFile('fait')
  w.failRead.add(at('casse', '01-x.md'))
  // Une entrée listée comme un fichier qui se résout hors du dossier (un lien posé entre la liste et la lecture).
  w.files[at('fuite', '01-x.md')] = ticketFile('fait')
  w.real[at('fuite', '01-x.md')] = '/ailleurs/01-x.md'
  w.files[at('gros', '01-x.md')] = ticketFile('fait')
  w.sizes[at('gros', '01-x.md')] = 300_000
  w.files[at('bouge', '01-x.md')] = ticketFile('fait')
  w.bump.add(at('bouge', '01-x.md'))
  w.files[at('bascule', '01-x.md')] = ticketFile('fait')
  w.swap[at('bascule', '01-x.md')] = '/ailleurs/secret.md'
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  const lot = { ...LOT, tickets: [LOT.tickets[0]!, { ...LOT.tickets[1]!, blockedBy: FORMS.map(([id]) => id) }] }
  const said = String(((await $.tool.call({ tool: TOOL, title: 'Boutique', ...lot, externals: FORMS.map(([id, ticket]) => ({ id, name: id, kind: 'task', ticket })) } as any)) as any).result)
  expect(said).toContain('"fait/9": its file says done, lifted within 5 s')
  expect(said).toContain('"encours/1": its Status line reads doing, still to do')
  expect(said).toContain('"absent/1": no file travail/absent/issues/1-*.md under the project root, still to do')
  expect(said).toContain('"vide/1": no file travail/vide/issues/1-*.md')
  expect(said).toContain('"lien/1": travail/lien/issues/1-*.md is not a plain file under the project root')
  expect(said).toContain('"dehors/1": travail/dehors/issues/1-*.md is not a plain file under the project root')
  expect(said).toContain('"double/1": several files match')
  expect(said).toContain('"casse/1": travail/casse/issues/1-*.md could not be read now')
  expect(said).toContain('"fuite/1": travail/fuite/issues/1-*.md is not a plain file under the project root')
  expect(said).toContain('"gros/1": travail/gros/issues/1-*.md is over 256 KiB, never read, still to do; send "status": "done" when it is')
  expect(said).toContain('"bouge/1": travail/bouge/issues/1-*.md could not be read now')
  expect(said).toContain('"bascule/1": travail/bascule/issues/1-*.md could not be read now')
  expect(said).toContain('"x-horsforme": "ticket" not recorded, it must be "<folder>/<number>"')
  // Le passage de 5 s du mod : seul le ticket « fait » lève son bloqueur, daté et journalisé.
  await settle(clock, 12)
  const run = savedOf(w).runs[0]!
  const statusOf = (id: string) => run.externals!.find(x => x.id === id)!.status
  expect(statusOf('x-fait')).toBe('done')
  expect(run.externals!.find(x => x.id === 'x-fait')).toMatchObject({ isFileSpent: true, ticket: 'fait/9' })
  expect(run.log.some(l => l.text === 'Dépendance externe levée : x-fait')).toBe(true)
  for (const [id] of FORMS.slice(1)) expect(statusOf(id)).toBe('todo')
  // Le ticket bloqué attend encore les autres ; aucune lecture n'est sortie de travail/<dossier>/issues (ni par un chemin
  // résolu ailleurs), rien de hors forme n'a été lu ; le fichier qui fuit n'a jamais été lu.
  const project = w.calls.filter(c => / \/proj(\/|$)/.test(c) || c.includes('/ailleurs'))
  expect(w.calls.filter(c => c.includes('..') || c.includes('/ailleurs'))).toEqual([])
  expect(project.every(c => /^(stat|list|read) \/proj(\/travail\/[A-Za-z0-9-]+\/issues(\/[^/]+)?)?$/.test(c))).toBe(true)
  expect(project).not.toContain(`read ${at('fuite', '01-x.md')}`)
  // Un ticket refusé (l'id du bloqueur est celui d'un ticket du lot) n'est pas lu, même en forme et présent.
  w.files[at('refuse', '01-x.md')] = ticketFile('fait')
  const refused = String(((await $.tool.call({ tool: TOOL, externals: [{ id: 'a1', ticket: 'refuse/1' }] } as any)) as any).result)
  expect(refused).toContain('"a1": "ticket" not recorded, this id is also a ticket of this lot')
  expect(refused).not.toContain('Named tickets')
  expect(w.calls.filter(c => c.includes('/travail/refuse'))).toEqual([])
  // Le fichier « fait » repasse « à faire » : le bloqueur levé le reste.
  w.files[at('fait', '09-titres.md')] = ticketFile('à faire')
  await settle(clock, 12)
  expect(savedOf(w).runs[0]!.externals!.find(x => x.id === 'x-fait')!.status).toBe('done')
  // Un autre fichier passe « fait » : levé au passage suivant.
  w.files[at('encours', '01-x.md')] = ticketFile('fait')
  await settle(clock, 12)
  expect(savedOf(w).runs[0]!.externals!.find(x => x.id === 'x-encours')!.status).toBe('done')
})

test('relecture par le mod : un fichier qui bloque la lecture (un tube) ne retient ni l’outil ni le passage de 5 s, et ne lève rien', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.files[at('pend', '01-x.md')] = ticketFile('fait')
  w.hang.add(at('pend', '01-x.md'))
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  const lot = { ...LOT, tickets: [LOT.tickets[0]!, { ...LOT.tickets[1]!, blockedBy: ['x-pend'] }] }
  const calling = $.tool.call({ tool: TOOL, title: 'Boutique', ...lot, externals: [{ id: 'x-pend', name: 'x-pend', kind: 'task', ticket: 'pend/1' }] } as any)
  await settle(clock, 5)
  // La relecture n'a pas rendu la main : la réponse ne promet pas de relecture toutes les 5 s.
  expect(String(((await calling) as any).result)).toContain('"pend/1": travail/pend/issues/1-*.md could not be read: an earlier read of a ticket file has not returned')
  await settle(clock, 12)
  expect(savedOf(w).runs[0]!.externals!.find(x => x.id === 'x-pend')!.status).toBe('todo')
  // Une seule relecture à la fois : la bloquée n'en fait pas partir d'autres à chaque passage.
  expect(w.calls.filter(c => c === `read ${at('pend', '01-x.md')}`)).toHaveLength(1)
})

// ─── La levée ─────────────────────────────────────────────────────────────

test('« fait » lève le bloqueur comme un envoi "status": "done" : daté, journalisé, marqué ; le ticket bloqué se libère', () => {
  const b = boardWith()
  expect(liftableTickets(b)).toEqual([NAMED])
  const out = liftByTickets(b, runIdOf(b), done, T0 + 5)!
  expect(one(out.board)).toMatchObject({ status: 'done', statusAt: T0 + 5, isFileSpent: true, ticket: NAMED })
  expect(activeRun(out.board)!.log.some(l => l.text === 'Dépendance externe levée : Ticket 09 de « Titres stables »')).toBe(true)
  expect(activeRun(out.board)!.updatedAt).toBe(T0 + 5)
  expect(liftableTickets(out.board)).toEqual([])
  // Un statut lu autre que « fait », ou rien de lu : rien ne change.
  expect(liftByTickets(b, runIdOf(b), [{ ticket: NAMED, state: 'open', status: 'doing' }], T0 + 5)).toBeNull()
  expect(liftByTickets(b, runIdOf(b), [{ ticket: NAMED, state: 'missing' }], T0 + 5)).toBeNull()
  // Revérifié sur le board à l'instant d'écrire : une autre mission active, un worker, un bloqueur déjà levé.
  expect(liftByTickets(b, 'autre-mission', done, T0 + 5)).toBeNull()
  expect(liftByTickets({ ...b, delegate: { run: runIdOf(b), at: T0 } }, runIdOf(b), done, T0 + 5)).toBeNull()
  expect(liftByTickets(out.board, runIdOf(b), done, T0 + 6)).toBeNull()
})

test('levé, puis le fichier repasse « à faire » : le bloqueur reste levé (le fichier n’est plus relu pour lui)', () => {
  const b0 = boardWith()
  const lifted = liftByTickets(b0, runIdOf(b0), done, T0 + 5)!.board
  expect(liftableTickets(lifted)).toEqual([])
  expect(liftByTickets(lifted, runIdOf(lifted), [{ ticket: NAMED, state: 'open', status: 'todo' }], T0 + 6)).toBeNull()
  expect(one(lifted)!.status).toBe('done')
})

test('un « todo » explicite après la levée tient : le fichier qui dit encore « fait » ne le relève jamais, même daté dans le futur puis relu', () => {
  const b0 = boardWith()
  const lifted = liftByTickets(b0, runIdOf(b0), done, T0 + 5)!.board
  const reopened = applyReport(lifted, { externals: [{ id: ID, status: 'todo' }] }, T0 + 6).board
  expect(one(reopened)).toMatchObject({ status: 'todo', isFileSpent: true })
  expect(liftByTickets(reopened, runIdOf(reopened), done, T0 + 7)).toBeNull()
  // Le « todo » daté au-delà de la tolérance perd sa date à la lecture : la marque reste.
  const future: Board = { ...reopened, runs: [{ ...activeRun(reopened)!, externals: [{ ...one(reopened)!, statusAt: T0 + 86_400_000 }] }] }
  const read = clampFuture(future, T0 + 10)
  expect(one(read)!.statusAt).toBeUndefined()
  expect(isFileLiftable(one(read))).toBe(false)
  expect(liftByTickets(read, runIdOf(read), done, T0 + 11)).toBeNull()
  // Un envoi "done" le lève toujours.
  expect(one(applyReport(read, { externals: [{ id: ID, status: 'done' }] }, T0 + 12).board)!.status).toBe('done')
})

test('une tâche Asana décochée rouvre et marque aussi : le fichier ne la défait pas', () => {
  const gid = '1200000000000009'
  let b = boardWith([{ id: gid, name: 'Tâche et ticket', ticket: NAMED, status: 'done' }])
  b = applyAsana(b, [{ task: gid, completed: false }], T0 + 3)!.board
  expect(one(b, gid)).toMatchObject({ status: 'todo', isFileSpent: true })
  expect(liftByTickets(b, runIdOf(b), done, T0 + 4)).toBeNull()
})

// ─── La fusion ────────────────────────────────────────────────────────────

const copyWith = (base: Board, updatedAt: number, externals: ExternalBlocker[]): Board => ({ ...base, runs: [{ ...activeRun(base)!, updatedAt, externals }] })
const blocker = (over: Partial<ExternalBlocker>): ExternalBlocker => ({ id: ID, name: 'Ticket 09', status: 'todo', isDecision: false, ...over })

test('fusion : deux copies nomment deux tickets pour le même bloqueur, le premier noté reste, dans les deux ordres', () => {
  const base = boardWith()
  const first = blocker({ ticket: NAMED, ticketAt: T0 + 2 })
  const second = blocker({ ticket: 'autre/3', ticketAt: T0 + 4 })
  for (const [a, b] of [
    [copyWith(base, T0 + 10, [first]), copyWith(base, T0 + 9, [second])],
    [copyWith(base, T0 + 10, [second]), copyWith(base, T0 + 9, [first])],
  ] as const) {
    expect(mergeBoards(a, b).runs[0]!.externals![0]).toMatchObject({ ticket: NAMED, ticketAt: T0 + 2 })
  }
  // Sans date d'un côté : la date lisible l'emporte ; à égalité, le plus petit dans l'ordre du texte, dans les deux ordres.
  const { ticketAt: _, ...undatedSecond } = second
  expect(mergeBoards(copyWith(base, T0 + 10, [undatedSecond]), copyWith(base, T0 + 9, [first])).runs[0]!.externals![0]!.ticket).toBe(NAMED)
  const tieA = blocker({ ticket: 'b/1', ticketAt: T0 + 2 })
  const tieB = blocker({ ticket: 'a/1', ticketAt: T0 + 2 })
  expect(mergeBoards(copyWith(base, T0 + 10, [tieA]), copyWith(base, T0 + 9, [tieB])).runs[0]!.externals![0]!.ticket).toBe('a/1')
  expect(mergeBoards(copyWith(base, T0 + 10, [tieB]), copyWith(base, T0 + 9, [tieA])).runs[0]!.externals![0]!.ticket).toBe('a/1')
})

test('fusion : un ticket absent de la copie gardée revient de l’autre ; la marque est unie ; un ticket hors forme cède ; le statut suit sa règle', () => {
  const base = boardWith()
  const named = blocker({ ticket: NAMED, ticketAt: T0 + 2 })
  const plain = blocker({ status: 'done', statusAt: T0 + 5 })
  const merged = mergeBoards(copyWith(base, T0 + 10, [plain]), copyWith(base, T0 + 9, [named])).runs[0]!.externals![0]!
  expect(merged).toMatchObject({ status: 'done', statusAt: T0 + 5, ticket: NAMED, ticketAt: T0 + 2 })
  const spent = blocker({ ticket: NAMED, ticketAt: T0 + 2, isFileSpent: true, statusAt: T0 + 6 })
  expect(mergeBoards(copyWith(base, T0 + 10, [named]), copyWith(base, T0 + 9, [spent])).runs[0]!.externals![0]!.isFileSpent).toBe(true)
  expect(mergeBoards(copyWith(base, T0 + 10, [spent]), copyWith(base, T0 + 9, [named])).runs[0]!.externals![0]!.isFileSpent).toBe(true)
  const odd = blocker({ ticket: '../x/1' as string, ticketAt: T0 + 1 })
  expect(mergeBoards(copyWith(base, T0 + 10, [odd]), copyWith(base, T0 + 9, [named])).runs[0]!.externals![0]).toMatchObject({ ticket: NAMED, ticketAt: T0 + 2 })
  // Un ticket hors forme de l'autre copie ne remplace jamais celui d'ici.
  expect(mergeBoards(copyWith(base, T0 + 10, [named]), copyWith(base, T0 + 9, [odd])).runs[0]!.externals![0]!.ticket).toBe(NAMED)
})

test('une date de notation au-delà de la tolérance est retirée à la lecture : elle ne gagne aucune fusion', () => {
  const base = boardWith()
  const future = blocker({ ticket: 'autre/3', ticketAt: T0 + 86_400_000 })
  const read = clampFuture(copyWith(base, T0 + 9, [future]), T0 + 10)
  expect(one(read)).toEqual(blocker({ ticket: 'autre/3' }))
  const named = blocker({ ticket: NAMED, ticketAt: T0 + 2 })
  expect(mergeBoards(read, copyWith(base, T0 + 8, [named])).runs[0]!.externals![0]!.ticket).toBe(NAMED)
})

// ─── La réponse et les consignes ──────────────────────────────────────────

test('la réponse dit, pour chaque ticket nommé envoyé, ce que sa relecture a trouvé', () => {
  const run = activeRun(boardWith())!
  expect(ticketReadsText(run, [NAMED], [{ ticket: NAMED, state: 'missing' }])).toBe(` · Named tickets: "${NAMED}": no file travail/titres-stables/issues/09-*.md under the project root, still to do; check the folder and number.`)
  expect(ticketReadsText(run, [NAMED], [{ ticket: NAMED, state: 'open', status: 'doing' }])).toContain('its Status line reads doing, still to do')
  expect(ticketReadsText(run, [NAMED], [{ ticket: NAMED, state: 'unreadable' }])).toContain('could not be read now')
  expect(ticketReadsText(run, [NAMED], [])).toContain('could not be read now')
  // Une relecture d'avant qui n'a pas rendu la main : aucune ne repart, la réponse ne promet pas de relecture.
  expect(ticketReadsText(run, [NAMED], [], true)).toContain('an earlier read of a ticket file has not returned')
  expect(ticketReadsText(run, [NAMED], [], true)).not.toContain('reads it again every 5 s')
  expect(ticketReadsText(run, [], [])).toBe('')
})

test('le schéma de l’outil et la consigne du découpage disent le ticket nommé', async ($, on) => {
  const items = (TOOL_SCHEMA as any).properties.externals.items.properties
  expect(items.ticket).toEqual({ type: 'string' })
  mock.clock(on, { now: T0 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  expect(note.text).toContain('A ticket of another mission is named by "ticket": "<folder>/<number>"')
})
