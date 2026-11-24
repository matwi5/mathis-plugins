// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { applyCardChange, keepsAllButRanks, orderWriteWhyEn, parseCardsOrder } from '../hooks/cards-list.ts'
import { cardsInOrder } from '../hooks/coo-view.tsx'
import { CARDS_ORDER_MAX, parseCard, pistesCard, soundCard, type LaunchCard } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { retroCard } from '../hooks/retro-coo.ts'
import { TOOL_SCHEMA } from '../hooks/tool-schema.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { allTexts, findAllAny, pressAny } from './page-coo.ts'
import { storageMode } from './stockage.ts'

// Le rang d'une carte et l'envoi de l'ordre. Invariant : « Les entrées qu'une carte de lancement porte et son rang ne
// changent que par un envoi du COO qui vise cette carte ou l'ordre des cartes ; aucune autre écriture de la liste (un
// lancement, un changement de départ, le retrait d'une autre carte, un changement de siège) ne les retire ni ne les
// change. » L'envoi de l'ordre tient aussi celui de la liste : « Une écriture n'y fait jamais disparaître ni revenir une
// carte qu'elle ne visait pas ».

const NOW = 990_000_000
const MIN = 60_000
const PROJECT = 'sans-projet-811c9dc5'
const LIST = `flow-board/coordination/${PROJECT}.cartes.json`
const KEY = 'coo-cards:'
const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'manual', effort: 'high', folder: 'export-csv', goal: 'Objectif de test.' }
const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
// La réponse à un envoi de l'ordre, sans le rappel que l'outil ajoute à tout envoi de `coordinate` (« The rest of this call was not read … »).
const order = async ($: any, ids: unknown): Promise<string> => (await call($, { coordinate: { order: ids } })).replace(/ The rest of this call was not read[\s\S]*$/, '')
const statement = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))

const listPath = (w: World): string | undefined => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${LIST}`))
const listText = (w: World): string | undefined => {
  if (storageMode() === 'fichier') return w.files[listPath(w) ?? LIST]
  const kept = w.mem[KEY]
  return kept === undefined ? undefined : typeof kept === 'string' ? kept : JSON.stringify(kept)
}
const listOf = (w: World): any[] => JSON.parse(listText(w) ?? '{"cards":[]}').cards
const rawOf = (w: World, id: string): any => listOf(w).find(c => c?.id === id)
const putCards = (w: World, cards: unknown[]) => {
  const text = JSON.stringify({ v: 2, root: '', cards })
  w.files[LIST] = text
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/${LIST}`)) w.files[k] = text
  w.mem[KEY] = JSON.parse(text)
}

const card = (id: string, over: Record<string, unknown> = {}): LaunchCard => {
  const parsed = parseCard({ ...CARD, title: `Carte ${id}`, folder: `dossier-${id}` }, NOW - 30 * MIN, id)
  if ('refused' in parsed) throw new Error(parsed.refused)
  return { ...parsed.card, ...over } as LaunchCard
}
// La mission née d'une carte : un titre à elle, que les lignes « Carte … » de la vue ne confondent pas avec une carte.
const runOf = (c: LaunchCard): Run => ({ ...newRun('grill-with-docs', NOW - 20 * MIN, `Mission ${c.id}`), launch: { id: 'labcdefgh12', card: c.id, at: NOW - 25 * MIN, folder: c.folder, start: 'grill-with-docs', mode: 'manual' } } as Run)
const A = card('kcartea01', { entries: ['I1', 'R2'] })
const B = card('kcarteb01')
const C = card('kcartec01')
const ODD = { id: 'kbad0001', title: 5, note: 'hors forme' }

const cooHere = async ($: any, on: any, cards: unknown[], runs: Run[] = []) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  putCards(w, cards)
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  return { clock, w }
}
/** Les titres des cartes montrées sous « Au départ », dans l'ordre, avec ce qui les précède sur leur ligne. */
const shownLines = async ($: any): Promise<string[]> => {
  const ui = await pane($)
  const texts = await allTexts(ui)
  await ui.unmount()
  // La place s'écrit avec une espace insécable (NB de la vue), ramenée ici à une espace simple.
  return texts.split('\n').map(t => t.replace(/\u00a0/g, ' ')).filter(t => /^Carte k/.test(t) || /^\d+ ·$/.test(t))
}

