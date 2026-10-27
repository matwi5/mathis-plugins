import { expect, test } from 'claude-code/testing'

import { familyOf } from '../hooks/cost.ts'
import { activeRun, applyRelay, applyReport, applySkill, currentPhase, decidedFileText, emptyBoard, newRun, reportFacts, startLinkedGroups, unseenDecisions } from '../hooks/model.ts'
import type { Board } from '../types'

// Suites de la rétro de l'onglet Agents (r18, r20) et de celle de « Durée des requêtes » (p3, p13).

const LOT = {
  tickets: [
    { id: 'a1', name: 'Premier' },
    { id: 'b1', name: 'Second' },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Données', tickets: ['b1'] },
  ],
}

const boardWith = (input: Record<string, unknown>, entry = 'implement'): Board => {
  const run = { ...newRun(entry, 1_000, 'Onglet Agents'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}

test('r18 : un relecteur et ses deux chercheurs, coût et tokens sommés ; un lien qui boucle ne compte qu’une fois', () => {
  const tok = (n: number) => ({ input: n, output: n * 2, cacheRead: n * 10, cacheWrite: n * 3 })
  const reviewer = { agentId: 'r', tokens: tok(100), price: 1 }
  const c1 = { agentId: 'c1', parent: 'r', tokens: tok(10), price: 0.5 }
  const c2 = { agentId: 'c2', parent: 'r', tokens: tok(20), price: null }
  const grand = { agentId: 'g', parent: 'c1', tokens: tok(1), price: 0.25 }
  const other = { agentId: 'o', tokens: tok(999), price: 9 }
  const all = [reviewer, c1, c2, grand, other]
  const sum = familyOf(reviewer, all, a => a.price)
  expect(sum.descendants).toBe(3)
  expect(sum.tokens).toEqual({ input: 131, output: 262, cacheRead: 1_310, cacheWrite: 393 })
  // Le coût ne somme que les coûts connus (c2 n'a pas de prix).
  expect(Math.abs(sum.cost! - 1.75)).toBeLessThan(1e-9)
  // Seul, sans descendant : lui-même.
  expect(familyOf(other, all, a => a.price)).toMatchObject({ descendants: 0, cost: 9 })
  // Aucun prix connu : coût indisponible, tokens quand même.
  expect(familyOf(reviewer, all, () => null)).toMatchObject({ descendants: 3, cost: null })
  // Un parent qui boucle (un fichier abîmé) ne fait pas tourner la somme.
  const loopA = { agentId: 'x', parent: 'y', tokens: tok(1) }
  const loopB = { agentId: 'y', parent: 'x', tokens: tok(1) }
  expect(familyOf(loopA, [loopA, loopB], () => 1)).toMatchObject({ descendants: 1, cost: 2 })
})

test('r20 : la rétro lancée pendant le parcours de cette discussion porte son titre et ne reprend pas un autre parcours en pause', () => {
  // Un autre parcours, en pause, qui a une phase Rétro : celui d'une autre discussion du projet.
  const other = { ...newRun('retro', 500, 'Durée des requêtes'), owner: 'autre', status: 'paused' as const }
  const here = { ...newRun('implement', 1_000, 'Onglet Agents flow-board'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [here, other], activeId: here.id }
  const out = applySkill(board, 'mattpocock-skills:retro', { now: 9_000, isMain: true, args: 'Rétro globale du parcours « Onglet Agents flow-board » : cette discussion et ses sessions filles' })!
  const run = activeRun(out.board)!
  expect(run.title).toBe('Rétrospective · Onglet Agents flow-board')
  expect(run.isTitled).toBe(true)
  expect(run.id).not.toBe(other.id)
  expect(out.board.runs.find(r => r.id === other.id)!.status).toBe('paused')
  // Sans parcours actif ici, une rétro reprend toujours le parcours en pause qui en a une.
  const idle: Board = { ...board, activeId: null, runs: [{ ...here, status: 'paused' as const }, other] }
  const resumed = applySkill(idle, 'mattpocock-skills:retro', { now: 9_000, isMain: true })!
  expect(activeRun(resumed.board)!.id).toBe(other.id)
})

test('p3 : /implement pour un groupe du parcours en phase compte rendu le continue, et son compte rendu est à refaire', () => {
  let board = boardWith(LOT)
  const id = activeRun(board)!.id
  // Le parcours passe au compte rendu.
  board = applySkill(board, 'flow-board:compte-rendu', { now: 3_000, isMain: true })!.board
  expect(currentPhase(activeRun(board)!).skill).toBe('compte-rendu')
  const out = applySkill(board, 'mattpocock-skills:implement', { now: 4_000, isMain: true, args: 'Groupe B, ticket b1' })!
  const run = activeRun(out.board)!
  expect(run.id).toBe(id)
  expect(out.board.runs).toHaveLength(1)
  expect(currentPhase(run).skill).toBe('implement')
  expect(currentPhase(run).round).toBe(2)
  const report = run.phases.find(p => p.skill === 'compte-rendu')!
  expect(report.status).toBe('pending')
  expect(report.isOptional).toBe(false)
  expect(run.log.some(l => l.text.includes('pour groupe B, b1 (tour 2) : le compte rendu est à refaire'))).toBe(true)
  // Sans groupe ni ticket du parcours dans les arguments, rien ne change de ce côté.
  const unnamed = applySkill(board, 'mattpocock-skills:implement', { now: 4_000, isMain: true, args: 'autre chose' })!
  expect(activeRun(unnamed.board)!.id).not.toBe(id)
})

test('p13 : un choix déclaré se retire ou se remplace, avec sa raison ; le fichier des choix ne garde que ceux en vigueur', () => {
  let board = boardWith(LOT)
  board = applyReport(board, { decided: [{ what: 'Cache en mémoire', why: 'plus simple' }, { what: 'Export en CSV' }] }, 3_000).board
  const out = applyReport(board, { withdrawn: [{ what: 'cache en  mémoire', why: 'le fichier suffit', replacedBy: 'Cache sur disque' }] }, 4_000)
  const run = activeRun(out.board)!
  const gone = run.decided!.find(d => d.what === 'Cache en mémoire')!
  expect(gone).toMatchObject({ withdrawnAt: 4_000, withdrawnWhy: 'le fichier suffit ; remplacé par « Cache sur disque »' })
  // Le badge « à relire » et le compte rendu ne comptent que les choix en vigueur ; un retiré se dit à part.
  expect(unseenDecisions(run)).toBe(2)
  const facts = reportFacts(run).join('\n')
  expect(facts).toContain('Choices withdrawn during the run (no longer in force')
  expect(facts).toContain('Cache en mémoire (le fichier suffit ; remplacé par « Cache sur disque »)')
  const file = decidedFileText(run, null)
  expect(file).not.toContain('Cache en mémoire')
  expect(file).toContain('- Cache sur disque — le fichier suffit')
  expect(file).toContain('- Export en CSV')
  // Un choix inconnu : la réponse le dit, rien ne change.
  expect(applyReport(out.board, { withdrawn: [{ what: 'Inconnu', why: 'x' }] }, 5_000).text).toContain('"withdrawn": no choice in force reads "Inconnu"')
  // Un choix relayé par une session liée, retiré ici ou par elle : hors du fichier.
  const sent = startLinkedGroups(board, ['A'], 5_000)!.board
  const r = activeRun(sent)!
  let relay = applyRelay(undefined, r.id, 'fa', { kind: 'start', group: 'A' }, 5_500)!
  relay = applyRelay(relay, r.id, 'fa', { kind: 'decided', items: [{ what: 'Index par date' }, { what: 'Lot de 50' }] }, 6_000)!
  const mainSide = applyReport(sent, { withdrawn: [{ what: 'Index par date', why: 'inutile' }] }, 6_500, { relay })
  expect(decidedFileText(activeRun(mainSide.board)!, relay)).not.toContain('Index par date')
  relay = applyRelay(relay, r.id, 'fa', { kind: 'withdrawn', items: [{ what: 'Lot de 50', why: 'trop gros', replacedBy: 'Lot de 20' }] }, 7_000)!
  const fileAfter = decidedFileText(r, relay)
  expect(fileAfter).not.toContain('Lot de 50')
  expect(fileAfter).toContain('- Lot de 20')
  // La session liée l'envoie à l'outil : il part au relais, et la réponse le dit.
  const delegated = applyReport(sent, { delegate: r.id, group: 'A' }, 7_100).board
  expect(applyReport(delegated, { withdrawn: [{ what: 'Lot de 50', why: 'trop gros' }] }, 7_200).text).toMatch(/^Relayed to the main discussion's dashboard: 1 withdrawn choice\(s\)\./)
})
