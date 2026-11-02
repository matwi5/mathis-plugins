// La note de revue et de sécurité d'un lot sans groupes : /code-review chargé pendant l'Implémentation
// d'une mission sans groupes (hors passe « bogues ») reçoit la même note qu'à la revue d'un groupe fini,
// dite pour le lot, et l'avis de sécurité au format d'un groupe, envoyé sans "group". Ailleurs (relecture
// de branche, Revue d'une chasse au bug ou d'un TDD), l'avis « tout le lot » reste.

import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__flow-board__flow'
const PLUGIN = 'flow-board'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const

const world = (on: any, repo = true) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'sa' }))
  on('session.repo', () => ({ value: repo ? { root: 'C:/proj', remote: null, internal: false, name: null } : null }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'sa' }))
  on('command.list', () => ({ value: [] }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
}

const TICKETS = [
  { id: 'a1', name: 'Un', sensitive: false, logic: true },
  { id: 'b1', name: 'Deux', sensitive: false, logic: true },
]
const GROUPS = [
  { id: 'A', name: 'Code', tickets: ['a1'] },
  { id: 'B', name: 'Autre', tickets: ['b1'] },
]

/** Un lot découpé (avec ou sans groupes), en Implémentation, tickets tous faits. */
const doneLot = async ($: any, on: any, opts: { groups?: boolean; repo?: boolean; tickets?: object[] } = {}) => {
  const clock = mock.clock(on, { now: 70_000_000 })
  world(on, opts.repo ?? true)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', tickets: opts.tickets ?? TICKETS, ...(opts.groups ? { groups: GROUPS } : {}) } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(1000)
  await $.tool.call({ tool: TOOL, set: (opts.tickets ?? TICKETS).map((t: any) => ({ id: t.id, status: 'done' })) } as any)
  await clock.advance(1000)
  return clock
}
const review = async ($: any): Promise<string> => String((await $.skill.prompt({ skill: 'code-review', text: 'r' })).text)

test('sans groupes, /code-review pendant l’Implémentation porte la note de revue du lot', async ($, on) => {
  await doneLot($, on)
  const text = await review($)
  expect(text).toContain('This is the review of the lot (no groups: it is reviewed like a finished group): run it right here, as this skill (a fork of this discussion, at the effort of its level), never wrapped in a reviewer subagent when this discussion runs on Opus')
  expect(text).toContain("its exact command is /code-review high --fix <lot base>..HEAD consignes : <path> (high without --fix when a ticket of the lot is sensitive or did not say; <lot base>: the commit before the lot's first ticket; when launched without a target, review that range)")
  expect(text).toContain("Focus it on the interactions between the lot's tickets (each one had its own review), with the path of the file of declared choices and the reviewer brief")
  expect(text).toContain('It does not settle a conflict between the spec and an instruction')
  expect(text).toContain('Then read the diff of its fixes, rerun the checks and commit them.')
  expect(text).not.toContain('This is the review of a finished group')
})

test('sans groupes, l’avis de sécurité du lot part dans le même message, sur le diff du lot, sans "group", avec la règle de seconde passe', async ($, on) => {
  await doneLot($, on)
  const text = await review($)
  expect(text).toContain('- Security review: in the same message as this lot review')
  expect(text).toContain('send {"security": {"advised": true|false, "why": "<short reason, in the user\'s language>"}}, without "group"')
  expect(text).toContain("limited to git diff <lot base>..<launch> (<lot base>: the commit before the lot's first ticket; <launch>: the hash of HEAD when you launch it")
  expect(text).toContain("no second pass on the diff of the lot review's fixes")
  // L'avis du lot est daté : il ne compte qu'après la dernière fin de ticket et la dernière revue du lot,
  // et seul un envoi "advised" ouvre un nouveau passage.
  expect(text).toContain('it counts only when it follows the last ticket finish and the last lot review')
  expect(text).toContain('only a send with "advised" opens a new pass of the lot')
  expect(text).toContain('send {"security": {"dismissed": <total of findings left unfixed>}}')
  expect(text).not.toContain('"group": "<id>"')
  expect(text).not.toContain('it covers the whole mission')
})

test('sans groupes, la passe « bogues » d’un ticket en cours ne reçoit pas la note du lot', async ($, on) => {
  const clock = mock.clock(on, { now: 70_000_000 })
  world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', tickets: TICKETS } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(1000)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'doing' }] } as any)
  await $.tool.call({ tool: TOOL, step: 'checks' } as any)
  const text = await review($)
  expect(text).toContain('This is the bug pass of the ticket in progress')
  expect(text).not.toContain('This is the review of the lot')
  expect(text).not.toContain('- Security review:')
})

test('sans git, la note du lot suit la méthode des copies', async ($, on) => {
  await doneLot($, on, { repo: false })
  const text = await review($)
  expect(text).toContain("This is the review of the lot (no groups: it is reviewed like a finished group) (fixed point: for each file, the oldest copy among the lot's tickets, diffed against the current file (\"Without git\" below): give it these copies and files)")
  expect(text).toContain("limited to the lot's diff (fixed point: for each file, the oldest copy among the lot's tickets")
  expect(text).toContain('- Without git:')
  expect(text).not.toContain('git diff <lot base>')
  expect(text).not.toContain('..HEAD')
})

test('avec des groupes, la revue d’un groupe fini garde sa note et son avis', async ($, on) => {
  await doneLot($, on, { groups: true })
  const text = await review($)
  expect(text).toContain('This is the review of a finished group')
  expect(text).toContain('send {"security": {"group": "<id>", "advised": true|false')
  expect(text).not.toContain('review of the lot')
})

test('en auto, sans groupes, la consigne d’/implement dit la relance de la revue et de la sécurité du lot', async ($, on) => {
  const clock = mock.clock(on, { now: 70_000_000 })
  world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', tickets: TICKETS } as any)
  for (const key of ['auto-on', 'auto-confirm']) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
    await pane.press({ key })
    await pane.unmount()
  }
  await clock.advance(1000)
  const text = String((await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text)
  expect(text).toContain('Implementation in auto mode, without groups: launch the lot review yourself, as the /implement instructions say (section 4 of the procedure, on <lot base>..HEAD')
  expect(text).toContain('flow-board itself sends it at the end of a turn, then the lot\'s advised security review when it was not launched')
  expect(text).toContain('its security advice once the review has loaded, never before it')
  expect(text).toContain('send {"complete": true}: the auto mode sends the report only after it')
  expect(text).toContain('Leaving a security finding unfixed is the user\'s decision, a blocking question on this phase ("phase": "implement")')
  expect(text).not.toContain('the request to launch the next wave of groups')
})

test('en auto, avec des groupes, la consigne d’/implement garde le bloc des vagues de groupes', async ($, on) => {
  const clock = mock.clock(on, { now: 70_000_000 })
  world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', tickets: TICKETS, groups: GROUPS } as any)
  for (const key of ['auto-on', 'auto-confirm']) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
    await pane.press({ key })
    await pane.unmount()
  }
  await clock.advance(1000)
  const text = String((await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text)
  expect(text).toContain('Implementation in auto mode: flow-board itself sends, at the end of a turn, the request to launch the next wave of groups')
  expect(text).toContain('never xhigh: do not ask the xhigh question, declare instead that xhigh was not offered')
  expect(text).not.toContain('without groups: launch the lot review yourself')
})
