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
  // `continuesHere` et `continuesIn` (avant la 0.60.0) restent dans les anciens fichiers, sans effet :
  // un groupe ne se fait qu'en session liée.
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
  /** Groupe rendu : quand la personne a demandé de fermer sa session et son worktree (« ✕ Fermer… »). */
  closeAskedAt?: number
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
  /** Envoi de la demande (ms), ou sa dernière relance. */
  at: number
  /** Id de la session liée (`local_…`), relevé quand Claude la lance. */
  session?: string
  /**
   * Un tour de la discussion, commencé après l'envoi, s'est fini sans lancer de session (ms) : les
   * éléments attendent encore. Effacé par le lancement ou par une relance de la demande.
   */
  missedAt?: number
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
  /** Le ticket touche une zone sensible (`SENSITIVE_AREAS` de catalog.ts), dit au découpage. */
  sensitive?: boolean
  /** Le ticket a de la logique à relire : faux pour une ressource visuelle ou un document, dit au découpage. */
  logic?: boolean
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
  /** Le choix ne tient plus (`withdrawn` de l'outil) : il reste au parcours, hors du fichier des choix et du panneau. */
  withdrawnAt?: number
  /** Pourquoi il a été retiré, et ce qui le remplace s'il y a lieu. */
  withdrawnWhy?: string
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

/** La famille d'un outil, qui donne son glyphe sur la frise : ⌕ lecture, ✎ modification, ❯ commande, 🌐 web, ⇢ sous-agent. */
export type ToolFamily = 'read' | 'edit' | 'run' | 'web' | 'agent' | 'other'

/**
 * Les sortes de segments de la frise (Q3) : réflexion, rédaction, appel d'outil, et quatre attentes
 * (d'un sous-agent au premier plan, de la personne, d'une tâche de fond, de l'advisor consulté).
 */
export type SegmentKind = 'think' | 'write' | 'tool' | 'waitAgent' | 'waitPerson' | 'waitBg' | 'waitAdvisor'

/**
 * La fenêtre de vue de la frise, en temps réel. Figée, elle montre `start`–`end` ; quand elle suit
 * le direct (`isLive`), elle garde sa durée `end - start` et finit au bout de l'axe à chaque dessin.
 */
export type AgentsWindow = { start: number; end: number; isLive: boolean }

/** Un segment daté d'une piste ; sans fin, il est en cours et s'allonge jusqu'à maintenant. */
export type AgentSegment = {
  k: SegmentKind
  /** Début et fin, en ms. */
  s: number
  e?: number
  /** Pour un outil : sa famille, son nom, son argument court (fichier, motif, commande, adresse). */
  f?: ToolFamily
  t?: string
  a?: string
  /** L'outil a rendu une erreur. */
  x?: boolean
  /** Appels courts d'une même famille réunis dans ce segment (essai, point 13). */
  n?: number
  /** Une durée estimée (réflexion relue dans un transcript : ses blocs n'ont que l'heure de leur fin). */
  est?: boolean
}

/**
 * Les repères (des instants) : échec ✗, interruption ⊘, départ ↳ et retour ↲ d'un relais, compaction ⇣ ;
 * sur l'orchestrateur seulement, message d'une autre session ✉, commit ⎇, tests ✓/✗.
 */
export type MarkKind = 'fail' | 'stop' | 'relay' | 'back' | 'compact' | 'msg' | 'commit' | 'test'

export type AgentMark = {
  k: MarkKind
  at: number
  /** Tests : au vert ou non. */
  ok?: boolean
  /** Relais : la clé de la piste du sous-agent parti ou revenu. */
  to?: string
}

/** Une piste de la frise : ses segments et ses repères, et ce que la carte de détail en dit. */
export type AgentLane = {
  segments?: AgentSegment[]
  marks?: AgentMark[]
  /** L'effort demandé à ses requêtes, et les modèles qui ont répondu. */
  effort?: string
  models?: string[]
  /** Ses tokens, additionnés requête par requête (essai, point 2). */
  tokens?: AgentTokens
  /** Lignes ajoutées et retirées par ses modifications de fichiers. */
  lines?: { added: number; removed: number }
}

