import { describe, expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'stats-board'
/** Le 7 octobre 2026 à 13 h UTC, 15 h à Paris. */
const NOW = Date.UTC(2026, 9, 7, 13, 0, 0)
const HOME = 'C:\\Users\\moi'
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
 * `noShare` : pas de dépôt `claude-usage` ; `machine` : le nom de ce poste (null : pas de `.machine`).
 */
type WorldOptions = { failOnline?: boolean; store?: Record<string, unknown>; cwd?: string; isFresh?: boolean; noShare?: boolean; machine?: string | null; lockedAdds?: number }

/** Ce que le moteur ferait seul : ccusage, Node, le disque, l'écran. */
function world(on: any, options: WorldOptions = {}) {
  const calls: string[][] = []
  const written: Record<string, string> = {}
  const machine = options.machine === undefined ? 'Portable' : options.machine
  // `git add` refusé tant qu'une autre session tient le verrou de l'index.
  let lockedAdds = options.lockedAdds ?? 0
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
  on('session.id', () => ({ value: 's1' }))
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
    const path = String(e.path).replace(/\\/g, '/')
    if (path.endsWith('/stats-cache.json')) return { value: JSON.stringify(STATS_CACHE) }
    if (path.endsWith('/claude-usage/.machine') && machine) return { value: `${machine}\n` }
    if (path.endsWith('/claude-usage/machines/Serveur.json')) return { value: JSON.stringify(SERVEUR) }
    if (path.endsWith('/claude-usage/machines/Mac.json')) return { value: JSON.stringify(MAC) }
    if (written[path] !== undefined) return { value: written[path] }
    if (path.includes(`/projects/${HERE_KEY}/`)) return { value: '{"type":"user","cwd":"C:\\\\Users\\\\moi\\\\projets\\\\demo"}\n' }
    if (path.includes(`/projects/${OTHER_KEY}/`)) return { value: '{"type":"user","cwd":"C:\\\\Users\\\\moi\\\\projets\\\\api"}\n' }
    if (path.includes(`/projects/${DRAFT_KEY}/`)) return { value: '{"cwd":"C:\\\\Users\\\\moi\\\\AppData\\\\Roaming\\\\Claude\\\\scratch-workspaces\\\\aaa\\\\scratch-2026-10-02-30c222"}\n' }
    throw new Error(`ENOENT ${path}`)
  })
  on('fs.write', ($: any, e: any) => {
    written[String(e.path).replace(/\\/g, '/')] = e.text
    return { value: undefined }
  })
  on('fs.exists', ($: any, e: any) => ({ value: !options.noShare && String(e.path).replace(/\\/g, '/').endsWith('/claude-usage/.git') }))
  on('fs.list', ($: any, e: any) => {
    const file = (name: string) => ({ name, kind: 'file', size: 200, mtimeMs: 0, isLink: false })
    if (String(e.path).replace(/\\/g, '/').endsWith('/claude-usage/machines')) return { value: [file('Mac.json'), file('Portable.json'), file('Serveur.json')] }
    return { value: [file('a.jsonl')] }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  mock.env(on, { USERPROFILE: HOME })
  mock.store(on, options.store ?? {})
  return {
    calls,
    written,
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

  test('onglet Journée d’un relevé de la veille : son jour, et ↻ pour aujourd’hui', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const snapshot = {
      schema: 3,
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
      schema: 3,
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
      schema: 3,
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
