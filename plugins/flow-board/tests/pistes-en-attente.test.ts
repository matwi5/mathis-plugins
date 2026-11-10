// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { pistesWaitingOf } from '../hooks/coo.ts'
import { isPistesCard, launchKey, parseCard, pistesCard, pistesCardFolder, type LaunchRecord } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { emptyWaitlist, keepsPistes, pistesOf, releaseCardPistes, validatePistes, type Piste, type Waitlist } from '../hooks/pistes.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// La section « Pistes en attente » et la carte « Pistes de rétro ». Invariant de la liste d'attente : « Une écriture d'une rétro ou
// du COO n'efface ni ne change jamais en silence la piste d'une autre ; une piste ne quitte jamais le fichier, et une
// piste en exécution ne change plus. »

const NOW = 720_000_000
/** Le nom des fichiers du projet de ces tests (racine vide) sur ce poste, comme `coordinationName`. */
const PROJECT = 'sans-projet-811c9dc5'

const piste = (id: string, over: Partial<Piste> = {}): Piste => ({ id, retro: id.slice(0, id.indexOf('/')), text: `Texte de ${id}`, files: [], state: 'pending', by: id.slice(0, id.indexOf('/')), at: NOW - 1000, history: [], comments: [], ...over })
const listWith = (pistes: unknown[]): Waitlist => ({ ...emptyWaitlist(''), pistes })

// ─── Le module pur ────────────────────────────────────────────────────────

test('le découpage valide les seules pistes encore « pas encore validée » au texte inchangé, avec la carte ; la garde tient', () => {
  const list = listWith([piste('retroA/p1'), piste('retroA/p2', { history: [{ text: 'avant', files: [], by: 'retroB', at: NOW - 10 }] }), piste('retroA/p3', { state: 'dropped', reason: 'doublon' }), { id: 'retroA/p4', cassé: true }])
  const out = validatePistes(list, [{ id: 'retroA/p1', texts: 0 }, { id: 'retroA/p2', texts: 0 }, { id: 'retroA/p3', texts: 0 }, { id: 'retroA/p4', texts: 0 }, { id: 'retroA/p9', texts: 0 }], 'kcarte01', NOW)
  expect(out.accepted).toEqual(['retroA/p1'])
  expect(out.refused.map(r => r.id)).toEqual(['retroA/p2', 'retroA/p3', 'retroA/p4', 'retroA/p9'])
  expect(pistesOf(out.list)[0]).toEqual(expect.objectContaining({ state: 'validated', card: 'kcarte01', stateBy: 'coo', stateAt: NOW }))
  expect(pistesOf(out.list).slice(1)).toEqual(pistesOf(list).slice(1))
  expect(keepsPistes(list, out.list)).toBe(true)
  // Rien d'accepté : la liste est la même.
  expect(validatePistes(list, [{ id: 'retroA/p3', texts: 0 }], 'kcarte01', NOW).list).toBe(list)
})

test('une carte retirée rend ses seules pistes encore « validée » à « pas encore validée », sans carte ; une piste avancée ou d’une autre carte ne change pas', () => {
  const list = listWith([piste('retroA/p1', { state: 'validated', card: 'kcarte01' }), piste('retroA/p2', { state: 'ticket', card: 'kcarte01', mission: 'm1' }), piste('retroA/p3', { state: 'validated', card: 'kautre01' }), piste('retroA/p4', { state: 'running', card: 'kcarte01', mission: 'm1', group: 'A' })])
  const out = releaseCardPistes(list, 'kcarte01', NOW)
  expect(out.released).toEqual(['retroA/p1'])
  const [p1, p2, p3, p4] = pistesOf(out.list)
  expect(p1).toEqual(expect.objectContaining({ state: 'pending', stateBy: 'coo', stateAt: NOW }))
  expect(p1!.card).toBeUndefined()
  expect([p2, p3, p4]).toEqual(pistesOf(list).slice(1))
  expect(keepsPistes(list, out.list)).toBe(true)
})

