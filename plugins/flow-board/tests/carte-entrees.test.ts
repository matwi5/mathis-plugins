// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { CARD_ENTRIES_MAX, cardEntriesFr, cardRoadmapIds, parseCard, pistesCard, soundCard, withEntries, type LaunchCard, launchText } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { retroCard } from '../hooks/retro-coo.ts'
import { PANE, PLUGIN, TOOL, openCoo, seatOf, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { allTexts, findAny, pressAny } from './page-coo.ts'
import { storageMode } from './stockage.ts'

// Une carte de lancement porte les entrées de la feuille de route qu'elle couvre. Invariant : « Les entrées qu'une carte
// de lancement porte et son rang ne changent que par un envoi du COO qui vise cette carte ou l'ordre des cartes ; aucune
// autre écriture de la liste (un lancement, un changement de départ, le retrait d'une autre carte, un changement de
// siège) ne les retire ni ne les change. » Une valeur hors forme relue n'est pas une entrée : l'ignorer ne le viole pas.

const NOW = 990_000_000
const MIN = 60_000
const PROJECT = 'sans-projet-811c9dc5'
const LIST = `flow-board/coordination/${PROJECT}.cartes.json`
const KEY = 'coo-cards:'
const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'manual', modeWhy: 'cadrage', effort: 'high', effortWhy: 'cadrage', folder: 'export-csv', goal: 'Objectif de test.' }
const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const statement = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
const idOf = (answer: string): string => /Launch card (k[a-z0-9]+)/.exec(answer)?.[1] ?? ''

const listPath = (w: World): string | undefined => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${LIST}`))
const listText = (w: World): string | undefined => {
  if (storageMode() === 'fichier') return w.files[listPath(w) ?? LIST]
  const kept = w.mem[KEY]
  return kept === undefined ? undefined : typeof kept === 'string' ? kept : JSON.stringify(kept)
}
const listOf = (w: World): any[] => JSON.parse(listText(w) ?? '{"cards":[]}').cards
const rawOf = (w: World, id: string): any => listOf(w).find(c => c?.id === id)
/** Pose la liste (des cartes, telles quelles) au fichier et dans le stockage. */
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
const ids = (n: number, letter = 'I') => Array.from({ length: n }, (_, i) => `${letter}${i + 1}`)

/**
 * La feuille de route du poste, où les entrées que ces tests posent sont ouvertes : une pose avec des entrées les y
 * contrôle. Sous `$.store`, ce monde n'a pas de dossier de Claude : la feuille n'a aucun chemin, et une carte avec des
 * entrées est refusée ; les tests qui en posent ne tournent qu'en mode fichier.
 */
const ROADMAP = `# Feuille de route\n\n## Jalons\n## Prochaines étapes\n## Idées\n${['I1', 'I38'].map(id => `- [${id}] à lancer · 2026-11-02 · Mathis · idée ${id}`).join('\n')}\n## À reprendre\n${['R2', 'R9', 'R12', 'R40'].map(id => `- [${id}] à décider · 2026-11-02 · Mathis · chose ${id}`).join('\n')}\n`
const canPoseEntries = storageMode() === 'fichier'

/** Le COO ouvert ici, le siège pris par cette discussion ; la liste posée avant le démarrage. */
const cooHere = async ($: any, on: any, cards?: unknown[], who = 'session-COO', seat?: string) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = who
  w.files[`flow-board/coordination/${PROJECT}.feuille-de-route.md`] = ROADMAP
  if (cards) putCards(w, cards)
  writeBoard(w, b => ({ ...b, runs: [], ...(seat ? { coo: seatOf(seat, NOW - 1000) } : {}) }))
  await start($)
  if (seat) await $.prompt.submit({ text: '/flow-board:coo reprendre', origin: { kind: 'plugin', name: PLUGIN }, command: { name: 'flow-board:coo', args: 'reprendre' } } as any)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  return { clock, w }
}

// ─── Le module pur ────────────────────────────────────────────────────────

