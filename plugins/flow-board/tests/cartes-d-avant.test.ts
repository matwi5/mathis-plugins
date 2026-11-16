// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { cardsListFile } from '../hooks/cards-list.ts'
import { CLOCK_SKEW_MS, LAUNCH_GRACE_MS, LAUNCH_TTL_MS, parseCard, pistesCard, type LaunchCard } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { emptyWaitlist, pistesOf, type Piste, type Waitlist } from '../hooks/pistes.ts'
import { retroCard } from '../hooks/retro-coo.ts'
import type { Run } from '../types'
import { COO, PANE, PLUGIN, TOOL, openCoo, seatOf, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { allTexts, findAny, pressAny } from './page-coo.ts'

// Les cartes d'avant la mise à jour : l'ancien état des cartes d'une discussion (`cooCards`, dans son état) passe dans
// la liste des cartes du projet à son premier relevé comme titulaire du siège (décisions A2, C5, C6, D2). Invariant :
// « La liste des cartes d'un projet n'est écrite que par la discussion qui tient le siège du COO. Une écriture n'y fait
// jamais disparaître ni revenir une carte qu'elle ne visait pas, et une liste qui ne se lit pas n'est jamais réécrite. »

const NOW = 980_000_000
const MIN = 60_000
const PROJECT = 'sans-projet-811c9dc5'
const LIST = `flow-board/coordination/${PROJECT}.cartes.json`
const KEY = 'coo-cards:'
const PISTES = `flow-board/pistes/${PROJECT}.json`
const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'manual', effort: 'high', folder: 'export-csv' }
const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })

const listPath = (w: World): string | undefined => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${LIST}`))
const listText = (w: World): string | undefined => {
  const p = listPath(w)
  return p ? w.files[p] : w.mem[KEY] === undefined ? undefined : JSON.stringify(w.mem[KEY])
}
const listOf = (w: World): { v: number; root: string; cards: any[] } => JSON.parse(listText(w) ?? '{"cards":[]}')
const ids = (w: World): string[] => listOf(w).cards.map(c => c.id)
const putCards = (w: World, cards: unknown[]) => {
  const file = cardsListFile('', cards)
  w.files[LIST] = JSON.stringify(file)
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/${LIST}`)) w.files[k] = JSON.stringify(file)
  w.mem[KEY] = JSON.parse(JSON.stringify(file))
}
const isList = (pathOrKey: string): boolean => pathOrKey.endsWith(`/${LIST}`) || pathOrKey === KEY

const card = (id: string, over: Partial<LaunchCard> = {}): LaunchCard => {
  const parsed = parseCard({ ...CARD, title: `Carte ${id}`, folder: `dossier-${id}` }, NOW - 30 * MIN, id)
  if ('refused' in parsed) throw new Error(parsed.refused)
  return { ...parsed.card, ...over }
}

/**
 * L'état de la discussion vu par le mod : l'ancien état des cartes (`old`) répondu à sa lecture, jamais écrit ; ce que
 * le mod écrit dans les clés des cartes est relevé (`sets`), et la marque « copié » se relit telle qu'écrite.
 */
const oldState = (on: any, old: unknown[], copied = false) => {
  const sets: { key: string; value: unknown }[] = []
  let mark: { value: boolean; version: number } = { value: copied, version: copied ? 1 : 0 }
  let isMarkRefused = false
  on('state.get', (_$: unknown, e: any, next: any) => {
    if (e.key === 'cooCards') return { value: { value: old, version: 1 } }
    if (e.key === 'cooCardsCopied') return { value: { value: mark.version === 0 ? undefined : mark.value, version: mark.version } }
    return next(e)
  })
  on('state.set', (_$: unknown, e: any, next: any) => {
    if (e.key === 'cooCards' || e.key === 'cooCardsCopied') sets.push({ key: e.key, value: e.value })
    // L'ancien état n'est jamais écrit : une écriture lève (le mod l'avale, sans boucler jusqu'au délai), et `sets` la
    // garde pour les tests qui vérifient qu'aucune n'a été tentée.
    if (e.key === 'cooCards') throw new Error('cooCards written')
    if (e.key === 'cooCardsCopied') {
      if (isMarkRefused) throw new Error('EROFS')
      if (e.ifVersion !== undefined && e.ifVersion !== mark.version) return { value: { isSet: false, version: mark.version } }
      mark = { value: e.value === true, version: mark.version + 1 }
      return { value: { isSet: true, version: mark.version } }
    }
    return next(e)
  })
  return {
    sets,
    isMarked: () => mark.value,
    refuseMark: (is: boolean) => {
      isMarkRefused = is
    },
  }
}

