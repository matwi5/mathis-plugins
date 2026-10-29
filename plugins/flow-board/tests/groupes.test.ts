import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const START = 'mcp__ccd_session__start_session'

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

/** Un dépôt git : les sessions liées y ont chacune leur worktree. */
const inRepo = (on: any) => on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))

// Un lot proche de celui de polepredict : une chaîne côté worker, un nettoyage d'app indépendant,
// puis l'alignement qui attend les deux.
const L = '1200000000000101'
const R = '1200000000000102'
const F = '1200000000000103'
const N = '1200000000000104'
const S = '1200000000000105'
const M = '1200000000000106'
const D = '1200000000000107'
const LOT = [
  { id: L, name: 'LIGHTS ON/OFF', blockedBy: [] },
  { id: R, name: 'Règle SC/VSC', blockedBy: [L] },
  { id: F, name: 'Fermetures VSC', blockedBy: [R] },
  { id: N, name: 'Nettoyages revue', blockedBy: [] },
  { id: S, name: 'scPeriods aligné', blockedBy: [F, N] },
  { id: M, name: 'CLAUDE.md', blockedBy: [F, N] },
  { id: D, name: 'Recalcul résumés', blockedBy: [F] },
]
const GROUPS = [
  { id: 'A', name: 'Worker SC/VSC', tickets: [L, R, F], why: 'mêmes règles du worker', files: ['worker/sc'] },
  { id: 'B', name: 'App revue', tickets: [N], files: ['app/review'] },
  { id: 'C', name: 'Alignement', tickets: [S, D, M], files: ['app/sc', 'CLAUDE.md'] },
]

const start = async ($: any) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  return $.tool.call({ tool: TOOL, title: 'Lot SC', tickets: LOT, groups: GROUPS } as any)
}

test('les groupes se rangent par vague : A ∥ B d’abord, C ensuite', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 60_000_000 })
  mock.store(on)
  engine(on)
  await start($)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Worker SC\/VSC/ })).toBeDefined()
    // Un groupe se fait en session liée : plus de « cette discussion » ni de « nouvelle discussion ».
    expect(await ui.find({ type: 'Text', text: /cette discussion|nouvelle discussion/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /mêmes règles du worker · 1.fichier$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Vague 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /∥.B/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /attend A, B/ })).toBeDefined()
    // Deux groupes prêts, chacun sa session liée ; C attend.
    expect(await ui.find({ key: 'launch-linked-A' })).toBeDefined()
    expect(await ui.find({ key: 'launch-linked-B' })).toBeDefined()
    expect(await ui.find({ key: 'launch-linked-C' })).toBeUndefined()
    expect(await ui.find({ key: 'launch-parallel-linked' })).toBeDefined()
    await ui.unmount()
  }
})

test('⇉ confie le seul lot A ∥ B à des sessions liées, sans /implement-spec', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 61_000_000 })
  mock.store(on)
  const filled = engine(on)
  inRepo(on)
  await start($)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'launch-parallel' })).toBeUndefined()
  await ui.press({ key: 'launch-parallel-linked' })
  const text = filled.at(-1)!
  expect(text).toMatch(/^Confie chacun de ces groupes à sa session liée, en parallèle, pour le parcours « Lot SC » : Groupe A \(Worker SC\/VSC\) : 1\) .* ∥ Groupe B \(App revue\) : 1\) /)
  // C attend A et B : il n'est pas du lot, il viendra par un lancement suivant.
  expect(text).not.toMatch(/Alignement/)
  await ui.unmount()
})

