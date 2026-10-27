import { expect, mock, test } from 'claude-code/testing'

// Un groupe ne se lance qu'en session liée (spec « Groupes et vagues », série 1 Q10) : plus de
// lancement ici ni par /implement-spec ; les tickets choisis à la main gardent leurs lancements.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

/** Un dépôt git : c'est là que /implement-spec se proposait pour un lot de groupes. */
const inRepo = (on: any) => on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))

// A ∥ B prêts ; C attend A, mais c0 n'attend rien (un « prêt » dans un groupe qui attend).
const TICKETS = [
  { id: 'a1', name: 'Un', blockedBy: [] },
  { id: 'b1', name: 'Deux', blockedBy: [] },
  { id: 'c0', name: 'Trois', blockedBy: [] },
  { id: 'c1', name: 'Quatre', blockedBy: ['a1'] },
]
const GROUPS = [
  { id: 'A', name: 'Worker', tickets: ['a1'], files: ['worker'], continuesHere: true },
  { id: 'B', name: 'App', tickets: ['b1'], files: ['app'] },
  { id: 'C', name: 'Suite', tickets: ['c0', 'c1'], files: ['suite'] },
]

const start = async ($: any) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  return $.tool.call({ tool: TOOL, title: 'Lot', tickets: TICKETS, groups: GROUPS } as any)
}

test('un groupe ne se lance qu’en session liée, sur chaque surface', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 70_000_000 })
  mock.store(on)
  engine(on)
  inRepo(on)
  const answer = await start($)
  // Un continuesHere reçu est ignoré, sans erreur.
  expect(JSON.stringify(answer)).not.toMatch(/continuesHere|error/i)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    for (const id of ['A', 'B', 'C']) expect(await ui.find({ key: `launch-group-${id}` })).toBeUndefined()
    expect(await ui.find({ key: 'launch-ready-C' })).toBeUndefined()
    expect(await ui.find({ key: 'launch-parallel' })).toBeUndefined()
    expect(await ui.find({ key: 'next-parallel' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /cette discussion|discussion de découpage|nouvelle discussion/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\/implement-spec/ })).toBeUndefined()
    // Restent : la session liée de chaque groupe prêt, et le lot en sessions liées.
    expect(await ui.find({ key: 'launch-linked-A' })).toBeDefined()
    expect(await ui.find({ key: 'launch-linked-B' })).toBeDefined()
    expect(String((await ui.find({ key: 'launch-parallel-linked' }))?.props.label)).toMatch(/^⇉.A ∥ B en parallèle · sessions liées$/)
    expect(String((await ui.find({ key: 'next-parallel-linked' }))?.props.label)).toMatch(/^⇉.A ∥ B en parallèle · sessions liées$/)
    await ui.unmount()
  }
})

test('« Ensuite » propose la session liée du prochain groupe, jamais un lancement ici, même pour un ancien continuesHere', async ($, on) => {
  mock.clock(on, { now: 71_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  // Trois groupes qui pilotent le même service : jamais en parallèle.
  const service = ['Service']
  await $.tool.call({
    tool: TOOL,
    title: 'Lot',
    tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }],
    groups: [
      { id: 'A', name: 'Un', tickets: ['a1'], resources: service, continuesHere: true },
      { id: 'B', name: 'Deux', tickets: ['b1'], resources: service },
    ],
  } as any)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect((await ui.find({ key: 'next-linked-A' }))?.props).toMatchObject({ label: expect.stringMatching(/^↗.Groupe A · session liée$/), variant: 'primary' })
    expect(await ui.find({ key: 'next-group-A' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Lancer A ici/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('les tickets choisis à la main gardent /implement et /implement-spec', async ($, on) => {
  mock.clock(on, { now: 72_000_000 })
  mock.store(on)
  const filled = engine(on)
  inRepo(on)
  await start($)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'pick-b1' })
  await ui.press({ key: 'launch-picks' })
  expect(filled.at(-1)).toMatch(/^\/mattpocock-skills:implement Tickets à traiter, un par un et dans cet ordre : 1\) b1 — Deux$/)
  await ui.press({ key: 'pick-b1' })
  await ui.press({ key: 'launch-picks-parallel' })
  expect(filled.at(-1)).toMatch(/^\/mattpocock-skills:implement-spec Tickets à traiter : 1\) b1 — Deux/)
  await ui.unmount()
})

test('la consigne de /to-tickets : un groupe se fait en session liée, sans groupe qui continue ici', async ($, on) => {
  mock.clock(on, { now: 73_000_000 })
  mock.store(on)
  engine(on)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text
  expect(note).toMatch(/"groups": \[\{"id": "A"/)
  expect(note).not.toMatch(/continuesHere/)
  expect(note).not.toMatch(/context of this discussion/)
  expect(note).toMatch(/Each group runs in a linked session, never in this discussion/)
  expect(note).not.toMatch(/\/implement-spec, one subagent per group/)
})

test('les textes envoyés à Claude ne citent plus « ▶ Lancer » pour le groupe suivant', async ($, on) => {
  mock.clock(on, { now: 74_000_000 })
  mock.store(on)
  engine(on)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text
  expect(note).toContain('the next group, which the user launches from the dashboard, in its linked session (↗ Session liée)')
  expect(note).not.toMatch(/▶ Lancer/)
  // La réponse qui refuse de clore la phase tant que des tickets restent ouverts.
  await $.tool.call({ tool: TOOL, title: 'Lot', tickets: TICKETS, groups: GROUPS } as any)
  const answer = JSON.stringify(await $.tool.call({ tool: TOOL, complete: true } as any))
  expect(answer).toContain('in its linked session (↗ Session liée)')
  expect(answer).not.toMatch(/▶ Lancer/)
})
