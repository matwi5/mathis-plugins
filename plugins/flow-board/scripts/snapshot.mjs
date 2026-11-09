#!/usr/bin/env node
// Instantané d'un ticket sensible (point 6 de la section 2 de reference/procedure-groupe.md) : ses
// revues relisent une référence propre au worktree, refs/worktree/flow-board/<ticket>, jamais l'arbre
// de travail, et la branche ne bouge pas. Les cinq étapes en une commande simple, que le garde-fou
// d'un worktree laisse passer (cinq à sept appels du shell par instantané, chaque hash recopié à la main) :
//
//   node <dossier de flow-board>/scripts/snapshot.mjs <id du ticket> <fichier>…
//   node <dossier de flow-board>/scripts/snapshot.mjs --staged <id du ticket> <fichier>…
//   node <dossier de flow-board>/scripts/snapshot.mjs --remplace <fichier> <ancien> <nouveau>
//   node <dossier de flow-board>/scripts/snapshot.mjs --dossier <id du ticket, ou groupe-<id>, securite-<id>>
//   node <dossier de flow-board>/scripts/snapshot.mjs --clean <id du ticket>
//
// à lancer depuis la racine du worktree. La première forme indexe les fichiers du ticket
// (suppressions comprises), vérifie que l'index ne porte rien d'autre, écrit l'arbre et un commit
// hors branche, pose la référence, puis imprime le hash et la plage que lisent les revues.
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
// `--dossier` crée et imprime le dossier du relecteur, `git rev-parse --git-path flow-board/revue-<id>` :
// le seul où un relecteur écrit (copies extraites, notes), propre au worktree, hors de l'arbre suivi
// (la fermeture d'un groupe ne le voit pas) et effacé avec lui ; dans le clone principal, il est
// `.git/flow-board/revue-<id>`, commun à ses discussions et jamais effacé ; des noms génériques de /tmp
// avaient écrasé les copies d'une autre session. Les deux premières formes le créent et l'impriment aussi.
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
// Un id hors forme, un fichier qui commence par « - », un index qui porte un autre fichier ou aucun
// changement : rien n'est posé ni écrit, le message dit pourquoi, code 1 ; un refus venu après
// l'indexation de la première forme (instantané reposé, casse) laisse l'index tel que `git add` l'a fait,
// sans commit ni référence. Sans dépendance hors de Node.

import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, constants, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Un id de ticket qui nomme une référence git : lettres, chiffres, _ et -, sans « - » en tête. */
const SAFE_TICKET = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Un id de ticket que le script accepte : il nomme une référence git et entre dans une commande. */
export const isSafeTicket = value => typeof value === 'string' && SAFE_TICKET.test(value)

export class SnapshotError extends Error {}

/**
 * Crée le dossier du relecteur de `id` (un ticket, `groupe-<id>` ou `securite-<id>`) dans le dossier git
 * du worktree, et rend son chemin absolu ; un dossier déjà là garde ce qu'il porte.
 */
export const reviewDir = (id, cwd = process.cwd()) => {
  if (!isSafeTicket(id)) throw new SnapshotError(`id hors forme : ${JSON.stringify(id)} (lettres, chiffres, _ et -, 64 au plus)`)
  const path = resolve(cwd, git(cwd, ['rev-parse', '--git-path', `flow-board/revue-${id}`]))
  try {
    mkdirSync(path, { recursive: true })
  } catch (err) {
    throw new SnapshotError(`dossier du relecteur impossible à créer : ${path} (${err.code || err.message})`)
  }
  return path
}

/**
 * Le texte que rend une commande git dans `cwd`, sans fin de ligne finale. Les chemins y sont
 * littéraux (`GIT_LITERAL_PATHSPECS`) : ni joker (`*.txt`) ni magie (`:/`) ne les élargit.
 */
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' } }).replace(/\n$/, '')

/**
 * Les chemins indexés (différence entre l'index et HEAD), restreints à `files` s'il est donné ; sans
 * détection des renommages, qui montrerait la suppression d'un autre fichier sous le nom d'un fichier du ticket.
 */
const staged = (cwd, files) => {
  const out = git(cwd, ['diff', '--cached', '--no-renames', '--name-only', '-z', ...(files ? ['--', ...files] : [])])
  return out.split('\0').filter(Boolean)
}

