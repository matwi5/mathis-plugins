import { expect, mock, test } from 'claude-code/testing'

import { proposeBump, suggestionsFor, versionPreview } from '../hooks/model.ts'
import type { Board, VersionCommit } from '../types'

// En fin de parcours, la version passe par /project:version, lancé depuis le bouton Version, avec un
// aperçu « version précédente → nouvelle version » sous les boutons (Mathis, rétro du parcours xhigh,
// V1 à V3) : Version en tête tant qu'une partie changée n'a pas sa nouvelle version, Push en tête
// quand elle est déjà posée ou que le projet n'a pas de fichier de version, l'autre toujours à côté.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const commit = (subject: string, isBreaking = false): VersionCommit => ({ subject, isBreaking })

/** Ce que git répond dans un dépôt de marketplace : `a` changé sans nouvelle version, `b` déjà monté. */
const GIT: Record<string, string> = {
  'rev-parse --is-inside-work-tree': 'true',
  'remote get-url origin': 'git@github.com:me/proj.git',
  'symbolic-ref --quiet --short refs/remotes/origin/HEAD': 'origin/main',
  'rev-parse --abbrev-ref HEAD': 'main',
  'rev-list --count HEAD..origin/main': '0',
  'rev-list --count origin/main..HEAD': '6',
  'rev-parse origin/main': 'm1',
  'rev-parse --show-toplevel': 'C:/proj',
  'diff --name-only origin/main...HEAD': ['plugins/a/hooks/x.ts', 'plugins/b/hooks/y.ts', 'plugins/b/.claude-plugin/plugin.json'].join('\n'),
  'ls-files .claude-plugin/plugin.json */.claude-plugin/plugin.json package.json */package.json pyproject.toml */pyproject.toml Cargo.toml */Cargo.toml':
    'plugins/a/.claude-plugin/plugin.json\nplugins/b/.claude-plugin/plugin.json',
  'show HEAD:.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ source: './plugins/a' }, { source: './plugins/b' }] }),
  'diff -U0 origin/main...HEAD -- plugins/b/.claude-plugin/plugin.json': '-  "version": "0.3.2",\n+  "version": "0.4.0",',
  'merge-base origin/main HEAD': 'f0',
  'show HEAD:plugins/a/.claude-plugin/plugin.json': '{ "name": "a", "version": "0.67.0" }',
  'log -1 --format=%H -G "version"[[:space:]]*: -- plugins/a/.claude-plugin/plugin.json': 'v1',
  'log --no-merges --max-count=500 --format=%x1e%s%x1f%b v1..HEAD -- plugins/a': ['', 'feat(a): un\x1f', 'feat(a): deux\x1f', 'fix(a): trois\x1f', 'docs(a): quatre\x1f'].join('\x1e'),
  'show HEAD:plugins/b/.claude-plugin/plugin.json': '{ "name": "b", "version": "0.4.0" }',
  'show f0:plugins/b/.claude-plugin/plugin.json': '{ "name": "b", "version": "0.3.2" }',
}

const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value
    return { value: undefined }
  })
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    const args = e.argv.slice(e.argv.indexOf('core.quotepath=off') + 1).join(' ')
    const stdout = GIT[args]
    return { value: { exitCode: stdout === undefined ? 1 : 0, stdout: stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return mem
}

/** Un parcours d'implémentation dont le compte rendu vient d'être validé, le distant mesuré. */
const reportValidated = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: 31_000_000 })
  const mem = world(on)
  await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, complete: true })
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'report-ok' })
  await ui.unmount()
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const board = Object.values(mem).find((v: any) => v && Array.isArray(v.runs)) as Board
  return board.runs.find(r => r.id === board.activeId)!
}

test('les trois ordres : Version en tête à poser, Push en tête déjà posée ou sans fichier de version, l’autre à côté', { timeoutMs: 15000 }, async ($, on) => {
  const run = await reportValidated($, on)
  const due = suggestionsFor(run, { isVersionSet: false })
  expect([due.primary, due.others[0]]).toEqual(['project:version', 'project:push'])
  const set = suggestionsFor(run, { isVersionSet: true, versionUnits: [{ name: 'flow-board', version: '0.67.0', from: '0.65.1' }] })
  expect([set.primary, set.others[0]]).toEqual(['project:push', 'project:version'])
  expect(set.versionPreview).toEqual(['flow-board déjà posée : 0.65.1 → 0.67.0'])
  const none = suggestionsFor(run, { isVersionSet: null })
  expect([none.primary, none.others[0]]).toEqual(['project:push', 'project:version'])
  expect(none.versionNote).toBe('pas de fichier de version dans le projet : /project:push, ou /project:version pour en poser une')
  expect(none.versionPreview).toBeUndefined()
  // Pas encore mesuré : Version en tête, comme avant la mesure.
  expect(suggestionsFor(run, {}).primary).toBe('project:version')
})

