// L'index « concept → fichier et fonction » du README cite des fonctions qui existent : une session
// avait fait 55 greps dans model.ts, register.tsx et view.tsx pour trouver où vivaient les concepts.
// Un test Node (node --test, lancé par scripts/check.sh) : il lit le README et les sources.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('chaque fonction de l’index du README existe dans le fichier qu’il nomme', () => {
  const readme = read('README.md')
  const start = readme.indexOf("**Index : concept → fichier et fonction.**")
  assert.ok(start >= 0, "index absent du README")
  const table = readme.slice(start).split('\n\n')[1]
  const refs = [...table.matchAll(/`([\w.-]+\.tsx?)` : `(\w+)`/g)].map(m => ({ file: m[1], name: m[2] }))
  assert.ok(refs.length >= 20, `index trop court : ${refs.length} renvois`)
  const missing = refs.filter(r => !new RegExp(`(?:const|function|let)\\s+${r.name}\\b`).test(read(`hooks/${r.file}`)))
  assert.deepEqual(missing, [])
})
