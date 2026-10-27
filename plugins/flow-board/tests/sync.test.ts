import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

/** Ce que git répond : la branche, la branche principale distante, et le retard de chacune. */
type Remote = {
  branch: string
  mainSha: string
  behindMain: number
  upSha: string
  behindUp: number
  hasUpstream: boolean
  url?: string | null
  /** Commits locaux absents de origin/main ; absent, git échoue (avance inconnue). */
  aheadMain?: number
  /** Le worktree `C:/proj/.claude/worktrees/dev`, s'il existe, et ce que git y répond. */
  dev?: Omit<Remote, 'mainSha' | 'url' | 'dev' | 'cwd'>
  /** Le dossier de la session (`$.session.cwd()`) ; `C:/proj` par défaut. */
  cwd?: string
}

const DEV = 'C:/proj/.claude/worktrees/dev'

/** Le moteur sous le plugin : un projet `C:/proj` dans un dépôt git dont le test règle le distant. */
const world = (on: any, remote: Remote) => {
  const mem: Record<string, unknown> = {}
  const gitCalls: string[] = []
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('session.id', () => ({ value: 'session-A' }))
  on('session.cwd', () => ({ value: remote.cwd ?? 'C:/proj' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value
    return { value: undefined }
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: 'x' } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('process.run', (_$: unknown, e: { argv: readonly string[]; init?: { cwd?: string } }) => {
    const args = e.argv.slice(e.argv.indexOf('core.quotepath=off') + 1).join(' ')
    gitCalls.push(args)
    const out = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    const cwd = String(e.init?.cwd ?? '')
    const inDev = remote.dev !== undefined && (cwd === DEV || cwd.startsWith(`${DEV}/`))
    if (args === 'rev-parse --show-toplevel') return out(inDev ? DEV : 'C:/proj')
    // Ce que répond le worktree du dossier où git tourne.
    const tree = inDev ? { ...remote, ...remote.dev! } : remote
    if (args === 'rev-parse --is-inside-work-tree') return out('true')
    if (args === 'remote get-url origin') return remote.url === null ? out('', 2) : out(remote.url ?? 'git@github.com:me/proj.git')
    if (args.startsWith('fetch')) return out('')
    if (args.startsWith('symbolic-ref')) return out('origin/main')
    if (args === 'rev-parse --abbrev-ref HEAD') return out(tree.branch)
    if (args === 'rev-list --count HEAD..origin/main') return out(String(tree.behindMain))
    if (args === 'rev-list --count origin/main..HEAD') return tree.aheadMain === undefined ? out('', 1) : out(String(tree.aheadMain))
    if (args.includes('--symbolic-full-name')) return tree.hasUpstream ? out(`origin/${tree.branch}`) : out('', 128)
    if (args === 'rev-list --count HEAD..@{u}') return out(String(tree.behindUp))
    if (args === 'rev-parse origin/main') return out(remote.mainSha)
    if (args === 'rev-parse @{u}') return out(tree.upSha)
    return out('', 1)
  })
  return { mem, gitCalls }
}

const start = async ($: any, clock: { advance: (ms: number) => Promise<void> }) => {
  await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
  await clock.advance(10)
}

const edit = ($: any, path: string) =>
  $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' }) as Promise<{ deny?: string }>

test('distant à jour : aucune demande, même avec des modifications locales', async ($, on) => {
  const clock = mock.clock(on, { now: 40_000_000 })
  const { gitCalls } = world(on, { branch: 'feature', mainSha: 'm1', behindMain: 0, upSha: 'u1', behindUp: 0, hasUpstream: true })
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(10)
  expect(gitCalls.some(c => c.startsWith('fetch'))).toBe(true)
  expect((await edit($, 'C:/proj/src/a.ts')).deny).toBeUndefined()
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'sync-now' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /À jour avec origin\/main/ })).toBeDefined()
  await ui.unmount()
})

test('main a avancé : /project:sync base demandé une fois, puis à nouveau à la fusion suivante', async ($, on) => {
  const clock = mock.clock(on, { now: 41_000_000 })
  const remote = { branch: 'feature', mainSha: 'm1', behindMain: 3, upSha: 'u1', behindUp: 0, hasUpstream: true }
  world(on, remote)
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(10)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Main a 3 nouveaux commits/ })).toBeDefined()
    expect((await ui.find({ key: 'sync-now' }))?.props).toMatchObject({ label: 'Préparer /project:sync base' })
    await ui.unmount()
  }

  // La doc passe toujours ; le code est refusé une fois, avec la bonne commande.
  expect((await edit($, 'C:/proj/README.md')).deny).toBeUndefined()
  const first = await edit($, 'C:/proj/src/a.ts')
  expect(first.deny).toMatch(/\/project:sync base/)
  expect((await edit($, 'C:/proj/src/a.ts')).deny).toBeUndefined()

  // Une nouvelle PR est fusionnée sur main : le prochain fetch la voit, la demande revient une fois.
  remote.mainSha = 'm2'
  remote.behindMain = 4
  await $.tool.call({ tool: 'Bash', command: 'git fetch origin' } as any)
  await clock.advance(10)
  expect((await edit($, 'C:/proj/src/a.ts')).deny).toMatch(/4 nouveaux commits/)
  expect((await edit($, 'C:/proj/src/a.ts')).deny).toBeUndefined()
})