/** Pose l'instantané du ticket ; rend son hash, sa référence et les fichiers qu'il porte. */
export const snapshot = (ticket, files, cwd = process.cwd()) => {
  if (!isSafeTicket(ticket)) throw new SnapshotError(`id de ticket hors forme : ${JSON.stringify(ticket)} (lettres, chiffres, _ et -, 64 au plus)`)
  if (files.length === 0) throw new SnapshotError('aucun fichier : nommer les fichiers du ticket')
  const option = files.find(f => f.startsWith('-'))
  if (option !== undefined) throw new SnapshotError(`fichier qui commence par « - » : ${option}`)
  // Un dossier (« . », « src ») prendrait tout ce qu'il contient, le travail des autres compris.
  const folder = files.find(f => existsSync(join(cwd, f)) && statSync(join(cwd, f)).isDirectory())
  if (folder !== undefined) throw new SnapshotError(`un dossier, pas un fichier : ${folder} ; nommer les fichiers du ticket`)
  git(cwd, ['add', '-A', '--', ...files])
  const ours = staged(cwd, files)
  const others = staged(cwd).filter(path => !ours.includes(path))
  if (others.length > 0) throw new SnapshotError(`l'index porte d'autres fichiers que ceux du ticket : ${others.join(', ')} ; les sortir de l'index (git restore --staged <chemin>), puis relancer`)
  if (ours.length === 0) throw new SnapshotError('aucun changement dans ces fichiers : rien à figer')
  return pose(cwd, ticket, ours)
}

/**
 * Écrit l'arbre de l'index et un commit hors branche, puis pose la référence du ticket. Une référence
 * déjà posée (l'instantané de la passe « bogues ») est rendue dans `previous` : la passe qui la suit
 * relit `previous..commit`, ce qui a changé depuis, pas tout le ticket.
 */
const pose = (cwd, ticket, files) => {
  const ref = `refs/worktree/flow-board/${ticket}`
  // Avant de poser quoi que ce soit (snapshot a déjà indexé les fichiers) : une référence d'un nom voisin
  // par la casse fait refuser (pinned).
  const previous = pinned(cwd, ref)
  // Le dossier ensuite : un échec à le créer ne laisse ni commit ni référence posés.
  const dir = reviewDir(ticket, cwd)
  const tree = git(cwd, ['write-tree'])
  if (previous !== null) {
    // Reposé, l'instantané garde chaque fichier du précédent qui porte encore un changement (dans
    // l'index ou l'arbre, face à HEAD) : --clean ne juge que le dernier, et un correctif d'un fichier
    // perdu ici ne serait plus jamais vérifié. Un fichier sans changement en attente (commité, ou
    // ramené à HEAD par un correctif) peut en sortir.
    const top = topLevel(cwd)
    const now = names(top, ['diff', '--no-renames', '--name-only', '-z', 'HEAD', tree])
    const lost = names(top, ['diff', '--no-renames', '--name-only', '-z', `${previous}^`, previous])
      .filter(f => !now.includes(f) && hasPending(top, f))
    if (lost.length > 0) throw new SnapshotError(`l'instantané précédent de ${ticket} porte aussi ${lost.join(', ')}, que celui-ci ne porte pas et qui a encore un changement non commité : le reposer avec tous les fichiers du ticket (indexés), sinon --clean ne les vérifierait plus ; si ce changement est le travail d'un ticket suivant, ne pas l'indexer : attendre son commit ; rien n'est posé`)
  }
  const commit = git(cwd, ['commit-tree', tree, '-p', 'HEAD', '-m', `flow-board snapshot ${ticket}`])
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
  const all = staged(cwd)
  const others = all.filter(path => !files.includes(path))
  if (others.length > 0) throw new SnapshotError(`l'index porte d'autres fichiers que ceux du correctif : ${others.join(', ')} ; les sortir de l'index (git restore --staged <chemin>), puis relancer`)
  if (all.length === 0) throw new SnapshotError("l'index ne porte aucun changement face à HEAD : rien à figer (indexer d'abord le correctif, par exemple avec --remplace)")
  return pose(cwd, ticket, all)
}

/** La liste que rend une commande git en `-z`. */
const names = (cwd, args) => git(cwd, args).split('\0').filter(Boolean)

/** La racine du worktree : les chemins que rend git en partent, ceux qu'on lui repasse aussi. */
const topLevel = cwd => git(cwd, ['rev-parse', '--show-toplevel'])

/**
 * Vrai si `git diff --quiet <revs> -- <files>` ne voit aucune différence (`revs` : deux commits, `HEAD`
 * seul pour l'arbre de travail, ou `--cached HEAD` pour l'index), présence comprise ; `cwd` est la racine
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

/** Vrai si l'index ou l'arbre de travail portent un changement de `file` face à HEAD (`cwd` : la racine). */
const hasPending = (cwd, file) => !sameFiles(cwd, ['--cached', 'HEAD'], [file]) || !sameFiles(cwd, ['HEAD'], [file])

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
const dirLine = dir => `Dossier du relecteur : ${dir} (propre à ce worktree, hors de l'arbre suivi : le seul où ses relecteurs écrivent).`

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
