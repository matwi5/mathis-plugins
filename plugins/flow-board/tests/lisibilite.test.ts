import { expect, mock, test } from 'claude-code/testing'

import { applyCommand, applyReport, emptyBoard, newRun, upgradeRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const

const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
}

const boardOf = (run: Run): Board => ({ ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id })

test('une Implémentation close trop tôt est rouverte au chargement ; les compteurs de revue devinés sont effacés', () => {
  const run = newRun('implement', 1_000)
  const reported = applyReport(boardOf(run), { tickets: [{ id: 'a1', name: 'Fait', status: 'done' }, { id: 'b1', name: 'Reste' }] }, 2_000).board.runs[0] as Run
  const closed: Run = {
    ...reported,
    phases: reported.phases.map((p, i) =>
      i === 0 ? { ...p, status: 'done' as const, finishedAt: 3_000, stats: { ...p.stats, standards: 6, spec: 2 }, steps: p.steps.map(s => ({ ...s, status: 'done' as const })) } : p,
    ),
  }
  const repaired = upgradeRun(closed)
  expect(repaired.phases[0]!.status).toBe('active')
  expect(repaired.phases[0]!.steps.every(s => s.status === 'pending')).toBe(true)
  expect(repaired.phases[0]!.stats.standards).toBe(-1)
  expect(upgradeRun(repaired)).toBe(repaired)
  // Tous les tickets faits : la clôture est juste, rien ne bouge.
  const allDone: Run = { ...closed, tickets: closed.tickets.map(t => ({ ...t, status: 'done' as const })), phases: closed.phases.map((p, i) => (i === 0 ? { ...p, stats: { ...p.stats, standards: -1, spec: -1 } } : p)) }
  expect(upgradeRun(allDone)).toBe(allDone)
})

test('un commit après la clôture de la phase n’y rallume pas « Commit »', () => {
  const run = newRun('implement', 1_000)
  const done = applyReport(boardOf(run), { tickets: [{ id: 'a1', name: 'Un', status: 'done' }], complete: true }, 2_000).board
  const steps = (done.runs[0] as Run).phases[0]!.steps
  const after = applyCommand(done, 'git commit -m "fix"', true, '', 3_000)
  expect((after?.board.runs[0] as Run | undefined)?.phases[0]!.steps ?? steps).toEqual(steps)
})

test('les revues se cumulent d’après Claude : nombre, constats, corrigés', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 100_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, step: 'review', review: { standards: 3, spec: 1, fixed: 2 } } as any)
  await $.tool.call({ tool: TOOL, review: { standards: 0, spec: 1, fixed: 1 } } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Revues.·.2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^5.constats$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Standards.3 · Spec.2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^3.corrigés$/ })).toBeDefined()
  await ui.unmount()
})

test('des tickets ajoutés pendant l’exécution d’un groupe le rejoignent, dans l’ordre de leur chaîne', () => {
  const run = newRun('implement', 1_000)
  const planned = applyReport(
    boardOf(run),
    {
      tickets: [
        { id: 'a1', name: 'Règle', status: 'done' },
        { id: 'a4', name: 'Recalcul', status: 'doing' },
        { id: 'b1', name: 'App' },
      ],
      groups: [
        { id: 'A', name: 'Worker', tickets: ['a1', 'a4'] },
        { id: 'B', name: 'App', tickets: ['b1'] },
      ],
    },
    2_000,
  ).board
  const added = applyReport(
    planned,
    {
      tickets: [
        { id: 'x1', name: 'Rattrapage', status: 'doing' },
        { id: 'x2', name: 'Recalage', blockedBy: ['x1'] },
        { id: 'a4', name: 'Recalcul', status: 'blocked', blockedBy: ['x2'] },
      ],
    },
    3_000,
  ).board.runs[0] as Run
  expect(added.groups!.find(g => g.id === 'A')!.tickets).toEqual(['a1', 'x1', 'x2', 'a4'])
  expect(added.groups!.find(g => g.id === 'B')!.tickets).toEqual(['b1'])
})

