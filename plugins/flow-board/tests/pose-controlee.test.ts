// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { entriesRefusal, parseCard, type LaunchCard } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { parseRoadmap } from '../hooks/roadmap.ts'
import type { Run } from '../types'
import { TOOL, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { storageMode } from './stockage.ts'

// La pose d'une carte contrôle ses entrées. Invariant : « Une entrée que le COO donne en posant ou en mettant à jour une
// carte n'y est jamais écrite si la feuille de route relue à l'instant ne la montre pas ouverte, ou si une autre carte
// prête ou en lancement la cite déjà ; et aucune carte sans entrées n'est refusée pour une raison qui ne la refusait pas
// avant. »

const NOW = 990_000_000
const MIN = 60_000
const PROJECT = 'sans-projet-811c9dc5'
const LIST = `flow-board/coordination/${PROJECT}.cartes.json`
const KEY = 'coo-cards:'
const ROADMAP_FILE = `flow-board/coordination/${PROJECT}.feuille-de-route.md`
const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'manual', effort: 'high', folder: 'export-csv', goal: 'Objectif de test.' }
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const idOf = (answer: string): string => /Launch card (k[a-z0-9]+)/.exec(answer)?.[1] ?? ''
/** Sous `$.store`, ce monde n'a pas de dossier de Claude : la feuille de route n'a aucun chemin (absente). */
const isFileMode = storageMode() === 'fichier'

/** Une feuille de route : des lignes « [id] statut » rangées dans leur section par la lettre de l'id. */
const roadmapText = (lines: Record<string, string>): string => {
  const of = (letter: string) =>
    Object.entries(lines)
      .filter(([id]) => id.startsWith(letter))
      .map(([id, status]) => `- [${id}] ${status} · 2026-11-02 · Mathis · entrée ${id}`)
      .join('\n')
  return `# Feuille de route\n\n## Jalons\n## Prochaines étapes\n## Idées\n${of('I')}\n## À reprendre\n${of('R')}\n`
}
const OPEN = { I1: 'à lancer', I2: 'plus tard', R1: 'à décider', R2: 'plus tard', I3: 'à lancer', R3: 'à décider' }

const listPath = (w: World): string | undefined => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${LIST}`))
const listText = (w: World): string | undefined => {
  if (isFileMode) return w.files[listPath(w) ?? LIST]
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
const roadmapPath = (w: World): string => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${ROADMAP_FILE}`)) ?? ROADMAP_FILE

const card = (id: string, over: Record<string, unknown> = {}): LaunchCard => {
  const parsed = parseCard({ ...CARD, title: `Carte ${id}`, folder: `dossier-${id}` }, NOW - 30 * MIN, id)
  if ('refused' in parsed) throw new Error(parsed.refused)
  return { ...parsed.card, ...over } as LaunchCard
}
/** La mission lancée par une carte : la carte est « lancée ». */
const runOf = (c: LaunchCard): Run => ({ ...newRun('grill-with-docs', NOW - 20 * MIN, c.title), launch: { id: 'labcdefgh12', card: c.id, at: NOW - 25 * MIN, folder: c.folder, start: 'grill-with-docs', mode: 'manual' } } as Run)

/** Le COO ouvert ici, le siège pris ; la feuille de route (`roadmap` : son texte, ou rien) et la liste posées avant. */
const cooHere = async ($: any, on: any, roadmap: string | null, cards: unknown[] = [], runs: Run[] = []) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  if (roadmap !== null) w.files[ROADMAP_FILE] = roadmap
  if (cards.length > 0) putCards(w, cards)
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  return { clock, w }
}

// ─── Le module pur ────────────────────────────────────────────────────────

