import { describe, expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'git-board'
const ROOT = '/work'
const NUL = '\0'
const NOW = 1_759_510_000_000
// La ligne d'état attendue quand le bandeau est masqué (relais).
const STATUS = '⎇ feat/export ↑2 ↓1 · 4 modif.'

// Ce que le moteur joint à une commande tapée : d'où elle vient et la taille de l'affichage.
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PANE_PROPS = { title: 'Git', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }
const bandProps = (bodyColumns = 120, hasSurvey = false) => ({ hasSurvey, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} })

const ALL = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const BANDS = ['terminal', 'desktop'] as const
type Surface = (typeof ALL)[number]

type Answer = { exitCode: number; stdout: string; stderr: string }
type FakeOptions = {
  pr?: 'open' | 'none'
  outside?: string
  fetch?: 'fail'
  many?: boolean
  /** Remplace la réponse JSON de `gh pr view` (champs manquants, par exemple). */
  prBody?: Record<string, unknown>
  /** HEAD détachée : ni branche, ni branche suivie. */
  detached?: boolean
  /** Nombre de branches seulement distantes en plus de `origin/fix/login`. */
  remotes?: number
  /**
   * `feat/export` sans branche distante : `toMerge` commits absents de `main`
   * (`git rev-list --count`), `linked` dans un worktree lié plutôt que le principal,
   * `fresh` sans commit depuis sa création (son reflog commence à HEAD), `'ff'` aussi mais
   * avancée depuis par un fast-forward de main.
   */
  local?: { toMerge: number; linked?: boolean; fresh?: boolean | 'ff' }
}

// Un faux dépôt : ce que répond chaque commande git ou gh que le mod lance.
// `outside` : un dossier hors de tout dépôt, où chaque commande git échoue.
function fakeRepo(options: FakeOptions = {}) {
  const calls: string[][] = []
  const repo = { branch: 'feat/export', isDirty: true, oid: '1111111aaaaaaa', ahead: 2, behind: 1 }
  // CI : exécutions GitHub Actions du commit (`gh run list`), checks et tête de la PR ;
  // `ghMissing` : gh introuvable (process.run rejette).
  const ci = { runs: [] as Record<string, unknown>[], rollup: null as Record<string, unknown>[] | null, prHead: null as string | null, ghMissing: false }
  const ok = (stdout = ''): Answer => ({ exitCode: 0, stdout, stderr: '' })
  const ref = (name: string, head: boolean, upstream: string, track: string, date: number, subject: string, worktree = '') =>
    [name, head ? '*' : ' ', upstream, track, String(date), subject, head ? ROOT : worktree].join(NUL)

  const answer = (argv: readonly string[], cwd?: string): Answer => {
    calls.push([...argv])
    if (cwd !== undefined && cwd === options.outside) return { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }
    if (argv[0] === 'gh') {
      if (argv[1] === 'run') return ok(JSON.stringify(ci.runs))
      if (options.pr === 'none') return { exitCode: 1, stdout: '', stderr: `no pull requests found for branch "${repo.branch}"` }
      if (options.prBody) return ok(JSON.stringify(options.prBody))
      return ok(
        JSON.stringify({
          number: 7,
          title: 'feat: export CSV',
          url: 'https://github.com/matwi5/demo/pull/7',
          state: 'OPEN',
          isDraft: false,
          baseRefName: 'main',
          ...(ci.prHead ? { headRefOid: ci.prHead } : {}),
          reviewDecision: 'REVIEW_REQUIRED',
          statusCheckRollup: ci.rollup ?? [
            { status: 'COMPLETED', conclusion: 'SUCCESS' },
            { status: 'IN_PROGRESS', conclusion: '' },
          ],
        }),
      )
    }
    const args = argv.slice(argv.indexOf('color.ui=never') + 1)
    const isFeat = repo.branch === 'feat/export' && !options.detached
    switch (args[0]) {
      case 'rev-parse':
        if (args.includes('--git-common-dir')) return ok(options.local?.linked ? '/main/.git\n' : `${ROOT}/.git\n`)
        return ok(args.includes('--absolute-git-dir') ? (options.local?.linked ? '/main/.git/worktrees/export\n' : `${ROOT}/.git\n`) : `${ROOT}\n`)
      case 'fetch':
        return options.fetch === 'fail' ? { exitCode: 128, stdout: '', stderr: 'fatal: unable to access origin' } : ok()
      case 'remote':
        return ok('origin\n')
      case 'status':
        return ok(
          [
            `# branch.oid ${repo.oid}`,
            `# branch.head ${options.detached ? '(detached)' : repo.branch}`,
            ...(options.detached || (isFeat && options.local) ? [] : [`# branch.upstream origin/${repo.branch}`, isFeat ? `# branch.ab +${repo.ahead} -${repo.behind}` : '# branch.ab +0 -0']),
            '# stash 1',
            ...(repo.isDirty
              ? [
                  '1 .M N... 100644 100644 100644 aaa bbb src/app.ts',
                  '1 A. N... 000000 100644 100644 000 ccc src/new file.ts',
                  '2 R. N... 100644 100644 100644 ddd ddd R100 docs/guide.md',
                  'docs/old.md',
                  '? notes.txt',
                  ...(options.many ? Array.from({ length: 30 }, (_, i) => `? notes-${String(i).padStart(2, '0')}.txt`) : []),
                ]
              : []),
            '',
          ].join(NUL),
        )
      case 'diff':
        return ok(repo.isDirty ? ['3\t1\tsrc/app.ts', '10\t0\tsrc/new file.ts', '0\t0\t', 'docs/old.md', 'docs/guide.md', ''].join(NUL) : '')
      case 'for-each-ref':
        return ok(
          [
            options.local
              ? ref('refs/heads/feat/export', isFeat, '', '', 1_759_500_000, 'feat: export CSV')
              : ref('refs/heads/feat/export', isFeat, 'origin/feat/export', 'ahead 2, behind 1', 1_759_500_000, 'feat: export CSV'),
            ref('refs/heads/main', repo.branch === 'main', 'origin/main', '', 1_759_400_000, 'chore: init'),
            ref('refs/heads/claude/promo', false, '', '', 1_759_350_000, 'chore: promo', '/work-promo'),
            ref('refs/remotes/origin/HEAD', false, '', '', 1_759_400_000, 'chore: init'),
            ref('refs/remotes/origin/feat/export', false, '', '', 1_759_490_000, 'feat: début'),
            ref('refs/remotes/origin/main', false, '', '', 1_759_400_000, 'chore: init'),
            ref('refs/remotes/origin/fix/login', false, '', '', 1_759_300_000, 'fix: login'),
            ...Array.from({ length: options.remotes ?? 0 }, (_, i) => ref(`refs/remotes/origin/old/b${String(i).padStart(2, '0')}`, false, '', '', 1_759_200_000 - i, 'chore: vieux')),
          ].join('\n') + '\n',
        )
      case 'log':
        return ok(
          [
            ['h1full', 'h1', 'Mathis', '1759500000', 'HEAD -> feat/export, tag: v0.2.0', 'feat: export CSV'].join(NUL),
            ['h2full', 'h2', 'Mathis', '1759490000', 'origin/feat/export', 'feat: début'].join(NUL),
          ].join('\n') + '\n',
        )
      case 'rev-list':
        if (args.includes('--count')) return options.local ? ok(`${options.local.toMerge}\n`) : { exitCode: 1, stdout: '', stderr: 'inattendu : --count' }
        return ok('h1full\n')
      case 'reflog': {
        // Du plus récent au plus ancien : la création de la branche en dernier.
        const fresh = options.local?.fresh
        const created = `${fresh === true ? repo.oid : 'c0ffee0000000'}${NUL}branch: Created from main`
        const moved = fresh === true ? [] : [`${repo.oid}${NUL}${fresh === 'ff' ? 'merge main: Fast-forward' : 'commit: feat: export CSV'}`]
        return options.local ? ok([...moved, created].join('\n') + '\n') : { exitCode: 1, stdout: '', stderr: 'inattendu : reflog' }
      }
      case 'config':
        return ok('remote.origin.url git@github.com:matwi5/demo.git\n')
      case 'symbolic-ref':
        return ok('origin/main\n')
      case 'check-ref-format':
        return /\s/.test(args[args.length - 1] ?? '') ? { exitCode: 1, stdout: '', stderr: 'fatal: invalid' } : ok(`${args[args.length - 1]}\n`)
      case 'switch': {
        const target = args[args.length - 1] ?? ''
        repo.branch = target.replace(/^origin\//, '')
        return ok()
      }
      default:
        return { exitCode: 1, stdout: '', stderr: `inattendu : ${args.join(' ')}` }
    }
  }
  return {
    calls,
    repo,
    ci,
    answer,
    runs: () => calls.filter((c) => c[0] === 'gh' && c[1] === 'run'),
    switches: () => calls.filter((c) => c.includes('switch')).map((c) => c.slice(c.indexOf('switch'))),
    gh: () => calls.filter((c) => c[0] === 'gh').length,
  }
}

// Ce que le moteur ferait seul, et de quoi relever ce que le mod lui demande.
// `band` : sous le plugin, le bandeau vide du moteur, ou celui d'un autre plugin.
function engine(on: any, fake: ReturnType<typeof fakeRepo>, cwd = ROOT, band: 'engine' | 'other' = 'engine') {
  const ran: { command: string; args: string }[] = []
  const statuses: (string | undefined)[] = []
  const filled: string[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const suggested: string[] = []
  // Les commandes du plugin project connues du moteur ; vidée, le plugin est absent.
  const commands = ['commit', 'sync', 'push', 'pr', 'version']
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: cwd }))
  on('command.register', () => ({ value: {} }))
  on('ui.open', ($: any, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.status', ($: any, e: any) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($: any, e: any) => {
    if (e.argv[0] === 'gh' && fake.ci.ghMissing) return Promise.reject(new Error('spawn gh ENOENT'))
    return { value: fake.answer(e.argv, e.init?.cwd ?? cwd) }
  })
  on('tool.call', () => ({ result: {}, text: '' }))
  on('prompt.suggest', ($: any, e: any) => {
    suggested.push(e.text)
    return { isShown: true }
  })
  on('command.list', () => ({
    value: commands.map((n) => ({ name: `project:${n}`, description: '', source: 'plugin', plugin: 'project' })),
  }))
  on('command.run', ($: any, e: any) => {
    ran.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('prompt.fill', ($: any, e: any) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, () => (band === 'other' ? ({ type: 'Text', props: {}, children: ['AUTRE BANDEAU'] } as any) : ({ type: 'engine', ref: 0 } as const)))
  return { ran, statuses, filled, toasts, opened, suggested, commands }
}

async function start($: any, clock: any, surface: Surface = 'terminal', cwd = ROOT, folder = '') {
  await $.session.start({ surface, isInteractive: true, cwd } as any)
  await $.command.run({ command: 'git', args: folder })
  await clock.settle()
}

const mountPane = ($: any, surface: Surface, bodyColumns = 80) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'git', props: { ...PANE_PROPS, bodyColumns } } as any)

