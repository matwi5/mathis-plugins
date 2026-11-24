// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { cooStatement, statementText } from '../hooks/coo.ts'
import { coordinationRows, type CooRow } from '../hooks/coo-view.tsx'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { assignNumbers, cardNumberOf, emptyNumberTable, freshNumberTable, keepsNumbers, numbersView, parseNumberTable, runNumberOf, type NumberTable } from '../hooks/numbers.ts'
import type { LaunchCard } from '../hooks/launch.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, openCoo, seatOf, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { storageMode } from './stockage.ts'

// Les numéros courts du COO. Invariant : « Un numéro court ne désigne jamais deux missions, ni deux
// cartes, ni une carte et une autre mission que celle qu'elle a lancée ; une mission ne change jamais de numéro, et
// une carte garde le sien tant qu'aucune mission ne l'a pris ; seul le COO titulaire du siège écrit la table. »

const NOW = 610_000_000
const ROOT = ''

const table = (over: Partial<NumberTable> = {}): NumberTable => ({ ...emptyNumberTable(ROOT), ...over })
const text = (over: Record<string, unknown>): string => JSON.stringify({ v: 1, root: ROOT, next: 1, cards: [], runs: [], ...over })
const card = (id: string, folder: string, at: number, launch?: LaunchCard['launch']): LaunchCard => ({
  id,
  title: `Carte ${id}`,
  start: 'grill-with-docs',
  askMatt: '1: x',
  alts: [],
  mode: 'manual',
  modeWhy: '',
  effort: 'high',
  effortWhy: '',
  folder,
  at,
  ...(launch ? { launch } : {}),
})
const mission = (id: string, startedAt: number, over: Partial<Run> = {}): Run => ({ ...newRun('implement', startedAt, `Mission ${id}`), id, startedAt, status: 'active', owner: 'session-B', ...over }) as Run
const launchOf = (folder: string, card: string, at: number, lostAt?: number) => ({ id: 'labcdefgh1', card, at, folder, start: 'grill-with-docs', mode: 'manual', ...(lostAt !== undefined ? { lostAt } : {}) })

// ─── Les formes de la table à la lecture ──────────────────────────────────

test('formes en forme : un dossier et une mission au même numéro (la carte lancée et sa mission), un dossier à plusieurs attributions (la dernière compte), une clé inconnue gardée', () => {
  const t = parseNumberTable(text({ next: 4, cards: [{ folder: 'sujet', n: 1 }, { folder: 'sujet', n: 3 }], runs: [{ run: 'run-efface', n: 1 }, { run: 'run-2', n: 2 }] }), ROOT)
  expect(t).not.toBeNull()
  expect(cardNumberOf(t!, 'SUJET')).toBe(3)
  expect(runNumberOf(t!, 'run-efface')).toBe(1)
})

test('formes hors forme : texte illisible, autre racine, valeurs hors forme, doublons, prochain numéro trop bas', () => {
  const bad = [
    '{"v":1,',
    text({ root: '/autre' }),
    text({ next: 0 }),
    text({ next: 1.5 }),
    text({ next: 3, runs: [{ run: 'run-1', n: 0 }] }),
    text({ next: 3, runs: [{ run: 'run-1', n: 100_000 }] }),
    text({ next: 3, runs: [{ run: 'run-1', n: 1.5 }] }),
    text({ next: 3, runs: [{ run: '../x', n: 1 }] }),
    text({ next: 3, cards: [{ folder: 'a/b', n: 1 }] }),
    text({ next: 3, runs: [{ run: 'run-1', n: 1 }, { run: 'run-2', n: 1 }] }),
    text({ next: 3, runs: [{ run: 'run-1', n: 1 }, { run: 'run-1', n: 2 }] }),
    text({ next: 3, cards: [{ folder: 'a', n: 1 }, { folder: 'b', n: 1 }] }),
    text({ next: 2, runs: [{ run: 'run-1', n: 2 }] }),
    JSON.stringify([1, 2]),
  ]
  for (const t of bad) expect(parseNumberTable(t, ROOT), t).toBeNull()
})

// ─── Le rattachement d'une mission sans numéro ────────────────────────────

