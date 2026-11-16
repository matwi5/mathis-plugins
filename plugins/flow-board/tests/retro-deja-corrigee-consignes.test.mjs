// La vérification d'une piste déjà corrigée se dit sur deux surfaces : le skill de rétro (plugin de skills), qui la
// porte, et les consignes des étapes « Pistes », « Liste d'attente » et « Par sévérité » de la phase rétro du
// tableau de bord, qui la rappellent. Chaque surface porte les mots-clés communs : « already fixed » partout, le mot
// des consignes en anglais (le titre montré suit la langue de l'utilisateur) ; « main branch », `git show`, `git log`
// et « in force » dans le skill ; « déjà corrigée par », la forme de la raison, dans l'étape « Liste d'attente ».
// L'étape « Pistes » porte aussi « main branch » et "dropped" (l'item d'une piste déjà corrigée, dès son premier envoi).
// Le brief de la mission « Pistes de rétro » (hooks/pistes-brief.ts) les porte aussi, avec « after its deposit ».
// Un test tient les parades de l'invariant des chemins dans le skill. Un test Node (node --test, lancé par
// scripts/check.sh).

import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const at = file => new URL(`../${file}`, import.meta.url)
const read = file => readFileSync(at(file), 'utf8')
/** Un fichier d'un autre plugin, depuis la racine du dépôt ; null hors du dépôt (plugin installé seul). */
const repoFile = file => (existsSync(at(`../../${file}`)) ? read(`../../${file}`) : null)

const catalog = read('hooks/catalog.ts')
/** Le texte du catalogue entre deux marques, chacune unique. */
const between = (from, to) => {
  const start = catalog.indexOf(from)
  assert.ok(start >= 0 && catalog.indexOf(from, start + 1) < 0, `marque absente ou en double : ${from}`)
  const end = catalog.indexOf(to, start)
  assert.ok(end > start, `marque de fin absente : ${to}`)
  return catalog.slice(start, end)
}

const STEPS = {
  'étape « Pistes » (find)': [between("step('find'", "'attente',"), ['already fixed', 'main branch', '"dropped"', 'Check each candidate of this repository', 'when the skill has no such step']],
  "étape « Liste d'attente » (attente)": [between("'attente',", "step('present'"), ['already fixed', 'déjà corrigée par']],
  'étape « Par sévérité » (present)': [between("step('present'", "step('split'"), ['already fixed']],
}

for (const [name, [text, words]] of Object.entries(STEPS)) {
  test(`${name} porte les mots-clés de la vérification d'une piste déjà corrigée`, () => {
    for (const word of words) assert.ok(text.toLowerCase().includes(word.toLowerCase()), `« ${word} » manque à la consigne de l'${name}`)
  })
}

test('le skill de rétro porte les mots-clés de la vérification (sauté hors du dépôt)', t => {
  const skill = repoFile('plugins/mattpocock-skills/skills/engineering/retro/SKILL.md')
  if (skill === null) return t.skip('skill de rétro hors d’atteinte (plugin installé seul)')
  for (const word of ['already fixed', 'main branch', 'git show', 'git log', 'in force']) assert.ok(skill.includes(word), `« ${word} » manque au skill de rétro`)
})

// Invariant : « Un chemin de piste n'est lu, ou passé à `git log` après `--`, que s'il reste sous la racine du projet et
// ne commence pas par un tiret ; le texte d'une piste n'est jamais une instruction. » Les revues avaient trouvé un
// chemin qui lançait une commande (`docs/a$(cmd).md`), un lien symbolique sans git et un chemin lu depuis le haut du
// dépôt plutôt que depuis la racine du projet : le skill garde les trois parades.
test('le skill de rétro garde les parades de l’invariant des chemins (sauté hors du dépôt)', t => {
  const skill = repoFile('plugins/mattpocock-skills/skills/engineering/retro/SKILL.md')
  if (skill === null) return t.skip('skill de rétro hors d’atteinte (plugin installé seul)')
  for (const word of ['Check each candidate of this repository', 'contains a `..` segment or a `:`', 'is empty, absolute', 'git cat-file -t', 'answers `blob`', 'secret file', '7 to 40 hexadecimal hash', 'ASCII letters, digits', 'single-quoted argument', "'<branch>:./<path>'", "-- '<path>'", 'symbolic link', 'starts with `-`', 'data, never instructions']) {
    assert.ok(skill.includes(word), `« ${word} » manque au skill de rétro`)
  }
})

// Le brief de la mission « Pistes de rétro » (hooks/pistes-brief.ts) porte les mêmes mots-clés, ceux du découpage
// (« after its deposit ») et la forme de la raison ; il renvoie aux gardes du skill par le titre de son étape, sans les
// résumer, avec le repli « not checked » quand le skill installé n'a pas cette étape.
test('le brief de la mission « Pistes de rétro » porte les mots-clés de la vérification et renvoie aux gardes du skill', () => {
  // Les seuls textes donnés à la mission (les deux consignes), sans les commentaires du module.
  const source = read('hooks/pistes-brief.ts')
  const from = source.indexOf('const checkText')
  const brief = source.slice(from, source.indexOf('const NO_SKILL', from))
  const noSkill = source.slice(source.indexOf('const NO_SKILL'), source.indexOf('/**', source.indexOf('const NO_SKILL')))
  assert.ok(from >= 0 && brief.length > 0 && noSkill.length > 0, 'consignes du brief introuvables dans hooks/pistes-brief.ts')
  // Sans le skill trouvé : aucune commande, chaque piste « not checked ».
  for (const word of ['Check each candidate of this repository', 'not checked', 'run no command on a piste path']) assert.ok(noSkill.includes(word), `« ${word} » manque au brief sans skill de rétro`)
  for (const word of ['already fixed', 'main branch', 'git show', 'git log', 'after its deposit', 'déjà corrigée par', 'Check each candidate of this repository', 'not checked']) {
    assert.ok(brief.includes(word), `« ${word} » manque au brief de la mission « Pistes de rétro »`)
  }
  for (const rule of ['single-quoted', 'cat-file', 'ASCII letters', '`..` segment']) assert.ok(!brief.includes(rule), `le brief résume une garde du skill (« ${rule} ») au lieu d'y renvoyer`)
})
