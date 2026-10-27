// Contrôles mécaniques du dessin (r4 de la rétro de l'onglet Agents) : les pièges du desktop que
// l'en-tête de view.tsx décrit, relevés jusqu'ici à la main par les relecteurs. Les espaces
// ordinaires d'un texte y sont fondus, `gap` y est ignoré, et une prop passée à `undefined`
// rend l'arbre invalide.
//
// Un test Node (node --test, lancé par scripts/check.sh) : `claude plugin test` n'ouvre aucun
// fichier, et ces règles se lisent dans le source.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const FILES = ['hooks/view.tsx', 'hooks/cells.ts', 'hooks/svg.ts']
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

/** Le source sans ses commentaires, les chaînes gardées (un `//` dans une URL reste du texte). */
const withoutComments = src => {
  let out = ''
  let i = 0
  let quote = null
  while (i < src.length) {
    const c = src[i]
    if (quote) {
      out += c
      if (c === '\\') {
        out += src[i + 1] ?? ''
        i += 2
        continue
      }
      if (c === quote) quote = null
      i += 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      out += c
      i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const cut = src.slice(i, end < 0 ? src.length : end + 2)
      out += cut.replace(/[^\n]/g, ' ')
      i = end < 0 ? src.length : end + 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

/** Un gabarit dont chaque `${…}` (accolades imbriquées comprises) devient un seul signe : seul son texte compte. */
const textOf = literal => {
  let out = ''
  for (let i = 0; i < literal.length; i++) {
    if (literal[i] === '$' && literal[i + 1] === '{') {
      let depth = 0
      let j = i + 1
      for (; j < literal.length; j++) {
        if (literal[j] === '{') depth += 1
        else if (literal[j] === '}' && --depth === 0) break
      }
      out += 'x'
      i = j
      continue
    }
    out += literal[i]
  }
  return out
}

/** Les littéraux de chaîne d'une ligne (simples, doubles, gabarits sur une ligne), avec leur numéro de ligne. */
const literals = src => {
  const found = []
  src.split('\n').forEach((text, n) => {
    for (const m of text.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/g)) found.push({ line: n + 1, text: m[0] })
  })
  return found
}

for (const file of FILES) {
  const src = withoutComments(read(file))

  test(`${file} : pas deux espaces ordinaires de suite dans un texte ou un gabarit affiché`, () => {
    const bad = literals(src).filter(l => / {2}/.test(textOf(l.text)))
    assert.deepEqual(bad.map(l => `${file}:${l.line} ${l.text}`), [])
  })

  test(`${file} : pas de gap, que le desktop ignore`, () => {
    const bad = src.split('\n').flatMap((text, n) => (/\bgap=\{|[{,]\s*gap\s*:/.test(text) ? [`${file}:${n + 1} ${text.trim()}`] : []))
    assert.deepEqual(bad, [])
  })

  test(`${file} : aucune prop passée à undefined`, () => {
    const bad = src.split('\n').flatMap((text, n) => (/\w=\{\s*undefined\s*\}|\w=\{[^{}]*[?:]\s*undefined\s*\}/.test(text) ? [`${file}:${n + 1} ${text.trim()}`] : []))
    assert.deepEqual(bad, [])
  })
}
