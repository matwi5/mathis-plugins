import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, newRun, upgradeRun } from '../hooks/model.ts'
import type { Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

test('le compte rendu reçoit les faits du tableau de bord et ne se clôt pas par Claude', async ($, on) => {
  mock.clock(on, { now: 90_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    title: 'Lot SC',
    tickets: [
      { id: 'a1', name: 'Règle SC', status: 'done' },
      { id: 'b1', name: 'Recalage', status: 'blocked', why: 'ton accord sur le plan' },
    ],
    decided: [{ what: 'Corrigé le rattrapage hors de la file', why: 'il faussait le ticket 4' }],
  } as any)
  await $.tool.call({ tool: TOOL, complete: true })

  const note = (await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })).text
  expect(note).toMatch(/Run "Lot SC", started /)
  expect(note).toMatch(/Recalage \[b1\]: blocked \(waits for: ton accord sur le plan\)/)
  expect(note).toMatch(/Corrigé le rattrapage hors de la file \(because il faussait le ticket 4\)/)
  expect(note).toMatch(/Never send \{"complete": true\}/)
  expect(note).not.toMatch(/When the work of compte-rendu is finished/)

  await $.tool.call({ tool: TOOL, complete: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ key: 'report-ok' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Claude rédige le rapport/ })).toBeDefined()
    await ui.unmount()
  }
  const waiting = await $.tool.call({ tool: TOOL, step: 'validate' })
  expect(String((waiting as { result?: unknown }).result)).toMatch(/ · rapport : en attente de validation/)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Le rapport est dans la discussion : lis-le/ })).toBeDefined()
  await ui.unmount()
})

test('« ✎ À reprendre » prépare la réponse ; « ✓ Valider » clôt la phase et marque les choix relus', async ($, on) => {
  mock.clock(on, { now: 91_000_000 })
  mock.store(on)
  const filled = engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, decided: [{ what: 'Reporté le ticket 5' }], complete: true } as any)
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })

  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'report-redo' })
  expect(filled.at(-1)).toBe('Rapport non validé : ')
  await ui.press({ key: 'report-ok' })
  expect(await ui.find({ key: 'report-ok' })).toBeUndefined()
  const after = await $.tool.call({ tool: TOOL, note: 'x' })
  expect(String((after as { result?: unknown }).result)).toMatch(/ · rapport : validé \(\d{4}-\d\d-\d\d \d\d:\d\d UTC\)/)
  expect(await ui.find({ key: 'go-project:version' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /à relire/ })).toBeUndefined()
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Text', text: /Compte rendu validé/ })).toBeDefined()
  await ui.unmount()
})

test('« ✓ Valider le rapport » le dit à Claude par un message ; « ✎ À reprendre » n’envoie rien', async ($, on) => {
  mock.clock(on, { now: 91_500_000 })
  mock.store(on)
  engine(on)
  const submitted: { text: string; origin?: { kind?: string; asUser?: boolean } }[] = []
  on('prompt.submit', (_$: unknown, e: { text: string; origin?: { kind?: string; asUser?: boolean } }) => {
    submitted.push(e)
    return { text: e.text }
  })
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot xhigh', complete: true } as any)
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'report-redo' })
  expect(submitted).toHaveLength(0)
  await ui.press({ key: 'report-ok' })
  expect(submitted).toHaveLength(1)
  expect(submitted[0]!.text).toMatch(/^J'ai validé le compte rendu du parcours « Lot xhigh » depuis le tableau de bord \(✓ Valider le rapport\)\./)
  // Le message vient du mod, pas des mots de la personne.
  expect(submitted[0]!.origin?.kind).toBe('plugin')
  expect(submitted[0]!.origin?.asUser).toBeUndefined()
  await ui.unmount()
})

test('livrer sans rapport validé : le compte rendu est sauté, et le journal le dit', async ($, on) => {
  mock.clock(on, { now: 92_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, complete: true })
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })
  await $.skill.prompt({ skill: 'project:version', text: 'v' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Text', text: /Compte rendu sauté : livraison sans rapport validé/ })).toBeDefined()
  await ui.unmount()
})

test('les anciens parcours reçoivent le compte rendu avant Version et push, une seule fois', () => {
  const run = newRun('implement', 1_000)
  const old: Run = { ...run, phases: run.phases.filter(p => p.skill !== 'compte-rendu') }
  const upgraded = upgradeRun(old)
  expect(upgraded.phases.map(p => p.skill)).toEqual(['implement', 'compte-rendu', 'project:version', 'project:pr'])
  expect(upgradeRun(upgraded)).toBe(upgraded)
  // Déjà en livraison : rien n'est ajouté derrière.
  const delivering: Run = { ...old, cursor: 1, phases: old.phases.map((p, i) => (i === 1 ? { ...p, status: 'active' as const } : p)) }
  expect(upgradeRun(delivering)).toBe(delivering)
  expect(emptyBoard('c:/p', 'p').runs).toEqual([])
})

test('un groupe fini ne clôt pas l’implémentation tant que des tickets du lot restent ouverts', async ($, on) => {
  mock.clock(on, { now: 93_000_000 })
  mock.store(on)
  engine(on)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text
  expect(note).toMatch(/A finished group is not the end/)
  await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: 'a1', name: 'Groupe A fini', status: 'done' },
      { id: 'b1', name: 'Groupe B à faire' },
    ],
  } as any)
  const answer = await $.tool.call({ tool: TOOL, complete: true })
  expect(JSON.stringify(answer)).toMatch(/not finished: 1 ticket\(s\) of the lot still open \(Groupe B à faire\)/)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^✓.fait$/ })).toBeUndefined()
  await ui.unmount()
})

test('plusieurs groupes, plusieurs discussions : le compte rendu reçoit les groupes et tous les fichiers de suivi', async ($, on) => {
  mock.clock(on, { now: 94_000_000 })
  mock.store(on)
  engine(on)
  on('session.root', () => ({ value: 'C:/proj' }))
  on('tool.call', { tool: 'Write' }, () => ({ result: { filePath: 'x' } }))
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: 'a1', name: 'Worker', status: 'doing' },
      { id: 'b1', name: 'App' },
    ],
    groups: [
      { id: 'A', name: 'Worker SC', tickets: ['a1'] },
      { id: 'B', name: 'App SC', tickets: ['b1'] },
    ],
  } as any)
  await $.tool.call({ tool: 'Write', file_path: 'C:/proj/travail/tasks/2026-10-05_sc-vsc-worker.md', content: '# Groupe A' } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }, { id: 'b1', status: 'done' }], complete: true } as any)

  const note = (await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })).text
  expect(note).toMatch(/Groups, each usually run in its own discussion: A \(Worker SC\): 1\/1 done; B \(App SC\): 1\/1 done/)
  expect(note).toMatch(/write « Fait » group by group/)
  expect(note).toMatch(/Tracking files of this run .*travail\/tasks\/2026-10-05_sc-vsc-worker\.md \(groupe A/)
})
