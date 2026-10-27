import { expect, test } from 'claude-code/testing'

import { MAIN, addMark, closeOpen, closeSegment, closeToolCall, emptyRegistry, mergeRegistry, openSegment, reconcileAgents, spawnAgent, startCall } from '../hooks/registry.ts'
import { laneCells, rulerCells } from '../hooks/cells.ts'
import { laneSvg } from '../hooks/svg.ts'
import { PAUSE_MS, TOOL_FAMILIES, WORKING_KINDS, activityOf, buildAxis, laneParts, rulerTicks, shortArg, sliceAxis, summaryOf, timeOf, toolFamily, windowBounds, xOf, zoomWindow } from '../hooks/timeline.ts'
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

const agentAt = (key: string, s: number, e: number | undefined, segments: RegistryAgent['segments'] = []): RegistryAgent => ({
  key,
  name: key,
  isBackground: true,
  status: e === undefined ? 'running' : 'done',
  startedAt: s,
  ...(e !== undefined ? { finishedAt: e } : {}),
  source: 'live',
  segments,
})

/** Les pauses compressées d'un axe bâti sur l'activité de pistes et de sous-agents, en minutes. */
const pausesOf = (lanes: Parameters<typeof activityOf>[0], agents: RegistryAgent[], start: number, end: number): number[] =>
  buildAxis(activityOf(lanes, agents, end), start, end).pieces.filter(p => p.pause !== undefined).map(p => p.pause! / MIN)

test('une pause de plus d’une minute se compresse ; une minute ou moins reste à l’échelle', () => {
  expect(PAUSE_MS).toBe(MIN)
  const work = (s: number, e: number) => ({ k: 'write' as const, s, e })
  expect(pausesOf([{ segments: [work(0, MIN), work(3 * MIN, 4 * MIN)] }], [], 0, 4 * MIN)).toEqual([2])
  expect(pausesOf([{ segments: [work(0, MIN), work(2 * MIN, 3 * MIN)] }], [], 0, 3 * MIN)).toEqual([])
})

test('attendre la réponse de Mathis est une pause ; attendre un sous-agent ou une tâche de fond est du travail', () => {
  const lane = (k: 'waitPerson' | 'waitAgent' | 'waitBg') => ({ segments: [{ k: 'think' as const, s: 0, e: MIN }, { k, s: MIN, e: 60 * MIN }, { k: 'write' as const, s: 60 * MIN, e: 61 * MIN }] })
  expect(pausesOf([lane('waitPerson')], [], 0, 61 * MIN)).toEqual([59])
  expect(pausesOf([lane('waitAgent')], [], 0, 61 * MIN)).toEqual([])
  expect(pausesOf([lane('waitBg')], [], 0, 61 * MIN)).toEqual([])
  expect(WORKING_KINDS).toEqual(new Set(['think', 'write', 'tool', 'waitAgent', 'waitBg', 'waitAdvisor']))
})

test('un sous-agent compte par ses segments, pas par toute sa période ; tout juste lancé sans segment, il bloque', () => {
  const main = { segments: [{ k: 'write' as const, s: 0, e: MIN }, { k: 'write' as const, s: 60 * MIN, e: 61 * MIN }] }
  // Au travail les 2 premières minutes, puis en attente de Mathis jusqu'à sa fin.
  const idle = agentAt('a', 0, 61 * MIN, [{ k: 'think', s: 0, e: 2 * MIN }, { k: 'waitPerson', s: 2 * MIN, e: 61 * MIN }])
  expect(pausesOf([main], [idle], 0, 61 * MIN)).toEqual([58])
  // En cours, ses segments tous fermés : il ne bloque pas non plus.
  const quiet = agentAt('b', 0, undefined, [{ k: 'think', s: 0, e: 2 * MIN }])
  expect(pausesOf([main], [quiet], 0, 61 * MIN)).toEqual([58])
  // En cours, sans aucun segment : actif depuis son départ.
  expect(pausesOf([main], [agentAt('c', 5 * MIN, undefined)], 0, 61 * MIN)).toEqual([4])
})

