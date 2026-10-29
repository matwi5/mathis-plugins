import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyReport, emptyBoard, newRun, startLinkedGroups } from '../hooks/model.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const LOT = {
  tickets: [
    { id: 'a1', name: 'Code', files: ['src/a.ts'] },
    { id: 'e1', name: 'Icône', files: ['assets/icon.svg'] },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'E', name: 'Icône', tickets: ['e1'] },
  ],
}

const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

/** Le brief d'une session liée pour le groupe E ; `isSource` : le projet contient la source de flow-board. */
const brief = async ($: any, on: any, isSource = false): Promise<string> => {
  mock.clock(on, { now: 80_000_000 })
  const filled = world(on)
  on('session.root', () => ({ value: 'C:/proj' }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isSource && e.path.endsWith('/plugins/flow-board/reference/procedure-groupe.md') }) as any)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  return filled.at(-1)!
}

// Toutes les sessions avaient perdu leurs premiers appels : le document qu'elles devaient lire
// n'existait pas dans un worktree neuf tant que l'installation du projet n'avait pas tourné.
test('le brief : installation du worktree d’abord, discussion désignée par sa référence, compte rendu au relais', async ($, on) => {
  const text = await brief($, on)
  expect(text).toContain("écris-la en clair en tête du background : c'est la première commande de la session, avant toute lecture")
  // Le nom de la discussion se périme (renommage) : sa seule référence, résolue par ListAgents.
  expect(text).toContain('par sa référence entre crochets ([<ref>])')
  expect(text).toContain('et donne en repli son nom du moment')
  expect(text).toContain('"main": "[<ref>]"')
  expect(text).not.toContain('« <nom> [<ref>] »')
  // Un seul compte rendu complet : le relais ; SendMessage et la réponse finale n'en portent qu'une
  // ligne (le détail est dans la procédure, tests/procedure-groupe.test.mjs).
  expect(text).toContain('compte rendu déposé au relais puis une ligne à cette discussion')
})

// La procédure (questions sensibles d'abord, relecteur muet relancé, ni Monitor ni /tdd inutiles,
// visuel à valider) est dans reference/procedure-groupe.md : tests/procedure-groupe.test.mjs.
test('le brief : la procédure par son chemin, ce qui varie en clair', async ($, on) => {
  const text = await brief($, on)
  expect(text).toMatch(/puis lire la procédure d'une session liée de groupe, \S*reference\/procedure-groupe\.md, et la suivre jusqu'au bout : questions sensibles d'abord/)
  expect(text).toContain('TDD : /mattpocock-skills:tdd')
  expect(text).not.toContain('sans nouvelles depuis 10 à 15 minutes')
  // Base de ce plafond : ne jamais recopier la procédure dans le brief. Recopiée, elle faisait passer
  // le texte au-delà de 15 000 signes ; la règle d'effort, avec la suggestion de xhigh et ses
  // exemples, en porte environ 3 000, d'où 9 000 portés à 12 000. Au-delà, raccourcir une consigne
  // du brief (ou la renvoyer à la procédure) plutôt que relever le plafond.
  expect(text.length).toBeLessThan(12000)
  // Au retour : les failles corrigées après coup sont renvoyées à l'outil.
  expect(text).toContain('une faille corrigée après coup (avec mon accord) se renvoie aussi, avec "fixed" mis à jour')
})

test('la réponse de l’outil à une session liée : compte rendu complet au relais, une ligne par SendMessage, la discussion par sa référence', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  let board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = applyReport(board, LOT, 2_000).board
  const sent = startLinkedGroups(board, ['E'], 3_000)!.board
  const out = applyReport(sent, { delegate: activeRun(sent)!.id, group: 'E', main: '[e5eb08]' }, 4_000)
  expect(out.text).toContain('leave your whole report here, {"report": "<the whole report>"}')
  expect(out.text).toContain('then send the main discussion one line that points to it')
  expect(out.text).toContain('call ListAgents, find the row whose [ref] is')
  expect(out.text).not.toContain('send to its bare name')
})

// Le groupe B du parcours xhigh avait lu la procédure installée (0.64.0), sans la section que le
// groupe A venait d'ajouter dans le dépôt.
test('le brief : dans le dépôt de flow-board, la procédure et les méthodes du dépôt d’abord, le chemin installé à défaut', async ($, on) => {
  const text = await brief($, on, true)
  expect(text).toMatch(/puis lire la procédure d'une session liée de groupe, plugins\/flow-board\/reference\/procedure-groupe\.md du dossier de travail \(source du dépôt, qui fait foi ; sinon \S*reference\/procedure-groupe\.md\), et la suivre/)
  expect(text).toContain('revue de sécurité, plugins/flow-board/reference/revue-securite.md (dossier de travail, sinon à côté de la procédure installée)')
  expect(text).toContain('fond et de la forme, plugins/flow-board/reference/relecture-fond-forme.md (dossier de travail, sinon à côté de la procédure installée)')
  expect(text.length).toBeLessThan(12000)
})

test('le brief : ailleurs, les seuls chemins installés', async ($, on) => {
  const text = await brief($, on)
  expect(text).not.toContain('du dossier de travail (source du dépôt')
  expect(text).not.toContain('sinon à côté de la procédure installée')
  expect(text).toMatch(/puis lire la procédure d'une session liée de groupe, \S*reference\/procedure-groupe\.md, et la suivre/)
})

// Au démarrage, le groupe A avait lu d'un bloc la spec, les décisions et les choix (45 Ko).
test('le brief : chaque fichier lu à part, et de la spec les seules sections que cite le ticket', async ($, on) => {
  const text = await brief($, on)
  expect(text).toContain('chaque fichier lu à part, et de la spec les seules sections que cite le ticket')
})
