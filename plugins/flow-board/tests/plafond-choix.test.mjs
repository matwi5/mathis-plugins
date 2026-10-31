// Les choix « décidé sans toi » ne se coupent que par une seule règle (`keepChoices`, à la place que
// donne `choiceRoom`) : six coupes écrites chacune à la main avaient laissé, au plafond de 30, un
// parcours en auto perdre ses choix sans rien dire. Un test Node (node --test, lancé par scripts/check.sh) :
// il lit le source.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const MODEL = readFileSync(new URL('../hooks/model.ts', import.meta.url), 'utf8')

test('aucune coupe des choix écrite à la main : ni « .slice(-LIMITS.decided) » ni « .slice(-RELAY_CHOICES_MAX) »', () => {
  assert.equal(MODEL.match(/\.slice\(\s*-\s*LIMITS\.decided\s*\)/g), null)
  assert.equal(MODEL.match(/\.slice\(\s*-\s*RELAY_CHOICES_MAX\s*\)/g), null)
  assert.equal(MODEL.match(/\.slice\(\s*-\s*(AUTO_CHOICES_MAX|LIMITS\.autoDecided)\s*\)/g), null)
})

test('chaque liste de choix qui s’écrit passe par keepChoices', () => {
  // Marquer les choix relus (`.map` sur la liste entière) n'en retire aucun : hors du compte.
  const writes = [...MODEL.matchAll(/(?:run|entry)\.(?:decided|withdrawn) = (?!\(?run\.decided(?: \?\? \[\]\))?\.map\()(.+)/g)].map(m => m[1])
  assert.ok(writes.length >= 6, `écritures trouvées : ${writes.length}`)
  for (const write of writes) assert.match(write, /^keepChoices\(/, write)
})
