import { expect, mock, test } from 'claude-code/testing'

import { cooStatement, outsideCommitCounts, parseLoggedCommits, statementText, watchedGroups } from '../hooks/coo.ts'
import { groupWorktree } from '../hooks/closing.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { stepUsage, stoppedStep } from './flux-turn-step.ts'
import type { Board, Run } from '../types'

// Rétro « Coordinateur de parcours » : un diagnostic et une étude hors mission avaient commité dans la
// branche de travail sur des fichiers des groupes en cours, et la coordination ne l'avait appris que par
// message. Le COO compte, par groupe en cours, les commits de la branche de travail faits depuis son départ
// sur ses fichiers, hors des branches des workers et des commits des managers, et le dit d'une ligne
// (décision R6 (a) : dans la vue Coordination et le relevé, sans notification).

const PLUGIN = 'flow-board'
const KEY = 'board:/p'
const COO = 'flow-board:coo'
const NOW = 120_000_000_000
const START = NOW - 3_600_000
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const SURFACES = ['terminal', 'desktop'] as const
const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')
const SHA = (n: number): string => String(n).repeat(40).slice(0, 40)

/** Une mission dont le groupe C est chez un worker depuis START : ses fichiers, ceux de ses tickets (dont des chemins hors forme). */
const mission = (log: Run['log'] = []): Run =>
  ({
    ...newRun('implement', START - 60_000, 'Durcir le relais'),
    status: 'active',
    owner: 'session-M',
    updatedAt: NOW - 1_000,
    log,
    tickets: [
      { id: '08', name: 'Neutraliser', status: 'doing', files: ['plugins/flow-board/hooks/relay.ts', 'bad path.ts', '-x', ':(glob)*', '../hors.ts', 'plugins/../x.ts'] },
      { id: '09', name: 'Autre', status: 'todo' },
    ],
    groups: [
      { id: 'C', name: 'Relais', tickets: ['08'], files: ['plugins/flow-board/hooks/model.ts', 'plugins/flow-board/tests/'], linked: { at: START } },
      { id: 'D', name: 'Rendu', tickets: ['09'], files: ['plugins/flow-board/hooks/view.tsx'] },
    ],
  }) as unknown as Run

const board = (...runs: Run[]): Board => ({ ...emptyBoard('/p', 'p'), runs, deleted: [] })

/** La sortie de `git log --format=%x1e%H%x1f%ct%x1f%P%x1f%s --name-only` pour ces commits (une fusion a deux parents). */
const logOutput = (commits: { sha: string; at: number; files: string[]; subject?: string; isMerge?: boolean }[]): string =>
  commits.map(c => `\u001e${c.sha}\u001f${Math.floor(c.at / 1000)}\u001f${c.isMerge ? `${SHA(1)} ${SHA(2)}` : SHA(3)}\u001f${c.subject ?? 'fix: x'}\n\n${c.files.join('\n')}\n`).join('')

test('seuls les groupes chez un worker sont surveillés, avec les fichiers du groupe et de ses tickets', () => {
  const groups = watchedGroups(board(mission()))
  expect(groups.map(g => [g.mission, g.group, g.since])).toEqual([['Durcir le relais', 'C', START]])
  expect(groups[0]!.paths.slice(0, 3)).toEqual(['plugins/flow-board/hooks/model.ts', 'plugins/flow-board/tests', 'plugins/flow-board/hooks/relay.ts'])
  // Une mission archivée ou close garde ses groupes encore confiés : leur worker écrit encore.
  expect(watchedGroups(board({ ...mission(), archivedAt: NOW } as Run)).map(g => g.group)).toEqual(['C'])
  expect(watchedGroups(board({ ...mission(), status: 'done' } as Run)).map(g => g.group)).toEqual(['C'])
  // Un groupe rendu (plus chez un worker) : rien.
  const back = mission()
  back.groups = back.groups!.map(g => ({ ...g, linked: undefined, delegated: { at: START } }))
  expect(watchedGroups(board(back))).toEqual([])
})

