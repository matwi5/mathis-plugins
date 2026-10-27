import { expect, test } from 'claude-code/testing'

import { MAIN, addMark, closeOpen, closeSegment, closeToolCall, emptyRegistry, mergeRegistry, openSegment, reconcileAgents, spawnAgent, startCall } from '../hooks/registry.ts'
import { laneSvg } from '../hooks/svg.ts'
import { PAUSE_MS, buildAxis, laneParts, shortArg, summaryOf, toolFamily, xOf } from '../hooks/timeline.ts'
import type { RegistryAgent } from '../types'

const MIN = 60_000

const withAgent = () => {
  let r = startCall(emptyRegistry('s1', '/p', 0), { key: 't1', name: 'Explorer', isBackground: true }, 1_000)!
  r = spawnAgent(r, { agentId: 'a1', callKey: 't1', isBackground: true }, new Set(), 1_000)!
  return r
}

test('les segments d’une piste s’ouvrent et se ferment ; deux outils courts d’une même famille se réunissent', () => {
  let r = withAgent()
  r = openSegment(r, 'a1', { k: 'think', s: 1_000 }, 1_000)!
  r = closeSegment(r, 'a1', s => s.k === 'think', 3_000)!
  r = openSegment(r, 'a1', { k: 'tool', s: 3_000, f: 'read', t: 'Read' }, 3_000)!
  r = closeSegment(r, 'a1', s => s.k === 'tool', 3_400, { a: 'a.txt' })!
  r = openSegment(r, 'a1', { k: 'tool', s: 3_400, f: 'read', t: 'Grep' }, 3_400)!
  r = closeSegment(r, 'a1', s => s.k === 'tool', 3_900, { a: 'motif' })!
  r = openSegment(r, 'a1', { k: 'tool', s: 4_000, f: 'run', t: 'Bash' }, 4_000)!
  const lane = r.agents[0]!.segments!
  expect(lane.map(s => `${s.k}:${s.s}-${s.e ?? '…'}${s.n ? `×${s.n}` : ''}`)).toEqual(['think:1000-3000', 'tool:3000-3900×2', 'tool:4000-…'])
  // La piste de l'orchestrateur existe toujours ; une piste inconnue ne change rien.
  expect(openSegment(r, MAIN, { k: 'think', s: 5_000 }, 5_000)!.main!.segments).toHaveLength(1)
  expect(openSegment(r, 'inconnu', { k: 'think', s: 5_000 }, 5_000)).toBeNull()
  expect(addMark(r, 'a1', { k: 'fail', at: 4_500 }, 4_500)!.agents[0]!.marks).toEqual([{ k: 'fail', at: 4_500 }])
})

test('les pauses de plus de quelques minutes sans segment actif sont compressées', () => {
  const axis = buildAxis([{ s: 0, e: 10 * MIN }, { s: 3 * 60 * MIN, e: 3 * 60 * MIN + 10 * MIN }], 0, 3 * 60 * MIN + 10 * MIN)
  const pauses = axis.pieces.filter(p => p.pause !== undefined)
  expect(pauses).toHaveLength(1)
  expect(pauses[0]!.pause).toBe(170 * MIN)
  // Les deux tronçons de 10 min ont la même largeur, et la pause en prend peu.
  const [a, , b] = axis.pieces
  expect(Math.abs(a!.x1 - a!.x0 - (b!.x1 - b!.x0))).toBeLessThan(1e-9)
  expect(pauses[0]!.x1 - pauses[0]!.x0).toBeLessThan(0.1)
  expect(Math.abs(xOf(axis, 5 * MIN) - (a!.x1 - a!.x0) / 2)).toBeLessThan(1e-9)
  // Une pause courte reste à l'échelle.
  expect(buildAxis([{ s: 0, e: MIN }, { s: MIN + PAUSE_MS / 2, e: 3 * MIN + PAUSE_MS / 2 }], 0, 3 * MIN + PAUSE_MS / 2).pieces).toHaveLength(1)
})

test('le gain par rapport à une exécution en série compte l’union des périodes d’activité, pas les heures creuses', () => {
  const agent = (key: string, s: number, e?: number): RegistryAgent => ({ key, name: key, isBackground: true, status: e === undefined ? 'running' : 'done', startedAt: s, finishedAt: e, source: 'live' })
  // Deux agents en parallèle sur 10 min, puis un seul 10 min, trois heures plus tard.
  const s = summaryOf([agent('a', 0, 10 * MIN), agent('b', 0, 10 * MIN), agent('c', 180 * MIN, 190 * MIN)], 200 * MIN)
  expect(s).toMatchObject({ agents: 3, running: 0, activeMs: 20 * MIN, serialMs: 30 * MIN })
  expect(Math.abs(s.gain! - 1.5)).toBeLessThan(1e-9)
  // Un sous-agent sans fin vue court jusqu'à maintenant.
  expect(summaryOf([agent('d', 0)], 4 * MIN)).toMatchObject({ running: 1, activeMs: 4 * MIN })
})

