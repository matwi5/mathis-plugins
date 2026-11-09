// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { askMattCandidates, LAUNCH_STALE, LAUNCH_TTL_MS, isFolderName, launchKey, otherCarrierOf, parseCard, type LaunchRecord } from '../hooks/launch.ts'
import { emptyBoard, loseLaunch, mergeBoards, newRun } from '../hooks/model.ts'
import { cooStatement, statementText } from '../hooks/coo.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { parseRoadmap } from '../hooks/roadmap.ts'
import { roadmapAsk } from '../hooks/register.tsx'
import { PANE, PLUGIN, TOOL, openCoo, seatOf, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// La carte de lancement du COO. Invariant : « Une carte ne lance qu'une mission ; un
// enregistrement de lancement n'est consommé qu'une fois, par une seule discussion, dans les 10 minutes. »

const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19 : une idée encore floue → /grill-with-docs', alts: ['to-spec'], mode: 'manual', modeWhy: 'tu veux suivre le cadrage', effort: 'high', effortWhy: 'cadrage', folder: 'export-csv' }

const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })

/** L'id de la carte, tel que la réponse de l'outil le donne. */
const cardIdOf = (answer: string): string => /Launch card (k[a-z0-9]+)/.exec(answer)?.[1] ?? ''

/** Les enregistrements de lancement du stockage du mod. */
const records = (w: World): LaunchRecord[] => Object.entries(w.mem).filter(([k]) => k.startsWith('coo-launch:')).map(([, v]) => v as LaunchRecord)

const record = (over: Partial<LaunchRecord> = {}): LaunchRecord => ({ v: 1, id: 'labcdefgh12', card: 'kabcdef12', root: '', title: 'Export CSV', start: 'grill-with-docs', mode: 'manual', effort: 'high', folder: 'export-csv', at: 0, by: 'session-COO', ...over })

// ─── Le module pur ────────────────────────────────────────────────────────

test('une carte se contrôle : un départ connu, jamais xhigh en auto, un dossier sans « / » ni « .. »', () => {
  expect('card' in parseCard(CARD, 1, 'kabcdef12')).toBe(true)
  expect(parseCard({ ...CARD, mode: 'auto', effort: 'xhigh' }, 1, 'kabcdef12')).toEqual({ refused: expect.stringMatching(/never proposed for a mission in auto/) })
  expect(parseCard({ ...CARD, start: 'rm -rf' }, 1, 'kabcdef12')).toEqual({ refused: expect.stringMatching(/"start" must be one of/) })
  expect(parseCard({ ...CARD, askMatt: '' }, 1, 'kabcdef12')).toEqual({ refused: expect.stringMatching(/askMatt/) })
  for (const bad of ['../x', 'a/b', 'a..b', '', 'é-t', 'x y']) expect(isFolderName(bad)).toBe(false)
  expect(isFolderName('export-csv-2')).toBe(true)
  expect(parseCard({ ...CARD, folder: '../etc' }, 1, 'kabcdef12')).toEqual({ refused: expect.stringMatching(/ask the user/) })
})

// ─── La carte chez le COO ─────────────────────────────────────────────────

const openCooWith = async ($: any, on: any, now: number) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-COO'
  writeBoard(w, b => b)
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  return { clock, w }
}

test('le COO propose une carte : elle paraît dans la vue et dans son relevé ; « ▶ Lancer en manuel » écrit un enregistrement et met le texte de lancement dans le prompt', { timeoutMs: 20000 }, async ($, on) => {
  const now = 300_000_000
  const { w } = await openCooWith($, on, now)
  const r = String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result)
  expect(r).toMatch(/Launch card k[a-z0-9]+ shown in the Coordination view/)
  const card = { id: cardIdOf(r) }
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /Lancements · 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Export CSV des tickets' })).toBeDefined()
  await ui.press({ key: `coo-card-manual-${card.id}` })
  await ui.unmount()
  // Pendant le lancement, la carte n'a plus de bouton (un second clic n'a rien à presser) ; renvoyée, elle ne change pas.
  expect(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result)).toMatch(/being launched/)
  const kept = records(w)
  expect(kept).toHaveLength(1)
  expect(kept[0]).toMatchObject({ card: card.id, mode: 'manual', effort: 'high', folder: 'export-csv', by: 'session-COO', start: 'grill-with-docs' })
  const fill = w.fills.at(-1) ?? ''
  expect(fill).toContain(`{"launch": "${kept[0]!.id}"}`)
  expect(fill).toMatch(/\/mattpocock-skills:grill-with-docs suivi du sujet/)
  expect(fill).toMatch(/effort "high"/)
  expect(fill).toMatch(/--effort high/)
  expect(w.fills.filter(f => f.includes('"launch"'))).toHaveLength(1)
  const after = await pane($)
  expect(await after.find({ type: 'Text', text: /lancement en cours \(manuel\)/ })).toBeDefined()
  expect(await after.find({ type: 'Button', key: `coo-card-manual-${card.id}` })).toBeUndefined()
  await after.unmount()
})

