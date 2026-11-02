import { expect, mock, test } from 'claude-code/testing'

import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'

import { groupEffortLevel, managerWorkEffort } from '../hooks/effort.ts'
import { newRun } from '../hooks/model.ts'
import type { Run, Ticket } from '../types'

// L'effort d'un manager qui fait lui-même le travail d'un worker : la règle de ce worker, par la même
// fonction ; rien hors de ce travail.

const NOW = 300_000_000
const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({ id, name: `T${id}`, status: 'todo', sensitive: false, files: ['plugins/flow-board/hooks/model.ts'], ...over })
const lot = (entry: string, tickets: Ticket[], groups: Run['groups'] = []): Run => ({ ...newRun(entry, NOW, 'Lot'), status: 'active', tickets, groups }) as Run

test('la règle d’un worker de groupe : medium par défaut, high pour un ticket sensible, des choix de conception ou plusieurs modules', () => {
  expect(groupEffortLevel({ isSensitive: false, hasDesignChoices: false, isMultiModule: false })).toBe('medium')
  expect(groupEffortLevel({ isSensitive: true, hasDesignChoices: false, isMultiModule: false })).toBe('high')
  expect(groupEffortLevel({ isSensitive: false, hasDesignChoices: true, isMultiModule: false })).toBe('high')
  expect(groupEffortLevel({ isSensitive: false, hasDesignChoices: false, isMultiModule: true })).toBe('high')
})

test('un lot sans groupes prend la règle d’un worker de groupe ; un diagnostic, celle d’un worker de diagnostic', () => {
  expect(managerWorkEffort(lot('implement', [ticket('1'), ticket('2')]))).toEqual({ level: 'medium', rule: 'group' })
  expect(managerWorkEffort(lot('implement', [ticket('1'), ticket('2', { sensitive: true })]))).toEqual({ level: 'high', rule: 'group' })
  // Un ticket muet sur sa sensibilité compte comme sensible.
  expect(managerWorkEffort(lot('implement', [ticket('1', { sensitive: undefined })]))).toEqual({ level: 'high', rule: 'group' })
  expect(managerWorkEffort(lot('implement', [ticket('1'), ticket('2', { files: ['plugins/stats-board/hooks/register.tsx'] })]))).toEqual({ level: 'high', rule: 'group' })
  // Un ticket fait ne compte plus.
  expect(managerWorkEffort(lot('implement', [ticket('1'), ticket('2', { status: 'done', sensitive: true })]))).toEqual({ level: 'medium', rule: 'group' })
  expect(managerWorkEffort(lot('tdd', []))).toEqual({ level: 'medium', rule: 'group' })
  expect(managerWorkEffort(lot('diagnosing-bugs', []))).toEqual({ level: 'high', rule: 'diagnosis' })
})

test('hors du travail d’un worker, rien : une mission à groupes, une phase de cadrage, une mission en pause', () => {
  expect(managerWorkEffort(lot('implement', [ticket('1')], [{ id: 'A', name: 'A', tickets: ['1'] }] as Run['groups']))).toBeNull()
  expect(managerWorkEffort(lot('grill-with-docs', []))).toBeNull()
  expect(managerWorkEffort({ ...lot('implement', [ticket('1')]), status: 'paused' })).toBeNull()
})

// ─── Le mod ───────────────────────────────────────────────────────────────

const TOOL = 'mcp__flow-board__flow'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

/** Le moteur sous le plugin, et l'effort de chaque requête telle qu'elle part (fil principal ou spécialiste). */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const sent: { agentId?: string; effort?: string }[] = []
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-M' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  const answer = stoppedStep(stepUsage('claude-opus-5-5'))
  on('turn.step', async function* ($: unknown, e: any) {
    sent.push({ agentId: e.agentId, effort: e.effort })
    return yield* answer($, e)
  })
  return { mem, sent }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/** Un lot sans groupes : la mission démarre à /implement, avec ses tickets. */
const openLot = async ($: any, tickets: Ticket[]) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets } as any)
}

test('un manager qui fait lui-même un lot : chaque requête du fil principal part à l’effort de la règle des workers, et le bandeau le dit', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openLot($, [ticket('1'), ticket('2')])
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  // Un spécialiste garde l'effort que lui donne son lanceur.
  await playStep($, { model: 'claude-opus-5-5', effort: 'high', agentId: 'a1' })
  expect(w.sent).toEqual([{ agentId: undefined, effort: 'medium' }, { agentId: 'a1', effort: 'high' }])
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'flow-board', surface, ...BAND })
    const texts = (await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '').replace(/\u00a0/g, ' '))
    expect(texts).toContain('effort du lot : medium, règle des workers')
    await band.unmount()
  }
})

test('un lot qui a un ticket sensible part en high ; jamais en xhigh, même quand la discussion y est, en auto comme en manuel', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openLot($, [ticket('1', { sensitive: true })])
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'max' })
  expect(w.sent.map(s => s.effort)).toEqual(['high', 'high'])
})

test('hors du travail d’un worker : sans mission, l’effort part tel quel ; un manager tourne en high au moins, un effort plus haut reste', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(w.sent.map(s => s.effort)).toEqual(['medium', 'xhigh', 'high'])
})

test('après le lot, l’effort revient à high : la phase suivante d’une mission partie en medium', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openLot($, [ticket('1')])
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  await $.tool.call({ tool: TOOL, set: [{ id: '1', status: 'done' }], step: 'review' } as any)
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(w.sent.map(s => s.effort)).toEqual(['medium', 'high'])
})

test('un lot dont tous les tickets sont faits n’est plus le travail d’un worker ; un détour de diagnostic compte d’abord', () => {
  expect(managerWorkEffort(lot('implement', [ticket('1', { status: 'done' })]))).toBeNull()
  const detoured = lot('implement', [ticket('1')])
  const phase = detoured.phases[detoured.cursor]!
  phase.detours = [{ skill: 'diagnosing-bugs', status: 'active', steps: [] } as any]
  expect(managerWorkEffort(detoured)).toEqual({ level: 'high', rule: 'diagnosis' })
})

test('un diagnostic : high au moins, sans jamais baisser un effort plus haut (la deuxième tentative en xhigh d’un worker de diagnostic)', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  expect(w.sent.map(s => s.effort)).toEqual(['high', 'xhigh'])
})