// ─── Le module pur ────────────────────────────────────────────────────────

test('ranger : le rang 1 à n des cartes nommées, retiré des autres ; une entrée hors forme et un rang hors forme non nommé restent tels quels', () => {
  const list = [{ ...A, rank: 2 }, ODD, B, { ...C, rank: 7 }, { ...card('kcarted01'), rank: '3' }]
  const out = applyCardChange(list, { kind: 'rank', ids: [B.id, A.id] })!
  expect(out.list).toEqual([{ ...A, rank: 2 }, ODD, { ...B, rank: 1 }, C, { ...card('kcarted01'), rank: '3' }])
  expect(out.changed.sort()).toEqual([B.id, C.id].sort())
  expect(keepsAllButRanks(list, out.list)).toBe(true)
  // Le même ordre renvoyé ne change rien.
  expect(applyCardChange(out.list, { kind: 'rank', ids: [B.id, A.id] })!.changed).toEqual([])
})

test('la garde propre de l’envoi de l’ordre refuse une carte changée autrement que par son rang, une carte de plus ou de moins, un autre ordre', () => {
  const before = [A, B]
  expect(keepsAllButRanks(before, [{ ...A, rank: 1 }, B])).toBe(true)
  expect(keepsAllButRanks(before, [{ ...A, rank: 1, title: 'Autre' }, B])).toBe(false)
  expect(keepsAllButRanks(before, [{ ...A, rank: 1, entries: ['I1'] }, B])).toBe(false)
  expect(keepsAllButRanks(before, [{ ...A, rank: 1 }])).toBe(false)
  expect(keepsAllButRanks(before, [A, B, C])).toBe(false)
  expect(keepsAllButRanks(before, [B, A])).toBe(false)
})

test('une carte que put ou set réécrit garde le rang de la carte relue à l’écriture, jamais celui de la carte lue plus tôt', () => {
  const list = [{ ...A, rank: 2 }, B]
  const set = applyCardChange(list, { kind: 'set', id: A.id, card: { ...A, start: 'to-spec', rank: 5 } })!
  expect(set.list[0]).toEqual({ ...A, start: 'to-spec', rank: 2 })
  const put = applyCardChange(list, { kind: 'put', cards: [{ ...B, title: 'Neuve', rank: 3 }] })!
  expect(put.list.at(-1)).toEqual({ ...B, title: 'Neuve' })
  const kept = applyCardChange(list, { kind: 'put', cards: [{ ...A, title: 'Neuve' }] })!
  expect(kept.list.at(-1)).toEqual({ ...A, title: 'Neuve', rank: 2 })
})

test('l’ordre refusé en entier, chaque id en cause nommé : pas une liste, vide, plus de 200, hors forme, répété, absent, rétro ou pistes, lancé', () => {
  const retro = retroCard({ ...newRun('prototype', NOW - 10 * MIN, 'Mission close'), status: 'done', finishedAt: NOW - MIN }, null, NOW)
  const pistes = pistesCard('kpistes01', NOW)
  const cards = [A, B, C, retro, pistes]
  const parse = (raw: unknown) => parseCardsOrder(raw, cards, c => c.id === C.id)
  expect(parse('kcartea01')).toEqual({ refused: expect.stringMatching(/"order" must be the list/) })
  expect(parse([])).toEqual({ refused: expect.stringMatching(/"order" is empty/) })
  expect(parse(Array.from({ length: 201 }, () => A.id))).toEqual({ refused: expect.stringMatching(/200 ids at most; this one has 201/) })
  expect(parse([A.id, 'k/../x', A.id, 'kabsent01', retro.id, pistes.id, C.id])).toEqual({
    refused: `"k/../x" is not a card id; ${A.id} is repeated; kabsent01 is not a card of the list; ${retro.id} is a retro or « Pistes de rétro » card, which has no rank; ${pistes.id} is a retro or « Pistes de rétro » card, which has no rank; ${C.id} is already launched. Nothing is written`,
  })
  expect(parse([B.id, A.id])).toEqual({ ids: [B.id, A.id] })
})

