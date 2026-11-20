// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { activeRun, LIMITS } from '../hooks/basics.ts'
import { launchKey, type LaunchRecord } from '../hooks/launch.ts'
import { applyReport, applySkill, dropRun, emptyBoard, newRun } from '../hooks/model.ts'
import { claimName, discussionNamedKey, isCardTitle, markNamed, shellSafeTitle } from '../hooks/named-mark.ts'
import { discussionTitleKey } from '../hooks/register.tsx'
import type { Board, Run } from '../types'
import { TOOL, settle, start, world, writeBoard } from './monde-coordination.ts'

// Une discussion que flow-board a nommée ne l'est jamais une seconde fois : ni par une nouvelle mission née chez elle
// après la suppression ou l'élagage de la première, ni par le premier titre d'un manager lancé par une carte du COO.
// Invariant : « Une discussion que flow-board a nommée n'est jamais renommée par flow-board, et la marque qui le
// retient n'est jamais effacée ni réécrite avec un autre titre par flow-board. »

const NAME = (title: string) => `name this discussion "${title}"`
const KEEPS = 'this discussion keeps its name'
const MARK_A = discussionNamedKey('session-A')

// ─── Le modèle : la marque lue par le mod passe par `isNamed` ─────────────

const boardOf = (runs: Run[]): Board => ({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs, activeId: null })

/** Une mission née ici, titrée (la discussion a pris son nom), puis close. */
const namedHere = (now: number, title = 'Premier'): Run => ({ ...newRun('implement', now, title), status: 'done', finishedAt: now + 1, bornIn: 's', isTitled: true })

test('une mission nommée puis supprimée : la mission suivante née ici garde le nom de la discussion quand elle est marquée', () => {
  const first = namedHere(1_000)
  const dropped = dropRun(boardOf([first]), first.id, 2_000)!.board
  expect(dropped.runs).toEqual([])
  // Sans la marque, la discussion libérée serait renommée : le trou que la marque ferme.
  expect(applyReport(dropped, { open: { title: 'Second' } }, 3_000).fx.discussionTitle).toBe('Second')
  const out = applyReport(dropped, { open: { title: 'Second' } }, 3_000, { isNamed: true })
  expect(activeRun(out.board)!.title).toBe('Second')
  expect(out.text).toContain(KEEPS)
  expect(out.fx.discussionTitle).toBeUndefined()
  // Même chemin par un premier `title` d'une mission ouverte par un skill.
  const opened = applySkill(dropped, 'mattpocock-skills:to-spec', { now: 3_000, isMain: true })!.board
  const titled = applyReport(opened, { title: 'Second' }, 4_000, { isNamed: true })
  expect(titled.text).toContain(KEEPS)
  expect(titled.fx.discussionTitle).toBeUndefined()
})

test('une mission nommée puis élaguée : la mission suivante née ici garde le nom de la discussion quand elle est marquée', () => {
  // La mission née ici est la plus ancienne des closes : la suivante, ouverte ici, la fait élaguer.
  const old = namedHere(1_000)
  const others = Array.from({ length: LIMITS.runs }, (_, i) => ({ ...newRun('implement', 2_000 + i, `Autre ${i}`), status: 'done' as const, finishedAt: 3_000 + i, bornIn: 'ailleurs', isTitled: true }))
  const board = boardOf([old, ...others])
  const bare = applyReport(board, { open: { title: 'Second' } }, 10_000)
  expect(bare.board.runs.some(r => r.id === old.id)).toBe(false)
  expect(bare.fx.discussionTitle).toBe('Second')
  const out = applyReport(board, { open: { title: 'Second' } }, 10_000, { isNamed: true })
  expect(out.board.runs.some(r => r.id === old.id)).toBe(false)
  expect(out.text).toContain(KEEPS)
  expect(out.fx.discussionTitle).toBeUndefined()
})

test('le titre de la carte se reconnaît tel quel, tel que l’app et le terminal l’ont reçu ; un autre titre, ou aucun, non', () => {
  const card = 'Export « CSV » de l’équipe'
  expect(isCardTitle(card, card)).toBe(true)
  expect(isCardTitle(shellSafeTitle(card), card)).toBe(true)
  expect(isCardTitle('Autre titre', card)).toBe(false)
  expect(isCardTitle(undefined, card)).toBe(false)
  expect(isCardTitle('  ', card)).toBe(false)
})

