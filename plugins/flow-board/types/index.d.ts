// Contrat d'état de flow-board : le tableau de bord du workflow mattpocock-skills.
//
// Un projet (racine de la session) garde ses parcours ; un parcours enchaîne des
// phases (une par skill : Cadrage, Spec, Tickets…) ; une phase déroule les étapes
// internes de son skill. Les détours (prototype, handoff…) se greffent sur une phase.

/** Actif, en pause (un autre parcours a pris la main) ou terminé. */
export type FlowStatus = 'active' | 'paused' | 'done'

export type PhaseStatus = 'pending' | 'active' | 'done' | 'skipped'

export type StepStatus = 'pending' | 'active' | 'done' | 'skipped'

/** Statut d'un élément suivi par une phase : hypothèse, candidat, seam, décision… */
export type ItemStatus = 'todo' | 'doing' | 'done' | 'dropped'

export type TicketStatus = 'todo' | 'doing' | 'done' | 'blocked'

/**
 * Une tâche hors du lot dont un ticket dépend : une décision à prendre, ou le travail de
 * quelqu'un d'autre. Elle bloque ses tickets tant qu'elle n'est pas faite (cochée dans Asana).
 */
export type ExternalBlocker = {
  /** GID Asana (ou id du tracker). */
  id: string
  name: string
  status: 'todo' | 'done'
  /** Une décision à trancher (statut Asana « à trancher » ou « à confirmer »). */
  isDecision: boolean
}

/**
 * Un groupe de tickets à faire d'affilée dans une même discussion, parce qu'ils partagent leur
 * contexte (mêmes fichiers, chaîne de dépendances). Déclaré par Claude à la fin de /to-tickets.
 */
export type TicketGroup = {
  /** Court : « A », « B »… */
  id: string
  name: string
  /** Ids des tickets, dans l'ordre d'exécution. */
  tickets: string[]
  /** Le contexte partagé qui justifie le groupe. */
  why?: string
  /** Fichiers ou dossiers du dépôt touchés : deux groupes qui en partagent ne vont pas en parallèle. */
  files?: string[]
  /**
   * Ressources que le groupe ne partage pas pendant qu'il travaille : une application pilotée à
   * l'écran (« PowerBI Desktop »), une base ou un appareil unique. Deux groupes qui en partagent
   * une ne vont pas en parallèle, même sans fichier commun.
   */
  resources?: string[]
  /** À faire dans la discussion qui a créé les tickets, dont le contexte lui sert (un seul groupe). */
  continuesHere?: boolean
  /** Id de la discussion qui a envoyé le plan (`continuesHere`) : « cette discussion » n'a de sens que là. */
  continuesIn?: string
  /**
   * Groupe confié à une session liée depuis le panneau : le parcours reste dans la discussion
   * principale, qui suit la session et rend les statuts de ses tickets à sa note de fin.
   */
  linked?: GroupLink
  /**
   * Le groupe a été fait par une session liée, puis rendu : sa revue, si elle manque, se fait
   * là-bas, car ici sa branche est déjà fusionnée et `/code-review` n'aurait rien à lire.
   */
  delegated?: GroupLink
  /** Quand `/code-review` (Claude Code) a relu le groupe, une fois ses tickets faits. */
  reviewedAt?: number
  /** La revue de sécurité du groupe : l'avis de Claude, puis `/security-review` s'il a été lancé. */
  security?: SecurityCheck
}

/** Un groupe confié à une session liée : quand, et l'id `local_…` de la session une fois lancée. */
export type GroupLink = {
  at: number
  session?: string
}

/**
 * `/security-review` (Claude Code) sur un groupe fini : facultatif. Claude dit s'il le conseille
 * (auth, droits, entrées, secrets…), la personne le lance ou non ; il ne bloque jamais la livraison.
 */
export type SecurityCheck = {
  /** L'avis de Claude, une fois le groupe relu : la revue vaut-elle la peine ? */
  isAdvised?: boolean
  /** Pourquoi, court, dans la langue de la personne. */
  why?: string
  /** Quand `/security-review` a été lancé sur le groupe. */
  ranAt?: number
  /** Ce qu'il a trouvé de réel, et combien ont été corrigés. */
  findings?: number
  fixed?: number
}

/** `cancelled` : lancement refusé (par la personne ou un hook), ou interrompu. */
export type AgentStatus = 'running' | 'done' | 'failed' | 'cancelled'

export type Tone = 'info' | 'ok' | 'warn' | 'error' | 'accent'

/** Ce que fait la session : Claude travaille, attend la personne, ou des agents tournent seuls. */
export type LiveMode = 'idle' | 'working' | 'waiting' | 'agents'

export type FlowStep = {
  /** Id de l'étape dans le catalogue du skill. */
  id: string
  status: StepStatus
  /** Début de l'étape (ms), posé quand elle devient active. */
  at?: number
}

