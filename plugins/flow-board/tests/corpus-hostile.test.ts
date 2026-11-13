import { expect, test } from 'claude-code/testing'

import { closingProcedure, isGroupId, isNotedWorktree, isQuestionIdForm, isSafeBranch, isSafeId, isScriptPath, isSessionId, isVersionForm, isWorktreePath, linkedPrefix, neutralInPrompt, neutralLine, neutralRelayed, reopenText, shellQuote } from '../hooks/closing.ts'
import { AUTO_STOPS, applyReport, autoStateOf, emptyBoard, groupFailStop, isFableMark, newRun, startLinkedGroups } from '../hooks/model.ts'
import { applyRelay, decidedFileText } from '../hooks/relay.ts'
import { isSeat } from '../hooks/seat.ts'
import { isDecisionsPath, isEntryId, isOneLine, isPrint, isQuestionRef, isReportPrint, isRound, isTicketRef, refOf, soundEntry } from '../hooks/coordination.ts'
import { isSetAsideId } from '../hooks/a-reprendre.ts'
import { breaksLine } from '../hooks/compaction.ts'
import { isSha } from '../hooks/coo.ts'
import { isNightId } from '../hooks/night.ts'
import { isPisteId } from '../hooks/pistes.ts'
import { isPlanUnit } from '../hooks/plan-projet.ts'
import { isRoadmapId } from '../hooks/roadmap.ts'
import { isCardId, isFolderName, isLaunchId } from '../hooks/launch.ts'
import { activeRun } from '../hooks/basics.ts'
import { relayShortId } from '../hooks/link.ts'
import type { Board, Closing } from '../types'
import { CORPUS, LINE_BREAKERS, NON_TEXT, QUOTE_LOOKALIKES, ch } from './corpus.mjs'

// Un même corpus hostile passe par chaque garde de forme : la même classe de défaut (Unicode,
// sosies, caractères de contrôle, signe Kelvin) était revenue à cinq tours de revue, dans cinq
// validateurs écrits chacun pour ses propres cas. Un garde ajouté rejoint ce fichier
// (CODING_STANDARDS.md, « Un garde de forme passe le corpus hostile commun »). Le corpus est dans
// corpus.mjs, que le test du script d'instantané lit aussi.

const entries = Object.entries(CORPUS)

/** Les noms des entrées qu'un garde laisse passer, pour un message qui les dit toutes. */
const passing = (accepts: (token: string) => boolean): string[] => entries.filter(([, token]) => accepts(token)).map(([name]) => name)

const ROOT = '/Users/m/proj'
const UUID = '178bd61c-0416-4d88-8317-cc583d9f0d47'
const WT = `${ROOT}/.claude/worktrees/groupe-boutique-A`
const BRANCH = 'worktree-groupe-boutique-A'
const target = { kind: 'group', id: 'A', name: 'Alpha' } as const
const closed: Closing = { state: 'closed', at: 5_000, sessionId: UUID, branch: BRANCH, worktree: WT }

test('les valeurs de référence passent chaque garde : un refus vient bien de l’entrée du corpus', () => {
  expect(isSafeId('ab-cd')).toBe(true)
  expect(isSafeBranch('feat/ab-cd')).toBe(true)
  expect(isWorktreePath(`${ROOT}/.claude/worktrees/groupe-ab-cd`, ROOT)).toBe(true)
  expect(reopenText({ run: newRun('implement', 1_000, 'Boutique'), target, closing: closed, root: ROOT })).not.toBeNull()
})

test('isSafeId refuse chaque entrée du corpus', () => {
  expect(passing(token => isSafeId(`ab${token}cd`))).toEqual([])
})

test('l’id de session relu au relais : relayShortId rend son id court, et rien hors forme, où que l’entrée du corpus soit glissée', () => {
  expect(relayShortId(UUID)).toBe('178bd61c')
  expect(passing(token => relayShortId(`178b${token}d61c-0416-4d88-8317-cc583d9f0d47`) !== null)).toEqual([])
  expect(passing(token => relayShortId(`${UUID}${token}`) !== null)).toEqual([])
})

