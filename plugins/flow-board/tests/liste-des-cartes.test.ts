// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { LAUNCH_GRACE_MS, LAUNCH_TTL_MS, CLOCK_SKEW_MS, parseCard, pistesCard, soundCard, type LaunchCard } from '../hooks/launch.ts'
import { closeDelivered, emptyBoard, newRun } from '../hooks/model.ts'
import { cardsListFile } from '../hooks/cards-list.ts'
import { emptyWaitlist, pistesOf, type Piste, type Waitlist } from '../hooks/pistes.ts'
import { retroCard, retroCardId } from '../hooks/retro-coo.ts'
import type { Board, Run } from '../types'
import { COO, PANE, PLUGIN, TOOL, openCoo, seatOf, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'
import { allTexts, findAny, pressAny } from './page-coo.ts'

// La liste des cartes du projet : les cartes suivent le siège du COO. Décision A1 : « les cartes de lancement, de rétro et
// « Pistes de rétro » sont gardées par projet et par poste, hors de la discussion, et seule la discussion qui tient le
// siège du COO les écrit ; la discussion qui prend le siège les relit et les montre ». Invariant : « La liste des cartes
// d'un projet n'est écrite que par la discussion qui tient le siège du COO. Une écriture n'y fait jamais disparaître ni
// revenir une carte qu'elle ne visait pas, et une liste qui ne se lit pas n'est jamais réécrite. »

const NOW = 960_000_000
const MIN = 60_000
/** Le nom des fichiers du projet de ces tests (racine vide) sur ce poste, comme `coordinationName`. */
const PROJECT = 'sans-projet-811c9dc5'
const LIST = `flow-board/coordination/${PROJECT}.cartes.json`
const KEY = 'coo-cards:'
const PISTES = `flow-board/pistes/${PROJECT}.json`

const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'manual', effort: 'high', folder: 'export-csv', goal: 'Objectif de test.' }
const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const propose = async ($: any, over: Record<string, unknown> = {}): Promise<string> => /Launch card (k[a-z0-9]+)/.exec(await call($, { card: { ...CARD, ...over } }))?.[1] ?? ''
const launches = (w: World): string[] => Object.keys(w.mem).filter(k => k.startsWith('coo-launch:'))

/** La liste telle que gardée : au fichier (mode fichier) ou dans le stockage du mod. */
const listPath = (w: World): string | undefined => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${LIST}`))
const listText = (w: World): string | undefined => {
  const p = listPath(w)
  return p ? w.files[p] : w.mem[KEY] === undefined ? undefined : JSON.stringify(w.mem[KEY])
}
const listOf = (w: World): { v: number; root: string; cards: any[] } => JSON.parse(listText(w) ?? '{"cards":[]}')
/** Pose la liste des cartes : au fichier (par la fin de son chemin, et à son chemin entier s'il est déjà écrit) et dans le stockage. */
const putCards = (w: World, cards: unknown[]) => {
  const file = cardsListFile('', cards)
  w.files[LIST] = JSON.stringify(file)
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/${LIST}`)) w.files[k] = JSON.stringify(file)
  w.mem[KEY] = JSON.parse(JSON.stringify(file))
}
const isList = (pathOrKey: string): boolean => pathOrKey.endsWith(`/${LIST}`) || pathOrKey === KEY
/** L'écriture de la liste refusée par le moteur, dans les deux modes. */
const refuseListWrites = (w: World, isOn: () => boolean = () => true) => {
  w.probe.refuseWrite = path => isList(path) && isOn()
  w.probe.refuseStore = key => isList(key) && isOn()
}


const openCooAt = async ($: any, on: any, now: number, runs: Run[] = []) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-COO'
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  return { clock, w }
}

/**
 * Cette discussion reprend par « ↻ Reprendre ici » le siège qu'une autre tenait, sur une liste que l'autre a écrite
 * (`cards`, telles que son écriture les a laissées) : son propre état ne porte aucune de ces cartes (décision A1).
 */
const takeSeatFrom = async ($: any, on: any, now: number, cards: unknown[], runs: Run[] = []) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-B'
  putCards(w, cards)
  writeBoard(w, b => ({ ...b, runs, coo: seatOf('session-A', now - 1000) }))
  await start($)
  await $.prompt.submit({ text: '/flow-board:coo reprendre', origin: { kind: 'plugin', name: PLUGIN }, command: { name: COO, args: 'reprendre' } } as any)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  return { clock, w }
}

