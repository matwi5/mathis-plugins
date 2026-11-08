// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { newRun } from '../hooks/model.ts'
import { openQuestions, questionPrint } from '../hooks/model.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// Les décisions opposées entre missions. Invariant : « Deux décisions opposées de deux missions ne passent
// jamais sans question à l'utilisateur ; une décision n'est marquée "remplacée" que sur sa réponse. »

const T0 = 600_000_000

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

/** Deux missions d'autres discussions : A née d'une carte (son DECISIONS.md), B avec un choix déclaré. */
const missions = (now: number): { a: Run; b: Run } => {
  const a = { ...newRun('implement', now - 90_000, 'Mission A'), status: 'active', owner: 'session-A2', launch: { id: 'lmisa12345', card: 'kmisa1234', at: now - 90_000, folder: 'sujet-a', start: 'grill-with-docs', mode: 'manual' } } as Run
  const b = { ...newRun('implement', now - 80_000, 'Mission B'), status: 'active', owner: 'session-B', decided: [{ at: now - 10_000, what: 'La base est SQLite' }] } as Run
  return { a, b }
}

const turn = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))

test('le relevé du COO liste les décisions nouvelles de chaque mission, puis plus après « decisionsSeen »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { a, b } = missions(T0)
  writeBoard(w, x => ({ ...x, runs: [a, b] }))
  w.files['travail/sujet-a/DECISIONS.md'] = '# Décisions\n\n## Série 1 — La base est Postgres\n'
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const first = await turn($)
  expect(first).toMatch(/New decisions of the missions since your last review \(2\)/)
  expect(first).toContain('La base est Postgres')
  expect(first).toContain('travail/sujet-a/DECISIONS.md:3 (série 1)')
  expect(first).toContain('La base est SQLite')
  expect(String(((await $.tool.call({ tool: TOOL, coordinate: { decisionsSeen: true } } as any)) as any).result)).toMatch(/2 decision\(s\) marked as seen/)
  await settle(clock, 6)
  expect(await turn($)).toMatch(/since your last review \(0\)/)
  // Une série ajoutée ensuite : elle seule revient.
  w.files['travail/sujet-a/DECISIONS.md'] += '\n## Série 2 — Pas de cache\n'
  await settle(clock, 6)
  const later = await turn($)
  expect(later).toMatch(/since your last review \(1\)/)
  expect(later).toContain('Pas de cache')
})

test('une opposition s’écrit pour la mission qui a décidé en second ; un sujet compatible fait une ligne chez le COO', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { a, b } = missions(T0)
  writeBoard(w, x => ({ ...x, runs: [a, b] }))
  await start($)
  await openCoo($, clock)
  const call = async (coordinate: unknown) => String(((await $.tool.call({ tool: TOOL, coordinate } as any)) as any).result)
  const contradiction = { first: { mission: a.id, ref: 'travail/sujet-a/DECISIONS.md:3 (série 1)', text: 'La base est Postgres' }, second: { mission: b.id, ref: 'choix déclaré', text: 'La base est SQLite' }, subject: 'la base de données' }
  expect(await call({ contradiction: [contradiction] })).toMatch(/Opposition recorded: mission « Mission B »/)
  expect(await call({ contradiction: [contradiction] })).toMatch(/Already recorded/)
  expect(await call({ contradiction: [{ ...contradiction, second: { ...contradiction.second, text: 'deux\nlignes' } }] })).toMatch(/refused/)
  expect(await call({ compatible: [{ missions: [a.id, b.id], subject: 'le format des dates' }] })).toMatch(/compatible/)
  expect(entries(w)).toEqual([
    expect.objectContaining({ kind: 'contradiction', run: b.id, other: a.id, mine: { ref: 'choix déclaré', text: 'La base est SQLite' }, theirs: { ref: 'travail/sujet-a/DECISIONS.md:3 (série 1)', text: 'La base est Postgres' } }),
    expect.objectContaining({ kind: 'compatible', run: a.id, other: b.id, subject: 'le format des dates' }),
  ])
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const shown = await texts(pane)
  expect(shown).toMatch(/Décisions opposées sur la base de données : « Mission B » et « Mission A »/)
  expect(shown).toMatch(/« Mission A » et « Mission B » décident tous deux sur le format des dates, compatibles/)
  await pane.unmount()
  // L'autre mission archivée avant la réponse : la question reste posée, et le COO le dit.
  writeBoard(w, x => ({ ...x, runs: x.runs.map(r => (r.id === a.id ? { ...r, archivedAt: T0, updatedAt: T0 + 1 } : r)) }))
  await settle(clock, 6)
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(again)).toMatch(/« Mission A » archivée depuis : la question reste posée/)
  await again.unmount()
})

