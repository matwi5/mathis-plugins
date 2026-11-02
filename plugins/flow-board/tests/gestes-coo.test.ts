import { expect, mock, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun, openQuestions, questionPrint } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// Les questions et les gestes chez le COO. Invariant : « Un geste n'est appliqué que sur le texte de
// question que l'utilisateur a vu ; une question changée depuis le clic n'est pas répondue. »

const T0 = 300_000_000

/** Une mission en auto d'une autre discussion, avec ses questions bloquantes. */
const autoMission = (now: number, waiting: unknown[]): Run =>
  ({
    ...newRun('implement', now - 60_000, 'Mission de B'),
    status: 'active',
    owner: 'session-B',
    updatedAt: now - 1_000,
    auto: { onAt: now - 30_000, onBy: 'session-B' },
    waiting,
  }) as unknown as Run

const SPEND = { id: 'q-dep', blocks: { kind: 'phase', id: 'implement' }, text: 'Installer Playwright (lourd) ?', at: T0 - 5_000, gesture: 'spend' }

/** La clé d'un bouton de geste : la mission et l'empreinte du texte affiché, jamais la place de la ligne. */
const keyOf = (answer: 'yes' | 'no', run: Run, i = 0): string => `coo-gesture-${answer}-${run.id}-${openQuestions(run)[i]!.id}-${questionPrint(openQuestions(run)[i]!)}`

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

// ─── Le modèle : une question peut porter un geste ────────────────────────

test('« waiting » accepte un geste (dépense, action externe, faille laissée avec son total) ; l’empreinte suit le texte vu', () => {
  const run: Run = { ...newRun('implement', T0, 'M'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const out = applyReport(
    board,
    {
      waiting: [
        { id: 'q1', phase: 'implement', text: 'Payer le service X ?', gesture: 'spend' },
        { id: 'q2', phase: 'implement', text: 'Écrire dans le dépôt tiers ?', gesture: 'external' },
        { id: 'q3', phase: 'implement', text: 'Laisser F1 sans correctif ?', gesture: 'flaw', dismissed: 1 },
        { id: 'q4', phase: 'implement', text: 'Laisser F2 ?', gesture: 'flaw' },
        { id: 'q5', phase: 'implement', text: 'Autre ?', gesture: 'n’importe quoi' },
      ],
    },
    T0 + 1,
  )
  const open = openQuestions(out.board.runs[0]!)
  expect(open.map(q => [q.id, q.gesture?.kind ?? null, q.gesture?.dismissed ?? null])).toEqual([
    ['q1', 'spend', null],
    ['q2', 'external', null],
    ['q3', 'flaw', 1],
  ])
  expect(out.text).toMatch(/"q4": a "flaw" gesture needs "dismissed"/)
  expect(out.text).toMatch(/"q5": "gesture" is one of/)
  // L'empreinte change avec le texte, la cible, le geste ou la pose de la question (retirée puis reposée sous le même id).
  const q1 = open[0]!
  expect(questionPrint(q1)).toBe(questionPrint({ ...q1 }))
  expect(questionPrint(q1)).not.toBe(questionPrint({ ...q1, text: 'Payer le service Y ?' }))
  expect(questionPrint(q1)).not.toBe(questionPrint({ ...q1, gesture: { kind: 'external' } }))
  const reposed = { ...q1, at: (q1.at ?? 0) + 10 }
  expect(questionPrint(q1)).not.toBe(questionPrint(reposed))
  // Reformulée sous le même id, la question garde sa pose : seule l'empreinte de son texte change.
  const reworded = applyReport(out.board, { waiting: [{ id: 'q1', phase: 'implement', text: 'Payer le service Z ?', gesture: 'spend' }] }, T0 + 5)
  expect(openQuestions(reworded.board.runs[0]!)[0]!.at).toBe(q1.at)
})

test('une question retirée puis reposée au même texte se répond de nouveau chez le COO : l’ancienne réponse ne la couvre pas', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = autoMission(T0, [SPEND])
  const old = questionPrint(openQuestions(run)[0]!)
  // La première pose a été répondue et appliquée ; la question est reposée plus tard, au même texte.
  const reposed = { ...run, waiting: [{ ...SPEND, at: T0 - 1_000 }] } as unknown as Run
  writeBoard(w, b => ({ ...b, runs: [reposed] }))
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'gesture', run: run.id, at: T0 - 3_000, question: 'q-dep', print: old, answer: 'no' }])
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: keyOf('yes', reposed) })).toBeDefined()
  expect(await texts(pane)).not.toMatch(/a changé depuis ta réponse/)
  await pane.press({ key: keyOf('yes', reposed) })
  await pane.unmount()
  await settle(clock, 2)
  expect(entries(w).filter(e => e.kind === 'gesture' && e.answer === 'yes')).toHaveLength(1)
})

