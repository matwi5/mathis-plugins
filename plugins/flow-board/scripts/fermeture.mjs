#!/usr/bin/env node
// Vérifications de la fermeture d'un worker rendu (reference de `closingProcedure`, hooks/closing.ts) :
// la réponse de l'outil flow cite cette commande au lieu de recopier sa procédure de 11 000 caractères,
// que la discussion de la mission exécutait commande par commande.
//
//   node <dossier de flow-board>/scripts/fermeture.mjs --worktree <nom> [--branche <nom>]… [--session <id>] [--apres-arret]
//
// à lancer depuis le dossier de la mission (le clone ou le worktree où la branche de travail est sortie).
// `--worktree` : le nom attendu du worktree de l'envoi (sous <dépôt>/.claude/worktrees/), `--branche` : les
// noms connus de sa branche, que la réponse de l'outil donne (le script reconnaît aussi claude/<nom>-<suffixe>,
// la branche que l'app crée), `--session` : l'id de la session quand le tableau de bord le connaît.
// Le script ne fait que lire : il n'arrête aucune session, ne retire aucun worktree, ne supprime aucune
// branche ni référence. Il vérifie la forme des valeurs, core.fsmonitor (dans ce dossier et sur le worktree),
// la branche et le bloc du worktree, la fusion dans la branche de travail, l'arbre (rien de modifié ni de
// non suivi, des fichiers ignorés seulement de la liste jetable), les instantanés de revue, le verrou, et
// l'état de la session (`claude agents --json`, lecture seule). Sa première ligne est le verdict :
//
//   SÛR           tout tient : avant l'arrêt, la session peut s'arrêter ; avec --apres-arret, le worktree peut
//                 se retirer, par la commande imprimée (code 0)
//   DÉJÀ RETIRÉ   le worktree n'existe plus, la branche est fusionnée (code 0)
//   ATTENDRE : …  la session travaille : remettre la fermeture à plus tard ; avec --apres-arret, la session
//                 finit de s'arrêter : relancer la même commande (code 3)
//   ARRÊT : …     quelque chose n'est pas sûr : ne rien arrêter ni retirer, le dire (code 2)
//   ÉCHEC : …     argument hors forme, git ou claude en échec : rien n'est sûr (code 1)
//
// Juste après l'arrêt (--apres-arret), le verrou du worktree posé par sa session (« claude session … (pid N … »)
// peut encore nommer un processus vivant, alors que claude agents ne la montre plus en marche : la session finit de s'arrêter (une session de l'app, que claude agents ne montre jamais, n'attend pas : ARRÊT ; une autre session en marche dans le worktree : ARRÊT, jamais à arrêter). Le script attend alors sa fin, au plus
// quelques secondes, sans rien lancer (il relit seulement `kill(N, 0)`, qui n'envoie aucun signal), puis
// revérifie tout depuis le début ; toujours là, il rend ATTENDRE, jamais ARRÊT. Un pid hors forme (0, 1, au-delà
// de 2147483647) reste un verrou étranger : ARRÊT. La ligne des commits ne liste que ceux du worker : ceux de sa
// branche absents de la branche de travail, ou, fusionnée par un commit de fusion, ceux qu'il a apportés ; fusionnée
// en avance rapide, le script le dit et liste les 10 derniers de la branche.
//
// L'invariant : une fermeture ne fait jamais perdre un commit, un fichier modifié ou non suivi, ni la
// conversation d'un worker ; un worktree ne se retire que si sa branche est entièrement contenue dans la
// branche de travail et que son arbre ne contient rien d'autre que des fichiers de la liste jetable, vérifié
// de nouveau après l'arrêt de la session (--apres-arret) ; la branche n'est jamais supprimée ; une session
// qui travaille encore n'est jamais arrêtée. Un verdict ne vaut que pour l'instant où il est rendu.
//
// Un second mode, en fin de mission (la consigne de `branchCleanup`, à la validation du compte rendu) :
//
//   node <dossier de flow-board>/scripts/fermeture.mjs --branches [--dossier <dossier de la mission>] <branche>…
//
// vérifie en un appel les branches des workers fermés que la consigne nomme, en lecture seule, et rend une ligne
// par branche : SUPPRIMABLE (forme d'une branche, existe sous ce nom exact sans autre branche qui n'en diffère que
// par la casse, ni référence symbolique, ni sortie par un worktree, ni la branche de travail, entièrement contenue
// dans la branche de travail) ou GARDÉE et sa raison ; puis la seule commande « git -C '<dossier>' branch -d --
// '<b1>' '<b2>'… » des SUPPRIMABLES, que la session lance elle-même (jamais -D ni --force ; sans branche
// supprimable, aucune commande). Première ligne : BRANCHES (code 0), ARRÊT si la branche de travail est hors forme,
// absente ou partage son nom avec une autre à la casse près, ou si le dossier n'est pas citable (apostrophe,
// contrôle, séparateur de ligne, marque bidirectionnelle) (code 2), ÉCHEC sur un argument hors du mode (une autre
// option, --branches ailleurs qu'en tête), un dossier sans git ou git en échec (code 1 ; un nom de branche hors
// forme n'est qu'une ligne GARDÉE) ; le mode ne se mêle pas à --worktree ni à --apres-arret.
//
// Sans dépendance hors de Node. `FLOW_BOARD_CLAUDE` désigne un autre exécutable `claude`, et `FLOW_BOARD_ATTENTE_ARRET_MS`
// raccourcit l'attente de la fin d'une session (les tests).

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export class ClosingError extends Error {}

/**
 * Un verdict qui arrête la fermeture, avec sa raison ; `wait` : la session travaille, à reprendre plus tard ;
 * `stopping` : après l'arrêt, le processus `pid` de la session finit de s'arrêter (`check` attend sa fin).
 */
class Stop extends Error {
  constructor(message, kind = 'arret', pid = undefined) {
    super(message)
    this.kind = kind
    this.pid = pid
  }
}

/** Le nom d'un worktree de worker : ASCII, comme ceux que crée flow-board (`isSafeBranch` côté mod). */
const SAFE_WORKTREE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

