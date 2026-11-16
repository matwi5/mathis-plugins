// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { cooStatement, type CooStatement } from '../hooks/coo.ts'
import { coordinationRows, type CooAction, type CooRow } from '../hooks/coo-view.tsx'
import { emptyBoard, newRun } from '../hooks/model.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, openCoo, start, world, writeBoard } from './monde-coordination.ts'

// Les boutons de la vue Coordination : encadrés (le bouton ordinaire du moteur), sur leur propre rangée sous leur
// élément, celui qu'on attend de la personne coloré ; seules les pastilles et les cases à cocher restent en texte simple ;
// une ligne vide avant chaque élément (planche A).

const NOW = 620_000_000

const autoMission = (): Run =>
  ({
    ...newRun('implement', NOW - 60_000, 'Mission en auto'),
    status: 'active',
    owner: 'session-M',
    updatedAt: NOW - 1_000,
    auto: { onAt: NOW - 30_000, onBy: 'session-M' },
    waiting: [{ id: 'q3', blocks: { phase: 'implement' }, text: 'Garder le refus ?', at: NOW - 10_000 }],
  }) as unknown as Run
const manualMission = (): Run => ({ ...newRun('implement', NOW - 60_000, 'Mission en manuel'), status: 'active', owner: 'session-B', updatedAt: NOW - 1_000 }) as Run

const all = (rows: readonly CooRow[]): CooAction[] => rows.flatMap(r => r.actions ?? [])
const action = (rows: readonly CooRow[], key: string): CooAction | undefined => all(rows).find(a => a.key === key)
const base = (): CooStatement => cooStatement(emptyBoard('', 'p'), { now: NOW })

test('le bouton principal de chaque cas, au plus un par élément ; les autres boutons encadrés ; les cases à cocher en texte simple, « ☑ Tout cocher » encadré', () => {
  const report = { missionId: 'm1', mission: 'Mission un', print: 'p1', text: 'ligne', isOpen: true, isMissionOpen: true, state: 'ready' as const }
  const delivery = { state: 'ready' as const, missions: ['Mission un'], commits: [], waitFor: [], waitCommits: [], key: 'k1', isArmed: false }
  const todo = coordinationRows({ ...base(), reports: [report], delivery } as CooStatement)
  expect(action(todo, 'coo-report-validate-m1')?.isPrimary).toBe(true)
  expect(action(todo, 'coo-report-redo-m1')).toBeDefined()
  expect(action(todo, 'coo-report-redo-m1')?.isPrimary).toBeUndefined()
  expect(action(todo, 'coo-deliver')?.isPrimary).toBe(true)
  const card = (mode: 'auto' | 'manual') => ({ id: 'kcarte001', title: 'Export', start: 'grill-with-docs' as const, askMatt: 'l. 19', alts: ['to-spec' as const], mode, modeWhy: '', effort: 'high' as const, effortWhy: '', folder: 'export', at: 1 })
  for (const mode of ['auto', 'manual'] as const) {
    const rows = coordinationRows(cooStatement(emptyBoard('', 'p'), { now: 2, cards: [card(mode)] }), { page: 'missions' })
    const buttons = rows.find(r => r.key === 'coo-card-kcarte001')!.actions!
    expect(buttons.filter(b => b.isPrimary).map(b => b.key)).toEqual([`coo-card-${mode}-kcarte001`])
  }
  const pistesWaiting = { rows: [{ id: 'r/p1', state: 'pending' as const, stateText: 'pas encore validée', retro: 'R', files: [], text: 'une piste', file: '', isTickable: true, isTicked: false, texts: 0 }], more: 0, closed: 0, ticked: 0, print: 'w', pending: 1 }
  const retroPicks = [{ retro: 'retro1', title: 'Rétro', print: 'p', isSent: false, items: [{ id: '1', label: 'Une piste', isTicked: false }], taken: [] }]
  const pistes = coordinationRows({ ...base(), pistesWaiting, retroPicks } as CooStatement, { page: 'pistes' })
  expect(action(pistes, 'coo-piste-tick-r/p1')?.isPlain).toBe(true)
  expect(action(pistes, 'coo-retro-tick-retro1-1')?.isPlain).toBe(true)
  expect(action(pistes, 'coo-pistes-cut-go')?.isPrimary).toBe(true)
  expect(action(pistes, 'coo-retro-pick-retro1')?.isPrimary).toBe(true)
  const tickAll = action(pistes, 'coo-retro-all-retro1')
  expect(tickAll).toBeDefined()
  expect([tickAll?.isPlain, tickAll?.isPrimary]).toEqual([undefined, undefined])
  // « ▶ Lancer » d'une idée « à lancer », et « Confirmer » de la surveillance de nuit.
  const roadmap = { where: 'poste' as const, path: '/x/feuille-de-route.md', read: { ok: true as const, entries: [{ id: 'I1', section: 'Idées' as const, status: 'à lancer', date: '2026-11-02', source: 'Alex', text: 'une idée', line: '' }] }, gone: [] }
  const ideas = coordinationRows({ ...base(), roadmap } as CooStatement, { page: 'ideas' })
  expect(action(ideas, 'coo-idea-launch-I1')?.isPrimary).toBe(true)
  expect(action(ideas, 'coo-later-I1')).toBeDefined()
  expect(action(ideas, 'coo-later-I1')?.isPrimary).toBeUndefined()
  const night = coordinationRows({ ...base(), nightAsk: true } as CooStatement)
  expect(action(night, 'coo-night-confirm')?.isPrimary).toBe(true)
  expect(action(night, 'coo-night-cancel')).toBeDefined()
  expect(action(night, 'coo-night-cancel')?.isPrimary).toBeUndefined()
  // Au plus un bouton principal par élément, et rien d'autre que les cases en texte simple.
  for (const rows of [todo, pistes])
    for (const r of rows) {
      expect((r.actions ?? []).filter(a => a.isPrimary).length, r.key).toBeLessThanOrEqual(1)
      for (const a of r.actions ?? []) if (a.isPlain) expect(['☐', '☑'], a.key).toContain(a.label)
    }
})

