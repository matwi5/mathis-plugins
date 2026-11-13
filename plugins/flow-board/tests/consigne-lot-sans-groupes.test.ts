// La consigne d'/implement d'un lot sans groupes : la discussion de la mission fait le lot elle-même et
// suit la procédure d'un worker de groupe (reference/procedure-groupe.md), citée par son chemin,
// avec une correspondance de lecture et cinq exceptions, au lieu d'un texte à part. Avec des groupes,
// la consigne reste celle d'avant. procedure-groupe.test.mjs vérifie, dans les sources, que les
// sections citées existent et que les exceptions sont les cinq.

import { expect, mock, test } from 'claude-code/testing'
import { memoryDisk } from './disque-memoire.ts'

import { applyReport, emptyBoard, newRun, openQuestions } from '../hooks/model.ts'
import { activeRun, currentPhase } from '../hooks/basics.ts'
import type { Board } from '../types'

const TOOL = 'mcp__flow-board__flow'

const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
}

const TICKETS = [
  { id: 'a1', name: 'Un', files: ['src/a.ts'] },
  { id: 'b1', name: 'Deux', files: ['src/b.ts'] },
]
const GROUPS = [
  { id: 'A', name: 'Code', tickets: ['a1'] },
  { id: 'B', name: 'Autre', tickets: ['b1'] },
]

/** Une mission découpé, avec ou sans groupes, puis la consigne d'/implement. */
const implement = async ($: any, on: any, withGroups: boolean): Promise<string> => {
  mock.clock(on, { now: 96_000_000 })
  memoryDisk(on)
  world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot', tickets: TICKETS, ...(withGroups ? { groups: GROUPS } : {}) } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  return String((await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text)
}

/** Les textes réservés aux groupes, absents d'un lot sans groupes. */
const GROUP_ONLY = ['for each group', '↗ Worker', '"group": "<id>"', 'do not launch it yourself']

test('sans groupes, la consigne d’/implement cite la procédure par son chemin, ses sections, la correspondance et les cinq exceptions', async ($, on) => {
  const text = await implement($, on, false)
  expect(text).toMatch(/\S+\/reference\/procedure-groupe\.md/)
  expect(text).toContain('sections 1 (« Avant le premier ticket »), 2 (« Chaque ticket, un par un et dans l\'ordre »), 3 (« Règles de travail »), 4 (« Revue du groupe »), 5 (« Revue de sécurité »), 7 (« La consigne des relecteurs »), 8 (« Le fichier des choix déjà déclarés ») and 9 (« Sans git »)')
  // La procédure est un noyau et des annexes : les sections 4, 5 et 9 se lisent dans la leur.
  expect(text).toContain('in order (sections 4 and 5 are in procedure-groupe-fin.md, section 9 in procedure-groupe-sans-git.md, next to it)')
  // La correspondance de lecture, la base du lot comprise.
  expect(text).toContain('« le manager » is you')
  expect(text).toContain('what the procedure sends to it (SendMessage, the relay) you tell the user directly')
  expect(text).toContain('questions go as text in your message')
  expect(text).toContain('« au retour du groupe » reads « at the mission\'s report »')
  expect(text).toContain('the pause of the mission seen by a worker (section 3) does not concern you')
  expect(text).toContain('a visual to validate is shown and asked directly')
  // Un ticket qui bute : pas mis de côté, la même définition d'un essai, puis l'arrêt et le rappel du worker de diagnostic.
  expect(text).toContain('a ticket that stalls after three approaches (section 3, « Ticket qui bute », in procedure-groupe-cas.md) is not set aside: the same definition of an attempt holds, then you stop on that ticket and remind the user of « 🐞 Bug · worker » (Opus high, then xhigh)')
  expect(text).toContain('« le groupe » reads « the lot »; its <base> is the commit before the lot\'s first ticket')
  // Les cinq exceptions, et rien d'autre.
  const exceptions = text.match(/Five exceptions, and no other: (.*?)\. Section 6/)
  expect(exceptions).not.toBeNull()
  expect(exceptions![1]!.split('; ').length).toBe(5)
  expect(exceptions![1]).toContain('the relay and SendMessage')
  expect(exceptions![1]).toContain('the ban on button questions')
  expect(exceptions![1]).toContain('« do not launch <implement> » (section 2, point 10)')
  expect(exceptions![1]).toContain('section 10, replaced by the auto mode block of these instructions')
  expect(exceptions![1]).toContain('a worktree of its own')
  // Le compte rendu de la section 6 : celui de la mission.
  expect(text).toContain('Section 6 (« Compte rendu ») is replaced by /flow-board:compte-rendu')
  // Les commandes de ce poste, que la procédure attend du prompt.
  expect(text).toContain('<tdd>: /mattpocock-skills:tdd')
  expect(text).toContain('<revue du ticket>: /mattpocock-skills:code-review')
  expect(text).toMatch(/the security review method file, \S+\/reference\/revue-securite\.md/)
  expect(text).toMatch(/the content and form review method file, \S+\/reference\/relecture-fond-forme\.md/)
  for (const old of GROUP_ONLY) expect(text).not.toContain(old)
})