/** Un id de session : l'id court du CLI, un UUID, ou `local_…` de l'app (`isSafeId` côté mod). */
const SAFE_SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/

/**
 * Une branche : seulement [A-Za-z0-9._/-], un nom que git accepte, pas `refs/…`, `HEAD` ni un hash
 * (`isSafeBranch` côté mod, recopiée : un test compare les deux).
 */
export const isSafeBranch = value =>
  typeof value === 'string' &&
  /^(?!-)[A-Za-z0-9._/-]{1,200}$/.test(value) &&
  !/\.\.|\/\/|^\/|\/$|\.$/.test(value) &&
  value.split('/').every(part => !part.startsWith('.') && !part.endsWith('.lock')) &&
  !/^(?:refs\/|HEAD$)/.test(value) &&
  !/^[0-9a-f]{7,40}$/i.test(value)

export const isSafeWorktreeName = value => typeof value === 'string' && SAFE_WORKTREE.test(value) && !/\.\.|\.$|\.lock$/.test(value)
export const isSafeSession = value => typeof value === 'string' && SAFE_SESSION.test(value)

/** Les valeurs de core.fsmonitor sans danger : le démon intégré de git ; toute autre est une commande. */
const FSMONITOR_SAFE = new Set(['true', 'false', 'yes', 'no', 'on', 'off', '1', '0'])

/** Les dossiers de la liste jetable, en entier ; avec les liens symboliques, les .pyc et les .DS_Store, où qu'ils soient. */
export const DISPOSABLE_DIRS = ['__pycache__', '.show-your-work', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'node_modules']

/** Un fichier ignoré de la liste jetable (chemin relatif au worktree, en `/`), `isLink` : un lien symbolique. */
export const isDisposable = (path, isLink = false) => {
  if (isLink) return true
  const parts = path.split('/')
  const name = parts.at(-1) ?? ''
  if (name === '.DS_Store' || name.endsWith('.pyc')) return true
  if (parts.slice(0, -1).some(p => DISPOSABLE_DIRS.includes(p))) return true
  // Les types générés d'un mod : un dossier .claude-plugin/types/ à toute profondeur, en entier.
  return parts.slice(0, -1).some((p, i) => p === '.claude-plugin' && parts[i + 1] === 'types' && i + 1 < parts.length - 1)
}

/** Les blocs de `git worktree list --porcelain` : chemin, branche (sans refs/heads/), verrou et sa raison. */
export const parsePorcelain = text =>
  text
    .split(/\n\n+/)
    .map(block => block.split('\n').filter(Boolean))
    .filter(lines => lines.length > 0 && lines[0].startsWith('worktree '))
    .map(lines => {
      const one = key => lines.find(l => l === key || l.startsWith(`${key} `))
      const branch = one('branch')?.slice('branch '.length)
      const locked = one('locked')
      return {
        path: lines[0].slice('worktree '.length),
        ...(branch?.startsWith('refs/heads/') ? { branch: branch.slice('refs/heads/'.length) } : {}),
        ...(locked !== undefined ? { locked: locked.slice('locked'.length).trim() } : {}),
        isDetached: lines.includes('detached'),
      }
    })

/**
 * Le pid d'un verrou posé par une session de claude (« claude session <nom> (pid <pid> … », quel que soit son nom,
 * le dernier « (pid » de la ligne suivi d'un nombre de 1 à 10 chiffres), en forme : 2 à 2147483647. 0 (`kill` viserait le groupe de processus), 1 (le
 * premier processus du système) et un nombre plus grand ne désignent jamais une session : null, comme tout autre
 * verrou.
 */
export const sessionLockPid = reason => {
  const m = /^claude session .* \(pid (\d{1,10})\b/.exec(reason)
  if (!m) return null
  const pid = Number(m[1])
  return pid >= 2 && pid <= 2_147_483_647 ? m[1] : null
}

/** Le verrou d'un worktree que le script peut lever : celui d'une session de claude, son processus disparu. Rend le pid, ou null pour tout autre verrou. */
export const staleSessionLock = (reason, isAlive) => {
  const pid = sessionLockPid(reason)
  if (pid === null) return null
  return isAlive(Number(pid)) ? null : pid
}

/**
 * Le plus long qu'attend le script, juste après l'arrêt, la fin du processus d'une session qui finit de s'arrêter
 * (son verrou encore là) : observé, il disparaît dans la seconde. `FLOW_BOARD_ATTENTE_ARRET_MS` (les tests) ne peut
 * que raccourcir cette attente : un entier de millisecondes, sinon ignoré.
 */
const STOP_WAIT_MS = 5_000
const STOP_POLL_MS = 100
export const stopWaitMs = (value = process.env.FLOW_BOARD_ATTENTE_ARRET_MS) =>
  typeof value === 'string' && /^\d{1,7}$/.test(value) ? Math.min(STOP_WAIT_MS, Number(value)) : STOP_WAIT_MS

/** Attend, sans rien lancer ni envoyer, que `pid` disparaisse, au plus `ms` ; rend vrai s'il a disparu. */
const waitGone = (pid, ms) => {
  const tick = new Int32Array(new SharedArrayBuffer(4))
  const end = Date.now() + ms
  while (isAlive(pid)) {
    const left = end - Date.now()
    if (left <= 0) return false
    Atomics.wait(tick, 0, 0, Math.min(STOP_POLL_MS, left))
  }
  return true
}

/** Un processus vivant : `kill(pid, 0)` n'envoie aucun signal ; seul ESRCH dit qu'il a disparu, le doute le garde vivant. */
const isAlive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code !== 'ESRCH'
  }
}