test('la carte de lancement : l’id du lancement, celui de la carte et le dossier refusent chaque entrée du corpus', () => {
  expect(isLaunchId('lab12cd34')).toBe(true)
  expect(isCardId('kab12cd')).toBe(true)
  expect(isFolderName('ab-cd')).toBe(true)
  expect(passing(token => isLaunchId(`lab${token}12cd34`))).toEqual([])
  expect(passing(token => isCardId(`kab${token}12cd`))).toEqual([])
  expect(passing(token => isFolderName(`ab${token}cd`))).toEqual([])
})

test('le fichier de coordination : l’id d’une entrée, sa mission et la référence du réveil refusent chaque entrée du corpus', () => {
  expect(isEntryId('cab12cd')).toBe(true)
  expect(refOf('Manager [ab12cd]')).toBe('[ab12cd]')
  expect(soundEntry({ id: 'cab12cd', kind: 'close', run: 'ab-cd', at: 1 })).not.toBeNull()
  expect(passing(token => isEntryId(`cab${token}12cd`))).toEqual([])
  expect(passing(token => refOf(`Manager [ab${token}12]`) !== null)).toEqual([])
  // Après la référence, rien n'entre : elle se reconstruit de ses seuls signes en forme, ou rien.
  expect(passing(token => ![null, '[ab12cd]'].includes(refOf(`Manager [ab12cd]${token}`)))).toEqual([])
  expect(passing(token => soundEntry({ id: 'cab12cd', kind: 'close', run: `ab${token}cd`, at: 1 }) !== null)).toEqual([])
})

test('le siège du COO relu (isSeat) refuse chaque entrée du corpus dans l’id de sa discussion', () => {
  expect(isSeat({ by: 'ab-cd', at: 1, seenAt: 1 })).toBe(true)
  expect(passing(token => isSeat({ by: `ab${token}cd`, at: 1, seenAt: 1 }))).toEqual([])
})

test('isSessionId refuse chaque entrée du corpus, dans un UUID comme dans un id local_', () => {
  expect(isSessionId(UUID)).toBe(true)
  expect(isSessionId('local_ab-cd')).toBe(true)
  expect(passing(token => isSessionId(`178bd61c${token}-0416-4d88-8317-cc583d9f0d47`))).toEqual([])
  expect(passing(token => isSessionId(`local_ab${token}cd`))).toEqual([])
})

/**
 * Les gardes de forme exportés par les modules de `hooks/`, rangés par classe : chacun a sa clé dans
 * une de ces trois tables, que `gardes-corpus.test.mjs` relit (tout prédicat exporté y est, ou dans sa
 * liste des prédicats nommés, avec leur raison). Un garde d'identifiant, de nom ou de chemin
 * (`FORM_GUARDS`) accepte sa valeur valide et refuse chaque entrée du corpus glissée dedans, et toute
 * valeur qui n'est pas du texte ; une neutralisation (`NEUTRALIZERS`) rend, de chaque entrée du corpus
 * comme d'une valeur qui n'est pas du texte, un texte sans fin de ligne ; un garde de ligne sûre
 * (`LINE_SAFE`, plus bas) laisse passer un texte d'une ligne, sosies de guillemets compris, et refuse
 * les fins de ligne, les contrôles C0 et C1 et les marques bidirectionnelles qui retournent l'affichage.
 */
