import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'

const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: {
    title: 'Parcours',
    isFocused: false,
    bodyColumns: 92,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const ALL = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const BANDS = ['terminal', 'desktop'] as const

// Ce que le moteur ferait sous les plugins : le texte du skill tel quel, un bandeau vide.
const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
}

const resultText = (answer: unknown): string => String((answer as { result?: unknown }).result)

test('un skill de cadrage ouvre « Nouvelle fonctionnalité » et se dessine partout', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  engine(on)

  const loaded = await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'SKILL TEXT' })
  expect(loaded.text.startsWith('SKILL TEXT')).toBe(true)
  expect(loaded.text).toMatch(/mcp__flow-board__flow/)
  expect(loaded.text).toMatch(/tree \(/)
  expect(loaded.text).toMatch(/First call/)

  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /NOUVELLE FONCTIONNALITÉ/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Cadrage/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Arbre des décisions/ })).toBeDefined()
    await ui.unmount()
  }
  for (const surface of BANDS) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /Cadrage/ })).toBeDefined()
    await ui.unmount()
  }
})

test('le parcours avance de phase en phase et suit les tickets', async ($, on) => {
  mock.clock(on, { now: 2_000_000 })
  mock.store(on)
  engine(on)

  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Export CSV des factures', step: 'rounds' })

  const spec = await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'y' })
  expect(spec.text).toMatch(/publish \(/)
  expect(spec.text).not.toMatch(/First call/)

  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'z' })
  const answer = await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: '#12', name: 'Parser le CSV' },
      { id: '#13', name: 'Route d’export' },
    ],
    set: [{ id: '#12', status: 'doing' }],
  })
  expect(resultText(answer)).toMatch(/tickets 0\/2/)

  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'w' })
  // tdd chargé par implement : une étape de la phase, pas un nouveau parcours.
  await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'v' })
  await $.tool.call({ tool: TOOL, set: [{ id: '#12', status: 'done' }] })

  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Export CSV des factures/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Implémentation/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Route d’export/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1\/2$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('les tests rouge puis vert et le commit se lisent dans le panneau', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 3_000_000 })
  mock.store(on)
  engine(on)
  on('tool.call', { tool: 'Bash' }, (_$: unknown, e: { command: string }) =>
    e.command.includes('--fail')
      ? { isError: true as const, result: 'exit 1', text: 'FAIL src/a.test.ts' }
      : { result: { stdout: 'ok', stderr: '', interrupted: false } },
  )

  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --fail' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: export"' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /au vert/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\scycle/ })).toBeDefined()
    await ui.press({ key: 'tab-activity' })
    expect(await ui.find({ type: 'Text', text: /Commit : feat: export/ })).toBeDefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})

test('un skill hors du parcours devient un détour, un autre point de départ un nouveau parcours', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 4_000_000 })
  mock.store(on)
  engine(on)

  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await $.skill.prompt({ skill: 'mattpocock-skills:prototype', text: 'y' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Détour/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Prototype/ })).toBeDefined()
    await ui.unmount()
  }

  // Un bug en plein cadrage : nouveau parcours « Chasse au bug », le cadrage passe en pause.
  await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'z' })
  await $.tool.call({
    tool: TOOL,
    items: [
      { id: 'h1', label: 'Cache périmé', status: 'doing' },
      { id: 'h2', label: 'Fuseau horaire', status: 'dropped' },
    ],
  })
  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /CHASSE AU BUG/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Cache périmé/ })).toBeDefined()
    await ui.press({ key: 'tab-history' })
    expect(await ui.find({ type: 'Text', text: /en pause/ })).toBeDefined()
    // L'onglet est un état de la session : on le remet pour la surface suivante.
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }

  // Relancer le cadrage reprend… un nouveau parcours (on ne revient pas en arrière) ;
  // relancer to-spec reprend le parcours en pause, à la phase Spec.
  const spec = await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'w' })
  expect(spec.text).toMatch(/flow-board/)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /NOUVELLE FONCTIONNALITÉ/ })).toBeDefined()
  await ui.unmount()
})

