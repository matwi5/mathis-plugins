// La consigne d'/implement d'un lot sans groupes : la discussion du parcours fait le lot elle-même et
// suit la procédure d'une session liée de groupe (reference/procedure-groupe.md), citée par son chemin,
// avec une correspondance de lecture et cinq exceptions, au lieu d'un texte à part. Avec des groupes,
// la consigne reste celle d'avant. procedure-groupe.test.mjs vérifie, dans les sources, que les
// sections citées existent et que les exceptions sont les cinq.

import { expect, mock, test } from 'claude-code/testing'

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

/** Un parcours découpé, avec ou sans groupes, puis la consigne d'/implement. */
const implement = async ($: any, on: any, withGroups: boolean): Promise<string> => {
  mock.clock(on, { now: 96_000_000 })
  world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot', tickets: TICKETS, ...(withGroups ? { groups: GROUPS } : {}) } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  return String((await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text)
}

/** Les textes réservés aux groupes, absents d'un lot sans groupes. */
const GROUP_ONLY = ['for each group', '↗ Session liée', '"group": "<id>"', 'do not launch it yourself']

test('sans groupes, la consigne d’/implement cite la procédure par son chemin, ses sections, la correspondance et les cinq exceptions', async ($, on) => {
  const text = await implement($, on, false)
  expect(text).toMatch(/\S+\/reference\/procedure-groupe\.md/)
  expect(text).toContain('sections 1 (« Avant le premier ticket »), 2 (« Chaque ticket, un par un et dans l\'ordre »), 3 (« Règles de travail »), 4 (« Revue du groupe »), 5 (« Revue de sécurité »), 7 (« La consigne des relecteurs »), 8 (« Le fichier des choix déjà déclarés ») and 9 (« Sans git »)')
  // La correspondance de lecture, la base du lot comprise.
  expect(text).toContain('« la discussion principale » is you')
  expect(text).toContain('what the procedure sends to it (SendMessage, the relay) you tell the user directly')
  expect(text).toContain('questions go as text in your message')
  expect(text).toContain('« au retour du groupe » reads « at the run\'s report »')
  expect(text).toContain('the pause of the run seen by a linked session (section 3) does not concern you')
  expect(text).toContain('a visual to validate is shown and asked directly')
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
  // Le compte rendu de la section 6 : celui du parcours.
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
  expect(text).toContain('propose them to the user as a « durcissement » group')
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
  for (const old of ['for each group', '↗ Session liée', 'do not launch it yourself']) expect(withGroups).toContain(old)
  expect(withGroups).not.toContain('procedure-groupe.md')
  expect(withGroups).toContain('git write-tree')
})

test('le même parcours, sans puis avec des groupes : seules changent les lignes des groupes et celles du lot', async ($, on) => {
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
