#!/usr/bin/env node
// Fichier de consignes de la revue d'un ticket (point 7 de la section 2 de reference/procedure-groupe.md),
// écrit depuis le gabarit reference/consignes-revue.md au lieu d'être recopié à la main :
//
//   node <dossier de flow-board>/scripts/consignes.mjs <fichier de ticket> <base>..<fin> <sortie>
//        [--chemins <chemin>…] [--choix <fichier des choix>] [--faits <fichier de ticket>…] [--declares <fichier>]
//        [--relecteur <id du ticket>]
//
// à lancer depuis la racine du worktree. Le ticket donne son id et son titre (sa première ligne,
// « # <id>: <titre> »), son invariant (ligne « Invariant … : « … » », ou la liste qui suit une ligne
// « Invariants … : ») et son lecteur (ligne « Lecteur : <qui> »), en gras ou non, fins de ligne CRLF
// comprises. `CODING_STANDARDS.md` se prend à la racine du dépôt ; le fichier de décisions à côté du
// ticket (son dossier, puis le dossier au-dessus, puis la racine), lu dans le clone principal quand il
// y est : la copie d'un worktree date du départ de sa branche. `--chemins` limite le diff aux chemins
// de la mission quand d'autres commitent sur la branche ; `--choix` donne le fichier des choix déjà
// déclarés de la mission ; `--faits` les tickets déjà faits du groupe qui touchent les mêmes fichiers,
// dont les critères sont recopiés ; `--declares` un fichier des choix de la session pas encore dans
// le fichier des choix, un par ligne ; `--relecteur` crée le dossier du relecteur de ce ticket (celui de
// `snapshot.mjs --dossier`, dans le dossier git du worktree) et le nomme comme le seul où il écrit : l'id
// vient de la session, jamais du fichier de ticket, et passe la forme d'un id de `snapshot.mjs`. Le texte de chaque ligne est celui du gabarit, ses trous `<…>`
// remplis ; le script ne choisit que les lignes entre crochets qui s'appliquent : un trou qu'il ne
// connaît pas, ou une ligne qu'il ne sait pas classer, le fait échouer (code 1) au lieu d'écrire un
// fichier faux. La plage et les chemins, qui entrent dans une commande `git diff` du relecteur,
// passent une liste blanche. Sans dépendance hors de Node.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { reviewDir, SnapshotError } from './snapshot.mjs'

export class ConsignesError extends Error {}

const TEMPLATE = fileURLToPath(new URL('../reference/consignes-revue.md', import.meta.url))
const OPTIONS = { '--chemins': 'many', '--faits': 'many', '--choix': 'one', '--declares': 'one', '--relecteur': 'one' }

/** Une révision git d'une plage : lettres, chiffres et `_ / . ^ ~ -`, sans « - » en tête ni « .. ». */
const SAFE_REV = /^[A-Za-z0-9_][A-Za-z0-9_/.^~-]{0,199}$/
/** Un chemin de la mission pour `git diff -- <chemins>` : la même liste blanche, sans « .. ». */
const SAFE_PATH = /^[A-Za-z0-9_.][A-Za-z0-9_/.-]{0,199}$/

/** Une plage `<base>..<fin>` dont chaque bout passe la liste blanche. */
export const isSafeRange = value => {
  if (typeof value !== 'string') return false
  const parts = value.split('..')
  return parts.length === 2 && parts.every(p => SAFE_REV.test(p) && !p.includes('..'))
}

/** Un chemin que `--chemins` accepte. */
export const isSafePath = value => typeof value === 'string' && SAFE_PATH.test(value) && !value.split('/').includes('..')

/** Le texte du gabarit sous sa ligne `---`. */
const templateBody = template => {
  const at = template.indexOf('\n---\n')
  if (at < 0) throw new ConsignesError('gabarit sans ligne « --- » avant son texte')
  return template.slice(at + 5).replace(/^\n+/, '')
}

const lf = text => text.replace(/\r\n?/g, '\n')

