import { expect, mock, test } from 'claude-code/testing'

import { closingProcedure } from '../hooks/closing.ts'
import { applyReport, emptyBoard, newRun, restoreDelegate } from '../hooks/model.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const START = 'mcp__ccd_session__start_session'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const LOT = {
  tickets: [
    { id: 'a1', name: 'Code', files: ['src/a.ts'] },
    { id: 'e1', name: 'Enquête', files: ['travail/sql'] },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'E', name: 'Enquêtes', tickets: ['e1'] },
  ],
}

const world = (on: any, session = 'main') => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: session }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('tool.call', { tool: START }, (_$: unknown, e: { title: string }) => ({
    result: { text: `Started session local_${/Groupe (\w+)/.exec(e.title)?.[1] ?? 'x'}42.` },
  }))
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return { mem, filled }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/**
 * Un disque vide où rien ne s'écrit, pour un test qui relaie sans simuler de disque : le relais (un
 * fichier par session liée) passe alors par `$.store`, même quand le dossier du mod dit où est ~/.claude.
 */
const emptyDisk = (on: any) => {
  on('fs.exists', () => ({ value: false }) as any)
  on('fs.write', () => {
    throw new Error('EACCES')
  })
}

// Après /reload-plugins, la discussion avait tout renvoyé par précaution alors que l'état était là.
test('après un rechargement, la première réponse de l’outil dit l’état retrouvé, une fois', async ($, on) => {
  mock.clock(on, { now: 90_000_000 })
  world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  // Le mod se recharge : la session redémarre ses hooks, le tableau de bord est encore là.
  await start($)
  const first = JSON.stringify(await $.tool.call({ tool: TOOL, note: 'reprise' } as any))
  expect(first).toContain('State found after a plugin reload: 2 tickets, 2 groups, phase Tickets; nothing to send again')
  const second = JSON.stringify(await $.tool.call({ tool: TOOL, note: 'encore' } as any))
  expect(second).not.toContain('State found after a plugin reload')
})

// Le mode délégué se perdait au rechargement du mod dans la session liée.
test('le mode délégué d’une session liée est gardé par session et revient au chargement', async ($, on) => {
  mock.clock(on, { now: 91_000_000 })
  const { mem } = world(on, 'linked')
  await start($)
  await $.tool.call({ tool: TOOL, delegate: 'run-1', group: 'E', main: '[e5eb08]' } as any)
  expect(mem['delegate:linked']).toMatchObject({ run: 'run-1', group: 'E', main: '[e5eb08]' })
  // Au chargement d'un board sans délégation, la délégation gardée revient ; une autre forme est ignorée.
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 'main' }
  const loaded: Board = { ...emptyBoard('', 'p'), session: 'linked', deleted: [], runs: [run], activeId: null }
  expect(restoreDelegate(loaded, mem['delegate:linked']).delegate).toMatchObject({ run: 'run-1', group: 'E' })
  expect(restoreDelegate(loaded, { foo: 1 }).delegate).toBeUndefined()
  expect(restoreDelegate(loaded, undefined)).toBe(loaded)
  // Bornée : ni ancienne de plus de trois jours, ni sur un parcours fini.
  expect(restoreDelegate(loaded, { run: 'run-1', at: 1_000 }, 1_000 + 4 * 24 * 3_600_000).delegate).toBeUndefined()
  const finished = { ...loaded, runs: [{ ...run, id: 'run-1', status: 'done' as const }] }
  expect(restoreDelegate(finished, { run: 'run-1', at: 1_000 }, 2_000).delegate).toBeUndefined()
})

test('une session liée qui redémarre retrouve sa délégation par le vrai chargement, et le rechargement la rappelle', async ($, on) => {
  emptyDisk(on)
  mock.clock(on, { now: 91_500_000 })
  const { mem } = world(on, 'linked')
  mem['delegate:linked'] = { run: 'run-1', at: 91_000_000, group: 'E', main: '[e5eb08]' }
  await start($)
  // Le board vient du stockage (rien en mémoire) : la délégation gardée revient, ses appels partent au relais.
  const relayed = JSON.stringify(await $.tool.call({ tool: TOOL, set: [{ id: 'e1', status: 'doing' }] } as any))
  expect(relayed).toContain("Relayed to the main discussion's dashboard")
  // Puis le mod se recharge : la première réponse dit la délégation retrouvée.
  await start($)
  const after = JSON.stringify(await $.tool.call({ tool: TOOL, note: 'reprise' } as any))
  expect(after).toContain('State found after a plugin reload: delegate mode kept for the workflow')
  expect(after).toContain('group E')
})

