import { expect, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { applyReport, applySkill, autoDecision, autoStateOf, emptyBoard, stopActiveAuto, suggestionsFor, switchOnAuto } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// Après un diagnostic en mode auto, rien n'était parti : la suite était la « Revue » facultative, que l'auto ne lance
// pas, et aucune pause ne le disait. Quand la suite est une phase que l'auto ne lance pas, il se met en pause « plus
// rien ne peut avancer sans toi » en la nommant ; et la réponse à `complete` nomme la suite et rappelle de ne pas
// proposer la version avant le rapport validé.

const T0 = 1_000

const boardOf = (skill: string): Board => applySkill({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [], activeId: null }, skill, { now: T0, isMain: true })!.board

const done = (skill: string, input: Record<string, unknown> = {}): Board =>
  applyReport(applyReport(boardOf(skill), { title: 'Mission de test' }, T0 + 500).board, { ...input, complete: true }, T0 + 1_000).board

const withAuto = (board: Board): Board => switchOnAuto(board, 's', T0 + 2_000)!.board

test('/tdd fini en auto : la pause « plus rien ne peut avancer sans toi » nomme la revue, même sans question ouverte', () => {
  const board = withAuto(done('mattpocock-skills:tdd'))
  const run = activeRun(board)!
  expect(suggestionsFor(run).primary).toBe('code-review')
  const d = autoDecision(run, {}, false)
  expect(d.kind).toBe('stop')
  const why = d.kind === 'stop' ? d.why : ''
  expect(why).toContain('plus rien ne peut avancer sans toi')
  expect(why).toContain('/mattpocock-skills:code-review')
  // La raison se relit telle quelle : le bandeau dit la pause et sa suite.
  const paused = stopActiveAuto(board, why, T0 + 3_000)!.board
  const view = autoStateOf(activeRun(paused)!, paused, 's')
  expect(view.kind).toBe('paused')
  expect(view.kind === 'paused' ? view.why : '').toContain('/mattpocock-skills:code-review')
})

test('chasse au bug enregistrée avant, avec sa « Revue » facultative après le diagnostic : la même pause', () => {
  const tdd = activeRun(boardOf('mattpocock-skills:tdd'))!
  const board = boardOf('mattpocock-skills:diagnosing-bugs')
  const run = activeRun(board)!
  // L'ancien parcours de la chasse au bug : Diagnostic → Revue¹ → Compte rendu → …
  const review = structuredClone(tdd.phases.find(p => p.skill === 'code-review')!)
  const old: Run = { ...run, title: 'Bug ancien', isTitled: true, phases: [run.phases[0]!, review, ...run.phases.filter(p => p.skill !== 'diagnosing-bugs' && p.skill !== 'implement')] }
  old.phases[0]!.status = 'done'
  const d = autoDecision(old, {}, false)
  expect(d.kind === 'stop' ? d.why : '').toContain('/mattpocock-skills:code-review')
})

test('chasse au bug neuve : son Implémentation part comme aujourd’hui', () => {
  const board = withAuto(done('mattpocock-skills:diagnosing-bugs', { tickets: [{ id: 'F1', name: 'Correctif' }] }))
  const d = autoDecision(activeRun(board)!, {}, false)
  expect(d.kind === 'send' && d.action.kind === 'command' ? d.action.skill : null).toBe('implement')
})

test('chasse au bug finie en auto sans correctif : l’auto envoie le compte rendu dû, comme il y arrivait avant par un lot vide', () => {
  const board = withAuto(done('mattpocock-skills:diagnosing-bugs'))
  const d = autoDecision(activeRun(board)!, {}, false)
  expect(d.kind === 'send' && d.action.kind === 'command' ? d.action.skill : null).toBe('compte-rendu')
})

test('une Implémentation due sans aucun ticket (départ /to-tickets, tickets dans le tracker) : la pause la nomme, au lieu de se taire', () => {
  const board = withAuto(done('mattpocock-skills:to-tickets'))
  const d = autoDecision(activeRun(board)!, {}, false)
  expect(d.kind === 'stop' ? d.why : '').toBe('plus rien ne peut avancer sans toi · suite : /mattpocock-skills:implement')
})
test('une suite de livraison garde le comportement d’aujourd’hui : pas de pause', () => {
  // Une mission dont le compte rendu est validé : la suite est la livraison, que l'auto ne lance jamais.
  const board = done('mattpocock-skills:implement')
  const run = activeRun(board)!
  for (const p of run.phases) if (p.skill === 'compte-rendu') p.status = 'done'
  run.cursor = run.phases.findIndex(p => p.skill === 'compte-rendu')
  const d = autoDecision(run, {}, false)
  expect(d.kind).toBe('none')
})

test('hors auto, la revue reste proposée sur la carte « Ensuite »', () => {
  expect(suggestionsFor(activeRun(done('mattpocock-skills:tdd'))!).primary).toBe('code-review')
})

test('la réponse à complete nomme la suite et, avant le rapport validé, dit de ne proposer ni la version ni le push', () => {
  const board = applyReport(boardOf('mattpocock-skills:tdd'), { title: 'Mission de test' }, T0 + 500).board
  const out = applyReport(board, { complete: true }, T0 + 1_000)
  expect(out.text).toContain('next: /mattpocock-skills:code-review')
  expect(out.text).toContain('do not propose /project:version nor /project:push')
  // En auto, une suite que l'auto lance : la réponse dit qu'il l'envoie.
  const auto = withAuto(applyReport(boardOf('mattpocock-skills:to-spec'), { title: 'Spec' }, T0 + 500).board)
  const sent = applyReport(auto, { complete: true }, T0 + 3_000)
  expect(sent.text).toContain('next: /mattpocock-skills:to-tickets (the auto sends it)')
  // Un diagnostic fini en auto sans ticket : l'auto retient l'Implémentation, la réponse ne promet pas son envoi.
  const bug = withAuto(applyReport(boardOf('mattpocock-skills:diagnosing-bugs'), { title: 'Bug' }, T0 + 500).board)
  const held = applyReport(bug, { complete: true }, T0 + 3_000)
  expect(held.text).toContain('next: no /mattpocock-skills:implement (the lot has no ticket): /flow-board:compte-rendu, which the auto sends')
})