test('un lancement vivant dont le dossier a une attribution libre prend ce numéro : « L1 » devient « M1 »', () => {
  const c = card('kabcdef1', 'sujet', NOW - 10_000, { id: 'labcdefgh1', at: NOW - 5_000, mode: 'manual' })
  const first = assignNumbers(table(), [c], [], NOW)!
  expect(first.cards).toEqual([{ folder: 'sujet', n: 1 }])
  const run = mission('run-1', NOW - 4_000, { launch: launchOf('sujet', c.id, NOW - 5_000) as any })
  const second = assignNumbers(first, [c], [run], NOW)!
  expect(runNumberOf(second, 'run-1')).toBe(1)
  expect(second.next).toBe(2)
  // La carte lancée ne montre plus de numéro à elle : sa mission le tient.
  expect(cardNumberOf(second, 'sujet')).toBeUndefined()
})

test('un lancement vivant sur un dossier sans attribution (carte lancée avant la table) prend le prochain', () => {
  const run = mission('run-1', NOW - 4_000, { launch: launchOf('sujet', 'kabcdef1', NOW - 5_000) as any })
  const t = assignNumbers(table({ next: 7 }), [], [run], NOW)!
  expect(runNumberOf(t, 'run-1')).toBe(7)
})

test('un lancement vivant sur un dossier dont une autre mission tient le numéro prend le prochain', () => {
  const run = mission('run-2', NOW - 4_000, { launch: launchOf('sujet', 'kabcdef1', NOW - 5_000) as any })
  const t = assignNumbers(table({ next: 2, cards: [{ folder: 'sujet', n: 1 }], runs: [{ run: 'run-1', n: 1 }] }), [], [run], NOW)!
  expect(runNumberOf(t, 'run-2')).toBe(2)
})

test('un lancement perdu prend le prochain ; la carte, redevenue prête, garde le sien', () => {
  const c = card('kabcdef1', 'sujet', NOW - 10_000)
  const run = mission('run-1', NOW - 4_000, { launch: launchOf('sujet', c.id, NOW - 5_000, NOW - 1_000) as any })
  const t = assignNumbers(table({ next: 2, cards: [{ folder: 'sujet', n: 1 }] }), [c], [run], NOW)!
  expect(runNumberOf(t, 'run-1')).toBe(2)
  expect(cardNumberOf(t, 'sujet')).toBe(1)
})

test('aucun lancement, née après le clic d’une carte encore « en lancement » : aucun numéro pour l’instant ; son lancement rattaché, elle prend celui de la carte (l’intervalle du lancement)', () => {
  const c = card('kabcdef1', 'sujet', NOW - 10_000, { id: 'labcdefgh1', at: NOW - 5_000, mode: 'manual' })
  const before = table({ next: 2, cards: [{ folder: 'sujet', n: 1 }] })
  const early = mission('run-1', NOW - 4_000)
  expect(assignNumbers(before, [c], [early], NOW)).toBeNull()
  const attached = { ...early, launch: launchOf('sujet', c.id, NOW - 5_000) as any }
  expect(runNumberOf(assignNumbers(before, [c], [attached], NOW)!, 'run-1')).toBe(1)
})

test('aucun lancement, sinon : le prochain (née avant le clic, ou aucune carte en lancement)', () => {
  const c = card('kabcdef1', 'sujet', NOW - 10_000, { id: 'labcdefgh1', at: NOW - 5_000, mode: 'manual' })
  const older = mission('run-1', NOW - 6_000)
  const t = assignNumbers(table({ next: 2, cards: [{ folder: 'sujet', n: 1 }] }), [c], [older], NOW)!
  expect(runNumberOf(t, 'run-1')).toBe(2)
  expect(runNumberOf(assignNumbers(table(), [], [mission('run-9', NOW)], NOW)!, 'run-9')).toBe(1)
})

test('une mission déjà numérotée garde son numéro quoi qu’il arrive à son lancement ; la carte redevenue prête reçoit une nouvelle attribution', () => {
  const c = card('kabcdef1', 'sujet', NOW - 10_000)
  const lost = mission('run-1', NOW - 4_000, { launch: launchOf('sujet', c.id, NOW - 5_000, NOW - 1_000) as any })
  const t = assignNumbers(table({ next: 2, cards: [{ folder: 'sujet', n: 1 }], runs: [{ run: 'run-1', n: 1 }] }), [c], [lost], NOW)!
  expect(runNumberOf(t, 'run-1')).toBe(1)
  expect(cardNumberOf(t, 'sujet')).toBe(2)
  expect(t.cards).toEqual([{ folder: 'sujet', n: 1 }, { folder: 'sujet', n: 2 }])
})