test('proposeBump : mineure, correctif, majeure, sous la 1.0.0, pré-version', () => {
  expect(proposeBump('0.67.0', [commit('feat(flow-board): x'), commit('fix: y')])).toMatchObject({ next: '0.68.0', kind: 'mineure', feat: 1, fix: 1 })
  expect(proposeBump('1.3.0', [commit('fix(project): y'), commit('docs: z'), commit('chore: w')])).toMatchObject({ next: '1.3.1', kind: 'correctif', fix: 1, total: 3 })
  expect(proposeBump('1.3.0', [commit('feat!: tout change')])).toMatchObject({ next: '2.0.0', kind: 'majeure', breaking: 1, feat: 0 })
  expect(proposeBump('2.1.4', [commit('refactor(api): z', true)])).toMatchObject({ next: '3.0.0', kind: 'majeure', breaking: 1 })
  // Sous la 1.0.0, un changement cassant monte la mineure : la majeure reste 0.
  expect(proposeBump('0.4.2', [commit('feat(api)!: renommé')])).toMatchObject({ next: '0.5.0', kind: 'mineure', breaking: 1 })
  // Une pré-version qui finit par un nombre avance ce nombre.
  expect(proposeBump('1.3.1-mathis.2', [commit('feat: retro')])).toMatchObject({ next: '1.3.1-mathis.3', kind: 'pré-version' })
  expect(proposeBump('0.1.0', [])).toBeNull()
  expect(proposeBump('beta', [commit('feat: x')])).toBeNull()
})

test('versionPreview : une ligne par partie, déjà posée ou proposée, trois au plus puis « + N autres »', () => {
  const units = [
    { name: 'flow-board', version: '0.67.0', commits: [commit('feat: a'), commit('feat: b'), commit('feat: c'), commit('fix: d'), commit('fix: e')] },
    { name: 'project', version: '1.3.0', from: '1.2.0' },
    { name: 'agents', version: '1.0.2', commits: [commit('docs: lisez-moi')] },
    { name: 'setup', version: '0.2.0', commits: [] },
  ]
  expect(versionPreview(units)).toEqual([
    'flow-board 0.67.0 → 0.68.0 · mineure : 3 feat, 2 fix',
    'project déjà posée : 1.2.0 → 1.3.0',
    'agents 1.0.2 → 1.0.3 · correctif : 1 commit',
  ])
  const more = [...units, { name: 'git-board', version: '0.4.5', commits: [commit('fix: x')] }, { name: 'stats-board', version: '0.11.0', commits: [commit('feat!: y')] }]
  expect(versionPreview(more)).toEqual([
    'flow-board 0.67.0 → 0.68.0 · mineure : 3 feat, 2 fix',
    'project déjà posée : 1.2.0 → 1.3.0',
    'agents 1.0.2 → 1.0.3 · correctif : 1 commit',
    '+ 2 autres',
  ])
  expect(versionPreview(more.slice(0, 4).concat(more[4]!)).at(-1)).toBe('+ 1 autre')
})

test('la carte « Ensuite » montre l’aperçu sous les boutons Version et Push, mesuré dans le dépôt, sur chaque surface', { timeoutMs: 20000 }, async ($, on) => {
  await reportValidated($, on)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    // `a` a changé sans nouvelle version : Version en tête, Push à côté.
    expect((await ui.find({ key: 'go-project:version' }))?.props).toMatchObject({ variant: 'primary' })
    expect(await ui.find({ key: 'go-project:push' })).toBeDefined()
    expect(await ui.find({ key: 'version-preview' })).toBeDefined()
    // Hors fusions, les commits depuis le dernier changement de version de `a` ; `b`, déjà monté.
    expect(await ui.find({ type: 'Text', text: 'a 0.67.0 → 0.68.0 · mineure : 2 feat, 1 fix' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'b déjà posée : 0.3.2 → 0.4.0' })).toBeDefined()
    await ui.unmount()
  }
})