/** Le COO ouvert ici (le siège pris par cette discussion), sur une liste posée ou absente ; quelques relevés passent. */
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

const A = 'kancien01'
const B = 'kancien02'
const C = 'kancien03'

// ─── La copie ─────────────────────────────────────────────────────────────

test('au premier relevé du titulaire, les cartes de l’ancien état passent dans la liste et la vue, dans leur ordre et leur état ; l’ancien état n’est pas vidé, il est marqué « copié »', { timeoutMs: 30000 }, async ($, on) => {
  const now = NOW
  const launched = { ...newRun('implement', now - 20 * MIN, 'Mission lancée'), launch: { id: 'lancee0001', card: C, at: now - 20 * MIN, folder: `dossier-${C}`, start: 'implement', mode: 'manual' } } as unknown as Run
  const old = [card(A), card(B, { launch: { id: 'labcdefgh1', at: now - 2000, mode: 'manual' } }), card(C)]
  const state = oldState(on, old)
  const { w } = await cooHere($, on, now, [launched])
  expect(ids(w)).toEqual([A, B, C])
  expect(listOf(w).cards[1].launch).toMatchObject({ id: 'labcdefgh1' })
  const ui = await pane($)
  expect(await findAny(ui, { key: `coo-card-manual-${A}` })).toBeDefined()
  expect(await findAny(ui, { type: 'Text', text: /lancement en cours/ })).toBeDefined()
  expect(await findAny(ui, { key: `coo-card-manual-${B}` })).toBeUndefined()
  expect(await allTexts(ui)).not.toContain(`Carte ${C}`)
  await ui.unmount()
  expect(state.sets.filter(s => s.key === 'cooCards')).toEqual([])
  expect(state.isMarked()).toBe(true)
})

test('une carte déjà dans la liste par son id ou par son dossier n’est pas copiée (la liste gagne) ; une entrée hors forme de l’ancien état n’est pas copiée', { timeoutMs: 30000 }, async ($, on) => {
  const inList = card(A, { title: 'Version de la liste' })
  // Le dossier se compare sans la casse, comme partout ailleurs (sameFolder).
  const sameFolder = card('kliste001', { folder: `Dossier-${B.toUpperCase()}` })
  // Une carte en double dans l'ancien état lui-même (même dossier que C, sans la casse) : seule la première est copiée.
  const old = [card(A, { title: 'Version de l’ancien état' }), card(B), { id: 'kbad0001', title: 5 }, card(C), card('kancien09', { folder: `DOSSIER-${C}` })]
  const state = oldState(on, old)
  const { w } = await cooHere($, on, NOW, [], [inList, sameFolder])
  expect(ids(w)).toEqual([A, 'kliste001', C])
  expect(listOf(w).cards[0].title).toBe('Version de la liste')
  expect(state.isMarked()).toBe(true)
})

test('l’écriture de la liste ratée : pas de marque ; la copie se refait au relevé suivant, sans doublon', { timeoutMs: 30000 }, async ($, on) => {
  const state = oldState(on, [card(A), card(B)])
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  let isRefused = true
  w.probe.refuseWrite = path => isList(path) && isRefused
  w.probe.refuseStore = key => isList(key) && isRefused
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 12)
  expect(listText(w)).toBeUndefined()
  expect(state.isMarked()).toBe(false)
  isRefused = false
  await settle(clock, 6)
  expect(ids(w)).toEqual([A, B])
  expect(state.isMarked()).toBe(true)
  await settle(clock, 12)
  expect(ids(w)).toEqual([A, B])
})

test('la marque pas écrite : la copie rejouée ne double rien', { timeoutMs: 30000 }, async ($, on) => {
  const state = oldState(on, [card(A)])
  state.refuseMark(true)
  const { clock, w } = await cooHere($, on, NOW)
  expect(ids(w)).toEqual([A])
  expect(state.isMarked()).toBe(false)
  await settle(clock, 6)
  expect(ids(w)).toEqual([A])
  // Une carte proposée pendant ce temps n'est pas écrite, et la réponse dit pourquoi (la liste, elle, s'est écrite).
  const said = String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result)
  expect(said).toContain('the cards from before this version are not marked as taken over yet; propose the card again in a moment.')
  expect(ids(w)).toEqual([A])
  state.refuseMark(false)
  await settle(clock, 6)
  expect(state.isMarked()).toBe(true)
  expect(ids(w)).toEqual([A])
})

