// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { archiveMarkOf, archiveRun, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// Un archivage fait ailleurs (le COO) sur la mission close que sa discussion montre encore n'est pas défait par
// cette discussion. Invariant : « un archivage fait ailleurs sur une mission close n'est jamais
// défait par la copie de sa discussion, tandis qu'une mission en cours n'est jamais archivée sous elle. »

const T0 = 930_000_000
const MIN = 60_000

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')
const pane = (key: string) => ({ plugin: PLUGIN, surface: 'desktop' as const, ...PANE, key })

/** Une autre mission du projet, close et née ailleurs : la discussion peut l'archiver par « ▣ Archiver ». */
const other = (): Run => ({ ...newRun('prototype', T0 - 10 * MIN, 'Autre mission'), status: 'done', finishedAt: T0 - 5 * MIN, updatedAt: T0 - 5 * MIN })

/** La discussion A ouvre une mission d'une seule phase et la finit : close, elle reste la mission montrée. */
const closedHere = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const autre = other()
  writeBoard(w, b => ({ ...b, runs: [autre] }))
  await start($)
  await settle(clock, 2)
  await $.skill.prompt({ skill: 'mattpocock-skills:prototype', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Mission close' } as any)
  // Chaque phase finie, jusqu'à la dernière : la mission close reste celle que la discussion montre.
  for (let i = 0; i < 6 && stored(w)?.runs.find(r => r.title === 'Mission close')?.status !== 'done'; i++) {
    await $.tool.call({ tool: TOOL, complete: true } as any)
    await settle(clock, 1)
  }
  const run = stored(w).runs.find(r => r.title === 'Mission close')!
  return { clock, w, run, autre }
}

/** Ce qu'écrit le COO : la mission archivée par `archiveRun` (ouverte nulle part chez lui), plus récente ; `asDone` : sa copie relue close. */
const archiveElsewhere = (w: ReturnType<typeof world>, id: string, at: number, asDone = false) =>
  writeBoard(w, b => {
    const runs = b.runs.map(r => (r.id === id && asDone ? ({ ...r, status: 'done', owner: undefined } as Run) : r))
    const coo: Board = { ...b, runs, session: 'coo', activeId: null }
    // Le chemin de « ✓ Archiver » : la marque « clic » part avec la date.
    const out = archiveRun(coo, id, at, undefined, 'clic')!
    return { ...out.board, session: b.session, activeId: b.activeId ?? null }
  })

test('monde du COO · une mission close encore montrée dans sa discussion, archivée chez le COO, reste archivée après une écriture de sa discussion', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, run, autre } = await closedHere($, on)
  expect(run.status).toBe('done')
  const before = await $.ui.mount(pane('avant'))
  expect(await texts(before)).toContain('Mission close')
  await before.unmount()
  await clock.advance(MIN)
  archiveElsewhere(w, run.id, T0 + MIN)
  await clock.advance(1_000)
  // La discussion écrit ensuite, avant même sa relecture : « ▣ Archiver » sur une autre mission (une écriture
  // qui ne vise pas la mission close qu'elle montre).
  const view = await $.ui.mount(pane('clic'))
  await view.press({ key: 'tab-history' })
  await view.press({ key: `archive-${autre.id}` })
  await view.unmount()
  await settle(clock, 8)
  const after = stored(w)
  expect(after.runs.find(x => x.id === autre.id)!.archivedAt).toBeDefined()
  const mine = after.runs.find(x => x.id === run.id)!
  expect(mine.archivedAt).toBe(T0 + MIN)
  expect(archiveMarkOf(mine)).toBe('clic')
  expect(mine.status).toBe('done')
  // La date de la mission close n'a pas bougé : l'écriture visait l'autre mission.
  expect(mine.updatedAt).toBe(T0 + MIN)
  // La discussion ne la montre plus : son panneau ne la nomme plus (une mission archivée est cachée).
  const shown = await $.ui.mount(pane('apres'))
  expect(await texts(shown)).not.toContain('Mission close')
  await shown.unmount()
})

test('monde du COO · une relecture du fichier ne change pas la date de la mission close montrée, ni ne la désarchive', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, run } = await closedHere($, on)
  await clock.advance(MIN)
  archiveElsewhere(w, run.id, T0 + MIN)
  // Plusieurs relectures (toutes les 5 s), sans geste : la discussion reprend la copie archivée.
  await settle(clock, 20)
  const shown = await $.ui.mount(pane('relue'))
  expect(await texts(shown)).not.toContain('Mission close')
  await shown.unmount()
  const mine = stored(w).runs.find(x => x.id === run.id)!
  expect(mine.archivedAt).toBe(T0 + MIN)
  expect(mine.updatedAt).toBe(T0 + MIN)
})

test('monde du COO · une autre mission ouverte dans la discussion ne change pas la date de la mission close archivée ailleurs', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, run } = await closedHere($, on)
  await clock.advance(MIN)
  archiveElsewhere(w, run.id, T0 + MIN)
  await clock.advance(1_000)
  await $.skill.prompt({ skill: 'mattpocock-skills:prototype', text: 'y' })
  await $.tool.call({ tool: TOOL, title: 'Mission suivante' } as any)
  await settle(clock, 8)
  const after = stored(w)
  const mine = after.runs.find(x => x.id === run.id)!
  expect(mine.archivedAt).toBe(T0 + MIN)
  expect(mine.updatedAt).toBe(T0 + MIN)
  expect(after.runs.find(x => x.title === 'Mission suivante')).toBeDefined()
})

test('monde du COO · une mission en cours dans sa discussion, archivée ailleurs entre-temps, garde la main : pas archivée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await settle(clock, 2)
  await $.skill.prompt({ skill: 'mattpocock-skills:prototype', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Mission au travail' } as any)
  await settle(clock, 2)
  const run = stored(w).runs.find(r => r.title === 'Mission au travail')!
  expect(run.status).toBe('active')
  await clock.advance(MIN)
  // La copie relue close et archivée, plus récente : la relecture ne retire pas la mission au travail.
  archiveElsewhere(w, run.id, T0 + MIN, true)
  await settle(clock, 12)
  const view = await $.ui.mount(pane('travail'))
  expect(await texts(view)).toContain('Mission au travail')
  await view.unmount()
  const r = await $.tool.call({ tool: TOOL, note: 'toujours au travail' } as any)
  expect(String(r.result)).not.toMatch(/No mission is running/)
  await settle(clock, 8)
  const mine = stored(w).runs.find(x => x.id === run.id)!
  expect(mine.archivedAt).toBeUndefined()
  expect(mine.status).toBe('active')
})
