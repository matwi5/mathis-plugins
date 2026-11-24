import { expect, test } from 'claude-code/testing'

import { coordinationRows } from '../hooks/coo-view.tsx'
import { OVERVIEW_KEYS, keysOf, loadedStatement } from './vue-chargee.ts'

// La page « Vue d'ensemble » remplace « À faire » et « Missions » : elle montre leurs lignes à la suite, dans leur
// ordre, avec les mêmes clés et les mêmes boutons, sans en perdre aucune.

test('sur un relevé chargé, la page montre toutes les choses qu’il porte : les clés figées de la vue chargée', () => {
  const s = loadedStatement()
  const keys = keysOf(coordinationRows(s, { page: 'overview' }))
  // Chacune une fois, quel que soit son rang : les rectangles remontent le plan et la vague dans le bloc « Projet ».
  expect([...keys].sort()).toEqual([...OVERVIEW_KEYS].sort())
  // Le relevé chargé porte bien chaque chose qu'il annonce (sinon la liste figée ne prouverait rien).
  for (const k of ['coo-point', 'coo-night', 'coo-project', 'coo-where-ask', 'coo-missions', 'coo-cards', 'coo-deliver', 'coo-report-validate-mreport01', 'coo-card-quota-kcarte002', 'coo-card-goal-kr0lgij9l9', 'coo-waiting-0', 'coo-force-mmanu0001~A~mheld0001~A~file']) expect(keys, k).toContain(k)
  expect(keys.filter(k => k.startsWith('coo-card-') && /kcarte00[1-4]$/.test(k)).length).toBeGreaterThan(4)
})

test('la page porte les lignes de la page « À faire » d’avant puis celles de « Missions », dans le même ordre : aucune clé perdue, aucune ajoutée hors des pastilles', () => {
  const s = loadedStatement()
  const rows = coordinationRows(s, { page: 'overview' }).slice(1)
  const point = rows.findIndex(r => r.key === 'coo-point')
  const missions = rows.findIndex(r => r.key === 'coo-missions')
  const cards = rows.findIndex(r => r.key === 'coo-cards')
  expect(point).toBe(0)
  expect(missions).toBeGreaterThan(point)
  expect(cards).toBeGreaterThan(missions)
  // Ce que portait « À faire » vient tout entier avant le premier en-tête de « Missions ».
  for (const k of ['coo-project', 'coo-gone', 'coo-where-ask', 'coo-deliver']) expect(rows.findIndex(r => r.key === k || (r.actions ?? []).some(a => a.key === k)), k).toBeLessThan(missions)
})
