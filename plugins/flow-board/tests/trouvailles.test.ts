import { expect, mock, test } from 'claude-code/testing'

import { applyCommand, applyCreatedTasks, applyReport, blockedCount, emptyBoard, newRun, suggestionsFor } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const CREATE = 'mcp__asana__create_tasks'
const UPDATE = 'mcp__asana__update_tasks'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const LOT = '1200000000000113'
const DRAPEAU = '1200000000000116'
const RECALAGE = '1200000000000117'
const WORKER = '1200000000000118'

/** Le moteur sous le plugin : projet `C:/proj`, éditions qui réussissent, Asana qui rend ses GID. */
const world = (on: any, created: { gid: string; name: string }[] = []) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.root', () => ({ value: 'C:/proj' }))
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value
    return { value: undefined }
  })
  on('tool.call', { tool: 'Write' }, () => ({ result: { filePath: 'x' } }))
  on('tool.call', { tool: UPDATE }, () => ({ result: { data: [] } }))
  // Le résultat tel qu'Asana le rend : du JSON en texte.
  on('tool.call', { tool: CREATE }, () => ({ result: JSON.stringify({ data: created, failed: [], summary: `Created ${created.length} tasks.` }) }))
}

const TASKS = [
  { name: 'Drapeau rouge Other ignoré à la reprise', notes: 'Statut : à faire\nContexte : la reprise rejoue…' },
  { name: 'Recaler les horodatages 2023-2025', notes: 'Statut : à confirmer (porteur)\nContexte : ~287 séances…' },
  { name: 'Relancer le worker du portable', assignee: 'me', notes: 'Statut : à faire' },
]
const CREATED = [
  { gid: DRAPEAU, name: TASKS[0]!.name },
  { gid: RECALAGE, name: TASKS[1]!.name },
  { gid: WORKER, name: TASKS[2]!.name },
]

test('une tâche créée pendant /implement va dans « Trouvé en route », hors du lot', async ($, on) => {
  mock.clock(on, { now: 70_000_000 })
  world(on, CREATED)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: LOT, name: 'Recalcul des résumés', status: 'doing' }] } as any)
  await $.tool.call({ tool: CREATE, tasks: TASKS } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^Trouvé en route$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^3.ouvertes · hors du lot$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Drapeau rouge Other ignoré à la reprise$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^!.attend : à confirmer \(porteur\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^pour toi$/ })).toBeDefined()
    // La progression du lot ne bouge pas.
    expect(await ui.find({ type: 'Text', text: /^0\/1$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Claude fait entrer une trouvaille dans le lot ; Asana la coche ; un retrait l’enlève', async ($, on) => {
  mock.clock(on, { now: 71_000_000 })
  world(on, CREATED)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: LOT, name: 'Recalcul des résumés', status: 'doing' }] } as any)
  await $.tool.call({ tool: CREATE, tasks: TASKS } as any)

  // Le lot dépend du recalage : il y entre, avec son statut et sa raison.
  await $.tool.call({ tool: TOOL, tickets: [{ id: RECALAGE, name: 'Recaler les horodatages' }, { id: LOT, name: 'Recalcul des résumés', blockedBy: [RECALAGE] }] } as any)
  await $.tool.call({ tool: UPDATE, tasks: [{ task: DRAPEAU, completed: true }] } as any)
  await $.tool.call({ tool: TOOL, remove: [WORKER] } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^0\/2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1.faite · hors du lot$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Relancer le worker/ })).toBeUndefined()
  // Le recalage est dans le lot, bloqué pour sa raison ; le recalcul l'attend.
  expect(await ui.find({ key: `pick-${LOT}` })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^!.attend : à confirmer \(porteur\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /après : Recaler les horodatag…$/ })).toBeDefined()
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Text', text: /Entré dans le lot : Recaler les horodatages/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Trouvé en route, fait : Drapeau rouge/ })).toBeDefined()
  await ui.unmount()
})

test('pendant /to-tickets, les tâches créées sont le lot, pas des trouvailles', async ($, on) => {
  mock.clock(on, { now: 72_000_000 })
  world(on, CREATED)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: CREATE, tasks: TASKS } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Trouvé en route$/ })).toBeUndefined()
  await ui.unmount()
})

