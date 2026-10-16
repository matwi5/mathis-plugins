// Catalogue du plugin mattpocock-skills (écrit sur la 1.2.3 ; les 27 noms valent pour la 1.3.1,
// copie figée dans plugins/mattpocock-skills) : pour chaque skill, ses étapes,
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
  sand: '#C9A66B',
  slate: '#7F8EA3',
  gray: '#8B8B93',
  /** Texte foncé posé sur un aplat de couleur. */
  ink: '#17171C',
} as const

export type StepDef = {
  id: string
  /** Libellé affiché. */
  label: string
  /** Ce que Claude comprend de l'étape (anglais). */
  hint: string
  /** Le même hint quand le projet n'est pas un dépôt git (point fixe par copies), s'il diffère. */
  noGitHint?: string
}

export type PhaseSpec = { skill: string; alts?: string[]; isOptional?: boolean }

/**
 * `flow` : ouvre un parcours quand il ne prolonge pas l'actif.
 * `detour` : greffé sur la phase en cours quand il n'est pas dans le parcours.
 * `event` : une simple ligne du journal.
 */
/**
 * … `step` : une commande de livraison (plugin project) qui ne compte que dans un parcours en
 * cours (phase, étape ou ligne du journal) et n'en ouvre jamais un.
 */
export type SkillRole = 'flow' | 'detour' | 'event' | 'step'

export type SkillDef = {
  id: string
  /** Nom de la phase. */
  label: string
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

const step = (id: string, label: string, hint: string): StepDef => ({ id, label, hint })

/** Le hint d'une étape selon que le projet est un dépôt git ou non. */
export const hintOf = (s: StepDef, isRepo: boolean): string => (isRepo ? s.hint : (s.noGitHint ?? s.hint))

/** Ce qui justifie une revue de sécurité (lu par Claude). */
export const SECURITY_CRITERIA =
  'authentication, permissions or access rules, user input reaching a query, a path or HTML, secrets or tokens, network or file access, uploads, dependencies'

/** Les zones où un ticket passe aussi par la passe « bogues » (lu par Claude). */
export const SENSITIVE_AREAS = 'privacy, data deletion, encryption, concurrency'

/** Les choix déjà déclarés, que les revues ne doivent pas resignaler (lu par Claude). */
export const DECIDED_HINT = 'the list of the choices already declared in "decided" of the flow tool, not to be reported again'

/** La consigne de la revue d'un ticket, pour un point fixe donné. */
const ticketReviewHint = (fixedPoint: string): string =>
  `/mattpocock-skills:code-review on this ticket's changes only (Skill tool; ${fixedPoint}), its Standards and Spec axes, even for a small diff. Those axes do not hunt bugs: when the diff touches a sensitive area (${SENSITIVE_AREAS}), launch in the same message the bug pass, /code-review of Claude Code (Skill tool "code-review"), on the same scope (${fixedPoint}), giving it ${DECIDED_HINT}`

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
    ...step('review', 'Revue du ticket', ticketReviewHint(TICKET_FIXED_POINT)),
    noGitHint: ticketReviewHint(NO_GIT_TICKET_FIXED_POINT),
  },
  step('commit', 'Commit et suivi', "commit on the current branch, then the ticket in the tracker: done, with a comment citing the commit hash"),
]

/** La consigne de la revue d'un groupe ; le point fixe ne se précise que sans git. */
const groupReviewHint = (fixedPoint: string): string =>
  `/code-review --fix of Claude Code on the group's changes${fixedPoint} (launched by the user from the dashboard; in a linked session, by the session itself), giving it ${DECIDED_HINT}, focused on the interactions between the tickets (each one had its own review). It does not settle a conflict between the spec and an instruction (CLAUDE.md, a request of the user): it leaves that point unfixed and raises it to the user. Then read its fixes, rerun the checks and commit them`

