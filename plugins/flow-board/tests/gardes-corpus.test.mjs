// Chaque garde de forme exporté par un module de hooks/ passe le corpus hostile commun
// (CODING_STANDARDS.md, « Un garde de forme passe le corpus hostile commun ») : un garde absent de
// corpus-hostile.test.ts n'avait été vu qu'à la revue d'un ticket, et `breaksLine` (compaction.ts)
// avait échappé à ce test, qui ne lisait que closing.ts et model.ts et les seuls noms `is…` et `neutral…`.
//
// Un test Node (node --test, lancé par scripts/check.sh) : il lit toutes les sources par l'aide commune.
// Il se trompe du côté du faux rouge (CODING_STANDARDS.md) : tout export dont le nom a un préfixe
// verbal de prédicat (`is…`, `neutral…`, `has…`, `breaks…`, `opens…`…) ou dont la première ligne de
// déclaration dit un booléen (« ): boolean », « : (…) => boolean », un prédicat de type « v is X ») est
// un garde de forme, sauf les exports nommés un par un ci-dessous, chacun avec sa raison. Un garde de forme a sa
// clé dans la table de sa classe de corpus-hostile.test.ts (`FORM_GUARDS`, `NEUTRALIZERS` ou
// `LINE_SAFE`), qui fait passer à chaque clé le corpus ou les familles de sa classe. Le motif ne voit
// pas un export au nom sans préfixe dont le booléen n'est dit ni sur cette première ligne (signature sur
// plusieurs lignes, retour inféré, `Promise<boolean>`) ni nulle part (`export { a as fitsLine }`).

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { hookSources } from './sources.mjs'

/** Les raisons, une par sorte d'export qui n'est pas un garde de forme. */
const ON_MISSION = 'prédicat sur la mission, un groupe, un ticket, le tableau de bord ou une entrée relue déjà en forme : ne décide d’aucune valeur citée dans une commande ou un texte'
const STRUCTURE = 'garde de structure d’un fichier ou d’un enregistrement entier : ne décide d’aucune valeur citée dans une commande ou un texte (ses champs de texte passent par les gardes éprouvés)'
const NUMBER = 'garde d’un nombre (date, compte, numéro de série) : il accepte 42 par contrat, et ne reçoit jamais de texte cité'
const COMPARE = 'compare deux valeurs ou deux états déjà relus : ne juge la forme d’aucune des deux'
const MEANING = 'lit le sens d’un texte (un préfixe, une section, une question, un séparateur de titre) pour décider d’un affichage ou d’une suite : ne laisse entrer aucune valeur dans une commande ou un texte cité'
const ORIGIN = 'prédicat sur l’origine d’un tour du moteur (un objet du moteur), pas sur un texte'
const NOT_A_PREDICATE = 'pas un prédicat sur une valeur (il rend une liste, un état ou un texte) : le motif le prend pour son nom, ou pour un booléen ou un prédicat de type écrit dans le corps de sa déclaration'

