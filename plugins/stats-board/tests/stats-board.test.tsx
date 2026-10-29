import { describe, expect, mock, test } from 'claude-code/testing'

import { EMPTY_DURATIONS, monthsOf, parseRequestLog, refreshDurations } from '../hooks/durations.ts'
import { SCHEMA } from '../hooks/model.ts'

const PLUGIN = 'stats-board'
/** Le 7 octobre 2026 à 13 h UTC, 15 h à Paris. */
const NOW = Date.UTC(2026, 9, 7, 13, 0, 0)
const HOME = 'C:\\Users\\moi'
const HOME_PATH = HOME.replace(/\\/g, '/')
/**
 * Un chemin du monde simulé, ramené à sa fin depuis le dossier personnel simulé : le moteur sur Mac
 * préfixe un chemin Windows (il n'y est pas absolu). La seule façon dont `world` retrouve un
 * fichier ou un dossier, pour `fs.read`, `fs.write`, `fs.list` et `fs.exists`.
 */
const tail = (path: unknown): string => {
  const p = String(path).replace(/\\/g, '/')
  const at = p.indexOf(HOME_PATH)
  return at < 0 ? p : p.slice(at)
}
const HERE = 'C:\\Users\\moi\\projets\\demo'
const HERE_KEY = 'C--Users-moi-projets-demo'
const OTHER_KEY = 'C--Users-moi-projets-api'
const DRAFT_KEY = 'C--Users-moi-AppData-Roaming-Claude-scratch-workspaces-aaa-bbb-scratch-2026-10-02-30c222'
const NB = ' '

const PANE_PROPS = { title: 'Stats Claude Code', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
const bandProps = (bodyColumns = 120) => ({ hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} })

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number] | 'vscode' | 'mobile'

type Model = [name: string, input: number, output: number, cacheWrite: number, cacheRead: number, cost: number, missing?: boolean]
const day = (date: string, project: string, models: Model[]) => ({
  date,
  project,
  inputTokens: models.reduce((n, m) => n + m[1], 0),
  outputTokens: models.reduce((n, m) => n + m[2], 0),
  cacheCreationTokens: models.reduce((n, m) => n + m[3], 0),
  cacheReadTokens: models.reduce((n, m) => n + m[4], 0),
  totalCost: models.reduce((n, m) => n + m[5], 0),
  modelsUsed: models.map((m) => m[0]),
  modelBreakdowns: models.map(([modelName, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, cost, missing]) => ({
    modelName,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    cost,
    ...(missing ? { missingPricing: true } : {}),
  })),
})

// Ce PC : 20,60 $ pour la démo, 3 $ pour l'API, 0,50 $ pour un brouillon du desktop.
const DAILY = {
  projects: {
    [HERE_KEY]: [
      day('2026-10-06', HERE_KEY, [['claude-opus-5-5', 100, 2000, 5000, 90000, 12.5]]),
      day('2026-10-07', HERE_KEY, [
        ['claude-opus-5-5', 50, 1000, 2000, 50000, 8],
        ['claude-haiku-4-5-20251001', 10, 100, 0, 1000, 0.1],
      ]),
    ],
    [OTHER_KEY]: [day('2026-09-20', OTHER_KEY, [['claude-fable-5-1', 30, 400, 100, 9000, 3]]), day('2026-10-07', OTHER_KEY, [['claude-sonnet-5-5', 5, 50, 10, 100, 0, true]])],
    [DRAFT_KEY]: [day('2026-10-02', DRAFT_KEY, [['claude-opus-5-5', 1, 10, 10, 100, 0.5]])],
  },
  totals: { totalCost: 24.1, unpricedModels: ['claude-sonnet-5-5'] },
}

const SESSIONS = {
  sessions: [
    { sessionId: 's1', projectPath: HERE_KEY, firstActivity: '2026-10-06T08:00:00.000Z', lastActivity: '2026-10-07T12:00:00.000Z', totalCost: 20.6, totalTokens: 151260, outputTokens: 3100, modelsUsed: ['claude-opus-5-5', 'claude-haiku-4-5-20251001'] },
    { sessionId: 's2', projectPath: OTHER_KEY, firstActivity: '2026-09-20T10:00:00.000Z', lastActivity: '2026-09-20T11:30:00.000Z', totalCost: 3, totalTokens: 9530, outputTokens: 400, modelsUsed: ['claude-fable-5-1'] },
    // Un sous-agent de workflow lancé par la discussion s1.
    { sessionId: 'w1', projectPath: `${HERE_KEY}\\s1\\subagents\\workflows`, firstActivity: '2026-10-07T11:00:00.000Z', lastActivity: '2026-10-07T11:20:00.000Z', totalCost: 1.2, totalTokens: 5000, outputTokens: 300, modelsUsed: ['claude-haiku-4-5-20251001'] },
  ],
  totals: {},
}

// `ccusage claude session --id s1` : trois appels, coût par appel à 0 (seul le total est juste).
const DISCUSSION = {
  sessionId: 's1',
  totalCost: 20.6,
  totalTokens: 151260,
  entries: [
    { timestamp: '2026-10-07T12:10:00.000Z', model: 'claude-opus-5-5', inputTokens: 50, outputTokens: 3000, cacheCreationTokens: 5000, cacheReadTokens: 90000, costUSD: 0 },
    { timestamp: '2026-10-07T12:30:00.000Z', model: 'claude-haiku-4-5-20251001', inputTokens: 10, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 1000, costUSD: 0 },
    { timestamp: '2026-10-07T12:50:00.000Z', model: 'claude-opus-5-5', inputTokens: 40, outputTokens: 0, cacheCreationTokens: 2000, cacheReadTokens: 50060, costUSD: 0 },
  ],
}

const BLOCKS = {
  blocks: [
    { id: '2026-10-06T08:00:00.000Z', startTime: '2026-10-06T08:00:00.000Z', endTime: '2026-10-06T13:00:00.000Z', actualEndTime: '2026-10-06T12:00:00.000Z', isActive: false, isGap: false, entries: 10, tokenCounts: { inputTokens: 100, outputTokens: 2000, cacheCreationInputTokens: 5000, cacheReadInputTokens: 90000 }, totalTokens: 97100, costUSD: 12.5, models: ['claude-opus-5-5'] },
    { id: 'gap-2026-10-06T13:00:00.000Z', startTime: '2026-10-06T13:00:00.000Z', endTime: '2026-10-07T11:00:00.000Z', actualEndTime: null, isActive: false, isGap: true, entries: 0, tokenCounts: {}, totalTokens: 0, costUSD: 0, models: [] },
    {
      id: '2026-10-07T11:00:00.000Z',
      startTime: '2026-10-07T11:00:00.000Z',
      endTime: '2026-10-07T16:00:00.000Z',
      actualEndTime: '2026-10-07T12:50:00.000Z',
      isActive: true,
      isGap: false,
      entries: 5,
      tokenCounts: { inputTokens: 60, outputTokens: 1100, cacheCreationInputTokens: 2000, cacheReadInputTokens: 51000 },
      totalTokens: 54160,
      costUSD: 8.1,
      models: ['claude-opus-5-5', 'claude-haiku-4-5-20251001'],
      burnRate: { costPerHour: 4.2, tokensPerMinute: 500, tokensPerMinuteForIndicator: 10 },
      projection: { totalCost: 15.3, totalTokens: 100000, remainingMinutes: 180 },
    },
  ],
}

// Les autres postes, publiés dans le dépôt partagé `claude-usage`.
const urow = (date: string, project: string, model: string, cost: number) => ({ date, project, model, input: 1, output: 1, cacheWrite: 1, cacheRead: 1, cost })
// L'ancien serveur (projet PolePredict) : 40 $ en juin, et 1,50 $ un jour où ce poste a aussi travaillé.
const SERVEUR = {
  schema: 1,
  machine: 'Serveur',
  updatedAt: Date.UTC(2026, 8, 25),
  tzOffset: -120,
  rows: [urow('2026-06-14', 'C--dev-PolePredict', 'claude-opus-4-8', 40), urow('2026-10-06', 'C--dev-PolePredict', 'claude-opus-5-5', 1.5)],
  sessions: [],
  projects: { 'C--dev-PolePredict': { name: 'PolePredict', path: 'C:\\dev\\PolePredict' } },
}
// Le Mac : 2 $ sur PolePredict et 1 $ sur demo, en septembre ; une session.
const MAC = {
  schema: 1,
  machine: 'Mac',
  updatedAt: Date.UTC(2026, 8, 16),
  tzOffset: -120,
  rows: [urow('2026-09-15', '-Users-moi-dev-PolePredict', 'claude-opus-5-5', 2), urow('2026-09-16', '-Users-moi-projets-demo', 'claude-opus-5-5', 1)],
  sessions: [{ id: 'm1', project: '-Users-moi-dev-PolePredict', parent: null, first: Date.UTC(2026, 8, 15, 8), last: Date.UTC(2026, 8, 15, 10), cost: 2, tokens: 4, output: 1, models: ['claude-opus-5-5'] }],
  projects: { '-Users-moi-dev-PolePredict': { name: 'PolePredict', path: '/Users/moi/dev/PolePredict' }, '-Users-moi-projets-demo': { name: 'demo', path: '/Users/moi/projets/demo' } },
}

const STATS_CACHE = {
  version: 5,
  lastComputedDate: '2026-10-06',
  dailyActivity: [
    { date: '2026-09-20', messageCount: 30, sessionCount: 1, toolCallCount: 12 },
    { date: '2026-10-06', messageCount: 120, sessionCount: 2, toolCallCount: 40 },
  ],
  hourCounts: { '9': 3, '15': 7, '22': 1 },
  totalSessions: 3,
  totalMessages: 150,
  longestSession: { sessionId: 's1', duration: 29 * 3_600_000, messageCount: 80, timestamp: '2026-10-06T08:00:00.000Z' },
  firstSessionDate: '2026-09-20T10:00:00.000Z',
}

/**
 * `isFresh` : une discussion toute neuve, que ccusage ne connaît pas encore (il répond `null`).
 * `requestFiles` : des fichiers de relevé des requêtes déjà là (`~/.claude/stats-board/requetes/`).
 * `session` : l'id de la session, qui change après un `/clear` (s1 par défaut).
 * `noShare` : pas de dépôt `claude-usage` ; `machine` : le nom de ce poste (null : pas de `.machine`).
 */
type WorldOptions = { mac?: unknown; requestFiles?: Record<string, unknown>; totals?: Record<string, unknown>; totalsReadOnly?: boolean; requestsListFails?: boolean; noRequestsDir?: boolean; totalsMtime?: number; session?: { id: string }; failOnline?: boolean; store?: Record<string, unknown>; cwd?: string; isFresh?: boolean; noShare?: boolean; machine?: string | null; lockedAdds?: number; racedPulls?: number; staleLock?: boolean }

