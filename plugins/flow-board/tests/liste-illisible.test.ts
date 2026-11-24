// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { cardsListFile } from '../hooks/cards-list.ts'
import { CLOCK_SKEW_MS, LAUNCH_GRACE_MS, LAUNCH_TTL_MS, parseCard, pistesCard, type LaunchCard } from '../hooks/launch.ts'
import { retroCard } from '../hooks/retro-coo.ts'
import { closeDelivered, emptyBoard, newRun } from '../hooks/model.ts'
import { emptyWaitlist, pistesOf, type Piste, type Waitlist } from '../hooks/pistes.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'
import { allTexts, findAny, pressAny } from './page-coo.ts'
import { storageMode } from './stockage.ts'

// La liste des cartes qui ne se lit pas (décisions C3, C8, L1, D2) : aucune carte montrée, rien n'y est écrit, sa copie
// gardée à côté ; la vue et le relevé le disent ; la livraison et l'archivage d'une mission livrée continuent. Invariant :
// « La liste des cartes d'un projet n'est écrite que par la discussion qui tient le siège du COO. Une écriture n'y fait
// jamais disparaître ni revenir une carte qu'elle ne visait pas, et une liste qui ne se lit pas n'est jamais réécrite. »

const NOW = 990_000_000
const MIN = 60_000
const PROJECT = 'sans-projet-811c9dc5'
const LIST = `flow-board/coordination/${PROJECT}.cartes.json`
const KEY = 'coo-cards:'
const PISTES = `flow-board/pistes/${PROJECT}.json`
const ALERT = '⚠ Liste des cartes illisible : aucune carte n’est montrée, rien ne s’y écrit'
const NOTHING = '◆ Rien n’est fait : la liste des cartes ne se lit pas.'
const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'manual', effort: 'high', folder: 'export-csv', goal: 'Objectif de test.' }
const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const statement = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
const launches = (w: World): string[] => Object.keys(w.mem).filter(k => k.startsWith('coo-launch:'))

const listPath = (w: World): string | undefined => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${LIST}`))
/** Le texte de la liste tel que gardé, au fichier (son chemin entier une fois écrit, sinon celui posé) ou dans le stockage du mod. */
const listText = (w: World): string | undefined => {
  if (storageMode() === 'fichier') return w.files[listPath(w) ?? LIST]
  const kept = w.mem[KEY]
  return kept === undefined ? undefined : typeof kept === 'string' ? kept : JSON.stringify(kept)
}
const listOf = (w: World): { cards: any[] } => JSON.parse(listText(w) ?? '{"cards":[]}')
/** Pose la liste (un texte tel quel, ou des cartes) au fichier, à son chemin entier s'il est déjà écrit, et dans le stockage. */
const putList = (w: World, value: string | unknown[]) => {
  const text = typeof value === 'string' ? value : JSON.stringify(cardsListFile('', value))
  w.files[LIST] = text
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/${LIST}`)) w.files[k] = text
  try {
    w.mem[KEY] = JSON.parse(text)
  } catch {
    w.mem[KEY] = text
  }
}
const isList = (pathOrKey: string): boolean => pathOrKey.endsWith(`/${LIST}`) || pathOrKey === KEY
/** Les copies gardées d'une liste illisible (le monde les range à part) : fichiers `.illisible-<date>` à côté, ou clés `…:illisible:<date>`. */
const asides = (w: World): string[] => Object.keys(w.asides).filter(p => p.includes(`${PROJECT}.cartes.json.illisible-`) || p.startsWith(`${KEY}:illisible:`))

/** Les formes d'une liste illisible. */
const FORMS: Record<string, (w: World) => void> = {
  'texte qui ne se lit pas': w => putList(w, '{ pas une liste'),
  // Les versions 1 et 2 se lisent (liste des cartes en version 2) ; toute autre est illisible.
  'version inconnue (3)': w => putList(w, JSON.stringify({ v: 3, root: '', cards: [card('kcarte001')] })),
  'version 0': w => putList(w, JSON.stringify({ v: 0, root: '', cards: [card('kcarte001')] })),
  'sans version': w => putList(w, JSON.stringify({ root: '', cards: [card('kcarte001')] })),
  'version en texte': w => putList(w, JSON.stringify({ v: '2', root: '', cards: [card('kcarte001')] })),
  'racine d’un autre projet': w => putList(w, JSON.stringify({ v: 1, root: '/autre/projet', cards: [] })),
  'lecture ratée': w => {
    putList(w, [card('kcarte001')])
    w.probe.refuseRead = key => isList(key)
  },
}

