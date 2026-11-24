// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { C, SKILLS } from '../hooks/catalog.ts'
import { cooStatement, statementText, type CooStatement } from '../hooks/coo.ts'
import { coordinationRows, type CooRow } from '../hooks/coo-view.tsx'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { laneRoadSvg } from '../hooks/svg.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, openCoo, settle, start, world, writeBoard } from './monde-coordination.ts'
import { loadedStatement } from './vue-chargee.ts'

// La frise d'une mission dans son couloir : ses stations (une par phase, ou une par étape pour une mission à une seule
// phase) calculées par le relevé comme celles de la vue Mission ; un dessin compact hors du terminal, la frise en glyphes
// au terminal ; le texte du relevé que lit le Claude du COO n'en dit rien.

const NOW = 700_000_000
const board = (...runs: Run[]): Board => ({ ...emptyBoard('/p', 'p'), runs })
const nb = (t: string | undefined): string => (t ?? '').replace(/ /g, ' ')
const textOf = (r: CooRow | undefined): string => nb((r?.parts ?? []).map(p => p.text).join(' '))

/** Une mission partie de la spec : la spec faite, les tickets en cours. */
const atTickets = (): Run => {
  const run = newRun('to-spec', NOW - 60_000, 'Frise')
  return {
    ...run,
    status: 'active',
    owner: 'session-F',
    cursor: 1,
    phases: run.phases.map((p, i) => (i === 0 ? { ...p, status: 'done' } : i === 1 ? { ...p, status: 'active' } : p)),
  } as Run
}

test('plusieurs phases : une station par phase, la faite, celle en cours, les autres à venir, les facultatives marquées', () => {
  const m = cooStatement(board(atTickets()), { now: NOW }).missions[0]!
  expect(m.stationUnit).toBe('phase')
  expect(m.stations.map(x => x.label)).toEqual(['Spec', 'Tickets', 'Implémentation', 'Compte rendu', 'Version et push', 'Pull request'])
  expect(m.stations.map(x => x.state)).toEqual(['done', 'active', 'pending', 'pending', 'pending', 'pending'])
  expect(m.stations.map(x => x.isOptional === true)).toEqual([false, false, false, false, true, true])
  expect(m.stations.map(x => x.short)).toEqual([undefined, undefined, 'Code', 'Rapport', 'Push', 'PR'])
  expect(m.stations[1]!.color).toBe(SKILLS['to-tickets']!.color)
})

test('une seule phase : une station par étape, la première en cours', () => {
  const run = { ...newRun('prototype', NOW - 60_000, 'Proto'), owner: 'session-P' } as Run
  const steps = run.phases[0]!.steps
  const live = { ...run, phases: [{ ...run.phases[0]!, steps: steps.map((s, i) => ({ ...s, status: i === 0 ? 'active' : 'pending' })) }] } as Run
  const m = cooStatement(board(live), { now: NOW }).missions[0]!
  expect(m.stationUnit).toBe('étape')
  expect(m.stations.length).toBe(steps.length)
  expect(steps.length > 1).toBe(true)
  expect(m.stations.map(x => x.state)).toEqual(steps.map((_, i) => (i === 0 ? 'active' : 'pending')))
  expect(m.stations.every(x => x.color === SKILLS.prototype!.color)).toBe(true)
})

