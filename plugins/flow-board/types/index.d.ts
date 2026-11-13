// Contrat d'état de flow-board : le tableau de bord du workflow mattpocock-skills.
//
// Un projet (racine de la session) garde ses missions ; une mission enchaîne des
// phases (une par skill : Cadrage, Spec, Tickets…) ; une phase déroule les étapes
// internes de son skill. Les détours (prototype, handoff…) se greffent sur une phase.

/** Actif, en pause (une autre mission a pris la main) ou terminé. */
export type FlowStatus = 'active' | 'paused' | 'done'

export type PhaseStatus = 'pending' | 'active' | 'done' | 'skipped'

export type StepStatus = 'pending' | 'active' | 'done' | 'skipped'

/** Statut d'un élément suivi par une phase : hypothèse, candidat, seam, décision… */
export type ItemStatus = 'todo' | 'doing' | 'done' | 'dropped'

export type TicketStatus = 'todo' | 'doing' | 'done' | 'blocked'

/**
 * Une tâche hors du lot dont un ticket dépend : une décision à prendre, ou le travail de
 * quelqu'un d'autre. Elle bloque ses tickets tant qu'elle n'est pas faite (cochée dans Asana, ou levée par
 * un envoi "status": "done"). Levée, elle ne redevient à faire que par un envoi explicite "status": "todo", ou par
 * sa tâche Asana décochée.
 */
export type ExternalBlocker = {
  /** GID Asana (ou id du tracker), ou un id local sans tâche (la session d'une autre mission qui touche les mêmes fichiers). */
  id: string
  name: string
  status: 'todo' | 'done'
  /**
   * La date du dernier changement de statut envoyé (un "status" explicite, ou la tâche Asana cochée ou décochée) : la fusion de
   * deux copies garde le plus récent (`keepExternals`). Absente pour un ajout sans statut envoyé ; au-delà de la
   * tolérance, à la lecture (`clampFuture`), celle d'un « todo » tombe et celle d'une levée est ramenée à maintenant.
   */
  statusAt?: number
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
  // un groupe ne se fait que dans un worker.
  /**
   * Groupe confié à un worker depuis le panneau : la mission reste dans la discussion
   * principale, qui suit la session et rend les statuts de ses tickets à sa note de fin.
   */
  linked?: GroupLink
  /**
   * Le groupe a été fait par un worker, puis rendu : sa revue, si elle manque, se fait
   * là-bas, car ici sa branche est déjà fusionnée et `/code-review` n'aurait rien à lire.
   */
  delegated?: GroupLink
  /** Quand `/code-review` (Claude Code) a relu le groupe, une fois ses tickets faits. */
  reviewedAt?: number
  /** La revue de sécurité du groupe : l'avis de Claude, puis `/security-review` s'il a été lancé. */
  security?: SecurityCheck
  /** Les envois du groupe à un worker, annulés compris : le suivant prend le numéro d'après (jamais un numéro déjà donné). */
  sends?: number
  /**
   * La revue et l'avis de sécurité d'avant (faits ici, ou ceux d'un envoi rendu) ont été remis à zéro à un
   * envoi qui n'est pas encore revenu : tant que le groupe est en vol, « reviewed » et un avis de sécurité pour
   * lui sont refusés (une revue ou un avis faits avant l'envoi ne valent jamais pour lui). Posé par
   * `startLinkedGroups` ; lu seulement s'il vaut `true` ; gardé par une annulation, un renvoi de vague, un plan
   * renvoyé et la fusion ; effacé seulement au retour d'un envoi (`returnGroups`).
   */
  isReset?: true
}

