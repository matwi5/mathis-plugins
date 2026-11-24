// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { C, SKILLS } from '../hooks/catalog.ts'
import { cooStatement, type CooMission, type CooStatement } from '../hooks/coo.ts'
import { coordinationRows, type CooRow } from '../hooks/coo-view.tsx'
import { emptyBoard, newRun } from '../hooks/model.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, openCoo, settle, start, world, writeBoard } from './monde-coordination.ts'
import { OVERVIEW_KEYS, keysOf, loadedStatement } from './vue-chargee.ts'

// Sur « Vue d'ensemble », chaque mission est un couloir : son en-tête (numéro, titre, mode), sa ligne d'état, puis, dans un
// rectangle intérieur chacune, les choses qu'elle attend de la personne ; ses boutons au bas. Une mission qui attend la
// personne a une bordure ambre, dit « n pour toi » et passe en premier.

const nb = (t: string | undefined): string => (t ?? '').replace(/ /g, ' ')
const textOf = (r: CooRow | undefined): string => nb((r?.parts ?? []).map(p => p.text).join(' '))
const rowsOf = (s: CooStatement): CooRow[] => coordinationRows(s, { page: 'overview' })
const row = (rows: readonly CooRow[], key: string): CooRow => {
  const found = rows.find(r => r.key === key)
  if (!found) throw new Error(`ligne ${key} absente`)
  return found
}
/** L'ordre des couloirs : les missions, par l'ordre de leur ligne d'en-tête. */
const laneOrder = (rows: readonly CooRow[]): string[] => rows.filter(r => /^coo-mission-[^-]+$/.test(r.key)).map(r => r.key.slice('coo-mission-'.length))

test('sur le relevé chargé, les couloirs qui attendent la personne d’abord, ambre, avec « n pour toi » ; leurs choses dans des rectangles intérieurs', () => {
  const rows = rowsOf(loadedStatement())
  expect(laneOrder(rows)).toEqual(['mauto0001', 'mmanu0001', 'mheld0001', 'mdone0001'])
  expect(row(rows, 'coo-mission-mauto0001').frame?.color).toBe(C.amber)
  expect(textOf(row(rows, 'coo-mission-mauto0001-state'))).toContain('· 2 pour toi')
  // Les questions de la mission en auto, dans son couloir, chacune dans son rectangle intérieur.
  for (const k of ['coo-wait-mauto0001-q1-qsgphfp', 'coo-wait-mauto0001-g1-q1esfv22']) {
    expect(row(rows, k).frame?.id, k).toBe('mission-mauto0001')
    expect(row(rows, k).inner?.color, k).toBe(C.amber)
  }
  expect(nb(row(rows, 'coo-wait-mauto0001-g1-q1esfv22').inner?.chip)).toBe('? Dépense')
  // La mission en manuel : sa ligne « t'attend » et la retenue « à forcer » où elle attend ; la grise en ligne, sans rectangle intérieur.
  expect(row(rows, 'coo-waiting-0').frame?.id).toBe('mission-mmanu0001')
  expect(nb(row(rows, 'coo-waiting-0').inner?.chip)).toBe('◷ T’attend')
  expect(nb(row(rows, 'coo-hold-mmanu0001~A~mheld0001~A~file').inner?.chip)).toBe('⇥ À forcer')
  expect(row(rows, 'coo-hold-mmanu0001~B~mheld0001~B~file').frame?.id).toBe('mission-mmanu0001')
  expect(row(rows, 'coo-hold-mmanu0001~B~mheld0001~B~file').inner).toBeUndefined()
  expect(textOf(row(rows, 'coo-mission-mmanu0001-state'))).toContain('· 2 pour toi')
  // Les autres : sans « pour toi », à la couleur de leur phase ou grises.
  expect(row(rows, 'coo-mission-mheld0001').frame?.color).toBe(SKILLS.implement!.color)
  expect(row(rows, 'coo-mission-mdone0001').frame?.color).toBe(C.gray)
  expect(textOf(row(rows, 'coo-mission-mheld0001-state'))).not.toContain('pour toi')
})