export type FlowItem = { id: string; label: string; status: ItemStatus }

/**
 * Éléments d'une phase confiés à une session liée depuis le panneau (les pistes d'une rétro) :
 * le parcours reste dans la discussion principale, qui suit la session et rend les statuts.
 */
export type LinkedWork = {
  /** Ids des éléments confiés, dans l'ordre de la liste. */
  items: string[]
  /** Envoi de la demande (ms). */
  at: number
  /** Id de la session liée (`local_…`), relevé quand Claude la lance. */
  session?: string
}

/** Chiffres d'une phase relevés automatiquement. */
export type PhaseStats = {
  /** Questions posées (blocs `❓ **Qn**` du grilling). */
  questions: number
  /** Tours de questions (réponses de Claude qui en contiennent). */
  rounds: number
  /** Réponses de la personne pendant la phase. */
  answers: number
  /** Constats de revue, axe Standards, cumulés sur les revues de la phase ; -1 tant qu'aucune n'a rendu. */
  standards: number
  /** Constats de revue, axe Spec, cumulés ; -1 tant qu'aucune revue n'a rendu. */
  spec: number
  /** Revues rendues, comptées par Claude (champ `review` de l'outil). Absent : compteurs d'avant la 0.19.0. */
  reviews?: number
  /** Constats corrigés, cumulés. */
  fixed?: number
}

/** Un skill lancé hors du fil du parcours, rattaché à la phase en cours. */
export type Detour = {
  skill: string
  status: 'active' | 'done'
  startedAt: number
  finishedAt?: number
  steps: FlowStep[]
  items: FlowItem[]
}

export type FlowPhase = {
  /** Skill qui mène la phase (peut basculer sur une alternative : implement-spec). */
  skill: string
  /** Autres skills qui peuvent tenir cette phase. */
  alts: string[]
  /** Facultative : sautée sans souci si le parcours passe outre. */
  isOptional: boolean
  status: PhaseStatus
  steps: FlowStep[]
  items: FlowItem[]
  /** Nombre de lancements du skill sur cette phase (un /implement par ticket…). */
  round: number
  startedAt?: number
  finishedAt?: number
  detours: Detour[]
  stats: PhaseStats
  /** Éléments confiés à une session liée, tant que la phase les suit. */
  linked?: LinkedWork
}

export type Ticket = {
  /** Id du tracker (GID Asana, `#12` GitHub, `03` local) ou id choisi par Claude. */
  id: string
  name: string
  status: TicketStatus
  /** Ids des tickets qui doivent être faits avant celui-ci (les « Blocked by » de /to-tickets). */
  blockedBy?: string[]
  /** Ce qu'attend un ticket bloqué hors du lot : une décision, un accord, un accès. */
  why?: string
  /** Fichiers ou dossiers que le ticket touche : ils s'ajoutent à ceux de son groupe. */
  files?: string[]
  /**
   * Id de la discussion qui a passé le ticket « en cours » ; effacé quand il en sort. Plusieurs
   * tickets peuvent être en cours à la fois (sous-agents de /implement-spec, autre discussion).
   */
  by?: string
  startedAt?: number
  finishedAt?: number
  /**
   * Affichage seulement, jamais enregistré : le groupe confié dont la session liée relaie ce
   * statut. Fait ainsi, le ticket ne lève ses dépendances que dans ce groupe.
   */
  relayedFrom?: string
}

/**
 * Une tâche créée dans le tracker pendant le parcours, hors du lot : constat de revue, anomalie
 * découverte, action pour la personne. Visible, mais hors de la progression et de la livraison ;
 * elle entre dans le lot quand Claude l'envoie dans `tickets`.
 */
export type FoundTask = {
  /** GID Asana, `#12` GitHub. */
  id: string
  name: string
  status: TicketStatus
  /** Ce qu'elle attend, quand elle est bloquée (ligne « Statut : » d'Asana). */
  why?: string
  /** Assignée à la personne : c'est à elle de la faire. */
  isForUser?: boolean
  /** Lien de l'issue, quand l'id ne suffit pas à le construire. */
  url?: string
  at: number
}

/**
 * Un choix que Claude a fait sans que la personne l'ait demandé ni validé : ticket traité hors
 * de la file, approche choisie parmi plusieurs, travail reporté, périmètre changé.
 */
export type SoloDecision = {
  at: number
  /** Le choix, court, dans la langue de la personne. */
  what: string
  why?: string
  /** Quand la personne l'a marqué comme relu. */
  seenAt?: number
  /** Affichage seulement, jamais enregistré : le groupe confié dont la session liée a relayé ce choix. */
  relayedFrom?: string
}