const card = (id: string, over: Partial<LaunchCard> = {}): LaunchCard => {
  const parsed = parseCard({ ...CARD, title: `Carte ${id}`, folder: `dossier-${id}` }, NOW - 30 * MIN, id)
  if ('refused' in parsed) throw new Error(parsed.refused)
  return { ...parsed.card, ...over }
}

/** Le COO ouvert ici, le siège pris par cette discussion, sur des missions ; quelques relevés passent. */
const cooHere = async ($: any, on: any, runs: Run[] = [], before?: (w: World) => void) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  before?.(w)
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  return { clock, w }
}

/** Une mission close sans livraison. */
const closed = (title: string): Run => ({ ...newRun('prototype', NOW - 10 * MIN, title), status: 'done', finishedAt: NOW - 9 * MIN, updatedAt: NOW - 9 * MIN })
/** Une mission au rapport validé, en pause, sa phase « Version et push » à faire. */
const validated = (title: string): Run => {
  const run = newRun('implement', NOW - 90_000, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: NOW - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: NOW - 50_000, finishedAt: NOW - 40_000, steps: [], items: [] }
  const version = newRun('project:version', run.startedAt, 'v').phases[0]!
  const pending = { ...version, status: 'pending' as const, startedAt: undefined, steps: version.steps.map(s => ({ id: s.id, status: 'pending' as const })) }
  return { ...run, phases: [done, report, pending], cursor: 1, status: 'paused', reportValidatedAt: NOW - 40_000, updatedAt: NOW - 1_000 } as Run
}
const delivered = (title: string): Run => {
  const run = validated(title)
  const board: Board = { ...emptyBoard('', 'projet'), runs: [run] }
  return closeDelivered(board, run.id, NOW - 500, { version: '0.80.0', push: 'main' })!.board.runs[0]!
}

// ─── La vue et le relevé ──────────────────────────────────────────────────

for (const [form, breakList] of Object.entries(FORMS))
  test(`liste illisible (${form}) : la vue ne montre aucune carte, porte la ligne d’alerte avec le fichier et sa copie, sans bouton ; le relevé le dit, sans carte`, { timeoutMs: 30000 }, async ($, on) => {
    const { w } = await cooHere($, on, [closed('Mission close')], breakList)
    const ui = await pane($)
    const shown = await allTexts(ui)
    expect(shown).toContain(ALERT)
    expect(shown).toMatch(new RegExp(`Fichier : .*${PROJECT}\\.cartes\\.json|Fichier : coo-cards:`))
    if (form === 'lecture ratée') expect(shown).toContain('Aucune copie gardée : la lecture a raté')
    else expect(shown).toMatch(/Copie gardée : .*illisible/)
    expect(shown).not.toContain('Au départ ·')
    expect(shown).not.toContain('Rétrospective · Mission close')
    // Les trois lignes sont là, sans rangée de boutons (rendue sous la clé `<ligne>-acts`), et aucun bouton de carte.
    for (const key of ['coo-cards-unread', 'coo-cards-unread-path', 'coo-cards-unread-aside']) {
      expect(await findAny(ui, { key })).toBeDefined()
      expect(await findAny(ui, { key: `${key}-acts` })).toBeUndefined()
    }
    expect(await findAny(ui, { key: 'coo-card-manual-kcarte001' })).toBeUndefined()
    await ui.unmount()
    const said = await statement($)
    expect(said).toContain('List of launch cards: UNREADABLE at')
    expect(said).not.toContain('- launch card')
    if (form !== 'lecture ratée') expect(said).toMatch(/A copy of its text is kept, never deleted, at .*illisible/)
    // Aucune carte de rétro due posée, rien d'écrit dans la liste.
    expect(listText(w) ?? '').not.toContain('Rétrospective')
  })

test('liste absente : une liste vide, sans la ligne d’alerte ; une carte proposée s’écrit', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await cooHere($, on)
  expect(await allTexts(await pane($))).not.toContain(ALERT)
  expect(await call($, { card: CARD })).toMatch(/Launch card k[a-z0-9]+/)
  expect(listOf(w).cards).toHaveLength(1)
})

