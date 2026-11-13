#!/usr/bin/env node
// Instantané d'un ticket sensible (point 6 de la section 2 de reference/procedure-groupe.md) : ses
// revues relisent une référence propre au worktree, refs/worktree/flow-board/<ticket>, jamais l'arbre
// de travail, et la branche ne bouge pas. Une commande simple, que le garde-fou d'un worktree laisse
// passer, au lieu de cinq à sept appels du shell par instantané, chaque hash recopié à la main :
//
//   node <dossier de flow-board>/scripts/snapshot.mjs <id du ticket> <fichier>…
//   node <dossier de flow-board>/scripts/snapshot.mjs --staged <id du ticket> <fichier>…
//   node <dossier de flow-board>/scripts/snapshot.mjs --remplace <fichier> <ancien> <nouveau>
//   node <dossier de flow-board>/scripts/snapshot.mjs --dossier <id du ticket, ou groupe-<id>, securite-<id>>
//   node <dossier de flow-board>/scripts/snapshot.mjs --clean <id du ticket>
//
// à lancer depuis la racine du worktree. La première forme construit l'arbre de l'instantané dans un
// index temporaire, sans toucher à celui de la session : parti de HEAD (`git read-tree <HEAD lu une fois>`, sous
// `GIT_INDEX_FILE` pour les seules commandes du script), il reçoit les fichiers nommés à leur version
// de l'arbre de travail (suppressions comprises), puis donne l'arbre (`git write-tree`) ; le script écrit
// alors un commit hors branche, pose la référence, puis imprime le hash et la plage que lisent les
// revues. Ce qu'un autre ticket a indexé ou modifié n'entre pas dans l'instantané et ne le fait pas
// refuser ; rien n'est indexé pour la session, qui indexe elle-même les fichiers du ticket avant son
// commit. HEAD se lit une fois : l'arbre, la liste des fichiers et le parent du commit hors branche
// partent du même commit, même si une autre discussion commite pendant la commande. Reposé, l'instantané
// garde chaque fichier du précédent qui a encore un changement non commité, lu dans l'index de la
// session (sans y écrire) et dans l'arbre de travail, un fichier nouveau et pas encore suivi compris ; un
// fichier nommé se juge sur l'arbre de travail seul, quoi que l'index de la session en garde.
// L'index temporaire vit dans le dossier git du worktree (`git rev-parse --git-path`), sous un
// nom propre au lancement, et il est supprimé à la fin, échec compris ; une commande coupée peut le
// laisser, sans effet : un lancement suivant prend un nom neuf. L'invariant : la pose d'un instantané
// par la première forme ne change ni l'index ni l'arbre de travail de la session ; l'instantané porte
// exactement les fichiers nommés, à leur version de l'arbre de travail, au-dessus de HEAD.
// `--staged` pose l'instantané de l'index tel qu'il est préparé, sans rien indexer, après avoir
// vérifié qu'il ne porte que les fichiers nommés : pour le correctif d'un ticket quand le ticket
// suivant a déjà touché les mêmes fichiers dans l'arbre.
// `--remplace` prépare un tel index : il écrit dans l'index la version indexée du fichier (celle de
// HEAD si rien n'y est indexé) avec ce seul remplacement (l'ancien texte doit y paraître une fois),
// et le reporte dans l'arbre de travail s'il y porte l'ancien texte une fois (s'il porte déjà le
// nouveau, l'arbre ne change pas ; sinon rien n'est écrit), pour qu'un `git add` suivant du fichier
// ne défasse pas le correctif. Il refuse, sans rien écrire, un fichier suivi comme lien (mode 120000
// dans l'index), un fichier ou un de ses dossiers qui est un lien dans l'arbre (seuls les dossiers sous
// le dossier courant, la racine du worktree, se vérifient : `/var` et `/tmp` sont des liens sur macOS),
// et un chemin absolu ou qui sort du dossier courant (seul un chemin relatif à la racine du worktree
// est accepté) ; l'arbre se réécrit sans suivre de lien. Tout refus arrive avant l'index, sauf une
// écriture de l'arbre coupée après coup : l'arbre est remis, et le message dit que l'index porte déjà
// le remplacement. Chaque côté reçoit les textes à ses fins de ligne (LF ou CRLF). Ses textes suivent
// `scripts/patch.py` du dépôt : `@<fichier>` lu
// dans ce fichier sans sa fin de ligne finale, `@@` pour un `@` littéral, `{{u}}` pour un
// échappement « barre oblique inverse et u », `{{uu}}` pour `{{u}}`.
// `--dossier` crée et imprime le dossier du relecteur, le seul où un relecteur écrit (copies extraites,
// notes, script d'essai) : `<CLAUDE_JOB_DIR>/tmp/revue-<id>`, dans le dossier temporaire de la session,
// quand cette variable d'une session de fond désigne un dossier existant (l'outil Write d'un relecteur y
// passe, pas dans le dossier git d'un worktree ; il part avec le dossier de job) ; sinon
// `git rev-parse --git-path flow-board/revue-<id>`, propre au worktree et effacé avec lui (dans le clone
// principal, `.git/flow-board/revue-<id>`, commun à ses discussions et jamais effacé). Hors de l'arbre
// suivi dans les deux cas (la fermeture d'un groupe ne le voit pas). Une variable hors forme (la forme
// que le mod exige d'elle : un chemin absolu, jamais un partage réseau ni la racine d'un disque, sans
// segment `.` ou `..`, apostrophe, guillemet, accent grave, `$`, caractère de contrôle ou invisible ni
// fin de ligne, 300 signes au plus), qui ne désigne pas un dossier existant, dont le dossier ou son `tmp` est
// dans l'arbre de travail (ou dont rien ne montre qu'il en est hors : la racine du worktree ne se lit pas), ou
// dont le `tmp` ou le dossier du relecteur est un lien, un fichier ou ne se laisse pas lire, est ignorée,
// et un avis le dit sur la sortie d'erreur, sans
// recopier sa valeur ; le chemin part du chemin réel du dossier de job, et un lien apparu pendant la
// création fait échouer ; un dossier déjà là garde ce qu'il porte, rien n'est jamais effacé ; des noms
// génériques de /tmp avaient écrasé les copies d'une autre session. Les deux premières formes le créent
// et l'impriment aussi.
// `--clean` supprime la référence du ticket nommé, et elle seule, une fois son vrai commit posé : chaque
// fichier que l'instantané change doit être amené à sa version figée (suppressions comprises) par un
// commit de la première lignée de HEAD depuis le parent de l'instantané qui change ce fichier face à son
// premier parent (`git rev-list --first-parent --no-merges <instantané>^..HEAD -- <fichier>`, ce parent
// lui-même sur la première lignée de HEAD : ni une fusion, ni un commit qui ne fait qu'hériter de la
// version, ni la première lignée d'une autre branche ne comptent), fichier par fichier : un commit plus
// récent (le ticket suivant) peut les avoir changés depuis, et le commit du ticket peut porter d'autres
// fichiers (son fichier de ticket).
// Sinon, tant qu'un fichier de l'instantané a un changement non commité, ou sans référence, rien n'est
// supprimé. L'invariant : une référence d'instantané n'est supprimée que si chaque fichier de
// l'instantané, à sa version figée, se trouve dans un commit de la branche ; jamais celle d'un autre ticket.
// Un id hors forme, un fichier qui commence par « - », un dossier nommé, aucun changement, ou, pour
// `--staged`, un index qui porte un autre fichier : rien n'est posé ni écrit, le message dit pourquoi,
// code 1 ; un refus de la première forme (instantané reposé, casse) ne laisse ni commit ni référence, et
// l'index de la session tel qu'il était. Sans dépendance hors de Node.

