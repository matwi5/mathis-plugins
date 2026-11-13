// Le script d'instantané d'un ticket sensible (scripts/snapshot.mjs) : la procédure d'une session
// liée de groupe le désigne (point 6), à la place de cinq commandes tapées une à une. Ces tests le
// lancent pour de vrai, dans un dépôt git temporaire.

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isSafeJobDir, isSafeTicket } from '../scripts/snapshot.mjs'
import { ch, CORPUS, LINE_BREAKERS, NON_TEXT } from './corpus.mjs'

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

/**
 * L'environnement d'un lancement du script : sans le dossier de job de la session qui lance les tests
 * (`CLAUDE_JOB_DIR`, que le script lit pour placer le dossier du relecteur), sauf `jobDir` donné.
 */
const envOf = jobDir => {
  const { CLAUDE_JOB_DIR: _, ...env } = process.env
  return jobDir === undefined ? env : { ...env, CLAUDE_JOB_DIR: jobDir }
}
const snap = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: envOf() })
/** Le script lancé par une session de fond : `CLAUDE_JOB_DIR` vaut `jobDir`. */
const snapJob = (cwd, jobDir, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: envOf(jobDir) })
const hasRef = (cwd, ref) => spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd }).status === 0
/** Le dossier git de `cwd` : celui du worktree quand c'en est un. */
const gitDirOf = cwd => git(cwd, 'rev-parse', '--absolute-git-dir')

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

// L'invariant de la première forme : « la pose d'un instantané ne change ni l'index ni l'arbre de travail
// de la session ; l'instantané porte exactement les fichiers nommés, à leur version de l'arbre de
// travail, au-dessus de HEAD ».
const indexBytes = cwd => readFileSync(join(gitDirOf(cwd), 'index'))
/** Les index temporaires que le script aurait laissés dans le dossier git. */
const strayIndexes = cwd => readdirSync(gitDirOf(cwd)).filter(name => name.startsWith('flow-board-index-'))

