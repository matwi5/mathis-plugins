// Catalogue du plugin mattpocock-skills (écrit sur la 1.2.3 ; les 25 noms valent pour la 1.3.1-mathis.1,
// copie figée dans plugins/mattpocock-skills, sans implement-spec ni wayfinder) : pour chaque skill, ses étapes,
// sa couleur, le parcours qu'il ouvre et ses suites naturelles.
//
// Sources : les SKILL.md du plugin et la carte de routage d'ask-matt. Les libellés sont
// pour l'interface (français) ; les `hint` sont lus par Claude (anglais, comme les skills).

export const PLUGIN = 'mattpocock-skills'

// Couleurs brutes (hex) mi-tons : lisibles en thème clair comme sombre, sur le terminal
// comme sur le desktop (même famille que git-board et ticket-board).
export const C = {
  violet: '#9B7BEA',
  lilac: '#B79BF5',
  blue: '#4A9EE8',
  cyan: '#2EB8C9',
  teal: '#3FB68B',
  tangerine: '#E8913A',
  coral: '#EF7D57',
  amber: '#D9A520',
  green: '#4CB782',
  red: '#E5534B',
  pink: '#E06C9F',
  magenta: '#C36BD9',
  indigo: '#7C83F2',
  sky: '#56B4E9',
  /** Vert anis : la lecture de transcripts (B1), loin du bleu des hachures « attente d'une tâche de fond ». */
  anise: '#9BC53D',
  /** Mauve : les pistes des sessions liées, plus loin du violet de l'orchestrateur que le lilas. */
  mauve: '#C9A3F0',
  sand: '#C9A66B',
  /** Or : l'advisor, sa ligne et l'attente « consulte l'advisor », plus clair que l'ambre de « attend ta réponse ». */
  gold: '#E8C547',
  slate: '#7F8EA3',
  gray: '#8B8B93',
  /** Texte foncé posé sur un aplat de couleur. */
  ink: '#17171C',
} as const

export type StepDef = {
  id: string
  /** Libellé affiché. */
  label: string
  /**
   * Nom court de l'étape, pour la frise du terminal d'un parcours à une seule phase, dont les
   * stations sont les étapes ; `label` sinon.
   */
  shortLabel?: string
  /** Ce que Claude comprend de l'étape (anglais). */
  hint: string
  /** Le même hint quand le projet n'est pas un dépôt git (point fixe par copies), s'il diffère. */
  noGitHint?: string
  /** L'étape part dans le même message que la précédente (affichée « ∥ ») : la sécurité avec la revue du groupe. */
  isWithPrevious?: boolean
}

export type PhaseSpec = { skill: string; alts?: string[]; isOptional?: boolean }

/**
 * `flow` : ouvre un parcours quand il ne prolonge pas l'actif.
 * `detour` : greffé sur la phase en cours quand il n'est pas dans le parcours.
 * `event` : une simple ligne du journal.
 * `step` : une commande de livraison (plugin project) qui ne compte que dans un parcours en
 * cours (phase, étape ou ligne du journal) et n'en ouvre jamais un.
 */
export type SkillRole = 'flow' | 'detour' | 'event' | 'step'

export type SkillDef = {
  id: string
  /** Nom de la phase. */
  label: string
  /** Nom court de la phase, pour la frise du terminal où chaque station n'a que quelques cases ; `label` sinon. */
  shortLabel?: string
  /** Genre et nombre du libellé, pour accorder « terminée », « démarrés »… (masculin singulier par défaut). */
  gender?: 'f' | 'pl'
  /** Nom du parcours quand ce skill l'ouvre. */
  flowLabel: string
  /** Ce que fait le skill, en une ligne. */
  verb: string
  glyph: string
  color: string
  role: SkillRole
  /** Réservé à la personne (disable-model-invocation) : lancé par sa commande slash. */
  isUserOnly: boolean
  steps: StepDef[]
  /**
   * Ce que la phase suit comme éléments : hypothèses, candidats, décisions… Avec `linkedStep`, le
   * panneau permet de choisir des éléments et de les confier à une session liée, ce qui ouvre cette étape.
   */
  items?: { label: string; hint: string; linkedStep?: string }
  /** Étape d'une phase combinée : lancé seul, ce skill ouvre cette phase à cette étape. */
  partOf?: { skill: string; step: string }
  /** Sous-skills que ce skill appelle par l'outil Skill, et l'étape que chacun ouvre. */
  uses?: Record<string, string | null>
  /** Les phases du parcours que ce skill ouvre (la première est lui-même). */
  flow?: PhaseSpec[]
  /** Phases où ce skill de rôle `flow` se greffe en détour au lieu d'ouvrir son propre parcours. */
  detourIn?: string[]
  /** Suites proposées quand la phase est finie. */
  next?: string[]
  hasTickets?: boolean
  /** Interview en tours de questions (`❓ **Qn**`). */
  isGrilling?: boolean
  /** Les lancements de tests y font avancer les étapes. */
  hasTests?: boolean
  /** La commande slash, sans la barre, quand ce n'est pas celle du plugin mattpocock (`code-review` de Claude Code). */
  command?: string
  /** Arguments ajoutés quand le panneau met la commande dans le prompt (`--fix` pour la revue du groupe). */
  args?: string
  /**
   * Ce qui suit, groupe par groupe, une fois ses tickets commités (revue du groupe, revue de
   * sécurité, rendu) : affiché dans l'ordre sur la carte de la phase, et envoyé à Claude avec les
   * étapes. Pas des étapes suivies : les revues sont des événements, marqués sur la ligne du groupe.
   */
  groupSteps?: StepDef[]
}

const step = (id: string, label: string, hint: string, shortLabel?: string): StepDef => ({
  id,
  label,
  hint,
  ...(shortLabel !== undefined ? { shortLabel } : {}),
})

/** Le hint d'une étape selon que le projet est un dépôt git ou non. */
export const hintOf = (s: StepDef, isRepo: boolean): string => (isRepo ? s.hint : (s.noGitHint ?? s.hint))

/** Ce qui justifie une revue de sécurité (lu par Claude). */
export const SECURITY_CRITERIA =
  'authentication, permissions or access rules, user input reaching a query, a path or HTML, secrets or tokens, network or file access, uploads, dependencies'

/**
 * La seconde passe de sécurité, sur le seul diff des correctifs de la revue du groupe (lu par
 * Claude) : 33 min et 4 agents xhigh pour 0 faille sur 111 lignes (rétro de l'onglet Agents).
 */
export const SECURITY_FIXES_PASS =
  "no second pass on the diff of the group review's fixes, unless it touches a costly area of the method file (its section 1) or exceeds 150 changed lines outside tests; then a single pass at high effort, without verification subtasks"

/**
 * La confiance d'un dossier, lue sans rien afficher d'autre de `~/.claude.json`, qui peut porter des
 * jetons (une session avait écrit le geste fait sans le vérifier). La procédure d'une session liée
 * de groupe recopie la même commande (procedure-groupe.test.mjs les compare) ; le texte de
 * lancement (`launchHow` de register.tsx) la cite.
 */
export const TRUST_COMMAND = `python3 -c 'import json, os, sys; p = json.load(open(os.path.expanduser("~/.claude.json"))).get("projects", {}); r = os.path.realpath(sys.argv[1]); print((p.get(r) or p.get(r.replace(os.sep, "/")) or {}).get("hasTrustDialogAccepted"))' '<dossier>'`

/** Les zones où un ticket passe aussi par la passe « bogues » (lu par Claude). */
export const SENSITIVE_AREAS = "privacy, data deletion, encryption, concurrency, a command or path built from a value read elsewhere: a shared file, another session, a report"