const mountBand = ($: any, surface: 'terminal' | 'desktop', bodyColumns = 120, hasSurvey = false) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(bodyColumns, hasSurvey) } as any)

async function openPane($: any, clock: any, surface: Surface, cwd = ROOT, folder = '') {
  await start($, clock, surface, cwd, folder)
  return mountPane($, surface)
}

describe('git-board', () => {
  for (const surface of BANDS) {
    test(`l'en-tête, les fichiers et la PR ; Commit lance /project:commit (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const fake = fakeRepo()
      const seen = engine(on, fake)
      const pane = await openPane($, clock, surface)

      expect(await pane.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
      // ↑/↓ dits une seule fois : en pastilles sur le terminal, dans la jauge SVG ailleurs.
      if (surface === 'terminal') {
        expect(await pane.find({ type: 'Text', text: /↑\s2\sà\spousser/ })).toBeDefined()
        expect(await pane.find({ type: 'Text', text: /↓\s1\sà\srécupérer/ })).toBeDefined()
      } else {
        expect(await pane.find({ type: 'Text', text: /↑\s2\sà\spousser/ })).toBeUndefined()
        expect(JSON.stringify(await pane.findAll({ type: 'Svg' }))).toMatch(/2 commits à pousser, 1 à récupérer/)
        // La route se parcourt dans l'ordre : un commit attend, donc rien après lui n'est fait ;
        // la PR #7 encore ouverte garde son numéro.
        expect(JSON.stringify(await pane.findAll({ type: 'Svg' }))).toMatch(/Commit : en cours/)
        expect(JSON.stringify(await pane.findAll({ type: 'Svg' }))).toMatch(/PR : à venir \(#7\)/)
        expect(JSON.stringify(await pane.findAll({ type: 'Svg' }))).not.toMatch(/: fait/)
      }
      expect(await pane.find({ type: 'Text', text: /●\s3\smodifiés/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /\+\s1\snouveau/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'app.ts' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: '+3' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'new file.ts' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /#7/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /en cours$/ })).toBeUndefined()
      // Groupes de modifications, onglets comptés, âge du fetch.
      expect(await pane.find({ type: 'Text', text: /Indexés/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /Nouveaux/ })).toBeDefined()
      expect(await pane.find({ type: 'Button', text: /Historique\s·\s2/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /fetch\sà\sl'instant/ })).toBeDefined()
      // Le bandeau est visible : la ligne d'état reste vide.
      expect(seen.statuses.at(-1)).toBeUndefined()
      // Le fetch a bien eu lieu à l'ouverture, et les lectures ne prennent pas de verrou.
      expect(fake.calls.some((c) => c.includes('fetch'))).toBe(true)
      expect(fake.calls.filter((c) => c[0] === 'git').every((c) => c[1] === '--no-optional-locks')).toBe(true)

      // L'étape suggérée est le seul primary ; tiroir ouvert, seul « ▶ Lancer » l'est.
      const primaries = async () => (JSON.stringify(await pane.drawn()).match(/"variant":"primary"/g) ?? []).length
      expect(await primaries()).toBe(1)
      await pane.press({ key: 'act-commit' })
      expect(await primaries()).toBe(1)
      // Le ✕ du tiroir n'est pas la fermeture native du panneau.
      expect(JSON.stringify(await pane.drawn())).not.toMatch(/dismiss/)
      await pane.input({ key: 'hint', text: 'export CSV', kind: 'change' })
      await pane.press({ key: 'launch' })
      expect(seen.ran).toEqual([{ command: 'project:commit', args: 'export CSV' }])
      expect(await pane.find({ type: 'Text', text: /\/project:commit export CSV en file/ })).toBeDefined()
      expect(seen.toasts.some((t) => /\/project:commit export CSV lancée/.test(t))).toBe(true)

      // Le tour de la commande commence puis finit : l'indicateur suit, un retour reste.
      await $.turn.start({ text: '', turnId: 't1' })
      expect(await pane.find({ type: 'Text', text: /en cours dans la conversation/ })).toBeDefined()
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
      expect(await pane.find({ type: 'Text', text: /en file|en cours dans la conversation/ })).toBeUndefined()
      expect(await pane.find({ type: 'Text', text: /\/project:commit export CSV : tour terminé/ })).toBeDefined()

      // Une commande restée en file sans ouvrir de tour : ↻ efface l'indicateur.
      await pane.press({ key: 'act-push' })
      await pane.press({ key: 'launch' })
      expect(await pane.find({ type: 'Text', text: /\/project:push en file/ })).toBeDefined()
      await pane.press({ key: 'refresh' })
      expect(await pane.find({ type: 'Text', text: /\/project:push en file/ })).toBeUndefined()
    })

    test(`branches : bascule confirmée, branche distante, création (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const fake = fakeRepo()
      const seen = engine(on, fake)
      const pane = await openPane($, clock, surface)

      await pane.press({ key: 'tab-branches' })
      expect(await pane.find({ type: 'Text', text: 'main' })).toBeDefined()
      // Extraite dans un autre worktree : pas de bascule possible d'ici.
      expect(await pane.find({ type: 'Text', text: /ouverte dans un autre worktree/ })).toBeDefined()
      expect(await pane.find({ type: 'Button', key: 'sw-claude/promo' })).toBeUndefined()
      // Des modifications suivies : la bascule demande d'abord confirmation.
      await pane.press({ key: 'sw-main' })
      expect(await pane.find({ type: 'Text', text: 'Basculer vers main ?' })).toBeDefined()
      expect(fake.switches()).toEqual([])
      await pane.press({ key: 'confirm-yes' })
      expect(fake.switches()).toEqual([['switch', 'main']])
      expect(await pane.find({ type: 'Text', text: '✓ Sur la branche main' })).toBeDefined()
      expect(seen.toasts).toContain('✓ Sur la branche main')

      // Une branche seulement distante : `switch --track` crée la branche locale.
      await pane.press({ key: 'remotes-toggle' })
      await pane.press({ key: 'swr-origin/fix/login' })
      await pane.press({ key: 'confirm-yes' })
      expect(fake.switches().at(-1)).toEqual(['switch', '--track', 'origin/fix/login'])

      // Un nom invalide est refusé avant git switch ; un bon nom crée et bascule.
      await pane.input({ key: 'new-branch', text: 'mauvais nom' })
      expect(await pane.find({ type: 'Text', text: /n'est pas un nom de branche valide/ })).toBeDefined()
      await pane.input({ key: 'new-branch', text: 'feat/csv' })
      expect(fake.switches().at(-1)).toEqual(['switch', '-c', 'feat/csv'])
    })

    test(`pull request : options passées à /project:pr, push sur la bonne commande (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const fake = fakeRepo({ pr: 'none' })
      const seen = engine(on, fake)
      const pane = await openPane($, clock, surface)

      expect(await pane.find({ type: 'Text', text: /pas encore de pull request/ })).toBeDefined()
      await pane.press({ key: 'act-pr' })
      await pane.select({ key: 'pr-draft', value: 'draft' })
      await pane.select({ key: 'pr-auto', value: 'auto' })
      await pane.press({ key: 'launch' })
      expect(seen.ran.at(-1)).toEqual({ command: 'project:pr', args: '--draft --auto' })

      // ↻ oublie la PR restée en file : une seule commande à la fois.
      await pane.press({ key: 'refresh' })
      await pane.press({ key: 'act-push' })
      await pane.press({ key: 'launch' })
      expect(seen.ran.at(-1)).toEqual({ command: 'project:push', args: '' })
    })

    test(`les boutons de lancement ne disent pas la commande qu'ils lancent (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      engine(on, fakeRepo({ pr: 'none' }))
      const pane = await openPane($, clock, surface)
      for (const a of ['commit', 'pull', 'push', 'pr']) {
        await pane.press({ key: `act-${a}` })
        expect((await pane.find({ type: 'Button', key: 'launch' }))?.text).toMatch(/^▶\sLancer$/)
      }
      await pane.press({ key: 'act-push' })
      expect((await pane.find({ type: 'Button', key: 'launch-version' }))?.text).toMatch(/^▶\sD'abord\sla\sversion$/)
      // Hors des boutons, la commande reste écrite.
      expect(await pane.find({ type: 'Text', text: /Avant de pousser : \/project:version/ })).toBeDefined()
      const band = await mountBand($, surface)
      expect((await band.find({ type: 'Button', key: 'git-band-open' }))?.text).toMatch(/^▸\sOuvrir$/)
      await band.unmount()
    })

    test(`tiroir Pull : « ▶ Lancer » depuis la branche distante, « ▶ Intégrer main » depuis la base (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = engine(on, fakeRepo())
      const pane = await openPane($, clock, surface)
      await pane.press({ key: 'act-pull' })
      expect(await pane.find({ type: 'Select', key: 'pull-from' })).toBeUndefined()
      expect(await pane.find({ type: 'Text', text: /Choix de la source/ })).toBeUndefined()
      expect((await pane.find({ type: 'Button', key: 'launch-base' }))?.text).toMatch(/^▶\sIntégrer\smain$/)
      await pane.press({ key: 'launch' })
      expect(seen.ran.at(-1)).toEqual({ command: 'project:sync', args: '' })
      expect(await pane.find({ type: 'Text', text: /\/project:sync en file/ })).toBeDefined()
      await pane.press({ key: 'refresh' })
      await pane.press({ key: 'act-pull' })
      await pane.press({ key: 'launch-base' })
      expect(seen.ran.at(-1)).toEqual({ command: 'project:sync', args: 'base' })
      expect(await pane.find({ type: 'Text', text: /\/project:sync base en file/ })).toBeDefined()
    })
  }

  test('tiroir Pull sur la branche par défaut : pas de « ▶ Intégrer »', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    fake.repo.branch = 'main'
    engine(on, fake)
    const pane = await openPane($, clock, 'terminal')
    await pane.press({ key: 'act-pull' })
    expect(await pane.find({ type: 'Button', key: 'launch' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'launch-base' })).toBeUndefined()
  })

  test('tiroir Pull d’une branche non publiée : « ▶ Intégrer main » sans « ▶ Lancer »', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ local: { toMerge: 3 } })
    const seen = engine(on, fake)
    const pane = await openPane($, clock, 'terminal')
    await pane.press({ key: 'act-pull' })
    expect(await pane.find({ type: 'Button', key: 'launch' })).toBeUndefined()
    await pane.press({ key: 'launch-base' })
    expect(seen.ran).toEqual([{ command: 'project:sync', args: 'base' }])
  })

  test('tiroir Pull hors du dépôt de la session : aucun bouton de lancement', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    engine(on, fakeRepo({ outside: '/elsewhere' }), '/elsewhere')
    const pane = await openPane($, clock, 'terminal', '/elsewhere', ROOT)
    await pane.press({ key: 'act-pull' })
    expect(await pane.find({ type: 'Text', text: /agissent sur le dossier de la session/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'launch' })).toBeUndefined()
    expect(await pane.find({ type: 'Button', key: 'launch-base' })).toBeUndefined()
  })

  test('un formulaire gardé avec l’ancien choix « depuis la base » se lit, et le choix est ignoré', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = engine(on, fakeRepo())
    const old = { hint: 'sujet gardé', pullFrom: 'base', prBase: '', prDraft: false, prAuto: false, filter: '', newBranch: '' }
    // Ce qu'une version précédente a gardé pour la session, lu jusqu'à la première écriture.
    let isSeeded = true
    on('state.set', (_$: any, e: any, next: any) => {
      if (e.plugin === PLUGIN && e.key === 'form') isSeeded = false
      return next(e)
    })
    on('state.get', (_$: any, e: any, next: any) => (isSeeded && e.plugin === PLUGIN && e.key === 'form' ? { value: { value: old, version: 0 } } : next(e)))
    const pane = await openPane($, clock, 'terminal')
    await pane.press({ key: 'act-pull' })
    await pane.press({ key: 'launch' })
    expect(seen.ran).toEqual([{ command: 'project:sync', args: '' }])
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
    // Le pull a bien lu le formulaire gardé : rien ne l'a réécrit depuis, et son indice part
    // avec le commit.
    expect(isSeeded).toBe(true)
    await pane.press({ key: 'act-commit' })
    await pane.press({ key: 'launch' })
    expect(seen.ran.at(-1)).toEqual({ command: 'project:commit', args: 'sujet gardé' })
  })

  for (const surface of BANDS) {

    test(`hors dépôt : le panneau le dit et la ligne d'état s'efface (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = engine(on, fakeRepo({ outside: ROOT }))
      const pane = await openPane($, clock, surface)

      expect(await pane.find({ type: 'Text', text: 'Pas de dépôt git ici' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /n'est pas dans un dépôt git/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /se remplit dès que/ })).toBeDefined()
      expect(seen.statuses.at(-1)).toBeUndefined()
    })

    test(`les commandes /project agissent sur la session ; retour au dossier de la session (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      // La session est ailleurs, hors de tout dépôt ; le panneau suit /work.
      const seen = engine(on, fakeRepo({ outside: '/elsewhere' }), '/elsewhere')
      const pane = await openPane($, clock, surface, '/elsewhere', ROOT)

      expect(await pane.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /hors du dossier de la session/ })).toBeDefined()
      await pane.press({ key: 'act-commit' })
      expect(await pane.find({ type: 'Button', key: 'launch' })).toBeUndefined()
      expect(await pane.find({ type: 'Text', text: /agissent sur le dossier de la session/ })).toBeDefined()
      expect(seen.ran).toEqual([])

      // Le bouton de l'en-tête ramène au dossier de la session (ici hors dépôt).
      await pane.press({ key: 'back-session' })
      expect(await pane.find({ type: 'Text', text: 'Pas de dépôt git ici' })).toBeDefined()
    })

    test(`le bandeau s'empile sous un autre bandeau sans l'effacer (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      engine(on, fakeRepo(), ROOT, 'other')
      await start($, clock, surface)

      const band = await mountBand($, surface)
      await band.drawn()
      expect(await band.find({ type: 'Text', text: /AUTRE BANDEAU/ })).toBeDefined()
      // Pas de trait horizontal : la barre de couleur et le nom séparent les bandeaux.
      expect(await band.find({ type: 'Text', text: /^─+$/ })).toBeUndefined()
      expect(await band.find({ type: 'Text', text: '▍' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /^\sGit\s+$/ })).toBeDefined()
      expect(await band.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
      expect(await band.find({ type: 'Button', key: 'git-band-open' })).toBeDefined()
      await band.unmount()
    })

    test(`le bandeau rend next(e) : sondage, bandeau masqué, hors dépôt (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const fake = fakeRepo()
      engine(on, fake, ROOT, 'other')
      await start($, clock, surface)

      const survey = await mountBand($, surface, 120, true)
      // Pendant un sondage, le bandeau du dessous passe tel quel, sans enveloppe.
      expect(await survey.drawn()).toMatchObject({ type: 'Text', children: ['AUTRE BANDEAU'] })
      expect(await survey.find({ type: 'Text', text: 'feat/export' })).toBeUndefined()
      await survey.unmount()

      await $.command.run({ command: 'git', args: 'hide', ...TYPED })
      const hidden = await mountBand($, surface)
      expect(await hidden.find({ type: 'Text', text: /AUTRE BANDEAU/ })).toBeDefined()
      expect(await hidden.find({ type: 'Text', text: 'feat/export' })).toBeUndefined()
      await hidden.unmount()
    })

    test(`hors dépôt, le bandeau n'a rien à montrer (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      engine(on, fakeRepo({ outside: ROOT }), ROOT, 'other')
      await start($, clock, surface)
      const band = await mountBand($, surface)
      expect(await band.find({ type: 'Text', text: /AUTRE BANDEAU/ })).toBeDefined()
      expect(await band.find({ type: 'Button', key: 'git-band-hide' })).toBeUndefined()
      await band.unmount()
    })

    test(`x masque le bandeau (toast, ligne d'état en relais), /git show le réaffiche (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = engine(on, fakeRepo())
      await start($, clock, surface)

      const band = await mountBand($, surface)
      expect(await band.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
      expect(seen.statuses.at(-1)).toBeUndefined()
      await band.press({ key: 'git-band-hide' })
      expect(await band.find({ type: 'Text', text: 'feat/export' })).toBeUndefined()
      expect(seen.toasts).toContain('Bandeau Git masqué : /git show pour le réafficher')
      expect(seen.statuses.at(-1)).toBe(STATUS)

      const shown = await $.command.run({ command: 'git', args: 'show', ...TYPED })
      expect(String(shown.text)).toMatch(/réaffiché/)
      expect(await band.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
      expect(seen.statuses.at(-1)).toBeUndefined()

      // « ▸ Ouvrir » ouvre le panneau.
      seen.opened.length = 0
      await band.press({ key: 'git-band-open' })
      expect(seen.opened).toEqual(['git'])
      await band.unmount()
    })

    test(`le bandeau à 30 et à 160 colonnes (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      engine(on, fakeRepo())
      const pane = await openPane($, clock, surface)

      const narrow = await mountBand($, surface, 30)
      await narrow.drawn()
      expect(await narrow.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
      expect(await narrow.find({ type: 'Text', text: /#7/ })).toBeUndefined()
      expect(await narrow.find({ type: 'Text', text: /fetch/ })).toBeUndefined()
      await narrow.unmount()

      // Une commande en file : la ligne 2 du bandeau large la montre.
      await pane.press({ key: 'act-push' })
      await pane.press({ key: 'launch' })
      const wide = await mountBand($, surface, 160)
      await wide.drawn()
      expect(await wide.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
      expect(await wide.find({ type: 'Text', text: /#7/ })).toBeDefined()
      expect(await wide.find({ type: 'Text', text: /fetch\sà\sl'instant/ })).toBeDefined()
      expect(await wide.find({ type: 'Text', text: /\+13/ })).toBeDefined()
      expect(await wide.find({ type: 'Text', text: /\/project:push en file/ })).toBeDefined()
      await wide.unmount()
    })

    test(`état d'erreur : fetch en échec visible, message fermable (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const seen = engine(on, fakeRepo({ fetch: 'fail' }))
      const pane = await openPane($, clock, surface)

      expect(await pane.find({ type: 'Text', text: /fetch\sen\séchec/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /git fetch : fatal: unable to access origin/ })).toBeDefined()
      expect(seen.toasts.some((t) => /git fetch/.test(t))).toBe(true)
      await pane.press({ key: 'notice-dismiss' })
      expect(await pane.find({ type: 'Text', text: /git fetch : fatal/ })).toBeUndefined()

      const band = await mountBand($, surface, 80)
      expect(await band.find({ type: 'Text', text: /fetch\sen\séchec/ })).toBeDefined()
      await band.unmount()
      // Le fetch en échec apparaît à partir de 64 colonnes.
      for (const [columns, isShown] of [[63, false], [64, true]] as const) {
        const tier = await mountBand($, surface, columns)
        await tier.drawn()
        expect(Boolean(await tier.find({ type: 'Text', text: /fetch\sen\séchec/ }))).toBe(isShown)
        await tier.unmount()
      }
    })

    test(`les paliers du bandeau : 56, 64, 72, 90 colonnes (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      engine(on, fakeRepo())
      const pane = await openPane($, clock, surface)
      await pane.press({ key: 'act-push' })
      await pane.press({ key: 'launch' })
      for (const columns of [55, 56, 63, 64, 71, 72, 89, 90]) {
        const band = await mountBand($, surface, columns)
        await band.drawn()
        const has = async (text: RegExp) => Boolean(await band.find({ type: 'Text', text }))
        expect(await has(/feat\/export/)).toBe(true)
        // Ligne 2 à partir de 56 : la commande en file, sans spinner (rien ne tourne encore).
        expect(await has(/\/project:push en file/)).toBe(columns >= 56)
        if (columns >= 56) expect(await band.find({ type: 'Text', text: '▶' })).toBeDefined()
        // Total des lignes et PR à partir de 72, âge du fetch à partir de 90.
        expect(await has(/#7/)).toBe(columns >= 72)
        expect(await has(/^\+13$/)).toBe(columns >= 72)
        expect(await has(/fetch\sà\sl'instant/)).toBe(columns >= 90)
        await band.unmount()
      }
    })

    test(`état vide : arbre propre, onglet Historique (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const fake = fakeRepo()
      fake.repo.isDirty = false
      engine(on, fake)
      const pane = await openPane($, clock, surface)

      expect(await pane.find({ type: 'Text', text: /Arbre de travail propre/ })).toBeDefined()
      await pane.press({ key: 'tab-history' })
      expect(await pane.find({ type: 'Text', text: 'feat: export CSV' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /v0\.2\.0/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /↑\s1\spas\sencore\spoussé/ })).toBeDefined()
    })
  }

  test('le panneau se dessine sur les quatre surfaces, tous onglets et tiroirs', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    engine(on, fakeRepo())
    await start($, clock)
    for (const surface of ALL) {
      for (const bodyColumns of [40, 80, 140]) {
        const pane = await mountPane($, surface, bodyColumns)
        await pane.drawn()
        expect(await pane.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
        expect(await pane.find({ type: 'Text', text: 'app.ts' })).toBeDefined()
        // Le terminal reçoit des glyphes, les surfaces distantes des SVG avec leur texte alternatif.
        const svgs = await pane.findAll({ type: 'Svg' })
        if (surface === 'terminal') {
          expect(svgs).toHaveLength(0)
          expect(await pane.find({ type: 'Text', text: /↑\s2\sà\spousser/ })).toBeDefined()
          // La route en texte : libellés entiers ou formes courtes, jamais coupés au milieu.
          expect(await pane.find({ type: 'Text', text: /Commi(?!t)|Check(?!s)|Fusio(?!n)/ })).toBeUndefined()
        } else {
          expect(svgs.length).toBeGreaterThan(0)
          expect(JSON.stringify(svgs)).toMatch(/2 commits à pousser, 1 à récupérer/)
        }
        for (const key of ['act-commit', 'act-pull', 'act-push', 'act-pr', 'tab-branches', 'tab-history', 'tab-changes']) {
          await pane.press({ key })
          await pane.drawn()
        }
        // Le mobile n'a ni champ ni liste : il le dit au lieu de les cacher en silence.
        await pane.press({ key: 'act-commit' })
        const missing = await pane.find({ type: 'Text', text: /Indice indisponible ici/ })
        if (surface === 'mobile') expect(missing).toBeDefined()
        else expect(missing).toBeUndefined()
        await pane.press({ key: 'drawer-close' })
        await pane.unmount()
      }
    }
  })

  test('le panneau hors dépôt se dessine sur les quatre surfaces', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    engine(on, fakeRepo({ outside: ROOT }))
    await start($, clock)
    for (const surface of ALL) {
      const pane = await mountPane($, surface)
      await pane.drawn()
      expect(await pane.find({ type: 'Text', text: 'Pas de dépôt git ici' })).toBeDefined()
      const missing = await pane.find({ type: 'Text', text: /Saisie du dossier indisponible/ })
      const alternative = await pane.find({ type: 'Text', text: 'ou /git <dossier>' })
      if (surface === 'mobile') {
        expect(missing).toBeDefined()
        expect(alternative).toBeUndefined()
      } else {
        expect(missing).toBeUndefined()
        expect(alternative).toBeDefined()
      }
      await pane.unmount()
    }
  })

  test('/git-board:git répond sans le modèle, ouvre le panneau, sans session.start', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    on('command.run', { command: 'git-board:git' }, async (_$, e, next) => next(e))
    const seen = engine(on, fake)

    const out = await $.command.run({ command: 'git-board:git', args: '', ...TYPED })
    expect(String(out.text)).toMatch(/Panneau Git ouvert/)
    expect(seen.opened).toEqual(['git'])
    // Le mod répond lui-même : rien ne descend jusqu'au moteur (ni donc au modèle).
    expect(seen.ran).toEqual([])
    await clock.settle()
    expect(fake.calls.some((c) => c.includes('fetch'))).toBe(true)

    const tabbed = await $.command.run({ command: 'git-board:git', args: 'branches', ...TYPED })
    expect(String(tabbed.text)).toMatch(/onglet Branches/)
    await clock.settle()
    const pane = await mountPane($, 'terminal')
    expect(await pane.find({ type: 'Button', text: /▸\sBranches/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Locales/ })).toBeDefined()

    const hidden = await $.command.run({ command: 'git-board:git', args: 'hide', ...TYPED })
    expect(String(hidden.text)).toMatch(/masqué/)
    expect(seen.ran).toEqual([])
  })

  test('/git sort du menu, /git-board:git y reste', async ($, on) => {
    on('command.describe', (_$: unknown, e: any) => ({ description: e.description, isHidden: e.isHidden }))
    const git = await $.command.describe({ command: 'git', description: 'x', isHidden: false } as any)
    expect(git.isHidden).toBe(true)
    const full = await $.command.describe({ command: 'git-board:git', description: 'x', isHidden: false } as any)
    expect(full.isHidden).toBe(false)
  })

  test('au démarrage : lecture locale sans fetch, une seule lecture de PR ; coup d’œil des 10 s', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    engine(on, fake)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT } as any)
    await clock.settle()
    expect(fake.calls.some((c) => c.includes('fetch'))).toBe(false)
    expect(fake.gh()).toBe(1)
    // Une seule lecture du dépôt (un seul `git status`), pas deux.
    expect(fake.calls.filter((c) => c.includes('status')).length).toBe(1)

    const band = await mountBand($, 'terminal', 120)
    // Aucun fetch connu (pas de FETCH_HEAD lisible) : le bandeau large le dit.
    expect(await band.find({ type: 'Text', text: /fetch\sjamais/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /#7/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /●\s3/ })).toBeDefined()
    fake.repo.isDirty = false
    await clock.advance(10_000)
    expect(await band.find({ type: 'Text', text: /●\s3/ })).toBeUndefined()
    await band.unmount()
  })

  // Le bouton de l'étape suivante du bandeau : l'action mise en avant, lancée d'un clic.
  const NEXT_CASES = [
    { name: 'des modifications : Commit', label: /^▶\sCommit$/, ran: { command: 'project:commit', args: '' }, setup: (_f: ReturnType<typeof fakeRepo>) => {} },
    {
      name: 'en retard sur la distante : Pull depuis la branche distante',
      label: /^▶\sPull$/,
      ran: { command: 'project:sync', args: '' },
      setup: (f: ReturnType<typeof fakeRepo>) => {
        f.repo.isDirty = false
      },
    },
    {
      name: 'en avance : Push',
      label: /^▶\sPush$/,
      ran: { command: 'project:push', args: '' },
      setup: (f: ReturnType<typeof fakeRepo>) => {
        f.repo.isDirty = false
        f.repo.behind = 0
      },
    },
    {
      name: 'tout poussé, pas de PR : PR',
      label: /^▶\sPR$/,
      ran: { command: 'project:pr', args: '' },
      setup: (f: ReturnType<typeof fakeRepo>) => {
        f.repo.isDirty = false
        f.repo.behind = 0
        f.repo.ahead = 0
      },
    },
  ] as const
  for (const c of NEXT_CASES) {
    for (const surface of BANDS) {
      test(`bandeau, bouton de l'étape suivante : ${c.name} (${surface})`, async ($, on) => {
        const clock = mock.clock(on, { now: NOW })
        const fake = fakeRepo({ pr: 'none' })
        c.setup(fake)
        const seen = engine(on, fake)
        await start($, clock, surface)
        const band = await mountBand($, surface)
        const next = await band.find({ type: 'Button', key: 'git-band-next' })
        expect(next?.text).toMatch(c.label)
        expect(JSON.stringify(next)).toMatch(/"variant":"primary"/)
        // Juste avant « ▸ Ouvrir ».
        const keys = (JSON.stringify(await band.drawn()).match(/"key":"git-band-[a-z]+"/g) ?? []).map((k) => k.slice(7, -1))
        expect(keys).toEqual(['git-band-next', 'git-band-open', 'git-band-hide'])
        await band.press({ key: 'git-band-next' })
        expect(seen.ran).toEqual([c.ran])
        // La commande part par le même lancement que le tiroir : en file, puis plus de bouton.
        expect(await band.find({ type: 'Text', text: new RegExp(`/${c.ran.command}${c.ran.args ? ` ${c.ran.args}` : ''} en file`) })).toBeDefined()
        expect(await band.find({ type: 'Button', key: 'git-band-next' })).toBeUndefined()
        await band.unmount()
      })
    }
  }

  test('bandeau : le bouton lance avec les réglages du tiroir (indice du commit, options de la PR)', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ pr: 'none' })
    const seen = engine(on, fake)
    const pane = await openPane($, clock, 'desktop')
    await pane.press({ key: 'act-commit' })
    await pane.input({ key: 'hint', text: 'export CSV', kind: 'change' })
    const band = await mountBand($, 'desktop')
    await band.press({ key: 'git-band-next' })
    expect(seen.ran.at(-1)).toEqual({ command: 'project:commit', args: 'export CSV' })
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)

    fake.repo.isDirty = false
    fake.repo.behind = 0
    fake.repo.ahead = 0
    await pane.press({ key: 'refresh' })
    await pane.press({ key: 'act-pr' })
    await pane.select({ key: 'pr-draft', value: 'draft' })
    await pane.select({ key: 'pr-auto', value: 'auto' })
    expect((await band.find({ type: 'Button', key: 'git-band-next' }))?.text).toMatch(/^▶\sPR$/)
    await band.press({ key: 'git-band-next' })
    expect(seen.ran.at(-1)).toEqual({ command: 'project:pr', args: '--draft --auto' })
    await band.unmount()
  })

  // Pendant un parcours flow-board, un seul envoi en fin de parcours : ni Push ni PR au bandeau.
  // La valeur `board` de flow-board se lit par `state.get`, que le test remplace.
  const FLOW_CASES = [
    { name: 'parcours actif', board: { activeId: 'r1', runs: [{ id: 'r1', status: 'active' }] }, isHidden: true },
    { name: 'parcours désigné mais fini', board: { activeId: 'r1', runs: [{ id: 'r1', status: 'done' }] }, isHidden: false },
    { name: 'aucun parcours désigné', board: { activeId: null, runs: [{ id: 'r1', status: 'active' }] }, isHidden: false },
    { name: 'valeur d’une autre forme', board: { activeId: 'r1', runs: 'r1' }, isHidden: false },
    { name: 'sans flow-board (pas de valeur)', board: undefined, isHidden: false },
  ] as const
  for (const c of FLOW_CASES) {
    test(`bandeau, ${c.name} : ${c.isHidden ? 'Commit et Pull, ni Push ni PR' : 'Push et PR reviennent'}`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const fake = fakeRepo({ pr: 'none' })
      engine(on, fake)
      let reads = 0
      if (c.board !== undefined) {
        on('state.get', (_$: any, e: any, next: any) => {
          if (e.plugin !== 'flow-board' || e.key !== 'board') return next(e)
          reads += 1
          return { value: { value: c.board, version: 1 } }
        })
      }
      const pane = await openPane($, clock, 'terminal')
      const band = await mountBand($, 'terminal')
      const nextText = async () => (await band.find({ type: 'Button', key: 'git-band-next' }))?.text
      // Commit et Pull restent, parcours ou non.
      expect(await nextText()).toMatch(/^▶\sCommit$/)
      fake.repo.isDirty = false
      await pane.press({ key: 'refresh' })
      expect(await nextText()).toMatch(/^▶\sPull$/)
      if (c.board !== undefined) expect(reads).toBeGreaterThan(0)
      fake.repo.behind = 0
      await pane.press({ key: 'refresh' })
      if (c.isHidden) expect(await nextText()).toBeUndefined()
      else expect(await nextText()).toMatch(/^▶\sPush$/)
      fake.repo.ahead = 0
      await pane.press({ key: 'refresh' })
      if (c.isHidden) expect(await nextText()).toBeUndefined()
      else expect(await nextText()).toMatch(/^▶\sPR$/)
      // Les tiroirs du panneau ne changent pas : Push et PR s'y lancent toujours.
      await pane.press({ key: 'act-pr' })
      expect(await pane.find({ type: 'Button', key: 'launch' })).toBeDefined()
      await band.unmount()
    })
  }

  test('bandeau : le bouton ne paraît que si la branche garde sa place à côté de ce que la ligne 1 garde toujours', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    // Non publiée, des modifications, fetch en échec : à gauche 8 (étiquette) + 2 (« ⎇ ») +
    // 14 (« ◌ non publiée ») + 8 (« ● 3 + 1 ») + 15 (« fetch en échec »), à droite 24, et les
    // 11 cases de « feat/export » : 82 colonnes.
    engine(on, fakeRepo({ local: { toMerge: 3 }, fetch: 'fail' }))
    await start($, clock, 'terminal')
    for (const [columns, isShown] of [[81, false], [82, true]] as const) {
      const band = await mountBand($, 'terminal', columns)
      expect(await band.find({ type: 'Text', text: /fetch\sen\séchec/ })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /◌\snon\spubliée/ })).toBeDefined()
      expect(Boolean(await band.find({ type: 'Button', key: 'git-band-next' }))).toBe(isShown)
      await band.unmount()
    }
  })

  test('bandeau : deux appuis rapprochés ne lancent la commande qu’une fois', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = engine(on, fakeRepo())
    await start($, clock, 'terminal')
    const band = await mountBand($, 'terminal')
    await Promise.all([band.press({ key: 'git-band-next' }), band.press({ key: 'git-band-next' })])
    expect(seen.ran).toEqual([{ command: 'project:commit', args: '' }])
    await band.unmount()
  })

  test('bandeau et tiroir : une commande en file n’est pas relancée par l’autre bouton', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = engine(on, fakeRepo())
    const pane = await openPane($, clock, 'terminal')
    const band = await mountBand($, 'terminal')
    // Le bandeau d'abord, puis « ▶ Lancer » du tiroir resté ouvert ailleurs.
    await pane.press({ key: 'act-commit' })
    await band.press({ key: 'git-band-next' })
    await pane.press({ key: 'act-commit' })
    await pane.press({ key: 'launch' })
    expect(seen.ran).toEqual([{ command: 'project:commit', args: '' }])
    expect(await pane.find({ type: 'Text', text: /\/project:commit est déjà en file/ })).toBeDefined()
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
    // Le tiroir (resté ouvert : l'appui refusé ne l'a pas fermé) et le bandeau au même moment :
    // une seule commande part.
    expect(await pane.find({ type: 'Button', key: 'launch' })).toBeDefined()
    await Promise.all([pane.press({ key: 'launch' }), band.press({ key: 'git-band-next' })])
    expect(seen.ran).toHaveLength(2)
    await band.unmount()
  })

  test('bandeau : un lancement refusé met la commande dans le prompt', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = engine(on, fakeRepo())
    seen.commands.length = 0
    await start($, clock, 'terminal')
    const band = await mountBand($, 'terminal')
    await band.press({ key: 'git-band-next' })
    expect(seen.ran).toEqual([])
    expect(seen.filled).toEqual(['/project:commit'])
  })

  test('bandeau : pas de bouton de l’étape suivante sans rien à faire, pendant une opération ou hors du dépôt de la session', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    engine(on, fake)
    let isMerging = false
    on('fs.stat', ($: any, e: any) => {
      if (isMerging && String(e.path).endsWith('MERGE_HEAD')) return { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }
      return Promise.reject(new Error('ENOENT'))
    })
    const pane = await openPane($, clock, 'terminal')
    const band = await mountBand($, 'terminal')
    // D'abord l'effet : des modifications, le bouton est là.
    expect(await band.find({ type: 'Button', key: 'git-band-next' })).toBeDefined()
    isMerging = true
    await pane.press({ key: 'refresh' })
    expect(await band.find({ type: 'Text', text: /Merge en cours/ })).toBeDefined()
    expect(await band.find({ type: 'Button', key: 'git-band-next' })).toBeUndefined()
    isMerging = false
    fake.repo.isDirty = false
    fake.repo.behind = 0
    fake.repo.ahead = 0
    await pane.press({ key: 'refresh' })
    // PR ouverte, tout poussé : rien à faire.
    expect(await band.find({ type: 'Text', text: /✓\sà\sjour/ })).toBeDefined()
    expect(await band.find({ type: 'Button', key: 'git-band-next' })).toBeUndefined()
    await band.unmount()
  })

  test('bandeau : pas de bouton de l’étape suivante sur un dépôt suivi hors de la session', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = engine(on, fakeRepo({ outside: '/elsewhere' }), '/elsewhere')
    await start($, clock, 'terminal', '/elsewhere', ROOT)
    const band = await mountBand($, 'terminal')
    expect(await band.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
    expect(await band.find({ type: 'Button', key: 'git-band-next' })).toBeUndefined()
    expect(seen.ran).toEqual([])
    await band.unmount()
  })

  for (const surface of BANDS) {
    test(`bandeau : le bouton de l'étape suivante passe avant les éléments secondaires (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      engine(on, fakeRepo())
      await start($, clock, surface)
      for (const columns of [30, 56, 58, 59, 72, 84, 85, 102, 103, 160]) {
        const band = await mountBand($, surface, columns)
        await band.drawn()
        const has = async (text: RegExp) => Boolean(await band.find({ type: 'Text', text }))
        const isNext = Boolean(await band.find({ type: 'Button', key: 'git-band-next' }))
        expect(await has(/feat\/export/)).toBe(true)
        expect(await band.find({ type: 'Button', key: 'git-band-open' })).toBeDefined()
        // Le bouton dès 59 colonnes : à droite « [ ▶ Commit ] », « ▸ Ouvrir », « x » et leurs
        // marges (24), à gauche l'étiquette, « ⎇ », « ↑2 ↓1 » et « ● 3 + 1 » avec leurs marges
        // (24), et les 11 cases de « feat/export ». « +13 » et la PR demandent alors 72 colonnes
        // plus la largeur du bouton (« ▶ Commit », 8 cases, plus ses crochets et sa marge : 13),
        // l'âge du fetch 90 plus 13.
        expect(isNext).toBe(columns >= 59)
        expect(await has(/^\+13$/)).toBe(columns >= 85)
        expect(await has(/#7/)).toBe(columns >= 85)
        expect(await has(/fetch\sà\sl'instant/)).toBe(columns >= 103)
        await band.unmount()
      }
    })
  }

  test('opération en cours : carte rouge dans le panneau, ligne 2 du bandeau', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    engine(on, fakeRepo())
    on('fs.stat', ($: any, e: any) => {
      if (String(e.path).endsWith('MERGE_HEAD')) return { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } }
      return Promise.reject(new Error('ENOENT'))
    })
    const pane = await openPane($, clock, 'terminal')
    expect(await pane.find({ type: 'Text', text: /Merge en cours/ })).toBeDefined()
    // Pendant une opération, aucune étape n'est mise en avant.
    const commit = (await pane.drawn()) as any
    expect(JSON.stringify(commit)).not.toMatch(/"variant":"primary"/)
    const band = await mountBand($, 'terminal', 120)
    expect(await band.find({ type: 'Text', text: /Merge en cours/ })).toBeDefined()
    await band.unmount()
  })

  test('une longue liste de fichiers est plafonnée, « tout voir » la déplie', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    engine(on, fakeRepo({ many: true }))
    const pane = await openPane($, clock, 'terminal')
    expect(await pane.find({ type: 'Text', text: 'notes-00.txt' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'notes-29.txt' })).toBeUndefined()
    expect(await pane.find({ type: 'Button', text: /tout\svoir\s\(34\)/ })).toBeDefined()
    await pane.press({ key: 'files-all' })
    expect(await pane.find({ type: 'Text', text: 'notes-29.txt' })).toBeDefined()
    expect(await pane.find({ type: 'Button', text: /réduire/ })).toBeDefined()
  })

  test('bandeau masqué : la ligne d’état relaie, puis s’efface hors dépôt', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = engine(on, fakeRepo({ outside: '/ailleurs' }))
    await start($, clock)
    await $.command.run({ command: 'git', args: 'hide', ...TYPED })
    expect(seen.statuses.at(-1)).toBe(STATUS)
    await $.command.run({ command: 'git', args: '/ailleurs', ...TYPED })
    await clock.settle()
    expect(seen.statuses.at(-1)).toBeUndefined()
  })

  test('sondage sur le bandeau du moteur : son nœud passe tel quel', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    engine(on, fakeRepo())
    await start($, clock)
    const survey = await mountBand($, 'terminal', 120, true)
    expect(await survey.find({ type: 'Text', text: 'feat/export' })).toBeUndefined()
    expect(await survey.find({ type: 'Button', key: 'git-band-hide' })).toBeUndefined()
    await survey.unmount()
  })

  for (const [missing, prBody] of [
    ['adresse', { number: 7, title: 'x', state: 'OPEN' }],
    ['numéro', { title: 'x', url: 'https://github.com/matwi5/demo/pull/7', state: 'OPEN' }],
  ] as const) {
    test(`une réponse de gh sans ${missing} ne fait pas refuser le panneau`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      engine(on, fakeRepo({ prBody }))
      await start($, clock)
      for (const surface of ALL) {
        const pane = await mountPane($, surface)
        await pane.drawn()
        // Le dépôt reste lu ; la PR incomplète n'est pas dessinée, l'erreur est dite.
        expect(await pane.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
        expect(await pane.find({ type: 'Text', text: /#undefined/ })).toBeUndefined()
        expect(await pane.find({ type: 'Text', text: /réponse incomplète/ })).toBeDefined()
        await pane.unmount()
      }
    })
  }

  test('branches seulement distantes : plafonnées, « tout voir » les déplie', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    engine(on, fakeRepo({ remotes: 20 }))
    await start($, clock)
    for (const surface of ['terminal', 'mobile'] as const) {
      const pane = await mountPane($, surface)
      await pane.press({ key: 'tab-branches' })
      await pane.press({ key: 'remotes-toggle' })
      expect(await pane.find({ type: 'Text', text: 'origin/old/b10' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: 'origin/old/b19' })).toBeUndefined()
      expect(await pane.find({ type: 'Button', key: 'remotes-all', text: /tout\svoir\s\(21\)/ })).toBeDefined()
      await pane.press({ key: 'remotes-all' })
      expect(await pane.find({ type: 'Text', text: 'origin/old/b19' })).toBeDefined()
      // Remet les deux bascules (gardées dans l'état de session) pour la surface suivante.
      await pane.press({ key: 'remotes-all' })
      await pane.press({ key: 'remotes-toggle' })
      await pane.unmount()
    }
  })

  // Une branche sans distante : fusionnée dans main, à fusionner depuis un worktree lié (jamais
  // poussée, elle se fusionne en local), ou non publiée. Bandeau, pastilles et route s'accordent.
  const LOCAL_CASES = [
    { name: 'tous ses commits dans main : fusionnée', local: { toMerge: 0 }, word: /✓\sfusionnée/, road: /Push : fait \(fusionnée\)/, push: false },
    { name: 'worktree lié, fusionnée aussi', local: { toMerge: 0, linked: true }, word: /✓\sfusionnée/, road: /Push : fait \(fusionnée\)/, push: false },
    { name: 'worktree lié, 3 commits absents de main : à fusionner', local: { toMerge: 3, linked: true }, word: /⤞\s3\sà\sfusionner/, road: /Push : en cours \(3 à fusionner\)/, push: false },
    { name: 'aucun commit depuis sa création : vide', local: { toMerge: 0, fresh: true }, word: /○\svide/, road: /Push : en cours \(vide\)/, push: false },
    { name: 'worktree lié, aucun commit depuis sa création : vide', local: { toMerge: 0, linked: true, fresh: true }, word: /○\svide/, road: /Push : en cours \(vide\)/, push: false },
    { name: 'avancée par fast-forward depuis main, sans commit à elle : vide', local: { toMerge: 0, linked: true, fresh: 'ff' }, word: /○\svide/, road: /Push : en cours \(vide\)/, push: false },
    { name: 'branche ordinaire, 3 commits absents de main : non publiée', local: { toMerge: 3 }, word: /◌\snon\spubliée/, road: /Push : en cours \(non publiée\)/, push: true },
  ] as const
  for (const c of LOCAL_CASES) {
    test(`sans distante, ${c.name}`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const fake = fakeRepo({ local: c.local })
      fake.repo.isDirty = false
      engine(on, fake)
      await start($, clock)
      expect(fake.calls.some((x) => x.includes('--count') && x.includes('refs/heads/main..HEAD'))).toBe(true)
      // Le reflog de la branche n'est lu que pour départager vide et fusionnée.
      expect(fake.calls.some((x) => x.includes('reflog') && x.includes('refs/heads/feat/export'))).toBe(c.local.toMerge === 0)
      for (const surface of BANDS) {
        const band = await mountBand($, surface)
        expect(await band.find({ type: 'Text', text: c.word })).toBeDefined()
        if (!c.push) expect(await band.find({ type: 'Text', text: /non\spubliée/ })).toBeUndefined()
        await band.unmount()
      }
      for (const surface of ALL) {
        const pane = await mountPane($, surface)
        expect(await pane.find({ type: 'Text', text: c.word })).toBeDefined()
        if (!c.push) expect(await pane.find({ type: 'Text', text: /non\spubliée/ })).toBeUndefined()
        if ('fresh' in c.local) expect(await pane.find({ type: 'Text', text: /fusionnée/ })).toBeUndefined()
        if (surface === 'desktop') expect(JSON.stringify(await pane.findAll({ type: 'Svg' }))).toMatch(c.road)
        // Arbre propre : seule une branche non publiée a une étape suggérée, le push.
        expect(JSON.stringify(await pane.drawn())).toMatch(c.push ? /"variant":"primary"/ : /^(?!.*"variant":"primary")/s)
        await pane.unmount()
      }
    })
  }

  test('une branche qui suit sa distante ne compte pas ses commits absents de main', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    engine(on, fake)
    await start($, clock)
    expect(fake.calls.some((x) => x.includes('--count'))).toBe(false)
  })

  test('HEAD détachée : pull, push et PR le disent, sans commande à lancer', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ detached: true })
    engine(on, fake)
    await start($, clock)
    for (const surface of ALL) {
      const pane = await mountPane($, surface)
      expect(await pane.find({ type: 'Text', text: /HEAD détachée \(1111111\)/ })).toBeDefined()
      for (const key of ['act-pull', 'act-push', 'act-pr']) {
        await pane.press({ key })
        expect(await pane.find({ type: 'Text', text: /HEAD détachée : bascule sur une branche/ })).toBeDefined()
        expect(await pane.find({ type: 'Button', key: 'launch' })).toBeUndefined()
        expect(await pane.find({ type: 'Text', text: /pas encore publiée|Branche par défaut/ })).toBeUndefined()
      }
      await pane.press({ key: 'act-commit' })
      expect(await pane.find({ type: 'Button', key: 'launch' })).toBeDefined()
      await pane.press({ key: 'drawer-close' })
      await pane.unmount()
    }
    expect(fake.gh()).toBe(0)
  })

  // `gh pr view <branche>` rend aussi une PR fusionnée : une branche réutilisée après la fusion
  // (dev) ne doit pas reprendre l'ancienne PR pour ses nouveaux commits.
  const merged = (headRefOid: string) => ({
    number: 7,
    title: 'feat: export CSV',
    url: 'https://github.com/matwi5/demo/pull/7',
    state: 'MERGED',
    isDraft: false,
    baseRefName: 'main',
    headRefOid,
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
  })

  test('PR fusionnée dont HEAD a avancé : ignorée, la route repart à « PR à ouvrir »', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ prBody: merged('0000000ffffffffffffffffffffffffffffffff0') })
    fake.repo.isDirty = false
    engine(on, fake)
    const pane = await openPane($, clock, 'desktop')
    const svg = JSON.stringify(await pane.findAll({ type: 'Svg' }))
    expect(svg).not.toMatch(/#7/)
    expect(svg).not.toMatch(/Fusion : fait/)
    expect(await pane.find({ type: 'Text', text: /Fusionnée/ })).toBeUndefined()
  })

  test('PR fusionnée dont HEAD est encore la tête : affichée', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ prBody: merged('1111111aaaaaaa0000000000000000000000000') })
    fake.repo.isDirty = false
    engine(on, fake)
    const pane = await openPane($, clock, 'desktop')
    expect(await pane.find({ type: 'Text', text: /Fusionnée/ })).toBeDefined()
  })

  test('au terminal, les liens de PR et de commit deviennent des boutons qui copient leur adresse ; ailleurs, des liens', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = engine(on, fakeRepo())
    const copies: { text: string; surface?: string }[] = []
    let isCopied = true
    on('ui.copy', ($: any, e: { text: string; surface?: string }) => {
      copies.push(e)
      return { value: isCopied ? { isCopied: true as const } : { isCopied: false as const, reason: 'no-clipboard' as const } }
    })
    const PR_URL = 'https://github.com/matwi5/demo/pull/7'
    const pane = await openPane($, clock, 'terminal')
    expect(await pane.find({ type: 'Link' })).toBeUndefined()
    // La ligne de la PR, en tête.
    expect((await pane.find({ key: 'pr-link' }))?.props).toMatchObject({ label: '⧉ PR' })
    await pane.press({ key: 'pr-link' })
    expect(copies.at(-1)?.text).toBe(PR_URL)
    expect(seen.toasts.at(-1)).toBe('Lien PR copié')
    // Le tiroir Pull request.
    await pane.press({ key: 'act-pr' })
    await pane.press({ key: 'pr-card-link' })
    expect(copies.at(-1)?.text).toBe(PR_URL)
    // Chaque commit de l'historique.
    await pane.press({ key: 'tab-history' })
    expect(await pane.find({ type: 'Link' })).toBeUndefined()
    expect((await pane.find({ key: 'commit-link-h1full' }))?.props).toMatchObject({ label: '⧉' })
    await pane.press({ key: 'commit-link-h1full' })
    expect(copies.at(-1)?.text).toBe('https://github.com/matwi5/demo/commit/h1full')
    expect(seen.toasts.at(-1)).toBe('Lien du commit copié')
    // Sans copie possible, le toast donne l'adresse à recopier.
    isCopied = false
    await pane.press({ key: 'commit-link-h2full' })
    expect(seen.toasts.at(-1)).toBe('Copie impossible : https://github.com/matwi5/demo/commit/h2full')
    await pane.unmount()

    const desktop = await mountPane($, 'desktop')
    const links = async () => (await desktop.findAll({ type: 'Link' })).map((l: any) => [l.props.label, l.props.href])
    // Le tiroir Pull request et l'onglet Historique restent ouverts d'une surface à l'autre.
    expect(await links()).toContainEqual(['Ouvrir ↗', PR_URL])
    expect(await links()).toContainEqual(['Ouvrir sur GitHub ↗', PR_URL])
    expect(await links()).toContainEqual(['↗', 'https://github.com/matwi5/demo/commit/h1full'])
    expect(await desktop.find({ key: 'commit-link-h1full' })).toBeUndefined()
    await desktop.unmount()
  })

  test('une commande dont le dépôt montre l’effet n’est plus « en cours », même si le tour continue', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    const seen = engine(on, fake)
    const pane = await openPane($, clock, 'terminal')
    await pane.press({ key: 'act-commit' })
    await pane.press({ key: 'launch' })
    await $.turn.start({ text: '', turnId: 't1' })
    expect(await pane.find({ type: 'Text', text: /en cours dans la conversation/ })).toBeDefined()
    // Claude commite, puis enchaîne sur autre chose dans le même tour : pas de turn.complete.
    fake.repo.oid = '2222222bbbbbbb'
    fake.repo.isDirty = false
    await pane.press({ key: 'refresh' })
    expect(await pane.find({ type: 'Text', text: /en cours dans la conversation/ })).toBeUndefined()
    expect(seen.toasts.some((t) => /\/project:commit : fait d'après le dépôt/.test(t))).toBe(true)
  })

  test('le tiroir Push suggère /project:version avant de pousser, et la lance', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = engine(on, fakeRepo())
    const pane = await openPane($, clock, 'terminal')
    await pane.press({ key: 'act-push' })
    expect(await pane.find({ type: 'Text', text: /Avant de pousser : \/project:version/ })).toBeDefined()
    await pane.press({ key: 'launch-version' })
    expect(seen.ran).toContainEqual({ command: 'project:version', args: '' })
    expect(await pane.find({ type: 'Text', text: /\/project:version en file/ })).toBeDefined()
    // Sans repère dans le dépôt, elle n'est finie qu'avec le tour.
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as any)
    expect(await pane.find({ type: 'Text', text: /\/project:version en cours/ })).toBeUndefined()
  })

  test('le tour d’un sous-agent ne fait pas démarrer une commande en file', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    engine(on, fakeRepo())
    const pane = await openPane($, clock, 'terminal')
    await pane.press({ key: 'act-push' })
    await pane.press({ key: 'launch-version' })
    // Un sous-agent du tour en cours démarre, puis ce tour finit : la commande attend toujours.
    await $.turn.start({ text: 'explore', turnId: 't0', agentId: 'a1' } as any)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', reason: 'end_turn' } as any)
    expect(await pane.find({ type: 'Text', text: /\/project:version en file/ })).toBeDefined()
  })

  test('rien à pousser : pas de suggestion de /project:version', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    fake.repo.branch = 'main'
    fake.repo.isDirty = false
    engine(on, fake)
    const pane = await openPane($, clock, 'terminal')
    await pane.press({ key: 'act-push' })
    expect(await pane.find({ type: 'Text', text: /Rien à pousser/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Avant de pousser/ })).toBeUndefined()
  })

  // Une branche sans distante qui ne se pousse pas : le tiroir le dit, sans /project:version
  // ni « ▶ Lancer ».
  const NO_PUSH_CASES = [
    { name: 'fusionnée', local: { toMerge: 0 }, say: /✓ Fusionnée dans main : rien à pousser d'ici/ },
    { name: 'à fusionner', local: { toMerge: 3, linked: true }, say: /⤞ À fusionner dans main d'abord/ },
    { name: 'vide', local: { toMerge: 0, linked: true, fresh: true }, say: /○ Branche vide : aucun commit depuis sa création, rien à pousser/ },
  ] as const
  for (const c of NO_PUSH_CASES) {
    test(`tiroir Push d'une branche ${c.name} : rien à pousser d'ici`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const fake = fakeRepo({ local: c.local })
      fake.repo.isDirty = false
      engine(on, fake)
      await start($, clock)
      for (const surface of ALL) {
        const pane = await mountPane($, surface)
        // Le tiroir ouvert le reste d'une surface à l'autre.
        if (surface === ALL[0]) await pane.press({ key: 'act-push' })
        expect(await pane.find({ type: 'Text', text: c.say })).toBeDefined()
        expect(await pane.find({ type: 'Text', text: /Avant de pousser/ })).toBeUndefined()
        expect(await pane.find({ type: 'Button', key: 'launch-version' })).toBeUndefined()
        expect(await pane.find({ type: 'Button', key: 'launch' })).toBeUndefined()
        await pane.unmount()
      }
    })
  }

  test('une commande dont le dépôt ne montre pas encore l’effet reste « en cours »', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    engine(on, fake)
    const pane = await openPane($, clock, 'terminal')
    await pane.press({ key: 'act-commit' })
    await pane.press({ key: 'launch' })
    await $.turn.start({ text: '', turnId: 't1' })
    await pane.press({ key: 'refresh' })
    expect(await pane.find({ type: 'Text', text: /en cours dans la conversation/ })).toBeDefined()
  })

  test('une commande interrompue ne s’affiche pas comme réussie', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = engine(on, fakeRepo())
    const pane = await openPane($, clock, 'terminal')
    await pane.press({ key: 'act-push' })
    await pane.press({ key: 'launch' })
    await $.turn.start({ text: '', turnId: 't1' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' } as any)
    expect(await pane.find({ type: 'Text', text: /\/project:push interrompue/ })).toBeDefined()
    expect(seen.toasts.some((t) => /^✓.*\/project:push/.test(t))).toBe(false)
  })

  test('l’âge du fetch vient de FETCH_HEAD quand la session n’a pas encore fetché', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    engine(on, fakeRepo())
    on('fs.stat', ($: any, e: any) => {
      // Le moteur passe un chemin natif (`C:\work\.git\FETCH_HEAD` sous Windows).
      if (/[\\/]FETCH_HEAD$/.test(String(e.path))) return { value: { kind: 'file', size: 0, mtimeMs: NOW - 4 * 60_000, isLink: false } }
      return Promise.reject(new Error('ENOENT'))
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT } as any)
    await clock.settle()
    const band = await mountBand($, 'terminal', 120)
    expect(await band.find({ type: 'Text', text: /fetch\sil\sy\sa\s4\smin/ })).toBeDefined()
    await band.unmount()
    const pane = await mountPane($, 'terminal')
    expect(await pane.find({ type: 'Text', text: /fetch\sil\sy\sa\s4\smin/ })).toBeDefined()
  })

  // ─── Suivi de la CI après un push ─────────────────────────────────────────

  // Claude pousse : l'arbre est propre, plus rien en avance, HEAD est le commit poussé.
  const PUSHED = 'abcdef0123456789abcdef0123456789abcdef01'
  async function push($: any, clock: any, fake: ReturnType<typeof fakeRepo>) {
    fake.repo.isDirty = false
    fake.repo.ahead = 0
    fake.repo.behind = 0
    fake.repo.oid = PUSHED
    await $.tool.call({ tool: 'Bash', command: 'git push -u origin feat/export' })
    await clock.advance(600)
  }

  for (const surface of BANDS) {
    test(`CI sans PR : en attente, en cours, réussie, puis plus de relecture (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const fake = fakeRepo({ pr: 'none' })
      const seen = engine(on, fake)
      await start($, clock, surface)
      expect(fake.runs()).toEqual([])
      await push($, clock, fake)

      // Le commit poussé, en entier ; rien encore lancé : « en attente », pas « aucun ».
      expect(fake.runs()[0]).toEqual(['gh', 'run', 'list', '--commit', PUSHED, '--json', 'status,conclusion,name,url', '--limit', '50'])
      const pane = await mountPane($, surface)
      expect(await pane.find({ type: 'Text', text: /◌\sCI\sen\sattente/ })).toBeDefined()
      const band = await mountBand($, surface, 120)
      expect(await band.find({ type: 'Text', text: /^◌\sCI$/ })).toBeDefined()

      fake.ci.runs = [
        { status: 'in_progress', conclusion: '', name: 'build', url: 'https://github.com/x' },
        { status: 'completed', conclusion: 'success', name: 'lint', url: 'https://github.com/y' },
      ]
      await clock.advance(25_000)
      expect(await band.find({ type: 'Text', text: /◌\sCI\s1\/2/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /◌\sCI\s1\/2/ })).toBeDefined()

      fake.ci.runs = fake.ci.runs.map((x) => ({ ...x, status: 'completed', conclusion: 'success' }))
      await clock.advance(25_000)
      expect(await pane.find({ type: 'Text', text: /✓\sCI\sréussie/ })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /^✓\sCI$/ })).toBeDefined()
      expect(seen.toasts.some((t) => /✓ CI réussie sur feat\/export \(2\scheck/.test(t))).toBe(true)
      const polls = fake.runs().length
      await clock.advance(120_000)
      expect(fake.runs().length).toBe(polls)
      await band.unmount()
    })

    test(`CI avec PR : l'ancien commit compte comme en attente, puis échec nommé (${surface})`, async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const fake = fakeRepo()
      const seen = engine(on, fake)
      await start($, clock, surface)
      // Juste après le push, GitHub montre encore l'ancienne tête de la PR et ses checks.
      fake.ci.prHead = '1111111aaaaaaa'
      await push($, clock, fake)
      const pane = await mountPane($, surface)
      expect(await pane.find({ type: 'Text', text: /◌\sCI\sen\sattente/ })).toBeDefined()
      if (surface === 'desktop') expect(JSON.stringify(await pane.findAll({ type: 'Svg' }))).toMatch(/Checks : en cours \(attente\)/)
      else expect(await pane.find({ type: 'Text', text: /✓\s1/ })).toBeUndefined()

      fake.ci.prHead = PUSHED
      fake.ci.rollup = [
        { status: 'COMPLETED', conclusion: 'SUCCESS', name: 'lint' },
        { status: 'COMPLETED', conclusion: 'FAILURE', name: 'test (ubuntu)' },
      ]
      await clock.advance(25_000)
      expect(await pane.find({ type: 'Text', text: /✗\sCI\séchouée\s:\stest \(ubuntu\)/ })).toBeDefined()
      const band = await mountBand($, surface, 120)
      expect(await band.find({ type: 'Text', text: /✗\sCI\stest \(ubuntu\)/ })).toBeDefined()
      expect(seen.toasts.some((t) => /✗ CI échouée sur feat\/export : test \(ubuntu\)/.test(t))).toBe(true)
      // Avec une PR, les checks passent par elle : aucune lecture des exécutions.
      expect(fake.runs()).toEqual([])
      await band.unmount()
    })
  }

  test('CI sans PR : une exécution annulée puis relancée sur le même commit ne compte pas comme un échec', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ pr: 'none' })
    const seen = engine(on, fake)
    await start($, clock)
    // `concurrency: cancel-in-progress` : deux exécutions du même workflow, la première annulée.
    fake.ci.runs = [
      { status: 'completed', conclusion: 'success', name: 'Checks', url: 'https://github.com/b' },
      { status: 'completed', conclusion: 'cancelled', name: 'Checks', url: 'https://github.com/a' },
    ]
    await push($, clock, fake)
    const pane = await mountPane($, 'terminal')
    expect(await pane.find({ type: 'Text', text: /✓\sCI\sréussie/ })).toBeDefined()
    expect(seen.toasts.some((t) => /✓ CI réussie sur feat\/export \(1\scheck/.test(t))).toBe(true)
    expect(seen.toasts.some((t) => /échouée/.test(t))).toBe(false)
  })

  test('CI avec PR : un check annulé et remplacé ne compte pas ; seul, il reste un échec', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    const seen = engine(on, fake)
    await start($, clock)
    fake.ci.prHead = PUSHED
    fake.ci.rollup = [
      { status: 'COMPLETED', conclusion: 'CANCELLED', name: 'test', workflowName: 'Checks' },
      { status: 'COMPLETED', conclusion: 'SUCCESS', name: 'test', workflowName: 'Checks' },
      { status: 'COMPLETED', conclusion: 'CANCELLED', name: 'deploy', workflowName: 'Release' },
    ]
    await push($, clock, fake)
    const pane = await mountPane($, 'terminal')
    expect(await pane.find({ type: 'Text', text: /✗\sCI\séchouée\s:\sdeploy/ })).toBeDefined()
    expect(seen.toasts.some((t) => /✗ CI échouée sur feat\/export : deploy/.test(t))).toBe(true)
  })

  test('CI : plafond de 20 min, puis le suivi s’arrête', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ pr: 'none' })
    const seen = engine(on, fake)
    await start($, clock)
    fake.ci.runs = [{ status: 'queued', conclusion: '', name: 'build', url: 'https://github.com/x' }]
    await push($, clock, fake)
    const pane = await mountPane($, 'terminal')
    expect(await pane.find({ type: 'Text', text: /◌\sCI\s0\/1/ })).toBeDefined()
    for (let i = 0; i < 50; i++) await clock.advance(25_000)
    expect(seen.toasts.some((t) => /après 20 min : suivi arrêté/.test(t))).toBe(true)
    expect(await pane.find({ type: 'Text', text: /CI\sencore\sen\scours/ })).toBeDefined()
    const polls = fake.runs().length
    await clock.advance(120_000)
    expect(fake.runs().length).toBe(polls)
  })

  test('CI : toujours aucun check au bout de 3 min, « aucun check » et fin du suivi', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ pr: 'none' })
    const seen = engine(on, fake)
    await start($, clock)
    await push($, clock, fake)
    for (let i = 0; i < 8; i++) await clock.advance(25_000)
    const pane = await mountPane($, 'terminal')
    expect(await pane.find({ type: 'Text', text: /aucun\scheck/ })).toBeDefined()
    expect(seen.toasts.some((t) => /CI/.test(t))).toBe(false)
    const polls = fake.runs().length
    await clock.advance(120_000)
    expect(fake.runs().length).toBe(polls)
  })

  test('CI : gh absent, rien ne casse et rien ne s’affiche', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ pr: 'none' })
    fake.ci.ghMissing = true
    engine(on, fake)
    await start($, clock)
    await push($, clock, fake)
    await clock.advance(60_000)
    for (const surface of BANDS) {
      const pane = await mountPane($, surface)
      expect(await pane.find({ type: 'Text', text: 'feat/export' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /CI/ })).toBeUndefined()
    }
  })

  test('CI : un changement de branche arrête le suivi', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ pr: 'none' })
    engine(on, fake)
    await start($, clock)
    await push($, clock, fake)
    const polls = fake.runs().length
    expect(polls).toBe(1)
    fake.repo.branch = 'main'
    await clock.advance(10_000)
    await clock.advance(60_000)
    expect(fake.runs().length).toBe(polls)
    const pane = await mountPane($, 'terminal')
    expect(await pane.find({ type: 'Text', text: /CI/ })).toBeUndefined()
  })

  test('CI : suivie aussi après un /project:push lancé du panneau', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo({ pr: 'none' })
    fake.repo.isDirty = false
    engine(on, fake)
    const pane = await openPane($, clock, 'terminal')
    await pane.press({ key: 'act-push' })
    await pane.press({ key: 'launch' })
    await $.turn.start({ text: '', turnId: 't1' })
    fake.repo.ahead = 0
    fake.repo.behind = 0
    fake.repo.oid = PUSHED
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as any)
    await clock.advance(600)
    expect(fake.runs().length).toBeGreaterThan(0)
    expect(await pane.find({ type: 'Text', text: /◌\sCI\sen\sattente/ })).toBeDefined()
  })

  // ─── Suggestion de fin de tour ────────────────────────────────────────────

  test('fin de tour : /project:push suggéré avec des commits à pousser sur un arbre propre', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    fake.repo.isDirty = false
    const seen = engine(on, fake)
    await start($, clock)
    // Le tour d'un sous-agent ne propose rien.
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', reason: 'end_turn', agentId: 'a1' } as any)
    await clock.settle()
    expect(seen.suggested).toEqual([])
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as any)
    await clock.settle()
    expect(seen.suggested).toEqual(['/project:push'])
  })

  test('fin de tour : rien de suggéré sur un arbre sale ou avec une commande /project en file', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    const seen = engine(on, fake)
    const pane = await openPane($, clock, 'terminal')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as any)
    await clock.settle()
    expect(seen.suggested).toEqual([])

    // Arbre propre, mais /project:version attend son tour.
    fake.repo.isDirty = false
    await pane.press({ key: 'act-push' })
    await pane.press({ key: 'launch-version' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'end_turn' } as any)
    await clock.settle()
    expect(seen.suggested).toEqual([])
  })

  test('fin de tour : rien de suggéré quand il n’y a rien à pousser', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const fake = fakeRepo()
    fake.repo.isDirty = false
    fake.repo.ahead = 0
    const seen = engine(on, fake)
    await start($, clock)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as any)
    await clock.settle()
    expect(seen.suggested).toEqual([])
  })
})
