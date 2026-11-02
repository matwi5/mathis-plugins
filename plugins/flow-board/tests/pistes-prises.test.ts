import { expect, mock, test } from 'claude-code/testing'

import { soundEntry, takenFor, unreadTakenFor } from '../hooks/coordination.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { cooStatement, statementText } from '../hooks/coo.ts'
import type { Run } from '../types'
import { CORPUS } from './corpus.mjs'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// Les pistes prises ailleurs. Invariant : « Une piste marquée déjà prise ailleurs n'entre jamais dans un
// découpage ; une marque relue de travers la laisse découpable et le dit, jamais l'inverse. »

const NOW = 500_000_000
const PISTES = [
  { id: 'r1', label: 'Relire le siège après un sommeil', status: 'todo' },
  { id: 'r2', label: 'Borner les entrées du relevé', status: 'todo' },
]
/** L'autre mission, qui porte déjà la piste dans son ticket 7. */
const other = (title = 'Autre mission'): Run => ({ ...newRun('implement', NOW - 9000, title), status: 'active', owner: 'session-B' })
const mark = (retro: string, item: string, by: string, id = 'cabc1234') => ({ id, kind: 'taken', run: retro, at: NOW, item, by: { run: by, ticket: '7' } })

/** Une rétro ici, qui présente ses deux pistes. */
const retroHere = async ($: any) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Rétro de la boutique', items: PISTES, step: 'present' } as any)
}
const retroId = (w: ReturnType<typeof world>): string => stored(w).runs.find(r => r.title === 'Rétro de la boutique')!.id

// ─── Le module pur ────────────────────────────────────────────────────────

test('une marque se lit : sa rétro, sa piste, la mission et le ticket qui la portent ; une marque de travers se compte, sans rien marquer', () => {
  const good = mark('retro-1', 'r1', 'autre-1')
  expect(takenFor([soundEntry(good)!], 'retro-1')).toEqual(new Map([['r1', { run: 'autre-1', ticket: '7' }]]))
  const bad = [{ ...good, item: '../r1' }, { ...good, by: { run: 'retro-1', ticket: '7' } }, { ...good, by: { run: 'autre-1', ticket: '7; rm' } }]
  for (const b of bad) expect(soundEntry(b)).toBeNull()
  expect(unreadTakenFor(bad, 'retro-1')).toBe(3)
  // Le corpus hostile dans l'id de la piste ou du ticket : jamais une marque.
  for (const token of Object.values(CORPUS) as string[]) {
    expect(soundEntry({ ...good, item: `r${token}1` })).toBeNull()
    expect(soundEntry({ ...good, by: { run: 'autre-1', ticket: `7${token}` } })).toBeNull()
  }
})

test('une marque suit le libellé jugé : renumérotée, elle désigne la bonne piste ; un libellé repris par une piste écartée ne la détourne pas', () => {
  const m = soundEntry({ ...mark('retro-1', 'r1', 'autre-1'), label: 'A' })!
  expect([...takenFor([m], 'retro-1', [{ id: 'r1', label: 'B', status: 'todo' }, { id: 'r3', label: 'A', status: 'todo' }]).keys()]).toEqual(['r3'])
  const m5 = soundEntry({ ...mark('retro-1', 'r5', 'autre-1'), label: 'Borner X' })!
  expect([...takenFor([m5], 'retro-1', [{ id: 'r1', label: 'Borner X', status: 'dropped' }, { id: 'r5', label: 'Borner X', status: 'todo' }]).keys()]).toEqual(['r5'])
  // Le libellé nulle part : la marque se compte perdue (la piste reste découpable, et la vue le dit).
  expect(takenFor([m], 'retro-1', [{ id: 'r1', label: 'B', status: 'todo' }]).lost).toBe(1)
})

// ─── Le mod de la rétro ───────────────────────────────────────────────────

