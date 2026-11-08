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
//   ATTENDRE : …  la session travaille : remettre la fermeture à plus tard (code 3)
//   ARRÊT : …     quelque chose n'est pas sûr : ne rien arrêter ni retirer, le dire (code 2)
//   ÉCHEC : …     argument hors forme, git ou claude en échec : rien n'est sûr (code 1)
//
// L'invariant : une fermeture ne fait jamais perdre un commit, un fichier modifié ou non suivi, ni la
// conversation d'un worker ; un worktree ne se retire que si sa branche est entièrement contenue dans la
// branche de travail et que son arbre ne contient rien d'autre que des fichiers de la liste jetable, vérifié
// de nouveau après l'arrêt de la session (--apres-arret) ; la branche n'est jamais supprimée ; une session
// qui travaille encore n'est jamais arrêtée. Un verdict ne vaut que pour l'instant où il est rendu.
// Sans dépendance hors de Node. `FLOW_BOARD_CLAUDE` désigne un autre exécutable `claude` (les tests).

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export class ClosingError extends Error {}

/** Un verdict qui arrête la fermeture, avec sa raison ; `wait` : la session travaille, à reprendre plus tard. */
class Stop extends Error {
  constructor(message, kind = 'arret') {
    super(message)
    this.kind = kind
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
 * Le verrou d'un worktree que le script peut lever : posé par une session de claude (« claude session <nom>
 * (pid <pid> … », quel que soit son nom), son processus disparu. Rend le pid, ou null pour tout autre verrou.
 */
export const staleSessionLock = (reason, isAlive) => {
  const m = /^claude session .* \(pid (\d{1,10})\b/.exec(reason)
  if (!m) return null
  return isAlive(Number(m[1])) ? null : m[1]
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
  const lines = []
  try {
    return verdict(args, cwd, lines)
  } catch (err) {
    if (err instanceof Stop) return { verdict: err.kind === 'wait' ? 'ATTENDRE' : 'ARRÊT', reason: err.message, lines }
    throw err
  }
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
  checkFsmonitor(worktree, 'sur le worktree')
  lines.push(`derniers commits de ${block.branch} (à reconnaître comme ceux du worker) :`, ...git(cwd, ['log', `refs/heads/${block.branch}`, '--oneline', '-10']).split('\n').map(l => `  ${l}`))
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
