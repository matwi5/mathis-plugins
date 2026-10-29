// Contrat de l'état de stats-board : ce que l'hôte garde pour la session (`$.state`). Le
// dernier relevé (`Snapshot`) est aussi gardé dans `$.store`, d'une session à l'autre.

/** Une ligne de consommation : un jour, un projet, un modèle (sommes de ccusage). */
export type UsageRow = {
  /** Jour local, AAAA-MM-JJ. */
  date: string
  /** Dossier du projet tel que Claude Code l'encode (`C--Users-moi-projet`). */
  project: string
  /** Le poste qui l'a relevée : son nom réglé (Portable, Mac, Serveur…), ou « Ce poste » sans nom. */
  machine: string
  /** Modèle tel que ccusage le nomme (`claude-opus-5-5`). */
  model: string
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  /** Coût équivalent API, en dollars. */
  cost: number
  /**
   * Publiés depuis la 0.10.0 : durée API, temps de génération, appels relevés et leurs tokens de
   * sortie (pour la vitesse), durées arrondies à la minute ; absents sans mesure.
   */
  apiMs?: number
  genMs?: number
  calls?: number
  genOutput?: number
}

/** Une conversation Claude Code d'un poste (`ccusage claude session`). */
export type SessionRow = {
  id: string
  /** Le poste où elle a eu lieu. */
  machine: string
  project: string
  /** Sous-agent de workflow : la discussion qui l'a lancé (son dossier est `<projet>\<parent>\subagents\…`). */
  parent: string | null
  /** Première et dernière activité, en ms ; publiées à la minute depuis la 0.10.0 (`publishedOf`). */
  first: number
  last: number
  cost: number
  tokens: number
  output: number
  models: string[]
  /** Publiés depuis la 0.10.0 : temps actif, durée API (arrondis à la minute) et nombre de requêtes de la session ; absents sans mesure. */
  activeMs?: number
  apiMs?: number
  requests?: number
}

/** Un bloc de facturation de 5 h (`ccusage claude blocks`), sans les creux. */
export type BlockRow = {
  start: number
  end: number
  /** Dernière activité du bloc, en ms. */
  lastAt: number
  isActive: boolean
  cost: number
  tokens: number
  models: string[]
  /** Bloc en cours : rythme et projection de ccusage ; null ailleurs. */
  costPerHour: number | null
  projectedCost: number | null
  remainingMinutes: number | null
}

export type ActivityDay = { date: string; messages: number; sessions: number; tools: number }

/** Le cache de /stats de Claude Code (`stats-cache.json`), pour ce poste seulement. */
export type Activity = {
  /** Dernier jour compté : le cache a en général un jour de retard. */
  through: string | null
  days: ActivityDay[]
  /** Sessions commencées par heure locale, de 0 à 23. */
  hours: number[]
  sessions: number
  messages: number
  longest: { ms: number; messages: number; at: string } | null
  since: string | null
}

/**
 * Le nom lisible d'un projet et son dossier, lus dans les transcriptions de Claude Code ; `label`, son nom
 * d'affichage choisi dans `names.json` du dépôt partagé (jamais publié : `name` sert au rapprochement des postes).
 */
export type ProjectInfo = { name: string; path: string | null; label?: string }

export type Snapshot = {
  /** Format du relevé : un relevé gardé d'un autre format est écarté et refait. */
  schema: number
  /** Fin du dernier relevé, en ms. */
  fetchedAt: number
  /** Décalage horaire local, en minutes (comme `Date#getTimezoneOffset`). */
  tzOffset: number
  rows: UsageRow[]
  sessions: SessionRow[]
  blocks: BlockRow[]
  activity: Activity | null
  projects: Record<string, ProjectInfo>
  /** Modèles sans prix connu de ccusage : comptés 0 $. */
  unpriced: string[]
  /** Prix embarqués de ccusage : le barème en ligne n'a pas pu être lu. */
  isOffline: boolean
  /** Le nom de ce poste (`claude-usage/.machine`), ou « Ce poste » sans nom réglé. */
  machine: string
  /** Les postes présents dans le relevé, celui-ci d'abord. */
  machines: string[]
  /** Les postes qui n'ont publié aucune session (l'ancien serveur : des totaux par jour seulement). */
  sessionless: string[]
  /** Version de ccusage qui a fait le relevé. */
  version: string | null
  /** Jours gardés par le mod alors que Claude Code a effacé leurs journaux. */
  keptDays: number
  warnings: string[]
  /** Les durées de ce poste, tirées des fichiers de relevé des requêtes (depuis la 0.10.0). */
  durations: Durations
  /** Les durées publiées par les autres postes ; absent d'un relevé d'avant. */
  peers?: PeerDurations
}