test('un rang relu hors forme se lit sans rang, la carte reste en forme ; une rétro ou des pistes n’en ont jamais ; un rang donné par le COO est ignoré', () => {
  for (const rank of [0, -1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 2]) expect(soundCard({ ...B, rank })).toEqual(B)
  expect(soundCard({ ...B, rank: 3 })).toEqual({ ...B, rank: 3 })
  // Un entier au-delà de la borne d'un envoi reste un rang : relu, et gardé par une réécriture de la carte.
  expect(soundCard({ ...B, rank: CARDS_ORDER_MAX + 50 })).toEqual({ ...B, rank: CARDS_ORDER_MAX + 50 })
  const big = applyCardChange([{ ...B, rank: CARDS_ORDER_MAX + 50 }], { kind: 'set', id: B.id, card: { ...B, start: 'to-spec' } as LaunchCard })!
  expect(big.list).toEqual([{ ...B, start: 'to-spec', rank: CARDS_ORDER_MAX + 50 }])
  expect(soundCard({ ...pistesCard('kpistes01', NOW), rank: 1 })?.rank).toBeUndefined()
  const posed = parseCard({ ...CARD, rank: 1 }, NOW, 'kabcdef12')
  expect('card' in posed && posed.card).toEqual(card('kabcdef12', { title: CARD.title, folder: CARD.folder, at: NOW }))
})

test('l’affichage : par rang croissant, deux rangs égaux départagés par la liste, puis les cartes sans rang dans l’ordre de la liste', () => {
  const cards = [{ id: 'a' }, { id: 'b', rank: 3 }, { id: 'c', rank: 1 }, { id: 'd' }, { id: 'e', rank: 3 }]
  expect(cardsInOrder(cards).map(c => c.id)).toEqual(['c', 'b', 'e', 'a', 'd'])
})

// ─── L'envoi de l'ordre chez le COO ───────────────────────────────────────

test('un envoi valide écrit le rang 1 à n en une écriture ; la liste relue ne diffère que par les rangs ; la réponse nomme les cartes sans rang ; la vue et le relevé les montrent', { timeoutMs: 30000 }, async ($, on) => {
  const launched = card('klancee01', { rank: 1 })
  const { w } = await cooHere($, on, [A, ODD, B, { ...C, rank: 1 }, launched], [runOf(launched)])
  const before = listOf(w)
  const answer = await order($, [B.id, A.id])
  expect(answer).toBe(`Order of the launch cards written: 1 ${B.id}, 2 ${A.id}. Without a rank now: ${C.id}.`)
  const after = listOf(w)
  expect(keepsAllButRanks(before, after)).toBe(true)
  expect(after.map(c => c?.rank)).toEqual([2, undefined, 1, undefined, undefined])
  expect(rawOf(w, A.id).entries).toEqual(['I1', 'R2'])
  expect(await shownLines($)).toEqual(['1 ·', `Carte ${B.id}`, '2 ·', `Carte ${A.id}`, `Carte ${C.id}`])
  const said = await statement($)
  expect(said).toContain(`« ${B.id} » « Carte ${B.id} »: start /grill-with-docs, mode manual, effort high, folder travail/dossier-${B.id}/, rank 1, ready.`)
  expect(said).toContain(`folder travail/dossier-${A.id}/, rank 2, covers 2 entries I1, R2, ready.`)
})