test('« ↗ Session liée » confie un groupe à une session liée : le parcours reste ici, Claude rend ses statuts', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 61_500_000 })
  mock.store(on)
  const filled = engine(on)
  on('tool.call', { tool: START }, () => ({ result: { text: 'Started session local_grpB42 (name: groupe-b).' } }))
  await start($)

  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  // Tout groupe prêt a sa session liée ; C attend.
  expect(await ui.find({ key: 'launch-linked-A' })).toBeDefined()
  expect(await ui.find({ key: 'launch-linked-B' })).toBeDefined()
  expect(await ui.find({ key: 'launch-linked-C' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /« Session liée » : Claude lance une session qui fait le groupe, et le parcours reste ici/ })).toBeDefined()
  await ui.press({ key: 'launch-linked-B' })

  const text = filled.at(-1)!
  expect(text).toMatch(/^Confie ce groupe à une session liée, pour le parcours « Lot SC » : Groupe B \(App revue\) : 1\) /)
  expect(text).toContain(`${N} — Nettoyages revue.`)
  expect(text).toMatch(/Puis lance la session, avec un titre qui commence par « Lot SC > Groupe <id> · »/)
  // L'effort de la session : medium par défaut, high pour un groupe délicat, dit en une ligne.
  expect(text).toContain("Effort de la session (<effort>) : medium par défaut ; high si le groupe a un ticket qui touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence), s'il reste des choix de conception à faire ou s'il touche plusieurs modules à la fois. Dis-moi en une ligne l'effort choisi et pourquoi.")
  // Dans l'app Desktop : start_session ; dans le CLI : claude --bg, le compte rendu revient par SendMessage.
  expect(text).toMatch(/start_session, avec initiation user_asked, context "fresh", wake_when_done true, effort "<effort>" et use_worktree false \(ce dossier n’a pas de git\)\./)
  expect(text).toMatch(/Dans le CLI \(pas de start_session\) : appelle d'abord ListAgents pour lire le nom de cette discussion et sa référence entre crochets/)
  expect(text).toContain("claude --bg -n 'Lot SC > Groupe <id> · <thème>' --effort <effort> (sans -w : ce dossier n’a pas de git) \"<prompt>\"")
  expect(text).toMatch(/de finir par un message à cette discussion \(il la réveille, même inactive\)/)
  // Le nom peut changer (renommage) : la session retrouve la discussion par sa référence, lue dans ListAgents.
  expect(text).toMatch(/Pour lui écrire, la session appelle ListAgents, trouve la ligne qui porte cette référence et envoie par SendMessage à « <nom du moment> \[<ref>\] »/)
  // La référence change au redémarrage de la discussion : la session la relit par l'outil flow, puis cherche par le nom du parcours.
  expect(text).toContain("la référence change quand cette discussion redémarre : l'outil flow de la session donne la référence du moment")
  expect(text).toContain('si aucune ligne ne porte la référence, la session cherche la ligne qui porte le nom de cette discussion (le prompt le donne aussi, en repli), jamais une session dont le titre commence par « Lot SC > » (ses sœurs), lui envoie son message, et le dit en tête de sa réponse finale')
  expect(text).toContain('{"resume": "')
  expect(text).toContain('"main": "[<ref>]"} (comme « ↻ Reprendre ici »')
  // r9 : un projet qui versionne ses règles communes : leur copie du dépôt fait foi.
  expect(text).toContain('si le projet a un dossier config/rules (des règles communes versionnées avec lui), le background dit que leur version du dépôt fait foi sur celle installée sous ~/.claude')
  // Plus de filet notify_when_idle (rétro du 26/10/2026 : cinq réveils pour un groupe, dont quatre pour rien).
  expect(text).not.toContain('notify_when_idle')
  expect(text).toContain('le message final de la session réveille cette discussion ; pour un groupe, le relais rattrape un message perdu')
  // Les décisions se relaient par renvoi au fichier de décisions, écrites avant d'être relayées ;
  // un geste humain remplacé se confirme par le porteur dans la session liée.
  expect(text).toContain("les décisions déjà prises par renvoi, sans les réécrire")
  expect(text).toContain("sans y reprendre le texte des règles")
  expect(text).toContain("s'y écrit AVANT d'être relayée, avec ma phrase exacte entre guillemets")
  expect(text).toContain("se confirme par moi directement dans la session liée")
  // Au redémarrage, le parcours passe en pause : le reprendre ici par son id.
  expect(text).toMatch(/le reprendre ici avant toute autre écriture, par l'appel flow \{"resume": "[^"]+", "main": "\[<ref>\]"\}/)
  expect(text).toMatch(/À la note de fin de la session \(dans le CLI : son message reçu par SendMessage\)/)
  const delegate = text.match(/\{"delegate": "([^"]+)", "group": "B", "main": "\[<ref>\]"\}/)
  expect(delegate).not.toBeNull()
  // La procédure de la session (tickets, revues, règles de travail, compte rendu) est dans sa
  // référence, citée par son chemin : tests/procedure-groupe.test.mjs en vérifie le contenu.
  expect(text).toMatch(/2\) puis lire la procédure d'une session liée de groupe, \S+\/reference\/procedure-groupe\.md, et la suivre jusqu'au bout/)
  expect(text).toContain("les commandes de ce poste (TDD : /mattpocock-skills:tdd ; revue du ticket : /mattpocock-skills:code-review ; /mattpocock-skills:implement est réservé à l'utilisateur)")
  expect(text).toMatch(/le fichier de méthode de la revue de sécurité, \S+\/reference\/revue-securite\.md/)
  // Sans git, la section 9 de la procédure ; sans fichier des choix, leur liste.
  expect(text).toContain("que son dossier n'a pas de git (section 9 de la procédure)")
  expect(text).toContain("la liste des choix déjà déclarés (leur fichier est hors d'atteinte : section 8 de la procédure)")
  // Le texte ne recopie plus la procédure.
  expect(text).not.toContain("un par un et dans l'ordre")
  expect(text).not.toContain('consigne des relecteurs')
  expect(text).not.toMatch(/git diff <base>\.\.HEAD/)
  expect(text).toMatch(/dans son compte rendu, que la revue du groupe a tourné \(sinon, la lui demander par SendMessage avant tout ; un groupe d'un seul ticket ni sensible ni avec logique n'en a pas : la revue de son ticket suffit\)/)
  expect(text).toMatch(/\{"security": \{"group": "<id du groupe>", "advised": true\|false, "why": "<raison>"\}\}/)
  expect(text).toMatch(/\{"returned": \["<id du groupe>"\]\}/)
  // La seule reprise demandée est celle de cette discussion après un redémarrage, jamais par la session liée.
  expect(text.match(/"resume"/g)?.length).toBe(1)
  // B attend sa session : plus de lancement, un « Annuler » tant qu'elle n'est pas partie.
  expect(await ui.find({ key: 'launch-linked-B' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /session.liée.à.lancer/ })).toBeDefined()
  expect(await ui.find({ key: 'group-linked-cancel-B' })).toBeDefined()
  await ui.press({ key: 'group-linked-cancel-B' })
  expect(await ui.find({ key: 'launch-linked-B' })).toBeDefined()
  await ui.press({ key: 'launch-linked-B' })
  await ui.unmount()

  // Claude lance la session : son titre la relie au groupe B.
  await $.tool.call({ tool: START, title: 'Groupe B · App revue', initiation: 'user_asked', prompt: 'x' } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /en.cours.·.session.liée/ })).toBeDefined()
  expect(await ui.find({ key: 'group-linked-cancel-B' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /B en session liée : son avancement .* Claude vérifie le travail à sa note de fin/ })).toBeDefined()
  await ui.unmount()

  // Le parcours est toujours actif ici : à la note de fin, Claude rend le groupe et ses statuts.
  const answer = await $.tool.call({ tool: TOOL, set: [{ id: N, status: 'done' }], returned: ['B'] } as any)
  expect(JSON.stringify(answer)).not.toMatch(/returned: no group/)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /App revue : 1.ticket fait/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /en.cours.·.session.liée/ })).toBeUndefined()
  await ui.unmount()
  // Un groupe qui n'était pas confié : Claude le sait.
  expect(JSON.stringify(await $.tool.call({ tool: TOOL, returned: ['A'] } as any))).toMatch(/returned: no group in a linked session among A/)
})