test('quand les sessions liées et les sous-agents attendent eux aussi Mathis, le temps se compresse quand même', () => {
  const main = { segments: [{ k: 'write' as const, s: 0, e: MIN }, { k: 'waitPerson' as const, s: MIN, e: 120 * MIN }, { k: 'write' as const, s: 120 * MIN, e: 121 * MIN }] }
  const linked = { segments: [{ k: 'tool' as const, s: 0, e: 2 * MIN }, { k: 'waitPerson' as const, s: 2 * MIN, e: 121 * MIN }] }
  const agent = agentAt('a', 0, 121 * MIN, [{ k: 'write', s: 0, e: 3 * MIN }, { k: 'waitPerson', s: 3 * MIN, e: 121 * MIN }])
  expect(pausesOf([main, linked], [agent], 0, 121 * MIN)).toEqual([117])
  // Une seule ligne qui travaille au milieu suffit à couper la pause en deux.
  const busy = { segments: [{ k: 'waitBg' as const, s: 50 * MIN, e: 70 * MIN }] }
  expect(pausesOf([main, linked, busy], [agent], 0, 121 * MIN)).toEqual([47, 50])
})

test('une attente de Mathis au bord de la frise devient une pause compressée, pas un bord coupé', () => {
  const lane = { segments: [{ k: 'write' as const, s: 0, e: MIN }, { k: 'waitPerson' as const, s: MIN, e: 90 * MIN }] }
  const axis = buildAxis(activityOf([lane], [], 90 * MIN), 0, 90 * MIN)
  expect(axis.end).toBe(90 * MIN)
  expect(axis.pieces.filter(p => p.pause !== undefined).map(p => p.pause! / MIN)).toEqual([89])
  // Sa part d'attente est écrasée à la largeur de la pause, sans disparaître.
  const wait = laneParts(lane, axis, 90 * MIN).find(p => p.kind === 'waitPerson')!
  expect(wait.x1).toBe(1)
  expect(wait.x1 - wait.x0).toBeLessThan(0.05)
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

test('la famille d’un outil se lit dans une seule table, celle que la légende détaillée montre', () => {
  for (const [family, tools] of Object.entries(TOOL_FAMILIES)) for (const tool of tools) expect(toolFamily(tool)).toBe(family)
  expect(TOOL_FAMILIES.read).toContain('ToolSearch')
  expect(toolFamily('Inconnu')).toBe('other')
})

test('une pause compressée coupe le rail : deux traits et sa durée, sans barre ; au terminal « ┊ »', () => {
  const pause = { x0: 0.4, x1: 0.6, label: '2 h' }
  const drawn = laneSvg([{ x0: 0, x1: 0.4, kind: 'write' }, { x0: 0.6, x1: 1, kind: 'write' }], [], [pause], 200, '#4A9EE8', 'p').source
  expect(drawn.includes('⫽')).toBe(false)
  expect(drawn).toContain('>2 h<')
  // Deux traits verticaux, aux bords de la pause.
  expect((drawn.match(/<line [^>]*x1="80"[^>]*x2="80"/g) ?? []).length + (drawn.match(/<line [^>]*x1="120"[^>]*x2="120"/g) ?? []).length).toBe(2)
  const cells = laneCells([], [], [pause], 20, '#4A9EE8', false).map(c => c.glyph).join('')
  // Sa durée n'y tient pas sur deux cases : le rail y est coupé, vide.
  expect(cells.slice(8, 12)).toBe('┊  ┊')
  // Sur une piste plus large, elle s'y lit.
  expect(laneCells([], [], [pause], 40, '#4A9EE8', false).map(c => c.glyph).join('').slice(16, 24)).toBe('┊ 2 h  ┊')
  // Une attente de la personne écrasée dans la pause reste visible entre les deux traits.
  const waiting = laneCells([{ kind: 'waitPerson', x0: 0.4, x1: 0.6, s: 0, e: 1 }], [], [pause], 20, '#4A9EE8', false).map(c => c.glyph).join('')
  expect(waiting.slice(8, 12)).toBe('┊╱╱┊')
})

test('au terminal, une attente écrasée dans une pause étroite reste visible : les traits ne la recouvrent pas', () => {
  const wait = (x0: number, x1: number) => [{ kind: 'waitPerson' as const, x0, x1, s: 0, e: 1 }]
  const glyphs = (x0: number, x1: number, columns: number) => laneCells(wait(x0, x1), [], [{ x0, x1 }], columns, '#4A9EE8', false).map(c => c.glyph)
  // Une pause d'une case : la hachure.
  expect(glyphs(0.5, 0.52, 50)[25]).toBe('╱')
  // De deux cases : un trait, puis la hachure.
  expect(glyphs(0.5, 0.54, 50).slice(25, 27).join('')).toBe('┊╱')
  // Sans attente, la coupure garde ses deux traits.
  expect(laneCells([], [], [{ x0: 0.5, x1: 0.54 }], 50, '#4A9EE8', false).map(c => c.glyph).slice(25, 27).join('')).toBe('┊┊')
})

// ─── Zoom et navigation ─────────────────────────────────────────────────────

/** Un axe de 3 h : 1 h de travail, 1 h de pause compressée, 1 h de travail. */
const zoomAxis = () => buildAxis([{ s: 0, e: 60 * MIN }, { s: 120 * MIN, e: 180 * MIN }], 0, 180 * MIN)

test('la position d’un instant et l’instant d’une position sont inverses, pauses comprises', () => {
  const axis = zoomAxis()
  for (const t of [0, 10 * MIN, 59 * MIN, 90 * MIN, 150 * MIN, 180 * MIN]) expect(Math.abs(timeOf(axis, xOf(axis, t)) - t)).toBeLessThan(1)
  // Une pause se répartit linéairement sur sa largeur : son milieu est le milieu de son temps.
  const pause = axis.pieces.find(p => p.pause !== undefined)!
  expect(Math.round(timeOf(axis, (pause.x0 + pause.x1) / 2) / MIN)).toBe(90)
  expect(timeOf(axis, -1)).toBe(0)
  expect(timeOf(axis, 2)).toBe(180 * MIN)
})

test('le zoom divise ou double la largeur affichée ; le déplacement va d’une demi-largeur et fige la fenêtre', () => {
  const axis = zoomAxis()
  const width = (w: ReturnType<typeof zoomWindow>) => {
    const { a, b } = windowBounds(axis, w)
    return b - a
  }
  // « tout » : null, toute la largeur ; le zoom avant garde la fin et suit le direct.
  const z1 = zoomWindow(axis, null, 'in')!
  expect(Math.abs(width(z1) - 0.5)).toBeLessThan(1e-9)
  expect(z1.isLive).toBe(true)
  expect(windowBounds(axis, z1).b).toBe(1)
  // Vers le passé : figée, décalée d'une demi-largeur.
  const left = zoomWindow(axis, z1, 'left')!
  expect(left.isLive).toBe(false)
  expect(Math.abs(windowBounds(axis, left).a - 0.25)).toBeLessThan(1e-9)
  // Figée, le zoom se fait autour de son centre.
  const z2 = zoomWindow(axis, left, 'in')!
  const { a, b } = windowBounds(axis, z2)
  expect(Math.abs((a + b) / 2 - 0.5)).toBeLessThan(1e-9)
  expect(Math.abs(b - a - 0.25)).toBeLessThan(1e-9)
  // Revenue au bout, elle suit à nouveau le direct.
  expect(zoomWindow(axis, zoomWindow(axis, left, 'right'), 'right')!.isLive).toBe(true)
  // Le zoom arrière jusqu'à tout rend « tout ».
  expect(zoomWindow(axis, z1, 'out')).toBeNull()
  // Bornée aux extrémités.
  expect(windowBounds(axis, zoomWindow(axis, zoomWindow(axis, left, 'left'), 'left')).a).toBe(0)
})

test('le zoom s’arrête à une minute de temps réel', () => {
  const axis = zoomAxis()
  let w = zoomWindow(axis, null, 'in')
  for (let i = 0; i < 30; i++) w = zoomWindow(axis, w, 'in')
  expect(Math.round((w!.end - w!.start) / 1000)).toBe(60)
  // Un axe de moins d'une minute ne se zoome pas.
  expect(zoomWindow(buildAxis([{ s: 0, e: 30_000 }], 0, 30_000), null, 'in')).toBeNull()
})

test('une fenêtre figée montre le même moment quand l’axe grandit ; une fenêtre qui suit le direct garde sa durée', () => {
  const axis = zoomAxis()
  const fixed = { start: 30 * MIN, end: 50 * MIN, isLive: false }
  const later = buildAxis([{ s: 0, e: 60 * MIN }, { s: 120 * MIN, e: 240 * MIN }], 0, 240 * MIN)
  for (const ax of [axis, later]) {
    const cut = sliceAxis(ax, windowBounds(ax, fixed))
    expect([cut.start, cut.end].map(Math.round)).toEqual([30 * MIN, 50 * MIN])
  }
  const live = { start: 150 * MIN, end: 180 * MIN, isLive: true }
  const cut = sliceAxis(later, windowBounds(later, live))
  expect([cut.start, cut.end].map(Math.round)).toEqual([210 * MIN, 240 * MIN])
  expect(cut.pieces[0]!.x0).toBe(0)
  expect(cut.pieces[cut.pieces.length - 1]!.x1).toBe(1)
})

test('la règle graduée choisit son pas dans la liste et s’interrompt aux pauses', () => {
  const axis = zoomAxis()
  // 2 h de temps réel affiché : au plus 10 graduations → pas de 15 min.
  const ticks = rulerTicks(axis, 10)
  expect(ticks.step).toBe(15 * MIN)
  // Aucune graduation dans la pause.
  expect(ticks.ticks.every(t => t.at <= 60 * MIN || t.at >= 120 * MIN)).toBe(true)
  expect(ticks.ticks.every(t => /^\d\d:\d\d$/.test(t.label))).toBe(true)
  expect(rulerTicks(sliceAxis(axis, { a: 0, b: 0.01 }), 10).step).toBe(MIN)
  expect(rulerTicks(buildAxis([{ s: 0, e: 100 * 60 * MIN }], 0, 100 * 60 * MIN), 10).step).toBe(6 * 60 * MIN)
})

test('au terminal, la règle graduée pose « ╵ » et l’heure quand elle tient, « ┊ » aux bords des pauses', () => {
  const row = rulerCells([{ x: 0, label: '10:00' }, { x: 0.1, label: '10:15' }, { x: 0.5, label: '10:30' }], [{ x0: 0.8, x1: 0.9 }], 40).replace(/\u00a0/g, ' ')
  expect(row.length).toBe(40)
  // Deux graduations trop proches : la première garde son trait, pas son heure.
  expect(row.slice(0, 4)).toBe('╵   ')
  expect(row.slice(4, 10)).toBe('╵10:15')
  expect(row.slice(20, 26)).toBe('╵10:30')
  expect([row[32], row[35]]).toEqual(['┊', '┊'])
})

test('l\'attente de l\'advisor est en pointillés, pas hachurée : l\'or ne se confond pas avec l\'ambre de la personne', () => {
  const parts = [{ kind: 'waitAdvisor' as const, x0: 0, x1: 0.5, s: 0, e: 1 }, { kind: 'waitPerson' as const, x0: 0.5, x1: 1, s: 1, e: 2 }]
  const glyphs = laneCells(parts, [], [], 10, '#4A9EE8', false).map(c => c.glyph).join('')
  expect(glyphs).toBe('┄┄┄┄┄╱╱╱╱╱')
  const drawn = laneSvg(parts, [], [], 200, '#4A9EE8', 'adv').source
  // Des points pour l'advisor, des traits pour la personne.
  expect(drawn).toMatch(/<pattern id="adv-waitAdvisor"[^>]*><rect[^>]*\/><circle /)
  expect(drawn).toMatch(/<pattern id="adv-waitPerson"[^>]*><rect[^>]*\/><line /)
})