/** Temps des appels au modèle d'un jour, d'un projet et d'un modèle (requêtes envoyées ce jour-là). */
export type ApiRow = {
  date: string
  project: string
  machine: string
  model: string
  /** Durée API, en ms. */
  apiMs: number
  /** Temps de génération, en ms. */
  genMs: number
  /** Tokens de sortie, pour la vitesse. */
  output: number
  calls: number
  /** Vitesse de chaque appel, en classes de 10 tokens/s (« 40 » : de 40 à 50) : leur nombre, pour la médiane ; absent d'un relevé d'avant. */
  speeds?: Record<string, number>
}

/**
 * Temps actif d'un jour et d'un projet (worktrees réunis à leur dépôt, brouillons ensemble), sans
 * double compte ; `cumulMs`, depuis la 0.11.0, le temps cumulé (la somme des temps actifs de ses
 * discussions), absent d'une ligne d'avant.
 */
export type ActiveRow = { date: string; project: string; machine: string; activeMs: number; requests: number; cumulMs?: number }

/**
 * Temps actif d'un jour par heure locale (24 valeurs, en ms), toutes discussions confondues, sans
 * double compte ; `cumul`, depuis la 0.11.0, le temps cumulé de chaque heure, absent d'une ligne d'avant.
 */
export type HourRow = { date: string; machine: string; hours: number[]; cumul?: number[] }

/** Une discussion un jour donné : son temps actif, sa durée API et ses requêtes. */
export type SessionDayRow = { date: string; session: string; project: string; machine: string; activeMs: number; apiMs: number; requests: number }

/** Les totaux de durée d'un poste, et ce qu'il faut pour ne relire que les fichiers de relevé modifiés. */
export type Durations = {
  /** Premier jour suivi (une requête relevée), AAAA-MM-JJ ; null avant toute requête. */
  since: string | null
  /** Les fichiers de relevé déjà lus : leur date de modification et les jours qu'ils touchent. */
  files: Record<string, { mtimeMs: number; days: string[] }>
  api: ApiRow[]
  active: ActiveRow[]
  hours: HourRow[]
  sessions: SessionDayRow[]
  /** La durée réelle de chaque requête envoyée ce jour-là, en secondes, pour les médianes (ce poste seulement) ; absent d'un relevé d'avant. */
  times?: TimesRow[]
}

/** Les durées réelles des requêtes d'un jour et d'un projet affiché, en secondes. */
export type TimesRow = { date: string; project: string; machine: string; seconds: number[] }

/**
 * Le fichier qu'un poste publie dans le dépôt partagé `claude-usage` (`machines/<nom>.json`) :
 * ses lignes, ses sessions et les projets qu'elles citent. Les autres postes le lisent.
 */
export type Published = {
  schema: number
  machine: string
  /** Dernière publication dont les données ont changé, en ms. */
  updatedAt: number
  tzOffset: number
  rows: UsageRow[]
  sessions: SessionRow[]
  projects: Record<string, ProjectInfo>
  /**
   * Depuis la 0.10.0, au même format 1 (un poste pas encore mis à jour lit le reste) : temps actif et
   * requêtes par jour et projet. Jamais une requête, son heure ni un texte ; durées à la minute.
   */
  active?: { date: string; project: string; activeMs: number; requests: number; cumulMs?: number }[]
  /** Depuis la 0.10.0 : temps actif par jour et heure locale, à la minute ; `cumul` (temps cumulé) depuis la 0.11.0. */
  hours?: { date: string; hours: number[]; cumul?: number[] }[]
  /** Depuis la 0.10.0 : les durées d'appels d'un jour, projet et modèle que ccusage n'a pas encore dans `rows`. */
  apiOnly?: { date: string; project: string; model: string; apiMs: number; genMs: number; calls: number; genOutput: number }[]
}

