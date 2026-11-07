import { expect, mock, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun, startLinkedGroups } from '../hooks/model.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
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

/**
 * Le brief d'un worker pour le groupe E ; `isSource` : le projet contient la source de flow-board ;
 * `lot` et `key` : un autre lot, un autre bouton.
 */
const brief = async ($: any, on: any, isSource = false, lot: Record<string, unknown> = LOT, key = 'launch-linked-E'): Promise<string> => {
  mock.clock(on, { now: 80_000_000 })
  const filled = world(on)
  on('session.root', () => ({ value: 'C:/proj' }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isSource && e.path.endsWith('/plugins/flow-board/reference/procedure-groupe.md') }) as any)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...lot } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key })
  await ui.unmount()
  return filled.at(-1)!
}

/** La longueur du brief sans les chemins des fichiers de flow-board, qui changent avec le poste
 *  et le dossier où le plugin est copié (une copie de l'index par le pre-commit les allonge). */
const lengthOf = (text: string): number => text.replace(/\S*(?=reference\/[a-z-]+\.md)/g, '').length

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
  expect(text).toMatch(/puis lire la procédure d'un worker de groupe, \S*reference\/procedure-groupe\.md, et la suivre jusqu'au bout : questions sensibles d'abord/)
  expect(text).toContain('TDD : /mattpocock-skills:tdd')
  expect(text).not.toContain('sans nouvelles depuis 10 à 15 minutes')
  // Base de ce plafond : ne jamais recopier la procédure dans le brief. Recopiée, elle faisait passer
  // le texte au-delà de 15 000 signes ; la règle d'effort, avec la suggestion de xhigh et ses
  // exemples, en porte environ 3 000, d'où 9 000 portés à 12 000. Au-delà, raccourcir une consigne
  // du brief (ou la renvoyer à la procédure) plutôt que relever le plafond.
  expect(lengthOf(text)).toBeLessThan(12000)
  // Au retour : les failles corrigées après coup sont renvoyées à l'outil.
  expect(text).toContain('une faille corrigée après coup (avec mon accord) se renvoie aussi, avec "fixed" mis à jour')
})

test('la réponse de l’outil à un worker : compte rendu complet au relais, une ligne par SendMessage, la discussion par sa référence', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  let board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = applyReport(board, LOT, 2_000).board
  const sent = startLinkedGroups(board, ['E'], 3_000)!.board
  const out = applyReport(sent, { delegate: activeRun(sent)!.id, group: 'E', main: '[e5eb08]' }, 4_000)
  expect(out.text).toContain('leave your whole report here, {"report": "<the whole report>"}')
  expect(out.text).toContain('then send the manager one line that points to it')
  expect(out.text).toContain('call ListAgents, find the row whose [ref] is')
  expect(out.text).not.toContain('send to its bare name')
})

// Le groupe B de la mission xhigh avait lu la procédure installée (0.64.0), sans la section que le
// groupe A venait d'ajouter dans le dépôt.
test('le brief : dans le dépôt de flow-board, la procédure et les méthodes du dépôt d’abord, le chemin installé à défaut', async ($, on) => {
  const text = await brief($, on, true)
  expect(text).toMatch(/puis lire la procédure d'un worker de groupe, plugins\/flow-board\/reference\/procedure-groupe\.md du dossier de travail \(source du dépôt, qui fait foi ; sinon \S*reference\/procedure-groupe\.md\), et la suivre/)
  expect(text).toContain('revue de sécurité, plugins/flow-board/reference/revue-securite.md (dossier de travail, sinon à côté de la procédure installée)')
  expect(text).toContain('fond et de la forme, plugins/flow-board/reference/relecture-fond-forme.md (dossier de travail, sinon à côté de la procédure installée)')
  // Aucun worker n'avait ouvert l'index du README : 110 à 220k de contexte à chercher dans model.ts.
  expect(text).toContain('« Index : concept → fichier et fonction » de plugins/flow-board/README.md')
  expect(text).toContain('lus par fonction')
  // Un groupe qui corrigeait flow-board avait pris son correctif pour actif.
  expect(text).toContain('le mod qui tourne est sa version installée, pas celle du dépôt')
  expect(lengthOf(text)).toBeLessThan(12000)
})

// L'option fusion ajoute au plus une ligne de groupe et la phrase du lancement sur Sonnet : un groupe sans
// logique seul, ou mêlé à un groupe avec logique, reste sous le plafond.
const FUSION = {
  tickets: [
    { id: 'a1', name: 'Code', files: ['src/a.ts'], sensitive: false, logic: true },
    { id: 'e1', name: 'Icône', files: ['assets/icon.svg'], sensitive: false, logic: false },
  ],
  groups: LOT.groups,
}

test('le brief : un groupe sans logique (Sonnet), seul ou avec un autre, reste sous le plafond', async ($, on) => {
  const alone = await brief($, on, true, FUSION, 'launch-linked-E')
  expect(alone).toContain('Sonnet high, sans logique')
  expect(lengthOf(alone)).toBeLessThan(12000)
})

test('le brief : deux groupes, l’un sur Sonnet et l’autre sur Opus, restent sous le plafond', async ($, on) => {
  const both = await brief($, on, true, FUSION, 'launch-parallel-linked')
  expect(both).toContain('Groupe A (Code)')
  expect(both).toContain('Sonnet high, sans logique')
  expect(lengthOf(both)).toBeLessThan(12000)
})

test('le brief : ailleurs, les seuls chemins installés', async ($, on) => {
  const text = await brief($, on)
  expect(text).not.toContain('du dossier de travail (source du dépôt')
  expect(text).not.toContain('sinon à côté de la procédure installée')
  expect(text).not.toContain('Index : concept → fichier et fonction')
  expect(text).not.toContain('est sa version installée')
  expect(text).toMatch(/puis lire la procédure d'un worker de groupe, \S*reference\/procedure-groupe\.md, et la suivre/)
})

// Les décisions prises après le départ d'une branche manquaient à la copie du worktree que lisaient
// la session et ses relecteurs : le fichier se cite par son chemin absolu dans ce dossier, lu par Read.
test('le brief : le fichier de décisions par son chemin absolu dans ce dossier, lu par Read', async ($, on) => {
  const text = await brief($, on)
  expect(text).toContain('par son chemin absolu dans ce dossier (C:/proj)')
  expect(text).toContain('lu par Read')
})

// Au démarrage, le groupe A avait lu d'un bloc la spec, les décisions et les choix (45 Ko).
test('le brief : chaque fichier lu à part, et de la spec les seules sections que cite le ticket', async ($, on) => {
  const text = await brief($, on)
  expect(text).toContain('chaque fichier lu à part, et de la spec les seules sections que cite le ticket')
})
