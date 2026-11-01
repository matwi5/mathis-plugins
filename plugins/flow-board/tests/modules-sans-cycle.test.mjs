// Les modules sortis du modèle ne l'importent jamais, ni directement ni par un détour (un module qu'ils
// importent et qui importerait le modèle), et aucun ne revient sur lui-même : `basics` n'atteint ni le
// modèle, ni le relais, ni le lien ; `relay` n'atteint ni le modèle ni le lien ; `link` n'atteint pas le
// modèle ; le modèle les importe. Un import en retour referait un cycle, qui marche à l'exécution mais
// se casse au premier `const` lu avant sa définition. Un test Node (node --test, lancé par
// scripts/check.sh) : il lit les sources.

import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Le code d'une source TypeScript (pas JSX), ses commentaires retirés (ceux de bloc blanchis, leurs sauts de
 * ligne gardés), le texte de ses gabarits retiré (leurs `${…}` gardés, entre deux blancs) et chaque chaîne,
 * ou gabarit sans `${…}`, remplacé par son rang (`'#3'`), avec la liste des chaînes : un import ne se lit
 * plus que dans le code, jamais dans une chaîne ou un commentaire. Une expression régulière littérale
 * (`/'/g`) se saute aussi, pour qu'une apostrophe n'y ouvre pas de chaîne ; qu'une barre en ouvre une se
 * devine aux caractères qui la précèdent.
 * `unclosed` compte les littéraux pas refermés (chaîne au bout de sa ligne, expression régulière, gabarit ou
 * commentaire au bout du fichier) : dans un module qui compile, il n'y en a aucun, sauf si la lecture a déraillé.
 */
const lex = source => {
  const strings = []
  let out = ''
  let unclosed = 0
  const blank = text => text.replace(/[^\n]/g, ' ')
  // Le corps d'une expression régulière littérale, depuis le caractère qui suit sa barre ouvrante.
  const regex = i => {
    let isInClass = false
    while (i < source.length && source[i] !== '\n') {
      const c = source[i]
      if (c === '\\') i += 2
      else if (isInClass) (isInClass = c !== ']'), i++
      else if (c === '[') (isInClass = true), i++
      else if (c === '/') {
        i++
        while (/[a-z]/i.test(source[i] ?? '')) i++
        return i
      } else i++
    }
    unclosed++
    return i
  }
  // Un gabarit, depuis le caractère qui suit son accent grave : son texte est retiré, ses `${…}` lus comme
  // du code ; sans `${…}`, il compte comme une chaîne (`import(`./x.ts`)`).
  const template = i => {
    let text = ''
    let isPlain = true
    while (i < source.length && source[i] !== '`') {
      if (source[i] === '\\') (text += source[i + 1] ?? ''), (i += 2)
      else if (source[i] === '$' && source[i + 1] === '{') {
        isPlain = false
        out += ' '
        i = code(i + 2, true)
        out += ' '
      } else text += source[i++]
    }
    if (i >= source.length) unclosed++
    if (isPlain) {
      strings.push(text)
      out += `'#${strings.length - 1}'`
    } else out += '``'
    return i + 1
  }
  // Du code, jusqu'à la fin de la source, ou jusqu'à l'accolade qui ferme un `${` quand isInTemplate.
  const code = (i, isInTemplate) => {
    let depth = 0
    // Les derniers caractères significatifs, pour savoir si une barre ouvre une expression régulière.
    let tail = ''
    while (i < source.length) {
      const c = source[i]
      const next = source[i + 1]
      if (c === '/' && next === '/') {
        const end = source.indexOf('\n', i)
        i = end === -1 ? source.length : end
      } else if (c === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2)
        if (end === -1) unclosed++
        const stop = end === -1 ? source.length : end + 2
        out += blank(source.slice(i, stop))
        i = stop
        tail += ' '
      } else if (c === "'" || c === '"') {
        let j = i + 1
        let value = ''
        while (j < source.length && source[j] !== c && source[j] !== '\n') {
          if (source[j] === '\\') (value += source[j + 1] ?? ''), (j += 2)
          else value += source[j++]
        }
        strings.push(value)
        out += `'#${strings.length - 1}'`
        // Une chaîne pas refermée sur sa ligne s'arrête avant le saut de ligne, qui reste au code.
        if (source[j] !== c) unclosed++
        i = source[j] === c ? j + 1 : j
        tail += 'x'
      } else if (c === '`') {
        i = template(i + 1)
        tail += 'x'
      } else if (
        c === '/' &&
        // Après un opérateur, une ouverture, une flèche ou un mot-clé : une expression régulière ; après une
        // valeur, une division, y compris derrière l'assertion « non nul » de TypeScript (`x! / y`).
        (/(?:^|[(,=:[&|?{};+\-*%~^<>])\s*$/.test(tail) ||
          /(?:^|[^\w$)\]])\s*!\s*$/.test(tail) ||
          /(?:^|[^\w$.])(?:return|typeof|instanceof|new|delete|throw|case|do|else|in|of|void|yield|await)\s*$/.test(tail))
      ) {
        const end = regex(i + 1)
        out += ' '.repeat(end - i)
        i = end
        tail += 'x'
      } else {
        if (isInTemplate && c === '{') depth++
        else if (isInTemplate && c === '}') {
          if (depth === 0) return i + 1
          depth--
        }
        out += c
        tail += /\s/.test(c) ? ' ' : c
        i++
      }
      tail = tail.slice(-12)
    }
    return i
  }
  code(0, false)
  return { code: out, strings, unclosed }
}

