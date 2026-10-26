import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyReport, emptyBoard, groupPlan, newRun } from '../hooks/model.ts'
import type { Board } from '../types'

/** Un parcours actif après un appel de l'outil `flow`. */
const boardWith = (input: Record<string, unknown>): Board => {
  const run = { ...newRun('to-tickets', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}

// Un seul ticket sur quinze disait s'il touchait une zone sensible : l'avis « zone sensible » a été
// suivi par un groupe et ignoré par un autre. Chaque ticket le dit, et l'outil le garde.
test('un ticket porte sa zone sensible et sa logique ; une mise à jour sans ces champs les garde', () => {
  let board = boardWith({
    tickets: [
      { id: 't1', name: 'Retrait du mode privé', sensitive: true, logic: true },
      { id: 't2', name: 'Icône', sensitive: false, logic: false },
      { id: 't3', name: 'Sans avis' },
    ],
  })
  const ticket = (id: string) => activeRun(board)!.tickets.find(t => t.id === id)!
  expect(ticket('t1')).toMatchObject({ sensitive: true, logic: true })
  expect(ticket('t2')).toMatchObject({ sensitive: false, logic: false })
  expect(ticket('t3').sensitive).toBeUndefined()
  expect(ticket('t3').logic).toBeUndefined()
  board = applyReport(board, { tickets: [{ id: 't1', name: 'Retrait du mode privé', status: 'doing' }] }, 3_000).board
  expect(ticket('t1')).toMatchObject({ sensitive: true, logic: true, status: 'doing' })
})

// README et DECISIONS.md, cités par presque tous les tickets, empêchaient tout groupe en parallèle.
test('les documents communs (README, DECISIONS.md, carte du code) n’empêchent pas deux groupes de tourner ensemble', () => {
  const board = boardWith({
    tickets: [
      { id: 'a1', name: 'Worker', files: ['src/worker.ts', 'README.md', 'DECISIONS.md'] },
      { id: 'b1', name: 'App', files: ['src/app.ts', 'docs/README.md', 'docs/agents/carte-du-code.md'] },
    ],
    groups: [
      { id: 'A', name: 'Worker', tickets: ['a1'], files: ['docs/agents/carte-du-code.md'] },
      { id: 'B', name: 'App', tickets: ['b1'], files: ['readme.md'] },
    ],
  })
  expect(groupPlan(activeRun(board)!)!.parallelBatch).toEqual(['A', 'B'])
  // Un vrai fichier commun bloque toujours.
  const shared = boardWith({
    tickets: [
      { id: 'a1', name: 'Worker', files: ['src/shared.ts', 'README.md'] },
      { id: 'b1', name: 'App', files: ['src/shared.ts'] },
    ],
    groups: [
      { id: 'A', name: 'Worker', tickets: ['a1'] },
      { id: 'B', name: 'App', tickets: ['b1'] },
    ],
  })
  expect(groupPlan(activeRun(shared)!)!.groups.find(g => g.group.id === 'B')!.conflicts).toEqual([{ with: 'A', on: 'shared.ts' }])
})

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
}

test('/to-tickets fait dire à chaque ticket sa zone sensible et sa logique, et garde CLAUDE.md et les documents communs hors des tickets de groupe', async ($, on) => {
  mock.clock(on, { now: 50_000_000 })
  mock.store(on)
  world(on)
  const text = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text as string
  expect(text).toContain('« Zone sensible : oui/non (pourquoi) »')
  expect(text).toContain('« Logique : oui/non »')
  expect(text).toContain('"sensitive": true|false')
  expect(text).toContain('"logic": true|false')
  // Une session liée ne peut pas écrire CLAUDE.md : un ticket resté 19 heures en attente.
  expect(text).toContain('A write to CLAUDE.md never goes into the done criteria of a group ticket')
  expect(text).toContain('README, DECISIONS.md and the code map (carte-du-code.md, CODEMAP.md) stay out of "files"')
})

test('/to-spec et le grilling cherchent les conséquences sensibles et vérifient l’exposition avant une question de confidentialité', async ($, on) => {
  mock.clock(on, { now: 51_000_000 })
  mock.store(on)
  world(on)
  const spec = (await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })).text as string
  expect(spec).toContain('sensitive (')
  expect(spec).toContain('what the change, or a removal, leaves behind')
  const grill = (await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })).text as string
  expect(grill).toContain('what the change, or a removal, leaves behind')
  for (const text of [spec, grill]) {
    expect(text).toContain('Before a privacy question, have a read-only subagent check the real exposure')
    expect(text).toContain('"à confirmer"')
  }
})
