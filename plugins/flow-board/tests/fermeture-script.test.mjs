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

import { branchesNextStep, isDisposable, isQuotableDir, isRefLookalike, isSafeBranch, nextStep, parseArgs, parseBranchArgs, parsePorcelain, staleSessionLock, stopWaitMs } from '../scripts/fermeture.mjs'
import { ch, CORPUS, LINE_BREAKERS, NON_TEXT } from './corpus.mjs'

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

/**
 * Un processus qui n'est pas un enfant de ce test (un shell le lance en arrière-plan, puis sort) : à sa fin, le
 * système le récupère, et `kill(pid, 0)` le dit disparu, sans attendre que ce test le relève. Rend son pid.
 */
const orphan = seconds => Number(execFileSync('sh', ['-c', `sleep ${seconds} >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' }).trim())
const ATTENTE = ms => ({ FLOW_BOARD_ATTENTE_ARRET_MS: String(ms) })
const runEnv = (s, env, ...args) => spawnSync(process.execPath, [SCRIPT, '--worktree', NAME, '--branche', `worktree-${NAME}`, '--branche', NAME, ...args], { cwd: s.repo, encoding: 'utf8', env: { ...process.env, FLOW_BOARD_CLAUDE: s.bin, ...env } })

test('session qui finit de s’arrêter : juste après l’arrêt, le verrou de sa session au processus encore vivant fait attendre sa fin, puis tout se revérifie', () =>
  within(s => {
    s.agents([], [])
    const pid = orphan(3)
    git(s.repo, 'worktree', 'lock', '--reason', `claude session M > Groupe A (pid ${pid} started)`, s.wt)
    // Vivant au lancement du script : c'est bien l'attente qui voit sa fin, pas un verrou déjà levable.
    assert.doesNotThrow(() => process.kill(pid, 0), 'le processus vit encore au lancement')
    const started = Date.now()
    const out = runEnv(s, ATTENTE(10_000), '--apres-arret')
    // Le processus vit encore quelque 3 s après sa création : le script n'a pu rendre SÛR qu'en attendant sa fin.
    assert.ok(Date.now() - started >= 1_000, 'le script a attendu la fin du processus')
    assert.equal(out.status, 0, out.stdout)
    assert.equal(head(out), 'SÛR')
    assert.ok(out.stdout.includes(`(processus ${pid} disparu : levé après l'arrêt)`))
    assert.ok(out.stdout.includes(`commande : git worktree unlock '${s.wt}', puis git worktree remove '${s.wt}'`))
    intact(s)
  }))

test('session toujours vivante après l’attente : ATTENDRE (code 3), relancer la même commande, jamais ARRÊT ; sans --apres-arret, rien n’attend', () =>
  within(s => {
    s.agents([], [])
    const pid = orphan(30)
    try {
      git(s.repo, 'worktree', 'lock', '--reason', `claude session M > Groupe A (pid ${pid} started)`, s.wt)
      const started = Date.now()
      const out = runEnv(s, ATTENTE(300), '--apres-arret')
      assert.equal(out.status, 3, out.stdout)
      assert.equal(head(out), `ATTENDRE : session encore en arrêt (processus ${pid} toujours là après 300 ms) : relance cette commande`)
      assert.equal(last(out), nextStep('ATTENDRE', true))
      assert.match(last(out), /relance cette même commande/)
      assert.doesNotMatch(out.stdout, /git worktree (unlock|remove)/)
      assert.ok(Date.now() - started < 10_000, 'l’attente est bornée')
      intact(s)
      // Une session encore montrée en marche par claude agents n'a pas été arrêtée : ARRÊT tout de suite, comme avant.
      s.agents([idle(s)])
      const listed = runEnv(s, ATTENTE(10_000), '--session', 'abc12345', '--apres-arret')
      assert.equal(listed.status, 2, listed.stdout)
      assert.equal(head(listed), 'ARRÊT : la session "abc12345" tourne encore : arrête-la d\'abord (claude stop), puis relance cette vérification')
      // Avant l'arrêt, le verrou de la session vivante n'attend rien : il est attendu.
      s.agents([idle(s)])
      const before = runEnv(s, ATTENTE(10_000), '--session', 'abc12345')
      assert.equal(head(before), 'SÛR', before.stdout)
      assert.ok(before.stdout.includes(`verrou : "claude session M > Groupe A (pid ${pid} started)"`))
    } finally {
      process.kill(pid)
    }
  }))


test('après l’arrêt, une autre session en marche dans le worktree n’est jamais dite à arrêter ; une session de l’app, absente de claude agents, garde l’ARRÊT du verrou sans attente', () =>
  within(s => {
    const pid = orphan(30)
    try {
      git(s.repo, 'worktree', 'lock', '--reason', `claude session M > Groupe A (pid ${pid} started)`, s.wt)
      // Une autre session (pas l'id du worker) tourne dans le worktree : ARRÊT, sans claude stop.
      s.agents([{ ...idle(s), id: 'zzz99999', sessionId: '99999999-2222-3333-4444-555555555555' }])
      for (const args of [['--session', 'abc12345', '--apres-arret'], ['--apres-arret']]) {
        const out = runEnv(s, ATTENTE(10_000), ...args)
        assert.equal(out.status, 2, out.stdout)
        assert.equal(head(out), 'ARRÊT : une autre session tourne encore dans le worktree : n’y touche pas (ne l’arrête pas), demande à la personne')
        assert.doesNotMatch(out.stdout, /claude stop/)
      }
      // Une session de l'app (local_…) n'est jamais dans claude agents : pas d'attente, le verrou vivant arrête.
      s.agents([], [])
      const started = Date.now()
      const app = runEnv(s, ATTENTE(10_000), '--session', 'local_abc', '--apres-arret')
      assert.equal(app.status, 2, app.stdout)
      assert.match(head(app), /^ARRÊT : /)
      assert.doesNotMatch(head(app), /encore en arrêt/)
      assert.ok(Date.now() - started < 5_000, 'aucune attente pour une session de l’app')
      intact(s)
    } finally {
      process.kill(pid)
    }
  }))
test('l’attente ne fait que raccourcir : un entier de millisecondes au plus égal à la constante, toute autre valeur ignorée', () => {
  // Une valeur donnée en argument (null : aucune), jamais l'environnement du lanceur des tests.
  assert.equal(stopWaitMs(null), 5_000)
  assert.equal(stopWaitMs('300'), 300)
  assert.equal(stopWaitMs('0'), 0)
  assert.equal(stopWaitMs('99999'), 5_000)
  for (const bad of ['abc', '-5', '1.5', '', ' 300', '300ms', '１２']) assert.equal(stopWaitMs(bad), 5_000, JSON.stringify(bad))
})

test('après l’attente, tout se relit : un fichier laissé par la session pendant qu’elle finit de s’arrêter fait ARRÊT', () =>
  within(s => {
    s.agents([], [])
    // Le processus de la session écrit un fichier non suivi dans son worktree, puis disparaît.
    const pid = Number(execFileSync('sh', ['-c', `sh -c 'sleep 3; echo x > "${join(s.wt, 'tardif.txt')}"' >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' }).trim())
    try {
      git(s.repo, 'worktree', 'lock', '--reason', `claude session M > Groupe A (pid ${pid} started)`, s.wt)
      // Vivant, et le fichier pas encore écrit, au lancement du script : seule une relecture après l'attente le voit.
      assert.doesNotThrow(() => process.kill(pid, 0), 'le processus vit encore au lancement')
      assert.equal(existsSync(join(s.wt, 'tardif.txt')), false)
      const out = runEnv(s, ATTENTE(10_000), '--apres-arret')
      assert.equal(out.status, 2, out.stdout)
      assert.match(head(out), /^ARRÊT : l'arbre du worktree porte des fichiers modifiés ou non suivis : tardif\.txt/)
    } finally {
      try {
        process.kill(pid)
      } catch {
        // Déjà disparu.
      }
    }
  }))

test('un pid hors forme dans le verrou (0, 1, au-delà de 2147483647, plus de 10 chiffres) : ARRÊT comme un verrou étranger, sans attente', () =>
  within(s => {
    s.agents([], [])
    for (const pid of ['0', '1', '2147483648', '99999999999']) {
      git(s.repo, 'worktree', 'lock', '--reason', `claude session M > Groupe A (pid ${pid} started)`, s.wt)
      const out = runEnv(s, ATTENTE(10_000), '--apres-arret')
      assert.equal(out.status, 2, `${pid} : ${out.stdout}`)
      assert.match(head(out), /^ARRÊT : le worktree est verrouillé par autre chose qu'une session arrêtée/)
      git(s.repo, 'worktree', 'unlock', s.wt)
    }
    intact(s)
  }))

/** Une branche de travail de 12 commits, puis le worker parti d'elle (2 commits), fusionné par un commit de fusion ou en avance rapide. */
const workerOf = (s, how) => {
  for (let i = 1; i <= 12; i++) {
    writeFileSync(join(s.repo, `m${i}.txt`), `${i}\n`)
    git(s.repo, 'add', `m${i}.txt`)
    git(s.repo, 'commit', '-q', '-m', `principal ${i}`)
  }
  git(s.wt, 'merge', '-q', '--ff-only', 'main')
  for (const n of ['un', 'deux']) {
    writeFileSync(join(s.wt, `${n}.txt`), `${n}\n`)
    git(s.wt, 'add', `${n}.txt`)
    git(s.wt, 'commit', '-q', '-m', `worker ${n}`)
  }
  if (how === 'merge') {
    writeFileSync(join(s.repo, 'apres.txt'), 'x\n')
    git(s.repo, 'add', 'apres.txt')
    git(s.repo, 'commit', '-q', '-m', 'principal après le départ')
    git(s.repo, 'merge', '-q', '--no-ff', '-m', 'fusion du groupe', `worktree-${NAME}`)
  } else if (how === 'ff') git(s.repo, 'merge', '-q', '--ff-only', `worktree-${NAME}`)
}
const commitLines = out => {
  const lines = out.stdout.split('\n')
  const at = lines.findIndex(l => l.startsWith('commits '))
  return { label: lines[at], list: lines.slice(at + 1).filter(l => l.startsWith('  ')).map(l => l.trim().replace(/^\w+ /, '')) }
}

test('la ligne des commits ne liste que ceux du worker : pas fusionnée, fusionnée par un commit de fusion ; en avance rapide, elle le dit', () => {
  within(s => {
    workerOf(s, 'merge')
    s.agents([idle(s)])
    const { label, list } = commitLines(run(s, '--session', 'abc12345'))
    assert.match(label, /^commits du worker \(propres à worktree-groupe-essai-a, fusionnés par le commit de fusion \w+\) :$/)
    // « travail du groupe », fusionné en avance rapide à la mise en place, est déjà dans main avant le départ du worker.
    assert.deepEqual(list, ['worker deux', 'worker un'])
  })
  within(s => {
    workerOf(s, 'none')
    s.agents([idle(s)])
    const out = run(s, '--session', 'abc12345')
    assert.equal(out.status, 2)
    const { label, list } = commitLines(out)
    assert.match(label, /^commits du worker \(propres à worktree-groupe-essai-a, pas encore dans main\) :$/)
    assert.deepEqual(list, ['worker deux', 'worker un'])
  })
  within(s => {
    workerOf(s, 'ff')
    s.agents([idle(s)])
    const { label, list } = commitLines(run(s, '--session', 'abc12345'))
    assert.match(label, /^commits de worktree-groupe-essai-a \(fusion sans commit de fusion : commits du worker non distinguables ; les 10 derniers de la branche\) :$/)
    assert.equal(list.length, 10)
    assert.ok(list.includes('principal 12'), 'ceux de la branche de travail y sont, comme avant')
  })
})

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

// ─── Le mode --branches : le verdict des branches à supprimer en fin de mission ───

/**
 * Un dépôt (branche de travail `main`) avec : `fusion-a` et `fusion-b` contenues dans `main`, `pas-fusion` (un
 * commit à elle), `sortie` contenue dans `main` mais sortie par un worktree, `alias` (référence symbolique vers
 * `fusion-a`). Rend les chemins.
 */
const branchesRepo = (dirName = 'depot') => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'branches-')))
  const repo = join(root, dirName)
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'essai')
  git(repo, 'config', 'user.email', 'essai@localhost')
  git(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, '.gitignore'), '.claude/\n')
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'base')
  for (const b of ['fusion-a', 'fusion-b', 'sortie', 'pas-fusion']) git(repo, 'branch', b)
  const wt = join(repo, '.claude', 'worktrees', 'groupe-x')
  git(repo, 'worktree', 'add', '-q', wt, 'sortie')
  git(repo, 'worktree', 'add', '-q', join(root, 'pf'), 'pas-fusion')
  writeFileSync(join(root, 'pf', 'b.txt'), 'b\n')
  git(join(root, 'pf'), 'add', 'b.txt')
  git(join(root, 'pf'), 'commit', '-q', '-m', 'travail pas fusionné')
  git(repo, 'worktree', 'remove', join(root, 'pf'))
  git(repo, 'symbolic-ref', 'refs/heads/alias', 'refs/heads/fusion-a')
  return { root, repo, wt }
}

const inBranchesRepo = (fn, dirName) => {
  const s = branchesRepo(dirName)
  try {
    fn(s)
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
}

const branches = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, '--branches', ...args], { cwd, encoding: 'utf8' })

/** Les lignes de la sortie : le verdict, une ligne par branche, la commande, la suite. */
const outLines = out => out.stdout.trimEnd().split('\n')

/** La commande imprimée (sans « commande : »), ou undefined. */
const printed = out => outLines(out).find(l => l.startsWith('commande : '))?.slice('commande : '.length)

const exists = (repo, b) => spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${b}`], { cwd: repo }).status === 0

test('--branches : une ligne par branche, SUPPRIMABLE seulement contenue, existante, ni sortie ni symbolique ni la branche de travail ; puis la seule commande branch -d de celles-là', () =>
  inBranchesRepo(s => {
    const out = branches(s.repo, 'fusion-a', 'pas-fusion', 'sortie', 'alias', 'absente', 'main', 'Main', 'fusion-a', 'fusion-b')
    assert.equal(out.status, 0, out.stdout + out.stderr)
    const lines = outLines(out)
    assert.equal(lines[0], 'BRANCHES : 2 supprimable(s), 6 gardée(s)')
    for (const line of [
      'branche de travail : main',
      'SUPPRIMABLE : fusion-a',
      'GARDÉE : pas-fusion (pas entièrement contenue dans main)',
      'GARDÉE : sortie (sortie par un worktree)',
      'GARDÉE : alias (référence symbolique)',
      'GARDÉE : absente (absente sous ce nom exact : déjà supprimée ?)',
      'GARDÉE : main (branche de travail)',
      'GARDÉE : Main (branche de travail)',
      'SUPPRIMABLE : fusion-b',
    ])
      assert.ok(lines.includes(line), `ligne attendue : ${line}\n${out.stdout}`)
    // Un nom donné deux fois n'a qu'une ligne.
    assert.equal(lines.filter(l => l.endsWith(' fusion-a')).length, 1)
    assert.equal(printed(out), `git -C '${s.repo}' branch -d -- 'fusion-a' 'fusion-b'`)
    assert.match(lines.at(-1), /^suite : lance la commande ci-dessus telle quelle, une seule fois/)
    // Le script ne supprime rien lui-même.
    for (const b of ['fusion-a', 'fusion-b', 'pas-fusion', 'sortie', 'alias']) assert.ok(exists(s.repo, b), b)
    // La commande imprimée, lancée par un shell : elle ne supprime que les deux branches supprimables.
    const run = spawnSync('sh', ['-c', printed(out)], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    for (const b of ['fusion-a', 'fusion-b']) assert.ok(!exists(s.repo, b), `${b} supprimée`)
    for (const b of ['pas-fusion', 'sortie', 'main']) assert.ok(exists(s.repo, b), `${b} gardée`)
  }))

test('--branches : un nom hors forme ou qui imite un pseudo-ref n’est jamais recopié ni dans la commande ; seul son rang le désigne', () =>
  inBranchesRepo(s => {
    const bad = ['a;b', '-x', 'refs/heads/fusion-a', 'HEAD', 'ORIG_HEAD', 'x/MERGE_HEAD', 'tags/v1', 'heads/fusion-a', 'remotes/o/x', "x'; rm -rf ~; '", 'a b', 'é']
    const out = branches(s.repo, ...bad, 'fusion-a')
    assert.equal(out.status, 0, out.stdout + out.stderr)
    const lines = outLines(out)
    for (const [i] of bad.entries()) assert.ok(lines.includes(`GARDÉE : (nom hors forme, ${i + 1}e branche) (hors forme)`), `${i + 1}e branche\n${out.stdout}`)
    assert.equal(printed(out), `git -C '${s.repo}' branch -d -- 'fusion-a'`)
    for (const b of bad) if (b.length > 3) assert.ok(!out.stdout.includes(b), b)
  }))

test('--branches : sans branche supprimable, aucune commande ; la branche de travail hors forme ou absente, ou un dossier à apostrophe : ARRÊT (code 2), rien de supprimable', () => {
  inBranchesRepo(s => {
    const none = branches(s.repo, 'pas-fusion', 'sortie')
    assert.equal(none.status, 0)
    assert.equal(outLines(none)[0], 'BRANCHES : 0 supprimable(s), 2 gardée(s)')
    assert.equal(printed(none), undefined)
    assert.match(outLines(none).at(-1), /^suite : aucune branche n’est supprimable : ne supprime rien/)
    // HEAD détachée : aucune branche n'est supprimable, et le script le dit.
    git(s.repo, 'checkout', '-q', '--detach')
    const detached = branches(s.repo, 'fusion-a')
    assert.equal(detached.status, 2)
    assert.match(outLines(detached)[0], /^ARRÊT : la branche de travail de ce dossier est hors forme ou absente/)
    assert.equal(printed(detached), undefined)
    assert.equal(outLines(detached).at(-1), 'suite : ne supprime aucune branche ; dis la raison à la personne')
  })
  inBranchesRepo(s => {
    const out = branches(s.root, '--dossier', s.repo, 'fusion-a')
    assert.equal(out.status, 2)
    assert.match(outLines(out)[0], /^ARRÊT : le dossier de la mission porte une apostrophe/)
    assert.ok(!out.stdout.includes(s.repo))
    assert.equal(printed(out), undefined)
  }, "l'autre")
})

test('--branches --dossier : la vérification et la commande visent le dossier donné, quel que soit le dossier courant', () =>
  inBranchesRepo(s => {
    const out = branches(s.root, '--dossier', s.repo, 'fusion-a')
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.equal(printed(out), `git -C '${s.repo}' branch -d -- 'fusion-a'`)
  }))

test('--branches : une branche que git refuse au moment de la commande reste, et la sortie la nomme ; les autres partent', () =>
  inBranchesRepo(s => {
    const out = branches(s.repo, 'fusion-a', 'fusion-b')
    assert.equal(printed(out), `git -C '${s.repo}' branch -d -- 'fusion-a' 'fusion-b'`)
    // Entre le verdict et la commande, un worktree sort fusion-b : git la refuse.
    git(s.repo, 'worktree', 'add', '-q', join(s.root, 'tard'), 'fusion-b')
    const run = spawnSync('sh', ['-c', printed(out)], { encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    assert.match(run.stdout + run.stderr, /Deleted branch fusion-a/)
    assert.match(run.stderr, /error: .*'fusion-b'/)
    assert.ok(!exists(s.repo, 'fusion-a'))
    assert.ok(exists(s.repo, 'fusion-b'), 'la branche refusée reste')
  }))

test('--branches : un argument hors du mode ou mal formé, ou un dossier sans git : ÉCHEC (code 1), rien de supprimable', () =>
  inBranchesRepo(s => {
    for (const args of [[], ['--apres-arret', 'fusion-a'], ['--worktree', 'groupe-x', 'fusion-a'], ['--dossier'], ['--dossier', '', 'fusion-a'], ['--dossier', s.repo, '--dossier', s.repo, 'fusion-a'], ['--force', 'fusion-a']]) {
      const out = branches(s.repo, ...args)
      assert.equal(out.status, 1, `${JSON.stringify(args)} : ${out.stdout}`)
      assert.match(outLines(out)[0], /^ÉCHEC : .*rien n'est sûr : ne supprime aucune branche$/)
      assert.equal(printed(out), undefined)
      assert.equal(outLines(out).at(-1), 'suite : ne supprime aucune branche ; dis la raison à la personne')
    }
    // --branches ailleurs qu'en tête : ÉCHEC, jamais une fermeture de worker.
    const late = spawnSync(process.execPath, [SCRIPT, '--worktree', 'groupe-x', '--branches', 'fusion-a'], { cwd: s.repo, encoding: 'utf8' })
    assert.equal(late.status, 1)
    assert.match(outLines(late)[0], /^ÉCHEC : --branches doit venir en tête/)
    const nogit = branches(s.root, 'fusion-a')
    assert.equal(nogit.status, 1)
    assert.match(outLines(nogit)[0], /^ÉCHEC : git branch --show-current a échoué/)
  }))

test('--branches : les gardes recopiés du mod (forme d’une branche, pseudo-refs) et du dossier', () => {
  // Le filtre des pseudo-refs et des espaces de refs : le même texte que celui de branchFate (hooks/closing.ts).
  const lookalike = String.raw`/(?:^|\/)[A-Z_]*_HEAD$|^(?:heads|tags|remotes)\//`
  assert.ok(readFileSync(SCRIPT, 'utf8').includes(lookalike))
  assert.ok(CLOSING.includes(lookalike))
  for (const n of ['ORIG_HEAD', 'a/FETCH_HEAD', 'tags/x', 'heads/x', 'remotes/o/x']) assert.equal(isRefLookalike(n), true, n)
  for (const n of ['worktree-groupe-x-A', 'mes-tags/x', 'HEADS']) assert.equal(isRefLookalike(n), false, n)
  for (const d of ['/Users/m/proj', 'C:/proj', '/a b/c']) assert.equal(isQuotableDir(d), true, d)
  for (const d of ["/Users/m/l'autre", '/a\u2019b', '/a\nb', '/a\u2028b', '/a\u0085b', '', 42]) assert.equal(isQuotableDir(d), false, JSON.stringify(d))
  assert.throws(() => parseBranchArgs(['fusion-a', '--branches']), /--branches doit venir en tête/)
  assert.deepEqual(parseBranchArgs(['--branches', '--dossier', '/d', 'a', 'b']), { names: ['a', 'b'], dir: '/d' })
  assert.equal(branchesNextStep('ARRÊT', true), 'suite : ne supprime aucune branche ; dis la raison à la personne')
})

// Le dossier de la mission est un chemin du poste, que le script vérifie lui-même (git -C) avant de l'imprimer
// dans la commande : ce qu'il vérifie est ce que la commande vise, quel que soit le signe qu'il porte. Le corpus
// commun fixe donc ce qui passe, entrée par entrée : ce qui sortirait des apostrophes du shell, ce qui ouvre une
// ligne ou en retourne l'affichage, et ce qui n'est pas un texte sont refusés ; le reste n'a d'effet ni entre
// apostrophes ni sur la ligne (une remontée est déjà résolue avant le garde). Une entrée ajoutée au corpus et
// qui passerait fait échouer ce test : elle se range ici, avec sa raison, ou le garde se resserre.
test('--branches : le dossier de la mission passe le corpus hostile commun : seuls passent les signes sans effet entre apostrophes ni sur la ligne', () => {
  const passing = Object.entries(CORPUS).filter(([, token]) => isQuotableDir(`/Users/m/a${token}b`)).map(([name]) => name)
  assert.deepEqual(passing, [
    // Des points, des lettres, des crochets et des guillemets doubles : visibles, inertes entre apostrophes.
    'point médian U+00B7', 'point grec U+0387', 'point de césure U+2027', 'opérateur puce U+2219', 'opérateur point U+22C5', 'point katakana U+30FB', 'point katakana demi-chasse U+FF65',
    'lettre apostrophe U+02BC', 'guillemet', 'signe Kelvin U+212A', 'ligature fi U+FB01', 'chiffre pleine chasse U+FF11', 'lettre pleine chasse U+FF21', 'e accent aigu U+00E9',
    // Des invisibles : la commande imprimée vise le dossier même que le script a vérifié.
    'espace insécable U+00A0', 'espace sans chasse U+200B', 'liant sans chasse U+200D', 'indicateur d’ordre U+FEFF', 'trait d’union conditionnel U+00AD', 'marque de lettre arabe U+061C', 'séparateur de voyelle mongol U+180E', 'sélecteur de variante U+FE0F', 'sélecteur de variante U+E0100', 'étiquette U+E0041', 'point réservé du bloc des étiquettes U+E0000', 'invisible non assigné U+2065', 'sélecteur de variante mongol U+180B', 'fin d’étiquette U+E007F', 'remplissage hangûl U+3164',
    'chevrons mathématiques U+27E8 U+27E9', 'chevrons doubles U+27EA U+27EB', 'crochets lenticulaires U+3010 U+3011', 'crochets en écaille U+3014 U+3015', 'parenthèses blanches U+2985 U+2986',
    // Les signes du shell, inertes entre apostrophes ; une remontée, résolue avant le garde ; un chemin long.
    'espace', 'substitution', 'accent grave', 'point-virgule', 'esperluette', 'barre', 'joker', 'remontée', 'chaîne très longue',
  ])
  const breaking = Object.entries(LINE_BREAKERS).flatMap(([family, codes]) => codes.filter(code => isQuotableDir(`/a${ch(code)}b`)).map(code => `${family} : U+${code.toString(16)}`))
  assert.deepEqual(breaking, [])
  assert.deepEqual(Object.entries(NON_TEXT).filter(([, value]) => isQuotableDir(value)).map(([name]) => name), [])
})

test('--branches : un nom d’une autre casse que la branche est absent sous ce nom exact ; deux branches qui ne diffèrent que par la casse sont gardées toutes deux, et sur la branche de travail tout s’arrête', () =>
  inBranchesRepo(s => {
    const other = branches(s.repo, 'FUSION-A')
    assert.ok(outLines(other).includes('GARDÉE : FUSION-A (absente sous ce nom exact : déjà supprimée ?)'), other.stdout)
    assert.equal(printed(other), undefined)
    // fusion-a, tassée dans packed-refs, porte un commit absent de main ; FUSION-A, libre, pointe sur main. Sur un
    // disque qui ignore la casse, refs/heads/fusion-a se lirait FUSION-A : contenue à tort, puis effacée avec elle.
    git(s.repo, 'worktree', 'add', '-q', join(s.root, 'fa'), 'fusion-a')
    writeFileSync(join(s.root, 'fa', 'c.txt'), 'c\n')
    git(join(s.root, 'fa'), 'add', 'c.txt')
    git(join(s.root, 'fa'), 'commit', '-q', '-m', 'pas fusionné')
    git(s.repo, 'worktree', 'remove', join(s.root, 'fa'))
    git(s.repo, 'pack-refs', '--all')
    git(s.repo, 'update-ref', 'refs/heads/FUSION-A', git(s.repo, 'rev-parse', 'refs/heads/main'))
    const out = branches(s.repo, 'fusion-a', 'FUSION-A', 'fusion-b')
    assert.equal(out.status, 0, out.stdout + out.stderr)
    for (const b of ['fusion-a', 'FUSION-A']) assert.ok(outLines(out).includes(`GARDÉE : ${b} (une autre branche ne diffère de celle-ci que par la casse)`), out.stdout)
    assert.equal(printed(out), `git -C '${s.repo}' branch -d -- 'fusion-b'`)
    // Une autre branche à la casse près de la branche de travail : sa fusion se lirait ailleurs, rien n'est supprimable.
    git(s.repo, 'update-ref', 'refs/heads/MAIN', git(s.repo, 'rev-parse', 'refs/heads/main'))
    const work = branches(s.repo, 'fusion-b')
    assert.equal(work.status, 2)
    assert.match(outLines(work)[0], /^ARRÊT : une autre branche ne diffère de la branche de travail main que par la casse/)
    assert.equal(printed(work), undefined)
  }))

test('--branches : le rang d’un nom hors forme est celui de son argument, doublons compris', () =>
  inBranchesRepo(s => {
    const out = branches(s.repo, 'fusion-a', 'fusion-a', 'a;b')
    assert.ok(outLines(out).includes('GARDÉE : (nom hors forme, 3e branche) (hors forme)'), out.stdout)
  }))

test('--branches : un nom n’entre dans la commande que s’il passe la forme d’une branche et n’imite aucun pseudo-ref : le corpus hostile commun le fait refuser', () => {
  const enters = name => isSafeBranch(name) && !isRefLookalike(name)
  assert.equal(enters('worktree-groupe-x-A'), true)
  assert.deepEqual(Object.entries(CORPUS).filter(([, token]) => enters(`worktree-${token}-A`)).map(([name]) => name), [])
  assert.deepEqual(Object.entries(NON_TEXT).filter(([, value]) => enters(value)).map(([name]) => name), [])
})

test('--branches : la casse se replie comme sur le disque : « ſ » (s long) vaut « s », et la collision garde la branche', () =>
  inBranchesRepo(s => {
    // fusion-a tassée, pas fusionnée ; fuſion-a, libre, sur main : un disque qui replie ſ en s les confondrait.
    git(s.repo, 'worktree', 'add', '-q', join(s.root, 'fa'), 'fusion-a')
    writeFileSync(join(s.root, 'fa', 'c.txt'), 'c\n')
    git(join(s.root, 'fa'), 'add', 'c.txt')
    git(join(s.root, 'fa'), 'commit', '-q', '-m', 'pas fusionné')
    git(s.repo, 'worktree', 'remove', join(s.root, 'fa'))
    git(s.repo, 'pack-refs', '--all')
    git(s.repo, 'update-ref', `refs/heads/fu${ch(0x17f)}ion-a`, git(s.repo, 'rev-parse', 'refs/heads/main'))
    const out = branches(s.repo, 'fusion-a', 'fusion-b')
    assert.equal(out.status, 0, out.stdout + out.stderr)
    assert.ok(outLines(out).includes('GARDÉE : fusion-a (une autre branche ne diffère de celle-ci que par la casse)'), out.stdout)
    assert.equal(printed(out), `git -C '${s.repo}' branch -d -- 'fusion-b'`)
  }))
