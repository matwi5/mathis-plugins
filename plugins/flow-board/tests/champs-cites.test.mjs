// Chaque champ de l'outil `flow` que cite une consigne (un fichier de `reference/` ou un texte de
// `hooks/catalog.ts`, dans un exemple d'appel : `{"<champ>"` ou `"<champ>":`) existe dans son schéma.
// Le worker du groupe B (rétro « Économie d'usage ») avait suivi une procédure qui citait `reportPath`,
// que le mod installé ne connaissait pas : l'outil l'avait ignoré sans rien dire.
//
// Un test Node (node --test, lancé par scripts/check.sh). Les noms du schéma viennent de
// `outil-flow-forme.ts`, la forme figée que `outil-flow-textes.test.ts` compare au schéma
// d'aujourd'hui : register.tsx ne se charge pas dans Node (JSX, moteur).

import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const ROOT = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, ROOT), 'utf8')

/** Tous les noms de propriétés du schéma de l'outil, à toutes les profondeurs (ceux de `review`, `security`… compris). */
const schemaNames = () => {
  const source = read('tests/outil-flow-forme.ts')
  const shape = JSON.parse(source.slice(source.indexOf('= {') + 2))
  const names = new Set()
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node === null || typeof node !== 'object') return
    if (node.properties) for (const name of Object.keys(node.properties)) names.add(name)
    Object.values(node).forEach(walk)
  }
  walk(shape)
  return names
}

/** Les champs cités dans un texte, `{"<champ>"` ou `"<champ>":`, guillemets échappés compris (un texte d'un `.ts`). */
const citedFields = text => [...text.matchAll(/\{\s*\\?"([A-Za-z_][\w-]*)\\?"|\\?"([A-Za-z_][\w-]*)\\?"\s*:/g)].map(m => ({ name: m[1] ?? m[2], at: m.index }))

/** Les citations d'un texte absentes du schéma, avec leur ligne. */
const unknownCitations = (text, names) =>
  citedFields(text)
    .filter(c => !names.has(c.name))
    .map(c => `${c.name} (ligne ${text.slice(0, c.at).split('\n').length})`)

const SURFACES = [
  ...readdirSync(new URL('reference/', ROOT))
    .filter(f => f.endsWith('.md'))
    .map(f => `reference/${f}`),
  'hooks/catalog.ts',
]

test('le schéma se relit : les champs de l’outil, nouveaux compris', () => {
  const names = schemaNames()
  for (const name of ['reportPath', 'delegate', 'review', 'security', 'fixed', 'answered']) assert.ok(names.has(name), `${name} absent de la forme du schéma`)
})

test('un champ cité absent du schéma est signalé', () => {
  const names = schemaNames()
  assert.deepEqual(unknownCitations('Envoyer `{"champInconnu": 1}` à l’outil, puis {"report": "x"}.', names), ['champInconnu (ligne 1)'])
  assert.deepEqual(unknownCitations('ligne 1\n`"autreInconnu": 2`', names), ['autreInconnu (ligne 2)'])
  assert.deepEqual(unknownCitations('{\\"echappe\\": 1}', names), ['echappe (ligne 1)'])
})

test('chaque champ que citent les références et les consignes de catalog.ts existe dans le schéma de l’outil', () => {
  const names = schemaNames()
  let cited = 0
  const unknown = []
  for (const path of SURFACES) {
    const text = read(path)
    cited += citedFields(text).length
    for (const u of unknownCitations(text, names)) unknown.push(`${path} : ${u}`)
  }
  // Le motif trouve bien des citations : un motif cassé passerait sans rien lire.
  assert.ok(cited > 20, `seulement ${cited} citations trouvées`)
  assert.deepEqual(unknown, [], `champs cités absents du schéma de l'outil flow :\n${unknown.join('\n')}`)
})
