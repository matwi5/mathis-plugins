import { expect, mock, test } from 'claude-code/testing'
import { memoryDisk } from './disque-memoire.ts'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
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
/** Une mission découpé en deux groupes : la consigne d'/implement avec groupes, celle d'avant le lot sans groupes. */
const grouped = async ($: any) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
}

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
  memoryDisk(on)
  world(on)
  await start($)
  await grouped($)
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
  expect(implement).toContain("The ticket's real commit still comes after its review: when a file of the ticket changed after the last snapshot (a fix, its Status: line), first pin the snapshot again with all the ticket\'s files, right before the git add of the fixes; then git add each of its files again")
  expect(implement).not.toMatch(/\$\(/)
})

// Rétro de l'onglet Agents : groupes trop gros (L3 a), ticket sensible en tête sans raison, écriture
// hors du dépôt découverte en route, décisions sensibles nées des revues, skill cité sans son nom.
test('le découpage borne les groupes à 5 tickets, range le ticket sensible, et fait trancher au cadrage', async ($, on) => {
  mock.clock(on, { now: 96_200_000 })
  memoryDisk(on)
  world(on)
  await start($)
  const tickets = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text as string
  expect(tickets).toContain('A group holds 5 tickets at most: its tickets share the same area of the code, so the worker reuses the context loaded by one ticket for the next, and an extra group (a new worker that rereads the area, its group reviews, the follow-up by the manager) costs far more than a compaction; the first ticket brings the context of the worker to 200 to 400k tokens depending on the project, each next one adds 20 to 150k, and past about 600k the automatic compaction is the safety net')
  expect(tickets).toContain('keep a sensitive ticket with other tickets rather than alone')
  expect(tickets).toContain('In a group, a sensitive ticket goes first when it blocks the next one, or when it is heavy and independent (its bug pass runs in xhigh: it deletes data or touches concurrency), before the context fills up')
  expect(tickets).not.toContain('goes first only when it blocks the next one')
  // Rétro de la mission « Coordinateur de parcours » : groupes de 5 tickets sensibles compactés vers le 4e, ticket
  // posé sur un moment que la procédure ne donne presque jamais, cycle de vie posé après les revues, liste recopiée périmée.
  expect(tickets).toContain('a group whose every ticket is sensitive holds 3 to 4 tickets')
  expect(tickets).toContain('a ticket copies the useful sentence of a series word for word in its text, besides the series\' title, instead of only pointing to it')
  expect(tickets).toContain('Before grouping, check the overlap with the other missions in progress')
  expect(tickets).toContain('quotes the real order of its steps, read in that procedure (path and line), never from memory')
  expect(tickets).toContain('A ticket that writes persisted data asks, at the split and not during the reviews, the lifecycle question of the framing of a sensitive ticket')
  expect(tickets).toContain('a ticket that replaces a rule copied on several surfaces (a common rule, the procedure, the mod\'s instructions, a skill) adds, for each copy, a distinctive fragment of its old wording in that copy\'s language to the termes-retires.txt of the plugin whose checks read that copy')
  expect(tickets).not.toContain('reread ask-matt')
  expect(tickets).toContain('A write planned outside the repository (a file of another repository, of ~/.claude or anywhere else on the machine) is a decision to take with the user before the group is launched')
  expect(tickets).toContain('erasures that overlap, a resume after an interruption, the state after /reload-plugins, and what a failure message says')
  expect(tickets).toContain('the one-sentence invariant of its persisted data')
  // Un ticket sensible étroit, et les fichiers des appelants d'une fonction dont le contrat change.
  expect(tickets).toContain('A sensitive ticket carries only the sensitive change: a tool or a large test with no link to the sensitive area makes a ticket of its own, in the same group')
  expect(tickets).toContain('also names in "files" the files of its callers, found by a search quoted in the ticket (the command and its result)')
  expect(tickets).not.toContain('« charger le skill <name> »')
})

test('la spec fait trancher les cas sensibles et nomme le skill dont elle a besoin ; la passe « bogues » reçoit l’invariant', async ($, on) => {
  mock.clock(on, { now: 96_300_000 })
  memoryDisk(on)
  world(on)
  await start($)
  const spec = (await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })).text as string
  expect(spec).toContain('For a ticket in a sensitive area, settle with the user while framing')
  expect(spec).toContain('the instructions file of its bug pass copies it')
  expect(spec).toContain('says « charger le skill <name> » where it needs it')
  // Rétro de la mission « Coordinateur de parcours » : l'index des décisions en vigueur, et la phrase utile recopiée.
  expect(spec).toContain('The mission\'s DECISIONS.md starts with a short index « Décisions en vigueur » (one line per series still in force: its title, the tickets it governs)')
  expect(spec).not.toContain('A group holds 5 tickets at most')
  expect(spec).not.toContain('reread ask-matt')
  await grouped($)
  const implement = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text as string
  expect(implement).toContain("and in its instructions file the ticket's invariant when it has one (the sentence of what its persisted data must never become, fixed at framing): the reviewer looks first for what breaks it")
})