const card = (id: string, over: Partial<LaunchCard> = {}): LaunchCard => {
  const parsed = parseCard({ ...CARD, folder: `dossier-${id}` }, NOW, id)
  if ('refused' in parsed) throw new Error(parsed.refused)
  return { ...parsed.card, ...over }
}
const A = 'kcartea01'
const C = 'kcartec01'

// ─── Les cartes suivent le siège ──────────────────────────────────────────

// Les deux moitiés d'un changement de siège, dans deux tests (une seule discussion par test : le mod garde l'id de la
// sienne) : la proposition écrit la liste dans la forme de `cardsListFile`, et `putCards` pose une liste de cette forme
// à la discussion qui reprend le siège.
test('une carte proposée dans une discussion est écrite dans la liste des cartes du projet, dans sa forme (A1)', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await openCooAt($, on, NOW)
  const id = await propose($)
  const written = listOf(w)
  expect(written).toEqual(JSON.parse(JSON.stringify(cardsListFile('', written.cards))))
  expect([written.v, written.root]).toEqual([2, ''])
  expect(written.cards.map(c => c.id)).toEqual([id])
  expect(written.cards[0]).toMatchObject({ title: CARD.title, folder: CARD.folder, start: CARD.start })
  // La carte écrite est une carte en forme, celle que relit la discussion qui reprend le siège.
  expect(soundCard(written.cards[0])).toEqual(written.cards[0])
})

test('la liste écrite par la discussion qui tenait le siège : celle qui le reprend montre sa carte prête', { timeoutMs: 30000 }, async ($, on) => {
  await takeSeatFrom($, on, NOW, [card(A)])
  const ui = await pane($)
  expect(await allTexts(ui)).toContain('Export CSV des tickets')
  expect(await findAny(ui, { key: `coo-card-manual-${A}` })).toBeDefined()
  await ui.unmount()
})

test('une carte en lancement au changement de siège reste « lancement en cours » dans la nouvelle discussion, et un clic n’y lance rien', { timeoutMs: 30000 }, async ($, on) => {
  const at = NOW + MIN
  const { clock, w } = await takeSeatFrom($, on, at, [card(A, { launch: { id: 'labcdefgh1', at: at - 2000, mode: 'manual' } })])
  const there = await pane($)
  expect(await findAny(there, { type: 'Text', text: /lancement en cours/ })).toBeDefined()
  expect(await findAny(there, { key: `coo-card-manual-${A}` })).toBeUndefined()
  await there.unmount()
  expect(launches(w)).toEqual([])
  // Le clic d'un dessin d'avant, où la carte était encore prête : relue en lancement, elle ne lance rien.
  putCards(w, [card(A)])
  const drawn = await pane($)
  await pressStale(w, drawn, { key: `coo-card-manual-${A}` }, [card(A, { launch: { id: 'labcdefgh1', at: at - 2000, mode: 'manual' } })])
  await drawn.unmount()
  await settle(clock, 1)
  expect(w.toasts.at(-1)).toBe('◆ Lancement en cours : rien de plus.')
  expect(launches(w)).toEqual([])
  expect(listOf(w).cards[0].launch).toMatchObject({ id: 'labcdefgh1' })
})