test('dans le panneau : boutons encadrés sur leur rangée, « ✎ Répondre » et « Confirmer » colorés, une ligne vide avant chaque élément', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const auto = autoMission()
  const manual = manualMission()
  writeBoard(w, b => ({ ...b, runs: [auto, manual] }))
  await start($)
  await openCoo($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await pane.press({ key: 'coo-page-todo' })
    const answer = ((await pane.findAll({ type: 'Button' })) as any[]).find(b => /Répondre/.test(String(b.props.label)))
    expect(answer?.props.variant, surface).toBe('primary')
    expect(answer?.props.plain, surface).toBeUndefined()
    const night = await pane.find({ key: 'coo-night-ask' })
    expect(night, surface).toBeDefined()
    expect([night?.props.plain, night?.props.variant], surface).toEqual([undefined, undefined])
    // Les pastilles restent en texte simple.
    expect((await pane.find({ key: 'coo-page-missions' }))?.props.plain, surface).toBe(true)
    // Planche A : une ligne vide avant chaque élément et chaque en-tête ; le bouton de nuit suit le point, sans ligne vide.
    expect((await pane.find({ key: 'coo-point-1' }))?.props.marginTop, surface).toBe(1)
    expect((await pane.find({ key: 'coo-waits' }))?.props.marginTop, surface).toBe(1)
    expect((await pane.find({ key: 'coo-night' }))?.props.marginTop, surface).toBe(0)
    await pane.unmount()
  }
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-page-missions' })
  const on1 = await pane.find({ key: `coo-auto-on-${manual.id}` })
  expect([on1?.props.plain, on1?.props.variant]).toEqual([undefined, undefined])
  const cut = await pane.find({ key: `coo-cut-auto-${auto.id}` })
  expect(cut).toBeDefined()
  expect(cut?.props.plain).toBeUndefined()
  await pane.press({ key: `coo-auto-on-${manual.id}` })
  expect((await pane.find({ key: `coo-auto-confirm-${manual.id}` }))?.props.variant).toBe('primary')
  const cancel = await pane.find({ key: `coo-auto-cancel-${manual.id}` })
  expect(cancel).toBeDefined()
  expect(cancel?.props.variant).toBeUndefined()
  // La rangée des boutons est sous la ligne de la mission, dans son élément.
  expect(await pane.find({ key: `coo-mission-${manual.id}-acts` })).toBeDefined()
  await pane.unmount()
})