/** Les durées des autres postes, lues dans leurs fichiers publiés (projets rapprochés de ceux de ce poste). */
export type PeerDurations = Pick<Durations, 'api' | 'active' | 'hours' | 'sessions'> & {
  /** Premier jour suivi de chaque poste qui publie des durées. */
  sinceBy: Record<string, string>
}

export type Tab = 'discussion' | 'day' | 'overview' | 'trend' | 'models' | 'projects' | 'sessions' | 'rhythm'
export type Period = 'all' | '90' | '30' | '7'
/** Le filtre de poste : `all`, ou le nom d'un poste. */
export type Machine = 'all' | (string & {})
export type Metric = 'cost' | 'tokens'
export type Grain = 'day' | 'week' | 'month'
export type SessionSort = 'cost' | 'recent' | 'long' | 'active'

/** Listes du panneau dépliées au-delà de leur plafond (« ▸ tout voir (N) »). */
export type Expanded = { models: boolean; projects: boolean; sessions: boolean; days: boolean }

/** Les choix de l'affichage : onglet, période, filtres, mesure. */
export type Ui = {
  tab: Tab
  period: Period
  machine: Machine
  metric: Metric
  grain: Grain
  /** Filtre de projet (clé ccusage, ou `@brouillons`) ; null pour tous. */
  project: string | null
  /** Filtre de modèle ; null pour tous. */
  model: string | null
  sessionSort: SessionSort
  /** Évolution : la durée (temps actif) à la place du coût ou des tokens ; absent d'un état d'avant la 0.10.0. */
  isTrendDuration?: boolean
  /** Évolution en durée et Rythme : le temps actif ou le temps cumulé ; absent d'un état d'avant la 0.11.0 (le temps actif). */
  durationKind?: 'active' | 'cumul'
  /** Tri de la carte « Requêtes » de l'onglet Discussion ; absent d'un état d'avant la 0.10.0. */
  requestSort?: RequestSort
  expanded: Expanded
  /** Jour choisi dans l'onglet Journée (AAAA-MM-JJ) ; null pour celui du relevé. */
  day: string | null
}

export type Meta = {
  /** Étape du relevé en cours ; null au repos. */
  loading: string | null
  error: string | null
  /** Début du relevé en cours, en ms. */
  startedAt: number | null
}

export type Notice = { text: string; tone: 'ok' | 'error' | 'info' } | null

/** Un appel API de la discussion (`ccusage claude session --id`) : heure (ms), modèle, entrée, sortie, cache écrit, cache lu. */
export type DiscussionEntry = [at: number, model: string, input: number, output: number, cacheWrite: number, cacheRead: number]

/** Les tokens d'un tour fini de la conversation principale, d'après le moteur (`turn.complete`). */
export type TurnTokens = { at: number; tokens: number }

/** La discussion ouverte : chiffres du moteur en direct, détail de ccusage à la demande. */
export type Discussion = {
  /** Identifiant de la session (le `sessionId` de ccusage). */
  id: string | null
  /** D'après le moteur (`$.session.usage()`), relu à chaque tour ; null avant la première lecture. */
  live: {
    /** Coût en dollars, comme `/cost`. */
    cost: number | null
    contextPercent: number | null
    contextTokens: number | null
    window: number | null
    turns: number
    model: string | null
    startedAt: number | null
    at: number
  } | null
  /** Le détail de ccusage (`claude session --id`), au dernier ↻ ; null avant. */
  detail: { fetchedAt: number; cost: number; tokens: number; entries: DiscussionEntry[] } | null
  /** Tours finis depuis le chargement du mod, pour ajouter aux tokens d'un relevé plus ancien qu'eux. */
  turns: TurnTokens[]
  loading: boolean
  error: string | null
}