type FormGuard = { accepts: (value: unknown) => boolean; valid: string; hostile: (token: string) => string }
const FORM_GUARDS: Record<string, FormGuard> = {
  isGroupId: { accepts: isGroupId, valid: 'A1b', hostile: token => `A${token}1` },
  isSafeId: { accepts: isSafeId, valid: 'ab-cd', hostile: token => `ab${token}cd` },
  isQuestionIdForm: { accepts: isQuestionIdForm, valid: 'relance:A#2', hostile: token => `relance:A${token}#2` },
  isSessionId: { accepts: isSessionId, valid: UUID, hostile: token => `178bd61c${token}-0416-4d88-8317-cc583d9f0d47` },
  // L'id complet relu au relais, dont l'id court entre dans claude stop et claude rm (la session notée sans la sortie du lancement).
  relayShortId: { accepts: value => relayShortId(value) !== null, valid: UUID, hostile: token => `178bd61c-04${token}16-4d88-8317-cc583d9f0d47` },
  isSafeBranch: { accepts: isSafeBranch, valid: 'feat/ab-cd', hostile: token => `feat/ab${token}cd` },
  isNotedWorktree: { accepts: value => isNotedWorktree(value, 'A', 2), valid: 'groupe-ab-cd-A-2', hostile: token => `groupe-ab${token}cd-A-2` },
  isVersionForm: { accepts: isVersionForm, valid: '0.80.0-rc.1', hostile: token => `0.8${token}0.0` },
  isWorktreePath: { accepts: value => isWorktreePath(value, ROOT), valid: `${ROOT}/.claude/worktrees/groupe-ab-cd`, hostile: token => `${ROOT}/.claude/worktrees/groupe-ab${token}cd` },
  isFableMark: { accepts: isFableMark, valid: 'fable', hostile: token => `fa${token}ble` },
  isScriptPath: { accepts: isScriptPath, valid: '/opt/poste/.claude/plugins/flow-board/scripts/fermeture.mjs', hostile: token => `/opt/po${token}ste/.claude/plugins/flow-board/scripts/fermeture.mjs` },
  isLaunchId: { accepts: isLaunchId, valid: 'lab12cd34', hostile: token => `lab${token}12cd34` },
  isCardId: { accepts: isCardId, valid: 'kab12cd', hostile: token => `kab${token}12cd` },
  isFolderName: { accepts: isFolderName, valid: 'ab-cd', hostile: token => `ab${token}cd` },
  isEntryId: { accepts: isEntryId, valid: 'cab12cd', hostile: token => `cab${token}12cd` },
  isSeat: { accepts: value => isSeat({ by: value, at: 1, seenAt: 1 }), valid: 'ab-cd', hostile: token => `ab${token}cd` },
  isSetAsideId: { accepts: isSetAsideId, valid: 'aab12cd', hostile: token => `aab${token}12cd` },
  isSha: { accepts: isSha, valid: '0123456789abcdef0123456789abcdef01234567', hostile: token => `0123456789abcdef0123${token}456789abcdef01234567` },
  isReportPrint: { accepts: isReportPrint, valid: 'rab1-cd2-ef3', hostile: token => `rab${token}1-cd2-ef3` },
  isRound: { accepts: isRound, valid: '1.2.3', hostile: token => `1.2${token}.3` },
  isPrint: { accepts: isPrint, valid: 'qab12', hostile: token => `qab${token}12` },
  isDecisionsPath: { accepts: isDecisionsPath, valid: 'travail/ab-cd/DECISIONS.md', hostile: token => `travail/ab${token}cd/DECISIONS.md` },
  isTicketRef: { accepts: isTicketRef, valid: 'A-12', hostile: token => `A${token}-12` },
  isNightId: { accepts: isNightId, valid: 'nab12cd34', hostile: token => `nab${token}12cd34` },
  isPisteId: { accepts: isPisteId, valid: 'ab-cd/A1', hostile: token => `ab${token}cd/A1` },
  isPlanUnit: { accepts: isPlanUnit, valid: 'A1', hostile: token => `A${token}1` },
  isRoadmapId: { accepts: isRoadmapId, valid: 'I12', hostile: token => `I1${token}2` },
}
const NEUTRALIZERS: Record<string, (value: unknown) => string> = { neutralLine, neutralInPrompt, neutralRelayed }

/**
 * Les gardes de ligne sûre : vrai pour un texte qui tient sur une ligne et s'affiche dans son ordre.
 * La classe juge un texte déjà reçu comme tel (`breaksLine` prend un `string`, et sur `null` rendrait « ligne sûre ») :
 * elle ne leur demande rien des valeurs non texte, même à `isOneLine` et `isQuestionRef`, qui les refusent.
 */
const LINE_SAFE: Record<string, (text: string) => boolean> = {
  breaksLine: text => !breaksLine(text),
  isOneLine: text => isOneLine(text, 200),
  isQuestionRef,
}

