import { expect, mock, test } from 'claude-code/testing'

import { newRun, suggestionsFor, upgradeRun } from '../hooks/model.ts'
import type { FlowPhase, Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
}

const skills = (run: Run) => run.phases.map(p => `${p.skill}:${p.status}`)

/** Un parcours tel que l'écrivaient les versions d'avant la 0.5.0 : Corps de PR puis Rétro. */
const oldRun = (): Run => {
  const run = newRun('to-tickets', 1_000)
  const phase = (skill: string, status: FlowPhase['status']): FlowPhase => ({ ...run.phases[0]!, skill, status, alts: [], isOptional: true })
  return {
    ...run,
    cursor: 1,
    phases: [phase('to-tickets', 'done'), phase('implement', 'active'), phase('pr', 'pending'), phase('retro', 'pending')],
  }
}

test('un ancien parcours passe à Version et push puis Pull request, sans rétro ni revue finale', () => {
  const run = upgradeRun(oldRun())
  expect(skills(run)).toEqual(['to-tickets:done', 'implement:active', 'compte-rendu:pending', 'project:version:pending', 'project:pr:pending'])
  // Un parcours mis à niveau par la 0.13.0 perd sa phase « Revue finale » à venir.
  const withFinal = { ...run, phases: [...run.phases.slice(0, 2), { ...run.phases[2]!, skill: 'final-review' }, ...run.phases.slice(2)] }
  expect(skills(upgradeRun(withFinal))).toEqual(['to-tickets:done', 'implement:active', 'compte-rendu:pending', 'project:version:pending', 'project:pr:pending'])
  expect(run.cursor).toBe(1)
  // Déjà à jour : rendu tel quel.
  expect(upgradeRun(run)).toBe(run)
})

test('la mise à niveau ne touche ni à une rétro faite, ni à un corps de PR déjà lancé', () => {
  const base = oldRun()
  const run = {
    ...base,
    cursor: 2,
    phases: base.phases.map((p, i) => (i < 2 ? { ...p, status: 'done' as const } : i === 2 ? { ...p, status: 'active' as const } : p)),
  }
  expect(skills(upgradeRun(run))).toEqual(['to-tickets:done', 'implement:done', 'pr:active'])
})

test('les nouveaux parcours n’ont plus de phase Rétro', () => {
  for (const entry of ['grill-with-docs', 'to-spec', 'to-tickets', 'implement', 'pr']) {
    expect(newRun(entry, 1).phases.some(p => p.skill === 'retro')).toBe(false)
  }
})

test('tant que des tickets restent ouverts, la livraison n’est pas proposée ; la rétro l’est toujours', () => {
  const run = upgradeRun(oldRun())
  run.tickets = [
    { id: '1', name: 'Un', status: 'done' },
    { id: '2', name: 'Deux', status: 'todo' },
  ]
  const open = suggestionsFor(run)
  expect([open.primary, ...open.others]).not.toContain('project:version')
  expect([open.primary, ...open.others]).not.toContain('compte-rendu')
  expect([open.primary, ...open.others]).not.toContain('pr')
  expect(open.others).toContain('retro')

  run.tickets[1]!.status = 'done'
  const done = suggestionsFor(run)
  expect(done.primary).toBe('final-review')
  expect(done.others).toContain('retro')
})

test('le panneau : ni revue finale ni Version et push avec des tickets ouverts, et une rétro à portée de main', async ($, on) => {
  mock.clock(on, { now: 70_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'T1', name: 'Un' }] } as any)

  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-project:version' })).toBeUndefined()
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeUndefined()
  expect(await ui.find({ key: 'go-final-review' })).toBeUndefined()
  expect(await ui.find({ key: 'go-retro' })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: TOOL, set: [{ id: 'T1', status: 'done' }] } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-final-review' })).toBeDefined()
  await ui.unmount()
})

test('un sous-agent refusé s’affiche « annulé », pas en échec', async ($, on) => {
  mock.clock(on, { now: 71_000_000 })
  mock.store(on)
  engine(on)
  on('tool.call', { tool: 'Agent' }, () => ({
    isError: true,
    result: "The user doesn't want to proceed with this tool use. The tool use was rejected.",
  }))
  await $.skill.prompt({ skill: 'mattpocock-skills:code-review', text: 'x' })
  await $.tool.call({ tool: 'Agent', description: 'Revue Spec du diff', prompt: 'p', run_in_background: false } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Button', text: /Revue Spec du diff$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'annulé' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'échoué' })).toBeUndefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})