/** Une valeur citée pour un shell POSIX, entre apostrophes. */
export const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`

/** Un chemin comparable : résolu (liens compris quand il existe), sans séparateur final. */
const samePath = (a, b) => {
  const norm = p => {
    let out = resolve(p)
    try {
      out = realpathSync(out)
    } catch {
      // Un chemin disparu se compare tel quel.
    }
    return out.replace(/[\\/]+$/, '')
  }
  return norm(a) === norm(b)
}

/** Un chemin sous `dir` (ou `dir` lui-même). */
const isInside = (path, dir) => samePath(path, dir) || resolve(path).startsWith(resolve(dir) + sep)

/**
 * git dans `cwd`, sans fin de ligne finale ; core.fsmonitor forcé à faux (aucune commande lancée par
 * git status), sans verrou facultatif (git status ne réécrit pas l'index d'une session au travail) ; `ok` :
 * les codes de sortie acceptés en plus de 0 (rend alors null).
 */
const git = (cwd, args, ok = []) => {
  try {
    return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).replace(/\n$/, '')
  } catch (err) {
    if (ok.includes(err.status)) return null
    throw new ClosingError(`git ${args.join(' ')} a échoué : ${String(err.stderr || err.message).trim()}`)
  }
}

/** La valeur de core.fsmonitor lue dans `cwd` (sa config propre comprise) : une commande arrête tout. */
const checkFsmonitor = (cwd, where) => {
  let value
  try {
    value = execFileSync('git', ['config', '--get', 'core.fsmonitor'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    if (err.status === 1) return
    throw new ClosingError(`git config --get core.fsmonitor a échoué ${where} : ${String(err.stderr || err.message).trim()}`)
  }
  if (!FSMONITOR_SAFE.has(value.toLowerCase())) throw new Stop(`core.fsmonitor ${where} vaut une commande, que git status exécuterait : ne lance aucune autre commande git, dis-le à la personne`)
}

/** Les sessions de `claude agents --json` (`all` : arrêtées comprises) ; une sortie illisible : rien n'est sûr. */
const agents = all => {
  const bin = process.env.FLOW_BOARD_CLAUDE || 'claude'
  let out
  try {
    out = execFileSync(bin, ['agents', '--json', ...(all ? ['--all'] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
  } catch (err) {
    throw new ClosingError(`claude agents --json${all ? ' --all' : ''} a échoué : ${String(err.stderr || err.message).trim()}`)
  }
  let list
  try {
    list = JSON.parse(out)
  } catch {
    throw new ClosingError(`claude agents --json${all ? ' --all' : ''} : sortie illisible`)
  }
  if (!Array.isArray(list)) throw new ClosingError(`claude agents --json${all ? ' --all' : ''} : pas une liste`)
  return list.filter(a => a !== null && typeof a === 'object')
}

/** Une session au repos : "status": "idle" et pas "state": "working" ; tout autre état (absent, inconnu) fait attendre. */
export const isIdle = a => a.status === 'idle' && a.state !== 'working'

/** Une session montrée arrêtée par `--all` : sans pid, en "state": "stopped" ou "done". */
export const isShownStopped = a => (a.pid === undefined || a.pid === null) && (a.state === 'stopped' || a.state === 'done')

/** L'entrée d'une session par son id (court ou complet). */
const isSession = (a, id) => a.id === id || a.sessionId === id

/** La branche que l'app crée pour ce worktree : claude/<nom>-<suffixe>, jamais celle d'un envoi suivant (<nom>-2-…). */
const isAppBranch = (branch, name) => branch.startsWith(`claude/${name}-`) && /^[A-Za-z0-9._-]+$/.test(branch.slice(`claude/${name}-`.length)) && !/^\d+(?:-|$)/.test(branch.slice(`claude/${name}-`.length))

/** Lit les arguments ; une valeur hors forme : ÉCHEC, aucune commande lancée. */
export const parseArgs = argv => {
  const out = { branches: [], isAfterStop: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) throw new ClosingError(`${arg} attend une valeur`)
      return argv[++i]
    }
    if (arg === '--apres-arret') out.isAfterStop = true
    else if (arg === '--worktree') {
      const v = value()
      if (!isSafeWorktreeName(v)) throw new ClosingError(`nom de worktree hors forme : ${JSON.stringify(v)}`)
      out.worktree = v
    } else if (arg === '--branche') {
      const v = value()
      if (!isSafeBranch(v)) throw new ClosingError(`branche hors forme : ${JSON.stringify(v)}`)
      out.branches.push(v)
    } else if (arg === '--session') {
      const v = value()
      if (!isSafeSession(v)) throw new ClosingError(`id de session hors forme : ${JSON.stringify(v)}`)
      out.session = v
    } else throw new ClosingError(`argument inconnu : ${JSON.stringify(arg)}`)
  }
  if (!out.worktree) throw new ClosingError('--worktree <nom> manque')
  return out
}

/**
 * Les vérifications, dans `cwd` (le dossier de la mission) ; rend le verdict et ses lignes. Ne lève que
 * `ClosingError` (ÉCHEC) ; un arrêt ou une attente sont des verdicts.
 */
export const check = (argv, cwd = process.cwd()) => {
  const args = parseArgs(argv)
  const once = () => {
    const lines = []
    try {
      return verdict(args, cwd, lines)
    } catch (err) {
      if (err instanceof Stop) return { verdict: err.kind === 'wait' || err.kind === 'stopping' ? 'ATTENDRE' : 'ARRÊT', reason: err.message, lines, ...(err.kind === 'stopping' ? { stopping: err.pid } : {}) }
      throw err
    }
  }
  const first = once()
  if (first.stopping === undefined) return first
  // Juste après l'arrêt, la session finit de s'arrêter (son verrou, son processus encore là) : attendre sa fin, au
  // plus quelques secondes, puis tout revérifier depuis le début (worktrees, sessions, fusion, arbre, instantanés,
  // verrou) : rien de ce qui a été lu avant sa fin ne compte. Toujours là : ATTENDRE, relancer la même commande.
  const ms = stopWaitMs()
  if (!waitGone(Number(first.stopping), ms)) return { verdict: 'ATTENDRE', reason: `session encore en arrêt (processus ${first.stopping} toujours là après ${ms} ms) : relance cette commande`, lines: [] }
  const again = once()
  // Un autre processus de session en arrêt à la deuxième lecture : le même ATTENDRE, sans attendre de nouveau.
  return again.stopping === undefined ? again : { verdict: 'ATTENDRE', reason: `session encore en arrêt (processus ${again.stopping}) : relance cette commande`, lines: [] }
}

const verdict = (args, cwd, lines) => {
  const isApp = args.session?.startsWith('local_') === true
  checkFsmonitor(cwd, 'dans ce dossier')
  const blocks = parsePorcelain(git(cwd, ['worktree', 'list', '--porcelain']))
  const repo = blocks[0]?.path
  if (!repo) throw new ClosingError('git worktree list --porcelain : aucun bloc')
  const work = git(cwd, ['branch', '--show-current'])
  if (!isSafeBranch(work)) throw new Stop(`la branche de travail de ce dossier est hors forme ou absente (${JSON.stringify(work)}) : HEAD détachée ?`)
  lines.push(`branche de travail : ${work}`)
  const expected = join(repo, '.claude', 'worktrees', args.worktree)
  const isOurs = b => args.branches.includes(b) || isAppBranch(b, args.worktree)

  // La session, dans le CLI : lue avant tout le reste, son cwd désigne le worktree. Pour l'app, claude agents ne la
  // montre pas, mais montrerait une autre session dans le worktree : illisible, rien n'est sûr (ÉCHEC), comme au CLI.
  const running = agents(false)
  const own = args.session ? running.find(a => isSession(a, args.session)) : undefined

  // Le bloc du worktree : celui du cwd de la session, sinon celui d'une branche connue ; jamais un chemin deviné.
  let block
  // Une session encore lancée dans son worktree déjà retiré (le dossier attendu disparu) : le cas « déjà retiré ».
  const isGoneUnder = own !== undefined && typeof own.cwd === 'string' && samePath(own.cwd, expected) && !existsSync(expected)
  if (own && typeof own.cwd === 'string' && !isGoneUnder) {
    block = blocks.find(b => samePath(b.path, own.cwd))
    if (!block) throw new Stop(`la session ${args.session} tourne hors d'un worktree de ce dépôt (${JSON.stringify(own.cwd)})`)
    if (!block.branch || !isOurs(block.branch)) throw new Stop(`le worktree de la session porte une branche inattendue (${JSON.stringify(block.branch ?? 'HEAD détachée')}), pas l'une des branches connues`)
  } else {
    const found = blocks.filter(b => b.branch !== undefined && isOurs(b.branch))
    if (found.length > 1) throw new Stop(`plusieurs worktrees portent une branche connue (${found.map(b => b.branch).join(', ')}) : lequel fermer ?`)
    block = found[0]
  }
  if (!block) {
    // Aucun bloc : le dossier attendu ne doit plus exister, et la branche doit être fusionnée.
    const other = blocks.find(b => samePath(b.path, expected))
    if (other) throw new Stop(`le worktree ${expected} existe sans l'une des branches connues (HEAD détachée, rebase ou bisect en cours ?)`)
    if (existsSync(expected)) throw new Stop(`le dossier ${expected} existe encore sans bloc dans git worktree list : n'y touche pas`)
    // Chaque branche connue qui existe, celle de l'app (claude/<nom>-<suffixe>) comprise, doit être fusionnée : une
    // seule, peut-être celle d'une autre mission (groupe-<id>), ne prouve rien du travail de ce worker.
    const named = args.branches.filter(b => git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], [1]) !== null)
    const app = git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/claude/']).split('\n').filter(b => b !== '' && isAppBranch(b, args.worktree))
    const existing = [...new Set([...named, ...app])]
    if (existing.length === 0) throw new Stop('aucune des branches connues n’existe dans ce dépôt, et le worktree est absent : rien ne prouve que son travail est fusionné')
    for (const branch of existing) {
      lines.push(`branche : ${branch}`)
      merged(cwd, branch, work, lines)
    }
    const session = sessionState(args, running, expected, isApp, lines, false)
    return { verdict: 'DÉJÀ RETIRÉ', lines, session }
  }
  const worktree = block.path
  lines.push(`worktree : ${worktree}`, `branche : ${block.branch}`)
  if (!isInside(worktree, join(repo, '.claude', 'worktrees')) || samePath(worktree, join(repo, '.claude', 'worktrees')) || /['\u0000-\u001f\u007f-\u009f\u2018-\u201b\u2028\u2029]/.test(worktree)) throw new Stop(`le worktree ${JSON.stringify(worktree)} n'est pas un worktree de worker (<dépôt>/.claude/worktrees/<nom>, sans apostrophe, droite ou typographique, ni caractère de contrôle ou séparateur de ligne)`)
  if (samePath(worktree, cwd) || isInside(cwd, worktree)) throw new Stop('le worktree à fermer est ce dossier')
  if (block.branch === work) throw new Stop('la branche du worktree est la branche de travail de ce dossier')
  // Après l'arrêt, le verrou d'une session dont le processus vit encore, alors que claude agents ne montre plus aucune
  // session en marche pour ce worker ni dans ce worktree (une session arrêtée quitte cette liste) : elle finit de
  // s'arrêter. Rien d'autre ne se lit avant sa fin (l'arbre, la fusion), et `check` revérifie tout une fois qu'elle a
  // disparu. Une session encore listée n'a pas été arrêtée : ARRÊT, la session tourne encore. Une session de l'app
  // n'est jamais dans claude agents : son verrou garde l'ARRÊT d'un verrou étranger (lockState), sans attente.
  if (args.isAfterStop && !isApp && block.locked !== undefined) {
    const pid = sessionLockPid(block.locked)
    const own = args.session !== undefined ? running.find(a => isSession(a, args.session)) : undefined
    const other = running.find(a => typeof a.cwd === 'string' && isInside(a.cwd, worktree) && !(args.session !== undefined && isSession(a, args.session)))
    // Encore listée, la session n'a pas été arrêtée : la raison vraie, pas celle d'un verrou étranger. Seule celle du
    // worker (son id connu) s'arrête ; une autre session dans le worktree n'est jamais à arrêter : la personne décide.
    if (pid !== null && isAlive(Number(pid)) && own) throw new Stop(`la session ${JSON.stringify(own.id)} tourne encore : arrête-la d'abord (claude stop), puis relance cette vérification`)
    if (pid !== null && isAlive(Number(pid)) && other) throw new Stop('une autre session tourne encore dans le worktree : n’y touche pas (ne l’arrête pas), demande à la personne')
    if (pid !== null && isAlive(Number(pid))) throw new Stop(`session encore en arrêt (processus ${pid})`, 'stopping', pid)
  }
  checkFsmonitor(worktree, 'sur le worktree')
  lines.push(...workerCommits(cwd, block.branch, work))
  merged(cwd, block.branch, work, lines)
  cleanTree(worktree, lines)
  snapshots(cwd, worktree, work, lines)
  const unlock = lockState(block, args.isAfterStop, lines)
  const session = sessionState(args, running, worktree, isApp, lines, args.isAfterStop)
  if (args.isAfterStop) {
    lines.push(`commande : ${unlock ? `git worktree unlock ${shellQuote(worktree)}, puis ` : ''}git worktree remove ${shellQuote(worktree)} (sans option ; la branche ${block.branch} reste)`)
  }
  return { verdict: 'SÛR', lines, session }
}

