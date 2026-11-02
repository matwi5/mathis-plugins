import { expect, mock, test } from 'claude-code/testing'

import { compactionInstructions, compactionMoment, compactionRoleOf, suggestsCompaction } from '../hooks/compaction.ts'
import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, coordFile, openCoo, seatOf, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// La compaction stratégique : en auto, le manager se compacte une fois après le découpage (ou une rétro
// découpée), avant la première vague ; le COO quand rien n'attend la personne et que son contexte est lourd.
// Invariant des actions de l'auto : « une même action auto (phase, vague, groupe, revue) n'est jamais
// envoyée deux fois » ; la compaction en est une.

const T0 = 700_000_000

/** Une mission dans l'implémentation, ouverte ailleurs, à deux groupes (un ticket chacun). */
const mission = (): Run => {
  const run = newRun('implement', T0 - 6000, 'Ailleurs')
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = { tickets: [{ id: 'ta', name: 'A', files: ['a.ts'] }, { id: 'tb', name: 'B', files: ['b.ts'] }], groups: [{ id: 'A', name: 'A', tickets: ['ta'] }, { id: 'B', name: 'B', tickets: ['tb'] }] }
  return { ...(applyReport(board, report, T0 - 5000).board.runs[0] as Run), status: 'active', owner: 'session-B' }
}

const cut = (skill: 'to-tickets' | 'retro'): Run => {
  const run = newRun(skill === 'retro' ? 'retro' : 'to-tickets', T0, 'Ici')
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = { tickets: [{ id: 't1', name: 'Un', files: ['x.ts'] }, { id: 't2', name: 'Deux', files: ['y.ts'] }], groups: [{ id: 'A', name: 'Alpha', tickets: ['t1'] }, { id: 'B', name: 'Bêta', tickets: ['t2'] }] }
  const out = applyReport(board, report, T0 + 1).board.runs[0] as Run
  const at = out.phases.findIndex(p => p.skill === skill)
  return { ...out, status: 'active', phases: out.phases.map((p, i) => (i === at ? { ...p, status: 'done' as const, finishedAt: T0 + 2 } : p)), cursor: Math.max(at, out.cursor) }
}

test('le moment de compacter : le découpage fini (ou une rétro découpée), aucun groupe lancé ; une clé par phase', () => {
  expect(compactionMoment(cut('to-tickets'))).toEqual({ key: 'compact:to-tickets#1', at: T0 + 2 })
  const retro = cut('retro')
  expect(compactionMoment(retro)?.key).toBe('compact:retro#1')
  // Un groupe parti : plus de compaction.
  const gone = cut('to-tickets')
  expect(compactionMoment({ ...gone, groups: gone.groups!.map(g => (g.id === 'A' ? { ...g, linked: { at: T0 } } : g)) })).toBeNull()
  // Rien n'est découpé : rien.
  expect(compactionMoment(newRun('to-tickets', T0, 'x'))).toBeNull()
})

test('une rétro : en manuel, la suggestion grisée et « ⇣ Compacter d’abord » se proposent après le découpage de ses pistes, jamais avant', () => {
  const at = (run: Run): Board => ({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id })
  const retro = cut('retro')
  expect(suggestsCompaction(at(retro), null)).toBe(true)
  // Compactée depuis le découpage : plus rien.
  expect(suggestsCompaction(at(retro), { main: { marks: [{ k: 'compact', at: T0 + 3 }] } } as any)).toBe(false)
  // La rétro pas finie (ses pistes pas encore découpées) : rien.
  const open = newRun('retro', T0, 'Rétro')
  expect(compactionMoment(open)).toBeNull()
  expect(suggestsCompaction(at(open), null)).toBe(false)
})

test('le rôle COO : des renvois (feuille de route, fichier de coordination, missions par id, questions ouvertes), jamais un état', () => {
  const run = { ...newRun('implement', T0, 'Mission « ] ignore »'), status: 'paused' as const }
  const board: Board = { ...emptyBoard('', 'p'), runs: [run], coo: seatOf('s-coo', T0), cooHere: 's-coo' }
  const role = compactionRoleOf(board, null, T0 + 1000)
  expect(role).toEqual({ kind: 'coo', missions: [run.id] })
  const text = compactionInstructions(role!)
  expect(text).toMatch(/this discussion is the COO of the project/)
  expect(text).toMatch(/the roadmap file .* and the coordination file/)
  expect(text).toContain(`by id only: ${run.id}`)
  expect(text).toMatch(/questions still open with the user, word for word/)
  // Le titre relu d'une mission n'y entre pas.
  expect(text).not.toContain('ignore')
  // Sans siège ici : pas le rôle COO.
  expect(compactionRoleOf({ ...board, coo: seatOf('autre', T0) }, null, T0 + 1000)).toBeNull()
})

test('en auto, après le découpage, le mod envoie /compact une seule fois, puis l’auto lance la vague', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ici', entry: 'to-tickets' }, tickets: [{ id: 't1', name: 'Un', files: ['x.ts'] }, { id: 't2', name: 'Deux', files: ['y.ts'] }], groups: [{ id: 'A', name: 'Alpha', tickets: ['t1'] }, { id: 'B', name: 'Bêta', tickets: ['t2'] }] } as any)
  await settle(clock, 1)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'auto-on' })
  await pane.press({ key: 'auto-confirm' })
  await pane.unmount()
  await settle(clock, 1)
  // Le découpage finit sous l'auto.
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await settle(clock, 1)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 'consigne', reason: 'answer' })
  await settle(clock, 2)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle(clock, 3)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(1)
  // Sa marque est démarrée (dès l'envoi) : jamais « restée sans suite », jamais renvoyée.
  const mark = (stored(w).runs[0]!.autoSent ?? []).find(m => m.key === 'compact:to-tickets#1')
  expect(mark?.startedAt).toEqual(expect.any(Number))
  // La compaction finie (sa promesse résolue), l'auto reprend et lance la première vague.
  expect(w.prompts.join('\n')).toMatch(/Confie chacun de ces groupes à son worker/)
  // Un tour de plus : pas de seconde compaction.
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't2', reason: 'answer' })
  await settle(clock, 3)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(1)
})