test('pendant /to-tickets, ou avec deux groupes en cours, un ticket ajouté reste sans groupe', () => {
  const lot = (entry: string, statuses: [string, string]) => {
    const run = newRun(entry, 1_000)
    const planned = applyReport(
      boardOf(run),
      {
        tickets: [
          { id: 'a1', name: 'Un', status: statuses[0] },
          { id: 'b1', name: 'Deux', status: statuses[1] },
        ],
        groups: [
          { id: 'A', name: 'A', tickets: ['a1'] },
          { id: 'B', name: 'B', tickets: ['b1'] },
        ],
      },
      2_000,
    ).board
    return applyReport(planned, { tickets: [{ id: 'z1', name: 'Nouveau' }] }, 3_000).board.runs[0] as Run
  }
  const cited = (r: Run) => r.groups!.flatMap(g => g.tickets)
  expect(cited(lot('to-tickets', ['doing', 'todo']))).not.toContain('z1')
  expect(cited(lot('implement', ['doing', 'doing']))).not.toContain('z1')
  expect(cited(lot('implement', ['doing', 'todo']))).toContain('z1')
})

test('panneau allégé : relus pliés, trouvailles urgentes d’abord, groupe fini dépliable', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 101_000_000 })
  mock.store(on)
  engine(on)
  on('tool.call', { tool: 'mcp__asana__create_tasks' }, () => ({
    result: JSON.stringify({ data: ['1', '2', '3', '4', '5', '6'].map(n => ({ gid: `120000000000010${n}`, name: `Trouvaille ${n}` })) }),
  }))
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: 'a1', name: 'Fini un', status: 'done' },
      { id: 'b1', name: 'À faire' },
    ],
    groups: [
      { id: 'A', name: 'Worker', tickets: ['a1'] },
      { id: 'B', name: 'App', tickets: ['b1'] },
    ],
    decided: [{ what: 'Choix ancien', why: 'raison' }],
  } as any)
  await $.tool.call({
    tool: 'mcp__asana__create_tasks',
    tasks: [
      { name: 'Trouvaille 1', notes: 'Statut : à faire' },
      { name: 'Trouvaille 2', notes: 'Statut : à faire' },
      { name: 'Trouvaille 3', notes: 'Statut : à faire' },
      { name: 'Trouvaille 4', notes: 'Statut : à faire' },
      { name: 'Trouvaille 5', notes: 'Statut : à faire' },
      { name: 'Trouvaille 6', notes: 'Statut : à trancher (porteur)' },
    ],
  } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'decided-seen' })
  // Relu : une seule ligne, dépliable.
  expect(await ui.find({ type: 'Text', text: /^Choix ancien$/ })).toBeUndefined()
  await ui.press({ key: 'decided-toggle' })
  expect(await ui.find({ type: 'Text', text: /^Choix ancien$/ })).toBeDefined()
  await ui.press({ key: 'decided-toggle' })

  // La trouvaille qui attend une décision passe en tête ; quatre lignes, le reste plié.
  expect(await ui.find({ type: 'Text', text: /^Trouvaille 6$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Trouvaille 4$/ })).toBeUndefined()
  expect(String((await ui.find({ key: 'found-toggle' }))?.props.label)).toBe('▸ 2 de plus')
  await ui.press({ key: 'found-toggle' })
  expect(await ui.find({ type: 'Text', text: /^Trouvaille 4$/ })).toBeDefined()

  // Le groupe A, fini, se déplie avec « tout voir ».
  expect(await ui.find({ key: 'pick-a1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Fini un$/ })).toBeUndefined()
  await ui.press({ key: 'tickets-toggle' })
  expect(await ui.find({ type: 'Text', text: /^Fini un$/ })).toBeDefined()
  await ui.unmount()
})

test('« Trouvé en route » se masque entièrement, puis se réaffiche', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 102_000_000 })
  mock.store(on)
  engine(on)
  on('tool.call', { tool: 'mcp__asana__create_tasks' }, () => ({ result: JSON.stringify({ data: [{ gid: '1200000000000108', name: 'À trancher' }] }) }))
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'a1', name: 'Un' }] } as any)
  await $.tool.call({ tool: 'mcp__asana__create_tasks', tasks: [{ name: 'À trancher', notes: 'Statut : à trancher (porteur)' }] } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^À trancher$/ })).toBeDefined()
  await ui.press({ key: 'found-hide' })
  expect(await ui.find({ type: 'Text', text: /^À trancher$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Trouvé en route$/ })).toBeDefined()
  expect(String((await ui.find({ key: 'found-hide' }))?.props.label)).toBe('▸ afficher')
  await ui.press({ key: 'found-hide' })
  expect(await ui.find({ type: 'Text', text: /^À trancher$/ })).toBeDefined()
  await ui.unmount()
})

