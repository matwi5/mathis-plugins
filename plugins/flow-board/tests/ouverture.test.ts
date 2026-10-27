import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyReport, applySkill, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const boardOf = (runs: Run[], activeId: string | null): Board => ({ ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs, activeId })

/** Un cas vécu : un parcours actif ici (phase finie), et trois tickets indépendants à suivre à part. */
const withActive = (): Board => {
  const run = { ...newRun('grill-me', 1_000, 'Questionnaire du lancement'), owner: 's' }
  const board = boardOf([run], run.id)
  return applyReport(board, { tickets: [{ id: 'Q1', name: 'Question ouverte' }] }, 1_500).board
}

const THREE = [
  { id: '1201', name: 'Requête BigQuery des ventes' },
  { id: '1202', name: 'Requête BigQuery des stocks' },
  { id: '1203', name: 'Modification PowerBI' },
]

test('open : un nouveau parcours reçoit les tickets et les groupes, l’ancien reste en pause tel quel', () => {
  const board = withActive()
  const before = board.runs[0]!
  const out = applyReport(
    board,
    {
      open: { title: 'Requêtes et PowerBI' },
      tickets: THREE,
      groups: [
        { id: 'A', name: 'BigQuery', tickets: ['1201', '1202'] },
        { id: 'B', name: 'PowerBI', tickets: ['1203'] },
      ],
    },
    2_000,
  )
  const run = activeRun(out.board)!
  expect(run.id).not.toBe(before.id)
  expect(run.title).toBe('Requêtes et PowerBI')
  expect(run.isTitled).toBe(true)
  expect(run.entry).toBe('implement')
  expect(run.owner).toBe('s')
  expect(run.tickets.map(t => t.id)).toEqual(['1201', '1202', '1203'])
  expect((run.groups ?? []).map(g => g.id)).toEqual(['A', 'B'])
  // L'ancien n'a rien reçu : ni les tickets ni les groupes.
  const old = out.board.runs.find(r => r.id === before.id)!
  expect(old.status).toBe('paused')
  expect(old.owner).toBeUndefined()
  expect(old.tickets.map(t => t.id)).toEqual(['Q1'])
  expect(old.groups).toBeUndefined()
  expect(out.text).toMatch(/New workflow "Requêtes et PowerBI" \(Implémentation\) opened in this discussion/)
  expect(out.text).toMatch(/"Questionnaire du lancement" was paused/)
  expect(out.fx.openPane).toBe(true)
  expect(out.fx.toasts[0]).toBe('✚ Parcours ouvert : Requêtes et PowerBI')
})