/** Un groupe confié à un worker : quand, et l'id `local_…` de la session une fois lancée. */
export type GroupLink = {
  at: number
  /**
   * L'id court de la session (celui de `claude --bg`, ou `local_…` de l'app), noté une fois : par la sortie du
   * lancement, sinon par l'entrée de relais que l'appel `delegate` de la session de ce groupe a déposée pendant cet
   * envoi (`linkRelaySessions`) ; jamais réécrit, repris de l'autre copie à la fusion s'il manque (`keepSessions`).
   */
  session?: string
  /** Groupe rendu : quand la personne a demandé de fermer sa session et son worktree (« ✕ Fermer… », puis « ↻ Relancer la fermeture »). */
  closeAskedAt?: number
  /**
   * Le numéro de l'envoi du groupe, à partir du deuxième (absent : le premier) : il nomme son worktree
   * (`groupe-<parcours>-<id>-2`), la branche gardée d'un envoi précédent restant prise.
   */
  seq?: number
  /**
   * Groupe rendu : où en est la fermeture de sa session et de son worktree, rapportée par Claude
   * (`closed`). « closed » ne recule jamais : seul un nouvel envoi `closed` le change.
   */
  closing?: Closing
  /** Quand un appel de l'outil a touché le groupe (statuts, revue, sécurité, retour) : une fermeture arrêtée avant redevient à faire. */
  touchedAt?: number
  /**
   * Groupe confié de nouveau puis rendu : les sessions précédentes, avec leur fermeture ; une
   * fermée ne se refait pas, une autre reste à fermer (aucune session oubliée).
   */
  earlier?: ClosedLink[]
  /**
   * Le nom du worktree de cet envoi (`groupe-[<nom court>-]<id>[-<n>]`, sans nom court pour un titre sans lettre ASCII), noté une fois, à la création du lien
   * (`sendGroups`), d'après le titre de la mission à cet instant, seulement en forme (`isNotedWorktree`) ;
   * jamais réécrit ; recopié avec le lien quand il devient `delegated` puis une entrée de `earlier` ; effacé
   * seulement avec le lien ou la mission. La fermeture, le script de vérification, le nettoyage des branches et
   * sa marque le lisent (`sendWorktree`) ; absent (lien d'avant la note), le nom se recalcule depuis le titre.
   * Une fusion ne le change jamais : un nom absent d'une copie prend celui de l'autre (même envoi : même `at`).
   */
  worktreeName?: string
  /**
   * Deux copies notaient deux noms différents pour cet envoi : posé par la fusion (`keepSendNames`), jamais
   * retiré, recopié avec le lien comme `worktreeName`. Toute valeur relue compte : aucun nom de cet envoi
   * n'entre alors dans une commande, la fermeture s'arrête et le dit, et sa branche est gardée.
   */
  worktreeClash?: true
  /**
   * L'id de session de cet envoi n'a pas pu être noté sûrement : plus d'une session candidate (une autre que celle déjà
   * notée comprise), un id hors forme ou une session déjà notée pour un autre envoi, au relais (`linkRelaySessions`), ou
   * deux copies qui notaient deux ids différents (`keepSessions`). Un envoi marqué n'attend plus de session
   * (`linkGroupSession`) et ne s'annule pas (`cancelLinkedGroup`). Posé une fois,
   * jamais retiré, recopié avec le lien comme `worktreeName` ; effacé seulement avec le lien ou la mission. Toute
   * valeur relue compte : la fermeture de cet envoi ne ferme rien (ni `claude stop` ni `claude rm`) et le dit.
   */
  sessionClash?: true
}

/** Un worker dont un nouvel envoi a pris la place : son lien (envoi, id, nom de son worktree) et sa fermeture, si elle en a une. */
export type ClosedLink = { at: number; session?: string; seq?: number; closing?: Closing; worktreeName?: string; worktreeClash?: true; sessionClash?: true }

/** La fermeture d'un worker rendu (un groupe, ou la session des pistes d'une phase). */
export type Closing = {
  /** `closed` : session et worktree fermés ; `app` : la personne doit l'archiver dans l'app ; `stopped` : arrêtée, avec sa raison. */
  state: 'closed' | 'app' | 'stopped'
  why?: string
  at: number
  /** Pour `closed`, quand ils sont connus : de quoi rouvrir la session sur sa branche gardée. */
  sessionId?: string
  branch?: string
  worktree?: string
  /**
   * Quand la consigne de suppression des branches, qui visait la branche notée, est partie (après
   * l'envoi réussi du message de « ✓ Valider le rapport », série 24) : « ↺ Rouvrir » disparaît. Ne
   * recule jamais (la fusion garde la fermeture marquée) ; part si la branche notée change.
   */
  cleanupAt?: number
  /**
   * Un groupe clos (`closed`) alors que la revue de sécurité du projet était désactivée : posé à sa première
   * fermeture, seulement si le réglage relu à cet instant dit « désactivée » et que son avis est conseillé sans
   * revue faite ; gardé par un « closed » renvoyé, jamais posé ensuite. Le groupe garde sa ligne « désactivée »
   * au compte rendu et n'a plus de revue de sécurité due, quel que soit le réglage ensuite.
   */
  securityOff?: true
}

/**
 * `/security-review` (Claude Code) sur un groupe fini : facultatif. Claude dit s'il le conseille
 * (auth, droits, entrées, secrets…), la personne le lance ou non ; il ne bloque jamais la livraison.
 */