test('une carte de rétro et une carte « Pistes de rétro » suivent le siège : les pistes « validée » retrouvent leur carte, sans carte de remplacement', { timeoutMs: 90000 }, async ($, on) => {
  const closed = { ...newRun('prototype', NOW - 10 * MIN, 'Mission close'), status: 'done' as const, finishedAt: NOW - 9 * MIN, updatedAt: NOW - 9 * MIN }
  const K = 'kpistes01'
  const piste = (id: string): Piste => ({ id, retro: 'retroA', text: `Texte de ${id}`, files: [], state: 'validated', card: K, by: 'retroA', at: NOW - 1000, history: [], comments: [] })
  const list: Waitlist = { ...emptyWaitlist(''), pistes: [piste('retroA/p1')] }
  const before = [pistesCard(K, NOW), retroCard(closed, null, NOW)]
  const { clock, w } = await takeSeatFrom($, on, NOW + 2 * MIN, before, [closed])
  w.files[PISTES] = JSON.stringify(list)
  w.mem['coo-pistes:'] = list
  // Le siège pris depuis assez longtemps pour qu'une carte dite disparue reçoive sa remplaçante.
  for (let i = 0; i < Math.ceil((LAUNCH_TTL_MS + LAUNCH_GRACE_MS + CLOCK_SKEW_MS) / 5000) + 2; i++) await clock.advance(5000)
  // La même liste, les mêmes cartes (la carte de rétro n'est pas reposée : même date) ; les pistes gardent leur carte.
  expect(listOf(w).cards).toEqual(JSON.parse(JSON.stringify(before)))
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${PISTES}`))
  expect(pistesOf((path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist).map(p => p.card)).toEqual([K])
  const ui = await pane($)
  expect(await findAny(ui, { key: `coo-card-manual-${K}` })).toBeDefined()
  expect(await allTexts(ui)).toContain('Rétrospective · Mission close')
  await ui.unmount()
})

// ─── Le siège relu juste avant l'écriture ─────────────────────────────────

/**
 * Le clic d'un dessin d'avant : le bouton cherché sur la liste d'avant (le dessin), puis la liste devient `cards` à la
 * première lecture du clic lui-même (`press` ne redessine pas avant de cliquer).
 */
const pressStale = async (w: World, ui: any, query: Record<string, unknown>, cards: unknown[]) => {
  expect(await findAny(ui, query)).toBeDefined()
  let isDone = false
  w.probe.refuseRead = pathOrKey => {
    if (isList(pathOrKey) && !isDone) {
      isDone = true
      putCards(w, cards)
    }
    return false
  }
  await ui.press(query)
  w.probe.refuseRead = undefined
}
/**
 * Le siège part dans une autre discussion pendant le clic : après le contrôle commun des gestes (sa relecture du
 * fichier des missions), à la première lecture de la liste des cartes qui suit.
 */
const loseSeatAtNextRead = (w: World, at: number) => {
  let isChecked = false
  let isDone = false
  w.probe.onBoardRead = () => {
    isChecked = true
  }
  w.probe.refuseRead = pathOrKey => {
    if (isChecked && !isDone && isList(pathOrKey)) {
      isDone = true
      writeBoard(w, b => ({ ...b, coo: seatOf('session-autre', at) }))
    }
    return false
  }
}

test('« → /départ » et « ▶ Lancer » : le siège repris ailleurs pendant le clic, ils n’écrivent rien et le disent', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await openCooAt($, on, NOW + 3 * MIN)
  const id = await propose($)
  const before = listText(w)
  const ui = await pane($)
  loseSeatAtNextRead(w, NOW + 3 * MIN + 5000)
  await pressAny(ui, { key: `coo-card-alt-${id}-to-spec` })
  await settle(clock, 1)
  // Le siège perdu se dit aussi par son propre toast ; celui du clic dit qu'il n'a rien changé.
  expect(w.toasts).toContain('◆ Rien n’est changé : ce COO ne tient plus le siège, ou le fichier des missions ne se lit pas.')
  expect(listText(w)).toBe(before)
  await ui.unmount()
  // Le siège rendu ici, puis repris ailleurs pendant le clic de lancement.
  writeBoard(w, b => ({ ...b, coo: seatOf('session-COO', NOW + 3 * MIN + 10_000) }))
  await settle(clock, 6)
  const again = await pane($)
  loseSeatAtNextRead(w, NOW + 3 * MIN + 20_000)
  await pressAny(again, { key: `coo-card-manual-${id}` })
  await again.unmount()
  await settle(clock, 1)
  expect(w.toasts).toContain('◆ Rien n’est lancé : ce COO ne tient plus le siège, ou le fichier des missions ne se lit pas.')
  expect(listText(w)).toBe(before)
  expect(launches(w)).toEqual([])
})

test('« ✕ Retirer » d’une carte de rétro : le siège repris ailleurs pendant le clic, rien n’est écrit, et le message le dit', { timeoutMs: 30000 }, async ($, on) => {
  // Une mission archivée ailleurs : sa carte de rétro, encore prête, porte « ✕ Retirer ».
  const gone = { ...newRun('prototype', NOW - 10 * MIN, 'Mission archivée'), status: 'done' as const, finishedAt: NOW - 9 * MIN, archivedAt: NOW - 5 * MIN }
  const { clock, w } = await openCooAt($, on, NOW + 4 * MIN, [gone])
  putCards(w, [retroCard(gone, null, NOW)])
  await settle(clock, 6)
  const before = listText(w)
  const ui = await pane($)
  loseSeatAtNextRead(w, NOW + 4 * MIN + 10_000)
  await pressAny(ui, { key: `coo-card-remove-${retroCardId(gone.id)}` })
  await ui.unmount()
  await settle(clock, 1)
  expect(w.toasts.at(-1)).toBe('◆ Rien n’est retiré : ce COO ne tient plus le siège, ou le fichier des missions ne se lit pas.')
  expect(listText(w)).toBe(before)
})

// ─── Écritures refusées, changées, ratées ─────────────────────────────────

test('la liste changée entre sa relecture et l’écriture : rien n’est écrit, la carte de l’autre écriture est toujours là, et la réponse le dit', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await openCooAt($, on, NOW + 5 * MIN)
  putCards(w, [])
  const other = card(C)
  // La troisième lecture de la liste pendant la proposition (celle d'après le siège relu) trouve une autre carte posée.
  let reads = 0
  w.probe.refuseRead = pathOrKey => {
    if (isList(pathOrKey) && ++reads === 3) putCards(w, [other])
    return false
  }
  const said = await call($, { card: CARD })
  expect(said).toMatch(/^No card shown: the list of cards changed meanwhile; propose the card again\./)
  expect(listOf(w).cards.map(c => c.id)).toEqual([C])
  // Reproposée comme la réponse le demande, la carte est posée, à côté de celle de l'autre écriture.
  const again = await call($, { card: CARD })
  expect(again).toMatch(/Launch card k[a-z0-9]+/)
  expect(listOf(w).cards.map(c => c.folder)).toEqual([other.folder, CARD.folder])
})

test('deux propositions lancées sans attendre : les écritures se suivent, et les deux cartes finissent dans la liste', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await openCooAt($, on, NOW + 5 * MIN)
  const [first, second] = await Promise.all([call($, { card: CARD }), call($, { card: { ...CARD, title: 'Import des contacts', folder: 'import-contacts' } })])
  expect([first, second].every(s => /Launch card k[a-z0-9]+/.test(s))).toBe(true)
  expect(listOf(w).cards.map(c => c.folder).sort()).toEqual(['export-csv', 'import-contacts'])
})

test('écriture ratée : la carte proposée est refusée avec la raison, un clic répond qu’il n’a rien fait, et la liste relue n’a pas changé', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await openCooAt($, on, NOW + 6 * MIN)
  const id = await propose($)
  const before = listText(w)
  refuseListWrites(w)
  expect(await call($, { card: { ...CARD, title: 'Autre carte', folder: 'autre' } })).toMatch(/^No card shown: the list of cards could not be written\./)
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-remove-${id}` })
  await ui.unmount()
  await settle(clock, 1)
  expect(w.toasts.at(-1)).toBe('◆ Rien n’est retiré : la liste des cartes ne s’écrit pas ; réessaie.')
  expect(listText(w)).toBe(before)
})