test('au-delà de 14 éléments, « tout voir » déplie la liste et « réduire » la replie', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  const items = Array.from({ length: 21 }, (_, i) => ({ id: `d${i + 1}`, label: `Décision numéro ${i + 1}`, status: 'done' as const }))
  await $.tool.call({ tool: TOOL, items })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Décision numéro 14$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Décision numéro 21$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'items-toggle', text: /tout voir \(21\)/ })).toBeDefined()
  await ui.press({ key: 'items-toggle' })
  expect(await ui.find({ type: 'Text', text: /Décision numéro 21$/ })).toBeDefined()
  await ui.press({ key: 'items-toggle' })
  expect(await ui.find({ type: 'Text', text: /Décision numéro 21$/ })).toBeUndefined()
  await ui.unmount()
})

test('au-delà de 30 éléments, les suivants sont gardés ; un long libellé reste entier', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  const long = `Décision longue ${'mot '.repeat(40)}fin`
  const items = Array.from({ length: 45 }, (_, i) => ({ id: `d${i + 1}`, label: i === 44 ? long : `Décision numéro ${i + 1}`, status: 'todo' as const }))
  await $.tool.call({ tool: TOOL, items })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'items-toggle' })
  expect(await ui.find({ type: 'Text', text: /Décision numéro 44$/ })).toBeDefined()
  const row = await ui.find({ type: 'Text', text: /^Décision longue/ })
  expect(String(row?.props.children ?? row?.text)).toMatch(/fin$/)
  expect(row?.props.wrap).toBe('wrap')
  await ui.unmount()
})

test('livrables, tickets et journal : « tout voir » montre tout ce qui est gardé', async ($, on) => {
  mock.clock(on, { now: 50_000_000 })
  const run = newRun('implement', 1_000)
  run.artifacts = Array.from({ length: 20 }, (_, i) => ({ path: `docs/l${i + 1}.md`, kind: 'doc' as const, label: `Livrable ${i + 1}`, at: 1_000 + i }))
  run.tickets = Array.from({ length: 70 }, (_, i) => ({ id: `t${i + 1}`, name: `Ticket ${i + 1}`, status: 'todo' as const }))
  run.log = Array.from({ length: 80 }, (_, i) => ({ at: 1_000 + i, glyph: '·', text: `Entrée ${80 - i}`, tone: 'info' as const }))
  const stored: Board = { ...emptyBoard('', 'projet'), deleted: [], runs: [{ ...run, status: 'paused', owner: undefined }], activeId: null }
  mock.store(on, { 'board:': stored })
  engine(on)
  await $.tool.call({ tool: TOOL, resume: run.id } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })

  // Tickets : au-delà de 60.
  expect(await ui.find({ type: 'Text', text: /^Ticket 65$/ })).toBeUndefined()
  await ui.press({ key: 'tickets-toggle' })
  expect(await ui.find({ type: 'Text', text: /^Ticket 65$/ })).toBeDefined()

  await ui.press({ key: 'tab-activity' })
  // Livrables : les 14 premiers, puis tous.
  expect(await ui.find({ type: 'Text', text: /^Livrable 20$/ })).toBeUndefined()
  await ui.press({ key: 'artifacts-toggle' })
  expect(await ui.find({ type: 'Text', text: /^Livrable 20$/ })).toBeDefined()
  // Journal : au-delà de 60 entrées.
  await ui.press({ key: 'log-toggle' })
  expect(await ui.find({ type: 'Text', text: /^Entrée 5$/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})
