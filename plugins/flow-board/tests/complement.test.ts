import { expect, test } from 'claude-code/testing'

import { complementFate, complementsOf, copyStatusFor } from '../hooks/complement.ts'
import { cooStatement, roadmapNow, statementText, type CooRoadmap, type CooStatement } from '../hooks/coo.ts'
import { withDueHead } from '../hooks/rangement.ts'
import { parseRoadmap, type RoadmapEntry } from '../hooks/roadmap.ts'
import { untitledIds } from '../hooks/titles.ts'
import { TOOL_SCHEMA } from '../hooks/tool-schema.ts'
import { autoNote } from '../hooks/auto-consignes.ts'
import { entriesRefusal } from '../hooks/launch.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'

// Le complément d'une entrée (« complète <id> ») : son sort se lit d'après la feuille de route, sa recopie lit l'id en
// tête de la déclaration. Invariant : « Un complément n'est jamais caché ni clos sans que son entrée le soit par une
// décision qui le nommait ; dans le doute (entrée absente, hors forme, elle-même un complément, ou dite faite), il se
// lit comme une chose à décider ; et ni l'id ni le texte d'une entrée ne changent. »

const FILE = `# Feuille de route

## Jalons
- [J1] en cours · 2026-11-02 · Mathis · Le COO suit les missions — fin : chaque mission passe par lui

## Prochaines étapes
- [E1] à faire · 2026-11-02 · COO · Lancer le groupe C

## Idées
- [I1] à lancer · 2026-11-01 · Mathis · un tableau des coûts
- [I2] plus tard · 2026-11-01 · Mathis · un export
- [I3] devenue mission Coûts · 2026-11-01 · Mathis · devenue mission
- [I4] écartée : trop tôt · 2026-11-01 · Mathis · écartée

## À reprendre
- [R1] à décider · 2026-11-02 · boîte b1, mission « M » · ouverte
- [R2] plus tard · 2026-11-02 · boîte b2, mission « M » · plus tard
- [R3] rattachée à Mode auto · 2026-11-02 · boîte b3, mission « M » · rattachée
- [R4] lancée · 2026-11-02 · boîte b4, mission « M » · lancée
- [R5] écartée : doublon · 2026-11-02 · boîte b5, mission « M » · écartée
- [R6] faite : Mode auto, ticket 3 · 2026-11-02 · boîte b6, mission « M » · faite
- [R10] complète R1 · 2026-11-03 · boîte b10, mission « N » · R1: précise R1
- [R11] complète I1 · 2026-11-03 · boîte b11, mission « N » · I1: précise I1
- [R12] complète R4 · 2026-11-03 · boîte b12, mission « N » · R4: précise une entrée lancée
- [R13] complète I3 · 2026-11-03 · boîte b13, mission « N » · I3: précise une idée devenue mission
- [R14] complète R5 · 2026-11-03 · boîte b14, mission « N » · R5: précise une entrée écartée
- [R15] complète I4 · 2026-11-03 · boîte b15, mission « N » · I4: précise une idée écartée
- [R16] complète R6 · 2026-11-03 · boîte b16, mission « N » · R6: précise une entrée faite
- [R17] complète R99 · 2026-11-03 · boîte b17, mission « N » · R99: entrée absente
- [R18] complète r1 · 2026-11-03 · boîte b18, mission « N » · suite hors forme
- [R19] complète R10 · 2026-11-03 · boîte b19, mission « N » · R10: chaîne
- [R20] complète R20 · 2026-11-03 · boîte b20, mission « N » · lui-même
- [R21] complète J1 · 2026-11-03 · boîte b21, mission « N » · un jalon
- [R22] complète E1 · 2026-11-03 · boîte b22, mission « N » · une étape
- [R23] complète R2 · 2026-11-03 · boîte b23, mission « N » · R2: précise une entrée plus tard
- [R24] complète R3 · 2026-11-03 · boîte b24, mission « N » · R3: précise une entrée rattachée
- [R25] complète I2 · 2026-11-03 · boîte b25, mission « N » · I2: précise une idée plus tard
- [R26] complète R1, R2 · 2026-11-03 · boîte b26, mission « N » · deux ids
`

