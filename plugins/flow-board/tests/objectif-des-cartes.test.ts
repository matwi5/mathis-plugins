// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { CARD_GOAL_MAX, launchText, parseCard, pistesCard, soundCard, type LaunchRecord } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { cardsListFile } from '../hooks/cards-list.ts'
import { retroCard, retroCardId } from '../hooks/retro-coo.ts'
import type { Run } from '../types'
import { COO, PANE, PLUGIN, TOOL, coordFile, openCoo, seatOf, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { findAny, pressAny } from './page-coo.ts'

// L'objectif d'une carte de lancement. Invariant : « L'objectif d'une
// carte n'est jamais perdu ni changé par une écriture du mod qui connaît ce champ et qui ne vise pas cet objectif
// (changement de départ, marque de lancement ou son annulation, ordre des cartes) ; une carte gardée sans objectif reste
// lisible et lançable ; ajouter l'objectif ne retire ni ne change aucun autre champ d'aucune carte. »

const NOW = 960_000_000
const MIN = 60_000
const PROJECT = 'sans-projet-811c9dc5'
const LIST = `flow-board/coordination/${PROJECT}.cartes.json`
const KEY = 'coo-cards:'

const GOAL = 'Exporter les tickets en CSV pour les relire dans un tableur, sans perdre les statuts.'
const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'manual', modeWhy: 'cadrage suivi', effort: 'high', effortWhy: 'cadrage', folder: 'export-csv', goal: GOAL }

const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const propose = async ($: any, over: Record<string, unknown> = {}): Promise<string> => /Launch card (k[a-z0-9]+)/.exec(await call($, { card: { ...CARD, ...over } }))?.[1] ?? ''

const listPath = (w: World): string | undefined => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${LIST}`))
const listText = (w: World): string | undefined => {
  const p = listPath(w)
  return p ? w.files[p] : w.mem[KEY] === undefined ? undefined : JSON.stringify(w.mem[KEY])
}
const listOf = (w: World): { v: number; root: string; cards: any[] } => JSON.parse(listText(w) ?? '{"cards":[]}')
const cardOf = (w: World, id: string): Record<string, unknown> => listOf(w).cards.find(c => c.id === id)
const putCards = (w: World, cards: unknown[]) => {
  const file = cardsListFile('', cards)
  w.files[LIST] = JSON.stringify(file)
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/${LIST}`)) w.files[k] = JSON.stringify(file)
  w.mem[KEY] = JSON.parse(JSON.stringify(file))
}

/** Une carte gardée telle que le fichier la porte, sans les champs qu'un geste change : ce qui doit rester identique. */
const without = (c: Record<string, unknown>, ...keys: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(c).filter(([k]) => !keys.includes(k)))

const cooHere = async ($: any, on: any, now: number, runs: Run[] = [], cards?: unknown[]) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-COO'
  if (cards) putCards(w, cards)
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  return { clock, w }
}

/** Une carte d'avant ce ticket : telle qu'une version précédente du mod l'écrivait, sans `goal`. */
const oldCard = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => {
  const { goal: _, ...rest } = CARD
  return { id, ...rest, title: `Carte ${id}`, folder: `dossier-${id}`, modeWhy: 'cadrage suivi', effortWhy: 'cadrage', at: NOW - 30 * MIN, ...over }
}

// ─── Le module pur ────────────────────────────────────────────────────────

test('une carte de Claude porte son objectif, aplati et coupé à 240 signes ; sans lui, ou vide, elle est refusée et le refus dit quoi écrire', () => {
  expect(CARD_GOAL_MAX).toBe(240)
  const parsed = parseCard(CARD, 1, 'kabcdef12')
  expect('card' in parsed && parsed.card.goal).toBe(GOAL)
  const flat = parseCard({ ...CARD, goal: '  Exporter\nles tickets\r\n\ten CSV  ' }, 1, 'kabcdef12')
  expect('card' in flat && flat.card.goal).toBe('Exporter les tickets en CSV')
  const long = parseCard({ ...CARD, goal: 'x'.repeat(400) }, 1, 'kabcdef12')
  expect('card' in long && long.card.goal).toBe(`${'x'.repeat(239)}…`)
  const { goal: _, ...noGoal } = CARD
  for (const raw of [noGoal, { ...CARD, goal: '' }, { ...CARD, goal: ' \n\t ' }, { ...CARD, goal: 42 }]) {
    expect(parseCard(raw, 1, 'kabcdef12')).toEqual({ refused: '"goal" must say what the mission wants to obtain, in one to three short lines in the user\'s language (not the title again)' })
  }
})

