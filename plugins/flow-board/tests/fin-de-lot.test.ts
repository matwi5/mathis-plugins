import { expect, mock, test } from 'claude-code/testing'

import { suggestionsFor, versionSet } from '../hooks/model.ts'
import type { Board } from '../types'

// En fin de lot, /project:version et /project:push se proposent côte à côte, au choix ; une version
// déjà posée par le lot (0.60.0 posée par son dernier ticket) ne se repropose pas.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.root', () => ({ value: 'C:/proj' }))
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value
    return { value: undefined }
  })
  return mem
}

/** Un parcours d'implémentation dont le compte rendu vient d'être validé. */
const reportValidated = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: 31_000_000 })
  const mem = world(on)
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

test('version déjà posée : /project:push en tête, /project:version n’est pas reproposé, la carte le dit', { timeoutMs: 15000 }, async ($, on) => {
  const run = await reportValidated($, on)
  const sug = suggestionsFor(run, { isVersionSet: true })
  expect(sug.primary).toBe('project:push')
  expect(sug.others).not.toContain('project:version')
  expect(sug.versionNote).toBe('version déjà posée : chaque plugin changé a une nouvelle version face au distant')
})

test('version à poser : /project:version et /project:push côte à côte, au choix', { timeoutMs: 15000 }, async ($, on) => {
  const run = await reportValidated($, on)
  const due = suggestionsFor(run, { isVersionSet: false })
  expect(due.primary).toBe('project:version')
  expect(due.others[0]).toBe('project:push')
  expect(due.versionNote).toContain('/project:version, ou /project:push sans version')
  // Sans mesure (pas de manifeste, pas de distant) : les deux, sans note.
  const unknown = suggestionsFor(run, {})
  expect(unknown.primary).toBe('project:version')
  expect(unknown.others[0]).toBe('project:push')
  expect(unknown.versionNote).toBeUndefined()
  // La carte « Prochaine étape » montre les deux boutons.
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'go-project:version' })).toBeDefined()
  expect(await ui.find({ key: 'go-project:push' })).toBeDefined()
  await ui.unmount()
})

test('versionSet : chaque dossier versionné changé a changé sa ligne de version', () => {
  const manifests = ['plugins/a/.claude-plugin/plugin.json', 'plugins/b/.claude-plugin/plugin.json']
  // Sans manifeste, rien à mesurer.
  expect(versionSet(['x.ts'], [], [])).toBeNull()
  // Seule la doc de la racine a changé : rien à versionner.
  expect(versionSet(['CLAUDE.md', '.claude-plugin/marketplace.json'], manifests, [])).toBe(true)
  // Le plugin a changé et sa version aussi.
  expect(versionSet(['plugins/a/hooks/x.ts', 'plugins/a/.claude-plugin/plugin.json'], manifests, [manifests[0]!])).toBe(true)
  // Un plugin changé sans nouvelle version.
  expect(versionSet(['plugins/a/hooks/x.ts', 'plugins/b/README.md'], manifests, [manifests[0]!])).toBe(false)
  // Un paquet à la racine : tout changement le concerne.
  expect(versionSet(['src/app.ts'], ['package.json'], [])).toBe(false)
  expect(versionSet(['src/app.ts', 'package.json'], ['package.json'], ['package.json'])).toBe(true)
})