test('les commits de la branche de travail se lisent dans la sortie de git log ; un enregistrement illisible est laissé', () => {
  const out = `${logOutput([{ sha: SHA(1), at: START + 1000, files: ['a.ts', 'B/c.md', 'README.md'] }, { sha: SHA(2), at: START + 2000, files: ['d.ts'], isMerge: true }])}\u001epas-un-sha\u001f12\nz.ts\n`
  // Les fichiers déjà comparables (casse), sans les documents communs, comme les retenues.
  expect(parseLoggedCommits(out)).toEqual([
    { sha: SHA(1), at: START + 1000, files: ['a.ts', 'b/c.md'], subject: 'fix: x' },
    { sha: SHA(2), at: START + 2000, files: ['d.ts'], subject: 'fix: x', isMerge: true },
  ])
})

test('par groupe, les commits depuis son départ qui touchent ses fichiers (sous un dossier compris), hors commits des managers', () => {
  const run = mission([
    { at: START + 600_500, glyph: '⎇', text: 'Commit', tone: 'ok' },
    { at: START + 900_500, glyph: '⎇', text: 'Commit : docs: note', tone: 'ok' },
    { at: START + 1_200_000, glyph: '⎇', text: 'Branche x', tone: 'info' },
  ])
  const commits = [
    { sha: SHA(1), at: START - 1000, files: ['plugins/flow-board/hooks/model.ts'] }, // avant le départ du groupe
    { sha: SHA(2), at: START + 60_000, files: ['plugins/flow-board/tests/x.test.ts'] }, // sous un dossier du groupe
    { sha: SHA(3), at: START + 120_000, files: ['plugins/flow-board/hooks/relay.ts', 'autre.md'] }, // un fichier d'un ticket
    { sha: SHA(4), at: START + 180_000, files: ['plugins/flow-board/testsuite.ts'] }, // préfixe, pas sous le dossier
    { sha: SHA(5), at: START + 600_000, files: ['plugins/flow-board/hooks/model.ts'] }, // le commit du manager (son journal)
    { sha: SHA(6), at: START + 900_000, files: ['docs/autre.md'] }, // un autre commit du manager, hors des fichiers du groupe
    { sha: SHA(7), at: START + 870_000, files: ['plugins/flow-board/hooks/model.ts'] }, // hors mission, 30 s avant : pas excusé par lui
    { sha: SHA(8), at: START + 1_200_000, files: ['plugins/flow-board/hooks/model.ts'] }, // une ligne « Branche » n'excuse rien
  ]
  const counts = outsideCommitCounts(watchedGroups(board(run)), commits, board(run))
  expect(counts.map(c => [c.mission, c.group, c.count])).toEqual([['Durcir le relais', 'C', 4]])
})

test('le relevé du COO dit la ligne de la décision, sans rien dire quand aucun commit ne touche un groupe', () => {
  const b = board(mission())
  const outside = [{ missionId: b.runs[0]!.id, mission: 'Durcir le relais', group: 'C', count: 2 }]
  const text = statementText(cooStatement(b, { now: NOW, outside }))
  expect(text).toContain('⚠ main a reçu 2 commit(s) hors mission sur des fichiers du groupe C de « Durcir le relais »')
  expect(statementText(cooStatement(b, { now: NOW, outside: [] }))).not.toContain('hors mission sur des fichiers')
  expect(statementText(cooStatement(b, { now: NOW }))).not.toContain('hors mission sur des fichiers')
})

// ─── Dans le COO : la commande git, la vue et le relevé ──────────────────────

type Git = { args: string[]; cwd: string }

