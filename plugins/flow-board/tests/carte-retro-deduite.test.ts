// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { isRetroCardDue } from '../hooks/launch.ts'
import { archiveRun, emptyBoard, newRun } from '../hooks/model.ts'
import { retroCardId } from '../hooks/retro-coo.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, world, writeBoard } from './monde-coordination.ts'
import { findAllAny, findAny, pressAny } from './page-coo.ts'

// La carte de rétro vient de la clôture, plus de la seule livraison : à chaque relevé du siège, le COO pose celle de
// toute mission close, pas archivée, qui n'est pas une rétro et n'a pas de rétro, quand elle manque.

const T0 = 940_000_000
const MIN = 60_000

const texts = async (pane: any): Promise<string> => ((await findAllAny(pane, { type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')
const pane = (key: string) => ({ plugin: PLUGIN, surface: 'desktop' as const, ...PANE, key })

/** Une mission close sans livraison (finie, ou close chez le COO). */
const closed = (title: string, at = T0 - 10 * MIN): Run => ({ ...newRun('prototype', at, title), status: 'done', finishedAt: at + MIN, updatedAt: at + MIN })
/** Une rétro lancée par le COO sur la mission `of` (son lancement porte l'id de la mission étudiée). */
const retroOfMission = (of: string, status: Run['status'] = 'active'): Run => ({
  ...newRun('retro', T0 - 5 * MIN, `Rétrospective · ${of}`),
  status,
  launch: { id: 'labcdefgh1', card: retroCardId(of), at: T0 - 5 * MIN, folder: 'retro-x', start: 'retro', mode: 'auto', of },
}) as unknown as Run

test('isRetroCardDue : close, pas archivée, ni une rétro ni une mission qui a déjà la sienne', () => {
  const m = closed('Close')
  const runs = [m]
  expect(isRetroCardDue(m, runs)).toBe(true)
  expect(isRetroCardDue({ ...m, status: 'paused' }, runs)).toBe(false)
  expect(isRetroCardDue({ ...m, status: 'active' }, runs)).toBe(false)
  const board: Board = { ...emptyBoard('', 'p'), runs, activeId: null, session: 'coo' }
  expect(isRetroCardDue(archiveRun(board, m.id, T0)!.board.runs[0]!, runs)).toBe(false)
  // Une rétro (sa première phase, ou son lancement) n'a pas de carte ; une mission dont la rétro existe non plus, même archivée.
  const retro = { ...retroOfMission(m.id, 'done') }
  expect(isRetroCardDue(retro, [m, retro])).toBe(false)
  expect(isRetroCardDue(m, [m, retro])).toBe(false)
  expect(isRetroCardDue(m, [m, { ...retro, archivedAt: T0 }])).toBe(false)
  expect(isRetroCardDue({ ...m, id: '../x' }, runs)).toBe(false)
})

test('à chaque relevé du siège, une mission close sans livraison reçoit sa carte de rétro ; une rétro, une mission déjà étudiée et une mission archivée n’en ont pas', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = closed('Mission close A')
  const studied = closed('Mission étudiée')
  const retro = retroOfMission(studied.id)
  const gone = { ...closed('Mission archivée'), archivedAt: T0 - MIN }
  const open = { ...closed('Mission en pause'), status: 'paused' as const }
  writeBoard(w, b => ({ ...b, runs: [a, studied, retro, gone, open] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  const shown = await texts(view)
  expect(shown).toContain('Rétrospective · Mission close A')
  expect(shown).not.toContain('Rétrospective · Mission étudiée')
  expect(shown).not.toContain('Rétrospective · Mission archivée')
  expect(shown).not.toContain('Rétrospective · Mission en pause')
  expect(await findAny(view, { key: `coo-card-launch-${retroCardId(retro.id)}` })).toBeUndefined()
  await view.unmount()
  // Le relevé suivant ne la double pas.
  await settle(clock, 10)
  const again = await $.ui.mount(pane('b'))
  expect((await texts(again)).split('Rétrospective · Mission close A').length).toBe(2)
  await again.unmount()
})

test('une carte de rétro perdue (la discussion du COO relancée) revient au relevé suivant', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = closed('Mission close A')
  writeBoard(w, b => ({ ...b, runs: [a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const first = await $.ui.mount(pane('a'))
  expect(await texts(first)).toContain('Rétrospective · Mission close A')
  await first.unmount()
  // Décision A1 : les cartes vivent dans la liste des cartes du projet, que la discussion relancée relit ; elles ne se
  // perdent plus avec elle. Le sujet reste : une liste qui ne porte plus la carte (écrite ainsi ailleurs), le relevé la repose.
  const empty = JSON.stringify({ v: 1, root: '', cards: [] })
  for (const k of Object.keys(w.files)) if (k.endsWith('.cartes.json')) w.files[k] = empty
  if (w.mem['coo-cards:'] !== undefined) w.mem['coo-cards:'] = JSON.parse(empty)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const back = await $.ui.mount(pane('b'))
  expect(await texts(back)).toContain('Rétrospective · Mission close A')
  await back.unmount()
})

test('hors du siège, aucune carte n’est posée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: [closed('Mission close A')] }))
  await start($)
  await settle(clock, 12)
  const view = await $.ui.mount(pane('a'))
  expect(await texts(view)).not.toContain('Rétrospective · Mission close A')
  await view.unmount()
  // Le témoin : le siège pris, la carte vient au relevé suivant.
  await openCoo($, clock)
  await settle(clock, 6)
  const seated = await $.ui.mount(pane('b'))
  expect(await texts(seated)).toContain('Rétrospective · Mission close A')
  await seated.unmount()
})

test('fichier des missions illisible : aucune carte n’est posée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: [closed('Mission close A')] }))
  await start($)
  await openCoo($, clock)
  w.disk.unreadable = true
  await settle(clock, 12)
  const view = await $.ui.mount(pane('a'))
  expect(await texts(view)).not.toContain('Rétrospective · Mission close A')
  await view.unmount()
  // Le témoin : le fichier de nouveau lisible, la carte vient au relevé suivant.
  w.disk.unreadable = false
  await settle(clock, 6)
  const read = await $.ui.mount(pane('b'))
  expect(await texts(read)).toContain('Rétrospective · Mission close A')
  await read.unmount()
})

const CARD = { title: 'Export CSV', start: 'grill-with-docs', askMatt: 'l. 19 : une idée encore floue → /grill-with-docs', alts: [], mode: 'manual', modeWhy: 'cadrage', effort: 'high', effortWhy: 'cadrage', folder: 'export-csv', goal: 'Objectif de test.' }

// Décision « plus de plafond pour les cartes prêtes » : aucune carte n'en chasse une autre ; ce test garde ses attentes,
// sans plafond à son titre.
test('les cartes de rétro déduites ne chassent aucune carte : 8 cartes ordinaires et 3 missions closes, les 8 restent (rétros d’abord)', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const missions = [closed('Close 1'), closed('Close 2'), closed('Close 3')]
  writeBoard(w, b => ({ ...b, runs: missions }))
  await start($)
  await openCoo($, clock)
  // Les trois cartes de rétro d'abord (relevé), puis huit cartes ordinaires : aucune ne part.
  await settle(clock, 6)
  for (let i = 0; i < 8; i++) await $.tool.call({ tool: TOOL, card: { ...CARD, title: `Carte ${i}`, folder: `dossier-${i}` } } as any)
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  const shown = await texts(view)
  for (let i = 0; i < 8; i++) expect(shown).toContain(`Carte ${i}`)
  for (const m of missions) expect(shown).toContain(`Rétrospective · ${m.title}`)
  await view.unmount()
})

test('la carte encore prête d’une mission archivée depuis garde « ✕ Retirer », et ne revient pas une fois retirée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = closed('Mission close A')
  writeBoard(w, b => ({ ...b, runs: [a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  // Archivée ailleurs (« ▣ Archiver » d'une autre discussion) : sa carte reste, avec « ✕ Retirer ».
  writeBoard(w, b => ({ ...archiveRun({ ...b, activeId: null, session: 'session-B' }, a.id, T0 + 7_000)!.board, session: b.session, activeId: b.activeId ?? null }))
  await settle(clock, 6)
  const view = await $.ui.mount(pane('a'))
  expect(await texts(view)).toContain('Rétrospective · Mission close A')
  await pressAny(view, { key: `coo-card-remove-${retroCardId(a.id)}` })
  await view.unmount()
  await settle(clock, 12)
  const after = await $.ui.mount(pane('b'))
  expect(await texts(after)).not.toContain('Rétrospective · Mission close A')
  await after.unmount()
})

// Décision « plus de plafond pour les cartes prêtes » : les 8 cartes restent, comme avant.
test('8 cartes ordinaires déjà là, puis 3 missions qui se closent : le relevé pose leurs 3 cartes de rétro, et les 8 restent', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  for (let i = 0; i < 8; i++) await $.tool.call({ tool: TOOL, card: { ...CARD, title: `Carte ${i}`, folder: `dossier-${i}` } } as any)
  const missions = [closed('Close 1'), closed('Close 2'), closed('Close 3')]
  writeBoard(w, b => ({ ...b, runs: missions }))
  await settle(clock, 12)
  const view = await $.ui.mount(pane('a'))
  const shown = await texts(view)
  for (const m of missions) expect(shown).toContain(`Rétrospective · ${m.title}`)
  for (let i = 0; i < 8; i++) expect(shown).toContain(`Carte ${i}`)
  await view.unmount()
})

test('une carte de rétro en lancement n’est pas remise à neuf par le relevé suivant', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = closed('Mission close A')
  writeBoard(w, b => ({ ...b, runs: [a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const card = retroCardId(a.id)
  const view = await $.ui.mount(pane('a'))
  await pressAny(view, { key: `coo-card-auto-${card}` })
  await view.unmount()
  // Lancée : ses boutons de lancement disparaissent ; le relevé suivant ne la rend pas prête.
  const launching = await $.ui.mount(pane('b'))
  expect(await findAny(launching, { key: `coo-card-auto-${card}` })).toBeUndefined()
  await launching.unmount()
  await settle(clock, 10)
  const after = await $.ui.mount(pane('c'))
  expect(await findAny(after, { key: `coo-card-auto-${card}` })).toBeUndefined()
  expect(await texts(after)).toContain('Rétrospective · Mission close A')
  await after.unmount()
})