test('à la pose, chaque envoi hors forme est refusé avec sa raison : pas une liste, un id hors forme ou d’une autre lettre, plus de 20 ids', () => {
  const refused = (entries: unknown) => parseCard({ ...CARD, entries }, NOW, 'kabcdef12')
  expect(refused('I3')).toEqual({ refused: expect.stringMatching(/"entries" must be a list of roadmap ids/) })
  expect(refused(null)).toEqual({ refused: expect.stringMatching(/"entries" must be a list/) })
  expect(refused({ 0: 'I3' })).toEqual({ refused: expect.stringMatching(/"entries" must be a list/) })
  expect(refused(['I3', 'i4'])).toEqual({ refused: expect.stringMatching(/"i4" is not one/) })
  expect(refused(['I3', 'A12', 5])).toEqual({ refused: expect.stringMatching(/"A12", 5 are not one/) })
  expect(refused(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'])).toEqual({ refused: expect.stringMatching(/"a1", "a2", "a3", "a4", "a5" and 2 more are not one/) })
  // Une valeur répétée n'est nommée qu'une fois ; un caractère invisible ou pleine chasse se voit, échappé.
  expect(refused(['x', 'x', 'x', 'x', 'x', 'y'])).toEqual({ refused: expect.stringMatching(/: "x", "y" are not one/) })
  expect(refused(['I3\u200b'])).toEqual({ refused: expect.stringMatching(/"I3\\u200b" is not one/) })
  expect(refused(['I12345'])).toEqual({ refused: expect.stringMatching(/"I12345" is not one/) })
  expect(refused(ids(CARD_ENTRIES_MAX + 1))).toEqual({ refused: expect.stringMatching(/20 ids at most; this card has 21/) })
  // Sans doublon, la première occurrence gardée : la borne se compte après.
  const twice = parseCard({ ...CARD, entries: ['R2', 'I1', 'R2', ...ids(19)] }, NOW, 'kabcdef12')
  expect('card' in twice && twice.card.entries).toEqual(['R2', 'I1', ...ids(19).slice(1)])
  // Vingt ids passent, dans l'ordre donné ; une liste vide ne s'écrit pas.
  const twenty = parseCard({ ...CARD, entries: ids(20, 'R') }, NOW, 'kabcdef12')
  expect('card' in twenty && twenty.card.entries).toEqual(ids(20, 'R'))
  const none = parseCard({ ...CARD, entries: [] }, NOW, 'kabcdef12')
  expect('card' in none && 'entries' in none.card).toBe(false)
})

test('relue, une carte garde tous ses ids en forme dans leur ordre, sans borne, et ignore le reste ; sans entrées, elle reste exactement la même', () => {
  const kept = soundCard({ ...card('kcarte001'), entries: [5, 'I3', 'A12', 'R7', 'I3', 'x', null, ...ids(30, 'R')] })
  expect(kept?.entries).toEqual(['I3', 'R7', ...ids(30, 'R').filter(i => i !== 'R7')])
  expect(soundCard({ ...card('kcarte001'), entries: 'I3' })).toEqual(card('kcarte001'))
  expect(soundCard({ ...card('kcarte001'), entries: ['A1', 7] })).toEqual(card('kcarte001'))
  expect(soundCard(card('kcarte001'))).toEqual(card('kcarte001'))
})

test('une carte de rétro et une carte « Pistes de rétro » ne portent jamais d’entrées, même relues avec un champ forgé', () => {
  const retro = retroCard({ ...newRun('prototype', NOW - 10 * MIN, 'Mission close'), status: 'done', finishedAt: NOW - MIN }, null, NOW)
  const pistes = pistesCard('kpistes01', NOW)
  // Les deux cartes se relisent (l'effet), sans entrées (l'absence).
  expect(soundCard({ ...retro, entries: ['I3'] })).toEqual(retro)
  expect(soundCard({ ...pistes, entries: ['I3'] })).toEqual(pistes)
  expect(withEntries(pistes, { entries: ['I3'] }, undefined).entries).toBeUndefined()
})

test('une mise à jour : les entrées de l’envoi, celles d’avant quand il n’en dit rien, aucune quand il donne une liste vide', () => {
  const before = card('kcarte001', { entries: ['I1', 'R2'] })
  const fresh = card('kcarte001')
  expect(withEntries(fresh, { ...CARD, entries: ['R9'] }, before).entries).toEqual(['R9'])
  expect(withEntries(fresh, CARD, before).entries).toEqual(['I1', 'R2'])
  expect('entries' in withEntries(fresh, { ...CARD, entries: [] }, before)).toBe(false)
  expect('entries' in withEntries(fresh, CARD, undefined)).toBe(false)
})

test('la ligne sous la carte : « couvre n entrées : » et les 10 premiers ids, puis « … » ; « couvre 1 entrée : » ; rien sans entrées', () => {
  expect(cardEntriesFr({ entries: ids(12) })).toBe('couvre 12 entrées : I1, I2, I3, I4, I5, I6, I7, I8, I9, I10…')
  expect(cardEntriesFr({ entries: ids(10) })).toBe('couvre 10 entrées : I1, I2, I3, I4, I5, I6, I7, I8, I9, I10')
  expect(cardEntriesFr({ entries: ['R4'] })).toBe('couvre 1 entrée : R4')
  expect(cardEntriesFr({})).toBeNull()
})

test('le texte de lancement nomme les entrées de la carte avec les ids de son idée et de son titre, sans doublon', () => {
  const c = card('kcarte001', { idea: 'I7', title: 'R12 · export', entries: ['I38', 'R12', 'I7', 'R40'] })
  expect(cardRoadmapIds(c)).toEqual(['I7', 'R12', 'I38', 'R40'])
  const text = launchText(c, 'labcdefgh12', 'manual', '/mattpocock-skills:grill-with-docs')
  expect(text).toContain('La carte cite I7, R12, I38, R40 de la feuille de route')
})

// ─── La carte chez le COO ─────────────────────────────────────────────────

test('une carte posée avec des entrées les porte dans la liste relue ; la réponse redit leur nombre ; la vue et le relevé les montrent', { timeoutMs: 30000 }, async ($, on) => {
  if (!canPoseEntries) return
  const { w } = await cooHere($, on)
  const answer = await call($, { card: { ...CARD, entries: ['I38', 'R12', 'R40'] } })
  expect(answer).toMatch(/Launch card k[a-z0-9]+ shown in the Coordination view: .*, covering 3 entries of the roadmap\./)
  const id = idOf(answer)
  expect(rawOf(w, id).entries).toEqual(['I38', 'R12', 'R40'])
  const ui = await pane($)
  expect(await allTexts(ui)).toContain('couvre 3 entrées : I38, R12, R40')
  await ui.unmount()
  expect(await statement($)).toContain(`${id} » « Export CSV des tickets »: start /grill-with-docs, mode manual, effort high, folder travail/export-csv/, covers 3 entries I38, R12, R40, ready.`)
})

test('un envoi hors forme ne pose rien et ne coupe rien : la réponse nomme l’id ou le nombre', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await cooHere($, on)
  for (const [entries, said] of [
    ['I3', /"entries" must be a list/],
    [['I3', 'Z9'], /"Z9" is not one/],
    [ids(21), /20 ids at most; this card has 21/],
  ] as const) {
    expect(await call($, { card: { ...CARD, entries } })).toMatch(said)
    expect(listOf(w)).toEqual([])
  }
  // Une mise à jour hors forme d'une carte déjà posée ne change rien à la carte gardée.
  if (!canPoseEntries) return
  const id = idOf(await call($, { card: { ...CARD, entries: ['I1', 'R2'] } }))
  const before = JSON.stringify(rawOf(w, id))
  for (const [entries, said] of [
    [['Z9'], /^No card shown: .*"Z9" is not one/],
    [ids(21), /^No card shown: .*20 ids at most; this card has 21/],
  ] as const) {
    expect(await call($, { card: { ...CARD, title: 'Autre titre', entries } })).toMatch(said)
    expect(JSON.stringify(rawOf(w, id))).toBe(before)
  }
})

test('les trois mises à jour : entrées données, rien de dit, liste vide', { timeoutMs: 30000 }, async ($, on) => {
  if (!canPoseEntries) return
  const { w } = await cooHere($, on)
  const id = idOf(await call($, { card: { ...CARD, entries: ['I1', 'R2'] } }))
  expect(await call($, { card: { ...CARD, title: 'Export CSV, retitré' } })).toMatch(/updated/)
  expect(rawOf(w, id).entries).toEqual(['I1', 'R2'])
  expect(await call($, { card: { ...CARD, entries: ['R9', 'I1'] } })).toMatch(/updated.*covering 2 entries/)
  expect(rawOf(w, id).entries).toEqual(['R9', 'I1'])
  expect(await call($, { card: { ...CARD, entries: [] } })).toMatch(/updated/)
  expect('entries' in rawOf(w, id)).toBe(false)
})

test('un changement de départ, un clic de lancement réussi puis défait, et le retrait d’une autre carte laissent les entrées, dans le même ordre', { timeoutMs: 30000 }, async ($, on) => {
  const A = card('kcartea01', { entries: ['R5', 'I2', 'R1'] })
  const B = card('kcarteb01')
  const { w } = await cooHere($, on, [A, B])
  let ui = await pane($)
  await pressAny(ui, { key: `coo-card-alt-${A.id}-to-spec` })
  await ui.unmount()
  expect(rawOf(w, A.id)).toMatchObject({ start: 'to-spec', entries: ['R5', 'I2', 'R1'] })
  // Le lancement gardé ne s'écrit pas : la carte, marquée « en lancement », est remise prête.
  w.probe.refuseStore = key => key.startsWith('coo-launch:')
  ui = await pane($)
  await pressAny(ui, { key: `coo-card-manual-${A.id}` })
  await ui.unmount()
  // Le clic a bien marqué la carte, puis retiré la marque, faute de pouvoir garder le lancement.
  expect(w.toasts.at(-1)).toBe('◆ Rien n’est lancé : le stockage du tableau de bord refuse l’écriture ; réessaie.')
  expect(rawOf(w, A.id).launch).toBeUndefined()
  expect(rawOf(w, A.id).entries).toEqual(['R5', 'I2', 'R1'])
  w.probe.refuseStore = undefined
  ui = await pane($)
  await pressAny(ui, { key: `coo-card-remove-${B.id}` })
  await ui.unmount()
  expect(rawOf(w, B.id)).toBeUndefined()
  expect(rawOf(w, A.id).entries).toEqual(['R5', 'I2', 'R1'])
  ui = await pane($)
  await pressAny(ui, { key: `coo-card-manual-${A.id}` })
  await ui.unmount()
  expect(rawOf(w, A.id).launch).toBeDefined()
  expect(rawOf(w, A.id).entries).toEqual(['R5', 'I2', 'R1'])
})

test('la discussion qui reprend le siège garde les entrées et le rang de la carte écrite par l’autre, même à sa propre écriture', { timeoutMs: 30000 }, async ($, on) => {
  const A = { ...card('kcartea01', { entries: ['I9', 'R3'] }), rank: 2 }
  const { w } = await cooHere($, on, [A], 'session-B', 'session-A')
  expect(await call($, { card: { ...CARD, folder: 'autre-dossier' } })).toMatch(/shown/)
  expect(rawOf(w, A.id)).toEqual(JSON.parse(JSON.stringify(A)))
  const ui = await pane($)
  expect(await allTexts(ui)).toContain('couvre 2 entrées : I9, R3')
  await ui.unmount()
})

test('une carte gardée aux entrées abîmées reste montrée et lançable avec ses seuls ids en forme ; trente ids en forme survivent à un changement de départ et à un clic', { timeoutMs: 30000 }, async ($, on) => {
  const odd = { ...card('kcartea01'), entries: [5, 'I3', 'A12', 'R7', 'texte'] }
  const many = card('kcarteb01', { entries: ids(30, 'R') })
  const { w } = await cooHere($, on, [odd, many])
  let ui = await pane($)
  const shown = await allTexts(ui)
  expect(shown).toContain('couvre 2 entrées : I3, R7')
  expect(shown).toContain(`couvre 30 entrées : ${ids(10, 'R').join(', ')}…`)
  await pressAny(ui, { key: `coo-card-alt-${many.id}-to-spec` })
  await ui.unmount()
  expect(rawOf(w, many.id).entries).toEqual(ids(30, 'R'))
  ui = await pane($)
  await pressAny(ui, { key: `coo-card-manual-${many.id}` })
  await ui.unmount()
  expect(rawOf(w, many.id).launch).toBeDefined()
  expect(rawOf(w, many.id).entries).toEqual(ids(30, 'R'))
  ui = await pane($)
  expect(await findAny(ui, { key: `coo-card-manual-${odd.id}` })).toBeDefined()
  await pressAny(ui, { key: `coo-card-manual-${odd.id}` })
  await ui.unmount()
  expect(rawOf(w, odd.id).launch).toBeDefined()
  expect(rawOf(w, odd.id).entries).toEqual(['I3', 'R7'])
})

test('une carte sans entrées se montre comme avant : aucune ligne « couvre » sous elle, rien de plus au relevé', { timeoutMs: 30000 }, async ($, on) => {
  await cooHere($, on, [card('kcartea01')])
  const ui = await pane($)
  // La carte est montrée et relevée (l'effet), sans ligne d'entrées (l'absence).
  expect(await findAny(ui, { key: 'coo-card-kcartea01' })).toBeDefined()
  expect(await allTexts(ui)).not.toContain('couvre')
  expect(await findAny(ui, { key: 'coo-card-entries-kcartea01' })).toBeUndefined()
  await ui.unmount()
  const said = await statement($)
  expect(said).toContain('« kcartea01 » « Carte kcartea01 »: start /grill-with-docs, mode manual, effort high, folder travail/dossier-kcartea01/, ready.')
  expect(said).not.toContain('covers')
})
