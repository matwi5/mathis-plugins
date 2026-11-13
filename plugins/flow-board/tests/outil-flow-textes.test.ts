import { expect, test } from 'claude-code/testing'

import { TOOL_DESCRIPTION, TOOL_SCHEMA } from '../hooks/register.tsx'
import { TOOL_SHAPE } from './outil-flow-forme.ts'

// Les textes de l'outil `flow` (sa description et celles des clés de son schéma) sont chargés dans chaque
// discussion et chaque spécialiste de tous les projets : ils restent courts, une explication longue
// renvoyant au document qui la porte. Les raccourcir ne change pas la forme de l'outil (clés, types,
// valeurs admises, champs requis), figée dans `outil-flow-forme.ts`.

/** La forme d'un schéma JSON : tout sauf ses descriptions, les clés d'un objet triées. */
const shapeOf = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(shapeOf)
  if (typeof node !== 'object' || node === null) return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) if (k !== 'description') out[k] = shapeOf(v)
  return out
}

/** Les caractères des descriptions d'un schéma, à toutes les profondeurs. */
const descriptionChars = (node: unknown): number => {
  if (Array.isArray(node)) return node.reduce((n: number, x) => n + descriptionChars(x), 0)
  if (typeof node !== 'object' || node === null) return 0
  return Object.entries(node).reduce((n, [k, v]) => n + (k === 'description' && typeof v === 'string' ? v.length : descriptionChars(v)), 0)
}

/** Les caractères relevés le 06/11/2026, avant le raccourcissement : la description (3 874) et celles des clés (19 523). */
const BEFORE = 3874 + 19523

test('la forme du schéma de l’outil flow ne change pas : clés, types, valeurs admises, champs requis', () => {
  expect(shapeOf(TOOL_SCHEMA)).toEqual(TOOL_SHAPE)
})

test('la description de l’outil flow et celles de ses clés comptent au moins 30 % de caractères de moins qu’avant', () => {
  expect(TOOL_DESCRIPTION.length + descriptionChars(TOOL_SCHEMA)).toBeLessThanOrEqual(Math.floor(BEFORE * 0.7))
})

test('la description de fixed (outil flow, review) ne compte que les constats corrigés par un commit', () => {
  const review = (TOOL_SCHEMA as any).properties.review
  expect(review.properties.fixed.description).toBe('Fixed by a commit, not just noted or documented')
})

test('la description de setAside (outil flow) fait citer l’entrée de la feuille de route ou d’« À reprendre » qui porte déjà le sujet, en 600 caractères au plus', () => {
  const setAside = (TOOL_SCHEMA as any).properties.setAside
  expect(setAside.description).toContain('Check the roadmap and « À reprendre » first: if one holds it, start with its id (« R49: … ») and say what it adds')
  expect(setAside.description.length).toBeLessThanOrEqual(600)
  expect(setAside.items.properties.text.description.length).toBeLessThanOrEqual(600)
})

test('les descriptions de waiting et answered (outil flow) : relire DECISIONS.md avant de poser une question, answered après la réponse écrite là', () => {
  const waiting = (TOOL_SCHEMA as any).properties.waiting
  expect(waiting.description).toContain('Before asking, reread DECISIONS.md: a settled question is not asked again; an answered id never reopens (new question, new id)')
  expect(waiting.items.properties.answered.description).toBe('true once answered (a user\'s answer: once in DECISIONS.md): it leaves the list')
})