test('le mod de la mission qui a décidé en second pose la question bloquante sur sa phase en cours, une seule fois', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Mission B' } as any)
  await settle(clock, 2)
  const runId = stored(w).activeId!
  const other = { ...newRun('implement', T0 - 90_000, 'Mission A'), status: 'paused' } as Run
  writeBoard(w, x => ({ ...x, runs: [...x.runs, other] }))
  const entry = { id: 'cabc1234', kind: 'contradiction', run: runId, at: T0, other: other.id, mine: { ref: 'choix déclaré', text: 'La base est SQLite' }, theirs: { ref: 'travail/a/DECISIONS.md:3 (série 1)', text: 'La base est Postgres' }, subject: 'la base de données' }
  w.coord.text = coordFile([entry])
  await settle(clock, 6)
  const run = stored(w).runs.find(r => r.id === runId)!
  const questions = openQuestions(run).filter(q => q.id === 'opposition:cabc1234')
  expect(questions).toHaveLength(1)
  expect(questions[0]!.blocks).toEqual({ kind: 'phase', id: 'implement' })
  expect(questions[0]!.text).toContain('ici « La base est SQLite » (choix déclaré)')
  expect(questions[0]!.text).toContain('là-bas « La base est Postgres » (travail/a/DECISIONS.md:3 (série 1))')
  expect(questions[0]!.text).toContain('« Mission A »')
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
  // Relue de nouveau : pas de seconde question.
  await settle(clock, 10)
  expect(openQuestions(stored(w).runs.find(r => r.id === runId)!).filter(q => q.id.startsWith('opposition:'))).toHaveLength(1)
})

test('une opposition dont la mission qui portait la question est archivée avant la réponse passe à l’autre mission', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { a, b } = missions(T0)
  writeBoard(w, x => ({ ...x, runs: [a, { ...b, archivedAt: T0 - 1_000 }] }))
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'contradiction', run: b.id, at: T0 - 5_000, other: a.id, mine: { ref: 'choix déclaré', text: 'SQLite' }, theirs: { ref: 'série 1', text: 'Postgres' }, subject: 'la base' }])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  expect(entries(w)).toEqual([
    expect.objectContaining({ id: 'cabc1234' }),
    expect.objectContaining({ kind: 'contradiction', run: a.id, other: b.id, mine: { ref: 'série 1', text: 'Postgres' }, theirs: { ref: 'choix déclaré', text: 'SQLite' } }),
  ])
  await settle(clock, 10)
  expect(entries(w)).toHaveLength(2)
})

test('le relevé donne l’empreinte de la question d’une opposition, pour la réponse écrite, et les décisions plus anciennes à comparer', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { a, b } = missions(T0)
  const asked = { ...b, waiting: [{ id: 'opposition:cabc1234', blocks: { kind: 'phase', id: 'implement' }, text: 'Décision opposée…', at: T0 - 2_000 }] } as Run
  writeBoard(w, x => ({ ...x, runs: [a, asked] }))
  w.files['travail/sujet-a/DECISIONS.md'] = '# Décisions\n\n## Série 1 — La base est Postgres\n'
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'contradiction', run: b.id, at: T0 - 5_000, other: a.id, mine: { ref: 'choix déclaré', text: 'SQLite' }, theirs: { ref: 'série 1', text: 'Postgres' }, subject: 'la base' }])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const text = await turn($)
  expect(text).toMatch(/text print q[a-z0-9]+, answered by the user here/)
  expect(text).toMatch(/Earlier decisions of the missions not archived/)
  expect(text).toContain('its DECISIONS.md is « travail/sujet-a/DECISIONS.md »')
})

// ─── Ce que la passe « bogues » du ticket a trouvé ───────────────────────

