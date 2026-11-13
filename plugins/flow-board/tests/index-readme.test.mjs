// L'index « concept → fichier et fonction » du README cite des fonctions qui existent : une session
// avait fait 55 greps dans model.ts, register.tsx et view.tsx pour trouver où vivaient les concepts.
// Un test Node (node --test, lancé par scripts/check.sh) : il lit le README et les sources.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

/**
 * Le tableau de l'index : le bloc qui suit le paragraphe d'introduction, sous le titre
 * « ## Index : concept → fichier et fonction » (un titre, pour que `show.py` et une recherche de « ## Index » le trouvent).
 */
const indexTable = readme => {
  const start = readme.indexOf('\n## Index : concept → fichier et fonction\n')
  assert.ok(start >= 0, 'titre de l’index absent du README')
  return readme.slice(start + 1).split('\n\n')[2]
}

test('chaque fonction de l’index du README existe dans le fichier qu’il nomme', () => {
  const readme = read('README.md')
  const table = indexTable(readme)
  assert.ok(table.startsWith('| Concept |'), 'le tableau suit le paragraphe d’introduction')
  const refs = [...table.matchAll(/`([\w.-]+\.tsx?)` : `(\w+)`/g)].map(m => ({ file: m[1], name: m[2] }))
  assert.ok(refs.length >= 20, `index trop court : ${refs.length} renvois`)
  const missing = refs.filter(r => !new RegExp(`(?:const|function|let)\\s+${r.name}\\b`).test(read(`hooks/${r.file}`)))
  assert.deepEqual(missing, [])
})

// Les concepts que les workers de la rétro « Pistes de rétro en groupes » ont cherchés dans model.ts
// sans ouvrir l'index (110 à 220k de contexte chacun) : chacun a sa ligne, avec une fonction qui le porte.
test('l’index a une ligne pour chaque concept cherché par les workers', () => {
  const readme = read('README.md')
  const rows = indexTable(readme).split('\n')
  const CONCEPTS = [
    ['Mise à niveau à la lecture', '`model.ts` : `upgradeRun`'],
    ['Revue suffisante et sécurité tranchée', '`model.ts` : `isTicketReviewEnough`'],
    ['Noms de worktree', '`closing.ts` : `worktreeName`'],
    ['Rétro', '`model.ts` : `isRetroRun`'],
    ['Lot et phases facultatives', '`model.ts` : `isPhaseOptional`'],
    ['Fusion des pistes', '`model.ts` : `formItemIds`'],
    ['Relais par worker', '`relay.ts` : `applyRelayEntry`'],
  ]
  const absent = CONCEPTS.filter(([concept, ref]) => !rows.some(row => row.startsWith(`| ${concept}`) && row.includes(ref))).map(([c]) => c)
  assert.deepEqual(absent, [])
})