export type SecurityCheck = {
  /** L'avis de Claude, une fois le groupe relu : la revue vaut-elle la peine ? */
  isAdvised?: boolean
  /**
   * La marque « revue de sécurité désactivée pour ce projet » d'un avis conseillé sans revue faite : sa date,
   * posée par la discussion de la mission à la réception de l'avis, ou à la fermeture du groupe (`closed`),
   * seulement si le réglage du projet relu à cet instant dit « désactivée » (jamais sur une lecture ratée).
   * Posée à la première fermeture même si l'avis en portait déjà une. Informative : un groupe clos ne vaut
   * « désactivée » que par sa fermeture (`Closing.securityOff`, `isClosedTurnedOff`) ; un groupe clos sans elle
   * suit le réglage relu, comme un groupe ouvert. Une marque datée à plus d'une minute dans le futur tombe à la
   * lecture (`clampFuture`). Copiée avec l'avis ; part avec lui à un nouvel envoi ou un nouveau passage du lot.
   */
  offAt?: number
  /** Pourquoi, court, dans la langue de la personne. */
  why?: string
  /** Quand `/security-review` a été lancé sur le groupe. */
  ranAt?: number
  /** Ce qu'il a trouvé de réel, et combien ont été corrigés. */
  findings?: number
  fixed?: number
  /**
   * Les failles gardées que la personne décide de laisser, sur sa confirmation : avec `fixed`, elles
   * rendent la sécurité tranchée. Un envoi de `dismissed` le change ; un envoi qui change `findings`
   * sans lui le remet à 0 ; seul un envoi de la discussion de la mission le pose (pour le lot sans groupes, la fusion peut aussi reprendre celui de l'avis d'une autre copie, plus récent).
   */
  dismissed?: number
  /**
   * Les failles laissées qu'un worker a relayées : une proposition, affichée, qui ne tranche
   * rien ; seul un envoi de `dismissed` par la discussion de la mission compte.
   */
  proposedDismissed?: number
  /**
   * La date de l'avis, pour le lot d'une mission sans groupes seulement : posée à chaque envoi de
   * sécurité du lot et au lancement de `/security-review` sans groupes ; un envoi sur l'avis d'un
   * passage précédent garde la sienne. L'avis ne tranche la sécurité du lot que s'il est postérieur à
   * la dernière fin de ticket et à la dernière revue du lot ; sans date (avis d'avant ce champ), il se date par la dernière revue du
   * lot, et la revue suivante (`/code-review`) ou la fusion avec une revue plus récente lui pose
   * d'abord celle de la revue d'avant (0 sans elle) ; une date au-delà de la tolérance se relit 0.
   * Jamais effacé seul : il part avec la mission.
   */
  at?: number
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
 * Éléments d'une phase confiés à un worker (les pistes d'une rétro) par un envoi d'avant la
 * demande de découpage : le panneau n'en crée plus, mais suit, relance et ferme ceux qui existent ;
 * la mission reste dans le manager, qui suit la session et rend les statuts.
 */
export type LinkedWork = {
  /** Ids des éléments confiés, dans l'ordre de la liste. */
  items: string[]
  /** Envoi de la demande (ms), ou sa dernière relance. */
  at: number
  /** Id du worker (`local_…`), relevé quand Claude le lance. */
  session?: string
  /**
   * Un tour de la discussion, commencé après l'envoi, s'est fini sans lancer de session (ms) : les
   * éléments attendent encore. Effacé par le lancement ou par une relance de la demande.
   */
  missedAt?: number
  /**
   * Où en est la fermeture de la session, une fois ses éléments jugés (`closed` avec `items`).
   * « closed » ne recule jamais ; tant qu'elle n'est pas fermée, le lien tient la phase : aucune piste ne se découpe.
   */
  closing?: Closing
  /** Un envoi des éléments de la phase après une fermeture arrêtée : elle redevient à faire. */
  touchedAt?: number
  /** « ↻ Relancer la fermeture » sur une fermeture arrêtée. */
  closeAskedAt?: number
  /** Le numéro de l'envoi dans la phase (1, 2…) : il nomme le worktree de la session (`pistes-2`). */
  seq?: number
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
  /**
   * Constats de la relecture du fond et de la forme (champ `form` de `review`), cumulés ; absent tant
   * qu'aucune relecture n'en a rendu (jamais 0 par défaut). Il ne baisse jamais, hors effacement de la mission.
   */
  form?: number
}

/** Un skill lancé hors du fil de la mission, rattaché à la phase en cours. */
export type Detour = {
  skill: string
  status: 'active' | 'done'
  startedAt: number
  finishedAt?: number
  steps: FlowStep[]
  items: FlowItem[]
}

export type FlowPhase = {
  /** Skill qui mène la phase (peut basculer sur une alternative de `alts`). */
  skill: string
  /** Autres skills qui peuvent tenir cette phase. */
  alts: string[]
  /** Facultative : sautée sans souci si la mission passe outre. */
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
  /** Éléments confiés à un worker, tant que la phase les suit. */
  linked?: LinkedWork
  /**
   * La fermeture de la dernière session des éléments, gardée quand un nouvel envoi d'avant la demande
   * de découpage a pris sa place : à côté du lien, qu'une annulation réécrit.
   */
  linkedEarlier?: ClosedLink
  /** Les envois d'éléments faits dans la phase : le suivant prend le numéro d'après. */
  linkedSends?: number
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
   * Le ticket est une tâche de jugement (sa ligne « Jugement : oui (…) »), dit au découpage par la discussion
   * qui tient la mission, jamais par un worker : le mod de la session le traite en xhigh au moins pendant qu'il
   * est en cours. Seul `true` vaut « oui » (`isJudgmentTicket` de basics.ts).
   */
  judgment?: boolean
  /**
   * Id de la discussion qui a passé le ticket « en cours » ; effacé quand il en sort. Plusieurs
   * tickets peuvent être en cours à la fois (workers des groupes, autre discussion).
   */
  by?: string
  startedAt?: number
  finishedAt?: number
  /**
   * Affichage seulement, jamais enregistré : le groupe confié dont le worker relaie ce
   * statut. Fait ainsi, le ticket ne lève ses dépendances que dans ce groupe.
   */
  relayedFrom?: string
}

/**
 * Une tâche créée dans le tracker pendant la mission, hors du lot : constat de revue, anomalie
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
  /** Affichage seulement, jamais enregistré : le groupe confié dont le worker a relayé ce choix. */
  relayedFrom?: string
  /**
   * D'où vient le choix, en auto : une recommandation prise sans la personne, une validation sautée
   * (accord du cadrage, partage d'un tri, spec, découpage, plan, écritures Asana), un choix d'un worker ; absent
   * pour un choix d'avant l'auto ou sans origine dite.
   */
  origin?: DecisionOrigin
  /** Le choix ne tient plus (`withdrawn` de l'outil) : il reste à la mission, hors du fichier des choix et du panneau. */
  withdrawnAt?: number
  /** Pourquoi il a été retiré, et ce qui le remplace s'il y a lieu. */
  withdrawnWhy?: string
}

