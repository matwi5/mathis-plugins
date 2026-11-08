// Le script de vérification d'une fermeture (scripts/fermeture.mjs) : la réponse de l'outil flow le cite
// au lieu de recopier la procédure entière. Ces tests le lancent pour de vrai, dans un dépôt git
// temporaire avec un worktree de worker, et un faux `claude agents --json` (FLOW_BOARD_CLAUDE).
// Invariant : une fermeture ne fait jamais perdre un commit, un fichier modifié ou non suivi, ni la
// conversation d'un worker ; le script ne rend « SÛR » que si tout tient, et n'arrête ni ne retire rien.

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isDisposable, isSafeBranch, nextStep, parseArgs, parsePorcelain, staleSessionLock } from '../scripts/fermeture.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/fermeture.mjs', import.meta.url))
const CLOSING = readFileSync(new URL('../hooks/closing.ts', import.meta.url), 'utf8')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const NAME = 'groupe-essai-a'

/**
 * Un dépôt (branche de travail `main`) avec un worktree de worker sous .claude/worktrees/<NAME>, sur la
 * branche `worktree-<NAME>`, un commit à lui ; `isMerged` : ce commit fusionné dans `main`. Rend les
 * chemins et un faux `claude` dont la sortie se règle par `agents(…)`.
 */
const setup = ({ isMerged = true } = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fermeture-')))
  const repo = join(root, 'depot')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'essai')
  git(repo, 'config', 'user.email', 'essai@localhost')
  git(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, '.gitignore'), '.claude/\nnode_modules/\n*.pyc\nsecret.env\n')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'base')
  const wt = join(repo, '.claude', 'worktrees', NAME)
  git(repo, 'worktree', 'add', '-q', '-b', `worktree-${NAME}`, wt)
  writeFileSync(join(wt, 'b.txt'), 'b\n')
  git(wt, 'add', 'b.txt')
  git(wt, 'commit', '-q', '-m', 'travail du groupe')
  if (isMerged) git(repo, 'merge', '-q', '--ff-only', `worktree-${NAME}`)
  // Le faux claude : il imprime le fichier agents.json (ou agents-all.json avec --all), ou échoue s'il manque.
  const bin = join(root, 'claude')
  writeFileSync(bin, `#!/bin/sh\ncase "$*" in *--all*) f='${root}/agents-all.json';; *) f='${root}/agents.json';; esac\n[ -f "$f" ] || exit 7\ncat "$f"\n`)
  chmodSync(bin, 0o755)
  const agents = (running, all = running) => {
    writeFileSync(join(root, 'agents.json'), JSON.stringify(running))
    writeFileSync(join(root, 'agents-all.json'), JSON.stringify(all))
  }
  agents([])
  return { root, repo, wt, bin, agents }
}

const run = (s, ...args) => spawnSync(process.execPath, [SCRIPT, '--worktree', NAME, '--branche', `worktree-${NAME}`, '--branche', NAME, ...args], { cwd: s.repo, encoding: 'utf8', env: { ...process.env, FLOW_BOARD_CLAUDE: s.bin } })

const idle = s => ({ pid: 4242, id: 'abc12345', cwd: s.wt, sessionId: '11111111-2222-3333-4444-555555555555', name: 'M > Groupe A · x', status: 'idle', state: 'done' })

const head = out => out.stdout.split('\n')[0]

/** La dernière ligne de la sortie : le seul geste à faire sur ce verdict. */
const last = out => out.stdout.trimEnd().split('\n').at(-1)

/** Rien n'a bougé : le worktree, sa branche et son commit sont là. */
const intact = s => {
  assert.ok(existsSync(s.wt), 'le worktree est toujours là')
  assert.equal(git(s.repo, 'rev-parse', '--verify', `refs/heads/worktree-${NAME}`).length, 40)
}

