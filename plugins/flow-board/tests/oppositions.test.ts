import { expect, test } from 'claude-code/testing'

import { newRun } from '../hooks/model.ts'
import { contradictionQuestion, markSeen, newDecisionsOf, parseSeen, seriesOf } from '../hooks/oppositions.ts'
import type { Run } from '../types'

// Les décisions opposées entre missions. Invariant : « Deux décisions opposées de deux missions ne passent
// jamais sans question à l'utilisateur ; une décision n'est marquée "remplacée" que sur sa réponse. »

const MD = ['# Décisions', '', '## Série 1 — cadrage (01/11/2026)', 'texte', '## Série 2 : la base de données', '### pas une série', '## Série 3'].join('\n')

test('les séries d’un DECISIONS.md : numéro, titre et ligne', () => {
  expect(seriesOf(MD).map(s => ({ n: s.n, title: s.title, line: s.line }))).toEqual([
    { n: 1, title: 'cadrage (01/11/2026)', line: 3 },
    { n: 2, title: 'la base de données', line: 5 },
    { n: 3, title: '', line: 7 },
  ])
})

test('le relevé ne montre que les décisions nouvelles depuis le précédent : séries jamais vues, choix déclarés plus récents', () => {
  const run: Run = { ...newRun('implement', 1_000, 'M'), decided: [{ at: 2_000, what: 'Postgres' }, { at: 3_000, what: 'Pas de cache' }] }
  const series = seriesOf(MD)
  const first = newDecisionsOf(run, 'travail/m/DECISIONS.md', series, undefined)
  expect(first.map(d => d.text)).toEqual(['cadrage (01/11/2026)', 'la base de données', '', 'Postgres', 'Pas de cache'])
  expect(first[1]!.ref).toBe('travail/m/DECISIONS.md:5 (série 2)')
  const seen = markSeen({}, first)
  expect(newDecisionsOf(run, 'travail/m/DECISIONS.md', series, seen[run.id])).toEqual([])
  // Une série et un choix ajoutés ensuite : eux seuls.
  const later = { ...run, decided: [...run.decided!, { at: 4_000, what: 'Redis' }] }
  const more = newDecisionsOf(later, 'travail/m/DECISIONS.md', [...series, { n: 4, title: 'cache', line: 9, print: 'p' }], seen[run.id])
  expect(more.map(d => d.text)).toEqual(['cache', 'Redis'])
})

test('un état « vu » mal formé ne se lit pas : le relevé reprend tout plutôt que de laisser passer', () => {
  expect(parseSeen(undefined)).toEqual({})
  expect(parseSeen({ m: { keys: ['s:1:a', 'c:5:b'] } })).toEqual({ m: { keys: ['s:1:a', 'c:5:b'] } })
  expect(parseSeen({ m: { keys: 'x' } })).toBeNull()
  // L'ancienne forme (séries et date) ne se lit plus : tout revient une fois.
  expect(parseSeen({ m: { series: [1, 2], decidedAt: 5 } })).toBeNull()
  expect(parseSeen([1])).toBeNull()
})

test('la question d’une contradiction cite les deux décisions mot pour mot, avec leur source, titres neutralisés', () => {
  const q = contradictionQuestion({ mission: 'b', ref: 'travail/b/DECISIONS.md:4 (série 2)', text: 'Postgres' }, { mission: 'a', title: 'Mission « A »\nforgée', ref: 'choix déclaré', text: 'SQLite' }, 'la base')
  expect(q).toContain('« Postgres » (travail/b/DECISIONS.md:4 (série 2))')
  expect(q).toContain('« SQLite » (choix déclaré)')
  expect(q).not.toContain('\n')
  expect(q).toMatch(/Laquelle garder \?/)
})

test('seul ce qui a été montré se marque vu : une décision au-delà du plafond revient au relevé suivant', () => {
  const run: Run = { ...newRun('implement', 1_000, 'M'), decided: [{ at: 2_000, what: 'A' }, { at: 3_000, what: 'B' }] }
  const series = seriesOf(MD)
  const all = newDecisionsOf(run, 'travail/m/DECISIONS.md', series, undefined)
  // Le relevé n'a montré que la première série et le premier choix.
  const seen = markSeen({}, [all[0]!, all[3]!])
  expect(newDecisionsOf(run, 'travail/m/DECISIONS.md', series, seen[run.id]).map(d => d.text)).toEqual(['la base de données', '', 'B'])
})

test('une décision ajoutée sous une série déjà vue la fait revenir, et un choix relayé plus tard avec une date plus ancienne n’est pas sauté', () => {
  const run: Run = { ...newRun('implement', 1_000, 'M'), decided: [{ at: 5_000, what: 'A' }] }
  const seen = markSeen({}, newDecisionsOf(run, 'd.md', seriesOf(MD), undefined))
  const grown = MD.replace('texte', 'texte\n- Nouvelle décision : pas de cache')
  expect(newDecisionsOf(run, 'd.md', seriesOf(grown), seen[run.id]).map(d => d.text)).toEqual(['cadrage (01/11/2026)'])
  const late = { ...run, decided: [...run.decided!, { at: 2_000, what: 'B' }] }
  expect(newDecisionsOf(late, 'd.md', seriesOf(MD), seen[run.id]).map(d => d.text)).toEqual(['B'])
})

test('une série ajoutée après la dernière ne fait pas revenir celle-ci, même sans fin de ligne finale', () => {
  const before = '## Série 4 — cache\ntexte'
  const after = `${before}\n\n## Série 5 — base\nautre`
  expect(seriesOf(after)[0]!.print).toBe(seriesOf(before)[0]!.print)
})