/** L'origine d'un choix fait sans la personne : « reco prise », « validation sautée », « choix de worker ». */
export type DecisionOrigin = 'recommendation' | 'skipped-validation' | 'linked-session'

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
  /** Fin constatée après coup (le spécialiste n'était plus actif) : sa durée n'est pas connue. */
  isEndUnseen?: boolean
}

/** La famille d'un outil, qui donne son glyphe sur la frise : ⌕ lecture, ✎ modification, ❯ commande, 🌐 web, ⇢ spécialiste. */
export type ToolFamily = 'read' | 'edit' | 'run' | 'web' | 'agent' | 'other'

/**
 * Les sortes de segments de la frise (Q3) : réflexion, rédaction, appel d'outil, et quatre attentes
 * (d'un spécialiste au premier plan, de la personne, d'une tâche de fond, de l'advisor consulté).
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
 * sur le manager seulement, message d'une autre session ✉, commit ⎇, tests ✓/✗.
 */
export type MarkKind = 'fail' | 'stop' | 'relay' | 'back' | 'compact' | 'msg' | 'commit' | 'test'

export type AgentMark = {
  k: MarkKind
  at: number
  /** Tests : au vert ou non. */
  ok?: boolean
  /** Relais : la clé de la piste du spécialiste parti ou revenu. */
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
 * Un spécialiste du registre de la session (onglet Agents) : sans limite de nombre, gardé après
 * l'archivage de la mission. Aucun texte de message ni rapport : la description, le prompt (Q8), des chiffres.
 */
export type RegistryAgent = AgentLane & {
  /** tool_use_id de l'appel Agent ; `agent:<id>` pour un agent lancé sans appel vu (Workflow). */
  key: string
  /** Id du spécialiste (`agent.spawn`, résultat de l'appel), que les fins rappellent. */
  agentId?: string
  /** Id d'agent du lanceur ; absent quand c'est le fil principal de la session. */
  parent?: string
  /** Le Workflow qui l'a lancé. */
  workflow?: string
  /** Sa description. */
  name: string
  /** `subagent_type` de l'appel. */
  subagentType?: string
  /** Le prompt donné au spécialiste (Q8), coupé au-delà de PROMPT_MAX caractères. */
  prompt?: string
  model?: string
  isBackground: boolean
  status: AgentStatus
  startedAt: number
  finishedAt?: number
  /** Fin constatée après coup (le spécialiste n'était plus actif) : sa durée n'est pas connue. */
  isEndUnseen?: boolean
  /** Réveils : un `agent.spawn` du même id après une fin, qui le rouvre (notification d'une de ses tâches). */
  wakes?: number
  /** La mission active (ou servie, pour un worker) à son lancement. */
  run?: string
  /** D'où vient l'entrée : le direct (hooks), ou le rattrapage par transcript. */
  source: 'live' | 'transcript'
  /** Son type (Q9), déduit à son lancement : il fixe sa couleur et son glyphe. */
  type?: AgentType
}

/** Les 9 types de spécialistes (Q9). */
export type AgentType = 'explore' | 'research' | 'implement' | 'review' | 'security' | 'merge' | 'plan' | 'transcripts' | 'other'

/** Les tokens d'un agent par sorte ; la réflexion n'est pas comptée à part par l'API (essai, point 4). */
export type AgentTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** Une période où une session a porté une mission (S31, S37) : de `from` à `to`. */
export type CarrySpan = { from: number; to: number }

/**
 * Un appel à l'advisor tel qu'un transcript le donne : l'id de l'appel (celui du bloc
 * `server_tool_use`), ses heures (la fin manque quand la réponse s'est coupée avant son résultat),
 * et, d'après l'entrée `advisor_message` de `usage.iterations`, son modèle et ses tokens (absents
 * quand l'entrée ne les a pas). Aucun contenu de sa réponse. `isVoid` : l'appel n'a jamais eu de
 * réponse (ni résultat ni entrée d'usage : posé après des outils de la session dans la même
 * réponse, relevé le 28/10/2026) ; il ne coûte rien et ne se montre pas.
 */
export type AdvisorFigures = { id: string; s: number; e?: number; model?: string; tokens?: AgentTokens; isVoid?: boolean }

/**
 * Un appel de la ligne advisor : ses chiffres, l'appelant (`main` pour le manager, sinon l'id
 * du spécialiste), et `isRead` une fois relu dans un transcript : sans tokens, il compte alors sans
 * prix, au lieu d'attendre un rattrapage qui n'en dira pas plus (sauf `isVoid` : sans réponse, il ne compte pas).
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
  /** La mission servie et le groupe, pour un worker (appel `delegate`). */
  run?: string
  group?: string
  agents: RegistryAgent[]
  /** La piste de la session elle-même (le manager) : ses tours, ses outils, ses attentes. */
  main?: AgentLane
  /** La ligne advisor : les appels du manager et de ses spécialistes ; absente sans appel. */
  advisor?: AdvisorLane
  /** Les workers que cette session a lancés (`start_session`, `claude --bg`), avec ou sans mission. */
  linked?: LinkedLaunch[]
  /**
   * Les ids des missions que cette session a portées (S28) : actives ici, ou un de leurs tickets passé
   * « en cours » par elle ; des ids seulement. Le rattrapage y rattache ses spécialistes manqués (Q-a).
   */
  carried?: string[]
  /**
   * Pour chaque mission de `carried`, les périodes où cette session la portait (S31, S37) : une
   * par portage, une nouvelle après plus de 10 min sans le porter, 20 au plus ; des dates, aucun
   * contenu. Le rattachement d'un spécialiste rattrapé s'y borne (R3). Un id sans dates (en-tête
   * d'avant) n'a pas de borne.
   */
  carriedAt?: Record<string, CarrySpan[]>
  /**
   * S40 : la date de la première écriture qui ne portait plus une mission datée, après sa dernière
   * période. Une période ne se rouvre que si une écriture faite entre-temps ne la portait pas ;
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
 * Un worker lancé par cette session : l'id que son lancement rend (`local_…` de
 * `start_session`, id court de `claude --bg`), son titre, quand.
 */
export type LinkedLaunch = { id: string; title?: string; at: number; via: 'bg' | 'desktop' }

/** Un morceau du registre d'une session, après le premier (R1) : des spécialistes et un bout de la piste du manager. */
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
  /** Skill de départ : il fixe la forme de la mission. */
  entry: string
  title: string
  /** Le titre vient de Claude (ou de la mission parent d'une suite), pas du nom du flux. */
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
  /** Tâches créées dans le tracker pendant la mission, hors du lot (« Trouvé en route »). */
  found?: FoundTask[]
  /** Choix faits par Claude sans la personne, à relire (« Décidé sans toi »). */
  decided?: SoloDecision[]
  /** Plan d'exécution : les tickets regroupés par contexte (liste complète, remplacée d'un bloc). */
  groups?: TicketGroup[]
  /**
   * Quand la personne a validé le compte rendu (« ✓ Valider le rapport ») : seule cette marque compte
   * pour la règle de coupe des choix d'une mission qui a été en auto (une clôture finit aussi la phase).
   */
  reportValidatedAt?: number
  /**
   * Quand `/code-review` a relu le lot entier (mission sans groupes, tickets tous faits). Une date à
   * plus d'une minute dans le futur se relit en négatif : une revue à refaire, sa date gardée.
   */
  reviewedAt?: number
  /** La revue de sécurité du lot entier, pour une mission sans groupes. */
  security?: SecurityCheck
  /**
   * L'ancien champ des spécialistes (12 au plus), d'avant le registre : relu une fois pour être
   * recopié dans le fichier de la mission, puis vidé (S1, S18, S21 : une liste vide, qu'une version
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
  /** Id de la discussion où la mission est active ; absent quand elle ne l'est nulle part. */
  owner?: string
  /**
   * La dernière prise de la mission par un processus de Claude Code (`boot`, l'id du processus ; `at`, sa date) :
   * posée quand la mission devient active dans une discussion (création, reprise par un skill ou par « ↻ Reprendre
   * ici », retour au chargement de la discussion relancée), effacée quand elle quitte l'état actif. La fusion garde la
   * plus récente, quelle que soit la copie gardée (`keepRun`) ; un autre processus de la même discussion, dont la
   * prise est plus récente, la retire à celui-ci (`mergeBoards`) : deux processus d'une même discussion ne la
   * tiennent jamais ensemble.
   */
  claim?: { boot: string; at: number }
  /**
   * Le passage de la mission au worker de diagnostic, ouvert par « 🐞 Bug · worker » (`at` : la date du clic, `from` :
   * la discussion qui l'ouvre) : la session de diagnostic la prend par le champ `resume` de l'outil, une fois, dans l'heure
   * (`by`, `byAt`), puis seule `from` la reprend par `resume`, tant que `by` la tient ; ce retour, toute autre reprise,
   * la mise en pause, la mise de côté et l'archivage le ferment (`closedAt`). Fusionné à part (`keepHandoff`).
   */
  handoff?: { at: number; from: string; by?: string; byAt?: number; closedAt?: number }
  /**
   * Id de la discussion où la mission est née, posé à sa création et jamais effacé (depuis la
   * 0.60.0) : seule elle prend son titre, et seul un skill qu'elle charge reprend la mission en pause
   * d'office. Absent d'une mission d'avant, qui ne compte pas : seul « ↻ Reprendre ici » la reprend.
   */
  bornIn?: string
  /**
   * Le premier lancement d'un worker par cette mission (groupe ou éléments d'une phase), jamais
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
  /**
   * Le mode auto de la mission (« ⚡ Auto »), propre à cette mission : absent, il n'a jamais été allumé.
   * Actif quand `onAt` est plus récent que `offAt` ; une date hors forme le dit éteint.
   */
  auto?: RunAuto
  /**
   * Les questions qui attendent la personne (`waiting` de l'outil), chacune avec ce qu'elle bloque.
   * Fusionnées une par une entre deux copies (union, retraits tracés) : une question ne disparaît que
   * par son retrait ou l'effacement de la mission (une copie en retard de plus de 100 retraits pourrait en
   * faire revenir une). 50 ouvertes au plus : au-delà, une nouvelle est refusée.
   */
  waiting?: WaitingQuestion[]
  /** La trace des questions retirées (`answered`), les 100 plus récentes : une copie en retard ne les fait pas revenir. */
  answered?: { id: string; at: number }[]
  /**
   * Les actions que le mode auto a envoyées (une phase, une vague, une revue), une marque par action, posée
   * avant l'envoi : une action marquée ne repart jamais. Fusionnées marque par marque entre deux copies,
   * jamais coupées : seuls « ↻ Renvoyer » (tracé dans `autoResent`) et l'effacement de la mission en retirent.
   */
  autoSent?: AutoMark[]
  /** La trace des marques retirées par « ↻ Renvoyer », les 100 plus récentes : une copie en retard ne les fait pas revenir. */
  autoResent?: { key: string; at: number }[]
  /**
   * Les retenues entre missions que la personne a forcées dans cette mission : chacune nomme la paire
   * (le groupe retenu ici, ou `*` pour le lot sans groupes ; la mission et le groupe attendus) et sa date.
   * Écrites par la seule discussion qui porte la mission, unies à la fusion, effacées avec elle.
   */
  forced?: ForcedHold[]
  /**
   * La trace des consignes reçues (`coordinate.instruct` du COO) : l'id de chaque entrée dont le message est entré
   * chez le Claude de la mission, noté juste après. Écrite par la seule discussion qui porte la mission, unie à la
   * fusion (rien ne se perd), bornée comme les marques « appliquée » (les plus récentes), effacée avec elle ; lue
   * par le COO pour montrer une consigne « non reçue ».
   */
  instructed?: string[]
  /**
   * La mission attend la personne (signal « t'attend ») : depuis quand, et pour quoi (une question posée, une
   * validation, l'étape suivante proposée, le rapport). Écrit par la seule discussion qui la porte, à la fin
   * d'un tour, à la pause de l'auto hors d'un tour, ou le temps d'une question à boutons, jamais en auto
   * actif ; effacé au tour suivant, à l'allumage de l'auto, à la reprise, à la pause, à la clôture, à
   * l'archivage, et avec la mission ; il suit le reste de la mission à la fusion.
   */
  waitsUser?: WaitsUser
  /**
   * La carte de lancement du COO dont cette mission est née : l'id de l'enregistrement consommé, la
   * carte, la date du clic, le dossier `travail/<folder>/`, le départ et le mode. Posé une fois par la
   * discussion de la mission à sa première consommation, jamais changé (la fusion garde le premier
   * posé), effacé avec la mission. Un id qu'une mission porte déjà ne se consomme plus.
   */
  launch?: RunLaunch
}

