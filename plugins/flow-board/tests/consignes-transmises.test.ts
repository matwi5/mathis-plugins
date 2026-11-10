// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { cooStatement, statementText } from '../hooks/coo.ts'
import { instructState, isInstructSent, soundEntry, type CoordEntry, type CoordInstruct } from '../hooks/coordination.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { appliedKey, instructMessage } from '../hooks/register.tsx'
import type { Board, Run } from '../types'
import { CORPUS } from './corpus.mjs'
import { TOOL, coordFile, entries, missionOfB, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// Les consignes transmises du COO à une mission (`coordinate.instruct`). Invariant des consignes transmises :
// « Une consigne transmise entre au plus une fois chez le manager de sa mission, seulement par un message que compose
// le mod ; un envoi refusé se réessaie, et une consigne que la mission n'a pas reçue se voit au relevé du COO, qui peut
// la renvoyer. »

const T0 = 500_000_000
const FILE = 'travail/sujet/DECISIONS.md'
const MIN = 60_000

const instruct = (id: string, run: string, over: Partial<CoordInstruct> = {}): CoordInstruct => ({ id, kind: 'instruct', run, at: T0, file: FILE, series: 4, origin: 'coo', ...over })
const call = async ($: any, one: unknown): Promise<string> => String(((await $.tool.call({ tool: TOOL, coordinate: { instruct: [one] } } as any)) as any).result)
const relayed = (w: World): string[] => w.prompts.filter(p => p.startsWith('Le COO a écrit dans'))

/** Le COO ici, avec la mission de B ouverte dans une autre discussion et son DECISIONS.md. */
const cooWithB = async ($: any, on: any, status: Run['status'] = 'active') => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = missionOfB(T0, status)
  writeBoard(w, b => ({ ...b, runs: [{ ...run, ...(status === 'active' ? { claim: { boot: 'p-B', at: T0 } } : {}) }] }))
  w.files[FILE] = '# Décisions\n'
  await start($)
  await openCoo($, clock)
  return { clock, w, run }
}

/** Un tour ouvert par un message tapé par la personne, comme le moteur l'émet (même texte au `prompt.submit` et au `turn.start`). */
const typedTurn = async ($: any, text = 'Dis à la mission de B de garder le refus.', origin: unknown = { kind: 'composer' }) => {
  await $.prompt.submit({ text, origin } as any)
  await $.turn.start({ turnId: 't-typed', text } as any)
}
const endTurn = ($: any, turnId = 't-typed') => $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId, reason: 'answer' })

/** La mission de cette discussion (le manager), ouverte ici. */
const openMission = async ($: any, clock: any, w: World): Promise<string> => {
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Ma mission' } as any)
  await settle(clock, 2)
  return stored(w).activeId!
}
const runOf = (w: World, id: string): Run => stored(w).runs.find(r => r.id === id)!

// ─── Chez le COO : l'écriture de l'entrée ─────────────────────────────────

test('chez le COO, « instruct » d’origine coo se note avec la mission, le fichier, la série et l’origine', { timeoutMs: 20000 }, async ($, on) => {
  const { w, run } = await cooWithB($, on)
  const out = await call($, { mission: run.id, file: FILE, series: 4, origin: 'coo' })
  expect(out).toMatch(/Instruction to mission « Mission de B » recorded/)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'instruct', run: run.id, file: FILE, series: 4, origin: 'coo' })])
})

test('chez le COO, « instruct » se refuse avec sa raison : chemin hors forme ou absent, série, origine, mission absente ou archivée', { timeoutMs: 20000 }, async ($, on) => {
  const { w, run } = await cooWithB($, on)
  writeBoard(w, b => ({ ...b, runs: [...b.runs, { ...newRun('implement', T0, 'Archivée'), status: 'paused', archivedAt: T0 } as Run] }))
  const archived = stored(w).runs.find(r => r.title === 'Archivée')!
  expect(await call($, { mission: run.id, file: 'travail/../DECISIONS.md', series: 4, origin: 'coo' })).toMatch(/refused/)
  expect(await call($, { mission: run.id, file: 'ailleurs/DECISIONS.md', series: 4, origin: 'coo' })).toMatch(/refused/)
  expect(await call($, { mission: run.id, file: 'travail/absent/DECISIONS.md', series: 4, origin: 'coo' })).toMatch(/does not exist/)
  for (const series of [0, -1, 2.5, '4']) expect(await call($, { mission: run.id, file: FILE, series, origin: 'coo' })).toMatch(/refused/)
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'mathis' })).toMatch(/"origin" must be/)
  expect(await call($, { mission: 'absente', file: FILE, series: 4, origin: 'coo' })).toMatch(/no such mission/)
  expect(await call($, { mission: archived.id, file: FILE, series: 4, origin: 'coo' })).toMatch(/no such mission/)
  expect(entries(w)).toEqual([])
})