/**
 * Les commits propres au worker, 10 au plus, à reconnaître par la discussion, avec un libellé qui dit d'où ils
 * viennent : la branche pas encore fusionnée, ses commits absents de la branche de travail ; fusionnée par un
 * commit de fusion M de la première lignée de la branche de travail (son second parent : la tête de la branche ;
 * le plus ancien qui apporte un commit), `M^1..M^2` ; sinon (avance rapide, M introuvable), le script le dit et
 * liste les 10 derniers de la branche, ceux de la branche de travail compris, comme avant.
 */
const workerCommits = (cwd, branch, work) => {
  const list = range => git(cwd, ['log', '--oneline', '-10', ...range]).split('\n').filter(Boolean).map(l => `  ${l}`)
  const head = `refs/heads/${branch}`
  if (git(cwd, ['merge-base', '--is-ancestor', head, `refs/heads/${work}`], [1]) === null)
    return [`commits du worker (propres à ${branch}, pas encore dans ${work}) :`, ...list([`refs/heads/${work}..${head}`])]
  const tip = git(cwd, ['rev-parse', '--verify', `${head}^{commit}`])
  // Chaque fusion de la première lignée de la branche de travail, depuis le départ de la branche : « M P1 P2 ».
  const merges = git(cwd, ['rev-list', '--first-parent', '--merges', '--parents', `${head}..refs/heads/${work}`])
    .split('\n')
    .map(l => l.split(' '))
    .filter(parts => parts.length === 3 && parts[2] === tip)
    .reverse()
  const m = merges.find(([, p1, p2]) => git(cwd, ['rev-list', '--count', `${p1}..${p2}`]) !== '0')
  if (m) return [`commits du worker (propres à ${branch}, fusionnés par le commit de fusion ${m[0].slice(0, 12)}) :`, ...list([`${m[1]}..${m[2]}`])]
  return [`commits de ${branch} (fusion sans commit de fusion : commits du worker non distinguables ; les 10 derniers de la branche) :`, ...list([head])]
}