test('la section range ensemble les pistes ouvertes qui partagent un fichier (p1 rejoint a.ts par p2), une case sur les seules « pas encore validée », la carte nommée ou dite absente', () => {
  const card = pistesCard('kcarte01', NOW)
  const pistes = [
    piste('retroA/p1', { files: ['hooks/b.ts'] }),
    piste('retroA/p2', { files: ['hooks/a.ts', 'hooks/b.ts'], comments: [{ text: 'Voir R12', by: 'coo', at: NOW }] }),
    piste('retroA/p3', { state: 'validated', card: 'kcarte01', files: ['hooks/a.ts'] }),
    piste('retroA/p4', { state: 'validated', card: 'kperdue1' }),
    piste('retroA/p5', { state: 'done' }),
  ]
  const runs = [{ ...newRun('retro', NOW, 'Rétro A'), id: 'retroA' } as Run]
  const view = pistesWaitingOf(pistes, runs, [card], new Map([['retroA/p1', 0], ['retroA/p3', 0], ['retroA/p2', 3]]))
  expect(view.rows.map(r => [r.id, r.file, r.isTickable, r.isTicked])).toEqual([
    ['retroA/p1', 'hooks/a.ts', true, true],
    ['retroA/p2', 'hooks/a.ts', true, false],
    ['retroA/p3', 'hooks/a.ts', false, false],
    ['retroA/p4', '', false, false],
  ])
  expect(view.rows[1]).toEqual(expect.objectContaining({ retro: 'Rétro A', last: 'Voir R12' }))
  expect(view.rows.map(r => r.card)).toEqual([undefined, undefined, card.title, 'carte absente'])
  expect(card.title).toMatch(/^Pistes de rétro · \d\d:\d\d$/)
  expect([view.closed, view.ticked]).toEqual([1, 1])
  // Un texte changé change l'empreinte.
  expect(pistesWaitingOf([...pistes.slice(0, 1).map(p => ({ ...p, history: [{ text: 'x', files: [], by: 'b', at: 1 }] })), ...pistes.slice(1)], runs, [card], new Map()).print).not.toBe(view.print)
  // Cochée sous un texte, puis le texte change : elle ne compte plus cochée.
  expect(pistesWaitingOf([{ ...pistes[0]!, history: [{ text: 'x', files: [], by: 'b', at: 1 }] }], runs, [], new Map([['retroA/p1', 0]])).rows[0]!.isTicked).toBe(false)
})

test('une carte « Pistes de rétro » se reconnaît à son dossier tiré de son id ; une carte de Claude ne prend jamais ce dossier', () => {
  const card = pistesCard('kcarte01', NOW)
  expect(card.folder).toBe(pistesCardFolder('kcarte01'))
  expect(isPistesCard(card)).toBe(true)
  expect(isPistesCard({ ...card, folder: 'autre-dossier' })).toBe(false)
  expect(parseCard({ title: 'X', start: 'to-tickets', askMatt: 'l. 3', mode: 'manual', effort: 'high', folder: 'pistes-de-retro-x' }, NOW, 'kclaude01')).toEqual({ refused: expect.stringMatching(/dashboard's own/) })
})

// ─── Le mod ───────────────────────────────────────────────────────────────

/** Pose la liste d'attente : au fichier du poste (par la fin de son chemin) et dans le stockage. */
const putList = (w: World, pistes: unknown[]) => {
  const list = listWith(pistes)
  w.files[`flow-board/pistes/${PROJECT}.json`] = JSON.stringify(list)
  // Le fichier que le mod a déjà écrit par son chemin entier, s'il existe : la même liste.
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/flow-board/pistes/${PROJECT}.json`)) w.files[k] = JSON.stringify(list)
  w.mem['coo-pistes:'] = list
}
const listOf = (w: World): Waitlist => {
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/flow-board/pistes/${PROJECT}.json`))
  return (path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist
}
const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

/** Le COO ouvert ici, la liste relue ; rend la vue montée. */
const cooWithList = async ($: any, clock: any, w: World, pistes: unknown[]) => {
  putList(w, pistes)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
}
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const mount = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })

test('chez le COO : la section montre les pistes ; cocher puis « ✂ Découper la sélection » les valide avec la carte « Pistes de rétro », posée dans « Lancements »', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWithList($, clock, w, [piste('retroA/p1', { files: ['hooks/coo.ts'] }), piste('retroA/p2'), piste('retroA/p3', { state: 'ticket', mission: 'm1', card: 'kautre01' })])
  const pane = await mount($)
  const shown = await texts(pane)
  expect(shown).toMatch(/Pistes en attente · 3/)
  expect(shown).toContain('hooks/coo.ts')
  // Une piste en ticket n'a pas de case.
  expect(await pane.find({ key: 'coo-piste-tick-retroA/p3' })).toBeUndefined()
  // Au terminal : la même section, ses cases et son bouton, sans dessin.
  const term = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await texts(term)).toMatch(/Pistes en attente · 3/)
  expect(await term.find({ key: 'coo-piste-tick-retroA/p1' })).toBeDefined()
  expect(await term.find({ key: 'coo-pistes-cut-go' })).toBeDefined()
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  await term.unmount()
  await pane.press({ key: 'coo-piste-tick-retroA/p1' })
  await pane.unmount()
  const again = await mount($)
  await again.press({ key: 'coo-pistes-cut-go' })
  await again.unmount()
  await settle(clock, 2)
  const [p1, p2, p3] = pistesOf(listOf(w))
  expect(p1).toEqual(expect.objectContaining({ state: 'validated', stateBy: 'coo' }))
  expect(p1!.card).toMatch(/^k/)
  expect(p2!.state).toBe('pending')
  expect(p3!.state).toBe('ticket')
  expect(w.toasts.join('\n')).toMatch(/1 piste\(s\) validée\(s\), portée\(s\) par la carte « Pistes de rétro · \d\d:\d\d »/)
  const view = await mount($)
  const after = await texts(view)
  expect(after).toMatch(/Lancements · 1/)
  expect(after).toContain(`travail/${pistesCardFolder(p1!.card!)}/`)
  expect(after).toMatch(/carte « Pistes de rétro · \d\d:\d\d »/)
  await view.unmount()
  // Le plafond des cartes ne la chasse pas : huit cartes de Claude ensuite, elle reste.
  for (let i = 0; i < 8; i++) await call($, { card: { title: `Carte ${i}`, start: 'to-spec', askMatt: 'l. 3', mode: 'manual', effort: 'high', folder: `dossier-${i}` } })
  const full = await mount($)
  expect(await full.find({ key: `coo-card-remove-${p1!.card!}` })).toBeDefined()
  await full.unmount()
})

test('une piste changée entre l’affichage et le clic : la sélection ne part pas, aucune carte ne reste', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWithList($, clock, w, [piste('retroA/p1')])
  const pane = await mount($)
  await pane.press({ key: 'coo-piste-tick-retroA/p1' })
  await pane.unmount()
  const shownBefore = await mount($)
  // Une autre rétro l'écarte pendant ce temps (relu dans la liste, la vue n'a pas encore été redessinée).
  putList(w, [piste('retroA/p1', { state: 'dropped', reason: 'doublon', stateBy: 'retroB', stateAt: NOW + 1 })])
  await shownBefore.press({ key: 'coo-pistes-cut-go' })
  await shownBefore.unmount()
  await settle(clock, 2)
  expect(pistesOf(listOf(w))[0]).toEqual(expect.objectContaining({ state: 'dropped', reason: 'doublon' }))
  // Refusée par la validation, sur la liste relue (pas par l'empreinte de la vue) : la carte posée est repartie.
  expect(w.toasts.join('\n')).toMatch(/Rien n’est découpé\. Refusées : retroA\/p1 \(devenue « écartée »\)/)
  const view = await mount($)
  expect(await texts(view)).not.toMatch(/Lancements/)
  await view.unmount()
  // Refusée, elle a quitté la sélection : redevenue « pas encore validée », sa case est vide.
  putList(w, [piste('retroA/p1', { history: [{ text: 'avant', files: [], by: 'retroB', at: NOW }] })])
  await settle(clock, 6)
  const later = await mount($)
  expect((await later.find({ key: 'coo-piste-tick-retroA/p1' }))?.props.label).toBe('☐')
  await later.unmount()
})

/** Le COO ici, une piste validée par un découpage ; rend l'id de sa carte. */
const cutOne = async ($: any, clock: any, w: World): Promise<string> => {
  await cooWithList($, clock, w, [piste('retroA/p1'), piste('retroA/p2')])
  const pane = await mount($)
  await pane.press({ key: 'coo-piste-tick-retroA/p1' })
  await pane.unmount()
  const again = await mount($)
  await again.press({ key: 'coo-pistes-cut-go' })
  await again.unmount()
  await settle(clock, 2)
  return pistesOf(listOf(w))[0]!.card!
}

