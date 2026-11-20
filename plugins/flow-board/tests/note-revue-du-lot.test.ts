// La note de revue et de sécurité d'un lot sans groupes : /code-review chargé pendant l'Implémentation
// d'une mission sans groupes (hors passe « bogues ») reçoit la même note qu'à la revue d'un groupe fini,
// dite pour le lot, et l'avis de sécurité au format d'un groupe, envoyé sans "group". Ailleurs (relecture
// de branche, Revue d'une chasse au bug ou d'un TDD), l'avis « tout le lot » reste.

import { expect, mock, test } from 'claude-code/testing'

import { applyReport, autoDecision, emptyBoard, isLotSecurityDue, isSingleTicketLot, needsReview, newRun, reportFacts } from '../hooks/model.ts'
import { activeRun } from '../hooks/basics.ts'
import { lotAdviceText } from '../hooks/decoupage.ts'
import type { Board, Run } from '../types'

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
  expect(text).toContain('Then read the diff of its fixes, rerun the checks, the full suite included, and commit them.')
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
  expect(text).toContain('Implementation in auto mode, without groups: launch the lot review yourself, as the /implement instructions say (section 4 of the procedure, in procedure-groupe-fin.md, on <lot base>..HEAD')
  expect(text).toContain('flow-board itself sends it at the end of a turn, then the lot\'s advised security review when it was not launched')
  expect(text).toContain('its security advice once the review has loaded, never before it')
  expect(text).toContain('send {"complete": true}: the auto mode sends the report only after it')
  expect(text).toContain('Leaving a security finding unfixed is the user\'s decision, a blocking question on this phase ("phase": "implement")')
  expect(text).not.toContain('the request to launch the next wave of groups')
  // Un lot d'un seul ticket : pas de revue du lot, son avis ; manquant, flow-board le demande.
  expect(text).toContain('A lot of a single ticket, attached ones included, has no lot review: give its security advice, unless dispensed, once that ticket is done; when it is missing (an interrupted discussion), flow-board asks for it at the end of a turn.')
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
  expect(text).toContain('never Fable; xhigh comes from the « Jugement » line of a ticket, which the session\'s mod applies while that ticket is in progress, so a group that carries one is launched at the effort of the rule too, with no effort question.')
  expect(text).not.toContain('do not ask either effort question')
  expect(text).not.toContain('without groups: launch the lot review yourself')
})

/** Un lot sans groupes en Implémentation, ses tickets tous faits, en auto : le modèle seul. */
const lotRun = (tickets: { id: string; sensitive?: boolean; logic?: boolean }[]): Run => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  run.tickets = tickets.map((t, i) => ({ name: `Ticket ${i + 1}`, status: 'done', finishedAt: 2_000 + i, ...t })) as Run['tickets']
  run.auto = { onAt: 1_500, onBy: 's' } as Run['auto']
  return run
}

test('un lot d’un seul ticket (rattachés compris) n’a pas de revue du lot : relu par son ticket, l’auto ne l’envoie pas, son avis de sécurité dû selon ses drapeaux', () => {
  // Avec de la logique : pas de revue du lot, l'avis de sécurité reste dû (le compte rendu l'attend).
  const logic = lotRun([{ id: 'a1', sensitive: false, logic: true }])
  expect(isSingleTicketLot(logic)).toBe(true)
  expect(needsReview(logic)).toBe(false)
  expect(isLotSecurityDue(logic)).toBe(true)
  // L'auto n'envoie pas de revue du lot ; l'avis manquant (une discussion interrompue), il le demande, une fois par passage.
  const decision = autoDecision(logic, {}, false)
  expect(decision.kind === 'send' && decision.action.kind).toBe('advice')
  expect(decision.kind === 'send' && decision.action.key.startsWith('review:lot')).toBe(false)
  const key = decision.kind === 'send' ? decision.action.key : ''
  const asked = { ...logic, autoSent: [{ key, at: 3_000, startedAt: 3_000 }] } as Run
  expect(autoDecision(asked, {}, false).kind === 'send').toBe(false)
  expect(lotAdviceText(false)).toContain('envoie à l\'outil flow {"security": {"advised": true|false, "why": "<raison>"}}, sans "group"')
  expect(lotAdviceText(true)).toContain('donne l\'avis quand même, sans lancer de relecteur')
  expect(reportFacts(logic).join('\n')).toContain('reviewed by its ticket review (a single ticket, attached ones included: no lot review)')
  // Muet (un drapeau manquant) : de même, l'avis dû.
  const silent = lotRun([{ id: 'a1' }])
  expect(needsReview(silent)).toBe(false)
  expect(isLotSecurityDue(silent)).toBe(true)
  // Dispensé (ni logique ni zone sensible) : ni revue ni avis.
  const light = lotRun([{ id: 'a1', sensitive: false, logic: false }])
  expect(needsReview(light)).toBe(false)
  expect(isLotSecurityDue(light)).toBe(false)
  // L'avis envoyé tranche la sécurité, sans revue du lot, et l'auto ne le redemande pas.
  const advised = { ...logic, security: { isAdvised: false, why: 'rien à risque', at: 3_000 } } as Run
  expect(isLotSecurityDue(advised)).toBe(false)
  expect(autoDecision(advised, {}, false).kind === 'send').toBe(false)
})

