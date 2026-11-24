// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { cooStatement } from '../hooks/coo.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { emptyBoard } from '../hooks/model.ts'
import { PANE, PLUGIN, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { findAny } from './page-coo.ts'

// Le bouton « ✦ Proposer les missions » de la ligne « Au départ » (page « Vue d'ensemble ») : décisions « le bouton sur cette
// ligne, montrée même sans carte », « la ligne d'alerte reste seule, sans bouton, quand la liste des cartes ne se lit
// pas », et la consigne fixe au COO, avec sa garde d'un second clic. Invariant : « Un clic sur « ✦ Proposer les missions »
// n'envoie jamais la consigne hors du siège du COO ni pendant un tour, ne l'envoie jamais une seconde fois dans la minute
// qui suit un envoi parti tant que le tour du COO n'a pas commencé, et la consigne ne porte aucune valeur lue ailleurs. »

/** La consigne, mot pour mot. */
const ASK =
  "◆ COO : propose-moi les missions à lancer. Suis la section « Proposer les missions » de tes consignes (/flow-board:coo) : relis les idées « à lancer » et les choses à reprendre « à décider » de la feuille de route, regroupe-les en cartes de lancement, range les cartes prêtes par ordre de priorité, puis dis-moi ce que tu as fait. Pour ce regroupement, ne change le statut d'aucune entrée, ne retire aucune carte et ne lance aucune mission. Si ta dernière ligne « COO seat » dit que tu ne tiens plus le siège, n’écris rien."
const SENT = '◆ Demande envoyée au COO : il relit les idées et les choses à reprendre.'
const AGAIN = '◆ Demande déjà envoyée au COO.'
const MISSED = '◆ La demande n’est pas partie : reclique.'
const KEY = 'coo-cards-propose'

const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
const asks = (w: World): string[] => w.prompts.filter(p => p === ASK)

const openCooWith = async ($: any, on: any, now: number) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-COO'
  writeBoard(w, b => b)
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  return { clock, w }
}

const click = async ($: any, clock: any) => {
  const ui = await pane($)
  expect(await findAny(ui, { key: KEY })).toBeDefined()
  await ui.press({ key: KEY })
  await ui.unmount()
  await settle(clock, 2)
}

test('la ligne « Au départ · n » paraît sur la page « Vue d’ensemble » avec ou sans carte et porte le bouton ; liste illisible : la ligne d’alerte seule, sans bouton', () => {
  const rows = (opts: Record<string, unknown>) => coordinationRows(cooStatement(emptyBoard('', 'p'), { now: 2, ...opts }), { page: 'overview' })
  const empty = rows({ cards: [] })
  const head = empty.find(r => r.key === 'coo-cards')
  expect(head?.parts.map(p => p.text).join('')).toBe('Au départ · 0')
  expect(head?.actions?.map(a => [a.key, a.label.replace(/\s/g, ' '), a.act])).toEqual([[KEY, '✦ Proposer les missions', { kind: 'propose' }]])
  // Sans liste du tout (pas encore lue) : la ligne aussi.
  expect(rows({}).some(r => r.key === 'coo-cards')).toBe(true)
  // Liste illisible : seule la ligne de renvoi à l'alerte, sans bouton.
  const unread = rows({ cards: [], cardsUnread: { path: '/p/cartes.json' } })
  expect(unread.some(r => r.key === 'coo-cards')).toBe(false)
  expect(unread.some(r => r.key === 'coo-cards-unread-see' && (r.actions ?? []).length === 0)).toBe(true)
  expect(unread.flatMap(r => r.actions ?? []).some(a => a.key === KEY)).toBe(false)
})

test('un clic, Claude au repos et le siège tenu : la consigne part avec son texte exact, et la personne lit le message ; aucune écriture de plus', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openCooWith($, on, 500_000_000)
  await settle(clock, 3)
  const files = JSON.stringify(w.files)
  const coord = w.coord.text
  const keys = Object.keys(w.mem).sort()
  await click($, clock)
  expect(asks(w)).toEqual([ASK])
  expect(w.toasts.at(-1)).toBe(SENT)
  // La consigne ne porte aucune valeur lue ailleurs : elle est la même quel que soit l'état du projet.
  expect(JSON.stringify(w.files)).toBe(files)
  expect(w.coord.text).toBe(coord)
  expect(Object.keys(w.mem).sort()).toEqual(keys)
})