const read = parseRoadmap(FILE)
const entries = (): RoadmapEntry[] => {
  if (!read.ok) throw new Error(`hors format : ${read.why}`)
  return read.entries
}
const fate = (id: string): string => {
  const f = complementFate(entries().find(e => e.id === id)!, entries())
  return f.kind === 'open' ? 'open' : `${f.kind} ${f.of.id}`
}

test('« complète <id> » est un état accepté d’une chose à reprendre ; « complète » sans suite est refusé', () => {
  expect(read.ok).toBe(true)
  const bare = parseRoadmap(FILE.replace('[R10] complète R1', '[R10] complète'))
  expect(bare.ok).toBe(false)
  if (!bare.ok) expect(bare.why).toMatch(/statut « complète » inconnu dans « À reprendre »/)
  // Dans une autre section, l'état n'est pas permis.
  const idea = parseRoadmap(FILE.replace('[I2] plus tard', '[I2] complète I1'))
  expect(idea.ok).toBe(false)
})

test('complément d’une entrée ouverte : rangé avec elle (« à décider », « plus tard », « rattachée à »)', () => {
  expect(fate('R10')).toBe('with R1')
  expect(fate('R23')).toBe('with R2')
  expect(fate('R24')).toBe('with R3')
})

test('complément d’une idée « à lancer » ou « plus tard » : rangé avec elle', () => {
  expect(fate('R11')).toBe('with I1')
  expect(fate('R25')).toBe('with I2')
})

test('complément d’une entrée que la vue ne montre pas (chose « lancée », idée « devenue mission ») : lu comme une chose à décider', () => {
  expect(fate('R12')).toBe('open')
  expect(fate('R13')).toBe('open')
})

test('complément d’une entrée écartée : clos avec elle', () => {
  expect(fate('R14')).toBe('closed R5')
  expect(fate('R15')).toBe('closed I4')
})

test('complément d’une entrée faite : lu comme une chose à décider', () => {
  expect(fate('R16')).toBe('open')
})

test('entrée absente : lu comme une chose à décider', () => {
  expect(fate('R17')).toBe('open')
})

test('suite hors forme : lu comme une chose à décider', () => {
  expect(fate('R18')).toBe('open')
  expect(fate('R26')).toBe('open')
})

test('chaîne de compléments, ou le sien : lu comme une chose à décider', () => {
  expect(fate('R19')).toBe('open')
  expect(fate('R20')).toBe('open')
})

test('autre section (un jalon, une étape) : lu comme une chose à décider', () => {
  expect(fate('R21')).toBe('open')
  expect(fate('R22')).toBe('open')
})

test('une entrée qui n’est pas un complément se lit comme une chose à décider ; complementsOf donne les compléments rangés avec une entrée', () => {
  expect(fate('R1')).toBe('open')
  expect(complementsOf('R1', entries()).map(e => e.id)).toEqual(['R10'])
  expect(complementsOf('R5', entries()).map(e => e.id)).toEqual([])
  expect(complementsOf('R4', entries()).map(e => e.id)).toEqual([])
})

test('tête valide : « complète <id> » pour une chose à reprendre ouverte ou rattachée, une idée à lancer ou plus tard', () => {
  for (const id of ['R1', 'R2', 'R3', 'I1', 'I2']) expect(copyStatusFor(`${id}: la suite du texte`, entries())).toBe(`complète ${id}`)
  expect(copyStatusFor('R1:sans espace', entries())).toBe('complète R1')
})

test('tête close ou absente : « à décider » (lancée, écartée, faite, devenue mission, absente, complément elle-même, jalon, étape)', () => {
  for (const id of ['R4', 'R5', 'R6', 'I3', 'I4', 'R99', 'R10', 'J1', 'E1']) expect(copyStatusFor(`${id}: suite`, entries())).toBe('à décider')
})

test('tête hors forme : « à décider » (minuscule, sans « : », plusieurs ids, id au milieu, espace en tête, cinq chiffres)', () => {
  for (const text of ['r1: suite', 'R1 suite', 'R1, R2: suite', 'Voir R1: suite', ' R1: suite', 'R00001: suite', 'R1 : suite']) expect(copyStatusFor(text, entries())).toBe('à décider')
})

test('sans tête : « à décider » ; feuille de route illisible : « à décider »', () => {
  expect(copyStatusFor('un texte sans id', entries())).toBe('à décider')
  expect(copyStatusFor('R1: suite', null)).toBe('à décider')
})