/** Où vit la règle des revues (modèle, effort, consignes, cible, écritures), citée par les consignes des relecteurs. */
export const REVIEW_RULE = 'review rule, config/rules/agents.md and its detail config/reference/revues.md, once installed'

/** Un relecteur lancé par l'outil Agent reçoit le chemin de son fichier de consignes dans son prompt. */
export const INSTRUCTIONS_IN_PROMPT = `its instructions in a file whose path goes in its prompt (${REVIEW_RULE})`

/**
 * Les choix déjà déclarés, que les revues ne doivent pas resignaler (lu par Claude) : un fichier
 * tenu par flow-board, cité par son chemin, plutôt qu'une liste recopiée dans chaque consigne.
 */
export const DECIDED_HINT = 'the path of the file of the choices already declared in this run (under "Declared choices" below), not to be undone out of preference, but with any case where one produces a defect reported with its scenario, and the reviewer brief given there'

/**
 * Ce que tout relecteur reçoit tel quel (lu par Claude) : un relecteur avait rendu son rapport
 * avant le second axe, d'où une revue Spec lancée deux fois, et une passe `--fix` avait appliqué
 * un correctif laissé à un autre groupe. Le tri des constats (Important, Nit, Pre-existing) suit la revue
 * de l'équipe Claude Code : pour un auteur agent, une remarque mineure coûte un commit et un tour de revue.
 */
export const REVIEWER_BRIEF =
  'when the review has several axes (Standards and Spec), report only once all of them are back, and never launch an axis again that is already running; do not rerun the tests nor the checks (the session ran them); report apart the findings on code older than the lot (lines the lot did not change): do not fix them, they go to the user as a « durcissement » group proposed at the end of the lot, except a finding on older code that breaks the invariant of the ticket: it is Important and gets fixed (in a « durcissement » group, the code it targets is not older than the lot); tag every finding Important, Nit or Pre-existing (the code older than the lot just above): only the Important ones get fixed, the Nits (style, naming, a cleanup that changes no behaviour) are not fixed and given as a count only, without detail, so that a nit costs neither a commit nor another review cycle; a description, a comment or a documentation text that the diff makes wrong is Important; a choice made in session and missing from the decisions file is not a finding; the review of a ticket also looks for the neighbouring tests that read the same observable (a test that pins the old behaviour elsewhere); for a defect, name its class (the pattern, not only the line) so that every occurrence of it gets fixed; do not report as a defect, nor apply, anything the spec, the ticket or the declared choices leave to another group or exclude; do not undo a declared choice out of preference nor report it again as such, but report any case where it produces a defect, with its scenario; never write in the working tree, not even for a moment (a red test that proves a defect stays with the session): the only writes are the fixes that /code-review --fix applies in a group review'

/**
 * Le canal des consignes d'une revue (lu par Claude) : `/code-review` tourne en exécution dérivée
 * et ne reçoit que ses arguments, et un hash seul lui avait fait relire un commit au lieu du groupe.
 * Forme essayée avec Claude Code 2.1.310 (niveaux low et high, avec et sans --fix) : le chemin,
 * annoncé par « consignes : » après la cible, est lu d'abord et ne devient pas la cible.
 */
export const reviewInstructions = (isRepo: boolean): string =>
  `write each review's instructions in a file of your temporary folder: its scope, the path of the declared choices file, the points left to the user, what it must not do, and the reviewer brief; pass its path after the target, ${isRepo ? '/code-review <level> <base>..HEAD consignes : <path> (the target is always a range <base>..HEAD or a branch, never a commit hash alone; before a ticket\'s commit, the scope also names the uncommitted changes; when other runs commit on the same branch, git log <base>..HEAD shows commits that are not this run\'s: the scope is then limited to this run\'s paths, given in the file as a pathspec, git diff <base>..HEAD -- <paths>)' : '/code-review <level> consignes : <path> (the file lists the copies and files to compare)'}, and to a reviewer subagent in its prompt (${REVIEW_RULE})`

/** Une revue de groupe en zone sensible n'applique rien seule : son relecteur trie les constats. */
export const SENSITIVE_NO_FIX = `when a ticket of the group touches a sensitive area (${SENSITIVE_AREAS}) or did not say, without --fix: the session applies itself only the findings it keeps`

/**
 * Commit avant la revue (Mathis, 26/10/2026) : un ticket hors zone sensible n'attend plus sa revue
 * pour laisser démarrer le suivant ; un ticket sensible garde sa revue avant son commit.
 */
export const COMMIT_BEFORE_REVIEW =
  'a ticket sent with "sensitive": false is committed once its checks pass, before its review, so the next ticket starts while the review runs: the review target is then <commit before the ticket>..<the ticket\'s commit>, never ..HEAD (HEAD and the working tree already hold the next ticket); its fixes land in a commit of their own, and its findings go in "review" without "step" (the next ticket\'s steps stay where they are); the ticket turns done in the tracker only once its review is back and its fixes are committed (its content and form review too, when it has one); a ticket that touches a sensitive area, or did not say, keeps its review before its commit, on a snapshot ref (refs/worktree/flow-board/<ticket id>, see the review step)'

/**
 * Les critères du ticket cochés avant son commit, chacun avec le test qui le couvre : des constats
 * « Spec » étaient des critères littéraux non faits, et un ticket fini gardait ses cases vides.
 */
export const TICK_CRITERIA =
  'before the commit, tick each criterion of the ticket file (- [x]) and name next to it the test that covers it (or why none can)'

/**
 * Un seul relecteur pour les deux axes d'un ticket, quelle que soit sa taille (rétro de l'onglet
 * Agents) : l'axe Standards seul avait rendu 1 Important en une douzaine de passes, sans lire
 * `CODING_STANDARDS.md`. Ses Mineurs se rendent en un compte : leur détail ne servait pas.
 */
export const TICKET_REVIEWER =
  'both axes in a single reviewer subagent (Agent tool, model opus, effort high, passed explicitly), whatever the size of the diff; it reads the CODING_STANDARDS.md whose path its instructions file gives ("Project judgement rules" below), besides CLAUDE.md, and gives its Nits as a count, without detail'

/**
 * Les noms des relecteurs (description de l'appel Agent), tels que l'onglet Agents les montre : la
 * sorte, puis la portée. Les noms variaient d'une session à l'autre (« Revue du ticket » suivi
 * d'un numéro, « Revue Standards+Spec E1 ») ; les exécutions de /code-review, que le moteur nomme d'après leur
 * commande, prennent la même forme dans la frise (`reviewForkName`).
 */
export const REVIEWER_NAMES =
  'give each reviewer subagent you launch a standard description, the name the Agents tab shows: "Standards+Spec · <ticket>" for the two axes of a ticket, <ticket> being the group letter and the ticket\'s rank in its group (E2), or the ticket id in a lot without groups; "Sécurité · groupe <letter>" for a security reviewer ("Sécurité · lot" without groups); never the level nor the effort, which the tab shows apart'

/**
 * Un groupe d'un seul ticket sans logique ni zone sensible : la revue du ticket est la seule, et la
 * sécurité se juge à son commit, sans revue du groupe à accompagner.
 */
export const SINGLE_TICKET_GROUP = 'A group of a single ticket sent with "sensitive": false and "logic": false has no group review: its ticket review is its only review, the dashboard shows it reviewed, and its security judgement comes once that ticket is committed'