const within = (fn, opts) => {
  const s = setup(opts)
  try {
    fn(s)
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
}

test('tout tient : SÛR avant l’arrêt, avec la commande d’arrêt ; puis, la session arrêtée, SÛR avec la commande de retrait', () =>
  within(s => {
    s.agents([idle(s)])
    const before = run(s, '--session', 'abc12345')
    assert.equal(before.status, 0, before.stdout + before.stderr)
    assert.equal(head(before), 'SÛR')
    assert.match(before.stdout, new RegExp(`worktree : ${s.wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(before.stdout, /branche de travail : main/)
    assert.match(before.stdout, /fusion : worktree-groupe-essai-a est entièrement dans main \(vérifié\) ; 2 de ses commits ne sont sur aucun dépôt distant/)
    assert.match(before.stdout, /session : abc12345, au repos .* arrêt : claude stop 'abc12345'/)
    assert.doesNotMatch(before.stdout, /git worktree remove/)
    assert.equal(last(before), nextStep('SÛR', false, 'idle'))
    intact(s)
    // La session arrêtée : absente de --json, montrée sans pid par --all.
    s.agents([], [{ ...idle(s), pid: undefined, state: 'stopped' }])
    const after = run(s, '--session', 'abc12345', '--apres-arret')
    assert.equal(after.status, 0, after.stdout)
    assert.equal(head(after), 'SÛR')
    assert.match(after.stdout, /session : arrêtée \(sessionId 11111111-2222-3333-4444-555555555555\)/)
    assert.ok(after.stdout.includes(`commande : git worktree remove '${s.wt}' (sans option ; la branche worktree-groupe-essai-a reste)`))
    assert.equal(last(after), nextStep('SÛR', true, 'stopped'))
    intact(s)
  }))

test('la dernière ligne dit le seul geste du verdict : arrêter puis revérifier, retirer, attendre, ou ne rien fermer', () => {
  assert.equal(nextStep('SÛR', false, 'idle'), 'suite : arrête la session (la commande claude stop ci-dessus), puis relance cette commande avec --apres-arret')
  assert.equal(nextStep('SÛR', true, 'stopped'), 'suite : lance la commande de retrait ci-dessus, sans option ; la branche reste : ne la supprime pas')
  // Une session de l'app, ou absente de claude agents : le contrôle ListAgents passe avant tout geste, jamais un arrêt direct.
  assert.match(nextStep('SÛR', false, 'app'), /^suite : vérifie d’abord par ListAgents que la session de l’app y est au repos \(busy : n’arrête rien, remets la fermeture à plus tard ; absente : déjà archivée, rien à arrêter\) ; seulement alors, archive-la/)
  assert.match(nextStep('SÛR', true, 'app'), /^suite : vérifie d’abord par ListAgents que la session de l’app n’y est plus \(archivée\) ; puis lance la commande de retrait/)
  for (const after of [false, true]) assert.match(nextStep('SÛR', after, 'absent'), /^suite : vérifie d’abord par ListAgents qu’aucune session de ce worker n’est encore là \(une ligne busy ou idle : n’arrête rien et demande à la personne\)/)
  assert.equal(nextStep('SÛR', false, 'stopped'), 'suite : la session est déjà arrêtée : relance cette commande avec --apres-arret')
  for (const session of ['app', 'absent', 'stopped']) assert.doesNotMatch(nextStep('SÛR', false, session), /claude stop/)
  assert.match(nextStep('ATTENDRE', false), /^suite : n’arrête rien, ne retire rien ; remets la fermeture à plus tard/)
  assert.match(nextStep('DÉJÀ RETIRÉ', true, 'stopped'), /^suite : rien à arrêter ; rien à retirer/)
  for (const verdict of ['ARRÊT', 'ÉCHEC', 'inconnu']) assert.match(nextStep(verdict, true), /^suite : ne ferme rien \(n’arrête aucune session, ne retire aucun worktree\).*"state": "stopped"/)
})

test('un commit pas fusionné : ARRÊT, sans rien arrêter ni retirer', () =>
  within(
    s => {
      s.agents([idle(s)])
      const out = run(s, '--session', 'abc12345')
      assert.equal(out.status, 2)
      assert.match(head(out), /^ARRÊT : 1 commit\(s\) de worktree-groupe-essai-a ne sont pas dans main/)
      intact(s)
    },
    { isMerged: false },
  ))

test('un fichier inconnu (modifié, non suivi, ou ignoré hors de la liste jetable) : ARRÊT', () =>
  within(s => {
    s.agents([idle(s)])
    writeFileSync(join(s.wt, 'brouillon.txt'), 'pas commité\n')
    let out = run(s, '--session', 'abc12345')
    assert.equal(out.status, 2)
    assert.match(head(out), /^ARRÊT : l'arbre du worktree porte des fichiers modifiés ou non suivis : brouillon\.txt/)
    rmSync(join(s.wt, 'brouillon.txt'))
    writeFileSync(join(s.wt, 'a.txt'), 'modifié\n')
    out = run(s, '--session', 'abc12345')
    assert.match(head(out), /^ARRÊT : l'arbre du worktree porte des fichiers modifiés ou non suivis : a\.txt/)
    git(s.wt, 'checkout', '--', 'a.txt')
    // Un fichier ignoré qui n'est pas de la liste jetable (un secret) arrête aussi.
    writeFileSync(join(s.wt, 'secret.env'), 'X=1\n')
    out = run(s, '--session', 'abc12345')
    assert.match(head(out), /^ARRÊT : des fichiers ignorés hors de la liste jetable : secret\.env/)
    rmSync(join(s.wt, 'secret.env'))
    // La liste jetable : node_modules, .pyc, lien symbolique ignorés passent.
    mkdirSync(join(s.wt, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(s.wt, 'node_modules', 'x', 'i.js'), '1\n')
    writeFileSync(join(s.wt, 'm.pyc'), '\n')
    out = run(s, '--session', 'abc12345')
    assert.equal(head(out), 'SÛR', out.stdout)
    assert.match(out.stdout, /arbre : propre \(2 fichier\(s\) ignoré\(s\), tous de la liste jetable\)/)
    intact(s)
  }))

test('un instantané de revue dont l’arbre n’est dans aucun commit de la branche de travail : ARRÊT', () =>
  within(s => {
    s.agents([idle(s)])
    writeFileSync(join(s.wt, 'c.txt'), 'version figée\n')
    git(s.wt, 'add', 'c.txt')
    const tree = git(s.wt, 'write-tree')
    const snap = git(s.wt, 'commit-tree', tree, '-p', 'HEAD', '-m', 'flow-board snapshot 30')
    git(s.wt, 'update-ref', 'refs/worktree/flow-board/30', snap)
    git(s.wt, 'reset', '-q')
    rmSync(join(s.wt, 'c.txt'))
    const out = run(s, '--session', 'abc12345')
    assert.equal(out.status, 2)
    assert.match(head(out), /^ARRÊT : instantané\(s\) de revue dont l'arbre n'est dans aucun commit de main : refs\/worktree\/flow-board\/30/)
    intact(s)
  }))

test('une session au travail fait attendre ; une autre session dans le worktree arrête ; après l’arrêt, une session qui tourne encore arrête', () =>
  within(s => {
    s.agents([{ ...idle(s), status: 'busy', state: 'working' }])
    let out = run(s, '--session', 'abc12345')
    assert.equal(out.status, 3)
    assert.match(head(out), /^ATTENDRE : la session "abc12345" n'est pas montrée au repos/)
    // "state": "working" seul suffit ; un status absent ou inconnu aussi : seul "idle" vaut « au repos ».
    for (const odd of [{ status: 'idle', state: 'working' }, { status: undefined, state: 'blocked' }, { status: 'waiting', state: 'done' }]) {
      s.agents([{ ...idle(s), ...odd }])
      assert.equal(run(s, '--session', 'abc12345').status, 3, JSON.stringify(odd))
    }
    s.agents([idle(s), { ...idle(s), id: 'zzz99999', sessionId: 'x', name: 'autre' }])
    out = run(s, '--session', 'abc12345')
    assert.equal(out.status, 2)
    assert.match(head(out), /^ARRÊT : une autre session tourne dans le worktree : "autre"/)
    // --apres-arret alors que la session tourne encore.
    s.agents([idle(s)])
    out = run(s, '--session', 'abc12345', '--apres-arret')
    assert.equal(out.status, 2)
    assert.match(head(out), /^ARRÊT : la session "abc12345" tourne encore/)
    assert.doesNotMatch(out.stdout, /git worktree remove/)
    // Montrée par --all, mais pas arrêtée.
    s.agents([], [{ ...idle(s), pid: undefined, state: 'working' }])
    out = run(s, '--session', 'abc12345', '--apres-arret')
    assert.equal(out.status, 2)
    assert.match(head(out), /n'est pas montrée arrêtée/)
    intact(s)
  }))

test('claude introuvable, ou une sortie illisible : ÉCHEC, jamais SÛR', () =>
  within(s => {
    rmSync(join(s.root, 'agents.json'))
    let out = run(s, '--session', 'abc12345')
    assert.equal(out.status, 1)
    assert.match(head(out), /^ÉCHEC : claude agents --json a échoué/)
    writeFileSync(join(s.root, 'agents.json'), '{pas du json')
    out = run(s, '--session', 'abc12345')
    assert.equal(out.status, 1)
    assert.match(head(out), /^ÉCHEC : claude agents --json : sortie illisible/)
    intact(s)
  }))

test('une valeur hors forme : ÉCHEC avant toute commande', () =>
  within(s => {
    for (const bad of [['--worktree', "x'; rm -rf ~"], ['--worktree', '../x'], ['--branche', '-x'], ['--branche', 'refs/heads/x'], ['--session', 'a b'], ['--session', '$(id)'], ['--inconnu']]) {
      const out = spawnSync(process.execPath, [SCRIPT, '--worktree', NAME, ...bad], { cwd: s.repo, encoding: 'utf8', env: { ...process.env, FLOW_BOARD_CLAUDE: s.bin } })
      assert.equal(out.status, 1, `${bad.join(' ')} : ${out.stdout}`)
      assert.match(head(out), /^ÉCHEC : /)
    }
    intact(s)
  }))

test('core.fsmonitor qui vaut une commande, dans ce dossier ou sur le worktree : ARRÊT, sans la lancer', () =>
  within(s => {
    s.agents([idle(s)])
    const mark = join(s.root, 'lance')
    git(s.repo, 'config', 'extensions.worktreeConfig', 'true')
    git(s.wt, 'config', '--worktree', 'core.fsmonitor', `touch ${mark}`)
    const out = run(s, '--session', 'abc12345')
    assert.equal(out.status, 2)
    assert.match(head(out), /^ARRÊT : core\.fsmonitor sur le worktree vaut une commande/)
    assert.equal(existsSync(mark), false, 'la commande n’a pas été lancée')
    intact(s)
  }))

test('le worktree déjà retiré, sa branche fusionnée : DÉJÀ RETIRÉ ; un dossier encore là sans bloc : ARRÊT', () =>
  within(s => {
    git(s.repo, 'worktree', 'remove', s.wt)
    let out = run(s)
    assert.equal(out.status, 0, out.stdout)
    assert.equal(head(out), 'DÉJÀ RETIRÉ')
    assert.match(out.stdout, /fusion : worktree-groupe-essai-a est entièrement dans main \(vérifié\)/)
    assert.equal(last(out), nextStep('DÉJÀ RETIRÉ', false, 'absent'))
    // Sa session encore lancée dans le dossier disparu : déjà retiré, et la session à arrêter d'abord.
    s.agents([idle(s)])
    out = run(s, '--session', 'abc12345')
    assert.equal(out.status, 0, out.stdout)
    assert.equal(head(out), 'DÉJÀ RETIRÉ')
    assert.match(out.stdout, /arrêt : claude stop 'abc12345'/)
    assert.equal(last(out), nextStep('DÉJÀ RETIRÉ', false, 'idle'))
    assert.match(last(out), /^suite : arrête la session/)
    s.agents([])
    mkdirSync(s.wt, { recursive: true })
    out = run(s)
    assert.equal(out.status, 2)
    assert.match(head(out), /existe encore sans bloc/)
  }))

test('un verrou d’une autre origine arrête le retrait ; le verrou de la session disparue se lève', () =>
  within(s => {
    s.agents([], [])
    git(s.repo, 'worktree', 'lock', '--reason', 'posé à la main', s.wt)
    let out = run(s, '--apres-arret')
    assert.equal(out.status, 2)
    assert.match(head(out), /^ARRÊT : le worktree est verrouillé par autre chose/)
    git(s.repo, 'worktree', 'unlock', s.wt)
    git(s.repo, 'worktree', 'lock', '--reason', 'claude session M > Groupe A (pid 999999999 started)', s.wt)
    out = run(s, '--apres-arret')
    assert.equal(out.status, 0, out.stdout)
    assert.ok(out.stdout.includes(`commande : git worktree unlock '${s.wt}', puis git worktree remove '${s.wt}'`))
    intact(s)
  }))

test('une étiquette du nom de la branche ne la masque pas ; une autre référence du worktree hors de la branche de travail arrête', () =>
  within(
    s => {
      s.agents([idle(s)])
      // L'étiquette pointe sur un commit fusionné ; la branche, elle, a un commit pas fusionné.
      git(s.repo, 'tag', `worktree-${NAME}`, 'main')
      const out = run(s, '--session', 'abc12345')
      assert.equal(out.status, 2, out.stdout)
      assert.match(head(out), /^ARRÊT : 1 commit\(s\) de worktree-groupe-essai-a ne sont pas dans main/)
      intact(s)
    },
    { isMerged: false },
  ))

test('une référence propre au worktree (refs/worktree/…) hors de la branche de travail arrête : son retrait l’effacerait', () =>
  within(s => {
    s.agents([idle(s)])
    writeFileSync(join(s.wt, 'd.txt'), 'd\n')
    git(s.wt, 'add', 'd.txt')
    const tree = git(s.wt, 'write-tree')
    const lost = git(s.wt, 'commit-tree', tree, '-p', 'HEAD', '-m', 'commit détaché')
    git(s.wt, 'update-ref', 'refs/worktree/autre/x', lost)
    git(s.wt, 'reset', '-q')
    rmSync(join(s.wt, 'd.txt'))
    const out = run(s, '--session', 'abc12345')
    assert.equal(out.status, 2, out.stdout)
    assert.match(head(out), /^ARRÊT : référence\(s\) propres au worktree hors de main, que son retrait effacerait : refs\/worktree\/autre\/x/)
    intact(s)
  }))

test('une session de l’app : la dernière ligne fait passer ListAgents avant l’archivage ; une session du CLI dans son worktree arrête', () =>
  within(s => {
    s.agents([])
    let out = run(s, '--session', 'local_abc')
    assert.equal(out.status, 0, out.stdout)
    assert.equal(head(out), 'SÛR')
    assert.equal(last(out), nextStep('SÛR', false, 'app'))
    assert.match(last(out), /^suite : vérifie d’abord par ListAgents/)
    s.agents([{ ...idle(s), id: 'zzz99999', name: 'autre' }])
    out = run(s, '--session', 'local_abc')
    assert.equal(out.status, 2)
    assert.match(head(out), /^ARRÊT : une autre session tourne dans le worktree : "autre"/)
    // claude agents illisible : une session du CLI dans le worktree ne se verrait plus ; rien n'est sûr, comme au CLI.
    rmSync(join(s.root, 'agents.json'))
    out = run(s, '--session', 'local_abc')
    assert.equal(out.status, 1, out.stdout)
    assert.match(head(out), /^ÉCHEC : /)
    assert.equal(last(out), nextStep('ÉCHEC', false))
    intact(s)
  }))

test('sans --session, une session dans le worktree n’est jamais prise pour le worker ; un id relu hors forme n’entre pas dans la commande', () =>
  within(s => {
    s.agents([idle(s)])
    let out = run(s)
    assert.equal(out.status, 2, out.stdout)
    assert.match(head(out), /^ARRÊT : sans id de session, une session tourne dans le worktree/)
    assert.doesNotMatch(out.stdout, /claude stop/)
    for (const id of ['abc\n12345', 'abc 1234', "abc'1234"]) {
      s.agents([{ ...idle(s), id }])
      out = run(s, '--session', 'x', '--apres-arret')
      assert.equal(out.status, 2, out.stdout)
    }
    // Avec --session, l'entrée trouvée par son sessionId mais dont l'id court est hors forme : ARRÊT, pas de commande.
    s.agents([{ ...idle(s), id: 'abc\n12345' }])
    out = run(s, '--session', '11111111-2222-3333-4444-555555555555')
    assert.equal(out.status, 2, out.stdout)
    assert.match(head(out), /^ARRÊT : l'id de la session relu de claude agents est hors forme/)
    assert.doesNotMatch(out.stdout, /claude stop/)
    intact(s)
  }))

test('le worktree déjà retiré : la branche de l’app compte, et chaque branche connue qui existe doit être fusionnée', () =>
  within(s => {
    // Une branche de l'app, fusionnée, seule à exister : DÉJÀ RETIRÉ.
    git(s.repo, 'worktree', 'remove', s.wt)
    git(s.repo, 'branch', '-m', `worktree-${NAME}`, `claude/${NAME}-xyz`)
    let out = run(s, '--session', 'local_abc')
    assert.equal(out.status, 0, out.stdout)
    assert.equal(head(out), 'DÉJÀ RETIRÉ')
    assert.match(out.stdout, new RegExp(`branche : claude/${NAME}-xyz`))
    // Une autre branche connue qui existe, pas fusionnée : ARRÊT, même si une autre l'est.
    git(s.repo, 'branch', NAME, 'main')
    git(s.repo, 'checkout', '-q', NAME)
    writeFileSync(join(s.repo, 'e.txt'), 'e\n')
    git(s.repo, 'add', 'e.txt')
    git(s.repo, 'commit', '-q', '-m', 'pas fusionné')
    git(s.repo, 'checkout', '-q', 'main')
    out = run(s, '--session', 'local_abc')
    assert.equal(out.status, 2, out.stdout)
    assert.match(head(out), /^ARRÊT : 1 commit\(s\) de groupe-essai-a ne sont pas dans main/)
  }))

test('la branche d’un envoi suivant n’est jamais prise pour celle-ci', () => {
  assert.deepEqual(parsePorcelain('worktree /d\nHEAD 1\nbranch refs/heads/main\n\nworktree /d/.claude/worktrees/x\nHEAD 2\nbranch refs/heads/claude/x-2-ab\nlocked raison\n'), [
    { path: '/d', branch: 'main', isDetached: false },
    { path: '/d/.claude/worktrees/x', branch: 'claude/x-2-ab', locked: 'raison', isDetached: false },
  ])
  within(s => {
    // Le worktree sur la branche de l'app d'un envoi suivant (claude/<nom>-2-…) : pas reconnu, pas de bloc à soi.
    git(s.wt, 'checkout', '-q', '-b', `claude/${NAME}-2-ab`)
    const out = run(s)
    assert.equal(out.status, 2)
    intact(s)
  })
})

test('la liste jetable, le verrou d’une session et les gardes de forme', () => {
  for (const p of ['node_modules/a/b.js', 'x/__pycache__/m.py', 'a.pyc', 'd/.DS_Store', 'p/.claude-plugin/types/claude-code/index.d.ts', '.show-your-work/x']) assert.equal(isDisposable(p), true, p)
  for (const p of ['secret.env', 'src/a.ts', 'node_modules', '.claude-plugin/types', 'types/x.d.ts']) assert.equal(isDisposable(p), false, p)
  assert.equal(isDisposable('lien', true), true)
  assert.equal(staleSessionLock('claude session M (pid 12 x)', () => false), '12')
  assert.equal(staleSessionLock('claude session M (pid 12 x)', () => true), null)
  assert.equal(staleSessionLock('à la main', () => false), null)
  assert.throws(() => parseArgs([]), /--worktree <nom> manque/)
  // isSafeBranch recopiée du mod : même corps que celle de closing.ts.
  const body = f => f.slice(f.indexOf('isSafeBranch ='), f.indexOf('\n\n', f.indexOf('isSafeBranch =')))
  const norm = t => t.replace(/: unknown\): value is string/, '').replace(/[\s()]+/g, '').replace(/value=>/, '')
  assert.equal(norm(body(readFileSync(SCRIPT, 'utf8'))), norm(body(CLOSING)))
  assert.equal(isSafeBranch('worktree-x'), true)
})

test('le script ne contient aucun geste : ni claude stop ou rm, ni worktree remove, ni branch -d, ni update-ref', () => {
  const src = readFileSync(SCRIPT, 'utf8')
  // Seuls des appels en lecture : les gestes ne paraissent que dans des textes imprimés.
  // Chaque argument littéral passé à un programme ('…' isolé, hors des textes imprimés, écrits entre accents graves) :
  // aucun n'est un verbe qui arrête, retire, supprime ou écrit, et seuls git et claude agents sont lancés.
  // Les arguments de chaque appel de git (l'aide du script) et d'execFileSync : le tableau qui suit l'appel, lu en
  // entier (crochets appariés), sans les textes imprimés autour, dont les apostrophes françaises fausseraient la lecture.
  const callArrays = [...src.matchAll(/\b(?:git|execFileSync)\(/g)].map(m => {
    const start = src.indexOf('[', m.index)
    let depth = 0
    let end = start
    for (; end < src.length; end++) {
      if (src[end] === '[') depth++
      else if (src[end] === ']' && --depth === 0) break
    }
    return src.slice(start, end + 1)
  })
  const literals = callArrays.flatMap(a => [...a.matchAll(/'([^'\n]*)'/g)].map(m => m[1]))
  // L'extraction voit bien les arguments de git : ceux de la lecture de la fusion, par exemple.
  assert.ok(literals.includes('--is-ancestor') && literals.includes('for-each-ref'), 'les arguments des appels de git sont lus')
  for (const verb of ['stop', 'rm', 'remove', 'unlock', 'update-ref', 'prune', 'delete', '-d', '-D', '--delete', '--force', '-f', 'reset', 'checkout', 'clean', 'gc', 'push', 'commit', 'add', 'kill'])
    assert.ok(!literals.includes(verb), `argument littéral interdit : '${verb}'`)
  const programs = [...src.matchAll(/execFileSync\(\s*([^,]+),/g)].map(m => m[1].trim())
  assert.deepEqual([...new Set(programs)].sort(), ["'git'", 'bin'])
  assert.doesNotMatch(src, /\b(rmSync|unlinkSync|writeFileSync|renameSync|spawnSync|execSync|spawn\(|child_process'\)\.exec\b)/)
  assert.match(src, /^import \{ execFileSync \} from 'node:child_process'$/m)
})
