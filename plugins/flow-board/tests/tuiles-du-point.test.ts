// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { C } from '../hooks/catalog.ts'
import { cooStatement, type CooStatement } from '../hooks/coo.ts'
import { coordinationRows, type CooRow, type CooTile } from '../hooks/coo-view.tsx'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { tileNumberSvg } from '../hooks/svg.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, openCoo, settle, start, world, writeBoard } from './monde-coordination.ts'
import { loadedStatement } from './vue-chargee.ts'

// L'encadré « Le point » montre quatre tuiles de chiffres (t'attendent, missions, workers, au départ), à droite de sa
// pastille le nombre de missions en cours, puis la prochaine étape du projet et la surveillance de nuit.

const nb = (t: string | undefined): string => (t ?? '').replace(/ /g, ' ')
const tilesOf = (rows: readonly CooRow[]): CooTile[] => rows.find(r => r.key === 'coo-tiles')?.tiles ?? []
const tile = (rows: readonly CooRow[], key: string): CooTile => {
  const found = tilesOf(rows).find(t => t.key === key)
  if (!found) throw new Error(`tuile ${key} absente`)
  return found
}

test('quatre tuiles, dans l’ordre : t’attendent, missions, workers, au départ ; leurs comptes et sous-titres sur le relevé chargé', () => {
  const rows = coordinationRows(loadedStatement(), { page: 'overview' })
  expect(tilesOf(rows).map(t => t.label)).toEqual(['t’attendent', 'missions', 'workers', 'au départ'])
  const waits = tile(rows, 'coo-tile-waits')
  // 2 questions, 1 mission qui attend, 1 rapport, 1 livrée (sa carte de rétro la montre : pas de ligne livrée à part, mais « Tout archiver » non plus), 1 retenue à forcer.
  expect(nb(waits.sub)).toBe('2 questions · 1 mission · 1 rapport · 1 retenue')
  expect(waits.count).toBe(5)
  expect([waits.color, waits.mark]).toEqual([C.amber, 'pulse'])
  const missions = tile(rows, 'coo-tile-missions')
  expect([missions.count, nb(missions.sub)]).toEqual([4, '1 en auto'])
  expect(missions.mark).toBe('pulse')
  expect([tile(rows, 'coo-tile-workers').count, tile(rows, 'coo-tile-workers').sub, tile(rows, 'coo-tile-workers').mark]).toEqual([0, 'aucun', undefined])
  // Les cartes montrées : la rétro, la xhigh, celle en lancement et celle d'avant.
  expect([tile(rows, 'coo-tile-cards').count, tile(rows, 'coo-tile-cards').sub]).toEqual([4, 'cartes à lancer'])
})

test('le chiffre de la tuile « t’attendent » est toujours celui de la pastille « Vue d’ensemble »', () => {
  const base = loadedStatement()
  for (const s of [base, { ...base, waits: [], waiting: [], reports: [], holds: [], delivered: undefined }, { ...base, reports: [...(base.reports ?? []), { ...base.reports![0]!, missionId: 'mreport02' }] }]) {
    const rows = coordinationRows(s as CooStatement, { page: 'overview' })
    const pill = rows[0]!.pills!.find(p => p.page === 'overview')!
    const waits = tile(rows, 'coo-tile-waits')
    expect(waits.count).toBe(pill.count!)
    // Les genres du sous-titre font le chiffre : aucun genre compté sans être nommé.
    const named = [...nb(waits.sub).matchAll(/(\d+) [a-zé]+/g)].reduce((n, m) => n + Number(m[1]), 0)
    expect(named).toBe(waits.count)
  }
})

test('à zéro, la tuile « t’attendent » est grise, sans point, et dit « rien pour l’instant » ; une liste des cartes illisible donne « — » au départ', () => {
  const s = cooStatement(emptyBoard('', 'p'), { now: 5 })
  const rows = coordinationRows(s, { page: 'overview' })
  const waits = tile(rows, 'coo-tile-waits')
  expect([waits.count, waits.color, waits.mark, nb(waits.sub)]).toEqual([0, C.gray, undefined, 'rien pour l’instant'])
  expect(tile(rows, 'coo-tile-missions').mark).toBeUndefined()
  const unread = coordinationRows({ ...s, cardsUnread: { path: '/p/cartes.json' } } as CooStatement, { page: 'overview' })
  expect(tile(unread, 'coo-tile-cards').count).toBeNull()
})

