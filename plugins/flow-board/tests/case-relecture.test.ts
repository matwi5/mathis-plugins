// La case d'autonomie « Relecture après la fusion » : en auto, un groupe rendu qui a changé un fichier chargé dans toutes
// les sessions (règles communes, CLAUDE.md) se fusionne après le choix « Réglage : Relecture après la fusion : <fichier> »
// quand la case est cochée, ses phrases gardées pour le compte rendu ; décochée (ou illisible), une question bloquante sur ce
// seul groupe avant la fusion. La demande de découpage des pistes et leur brief disent les deux cas en auto ; hors auto,
// leurs textes d'avant, mot pour mot.

import { expect, test } from 'claude-code/testing'

import { AFTER_MERGE_FR, autoNote, autoRereadLine } from '../hooks/auto-consignes.ts'
import type { AutonomyCases } from '../hooks/autonomy-setting.ts'
import { currentPhase } from '../hooks/basics.ts'
import { coachingNote, splitRequest } from '../hooks/decoupage.ts'
import { applyReport, emptyBoard, newRun, openQuestions, switchOnAuto } from '../hooks/model.ts'
import { AFTER_MERGE_EN, pistesBriefText } from '../hooks/pistes-brief.ts'
import { emptyWaitlist, type Piste } from '../hooks/pistes.ts'
import type { Board, Run } from '../types'

const T0 = 1_000_000
const OFF: AutonomyCases = { experience: false, invariant: false, contradiction: false, spend: false, reread: false }
const TICKED = 'the autonomy box « Relecture après la fusion » is ticked, so do not ask'
const UNTICKED = 'the autonomy box « Relecture après la fusion » is not ticked, so before merging it ask a blocking question on that group'

