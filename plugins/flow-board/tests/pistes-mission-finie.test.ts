// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import type { Run } from '../types'
import { isPistesCard, launchKey, pistesCard, pistesCardFolder, type LaunchRecord } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { emptyWaitlist, finishMissionPistes, keepsPistes, parsePistesLine, pistesOf, releaseCardPistes, type Piste, type Waitlist } from '../hooks/pistes.ts'
import { pistesBackCardId } from '../hooks/retro-coo.ts'
import { applyPistesFinish, finishedLinesOf, pistesMissionEnd, planPistesFinish } from '../hooks/pistes-fin.ts'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, stored, writeBoard, world, type World } from './monde-coordination.ts'
import { findAllAny, pressAny } from './page-coo.ts'

// Les pistes d'une mission « Pistes de rétro » finie, rendues par le relevé du COO. Invariant des pistes rendues : « Le COO ne
// sort une piste de « en ticket » ou « en exécution » que pour une mission finie dont aucun groupe n'est chez un
// worker ; il ne la dit faite que si un ticket fait la nomme ; aucune piste ne quitte la liste ni ne change de texte. »

const NOW = 700_000_000
const CARD = 'kpistes01'
const FOLDER = 'pistes-de-retro-pistes01'
/** Le nom des fichiers du projet de ces tests (racine vide) sur ce poste, comme `coordinationName`. */
const PROJECT = 'sans-projet-811c9dc5'

const piste = (id: string, over: Partial<Piste> = {}): Piste => ({ id, retro: id.slice(0, id.indexOf('/')), text: `Texte de ${id}`, files: [], state: 'validated', card: CARD, by: id.slice(0, id.indexOf('/')), at: NOW - 1000, history: [], comments: [], ...over })
const listWith = (pistes: unknown[]): Waitlist => ({ ...emptyWaitlist(''), pistes })

/** La mission « Pistes de rétro » de ces tests : lancée par la carte, deux tickets, deux groupes. */
const mission = (over: Partial<Run> = {}): Run =>
  ({
    ...newRun('implement', NOW - 50_000, 'Pistes de rétro'),
    id: 'mpistes1',
    status: 'done',
    launch: { id: 'lpistes0001', card: CARD, at: NOW - 60_000, folder: FOLDER, start: 'to-tickets', mode: 'auto' },
    tickets: [
      { id: '01', name: 'Un', status: 'done' },
      { id: '02', name: 'Deux', status: 'todo' },
    ],
    groups: [
      { id: 'A', name: 'a', tickets: ['01'] },
      { id: 'B', name: 'b', tickets: ['02'] },
    ],
    ...over,
  }) as unknown as Run

