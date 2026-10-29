import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, newRun } from '../hooks/model.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const KEY = 'board:'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const BANDS = ['terminal', 'desktop'] as const
const WELCOME = /^Aucun.workflow.sélectionné$/

/** Le moteur sous le plugin, avec un stockage que le test remplit avant le démarrage de la discussion. */
const world = (on: any, below: 'engine' | 'other' = 'engine') => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () =>
    below === 'other' ? ({ type: 'Text', props: {}, children: ['AUTRE BANDEAU'] } as any) : ({ type: 'engine', ref: 0 } as const),
  )
  on('session.id', () => ({ value: 'session-B' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  return mem
}

const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/** Un parcours du projet laissé en pause par une discussion précédente. */
const paused = (mem: Record<string, unknown>, title: string, updatedAt: number) => {
  const base = (mem[KEY] as Board | undefined) ?? { ...emptyBoard('', 'projet'), deleted: [] }
  const run = { ...newRun('to-tickets', updatedAt - 1_000, title), status: 'paused' as const, updatedAt }
  mem[KEY] = { ...base, runs: [run, ...base.runs] }
  return run
}

test('sans parcours dans le projet : « Aucun workflow sélectionné » et ▸ Ouvrir, sans reprise', async ($, on) => {
  mock.clock(on, { now: 100_000_000 })
  world(on)
  await start($)
  for (const surface of BANDS) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: WELCOME })).toBeDefined()
    expect((await ui.find({ key: 'band-open' }))?.props).toMatchObject({ label: '▸ Ouvrir' })
    expect(await ui.find({ key: 'band-hide' })).toBeDefined()
    expect(await ui.find({ key: 'band-resume' })).toBeUndefined()
    // L'étiquette d'outil ouvre la ligne : la barre, puis « Flow ».
    expect(await ui.find({ type: 'Text', text: '▍' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^.Flow.$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('un parcours en pause : le plus récent est proposé, et « Reprendre » le reprend', async ($, on) => {
  mock.clock(on, { now: 101_000_000 })
  const mem = world(on)
  paused(mem, 'Ancien lot', 100_000_000)
  paused(mem, 'Tickets bugs SC/VSC', 100_900_000)
  await start($)
  for (const surface of BANDS) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: WELCOME })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Tickets bugs SC/VSC' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Ancien lot' })).toBeUndefined()
    expect(await ui.find({ key: 'band-resume' })).toBeDefined()
    await ui.unmount()
  }
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  await ui.press({ key: 'band-resume' })
  await ui.unmount()

  // Le parcours repris est actif ici : le bandeau normal reprend sa place.
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: WELCOME })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Tickets bugs SC/VSC' })).toBeDefined()
  expect(await ui.find({ key: 'band-resume' })).toBeUndefined()
  await ui.unmount()
})

test('le « x » masque aussi le bandeau d’accueil', async ($, on) => {
  mock.clock(on, { now: 102_000_000 })
  world(on)
  await start($)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'band-hide' })
  await ui.unmount()
  for (const surface of BANDS) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: WELCOME })).toBeUndefined()
    expect(await ui.find({ key: 'band-open' })).toBeUndefined()
    await ui.unmount()
  }
})

test('le bandeau d’accueil s’empile sous un autre bandeau', async ($, on) => {
  mock.clock(on, { now: 103_000_000 })
  world(on, 'other')
  await start($)
  for (const surface of BANDS) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: 'AUTRE BANDEAU' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: WELCOME })).toBeDefined()
    // Pas de trait entre les deux : il débordait sur le desktop.
    expect(await ui.find({ type: 'Text', text: /^─+$/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('dès qu’un parcours démarre, le bandeau normal remplace l’accueil', async ($, on) => {
  mock.clock(on, { now: 104_000_000 })
  world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'x' })
  for (const surface of BANDS) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: WELCOME })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /TDD/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^.Flow.$/ })).toBeDefined()
    await ui.unmount()
  }
})
