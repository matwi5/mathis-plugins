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

/** Une mission en cours, sans rapport validé, active jusqu'à maintenant (sa dernière activité suit les commits). */
const unfinished = (title: string, startedAt: number, extra: Partial<Run> = {}): Run =>
  ({ ...newRun('implement', startedAt, title), status: 'active', owner: 'session-B', updatedAt: NOW, ...extra }) as Run

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

test('une mission active sans activité depuis le plus ancien des commits à livrer n’est plus à attendre', () => {
  const commits = [NOW - 100_000, NOW - 50_000]
  // Restée active au nom d'une discussion fermée : sa dernière activité précède le plus ancien commit.
  const idle = unfinished('Oubliée', NOW - 900_000, { updatedAt: NOW - 100_001 } as Partial<Run>)
  expect(deliveryWaits([idle], commits, true)).toEqual({ groups: [], commits: [] })
  // L'ordre des commits ne compte pas : le plus ancien est cherché.
  expect(deliveryWaits([idle], [NOW - 50_000, NOW - 100_000], true)).toEqual({ groups: [], commits: [] })
})

test('un aperçu coupé aux plus récents commits (PREVIEW_MAX) ne fait écarter aucune mission inactive : le comportement d’avant', () => {
  // Plus de commits à livrer que l'aperçu n'en montre : son plus ancien n'est pas celui de la livraison, et des commits
  // plus anciens de la mission inactive partent aussi.
  const idle = unfinished('Oubliée', NOW - 900_000, { updatedAt: NOW - 100_001 } as Partial<Run>)
  expect(deliveryWaits([idle], [NOW - 100_000, NOW - 50_000], false)).toEqual({ groups: [], commits: ['Oubliée'] })
  // Sans le drapeau (un appel d'avant) : de même.
  expect(deliveryWaits([idle], [NOW - 100_000, NOW - 50_000])).toEqual({ groups: [], commits: ['Oubliée'] })
})

test('une mission active dont la dernière activité suit au moins un commit à livrer reste à attendre', () => {
  // Activité au moment même du plus ancien commit, ou entre deux commits : signalée, comme aujourd'hui.
  for (const updatedAt of [NOW - 100_000, NOW - 75_000]) {
    const busy = unfinished('Active', NOW - 900_000, { updatedAt } as Partial<Run>)
    expect(deliveryWaits([busy], [NOW - 100_000, NOW - 50_000], true)).toEqual({ groups: [], commits: ['Active'] })
  }
})

test('une mission à groupes confiés reste à attendre quel que soit sa dernière activité', () => {
  const idle = withDelegatedGroup(unfinished('Mission G', NOW - 900_000, { updatedAt: NOW - 800_000 } as Partial<Run>))
  expect(deliveryWaits([idle], [NOW - 100_000], true)).toEqual({ groups: ['Mission G'], commits: [] })
})

test('sans commit à livrer, ou une date illisible : le comportement d’avant', () => {
  const idle = unfinished('Oubliée', NOW - 900_000, { updatedAt: NOW - 800_000 } as Partial<Run>)
  // Sans commit : aucune mission « aux commits », comme avant.
  expect(deliveryWaits([idle], [], true)).toEqual({ groups: [], commits: [] })
  // updatedAt illisible : comptée comme avant, sur sa seule fenêtre.
  for (const updatedAt of [undefined, Number.NaN, -1, '12' as unknown as number]) {
    const odd = unfinished('Illisible', NOW - 900_000, { updatedAt } as Partial<Run>)
    expect(deliveryWaits([odd], [NOW - 100_000], true)).toEqual({ groups: [], commits: ['Illisible'] })
  }
  // Aucune date de commit lisible : pas de plus ancien commit, comptée comme avant sur sa fenêtre (rien n'y tombe).
  expect(deliveryWaits([idle], [Number.NaN], true)).toEqual({ groups: [], commits: [] })
  // Une date illisible à côté d'une lisible : le plus ancien commit lisible compte.
  expect(deliveryWaits([idle], [Number.NaN, NOW - 100_000], true)).toEqual({ groups: [], commits: [] })
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