test('une piste marquée prise ailleurs se montre ainsi, sort de la sélection et du découpage ; l’autre reste découpable', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await retroHere($)
  const autre = other('Autre « ] mission')
  writeBoard(w, b => ({ ...b, runs: [...b.runs, autre] }))
  await settle(clock, 6)
  // Le témoin : sans marque, les deux pistes se choisissent.
  const before = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await before.find({ key: 'item-pick-r1' })).toBeDefined()
  await before.unmount()
  w.coord.text = coordFile([mark(retroId(w), 'r1', autre.id)])
  await settle(clock, 6)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await pane.find({ key: 'item-pick-r1' }), surface).toBeUndefined()
    expect(await pane.find({ key: 'item-pick-r2' }), surface).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /déjà prise par « Autre « ] mission », ticket 7/ }), surface).toBeDefined()
    if (surface === 'terminal') expect(await pane.find({ type: 'Svg' })).toBeUndefined()
    await pane.unmount()
  }
  // « Tout sélectionner » ne prend que r2, et la demande de découpage ne cite que r2.
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'items-all' })
  await pane.press({ key: 'items-split' })
  await pane.unmount()
  await settle(clock, 1)
  const request = w.fills.at(-1) ?? ''
  expect(request).toMatch(/Borner les entrées du relevé/)
  expect(request).not.toMatch(/Relire le siège après un sommeil/)
})

test('une marque de travers, ou un fichier de coordination illisible : la piste reste découpable, et la vue le dit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await retroHere($)
  await settle(clock, 1)
  const autre = other()
  writeBoard(w, b => ({ ...b, runs: [...b.runs, autre] }))
  w.coord.text = coordFile([{ ...mark(retroId(w), 'r1', autre.id), by: { run: autre.id, ticket: '7; rm -rf' } }])
  await settle(clock, 6)
  let pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'item-pick-r1' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /1 marque de piste illisible : sa piste reste découpable/ })).toBeDefined()
  await pane.unmount()
  w.coord.unread = true
  await settle(clock, 6)
  pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'item-pick-r1' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Fichier de coordination illisible : les pistes déjà prises ailleurs ne se voient pas/ })).toBeDefined()
  await pane.unmount()
})

// ─── Le COO ───────────────────────────────────────────────────────────────

test('le COO voit les pistes de la rétro et ce qu’ont pris les autres missions, et marque par « coordinate » ; une marque hors forme est refusée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const retro: Run = (() => {
    const r = newRun('retro', NOW - 8000, 'Rétro voisine')
    const phase = r.phases.find(p => p.skill === 'retro')!
    phase.items = PISTES.map(p => ({ ...p, status: 'todo' as const }))
    return { ...r, status: 'active', owner: 'session-B' }
  })()
  const autre: Run = { ...other(), tickets: [{ id: '7', name: 'Relire le siège au réveil', status: 'todo' }] }
  writeBoard(w, b => ({ ...b, runs: [retro, autre] }))
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/Retro pistes to compare before they are cut into tickets/)
  expect(opening).toMatch(/« r1 » « Relire le siège après un sommeil »/)
  expect(opening).toMatch(/already in mission « Autre mission » .*tickets « 7 » « Relire le siège au réveil »/)
  const out = String(((await $.tool.call({ tool: TOOL, coordinate: { taken: [{ mission: retro.id, item: 'r1', by: { mission: autre.id, ticket: '7' } }, { mission: retro.id, item: 'r9', by: { mission: autre.id, ticket: '7' } }] } } as any)) as any).result)
  expect(out).toMatch(/Marked taken elsewhere: 1 piste/)
  expect(out).toMatch(/Refused: item 2/)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'taken', run: retro.id, item: 'r1', by: { run: autre.id, ticket: '7' } })])
  // Marquée : elle ne se présente plus à comparer.
  const turn = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(turn).not.toMatch(/« r1 » « Relire le siège après un sommeil »/)
  expect(turn).toMatch(/« r2 » « Borner les entrées du relevé »/)
})

test('en auto, la piste marquée se déclare une fois dans « Décidé sans toi »', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await retroHere($)
  await settle(clock, 1)
  const autre = other()
  // L'auto allumé pour la rétro d'ici (sa marque d'allumage, au nom de cette discussion).
  writeBoard(w, b => ({ ...b, runs: [...b.runs.map(r => (r.title === 'Rétro de la boutique' ? { ...r, auto: { onAt: NOW, onBy: 'session-A' } } : r)), autre] }))
  await settle(clock, 6)
  w.coord.text = coordFile([mark(retroId(w), 'r1', autre.id)])
  await settle(clock, 12)
  const decided = (stored(w).runs.find(r => r.title === 'Rétro de la boutique')!.decided ?? []).filter(d => /Piste r1 déjà prise/.test(d.what))
  expect(decided).toHaveLength(1)
  expect(decided[0]).toMatchObject({ origin: 'recommendation' })
})

