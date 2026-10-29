// Les commandes que copie « ↺ Rouvrir » (reopenText, hooks/closing.ts), exécutées pour de vrai : leurs
// défauts (une HEAD détachée, un échec silencieux) n'avaient été trouvés que par raisonnement. Un
// dépôt git temporaire, une branche gardée, un faux `claude` dans le PATH qui note où et avec quoi il
// est lancé. La variante PowerShell ne tourne que sous Windows avec `pwsh` ; sinon le test le dit et
// la saute (série de décisions du parcours « Fermeture auto des sessions liées », POSIX seulement).
// Node lit closing.ts en retirant ses types (Node 22.18 ou plus récent) ; plus ancien, le test le dit.

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

/** Node lit le TypeScript en retirant ses types depuis la 22.18 : plus ancien, le test se saute en le disant ; sinon une erreur d'import fait échouer. */
const [major, minor] = process.versions.node.split('.').map(Number)
const isOldNode = major < 22 || (major === 22 && minor < 18)
const closing = isOldNode ? null : await import('../hooks/closing.ts')
const model = isOldNode ? null : await import('../hooks/model.ts')
const SKIP_TS = closing ? false : `Node ${process.versions.node} ne lit pas closing.ts : il faut Node 22.18 ou plus récent`

const UUID = '178bd61c-0416-4d88-8317-cc583d9f0d47'
const BRANCH = 'worktree-groupe-essai-A'
const target = { kind: 'group', id: 'A', name: 'Alpha' }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** Un dépôt dans un dossier dont le nom a une espace, une branche gardée, un faux claude dans le PATH. */
const world = () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'rouvrir-')))
  const root = join(base, 'mes projets', 'boutique')
  mkdirSync(root, { recursive: true })
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'essai')
  git(root, 'config', 'user.email', 'essai@localhost')
  git(root, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, 'a.txt'), 'a\n')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'base')
  git(root, 'branch', BRANCH)
  const bin = join(base, 'bin')
  mkdirSync(bin)
  const calls = join(base, 'claude-calls.txt')
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > '${calls}'\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` }
  return { base, root, calls, env, worktree: join(root, '.claude', 'worktrees', 'groupe-essai-a') }
}

const command = (w, more = {}) => {
  const run = model.newRun('implement', 1_000, 'Essai')
  const closed = { state: 'closed', at: 5_000, sessionId: UUID, branch: BRANCH, worktree: w.worktree, ...more }
  return closing.reopenText({ run, target, closing: closed, root: w.root })
}

/** Lance la commande copiée dans sh, depuis un autre dossier que le dépôt. */
const sh = (w, text) => spawnSync('sh', ['-c', text], { cwd: w.base, env: w.env, encoding: 'utf8' })

test('POSIX : le worktree est recréé sur sa branche gardée, pas en HEAD détachée, puis claude reprend la conversation dedans', { skip: SKIP_TS }, () => {
  const w = world()
  try {
    const out = command(w)
    assert.ok(out && !out.isApp, 'aucune commande pour une session du CLI')
    const ran = sh(w, out.text)
    assert.equal(ran.status, 0, ran.stderr)
    assert.equal(git(w.worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), BRANCH)
    const [pwd, ...args] = readFileSync(w.calls, 'utf8').trim().split('\n')
    assert.equal(realpathSync(pwd), realpathSync(w.worktree))
    assert.deepEqual(args, ['--resume', UUID])
  } finally {
    rmSync(w.base, { recursive: true, force: true })
  }
})

test('POSIX : une branche absente ne crée rien et ne lance pas claude', { skip: SKIP_TS }, () => {
  const w = world()
  try {
    const out = command(w, { branch: 'worktree-groupe-essai-B' })
    const ran = sh(w, out.text)
    assert.notEqual(ran.status, 0)
    assert.equal(existsSync(w.worktree), false)
    assert.equal(existsSync(w.calls), false)
  } finally {
    rmSync(w.base, { recursive: true, force: true })
  }
})

test('POSIX : un chemin déjà pris n’est pas touché, et claude ne se lance pas', { skip: SKIP_TS }, () => {
  const w = world()
  try {
    mkdirSync(w.worktree, { recursive: true })
    writeFileSync(join(w.worktree, 'garde.txt'), 'à moi\n')
    const ran = sh(w, command(w).text)
    assert.notEqual(ran.status, 0)
    assert.equal(readFileSync(join(w.worktree, 'garde.txt'), 'utf8'), 'à moi\n')
    assert.equal(existsSync(w.calls), false)
    // Le même nom de branche déjà pris par un autre worktree : refusé aussi, sans rien lancer.
    rmSync(w.worktree, { recursive: true, force: true })
    git(w.root, 'worktree', 'add', '-q', join(w.base, 'ailleurs'), BRANCH)
    const twice = sh(w, command(w).text)
    assert.notEqual(twice.status, 0)
    assert.equal(existsSync(w.calls), false)
  } finally {
    rmSync(w.base, { recursive: true, force: true })
  }
})

test('une apostrophe dans le chemin du dépôt : aucune commande copiée', { skip: SKIP_TS }, () => {
  const w = world()
  try {
    const root = join(w.base, "l'été", 'boutique')
    const out = command({ ...w, root, worktree: join(root, '.claude', 'worktrees', 'groupe-essai-a') })
    assert.equal(out, null)
  } finally {
    rmSync(w.base, { recursive: true, force: true })
  }
})

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0
const SKIP_PWSH = SKIP_TS || (!hasPwsh ? 'pwsh absent : variante PowerShell sautée' : process.platform !== 'win32' ? 'variante PowerShell : chemins Windows, sous Windows seulement' : false)

test('PowerShell : le worktree est recréé sur sa branche, puis claude reprend dedans', { skip: SKIP_PWSH }, () => {
  const w = world()
  try {
    const out = command({ ...w, root: w.root.replace(/\\/g, '/'), worktree: w.worktree.replace(/\\/g, '/') })
    assert.ok(out, 'aucune commande')
    const ran = spawnSync('pwsh', ['-NoProfile', '-Command', out.text], { cwd: w.base, env: w.env, encoding: 'utf8' })
    assert.equal(ran.status, 0, ran.stderr)
    assert.equal(git(w.worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), BRANCH)
  } finally {
    rmSync(w.base, { recursive: true, force: true })
  }
})