/**
 * L'instantané d'un ticket sensible avant sa passe « bogues » (Mathis, L2 a de la rétro de l'onglet
 * Agents) : la revue relisait un arbre qui bougeait, et la session attendait sans rien faire. Une
 * référence locale à part, propre au worktree (`refs/worktree/`, jamais partagée entre parcours),
 * sans toucher à la branche ; des commandes simples, sans `$(…)`, que le garde-fou d'un worktree
 * accepte (essayé le 27/10/2026). Le ticket suivant n'avance pas dans un autre dossier : le garde-fou
 * y refuse git, et un HEAD détaché perdait ses commits au retrait du dossier (passe « bogues » du lot).
 */
export const TICKET_SNAPSHOT =
  'Before the bug pass of a sensitive ticket (its review runs before its commit), pin what both reviews read on a ref of this worktree, without touching the branch, each command alone and the printed hash copied into the next one: git add <the ticket\'s files, by path>, then git diff --cached --name-only must list the ticket\'s files and nothing else (unstage anything else first), git write-tree (prints <tree>), git commit-tree <tree> -p HEAD -m "flow-board snapshot <ticket id>" (prints <snapshot>), git update-ref refs/worktree/flow-board/<ticket id> <snapshot>. Both reviews then read the range refs/worktree/flow-board/<ticket id>^..refs/worktree/flow-board/<ticket id> (the bug pass takes it as its target; the instructions file of the two axes gives that diff command) and files at that ref (git show refs/worktree/flow-board/<ticket id>:<path>), never the working tree. While they run, move on with work that touches none of the ticket\'s files (a next ticket that shares no file, the report, the delivery); a next ticket that touches the same files waits. The ticket\'s real commit still comes after its review: git add each of its files again (its fixes included), commit, then git update-ref -d refs/worktree/flow-board/<ticket id>'

/** La consigne de la revue d'un ticket, pour un point fixe donné ; sans git, la passe « bogues » n'a pas de plage. */
const ticketReviewHint = (fixedPoint: string, isRepo: boolean): string =>
  `/mattpocock-skills:code-review on this ticket's changes only (Skill tool; ${fixedPoint}), its Standards and Spec axes, ${TICKET_REVIEWER}; for a ticket with a « Lecteur » line, the content and form review too ("Content and form review" below). Those axes do not hunt bugs: when the diff touches a sensitive area (${SENSITIVE_AREAS}), launch in the same message the bug pass, /code-review <level> of Claude Code (Skill tool "code-review", arguments "<level> ${isRepo ? '<the snapshot range> ' : ''}consignes : <path>"), <level> being xhigh when the ticket deletes data or touches concurrency, otherwise high or xhigh as the effort criterion of the security review method file decides (the stakes, the size), on the same scope (${fixedPoint}), giving it ${DECIDED_HINT}, and in its instructions file the ticket's invariant when it has one (the sentence of what its persisted data must never become, fixed at framing): the reviewer looks first for what breaks it. The instructions file of the two axes also quotes the done criteria of the group's tickets already done that touch the same files (a rule of one ticket left unapplied in another made 3 of the 7 findings of a group review)${isRepo ? `. ${TICKET_SNAPSHOT}` : ''}`

/** Le point fixe d'une revue de ticket. */
export const TICKET_FIXED_POINT = 'fixed point: the commit before the ticket'

/** Sans git, pas de commit : la copie des fichiers du ticket prise avant lui (méthode dans `NO_GIT_COPIES`). */
export const NO_GIT_TICKET_FIXED_POINT = "fixed point: the copy of its files taken before the ticket, diffed against the current files (\"Without git\" below)"

/** Sans git, le point fixe d'un groupe : pour chaque fichier, la plus ancienne copie de ses tickets. */
export const NO_GIT_GROUP_FIXED_POINT = "fixed point: for each file, the oldest copy among the group's tickets, diffed against the current file (\"Without git\" below)"

/**
 * La méthode des copies, quand le projet n'est pas un dépôt git (lu par Claude) : sans commit, les
 * revues relisaient des fichiers entiers ; elles comparent la copie d'avant le ticket au fichier actuel.
 */
export const NO_GIT_COPIES =
  "Without git: this project is not a git repository, so no commit marks where a ticket starts. Before touching the first file of a ticket, copy the files it will change into the session's temporary folder (its absolute path, as for the shell rule: printenv CLAUDE_JOB_DIR, or else the temporary or scratchpad folder your instructions give), one subfolder per ticket keeping the path in the project (<temporary folder>/<ticket id>/<path in the project>). A ticket's fixed point is its copy; a group's fixed point is, file by file, the oldest copy among its tickets (a file only a later ticket touched has no copy from the first one). The reviews read a unified diff of the copy against the current file (git diff --no-index <copy> <file> works outside a repository), not the whole files; a file the ticket creates has no copy: it is new and is read whole. Give the reviews the list of copies and files to compare"

/**
 * Les étapes d'un ticket dans un lot, dans l'ordre : contrôles, puis la revue du ticket (deux axes,
 * et la passe « bogues » dans le même message pour une zone sensible), puis commit et suivi.
 */
const TICKET_STEPS = [
  step('read', 'Lire spec et ticket', 'read the spec or the ticket'),
  step('tdd', 'Boucle TDD', 'test-first at the agreed seams'),
  step('checks', 'Contrôles', 'the project checks: lint, typecheck, the full suite'),
  {
    ...step('review', 'Revue du ticket', ticketReviewHint(TICKET_FIXED_POINT, true)),
    noGitHint: ticketReviewHint(NO_GIT_TICKET_FIXED_POINT, false),
  },
  {
    ...step('commit', 'Commit et suivi', `${TICK_CRITERIA}; commit on the current branch (${COMMIT_BEFORE_REVIEW}), then the ticket in the tracker: done, with a comment citing the commit hash (and its review fixes commit)`),
    // Sans git, aucun commit ne marque le ticket : la revue reste avant le suivi.
    noGitHint: `${TICK_CRITERIA}; commit on the current branch, then the ticket in the tracker: done, with a comment citing the commit hash`,
  },
]

/**
 * Qui fait la revue d'un groupe (lu par Claude) : la session elle-même, par l'outil Skill.
 * `/code-review` tourne en exécution dérivée de celui qui la lance, à l'effort de son niveau : le
 * sous-agent qui l'enveloppait refaisait une analyse, 38 à 46 % du coût d'une passe (rétro de l'onglet Agents).
 */
export const GROUP_REVIEWER =
  `this session itself, through the Skill tool, the path of its instructions file after the target: /code-review runs as a fork of whoever launches it, at the effort of its level, so no reviewer subagent wraps it (only a session that does not run on Opus hands it to a reviewer subagent with model opus, which launches it itself; ${REVIEW_RULE})`

/** La consigne de la revue d'un groupe ; le point fixe ne se précise que sans git. */
const groupReviewHint = (fixedPoint: string): string =>
  `/code-review high --fix of Claude Code on the group's changes${fixedPoint} (launched by the user from the dashboard; in a linked session, by the session itself), run by ${GROUP_REVIEWER}, giving it ${DECIDED_HINT}, focused on the interactions between the tickets (each one had its own review); ${SENSITIVE_NO_FIX}. It does not settle a conflict between the spec and an instruction (CLAUDE.md, a request of the user): it leaves that point unfixed and raises it to the user. Then read the diff of its fixes, rerun the checks and commit them`