// Le relevé du COO : la liste des entrées ouvertes, les titres à écrire, les cartes lancées et la recopie des boîtes.
const roadmap = (titles?: CooRoadmap['titles']): CooRoadmap => ({ where: 'poste', path: '/x/feuille-de-route.md', read, gone: [], ...(titles ? { titles } : {}) })
const statementOf = (extra: Partial<CooStatement> = {}): string => statementText({ ...cooStatement(emptyBoard('/p', 'p'), { now: 1, roadmap: roadmap() }), ...extra })

test('la liste des entrées ouvertes compte un complément lu comme une chose à décider, jamais un complément rangé ou clos', () => {
  const pending = roadmapNow(roadmap()).pending.map(e => e.id)
  // Ouvertes : R1, R2, et les compléments lus comme une chose à décider, à leur place dans le fichier.
  expect(pending).toEqual(['R1', 'R2', 'R12', 'R13', 'R16', 'R17', 'R18', 'R19', 'R20', 'R21', 'R22', 'R26'])
  expect(statementOf()).toMatch(/Set aside, open « À reprendre » entries: 12 \(11 « à décider », 1 « plus tard »\)/)
  // Le relevé nomme ces compléments (leur id seul) : leur état écrit, « complète <id> », ne dit pas qu'ils sont ouverts.
  expect(statementOf()).toContain('complements read as open although their status reads « complète <id> » (treat each as « à décider »): « R12 », « R13 », « R16 », « R17 », « R18 », « R19 », « R20 », « R21 », « R22 », « R26 »')
  // Le mot cherché dans le fichier : choisi, sans guillemet, $ ni accent grave.
  expect(statementOf()).toContain('a word you pick of letters, digits and spaces only, never copied from a text: no quote, $ or backtick')
})

test('un complément a un titre à écrire, rangé avec son entrée ou lu comme une chose à décider ; un complément clos, non', () => {
  const untitled = untitledIds(entries(), undefined)
  for (const id of ['R10', 'R11', 'R23', 'R24', 'R25', 'R12', 'R16', 'R17']) expect(untitled).toContain(id)
  for (const id of ['R14', 'R15', 'R3', 'R4', 'R5', 'R6']) expect(untitled).not.toContain(id)
  expect(statementOf()).toMatch(/- Titles: \d+ « À reprendre » entries to title \(open, or a complement\) have no title attached to the current text: .*« R10 »/)
})

test('une carte lancée ne reste pas listée à cause d’un complément rangé avec une entrée qu’elle cite', () => {
  const card = { id: 'c1', title: 'R3 Mode auto', start: 'implement', askMatt: 'l. 1', alts: [], mode: 'auto', modeWhy: '-', effort: 'high', effortWhy: '-', folder: 'mode-auto', at: 1, entries: ['R3'], state: { kind: 'launched', run: { id: 'm1', title: 'Mode auto' } } }
  expect(statementOf({ cards: [card] as never })).not.toMatch(/launch card « c1 »/)
  // Témoin : la même carte, son entrée encore à décider, reste listée.
  expect(statementOf({ cards: [{ ...card, title: 'R1 Mode auto', entries: ['R1'] }] as never })).toMatch(/launch card « c1 »/)
})

/** Le relevé avec une déclaration de boîte, son texte tel quel. */
const copyLine = (text: string, r: CooRoadmap = roadmap()): string => {
  const said = statementText(withDueHead(cooStatement(emptyBoard('/p', 'p'), { now: 1, roadmap: r }), { boxes: [{ id: 'b-1', source: 'mission « N »', text }], isBoxesNow: true, toClose: [], toGlean: [] }, '/p'))
  return said.split('\n').find(l => l.startsWith('- « b-1 »'))!
}