/** Le rattachement d'une mission à la carte de lancement du COO dont elle est née. */
export type RunLaunch = {
  id: string
  card: string
  at: number
  folder: string
  start: string
  mode: 'auto' | 'manual'
  lostAt?: number
  /** Une rétro lancée par le COO : l'id de la mission close qu'elle étudie, posé une fois au rattachement, jamais changé. */
  of?: string
}

/** Ce que la mission attend de la personne, et depuis quand. */
export type WaitsUser = { since: number; kind: 'question' | 'validation' | 'step' | 'report' }

/** Un forçage d'une retenue entre missions : le groupe retenu (ou `*`), le groupe attendu d'une autre mission. */
export type ForcedHold = { held: string; run: string; group: string; at: number; on?: 'plan' }

/**
 * La marque d'une action envoyée par le mode auto : sa clé stable, quand elle est partie (« envoyée »),
 * quand son tour a commencé (« démarrée »), et quand elle est devenue la question « envoi resté sans suite ».
 */
export type AutoMark = {
  key: string
  at: number
  startedAt?: number
  staleAt?: number
  /** Ce qui est parti, en mots : la commande, ou les groupes confiés. */
  what?: string
  /** Ce que bloque sa question « envoi resté sans suite » : la phase envoyée, ou le groupe. */
  blocks?: WaitTarget
}