import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeSync } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Un id de ticket qui nomme une référence git : lettres, chiffres, _ et -, sans « - » en tête. */
const SAFE_TICKET = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Un id de ticket que le script accepte : il nomme une référence git et entre dans une commande. */
export const isSafeTicket = value => typeof value === 'string' && SAFE_TICKET.test(value)

export class SnapshotError extends Error {}

/** Apostrophes (droite et typographiques ‘ ’ ‚ ‛, par leurs points de code), guillemet, accent grave et `$` : ce qu'un shell ou une ligne de consignes citée lirait. */
const QUOTING = new RegExp(`['"\`$${String.fromCodePoint(0x2018)}-${String.fromCodePoint(0x201b)}]`)

/** Contrôles (C0, DEL, C1), caractères de format et invisibles (marques bidirectionnelles comprises), séparateurs de ligne et de paragraphe. */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u

/**
 * Un dossier de job que le script accepte de `CLAUDE_JOB_DIR`, avant qu'il entre dans un chemin, une ligne
 * imprimée et un fichier de consignes : la forme que le mod exige de la même variable (`tempDirForm` de
 * `hooks/closing.ts`, recopiée ici, ce script n'important rien des hooks) : absolu (POSIX ou lettre de
 * lecteur, jamais un partage réseau), sans apostrophe, guillemet, `$`, accent grave, caractère de contrôle
 * ou invisible, fin de ligne, ni segment `.` ou `..` (le chemin vérifié est celui qui sert), autre que la
 * racine d'un disque, 300 signes au plus.
 */
export const isSafeJobDir = value => {
  // Absolu pour ce système aussi : « C:/x » est relatif sur POSIX, et se résoudrait contre le dossier courant.
  if (typeof value !== 'string' || value.length > 300 || !isAbsolute(value)) return false
  if (QUOTING.test(value) || UNSEEN.test(value)) return false
  const path = value.replace(/\\/g, '/')
  if (!/^(?:\/(?!\/)|[A-Za-z]:\/)/.test(path)) return false
  const trimmed = path.replace(/\/+$/, '')
  if (trimmed === '' || /^[A-Za-z]:$/.test(trimmed)) return false
  return !trimmed.split('/').some((part, i) => part === '.' || part === '..' || (i > 0 && part === ''))
}

const JOB_DIR_FORM = 'un chemin absolu (jamais un partage réseau) de 300 signes au plus, sans segment « . » ou « .. », apostrophe, guillemet, accent grave, « $ », caractère de contrôle ou invisible, ni fin de ligne, autre que la racine d\'un disque'

