import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

const LOT = [
  { id: 'A1', name: 'Un', blockedBy: [] },
  { id: 'A2', name: 'Deux', blockedBy: ['A1'] },
  { id: 'B1', name: 'Trois', blockedBy: ['A2'] },
]
const GROUPS = [
  { id: 'A', name: 'Worker', tickets: ['A1', 'A2'], files: ['worker'] },
  { id: 'B', name: 'App', tickets: ['B1'], files: ['app'] },
]

// Le plus long de la suite (plusieurs montages du panneau) : sa limite tient compte d'une machine chargée.
test('un groupe fini propose sa revue (/code-review), puis passe « revu » ; la livraison attend', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 96_000_000 })
  mock.store(on)
  const filled = world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: LOT, groups: GROUPS } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'launch-group-A' })
  await ui.unmount()
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }, { id: 'A2', status: 'done' }] } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    // Le groupe A est fini : son bouton de revue, sur sa ligne ; la carte « Ensuite » propose le groupe suivant.
    expect(await ui.find({ key: 'review-group-A' })).toBeDefined()
    expect(await ui.find({ key: 'go-final-review' })).toBeUndefined()
    expect((await ui.find({ key: 'next-linked-B' }))?.props).toMatchObject({ label: expect.stringMatching(/^↗.Groupe B · session liée$/) })
    expect(await ui.find({ key: 'go-compte-rendu' })).toBeUndefined()
    await ui.unmount()
  }
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'review-group-A' })
  await ui.unmount()
  expect(filled.at(-1)).toBe('/code-review --fix')

  // /code-review lancé dans la discussion : le groupe A est relu, plus de revue proposée.
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'review-group-A' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^✓.revu$/ })).toBeDefined()
  expect(await ui.find({ key: 'go-final-review' })).toBeUndefined()
  // B reste à faire : toujours pas de livraison.
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeUndefined()
  await ui.unmount()

})

test('le dernier groupe fini puis relu : la livraison revient', async ($, on) => {
  mock.clock(on, { now: 96_500_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: LOT, groups: GROUPS } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }, { id: 'A2', status: 'done' }] } as any)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, set: [{ id: 'B1', status: 'done' }] } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'review-group-B' })).toBeDefined()
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeUndefined()
  await ui.unmount()
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeDefined()
  await ui.unmount()
})

test('un plan de groupes renvoyé par Claude garde les revues faites ; /code-review n’ouvre pas de phase', async ($, on) => {
  mock.clock(on, { now: 97_000_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: LOT.map(t => ({ ...t, status: 'done' })), groups: GROUPS } as any)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, groups: GROUPS } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'review-group-A' })).toBeUndefined()
  expect(await ui.find({ key: 'review-group-B' })).toBeUndefined()
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Revue du groupe$/ })).toBeUndefined()
  await ui.unmount()
})

test('sans groupes, le lot fini propose une revue, puis la livraison', async ($, on) => {
  mock.clock(on, { now: 98_000_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'T1', name: 'Seul', status: 'done' }] } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-final-review' })).toBeDefined()
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeUndefined()
  await ui.unmount()
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-final-review' })).toBeUndefined()
  expect(await ui.find({ key: 'go-compte-rendu' })).toBeDefined()
  await ui.unmount()
})

test('la passe « bogues » d’un ticket en cours n’est pas la revue d’un groupe ; la revue du groupe reçoit ses consignes', async ($, on) => {
  mock.clock(on, { now: 96_500_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: LOT, groups: GROUPS } as any)
  // A fini mais pas encore relu ; B1 en cours ici, encore en TDD : /code-review est la revue de A, lancée depuis sa ligne.
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }, { id: 'A2', status: 'done' }, { id: 'B1', status: 'doing' }] } as any)
  await $.tool.call({ tool: TOOL, step: 'tdd' } as any)
  expect((await $.skill.prompt({ skill: 'code-review', text: 'r' })).text).toContain('This is the review of a finished group')
  // Une fois les contrôles de B1 lancés, /code-review est la passe « bogues » de B1 : aucun groupe relu.
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'C1', name: 'Quatre' }], groups: [...GROUPS, { id: 'C', name: 'Doc', tickets: ['C1'] }] } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'C1', status: 'done' }], step: 'checks' } as any)
  const bug = (await $.skill.prompt({ skill: 'code-review', text: 'r' })).text
  expect(bug).toContain('This is the bug pass of the ticket in progress')
  expect(bug).not.toContain('"advised": true|false')
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'review-group-C' })).toBeDefined()
  await ui.unmount()

  // B1 commité : la même commande est la revue du groupe, avec la liste des choix déclarés et le conflit à remonter.
  await $.tool.call({ tool: TOOL, set: [{ id: 'B1', status: 'done' }] } as any)
  const review = (await $.skill.prompt({ skill: 'code-review', text: 'r' })).text
  expect(review).toContain('This is the review of a finished group')
  expect(review).toContain('It does not settle a conflict between the spec and an instruction')
  expect(review).toContain('"advised": true|false')
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'review-group-C' })).toBeUndefined()
  await ui.unmount()
})