test('aucune clé perdue ni doublée, et ce qui tient à une mission de la liste n’est plus dans le bloc « Projet »', () => {
  const rows = rowsOf(loadedStatement())
  const keys = keysOf(rows)
  expect(new Set(keys).size).toBe(keys.length)
  expect([...keys].sort()).toEqual([...OVERVIEW_KEYS].sort())
  const missions = rows.findIndex(r => r.key === 'coo-missions')
  for (const k of ['coo-wait-mauto0001-q1-qsgphfp', 'coo-waiting-0', 'coo-hold-mmanu0001~A~mheld0001~A~file']) expect(rows.findIndex(r => r.key === k), k).toBeGreaterThan(missions)
})

test('une chose dont la mission n’est pas dans la liste, et une réponse pas encore appliquée, restent dans le bloc « Projet »', () => {
  const s = loadedStatement()
  const orphan = { ...s.waits[0]!, missionId: 'mailleurs1', mission: 'Ailleurs', id: 'q9', print: 'p9' }
  const relays = [{ missionId: 'mauto0001', mission: 'Mission en auto', question: 'q1', state: 'paused' as const }]
  const rows = rowsOf({ ...s, waits: [...s.waits, orphan], relays } as CooStatement)
  const missions = rows.findIndex(r => r.key === 'coo-missions')
  const lost = rows.find(r => r.key.startsWith('coo-wait-mailleurs1'))!
  expect(rows.indexOf(lost)).toBeLessThan(missions)
  expect(lost.frame?.id).toMatch(/^wait-/)
  expect(rows.findIndex(r => r.key === 'coo-relay-0')).toBeLessThan(missions)
})

test('un couloir qui ne porte qu’une retenue grise garde sa couleur et son rang, sans « pour toi »', () => {
  const s = loadedStatement()
  const grey = { ...s, waiting: [], holds: s.holds.filter(h => !h.isToForce) } as CooStatement
  const rows = rowsOf(grey)
  // La mission en auto (ses questions) d'abord ; la mission en manuel, qui ne porte que la grise, à son rang du relevé.
  expect(laneOrder(rows)).toEqual(['mauto0001', 'mmanu0001', 'mheld0001', 'mdone0001'])
  const onlyGrey = { ...grey, waits: [] } as CooStatement
  const rows2 = rowsOf(onlyGrey)
  expect(laneOrder(rows2)).toEqual(['mauto0001', 'mmanu0001', 'mheld0001', 'mdone0001'])
  expect(row(rows2, 'coo-mission-mmanu0001').frame?.color).toBe(SKILLS.implement!.color)
  expect(textOf(row(rows2, 'coo-mission-mmanu0001-state'))).not.toContain('pour toi')
  expect(row(rows2, 'coo-hold-mmanu0001~B~mheld0001~B~file').frame?.id).toBe('mission-mmanu0001')
})

test('l’ordre : les couloirs qui attendent la personne d’abord dans l’ordre du relevé, puis les autres dans l’ordre du relevé', () => {
  const s = loadedStatement()
  // Seule la mission retenue (3e du relevé) attend : elle passe en premier, les autres gardent leur ordre.
  const q = { ...s.waits[0]!, missionId: 'mheld0001', mission: 'Mission retenue', id: 'q7', print: 'p7' }
  const rows = rowsOf({ ...s, waits: [q], waiting: [], holds: [] } as CooStatement)
  expect(laneOrder(rows)).toEqual(['mheld0001', 'mauto0001', 'mmanu0001', 'mdone0001'])
})

// ─── L'état d'un couloir ──────────────────────────────────────────────────

