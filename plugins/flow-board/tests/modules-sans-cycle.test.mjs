// Les modules sortis du modèle ne l'importent jamais, ni directement ni par un détour (un module qu'ils
// importent et qui importerait le modèle), et aucun ne revient sur lui-même : `basics` n'atteint ni le
// modèle, ni le relais, ni le lien ; `relay` n'atteint ni le modèle ni le lien ; `link` n'atteint pas le
// modèle ; le modèle les importe. Un import en retour referait un cycle, qui marche à l'exécution mais
// se casse au premier `const` lu avant sa définition. Un test Node (node --test, lancé par
// scripts/check.sh) : il lit les sources.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const importsOf = file =>
  [...readFileSync(new URL(`../hooks/${file}`, import.meta.url), 'utf8').matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gm)].map(m => m[1])

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