test('un second clic avant le début du tour du COO, dans la minute, ne part pas ; le début d’un tour lève la marque', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openCooWith($, on, 501_000_000)
  await click($, clock)
  await click($, clock)
  expect(asks(w)).toHaveLength(1)
  expect(w.toasts.at(-1)).toBe(AGAIN)
  // Le tour du COO commence puis finit : un nouveau clic part.
  await $.turn.start({ turnId: 't1', text: ASK } as any)
  await $.turn.complete({ turnId: 't1', answer: 'fait' } as any)
  await settle(clock, 2)
  await click($, clock)
  expect(asks(w)).toHaveLength(2)
  expect(w.toasts.at(-1)).toBe(SENT)
})

test('deux clics simultanés sur le même panneau ne font partir la consigne qu’une fois', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openCooWith($, on, 505_000_000)
  const ui = await pane($)
  expect(await findAny(ui, { key: KEY })).toBeDefined()
  const both = Promise.all([ui.press({ key: KEY }), ui.press({ key: KEY })])
  await settle(clock, 3)
  await both
  await ui.unmount()
  expect(asks(w)).toHaveLength(1)
  expect(w.toasts).toContain(SENT)
  expect(w.toasts).toContain(AGAIN)
})

test('un clic pendant le début d’un tour (ses écritures pas encore finies) ne part pas', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openCooWith($, on, 507_000_000)
  const ui = await pane($)
  expect(await findAny(ui, { key: KEY })).toBeDefined()
  // Le début du tour et le clic en même temps : le clic arrive avant que le tour ait fini ses attentes.
  const turn = $.turn.start({ turnId: 't9', text: 'un message de la personne' } as any)
  const press = ui.press({ key: KEY })
  await settle(clock, 3)
  await Promise.all([turn, press])
  await ui.unmount()
  expect(asks(w)).toHaveLength(0)
  expect(w.toasts).toContain('◆ Claude travaille : reclique quand il a fini son tour.')
  // Le tour fini, un clic part.
  await $.turn.complete({ turnId: 't9', answer: 'fait' } as any)
  await settle(clock, 2)
  await click($, clock)
  expect(asks(w)).toEqual([ASK])
})

test('une liste des cartes devenue illisible entre l’affichage et le clic : rien ne part, et le clic le dit', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openCooWith($, on, 506_000_000)
  const ui = await pane($)
  expect(await findAny(ui, { key: KEY })).toBeDefined()
  w.files[`flow-board/coordination/sans-projet-811c9dc5.cartes.json`] = '{"v":2,"root":"","cards":'
  w.mem['coo-cards:'] = '{"v":2,"root":"","cards":'
  await ui.press({ key: KEY })
  await ui.unmount()
  await settle(clock, 2)
  expect(asks(w)).toHaveLength(0)
  expect(w.toasts).toContain('◆ Rien n’est fait : la liste des cartes ne se lit pas.')
})

test('la marque est levée une minute après le clic', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openCooWith($, on, 502_000_000)
  await click($, clock)
  await clock.advance(30_000)
  await click($, clock)
  expect(asks(w)).toHaveLength(1)
  await clock.advance(31_000)
  await click($, clock)
  expect(asks(w)).toHaveLength(2)
})

test('un envoi qui n’est pas parti dit le message d’échec et lève la marque : un nouveau clic part', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openCooWith($, on, 503_000_000)
  w.submit.drop = true
  await click($, clock)
  expect(w.toasts.at(-1)).toBe(MISSED)
  expect(w.toasts).not.toContain(SENT)
  w.submit.drop = false
  await click($, clock)
  expect(asks(w)).toEqual([ASK])
  expect(w.toasts.at(-1)).toBe(SENT)
})

test('un clic pendant un tour ne part pas et dit le message d’aujourd’hui ; hors du siège non plus', { timeoutMs: 20000 }, async ($, on) => {
  const now = 504_000_000
  const { clock, w } = await openCooWith($, on, now)
  await $.turn.start({ turnId: 't1', text: 'un tour' } as any)
  await click($, clock)
  expect(asks(w)).toHaveLength(0)
  expect(w.toasts.at(-1)).toBe('◆ Claude travaille : reclique quand il a fini son tour.')
  await $.turn.complete({ turnId: 't1', answer: 'fait' } as any)
  await settle(clock, 2)
  writeBoard(w, b => ({ ...b, coo: { by: 'session-AUTRE', at: now + 5_000, seenAt: now + 5_000 } }))
  await click($, clock)
  expect(asks(w)).toHaveLength(0)
  expect(w.toasts).toContain('◆ Cette discussion ne tient plus le siège du COO : rien n’est fait.')
})
