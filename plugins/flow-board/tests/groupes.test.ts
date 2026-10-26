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

/** Un dépôt git : /implement-spec n'est lancé que là. */
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
  { id: 'A', name: 'Worker SC/VSC', tickets: [L, R, F], why: 'mêmes règles du worker', files: ['worker/sc'], continuesHere: true },
  { id: 'B', name: 'App revue', tickets: [N], files: ['app/review'] },
  { id: 'C', name: 'Alignement', tickets: [S, D, M], files: ['app/sc', 'CLAUDE.md'] },
]

const start = async ($: any) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  return $.tool.call({ tool: TOOL, title: 'Lot SC', tickets: LOT, groups: GROUPS } as any)
}

test('les groupes se rangent par vague : A ∥ B d’abord, C ensuite', async ($, on) => {
  mock.clock(on, { now: 60_000_000 })
  mock.store(on)
  engine(on)
  await start($)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Worker SC\/VSC/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cette discussion/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /nouvelle discussion/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /mêmes règles du worker · 1.fichier$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Vague 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /∥.B/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /attend A, B/ })).toBeDefined()
    // Deux groupes prêts ; C attend.
    expect(await ui.find({ key: 'launch-group-A' })).toBeDefined()
    expect(await ui.find({ key: 'launch-group-B' })).toBeDefined()
    expect(await ui.find({ key: 'launch-group-C' })).toBeUndefined()
    expect(await ui.find({ key: 'launch-parallel' })).toBeDefined()
    await ui.unmount()
  }
})

test('▶ Lancer A met /implement et ses tickets dans l’ordre ; ⇉ lance le seul lot A ∥ B par /implement-spec, sans spec', async ($, on) => {
  mock.clock(on, { now: 61_000_000 })
  mock.store(on)
  const filled = engine(on)
  inRepo(on)
  await start($)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'launch-group-A' })
  expect(filled.at(-1)).toBe(
    `/mattpocock-skills:implement Groupe A (Worker SC/VSC), tickets un par un et dans cet ordre : 1) ${L} — LIGHTS ON/OFF ; 2) ${R} — Règle SC/VSC ; 3) ${F} — Fermetures VSC`,
  )
  await ui.press({ key: 'launch-parallel' })
  const text = filled.at(-1)!
  expect(text).toMatch(/^\/mattpocock-skills:implement-spec Groupes en parallèle, un sous-agent implémenteur par groupe, à la place d'un par ticket \(étape 4 du skill\)/)
  expect(text).toMatch(/un commit par ticket ; le merger fusionne sa branche dans la branche d'intégration quand le groupe est fini/)
  expect(text).toMatch(/A \(Worker SC\/VSC\) : 1\) .* ∥ B \(App revue\) : 1\) /)
  // C attend A et B : il n'est pas du lot, il viendra par un lancement suivant.
  expect(text).not.toMatch(/Alignement/)
  expect(text).toMatch(/Pas de spec : les tickets et leurs dépendances/)
  await ui.unmount()

  // La note d'/implement-spec reprend la file du lot.
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:implement-spec', text: 'y' })
  expect(note.text).toMatch(/Ticket queue chosen by the user, in order: 1\) LIGHTS ON\/OFF/)
})