test('à la relecture, l’objectif est facultatif : absent, pas un texte ou forgé, la carte reste en forme et l’objectif se borne', () => {
  const at = NOW
  const base = { ...oldCard('kabcdef12'), at }
  const old = soundCard(base)
  expect(old).not.toBeNull()
  expect(old && 'goal' in old).toBe(false)
  for (const goal of [42, null, [], {}, '']) {
    const read = soundCard({ ...base, goal })
    expect(read).not.toBeNull()
    expect(read && 'goal' in read).toBe(false)
  }
  expect(soundCard({ ...base, goal: `a\nb${'y'.repeat(300)}` })?.goal).toBe(`a b${'y'.repeat(236)}…`)
  // Le reste de la carte relue ne change pas avec l'objectif.
  expect(without(soundCard({ ...base, goal: GOAL }) as any, 'goal')).toEqual(old as any)
})

test('askMatt, modeWhy et effortWhy restent exigés et bornés comme avant', () => {
  expect(parseCard({ ...CARD, askMatt: '' }, 1, 'kabcdef12')).toEqual({ refused: expect.stringMatching(/askMatt/) })
  const parsed = parseCard({ ...CARD, askMatt: 'a'.repeat(300), modeWhy: 'm'.repeat(200), effortWhy: 'e'.repeat(200) }, 1, 'kabcdef12')
  expect('card' in parsed && [parsed.card.askMatt.length, parsed.card.modeWhy.length, parsed.card.effortWhy.length]).toEqual([240, 160, 160])
})

test('une carte de rétro et une carte « Pistes de rétro » portent l’objectif écrit par le mod', () => {
  const run = { ...newRun('implement', NOW - 900_000, 'Export\u0007 CSV'), status: 'done' } as Run
  expect(retroCard(run, null, NOW).goal).toBe('Relire ce qui s\'est passé dans « Export CSV », puis proposer ses pistes, à cocher ici.')
  const long = { ...run, title: 'T'.repeat(300) } as Run
  expect(retroCard(long, null, NOW).goal?.length).toBe(CARD_GOAL_MAX)
  expect(retroCard(long, null, NOW).goal?.endsWith('…')).toBe(true)
  expect(pistesCard('kpistes01', NOW).goal).toBe('Découper en tickets les pistes cochées dans « Pistes en attente ».')
})

test('l’objectif écrit par le mod ne change pas à la relecture, même d’un titre qui garde deux blancs une fois neutralisé', () => {
  for (const title of ['Export \u200B CSV', 'Bug \u00B4s export', 'a  \u0007  b']) {
    const card = retroCard({ ...newRun('implement', NOW - 900_000, title), status: 'done' } as Run, null, NOW)
    expect(soundCard(card)?.goal).toBe(card.goal)
    expect(card.goal).not.toMatch(/\s{2}/)
  }
  const pistes = pistesCard('kpistes01', NOW)
  expect(soundCard(pistes)?.goal).toBe(pistes.goal)
})

test('l’objectif n’entre ni dans l’enregistrement de lancement ni dans le texte envoyé à la nouvelle mission', () => {
  const parsed = parseCard(CARD, NOW, 'kabcdef12')
  if (!('card' in parsed)) throw new Error('carte refusée')
  const text = launchText(parsed.card, 'labcdefgh12', 'manual', '/grill-with-docs')
  expect(text).not.toContain('Exporter les tickets en CSV')
})

// ─── La carte chez le COO ─────────────────────────────────────────────────

test('envoyée sans objectif, la carte est refusée et rien n’est écrit', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await cooHere($, on, NOW)
  const before = listText(w)
  const { goal: _, ...noGoal } = CARD
  const answer = await call($, { card: noGoal })
  expect(answer.startsWith('No card shown: "goal" must say what the mission wants to obtain, in one to three short lines in the user\'s language (not the title again).')).toBe(true)
  expect(listText(w)).toBe(before)
})