test('un ancien état sans carte en forme est marqué « copié » sans écriture de la liste', { timeoutMs: 30000 }, async ($, on) => {
  const state = oldState(on, [{ id: 'kbad0001', title: 5 }])
  const { w } = await cooHere($, on, NOW)
  expect(listText(w)).toBeUndefined()
  expect(state.isMarked()).toBe(true)
  expect(state.sets.filter(s => s.key === 'cooCards')).toEqual([])
})

test('un ancien état marqué n’est pas recopié (après /reload-plugins, la marque reste dans l’état) : une carte retirée depuis ne revient pas', { timeoutMs: 30000 }, async ($, on) => {
  const state = oldState(on, [card(A), card(B)], true)
  // Une mission close : sa carte de rétro due, posée par le relevé, prouve que le relevé a tourné avec la marque relue.
  const closed = { ...newRun('prototype', NOW - 10 * MIN, 'Mission close'), status: 'done' as const, finishedAt: NOW - 9 * MIN, updatedAt: NOW - 9 * MIN }
  const { clock, w } = await cooHere($, on, NOW, [closed], [card(B)])
  await settle(clock, 12)
  expect(ids(w)).toEqual([B, retroCard(closed, null, NOW).id])
  expect(state.sets).toEqual([])
})

test('une discussion sans le siège ne copie rien ; quand elle le reprend, ses cartes passent dans la liste, même une carte prête dont le dossier a été proposé puis retiré ailleurs', { timeoutMs: 30000 }, async ($, on) => {
  const state = oldState(on, [card(A), card(B)])
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-B'
  // Une autre discussion tient le siège ; sa liste ne porte plus le dossier de B (proposé puis retiré chez elle).
  putCards(w, [card(C)])
  writeBoard(w, b => ({ ...b, coo: seatOf('session-A', NOW - 1000) }))
  await start($)
  await settle(clock, 12)
  expect(ids(w)).toEqual([C])
  expect(state.isMarked()).toBe(false)
  await $.prompt.submit({ text: '/flow-board:coo reprendre', origin: { kind: 'plugin', name: PLUGIN }, command: { name: COO, args: 'reprendre' } } as any)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  expect(ids(w)).toEqual([C, A, B])
  expect(state.isMarked()).toBe(true)
})

test('liste illisible : rien n’est copié ni marqué, le texte reste ; relisible, la copie se fait', { timeoutMs: 30000 }, async ($, on) => {
  const state = oldState(on, [card(A)])
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  w.files[LIST] = '{ pas une liste'
  w.mem[KEY] = 'pas une liste'
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 12)
  const path = listPath(w)
  expect(path ? w.files[path] : w.mem[KEY]).toBe(path ? '{ pas une liste' : 'pas une liste')
  expect(state.isMarked()).toBe(false)
  putCards(w, [])
  await settle(clock, 6)
  expect(ids(w)).toEqual([A])
  expect(state.isMarked()).toBe(true)
})

test('une proposition de carte avant la copie : la copie passe d’abord, et une carte de l’ancien état sur le même dossier n’est pas doublée', { timeoutMs: 30000 }, async ($, on) => {
  const old = card(A, { folder: 'export-csv' })
  const state = oldState(on, [old])
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  // Proposée avant tout relevé : l'écriture copie d'abord l'ancien état ; la carte relue sur ce dossier a changé.
  const said = String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result)
  expect(ids(w)[0]).toBe(A)
  expect(state.isMarked()).toBe(true)
  // La carte relue sur ce dossier a changé depuis la lecture de la proposition (la copie) : refusée, la copiée intacte.
  expect(said).toMatch(/^No card shown: the list of cards changed meanwhile; propose the card again\./)
  expect(listOf(w).cards[0]).toMatchObject({ id: A, title: `Carte ${A}` })
  expect(listOf(w).cards.filter(c => c.folder === 'export-csv')).toHaveLength(1)
})

// ─── Le relevé attend la copie ────────────────────────────────────────────

