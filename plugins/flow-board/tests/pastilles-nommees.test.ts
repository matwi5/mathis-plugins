import { expect, test } from 'claude-code/testing'

import { C } from '../hooks/catalog.ts'
import { cooStatement, type CooStatement } from '../hooks/coo.ts'
import { coordinationRows, type CooRow } from '../hooks/coo-view.tsx'
import { retroAdviceOf } from '../hooks/launch.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { retroCard } from '../hooks/retro-coo.ts'
import type { Run } from '../types'
import { loadedStatement } from './vue-chargee.ts'

// Les réponses de Mathis du 23/11/2026 aux questions d'expérience des groupes A et B : les pastilles nommées de ce que
// la maquette D ne nommait pas, la ligne du bloc « Projet » quand rien n'y attend, le genre des livrées dans la tuile, et
// l'avis d'une carte de rétro à côté de son départ.

const nb = (t: string | undefined): string => (t ?? '').replace(/ /g, ' ')
const overview = (s: CooStatement): CooRow[] => coordinationRows(s, { page: 'overview' })
const frame = (rows: readonly CooRow[], key: string) => {
  const r = rows.find(x => x.key === key)
  if (!r) throw new Error(`ligne ${key} absente`)
  const f = r.inner ?? r.frame
  return f ? { color: f.color, chip: nb(f.chip) } : undefined
}
const text = (r: CooRow | undefined): string => nb((r?.parts ?? []).map(p => p.text).join(' '))

test('rangement dû, réponse pas encore appliquée, plan sans vague et « Tout archiver » ont leur pastille nommée', () => {
  const s = {
    ...loadedStatement(),
    wave: undefined,
    tidyUp: { count: 2, waitsUser: false },
    relays: [{ state: 'paused', question: 'q1', missionId: 'mabsente1', mission: 'Mission absente' }],
    delivered: { list: [{ id: 'mdone0001', title: 'Mission livrée' }, { id: 'mdone0002', title: 'Autre livrée' }], print: 'd2' },
  } as unknown as CooStatement
  const rows = overview(s)
  expect(frame(rows, 'coo-tidy-up')).toEqual({ color: C.amber, chip: '◷ Rangement' })
  expect(frame(rows, 'coo-relay-0')).toEqual({ color: C.amber, chip: '⚠ Réponse' })
  expect(frame(rows, 'coo-plan')).toEqual({ color: C.cyan, chip: '⇉ Plan' })
  expect(frame(rows, 'coo-delivered-all')).toEqual({ color: C.green, chip: '✓ Livrée' })
  // Avec une vague qui attend, le plan garde « ⇉ Prochaine vague ».
  expect(frame(overview(loadedStatement()), 'coo-plan')?.chip).toBe('⇉ Prochaine vague')
  // Une vague sans plan montré (aucun plan, ou un plan illisible, à part en alerte) : pas de « ⇉ Plan ».
  const held = { next: [], key: 'w2', isLaunching: false, report: [{ wave: 'v1', mission: 'Mission en auto', group: 'A', at: 1, state: 'held' }] }
  for (const plan of [undefined, { unread: true }]) {
    const rows2 = overview({ ...loadedStatement(), plan, wave: held } as unknown as CooStatement)
    expect(rows2.find(r => r.key === 'coo-wave-held-0')?.frame?.id).toBe('plan')
    expect(rows2.filter(r => r.frame?.id === 'plan').map(r => nb(r.frame?.chip))).not.toContain('⇉ Plan')
  }
})

test('rien n’attend dans le bloc « Projet » : « Rien pour l’instant. » quand rien ne t’attend nulle part, le renvoi aux couloirs sinon', () => {
  const NOW = 700_000_000
  const calm = { ...newRun('implement', NOW - 60_000, 'Calme'), status: 'active', owner: 'session-C' } as Run
  const asks = { ...calm, id: 'mask00001', auto: { onAt: NOW - 1_000, onBy: 'session-C' }, waiting: [{ id: 'q1', blocks: { phase: 'implement' }, text: 'Oui ?', at: NOW - 1_000 }] } as unknown as Run
  const none = overview(cooStatement({ ...emptyBoard('', 'p'), runs: [calm] }, { now: NOW }))
  expect(none.some(r => r.key === 'coo-waits-none')).toBe(true)
  expect(none.some(r => r.key === 'coo-waits-lanes')).toBe(false)
  const lanes = overview(cooStatement({ ...emptyBoard('', 'p'), runs: [asks] }, { now: NOW }))
  expect(lanes.some(r => r.key === 'coo-waits-none')).toBe(false)
  expect(text(lanes.find(r => r.key === 'coo-waits-lanes'))).toBe('↓ ce qui t’attend est dans les couloirs, plus bas')
  // La ligne vient juste sous l'en-tête « Projet », avant les alertes.
  const keys = lanes.map(r => r.key)
  expect(keys.indexOf('coo-waits-lanes')).toBe(keys.indexOf('coo-project') + 1)
})

test('la tuile « t’attendent » dit « n à archiver » pour les lignes d’archivage', () => {
  const rows = overview({ ...loadedStatement(), waits: [], waiting: [], reports: [], holds: [], delivered: { list: [{ id: 'mdone0001', title: 'Mission livrée' }, { id: 'mdone0002', title: 'Autre' }], print: 'd' } } as unknown as CooStatement)
  const tile = rows.find(r => r.key === 'coo-tiles')!.tiles!.find(t => t.key === 'coo-tile-waits')!
  expect([tile.count, nb(tile.sub)]).toEqual([3, '3 à archiver'])
})

test('une carte de rétro dit « · recommandée » ou « · facultative » à côté de son départ ; une autre carte rien', () => {
  const NOW = 700_000_000
  const closed = { ...newRun('implement', NOW - 60_000, 'Close'), id: 'mclose001', status: 'done' } as Run
  const optional = retroCard(closed, null, NOW)
  // L'avis recommandé : retroCard sur un rapport qui dit ce qui s'est mal passé.
  const wanted = retroCard({ ...closed, id: 'mclose002' } as Run, '# Rapport\n\n## Ce qui s’est mal passé\n\n- le pre-commit a cassé deux fois\n', NOW)
  expect([retroAdviceOf(optional), retroAdviceOf(wanted)]).toEqual(['facultative', 'recommandée'])
  const s = cooStatement({ ...emptyBoard('', 'p'), runs: [] }, { now: NOW, cards: [optional, wanted] })
  const rows = coordinationRows(s, { page: 'overview' })
  expect(text(rows.find(r => r.key === `coo-card-${optional.id}`))).toMatch(/\/retro · facultative/)
  expect(text(rows.find(r => r.key === `coo-card-${wanted.id}`))).toMatch(/\/retro · recommandée/)
  expect(retroAdviceOf({ start: 'grill-with-docs', askMatt: 'recommandée : x' })).toBeNull()
})