// ─── Chez le COO : ce qui t'attend, le bouton d'un geste ──────────────────

test('chez le COO, la question d’un geste porte ses boutons ; le clic écrit l’entrée avec l’empreinte du texte affiché', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = autoMission(T0, [SPEND])
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/Installer Playwright/)
  expect(await texts(pane)).toMatch(/Mission de B/)
  expect((await pane.find({ key: keyOf('yes', run) }))?.props.label).toMatch(/Autoriser/)
  expect((await pane.find({ key: keyOf('no', run) }))?.props.label).toMatch(/Refuser/)
  await pane.press({ key: keyOf('yes', run) })
  await pane.unmount()
  await settle(clock, 2)
  const print = questionPrint(openQuestions(run)[0]!)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'gesture', run: run.id, question: 'q-dep', print, answer: 'yes' })])
  // Un second clic sur la même version : rien de plus.
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await again.find({ key: keyOf('yes', run) })).toBeUndefined()
  expect(await texts(again)).toMatch(/en cours/)
  await again.unmount()
})

test('chez le COO, la question changée entre l’affichage et le clic : rien n’est écrit, et le COO le dit', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = autoMission(T0, [SPEND])
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  // L'autre discussion réécrit sa question pendant que la personne lit.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => ({ ...r, waiting: [{ ...SPEND, text: 'Installer Chromium et Playwright ?' }] }) as unknown as Run) }))
  await pane.press({ key: keyOf('yes', run) })
  await pane.unmount()
  await settle(clock, 2)
  expect(entries(w)).toEqual([])
  expect(w.toasts.join('\n')).toMatch(/a changé depuis/)
})

test('la mission d’un geste en pause : le COO dit de la reprendre pour que la réponse s’applique', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = autoMission(T0, [SPEND])
  const print = questionPrint(openQuestions(run)[0]!)
  writeBoard(w, b => ({ ...b, runs: [{ ...run, status: 'paused', owner: undefined }] }))
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'gesture', run: run.id, at: T0 - 1_000, question: 'q-dep', print, answer: 'yes' }])
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/resume it|reprends-la/)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/reprends-la pour que la réponse s’applique/)
  await pane.unmount()
})

// ─── Chez le manager : le mod applique le geste, une fois ─────────────────

/** Ouvre une mission ici et y pose les questions, comme son Claude. */
const openHere = async ($: any, clock: any, w: ReturnType<typeof world>, waiting: unknown[]): Promise<string> => {
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  await $.tool.call({ tool: TOOL, waiting } as any)
  await settle(clock, 2)
  return stored(w).activeId!
}

test('le mod du manager applique un accord de dépense : un message composé par lui, une seule fois', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openHere($, clock, w, [{ id: 'q-dep', phase: 'implement', text: 'Installer Playwright ?', gesture: 'spend' }])
  const q = openQuestions(stored(w).runs.find(r => r.id === runId)!)[0]!
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'gesture', run: runId, at: T0, question: 'q-dep', print: questionPrint(q), answer: 'yes' }])
  await settle(clock, 6)
  const sent = w.prompts.filter(p => /q-dep/.test(p))
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/COO/)
  expect(sent[0]).toMatch(/autoris/i)
  expect(sent[0]).toMatch(/"answered": true/)
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
  await settle(clock, 10)
  expect(w.prompts.filter(p => /q-dep/.test(p))).toHaveLength(1)
  // Le manager n'écrit jamais le fichier de coordination.
  expect(w.coord.writes).toEqual([])
})

