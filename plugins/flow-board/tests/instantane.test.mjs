// Le script d'instantané d'un ticket sensible (scripts/snapshot.mjs) : la procédure d'une session
// liée de groupe le désigne (point 6), à la place de cinq commandes tapées une à une. Ces tests le
// lancent pour de vrai, dans un dépôt git temporaire.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
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