/** Ce qui suit, par groupe, une fois ses tickets commités : revue du groupe, revue de sécurité, rendu. */
const GROUP_STEPS = [
  {
    ...step('group-review', 'Revue du groupe', groupReviewHint('')),
    noGitHint: groupReviewHint(` (${NO_GIT_GROUP_FIXED_POINT})`),
  },
  {
    ...step(
      'security',
      'Revue de sécurité',
      `in the same message as the group review (it is read-only, so it does not wait for the fixes): judge whether it is worth it and say so; if it is, launch it yourself: a read-only reviewer subagent limited to the group's diff, never /security-review (details in "Security review" below); ${SECURITY_FIXES_PASS}; it follows the security review method file of flow-board and fixes nothing: each kept finding goes to the user with a ready fix, and the user decides`,
    ),
    isWithPrevious: true,
  },
  step('handback', 'Rendu du groupe', 'the group is back on the dashboard: its tickets done, its review and security review reported to the flow tool; the user launches the next group'),
]
const phase = (skill: string, isOptional = false, alts?: string[]): PhaseSpec => ({ skill, isOptional, alts })

/**
 * Ce qu'un changement laisse derrière lui en zone sensible (lu par Claude) : les fichiers en clair
 * et les journaux qui dépendaient d'un mode retiré n'étaient apparus qu'en fin de ticket.
 */
const SENSITIVE_STEP = step(
  'sensitive',
  'Conséquences sensibles',
  `list what the change, or a removal, leaves behind in a sensitive area (${SENSITIVE_AREAS}): files left in clear, logs that depend on a mode, data kept once a feature is gone; each one becomes a question to the user`,
  'Sensible',
)

/**
 * Une validation d'un clic dans le chat (lu par Claude) : l'encadré peut cacher le texte écrit juste
 * avant, d'où la phrase qui dit quoi valider et où le lire.
 */
const BUTTON_QUESTION =
  'a button question (AskUserQuestion): one sentence on what is validated and where to read it, then « Valider (Recommandé) » and « À reprendre » (none in a linked session: there the validation goes up to the main discussion)'

const GRILL_STEPS = [
  step('tree', 'Arbre des décisions', 'map the design tree of decisions', 'Arbre'),
  step('rounds', 'Tours de questions', 'ask the frontier, round after round', 'Questions'),
  SENSITIVE_STEP,
  step('agree', 'Accord partagé', `confirm the shared understanding with ${BUTTON_QUESTION}; the rounds before it stay in text`, 'Accord'),
]

const DECISIONS = { label: 'Décisions', hint: 'the decisions of the design tree (done = settled, dropped = out of scope)' }

const IMPL = phase('implement')
const IMPL_OPT = phase('implement', true)
/** Le compte rendu à valider avant toute livraison : jamais facultatif. */
const REPORT = phase('compte-rendu')
/**
 * Le compte rendu d'un parcours dont l'Implémentation est facultative : facultatif tant qu'on n'a
 * pas codé (le parcours peut s'arrêter au triage ou à l'examen de l'architecture), obligatoire dès que l'Implémentation
 * démarre (moveTo, dans model.ts).
 */
const REPORT_IF_CODE = phase('compte-rendu', true)