test('l’instantané ne lit ni ne change l’index de la session : ce qu’un autre ticket y a indexé n’y entre pas, et ne le fait plus refuser', () => {
  const dir = repo()
  try {
    const head = git(dir, 'rev-parse', 'HEAD')
    writeFileSync(join(dir, 'a.txt'), 'a modifié\n')
    // Un autre ticket : b.txt indexé puis encore modifié dans l'arbre, c.txt pas encore suivi.
    writeFileSync(join(dir, 'b.txt'), 'b indexé par un autre\n')
    git(dir, 'add', 'b.txt')
    writeFileSync(join(dir, 'b.txt'), 'b indexé par un autre, puis modifié\n')
    writeFileSync(join(dir, 'c.txt'), 'c d’un autre ticket\n')
    const before = indexBytes(dir)
    const out = snap(dir, 'T09', 'a.txt')
    assert.equal(out.status, 0, out.stderr)
    // L'index de la session : les mêmes octets, et toujours le seul fichier de l'autre ticket.
    assert.ok(indexBytes(dir).equals(before), 'le fichier d’index a changé')
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), 'b.txt')
    assert.equal(git(dir, 'show', ':b.txt'), 'b indexé par un autre')
    // L'arbre de travail : tel quel.
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'a modifié\n')
    assert.equal(readFileSync(join(dir, 'b.txt'), 'utf8'), 'b indexé par un autre, puis modifié\n')
    assert.equal(readFileSync(join(dir, 'c.txt'), 'utf8'), 'c d’un autre ticket\n')
    // L'instantané : le seul fichier nommé, à sa version de l'arbre, au-dessus de HEAD.
    const ref = 'refs/worktree/flow-board/T09'
    assert.match(out.stdout, /\(1 fichier : a\.txt\)/)
    assert.equal(git(dir, 'rev-parse', `${ref}^`), head)
    assert.equal(git(dir, 'diff', '--name-status', `${ref}^..${ref}`), 'M\ta.txt')
    assert.equal(git(dir, 'show', `${ref}:a.txt`), 'a modifié')
    assert.equal(git(dir, 'show', `${ref}:b.txt`), 'b')
    assert.notEqual(spawnSync('git', ['cat-file', '-e', `${ref}:c.txt`], { cwd: dir }).status, 0, 'c.txt est entré dans l’instantané')
    assert.deepEqual(strayIndexes(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rien n’est posé sans changement, ou pour un id ou un fichier hors forme, et aucun index temporaire ne reste', () => {
  const dir = repo()
  try {
    const before = indexBytes(dir)
    const none = snap(dir, 'T10', 'a.txt')
    assert.equal(none.status, 1)
    assert.match(none.stderr, /aucun changement dans ces fichiers/)
    for (const [ticket, file] of [['../x', 'a.txt'], ['-d', 'a.txt'], ['T 1', 'a.txt'], ['T11', '-p'], ['', 'a.txt']]) {
      const bad = snap(dir, ticket, file)
      assert.equal(bad.status, 1, `${ticket} ${file}`)
      assert.match(bad.stderr, /^ÉCHEC : /)
    }
    assert.equal(snap(dir, 'T12').status, 1)
    // Un fichier que git ne connaît pas et qui n'existe pas : git add échoue, l'index temporaire part quand même.
    const missing = snap(dir, 'T13', 'absent.txt')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /^ÉCHEC : /)
    assert.equal(git(dir, 'for-each-ref', 'refs/worktree/'), '')
    assert.deepEqual(strayIndexes(dir), [])
    assert.ok(indexBytes(dir).equals(before), 'le fichier d’index a changé')
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

test('une suppression indexée par un autre n’entre pas dans l’instantané, même là où git verrait un renommage vers un fichier du ticket', () => {
  const dir = repo()
  try {
    const long = 'une ligne assez longue pour que git y voie un renommage\n'.repeat(20)
    writeFileSync(join(dir, 'o.txt'), long)
    git(dir, 'add', 'o.txt')
    git(dir, 'commit', '-q', '-m', 'o')
    git(dir, 'rm', '-q', 'o.txt')
    writeFileSync(join(dir, 'n.txt'), long)
    const out = snap(dir, 'T13', 'n.txt')
    assert.equal(out.status, 0, out.stderr)
    // Le seul fichier nommé : o.txt, supprimé dans l'index par un autre, reste dans l'instantané.
    const ref = 'refs/worktree/flow-board/T13'
    assert.equal(git(dir, 'diff', '--no-renames', '--name-status', `${ref}^..${ref}`), 'A\tn.txt')
    assert.equal(spawnSync('git', ['cat-file', '-e', `${ref}:o.txt`], { cwd: dir }).status, 0, 'o.txt a quitté l’instantané')
    // Et la suppression reste indexée, telle quelle.
    assert.equal(git(dir, 'diff', '--cached', '--name-status'), 'D\to.txt')
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
    const out = spawnSync(process.execPath, [link, 'T14', 'a.txt'], { cwd: dir, encoding: 'utf8', env: envOf() })
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
    // Un chemin écrit ./a.txt désigne le même fichier, pour les contrôles comme pour git.
    const dotted = snap(dir, '--remplace', './a.txt', 'un', 'UN')
    assert.equal(dotted.status, 0, dotted.stderr)
    assert.equal(git(dir, 'show', ':a.txt'), 'UN\nDEUX\ntrois')
    // Un second remplacement part de la version indexée, qui garde le premier ; un @fichier perd sa fin de ligne finale.
    writeFileSync(join(dir, 'ancien'), 'trois\n')
    const second = snap(dir, '--remplace', 'a.txt', `@${join(dir, 'ancien')}`, 'TROIS')
    assert.equal(second.status, 0, second.stderr)
    assert.equal(git(dir, 'show', ':a.txt'), 'UN\nDEUX\nTROIS')
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

test('--remplace refuse un fichier suivi comme lien symbolique, sans toucher ni l’index ni sa cible', () => {
  const dir = repo()
  try {
    symlinkSync('b.txt', join(dir, 'lien'))
    git(dir, 'add', 'lien')
    git(dir, 'commit', '-q', '-m', 'lien')
    const out = snap(dir, '--remplace', 'lien', 'b', 'B')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /^ÉCHEC : lien : suivi comme lien symbolique dans l'index/)
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '')
    assert.equal(git(dir, 'ls-files', '-s', 'lien').split(' ')[0], '120000')
    assert.equal(readFileSync(join(dir, 'b.txt'), 'utf8'), 'b\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--remplace refuse un fichier ordinaire de l’index remplacé dans l’arbre par un lien vers un fichier hors du dépôt', () => {
  const dir = repo()
  const outside = mkdtempSync(join(tmpdir(), 'instantane-dehors-'))
  try {
    writeFileSync(join(outside, 'cible.txt'), 'a\n')
    unlinkSync(join(dir, 'a.txt'))
    symlinkSync(join(outside, 'cible.txt'), join(dir, 'a.txt'))
    const out = snap(dir, '--remplace', 'a.txt', 'a', 'A')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /^ÉCHEC : a\.txt : lien symbolique dans l'arbre de travail \(a\.txt\)/)
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '')
    assert.equal(git(dir, 'show', ':a.txt'), 'a')
    assert.equal(readFileSync(join(outside, 'cible.txt'), 'utf8'), 'a\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('--remplace refuse un fichier sous un dossier qui est un lien, sans toucher la cible', () => {
  const dir = repo()
  const outside = mkdtempSync(join(tmpdir(), 'instantane-dehors-'))
  try {
    mkdirSync(join(dir, 'd'))
    writeFileSync(join(dir, 'd', 'c.txt'), 'c\n')
    git(dir, 'add', 'd/c.txt')
    git(dir, 'commit', '-q', '-m', 'd')
    writeFileSync(join(outside, 'c.txt'), 'c\n')
    rmSync(join(dir, 'd'), { recursive: true })
    symlinkSync(outside, join(dir, 'd'))
    const out = snap(dir, '--remplace', 'd/c.txt', 'c', 'C')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /^ÉCHEC : d\/c\.txt : lien symbolique dans l'arbre de travail \(d\)/)
    // Un chemin qui sort du dossier courant ne se vérifie pas : il est refusé.
    const up = snap(dir, '--remplace', '../c.txt', 'c', 'C')
    assert.equal(up.status, 1)
    assert.match(up.stderr, /^ÉCHEC : \.\.\/c\.txt : hors du dossier courant/)
    // Un chemin absolu non plus, même dans le dépôt.
    const abs = snap(dir, '--remplace', join(dir, 'a.txt'), 'a', 'A')
    assert.equal(abs.status, 1)
    assert.match(abs.stderr, /hors du dossier courant/)
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '')
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'a\n')
    assert.equal(readFileSync(join(outside, 'c.txt'), 'utf8'), 'c\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('--remplace d’un fichier dont le dossier est devenu un fichier, ou qui est un tube nommé : absent de l’arbre, rien n’est écrit', () => {
  const dir = repo()
  try {
    mkdirSync(join(dir, 'd'))
    writeFileSync(join(dir, 'd', 'c.txt'), 'c\n')
    git(dir, 'add', 'd/c.txt')
    git(dir, 'commit', '-q', '-m', 'd')
    rmSync(join(dir, 'd'), { recursive: true })
    writeFileSync(join(dir, 'd'), 'un fichier\n')
    const out = snap(dir, '--remplace', 'd/c.txt', 'c', 'C')
    assert.equal(out.status, 1)
    assert.match(out.stderr, /^ÉCHEC : d\/c\.txt : absent de l'arbre de travail/)
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '')
    if (process.platform !== 'win32') {
      unlinkSync(join(dir, 'a.txt'))
      execFileSync('mkfifo', [join(dir, 'a.txt')])
      const fifo = spawnSync(process.execPath, [SCRIPT, '--remplace', 'a.txt', 'a', 'A'], { cwd: dir, encoding: 'utf8', timeout: 20_000 })
      assert.equal(fifo.status, 1, 'la commande a bloqué sur le tube')
      assert.match(fifo.stderr, /^ÉCHEC : a\.txt : absent de l'arbre de travail/)
      assert.equal(git(dir, 'diff', '--cached', '--name-only'), '')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--remplace refuse un chemin dont un dossier est illisible, sans rien écrire', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const dir = repo()
  try {
    mkdirSync(join(dir, 'd'))
    writeFileSync(join(dir, 'd', 'c.txt'), 'c\n')
    git(dir, 'add', 'd/c.txt')
    git(dir, 'commit', '-q', '-m', 'd')
    chmodSync(join(dir, 'd'), 0o000)
    let out
    try {
      out = snap(dir, '--remplace', 'd/c.txt', 'c', 'C')
    } finally {
      chmodSync(join(dir, 'd'), 0o755)
    }
    assert.equal(out.status, 1)
    assert.match(out.stderr, /^ÉCHEC : d\/c\.txt : chemin illisible dans l'arbre de travail/)
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), '')
    assert.equal(readFileSync(join(dir, 'd', 'c.txt'), 'utf8'), 'c\n')
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

// Le dossier du relecteur suit `CLAUDE_JOB_DIR`, le dossier de job d'une session de fond : l'outil Write
// d'un relecteur y passe, pas dans le dossier git d'un worktree. Son invariant : « le dossier d'un relecteur
// n'est jamais créé hors du dossier temporaire de la session, du worktree de la session ou de son dossier
// git ; le script n'efface ni n'écrase jamais un dossier de relecteur existant ».
/** Un dossier de job neuf, à son vrai chemin (/private/var sur Mac). */
const jobDir = () => realpathSync(mkdtempSync(join(tmpdir(), 'job-')))
const printedDir = out => (/Dossier du relecteur : (.+?) \(/.exec(out.stdout) || [])[1]

test('--dossier, variable valide : sous tmp, et un dossier déjà là garde ce qu’il porte', () => {
  const { dir, wt } = worktree()
  const job = jobDir()
  try {
    const out = snapJob(wt, job, '--dossier', 'T07')
    assert.equal(out.status, 0, out.stderr)
    const path = join(job, 'tmp', 'revue-T07')
    assert.ok(statSync(path).isDirectory(), 'dossier absent')
    assert.equal(printedDir(out), path)
    assert.equal(out.stderr, '')
    assert.ok(!existsSync(join(gitDirOf(wt), 'flow-board')), 'un dossier a aussi été créé dans le dossier git')
    // Relancé, il garde ce qui y est.
    writeFileSync(join(path, 'copie.txt'), 'copie extraite\n')
    assert.equal(snapJob(wt, job, '--dossier', 'T07').status, 0)
    assert.equal(readFileSync(join(path, 'copie.txt'), 'utf8'), 'copie extraite\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(job, { recursive: true, force: true })
  }
})

test('--dossier, sans variable : le dossier git, sans avis (variable absente ou vide)', () => {
  const { dir, wt } = worktree()
  try {
    const absent = snap(wt, '--dossier', 'T07')
    assert.equal(absent.status, 0, absent.stderr)
    assert.equal(realpathSync(printedDir(absent)), realpathSync(join(gitDirOf(wt), 'flow-board', 'revue-T07')))
    assert.equal(absent.stderr, '')
    const empty = snapJob(wt, '', '--dossier', 'T08')
    assert.equal(empty.status, 0, empty.stderr)
    assert.equal(realpathSync(printedDir(empty)), realpathSync(join(gitDirOf(wt), 'flow-board', 'revue-T08')))
    assert.equal(empty.stderr, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Le lancement a ignoré la variable : le dossier git du worktree, et un avis qui ne recopie pas la valeur. */
const assertIgnored = (out, wt, id, reason, value) => {
  assert.equal(out.status, 0, out.stderr)
  assert.equal(realpathSync(printedDir(out)), realpathSync(join(gitDirOf(wt), 'flow-board', `revue-${id}`)))
  assert.match(out.stderr, /^Avis : CLAUDE_JOB_DIR ignorée \(/)
  assert.ok(out.stderr.includes(reason), out.stderr)
  assert.equal(out.stderr.trimEnd().split('\n').length, 1, 'l’avis tient sur une ligne')
  if (value !== undefined) assert.ok(!out.stderr.includes(value), 'l’avis recopie la valeur')
}

test('--dossier, variable hors forme : ignorée et dite (relative, segment « .. », apostrophe, caractère de contrôle, fin de ligne)', () => {
  const { dir, wt } = worktree()
  const job = jobDir()
  try {
    const hostile = ['job/relatif', 'tmp', `${job}\nsuite`, `${job}${ch(0x07)}`, `${job}${ch(0x85)}x`, `${job}${ch(0x2028)}x`, `${job}${ch(0x202e)}x`, `${job}${ch(0x200b)}x`,
      `${job}/../${job.split('/').at(-1)}`, `${job}/.`, `${job}'x`, `${job}$x`, `${job}\`x\``, '/']
    hostile.forEach((value, i) => assertIgnored(snapJob(wt, value, '--dossier', `T${i}`), wt, `T${i}`, 'hors forme', value))
    // Rien n'a été créé sous le dossier de job, ni par un chemin relatif sous le worktree.
    assert.deepEqual(readdirSync(job), [])
    assert.ok(!existsSync(join(wt, 'job')) && !existsSync(join(wt, 'tmp')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(job, { recursive: true, force: true })
  }
})

test('--dossier : le chemin vérifié est celui qui sert (un « .. » après un lien est refusé, un dossier de job désigné par un lien sert par son chemin réel)', () => {
  const { dir, wt } = worktree()
  const base = jobDir()
  try {
    // job/lien mène à ailleurs/d1/d2 : « job/lien/../neuf » existe pour le système (ailleurs/d1/neuf), pas pour le texte (job/neuf).
    mkdirSync(join(base, 'job'))
    mkdirSync(join(base, 'ailleurs', 'd1', 'd2'), { recursive: true })
    mkdirSync(join(base, 'ailleurs', 'd1', 'neuf'))
    symlinkSync(join(base, 'ailleurs', 'd1', 'd2'), join(base, 'job', 'lien'))
    assertIgnored(snapJob(wt, `${base}/job/lien/../neuf`, '--dossier', 'T1'), wt, 'T1', 'hors forme')
    assert.ok(!existsSync(join(base, 'job', 'neuf')), 'un dossier que la variable ne désigne pas a été créé')
    assert.deepEqual(readdirSync(join(base, 'ailleurs', 'd1', 'neuf')), [])
    // Désigné par un lien, le dossier de job sert par son chemin réel, et le dossier créé y est bien.
    const out = snapJob(wt, join(base, 'job', 'lien'), '--dossier', 'T2')
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.stderr, '')
    assert.equal(printedDir(out), join(base, 'ailleurs', 'd1', 'd2', 'tmp', 'revue-T2'))
    assert.ok(statSync(join(base, 'ailleurs', 'd1', 'd2', 'tmp', 'revue-T2')).isDirectory())
    // Un lien de bonne forme vers un dossier dont le chemin réel est hors forme (une apostrophe) : ignoré et dit.
    mkdirSync(join(base, "l'autre"))
    symlinkSync(join(base, "l'autre"), join(base, 'job', 'apostrophe'))
    assertIgnored(snapJob(wt, join(base, 'job', 'apostrophe'), '--dossier', 'T3'), wt, 'T3', 'le chemin réel de son dossier est hors forme')
    assert.deepEqual(readdirSync(join(base, "l'autre")), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(base, { recursive: true, force: true })
  }
})

test('--dossier, dossier de job dans l’arbre de travail : ignoré et dit, rien n’y est créé', () => {
  const { dir, wt } = worktree()
  try {
    // Un dossier non suivi du worktree ferait refuser la fermeture du groupe, et ne serait plus « hors de l'arbre suivi ».
    mkdirSync(join(wt, 'job'))
    assertIgnored(snapJob(wt, join(realpathSync(wt), 'job'), '--dossier', 'T1'), wt, 'T1', 'son dossier est dans l\'arbre de travail')
    assertIgnored(snapJob(wt, realpathSync(wt), '--dossier', 'T2'), wt, 'T2', 'son dossier est dans l\'arbre de travail')
    assert.deepEqual(readdirSync(join(wt, 'job')), [])
    assert.ok(!existsSync(join(wt, 'tmp')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--dossier, dossier de job au-dessus du worktree, dont le tmp est sa racine : ignoré et dit, rien n’est créé dans l’arbre', () => {
  const job = jobDir()
  const wt = join(job, 'tmp')
  try {
    // Le dossier de job n'est pas dans l'arbre de travail, mais le dossier du relecteur, lui, y tomberait.
    mkdirSync(wt)
    git(wt, 'init', '-q')
    assertIgnored(snapJob(wt, job, '--dossier', 'T1'), wt, 'T1', 'son dossier tmp est dans l\'arbre de travail')
    assert.ok(!existsSync(join(wt, 'revue-T1')))
    // Un worktree sous le tmp du dossier de job n'est pas concerné : le dossier du relecteur est à côté de lui.
    const under = join(wt, 'depot')
    mkdirSync(under)
    git(under, 'init', '-q')
    const out = snapJob(under, job, '--dossier', 'T2')
    assert.equal(out.status, 0, out.stderr)
    assert.equal(printedDir(out), join(job, 'tmp', 'revue-T2'))
  } finally {
    rmSync(job, { recursive: true, force: true })
  }
})

test('le dossier de job a la forme que le mod exige de la même variable, passe la classe « ligne sûre » du corpus hostile commun, et refuse ce qui n’est pas un texte', () => {
  for (const good of ['/var/jobs/b17e04df', '/var/folders/x/T/']) assert.equal(isSafeJobDir(good), true, good)
  // Une lettre de lecteur n'est un chemin absolu que sous Windows : ailleurs, « C:/x » se résoudrait contre le dossier courant.
  for (const drive of ['C:\\jobs\\b17e04df', 'C:/jobs/b17e04df']) assert.equal(isSafeJobDir(drive), process.platform === 'win32', drive)
  // Les cas du test de `tempDirForm` (hooks/closing.ts), la forme que le mod applique à CLAUDE_JOB_DIR.
  for (const bad of ['tmp', './tmp', 'jobs/b17e04df', '/tmp/../etc', '/tmp/./x', "/tmp/it's", '/tmp/$(x)', '/tmp/`x`', '/tmp/"x"', `/tmp/${ch(0x2019)}x`, '//server/share', '\\\\server\\share', '/', 'C:\\', '/tmp/a\nb', '/tmp//x', `/${'a'.repeat(300)}`]) {
    assert.equal(isSafeJobDir(bad), false, bad)
  }
  const passing = Object.entries(LINE_BREAKERS).flatMap(([family, codes]) => codes.filter(code => isSafeJobDir(`/jobs/a${ch(code)}b`)).map(code => `${family} : U+${code.toString(16)}`))
  assert.deepEqual(passing, [])
  assert.deepEqual(Object.entries(NON_TEXT).filter(([, value]) => isSafeJobDir(value)).map(([name]) => name), [])
})

// Le dossier de job est un chemin du poste, pas un identifiant : le nom d'un dossier personnel peut porter
// un espace, une lettre accentuée ou d'une autre écriture, et le mod accepte les mêmes signes de la même
// variable. Le corpus commun fixe donc ce qui passe, entrée par entrée : ce qui cite pour un shell
// (apostrophes, guillemet, `$`, accent grave), ce qui ouvre une ligne, ce qui ne se voit pas et une
// remontée sont refusés ; le reste ne passe que parce que le script ne met jamais ce chemin dans une
// commande (il crée le dossier par Node, puis l'imprime). Une entrée ajoutée au corpus et qui passerait
// fait échouer ce test : elle se range ici, avec sa raison, ou le garde se resserre.
test('le dossier de job passe le corpus hostile commun : seuls passent les signes qu’un chemin du poste peut porter', () => {
  const passing = Object.entries(CORPUS).filter(([, token]) => isSafeJobDir(`/jobs/a${token}b`)).map(([name]) => name)
  assert.deepEqual(passing, [
    // Des points, des lettres et des crochets d'autres écritures : visibles, sans effet dans un chemin.
    'point médian U+00B7', 'point grec U+0387', 'point de césure U+2027', 'opérateur puce U+2219', 'opérateur point U+22C5', 'point katakana U+30FB', 'point katakana demi-chasse U+FF65',
    'lettre apostrophe U+02BC', 'signe Kelvin U+212A', 'ligature fi U+FB01', 'chiffre pleine chasse U+FF11', 'lettre pleine chasse U+FF21', 'e accent aigu U+00E9',
    'espace insécable U+00A0',
    'chevrons mathématiques U+27E8 U+27E9', 'chevrons doubles U+27EA U+27EB', 'crochets lenticulaires U+3010 U+3011', 'crochets en écaille U+3014 U+3015', 'parenthèses blanches U+2985 U+2986',
    // Un espace et des signes du shell qu'un nom de dossier peut porter (« Jean Dupont », « R&D ») : jamais dans une commande du script.
    'espace', 'point-virgule', 'esperluette', 'barre', 'joker',
  ])
})

test('--dossier, dossier absent : ignoré et dit', () => {
  const { dir, wt } = worktree()
  const job = jobDir()
  try {
    const missing = join(job, 'absent')
    assertIgnored(snapJob(wt, missing, '--dossier', 'T07'), wt, 'T07', 'ne désigne pas un dossier existant')
    assert.ok(!existsSync(missing), 'le dossier absent a été créé')
    // Un fichier à ce chemin n'est pas un dossier non plus.
    writeFileSync(join(job, 'fichier'), 'pas un dossier\n')
    assertIgnored(snapJob(wt, join(job, 'fichier'), '--dossier', 'T08'), wt, 'T08', 'ne désigne pas un dossier existant')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(job, { recursive: true, force: true })
  }
})

test('--dossier ne crée rien à travers un lien : un tmp ou un dossier du relecteur qui est un lien ou un fichier fait ignorer la variable', () => {
  const { dir, wt } = worktree()
  const job = jobDir()
  const outside = jobDir()
  try {
    // tmp est un lien vers un dossier hors du dossier de job.
    symlinkSync(outside, join(job, 'tmp'))
    assertIgnored(snapJob(wt, job, '--dossier', 'T07'), wt, 'T07', 'son dossier tmp est un lien')
    assert.deepEqual(readdirSync(outside), [], 'un dossier a été créé à travers le lien')
    // tmp est un vrai dossier, mais le dossier du relecteur y est un lien.
    unlinkSync(join(job, 'tmp'))
    mkdirSync(join(job, 'tmp'))
    symlinkSync(outside, join(job, 'tmp', 'revue-T08'))
    assertIgnored(snapJob(wt, job, '--dossier', 'T08'), wt, 'T08', 'tmp/revue-T08 y est un lien')
    assert.deepEqual(readdirSync(outside), [])
    // tmp est un fichier.
    rmSync(join(job, 'tmp'), { recursive: true })
    writeFileSync(join(job, 'tmp'), 'pas un dossier\n')
    assertIgnored(snapJob(wt, job, '--dossier', 'T09'), wt, 'T09', 'son dossier tmp est un lien')
    assert.equal(readFileSync(join(job, 'tmp'), 'utf8'), 'pas un dossier\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(job, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('--dossier, variable valide et id hors forme : refusé, rien n’est créé sous le dossier de job', () => {
  const { dir, wt } = worktree()
  const job = jobDir()
  try {
    for (const id of ['../T07', '-T07', 'a/b', '']) {
      const out = snapJob(wt, job, '--dossier', id)
      assert.equal(out.status, 1, `accepté : ${JSON.stringify(id)}`)
      assert.match(out.stderr, /^ÉCHEC : id hors forme/)
    }
    assert.deepEqual(readdirSync(job), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(job, { recursive: true, force: true })
  }
})

test('l’instantané pose aussi le dossier du relecteur sous le dossier de job, sans rien perdre de ce qu’il porte', () => {
  const { dir, wt } = worktree()
  const job = jobDir()
  try {
    const path = join(job, 'tmp', 'revue-T08')
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'notes.md'), 'notes de la première passe\n')
    writeFileSync(join(wt, 'a.txt'), 'a modifié\n')
    const out = snapJob(wt, job, 'T08', 'a.txt')
    assert.equal(out.status, 0, out.stderr)
    assert.equal(printedDir(out), path)
    assert.equal(readFileSync(join(path, 'notes.md'), 'utf8'), 'notes de la première passe\n')
    assert.ok(!existsSync(join(gitDirOf(wt), 'flow-board')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(job, { recursive: true, force: true })
  }
})

// --clean : son invariant, « une référence d'instantané n'est supprimée que si chaque fichier de
// l'instantané, à sa version figée, se trouve dans un commit de la branche », et jamais celle d'un autre ticket.
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

// Rétro « Coordinateur de parcours » : invariant de --clean, « une référence d'instantané n'est supprimée que si
// chaque fichier de l'instantané, à sa version figée, se trouve dans un commit de la branche ». --clean juge chaque
// fichier à part : un ticket commité en deux fois, le ticket suivant entre les deux, ne le fait plus refuser.
test('--clean réussit quand chaque fichier figé est dans un commit de la branche, même si aucun ne les porte tous ensemble', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket\n')
    assert.equal(snap(dir, 'T40', 'a.txt', 'b.txt').status, 0)
    // a.txt se commite seul (par son chemin : l'instantané a indexé les deux) ; le ticket suivant le change et se
    // commite ; puis b.txt se commite.
    git(dir, 'commit', '-q', '-m', 'ticket T40, a', '--', 'a.txt')
    writeFileSync(join(dir, 'a.txt'), 'a du ticket suivant\n')
    git(dir, 'commit', '-q', '-m', 'ticket suivant', '--', 'a.txt')
    git(dir, 'commit', '-q', '-m', 'ticket T40, b', '--', 'b.txt')
    const first = git(dir, 'rev-parse', 'HEAD~2')
    const last = git(dir, 'rev-parse', 'HEAD')
    const out = snap(dir, '--clean', 'T40')
    assert.equal(out.status, 0, out.stderr)
    assert.match(out.stdout, /refs\/worktree\/flow-board\/T40 supprimée/)
    // Les deux commits du ticket, pas celui du ticket suivant.
    assert.ok(out.stdout.includes(`les commits ${first}, ${last} de la branche portent les 2 fichiers`), out.stdout)
    assert.ok(!hasRef(dir, T('T40')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Déjà vrai avec la recherche d'un seul commit ; gardé contre une régression de la recherche fichier par fichier.
test('--clean réussit après un commit du ticket suivant qui change les mêmes fichiers', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    assert.equal(snap(dir, 'T41', 'a.txt').status, 0)
    commitAll(dir, 'ticket T41', 'a.txt')
    writeFileSync(join(dir, 'a.txt'), 'a du ticket suivant\n')
    commitAll(dir, 'ticket suivant', 'a.txt')
    const ticketCommit = git(dir, 'rev-parse', 'HEAD~1')
    const out = snap(dir, '--clean', 'T41')
    assert.equal(out.status, 0, out.stderr)
    // Le commit nommé est celui du ticket, le plus ancien qui amène la version figée.
    assert.ok(out.stdout.includes(`le commit ${ticketCommit} de la branche porte le fichier`), out.stdout)
    assert.ok(!hasRef(dir, T('T41')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean refuse un fichier figé jamais commité, et ne nomme que les fichiers sans commit', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket\n')
    assert.equal(snap(dir, 'T42', 'a.txt', 'b.txt').status, 0)
    git(dir, 'commit', '-q', '-m', 'ticket T42', '--', 'a.txt')
    // b.txt est commité à une autre version que la figée (un correctif sans instantané reposé), puis a.txt change encore.
    writeFileSync(join(dir, 'b.txt'), 'b corrigé sans instantané reposé\n')
    commitAll(dir, 'reste', 'b.txt')
    writeFileSync(join(dir, 'a.txt'), 'a du ticket suivant\n')
    commitAll(dir, 'ticket suivant', 'a.txt')
    const out = snap(dir, '--clean', 'T42')
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stderr, /sans commit qui les porte à leur version figée : b\.txt\b/)
    assert.doesNotMatch(out.stderr, /sans commit qui les porte à leur version figée : [^;]*a\.txt/)
    assert.ok(hasRef(dir, T('T42')), 'la référence a été supprimée')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--clean ne compte pas un commit de fusion de la première lignée, même s’il porte la version figée', () => {
  const dir = repo()
  try {
    const base = git(dir, 'rev-parse', 'HEAD')
    // Le ticket donne à a.txt une version que porte aussi une autre branche, fusionnée ensuite.
    writeFileSync(join(dir, 'a.txt'), 'même texte\n')
    assert.equal(snap(dir, 'T43', 'a.txt').status, 0)
    git(dir, 'restore', '--staged', 'a.txt')
    git(dir, 'checkout', '--', 'a.txt')
    git(dir, 'branch', 'cote', base)
    git(dir, 'checkout', '-q', 'cote')
    writeFileSync(join(dir, 'a.txt'), 'même texte\n')
    commitAll(dir, 'côté', 'a.txt')
    git(dir, 'checkout', '-q', '-')
    git(dir, 'merge', '-q', '--no-ff', '-m', 'fusion', 'cote')
    let out = snap(dir, '--clean', 'T43')
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stderr, /sans commit qui les porte à leur version figée : a\.txt \(/)
    assert.ok(hasRef(dir, T('T43')), 'supprimée sur la seule foi d’un commit de fusion')
    // Un commit venu après la fusion hérite de sa version de a.txt sans la changer : il ne compte pas non plus.
    writeFileSync(join(dir, 'b.txt'), 'b après la fusion\n')
    commitAll(dir, 'après', 'b.txt')
    out = snap(dir, '--clean', 'T43')
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stderr, /sans commit qui les porte à leur version figée : a\.txt \(/)
    assert.ok(hasRef(dir, T('T43')), 'supprimée sur un commit qui n’a fait qu’hériter de la fusion')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Passe « bogues » du ticket : une branche de travail ramenée par une avance rapide sur une fusion (la branche du
// groupe fusionnée dans main, puis main repris) met les commits de main sur sa première lignée ; un fichier que le
// ticket supprime n'y a jamais existé, et ne doit pas passer pour « supprimé par un commit de la branche ».
test('--clean ne prend pas pour la suppression du ticket un commit d’une autre branche ramené par une avance rapide', () => {
  const dir = repo()
  try {
    const trunk = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
    git(dir, 'checkout', '-q', '-b', 'groupe')
    writeFileSync(join(dir, 'x.txt'), 'x\n')
    commitAll(dir, 'x créé', 'x.txt')
    // Le ticket supprime x.txt et change a.txt ; la suppression se perd avant le commit, a.txt se commite.
    unlinkSync(join(dir, 'x.txt'))
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    assert.equal(snap(dir, 'T44', 'x.txt', 'a.txt').status, 0)
    git(dir, 'restore', '--staged', 'x.txt')
    git(dir, 'checkout', '--', 'x.txt')
    git(dir, 'commit', '-q', '-m', 'ticket T44', '--', 'a.txt')
    // main avance sans x.txt, fusionne le groupe, et le groupe reprend main par une avance rapide.
    git(dir, 'checkout', '-q', trunk)
    writeFileSync(join(dir, 'b.txt'), 'b de main\n')
    commitAll(dir, 'main avance', 'b.txt')
    git(dir, 'merge', '-q', '--no-ff', '-m', 'fusion du groupe', 'groupe')
    git(dir, 'checkout', '-q', 'groupe')
    git(dir, 'merge', '-q', '--ff-only', trunk)
    writeFileSync(join(dir, 'c.txt'), 'c\n')
    commitAll(dir, 'ensuite', 'c.txt')
    assert.ok(existsSync(join(dir, 'x.txt')), 'HEAD porte toujours x.txt')
    const out = snap(dir, '--clean', 'T44')
    assert.equal(out.status, 1, out.stdout)
    // Le parent de l'instantané est entré par le second parent de la fusion : refusé avant toute recherche.
    assert.match(out.stderr, /n'est pas sur la première lignée de HEAD/)
    assert.ok(hasRef(dir, T('T44')), 'supprimée alors que la suppression de x.txt n’est dans aucun commit de la branche')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Passe d'après les correctifs : une autre branche dont la première lignée a repris le parent de l'instantané par
// un second parent, et dont un commit a supprimé son propre x.txt, ne passe pas pour la branche du ticket.
test('--clean refuse quand le parent de l’instantané n’est pas sur la première lignée de HEAD', () => {
  const dir = repo()
  try {
    const trunk = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
    git(dir, 'checkout', '-q', '-b', 'groupe')
    writeFileSync(join(dir, 'x.txt'), 'x\n')
    commitAll(dir, 'x créé', 'x.txt')
    unlinkSync(join(dir, 'x.txt'))
    assert.equal(snap(dir, 'T45', 'x.txt').status, 0)
    git(dir, 'restore', '--staged', 'x.txt')
    git(dir, 'checkout', '--', 'x.txt')
    // main reprend le groupe par une fusion (second parent), puis supprime x.txt pour son compte.
    git(dir, 'checkout', '-q', trunk)
    writeFileSync(join(dir, 'b.txt'), 'b de main\n')
    commitAll(dir, 'main avance', 'b.txt')
    git(dir, 'merge', '-q', '--no-ff', '-m', 'fusion du groupe', 'groupe')
    git(dir, 'rm', '-q', 'x.txt')
    git(dir, 'commit', '-q', '-m', 'main supprime x')
    // Le worktree du groupe reprend main par une avance rapide.
    git(dir, 'checkout', '-q', 'groupe')
    git(dir, 'merge', '-q', '--ff-only', trunk)
    const out = snap(dir, '--clean', 'T45')
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stderr, /n'est pas sur la première lignée de HEAD/)
    assert.ok(hasRef(dir, T('T45')), 'supprimée sur la suppression de x.txt faite par main')
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
    assert.match(out.stderr, /sans commit qui les porte à leur version figée : b\.txt \(/)
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
    // L'instantané n'indexe rien : la session indexe le ticket à sa version figée.
    git(dir, 'add', 'a.txt')
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
    // Refusé après la construction de l'arbre : l'index temporaire est parti quand même.
    assert.deepEqual(strayIndexes(dir), [])
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
    // L'instantané n'indexe rien : la session indexe le ticket, puis le commite.
    git(dir, 'add', 'a.txt', 'b.txt')
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

test('un instantané reposé ne réécrit pas l’index de la session, même pour y rafraîchir la date d’un fichier du précédent au contenu inchangé', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket\n')
    assert.equal(snap(dir, 'T35', 'a.txt', 'b.txt').status, 0)
    commitAll(dir, 'ticket T35', 'a.txt', 'b.txt')
    // a.txt réécrit au même contenu, à une autre date : l'index le croit changé tant que rien ne l'y rafraîchit.
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    const later = new Date(Date.now() + 5000)
    utimesSync(join(dir, 'a.txt'), later, later)
    writeFileSync(join(dir, 'b.txt'), 'b du ticket, corrigé\n')
    const before = indexBytes(dir)
    // Reposé sur b.txt seul : la garde relit a.txt (du précédent, non nommé) face à HEAD, sans écrire dans l'index.
    const out = snap(dir, 'T35', 'b.txt')
    assert.equal(out.status, 0, out.stderr)
    assert.ok(indexBytes(dir).equals(before), 'le fichier d’index a été réécrit')
    assert.deepEqual(strayIndexes(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un instantané reposé sans un fichier nouveau du précédent, pas encore suivi ni indexé, est refusé : la session n’indexe plus rien avant son commit', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'n.txt'), 'nouveau fichier du ticket\n')
    assert.equal(snap(dir, 'T37', 'a.txt', 'n.txt').status, 0)
    const first = git(dir, 'rev-parse', T('T37'))
    writeFileSync(join(dir, 'a.txt'), 'a du ticket, corrigé\n')
    const before = indexBytes(dir)
    // n.txt n'est ni dans HEAD ni dans l'index de la session : seul l'arbre de travail le porte.
    const out = snap(dir, 'T37', 'a.txt')
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stderr, /porte aussi n\.txt, que celui-ci ne porte pas et qui a encore un changement non commité : le reposer en nommant tous les fichiers du ticket/)
    assert.equal(git(dir, 'rev-parse', T('T37')), first, 'la référence a bougé')
    assert.ok(indexBytes(dir).equals(before), 'le fichier d’index a changé')
    assert.deepEqual(strayIndexes(dir), [])
    // Nommé, il y entre ; retiré du disque (le ticket n'en veut plus), il n'a plus rien à commiter.
    assert.equal(snap(dir, 'T37', 'a.txt', 'n.txt').status, 0)
    unlinkSync(join(dir, 'n.txt'))
    assert.equal(snap(dir, 'T37', 'a.txt').status, 0)
    assert.equal(git(dir, 'diff', '--name-only', `${T('T37')}^..${T('T37')}`), 'a.txt')
    // Refusée ou réussie, la repose n'a pas touché à l'index de la session.
    assert.ok(indexBytes(dir).equals(before), 'le fichier d’index a changé après les reposes réussies')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un instantané reposé passe quand un fichier nouveau du précédent a disparu avec son dossier, devenu un fichier, ou qu’il est désormais ignoré', () => {
  const dir = repo()
  try {
    mkdirSync(join(dir, 'd'))
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'd', 'f.txt'), 'nouveau fichier du ticket\n')
    assert.equal(snap(dir, 'T39', 'a.txt', 'd/f.txt').status, 0)
    // d/f.txt n'existe plus : son dossier est devenu un fichier, il n'a plus rien à commiter.
    rmSync(join(dir, 'd'), { recursive: true })
    writeFileSync(join(dir, 'd'), 'un fichier à la place du dossier\n')
    writeFileSync(join(dir, 'a.txt'), 'a du ticket, corrigé\n')
    const before = indexBytes(dir)
    const gone = snap(dir, 'T39', 'a.txt')
    assert.equal(gone.status, 0, gone.stderr)
    assert.ok(indexBytes(dir).equals(before), 'le fichier d’index a changé')
    // Un fichier nouveau du précédent que .gitignore couvre maintenant : la garde le nomme, au lieu d'un échec de git.
    writeFileSync(join(dir, 'n.txt'), 'nouveau\n')
    assert.equal(snap(dir, 'T40', 'a.txt', 'n.txt').status, 0)
    writeFileSync(join(dir, '.gitignore'), 'n.txt\n')
    writeFileSync(join(dir, 'a.txt'), 'a du ticket, corrigé encore\n')
    const ignored = snap(dir, 'T40', 'a.txt')
    assert.equal(ignored.status, 1)
    assert.match(ignored.stderr, /porte aussi n\.txt, que celui-ci ne porte pas et qui a encore un changement non commité/)
    assert.deepEqual(strayIndexes(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('avec un index partagé (core.splitIndex), l’index temporaire ne laisse rien dans le dossier git', () => {
  const dir = repo()
  try {
    git(dir, 'config', 'core.splitIndex', 'true')
    git(dir, 'update-index', '--split-index')
    const left = () => readdirSync(gitDirOf(dir)).filter(name => name.startsWith('sharedindex.') || name.startsWith('flow-board-index-')).sort()
    const before = left()
    writeFileSync(join(dir, 'a.txt'), 'a modifié\n')
    const out = snap(dir, 'T41', 'a.txt')
    assert.equal(out.status, 0, out.stderr)
    assert.deepEqual(left(), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un instantané reposé sans un fichier du précédent que la session a indexé, même ramené à HEAD dans l’arbre, est refusé', () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
    writeFileSync(join(dir, 'b.txt'), 'b du ticket\n')
    assert.equal(snap(dir, 'T38', 'a.txt', 'b.txt').status, 0)
    // b.txt indexé à sa version du ticket, puis l'arbre ramené à HEAD : l'index porte encore le changement.
    git(dir, 'add', 'b.txt')
    writeFileSync(join(dir, 'b.txt'), 'b\n')
    writeFileSync(join(dir, 'a.txt'), 'a du ticket, corrigé\n')
    const out = snap(dir, 'T38', 'a.txt')
    assert.equal(out.status, 1, out.stdout)
    assert.match(out.stderr, /porte aussi b\.txt/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Le refus demandait de « reposer en nommant tous les fichiers du ticket » alors que le fichier était nommé.
test('un instantané reposé en nommant un fichier du précédent ramené à HEAD dans l’arbre passe, même indexé à une autre version, sans toucher à l’index', () => {
  for (const named of ['b.txt', './b.txt', 'sous/../b.txt']) {
    const dir = repo()
    try {
      mkdirSync(join(dir, 'sous'))
      writeFileSync(join(dir, 'a.txt'), 'a du ticket\n')
      writeFileSync(join(dir, 'b.txt'), 'b du ticket\n')
      assert.equal(snap(dir, 'T39', 'a.txt', 'b.txt').status, 0)
      git(dir, 'add', 'b.txt')
      writeFileSync(join(dir, 'b.txt'), 'b\n')
      writeFileSync(join(dir, 'a.txt'), 'a du ticket, corrigé\n')
      const before = indexBytes(dir)
      // Nommé, b.txt se juge sur sa version de l'arbre de travail, celle de HEAD : l'instantané ne le porte plus.
      const out = snap(dir, 'T39', 'a.txt', named)
      assert.equal(out.status, 0, `${named} : ${out.stderr}`)
      assert.equal(git(dir, 'diff', '--name-only', `${T('T39')}^`, T('T39')), 'a.txt')
      assert.deepEqual(indexBytes(dir), before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('dans un worktree, l’instantané prend la version de l’arbre de travail d’un fichier nommé, même indexé à une autre version, et laisse l’index tel quel', () => {
  const { dir, wt } = worktree()
  try {
    writeFileSync(join(wt, 'a.txt'), 'a indexé\n')
    git(wt, 'add', 'a.txt')
    writeFileSync(join(wt, 'a.txt'), 'a de l’arbre\n')
    const before = indexBytes(wt)
    const out = snap(wt, 'T36', 'a.txt')
    assert.equal(out.status, 0, out.stderr)
    assert.equal(git(wt, 'show', 'refs/worktree/flow-board/T36:a.txt'), 'a de l’arbre')
    assert.ok(indexBytes(wt).equals(before), 'le fichier d’index a changé')
    assert.equal(git(wt, 'show', ':a.txt'), 'a indexé')
    assert.equal(readFileSync(join(wt, 'a.txt'), 'utf8'), 'a de l’arbre\n')
    // L'index temporaire vivait dans le dossier git du worktree : il n'en reste rien, ni là ni dans le clone.
    assert.deepEqual(strayIndexes(wt), [])
    assert.deepEqual(strayIndexes(dir), [])
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

test('la procédure fait reposer l’instantané avant le git add des correctifs, et dit la règle fichier par fichier de --clean', () => {
  assert.ok(procedure.includes("d'abord reposer l'instantané par la même commande, juste avant le `git add` des correctifs, quand un fichier du ticket a changé depuis le dernier"), 'la procédure ne fait pas reposer l’instantané avant le git add des correctifs')
  assert.ok(procedure.includes('par un commit de la branche depuis le parent de l\'instantané qui change ce fichier, fusions exclues, pas forcément le même pour tous, même si un commit plus récent (le ticket suivant) l\'a changé depuis'), 'la procédure garde l’ancienne règle de --clean')
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
  // Les trois disent où est le dossier (le dossier temporaire de la session, où l'outil Write passe, sinon
  // le dossier git du worktree) et comment y faire un essai.
  const essai = 'se fait par un script écrit dans ce dossier par l\'outil Write, puis lancé par une commande simple, jamais par un heredoc ni une commande composée, et n\'écrit que dans ce dossier'
  assert.ok(consignes.includes(`un essai (un scénario à rejouer, une commande git d'essai) ${essai} ; si l'outil Write y est refusé, rendre le scénario d'essai en texte`), 'consignes-revue.md : l’essai')
  assert.ok(consignes.includes('dans le dossier temporaire de la session quand elle en a un (`CLAUDE_JOB_DIR`, une session de fond), où l\'outil Write passe, sinon dans le dossier git du worktree'), 'consignes-revue.md : l’endroit')
  assert.equal(prompt.split(`Un essai (un scénario à rejouer, une commande git d'essai) ${essai}. Sans dossier où écrire (ou si l'outil Write y est refusé), n'écris rien : lis par \`git show\` et \`git diff\`, et rends ton scénario d'essai en texte.`).length - 1, 2, 'prompt-relecteur.md : l’essai, dans les deux variantes')
  assert.equal(prompt.split('(dans le dossier temporaire de la session quand elle en a un, sinon dans le dossier git du worktree ; hors de l\'arbre suivi)').length - 1, 2, 'prompt-relecteur.md : l’endroit')
  assert.ok(securite.includes(`Un essai (un scénario à rejouer, une commande git d'essai) ${essai} ; sans dossier où écrire (ou si l'outil Write y est refusé), rends ton scénario d'essai en texte.`), 'revue-securite.md : l’essai')
  assert.ok(securite.includes('dans le dossier temporaire de la session quand elle en a un (`CLAUDE_JOB_DIR`, une session de fond), où l\'outil Write passe, sinon dans le dossier git du worktree (`git rev-parse --git-path flow-board/revue-securite-<id du groupe>`)'), 'revue-securite.md : l’endroit')
  for (const [name, text] of [['consignes-revue.md', consignes], ['prompt-relecteur.md', prompt], ['revue-securite.md', securite]]) assert.ok(!text.includes('propre à ce worktree'), `${name} dit encore « propre à ce worktree »`)
  assert.ok(procedure.includes('`--relecteur <id du ticket>`, qui crée le dossier du relecteur'), 'la procédure ne cite pas --relecteur')
  assert.ok(procedure.includes('`node <dossier de flow-board>/scripts/snapshot.mjs --dossier <id>`'), 'la procédure ne cite pas --dossier')
  assert.ok(securite.includes('que celui qui te lance crée en écrivant tes consignes (`consignes.mjs --securite <id du groupe>`, ou `snapshot.mjs --dossier securite-<id du groupe>`)'), 'revue-securite.md ne cite pas consignes.mjs --securite')
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