test('la carte revient au-delà de 10 minutes sans mission, et se dit lancée quand une mission la porte', { timeoutMs: 20000 }, async ($, on) => {
  const now = 301_000_000
  const { clock, w } = await openCooWith($, on, now)
  const card = { id: cardIdOf(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result)) }
  const ui = await pane($)
  await ui.press({ key: `coo-card-manual-${card.id}` })
  await ui.unmount()
  await clock.advance(LAUNCH_TTL_MS + 70_000)
  const back = await pane($)
  expect(await back.find({ type: 'Button', key: `coo-card-manual-${card.id}` })).toBeDefined()
  // Un nouveau clic efface d'abord l'enregistrement périmé : un seul reste, le nouveau.
  await back.press({ key: `coo-card-manual-${card.id}` })
  await back.unmount()
  const kept = records(w)
  expect(kept).toHaveLength(1)
  // Une mission d'une autre discussion porte la carte : lancée.
  writeBoard(w, b => ({ ...b, runs: [{ ...newRun('grill-with-docs', now, 'Export CSV des tickets'), status: 'active', owner: 'session-M', launch: { id: kept[0]!.id, card: card.id, at: kept[0]!.at, folder: 'export-csv', start: 'grill-with-docs', mode: 'manual' } }] }))
  await settle(clock, 6)
  const done = await pane($)
  expect(await done.find({ type: 'Text', text: /lancée : « Export CSV des tickets »/ })).toBeDefined()
  await done.unmount()
})

test('une carte refusée ne paraît pas ; elle ne vient que de la discussion du COO, seule dans son appel', { timeoutMs: 20000 }, async ($, on) => {
  const now = 302_000_000
  const clock = mock.clock(on, { now })
  world(on)
  await start($)
  // Hors de la discussion du COO.
  expect(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result)).toMatch(/for the COO discussion only/)
  await openCoo($, clock)
  expect(String(((await $.tool.call({ tool: TOOL, card: { ...CARD, folder: 'a/../b' } } as any)) as any).result)).toMatch(/No card shown/)
  const r = String(((await $.tool.call({ tool: TOOL, card: CARD, note: 'x' } as any)) as any).result)
  expect(r).toMatch(/"card" goes alone in its call/)
})

test('un skill de départ lancé chez le COO demande une carte au lieu d’ouvrir une mission', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 303_000_000 })
  const w = world(on)
  await start($)
  await openCoo($, clock)
  const text = (await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'spec' })).text
  expect(text).toMatch(/propose instead a launch card/)
  expect(text).toContain('start "to-spec"')
  expect(stored(w)?.runs ?? []).toHaveLength(0)
})

// ─── La nouvelle discussion consomme ─────────────────────────────────────

/** Une discussion qui vient d'ouvrir sa mission : le lancement est dans le stockage, posé par le clic du COO. */
const newDiscussion = async ($: any, on: any, now: number, rec: Partial<LaunchRecord> = {}) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-N'
  const r = record({ at: now - 30_000, ...rec })
  w.mem[launchKey(r.id)] = r
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  return { clock, w, r }
}
const consume = async ($: any, clock: any, id: string): Promise<string> => {
  const call = $.tool.call({ tool: TOOL, launch: id, title: 'Export CSV' } as any)
  await settle(clock, 3)
  return String(((await call) as any).result)
}

test('la nouvelle discussion consomme le lancement une fois : sa mission se rattache à la carte, et l’enregistrement s’efface', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w, r } = await newDiscussion($, on, 310_000_000)
  const text = await consume($, clock, r.id)
  expect(text).toMatch(/Launch: consumed/)
  expect(text).toContain('travail/export-csv/')
  const run = stored(w).runs[0]!
  expect(run.launch).toEqual({ id: r.id, card: r.card, at: r.at, folder: 'export-csv', start: 'grill-with-docs', mode: 'manual' })
  expect(w.mem[launchKey(r.id)]).toBeUndefined()
  // Rejoué : déjà rattachée, rien ne change.
  expect(await consume($, clock, r.id)).toMatch(/already attached/)
})