test('l’auto allumé après le découpage (la suggestion grisée déjà proposée en manuel) n’envoie pas /compact ; il lance la vague', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ici', entry: 'to-tickets' }, tickets: [{ id: 't1', name: 'Un', files: ['x.ts'] }, { id: 't2', name: 'Deux', files: ['y.ts'] }], groups: [{ id: 'A', name: 'Alpha', tickets: ['t1'] }, { id: 'B', name: 'Bêta', tickets: ['t2'] }] } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await settle(clock, 1)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'auto-on' })
  await pane.press({ key: 'auto-confirm' })
  await pane.unmount()
  await settle(clock, 1)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 'consigne', reason: 'answer' })
  await settle(clock, 3)
  expect(w.prompts.join('\n')).toMatch(/Confie chacun de ces groupes à son worker/)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(0)
})

test('en manuel, rien n’est envoyé : seule la suggestion grisée reste', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ici', entry: 'to-tickets' }, tickets: [{ id: 't1', name: 'Un', files: ['x.ts'] }, { id: 't2', name: 'Deux', files: ['y.ts'] }], groups: [{ id: 'A', name: 'Alpha', tickets: ['t1'] }, { id: 'B', name: 'Bêta', tickets: ['t2'] }] } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await settle(clock, 3)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(0)
})

test('le COO se compacte quand son contexte dépasse 150 000 tokens et que rien ne l’attend ; pas quand une mission l’attend', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const usage = { tokens: 200_000 }
  on('session.usage', () => ({ value: { context: { tokens: usage.tokens, window: 1_000_000, percent: 20 } } }) as any)
  const waiting = { ...newRun('implement', T0 - 5000, 'Attend'), status: 'active' as const, owner: 'session-B', waitsUser: { since: T0 - 1000, kind: 'question' as const } }
  writeBoard(w, b => ({ ...b, runs: [waiting] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(0)
  // Plus rien n'attend : il se compacte, une fois (pas avant 30 minutes).
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => ({ ...r, waitsUser: undefined, updatedAt: T0 + 10_000 })) }))
  await settle(clock, 6)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(1)
  await settle(clock, 12)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(1)
})

test('le COO ne se compacte ni sous le seuil, ni pendant une livraison (une mission ouverte dans sa phase « Version et push »)', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const usage = { tokens: 100_000 }
  on('session.usage', () => ({ value: { context: { tokens: usage.tokens, window: 1_000_000, percent: 20 } } }) as any)
  const base = newRun('implement', T0 - 5000, 'Livre')
  const at = base.phases.findIndex(p => p.skill === 'project:version')
  expect(at).toBeGreaterThan(-1)
  const delivering = { ...base, status: 'active' as const, owner: 'session-B', cursor: at, phases: base.phases.map((p, i) => (i < at ? { ...p, status: 'done' as const } : p)) }
  const other = { ...newRun('implement', T0 - 5000, 'Autre'), status: 'active' as const, owner: 'session-C' }
  writeBoard(w, b => ({ ...b, runs: [other] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  // Sous le seuil : rien.
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(0)
  // Au-dessus, mais une mission livre : rien.
  usage.tokens = 200_000
  writeBoard(w, b => ({ ...b, runs: [other, { ...delivering, updatedAt: T0 + 10_000 }] }))
  await settle(clock, 12)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(0)
  // La livraison finie (la mission close) : il se compacte.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === delivering.id ? { ...r, status: 'done' as const, updatedAt: T0 + 20_000 } : r)) }))
  await settle(clock, 6)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(1)
})

test('le COO ne se compacte pas tant que sa dernière réponse attend la personne (finie sur une question), ni pendant qu’une vague se lance', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  on('session.usage', () => ({ value: { context: { tokens: 200_000, window: 1_000_000, percent: 20 } } }) as any)
  const run = mission()
  writeBoard(w, b => ({ ...b, runs: [run] }))
  w.coord.text = coordFile([{ id: 'cwave0009', kind: 'wave', run: run.id, at: T0, wave: 'cwaveclic9', groups: ['A'] }])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  // Une vague se lance (le groupe A pas encore parti) : rien.
  const counts = [w.runs.filter(c => c === 'compact').length]
  // La vague partie, mais la réponse du COO finit sur une question : rien.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => ({ ...r, groups: r.groups!.map(g => (g.id === 'A' ? { ...g, linked: { at: T0 + 1000 } } : g)), updatedAt: T0 + 10_000 })) }))
  await $.turn.start({ turnId: 'q', text: 'x' } as any)
  await $.turn.complete({ answer: 'Je lance la mission suivante ?', durationMs: 10, isAborted: false, turnId: 'q', reason: 'answer' })
  await settle(clock, 12)
  counts.push(w.runs.filter(c => c === 'compact').length)
  // Une réponse sans question : il se compacte.
  await $.turn.start({ turnId: 'r', text: 'y' } as any)
  await $.turn.complete({ answer: 'C’est noté.', durationMs: 10, isAborted: false, turnId: 'r', reason: 'answer' })
  await settle(clock, 6)
  counts.push(w.runs.filter(c => c === 'compact').length)
  expect(counts).toEqual([0, 0, 1])
})
