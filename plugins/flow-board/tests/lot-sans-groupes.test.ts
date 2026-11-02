import { expect, mock, test } from 'claude-code/testing'

import { applyReport, applySkill, emptyBoard, needsReview, newRun, reportFacts, suggestionsFor } from '../hooks/model.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board, Run } from '../types'

// Un lot sans groupes, fait dans la discussion de la mission, se relit comme un groupe : il est à relire
// quand tous ses tickets sont faits et qu'il n'a jamais été relu, ou qu'un ticket a fini après sa
// dernière revue ; il est dispensé de revue et de sécurité quand chacun de ses tickets est dit ni
// sensible ni avec logique. Rien ne s'enregistre pour cela : tout se calcule à la lecture.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

type Flags = { sensitive?: boolean; logic?: boolean }
const LIGHT: Flags = { sensitive: false, logic: false }
const CODE: Flags = { sensitive: false, logic: true }

/** Un lot sans groupes (tickets t1, t2… avec ces drapeaux), tous faits à 4 000. */
const doneLot = (flags: Flags[]): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const ids = flags.map((_, i) => `t${i + 1}`)
  const b = applyReport(board, { tickets: flags.map((f, i) => ({ id: ids[i]!, name: `Ticket ${i + 1}`, ...f })) }, 2_000).board
  return applyReport(b, { set: ids.map(id => ({ id, status: 'done' })) }, 4_000).board
}
const runOf = (b: Board): Run => activeRun(b)!
const review = (b: Board, now: number): Board => applySkill(b, 'code-review', { now, isMain: true })!.board

test('un lot dont chaque ticket est sans logique ni zone sensible est dispensé : ni revue due, ni sécurité, le compte rendu suit', () => {
  const run = runOf(doneLot([LIGHT, LIGHT]))
  expect(needsReview(run)).toBe(false)
  expect(suggestionsFor(run).primary).toBe('compte-rendu')
  expect(reportFacts(run).join('\n')).toContain('- Lot: reviewed by its ticket reviews (no logic, not sensitive), no lot review nor security review needed.')
})

test('un lot avec un ticket de logique, sensible ou muet est à relire ; relu, il attend sa sécurité tranchée avant le compte rendu', () => {
  const cases: Flags[] = [CODE, { sensitive: true, logic: false }, { logic: false }, { sensitive: false }, {}]
  for (const odd of cases) {
    const b = doneLot([LIGHT, odd])
    expect(needsReview(runOf(b))).toBe(true)
    expect(suggestionsFor(runOf(b)).primary).toBe('final-review')
    expect(reportFacts(runOf(b)).join('\n')).toContain('- Lot: lot review due (never reviewed).')
    const reviewed = review(b, 5_000)
    expect(needsReview(runOf(reviewed))).toBe(false)
    // Relu, pas encore d'avis de sécurité : ni revue ni compte rendu proposés.
    expect(suggestionsFor(runOf(reviewed)).primary).toBeNull()
    expect(suggestionsFor(runOf(reviewed)).others).not.toContain('compte-rendu')
    const judged = applyReport(reviewed, { security: { advised: false, why: 'rien de sensible' } }, 5_100).board
    expect(suggestionsFor(runOf(judged)).primary).toBe('compte-rendu')
    expect(reportFacts(runOf(judged)).join('\n')).toContain('- Lot: reviewed by /code-review, security review judged not needed (rien de sensible).')
  }
})

test('un lot vide n’est jamais dispensé ni relu', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  expect(needsReview(run)).toBe(false)
  expect(suggestionsFor(run).primary).toBe('compte-rendu')
  expect(reportFacts(run).join('\n')).not.toContain('- Lot:')
})

