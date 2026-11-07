// Le script qui écrit le fichier de consignes d'une revue (scripts/consignes.mjs) depuis le gabarit
// reference/consignes-revue.md : ces tests le lancent pour de vrai, dans un dossier temporaire, et
// le comparent au gabarit, dont il garde les titres et la consigne des relecteurs mot pour mot.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { criteria, isSafePath, isSafeRange, isTicketId, readTicket, render, ConsignesError } from '../scripts/consignes.mjs'
import { CORPUS } from './corpus.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/consignes.mjs', import.meta.url))
const gabarit = readFileSync(new URL('../reference/consignes-revue.md', import.meta.url), 'utf8')
const procedure = readFileSync(new URL('../reference/procedure-groupe.md', import.meta.url), 'utf8')
const body = gabarit.slice(gabarit.indexOf('\n---\n') + 5)
const headings = text => text.split('\n').filter(l => l.startsWith('## '))
const consigne = text => text.split('\n').find(l => l.startsWith('> Si la revue'))

const TICKET = `# 05: Édition : un outil

**What to build:** une piste.

Zone sensible : non
Logique : oui

- [ ] Premier critère (test).
- [x] Deuxième critère. — \`a.test.mjs\`
`

/** Un projet temporaire : CODING_STANDARDS.md à sa racine, un chantier avec son fichier de décisions. */
const project = () => {
  // Le chemin résolu : le script voit le dossier courant par son vrai chemin (/private/var sur Mac).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'consignes-')))
  mkdirSync(join(dir, 'travail', 'chantier', 'issues'), { recursive: true })
  writeFileSync(join(dir, 'CODING_STANDARDS.md'), '# règles\n')
  writeFileSync(join(dir, 'travail', 'chantier', 'DECISIONS.md'), '# décisions\n')
  writeFileSync(join(dir, 'travail', 'chantier', 'issues', '05-outil.md'), TICKET)
  return dir
}

const run = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' })

