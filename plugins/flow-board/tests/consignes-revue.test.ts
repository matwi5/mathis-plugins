import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

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
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

const LOT = {
  tickets: [
    { id: 'a1', name: 'Un', files: ['src/a.ts'] },
    { id: 'e1', name: 'Enquête', files: ['travail/sql'] },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'E', name: 'Enquêtes', tickets: ['e1'] },
  ],
}

// /code-review tourne en exécution dérivée et ne reçoit que ses arguments : ses consignes passent par
// un fichier dont le chemin suit la cible (forme essayée avec Claude Code 2.1.310), et la cible est une plage.
test('dans la discussion, chaque revue reçoit ses consignes par un fichier, sur une plage, et le relecteur n’écrit pas', async ($, on) => {
  mock.clock(on, { now: 96_000_000 })
  world(on)
  await start($)
  const implement = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text as string
  expect(implement).toContain('/code-review <level> <base>..HEAD consignes : <path>')
  expect(implement).toContain('never a commit hash alone')
  expect(implement).toContain('the points left to the user')
  // Une zone sensible : pas de --fix, la session n'applique que ce qu'elle retient.
  expect(implement).toContain('without --fix: the session applies itself only the findings it keeps')
  // Un relecteur n'écrit jamais dans l'arbre : la preuve rouge reste à la session.
  expect(implement).toContain('never write in the working tree, not even for a moment')
  // Les constats triés : seuls les importants sont corrigés, une remarque mineure ne coûte pas un tour de revue.
  expect(implement).toContain('tag every finding Important, Nit or Pre-existing')
  expect(implement).toContain('the Nits (style, naming, a cleanup that changes no behaviour) are not fixed and given as a count only, without detail')
  expect(implement).toContain('for a defect, name its class')
  expect(implement).toContain('config/rules/agents.md')
  // L2 a : la passe « bogues » d'un ticket sensible relit un instantané posé sur une référence à part.
  expect(implement).toContain('git add <the ticket\'s files, by path>, then git diff --cached --name-only must list the ticket\'s files and nothing else')
  expect(implement).toContain('git write-tree (prints <tree>), git commit-tree <tree> -p HEAD -m "flow-board snapshot <ticket id>" (prints <snapshot>), git update-ref refs/worktree/flow-board/<ticket id> <snapshot>')
  expect(implement).toContain('Both reviews then read the range refs/worktree/flow-board/<ticket id>^..refs/worktree/flow-board/<ticket id>')
  expect(implement).toContain('a next ticket that touches the same files waits')
  expect(implement).not.toContain('git worktree add')
  expect(implement).toContain("The ticket's real commit still comes after its review: git add each of its files again")
  expect(implement).not.toMatch(/\$\(/)
})

// Rétro de l'onglet Agents : groupes trop gros (L3 a), ticket sensible en tête sans raison, écriture
// hors du dépôt découverte en route, décisions sensibles nées des revues, skill cité sans son nom.
test('le découpage borne les groupes à 5 tickets, range le ticket sensible, et fait trancher au cadrage', async ($, on) => {
  mock.clock(on, { now: 96_200_000 })
  world(on)
  await start($)
  const tickets = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text as string
  expect(tickets).toContain('A group holds 5 tickets at most: the context of a linked session reached 820 to 920k tokens, close to its ceiling of about 1M, for 6 tickets (the first ticket costs 375 to 500k, each next one 60 to 150k)')
  expect(tickets).toContain('keep a sensitive ticket with other tickets rather than alone')
  expect(tickets).toContain('In a group, a sensitive ticket goes first only when it blocks the next one')
  expect(tickets).toContain('A write planned outside the repository (a file of another repository, of ~/.claude or anywhere else on the machine) is a decision to take with the user before the group is launched')
  expect(tickets).toContain('erasures that overlap, a resume after an interruption, the state after /reload-plugins, and what a failure message says')
  expect(tickets).toContain('the one-sentence invariant of its persisted data')
  expect(tickets).not.toContain('« charger le skill <name> »')
})

test('la spec fait trancher les cas sensibles et nomme le skill dont elle a besoin ; la passe « bogues » reçoit l’invariant', async ($, on) => {
  mock.clock(on, { now: 96_300_000 })
  world(on)
  await start($)
  const spec = (await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })).text as string
  expect(spec).toContain('For a ticket in a sensitive area, settle with the user while framing')
  expect(spec).toContain('the instructions file of its bug pass copies it')
  expect(spec).toContain('says « charger le skill <name> » where it needs it')
  expect(spec).not.toContain('A group holds 5 tickets at most')
  const implement = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text as string
  expect(implement).toContain("and in its instructions file the ticket's invariant when it has one (the sentence of what its persisted data must never become, fixed at framing): the reviewer looks first for what breaks it")
})

test('dans une session liée, les consignes de revue sont celles de la procédure, citée par son chemin', async ($, on) => {
  mock.clock(on, { now: 96_500_000 })
  const filled = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  const text = filled.at(-1)!
  // Les consignes de revue (fichier de consignes, cible en plage, instantané, invariant, consigne des
  // relecteurs) sont dans la procédure des sessions de groupe : tests/procedure-groupe.test.mjs.
  expect(text).toMatch(/puis lire la procédure d'une session liée de groupe, \S*reference\/procedure-groupe\.md/)
  expect(text).not.toContain('jamais un hash seul')
  expect(text).not.toContain('lui donner le nom de la branche')
})
