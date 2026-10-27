import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, newRun } from '../hooks/model.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const KEY = 'board:'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

/**
 * Le moteur sous le plugin, avec un stockage en mémoire que le test modifie lui-même :
 * c'est ainsi qu'il joue la seconde discussion (B) à côté de celle du plugin (A).
 */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  return mem
}

/** session.start pose la minuterie qui relit le stockage toutes les 5 s. */
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/** Ce que la discussion B a écrit : son parcours actif « Parcours de B ». */
const writtenByB = (mem: Record<string, unknown>, now: number, status: 'active' | 'paused' = 'active') => {
  const base = (mem[KEY] as Board | undefined) ?? emptyBoard('', 'projet')
  const run = { ...newRun('diagnosing-bugs', now, 'Parcours de B'), status, owner: status === 'active' ? 'session-B' : undefined }
  mem[KEY] = { ...base, runs: [run, ...base.runs], activeId: run.id, session: 'session-B' }
  return run
}

const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}

test('la discussion A voit, en quelques secondes, le parcours lancé dans la discussion B', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 20_000_000 })
  const mem = world(on)
  await start($)

  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Parcours de A' })
  // A a fini d'enregistrer : seule sa relecture périodique peut lui montrer ce que B écrit ensuite.
  await settle(clock, 1)
  writtenByB(mem, 20_001_500)
  await settle(clock, 6)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    // A garde son parcours actif…
    expect(await ui.find({ type: 'Text', text: /^Parcours de A$/ })).toBeDefined()
    await ui.press({ key: 'tab-history' })
    // … et voit celui de B, marqué comme tenu par une autre discussion.
    expect(await ui.find({ type: 'Text', text: /^Parcours de B$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /autre discussion/ })).toBeDefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})

test('une sauvegarde de A n’efface plus le parcours de B', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 21_000_000 })
  const mem = world(on)
  await start($)

  await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'x' })
  await settle(clock, 1)
  writtenByB(mem, 21_001_500)
  // A enregistre aussitôt, avant d'avoir relu le stockage.
  await $.tool.call({ tool: TOOL, note: 'une décision' })
  await settle(clock, 1)

  const stored = mem[KEY] as Board
  expect(stored.runs.map(r => r.title).sort()).toEqual(['Parcours de B', 'TDD'])
  // Le parcours de B reste actif chez B : A ne l'a pas mis en pause.
  expect(stored.runs.find(r => r.title === 'Parcours de B')?.status).toBe('active')
})

test('un parcours archivé dans A le reste, même quand B réécrit son ancienne copie', async ($, on) => {
  const clock = mock.clock(on, { now: 22_000_000 })
  const mem = world(on)
  await start($)

  await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'x' })
  const b = writtenByB(mem, 22_000_100, 'paused')
  await settle(clock, 6)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: `archive-${b.id}` })
  // Archivé : caché de l'historique, il revient sous « Archivés ».
  expect(await ui.find({ key: `resume-${b.id}` })).toBeUndefined()
  await ui.press({ key: 'archived-toggle' })
  expect(await ui.find({ key: `unarchive-${b.id}` })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
  await settle(clock, 1)
  expect((mem[KEY] as Board).runs.find(r => r.id === b.id)?.archivedAt).toBeDefined()

  // B, qui ne savait rien, réécrit son ancienne copie : l'archivage, plus récent, l'emporte.
  const stale = mem[KEY] as Board
  mem[KEY] = { ...stale, runs: [{ ...b }, ...stale.runs.filter(r => r.id !== b.id)] }
  await settle(clock, 6)
  await $.tool.call({ tool: TOOL, note: 'encore' })
  await settle(clock, 1)
  expect((mem[KEY] as Board).runs.find(r => r.id === b.id)?.archivedAt).toBeDefined()

  // Désarchivé : il revient dans l'historique, prêt à reprendre.
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await again.press({ key: 'tab-history' })
  // La liste des archivés est restée dépliée depuis tout à l'heure (choix de la discussion).
  await again.press({ key: `unarchive-${b.id}` })
  expect(await again.find({ key: `resume-${b.id}` })).toBeDefined()
  await again.unmount()
})

test('reprendre ici le parcours de B en fait le parcours actif de A', async ($, on) => {
  const clock = mock.clock(on, { now: 23_000_000 })
  const mem = world(on)
  await start($)

  await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'x' })
  const b = writtenByB(mem, 23_000_100)
  await settle(clock, 6)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: `resume-${b.id}` })
  expect(await ui.find({ type: 'Text', text: /^Parcours de B$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Dans une autre discussion/ })).toBeUndefined()
  await ui.unmount()
  await settle(clock, 1)
  expect((mem[KEY] as Board).runs.find(r => r.id === b.id)?.owner).toBe('session-A')
})