test('dans un worker, les consignes de revue sont celles de la procédure, citée par son chemin', async ($, on) => {
  mock.clock(on, { now: 96_500_000 })
  memoryDisk(on)
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
  expect(text).toMatch(/puis lire la procédure d'un worker de groupe, \S*reference\/procedure-groupe\.md/)
  expect(text).not.toContain('jamais un hash seul')
  expect(text).not.toContain('lui donner le nom de la branche')
  // La procédure cite la méthode de la relecture du fond et de la forme ; son chemin installé varie.
  expect(text).toMatch(/le fichier de méthode de la relecture du fond et de la forme, \S+\/reference\/relecture-fond-forme\.md/)
})

// Relecture du fond et de la forme : la ligne « Lecteur » d'un ticket la déclenche (spec xhigh-groupe, Q11).
test('le découpage fait porter une ligne « Lecteur » au ticket dont le livrable est un document lu par d’autres', async ($, on) => {
  mock.clock(on, { now: 96_600_000 })
  memoryDisk(on)
  world(on)
  await start($)
  const tickets = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text as string
  expect(tickets).toContain('a line « Lecteur : <who> »')
  expect(tickets).toContain('neither a code ticket nor an internal working document carries it')
  expect(tickets).toContain('nothing new is sent to the tool')
})

test('dans la discussion, la revue d’un ticket qui a une ligne « Lecteur » lance aussi la relecture du fond et de la forme, avec sa méthode', async ($, on) => {
  mock.clock(on, { now: 96_700_000 })
  memoryDisk(on)
  world(on)
  await start($)
  await grouped($)
  const implement = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text as string
  // L'étape de revue l'annonce, la consigne à part donne le relecteur et le chemin de la méthode.
  expect(implement).toContain('for a ticket with a « Lecteur » line, the content and form review')
  expect(implement).toMatch(/Content and form review: [^\n]*in the same message as the ticket's reviewer, on the same target/)
  expect(implement).toContain('a reviewer subagent (Agent tool, general-purpose, model opus, effort high, passed explicitly), read-only')
  expect(implement).toMatch(/the path of the content and form review method file, \S+\/reference\/relecture-fond-forme\.md/)
  // Un ticket ancien sans ligne : la session nomme le lecteur et le déclare.
  expect(implement).toContain('name the reader yourself and declare it in {"decided": …}')
  // Le relecteur reçoit le lecteur par son fichier de consignes, celui du ticket ou celui nommé par la session.
  expect(implement).toContain('its instructions file gives the reader (the « Lecteur » line, or the one you named)')
  // Ses correctifs avec ceux de la revue, ses constats dans `form`, à part de l'axe Spec.
  expect(implement).toContain('in the commit of the review fixes, before the ticket turns done')
  expect(implement).toContain('its findings go in "form" of "review", never in "spec"')
  expect(implement).not.toContain('count with the Spec axis')
  // Ni le découpage ni la spec ne la lancent.
  const spec = (await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })).text as string
  expect(spec).toContain('For a ticket in a sensitive area, settle with the user while framing')
  expect(spec).not.toContain('Content and form review:')
})

// La version se pose en fin de mission par /project:version : le ticket de version d'un groupe était
// entré en collision avec le même numéro publié par une autre discussion (rétro de la mission xhigh, r2).
test('ni la spec ni le découpage ne prévoient de ticket de version : /project:version le fait en fin de mission', async ($, on) => {
  mock.clock(on, { now: 96_800_000 })
  memoryDisk(on)
  world(on)
  await start($)
  for (const skill of ['mattpocock-skills:to-tickets', 'mattpocock-skills:to-spec']) {
    const text = (await $.skill.prompt({ skill, text: 'x' })).text as string
    expect(text).toContain('No ticket for the version or the CHANGELOG: a worker touches neither (its report lists what the CHANGELOG must say)')
    expect(text).toContain("the version is set once, at the end of the mission, by /project:version, which the user launches from the dashboard's Version button")
  }
  const implement = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text as string
  expect(implement).not.toContain('No ticket for the version')
})

// Le seul défaut important d'un groupe venait de la spec : l'effort figé au clic, lu après un changement (r7).
test('la spec se demande si un texte écrit à un moment est lu plus tard, et ce qu’il dit si la valeur a changé', async ($, on) => {
  mock.clock(on, { now: 96_900_000 })
  memoryDisk(on)
  world(on)
  await start($)
  const spec = (await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })).text as string
  expect(spec).toContain('« un texte écrit à un moment est-il lu plus tard, et que dit-il si la valeur a changé entre-temps ? »')
  const tickets = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text as string
  expect(tickets).not.toContain('un texte écrit à un moment est-il lu plus tard')
})

// Rétro de la mission « Coordinateur de parcours » : ask-matt relu au cadrage avant de proposer un départ.
test('le cadrage relit ask-matt avant de proposer un point de départ', async ($, on) => {
  mock.clock(on, { now: 96_400_000 })
  memoryDisk(on)
  world(on)
  await start($)
  const grill = (await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })).text as string
  expect(grill).toContain('Before proposing a starting point (the next skill once the framing is agreed, or the start of a mission), reread ask-matt, a skill that cannot be invoked by you:')
  expect(grill).toContain('quote the line that justifies the start')
  // Le chemin vient de flow-board (relu sous le dossier des plugins, sans « .. ») : Claude ne le construit jamais
  // d'après un autre fichier. Introuvable ici (aucun registre des plugins) : la consigne le dit.
  expect(grill).toContain('flow-board did not find it among the installed plugins: say so to the user, never read a path written from memory or built from another file')
  expect(grill).not.toContain('installed_plugins.json')
})
