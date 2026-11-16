import { expect, test } from 'claude-code/testing'

import { applyCardChange, keepsCards, parseCardsList } from '../hooks/cards-list.ts'
import { parseCard, type LaunchCard } from '../hooks/launch.ts'

// La forme de la liste des cartes, le changement qu'une écriture y fait et sa garde (fonctions pures). Invariant : « La
// liste des cartes d'un projet n'est écrite que par la discussion qui tient le siège du COO. Une écriture n'y fait jamais
// disparaître ni revenir une carte qu'elle ne visait pas, et une liste qui ne se lit pas n'est jamais réécrite. »

const NOW = 960_000_000
const card = (id: string, over: Partial<LaunchCard> = {}): LaunchCard => {
  const parsed = parseCard({ title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', mode: 'manual', effort: 'high', folder: `dossier-${id}` }, NOW, id)
  if ('refused' in parsed) throw new Error(parsed.refused)
  return { ...parsed.card, ...over }
}
const A = 'kcartea01'
const B = 'kcarteb01'
const C = 'kcartec01'

test('la garde refuse une écriture qui ferait disparaître, revenir ou changer une carte qu’elle ne vise pas ; une entrée hors forme compte comme une autre', () => {
  const bad = { id: 'kbad', title: 5 }
  const before = [card(A), bad, card(B)]
  expect(keepsCards(before, [card(A), bad], new Set([B]))).toBe(true)
  expect(keepsCards(before, [card(A), bad], new Set())).toBe(false)
  expect(keepsCards(before, [card(A), card(B)], new Set())).toBe(false)
  expect(keepsCards(before, [bad, card(A), card(B)], new Set())).toBe(false)
  expect(keepsCards(before, [...before, card(C)], new Set())).toBe(false)
  expect(keepsCards(before, [...before, card(C)], new Set([C]))).toBe(true)
  expect(keepsCards(before, [card(A, { title: 'Autre' }), bad, card(B)], new Set())).toBe(false)
})

test('le changement garde une entrée hors forme à sa place ; sa condition fausse n’écrit rien ; une carte gardée par « keep » reste', () => {
  const bad = { id: 'kbad', title: 5 }
  expect(applyCardChange([card(A), bad], { kind: 'remove', which: c => c.id === A })).toEqual({ list: [bad], changed: [A] })
  expect(applyCardChange([bad, card(A)], { kind: 'set', id: A, card: card(A, { title: 'Réécrite' }) })).toEqual({ list: [bad, card(A, { title: 'Réécrite' })], changed: [A] })
  expect(applyCardChange([bad], { kind: 'add', cards: [card(A)] })).toEqual({ list: [bad, card(A)], changed: [A] })
  expect(applyCardChange([card(A)], { kind: 'add', cards: [card(B)], expect: () => false })).toBeNull()
  const launching = card(A, { launch: { id: 'labcdefgh1', at: NOW, mode: 'manual' } })
  expect(applyCardChange([launching], { kind: 'put', cards: [card(A, { title: 'Neuve' })], keep: c => c.launch !== undefined })).toEqual({ list: [launching], changed: [] })
  expect(applyCardChange([card(A), card(B)], { kind: 'put', cards: [card(A, { title: 'Neuve' })] })).toEqual({ list: [card(B), card(A, { title: 'Neuve' })], changed: [A] })
})

test('une liste se lit seulement à sa version, à la racine de ce projet, ses entrées en liste ; sinon elle est illisible', () => {
  const file = (over: Record<string, unknown>) => JSON.stringify({ v: 1, root: '/p', cards: [card(A)], ...over })
  expect(parseCardsList(file({}), '/p')).toEqual([JSON.parse(JSON.stringify(card(A)))])
  expect(parseCardsList(file({ v: 2 }), '/p')).toBeNull()
  expect(parseCardsList(file({ root: '/autre' }), '/p')).toBeNull()
  expect(parseCardsList(file({ cards: {} }), '/p')).toBeNull()
  expect(parseCardsList('{ pas une liste', '/p')).toBeNull()
  expect(parseCardsList('[]', '/p')).toBeNull()
})