export type AgentRow = {
  /** tool_use_id de l'appel Agent. */
  key: string
  /** Id rendu par l'appel, que SubagentStop rappelle. */
  agentId?: string
  name: string
  /** Rôle déduit de la description : implementer, merger, relecteur… */
  role?: string
  model?: string
  isBackground: boolean
  status: AgentStatus
  startedAt: number
  finishedAt?: number
  /** Fin constatée après coup (le sous-agent n'était plus actif) : sa durée n'est pas connue. */
  isEndUnseen?: boolean
}

export type ArtifactKind =
  | 'glossary'
  | 'adr'
  | 'spec'
  | 'issue'
  | 'map'
  | 'report'
  | 'questionnaire'
  | 'prototype'
  | 'research'
  | 'handoff'
  | 'lesson'
  | 'config'
  | 'doc'
  | 'script'
  | 'pr'
  | 'plan'
  | 'tracking'

export type Artifact = {
  /** Chemin du fichier, ou URL pour une issue ou une PR. */
  path: string
  kind: ArtifactKind
  label: string
  detail?: string
  at: number
}

export type LogEntry = { at: number; glyph: string; text: string; tone: Tone }

export type TestRun = { at: number; ok: boolean; kind: 'test' | 'check' }

export type Counters = {
  commits: number
  merges: number
  worktrees: number
  /** Termes ajoutés au glossaire. */
  terms: number
  adrs: number
  testFiles: number
  /** Questions de reformulation (/wait-what). */
  repitches: number
}

export type Run = {
  id: string
  /** Skill de départ : il fixe la forme du parcours. */
  entry: string
  title: string
  /** Le titre vient de Claude ou des arguments, pas du nom du flux. */
  isTitled: boolean
  status: FlowStatus
  phases: FlowPhase[]
  /** Index de la phase en cours. */
  cursor: number
  tickets: Ticket[]
  /** Tickets lancés depuis le panneau, dans l'ordre choisi. */
  queue?: string[]
  /** Tâches hors du lot dont des tickets dépendent. */
  externals?: ExternalBlocker[]
  /** Tâches créées dans le tracker pendant le parcours, hors du lot (« Trouvé en route »). */
  found?: FoundTask[]
  /** Choix faits par Claude sans la personne, à relire (« Décidé sans toi »). */
  decided?: SoloDecision[]
  /** Plan d'exécution : les tickets regroupés par contexte (liste complète, remplacée d'un bloc). */
  groups?: TicketGroup[]
  /** Quand `/code-review` a relu le lot entier (parcours sans groupes, tickets tous faits). */
  reviewedAt?: number
  /** La revue de sécurité du lot entier, pour un parcours sans groupes. */
  security?: SecurityCheck
  agents: AgentRow[]
  artifacts: Artifact[]
  tests: TestRun[]
  log: LogEntry[]
  counters: Counters
  /** Fichiers modifiés (chemins normalisés, sans doublon). */
  touched: string[]
  startedAt: number
  updatedAt: number
  /** Id de la discussion où le parcours est actif ; absent quand il ne l'est nulle part. */
  owner?: string
  /** Rangé aux archives : caché de l'historique, ni repris ni proposé, jamais élagué ; se désarchive. */
  archivedAt?: number
  /**
   * Mis de côté par la personne (`/flow pause`, « ‖ Mettre de côté ») : en pause, jamais clos, et
   * repris seulement à sa demande (« Reprendre », champ `resume`), pas au chargement d'un skill.
   */
  asideAt?: number
  finishedAt?: number
}

/** Trace d'un parcours supprimé, pour qu'une autre discussion ne le fasse pas revenir. */
export type Tombstone = { id: string; at: number }

export type Board = {
  v: 1
  /** Racine du projet (clé du stockage). */
  root: string
  /** Nom court du projet. */
  name: string
  runs: Run[]
  /** Parcours actif DE CETTE DISCUSSION : jamais repris du stockage, qui est partagé. */
  activeId: string | null
  /** Id de la discussion qui tient cette copie du board. */
  session?: string
  /**
   * Cette discussion travaille pour une autre (session liée d'un groupe) : propre à la
   * discussion, jamais repris du stockage. Ses skills et ses rapports ne touchent aucun parcours.
   * `title` : le titre du parcours quand il n'est pas dans ce board (session dans un worktree,
   * qui a son propre fichier), lu dans celui du dépôt principal.
   */
  delegate?: {
    run: string
    at: number
    title?: string
    group?: string
    /**
     * La discussion principale telle que le brief la désigne, « <nom> [ref] » : son nom peut changer,
     * pas sa référence. Rappelé à chaque réponse de l'outil, pour que la session puisse la joindre.
     */
    main?: string
  }
  /** Parcours supprimés récemment (toutes discussions confondues). */
  deleted?: Tombstone[]
}