/** Les appels d'un modèle dans une requête : tokens, durées et coût. */
export type CallStats = {
  calls: number
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  /** Durée API : de l'envoi de chaque appel au dernier morceau de sa réponse, en ms. */
  apiMs: number
  /** Temps de génération : du premier morceau de chaque réponse au dernier, en ms. */
  genMs: number
  /** Coût au tarif public du modèle, en dollars ; estimé au prorata pour un modèle inconnu. */
  cost: number
  /** Modèle absent de la table de tarifs : coût estimé au prorata du coût de la session (« ≈ »). */
  isEstimated: boolean
  /** Vitesse de chaque appel, en classes de 10 tokens/s (« 40 » : de 40 à 50) : leur nombre ; absent d'un relevé d'avant. */
  speeds?: Record<string, number>
}

/** Une requête : la réponse entière à un message de l'utilisateur (`GLOSSARY.md`). Aucun texte de message. */
export type RequestRecord = {
  /** Son rang dans le relevé, à partir de 1. */
  id: number
  /** Heure d'envoi du message, en ms. */
  sentAt: number
  /** Fin du dernier tour du fil principal rattaché, en ms ; null avant la fin du premier. */
  endedAt: number | null
  /** Durée réelle, de l'envoi à `endedAt`, en ms. */
  realMs: number
  /** Encore en cours : le fil principal n'a pas fini pour elle (durées provisoires). */
  isOpen: boolean
  /** Ses tâches de fond encore en cours (sous-agents, shells, Monitor) ; elles n'allongent sa durée réelle que si elles relancent un tour. */
  tasks: number
  /** Durée API : la somme des durées de ses appels, en ms. */
  apiMs: number
  /** Nombre de sous-agents rattachés, sous-agents de sous-agents compris. */
  agents: number
  /** Ses appels, par modèle (l'identifiant que l'API donne). */
  models: Record<string, CallStats>
  /**
   * Depuis la 0.11.0 : les moments où elle attendait la réponse de l'utilisateur (question à boutons,
   * plan à valider), [début, fin] en ms, la fin null tant qu'il n'a pas répondu ; exclus de son temps
   * actif. Absent sans attente.
   */
  waits?: [number, number | null][]
  /** Depuis la 0.11.0 : les appels de ses sous-agents pendant ses attentes, [début, fin] en ms, fusionnés ; eux restent actifs. */
  busy?: [number, number][]
}

/** Le relevé d'une ouverture de session, écrit dans `~/.claude/stats-board/requetes/<session>_<ouverture>.json`. */
export type RequestLog = {
  /** Format du fichier. */
  schema: number
  session: string
  /** Heure d'ouverture du relevé (premier message de la session dans ce processus), en ms. */
  openedAt: number
  /** Clé ccusage du dossier de la session. */
  project: string | null
  requests: RequestRecord[]
  /** Les appels hors de toute requête, par modèle. */
  outside: Record<string, CallStats>
}

/** Le suivi des requêtes de la discussion ouverte, gardé par l'hôte. */
export type Tracker = {
  log: RequestLog | null
  /** La dernière requête ouverte. */
  current: number | null
  /** Les tours du fil principal en cours, et la requête de chacun (0 : hors requête). */
  turns: Record<string, number>
  /** Le tour du fil principal en cours, s'il y en a un. */
  active?: string
  /** Les agents de la session et leur requête ; `isSpawned` : rattaché par son premier `agent.spawn`. */
  agents?: Record<string, { request: number; isSpawned: boolean }>
  /** Les tâches de fond vues dans une liste `background_tasks`, et leur requête. */
  tasks?: Record<string, number>
  /** Les tâches de fond encore en cours, d'après la dernière liste. */
  running?: string[]
  /** Les requêtes finies par une interruption ou une erreur : seules à se rouvrir pour une tâche inconnue. */
  interrupted?: number[]
}

export type RequestSort = 'cost' | 'real' | 'api'

declare module 'claude-code' {
  interface PluginState {
    'stats-board': {
      snapshot: Snapshot | null
      ui: Ui
      meta: Meta
      notice: Notice
      /** Bandeau au-dessus du prompt masqué (`x` ou `/ccstats hide`), le temps de la session. */
      isBandHidden: boolean
      /** Clé ccusage du dossier de la session (« Ce projet »). */
      here: string | null
      discussion: Discussion
      /** Les requêtes de la discussion ouverte (sans texte de message). */
      requests: Tracker
    }
  }
}