test('« ✕ Retirer » la carte : ses pistes encore « validée » redeviennent « pas encore validée », puis la carte part', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const card = await cutOne($, clock, w)
  const pane = await mount($)
  await pane.press({ key: `coo-card-remove-${card}` })
  await pane.unmount()
  await settle(clock, 2)
  expect(pistesOf(listOf(w))[0]).toEqual(expect.objectContaining({ state: 'pending', stateBy: 'coo' }))
  expect(pistesOf(listOf(w))[0]!.card).toBeUndefined()
  expect(w.toasts.join('\n')).toMatch(/Carte « Pistes de rétro · \d\d:\d\d » retirée/)
  const view = await mount($)
  expect(await texts(view)).not.toMatch(/Lancements/)
  await view.unmount()
})

test('« ✕ Retirer » refusé tant qu’un lancement de la carte est gardé : rien ne change', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const card = await cutOne($, clock, w)
  const rec: LaunchRecord = { v: 1, id: 'lpistes0001', card, root: '', title: 'Pistes de rétro', start: 'to-tickets', mode: 'manual', effort: 'high', folder: pistesCardFolder(card), at: NOW, by: 'session-A' }
  w.mem[launchKey(rec.id)] = rec
  const pane = await mount($)
  await pane.press({ key: `coo-card-remove-${card}` })
  await pane.unmount()
  await settle(clock, 2)
  expect(pistesOf(listOf(w))[0]).toEqual(expect.objectContaining({ state: 'validated', card }))
  expect(w.toasts.join('\n')).toMatch(/Rien n’est retiré : un lancement de cette carte est en cours/)
})

test('une carte « Pistes de rétro » dont plus aucune piste n’est « validée » ne se lance pas', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const card = await cutOne($, clock, w)
  // Une rétro l'écarte depuis : plus aucune piste ne porte la carte « validée ».
  putList(w, [piste('retroA/p1', { state: 'dropped', card, reason: 'doublon' }), piste('retroA/p2')])
  await settle(clock, 6)
  const pane = await mount($)
  await pane.press({ key: `coo-card-manual-${card}` })
  await pane.unmount()
  await settle(clock, 2)
  expect(w.toasts.join('\n')).toMatch(/Rien n’est lancé : plus aucune piste ne porte cette carte/)
  expect(Object.keys(w.mem).some(k => k.startsWith('coo-launch:'))).toBe(false)
})

test('la mission lancée par la carte relit ses pistes dans la liste (textes cités) et la ligne « Pistes : » à poser ; sans piste, rien à découper', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-P'
  putList(w, [piste('retroA/p1', { state: 'validated', card: 'kpistes01', text: 'Borner « le » relevé', files: ['hooks/coo.ts'] }), piste('retroA/p2', { state: 'validated', card: 'kautre01' }), piste('retroA/p3', { state: 'dropped', card: 'kpistes01', reason: 'doublon', stateBy: 'retroB', stateAt: NOW - 5000 })])
  const rec: LaunchRecord = { v: 1, id: 'lpistes0001', card: 'kpistes01', root: '', title: 'Pistes de rétro', start: 'to-tickets', mode: 'manual', effort: 'high', folder: pistesCardFolder('kpistes01'), at: NOW - 30_000, by: 'session-COO' }
  w.mem[launchKey(rec.id)] = rec
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  const consumed = $.tool.call({ tool: TOOL, launch: rec.id } as any)
  await settle(clock, 3)
  const text = String(((await consumed) as any).result)
  expect(text).toMatch(/Launch: consumed/)
  expect(text).toContain('"retroA/p1"')
  expect(text).not.toContain('retroA/p2')
  // Écartée depuis la carte : nommée, avec qui, à ne pas découper.
  expect(text).toMatch(/Dropped since the card, not to cut \(tell the user\): "retroA\/p3" by "retroB"/)
  expect(text).not.toContain('« le »')
  expect(text).toMatch(/« Pistes : <piste ids, comma-separated> »/)
  expect(stored(w).runs[0]!.launch).toMatchObject({ card: 'kpistes01' })
})