test('le mod du manager n’applique pas un geste sur une question changée depuis le clic', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openHere($, clock, w, [{ id: 'q-dep', phase: 'implement', text: 'Installer Playwright ?', gesture: 'spend' }])
  const seen = questionPrint(openQuestions(stored(w).runs.find(r => r.id === runId)!)[0]!)
  // La question est reformulée après le clic.
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q-dep', phase: 'implement', text: 'Installer Playwright et Chromium ?', gesture: 'spend' }] } as any)
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'gesture', run: runId, at: T0, question: 'q-dep', print: seen, answer: 'yes' }])
  await settle(clock, 8)
  // L'entrée a bien été relue et consommée sans effet.
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
  expect(w.prompts.filter(p => /q-dep/.test(p))).toEqual([])
  expect(openQuestions(stored(w).runs.find(r => r.id === runId)!).map(q => q.id)).toEqual(['q-dep'])
})

test('une faille laissée sans correctif : appliquée comme un envoi de la mission, question retirée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openHere($, clock, w, [{ id: 'q-f1', phase: 'implement', text: 'Laisser F1 sans correctif ?', gesture: 'flaw', dismissed: 1 }])
  const q = openQuestions(stored(w).runs.find(r => r.id === runId)!)[0]!
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'gesture', run: runId, at: T0, question: 'q-f1', print: questionPrint(q), answer: 'yes' }])
  await settle(clock, 6)
  const run = stored(w).runs.find(r => r.id === runId)!
  expect(run.security?.dismissed).toBe(1)
  expect(openQuestions(run)).toEqual([])
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
})

test('une faille à corriger (refus de la laisser) : le mod demande à son Claude de la corriger, sans rien laisser', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openHere($, clock, w, [{ id: 'q-f1', phase: 'implement', text: 'Laisser F1 sans correctif ?', gesture: 'flaw', dismissed: 1 }])
  const q = openQuestions(stored(w).runs.find(r => r.id === runId)!)[0]!
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'gesture', run: runId, at: T0, question: 'q-f1', print: questionPrint(q), answer: 'no' }])
  await settle(clock, 6)
  expect(stored(w).runs.find(r => r.id === runId)!.security?.dismissed).toBeUndefined()
  expect(w.prompts.filter(p => /q-f1/.test(p) && /corrige/i.test(p))).toHaveLength(1)
})

// ─── Une décision écrite, relayée par le COO ──────────────────────────────

test('chez le COO, une réponse écrite se note seulement avec un DECISIONS.md existant sous travail/ et l’empreinte de la question vue', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const q = { id: 'q-sens', blocks: { kind: 'phase', id: 'implement' }, text: 'Effacer les anciens totaux ?', at: T0 - 5_000 }
  const run = autoMission(T0, [q])
  writeBoard(w, b => ({ ...b, runs: [run] }))
  w.files['travail/sujet/DECISIONS.md'] = '# Décisions\n'
  w.files['travail/sujet/notes.md'] = '# Notes\n'
  await start($)
  const opening = await openCoo($, clock)
  const print = questionPrint(openQuestions(run)[0]!)
  // Le relevé donne l'empreinte de chaque question au Claude du COO.
  expect(opening).toContain(print)
  const call = async (file: string, seen = print) => String(((await $.tool.call({ tool: TOOL, coordinate: { answer: [{ mission: run.id, question: 'q-sens', seen, file, series: 3 }] } } as any)) as any).result)
  for (const bad of ['travail/sujet/notes.md', 'travail/../DECISIONS.md', 'docs/DECISIONS.md', 'travail/absent/DECISIONS.md', '/travail/sujet/DECISIONS.md']) {
    expect(await call(bad), bad).toMatch(/refused/i)
  }
  expect(await call('travail/sujet/DECISIONS.md', 'qzzzz')).toMatch(/changed since/i)
  expect(entries(w)).toEqual([])
  expect(await call('travail/sujet/DECISIONS.md')).toMatch(/recorded/i)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'answer', run: run.id, question: 'q-sens', print, file: 'travail/sujet/DECISIONS.md', series: 3 })])
})

