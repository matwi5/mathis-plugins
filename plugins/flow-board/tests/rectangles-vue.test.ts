// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { C } from '../hooks/catalog.ts'
import { coordinationRows, foldLines, type CooRow } from '../hooks/coo-view.tsx'
import { parseCard, type LaunchCard } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { PANE, PLUGIN, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { OVERVIEW_KEYS, keysOf, loadedStatement } from './vue-chargee.ts'

// Sur « Vue d'ensemble », chaque chose est dans un rectangle à bordure, dont la couleur dit la nature, avec sa pastille de
// nature quand elle en a une ; les lignes et les boutons d'aujourd'hui, clés comprises, y restent.

const rowsOf = (): CooRow[] => coordinationRows(loadedStatement(), { page: 'overview' })
const row = (rows: readonly CooRow[], key: string): CooRow => {
  const found = rows.find(r => r.key === key)
  if (!found) throw new Error(`ligne ${key} absente`)
  return found
}
const frameOf = (rows: readonly CooRow[], key: string) => row(rows, key).frame

test('les clés figées de la vue chargée sont toutes là, chacune une fois : un rectangle ne fait perdre aucune ligne ni aucun bouton', () => {
  const keys = keysOf(rowsOf())
  expect([...keys].sort()).toEqual([...OVERVIEW_KEYS].sort())
})

test('l’encadré du point est vert d’eau, avec la pastille « ◆ COO · LE POINT » ; la surveillance de nuit est dedans', () => {
  const rows = rowsOf()
  const point = frameOf(rows, 'coo-point')
  expect({ ...point, chip: point?.chip?.replace(/ /g, ' ') }).toEqual({ id: 'coo-point', color: C.teal, chip: '◆ COO · LE POINT' })
  for (const k of ['coo-tiles', 'coo-point-2', 'coo-night']) expect(frameOf(rows, k), k).toEqual(point)
})

test('chaque chose du bloc « Projet » a son rectangle, à la couleur de sa nature, avec sa pastille', () => {
  const rows = rowsOf()
  expect(frameOf(rows, 'coo-project')).toBeUndefined()
  const look = (key: string) => {
    // Une chose d'une mission de la liste est dans son couloir : son rectangle est alors le rectangle intérieur.
    const f = row(rows, key).inner ?? frameOf(rows, key)
    return f ? { color: f.color, chip: f.chip?.replace(/ /g, ' ') } : undefined
  }
  expect(look('coo-wait-mauto0001-q1-qsgphfp')).toEqual({ color: C.amber, chip: '? Question' })
  expect(look('coo-wait-mauto0001-g1-q1esfv22')).toEqual({ color: C.amber, chip: '? Dépense' })
  expect(look('coo-report-mreport01')).toEqual({ color: C.pink, chip: '▤ Rapport' })
  expect(look('coo-delivery')).toEqual({ color: C.sky, chip: '⬆ Livraison' })
  expect(look('coo-waiting-0')).toEqual({ color: C.amber, chip: '◷ T’attend' })
  expect(look('coo-hold-mmanu0001~A~mheld0001~A~file')).toEqual({ color: C.amber, chip: '⇥ À forcer' })
  // Une feuille de route qui perd des entrées : une alerte rouge, comme aujourd'hui.
  expect(look('coo-gone')).toEqual({ color: C.red, chip: '⚠ Alerte' })
  expect(look('coo-where')).toEqual({ color: C.amber, chip: '? Endroit' })
  // Une retenue grise reste une ligne grise, sans rectangle.
  expect(row(rows, 'coo-hold-mmanu0001~B~mheld0001~B~file').inner).toBeUndefined()
})

test('une décision opposée est une alerte ambre ; la ligne grise « compatibles » reste une ligne, sans rectangle', () => {
  const s = { ...loadedStatement(), decisions: { contradictions: [{ subject: 'S', missionId: 'mauto0001', mission: 'Mission en auto', other: 'Autre', isOpen: true }], compatibles: [{ a: 'A', b: 'B', subject: 'T' }] } }
  const rows = coordinationRows(s as any, { page: 'overview' })
  expect(frameOf(rows, 'coo-opposed-0')?.color).toBe(C.amber)
  expect(frameOf(rows, 'coo-compatible-0')).toBeUndefined()
})

test('les lignes qui suivent une chose sont dans son rectangle : le corps du rapport et ses boutons, l’alerte et ses entrées', () => {
  const rows = rowsOf()
  expect(frameOf(rows, 'coo-report-mreport01-line-0')).toEqual(frameOf(rows, 'coo-report-mreport01'))
  expect(frameOf(rows, 'coo-report-mreport01-acts')).toEqual(frameOf(rows, 'coo-report-mreport01'))
  expect(frameOf(rows, 'coo-gone-I9')).toEqual(frameOf(rows, 'coo-gone'))
  expect(frameOf(rows, 'coo-where-ask')).toEqual(frameOf(rows, 'coo-where'))
  // Deux choses voisines ont deux rectangles.
  expect(row(rows, 'coo-wait-mauto0001-q1-qsgphfp').inner?.id).not.toBe(row(rows, 'coo-wait-mauto0001-g1-q1esfv22').inner?.id)
})

test('le plan du projet et la prochaine vague sont dans un même rectangle cyan du bloc « Projet », avec « ✓ Valider le plan » et « ⇉ Lancer la vague »', () => {
  const rows = rowsOf()
  const plan = frameOf(rows, 'coo-plan')
  expect(plan?.color).toBe(C.cyan)
  expect(plan?.chip?.replace(/ /g, ' ')).toBe('⇉ Prochaine vague')
  for (const k of ['coo-plan-ask', 'coo-plan-wave-0', 'coo-plan-wave-1', 'coo-plan-delivery', 'coo-wave', 'coo-wave-next']) expect(frameOf(rows, k), k).toEqual(plan)
  expect(row(rows, 'coo-plan-ask').actions?.map(a => a.key)).toEqual(['coo-plan-validate'])
  expect(row(rows, 'coo-wave-next').actions?.map(a => a.key)).toEqual(['coo-wave-launch'])
  // Dans le bloc « Projet » : avant l'en-tête des missions.
  expect(rows.findIndex(r => r.key === 'coo-plan')).toBeLessThan(rows.findIndex(r => r.key === 'coo-missions'))
})

test('une mission a son rectangle à la couleur du skill de sa phase, gris quand elle est close ; une carte le sien, vert d’eau', () => {
  const rows = rowsOf()
  expect(frameOf(rows, 'coo-mission-mheld0001')?.color).toBe(C.tangerine)
  expect(frameOf(rows, 'coo-mission-mdone0001')?.color).toBe(C.gray)
  expect(frameOf(rows, 'coo-missions')).toBeUndefined()
  expect(frameOf(rows, 'coo-cards')).toBeUndefined()
  const card = frameOf(rows, 'coo-card-kcarte002')
  expect(card?.color).toBe(C.teal)
  for (const k of ['coo-card-goal-kcarte002', 'coo-card-quota-kcarte002']) expect(frameOf(rows, k), k).toEqual(card)
})

test('une carte : titre et départ, puis son objectif sur trois lignes au plus, puis ses boutons au bas de son rectangle', () => {
  const rows = rowsOf()
  const head = row(rows, 'coo-card-kcarte002')
  expect(head.isActsLast).toBe(true)
  expect(head.actions?.map(a => a.key)).toContain('coo-card-manual-kcarte002')
  const keys = rows.map(r => r.key)
  expect(keys.indexOf('coo-card-goal-kcarte002')).toBe(keys.indexOf('coo-card-kcarte002') + 1)
  expect(row(rows, 'coo-card-goal-kcarte002').maxLines).toBe(3)
})

test('foldLines replie un texte en lignes de la largeur donnée, au plus n, la dernière coupée par « … »', () => {
  expect(foldLines('un deux trois', 40, 3)).toEqual(['un deux trois'])
  expect(foldLines('aaaa bbbb cccc dddd', 9, 3)).toEqual(['aaaa bbbb', 'cccc dddd'])
  const long = foldLines(Array.from({ length: 40 }, (_, i) => `mot${i}`).join(' '), 20, 3)
  expect(long.length).toBe(3)
  expect(long[2]!.endsWith('…')).toBe(true)
  for (const l of long) expect(l.length).toBeLessThanOrEqual(20)
  // Un mot plus long que la ligne est coupé dans le mot, sans rien perdre tant qu'il tient.
  expect(foldLines('abcdefghijklmnop', 8, 3)).toEqual(['abcdefgh', 'ijklmnop'])
  // Un mot long après une ligne pleine (ou presque) part à la ligne suivante : aucune ligne plus large que la place.
  expect(foldLines('abcdefgh ijklmnopqrstu', 8, 4)).toEqual(['abcdefgh', 'ijklmnop', 'qrstu'])
  expect(foldLines('abcdefg ijklmnopqrstu', 8, 4)).toEqual(['abcdefg', 'ijklmnop', 'qrstu'])
  for (const text of ['abcdefgh ijklmnopqrstu', 'abcdefg ijklmnopqrstu', 'ab cdefghijklmnopqrstuvwxyz']) for (const l of foldLines(text, 8, 9)) expect(l.length, `${text} → ${l}`).toBeLessThanOrEqual(8)
})

// ─── Le panneau monté ─────────────────────────────────────────────────────

const NOW = 640_000_000
const PROJECT = 'sans-projet-811c9dc5'
const LIST = `flow-board/coordination/${PROJECT}.cartes.json`
const CARD = { start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'manual', modeWhy: 'cadrage', effort: 'high', effortWhy: 'cadrage' }
const goalOf = (id: string): string => `Objectif de la carte ${id}, écrit sur plusieurs mots pour qu’il se replie dans un panneau étroit, et même un peu plus long encore pour dépasser trois lignes à quarante cellules de large.`
const card = (id: string): LaunchCard => {
  const parsed = parseCard({ ...CARD, title: `Carte ${id} au titre assez long pour un panneau étroit`, folder: `dossier-${id}`, goal: goalOf(id) }, NOW - 60_000, id)
  if ('refused' in parsed) throw new Error(parsed.refused)
  return parsed.card
}
const putCards = (w: World, cards: unknown[]) => {
  const text = JSON.stringify({ v: 2, root: '', cards })
  w.files[LIST] = text
  w.mem['coo-cards:'] = JSON.parse(text)
}
const CARDS = ['kcarte0a1', 'kcarte0a2', 'kcarte0a3']

const mounted = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  putCards(w, CARDS.map(card))
  const run = { ...newRun('implement', NOW - 60_000, 'Mission ouverte'), status: 'active', owner: 'session-B', updatedAt: NOW - 1_000 }
  writeBoard(w, b => ({ ...b, runs: [run as any] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  return run
}

test('au terminal comme sur l’ordinateur, chaque chose est une boîte à bordure arrondie de sa couleur, les boutons dedans ; aucun dessin vectoriel', { timeoutMs: 30000 }, async ($, on) => {
  const run = await mounted($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await pane.press({ key: 'coo-page-overview' })
    const point = await pane.find({ key: 'frame-coo-point' })
    expect([point?.props.borderStyle, point?.props.borderColor], surface).toEqual(['round', C.teal])
    expect((await pane.find({ key: `frame-mission-${run.id}` }))?.props.borderColor, surface).toBe(C.tangerine)
    expect((await pane.find({ key: 'frame-card-kcarte0a1' }))?.props.borderColor, surface).toBe(C.teal)
    // La pastille de l'encadré, et les boutons de la carte au bas de son rectangle.
    const texts = ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '').replace(/ /g, ' '))
    expect(texts.some(t => t.includes('◆ COO · LE POINT')), surface).toBe(true)
    expect(await pane.find({ key: 'frame-card-kcarte0a1-end' }), surface).toBeDefined()
    expect(await pane.find({ key: 'coo-card-manual-kcarte0a1' }), surface).toBeDefined()
    if (surface === 'terminal') expect(await pane.find({ type: 'Svg' })).toBeUndefined()
    await pane.unmount()
  }
})

test('toute carte prête est montrée, même dans un panneau de 40 cellules, son objectif replié sur trois lignes au plus', { timeoutMs: 30000 }, async ($, on) => {
  await mounted($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE, props: { ...PANE.props, bodyColumns: 40 } })
    await pane.press({ key: 'coo-page-overview' })
    for (const id of CARDS) {
      expect(await pane.find({ key: `coo-card-${id}` }), `${surface} ${id}`).toBeDefined()
      expect(await pane.find({ key: `coo-card-manual-${id}` }), `${surface} ${id}`).toBeDefined()
    }
    const goal = ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).filter(t => t.length > 3 && CARDS.some(id => goalOf(id).includes(t.replace(/…$/, ''))))
    // Trois lignes par carte au plus, la dernière coupée.
    expect(goal.length, surface).toBeLessThanOrEqual(3 * CARDS.length)
    expect(goal.some(t => t.endsWith('…')), surface).toBe(true)
    await pane.unmount()
  }
})