test('le contrôle pur : absente, close, déjà citée par une autre carte ; toutes les entrées en cause nommées ; rien sans entrées', () => {
  const read = parseRoadmap(roadmapText({ ...OPEN, I7: 'devenue mission Export', R7: 'rattachée à M3 - Export' }))
  expect(entriesRefusal([], read, [])).toBeNull()
  expect(entriesRefusal([], null, [])).toBeNull()
  expect(entriesRefusal(['I1', 'I2', 'R1', 'R2'], read, [])).toBeNull()
  const why = entriesRefusal(['I1', 'I9', 'I7', 'R7', 'R3'], read, [card('kautre001', { entries: ['R3'] })])
  expect(why).toBe('I9 is not in the roadmap; I7 is not open (status « devenue mission … »); R7 is not open (status « rattachée à … »); R3 is already cited by the launch card kautre001. Nothing is shown or written; propose the card again without these entries')
  // Une seule entrée, close et citée ailleurs : deux raisons, « this entry » au singulier.
  expect(entriesRefusal(['I7'], read, [card('kautre001', { entries: ['I7'] })])).toMatch(/without this entry$/)
  // Citée par l'idée ou par le titre d'une autre carte.
  expect(entriesRefusal(['I3'], read, [card('kautre001', { idea: 'I3' })])).toMatch(/I3 is already cited by the launch card kautre001/)
  expect(entriesRefusal(['R1'], read, [card('kautre001', { title: 'R1 · reprise' })])).toMatch(/R1 is already cited by the launch card kautre001/)
  expect(entriesRefusal(['I1'], null, [])).toMatch(/^the roadmap does not exist yet, so I1 cannot be seen open\. Nothing is shown/)
  // Feuille illisible : chaque entrée nommée, et celle qu'une autre carte cite déjà, avec cette carte.
  expect(entriesRefusal(['I1', 'R3'], 'unread', [card('kautre001', { entries: ['R3'] })])).toBe(
    'the roadmap cannot be read, so I1, R3 cannot be seen open; R3 is already cited by the launch card kautre001. Nothing is shown or written: a card with "entries" needs the roadmap (a card without them is shown as before)',
  )
  expect(entriesRefusal(['I1'], 'unread', [])).toMatch(/^the roadmap cannot be read/)
  expect(entriesRefusal(['I1'], { ok: false, lineNo: 3, why: 'ligne hors format' }, [])).toMatch(/^the roadmap cannot be read/)
})

test('chaque statut clos est refusé et nommé : idée « devenue mission » ou « écartée », chose à reprendre « rattachée », « lancée », « écartée » ou « faite »', () => {
  const closed = { I4: 'devenue mission Export', I5: 'écartée : doublon', R4: 'rattachée à Export', R5: 'lancée', R6: 'écartée : doublon', R8: 'faite : Export, ticket 3' }
  const read = parseRoadmap(roadmapText(closed))
  const words = { I4: 'devenue mission …', I5: 'écartée …', R4: 'rattachée à …', R5: 'lancée', R6: 'écartée …', R8: 'faite …' } as Record<string, string>
  for (const id of Object.keys(closed)) expect(entriesRefusal([id], read, [])).toMatch(new RegExp(`^${id} is not open \\(status « ${words[id]} »\\)`))
})

// ─── La pose chez le COO ──────────────────────────────────────────────────

test('« plus tard », « à lancer » et « à décider » passent ; une entrée absente ou close fait refuser la carte entière, rien n’est posé', { timeoutMs: 30000 }, async ($, on) => {
  if (!isFileMode) return
  const { w } = await cooHere($, on, roadmapText({ ...OPEN, I7: 'écartée : doublon' }))
  expect(await call($, { card: { ...CARD, entries: ['I1', 'I2', 'R1', 'R2'] } })).toMatch(/shown.*covering 4 entries/)
  expect(listOf(w)).toHaveLength(1)
  const before = listText(w)
  const answer = await call($, { card: { ...CARD, folder: 'autre', entries: ['I3', 'I9', 'I7'] } })
  expect(answer).toContain('No card shown: I9 is not in the roadmap; I7 is not open (status « écartée … »). Nothing is shown or written; propose the card again without these entries.')
  expect(listText(w)).toBe(before)
  // Le geste que dit le refus, rejoué : la carte renvoyée sans les entrées en cause passe, avec la seule entrée gardée.
  const id = idOf(await call($, { card: { ...CARD, folder: 'autre', entries: ['I3'] } }))
  expect(rawOf(w, id).entries).toEqual(['I3'])
  // Une seule entrée en cause, déjà citée par la carte posée juste avant : « this entry » au singulier.
  expect(await call($, { card: { ...CARD, folder: 'troisieme', entries: ['I3'] } })).toMatch(/I3 is already cited by the launch card k[a-z0-9]+\. Nothing is shown or written; propose the card again without this entry\./)
})

test('une entrée déjà citée par une autre carte prête ou en lancement est refusée et la carte nommée ; citée par une carte lancée seulement, elle passe', { timeoutMs: 30000 }, async ($, on) => {
  if (!isFileMode) return
  const ready = card('kprete001', { entries: ['I1'] })
  const launching = card('klance001', { title: 'R1 · reprise', launch: { id: 'lxyzabc123', at: NOW - MIN, mode: 'manual' } })
  const launched = card('kfinie001', { idea: 'I3' })
  const { w } = await cooHere($, on, roadmapText(OPEN), [ready, launching, launched], [runOf(launched)])
  expect(await call($, { card: { ...CARD, entries: ['I1'] } })).toMatch(/^No card shown: I1 is already cited by the launch card kprete001\./)
  expect(await call($, { card: { ...CARD, entries: ['R1'] } })).toMatch(/^No card shown: R1 is already cited by the launch card klance001\./)
  expect(listOf(w)).toHaveLength(3)
  expect(await call($, { card: { ...CARD, entries: ['I3'] } })).toMatch(/shown.*covering 1 entry/)
  expect(listOf(w)).toHaveLength(4)
})