/**
 * Un sous-agent du registre de la session (onglet Agents) : sans limite de nombre, gardé après
 * l'archivage du parcours. Aucun texte de message ni rapport : la description, le prompt (Q8), des chiffres.
 */
export type RegistryAgent = AgentLane & {
  /** tool_use_id de l'appel Agent ; `agent:<id>` pour un agent lancé sans appel vu (Workflow). */
  key: string
  /** Id du sous-agent (`agent.spawn`, résultat de l'appel), que les fins rappellent. */
  agentId?: string
  /** Id d'agent du lanceur ; absent quand c'est le fil principal de la session. */
  parent?: string
  /** Le Workflow qui l'a lancé. */
  workflow?: string
  /** Sa description. */
  name: string
  /** `subagent_type` de l'appel. */
  subagentType?: string
  /** Le prompt donné au sous-agent (Q8), coupé au-delà de PROMPT_MAX caractères. */
  prompt?: string
  model?: string
  isBackground: boolean
  status: AgentStatus
  startedAt: number
  finishedAt?: number
  /** Fin constatée après coup (le sous-agent n'était plus actif) : sa durée n'est pas connue. */
  isEndUnseen?: boolean
  /** Réveils : un `agent.spawn` du même id après une fin, qui le rouvre (notification d'une de ses tâches). */
  wakes?: number
  /** Le parcours actif (ou servi, pour une session liée) à son lancement. */
  run?: string
  /** D'où vient l'entrée : le direct (hooks), ou le rattrapage par transcript. */
  source: 'live' | 'transcript'
  /** Son type (Q9), déduit à son lancement : il fixe sa couleur et son glyphe. */
  type?: AgentType
}

/** Les 9 types de sous-agents (Q9). */
export type AgentType = 'explore' | 'research' | 'implement' | 'review' | 'security' | 'merge' | 'plan' | 'transcripts' | 'other'

/** Les tokens d'un agent par sorte ; la réflexion n'est pas comptée à part par l'API (essai, point 4). */
export type AgentTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** Une période où une session a porté un parcours (S31, S37) : de `from` à `to`. */
export type CarrySpan = { from: number; to: number }

/**
 * Un appel à l'advisor tel qu'un transcript le donne : l'id de l'appel (celui du bloc
 * `server_tool_use`), ses heures (la fin manque quand la réponse s'est coupée avant son résultat),
 * et, d'après l'entrée `advisor_message` de `usage.iterations`, son modèle et ses tokens (absents
 * quand l'entrée ne les a pas). Aucun contenu de sa réponse.
 */
export type AdvisorFigures = { id: string; s: number; e?: number; model?: string; tokens?: AgentTokens }

/**
 * Un appel de la ligne advisor : ses chiffres, l'appelant (`main` pour l'orchestrateur, sinon l'id
 * du sous-agent), et `isRead` une fois relu dans un transcript : sans tokens, il compte alors sans
 * prix, au lieu d'attendre un rattrapage qui n'en dira pas plus.
 */
export type AdvisorCall = AdvisorFigures & { by: string; isRead?: boolean }

/** La ligne advisor d'une session : ses appels, avec leurs chiffres une fois relus dans les transcripts. */
export type AdvisorLane = { calls: AdvisorCall[] }