test('cartes d’abord dans l’ordre de leur date, puis missions dans l’ordre de leur début ; une mission archivée n’est pas numérotée', () => {
  const t = assignNumbers(table(), [card('kbbbbbb2', 'deux', NOW - 1_000), card('kaaaaaa1', 'un', NOW - 2_000)], [mission('run-b', NOW - 100), mission('run-a', NOW - 200), mission('run-z', NOW - 300, { archivedAt: NOW - 50 })], NOW)!
  expect(t.cards).toEqual([{ folder: 'un', n: 1 }, { folder: 'deux', n: 2 }])
  expect(t.runs).toEqual([{ run: 'run-a', n: 3 }, { run: 'run-b', n: 4 }])
})

test('mission archivée puis nouvelle mission : le numéro ne ressert pas ; mission effacée : son attribution reste', () => {
  const before = table({ next: 2, runs: [{ run: 'run-efface', n: 1 }] })
  const t = assignNumbers(before, [], [mission('run-neuve', NOW)], NOW)!
  expect(t.runs).toEqual([{ run: 'run-efface', n: 1 }, { run: 'run-neuve', n: 2 }])
})

test('au plafond de 99 999, plus rien ne s’attribue', () => {
  expect(assignNumbers(table({ next: 100_000 }), [], [mission('run-1', NOW)], NOW)).toBeNull()
})

test('la garde de l’invariant refuse une écriture qui retire ou change une attribution, ou fait reculer le prochain numéro', () => {
  const before = table({ next: 3, cards: [{ folder: 'a', n: 1 }], runs: [{ run: 'run-1', n: 2 }] })
  expect(keepsNumbers(before, { ...before, next: 4, runs: [...before.runs, { run: 'run-2', n: 3 }] })).toBe(true)
  expect(keepsNumbers(before, { ...before, runs: [] })).toBe(false)
  expect(keepsNumbers(before, { ...before, runs: [{ run: 'run-1', n: 5 }], next: 6 })).toBe(false)
  expect(keepsNumbers(before, { ...before, cards: [{ folder: 'b', n: 1 }] })).toBe(false)
  expect(keepsNumbers(before, { ...before, next: 2 })).toBe(false)
  // Un ajout qui rendrait la table hors forme (un numéro déjà tenu) est refusé aussi.
  expect(keepsNumbers(before, { ...before, runs: [...before.runs, { run: 'run-2', n: 2 }] })).toBe(false)
})

test('table neuve : son prochain numéro suit le plus grand entier de 1 à 99 999 lisible dans la copie ; un entier au-delà est ignoré, la table reste en forme', () => {
  expect(freshNumberTable('{"next": 12, "runs": [{"n": 40}', ROOT).next).toBe(41)
  expect(freshNumberTable('rien', ROOT).next).toBe(1)
  const t = freshNumberTable('{"n": 123456, "m": 99999}', ROOT)
  expect(t.next).toBe(100_000)
  expect(parseNumberTable(JSON.stringify(t), ROOT)).not.toBeNull()
})

// ─── La vue et le relevé ──────────────────────────────────────────────────

const textOf = (r: CooRow | undefined): string => (r?.parts ?? []).map(p => p.text.replace(/ /g, ' ')).join(' ')

test('le numéro précède le titre dans la vue (missions, cartes, ce qui t’attend) et dans le relevé (missions, cartes, « lancée comme mission M<n> »)', () => {
  const ready = card('kaaaaaa1', 'pret', NOW - 2_000)
  // Une carte lancée n'est listée au relevé que tant que son idée reste à passer : une idée, sans feuille de route lue.
  const launched = { ...card('kbbbbbb2', 'lance', NOW - 3_000), idea: 'I1' }
  const run = mission('run-1', NOW - 1_000, { title: 'Le titre', launch: launchOf('lance', launched.id, NOW - 2_500) as any, waitsUser: { kind: 'step', since: NOW - 500 } as any })
  const t = table({ next: 3, cards: [{ folder: 'lance', n: 1 }, { folder: 'pret', n: 2 }], runs: [{ run: 'run-1', n: 1 }] })
  const s = cooStatement({ ...emptyBoard('', 'p'), runs: [run] }, { now: NOW, cards: [ready, launched], numbers: numbersView({ state: 'read', table: t }, [ready, launched]) })
  const missions = coordinationRows(s, { page: 'overview' })
  expect(textOf(missions.find(r => r.key === 'coo-mission-run-1'))).toContain('M1 Le titre')
  expect(textOf(missions.find(r => r.key === 'coo-card-kaaaaaa1'))).toContain('▶ L2 Carte kaaaaaa1')
  const todo = coordinationRows(s, { page: 'overview' })
  expect(textOf(todo.find(r => r.key === 'coo-waiting-0'))).toContain('La mission M1 « Le titre » t’attend')
  const said = statementText(s)
  expect(said).toContain('- M1 « Le titre »')
  expect(said).toContain('launch card L2 « kaaaaaa1 »')
  expect(said).toContain('as mission M1 « Le titre »')
  expect(said).toContain('je ne trouve pas M12 dans mon relevé')
})

