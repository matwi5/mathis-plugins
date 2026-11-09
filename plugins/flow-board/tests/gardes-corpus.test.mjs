// Chaque garde de forme exporté par closing.ts et model.ts passe le corpus hostile commun
// (CODING_STANDARDS.md, « Un garde de forme passe le corpus hostile commun ») : un garde absent de
// corpus-hostile.test.ts n'avait été vu qu'à la revue d'un ticket.
//
// Un test Node (node --test, lancé par scripts/check.sh) : il lit les sources par l'aide commune.
// Il se trompe du côté du faux rouge (CODING_STANDARDS.md) : tout export `is…` ou `neutral…` de ces
// modules, quelle que soit sa forme, est un garde de forme, sauf les prédicats sur la mission admis
// un par un ci-dessous. Un garde de forme a sa clé dans la table `FORM_GUARDS` ou `NEUTRALIZERS` de
// corpus-hostile.test.ts, qui fait passer à chaque clé le corpus entier et les valeurs non texte.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { hookSources } from './sources.mjs'

/** Les modules dont les gardes exportés doivent passer le corpus. */
const MODULES = ['hooks/closing.ts', 'hooks/model.ts']

/** Pourquoi un prédicat sur la mission n'est pas un garde de forme. */
const ON_MISSION = 'prédicat sur la mission, un groupe, un ticket ou le tableau de bord : ne décide d’aucune valeur citée dans une commande ou un texte'

/** Les exports `is…` qui ne sont pas des gardes de forme, chacun avec sa raison. */
const NOT_FORM_GUARDS = {
  isBoard: 'garde de structure du fichier des missions entier : ne décide d’aucune valeur citée dans une commande ou un texte',
  isOwnBranch: 'compare une branche relue à celle que la fermeture attend (isSafeBranch, éprouvé, juge sa forme)',
  ...Object.fromEntries(
    [
      'isCooDiscussion', 'isRunComplete', 'isPhaseOptional', 'isRetroRun', 'isNoLogicGroup', 'isTicketReviewEnough', 'isGroupReviewed',
      'isSensitiveGroup', 'isLotReviewEnough', 'isLotToReview', 'isLotAdviceCurrent', 'isLotAdvicePrevious', 'isLotSecuritySettled',
      'isLotSecurityDue', 'isClosedTurnedOff', 'isBugPass', 'isWaitingTicket', 'isDelegable', 'isCloseCandidate', 'isStoredPause', 'isAutoOn',
      'isAutoLitBy', 'isAutoPauseStored', 'isGroupLotStuck', 'isBlocked', 'isPickable', 'isLotUnderway', 'isKeptForReport',
      'isDeliveredRun', 'isAwaitingArchive', 'isCloseDone', 'isDeliveryOver', 'isReportShipped',
    ].map(name => [name, ON_MISSION]),
  ),
}

/** Tout export `is…` ou `neutral…` d'un texte de module, quelle que soit sa forme. */
const exportedGuards = text => [
  ...[...text.matchAll(/^export\s+(?:const|let|var|function\*?|async\s+function)\s+((?:is|neutral)[A-Z]\w*)/gm)].map(m => m[1]),
  // Les listes d'export (`export { isFoo }`, `export { a as isFoo } from …`) : le nom exporté.
  ...[...text.matchAll(/^export\s*(?:type\s*)?\{([^}]*)\}/gm)].flatMap(m => m[1].split(',').map(part => part.trim().split(/\s+as\s+/).pop()).filter(name => /^(?:is|neutral)[A-Z]\w*$/.test(name))),
]

/** Les clés des tables `FORM_GUARDS` et `NEUTRALIZERS` d'un fichier de test. */
const tableKeys = testText => {
  // Le texte de la table, de l'accolade qui suit son « = » à `end` : « \n} » pour une table sur plusieurs lignes, « } » pour une table sur une ligne.
  const block = (name, end) => {
    const at = testText.indexOf(`const ${name}`)
    if (at < 0) return ''
    const open = testText.indexOf('{', testText.indexOf('=', at))
    return testText.slice(open + 1, testText.indexOf(end, open))
  }
  const guards = [...block('FORM_GUARDS', '\n}').matchAll(/^\s+(\w+):/gm)].map(m => m[1])
  const neutralizers = block('NEUTRALIZERS', '}').split(',').map(word => word.trim()).filter(word => /^\w+$/.test(word))
  return new Set([...guards, ...neutralizers])
}

/** Les gardes exportés qui n'ont ni leur clé dans ces tables, ni leur place dans la liste des prédicats. */
const missingFromCorpus = (guards, testText) => {
  const keys = tableKeys(testText)
  return guards.filter(name => !(name in NOT_FORM_GUARDS) && !keys.has(name))
}

const corpusTest = readFileSync(new URL('./corpus-hostile.test.ts', import.meta.url), 'utf8')
const guards = hookSources()
  .filter(({ file }) => MODULES.includes(file))
  .flatMap(({ text }) => exportedGuards(text))

test('les tables du corpus se lisent : chaque garde de closing.ts y a sa clé', () => {
  const keys = tableKeys(corpusTest)
  for (const name of ['isGroupId', 'isSafeId', 'isSessionId', 'isWorktreePath', 'neutralLine', 'neutralInPrompt', 'neutralRelayed']) assert.ok(keys.has(name), name)
  assert.ok(guards.includes('isAutoOn'), 'les exports de model.ts ne sont pas lus')
})

test('chaque export is… ou neutral… de closing.ts et model.ts est un garde éprouvé par le corpus, ou un prédicat sur la mission nommé', () => {
  assert.deepEqual(missingFromCorpus(guards, corpusTest), [])
})

test('un garde ajouté sans sa clé dans les tables fait échouer la vérification, quelle que soit sa forme', () => {
  for (const added of [
    'export const isNewThing = (value: unknown): value is string => true',
    'export const isNewThing = (value?: unknown) => true',
    'export const isNewThing: (v: unknown) => boolean = v => true',
    'export function isNewThing(\n  v: Json,\n) {',
    'export let isNewThing = (v: string) => true',
    'const isNewThing = () => true\nexport { isNewThing }',
    "export { check as isNewThing } from './other.ts'",
  ]) {
    assert.deepEqual(missingFromCorpus(exportedGuards(added), corpusTest), ['isNewThing'], added)
  }
  // Nommé ailleurs dans le fichier (un import, un commentaire, un test à part) mais pas dans les tables, il manque toujours.
  assert.deepEqual(missingFromCorpus(['isNewThing'], `import { isNewThing } from '../hooks/closing.ts'\n// isNewThing\nisNewThing('x')\n`), ['isNewThing'])
})

test('chaque exception nomme un export qui existe encore, avec sa raison', () => {
  for (const [name, why] of Object.entries(NOT_FORM_GUARDS)) {
    assert.ok(guards.includes(name), name)
    assert.ok(why.length > 20, name)
  }
})
