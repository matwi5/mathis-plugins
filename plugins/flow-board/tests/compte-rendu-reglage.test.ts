// Les faits du compte rendu et les choix tranchés par une case d'autonomie : ceux dont le texte commence par « Réglage : »
// (ou « Zone sensible : Réglage : » pour un choix sensible) se comptent à part et forment le groupe « Tranché par
// réglage », juste après celui de la zone sensible, et nulle part ailleurs ; sans eux, les faits sont ceux d'avant (les
// tests de `choix-auto.test.ts` les épinglent à l'octet près).

import { expect, test } from 'claude-code/testing'

import { SETTING_GROUP, applyReport, emptyBoard, isSettingDecision, newRun, reportFacts, switchOnAuto } from '../hooks/model.ts'
import type { AutonomyCases } from '../hooks/autonomy-setting.ts'
import type { Board, Run } from '../types'

const T0 = 99_000_000
const ALL: AutonomyCases = { experience: true, invariant: true, contradiction: true, spend: true, reread: true }

/** Une mission en Implémentation dans la discussion « sa », à deux groupes, l'auto allumé. */
const auto = (): Board => {
  const run: Run = { ...newRun('implement', T0, 'Boutique'), owner: 'sa' }
  const board: Board = { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
  const lot = applyReport(board, { tickets: [{ id: 't1', name: 'Un' }, { id: 't2', name: 'Deux' }], groups: [{ id: 'A', name: 'Code', tickets: ['t1'] }, { id: 'B', name: 'Données', tickets: ['t2'] }] }, T0 + 1).board
  return switchOnAuto(lot, 'sa', T0 + 2)!.board
}
const decide = (board: Board, decided: { what: string; why?: string; origin?: string }[], now: number): Board => applyReport(board, { decided }, now, { autonomy: ALL }).board
const facts = (board: Board, file?: string): string[] => reportFacts(board.runs[0]!, 0, file)

/** Les lignes des choix avec le fichier des choix : la ligne des comptes, puis ses groupes en lignes courtes. */
const choiceBlock = (lines: string[]) => {
  const start = lines.findIndex(l => l.includes('choices reported as made without the user'))
  const end = lines.findIndex((l, i) => i > start && !l.startsWith('  '))
  return lines.slice(start, end < 0 ? undefined : end)
}

test('la marque d’un choix de réglage, en tête ou derrière « Zone sensible : » ; le groupe a le nom validé', () => {
  expect(isSettingDecision('Réglage : Choix d\'expérience : libellé court')).toBe(true)
  expect(isSettingDecision('Zone sensible : Réglage : Invariant d\'un ticket : rien ne s’efface')).toBe(true)
  expect(isSettingDecision('Zone sensible : garder la copie')).toBe(false)
  expect(isSettingDecision('Réglages divers')).toBe(false)
  expect(SETTING_GROUP).toBe('Tranché par réglage')
})

test('avec le fichier des choix : les choix de réglage comptés à part et rangés dans « Tranché par réglage », après la zone sensible', () => {
  const board = decide(
    auto(),
    [
      { what: 'Zone sensible : garder la copie', why: 'la plus prudente', origin: 'recommendation' },
      { what: 'Réglage : Dépense ou action externe : installer jq', why: 'outil du projet', origin: 'recommendation' },
      { what: 'Option A', origin: 'recommendation' },
    ],
    T0 + 3,
  )
  const block = choiceBlock(facts(board, '/f.md'))
  expect(block[0]).toContain('1 of them sensitive (their text starts with « Zone sensible : », not followed by « Réglage : »), 1 settled by an autonomy box (their text starts with « Réglage : », or « Zone sensible : Réglage : »)')
  expect(block[0]).toContain('The ones settled by an autonomy box go next and apart, under « Tranché par réglage » (right after « Zone sensible, tranché en auto »), and nowhere else: for each, copy the whole question and the options set aside, read in the mission\'s decision file at its entry « acceptée par réglage (<box>) ».')
  expect(block.slice(1)).toEqual([
    '  - « Zone sensible, tranché en auto » (1):',
    '    - Zone sensible : garder la copie — la plus prudente',
    '  - « Tranché par réglage » (1):',
    '    - Réglage : Dépense ou action externe : installer jq — outil du projet',
    '  - « Reco prise » (1):',
    '    - Option A',
  ])
})

test('un choix « Zone sensible : Réglage : … » n’est rangé que dans « Tranché par réglage » ; les autres groupes gardent leur ordre et leur plafond', () => {
  const sensitiveSetting = 'Zone sensible : Réglage : Invariant d\'un ticket : rien ne s’efface sans copie'
  const many = Array.from({ length: 13 }, (_, i) => ({ what: `Choix ${i}`, origin: 'recommendation' }))
  const board = decide(auto(), [{ what: sensitiveSetting, origin: 'recommendation' }, { what: 'Zone sensible : garder la copie', origin: 'recommendation' }, ...many, { what: 'Spec validée', origin: 'skipped-validation' }], T0 + 3)
  const block = choiceBlock(facts(board, '/f.md'))
  expect(block[0]).toContain('1 of them sensitive (their text starts with « Zone sensible : », not followed by « Réglage : »)')
  expect(block.filter(l => l.includes(sensitiveSetting))).toEqual([`    - ${sensitiveSetting}`])
  expect(block.filter(l => l.startsWith('  - «'))).toEqual(['  - « Zone sensible, tranché en auto » (1):', '  - « Tranché par réglage » (1):', '  - « Reco prise » (13):', '  - « Validation sautée » (1):'])
  expect(block).toContain('    - et 1 autres : /f.md')
  expect(block.indexOf(`    - ${sensitiveSetting}`)).toBe(block.indexOf('  - « Tranché par réglage » (1):') + 1)
})

test('sans fichier des choix : une ligne à part pour les choix de réglage, avec la consigne de la question entière', () => {
  const board = decide(auto(), [{ what: 'Zone sensible : Réglage : Choix d\'expérience : bouton « Valider »', why: 'le plus clair', origin: 'recommendation' }, { what: 'Zone sensible : garder la copie', origin: 'recommendation' }], T0 + 3)
  const lines = facts(board)
  const sensitive = lines.find(l => l.startsWith('- Sensitive choices settled in auto'))!
  expect(sensitive).toContain('(1)')
  expect(sensitive).not.toContain('Réglage :')
  const settings = lines.find(l => l.startsWith('- Choices settled by an autonomy box'))!
  expect(settings).toContain('(1): The ones settled by an autonomy box go next and apart, under « Tranché par réglage »')
  expect(settings).toContain('« acceptée par réglage (<box>) »')
  expect(settings).toContain('Zone sensible : Réglage : Choix d\'expérience : bouton « Valider » (because le plus clair)')
})

test('sans aucun choix « Réglage : » : rien du groupe des cases, avec ou sans fichier des choix', () => {
  const board = decide(auto(), [{ what: 'Zone sensible : garder la copie', origin: 'recommendation' }, { what: 'Option A', origin: 'recommendation' }], T0 + 3)
  for (const lines of [facts(board, '/f.md'), facts(board)]) {
    const text = lines.join('\n')
    expect(text).not.toContain('Tranché par réglage')
    expect(text).not.toContain('autonomy box')
  }
})
