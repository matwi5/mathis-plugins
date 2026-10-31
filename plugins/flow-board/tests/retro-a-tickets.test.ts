import { expect, mock, test } from 'claude-code/testing'

import { branchCleanup, groupWorktree, itemsWorktree } from '../hooks/closing.ts'
import {
  activeRun,
  applyCommand,
  applyReport,
  applySkill,
  currentPhase,
  detachOnLoad,
  emptyBoard,
  groupPlan,
  isPhaseOptional,
  newRun,
  nextLaunchFor,
  reportFacts,
  runProgress,
  startLinkedGroups,
  suggestionsFor,
  validateReport,
} from '../hooks/model.ts'
import type { Board, Run } from '../types'

// Les pistes choisies d'une rétro deviennent des tickets groupés, et le parcours de la rétro
// enchaîne sur une phase Implémentation, comme le Triage.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const phases = (run: Run) => run.phases.map(p => `${p.skill}${p.isOptional ? '?' : ''}:${p.status}`)

/** Un tableau de bord dont le parcours actif est un lot, puis la rétro lancée par /retro. */
const retroBoard = (): Board => {
  const lot = { ...newRun('implement', 1_000, 'Fermeture auto'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [lot], activeId: lot.id }
  return applySkill(board, 'mattpocock-skills:retro', { now: 2_000, isMain: true })!.board
}

test('/retro crée un parcours Rétro, Implémentation, Compte rendu, Version, PR, et /implement le suit', () => {
  const board = retroBoard()
  const retro = activeRun(board)!
  expect(retro.title).toBe('Rétrospective · Fermeture auto')
  expect(phases(retro)).toEqual(['retro:active', 'implement?:pending', 'compte-rendu?:pending', 'project:version?:pending', 'project:pr?:pending'])
  const next = applySkill(board, 'mattpocock-skills:implement', { now: 3_000, isMain: true })!.board
  const run = activeRun(next)!
  expect(run.id).toBe(retro.id)
  expect(currentPhase(run).skill).toBe('implement')
  // Du code s'écrit : le compte rendu n'est plus facultatif.
  expect(phases(run)).toEqual(['retro:done', 'implement?:active', 'compte-rendu:pending', 'project:version?:pending', 'project:pr?:pending'])
  expect(next.runs.filter(r => r.entry === 'implement' && r.id !== run.id && r.title !== 'Fermeture auto')).toEqual([])
})

const ITEMS = [
  { id: 'r1', label: 'Hooks : revue des pistes', status: 'done' },
  { id: 'r2', label: 'Contrôles : délai', status: 'done' },
  { id: 'r3', label: 'Docs : README', status: 'todo' },
]
const TICKETS = [
  { id: '06', name: 'Revue des pistes', sensitive: false, logic: true, files: ['hooks/register.tsx'] },
  { id: '07', name: 'Délai des contrôles', sensitive: false, logic: true, files: ['scripts/check.py'] },
]

test('un seul appel porte pistes jugées, tickets, groupes et complete : la Rétro finit, la carte propose les groupes', () => {
  const out = applyReport(
    retroBoard(),
    { items: ITEMS, tickets: TICKETS, groups: [{ id: 'A', name: 'Hooks', tickets: ['06'] }, { id: 'B', name: 'Contrôles', tickets: ['07'] }], complete: true },
    3_000,
  )
  const run = activeRun(out.board)!
  expect(run.status).toBe('active')
  expect(run.phases[0]!.items.map(i => `${i.id}:${i.status}`)).toEqual(['r1:done', 'r2:done', 'r3:todo'])
  expect(run.tickets.map(t => t.id)).toEqual(['06', '07'])
  expect((run.groups ?? []).map(g => g.id)).toEqual(['A', 'B'])
  // La Rétro est faite, le curseur reste sur elle, comme après /to-tickets ; son lot rend l'Implémentation due.
  expect(phases(run)).toEqual(['retro:done', 'implement:pending', 'compte-rendu?:pending', 'project:version?:pending', 'project:pr?:pending'])
  expect(currentPhase(run).skill).toBe('retro')
  expect(nextLaunchFor(run)).toEqual({ kind: 'parallel', groups: ['A', 'B'] })
  // La discussion finie (ou abandonnée) avant le premier groupe : le parcours passe en pause, jamais « terminé ».
  const later = detachOnLoad(out.board, 3_000 + 31 * 60_000, 'autre')
  expect(later.runs.find(r => r.id === run.id)!.status).toBe('paused')
})

test('un plan d’un seul groupe est gardé dans un parcours de rétro, et son groupe est lançable', () => {
  const out = applyReport(retroBoard(), { items: ITEMS, tickets: TICKETS, groups: [{ id: 'A', name: 'Pistes', tickets: ['06', '07'] }], complete: true }, 3_000)
  const run = activeRun(out.board)!
  expect((run.groups ?? []).map(g => `${g.id}:${g.tickets.join(',')}`)).toEqual(['A:06,07'])
  expect(out.text).not.toContain('one group only')
  expect(groupPlan(run)!.groups.filter(g => g.isFallback)).toEqual([])
  expect(nextLaunchFor(run)).toEqual({ kind: 'group', group: 'A', isDelegable: true })
})

test('un appel au plan refusé n’enregistre rien de ce qu’il porte, et la réponse dit pourquoi', () => {
  const presented = applyReport(retroBoard(), { items: ITEMS.map(i => ({ ...i, status: 'todo' })) }, 2_500).board
  const before = activeRun(presented)!
  const cases: [string, unknown[], string][] = [
    ['id hors forme', [{ id: 'A-1', name: 'Hooks', tickets: ['06'] }, { id: 'B', name: 'Contrôles', tickets: ['07'] }], 'group ids out of form ("A-1")'],
    ['tickets inconnus', [{ id: 'A', name: 'Hooks', tickets: ['16'] }], 'unknown ticket ids'],
    ['plan vide', [], 'an empty plan'],
  ]
  for (const [, groups, why] of cases) {
    const out = applyReport(presented, { items: ITEMS, tickets: TICKETS, groups, step: 'present', complete: true }, 3_000)
    const run = activeRun(out.board)!
    expect(run).toEqual(before)
    expect(out.text).toContain('nothing of this call was recorded')
    expect(out.text).toContain(why)
    expect(out.fx.toasts).toEqual([])
  }
})

test('une issue publiée sur un autre dépôt pendant la Rétro reste une trouvaille, pas un ticket du lot', () => {
  const published = applyCommand(retroBoard(), 'gh issue create --repo o/autre --title "Piste pour le plugin"', true, 'https://github.com/o/autre/issues/7\n', 2_500)!.board
  const run = activeRun(published)!
  expect(run.tickets).toEqual([])
  expect(run.found?.map(f => f.id)).toEqual(['#7'])
  // La Rétro finie sans ticket termine donc toujours le parcours.
  const ended = applyReport(published, { items: ITEMS.map(i => ({ ...i, status: 'dropped' })), complete: true }, 3_000).board
  expect(ended.runs.find(r => r.entry === 'retro')!.status).toBe('done')
})

test('une Rétro terminée sans ticket termine le parcours, malgré les phases facultatives qui suivent', () => {
  const out = applyReport(retroBoard(), { items: ITEMS.map(i => ({ ...i, status: 'dropped' })), complete: true }, 3_000)
  const run = out.board.runs.find(r => r.entry === 'retro')!
  expect(run.status).toBe('done')
  expect(run.finishedAt).toBe(3_000)
  expect(run.log[0]!.text).toBe('Parcours terminé')
  expect(out.fx.toasts).toContain('★ Parcours terminé : Rétrospective · Fermeture auto')
})

/** Un parcours ouvert par `skill`, seul au tableau de bord. */
const boardOf = (skill: string): Board => applySkill({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [], activeId: null }, skill, { now: 1_000, isMain: true })!.board

// Le Triage et « Santé du code » ont aussi une Implémentation facultative : un lot pas lancé la rend due.
test('un Triage terminé avec des tickets pas lancés passe en pause à la fin de la discussion, son Implémentation due', () => {
  const out = applyReport(boardOf('mattpocock-skills:triage'), { tickets: TICKETS, complete: true }, 2_000)
  const run = activeRun(out.board)!
  expect(phases(run)).toEqual(['triage:done', 'implement:pending', 'compte-rendu?:pending', 'project:version?:pending', 'project:pr?:pending'])
  const later = detachOnLoad(out.board, 2_000 + 31 * 60_000, 'autre')
  expect(later.runs.find(r => r.id === run.id)!.status).toBe('paused')
})

test('un lot envoyé après la fin du Triage le met aussi en pause à la fin de la discussion', () => {
  const finished = applyReport(boardOf('mattpocock-skills:triage'), { complete: true }, 2_000).board
  const out = applyReport(finished, { tickets: TICKETS }, 2_500)
  const later = detachOnLoad(out.board, 2_500 + 31 * 60_000, 'autre')
  expect(later.runs[0]!.status).toBe('paused')
})

test('un lot arrivé après la fin du Triage rend l’Implémentation due partout : avancement, « Clore le parcours »', () => {
  const finished = applyReport(boardOf('mattpocock-skills:triage'), { complete: true }, 2_000).board
  const before = activeRun(finished)!
  expect(suggestionsFor(before).canFinish).toBe(true)
  const run = activeRun(applyReport(finished, { tickets: TICKETS }, 2_500).board)!
  expect(isPhaseOptional(run, run.phases.find(p => p.skill === 'implement')!)).toBe(false)
  expect(suggestionsFor(run).canFinish).toBe(false)
  expect(runProgress(run)).toBeLessThan(1)
})

test('un parcours « Santé du code » dont /to-tickets laisse un lot pas lancé passe en pause, son Implémentation due', () => {
  const board = applySkill(boardOf('mattpocock-skills:improve-codebase-architecture'), 'mattpocock-skills:to-tickets', { now: 1_500, isMain: true })!.board
  const out = applyReport(board, { tickets: TICKETS, complete: true }, 2_000)
  const run = activeRun(out.board)!
  expect(run.phases.find(p => p.skill === 'implement')!.isOptional).toBe(false)
  const later = detachOnLoad(out.board, 2_000 + 31 * 60_000, 'autre')
  expect(later.runs.find(r => r.id === run.id)!.status).toBe('paused')
})

test('un Triage sans ticket, ou dont tous les tickets sont faits, se termine comme avant', () => {
  for (const tickets of [[], TICKETS.map(t => ({ ...t, status: 'done' }))]) {
    const out = applyReport(boardOf('mattpocock-skills:triage'), { tickets, complete: true }, 2_000)
    const run = out.board.runs[0]!
    expect(run.phases.find(p => p.skill === 'implement')!.isOptional).toBe(true)
    expect(detachOnLoad(out.board, 2_000 + 31 * 60_000, 'autre').runs[0]!.status).toBe('done')
  }
})

test('les worktrees des groupes d’une rétro se nomment sur le sujet étudié, distincts de ceux du parcours étudié et d’une autre rétro', () => {
  const board = retroBoard()
  const studied = board.runs.find(r => r.entry === 'implement')!
  const retro = activeRun(board)!
  expect(groupWorktree(studied, 'A')).toBe('groupe-fermeture-auto-A')
  expect(groupWorktree(retro, 'A')).toBe('groupe-retro-fermeture-auto-A')
  expect(groupWorktree(retro, 'A', 2)).toBe('groupe-retro-fermeture-auto-A-2')
  const other = { ...retro, title: 'Rétrospective · Pistes de rétro en groupes' }
  expect(groupWorktree(other, 'A')).toBe('groupe-retro-pistes-de-A')
  // Renommée sans le mot « Rétrospective », la rétro garde son préfixe.
  expect(groupWorktree({ ...retro, title: 'Bilan du lot' }, 'B')).toBe('groupe-retro-bilan-du-lot-B')
  // Les worktrees des pistes de l'ancien lien unique ne changent pas.
  expect(itemsWorktree(retro, 'Pistes', 1)).toBe('pistes-retrospective-1')
})

test('le lancement d’un groupe passe la rétro à l’Implémentation, puis compte rendu, branches supprimées et version', () => {
  let board = applyReport(
    retroBoard(),
    { items: ITEMS, tickets: TICKETS, groups: [{ id: 'A', name: 'Hooks', tickets: ['06'] }, { id: 'B', name: 'Contrôles', tickets: ['07'] }], complete: true },
    3_000,
  ).board
  board = startLinkedGroups(board, ['A', 'B'], 4_000)!.board
  expect(phases(activeRun(board)!)).toEqual(['retro:done', 'implement:active', 'compte-rendu:pending', 'project:version?:pending', 'project:pr?:pending'])
  board = applyReport(board, { set: [{ id: '06', status: 'done' }, { id: '07', status: 'done' }], returned: ['A', 'B'], reviewed: ['A', 'B'] }, 5_000).board
  for (const id of ['A', 'B']) board = applyReport(board, { security: { group: id, advised: false, why: 'aucune entrée externe' } }, 5_100).board
  const closing = applyReport(board, {}, 5_200)
  expect(closing.text).toContain('Close now: group A (Hooks) is closed')
  board = applyReport(
    board,
    { closed: ['A', 'B'].map(id => ({ group: id, state: 'closed', branch: `worktree-${groupWorktree(activeRun(board)!, id)}` })), complete: true },
    5_300,
  ).board
  expect(suggestionsFor(activeRun(board)!).primary).toBe('compte-rendu')
  board = applySkill(board, 'flow-board:compte-rendu', { now: 6_000, isMain: true })!.board
  const run = activeRun(board)!
  expect(currentPhase(run).skill).toBe('compte-rendu')
  expect(reportFacts(run).join('\n')).toContain('Groups, each usually run in its own discussion: A (Hooks): 1/1 done, reviewed by /code-review')
  const cleanup = branchCleanup({ run, isRepo: true, root: '/w/p' })!
  expect(cleanup.branches).toEqual(['worktree-groupe-retro-fermeture-auto-A', 'worktree-groupe-retro-fermeture-auto-B'])
  board = validateReport(board, 7_000)!.board
  expect(suggestionsFor(activeRun(board)!).primary).toBe('project:version')
})

test('le panneau : après l’appel du découpage, la carte « Ensuite » lance le groupe seul en session liée', async ($, on) => {
  mock.clock(on, { now: 90_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  // Des tickets sans groupes, pendant la Rétro : pas de « Tout implémenter ici », les groupes viennent.
  await $.tool.call({ tool: TOOL, title: 'Rétro', tickets: TICKETS } as any)
  const cutting = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await cutting.find({ key: 'launch-all' })).toBeUndefined()
  await cutting.unmount()
  await $.tool.call({ tool: TOOL, items: ITEMS, groups: [{ id: 'A', name: 'Pistes', tickets: ['06', '07'] }], complete: true } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(String((await ui.find({ key: 'next-linked-A' }))?.props.label)).toMatch(/Groupe A · session liée$/)
    await ui.unmount()
  }
})
