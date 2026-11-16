// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { currentPhase } from '../hooks/basics.ts'
import { emptyWaitlist, type Piste, type Waitlist } from '../hooks/pistes.ts'
import { PANE, PLUGIN, TOOL, openCoo, seatOf, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'
import { findAny } from './page-coo.ts'

// Une piste déjà corrigée, vue par une rétro qui relit la liste d'attente : son item part « dropped » dès son premier
// envoi, et la rétro la dépose puis l'écarte dans le même appel « pistes ». Le COO applique les deux : la liste garde
// la piste écartée, avec sa raison, son auteur et sa date ; elle ne paraît ni dans « Pistes en attente » ni parmi
// les pistes que le relevé du COO donne à cocher.

const T0 = 720_000_000
/** Le nom des fichiers du projet de ces tests (racine vide) sur ce poste, comme `coordinationName`. */
const PROJECT = 'sans-projet-811c9dc5'
const REASON = 'déjà corrigée par 3cf7272, Pistes de rétro déjà corrigées'

const ITEMS = [
  { id: 'r1', label: 'Hooks : relire le siège après un sommeil', status: 'todo' },
  { id: 'r2', label: 'Docs : borner les entrées du relevé', status: 'dropped' },
]

const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
/** La liste d'attente des rétros telle que le mod l'a écrite : au fichier du poste (chemin absolu), sinon dans le stockage. */
const listOf = (w: World): Waitlist => {
  const path = Object.keys(w.files).find(p => p.endsWith(`/flow-board/pistes/${PROJECT}.json`))
  return (path !== undefined ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist
}

/** La rétro née ici avec un COO (son étape « attente »), ses pistes présentées, la piste déjà corrigée en « dropped » dès ce premier envoi. */
const retroWithFixedPiste = async ($: any, clock: any, w: World): Promise<string> => {
  w.ids.now = 'session-R'
  writeBoard(w, b => ({ ...b, coo: { ...seatOf('session-Z', T0 - 120_000), releasedAt: T0 - 60_000 } }))
  const list: Waitlist = { ...emptyWaitlist(''), pistes: [] }
  w.files[`flow-board/pistes/${PROJECT}.json`] = JSON.stringify(list)
  w.mem['coo-pistes:'] = list
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  await call($, { title: 'Rétrospective · Mission de B', items: ITEMS, step: 'attente' })
  await settle(clock, 2)
  return stored(w).activeId!
}

test('une piste déjà corrigée : déposée puis écartée dans le même appel par la rétro ; le COO garde la piste écartée, avec sa raison, son auteur et sa date, hors de « Pistes en attente »', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await retroWithFixedPiste($, clock, w)
  expect(currentPhase(stored(w).runs.find(r => r.id === runId)!).items.map(i => [i.id, i.status])).toEqual([['r1', 'todo'], ['r2', 'dropped']])
  const deposit = await call($, {
    pistes: [
      { op: 'add', piste: `${runId}/r1`, text: 'Relire le siège après un sommeil', files: ['hooks/seat.ts'] },
      { op: 'add', piste: `${runId}/r2`, text: 'Borner les entrées du relevé', files: ['hooks/coo.ts'] },
      { op: 'drop', piste: `${runId}/r2`, reason: REASON },
    ],
  })
  expect(deposit).toMatch(/Deposited for the COO's dashboard: 3 change/)
  expect(deposit).not.toMatch(/NOT recorded/)
  // La rétro mise de côté, le COO ouvert dans la même discussion applique sa boîte, dans l'ordre du dépôt.
  await $.command.run({ command: 'flow', args: 'pause' } as any)
  await openCoo($, clock)
  await settle(clock, 12)
  const pistes = listOf(w).pistes as Piste[]
  const fixed = pistes.find(p => p.id === `${runId}/r2`)!
  expect(fixed).toMatchObject({ state: 'dropped', reason: REASON, stateBy: runId, by: runId, text: 'Borner les entrées du relevé' })
  expect(typeof fixed.stateAt).toBe('number')
  expect(pistes.find(p => p.id === `${runId}/r1`)).toMatchObject({ state: 'pending' })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  // Ni sa ligne ni sa case : une piste écartée n'a jamais de case, seule l'absence de sa ligne prouve qu'elle n'est pas montrée.
  expect(await findAny(pane, { key: `coo-piste-${runId}/r1` })).toBeDefined()
  expect(await findAny(pane, { key: `coo-piste-tick-${runId}/r1` })).toBeDefined()
  expect(await findAny(pane, { key: `coo-piste-${runId}/r2` })).toBeUndefined()
  expect(await findAny(pane, { key: `coo-piste-tick-${runId}/r2` })).toBeUndefined()
  await pane.unmount()
})

test('l’item « dropped » d’une piste déjà corrigée n’attend aucune coche dans le relevé du COO ; l’item « todo » de la même rétro, si', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await retroWithFixedPiste($, clock, w)
  await $.command.run({ command: 'flow', args: 'pause' } as any)
  const opening = await openCoo($, clock)
  await settle(clock, 6)
  const turn = `${opening}\n${JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))}`
  expect(turn).toContain('Hooks : relire le siège après un sommeil')
  expect(turn).not.toContain('Docs : borner les entrées du relevé')
})
