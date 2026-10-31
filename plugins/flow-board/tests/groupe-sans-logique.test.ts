import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyReport, applySkill, closingText, emptyBoard, isCloseCandidate, isGroupReviewed, needsReview, newRun, reportFacts, startLinkedGroups } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// Un groupe dont chaque ticket est dit ni sensible ni avec logique (règles, documents, ressources
// visuelles) n'a ni revue du groupe ni revue de sécurité : les revues de ses tickets sont ses seules
// revues. Invariant : un groupe dont un ticket a de la logique, une zone sensible, ou ne dit pas l'un
// des deux, n'est jamais réputé relu ni de sécurité tranchée sans sa revue du groupe et son avis de
// sécurité.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

type Flags = { sensitive?: boolean; logic?: boolean }
const LIGHT: Flags = { sensitive: false, logic: false }

/** Le groupe D (ses tickets d1, d2… avec ces drapeaux), rendu par sa session liée, ses tickets faits ; E garde le plan à deux groupes. */
const returned = (flags: Flags[]): Board => {
  const run = { ...newRun('implement', 1_000, 'Règles'), owner: 's' }
  const board: Board = { ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const ids = flags.map((_, i) => `d${i + 1}`)
  const tickets = [...flags.map((f, i) => ({ id: ids[i]!, name: `Règle ${i + 1}`, ...f })), { id: 'e1', name: 'Code', sensitive: false, logic: true }]
  let b = applyReport(board, { tickets, groups: [{ id: 'D', name: 'Règles', tickets: ids }, { id: 'E', name: 'Code', tickets: ['e1'] }] }, 2_000).board
  b = startLinkedGroups(b, ['D'], 3_000)!.board
  return applyReport(b, { set: ids.map(id => ({ id, status: 'done' })), returned: ['D'] }, 4_000).board
}
const runOf = (b: Board): Run => activeRun(b)!
const groupD = (b: Board) => runOf(b).groups!.find(g => g.id === 'D')!

test('un groupe de plusieurs tickets sans logique ni zone sensible est relu, sa sécurité tranchée, et clos sans aucun envoi', () => {
  const b = returned([LIGHT, LIGHT, LIGHT])
  const run = runOf(b)
  expect(isGroupReviewed(run, groupD(b))).toBe(true)
  expect(needsReview(run)).toBe(false)
  expect(isCloseCandidate(run, groupD(b))).toBe(true)
  const text = closingText(run, null, true)
  expect(text).toContain('Close now: group D (Règles) is closed')
  expect(text).not.toContain('group D (Règles) lacks')
  expect(reportFacts(run).join('\n')).toContain('D (Règles): 3/3 done, reviewed by its ticket reviews (no logic, not sensitive), no group review nor security review needed')
})

test('un seul ticket avec logique, en zone sensible, ou muet sur l’un des deux rend la revue du groupe et l’avis de sécurité dus', () => {
  const cases: Flags[] = [{ sensitive: true, logic: false }, { sensitive: false, logic: true }, { logic: false }, { sensitive: false }, {}]
  for (const odd of cases) {
    const b = returned([LIGHT, odd])
    const run = runOf(b)
    expect(isGroupReviewed(run, groupD(b))).toBe(false)
    expect(needsReview(run)).toBe(true)
    expect(isCloseCandidate(run, groupD(b))).toBe(false)
    expect(closingText(run, null, true)).toContain('group D (Règles) lacks: its group review')
    // Relu : il attend encore son avis de sécurité.
    const reviewed = applyReport(b, { reviewed: ['D'] }, 5_000).board
    expect(closingText(runOf(reviewed), null, true)).toContain('group D (Règles) lacks: the security advice')
  }
})

test('un groupe d’un seul ticket sans logique ni zone sensible garde sa revue par son ticket et n’attend plus l’avis de sécurité', () => {
  const b = returned([LIGHT])
  const run = runOf(b)
  expect(isGroupReviewed(run, groupD(b))).toBe(true)
  expect(closingText(run, null, true)).toContain('Close now: group D (Règles) is closed')
})

test('un envoi de sécurité explicite l’emporte : le groupe attend que cette sécurité soit tranchée', () => {
  const advised = applyReport(returned([LIGHT, LIGHT]), { security: { group: 'D', advised: true, why: 'un chemin lu ailleurs' } }, 5_000).board
  expect(isCloseCandidate(runOf(advised), groupD(advised))).toBe(false)
  expect(closingText(runOf(advised), null, true)).toContain('group D (Règles) lacks: the security review it was advised')
  const found = applyReport(advised, { security: { group: 'D', findings: 1, fixed: 0 } }, 5_100).board
  expect(closingText(runOf(found), null, true)).toContain('group D (Règles) lacks: a decision on 1 kept security finding(s)')
  const fixed = applyReport(found, { security: { group: 'D', findings: 1, fixed: 1 } }, 5_200).board
  expect(closingText(runOf(fixed), null, true)).toContain('Close now: group D (Règles) is closed')
})

test('un ticket avec logique que le plan rattache au groupe après coup le rend dû, comme le panneau le montre', () => {
  // x, ajouté pendant que D est chez sa session liée, attend d2 : le plan le montre dans D.
  const b = returned([LIGHT, LIGHT])
  const added = applyReport(b, { tickets: [{ id: 'x', name: 'Rattaché', sensitive: false, logic: true, blockedBy: ['d2'] }] }, 4_500).board
  const run = runOf(added)
  expect(groupD(added).tickets).toEqual(['d1', 'd2'])
  expect(isGroupReviewed(run, groupD(added))).toBe(false)
  expect(isCloseCandidate(run, groupD(added))).toBe(false)
  expect(closingText(run, null, true)).not.toContain('Close now: group D')
})

test('un /security-review tapé vise d’abord les groupes qui ont besoin d’un avis ; le groupe sans logique seul fini, lui, l’attend', () => {
  // D sans logique et E avec logique, finis : la revue tapée pour E ne réclame pas de comptes à D.
  const both = applyReport(returned([LIGHT, LIGHT]), { set: [{ id: 'e1', status: 'done' }] }, 4_500).board
  const secured = applySkill(both, 'security-review', { now: 5_000, isMain: true })!.board
  expect(groupD(secured).security).toBeUndefined()
  expect(runOf(secured).groups!.find(g => g.id === 'E')!.security?.ranAt).toBe(5_000)
  expect(closingText(runOf(secured), null, true)).toContain('Close now: group D (Règles) is closed')
  // D seul fini : la revue tapée le vise, et sa fermeture attend ses comptes, comme avant.
  const alone = applySkill(returned([LIGHT, LIGHT]), 'security-review', { now: 5_000, isMain: true })!.board
  expect(groupD(alone).security?.ranAt).toBe(5_000)
  expect(closingText(runOf(alone), null, true)).toContain('group D (Règles) lacks: the counts of its security review')
})

test('un groupe vidé de ses tickets, ou qui cite un ticket inconnu, n’est jamais réputé relu', () => {
  const b = returned([LIGHT, LIGHT])
  const run = runOf(b)
  const empty = { ...groupD(b), tickets: [] }
  expect(isGroupReviewed(run, empty)).toBe(false)
  const ghost = { ...groupD(b), tickets: ['d1', 'zz9'] }
  expect(isGroupReviewed(run, ghost)).toBe(false)
})

test('le panneau : le groupe fini se dit « revu par ses tickets », sans bouton de revue ni de sécurité', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 95_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    title: 'Règles',
    tickets: [
      { id: 'd1', name: 'Règle 1', ...LIGHT },
      { id: 'd2', name: 'Règle 2', ...LIGHT },
      { id: 'e1', name: 'Code', sensitive: false, logic: true },
    ],
    groups: [
      { id: 'D', name: 'Règles', tickets: ['d1', 'd2'] },
      { id: 'E', name: 'Code', tickets: ['e1'] },
    ],
  } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'd1', status: 'done' }, { id: 'd2', status: 'done' }] } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^✓.revu par ses tickets$/ })).toBeDefined()
    expect(await ui.find({ key: 'review-group-D' })).toBeUndefined()
    expect(await ui.find({ key: 'security-group-D' })).toBeUndefined()
    await ui.unmount()
  }
})