test('une entrée hors forme n’est jamais montrée ni lancée, et reste octet pour octet après dix écritures ; un dossier « .. » n’a ni ligne ni bouton', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, w } = await openCooAt($, on, NOW + 7 * MIN)
  const bad = { id: 'kbad0001', title: 5, note: 'version future' }
  const trap = { ...card('kpiege01'), title: 'Carte piégée', folder: '../hors' }
  putCards(w, [bad, trap])
  for (let i = 0; i < 10; i++) await propose($, { title: `Carte ${i}`, folder: `dossier-${i}` })
  const cards = listOf(w).cards
  expect(cards).toHaveLength(12)
  expect(JSON.stringify(cards[0])).toBe(JSON.stringify(bad))
  expect(JSON.stringify(cards[1])).toBe(JSON.stringify(trap))
  await settle(clock, 6)
  const ui = await pane($)
  const shown = await allTexts(ui)
  expect(shown).not.toContain('Carte piégée')
  expect(shown).not.toContain('../hors')
  expect(await findAny(ui, { key: 'coo-card-manual-kpiege01' })).toBeUndefined()
  expect(await findAny(ui, { key: 'coo-card-manual-kbad0001' })).toBeUndefined()
  await ui.unmount()
  // Le clic d'un dessin d'avant, où la carte était en forme : relue hors forme (dossier « .. »), elle ne lance rien.
  const before = listText(w)
  putCards(w, [bad, card('kpiege01')])
  const drawn = await pane($)
  await pressStale(w, drawn, { key: 'coo-card-manual-kpiege01' }, JSON.parse(before!).cards)
  await drawn.unmount()
  await settle(clock, 1)
  expect(w.toasts.at(-1)).toBe('◆ Rien n’est lancé : la carte n’est plus là.')
  expect(launches(w)).toEqual([])
  expect(listText(w)).toBe(before)
})