test('après le sync, le retard est remesuré et plus rien n’est demandé', async ($, on) => {
  const clock = mock.clock(on, { now: 42_000_000 })
  const remote = { branch: 'feature', mainSha: 'm1', behindMain: 2, upSha: 'u1', behindUp: 1, hasUpstream: true }
  world(on, remote)
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  // Les deux retards : /project:sync seul d'abord (la branche distante a souvent été remise sur main).
  expect((await ui.find({ key: 'sync-now' }))?.props).toMatchObject({ label: 'Préparer /project:sync' })
  expect(await ui.find({ type: 'Text', text: /Ta branche distante a 1 nouveau commit et main a 2 nouveaux commits/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sync puis/ })).toBeUndefined()
  await ui.unmount()

  // L'utilisateur lance /project:sync base ; Claude fait le merge.
  await $.skill.prompt({ skill: 'project:sync', text: 'y' })
  remote.behindMain = 0
  remote.behindUp = 0
  await $.tool.call({ tool: 'Bash', command: 'git fetch --prune origin && git merge origin/main' } as any)
  await clock.advance(10)
  expect((await edit($, 'C:/proj/src/a.ts')).deny).toBeUndefined()
})

test('sur main, /project:sync suffit', async ($, on) => {
  const clock = mock.clock(on, { now: 43_000_000 })
  const remote = { branch: 'main', mainSha: 'm1', behindMain: 1, upSha: 'm1', behindUp: 1, hasUpstream: true }
  world(on, remote)
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'x' })
  await clock.advance(10)
  const first = await edit($, 'C:/proj/src/a.ts')
  expect(first.deny).toMatch(/lancer \/project:sync \(/)
})

test('après /project:sync, base n’est proposé que si main est encore en avance', async ($, on) => {
  const clock = mock.clock(on, { now: 44_000_000 })
  const remote = { branch: 'dev', mainSha: 'm1', behindMain: 2, upSha: 'u1', behindUp: 3, hasUpstream: true }
  world(on, remote)
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(10)
  expect((await edit($, 'C:/proj/src/a.ts')).deny).toMatch(/lancer \/project:sync \(/)

  // Le pull a ramené dev, mais main a encore un commit d'avance : cette fois, base.
  remote.upSha = 'u2'
  remote.behindUp = 0
  remote.mainSha = 'm2'
  remote.behindMain = 1
  await $.tool.call({ tool: 'Bash', command: 'git pull --rebase --autostash' } as any)
  await clock.advance(10)
  expect((await edit($, 'C:/proj/src/a.ts')).deny).toMatch(/\/project:sync base/)
})

test('un dépôt sans distant origin : ni « À jour », ni demande de sync', async ($, on) => {
  const clock = mock.clock(on, { now: 45_000_000 })
  const { gitCalls } = world(on, { branch: 'main', mainSha: '', behindMain: 0, upSha: '', behindUp: 0, hasUpstream: false, url: null })
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(10)
  expect(gitCalls.some(c => c.startsWith('fetch'))).toBe(false)
  expect((await edit($, 'C:/proj/src/a.ts')).deny).toBeUndefined()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /À jour avec/ })).toBeUndefined()
    expect(await ui.find({ key: 'sync-now' })).toBeUndefined()
    await ui.unmount()
  }
})

// ─── Dépôt qui code dans un worktree : le dossier principal reste sur main ─────────────

/** Le dossier principal sur main, qui ne reçoit que des avances rapides, et `dev` dans son worktree. */
const mainFolder = (behindMain: number, dev: NonNullable<Remote['dev']>, cwd: string): Remote => ({
  branch: 'main',
  mainSha: 'm1',
  behindMain,
  upSha: 'm1',
  behindUp: behindMain,
  hasUpstream: true,
  aheadMain: 0,
  dev,
  cwd,
})

test('dossier principal sur main en retard, worktree dev à jour : ni avis ni refus pour un fichier du worktree', async ($, on) => {
  const clock = mock.clock(on, { now: 48_000_000 })
  const remote = mainFolder(2, { branch: 'dev', behindMain: 0, aheadMain: 3, upSha: 'd1', behindUp: 0, hasUpstream: true }, `${DEV}/src`)
  world(on, remote)
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(10)

  // La session travaille dans le worktree : c'est lui qui est mesuré, et il contient origin/main.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ key: 'sync-now' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Main a 2/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /À jour avec origin\/main dans \.claude\/worktrees\/dev/ })).toBeDefined()
    await ui.unmount()
  }
  expect((await edit($, `${DEV}/src/a.py`)).deny).toBeUndefined()
  // Un fichier neuf dans un dossier qui n'existe pas encore : son worktree se trouve en remontant.
  expect((await edit($, `${DEV}/src/neuf/b.py`)).deny).toBeUndefined()

  // Même mesurée depuis le dossier principal (session revenue à la racine), la modification d'un
  // fichier du worktree se juge sur le worktree : rien n'est refusé.
  remote.cwd = 'C:/proj'
  await $.tool.call({ tool: 'Bash', command: 'git fetch origin' } as any)
  await clock.advance(10)
  expect((await edit($, `${DEV}/src/a.py`)).deny).toBeUndefined()
})