test('un appel qui fait avancer une piste marquée prise ailleurs, sous son id ou sous son libellé, est refusé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await retroHere($)
  await settle(clock, 1)
  const autre = other()
  writeBoard(w, b => ({ ...b, runs: [...b.runs, autre] }))
  w.coord.text = coordFile([{ ...mark(retroId(w), 'r1', autre.id), label: PISTES[0]!.label }])
  await settle(clock, 6)
  const out = String(((await $.tool.call({ tool: TOOL, items: [{ id: 'r1', label: PISTES[0]!.label, status: 'doing' }, { id: 'r2', label: PISTES[1]!.label, status: 'doing' }] } as any)) as any).result)
  expect(out).toMatch(/Refused, nothing of this call was recorded: piste r1 is marked taken elsewhere/)
  // Sous un autre id, avec le libellé jugé : refusé aussi.
  const renamed = String(((await $.tool.call({ tool: TOOL, items: [{ id: 'r9', label: PISTES[0]!.label, status: 'done' }] } as any)) as any).result)
  expect(renamed).toMatch(/Refused, nothing of this call was recorded: piste r9/)
})

test('deux rétros en même temps : chacune se compare aussi à ce que l’autre a déjà découpé', () => {
  const retro = (title: string, items: { id: string; label: string; status: 'todo' | 'doing' }[]): Run => {
    const r = newRun('retro', NOW - 8000, title)
    r.phases.find(p => p.skill === 'retro')!.items = items
    return { ...r, status: 'active' }
  }
  const a = retro('Rétro A', [{ id: 'r1', label: 'Relire le siège', status: 'todo' }])
  const b = retro('Rétro B', [
    { id: 'r3', label: 'Relire le siège au réveil', status: 'doing' },
    { id: 'r4', label: 'Autre chose', status: 'todo' },
  ])
  const text = statementText(cooStatement({ ...emptyBoard('', 'p'), runs: [a, b], activeId: null }, { now: NOW }))
  expect(text).toMatch(/already in mission « Rétro B » .*chosen pistes « r3 » « Relire le siège au réveil »/)
})

test('les titres et les pistes relus, dans le relevé du COO, ne coupent ni la ligne ni la citation, pour chaque entrée du corpus hostile', () => {
  const lines = (token: string) => {
    const r = newRun('retro', NOW - 8000, `Rétro ${token} x`)
    r.phases.find(p => p.skill === 'retro')!.items = [{ id: 'r1', label: `Piste ${token} y`, status: 'todo' }]
    const o: Run = { ...newRun('implement', NOW - 9000, `Autre ${token} z`), tickets: [{ id: '7', name: `Ticket ${token} t`, status: 'todo' }] }
    return statementText(cooStatement({ ...emptyBoard('', 'p'), runs: [{ ...r, status: 'active' }, o], activeId: null }, { now: NOW })).split('\n')
  }
  const base = lines('ok')
  const quotes = (ls: string[]) => ls.join('\n').split('«').length
  const leaks = Object.entries(CORPUS).filter(([, token]) => {
    const got = lines(token as string)
    return got.length !== base.length || quotes(got) !== quotes(base)
  })
  expect(leaks.map(([name]) => name)).toEqual([])
})

test('l’appel qui ferait avancer une piste marquée est refusé en entier ; une rétro qui renumérote ses pistes garde la marque sur la bonne', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await retroHere($)
  await settle(clock, 1)
  const autre = other()
  writeBoard(w, b => ({ ...b, runs: [...b.runs, autre] }))
  w.coord.text = coordFile([{ ...mark(retroId(w), 'r1', autre.id), label: PISTES[0]!.label }])
  await settle(clock, 6)
  await $.tool.call({ tool: TOOL, items: [{ id: 'r1', label: PISTES[0]!.label, status: 'done' }, { id: 'r2', label: PISTES[1]!.label, status: 'doing' }], complete: true } as any)
  await settle(clock, 2)
  const items = () => stored(w).runs.find(r => r.title === 'Rétro de la boutique')!.phases.flatMap(p => p.items)
  // Refusé en entier : ni r1, ni r2, ni la fin de la phase.
  expect(items().find(i => i.id === 'r1')!.status).toBe('todo')
  expect(items().find(i => i.id === 'r2')!.status).toBe('todo')
  // Le témoin : sans la piste marquée, l'appel passe.
  await $.tool.call({ tool: TOOL, items: [{ id: 'r1', label: PISTES[0]!.label, status: 'todo' }, { id: 'r2', label: PISTES[1]!.label, status: 'doing' }] } as any)
  await settle(clock, 2)
  expect(items().find(i => i.id === 'r2')!.status).toBe('doing')
  // La rétro renumérote : la piste jugée devient r3, et r1 est une autre piste. La marque suit le libellé jugé.
  await $.tool.call({ tool: TOOL, items: [{ id: 'r1', label: 'Une piste toute neuve', status: 'todo' }, { id: 'r2', label: PISTES[1]!.label, status: 'doing' }, { id: 'r3', label: PISTES[0]!.label, status: 'todo' }] } as any)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'item-pick-r1' })).toBeDefined()
  expect(await pane.find({ key: 'item-pick-r3' })).toBeUndefined()
  await pane.unmount()
})

