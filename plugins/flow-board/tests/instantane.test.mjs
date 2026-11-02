// Le script d'instantané d'un ticket sensible (scripts/snapshot.mjs) : la procédure d'une session
// liée de groupe le désigne (point 6), à la place de cinq commandes tapées une à une. Ces tests le
// lancent pour de vrai, dans un dépôt git temporaire.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isSafeTicket } from '../scripts/snapshot.mjs'
import { CORPUS } from './corpus.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/snapshot.mjs', import.meta.url))
const procedure = readFileSync(new URL('../reference/procedure-groupe.md', import.meta.url), 'utf8')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** Un dépôt neuf avec deux fichiers commités. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'instantane-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.name', 'essai')
  git(dir, 'config', 'user.email', 'essai@localhost')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  writeFileSync(join(dir, 'b.txt'), 'b\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'base')
  return dir
}

const snap = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' })
const hasRef = (cwd, ref) => spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd }).status === 0

test('l’instantané fige les seuls fichiers du ticket sur sa référence, sans bouger la branche', () => {
  const dir = repo()
  try {
    const head = git(dir, 'rev-parse', 'HEAD')
    writeFileSync(join(dir, 'a.txt'), 'a modifié\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket suivant\n')
    writeFileSync(join(dir, 'c.txt'), 'nouveau\n')
    const out = snap(dir, 'T07', 'a.txt', 'c.txt')
    assert.equal(out.status, 0, out.stderr)
    const ref = 'refs/worktree/flow-board/T07'
    const commit = git(dir, 'rev-parse', ref)
    assert.match(out.stdout, new RegExp(`Instantané ${commit} posé sur ${ref} \\(2 fichiers : a.txt, c.txt\\)`))
    assert.match(out.stdout, /Plage des revues : refs\/worktree\/flow-board\/T07\^\.\.refs\/worktree\/flow-board\/T07/)
    // La branche n'a pas bougé ; l'instantané part de HEAD et ne porte que le ticket.
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head)
    assert.equal(git(dir, 'rev-parse', `${ref}^`), head)
    assert.equal(git(dir, 'show', `${ref}:a.txt`), 'a modifié')
    assert.equal(git(dir, 'show', `${ref}:b.txt`), 'b')
    assert.equal(git(dir, 'diff', '--name-only', `${ref}^..${ref}`), 'a.txt\nc.txt')
    assert.equal(git(dir, 'log', '-1', '--format=%s', ref), 'flow-board snapshot T07')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un second instantané du même ticket donne la plage de la passe qui suit la passe « bogues »', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    assert.equal(snap(dir, 'T08', 'a.txt').status, 0)
    const first = git(dir, 'rev-parse', 'refs/worktree/flow-board/T08')
    // Les correctifs de la passe « bogues » : l'instantané se repose, et la sortie donne first..second.
    writeFileSync(join(dir, 'a.txt'), 'a du ticket corrigé\n')
    const out = snap(dir, 'T08', 'a.txt')
    assert.equal(out.status, 0, out.stderr)
    const second = git(dir, 'rev-parse', 'refs/worktree/flow-board/T08')
    assert.notEqual(second, first)
    assert.match(out.stdout, new RegExp(`Instantané reposé : plage ${first}\\.\\.${second} depuis le précédent`))
    assert.doesNotMatch(out.stdout, /Plage des revues/)
    assert.equal(git(dir, 'diff', '--name-only', `${first}..${second}`), 'a.txt')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('une suppression du ticket entre dans l’instantané', () => {
  const dir = repo()
  try {
    unlinkSync(join(dir, 'a.txt'))
    const out = snap(dir, 'T08', 'a.txt')
    assert.equal(out.status, 0, out.stderr)
    assert.equal(git(dir, 'diff', '--name-status', 'refs/worktree/flow-board/T08^..refs/worktree/flow-board/T08'), 'D\ta.txt')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rien n’est posé quand l’index porte un autre fichier, sans changement, ou pour un id ou un fichier hors forme', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a modifié\n')
    writeFileSync(join(dir, 'b.txt'), 'b indexé par un autre\n')
    git(dir, 'add', 'b.txt')
    const other = snap(dir, 'T09', 'a.txt')
    assert.equal(other.status, 1)
    assert.match(other.stderr, /ÉCHEC : l'index porte d'autres fichiers que ceux du ticket : b\.txt/)
    assert.equal(hasRef(dir, 'refs/worktree/flow-board/T09'), false)
    git(dir, 'reset', '-q', '--hard')
    const none = snap(dir, 'T10', 'a.txt')
    assert.equal(none.status, 1)
    assert.match(none.stderr, /aucun changement dans ces fichiers/)
    for (const [ticket, file] of [['../x', 'a.txt'], ['-d', 'a.txt'], ['T 1', 'a.txt'], ['T11', '-p'], ['', 'a.txt']]) {
      const bad = snap(dir, ticket, file)
      assert.equal(bad.status, 1, `${ticket} ${file}`)
      assert.match(bad.stderr, /^ÉCHEC : /)
    }
    assert.equal(git(dir, 'for-each-ref', 'refs/worktree/'), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un joker, une magie de chemin ou un dossier ne prennent jamais le travail des autres', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a modifié\n')
    writeFileSync(join(dir, 'b.txt'), 'b d’une autre discussion\n')
    for (const pattern of ['*.txt', ':/', '.']) {
      const out = snap(dir, 'T12', pattern)
      assert.equal(out.status, 1, pattern)
      assert.equal(hasRef(dir, 'refs/worktree/flow-board/T12'), false, pattern)
    }
    // Rien de b.txt n'a été indexé par ces essais.
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('une suppression indexée par un autre ne se cache pas derrière un renommage vers un fichier du ticket', () => {
  const dir = repo()
  try {
    const long = 'une ligne assez longue pour que git y voie un renommage\n'.repeat(20)
    writeFileSync(join(dir, 'o.txt'), long)
    git(dir, 'add', 'o.txt')
    git(dir, 'commit', '-q', '-m', 'o')
    git(dir, 'rm', '-q', 'o.txt')
    writeFileSync(join(dir, 'n.txt'), long)
    const out = snap(dir, 'T13', 'n.txt')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /l'index porte d'autres fichiers que ceux du ticket : o\.txt/)
    assert.equal(hasRef(dir, 'refs/worktree/flow-board/T13'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('l’id du ticket passe le corpus hostile commun : chaque entrée le fait refuser', () => {
  assert.equal(isSafeTicket('T07'), true)
  const passing = Object.entries(CORPUS).filter(([, token]) => isSafeTicket(`T${token}7`)).map(([name]) => name)
  assert.deepEqual(passing, [])
})

test('un dossier du relecteur impossible à créer : ni instantané ni référence posés, et le message le dit', () => {
  const dir = repo()
  try {
    // Un fichier « flow-board » dans le dossier git empêche d'y créer le dossier.
    writeFileSync(join(dir, '.git', 'flow-board'), 'pas un dossier\n')
    writeFileSync(join(dir, 'a.txt'), 'a modifié\n')
    const out = snap(dir, 'T09', 'a.txt')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /ÉCHEC : dossier du relecteur impossible à créer/)
    assert.ok(!hasRef(dir, 'refs/worktree/flow-board/T09'), 'la référence a été posée')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('lancé par un lien symbolique, le script tourne quand même (il ne sort pas en silence)', () => {
  const dir = repo()
  try {
    const link = join(dir, 'lien-snapshot.mjs')
    symlinkSync(SCRIPT, link)
    writeFileSync(join(dir, 'a.txt'), 'a modifié\n')
    const out = spawnSync(process.execPath, [link, 'T14', 'a.txt'], { cwd: dir, encoding: 'utf8' })
    assert.equal(out.status, 0, out.stderr)
    assert.match(out.stdout, /Instantané [0-9a-f]+ posé sur refs\/worktree\/flow-board\/T14/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('la procédure désigne le script d’instantané', () => {
  assert.ok(procedure.includes('node <dossier de flow-board>/scripts/snapshot.mjs <id du ticket> <les fichiers du ticket, par chemin>'), 'la procédure ne cite pas le script')
})

test('--staged fige l’index tel qu’il est préparé, sans rien indexer ni toucher à l’arbre de travail', () => {
  const dir = repo()
  try {
    const head = git(dir, 'rev-parse', 'HEAD')
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    git(dir, 'add', 'a.txt')
    // Le ticket suivant a déjà touché a.txt et b.txt dans l'arbre : rien de cela n'entre.
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\nsuite du ticket suivant\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket suivant\n')
    const out = snap(dir, '--staged', 'T15', 'a.txt')
    assert.equal(out.status, 0, out.stderr)
    const ref = 'refs/worktree/flow-board/T15'
    assert.match(out.stdout, /Instantané [0-9a-f]+ posé sur refs\/worktree\/flow-board\/T15 \(1 fichier : a\.txt\)/)
    assert.equal(git(dir, 'rev-parse', `${ref}^`), head)
    assert.equal(git(dir, 'show', `${ref}:a.txt`), 'a du ticket')
    assert.equal(git(dir, 'show', `${ref}:b.txt`), 'b')
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'a du ticket\nsuite du ticket suivant\n')
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), 'a.txt')
    assert.equal(git(dir, 'rev-parse', 'HEAD'), head)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--staged refuse un index vide, un index qui porte un autre fichier, un id ou un fichier hors forme', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a modifié\n')
    const empty = snap(dir, '--staged', 'T16', 'a.txt')
    assert.equal(empty.status, 1)
    assert.match(empty.stderr, /ÉCHEC : l'index ne porte aucun changement/)
    git(dir, 'add', 'a.txt')
    // Le ticket suivant a indexé un nouveau fichier : il ne part pas avec le correctif.
    writeFileSync(join(dir, 'c.txt'), 'nouveau du ticket suivant\n')
    git(dir, 'add', 'c.txt')
    const other = snap(dir, '--staged', 'T16', 'a.txt')
    assert.equal(other.status, 1)
    assert.match(other.stderr, /l'index porte d'autres fichiers que ceux du correctif : c\.txt/)
    git(dir, 'restore', '--staged', 'c.txt')
    for (const args of [['--staged', '../x', 'a.txt'], ['--staged', 'T16'], ['--staged', 'T16', '-p'], ['--staged']]) {
      const bad = snap(dir, ...args)
      assert.equal(bad.status, 1, args.join(' '))
      assert.match(bad.stderr, /^ÉCHEC : /)
    }
    assert.equal(git(dir, 'for-each-ref', 'refs/worktree/'), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--remplace indexe le seul correctif sur la version indexée, et le reporte dans l’arbre de travail', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'un\ndeux\ntrois\n')
    git(dir, 'add', 'a.txt')
    git(dir, 'commit', '-q', '-m', 'a')
    // Le ticket suivant a déjà modifié a.txt dans l'arbre.
    writeFileSync(join(dir, 'a.txt'), 'un\ndeux\ntrois\nquatre du ticket suivant\n')
    const out = snap(dir, '--remplace', 'a.txt', 'deux', 'DEUX')
    assert.equal(out.status, 0, out.stderr)
    assert.match(out.stdout, /a\.txt : remplacement indexé \(ligne 2\) ; arbre de travail : remplacé/)
    assert.equal(git(dir, 'show', ':a.txt'), 'un\nDEUX\ntrois')
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'un\nDEUX\ntrois\nquatre du ticket suivant\n')
    // Un second remplacement part de la version indexée, qui garde le premier ; un @fichier perd sa fin de ligne finale.
    writeFileSync(join(dir, 'ancien'), 'trois\n')
    const second = snap(dir, '--remplace', 'a.txt', `@${join(dir, 'ancien')}`, 'TROIS')
    assert.equal(second.status, 0, second.stderr)
    assert.equal(git(dir, 'show', ':a.txt'), 'un\nDEUX\nTROIS')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--remplace laisse un arbre qui porte déjà le nouveau texte, et refuse sans rien écrire sinon', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a corrigé\nsuite\n')
    const done = snap(dir, '--remplace', 'a.txt', 'a', 'a corrigé')
    assert.equal(done.status, 0, done.stderr)
    assert.match(done.stdout, /arbre de travail : porte déjà le nouveau texte/)
    assert.equal(git(dir, 'show', ':a.txt'), 'a corrigé')
    git(dir, 'reset', '-q', '--hard')
    writeFileSync(join(dir, 'b.txt'), 'autre chose\n')
    const neither = snap(dir, '--remplace', 'b.txt', 'b', 'B')
    assert.equal(neither.status, 1)
    assert.match(neither.stderr, /ÉCHEC : b\.txt : l'arbre de travail ne porte ni l'ancien texte une fois, ni le nouveau/)
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '')
    const absent = snap(dir, '--remplace', 'a.txt', 'z', 'Z')
    assert.equal(absent.status, 1)
    assert.match(absent.stderr, /l'ancien texte paraît 0 fois/)
    for (const args of [['--remplace', 'c.txt', 'a', 'b'], ['--remplace', '-p', 'a', 'b'], ['--remplace', 'a.txt', 'a']]) {
      const bad = snap(dir, ...args)
      assert.equal(bad.status, 1, args.join(' '))
      assert.match(bad.stderr, /^ÉCHEC : /)
    }
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '')
    assert.equal(readFileSync(join(dir, 'b.txt'), 'utf8'), 'autre chose\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--remplace d’un texte sur plusieurs lignes : l’index en LF, l’arbre en CRLF, chacun à ses fins de ligne', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'un\ndeux\ntrois\n')
    git(dir, 'add', 'a.txt')
    git(dir, 'commit', '-q', '-m', 'a')
    writeFileSync(join(dir, 'a.txt'), 'un\r\ndeux\r\ntrois\r\nquatre\r\n')
    writeFileSync(join(dir, 'ancien'), 'deux\r\ntrois\r\n')
    const out = snap(dir, '--remplace', 'a.txt', `@${join(dir, 'ancien')}`, 'DEUX\nTROIS')
    assert.equal(out.status, 0, out.stderr)
    assert.equal(git(dir, 'show', ':a.txt'), 'un\nDEUX\nTROIS')
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'un\r\nDEUX\r\nTROIS\r\nquatre\r\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('la procédure cite les deux modes du script d’instantané par une commande simple', () => {
  assert.ok(procedure.includes('node <dossier de flow-board>/scripts/snapshot.mjs --staged <id du ticket> <les fichiers du correctif>'), 'la procédure ne cite pas --staged')
  assert.ok(procedure.includes('node <dossier de flow-board>/scripts/snapshot.mjs --remplace <fichier> <ancien> <nouveau>'), 'la procédure ne cite pas --remplace')
  assert.ok(procedure.includes('le README et les tests partagés comptent comme fichiers du ticket'), 'la procédure ne dit pas que le README et les tests partagés sont du ticket')
})

/** Un worktree d'un dépôt neuf, comme celui d'un worker : rend le dossier du dépôt et celui du worktree. */
const worktree = () => {
  const dir = repo()
  const wt = join(dir, '.claude', 'worktrees', 'groupe-A')
  git(dir, 'worktree', 'add', '-q', '-b', 'groupe-A', wt)
  return { dir, wt }
}

test('--dossier crée le dossier du relecteur dans le dossier git du worktree, et imprime son chemin', () => {
  const { dir, wt } = worktree()
  try {
    const out = snap(wt, '--dossier', 'T07')
    assert.equal(out.status, 0, out.stderr)
    // Propre à ce worktree : sous son dossier git à lui, pas sous celui du dépôt commun.
    const gitDir = git(wt, 'rev-parse', '--absolute-git-dir')
    assert.notEqual(realpathSync(gitDir), realpathSync(git(dir, 'rev-parse', '--absolute-git-dir')))
    const path = join(gitDir, 'flow-board', 'revue-T07')
    assert.ok(existsSync(path) && statSync(path).isDirectory(), 'dossier absent')
    const printed = /Dossier du relecteur : (.+?) \(/.exec(out.stdout)
    assert.ok(printed, out.stdout)
    assert.equal(realpathSync(printed[1]), realpathSync(path))
    // La fermeture d'un groupe ne le voit pas comme un fichier inconnu : il est hors de l'arbre de travail.
    writeFileSync(join(path, 'copie.txt'), 'copie extraite\n')
    assert.equal(git(wt, 'status', '--porcelain', '--ignored', '--untracked-files=all'), '')
    // Relancé, il garde ce qui y est.
    assert.equal(snap(wt, '--dossier', 'T07').status, 0)
    assert.ok(existsSync(join(path, 'copie.txt')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--dossier refuse un id hors forme, ou un nombre d’arguments faux, sans rien créer', () => {
  const { dir, wt } = worktree()
  try {
    const gitDir = git(wt, 'rev-parse', '--absolute-git-dir')
    // Le corpus hostile, sauf NUL, qu'un argument de commande ne peut pas porter.
    for (const id of ['../T07', '-T07', 'T 07', '', 'a/b', ...Object.values(CORPUS).filter(c => !c.includes(String.fromCharCode(0))).map(c => `T${c}07`)]) {
      const out = snap(wt, '--dossier', id)
      assert.equal(out.status, 1, `accepté : ${JSON.stringify(id)}`)
      assert.match(out.stderr, /ÉCHEC : id hors forme/)
    }
    assert.equal(snap(wt, '--dossier').status, 1)
    assert.equal(snap(wt, '--dossier', 'T07', 'T08').status, 1)
    assert.ok(!existsSync(join(gitDir, 'flow-board')), 'un dossier a été créé')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --clean : son invariant, « une référence d'instantané n'est supprimée qu'une fois le commit
// de son ticket (correctifs compris) dans la branche, et jamais celle d'un autre ticket ».
const T = ticket => `refs/worktree/flow-board/${ticket}`
const commitAll = (cwd, message, ...files) => {
  git(cwd, 'add', '-A', '--', ...files)
  git(cwd, 'commit', '-q', '-m', message)
}

test('--clean supprime la référence une fois le ticket commité, fichier de ticket et commit voisin compris', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'c.txt'), 'nouveau\n')
    assert.equal(snap(dir, 'T20', 'a.txt', 'c.txt').status, 0)
    // Pendant la revue, un ticket suivant sans fichier commun se commite : HEAD bouge.
    writeFileSync(join(dir, 'b.txt'), 'b du ticket suivant\n')
    git(dir, 'commit', '-q', '-m', 'ticket suivant', '--', 'b.txt')
    // Le vrai commit du ticket porte en plus son fichier de ticket (Status:, cases cochées).
    writeFileSync(join(dir, 'ticket.md'), 'Status: done\n')
    commitAll(dir, 'ticket T20', 'a.txt', 'c.txt', 'ticket.md')
    const out = snap(dir, '--clean', 'T20')
    assert.equal(out.status, 0, out.stderr)
    assert.match(out.stdout, /refs\/worktree\/flow-board\/T20 supprimée/)
    assert.ok(!hasRef(dir, T('T20')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean refuse une référence absente, ou un id hors forme, sans rien supprimer', () => {
  const dir = repo()
  try {
    const out = snap(dir, '--clean', 'T21')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /ÉCHEC : aucune référence d'instantané pour T21/)
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    assert.equal(snap(dir, 'T22', 'a.txt').status, 0)
    commitAll(dir, 'ticket T22', 'a.txt')
    for (const id of ['T22/../T22', '-T22', 'T22 ', '', '*', 'T2*']) {
      const bad = snap(dir, '--clean', id)
      assert.equal(bad.status, 1, `accepté : ${JSON.stringify(id)}`)
    }
    assert.equal(snap(dir, '--clean').status, 1)
    assert.equal(snap(dir, '--clean', 'T22', 'T23').status, 1)
    assert.ok(hasRef(dir, T('T22')), 'la référence a été supprimée')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean refuse tant que le ticket n’est pas commité, ou commité sans ses correctifs, et nomme les fichiers', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket\n')
    assert.equal(snap(dir, 'T23', 'a.txt', 'b.txt').status, 0)
    // Commit absent : rien dans la branche.
    let out = snap(dir, '--clean', 'T23')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /ÉCHEC : l'index ou l'arbre de travail portent encore un changement de a\.txt, b\.txt face à HEAD/)
    assert.ok(hasRef(dir, T('T23')))
    // Un seul des deux fichiers commité : refusé, et seul l'autre est nommé.
    git(dir, 'commit', '-q', '-m', 'moitié', '--', 'a.txt')
    out = snap(dir, '--clean', 'T23')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /changement de b\.txt face à HEAD/)
    // Le reste commité avec un correctif venu après l'instantané : la version figée n'est pas dans la branche.
    writeFileSync(join(dir, 'b.txt'), 'b du ticket, corrigé après l’instantané\n')
    commitAll(dir, 'reste', 'b.txt')
    out = snap(dir, '--clean', 'T23')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /diffèrent : b\.txt\)/)
    assert.ok(hasRef(dir, T('T23')), 'la référence a été supprimée')
    // Une fois le ticket commité, l'instantané ne se repose plus (plus rien à figer) : il se repose avant le commit.
    assert.equal(snap(dir, 'T23', 'b.txt').status, 1, 'plus rien à figer : le correctif est déjà commité')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean ne touche jamais la référence d’un autre ticket, même au nom voisin', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a de T24\n')
    assert.equal(snap(dir, 'T24', 'a.txt').status, 0)
    commitAll(dir, 'ticket T24', 'a.txt')
    writeFileSync(join(dir, 'b.txt'), 'b de T24-x\n')
    assert.equal(snap(dir, 'T24-x', 'b.txt').status, 0)
    writeFileSync(join(dir, 'c.txt'), 'c de T2\n')
    git(dir, 'restore', '--staged', 'b.txt')
    assert.equal(snap(dir, 'T2', 'c.txt').status, 0)
    // T24-x et T2 ne sont pas commités : leur --clean refuse ; celui de T24 ne supprime que T24.
    assert.equal(snap(dir, '--clean', 'T24-x').status, 1)
    assert.equal(snap(dir, '--clean', 'T2').status, 1)
    assert.equal(snap(dir, '--clean', 'T24').status, 0)
    assert.ok(!hasRef(dir, T('T24')))
    assert.ok(hasRef(dir, T('T24-x')) && hasRef(dir, T('T2')), 'la référence d’un autre ticket a été supprimée')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean d’un instantané qui supprime un fichier : accepté une fois la suppression commitée', () => {
  const dir = repo()
  try {
    unlinkSync(join(dir, 'b.txt'))
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    assert.equal(snap(dir, 'T25', 'a.txt', 'b.txt').status, 0)
    // Le fichier recréé dans un commit : la suppression n'est pas dans la branche.
    git(dir, 'restore', '--staged', 'b.txt')
    writeFileSync(join(dir, 'b.txt'), 'b\n')
    commitAll(dir, 'a seul', 'a.txt')
    assert.equal(snap(dir, '--clean', 'T25').status, 1)
    unlinkSync(join(dir, 'b.txt'))
    commitAll(dir, 'b supprimé', 'b.txt')
    const out = snap(dir, '--clean', 'T25')
    assert.equal(out.status, 0, out.stderr)
    assert.ok(!hasRef(dir, T('T25')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean sur le parcours réel : instantané, correctif et ligne Status: reposés par la même commande, commit, suppression', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'ticket.md'), 'Status: ready-for-agent\n')
    assert.equal(snap(dir, 'T26', 'a.txt', 'ticket.md').status, 0)
    // Le correctif de la passe « bogues » et la ligne Status: du ticket, puis l'instantané reposé avant le commit.
    writeFileSync(join(dir, 'a.txt'), 'a du ticket, corrigé\n')
    writeFileSync(join(dir, 'ticket.md'), 'Status: done\n')
    const again = snap(dir, 'T26', 'a.txt', 'ticket.md')
    assert.equal(again.status, 0, again.stderr)
    assert.match(again.stdout, /Instantané reposé : plage [0-9a-f]+\.\.[0-9a-f]+ depuis le précédent, pour information ; la seule passe après la passe « bogues » relit <hash du premier instantané>\.\./)
    const pinned = git(dir, 'rev-parse', T('T26'))
    commitAll(dir, 'ticket T26', 'a.txt', 'ticket.md')
    const out = snap(dir, '--clean', 'T26')
    assert.equal(out.status, 0, out.stderr)
    // Le hash de l'instantané supprimé reste dans la sortie : aucun journal ne le garde sous refs/worktree.
    assert.ok(out.stdout.includes(pinned), out.stdout)
    assert.ok(!hasRef(dir, T('T26')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean lancé d’un sous-dossier juge les mêmes fichiers que depuis la racine', () => {
  const dir = repo()
  try {
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'a.txt'), 'a du ticket\n')
    assert.equal(snap(dir, 'T27', 'sub/a.txt').status, 0)
    // Un commit voisin qui ne touche pas sub/a.txt : depuis sub/, --clean ne le prend pas pour le commit du ticket.
    writeFileSync(join(dir, 'b.txt'), 'b voisin\n')
    git(dir, 'commit', '-q', '-m', 'voisin', '--', 'b.txt')
    const sub = join(dir, 'sub')
    assert.equal(snap(sub, '--clean', 'T27').status, 1)
    assert.ok(hasRef(dir, T('T27')), 'supprimée avant le commit du ticket')
    commitAll(dir, 'ticket T27', 'sub/a.txt')
    const out = snap(sub, '--clean', 'T27')
    assert.equal(out.status, 0, out.stderr)
    assert.ok(!hasRef(dir, T('T27')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean refuse quand l’index ou l’arbre portent encore un changement des fichiers de l’instantané', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    assert.equal(snap(dir, 'T28', 'a.txt').status, 0)
    // Un correctif fait après l'instantané, sans le reposer ; le commit prend l'index tel quel (la version figée).
    writeFileSync(join(dir, 'a.txt'), 'a du ticket, corrigé après l’instantané\n')
    git(dir, 'commit', '-q', '-m', 'ticket sans son correctif')
    const out = snap(dir, '--clean', 'T28')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /a\.txt/)
    assert.ok(hasRef(dir, T('T28')), 'supprimée alors que le correctif n’est pas commité')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un instantané reposé sur une partie des fichiers du précédent est refusé : --clean ne les verrait plus', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket\n')
    assert.equal(snap(dir, 'T29', 'a.txt', 'b.txt').status, 0)
    const first = git(dir, 'rev-parse', T('T29'))
    git(dir, 'restore', '--staged', 'a.txt', 'b.txt')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket, corrigé\n')
    const out = snap(dir, 'T29', 'b.txt')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /a\.txt/)
    assert.equal(git(dir, 'rev-parse', T('T29')), first, 'la référence a bougé')
    // Un fichier du précédent déjà commité à sa version figée ne bloque pas.
    git(dir, 'add', 'a.txt')
    git(dir, 'restore', '--staged', 'b.txt')
    git(dir, 'commit', '-q', '-m', 'a seul', '--', 'a.txt')
    assert.equal(snap(dir, 'T29', 'b.txt').status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un instantané reposé sans un fichier déjà commité mais corrigé depuis est refusé (correctif hors de --clean)', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket\n')
    assert.equal(snap(dir, 'T31', 'a.txt', 'b.txt').status, 0)
    const first = git(dir, 'rev-parse', T('T31'))
    git(dir, 'commit', '-q', '-m', 'ticket T31')
    // Deux correctifs après le commit ; l'instantané reposé sur b.txt seul laisserait celui de a.txt hors de --clean.
    writeFileSync(join(dir, 'a.txt'), 'a du ticket, corrigé\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket, corrigé\n')
    const out = snap(dir, 'T31', 'b.txt')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /porte aussi a\.txt, que celui-ci ne porte pas et qui a encore un changement non commité/)
    assert.equal(git(dir, 'rev-parse', T('T31')), first, 'la référence a bougé')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un correctif qui ramène un fichier du ticket à HEAD n’empêche pas de reposer l’instantané', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket\n')
    assert.equal(snap(dir, 'T32', 'a.txt', 'b.txt').status, 0)
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket, corrigé\n')
    const out = snap(dir, 'T32', 'a.txt', 'b.txt')
    assert.equal(out.status, 0, out.stderr)
    commitAll(dir, 'ticket T32', 'a.txt', 'b.txt')
    assert.equal(snap(dir, '--clean', 'T32').status, 0)
    assert.ok(!hasRef(dir, T('T32')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('poser un instantané sous un id qui ne diffère que par la casse d’un autre est refusé, sans toucher l’autre', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a de T33\n')
    assert.equal(snap(dir, 'T33', 'a.txt').status, 0)
    const pinnedT33 = git(dir, 'rev-parse', T('T33'))
    git(dir, 'restore', '--staged', 'a.txt')
    writeFileSync(join(dir, 'b.txt'), 'b de t33\n')
    const out = snap(dir, 't33', 'b.txt')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /ne diffère de refs\/worktree\/flow-board\/t33 que par la casse/)
    assert.equal(git(dir, 'rev-parse', T('T33')), pinnedT33)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean ne prend pas un commit venu d’une fusion pour celui du ticket, ni une branche réécrite', () => {
  const dir = repo()
  try {
    const base = git(dir, 'rev-parse', 'HEAD')
    // Sur la branche du groupe, x.txt est créé ; le ticket le supprime.
    writeFileSync(join(dir, 'x.txt'), 'x\n')
    commitAll(dir, 'x créé', 'x.txt')
    unlinkSync(join(dir, 'x.txt'))
    assert.equal(snap(dir, 'T34', 'x.txt').status, 0)
    // La suppression est perdue (l'arbre la défait), puis une branche partie d'avant x.txt est fusionnée.
    git(dir, 'restore', '--staged', 'x.txt')
    git(dir, 'checkout', '--', 'x.txt')
    git(dir, 'branch', 'cote', base)
    git(dir, 'checkout', '-q', 'cote')
    writeFileSync(join(dir, 'c.txt'), 'c\n')
    commitAll(dir, 'côté', 'c.txt')
    git(dir, 'checkout', '-q', '-')
    git(dir, 'merge', '-q', '--no-ff', '-m', 'fusion', 'cote')
    const out = snap(dir, '--clean', 'T34')
    assert.equal(out.status, 1, out.stdout)
    assert.ok(hasRef(dir, T('T34')), 'supprimée sur un commit de l’autre branche')
    // Une branche réécrite sous l'instantané : son parent n'est plus un ancêtre de HEAD.
    git(dir, 'reset', '-q', '--hard', base)
    const rewritten = snap(dir, '--clean', 'T34')
    assert.equal(rewritten.status, 1)
    assert.match(rewritten.stderr, /n'est pas un ancêtre de HEAD/)
    assert.ok(hasRef(dir, T('T34')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean ne prend jamais la référence d’un autre ticket par la casse', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    assert.equal(snap(dir, 'T30', 'a.txt').status, 0)
    commitAll(dir, 'ticket T30', 'a.txt')
    const out = snap(dir, '--clean', 't30')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /une autre référence ne diffère de refs\/worktree\/flow-board\/t30 que par la casse : refs\/worktree\/flow-board\/T30/)
    assert.ok(hasRef(dir, T('T30')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('la procédure fait supprimer la référence par --clean, plus par update-ref -d seul', () => {
  assert.ok(procedure.includes('le commit, puis `node <dossier de flow-board>/scripts/snapshot.mjs --clean <id du ticket>`, qui ne supprime que la référence de ce ticket'), 'la procédure ne cite pas --clean')
  assert.ok(!procedure.includes('le commit, puis `git update-ref -d refs/worktree/flow-board/<id du ticket>`.'), 'la suppression à la main reste la voie normale')
})

test('les trois gabarits nomment le dossier du relecteur comme seul lieu d’écriture, jamais /tmp', () => {
  const ref = file => readFileSync(new URL(`../reference/${file}`, import.meta.url), 'utf8')
  const consignes = ref('consignes-revue.md')
  assert.ok(consignes.includes('- [Où écrire : seulement `<dossier du relecteur>` (copies extraites, notes)'), 'consignes-revue.md')
  assert.ok(consignes.includes('jamais `/tmp`'))
  const prompt = ref('prompt-relecteur.md')
  const line = '- Où écrire : tes seules écritures (copies extraites, notes) vont dans `<dossier du relecteur>`'
  // Les deux variantes du prompt, deux axes et axe Spec seul.
  assert.equal(prompt.split(line).length - 1, 2, 'prompt-relecteur.md : une variante sans la ligne')
  assert.ok(prompt.includes('jamais dans `/tmp`, l\'arbre de travail ni ailleurs'))
  const securite = ref('revue-securite.md')
  assert.ok(securite.includes('Tes seules écritures (copies extraites, notes) vont dans le dossier du relecteur que donne ton fichier de consignes'), 'revue-securite.md')
  assert.ok(securite.includes('`snapshot.mjs --dossier securite-<id du groupe>`'))
  assert.ok(procedure.includes('`--relecteur <id du ticket>`, qui crée le dossier du relecteur'), 'la procédure ne cite pas --relecteur')
  assert.ok(procedure.includes('`node <dossier de flow-board>/scripts/snapshot.mjs --dossier groupe-<id du groupe>`'), 'la procédure ne cite pas --dossier')
})

test('l’instantané crée aussi le dossier du relecteur du ticket et imprime son chemin', () => {
  const { dir, wt } = worktree()
  try {
    writeFileSync(join(wt, 'a.txt'), 'a modifié\n')
    const out = snap(wt, 'T08', 'a.txt')
    assert.equal(out.status, 0, out.stderr)
    const path = join(git(wt, 'rev-parse', '--absolute-git-dir'), 'flow-board', 'revue-T08')
    assert.ok(existsSync(path), 'dossier absent')
    assert.match(out.stdout, /Dossier du relecteur : .+revue-T08 \(/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