/** Les exports que le motif retient et qui ne sont pas des gardes de forme, chacun avec sa raison. */
const NOT_FORM_GUARDS = {
  isOwnBranch: 'compare une branche relue à celle que la fermeture attend (isSafeBranch, éprouvé, juge sa forme)',
  hasSendName: 'compose isGroupId et isNotedWorktree, éprouvés par la table, et les marques worktreeClash et sessionClash, sur un lien relu : un nom absent y vaut le recalcul depuis le titre, comme avant la note, et n’est donc pas un refus',
  isBackgroundLaunch: 'dit si une commande que Claude vient de lancer est un claude --bg, pour signaler une sortie sans ligne « backgrounded » : il ne laisse passer aucune valeur dans une commande ni dans un texte (l’id noté passe par relayShortId, éprouvé par le corpus)',
  isTranscriptPath: 'garde de confinement d’un chemin que le mod lit lui-même (sous <claude>/projects/, sans « .. ») : il n’entre dans aucune commande ni aucun texte cité, et un nom de dossier y garde tout caractère',
  ...Object.fromEntries(['isBoard', 'isRegistry', 'isRelay'].map(name => [name, STRUCTURE])),
  ...Object.fromEntries(['isTime', 'isSecurityCount', 'isBugCount', 'isSeries'].map(name => [name, NUMBER])),
  ...Object.fromEntries(
    ['sameTicket', 'sameLabel', 'sameFolder', 'sameChoice', 'isSameRelayedChoice', 'isSameProject', 'isMainRefNewer', 'isSeatAhead', 'isSeatBehind', 'keepsItems', 'keepsEntries', 'keepsPistes', 'keepsOps', 'holdsWaitlist', 'unitsOverlap'].map(name => [name, COMPARE]),
  ),
  ...Object.fromEntries(['isModQuestion', 'hasSeparator', 'wentWrong', 'answerAwaitsPerson', 'isFableModelId'].map(name => [name, MEANING])),
  ...Object.fromEntries(['isPersonOrigin', 'isTypedOrigin'].map(name => [name, ORIGIN])),
  ...Object.fromEntries(['seenAfter', 'setStep', 'needsRebuild', 'withoutGone', 'liveEntries', 'markClosesDone', 'stripRunAgents', 'markAutoStarted', 'projectPlan', 'closeOpen', 'parseSecuritySetting'].map(name => [name, NOT_A_PREDICATE])),
  ...Object.fromEntries(
    [
      'isCooDiscussion', 'isRunComplete', 'isPhaseOptional', 'isRetroRun', 'isNoLogicGroup', 'isTicketReviewEnough', 'isGroupReviewed',
      'isSensitiveGroup', 'isLotReviewEnough', 'isLotToReview', 'isLotAdviceCurrent', 'isLotAdvicePrevious', 'isLotSecuritySettled',
      'isLotSecurityDue', 'isClosedTurnedOff', 'isBugPass', 'isWaitingTicket', 'isDelegable', 'isCloseCandidate', 'isStoredPause', 'isAutoOn',
      'isAutoLitBy', 'isAutoPauseStored', 'isRelaunchPause', 'isGroupDone', 'isCutDue', 'isAutoResumed', 'isGroupLotStuck', 'isBlocked', 'isPickable', 'isLotUnderway', 'isKeptForReport',
      'isDeliveredRun', 'isAwaitingArchive', 'isCloseDone', 'isDeliveryOver', 'isReportShipped', 'isOtherDiscussions', 'isWaitlistRetro',
      'needsReview', 'versionSet', 'hasWaitlistStep', 'hasUnsoundTombstones', 'canResumeStuck',
      'isBeforeImplPhase', 'isAllDone', 'hasGroupReview', 'isSecuritySettled', 'isAdvisedUnrun', 'isSecuritySettledFor', 'hasUnreadableCounts', 'hasBeenAuto', 'isReportValidated',
      'suggestsCompaction', 'isOpenMission', 'isRetroCardRemovable', 'isEntryGone', 'isReleasedMark', 'isCutDated', 'isPlanUnreadFor', 'isPlanEntry', 'isInstructReceived', 'isInstructSent',
      'isDelivered', 'isDeliveryOpen', 'isClosedSession', 'isPistesCard', 'hasIntentTurn', 'isRecordStale', 'holdsItemsSession', 'isResentInFlight', 'isSentGroup', 'isKeptGroup', 'isHoldingGroup',
      'isClosedLink', 'isRetried', 'isRetriedSince', 'isItemsCloseCandidate', 'hasLaunchedLinked', 'isSureLink', 'isSeatGap', 'isNightWakeDue', 'hasWaitCycle', 'isAdvisorUnsettled',
      'isRepeatedReview', 'hasRetro', 'holdsPick', 'isAwaitingSession', 'isJudgmentTicket', 'isFableStuck',
    ].map(name => [name, ON_MISSION]),
  ),
}

/** Les préfixes verbaux d'un nom de prédicat : un nom qui commence par l'un d'eux, suivi d'une majuscule, est retenu. */
const PREDICATE_NAME = /^(?:is|neutral|has|breaks|opens|keeps|holds|same|needs|can|should|suggests|went)[A-Z]\w*$/
/** Une déclaration qui dit un booléen : un retour `: boolean`, un type de fonction `=> boolean`, un prédicat de type `x is T`. */
const BOOLEAN_DECL = /\)\s*:\s*(?:boolean\b|\w+\s+is\s)|:\s*\([^)]*\)\s*=>\s*boolean\b/

/** Tout export retenu par le motif dans un texte de module : par son nom, quelle que soit sa forme, ou par la première ligne de sa déclaration. */
const exportedGuards = text => [
  ...[...text.matchAll(/^export\s+(?:const|let|var|function\*?|async\s+function)\s+(\w+)([^\n]*)/gm)].filter(m => PREDICATE_NAME.test(m[1]) || BOOLEAN_DECL.test(m[2])).map(m => m[1]),
  // Les listes d'export (`export { isFoo }`, `export { a as isFoo } from …`) : le nom exporté.
  ...[...text.matchAll(/^export\s*(?:type\s*)?\{([^}]*)\}/gm)].flatMap(m => m[1].split(',').map(part => part.trim().split(/\s+as\s+/).pop()).filter(name => PREDICATE_NAME.test(name))),
]

