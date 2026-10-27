import { expect, mock, test } from 'claude-code/testing'

import { applyCommand, applyFileChange, emptyBoard, newRun, splitCommand } from '../hooks/model.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
}

/** Un board avec un parcours « implement » actif dans le projet c:/demo. */
const boardWithRun = () => {
  const run = newRun('implement', 1000)
  return { ...emptyBoard('C:/demo', 'demo'), runs: [run], activeId: run.id }
}

test('A1 : grep "git commit" n’est pas un commit ; un vrai commit derrière cd && l’est', async () => {
  const board = boardWithRun()
  expect(applyCommand(board, 'git log | grep "git commit"', true, '', 2000)).toBeNull()
  const out = applyCommand(board, 'cd C:/demo && git commit -m "feat: x; y"', true, '', 2000)
  expect(out?.board.runs[0]!.counters.commits).toBe(1)
  expect(out?.board.runs[0]!.log[0]!.text).toBe('Commit : feat: x; y')
})

test('A2 : un test masqué par un tube ou un point-virgule se lit dans la sortie', async () => {
  const board = boardWithRun()
  const piped = applyCommand(board, 'npm test 2>&1 | tail -5', true, 'ÉCHEC : ok.txt est absent', 2000)
  expect(piped?.board.runs[0]!.tests.map(t => t.ok)).toEqual([false])
  expect(applyCommand(board, 'npm test; echo fini', true, 'fini', 2000)).toBeNull()
  const chained = applyCommand(board, 'npm test && echo vert', false, '', 2000)
  expect(chained?.board.runs[0]!.tests.map(t => t.ok)).toEqual([false])
  expect(splitCommand('a && b | c; d').map(s => s.next)).toEqual(['&&', '|', ';', ''])
})

test('A3 : un fichier écrit hors du projet ne compte pas', async () => {
  const board = boardWithRun()
  expect(applyFileChange(board, { path: 'C:/Users/x/AppData/Local/Temp/notes.md', content: 'x' }, 2000)).toBeNull()
  const inside = applyFileChange(board, { path: 'C:/demo/src/a.ts', content: 'x' }, 2000)
  expect(inside?.board.runs[0]!.touched).toEqual(['c:/demo/src/a.ts'])
})

test('A7 : un glossaire en liste simple compte ses termes', async () => {
  const board = boardWithRun()
  const out = applyFileChange(board, { path: 'C:/demo/GLOSSARY.md', content: '# Glossaire\n\n- Facture : document\n- **Avoir** : remboursement\n' }, 2000)
  expect(out?.board.runs[0]!.counters.terms).toBe(2)
})

test('A5, A6, A9 : clore une phase saute les étapes non atteintes ; la suite va dans le prompt', async ($, on) => {
  mock.clock(on, { now: 9_000_000 })
  mock.store(on)
  engine(on)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Export', step: 'explore' })
  await $.tool.call({ tool: TOOL, complete: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    const publish = await ui.find({ type: 'Text', text: /^Publier$/ })
    expect(publish?.props).toMatchObject({ strikethrough: true })
    expect(await ui.find({ type: 'Text', text: /✓\sfait/ })).toBeDefined()
    await ui.press({ key: 'go-to-tickets' })
    await ui.press({ key: 'tab-activity' })
    expect(await ui.find({ type: 'Text', text: /Spec terminée/ })).toBeDefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
  expect(filled).toEqual(['/mattpocock-skills:to-tickets', '/mattpocock-skills:to-tickets'])
})

test('A4 : le parcours resté actif d’une session précédente se charge en pause', async ($, on) => {
  mock.clock(on, { now: 10_000_000 })
  const saved = { ...emptyBoard('', 'projet'), runs: [newRun('diagnosing-bugs', 9_000_000, 'Bug d’hier')] }
  saved.activeId = saved.runs[0]!.id
  mock.store(on, { 'board:': saved })
  engine(on)
  on('command.run', { command: 'flow' }, async (_$, e, next) => next(e))
  // En session, session.start charge le stockage ; ici, /flow le fait.
  await $.command.run({ command: 'flow', args: '' } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Bug d’hier/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Le dernier parcours, « Bug d’hier », est en pause/ })).toBeDefined()
    await ui.unmount()
  }
})

