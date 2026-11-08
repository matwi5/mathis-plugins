// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, newRun } from '../hooks/model.ts'
import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'
import type { Board, Run } from '../types'

// La vue « Coordination » du COO et le relevé d'état que lit son Claude : l'onglet et le bandeau dans
// la seule discussion qui tient le siège ; le relevé à chaque tour, et au chargement de /flow-board:coo.

const PLUGIN = 'flow-board'
const KEY = 'board:'
const COO = 'flow-board:coo'
const NOW = 120_000_000
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const SURFACES = ['terminal', 'desktop'] as const
const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')

/** Le moteur sous le plugin : le fichier des missions en mémoire (fichier commun ou `$.store`), les messages vus par Claude. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const disk: { board?: string; isUsed: boolean } = { isUsed: false }
  const sent: { text: string; context?: readonly string[] }[] = []
  on('session.end', () => ({ sessionId: 'session-A' }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    sent.push(e)
    return { text: e.text }
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isBoardFile(e.path) && disk.board !== undefined }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!isBoardFile(e.path) || disk.board === undefined) throw new Error(`ENOENT ${e.path}`)
    disk.isUsed = true
    return { value: disk.board } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      disk.board = e.text
    }
    return { value: undefined } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('turn.step', stoppedStep(stepUsage('claude-opus-5-5')))
  return { mem, disk, sent }
}
type World = ReturnType<typeof world>

const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
const openCoo = async ($: any, clock: { advance: (ms: number) => Promise<void> }): Promise<string> => {
  const loading = $.skill.prompt({ skill: COO, text: 'consignes du COO' })
  await settle(clock, 4)
  return (await loading).text
}

/** Deux missions d'autres discussions : une en auto avec une question bloquante, une en manuel. */
const MISSIONS: Run[] = [
  {
    ...newRun('implement', NOW - 60_000, 'Mode auto du parcours Flow'),
    status: 'active',
    owner: 'session-M',
    updatedAt: NOW - 1_000,
    auto: { onAt: NOW - 30_000, onBy: 'session-M' },
    waiting: [{ id: 'q3', blocks: { phase: 'implement' }, text: 'Garder le refus ou le lever ?', at: NOW - 10_000 }],
    tickets: [
      { id: '1', name: 'Un', status: 'done' },
      { id: '2', name: 'Deux', status: 'todo' },
    ],
  } as unknown as Run,
  { ...newRun('grill-with-docs', NOW - 90_000, 'Idée floue'), status: 'paused', updatedAt: NOW - 2_000 } as Run,
]
const seed = (w: Pick<World, 'mem' | 'disk'>) => {
  const board: Board = { ...emptyBoard('', 'projet'), runs: MISSIONS, deleted: [] }
  w.mem[KEY] = board
  w.disk.board = JSON.stringify(board)
}

test('la discussion qui tient le siège montre l’onglet Coordination : le point, ce qui t’attend, les missions', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  seed(w)
  await start($)
  await openCoo($, clock)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect((await pane.find({ key: 'tab-coord' }))?.props.label).toMatch(/^▸ Coordination$/)
    expect(await pane.find({ key: 'tab-flow' })).toBeUndefined()
    for (const text of [/^Le point$/, /^1 mission en cours, 1 en pause, 1 en auto\.$/, /^Ce qui t’attend · 1$/, /« Garder le refus ou le lever \? »/, /^Missions · 2$/, /^Mode auto du parcours Flow$/, /^Idée floue$/, /attend 1 question/]) {
      expect(await pane.find({ type: 'Text', text }), `${surface} ${text}`).toBeDefined()
    }
    // Le terminal ne dessine que du texte : aucun Svg.
    expect(await pane.find({ type: 'Svg' })).toBeUndefined()
    await pane.unmount()
  }
})

test('le bandeau du COO dit « ◆ COO · N missions · N t’attend »', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  seed(w)
  await start($)
  await openCoo($, clock)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const texts = (await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '').replace(/\u00a0/g, ' '))
    expect(texts).toContain('◆ COO')
    expect(texts).toContain('2 missions')
    expect(texts).toContain('1 t’attend')
    expect(await band.find({ type: 'Svg' })).toBeUndefined()
    await band.unmount()
  }
})

test('hors de la discussion du COO, pas d’onglet Coordination', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  seed(w)
  await start($)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    // Contrôle positif : le panneau d'ici se dessine, avec ses onglets.
    expect(await pane.find({ key: 'tab-history' })).toBeDefined()
    expect(await pane.find({ key: 'tab-coord' })).toBeUndefined()
    await pane.unmount()
  }
})

test('le Claude du COO reçoit le relevé d’état au chargement du skill et à chaque tour', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  seed(w)
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/COO statement, computed by flow-board/)
  expect(opening).toMatch(/« Mode auto du parcours Flow »: in progress, phase .+, mode auto, tickets 1\/2 done/)
  await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any)
  const context = w.sent.at(-1)?.context ?? []
  expect(context.some(c => /COO seat \(flow-board\): held by this discussion/.test(c))).toBe(true)
  const statement = context.find(c => /COO statement/.test(c)) ?? ''
  expect(statement).toMatch(/Missions not archived \(2\)/)
  expect(statement).toMatch(/question « q3 »: « Garder le refus ou le lever \? »/)
  expect(statement).toMatch(/BRIEF\.md at the project root: unknown/)
})

test('l’effort actif du COO, relevé sur sa dernière requête, entre dans le relevé ; inconnu avant, Claude le demande une fois', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  seed(w)
  await start($)
  expect(await openCoo($, clock)).toMatch(/Effort chosen in this discussion: unknown \(ask the user once\)/)
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  await settle(clock, 2)
  await $.prompt.submit({ text: 'et l’effort ?', origin: { kind: 'composer' } } as any)
  const statement = (w.sent.at(-1)?.context ?? []).find(c => /COO statement/.test(c)) ?? ''
  expect(statement).toMatch(/Effort chosen in this discussion: xhigh\./)
  // Un high choisi part en medium : le relevé dit les deux.
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await settle(clock, 2)
  await $.prompt.submit({ text: 'et maintenant ?', origin: { kind: 'composer' } } as any)
  const after = (w.sent.at(-1)?.context ?? []).find(c => /COO statement/.test(c)) ?? ''
  expect(after).toMatch(/Effort chosen in this discussion: high; the mod sends its requests in medium \(COO rule\)\./)
})

test('le relevé du COO relit l’accord d’archivage d’office à chaque tour : éteint, puis allumé depuis sa date', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  seed(w)
  await start($)
  expect(await openCoo($, clock)).toMatch(/Archivage d’office : éteint\. .*\/flow archive \(no argument\)/)
  // L'accord donné ailleurs (une autre discussion, l'onglet Commandes) : le tour suivant le dit.
  w.mem['archive-consent'] = { at: NOW - 1_000 }
  await $.prompt.submit({ text: 'et l’archivage ?', origin: { kind: 'composer' } } as any)
  const statement = (w.sent.at(-1)?.context ?? []).find(c => /COO statement/.test(c)) ?? ''
  expect(statement).toMatch(/Archivage d’office : allumé depuis le 1970-01-02\./)
})
