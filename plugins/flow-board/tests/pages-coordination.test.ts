// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).


import { expect, mock, test } from 'claude-code/testing'

import { cooStatement, type CooRoadmap, type CooStatement } from '../hooks/coo.ts'
import { coordinationRows, type CooRow } from '../hooks/coo-view.tsx'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { parseRoadmap } from '../hooks/roadmap.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, openCoo, start, world, writeBoard } from './monde-coordination.ts'

// Les pages de la vue Coordination : une rangée de pastilles,
// chacune avec son compte, choisit une des six pages ; seule la page choisie est décrite ; « À faire » par défaut.

const NOW = 610_000_000
const ROADMAP_TEXT = `# Feuille de route

## Jalons
- [J1] en cours · 2026-11-02 · Alex · Le but du jalon — fin : son critère de fin
## Prochaines étapes
- [E1] à faire · 2026-11-02 · COO · L'étape
## Idées
- [I1] à lancer · 2026-11-02 · Alex · une idée
- [I2] plus tard · 2026-11-02 · Alex · une autre idée
## À reprendre
- [R1] à décider · 2026-11-02 · mission « Titre », compte rendu · une chose à reprendre
- [R2] plus tard · 2026-11-03 · mission « Titre », compte rendu · une autre chose
`
const roadmap = (over: Partial<CooRoadmap> = {}): CooRoadmap => ({ where: 'poste', path: '/x/feuille-de-route.md', read: parseRoadmap(ROADMAP_TEXT), gone: [], ...over })
const mission = (title: string): Run => ({ ...newRun('implement', NOW - 60_000, title), status: 'active', owner: 'session-B', updatedAt: NOW - 1_000 }) as Run
const statement = (over: Partial<CooStatement> = {}): CooStatement => ({ ...cooStatement({ ...emptyBoard('', 'p'), runs: [mission('Mission un')] }, { now: NOW, roadmap: roadmap() }), ...over })
const keys = (rows: readonly CooRow[]): string[] => rows.map(r => r.key)
const textOf = (r: CooRow | undefined): string => (r?.parts ?? []).map(p => p.text.replace(/\u00a0/g, ' ')).join(' ')

const PAGES = ['todo', 'missions', 'ideas', 'pending', 'pistes', 'settings'] as const

test('la rangée des pastilles vient en tête, les six pages dans l’ordre ; une page absente ou inconnue vaut « À faire »', () => {
  for (const shown of [{}, { page: 'inconnue' }, { page: 'todo' }]) {
    const rows = coordinationRows(statement(), shown)
    expect(rows[0]!.kind).toBe('pills')
    expect(rows[0]!.pills!.map(p => [p.page, p.name])).toEqual([
      ['todo', 'À faire'],
      ['missions', 'Missions'],
      ['ideas', 'Idées'],
      ['pending', 'À reprendre'],
      ['pistes', 'Pistes'],
      ['settings', 'Réglages'],
    ])
    expect(rows[0]!.pills!.filter(p => p.isCurrent).map(p => p.page)).toEqual(['todo'])
    expect(rows[1]!.key).toBe('coo-point')
  }
})

test('chaque section est sur sa page, et seulement sur elle', () => {
  const where: Record<string, (typeof PAGES)[number]> = {
    'coo-point': 'todo',
    'coo-night': 'todo',
    'coo-waits': 'todo',
    'coo-missions': 'missions',
    'coo-roadmap': 'ideas',
    'coo-milestone-J1': 'ideas',
    'coo-step-E1': 'ideas',
    'coo-ideas': 'ideas',
    'coo-idea-I1': 'ideas',
    'coo-pendings': 'pending',
    'coo-pending-R1': 'pending',
    'coo-later': 'pending',
    'coo-security-line': 'settings',
  }
  for (const page of PAGES) {
    const shown = keys(coordinationRows(statement(), { page }))
    for (const [key, home] of Object.entries(where)) expect(shown.includes(key), `${key} sur ${page}`).toBe(home === page)
  }
  // L'en-tête commun « Idées · À reprendre » devient deux en-têtes, chacun sur sa page.
  expect(textOf(coordinationRows(statement(), { page: 'ideas' }).find(r => r.key === 'coo-ideas'))).toBe('Idées · 2')
  expect(textOf(coordinationRows(statement(), { page: 'pending' }).find(r => r.key === 'coo-pendings'))).toBe('À reprendre · 1')
})

