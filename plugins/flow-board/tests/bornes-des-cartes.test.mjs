// Les bornes d'une carte de lancement que le README de flow-board écrit en chiffres (« Lancer une mission ») se
// dérivent des constantes de `hooks/launch.ts` (CODING_STANDARDS.md, règle 13 : un texte de README qui décrit une
// règle se dérive de la règle, la même constante ou un test qui les compare) : la borne des entrées à la pose, celle
// des ids montrés sous la carte, celle des ids d'un envoi de l'ordre. Un test Node (node --test, lancé par
// scripts/check.sh) : il lit le source et le README.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const LAUNCH = readFileSync(new URL('../hooks/launch.ts', import.meta.url), 'utf8')
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

/** La valeur d'une constante numérique de premier niveau de launch.ts, exportée ou non. */
const constant = name => {
  const m = LAUNCH.match(new RegExp(`^(?:export )?const ${name} = (\\d+)$`, 'm'))
  assert.ok(m, `constante ${name} introuvable dans hooks/launch.ts`)
  return Number(m[1])
}

test('le README dit les bornes d’une carte avec les valeurs des constantes de launch.ts', () => {
  assert.ok(README.includes(`dans l'ordre donné, ${constant('CARD_ENTRIES_MAX')} au plus à la pose`), 'borne des entrées à la pose (CARD_ENTRIES_MAX)')
  assert.ok(README.includes(`et ses ${constant('CARD_ENTRIES_SHOWN')} premiers ids`), 'ids montrés sous la carte (CARD_ENTRIES_SHOWN)')
  assert.ok(README.includes(`une liste vide ou de plus de ${constant('CARDS_ORDER_MAX')} ids`), 'ids d’un envoi de l’ordre (CARDS_ORDER_MAX)')
  assert.ok(README.includes(`aplati sur une ligne et coupé à ${constant('CARD_GOAL_MAX')} signes avec « … »`), 'objectif d’une carte (CARD_GOAL_MAX)')
})