test('un lot de deux tickets garde sa revue du lot ; jamais réputé relu sans elle dès qu’un ticket a de la logique, une zone sensible ou est muet ; la dispense ne change pas', () => {
  for (const second of [{ sensitive: false, logic: true }, { sensitive: true, logic: false }, {}]) {
    const run = lotRun([{ id: 'a1', sensitive: false, logic: false }, { id: 'b1', ...second }])
    expect(isSingleTicketLot(run)).toBe(false)
    expect(needsReview(run)).toBe(true)
    const decision = autoDecision(run, {}, false)
    expect(decision.kind === 'send' && decision.action.key.startsWith('review:lot')).toBe(true)
    // Relu à 5 000 : plus dû.
    expect(needsReview({ ...run, reviewedAt: 5_000 })).toBe(false)
  }
  // Deux tickets ni logiques ni sensibles : dispensé, comme avant.
  const light = lotRun([{ id: 'a1', sensitive: false, logic: false }, { id: 'b1', sensitive: false, logic: false }])
  expect(needsReview(light)).toBe(false)
  expect(isLotSecurityDue(light)).toBe(false)
  // Un ticket rattaché à un lot d'un seul ticket : la revue du lot revient.
  const attached = lotRun([{ id: 'a1', sensitive: false, logic: true }, { id: 'x1', sensitive: false, logic: true }])
  expect(needsReview(attached)).toBe(true)
})

test('sans groupes, un lot d’un seul ticket : la consigne d’/implement dit qu’il n’a pas de revue du lot, et la fin du lot n’en attend pas', async ($, on) => {
  const clock = mock.clock(on, { now: 70_000_000 })
  world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', tickets: [TICKETS[0]] } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  const text = String((await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text)
  await clock.advance(1000)
  expect(text).toContain('A lot of a single ticket, attached ones included, has no lot review (section 4: it counts as a group of a single ticket)')
  expect(text).toContain('the lot review done (none for a lot of a single ticket) and its security settled')
})

test('l’avis d’un lot d’un seul ticket, rejoué contre le modèle : il tranche sa sécurité ; conseillé, la revue de sécurité part une fois par passage, un ticket rouvert puis refini en ouvre un neuf', () => {
  const board0 = { ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [{ ...newRun('implement', 1_000, 'Lot'), owner: 's', auto: { onAt: 1_500, onBy: 's' } } as Run] } as Board
  board0.activeId = board0.runs[0]!.id
  const added = applyReport(board0, { tickets: [{ id: 'a1', name: 'Un', sensitive: false, logic: true }] }, 2_000).board
  const done = applyReport(added, { set: [{ id: 'a1', status: 'done' }] }, 3_000).board
  expect(isLotSecurityDue(activeRun(done)!)).toBe(true)
  // L'appel que dicte lotAdviceText, tel quel : sans "group", il tranche la sécurité du lot.
  const declined = applyReport(done, { security: { advised: false, why: 'rien à risque' } }, 4_000).board
  expect(isLotSecurityDue(activeRun(declined)!)).toBe(false)
  // Conseillé : la revue de sécurité part une fois pour ce passage.
  const advised = applyReport(done, { security: { advised: true, why: 'un jeton' } }, 4_000).board
  const first = autoDecision(activeRun(advised)!, {}, false)
  expect(first.kind === 'send' && first.action.kind).toBe('security')
  const key1 = first.kind === 'send' ? first.action.key : ''
  const marked = { ...activeRun(advised)!, autoSent: [{ key: key1, at: 4_100, startedAt: 4_100 }] } as Run
  expect(autoDecision(marked, {}, false).kind === 'send').toBe(false)
  // Le ticket rouvert puis refini : un nouveau passage, son avis conseillé ; la marque du premier ne le retient pas.
  const board1 = { ...advised, runs: [marked] } as Board
  const reopened = applyReport(board1, { set: [{ id: 'a1', status: 'doing' }] }, 5_000).board
  const refinished = applyReport(reopened, { set: [{ id: 'a1', status: 'done' }] }, 6_000).board
  const again = applyReport(refinished, { security: { advised: true, why: 'un jeton encore' } }, 7_000).board
  const second = autoDecision(activeRun(again)!, {}, false)
  expect(second.kind === 'send' && second.action.kind).toBe('security')
  expect(second.kind === 'send' && second.action.key).not.toBe(key1)
})