test('les alertes et le premier choix d’endroit sont sur « À faire », sous un bloc « Alertes » ; rien sur les autres pages', () => {
  const s = statement({ roadmap: roadmap({ where: 'unasked', gone: [{ id: 'I9', line: '- [I9] à lancer · 2026-11-01 · Alex · partie' } as any] }) })
  const todo = coordinationRows(s, { page: 'todo' })
  const heading = todo.findIndex(r => r.key === 'coo-alerts')
  expect(textOf(todo[heading])).toBe('Alertes')
  expect(todo.findIndex(r => r.key === 'coo-gone')).toBeGreaterThan(heading)
  expect(keys(todo)).toContain('coo-where-ask')
  for (const page of PAGES.filter(p => p !== 'todo')) expect(keys(coordinationRows(s, { page })).filter(k => k === 'coo-alerts' || k.startsWith('coo-gone') || k.startsWith('coo-where'))).toEqual([])
  // Sans alerte, pas de bloc.
  expect(keys(coordinationRows(statement(), { page: 'todo' }))).not.toContain('coo-alerts')
})

test('une page sans rien à montrer dit « Rien pour l’instant. » sur une ligne atténuée', () => {
  const s = statement({ roadmap: undefined })
  for (const page of ['ideas', 'pending', 'pistes'] as const) {
    const rows = coordinationRows(s, { page })
    expect(rows.length).toBe(2)
    expect(rows[1]!.parts).toEqual([{ text: 'Rien pour l’instant.', dim: true }])
  }
})

test('les comptes des pastilles : ce qui t’attend (ambre au-dessus de zéro), missions, idées ouvertes, entrées à décider et rattachées, pistes pas encore validées, aucun pour Réglages', () => {
  const pistesWaiting = { rows: [], more: 0, closed: 0, ticked: 0, print: 'w', pending: 3 }
  const pills = (s: CooStatement) => Object.fromEntries(coordinationRows(s)[0]!.pills!.map(p => [p.page, [p.count, p.isAmber]]))
  // « À reprendre » compte comme l'en-tête de sa page : R1 « à décider » ; R2 « plus tard » est dans son propre bloc.
  expect(pills(statement({ pistesWaiting }))).toEqual({ todo: [0, false], missions: [1, false], ideas: [2, false], pending: [1, false], pistes: [3, false], settings: [undefined, false] })
  const waits = [{ id: 'q1', text: 'Une question', mission: 'Mission un', missionId: 'm', print: 'p', at: null }] as any
  expect(pills(statement({ waits })).todo).toEqual([1, true])
})

test('un compte dont la source ne se lit pas est « non mesuré » (null, montré « — »), jamais 0 : feuille de route illisible ou hors format, liste d’attente illisible', () => {
  const counts = (s: CooStatement) => Object.fromEntries(coordinationRows(s)[0]!.pills!.map(p => [p.page, p.count]))
  for (const read of ['unread' as const, { ok: false as const, lineNo: 3, why: 'statut inconnu' }]) {
    const c = counts(statement({ roadmap: roadmap({ read: read as any }) }))
    expect([c.ideas, c.pending]).toEqual([null, null])
  }
  // Pas encore de feuille de route : rien à compter, 0.
  expect(counts(statement({ roadmap: roadmap({ read: null }) })).ideas).toBe(0)
  expect(counts(statement({ waitlist: { state: 'unread', pistes: [], refused: [], boxesUnread: [] } } as any)).pistes).toBeNull()
  expect(counts(statement({ waitlist: { state: 'read', pistes: [], refused: [], boxesUnread: [] } } as any)).pistes).toBe(0)
  // Une liste relue qui a perdu des pistes déjà vues n'est pas montrée : son compte non plus.
  expect(counts(statement({ waitlist: { state: 'missing', pistes: [], refused: [], boxesUnread: [] } } as any)).pistes).toBeNull()
})