const mission = (over: Partial<CooMission>): CooMission => ({ id: 'mlane0001', title: 'Couloir', status: 'active', phase: 'implement', mode: 'manual', isOpen: true, done: 0, total: 0, workers: [], waiting: 0, stations: [], stationUnit: 'phase', ...over })
const stateOf = (m: CooMission, over: Partial<CooStatement> = {}) => {
  const s = { ...cooStatement(emptyBoard('', 'p'), { now: 5 }), missions: [m], ...over } as CooStatement
  const rows = rowsOf(s)
  const state = row(rows, `coo-mission-${m.id}-state`)
  return { text: textOf(state), mark: state.parts[0]?.mark, color: row(rows, `coo-mission-${m.id}`).frame?.color, rows }
}

test('un état par couloir, le premier qui vaut : close, en pause, discussion arrêtée, t’attend, worker au travail, ouverte nulle part, en cours', () => {
  const cases: [string, CooMission, Partial<CooStatement>, string, 'pulse' | 'still'][] = [
    ['close', mission({ status: 'done', stopped: 'discussion arrêtée' }), {}, 'close', 'still'],
    ['en pause', mission({ status: 'paused' as any, stopped: 'discussion arrêtée' }), {}, 'en pause', 'still'],
    ['discussion arrêtée', mission({ stopped: 'discussion arrêtée', workers: [{ group: 'A', done: 0, total: 2, state: 'working' }] }), {}, 'discussion arrêtée', 'still'],
    ['t’attend', mission({ workers: [{ group: 'A', done: 0, total: 2, state: 'working' }] }), { waiting: [{ missionId: 'mlane0001', mission: 'Couloir', kind: 'validation', since: 1 }] as any }, 't’attend', 'still'],
    ['worker au travail', mission({ isOpen: false, workers: [{ group: 'A', done: 0, total: 2, state: 'working' }] }), {}, 'worker au travail', 'pulse'],
    ['ouverte nulle part', mission({ isOpen: false, workers: [{ group: 'A', done: 2, total: 2, state: 'returned' }] }), {}, 'ouverte nulle part', 'still'],
    ['en cours', mission({}), {}, 'en cours', 'pulse'],
  ]
  for (const [name, m, over, label, mark] of cases) {
    const seen = stateOf(m, over)
    expect(seen.text.startsWith(`${label} ${label}`), `${name} : ${seen.text}`).toBe(true)
    expect(seen.mark, name).toBe(mark)
    expect(seen.text, name).not.toMatch(/Claude travaille/)
  }
  // Une question bloquante seule ne donne pas « t'attend » : la mission avance sur le reste, avec « 1 pour toi ».
  const asked = stateOf(mission({ mode: 'auto' }), { waits: [{ missionId: 'mlane0001', mission: 'Couloir', id: 'q1', text: 'Oui ?', at: 1, print: 'pq' }] })
  expect(asked.text).toMatch(/^en cours en cours/)
  expect(asked.text).toContain('· 1 pour toi')
  expect(asked.color).toBe(C.amber)
})

test('la bordure : ambre quand le couloir attend, grise en pause, close ou discussion arrêtée, sinon la couleur du skill de sa phase', () => {
  expect(stateOf(mission({ status: 'paused' as any })).color).toBe(C.gray)
  expect(stateOf(mission({ status: 'done' })).color).toBe(C.gray)
  expect(stateOf(mission({ stopped: 'discussion arrêtée' })).color).toBe(C.gray)
  expect(stateOf(mission({ phase: 'to-spec' })).color).toBe(SKILLS['to-spec']!.color)
})