/** Ce qu'une piste porte et que le COO ne doit jamais toucher : des fichiers, un texte précédent, un commentaire. */
const lived = (id: string) => ({ files: [`hooks/${id.slice(-2)}.ts`], history: [{ text: `Ancien texte de ${id}`, files: [], by: 'retroB', at: NOW - 900 }], comments: [{ text: `Note sur ${id}`, by: 'coo', at: NOW - 800 }] })
/** Ses pistes : p1 nommée par le ticket fait, p2 par le ticket ouvert (en exécution), p3 par aucun (en ticket). */
const itsPistes = (): Piste[] => [
  piste('retroA/p1', { state: 'ticket', mission: 'mpistes1', group: 'A', ...lived('retroA/p1') }),
  piste('retroA/p2', { state: 'running', mission: 'mpistes1', group: 'B', ...lived('retroA/p2') }),
  piste('retroA/p3', { state: 'ticket', mission: 'mpistes1', ...lived('retroA/p3') }),
]
/** La carte des pistes rendues dans le cas de base : p2 et p3. */
const BACK = () => pistesBackCardId('mpistes1', ['retroA/p2', 'retroA/p3'])
const putTickets = (w: World) => {
  w.files[`travail/${FOLDER}/issues/01-un.md`] = '# 01: Un\n\n**Status:** done\n\nPistes : retroA/p1\n'
  w.files[`travail/${FOLDER}/issues/02-deux.md`] = '# 02: Deux\n\n**Status:** ready-for-agent\n\nPistes : retroA/p2\n'
}
const putList = (w: World, pistes: unknown[]) => {
  const list = listWith(pistes)
  w.files[`flow-board/pistes/${PROJECT}.json`] = JSON.stringify(list)
  w.mem['coo-pistes:'] = list
}
const listOf = (w: World): Waitlist => {
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/flow-board/pistes/${PROJECT}.json`))
  return (path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist
}
const stateOf = (w: World) => Object.fromEntries(pistesOf(listOf(w)).map(p => [p.id, p.state]))
const texts = async (pane: any): Promise<string> => ((await findAllAny(pane, { type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')
const mount = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
const statement = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))

/** Le COO ouvert ici sur une mission et des pistes ; quelques relevés passent. */
const cooWith = async ($: any, clock: any, w: World, runs: Run[], pistes: unknown[], change: (b: any) => any = b => b) => {
  writeBoard(w, b => change({ ...b, runs }))
  putList(w, pistes)
  await start($)
  await openCoo($, clock)
  await settle(clock, 12)
}

// ─── La fonction pure ─────────────────────────────────────────────────────

test('Finie, tous ses tickets relus, un ticket fait nomme la piste : « faite » ; piste nommée par aucun ticket fait : « validée », sur la nouvelle carte (fonction pure)', () => {
  const list = listWith(itsPistes())
  const out = finishMissionPistes(list, { mission: 'mpistes1', doneIds: new Set(['retroA/p1']), card: 'kqnouvelle', oldCard: CARD }, NOW)
  const [p1, p2, p3] = pistesOf(out.list)
  expect(p1).toEqual(expect.objectContaining({ state: 'done', mission: 'mpistes1', group: 'A', card: CARD, stateBy: 'coo', stateAt: NOW }))
  expect(p2).toEqual(expect.objectContaining({ state: 'validated', card: 'kqnouvelle', stateBy: 'coo', stateAt: NOW, cardBy: 'coo', cardAt: NOW }))
  expect(p2!.mission).toBeUndefined()
  expect(p2!.group).toBeUndefined()
  expect(p3).toEqual(expect.objectContaining({ state: 'validated', card: 'kqnouvelle' }))
  expect(out).toEqual(expect.objectContaining({ done: ['retroA/p1'], back: ['retroA/p2', 'retroA/p3'], fromRunning: ['retroA/p2'] }))
  // Ni texte, ni fichiers, ni commentaires, ni historique ne changent ; la garde admet l'écriture avec les pistes sorties d'en exécution.
  for (const [a, b] of pistesOf(list).map((p, i) => [p, pistesOf(out.list)[i]!] as const)) expect([b.text, b.files, b.comments, b.history]).toEqual([a.text, a.files, a.comments, a.history])
  expect(keepsPistes(list, out.list, new Set(), new Set(out.fromRunning))).toBe(true)
  expect(keepsPistes(list, out.list)).toBe(false)
  // La nouvelle carte est une carte « Pistes de rétro » comme celle d'un découpage (lancement, retrait) : la
  // même pour les mêmes pistes (rejouée), une autre pour d'autres pistes (seconde fin de la mission) ou une autre mission.
  expect(isPistesCard(pistesCard(BACK(), NOW))).toBe(true)
  expect(pistesBackCardId('mpistes1', ['retroA/p3', 'retroA/p2'])).toBe(BACK())
  expect(pistesBackCardId('mpistes1', ['retroA/p4'])).not.toBe(BACK())
  expect(pistesBackCardId('mpistes2', ['retroA/p2', 'retroA/p3'])).not.toBe(BACK())
  expect(BACK()).not.toBe(CARD)
  // Rejoué : plus rien à faire.
  expect(finishMissionPistes(out.list, { mission: 'mpistes1', doneIds: new Set(['retroA/p1']), card: 'kqnouvelle', oldCard: CARD }, NOW + 1).list).toBe(out.list)
})

test('Piste d’une autre mission, d’une autre carte, ou gardée illisible : jamais touchée (fonction pure)', () => {
  const broken = { id: 'retroA/p9', state: 'ticket', mission: 'mpistes1' }
  const list = listWith([
    piste('retroA/p4', { state: 'ticket', mission: 'mautre01' }),
    piste('retroA/p5', { state: 'ticket', mission: 'mpistes1', card: 'kautre001' }),
    broken,
    piste('retroA/p6', { state: 'validated' }),
    piste('retroA/p7', { state: 'dropped', reason: 'x' }),
  ])
  const out = finishMissionPistes(list, { mission: 'mpistes1', doneIds: new Set(), card: 'kqnouvelle', oldCard: CARD }, NOW)
  expect(pistesOf(out.list).filter(p => p.id !== 'retroA/p6')).toEqual(pistesOf(list).filter(p => p.id !== 'retroA/p6'))
  expect(out.list.pistes[2]).toBe(broken)
  expect(out.back).toEqual([])
  // Une piste que le COO garde (un worker la tient peut-être) ne bouge pas non plus.
  const kept = finishMissionPistes(listWith(itsPistes()), { mission: 'mpistes1', doneIds: new Set(), card: 'kqnouvelle', keep: new Set(['retroA/p2']) }, NOW)
  expect(pistesOf(kept.list).map(p => p.state)).toEqual(['validated', 'running', 'validated'])
  // Un auteur de carte hors forme rend la piste illisible : jamais touchée.
  const odd = { ...piste('retroA/p1', { state: 'ticket', mission: 'mpistes1' }), cardBy: 42 }
  expect(finishMissionPistes(listWith([odd]), { mission: 'mpistes1', doneIds: new Set(), card: 'kqnouvelle' }, NOW).list.pistes[0]).toBe(odd)
})

test('les pistes « validée » restées sur la carte de la mission finie passent sur la nouvelle carte, leur état gardé, avec qui et quand ; « ✕ Retirer » efface la carte, son auteur et sa date (fonction pure)', () => {
  const list = listWith([...itsPistes(), piste('retroA/p4', lived('retroA/p4')), piste('retroA/p5', { card: 'kautre001' })])
  const out = finishMissionPistes(list, { mission: 'mpistes1', doneIds: new Set(['retroA/p1']), card: 'kqnouvelle', oldCard: CARD }, NOW)
  const p4 = pistesOf(out.list)[3]!
  expect(p4).toEqual(expect.objectContaining({ state: 'validated', card: 'kqnouvelle', cardBy: 'coo', cardAt: NOW, ...lived('retroA/p4') }))
  expect(p4.stateBy).toBeUndefined()
  expect(out.moved).toEqual(['retroA/p4'])
  expect(pistesOf(out.list)[4]!.card).toBe('kautre001')
  expect(keepsPistes(list, out.list, new Set(), new Set(out.fromRunning))).toBe(true)
  const released = releaseCardPistes(out.list, 'kqnouvelle', NOW + 1).list
  const r4 = pistesOf(released)[3]!
  expect([r4.state, r4.card, r4.cardBy, r4.cardAt]).toEqual(['pending', undefined, undefined, undefined])
})


test('Effacée : une piste passée « en exécution » après le plan, son opération déjà sortie de la boîte, reste « en exécution » (fonction pure)', () => {
  // Le plan a vu p1 et p3 « en ticket » ; avant l'écriture, la mission (encore vivante) a fait passer p1 en exécution, et sa boîte s'est vidée.
  const plan = { mission: 'mpistes1', end: 'erased' as const, doneIds: new Set<string>(), keep: new Set<string>(), card: 'kqnouvelle' }
  const now = listWith([piste('retroA/p1', { state: 'running', mission: 'mpistes1', group: 'A' }), piste('retroA/p3', { state: 'ticket', mission: 'mpistes1' })])
  const out = applyPistesFinish(now, [plan], NOW, { copies: [[], []], ops: [], isWhole: true, erased: new Set(['mpistes1']) })
  expect(pistesOf(out.list).map(p => [p.id, p.state])).toEqual([['retroA/p1', 'running'], ['retroA/p3', 'validated']])
  expect([...out.viaTicket]).toEqual([])
})

test('Finie, toutes ses pistes nommées par un ticket fait : le relevé les dit « faite », sans annoncer de carte (fonction pure)', () => {
  const plan = { mission: 'mpistes1', end: 'finished' as const, doneIds: new Set(['retroA/p1']), keep: new Set<string>(), card: 'kqnouvelle', oldCard: CARD }
  const after = [piste('retroA/p1', { state: 'done', mission: 'mpistes1' })]
  const [line] = finishedLinesOf([plan], new Map([['mpistes1', { done: ['retroA/p1'], back: [], moved: [] }]]), after)
  expect(line).toContain('« faite » (a done ticket names them): « retroA/p1 »;')
  expect(line).not.toContain('kqnouvelle')
})

test('Finie, toutes ses pistes nommées par un ticket fait : son plan ne porte pas de carte à poser (fonction pure)', () => {
  const pistes = [piste('retroA/p1', { state: 'ticket', mission: 'mpistes1', group: 'A' })]
  const lots = new Map([['mpistes1', { links: [{ ticket: '01', line: parsePistesLine('Pistes : retroA/p1') }, { ticket: '02', line: parsePistesLine('Pistes : retroA/p2') }], isComplete: true }]])
  const { plans } = planPistesFinish({ pistes, copies: [[mission()], []], erased: new Set(), candidates: ['mpistes1'], lots: lots as any, pendingBy: [], isWhole: true, isTaken: () => false })
  expect(plans.map(p => [p.mission, p.isCardless])).toEqual([['mpistes1', true]])
})
test('Effacée, la carte de ses pistes rendues déjà lancée ou tenue par un clic : rien, et le relevé le dit (fonction pure)', () => {
  const pistes = [piste('retroA/p3', { state: 'ticket', mission: 'mpistes1' })]
  const ctx = { pistes, copies: [[], []], erased: new Set(['mpistes1']), candidates: ['mpistes1'], lots: new Map(), pendingBy: [], isWhole: true }
  const taken = planPistesFinish({ ...ctx, isTaken: () => true })
  expect(taken.plans).toEqual([])
  expect(taken.left.join('\n')).toContain('was deleted, but the launch card for its pistes given back')
  expect(planPistesFinish({ ...ctx, isTaken: () => false }).plans.map(p => p.mission)).toEqual(['mpistes1'])
})
// ─── Le monde du COO ──────────────────────────────────────────────────────

test('Finie, tous ses tickets relus : la piste du ticket fait « faite », les autres « validée » sur une seule nouvelle carte, posée dans « Lancements » ; le relevé le dit une fois ; rejoué, rien de plus', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putTickets(w)
  await cooWith($, clock, w, [mission()], itsPistes())
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'done', 'retroA/p2': 'validated', 'retroA/p3': 'validated' })
  const card = BACK()
  const back = pistesOf(listOf(w)).filter(p => p.state === 'validated')
  expect(back.map(p => [p.card, p.stateBy, p.mission])).toEqual([[card, 'coo', undefined], [card, 'coo', undefined]])
  const pane = await mount($)
  const shown = await texts(pane)
  await pane.unmount()
  expect(shown).toContain(`travail/${pistesCardFolder(card)}/`)
  const said = await statement($)
  expect(said).toMatch(/Mission « mpistes1 » is finished: the dashboard closed its pistes/)
  expect(said).toContain('« faite » (a done ticket names them): « retroA/p1 »')
  expect(said).toContain('back to « validée »: « retroA/p2 », « retroA/p3 »;')
  expect(said).toContain(`the « validée » ones are on the new launch card « Pistes de rétro » (${card}), ready to launch`)
  // Rejoué au relevé suivant : rien ne bouge, et la ligne ne revient pas.
  const before = JSON.stringify(listOf(w))
  await settle(clock, 12)
  expect(JSON.stringify(listOf(w))).toBe(before)
  expect(await statement($)).not.toMatch(/closed its pistes/)
})

test('Mission en cours ou en pause, pas archivée : rien, son mod s’en charge', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putTickets(w)
  await cooWith($, clock, w, [mission({ status: 'paused' } as Partial<Run>)], itsPistes())
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'ticket', 'retroA/p2': 'running', 'retroA/p3': 'ticket' })
  // Archivée, même en pause : finie.
  writeBoard(w, b => ({ ...b, runs: [mission({ status: 'paused', archivedAt: NOW, updatedAt: NOW } as Partial<Run>)] }))
  await settle(clock, 12)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'done', 'retroA/p2': 'validated', 'retroA/p3': 'validated' })
})

test('Finie, un de ses groupes encore chez un worker : rien tant qu’il n’est pas rentré', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putTickets(w)
  const out = mission({ groups: [{ id: 'A', name: 'a', tickets: ['01'] }, { id: 'B', name: 'b', tickets: ['02'], linked: { at: NOW - 1000 } }] } as unknown as Partial<Run>)
  await cooWith($, clock, w, [out], itsPistes())
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'ticket', 'retroA/p2': 'running', 'retroA/p3': 'ticket' })
  // Le groupe rentré : la mission se finit.
  writeBoard(w, b => ({ ...b, runs: [mission({ updatedAt: NOW } as Partial<Run>)] }))
  await settle(clock, 12)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'done', 'retroA/p2': 'validated', 'retroA/p3': 'validated' })
})

test('Finie, lecture incomplète des tickets (un ticket sans fichier, une ligne en gabarit) : rien ; le relevé nomme ces pistes et la raison', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[`travail/${FOLDER}/issues/01-un.md`] = '# 01: Un\n\n**Status:** done\n\nPistes : retroA/p1\n'
  await cooWith($, clock, w, [mission()], itsPistes())
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'ticket', 'retroA/p2': 'running', 'retroA/p3': 'ticket' })
  expect(await statement($)).toMatch(/Mission « mpistes1 » is finished, but its pistes « retroA\/p1 », « retroA\/p2 », « retroA\/p3 » stay as they are: a ticket file is missing or unreadable \(restore it\)\. The dashboard finishes them at the next reading once that is fixed/)
  w.files[`travail/${FOLDER}/issues/02-deux.md`] = '# 02: Deux\n\nPistes : <ids>\n'
  await settle(clock, 12)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'ticket', 'retroA/p2': 'running', 'retroA/p3': 'ticket' })
  expect(await statement($)).toMatch(/the « Pistes : » line of ticket\(s\) 02 is missing or still the template/)
  // La ligne remplie : tout relu, la mission se finit.
  w.files[`travail/${FOLDER}/issues/02-deux.md`] = '# 02: Deux\n\nPistes : retroA/p2\n'
  await settle(clock, 12)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'done', 'retroA/p2': 'validated', 'retroA/p3': 'validated' })
})

test('Effacée : ses pistes « en ticket » « validée », sur la nouvelle carte ; celles « en exécution » restent (un worker les tient peut-être), dites au relevé ; une mission absente sans trace d’effacement : rien', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [], [...itsPistes(), piste('retroA/p8', { state: 'ticket', mission: 'minconnu' })], b => ({ ...b, deleted: [{ id: 'mpistes1', at: NOW - 100 }] }))
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'validated', 'retroA/p2': 'running', 'retroA/p3': 'validated', 'retroA/p8': 'ticket' })
  const card = pistesBackCardId('mpistes1', ['retroA/p1', 'retroA/p3'])
  expect(pistesOf(listOf(w)).filter(p => p.state === 'validated').map(p => p.card)).toEqual([card, card])
  const said = await statement($)
  expect(said).toMatch(/Mission « mpistes1 » was deleted: the dashboard closed its pistes/)
  expect(said).toMatch(/Mission « mpistes1 » was deleted while its pistes « retroA\/p2 » were « en exécution »: a worker may still hold them/)
  expect(said).toMatch(/Pistes « retroA\/p8 » are in a ticket of mission « minconnu », which is in neither copy/)
})

test('une seconde fin de la mission, reprise après le lancement de sa première carte : une autre carte, ses pistes rendues', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putTickets(w)
  // La première carte (p2, p3) a été lancée : une mission « M2 » la porte.
  const first = BACK()
  const m2 = { ...mission({ status: 'active' } as Partial<Run>), id: 'mpistes2', launch: { id: 'lpistes0002', card: first, at: NOW - 30_000, folder: pistesCardFolder(first), start: 'to-tickets', mode: 'auto' }, tickets: [], groups: [] } as unknown as Run
  await cooWith($, clock, w, [mission(), m2], [piste('retroA/p1', { state: 'ticket', mission: 'mpistes1', group: 'A' }), piste('retroA/p4', { state: 'ticket', mission: 'mpistes1' })])
  const second = pistesBackCardId('mpistes1', ['retroA/p4'])
  expect(second).not.toBe(first)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'done', 'retroA/p4': 'validated' })
  expect(pistesOf(listOf(w))[1]!.card).toBe(second)
})

test('Finie : ses pistes « validée » restées sur sa carte passent sur la nouvelle carte, dites au relevé', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putTickets(w)
  await cooWith($, clock, w, [mission()], [...itsPistes(), piste('retroA/p4')])
  const card = pistesBackCardId('mpistes1', ['retroA/p2', 'retroA/p3', 'retroA/p4'])
  expect(pistesOf(listOf(w))[3]).toEqual(expect.objectContaining({ state: 'validated', card, cardBy: 'coo' }))
  expect(await statement($)).toMatch(/still « validée », moved off its spent launch card: « retroA\/p4 »/)
  // Seule une piste « validée » restée : elle passe aussi, sans autre piste de la mission.
})

test('Fichier des missions illisible : rien', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putTickets(w)
  await cooWith($, clock, w, [mission({ status: 'paused' } as Partial<Run>)], itsPistes())
  // La mission close entre-temps, mais le fichier des missions ne se lit plus : rien ne bouge.
  writeBoard(w, b => ({ ...b, runs: [mission()] }))
  w.disk.unreadable = true
  await settle(clock, 12)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'ticket', 'retroA/p2': 'running', 'retroA/p3': 'ticket' })
  // Relisible : la mission close se finit.
  w.disk.unreadable = false
  writeBoard(w, b => ({ ...b, runs: [mission({ updatedAt: NOW } as Partial<Run>)] }))
  await settle(clock, 12)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'done', 'retroA/p2': 'validated', 'retroA/p3': 'validated' })
})

test('la nouvelle carte se retire comme une carte née d’un découpage : ses pistes redeviennent « pas encore validée »', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putTickets(w)
  await cooWith($, clock, w, [mission()], itsPistes())
  const card = BACK()
  const pane = await mount($)
  await pressAny(pane, { key: `coo-card-remove-${card}` })
  await pane.unmount()
  await settle(clock, 2)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'done', 'retroA/p2': 'pending', 'retroA/p3': 'pending' })
  const view = await mount($)
  expect(await texts(view)).not.toContain(`travail/${pistesCardFolder(card)}/`)
  await view.unmount()
})

test('une opération de la mission qui attend encore dans sa boîte (auteur pas prouvé) : rien ne se finit ; les boîtes d’abord', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putTickets(w)
  const box = { v: 1, root: '', session: 'session-P', ops: [{ id: 'oppppppp1', op: 'state', piste: 'retroA/p3', by: 'mpistes1', at: NOW - 10, state: 'ticket', group: 'A' }] }
  w.files[`flow-board/pistes/boites/${PROJECT}.session-P.json`] = JSON.stringify(box)
  w.mem['pistes-boite::session-P'] = box
  await cooWith($, clock, w, [mission()], itsPistes())
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'ticket', 'retroA/p2': 'running', 'retroA/p3': 'ticket' })
  // Aucune carte posée pour rien pendant l'attente, et le relevé dit ce qui retient.
  const pane = await mount($)
  expect(await texts(pane)).not.toContain(`travail/${pistesCardFolder(BACK())}/`)
  await pane.unmount()
  expect(await statement($)).toMatch(/Mission « mpistes1 » is finished, but a change of it still waits in a piste box/)
  // L'opération partie de la boîte (vidée) : la mission se finit.
  const empty = { ...box, ops: [] }
  w.files[`flow-board/pistes/boites/${PROJECT}.session-P.json`] = JSON.stringify(empty)
  w.mem['pistes-boite::session-P'] = empty
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`.session-P.json`)) w.files[k] = JSON.stringify(empty)
  await settle(clock, 12)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'done', 'retroA/p2': 'validated', 'retroA/p3': 'validated' })
})

test('hors du siège : rien ; le siège pris, la mission se finit', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putTickets(w)
  writeBoard(w, b => ({ ...b, runs: [mission()] }))
  putList(w, itsPistes())
  await start($)
  await settle(clock, 12)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'ticket', 'retroA/p2': 'running', 'retroA/p3': 'ticket' })
  await openCoo($, clock)
  await settle(clock, 12)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'done', 'retroA/p2': 'validated', 'retroA/p3': 'validated' })
})

test('liste d’attente illisible : rien n’est écrit par-dessus ; relisible, la mission se finit', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putTickets(w)
  writeBoard(w, b => ({ ...b, runs: [mission()] }))
  w.files[`flow-board/pistes/${PROJECT}.json`] = '{ pas une liste'
  w.mem['coo-pistes:'] = 'pas une liste'
  await start($)
  await openCoo($, clock)
  await settle(clock, 12)
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/flow-board/pistes/${PROJECT}.json`))
  expect(path ? w.files[path] : w.mem['coo-pistes:']).toBe(path ? '{ pas une liste' : 'pas une liste')
  putList(w, itsPistes())
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/flow-board/pistes/${PROJECT}.json`)) w.files[k] = JSON.stringify(listWith(itsPistes()))
  await settle(clock, 12)
  expect(stateOf(w)).toEqual({ 'retroA/p1': 'done', 'retroA/p2': 'validated', 'retroA/p3': 'validated' })
})

test('par le modèle : une mission « Pistes de rétro » découpée, sans groupe lancé, un ticket fait, sa discussion fermée, reste en cours : jamais lue finie', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const rec: LaunchRecord = { v: 1, id: 'lpistes0001', card: CARD, root: '', title: 'Pistes de rétro', start: 'to-tickets', mode: 'manual', effort: 'high', folder: FOLDER, at: NOW - 30_000, by: 'session-COO' }
  w.mem[launchKey(rec.id)] = rec
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  const consumed = $.tool.call({ tool: TOOL, launch: rec.id } as any)
  await settle(clock, 3)
  await consumed
  const ask = async (input: Record<string, unknown>) => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
  await ask({ tickets: [{ id: '01', name: 'Un' }, { id: '02', name: 'Deux' }], groups: [{ id: 'A', name: 'a', tickets: ['01'] }, { id: 'B', name: 'b', tickets: ['02'] }] })
  await ask({ complete: true })
  await ask({ set: [{ id: '01', status: 'done' }] })
  await settle(clock, 3)
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  await settle(clock, 3)
  const run = stored(w).runs.find(r => r.launch?.id === rec.id)!
  expect(run.tickets.find(t => t.id === '01')!.status).toBe('done')
  expect(run.status).toBe('active')
  expect(pistesMissionEnd(run.id, [stored(w).runs], new Set())).toBe('open')
})
