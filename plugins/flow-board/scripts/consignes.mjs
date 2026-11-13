#!/usr/bin/env node
// Fichier de consignes d'une revue (point 7 de la section 2 de reference/procedure-groupe.md) : celle d'un
// ticket, celle d'un groupe ou sa revue de sécurité, écrit depuis le gabarit reference/consignes-revue.md
// au lieu d'être recopié à la main :
//
//   node <dossier de flow-board>/scripts/consignes.mjs <fichier de ticket> <base>..<fin> <sortie>
//        [--chemins <chemin>…] [--choix <fichier des choix>] [--faits <fichier ou id de ticket>…] [--declares <fichier>]
//        [--relecteur <id du ticket>]
//   node <dossier de flow-board>/scripts/consignes.mjs --groupe <id du groupe> <base>..<fin> <sortie> <fichier de ticket>…
//        [--chemins <chemin>…] [--choix <fichier des choix>] [--declares <fichier>]
//   node <dossier de flow-board>/scripts/consignes.mjs --securite <id du groupe> <base>..<lancement> <sortie> <fichier de ticket>…
//        [--chemins <chemin>…] [--choix <fichier des choix>] [--declares <fichier>]
//
// à lancer depuis la racine du worktree. `--groupe` écrit les consignes de la revue du groupe : les lignes
// « Revue du groupe » du gabarit gardées et remplies (les ids des tickets, tirés de leurs fichiers, leurs
// chemins et leurs invariants), les lignes propres à un ticket retirées, et le dossier du relecteur
// `groupe-<id>` créé et nommé (celui de `snapshot.mjs --dossier groupe-<id>`). `--securite` écrit celles de
// la revue de sécurité du groupe : le même périmètre et les invariants des tickets, sans les deux lignes
// qui s'adressent à la revue de code du groupe (son mandat, « se concentrer sur les interactions… », et
// « Revue du groupe, sécurité » : la revue de sécurité suit sa propre méthode), avec le dossier
// `securite-<id>` ; `<lancement>` est le hash de HEAD au lancement, écrit en clair (jamais `HEAD` ni une
// branche : refusé). Seule la revue d'un groupe garde l'exception des correctifs d'une revue `--fix`, dans
// ses lignes « À ne pas faire » et « Où écrire » : la revue d'un ticket et la revue de sécurité n'écrivent
// jamais dans l'arbre. L'id du groupe passe le garde `isGroupId` (lettres et chiffres ASCII, 12 au plus) ; `--faits` et
// `--relecteur` ne valent que pour un ticket. Le ticket donne son id et son titre (sa première ligne,
// « # <id>: <titre> »), son invariant (ligne « Invariant … : « … » », ou la liste qui suit une ligne
// « Invariants … : ») et son lecteur (ligne « Lecteur : <qui> »), en gras ou non, fins de ligne CRLF
// comprises. `CODING_STANDARDS.md` se prend à la racine du dépôt ; le fichier de décisions à côté du
// ticket (son dossier, puis le dossier au-dessus, puis la racine), lu dans le clone principal quand il
// y est : la copie d'un worktree date du départ de sa branche. `--chemins` limite le diff aux chemins
// de la mission quand d'autres commitent sur la branche ; `--choix` donne le fichier des choix déjà
// déclarés de la mission ; `--faits` les tickets déjà faits du groupe qui touchent les mêmes fichiers,
// dont les critères sont recopiés (un chemin, ou l'id d'un ticket, dont le fichier `<id>-*.md` se cherche
// dans le dossier du ticket relu, l'id passant le garde `isTicketId`) ; `--chemins` et `--faits` prennent
// un argument par chemin ou id, une chaîne à espaces est refusée avec la forme répétée ; `--declares` un fichier des choix de la session pas encore dans
// le fichier des choix, un par ligne ; `--relecteur` crée le dossier du relecteur de ce ticket (celui de
// `snapshot.mjs --dossier` : dans le dossier temporaire de la session quand `CLAUDE_JOB_DIR` en désigne un,
// sinon dans le dossier git du worktree) et le nomme comme le seul où il écrit : l'id
// vient de la session, jamais du fichier de ticket, et passe la forme d'un id de `snapshot.mjs`. Le texte de chaque ligne est celui du gabarit, ses trous `<…>`
// remplis ; le script ne choisit que les lignes entre crochets qui s'appliquent : un trou qu'il ne
// connaît pas, ou une ligne qu'il ne sait pas classer, le fait échouer (code 1) au lieu d'écrire un
// fichier faux. La plage et les chemins, qui entrent dans une commande `git diff` du relecteur,
// passent une liste blanche. Sans dépendance hors de Node.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { reviewDir, SnapshotError } from './snapshot.mjs'