const world = (on: any, answer: (args: string[]) => { exitCode: number; stdout: string }, run: Run = mission()) => {
  const mem: Record<string, unknown> = {}
  const disk: { board?: string } = {}
  const sent: { text: string; context?: readonly string[] }[] = []
  const calls: Git[] = []
  on('session.end', () => ({ sessionId: 'session-A' }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    sent.push(e)
    return { text: e.text }
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.root', () => ({ value: '/p' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isBoardFile(e.path) && disk.board !== undefined }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!isBoardFile(e.path) || disk.board === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: disk.board } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBoardFile(e.path)) disk.board = e.text
    return { value: undefined } as any
  })
  on('process.run', (_$: unknown, e: { argv: readonly string[]; init?: { cwd?: string } }) => {
    const argv = [...e.argv]
    calls.push({ args: argv, cwd: e.init?.cwd ?? '' })
    return { value: { ...answer(argv), stderr: '' } } as any
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('turn.step', stoppedStep(stepUsage('claude-opus-5-5')))
  const b = board(run)
  mem[KEY] = b
  disk.board = JSON.stringify(b)
  return { sent, calls }
}

const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}

/** La branche du worker du groupe C, telle que git la liste. */
const BRANCH = `refs/heads/worktree-${groupWorktree(mission(), 'C')}`

/** Les réponses de git : `log` pour la première lignée, `refs` pour les branches, `own` pour les commits de la branche du worker. */
const gitAnswer =
  (log: { exitCode: number; stdout: string }, opts: { refs?: string; own?: string[] } = {}) =>
  (args: string[]): { exitCode: number; stdout: string } => {
    if (args.includes('log') && args.includes('--first-parent')) return log
    if (args.includes('rev-parse') && args.includes('HEAD')) return { exitCode: 0, stdout: SHA(9) }
    if (args.includes('for-each-ref')) return { exitCode: 0, stdout: opts.refs ?? `refs/heads/main\u001f${SHA(9)}` }
    if (args.includes('rev-list')) return { exitCode: 0, stdout: (opts.own ?? []).join('\n') }
    return { exitCode: 1, stdout: '' }
  }

const openCoo = async ($: any, clock: { advance: (ms: number) => Promise<void> }) => {
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  const loading = $.skill.prompt({ skill: COO, text: 'consignes du COO' })
  await settle(clock, 12)
  return (await loading).text as string
}

const LINE = /⚠.*main a reçu 2 commit\(s\) hors mission sur des fichiers du groupe C de « Durcir le relais »/

test('le COO lit la branche de travail par une commande git où n’entre aucun chemin des missions, et montre la ligne dans la vue et le relevé', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const out = logOutput([
    { sha: SHA(1), at: START + 60_000, files: ['plugins/flow-board/tests/x.test.ts'] },
    { sha: SHA(2), at: START + 120_000, files: ['plugins/flow-board/hooks/relay.ts'] },
  ])
  const w = world(on, gitAnswer({ exitCode: 0, stdout: out }))
  const text = await openCoo($, clock)
  const log = w.calls.find(c => c.args.includes('--first-parent'))
  expect(log, 'git log lancé').toBeDefined()
  expect(log!.cwd).toBe('/p')
  for (const flag of ['--diff-merges=first-parent', '--no-renames', '--name-only', SHA(9), `--since=@${Math.floor(START / 1000)}`]) expect(log!.args).toContain(flag)
  expect(log!.args).not.toContain('--no-merges')
  // Les chemins des groupes, relus du fichier des missions (dont des chemins hors forme), ne servent qu'à comparer.
  expect(log!.args).not.toContain('--')
  for (const arg of log!.args) expect(['bad path.ts', '-x', ':(glob)*', '../hors.ts', 'plugins/../x.ts'].some(p => arg.includes(p)), arg).toBe(false)
  for (const arg of log!.args) expect(arg.includes('relay.ts') || arg.includes('README.md'), arg).toBe(false)
  expect(text).toMatch(LINE)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await pane.find({ type: 'Text', text: /^main a reçu 2 commit\(s\) hors mission sur des fichiers du groupe C de « Durcir le relais »$/ }), surface).toBeDefined()
    expect(await pane.find({ type: 'Svg' })).toBeUndefined()
    await pane.unmount()
  }
})