test('une mission close : toutes ses stations faites', () => {
  const run = atTickets()
  const done = { ...run, status: 'done', cursor: run.phases.length - 1, phases: run.phases.map(p => ({ ...p, status: 'done' })) } as Run
  const m = cooStatement(board(done), { now: NOW }).missions[0]!
  expect(m.stations.map(x => x.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
})

test('une phase dont le skill manque au catalogue (une autre version du mod) : une station grise à son id, et le relevé se calcule', () => {
  const run = atTickets()
  const odd = { ...run, phases: run.phases.map((p, i) => (i === 2 ? { ...p, skill: 'skill-futur' } : p)) } as Run
  const m = cooStatement(board(odd), { now: NOW }).missions[0]!
  expect([m.stations[2]!.label, m.stations[2]!.color]).toEqual(['skill-futur', C.gray])
  const one = { ...newRun('prototype', NOW - 60_000, 'Proto'), owner: 'session-P' } as Run
  const lone = { ...one, phases: [{ ...one.phases[0]!, skill: 'skill-futur' }] } as Run
  expect(cooStatement(board(lone), { now: NOW }).missions[0]!.stations.every(x => x.color === C.gray)).toBe(true)
})
test('le texte du relevé ne lit pas les stations : identique sans elles, pour le relevé chargé', () => {
  const s = loadedStatement()
  expect(s.missions.some(m => m.stations.length > 0)).toBe(true)
  const bare: CooStatement = { ...s, missions: s.missions.map(m => ({ ...m, stations: [], stationUnit: m.stationUnit === 'phase' ? 'étape' : 'phase' })) }
  expect(statementText(bare)).toBe(statementText(s))
})

// ─── Le dessin seul ───────────────────────────────────────────────────────

const STATIONS = [
  { label: 'Spec', color: '#111111', state: 'active' as const },
  { label: 'Tickets', color: '#222222', state: 'pending' as const },
  { label: 'Implémentation', short: 'Code', color: '#333333', state: 'pending' as const },
  { label: 'Compte rendu', short: 'Rapport', color: '#444444', state: 'pending' as const },
  { label: 'Version et push', short: 'Push', color: '#555555', state: 'pending' as const },
]

test('la frise compacte : libellés courts au-delà de trois stations, la station en cours entière, en gras, à sa couleur, et qui pulse seulement quand elle vit', () => {
  const live = laneRoadSvg(STATIONS, 400, true, C.green).source
  expect(live).toContain('>Code<')
  expect(live).toContain('>Rapport<')
  expect(live).not.toContain('Implémentation')
  expect(live).toMatch(/font-weight="700" fill="#111111">Spec</)
  expect(live).toContain('<animate')
  const still = laneRoadSvg(STATIONS, 400, false, C.green).source
  expect(still).not.toContain('<animate')
  // Trois stations au plus : les libellés entiers.
  expect(laneRoadSvg(STATIONS.slice(1, 4), 400, false, C.green).source).toContain('Implémentation')
  // Une station faite est pleine, en vert ; une à venir en creux.
  const done = laneRoadSvg([{ ...STATIONS[0]!, state: 'done' }, STATIONS[1]!], 300, false, C.green).source
  expect(done).toContain(`r="4.5" fill="${C.green}"`)
  expect(done).toContain('fill="none" stroke=')
})

test('une seule station : son point et son libellé à côté, sans trait ; la largeur donnée ; la source sous 4 096 caractères', () => {
  const one = laneRoadSvg([STATIONS[0]!], 240, true, C.green)
  expect(one.width).toBe(240)
  expect(one.source).not.toContain('<line')
  expect(one.source).toContain('text-anchor="start"')
  expect(laneRoadSvg(STATIONS, 512, true, C.green).width).toBe(512)
  const many = Array.from({ length: 12 }, (_, i) => ({ label: `Étape numéro ${i}`, short: `É${i}`, color: '#123456', state: i < 5 ? ('done' as const) : i === 5 ? ('active' as const) : ('pending' as const) }))
  expect(laneRoadSvg(many, 900, true, C.green).source.length).toBeLessThan(4096)
})

// ─── Dans le couloir ──────────────────────────────────────────────────────

test('le couloir porte sa frise sous la ligne d’état, qui ne dit plus la phase ; la station en cours ne pulse pas en pause, close ou discussion arrêtée', () => {
  const s = cooStatement(board(atTickets()), { now: NOW })
  const id = s.missions[0]!.id
  const rows = coordinationRows(s, { page: 'overview' })
  const at = rows.findIndex(r => r.key === `coo-mission-${id}-road`)
  expect(rows[at - 1]?.key).toBe(`coo-mission-${id}-state`)
  expect(rows[at]!.frame?.id).toBe(`mission-${id}`)
  expect(rows[at]!.road?.unit).toBe('phase')
  expect(rows[at]!.road?.isLive).toBe(true)
  expect(textOf(rows[at - 1])).not.toContain('Tickets')
  const live = (over: Partial<CooStatement['missions'][number]>): boolean | undefined => {
    const m = { ...s.missions[0]!, ...over }
    return coordinationRows({ ...s, missions: [m] }, { page: 'overview' }).find(r => r.key === `coo-mission-${id}-road`)?.road?.isLive
  }
  expect(live({ status: 'paused' as never })).toBe(false)
  expect(live({ status: 'done' })).toBe(false)
  expect(live({ stopped: 'discussion arrêtée' })).toBe(false)
  // Sans station, pas de frise.
  expect(coordinationRows({ ...s, missions: [{ ...s.missions[0]!, stations: [] }] }, { page: 'overview' }).some(r => r.kind === 'road')).toBe(false)
})

test('hors du terminal, la frise est un dessin à la largeur du couloir, dont le texte dit la phase en cours et son rang ; au terminal, des glyphes, sans dessin', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const run = atTickets()
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await pane.press({ key: 'coo-page-overview' })
    const road = await pane.find({ key: `coo-mission-${run.id}-road` })
    expect(road, surface).toBeDefined()
    if (surface === 'desktop') {
      const alts = ((await pane.findAll({ type: 'Svg' })) as any[]).map(x => nb(String(x.props.alt)))
      expect(alts).toContain('Tickets, phase 2 sur 6')
    } else {
      expect(await pane.find({ type: 'Svg' })).toBeUndefined()
      const texts = ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? ''))
      expect(texts).toContain('◉')
      expect(texts).toContain('●')
    }
    await pane.unmount()
  }
})
