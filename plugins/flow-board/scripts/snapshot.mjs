#!/usr/bin/env node
// Instantané d'un ticket sensible (point 6 de la section 2 de reference/procedure-groupe.md) : ses
// revues relisent une référence propre au worktree, refs/worktree/flow-board/<ticket>, jamais l'arbre
// de travail, et la branche ne bouge pas. Les cinq étapes en une commande simple, que le garde-fou
// d'un worktree laisse passer (cinq à sept appels du shell par instantané, chaque hash recopié à la main) :
//
//   node <dossier de flow-board>/scripts/snapshot.mjs <id du ticket> <fichier>…
//
// à lancer depuis la racine du worktree. Indexe les fichiers du ticket (suppressions comprises),
// vérifie que l'index ne porte rien d'autre, écrit l'arbre et un commit hors branche, pose la
// référence, puis imprime le hash et la plage que lisent les revues. Un id hors forme, un fichier
// qui commence par « - », un index qui porte un autre fichier ou aucun changement : rien n'est posé,
// le message dit pourquoi, code 1. Sans dépendance hors de Node.

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Un id de ticket qui nomme une référence git : lettres, chiffres, _ et -, sans « - » en tête. */
const SAFE_TICKET = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** Un id de ticket que le script accepte : il nomme une référence git et entre dans une commande. */
export const isSafeTicket = value => typeof value === 'string' && SAFE_TICKET.test(value)

export class SnapshotError extends Error {}

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
  const tree = git(cwd, ['write-tree'])
  const commit = git(cwd, ['commit-tree', tree, '-p', 'HEAD', '-m', `flow-board snapshot ${ticket}`])
  const ref = `refs/worktree/flow-board/${ticket}`
  git(cwd, ['update-ref', ref, commit])
  return { commit, ref, files: ours }
}

const main = argv => {
  const [ticket, ...files] = argv
  try {
    const { commit, ref, files: kept } = snapshot(ticket, files)
    console.log(`Instantané ${commit} posé sur ${ref} (${kept.length} fichier${kept.length > 1 ? 's' : ''} : ${kept.join(', ')}).`)
    console.log(`Plage des revues : ${ref}^..${ref} ; un fichier se lit par git show ${ref}:<chemin>.`)
    console.log(`Après la revue et le vrai commit du ticket : git update-ref -d ${ref}`)
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
