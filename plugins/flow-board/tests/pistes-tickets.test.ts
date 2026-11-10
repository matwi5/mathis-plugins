// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { sameTicket } from '../hooks/basics.ts'
import { launchKey, type LaunchRecord } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { applyBoxedOps, applyPisteState, emptyWaitlist, keepsPistes, opMark, parsePistesLine, pisteMoves, pistesOf, soundPisteOp, type Piste, type PisteOp, type Waitlist } from '../hooks/pistes.ts'
import { TOOL, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// Les pistes suivent leurs tickets. Invariant de la liste d'attente : « Une écriture d'une rétro ou du COO
// n'efface ni ne change jamais en silence la piste d'une autre ; une piste ne quitte jamais le fichier, et une
// piste en exécution ne change plus. » Les transitions sont posées par le mod de la mission « Pistes de rétro »,
// jamais par un texte d'agent.

const NOW = 700_000_000
const CARD = 'kpistes01'
const MISSION = 'mpistes1'

const piste = (id: string, over: Partial<Piste> = {}): Piste => ({ id, retro: id.slice(0, id.indexOf('/')), text: `Texte de ${id}`, files: [], state: 'validated', card: CARD, by: id.slice(0, id.indexOf('/')), at: NOW - 1000, history: [], comments: [], ...over })
const listWith = (pistes: unknown[]): Waitlist => ({ ...emptyWaitlist(''), pistes })

// ─── Le module pur ────────────────────────────────────────────────────────

test('les transitions de la spec, et elles seules : posées par la mission qui porte la carte, sur ses pistes ; le rejeu est sans effet', () => {
  const list = listWith([piste('retroA/p1')])
  const ticket = applyPisteState(list, { piste: 'retroA/p1', state: 'ticket', group: 'A' }, MISSION, CARD, NOW)
  expect(pistesOf(ticket.list)[0]).toEqual(expect.objectContaining({ state: 'ticket', mission: MISSION, group: 'A', stateBy: MISSION, stateAt: NOW }))
  expect(applyPisteState(ticket.list, { piste: 'retroA/p1', state: 'ticket', group: 'A' }, MISSION, CARD, NOW + 1)).toEqual({ list: ticket.list, outcome: { kind: 'none' } })
  const running = applyPisteState(ticket.list, { piste: 'retroA/p1', state: 'running', group: 'A' }, MISSION, CARD, NOW + 2)
  expect(pistesOf(running.list)[0]!.state).toBe('running')
  // Le groupe revient avec le ticket ouvert : de nouveau en ticket ; puis fait.
  const back = applyPisteState(running.list, { piste: 'retroA/p1', state: 'ticket', group: 'A' }, MISSION, CARD, NOW + 3)
  expect(pistesOf(back.list)[0]!.state).toBe('ticket')
  const done = applyPisteState(back.list, { piste: 'retroA/p1', state: 'done', group: 'A' }, MISSION, CARD, NOW + 4)
  expect(pistesOf(done.list)[0]!.state).toBe('done')
  expect(keepsPistes(running.list, done.list)).toBe(true)
  // Ticket retiré du lot : la piste redevient validée, sa mission et son groupe partent, sa carte reste.
  const withdrawn = applyPisteState(ticket.list, { piste: 'retroA/p1', state: 'validated' }, MISSION, CARD, NOW + 5)
  expect(pistesOf(withdrawn.list)[0]).toEqual(expect.objectContaining({ state: 'validated', card: CARD }))
  expect(pistesOf(withdrawn.list)[0]!.mission).toBeUndefined()
  // Refusées : d'écartée, de faite, de pas encore validée ; vers validée depuis en exécution ; d'une autre carte ; d'une autre mission.
  const refused = (l: Waitlist, state: 'ticket' | 'validated' | 'running' | 'done', by = MISSION, card: string | undefined = CARD) => applyPisteState(l, { piste: 'retroA/p1', state, group: 'A' }, by, card, NOW).outcome.kind
  expect(refused(listWith([piste('retroA/p1', { state: 'dropped', reason: 'x' })]), 'ticket')).toBe('refused')
  expect(refused(done.list, 'ticket')).toBe('refused')
  expect(refused(listWith([piste('retroA/p1', { state: 'pending' })]), 'ticket')).toBe('refused')
  expect(refused(running.list, 'validated')).toBe('refused')
  expect(refused(list, 'ticket', MISSION, 'kautre001')).toBe('refused')
  expect(applyPisteState(list, { piste: 'retroA/p1', state: 'ticket' }, MISSION, undefined, NOW).outcome.kind).toBe('refused')
  expect(refused(ticket.list, 'running', 'mautre01')).toBe('refused')
})

test('une piste en exécution que deux rétros tentent de modifier : refus, rien ne change ; le rejeu de la même transition ne fait rien', () => {
  const list = listWith([piste('retroA/p1', { state: 'running', mission: MISSION, group: 'A' })])
  const ops: PisteOp[] = [
    { id: 'oaaaaaa01', op: 'edit', piste: 'retroA/p1', by: 'retroB', at: NOW, text: 'Autre' },
    { id: 'oaaaaaa02', op: 'comment', piste: 'retroA/p1', by: 'retroC', at: NOW, text: 'Hm' },
    { id: 'oaaaaaa03', op: 'state', piste: 'retroA/p1', by: MISSION, at: NOW, state: 'running', group: 'A' },
  ]
  const out = applyBoxedOps(list, [{ op: ops[0]!, session: 'sB', by: 'retroB' }, { op: ops[1]!, session: 'sC', by: 'retroC' }, { op: ops[2]!, session: 'sM', by: MISSION, card: CARD }], NOW)
  expect(out.list.pistes).toEqual(list.pistes)
  expect(out.list.refused).toHaveLength(2)
  expect(out.outcomes.get(opMark('sM', 'oaaaaaa03'))).toEqual({ kind: 'none' })
  // Une transition ne porte jamais de texte, et un texte d'agent ne passe jamais pour une transition.
  expect(soundPisteOp({ ...ops[2], text: 'x' })).toBeNull()
  expect(soundPisteOp({ ...ops[2], state: 'pending' })).toBeNull()
})

test('la ligne « Pistes : » : absente, gabarit, ancienne forme, inconnue ou d’une autre carte ne rattachent rien et se disent ; bien formée et connue, la piste passe en ticket avec sa mission et son groupe', () => {
  expect(parsePistesLine('# 01\n\nRien ici')).toEqual({ kind: 'absent' })
  expect(parsePistesLine('Pistes : <ids>')).toEqual({ kind: 'template' })
  expect(parsePistesLine('**Pistes :**')).toEqual({ kind: 'template' })
  expect(parsePistesLine('Pistes : p3, retroA/p1')).toEqual({ kind: 'tokens', ids: ['retroA/p1'], odd: ['p3'] })
  // Espace insécable, singulier, casse, commentaire HTML, gabarit à moitié rempli, mot démesuré.
  expect(parsePistesLine(`Pistes${String.fromCodePoint(0x202f)}: retroA/p1`)).toEqual({ kind: 'tokens', ids: ['retroA/p1'], odd: [] })
  expect(parsePistesLine('piste : retroA/p1 <!-- avec p2 -->')).toEqual({ kind: 'tokens', ids: ['retroA/p1'], odd: [] })
  expect(parsePistesLine('Pistes : retroA/p1, <ids>')).toEqual({ kind: 'tokens', ids: ['retroA/p1'], odd: [] })
  // Une citation d'une piste avant la ligne : jamais lue pour elle.
  expect(parsePistesLine('> Piste : rendre la revue moins chère\n- Piste : texte\n\nPistes : retroA/p1')).toEqual({ kind: 'tokens', ids: ['retroA/p1'], odd: [] })
  expect((parsePistesLine(`Pistes : ${'x'.repeat(500)}`) as any).odd[0]).toHaveLength(60)
  const pistes = [piste('retroA/p1'), piste('retroA/p2', { card: 'kautre001' }), piste('retroA/p3', { state: 'pending' })]
  const ctx = { card: CARD, mission: MISSION, tickets: [{ id: '01', status: 'todo' }, { id: '02', status: 'todo' }], groups: [{ id: 'A', tickets: ['01'], isOut: false }, { id: 'B', tickets: ['02'], isOut: false }], isComplete: true, sameTicket }
  const forms = (line: string) => pisteMoves(pistes, { ...ctx, links: [{ ticket: '01', line: parsePistesLine(line) }] })
  expect(forms('Rien').moves).toEqual([])
  expect(forms('Rien').warnings).toEqual(['ticket 01: it has no « Pistes : » line, nothing linked'])
  expect(forms('Pistes : <ids>').moves).toEqual([])
  expect(forms('Pistes : <ids>').warnings[0]).toMatch(/still the template/)
  expect(forms('Pistes : p3').warnings[0]).toMatch(/« p3 » is not a piste id/)
  expect(forms('Pistes : retroZ/p9').warnings[0]).toMatch(/is not in the waitlist/)
  expect(forms('Pistes : retroA/p2').warnings[0]).toMatch(/another launch card/)
  expect(forms('Pistes : retroA/p3').warnings[0]).toMatch(/is not validated/)
  expect(forms('Pistes : retroA/p1')).toEqual({ moves: [{ piste: 'retroA/p1', state: 'ticket', group: 'A' }], warnings: [] })
})

test('les états suivent le lot : groupe parti, groupe revenu le ticket ouvert, ticket fait, ticket retiré ; une piste validée passe d’abord en ticket', () => {
  const links = [{ ticket: '01', line: parsePistesLine('Pistes : retroA/p1') }]
  const base = { card: CARD, mission: MISSION, links, isComplete: true, sameTicket }
  const inTicket = [piste('retroA/p1', { state: 'ticket', mission: MISSION, group: 'A' })]
  const groups = (isOut: boolean) => [{ id: 'A', tickets: ['01'], isOut }, { id: 'B', tickets: [], isOut: false }]
  expect(pisteMoves(inTicket, { ...base, tickets: [{ id: '01', status: 'doing' }], groups: groups(true) }).moves).toEqual([{ piste: 'retroA/p1', state: 'running', group: 'A' }])
  const running = [piste('retroA/p1', { state: 'running', mission: MISSION, group: 'A' })]
  expect(pisteMoves(running, { ...base, tickets: [{ id: '01', status: 'doing' }], groups: groups(false) }).moves).toEqual([{ piste: 'retroA/p1', state: 'ticket', group: 'A' }])
  expect(pisteMoves(running, { ...base, tickets: [{ id: '01', status: 'done' }], groups: groups(false) }).moves).toEqual([{ piste: 'retroA/p1', state: 'done', group: 'A' }])
  expect(pisteMoves([piste('retroA/p1')], { ...base, tickets: [{ id: '01', status: 'done' }], groups: groups(false) }).moves).toEqual([{ piste: 'retroA/p1', state: 'ticket', group: 'A' }])
  // Ticket retiré : la piste en ticket redevient validée, seulement sur des fichiers tous relus ; une piste en exécution attend.
  expect(pisteMoves(inTicket, { ...base, tickets: [], groups: groups(false) }).moves).toEqual([{ piste: 'retroA/p1', state: 'validated' }])
  expect(pisteMoves(inTicket, { ...base, tickets: [], groups: groups(false), isComplete: false }).moves).toEqual([])
  // Un ticket du lot sans fichier relu (dossier disparu) : rien ne redevient validé.
  expect(pisteMoves(inTicket, { ...base, links: [], tickets: [{ id: '02', status: 'todo' }], groups: groups(false) }).moves).toEqual([])
  // Une piste nommée par deux tickets : le premier dans l'ordre des tickets la garde, l'autre se dit.
  const two = [{ id: '01', status: 'todo' }, { id: '02', status: 'todo' }]
  const twice = pisteMoves([piste('retroA/p1')], { ...base, links: [{ ticket: '02', line: parsePistesLine('Pistes : retroA/p1') }, { ticket: '01', line: parsePistesLine('Pistes : retroA/p1') }], tickets: two, groups: [{ id: 'A', tickets: ['01'], isOut: false }, { id: 'B', tickets: ['02'], isOut: false }] })
  expect(twice.moves).toEqual([{ piste: 'retroA/p1', state: 'ticket', group: 'A' }])
  expect(twice.warnings).toEqual(['ticket 02: piste retroA/p1 is already named by ticket 01, which keeps it'])

  // En exécution dans un autre groupe : d'abord en ticket.
  expect(pisteMoves(running, { ...base, tickets: [{ id: '01', status: 'doing' }], groups: [{ id: 'A', tickets: [], isOut: false }, { id: 'B', tickets: ['01'], isOut: true }] }).moves).toEqual([{ piste: 'retroA/p1', state: 'ticket', group: 'B' }])
  // En exécution, ticket retiré : rien tant que le groupe travaille ; revenu, la piste repasse en ticket.
  expect(pisteMoves(running, { ...base, tickets: [], groups: groups(true) }).moves).toEqual([])
  expect(pisteMoves(running, { ...base, tickets: [], groups: groups(false) }).moves).toEqual([{ piste: 'retroA/p1', state: 'ticket', group: 'A' }])
})

// ─── Le mod ───────────────────────────────────────────────────────────────

/** Le nom des fichiers du projet de ces tests (racine vide) sur ce poste, comme `coordinationName`. */
const PROJECT = 'sans-projet-811c9dc5'
/** Pose la liste d'attente : au fichier du poste (par la fin de son chemin) et dans le stockage. */
const putList = (w: World, list: Waitlist) => {
  w.files[`flow-board/pistes/${PROJECT}.json`] = JSON.stringify(list)
  w.mem['coo-pistes:'] = list
}
const boxOf = (w: World, session: string): { ops: any[] } | undefined => {
  const path = Object.keys(w.files).find(p => p.includes('/flow-board/pistes/boites/') && p.endsWith(`.${session}.json`))
  return (path ? JSON.parse(w.files[path]!) : w.mem[`pistes-boite::${session}`]) as { ops: any[] } | undefined
}
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)

