// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { newRun } from '../hooks/model.ts'
import { APPLIED_MAX, COO_AUTHOR, PISTE_COMMENTS_MAX, PISTE_HISTORY_MAX, PISTES_MAX, applyBoxedOps, applyPisteChange, emptyWaitlist, keepsOps, keepsPistes, missingSeen, opMark, parsePisteChange, parseWaitlist, pistesOf, soundPiste, soundPisteOp, utf8Length, withoutApplied, type BoxedOp, type Piste, type PisteOp, type Waitlist } from '../hooks/pistes.ts'
import { TOOL, openCoo, seatOf, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// La liste d'attente des rétros. Invariant : « Une écriture d'une rétro ou du COO n'efface ni ne
// change jamais en silence la piste d'une autre ; une piste ne quitte jamais le fichier, et une piste en
// exécution ne change plus. »

const NOW = 600_000_000
const ROOT = ''

const piste = (id: string, over: Partial<Piste> = {}): Piste => ({ id, retro: id.slice(0, id.indexOf('/')), text: `Texte de ${id}`, files: [], state: 'pending', by: id.slice(0, id.indexOf('/')), at: NOW - 1000, history: [], comments: [], ...over })
const listWith = (pistes: unknown[], over: Partial<Waitlist> = {}): Waitlist => ({ ...emptyWaitlist(ROOT), pistes, ...over })
let opSeq = 0
const op = (over: Partial<PisteOp> & Pick<PisteOp, 'op' | 'piste' | 'by'>): PisteOp => ({ id: `oop${String(opSeq++).padStart(6, '0')}`, at: NOW, ...over })
const boxed = (o: PisteOp, session: string, by: string | null = o.by): BoxedOp => ({ op: o, session, by })

// ─── Le module pur ────────────────────────────────────────────────────────

test('deux rétros modifient la même piste : les deux textes restent, dans l’historique, avec leur auteur', () => {
  const list = listWith([piste('retroA/p1')])
  const first = op({ op: 'edit', piste: 'retroA/p1', by: 'retroB', text: 'Version de B', at: NOW + 1 })
  const second = op({ op: 'edit', piste: 'retroA/p1', by: 'retroC', text: 'Version de C', at: NOW + 2 })
  const out = applyBoxedOps(list, [boxed(second, 'sC'), boxed(first, 'sB')], NOW + 10)
  const [p] = pistesOf(out.list)
  expect(p!.text).toBe('Version de C')
  expect(p!.history.map(h => [h.text, h.by])).toEqual([
    ['Texte de retroA/p1', 'retroB'],
    ['Version de B', 'retroC'],
  ])
  expect(out.list.applied).toEqual([opMark('sB', first.id), opMark('sC', second.id)])
  expect(keepsPistes(list, out.list)).toBe(true)
  // Rejouées : rien ne change (chaque marque déjà là).
  expect(applyBoxedOps(out.list, [boxed(first, 'sB'), boxed(second, 'sC')], NOW + 20).list).toEqual(out.list)
})

test('un ajout se fait sous le préfixe de sa rétro seulement ; un ajout déjà présent est une modification gardée dans l’historique', () => {
  const list = listWith([])
  const mine = applyPisteChange(list, { op: 'add', piste: 'retroA/p1', text: 'Un', files: ['hooks/a.ts'] }, 'retroA', NOW)
  expect(mine.outcome).toEqual({ kind: 'applied' })
  expect(applyPisteChange(list, { op: 'add', piste: 'retroA/p1', text: 'Un' }, 'retroB', NOW).outcome).toEqual({ kind: 'refused', why: 'a piste is added only by its own retro' })
  expect(applyPisteChange(list, { op: 'add', piste: 'retroA/p1', text: 'Un' }, COO_AUTHOR, NOW).outcome.kind).toBe('refused')
  const again = applyPisteChange(mine.list, { op: 'add', piste: 'retroA/p1', text: 'Un, mieux dit' }, 'retroA', NOW + 1)
  expect(pistesOf(again.list)[0]!.history).toEqual([{ text: 'Un', files: ['hooks/a.ts'], by: 'retroA', at: NOW + 1 }])
  // Le même texte et les mêmes fichiers renvoyés : rien ne change.
  expect(applyPisteChange(mine.list, { op: 'add', piste: 'retroA/p1', text: 'Un', files: ['hooks/a.ts'] }, 'retroA', NOW + 2)).toEqual({ list: mine.list, outcome: { kind: 'none' } })
})

test('écarter puis modifier : l’écart garde la piste et sa raison, la modification garde l’ancien texte ; une piste validée s’écarte aussi, une piste en ticket non', () => {
  const list = listWith([piste('retroA/p1'), piste('retroA/p2', { state: 'validated', card: 'kcarte1' }), piste('retroA/p3', { state: 'ticket', mission: 'm1', group: 'A' })])
  const dropped = applyPisteChange(list, { op: 'drop', piste: 'retroA/p1', reason: 'rendue caduque par R12' }, COO_AUTHOR, NOW)
  expect(pistesOf(dropped.list)[0]).toEqual(expect.objectContaining({ state: 'dropped', reason: 'rendue caduque par R12' }))
  const edited = applyPisteChange(dropped.list, { op: 'edit', piste: 'retroA/p1', text: 'Reformulée' }, 'retroB', NOW + 1)
  expect(pistesOf(edited.list)[0]).toEqual(expect.objectContaining({ state: 'dropped', text: 'Reformulée', history: [expect.objectContaining({ text: 'Texte de retroA/p1' })] }))
  expect(keepsPistes(list, edited.list)).toBe(true)
  expect(applyPisteChange(list, { op: 'drop', piste: 'retroA/p2', reason: 'doublon' }, 'retroB', NOW).outcome.kind).toBe('applied')
  expect(applyPisteChange(list, { op: 'drop', piste: 'retroA/p3', reason: 'doublon' }, 'retroB', NOW).outcome).toEqual({ kind: 'refused', why: 'a piste « en ticket » is not dropped' })
})

test('une piste en exécution ou faite ne change plus : texte, fichiers, commentaire et écart refusés, la liste identique sauf la marque et le refus', () => {
  const running = piste('retroA/p1', { state: 'running', mission: 'm1', group: 'A' })
  const done = piste('retroA/p2', { state: 'done', mission: 'm1', group: 'A' })
  const list = listWith([running, done])
  const ops = [
    op({ op: 'edit', piste: 'retroA/p1', by: 'retroB', text: 'Autre' }),
    op({ op: 'edit', piste: 'retroA/p1', by: 'retroC', files: ['x.ts'] }),
    op({ op: 'comment', piste: 'retroA/p1', by: 'retroC', text: 'Hm' }),
    op({ op: 'drop', piste: 'retroA/p2', by: COO_AUTHOR, reason: 'caduque' }),
  ]
  const out = applyBoxedOps(list, ops.map((o, i) => boxed(o, `s${i}`)), NOW)
  expect(out.list.pistes).toEqual(list.pistes)
  expect(out.list.applied).toHaveLength(4)
  expect(out.list.refused.map(r => r.why)).toEqual(['the piste is « en exécution »: it no longer changes', 'the piste is « en exécution »: it no longer changes', 'the piste is « en exécution »: it no longer changes', 'the piste is « faite »: it no longer changes'])
  // La garde refuse une écriture qui changerait une piste en exécution, ou qui ferait revenir une piste faite.
  expect(keepsPistes(list, listWith([{ ...running, text: 'Autre' }, done]))).toBe(false)
  expect(keepsPistes(list, listWith([running, { ...done, state: 'ticket' }]))).toBe(false)
  expect(keepsPistes(list, listWith([{ ...running, state: 'done' }, done]))).toBe(true)
})

test('rien ne se perd : la garde refuse une piste absente, un texte d’historique ou un commentaire perdu, une piste hors forme retouchée, un doublon, une marque retirée', () => {
  const p = piste('retroA/p1', { history: [{ text: 'Ancien', files: [], by: 'retroA', at: 1 }], comments: [{ text: 'Vu', by: 'coo', at: 2 }] })
  const broken = { id: 'retroA/p9', text: 42 }
  const list = listWith([p, broken], { applied: ['s/o1'] })
  expect(keepsPistes(list, listWith([broken], { applied: ['s/o1'] }))).toBe(false)
  expect(keepsPistes(list, listWith([{ ...p, history: [] }, broken], { applied: ['s/o1'] }))).toBe(false)
  expect(keepsPistes(list, listWith([{ ...p, comments: [] }, broken], { applied: ['s/o1'] }))).toBe(false)
  expect(keepsPistes(list, listWith([p, { ...broken, text: 'réparé' }], { applied: ['s/o1'] }))).toBe(false)
  expect(keepsPistes(list, listWith([p, broken, p], { applied: ['s/o1'] }))).toBe(false)
  expect(keepsPistes(list, listWith([p, broken]))).toBe(false)
  expect(keepsPistes(list, listWith([p, broken]), new Set(['s/o1']))).toBe(true)
  // Une piste hors forme refuse toute opération, même un ajout du même id : jamais de doublon.
  expect(applyPisteChange(list, { op: 'add', piste: 'retroA/p9', text: 'Neuf' }, 'retroA', NOW).outcome).toEqual({ kind: 'refused', why: 'this piste is kept unreadable in the list: nothing touches it' })
  expect(soundPiste(broken)).toBeNull()
  // Une piste vue qui manque à la relecture : nommée.
  expect(missingSeen(listWith([broken]), ['retroA/p1', 'retroA/p9'])).toEqual(['retroA/p1'])
})

test('les bornes : texte coupé, fichiers, commentaires, historique, nombre de pistes, nombre de marques ; rien n’est retiré', () => {
  expect(parsePisteChange({ op: 'add', piste: 'retroA/p1', text: 'x'.repeat(5000) })).toEqual(expect.objectContaining({ text: expect.stringMatching(/^x{1999}…$/) }))
  expect(parsePisteChange({ op: 'add', piste: 'retroA/p1', text: 'x', files: Array.from({ length: 21 }, (_, i) => `f${i}.ts`) })).toEqual({ why: '21 files, 20 at most' })
  expect(parsePisteChange({ op: 'drop', piste: 'retroA/p1' })).toEqual({ why: '"drop" needs a "reason"' })
  expect(parsePisteChange({ op: 'add', piste: '../p1', text: 'x' })).toEqual({ why: '"piste" must be "<retro mission id>/<piste id>"' })
  const full = piste('retroA/p1', { comments: Array.from({ length: PISTE_COMMENTS_MAX }, (_, i) => ({ text: `c${i}`, by: 'coo', at: i })), history: Array.from({ length: PISTE_HISTORY_MAX }, (_, i) => ({ text: `t${i}`, files: [], by: 'coo', at: i })) })
  const list = listWith([full])
  expect(applyPisteChange(list, { op: 'comment', piste: 'retroA/p1', text: 'encore' }, COO_AUTHOR, NOW).outcome.kind).toBe('refused')
  expect(applyPisteChange(list, { op: 'edit', piste: 'retroA/p1', text: 'encore' }, COO_AUTHOR, NOW).outcome.kind).toBe('refused')
  const many = listWith(Array.from({ length: PISTES_MAX }, (_, i) => ({ id: `retroZ/q${i}` })))
  expect(applyPisteChange(many, { op: 'add', piste: 'retroA/p1', text: 'x' }, 'retroA', NOW).outcome).toEqual({ kind: 'refused', why: `the list holds ${PISTES_MAX} pistes: nothing more is added` })
  // À la borne des marques, plus rien ne s'applique : l'opération attend dans sa boîte, aucune marque évincée.
  const marked = listWith([piste('retroA/p1')], { applied: Array.from({ length: APPLIED_MAX }, (_, i) => `s/o${i}`) })
  const waiting = applyBoxedOps(marked, [boxed(op({ op: 'comment', piste: 'retroA/p1', by: COO_AUTHOR, text: 'x' }), 's')], NOW)
  expect(waiting.list).toEqual(marked)
  expect(waiting.outcomes.size).toBe(0)
})

test('une opération sans auteur prouvé attend, sans marque ; une opération sur une piste inconnue attend tant qu’une boîte ne se lit pas ; dates du dépôt, écart signé, taille en octets', () => {
  const list = listWith([piste('retroA/p1')])
  const forged = op({ op: 'edit', piste: 'retroA/p1', by: 'retroA', text: 'Forgé' })
  expect(applyBoxedOps(list, [boxed(forged, 'sX', null)], NOW).list).toEqual(list)
  // Celle d'une mission supprimée : refusée et marquée, pour que sa boîte s'en vide.
  const orphan = applyBoxedOps(list, [{ ...boxed(forged, 'sX', null), gone: true }], NOW)
  expect(orphan.list.pistes).toEqual(list.pistes)
  expect(orphan.list.applied).toEqual([opMark('sX', forged.id)])
  expect(orphan.list.refused[0]).toEqual(expect.objectContaining({ by: 'retroA', why: 'its mission was deleted' }))
  // L'historique et l'écart gardent la date du dépôt et leur auteur.
  const edit = op({ op: 'edit', piste: 'retroA/p1', by: 'retroB', text: 'Neuf', at: NOW - 500 })
  const drop = op({ op: 'drop', piste: 'retroA/p1', by: COO_AUTHOR, reason: 'caduque', at: NOW - 400 })
  const signed = pistesOf(applyBoxedOps(list, [boxed(edit, 'sB'), boxed(drop, 'sC')], NOW).list)[0]!
  expect(signed.history[0]!.at).toBe(NOW - 500)
  expect(signed).toEqual(expect.objectContaining({ state: 'dropped', stateBy: COO_AUTHOR, stateAt: NOW - 400 }))
  expect(utf8Length('aé€😀')).toBe(1 + 2 + 3 + 4)
  // Une clé inconnue du fichier (une version plus récente) reste à la réécriture.
  const read = parseWaitlist(JSON.stringify({ ...listWith([]), choice: 'repo' }), ROOT)
  expect(read.state === 'read' && (applyBoxedOps(read.list, [], NOW).list as any).choice).toBe('repo')
  const early = op({ op: 'comment', piste: 'retroB/p1', by: 'retroC', text: 'déjà' })
  expect(applyBoxedOps(list, [boxed(early, 'sC')], NOW, false).list).toEqual(list)
  expect(applyBoxedOps(list, [boxed(early, 'sC')], NOW, true).list.refused[0]!.why).toBe('no such piste in the list')
  // Une date future ne passe pas devant : ramenée à maintenant, elle suit une opération d'avant.
  const future = op({ op: 'edit', piste: 'retroA/p1', by: 'retroB', text: 'Futur', at: NOW + 10 * 86_400_000 })
  const past = op({ op: 'edit', piste: 'retroA/p1', by: 'retroC', text: 'Passé', at: NOW - 5 })
  expect(pistesOf(applyBoxedOps(list, [boxed(future, 'sB'), boxed(past, 'sC')], NOW).list)[0]!.text).toBe('Futur')
})

test('une boîte ne perd jamais une opération pas appliquée ; appliquée, elle part ; hors forme, elle reste', () => {
  const a = op({ op: 'comment', piste: 'retroA/p1', by: 'retroA', text: 'a' })
  const b = op({ op: 'comment', piste: 'retroA/p1', by: 'retroA', text: 'b' })
  const broken = { id: 'pas-un-id', op: 'add' }
  expect(soundPisteOp(broken)).toBeNull()
  expect(withoutApplied([a, b, broken], new Set([a.id]))).toEqual([b, broken])
  expect(keepsOps([a, b, broken], [b, broken], new Set([a.id]))).toBe(true)
  expect(keepsOps([a, b, broken], [b], new Set([a.id]))).toBe(false)
  expect(keepsOps([a, b], [], new Set())).toBe(false)
  expect(parseWaitlist('{"v":1,"root":"","pistes":[],"appl', ROOT)).toEqual({ state: 'unread' })
  expect(parseWaitlist(JSON.stringify(listWith([])), '/autre')).toEqual({ state: 'unread' })
})

// ─── Le mod ───────────────────────────────────────────────────────────────

/** La liste écrite par le mod, au fichier comme dans le stockage. */
const listOf = (w: World): Waitlist | undefined => {
  const path = listPath(w)
  return (path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist | undefined
}
const listPath = (w: World): string | undefined => Object.keys(w.files).find(p => p.includes('/flow-board/pistes/') && !p.includes('/boites/') && !p.endsWith('.vues.json') && p.endsWith('.json'))
/** La boîte de pistes d'une discussion. */
const boxOf = (w: World, session: string): { ops: any[] } | undefined => {
  const path = Object.keys(w.files).find(p => p.includes('/flow-board/pistes/boites/') && p.endsWith(`.${session}.json`))
  return (path ? JSON.parse(w.files[path]!) : w.mem[`pistes-boite::${session}`]) as { ops: any[] } | undefined
}
/** Pose la boîte d'une autre discussion à côté de celle de session-A (le même dossier, ou le stockage). */
const putBox = (w: World, session: string, ops: unknown[], root = ROOT) => {
  const mine = Object.keys(w.files).find(p => p.includes('/flow-board/pistes/boites/') && p.endsWith('.session-A.json'))
  const box = { v: 1, root, session, ops }
  if (mine) w.files[mine.replace(/\.session-A\.json$/, `.${session}.json`)] = JSON.stringify(box)
  else w.mem[`pistes-boite::${session}`] = box
}
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const retroId = (w: World, title: string): string => stored(w).runs.find(r => r.title === title)!.id

/**
 * Une rétro ici dépose l'ajout de sa piste p1, puis cette discussion devient le COO (la rétro mise en pause) :
 * le mod du COO applique l'ajout. Rend l'id de la rétro.
 */
const retroThenCoo = async ($: any, w: World, clock: any): Promise<string> => {
  // Le projet a un COO (un siège libéré) : la rétro naît avec son étape « attente », et dépose.
  writeBoard(w, b => ({ ...b, coo: { ...seatOf('session-Z', NOW - 120_000), releasedAt: NOW - 60_000 } }))
  await start($)
  await call($, { open: { title: 'Rétro A', entry: 'retro' } })
  await settle(clock, 2)
  const retro = retroId(w, 'Rétro A')
  const said = await call($, { pistes: [{ op: 'add', piste: `${retro}/p1`, text: 'Borner le relevé', files: ['hooks/coo.ts'] }] })
  expect(said).toMatch(/Deposited for the COO's dashboard: 1 change/)
  expect(listOf(w)).toBeUndefined()
  await $.command.run({ command: 'flow', args: 'pause' } as any).catch(() => undefined)
  await openCoo($, clock)
  await settle(clock, 6)
  return retro
}

test('une rétro dépose sa piste sans COO ouvert : rien ne se perd, le COO l’applique à l’ouverture ; la boîte ne s’en vide qu’après 2 minutes de marque vue', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const retro = await retroThenCoo($, w, clock)
  const list = listOf(w)!
  expect(pistesOf(list)).toEqual([expect.objectContaining({ id: `${retro}/p1`, text: 'Borner le relevé', files: ['hooks/coo.ts'], state: 'pending', by: retro })])
  expect(list.applied).toHaveLength(1)
  expect(boxOf(w, 'session-A')!.ops).toHaveLength(1)
  // Le relevé du COO donne la liste, texte cité en chaîne JSON.
  const turn = JSON.stringify(await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any))
  expect(turn).toMatch(/Retro waitlist of the project \(1 piste\(s\), 1 open/)
  expect(turn).toContain('Borner le relev\\\\u00e9')
  await settle(clock, 130)
  expect(boxOf(w, 'session-A')!.ops).toEqual([])
  // La marque se libère une fois qu'aucune boîte ne porte plus l'opération ; la piste reste.
  await settle(clock, 6)
  expect(listOf(w)!.applied).toEqual([])
  expect(pistesOf(listOf(w)!)).toHaveLength(1)
})

test('le Claude du COO commente et écarte par la clé « pistes » ; une autre rétro modifie : l’historique garde le texte d’avant et son auteur', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const retro = await retroThenCoo($, w, clock)
  const said = await call($, { pistes: [{ op: 'comment', piste: `${retro}/p1`, text: 'Voir R12' }, { op: 'add', piste: `${retro}/p2`, text: 'x' }] })
  expect(said).toMatch(/comment .*: applied/)
  expect(said).toMatch(/NOT recorded: change 2 \(the COO does not add pistes/)
  // Une autre rétro, dans la discussion B, modifie la piste.
  writeBoard(w, b => ({ ...b, runs: [...b.runs, { ...newRun('retro', NOW, 'Rétro B'), status: 'active', owner: 'session-B' }] }))
  const retroB = retroId(w, 'Rétro B')
  putBox(w, 'session-B', [{ id: 'obbbbbb01', op: 'edit', piste: `${retro}/p1`, by: retroB, at: NOW + 10_000, text: 'Borner le relevé à 100 pistes' }])
  await settle(clock, 6)
  const [p] = pistesOf(listOf(w)!)
  expect(p).toEqual(expect.objectContaining({ text: 'Borner le relevé à 100 pistes', comments: [expect.objectContaining({ text: 'Voir R12', by: 'coo' })] }))
  expect(p!.history).toEqual([expect.objectContaining({ text: 'Borner le relevé', by: retroB })])
  const dropped = await call($, { pistes: [{ op: 'drop', piste: `${retro}/p1`, reason: 'rendue caduque' }] })
  expect(dropped).toMatch(/drop .*: applied/)
  expect(pistesOf(listOf(w)!)[0]).toEqual(expect.objectContaining({ state: 'dropped', reason: 'rendue caduque' }))
})

test('une boîte forgée : écrite au nom d’une mission d’une autre discussion, ou pour un autre projet, ne change rien', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const retro = await retroThenCoo($, w, clock)
  writeBoard(w, b => ({ ...b, runs: [...b.runs, { ...newRun('retro', NOW, 'Rétro B'), status: 'active', owner: 'session-B' }] }))
  const retroB = retroId(w, 'Rétro B')
  // La boîte de C se dit de la rétro B (que porte B) ; celle de D est d'un autre projet ; celle de E est hors forme.
  putBox(w, 'session-C', [{ id: 'occccccc1', op: 'edit', piste: `${retro}/p1`, by: retroB, at: NOW, text: 'Forgé' }])
  putBox(w, 'session-D', [{ id: 'odddddd01', op: 'edit', piste: `${retro}/p1`, by: retroB, at: NOW, text: 'Autre projet' }], '/autre')
  putBox(w, 'session-E', [{ id: 'oeeeeee01', op: 'edit', piste: `${retro}/p1`, by: 'coo', at: NOW, text: 'Se dit du COO' }, { op: 'edit', text: 'hors forme' }])
  await settle(clock, 6)
  expect(pistesOf(listOf(w)!)[0]!.text).toBe('Borner le relevé')
  // Sans auteur prouvé, rien ne s'applique ni ne se marque : les opérations attendent, le relevé les compte.
  expect(listOf(w)!.refused).toEqual([])
  expect(boxOf(w, 'session-C')!.ops).toHaveLength(1)
  const turn = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(turn).toMatch(/2 change\(s\) wait in a piste box that does not prove its author/)
})

test('une liste illisible n’est jamais écrite : sa copie est gardée à côté, l’opération attend dans sa boîte, le relevé le dit', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const retro = await retroThenCoo($, w, clock)
  const path = listPath(w)
  const cut = '{"v":1,"root":"","pistes":[{"id":"x'
  if (path) w.files[path] = cut
  else w.mem['coo-pistes:'] = cut
  const said = await call($, { pistes: [{ op: 'comment', piste: `${retro}/p1`, text: 'Encore' }] })
  expect(said).toMatch(/waiting in the box/)
  expect(path ? w.files[path] : w.mem['coo-pistes:']).toBe(cut)
  expect(Object.values(w.asides)).toContain(path ? cut : JSON.stringify(cut))
  expect(boxOf(w, 'session-A')!.ops.some(o => o.text === 'Encore')).toBe(true)
  const turn = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(turn).toMatch(/The retro waitlist could not be read/)
})

