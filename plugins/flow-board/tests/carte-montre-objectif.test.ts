import { expect, test } from 'claude-code/testing'

import { cooStatement, statementText } from '../hooks/coo.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { parseCard, soundCard, type LaunchCard } from '../hooks/launch.ts'
import { emptyBoard } from '../hooks/model.ts'

// Ce qu'une carte de lancement montre dans la vue Coordination : son numéro court, son titre, son départ, son objectif
// et ses boutons ; ni les raisons (ask-matt, mode, effort), ni l'effort, ni le dossier. Les raisons restent seulement
// gardées dans la carte ; le relevé du COO dit toujours son mode, son effort et son dossier.

const NOW = 960_000_000
const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19 : une idée floue', alts: ['to-spec'], mode: 'manual', modeWhy: 'cadrage suivi', effort: 'high', effortWhy: 'cadrage long', folder: 'export-csv', goal: 'Exporter les tickets\u0007 en CSV pour les relire dans un tableur.' }

const card = (over: Record<string, unknown> = {}, id = 'kcartea01'): LaunchCard => {
  const parsed = parseCard({ ...CARD, ...over }, NOW, id)
  if ('refused' in parsed) throw new Error(parsed.refused)
  return parsed.card
}
const rows = (cards: LaunchCard[], quota?: string) => coordinationRows({ ...cooStatement(emptyBoard('', 'p'), { now: NOW, cards }), ...(quota ? { quota } : {}) }, { page: 'overview' })
const textOf = (r: { parts: { text: string }[] } | undefined): string => (r?.parts ?? []).map(p => p.text).join(' ')

test('la ligne d’une carte porte son titre et son départ, sans le mode, l’effort ni le dossier ; sous elle, son objectif, neutralisé, en couleur ordinaire', () => {
  const all = rows([card()])
  const line = all.find(r => r.key === 'coo-card-kcartea01')
  expect(textOf(line)).toContain('Export CSV des tickets')
  expect(textOf(line)).toContain('/grill-with-docs')
  for (const gone of ['manuel', 'high', 'travail/', 'export-csv']) expect(textOf(line)).not.toContain(gone)
  const goal = all.find(r => r.key === 'coo-card-goal-kcartea01')
  expect(goal?.parts).toHaveLength(1)
  expect(goal?.parts[0]!.text).not.toContain('\u0007')
  expect(goal?.parts[0]!.text).toContain('Exporter les tickets')
  expect(goal?.parts[0]).not.toHaveProperty('dim')
  expect(goal?.parts[0]).not.toHaveProperty('color')
  expect(goal?.isPart).toBe(true)
  // Les raisons ne sont plus montrées nulle part.
  const shown = all.map(textOf).join('\n')
  for (const gone of ['ask-matt', 'une idée floue', 'cadrage suivi', 'cadrage long']) expect(shown).not.toContain(gone)
})

test('une carte d’avant, sans objectif, montre son titre et ses boutons seuls', () => {
  const { goal: _, ...before } = CARD
  const old = soundCard({ ...before, id: 'kancien01', at: NOW })!
  const all = rows([old])
  expect(all.find(r => r.key === 'coo-card-kancien01')?.actions?.map(a => a.key)).toEqual(['coo-card-manual-kancien01', 'coo-card-auto-kancien01', 'coo-card-alt-kancien01-to-spec', 'coo-card-remove-kancien01'])
  expect(all.filter(r => r.key.startsWith('coo-card-') && r.key.endsWith('kancien01')).map(r => r.key)).toEqual(['coo-card-kancien01'])
})

test('les boutons ne changent pas : un seul lancement en xhigh, la ligne du quota sous elle ; « lancement en cours » reste sur la ligne', () => {
  const x = rows([card({ effort: 'xhigh' })], '42 % de la limite de 5 h')
  expect(x.find(r => r.key === 'coo-card-kcartea01')?.actions?.map(a => a.key)).toEqual(['coo-card-manual-kcartea01', 'coo-card-alt-kcartea01-to-spec', 'coo-card-remove-kcartea01'])
  expect(x.find(r => r.key === 'coo-card-manual-kcartea01')).toBeUndefined()
  expect(x.find(r => r.key === 'coo-card-kcartea01')?.actions?.[0]?.isPrimary).toBe(true)
  expect(x.map(r => r.key)).toContain('coo-card-quota-kcartea01')
  const launching = rows([{ ...card(), launch: { id: 'labcdefgh12', at: NOW - 1000, mode: 'auto' } }])
  expect(textOf(launching.find(r => r.key === 'coo-card-kcartea01'))).toContain('lancement en cours (auto)')
  expect(launching.map(r => r.key)).toContain('coo-card-goal-kcartea01')
})

test('le relevé que lit le Claude du COO ne change pas : le mode, l’effort et le dossier y restent, et l’objectif n’y entre pas', () => {
  const said = (c: LaunchCard) => statementText(cooStatement(emptyBoard('', 'p'), { now: NOW, cards: [c] }))
  const { goal: _, ...before } = CARD
  const withGoal = said(card())
  expect(withGoal).toBe(said(soundCard({ ...before, id: 'kcartea01', at: NOW })!))
  expect(withGoal).toContain('« kcartea01 » « Export CSV des tickets »: start /grill-with-docs, mode manual, effort high, folder travail/export-csv/, ready.')
  expect(withGoal).not.toContain('Exporter les tickets')
})