test('les questions du grilling et la synthèse de revue sont relevées en fin de tour', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 5_000_000 })
  mock.store(on)
  engine(on)
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))

  await $.skill.prompt({ skill: 'mattpocock-skills:grill-me', text: 'x' })
  await $.turn.complete({
    answer: '❓ **Q1** - Qui paie ?\n➡️ Le client\n\n---\n\n❓ **Q2** - Quand ?\n➡️ À la livraison',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /2\squestions/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Q1–Q2/ })).toBeDefined()
    await ui.unmount()
  }
})

test('sans parcours, le panneau propose les points de départ', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Tableau de bord du workflow/ })).toBeDefined()
    expect(await ui.find({ key: 'new-grill-with-docs' })).toBeDefined()
    await ui.unmount()
  }
})

test('une mise à jour Asana fait avancer les tickets du parcours (repris de ticket-board)', async ($, on) => {
  mock.clock(on, { now: 6_000_000 })
  mock.store(on)
  engine(on)
  on('tool.call', { tool: 'mcp__asana__update_tasks' }, () => ({ result: { data: [] } }))

  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: '111', name: 'A' }, { id: '222', name: 'B' }] })
  await $.tool.call({
    tool: 'mcp__asana__update_tasks',
    tasks: [
      { task: '111', completed: true },
      { task: '222', notes: 'Statut : en cours\nContexte : x' },
    ],
  } as any)
  const answer = await $.tool.call({ tool: TOOL })
  expect(resultText(answer)).toMatch(/tickets 1\/2/)
})

test('le bandeau se masque, et /flow show le rend', async ($, on) => {
  mock.clock(on, { now: 7_000_000 })
  mock.store(on)
  engine(on)
  on('command.run', { command: 'flow' }, async (_$, e, next) => next(e))

  await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'x' })
  for (const surface of BANDS) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /TDD/ })).toBeDefined()
    await ui.press({ key: 'band-hide' })
    expect(await ui.find({ type: 'Text', text: /TDD/ })).toBeUndefined()
    await ui.unmount()
    const shown = await $.command.run({ command: 'flow', args: 'show' } as any)
    expect(String(shown.text)).toMatch(/Parcours : /)
  }
})

test('/flow-board:flow, connu dès le premier message, répond comme /flow', async ($, on) => {
  mock.clock(on, { now: 7_500_000 })
  mock.store(on)
  engine(on)
  on('command.run', { command: 'flow-board:flow' }, async (_$, e, next) => next(e))

  const empty = await $.command.run({ command: 'flow-board:flow', args: '' } as any)
  expect(String(empty.text)).toMatch(/aucun parcours en cours/)
  await $.skill.prompt({ skill: 'mattpocock-skills:tdd', text: 'x' })
  const shown = await $.command.run({ command: 'flow-board:flow', args: 'history' } as any)
  expect(String(shown.text)).toMatch(/Parcours : /)
})

test('/flow sort du menu, /flow-board:flow y reste', async ($, on) => {
  on('command.describe', (_$: unknown, e: any) => ({ description: e.description, isHidden: e.isHidden }))
  const flow = await $.command.describe({ command: 'flow', description: 'x', isHidden: false } as any)
  expect(flow.isHidden).toBe(true)
  const full = await $.command.describe({ command: 'flow-board:flow', description: 'x', isHidden: false } as any)
  expect(full.isHidden).toBe(false)
})