test('une liste relue qui a perdu une piste déjà vue n’est jamais écrasée : rien d’écrit, copie gardée, le relevé dit de s’arrêter', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const retro = await retroThenCoo($, w, clock)
  const emptied = JSON.stringify(emptyWaitlist(ROOT))
  const path = listPath(w)
  if (path) w.files[path] = emptied
  else w.mem['coo-pistes:'] = JSON.parse(emptied)
  await call($, { pistes: [{ op: 'comment', piste: `${retro}/p1`, text: 'Encore' }] })
  await settle(clock, 6)
  expect(listOf(w)).toEqual(emptyWaitlist(ROOT))
  const turn = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(turn).toMatch(/no longer holds pistes already seen/)
})

test('une écriture ratée : rien n’est marqué, l’opération se réapplique ensuite, une fois', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const retro = await retroThenCoo($, w, clock)
  // L'écriture de la liste échoue (fichier, ou stockage) le temps d'un appel.
  w.probe.refuseStore = key => key.startsWith('coo-pistes:')
  const path = listPath(w)
  const before = path ? w.files[path] : undefined
  const original = w.files
  if (path) Object.defineProperty(w.files, path, { configurable: true, get: () => before, set: () => { throw new Error('EROFS') } })
  const said = await call($, { pistes: [{ op: 'comment', piste: `${retro}/p1`, text: 'Une fois' }] })
  expect(said).toMatch(/waiting in the box/)
  w.probe.refuseStore = undefined
  if (path) Object.defineProperty(original, path, { configurable: true, writable: true, enumerable: true, value: before })
  await settle(clock, 12)
  expect(pistesOf(listOf(w)!)[0]!.comments.filter(c => c.text === 'Une fois')).toHaveLength(1)
})