test('sans invariant : un fichier conforme au gabarit, sans trou ni ligne entre crochets', () => {
  const dir = project()
  try {
    const out = run(dir, 'travail/chantier/issues/05-outil.md', 'abc1234..def5678', 'consignes-05.md', '--choix', '/tmp/choix.md')
    assert.equal(out.status, 0, out.stderr)
    const text = readFileSync(join(dir, 'consignes-05.md'), 'utf8')
    assert.match(text, /^# Consignes de la revue : ticket 05 « Édition : un outil »\n/)
    assert.deepEqual(headings(text), headings(body))
    assert.equal(consigne(text), consigne(body))
    // Un relecteur, fork de /code-review compris, lit d'abord ce fichier : la ligne de l'advisor y est.
    assert.ok(consigne(text).endsWith("Ne consulte pas l'advisor : la discussion qui t'a lancé relit ton rapport."), 'la ligne de l’advisor manque')
    assert.ok(!/<[^>\n]+>/.test(text), `un trou <…> reste : ${text.match(/<[^>\n]+>/)}`)
    assert.ok(!text.split('\n').some(l => l.startsWith('- [')), 'une ligne entre crochets reste')
    assert.match(text, /Cible : `abc1234\.\.def5678`/)
    assert.match(text, /Le ticket : `travail\/chantier\/issues\/05-outil\.md`/)
    assert.match(text, /Les choix déjà déclarés : `\/tmp\/choix\.md`, plus ceux de la session qui n'y sont pas encore : aucun\./)
    assert.ok(text.includes(`Les décisions : \`${join(dir, 'travail', 'chantier', 'DECISIONS.md')}\``), 'le fichier de décisions du chantier manque')
    assert.ok(text.includes(`Les règles de jugement : \`${join(dir, 'CODING_STANDARDS.md')}\``), 'CODING_STANDARDS.md manque')
    assert.ok(!text.includes('Passe « bogues »'), 'une ligne d’invariant sans invariant')
    assert.ok(!text.includes('Relecture du fond'), 'une ligne de lecteur sans lecteur')
    assert.ok(!text.includes("D'autres missions"), 'une ligne de chemins sans --chemins')
    assert.match(out.stdout, /consignes-05\.md/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('avec invariant, lecteur, chemins, tickets faits et choix de la session : chaque ligne est remplie', () => {
  const dir = project()
  try {
    writeFileSync(join(dir, 'travail', 'chantier', 'issues', '06-sensible.md'),
      '# 06: Sensible\n\nZone sensible : oui (suppression)\nInvariant : « un fichier de totaux n\'est jamais réécrit vide ».\nLecteur : Mathis\n')
    writeFileSync(join(dir, 'declares.txt'), 'motif littéral de show.py\noption --quick\n')
    const out = run(dir, 'travail/chantier/issues/06-sensible.md', 'refs/worktree/flow-board/06^..refs/worktree/flow-board/06', 'c.md',
      '--chemins', 'scripts', 'CLAUDE.md', '--faits', 'travail/chantier/issues/05-outil.md', '--declares', 'declares.txt')
    assert.equal(out.status, 0, out.stderr)
    const text = readFileSync(join(dir, 'c.md'), 'utf8')
    assert.match(text, /^# Consignes de la revue : ticket 06 « Sensible »\n/)
    assert.ok(text.includes("« un fichier de totaux n'est jamais réécrit vide »"), 'l’invariant manque')
    assert.ok(!text.includes('« «'), 'des guillemets doublés')
    assert.match(text, /le lecteur visé : Mathis\./)
    assert.ok(text.includes("- D'autres missions commitent sur la branche : seulement `git diff refs/worktree/flow-board/06^..refs/worktree/flow-board/06 -- scripts CLAUDE.md`."))
    assert.ok(text.includes('05 : Premier critère (test). ; 05 : Deuxième critère.'), 'les critères des tickets faits manquent')
    assert.match(text, /plus ceux de la session qui n'y sont pas encore : motif littéral de show\.py ; option --quick\./)
    assert.match(text, /Les choix déjà déclarés : aucun fichier des choix/)
    assert.ok(!/<[^>\n]+>/.test(text))
    assert.ok(!text.split('\n').some(l => l.startsWith('- [')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--relecteur crée le dossier du relecteur dans le dossier git et le nomme comme seul lieu d’écriture ; sans lui, ni dossier ni /tmp', () => {
  const dir = project()
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0)
    const out = run(dir, 'travail/chantier/issues/05-outil.md', 'a..b', 'c.md', '--relecteur', '05')
    assert.equal(out.status, 0, out.stderr)
    const text = readFileSync(join(dir, 'c.md'), 'utf8')
    const path = join(dir, '.git', 'flow-board', 'revue-05')
    assert.ok(existsSync(path), 'dossier absent')
    assert.ok(text.includes(`- Où écrire : seulement \`${path}\``), text)
    assert.ok(!/<[^>\n]+>/.test(text))
    // Sans --relecteur, la ligne part, et « À ne pas faire » interdit toujours /tmp.
    assert.equal(run(dir, 'travail/chantier/issues/05-outil.md', 'a..b', 'd.md').status, 0)
    const plain = readFileSync(join(dir, 'd.md'), 'utf8')
    assert.ok(!plain.includes('Où écrire'))
    assert.match(plain, /À ne pas faire : écrire dans l'arbre de travail, dans l'index ou dans `\/tmp`/)
    // Un id hors forme : rien n'est écrit.
    for (const id of ['../05', '-05', 'a/b']) {
      const bad = run(dir, 'travail/chantier/issues/05-outil.md', 'a..b', 'e.md', '--relecteur', id)
      assert.equal(bad.status, 1, id)
      assert.match(bad.stderr, /^ÉCHEC : id hors forme/)
    }
    assert.ok(!existsSync(join(dir, 'e.md')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un invariant en liste sous sa ligne est repris en entier', () => {
  const dir = project()
  try {
    writeFileSync(join(dir, 'travail', 'chantier', 'issues', '07-liste.md'),
      '# 07: Liste\n\nInvariants (à recopier dans les consignes de la passe « bogues ») :\n- « a ne devient jamais b » ;\n- « c reste c ».\n\nSuite.\n')
    const out = run(dir, 'travail/chantier/issues/07-liste.md', 'a..b', 'c.md')
    assert.equal(out.status, 0, out.stderr)
    const text = readFileSync(join(dir, 'c.md'), 'utf8')
    assert.ok(text.includes('« a ne devient jamais b » ; « c reste c »'), text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('un ticket absent, une cible sans plage ou une option inconnue : rien n’est écrit', () => {
  const dir = project()
  try {
    for (const args of [
      ['travail/chantier/issues/absent.md', 'a..b', 'c.md'],
      ['travail/chantier/issues/05-outil.md', 'abc1234', 'c.md'],
      ['travail/chantier/issues/05-outil.md', 'a..b', 'c.md', '--inconnue', 'x'],
      ['travail/chantier/issues/05-outil.md', 'a..b'],
    ]) {
      const out = run(dir, ...args)
      assert.equal(out.status, 1, args.join(' '))
      assert.match(out.stderr, /^ÉCHEC : /)
    }
    assert.equal(spawnSync('ls', [dir], { encoding: 'utf8' }).stdout.includes('c.md'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('une ligne du gabarit que le script ne connaît pas le fait échouer, au lieu d’un fichier faux', () => {
  assert.throws(() => render(`${gabarit}\n- Une ligne nouvelle : <trou>.\n`, { ticket: { id: '1', title: 't', path: 'p' }, range: 'a..b' }), ConsignesError)
})

test('le texte de chaque ligne vient du gabarit : une ligne reformulée se retrouve telle quelle', () => {
  const reworded = gabarit.replace('- Les décisions : `<fichier de décisions du projet>` et', '- Les décisions, relues avant chaque ticket : `<fichier de décisions du projet>` et')
  assert.notEqual(reworded, gabarit)
  const text = render(reworded, { ticket: { id: '1', title: 't', path: 'p' }, range: 'a..b', decisions: '/d/DECISIONS.md' })
  assert.ok(text.includes('- Les décisions, relues avant chaque ticket : `/d/DECISIONS.md` et'), text)
  assert.ok(text.includes('- Cible : `a..b`, jamais un hash seul.'), 'la parenthèse qui explique les trous de la cible reste')
})

test('un texte du ticket qui porte $&, $\' ou <…> reste du texte', () => {
  const ticket = { id: '1', title: 'titre <x>', path: 'p', invariant: "« $& ne devient jamais $' »", reader: 'Mathis $`' }
  const text = render(gabarit, { ticket, range: 'a..b', done: ['1 : un critère avec $\' et `<fichier>`'] })
  assert.ok(text.includes("« $& ne devient jamais $' »"), text)
  assert.ok(text.includes('le lecteur visé : Mathis $`.'), text)
  assert.ok(text.includes("recopiés : 1 : un critère avec $' et `<fichier>` (la règle"), text)
  assert.ok(text.includes('ticket 1 « titre <x> »'))
})

test('un ticket aux fins de ligne CRLF se lit comme les autres', () => {
  const ticket = readTicket('# 7: titre\r\n\r\nInvariant : « x reste x ».\r\nLecteur : Mathis\r\n\r\n- [ ] un critère\r\n', 'issues/07-a.md')
  assert.deepEqual([ticket.id, ticket.title, ticket.invariant, ticket.reader], ['7', 'titre', '« x reste x »', 'Mathis'])
  assert.deepEqual(criteria('- [ ] un critère\r\n', '7'), ['7 : un critère'])
})

test('--faits prend aussi l’id d’un ticket, cherché dans le dossier d’issues du ticket relu', () => {
  const dir = project()
  try {
    writeFileSync(join(dir, 'travail', 'chantier', 'issues', '06-suite.md'), '# 06: Suite\n\nZone sensible : non\n')
    const out = run(dir, 'travail/chantier/issues/06-suite.md', 'a..b', 'c.md', '--faits', '05')
    assert.equal(out.status, 0, out.stderr)
    assert.ok(readFileSync(join(dir, 'c.md'), 'utf8').includes('05 : Premier critère (test). ; 05 : Deuxième critère.'))
    const missing = run(dir, 'travail/chantier/issues/06-suite.md', 'a..b', 'c.md', '--faits', '42')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /42/)
    assert.match(missing.stderr, /travail\/chantier\/issues/)
    for (const hostile of ['../05', '05/..', '-05']) {
      const refused = run(dir, 'travail/chantier/issues/06-suite.md', 'a..b', 'c.md', '--faits', hostile)
      assert.equal(refused.status, 1, hostile)
    }
    const spaced = run(dir, 'travail/chantier/issues/06-suite.md', 'a..b', 'c.md', '--faits', '05 06')
    assert.equal(spaced.status, 1)
    assert.ok(spaced.stderr.includes('--faits 05 --faits 06'), spaced.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('--chemins en une chaîne à espaces est refusé, avec la forme répétée', () => {
  const dir = project()
  try {
    const out = run(dir, 'travail/chantier/issues/05-outil.md', 'a..b', 'c.md', '--chemins', 'scripts CLAUDE.md')
    assert.equal(out.status, 1)
    assert.ok(out.stderr.includes('--chemins scripts --chemins CLAUDE.md'), out.stderr)
    assert.ok(!existsSync(join(dir, 'c.md')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('la plage et les chemins passent le corpus hostile commun : chaque entrée les fait refuser', () => {
  assert.equal(isSafeRange('abc1234..def5678'), true)
  assert.equal(isSafeRange('refs/worktree/flow-board/T07^..refs/worktree/flow-board/T07'), true)
  assert.equal(isSafePath('plugins/flow-board/scripts'), true)
  for (const bad of ['abc', 'a...b', '-a..b', 'a..b..c', 'a..$(x)', 'a..b;c', 'a b..c']) assert.equal(isSafeRange(bad), false, bad)
  for (const bad of ['-p', '../x', 'a/../b', ':/', '*.ts', 'a b']) assert.equal(isSafePath(bad), false, bad)
  const range = Object.entries(CORPUS).filter(([, token]) => isSafeRange(`a${token}1..b`) || isSafeRange(`a..b${token}1`)).map(([name]) => name)
  assert.deepEqual(range, [])
  const path = Object.entries(CORPUS).filter(([, token]) => isSafePath(`dossier/a${token}1.md`)).map(([name]) => name)
  assert.deepEqual(path, [])
  assert.equal(isTicketId('05'), true)
  const id = Object.entries(CORPUS).filter(([, token]) => isTicketId(`a${token}1`)).map(([name]) => name)
  assert.deepEqual(id, [])
})

test('dans un worktree, le fichier de décisions est celui du clone principal', () => {
  const dir = project()
  try {
    const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' })
    git(dir, 'init', '-q')
    git(dir, 'config', 'user.name', 'essai')
    git(dir, 'config', 'user.email', 'essai@localhost')
    git(dir, 'config', 'commit.gpgsign', 'false')
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'base')
    const tree = join(dir, 'arbre')
    assert.equal(git(dir, 'worktree', 'add', '-q', tree).status, 0)
    const out = run(tree, 'travail/chantier/issues/05-outil.md', 'a..b', 'c.md')
    assert.equal(out.status, 0, out.stderr)
    const text = readFileSync(join(tree, 'c.md'), 'utf8')
    assert.ok(text.includes(`Les décisions : \`${join(dir, 'travail', 'chantier', 'DECISIONS.md')}\``), text)
    assert.ok(text.includes(`Les règles de jugement : \`${join(tree, 'CODING_STANDARDS.md')}\``), 'CODING_STANDARDS.md se prend dans le worktree')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('la procédure cite le script des consignes par une commande simple', () => {
  assert.ok(procedure.includes('node <dossier de flow-board>/scripts/consignes.mjs <fichier de ticket> <base>..<fin> <sortie>'), 'la procédure ne cite pas consignes.mjs')
  assert.ok(gabarit.includes('scripts/consignes.mjs'), 'le gabarit ne cite pas le script qui le remplit')
})