test('un id déjà porté par une mission du fichier des missions est refusé, même si l’enregistrement revient', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w, r } = await newDiscussion($, on, 311_000_000)
  writeBoard(w, b => ({ ...b, runs: [...b.runs, { ...newRun('grill-with-docs', 311_000_000 - 20_000, 'Autre'), status: 'active', owner: 'session-X', launch: { id: r.id, card: r.card, at: r.at, folder: 'export-csv', start: 'grill-with-docs', mode: 'manual' } }] }))
  const text = await consume($, clock, r.id)
  expect(text).toMatch(/another mission already took it/)
  expect(text).toContain(LAUNCH_STALE)
  expect(stored(w).runs.find(x => x.owner === 'session-N')?.launch).toBeUndefined()
})

test('périmé, inconnu, hors forme, pris par une autre discussion, ou mission plus ancienne que le clic : la mission reste en manuel et le dit', { timeoutMs: 30000 }, async ($, on) => {
  const now = 312_000_000
  const { clock, w } = await newDiscussion($, on, now)
  // Périmé pendant que la discussion tourne (au chargement, il aurait été effacé : inconnu).
  w.mem[launchKey('lstale12345')] = record({ id: 'lstale12345', at: now - LAUNCH_TTL_MS - 1000 })
  expect(await consume($, clock, 'lstale12345')).toMatch(/more than 10 minutes old/)
  expect(await consume($, clock, 'lzzzzzzzzzz')).toMatch(/no launch of this project has this id/)
  expect(await consume($, clock, '../../etc')).toMatch(/out of form/)
  w.mem[launchKey('lclaimed123')] = record({ id: 'lclaimed123', at: now - 10_000, claim: { by: 'session-Z', at: now - 1000 } })
  expect(await consume($, clock, 'lclaimed123')).toMatch(/another mission already took it/)
  // La mission d'ici est née avant ce clic (enregistrement posé bien après son ouverture).
  w.mem[launchKey('llater12345')] = record({ id: 'llater12345', at: now + 90_000 })
  await clock.advance(95_000)
  const later = await consume($, clock, 'llater12345')
  expect(later).toMatch(/opened before the click/)
  expect(stored(w).runs[0]!.launch).toBeUndefined()
})

test('deux discussions qui prennent le même lancement : la dernière marque l’emporte, l’autre reste en manuel', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w, r } = await newDiscussion($, on, 313_000_000)
  const call = $.tool.call({ tool: TOOL, launch: r.id } as any)
  // Pendant l'attente, une autre discussion écrit son nom sur l'enregistrement.
  await clock.advance(500)
  w.mem[launchKey(r.id)] = { ...(w.mem[launchKey(r.id)] as object), claim: { by: 'session-Z', at: 313_000_000 } }
  await settle(clock, 3)
  expect(String(((await call) as any).result)).toMatch(/another mission already took it/)
  expect(stored(w).runs[0]!.launch).toBeUndefined()
})

test('sans mission ouverte ici, le lancement n’est pas consommé : il reste pour un nouvel appel', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 314_000_000 })
  const w = world(on)
  const r = record({ at: 314_000_000 - 1000 })
  w.mem[launchKey(r.id)] = r
  await start($)
  expect(await consume($, clock, r.id)).toMatch(/no mission is open in this discussion yet/)
  expect(w.mem[launchKey(r.id)]).toBeDefined()
})

test('un rattachement se garde à la fusion : posé une fois, jamais perdu par une copie qui ne le porte pas', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w, r } = await newDiscussion($, on, 315_000_000)
  await consume($, clock, r.id)
  // Une autre écriture de la même mission, plus récente, sans le rattachement (copie d'avant).
  writeBoard(w, b => ({ ...b, runs: b.runs.map(x => ({ ...x, launch: undefined, updatedAt: x.updatedAt + 10_000 })) }))
  await settle(clock, 6)
  // La sauvegarde suivante d'ici fusionne les deux copies : le rattachement reste.
  await $.tool.call({ tool: TOOL, note: 'une note' } as any)
  await settle(clock, 3)
  expect(stored(w).runs[0]!.launch?.id).toBe(r.id)
})