/** Le fichier de registre d'une session : écrit par elle seule (Q7), lu par les autres. */
export type SessionRegistry = {
  v: 1
  /** `$.session.id()` de la session. */
  session: string
  /** Racine du projet de la session. */
  root: string
  title?: string
  /** `transcript_path` des hooks classiques, relevé tel quel. */
  transcript?: string
  /** Le parcours servi et le groupe, pour une session liée (appel `delegate`). */
  run?: string
  group?: string
  agents: RegistryAgent[]
  /** La piste de la session elle-même (l'orchestrateur) : ses tours, ses outils, ses attentes. */
  main?: AgentLane
  /** La ligne advisor : les appels de l'orchestrateur et de ses sous-agents ; absente sans appel. */
  advisor?: AdvisorLane
  /** Les sessions liées que cette session a lancées (`start_session`, `claude --bg`), avec ou sans parcours. */
  linked?: LinkedLaunch[]
  /**
   * Les ids des parcours que cette session a portés (S28) : actifs ici, ou un de leurs tickets passé
   * « en cours » par elle ; des ids seulement. Le rattrapage y rattache ses sous-agents manqués (Q-a).
   */
  carried?: string[]
  /**
   * Pour chaque parcours de `carried`, les périodes où cette session le portait (S31, S37) : une
   * par portage, une nouvelle après plus de 10 min sans le porter, 20 au plus ; des dates, aucun
   * contenu. Le rattachement d'un sous-agent rattrapé s'y borne (R3). Un id sans dates (en-tête
   * d'avant) n'a pas de borne.
   */
  carriedAt?: Record<string, CarrySpan[]>
  /**
   * S40 : la date de la première écriture qui ne portait plus un parcours daté, après sa dernière
   * période. Une période ne se rouvre que si une écriture faite entre-temps ne le portait pas ;
   * sans écriture entre-temps, la période en cours s'allonge, trou compris.
   */
  carriedNotedAt?: number
  updatedAt: number
  /**
   * Le nombre de morceaux du registre sur le disque (R1), celui-ci compris : au-delà d'environ
   * 3 Mo, la suite va dans `<session>.1.json`, `<session>.2.json`… Absent : un seul.
   */
  parts?: number
}

/**
 * Une session liée lancée par cette session : l'id que son lancement rend (`local_…` de
 * `start_session`, id court de `claude --bg`), son titre, quand.
 */
export type LinkedLaunch = { id: string; title?: string; at: number; via: 'bg' | 'desktop' }

/** Un morceau du registre d'une session, après le premier (R1) : des sous-agents et un bout de la piste de l'orchestrateur. */
export type RegistryPart = {
  v: 1
  session: string
  part: number
  agents: RegistryAgent[]
  main?: Pick<AgentLane, 'segments' | 'marks'>
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
  /** Le titre vient de Claude (ou du parcours parent d'une suite), pas du nom du flux. */
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
  /**
   * L'ancien champ des sous-agents (12 au plus), d'avant le registre : relu une fois pour être
   * recopié dans le fichier du parcours, puis vidé (S1, S18, S21 : une liste vide, qu'une version
   * d'avant lit sans casser). Plus jamais rempli.
   */
  agents?: AgentRow[]
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
  /**
   * Id de la discussion où le parcours est né, posé à sa création et jamais effacé (depuis la
   * 0.60.0) : seule elle prend son titre. Absent d'un parcours d'avant, qui ne compte pas.
   */
  bornIn?: string
  /**
   * Le premier lancement d'une session liée par ce parcours (groupe ou éléments d'une phase), jamais
   * effacé : la discussion ne prend plus de titre ensuite (depuis la 0.60.0).
   */
  linkedAt?: number
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
    /** Quand `main` a été connu : au `delegate`, puis à chaque nouvelle référence lue à côté du relais. */
    mainAt?: number
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
  /** Les choix déclarés que la session a retirés (`withdrawn`), le sien comme un autre : hors du fichier des choix. */
  withdrawn?: { what: string; why?: string; at: number }[]
  /**
   * Le compte rendu final de la session (`report`), en filet de son envoi par SendMessage : la
   * discussion principale, renommée ou redémarrée, peut ne jamais recevoir le message.
   */
  report?: {
    text: string
    at: number
    /** La longueur du compte rendu envoyé, quand `text` en est coupé (au-delà de 8 000 caractères). */
    length?: number
    /** Le compte rendu entier est écrit dans son fichier, à côté du relais (`<parcours>.<session>.report.md`). */
    isWhole?: boolean
  }
  /** Les constats des revues que la session a envoyés (`review`), cumulés : comptés au retour du groupe. */
  reviews?: { count: number; standards: number; spec: number; fixed: number }
  /** La revue de sécurité que la session a envoyée (`security`) : reprise au retour du groupe. */
  security?: { advised?: boolean; why?: string; findings?: number; fixed?: number; at: number }
  /** Le dernier signal reçu : un ticket, un commit, des tests, une note, une revue, le compte rendu. */
  last?: { kind: 'ticket' | 'commit' | 'test' | 'note' | 'review' | 'decided' | 'report'; text: string; at: number; ticket?: string }
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
 * Où en est la branche du dossier où l'on code par rapport au dépôt distant, d'après le dernier `git fetch` du mod.
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
  /** Commits de la branche courante absents de origin/main ; null tant que ce n'est pas mesuré. */
  aheadMain?: number | null
  /**
   * Le dossier mesuré (racine de son worktree) : celui de la session quand elle travaille dans un
   * autre worktree du dépôt que la racine du board, sinon cette racine ; null tant que ce n'est pas mesuré.
   */
  dir?: string | null
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
  /**
   * Chaque plugin ou paquet changé face à la branche distante (suivie, sinon origin/main) a une
   * nouvelle version dans son manifeste : la livraison ne repropose pas /project:version. Null sans
   * manifeste de version dans le dépôt, ou tant que ce n'est pas mesuré.
   */
  isVersionSet?: boolean | null
}