/** Vrai si `child` est `parent` ou sous lui (deux chemins absolus). */
const isWithin = (parent, child) => {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Le chemin réel de `path`, à la casse du disque (macOS et Windows comparent sans elle), ou null s'il ne se lit pas. */
const diskPath = path => {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

/** La racine du worktree de `cwd`, à la casse du disque, ou null quand git ou le disque ne la donnent pas. */
const worktreeRoot = cwd => {
  try {
    return diskPath(topLevel(cwd))
  } catch {
    return null
  }
}

/**
 * Le dossier temporaire de la session, `<CLAUDE_JOB_DIR>/tmp`, quand cette variable (que Claude Code
 * pose pour une session de fond) désigne un dossier existant, par son chemin réel (liens résolus : le
 * chemin vérifié est celui qui sert). Rend `{ dir }`, ou `{ ignored: <raison> }` pour une variable
 * inutilisable (la raison ne recopie jamais sa valeur, qui peut porter une fin de ligne), ou null sans
 * variable (absente ou vide : une session interactive).
 */
const sessionTmp = (env, cwd) => {
  const value = env.CLAUDE_JOB_DIR
  if (value === undefined || value === '') return null
  if (!isSafeJobDir(value)) return { ignored: `hors forme : ${JOB_DIR_FORM}, est attendu` }
  let real = null
  try {
    if (statSync(value).isDirectory()) real = realpathSync(value)
  } catch {
    // Absent ou illisible : pas un dossier où écrire.
  }
  if (real === null) return { ignored: 'elle ne désigne pas un dossier existant' }
  if (!isSafeJobDir(real)) return { ignored: `le chemin réel de son dossier est hors forme : ${JOB_DIR_FORM}, est attendu` }
  // Sous le worktree, le dossier serait un fichier non suivi de l'arbre de travail, que la fermeture d'un groupe
  // refuse ; de même quand le dossier de job est au-dessus du worktree et que son `tmp` en est la racine ou s'y
  // trouve. Sans racine lue, rien ne montre qu'il en est hors : la variable est ignorée, pas crue.
  const top = worktreeRoot(cwd)
  const realOnDisk = diskPath(real)
  if (top === null || realOnDisk === null) return { ignored: 'la racine du worktree ne se laisse pas lire : rien ne montre que son dossier est hors de l\'arbre de travail' }
  if (isWithin(top, realOnDisk)) return { ignored: 'son dossier est dans l\'arbre de travail' }
  const tmpOnDisk = diskPath(join(real, 'tmp'))
  if (tmpOnDisk !== null && isWithin(top, tmpOnDisk)) return { ignored: 'son dossier tmp est dans l\'arbre de travail' }
  return { dir: join(real, 'tmp') }
}

/** Vrai si `path` existe sans être un vrai dossier (un lien, un fichier), ou ne se laisse pas lire. */
const blocksDir = path => {
  try {
    const info = lstatSync(path, { throwIfNoEntry: false })
    return info !== undefined && !info.isDirectory()
  } catch {
    return true
  }
}

/**
 * Crée le dossier du relecteur de `id` (un ticket, `groupe-<id>` ou `securite-<id>`) et rend son chemin
 * absolu : `<CLAUDE_JOB_DIR>/tmp/revue-<id>`, le dossier temporaire de la session, où l'outil Write d'un
 * relecteur passe, quand la variable désigne un dossier existant hors de l'arbre de travail ; sinon le
 * dossier git du worktree ou du clone (`git rev-parse --git-path flow-board/revue-<id>`). Une variable
 * inutilisable (hors forme, dossier absent ou dans l'arbre de travail, ou dont le `tmp` ou le dossier du
 * relecteur est un lien, un fichier ou ne se laisse pas lire) est ignorée, et un avis le dit sur la sortie
 * d'erreur. Rien n'est créé à travers un lien posé sous le dossier de job : le chemin part du chemin réel
 * de ce dossier (que la variable peut désigner par un lien), et un lien apparu sur `tmp` ou sur le dossier
 * du relecteur entre la vérification et la création fait échouer, le chemin créé étant relu après coup.
 * Un dossier déjà là garde ce qu'il porte : rien n'est jamais effacé ni écrasé.
 */
export const reviewDir = (id, cwd = process.cwd(), env = process.env) => {
  if (!isSafeTicket(id)) throw new SnapshotError(`id hors forme : ${JSON.stringify(id)} (lettres, chiffres, _ et -, 64 au plus)`)
  const name = `revue-${id}`
  const session = sessionTmp(env, cwd)
  let ignored = session?.ignored
  let path = null
  if (session?.dir !== undefined) {
    if (blocksDir(session.dir)) ignored = 'son dossier tmp est un lien, n\'est pas un dossier ou ne se laisse pas lire'
    else if (blocksDir(join(session.dir, name))) ignored = `tmp/${name} y est un lien, n'est pas un dossier ou ne se laisse pas lire`
    else path = join(session.dir, name)
  }
  if (ignored !== undefined) console.error(`Avis : CLAUDE_JOB_DIR ignorée (${ignored}) ; le dossier du relecteur va dans le dossier git (celui du worktree, ou du clone principal).`)
  const inSession = path !== null
  path ??= resolve(cwd, git(cwd, ['rev-parse', '--git-path', `flow-board/${name}`]))
  try {
    mkdirSync(path, { recursive: true })
  } catch (err) {
    throw new SnapshotError(`dossier du relecteur impossible à créer : ${path} (${err.code || err.message})`)
  }
  // Relu après coup : un lien posé sur `tmp` ou sur le dossier entre la vérification et la création mène ailleurs.
  if (inSession) {
    let real = null
    try {
      real = realpathSync(path)
    } catch {
      // Disparu depuis sa création : pas le dossier attendu non plus.
    }
    if (real !== path) throw new SnapshotError(`dossier du relecteur : ${path} n'est pas un vrai dossier sous le dossier temporaire de la session (un lien est apparu sur son chemin pendant sa création) ; le script n'y écrit rien et n'efface rien : à vérifier à la main`)
  }
  return path
}

/**
 * Le texte que rend une commande git dans `cwd`, sans fin de ligne finale. Les chemins y sont
 * littéraux (`GIT_LITERAL_PATHSPECS`) : ni joker (`*.txt`) ni magie (`:/`) ne les élargit. `env` ajoute
 * des variables à cette seule commande (`GIT_INDEX_FILE` : un autre index que celui de la session).
 */
const git = (cwd, args, env = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', ...env } }).replace(/\n$/, '')

/**
 * Les chemins indexés (différence entre l'index et `base`, HEAD par défaut, ou le commit lu une fois
 * pour l'instantané), restreints à `files` s'il est donné ; sans détection des renommages, qui montrerait
 * la suppression d'un autre fichier sous le nom d'un fichier du ticket. `env` : celui d'un index
 * temporaire, sinon l'index de la session.
 */
const staged = (cwd, files, env = {}, base = 'HEAD') => {
  const out = git(cwd, ['diff', '--cached', '--no-renames', '--name-only', '-z', base, ...(files ? ['--', ...files] : [])], env)
  return out.split('\0').filter(Boolean)
}

/**
 * Le commit que désigne HEAD, lu une fois par instantané : l'arbre, la liste de ses fichiers et le parent
 * du commit hors branche partent tous de lui, même si une autre discussion commite entre deux commandes.
 */
const headCommit = cwd => git(cwd, ['rev-parse', '--verify', 'HEAD^{commit}'])

/**
 * Le chemin absolu d'un fichier d'index temporaire, dans le dossier git du worktree, sous un nom propre à
 * ce lancement (le processus et un tirage) : git le crée à sa première écriture, et un lancement suivant
 * ne reprend jamais celui qu'une commande coupée aurait laissé.
 */
const tempIndexPath = cwd => resolve(cwd, git(cwd, ['rev-parse', '--git-path', `flow-board-index-${process.pid}-${randomBytes(8).toString('hex')}`]))

/**
 * Vrai si `path` existe sur le disque, lien compris (un lien cassé existe) ; un chemin dont un dossier
 * est devenu un fichier n'existe pas.
 */
const onDisk = path => {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined
  } catch (err) {
    if (err.code === 'ENOTDIR') return false
    throw new SnapshotError(`${path} : illisible dans l'arbre de travail (${err.code || err.message}) ; rien n'est posé`)
  }
}

/**
 * Pose l'instantané du ticket ; rend son hash, sa référence et les fichiers qu'il porte. L'arbre se
 * construit dans un index temporaire parti de HEAD, où entrent les seuls fichiers nommés, à leur version
 * de l'arbre de travail (suppressions comprises) : l'index de la session n'est ni lu pour l'arbre ni
 * changé, et ce qu'un autre ticket y a indexé n'entre pas dans l'instantané. L'index temporaire est
 * supprimé à la fin, échec compris.
 */
export const snapshot = (ticket, files, cwd = process.cwd()) => {
  if (!isSafeTicket(ticket)) throw new SnapshotError(`id de ticket hors forme : ${JSON.stringify(ticket)} (lettres, chiffres, _ et -, 64 au plus)`)
  if (files.length === 0) throw new SnapshotError('aucun fichier : nommer les fichiers du ticket')
  const option = files.find(f => f.startsWith('-'))
  if (option !== undefined) throw new SnapshotError(`fichier qui commence par « - » : ${option}`)
  // Un dossier (« . », « src ») prendrait tout ce qu'il contient, le travail des autres compris.
  const folder = files.find(f => existsSync(join(cwd, f)) && statSync(join(cwd, f)).isDirectory())
  if (folder !== undefined) throw new SnapshotError(`un dossier, pas un fichier : ${folder} ; nommer les fichiers du ticket`)
  const head = headCommit(cwd)
  const index = tempIndexPath(cwd)
  // Sans index partagé : `core.splitIndex` ferait écrire à git un fichier `sharedindex.*` de plus par lancement.
  const count = Number(process.env.GIT_CONFIG_COUNT) || 0
  const env = { GIT_INDEX_FILE: index, GIT_CONFIG_COUNT: String(count + 1), [`GIT_CONFIG_KEY_${count}`]: 'core.splitIndex', [`GIT_CONFIG_VALUE_${count}`]: 'false' }
  try {
    git(cwd, ['read-tree', head], env)
    git(cwd, ['add', '-A', '--', ...files], env)
    // Parti de HEAD, l'index temporaire ne diffère de lui que par les fichiers nommés.
    const ours = staged(cwd, undefined, env, head)
    if (ours.length === 0) throw new SnapshotError('aucun changement dans ces fichiers : rien à figer')
    const tree = git(cwd, ['write-tree'], env)
    // Ce qui reste à commiter d'un fichier du précédent que cet instantané ne porte pas : un changement
    // que la session a indexé, ou la version de l'arbre de travail, un fichier nouveau et pas encore suivi
    // compris (la session n'indexe plus rien avant son commit : l'index ne le montrerait pas). L'arbre de
    // travail se lit par l'index temporaire, dont l'arbre de l'instantané est déjà écrit. Un fichier nommé se
    // juge sur sa seule version de l'arbre de travail, celle que l'instantané prend : ce que l'index de la
    // session en garde ne le fait pas refuser (le refus demanderait de nommer un fichier déjà nommé).
    const pendingOf = (top, candidates) => {
      const prefix = git(cwd, ['rev-parse', '--show-prefix'])
      const named = new Set(files.map(f => posix.normalize(`${prefix}${sep === '\\' ? f.replace(/\\/g, '/') : f}`)))
      const present = candidates.filter(f => git(top, ['ls-files', '-z', '--', f], env) !== '' || onDisk(join(top, f)))
      // `-f` : un fichier du précédent que .gitignore couvre depuis se juge comme les autres, au lieu d'un échec de git.
      if (present.length > 0) git(top, ['add', '-A', '-f', '--', ...present], env)
      const inTree = present.length > 0 ? staged(top, present, env, head) : []
      return candidates.filter(f => inTree.includes(f) || (!named.has(f) && !sameFiles(top, ['--cached', head], [f])))
    }
    return pose(cwd, ticket, ours, tree, head, { named: true, pendingOf })
  } finally {
    // Le fichier et le verrou qu'une commande git coupée y aurait laissé : rien ne reste dans le dossier
    // git. Un retrait raté (un fichier tenu par un autre processus, sous Windows) se dit sans masquer le
    // résultat : l'instantané posé reste posé, le refus garde son message.
    for (const path of [index, `${index}.lock`]) {
      try {
        rmSync(path, { force: true })
      } catch (err) {
        console.error(`Avis : index temporaire non retiré : ${path} (${err.code || err.message}) ; il ne sert plus à rien et peut être supprimé.`)
      }
    }
  }
}

/**
 * Écrit un commit hors branche de l'arbre `tree`, de parent `head`, puis pose la référence du ticket.
 * Une référence déjà posée (l'instantané de la passe « bogues ») est rendue dans `previous` : la passe
 * qui la suit relit `previous..commit`, ce qui a changé depuis, pas tout le ticket. `named` : l'instantané
 * de la première forme (des fichiers nommés, pris dans l'arbre de travail), pour le libellé du refus ;
 * `pendingOf(racine, fichiers)` rend ceux qui ont encore un changement non commité (par défaut : dans
 * l'index de la session ou l'arbre de travail, face à HEAD).
 */
const pose = (cwd, ticket, files, tree, head, { named = false, pendingOf = (top, candidates) => candidates.filter(f => hasPending(top, f, head)) } = {}) => {
  const ref = `refs/worktree/flow-board/${ticket}`
  // Avant de poser quoi que ce soit : une référence d'un nom voisin par la casse fait refuser (pinned).
  const previous = pinned(cwd, ref)
  // Le dossier ensuite : un échec à le créer ne laisse ni commit ni référence posés.
  const dir = reviewDir(ticket, cwd)
  if (previous !== null) {
    // Reposé, l'instantané garde chaque fichier du précédent qui porte encore un changement (dans
    // l'index ou l'arbre, face à HEAD) : --clean ne juge que le dernier, et un correctif d'un fichier
    // perdu ici ne serait plus jamais vérifié. Un fichier sans changement en attente (commité, ou
    // ramené à HEAD par un correctif) peut en sortir.
    const top = topLevel(cwd)
    const now = names(top, ['diff', '--no-renames', '--name-only', '-z', head, tree])
    const lost = pendingOf(top, names(top, ['diff', '--no-renames', '--name-only', '-z', `${previous}^`, previous]).filter(f => !now.includes(f)))
    if (lost.length > 0) throw new SnapshotError(`l'instantané précédent de ${ticket} porte aussi ${lost.join(', ')}, que celui-ci ne porte pas et qui a encore un changement non commité : le reposer ${named ? 'en nommant tous les fichiers du ticket' : 'avec tous les fichiers du ticket (indexés)'}, sinon --clean ne les vérifierait plus ; si ce changement est le travail d'un ticket suivant, ne pas ${named ? 'le figer' : "l'indexer"} : attendre son commit ; rien n'est posé`)
  }
  const commit = git(cwd, ['commit-tree', tree, '-p', head, '-m', `flow-board snapshot ${ticket}`])
  git(cwd, ['update-ref', ref, commit])
  return { commit, ref, files, previous, dir }
}

/**
 * Pose l'instantané de l'index tel qu'il est préparé, sans rien indexer ; l'index ne doit porter que
 * des `files` (un fichier qu'un autre ticket ou une autre discussion a indexé le fait refuser).
 */
export const snapshotStaged = (ticket, files, cwd = process.cwd()) => {
  if (!isSafeTicket(ticket)) throw new SnapshotError(`id de ticket hors forme : ${JSON.stringify(ticket)} (lettres, chiffres, _ et -, 64 au plus)`)
  if (files.length === 0) throw new SnapshotError('aucun fichier : nommer les fichiers du correctif')
  const option = files.find(f => f.startsWith('-'))
  if (option !== undefined) throw new SnapshotError(`fichier qui commence par « - » : ${option}`)
  const head = headCommit(cwd)
  const all = staged(cwd, undefined, {}, head)
  const others = all.filter(path => !files.includes(path))
  if (others.length > 0) throw new SnapshotError(`l'index porte d'autres fichiers que ceux du correctif : ${others.join(', ')} ; les sortir de l'index (git restore --staged <chemin>), puis relancer`)
  if (all.length === 0) throw new SnapshotError("l'index ne porte aucun changement face à HEAD : rien à figer (indexer d'abord le correctif, par exemple avec --remplace)")
  return pose(cwd, ticket, all, git(cwd, ['write-tree']), head)
}

/** La liste que rend une commande git en `-z`. */
const names = (cwd, args) => git(cwd, args).split('\0').filter(Boolean)

/** La racine du worktree : les chemins que rend git en partent, ceux qu'on lui repasse aussi. */
const topLevel = cwd => git(cwd, ['rev-parse', '--show-toplevel'])

/**
 * Vrai si `git diff --quiet <revs> -- <files>` ne voit aucune différence (`revs` : deux commits, un
 * commit seul (`HEAD`) pour l'arbre de travail, ou `--cached <commit>` pour l'index), présence comprise ; `cwd` est la racine
 * du worktree, car les chemins viennent de git ; une erreur de git se lève.
 */
const sameFiles = (cwd, revs, files) => {
  const out = spawnSync('git', ['diff', '--quiet', '--no-renames', ...revs, '--', ...files], { cwd, stdio: 'ignore', env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' } })
  if (out.status === 0) return true
  if (out.status === 1) return false
  throw new SnapshotError(`git diff ${revs.join(' ')} a échoué (code ${out.status})`)
}

/**
 * Le hash de l'instantané que désigne `ref`, ou null quand la référence n'existe pas sous ce nom exact :
 * sur un disque insensible à la casse, `t24` lirait sinon le fichier de la référence de `T24`.
 */
const pinned = (cwd, ref) => {
  const listed = git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/worktree/flow-board/']).split('\n').filter(Boolean)
  // Une référence qui ne diffère que par la casse est le même fichier sur un disque insensible à la
  // casse : la poser ou la supprimer sous l'autre nom toucherait celle d'un autre ticket.
  const clash = listed.find(r => r !== ref && r.toLowerCase() === ref.toLowerCase())
  if (clash !== undefined) throw new SnapshotError(`une autre référence ne diffère de ${ref} que par la casse : ${clash} ; nommer le ticket par l'id exact de sa référence ; rien n'est posé ni supprimé`)
  return listed.includes(ref) ? git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]) : null
}

/**
 * Vrai si l'index ou l'arbre de travail portent un changement de `file` face à `base` (HEAD, ou le commit
 * lu une fois pour l'instantané ; `cwd` : la racine).
 * Face à l'arbre de travail, `git diff` peut réécrire l'index de la session pour y rafraîchir la date
 * d'un fichier au contenu inchangé : la première forme de l'instantané, qui ne doit pas y toucher, ne
 * passe pas par ici (elle lit l'arbre de travail par son index temporaire).
 */
const hasPending = (cwd, file, base = 'HEAD') => !sameFiles(cwd, ['--cached', base], [file]) || !sameFiles(cwd, [base], [file])

/**
 * Supprime la référence d'instantané de `ticket`, seulement si chaque fichier que l'instantané change est
 * amené à sa version figée par un commit de la première lignée de HEAD, hors fusions, qui change ce fichier
 * (pas forcément le même pour tous), le parent de l'instantané étant lui-même sur cette lignée ; rend la
 * référence, l'instantané, et pour chaque fichier le premier commit qui l'y amène.
 */
export const clean = (ticket, cwd = process.cwd()) => {
  if (!isSafeTicket(ticket)) throw new SnapshotError(`id de ticket hors forme : ${JSON.stringify(ticket)} (lettres, chiffres, _ et -, 64 au plus)`)
  // Tout se lit depuis la racine : les chemins que rend git en partent (d'un sous-dossier, ils ne
  // désigneraient rien, et le premier commit venu passerait pour celui du ticket).
  const top = topLevel(cwd)
  const ref = `refs/worktree/flow-board/${ticket}`
  const snap = pinned(top, ref)
  if (snap === null) throw new SnapshotError(`aucune référence d'instantané pour ${ticket} (${ref}) : rien à supprimer`)
  const files = names(top, ['diff', '--no-renames', '--name-only', '-z', `${snap}^`, snap])
  if (files.length === 0) throw new SnapshotError(`l'instantané ${snap} ne change aucun fichier : rien ne montre que son ticket est commité ; la référence reste`)
  // Un correctif encore dans l'index ou l'arbre n'est pas commité : le commit égal à l'instantané ne suffit pas.
  const pending = files.filter(f => hasPending(top, f))
  if (pending.length > 0) throw new SnapshotError(`l'index ou l'arbre de travail portent encore un changement de ${pending.join(', ')} face à HEAD : un correctif du ticket pas encore commité (reposer son instantané sur la version à commiter, puis commiter), ou le travail d'un ticket suivant dans ces fichiers (relancer --clean après son commit, sans reposer l'instantané, qui l'y ferait entrer) ; la référence ${ref} (${snap}) reste`)
  // Seule la première lignée de HEAD depuis le parent de l'instantané, sans ses fusions, et pour chaque
  // fichier les seuls commits qui le changent : un commit d'une autre branche (où un fichier supprimé par le
  // ticket n'a jamais existé), la fusion qui l'apporte ou un commit qui ne fait qu'hériter de la version ne
  // passent pas pour celui du ticket.
  if (spawnSync('git', ['merge-base', '--is-ancestor', `${snap}^`, 'HEAD'], { cwd: top, stdio: 'ignore' }).status !== 0) throw new SnapshotError(`le parent de l'instantané ${snap} n'est pas un ancêtre de HEAD (branche réécrite ou changée) : rien ne montre que le ticket y est commité ; la référence ${ref} reste`)
  // Le parent de l'instantané sur la première lignée de HEAD : sinon (une avance rapide sur une fusion, la
  // branche du ticket entrée par un second parent), cette lignée est celle d'une autre branche, dont un commit
  // passerait pour celui du ticket. Le plus ancien commit de la lignée depuis ce parent doit l'avoir pour
  // premier parent.
  const parent = git(top, ['rev-parse', '--verify', `${snap}^{commit}^`])
  const lineage = names(top, ['rev-list', '--first-parent', '-z', `${parent}..HEAD`])
  if (lineage.length > 0 && git(top, ['rev-parse', '--verify', `${lineage.at(-1)}^`]) !== parent) throw new SnapshotError(`le parent de l'instantané ${snap} n'est pas sur la première lignée de HEAD (une avance rapide sur une fusion, ou la branche du ticket entrée par un second parent) : les commits de cette lignée ne sont pas ceux du ticket ; vérifier à la main que le commit du ticket porte chaque fichier à sa version figée, puis le dire au manager ; la référence ${ref} reste`)
  // Fichier par fichier, du plus ancien au plus récent : le premier commit qui amène le fichier à sa version
  // figée (le commit du ticket), même si un commit plus récent l'a changé depuis.
  const found = new Map()
  for (const f of files) {
    const commits = names(top, ['rev-list', '--first-parent', '--no-merges', '--reverse', '-z', `${snap}^..HEAD`, '--', f])
    const c = commits.find(c => sameFiles(top, [c, snap], [f]))
    if (c !== undefined) found.set(f, c)
  }
  const left = files.filter(f => !found.has(f))
  if (left.length > 0) throw new SnapshotError(`fichiers de l'instantané sans commit qui les porte à leur version figée : ${left.join(', ')} (aucun commit de la première lignée depuis ${snap.slice(0, 12)}^ ne les y amène, fusions exclues) ; soit le ticket n'est pas encore commité, soit il l'est avec un fichier changé après l'instantané (sa ligne Status:, un correctif) sans l'avoir reposé avant le commit : le dire au manager ; la référence ${ref} (${snap}) reste`)
  // Supprimée seulement si elle désigne encore l'instantané vérifié : une référence déplacée entre-temps reste.
  git(top, ['update-ref', '--no-deref', '-d', ref, snap])
  // Relue après coup : seule une référence qui désigne encore l'instantané vérifié est un échec (une
  // pose venue entre-temps en a posé une autre).
  if (pinned(top, ref) === snap) throw new SnapshotError(`la référence ${ref} désigne toujours l'instantané ${snap} après sa suppression`)
  return { ref, snap, commits: Object.fromEntries(found), files }
}

const BACKSLASH = String.fromCharCode(92)
const U_MARKER = /\{\{(u+)\}\}/g

/** Un texte de `--remplace` : lu dans un fichier après `@` (sans sa fin de ligne finale), `@@` pour un `@` littéral, marqueur `{{u}}` remplacé. */
const textArg = (value, cwd) => {
  let text = value
  if (value.startsWith('@@')) text = value.slice(1)
  else if (value.startsWith('@')) {
    const path = resolve(cwd, value.slice(1))
    if (!existsSync(path) || !statSync(path).isFile()) throw new SnapshotError(`fichier de texte introuvable : ${value.slice(1)}`)
    text = readFileSync(path, 'utf8').replace(/\r?\n$/, '')
  }
  return text.replace(U_MARKER, (_, us) => (us === 'u' ? `${BACKSLASH}u` : `{{${us.slice(1)}}}`))
}

const count = (text, part) => text.split(part).length - 1

/** Un texte aux fins de ligne de `target` : CRLF si `target` en porte, sinon LF. */
const endings = (target, text) => {
  const plain = text.replace(/\r\n/g, '\n')
  return target.includes('\r\n') ? plain.replace(/\n/g, '\r\n') : plain
}

/**
 * Refuse `file` (relatif à `cwd`) quand lui-même ou un de ses dossiers sous `cwd` est un lien
 * symbolique : l'écriture suivrait le lien, peut-être hors du dépôt. Les dossiers au-dessus de `cwd`
 * ne comptent pas (`/var` et `/tmp` sont des liens sur macOS). Un préfixe absent arrête la vérification
 * (l'absence se dit plus loin) ; une autre erreur de lecture est un refus.
 */
const refuseLinks = (file, rel, cwd) => {
  const parts = rel.split(sep)
  for (let i = 1; i <= parts.length; i++) {
    const prefix = parts.slice(0, i).join(sep)
    let info
    try {
      info = lstatSync(join(cwd, prefix))
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return
      throw new SnapshotError(`${file} : chemin illisible dans l'arbre de travail (${prefix} : ${err.code || err.message}) ; rien n'est écrit`)
    }
    if (info.isSymbolicLink()) throw new SnapshotError(`${file} : lien symbolique dans l'arbre de travail (${prefix.split(sep).join('/')}) ; --remplace n'écrit jamais à travers un lien, rien n'est écrit`)
  }
}

const NOFOLLOW = constants.O_NOFOLLOW ?? 0

/**
 * Ouvre `path` (`flags` : lecture ou écriture), sans le créer ni suivre un lien (`O_NOFOLLOW` là où le
 * système l'a), et rend son descripteur et ce qu'il désigne ; `seen` donné, refuse un fichier qui n'est
 * plus celui lu (même appareil, même inode) : un dossier du chemin remplacé par un lien depuis la
 * lecture, que `O_NOFOLLOW` ne voit pas, mène à un autre fichier. Absent ou pas un fichier ordinaire :
 * le refus « absent de l'arbre de travail ».
 */
const openTree = (file, path, flags, seen) => {
  let fd
  try {
    fd = openSync(path, flags | NOFOLLOW)
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.code === 'EISDIR') throw new SnapshotError(`${file} : absent de l'arbre de travail ; rien n'est écrit`)
    throw new SnapshotError(`${file} : arbre de travail impossible à ouvrir sans suivre de lien (${err.code || err.message}) ; rien n'est écrit`)
  }
  try {
    const info = fstatSync(fd)
    if (!info.isFile()) throw new SnapshotError(`${file} : absent de l'arbre de travail ; rien n'est écrit`)
    if (seen && (info.dev !== seen.dev || info.ino !== seen.ino)) throw new SnapshotError(`${file} : le fichier de l'arbre de travail a changé depuis sa lecture (lien ou remplacement) ; rien n'est écrit`)
    return { fd, info }
  } catch (err) {
    closeSync(fd)
    if (err instanceof SnapshotError) throw err
    throw new SnapshotError(`${file} : arbre de travail illisible (${err.code || err.message}) ; rien n'est écrit`)
  }
}

/** Écrit `bytes` dans `fd` depuis le début, en entier, puis coupe le fichier à leur longueur. */
const writeAt = (fd, bytes) => {
  let done = 0
  while (done < bytes.length) {
    const wrote = writeSync(fd, bytes, done, bytes.length - done, done)
    if (wrote <= 0) throw new Error('écriture nulle')
    done += wrote
  }
  ftruncateSync(fd, bytes.length)
}

/**
 * Réécrit le fichier ouvert `fd` avec `text` ; une écriture coupée remet ses octets d'avant
 * (`before`), et le message dit que l'index porte déjà le remplacement.
 */
const rewrite = (file, fd, text, before) => {
  try {
    writeAt(fd, Buffer.from(text, 'utf8'))
  } catch (err) {
    let restored = true
    try {
      writeAt(fd, before)
    } catch {
      restored = false
    }
    throw new SnapshotError(`${file} : l'index porte le remplacement, mais son report dans l'arbre de travail a échoué (${err.code || err.message}) ; arbre ${restored ? 'remis tel qu\'il était' : 'NON REMIS : à vérifier'} ; reporter le remplacement dans l'arbre avant tout git add du fichier`)
  }
}

/**
 * Écrit dans l'index la version indexée de `file` avec le seul remplacement de `oldArg` par `newArg`,
 * et le reporte dans l'arbre de travail ; tout est vérifié avant la première écriture. Un lien
 * (dans l'index, ou dans l'arbre sous `cwd`, le fichier ou un de ses dossiers) est refusé.
 */
export const replaceStaged = (file, oldArg, newArg, cwd = process.cwd()) => {
  if (typeof file !== 'string' || file === '' || file.startsWith('-')) throw new SnapshotError(`fichier hors forme : ${JSON.stringify(file)}`)
  const rel = relative(cwd, resolve(cwd, file))
  if (isAbsolute(file) || rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new SnapshotError(`${file} : hors du dossier courant (un chemin relatif à la racine du worktree est attendu) ; rien n'est écrit`)
  const oldText = textArg(oldArg, cwd)
  const newText = textArg(newArg, cwd)
  if (oldText === '') throw new SnapshotError('ancien texte vide')
  // git reçoit le chemin vérifié, à barres obliques : la même orthographe que les contrôles de l'arbre.
  const gitPath = rel.split(sep).join('/')
  const entry = git(cwd, ['ls-files', '-s', '--', gitPath])
  const m = /^(\d+) ([0-9a-f]+) (\d)\t/.exec(entry)
  if (!m || entry.includes('\n')) throw new SnapshotError(`${file} : absent de l'index (ou en conflit), rien à remplacer`)
  if (m[3] !== '0') throw new SnapshotError(`${file} : en conflit dans l'index`)
  if (m[1] === '120000') throw new SnapshotError(`${file} : suivi comme lien symbolique dans l'index (mode 120000) ; --remplace n'écrit jamais à travers un lien, rien n'est écrit`)
  refuseLinks(file, rel, cwd)
  const indexed = execFileSync('git', ['cat-file', 'blob', m[2]], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  // Chaque côté prend les textes à ses propres fins de ligne : l'index en LF, l'arbre en CRLF sous Windows.
  const oldIndex = endings(indexed, oldText)
  const found = count(indexed, oldIndex)
  if (found !== 1) throw new SnapshotError(`${file} : l'ancien texte paraît ${found} fois dans la version indexée, il doit paraître exactement une fois ; rien n'est écrit`)
  const line = count(indexed.slice(0, indexed.indexOf(oldIndex)), '\n') + 1
  const path = join(cwd, rel)
  // Lu par le descripteur vérifié : le texte vient du fichier dont l'inode se compare à l'écriture.
  // Sans blocage : un tube nommé à ce chemin n'arrête pas la commande (il est refusé ensuite).
  const reader = openTree(file, path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
  let bytes
  try {
    bytes = readFileSync(reader.fd)
  } finally {
    closeSync(reader.fd)
  }
  const seen = reader.info
  const worktree = bytes.toString('utf8')
  const oldTree = endings(worktree, oldText)
  const newTree = endings(worktree, newText)
  // L'ancien texte présent une fois se remplace, sauf quand il n'est que la partie d'un nouveau texte
  // déjà là ; sinon un arbre qui porte déjà le nouveau texte ne change pas.
  const carriesNew = newTree === '' ? count(worktree, oldTree) === 0 : worktree.includes(newTree)
  let tree
  if (count(worktree, oldTree) === 1 && !(newTree.includes(oldTree) && carriesNew)) tree = 'remplacé'
  else if (carriesNew) tree = 'porte déjà le nouveau texte'
  else throw new SnapshotError(`${file} : l'arbre de travail ne porte ni l'ancien texte une fois, ni le nouveau (il paraît ${count(worktree, oldTree)} fois) ; rien n'est écrit`)
  // Revérifié et ouvert avant la première écriture : un lien posé depuis la lecture ne reçoit rien,
  // et un refus laisse l'index, les objets et l'arbre tels quels.
  refuseLinks(file, rel, cwd)
  // Sans blocage : un tube nommé posé depuis la lecture est refusé au lieu d'arrêter la commande.
  const fd = tree === 'remplacé' ? openTree(file, path, constants.O_WRONLY | (constants.O_NONBLOCK ?? 0), seen).fd : null
  try {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd, input: indexed.replace(oldIndex, () => endings(indexed, newText)), encoding: 'utf8' }).trim()
    git(cwd, ['update-index', '--cacheinfo', `${m[1]},${blob},${gitPath}`])
    if (fd !== null) rewrite(file, fd, worktree.replace(oldTree, () => newTree), bytes)
  } finally {
    if (fd !== null) closeSync(fd)
  }
  return { file, line, tree }
}

/** Le chemin de ce script, pour des commandes imprimées qui se lancent telles quelles. */
const SELF = `'${fileURLToPath(import.meta.url).replace(/'/g, `'\\''`)}'`

/** La ligne qui donne le dossier du relecteur, à recopier dans son fichier de consignes et son prompt. */
const dirLine = dir => `Dossier du relecteur : ${dir} (hors de l'arbre suivi : le seul où ses relecteurs écrivent).`

const main = argv => {
  try {
    if (argv[0] === '--clean') {
      if (argv.length !== 2) throw new SnapshotError('--clean <id du ticket>')
      const { ref, snap, commits, files } = clean(argv[1])
      const by = [...new Set(Object.values(commits))]
      console.log(`Référence ${ref} supprimée (instantané ${snap}) : ${by.length > 1 ? `les commits ${by.join(', ')} de la branche portent` : `le commit ${by[0]} de la branche porte`} ${files.length > 1 ? `les ${files.length} fichiers` : 'le fichier'} de l'instantané à leur version figée.`)
      return 0
    }
    if (argv[0] === '--dossier') {
      if (argv.length !== 2) throw new SnapshotError('--dossier <id du ticket, ou groupe-<id>, securite-<id>>')
      console.log(dirLine(reviewDir(argv[1])))
      return 0
    }
    if (argv[0] === '--remplace') {
      if (argv.length !== 4) throw new SnapshotError('--remplace <fichier> <ancien> <nouveau>')
      const { file, line, tree } = replaceStaged(argv[1], argv[2], argv[3])
      console.log(`${file} : remplacement indexé (ligne ${line}) ; arbre de travail : ${tree}.`)
      console.log(`Instantané de cet index : node ${SELF} --staged <id du ticket> <fichiers du correctif>.`)
      return 0
    }
    const isStaged = argv[0] === '--staged'
    const [ticket, ...files] = isStaged ? argv.slice(1) : argv
    const { commit, ref, files: kept, previous, dir } = isStaged ? snapshotStaged(ticket, files) : snapshot(ticket, files)
    console.log(`Instantané ${commit} posé sur ${ref} (${kept.length} fichier${kept.length > 1 ? 's' : ''} : ${kept.join(', ')}).`)
    if (previous) console.log(`Instantané reposé : plage ${previous}..${commit} depuis le précédent, pour information ; la seule passe après la passe « bogues » relit <hash du premier instantané>..${commit}, une seule fois ; un fichier se lit par git show ${ref}:<chemin>.`)
    else console.log(`Plage des revues : ${ref}^..${ref} ; un fichier se lit par git show ${ref}:<chemin>.`)
    console.log(`Avant le vrai commit du ticket, si un de ses fichiers a changé depuis (sa ligne Status:, un correctif) : reposer l'instantané par la même commande ; après le commit : node ${SELF} --clean ${ticket}`)
    console.log(dirLine(dir))
    return 0
  } catch (err) {
    const detail = err instanceof SnapshotError ? err.message : `git a échoué : ${String(err.stderr || err.message).trim()}`
    console.error(`ÉCHEC : ${detail}`)
    return 1
  }
}

/** Lancé lui-même (pas importé par un test) : chemins comparés résolus, car Node résout un lien symbolique pour le module, pas pour argv. */
const isMain = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isMain) process.exitCode = main(process.argv.slice(2))