test('le siège perdu : la carte n’est pas montrée', { timeoutMs: 20000 }, async ($, on) => {
  const now = 316_000_000
  const { clock, w } = await openCooWith($, on, now)
  writeBoard(w, b => ({ ...b, coo: seatOf('session-autre', now + 1000) }))
  await settle(clock, 6)
  expect(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result)).toMatch(/does not hold the COO seat/)
})

test('après /reload-plugins, la carte reste en lancement et l’enregistrement se consomme encore dans ses 10 minutes', { timeoutMs: 20000 }, async ($, on) => {
  const now = 317_000_000
  const { w } = await openCooWith($, on, now)
  const card = { id: cardIdOf(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result)) }
  const ui = await pane($)
  await ui.press({ key: `coo-card-manual-${card.id}` })
  await ui.unmount()
  // Le mod rechargé : `session.start` repasse ; l'enregistrement pas encore périmé reste.
  await start($)
  expect(records(w)).toHaveLength(1)
  const after = await pane($)
  expect(await after.find({ type: 'Text', text: /lancement en cours/ })).toBeDefined()
  await after.unmount()
})

test('une nouvelle discussion rechargée avant sa consommation consomme encore son lancement', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w, r } = await newDiscussion($, on, 318_000_000)
  await start($)
  expect(await consume($, clock, r.id)).toMatch(/Launch: consumed/)
  expect(stored(w).runs[0]!.launch?.id).toBe(r.id)
})

test('le chemin d’ask-matt vient du registre des plugins : seulement sous le dossier des plugins de Claude, sans « .. »', () => {
  const home = '/u/.claude'
  const raw = {
    plugins: {
      'mattpocock-skills@m': [{ installPath: '/u/.claude/plugins/cache/m/mattpocock-skills/1.3.1' }, { installPath: '/u/.claude/plugins/../../etc' }, { installPath: '/ailleurs/mattpocock-skills' }],
      'flow-board@m': [{ installPath: '/u/.claude/plugins/cache/m/flow-board/1' }],
    },
  }
  expect(askMattCandidates(raw, home)).toEqual(['/u/.claude/plugins/cache/m/mattpocock-skills/1.3.1/skills/engineering/ask-matt/SKILL.md'])
  expect(askMattCandidates(null, home)).toEqual([])
  expect(askMattCandidates({ plugins: [] }, home)).toEqual([])
})

test('une mission qui porte déjà la carte ou son dossier (un autre lancement) fait refuser la consommation', { timeoutMs: 20000 }, async ($, on) => {
  const now = 319_000_000
  const { clock, w, r } = await newDiscussion($, on, now)
  writeBoard(w, b => ({ ...b, runs: [...b.runs, { ...newRun('grill-with-docs', now - 20_000, 'Autre'), status: 'active', owner: 'session-X', launch: { id: 'lautre12345', card: 'kautre1234', at: now - 40_000, folder: 'Export-CSV', start: 'grill-with-docs', mode: 'manual' } }] }))
  expect(await consume($, clock, r.id)).toMatch(/another mission already took it/)
  // L'enregistrement n'a pas été effacé, et la mission d'ici n'est pas rattachée.
  expect(stored(w).runs.find(x => x.owner === 'session-N')?.launch).toBeUndefined()
})

test('le premier message d’une mission lancée ouvre une mission neuve : une mission en pause de même phase n’est pas reprise', { timeoutMs: 20000 }, async ($, on) => {
  const now = 320_000_000
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-N'
  const old = { ...newRun('grill-with-docs', now - 3_600_000, 'Ancienne mission'), status: 'paused' as const, updatedAt: now - 3_600_000 }
  writeBoard(w, b => ({ ...b, runs: [old] }))
  const r = record({ at: now - 10_000 })
  w.mem[launchKey(r.id)] = r
  await start($)
  await $.command.run({ command: 'mattpocock-skills:grill-with-docs', args: `exporter les tickets. Lancée par le COO : appelle d'abord l'outil flow de flow-board avec {"launch": "${r.id}"}` } as any)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  expect(await consume($, clock, r.id)).toMatch(/Launch: consumed/)
  const runs = stored(w).runs
  expect(runs.find(x => x.id === old.id)?.status).toBe('paused')
  expect(runs.find(x => x.id !== old.id)?.launch?.id).toBe(r.id)
})