/** L'id et le titre d'un ticket, son invariant et son lecteur, lus dans son texte. */
export const readTicket = (raw, path) => {
  const lines = lf(raw).split('\n')
  const head = /^#\s*([^:\s]+):\s*(.+)$/.exec(lines[0] || '')
  const id = head ? head[1] : basename(path).replace(/\.md$/, '')
  const title = head ? head[2].trim() : (lines[0] || '').replace(/^#+\s*/, '').trim()
  let invariant = null
  const at = lines.findIndex(l => /^\**Invariants?\b[^:]*:/.test(l))
  if (at >= 0) {
    const inline = lines[at].slice(lines[at].indexOf(':') + 1).replace(/\*+/g, '').trim()
    const listed = []
    if (inline === '') for (const l of lines.slice(at + 1)) {
      if (!l.startsWith('- ')) break
      listed.push(l.slice(2).trim().replace(/[.;]$/, '').trim())
    }
    invariant = (inline || listed.join(' ; ')).replace(/\.$/, '').trim() || null
  }
  const reader = lines.map(l => /^\**Lecteur\s*:\**\s*(.+)$/.exec(l)).find(Boolean)
  return { id, title, path, invariant, reader: reader ? reader[1].trim().replace(/\.$/, '') : null }
}

/** Les critères d'un ticket, sans la note de test qui suit « — ». */
export const criteria = (raw, id) =>
  lf(raw).split('\n').filter(l => /^- \[[ x]\] /.test(l)).map(l => `${id} : ${l.slice(6).split(' — ')[0].trim()}`)

const MARK = String.fromCharCode(1)

const quoted = text => (text.includes('«') ? text : `« ${text} »`)

/**
 * Remplit les trous d'une ligne du gabarit : chaque trou nommé est remplacé par sa valeur (par
 * `split` et `join`, jamais `replace` : un `$&` ou un `$'` venu d'un ticket reste du texte) ; une parenthèse qui explique des
 * trous restants part ; un trou inconnu lève ConsignesError.
 */
const fill = (line, values) => {
  // Les trous connus deviennent des repères (un caractère de contrôle, absent du gabarit) avant le
  // contrôle des trous restants : une valeur qui contient elle-même `<…>` ne passe pas pour un trou.
  const holes = Object.keys(values)
  let out = line
  holes.forEach((hole, i) => { out = out.split(hole).join(`${MARK}${i}${MARK}`) })
  out = out.replace(/ \([^()]*<[^()]*\)/g, '')
  const left = /<[^<>]*>/.exec(out)
  if (left) throw new ConsignesError(`trou du gabarit inconnu du script : « ${left[0]} » dans « ${line.slice(0, 80)} »`)
  return out.split(MARK).map((piece, i) => (i % 2 === 1 ? values[holes[Number(piece)]] : piece)).join('')
}

/**
 * Le fichier de consignes, ligne à ligne depuis le gabarit : le texte de chaque ligne vient du
 * gabarit, ses trous remplis ; une ligne entre crochets part quand elle ne s'applique pas ; une ligne
 * que le script ne sait pas classer lève ConsignesError.
 */
export const render = (template, data) => {
  const { ticket, range } = data
  const paths = data.paths || []
  const out = []
  const keep = (line, values) => out.push(fill(line.replace(/^- \[(.*)\]$/, '- $1'), values))
  for (const line of templateBody(template).split('\n')) {
    const item = line.startsWith('- ') ? line.slice(2).replace(/^\[/, '') : null
    if (line === '' || line.startsWith('## ') || line.startsWith('> ')) out.push(line)
    else if (line.startsWith('# ')) {
      const prefix = line.slice(0, line.indexOf(': ') + 2)
      if (!line.includes(': ')) throw new ConsignesError(`titre du gabarit sans « : » : « ${line.slice(0, 80)} »`)
      out.push(`${prefix}ticket ${ticket.id} « ${ticket.title} »`)
    } else if (item === null) throw new ConsignesError(`ligne du gabarit inconnue du script : « ${line.slice(0, 80)} »`)
    else if (item.startsWith('Cible')) keep(line, { '<base>..<fin>': range })
    else if (item.startsWith('Avant le commit du ticket')) continue
    else if (item.startsWith("D'autres missions")) {
      if (paths.length) keep(line, { '<base>..<fin>': range, '<chemins de la mission>': paths.join(' ') })
    } else if (item.startsWith('Le ticket')) keep(line, { '<chemin du fichier de ticket>': ticket.path, '<sections>': 'celles que le ticket nomme' })
    else if (item.startsWith("Revue d'un ticket")) {
      if ((data.done || []).length) keep(line, { '<id> : <critère> ; …': data.done.join(' ; ') })
    } else if (item.startsWith('Revue du groupe')) continue
    else if (item.startsWith('Les choix déjà déclarés')) {
      keep(line, {
        '`<chemin du fichier des choix>`': data.choix ? `\`${data.choix}\`` : 'aucun fichier des choix (option --choix)',
        '<liste>': (data.declared || []).length ? data.declared.join(' ; ') : 'aucun',
      })
    } else if (item.startsWith('Les décisions')) {
      keep(line, { '`<fichier de décisions du projet>`': data.decisions ? `\`${data.decisions}\`` : 'aucun fichier de décisions trouvé à côté du ticket' })
    } else if (item.startsWith('Les règles de jugement')) {
      if (data.standards) keep(line, { '<racine du dossier de travail>': dirname(data.standards) })
    } else if (item.startsWith('Passe « bogues »')) {
      if (ticket.invariant) keep(line, { '« <invariant> »': quoted(ticket.invariant) })
    } else if (item.startsWith('Relecture du fond et de la forme')) {
      if (ticket.reader) keep(line, { "<la ligne « Lecteur » du ticket, ou celui que la session a nommé>": ticket.reader })
    } else if (item.startsWith('Réservé au porteur')) {
      keep(line, { '<une décision, un geste, un accès>': 'les choix de conception et les questions sensibles, les versions et les CHANGELOG' })
    } else if (item.startsWith('À ne pas faire')) {
      keep(line, { '<ce que ce relecteur ne doit pas faire, en plus de la consigne ci-dessous>': "écrire dans l'arbre de travail, dans l'index ou dans `/tmp`, lancer une commande qui écrit dans le dépôt" })
    } else if (item.startsWith('Où écrire')) {
      if (data.reviewDir) keep(line, { '`<dossier du relecteur>`': `\`${data.reviewDir}\`` })
    } else throw new ConsignesError(`ligne du gabarit inconnue du script : « ${line.slice(0, 80)} »`)
  }
  return out.join('\n')
}

/** Les arguments : trois positionnels, puis les options. */
const parse = argv => {
  const positional = []
  const options = { '--chemins': [], '--faits': [], '--choix': null, '--declares': null, '--relecteur': null }
  let current = null
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      if (!(arg in OPTIONS)) throw new ConsignesError(`option inconnue : ${arg}`)
      current = arg
      continue
    }
    if (current === null) positional.push(arg)
    else if (OPTIONS[current] === 'many') options[current].push(arg)
    else {
      options[current] = arg
      current = null
    }
  }
  if (positional.length !== 3) throw new ConsignesError('consignes.mjs <fichier de ticket> <base>..<fin> <sortie> [options]')
  return { positional, options }
}

