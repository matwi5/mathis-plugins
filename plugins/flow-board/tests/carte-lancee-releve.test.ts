import { expect, test } from 'claude-code/testing'

import { cooStatement, statementText } from '../hooks/coo.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { parseCard, type LaunchCard } from '../hooks/launch.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { parseRoadmap } from '../hooks/roadmap.ts'

// Une carte lancée n'est plus montrée dans la vue, et quitte le relevé du COO une fois son idée passée : décisions
// « la carte lancée est gardée, ne compte nulle part, n'est plus montrée, et quitte le relevé du COO une fois son idée
// passée à « devenue mission » », et « l'en-tête « Au départ · N » ne compte que les cartes montrées » ; le relevé la
// garde tant que son idée est encore ouverte dans la feuille de route relue, ou que la feuille de route ne se lit pas ;
// une chose « À reprendre » encore ouverte que la carte cite par son titre la garde aussi, pour que le COO la rattache à
// la mission (décision « carte lancée qui cite une chose À reprendre », option retenue par la personne), avec une ligne qui
// la nomme et renvoie à la consigne « Les choses à reprendre de la mission » (décision « les entrées d'une carte comptent
// partout où comptaient son idée et les ids de son titre »), sans rappel « devenue mission ».

const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', alts: [], mode: 'manual', modeWhy: '', effort: 'high', effortWhy: '', folder: 'export-csv', goal: 'Objectif de test.' }
const card = (over: Record<string, unknown> = {}, id = 'klancee0001'): LaunchCard => (parseCard({ ...CARD, ...over }, 1, id) as { card: LaunchCard }).card
const RUN = { ...newRun('grill-with-docs', 2, 'Export CSV'), launch: { id: 'labcdefgh12', card: 'klancee0001', at: 1, folder: 'export-csv', start: 'grill-with-docs', mode: 'manual' as const } }

const roadmapWith = (line: string) => ({ where: 'poste' as const, path: '/p/feuille.md', read: parseRoadmap(`# Feuille de route\n\n## Jalons\n## Prochaines étapes\n## Idées\n${line}\n## À reprendre\n`), gone: [] })
const OPEN = roadmapWith('- [I1] à lancer · 2026-11-02 · Mathis · exporter les tickets en CSV')
const LATER = roadmapWith('- [I1] plus tard · 2026-11-02 · Mathis · exporter les tickets en CSV')
const PASSED = roadmapWith('- [I1] devenue mission Export CSV · 2026-11-02 · Mathis · exporter les tickets en CSV')
const ABSENT = roadmapWith('- [I2] à lancer · 2026-11-02 · Mathis · une autre idée')
const UNREAD = { where: 'poste' as const, path: '/p/feuille.md', read: 'unread' as const, gone: [] }

const said = (roadmap: unknown, cards: LaunchCard[]): string => statementText(cooStatement({ ...emptyBoard('', 'p'), runs: [RUN] }, { now: 3, roadmap: roadmap as any, cards }))
const LISTED = /launch card « klancee0001 » « Export CSV des tickets »: .*launched as mission « Export CSV »/
const REMINDER = /The idea « I1 » of the roadmap became this mission/

test('le relevé liste une carte lancée, avec sa mission et le rappel « devenue mission », tant que son idée est « à lancer » ou « plus tard »', () => {
  for (const r of [OPEN, LATER]) {
    const text = said(r, [card({ idea: 'I1' })])
    expect(text).toMatch(LISTED)
    expect(text).toMatch(REMINDER)
  }
  // Une idée citée par le seul titre a aussi son rappel : sans lui, la carte resterait au relevé sans fin.
  expect(said(OPEN, [card({ title: 'Export CSV des tickets I1' })])).toMatch(REMINDER)
})

test('la feuille de route ne se lit pas : la carte lancée reste listée, sans le rappel', () => {
  for (const r of [UNREAD, { ...UNREAD, read: null }, undefined]) {
    const text = said(r, [card({ idea: 'I1' })])
    expect(text).toMatch(LISTED)
    expect(text).not.toMatch(REMINDER)
  }
})

test('la feuille relue montre l’idée passée ou absente, ou la carte n’a pas d’idée : la carte lancée n’est plus listée ; une carte prête l’est toujours', () => {
  expect(said(PASSED, [card({ idea: 'I1' })])).not.toMatch(/launch card « klancee0001 »/)
  expect(said(ABSENT, [card({ idea: 'I1' })])).not.toMatch(/launch card « klancee0001 »/)
  for (const r of [OPEN, UNREAD]) expect(said(r, [card()])).not.toMatch(/launch card « klancee0001 »/)
  // Une carte prête, sans idée, sur un autre dossier : listée comme avant.
  expect(said(PASSED, [card({ idea: 'I1' }), card({ title: 'Autre carte', folder: 'autre' }, 'kprete00001')])).toMatch(/launch card « kprete00001 » « Autre carte »: .*ready/)
})

test('une carte lancée du bouton « Lancer » d’une chose « À reprendre » (son id dans le titre) reste listée, sans rappel « devenue mission » mais avec le renvoi à la consigne qui la rattache, tant que l’entrée est ouverte', () => {
  const pending = (status: string) => ({ where: 'poste' as const, path: '/p/feuille.md', read: parseRoadmap(`# Feuille de route\n\n## Jalons\n## Prochaines étapes\n## Idées\n## À reprendre\n- [R49] ${status} · 2026-11-02 · Mathis · exporter en CSV\n`), gone: [] })
  const r49 = card({ title: 'R49 Export CSV des tickets' })
  const listed = /launch card « klancee0001 » « R49 Export CSV des tickets »: .*launched as mission « Export CSV »/
  for (const status of ['à décider', 'plus tard']) {
    const text = said(pending(status), [r49])
    expect(text).toMatch(listed)
    expect(text).not.toMatch(/became this mission/)
    expect(text).toMatch(/The things to pick up R49 that this card cites are still open: follow « Les choses à reprendre de la mission »/)
  }
  for (const status of ['rattachée à Export CSV', 'écartée : doublon']) expect(said(pending(status), [r49])).not.toMatch(/launch card « klancee0001 »/)
})

test('la vue ne montre pas la carte lancée, et l’en-tête « Au départ · N » ne compte que les cartes montrées, à 0 sans elles', () => {
  const rows = (cards: LaunchCard[]) => coordinationRows(cooStatement({ ...emptyBoard('', 'p'), runs: [RUN] }, { now: 3, roadmap: OPEN, cards }), { page: 'overview' })
  const only = rows([card({ idea: 'I1' })])
  expect(only.some(r => r.key.startsWith('coo-card-'))).toBe(false)
  // La ligne « Au départ » paraît toujours, à 0 sans carte montrée (décision du bouton « ✦ Proposer les missions »).
  expect(only.find(r => r.key === 'coo-cards')?.parts.map(p => p.text).join('')).toBe('Au départ · 0')
  const two = rows([card({ idea: 'I1' }), card({ title: 'Autre carte', folder: 'autre' }, 'kprete00001'), card({ title: 'Troisième', folder: 'troisieme' }, 'kprete00002')])
  expect(two.find(r => r.key === 'coo-cards')?.parts.map(p => p.text).join('')).toBe('Au départ · 2')
  expect(two.some(r => r.key === 'coo-card-goal-kprete00001')).toBe(true)
  expect(two.some(r => r.key === 'coo-card-goal-klancee0001')).toBe(false)
})