test('une liste qui ne se lit pas n’est écrite par aucune proposition : la carte est refusée, le texte reste', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await openCooAt($, on, NOW + 8 * MIN)
  w.files[LIST] = '{ pas une liste'
  w.mem[KEY] = 'pas une liste'
  expect(await call($, { card: CARD })).toMatch(/^No card shown: the list of cards cannot be read; nothing is shown or written in it\./)
  expect(w.files[LIST]).toBe('{ pas une liste')
  expect(listPath(w)).toBeUndefined()
  expect(w.mem[KEY]).toBe('pas une liste')
})

// ─── Les chemins à deux écritures, la seconde ratée ───────────────────────

const pendingPiste = (id: string): Piste => ({ id, retro: 'retroA', text: `Texte de ${id}`, files: [], state: 'pending', by: 'retroA', at: NOW - 1000, history: [], comments: [] })
const putWaitlist = (w: World, pistes: Piste[]) => {
  const list: Waitlist = { ...emptyWaitlist(''), pistes }
  w.files[PISTES] = JSON.stringify(list)
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/${PISTES}`)) w.files[k] = JSON.stringify(list)
  w.mem['coo-pistes:'] = list
}
const isWaitlist = (pathOrKey: string): boolean => pathOrKey.endsWith(`/${PISTES}`) || pathOrKey === 'coo-pistes:'
const cutTicked = async ($: any, clock: any) => {
  const ui = await pane($)
  await pressAny(ui, { key: 'coo-piste-tick-retroA/p1' })
  await ui.unmount()
  const again = await pane($)
  await pressAny(again, { key: 'coo-pistes-cut-go' })
  await again.unmount()
  await settle(clock, 2)
}

test('découpage de pistes, la liste d’attente pas écrite : la carte repart ; la liste d’attente illisible : la carte reste, avec « retire-la »', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW + 9 * MIN })
  const w = world(on)
  putWaitlist(w, [pendingPiste('retroA/p1')])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  w.probe.refuseWrite = path => isWaitlist(path)
  w.probe.refuseStore = key => isWaitlist(key)
  await cutTicked($, clock)
  expect(w.toasts.at(-1)).toMatch(/^◆ Rien n’est découpé\./)
  expect(listOf(w).cards).toEqual([])
  // La liste d'attente ne se relit plus : la carte posée reste, et le message dit de la retirer.
  w.probe.refuseWrite = undefined
  w.probe.refuseStore = undefined
  await settle(clock, 6)
  w.probe.refuseRead = pathOrKey => isWaitlist(pathOrKey)
  const ui = await pane($)
  await pressAny(ui, { key: 'coo-pistes-cut-go' })
  await ui.unmount()
  await settle(clock, 2)
  expect(w.toasts.at(-1)).toMatch(/si aucune piste ne la porte, retire-la\./)
  expect(listOf(w).cards).toHaveLength(1)
})

test('retrait d’une carte « Pistes de rétro », la carte pas retirée : elle reste prête, sans piste, ne se lance pas, et se retire au clic suivant', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW + 10 * MIN })
  const w = world(on)
  putWaitlist(w, [pendingPiste('retroA/p1')])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  await cutTicked($, clock)
  const id = listOf(w).cards[0]!.id as string
  refuseListWrites(w)
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-remove-${id}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(w.toasts.at(-1)).toMatch(/^◆ Ses pistes sont de nouveau « pas encore validée », mais la carte « Pistes de rétro · \d\d:\d\d » reste \(la liste des cartes ne s’écrit pas ; réessaie\) : reclique « ✕ Retirer »\.$/)
  expect(listOf(w).cards.map(c => c.id)).toEqual([id])
  const launch = await pane($)
  await pressAny(launch, { key: `coo-card-manual-${id}` })
  await launch.unmount()
  await settle(clock, 2)
  expect(w.toasts.at(-1)).toBe('◆ Rien n’est lancé : plus aucune piste ne porte cette carte ; retire-la.')
  w.probe.refuseWrite = undefined
  w.probe.refuseStore = undefined
  const last = await pane($)
  await pressAny(last, { key: `coo-card-remove-${id}` })
  await last.unmount()
  await settle(clock, 2)
  expect(listOf(w).cards).toEqual([])
})

test('archivage, la carte de rétro pas retirée : la mission s’archive, sa carte reste et porte « ✕ Retirer »', { timeoutMs: 60000 }, async ($, on) => {
  const at = NOW + 11 * MIN
  const base = newRun('implement', at - 90_000, 'Mission de B')
  const done = { ...base.phases[0]!, status: 'done' as const, finishedAt: at - 60_000 }
  const report = { ...base.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: at - 50_000, finishedAt: at - 40_000, steps: [], items: [] }
  const version = newRun('project:version', base.startedAt, 'v').phases[0]!
  const pending = { ...version, status: 'pending' as const, startedAt: undefined, steps: version.steps.map(s => ({ id: s.id, status: 'pending' as const })) }
  const validated = { ...base, phases: [done, report, pending], cursor: 1, status: 'paused', reportValidatedAt: at - 40_000, updatedAt: at - 1_000 } as Run
  const board: Board = { ...emptyBoard('', 'projet'), runs: [validated] }
  const delivered = closeDelivered(board, validated.id, at - 500, { version: '0.80.0', push: 'main' })!.board.runs[0]!
  const { clock, w } = await openCooAt($, on, at, [delivered])
  putCards(w, [retroCard(delivered, null, at - 100)])
  await settle(clock, 6)
  refuseListWrites(w)
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-archive-${retroCardId(delivered.id)}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(stored(w).runs[0]!.archivedAt).toBeDefined()
  expect(listOf(w).cards.map(c => c.id)).toEqual([retroCardId(delivered.id)])
  await settle(clock, 6)
  const after = await pane($)
  expect(await findAny(after, { key: `coo-card-remove-${retroCardId(delivered.id)}` })).toBeDefined()
  await after.unmount()
})

test('clic de lancement, l’enregistrement pas écrit : la marque est retirée ; si ce retrait rate aussi, la carte redevient prête après 11 minutes', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, w } = await openCooAt($, on, NOW + 12 * MIN)
  const id = await propose($)
  w.probe.refuseStore = key => key.startsWith('coo-launch:')
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-manual-${id}` })
  await ui.unmount()
  await settle(clock, 1)
  expect(w.toasts.at(-1)).toBe('◆ Rien n’est lancé : le stockage du tableau de bord refuse l’écriture ; réessaie.')
  expect(listOf(w).cards[0]!.launch).toBeUndefined()
  // Le retrait de la marque raté aussi : la carte reste « lancement en cours », puis redevient prête.
  // La marque s'écrit (première écriture de la liste), puis toute écriture de la liste rate.
  let writes = 0
  w.probe.refuseStore = key => key.startsWith('coo-launch:') || (isList(key) && ++writes > 1)
  w.probe.refuseWrite = path => isList(path) && ++writes > 1
  const again = await pane($)
  await pressAny(again, { key: `coo-card-manual-${id}` })
  await again.unmount()
  await settle(clock, 1)
  expect(listOf(w).cards[0]!.launch).toBeDefined()
  const launching = await pane($)
  expect(await findAny(launching, { type: 'Text', text: /lancement en cours/ })).toBeDefined()
  await launching.unmount()
  for (let i = 0; i < 12; i++) await clock.advance(MIN)
  const ready = await pane($)
  expect(await findAny(ready, { key: `coo-card-manual-${id}` })).toBeDefined()
  await ready.unmount()
})