/** Ce qu'une question bloque : une phase (son skill), un groupe ou un ticket de la mission. */
export type WaitTarget = { kind: 'phase' | 'group' | 'ticket'; id: string }

/** Une question qui attend la personne, déclarée par Claude, retirée par lui une fois répondue. */
export type WaitingQuestion = {
  id: string
  blocks: WaitTarget
  /** Le texte de la question, pour le tableau de bord seulement (jamais dans une notification). */
  text: string
  /** Quand elle a été posée : une trace de retrait plus récente l'efface à la fusion. */
  at: number
  /**
   * Un geste qui revient à la personne et qu'un bouton du COO peut faire : autoriser une dépense
   * (`spend`) ou une action externe (`external`), laisser une faille sans correctif (`flaw`, avec le
   * total des failles laissées, `dismissed`). Il fait partie du texte vu : son empreinte le compte.
   */
  gesture?: GestureKind
  dismissed?: number
}

/** Les gestes d'une question bloquante qu'un bouton du COO peut faire. */
export type GestureKind = 'spend' | 'external' | 'flaw'

/**
 * L'état auto d'une mission : deux dates fusionnées chacune à la plus récente des deux copies,
 * jamais par la copie la plus récente de la mission, pour qu'une copie en retard ne rallume rien.
 */