/** Les consignes d'/implement et de /code-review (passe « bogues », puis revue du groupe), avec ou sans git. */
const reviewNotes = async ($: any, on: any, repo: boolean) => {
  mock.clock(on, { now: 97_000_000 })
  mock.store(on)
  world(on)
  on('session.repo', () => ({ value: repo ? { root: 'C:/proj', remote: null, internal: false, name: null } : null }))
  const implement = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text as string
  await $.tool.call({ tool: TOOL, tickets: LOT, groups: GROUPS } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'doing' }] } as any)
  await $.tool.call({ tool: TOOL, step: 'checks' } as any)
  const bug = (await $.skill.prompt({ skill: 'code-review', text: 'r' })).text as string
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }, { id: 'A2', status: 'done' }] } as any)
  const group = (await $.skill.prompt({ skill: 'code-review', text: 'r' })).text as string
  return { implement, bug, group }
}

test('avec git, les revues partent du commit d’avant le ticket ou de la base du groupe, sans copies', async ($, on) => {
  const { implement, bug, group } = await reviewNotes($, on, true)
  expect(implement).toContain("review (/mattpocock-skills:code-review on this ticket's changes only (Skill tool; fixed point: the commit before the ticket)")
  expect(implement).toContain('on the same scope (fixed point: the commit before the ticket)')
  expect(implement).toContain("Revue du groupe (/code-review --fix of Claude Code on the group's changes (launched by the user")
  expect(implement).toContain('by the session itself), run in a reviewer subagent (Agent tool, general-purpose, model opus, effort xhigh) that launches /code-review --fix itself and applies its fixes itself, giving it')
  expect(bug).toContain('This is the bug pass of the ticket in progress (sensitive area), not the review of a group: same scope as its /mattpocock-skills:code-review (fixed point: the commit before the ticket)')
  // La revue du groupe tourne dans un sous-agent relecteur Opus xhigh, qui écrit lui-même ses correctifs.
  expect(group).toContain('This is the review of a finished group: run it in a reviewer subagent (Agent tool, general-purpose, model opus, effort xhigh) that launches /code-review --fix itself and applies its fixes itself, not in this discussion, and give that subagent these instructions')
  expect(group).toContain('Then read the diff of its fixes, rerun the checks and commit them.')
  expect(group).toContain('git diff <group base>..HEAD')
  for (const text of [implement, bug, group]) expect(text).not.toMatch(/Without git|copy/)
})

test('sans git, chaque revue compare la copie prise avant le ticket (ou le groupe) au fichier actuel', async ($, on) => {
  const { implement, bug, group } = await reviewNotes($, on, false)
  // La méthode : copier avant le premier fichier touché, un sous-dossier par ticket, puis lire un diff.
  expect(implement).toContain('- Without git: this project is not a git repository, so no commit marks where a ticket starts. Before touching the first file of a ticket, copy the files it will change into the session\'s temporary folder')
  expect(implement).toContain('one subfolder per ticket keeping the path in the project (<temporary folder>/<ticket id>/<path in the project>)')
  expect(implement).toContain("a group's fixed point is, file by file, the oldest copy among its tickets")
  expect(implement).toContain('The reviews read a unified diff of the copy against the current file (git diff --no-index <copy> <file> works outside a repository), not the whole files; a file the ticket creates has no copy: it is new and is read whole.')
  expect(implement).toContain("review (/mattpocock-skills:code-review on this ticket's changes only (Skill tool; fixed point: the copy of its files taken before the ticket, diffed against the current files (\"Without git\" below))")
  expect(implement).toContain("Revue du groupe (/code-review --fix of Claude Code on the group's changes (fixed point: for each file, the oldest copy among the group's tickets, diffed against the current file (\"Without git\" below)) (launched by the user")
  expect(bug).toContain('same scope as its /mattpocock-skills:code-review (fixed point: the copy of its files taken before the ticket')
  expect(bug).toContain('- Without git:')
  expect(group).toContain("This is the review of a finished group (fixed point: for each file, the oldest copy among the group's tickets, diffed against the current file (\"Without git\" below): give it these copies and files): run it in a reviewer subagent (Agent tool, general-purpose, model opus, effort xhigh) that launches /code-review --fix itself and applies its fixes itself, not in this discussion")
  expect(group).toContain('- Without git:')
  for (const text of [implement, bug, group]) {
    expect(text).not.toContain('the commit before the ticket')
    expect(text).not.toContain('git diff <group base>..HEAD')
  }
})