/** Les modules qu'importe une source : `import … from`, `export … from`, `import '…'` et `import('…')`, entre apostrophes ou guillemets (et, pour `import()`, entre accents graves sans `${…}`). */
const importsIn = source => {
  const { code, strings } = lex(source)
  const spec = m => strings[Number(m[1])]
  return [
    ...[...code.matchAll(/^\s*(?:import|export)\b[^;']*?\bfrom\s*'#(\d+)'/gm)].map(spec),
    ...[...code.matchAll(/^\s*import\s*'#(\d+)'/gm)].map(spec),
    // Pas une méthode nommée import (`registre.import('…')`) ; un second argument (options) est admis.
    ...[...code.matchAll(/(?<![\w$.])import\s*\(\s*'#(\d+)'\s*[,)]/g)].map(spec),
  ]
}

const importsOf = file => importsIn(readFileSync(new URL(`../hooks/${file}`, import.meta.url), 'utf8'))

test('la lecture des imports voit les guillemets doubles, les import() dynamiques et les imports sans nom, jamais un import cité dans une chaîne ou un commentaire', () => {
  const sample = [
    'import { a } from "./guillemets.ts"',
    "import type { B } from '../types'",
    "import './sans-nom.ts'",
    "export * from './reexport.ts'",
    "const r = /'/g",
    "const m = await import('./dynamique.ts')",
    "const n = await import ( \"./dynamique-espaces.ts\" )",
    "// import x from './commentaire-ligne.ts'",
    "/* import y from './commentaire-bloc.ts'",
    "import z from './commentaire-bloc-2.ts' */",
    "const s = \"import w from './chaine.ts'\"",
    "const t = `",
    "import v from './gabarit.ts'",
    "${import('./gabarit-expression.ts')}`",
    "const u = 'import(\\'./chaine-dynamique.ts\\')'",
    'const d = 1 / 2 // import q from "./apres-division.ts"',
    // Une expression régulière rendue par une fonction fléchée : son apostrophe ou son accent grave n'ouvre rien.
    "const f = s => /'/.test(s)",
    "import { g } from './apres-fleche.ts'",
    'const h = s => /`/.test(s)',
    "const k = `import p from './gabarit-apres-fleche.ts'`",
    "export { l } from './fin.ts'",
    // Une division derrière l'assertion « non nul » n'ouvre pas d'expression régulière ; une négation, si.
    "const ratio = a[0]! / 2 // l'apostrophe d'un commentaire",
    "const neg = !/'/.test(s)",
    "import { o } from './apres-negation.ts'",
    // Un import() dans le second `${…}` d'un gabarit, entre accents graves, avec des options ; pas une méthode.
    "const x = `${a} et ${import('./second-expression.ts')}`",
    "const y = await import(`./specifiant-gabarit.ts`)",
    "const z = await import('./avec-options.ts', { with: { type: 'json' } })",
    "registre.import('./methode.ts')",
    // Une barre après « < » ou « throw » ouvre une expression régulière ; après une propriété nommée « in », non.
    "function e() { throw /'/ }",
    "const w = r.in / 2 // l'apostrophe d'un commentaire",
    "if (n < /`/.exec(s).length) f()",
    "const q = await import('./apres-inferieur.ts')",
  ].join('\n')
  assert.equal(lex(sample).unclosed, 0)
  // Une chaîne restée ouverte se compte, et ne prend pas la ligne suivante.
  assert.deepEqual(lex("const o = 'ouverte\nimport { e } from './suite.ts'"), { code: "const o = '#0'\nimport { e } from '#1'", strings: ['ouverte', './suite.ts'], unclosed: 1 })
  assert.deepEqual(importsIn(sample).sort(), ['../types', './apres-fleche.ts', './apres-negation.ts', './avec-options.ts', './dynamique-espaces.ts', './dynamique.ts', './fin.ts', './gabarit-expression.ts', './guillemets.ts', './reexport.ts', './sans-nom.ts', './second-expression.ts', './specifiant-gabarit.ts', './apres-inferieur.ts'].sort())
})

test('la lecture des imports ne déraille dans aucun module .ts de hooks/ : aucun littéral laissé ouvert, aucun import d’une seule ligne perdu', () => {
  // Une expression régulière mal lue ouvrirait une chaîne ou un gabarit qui n'existe pas, et pourrait avaler
  // ou inventer un import plus bas : elle se voit à un littéral resté ouvert. Les .tsx (JSX) ne sont pas lus
  // par cette lecture : aucun des modules suivis plus bas n'en importe. Le témoin, une recherche ligne par
  // ligne, ne voit que les imports écrits sur une seule ligne en tête de ligne.
  for (const file of readdirSync(new URL('../hooks/', import.meta.url)).filter(f => f.endsWith('.ts'))) {
    const source = readFileSync(new URL(`../hooks/${file}`, import.meta.url), 'utf8')
    assert.equal(lex(source).unclosed, 0, `${file} : un littéral laissé ouvert, la lecture a déraillé`)
    // Le témoin ne lit que l'en-tête, avant la première déclaration : ni gabarit ni chaîne n'y commence encore.
    const start = source.search(/^(?:export\s+)?(?:const|let|function|async|class|type|interface|default)\b/m)
    const head = start === -1 ? source : source.slice(0, start)
    const lines = new Set([...head.matchAll(/^(?:(?:import|export)\b[^;\n'"]*?\bfrom\s+|import\s+)['"]([^'"\n]+)['"]/gm)].map(m => m[1]))
    assert.deepEqual([...new Set(importsIn(source))].filter(spec => lines.has(spec)).sort(), [...lines].sort(), file)
  }
})

// Les modules de hooks/ qu'un fichier atteint par ses imports, de proche en proche.
const reachable = file => {
  const seen = new Set()
  const next = [file]
  while (next.length > 0) {
    for (const spec of importsOf(next.pop())) {
      const local = spec.startsWith('./') ? spec.slice(2) : null
      if (local !== null && !seen.has(local)) {
        seen.add(local)
        next.push(local)
      }
    }
  }
  return seen
}

// Ce que chaque module n'a pas le droit d'atteindre.
const FORBIDDEN = {
  'basics.ts': ['model.ts', 'relay.ts', 'link.ts'],
  'relay.ts': ['model.ts', 'link.ts'],
  'link.ts': ['model.ts'],
}

for (const [file, forbidden] of Object.entries(FORBIDDEN)) {
  test(`${file} n’atteint pas ${forbidden.join(', ')}, même par un détour, ni lui-même`, () => {
    // Le test lit bien les imports du fichier, et les suit au-delà du premier niveau (basics et relay
    // n'atteignent linked.ts que par closing.ts ; link l'importe lui-même), avant d'en vérifier l'absence.
    assert.ok(importsOf(file).includes('../types'), `imports de ${file} non lus : ${JSON.stringify(importsOf(file))}`)
    const found = reachable(file)
    assert.ok(found.has('linked.ts'), `imports de ${file} non suivis au-delà du premier niveau : ${[...found].join(', ')}`)
    assert.deepEqual([...found].filter(f => forbidden.includes(f) || f === file), [])
  })
}