export type RunAuto = {
  /** « Allumé à » : posé seulement par un clic de la personne : « Confirmer » dans la mission, ou « Lancer en auto » chez le COO (la discussion lancée le pose en consommant le lancement). */
  onAt?: number
  /** « Allumé par » : l'id de la discussion du clic (lu après un `/clear`, qui en donne un nouveau). */
  onBy?: string
  /** « Éteint à » : la coupure, la mise de côté, la clôture, l'archivage, la fin de la discussion porteuse. */
  offAt?: number
  /** La raison de l'arrêt, avec `offAt`. */
  offWhy?: string
  /**
   * Avec `onAt` : l'allumage est la reprise d'une pause « plus rien ne peut avancer sans toi », d'elle-même, une fois
   * ses questions répondues ; un affichage seulement. Fusionné avec « allumé à », retiré par un
   * nouvel allumage (`switchOnAuto`), borné à la lecture (`readAuto`).
   */
  onWhy?: 'resumed'
}

/** Trace d'une mission supprimée, pour qu'une autre discussion ne la fasse pas revenir. */
export type Tombstone = { id: string; at: number }

export type Board = {
  v: 1
  /** Racine du projet (clé du stockage). */
  root: string
  /** Nom court du projet. */
  name: string
  runs: Run[]
  /** Mission active DE CETTE DISCUSSION : jamais repris du stockage, qui est partagé. */
  activeId: string | null
  /** Id de la discussion qui tient cette copie du board. */
  session?: string
  /** Id du processus de Claude Code qui tient cette copie (posé au chargement, `detachOnLoad`) : signe ses prises (`Run.claim`). */
  boot?: string
  /**
   * Cette discussion travaille pour une autre (worker d'un groupe) : propre à la
   * discussion, jamais repris du stockage. Ses skills et ses rapports ne touchent aucune mission.
   * `title` : le titre de la mission quand il n'est pas dans ce board (session dans un worktree,
   * qui a son propre fichier), lu dans celui du dépôt principal.
   */
  delegate?: {
    run: string
    at: number
    title?: string
    group?: string
    /**
     * Le manager tel que le brief le désigne, « <nom> [ref] » : son nom peut changer,
     * pas sa référence. Rappelé à chaque réponse de l'outil, pour que la session puisse la joindre.
     */
    main?: string
    /** Quand `main` a été connu : au `delegate`, puis à chaque nouvelle référence lue à côté du relais. */
    mainAt?: number
    /**
     * La marque « worker Fable » : posée seulement par le premier appel `delegate` de la session qui porte
     * `"model": "fable"` (son brief le dit), gardée telle quelle par un appel suivant pour la même mission,
     * jamais posée sur une délégation neuve d'une autre mission ; relue du stockage, toute autre valeur est
     * ignorée. Le mod en tire le modèle de chaque requête du fil principal ; absente, la session reste sur Opus.
     */
    model?: 'fable'
  }
  /** Missions supprimées récemment (toutes discussions confondues). */
  deleted?: Tombstone[]
  /**
   * Le siège du COO du projet sur ce poste (`hooks/seat.ts`) : la discussion qui le tient, fusionné
   * par `mergeBoards`, la prise la plus récente l'emportant. Écrit seulement par la discussion qui le
   * prend, le rafraîchit ou le libère.
   */
  coo?: CooSeat
  /**
   * L'id sous lequel cette discussion a demandé le siège du COO (`/flow-board:coo`, « ◆ COO ») : propre
   * à la discussion, jamais repris du stockage. Sert à montrer « ↻ Reprendre ici » quand le siège est tenu
   * ailleurs ou libéré, et à refuser une mission tant que le siège est à cet id.
   */
  cooHere?: string
}

/**
 * Une prise du siège du COO : qui (`by`, l'id de la discussion), quand (`at`), vue vivante pour la
 * dernière fois (`seenAt`), et quand son titulaire l'a libérée (`releasedAt`).
 */
export type CooSeat = { by: string; at: number; seenAt: number; releasedAt?: number }

/**
 * L'avancement qu'un worker relaie au manager, hors de la mission (qui n'a
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
   * manager, renommé ou redémarré, peut ne jamais recevoir le message.
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
  reviews?: { count: number; standards: number; spec: number; fixed: number; bugs?: number; form?: number }
  /**
   * L'empreinte de la dernière revue comptée (`reviewPrint` de relay.ts) : ses comptes tels qu'envoyés, le ticket
   * relu qu'elle nomme et le statut de chaque ticket au moment de l'envoi. La même revue renvoyée sans changement de statut d'un ticket ni autre ticket relu ne se recompte pas ;
   * illisible, elle vaut absente (la revue est comptée). Remplacée à chaque revue comptée ; effacée par un statut de
   * ticket qui change, une revue lancée (`/code-review`), et avec l'entrée.
   */
  reviewPrint?: string
  /** La revue de sécurité que la session a envoyée (`security`) : reprise au retour du groupe. */
  security?: { advised?: boolean; why?: string; findings?: number; fixed?: number; dismissed?: number; at: number }
  /** Le dernier signal reçu : un ticket, un commit, des tests, une note, une revue, le compte rendu. */
  last?: { kind: 'ticket' | 'commit' | 'test' | 'note' | 'review' | 'decided' | 'report'; text: string; at: number; ticket?: string }
  startedAt: number
  at: number
  /** La session s'est terminée (fin de discussion, pas un /clear). */
  endedAt?: number
}