test('la copie du texte illisible est gardée à côté, une par texte relu ; le texte de la liste ne change pas d’un octet après dix relevés, une carte proposée et un clic', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, w } = await cooHere($, on, [], w => putList(w, '{ pas une liste'))
  const before = listText(w)
  // Dix relevés (un toutes les 5 s) et plus : une seule copie de ce texte.
  await settle(clock, 55)
  expect(asides(w)).toHaveLength(1)
  expect(await call($, { card: CARD })).toMatch(/^No card shown: the list of cards cannot be read/)
  // Un clic d'un dessin d'avant, où la liste se lisait.
  putList(w, [card('kcarte001')])
  const ui = await pane($)
  expect(await findAny(ui, { key: 'coo-card-manual-kcarte001' })).toBeDefined()
  putList(w, '{ pas une liste')
  await ui.press({ key: 'coo-card-manual-kcarte001' })
  await ui.unmount()
  await settle(clock, 1)
  expect(w.toasts.at(-1)).toBe(NOTHING)
  expect(launches(w)).toEqual([])
  expect(listText(w)).toBe(before)
  expect(asides(w)).toHaveLength(1)
  // Un autre texte illisible : une seconde copie.
  putList(w, '{ un autre texte')
  await settle(clock, 6)
  expect(asides(w)).toHaveLength(2)
  // Réparée, puis cassée de nouveau par le premier texte : une nouvelle copie (la mémoire de la copie oubliée à la relecture).
  putList(w, [])
  await settle(clock, 6)
  putList(w, '{ pas une liste')
  await settle(clock, 6)
  expect(asides(w)).toHaveLength(3)
})

test('la copie qui ne s’écrit pas : la vue le dit, sans promettre la copie au prochain relevé ; réessayée, elle se garde', { timeoutMs: 30000 }, async ($, on) => {
  let isRefused = true
  const { clock, w } = await cooHere($, on, [], w => {
    putList(w, '{ pas une liste')
    w.probe.refuseWrite = path => isRefused && path.includes('.illisible-')
    w.probe.refuseStore = key => isRefused && key.includes(':illisible:')
  })
  await settle(clock, 6)
  const ui = await pane($)
  expect(await allTexts(ui)).toContain('Aucune copie gardée : son écriture a raté (réessayée à chaque relevé)')
  await ui.unmount()
  expect(asides(w)).toEqual([])
  isRefused = false
  await settle(clock, 6)
  expect(asides(w)).toHaveLength(1)
})

// ─── Chaque lecteur ───────────────────────────────────────────────────────

test('clic de lancement, « → /départ », « ✕ Retirer » d’un dessin d’avant : rien, et le toast le dit', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await cooHere($, on, [], w => putList(w, [card('kcarte001')]))
  for (const key of ['coo-card-manual-kcarte001', 'coo-card-alt-kcarte001-to-spec', 'coo-card-remove-kcarte001']) {
    putList(w, [card('kcarte001')])
    const ui = await pane($)
    expect(await findAny(ui, { key })).toBeDefined()
    putList(w, '{ pas une liste')
    await ui.press({ key })
    await ui.unmount()
    await settle(clock, 1)
    expect(w.toasts.at(-1)).toBe(NOTHING)
    expect(listText(w)).toBe('{ pas une liste')
  }
  expect(launches(w)).toEqual([])
})