export const SKILLS: Record<string, SkillDef> = {
  // ─── Cadrage ────────────────────────────────────────────────────────────
  'grill-with-docs': {
    id: 'grill-with-docs',
    label: 'Cadrage',
    flowLabel: 'Nouvelle fonctionnalité',
    verb: 'Interview serré du plan ; glossaire et ADR écrits au fil de l’eau',
    glyph: '◆',
    color: C.violet,
    role: 'flow',
    isUserOnly: true,
    steps: GRILL_STEPS,
    items: DECISIONS,
    uses: { grilling: null, 'domain-modeling': null },
    isGrilling: true,
    flow: [phase('grill-with-docs'), phase('to-spec', true), phase('to-tickets', true), IMPL, REPORT, phase('project:version', true), phase('project:pr', true)],
    next: ['to-spec', 'implement', 'prototype'],
  },
  'grill-me': {
    id: 'grill-me',
    label: 'Grilling',
    flowLabel: 'Réflexion',
    verb: 'Interview serré d’un plan ou d’une idée, sans rien écrire',
    glyph: '◇',
    color: C.violet,
    role: 'flow',
    isUserOnly: true,
    steps: GRILL_STEPS,
    items: DECISIONS,
    uses: { grilling: null },
    isGrilling: true,
    flow: [phase('grill-me'), phase('to-spec', true)],
    next: ['to-spec', 'to-questionnaire'],
  },
  grilling: {
    id: 'grilling',
    label: 'Grilling',
    flowLabel: 'Grilling',
    verb: 'Questions par tours sur la frontière des décisions',
    glyph: '◇',
    color: C.violet,
    role: 'detour',
    isUserOnly: false,
    steps: GRILL_STEPS,
    items: DECISIONS,
    isGrilling: true,
  },
  'to-questionnaire': {
    id: 'to-questionnaire',
    label: 'Questionnaire',
    shortLabel: 'Questions',
    flowLabel: 'Questionnaire',
    verb: 'Une décision qu’on ne tranche pas seul, mise en questionnaire',
    glyph: '≡',
    color: C.lilac,
    role: 'detour',
    isUserOnly: true,
    steps: [
      step('recipient', 'Destinataire', 'who will answer: role, expertise, relationship'),
      step('need', 'Besoin', 'the decisions or facts needed back'),
      step('write', 'Questionnaire écrit', 'write to-questionnaire-<slug>.md'),
    ],
    flow: [phase('to-questionnaire'), phase('grill-with-docs', true)],
    next: ['grill-with-docs', 'to-spec'],
  },

  // ─── Spec et tickets ────────────────────────────────────────────────────
  'to-spec': {
    id: 'to-spec',
    label: 'Spec',
    gender: 'f',
    flowLabel: 'De la spec au code',
    verb: 'Synthèse de la conversation, publiée sur le tracker',
    glyph: '▤',
    color: C.blue,
    role: 'flow',
    isUserOnly: true,
    steps: [
      step('config', 'Config du tracker', 'check the tracker config'),
      step('explore', 'Explorer le dépôt', 'explore the repo with the glossary vocabulary'),
      step('seams', 'Seams validés', 'sketch the seams and get them confirmed'),
      SENSITIVE_STEP,
      step('write', 'Rédiger la spec', 'write the spec from the template; before showing or publishing it, consult the advisor (advisor tool), not a reviewer subagent; without that tool, reread it yourself in this discussion'),
      step('publish', 'Publier', `once the user validates it with ${BUTTON_QUESTION}, publish it to the tracker (ready-for-agent)`),
    ],
    flow: [phase('to-spec'), phase('to-tickets'), IMPL, REPORT, phase('project:version', true), phase('project:pr', true)],
    next: ['to-tickets'],
  },
  'to-tickets': {
    id: 'to-tickets',
    label: 'Tickets',
    gender: 'pl',
    flowLabel: 'Des tickets au code',
    verb: 'Découpage en tranches verticales, avec leurs blocages',
    glyph: '▦',
    color: C.cyan,
    role: 'flow',
    isUserOnly: true,
    hasTickets: true,
    steps: [
      step('context', 'Contexte', 'gather the spec or conversation'),
      step('explore', 'Explorer le code', 'look for prefactoring'),
      step('slice', 'Tranches verticales', 'draft tracer-bullet slices with blocking edges'),
      step('approve', 'Découpage validé', `iterate until the user approves the breakdown with ${BUTTON_QUESTION}`),
      step('publish', 'Publier les tickets', 'publish them, blockers first'),
    ],
    flow: [phase('to-tickets'), IMPL, REPORT, phase('project:version', true), phase('project:pr', true)],
    next: ['implement'],
  },
  triage: {
    id: 'triage',
    label: 'Triage',
    flowLabel: 'Triage',
    verb: 'Les issues passent par la machine à états du triage',
    glyph: '☰',
    color: C.sky,
    role: 'flow',
    isUserOnly: true,
    steps: [
      step('queue', 'File à traiter', 'list what needs attention'),
      step('context', 'Contexte', 'read the issue, comments, labels, out-of-scope'),
      step('recommend', 'Recommandation', 'propose category and state, then wait'),
      step('verify', 'Vérification', 'reproduce the bug or check the PR'),
      step('grill', 'Approfondir', 'grill the request if needed'),
      step('apply', 'Appliquer', 'write the agent brief or triage notes, set labels'),
    ],
    items: { label: 'Issues', hint: 'the issues being triaged (label = "#n title", done = triaged)' },
    uses: { grilling: 'grill', 'domain-modeling': null },
    flow: [phase('triage'), IMPL_OPT, REPORT_IF_CODE, phase('project:version', true), phase('project:pr', true)],
    next: ['implement'],
  },

  // ─── Construction ───────────────────────────────────────────────────────
  implement: {
    id: 'implement',
    label: 'Implémentation',
    shortLabel: 'Code',
    gender: 'f',
    flowLabel: 'Implémentation',
    verb: 'Le travail décrit par la spec ou le ticket, en TDD, revu puis commité',
    glyph: '⚙',
    color: C.tangerine,
    role: 'flow',
    isUserOnly: true,
    hasTickets: true,
    hasTests: true,
    steps: TICKET_STEPS,
    groupSteps: GROUP_STEPS,
    uses: { tdd: 'tdd', 'code-review': 'review', 'codebase-design': null },
    flow: [IMPL, REPORT, phase('project:version', true), phase('project:pr', true)],
    next: ['compte-rendu', 'implement', 'retro'],
  },
  tdd: {
    id: 'tdd',
    label: 'TDD',
    flowLabel: 'TDD',
    verb: 'Rouge puis vert, un seam et un test à la fois',
    glyph: '◑',
    color: C.coral,
    role: 'detour',
    isUserOnly: false,
    hasTests: true,
    steps: [
      step('glossary', 'Glossaire et ADR', 'read the glossary and ADRs of the area'),
      step('seams', 'Seams convenus', 'agree the seams to test with the user'),
      step('cycles', 'Cycles rouge → vert', 'one failing test, then just enough code'),
    ],
    items: { label: 'Seams', hint: 'the agreed seams (done = covered by a passing test)' },
    uses: { 'codebase-design': null },
    flow: [phase('tdd'), phase('code-review', true), REPORT, phase('project:version', true), phase('project:pr', true)],
    next: ['code-review', 'compte-rendu'],
  },
  prototype: {
    id: 'prototype',
    label: 'Prototype',
    shortLabel: 'Proto',
    flowLabel: 'Prototype',
    verb: 'Un prototype jetable pour trancher une question de design',
    glyph: '✦',
    color: C.magenta,
    role: 'detour',
    isUserOnly: false,
    steps: [
      step('mode', 'Logique ou UI', 'pick the logic or the UI branch', 'Branche'),
      step('question', 'Question posée', 'state the question the prototype answers', 'Question'),
      step('build', 'Construire', 'build the throwaway prototype', 'Bâtir'),
      step('iterate', 'Itérer', 'iterate on feedback'),
      step('capture', 'Décision capturée', 'capture the verdict and clean up', 'Décision'),
    ],
    items: { label: 'Variantes', hint: 'the variants or scenarios (done = kept, dropped = rejected)' },
    flow: [phase('prototype')],
    next: ['to-spec', 'implement', 'handoff'],
  },
  'diagnosing-bugs': {
    id: 'diagnosing-bugs',
    label: 'Diagnostic',
    shortLabel: 'Diag',
    flowLabel: 'Chasse au bug',
    verb: 'Boucle de feedback, hypothèses, correctif et test de régression',
    glyph: '◎',
    color: C.red,
    role: 'flow',
    isUserOnly: false,
    hasTests: true,
    steps: [
      step('loop', 'Boucle de feedback', 'phase 1: a fast, deterministic, red-capable command'),
      step('reproduce', 'Reproduire et réduire', 'phase 2: reproduce and minimise'),
      step('hypotheses', 'Hypothèses', 'phase 3: ranked falsifiable hypotheses'),
      step('instrument', 'Instrumenter', 'phase 4: test them one variable at a time'),
      step('fix', 'Correctif et test', 'phase 5: regression test, then the fix'),
      step('cleanup', 'Nettoyage', 'phase 6: remove debug logs and leftovers'),
    ],
    items: { label: 'Hypothèses', hint: 'the hypotheses (doing = being tested, done = confirmed, dropped = refuted)' },
    flow: [phase('diagnosing-bugs'), phase('code-review', true), REPORT, phase('project:version', true), phase('project:pr', true)],
    // Un bug trouvé en codant ou en relisant reste dans le lot qui l'a fait apparaître ; ailleurs
    // (cadrage, spec…), il ouvre sa « Chasse au bug ». Le bouton « 🐞 Bug · session liée » suit cette liste.
    detourIn: ['implement', 'tdd', 'code-review', 'compte-rendu'],
    next: ['code-review', 'compte-rendu', 'improve-codebase-architecture'],
  },
  wizard: {
    id: 'wizard',
    label: 'Assistant guidé',
    shortLabel: 'Guide',
    flowLabel: 'Procédure guidée',
    verb: 'Un script bash interactif pour les gestes que seul un humain peut faire',
    glyph: '⌘',
    color: C.sand,
    role: 'detour',
    isUserOnly: false,
    steps: [
      step('frame', 'Procédure', 'list the stages and get them confirmed'),
      step('trace', 'Tracer les étapes', 'URL, clicks and value of each stage', 'Étapes'),
      step('script', 'Écrire le script', 'copy the template, one stage per step', 'Script'),
      step('verify', 'Vérifier', 'bash -n, shellcheck, chmod +x, hand over'),
    ],
    flow: [phase('wizard')],
  },

  // ─── Qualité et livraison ───────────────────────────────────────────────
  'code-review': {
    id: 'code-review',
    label: 'Revue',
    gender: 'f',
    flowLabel: 'Revue de code',
    verb: 'Deux relecteurs en parallèle : Standards et Spec',
    glyph: '◈',
    color: C.amber,
    role: 'detour',
    isUserOnly: false,
    steps: [
      step('point', 'Point fixe', 'pick the fixed point and read the diff'),
      step('spec', 'Trouver la spec', 'find the spec'),
      step('standards', 'Trouver les standards', 'find the coding standards'),
      step('reviewers', 'Relecteurs en parallèle', 'run the Standards and Spec reviewers'),
      step('report', 'Synthèse', 'report both axes side by side'),
    ],
    flow: [phase('code-review'), REPORT, phase('project:version', true), phase('project:pr', true)],
    next: ['compte-rendu'],
  },
  pr: {
    id: 'pr',
    label: 'Corps de PR',
    shortLabel: 'Corps PR',
    flowLabel: 'Corps de PR',
    verb: 'Le corps de la PR : résumé visuel, preuves, danger de merge',
    glyph: '¶',
    color: C.green,
    role: 'step',
    isUserOnly: false,
    steps: [
      step('summary', 'Résumé visuel', 'the smallest view that tells the change'),
      step('evidence', 'Preuves', 'screenshots or test output'),
      step('danger', 'Danger de merge', 'one-way or two-way door, blast radius'),
      step('open', 'PR ouverte', 'the pull request is created'),
    ],
    flow: [phase('pr')],
    next: ['retro'],
  },
  // ─── Livraison (plugin project, commandes réservées à la personne) ─────
  'project:sync': {
    id: 'project:sync',
    label: 'Synchronisation',
    shortLabel: 'Sync',
    gender: 'f',
    flowLabel: 'Synchronisation',
    verb: 'Met la branche à jour avec le distant (fetch, rebase, autostash)',
    glyph: '⟳',
    color: C.cyan,
    role: 'step',
    isUserOnly: true,
    steps: [
      step('fetch', 'Fetch', 'git fetch --prune origin'),
      step('pull', 'Rebase ou merge', 'bring in the upstream or the default branch'),
    ],
  },
  'final-review': {
    id: 'final-review',
    label: 'Revue du groupe',
    shortLabel: 'Revue',
    gender: 'f',
    flowLabel: 'Revue du groupe',
    verb: 'Le groupe relu par /code-review high --fix de Claude Code (sans --fix pour un groupe sensible), une fois ses tickets commités et relus, lancé par la session elle-même, sans sous-agent qui l’enveloppe : les bugs entre ses tickets, y compris avec les groupes déjà livrés ; un conflit entre la spec et une consigne n’est pas tranché, il remonte',
    glyph: '◆',
    color: C.coral,
    // Pas une phase : un événement de l'Implémentation, qui marque les groupes finis comme relus.
    role: 'event',
    isUserOnly: true,
    command: 'code-review',
    // `high` fixe l'effort de la revue et sa recette (nombre de chercheurs et de constats ; sans
    // niveau, le dernier tapé) ; la revue applique ses correctifs à la copie de travail, à relire
    // avant le commit.
    args: 'high --fix',
    steps: [],
  },
  'branch-review': {
    id: 'branch-review',
    label: 'Relecture',
    shortLabel: 'Relire',
    gender: 'f',
    flowLabel: 'Relecture de branche',
    verb: 'Une branche ou une PR relue par /code-review de Claude Code : les bugs du diff, corrigés avec --fix ou commentés sur la PR avec --comment',
    glyph: '◆',
    color: C.coral,
    // `/code-review` de Claude Code lancé sans parcours actif ici ouvre ce parcours (applySkill) ;
    // pendant un parcours, la même commande reste la revue du groupe (`final-review`).
    role: 'flow',
    isUserOnly: true,
    command: 'code-review',
    steps: [],
    flow: [phase('branch-review'), REPORT, phase('project:version', true), phase('project:pr', true)],
    next: ['compte-rendu'],
  },
  'security-review': {
    id: 'security-review',
    label: 'Revue de sécurité',
    shortLabel: 'Sécurité',
    gender: 'f',
    flowLabel: 'Revue de sécurité',
    verb: 'Après la revue du groupe, quand Claude la juge utile : un sous-agent relecteur qu’il lance lui-même, limité au diff du groupe, selon une méthode fixe ; chaque faille te revient avec un correctif prêt, tu décides de sa correction (« corrige F1 et F3 »)',
    glyph: '⛨',
    color: C.red,
    // Comme la revue du groupe, un événement de l'Implémentation ; elle ne bloque jamais la livraison.
    // Plus de commande : Claude lance un sous-agent (/security-review relit tout depuis la branche par
    // défaut). L'id reconnaît encore un /security-review tapé à la main.
    role: 'event',
    isUserOnly: false,
    steps: [],
  },
  'compte-rendu': {
    id: 'compte-rendu',
    label: 'Compte rendu',
    shortLabel: 'Rapport',
    flowLabel: 'Compte rendu',
    verb: 'Le rapport du travail, à lire et valider avant de livrer : fait, décidé sans toi, mal passé, bloqué, trouvé, documentation',
    glyph: '◧',
    color: C.pink,
    // Une étape du parcours, jamais un point de départ : sans parcours, le skill rédige seulement.
    role: 'step',
    isUserOnly: true,
    command: 'flow-board:compte-rendu',
    steps: [
      step('facts', 'Rassembler les faits', 'collect the facts: git log since the run started, git status, the tracking file, the tracker'),
      step('write', 'Rédiger le rapport', 'write the report in the fixed sections, short and plain'),
      step('validate', 'Ta validation', 'in one line of text, tell the user to click « ✓ Valider le rapport » in the dashboard, never with a button question; then wait for the user to validate the report from the dashboard: flow-board then sends you a message saying so'),
    ],
    next: ['project:version'],
  },
  'project:version': {
    id: 'project:version',
    label: 'Version et push',
    shortLabel: 'Push',
    gender: 'f',
    flowLabel: 'Livraison',
    verb: 'Monte la version (SemVer) si le lot ne l’a pas déjà posée, puis commite, contrôle et pousse : /project:version et /project:push, au choix',
    glyph: '⬆',
    color: C.sky,
    role: 'step',
    isUserOnly: true,
    steps: [
      step('sources', 'Fichiers de version', 'find the version sources'),
      step('bump', 'Choix du bump', 'choose the SemVer bump from the commits'),
      step('update', 'Mise à jour', 'update every version file'),
      step('tag', 'Commit et tag', 'commit and tag the release'),
      step('push', 'Push : reste à commiter', '/project:push: where it goes, what is left to commit'),
      step('checks', 'Contrôles', 'run the project checks'),
      step('docs', 'Fichiers de fin de session', 'end-of-session files up to date'),
      step('pushed', 'Sync et push', 'sync with the remote and push without force'),
    ],
    uses: { 'project:push': 'push', 'project:sync': null },
    next: ['project:pr'],
  },
  'project:push': {
    id: 'project:push',
    label: 'Push',
    flowLabel: 'Livraison',
    verb: 'Commite ce qui reste, lance les contrôles et pousse sans forcer',
    glyph: '⬆',
    color: C.sky,
    role: 'step',
    isUserOnly: true,
    partOf: { skill: 'project:version', step: 'push' },
    steps: [],
    next: ['project:pr'],
  },
  'project:pr': {
    id: 'project:pr',
    label: 'Pull request',
    shortLabel: 'PR',
    gender: 'f',
    flowLabel: 'Pull request',
    verb: 'Ouvre la PR GitHub, titre et corps rédigés depuis les commits',
    glyph: '⇄',
    color: C.green,
    role: 'step',
    isUserOnly: true,
    // La PR se fusionne d'elle-même une fois les contrôles passés.
    args: '--auto',
    steps: [
      step('preflight', 'Vérifications', 'pre-flight: branch, base, pushed'),
      step('body', 'Titre et corps', 'write the title and the body'),
      step('create', 'PR ouverte', 'create the pull request'),
    ],
    uses: { pr: 'body' },
    next: ['retro'],
  },
  retro: {
    id: 'retro',
    label: 'Rétro',
    gender: 'f',
    flowLabel: 'Rétrospective',
    verb: 'Ce que la session apprend aux prochaines',
    glyph: '↺',
    color: C.pink,
    role: 'flow',
    isUserOnly: true,
    steps: [
      step('style', 'Guide de style', 'load writing-for-agents', 'Style'),
      step('read', 'Lire la session', 'read the session logs', 'Lecture'),
      step('find', 'Pistes (7 axes)', 'look for improvements in the seven categories', 'Pistes'),
      step('present', 'Par sévérité', 'present them by severity, those that touch another repository apart, as a correction list ready to hand to an agent of that repository; then wait: the user picks the improvements of this repository in the dashboard and sends them to a linked session, or tells you which ones to apply', 'Tri'),
      step(
        'apply',
        'Modifications en cours',
        'set by the dashboard once the linked session you launch for the improvements the user sent has started; the workflow stays here: never resume it there. At its final note, check its work, send the full items list with each status (done if done and checked; todo if not done: back to the user\'s choice; dropped only when the user gives it up), then close the session when the answer lists it under « Close now » and send "closed", then complete unless some went back to todo',
        'Appliquer',
      ),
    ],
    items: { label: 'Pistes', hint: 'the improvement candidates of this repository only (label = "category: fix"); those that touch another repository stay out of the items', linkedStep: 'apply' },
    uses: { 'writing-for-agents': 'style' },
    flow: [phase('retro')],
  },

  // ─── Santé du code et conception ────────────────────────────────────────
  'improve-codebase-architecture': {
    id: 'improve-codebase-architecture',
    label: 'Architecture',
    shortLabel: 'Archi',
    gender: 'f',
    flowLabel: 'Santé du code',
    verb: 'Repérer les modules à approfondir, rapport HTML puis grilling',
    glyph: '▲',
    color: C.teal,
    role: 'flow',
    isUserOnly: true,
    steps: [
      step('scope', 'Périmètre', 'pick the area (git log hotspots if none given)'),
      step('read', 'Glossaire et ADR', 'read the glossary and ADRs'),
      step('explore', 'Exploration', 'explore with a sub-agent, note the friction'),
      step('report', 'Rapport HTML', 'write and open the HTML report'),
      step('choose', 'Choix du candidat', 'ask which candidate to explore'),
      step('grill', 'Grilling', 'grill the chosen candidate'),
    ],
    items: { label: 'Candidats', hint: 'the deepening candidates (label may end with Strong / Worth exploring / Speculative)' },
    uses: { 'codebase-design': null, grilling: 'grill', 'domain-modeling': null },
    flow: [
      phase('improve-codebase-architecture'),
      phase('grill-with-docs', true),
      phase('to-spec', true),
      phase('to-tickets', true),
      IMPL_OPT,
      REPORT_IF_CODE,
      phase('project:version', true),
      phase('project:pr', true),
    ],
    next: ['grill-with-docs'],
  },
  'codebase-design': {
    id: 'codebase-design',
    label: 'Design de module',
    shortLabel: 'Design',
    flowLabel: 'Design',
    verb: 'Modules profonds : interfaces, seams et alternatives',
    glyph: '▣',
    color: C.teal,
    role: 'detour',
    isUserOnly: false,
    steps: [
      step('frame', 'Cadrer le problème', 'constraints, dependencies, sketch', 'Problème'),
      step('alternatives', 'Alternatives', 'sub-agents design different interfaces', 'Options'),
      step('compare', 'Comparer', 'compare depth, locality and seams'),
    ],
    items: { label: 'Designs', hint: 'the alternative interfaces (done = recommended, dropped = discarded)' },
    flow: [phase('codebase-design')],
  },
  'domain-modeling': {
    id: 'domain-modeling',
    label: 'Domaine',
    flowLabel: 'Modèle du domaine',
    verb: 'Le vocabulaire du projet : glossaire et ADR',
    glyph: '§',
    color: C.lilac,
    role: 'detour',
    isUserOnly: false,
    steps: [
      step('challenge', 'Confronter au glossaire', 'challenge terms against GLOSSARY.md', 'Glossaire'),
      step('sharpen', 'Préciser les termes', 'propose canonical terms, probe edge cases', 'Termes'),
      step('record', 'Glossaire et ADR', 'write the glossary and ADRs', 'Consigner'),
    ],
    flow: [phase('domain-modeling')],
  },

  // ─── Productivité ───────────────────────────────────────────────────────
  research: {
    id: 'research',
    label: 'Recherche',
    gender: 'f',
    flowLabel: 'Recherche',
    verb: 'Sources primaires, un rapport Markdown dans le dépôt',
    glyph: '✧',
    color: C.indigo,
    role: 'detour',
    isUserOnly: false,
    steps: [
      step('agent', 'Agent lancé', 'launch the background agent'),
      step('sources', 'Sources primaires', 'investigate primary sources'),
      step('write', 'Rapport', 'write the Markdown file'),
      step('file', 'Rangé', 'file it where the repo keeps such notes'),
    ],
    flow: [phase('research'), phase('grill-with-docs', true)],
    next: ['grill-with-docs', 'to-spec'],
  },
  handoff: {
    id: 'handoff',
    label: 'Passation',
    gender: 'f',
    flowLabel: 'Passation',
    verb: 'La conversation compactée pour une autre session',
    glyph: '➜',
    color: C.slate,
    role: 'detour',
    isUserOnly: true,
    steps: [
      step('summary', 'Résumé', 'summarise the session'),
      step('skills', 'Skills suggérés', 'suggest the next skills', 'Skills'),
      step('refs', 'Références', 'point to specs, ADRs, issues, commits', 'Renvois'),
      step('save', 'Document enregistré', 'save it in the temp directory', 'Document'),
    ],
    flow: [phase('handoff')],
  },
  teach: {
    id: 'teach',
    label: 'Apprentissage',
    shortLabel: 'Apprendre',
    flowLabel: 'Apprentissage',
    verb: 'Une leçon dans l’espace de travail, au bon niveau',
    glyph: '✎',
    color: C.amber,
    role: 'flow',
    isUserOnly: true,
    steps: [
      step('mission', 'Mission', 'check MISSION.md'),
      step('resources', 'Ressources', 'gather trusted resources', 'Sources'),
      step('level', 'Niveau', 'find the zone of proximal development'),
      step('lesson', 'Leçon', 'write and open the lesson'),
      step('record', 'Acquis', 'write a learning record'),
    ],
    flow: [phase('teach')],
    next: ['teach'],
  },
  'writing-for-agents': {
    id: 'writing-for-agents',
    label: 'Écriture pour agents',
    shortLabel: 'Écriture',
    gender: 'f',
    flowLabel: 'Écriture pour agents',
    verb: 'Skills, AGENTS.md et CLAUDE.md écrits pour un agent',
    glyph: '¶',
    color: C.slate,
    role: 'detour',
    isUserOnly: false,
    steps: [
      step('principles', 'Principes', 'read the principles (and SKILL-MECHANICS for a skill)'),
      step('write', 'Rédaction', 'write or edit the document'),
    ],
    flow: [phase('writing-for-agents')],
  },
  'setup-matt-pocock-skills': {
    id: 'setup-matt-pocock-skills',
    label: 'Configuration',
    shortLabel: 'Config',
    gender: 'f',
    flowLabel: 'Mise en place',
    verb: 'Tracker, labels de triage et docs de domaine du dépôt',
    glyph: '⊞',
    color: C.slate,
    role: 'flow',
    isUserOnly: true,
    steps: [
      step('explore', 'Explorer le dépôt', 'remote, CLAUDE.md, glossaries, docs/agents', 'Dépôt'),
      step('tracker', 'Tracker', 'section A: the issue tracker'),
      step('labels', 'Labels', 'section B: triage labels'),
      step('domain', 'Docs de domaine', 'section C: domain docs layout', 'Domaine'),
      step('draft', 'Brouillon', 'show the draft'),
      step('write', 'Config écrite', 'write docs/agents and the Agent skills block', 'Écriture'),
    ],
    flow: [phase('setup-matt-pocock-skills')],
    next: ['grill-with-docs', 'triage'],
  },
  'ask-matt': {
    id: 'ask-matt',
    label: 'Orientation',
    shortLabel: 'Orienter',
    gender: 'f',
    flowLabel: 'Orientation',
    verb: 'Quel skill pour quelle situation',
    glyph: '✱',
    color: C.gray,
    role: 'event',
    isUserOnly: true,
    steps: [],
  },
  'wait-what': {
    id: 'wait-what',
    label: 'Reformulation',
    shortLabel: 'Reformuler',
    gender: 'f',
    flowLabel: 'Reformulation',
    verb: 'Le dernier message reformulé, plus simplement',
    glyph: '?',
    color: C.gray,
    role: 'event',
    isUserOnly: true,
    steps: [],
  },
}

