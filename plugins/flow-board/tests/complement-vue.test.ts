import { expect, test } from 'claude-code/testing'

import { complementFate } from '../hooks/complement.ts'
import { launchComplementNote } from '../hooks/complement-ask.ts'
import { cooStatement, type CooRoadmap, type CooStatement } from '../hooks/coo.ts'
import { coordinationRows, type CooRow, type CooShown } from '../hooks/coo-view.tsx'
import { emptyBoard } from '../hooks/model.ts'
import { parseRoadmap } from '../hooks/roadmap.ts'
import { roadmapAsk } from '../hooks/roadmap-asks.ts'

// Un complément dans la page « À reprendre » de la vue Coordination. Invariant : « La page « À reprendre » ne cache jamais
// un complément : rangé sous son entrée tant qu'elle est ouverte ou portée par une mission, montré comme une entrée ouverte
// dans le doute, absent seulement avec une entrée écartée ; et la demande d'écarter une entrée nomme toujours ses
// compléments. »

const FILE = `# Feuille de route

## Jalons
- [J1] en cours · 2026-11-01 · COO · un jalon — fin : il est atteint

## Idées
- [I1] à lancer · 2026-11-01 · Mathis · un tableau des coûts
- [I4] écartée : trop tôt · 2026-11-01 · Mathis · écartée

## À reprendre
- [R1] à décider · 2026-11-02 · boîte b1, mission « M » · une entrée ouverte
- [R2] plus tard · 2026-11-02 · boîte b2, mission « M » · une entrée plus tard
- [R3] rattachée à Mode auto · 2026-11-02 · boîte b3, mission « M » · une entrée rattachée
- [R5] écartée : doublon · 2026-11-02 · boîte b5, mission « M » · une entrée écartée
- [R6] faite : Mode auto, ticket 3 · 2026-11-02 · boîte b6, mission « M » · une entrée faite
- [R10] complète R1 · 2026-11-03 · boîte b10, mission « N » · R1: précise R1
- [R11] complète I1 · 2026-11-03 · boîte b11, mission « N » · I1: précise I1
- [R14] complète R5 · 2026-11-03 · boîte b14, mission « N » · R5: précise une entrée écartée
- [R15] complète I4 · 2026-11-03 · boîte b15, mission « N » · I4: précise une idée écartée
- [R16] complète R6 · 2026-11-03 · boîte b16, mission « N » · R6: précise une entrée faite
- [R17] complète R99 · 2026-11-03 · boîte b17, mission « N » · R99: entrée absente
- [R23] complète R2 · 2026-11-03 · boîte b23, mission « N » · R2: précise une entrée plus tard
- [R24] complète R3 · 2026-11-03 · boîte b24, mission « N » · R3: précise une entrée rattachée
- [R25] complète R10 · 2026-11-03 · boîte b25, mission « N » · R10: une chaîne de compléments
- [R26] complète J1 · 2026-11-03 · boîte b26, mission « N » · J1: une entrée d'une autre section
- [R27] écartée : corrigée par R1 · 2026-11-03 · COO · ancien libellé
- [R28] complète R27 · 2026-11-03 · boîte b28, mission « N » · R27: précise une entrée reformulée
`

const roadmap = (text = FILE): CooRoadmap => ({ where: 'poste', path: '/x/feuille-de-route.md', read: parseRoadmap(text), gone: [], titles: {} })
const statement = (r: CooRoadmap = roadmap()): CooStatement => ({ ...cooStatement(emptyBoard('', 'p'), { now: 1, roadmap: r }) })
const rowsOf = (shown: CooShown, r?: CooRoadmap): CooRow[] => coordinationRows(statement(r), shown)
const keys = (rows: readonly CooRow[]): string[] => rows.map(r => r.key)
const textOf = (r: CooRow | undefined): string => (r?.parts ?? []).map(p => p.text.replace(/ /g, ' ')).join(' ')