test('sans groupes, Claude lance lui-même la revue du lot, et la ligne de fin attend sa sécurité ou la dispense', async ($, on) => {
  const text = await implement($, on, false)
  expect(text).toContain('launch the lot review yourself (section 4), in this discussion, once the last ticket is committed and reviewed')
  expect(text).toContain('/code-review high --fix <lot base>..HEAD consignes : <path>')
  expect(text).toContain('its security advice in the same message (section 5), sent without "group"')
  // L'avis daté avant le chargement de la revue du lot ne compte pas : il part après lui.
  expect(text).toContain('send the advice only once /code-review has loaded, never before it: an advice dated before the lot review counts for no pass')
  expect(text).toContain('When every ticket of the lot is done, the lot review done and its security settled (or the lot dispensed: every ticket sent with "sensitive": false and "logic": false): {"complete": true}')
  // Seuls les constats antérieurs de gravité moyenne ou plus, ou qui violent un invariant ; les autres vont au journal.
  expect(text).toContain('propose those of medium severity or more, or that break an invariant, to the user as a « durcissement » group')
  expect(text).toContain('the others go to the journal, under « À reprendre »')
})

test('sans groupes, les étapes de ticket gardent leurs ids et renvoient aux points de la section 2', async ($, on) => {
  const text = await implement($, on, false)
  const steps = text.split('\n').find(l => l.startsWith('- Steps of implement'))!
  expect(steps).toContain('read (procedure, section 2, points 1 and 2')
  expect(steps).toContain('tdd (procedure, section 2, point 3')
  expect(steps).toContain('checks (procedure, section 2, point 3')
  expect(steps).toContain('review (procedure, section 2, points 4 to 8')
  // Un ticket sensible n'a que l'axe Spec : l'étape ne dit plus « les deux axes » pour tout ticket.
  expect(steps).toContain('the reviewer of the ticket (both axes outside sensitive areas, the Spec axis alone for a sensitive ticket)')
  expect(steps).not.toContain('both axes in a single reviewer, the content')
  expect(steps).toContain('commit (procedure, section 2, point 9')
  // Le détail n'est plus recopié : il est dans la procédure.
  expect(steps).not.toContain('git write-tree')
})

test('avec des groupes, la consigne d’/implement garde ses textes de groupe et ne cite pas la procédure', async ($, on) => {
  const withGroups = await implement($, on, true)
  for (const old of ['for each group', '↗ Worker', 'do not launch it yourself']) expect(withGroups).toContain(old)
  expect(withGroups).not.toContain('procedure-groupe.md')
  expect(withGroups).toContain('git write-tree')
})

