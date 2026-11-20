import { expect, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { SKILLS } from '../hooks/catalog.ts'
import { applyReport, applySkill, autoDecision, detachOnLoad, emptyBoard, newRun, parkActive, upgradeRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// Mission « Titres stables, questions jamais reposées » (constaté sur « Économie d'usage Claude Code » et « Intégrer
// Fable 5.2 au workflow ») : une mission « Recherche » finie après son cadrage, puis /to-spec tapé dans la même
// discussion, ouvrait une seconde mission nommée « De la spec au code ». Les parcours « Recherche », « Questionnaire »
// et « Réflexion » prennent désormais la chaîne de « Nouvelle fonctionnalité » jusqu'à la PR, implémentation et compte
// rendu obligatoires : avec une implémentation facultative, la mission serait terminée à la fermeture de sa discussion.

const HOUR = 60 * 60 * 1000
const NOW = 100 * HOUR
const TITLE = 'Économie d’usage Claude Code'

/** Le parcours d'une entrée du catalogue, une phase par mot, « ? » pour une phase facultative. */
const routeOf = (id: string): string => (SKILLS[id]!.flow ?? []).map(p => `${p.skill}${p.isOptional ? '?' : ''}${p.alts?.length ? `[${p.alts.join('|')}]` : ''}`).join(' ')

const boardOf = (runs: Run[], session: string): Board => ({ ...emptyBoard('c:/dev/p', 'p'), session, runs, activeId: null, deleted: [] })

/** Une mission « Recherche » titrée, née et tenue dans la discussion Y, sa recherche faite. */
const researchDone = (): Board => {
  let board = applySkill(boardOf([], 'Y'), 'mattpocock-skills:research', { now: NOW, isMain: true })!.board
  board = applyReport(board, { title: TITLE }, NOW + 1_000).board
  return applyReport(board, { complete: true }, NOW + 2_000).board
}

const skillOf = (board: Board, name: string, at: number): Board => applySkill(board, `mattpocock-skills:${name}`, { now: at, isMain: true })!.board

test('« Recherche » : recherche, cadrage, spec, tickets, implémentation, compte rendu, version, PR', () => {
  expect(routeOf('research')).toBe('research grill-with-docs? to-spec? to-tickets? implement compte-rendu project:version? project:pr?')
})

test('« Questionnaire » : questionnaire, puis la même chaîne', () => {
  expect(routeOf('to-questionnaire')).toBe('to-questionnaire grill-with-docs? to-spec? to-tickets? implement compte-rendu project:version? project:pr?')
})

test('« Réflexion » : grill-me, spec, tickets, implémentation, compte rendu, version, PR', () => {
  expect(routeOf('grill-me')).toBe('grill-me to-spec? to-tickets? implement compte-rendu project:version? project:pr?')
})

test('les autres parcours ne changent pas (relevé du 17/11/2026, avant le ticket)', () => {
  const before: Record<string, string> = {
    'grill-with-docs': 'grill-with-docs to-spec? to-tickets? implement compte-rendu project:version? project:pr?',
    'to-spec': 'to-spec to-tickets implement compte-rendu project:version? project:pr?',
    'to-tickets': 'to-tickets implement compte-rendu project:version? project:pr?',
    triage: 'triage to-tickets? implement? compte-rendu? project:version? project:pr?',
    implement: 'implement compte-rendu project:version? project:pr?',
    tdd: 'tdd code-review? compte-rendu project:version? project:pr?',
    prototype: 'prototype',
    'diagnosing-bugs': 'diagnosing-bugs implement? compte-rendu project:version? project:pr?',
    wizard: 'wizard',
    'code-review': 'code-review compte-rendu project:version? project:pr?',
    pr: 'pr',
    'branch-review': 'branch-review compte-rendu project:version? project:pr?',
    retro: 'retro implement? compte-rendu? project:version? project:pr?',
    'improve-codebase-architecture': 'improve-codebase-architecture grill-with-docs? to-spec? to-tickets? implement? compte-rendu? project:version? project:pr?',
    'codebase-design': 'codebase-design',
    'domain-modeling': 'domain-modeling',
    handoff: 'handoff',
    teach: 'teach',
    'writing-for-agents': 'writing-for-agents',
    'setup-matt-pocock-skills': 'setup-matt-pocock-skills',
  }
  const now = Object.keys(SKILLS).filter(id => SKILLS[id]!.flow && !['research', 'to-questionnaire', 'grill-me'].includes(id))
  expect(now.sort()).toEqual(Object.keys(before).sort())
  for (const id of now) expect(`${id}: ${routeOf(id)}`).toBe(`${id}: ${before[id]}`)
})

test('recherche faite, puis /grill-with-docs et /to-spec : la même mission avance, même id, même titre', () => {
  const start = researchDone()
  const id = start.activeId!
  expect(activeRun(start)!.status).toBe('active')
  const framed = applyReport(skillOf(start, 'grill-with-docs', NOW + 3_000), { complete: true }, NOW + 4_000).board
  expect(framed.runs.length).toBe(1)
  const spec = skillOf(framed, 'to-spec', NOW + 5_000)
  const run = activeRun(spec)!
  expect(spec.runs.length).toBe(1)
  expect(run.id).toBe(id)
  expect(run.title).toBe(TITLE)
  expect(run.phases[run.cursor]!.skill).toBe('to-spec')
  expect(run.phases[1]!.status).toBe('done')
})

test('recherche faite, puis /to-spec direct : la même mission avance, le cadrage passe « sauté »', () => {
  const start = researchDone()
  const spec = skillOf(start, 'to-spec', NOW + 3_000)
  const run = activeRun(spec)!
  expect(spec.runs.length).toBe(1)
  expect(run.id).toBe(start.activeId)
  expect(run.title).toBe(TITLE)
  expect(run.phases[run.cursor]!.skill).toBe('to-spec')
  expect(run.phases[1]!.skill).toBe('grill-with-docs')
  expect(run.phases[1]!.status).toBe('skipped')
})

test('recherche et cadrage faits, la discussion se ferme : la mission n’est pas terminée, et /to-spec la reprend à la relance', () => {
  const start = researchDone()
  const id = start.activeId!
  const framed = applyReport(skillOf(start, 'grill-with-docs', NOW + 3_000), { complete: true }, NOW + 4_000).board
  const ended = parkActive(framed, NOW + 5_000)!.board
  const parked = ended.runs.find(r => r.id === id)!
  expect(parked.status === 'done').toBe(false)
  expect(parked.finishedAt).toBeUndefined()
  // La discussion relancée sous le même id.
  const reloaded = detachOnLoad(ended, NOW + HOUR, 'Y')
  const spec = skillOf(reloaded, 'to-spec', NOW + HOUR + 1_000)
  const run = activeRun(spec)!
  expect(spec.runs.length).toBe(1)
  expect(run.id).toBe(id)
  expect(run.title).toBe(TITLE)
  expect(run.phases[run.cursor]!.skill).toBe('to-spec')
})

test('une mission « Recherche » enregistrée avec l’ancien parcours (deux phases) est relue sans changement de ses phases', () => {
  const old = newRun('research', NOW, TITLE)
  old.phases = old.phases.slice(0, 2)
  expect(old.phases.map(p => p.skill)).toEqual(['research', 'grill-with-docs'])
  const before = JSON.stringify(old.phases)
  expect(JSON.stringify(upgradeRun(JSON.parse(JSON.stringify(old)) as Run).phases)).toBe(before)
})

test('mode auto : après la recherche, l’auto se met en pause ; le cadrage fait, il envoie la spec', () => {
  const start = researchDone()
  const afterResearch = autoDecision(activeRun(start)!, {}, false)
  expect(afterResearch.kind).toBe('stop')
  const framed = applyReport(skillOf(start, 'grill-with-docs', NOW + 3_000), { complete: true }, NOW + 4_000).board
  const afterFraming = autoDecision(activeRun(framed)!, {}, false)
  expect(afterFraming.kind).toBe('send')
  expect(afterFraming.kind === 'send' && afterFraming.action.kind === 'command' ? afterFraming.action.skill : null).toBe('to-spec')
})