export class ConsignesError extends Error {}

const TEMPLATE = fileURLToPath(new URL('../reference/consignes-revue.md', import.meta.url))
const OPTIONS = { '--chemins': 'many', '--faits': 'many', '--choix': 'one', '--declares': 'one', '--relecteur': 'one', '--groupe': 'one', '--securite': 'one' }

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

/** Le hash d'un commit écrit en clair : la fin de la plage d'une revue de sécurité, figée à son lancement. */
const COMMIT_HASH = /^[0-9a-f]{7,64}$/

/** L'id d'un groupe que `--groupe` et `--securite` acceptent : lettres et chiffres ASCII, 12 au plus. */
const GROUP_ID = /^[A-Za-z0-9]{1,12}$/

/** Un id de groupe que le script accepte : il nomme le dossier du relecteur. */
export const isGroupId = value => typeof value === 'string' && GROUP_ID.test(value)

/** Une liste « a, b et c ». */
const andList = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items.at(-1)}`)

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

/** La fin de la ligne « Où écrire » du gabarit, qui ne vaut que pour la revue d'un groupe : ses correctifs de `--fix`. */
const FIX_EXCEPTION = ", hors des correctifs qu'applique une revue `--fix` du groupe (consigne ci-dessous)"

/**
 * Le fichier de consignes, ligne à ligne depuis le gabarit : le texte de chaque ligne vient du
 * gabarit, ses trous remplis ; une ligne entre crochets part quand elle ne s'applique pas ; une ligne
 * que le script ne sait pas classer lève ConsignesError. `data.mode` choisit la revue : celle d'un
 * ticket (`data.ticket`, par défaut), ou celle d'un groupe (`'groupe'`) et sa revue de sécurité
 * (`'securite'`), avec `data.group` et `data.tickets` : les lignes « Revue du groupe » restent, celles
 * qui sont propres à un ticket partent, et la revue de sécurité ne garde des lignes « Revue du groupe »
 * que celle des invariants (les deux autres s'adressent à la revue de code du groupe). La ligne « Où
 * écrire » ne garde l'exception des correctifs d'une revue `--fix` que pour la revue d'un groupe.
 */
export const render = (template, data) => {
  const { ticket, range } = data
  const mode = data.mode || 'ticket'
  const tickets = mode === 'ticket' ? [ticket] : data.tickets
  const invariants = tickets.filter(t => t.invariant).map(t => `${t.id} : ${quoted(t.invariant)}`)
  const ids = andList(tickets.map(t => t.id))
  const paths = data.paths || []
  const out = []
  const keep = (line, values) => out.push(fill(line.replace(/^- \[(.*)\]$/, '- $1'), values))
  for (const line of templateBody(template).split('\n')) {
    const item = line.startsWith('- ') ? line.slice(2).replace(/^\[/, '') : null
    if (line === '' || line.startsWith('## ') || line.startsWith('> ')) out.push(line)
    else if (line.startsWith('# ')) {
      const prefix = line.slice(0, line.indexOf(': ') + 2)
      if (!line.includes(': ')) throw new ConsignesError(`titre du gabarit sans « : » : « ${line.slice(0, 80)} »`)
      if (mode === 'ticket') out.push(`${prefix}ticket ${ticket.id} « ${ticket.title} »`)
      else out.push(`${prefix}${mode === 'securite' ? 'revue de sécurité du ' : ''}groupe ${data.group} (ticket${tickets.length > 1 ? 's' : ''} ${ids})`)
    } else if (item === null) throw new ConsignesError(`ligne du gabarit inconnue du script : « ${line.slice(0, 80)} »`)
    else if (item.startsWith('Cible')) keep(line, { '<base>..<fin>': range })
    else if (item.startsWith('Avant le commit du ticket')) continue
    else if (item.startsWith("D'autres missions")) {
      if (paths.length) keep(line, { '<base>..<fin>': range, '<chemins de la mission>': paths.join(' ') })
    } else if (item.startsWith('Le ticket')) {
      if (mode === 'ticket') keep(line, { '<chemin du fichier de ticket>': ticket.path, '<sections>': 'celles que le ticket nomme' })
    } else if (item.startsWith("Revue d'un ticket")) {
      if (mode === 'ticket' && (data.done || []).length) keep(line, { '<id> : <critère> ; …': data.done.join(' ; ') })
    } else if (item.startsWith('Revue du groupe, sécurité')) {
      if (mode === 'groupe') keep(line, {})
    } else if (item.startsWith('Revue du groupe : les invariants')) {
      if (mode !== 'ticket' && invariants.length) keep(line, { '<id> : « <invariant> » ; …': invariants.join(' ; ') })
    } else if (item.startsWith('Revue du groupe')) {
      // Le mandat de la revue de code du groupe, que la revue de sécurité ne reçoit pas : elle suit sa méthode.
      // Les ids viennent des fichiers de tickets, dont les chemins suivent : la revue du groupe les relit.
      if (mode === 'groupe') keep(line, { '<ids>': `${ids} (${tickets.map(t => `\`${t.path}\``).join(', ')})` })
    } else if (item.startsWith('Les choix déjà déclarés')) {
      keep(line, {
        '`<chemin du fichier des choix>`': data.choix ? `\`${data.choix}\`` : 'aucun fichier des choix (option --choix)',
        '<liste>': (data.declared || []).length ? data.declared.join(' ; ') : 'aucun',
        // La base du « comme avant » : celle de la cible ; le chemin reste à choisir par le relecteur.
        '<base>': range.split('..')[0],
        '<fichier>': 'chemin/du/fichier',
      })
    } else if (item.startsWith('Les décisions')) {
      keep(line, { '`<fichier de décisions du projet>`': data.decisions ? `\`${data.decisions}\`` : 'aucun fichier de décisions trouvé à côté du ticket' })
    } else if (item.startsWith('Les règles de jugement')) {
      if (data.standards) keep(line, { '<racine du dossier de travail>': dirname(data.standards) })
    } else if (item.startsWith('Passe « bogues »')) {
      if (mode === 'ticket' && ticket.invariant) keep(line, { '« <invariant> »': quoted(ticket.invariant) })
    } else if (item.startsWith('Relecture du fond et de la forme')) {
      if (mode === 'ticket' && ticket.reader) keep(line, { "<la ligne « Lecteur » du ticket, ou celui que la session a nommé>": ticket.reader })
    } else if (item.startsWith('Réservé au porteur')) {
      keep(line, { '<une décision, un geste, un accès>': 'les choix de conception et les questions sensibles, les versions et les CHANGELOG' })
    } else if (item.startsWith('À ne pas faire')) {
      // Seule la revue d'un groupe peut écrire dans l'arbre, par les correctifs de `--fix` (consigne des relecteurs).
      const tree = mode === 'groupe' ? "écrire dans l'arbre de travail hors des correctifs d'une revue `--fix`" : "écrire dans l'arbre de travail"
      keep(line, { '<ce que ce relecteur ne doit pas faire, en plus de la consigne ci-dessous>': `${tree}, dans l'index ou dans \`/tmp\`, lancer une commande qui écrit dans le dépôt` })
    } else if (item.startsWith('Où écrire')) {
      if (!data.reviewDir) continue
      // Seule la revue d'un groupe applique des correctifs : ailleurs, la ligne perd cette exception, comme
      // « À ne pas faire ». Un gabarit qui ne la porte plus telle quelle fait échouer, au lieu de la laisser.
      if (mode !== 'groupe' && !line.includes(FIX_EXCEPTION)) throw new ConsignesError(`ligne « Où écrire » du gabarit sans la fin attendue : « ${FIX_EXCEPTION} »`)
      keep(line, { '`<dossier du relecteur>`': `\`${data.reviewDir}\``, ...(mode === 'groupe' ? {} : { [FIX_EXCEPTION]: '' }) })
    } else throw new ConsignesError(`ligne du gabarit inconnue du script : « ${line.slice(0, 80)} »`)
  }
  return out.join('\n')
}

