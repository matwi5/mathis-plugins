// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { closeDelivered, deliveredByCooAt, emptyBoard, newRun, noActiveText, suggestionsFor } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { settle, start, world, writeBoard } from './monde-coordination.ts'

// Le tableau de bord d'une mission livrée par le COO, et plus de « Rétro » nue une fois le rapport validé.

const T0 = 900_000_000
const PLUGIN = 'flow-board'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

/** Une mission au compte rendu (rapport validé ou non), sa phase « Version et push » à faire. */
const atReport = (now: number, isValidated: boolean): Run => {
  const run = newRun('implement', now - 90_000, 'Mission livrée')
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: now - 50_000, finishedAt: now - 40_000, steps: [], items: [] }
  const version = newRun('project:version', run.startedAt, 'v').phases[0]!
  const pending = { ...version, status: 'pending' as const, startedAt: undefined, steps: version.steps.map(s => ({ id: s.id, status: 'pending' as const })) }
  return { ...run, phases: [done, report, pending], cursor: 1, status: 'active', ...(isValidated ? { reportValidatedAt: now - 40_000 } : {}), updatedAt: now - 1_000 } as Run
}

test('les suites d’une mission au rapport validé n’ont plus « Rétro » ; avant la validation, si', () => {
  const before = suggestionsFor(atReport(T0, false))
  expect([before.primary, ...before.others]).toContain('retro')
  const after = suggestionsFor(atReport(T0, true))
  expect([after.primary, ...after.others]).not.toContain('retro')
})

/** La mission close comme livrée par le COO, vue de la discussion où elle est née (`session-M`). */
const deliveredBoard = (now: number): Board => {
  const run = { ...atReport(now, true), status: 'paused' as const, bornIn: 'session-M' }
  const board: Board = { ...emptyBoard('', 'projet'), session: 'session-M', runs: [run] }
  return closeDelivered(board, run.id, now, { version: '0.80.0', push: 'main' })!.board
}

test('la date de la ligne vient du journal « Livrée par le COO » ; sans elle (à la main, ou sortie du journal), rien', () => {
  const board = deliveredBoard(Date.UTC(2026, 10, 8, 12))
  const run = board.runs[0]!
  expect(deliveredByCooAt(run)).toBe(Date.UTC(2026, 10, 8, 12))
  expect(deliveredByCooAt({ ...run, log: run.log.filter(l => !l.text.startsWith('Livrée par le COO')) })).toBeNull()
  // Archivée, ou reprise : plus rien à choisir chez le COO.
  expect(deliveredByCooAt({ ...run, archivedAt: Date.UTC(2026, 10, 9) })).toBeNull()
  expect(deliveredByCooAt({ ...run, status: 'active' })).toBeNull()
  // Reprise, puis livrée de nouveau à la main : la vieille ligne du COO ne vaut plus.
  expect(deliveredByCooAt({ ...run, finishedAt: Date.UTC(2026, 10, 10) })).toBeNull()
})

test('le texte de la discussion sans mission active dit que sa dernière mission est livrée par le COO', () => {
  const board = deliveredBoard(Date.UTC(2026, 10, 8, 12))
  expect(noActiveText(board)).toContain('« Livrée par le COO le 08/11/2026 : rétro ou archivage dans la vue Coordination »')
  // Une autre discussion n'en dit rien.
  expect(noActiveText({ ...board, session: 'session-X' })).not.toContain('Livrée par le COO le')
})

test('la ligne ne renvoie à la vue Coordination que pour ce qu’elle y propose : une rétro, l’archivage seul ; une mission retenue, la date seule', () => {
  const board = deliveredBoard(Date.UTC(2026, 10, 8, 12))
  const run = board.runs[0]!
  const retro = { ...run, phases: [{ ...run.phases[0]!, skill: 'retro' }, ...run.phases.slice(1)] }
  expect(noActiveText({ ...board, runs: [retro] })).toContain('« Livrée par le COO le 08/11/2026 : archivage dans la vue Coordination »')
  // Retenue (ici un id hors forme, que « ✓ Archiver » ne prend pas) : rien à choisir chez le COO.
  const held = { ...run, id: 'id hors forme' }
  expect(noActiveText({ ...board, runs: [held] })).toContain('« Livrée par le COO le 08/11/2026 »')
})

test('l’historique de la discussion montre la ligne, sans bouton', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 8, 13) })
  const w = world(on)
  const board = deliveredBoard(Date.UTC(2026, 10, 8, 12))
  writeBoard(w, x => ({ ...x, runs: board.runs }))
  await start($)
  await settle(clock, 3)
  for (const surface of ['desktop', 'terminal'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await pane.press({ key: 'tab-history' })
    const shown = await texts(pane)
    expect(shown).toContain('Livrée par le COO le 08/11/2026 : rétro ou archivage dans la vue Coordination')
    expect(await pane.find({ type: 'Button', text: /rétro ou archivage/ })).toBeUndefined()
    await pane.unmount()
  }
})