/** Les clés des tables `FORM_GUARDS`, `LINE_SAFE` et `NEUTRALIZERS` d'un fichier de test. */
const tableKeys = testText => {
  // Le texte de la table, de l'accolade qui suit son « = » à `end` : « \n} » pour une table sur plusieurs lignes, « } » pour une table sur une ligne.
  const block = (name, end) => {
    const at = testText.indexOf(`const ${name}`)
    if (at < 0) return ''
    const open = testText.indexOf('{', testText.indexOf('=', at))
    return testText.slice(open + 1, testText.indexOf(end, open))
  }
  const keyed = name => [...block(name, '\n}').matchAll(/^\s+(\w+)(?::|,)/gm)].map(m => m[1])
  const neutralizers = block('NEUTRALIZERS', '}').split(',').map(word => word.trim()).filter(word => /^\w+$/.test(word))
  return new Set([...keyed('FORM_GUARDS'), ...keyed('LINE_SAFE'), ...neutralizers])
}

/** Les gardes exportés qui n'ont ni leur clé dans ces tables, ni leur place dans la liste des exports nommés. */
const missingFromCorpus = (guards, testText) => {
  const keys = tableKeys(testText)
  return guards.filter(name => !(name in NOT_FORM_GUARDS) && !keys.has(name))
}

const corpusTest = readFileSync(new URL('./corpus-hostile.test.ts', import.meta.url), 'utf8')
const guards = hookSources().flatMap(({ text }) => exportedGuards(text))

test('les tables du corpus se lisent : chaque classe y a ses clés, et le motif lit tous les modules', () => {
  const keys = tableKeys(corpusTest)
  for (const name of ['isGroupId', 'isSafeId', 'isSessionId', 'isWorktreePath', 'isLaunchId', 'isRoadmapId', 'neutralLine', 'neutralInPrompt', 'neutralRelayed', 'breaksLine', 'isOneLine', 'isQuestionRef']) assert.ok(keys.has(name), name)
  for (const name of ['isAutoOn', 'breaksLine', 'answerAwaitsPerson', 'unitsOverlap', 'versionSet', 'isBugCount']) assert.ok(guards.includes(name), `${name} n’est pas lu`)
})

test('chaque prédicat exporté par un module de hooks/ est un garde éprouvé par le corpus, ou un export nommé avec sa raison', () => {
  assert.deepEqual(missingFromCorpus(guards, corpusTest), [])
})

test('un garde ajouté sans sa clé dans les tables fait échouer la vérification, retenu par son nom ou par la ligne de sa déclaration', () => {
  for (const [added, name] of [
    ['export const isNewThing = (value: unknown): value is string => true', 'isNewThing'],
    ['export const isNewThing = (value?: unknown) => true', 'isNewThing'],
    ['export const isNewThing: (v: unknown) => boolean = v => true', 'isNewThing'],
    ['export function isNewThing(\n  v: Json,\n) {', 'isNewThing'],
    ['export let isNewThing = (v: string) => true', 'isNewThing'],
    ['const isNewThing = () => true\nexport { isNewThing }', 'isNewThing'],
    ["export { check as isNewThing } from './other.ts'", 'isNewThing'],
    ['export const breaksThing = (text: string): boolean => /x/.test(text)', 'breaksThing'],
    ["export { check as opensThing } from './other.ts'", 'opensThing'],
    ['export const lineFits = (text: string): boolean => text.length < 80', 'lineFits'],
    ['export const fitsLine: (text: string) => boolean = text => true', 'fitsLine'],
    ['export function quoteSafe(text: string): text is string {', 'quoteSafe'],
  ]) {
    assert.deepEqual(missingFromCorpus(exportedGuards(added), corpusTest), [name], added)
  }
  // Nommé ailleurs dans le fichier (un import, un commentaire, un test à part) mais pas dans les tables, il manque toujours.
  assert.deepEqual(missingFromCorpus(['isNewThing'], `import { isNewThing } from '../hooks/closing.ts'\n// isNewThing\nisNewThing('x')\n`), ['isNewThing'])
})

test('chaque export nommé existe encore dans un module de hooks/, avec sa raison', () => {
  for (const [name, why] of Object.entries(NOT_FORM_GUARDS)) {
    assert.ok(guards.includes(name), name)
    assert.ok(why.length > 20, name)
  }
})