test('une commande git ratée ne montre rien et ne bloque rien', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, gitAnswer({ exitCode: 128, stdout: 'fatal: bad revision' }))
  const text = await openCoo($, clock)
  expect(w.calls.some(c => c.args.includes('--first-parent'))).toBe(true)
  expect(text).toMatch(/Missions not archived \(1\)/)
  expect(text).not.toContain('hors mission sur des fichiers')
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect((await pane.find({ key: 'tab-coord' }))?.props.label).toMatch(/Coordination/)
    expect(await pane.find({ type: 'Text', text: /hors mission sur des fichiers/ })).toBeUndefined()
    await pane.unmount()
  }
})

test('les commits de la branche du worker du groupe, mis dans la première lignée par une avance rapide, ne comptent pas pour lui', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const out = logOutput([
    { sha: SHA(1), at: START + 60_000, files: ['plugins/flow-board/tests/x.test.ts'] }, // du worker, arrivé en avance rapide
    { sha: SHA(2), at: START + 120_000, files: ['plugins/flow-board/hooks/relay.ts'] }, // hors mission
    { sha: SHA(3), at: START + 180_000, files: ['plugins/flow-board/hooks/model.ts'] }, // hors mission
  ])
  const w = world(on, gitAnswer({ exitCode: 0, stdout: out }, { refs: `refs/heads/main\u001f${SHA(9)}\n${BRANCH}\u001f${SHA(8)}\nrefs/heads/autre\u001f${SHA(7)}`, own: [SHA(8), SHA(1)] }))
  const text = await openCoo($, clock)
  // La branche passe par le sha que git a rendu, jamais par son nom recalculé.
  const list = w.calls.find(c => c.args.includes('rev-list'))
  expect(list?.args).toContain(SHA(8))
  expect(list?.args.some(a => a.includes('worktree-'))).toBe(false)
  expect(w.calls.filter(c => c.args.includes('rev-list')).length).toBe(1)
  expect(text).toMatch(LINE)
})

test('un commit hors mission arrivé par une fusion compte ; une fusion d’un manager, reconnue par son journal, est excusée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // La fusion se lit face à son premier parent : ses fichiers sont ceux qu'elle apporte.
  const merges = [
    { sha: SHA(4), at: START + 300_000, files: ['plugins/flow-board/hooks/relay.ts', 'docs/x.md'], isMerge: true }, // fusion d'une branche hors mission
    { sha: SHA(5), at: START + 600_000, files: ['plugins/flow-board/hooks/model.ts'], isMerge: true }, // fusion du manager (« ⤞ Merge » à START + 600 s)
    { sha: SHA(6), at: START + 900_000, files: ['plugins/flow-board/hooks/model.ts'] }, // commit hors mission
  ]
  const run = mission([
    { at: START + 600_400, glyph: '⤞', text: 'Merge', tone: 'ok' },
    // Une avance rapide journalisée aussi « ⤞ Merge » : elle ne crée aucun commit, et n'excuse pas le commit hors mission d'à côté.
    { at: START + 900_500, glyph: '⤞', text: 'Merge', tone: 'ok' },
  ])
  const w = world(on, gitAnswer({ exitCode: 0, stdout: logOutput(merges) }), run)
  const text = await openCoo($, clock)
  expect(w.calls.some(c => c.args.includes('--diff-merges=first-parent'))).toBe(true)
  expect(text).toMatch(/main a reçu 2 commit\(s\) hors mission sur des fichiers du groupe C/)
})

test('une liste de branches illisible ne montre rien', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const out = logOutput([
    { sha: SHA(1), at: START + 60_000, files: ['plugins/flow-board/tests/x.test.ts'] },
    { sha: SHA(2), at: START + 120_000, files: ['plugins/flow-board/hooks/relay.ts'] },
  ])
  const answer = gitAnswer({ exitCode: 0, stdout: out })
  // D'abord la ligne, lue normalement ; puis HEAD bouge et la liste des branches ne se lit plus.
  const state = { head: SHA(9), refsOk: true }
  world(on, args => (args.includes('for-each-ref') && !state.refsOk ? { exitCode: 128, stdout: '' } : args.includes('rev-parse') ? { exitCode: 0, stdout: state.head } : answer(args)))
  await openCoo($, clock)
  const shown = async (): Promise<boolean> => {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
    const found = (await pane.find({ type: 'Text', text: /hors mission sur des fichiers/ })) !== undefined
    await pane.unmount()
    return found
  }
  expect(await shown()).toBe(true)
  state.head = SHA(8)
  state.refsOk = false
  await settle(clock, 12)
  expect(await shown()).toBe(false)
})