test('un lancement encore valable pour ce dossier refuse un second clic, même sur une carte reproposée', { timeoutMs: 20000 }, async ($, on) => {
  const now = 321_000_000
  const { w } = await openCooWith($, on, now)
  // Un lancement d'avant le redémarrage du COO, encore valable : sa carte a été perdue.
  w.mem[launchKey('lavant12345')] = record({ id: 'lavant12345', at: now - 60_000, card: 'kperdue123' })
  const card = { id: cardIdOf(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result)) }
  const ui = await pane($)
  await ui.press({ key: `coo-card-manual-${card.id}` })
  await ui.unmount()
  expect(records(w).map(x => x.id)).toEqual(['lavant12345'])
  expect(w.fills.some(f => f.includes('"launch"'))).toBe(false)
})

test('au-delà du plafond, seules les cartes prêtes les plus anciennes partent : une carte en lancement reste', { timeoutMs: 20000 }, async ($, on) => {
  const now = 322_000_000
  const { w } = await openCooWith($, on, now)
  const first = cardIdOf(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result))
  const ui = await pane($)
  await ui.press({ key: `coo-card-manual-${first}` })
  await ui.unmount()
  for (let i = 0; i < 9; i++) await $.tool.call({ tool: TOOL, card: { ...CARD, title: `Carte ${i}`, folder: `dossier-${i}` } } as any)
  // Renvoyée avec le même dossier (casse comprise), elle est toujours en lancement.
  expect(String(((await $.tool.call({ tool: TOOL, card: { ...CARD, folder: 'EXPORT-csv' } } as any)) as any).result)).toMatch(/being launched/)
  expect(records(w)).toHaveLength(1)
})

test('une mission qui en voit une autre porter le même lancement perd (sens unique), et la perte ne se défait pas à la fusion', () => {
  const launch = { id: 'labcdefgh12', card: 'kabcdef12', at: 1, folder: 'export-csv', start: 'grill-with-docs', mode: 'manual' as const }
  const a = { ...newRun('grill-with-docs', 10, 'A'), launch }
  const b = { ...newRun('grill-with-docs', 20, 'B'), launch }
  // Chacune voit l'autre : les deux perdent, jamais les deux gagnent.
  expect(otherCarrierOf([a, b], launch, a.id)?.id).toBe(b.id)
  expect(otherCarrierOf([a, b], launch, b.id)?.id).toBe(a.id)
  const board = { ...emptyBoard('', 'p'), runs: [b], activeId: b.id }
  const lost = loseLaunch(board, b.id, 30)!.board.runs[0]!
  expect(lost.launch?.lostAt).toBe(30)
  // Une copie plus récente sans la perte ne la défait pas ; la mission perdue ne compte plus pour la carte.
  const merged = mergeBoards({ ...board, runs: [lost] }, { ...board, runs: [{ ...b, updatedAt: 99 }] })
  expect(merged.runs[0]!.launch?.lostAt).toBe(30)
  expect(otherCarrierOf([lost, a], launch, a.id)).toBeUndefined()
})

test('deux discussions passées en même temps sans se voir à la relecture d’avant : celle qui voit l’autre après son écriture perd et reste en manuel', { timeoutMs: 20000 }, async ($, on) => {
  const now = 323_000_000
  const { clock, w, r } = await newDiscussion($, on, now)
  // Au moment où cette discussion écrit son rattachement, l'autre mission (même lancement, autre discussion) arrive au fichier.
  w.probe.onBoardWrite = text => {
    if (!text.includes(r.id) || text.includes('session-Y')) return
    w.probe.onBoardWrite = undefined
    writeBoard(w, b => ({ ...b, runs: [...b.runs, { ...newRun('grill-with-docs', now + 5_000, 'Jumelle'), status: 'active', owner: 'session-Y', launch: { id: r.id, card: r.card, at: r.at, folder: r.folder, start: r.start, mode: r.mode } }] }))
  }
  const text = await consume($, clock, r.id)
  expect(text).toMatch(/another mission already took it/)
  await settle(clock, 3)
  const mine = stored(w).runs.find(x => x.owner === 'session-N')!
  expect(mine.launch?.lostAt).toBeDefined()
})

