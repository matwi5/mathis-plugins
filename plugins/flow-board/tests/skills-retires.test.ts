import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, newRun, upgradeRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// /implement-spec et /wayfinder ont quitté la copie mattpocock-skills (1.3.1-mathis.1) : un
// parcours enregistré avant les cite encore, et le panneau ne connaît plus leurs étapes.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const

const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
}

/** Un lot lancé par /implement-spec avant son retrait : sa phase, ses étapes et son alternative d'alors. */
const oldSpecRun = (): Run => {
  const run = newRun('implement', 1_000, 'Lot parallèle')
  run.entry = 'implement-spec'
  run.tickets = [
    { id: 'a1', name: 'Fait', status: 'done' },
    { id: 'b1', name: 'En cours', status: 'doing' },
  ]
  run.phases[0] = {
    ...run.phases[0]!,
    skill: 'implement-spec',
    alts: ['implement'],
    steps: [
      { id: 'graph', status: 'done', at: 1_000 },
      { id: 'implementers', status: 'active', at: 1_500 },
      { id: 'merge', status: 'pending' },
    ],
  }
  return run
}

/** Un grand chantier ouvert par /wayfinder avant son retrait : sa carte est faite, ses décisions gardées. */
const oldMapRun = (): Run => {
  const run = newRun('grill-with-docs', 1_000, 'Grand chantier')
  run.entry = 'wayfinder'
  run.phases[0] = {
    ...run.phases[0]!,
    skill: 'wayfinder',
    status: 'done',
    finishedAt: 2_000,
    steps: [{ id: 'destination', status: 'done', at: 1_000 }, { id: 'map', status: 'done', at: 1_500 }],
    items: [{ id: '#4', label: 'Quel stockage ?', status: 'done' }],
  }
  run.phases[1] = { ...run.phases[1]!, status: 'active', startedAt: 2_000 }
  run.cursor = 1
  run.log = [{ at: 1_500, glyph: '⚑', text: 'Carte écrite', tone: 'ok' }]
  return run
}

test('une phase /implement-spec en cours devient /implement en cours, avec ses tickets et les étapes d’/implement', () => {
  const run = upgradeRun(oldSpecRun())
  expect(run.entry).toBe('implement')
  const phase = run.phases[0]!
  expect(phase.skill).toBe('implement')
  expect(phase.alts).toEqual([])
  expect(phase.status).toBe('active')
  expect(phase.steps.map(s => s.id)).toEqual(newRun('implement', 1).phases[0]!.steps.map(s => s.id))
  expect(phase.steps.map(s => s.status)).toEqual(phase.steps.map((_, i) => (i === 0 ? 'active' : 'pending')))
  expect(run.tickets.map(t => `${t.id}:${t.status}`)).toEqual(['a1:done', 'b1:doing'])
  expect(run.title).toBe('Lot parallèle')
})

test('une phase /wayfinder faite devient un cadrage fait, ses décisions et son journal gardés', () => {
  const run = upgradeRun(oldMapRun())
  expect(run.entry).toBe('grill-with-docs')
  const phase = run.phases[0]!
  expect(phase.skill).toBe('grill-with-docs')
  expect(phase.status).toBe('done')
  expect(phase.steps.length).toBeGreaterThan(0)
  expect(phase.steps.every(s => s.status === 'done')).toBe(true)
  expect(phase.items).toEqual([{ id: '#4', label: 'Quel stockage ?', status: 'done' }])
  expect(run.cursor).toBe(1)
  expect(run.phases.length).toBe(oldMapRun().phases.length)
  expect(run.log.map(e => e.text)).toEqual(['Carte écrite'])
})

test('l’ancienne alternative implement-spec disparaît ; un parcours sans skill retiré reste le même objet', () => {
  const run = newRun('implement', 1_000)
  run.phases[0] = { ...run.phases[0]!, alts: ['implement-spec'] }
  const upgraded = upgradeRun(run)
  expect(upgraded.phases[0]!.alts).toEqual([])
  expect(upgradeRun(upgraded)).toBe(upgraded)
})

test('un parcours enregistré par /implement-spec ou /wayfinder se reprend et se dessine', async ($, on) => {
  mock.clock(on, { now: 50_000_000 })
  const spec = { ...oldSpecRun(), status: 'paused' as const, owner: undefined }
  const map = { ...oldMapRun(), id: 'carte', status: 'paused' as const, owner: undefined }
  const stored: Board = { ...emptyBoard('', 'projet'), deleted: [], runs: [spec, map], activeId: null }
  mock.store(on, { 'board:': stored })
  engine(on)
  await $.tool.call({ tool: TOOL, resume: spec.id } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /En cours/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Implementers/ })).toBeUndefined()
    await ui.unmount()
  }
  await $.tool.call({ tool: TOOL, resume: map.id } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Grand chantier/ })).toBeDefined()
  await ui.unmount()
})