test('deux poses de la marque en même temps dans un processus : la première l’écrit, la seconde ne la réécrit pas', async () => {
  const mem: Record<string, unknown> = {}
  const tick = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  // Un magasin lent : sans file, les deux poses liraient la clé absente avant que l'une n'écrive.
  const fake = { store: { get: async (key: string) => (await tick(), mem[key]), set: async (key: string, value: unknown) => { await tick(); mem[key] = value } } }
  await Promise.all([markNamed(fake, 'session-Z', 'Premier', 1), markNamed(fake, 'session-Z', 'Second', 2)])
  expect(mem[discussionNamedKey('session-Z')]).toEqual({ title: 'Premier', at: 1 })
})

test('le nom décidé se revérifie dans la file : une marque posée juste avant par un autre chemin l’emporte, le même titre passe', async () => {
  const mem: Record<string, unknown> = {}
  const tick = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  const fake = { store: { get: async (key: string) => (await tick(), mem[key]), set: async (key: string, value: unknown) => { await tick(); mem[key] = value } } }
  // Deux appels parallèles : le lancement pose le titre de la carte, puis le titre de l'autre appel voudrait nommer.
  const [, claimed] = await Promise.all([markNamed(fake, 'session-Y', 'Titre de la carte', 1), claimName(fake, 'session-Y', 'Autre titre', 2)])
  expect(claimed).toBe(false)
  expect(mem[discussionNamedKey('session-Y')]).toEqual({ title: 'Titre de la carte', at: 1 })
  // La marque déjà posée au même titre (le chargement, avant la file) : le même nom, jamais un autre.
  expect(await claimName(fake, 'session-Y', 'Titre de la carte', 3)).toBe(true)
  expect(await claimName(fake, 'session-X', 'Neuf', 4)).toBe(true)
  expect(mem[discussionNamedKey('session-X')]).toEqual({ title: 'Neuf', at: 4 })
})

test('un titre hors forme ne bloque pas la file des poses, et la pose ne lève jamais', async () => {
  const mem: Record<string, unknown> = {}
  const fake = { store: { get: async (key: string) => mem[key], set: async (key: string, value: unknown) => void (mem[key] = value) } }
  await markNamed(fake, 'session-W', 42 as any, 1)
  expect(await claimName(fake, 'session-W', { x: 1 } as any, 2)).toBe(false)
  expect(mem[discussionNamedKey('session-W')]).toBeUndefined()
  await markNamed(fake, 'session-W', 'Bon titre', 3)
  expect(mem[discussionNamedKey('session-W')]).toEqual({ title: 'Bon titre', at: 3 })
  const broken = { store: { get: async () => { throw new Error('x') }, set: async () => undefined } }
  expect(await claimName(broken, 'session-V', 'T', 5)).toBe(false)
})

// ─── Le mod : la marque écrite, lue, jamais réécrite ──────────────────────

const prompt = ($: any, session_title?: string) =>
  $.classic.UserPromptSubmit({ session_id: 'session-A', transcript_path: '/t/session-A.jsonl', cwd: '/p', hook_event_name: 'UserPromptSubmit', prompt: 'x', ...(session_title ? { session_title } : {}) })

/** Une discussion neuve qui ouvre sa mission par un skill. */
const opened = async ($: any, on: any, now: number) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  on('classic.UserPromptSubmit', () => ({}))
  return { clock, w }
}

const firstTitle = async ($: any, clock: any, title = 'Export CSV'): Promise<string> => {
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  const call = $.tool.call({ tool: TOOL, title } as any)
  await settle(clock, 1)
  return String(((await call) as any).result)
}

test('le premier titre nomme la discussion et pose la marque (titre, date) ; fix.title ensuite ne la réécrit pas', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await opened($, on, 400_000_000)
  await start($)
  expect(await firstTitle($, clock)).toContain(NAME('Export CSV'))
  expect(w.mem[MARK_A]).toEqual({ title: 'Export CSV', at: expect.any(Number) })
  const mark = JSON.stringify(w.mem[MARK_A])
  await $.tool.call({ tool: TOOL, fix: { title: 'Export CSV corrigé' } } as any)
  await settle(clock, 1)
  expect(JSON.stringify(w.mem[MARK_A])).toBe(mark)
})

test('une marque déjà là : le premier titre d’une nouvelle mission garde le nom, rien n’attend, la marque ne change pas', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await opened($, on, 401_000_000)
  w.mem[MARK_A] = { title: 'Ancien nom', at: 1 }
  await start($)
  expect(await firstTitle($, clock)).toContain(KEEPS)
  expect(w.mem[discussionTitleKey('session-A')]).toBeUndefined()
  expect((await prompt($, 'Ancien nom')).sessionTitle).toBeUndefined()
  expect(w.mem[MARK_A]).toEqual({ title: 'Ancien nom', at: 1 })
})

