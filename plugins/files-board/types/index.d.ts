// Contrat du mod files-board : l'état de session (`$.state`) et les données qui circulent
// entre le module des hooks (register.tsx, qui seul parle au moteur) et la région
// interactive (browser.tsx, qui dessine et lit le clavier et la souris).

export type Os = 'windows' | 'mac' | 'linux'

/** Les options du menu ⋮, gardées d'une session à l'autre (`$.store`). */
export type Options = {
  /** Afficher l'arborescence de fichiers (Ctrl+Maj+Y). */
  showTree: boolean
  /** Onglets d'aperçu : un fichier ouvert d'un simple clic remplace l'aperçu précédent. */
  previewTabs: boolean
  /** Enregistrement automatique, une seconde après la dernière frappe. */
  autoSave: boolean
  /** La touche Tab indente ; sinon elle passe d'une zone à l'autre. */
  tabIndents: boolean
  /** Retour à la ligne automatique ; sinon défilement horizontal. */
  wordWrap: boolean
  /** Repères d'indentation (│) dans l'indentation. */
  indentGuides: boolean
  /** Afficher les espaces (·) et les tabulations (→). */
  showWhitespace: boolean
  /** Défilement au-delà de la fin : la dernière ligne peut monter en haut de la zone. */
  scrollBeyondLastLine: boolean
  /** Taille de tabulation : 2, 4 ou 8. */
  tabSize: number
  /** Largeur de l'arborescence, en colonnes ; 0 pour la largeur automatique. */
  sidebarWidth: number
}
export type OptionKey = keyof Options

export type EntryKind = 'file' | 'dir'
export type Entry = { name: string; kind: EntryKind }
/** Le contenu d'un dossier tel que lu, plafonné ; `hidden` compte les entrées non gardées. */
export type Listing = { entries: Entry[]; hidden: number; error: string | null }

/** Un onglet ouvert ; `path` est relatif à la racine, séparé par `/`. */
export type Tab = { path: string; isPreview: boolean }

/**
 * `ready` : texte complet, modifiable. `large` : trop gros pour passer à la région, lecture
 * seule par fenêtres de lignes. `binary`, `error` : rien à afficher.
 */
export type DocState = 'loading' | 'ready' | 'large' | 'binary' | 'error'

export type Doc = {
  path: string
  state: DocState
  error: string | null
  /** Le texte du disque, fins de ligne ramenées à `\n` ; vide hors de `ready`. */
  text: string
  /** Modifications non enregistrées, gardées si le panneau se ferme. */
  draft: string | null
  eol: '\n' | '\r\n'
  /** Monte à chaque relecture ou enregistrement. */
  rev: number
  /**
   * `disk`, `claude` (relu parce que Claude venait de modifier le fichier), ou
   * `save:<instance>:<seq>` après un enregistrement venu de la région.
   */
  origin: string
  /** Le fichier a changé sur le disque alors qu'un brouillon existe. */
  changedOnDisk: boolean
  lineCount: number
  /** Fichier volumineux : la fenêtre de lignes envoyée, à partir de la ligne `from` (0). */
  window: { from: number; text: string } | null
  size: number
  mtimeMs: number
}

/** Recherche de fichiers : chemins relatifs, ceux des dossiers finis par `/`. */
export type Find = { query: string; results: string[]; total: number; isLoading: boolean }

/** Dernière opération de la région traitée, par instance de la région. */
export type Seen = { inst: string; seq: number }

/** Dernier coup de molette sur le panneau, relayé à la région (`n` monte à chaque coup). */
export type Wheel = { n: number; by: number; column: number; row: number }

/** Une application de « Ouvrir dans ». */
export type App = { id: string; label: string }

export type Platform = { os: Os; sep: '\\' | '/'; apps: App[]; isReady: boolean }

/** Demande à la région de montrer `path` dans l'arborescence (`n` monte à chaque demande). */
export type Reveal = { path: string; n: number }

/** Ce que la région reçoit du document actif. */
export type DocView = {
  path: string
  state: DocState
  error: string | null
  /** Le brouillon s'il existe, sinon le texte du disque. */
  text: string
  isDirty: boolean
  rev: number
  origin: string
  changedOnDisk: boolean
  lineCount: number
  window: { from: number; text: string } | null
  size: number
  eol: '\n' | '\r\n'
}

/** Les données de la région (props du `Client`). */
export type View = {
  root: string
  rootName: string
  sep: '\\' | '/'
  os: Os
  options: Options
  /** Lignes visibles de l'arborescence, codées par `encodeRow` (model.ts). */
  rows: string[]
  /** Lignes non envoyées, au-delà du plafond. */
  rowsHidden: number
  find: Find
  tabs: Tab[]
  active: string | null
  /** Onglets qui ont un brouillon. */
  dirty: string[]
  /** Fichiers que Claude a modifiés (Edit, Write, NotebookEdit) depuis le dernier message, relatifs à la racine. */
  touched: string[]
  doc: DocView | null
  ack: Seen
  wheel: Wheel
  reveal: Reveal
  apps: App[]
  isMaximized: boolean
  isFullscreen: boolean
  /** Taille du corps du panneau, en repli tant que la région n'est pas mesurée. */
  columns: number
  lines: number
}

/** Ce que la région demande au module des hooks. */
export type Op =
  | { k: 'toggle'; path: string }
  | { k: 'expand'; paths: string[] }
  | { k: 'open'; path: string; preview: boolean }
  | { k: 'activate'; path: string }
  | { k: 'pin'; path: string }
  | { k: 'close'; path: string }
  | { k: 'save'; path: string; text: string }
  | { k: 'draft'; path: string; text: string | null }
  | { k: 'reload'; path: string }
  | { k: 'keep'; path: string }
  | { k: 'window'; path: string; from: number }
  | { k: 'find'; query: string }
  | { k: 'option'; key: OptionKey; value: boolean | number }
  | { k: 'act'; id: string; path: string; isDir: boolean }
  | { k: 'pane'; what: 'close' | 'maximize' }
  | { k: 'refresh' }

export type Sent = Op & { seq: number }

/** Un envoi de la région : toutes ses opérations pas encore accusées. */
export type Post = { inst: string; ops: Sent[] }

declare module 'claude-code' {
  interface PluginState {
    'files-board': {
      /** Dossier parcouru, absolu ; null pour celui de la session. */
      root: string | null
      /** Dossiers dépliés, relatifs à la racine. */
      expanded: string[]
      /** Contenu lu de chaque dossier déplié ('' pour la racine). */
      listings: Record<string, Listing>
      tabs: Tab[]
      active: string | null
      docs: Record<string, Doc>
      find: Find
      options: Options
      seen: Seen
      wheel: Wheel
      reveal: Reveal
      isMaximized: boolean
      platform: Platform
      /** Fichiers que Claude a modifiés depuis le dernier message de la personne, absolus, les plus récents en dernier. */
      touched: string[]
    }
  }
}