/**
 * Le relais d'une mission : une entrée par worker (id de la discussion). Tel que la discussion
 * principale le lit : l'ancien fichier commun (`<parcours>.json`, écrit par les versions d'avant, plus
 * jamais réécrit) et le fichier de chaque session (`RelayEntryFile`), réunis.
 */
export type Relay = { v: 1; run: string; sessions: Record<string, RelayEntry> }

/**
 * Le fichier d'un worker dans le relais (`<parcours>.<session>.entry.json`, ou la clé
 * `relay:<parcours>:<session>` du store) : son entrée seule, écrite par lui seul (un fichier par worker) ;
 * aucune écriture ne touche plus l'entrée d'une autre session.
 */
export type RelayEntryFile = { v: 1; run: string; session: string; entry: RelayEntry }

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
  /**
   * Chaque plugin ou paquet changé face à la branche distante (suivie, sinon origin/main) a une
   * nouvelle version dans son manifeste : la livraison ne repropose pas /project:version. Null sans
   * manifeste de version dans le dépôt, ou tant que ce n'est pas mesuré.
   */
  isVersionSet?: boolean | null
  /**
   * Les parties versionnées (plugins, paquets) changées face à la même branche distante : leur
   * version, et soit la version d'où elles partent quand elle est déjà posée, soit les commits faits
   * depuis leur dernier changement de version. L'aperçu de la carte « Ensuite » en est tiré ; null
   * ou absent tant que ce n'est pas mesuré.
   */
  versionUnits?: VersionUnit[] | null
}

/** Un commit compté par l'aperçu de version : son titre, et s'il se dit cassant (`BREAKING CHANGE` dans son corps). */
export type VersionCommit = { subject: string; isBreaking: boolean }

/** Une partie versionnée changée face au distant : son nom, sa version, et d'où elle part ou ce qui l'attend. */
export type VersionUnit = { name: string; version: string; from?: string; commits?: VersionCommit[] }

export type Tab = 'flow' | 'agents' | 'activity' | 'history' | 'commands' | 'coord'

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
  /** L'historique montre aussi les missions archivées. */
  showArchived?: boolean
  /** « Trouvé en route » réduit à son titre, tâches qui attendent la personne comprises. */
  hideFound?: boolean
  /** Tickets choisis dans le panneau, dans l'ordre de sélection (cette discussion seulement). */
  selection: string[]
  /** Éléments de la phase (pistes d'une rétro) choisis pour leur découpage en tickets. */
  itemSelection?: string[]
  /** Mission archivée dont la suppression attend sa confirmation. */
  confirmDrop?: string
  /** Mission dont l'allumage du mode auto attend son second clic (« Confirmer »). */
  confirmAuto?: string
  /** « ↻ Reprendre ici » d'une mission d'une autre discussion, en attente de « Confirmer (secours) » : son id. */
  confirmResume?: string
  /**
   * Frise de l'onglet Agents : la fenêtre de vue (zoom et déplacement), en temps réel ; absente,
   * tout. Propre à la discussion, jamais enregistrée, remise à « tout » à la réouverture.
   */
  agentsWindow?: AgentsWindow
  /** Onglet Agents : la piste dont la carte de détail est ouverte (clé d'appel, ou `main`). */
  agentCard?: string
  /** Onglet Agents : le worker dont la frise est montrée (sa clé) ; absente, le manager. */
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
      /** L'avancement relayé par les workers de la mission active (manager). */
      relay: Relay | null
      /** Le registre des spécialistes de cette session (onglet Agents). */
      agents: SessionRegistry | null
      /** Les clés des spécialistes que ce processus a vus partir (S9). */
      agentsOwn: string[]
      /** Une écriture du registre a été refusée (S11) ; `'lost'` : un changement n'a pas pu s'appliquer à l'état (R2). */
      agentsAlert: boolean | 'lost'
      /** Les workers vus à la dernière relecture (onglet Agents). */
      agentsLinked: { key: string; session?: string; title: string; how: 'run' | 'relay' | 'id' | 'job' | 'title' | 'none'; state: 'working' | 'returned' | 'failed' | 'closed'; launchedAt?: number; returnedAt?: number }[]
      /** Le sélecteur d'historique de l'onglet Agents. */
      agentsHistory: { key: string; kind: 'now' | 'run' | 'session'; title: string; at?: number; isArchived?: boolean; agents?: number }[]
      /**
       * L'id de ce processus pour la date du second clic du mode auto, posé au premier chargement du mod :
       * gardé après /reload-plugins, neuf après un redémarrage, où une date gardée avant ne vaut plus.
       */
      autoBoot: string
      /** Les cartes de lancement que le Claude du COO a proposées dans cette discussion (`hooks/launch.ts`). */
      cooCards: unknown[]
      /** Les prix des modèles tirés de ccusage (Q15), relevés au plus une fois par jour. */
      agentPrices: { at: number; prices: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> } | null
    }
  }
}