/** La branche entièrement contenue dans la branche de travail ; N, ses commits que le CLI dit non poussés. */
const merged = (cwd, branch, work, lines) => {
  // Toujours par refs/heads/ : une étiquette du même nom masquerait la branche.
  if (git(cwd, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, `refs/heads/${work}`], [1]) === null) {
    const left = git(cwd, ['rev-list', '--count', `refs/heads/${work}..refs/heads/${branch}`])
    throw new Stop(`${left} commit(s) de ${branch} ne sont pas dans ${work} (git log ${shellQuote(`refs/heads/${work}..refs/heads/${branch}`)} --oneline) : la fermeture ne fusionne jamais`)
  }
  const unpushed = git(cwd, ['rev-list', '--count', `refs/heads/${branch}`, '--not', '--remotes'])
  lines.push(`fusion : ${branch} est entièrement dans ${work} (vérifié) ; ${unpushed} de ses commits ne sont sur aucun dépôt distant`)
}

/** Rien de modifié ni de non suivi ; parmi les fichiers ignorés, seulement la liste jetable. */
const cleanTree = (worktree, lines) => {
  const status = git(worktree, ['status', '--porcelain', '--untracked-files=all', '-z'])
  const changed = status.split('\0').filter(Boolean)
  if (changed.length > 0) throw new Stop(`l'arbre du worktree porte des fichiers modifiés ou non suivis : ${changed.slice(0, 20).map(l => l.slice(3)).join(', ')}${changed.length > 20 ? ` (et ${changed.length - 20} autres)` : ''}`)
  const ignored = git(worktree, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).split('\0').filter(Boolean)
  const kept = ignored.filter(p => {
    let isLink = false
    try {
      isLink = lstatSync(join(worktree, p)).isSymbolicLink()
    } catch {
      // Disparu entre-temps : jugé sur son nom.
    }
    return !isDisposable(p, isLink)
  })
  if (kept.length > 0) throw new Stop(`des fichiers ignorés hors de la liste jetable : ${kept.slice(0, 20).join(', ')}${kept.length > 20 ? ` (et ${kept.length - 20} autres)` : ''}`)
  lines.push(`arbre : propre${ignored.length > 0 ? ` (${ignored.length} fichier(s) ignoré(s), tous de la liste jetable)` : ''}`)
}

/**
 * Chaque instantané de revue du worktree a son arbre dans un commit de la branche de travail ; toute autre
 * référence propre au worktree (refs/worktree/, refs/bisect/), que son retrait effacerait, pointe dans la
 * branche de travail.
 */
