import { expect, mock, test } from 'claude-code/testing'

import { flowCallLabel } from '../hooks/model.ts'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const SURFACES = ['terminal', 'desktop'] as const

// Ce que le moteur dessinerait sous les plugins : sa propre ligne et son propre résultat.
const engine = (on: any) => {
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('ui.render', { component: 'ToolResult' }, () => ({ type: 'engine', ref: 0 }) as const)
}

const useOf = (tool: string, input: unknown, flags: { isErrored?: boolean; isInterrupted?: boolean } = {}) =>
  ({
    component: 'ToolUse',
    requestId: 'toolu_1',
    props: { tool_use_id: 'toolu_1', tool, input, isRunning: false, isErrored: flags.isErrored ?? false, isInterrupted: flags.isInterrupted ?? false, output: 'ok' },
  }) as const

const resultOf = (tool: string, isErrored = false) =>
  ({ component: 'ToolResult', requestId: 'toolu_1', props: { tool_use_id: 'toolu_1', tool, output: 'Dashboard: …', isErrored } }) as const

test('la ligne compacte dit en mots courts ce que l’appel enregistre', () => {
  expect(flowCallLabel({ step: 'review' })).toBe('flow-board · étape review')
  expect(flowCallLabel({ set: [{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }] })).toBe('flow-board · 2 tickets faits')
  expect(flowCallLabel({ decided: [{ what: 'x' }] })).toBe('flow-board · 1 décision')
  expect(flowCallLabel({ set: [{ id: 'a', status: 'doing' }], note: 'n', complete: true })).toBe('flow-board · 1 ticket en cours · note · phase terminée')
  expect(flowCallLabel({ open: { title: 'Lot SC' }, tickets: [{ id: 'a', name: 'A' }] })).toBe('flow-board · parcours ouvert « Lot SC » · 1 ticket')
  expect(flowCallLabel({ title: 'Lot' })).toBe('flow-board · titre')
  expect(flowCallLabel({ reviewed: ['A', 'B'], returned: ['A'] })).toBe('flow-board · relu A, B · rendu A')
  // Une entrée vide ou mal formée ne casse rien.
  expect(flowCallLabel(undefined)).toBe('flow-board')
  expect(flowCallLabel({ set: 'x', groups: null })).toBe('flow-board')
})

test('l’appel de l’outil flow tient sur une ligne grisée, sans son résultat', { timeoutMs: 15000 }, async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    const use = await $.ui.mount({ plugin: PLUGIN, surface, ...useOf(TOOL, { step: 'review', set: [{ id: 'a', status: 'done' }] }) } as any)
    const drawn = (await use.drawn()) as any
    expect(drawn).toMatchObject({ type: 'Text', props: { dimColor: true } })
    expect(await use.find({ type: 'Text', text: 'flow-board · étape review · 1 ticket fait' })).toBeDefined()
    await use.unmount()
    const result = await $.ui.mount({ plugin: PLUGIN, surface, ...resultOf(TOOL) } as any)
    expect(await result.drawn()).toMatchObject({ type: 'Box' })
    expect(await result.find({ type: 'Text' })).toBeUndefined()
    await result.unmount()
  }
})

test('une erreur, une interruption ou un autre outil gardent le dessin du moteur', { timeoutMs: 15000 }, async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    for (const target of [
      useOf(TOOL, { step: 'review' }, { isErrored: true }),
      useOf(TOOL, { step: 'review' }, { isInterrupted: true }),
      useOf('Bash', { command: 'ls' }),
      resultOf(TOOL, true),
      resultOf('Bash'),
    ]) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...target } as any)
      expect(await ui.drawn()).toMatchObject({ type: 'engine' })
      await ui.unmount()
    }
  }
})
