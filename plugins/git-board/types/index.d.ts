/** Un fichier modifié, tel que `git status --porcelain=v2` le décrit. */
export type GitFile = {
  path: string
  /** Ancien chemin d'un renommage ou d'une copie. */
  from: string | null
  /** Lettre côté index (`M`, `A`, `D`, `R`…), `.` quand rien n'est indexé. */
  index: string
  /** Lettre côté arbre de travail, `.` quand rien n'a changé. */
  work: string
  kind: 'conflict' | 'changed' | 'untracked'
  /** Lignes ajoutées et retirées depuis HEAD ; null pour un binaire ou un fichier non suivi. */
  added: number | null
  removed: number | null
}

export type GitBranch = {
  name: string
  isCurrent: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** La branche distante suivie a été supprimée. */
  isGone: boolean
  /** Dossier d'un autre worktree où la branche est extraite : git refuse d'y basculer ici. */
  worktree: string | null
  /** Date du dernier commit, en ms. */
  date: number
  subject: string
}

/** Une branche distante sans branche locale du même nom. */
export type GitRemoteBranch = {
  /** `origin/feat/x` */
  name: string
  /** `feat/x`, la branche locale que la bascule crée. */
  local: string
  date: number
  subject: string
}

export type GitCommit = {
  hash: string
  short: string
  author: string
  date: number
  /** Décorations de `git log` (`tag: v1.2.0`, `origin/main`…). */
  refs: string
  subject: string
  /** Présent sur au moins une branche distante. */
  isPushed: boolean
}

export type GitRepo = {
  root: string
  name: string
  /** null quand HEAD est détachée. */
  branch: string | null
  head: string | null
  /** HEAD en entier (40 caractères) : le commit dont la CI est suivie après un push. */
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
  defaultBranch: string | null
  /** `https://github.com/<owner>/<repo>` quand le distant est sur GitHub. */
  webUrl: string | null
  hasRemote: boolean
  /** Opération en cours : rebase, merge, cherry-pick ou revert. */
  operation: string | null
  stash: number
  /** Commits de HEAD absents de tout distant (`git rev-list -n 500 HEAD --not --remotes`). */
  unpushed: number
  files: GitFile[]
  branches: GitBranch[]
  remotes: GitRemoteBranch[]
  commits: GitCommit[]
}

export type PrChecks = {
  passed: number
  failed: number
  pending: number
  /** Nom du premier check en échec (`name` d'un CheckRun, `context` d'un StatusContext). */
  firstFailed?: string | null
}

/**
 * Suivi de la CI après un push, sur le commit poussé (`sha`), jusqu'à ce que tous les checks
 * soient finis : par la PR (`statusCheckRollup`) quand il y en a une, sinon par les
 * exécutions GitHub Actions du commit (`gh run list --commit`).
 * - `waiting` : rien encore lancé ; `running` : des checks tournent ;
 * - `passed`, `failed` : tous finis ; `timeout` : plafond atteint, suivi arrêté ;
 * - `none` : toujours aucun check au bout du délai d'attente, suivi arrêté.
 */
export type CiWatch = {
  root: string
  branch: string
  sha: string
  startedAt: number
  phase: 'waiting' | 'running' | 'passed' | 'failed' | 'timeout' | 'none'
  checks: PrChecks
} | null

export type PullRequest = {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  base: string
  /** Le commit de tête de la PR (`headRefOid`) ; null quand gh ne le donne pas. */
  head: string | null
  review: string | null
  checks: PrChecks
}

/** La pull request de `branch` telle que `gh pr view` l'a rendue ; null tant que rien n'est lu. */
export type PrState = { branch: string; pr: PullRequest | null; error: string | null } | null

export type Meta = {
  /** Dossier suivi ; null pour celui de la session. */
  folder: string | null
  /** Racine git du dossier de la session : là où agissent les commandes /project. */
  sessionRoot: string | null
  loading: string | null
  /** Le dossier suivi n'est pas un dépôt git. */
  error: string | null
  fetchedAt: number | null
  fetchError: string | null
}

export type Tab = 'changes' | 'branches' | 'history'
export type Action = 'commit' | 'pull' | 'push' | 'pr'

export type Notice = { text: string; tone: 'ok' | 'error' | 'info' } | null

/** Champs du panneau gardés pendant la saisie. */
export type Form = {
  hint: string
  pullFrom: 'upstream' | 'base'
  prBase: string
  prDraft: boolean
  prAuto: boolean
  filter: string
  newBranch: string
}

/** Bascule en attente de confirmation : l'arbre de travail a des modifications. */
export type Switching = { name: string; isRemote: boolean } | null

/** Commande /project lancée depuis le panneau, jusqu'à la fin de son tour. */
// `action`, `head` et `startedAt` disent ce qui marquera la fin de la commande dans le dépôt
// relu (voir isRunDone) ; absents d'une commande lancée par une version précédente du mod.
export type Running = { command: string; isStarted: boolean; action?: Action; head?: string | null; startedAt?: number } | null

/** Listes du panneau dépliées au-delà de leur plafond (« ▸ tout voir (N) »). */
export type Expanded = { files: boolean; branches: boolean; remotes: boolean; commits: boolean }

declare module 'claude-code' {
  interface PluginState {
    'git-board': {
      repo: GitRepo | null
      pr: PrState
      meta: Meta
      tab: Tab
      action: Action | null
      form: Form
      notice: Notice
      busy: string | null
      running: Running
      switching: Switching
      showRemotes: boolean
      /** Bandeau au-dessus du prompt masqué (`x` ou `/git hide`), le temps de la session. */
      isBandHidden: boolean
      expanded: Expanded
      ci: CiWatch
    }
  }
}