const readFile = (cwd, path, what) => {
  const full = resolve(cwd, path)
  if (!existsSync(full) || !statSync(full).isFile()) throw new ConsignesError(`${what} introuvable : ${path}`)
  return readFileSync(full, 'utf8')
}

/** Le texte d'une commande git dans `cwd`, ou null en échec. */
const gitOut = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/** Le fichier de décisions du ticket, pris dans le clone principal quand il y existe. */
const decisionsFile = (cwd, ticketPath, top) => {
  const near = dirname(resolve(cwd, ticketPath))
  const found = [near, dirname(near), top].map(d => join(d, 'DECISIONS.md')).find(p => existsSync(p))
  if (!found) return null
  const common = gitOut(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const main = common ? dirname(common) : null
  const rel = relative(top, found)
  if (main && main !== top && !rel.startsWith('..') && existsSync(join(main, rel))) return join(main, rel)
  return found
}

/** Écrit le fichier de consignes ; rend son chemin. */
export const writeConsignes = (argv, cwd = process.cwd()) => {
  const { positional: [ticketPath, range, output], options } = parse(argv)
  if (!isSafeRange(range)) throw new ConsignesError(`cible hors forme : ${JSON.stringify(range)} (une plage <base>..<fin> de révisions simples, jamais un hash seul)`)
  const bad = options['--chemins'].find(p => !isSafePath(p))
  if (bad !== undefined) throw new ConsignesError(`chemin hors forme : ${JSON.stringify(bad)} (lettres, chiffres, _ . / -, sans « .. » ni « - » en tête)`)
  const ticket = readTicket(readFile(cwd, ticketPath, 'fichier de ticket'), ticketPath)
  const top = gitOut(cwd, ['rev-parse', '--show-toplevel']) || cwd
  const decisions = decisionsFile(cwd, ticketPath, top)
  const standards = existsSync(join(top, 'CODING_STANDARDS.md')) ? join(top, 'CODING_STANDARDS.md') : null
  const done = options['--faits'].flatMap(p => {
    const text = readFile(cwd, p, 'fichier de ticket fait')
    return criteria(text, readTicket(text, p).id)
  })
  const declared = options['--declares'] ? lf(readFile(cwd, options['--declares'], 'fichier des choix de la session')).split('\n').map(l => l.trim()).filter(Boolean) : []
  // Vérifié avant de créer le dossier : un gabarit ou une option fausse n'en laisse aucun.
  const template = readFileSync(TEMPLATE, 'utf8')
  const data = { ticket, range, paths: options['--chemins'], choix: options['--choix'], declared, done, decisions, standards }
  render(template, data)
  let dir = null
  if (options['--relecteur'] !== null) {
    try {
      dir = reviewDir(options['--relecteur'], cwd)
    } catch (err) {
      throw err instanceof SnapshotError ? new ConsignesError(err.message) : err
    }
  }
  const text = render(template, { ...data, reviewDir: dir })
  const target = resolve(cwd, output)
  writeFileSync(target, text)
  return target
}

const main = argv => {
  try {
    const target = writeConsignes(argv)
    console.log(`Consignes écrites : ${target}`)
    return 0
  } catch (err) {
    console.error(`ÉCHEC : ${err instanceof ConsignesError ? err.message : String(err.message || err)}`)
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