const snapshots = (cwd, worktree, work, lines) => {
  const all = git(worktree, ['for-each-ref', '--format=%(refname)', 'refs/worktree/', 'refs/bisect/']).split('\n').filter(Boolean)
  const others = all.filter(ref => !ref.startsWith('refs/worktree/flow-board/'))
  const outside = others.filter(ref => git(worktree, ['merge-base', '--is-ancestor', ref, `refs/heads/${work}`], [1]) === null)
  if (outside.length > 0) throw new Stop(`référence(s) propres au worktree hors de ${work}, que son retrait effacerait : ${outside.join(', ')}`)
  const refs = all.filter(ref => ref.startsWith('refs/worktree/flow-board/'))
  if (refs.length === 0) return void lines.push(`instantanés : aucun${others.length > 0 ? ` ; ${others.length} autre(s) référence(s) du worktree, dans ${work}` : ''}`)
  const trees = new Set(git(cwd, ['log', `refs/heads/${work}`, '--format=%T']).split('\n'))
  const missing = refs.filter(ref => !trees.has(git(worktree, ['rev-parse', `${ref}^{tree}`])))
  if (missing.length > 0) throw new Stop(`instantané(s) de revue dont l'arbre n'est dans aucun commit de ${work} : ${missing.join(', ')}`)
  lines.push(`instantanés : ${refs.length}, chacun dans un commit de ${work}`)
}

/** Le verrou du worktree : seul celui de cette session, son processus disparu, se lève (après l'arrêt). */
const lockState = (block, isAfterStop, lines) => {
  if (block.locked === undefined) return false
  const pid = staleSessionLock(block.locked, isAlive)
  if (pid === null && isAfterStop) throw new Stop(`le worktree est verrouillé par autre chose qu'une session arrêtée (${JSON.stringify(block.locked)}) : n'y touche pas`)
  lines.push(`verrou : ${JSON.stringify(block.locked)}${pid !== null ? ` (processus ${pid} disparu : levé après l'arrêt)` : ''}`)
  return pid !== null
}

/**
 * La session : au travail, elle fait attendre ; une autre session dans le worktree arrête tout. Après
 * l'arrêt, aucune ne doit plus tourner dedans. Une session de l'app ne paraît pas dans claude agents :
 * la discussion la vérifie par ListAgents. Rend ce que la discussion doit encore faire pour elle
 * (`nextStep`) : `idle` (claude stop imprimé), `app` ou `absent` (le contrôle ListAgents d'abord), `stopped`.
 */
const sessionState = (args, running, worktree, isApp, lines, isAfterStop) => {
  // Une autre session dans le worktree arrête tout ; pour l'app, toute session que montre claude agents en est une autre.
  const inside = running.filter(a => typeof a.cwd === 'string' && isInside(a.cwd, worktree))
  const strangers = inside.filter(a => !(args.session && isSession(a, args.session)))
  if (strangers.length > 0 && args.session) throw new Stop(`une autre session tourne dans le worktree : ${strangers.map(a => JSON.stringify(a.name ?? a.id)).join(', ')}`)
  // Sans id de session, rien ne dit qu'une session dans le worktree est ce worker (et pas une session de la personne).
  if (strangers.length > 0) throw new Stop(`sans id de session, une session tourne dans le worktree (${strangers.map(a => JSON.stringify(a.name ?? a.id)).join(', ')}) : rien ne dit que c'est ce worker ; n'arrête rien, demande à la personne`)
  if (isApp) {
    lines.push(`session : ${args.session}, de l'app Desktop : vérifie-la par ListAgents (${isAfterStop ? 'archivée : absente de ListAgents' : 'au repos, pas busy'}) ; claude agents ne la montre pas`)
    return 'app'
  }
  const own = args.session ? running.find(a => isSession(a, args.session)) : inside[0]
  if (isAfterStop) {
    if (own || inside.length > 0) throw new Stop(`la session ${JSON.stringify(own?.id ?? inside[0].id)} tourne encore : arrête-la d'abord (claude stop), puis relance cette vérification`)
    const all = agents(true)
    const shown = args.session ? all.find(a => isSession(a, args.session)) : all.find(a => typeof a.cwd === 'string' && isInside(a.cwd, worktree))
    if (shown && !isShownStopped(shown)) throw new Stop(`la session ${JSON.stringify(shown.id)} n'est pas montrée arrêtée (state ${JSON.stringify(shown.state)})`)
    lines.push(`session : ${shown ? `arrêtée (sessionId ${shown.sessionId ?? '?'})` : 'absente de claude agents'}`)
    return shown ? 'stopped' : 'absent'
  }
  if (!own) {
    const all = agents(true)
    const shown = args.session ? all.find(a => isSession(a, args.session)) : all.find(a => typeof a.cwd === 'string' && isInside(a.cwd, worktree))
    lines.push(shown ? `session : déjà arrêtée (sessionId ${shown.sessionId ?? '?'})` : 'session : absente de claude agents')
    return shown ? 'stopped' : 'absent'
  }
  // Son id entre dans la commande imprimée : seulement en forme (une valeur lue de claude agents).
  if (!isSafeSession(own.id)) throw new Stop(`l'id de la session relu de claude agents est hors forme (${JSON.stringify(own.id)}) : n'arrête rien`)
  if (!isIdle(own)) throw new Stop(`la session ${JSON.stringify(own.id)} n'est pas montrée au repos (status ${JSON.stringify(own.status)}, state ${JSON.stringify(own.state)}) : remets la fermeture à plus tard`, 'wait')
  lines.push(`session : ${own.id}, au repos (sessionId ${own.sessionId ?? '?'}) ; arrêt : claude stop ${shellQuote(own.id)}`)
  return 'idle'
}

// ─── Le mode --branches : le verdict des branches à supprimer en fin de mission ─────────────────

/**
 * Les arguments du mode `--branches`, qui vient en tête : les noms des branches, et `--dossier` (le dossier de
 * la mission, sinon le dossier courant). Tout autre argument en `--` (`--worktree`, `--apres-arret`…) : ÉCHEC,
 * aucune commande lancée ; le mode ne se mêle jamais à la fermeture d'un worker.
 */
export const parseBranchArgs = argv => {
  if (argv[0] !== '--branches') throw new ClosingError('--branches doit venir en tête')
  const out = { names: [], dir: undefined }
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dossier') {
      if (out.dir !== undefined) throw new ClosingError('--dossier donné deux fois')
      if (i + 1 >= argv.length || argv[i + 1] === '') throw new ClosingError('--dossier attend une valeur')
      out.dir = argv[++i]
    } else if (arg.startsWith('--')) throw new ClosingError(`argument inconnu en mode --branches : ${JSON.stringify(arg)} (il ne se mêle pas à la fermeture d'un worker)`)
    else out.names.push(arg)
  }
  if (out.names.length === 0) throw new ClosingError('--branches <branche>… : aucune branche donnée')
  return out
}

