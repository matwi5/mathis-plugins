import { expect, mock, test } from 'claude-code/testing'

import { ownPart } from '../hooks/linked.ts'
import { activeRun, applyReport, emptyBoard, linkGroupSession, newRun, startLinkedGroups } from '../hooks/model.ts'
import type { Board } from '../types'

// Les pistes de la rétro du parcours « Frise, groupes et titres » qui changent les consignes du mod.

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

/** Un dépôt git en C:/proj ; `standards` : son CODING_STANDARDS.md existe. */
const world = (on: any, standards: boolean) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: standards && e.path.endsWith('/CODING_STANDARDS.md') }) as any)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

/** Le texte de délégation du groupe E, et les consignes d'/implement. */
const texts = async ($: any, on: any, standards: boolean): Promise<{ brief: string; implement: string; tickets: string }> => {
  mock.clock(on, { now: 80_000_000 })
  const filled = world(on, standards)
  await $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
  const tickets = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text as string
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  const implement = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text as string
  return { brief: filled.at(-1)!, implement, tickets }
}

test('r6 : avec CODING_STANDARDS.md, les consignes des revues en écrivent le chemin ; sans, elles le disent absent', async ($, on) => {
  const { brief, implement } = await texts($, on, true)
  expect(implement).toContain('- Project judgement rules: C:/proj/CODING_STANDARDS.md. Write this path in the instructions file of every review')
  expect(brief).toContain('que le projet a un CODING_STANDARDS.md à sa racine (son chemin, à la racine du dossier de travail de la session, va dans le fichier de consignes de chaque revue)')
})

test('r6 : sans CODING_STANDARDS.md, aucun relecteur ne le cherche', async ($, on) => {
  const { brief, implement } = await texts($, on, false)
  expect(implement).toContain('- Project judgement rules: this project has no CODING_STANDARDS.md at its root')
  expect(brief).toContain("que le projet n'a pas de CODING_STANDARDS.md à sa racine")
})

test('r11 et r22 : critères cochés avant le commit, critères des tickets faits du groupe dans les consignes de la revue', async ($, on) => {
  const { implement } = await texts($, on, false)
  expect(implement).toContain('commit (before the commit, tick each criterion of the ticket file (- [x]) and name next to it the test that covers it (or why none can); commit on the current branch')
  expect(implement).toContain("The instructions file of the two axes also quotes the done criteria of the group's tickets already done that touch the same files")
})

test('r5 : un choix déclaré ne se défait pas par préférence, mais un défaut qu’il produit se signale', async ($, on) => {
  const { implement } = await texts($, on, false)
  expect(implement).toContain('do not undo a declared choice out of preference nor report it again as such, but report any case where it produces a defect, with its scenario')
  expect(implement).not.toContain('do not report again nor undo')
})

test('r2 : un ticket qui ajoute un champ persisté est en zone sensible, nomme ses chemins d’effacement et de fusion', async ($, on) => {
  const { tickets } = await texts($, on, false)
  expect(tickets).toContain('A ticket that adds a field to persisted data (a stored file or registry, a record shared between discussions or sessions, a key of the store) says « Zone sensible : oui »')
  expect(tickets).toContain('names every path that erases the field and every path that merges or rebuilds it, and carries the invariant of its persisted data')
})

test('r3 et r14 : branch_name au lancement depuis l’app ; au retour, la branche lue avant d’appliquer un correctif proposé', async ($, on) => {
  const { brief } = await texts($, on, false)
  expect(brief).toContain('use_worktree true et branch_name "groupe-boutique-<id>" (un worktree à elle, à ce nom')
  expect(brief).toContain("avant d'appliquer ici un correctif que son compte rendu propose, lire sa branche (git log et git diff de son worktree) : elle l'a peut-être déjà fait ; une question de son compte rendu se tranche ici, et la session n'applique rien d'autre sans un message d'ici")
})

test('r16 : le titre d’une session liée sépare le parcours par « > » ; les anciens titres se relient encore', async ($, on) => {
  const { brief } = await texts($, on, false)
  expect(brief).toContain('avec un titre qui commence par « Boutique > Groupe <id> · »')
  expect(brief).toContain('jamais une session dont le titre commence par « Boutique > » (ses sœurs)')
  expect(brief).not.toContain('›')

  expect(ownPart('Frise, groupes et titres > Groupe A · Frise').trim()).toBe('Groupe A · Frise')
  expect(ownPart('Frise, groupes et titres › Groupe A · Frise').trim()).toBe('Groupe A · Frise')
  expect(ownPart("Frise, groupes et titres ' Groupe A · Frise").trim()).toBe('Groupe A · Frise')
  expect(ownPart('Lot SC â€º Groupe B · x').trim()).toBe('Groupe B · x')
  // Une apostrophe n'est pas un séparateur.
  expect(ownPart("Groupe A · l'export")).toBe("Groupe A · l'export")

  const run = { ...newRun('implement', 1_000, 'Revue du groupe P'), owner: 's' }
  let board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = applyReport(board, LOT, 2_000).board
  const both = startLinkedGroups(board, ['A', 'E'], 3_000)!.board
  for (const sep of ['>', '›', "'"]) {
    const linked = linkGroupSession(both, `Revue du groupe A ${sep} Groupe E · Icône`, `local_${sep}`, 3_300)!.board
    expect(activeRun(linked)!.groups!.find(g => g.id === 'E')!.linked?.session).toBe(`local_${sep}`)
    expect(activeRun(linked)!.groups!.find(g => g.id === 'A')!.linked?.session).toBeUndefined()
  }
})