test('un chemin de groupe écrit à la Windows, en « ./ » ou dans une autre casse se compare comme git l’écrit', () => {
  const run = mission()
  run.groups = run.groups!.map(g => (g.id === 'C' ? { ...g, files: ['plugins\\flow-board\\hooks\\relay.ts', './Plugins/flow-board/hooks/Model.ts'] } : g))
  run.tickets = run.tickets.map(t => ({ ...t, files: [] }))
  const commits = [
    { sha: SHA(1), at: START + 1000, files: ['plugins/flow-board/hooks/relay.ts'] },
    { sha: SHA(2), at: START + 2000, files: ['plugins/flow-board/hooks/model.ts'] },
  ]
  expect(outsideCommitCounts(watchedGroups(board(run)), commits, board(run)).map(c => c.count)).toEqual([2])
})

test('une ligne « Commit : <sujet> » d’un manager n’excuse qu’un commit de ce sujet, jamais celui d’un autre', () => {
  const run = mission([{ at: START + 60_500, glyph: '⎇', text: 'Commit : docs: note du manager', tone: 'ok' }])
  const commits = [
    { sha: SHA(1), at: START + 60_000, files: ['plugins/flow-board/hooks/model.ts'], subject: 'fix: un diagnostic hors mission' },
    { sha: SHA(2), at: START + 30_000, files: ['plugins/flow-board/hooks/model.ts'], subject: 'docs: note du manager' },
  ]
  // Le commit du diagnostic, plus proche de la ligne, reste compté ; celui du manager est excusé.
  expect(outsideCommitCounts(watchedGroups(board(run)), commits, board(run)).map(c => c.count)).toEqual([1])
  // Un sujet coupé par le journal (« … ») excuse encore son commit.
  const cut = mission([{ at: START + 60_500, glyph: '⎇', text: 'Commit : docs: note du…', tone: 'ok' }])
  expect(outsideCommitCounts(watchedGroups(board(cut)), commits, board(cut)).map(c => c.count)).toEqual([1])
  // Un message composé par le shell (heredoc) ne se compare pas : la fenêtre seule décide, et la ligne excuse le plus proche.
  const heredoc = mission([{ at: START + 30_500, glyph: '⎇', text: "Commit : $(cat <<'EOF'", tone: 'ok' }])
  expect(outsideCommitCounts(watchedGroups(board(heredoc)), commits, board(heredoc)).map(c => c.count)).toEqual([1])
})

test('un document commun (README, DECISIONS.md, ETAT_DU_PROJET.md) ne déclenche rien, comme pour les retenues', () => {
  const run = mission()
  run.groups = run.groups!.map(g => (g.id === 'C' ? { ...g, files: ['plugins/flow-board/README.md', 'travail/x/DECISIONS.md', 'plugins/flow-board/hooks/relay.ts'] } : g))
  const commits = parseLoggedCommits(logOutput([{ sha: SHA(1), at: START + 1000, files: ['plugins/flow-board/README.md', 'ETAT_DU_PROJET.md', 'travail/x/DECISIONS.md'] }]))
  expect(outsideCommitCounts(watchedGroups(board(run)), commits, board(run))).toEqual([])
})

test('la branche du worker se reconnaît sous chacun des noms que flow-board donne à sa session (CLI et app)', () => {
  const g = watchedGroups(board(mission()))[0]!
  const wt = groupWorktree(mission(), 'C')!
  for (const name of [`worktree-${wt}`, wt, `claude/${wt}-ab12`]) expect(g.isBranch(name), name).toBe(true)
  for (const name of ['main', `worktree-${wt}-2`, `claude/${wt}-2`, 'worktree-groupe-autre-C']) expect(g.isBranch(name), name).toBe(false)
})