/** Ce qui suit, par groupe, une fois ses tickets commités : revue du groupe, revue de sécurité, rendu. */
const GROUP_STEPS = [
  {
    ...step('group-review', 'Revue du groupe', groupReviewHint('')),
    noGitHint: groupReviewHint(` (${NO_GIT_GROUP_FIXED_POINT})`),
  },
  step(
    'security',
    'Revue de sécurité',
    "judge whether it is worth it and say so; if it is, launch it yourself: a read-only reviewer subagent limited to the group's diff, never /security-review (details in \"Security review\" below); it fixes nothing: its findings go to the user, who decides on their fixes",
  ),
  step('handback', 'Rendu du groupe', 'the group is back on the dashboard: its tickets done, its review and security review reported to the flow tool; the user launches the next group'),
]
const phase = (skill: string, isOptional = false, alts?: string[]): PhaseSpec => ({ skill, isOptional, alts })

const GRILL_STEPS = [
  step('tree', 'Arbre des décisions', 'map the design tree of decisions'),
  step('rounds', 'Tours de questions', 'ask the frontier, round after round'),
  step('agree', 'Accord partagé', 'confirm the shared understanding'),
]

const DECISIONS = { label: 'Décisions', hint: 'the decisions of the design tree (done = settled, dropped = out of scope)' }