test('le COO ne marque qu’une piste encore « à faire » : déjà découpée, elle est refusée (sa fin ne serait plus possible)', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const retro: Run = (() => {
    const r = newRun('retro', NOW - 8000, 'Rétro voisine')
    r.phases.find(p => p.skill === 'retro')!.items = [{ ...PISTES[0]!, status: 'todo' as const }, { ...PISTES[1]!, status: 'doing' as const }]
    return { ...r, status: 'active', owner: 'session-B' }
  })()
  const autre: Run = { ...other(), tickets: [{ id: '7', name: 'Relire', status: 'todo' }] }
  writeBoard(w, b => ({ ...b, runs: [retro, autre] }))
  await start($)
  await openCoo($, clock)
  const out = String(((await $.tool.call({ tool: TOOL, coordinate: { taken: [{ mission: retro.id, item: 'r2', by: { mission: autre.id, ticket: '7' } }] } } as any)) as any).result)
  expect(out).toMatch(/No piste marked taken \(refused: item 1: unknown mission, piste not « todo » in its retro/)
  expect(entries(w)).toEqual([])
})

test('une marque vise la piste de sa rétro : une seconde rétro qui reprend les mêmes ids n’est pas retirée à tort', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const retro: Run = (() => {
    const r = newRun('retro', NOW - 8000, 'Deux rétros')
    const first = r.phases.find(p => p.skill === 'retro')!
    const at = r.phases.indexOf(first)
    const done = { ...first, status: 'done' as const, items: [{ id: '2', label: 'Ancienne piste L', status: 'done' as const }] }
    const again = { ...first, status: 'active' as const, items: [{ id: '2', label: 'Nouvelle piste M', status: 'todo' as const }] }
    const phases = [...r.phases.slice(0, at), done, ...r.phases.slice(at + 1), again]
    return { ...r, phases, cursor: phases.length - 1, status: 'active', owner: 'session-B' }
  })()
  const autre = other()
  writeBoard(w, b => ({ ...b, runs: [retro, autre] }))
  w.coord.text = coordFile([{ ...mark(retro.id, '2', autre.id), label: 'Ancienne piste L' }])
  await start($)
  const opening = await openCoo($, clock)
  // La piste 2 de la seconde rétro reste à comparer : la marque de la première ne la désigne pas.
  expect(opening).toMatch(/« 2 » « Nouvelle piste M »/)
})

test('un appel qui reprend la rétro et fait avancer sa piste marquée est refusé : la garde vise la mission reprise', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await retroHere($)
  await settle(clock, 1)
  const retro = retroId(w)
  const autre = other()
  writeBoard(w, b => ({ ...b, runs: [...b.runs, autre] }))
  w.coord.text = coordFile([{ ...mark(retro, 'r1', autre.id), label: PISTES[0]!.label }])
  // Une autre mission ouverte ici : la rétro passe en pause.
  await $.tool.call({ tool: TOOL, open: { title: 'Une autre ici' } } as any)
  await settle(clock, 6)
  const out = String(((await $.tool.call({ tool: TOOL, resume: retro, items: [{ id: 'r1', status: 'doing' }] } as any)) as any).result)
  expect(out).toMatch(/Refused, nothing of this call was recorded: piste r1 is marked taken elsewhere/)
  expect(stored(w).runs.find(r => r.id === retro)!.phases.flatMap(p => p.items).find(i => i.id === 'r1')!.status).toBe('todo')
})