test('la question d’une opposition : son Claude ne la retire pas, le mod la retire une fois la réponse relayée entrée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Mission B' } as any)
  await settle(clock, 2)
  const runId = stored(w).activeId!
  const other = { ...newRun('implement', T0 - 90_000, 'Mission A'), status: 'paused' } as Run
  writeBoard(w, x => ({ ...x, runs: [...x.runs, other] }))
  const contradiction = { id: 'cabc1234', kind: 'contradiction', run: runId, at: T0, other: other.id, mine: { ref: 'choix déclaré', text: 'SQLite' }, theirs: { ref: 'série 1', text: 'Postgres' }, subject: 'la base' }
  w.coord.text = coordFile([contradiction])
  await settle(clock, 6)
  const id = 'opposition:cabc1234'
  // Retirée par son Claude sans réponse : refusé, la question reste.
  const said = JSON.stringify(await $.tool.call({ tool: TOOL, waiting: [{ id, answered: true }] } as any))
  expect(said).toMatch(/do not withdraw it/)
  const q = openQuestions(stored(w).runs.find(r => r.id === runId)!).find(x => x.id === id)!
  expect(q).toBeDefined()
  // La réponse écrite chez le COO : relayée, puis la question retirée par le mod, sa trace gardée.
  w.coord.text = coordFile([contradiction, { id: 'cdef5678', kind: 'answer', run: runId, at: T0 + 1, question: id, print: questionPrint(q), file: 'travail/b/DECISIONS.md', series: 4 }])
  await settle(clock, 8)
  const sent = w.prompts.filter(p => p.includes(id))
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/le tableau de bord retire la question lui-même/)
  const after = stored(w).runs.find(r => r.id === runId)!
  expect(openQuestions(after).some(x => x.id === id)).toBe(false)
  expect((after.answered ?? []).some((t: any) => t?.id === id)).toBe(true)
})

test('« decisionsSeen » ne marque rien quand une opposition du même appel n’a pas été écrite', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { a, b } = missions(T0)
  writeBoard(w, x => ({ ...x, runs: [a, b] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  expect(await turn($)).toMatch(/since your last review \(1\)/)
  const gone = { first: { mission: 'inconnue', ref: 'série 1', text: 'Postgres' }, second: { mission: b.id, ref: 'choix déclaré', text: 'La base est SQLite' }, subject: 'la base' }
  const r = String(((await $.tool.call({ tool: TOOL, coordinate: { contradiction: [gone], decisionsSeen: true } } as any)) as any).result)
  expect(r).toMatch(/Not marked as reviewed/)
  await settle(clock, 6)
  expect(await turn($)).toMatch(/since your last review \(1\)/)
})

test('une opposition entre une mission close et une en cours pose sa question à celle en cours ; un sujet compatible d’une mission archivée ne s’affiche plus', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { a, b } = missions(T0)
  writeBoard(w, x => ({ ...x, runs: [a, { ...b, status: 'done' }] }))
  await start($)
  await openCoo($, clock)
  const call = async (coordinate: unknown) => String(((await $.tool.call({ tool: TOOL, coordinate } as any)) as any).result)
  const c = { first: { mission: a.id, ref: 'série 1', text: 'Postgres' }, second: { mission: b.id, ref: 'choix déclaré', text: 'La base est SQLite' }, subject: 'la base' }
  expect(await call({ contradiction: [c] })).toMatch(/Opposition recorded: mission « Mission A » \(the one that decided second is closed/)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'contradiction', run: a.id, other: b.id, mine: { ref: 'série 1', text: 'Postgres' }, theirs: { ref: 'choix déclaré', text: 'La base est SQLite' } })])
  expect(await call({ compatible: [{ missions: [a.id, 'inconnue'], subject: 'les dates' }] })).toMatch(/Not recorded/)
  expect(await call({ compatible: [{ missions: [a.id, b.id], subject: 'les dates' }] })).toMatch(/compatible/)
  writeBoard(w, x => ({ ...x, runs: x.runs.map(r => (r.id === b.id ? { ...r, archivedAt: T0, updatedAt: T0 + 1 } : r)) }))
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).not.toMatch(/les dates/)
  await pane.unmount()
})

// ─── Ce que la passe d'après les correctifs a trouvé ─────────────────────