test('la même mission, sans puis avec des groupes : seules changent les lignes des groupes et celles du lot', async ($, on) => {
  const without = (await implement($, on, false)).split('\n')
  await $.tool.call({ tool: TOOL, groups: GROUPS } as any)
  const withGroups = String((await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text).split('\n')
  const head = (l: string) => l.slice(0, 30)
  // Les lignes communes sont identiques ; celles des groupes reviennent toutes, et rien d'autre.
  expect(withGroups.filter(l => !without.includes(l)).map(head)).toEqual([
    '- Steps of implement, in order',
    '- In this discussion, /code-re',
    '- Then, for each group once al',
    '- A group whose every ticket w',
    '- Security review: in the same',
    '- When every ticket of the lot',
  ])
  expect(without.filter(l => !withGroups.includes(l)).map(head)).toEqual([
    '- Steps of implement, in order',
    '- This lot has no groups: you ',
    '- Five exceptions, and no othe',
    '- The lot review: launch the l',
    '- When every ticket of the lot',
  ])
})

test('un plan de groupes enregistré pendant l’Implémentation sans groupes : la réponse de l’outil le dit, une fois', async ($, on) => {
  await implement($, on, false)
  const first = JSON.stringify(await $.tool.call({ tool: TOOL, groups: GROUPS } as any))
  expect(first).toContain('the no-groups procedure of the /implement instructions no longer applies')
  const again = JSON.stringify(await $.tool.call({ tool: TOOL, groups: GROUPS } as any))
  expect(again).not.toContain('no longer applies')
})

test('un plan de groupes arrivé après un {"complete": true} trop tôt de l’Implémentation sans groupes le dit aussi', async ($, on) => {
  await implement($, on, false)
  await $.tool.call({ tool: TOOL, set: TICKETS.map(t => ({ id: t.id, status: 'done' })), complete: true } as any)
  const answer = JSON.stringify(await $.tool.call({ tool: TOOL, groups: GROUPS } as any))
  expect(answer).toContain('the no-groups procedure of the /implement instructions no longer applies')
})

test('sans groupes, les envois « group » de la procédure se lisent sans lui', async ($, on) => {
  const text = await implement($, on, false)
  expect(text).toContain('what the procedure sends with "group" (section 2, point 8, and section 5) you send without it')
})

// Le groupe « durcissement » proposé attend la réponse : `complete` était parti avant elle, le tableau de bord
// était passé à la suite, et le message proposait juste en dessous le compte rendu, lancé ensuite par erreur.
for (const withGroups of [false, true]) {
  test(`fin de lot ${withGroups ? 'avec' : 'sans'} groupes : un groupe « durcissement » proposé se déclare dans "waiting", et "complete" ne part qu’après la réponse`, async ($, on) => {
    const text = await implement($, on, withGroups)
    expect(text).toContain('{"complete": true}, unless you propose a « durcissement » group')
    expect(text).toContain('until they answer, declare that question in "waiting" on the implement phase instead of sending {"complete": true} ({"waiting": [{"id": "durcissement", "phase": "implement", "text": "<the proposal, short>"}]})')
    expect(text).toContain('withdraw it as soon as they answer ({"waiting": [{"id": "durcissement", "answered": true}]}: an answered question left open stays on the dashboard as waiting for them)')
    expect(text).toContain('send {"complete": true} only once the answer came (the group refused, or the group created and done)')
    expect(text).toContain('the message that proposes the group suggests neither /flow-board:compte-rendu nor the delivery')
    const waiting = text.indexOf('declare that question in "waiting"')
    expect(waiting).toBeGreaterThan(-1)
    expect(text.indexOf('send {"complete": true} only once the answer came')).toBeGreaterThan(waiting)
  })
}

// L'appel dicté, rejoué contre le modèle : la question garde la phase d'implémentation ouverte ; la réponse,
// envoyée avec `complete`, la dit faite et retire la question.
test('l’appel dicté se rejoue : "waiting" sur la phase d’implémentation la garde courante, puis "answered" et "complete" la disent faite', () => {
  const run = newRun('implement', 1_000, 'Lot')
  let board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = applyReport(board, { tickets: [{ id: 't1', name: 'Un', status: 'done' }] }, 2_000).board
  const phase = currentPhase(activeRun(board)!).skill
  expect(phase).toBe('implement')
  board = applyReport(board, { waiting: [{ id: 'durcissement', phase: 'implement', text: 'Créer le groupe « durcissement » (F1, F2) ?' }] }, 3_000).board
  expect(openQuestions(activeRun(board)!).map(q => q.id)).toEqual(['durcissement'])
  expect(currentPhase(activeRun(board)!)).toMatchObject({ skill: 'implement' })
  expect(currentPhase(activeRun(board)!).status).not.toBe('done')
  board = applyReport(board, { waiting: [{ id: 'durcissement', answered: true }], complete: true }, 4_000).board
  expect(openQuestions(activeRun(board)!)).toEqual([])
  expect(currentPhase(activeRun(board)!)).toMatchObject({ skill: 'implement', status: 'done' })
})

// L'autre réponse : le groupe « durcissement » accepté. La question se retire dès la réponse (ouverte, elle
// resterait « Questions qui t'attendent » pendant tout le groupe), ses tickets s'ajoutent, et `complete` attend
// qu'ils soient faits.
test('l’appel dicté se rejoue aussi quand le groupe « durcissement » est créé et fait avant complete', () => {
  const run = newRun('implement', 1_000, 'Lot')
  let board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = applyReport(board, { tickets: [{ id: 't1', name: 'Un', status: 'done' }] }, 2_000).board
  board = applyReport(board, { waiting: [{ id: 'durcissement', phase: 'implement', text: 'Créer le groupe « durcissement » (F1) ?' }] }, 3_000).board
  expect(openQuestions(activeRun(board)!).map(q => q.id)).toEqual(['durcissement'])
  board = applyReport(board, { waiting: [{ id: 'durcissement', answered: true }], tickets: [{ id: 'd1', name: 'Durcir F1' }] }, 3_500).board
  expect(openQuestions(activeRun(board)!)).toEqual([])
  expect(currentPhase(activeRun(board)!)).toMatchObject({ skill: 'implement' })
  expect(currentPhase(activeRun(board)!).status).not.toBe('done')
  board = applyReport(board, { set: [{ id: 'd1', status: 'done' }] }, 3_800).board
  expect(currentPhase(activeRun(board)!).status).not.toBe('done')
  board = applyReport(board, { complete: true }, 4_000).board
  expect(openQuestions(activeRun(board)!)).toEqual([])
  expect(currentPhase(activeRun(board)!)).toMatchObject({ skill: 'implement', status: 'done' })
  expect(activeRun(board)!.tickets.map(t => [t.id, t.status])).toEqual([['t1', 'done'], ['d1', 'done']])
})