test('commit puis clôture : la suite complète au vert compte comme Vérifications, la Revue de code reste sautée', async ($, on) => {
  const clock = mock.clock(on, { now: 11_000_000 })
  const mem: Record<string, unknown> = {}
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  engine(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))

  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Somme', step: 'read' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'git add somme.js && git commit -m "feat: somme"' } as any)
  await $.tool.call({ tool: TOOL, complete: true })

  // Les étapes ne s'affichent plus pendant l'Implémentation : elles se lisent dans le parcours enregistré.
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const steps = (mem['board:'] as Board).runs[0]!.phases.find(p => p.skill === 'implement')!.steps
  const status = (id: string) => steps.find(s => s.id === id)!.status
  expect(status('review')).toBe('skipped')
  expect(status('checks')).toBe('done')
  expect(status('commit')).toBe('done')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-history' })
    expect(await ui.find({ type: 'Text', text: /Implémentation.*Implémentation/ })).toBeUndefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})

test('reprise : la phase garde ses étapes et son tour ; le titre posé reste', async ($, on) => {
  mock.clock(on, { now: 12_000_000 })
  mock.store(on)
  engine(on)

  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'export CSV', step: 'write' })
  await $.tool.call({ tool: TOOL, title: 'Autre titre' })
  // Un bug en plein milieu : la spec passe en pause, puis reprend.
  await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'y' })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'z' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^export CSV$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tour\s2/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Rédiger la spec$/ }))?.props).toMatchObject({ bold: true })
  await ui.unmount()
})

test('lancer la suite proposée d’un prototype clôt le prototype au lieu de le mettre en pause', async ($, on) => {
  mock.clock(on, { now: 13_000_000 })
  mock.store(on)
  engine(on)

  await $.skill.prompt({ skill: 'mattpocock-skills:prototype', text: 'x' })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'y' })

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-history' })
  expect(await ui.find({ type: 'Text', text: /en pause/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /terminé/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('onglet Commandes : démarrer un parcours, les autres commandes, et l’Historique sans lanceur', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 14_000_000 })
  mock.store(on)
  engine(on)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  // Sans aucun parcours : l'accueil, le lanceur dans l'onglet Parcours, et l'onglet Commandes.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ key: 'new-grill-with-docs' })).toBeDefined()
    await ui.press({ key: 'tab-commands' })
    expect(await ui.find({ type: 'Text', text: /^Démarrer un parcours$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Autres commandes$/ })).toBeDefined()
    await ui.press({ key: 'cmd-prototype' })
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
  expect(filled).toEqual(['/mattpocock-skills:prototype ', '/mattpocock-skills:prototype '])

  // Avec un parcours : l'Historique ne porte plus le lanceur.
  await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'x' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-history' })
  expect(await ui.find({ key: 'new-grill-with-docs' })).toBeUndefined()
  await ui.press({ key: 'tab-commands' })
  expect(await ui.find({ key: 'cmd-retro' })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('une liste partielle de tickets ajoute ou met à jour, sans retirer les autres', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 15_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: Array.from({ length: 10 }, (_, i) => ({ id: String(100 + i), name: `Ticket ${i + 1}` })),
  })
  // Une autre discussion n'implémente que 2 tickets : elle n'envoie qu'eux.
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })
  const answer = await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: '103', name: 'Ticket 4', status: 'doing' },
      { id: '104', name: 'Ticket 5' },
    ],
  })
  expect(String((answer as { result?: unknown }).result)).toMatch(/tickets 0\/10/)
  // Un ticket inconnu s'ajoute à la fin.
  const more = await $.tool.call({ tool: TOOL, tickets: [{ id: '999', name: 'Nouveau', status: 'done' }] })
  expect(String((more as { result?: unknown }).result)).toMatch(/tickets 1\/11/)
})