test('« decisionsSeen » ne marque rien après une opposition hors liste, ni dans un appel suivant après un échec ; une opposition entre deux missions closes n’a rien à demander', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { a, b } = missions(T0)
  writeBoard(w, x => ({ ...x, runs: [a, b] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  expect(await turn($)).toMatch(/since your last review \(1\)/)
  const call = async (coordinate: unknown) => String(((await $.tool.call({ tool: TOOL, coordinate } as any)) as any).result)
  const c = { first: { mission: a.id, ref: 'série 1', text: 'Postgres' }, second: { mission: b.id, ref: 'choix déclaré', text: 'La base est SQLite' }, subject: 'la base' }
  // Un objet au lieu d'une liste : rien de lu, rien de marqué.
  const one = await call({ contradiction: c, decisionsSeen: true })
  expect(one).toMatch(/Not read: "contradiction" must be a list/)
  expect(one).toMatch(/Not marked as reviewed/)
  // Un échec, puis « decisionsSeen » seul dans l'appel suivant : toujours rien de marqué.
  expect(await call({ contradiction: [{ ...c, first: { ...c.first, mission: 'inconnue' } }] })).toMatch(/Not recorded/)
  expect(await call({ decisionsSeen: true })).toMatch(/Not marked as reviewed/)
  await settle(clock, 6)
  expect(await turn($)).toMatch(/since your last review \(1\)/)
  // Les deux missions closes : rien à demander, le relevé se marque vu.
  writeBoard(w, x => ({ ...x, runs: x.runs.map(r => ({ ...r, status: 'done', updatedAt: T0 + 5 })) }))
  await settle(clock, 6)
  await turn($)
  const closed = await call({ contradiction: [c], decisionsSeen: true })
  expect(closed).toMatch(/Nothing to ask: both missions are closed/)
  expect(closed).toMatch(/marked as seen/)
  expect(entries(w)).toEqual([])
})

test('une décision d’une mission archivée vaut toujours : l’opposition pose sa question à l’autre, encore en cours', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { a, b } = missions(T0)
  writeBoard(w, x => ({ ...x, runs: [{ ...a, status: 'done', archivedAt: T0 - 1 }, b] }))
  await start($)
  await openCoo($, clock)
  const c = { first: { mission: b.id, ref: 'choix déclaré', text: 'La base est SQLite' }, second: { mission: a.id, ref: 'série 1', text: 'Postgres' }, subject: 'la base' }
  expect(String(((await $.tool.call({ tool: TOOL, coordinate: { contradiction: [c] } } as any)) as any).result)).toMatch(/Opposition recorded: mission « Mission B »/)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'contradiction', run: b.id, other: a.id })])
})

test('le Claude de la mission ne pose ni ne change la question d’une opposition', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Mission B' } as any)
  await settle(clock, 2)
  const runId = stored(w).activeId!
  const other = { ...newRun('implement', T0 - 90_000, 'Mission A'), status: 'paused' } as Run
  writeBoard(w, x => ({ ...x, runs: [...x.runs, other] }))
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'contradiction', run: runId, at: T0, other: other.id, mine: { ref: 'choix déclaré', text: 'SQLite' }, theirs: { ref: 'série 1', text: 'Postgres' }, subject: 'la base' }])
  await settle(clock, 6)
  const before = openQuestions(stored(w).runs.find(r => r.id === runId)!).find(q => q.id === 'opposition:cabc1234')!
  const said = JSON.stringify(await $.tool.call({ tool: TOOL, waiting: [{ id: 'opposition:cabc1234', phase: 'implement', text: 'autre chose' }, { id: 'opposition:cneuf123', phase: 'implement', text: 'posée par Claude' }] } as any))
  expect(said).toMatch(/never posed nor changed here/)
  const after = openQuestions(stored(w).runs.find(r => r.id === runId)!)
  expect(after.find(q => q.id === 'opposition:cabc1234')?.text).toBe(before.text)
  expect(after.some(q => q.id === 'opposition:cneuf123')).toBe(false)
})

// ─── Ce que la revue du groupe a trouvé ──────────────────────────────────

test('une opposition ratée n’est pas oubliée par un appel suivant qui écrit autre chose', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const { a, b } = missions(T0)
  writeBoard(w, x => ({ ...x, runs: [a, b] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  await turn($)
  const call = async (coordinate: unknown) => String(((await $.tool.call({ tool: TOOL, coordinate } as any)) as any).result)
  const c = { first: { mission: 'inconnue', ref: 'série 1', text: 'Postgres' }, second: { mission: b.id, ref: 'choix déclaré', text: 'La base est SQLite' }, subject: 'la base' }
  expect(await call({ contradiction: [c] })).toMatch(/Not recorded/)
  // Un sujet compatible écrit ensuite, avec « decisionsSeen » : l'opposition ratée bloque toujours.
  expect(await call({ compatible: [{ missions: [a.id, b.id], subject: 'les dates' }], decisionsSeen: true })).toMatch(/Not marked as reviewed/)
  // Corrigée (un autre contenu) et écrite : l'échec d'origine bloque jusqu'au relevé suivant, qui redonne ces décisions.
  expect(await call({ contradiction: [{ ...c, first: { ...c.first, mission: a.id } }] })).toMatch(/Opposition recorded/)
  expect(await call({ decisionsSeen: true })).toMatch(/Not marked as reviewed/)
})
