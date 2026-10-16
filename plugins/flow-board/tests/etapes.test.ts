import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyCommand, applyReport, applySkill, currentPhase, emptyBoard } from '../hooks/model.ts'
import type { Board } from '../types'

/** Les étapes de la phase en cours, sous la forme `id:statut`. */
const steps = (board: Board) => currentPhase(activeRun(board)!).steps.map(s => `${s.id}:${s.status}`)

const step = (board: Board, id: string) => currentPhase(activeRun(board)!).steps.find(s => s.id === id)!.status

/** Applique une suite de transitions ; une transition sans effet garde le board. */
const play = (board: Board, ...changes: ((b: Board) => { board: Board } | null)[]): Board =>
  changes.reduce((b, change) => change(b)?.board ?? b, board)

const implementing = (): Board => {
  const base = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [] }
  return play(
    base,
    b => applySkill(b, 'mattpocock-skills:implement', { now: 1_000, isMain: true }),
    b => applyReport(b, { tickets: [{ id: 'T1', name: 'Un', status: 'doing' }, { id: 'T2', name: 'Deux' }] }, 1_100),
  )
}

test('python d’un environnement virtuel : tests ciblés pour la boucle TDD, suite complète pour les vérifications', () => {
  let b = play(implementing(), b => applyCommand(b, '.venv/Scripts/python -m pytest -q tests/test_a.py', false, '1 failed', 2_000))
  expect(step(b, 'tdd')).toBe('active')
  b = play(b, b => applyCommand(b, '.venv/Scripts/python -m pytest -q tests/test_a.py', true, '3 passed', 2_100))
  expect(step(b, 'tdd')).toBe('active')
  b = play(b, b => applyCommand(b, 'cd f1-worker && .venv/Scripts/python -m pytest -q 2>&1 | tail -3', true, '412 passed', 2_200))
  expect(step(b, 'checks')).toBe('active')
  expect(step(b, 'tdd')).toBe('done')
})

test('une variable posée dans la commande est suivie : PY=…; $PY -m pytest', () => {
  const b = play(implementing(), b => applyCommand(b, 'PY=.venv/Scripts/python; $PY -m pytest -q', true, '12 passed', 2_000))
  expect(step(b, 'checks')).toBe('active')
  expect(activeRun(b)!.tests).toHaveLength(1)
})

test('lint ou typecheck au vert : vérifications', () => {
  const b = play(implementing(), b => applyCommand(b, 'cd app && npm run typecheck', true, '', 2_000))
  expect(step(b, 'checks')).toBe('active')
})

test('un lot : la revue se fait à chaque ticket, avant son commit, et le ticket suivant repart de la lecture', () => {
  let b = play(
    implementing(),
    b => applyCommand(b, '.venv/Scripts/python -m pytest -q', true, '9 passed', 2_000),
    b => applyCommand(b, 'git add a.py && git commit -m "fix: un"', true, '', 2_100),
  )
  // Commit sans revue du ticket : elle est sautée, honnêtement.
  expect(steps(b)).toEqual(['read:done', 'tdd:done', 'checks:done', 'review:skipped', 'commit:active'])

  b = play(b, b => applyReport(b, { set: [{ id: 'T1', status: 'done' }, { id: 'T2', status: 'doing' }] }, 2_200))
  expect(steps(b)).toEqual(['read:active', 'tdd:pending', 'checks:pending', 'review:pending', 'commit:pending'])

  // Le ticket suivant passe par sa revue : /mattpocock-skills:code-review ouvre l'étape.
  b = play(
    b,
    b => applyReport(b, { step: 'review' }, 2_250),
    b => applyCommand(b, 'git commit -am "fix: deux"', true, '', 2_300),
  )
  expect(step(b, 'review')).toBe('done')
})

test('le premier ticket passé en cours ne remet pas à zéro des étapes encore vierges', () => {
  const base = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [] }
  const b = play(
    base,
    b => applySkill(b, 'mattpocock-skills:implement', { now: 1_000, isMain: true }),
    b => applyReport(b, { step: 'read', tickets: [{ id: 'T1', name: 'Un' }] }, 1_100),
    b => applyReport(b, { set: [{ id: 'T1', status: 'doing' }] }, 1_200),
  )
  expect(step(b, 'read')).toBe('active')
  expect(currentPhase(activeRun(b)!).steps.find(s => s.id === 'read')!.at).toBe(1_000)
})

test('pendant /implement, le ticket en cours se lit dans son groupe, avec sa place dans la file ; l’ordre des étapes et des revues est affiché', async ($, on) => {
  mock.clock(on, { now: 95_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
  const PANE = {
    component: 'Pane',
    requestId: 'flow-board',
    props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
  } as const
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({
    tool: 'mcp__flow-board__flow',
    tickets: [{ id: 'A1', name: 'Premier' }, { id: 'A2', name: 'Second', blockedBy: ['A1'] }],
    groups: [{ id: 'A', name: 'Worker', tickets: ['A1', 'A2'] }],
  } as any)
  let ui = await $.ui.mount({ plugin: 'flow-board', surface: 'desktop', ...PANE })
  await ui.press({ key: 'launch-group-A' })
  await ui.unmount()
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })
  await $.tool.call({ tool: 'mcp__flow-board__flow', set: [{ id: 'A1', status: 'doing' }] } as any)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    ui = await $.ui.mount({ plugin: 'flow-board', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^▸.Premier$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'ticket 1/2' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Premier' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '#1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^◉.en cours$/ })).toBeDefined()
    // Pas d'étape en cours (plusieurs tickets peuvent avancer en même temps), mais l'ordre fixe.
    expect(await ui.find({ type: 'Text', text: /^Boucle TDD$|^Contrôles$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Par ticket : Lire spec et ticket.›.Boucle TDD.›.Contrôles.›.Revue du ticket.›.Commit et suivi$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Par groupe, ses tickets faits : Revue du groupe.›.Revue de sécurité.›.Rendu du groupe$/ })).toBeDefined()
    await ui.unmount()
  }
})