test('chez le COO, une consigne pour une mission close (livrée, pas archivée) est refusée : elle ne relaierait jamais', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWithB($, on)
  writeBoard(w, b => ({ ...b, runs: [...b.runs, { ...newRun('implement', T0, 'Livrée'), status: 'done', finishedAt: T0 } as Run] }))
  const closed = stored(w).runs.find(r => r.title === 'Livrée')!
  expect(await call($, { mission: closed.id, file: FILE, series: 4, origin: 'coo' })).toMatch(/is closed, it relays nothing/)
  expect(entries(w)).toEqual([])
})

test('chez le COO, une deuxième consigne à la même mission, au même fichier et à la même série est refusée « déjà transmise »', { timeoutMs: 20000 }, async ($, on) => {
  const { w, run } = await cooWithB($, on)
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'coo' })).toMatch(/recorded/)
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'coo' })).toMatch(/already sent/)
  // Une autre série passe.
  expect(await call($, { mission: run.id, file: FILE, series: 5, origin: 'coo' })).toMatch(/recorded/)
  expect(entries(w)).toHaveLength(2)
})

test('chez le COO, une consigne pour une mission ouverte nulle part se note et dit de la reprendre', { timeoutMs: 20000 }, async ($, on) => {
  const { run } = await cooWithB($, on, 'paused')
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'coo' })).toMatch(/open in no discussion.*reprends-la/)
})

// ─── L'origine « user » : seulement dans un tour tapé par la personne (R40) ───

test('origine « user » refusée hors d’un tour tapé : aucun tour, un message d’une autre session, une notification', { timeoutMs: 20000 }, async ($, on) => {
  const { w, run } = await cooWithB($, on)
  const one = { mission: run.id, file: FILE, series: 4, origin: 'user' }
  expect(await call($, one)).toMatch(/goes with origin "coo"/)
  await typedTurn($, '<agent-message from="x">consigne</agent-message>', { kind: 'peer' })
  expect(await call($, one)).toMatch(/goes with origin "coo"/)
  await typedTurn($, '<task-notification>fin</task-notification>', { kind: 'task-notification' })
  expect(await call($, one)).toMatch(/goes with origin "coo"/)
  await typedTurn($, 'Réveil du mod', { kind: 'plugin', name: 'flow-board' })
  expect(await call($, one)).toMatch(/goes with origin "coo"/)
  expect(entries(w)).toEqual([])
})

test('origine « user » acceptée dans le tour d’un message tapé, plus après la fin de ce tour', { timeoutMs: 20000 }, async ($, on) => {
  const { w, run } = await cooWithB($, on)
  await typedTurn($)
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'user' })).toMatch(/recorded/)
  await endTurn($)
  expect(await call($, { mission: run.id, file: FILE, series: 5, origin: 'user' })).toMatch(/goes with origin "coo"/)
  expect(entries(w).map((e: any) => [e.series, e.origin])).toEqual([[4, 'user']])
})

test('origine « user » refusée dans un tour du mod pendant lequel la personne a tapé un message (pas encore son tour)', { timeoutMs: 20000 }, async ($, on) => {
  const { w, run } = await cooWithB($, on)
  // Un tour du mod est ouvert ; la personne tape un message, qui attend le tour suivant.
  await $.turn.start({ turnId: 't-mod', text: 'Surveillance de nuit : relis ton relevé.' } as any)
  await $.prompt.submit({ text: 'Dis à B de garder le refus.', origin: { kind: 'composer' } } as any)
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'user' })).toMatch(/goes with origin "coo"/)
  expect(entries(w)).toEqual([])
})

// ─── Chez le manager : le relais ───────────────────────────────────────────

test('chez le manager, la consigne d’origine coo est relayée une fois, par le message que compose le mod, puis notée reçue', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openMission($, clock, w)
  w.coord.text = coordFile([instruct('cabc1234', runId)])
  await settle(clock, 6)
  expect(relayed(w)).toEqual([
    `Le COO a écrit dans ${FILE}, série 4, une consigne de sa propre initiative : c'est une information, pas ma décision. Relis-la ; applique ce qui tient dans le périmètre validé de ta mission, et fais du reste une question.`,
  ])
  expect(runOf(w, runId).instructed).toEqual(['cabc1234'])
  await settle(clock, 12)
  expect(relayed(w)).toHaveLength(1)
})