test('une carte de rétro en lancement dans l’ancien état, sa mission close : après le relevé, la liste la porte toujours « lancement en cours », sans carte de rétro neuve', { timeoutMs: 30000 }, async ($, on) => {
  const closed = { ...newRun('prototype', NOW - 10 * MIN, 'Mission close'), status: 'done' as const, finishedAt: NOW - 9 * MIN, updatedAt: NOW - 9 * MIN }
  const launching = { ...retroCard(closed, null, NOW - 5 * MIN), launch: { id: 'lretro0001', at: NOW - 2000, mode: 'auto' as const } }
  oldState(on, [launching])
  const { clock, w } = await cooHere($, on, NOW, [closed])
  await settle(clock, 6)
  expect(listOf(w).cards).toHaveLength(1)
  expect(listOf(w).cards[0]).toMatchObject({ id: launching.id, launch: { id: 'lretro0001' } })
  const ui = await pane($)
  expect(await findAny(ui, { type: 'Text', text: /lancement en cours/ })).toBeDefined()
  await ui.unmount()
})

test('tant que l’ancien état n’est pas marqué « copié », aucune carte de rétro due ni aucune carte de remplacement n’est posée', { timeoutMs: 90000 }, async ($, on) => {
  const closed = { ...newRun('prototype', NOW - 10 * MIN, 'Mission close'), status: 'done' as const, finishedAt: NOW - 9 * MIN, updatedAt: NOW - 9 * MIN }
  const K = 'kpistes01'
  const piste = (id: string): Piste => ({ id, retro: 'retroA', text: `Texte de ${id}`, files: [], state: 'validated', card: K, by: 'retroA', at: NOW - 1000, history: [], comments: [] })
  const list: Waitlist = { ...emptyWaitlist(''), pistes: [piste('retroA/p1')] }
  const state = oldState(on, [pistesCard(K, NOW - 20 * MIN)])
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  w.files[PISTES] = JSON.stringify(list)
  w.mem['coo-pistes:'] = list
  writeBoard(w, b => ({ ...b, runs: [closed] }))
  // La liste ne s'écrit pas : la copie ne se fait pas, l'ancien état reste non marqué.
  let isRefused = true
  w.probe.refuseWrite = path => isList(path) && isRefused
  w.probe.refuseStore = key => isList(key) && isRefused
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  // Le siège tenu depuis plus que la vie d'un lancement gardé et sa grâce : une carte dite disparue recevrait sa remplaçante.
  for (let i = 0; i < Math.ceil((LAUNCH_TTL_MS + LAUNCH_GRACE_MS + CLOCK_SKEW_MS) / 5000) + 2; i++) await clock.advance(5000)
  expect(state.isMarked()).toBe(false)
  expect(listText(w)).toBeUndefined()
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${PISTES}`))
  expect(pistesOf((path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist).map(p => p.card)).toEqual([K])
  // La liste s'écrit de nouveau : la copie d'abord, l'ancienne carte « Pistes de rétro » seule (pas de remplaçante), puis la carte de rétro due.
  isRefused = false
  await settle(clock, 12)
  expect(state.isMarked()).toBe(true)
  const after = listOf(w).cards.map(c => c.id)
  expect(after[0]).toBe(K)
  expect(after.filter(id => id.startsWith('kn'))).toEqual([])
  expect(pistesOf((path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist).map(p => p.card)).toEqual([K])
})

test('une carte « Pistes de rétro » recopiée dont les pistes sont passées sur une remplaçante : prête, sans piste, elle ne se lance pas, et « ✕ Retirer » la retire', { timeoutMs: 30000 }, async ($, on) => {
  const K = 'kpistes01'
  const R = 'knremplac'
  const piste: Piste = { id: 'retroA/p1', retro: 'retroA', text: 'Texte', files: [], state: 'validated', card: R, by: 'retroA', at: NOW - 1000, history: [], comments: [] }
  const list: Waitlist = { ...emptyWaitlist(''), pistes: [piste] }
  oldState(on, [pistesCard(K, NOW - 20 * MIN)])
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  w.files[PISTES] = JSON.stringify(list)
  w.mem['coo-pistes:'] = list
  putCards(w, [pistesCard(R, NOW - 10 * MIN)])
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  expect(ids(w)).toEqual([R, K])
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-manual-${K}` })
  await ui.unmount()
  await settle(clock, 1)
  expect(w.toasts.at(-1)).toMatch(/plus aucune piste ne porte cette carte ; retire-la/)
  expect(Object.keys(w.mem).filter(k => k.startsWith('coo-launch:'))).toEqual([])
  const again = await pane($)
  await pressAny(again, { key: `coo-card-remove-${K}` })
  await again.unmount()
  await settle(clock, 1)
  expect(ids(w)).toEqual([R])
})