test('open sans parcours actif, avec un parcours en pause : il s’ouvre quand même (demande de la personne)', () => {
  const paused = { ...newRun('implement', 1_000, 'Lot en pause'), status: 'paused' as const }
  const board = boardOf([paused], null)
  // Sans `open`, rien n'est enregistré et Claude apprend qu'il peut ouvrir à la demande de la personne.
  const refused = applyReport(board, { tickets: THREE }, 2_000)
  expect(refused.board).toBe(board)
  expect(refused.text).toMatch(/nothing was recorded/)
  expect(refused.text).toMatch(/Only if the user asks for a new workflow, send \{"open"/)
  const out = applyReport(board, { open: { title: 'Nouveau lot', entry: 'mattpocock-skills:to-tickets' }, tickets: THREE }, 2_100)
  const run = activeRun(out.board)!
  expect(run.entry).toBe('to-tickets')
  expect(run.tickets).toHaveLength(3)
  expect(out.board.runs.find(r => r.id === paused.id)!.status).toBe('paused')
})

test('open : un point de départ inconnu ou qui n’en est pas un retombe sur /implement, et le dit', () => {
  const board = boardOf([], null)
  for (const entry of ['inconnu', 'project:push', 'wait-what']) {
    const out = applyReport(board, { open: { title: 'Lot', entry } }, 2_000)
    expect(activeRun(out.board)!.entry).toBe('implement')
    expect(out.text).toMatch(/is not a starting skill: the workflow follows \/implement/)
  }
  // Sans titre : le nom du flux, et Claude est invité à le nommer par `fix`.
  const untitled = applyReport(board, { open: {} }, 2_000)
  expect(activeRun(untitled.board)!.isTitled).toBe(false)
  expect(untitled.text).toMatch(/fix/)
})

test('fix.title remplace un titre posé ; un simple title ne le fait pas', () => {
  const run = { ...newRun('implement', 1_000, 'Mauvais titre'), owner: 's' }
  const board = boardOf([run], run.id)
  expect(activeRun(applyReport(board, { title: 'Autre' }, 2_000).board)!.title).toBe('Mauvais titre')
  const out = applyReport(board, { fix: { title: 'Bon titre' } }, 2_000)
  expect(activeRun(out.board)!.title).toBe('Bon titre')
  expect(out.text).toMatch(/fixed: 1 change/)
  expect(activeRun(out.board)!.log[0]!.text).toBe('Corrigé : titre « Bon titre »')
})

test('fix.phase revient en arrière (phases d’après à faire) ou avance sans valider le compte rendu', () => {
  const run = { ...newRun('to-tickets', 1_000, 'Lot'), owner: 's' }
  let board = boardOf([run], run.id)
  // Le parcours est passé à l'Implémentation par erreur.
  board = applySkill(board, 'mattpocock-skills:implement', { now: 2_000, isMain: true })!.board
  expect(activeRun(board)!.cursor).toBe(1)
  const back = applyReport(board, { fix: { phase: 'to-tickets', step: 'publish' } }, 3_000)
  const r = activeRun(back.board)!
  expect(r.cursor).toBe(0)
  expect(r.phases[0]!.status).toBe('active')
  expect(r.phases[0]!.steps.find(s => s.id === 'publish')!.status).toBe('active')
  expect(r.phases[1]!.status).toBe('pending')
  expect(r.phases[1]!.round).toBe(0)
  expect(r.phases[1]!.steps.every(s => s.status === 'pending')).toBe(true)

  // En avant jusqu'à la livraison : le compte rendu passe « sauté », jamais « fait ».
  const report = r.phases.findIndex(p => p.skill === 'compte-rendu')
  const ahead = applyReport(back.board, { fix: { phase: 'project:version' } }, 4_000)
  const a = activeRun(ahead.board)!
  expect(a.phases[a.cursor]!.skill).toBe('project:version')
  expect(a.phases[report]!.status).toBe('skipped')
  expect(a.phases[0]!.status).toBe('done')

  // Une phase absente : rien ne bouge, et Claude reçoit la liste des phases.
  const wrong = applyReport(back.board, { fix: { phase: 'grill-with-docs' } }, 5_000)
  expect(activeRun(wrong.board)!.cursor).toBe(0)
  expect(wrong.text).toMatch(/not fixed: phase "grill-with-docs" is not in this workflow \(phases: to-tickets, implement/)
})

test('fix.step revient en arrière : les étapes d’après redeviennent à faire', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  let board = boardOf([run], run.id)
  board = applyReport(board, { step: 'review' }, 2_000).board
  const out = applyReport(board, { fix: { step: 'tdd' } }, 3_000)
  const steps = activeRun(out.board)!.phases[0]!.steps
  const at = steps.findIndex(s => s.id === 'tdd')
  expect(steps[at]!.status).toBe('active')
  expect(steps.slice(at + 1).every(s => s.status === 'pending')).toBe(true)
  expect(steps.slice(0, at).every(s => s.status === 'done')).toBe(true)
})

test('par l’outil : open pendant un parcours lancé par un skill, le panneau montre le nouveau', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 300_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-me', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Questionnaire du lancement' })
  const answer = await $.tool.call({ tool: TOOL, open: { title: 'Requêtes et PowerBI' }, tickets: THREE } as any)
  expect(String((answer as { result?: unknown }).result)).toMatch(/New workflow "Requêtes et PowerBI"/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^Requêtes et PowerBI$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Modification PowerBI/ })).toBeDefined()
    await ui.press({ key: 'tab-history' })
    expect(await ui.find({ type: 'Text', text: /^Questionnaire du lancement$/ })).toBeDefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})