test('une discussion sans délégation n’écrit rien pour elle dans le magasin', async ($, on) => {
  mock.clock(on, { now: 91_800_000 })
  const { mem } = world(on, 'plain')
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  expect('delegate:plain' in mem).toBe(false)
})

test('un groupe confié est « en cours » dès que l’id de sa session est relevé, au panneau comme au bandeau', async ($, on) => {
  const clock = mock.clock(on, { now: 92_000_000 })
  const { filled } = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  expect(filled.at(-1)).not.toContain('notify_when_idle')
  await $.tool.call({ tool: START, title: 'Boutique › Groupe E · Enquêtes' } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^↗.en cours · session liée$/ })).toBeDefined()
  await ui.unmount()
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /↗E.0\/1/ })).toBeDefined()
  expect((await band.find({ key: 'band-open' }))?.props).toMatchObject({ label: '▸ Ouvrir' })
  await band.unmount()
})

test('un groupe rendu par sa session liée propose de fermer sa session et son worktree, sans rien forcer', async ($, on) => {
  const clock = mock.clock(on, { now: 93_000_000 })
  const { mem, filled } = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  await $.tool.call({ tool: START, title: 'Boutique › Groupe E · Enquêtes' } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'e1', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['E'] } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  // Rendu sans revue : sa revue se fait dans sa session et son worktree, pas de fermeture avant.
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'review-linked-E' })).toBeDefined()
  expect(await ui.find({ key: 'close-linked-E' })).toBeUndefined()
  await ui.unmount()
  await $.tool.call({ tool: TOOL, reviewed: ['E'], security: { group: 'E', advised: false, why: 'requêtes seules' } } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  // Le groupe fait ici n'a pas de session à fermer ; E ne montre aucun bouton tant que rien n'est tenté.
  expect(await ui.find({ key: 'close-linked-A' })).toBeUndefined()
  expect(await ui.find({ key: 'close-linked-E' })).toBeUndefined()
  await ui.unmount()
  // La fermeture s'arrête : le bouton de repli la relance.
  await $.tool.call({ tool: TOOL, closed: [{ group: 'E', state: 'stopped', why: '.env ignoré' }] } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'close-linked-E' })
  await ui.unmount()
  const text = filled.at(-1)!
  // Le texte vient de la procédure partagée (celle de la réponse de l'outil), pour la session relevée.
  const run = (mem['board:'] as Board).runs.find(r => r.title === 'Boutique')!
  expect(text.startsWith(closingProcedure({ run, target: { kind: 'group', id: 'E', name: 'Enquêtes' }, isRepo: true, session: 'local_E42' }))).toBe(true)
  expect(text).toContain('Then send {"closed": [{"group": "E", "state": "closed"')
  expect(text).toContain('Vérifie d’abord, n’arrête et ne retire qu’ensuite')
  // Une session de l'app (id local_…) : archivée par l'outil de l'app, sinon le geste écrit à la personne.
  expect(text).toContain('c’est une session de l’app Desktop : archive-la par l’outil de session de l’app')
  expect(text).toContain('à défaut, l’un des noms connus : worktree-groupe-boutique-E (lancée par le CLI), groupe-boutique-E ou claude/groupe-boutique-E-<suffixe> (lancée par l’app, avec ou sans branch_name), groupe-E pour un groupe lancé avant la 0.59.0')
  // Plus le texte d'avant, qui disait « jamais claude rm, qui l'efface ».
  expect(text).not.toContain("qui l'efface")
  expect(text).not.toContain('--force')
  // Relancée : la réponse suivante de l'outil la repropose.
  expect(JSON.stringify(await $.tool.call({ tool: TOOL, note: 'point' } as any))).toContain('Close now: group E')
})

test('la délégation gardée ne revient pas sur un board qui en a déjà une', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 'main' }
  const board = applyReport({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: null }, { delegate: run.id, group: 'A' }, 2_000).board
  expect(restoreDelegate(board, { run: 'autre', at: 1 }).delegate?.run).toBe(run.id)
})