const IMPL = phase('implement', false, ['implement-spec'])
const IMPL_OPT = phase('implement', true, ['implement-spec'])
/** Le compte rendu à valider avant toute livraison : jamais facultatif. */
const REPORT = phase('compte-rendu')
/**
 * Le compte rendu d'un parcours dont l'Implémentation est facultative : facultatif tant qu'on n'a
 * pas codé (le parcours peut s'arrêter à la carte ou au triage), obligatoire dès que l'Implémentation
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
      step('write', 'Rédiger la spec', 'write the spec from the template'),
      step('publish', 'Publier', 'publish it to the tracker (ready-for-agent)'),
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
      step('approve', 'Découpage validé', 'iterate until the user approves'),
      step('publish', 'Publier les tickets', 'publish them, blockers first'),
    ],
    flow: [phase('to-tickets'), IMPL, REPORT, phase('project:version', true), phase('project:pr', true)],
    next: ['implement', 'implement-spec'],
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
  wayfinder: {
    id: 'wayfinder',
    label: 'Wayfinder',
    flowLabel: 'Grand chantier',
    verb: 'Carte de tickets de décision, résolus un à la fois',
    glyph: '⚑',
    color: C.indigo,
    role: 'flow',
    isUserOnly: true,
    steps: [
      step('destination', 'Destination', 'name the destination'),
      step('frontier', 'Frontière', 'map the frontier breadth-first'),
      step('map', 'Carte et tickets', 'create the map and its decision tickets'),
      step('resolve', 'Résoudre un ticket', 'claim and resolve one ticket'),
      step('record', 'Décision consignée', 'record the decision and update the map'),
    ],
    items: { label: 'Tickets de décision', hint: 'the decision tickets of the map (done = resolved)' },
    uses: { grilling: null, 'domain-modeling': null, research: null, prototype: null },
    flow: [phase('wayfinder'), phase('to-spec', true), phase('to-tickets', true), IMPL_OPT, REPORT_IF_CODE, phase('project:version', true), phase('project:pr', true)],
    next: ['to-spec', 'wayfinder'],
  },

  // ─── Construction ───────────────────────────────────────────────────────
  implement: {
    id: 'implement',
    label: 'Implémentation',
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
    flow: [phase('implement', false, ['implement-spec']), REPORT, phase('project:version', true), phase('project:pr', true)],
    next: ['compte-rendu', 'implement', 'retro'],
  },
  'implement-spec': {
    id: 'implement-spec',
    label: 'Implémentation',
    gender: 'f',
    flowLabel: 'Implémentation de spec',
    verb: 'Graphe de tickets : implementers en parallèle sur la frontière',
    glyph: '⚙',
    color: C.tangerine,
    role: 'flow',
    isUserOnly: true,
    hasTickets: true,
    hasTests: true,
    steps: [
      step('graph', 'Lire le graphe', 'read the spec and the tickets as a task graph'),
      step('explore', 'Exploration', 'optional exploration notes outside the repo'),
      step('branch', 'Branche d’intégration', 'create the integration branch'),
      step('implementers', 'Implementers', 'run implementers on the ready frontier'),
      step('merge', 'Merges', 'merge each finished ticket'),
      step('review', 'Revue globale', `code-review the integration branch, giving it ${DECIDED_HINT}`),
      step('close', 'Clôture', 'mark the PR ready or resolve the tickets'),
      step('cleanup', 'Nettoyage', 'remove the worktrees'),
    ],
    uses: { tdd: null, 'code-review': 'review' },
    flow: [phase('implement-spec', false, ['implement']), REPORT, phase('project:version', true), phase('project:pr', true)],
    next: ['compte-rendu', 'retro'],
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
    flowLabel: 'Prototype',
    verb: 'Un prototype jetable pour trancher une question de design',
    glyph: '✦',
    color: C.magenta,
    role: 'detour',
    isUserOnly: false,
    steps: [
      step('mode', 'Logique ou UI', 'pick the logic or the UI branch'),
      step('question', 'Question posée', 'state the question the prototype answers'),
      step('build', 'Construire', 'build the throwaway prototype'),
      step('iterate', 'Itérer', 'iterate on feedback'),
      step('capture', 'Décision capturée', 'capture the verdict and clean up'),
    ],
    items: { label: 'Variantes', hint: 'the variants or scenarios (done = kept, dropped = rejected)' },
    flow: [phase('prototype')],
    next: ['to-spec', 'implement', 'handoff'],
  },
  'diagnosing-bugs': {
    id: 'diagnosing-bugs',
    label: 'Diagnostic',
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
    detourIn: ['implement', 'implement-spec', 'tdd', 'code-review', 'compte-rendu'],
    next: ['code-review', 'compte-rendu', 'improve-codebase-architecture'],
  },
  wizard: {
    id: 'wizard',
    label: 'Assistant guidé',
    flowLabel: 'Procédure guidée',
    verb: 'Un script bash interactif pour les gestes que seul un humain peut faire',
    glyph: '⌘',
    color: C.sand,
    role: 'detour',
    isUserOnly: false,
    steps: [
      step('frame', 'Procédure', 'list the stages and get them confirmed'),
      step('trace', 'Tracer les étapes', 'URL, clicks and value of each stage'),
      step('script', 'Écrire le script', 'copy the template, one stage per step'),
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
    gender: 'f',
    flowLabel: 'Revue du groupe',
    verb: 'Le groupe relu par /code-review --fix de Claude Code, une fois ses tickets commités : les bugs entre ses tickets, y compris avec les groupes déjà livrés ; un conflit entre la spec et une consigne n’est pas tranché, il remonte',
    glyph: '◆',
    color: C.coral,
    // Pas une phase : un événement de l'Implémentation, qui marque les groupes finis comme relus.
    role: 'event',
    isUserOnly: true,
    command: 'code-review',
    // La revue applique ses correctifs à la copie de travail, à relire avant le commit.
    args: '--fix',
    steps: [],
  },
  'branch-review': {
    id: 'branch-review',
    label: 'Relecture',
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
    gender: 'f',
    flowLabel: 'Revue de sécurité',
    verb: 'Après la revue du groupe, quand Claude la juge utile : un sous-agent relecteur qu’il lance lui-même, limité au diff du groupe ; les failles te reviennent, tu décides de leur correction',
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
      step('validate', 'Ta validation', 'wait for the user to validate the report from the dashboard'),
    ],
    next: ['project:version'],
  },
  'project:version': {
    id: 'project:version',
    label: 'Version et push',
    gender: 'f',
    flowLabel: 'Livraison',
    verb: 'Monte la version (SemVer), puis commite, contrôle et pousse : /project:version puis /project:push',
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
      step('style', 'Guide de style', 'load writing-for-agents'),
      step('read', 'Lire la session', 'read the session logs'),
      step('find', 'Pistes (7 axes)', 'look for improvements in the seven categories'),
      step('present', 'Par sévérité', 'present them by severity, then wait: the user picks the improvements in the dashboard and sends them to a linked session, or tells you which ones to apply'),
      step(
        'apply',
        'Modifications en cours',
        'set by the dashboard when the user sends improvements to a linked session; the workflow stays here: never resume it there. At its final note, check its work, send the full items list with each status (done or dropped), then complete',
      ),
    ],
    items: { label: 'Pistes', hint: 'the improvement candidates (label = "category: fix")', linkedStep: 'apply' },
    uses: { 'writing-for-agents': 'style' },
    flow: [phase('retro')],
  },

  // ─── Santé du code et conception ────────────────────────────────────────
  'improve-codebase-architecture': {
    id: 'improve-codebase-architecture',
    label: 'Architecture',
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
    flowLabel: 'Design',
    verb: 'Modules profonds : interfaces, seams et alternatives',
    glyph: '▣',
    color: C.teal,
    role: 'detour',
    isUserOnly: false,
    steps: [
      step('frame', 'Cadrer le problème', 'constraints, dependencies, sketch'),
      step('alternatives', 'Alternatives', 'sub-agents design different interfaces'),
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
      step('challenge', 'Confronter au glossaire', 'challenge terms against GLOSSARY.md'),
      step('sharpen', 'Préciser les termes', 'propose canonical terms, probe edge cases'),
      step('record', 'Glossaire et ADR', 'write the glossary and ADRs'),
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
      step('skills', 'Skills suggérés', 'suggest the next skills'),
      step('refs', 'Références', 'point to specs, ADRs, issues, commits'),
      step('save', 'Document enregistré', 'save it in the temp directory'),
    ],
    flow: [phase('handoff')],
  },
  teach: {
    id: 'teach',
    label: 'Apprentissage',
    flowLabel: 'Apprentissage',
    verb: 'Une leçon dans l’espace de travail, au bon niveau',
    glyph: '✎',
    color: C.amber,
    role: 'flow',
    isUserOnly: true,
    steps: [
      step('mission', 'Mission', 'check MISSION.md'),
      step('resources', 'Ressources', 'gather trusted resources'),
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
    gender: 'f',
    flowLabel: 'Mise en place',
    verb: 'Tracker, labels de triage et docs de domaine du dépôt',
    glyph: '⊞',
    color: C.slate,
    role: 'flow',
    isUserOnly: true,
    steps: [
      step('explore', 'Explorer le dépôt', 'remote, CLAUDE.md, glossaries, docs/agents'),
      step('tracker', 'Tracker', 'section A: the issue tracker'),
      step('labels', 'Labels', 'section B: triage labels'),
      step('domain', 'Docs de domaine', 'section C: domain docs layout'),
      step('draft', 'Brouillon', 'show the draft'),
      step('write', 'Config écrite', 'write docs/agents and the Agent skills block'),
    ],
    flow: [phase('setup-matt-pocock-skills')],
    next: ['grill-with-docs', 'triage', 'wayfinder'],
  },
  'ask-matt': {
    id: 'ask-matt',
    label: 'Orientation',
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
  'implement-spec',
  'triage',
  'wayfinder',
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
  { skill: 'wayfinder', title: 'Explorer un grand chantier', hint: 'carte de tickets de décision' },
  { skill: 'improve-codebase-architecture', title: 'Santé de l’architecture', hint: 'modules à approfondir' },
]

/** Les autres skills, par famille : avec LAUNCHERS, les 27 skills mattpocock et les commandes de livraison du plugin project. */
export const COMMAND_GROUPS: { title: string; skills: string[] }[] = [
  { title: 'Cadrer et planifier', skills: ['grill-me', 'to-questionnaire', 'ask-matt', 'setup-matt-pocock-skills'] },
  { title: 'Construire', skills: ['implement-spec', 'tdd', 'prototype', 'research', 'wizard'] },
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
export const CODE_SKILLS = new Set(['implement', 'implement-spec', 'tdd', 'diagnosing-bugs', 'prototype'])