test('« ↗ Session liée » confie un groupe à une session liée : le parcours reste ici, Claude rend ses statuts', async ($, on) => {
  mock.clock(on, { now: 61_500_000 })
  mock.store(on)
  const filled = engine(on)
  on('tool.call', { tool: START }, () => ({ result: { text: 'Started session local_grpB42 (name: groupe-b).' } }))
  await start($)

  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  // Tout groupe prêt a sa session liée, celui qui continue ici compris ; C attend.
  expect(await ui.find({ key: 'launch-linked-A' })).toBeDefined()
  expect(await ui.find({ key: 'launch-group-B' })).toBeDefined()
  expect(await ui.find({ key: 'launch-linked-C' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /« Session liée » : Claude lance une session qui fait le groupe, et le parcours reste ici/ })).toBeDefined()
  await ui.press({ key: 'launch-linked-B' })

  const text = filled.at(-1)!
  expect(text).toMatch(/^Confie ce groupe à une session liée, pour le parcours « Lot SC » : Groupe B \(App revue\) : 1\) /)
  expect(text).toContain(`${N} — Nettoyages revue.`)
  expect(text).toMatch(/Puis lance la session, avec un titre qui commence par « Lot SC › Groupe <id> · »/)
  // L'effort de la session : medium par défaut, high pour un groupe délicat, dit en une ligne.
  expect(text).toContain("Effort de la session (<effort>) : medium par défaut ; high si le groupe a un ticket qui touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence), s'il reste des choix de conception à faire ou s'il touche plusieurs modules à la fois. Dis-moi en une ligne l'effort choisi et pourquoi.")
  // Dans l'app Desktop : start_session ; dans le CLI : claude --bg, le compte rendu revient par SendMessage.
  expect(text).toMatch(/start_session, avec initiation user_asked, context "fresh", wake_when_done true, effort "<effort>" et use_worktree false \(ce dossier n’a pas de git\)\./)
  expect(text).toMatch(/Dans le CLI \(pas de start_session\) : appelle d'abord ListAgents pour lire le nom de cette discussion et sa référence entre crochets/)
  expect(text).toContain('claude --bg -n "Lot SC › Groupe <id> · <thème>" --effort <effort> (sans -w : ce dossier n’a pas de git) "<prompt>"')
  expect(text).toMatch(/de finir par un message à cette discussion \(il la réveille, même inactive\)/)
  // Le nom peut changer (renommage) : la session retrouve la discussion par sa référence, lue dans ListAgents.
  expect(text).toMatch(/Pour lui écrire, la session appelle ListAgents, trouve la ligne qui porte cette référence et envoie par SendMessage à « <nom du moment> \[<ref>\] »/)
  expect(text).toMatch(/si aucune ligne ne la porte, la session le dit en tête de sa réponse finale/)
  // Plus de filet notify_when_idle (rétro du 26/10/2026 : cinq réveils pour un groupe, dont quatre pour rien).
  expect(text).not.toContain('notify_when_idle')
  expect(text).toContain('le message final de la session réveille cette discussion ; pour un groupe, le relais rattrape un message perdu')
  // Les décisions se relaient par renvoi au fichier de décisions, écrites avant d'être relayées ;
  // un geste humain remplacé se confirme par le porteur dans la session liée.
  expect(text).toContain("les décisions déjà prises par renvoi, sans les réécrire")
  expect(text).toContain("sans y reprendre le texte des règles")
  expect(text).toContain("s'y écrit AVANT d'être relayée, avec ma phrase exacte entre guillemets")
  expect(text).toContain("se confirme par moi directement dans la session liée")
  expect(text).toContain("relire d'abord le fichier de décisions du projet et les commentaires « mise à jour du porteur » du ticket")
  // Un geste du porteur prévu par le groupe n'est pas un blocage externe.
  expect(text).toContain("n'est pas un blocage externe : le ticket reste « en cours », ligne « Statut : en attente (porteur) »")
  // Au redémarrage, le parcours passe en pause : le reprendre ici par son id.
  expect(text).toMatch(/le reprendre ici avant toute autre écriture, par l'appel flow \{"resume": "[^"]+"\}/)
  expect(text).toMatch(/À la note de fin de la session \(dans le CLI : son message reçu par SendMessage\)/)
  const delegate = text.match(/\{"delegate": "([^"]+)", "group": "B", "main": "\[<ref>\]"\}/)
  expect(delegate).not.toBeNull()
  // Les étapes d'/implement en clair (réservé à l'utilisateur, la session ne peut pas le lancer), puis les revues du groupe.
  // Sans git, pas de commit d'avant le ticket : la copie de ses fichiers, prise avant d'y toucher, est le point fixe.
  expect(text).toContain("puis faire les tickets du groupe, un par un et dans l'ordre, chacun ainsi : relire d'abord")
  expect(text).toContain("le passer « en cours » dans le tracker en le commençant (le relais y reconnaît la passe « bogues » d'un ticket en cours) ;")
  expect(text).toContain("jamais « blocked » au tableau de bord ; puis, ce dossier n'ayant pas de git, avant de toucher à son premier fichier, copier les fichiers qu'il va modifier dans son dossier temporaire")
  expect(text).toContain('un sous-dossier par ticket qui garde le chemin dans le projet (<dossier temporaire>/<id du ticket>/<chemin dans le projet>)')
  expect(text).toContain("au lieu de relire les fichiers entiers ; un fichier que le ticket crée n'a pas de copie : il est nouveau et se lit en entier ; ensuite /mattpocock-skills:tdd par l'outil Skill (sauter /mattpocock-skills:tdd pour un ticket sans comportement testable : une ressource visuelle, un document), les contrôles du projet, /mattpocock-skills:code-review par l'outil Skill sur les seuls changements du ticket (point fixe : la copie de ses fichiers prise avant le ticket, comparée aux fichiers actuels), même pour un petit diff")
  expect(text).not.toContain("le commit d'avant")
  expect(text).toContain("ne pas lancer /mattpocock-skills:implement par l'outil Skill : il est réservé à l'utilisateur")
  expect(text).toContain('4) une fois tous les tickets commités et relus, leurs correctifs commités (un groupe d\'un seul ticket ni sensible ni avec logique n\'a pas de revue du groupe : la revue de son ticket est la seule, et la sécurité se juge une fois ce ticket commité), lancer elle-même la revue du groupe en la confiant à un sous-agent relecteur (outil Agent, type general-purpose, modèle opus, effort high ; règle des revues, config/rules/agents.md quand elle est installée), le seul sous-agent qui écrit : il lance lui-même la revue et applique lui-même ses correctifs ; la revue est /code-review high --fix (la revue de Claude Code, outil Skill « code-review », arguments « high --fix consignes : <chemin> »)')
  expect(text).not.toMatch(/sur sa branche face à sa base/)
  // La passe « bogues » d'un ticket sensible part avec sa revue, sur son périmètre, sans resignaler les choix déclarés.
  expect(text).toContain("si le ticket touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence), lancer dans le même message la passe « bogues » /code-review xhigh (outil Skill « code-review », arguments « xhigh consignes : <chemin> »), sur le même périmètre (point fixe : la copie de ses fichiers prise avant le ticket, comparée aux fichiers actuels), en lui donnant la liste des choix déjà déclarés dans {\"decided\": …} de l'outil flow (ceux que tu connais, ceux de la session compris), à ne pas resignaler ni défaire")
  // La revue du groupe et la sécurité partent des plus anciennes copies des tickets du groupe.
  expect(text).toContain("arguments « high --fix consignes : <chemin> »), sur les changements du groupe (point fixe : pour chaque fichier, la plus ancienne copie parmi les tickets du groupe (un fichier touché seulement par un ticket suivant n'a pas de copie du premier), comparée au fichier actuel, les fichiers nouveaux en entier ; lui donner la liste des copies et des fichiers), en lui donnant")
  // La revue du groupe reçoit les choix déclarés et regarde les interactions entre tickets.
  expect(text).toMatch(/arguments « high --fix consignes : <chemin> »\), sur les changements du groupe \(.*\), en lui donnant la liste des choix déjà déclarés .* et la consigne des relecteurs, à leur donner telle quelle : .*, et en lui demandant de se concentrer sur les interactions entre les tickets/)
  // La sécurité par un sous-agent relecteur, jamais /security-review (qui relit aussi les autres groupes).
  expect(text).toMatch(/5\) dans le même message que le relecteur du point 4 \(elle est en lecture seule et n'attend pas ses correctifs\), juger si une revue de sécurité vaut la peine \(les changements du groupe touchent : authentication/)
  expect(text).toMatch(/la confier à un sous-agent relecteur \(outil Agent, type general-purpose, modèle opus, effort xhigh\), en lecture seule, avec pour seul périmètre les changements du groupe \(point fixe : pour chaque fichier, la plus ancienne copie parmi les tickets du groupe .*\) et pour critères ceux de \/security-review/)
  expect(text).toMatch(/ne pas lancer \/security-review, qui relit la branche face à la branche par défaut/)
  // La revue du groupe ne tranche pas un conflit entre la spec et une consigne : elle le remonte.
  expect(text).toMatch(/elle ne tranche pas un conflit entre la spec et une consigne \(CLAUDE\.md, une demande de ma part\) : elle ne corrige pas ce point et me le remonte/)
  expect(text).toMatch(/ne pas corriger ce qu'il trouve : les failles vont dans le compte rendu/)
  expect(text).toMatch(/la revue du groupe \(constats, corrigés, et à part les constats sur du code antérieur au lot\), la revue de sécurité \(lancée ou non, pourquoi, failles trouvées\)/)
  expect(text).toMatch(/dans son compte rendu, que la revue du groupe a tourné \(sinon, la lui demander par SendMessage avant tout ; un groupe d'un seul ticket ni sensible ni avec logique n'en a pas : la revue de son ticket suffit\)/)
  expect(text).toMatch(/\{"security": \{"group": "<id du groupe>", "advised": true\|false, "why": "<raison>"\}\}/)
  expect(text).toMatch(/sans sous-agents qui écrivent/)
  // Seule exception : le relecteur de la revue du groupe, Opus high, qui écrit lui-même les correctifs de --fix.
  expect(text).toContain('des sous-agents en parallèle seulement pour des recherches en lecture seule ; seule exception, le relecteur de la revue du groupe, au point 4)')
  expect(text).toContain('à son retour, relire le diff de ses correctifs, relancer les contrôles et les commiter ;')
  // Les règles de travail tirées des sessions liées précédentes.
  expect(text).toMatch(/écrire un script par l'outil Write, puis le lancer par une commande simple ;/)
  expect(text).toMatch(/son dossier temporaire se désigne par son chemin absolu, écrit en clair dans les commandes et les appels Write : le lire une fois au début \(printenv CLAUDE_JOB_DIR, seule dans sa commande/)
  expect(text).not.toMatch(/heredoc/)
  expect(text).toMatch(/ne jamais attendre par `sleep`/)
  expect(text).toMatch(/un commentaire daté « mise à jour du porteur »/)
  expect(text).toMatch(/d'après la ligne de résumé de la sortie des tests, jamais de mémoire/)
  // Sans git, pas de base : le relecteur de sécurité lit les changements du groupe.
  expect(text).not.toMatch(/git diff <base>\.\.HEAD/)
  expect(text).toMatch(/\{"returned": \["<id du groupe>"\]\}/)
  // La seule reprise demandée est celle de cette discussion après un redémarrage, jamais par la session liée.
  expect(text.match(/"resume"/g)?.length).toBe(1)
  // B attend sa session : plus de lancement, un « Annuler » tant qu'elle n'est pas partie.
  expect(await ui.find({ key: 'launch-group-B' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /session.liée.à.lancer/ })).toBeDefined()
  expect(await ui.find({ key: 'group-linked-cancel-B' })).toBeDefined()
  await ui.press({ key: 'group-linked-cancel-B' })
  expect(await ui.find({ key: 'launch-group-B' })).toBeDefined()
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

test('« 🐞 Bug · session liée » : seulement en code ou revue ; le diagnostic s’y greffe en détour, puis se clôt sans fermer la phase', async ($, on) => {
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
  expect(text).toMatch(/^Lance un diagnostic de bug dans une session liée, pour le parcours « Lot SC » \(phase Implémentation\), avec un titre qui commence par « Lot SC › Bug · »\./)
  // Elle reprend le parcours : elle reste dans ce dossier, qui a le fichier du parcours, sans worktree.
  expect(text).toMatch(/start_session, avec initiation user_asked, context "fresh", wake_when_done true, effort "<effort>" et use_worktree false \(elle reprend le parcours, qui vit dans ce dossier\)/)
  expect(text).toContain('claude --bg -n "Lot SC › Bug · <sujet>" --effort <effort> (sans -w : elle reste dans ce dossier, où vit le parcours) "<prompt>"')
  // L'effort : high à la première tentative, xhigh à la deuxième, pas de troisième session.
  expect(text).toContain("Effort de la session (<effort>) : high pour une première tentative ; xhigh pour une deuxième, quand une session de bug de ce parcours a déjà essayé de corriger ce même bug et qu'il est toujours là")
  expect(text).toContain('Pas de troisième session après un second échec : on replanifie ensemble ici.')
  expect(text).toContain("si le bug est toujours là, me le dire et me proposer la deuxième tentative (règle d'effort ci-dessus) ; sinon, reprendre le parcours ici")
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
  expect(await ui.find({ key: 'launch-parallel' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /∥/ })).toBeUndefined()
  // Chacun reste lançable seul.
  expect(await ui.find({ key: 'launch-group-B' })).toBeDefined()
  // Sans spec ni groupes ∥, la sélection ne propose pas /implement-spec.
  await ui.press({ key: `pick-${N}` })
  expect(await ui.find({ key: 'launch-picks-parallel' })).toBeUndefined()
  await ui.unmount()
})

test('avec deux groupes ∥ prêts, la sélection propose aussi /implement-spec, sans spec', async ($, on) => {
  mock.clock(on, { now: 63_000_000 })
  mock.store(on)
  const filled = engine(on)
  inRepo(on)
  await start($)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: `pick-${N}` })
  await ui.press({ key: 'launch-picks-parallel' })
  await ui.unmount()
  expect(filled.at(-1)).toBe(
    `/mattpocock-skills:implement-spec Tickets à traiter : 1) ${N} — Nettoyages revue. Pas de spec : les tickets et leurs dépendances (dans le tracker) suffisent.`,
  )
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
  expect(await ui.find({ key: 'launch-group-A' })).toBeUndefined()
  expect(await ui.find({ key: 'launch-parallel' })).toBeUndefined()
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
  expect(await ui.find({ key: 'launch-group-X' })).toBeUndefined()
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

  await $.tool.call({ tool: TOOL, groups: [{ id: 'T', name: 'Tout', tickets: LOT.map(t => t.id) }] } as any)
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
  expect(note.text).toMatch(/continuesHere/)
})