test('les workers confiés et pas rendus : un arc qui tourne, « au travail » ; à droite de la pastille, le nombre en cours', () => {
  const s = loadedStatement()
  const busy = { ...s, missions: s.missions.map((m, i) => (i === 0 ? { ...m, workers: [{ group: 'A', done: 1, total: 3, state: 'working' as const }, { group: 'B', done: 2, total: 2, state: 'returned' as const }] } : m)) }
  const rows = coordinationRows(busy, { page: 'overview' })
  expect([tile(rows, 'coo-tile-workers').count, tile(rows, 'coo-tile-workers').sub, tile(rows, 'coo-tile-workers').mark]).toEqual([1, 'au travail', 'spin'])
  // En cours : les couloirs « en cours » ou « worker au travail » (la mission en manuel a le signal « t'attend ») : l'auto et la retenue.
  const head = rows.find(r => r.key === 'coo-point')!
  expect(nb(head.aside?.[1]?.text)).toBe('2 en cours')
  expect(head.aside?.[0]?.mark).toBe('pulse')
})

test('sous les tuiles, la prochaine étape du projet puis la surveillance de nuit ; les deux premières phrases du point ne sont plus montrées', () => {
  const rows = coordinationRows(loadedStatement(), { page: 'overview' })
  const keys = rows.map(r => r.key)
  expect(keys.slice(keys.indexOf('coo-point'), keys.indexOf('coo-night') + 1)).toEqual(['coo-point', 'coo-tiles', 'coo-point-2', 'coo-night'])
  expect(rows.find(r => r.key === 'coo-point-2')?.parts[0]?.text).toMatch(/^Prochaine étape du projet/)
})

test('tileNumberSvg : un grand chiffre à la couleur de la tuile, « — » non mesuré, source sous la limite du moteur', () => {
  const drawn = tileNumberSvg(12, C.amber)
  expect(drawn.source).toContain('>12</text>')
  expect(drawn.source).toContain(C.amber)
  expect(tileNumberSvg(null, C.teal).source).toContain('>—</text>')
  expect(tileNumberSvg(123456, C.teal).source.length).toBeLessThan(4096)
})

// ─── Le panneau monté ─────────────────────────────────────────────────────

const NOW = 650_000_000
const missions = (): Run[] => [
  { ...newRun('implement', NOW - 60_000, 'Mission en auto'), status: 'active', owner: 'session-M', updatedAt: NOW - 1_000, auto: { onAt: NOW - 30_000, onBy: 'session-M' }, waiting: [{ id: 'q1', blocks: { phase: 'implement' }, text: 'Garder ?', at: NOW - 5_000 }] } as unknown as Run,
  { ...newRun('implement', NOW - 60_000, 'Mission en manuel'), status: 'active', owner: 'session-B', updatedAt: NOW - 1_000 } as Run,
]

const mounted = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: missions() }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
}

test('quatre tuiles sur une rangée à 92 cellules, deux rangées de deux à 60 ; hors du terminal le chiffre est un dessin avec son texte de remplacement, au terminal un texte gras coloré', { timeoutMs: 30000 }, async ($, on) => {
  await mounted($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [cells, rows] of [
      [92, 1],
      [60, 2],
    ] as const) {
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE, props: { ...PANE.props, bodyColumns: cells } })
      await pane.press({ key: 'coo-page-overview' })
      expect(await pane.find({ key: `coo-tiles-row-${rows - 1}` }), `${surface} ${cells}`).toBeDefined()
      expect(await pane.find({ key: `coo-tiles-row-${rows}` }), `${surface} ${cells}`).toBeUndefined()
      expect((await pane.find({ key: 'coo-tile-waits' }))?.props.borderColor, `${surface} ${cells}`).toBe(C.amber)
      if (surface === 'desktop') {
        const alts = ((await pane.findAll({ type: 'Svg' })) as any[]).map(s => nb(String(s.props.alt)))
        expect(alts, `${cells}`).toContain('1 t’attendent')
        expect(alts, `${cells}`).toContain('2 missions')
      } else {
        expect(await pane.find({ type: 'Svg' }), `${cells}`).toBeUndefined()
        const texts = ((await pane.findAll({ type: 'Text' })) as any[]).filter(t => t.props.bold && t.props.color === C.amber).map(t => String(t.props.text ?? t.text ?? ''))
        expect(texts, `${cells}`).toContain('1')
        // Le point qui pulse : ● ou ○ au terminal.
        const dots = ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).filter(t => t === '●' || t === '○')
        expect(dots.length, `${cells}`).toBeGreaterThan(0)
      }
      await pane.unmount()
    }
  }
})
