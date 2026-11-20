import { expect, test } from 'claude-code/testing'

import { AUTO_BRIEF_IN_TURN } from '../hooks/auto-consignes.ts'
import { applyReport, emptyBoard, newRun, openQuestions } from '../hooks/model.ts'
import { relayMessage } from '../hooks/oppositions.ts'
import { TOOL_DESCRIPTION, TOOL_SCHEMA } from '../hooks/tool-schema.ts'
import type { Board, Run } from '../types'
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
  // Une obligation du compte rendu décidée par la personne avait été mise de côté au lieu d'être faite.
  expect(setAside.description).toContain('each thing set aside for later or another mission, never work this mission owes (report duties too)')
  expect(setAside.items.properties.text.description.length).toBeLessThanOrEqual(600)
})

test('les descriptions de waiting et answered (outil flow) : relire DECISIONS.md avant de poser une question, answered après la réponse écrite là', () => {
  const waiting = (TOOL_SCHEMA as any).properties.waiting
  expect(waiting.description).toContain('Before asking, reread DECISIONS.md: a settled question is not asked again; an answered id never reopens (new question, new id)')
  // Une réponse partielle (« b et c » sans le libellé) avait fait reposer la question entière sous un id neuf.
  expect(waiting.description).toContain(
    'Partial answer (« b et c », no label): apply it, ask only the rest under a new id (its question, then the quote), never the whole question',
  )
  expect(waiting.items.properties.answered.description).toBe('true once answered (a user\'s answer: once in DECISIONS.md): it leaves the list')
})

// Une réponse relayée par le COO qui ne tranchait qu'une partie d'une question avait fait reposer la question entière.
test('la réponse relayée par le COO : appliquer, retirer, et pour une réponse partielle ne reposer que le reste, sous un id neuf, en citant la réponse', () => {
  const answer = { id: 'c1', kind: 'answer' as const, run: 'r', at: 1, question: 'UI-1', print: 'p', file: 'travail/sujet/DECISIONS.md', series: 7 }
  const text = relayMessage(answer, undefined)
  expect(text).toContain('Relis cette série, applique-la, puis retire la question : {"waiting": [{"id": "UI-1", "answered": true}]}.')
  expect(text).toContain(
    "Si ma réponse ne tranche qu'une partie de la question, applique ce qu'elle tranche et ne pose que ce qui reste, sous un id neuf : son texte commence par la question restante, puis cite ma réponse (« Quel libellé pour la bascule ? Tu as répondu « b et c ». ») ; jamais la question entière.",
  )
  // Un geste (oui ou non d'un clic) tranche toute la question : pas de réponse partielle.
  expect(relayMessage({ id: 'c2', kind: 'gesture', run: 'r', at: 1, question: 'sp-A', print: 'p', answer: 'yes' }, 'spend')).not.toContain('ne tranche qu')
})

// Un gabarit qui mettait la citation avant le « ? » donnait la même phrase de tête aux restes de deux questions différentes :
// le premier reste répondu, le second était refusé.
test('les appels que dicte la réponse partielle, rejoués contre le modèle : la question entière est refusée ; le premier reste répondu, le reste d’une autre question à la même réponse passe, la question restante d’abord', () => {
  const run: Run = { ...newRun('implement', 1_000, 'Économie'), owner: 'sa' }
  const board0: Board = { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
  const ask = (board: Board, waiting: unknown[], now: number) => applyReport(board, { waiting }, now)
  const openIds = (board: Board) => openQuestions(board.runs[0]!).map(q => q.id).sort()
  const UI1 = 'Où mettre la bascule « revue de sécurité » du projet, et avec quel libellé ? (a) barre ; (b) vue du COO ; (c) chaque groupe'
  const UI2 = 'Où mettre le bouton de relance du groupe, et avec quel libellé ? (a) barre ; (b) vue du COO ; (c) chaque groupe'
  const asked = ask(board0, [{ id: 'UI-1', phase: 'implement', text: UI1 }, { id: 'UI-2', phase: 'implement', text: UI2 }], 2_000).board
  // Les deux répondues « b ». UI-1 : son reste posé sous un id neuf, la question restante d'abord, puis répondu.
  const first = ask(asked, [{ id: 'UI-1', answered: true }, { id: 'UI-1b', phase: 'implement', text: 'Quel libellé pour la bascule « revue de sécurité » ? Tu as répondu « b ».' }, { id: 'UI-1c', phase: 'implement', text: UI1 }], 3_000)
  expect(first.text).toContain('"UI-1c" reprend la phrase de tête de "UI-1"')
  const done = ask(first.board, [{ id: 'UI-1b', answered: true }], 4_000).board
  // UI-2 : son reste, de même forme, passe après la réponse au reste de UI-1.
  const second = ask(done, [{ id: 'UI-2', answered: true }, { id: 'UI-2b', phase: 'implement', text: 'Quel libellé pour le bouton de relance du groupe ? Tu as répondu « b ».' }], 5_000)
  expect(openIds(second.board)).toEqual(['UI-2b'])
  // La citation d'abord (« Tu as répondu « b » ; reste le libellé : … ? ») : les deux restes ont la même phrase de tête, le second est refusé.
  const quoteFirst = (what: string) => `Tu as répondu « b » ; reste le libellé : lequel ? (a) ${what}`
  const q1 = ask(ask(asked, [{ id: 'UI-1', answered: true }, { id: 'UI-1b', phase: 'implement', text: quoteFirst('Sécurité') }], 3_000).board, [{ id: 'UI-1b', answered: true }], 4_000).board
  const refused = ask(q1, [{ id: 'UI-2', answered: true }, { id: 'UI-2b', phase: 'implement', text: quoteFirst('Relancer') }], 5_000)
  expect(openIds(refused.board)).toEqual([])
  expect(refused.text).toContain('"UI-2b" reprend la phrase de tête de "UI-1b"')
})

test('le bloc du mode auto qui fait déclarer les questions encore ouvertes en exclut celles déjà répondues ou dont la réponse a été relayée', () => {
  expect(AUTO_BRIEF_IN_TURN).toContain(
    'each question still open (not one the user already answered, nor one whose answer the COO relayed: apply that answer, and if it settles only part of the question, declare only the rest, under a new id, its question first, then the quote of the answer)',
  )
})