test('l’objectif est gardé mot pour mot par un changement de départ, une marque de lancement et un ordre des cartes ; les autres champs aussi', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, w } = await cooHere($, on, NOW)
  const id = await propose($)
  const second = await propose($, { title: 'Autre', folder: 'autre-dossier', goal: 'Un autre objectif.' })
  const posed = cardOf(w, id)
  expect(posed.goal).toBe(GOAL)
  // L'ordre des cartes : seul le rang change.
  expect(await call($, { coordinate: { order: [second, id] } })).toMatch(/^Order of the launch cards written/)
  const ranked = cardOf(w, id)
  expect(without(ranked, 'rank')).toEqual(without(posed, 'rank'))
  // Un autre départ : seuls start, alts et at changent.
  await clock.advance(1000)
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-alt-${id}-to-spec` })
  await ui.unmount()
  await settle(clock, 1)
  const moved = cardOf(w, id)
  expect(moved.start).toBe('to-spec')
  expect(without(moved, 'start', 'alts', 'at')).toEqual(without(ranked, 'start', 'alts', 'at'))
  // La marque de lancement : seul launch s'ajoute.
  await clock.advance(1000)
  const again = await pane($)
  await pressAny(again, { key: `coo-card-manual-${id}` })
  await again.unmount()
  await settle(clock, 1)
  const marked = cardOf(w, id)
  expect(marked.launch).toBeDefined()
  expect(without(marked, 'launch')).toEqual(moved)
  // L'enregistrement de lancement : ses seules clés, sans l'objectif.
  const records = Object.entries(w.mem).filter(([k]) => k.startsWith('coo-launch:')).map(([, v]) => v as LaunchRecord)
  expect(records).toHaveLength(1)
  expect(Object.keys(records[0]!).sort()).toEqual(['at', 'by', 'card', 'effort', 'folder', 'id', 'mode', 'root', 'start', 'title', 'v'])
  expect(w.fills.join('\n')).not.toContain('Exporter les tickets en CSV')
})

test('le lancement annulé (l’enregistrement refusé) rend la carte telle qu’elle était, objectif compris', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await cooHere($, on, NOW)
  const id = await propose($)
  const posed = cardOf(w, id)
  w.probe.refuseStore = key => key.startsWith('coo-launch:')
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-manual-${id}` })
  await ui.unmount()
  await settle(clock, 1)
  expect(w.toasts.at(-1)).toBe('◆ Rien n’est lancé : le stockage du tableau de bord refuse l’écriture ; réessaie.')
  expect(cardOf(w, id)).toEqual(posed)
})

test('le lancement d’une rétro annulé (la demande pas écrite) rend la carte telle qu’elle était, objectif compris', { timeoutMs: 30000 }, async ($, on) => {
  // La mission étudiée : close, née dans la discussion du manager (la demande de rétro va chez lui).
  const studied = { ...newRun('implement', NOW - 900_000, 'Mission de B'), status: 'done', bornIn: 'aaaa1111-2222-3333-4444-555566667777', updatedAt: NOW - 60_000 } as Run
  // Un objectif que le mod n'écrit pas lui-même : le test échouerait si l'annulation reconstruisait la carte.
  const forged = { ...retroCard(studied, null, NOW - 100), goal: 'Objectif gardé dans le fichier.' }
  const { clock, w } = await cooHere($, on, NOW, [studied], [forged])
  const id = retroCardId(studied.id)
  const posed = cardOf(w, id)
  expect(posed.goal).toBe('Objectif gardé dans le fichier.')
  w.coord.text = coordFile([])
  w.coord.throws = true
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-auto-${id}` })
  await ui.unmount()
  await settle(clock, 1)
  w.coord.throws = false
  expect(w.toasts.some(t => t.includes('la demande de rétro ne s’écrit pas'))).toBe(true)
  expect(cardOf(w, id)).toEqual(posed)
})

test('une liste d’avant, sans objectif, se relit, se montre et se lance ; ses cartes restent sans le champ', { timeoutMs: 30000 }, async ($, on) => {
  const old = oldCard('kancien01')
  const { clock, w } = await cooHere($, on, NOW, [], [old])
  const ui = await pane($)
  expect(await findAny(ui, { key: 'coo-card-manual-kancien01' })).toBeDefined()
  await pressAny(ui, { key: 'coo-card-manual-kancien01' })
  await ui.unmount()
  await settle(clock, 1)
  const marked = cardOf(w, 'kancien01')
  expect(marked.launch).toBeDefined()
  expect('goal' in marked).toBe(false)
  expect(without(marked, 'launch')).toEqual(old)
})

test('une liste relue par un nouveau titulaire du siège garde les objectifs qu’elle porte', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-B'
  const withGoal = { ...oldCard('kcartea01'), goal: GOAL }
  putCards(w, [withGoal, oldCard('kcarteb01')])
  writeBoard(w, b => ({ ...b, coo: seatOf('session-A', NOW - 1000) }))
  await start($)
  await $.prompt.submit({ text: '/flow-board:coo reprendre', origin: { kind: 'plugin', name: PLUGIN }, command: { name: COO, args: 'reprendre' } } as any)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  expect(cardOf(w, 'kcartea01')).toEqual(withGoal)
  expect('goal' in cardOf(w, 'kcarteb01')).toBe(false)
})

test('une carte renvoyée pour le même dossier prend l’objectif du nouvel envoi et garde son id, ses entrées et son rang', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await cooHere($, on, NOW, [], [{ ...oldCard('kcartea01', { folder: 'export-csv' }), entries: ['I1'], rank: 1, goal: 'Ancien objectif.' }])
  const answer = await call($, { card: { ...CARD, goal: 'Nouvel objectif.' } })
  expect(answer).toMatch(/^Launch card kcartea01 updated/)
  const after = cardOf(w, 'kcartea01')
  expect(after.goal).toBe('Nouvel objectif.')
  expect(after.entries).toEqual(['I1'])
  expect(after.rank).toBe(1)
})