test('la ligne d’état porte les workers, la barre des tickets et « n/m tickets » ; « Reprends-la pour l’allumer » en manuel ouverte nulle part ; « n en cours » compte « en cours » et « worker au travail »', () => {
  const m = mission({ isOpen: false, done: 2, total: 5, workers: [{ group: 'A', done: 1, total: 3, state: 'working' }, { group: 'B', done: 1, total: 1, state: 'returned' }] })
  const seen = stateOf(m)
  expect(seen.text).toContain('↗A 1/3')
  expect(seen.text).toContain('↗B 1/1 rendu')
  expect(seen.text).toContain('2/5 tickets')
  const state = row(seen.rows, 'coo-mission-mlane0001-state')
  expect(state.parts.find(p => p.bar)?.bar).toEqual({ done: 2, doing: 1, total: 5 })
  expect(state.parts.some(p => p.mark === 'spin')).toBe(true)
  // Worker au travail : en cours pour l'encadré du point ; une mission ouverte nulle part, non.
  expect(nb(row(seen.rows, 'coo-point').aside?.[1]?.text)).toBe('1 en cours')
  const idle = stateOf(mission({ isOpen: false }))
  expect(idle.text).toContain('Reprends-la pour l’allumer')
  expect(nb(row(idle.rows, 'coo-point').aside?.[1]?.text)).toBe('0 en cours')
})

test('l’en-tête du couloir garde le numéro, le titre et la marque de mode ; ses boutons d’aujourd’hui, posés au bas du couloir', () => {
  const s = loadedStatement()
  const rows = rowsOf(s)
  const head = row(rows, 'coo-mission-mauto0001')
  expect(textOf(head)).toMatch(/Mission en auto ⚡ Auto/)
  expect(head.actions?.map(a => a.key)).toEqual(['coo-cut-auto-mauto0001'])
  expect(head.isActsLast).toBe(true)
  expect(row(rows, 'coo-mission-mmanu0001').actions?.map(a => a.key)).toEqual(['coo-auto-on-mmanu0001'])
})

// ─── Le panneau monté ─────────────────────────────────────────────────────

const NOW = 660_000_000
const runs = (): Run[] => [
  {
    ...newRun('implement', NOW - 60_000, 'Mission en auto'),
    status: 'active',
    owner: 'session-M',
    updatedAt: NOW - 1_000,
    auto: { onAt: NOW - 30_000, onBy: 'session-M' },
    waiting: [{ id: 'q1', blocks: { phase: 'implement' }, text: 'Garder ?', at: NOW - 5_000 }],
    tickets: [
      { id: '1', name: 'Un', status: 'done' },
      { id: '2', name: 'Deux', status: 'todo' },
    ],
  } as unknown as Run,
  { ...newRun('implement', NOW - 60_000, 'Mission calme'), status: 'active', owner: 'session-B', updatedAt: NOW - 1_000 } as Run,
]

test('au terminal comme sur l’ordinateur : un couloir à bordure arrondie, la question dans un rectangle intérieur à bordure simple, la barre des tickets (dessin, ou blocs au terminal)', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const list = runs()
  writeBoard(w, b => ({ ...b, runs: list }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await pane.press({ key: 'coo-page-overview' })
    const lane = await pane.find({ key: `frame-mission-${list[0]!.id}` })
    expect([lane?.props.borderStyle, lane?.props.borderColor], surface).toEqual(['round', C.amber])
    const inner = (await pane.findAll({ type: 'Box' })).find((b: any) => String(b.key ?? '').startsWith(`inner-wait-${list[0]!.id}`)) as any
    expect([inner?.props.borderStyle, inner?.props.borderColor], surface).toEqual(['single', C.amber])
    expect(await pane.find({ key: `frame-mission-${list[0]!.id}-acts` }), surface).toBeDefined()
    if (surface === 'desktop') {
      const alts = ((await pane.findAll({ type: 'Svg' })) as any[]).map(s => nb(String(s.props.alt)))
      expect(alts).toContain('1 ticket fait sur 2')
    } else {
      expect(await pane.find({ type: 'Svg' })).toBeUndefined()
      const texts = ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? ''))
      expect(texts.some(t => /^█+$/.test(t))).toBe(true)
    }
    await pane.unmount()
  }
})