test('une rétro qui relit la liste n’a plus sa section de rétro chez le COO ; une rétro d’avant la garde', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const items = [{ id: 'r1', label: 'Hooks : relire le siège', status: 'todo' }, { id: 'r2', label: 'Docs : pas déposée', status: 'todo' }]
  const make = (title: string, withStep: boolean, closed: string): Run => {
    const base = newRun('retro', NOW - 50_000, title)
    const steps = withStep ? [...base.phases[0]!.steps.slice(0, 3), { id: 'attente', status: 'done' }, { id: 'present', status: 'active', at: NOW - 1000 }] : base.phases[0]!.steps
    return { ...base, phases: [{ ...base.phases[0]!, items, steps }, ...base.phases.slice(1)], status: 'active', owner: 'session-R', launch: { id: `l${closed}0001`, card: `kr${closed}`, at: NOW - 60_000, folder: `retro-${closed}`, start: 'retro', of: `m${closed}`, mode: 'manual' } } as unknown as Run
  }
  writeBoard(w, b => ({ ...b, runs: [make('Rétro nouvelle', true, 'aaaaaaa'), make('Rétro ancienne', false, 'bbbbbbb')] }))
  const fresh = stored(w).runs.find(r => r.title === 'Rétro nouvelle')!.id
  await cooWithList($, clock, w, [piste(`${fresh}/r1`)])
  const pane = await mount($)
  const shown = await texts(pane)
  expect(shown).toMatch(/Pistes de la rétro « Rétro ancienne » · 2/)
  // La rétro qui relit la liste ne garde dans sa section que sa piste absente de la liste ; l'autre se coche dans « Pistes en attente ».
  expect(shown).toMatch(/Pistes de la rétro « Rétro nouvelle » · 1/)
  expect(await pane.find({ key: `coo-retro-tick-${fresh}-r1` })).toBeUndefined()
  expect(await pane.find({ key: `coo-retro-tick-${fresh}-r2` })).toBeDefined()
  expect(await pane.find({ key: `coo-piste-tick-${fresh}/r1` })).toBeDefined()
  await pane.unmount()
})

test('une rétro qui relit la liste et finit : ses pistes relues dans la liste ne se recopient pas dans « À reprendre » au relevé de la mission close ; les autres oui', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const base = newRun('retro', NOW - 50_000, 'Rétro finie')
  const steps = [...base.phases[0]!.steps.slice(0, 3), { id: 'attente', status: 'done' }, ...base.phases[0]!.steps.slice(3).map(s => ({ id: s.id, status: 'done' }))]
  const items = [{ id: 'r1', label: 'Hooks : dans la liste', status: 'todo' }, { id: 'r2', label: 'Docs : jamais déposée', status: 'todo' }]
  const done = { ...base, phases: [{ ...base.phases[0]!, items, steps, status: 'done' }, ...base.phases.slice(1).map(p => ({ ...p, status: 'skipped' }))], status: 'done', finishedAt: NOW - 5000 } as unknown as Run
  writeBoard(w, b => ({ ...b, runs: [done] }))
  putList(w, [piste(`${done.id}/r1`)])
  await start($)
  const opening = await openCoo($, clock)
  await settle(clock, 6)
  const turn = `${opening}\n${JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))}`
  expect(turn).toMatch(/Closed mission « Rétro finie »/)
  expect(turn).toMatch(/Docs : jamais d/)
  expect(turn).not.toMatch(/Hooks : dans la liste/)
})

test('une coche d’un texte changé depuis (montrée vide) se refait d’un clic, sur le texte montré', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWithList($, clock, w, [piste('retroA/p1')])
  const pane = await mount($)
  await pane.press({ key: 'coo-piste-tick-retroA/p1' })
  await pane.unmount()
  putList(w, [piste('retroA/p1', { text: 'Nouveau', history: [{ text: 'Texte de retroA/p1', files: [], by: 'retroB', at: NOW }] })])
  await settle(clock, 6)
  const shown = await mount($)
  expect((await shown.find({ key: 'coo-piste-tick-retroA/p1' }))?.props.label).toBe('☐')
  await shown.press({ key: 'coo-piste-tick-retroA/p1' })
  await shown.unmount()
  const again = await mount($)
  expect((await again.find({ key: 'coo-piste-tick-retroA/p1' }))?.props.label).toBe('☑')
  await again.unmount()
})

test('les pistes qui partagent un fichier, de proche en proche, se rangent ensemble', () => {
  const view = pistesWaitingOf([piste('retroA/p1', { files: ['hooks/b.ts', 'hooks/c.ts'] }), piste('retroA/p2', { files: ['hooks/c.ts'] }), piste('retroA/p3', { files: ['hooks/a.ts'] })], [], [], new Map())
  expect(view.rows.map(r => [r.id, r.file])).toEqual([
    ['retroA/p3', 'hooks/a.ts'],
    ['retroA/p1', 'hooks/b.ts'],
    ['retroA/p2', 'hooks/b.ts'],
  ])
})
