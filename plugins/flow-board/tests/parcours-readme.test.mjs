// Les lignes « Recherche », « Questionnaire » et « Réflexion » de la table « Mission par skill de départ » du
// README se dérivent du parcours de leur skill dans le catalogue (`SKILLS[…].flow`) : le libellé de chaque phase
// (`label` de sa fiche), « ¹ » pour une phase facultative, et le nom de la mission (`flowLabel`). Un parcours
// changé dans le catalogue sans le README fait échouer ce test.
//
// Un test Node (node --test, lancé par scripts/check.sh) : il lit catalog.ts en retirant ses types (Node 22.18 ou
// plus récent ; plus ancien, le test le dit) ; `claude plugin test` n'ouvre aucun fichier.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const [major, minor] = process.versions.node.split('.').map(Number)
const isOldNode = major < 22 || (major === 22 && minor < 18)
const catalog = isOldNode ? null : await import('../hooks/catalog.ts')
const SKIP = catalog ? false : `Node ${process.versions.node} ne lit pas catalog.ts : il faut Node 22.18 ou plus récent`

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

/** La ligne de la table dont la première cellule est exactement `/<skill>`, découpée en cellules. */
const rowOf = skill => {
  const line = readme.split('\n').find(l => l.startsWith(`| \`/${skill}\` |`))
  assert.ok(line, `ligne « /${skill} » absente de la table « Mission par skill de départ »`)
  return line.split('|').slice(1, -1).map(c => c.trim())
}

/** Le parcours dérivé du catalogue : « Libellé → Libellé¹ → … ». */
const routeOf = skill => catalog.SKILLS[skill].flow.map(p => `${catalog.SKILLS[p.skill].label}${p.isOptional ? '¹' : ''}`).join(' → ')

for (const skill of ['research', 'to-questionnaire', 'grill-me']) {
  test(`la ligne « /${skill} » du README dit le parcours du catalogue`, { skip: SKIP }, () => {
    const [, mission, phases] = rowOf(skill)
    assert.equal(mission, catalog.SKILLS[skill].flowLabel)
    // La note de renvoi en fin de cellule (« ⁶ ») n'est pas une phase.
    assert.equal(phases.replace(/\s+[⁰²³⁴⁵⁶⁷⁸⁹]+$/u, ''), routeOf(skill))
  })
}