test('une marque hors forme : la discussion garde son nom, et la marque ne change pas', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await opened($, on, 402_000_000)
  w.mem[MARK_A] = 42
  await start($)
  expect(await firstTitle($, clock)).toContain(KEEPS)
  expect(w.mem[MARK_A]).toBe(42)
})

test('une lecture de la marque qui lève, sur une discussion neuve : la discussion garde son nom, et rien n’est écrit', { timeoutMs: 20000 }, async ($, on) => {
  // La même discussion neuve sans la sonde nommerait la discussion (premier test) : seule la lecture ratée l'en empêche.
  const { clock, w } = await opened($, on, 402_500_000)
  w.probe.refuseRead = key => key.startsWith('discussion-named:')
  await start($)
  expect(await firstTitle($, clock)).toContain(KEEPS)
  expect(w.mem[MARK_A]).toBeUndefined()
  expect(w.mem[discussionTitleKey('session-A')]).toBeUndefined()
})

test('une écriture de la marque qui échoue ne fait échouer ni l’appel ni le titre en attente', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await opened($, on, 403_000_000)
  w.probe.refuseStore = key => key.startsWith('discussion-named:')
  await start($)
  expect(await firstTitle($, clock)).toContain(NAME('Export CSV'))
  expect(w.mem[MARK_A]).toBeUndefined()
  expect(await prompt($, 'Session neuve')).toMatchObject({ sessionTitle: 'Export CSV' })
})

test('au chargement, une mission titrée née ici pose la marque si elle manque ; une marque déjà là n’est pas réécrite', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await opened($, on, 404_000_000)
  writeBoard(w, b => ({ ...b, runs: [{ ...newRun('implement', 403_000_000, 'Mission d’hier'), status: 'paused', bornIn: 'session-A', isTitled: true }] }))
  await start($)
  await settle(clock, 6)
  expect(w.mem[MARK_A]).toEqual({ title: 'Mission d’hier', at: expect.any(Number) })
})

test('au chargement, une marque déjà là ne change pas', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await opened($, on, 405_000_000)
  w.mem[MARK_A] = { title: 'Premier nom', at: 7 }
  writeBoard(w, b => ({ ...b, runs: [{ ...newRun('implement', 404_000_000, 'Mission d’hier'), status: 'paused', bornIn: 'session-A', isTitled: true }] }))
  await start($)
  await settle(clock, 6)
  expect(w.mem[MARK_A]).toEqual({ title: 'Premier nom', at: 7 })
})

// ─── Le lancement par une carte : consommé avant que le titre décide ──────

const record = (over: Partial<LaunchRecord> = {}): LaunchRecord => ({ v: 1, id: 'labcdefgh12', card: 'kabcdef12', root: '', title: 'Export CSV des tickets', start: 'grill-with-docs', mode: 'manual', effort: 'high', folder: 'export-csv', at: 0, by: 'session-COO', ...over })

/** Une discussion lancée par une carte : le lancement est au stockage, la discussion porte (ou non) un titre relevé. */
const launched = async ($: any, on: any, now: number, seen?: string) => {
  const { clock, w } = await opened($, on, now)
  const r = record({ at: now - 30_000 })
  w.mem[launchKey(r.id)] = r
  await start($)
  if (seen !== undefined) await prompt($, seen)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  const call = $.tool.call({ tool: TOOL, launch: r.id, title: 'Export CSV' } as any)
  await settle(clock, 3)
  return { w, text: String(((await call) as any).result) }
}

test('launch et title dans un appel, la discussion porte déjà le titre de la carte : marque posée avec ce titre, la mission seule prend le titre', { timeoutMs: 20000 }, async ($, on) => {
  const { w, text } = await launched($, on, 410_000_000, 'Export CSV des tickets')
  expect(text).toMatch(/Launch: consumed/)
  expect(text).toContain(KEEPS)
  expect(text).not.toContain('name this discussion')
  expect(w.mem[MARK_A]).toEqual({ title: 'Export CSV des tickets', at: expect.any(Number) })
  expect(w.mem[discussionTitleKey('session-A')]).toBeUndefined()
})

test('launch et title, titre relevé différent : pas de marque au rattachement, le premier titre nomme la discussion, une fois', { timeoutMs: 20000 }, async ($, on) => {
  const { w, text } = await launched($, on, 411_000_000, 'Un autre nom')
  expect(text).toMatch(/Launch: consumed/)
  expect(text).toContain(NAME('Export CSV'))
  expect(w.mem[MARK_A]).toEqual({ title: 'Export CSV', at: expect.any(Number) })
})