/** La mission « Pistes de rétro » ouverte ici par sa carte ; rend son id. */
const pistesMission = async ($: any, w: World, clock: any): Promise<string> => {
  const rec: LaunchRecord = { v: 1, id: 'lpistes0001', card: CARD, root: '', title: 'Pistes de rétro', start: 'to-tickets', mode: 'manual', effort: 'high', folder: 'pistes-de-retro', at: NOW - 30_000, by: 'session-COO' }
  w.mem[launchKey(rec.id)] = rec
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  const consumed = $.tool.call({ tool: TOOL, launch: rec.id } as any)
  await settle(clock, 3)
  expect(String(((await consumed) as any).result)).toMatch(/Launch: consumed/)
  return stored(w).activeId!
}

test('la mission « Pistes de rétro » dépose « en ticket » pour la piste que son ticket nomme, une fois ; une ligne en gabarit se dit au manager', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putList(w, listWith([piste('retroA/p1'), piste('retroA/p2')]))
  w.files['travail/pistes-de-retro/issues/01-borner.md'] = '# 01: Borner\n\n**Status:** ready-for-agent\n\nPistes : retroA/p1\n'
  w.files['travail/pistes-de-retro/issues/02-autre.md'] = '# 02: Autre\n\n**Status:** ready-for-agent\n\nPistes : <ids>\n'
  const mission = await pistesMission($, w, clock)
  await call($, { tickets: [{ id: '01', name: 'Borner' }, { id: '02', name: 'Autre' }], groups: [{ id: 'A', name: 'Un', tickets: ['01'] }, { id: 'B', name: 'Deux', tickets: ['02'] }] })
  await settle(clock, 12)
  const ops = boxOf(w, 'session-A')!.ops
  expect(ops).toEqual([expect.objectContaining({ op: 'state', piste: 'retroA/p1', by: mission, state: 'ticket', group: 'A' })])
  const said = await call($, { note: 'où en est-on' })
  expect(said).toMatch(/Pistes lines that linked nothing .*ticket 02: its . Pistes : . line is still the template/)
  // Dit une fois.
  expect(await call($, { note: 'encore' })).not.toMatch(/Pistes lines that linked nothing/)
})

