// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import type { Run } from '../types'
import { CLOCK_SKEW_MS, LAUNCH_GRACE_MS, LAUNCH_TTL_MS, launchKey, pistesCard, pistesCardFolder, type LaunchRecord } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { emptyWaitlist, keepsPistes, pistesOf, recardPistes, type BoxedOp, type Piste, type Waitlist } from '../hooks/pistes.ts'
import { pistesBackCardId } from '../hooks/retro-coo.ts'
import { applyOrphanCards, orphanCardPlans, orphanLinesOf } from '../hooks/pistes-fin.ts'
import { PANE, PLUGIN, openCoo, seatOf, settle, start, writeBoard, world, type World } from './monde-coordination.ts'
import { findAny, pressAny } from './page-coo.ts'

// Une nouvelle carte pour des pistes « validée » dont la carte a disparu. Invariant de la liste d'attente : « Une
// écriture d'une rétro ou du COO n'efface ni ne change jamais en silence la piste d'une autre ; une piste ne quitte
// jamais le fichier, et une piste en exécution ne change plus. » Lu pour ces pistes : la carte d'une piste ne change
// jamais en silence, et jamais celle d'une piste qu'une mission ou un lancement porte encore.

const NOW = 700_000_000
const GONE = 'kperdue01'
/** Le nom des fichiers du projet de ces tests (racine vide) sur ce poste, comme `coordinationName`. */
const PROJECT = 'sans-projet-811c9dc5'

const piste = (id: string, over: Partial<Piste> = {}): Piste => ({ id, retro: id.slice(0, id.indexOf('/')), text: `Texte de ${id}`, files: [`hooks/${id.slice(-2)}.ts`], state: 'validated', card: GONE, by: id.slice(0, id.indexOf('/')), at: NOW - 1000, history: [{ text: `Ancien texte de ${id}`, files: [], by: 'retroB', at: NOW - 900 }], comments: [{ text: `Note sur ${id}`, by: 'coo', at: NOW - 800 }], ...over })
const listWith = (pistes: unknown[]): Waitlist => ({ ...emptyWaitlist(''), pistes })
/** Deux pistes « validée » de la carte disparue, et une piste d'une autre carte « pas encore validée ». */
const itsPistes = (): Piste[] => [piste('retroA/p1'), piste('retroA/p2'), piste('retroA/p3', { state: 'pending', card: undefined })]
const NEW = () => pistesBackCardId(GONE, ['retroA/p1', 'retroA/p2'], 'kn')

/** Une mission qui porte la carte disparue (ou seulement son dossier). */
const carrier = (over: Record<string, unknown> = {}): Run =>
  ({ ...newRun('implement', NOW - 50_000, 'Pistes de rétro'), id: 'mporte01', status: 'active', launch: { id: 'lporte0001', card: GONE, at: NOW - 60_000, folder: pistesCardFolder(GONE), start: 'to-tickets', mode: 'manual' }, tickets: [], groups: [], ...over }) as unknown as Run