test('un complément rangé s’affiche en retrait juste sous son entrée, « ↳ <id> · <début du texte> », sans bouton, et ne compte pas à part', () => {
  const rows = rowsOf({ page: 'pending' })
  const k = keys(rows)
  expect(k.indexOf('coo-complement-R10')).toBe(k.indexOf('coo-pending-R1') + 1)
  const line = rows.find(r => 'coo-complement-R10' === r.key)!
  expect(textOf(line)).toMatch(/^ {2}↳ R10 · R1: précise R1 03\/11$/)
  expect(line.actions?.map(a => a.label)).toEqual(['▸'])
  // La suite de son entrée : aucune ligne vide entre elles (isPart).
  expect(line.isPart).toBe(true)
  // Ouvertes : R1, et R16, R17, R25, R26, R28 (lus comme des choses à décider), plus la rattachée R3 ; R10 et R24 ne comptent pas à part.
  expect(textOf(rows.find(r => 'coo-pendings' === r.key))).toBe('À reprendre · 7')
  expect(k).not.toContain('coo-pending-R10')
})

test('déplié au clic, un complément montre son texte et sa provenance, toujours sans bouton', () => {
  const rows = rowsOf({ page: 'pending', open: 'R10 complète R1' })
  // Clé à droite de la comparaison : « key === '<chaîne>' » ressemble à un secret pour gitleaks (export public).
  expect(textOf(rows.find(r => 'coo-complement-R10-text' === r.key))).toBe('R1: précise R1')
  expect(textOf(rows.find(r => 'coo-complement-R10-from' === r.key))).toBe('boîte b10, mission « N »')
  expect(rows.find(r => 'coo-complement-R10-from' === r.key)!.actions).toBeUndefined()
  expect(rows.find(r => 'coo-complement-R10' === r.key)!.actions?.map(a => a.label)).toEqual(['▾'])
})

test('il suit son entrée : sous une entrée rattachée, avec elle ; sous une entrée « plus tard », dans le bloc « Plus tard »', () => {
  const k = keys(rowsOf({ page: 'pending' }))
  expect(k.indexOf('coo-complement-R24')).toBe(k.indexOf('coo-pending-R3') + 1)
  // Bloc « Plus tard » replié : ni l'entrée ni son complément.
  expect(k).not.toContain('coo-complement-R23')
  const open = keys(rowsOf({ page: 'pending', isLaterOpen: true }))
  expect(open.indexOf('coo-complement-R23')).toBe(open.indexOf('coo-pending-R2') + 1)
  expect(open.indexOf('coo-later')).toBeLessThan(open.indexOf('coo-complement-R23'))
})

test('un complément d’une idée s’affiche de même sous cette idée, dans la page « Idées »', () => {
  const rows = rowsOf({ page: 'ideas' })
  const k = keys(rows)
  expect(k.indexOf('coo-complement-R11')).toBe(k.indexOf('coo-idea-I1') + 1)
  expect(textOf(rows.find(r => 'coo-complement-R11' === r.key))).toMatch(/↳ R11 · I1: précise I1/)
  expect(textOf(rows.find(r => 'coo-ideas' === r.key))).toBe('Idées · 1')
})

test('un complément lu comme une chose à décider (entrée faite, absente, chaîne, autre section, reformulée) s’affiche comme une entrée ouverte, avec ses boutons', () => {
  for (const [id, of] of [['R16', 'R6'], ['R17', 'R99'], ['R25', 'R10'], ['R26', 'J1'], ['R28', 'R27']]) {
    const rows = rowsOf({ page: 'pending', open: `${id} complète ${of}` })
    expect(keys(rows)).toContain(`coo-pending-${id}`)
    expect(keys(rows)).not.toContain(`coo-complement-${id}`)
    const actions = rows.find(r => r.key === `coo-pending-${id}-from`)!.actions!.map(a => a.label.replace(/ /g, ' '))
    expect(actions).toEqual(['▶ Lancer', 'Rattacher', 'Plus tard', 'Écarter'])
  }
})

