// Les gabarits des tests de flow-board n'écrivent pas une mission en pause qui garde un owner : ce cas
// n'existe pas en vrai (`shelve` et `setAsideActive` de `hooks/model.ts` effacent `owner` à la mise en
// pause), et un test qui en fabriquait une protégeait la reprise d'une mission au nom d'une autre
// discussion (`tests/suites-onglet-agents.test.ts`). Une mission close, elle, peut garder son owner
// (`finishActive` et la clôture de `reportHere` ne l'effacent pas, et `retroSessions` de `hooks/retro-coo.ts`
// le lit) : `status: 'done'` n'est pas contrôlé.
//
// Un test Node (node --test, lancé par scripts/check.sh) : il relit les sources des tests (`tests/*.ts`,
// `tests/*.tsx`) ligne par ligne, et échoue, avec le fichier et la ligne, sur un littéral d'objet qui porte
// à la fois `status: 'paused'` et un `owner:` autre que `undefined`, les deux au même niveau
// d'accolades de la ligne (un `status` imbriqué, celui d'une phase dans `phases: [...]`, ne compte pas).
// Il se contente d'une ligne : un littéral écrit sur plusieurs lignes lui échappe.

import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const PAUSED = /\bstatus:\s*['"]paused['"]/
const OWNED = /\bowner:\s*(?!undefined\b)[^\s,}]/

/**
 * Les textes de chaque niveau d'accolades d'une ligne, sans ce qui est imbriqué plus bas : le texte hors
 * de toute accolade de la ligne compte comme un niveau à lui (une ligne au milieu d'un littéral écrit sur
 * plusieurs lignes). Une chaîne ne change jamais de niveau ; elle garde son contenu seulement quand c'est
 * un mot (`'paused'`), et se vide sinon (une chaîne qui cite `status: 'paused', owner: 'x'` ne compte pas).
 */
export const levelsOf = line => {
  const done = []
  const stack = ['']
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && line[i + 1] === '/') break
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      // La valeur d'un champ (`status: 'paused'`) reste lisible ; une chaîne qui n'est pas un mot se vide.
      const end = line.indexOf(ch, i + 1)
      const body = end < 0 ? '' : line.slice(i + 1, end)
      stack[stack.length - 1] += /^\w*$/.test(body) ? `${ch}${body}${ch}` : `${ch}${ch}`
      continue
    }
    if (ch === '{') {
      stack.push('')
    } else if (ch === '}') {
      done.push(stack.pop())
      if (stack.length === 0) stack.push('')
    } else stack[stack.length - 1] += ch
  }
  return [...done, ...stack]
}

/** Les lignes d'une source dont un niveau porte une mission en pause qui garde un owner : `fichier:ligne`. */
export const badTemplates = (source, file) =>
  source.split('\n').flatMap((line, i) => (levelsOf(line).some(text => PAUSED.test(text) && OWNED.test(text)) ? [`${file}:${i + 1}`] : []))

test('le contrôle reconnaît une mission en pause qui garde un owner, et rien d’autre', () => {
  const cases = [
    [`const other = { ...base, id: 'b', owner: 'autre', status: 'paused' }`, true],
    [`const r = { status: 'paused', title: 'x', owner: SESSION }`, true],
    // Une mission close peut garder son owner (`finishActive`) : elle ne compte pas.
    [`const r = { status: 'done', owner: 'x' }`, false],
    [`  status: 'paused', owner: 'x',`, true],
    [`const r = { status: 'paused', owner: undefined }`, false],
    [`const r = { status: 'paused', title: 'x' }`, false],
    [`const r = { status: 'active', owner: 'x' }`, false],
    // Le statut d'une phase imbriquée ne compte pas.
    [`const r = { owner: 'x', status: 'active', phases: [{ skill: 'tdd', status: 'done' }] }`, false],
    // Deux littéraux voisins sur une ligne : chacun se juge seul.
    [`const runs = [{ status: 'paused' }, { status: 'active', owner: 'x' }]`, false],
    [`const runs = [{ status: 'active' }, { status: 'paused', owner: 'x' }]`, true],
    // Une accolade dans une chaîne ne change pas de niveau.
    [`const r = { title: '{ ', status: 'paused', owner: 'x' }`, true],
    [`const r = { title: '} ', status: 'paused' }, x = { owner: 'y' }`, false],
    // Une chaîne qui cite un tel littéral n'en est pas un.
    ["expect(text).toContain(\"status: 'paused', owner: 'x'\")", false],
    ["const src = `{ status: 'paused', owner: 'x' }`", false],
  ]
  const wrong = cases.filter(([line, bad]) => (badTemplates(line, 'f.ts').length > 0) !== bad).map(([line]) => line)
  assert.deepEqual(wrong, [])
  assert.deepEqual(badTemplates(`a\nconst r = { status: 'paused', owner: 'x' }`, 'f.ts'), ['f.ts:2'])
})

test('aucun gabarit des tests de flow-board n’écrit une mission en pause qui garde un owner', () => {
  const dir = new URL('./', import.meta.url)
  const files = readdirSync(dir).filter(f => /\.tsx?$/.test(f))
  assert.ok(files.length > 50, `trop peu de tests lus : ${files.length}`)
  const found = files.flatMap(f => badTemplates(readFileSync(new URL(f, dir), 'utf8'), `tests/${f}`))
  assert.deepEqual(found, [])
})