const putList = (w: World, pistes: unknown[]) => {
  const list = listWith(pistes)
  w.files[`flow-board/pistes/${PROJECT}.json`] = JSON.stringify(list)
  w.mem['coo-pistes:'] = list
}
const listOf = (w: World): Waitlist => {
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/flow-board/pistes/${PROJECT}.json`))
  return (path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist
}
const cardsOf = (w: World) => pistesOf(listOf(w)).map(p => p.card)
const mount = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
const statement = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))

/** Le COO ouvert ici sur des missions et des pistes ; quelques relevés passent. */
const cooWith = async ($: any, clock: any, w: World, runs: Run[], pistes: unknown[]) => {
  writeBoard(w, b => ({ ...b, runs }))
  putList(w, pistes)
  await start($)
  await openCoo($, clock)
  await settle(clock, 12)
}

// ─── La fonction pure ─────────────────────────────────────────────────────

/** Le contexte d'un plan : tout relu, siège pris depuis assez longtemps, liste sur le poste, rien ne porte la carte. */
const CTX = { cards: [] as unknown[], runs: [] as Run[], where: 'unasked' as string | undefined, isWhole: true, isSeatOld: true, isTaken: (_card: string) => false }
/** Le contexte de l'écriture : les copies et les boîtes relues par elle. */
const WRITE = { ...CTX, copies: [[], []] as Run[][], ops: [] as BoxedOp[] }

test('Piste dans un autre état : jamais touchée (fonction pure)', () => {
  const others = (['pending', 'ticket', 'running', 'done', 'dropped'] as const).map((state, i) => piste(`retroA/q${i}`, { state, card: `kautre00${i}`, ...(state === 'ticket' || state === 'running' ? { mission: 'mautre01' } : {}), ...(state === 'dropped' ? { reason: 'x' } : {}) }))
  expect(orphanCardPlans({ ...CTX, pistes: others })).toEqual({ plans: [], left: [] })
  // Même visée par un plan, une piste qui n'est plus « validée » ne change pas.
  const list = listWith(others)
  expect(recardPistes(list, { oldCard: GONE, card: 'knnouvelle', ids: others.map(p => p.id) }, NOW).list).toBe(list)
})

test('les pistes « validée » d’une même carte absente reçoivent une seule carte ; seule leur carte change, avec qui et quand (fonction pure)', () => {
  const pistes = [...itsPistes(), piste('retroB/p4', { card: 'kautre001' })]
  const { plans, left } = orphanCardPlans({ ...CTX, pistes, cards: [pistesCard('kautre001', NOW)], where: 'poste' })
  expect(left).toEqual([])
  expect(plans).toEqual([{ oldCard: GONE, ids: ['retroA/p1', 'retroA/p2'], card: NEW() }])
  // La même carte pour les mêmes pistes (rejouée), une autre pour d'autres ; jamais une carte de mission finie (kq).
  expect(pistesBackCardId(GONE, ['retroA/p2', 'retroA/p1'], 'kn')).toBe(NEW())
  expect(NEW()).toMatch(/^kn/)
  expect(NEW()).not.toBe(pistesBackCardId(GONE, ['retroA/p1', 'retroA/p2']))
  const list = listWith(pistes)
  const out = applyOrphanCards(list, plans, NOW, { ...WRITE, cards: [pistesCard('kautre001', NOW)], where: 'poste' })
  const after = pistesOf(out.list)
  for (const [a, b] of pistesOf(list).map((p, i) => [p, after[i]!] as const)) {
    expect([b.state, b.text, b.files, b.comments, b.history]).toEqual([a.state, a.text, a.files, a.comments, a.history])
  }
  expect(after.map(p => p.card)).toEqual([NEW(), NEW(), undefined, 'kautre001'])
  expect(after[0]).toEqual(expect.objectContaining({ cardBy: 'coo', cardAt: NOW }))
  expect(after[0]!.stateBy).toBeUndefined()
  expect(keepsPistes(list, out.list)).toBe(true)
  expect(out.left).toEqual([])
  expect(orphanLinesOf(plans, out.moved, after)).toEqual([expect.stringContaining(`Pistes « retroA/p1 », « retroA/p2 » were « validée » on a launch card no longer in the list of cards (« ${GONE} »)`)])
  // Rejoué : la nouvelle carte est là, plus rien à faire.
  expect(orphanCardPlans({ ...CTX, pistes: after, cards: [pistesCard(NEW(), NOW), pistesCard('kautre001', NOW)] }).plans).toEqual([])
})

test('dans le doute rien : boîte illisible, carte gardée hors forme, mission au lancement hors forme, siège trop récent, endroit inconnu ; liste commitée dans le projet : rien, et le relevé le dit (fonction pure)', () => {
  const ctx = { ...CTX, pistes: itsPistes() }
  expect(orphanCardPlans(ctx).plans.map(p => p.card)).toEqual([NEW()])
  expect(orphanCardPlans({ ...ctx, isWhole: false }).plans).toEqual([])
  expect(orphanCardPlans({ ...ctx, cards: [{ id: GONE }] }).plans).toEqual([])
  expect(orphanCardPlans({ ...ctx, runs: [carrier({ launch: { id: 'x' } })] }).plans).toEqual([])
  // Un siège pris depuis moins que la vie d'un lancement gardé : un clic « Lancer » d'une discussion de l'autre stockage peut encore courir.
  expect(orphanCardPlans({ ...ctx, isSeatOld: false })).toEqual({ plans: [], left: [] })
  expect(orphanCardPlans({ ...ctx, where: undefined })).toEqual({ plans: [], left: [] })
  const repo = orphanCardPlans({ ...ctx, where: 'repo' })
  expect(repo.plans).toEqual([])
  expect(repo.left).toEqual([expect.stringContaining('the retro waitlist lives in the project, so that card may live in another computer')])
  // Une carte qu'une mission ou un lancement porte encore : pas de ligne, même liste commitée (état normal).
  expect(orphanCardPlans({ ...ctx, where: 'repo', isTaken: card => card === GONE })).toEqual({ plans: [], left: [] })
  // Une piste « en ticket » ou « en exécution » porte encore la carte (sa mission absente des copies, sans trace) : rien.
  for (const state of ['ticket', 'running'] as const) expect(orphanCardPlans({ ...ctx, pistes: [...itsPistes(), piste('retroA/p5', { state, mission: 'minconnu' })] }).plans).toEqual([])
  // Une piste « faite » d'une mission absente des copies sans trace d'effacement retient la carte, et le relevé le dit ;
  // effacée (trace vue), elle ne la retient plus. Une piste « en exécution » d'une mission effacée la retient aussi.
  const done = [...itsPistes(), piste('retroA/p7', { state: 'done', mission: 'minconnu' })]
  const unknown = orphanCardPlans({ ...ctx, pistes: done, erased: new Set() })
  expect(unknown.plans).toEqual([])
  expect(unknown.left).toEqual([expect.stringContaining(`Pistes « retroA/p1 », « retroA/p2 » are « validée » on a launch card no longer in the list of cards (« ${GONE} »), still held by a piste of a mission`)])
  expect(orphanCardPlans({ ...ctx, pistes: done, erased: new Set(['minconnu']) }).plans.map(p => p.card)).toEqual([NEW()])
  expect(orphanCardPlans({ ...ctx, pistes: [...itsPistes(), piste('retroA/p8', { state: 'running', mission: 'minconnu' })], erased: new Set(['minconnu']) }).left).toEqual([expect.stringContaining('still held by a piste of a mission')])
  // Une opération sans marque (au dernier passage des boîtes) vise une des pistes : pas de carte posée, et le relevé le dit.
  const pending = orphanCardPlans({ ...ctx, pending: ['retroA/p2'] })
  expect(pending.plans).toEqual([])
  expect(pending.left).toEqual([expect.stringContaining('but a change of « retroA/p2 » still waits in a piste box')])
  // La nouvelle carte déjà lancée ou tenue par un clic : rien, et le relevé le dit.
  const taken = orphanCardPlans({ ...ctx, isTaken: card => card === NEW() })
  expect(taken.plans).toEqual([])
  expect(taken.left).toEqual([expect.stringContaining(`(${NEW()}) is already launched or being clicked`)])
})

test('l’écriture revérifie le plan sur ce qu’elle relit : une opération sans marque sur une piste retient toute la carte (dit au relevé) ; une mission, l’endroit, une boîte qui change : rien (fonction pure)', () => {
  const plans = orphanCardPlans({ ...CTX, pistes: itsPistes() }).plans
  const op = { op: { id: 'oppppppp1', op: 'comment' as const, piste: 'retroA/p1', by: 'coo', at: NOW, text: 'x' }, session: 'session-C', by: 'coo' }
  const held = applyOrphanCards(listWith(itsPistes()), plans, NOW, { ...WRITE, ops: [op] })
  expect(held.moved.size).toBe(0)
  expect(held.left).toEqual([expect.stringContaining('but a change of « retroA/p1 » still waits in a piste box: they keep that card')])
  expect(applyOrphanCards(listWith(itsPistes()), plans, NOW, { ...WRITE, copies: [[carrier()], []] }).moved.size).toBe(0)
  expect(applyOrphanCards(listWith(itsPistes()), plans, NOW, { ...WRITE, isWhole: false }).moved.size).toBe(0)
  expect(applyOrphanCards(listWith(itsPistes()), plans, NOW, { ...WRITE, where: 'repo' }).moved.size).toBe(0)
  // Une piste de plus sur la carte depuis le plan : le plan n'est plus le même, rien (le relevé suivant en refait un).
  expect(applyOrphanCards(listWith([...itsPistes(), piste('retroA/p6')]), plans, NOW, WRITE).moved.size).toBe(0)
  expect([...applyOrphanCards(listWith(itsPistes()), plans, NOW, WRITE).moved]).toEqual([[NEW(), ['retroA/p1', 'retroA/p2']]])
})

// ─── Le monde du COO ──────────────────────────────────────────────────────

/** Le temps qu'un siège pris attend avant de donner une nouvelle carte (la vie d'un lancement gardé), par pas de 5 s. */
const age = async (clock: any) => {
  for (let i = 0; i < Math.ceil((LAUNCH_TTL_MS + LAUNCH_GRACE_MS + CLOCK_SKEW_MS) / 5000) + 2; i++) await clock.advance(5000)
}
/** Une piste témoin d'une autre carte absente, que rien ne porte : sa nouvelle carte prouve que le relevé a tourné. */
const WITNESS = 'ktemoin01'
const witness = () => piste('retroB/w1', { card: WITNESS })
const WNEW = () => pistesBackCardId(WITNESS, ['retroB/w1'], 'kn')

test('Piste « validée », carte absente, rien ne la porte, toutes les lectures réussies : nouvelle carte, posée sous « Au départ », dite une fois au relevé', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [], itsPistes())
  // Le siège vient d'être pris : rien encore (un clic « Lancer » d'une discussion de l'autre stockage peut courir).
  expect(cardsOf(w)).toEqual([GONE, GONE, undefined])
  await age(clock)
  await settle(clock, 6)
  expect(cardsOf(w)).toEqual([NEW(), NEW(), undefined])
  expect(pistesOf(listOf(w))[0]).toEqual(expect.objectContaining({ state: 'validated', cardBy: 'coo', text: 'Texte de retroA/p1' }))
  const pane = await mount($)
  expect(await findAny(pane, { key: `coo-card-${NEW()}` })).toBeDefined()
  expect(await findAny(pane, { key: `coo-card-goal-${NEW()}` })).toBeDefined()
  await pane.unmount()
  const said = await statement($)
  expect(said).toMatch(/Pistes « retroA\/p1 », « retroA\/p2 » were « validée » on a launch card no longer in the list of cards/)
  expect(said).toContain(`they are on the new launch card « Pistes de rétro » (${NEW()}), ready to launch`)
  expect(await statement($)).not.toMatch(/no longer in the list of cards/)
})

test('nouvelle carte posée, la liste d’attente pas écrite, puis son retrait pas écrit : la carte reste, et le relevé dit de la retirer', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [], itsPistes())
  // La liste d'attente ne s'écrit pas (aucune piste ne passe sur la carte posée) ; la liste des cartes s'écrit une fois.
  let cardWrites = 0
  const isCards = (k: string) => k.endsWith(`/${PROJECT}.cartes.json`) || k === 'coo-cards:'
  const isWaitlist = (k: string) => k.endsWith(`/flow-board/pistes/${PROJECT}.json`) || k === 'coo-pistes:'
  w.probe.refuseWrite = p => isWaitlist(p) || (isCards(p) && ++cardWrites > 1)
  w.probe.refuseStore = k => isWaitlist(k) || (isCards(k) && ++cardWrites > 1)
  await age(clock)
  await settle(clock, 6)
  expect(cardsOf(w)).toEqual([GONE, GONE, undefined])
  expect(cardWrites).toBeGreaterThan(1)
  const said = await statement($)
  expect(said).toContain(`Launch cards « Pistes de rétro » « ${NEW()} », posted by this statement, may carry no piste and could not be removed`)
})
test('les lignes gardées pour le relevé ne se lisent pas : la nouvelle carte est dite quand même, jamais en silence', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  // Une ligne d'avant attend encore son relevé ; puis le stockage refuse la lecture des lignes.
  w.mem['coo-pistes-rendues:'] = ['Mission « mavant01 » is finished: une ligne d’avant.']
  w.probe.refuseRead = key => key === 'coo-pistes-rendues:'
  await cooWith($, clock, w, [], itsPistes())
  await age(clock)
  await settle(clock, 6)
  expect(cardsOf(w)).toEqual([NEW(), NEW(), undefined])
  expect(await statement($)).toMatch(/Pistes « retroA\/p1 », « retroA\/p2 » were « validée » on a launch card no longer in the list of cards/)
  expect(await statement($)).not.toMatch(/no longer in the list of cards/)
  // Relisible : la ligne d'avant n'a pas été écrasée, elle est dite.
  w.probe.refuseRead = undefined
  expect(await statement($)).toContain('une ligne d’avant')
})
test('une carte « Pistes de rétro » ne se lance que du COO qui tient le siège (la vue Coordination n’est montrée qu’au siège) : le délai du siège suffit', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [], itsPistes())
  await age(clock)
  await settle(clock, 6)
  expect(cardsOf(w)).toEqual([NEW(), NEW(), undefined])
  // La vue montrée ici quand le siège y était ; le siège part dans une autre discussion avant le clic : il ne lance rien.
  const view = await mount($)
  expect(await findAny(view, { key: `coo-card-manual-${NEW()}` })).toBeDefined()
  const now = await clock.now()
  writeBoard(w, b => ({ ...b, coo: seatOf('session-autre', now + 1000) }))
  await pressAny(view, { key: `coo-card-manual-${NEW()}` })
  await view.unmount()
  await settle(clock, 2)
  expect(Object.keys(w.mem).filter(k => k.startsWith('coo-launch:'))).toEqual([])
  // Hors du siège, la vue Coordination n'est pas montrée : aucun bouton à presser.
  const away = await mount($)
  expect(await findAny(away, { key: `coo-card-manual-${NEW()}` })).toBeUndefined()
  await away.unmount()
})
test('Piste « validée », sa carte présente chez le COO : rien (rejoué au relevé suivant, la carte est là)', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [], itsPistes())
  await age(clock)
  await settle(clock, 6)
  expect(cardsOf(w)).toEqual([NEW(), NEW(), undefined])
  const before = JSON.stringify(listOf(w))
  await settle(clock, 12)
  expect(JSON.stringify(listOf(w))).toBe(before)
})

test('Piste « validée », carte absente, une mission (archivée comprise) porte cette carte ou son dossier : rien', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [carrier()], [...itsPistes(), witness()])
  await age(clock)
  await settle(clock, 6)
  expect(cardsOf(w)).toEqual([GONE, GONE, undefined, WNEW()])
  // Son dossier seulement : rien non plus.
  writeBoard(w, b => ({ ...b, runs: [carrier({ updatedAt: NOW, launch: { id: 'lporte0001', card: 'kautre001', at: NOW - 60_000, folder: pistesCardFolder(GONE), start: 'to-tickets', mode: 'manual' } })] }))
  await settle(clock, 12)
  expect(cardsOf(w)).toEqual([GONE, GONE, undefined, WNEW()])
  // Archivée : la fin de la mission les a prises (sa nouvelle carte), jamais une carte de plus.
  writeBoard(w, b => ({ ...b, runs: [carrier({ updatedAt: NOW, status: 'done', archivedAt: NOW })] }))
  await settle(clock, 12)
  expect(cardsOf(w)).not.toContain(NEW())
})

test('Piste « validée », carte absente, un lancement gardé pas périmé la nomme : rien', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [], [])
  await age(clock)
  // Le siège pris depuis longtemps ; le clic « Lancer » vient d'avoir lieu ici (lancement gardé, valable 10 minutes), et les pistes arrivent.
  const at = await clock.now()
  const rec: LaunchRecord = { v: 1, id: 'lporte0002', card: GONE, root: '', title: 'Pistes de rétro', start: 'to-tickets', mode: 'manual', effort: 'high', folder: pistesCardFolder(GONE), at: at - 30_000, by: 'session-COO' }
  w.mem[launchKey(rec.id)] = rec
  const pistes = [...itsPistes(), witness()]
  putList(w, pistes)
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/flow-board/pistes/${PROJECT}.json`)) w.files[k] = JSON.stringify(listWith(pistes))
  await settle(clock, 12)
  expect(cardsOf(w)).toEqual([GONE, GONE, undefined, WNEW()])
})

