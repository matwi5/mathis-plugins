// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { launchKey, pistesCardFolder, type LaunchRecord } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { applyBoxedOps, emptyWaitlist, isFixedReason, keepsPistes, opMark, pistesOf, soundPisteOp, type BoxedOp, type Piste, type PisteOp, type Waitlist } from '../hooks/pistes.ts'
import { CORPUS, NON_TEXT } from './corpus.mjs'
import { TOOL, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// L'écart d'une mission « Pistes de rétro ». Invariant de la liste d'attente : « Une écriture d'une rétro ou du COO
// n'efface ni ne change jamais en silence la piste d'une autre ; une piste ne quitte jamais le fichier, et une piste en
// exécution ne change plus. La mission « Pistes de rétro » n'écarte qu'une piste « validée » que porte sa carte, avec
// une raison qui cite le commit lu ; l'écart passe par sa boîte et le mod du COO, et se dit dans le même tour. »

const NOW = 740_000_000
const CARD = 'kpistes01'
const MISSION = 'mpistes1'
const REASON = 'déjà corrigée par 1a2b3c4d, Fin de mission sans gestes'

const piste = (id: string, over: Partial<Piste> = {}): Piste => ({ id, retro: id.slice(0, id.indexOf('/')), text: `Texte de ${id}`, files: [], state: 'validated', card: CARD, by: id.slice(0, id.indexOf('/')), at: NOW - 1000, history: [], comments: [], ...over })
const listWith = (pistes: unknown[]): Waitlist => ({ ...emptyWaitlist(''), pistes })

let seq = 0
/** Une opération déposée par la mission « Pistes de rétro » (auteur qui n'est ni le COO ni une rétro), dans sa boîte. */
const fromMission = (over: Partial<PisteOp> = {}, boxed: Partial<BoxedOp> = {}): BoxedOp => {
  seq += 1
  const op: PisteOp = { id: `omiss${String(seq).padStart(4, '0')}`, op: 'drop', piste: 'retroA/p1', by: MISSION, at: NOW - 100, reason: REASON, ...over }
  return { op, session: 'sM', by: MISSION, author: 'other', card: CARD, ...boxed }
}
const outcomeOf = (list: Waitlist, boxed: BoxedOp, isWhole = true) => applyBoxedOps(list, [boxed], NOW, isWhole).outcomes.get(opMark(boxed.session, boxed.op.id))

// ─── La forme de la raison ────────────────────────────────────────────────

test('la raison d’un écart de mission : « déjà corrigée par » puis un hash de 7 à 40 chiffres hexadécimaux, la suite libre', () => {
  expect(isFixedReason('déjà corrigée par 1a2b3c4')).toBe(true)
  expect(isFixedReason(`déjà corrigée par ${'a'.repeat(40)}, mission X`)).toBe(true)
  expect(isFixedReason('déjà corrigée par 1A2B3C4D, Mission')).toBe(true)
  expect(isFixedReason('déjà corrigée par 1a2b3c4d (groupe D)')).toBe(true)
  // Écrit en lettres décomposées (e + accent) : le même texte.
  expect(isFixedReason('déjà corrigée par 1a2b3c4d')).toBe(true)
  // Trop court, trop long, collé à des lettres, sans hash, autre préfixe, préfixe pas en tête.
  expect(isFixedReason('déjà corrigée par 1a2b3c')).toBe(false)
  expect(isFixedReason(`déjà corrigée par ${'a'.repeat(41)}`)).toBe(false)
  expect(isFixedReason('déjà corrigée par abcdef0xyz')).toBe(false)
  // Collé à une lettre accentuée, à un chiffre d'une autre écriture ou à « _ » : refusé de même.
  for (const glued of ['1a2b3c4dé', `deadbee${String.fromCodePoint(0x663)}`, `1a2b3c4${String.fromCodePoint(0xff11)}`, '1a2b3c4_x', '1a2b3c4d́']) expect({ glued, ok: isFixedReason(`déjà corrigée par ${glued}`) }).toEqual({ glued, ok: false })
  // Le corpus hostile commun, collé juste après le hash : seuls l'espace et le point-virgule, séparateurs permis, passent.
  const leaks = Object.entries(CORPUS).filter(([, token]) => isFixedReason(`déjà corrigée par 1a2b3c4d${token}x`)).map(([name]) => name)
  expect(leaks.sort()).toEqual(['espace', 'point-virgule'])
  // Le corpus collé dans le préfixe : toujours refusé ; une valeur qui n'est pas du texte aussi.
  expect(Object.entries(CORPUS).filter(([, token]) => isFixedReason(`déjà cor${token}rigée par 1a2b3c4d`)).map(([name]) => name)).toEqual([])
  for (const value of Object.values(NON_TEXT)) expect(isFixedReason(value)).toBe(false)
  expect(isFixedReason('déjà corrigée par le groupe D')).toBe(false)
  expect(isFixedReason('caduque')).toBe(false)
  expect(isFixedReason('doublon, déjà corrigée par 1a2b3c4d')).toBe(false)
  expect(isFixedReason('')).toBe(false)
})

// ─── Le module pur : la table des formes ──────────────────────────────────

test('une piste « validée » de la carte de l’auteur, raison en forme : écartée, sa raison, l’auteur et la date du dépôt gardés ; la garde tient', () => {
  const list = listWith([piste('retroA/p1')])
  const boxed = fromMission()
  const out = applyBoxedOps(list, [boxed], NOW)
  expect(out.outcomes.get(opMark('sM', boxed.op.id))).toEqual({ kind: 'applied' })
  expect(pistesOf(out.list)[0]).toEqual(expect.objectContaining({ state: 'dropped', reason: REASON, stateBy: MISSION, stateAt: NOW - 100, card: CARD, text: 'Texte de retroA/p1' }))
  expect(keepsPistes(list, out.list)).toBe(true)
  // Le même écart renvoyé (même raison) : sans effet ; avec une autre raison : refusé.
  expect(outcomeOf(out.list, fromMission())).toEqual({ kind: 'none' })
  expect(outcomeOf(out.list, fromMission({ reason: 'déjà corrigée par 9f9f9f9, autre' }))!.kind).toBe('refused')
})

test('refusés et marqués : piste sans carte, d’une autre carte, auteur sans lancement vivant, carte inconnue de la liste ; rien ne change', () => {
  const cases: { name: string; list: Waitlist; boxed: BoxedOp }[] = [
    { name: 'piste sans carte', list: listWith([piste('retroA/p1', { card: undefined })]), boxed: fromMission() },
    { name: 'autre carte', list: listWith([piste('retroA/p1', { card: 'kautre001' })]), boxed: fromMission() },
    { name: 'sans lancement vivant', list: listWith([piste('retroA/p1')]), boxed: fromMission({}, { card: undefined }) },
    { name: 'carte inconnue de la liste', list: listWith([piste('retroA/p1')]), boxed: fromMission({}, { card: 'kordinai1' }) },
  ]
  for (const c of cases) {
    const out = applyBoxedOps(c.list, [c.boxed], NOW)
    const mark = opMark('sM', c.boxed.op.id)
    expect({ name: c.name, kind: out.outcomes.get(mark)?.kind }).toEqual({ name: c.name, kind: 'refused' })
    expect({ name: c.name, pistes: out.list.pistes }).toEqual({ name: c.name, pistes: c.list.pistes })
    expect({ name: c.name, marked: out.list.applied.includes(mark), refusal: out.list.refused.some(r => r.op === mark && r.by === MISSION) }).toEqual({ name: c.name, marked: true, refusal: true })
  }
})

test('refusés et marqués : piste « pas encore validée », « en ticket », « en exécution » ou « faite »', () => {
  for (const over of [{ state: 'pending' as const }, { state: 'ticket' as const, mission: MISSION, group: 'A' }, { state: 'running' as const, mission: MISSION, group: 'A' }, { state: 'done' as const, mission: MISSION, group: 'A' }]) {
    const list = listWith([piste('retroA/p1', over)])
    const boxed = fromMission()
    const out = applyBoxedOps(list, [boxed], NOW)
    expect({ state: over.state, kind: out.outcomes.get(opMark('sM', boxed.op.id))?.kind }).toEqual({ state: over.state, kind: 'refused' })
    expect(out.list.pistes).toEqual(list.pistes)
  }
})

test('une raison hors forme est refusée et marquée à l’application ; une raison de plus de 300 signes dans une boîte n’est pas lue (comme avant)', () => {
  for (const reason of ['caduque', 'déjà corrigée par le groupe D', 'déjà corrigée par 1a2b3c']) {
    const list = listWith([piste('retroA/p1')])
    const boxed = fromMission({ reason })
    expect({ reason, kind: outcomeOf(list, boxed)?.kind }).toEqual({ reason, kind: 'refused' })
  }
  // Plus de 300 signes dans une boîte : l'opération est hors forme, jamais lue ; 300 tout juste, lue.
  const raw = { ...fromMission().op, reason: `${REASON}${'x'.repeat(300 - REASON.length)}` }
  expect(soundPisteOp(raw)).toEqual(raw)
  expect(soundPisteOp({ ...raw, reason: `${raw.reason}x` })).toBeNull()
})

test('piste absente : attend tant qu’une boîte ne s’est pas relue, sinon refusée ; piste gardée hors forme : refusée, rien ne la touche', () => {
  expect(outcomeOf(listWith([]), fromMission(), false)).toBeUndefined()
  expect(outcomeOf(listWith([]), fromMission())!.kind).toBe('refused')
  const odd = { id: 'retroA/p1', cassé: true }
  const out = applyBoxedOps(listWith([odd]), [fromMission()], NOW)
  expect([...out.outcomes.values()][0]!.kind).toBe('refused')
  expect(out.list.pistes).toEqual([odd])
})

test('auteur non prouvé : attend sans marque ; mission auteure supprimée : refusée et marquée (comme avant)', () => {
  const list = listWith([piste('retroA/p1')])
  const unproven = fromMission({}, { by: null })
  const waits = applyBoxedOps(list, [unproven], NOW)
  expect(waits.outcomes.size).toBe(0)
  expect(waits.list.applied).toEqual([])
  const gone = fromMission({}, { by: null, gone: true })
  const out = applyBoxedOps(list, [gone], NOW)
  expect(out.outcomes.get(opMark('sM', gone.op.id))!.kind).toBe('refused')
  expect(out.list.pistes).toEqual(list.pistes)
})

test('ajout, modification et commentaire d’un auteur qui n’est ni le COO ni une rétro : refusés et marqués, même sur une piste de sa carte', () => {
  const list = listWith([piste('retroA/p1')])
  const ops: Partial<PisteOp>[] = [
    { op: 'add', piste: `${MISSION}/p9`, text: 'Nouvelle piste', files: [], reason: undefined },
    { op: 'edit', text: 'Autre texte', reason: undefined },
    { op: 'comment', text: 'Hm', reason: undefined },
  ]
  for (const over of ops) {
    const boxed = fromMission(over)
    const out = applyBoxedOps(list, [boxed], NOW)
    expect({ op: over.op, kind: out.outcomes.get(opMark('sM', boxed.op.id))?.kind }).toEqual({ op: over.op, kind: 'refused' })
    expect(out.list.pistes).toEqual(list.pistes)
  }
})

test('les transitions d’état d’un tel auteur ne changent pas ; sans nature d’auteur, un écart garde le comportement d’avant', () => {
  const list = listWith([piste('retroA/p1')])
  const move = fromMission({ op: 'state', state: 'ticket', group: 'A', reason: undefined })
  expect(outcomeOf(list, move)).toEqual({ kind: 'applied' })
  // Nature non donnée (appel direct du module pur) : un écart d'une piste sans carte passe, comme avant.
  const plain = fromMission({}, { author: undefined, card: undefined })
  expect(outcomeOf(listWith([piste('retroA/p1', { card: undefined, state: 'pending' })]), plain)).toEqual({ kind: 'applied' })
  // Le COO et une rétro gardent le leur : écart d'une piste « pas encore validée », raison libre.
  const coo = fromMission({ by: 'coo', reason: 'caduque' }, { by: 'coo', author: 'coo', card: undefined })
  expect(outcomeOf(listWith([piste('retroA/p1', { state: 'pending', card: undefined })]), coo)).toEqual({ kind: 'applied' })
  const retro = fromMission({ by: 'retroA', reason: 'doublon' }, { by: 'retroA', author: 'retro', card: undefined })
  expect(outcomeOf(listWith([piste('retroA/p1', { state: 'pending', card: undefined })]), retro)).toEqual({ kind: 'applied' })
})

// ─── Le monde du COO ──────────────────────────────────────────────────────

/** Le nom des fichiers du projet de ces tests (racine vide) sur ce poste, comme `coordinationName`. */
const PROJECT = 'sans-projet-811c9dc5'
/** Pose la liste d'attente : au fichier du poste (par la fin de son chemin) et dans le stockage ; un texte : illisible. */
const putList = (w: World, list: Waitlist | string) => {
  w.files[`flow-board/pistes/${PROJECT}.json`] = typeof list === 'string' ? list : JSON.stringify(list)
  w.mem['coo-pistes:'] = typeof list === 'string' ? { v: 9 } : list
}
const listOf = (w: World): Waitlist => {
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/flow-board/pistes/${PROJECT}.json`))
  return (path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist
}
const boxOf = (w: World, session: string): { ops: any[] } | undefined => {
  const path = Object.keys(w.files).find(p => p.includes('/flow-board/pistes/boites/') && p.endsWith(`.${session}.json`))
  return (path ? JSON.parse(w.files[path]!) : w.mem[`pistes-boite::${session}`]) as { ops: any[] } | undefined
}
const putBox = (w: World, session: string, ops: unknown[]) => {
  const box = { v: 1, root: '', session, ops }
  w.files[`flow-board/pistes/boites/${PROJECT}.${session}.json`] = JSON.stringify(box)
  w.mem[`pistes-boite::${session}`] = box
}
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)

/** La mission ouverte ici par une carte (« Pistes de rétro » quand son dossier est celui de la carte) ; rend son id. */
const missionOf = async ($: any, w: World, clock: any, folder = pistesCardFolder(CARD)): Promise<string> => {
  const rec: LaunchRecord = { v: 1, id: 'lpistes0001', card: CARD, root: '', title: 'Pistes de rétro', start: 'to-tickets', mode: 'manual', effort: 'high', folder, at: NOW - 30_000, by: 'session-COO' }
  w.mem[launchKey(rec.id)] = rec
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  const consumed = $.tool.call({ tool: TOOL, launch: rec.id } as any)
  await settle(clock, 3)
  expect(String(((await consumed) as any).result)).toMatch(/Launch: consumed/)
  return stored(w).activeId!
}

test('à l’outil, la mission « Pistes de rétro » dépose l’écart d’une piste « validée » de sa carte, raison en forme ; tout autre changement est refusé sans rien déposer', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putList(w, listWith([piste('retroA/p1'), piste('retroA/p2', { card: 'kautre001' }), piste('retroA/p3', { state: 'pending', card: undefined }), piste('retroA/p4')]))
  const mission = await missionOf($, w, clock)
  // Refusés, rien de déposé : opération autre qu'un écart, raison hors forme, piste d'une autre carte, piste pas « validée ».
  const refusals: [Record<string, unknown>, RegExp][] = [
    [{ op: 'edit', piste: 'retroA/p1', text: 'Autre' }, /other than a retro only drops/],
    [{ op: 'comment', piste: 'retroA/p1', text: 'Hm' }, /other than a retro only drops/],
    [{ op: 'add', piste: `${mission}/p9`, text: 'Nouvelle' }, /other than a retro only drops/],
    [{ op: 'drop', piste: 'retroA/p1', reason: 'caduque' }, /déjà corrigée par <commit hash>/],
    [{ op: 'drop', piste: 'retroA/p1', reason: 'déjà corrigée par le groupe D' }, /déjà corrigée par <commit hash>/],
    [{ op: 'drop', piste: 'retroA/p1' }, /"drop" needs a "reason"/],
    [{ op: 'drop', piste: 'retroA/p2', reason: REASON }, /validée.{1,2} piste of this mission’s card in the waitlist read now/],
    [{ op: 'drop', piste: 'retroA/p3', reason: REASON }, /validée.{1,2} piste of this mission’s card in the waitlist read now/],
  ]
  for (const [change, why] of refusals) {
    const said = await call($, { pistes: [change] })
    expect({ change, said }).toEqual({ change, said: expect.stringMatching(why) })
    expect({ change, said }).toEqual({ change, said: expect.stringMatching(/^Nothing recorded\./) })
  }
  expect(boxOf(w, 'session-A')?.ops ?? []).toEqual([])
  // Accepté : l'écart part dans la boîte de la discussion, et la réponse dit qui l'applique et quoi dire.
  const said = await call($, { pistes: [{ op: 'drop', piste: 'retroA/p1', reason: REASON }] })
  expect(said.startsWith("Deposited for the COO's dashboard: drop retroA/p1; the COO's dashboard applies it, and says it if it refuses (the piste then keeps its state). Tell the user in this turn each piste you dropped, with the commit and the line you read.")).toBe(true)
  expect(boxOf(w, 'session-A')!.ops).toEqual([expect.objectContaining({ op: 'drop', piste: 'retroA/p1', by: mission, reason: REASON })])
  // Une raison de plus de 300 signes : coupée à 300, le préfixe et le hash gardés.
  const long = `déjà corrigée par 1a2b3c4d, ${'x'.repeat(400)}`
  expect(await call($, { pistes: [{ op: 'drop', piste: 'retroA/p4', reason: long }] })).toMatch(/^Deposited/)
  const kept = boxOf(w, 'session-A')!.ops[1].reason as string
  expect(kept).toHaveLength(300)
  expect(isFixedReason(kept)).toBe(true)
})

test('à l’outil, une liste illisible ne laisse rien déposer', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putList(w, listWith([piste('retroA/p1')]))
  await missionOf($, w, clock)
  putList(w, 'pas une liste')
  expect(await call($, { pistes: [{ op: 'drop', piste: 'retroA/p1', reason: REASON }] })).toMatch(/^Refused: the retro waitlist could not be read; nothing was recorded/)
  expect(boxOf(w, 'session-A')).toBeUndefined()
})

test('à l’outil, une mission dont la carte n’a pas le dossier d’une carte « Pistes de rétro » est refusée comme une mission ordinaire', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putList(w, listWith([piste('retroA/p1')]))
  await missionOf($, w, clock, 'pistes-de-retro')
  expect(await call($, { pistes: [{ op: 'drop', piste: 'retroA/p1', reason: REASON }] })).toMatch(/^Refused: "pistes" is for the COO discussion or a retro mission/)
  expect(boxOf(w, 'session-A')).toBeUndefined()
})

test('une fois sa piste écartée, la mission ne dépose plus aucune transition pour elle, même nommée par un ticket ; l’avertissement est dit', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putList(w, listWith([piste('retroA/p1', { state: 'dropped', reason: REASON, stateBy: MISSION, stateAt: NOW - 50 }), piste('retroA/p2')]))
  const dir = `travail/${pistesCardFolder(CARD)}/issues`
  w.files[`${dir}/01-borner.md`] = '# 01: Borner\n\n**Status:** ready-for-agent\n\nPistes : retroA/p1\n'
  w.files[`${dir}/02-autre.md`] = '# 02: Autre\n\n**Status:** ready-for-agent\n\nPistes : retroA/p2\n'
  const mission = await missionOf($, w, clock)
  await call($, { tickets: [{ id: '01', name: 'Borner' }, { id: '02', name: 'Autre' }], groups: [{ id: 'A', name: 'Un', tickets: ['01'] }, { id: 'B', name: 'Deux', tickets: ['02'] }] })
  await settle(clock, 12)
  expect(boxOf(w, 'session-A')!.ops).toEqual([expect.objectContaining({ op: 'state', piste: 'retroA/p2', by: mission, state: 'ticket', group: 'B' })])
  expect(await call($, { note: 'où en est-on' })).toMatch(/piste retroA\/p1 is dropped, nothing linked/)
})

test('chez le COO, l’écart de la mission « Pistes de rétro » s’applique ; une modification d’une mission ordinaire, un écart hors de la carte, d’une autre carte, d’un lancement perdu ou à la raison hors forme sont refusés et dits au relevé', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const launch = { id: 'lpistes0001', card: CARD, at: NOW - 60_000, folder: pistesCardFolder(CARD), start: 'to-tickets', mode: 'auto' }
  const pistesRun = { ...newRun('to-tickets', NOW - 50_000, 'Pistes de rétro'), status: 'active', owner: 'session-P', launch } as any
  const other = { ...newRun('implement', NOW - 50_000, 'Autre'), status: 'active', owner: 'session-Q' } as any
  const lost = { ...newRun('to-tickets', NOW - 50_000, 'Perdue'), status: 'active', owner: 'session-L', launch: { ...launch, id: 'lpistes0002', lostAt: NOW - 1000 } } as any
  // Une mission ordinaire lancée par une autre carte, qu'aucune piste ne porte.
  const foreign = { ...newRun('to-spec', NOW - 50_000, 'Étrangère'), status: 'active', owner: 'session-F', launch: { id: 'lautre0001', card: 'kordinai1', at: NOW - 60_000, folder: 'autre-sujet', start: 'to-spec', mode: 'auto' } } as any
  writeBoard(w, b => ({ ...b, runs: [pistesRun, other, lost, foreign] }))
  const before = listWith([piste('retroA/p1'), piste('retroA/p2', { card: 'kautre001' }), piste('retroA/p3'), piste('retroA/p4'), piste('retroA/p5'), piste('retroA/p6')])
  putList(w, before)
  await start($)
  await openCoo($, clock)
  putBox(w, 'session-P', [
    { id: 'oppppppp1', op: 'drop', piste: 'retroA/p1', by: pistesRun.id, at: NOW - 200, reason: REASON },
    { id: 'oppppppp2', op: 'drop', piste: 'retroA/p2', by: pistesRun.id, at: NOW - 200, reason: REASON },
    { id: 'oppppppp3', op: 'drop', piste: 'retroA/p6', by: pistesRun.id, at: NOW - 200, reason: 'caduque' },
  ])
  putBox(w, 'session-F', [{ id: 'offffff01', op: 'drop', piste: 'retroA/p5', by: foreign.id, at: NOW - 200, reason: REASON }])
  putBox(w, 'session-Q', [{ id: 'oqqqqqqq1', op: 'edit', piste: 'retroA/p3', by: other.id, at: NOW - 200, text: 'Réécrite' }])
  putBox(w, 'session-L', [{ id: 'olllllll1', op: 'drop', piste: 'retroA/p4', by: lost.id, at: NOW - 200, reason: REASON }])
  await settle(clock, 6)
  const list = listOf(w)
  const [p1, p2, p3, p4, p5, p6] = pistesOf(list)
  expect(p1).toEqual(expect.objectContaining({ state: 'dropped', reason: REASON, stateBy: pistesRun.id, stateAt: NOW - 200, card: CARD }))
  expect(p2).toEqual(pistesOf(before)[1])
  expect(p3).toEqual(pistesOf(before)[2])
  expect(p4).toEqual(pistesOf(before)[3])
  expect(p5).toEqual(pistesOf(before)[4])
  expect(p6).toEqual(pistesOf(before)[5])
  expect(keepsPistes(before, list)).toBe(true)
  expect(list.applied).toHaveLength(6)
  expect(list.refused.map(r => [r.piste, r.by]).sort()).toEqual([['retroA/p2', pistesRun.id], ['retroA/p3', other.id], ['retroA/p4', lost.id], ['retroA/p5', foreign.id], ['retroA/p6', pistesRun.id]])
  // Le relevé du COO dit les refus récents ; la piste refusée reste « validée ».
  const turn = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(turn).toContain('Refused change of')
  expect(turn).toContain('the piste is not carried by the launch card of this mission')
  expect(turn).toContain('other than a retro only drops')
  expect(turn).toContain('the reason must start with')
})