test('« ✓ Archiver » : proposé pour une mission livrée, pas pour une mission close sans livraison ; l’archivage se fait, la liste ne change pas', { timeoutMs: 30000 }, async ($, on) => {
  const d = delivered('Mission livrée')
  const c = closed('Mission close')
  const { clock, w } = await cooHere($, on, [d, c], w => putList(w, '{ pas une liste'))
  const ui = await pane($)
  expect(await findAny(ui, { key: `coo-archive-${d.id}` })).toBeDefined()
  expect(await findAny(ui, { key: `coo-archive-${c.id}` })).toBeUndefined()
  await pressAny(ui, { key: `coo-archive-${d.id}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === d.id)!.archivedAt).toBeDefined()
  expect(stored(w).runs.find(r => r.id === c.id)!.archivedAt).toBeUndefined()
  expect(listText(w)).toBe('{ pas une liste')
})

test('archivage d’une mission livrée qui a sa carte de rétro : la mission s’archive, la carte reste ; la liste réparée, « ✕ Retirer » la retire', { timeoutMs: 30000 }, async ($, on) => {
  const d = delivered('Mission livrée')
  const retro = retroCard(d, null, NOW - MIN)
  const { clock, w } = await cooHere($, on, [d], w => putList(w, [retro]))
  putList(w, '{ pas une liste')
  await settle(clock, 6)
  const ui = await pane($)
  await pressAny(ui, { key: `coo-archive-${d.id}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.find(r => r.id === d.id)!.archivedAt).toBeDefined()
  expect(listText(w)).toBe('{ pas une liste')
  // Réparée : la carte de la mission archivée est là, avec « ✕ Retirer », qui la retire.
  putList(w, [retro])
  await settle(clock, 6)
  const again = await pane($)
  await pressAny(again, { key: `coo-card-remove-${retro.id}` })
  await again.unmount()
  await settle(clock, 1)
  expect(listOf(w).cards).toEqual([])
})

test('retrait d’une carte « Pistes de rétro » d’un dessin d’avant : rien, et le toast le dit', { timeoutMs: 30000 }, async ($, on) => {
  const K = 'kpistes01'
  const { clock, w } = await cooHere($, on, [], w => putList(w, [pistesCard(K, NOW - MIN)]))
  const ui = await pane($)
  expect(await findAny(ui, { key: `coo-card-remove-${K}` })).toBeDefined()
  putList(w, '{ pas une liste')
  await ui.press({ key: `coo-card-remove-${K}` })
  await ui.unmount()
  await settle(clock, 1)
  expect(w.toasts.at(-1)).toBe(NOTHING)
  expect(listText(w)).toBe('{ pas une liste')
})

test('livraison : elle se fait sans poser de carte de rétro ; la liste réparée, le relevé suivant la pose', { timeoutMs: 40000 }, async ($, on) => {
  const m = validated('Mission à livrer')
  const { clock, w } = await cooHere($, on, [m], w => putList(w, '{ pas une liste'))
  const press = async (key: string) => {
    const ui = await pane($)
    await ui.press({ key })
    await ui.unmount()
  }
  const report = async (step: string, detail: string) => call($, { delivery: { step, ok: true, detail } })
  await press('coo-deliver')
  await report('version', 'flow-board 0.80.0')
  await settle(clock, 6)
  await report('push', 'main → origin/main')
  await settle(clock, 6)
  expect(await report('project', 'export public fait')).toMatch(/Delivery done/)
  await settle(clock, 6)
  expect(stored(w).runs.find(r => r.id === m.id)!.status).toBe('done')
  expect(listText(w)).toBe('{ pas une liste')
  putList(w, [])
  await settle(clock, 6)
  expect(listOf(w).cards.map(c => c.title)).toEqual(['Rétrospective · Mission à livrer'])
})

test('découpage de pistes : rien, et le toast le dit ; les pistes « validée » ne sont pas montrées avec une carte', { timeoutMs: 30000 }, async ($, on) => {
  const piste = (id: string, over: Partial<Piste> = {}): Piste => ({ id, retro: 'retroA', text: `Texte de ${id}`, files: [`hooks/${id.slice(-2)}.ts`], state: 'pending', by: 'retroA', at: NOW - 1000, history: [], comments: [], ...over })
  const list: Waitlist = { ...emptyWaitlist(''), pistes: [piste('retroA/p1'), piste('retroA/p2', { state: 'validated', card: 'kpistes01' })] }
  const { clock, w } = await cooHere($, on, [], w => {
    putList(w, '{ pas une liste')
    w.files[PISTES] = JSON.stringify(list)
    w.mem['coo-pistes:'] = list
  })
  const ui = await pane($)
  await pressAny(ui, { key: 'coo-piste-tick-retroA/p1' })
  await ui.unmount()
  const again = await pane($)
  const shown = await allTexts(again)
  expect(shown).not.toContain('carte absente')
  expect(shown).toContain('1 piste validée ou en ticket, pas montrée')
  await pressAny(again, { key: 'coo-pistes-cut-go' })
  await again.unmount()
  await settle(clock, 1)
  expect(w.toasts.at(-1)).toBe(NOTHING)
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${PISTES}`))
  expect(pistesOf((path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist).map(p => p.state)).toEqual(['pending', 'validated'])
  expect(listText(w)).toBe('{ pas une liste')
})

test('pistes « validée » sur une carte dite disparue, le siège tenu depuis plus de 11 minutes : aucune nouvelle carte, aucune piste déplacée ; le relevé dit la liste illisible', { timeoutMs: 60000 }, async ($, on) => {
  const piste: Piste = { id: 'retroA/p1', retro: 'retroA', text: 'Texte', files: [], state: 'validated', card: 'kperdue01', by: 'retroA', at: NOW - 1000, history: [], comments: [] }
  const list: Waitlist = { ...emptyWaitlist(''), pistes: [piste] }
  const { clock, w } = await cooHere($, on, [], w => {
    putList(w, '{ pas une liste')
    w.files[PISTES] = JSON.stringify(list)
    w.mem['coo-pistes:'] = list
  })
  for (let i = 0; i < Math.ceil((LAUNCH_TTL_MS + LAUNCH_GRACE_MS + CLOCK_SKEW_MS) / 5000) + 2; i++) await clock.advance(5000)
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${PISTES}`))
  expect(pistesOf((path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist).map(p => p.card)).toEqual(['kperdue01'])
  expect(listText(w)).toBe('{ pas une liste')
  expect(await statement($)).toContain('new card for « validée » pistes goes through')
})

