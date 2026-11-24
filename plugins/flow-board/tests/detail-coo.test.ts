// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { EMPTY_UI, applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, openCoo, settle, start, world, writeBoard } from './monde-coordination.ts'

// Chez le COO, « ◆ Agents » de l'Historique ouvre le détail d'une mission dans l'onglet Agents : sa frise, sans
// sélecteur d'historique, avec en tête « ← Managers » et le titre de la mission. Le bouton et l'onglet Agents pressé
// ramènent à la liste des managers ; un état d'affichage gardé qui ne désigne pas une mission montre la liste.

const T0 = 960_000_000
const nb = (t: string | undefined): string => (t ?? '').replace(/\u00a0/g, ' ')

/** Une mission en cours à deux groupes (applyReport n'enregistre pas un plan d'un seul groupe). */
const missionOf = (title: string, at: number): Run => {
  const run = newRun('implement', at - 10_000, title)
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = {
    tickets: [1, 2].map(n => ({ id: String(n), name: `T${n}`, files: [`f${n}.ts`] })),
    groups: [
      { id: 'A', name: 'A', tickets: ['1'] },
      { id: 'B', name: 'B', tickets: ['2'] },
    ],
  }
  const planned = applyReport(base, report as any, at - 9_000).board.runs[0] as Run
  return { ...planned, status: 'active', owner: `owner-${title}`, updatedAt: at }
}

const textsOf = async (ui: any): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map((t: any) => nb(String(t.text ?? '')))
const labelOf = async (ui: any, key: string): Promise<string> => nb(String((await ui.find({ key }))?.props.label ?? ''))

/**
 * La discussion du COO, avec une mission en cours ; `kept` : l'état d'affichage que la discussion gardait d'avant (sa
 * première lecture le rend, à la version 1 ; sa première écriture repart de là).
 */
const cooWorld = async ($: any, on: any, kept?: Record<string, unknown>) => {
  const clock = mock.clock(on, { now: T0 })
  if (kept) {
    let isWritten = false
    on('state.get', (_$: unknown, e: any, next: any) => (e.key === 'ui' && !isWritten ? { value: { value: { ...EMPTY_UI, ...kept }, version: 1 } } : next(e)))
    on('state.set', (_$: unknown, e: any, next: any) => {
      if (e.key !== 'ui' || isWritten) return next(e)
      isWritten = true
      return next({ ...e, ifVersion: undefined })
    })
  }
  const w = world(on)
  const run = missionOf('Active', T0 - 1000)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  w.ids.now = 'session-C'
  await start($)
  await openCoo($, clock)
  return { clock, run }
}

/** Ce qui montre la liste des managers, et jamais le détail ni la frise du COO. */
const expectList = async (ui: any, what: string) => {
  const texts = await textsOf(ui)
  expect(texts, what).toContain('Active')
  expect(texts.some(t => /^◆ M\d+$/.test(t)), what).toBe(true)
  expect(await ui.find({ key: 'agents-body' }), what).toBeUndefined()
  expect(await ui.find({ key: 'coo-managers' }), what).toBeUndefined()
  expect(texts.some(t => /Ici, maintenant|◆ Manager|cette discussion/.test(t)), what).toBe(false)
}

/** Ouvre le détail de la mission depuis l'onglet Historique. */
const openDetail = async (ui: any, clock: any, run: Run) => {
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: `agents-of-${run.id}` })
  await clock.advance(300)
}

test('chez le COO, « ◆ Agents » de l’Historique ouvre le détail d’une mission : sa frise, sans sélecteur, avec « ← Managers » et son titre ; le bouton ramène à la liste', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, run } = await cooWorld($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await openDetail(ui, clock, run)
    expect(await labelOf(ui, 'tab-agents'), surface).toMatch(/^▸ Agents/)
    expect(await labelOf(ui, 'coo-managers'), surface).toBe('← Managers')
    const texts = await textsOf(ui)
    expect(texts, surface).toContain('◆ Active')
    // Ni sélecteur d'historique ni « Ici, maintenant » ; la frise de la mission, comme ailleurs.
    expect(await ui.find({ key: 'agents-history' }), surface).toBeUndefined()
    expect(texts.some(t => /Ici, maintenant|Discussions sans mission/.test(t)), surface).toBe(false)
    expect(await ui.find({ key: 'agents-head' }), surface).toBeDefined()
    expect(await ui.find({ key: 'agents-body' }), surface).toBeDefined()
    expect(texts, surface).toContain('mission · Active')
    // « ← Managers » : la liste.
    await ui.press({ key: 'coo-managers' })
    await settle(clock, 1)
    await expectList(ui, `${surface} après ← Managers`)
    await ui.unmount()
  }
})

test('chez le COO, presser l’onglet Agents depuis le détail d’une mission ramène à la liste des managers', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, run } = await cooWorld($, on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await openDetail(ui, clock, run)
  expect(await ui.find({ key: 'coo-managers' })).toBeDefined()
  await ui.press({ key: 'tab-agents' })
  await settle(clock, 1)
  await expectList(ui, 'onglet pressé')
  // Depuis un autre onglet aussi.
  await openDetail(ui, clock, run)
  await ui.press({ key: 'tab-coord' })
  await ui.press({ key: 'tab-agents' })
  await settle(clock, 1)
  await expectList(ui, 'onglet rouvert')
  await ui.unmount()
})

for (const [what, key] of [
  ['« Ici, maintenant »', 'now'],
  ['une discussion sans mission', 'session:vieille-1'],
] as const) {
  test(`chez le COO, un état d’affichage gardé qui désigne ${what} montre la liste des managers`, { timeoutMs: 20000 }, async ($, on) => {
    const { clock } = await cooWorld($, on, { tab: 'agents', agentsHistory: key })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
    await settle(clock, 1)
    expect(await labelOf(ui, 'tab-agents')).toMatch(/^▸ Agents/)
    await expectList(ui, what)
    expect(await ui.find({ key: 'agents-history' })).toBeUndefined()
    await ui.unmount()
  })
}
