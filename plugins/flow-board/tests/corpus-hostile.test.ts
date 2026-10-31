import { expect, test } from 'claude-code/testing'

import { closingProcedure, isGroupId, isSafeBranch, isSafeId, isWorktreePath, linkedPrefix, neutralInPrompt, reopenText, shellQuote } from '../hooks/closing.ts'
import { activeRun, applyRelay, applyReport, decidedFileText, emptyBoard, newRun, startLinkedGroups } from '../hooks/model.ts'
import type { Board, Closing } from '../types'
import { CORPUS, ch } from './corpus.mjs'

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

test('linkedPrefix, le début d’un titre de session liée cité entre « » dans le prompt, ne garde rien qui ferme cette citation', () => {
  const quotes = ['[', ']', ch(0x27e6), ch(0x27e7), ch(0x301a), ch(0x301b), ch(0xff3b), ch(0xff3d), ch(0xab), ch(0xbb), ch(0x2039), ch(0x203a), ch(0x226a), ch(0x226b), ch(0x300a), ch(0x300b), ch(0x2329), ch(0x232a), ch(0x276e), ch(0x276f)]
  const leaks = [...entries, ...quotes.map(q => [`guillemet ou crochet ${q}`, q] as [string, string])]
    .filter(([, token]) => [...linkedPrefix(newRun('implement', 1_000, `avant ${token} après`))].some(c => PROMPT_BREAKERS.has(c.codePointAt(0)!)))
    .map(([name]) => name)
  expect(leaks).toEqual([])
  expect(linkedPrefix(newRun('implement', 1_000, 'Rétro « a » [b]'))).toBe('Rétro a b > ')
})

test('la description d’une fermeture cite le titre du parcours neutralisé, pour un groupe comme pour les pistes d’une phase', () => {
  const quotes = ['[', ']', '«', '»', ch(0x27e8), ch(0x27eb), ch(0x3010), ch(0x2985)]
  const leaks: string[] = []
  for (const [name, token] of [...entries, ...quotes.map(q => [`guillemet ou crochet ${q}`, q] as [string, string])]) {
    const run = newRun('implement', 1_000, `Avant ${token} après`)
    for (const target of [{ kind: 'group', id: 'A', name: 'Alpha' } as const, { kind: 'items', skill: 'retro' } as const]) {
      const text = closingProcedure({ run, target, isRepo: true })
      const at = text.indexOf('du parcours « Avant')
      const cited = at < 0 ? '' : text.slice(at + 'du parcours « '.length, text.indexOf('»', at))
      // Le titre se retrouve entier entre ses « » (jusqu'à sa fin, coupée ou non) : rien dans sa citation ne la ferme ni ne la coupe.
      if (at < 0 || !cited.trimEnd().endsWith(run.title.slice(-5).normalize('NFKC')) || [...cited].some(c => breaksAQuote(c))) leaks.push(`${name} (${target.kind})`)
    }
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
