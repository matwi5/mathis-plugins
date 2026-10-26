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

/** Le brief d'une session liée pour le groupe E. */
const brief = async ($: any, on: any): Promise<string> => {
  mock.clock(on, { now: 80_000_000 })
  const filled = world(on)
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
  expect(text).toContain('par sa seule référence entre crochets ([<ref>])')
  expect(text).toContain('"main": "[<ref>]"')
  expect(text).not.toContain('« <nom> [<ref>] »')
  // Un seul compte rendu complet : le relais ; SendMessage et la réponse finale n'en portent qu'une ligne.
  expect(text).toContain('{"report": "<le compte rendu entier>"}')
  expect(text).toContain('une seule ligne qui renvoie au relais')
})

test('le brief : questions sensibles d’abord, relecteur muet relancé, ni Monitor ni /tdd inutiles, visuel à valider', async ($, on) => {
  const text = await brief($, on)
  expect(text).toContain('avant le premier ticket, me poser en une fois les questions sensibles du groupe')
  expect(text).toContain('sans nouvelles depuis 10 à 15 minutes')
  expect(text).toContain('un sous-agent s\'attend par cette notification, sans surveillance armée (pas de Monitor pour un sous-agent)')
  expect(text).toContain('sauter /mattpocock-skills:tdd pour un ticket sans comportement testable')
  expect(text).toContain("une modification unique passe par l'outil Edit")
  expect(text).toContain('un visuel à valider par moi')
  expect(text).toContain('produire une planche (les variantes côte à côte, dans un fichier)')
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