/** Les ids qu'aucun autre plugin ne porte : acceptés aussi sans le préfixe du plugin. */
const DISTINCT = new Set([
  'grill-with-docs',
  'grill-me',
  'grilling',
  'to-spec',
  'to-tickets',
  'triage',
  'ask-matt',
  'setup-matt-pocock-skills',
  'diagnosing-bugs',
  'improve-codebase-architecture',
  'codebase-design',
  'domain-modeling',
  'to-questionnaire',
  'wait-what',
  'writing-for-agents',
])

/** Accorde un participe au libellé du skill : « Spec terminée », « Tickets démarrés ». */
export const agree = (def: SkillDef, word: string): string =>
  def.gender === 'f' ? `${word}e` : def.gender === 'pl' ? `${word}s` : word

/** `mattpocock-skills:to-spec` -> `to-spec` ; un skill d'un autre plugin -> null. */
export const skillIdOf = (name: string): string | null => {
  // `/code-review` sans préfixe est la revue de Claude Code : la revue d'un groupe de tickets fini.
  if (name === 'code-review') return 'final-review'
  if (name === 'security-review') return 'security-review'
  // Le compte rendu est un skill de flow-board, pas du plugin mattpocock.
  if (name === 'flow-board:compte-rendu') return 'compte-rendu'
  // Les commandes du plugin project gardent leur nom complet (`project:pr` n'est pas `pr`).
  if (name.startsWith('project:')) return name in SKILLS ? name : null
  const at = name.lastIndexOf(':')
  const id = (at >= 0 ? name.slice(at + 1) : name).trim()
  if (!(id in SKILLS)) return null
  if (at < 0) return DISTINCT.has(id) ? id : null
  return name.slice(0, at) === PLUGIN ? id : null
}