test('launch avec open dans le même appel, une mission déjà active ici : la carte va à la mission ouverte, comme avant', { timeoutMs: 20000 }, async ($, on) => {
  const now = 413_000_000
  const { clock, w } = await opened($, on, now)
  const r = record({ at: now - 30_000 })
  w.mem[launchKey(r.id)] = r
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  const call = $.tool.call({ tool: TOOL, launch: r.id, open: { title: 'Mission B' } } as any)
  await settle(clock, 3)
  expect(String(((await call) as any).result)).toMatch(/Launch: consumed/)
  const board = (w.disk.isUsed && w.disk.board !== undefined ? JSON.parse(w.disk.board) : w.mem['board:']) as Board
  expect(board.runs.find(x => x.title === 'Mission B')?.launch?.id).toBe(r.id)
  expect(board.runs.filter(x => x.title !== 'Mission B').every(x => x.launch === undefined)).toBe(true)
})

test('launch refusé (mission ouverte avant le clic) avec title, la discussion porte déjà le titre de la carte : elle garde son nom quand même', { timeoutMs: 20000 }, async ($, on) => {
  const now = 414_000_000
  const { clock, w } = await opened($, on, now)
  // La mission s'ouvre avant le clic : le rattachement refuse (« older »), rien n'est consommé.
  const r = record({ at: now + 1_000 })
  w.mem[launchKey(r.id)] = r
  await start($)
  await prompt($, 'Export CSV des tickets')
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await clock.advance(2_000)
  const call = $.tool.call({ tool: TOOL, launch: r.id, title: 'Export CSV' } as any)
  await settle(clock, 3)
  const text = String(((await call) as any).result)
  expect(text).toMatch(/opened before the click/)
  expect(text).toContain(KEEPS)
  expect(w.mem[MARK_A]).toEqual({ title: 'Export CSV des tickets', at: expect.any(Number) })
})

test('launch avec open, aucune mission ouverte ici, la discussion porte déjà le titre de la carte : l’ouverture ne la renomme pas', { timeoutMs: 20000 }, async ($, on) => {
  const now = 415_000_000
  const { clock, w } = await opened($, on, now)
  const r = record({ at: now - 30_000 })
  w.mem[launchKey(r.id)] = r
  await start($)
  await prompt($, 'Export CSV des tickets')
  const call = $.tool.call({ tool: TOOL, launch: r.id, open: { title: 'Export CSV' } } as any)
  await settle(clock, 3)
  const text = String(((await call) as any).result)
  expect(text).toMatch(/Launch: consumed/)
  expect(text).toContain(KEEPS)
  expect(w.mem[MARK_A]).toEqual({ title: 'Export CSV des tickets', at: expect.any(Number) })
  expect(w.mem[discussionTitleKey('session-A')]).toBeUndefined()
})

test('launch et title, titre relevé inconnu : le premier titre nomme la discussion, une fois', { timeoutMs: 20000 }, async ($, on) => {
  const { w, text } = await launched($, on, 412_000_000)
  expect(text).toMatch(/Launch: consumed/)
  expect(text).toContain(NAME('Export CSV'))
  expect(w.mem[MARK_A]).toEqual({ title: 'Export CSV', at: expect.any(Number) })
})

test('resume et title : le titre vise la mission reprise, encore sans titre, et nomme la discussion, une fois', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await opened($, on, 416_000_000)
  const here = { ...newRun('implement', 415_000_000), status: 'paused' as const, bornIn: 'session-A' }
  const other = { ...newRun('implement', 415_500_000, 'Mission d’ailleurs'), bornIn: 'session-B', isTitled: true }
  writeBoard(w, b => ({ ...b, runs: [other, here], activeId: other.id }))
  await start($)
  const call = $.tool.call({ tool: TOOL, resume: here.id, title: 'Reprise titrée' } as any)
  await settle(clock, 2)
  expect(String(((await call) as any).result)).toContain(NAME('Reprise titrée'))
  expect(w.mem[MARK_A]).toEqual({ title: 'Reprise titrée', at: expect.any(Number) })
})

test('le nom refusé au moment de l’écrire (la marque relue dans la file lève) : la réponse ne demande pas de renommer, rien n’attend', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await opened($, on, 417_000_000)
  // La première lecture (la décision) passe, la seconde (dans la file, à l'écriture) lève : comme une marque posée entre-temps.
  let reads = 0
  w.probe.refuseRead = key => key.startsWith('discussion-named:') && ++reads === 2
  await start($)
  const text = await firstTitle($, clock)
  expect(reads).toBe(2)
  expect(text).toContain(KEEPS)
  expect(text).not.toContain('name this discussion')
  expect(w.mem[discussionTitleKey('session-A')]).toBeUndefined()
})