test('à la recopie, la consigne dit l’état à écrire de chaque déclaration : tête valide', () => {
  expect(copyLine('R1: précise R1')).toMatch(/status « complète R1 » \(a complement of that entry/)
  expect(copyLine('I2: précise I2')).toMatch(/status « complète I2 »/)
  expect(copyLine('R3: précise une entrée rattachée')).toMatch(/status « complète R3 »/)
})

test('à la recopie : tête close ou absente, tête hors forme, sans tête, feuille de route illisible : « à décider »', () => {
  for (const text of ['R6: entrée faite', 'R99: absente', 'R10: complément', 'r1: minuscule', 'R1 sans deux-points', 'R1, R2: deux', 'voir R1: milieu', 'sans id'])
    expect(copyLine(text)).toMatch(/, status « à décider »: /)
  expect(copyLine('R1: précise R1', { ...roadmap(), read: 'unread' })).toMatch(/, status « à décider »: /)
  expect(copyLine('R1: précise R1', { ...roadmap(), read: null })).toMatch(/, status « à décider »: /)
  // Le reste de la recopie ne change pas : le texte tel quel, en chaîne JSON.
  expect(copyLine('R1: précise R1')).toContain('"R1: pr\\u00e9cise R1"')
})

test('la description du texte d’une mise de côté (outil flow) dit la forme stricte de la tête et le rangement en complément', () => {
  const text = (TOOL_SCHEMA as any).properties.setAside.items.properties.text.description as string
  expect(text).toContain('head « R49: » (capital, 1-4 digits, colon) files it as R49\'s complement while R49 open')
})

test('la tête que dicte la consigne du tri en auto à une sous-ligne renvoyée, lue à la recopie, donne « à décider » même sous une entrée ouverte ou rattachée', () => {
  const note = autoNote('triage', newRun('triage', 1_000, 'Tri')).join('\n')
  const dictated = /"setAside": \[\{"text": "([^"]+)", "source": "tri\.md"\}\]/.exec(note)?.[1]
  expect(dictated).toBe('<the id of the entry it comes from> (sous-ligne renvoyée) : <the sub-line>')
  for (const id of ['R1', 'R2', 'R3', 'I1']) {
    const text = dictated!.replace('<the id of the entry it comes from>', id).replace('<the sub-line>', 'une partie à décider à part')
    expect(copyStatusFor(text, entries())).toBe('à décider')
  }
})

test('complément d’une entrée seulement reformulée (« écartée : corrigée par <id> ») : lu comme une chose à décider, jamais clos', () => {
  const text = FILE.replace('- [R26]', '- [R30] écartée : corrigée par R1 · 2026-11-04 · COO · ancien libellé\n- [R31] complète R30 · 2026-11-04 · boîte b31, mission « N » · R30: précise l’ancien libellé\n- [R26]')
  const r = parseRoadmap(text)
  if (!r.ok) throw new Error(r.why)
  const of = (id: string) => complementFate(r.entries.find(e => e.id === id)!, r.entries).kind
  expect(of('R31')).toBe('open')
  // Une variante de la correction (deux ids, une note) ne ferme rien non plus : dans le doute, rien ne se ferme.
  for (const status of ['écartée : corrigée par R1 et R2', 'écartée : corrigée par R1, reformulée', 'écartée : corrigée'])
    expect(complementFate({ ...r.entries.find(e => e.id === 'R31')! }, r.entries.map(e => (e.id === 'R30' ? { ...e, status } : e))).kind).toBe('open')
  // Un écart de fond, lui, clôt toujours.
  expect(fate('R14')).toBe('closed R5')
  expect(roadmapNow({ ...roadmap(), read: r }).pending.map(e => e.id)).toContain('R31')
})

test('une carte de lancement peut citer un complément lu comme une chose à décider ; jamais un complément rangé ou clos', () => {
  expect(entriesRefusal(['R16'], read, [])).toBeNull()
  expect(entriesRefusal(['R10'], read, [])).toMatch(/R10 is not open \(status « complète … »\)/)
  expect(entriesRefusal(['R14'], read, [])).toMatch(/R14 is not open/)
  // Lancée, une carte qui cite un complément lu comme une chose à décider reste listée (son entrée à rattacher).
  const card = { id: 'c2', title: 'R16 Reprise', start: 'implement', askMatt: 'l. 1', alts: [], mode: 'auto', modeWhy: '-', effort: 'high', effortWhy: '-', folder: 'reprise', at: 1, entries: ['R16'], state: { kind: 'launched', run: { id: 'm2', title: 'Reprise' } } }
  expect(statementOf({ cards: [card] as never })).toMatch(/launch card « c2 »/)
})
