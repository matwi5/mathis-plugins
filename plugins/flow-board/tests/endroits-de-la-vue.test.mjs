// Les textes hors de la vue Coordination qui disent à la personne ou au Claude du COO où regarder nomment les endroits
// de la vue d'aujourd'hui : la page « Vue d'ensemble », son bloc « Projet », ses cartes « Au départ ». Un test Node
// (node --test, lancé par scripts/check.sh) : il lit les sources.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const COO = read('hooks/coo.ts')
const REGISTER = read('hooks/register.tsx')
const SKILL = read('skills/coo/SKILL.md')

test('les deux lignes du relevé nomment « Vue d’ensemble » et « Au départ »', () => {
  assert.ok(COO.includes("reduced: the user sees them in « Vue d'ensemble » of the Coordination view and answers in each mission;"))
  assert.ok(COO.includes("the user sees them in the Coordination view under « Au départ », page « Vue d'ensemble », and launches each with a click there;"))
})

test('les messages du mod sur une carte de rétro ou « Pistes de rétro » nomment « Au départ », page « Vue d’ensemble »', () => {
  for (const phrase of [
    "est proposée sous « Au départ », page « Vue d'ensemble ».`",
    "reste sous « Au départ », page « Vue d'ensemble » ; si aucune piste ne la porte, retire-la.`",
    "reste sous « Au départ », page « Vue d'ensemble » (${cardWriteWhy(gone.state)})",
    "sous « Au départ », page « Vue d'ensemble » : lance-la d’un clic.",
  ]) assert.ok(REGISTER.includes(phrase), phrase)
})

test('la consigne du COO nomme le bloc « Projet » ou la page « Vue d’ensemble » là où la chose se montre', () => {
  for (const phrase of [
    "sur la ligne « « M » livrée » du bloc « Projet », page « Vue d'ensemble »",
    "Le rapport du compte rendu d'une mission paraît dans le bloc « Projet », page « Vue d'ensemble »",
    "nouvelle carte « Pistes de rétro » posée sous « Au départ », page « Vue d'ensemble »",
  ]) assert.ok(SKILL.includes(phrase), phrase)
  for (const gone of ["Ce qui t'attend", 'dans « Lancements »', 'page « Missions »', 'page « À faire »']) assert.ok(!SKILL.includes(gone), gone)
})