test('l’ordre va seul dans son appel ; « Nothing to coordinate » le liste ; un refus n’écrit rien ; une carte en lancement se range', { timeoutMs: 30000 }, async ($, on) => {
  const launching = card('klance001', { launch: { id: 'lxyzabc123', at: NOW - MIN, mode: 'manual' } })
  const { w } = await cooHere($, on, [A, B, launching])
  const before = listText(w)
  expect(await call($, { coordinate: { order: [A.id], decisionsSeen: true } })).toMatch(/^Refused, nothing of this call applied: send "order" alone in its call/)
  expect(await call($, { coordinate: {} })).toMatch(/\{"order": \["<card id>", …\]\}/)
  // La description de `coordinate` dans l'outil flow dit la clé, seule dans son appel, et sa forme.
  const coordinate = (TOOL_SCHEMA.properties as any).coordinate
  expect(coordinate.description).toContain('"order": alone, the ready card ids by priority.')
  expect(coordinate.properties.order).toEqual({ type: 'array', items: { type: 'string' } })
  expect(await order($, [A.id, A.id])).toMatch(/^Order refused: kcartea01 is repeated\. Nothing is written\.$/)
  expect(await order($, [])).toMatch(/^Order refused: "order" is empty/)
  expect(listText(w)).toBe(before)
  expect(await order($, [launching.id, A.id])).toMatch(/^Order of the launch cards written: 1 klance001, 2 kcartea01\. Without a rank now: kcarteb01\.$/)
  expect(rawOf(w, launching.id)).toMatchObject({ rank: 1, launch: { id: 'lxyzabc123' } })
  // Renvoyé tel quel : rien ne change, et la réponse le dit.
  expect(await order($, [launching.id, A.id])).toMatch(/^Order of the launch cards unchanged/)
})

test('une carte nommée retirée entre la lecture et l’écriture : rien n’est écrit, la réponse dit de renvoyer l’ordre', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await cooHere($, on, [A, B])
  let reads = 0
  // La seconde lecture du siège est celle de l'écriture : juste avant, une autre écriture retire B.
  w.probe.onBoardRead = () => {
    if (++reads === 2) putCards(w, [A])
  }
  expect(await order($, [B.id, A.id])).toBe('Nothing is written: a card of the order was launched or removed meanwhile; send the order again.')
  w.probe.onBoardRead = undefined
  expect(listOf(w)).toEqual(JSON.parse(JSON.stringify([A])))
})

test('une carte nommée lancée entre la lecture et l’écriture : rien n’est écrit', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await cooHere($, on, [A, B])
  let reads = 0
  w.probe.onBoardRead = () => {
    if (++reads === 2) writeBoard(w, b => ({ ...b, runs: [runOf(B)] }))
  }
  expect(await order($, [B.id, A.id])).toBe('Nothing is written: a card of the order was launched or removed meanwhile; send the order again.')
  w.probe.onBoardRead = undefined
  expect(listOf(w).map(c => c.rank)).toEqual([undefined, undefined])
})

test('une carte nommée lancée juste avant l’écriture, après la lecture du siège qui la prépare : rien n’est écrit', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await cooHere($, on, [A, B])
  let reads = 0
  // La troisième lecture du siège est la dernière avant l'écriture : la mission de B n'est que dans le fichier des
  // missions, la liste des cartes ne change pas.
  w.probe.onBoardRead = () => {
    if (++reads === 3) writeBoard(w, b => ({ ...b, runs: [runOf(B)] }))
  }
  expect(await order($, [B.id, A.id])).toBe('Nothing is written: a card of the order was launched or removed meanwhile; send the order again.')
  w.probe.onBoardRead = undefined
  expect(reads).toBeGreaterThanOrEqual(3)
  expect(listOf(w).map(c => c.rank)).toEqual([undefined, undefined])
})

test('une liste changée juste avant l’écriture : rien n’est écrit, et la réponse dit de renvoyer l’ordre, jamais une carte', { timeoutMs: 30000 }, async ($, on) => {
  const D = card('kcarted01')
  const { w } = await cooHere($, on, [A, B])
  let reads = 0
  // Une autre écriture pose D juste avant la dernière relecture de la liste : l'écriture de l'ordre s'arrête.
  w.probe.onBoardRead = () => {
    if (++reads === 3) putCards(w, [A, B, D])
  }
  expect(await order($, [B.id, A.id])).toBe('Nothing is written: the list of cards changed meanwhile; send the order again.')
  w.probe.onBoardRead = undefined
  expect(listOf(w).map(c => c.rank)).toEqual([undefined, undefined, undefined])
  // Les autres refus d'écriture propres à l'ordre disent aussi de renvoyer l'ordre, ou ce que la garde a refusé.
  expect(orderWriteWhyEn('unmarked')).toMatch(/send the order again in a moment\.$/)
  expect(orderWriteWhyEn('refused')).toBe('the write would have changed more than the ranks of the cards.')
  for (const state of ['changed', 'unmarked', 'refused'] as const) expect(orderWriteWhyEn(state)).not.toMatch(/propose the card/)
})