test('chaque garde de ligne sûre accepte une ligne et ses sosies de guillemets, et refuse chaque fin de ligne, contrôle C0 ou C1 et marque bidirectionnelle', () => {
  for (const [name, isSafe] of Object.entries(LINE_SAFE)) {
    expect({ name, valid: isSafe('avant après') }).toEqual({ name, valid: true })
    expect({ name, quotes: QUOTE_LOOKALIKES.filter(q => !isSafe(`avant ${q}x${q} après`)) }).toEqual({ name, quotes: [] })
    for (const [family, codes] of Object.entries(LINE_BREAKERS)) {
      const leaks = codes.filter(code => isSafe(`avant${ch(code)}après`)).map(code => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
      expect({ name, family, leaks }).toEqual({ name, family, leaks: [] })
    }
  }
})

/** Ce qu'une neutralisation ne rend jamais : une fin de ligne, un contrôle, un caractère de format ou un invisible. */
const opensALine = (c: string): boolean => /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u.test(c)

test('chaque garde de la table accepte sa valeur valide et refuse chaque entrée du corpus glissée dedans', () => {
  for (const [name, guard] of Object.entries(FORM_GUARDS)) {
    expect({ name, valid: guard.accepts(guard.valid) }).toEqual({ name, valid: true })
    expect({ name, leaks: passing(token => guard.accepts(guard.hostile(token))) }).toEqual({ name, leaks: [] })
  }
})

test('chaque neutralisation de la table rend, de chaque entrée du corpus, un texte sans fin de ligne ni invisible', () => {
  for (const [name, neutral] of Object.entries(NEUTRALIZERS)) {
    expect({ name, leaks: passing(token => [...neutral(`avant ${token} après`)].some(opensALine)) }).toEqual({ name, leaks: [] })
  }
})

test('chaque garde de forme refuse une valeur qui n’est pas du texte ; chaque neutralisation l’accepte et rend un texte sans fin de ligne', () => {
  const leaks: string[] = []
  for (const [value, input] of Object.entries(NON_TEXT)) {
    for (const [name, guard] of Object.entries(FORM_GUARDS)) if (guard.accepts(input) !== false) leaks.push(`${name} accepte ${value}`)
    for (const [name, neutral] of Object.entries(NEUTRALIZERS)) {
      let out: unknown = null
      try {
        out = neutral(input)
      } catch {
        out = null
      }
      if (typeof out !== 'string' || [...out].some(opensALine)) leaks.push(`${name} sur ${value}`)
    }
  }
  expect(leaks).toEqual([])
  // Une chaîne passe comme avant.
  expect(neutralLine('a b')).toBe('a b')
})

test('neutralRelayed ne laisse, d’aucune entrée du corpus, ni fin de ligne, ni sosie de « · », ni crochet de citation', () => {
  const quotes = ch(0x27e6) + 'x' + ch(0x27e7) + ch(0x301a) + 'y' + ch(0x301b)
  const leaks = [...entries, ['crochets de citation', quotes] as [string, string]]
    .filter(([, token]) => breaksASection(neutralRelayed(`avant ${token} après`)))
    .map(([name]) => name)
  expect(leaks).toEqual([])
  expect(neutralRelayed('a · b')).toBe('a • b')
})

test('isSafeBranch refuse chaque entrée du corpus', () => {
  expect(passing(token => isSafeBranch(`feat/ab${token}cd`))).toEqual([])
})

test('isWorktreePath refuse chaque entrée du corpus dans le nom du worktree', () => {
  expect(passing(token => isWorktreePath(`${ROOT}/.claude/worktrees/groupe-ab${token}cd`, ROOT))).toEqual([])
})

test('reopenText ne rend aucune commande quand un champ de la fermeture porte une entrée du corpus', () => {
  const run = newRun('implement', 1_000, 'Boutique')
  const fields: [string, (token: string) => Partial<Closing>][] = [
    ['sessionId', token => ({ sessionId: `178bd61c${token}-0416-4d88-8317-cc583d9f0d47` })],
    ['branch', token => ({ branch: `worktree-groupe${token}-boutique-A` })],
    ['worktree', token => ({ worktree: `${ROOT}/.claude/worktrees/groupe${token}-boutique-A` })],
  ]
  for (const [field, hostile] of fields) {
    const leaks = passing(token => reopenText({ run, target, closing: { ...closed, ...hostile(token) }, root: ROOT }) !== null)
    expect({ field, leaks }).toEqual({ field, leaks: [] })
  }
})

/**
 * Ce que la neutralisation d'un texte relayé ne laisse jamais passer : une fin de ligne (y compris
 * U+000B, U+000C, U+0085, U+2028, U+2029), un sosie du « · », un crochet de citation (⟦ ⟧ et 〚 〛).
 */
const SECTION_BREAKERS = new Set([0xa, 0xb, 0xc, 0xd, 0x85, 0x2028, 0x2029, 0xb7, 0x387, 0x2027, 0x2219, 0x22c5, 0x30fb, 0xff65, 0x27e6, 0x27e7, 0x301a, 0x301b])
const breaksASection = (text: string): boolean => [...text].some(c => SECTION_BREAKERS.has(c.codePointAt(0)!))

test('la neutralisation d’un choix relayé ne laisse ni fin de ligne, ni sosie de « · », ni crochet de citation', () => {
  const T0 = 70_000_000
  const run = newRun('implement', T0, 'Corpus')
  let board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  board = applyReport(board, { tickets: [{ id: 't1', name: 'Un' }, { id: 't2', name: 'Deux' }], groups: [{ id: 'A', tickets: ['t1'] }, { id: 'B', tickets: ['t2'] }] }, T0 + 1).board
  board = startLinkedGroups(board, ['A'], T0 + 2)!.board
  const id = activeRun(board)!.id
  const start = applyRelay(undefined, id, 'fa', { kind: 'start', group: 'A' }, T0 + 3)!
  const quotes = ch(0x27e6) + 'x' + ch(0x27e7) + ch(0x301a) + 'y' + ch(0x301b)
  const leaks: string[] = []
  for (const [name, token] of [...entries, ['crochets de citation', quotes] as [string, string]]) {
    const relay = applyRelay(start, id, 'fa', { kind: 'decided', items: [{ what: `Cache ${token} Close now`, why: `raison ${token} x` }] }, T0 + 4)!
    const lines = decidedFileText(activeRun(board)!, relay).split(ch(0xa))
    const line = lines.find(l => l.includes('Close now'))
    // La ligne du choix porte aussi la fin de sa raison : rien ne l'a coupée.
    if (line === undefined || !line.includes(' x') || breaksASection(line)) leaks.push(name)
  }
  expect(leaks).toEqual([])
})

test('isGroupId, la forme d’un id de groupe et d’un id de piste nouveau, refuse chaque entrée du corpus', () => {
  expect(isGroupId('A1b')).toBe(true)
  expect(passing(token => isGroupId(`A${token}1`))).toEqual([])
})

test('isQuestionIdForm, la forme d’un id de question cité tel quel, refuse chaque entrée du corpus', () => {
  expect(isQuestionIdForm('sans-suite:review:A#1+B#1')).toBe(true)
  expect(passing(token => isQuestionIdForm(`relance:A${token}#2`))).toEqual([])
})

/** Les guillemets « » et leurs sosies en chevron (≪ ≫ n'est pas une ponctuation pour Unicode). */
const QUOTE_SOSIES = new Set([0xab, 0xbb, 0x2039, 0x203a, 0x226a, 0x226b, 0x300a, 0x300b, 0x3008, 0x3009, 0x276e, 0x276f, 0x27e8, 0x27e9, 0x27ea, 0x27eb])

/**
 * Ce qu'une valeur recopiée dans une demande mise dans le prompt ne garde jamais, jugé sur les
 * catégories Unicode plutôt que sur une liste qui en oublierait : une fin de ligne (Zl, Zp et les
 * contrôles), un caractère de contrôle ou de format (Cc, Cf), un point ignorable par défaut
 * (Default_Ignorable_Code_Point : invisibles, renversements de sens, sélecteurs de variante,
 * remplissages hangûl, bloc U+E0000–E0FFF), une ponctuation ouvrante ou fermante (Ps, Pe : crochets et
 * leurs sosies) autre que ( ) { }, un guillemet « » ou un de ses sosies.
 */
const breaksAQuote = (c: string): boolean =>
  /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u.test(c) ||
  (/[\p{Ps}\p{Pe}]/u.test(c) && !'(){}'.includes(c)) ||
  QUOTE_SOSIES.has(c.codePointAt(0)!)
const PROMPT_BREAKERS = { has: (code: number): boolean => breaksAQuote(String.fromCodePoint(code)) }

test('neutralInPrompt ne garde de quoi fermer une citation ou couper la liste pour aucun point de code', () => {
  const leaks: string[] = []
  for (const code of [...Array.from({ length: 0x30000 }, (_, i) => i), ...Array.from({ length: 0x1000 }, (_, i) => 0xe0000 + i)]) {
    if ([...neutralInPrompt(`a${String.fromCodePoint(code)}b`)].some(c => breaksAQuote(c))) leaks.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
  }
  expect(leaks).toEqual([])
})

test('neutralInPrompt ne garde, d’aucune entrée du corpus ni crochet ou guillemet, de quoi fermer une citation ou couper la liste', () => {
  const quotes = ['[', ']', ch(0x27e6), ch(0x27e7), ch(0x301a), ch(0x301b), ch(0xff3b), ch(0xff3d), ch(0xab), ch(0xbb), ch(0x2039), ch(0x203a), ch(0x226a), ch(0x226b), ch(0x300a), ch(0x300b), ch(0x2329), ch(0x232a), ch(0x276e), ch(0x276f)]
  const leaks = [...entries, ...quotes.map(q => [`guillemet ou crochet ${q}`, q] as [string, string])]
    .filter(([, token]) => [...neutralInPrompt(`avant ${token} après`)].some(c => PROMPT_BREAKERS.has(c.codePointAt(0)!)))
    .map(([name]) => name)
  expect(leaks).toEqual([])
  // Le texte autour reste lisible.
  expect(neutralInPrompt('Rétro · « a » [b]')).toBe('Rétro · “ a ” (b)')
})

/** Ce qu'une valeur recopiée dans une consigne de skill ne garde jamais : une fin de ligne, un contrôle, un caractère de format ou un invisible. */
const breaksALine = (c: string): boolean => /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u.test(c)

test('neutralLine ne garde de quoi ouvrir une ligne pour aucun point de code, ni pour aucune entrée du corpus', () => {
  const leaks: string[] = []
  for (const code of [...Array.from({ length: 0x30000 }, (_, i) => i), ...Array.from({ length: 0x1000 }, (_, i) => 0xe0000 + i)]) {
    if ([...neutralLine(`a${String.fromCodePoint(code)}b`)].some(breaksALine)) leaks.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
  }
  expect(leaks).toEqual([])
  expect(entries.filter(([, token]) => [...neutralLine(`avant ${token} après`)].some(breaksALine)).map(([name]) => name)).toEqual([])
  // Le texte autour reste lisible : ses guillemets et ses « · » restent.
  expect(neutralLine(`Rétro · « a » [b]${ch(0xa)}suite`)).toBe('Rétro · « a » [b] ⏎ suite')
})

test('linkedPrefix, le début d’un titre de worker cité entre « » dans le prompt, ne garde rien qui ferme cette citation', () => {
  const quotes = ['[', ']', ch(0x27e6), ch(0x27e7), ch(0x301a), ch(0x301b), ch(0xff3b), ch(0xff3d), ch(0xab), ch(0xbb), ch(0x2039), ch(0x203a), ch(0x226a), ch(0x226b), ch(0x300a), ch(0x300b), ch(0x2329), ch(0x232a), ch(0x276e), ch(0x276f)]
  const leaks = [...entries, ...quotes.map(q => [`guillemet ou crochet ${q}`, q] as [string, string])]
    .filter(([, token]) => [...linkedPrefix(newRun('implement', 1_000, `avant ${token} après`))].some(c => PROMPT_BREAKERS.has(c.codePointAt(0)!)))
    .map(([name]) => name)
  expect(leaks).toEqual([])
  expect(linkedPrefix(newRun('implement', 1_000, 'Rétro « a » [b]'))).toBe('Rétro a b > ')
})

test('la description d’une fermeture cite le titre de la mission neutralisé, pour un groupe comme pour les pistes d’une phase', () => {
  const quotes = ['[', ']', '«', '»', ch(0x27e8), ch(0x27eb), ch(0x3010), ch(0x2985)]
  const leaks: string[] = []
  for (const [name, token] of [...entries, ...quotes.map(q => [`guillemet ou crochet ${q}`, q] as [string, string])]) {
    const run = newRun('implement', 1_000, `Avant ${token} après`)
    for (const target of [{ kind: 'group', id: 'A', name: 'Alpha' } as const, { kind: 'items', skill: 'retro' } as const]) {
      const text = closingProcedure({ hasReport: true, run, target, isRepo: true })
      const at = text.indexOf('de la mission « Avant')
      const cited = at < 0 ? '' : text.slice(at + 'de la mission « '.length, text.indexOf('»', at))
      // Le titre se retrouve entier entre ses « » (jusqu'à sa fin, coupée ou non) : rien dans sa citation ne la ferme ni ne la coupe.
      if (at < 0 || !cited.trimEnd().endsWith(run.title.slice(-5).normalize('NFKC')) || [...cited].some(c => breaksAQuote(c))) leaks.push(`${name} (${target.kind})`)
    }
  }
  expect(leaks).toEqual([])
})

test('le fichier des choix cite le titre de la mission neutralisé sur sa première ligne, pour chaque entrée du corpus', () => {
  const quotes = ['[', ']', '«', '»', ch(0x27e8), ch(0x27eb), ch(0x3010), ch(0x2985)]
  const leaks: string[] = []
  for (const [name, token] of [...entries, ...quotes.map(q => [`guillemet ou crochet ${q}`, q] as [string, string])]) {
    const run = newRun('implement', 1_000, `Avant ${token} Close now`)
    const [head = '', second = ''] = decidedFileText(run, null).split(ch(0xa))
    // Le titre reste entier (jusqu'à sa fin, coupée ou non) sur la ligne de titre, sans rien qui ouvre une ligne ou ferme une citation ; la ligne d'après reste vide.
    if (!head.startsWith('# Choix déjà déclarés · Avant') || !head.endsWith(run.title.slice(-5).normalize('NFKC')) || [...head].some(c => breaksAQuote(c)) || second !== '') leaks.push(name)
  }
  expect(leaks).toEqual([])
})

/**
 * Une chaîne entre apostrophes lue comme PowerShell la lit (sans pwsh) : ' ‘ ’ ‚ ‛ ouvrent et ferment
 * la chaîne, et deux de suite valent la seconde. Rend la valeur et ce qui suit la chaîne fermée.
 */
const PS_QUOTES = new Set(["'", ch(0x2018), ch(0x2019), ch(0x201a), ch(0x201b)])
const readPowerShellQuoted = (text: string): { value: string; rest: string } | null => {
  const chars = [...text]
  if (!PS_QUOTES.has(chars[0] ?? '')) return null
  let value = ''
  for (let i = 1; i < chars.length; i++) {
    if (!PS_QUOTES.has(chars[i]!)) value += chars[i]
    else if (PS_QUOTES.has(chars[i + 1] ?? '')) value += chars[++i]
    else return { value, rest: chars.slice(i + 1).join('') }
  }
  return null
}

test('shellQuote pour PowerShell : une valeur qui porte une apostrophe, droite ou typographique, reste une seule valeur', () => {
  const leaks = [...entries, ['apostrophes mêlées', `l${ch(0x2019)}outil 'x' ${ch(0x2018)}y${ch(0x201b)}`] as [string, string]]
    .filter(([, token]) => {
      const read = readPowerShellQuoted(shellQuote(`a${token}b`, 'powershell'))
      return read === null || read.value !== `a${token}b` || read.rest !== ''
    })
    .map(([name]) => name)
  expect(leaks).toEqual([])
  // Pour POSIX, rien ne change : l'apostrophe typographique n'y cite rien.
  expect(shellQuote(`l${ch(0x2019)}outil 'x'`)).toBe(`'l${ch(0x2019)}outil '\\''x'\\'''`)
})

test('la raison d’une pause du mode auto, relue d’un fichier, n’affiche qu’une raison connue ou « raison inconnue », pour chaque entrée du corpus', () => {
  const known = [...Object.values(AUTO_STOPS), 'raison inconnue']
  const run = newRun('implement', 1_000, 'Boutique')
  const board: Board = { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
  const shown = (offWhy: string) => {
    const view = autoStateOf({ ...run, auto: { onAt: 1_000, onBy: 'sa', offAt: 2_000, offWhy } }, board, 'sa')
    return view.kind === 'paused' ? view.why : ''
  }
  expect(shown('discussion fermée')).toBe('discussion fermée')
  // Une raison connue est un texte fixé, sans aucune entrée du corpus : seule une raison hors liste fuirait.
  expect(passing(token => !known.includes(shown(`discussion${token}fermée`)))).toEqual([])
  // « deuxième échec du groupe <id> » : seulement avec un id de groupe en forme (le garde d'`isGroupId`), sinon « raison inconnue ».
  expect(shown(groupFailStop('A2'))).toBe('deuxième échec du groupe A2')
  const prefix = groupFailStop('')
  expect(passing(token => {
    const why = shown(groupFailStop(`A${token}`))
    return why !== 'raison inconnue' && !(why.startsWith(prefix) && isGroupId(why.slice(prefix.length)))
  })).toEqual([])
})