/** La commande slash d'un skill, sans la barre : la sienne, ou son id. */
export const slashOf = (skill: string): string => SKILLS[skill]?.command ?? skill

/** La commande telle que le panneau la met dans le prompt, arguments compris (`code-review --fix`). */
export const commandLineOf = (skill: string): string => {
  const args = SKILLS[skill]?.args
  return args ? `${slashOf(skill)} ${args}` : slashOf(skill)
}

/** Les points d'entrée du lanceur, quand aucun parcours n'est en cours. */
export const LAUNCHERS: { skill: string; title: string; hint: string }[] = [
  // Dans l'ordre du flux : cadrer, spécifier, découper, implémenter ; puis les autres points d'entrée.
  { skill: 'grill-with-docs', title: 'Cadrer une fonctionnalité', hint: 'interview, glossaire et ADR' },
  { skill: 'to-spec', title: 'Rédiger la spec de ce qu’on a discuté', hint: 'synthèse de la discussion, sans interview' },
  { skill: 'to-tickets', title: 'Découper un plan en tickets', hint: 'tranches verticales et leurs blocages' },
  { skill: 'implement', title: 'Implémenter un ticket', hint: 'TDD, revue puis commit' },
  { skill: 'diagnosing-bugs', title: 'Diagnostiquer un bug', hint: 'boucle de feedback et hypothèses' },
  { skill: 'branch-review', title: 'Relire une branche ou une PR', hint: 'les bugs du diff ; ajoute la cible, --fix ou --comment' },
  { skill: 'triage', title: 'Trier les issues', hint: 'machine à états du triage' },
  { skill: 'improve-codebase-architecture', title: 'Santé de l’architecture', hint: 'modules à approfondir' },
]