test('le mod du manager relaie une réponse écrite à son Claude, qui retire la question ; rien ne se rejoue ensuite', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openHere($, clock, w, [{ id: 'q-sens', phase: 'implement', text: 'Effacer les anciens totaux ?' }])
  const q = openQuestions(stored(w).runs.find(r => r.id === runId)!)[0]!
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'answer', run: runId, at: T0, question: 'q-sens', print: questionPrint(q), file: 'travail/sujet/DECISIONS.md', series: 3 }])
  await settle(clock, 6)
  const sent = w.prompts.filter(p => /q-sens/.test(p))
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/travail\/sujet\/DECISIONS\.md/)
  expect(sent[0]).toMatch(/3/)
  // Le Claude du manager retire la question.
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q-sens', answered: true }] } as any)
  await settle(clock, 10)
  expect(w.prompts.filter(p => /q-sens/.test(p))).toHaveLength(1)
})

// ─── Ce que la revue du ticket a trouvé ───────────────────────────────────

test('une réponse écrite ne remplace jamais un geste, ni ne répond à une question du mod', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const stale = { id: 'sans-suite:groups:A#1', blocks: { kind: 'phase', id: 'implement' }, text: 'Envoi resté sans suite', at: T0 - 4_000 }
  const run = autoMission(T0, [SPEND, stale])
  writeBoard(w, b => ({ ...b, runs: [run] }))
  w.files['travail/sujet/DECISIONS.md'] = '# Décisions\n'
  await start($)
  await openCoo($, clock)
  const [spend, mod] = openQuestions(run)
  for (const q of [spend!, mod!]) {
    const r = String(((await $.tool.call({ tool: TOOL, coordinate: { answer: [{ mission: run.id, question: q.id, seen: questionPrint(q), file: 'travail/sujet/DECISIONS.md', series: 2 }] } } as any)) as any).result)
    expect(r, q.id).toMatch(/is a gesture|question of the dashboard itself/)
  }
  expect(entries(w)).toEqual([])
  // La question du mod n'a ni bouton de réponse ni geste chez le COO : elle se répond dans la mission.
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: `coo-answer-${run.id}-${mod!.id}-${questionPrint(mod!)}` })).toBeUndefined()
  expect(await texts(pane)).toMatch(/réponds dans la mission/)
  await pane.unmount()
})

test('chez le manager, une réponse écrite qui vise une question à geste est consommée sans rien envoyer', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openHere($, clock, w, [{ id: 'q-dep', phase: 'implement', text: 'Installer Playwright ?', gesture: 'spend' }])
  const q = openQuestions(stored(w).runs.find(r => r.id === runId)!)[0]!
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'answer', run: runId, at: T0, question: 'q-dep', print: questionPrint(q), file: 'travail/sujet/DECISIONS.md', series: 2 }])
  await settle(clock, 8)
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
  expect(w.prompts.filter(p => /q-dep/.test(p))).toEqual([])
})

test('l’auto mis en pause par une question qui bloque tout : la question reste chez le COO, avec ses boutons', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = { ...autoMission(T0, [SPEND]), auto: { onAt: T0 - 30_000, onBy: 'session-B', offAt: T0 - 2_000, offWhy: 'blocked' } } as unknown as Run
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: keyOf('yes', run) })).toBeDefined()
  await pane.unmount()
})

test('« ✎ Répondre » prépare la réponse avec l’id de la mission et l’empreinte du texte lu', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const q = { id: 'q-sens', blocks: { kind: 'phase', id: 'implement' }, text: 'Effacer les anciens totaux ?', at: T0 - 5_000 }
  const run = autoMission(T0, [q])
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  const print = questionPrint(openQuestions(run)[0]!)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: `coo-answer-${run.id}-q-sens-${print}` })
  await pane.unmount()
  await settle(clock, 1)
  expect(w.fills.join('\n')).toContain(print)
  expect(w.fills.join('\n')).toContain(run.id)
})

