// Le paragraphe « Ajouter un skill » du README nomme les drapeaux de classement des fiches de `SKILLS` : il les
// nomme tous, et aucun autre, comme `FLAG_KEYS` de catalog.ts (la liste que tsc tient alignée sur `SkillFlags`).
// Un test Node (node --test, lancé par scripts/check.sh) : `claude plugin test` n'ouvre aucun fichier.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

/** Les clés de `FLAG_KEYS`, dans l'ordre du source. */
const flagKeys = src => {
  const start = src.indexOf('const FLAG_KEYS: Record<keyof SkillFlags, true> = {')
  assert.ok(start >= 0, 'FLAG_KEYS absent de catalog.ts')
  const block = src.slice(start, src.indexOf('\n}', start))
  return [...block.matchAll(/^ {2}(\w+): true,$/gm)].map(m => m[1])
}

/** Les drapeaux que nomme le paragraphe « Ajouter un skill » : chaque `nom` suivi de sa glose entre parenthèses. */
const readmeFlags = readme => {
  const line = readme.split('\n').find(l => l.startsWith('**Ajouter un skill**'))
  assert.ok(line, 'paragraphe « Ajouter un skill » absent du README')
  const list = line.slice(line.indexOf('jamais absents : '), line.indexOf('. Les endroits du mod'))
  return [...list.matchAll(/`(\w+)` \(/g)].map(m => m[1])
}

test('le README nomme chaque drapeau de classement des skills, et aucun autre', () => {
  const keys = flagKeys(read('hooks/catalog.ts'))
  assert.ok(keys.length >= 9, `FLAG_KEYS trop court : ${keys.length}`)
  assert.deepEqual(readmeFlags(read('README.md')), keys)
})