/** Ce que le moteur ferait seul : ccusage, Node, le disque, l'écran. */
function world(on: any, options: WorldOptions = {}) {
  const calls: string[][] = []
  const written: Record<string, string> = {}
  const machine = options.machine === undefined ? 'Portable' : options.machine
  // `git add` refusé tant qu'une autre session tient le verrou de l'index.
  let lockedAdds = options.lockedAdds ?? 0
  // `pull --rebase` refusé tant qu'une autre session avance `origin/main` en même temps.
  let racedPulls = options.racedPulls ?? 0
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  const opened: string[] = []
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: options.cwd ?? HERE }))
  on('command.register', () => ({ value: {} }))
  on('ui.open', ($: any, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($: any, e: any) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  // La discussion ouverte, d'après le moteur : la session s1, 21,50 $ (/cost), contexte à 63 %.
  on('session.id', () => ({ value: options.session?.id ?? 's1' }))
  on('session.usage', () => ({ value: { startedAt: NOW - 5 * 3_600_000, context: { tokens: 126_000, window: 200_000, percent: 63 }, rateLimits: [], cost: { usd: 21.5 } } }))
  on('session.turns', () => ({ value: 4 }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('process.run', ($: any, e: any) => {
    const argv: string[] = [...e.argv]
    calls.push(argv)
    // git dans le dépôt partagé : des changements à commiter, un commit à pousser.
    if (argv[0] === 'git') {
      if (argv.includes('status')) return ok(' M machines/Portable.json\n')
      if (argv.includes('add') && lockedAdds > 0) {
        lockedAdds -= 1
        return { value: { exitCode: 128, stdout: '', stderr: "fatal: Unable to create 'C:/Users/moi/.claude/claude-usage/.git/index.lock': File exists.\n", isStdoutTruncated: false, isStderrTruncated: false } }
      }
      if (argv.includes('pull') && racedPulls > 0) {
        racedPulls -= 1
        return { value: { exitCode: 1, stdout: '', stderr: "error: cannot lock ref 'refs/remotes/origin/main': is at 3812363 but expected ccef9f5\n", isStdoutTruncated: false, isStderrTruncated: false } }
      }
      if (argv.includes('rev-list')) return ok('1\n')
      return ok('')
    }
    // Node : le fuseau (-p), ou les dossiers des projets (-e) ; celui de la démo seulement,
    // les autres passent par la lecture directe.
    if (argv[0] === 'node' && argv[1] === '-p') return ok('[-120,"Europe/Paris"]\n')
    if (argv[0] === 'node') return ok(JSON.stringify(argv.includes(HERE_KEY) ? { [HERE_KEY]: HERE } : {}))
    const args = argv.slice(argv.indexOf('ccusage@latest') + 1)
    if (args[0] === '--version') return ok('ccusage 20.0.26\n')
    const offline = args.includes('--offline')
    if (options.failOnline && !offline) return { value: { exitCode: 1, stdout: '', stderr: 'Error: fetch failed\n', isStdoutTruncated: false, isStderrTruncated: false } }
    if (args[1] === 'session' && args.includes('--id')) return ok(options.isFresh ? 'null\n' : JSON.stringify(DISCUSSION))
    if (args[1] === 'daily') return ok(JSON.stringify(DAILY))
    if (args[1] === 'session') return ok(JSON.stringify(SESSIONS))
    if (args[1] === 'blocks') return ok(JSON.stringify(BLOCKS))
    return { value: { exitCode: 1, stdout: '', stderr: `inattendu : ${args.join(' ')}`, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', ($: any, e: any) => {
    const path = tail(e.path)
    if (path.endsWith('/stats-cache.json')) return { value: JSON.stringify(STATS_CACHE) }
    if (path.endsWith('/claude-usage/.machine') && machine) return { value: `${machine}\n` }
    if (path.endsWith('/claude-usage/machines/Serveur.json')) return { value: JSON.stringify(SERVEUR) }
    if (path.endsWith('/claude-usage/machines/Mac.json')) return { value: JSON.stringify(options.mac ?? MAC) }
    if (written[path] !== undefined) return { value: written[path] }
    const request = path.match(/\/stats-board\/requetes\/([^/]+)$/)?.[1]
    if (request && options.requestFiles?.[request]) return { value: JSON.stringify(options.requestFiles[request]) }
    if (path.includes(`/projects/${HERE_KEY}/`)) return { value: '{"type":"user","cwd":"C:\\\\Users\\\\moi\\\\projets\\\\demo"}\n' }
    if (path.includes(`/projects/${OTHER_KEY}/`)) return { value: '{"type":"user","cwd":"C:\\\\Users\\\\moi\\\\projets\\\\api"}\n' }
    if (path.includes(`/projects/${DRAFT_KEY}/`)) return { value: '{"cwd":"C:\\\\Users\\\\moi\\\\AppData\\\\Roaming\\\\Claude\\\\scratch-workspaces\\\\aaa\\\\scratch-2026-10-02-30c222"}\n' }
    throw new Error(`ENOENT ${path}`)
  })
  on('fs.write', ($: any, e: any) => {
    const path = tail(e.path)
    if (options.totalsReadOnly && path.includes('/stats-board/totaux/')) throw new Error('EACCES: permission denied')
    written[path] = e.text
    return { value: undefined }
  })
  on('fs.exists', ($: any, e: any) => {
    const path = tail(e.path)
    // Une liste des relevés qui échoue : sur un dossier qui existe.
    if (path.endsWith('/stats-board/requetes')) return { value: !!options.requestsListFails }
    return { value: !options.noShare && path.endsWith('/claude-usage/.git') }
  })
  on('fs.list', ($: any, e: any) => {
    const path = tail(e.path)
    const file = (name: string) => ({ name, kind: 'file', size: 200, mtimeMs: 0, isLink: false })
    if (options.staleLock && path.endsWith('/claude-usage/.git')) return { value: [file('index.lock')] }
    if (path.endsWith('/claude-usage/machines')) return { value: [file('Mac.json'), file('Portable.json'), file('Serveur.json')] }
    // Les totaux par mois que ce test a écrits (ou donnés au départ) ; pas de dossier sans eux.
    if (path.endsWith('/stats-board/totaux')) {
      const names = Object.keys(written).filter((p) => p.includes('/stats-board/totaux/')).map((p) => p.split('/').pop()!)
      if (!names.length) throw new Error(`ENOENT ${e.path}`)
      return { value: names.map((name) => ({ name, kind: 'file', size: 200, mtimeMs: options.totalsMtime ?? 0, isLink: false })) }
    }
    // Les fichiers de relevé : ceux déjà là, et ceux que ce test a écrits.
    if (path.endsWith('/stats-board/requetes')) {
      if (options.requestsListFails) throw new Error('EIO: i/o error')
      // Aucun fichier de relevé encore : le dossier n'est créé qu'à la première requête relevée.
      if (options.noRequestsDir) throw new Error(`ENOENT ${e.path}`)
      const names = [...Object.keys(options.requestFiles ?? {}), ...Object.keys(written).filter((p) => p.includes('/stats-board/requetes/')).map((p) => p.split('/').pop()!)]
      return { value: [...new Set(names)].map((name) => ({ name, kind: 'file', size: 200, mtimeMs: written[`x/${name}`] ? 1 : 0, isLink: false })) }
    }
    return { value: [file('a.jsonl')] }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  mock.env(on, { USERPROFILE: HOME })
  // Le store du plugin, en mémoire, que le test relit.
  const stored: Record<string, unknown> = JSON.parse(JSON.stringify(options.store ?? {}))
  on('store.get', ($: any, e: any) => ({ value: stored[e.key] }))
  on('store.set', ($: any, e: any) => {
    stored[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', ($: any, e: any) => {
    delete stored[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(stored) }))
  for (const [name, text] of Object.entries(options.totals ?? {})) written[`${HOME_PATH}/.claude/stats-board/totaux/${name}`] = typeof text === 'string' ? text : JSON.stringify(text)
  return {
    calls,
    written,
    stored,
    /** Les commandes git, sans `git -C <dépôt>`. */
    git: () => calls.filter((c) => c[0] === 'git').map((c) => c.slice(3).join(' ')),
    toasts,
    statuses,
    opened,
    /** Les rapports du relevé, sans `--version` ni le détail de la discussion. */
    ccusage: () => calls.filter((c) => c.includes('ccusage@latest') && !c.includes('--version') && !c.includes('--id')),
    details: () => calls.filter((c) => c.includes('--id')),
  }
}

async function start($: any, clock: any, surface: Surface = 'terminal') {
  await $.session.start({ surface, isInteractive: true, cwd: HERE } as any)
  await $.command.run({ command: 'ccstats', args: '' })
  await clock.settle()
}

const mountPane = ($: any, surface: Surface, bodyColumns = 80) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'ccstats', props: { ...PANE_PROPS, bodyColumns } } as any)

const mountBand = ($: any, surface: 'terminal' | 'desktop', bodyColumns = 120) => $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(bodyColumns) } as any)

const drawn = async (pane: any): Promise<string> => JSON.stringify(await pane.drawn())

describe('stats-board', () => {
  for (const surface of SURFACES) {
    test(`relevé : ccusage, autres postes et cache de /stats ; aperçu (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      await start($, clock, surface)

      // Les trois rapports ccusage, en JSON, dans le fuseau de la machine.
      const runs = seen.ccusage().map((c) => c.slice(c.indexOf('ccusage@latest') + 1).join(' '))
      expect(runs).toEqual([
        'claude daily --instances --breakdown --json --order asc --timezone Europe/Paris',
        'claude session --json --order asc --timezone Europe/Paris',
        'claude blocks --breakdown --json --order asc --timezone Europe/Paris',
      ])
      expect(seen.opened).toContain('ccstats')

      const pane = await mountPane($, surface)
      const all = await drawn(pane)
      // 20,60 + 3 + 0,50 (ce poste) + 41,50 (Serveur) + 3 (Mac) = 68,60 $ ; Sonnet 5.5 sans prix est signalé.
      expect(all).toContain(`68,60${NB}$`)
      expect(all).toMatch(/Sans prix connu chez ccusage.*Sonnet.5\.5/)
      expect(all).toContain(`ccusage${NB}20.0.26`)
      expect(all).toContain('Messages (ce poste)')
      expect(all).toContain(`Tous${NB}les${NB}postes`)
      expect(all).toMatch(/Heure de pointe/)
      // Le calendrier : SVG sur le desktop, glyphes sur le terminal.
      if (surface === 'desktop') expect(all).toMatch(/Calendrier d'activité : \d+ jours actifs/)
      else expect(all).toContain('Moins')
      // Aucun avertissement : le partage a marché.
      expect(all).not.toMatch(/illisible|Partage|pas de nom/)
      // Ce poste publie ses seules lignes, puis commit, rebase et push.
      expect(seen.git()).toEqual(['status --porcelain -- machines/Portable.json', 'add -- machines/Portable.json', 'commit -q -m usage: Portable -- machines/Portable.json', 'pull --rebase -q', 'rev-list --count @{u}..HEAD', 'push -q'])
      const published = JSON.parse(Object.entries(seen.written).find(([p]) => p.endsWith('/claude-usage/machines/Portable.json'))![1])
      expect(published).toMatchObject({ schema: 1, machine: 'Portable' })
      // La date de publication part à la minute : elle ne dit pas l'heure exacte d'un relevé.
      expect(published.updatedAt % 60_000).toBe(0)
      expect(published.rows.every((r: any) => r.machine === 'Portable')).toBe(true)
      expect(Math.round(published.rows.reduce((n: number, r: any) => n + r.cost, 0) * 100)).toBe(2410)
      expect(Object.keys(published.projects)).toContain(HERE_KEY)
    })

    test(`filtres : période, machine, ce projet, retour à tout (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      world(on)
      await start($, clock, surface)
      const pane = await mountPane($, surface)

      await pane.press({ key: 'period-7' })
      // Depuis le 1er octobre : 20,60 + 0,50 + 1,50 = 22,60 $.
      expect(await drawn(pane)).toContain(`22,60${NB}$`)
      await pane.press({ key: 'machine-Serveur' })
      expect(await drawn(pane)).toContain(`1,50${NB}$`)
      await pane.press({ key: 'machine-all' })
      await pane.press({ key: 'here' })
      expect(await drawn(pane)).toContain(`20,60${NB}$`)
      await pane.press({ key: 'here' })
      await pane.press({ key: 'period-all' })
      expect(await drawn(pane)).toContain(`68,60${NB}$`)
      await pane.press({ key: 'machine-Mac' })
      expect(await drawn(pane)).toContain(`3,00${NB}$`)
      // Le serveur n'a publié que des totaux : pas de sessions.
      await pane.press({ key: 'machine-Serveur' })
      await pane.press({ key: 'period-7' })
      await pane.press({ key: 'tab-sessions' })
      expect(await drawn(pane)).toMatch(/pas de détail des sessions/)
    })

    test(`onglets : évolution, modèles, projets, sessions, rythme (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      world(on)
      await start($, clock, surface)
      const pane = await mountPane($, surface)

      await pane.press({ key: 'tab-trend' })
      let all = await drawn(pane)
      expect(all).toContain('Octobre')
      expect(all).toContain('Bloc de 5 h en cours')
      // 15 h à Paris, bloc de 13 h à 18 h : il reste 3 h.
      expect(all).toContain(`reste${NB}3${NB}h${NB}00`)
      expect(all).toContain('Jours les plus chargés')
      await pane.press({ key: 'grain-month' })
      await pane.press({ key: 'metric-tokens' })
      expect(await drawn(pane)).toContain('Tokens par mois')

      await pane.press({ key: 'metric-cost' })
      await pane.press({ key: 'tab-models' })
      all = await drawn(pane)
      for (const name of ['Opus', 'Haiku', 'Fable', 'Sonnet']) expect(all).toContain(name)
      // Filtrer un modèle : la puce de filtre apparaît en tête.
      await pane.press({ key: 'model-0' })
      expect(await pane.find({ type: 'Button', key: 'clear-model' })).toBeDefined()
      await pane.press({ key: 'clear-model' })

      await pane.press({ key: 'tab-projects' })
      all = await drawn(pane)
      expect(all).toContain('demo')
      expect(all).toContain('ce projet')
      expect(all).toContain('Brouillons du desktop')
      // Un poste n'est pas un projet : PolePredict additionne le serveur et le Mac, demo le Mac.
      expect(all).toContain('PolePredict')
      expect(all).toContain(`dont Mac 2,00${NB}$, Serveur 41,50${NB}$`)
      expect(all).toContain(`dont Mac 1,00${NB}$`)
      // PolePredict, demo (ce projet : sa bascule est en tête, pas une puce ✕), puis api.
      await pane.press({ key: 'proj-2' })
      expect(await pane.find({ type: 'Button', key: 'clear-project' })).toBeDefined()
      await pane.press({ key: 'clear-project' })

      await pane.press({ key: 'tab-sessions' })
      all = await drawn(pane)
      expect(all).toContain('Durée médiane')
      expect(all).toContain('Blocs de 5 h')
      // Plusieurs postes : chaque session dit le sien.
      expect(all).toContain(`PolePredict${NB}·${NB}Mac`)
      await pane.press({ key: 'sort-recent' })
      await pane.press({ key: 'sort-long' })

      await pane.press({ key: 'tab-rhythm' })
      all = await drawn(pane)
      expect(all).toContain(`Pointe à 15${NB}h`)
      expect(all).toContain('Jours de la semaine')
      expect(all).toContain('Messages et outils')
      expect(all).toContain('Régularité')
    })

    test(`bandeau : rythme, discussion, jour, mois ; bouton qui ouvre le panneau, x qui masque (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      on('turn.complete', () => ({ text: '', usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } }))
      await start($, clock, surface)
      const band = await mountBand($, surface, 160)
      const text = await drawn(band)
      // Dans l'ordre : rythme du bloc (4,2 $/h, calme), discussion (21,50 $ du moteur ; 151 260 +
      // 5 000 tokens du sous-agent), aujourd'hui (8,10 $ ; 54 325 tokens), octobre (22,60 $).
      const at = (s: string) => text.indexOf(s)
      // Le terminal, compact : 💬 discussion, 🌞 jour, 📅 mois et « tok » ; le desktop, en mots.
      const isTerminal = surface === 'terminal'
      const [disc, day, month, tok] = isTerminal ? ['💬', '🌞', '📅', 'tok"'] : ['discussion', 'aujourd’hui', 'oct.', 'tokens']
      expect(at(`4,2${NB}$/h`)).toBeGreaterThan(-1)
      expect(at(disc)).toBeGreaterThan(at(`4,2${NB}$/h`))
      expect(at(`21,50${NB}$`)).toBeGreaterThan(at(disc))
      expect(text).toContain(`156${NB}k${NB}${tok}`)
      expect(at(day)).toBeGreaterThan(at(`21,50${NB}$`))
      expect(text).toContain(`8,10${NB}$`)
      expect(text).toContain(`54,3${NB}k`)
      expect(at(month)).toBeGreaterThan(at(day))
      expect(text).toContain(`22,60${NB}$`)
      if (isTerminal) expect(text).not.toMatch(/discussion|aujourd’hui|tokens/)
      // Ni bloc de 5 h, ni projection du mois.
      expect(text).not.toContain(`bloc${NB}`)
      expect(text).not.toContain('≈')
      if (surface === 'desktop') expect(text).toMatch(/Rythme 4,2.\$\/h : calme/)
      else expect((text.match(/▱/g) ?? []).length).toBe(4)
      // Un tour fini après le relevé : ses tokens s'ajoutent à la discussion.
      await clock.advance(1_000)
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
      expect(await drawn(await mountBand($, surface, 160))).toContain(`199${NB}k${NB}${tok}`)
      seen.opened.length = 0
      // Sans commande dans le libellé : l'étiquette « Stats » nomme déjà le plugin.
      expect(String((await band.find({ key: 'stats-band-open' }))?.props.label)).toMatch(/^▸.Ouvrir$/)
      await band.press({ key: 'stats-band-open' })
      expect(seen.opened).toEqual(['ccstats'])
      // Étroit : le rythme et la discussion seulement.
      const narrow = await drawn(await mountBand($, surface, 40))
      expect(narrow).toContain(`21,50${NB}$`)
      expect(narrow).not.toContain(day)
      await band.press({ key: 'stats-band-hide' })
      expect(seen.statuses.at(-1)).toMatch(/aujourd'hui/)
      expect(seen.toasts.some((t) => /Bandeau Stats masqué/.test(t))).toBe(true)
      await $.command.run({ command: 'ccstats', args: 'show' } as any)
      expect(seen.statuses.at(-1)).toBeUndefined()
    })
  }

  for (const surface of SURFACES) {
    test(`onglet Discussion : moteur en direct, puis détail ccusage par ↻ (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      await start($, clock, surface)
      const pane = await mountPane($, surface, 100)
      await pane.press({ key: 'tab-discussion' })
      let all = await drawn(pane)
      // Avant le détail : le coût du moteur, le contexte, et le bouton qui détaille.
      expect(all).toContain('Cette')
      expect(all).toContain(`21,50${NB}$`)
      expect(all).toContain(`63${NB}%`)
      expect(all).toContain(`4${NB}tours`)
      expect(await pane.find({ type: 'Button', key: 'discussion-detail' })).toBeDefined()
      expect(seen.details()).toHaveLength(0)
      await pane.press({ key: 'discussion-refresh' })
      expect(seen.details().map((c) => c.slice(c.indexOf('ccusage@latest') + 1).join(' '))).toEqual(['claude session --id s1 --json'])
      all = await drawn(pane)
      // Le détail : frise, modèles, appels les plus chers, sous-agent, et le rythme de la dernière heure.
      expect(all).toContain('Appels les plus chers')
      expect(all).toContain('Modèles de la discussion')
      expect(all).toContain('Sous-agents de workflow')
      expect(all).toContain('estimé')
      expect(all).toContain(`21${NB}$/h${NB}·${NB}soutenu`)
      expect(all).toContain('calme')
      await pane.press({ key: 'metric-tokens' })
      expect(await drawn(pane)).toContain('Tokens par tranche')
    })
  }

  // Le moteur tel que docs/evenements-moteur.md le décrit (essai du 26/10/2026, 2.1.310 et 2.1.308) : `prompt.submit` rend la
  // main avant le `turn.start` de son tour, `classic.Stop` précède `turn.complete`, et une
  // interruption n'a pas de `classic.Stop`. Chaque appel au modèle lit son prompt, puis génère.
  type Plan = { model: string; wait: number; generate: number; tokens: [input: number, output: number, cacheWrite: number, cacheRead: number] }
  const requestEngine = (on: any, clock: any) => {
    let plan: Plan = { model: 'claude-opus-5-5', wait: 0, generate: 0, tokens: [0, 0, 0, 0] }
    on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
    on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    on('classic.Stop', () => ({}))
    on('classic.SubagentStop', () => ({}))
    on('session.end', () => ({ sessionId: 's1' }))
    // Sous le plugin : le moteur donne l'id de l'agent lancé, et la liste des agents.
    let spawning = ''
    let agents: any[] = []
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: spawning }))
    on('agent.list', () => ({ value: agents }))
    on('turn.step', async function* (_: any, e: any) {
      await clock.advance(plan.wait)
      yield { kind: 'thinking', index: 0, text: '…' }
      await clock.advance(plan.generate)
      const [input, output, cacheWrite, cacheRead] = plan.tokens
      const usage = { input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, model: plan.model }
      yield { kind: 'stop', stopReason: 'end_turn', usage }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
    })
    let turns = 0
    const tasksOf = (list: string[]) => list.map((id) => ({ id, type: id.startsWith('a') ? 'subagent' : 'shell', status: 'running', description: id }))
    return (surface: Surface, $: any) => {
      /** Un prompt d'une autre origine reçu au repos, puis le tour qu'il démarre. */
      const relaunch = async (text: string, kind: string) => {
        await $.prompt.submit({ text, wait: false, origin: { kind } } as any)
        const id = `t${++turns}`
        await $.turn.start({ text, turnId: id } as any)
        return id
      }
      return {
      relaunch,
      /** Un message envoyé au repos, puis le tour qu'il démarre ; pendant un tour (`turnId`), il le rejoint. */
      send: async (text: string, turnId?: string) => {
        await $.prompt.submit({ text, wait: false, origin: { kind: surface === 'terminal' ? 'composer' : 'sdk' }, ...(turnId ? { turnId } : {}) } as any)
        if (turnId) return turnId
        const id = `t${++turns}`
        await $.turn.start({ text, turnId: id } as any)
        return id
      },
      /** La notification de fin d'une commande de fond (ou d'un agent), et le message de retour d'un agent. */
      shellDone: (id: string) => relaunch(`<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>`, 'task-notification'),
      agentDone: (id: string) => relaunch(`<agent-message from="${id}">\n[Subagent hand-back] OK`, 'peer'),
      /** Un sous-agent de fond lancé (par le fil principal, ou par l'agent `parent`), puis son premier tour. */
      spawn: async (id: string, parent?: string) => {
        spawning = id
        await $.agent.spawn({ prompt: 'x', description: id, subagentType: 'general-purpose', parentModel: 'claude-opus-5-5', background: true, fork: false, ...(parent ? { parentAgentId: parent } : {}) } as any)
        await $.turn.start({ text: 'x', turnId: `a-${id}`, agentId: id } as any)
      },
      /** Un appel au modèle d'un agent. */
      agentStep: async (id: string, next: Plan) => {
        plan = next
        for await (const _ of $.turn.step({ turnId: `a-${id}`, index: 0, model: next.model, messageCount: 1, agentId: id } as any)) {
          // les morceaux de la réponse, sans intérêt ici
        }
      },
      /** Fin du tour d'un agent : son arrêt, avec la liste à jour des tâches de fond, puis la fin du tour. */
      agentFinish: async (id: string, tasks: string[] = []) => {
        await $.classic.SubagentStop({ stop_hook_active: false, agent_id: id, agent_type: 'general-purpose', agent_transcript_path: '', background_tasks: tasksOf(tasks) } as any)
        await $.turn.complete({ answer: '', durationMs: 1, turnId: `a-${id}`, agentId: id, reason: 'answer' } as any)
      },
      /** Échap : la fin interrompue du tour, sans `classic.Stop`. */
      abort: (turnId: string) => $.turn.complete({ answer: '', durationMs: 1, turnId, reason: 'aborted', isAborted: true } as any),
      setAgents: (list: any[]) => {
        agents = list
      },
      /** Un appel au modèle du tour. */
      step: async (turnId: string, next: Plan) => {
        plan = next
        for await (const _ of $.turn.step({ turnId, index: 0, model: next.model, messageCount: 1 } as any)) {
          // les morceaux de la réponse, sans intérêt ici
        }
      },
      /** Fin normale d'un tour du fil principal : `classic.Stop`, avec les tâches de fond encore en cours, puis la fin du tour. */
      finish: async (turnId: string, tasks: string[] = []) => {
        await $.classic.Stop({ stop_hook_active: false, background_tasks: tasksOf(tasks) } as any)
        await $.turn.complete({ answer: '', durationMs: 1, turnId, reason: 'answer' } as any)
      },
    }
    }
  }
  const OPUS = (wait: number, generate: number): Plan => ({ model: 'claude-opus-5-5', wait, generate, tokens: [1000, 2000, 10_000, 100_000] })
  /** Les fichiers de relevé écrits, par nom. */
  const logsOf = (seen: ReturnType<typeof world>): Record<string, any> =>
    Object.fromEntries(
      Object.entries(seen.written)
        .filter(([p]) => p.includes('/.claude/stats-board/requetes/'))
        .map(([p, text]) => [p.split('/').pop()!, JSON.parse(text)]),
    )

  test('requêtes : deux messages, puis un message pendant un tour ; le fichier de relevé, sans texte', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on)
    const engine = requestEngine(on, clock)('terminal', $)
    await start($, clock, 'terminal')

    // Requête 1 : deux appels d'Opus 5.5 (4 s chacun, dont 3 s de génération), un outil de 2 s entre eux.
    const sentAt = clock.now()
    const t1 = await engine.send('Corrige le bug du parseur de dates dans model.ts')
    await engine.step(t1, OPUS(1000, 3000))
    await clock.advance(2000)
    await engine.step(t1, OPUS(1000, 3000))
    await engine.finish(t1)
    await clock.advance(1000)
    let logs = logsOf(seen)
    const name = `s1_${sentAt}.json`
    expect(Object.keys(logs)).toEqual([name])
    let log = logs[name]
    expect(log).toMatchObject({ schema: 1, session: 's1', openedAt: sentAt, project: HERE_KEY })
    expect(log.requests).toHaveLength(1)
    // 10 s de l'envoi à la fin du tour, 8 s d'appels, 6 s de génération ; 2 × 0,144 $.
    expect(log.requests[0]).toMatchObject({ id: 1, sentAt, endedAt: sentAt + 10_000, realMs: 10_000, isOpen: false, apiMs: 8000, agents: 0 })
    expect(log.requests[0].models['claude-opus-5-5']).toMatchObject({ calls: 2, input: 2000, output: 4000, cacheWrite: 20_000, cacheRead: 200_000, apiMs: 8000, genMs: 6000, isEstimated: false, speeds: { '660': 2 } })
    expect(Math.round(log.requests[0].models['claude-opus-5-5'].cost * 1000)).toBe(288)

    // Requête 2, puis un message envoyé pendant son tour : la requête 3 prend le reste du tour.
    await clock.advance(60_000)
    const t2 = await engine.send('Lance les tests')
    await engine.step(t2, OPUS(500, 1500))
    await engine.send('Et le lint aussi', t2)
    await engine.step(t2, OPUS(500, 500))
    await engine.finish(t2)
    await clock.advance(1000)
    log = logsOf(seen)[name]
    expect(log.requests.map((r: any) => [r.id, r.realMs, r.apiMs, r.isOpen])).toEqual([
      [1, 10_000, 8000, false],
      [2, 2000, 2000, false],
      [3, 1000, 1000, false],
    ])
    // Aucun texte de message dans le relevé.
    const text = seen.written[Object.keys(seen.written).find((p) => p.endsWith(name))!]!
    for (const words of ['parseur', 'Lance les tests', 'lint']) expect(text).not.toContain(words)
  })

  for (const surface of SURFACES) {
    test(`onglet Discussion : tuiles de durée et carte « Requêtes », triable, avec une requête en cours (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, surface)
      const t1 = await engine.send('Corrige le bug du parseur de dates dans model.ts')
      await engine.step(t1, OPUS(1000, 3000))
      await clock.advance(56_000)
      await engine.finish(t1)
      await clock.advance(30_000)
      // Une requête plus courte mais plus chère.
      const t2 = await engine.send('Réécris tout le module de rendu')
      await engine.step(t2, { model: 'claude-opus-5-5', wait: 1000, generate: 9000, tokens: [1000, 50_000, 10_000, 100_000] })
      await engine.finish(t2)
      // La troisième tourne encore.
      await clock.advance(5000)
      const t3 = await engine.send('Et maintenant ?')
      await clock.advance(3000)

      const pane = await mountPane($, surface, 100)
      await pane.press({ key: 'tab-discussion' })
      let all = await drawn(pane)
      expect(all).toContain('Ouverte depuis')
      expect(all).toContain('Temps actif')
      expect(all).toContain('Temps API')
      expect(all).toContain('Coût / h active')
      expect(all).toContain('Requêtes')
      // 3 requêtes ; le début de chaque message, gardé en mémoire ; la troisième en cours.
      expect(all).toContain(`3${NB}requêtes`)
      expect(all).toContain('Corrige le bug du parseur de dates dans model.ts')
      expect(all).toContain(`en${NB}cours`)
      // Par coût, la réécriture d'abord ; par durée réelle, le parseur (1 min) d'abord.
      expect(all.indexOf('Réécris tout')).toBeLessThan(all.indexOf('Corrige le bug'))
      await pane.press({ key: 'req-sort-real' })
      all = await drawn(pane)
      expect(all.indexOf('Corrige le bug')).toBeLessThan(all.indexOf('Réécris tout'))
      expect(all).toContain(`1${NB}min${NB}00`)
      void t3
    })
  }

  for (const surface of SURFACES) {
    test(`requêtes : une question à boutons sort du temps actif, sauf les appels d'un sous-agent pendant ce temps (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      // Sous le plugin : la question attend la réponse de l'utilisateur, ici 10 min, pendant lesquelles un sous-agent appelle le modèle.
      let during: () => Promise<void> = async () => {}
      on('tool.call', { tool: 'AskUserQuestion' }, async () => {
        await clock.advance(2 * 60_000)
        await during()
        await clock.advance(8 * 60_000 - 4000)
        return { result: { questions: [], answers: {} } }
      })
      await start($, clock, surface)
      const sentAt = clock.now()
      const t1 = await engine.send('Pose-moi la question puis continue')
      await engine.step(t1, OPUS(1000, 3000))
      await engine.spawn('a1')
      during = () => engine.agentStep('a1', OPUS(1000, 3000))
      const asked = clock.now()
      await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
      const answered = clock.now()
      await engine.step(t1, OPUS(1000, 3000))
      await engine.finish(t1)
      await clock.advance(6000)
      // Le relevé garde l'attente et l'appel du sous-agent pendant l'attente.
      const log = Object.values(logsOf(seen))[0]
      const r = log.requests[0]
      expect(r.waits).toEqual([[asked, answered]])
      expect(r.busy).toEqual([[asked + 2 * 60_000, asked + 2 * 60_000 + 4000]])
      expect(r.realMs).toBe(answered + 4000 - sentAt)
      const pane = await mountPane($, surface, 100)
      await pane.press({ key: 'tab-discussion' })
      const all = await drawn(pane)
      // 4 s avant la question, 4 s d'appel du sous-agent, 4 s après : 12 s actives ; 10 min moins 4 s d'attente.
      expect(all).toMatch(new RegExp(`"Temps actif".{0,300}12${NB}s`))
      expect(all).toContain('Attente de ta réponse')
      expect(all).toMatch(new RegExp(`"Attente de ta réponse".{0,300}9${NB}min${NB}56`))
      expect(all).toContain(`attente${NB}9${NB}min${NB}56`)
    })
  }

  test('requêtes : un caractère de contrôle en tête de message ne passe pas dans le dessin', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const engine = requestEngine(on, clock)('terminal', $)
    await start($, clock, 'terminal')
    const t1 = await engine.send('\u001b[31mFAIL\u001b[0m tests\u0007 cassés')
    await engine.finish(t1)
    const pane = await mountPane($, 'terminal', 100)
    await pane.press({ key: 'tab-discussion' })
    const all = await drawn(pane)
    expect(all).toContain('[31mFAIL[0m tests cassés')
    expect(all).not.toMatch(/\\u00(1b|07)/)
  })

  test('requêtes : un modèle sans tarif est estimé au prorata du coût de la session, et marqué ≈', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on)
    const engine = requestEngine(on, clock)('terminal', $)
    await start($, clock, 'terminal')
    const t1 = await engine.send('Résume ce fichier')
    await engine.step(t1, { model: 'claude-opus-4-5-20251101', wait: 100, generate: 900, tokens: [10, 100, 0, 1000] })
    await engine.finish(t1)
    await clock.advance(1000)
    const [log] = Object.values(logsOf(seen))
    // Le seul appel de la session : il prend les 21,50 $ du moteur, estimés.
    expect(log.requests[0].models['claude-opus-4-5-20251101']).toMatchObject({ isEstimated: true, cost: 21.5 })
    const pane = await mountPane($, 'terminal', 100)
    await pane.press({ key: 'tab-discussion' })
    const all = await drawn(pane)
    expect(all).toContain(`≈21,50${NB}$`)
    // Le prorata couvre tout le coût de la session : pas d'écart.
    expect(all).not.toContain(`écart${NB}de`)
  })

  test('requêtes : un message tapé pendant un tour et livré au tour suivant ne compte qu’une fois', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on)
    const engine = requestEngine(on, clock)('terminal', $)
    await start($, clock, 'terminal')
    const t1 = await engine.send('Écris le plan')
    await engine.step(t1, OPUS(500, 1500))
    // Tapé pendant le tour, le message attend : il démarre le tour suivant, avec le même texte.
    await engine.send('et le lint ?', t1)
    await engine.step(t1, OPUS(500, 500))
    await engine.finish(t1)
    await $.turn.start({ text: 'et le lint ?', turnId: 't9' } as any)
    await engine.step('t9', OPUS(500, 500))
    await engine.finish('t9')
    await clock.advance(1000)
    const [log] = Object.values(logsOf(seen))
    // La requête 2 part à l'envoi, prend la fin du tour 1 et tout le tour 2.
    expect(log.requests.map((r: any) => [r.id, r.realMs, r.apiMs])).toEqual([
      [1, 2000, 2000],
      [2, 2000, 2000],
    ])
  })

  test('requêtes : la fin de la session écrit le relevé tout de suite', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on)
    const engine = requestEngine(on, clock)('terminal', $)
    await start($, clock, 'terminal')
    const t1 = await engine.send('Une question rapide')
    await engine.step(t1, OPUS(100, 400))
    await engine.finish(t1)
    // `claude -p` ou `/exit` juste après : pas le temps du regroupement des écritures.
    await $.session.end({ reason: 'other' } as any)
    const [log] = Object.values(logsOf(seen))
    expect(log.requests).toHaveLength(1)
    expect(log.requests[0]).toMatchObject({ realMs: 500, isOpen: false })
  })

  /** La requête `id` du seul relevé écrit. */
  const requestOf = (seen: ReturnType<typeof world>, id = 1) => (Object.values(logsOf(seen))[0] as any).requests.find((r: any) => r.id === id)

  for (const surface of SURFACES) {
    test(`requêtes : un sous-agent de fond, puis sa notification ; ses appels comptent dans la requête (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, 'terminal')
      const t1 = await engine.send('Lance un sous-agent')
      await engine.step(t1, OPUS(500, 1500))
      await engine.spawn('a1')
      await engine.agentStep('a1', OPUS(1000, 3000))
      await engine.finish(t1, ['a1'])
      await clock.advance(1000)
      // Le fil principal a fini, le sous-agent tourne encore.
      expect(requestOf(seen)).toMatchObject({ isOpen: false, tasks: 1, agents: 1, realMs: 6000 })
      await clock.advance(9000)
      await engine.agentFinish('a1')
      const t2 = await engine.agentDone('a1')
      await engine.step(t2, OPUS(500, 500))
      await engine.finish(t2)
      await clock.advance(1000)
      // De l'envoi à la fin du tour relancé : 17 s ; 2 + 4 + 1 s d'appels.
      expect(requestOf(seen)).toMatchObject({ id: 1, isOpen: false, tasks: 0, agents: 1, realMs: 17_000, apiMs: 7000 })
      expect(requestOf(seen).models['claude-opus-5-5'].calls).toBe(3)
      expect(Object.values(logsOf(seen))[0].requests).toHaveLength(1)
    })

    test(`requêtes : deux tâches qui finissent l’une après l’autre allongent la requête jusqu’à la dernière (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, 'terminal')
      const t1 = await engine.send('Lance deux shells')
      await engine.step(t1, OPUS(500, 500))
      await engine.finish(t1, ['b1', 'b2'])
      await clock.advance(5000)
      const t2 = await engine.shellDone('b1')
      await engine.step(t2, OPUS(500, 500))
      await engine.finish(t2, ['b2'])
      await clock.advance(1000)
      expect(requestOf(seen)).toMatchObject({ tasks: 1, realMs: 7000 })
      await clock.advance(4000)
      const t3 = await engine.shellDone('b2')
      await engine.step(t3, OPUS(500, 500))
      await engine.finish(t3)
      await clock.advance(1000)
      expect(requestOf(seen)).toMatchObject({ tasks: 0, realMs: 13_000, apiMs: 3000 })
    })

    test(`requêtes : la tâche d’une requête d’avant la prolonge après le message suivant, sans double compte du temps actif (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, 'terminal')
      const t1 = await engine.send('Lance un shell de fond')
      await engine.step(t1, OPUS(500, 500))
      await engine.finish(t1, ['b1'])
      await clock.advance(4000)
      const t2 = await engine.send('Pendant ce temps, dis bonjour')
      await engine.step(t2, OPUS(500, 1500))
      await engine.finish(t2, ['b1'])
      await clock.advance(3000)
      const t3 = await engine.shellDone('b1')
      await engine.step(t3, OPUS(500, 500))
      await engine.finish(t3)
      await clock.advance(1000)
      // La requête 1 va de 0 à 11 s, la 2 de 5 à 7 s : elles se chevauchent.
      expect(requestOf(seen, 1)).toMatchObject({ realMs: 11_000, tasks: 0, apiMs: 2000 })
      expect(requestOf(seen, 2)).toMatchObject({ realMs: 2000, tasks: 0, apiMs: 2000 })
      const pane = await mountPane($, surface, 100)
      await pane.press({ key: 'tab-discussion' })
      const all = await drawn(pane)
      // Temps actif : 11 s, pas 13 s.
      expect(all).toContain(`"Temps actif"`)
      expect(all).toMatch(new RegExp(`Temps actif.{0,400}11${NB}s`))
      expect(all).not.toMatch(new RegExp(`Temps actif.{0,400}13${NB}s`))
    })

    test(`requêtes : un serveur qui ne notifie jamais n’allonge pas la durée réelle (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, 'terminal')
      const t1 = await engine.send('Lance le serveur')
      await engine.step(t1, OPUS(500, 500))
      await engine.finish(t1, ['srv'])
      await clock.advance(60_000)
      expect(requestOf(seen)).toMatchObject({ isOpen: false, tasks: 1, realMs: 1000 })
      const pane = await mountPane($, surface, 100)
      await pane.press({ key: 'tab-discussion' })
      const all = await drawn(pane)
      expect(all).toContain(`1${NB}en${NB}fond`)
      expect(all).toContain(`réelle${NB}1${NB}s`)
    })

    test(`requêtes : une tâche planifiée et le message d’une autre session sont hors requête (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, 'terminal')
      const t1 = await engine.send('bonjour')
      await engine.step(t1, OPUS(500, 500))
      await engine.finish(t1)
      await clock.advance(10_000)
      const t2 = await engine.relaunch('tâche planifiée', 'scheduled-trigger')
      await engine.step(t2, OPUS(500, 500))
      // Le shell que lance la tâche planifiée n'est pas à la requête 1.
      await engine.finish(t2, ['b7'])
      await clock.advance(5000)
      const t3 = await engine.shellDone('b7')
      await engine.step(t3, OPUS(500, 500))
      await engine.finish(t3)
      const t4 = await engine.agentDone('autre-session')
      await engine.step(t4, OPUS(500, 500))
      await engine.finish(t4)
      await clock.advance(1000)
      const [log] = Object.values(logsOf(seen)) as any[]
      expect(log.requests).toHaveLength(1)
      expect(log.requests[0]).toMatchObject({ realMs: 1000, apiMs: 1000, tasks: 0 })
      expect(log.outside['claude-opus-5-5']).toMatchObject({ calls: 3, apiMs: 3000 })
    })

    test(`requêtes : après une interruption, la notification d’une tâche inconnue reprend la requête (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, 'terminal')
      const t1 = await engine.send('Lance un shell puis attends')
      await engine.step(t1, OPUS(500, 500))
      await engine.abort(t1)
      await clock.advance(30_000)
      expect(requestOf(seen)).toMatchObject({ isOpen: false, realMs: 1000 })
      // Le shell lancé dans le tour interrompu n'était dans aucune liste.
      const t2 = await engine.shellDone('b9')
      await engine.step(t2, OPUS(500, 500))
      await engine.finish(t2)
      await clock.advance(1000)
      expect(requestOf(seen)).toMatchObject({ isOpen: false, realMs: 32_000, apiMs: 2000 })
    })

    test(`requêtes : un agent encore actif retient une requête interrompue (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, 'terminal')
      const t1 = await engine.send('Lance un sous-agent')
      await engine.spawn('a1')
      engine.setAgents([{ id: 'a1', status: 'running', type: 'general-purpose', description: 'a1' }])
      await engine.abort(t1)
      await clock.advance(1000)
      expect(requestOf(seen)).toMatchObject({ isOpen: false, tasks: 1, agents: 1 })
    })

    test(`requêtes : un sous-agent de sous-agent compte pour la requête de son parent (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, 'terminal')
      const t1 = await engine.send('Lance un sous-agent')
      await engine.spawn('a1')
      await engine.finish(t1, ['a1'])
      await clock.advance(2000)
      // Un autre message ; puis l'agent a1 lance son propre sous-agent.
      const t2 = await engine.send('autre chose')
      await engine.finish(t2, ['a1'])
      await engine.spawn('a2', 'a1')
      await engine.agentStep('a2', OPUS(1000, 1000))
      await engine.agentFinish('a2', ['a1'])
      await clock.advance(1000)
      expect(requestOf(seen, 1)).toMatchObject({ agents: 2, apiMs: 2000 })
      expect(requestOf(seen, 2)).toMatchObject({ agents: 0, apiMs: 0 })
    })

    test(`requêtes : l’écart avec le coût de la session est signalé au-delà de 2 % (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, 'terminal')
      const t1 = await engine.send('bonjour')
      await engine.step(t1, OPUS(500, 500))
      await engine.finish(t1)
      const pane = await mountPane($, surface, 100)
      await pane.press({ key: 'tab-discussion' })
      // 0,144 $ suivis pour 21,50 $ de session : 99 % d'écart.
      const all = await drawn(pane)
      expect(all).toContain(`écart de 99${NB}% avec le coût de la session`)
      expect(all).toContain('Réécrire et Effort auto')
    })

    test(`requêtes : un message pendant le tour relancé d'une requête d'avant la clôt (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, surface)
      const t1 = await engine.send('Lance un shell de fond')
      await engine.step(t1, OPUS(500, 500))
      await engine.finish(t1, ['b1'])
      const t2 = await engine.send('autre chose')
      await engine.finish(t2, ['b1'])
      await clock.advance(5000)
      // La tâche de la requête 1 relance un tour ; un message arrive pendant ce tour.
      const t3 = await engine.shellDone('b1')
      await clock.advance(1000)
      await engine.send('et encore', t3)
      await clock.advance(1000)
      await engine.finish(t3)
      await clock.advance(60_000)
      expect(requestOf(seen, 1)).toMatchObject({ isOpen: false, realMs: 7000 })
      expect(requestOf(seen, 3)).toMatchObject({ isOpen: false, realMs: 1000 })
    })

    test(`requêtes : une notification livrée pendant un tour libère sa tâche, sans créer de tour (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, surface)
      const t1 = await engine.send('Lance deux shells')
      await engine.finish(t1, ['b1', 'b2'])
      await clock.advance(5000)
      const t2 = await engine.shellDone('b2')
      await clock.advance(1000)
      await $.prompt.submit({ text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>', wait: false, origin: { kind: 'task-notification' }, turnId: t2 } as any)
      await engine.abort(t2)
      await clock.advance(1000)
      expect(requestOf(seen)).toMatchObject({ tasks: 0, realMs: 6000 })
    })

    test(`requêtes : sans liste des tâches de fond, les agents actifs en tiennent lieu (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on)
      const engine = requestEngine(on, clock)(surface, $)
      await start($, clock, surface)
      const t1 = await engine.send('Lance un sous-agent')
      await engine.spawn('a1')
      engine.setAgents([{ id: 'a1', status: 'running', type: 'general-purpose', description: 'a1' }])
      // Une version de Claude Code sans `background_tasks`.
      await $.classic.Stop({ stop_hook_active: false } as any)
      await $.turn.complete({ answer: '', durationMs: 1, turnId: t1, reason: 'answer' } as any)
      await clock.advance(1000)
      expect(requestOf(seen)).toMatchObject({ tasks: 1, agents: 1 })
    })
  }

  test('requêtes : deux sessions (après /clear), deux fichiers de relevé distincts', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const session = { id: 's1' }
    const seen = world(on, { session })
    const engine = requestEngine(on, clock)('terminal', $)
    await start($, clock, 'terminal')
    const first = clock.now()
    const t1 = await engine.send('premier')
    await engine.finish(t1)
    await clock.advance(5000)
    session.id = 's2'
    const second = clock.now()
    const t2 = await engine.send('second')
    await engine.finish(t2)
    await clock.advance(1000)
    const logs = logsOf(seen)
    expect(Object.keys(logs).sort()).toEqual([`s1_${first}.json`, `s2_${second}.json`])
    expect(logs[`s1_${first}.json`].requests).toHaveLength(1)
    expect(logs[`s2_${second}.json`].requests).toHaveLength(1)
  })

  // Trois requêtes déjà relevées : deux qui se chevauchent le 7 octobre (10:00–10:30 sur la démo,
  // 10:15–10:45 sur l'API), une le 6 (14:00–15:00 sur la démo). Heures de Paris (UTC+2).
  const paris = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h - 2, m)
  const requestLog = (session: string, project: string, list: [sentAt: number, minutes: number, apiMs: number][]) => ({
    schema: 1,
    session,
    openedAt: list[0]![0],
    project,
    requests: list.map(([sentAt, minutes, apiMs], i) => ({
      id: i + 1,
      sentAt,
      endedAt: sentAt + minutes * 60_000,
      realMs: minutes * 60_000,
      isOpen: false,
      tasks: 0,
      apiMs,
      agents: 0,
      models: { 'claude-opus-5-5': { calls: 1, input: 1, output: apiMs * 0.02, cacheWrite: 0, cacheRead: 0, apiMs, genMs: apiMs / 2, cost: 0.1, isEstimated: false, speeds: { '40': 1 } } },
    })),
    outside: {},
  })
  const REQUEST_FILES = {
    [`s1_${paris(7, 10)}.json`]: requestLog('s1', HERE_KEY, [[paris(7, 10), 30, 600_000]]),
    [`s2_${paris(7, 10, 15)}.json`]: requestLog('s2', OTHER_KEY, [[paris(7, 10, 15), 30, 300_000]]),
    [`s1_${paris(6, 14)}.json`]: requestLog('s1', HERE_KEY, [[paris(6, 14), 60, 120_000]]),
  }

  test('durées : les totaux partent dans un fichier par mois, pas dans le store', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on, { requestFiles: REQUEST_FILES })
    await start($, clock, 'terminal')
    const month = Object.entries(seen.written).find(([p]) => p.endsWith('/.claude/stats-board/totaux/2026-10.json'))
    expect(month).toBeDefined()
    const part = JSON.parse(month![1])
    expect(part).toMatchObject({ v: 1, month: '2026-10' })
    expect(part.active.map((r: any) => r.date).sort()).toEqual(['2026-10-06', '2026-10-07', '2026-10-07'])
    expect(Object.keys(part.files)).toHaveLength(3)
    // Le store ne garde que le reste du relevé : ni les durées de ce poste, ni celles des autres.
    const snap = seen.stored.snapshot as any
    expect(snap.durations).toEqual({ since: null, files: {}, api: [], active: [], hours: [], sessions: [], times: [] })
    expect(snap.peers).toBeUndefined()
  })

  test('durées : au démarrage, les totaux se relisent depuis leurs fichiers, sans relevé', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // Ce qu'une session précédente a laissé : un relevé tout frais dans le store, sans durées, et les totaux du mois.
    const logs = Object.fromEntries(Object.entries(REQUEST_FILES).map(([name, log]) => [name, parseRequestLog(JSON.parse(JSON.stringify(log)))]))
    const durations = await refreshDurations(EMPTY_DURATIONS, Object.keys(logs).map((name) => ({ name, mtimeMs: 0 })), async (name) => logs[name] as any, -120, 'Portable')
    const totals = Object.fromEntries([...monthsOf(durations)].map(([month, part]) => [`${month}.json`, part]))
    const usage = (date: string) => ({ date, project: HERE_KEY, machine: 'Portable', model: 'claude-opus-5-5', input: 10, output: 400, cacheWrite: 0, cacheRead: 0, cost: 1 })
    const snapshot = { schema: SCHEMA, fetchedAt: NOW, tzOffset: -120, rows: [usage('2026-10-06'), usage('2026-10-07')], sessions: [], blocks: [], activity: null, projects: {}, unpriced: [], isOffline: false, machine: 'Portable', machines: ['Portable'], sessionless: [], version: null, keptDays: 0, warnings: [], durations: EMPTY_DURATIONS }
    const seen = world(on, { store: { snapshot }, totals })
    await start($, clock, 'terminal')
    // Pas de relevé (le dernier est frais), et pourtant les durées sont là.
    expect(seen.ccusage()).toEqual([])
    const all = await drawn(await mountPane($, 'terminal', 120))
    expect(all).toContain(`durée${NB}suivie${NB}depuis${NB}le${NB}06/10`)
    expect(all).toMatch(new RegExp(`"Temps actif".{0,300}1${NB}h${NB}45`))
  })

  test('durées : un dossier de totaux impossible à écrire se signale dans l’en-tête', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on, { requestFiles: REQUEST_FILES, totalsReadOnly: true })
    await start($, clock, 'terminal')
    const all = await drawn(await mountPane($, 'terminal', 120))
    expect(all).toMatch(/Totaux de durée : écriture impossible/)
    // Les durées, elles, sont là.
    expect(all).toMatch(new RegExp(`"Temps actif".{0,300}1${NB}h${NB}45`))
  })

  test('durées : sans la liste des fichiers de relevé, aucun mois de totaux n’est réécrit', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const logs = Object.fromEntries(Object.entries(REQUEST_FILES).map(([name, log]) => [name, parseRequestLog(JSON.parse(JSON.stringify(log)))]))
    const durations = await refreshDurations(EMPTY_DURATIONS, Object.keys(logs).map((name) => ({ name, mtimeMs: 0 })), async (name) => logs[name] as any, -120, 'Portable')
    const totals = Object.fromEntries([...monthsOf(durations)].map(([month, part]) => [`${month}.json`, part]))
    // Un mois de départ qui diffère du recalcul : sans le garde-fou, il serait réécrit.
    const october = totals['2026-10.json'] as any
    const seen = world(on, { totals: { ...totals, '2026-10.json': { ...october, active: [...october.active, { ...october.active[0], requests: 99 }] } }, requestsListFails: true })
    const before = Object.entries(seen.written).filter(([p]) => p.includes('/stats-board/totaux/'))
    await start($, clock, 'terminal')
    const after = Object.entries(seen.written).filter(([p]) => p.includes('/stats-board/totaux/'))
    expect(after).toEqual(before)
  })

  for (const [label, hasTotals] of [
    ['sans totaux, le relevé reste net : il publie', false],
    ['sous des totaux (dossier effacé) : totaux gardés, coûts publiés, un avertissement, pas de relance', true],
  ] as const) {
    test(`durées : pas encore de dossier de relevés, ${label}`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const logs = Object.fromEntries(Object.entries(REQUEST_FILES).map(([name, log]) => [name, parseRequestLog(JSON.parse(JSON.stringify(log)))]))
      const durations = await refreshDurations(EMPTY_DURATIONS, Object.keys(logs).map((name) => ({ name, mtimeMs: 0 })), async (name) => logs[name] as any, -120, 'Portable')
      const totals = hasTotals ? Object.fromEntries([...monthsOf(durations)].map(([month, part]) => [`${month}.json`, part])) : undefined
      const seen = world(on, { noRequestsDir: true, totals })
      const before = Object.entries(seen.written).filter(([p]) => p.includes('/stats-board/totaux/'))
      await start($, clock, 'terminal')
      const all = await drawn(await mountPane($, 'terminal', 120))
      // À la mise à jour, aucun poste n'a encore de dossier de relevés : ses coûts partent quand même.
      // Effacé sous des totaux : les totaux restent, les coûts partent, l'en-tête le dit (décision « Dossier perdu »).
      expect(seen.git().some((c) => c.startsWith('commit') || c.startsWith('push'))).toBe(true)
      expect(/totaux lus en partie/.test(all)).toBe(false)
      expect(/dossier des relevés introuvable/.test(all)).toBe(hasTotals)
      if (hasTotals) {
        expect(Object.entries(seen.written).filter(([p]) => p.includes('/stats-board/totaux/'))).toEqual(before)
        expect(all).toMatch(new RegExp(`"Temps actif".{0,300}1${NB}h${NB}45`))
        // Le relevé automatique de l'ouverture (3 s) passe, puis plus aucun : pas de relance.
        await clock.advance(5_000)
        await clock.settle()
        const loads = seen.ccusage().length
        await clock.advance(50_000)
        await clock.settle()
        expect(seen.ccusage().length).toBe(loads)
      }
    })
  }

  test('durées : des relevés non nets qui se suivent ne prévoient qu’une relance', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on, { requestFiles: REQUEST_FILES, totals: { '2026-10.json': '{"v":1,"month":"2026-' }, totalsMtime: NOW - 60_000 })
    await start($, clock, 'terminal')
    const perLoad = seen.ccusage().length
    const loads = () => seen.ccusage().length / perLoad
    // Le relevé automatique de l'ouverture (3 s), non net lui aussi : il armait une seconde relance (48 s).
    await clock.advance(3_000)
    await clock.settle()
    const before = loads()
    // La relance de 45 s, puis plus rien jusqu'à 51 s.
    await clock.advance(43_000)
    await clock.settle()
    await clock.advance(5_000)
    await clock.settle()
    expect(loads() - before).toBe(1)
  })

  for (const [label, mtime, isRewritten] of [
    ['récent, en cours d’écriture par une autre session : il n’est pas réécrit', NOW - 60_000, false],
    ['coupé depuis plus de 2 minutes, cassé pour de bon : il est réécrit depuis les relevés', NOW - 3 * 60_000, true],
    ['ancien, cassé pour de bon : il est réécrit depuis les relevés', NOW - 2 * 3_600_000, true],
  ] as const) {
    test(`durées : un mois illisible ${label}`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on, { requestFiles: REQUEST_FILES, totals: { '2026-10.json': '{"v":1,"month":"2026-' }, totalsMtime: mtime })
      await start($, clock, 'terminal')
      // Sur Mac, le chemin écrit peut différer du chemin donné au départ (chemin Windows) : on regarde toutes les copies.
      const texts = Object.entries(seen.written).filter(([p]) => p.endsWith('/stats-board/totaux/2026-10.json')).map(([, t]) => t)
      expect(texts.some((t) => t !== '{"v":1,"month":"2026-')).toBe(isRewritten)
      // Dans les deux cas, les durées affichées sont justes : refaites depuis les fichiers de relevé.
      const all = await drawn(await mountPane($, 'terminal', 120))
      expect(all).toMatch(new RegExp(`"Temps actif".{0,300}1${NB}h${NB}45`))
      // Récent : le relevé n'est pas net ; il ne publie rien, le dit, et repart sous une minute.
      expect(seen.git().some((c) => c.startsWith('commit') || c.startsWith('push'))).toBe(isRewritten)
      expect(/totaux lus en partie/.test(all)).toBe(!isRewritten)
      if (!isRewritten) {
        const before = seen.ccusage().length
        await clock.advance(46_000)
        await clock.settle()
        expect(seen.ccusage().length).toBeGreaterThan(before)
      }
    })
  }

  test('durées : sur un relevé net, un mois qui n’a plus rien est réécrit vide', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // Septembre garde les totaux d'un fichier de relevé qui n'existe plus.
    const ghost = { name: 'disparu.json', days: ['2026-09-20'] }
    const september = { v: 1, month: '2026-09', files: { [ghost.name]: { mtimeMs: 1, days: ghost.days } }, api: [], active: [{ date: '2026-09-20', project: HERE_KEY, machine: 'Portable', activeMs: 600_000, requests: 1 }], hours: [], sessions: [], times: [] }
    const seen = world(on, { requestFiles: REQUEST_FILES, totals: { '2026-09.json': september } })
    await start($, clock, 'terminal')
    const texts = Object.entries(seen.written).filter(([p]) => p.endsWith('/stats-board/totaux/2026-09.json')).map(([, t]) => JSON.parse(t))
    expect(texts.some((t) => t.active.length === 0 && Object.keys(t.files).length === 0)).toBe(true)
  })

  test('durées : à l’ouverture, celles des autres postes se relisent du clone local, sans relevé', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const usage = (date: string, machine = 'Portable') => ({ date, project: HERE_KEY, machine, model: 'claude-opus-5-5', input: 10, output: 400, cacheWrite: 0, cacheRead: 0, cost: 1 })
    const snapshot = { schema: SCHEMA, fetchedAt: NOW, tzOffset: -120, rows: [usage('2026-10-07'), usage('2026-10-07', 'Mac')], sessions: [], blocks: [], activity: null, projects: {}, unpriced: [], isOffline: false, machine: 'Portable', machines: ['Portable', 'Mac'], sessionless: [], version: null, keptDays: 0, warnings: [], durations: EMPTY_DURATIONS }
    const seen = world(on, { store: { snapshot }, mac: MAC_2 })
    await start($, clock, 'terminal')
    expect(seen.ccusage()).toEqual([])
    const pane = await mountPane($, 'terminal', 120)
    await pane.press({ key: 'machine-Mac' })
    const all = await drawn(pane)
    expect(all).toMatch(new RegExp(`"Temps actif".{0,300}20${NB}min${NB}00`))
  })

  for (const surface of SURFACES) {
    test(`durées : Journée, Aperçu et Évolution, depuis les fichiers de relevé (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      world(on, { requestFiles: REQUEST_FILES })
      await start($, clock, surface)
      const pane = await mountPane($, surface, 120)
      let all = await drawn(pane)
      expect(all).toContain(`durée${NB}suivie${NB}depuis${NB}le${NB}06/10`)
      // Aperçu : 45 min le 7 (sans double compte), 1 h le 6.
      expect(all).toMatch(new RegExp(`"Temps actif".{0,300}1${NB}h${NB}45`))
      expect(all).toMatch(new RegExp(`"Moyenne par jour actif".{0,300}52${NB}min${NB}30`))
      expect(all).toMatch(new RegExp(`"Jour record \\(temps\\)".{0,300}mar.${NB}6${NB}oct.`))
      // Journée : le temps actif et le temps API du jour, par projet et par discussion.
      await pane.press({ key: 'tab-day' })
      all = await drawn(pane)
      expect(all).toMatch(new RegExp(`"Temps actif".{0,300}45${NB}min${NB}00`))
      expect(all).toMatch(new RegExp(`"Temps API".{0,300}15${NB}min${NB}00`))
      expect(all).toContain(`actif${NB}30${NB}min${NB}00`)
      // Évolution : la durée comme troisième mesure.
      await pane.press({ key: 'tab-trend' })
      await pane.press({ key: 'period-7' })
      await pane.press({ key: 'metric-duration' })
      all = await drawn(pane)
      expect(all).toContain('Temps actif par jour')
      expect(all).toContain(`moyenne 52${NB}min${NB}30 par jour actif suivi`)
      // Un autre poste : sa durée n'est pas mesurée, « — » et jamais 0.
      await pane.press({ key: 'tab-overview' })
      await pane.press({ key: 'period-all' })
      await pane.press({ key: 'machine-Mac' })
      all = await drawn(pane)
      expect(all).toMatch(/"Temps actif".{0,300}"—"/)
      expect(all).not.toMatch(new RegExp(`"Temps actif".{0,300}0${NB}s`))
    })
  }

  for (const surface of SURFACES) {
    test(`durées : Projets, Modèles, Sessions et Rythme (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      world(on, { requestFiles: REQUEST_FILES })
      await start($, clock, surface)
      const pane = await mountPane($, surface, 140)
      // Projets : la démo, 1 h 30 de temps actif ; 20,60 $ sur ses jours suivis, soit 14 $ par heure active.
      await pane.press({ key: 'tab-projects' })
      let all = await drawn(pane)
      expect(all).toContain(`actif${NB}1${NB}h${NB}30`)
      expect(all).toContain(`14${NB}$/h${NB}actif`)
      // Une seule discussion par jour sur la démo : son temps cumulé vaut son temps actif.
      expect(all).toContain(`cumulé${NB}1${NB}h${NB}30`)
      // Modèles : 17 min d'API, 40 tok/s en moyenne pondérée, médiane des appels vers 45.
      await pane.press({ key: 'tab-models' })
      all = await drawn(pane)
      expect(all).toContain(`API${NB}17${NB}min${NB}00`)
      expect(all).toContain(`40${NB}tok/s (médiane${NB}~45)`)
      // Sessions : médiane et record sur le temps actif, et la durée médiane d'une requête.
      await pane.press({ key: 'tab-sessions' })
      await pane.press({ key: 'sort-active' })
      all = await drawn(pane)
      expect(all).toMatch(new RegExp(`"Durée médiane".{0,300}1${NB}h${NB}00`))
      expect(all).toMatch(new RegExp(`"Plus longue".{0,300}1${NB}h${NB}30`))
      expect(all).toMatch(new RegExp(`"Durée médiane d’une requête".{0,300}30${NB}min${NB}00`))
      // Rythme : le temps actif par heure, le plus à 14 h ; les cartes locales le disent.
      await pane.press({ key: 'tab-rhythm' })
      all = await drawn(pane)
      expect(all).toContain('Temps actif par heure')
      expect(all).toContain(`Le plus à 14${NB}h (1${NB}h${NB}00 sur la période)`)
      expect(all).toContain('Heures de début des sessions (ce poste)')
      // En temps cumulé, 10 h compte les deux discussions qui se chevauchent : 30 + 30 min, à égalité avec 14 h.
      await pane.press({ key: 'duration-cumul' })
      all = await drawn(pane)
      expect(all).toContain('Temps cumulé par heure')
      expect(all).toContain(`Le plus à 10${NB}h (1${NB}h${NB}00 sur la période)`)
      // Le choix vaut aussi pour l'Évolution en durée.
      await pane.press({ key: 'tab-trend' })
      await pane.press({ key: 'metric-duration' })
      all = await drawn(pane)
      expect(all).toContain('Temps cumulé par')
      await pane.press({ key: 'duration-active' })
      expect(await drawn(pane)).toContain('Temps actif par')
    })
  }

  // Le Mac publie ses durées : 20 min sur la démo le 7 octobre à 16 h, une session.
  const MAC_2 = {
    ...MAC,
    rows: [...MAC.rows, { ...urow('2026-10-07', '-Users-moi-projets-demo', 'claude-opus-5-5', 1), apiMs: 240_000, genMs: 120_000, calls: 4 }],
    sessions: [...MAC.sessions, { id: 'm2', project: '-Users-moi-projets-demo', parent: null, first: paris(7, 16), last: paris(7, 16, 20), cost: 1, tokens: 4, output: 1, models: ['claude-opus-5-5'], activeMs: 20 * 60_000, apiMs: 240_000, requests: 2 }],
    active: [{ date: '2026-10-07', project: '-Users-moi-projets-demo', activeMs: 20 * 60_000, requests: 2 }],
    hours: [{ date: '2026-10-07', hours: Array.from({ length: 24 }, (_, h) => (h === 16 ? 20 * 60_000 : 0)) }],
  }

  for (const surface of SURFACES) {
    test(`durées publiées : ce poste publie ses totaux, les vues comptent les autres postes (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = world(on, { requestFiles: REQUEST_FILES, mac: MAC_2 })
      await start($, clock, surface)
      // Ce poste publie ses durées, au même format : temps actif par jour et projet, par heure ; jamais ses requêtes.
      const text = Object.entries(seen.written).find(([p]) => p.endsWith('/claude-usage/machines/Portable.json'))![1]
      const published = JSON.parse(text)
      expect(published.schema).toBe(1)
      expect(published.active).toContainEqual({ date: '2026-10-07', project: HERE_KEY, activeMs: 30 * 60_000, requests: 1, cumulMs: 30 * 60_000 })
      expect(published.hours.find((h: any) => h.date === '2026-10-07').hours[10]).toBe(45 * 60_000)
      expect(published.hours.find((h: any) => h.date === '2026-10-07').cumul[10]).toBe(60 * 60_000)
      for (const key of ['"times"', '"seconds"', '"sentAt"', '"speeds"', '"files"', '.json"']) expect(text).not.toContain(key)
      const pane = await mountPane($, surface, 120)
      // Tous les postes : 45 + 20 min le 7, 1 h le 6.
      let all = await drawn(pane)
      expect(all).toMatch(new RegExp(`"Temps actif".{0,300}2${NB}h${NB}05`))
      // Le Mac ne publie pas encore de temps cumulé (d'avant la 0.11.0) : le 7 n'est pas mesuré, et c'est dit.
      expect(all).toMatch(new RegExp(`"Temps cumulé".{0,300}1${NB}h${NB}00`))
      expect(all).toMatch(/1.jour sans mesure \(poste pas à jour\)/)
      await pane.press({ key: 'tab-rhythm' })
      all = await drawn(pane)
      expect(all).toContain(`tous${NB}les${NB}postes`)
      // Filtre « Mac » : ses durées, suivies depuis le 07/10.
      await pane.press({ key: 'machine-Mac' })
      await pane.press({ key: 'tab-overview' })
      all = await drawn(pane)
      expect(all).toContain(`durée${NB}suivie${NB}depuis${NB}le${NB}07/10`)
      expect(all).toMatch(new RegExp(`"Temps actif".{0,300}20${NB}min${NB}00`))
      expect(all).toMatch(/"Temps cumulé".{0,300}"—"/)
      // Le Serveur ne publie pas de durée : elles ne sont pas mesurées.
      await pane.press({ key: 'machine-Serveur' })
      all = await drawn(pane)
      expect(all).toMatch(/"Temps actif".{0,300}"—"/)
      expect(all).toContain(`durée${NB}pas${NB}encore${NB}suivie`)
    })
  }

  for (const surface of SURFACES) {
    test(`onglet Journée : coût du jour, comparaisons, projets, discussions, modèles, blocs (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      world(on)
      await start($, clock, surface)
      const pane = await mountPane($, surface, 100)
      await pane.press({ key: 'tab-day' })
      const all = await drawn(pane)
      // Le 7 octobre : Opus 8 $ et Haiku 0,10 $ sur demo, Sonnet sans prix sur api ; 54 325 tokens.
      // Le terminal écrit le titre en capitales.
      expect(all).toMatch(/Coût d’aujourd’hui/i)
      expect(all).toContain(`8,10${NB}$`)
      expect(all).toContain(`54,3${NB}k`)
      // La veille : 12,50 $ ici et 1,50 $ sur le Serveur ; sur 30 jours, 4,10 $ par jour actif, et le 7 en 2e.
      expect(all).toContain(`−42${NB}% vs la veille`)
      expect(all).toContain(`14,00${NB}$`)
      expect(all).toContain(`4,10${NB}$`)
      expect(all).toContain(`n°${NB}2`)
      expect(all).toContain(`sur 6${NB}jours actifs`)
      // Les projets du jour, ce projet en tête ; la discussion s1 et son sous-agent, celle-ci.
      expect(all).toContain('Projets du jour')
      expect(all).toContain('ce projet')
      expect(all).toContain('Discussions du jour')
      expect(all).toContain(`6${NB}oct.–14:00`)
      expect(all).toContain('celle-ci')
      expect(all).toContain(`+1${NB}sous-agent`)
      expect(all).toContain(`21,80${NB}$`)
      for (const name of ['Opus', 'Haiku', 'Sonnet']) expect(all).toContain(name)
      expect(all).not.toContain('Fable')
      // Le bloc de 5 h en cours, de 13 h à 18 h à Paris.
      expect(all).toContain('13:00–18:00')
      expect(all).toContain(`4,2${NB}$/h${NB}·${NB}calme`)
      expect(all).toContain(`reste${NB}3${NB}h${NB}00`)
      // Un seul poste a travaillé ce jour-là : pas de carte par poste ; le cache de /stats s'arrête au 6.
      expect(all).not.toContain('Par poste')
      expect(all).not.toContain('Messages (ce poste)')
      // En tokens : demo fait 54 160 tokens ce jour-là.
      await pane.press({ key: 'metric-tokens' })
      expect(await drawn(pane)).toContain(`54,2${NB}k`)
      // Le Serveur n'a rien publié pour le 7.
      await pane.press({ key: 'machine-Serveur' })
      expect(await drawn(pane)).toContain('Aucune consommation aujourd’hui pour ces filtres.')
    })
  }

  for (const surface of SURFACES) {
    test(`onglet Journée : choisir un jour passé, puis revenir à aujourd’hui (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      world(on)
      await start($, clock, surface)
      const pane = await mountPane($, surface, 100)
      await pane.press({ key: 'tab-day' })
      let all = await drawn(pane)
      expect(all).toContain(`aujourd’hui,${NB}mer.${NB}7${NB}oct.`)
      expect(all).toContain(`◂${NB}veille`)
      // Aujourd'hui est le dernier jour : ni lendemain, ni retour.
      expect(all).not.toContain('lendemain')
      expect(all).not.toContain(`↺${NB}aujourd’hui`)
      // La veille : 12,50 $ ici et 1,50 $ sur le Serveur, sans la note d'un relevé ancien.
      await pane.press({ key: 'day-prev' })
      all = await drawn(pane)
      expect(all).toMatch(new RegExp(`Coût du mar\\.${NB}6${NB}oct\\.`, 'i'))
      expect(all).toContain(`14,00${NB}$`)
      expect(all).toContain('Par poste')
      expect(all).toContain(`lendemain${NB}▸`)
      expect(all).toContain(`↺${NB}aujourd’hui`)
      expect(all).not.toContain('Relevé du')
      // Le jour actif d'avant le 6 est le 2 (brouillon du desktop, 0,50 $), pas le 5.
      expect(all).toContain(`◂◂${NB}2${NB}oct.`)
      await pane.press({ key: 'day-prev-active' })
      all = await drawn(pane)
      expect(all).toMatch(new RegExp(`Coût du ven\\.${NB}2${NB}oct\\.`, 'i'))
      expect(all).toContain(`0,50${NB}$`)
      expect(all).toContain(`6${NB}oct.${NB}▸▸`)
      await pane.press({ key: 'day-latest' })
      expect(await drawn(pane)).toMatch(/Coût d’aujourd’hui/i)
    })
  }

  test('onglet Journée : un jour vide garde le choix du jour', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    await start($, clock, 'terminal')
    const pane = await mountPane($, 'terminal', 100)
    await pane.press({ key: 'tab-day' })
    await pane.press({ key: 'machine-Serveur' })
    expect(await drawn(pane)).toContain('Aucune consommation aujourd’hui pour ces filtres.')
    await pane.press({ key: 'day-prev' })
    const all = await drawn(pane)
    expect(all).toContain(`COÛT DU MAR.${NB}6${NB}OCT.`)
    expect(all).toContain(`1,50${NB}$`)
    // Un jour passé sans rien : un seul point après la date abrégée.
    await pane.press({ key: 'day-prev' })
    expect(await drawn(pane)).toContain(`Aucune consommation le${NB}lun.${NB}5${NB}oct. pour ces filtres.`)
    // /ccstats day revient à la journée du relevé.
    await $.command.run({ command: 'ccstats', args: 'day' } as any)
    await clock.settle()
    expect(await drawn(pane)).toContain('Aucune consommation aujourd’hui pour ces filtres.')
  })

  test('onglet Journée d’un relevé de la veille : son jour, et ↻ pour aujourd’hui', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const snapshot = {
      schema: 4,
      durations: { since: null, files: {}, api: [], active: [], hours: [], sessions: [] },
      fetchedAt: NOW - 86_400_000,
      tzOffset: -120,
      rows: [
        { date: '2026-10-06', project: HERE_KEY, machine: 'Portable', model: 'claude-opus-5-5', input: 1, output: 1, cacheWrite: 1, cacheRead: 1, cost: 7.25 },
        { date: '2026-10-06', project: 'C--dev-PolePredict', machine: 'Mac', model: 'claude-opus-5-5', input: 1, output: 1, cacheWrite: 1, cacheRead: 1, cost: 2.75 },
      ],
      sessions: [],
      blocks: [],
      activity: null,
      projects: {},
      unpriced: [],
      isOffline: false,
      machine: 'Portable',
      machines: ['Portable', 'Mac'],
      sessionless: [],
      version: '20.0.26',
      keptDays: 0,
      warnings: [],
    }
    world(on, { store: { snapshot } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: HERE } as any)
    const pane = await mountPane($, 'terminal', 100)
    await pane.press({ key: 'tab-day' })
    const all = await drawn(pane)
    expect(all).toContain(`Relevé du mar.${NB}6${NB}oct.`)
    expect(all).toContain(`COÛT DU MAR.${NB}6${NB}OCT.`)
    expect(all).toContain(`10,00${NB}$`)
    // Deux postes ce jour-là : la part de chacun.
    expect(all).toContain('Par poste')
    expect(all).toContain(`7,25${NB}$`)
    expect(all).toContain(`2,75${NB}$`)
  })

  test('/ccstats journée ouvre l’onglet Journée', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: HERE } as any)
    const res = await $.command.run({ command: 'ccstats', args: 'journée' } as any)
    await clock.settle()
    expect(JSON.stringify(res)).toContain('onglet Journée')
    expect(await drawn(await mountPane($, 'terminal'))).toMatch(/Coût d’aujourd’hui/i)
  })

  test('discussion toute neuve : ccusage répond null, pas d’erreur', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on, { isFresh: true })
    await start($, clock, 'terminal')
    const pane = await mountPane($, 'terminal', 100)
    await pane.press({ key: 'tab-discussion' })
    await pane.press({ key: 'discussion-refresh' })
    const all = await drawn(pane)
    expect(all).toContain('Pas encore d’appel enregistré')
    expect(all).not.toContain('impossible')
  })

  test('/ccstats discussion ouvre l’onglet et lance le détail', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: HERE } as any)
    await $.command.run({ command: 'ccstats', args: 'discussion' } as any)
    await clock.settle()
    expect(seen.details()).toHaveLength(1)
  })

  test('largeurs et surfaces : chaque onglet se dessine de 40 à 140 colonnes', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    await start($, clock, 'terminal')
    // Le détail de la discussion aussi : sa frise et ses listes à toutes les largeurs.
    await $.command.run({ command: 'ccstats', args: 'discussion' } as any)
    await clock.settle()
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      for (const width of [40, 80, 140]) {
        const pane = await mountPane($, surface, width)
        for (const tab of ['discussion', 'day', 'overview', 'trend', 'models', 'projects', 'sessions', 'rhythm']) {
          await pane.press({ key: `tab-${tab}` })
          const all = await drawn(pane)
          expect(all).toContain('Stats')
          expect(all.length).toBeLessThan(100_000)
        }
        await pane.unmount()
      }
    }
  })

  test('prix en ligne en échec : second essai avec les prix embarqués, signalé en tête', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on, { failOnline: true })
    await start($, clock, 'terminal')
    expect(seen.ccusage().filter((c) => c.includes('--offline')).length).toBeGreaterThanOrEqual(3)
    const pane = await mountPane($, 'terminal')
    expect(await drawn(pane)).toContain(`prix${NB}hors${NB}ligne`)
  })

  test('le dernier relevé est gardé : une nouvelle session l’affiche sans relancer ccusage', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const first = world(on)
    await start($, clock, 'terminal')
    expect(first.ccusage()).toHaveLength(3)
    // ↻ relance, et un message confirme.
    const pane = await mountPane($, 'terminal')
    await pane.press({ key: 'refresh' })
    await clock.settle()
    expect(first.ccusage()).toHaveLength(6)
    expect(await drawn(pane)).toMatch(/Relevé à jour/)
  })

  test('un relevé frais du store : pas de ccusage au démarrage, données tout de suite', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const snapshot = {
      schema: 4,
      durations: { since: null, files: {}, api: [], active: [], hours: [], sessions: [] },
      fetchedAt: NOW - 60_000,
      tzOffset: -120,
      rows: [{ date: '2026-10-07', project: HERE_KEY, machine: 'Portable', model: 'claude-opus-5-5', input: 1, output: 1, cacheWrite: 1, cacheRead: 1, cost: 7.25 }],
      sessions: [],
      blocks: [],
      activity: null,
      projects: {},
      unpriced: [],
      isOffline: false,
      machine: 'Portable',
      machines: ['Portable'],
      sessionless: [],
      version: '20.0.26',
      keptDays: 0,
      warnings: [],
    }
    const seen = world(on, { store: { snapshot } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: HERE } as any)
    await clock.advance(10_000)
    expect(seen.ccusage()).toHaveLength(0)
    const band = await mountBand($, 'terminal', 120)
    expect(await drawn(band)).toContain(`7,25${NB}$`)
  })

  test('projets du relevé gardé : un dossier faux est relu, ceux des autres postes reviennent de leurs fichiers', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const scratch = 'C:\\Users\\moi\\AppData\\Roaming\\Claude\\scratch-workspaces\\aaa\\scratch-2026-10-02-30c222'
    const snapshot = {
      schema: 4,
      durations: { since: null, files: {}, api: [], active: [], hours: [], sessions: [] },
      fetchedAt: NOW - 60_000,
      tzOffset: -120,
      rows: [],
      sessions: [],
      blocks: [],
      activity: null,
      // api lu jadis dans une session partie d'un brouillon ; PolePredict gardé sous un vieux nom.
      projects: {
        [OTHER_KEY]: { name: 'scratch-2026-10-02-30c222', path: scratch },
        'C--dev-PolePredict': { name: 'VieuxNom', path: 'C:\\dev\\VieuxNom' },
        '-Users-moi-dev-PolePredict': { name: 'VieuxNom', path: '/Users/moi/dev/VieuxNom' },
      },
      unpriced: [],
      isOffline: false,
      machine: 'Portable',
      machines: ['Portable'],
      sessionless: [],
      version: '20.0.26',
      keptDays: 0,
      warnings: [],
    }
    world(on, { store: { snapshot } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: HERE } as any)
    const pane = await mountPane($, 'terminal', 120)
    await pane.press({ key: 'refresh' })
    await clock.settle()
    await pane.press({ key: 'tab-projects' })
    const all = await drawn(pane)
    expect(all).toContain('api')
    expect(all).toContain('PolePredict')
    expect(all).not.toContain('VieuxNom')
  })

  test('sans dépôt claude-usage : ce poste seul, et un avertissement', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on, { noShare: true })
    await start($, clock, 'terminal')
    const all = await drawn(await mountPane($, 'terminal'))
    expect(all).toContain(`24,10${NB}$`)
    expect(all).toContain('Partage entre postes désactivé')
    expect(all).not.toContain(`Tous${NB}les${NB}postes`)
    expect(seen.git()).toEqual([])
  })

  test('une autre session tient le verrou git : on réessaie, sans avertissement', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on, { lockedAdds: 1 })
    await start($, clock, 'terminal')
    await clock.advance(10_000)
    // Le premier `add` refusé, le second passe, puis commit, rebase et push.
    expect(seen.git().slice(0, 8)).toEqual(['status --porcelain -- machines/Portable.json', 'add -- machines/Portable.json', 'status --porcelain -- machines/Portable.json', 'add -- machines/Portable.json', 'commit -q -m usage: Portable -- machines/Portable.json', 'pull --rebase -q', 'rev-list --count @{u}..HEAD', 'push -q'])
    expect(await drawn(await mountPane($, 'terminal'))).not.toContain('Partage entre postes')
  })

  test('verrou git toujours pris : pas d’avertissement s’il est récent (une autre session publie)', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on, { lockedAdds: 5 })
    await start($, clock, 'terminal')
    await clock.advance(10_000)
    // Trois essais par relevé, puis on laisse la publication à l'autre session.
    expect(seen.git().slice(0, 6).filter((c) => c.startsWith('add'))).toHaveLength(3)
    expect(seen.git().slice(0, 6)).not.toContain('commit -q -m usage: Portable -- machines/Portable.json')
    const all = await drawn(await mountPane($, 'terminal'))
    expect(all).not.toContain('Partage entre postes')
    expect(all).toContain(`68,60${NB}$`)
  })

  test('une autre session avance origin/main pendant le pull : on réessaie, sans avertissement', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on, { racedPulls: 1 })
    await start($, clock, 'terminal')
    // Le réessai part à 2 s, avant le relevé automatique de 3 s qui republierait de toute façon.
    await clock.advance(2_500)
    // Le premier `pull` refusé (`cannot lock ref`) et son rebase annulé, le second passe, puis le push.
    expect(seen.git().slice(0, 8)).toEqual(['status --porcelain -- machines/Portable.json', 'add -- machines/Portable.json', 'commit -q -m usage: Portable -- machines/Portable.json', 'pull --rebase -q', 'rebase --abort', 'status --porcelain -- machines/Portable.json', 'add -- machines/Portable.json', 'commit -q -m usage: Portable -- machines/Portable.json'])
    expect(seen.git().slice(8, 11)).toEqual(['pull --rebase -q', 'rev-list --count @{u}..HEAD', 'push -q'])
    expect(await drawn(await mountPane($, 'terminal'))).not.toContain('Partage entre postes')
  })

  test('origin/main toujours verrouillé : ni l’erreur ni le message du verrou abandonné (une autre session publie)', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // Même avec un vieux `index.lock` dans le dépôt : ce n'est pas lui qui bloque ici.
    const seen = world(on, { racedPulls: 5, staleLock: true })
    await start($, clock, 'terminal')
    await clock.advance(10_000)
    // Trois essais par relevé (status, add, commit, pull, rebase --abort), puis on laisse la publication à l'autre session.
    const first = seen.git().slice(0, 15)
    expect(first.filter((c) => c === 'pull --rebase -q')).toHaveLength(3)
    expect(first).not.toContain('push -q')
    const all = await drawn(await mountPane($, 'terminal'))
    expect(all).not.toContain('Partage entre postes')
    expect(all).toContain(`68,60${NB}$`)
  })

  test('sans nom de poste : rien de publié, les autres postes lus quand même', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on, { machine: null })
    await start($, clock, 'terminal')
    const all = await drawn(await mountPane($, 'terminal'))
    expect(all).toContain('n’a pas de nom')
    expect(all).toContain(`68,60${NB}$`)
    expect(all).toContain(`Ce${NB}poste`)
    expect(seen.git()).toEqual(['pull --ff-only'])
    expect(Object.keys(seen.written)).toEqual([])
  })

  test('un relevé gardé d’un autre format (ancien PC en projet à part) est écarté et refait', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const legacy = {
      fetchedAt: NOW - 60_000,
      tzOffset: -120,
      rows: [{ date: '2026-10-07', project: '@ancien-pc', model: 'claude-opus-5-5', input: 1, output: 1, cacheWrite: 1, cacheRead: 1, cost: 99 }],
      sessions: [],
      blocks: [],
    }
    const seen = world(on, { store: { snapshot: legacy } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: HERE } as any)
    expect(await drawn(await mountBand($, 'terminal', 120))).not.toContain(`99,00${NB}$`)
    await clock.advance(3_000)
    expect(seen.ccusage()).toHaveLength(3)
    expect(await drawn(await mountBand($, 'terminal', 120))).toContain(`8,10${NB}$`)
  })

  // ─── Grilles de cases du terminal (Raster) ─────────────────────────────

  /** Octets décrits par un base64 standard avec bourrage. */
  const bytesOf = (b64: string): number => (b64.length / 4) * 3 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)

  for (const surface of SURFACES) {
    test(`graphiques : grilles de cases sur le terminal, SVG sur le desktop (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      world(on)
      await start($, clock, surface)
      const pane = await mountPane($, surface)

      // Aperçu : le calendrier.
      const heat = await pane.find({ type: 'Raster', key: 'heat' })
      if (surface === 'desktop') {
        expect(await pane.findAll({ type: 'Raster' })).toHaveLength(0)
        expect(await drawn(pane)).toMatch(/Calendrier d'activité : \d+ jours actifs/)
      } else {
        expect(heat).toBeDefined()
        const { columns, rows, cells } = heat!.props as { columns: number; rows: number; cells: string }
        // 7 jours, une ou deux colonnes par semaine, dans les 80 colonnes du corps (3 pour les jours).
        expect(rows).toBe(7)
        expect(columns).toBeGreaterThan(0)
        expect(columns + 3).toBeLessThanOrEqual(80)
        expect(bytesOf(cells)).toBe(columns * rows * 12)
        const legend = await pane.find({ type: 'Raster', key: 'heat-legend' })
        expect(legend?.props).toMatchObject({ columns: 5, rows: 1 })
        expect(await drawn(pane)).toContain('Moins')
        // Plus de glyphes de niveau dans le calendrier.
        expect(await drawn(pane)).not.toContain('▒')
      }

      // Évolution : les colonnes empilées, 7 rangées, une ou deux colonnes par jour.
      await pane.press({ key: 'tab-trend' })
      const trend = await pane.find({ type: 'Raster', key: 'trend' })
      if (surface === 'desktop') {
        expect(await pane.findAll({ type: 'Raster' })).toHaveLength(0)
        expect(await drawn(pane)).toMatch(/empilé par modèle/)
      } else {
        const { columns, rows, cells } = trend!.props as { columns: number; rows: number; cells: string }
        expect(rows).toBe(7)
        expect(columns).toBeLessThanOrEqual(80)
        expect(bytesOf(cells)).toBe(columns * rows * 12)
      }

      // Sessions : les blocs de 5 h, 5 rangées.
      await pane.press({ key: 'tab-sessions' })
      const blocks = await pane.find({ type: 'Raster', key: 'blocks' })
      if (surface === 'desktop') expect(blocks).toBeUndefined()
      else expect(blocks?.props).toMatchObject({ rows: 5 })
    })
  }

  test('graphiques : sans Raster dans la table du terminal, les glyphes reviennent', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    // Un moteur dont la table du terminal n'a pas (encore) `Raster`.
    on('ui.resolve', async ($: any, e: any, next: any) => {
      const { Raster: _, ...rest } = await next(e)
      return rest
    })
    await start($, clock, 'terminal')
    const pane = await mountPane($, 'terminal')
    expect(await pane.findAll({ type: 'Raster' })).toHaveLength(0)
    const all = await drawn(pane)
    expect(all).toContain('Moins')
    expect(all).toMatch(/[░▒▓]/)
    await pane.press({ key: 'tab-trend' })
    expect(await pane.findAll({ type: 'Raster' })).toHaveLength(0)
    expect(await drawn(pane)).toMatch(/[▁▂▃▄▅▆▇█]/)
  })
})