test('le numéro précède aussi le titre dans le plan du projet, les pistes d’une rétro et les décisions opposées (la mission qui a décidé en second)', () => {
  const t = table({ next: 3, runs: [{ run: 'run-1', n: 1 }, { run: 'run-2', n: 2 }] })
  const base = cooStatement({ ...emptyBoard('', 'p'), runs: [] }, { now: NOW, numbers: numbersView({ state: 'read', table: t }, []) })
  const s = {
    ...base,
    plan: { computed: { waves: [{ units: [{ run: 'run-1', title: 'Un', group: 'A' }] }, { units: [{ run: 'run-2', title: 'Deux', group: 'B' }] }], waits: [], delivery: [{ run: 'run-1', title: 'Un' }] }, key: 'k', isValidated: false },
    retroPicks: [{ retro: 'run-2', title: 'Deux', items: [{ id: 'p1', label: 'piste', isTicked: false }], taken: [], print: 'p' }],
    decisions: { items: [], more: 0, earlier: [], contradictions: [{ question: 'q', mission: 'Un', missionId: 'run-1', other: 'Autre', subject: 'le sujet', isOtherArchived: false, isOpen: true }] },
  } as any
  const all = ['overview', 'pistes'].flatMap(page => coordinationRows(s, { page }).map(textOf)).join('\n')
  expect(all).toContain('Vague 1 M1 « Un » : A')
  expect(all).toContain('une livraison : M1 « Un »')
  expect(all).toContain('Pistes de la rétro M2 « Deux » · 1')
  expect(all).toContain('Décisions opposées sur le sujet : M1 « Un » et « Autre »')
})
test('sans table lue, aucun numéro : les lignes gardent leur texte d’avant, et le relevé dit pourquoi', () => {
  const run = mission('run-1', NOW - 1_000, { title: 'Le titre' })
  for (const state of ['unread', 'bad', 'absent'] as const) {
    const s = cooStatement({ ...emptyBoard('', 'p'), runs: [run] }, { now: NOW, numbers: numbersView({ state } as any, []) })
    expect(textOf(coordinationRows(s, { page: 'overview' }).find(r => r.key === 'coo-mission-run-1'))).not.toMatch(/M\d/)
    const said = statementText(s)
    expect(said).toContain('- « Le titre »')
    if (state === 'unread') expect(said).toContain('the table could not be read')
    if (state === 'bad') expect(said).toContain('the table is malformed')
  }
})

test('table hors forme : sur « Vue d’ensemble », dans le bloc « Projet », la ligne et le bouton « Repartir d’une table neuve »', () => {
  const s = cooStatement({ ...emptyBoard('', 'p'), runs: [] }, { now: NOW, numbers: numbersView({ state: 'bad' }, []) })
  const rows = coordinationRows(s, { page: 'overview' })
  const row = rows.find(r => r.key === 'coo-numbers-bad')
  expect(textOf(row)).toBe('⚠ Table des numéros illisible : aucun numéro n’est montré')
  expect(row?.actions?.map(a => [a.label, a.act])).toEqual([['Repartir d’une table neuve', { kind: 'numbers-fresh' }]])
  expect(rows.findIndex(r => r.key === 'coo-project')).toBeLessThan(rows.findIndex(r => r.key === 'coo-numbers-bad'))
})

// ─── Le panneau monté : l'écriture par le titulaire du siège ──────────────