const USAGE = 'consignes.mjs <fichier de ticket> <base>..<fin> <sortie> [options], ou consignes.mjs --groupe <id du groupe> <base>..<fin> <sortie> <fichier de ticket>… [options], ou consignes.mjs --securite <id du groupe> <base>..<lancement> <sortie> <fichier de ticket>… [options]'

/** Les arguments : les positionnels (trois pour un ticket ; la plage, la sortie puis les tickets pour un groupe), et les options. */
const parse = argv => {
  const positional = []
  const options = { '--chemins': [], '--faits': [], '--choix': null, '--declares': null, '--relecteur': null, '--groupe': null, '--securite': null }
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
  if (current !== null && OPTIONS[current] === 'one') throw new ConsignesError(`${current} attend une valeur ; ${USAGE}`)
  if (options['--groupe'] !== null && options['--securite'] !== null) throw new ConsignesError('--groupe et --securite écrivent deux fichiers : une commande par fichier')
  const group = options['--groupe'] ?? options['--securite']
  if (group === null ? positional.length !== 3 : positional.length < 3) throw new ConsignesError(USAGE)
  return { positional, options }
}

/** L'id d'un ticket que `--faits` accepte à la place d'un chemin : lettres et chiffres seulement. */
const TICKET_ID = /^[A-Za-z0-9]{1,12}$/