/**
 * L'avancement qu'une session liée relaie à la discussion principale, hors du parcours (qui n'a
 * qu'un écrivain) : ses tickets d'après ses mises à jour Asana ou ses `set`, ses commits, ses tests.
 */
export type RelayEntry = {
  /** Le groupe confié, quand la session l'a déclaré. */
  group?: string
  tickets: Record<string, { status: TicketStatus; why?: string; at: number }>
  commits: number
  lastCommit?: string
  test?: { ok: boolean; at: number }
  /** Quand la session a lancé `/code-review` (Claude Code) sur son groupe. */
  reviewedAt?: number
  /** Quand la session a lancé `/security-review` sur son groupe. */
  securedAt?: number
  /** Les choix faits sans la personne que la session a signalés (`decided`), dans l'ordre. */
  decided?: { what: string; why?: string; at: number }[]
  /** Le dernier signal reçu : un ticket, un commit, des tests, une note, une revue. */
  last?: { kind: 'ticket' | 'commit' | 'test' | 'note' | 'review' | 'decided'; text: string; at: number; ticket?: string }
  startedAt: number
  at: number
  /** La session s'est terminée (fin de discussion, pas un /clear). */
  endedAt?: number
}

/** Le relais d'un parcours : une entrée par session liée (id de la discussion), chacune écrite par elle seule. */
export type Relay = { v: 1; run: string; sessions: Record<string, RelayEntry> }

export type Live = {
  mode: LiveMode
  since: number
  /** Questions en attente de réponse (`Q4–Q6`), pendant un grilling. */
  ask: string | null
}

/**
 * Où en est la branche par rapport au dépôt distant, d'après le dernier `git fetch` du mod.
 * Les nombres sont null tant que rien n'a été mesuré (pas de dépôt, pas de distant, erreur).
 */
export type SyncState = {
  /** Commits de la branche principale distante (origin/main) absents de la branche courante. */
  behindMain: number | null
  /** Commits de la branche distante suivie par la branche courante, absents d'ici. */
  behindUpstream: number | null
  branch: string | null
  /** Nom de la branche principale (`main`, `master`…). */
  main: string | null
  isOnMain: boolean
  /** Sommets distants mesurés, `<sha de main>|<sha suivi>` : change à chaque fusion ou push distant. */
  remoteKey: string | null
  /** Sommets pour lesquels le sync a déjà été demandé une fois. */
  askedFor: string | null
  checkedAt: number | null
  /** Le dépôt a un distant `origin` ; null tant que ce n'est pas mesuré (ou hors d'un dépôt git). */
  hasRemote?: boolean | null
  /** `origin` pointe vers GitHub : la phase « Pull request » (/project:pr) n'a de sens que là. */
  isGitHub?: boolean | null
  /** Le projet est un dépôt git ; null tant que ce n'est pas mesuré. /implement-spec en a besoin. */
  isRepo?: boolean | null
}

export type Tab = 'flow' | 'activity' | 'history' | 'commands'

export type UiState = {
  tab: Tab
  isBandHidden: boolean
  /** La personne a fermé le panneau : il ne se rouvre plus tout seul cette session. */
  isPaneDismissed: boolean
  showAllTickets: boolean
  showAllLog: boolean
  /** Tous les éléments de la phase (décisions, hypothèses…), pas seulement les 14 premiers. */
  showAllItems?: boolean
  /** Tous les livrables, pas seulement les 14 premiers. */
  showAllArtifacts?: boolean
  /** Tous les sous-agents terminés gardés, pas seulement les 3 derniers. */
  showAllAgents?: boolean
  /** Les choix « décidé sans toi » déjà relus, dépliés. */
  showDecided?: boolean
  /** Toutes les tâches trouvées en route, pas seulement celles qui attendent la personne. */
  showFound?: boolean
  /** L'historique montre aussi les parcours archivés. */
  showArchived?: boolean
  /** « Trouvé en route » réduit à son titre, tâches qui attendent la personne comprises. */
  hideFound?: boolean
  /** Tickets choisis dans le panneau, dans l'ordre de sélection (cette discussion seulement). */
  selection: string[]
  /** Éléments de la phase (pistes d'une rétro) choisis pour une session liée. */
  itemSelection?: string[]
  /** Parcours archivé dont la suppression attend sa confirmation. */
  confirmDrop?: string
}

declare module 'claude-code' {
  interface PluginState {
    'flow-board': {
      board: Board | null
      live: Live
      ui: UiState
      /** Id de skill -> nom de la commande slash (`to-spec` -> `mattpocock-skills:to-spec`). */
      commands: Record<string, string>
      /** Retard de la branche sur le distant, pour savoir s'il faut demander /project:sync. */
      sync: SyncState
      /** L'avancement relayé par les sessions liées du parcours actif (discussion principale). */
      relay: Relay | null
    }
  }
}