const isNumbersFile = (path: string): boolean => path.includes('/flow-board/coordination/') && path.endsWith('.numeros.json')
const NUMBERS_KEY = 'coo-numbers:'
const isStore = (): boolean => storageMode() === '$.store'
/** La table écrite par le mod : au fichier (chemin entier) ou dans `$.store`. */
const tableIn = (w: World): NumberTable | undefined => {
  const path = Object.keys(w.files).find(isNumbersFile)
  if (path) return JSON.parse(w.files[path]!)
  return w.mem[NUMBERS_KEY] as NumberTable | undefined
}
/** Fait échouer (ou réussir de nouveau) l'écriture de la table, au fichier comme dans `$.store`. */
const refuseTable = (w: World, isRefused: () => boolean) => {
  w.probe.refuseWrite = path => isRefused() && isNumbersFile(path)
  w.probe.refuseStore = key => isRefused() && key === NUMBERS_KEY
}

const seated = async ($: any, on: any, runs: Run[], before?: (w: World) => void) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs }))
  before?.(w)
  await start($)
  await openCoo($, clock)
  return { clock, w }
}

/** Une page de la vue, montée au terminal, montre un texte qui répond à ce motif. */
const pageHas = async ($: any, page: string, text: RegExp): Promise<boolean> => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: `coo-page-${page}` })
  await pane.unmount()
  const shown = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const found = await shown.find({ type: 'Text', text })
  await shown.unmount()
  return found !== undefined
}

test('le titulaire du siège attribue à sa veille et écrit la table ; le numéro paraît devant la mission', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await seated($, on, [mission('run-1', NOW - 60_000, { title: 'Mission un' })])
  await settle(clock, 6)
  expect(tableIn(w)?.runs).toEqual([{ run: 'run-1', n: 1 }])
  expect(isStore() ? w.mem[NUMBERS_KEY] !== undefined : Object.keys(w.files).some(isNumbersFile)).toBe(true)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-page-overview' })
  await pane.unmount()
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await again.find({ type: 'Text', text: /^M1$/ })).toBeDefined()
  await again.unmount()
})

test('une discussion qui perd le siège n’écrit plus rien dans la table', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await seated($, on, [mission('run-1', NOW - 60_000)])
  await settle(clock, 6)
  const before = JSON.stringify(tableIn(w))
  // Une autre discussion prend le siège, puis une mission arrive : rien ne s'écrit d'ici.
  writeBoard(w, b => ({ ...b, coo: seatOf('session-Z', NOW + 6_000), runs: [...b.runs, mission('run-2', NOW)] }))
  await settle(clock, 12)
  expect(JSON.stringify(tableIn(w))).toBe(before)
})

test('le siège perdu entre la lecture de la table et l’écriture : rien n’est écrit (et sans la perte, la même écriture passe)', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await seated($, on, [mission('run-1', NOW - 60_000)])
  await settle(clock, 6)
  // Sans la perte : une mission qui arrive est numérotée.
  writeBoard(w, b => ({ ...b, runs: [...b.runs, mission('run-2', NOW)] }))
  await settle(clock, 6)
  expect(tableIn(w)?.runs).toEqual([{ run: 'run-1', n: 1 }, { run: 'run-2', n: 2 }])
  const before = JSON.stringify(tableIn(w))
  // La relecture de la table qui précède l'écriture (après le premier contrôle du siège) voit le siège pris ailleurs juste après.
  let reads = 0
  w.probe.refuseRead = key => {
    if (key === NUMBERS_KEY || isNumbersFile(key)) {
      reads++
      if (reads === 2) writeBoard(w, b => ({ ...b, coo: seatOf('session-Z', NOW + 13_000) }))
    }
    return false
  }
  writeBoard(w, b => ({ ...b, runs: [...b.runs, mission('run-3', NOW + 1)] }))
  await settle(clock, 6)
  expect(reads).toBeGreaterThanOrEqual(2)
  expect(JSON.stringify(tableIn(w))).toBe(before)
})

test('machine neuve : le dossier de coordination n’existe pas encore (sa liste lève) ; la table se lit absente et la première écriture la crée', { timeoutMs: 20000 }, async ($, on) => {
  if (storageMode() === '$.store') return
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: [mission('run-1', NOW - 60_000)] }))
  w.probe.list = dir => {
    if (dir.endsWith('/flow-board/coordination')) throw new Error(`ENOENT ${dir}`)
    return dir.endsWith('/flow-board') ? ['parcours'] : undefined
  }
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  expect(tableIn(w)?.runs).toEqual([{ run: 'run-1', n: 1 }])
})

