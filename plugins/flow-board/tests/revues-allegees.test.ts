import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyReport, commandArgsOf, emptyBoard, needsReview, newRun } from '../hooks/model.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const boardWith = (input: Record<string, unknown>): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}

// Un groupe d'un seul ticket sans logique (une icône) avait eu quatre revues Opus en cascade, la
// revue du groupe relisant le même diff que celle du ticket.
test('un groupe d’un seul ticket ni sensible ni avec logique n’attend pas de revue du groupe ; avec de la logique, si', () => {
  const icon = boardWith({
    tickets: [{ id: 'i1', name: 'Icône', status: 'done', sensitive: false, logic: false }],
    groups: [{ id: 'I', name: 'Icône', tickets: ['i1'] }],
  })
  expect(needsReview(activeRun(icon)!)).toBe(false)
  const code = boardWith({
    tickets: [{ id: 'c1', name: 'Route', status: 'done', sensitive: false, logic: true }],
    groups: [{ id: 'C', name: 'Route', tickets: ['c1'] }],
  })
  expect(needsReview(activeRun(code)!)).toBe(true)
  // Sans avis sur le ticket, la revue du groupe reste due.
  const silent = boardWith({
    tickets: [{ id: 's1', name: 'Sans avis', status: 'done' }],
    groups: [{ id: 'S', name: 'Sans avis', tickets: ['s1'] }],
  })
  expect(needsReview(activeRun(silent)!)).toBe(true)
  // Sensible, même sans logique : la revue du groupe reste due.
  const sensitive = boardWith({
    tickets: [{ id: 'p1', name: 'Purge', status: 'done', sensitive: true, logic: false }],
    groups: [{ id: 'P', name: 'Purge', tickets: ['p1'] }],
  })
  expect(needsReview(activeRun(sensitive)!)).toBe(true)
})

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

test('le groupe d’une icône finie s’affiche relu par la revue de son ticket, sans bouton de revue du groupe', async ($, on) => {
  mock.clock(on, { now: 60_000_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: 'i1', name: 'Icône', sensitive: false, logic: false },
      { id: 'c1', name: 'Route', sensitive: false, logic: true },
    ],
    groups: [
      { id: 'I', name: 'Icône', tickets: ['i1'] },
      { id: 'C', name: 'Route', tickets: ['c1'] },
    ],
  } as any)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, set: [{ id: 'i1', status: 'done' }, { id: 'c1', status: 'done' }] } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'review-group-I' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^✓.revu par son ticket$/ })).toBeDefined()
  expect(await ui.find({ key: 'review-group-C' })).toBeDefined()
  await ui.unmount()
})

test('les consignes : seuil compté sans fichiers générés, sécurité avec la revue du groupe, constats anciens à part', async ($, on) => {
  mock.clock(on, { now: 61_000_000 })
  mock.store(on)
  world(on)
  const implement = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text as string
  // Le seuil des 100 lignes ne compte que le code écrit.
  expect(implement).toContain('git diff --numstat, without generated files nor binaries')
  expect(implement).toContain('both axes in a single reviewer subagent')
  // La revue de sécurité, en lecture seule, part avec la revue du groupe, puis relit le diff des correctifs.
  expect(implement).toContain('Revue du groupe (')
  expect(implement).toContain('in the same message as the group review')
  expect(implement).toContain('the diff of those fixes only')
  // Un groupe d'un seul ticket sans logique ni zone sensible n'a pas de revue du groupe.
  expect(implement).toContain('A group of a single ticket sent with "sensitive": false and "logic": false has no group review')
  // Les constats sur du code antérieur au lot : à part, non corrigés, un groupe « durcissement » en fin de lot.
  expect(implement).toContain('findings on code older than the lot')
  expect(implement).toContain('« durcissement »')
})

// Le bouton « ◆ Revue du groupe » mettait toujours /code-review high --fix, même pour un groupe
// sensible, contre la règle des revues (Mathis, 26/10/2026 : « Sans --fix si sensible »).
test('le bouton de revue d’un groupe sensible met /code-review high sans --fix ; un autre groupe garde --fix', async ($, on) => {
  mock.clock(on, { now: 62_000_000 })
  mock.store(on)
  const filled = world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: 'p1', name: 'Purge', sensitive: true, logic: true },
      { id: 'c1', name: 'Route', sensitive: false, logic: true },
    ],
    groups: [
      { id: 'P', name: 'Purge', tickets: ['p1'] },
      { id: 'C', name: 'Route', tickets: ['c1'] },
    ],
  } as any)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, set: [{ id: 'p1', status: 'done' }, { id: 'c1', status: 'done' }] } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Button', label: /^◆.Revue du groupe · \/code-review high$/ })).toBeDefined()
  await ui.press({ key: 'review-group-P' })
  expect(filled.at(-1)).toBe('/code-review high')
  await ui.press({ key: 'review-group-C' })
  expect(filled.at(-1)).toBe('/code-review high --fix')
  await ui.unmount()
})

// Commit avant la revue pour un ticket hors zone sensible (Mathis, 26/10/2026 : « Non sensible seulement »).
test('un ticket hors zone sensible se commite avant sa revue ; un ticket sensible garde sa revue avant son commit', async ($, on) => {
  mock.clock(on, { now: 63_000_000 })
  mock.store(on)
  world(on)
  const implement = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text as string
  expect(implement).toContain('a ticket sent with "sensitive": false is committed once its checks pass, before its review')
  expect(implement).toContain('<commit before the ticket>..<the ticket\'s commit>, never ..HEAD')
  expect(implement).toContain('its findings go in "review" without "step"')
  expect(implement).toContain('the ticket turns done in the tracker only once its review is back and its fixes are committed')
  expect(implement).toContain('its fixes land in a commit of their own')
  expect(implement).toContain('a ticket that touches a sensitive area, or did not say, keeps its review before its commit')
  expect(implement).toContain('/code-review high --fix (high without --fix for a group with a sensitive ticket)')
})

test('sans groupes, la revue proposée perd --fix dès qu’un ticket du lot est sensible', () => {
  const lot = boardWith({ tickets: [{ id: 'p1', name: 'Purge', status: 'done', sensitive: true, logic: true }] })
  expect(commandArgsOf(activeRun(lot), 'final-review')).toBe('high')
  const plain = boardWith({ tickets: [{ id: 'c1', name: 'Route', status: 'done', sensitive: false, logic: true }] })
  expect(commandArgsOf(activeRun(plain), 'final-review')).toBe('high --fix')
  // Sans avis, le ticket compte comme sensible.
  const silent = boardWith({ tickets: [{ id: 's1', name: 'Sans avis', status: 'done' }] })
  expect(commandArgsOf(activeRun(silent), 'final-review')).toBe('high')
  // Les autres commandes gardent leurs arguments.
  expect(commandArgsOf(activeRun(lot), 'implement')).toBe('')
})