export type Tab = 'flow' | 'agents' | 'activity' | 'history' | 'commands'

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
  /**
   * Frise de l'onglet Agents : la fenêtre de vue (zoom et déplacement), en temps réel ; absente,
   * tout. Propre à la discussion, jamais enregistrée, remise à « tout » à la réouverture.
   */
  agentsWindow?: AgentsWindow
  /** Onglet Agents : la piste dont la carte de détail est ouverte (clé d'appel, ou `main`). */
  agentCard?: string
  /** Onglet Agents : la session liée dont la frise est montrée (sa clé) ; absente, l'orchestrateur. */
  agentsSession?: string
  /** Onglet Agents : l'entrée du sélecteur d'historique (`run:<id>`, `session:<id>`) ; absente, « Ici, maintenant ». */
  agentsHistory?: string
  /** Onglet Agents : la liste du sélecteur d'historique est dépliée. */
  isAgentsHistoryOpen?: boolean
  /** Onglet Agents : la discussion (`session:<id>`) dont « ✗ Oublier » attend sa confirmation. */
  confirmForget?: string
  /** La carte de détail montre le prompt en entier. */
  isPromptOpen?: boolean
  /** Onglet Agents : la légende détaillée est dépliée (repliée par défaut). */
  isLegendOpen?: boolean
  /** Frise : les Workflow dépliés (par leur `runId`), pour la discussion. */
  openWorkflows?: string[]
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
      /** Le registre des sous-agents de cette session (onglet Agents). */
      agents: SessionRegistry | null
      /** Les clés des sous-agents que ce processus a vus partir (S9). */
      agentsOwn: string[]
      /** Une écriture du registre a été refusée (S11) ; `'lost'` : un changement n'a pas pu s'appliquer à l'état (R2). */
      agentsAlert: boolean | 'lost'
      /** Les sessions liées vues à la dernière relecture (onglet Agents). */
      agentsLinked: { key: string; session?: string; title: string; how: 'run' | 'relay' | 'id' | 'job' | 'title' | 'none'; state: 'working' | 'returned' | 'failed' | 'closed'; launchedAt?: number; returnedAt?: number }[]
      /** Le sélecteur d'historique de l'onglet Agents. */
      agentsHistory: { key: string; kind: 'now' | 'run' | 'session'; title: string; at?: number; isArchived?: boolean; agents?: number }[]
      /** Les prix des modèles tirés de ccusage (Q15), relevés au plus une fois par jour. */
      agentPrices: { at: number; prices: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> } | null
    }
  }
}