test('des segments qui se chevauchent donnent des parts à dessiner sans trou ni débordement', () => {
  const axis = buildAxis([{ s: 0, e: 10_000 }], 0, 10_000)
  const parts = laneParts({ segments: [{ k: 'think', s: 0, e: 6_000 }, { k: 'tool', s: 4_000, e: 8_000, f: 'run' }, { k: 'write', s: 9_000 }] }, axis, 10_000)
  expect(parts.map(p => [p.kind, Math.round(p.x0 * 10), Math.round(p.x1 * 10), p.isLive === true])).toEqual([
    ['think', 0, 4, false],
    ['tool', 4, 8, false],
    ['write', 9, 10, true],
  ])
})

test('famille et argument court d’un outil', () => {
  expect(toolFamily('Grep')).toBe('read')
  expect(toolFamily('Edit')).toBe('edit')
  expect(toolFamily('Bash')).toBe('run')
  expect(toolFamily('WebFetch')).toBe('web')
  expect(toolFamily('Agent')).toBe('agent')
  expect(toolFamily('mcp__asana__get_task')).toBe('other')
  expect(shortArg('Read', { file_path: '/Users/x/projet/hooks/view.tsx' })).toBe('hooks/view.tsx')
  expect(shortArg('Bash', { command: 'claude plugin test plugins/flow-board' })).toBe('claude plugin test plugins/flow-board')
  expect(shortArg('WebFetch', { url: 'https://docs.example.com/a/b?q=1' })).toBe('docs.example.com/a/b')
  expect(shortArg('Grep', { pattern: 'x'.repeat(200) })!.length).toBeLessThanOrEqual(80)
})


test('un tour fini ou interrompu ferme tout ce qui restait ouvert ; une attente de fond peut rester', () => {
  let r = openSegment(emptyRegistry('s1', '/p', 0), MAIN, { k: 'think', s: 1 }, 1)!
  r = openSegment(r, MAIN, { k: 'tool', s: 2, f: 'run' }, 2)!
  r = openSegment(r, MAIN, { k: 'waitBg', s: 3 }, 3)!
  r = closeOpen(r, MAIN, 10, s => s.k === 'waitBg')!
  expect(r.main!.segments!.map(s => `${s.k}:${s.e ?? '…'}`)).toEqual(['think:10', 'tool:10', 'waitBg:…'])
  expect(closeOpen(r, MAIN, 11, s => s.k === 'waitBg')).toBeNull()
})

test('S12 : la piste de l’orchestrateur de deux processus se fusionne, sans doublon', () => {
  const base = openSegment(emptyRegistry('s1', '/p', 0), MAIN, { k: 'think', s: 1 }, 1)!
  const here = addMark(closeSegment(base, MAIN, () => true, 5)!, MAIN, { k: 'commit', at: 4 }, 5)!
  const there = addMark(openSegment(base, MAIN, { k: 'tool', s: 6, f: 'run' }, 6)!, MAIN, { k: 'msg', at: 6 }, 6)!
  const merged = mergeRegistry(here, there)
  expect(merged.main!.segments!.map(s => `${s.k}:${s.s}-${s.e ?? '…'}`)).toEqual(['think:1-5', 'tool:6-…'])
  expect(merged.main!.marks!.map(m => m.k)).toEqual(['commit', 'msg'])
  expect(mergeRegistry(merged, merged)).toBe(merged)
})

test('une piste de milliers de segments alternés reste un SVG sous la limite de 131 072 caractères', () => {
  const parts = Array.from({ length: 6000 }, (_, i) => ({ x0: i / 6000, x1: (i + 0.9) / 6000, kind: i % 2 === 0 ? ('think' as const) : ('tool' as const), glyph: '⌕' }))
  const marks = Array.from({ length: 3000 }, (_, i) => ({ x: i / 3000, glyph: '✗', color: '#E5534B' }))
  const drawn = laneSvg(parts, marks, [], 600, '#4A9EE8', 'big')
  expect(drawn.source.length).toBeLessThan(131_072)
})

test('deux appels parallèles du même outil se ferment chacun par son début', () => {
  let r = openSegment(emptyRegistry('s1', '/p', 0), MAIN, { k: 'tool', s: 1_000, f: 'read', t: 'Read' }, 1_000)!
  r = openSegment(r, MAIN, { k: 'tool', s: 1_100, f: 'read', t: 'Read' }, 1_100)!
  // Le premier lancé rend le premier.
  r = closeToolCall(r, MAIN, 'Read', { end: 3_000, start: 1_000, patch: { x: true } })!
  expect(r.main!.segments!.map(s => `${s.s}-${s.e ?? '…'}${s.x ? '✗' : ''}`)).toEqual(['1000-3000✗', '1100-…'])
})

test('une fin constatée après coup ne compte pas l’attente jusqu’au rattrapage', () => {
  let r = withAgent()
  r = openSegment(r, 'a1', { k: 'think', s: 1_000 }, 1_000)!
  r = closeSegment(r, 'a1', () => true, 2 * MIN)!
  // Rattrapée par la liste du moteur une heure plus tard.
  r = reconcileAgents(r, [], new Set(), new Set(['t1']), 60 * MIN)!
  expect(summaryOf(r.agents, 61 * MIN).activeMs).toBe(2 * MIN - 1_000)
})