test('worktree dev en retard sur origin/main : avis et refus comme aujourd’hui', async ($, on) => {
  const clock = mock.clock(on, { now: 49_000_000 })
  world(on, mainFolder(2, { branch: 'dev', behindMain: 2, aheadMain: 3, upSha: 'd1', behindUp: 0, hasUpstream: true }, DEV))
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(10)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Main a 2 nouveaux commits/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Avant de modifier le code dans \.claude\/worktrees\/dev : \/project:sync base/ })).toBeDefined()
    expect((await ui.find({ key: 'sync-now' }))?.props).toMatchObject({ label: 'Préparer /project:sync base' })
    await ui.unmount()
  }
  expect((await edit($, `${DEV}/src/a.py`)).deny).toMatch(/lancer \/project:sync base/)
  expect((await edit($, `${DEV}/src/a.py`)).deny).toBeUndefined()
})

test('worktree dev en retard, session au dossier principal à jour : le fichier du worktree est quand même refusé une fois', async ($, on) => {
  const clock = mock.clock(on, { now: 50_000_000 })
  world(on, mainFolder(0, { branch: 'dev', behindMain: 2, aheadMain: 3, upSha: 'd1', behindUp: 0, hasUpstream: true }, 'C:/proj'))
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'sync-now' })).toBeUndefined()
  await ui.unmount()
  expect((await edit($, 'C:/proj/src/a.py')).deny).toBeUndefined()
  expect((await edit($, `${DEV}/src/a.py`)).deny).toMatch(/lancer \/project:sync base/)
  expect((await edit($, `${DEV}/src/a.py`)).deny).toBeUndefined()
})

test('dossier principal sur main en retard sans commit en avance : avance rapide par git pull --ff-only', async ($, on) => {
  const clock = mock.clock(on, { now: 51_000_000 })
  world(on, mainFolder(2, { branch: 'dev', behindMain: 0, aheadMain: 3, upSha: 'd1', behindUp: 0, hasUpstream: true }, 'C:/proj'))
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(10)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Main a 2 nouveaux commits/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Avant de modifier le code : git pull --ff-only/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /project:sync/ })).toBeUndefined()
    expect((await ui.find({ key: 'sync-now' }))?.props).toMatchObject({ label: 'Préparer git pull --ff-only' })
    await ui.unmount()
  }
  // Le bouton met dans le prompt une demande à Claude, pas une commande réservée.
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'sync-now' })
  await ui.unmount()
  expect(filled.at(-1)).toBe('Mets à jour C:/proj en avance rapide : git -C "C:/proj" pull --ff-only')

  // Un fichier de l'autre worktree, à jour, n'est pas bloqué.
  expect((await edit($, `${DEV}/src/a.py`)).deny).toBeUndefined()
  // Un fichier du dossier principal : refusé une fois, avec l'avance rapide et non /project:sync.
  const first = await edit($, 'C:/proj/src/a.py')
  expect(first.deny).toMatch(/git pull --ff-only dans C:\/proj/)
  expect(first.deny).not.toMatch(/project:sync/)
  expect((await edit($, 'C:/proj/src/a.py')).deny).toBeUndefined()
})

const TOOL = 'mcp__flow-board__flow'

/** Implémentation finie puis Version et push : la suite dépend de l'hébergeur de origin. */
const delivered = async ($: any, clock: { advance: (ms: number) => Promise<void> }) => {
  await start($, clock)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, complete: true })
  await $.skill.prompt({ skill: 'project:version', text: 'v' })
  // Version puis push : la phase combinée ne se clôt qu'une fois poussée.
  await $.tool.call({ tool: TOOL, step: 'pushed' })
  await $.tool.call({ tool: TOOL, complete: true })
}

test('origin ailleurs que sur GitHub : ni phase ni suggestion « Pull request »', async ($, on) => {
  const clock = mock.clock(on, { now: 46_000_000 })
  world(on, { branch: 'main', mainSha: 'm1', behindMain: 0, upSha: 'u1', behindUp: 0, hasUpstream: true, url: 'git@gitlab.com:me/proj.git' })
  await delivered($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ key: 'go-project:pr' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Pull request/ })).toBeUndefined()
    // Plus rien d'obligatoire : le parcours peut être clos.
    expect(await ui.find({ key: 'finish' })).toBeDefined()
    await ui.unmount()
  }
})

test('origin sur GitHub : la suite reste « Pull request · /project:pr »', async ($, on) => {
  const clock = mock.clock(on, { now: 47_000_000 })
  world(on, { branch: 'main', mainSha: 'm1', behindMain: 0, upSha: 'u1', behindUp: 0, hasUpstream: true, url: 'https://github.com/me/proj.git' })
  await delivered($, clock)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect((await ui.find({ key: 'go-project:pr' }))?.props).toMatchObject({ label: '▶ Pull request · /project:pr --auto' })
  await ui.unmount()
})