test('la clé « pistes » est refusée à un worker, à une mission qui n’est pas une rétro, et chez le COO à une discussion qui a perdu le siège', { timeoutMs: 40000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  const change = [{ op: 'comment', piste: 'retroA/p1', text: 'x' }]
  expect(await call($, { delegate: 'mission-x', group: 'A', main: '[abc123]' })).toBeDefined()
  expect(await call($, { pistes: change })).toMatch(/Refused: "pistes" is for the COO discussion or a retro, never a worker/)
  expect(boxOf(w, 'session-A')).toBeUndefined()
})

test('la clé « pistes » est refusée à une mission ordinaire, et chez le COO dès qu’une autre discussion tient le siège', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await call($, { open: { title: 'Mission ordinaire' } })
  await settle(clock, 2)
  const change = [{ op: 'comment', piste: 'retroA/p1', text: 'x' }]
  expect(await call($, { pistes: change })).toMatch(/Refused: "pistes" is for the COO discussion or a retro mission/)
  await $.command.run({ command: 'flow', args: 'pause' } as any).catch(() => undefined)
  await openCoo($, clock)
  writeBoard(w, b => ({ ...b, coo: seatOf('session-B', NOW + 60_000) }))
  await settle(clock, 6)
  expect(await call($, { pistes: change })).toMatch(/Refused: this discussion does not hold the COO seat/)
  expect(boxOf(w, 'session-A')).toBeUndefined()
})

test('un fichier de coordination illisible n’arrête pas la liste : le relevé des 5 s applique encore les opérations des boîtes', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const retro = await retroThenCoo($, w, clock)
  w.coord.unread = true
  writeBoard(w, b => ({ ...b, runs: [...b.runs, { ...newRun('retro', NOW, 'Rétro B'), status: 'active', owner: 'session-B' }] }))
  putBox(w, 'session-B', [{ id: 'obbbbbb02', op: 'comment', piste: `${retro}/p1`, by: retroId(w, 'Rétro B'), at: NOW + 10_000, text: 'Vu par B' }])
  await settle(clock, 6)
  expect(pistesOf(listOf(w)!)[0]!.comments.map(c => c.text)).toEqual(['Vu par B'])
})