test('Cartes gardées illisibles, liste ou fichier des missions illisible : rien', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.mem[launchKey('lporte0003')] = { v: 1 }
  w.probe.refuseRead = key => key === launchKey('lporte0003')
  await cooWith($, clock, w, [], itsPistes())
  await age(clock)
  await settle(clock, 6)
  expect(cardsOf(w)).toEqual([GONE, GONE, undefined])
  expect(await statement($)).toMatch(/A kept launch could not be read: the dashboard finished no « Pistes de rétro » mission and gave no piste a new card/)
  // Le lancement relisible, mais le fichier des missions ne se lit plus : rien.
  w.probe.refuseRead = undefined
  delete w.mem[launchKey('lporte0003')]
  w.disk.unreadable = true
  await settle(clock, 12)
  expect(cardsOf(w)).toEqual([GONE, GONE, undefined])
  // Tout se relit : la nouvelle carte.
  w.disk.unreadable = false
  const later = await clock.now()
  writeBoard(w, b => ({ ...b, runs: [], updatedAt: later }))
  await settle(clock, 12)
  expect(cardsOf(w)).toEqual([NEW(), NEW(), undefined])
})

test('liste d’attente illisible : rien n’est écrit par-dessus ; relisible, la nouvelle carte', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: [] }))
  w.files[`flow-board/pistes/${PROJECT}.json`] = '{ pas une liste'
  w.mem['coo-pistes:'] = 'pas une liste'
  await start($)
  await openCoo($, clock)
  await age(clock)
  await settle(clock, 6)
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/flow-board/pistes/${PROJECT}.json`))
  expect(path ? w.files[path] : w.mem['coo-pistes:']).toBe(path ? '{ pas une liste' : 'pas une liste')
  putList(w, itsPistes())
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/flow-board/pistes/${PROJECT}.json`)) w.files[k] = JSON.stringify(listWith(itsPistes()))
  await settle(clock, 12)
  expect(cardsOf(w)).toEqual([NEW(), NEW(), undefined])
})

test('hors du siège : rien ; le siège pris, la nouvelle carte', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: [] }))
  putList(w, itsPistes())
  // Décision A1 : les cartes vivent dans la liste des cartes du projet, que le siège pris relit ; elle ne porte pas la
  // carte des pistes (une autre carte seulement).
  const list = { v: 1, root: '', cards: [pistesCard('kautre001', NOW)] }
  w.files[`flow-board/coordination/${PROJECT}.cartes.json`] = JSON.stringify(list)
  w.mem['coo-cards:'] = JSON.parse(JSON.stringify(list))
  await start($)
  await age(clock)
  await settle(clock, 6)
  expect(cardsOf(w)).toEqual([GONE, GONE, undefined])
  await openCoo($, clock)
  await age(clock)
  await settle(clock, 6)
  expect(cardsOf(w)).toEqual([NEW(), NEW(), undefined])
})