test('« 🐞 Bug · session liée » : seulement en code ou revue ; le diagnostic s’y greffe en détour, puis se clôt sans fermer la phase', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 61_700_000 })
  mock.store(on)
  const filled = engine(on)
  await start($)

  // Phase Tickets : pas de bouton bug.
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'any-bug' })).toBeUndefined()
  await ui.unmount()

  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'any-bug' })
  await ui.unmount()
  const text = filled.at(-1)!
  expect(text).toMatch(/^Lance un diagnostic de bug dans une session liée, pour le parcours « Lot SC » \(phase Implémentation\), avec un titre qui commence par « Lot SC > Bug · »\./)
  // Elle reprend le parcours : elle reste dans ce dossier, qui a le fichier du parcours, sans worktree.
  expect(text).toMatch(/start_session, avec initiation user_asked, context "fresh", wake_when_done true, effort "<effort>" et use_worktree false \(elle reprend le parcours, qui vit dans ce dossier\)/)
  expect(text).toContain(`claude --bg -n 'Lot SC > Bug · <sujet>' --effort <effort> (sans -w : elle reste dans ce dossier, où vit le parcours) "<prompt>"`)
  // L'effort : high à la première tentative, xhigh à la deuxième, pas de troisième session.
  expect(text).toContain("Effort de la session (<effort>) : high pour une première tentative ; xhigh pour une deuxième, quand une session de bug de ce parcours a déjà essayé de corriger ce même bug et qu'il est toujours là")
  expect(text).toContain('Pas de troisième session après un second échec : on replanifie ensemble ici.')
  expect(text).toContain("si le bug est toujours là, arrêter la session (ci-dessous), puis me le dire et me proposer la deuxième tentative (règle d'effort ci-dessus) ; sinon, reprendre le parcours ici")
  expect(text).toMatch(/\{"resume": "[^"]+"\}/)
  expect(text).toContain('2) puis lancer /mattpocock-skills:diagnosing-bugs avec la description du bug')
  expect(text).toContain('4) à la fin, envoyer {"complete": true} pour clore le détour.')
  expect(text.endsWith('Bug : ')).toBe(true)

  // En Implémentation, /diagnosing-bugs est un détour du lot, pas une « Chasse au bug » à part.
  await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'z' })
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Détour/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /CHASSE AU BUG/ })).toBeUndefined()
  await ui.unmount()

  // {"complete": true} clôt le détour ; la phase Implémentation continue, avec son bouton bug.
  await $.tool.call({ tool: TOOL, complete: true } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'any-bug' })).toBeDefined()
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ type: 'Text', text: /Détour terminé : Diagnostic/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('un fichier commun empêche le parallèle, même sans dépendance', async ($, on) => {
  mock.clock(on, { now: 62_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    tickets: LOT,
    groups: [GROUPS[0], { ...GROUPS[1], files: ['Worker/SC/periods.ts'] }, GROUPS[2]],
  } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'launch-parallel-linked' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /∥/ })).toBeUndefined()
  // Chacun reste lançable seul, en session liée.
  expect(await ui.find({ key: 'launch-linked-B' })).toBeDefined()
  // La sélection ne propose que /implement.
  await ui.press({ key: `pick-${N}` })
  expect(await ui.find({ key: 'launch-picks-parallel' })).toBeUndefined()
  await ui.unmount()
})