/** Un id de ticket que `--faits` accepte. */
export const isTicketId = value => typeof value === 'string' && TICKET_ID.test(value)

/** Le fichier d'un ticket fait : le chemin donné, ou, pour un id, le seul fichier `<id>-*.md` (ou `<id>.md`)
 * du dossier d'issues du ticket relu. */
const doneTicketPath = (cwd, ticketPath, ref) => {
  const full = resolve(cwd, ref)
  if (existsSync(full) && statSync(full).isFile()) return ref
  if (!isTicketId(ref)) throw new ConsignesError(`fichier de ticket fait introuvable : ${ref} (un chemin, ou l'id d'un ticket du dossier d'issues)`)
  const issues = dirname(resolve(cwd, ticketPath))
  const found = readdirSync(issues).filter(name => name === `${ref}.md` || (name.startsWith(`${ref}-`) && name.endsWith('.md')))
  if (found.length !== 1) {
    const where = relative(cwd, issues) || '.'
    throw new ConsignesError(`ticket fait « ${ref} » : ${found.length} fichier(s) ${ref}-*.md dans ${where}${found.length ? ` (${found.join(', ')})` : ''}`)
  }
  return join(issues, found[0])
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

/**
 * Écrit le fichier de consignes ; rend son chemin. Avec `--groupe <id>` ou `--securite <id>`, celui de
 * la revue du groupe ou de sa revue de sécurité : la plage, la sortie, puis les fichiers de ses tickets ;
 * le dossier du relecteur est alors `groupe-<id>` ou `securite-<id>`, créé sans option `--relecteur`.
 */
export const writeConsignes = (argv, cwd = process.cwd()) => {
  const { positional, options } = parse(argv)
  const group = options['--groupe'] ?? options['--securite']
  const mode = group === null ? 'ticket' : options['--groupe'] !== null ? 'groupe' : 'securite'
  const [range, output, ...ticketPaths] = mode === 'ticket' ? [positional[1], positional[2], positional[0]] : positional
  if (!isSafeRange(range)) throw new ConsignesError(`cible hors forme : ${JSON.stringify(range)} (une plage <base>..<fin> de révisions simples, jamais un hash seul)`)
  if (mode !== 'ticket') {
    if (!isGroupId(group)) throw new ConsignesError(`id de groupe hors forme : ${JSON.stringify(group)} (lettres et chiffres ASCII, 12 au plus)`)
    // La revue de sécurité se fige au commit de son lancement : les correctifs de la revue du groupe se commitent pendant qu'elle tourne.
    if (mode === 'securite' && !COMMIT_HASH.test(range.split('..')[1])) throw new ConsignesError(`cible de la revue de sécurité : ${JSON.stringify(range)} ; sa fin est le hash de HEAD à son lancement, écrit en clair (7 à 64 chiffres hexadécimaux), jamais HEAD ni une branche`)
    for (const option of ['--faits', '--relecteur']) {
      if (options[option] !== null && options[option].length !== 0) throw new ConsignesError(`${option} ne vaut que pour la revue d'un ticket : la revue d'un groupe relit tous ses tickets, et son dossier du relecteur vient de l'id du groupe`)
    }
  }
  for (const option of ['--chemins', '--faits']) {
    const spaced = options[option].find(p => /\s/.test(p.trim()))
    if (spaced === undefined) continue
    const repeated = spaced.trim().split(/\s+/).map(p => `${option} ${p}`).join(' ')
    throw new ConsignesError(`${option} prend un chemin ou un id par argument, jamais une chaîne à espaces : ${repeated}`)
  }
  const bad = options['--chemins'].find(p => !isSafePath(p))
  if (bad !== undefined) throw new ConsignesError(`chemin hors forme : ${JSON.stringify(bad)} (lettres, chiffres, _ . / -, sans « .. » ni « - » en tête)`)
  const tickets = ticketPaths.map(path => readTicket(readFile(cwd, path, 'fichier de ticket'), path))
  const top = gitOut(cwd, ['rev-parse', '--show-toplevel']) || cwd
  // Le fichier de décisions se cherche à côté du premier ticket : ceux d'un groupe sont du même chantier.
  const decisions = decisionsFile(cwd, ticketPaths[0], top)
  const standards = existsSync(join(top, 'CODING_STANDARDS.md')) ? join(top, 'CODING_STANDARDS.md') : null
  const done = options['--faits'].flatMap(ref => {
    const p = doneTicketPath(cwd, ticketPaths[0], ref)
    const text = readFile(cwd, p, 'fichier de ticket fait')
    return criteria(text, readTicket(text, p).id)
  })
  const declared = options['--declares'] ? lf(readFile(cwd, options['--declares'], 'fichier des choix de la session')).split('\n').map(l => l.trim()).filter(Boolean) : []
  // Vérifié avant de créer le dossier : un gabarit ou une option fausse n'en laisse aucun.
  const template = readFileSync(TEMPLATE, 'utf8')
  const data = { mode, group, ticket: tickets[0], tickets, range, paths: options['--chemins'], choix: options['--choix'], declared, done, decisions, standards }
  render(template, data)
  const reviewer = mode === 'ticket' ? options['--relecteur'] : `${mode}-${group}`
  let dir = null
  if (reviewer !== null) {
    try {
      dir = reviewDir(reviewer, cwd)
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
