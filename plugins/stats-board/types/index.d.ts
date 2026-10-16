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
}

/** Une conversation Claude Code d'un poste (`ccusage claude session`). */
export type SessionRow = {
  id: string
  /** Le poste où elle a eu lieu. */
  machine: string
  project: string
  /** Sous-agent de workflow : la discussion qui l'a lancé (son dossier est `<projet>\<parent>\subagents\…`). */
  parent: string | null
  /** Première et dernière activité, en ms. */
  first: number
  last: number
  cost: number
  tokens: number
  output: number
  models: string[]
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

/** Le nom lisible d'un projet et son dossier, lus dans les transcriptions de Claude Code. */
export type ProjectInfo = { name: string; path: string | null }

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
}

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
}

export type Tab = 'discussion' | 'day' | 'overview' | 'trend' | 'models' | 'projects' | 'sessions' | 'rhythm'
export type Period = 'all' | '90' | '30' | '7'
/** Le filtre de poste : `all`, ou le nom d'un poste. */
export type Machine = 'all' | (string & {})
export type Metric = 'cost' | 'tokens'
export type Grain = 'day' | 'week' | 'month'
export type SessionSort = 'cost' | 'recent' | 'long'

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
    }
  }
}