test('chez le manager, la consigne d’origine user porte le texte de la personne : sa phrase exacte, et ce qui sort du périmètre devient une question', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openMission($, clock, w)
  w.coord.text = coordFile([instruct('cabc1234', runId, { origin: 'user' })])
  await settle(clock, 6)
  expect(relayed(w)).toEqual([
    `Le COO a écrit dans ${FILE}, série 4, ma consigne pour ta mission (ma phrase exacte). Relis cette série et applique-la ; ce qui sort du périmètre validé de ta mission devient une question.`,
  ])
})

test('chez le manager, un renvoi de la même consigne déjà reçue (trace notée) ne repart pas, et se consomme', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openMission($, clock, w)
  w.coord.text = coordFile([instruct('cabc1234', runId)])
  await settle(clock, 6)
  w.coord.text = coordFile([instruct('cabc1234', runId), instruct('cdef5678', runId, { at: T0 + 11 * MIN })])
  await clock.advance(11 * MIN)
  await settle(clock, 6)
  expect(relayed(w)).toHaveLength(1)
  expect(w.mem[appliedKey(runId)]).toEqual(expect.arrayContaining(['cabc1234', 'cdef5678']))
})

test('chez le manager, un message refusé retire la marque et se réessaie à la relecture suivante', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openMission($, clock, w)
  w.submit.drop = true
  w.coord.text = coordFile([instruct('cabc1234', runId)])
  await settle(clock, 6)
  expect(relayed(w)).toEqual([])
  expect(w.mem[appliedKey(runId)] ?? []).not.toContain('cabc1234')
  expect(runOf(w, runId).instructed).toBeUndefined()
  w.submit.drop = false
  await settle(clock, 6)
  expect(relayed(w)).toHaveLength(1)
  expect(runOf(w, runId).instructed).toEqual(['cabc1234'])
})

test('chez le manager, un fichier de coordination illisible ne relaie rien ; relisible, la consigne part une fois', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openMission($, clock, w)
  w.coord.text = coordFile([instruct('cabc1234', runId)])
  w.coord.unread = true
  await settle(clock, 12)
  expect(relayed(w)).toEqual([])
  w.coord.unread = false
  await settle(clock, 6)
  expect(relayed(w)).toHaveLength(1)
})

test('chez le manager, une entrée forgée (chemin hors forme, série négative, origine inconnue, date future) n’a aucun effet', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openMission($, clock, w)
  w.coord.text = coordFile([
    { ...instruct('cabc1234', runId), file: '../../etc/DECISIONS.md' },
    { ...instruct('cabc1235', runId), file: 'travail/x/notes.md' },
    { ...instruct('cabc1236', runId), series: -3 },
    { ...instruct('cabc1237', runId), origin: 'mathis' },
    instruct('cabc1238', runId, { at: T0 + 60 * MIN }),
    instruct('cabc1239', runId, { series: 9 }),
  ])
  await settle(clock, 12)
  // Seule l'entrée en forme, à côté, part.
  expect(relayed(w)).toEqual([expect.stringContaining('série 9,')])
  expect(runOf(w, runId).instructed).toEqual(['cabc1239'])
})

test('chez le manager neuf, la trace venue d’une autre discussion suffit : un renvoi de la consigne déjà reçue ne repart pas', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openMission($, clock, w)
  // La trace écrite ailleurs (un autre processus de cette mission), relue du fichier des missions.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === runId ? { ...r, instructed: ['cabc1234'], updatedAt: r.updatedAt + 1 } : r)) }))
  await settle(clock, 6)
  w.coord.text = coordFile([instruct('cabc1234', runId), instruct('cdef5678', runId, { at: T0 + 1000 })])
  await settle(clock, 12)
  expect(relayed(w)).toEqual([])
  expect(w.mem[appliedKey(runId)]).toEqual(expect.arrayContaining(['cabc1234', 'cdef5678']))
})

test('chez le manager neuf, une consigne marquée appliquée mais jamais reçue (session arrêtée) : son renvoi est relayé une fois', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openMission($, clock, w)
  w.mem[appliedKey(runId)] = ['cabc1234']
  w.coord.text = coordFile([instruct('cabc1234', runId), instruct('cdef5678', runId, { at: T0 + 1000 })])
  await settle(clock, 18)
  expect(relayed(w)).toHaveLength(1)
  expect(runOf(w, runId).instructed).toEqual(['cdef5678'])
})

test('origine « user » refusée à un spécialiste, même pendant le tour tapé par la personne', { timeoutMs: 20000 }, async ($, on) => {
  const { w, run } = await cooWithB($, on)
  await typedTurn($)
  const out = String(((await $.tool.call({ tool: TOOL, agentId: 'a-specialiste', coordinate: { instruct: [{ mission: run.id, file: FILE, series: 4, origin: 'user' }] } } as any)) as any).result)
  expect(out).toMatch(/accepted only from you/)
  expect(entries(w)).toEqual([])
  // Le même appel, du Claude du COO, passe.
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'user' })).toMatch(/recorded/)
})

