import { expect, mock, test } from 'claude-code/testing'

import { isBeforeImplPhase } from '../hooks/basics.ts'
import { newRun, upgradeRun } from '../hooks/model.ts'
import type { FlowPhase, Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
}

/** Les textes du panneau, un par ligne, espaces insécables rendus ordinaires. */
const texts = async (pane: any): Promise<string> =>
  ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '').replace(/ /g, ' ').trim()).join('\n')

const skills = (run: Run) => run.phases.map(p => `${p.skill}:${p.isOptional ? 'opt' : 'due'}`)

/** Le texte du correctif écrit comme un ticket, et l'ancien texte de l'étape (détour, ancien parcours). */
const AS_TICKET = /fix \(phase 5: write the regression test and see it red, then write the fix as a local ticket of the mission instead of coding it/
const OLD_FIX = /fix \(phase 5: regression test, then the fix\)/

test('une Chasse au bug neuve : Diagnostic → Implémentation → Compte rendu, sans phase Revue', () => {
  // L'Implémentation est notée facultative : elle devient due dès que le lot a un ticket à faire (`isPhaseOptional`).
  expect(skills(newRun('diagnosing-bugs', 1))).toEqual([
    'diagnosing-bugs:due',
    'implement:opt',
    'compte-rendu:due',
    'project:version:opt',
    'project:pr:opt',
  ])
})

test('une Chasse au bug enregistrée avant garde son parcours, et l’ancien texte de son étape « Correctif »', () => {
  const run = newRun('diagnosing-bugs', 1_000)
  const phase = (skill: string, isOptional: boolean): FlowPhase => ({ ...run.phases[0]!, skill, status: 'pending', alts: [], isOptional })
  const old: Run = {
    ...run,
    phases: [run.phases[0]!, phase('code-review', true), phase('compte-rendu', false), phase('project:version', true), phase('project:pr', true)],
  }
  expect(upgradeRun(old)).toBe(old)
  expect(isBeforeImplPhase(old, 'diagnosing-bugs')).toBe(false)
  expect(isBeforeImplPhase(run, 'diagnosing-bugs')).toBe(true)
})

test('le Diagnostic écrit le correctif comme un ticket, qui passe en Implémentation à la fin du Diagnostic', async ($, on) => {
  mock.clock(on, { now: 98_000_000 })
  mock.store(on)
  world(on)
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'b' })
  expect(note.text).toMatch(AS_TICKET)
  expect(note.text).toMatch(/cleanup \(phase 6: only remove the \[DEBUG-…\] markers and the throwaway prototypes/)
  expect(note.text).not.toMatch(OLD_FIX)
  // L'appel que dicte l'étape, rejoué tel quel : ses deux drapeaux sont lus, aucune clé n'est ignorée.
  expect(note.text).toContain('{"tickets": [{"id": "<its id>", "name": "<short title>", "blockedBy": [], "sensitive": true|false, "logic": true|false}]}')
  const sent: any = await $.tool.call({ tool: TOOL, tickets: [{ id: 'F1', name: 'Correctif du cache', blockedBy: [], sensitive: false, logic: true }] } as any)
  expect(JSON.stringify(sent)).not.toMatch(/Not read/)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /CHASSE AU BUG/ })).toBeDefined()
  await ui.unmount()

  // L'Implémentation fait le ticket du correctif avec les étapes d'un ticket, ses revues comprises.
  const impl = await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'i' })
  expect(impl.text).toMatch(/Steps of implement, in order/)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  let shown = await texts(ui)
  expect(shown).toMatch(/phase 2\/5/)
  expect(shown).toMatch(/^⚙ Implémentation$/m)
  expect(shown).toMatch(/^Correctif du cache$/m)
  expect(shown).toMatch(/^0\/1$/m)
  // Le correctif à faire rend l'Implémentation due.
  expect(shown).not.toMatch(/facultative/)
  await ui.unmount()
  // La revue du ticket, comme dans toute Implémentation.
  expect(impl.text).toMatch(/review \(/)
  await $.tool.call({ tool: TOOL, title: 'Correctif du cache', step: 'review', review: { ticket: 'F1', standards: 0, spec: 0, fixed: 0 } } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'F1', status: 'done' }] } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  shown = await texts(ui)
  expect(shown).toMatch(/^1\/1$/m)
  // Ensuite, comme un lot classique sans groupes dont le ticket a de la logique : la revue du lot, plus de phase « Revue ».
  expect(await ui.find({ key: 'go-final-review' })).toBeDefined()
  expect(await ui.find({ key: 'go-code-review' })).toBeUndefined()
  await ui.unmount()
})

test('un Diagnostic fini sans correctif (pas un bug) va au compte rendu : l’Implémentation reste facultative', async ($, on) => {
  mock.clock(on, { now: 98_200_000 })
  mock.store(on)
  world(on)
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'b' })
  expect(note.text).toMatch(/When the diagnosis ends with no fix to make \(not a bug, or not reproduced\), say so and send no ticket/)
  // Un bug sans bon point de test reste un correctif à faire : ticket sans test, l'absence de point de test notée.
  expect(note.text).toMatch(/the red regression test, or, when no correct seam exists, that finding instead of a test/)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeDefined()
  await ui.unmount()
})

test('en détour d’une Implémentation, l’étape « Correctif » garde l’ancien texte : le bug se corrige dans le lot', async ($, on) => {
  mock.clock(on, { now: 98_500_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'i' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'T1', name: 'Un', blockedBy: [] }] } as any)
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'z' })
  expect(note.text).toMatch(OLD_FIX)
  expect(note.text).not.toMatch(AS_TICKET)
})