test('compaction d’office du COO : pas tant que la liste ne se lit pas (un lancement peut être en cours) ; relisible, elle se fait', { timeoutMs: 40000 }, async ($, on) => {
  on('session.usage', () => ({ value: { context: { tokens: 500_000, window: 1_000_000, percent: 50 } } }) as any)
  const { clock, w } = await cooHere($, on, [], w => putList(w, '{ pas une liste'))
  await settle(clock, 12)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(0)
  putList(w, [])
  await settle(clock, 6)
  expect(w.runs.filter(c => c === 'compact')).toHaveLength(1)
})

test('pistes d’une mission « Pistes de rétro » finie : aucune carte posée, aucune piste déplacée tant que la liste ne se lit pas ; relisible, elles passent', { timeoutMs: 60000 }, async ($, on) => {
  const K = 'kpistes01'
  const FOLDER = 'pistes-de-retro-pistes01'
  const finished = { ...newRun('implement', NOW - 50_000, 'Pistes de rétro'), id: 'mpistes1', status: 'done', launch: { id: 'lpistes0001', card: K, at: NOW - 60_000, folder: FOLDER, start: 'to-tickets', mode: 'auto' }, tickets: [{ id: '01', name: 'Un', status: 'done' }, { id: '02', name: 'Deux', status: 'todo' }], groups: [{ id: 'A', name: 'a', tickets: ['01'] }, { id: 'B', name: 'b', tickets: ['02'] }] } as unknown as Run
  const piste = (id: string, over: Partial<Piste>): Piste => ({ id, retro: 'retroA', text: `Texte de ${id}`, files: [], state: 'ticket', card: K, by: 'retroA', at: NOW - 1000, history: [], comments: [], mission: 'mpistes1', ...over })
  const list: Waitlist = { ...emptyWaitlist(''), pistes: [piste('retroA/p1', { group: 'A' }), piste('retroA/p2', { state: 'running', group: 'B' })] }
  const statesOf = (w: World) => {
    const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${PISTES}`))
    return pistesOf((path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist).map(p => p.state)
  }
  const { clock, w } = await cooHere($, on, [finished], w => {
    putList(w, '{ pas une liste')
    w.files[`travail/${FOLDER}/issues/01-un.md`] = '# 01: Un\n\n**Status:** done\n\nPistes : retroA/p1\n'
    w.files[`travail/${FOLDER}/issues/02-deux.md`] = '# 02: Deux\n\n**Status:** ready-for-agent\n\nPistes : retroA/p2\n'
    w.files[PISTES] = JSON.stringify(list)
    w.mem['coo-pistes:'] = list
  })
  await settle(clock, 12)
  expect(statesOf(w)).toEqual(['ticket', 'running'])
  expect(listText(w)).toBe('{ pas une liste')
  expect(await statement($)).toContain('a finished « Pistes de rétro » mission keeps its pistes as they are')
  // La liste relisible : la piste du ticket fait passe « faite », l'autre « validée » sur une nouvelle carte.
  putList(w, [])
  await settle(clock, 12)
  expect(statesOf(w)).toEqual(['done', 'validated'])
  expect(listOf(w).cards.filter(c => String(c.folder).startsWith('pistes-de-retro-'))).toHaveLength(1)
})
// ─── Pour en sortir ───────────────────────────────────────────────────────

test('le fichier réparé : la ligne d’alerte disparaît et les cartes relues paraissent ; retiré à la main : les seules cartes de rétro dues', { timeoutMs: 40000 }, async ($, on) => {
  const c = closed('Mission close')
  const { clock, w } = await cooHere($, on, [c], w => putList(w, '{ pas une liste'))
  putList(w, [card('kcarte001')])
  await settle(clock, 6)
  const ui = await pane($)
  const shown = await allTexts(ui)
  expect(shown).not.toContain(ALERT)
  expect(await findAny(ui, { key: 'coo-card-manual-kcarte001' })).toBeDefined()
  expect(shown).toContain('Rétrospective · Mission close')
  await ui.unmount()
  // Cassée de nouveau, puis retirée à la main : la liste repart vide, seule la carte de rétro due revient.
  putList(w, '{ pas une liste')
  await settle(clock, 6)
  const p = listPath(w)
  if (p) delete w.files[p]
  delete w.files[LIST]
  delete w.mem[KEY]
  await settle(clock, 6)
  const after = await pane($)
  expect(await allTexts(after)).not.toContain(ALERT)
  expect(listOf(w).cards.map(x => x.title)).toEqual(['Rétrospective · Mission close'])
  await after.unmount()
})