test('chez le COO, la transition d’une mission qui porte la carte s’applique ; d’une mission sans cette carte, refusée ; rien ne change en silence', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const pistesRun = { ...newRun('to-tickets', NOW - 50_000, 'Pistes de rétro'), status: 'active', owner: 'session-P', launch: { id: 'lpistes0001', card: CARD, at: NOW - 60_000, folder: 'pistes-de-retro', start: 'to-tickets', mode: 'auto' } } as any
  const other = { ...newRun('implement', NOW - 50_000, 'Autre'), status: 'active', owner: 'session-Q' } as any
  writeBoard(w, b => ({ ...b, runs: [pistesRun, other] }))
  putList(w, listWith([piste('retroA/p1'), piste('retroA/p2')]))
  await start($)
  await openCoo($, clock)
  // Les deux boîtes, posées à côté de celle que la discussion d'ici écrira (le même dossier), ou dans le stockage.
  const put = (session: string, ops: unknown[]) => {
    const box = { v: 1, root: '', session, ops }
    w.files[`flow-board/pistes/boites/${PROJECT}.${session}.json`] = JSON.stringify(box)
    w.mem[`pistes-boite::${session}`] = box
  }
  put('session-P', [{ id: 'oppppppp1', op: 'state', piste: 'retroA/p1', by: pistesRun.id, at: NOW, state: 'ticket', group: 'A' }])
  put('session-Q', [{ id: 'oqqqqqqq1', op: 'state', piste: 'retroA/p2', by: other.id, at: NOW, state: 'ticket', group: 'A' }])
  await settle(clock, 6)
  const list = (() => {
    const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/flow-board/pistes/${PROJECT}.json`))
    return (path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist
  })()
  const [p1, p2] = pistesOf(list)
  expect(p1).toEqual(expect.objectContaining({ state: 'ticket', mission: pistesRun.id, group: 'A' }))
  expect(p2!.state).toBe('validated')
  expect(list.refused).toEqual([expect.objectContaining({ piste: 'retroA/p2', why: 'the piste is not carried by the launch card of this mission' })])
  // Le relevé montre la mission et le groupe de la piste en ticket.
  const turn = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(turn).toContain(`en ticket (mission ${pistesRun.id}, group A)`)
})