test('un complément d’une entrée écartée n’est pas montré, comme elle', () => {
  const k = [...keys(rowsOf({ page: 'pending', isLaterOpen: true, isAllPending: true })), ...keys(rowsOf({ page: 'ideas' }))]
  for (const id of ['R14', 'R15', 'R5', 'I4']) expect(k.filter(x => x.includes(id))).toEqual([])
})

test('« Écarter » une entrée qui a des compléments : la demande nomme leurs ids et dit de les redire avant d’écrire ; les autres demandes ne changent pas', () => {
  const r = roadmap()
  const drop = roadmapAsk({ kind: 'pending-drop', id: 'R1' } as never, r)!
  expect(drop).toContain('Elle a un complément rangé avec elle, à l\'état « complète R1 » : R10. Redis-le-moi avec elle avant d\'écrire')
  // Une raison « corrigée … » laisse le complément ouvert : la demande le dit, comme complementFate le lit.
  expect(drop).toContain('sauf si son statut écrit commence par « écartée : corrigée », tel quel, en minuscules (une entrée seulement reformulée) : il reste ouvert, à décider')
  const corrected = parseRoadmap(FILE.replace('- [R1] à décider', '- [R1] écartée : corrigée par R40'))
  expect(corrected.ok && complementFate(corrected.entries.find(e => e.id === 'R10')!, corrected.entries).kind).toBe('open')
  const idea = roadmapAsk({ kind: 'drop', id: 'I1' } as never, r)!
  expect(idea).toContain('« complète I1 » : R11')
  // Sans complément, la demande est celle d'avant.
  expect(roadmapAsk({ kind: 'pending-drop', id: 'R2' } as never, roadmap(FILE.replace(/- \[R23\][^\n]*\n/, '')))).not.toMatch(/complément/)
  for (const kind of ['pending-later', 'pending-attach', 'later']) expect(roadmapAsk({ kind, id: 'R1' } as never, r)).not.toMatch(/complément/)
})

test('« Lancer » un complément lu comme une chose à décider : la demande le dit encore ouvert ; un autre, non', () => {
  const r = roadmap()
  expect(roadmapAsk({ kind: 'pending-launch', id: 'R16' } as never, r)).toContain('R16 est un complément que le tableau de bord lit comme une chose à décider')
  expect(roadmapAsk({ kind: 'pending-launch', id: 'R16' } as never, r)).toContain('au lancement comme pour la passer ensuite à « rattachée à <titre> »')
  // La note suit complementFate : chaîne, autre section, entrée reformulée oui ; complément rangé ou clos, non.
  for (const id of ['R25', 'R26', 'R28']) expect(roadmapAsk({ kind: 'pending-launch', id } as never, r)).toContain(`${id} est un complément`)
  for (const id of ['R10', 'R14']) expect(launchComplementNote(id, r.read)).toBe('')
  expect(roadmapAsk({ kind: 'pending-launch', id: 'R1' } as never, r)).not.toMatch(/complément/)
})

test('au-delà des 20 entrées visibles, un complément n’est jamais séparé de son entrée par « ▸ tout voir »', () => {
  const many = Array.from({ length: 25 }, (_, i) => `- [R${100 + i}] à décider · 2026-11-${String(10 + (i % 15)).padStart(2, '0')} · COO · entrée ${i}`).join('\n')
  const text = `${FILE}${many}\n- [R200] complète R100 · 2026-11-20 · boîte b200, mission « N » · R100: précise R100\n`
  const shortList = keys(rowsOf({ page: 'pending' }, roadmap(text)))
  const all = keys(rowsOf({ page: 'pending', isAllPending: true }, roadmap(text)))
  // R100 (le plus ancien jour) est hors des 20 premières : son complément non plus ; tout voir, il est juste sous elle.
  expect(shortList).not.toContain('coo-pending-R100')
  expect(shortList).not.toContain('coo-complement-R200')
  expect(all.indexOf('coo-complement-R200')).toBe(all.indexOf('coo-pending-R100') + 1)
})