/** Un nom qui imite un pseudo-ref (ORIG_HEAD…) ou un espace de refs (tags/…) : jamais supprimé (recopié de `branchFate`, hooks/closing.ts : un test compare les deux). */
export const isRefLookalike = name => /(?:^|\/)[A-Z_]*_HEAD$|^(?:heads|tags|remotes)\//.test(name)

/**
 * Un dossier qui entre entre apostrophes dans la commande imprimée : ni apostrophe (droite ou typographique), ni
 * caractère de contrôle, ni séparateur de ligne, ni marque bidirectionnelle qui retournerait l'affichage de la ligne.
 */
export const isQuotableDir = dir => typeof dir === 'string' && dir !== '' && !/['\u0000-\u001f\u007f-\u009f\u2018-\u201b\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(dir)

/**
 * Les branches qu'un worktree a sorties : toute ligne `branch refs/heads/…` de `git worktree list --porcelain`,
 * où qu'elle soit (sans -z, que git ne connaît que depuis la 2.36 ; une ligne de trop ne fait que garder une
 * branche de plus).
 */
const checkedOut = cwd =>
  git(cwd, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter(line => line.startsWith('branch refs/heads/'))
    .map(line => line.slice('branch refs/heads/'.length))

/**
 * Le mode `--branches`, en lecture seule : pour chaque branche donnée, SUPPRIMABLE quand elle a la forme d'une
 * branche, existe sous ce nom exact (`refs/heads/<nom>`) sans autre branche qui n'en diffère que par la casse,
 * n'est ni une référence symbolique, ni sortie par un worktree (le dossier de la mission compris), ni la branche
 * de travail, et est entièrement contenue dans la branche de travail ; sinon GARDÉE et sa raison. Puis la seule
 * commande de suppression, pour les seules SUPPRIMABLES. ARRÊT, aucune n'étant supprimable : le dossier n'est pas
 * citable, ou la branche de travail est hors forme, absente ou partage son nom avec une autre à la casse près.
 * Ne lève que `ClosingError` (ÉCHEC : un dossier sans git, git en échec). Invariant : une branche pas fusionnée,
 * sortie par un worktree ou hors forme n'est jamais dans la commande imprimée, qui n'emploie jamais `-D` ni
 * `--force`.
 */
export const checkBranches = (argv, cwd0 = process.cwd()) => {
  const { names, dir } = parseBranchArgs(argv)
  const cwd = resolve(cwd0, dir ?? '.')
  const stop = reason => ({ verdict: 'ARRÊT', reason, lines: [], deletable: [] })
  // Le dossier n'est pas recopié dans le message : il porte justement un caractère qui n'a rien à faire dans la sortie.
  if (!isQuotableDir(cwd)) return stop('le dossier de la mission porte une apostrophe, un caractère de contrôle, un séparateur de ligne ou une marque bidirectionnelle : il n’entre dans aucune commande')
  const work = git(cwd, ['branch', '--show-current'])
  if (!isSafeBranch(work)) return stop('la branche de travail de ce dossier est hors forme ou absente (HEAD détachée ?) : aucune branche n’est supprimable')
  // Sur un disque qui ignore la casse, git lit `refs/heads/<nom>` sur le disque : une autre branche qui n'en diffère
  // que par la casse (l'une tassée dans packed-refs, l'autre libre) répond à sa place, et `branch -d` efface les deux.
  // Une telle collision garde la branche ; sur la branche de travail, elle arrête tout (sa fusion serait lue ailleurs).
  // Majuscules puis minuscules : « ſ » (s long) devient « s », comme le compare un disque qui ignore la casse.
  const fold = name => name.toUpperCase().toLowerCase()
  const heads = git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/heads/']).split('\n').filter(Boolean)
  const exact = new Set(heads)
  const folded = heads.map(fold)
  const collides = name => folded.filter(h => h === fold(`refs/heads/${name}`)).length > 1
  if (collides(work)) return stop(`une autre branche ne diffère de la branche de travail ${work} que par la casse : aucune branche n’est supprimable`)
  const lines = [`branche de travail : ${work}`]
  const out = new Set(checkedOut(cwd).map(fold))
  const deletable = []
  const unique = [...new Set(names)]
  for (const name of unique) {
    // Un nom hors forme n'est jamais recopié : seul son rang parmi les arguments le désigne.
    const keep = why => lines.push(`GARDÉE : ${isSafeBranch(name) && !isRefLookalike(name) ? name : `(nom hors forme, ${names.indexOf(name) + 1}e branche)`} (${why})`)
    if (!isSafeBranch(name) || isRefLookalike(name)) keep('hors forme')
    else if (fold(name) === fold(work)) keep('branche de travail')
    else if (!exact.has(`refs/heads/${name}`)) keep('absente sous ce nom exact : déjà supprimée ?')
    else if (collides(name)) keep('une autre branche ne diffère de celle-ci que par la casse')
    else if (git(cwd, ['symbolic-ref', '-q', `refs/heads/${name}`], [1]) !== null) keep('référence symbolique')
    else if (out.has(fold(name))) keep('sortie par un worktree')
    else if (git(cwd, ['merge-base', '--is-ancestor', `refs/heads/${name}`, `refs/heads/${work}`], [1]) === null) keep(`pas entièrement contenue dans ${work}`)
    else {
      deletable.push(name)
      lines.push(`SUPPRIMABLE : ${name}`)
    }
  }
  if (deletable.length > 0) lines.push(`commande : git -C ${shellQuote(cwd)} branch -d -- ${deletable.map(shellQuote).join(' ')}`)
  return { verdict: 'BRANCHES', reason: `${deletable.length} supprimable(s), ${unique.length - deletable.length} gardée(s)`, lines, deletable }
}

/** La dernière ligne du mode `--branches` : le seul geste à faire sur son verdict. */
export const branchesNextStep = (verdict, hasCommand) => {
  if (verdict === 'BRANCHES' && hasCommand)
    return 'suite : lance la commande ci-dessus telle quelle, une seule fois, sans rien y ajouter ni retirer (jamais -D ni --force) ; lis sa sortie branche par branche (git l’écrit en anglais ou dans la langue du poste) : « Deleted branch » (« Branche … supprimée ») : supprimée ; « error: » (« erreur : ») : git la refuse, elle reste (ne la force d’aucune façon, garde son message) ; dans le doute, relance cette même vérification, qui ne fait que lire : une branche « absente » est supprimée, une autre est restée ; puis dis à la personne ce qui est supprimé, gardé (avec la raison) et refusé par git'
  if (verdict === 'BRANCHES') return 'suite : aucune branche n’est supprimable : ne supprime rien ; dis à la personne les branches gardées et leur raison'
  return 'suite : ne supprime aucune branche ; dis la raison à la personne'
}

const mainBranches = argv => {
  try {
    const out = checkBranches(argv)
    console.log(`${out.verdict} : ${out.reason}`)
    for (const line of out.lines) console.log(line)
    console.log(branchesNextStep(out.verdict, out.deletable.length > 0))
    return out.verdict === 'ARRÊT' ? 2 : 0
  } catch (err) {
    console.log(`ÉCHEC : ${err instanceof ClosingError ? err.message : String(err.message)} ; rien n'est sûr : ne supprime aucune branche`)
    console.log(branchesNextStep('ÉCHEC', false))
    return 1
  }
}
/** La fin d'un arrêt de la fermeture : ce que la discussion dit et renvoie. */
const STOPPED = 'suite : ne ferme rien (n’arrête aucune session, ne retire aucun worktree) ; dis la raison à la personne, puis envoie "state": "stopped" avec elle'

/** Les contrôles que le script laisse à la discussion, par ListAgents, avant tout geste. */
const LIST_AGENTS = {
  app: 'vérifie d’abord par ListAgents que la session de l’app y est au repos (busy : n’arrête rien, remets la fermeture à plus tard ; absente : déjà archivée, rien à arrêter)',
  appAfter: 'vérifie d’abord par ListAgents que la session de l’app n’y est plus (archivée)',
  absent: 'vérifie d’abord par ListAgents qu’aucune session de ce worker n’est encore là (une ligne busy ou idle : n’arrête rien et demande à la personne)',
}

/**
 * La dernière ligne de la sortie : le seul geste à faire sur ce verdict, la réponse de l'outil flow renvoyant
 * à elle au lieu de recopier chaque cas. `session` : ce que la vérification de la session a laissé
 * (`sessionState`) : le contrôle ListAgents d'une session de l'app ou absente de claude agents passe avant tout geste ;
 * sans valeur, le cas le plus prudent (absente).
 */
export const nextStep = (verdict, isAfterStop, session = 'absent') => {
  if (verdict === 'SÛR' && isAfterStop) {
    const check = session === 'app' ? `${LIST_AGENTS.appAfter} ; puis ` : session === 'absent' ? `${LIST_AGENTS.absent} ; puis ` : ''
    return `suite : ${check}lance la commande de retrait ci-dessus, sans option ; la branche reste : ne la supprime pas`
  }
  if (verdict === 'SÛR') {
    if (session === 'app') return `suite : ${LIST_AGENTS.app} ; seulement alors, archive-la comme le dit la réponse de l’outil flow, puis relance cette commande avec --apres-arret`
    if (session === 'absent') return `suite : ${LIST_AGENTS.absent} ; puis relance cette commande avec --apres-arret`
    if (session === 'stopped') return 'suite : la session est déjà arrêtée : relance cette commande avec --apres-arret'
    return 'suite : arrête la session (la commande claude stop ci-dessus), puis relance cette commande avec --apres-arret'
  }
  // Après l'arrêt, seule la session qui finit de s'arrêter fait attendre : relancer, un nombre borné de fois.
  if (verdict === 'ATTENDRE' && isAfterStop) return 'suite : la session finit de s’arrêter : ne retire rien ; relance cette même commande, au plus 3 fois ; encore ATTENDRE à la troisième : ne retire rien, dis-le à la personne, puis envoie "state": "stopped" avec la raison'
  if (verdict === 'ATTENDRE') return 'suite : n’arrête rien, ne retire rien ; remets la fermeture à plus tard (une réponse suivante de l’outil flow la reprendra) et dis-le en une ligne'
  if (verdict === 'DÉJÀ RETIRÉ') {
    const rm = 'rien à retirer ; la réponse de l’outil flow dit si claude rm se fait'
    if (session === 'idle') return `suite : arrête la session (la commande claude stop ci-dessus) ; ${rm}`
    if (session === 'app') return `suite : ${LIST_AGENTS.app} ; seulement alors, archive-la comme le dit la réponse de l’outil flow ; ${rm}`
    if (session === 'absent') return `suite : ${LIST_AGENTS.absent} ; ${rm}`
    return `suite : rien à arrêter ; ${rm}`
  }
  return STOPPED
}

const main = argv => {
  // Le verdict des branches à supprimer : son propre mode, sa propre dernière ligne (jamais celle d'une fermeture).
  if (argv.includes('--branches')) return mainBranches(argv)
  const isAfterStop = argv.includes('--apres-arret')
  try {
    const out = check(argv)
    console.log(out.reason ? `${out.verdict} : ${out.reason}` : out.verdict)
    for (const line of out.lines) console.log(line)
    console.log(nextStep(out.verdict, isAfterStop, out.session))
    return out.verdict === 'ARRÊT' ? 2 : out.verdict === 'ATTENDRE' ? 3 : 0
  } catch (err) {
    console.log(`ÉCHEC : ${err instanceof ClosingError ? err.message : String(err.message)} ; rien n'est sûr : n'arrête rien, ne retire rien`)
    console.log(nextStep('ÉCHEC', isAfterStop))
    return 1
  }
}

/** Lancé lui-même (pas importé par un test). */
const isMain = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isMain) process.exitCode = main(process.argv.slice(2))
