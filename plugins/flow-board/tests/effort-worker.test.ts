import { expect, mock, test } from 'claude-code/testing'

import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'
import { TOOL, start, world, writeBoard } from './monde-coordination.ts'

import { leadEffortPill, workerTicketEffort } from '../hooks/effort.ts'
import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run, Ticket } from '../types'

// L'effort d'un worker de groupe, requête par requête : high au moins pendant un ticket sensible en cours
// (le ticket que son relais dit « doing », sa sensibilité lue dans la mission), l'effort de la session sinon.

const T0 = 900_000_000

/** Le moteur des tests de coordination, et l'effort de chaque requête telle qu'elle part. */
const engine = (on: any) => {
  const w = world(on)
  const sent: { agentId?: string; effort?: string }[] = []
  const answer = stoppedStep(stepUsage('claude-opus-5-5'))
  on('turn.step', async function* ($: unknown, e: any) {
    sent.push({ agentId: e.agentId, effort: e.effort })
    return yield* answer($, e)
  })
  return { w, sent }
}

/** La mission du groupe A dans le fichier des missions : t1 sensible, t2 non, t3 muet. */
const missionWith = (w: ReturnType<typeof world>, tickets: Ticket[]): Run => {
  const run = newRun('implement', T0 - 6000, 'Boutique')
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = { tickets, groups: [{ id: 'A', name: 'A', tickets: tickets.map(t => t.id) }, { id: 'B', name: 'B', tickets: [] }] }
  const mission = { ...(applyReport(base, report, T0 - 5000).board.runs[0] as Run), status: 'active' as const, owner: 'session-B' }
  writeBoard(w, b => ({ ...b, runs: [mission] }))
  return mission
}

const TICKETS: Ticket[] = [
  { id: 't1', name: 'Un', status: 'todo', sensitive: true, files: ['a.ts'] },
  { id: 't2', name: 'Deux', status: 'todo', sensitive: false, files: ['b.ts'] },
  { id: 't3', name: 'Trois', status: 'todo', files: ['c.ts'] },
]

const say = ($: any, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input } as any)

test('un worker sur un ticket « doing » sensible part en high, puis à l’effort de sa session sur un ticket non sensible', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  await say($, { set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(sent.map(s => s.effort)).toEqual(['high', 'medium'])
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

/** Les textes du bandeau, au terminal et sur desktop (espaces insécables rendues). */
const bandTexts = async ($: any): Promise<string[][]> => {
  const out: string[][] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'flow-board', surface, ...BAND })
    out.push((await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '').replace(/ /g, ' ')))
    await band.unmount()
  }
  return out
}

test('le bandeau du worker dit l’effort imposé et sa raison quand la règle change l’effort, rien sinon', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : high, ticket sensible t1 en cours')
  // Un ticket non sensible : rien d'imposé, rien au bandeau.
  await say($, { set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts.some(t => t.startsWith('effort'))).toBe(false)
})

test('un ticket muet, ou une mission qui ne se lit pas, donne high ; un relais illisible aussi', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  // t3 ne dit pas s'il est sensible : il compte comme sensible.
  await say($, { set: [{ id: 't3', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : high, ticket t3 en cours, sensibilité inconnue')
  // Un ticket absent de la mission : sa sensibilité ne se lit pas.
  await say($, { set: [{ id: 't3', status: 'done' }, { id: 't9', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'low' })
  // Le relais de la session illisible : on ne sait pas quel ticket est en cours.
  w.mem[`relay:${mission.id}:session-A`] = 'pas une entrée'
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : high, ticket en cours illisible')
  expect(sent.map(s => s.effort)).toEqual(['high', 'high', 'high'])
})

test('une mission que ni le board d’ici ni celui du dépôt principal ne donne : high pendant un ticket en cours', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { sent } = engine(on)
  await start($)
  await say($, { delegate: 'run-w', group: 'A', main: '[abc123]' })
  await say($, { set: [{ id: 't2', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(sent.map(s => s.effort)).toEqual(['high'])
})

test('aucun ticket en cours : l’effort de la session reste ; xhigh reste xhigh ; un spécialiste n’est jamais touché', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  for (const effort of ['low', 'medium']) await playStep($, { model: 'claude-opus-5-5', effort })
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium', agentId: 'a1' })
  for (const texts of await bandTexts($)) expect(texts.some(t => t.startsWith('effort'))).toBe(false)
  expect(sent).toEqual([{ effort: 'low' }, { effort: 'medium' }, { effort: 'xhigh' }, { agentId: 'a1', effort: 'medium' }].map(s => ({ agentId: undefined, ...s })))
})

test('une discussion qui faisait un lot puis devient un worker : sans ticket en cours, son effort est celui de son lancement', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { sent } = engine(on)
  await start($)
  // D'abord un lot ouvert ici : sa règle impose son niveau à une requête.
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await say($, { tickets: [{ id: '1', name: 'Un', status: 'todo', sensitive: true, files: ['a.ts'] }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'low' })
  await say($, { delegate: 'run-w', group: 'A', main: '[abc123]' })
  for (const effort of ['low', 'medium', 'xhigh']) await playStep($, { model: 'claude-opus-5-5', effort })
  for (const texts of await bandTexts($)) expect(texts.some(t => t.startsWith('effort'))).toBe(false)
  expect(sent.map(s => s.effort)).toEqual(['medium', 'low', 'medium', 'xhigh'])
})

test('un id de ticket hors forme (celle d’isSafeId, 24 signes au plus) n’est pas écrit au bandeau ; le high reste', () => {
  const mission = { tickets: [] } as unknown as Run
  for (const id of ['a'.repeat(25), 'a b', '#12', 'x\u2028y']) {
    const rule = workerTicketEffort([id], mission)
    expect(rule).toEqual({ level: 'high', rule: 'sensitive', how: 'floor', isUnknown: true })
    expect(leadEffortPill(rule!, 'medium')).toBe('effort : high, ticket en cours illisible')
  }
  expect(workerTicketEffort(['a'.repeat(24)], mission)?.ticket).toBe('a'.repeat(24))
})