/** Les autres skills, par famille : avec LAUNCHERS, les 25 skills mattpocock et les commandes de livraison du plugin project. */
export const COMMAND_GROUPS: { title: string; skills: string[] }[] = [
  { title: 'Cadrer et planifier', skills: ['grill-me', 'to-questionnaire', 'ask-matt', 'setup-matt-pocock-skills'] },
  { title: 'Construire', skills: ['tdd', 'prototype', 'research', 'wizard'] },
  // La revue de sécurité n'a plus de commande : Claude la lance lui-même (sous-agent relecteur).
  { title: 'Qualité', skills: ['code-review', 'compte-rendu', 'retro'] },
  { title: 'Livrer (plugin project)', skills: ['project:sync', 'project:version', 'project:push', 'project:pr'] },
  { title: 'Conception', skills: ['codebase-design', 'domain-modeling', 'writing-for-agents'] },
  { title: 'Au fil de l’eau', skills: ['grilling', 'handoff', 'wait-what', 'pr', 'teach'] },
]

/**
 * Un outil de la barre « À tout moment » : un skill du catalogue (étiquette et glyphe repris de
 * SKILLS), ou une commande de Claude Code (`compact`). `asks` : la personne ajoute un texte
 * (sujet, consignes) avant Entrée.
 */
export type AnytimeTool =
  /** `label` et `glyph` remplacent ceux du skill ; `withState` préremplit la question avec l'état du parcours. */
  | { key: string; skill: string; asks: boolean; label?: string; glyph?: string; withState?: boolean }
  | { key: string; command: string; label: string; glyph: string; asks: boolean }

/**
 * La barre du bas de la page Parcours, dans l'ordre d'usage : comprendre (le dernier message,
 * des faits, une décision qu'un tiers tranche), s'orienter (la suite, une décision mise à
 * l'épreuve, un terme précisé), puis gérer le contexte (l'alléger, passer la main).
 * Aucun de ces outils ne clôt la phase : les skills sont des détours ou des événements.
 */
export const ANYTIME_GROUPS: { title: string; tools: AnytimeTool[] }[] = [
  {
    title: 'Comprendre',
    tools: [
      { key: 'wait-what', skill: 'wait-what', asks: false },
      { key: 'research', skill: 'research', asks: true },
      // Une question qu'on ne tranche pas en discutant : du code jetable, souvent pendant le cadrage.
      { key: 'prototype', skill: 'prototype', asks: true, label: 'Tester une idée' },
      { key: 'to-questionnaire', skill: 'to-questionnaire', asks: true },
    ],
  },
  {
    title: 'S’orienter',
    tools: [
      { key: 'ask-matt', skill: 'ask-matt', asks: true, label: 'Et maintenant ?', withState: true },
      { key: 'grilling', skill: 'grilling', asks: true, label: 'Challenger' },
      // Il questionne d'abord (termes flous, cas limites, écarts avec le code), puis écrit le glossaire ou la décision.
      { key: 'domain-modeling', skill: 'domain-modeling', asks: true, label: 'Préciser un terme' },
    ],
  },
  {
    title: 'Contexte',
    tools: [
      { key: 'compact', command: 'compact', label: 'Compact', glyph: '⇣', asks: true },
      { key: 'handoff', skill: 'handoff', asks: true },
    ],
  },
]

/** Les commandes du tableau de bord lui-même. */
export const FLOW_COMMANDS: { args: string; hint: string }[] = [
  { args: '', hint: 'ouvre le panneau sur le parcours en cours' },
  { args: 'activity', hint: 'chiffres, livrables et journal' },
  { args: 'history', hint: 'tous les parcours du projet' },
  { args: 'commands', hint: 'cet onglet' },
  { args: 'hide', hint: 'cache le bandeau au-dessus du prompt (show le rend)' },
  { args: 'pause', hint: 'met de côté le parcours en cours, sans le clore : « Reprendre » le rouvre tel quel' },
  { args: 'done', hint: 'clôt le parcours en cours, gardé dans l’historique' },
  { args: 'reset', hint: 'archive le parcours en cours' },
  { args: 'rename <titre>', hint: 'renomme le parcours en cours' },
]

/** Les skills dont la phase modifie le code : /project:sync est demandé avant la première modification. */
export const CODE_SKILLS = new Set(['implement', 'tdd', 'diagnosing-bugs', 'prototype'])