test('avec deux groupes ∥ prêts, la sélection ne propose que /implement', async ($, on) => {
  mock.clock(on, { now: 63_000_000 })
  mock.store(on)
  const filled = engine(on)
  inRepo(on)
  await start($)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: `pick-${N}` })
  expect(await ui.find({ key: 'launch-picks-parallel' })).toBeUndefined()
  await ui.press({ key: 'launch-picks' })
  await ui.unmount()
  expect(filled.at(-1)).toBe(`/mattpocock-skills:implement Tickets à traiter, un par un et dans cet ordre : 1) ${N} — Nettoyages revue`)
})

test('les groupes se recalculent quand les tickets avancent', async ($, on) => {
  mock.clock(on, { now: 64_000_000 })
  mock.store(on)
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, set: [L, R, F].map(id => ({ id, status: 'done' })) } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  // A fait : replié ; C n'attend plus que B ; une seule vague restante.
  expect(await ui.find({ type: 'Text', text: /Worker SC\/VSC : 3.tickets faits/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /attend B$/ })).toBeDefined()
  expect(await ui.find({ key: 'launch-linked-A' })).toBeUndefined()
  expect(await ui.find({ key: 'launch-parallel-linked' })).toBeUndefined()
  await ui.unmount()
})

test('une attente circulaire ne bloque pas le calcul ; un ticket sans groupe va dans « Autres »', async ($, on) => {
  mock.clock(on, { now: 65_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  const answer = await $.tool.call({
    tool: TOOL,
    tickets: [
      { id: 'X1', name: 'Un', blockedBy: ['Y1'] },
      { id: 'Y1', name: 'Deux', blockedBy: ['X1'] },
      { id: 'Z1', name: 'Trois', blockedBy: [] },
    ],
    groups: [
      { id: 'X', name: 'Gauche', tickets: ['X1'] },
      { id: 'Y', name: 'Droite', tickets: ['Y1', 'Q9'] },
    ],
  } as any)
  // L'id inconnu est signalé à Claude.
  expect(JSON.stringify(answer)).toMatch(/unknown ticket ids ignored \(Q9\)/)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /ordre à revoir/ })).toBeDefined()
  expect(await ui.find({ key: 'launch-linked-X' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Autres$/ })).toBeDefined()
  expect(await ui.find({ key: 'pick-Z1' })).toBeDefined()
  await ui.unmount()
})

test('une nouvelle liste de groupes remplace l’ancienne ; des tickets envoyés sans groupes les gardent', async ($, on) => {
  mock.clock(on, { now: 66_000_000 })
  mock.store(on)
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, tickets: [{ id: N, name: 'Nettoyages revue', status: 'doing' }] } as any)

  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Alignement/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: TOOL, groups: [{ id: 'T', name: 'Tout', tickets: LOT.slice(0, 4).map(t => t.id) }, { id: 'U', name: 'Reste', tickets: LOT.slice(4).map(t => t.id) }] } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Alignement/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Tout/ })).toBeDefined()
  await ui.unmount()
})

test('la consigne de /to-tickets demande les groupes', async ($, on) => {
  mock.clock(on, { now: 67_000_000 })
  mock.store(on)
  engine(on)
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  expect(note.text).toMatch(/"groups": \[\{"id": "A"/)
  expect(note.text).not.toMatch(/continuesHere/)
})