test('une écriture ratée du fichier des missions après le rattachement le fait perdre : rien n’est compté consommé sans vérification', { timeoutMs: 20000 }, async ($, on) => {
  const now = 324_000_000
  const { clock, w, r } = await newDiscussion($, on, now)
  // L'écriture qui porterait le rattachement est refusée, une fois.
  w.probe.refuseBoard = text => {
    if (!text.includes(r.id)) return false
    w.probe.refuseBoard = undefined
    return true
  }
  expect(await consume($, clock, r.id)).toMatch(/another mission already took it|could not be marked/)
  await $.tool.call({ tool: TOOL, note: 'une note' } as any)
  await settle(clock, 3)
  expect(stored(w).runs[0]!.launch?.lostAt).toBeDefined()
})

// ─── La feuille de route et le relevé ─────────────────────────────────────

const ROADMAP = parseRoadmap('# Feuille de route\n\n## Jalons\n## Prochaines étapes\n## Idées\n- [I1] à lancer · 2026-11-02 · Mathis · exporter les tickets en CSV\n## À reprendre\n')

test('une idée « à lancer » a son bouton ▶ Lancer, qui demande la carte au Claude du COO ; une carte lancée fait passer son idée « devenue mission »', () => {
  const roadmap = { where: 'poste' as const, path: '/p/feuille.md', read: ROADMAP, gone: [] }
  const launched = (parseCard({ ...CARD, idea: 'I1' }, 1, 'kabcdef12') as { card: any }).card
  const run = { ...newRun('grill-with-docs', 2, 'Export CSV'), launch: { id: 'labcdefgh12', card: 'kabcdef12', at: 1, folder: 'export-csv', start: 'grill-with-docs', mode: 'manual' as const } }
  const s = cooStatement({ ...emptyBoard('', 'p'), runs: [run] }, { now: 3, roadmap, cards: [launched], askMatt: '/c/plugins/cache/m/mattpocock-skills/1/skills/engineering/ask-matt/SKILL.md' })
  const idea = coordinationRows(s).find(r => r.key === 'coo-idea-I1')
  expect(idea?.actions?.map(a => a.act)).toContainEqual({ kind: 'idea-launch', id: 'I1' })
  expect(roadmapAsk({ kind: 'idea-launch', id: 'I1' }, roadmap)).toMatch(/je veux lancer l'idée I1 de la feuille de route\. Relis ask-matt, puis propose-moi sa carte de lancement par le champ "card"/)
  const text = statementText(s)
  expect(text).toMatch(/ask-matt, to reread before proposing the start of a mission/)
  expect(text).toMatch(/launch card « kabcdef12 » « Export CSV des tickets »: start \/grill-with-docs, mode manual, effort high, folder travail\/export-csv\/, launched as mission « Export CSV »/)
  expect(text).toMatch(/The idea « I1 » of the roadmap became this mission: give it the status « devenue mission <its title> »/)
  // L'idée a déjà son statut : rien n'est redemandé.
  const done = { ...roadmap, read: parseRoadmap('# Feuille de route\n\n## Jalons\n## Prochaines étapes\n## Idées\n- [I1] devenue mission Export CSV · 2026-11-02 · Mathis · exporter les tickets en CSV\n## À reprendre\n') }
  expect(statementText(cooStatement({ ...emptyBoard('', 'p'), runs: [run] }, { now: 3, roadmap: done, cards: [launched] }))).not.toMatch(/became this mission/)
  // Sans ask-matt trouvé, le relevé dit de le chercher dans le plugin installé.
  expect(statementText(cooStatement(emptyBoard('', 'p'), { now: 3, askMatt: null }))).toMatch(/ask-matt: not found among the installed plugins/)
})

test('deux cartes cliquées coup sur coup : la demande de la première, pas encore envoyée, reste dans le prompt', { timeoutMs: 20000 }, async ($, on) => {
  const now = 323_000_000
  const { w } = await openCooWith($, on, now)
  const first = cardIdOf(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result))
  const second = cardIdOf(String(((await $.tool.call({ tool: TOOL, card: { ...CARD, title: 'Durcir les scripts', folder: 'durcir-scripts' } } as any)) as any).result))
  const ui = await pane($)
  await ui.press({ key: `coo-card-manual-${first}` })
  const launched = records(w).find(r => r.card === first)!
  expect(w.box.text).toContain(`{"launch": "${launched.id}"}`)
  await ui.press({ key: `coo-card-manual-${second}` })
  await ui.unmount()
  // La demande de la première carte n'est jamais écrasée : la seconde s'ajoute à sa suite, Entrée lance les deux.
  const next = records(w).find(r => r.card === second)!
  expect(w.box.text).toContain(`{"launch": "${launched.id}"}`)
  expect(w.box.text.indexOf(`{"launch": "${next.id}"}`)).toBeGreaterThan(w.box.text.indexOf(`{"launch": "${launched.id}"}`))
})