test('les sous-agents apparaissent dans l’onglet Agents pendant leur travail, puis passent faits', async ($, on) => {
  mock.clock(on, { now: 8_000_000 })
  mock.store(on)
  engine(on)
  on('classic.SubagentStop', () => ({}))
  on('tool.call', { tool: 'Agent' }, () => ({
    result: { agentId: 'agent-7', content: [], totalToolUseCount: 0, totalDurationMs: 0, totalTokens: 0, usage: {} },
  }))

  await $.skill.prompt({ skill: 'mattpocock-skills:implement-spec', text: 'x' })
  await $.tool.call({ tool: 'Agent', description: 'Implement ticket #12', prompt: 'p', model: 'haiku', run_in_background: true } as any)
  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    // Dans Parcours, une ligne de résumé remplace l'encadré et mène à l'onglet.
    expect(await ui.find({ type: 'Text', text: /1\sagent\sau\stravail/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Implement ticket #12/ })).toBeUndefined()
    // Implémentation : les étapes (« Implementers »…) ne s'affichent plus.
    expect(await ui.find({ type: 'Text', text: /Implementers/ })).toBeUndefined()
    await ui.press({ key: 'agents-open' })
    expect(await ui.find({ type: 'Text', text: /Orchestrateur/ })).toBeDefined()
    // Une rangée par sous-agent : son bouton porte son nom.
    expect(await ui.find({ type: 'Button', text: /Implement ticket #12/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^au\stravail$/ })).toBeDefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
  await ($ as any).classic.SubagentStop({ agent_id: 'agent-7', agent_type: 'general-purpose', agent_transcript_path: 'x', stop_hook_active: false })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /^fini$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /au\srepos/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('un sous-agent rendu « completed » est fini, même sans run_in_background', async ($, on) => {
  mock.clock(on, { now: 8_000_000 })
  mock.store(on)
  engine(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'completed', agentId: 'agent-8', content: [], totalToolUseCount: 0, totalDurationMs: 0, totalTokens: 0, usage: {} } }))
  await $.skill.prompt({ skill: 'mattpocock-skills:implement-spec', text: 'x' })
  await $.tool.call({ tool: 'Agent', description: 'Inventaire des règles', prompt: 'p' } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Button', text: /Inventaire des règles/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /au\srepos/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('les fins de sous-agents manquées sont rattrapées par la liste des sous-agents de la session', async ($, on) => {
  mock.clock(on, { now: 8_000_000 })
  mock.store(on)
  engine(on)
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  let n = 0
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: `agent-${++n}`, description: 'd', prompt: 'p', outputFile: 'o' } }))
  let live: unknown[] = []
  on('agent.list', () => ({ value: live as any }))
  await $.skill.prompt({ skill: 'mattpocock-skills:implement-spec', text: 'x' })
  await $.tool.call({ tool: 'Agent', description: 'Fini sans signal', prompt: 'p', run_in_background: true } as any)
  await $.tool.call({ tool: 'Agent', description: 'Disparu', prompt: 'p', run_in_background: true } as any)
  await $.tool.call({ tool: 'Agent', description: 'Toujours au travail', prompt: 'p', run_in_background: true } as any)
  live = [
    { id: 'agent-1', description: 'Fini sans signal', type: 'general-purpose', status: 'completed' },
    { id: 'agent-3', description: 'Toujours au travail', type: 'general-purpose', status: 'running' },
  ]
  await $.turn.start({ text: 'suite', turnId: 't1' } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /3\sagents\s·\s1\sau\stravail/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
  // Le tour d'un sous-agent qui se termine le marque fini.
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't9', reason: 'answer', agentId: 'agent-3' } as any)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await after.press({ key: 'tab-agents' })
  expect(await after.find({ type: 'Text', text: /au\srepos/ })).toBeDefined()
  await after.press({ key: 'tab-flow' })
  await after.unmount()
})

test('sans parcours, l’onglet Agents suit les sous-agents de la discussion', async ($, on) => {
  mock.clock(on, { now: 8_100_000 })
  mock.store(on)
  engine(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'agent-1', description: 'd', prompt: 'p', outputFile: 'o' } }))
  await $.tool.call({ tool: 'Agent', description: 'Chercher la doc du SDK', prompt: 'p', run_in_background: true } as any)
  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    // Le libellé de l'onglet dit combien d'agents travaillent.
    expect((await ui.find({ key: 'tab-agents' }))?.props.label).toMatch(/Agents\s·\s1/)
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Button', text: /Chercher la doc du SDK/ })).toBeDefined()
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})

test("le tour d'un sous-agent de fond ne fait pas passer la main à Claude", async ($, on) => {
  mock.clock(on, { now: 8_000_000 })
  mock.store(on)
  engine(on)
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))

  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.turn.start({ text: 'go', turnId: 't1' } as any)
  await $.turn.complete({ answer: 'fini', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  // Un sous-agent lancé en arrière-plan démarre son tour : la main reste à la personne.
  await $.turn.start({ text: 'explore', turnId: 't1', agentId: 'a1' } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Claude travaille/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /À toi de jouer/ })).toBeDefined()
  await ui.unmount()
  // Le tour suivant du fil principal, lui, la rend à Claude.
  await $.turn.start({ text: 'suite', turnId: 't2' } as any)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await after.find({ type: 'Text', text: /Claude travaille/ })).toBeDefined()
  await after.unmount()
})
