// Les consignes du COO recopient le format de la feuille de route que lit le mod (`hooks/roadmap.ts`) :
// l'exemple à l'identique, et chaque statut permis nommé. Une copie qui dérive ferait écrire au Claude du
// COO une feuille de route que le mod lit hors format. Un test Node (node --test, lancé par
// scripts/check.sh) : il lit les sources.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const SOURCE = read('hooks/roadmap.ts')
const SKILL = read('skills/coo/SKILL.md')

test('l’exemple du format est recopié tel quel dans les consignes du COO', () => {
  const example = /export const ROADMAP_EXAMPLE = `([^`]*)`/.exec(SOURCE)?.[1]
  assert.ok(example, 'ROADMAP_EXAMPLE introuvable dans hooks/roadmap.ts')
  const copied = /```markdown\n([\s\S]*?)```/.exec(SKILL)?.[1]
  assert.equal(copied, example)
})

test('chaque statut permis du format est nommé dans les consignes du COO', () => {
  const block = /export const ROADMAP_STATUSES[^{]*\{([\s\S]*?)\n\}/.exec(SOURCE)?.[1] ?? ''
  const statuses = [...block.matchAll(/'([^']+)'(?=[,\]])/g)].map(m => m[1].trim())
  assert.ok(statuses.length >= 10, `statuts relus : ${statuses.length}`)
  const missing = statuses.filter(s => !SKILL.includes(`« ${s}`))
  assert.deepEqual(missing, [])
})
