import { expect, test } from 'claude-code/testing'

import { cooStatement, statementText } from '../hooks/coo.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { deliveryWaits } from '../hooks/delivery.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// « ▶ Livrer » chez le COO : la carte recommande d'attendre les missions pas finies dont des commits
// partiraient. La livraison 0.80.0 avait envoyé les commits d'une mission sans groupes avant que son
// rapport soit validé, sans avertissement : seules les missions à groupes confiés y entraient.

const NOW = 300_000_000

/** Une mission au rapport validé, pas encore close : elle attend sa livraison, sans fin de fenêtre. */
const validated = (title: string, startedAt: number): Run => {
  const run = newRun('implement', startedAt, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: NOW - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: NOW - 50_000, finishedAt: NOW - 40_000, steps: [], items: [] }
  return { ...run, phases: [done, report], cursor: 1, status: 'active', owner: 'session-A', reportValidatedAt: NOW - 40_000 } as Run
}

/** Une mission en cours, sans rapport validé. */
const unfinished = (title: string, startedAt: number, extra: Partial<Run> = {}): Run =>
  ({ ...newRun('implement', startedAt, title), status: 'active', owner: 'session-B', ...extra }) as Run

const withDelegatedGroup = (run: Run): Run =>
  ({ ...run, groups: [{ id: 'A', name: 'Groupe', tickets: [], delegated: { session: 'w1', at: run.startedAt + 1 } }] }) as unknown as Run

test('une mission sans groupes, pas finie, dont un commit part, est à attendre ; les fenêtres partagées comptent', () => {
  // A, validée, n'a pas de fin de fenêtre : le commit de B tombe dans les deux fenêtres.
  const runs = [validated('Mission A', NOW - 500_000), unfinished('Mission B', NOW - 200_000)]
  expect(deliveryWaits(runs, [NOW - 100_000])).toEqual({ groups: [], commits: ['Mission B'] })
  // Aucun commit dans la fenêtre de B : rien à attendre.
  expect(deliveryWaits(runs, [NOW - 300_000])).toEqual({ groups: [], commits: [] })
})

test('une mission au rapport validé, close ou archivée n’est pas à attendre', () => {
  const at = [NOW - 100_000]
  expect(deliveryWaits([validated('Mission A', NOW - 500_000)], at)).toEqual({ groups: [], commits: [] })
  expect(deliveryWaits([unfinished('Close', NOW - 200_000, { status: 'done', finishedAt: NOW - 10_000 } as Partial<Run>)], at)).toEqual({ groups: [], commits: [] })
  expect(deliveryWaits([unfinished('Archivée', NOW - 200_000, { archivedAt: NOW - 5_000 } as Partial<Run>)], at)).toEqual({ groups: [], commits: [] })
})

test('une mission sans groupes mise de côté n’est pas à attendre : sa fenêtre sans fin couvrirait chaque commit', () => {
  const runs = [validated('Mission A', NOW - 500_000), unfinished('En pause', NOW - 900_000, { status: 'paused', owner: undefined } as Partial<Run>)]
  expect(deliveryWaits(runs, [NOW - 100_000])).toEqual({ groups: [], commits: [] })
})

test('une mission à groupes confiés reste à attendre comme avant, même sans commit', () => {
  const runs = [withDelegatedGroup(unfinished('Mission G', NOW - 200_000)), unfinished('Mission B', NOW - 200_000)]
  expect(deliveryWaits(runs, [])).toEqual({ groups: ['Mission G'], commits: [] })
  expect(deliveryWaits(runs, [NOW - 100_000])).toEqual({ groups: ['Mission G'], commits: ['Mission B'] })
})

const board = (...runs: Run[]): Board => ({ ...emptyBoard('/p', 'p'), runs })

const ready = (waitFor: string[], waitCommits: string[]) => ({ state: 'ready' as const, missions: ['Mission A'], commits: [], waitFor, waitCommits, key: 'k', isArmed: false })

const cardText = (waitFor: string[], waitCommits: string[]): string =>
  coordinationRows(cooStatement(board(), { now: NOW, effort: 'high', hasBrief: true, delivery: ready(waitFor, waitCommits) }))
    .filter(r => r.key === 'coo-delivery-wait')
    .map(r => r.parts.map(p => p.text).join(' '))
    .join('\n')

const promptText = (waitFor: string[], waitCommits: string[]): string =>
  statementText(cooStatement(board(), { now: NOW, effort: 'high', hasBrief: true, delivery: ready(waitFor, waitCommits) }))

test('la carte et la consigne du COO disent « des commits partent » pour une mission sans groupes, et gardent leur texte pour une mission à groupes', () => {
  expect(cardText(['Mission G'], [])).toContain('Mieux vaut attendre : « Mission G » pas finie, avec des groupes déjà fusionnés.')
  expect(cardText([], ['Mission B'])).toContain('Mieux vaut attendre : « Mission B » pas finie, des commits partent.')
  expect(cardText(['Mission G'], ['Mission B', 'Mission C'])).toContain('Mieux vaut attendre : « Mission G » pas finie, avec des groupes déjà fusionnés ; « Mission B », « Mission C » pas finies, des commits partent.')
  expect(cardText([], [])).toBe('')
  expect(promptText(['Mission G'], [])).toContain('; recommend waiting: « Mission G » not finished, with groups already merged.')
  expect(promptText([], ['Mission B'])).toContain('; recommend waiting: « Mission B » not finished, its commits leave with this delivery.')
  expect(promptText(['Mission G'], ['Mission B'])).toContain('; recommend waiting: « Mission G » not finished, with groups already merged; « Mission B » not finished, its commits leave with this delivery.')
  expect(promptText([], ['Mission B', 'Mission C'])).toContain('; recommend waiting: « Mission B », « Mission C » not finished, their commits leave with this delivery.')
  expect(promptText([], [])).not.toContain('recommend waiting')
})