test('une mise à jour qui redonne ses propres entrées passe ; une mise à jour qui n’en dit rien les garde sans les recontrôler, la feuille de route pas relue', { timeoutMs: 30000 }, async ($, on) => {
  if (!isFileMode) return
  const { w } = await cooHere($, on, roadmapText(OPEN))
  const id = idOf(await call($, { card: { ...CARD, entries: ['I1', 'R1'] } }))
  expect(await call($, { card: { ...CARD, title: 'Export CSV, retitré', entries: ['I1', 'R1'] } })).toMatch(/updated.*covering 2 entries/)
  // I1 est close depuis la pose, et la feuille ne se lit plus : une mise à jour muette sur les entrées passe, et les garde.
  w.files[roadmapPath(w)] = roadmapText({ ...OPEN, I1: 'devenue mission Export' })
  let roadmapReads = 0
  w.probe.refuseRead = key => {
    if (key.endsWith(ROADMAP_FILE)) roadmapReads++
    return key.endsWith(ROADMAP_FILE)
  }
  const before = roadmapReads
  expect(await call($, { card: { ...CARD, title: 'Export CSV, encore' } })).toMatch(/updated.*covering 2 entries/)
  expect(roadmapReads).toBe(before)
  expect(rawOf(w, id)).toMatchObject({ title: 'Export CSV, encore', entries: ['I1', 'R1'] })
  // Donnée de nouveau, la même entrée close fait refuser la mise à jour.
  w.probe.refuseRead = undefined
  expect(await call($, { card: { ...CARD, entries: ['I1', 'R1'] } })).toMatch(/^No card shown: I1 is not open \(status « devenue mission … »\)/)
  expect(rawOf(w, id).title).toBe('Export CSV, encore')
})

test('une feuille de route absente, illisible ou hors format : une carte avec des entrées est refusée et la réponse le dit ; une carte sans entrées se pose comme avant', { timeoutMs: 40000 }, async ($, on) => {
  const { w } = await cooHere($, on, null)
  expect(await call($, { card: { ...CARD, entries: ['I1'] } })).toMatch(/^No card shown: the roadmap does not exist yet/)
  expect(listOf(w)).toEqual([])
  expect(await call($, { card: CARD })).toMatch(/Launch card k[a-z0-9]+ shown/)
  expect(listOf(w)).toHaveLength(1)
  if (!isFileMode) return
  w.files[roadmapPath(w)] = '# Feuille de route\n\n## Idées\n- une ligne hors format\n'
  expect(await call($, { card: { ...CARD, folder: 'autre', entries: ['I1'] } })).toMatch(/^No card shown: the roadmap cannot be read/)
  w.files[roadmapPath(w)] = roadmapText(OPEN)
  w.probe.refuseRead = key => key.endsWith(ROADMAP_FILE)
  expect(await call($, { card: { ...CARD, folder: 'autre', entries: ['I1'] } })).toMatch(/^No card shown: the roadmap cannot be read/)
  expect(await call($, { card: { ...CARD, folder: 'autre' } })).toMatch(/Launch card k[a-z0-9]+ shown/)
  expect(listOf(w)).toHaveLength(2)
})

test('une carte posée par un autre envoi entre le contrôle et l’écriture, qui cite la même entrée, fait échouer l’écriture : rien n’est posé', { timeoutMs: 30000 }, async ($, on) => {
  if (!isFileMode) return
  const { w } = await cooHere($, on, roadmapText(OPEN))
  const other = card('kautre001', { entries: ['I1'] })
  // Juste après la lecture de la feuille de route par la pose (son contrôle), une autre carte qui cite I1 est écrite.
  w.probe.refuseRead = key => {
    if (key.endsWith(ROADMAP_FILE) && rawOf(w, other.id) === undefined) putCards(w, [...listOf(w), other])
    return false
  }
  expect(await call($, { card: { ...CARD, entries: ['I1'] } })).toContain('No card shown: the list of cards changed meanwhile; propose the card again.')
  expect(listOf(w).map(c => c.id)).toEqual([other.id])
})