test('bloqué : la raison s’affiche ; sans raison derrière un ticket ouvert, c’est une attente', async ($, on) => {
  mock.clock(on, { now: 73_000_000 })
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: 'a1', name: 'Fait avant', status: 'done' },
      { id: 'b1', name: 'Plan à valider', status: 'blocked', why: 'ton accord sur le plan', blockedBy: ['a1'] },
      { id: 'c1', name: 'Bloqué sans raison', status: 'blocked', blockedBy: ['a1'] },
      { id: 'd1', name: 'Derrière le plan', status: 'blocked', blockedBy: ['b1'] },
    ],
  } as any)

  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^!.attend : ton accord sur le plan$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^!.raison non précisée$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^⏸.en attente$/ })).toBeDefined()
  await ui.unmount()

  // Débloqué puis rebloqué sans raison : l'ancienne raison ne revient pas.
  await $.tool.call({ tool: TOOL, set: [{ id: 'b1', status: 'doing' }] } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'b1', status: 'blocked' }, { id: 'c1', status: 'blocked', why: 'un accès à la base' }] } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /ton accord sur le plan/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^!.attend : un accès à la base$/ })).toBeDefined()
  await ui.unmount()
})

test('un plan de docs/plans/ est un livrable, rattaché au ticket qu’il cite', async ($, on) => {
  mock.clock(on, { now: 74_000_000 })
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: RECALAGE, name: 'Recaler les horodatages' }] } as any)
  await $.tool.call({
    tool: 'Write',
    file_path: 'C:/proj/docs/plans/2026-10-05_recalage-horodatages.md',
    content: `# Plan : recaler les horodatages\n\nTicket Asana ${RECALAGE}, qui bloque le ticket 4 (${LOT}).\n\n## Résumé\n…`,
  } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Text', text: /^Plan · recalage horodatages$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^pour : Recaler les horodatages$/ })).toBeDefined()
  await ui.unmount()
})

test('une issue GitHub créée pendant /implement est une trouvaille ; pendant /to-tickets, un ticket', () => {
  const issue = (entry: string) => {
    const run = newRun(entry, 1_000)
    const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
    return applyCommand(board, 'gh issue create --title "Pagination sans tri"', true, 'https://github.com/o/r/issues/42\n', 2_000)!.board.runs[0] as Run
  }
  const during = issue('implement')
  expect(during.tickets).toEqual([])
  expect(during.found).toMatchObject([{ id: '#42', name: 'Pagination sans tri', status: 'todo', url: 'https://github.com/o/r/issues/42' }])
  expect(issue('to-tickets').tickets.map(t => t.id)).toEqual(['#42'])
})

test('les trouvailles ouvertes ne retiennent pas la livraison', () => {
  const run = newRun('implement', 1_000)
  const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const done = applyReport(board, { tickets: [{ id: 'a1', name: 'Un', status: 'done' }], complete: true }, 2_000).board
  ;(done.runs[0] as Run).reviewedAt = 2_500
  const out = applyCreatedTasks(done, [{ name: 'Plus tard', notes: 'Statut : à faire' }], { data: [{ gid: DRAPEAU, name: 'Plus tard' }] }, 3_000)
  const after = out!.board.runs[0] as Run
  expect(after.found?.map(f => f.id)).toEqual([DRAPEAU])
  expect(suggestionsFor(after).primary).toBe('compte-rendu')
})

test('la barre ne compte en ambre que les vrais blocages, pas les attentes derrière un ticket ouvert', () => {
  const run = newRun('implement', 1_000)
  const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const out = applyReport(
    board,
    {
      tickets: [
        { id: 'r1', name: 'Recalage', status: 'blocked', why: 'ton accord sur le plan' },
        { id: 'r4', name: 'Recalcul', status: 'blocked', blockedBy: ['r1'] },
        { id: 'r5', name: 'Bloqué sans raison ni attente', status: 'blocked' },
      ],
    },
    2_000,
  ).board
  // Recalage (raison) et le blocage sans raison comptent ; le recalcul attend un ticket : il n'est pas ambre.
  expect(blockedCount(out.runs[0] as Run)).toBe(2)
})