test('une absence que `exists` dit sans que le dossier la confirme se lit comme une lecture ratée : la table n’est pas réécrite', { timeoutMs: 20000 }, async ($, on) => {
  if (storageMode() === '$.store') return
  const { clock, w } = await seated($, on, [mission('run-1', NOW - 60_000)])
  await settle(clock, 6)
  const path = Object.keys(w.files).find(isNumbersFile)!
  // Le fichier reste là, mais `exists` répond faux (un droit refusé) et le dossier le liste encore.
  delete w.files[path]
  w.probe.list = dir => (dir.endsWith('/flow-board/coordination') ? [path.slice(path.lastIndexOf('/') + 1)] : undefined)
  writeBoard(w, b => ({ ...b, runs: [...b.runs, mission('run-2', NOW)] }))
  await settle(clock, 6)
  expect(w.files[path]).toBeUndefined()
})

test('écriture ratée : aucun numéro montré, puis l’attribution se refait à la veille suivante', { timeoutMs: 20000 }, async ($, on) => {
  let isRefused = true
  const { clock, w } = await seated($, on, [mission('run-1', NOW - 60_000)], w => refuseTable(w, () => isRefused))
  await settle(clock, 6)
  expect(tableIn(w)).toBeUndefined()
  expect(await pageHas($, 'overview', /^M\d+$/)).toBe(false)
  isRefused = false
  await settle(clock, 6)
  expect(tableIn(w)?.runs).toEqual([{ run: 'run-1', n: 1 }])
  expect(await pageHas($, 'overview', /^M1$/)).toBe(true)
})

test('lecture ratée : aucun numéro montré, rien d’écrit ; relue, la table revient telle quelle', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await seated($, on, [mission('run-1', NOW - 60_000)])
  await settle(clock, 6)
  expect(await pageHas($, 'overview', /^M1$/)).toBe(true)
  const before = JSON.stringify(tableIn(w))
  let isRefused = true
  w.probe.refuseRead = key => isRefused && (key === NUMBERS_KEY || isNumbersFile(key))
  writeBoard(w, b => ({ ...b, runs: [...b.runs, mission('run-2', NOW)] }))
  await settle(clock, 6)
  expect(JSON.stringify(tableIn(w))).toBe(before)
  expect(await pageHas($, 'overview', /^M\d+$/)).toBe(false)
  isRefused = false
  await settle(clock, 6)
  expect(tableIn(w)?.runs).toEqual([{ run: 'run-1', n: 1 }, { run: 'run-2', n: 2 }])
})

test('table forgée (numéro en double) : aucun numéro, rien d’écrit par-dessus ; « Repartir d’une table neuve » garde la copie et repart au-dessus du plus grand numéro', { timeoutMs: 20000 }, async ($, on) => {
  const forged = text({ next: 3, runs: [{ run: 'run-1', n: 1 }, { run: 'run-2', n: 1 }] })
  const { clock, w } = await seated($, on, [mission('run-1', NOW - 60_000), mission('run-2', NOW - 50_000)])
  await settle(clock, 6)
  // La table que le mod vient d'écrire, remplacée par une table forgée, à son chemin réel.
  const path = Object.keys(w.files).find(isNumbersFile)
  if (path) w.files[path] = forged
  else w.mem[NUMBERS_KEY] = JSON.parse(forged)
  await settle(clock, 6)
  expect(path ? w.files[path] : JSON.stringify(w.mem[NUMBERS_KEY])).toBe(path ? forged : JSON.stringify(JSON.parse(forged)))
  expect(await pageHas($, 'overview', /Table des numéros illisible/)).toBe(true)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-numbers-fresh' })
  await pane.unmount()
  await settle(clock, 1)
  const copies = Object.keys(w.asides).filter(k => k.includes('.numeros.json.illisible-') || k.startsWith(`${NUMBERS_KEY}:illisible:`))
  expect(copies.length).toBe(1)
  expect(w.asides[copies[0]!]).toBe(path ? forged : JSON.stringify(JSON.parse(forged)))
  expect(tableIn(w)?.next).toBeGreaterThanOrEqual(4)
  expect(w.toasts.some(t => t.includes('des missions peuvent avoir changé de numéro'))).toBe(true)
})
