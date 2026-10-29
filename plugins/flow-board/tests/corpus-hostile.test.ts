import { expect, test } from 'claude-code/testing'

import { isSafeBranch, isSafeId, isWorktreePath, reopenText } from '../hooks/closing.ts'
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