test('une demande restée dans le prompt au-delà de son lancement (périmée) est remplacée, jamais envoyée avec la nouvelle', { timeoutMs: 20000 }, async ($, on) => {
  const now = 324_000_000
  const { clock, w } = await openCooWith($, on, now)
  const card = cardIdOf(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result))
  const ui = await pane($)
  await ui.press({ key: `coo-card-manual-${card}` })
  await ui.unmount()
  const old = records(w).find(r => r.card === card)!
  // Plus de 11 minutes sans Entrée : le lancement est périmé, la carte redevient prête.
  await clock.advance(LAUNCH_TTL_MS + 2 * 60_000)
  const again = await pane($)
  await again.press({ key: `coo-card-manual-${card}` })
  await again.unmount()
  const fresh = records(w).find(r => r.card === card && r.id !== old.id)!
  expect(fresh).toBeDefined()
  expect(w.box.text).toContain(`{"launch": "${fresh.id}"}`)
  expect(w.box.text).not.toContain(`{"launch": "${old.id}"}`)
})

test('deux cartes cliquées en même temps : aucune demande n’écrase l’autre', { timeoutMs: 20000 }, async ($, on) => {
  const now = 325_000_000
  const { w } = await openCooWith($, on, now)
  const first = cardIdOf(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result))
  const second = cardIdOf(String(((await $.tool.call({ tool: TOOL, card: { ...CARD, title: 'Durcir les scripts', folder: 'durcir-scripts' } } as any)) as any).result))
  const ui = await pane($)
  await Promise.all([ui.press({ key: `coo-card-manual-${first}` }), ui.press({ key: `coo-card-manual-${second}` })])
  await ui.unmount()
  const ids = records(w).map(r => r.id)
  expect(ids).toHaveLength(2)
  for (const id of ids) expect(w.box.text).toContain(`{"launch": "${id}"}`)
})

test('un prompt qui mêle une demande périmée et une valable ne reçoit rien : la nouvelle demande est à taper, aucune n’est perdue ni renvoyée', { timeoutMs: 20000 }, async ($, on) => {
  const now = 326_000_000
  const { clock, w } = await openCooWith($, on, now)
  const first = cardIdOf(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result))
  const second = cardIdOf(String(((await $.tool.call({ tool: TOOL, card: { ...CARD, title: 'Durcir les scripts', folder: 'durcir-scripts' } } as any)) as any).result))
  const press = async (card: string) => {
    const ui = await pane($)
    await ui.press({ key: `coo-card-manual-${card}` })
    await ui.unmount()
  }
  await press(first)
  await clock.advance(6 * 60_000)
  await press(second)
  const before = w.box.text
  // La première est périmée et sa carte de nouveau prête ; la seconde vaut encore.
  await clock.advance(LAUNCH_TTL_MS + 2 * 60_000 - 6 * 60_000 + 30_000)
  await press(first)
  expect(w.box.text).toBe(before)
  expect(w.toasts.at(-1)).toMatch(/^▶ Demande à taper : lance la mission « Export CSV des tickets » \(lancement l[0-9a-z]+, valable 10 minutes\)\.$/)
})

test('une demande dont la ligne de lancement a été retouchée reste dans le prompt : la nouvelle est à taper', { timeoutMs: 20000 }, async ($, on) => {
  const now = 327_000_000
  const { w } = await openCooWith($, on, now)
  const card = cardIdOf(String(((await $.tool.call({ tool: TOOL, card: CARD } as any)) as any).result))
  w.box.text = '◆ COO : lance maintenant la mission « Autre » dans une nouvelle discussion. Ma note à moi.'
  const ui = await pane($)
  await ui.press({ key: `coo-card-manual-${card}` })
  await ui.unmount()
  expect(w.box.text).toBe('◆ COO : lance maintenant la mission « Autre » dans une nouvelle discussion. Ma note à moi.')
  expect(w.toasts.at(-1)).toMatch(/^▶ Demande à taper : lance la mission « Export CSV des tickets »/)
})