test('une faille ne se pose pas sur un ticket : son geste vise son groupe, ou la phase sans groupes', () => {
  const run: Run = { ...newRun('implement', T0, 'M'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const withTicket = applyReport(board, { tickets: [{ id: 't1', name: 'Un' }] }, T0 + 1).board
  const out = applyReport(withTicket, { waiting: [{ id: 'q1', ticket: 't1', text: 'Laisser F1 ?', gesture: 'flaw', dismissed: 1 }] }, T0 + 2)
  expect(out.text).toMatch(/never a ticket/)
  expect(openQuestions(out.board.runs[0]!)).toEqual([])
})

// ─── Ce que la passe d'après-correctifs a trouvé ──────────────────────────

test('les boutons suivent leur question : deux missions, la plus récente qui bouge ne met pas son geste sous le bouton de l’autre', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const b = autoMission(T0, [SPEND])
  const a = { ...autoMission(T0, [{ ...SPEND, id: 'q-pay', text: 'Payer le service X ?', at: T0 - 2_000 }]), title: 'Mission A', owner: 'session-C' } as Run
  writeBoard(w, x => ({ ...x, runs: [b, a] }))
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const first = (await pane.findAll({ type: 'Text' })).map((t: any) => String(t.props.text ?? '')).findIndex((t: string) => /Installer Playwright/.test(t))
  // La mission A bouge (son updatedAt monte) : l'ordre des questions, par leur pose, ne change pas.
  writeBoard(w, x => ({ ...x, runs: x.runs.map(r => (r.id === a.id ? { ...r, updatedAt: T0 + 5_000 } : r)) }))
  await settle(clock, 6)
  const then = (await pane.findAll({ type: 'Text' })).map((t: any) => String(t.props.text ?? '')).findIndex((t: string) => /Installer Playwright/.test(t))
  expect(then).toBe(first)
  await pane.press({ key: keyOf('yes', b) })
  await pane.unmount()
  await settle(clock, 2)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'gesture', run: b.id, question: 'q-dep' })])
})

test('une faille reformulée depuis le clic n’est pas laissée : rien n’est écrit sur la sécurité, la question reste', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openHere($, clock, w, [{ id: 'q-f1', phase: 'implement', text: 'Laisser F1 sans correctif ?', gesture: 'flaw', dismissed: 1 }])
  const seen = questionPrint(openQuestions(stored(w).runs.find(r => r.id === runId)!)[0]!)
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q-f1', phase: 'implement', text: 'Laisser F1 et F2 sans correctif ?', gesture: 'flaw', dismissed: 2 }] } as any)
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'gesture', run: runId, at: T0, question: 'q-f1', print: seen, answer: 'yes' }])
  await settle(clock, 8)
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
  const run = stored(w).runs.find(r => r.id === runId)!
  expect(run.security?.dismissed).toBeUndefined()
  expect(openQuestions(run).map(q => q.id)).toEqual(['q-f1'])
})

// ─── Ce que la revue du groupe a trouvé ──────────────────────────────────

test('deux réponses écrites à la même question au même texte : une seule est relayée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const runId = await openHere($, clock, w, [{ id: 'q-sens', phase: 'implement', text: 'Effacer les anciens totaux ?' }])
  const q = openQuestions(stored(w).runs.find(r => r.id === runId)!)[0]!
  const answer = (id: string, series: number) => ({ id, kind: 'answer', run: runId, at: T0, question: 'q-sens', print: questionPrint(q), file: 'travail/sujet/DECISIONS.md', series })
  w.coord.text = coordFile([answer('cabc1234', 3)])
  await settle(clock, 6)
  // Une seconde réponse, écrite après le délai de 2 minutes, avant que Claude retire la question.
  w.coord.text = coordFile([answer('cabc1234', 3), answer('cdef5678', 4)])
  await settle(clock, 10)
  expect(w.prompts.filter(p => /q-sens/.test(p))).toHaveLength(1)
})