test('une mise à jour par le COO, un changement de départ, un clic de lancement réussi puis défait gardent le rang', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await cooHere($, on, [card('kcartea01', { folder: CARD.folder, title: CARD.title }), B])
  expect(await order($, [B.id, A.id])).toMatch(/written/)
  expect(await call($, { card: { ...CARD, title: 'Export CSV, retitré' } })).toMatch(/updated/)
  expect(rawOf(w, A.id)).toMatchObject({ title: 'Export CSV, retitré', rank: 2 })
  let ui = await pane($)
  await pressAny(ui, { key: `coo-card-alt-${B.id}-to-spec` })
  await ui.unmount()
  expect(rawOf(w, B.id)).toMatchObject({ start: 'to-spec', rank: 1 })
  w.probe.refuseStore = key => key.startsWith('coo-launch:')
  ui = await pane($)
  await pressAny(ui, { key: `coo-card-manual-${B.id}` })
  await ui.unmount()
  expect(w.toasts.at(-1)).toBe('◆ Rien n’est lancé : le stockage du tableau de bord refuse l’écriture ; réessaie.')
  expect(rawOf(w, B.id)).toMatchObject({ rank: 1 })
  expect(rawOf(w, B.id).launch).toBeUndefined()
  w.probe.refuseStore = undefined
  ui = await pane($)
  await pressAny(ui, { key: `coo-card-manual-${B.id}` })
  await ui.unmount()
  expect(rawOf(w, B.id)).toMatchObject({ rank: 1, launch: { mode: 'manual' } })
})

test('après le retrait de la carte de rang 2, les places montrées sont 1, 2, 3, sans trou ; une carte au rang hors forme reste montrée, sans rang', { timeoutMs: 30000 }, async ($, on) => {
  const D = card('kcarted01')
  const E = card('kcartee01', { rank: 'deux' })
  const { clock, w } = await cooHere($, on, [A, B, C, D, E])
  expect(await order($, [A.id, B.id, C.id, D.id])).toMatch(/written/)
  expect(await shownLines($)).toEqual(['1 ·', `Carte ${A.id}`, '2 ·', `Carte ${B.id}`, '3 ·', `Carte ${C.id}`, '4 ·', `Carte ${D.id}`, `Carte ${E.id}`])
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-remove-${B.id}` })
  await ui.unmount()
  expect(rawOf(w, B.id)).toBeUndefined()
  expect(listOf(w).map(c => c.rank)).toEqual([1, 3, 4, 'deux'])
  expect(await shownLines($)).toEqual(['1 ·', `Carte ${A.id}`, '2 ·', `Carte ${C.id}`, '3 ·', `Carte ${D.id}`, `Carte ${E.id}`])
  // Puis la carte montrée au rang 2 est lancée : elle n'est plus montrée, et les places restent sans trou.
  writeBoard(w, b => ({ ...b, runs: [runOf(C)] }))
  await settle(clock, 6)
  expect(listOf(w).map(c => c.rank)).toEqual([1, 3, 4, 'deux'])
  expect(await shownLines($)).toEqual(['1 ·', `Carte ${A.id}`, '2 ·', `Carte ${D.id}`, `Carte ${E.id}`])
})

test('des cartes sans rang se montrent dans l’ordre de leur pose, sans place devant leur numéro', { timeoutMs: 30000 }, async ($, on) => {
  await cooHere($, on, [A, B, C])
  expect(await shownLines($)).toEqual([`Carte ${A.id}`, `Carte ${B.id}`, `Carte ${C.id}`])
  const ui = await pane($)
  expect((await findAllAny(ui, { type: 'Text' })).length).toBeGreaterThan(0)
  await ui.unmount()
})