test('un ticket ajouté puis fini après la revue rend le lot de nouveau à relire ; avant sa fin, non', () => {
  const reviewed = applyReport(review(doneLot([CODE]), 5_000), { security: { advised: false } }, 5_100).board
  const added = applyReport(reviewed, { tickets: [{ id: 't9', name: 'Ajouté', ...CODE }] }, 6_000).board
  expect(needsReview(runOf(added))).toBe(false)
  const doing = applyReport(added, { set: [{ id: 't9', status: 'doing' }] }, 6_500).board
  expect(needsReview(runOf(doing))).toBe(false)
  const done = applyReport(doing, { set: [{ id: 't9', status: 'done' }] }, 7_000).board
  expect(needsReview(runOf(done))).toBe(true)
  expect(suggestionsFor(runOf(done)).primary).toBe('final-review')
  expect(reportFacts(runOf(done)).join('\n')).toContain('lot review due (a ticket finished after its last review)')
  // Relu de nouveau : plus due.
  expect(needsReview(runOf(review(done, 8_000)))).toBe(false)
})

test('un envoi de sécurité explicite l’emporte sur la dispense du lot', () => {
  const advised = applyReport(doneLot([LIGHT]), { security: { advised: true, why: 'un chemin lu ailleurs' } }, 5_000).board
  expect(needsReview(runOf(advised))).toBe(false)
  expect(suggestionsFor(runOf(advised)).primary).toBeNull()
  const fixed = applyReport(advised, { security: { findings: 1, fixed: 1 } }, 5_100).board
  expect(suggestionsFor(runOf(fixed)).primary).toBe('compte-rendu')
})

const world = (on: any): string[] => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

test('le panneau : un lot dispensé se dit relu par les revues de ses tickets, sans bouton de revue ni de sécurité, le compte rendu en tête', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 95_000_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Règles', tickets: [{ id: 'd1', name: 'Règle 1', ...LIGHT }, { id: 'd2', name: 'Règle 2', ...LIGHT }] } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'd1', status: 'done' }, { id: 'd2', status: 'done' }] } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^✓.relu par les revues de ses tickets$/ })).toBeDefined()
    expect(await ui.find({ key: 'go-final-review' })).toBeUndefined()
    expect(await ui.find({ key: 'security-group-lot' })).toBeUndefined()
    expect(await ui.find({ key: 'go-compte-rendu' })).toBeDefined()
    await ui.unmount()
  }
})

test('chemin normal : tous les tickets faits, Claude charge /code-review ; la revue n’est plus due, et le compte rendu suit une fois la sécurité du lot tranchée', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 95_000_000 })
  mock.store(on)
  const filled = world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Code', tickets: [{ id: 'c1', name: 'Un', ...CODE }, { id: 'c2', name: 'Deux', ...CODE }] } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'c1', status: 'done' }, { id: 'c2', status: 'done' }] } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-final-review' })).toBeDefined()
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeUndefined()
  await ui.unmount()
  // Claude lance lui-même la revue du lot, par l'outil Skill.
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  // Relu sans avis : la ligne de sécurité du lot porte la suite, son bouton demande la revue de sécurité.
  for (const surface of ['terminal', 'desktop'] as const) {
    const shown = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await shown.find({ type: 'Text', text: /^avis de sécurité attendu : le compte rendu attend que Claude le donne$/ })).toBeDefined()
    expect(await shown.find({ key: 'security-group-lot' })).toBeDefined()
    expect(await shown.find({ key: 'go-final-review' })).toBeUndefined()
    expect(await shown.find({ key: 'go-compte-rendu' })).toBeUndefined()
    if (surface === 'desktop') await shown.press({ key: 'security-group-lot' })
    await shown.unmount()
  }
  expect(filled.at(-1)).toMatch(/^Avant de la lancer, envoie à l'outil flow \{"security": \{"advised": true, "why": "<raison>"\}\} : l'avis de ce passage\. Lance la revue de sécurité de cette mission : confie-la à un spécialiste relecteur/)
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'un chemin lu ailleurs' } } as any)
  await $.tool.call({ tool: TOOL, security: { findings: 0, fixed: 0 } } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-final-review' })).toBeUndefined()
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeDefined()
  await ui.unmount()
})