/** Une mission en Implémentation à deux groupes dans « sa » ; l'auto allumé ou non. */
const lot = (isAuto: boolean): Board => {
  const run: Run = { ...newRun('implement', T0, 'Boutique'), owner: 'sa' }
  const board: Board = { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
  const planned = applyReport(board, { tickets: [{ id: 't1', name: 'Un' }, { id: 't2', name: 'Deux' }], groups: [{ id: 'A', name: 'Règles', tickets: ['t1'] }, { id: 'B', name: 'Code', tickets: ['t2'] }] }, T0 + 1).board
  return isAuto ? switchOnAuto(planned, 'sa', T0 + 2)!.board : planned
}

test('bloc de l’Implémentation d’une mission à groupes : case cochée, déclarer, fusionner, garder les phrases ; décochée ou illisible, une question sur le groupe', () => {
  const run = lot(true).runs[0]!
  const ticked = autoNote('implement', run, { ...OFF, reread: true }).join('\n')
  expect(ticked).toContain(TICKED)
  expect(ticked).toContain('declare {"decided": [{"what": "Réglage : Relecture après la fusion : <the file>"')
  expect(ticked).toContain('keep each sentence added or removed (from the worker\'s report, or the diff of the merge) for the report, under « Phrases fusionnées sans relecture », for the user to reread before the delivery')
  expect(ticked).not.toContain(UNTICKED)
  for (const cases of [OFF, null, { ...OFF, experience: true }]) {
    const unticked = autoNote('implement', run, cases).join('\n')
    expect(unticked).toContain(UNTICKED)
    expect(unticked).toContain('with each sentence added or removed quoted in your message, and merge it only once the user has answered')
    expect(unticked).not.toContain(TICKED)
  }
})

test('un lot sans groupes et les autres phases n’ont pas la ligne de la relecture', () => {
  const plain = { ...newRun('implement', T0, 'Lot'), owner: 'sa' }
  expect(autoNote('implement', plain, { ...OFF, reread: true }).join('\n')).not.toContain('A group back from its worker that changed a file loaded in every session')
  expect(autoNote('to-tickets', lot(true).runs[0]!, { ...OFF, reread: true }).join('\n')).not.toContain('A group back from its worker that changed a file loaded in every session')
})

test('hors auto : la consigne de l’Implémentation n’a pas la ligne de la relecture', () => {
  const run = lot(false).runs[0]!
  const note = coachingNote('implement', run, { isGitHub: false } as any, true)
  expect(note).toContain('Dashboard (flow-board)')
  expect(note).not.toContain('Relecture après la fusion')
})

test('les appels que dicte la ligne de la relecture, rejoués contre le modèle', () => {
  const board = lot(true)
  // Case cochée : le choix tiré du texte, un fichier nommé, gardé ; la case décochée entre-temps, refusé.
  const call = /declare (\{"decided": \[\{"what": "[^"]+", "why": "\.\.\.", "origin": "recommendation"\}\]\})/.exec(autoRereadLine({ ...OFF, reread: true }))![1]!
  const input = JSON.parse(call.replace('<the file>', 'config/rules/flow-board.md')) as { decided: { what: string }[] }
  const kept = applyReport(board, input, T0 + 10, { autonomy: { ...OFF, reread: true } })
  expect((kept.board.runs[0]!.decided ?? []).map(d => d.what)).toEqual(['Réglage : Relecture après la fusion : config/rules/flow-board.md'])
  expect((applyReport(board, input, T0 + 10, { autonomy: OFF }).board.runs[0]!.decided ?? []).length).toBe(0)
  // Case décochée : la question tirée du texte, sur le groupe A, l'ouvre sur ce seul groupe.
  const ask = /\(\{"waiting": \[\{[^)]+\}\]\}\)/.exec(autoRereadLine(OFF))![0]!.slice(1, -1)
  const waiting = JSON.parse(ask.replaceAll('<group id>', 'A').replace('<short>', 'Relire config/rules/flow-board.md avant la fusion')) as { waiting: unknown[] }
  const asked = applyReport(board, waiting, T0 + 10).board
  expect(openQuestions(asked.runs[0]!).map(q => [q.id, q.blocks])).toEqual([['relecture-A', { kind: 'group', id: 'A' }]])
})

const PISTES = [{ id: 'p1', label: 'Règles : une phrase', status: 'todo' as const }]

test('la demande de découpage des pistes : en auto, la relecture avant la fusion ou après elle, case cochée ; hors auto, la phrase d’avant', () => {
  const manual = lot(false).runs[0]!
  const auto = lot(true).runs[0]!
  // Une phase à éléments (celle d'un tri) : la demande ne lit que son skill.
  const phase = (run: Run) => ({ ...currentPhase(run), skill: 'triage' })
  const before = splitRequest(manual, phase(manual), PISTES as any)
  expect(before).toContain('et que je relis avant la fusion. ')
  expect(before).not.toContain(AFTER_MERGE_FR)
  const inAuto = splitRequest(auto, phase(auto), PISTES as any)
  expect(inAuto).toContain(`et que je relis avant la fusion, ou ${AFTER_MERGE_FR}. `)
  expect(inAuto.replace(`, ou ${AFTER_MERGE_FR}`, '')).toBe(before)
})

test('le brief des pistes : lancé en auto, les deux cas ; sinon la phrase d’avant', () => {
  const piste: Piste = { id: 'retroA/p1', retro: 'retroA', text: 'Texte', files: [], state: 'validated', card: 'kpistes01', by: 'retroA', at: 1_000, history: [], comments: [] }
  const got = { state: 'read' as const, list: { ...emptyWaitlist(''), pistes: [piste] } }
  const before = pistesBriefText(got, 'kpistes01', null)
  expect(before).toContain('and the user rereads it before the merge; write no list')
  const inAuto = pistesBriefText(got, 'kpistes01', null, true)
  expect(inAuto).toContain(`and the user rereads it before the merge, or ${AFTER_MERGE_EN}; write no list`)
  expect(inAuto.replace(`, or ${AFTER_MERGE_EN}`, '')).toBe(before)
})