test('la pastille « Pistes » compte aussi les pistes à cocher d’une rétro lancée par le COO, pas celles d’une sélection déjà envoyée', () => {
  const count = (s: CooStatement) => coordinationRows(s)[0]!.pills!.find(p => p.page === 'pistes')!.count
  const item = (id: string) => ({ id, label: `piste ${id}`, isTicked: false })
  const retroPicks = [
    { retro: 'r1', title: 'Rétro un', items: [item('1'), item('2')], taken: [], print: 'p1' },
    { retro: 'r2', title: 'Rétro deux', items: [item('1')], taken: [], print: 'p2', isSent: true },
  ]
  expect(count(statement({ retroPicks } as any))).toBe(2)
  expect(count(statement({ retroPicks, pistesWaiting: { rows: [], more: 0, closed: 0, ticked: 0, print: 'w', pending: 3 } } as any))).toBe(5)
})
test('la pastille « À reprendre » et l’en-tête de sa page donnent le même nombre : les « à décider » et les rattachées, pas les « plus tard »', () => {
  const text = `# Feuille de route\n\n## Jalons\n## Prochaines étapes\n## Idées\n## À reprendre\n- [R1] à décider · 2026-11-02 · boîte a1, ticket 1 · une\n- [R2] plus tard · 2026-11-03 · boîte a1, ticket 2 · deux\n- [R3] rattachée à Mission un · 2026-11-04 · boîte a1, ticket 3 · trois\n- [R4] à décider · 2026-11-05 · boîte a1, ticket 4 · quatre\n- [R5] plus tard · 2026-11-06 · boîte a1, ticket 5 · cinq\n`
  const s = statement({ roadmap: roadmap({ read: parseRoadmap(text) }) })
  const rows = coordinationRows(s, { page: 'pending' })
  expect(rows[0]!.pills!.find(p => p.page === 'pending')!.count).toBe(3)
  expect(textOf(rows.find(r => r.key === 'coo-pendings'))).toBe('À reprendre · 3')
  expect(textOf(rows.find(r => r.key === 'coo-later'))).toBe('Plus tard · 2')
})

test('une feuille de route illisible ou hors format : les pages « Idées » et « À reprendre » renvoient à l’alerte de « À faire », au lieu de « Rien pour l’instant. »', () => {
  for (const read of ['unread' as const, { ok: false as const, lineNo: 3, why: 'statut inconnu' }]) {
    const s = statement({ roadmap: roadmap({ read: read as any }) })
    for (const page of ['ideas', 'pending'] as const) {
      const rows = coordinationRows(s, { page })
      expect(rows.slice(1).map(r => r.parts)).toEqual([[{ text: 'Feuille de route illisible : voir l\'alerte sur « À faire »', dim: true }]])
    }
  }
})

// ─── Le panneau monté ─────────────────────────────────────────────────────

const seeded = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: [mission('Mission un')] }))
  await start($)
  await openCoo($, clock)
  return { clock, w }
}

test('le panneau s’ouvre sur « À faire » ; un clic de pastille change la page, même pendant un tour de Claude, et elle reste au nouveau dessin', { timeoutMs: 20000 }, async ($, on) => {
  await seeded($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await pane.find({ type: 'Text', text: /^Le point$/ }), surface).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Missions · 1$/ }), surface).toBeUndefined()
    await pane.unmount()
  }
  // Claude travaille : le geste d'affichage passe quand même.
  await $.turn.start({ turnId: 't1', text: 'un tour' } as any)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-page-missions' })
  await pane.unmount()
  for (const surface of ['terminal', 'desktop'] as const) {
    const again = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await again.find({ type: 'Text', text: /^Missions · 1$/ }), surface).toBeDefined()
    expect(await again.find({ type: 'Text', text: /^Le point$/ }), surface).toBeUndefined()
    expect(String((await again.find({ key: 'coo-page-missions' }))?.props.label).replace(/\u00a0/g, ' ')).toMatch(/^▸ Missions · 1$/)
    expect((await again.find({ key: 'coo-page-todo' }))?.props.dimColor).toBe(true)
    await again.unmount()
  }
})