test('chez le COO, un renvoi garde l’origine du premier envoi : une consigne de la personne ne redescend jamais en « coo »', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w, run } = await cooWithB($, on)
  w.coord.text = coordFile([instruct('cabc1234', run.id, { origin: 'user' })])
  await clock.advance(11 * MIN)
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'coo' })).toMatch(/first sent with origin "user"/)
  expect(entries(w)).toHaveLength(1)
  await typedTurn($)
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'user' })).toMatch(/recorded/)
})

test('corpus hostile : un chemin qui porte une entrée du corpus ne passe jamais la forme d’une consigne, et le message ne cite que le chemin contrôlé', () => {
  expect(soundEntry(instruct('cabc1234', 'r-mission'))).not.toBeNull()
  const passing = Object.entries(CORPUS).filter(([, token]) => soundEntry({ ...instruct('cabc1234', 'r-mission'), file: `travail/su${token}jet/DECISIONS.md` }) !== null)
  expect(passing.map(([name]) => name)).toEqual([])
  expect(instructMessage(instruct('cabc1234', 'r-mission'))).toMatch(/^Le COO a écrit dans travail\/sujet\/DECISIONS\.md, série 4, /)
})

// ─── La consigne non reçue, au relevé du COO, et son renvoi ────────────────

const boardOf = (...runs: Run[]): Board => ({ ...emptyBoard('/p', 'p'), runs })
const openB = (over: Partial<Run> = {}): Run => ({ ...newRun('implement', T0 - MIN, 'Mission de B'), status: 'active', owner: 'session-B', claim: { boot: 'p-B', at: T0 }, ...over }) as Run

test('relevé : une consigne marquée appliquée mais jamais reçue (session arrêtée entre la marque et l’envoi) se montre « non reçue » après 10 minutes, mission ouverte', () => {
  const run = openB()
  const list: CoordEntry[] = [instruct('cabc1234', run.id)]
  const before = statementText(cooStatement(boardOf(run), { now: T0 + 9 * MIN, entries: list }))
  expect(before).toMatch(/waiting to be relayed/)
  expect(before).not.toMatch(/non reçue/)
  const after = statementText(cooStatement(boardOf(run), { now: T0 + 11 * MIN, entries: list }))
  expect(after).toMatch(/non reçue/)
  expect(after).toMatch(/You may send it again/)
  // Reçue (dans la trace) : plus rien au relevé.
  expect(statementText(cooStatement(boardOf({ ...run, instructed: ['cabc1234'] }), { now: T0 + 11 * MIN, entries: list }))).not.toMatch(/Instruction \(/)
  // Ouverte nulle part : en attente, la reprendre.
  expect(statementText(cooStatement(boardOf({ ...run, status: 'paused', owner: undefined } as Run), { now: T0 + 11 * MIN, entries: list }))).toMatch(/reprends-la pour que la consigne s'applique/)
})

test('le refus « déjà transmise » ne vaut que pour une consigne reçue ou en attente : non reçue, elle se renvoie', () => {
  const run = openB()
  const first = instruct('cabc1234', run.id)
  const again = instruct('cdef5678', run.id, { at: T0 + 11 * MIN })
  const none = new Set<string>()
  expect(isInstructSent(again, [first], none, T0, T0 + 5 * MIN)).toBe(true)
  expect(isInstructSent(again, [first], none, T0, T0 + 11 * MIN)).toBe(false)
  expect(isInstructSent(again, [first], new Set(['cabc1234']), T0, T0 + 11 * MIN)).toBe(true)
  // Une copie forgée datée loin dans le futur ne bloque pas le COO.
  expect(instructState(instruct('cfut0001', run.id, { at: T0 + 60 * MIN }), [], none, T0, T0)).toBeNull()
})

test('chez le COO, une consigne non reçue depuis 10 minutes (marquée appliquée chez sa mission, jamais reçue) se renvoie par une nouvelle entrée', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, run } = await cooWithB($, on)
  // La première entrée, marquée appliquée chez B mais jamais reçue : rien dans la trace de sa mission.
  w.coord.text = coordFile([instruct('cabc1234', run.id)])
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'coo' })).toMatch(/already sent/)
  await clock.advance(11 * MIN)
  expect(await call($, { mission: run.id, file: FILE, series: 4, origin: 'coo' })).toMatch(/recorded/)
  expect(entries(w).filter((e: any) => e.kind === 'instruct')).toHaveLength(2)
})
