// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { launchKey, type LaunchRecord } from '../hooks/launch.ts'
import { newRun } from '../hooks/model.ts'
import { picksPrint, retroCardId } from '../hooks/retro-coo.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// La rétro lancée par le COO. Invariant : « Une piste de la rétro n'est découpée que si l'utilisateur l'a
// cochée ; une piste non cochée part dans À reprendre, jamais nulle part. »

const T0 = 700_000_000

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

const PISTES = [
  { id: 'r1', label: 'Hooks : relire le siège après un sommeil', status: 'todo' },
  { id: 'r2', label: 'Docs : borner les entrées du relevé', status: 'todo' },
  { id: 'r3', label: 'Tests : un faux moteur commun', status: 'todo' },
]

/** Une mission au rapport validé, avec un worker : elle attend sa livraison. */
const validated = (now: number): Run => {
  const run = newRun('implement', now - 90_000, 'Mission de B')
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: now - 50_000, finishedAt: now - 40_000, steps: [], items: [] }
  return { ...run, phases: [done, report], cursor: 1, status: 'active', owner: 'session-B', reportValidatedAt: now - 40_000, groups: [{ id: 'A', name: 'a', tickets: [], linked: { session: 'bbbb1111-2222-3333-4444-555566667777' } }], updatedAt: now - 1_000 } as unknown as Run
}

/** La boîte « À reprendre » d'une discussion, au fichier comme dans le stockage. */
const boxOf = (w: World, session: string): { items: any[] } | undefined => {
  const path = Object.keys(w.files).find(p => p.includes('/flow-board/a-reprendre/') && p.endsWith(`.${session}.json`))
  return (path ? JSON.parse(w.files[path]!) : w.mem[`a-reprendre::${session}`]) as { items: any[] } | undefined
}

test('livrée, la mission reçoit sa carte de rétro, recommandée parce qu’elle a eu des workers ; pas encore close (ouverte ailleurs), elle n’a pas encore « ✓ Archiver »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }], steps: [{ key: 'version', status: 'done', at: T0 - 5_000, detail: '0.80.0' }, { key: 'push', status: 'done', at: T0 - 4_000 }, { key: 'project', status: 'running', at: T0 - 3_000 }], startedAt: T0 - 9_000 }
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const done = String(((await $.tool.call({ tool: TOOL, delivery: { step: 'project', ok: true } } as any)) as any).result)
  expect(done).toMatch(/Delivery done/)
  expect(done).toMatch(/offers the retro of each delivered mission that is not itself a retro \(1 card/)
  await settle(clock, 2)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const shown = await texts(pane)
  expect(shown).toContain('Rétrospective · Mission de B')
  expect(shown).toMatch(/rétro : recommandée : elle a eu des workers/)
  // Sa clôture attend la discussion qui la tient : rien à archiver encore (tests/archiver-livrees.test.ts archive une mission close).
  expect(await pane.find({ key: `coo-card-archive-${retroCardId(run.id)}` })).toBeUndefined()
  // Sa clôture pas encore appliquée, elle n'attend pas « ✓ Archiver » : « ✕ Retirer » retire la carte (toute carte de rétro sans « ✓ Archiver »).
  expect(await pane.find({ key: `coo-card-remove-${retroCardId(run.id)}` })).toBeDefined()
  await pane.unmount()
})

test('la rétro lancée garde l’id de la mission close, prend son titre, et dit où se cochent ses pistes', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-R'
  const closed = { ...newRun('implement', T0 - 900_000, 'Mission de B'), status: 'done', archivedAt: T0 - 100_000, bornIn: 'aaaa1111-2222-3333-4444-555566667777' } as Run
  writeBoard(w, b => ({ ...b, runs: [closed] }))
  const rec: LaunchRecord = { v: 1, id: 'labcdefgh12', card: retroCardId(closed.id), root: '', title: 'Rétrospective · Mission de B', start: 'retro', of: closed.id, mode: 'manual', effort: 'high', folder: 'retro-Mission-de-B', at: T0 - 30_000, by: 'session-COO' }
  w.mem[launchKey(rec.id)] = rec
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  const call = $.tool.call({ tool: TOOL, launch: rec.id } as any)
  await settle(clock, 3)
  const text = String(((await call) as any).result)
  expect(text).toMatch(/Launch: consumed/)
  expect(text).toMatch(/retro of the delivered mission « Mission de B »/)
  expect(text).toContain('"title": "R\\u00e9trospective \\u00b7 Mission de B"')
  expect(text).toMatch(/ticks them in the COO's Coordination view/)
  // Aucun transcript sous le dossier des projets : la rétro le dit.
  expect(text).toMatch(/No transcript of it was found/)
  const run = stored(w).runs.find(r => r.id !== closed.id)!
  expect(run.launch).toMatchObject({ start: 'retro', of: closed.id })
})

/** Une rétro lancée par le COO, dans une autre discussion, qui présente ses pistes. */
const retroElsewhere = (now: number, closedId: string): Run => {
  const run = newRun('retro', now - 50_000, 'Rétrospective · Mission de B')
  const phase = { ...run.phases[0]!, items: PISTES }
  return { ...run, phases: [phase, ...run.phases.slice(1)], status: 'active', owner: 'session-R', launch: { id: 'labcdefgh12', card: retroCardId(closedId), at: now - 60_000, folder: 'retro-Mission-de-B', start: 'retro', of: closedId, mode: 'auto' } } as unknown as Run
}

test('chez le COO, les pistes de la rétro se cochent, puis « Découper la sélection » écrit les cochées et les autres', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const retro = retroElsewhere(T0, 'mclosed01')
  writeBoard(w, b => ({ ...b, runs: [retro] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/Pistes de la rétro « Rétrospective · Mission de B » · 3/)
  await pane.press({ key: `coo-retro-tick-${retro.id}-r1` })
  await pane.press({ key: `coo-retro-tick-${retro.id}-r3` })
  await pane.press({ key: `coo-retro-tick-${retro.id}-r3` })
  await pane.unmount()
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await again.press({ key: `coo-retro-pick-${retro.id}` })
  await again.unmount()
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'pick', run: retro.id, picked: ['r1'], left: ['r2', 'r3'], print: picksPrint(PISTES) })])
  await settle(clock, 6)
  const sent = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(sent)).toMatch(/Sélection des pistes de « Rétrospective · Mission de B » envoyée/)
  await sent.unmount()
})

/** La rétro portée ici, ses pistes présentées. */
const retroHere = async ($: any, clock: any, w: World): Promise<string> => {
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Rétrospective · Mission de B', items: PISTES, step: 'present' } as any)
  await settle(clock, 2)
  return stored(w).activeId!
}

test('la rétro applique la sélection : les non cochées dans « À reprendre » d’abord, puis le découpage des seules cochées', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-R'
  const runId = await retroHere($, clock, w)
  w.coord.text = coordFile([{ id: 'cpick1234', kind: 'pick', run: runId, at: T0, picked: ['r1'], left: ['r2', 'r3'], print: picksPrint(PISTES) }])
  await settle(clock, 6)
  // Les non cochées, dans la boîte de cette discussion, chacune avec sa piste.
  const box = boxOf(w, 'session-R')!.items
  expect(box).toHaveLength(2)
  expect(box.map(i => i.text).join('\n')).toContain('Docs : borner les entrées du relevé')
  expect(box.map(i => i.text).join('\n')).toContain('Tests : un faux moteur commun')
  // Écartées ici ; la cochée reste à découper, et la demande ne porte qu'elle.
  const phase = stored(w).runs.find(r => r.id === runId)!.phases[0]!
  expect(phase.items.map(i => [i.id, i.status])).toEqual([['r1', 'todo'], ['r2', 'dropped'], ['r3', 'dropped']])
  const fill = w.fills.find(f => f.includes('cochée')) ?? ''
  const cut = fill.split('Puis : ')[1] ?? ''
  expect(cut).toContain('Hooks : relire le siège après un sommeil')
  expect(cut).not.toContain('Docs : borner les entrées du relevé')
  expect(fill).toMatch(/DECISIONS\.md/)
  // Relue : rien ne s'écrit deux fois.
  await settle(clock, 10)
  expect(boxOf(w, 'session-R')!.items).toHaveLength(2)
})

test('une sélection sur des pistes changées depuis ne s’applique pas : rien n’est écarté ni découpé', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-R'
  const runId = await retroHere($, clock, w)
  const before = w.fills.length
  w.coord.text = coordFile([{ id: 'cpick1234', kind: 'pick', run: runId, at: T0, picked: ['r1'], left: ['r2'], print: picksPrint([PISTES[0]!, { ...PISTES[1]!, label: 'Docs : un autre libellé' }]) }])
  await settle(clock, 6)
  expect(boxOf(w, 'session-R')?.items ?? []).toHaveLength(0)
  expect(stored(w).runs.find(r => r.id === runId)!.phases[0]!.items.every(i => i.status === 'todo')).toBe(true)
  expect(w.fills).toHaveLength(before)
  expect(w.toasts.join('\n')).toMatch(/ne vaut plus/)
})

// ─── Ce que la revue du ticket a trouvé ──────────────────────────────────

test('une sélection envoyée ne se recoche pas chez le COO, même une fois ses non cochées écartées', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const base = retroElsewhere(T0, 'mclosed01')
  // Appliquée : r2 et r3 écartées, r1 en cours de découpage (encore à faire), et une piste r4 ajoutée depuis.
  const phase = { ...base.phases[0]!, items: [PISTES[0], { ...PISTES[1], status: 'dropped' }, { ...PISTES[2], status: 'dropped' }, { id: 'r4', label: 'Docs : une piste neuve', status: 'todo' }] }
  const retro = { ...base, phases: [phase, ...base.phases.slice(1)] } as unknown as Run
  writeBoard(w, b => ({ ...b, runs: [retro] }))
  w.coord.text = coordFile([{ id: 'cpick1234', kind: 'pick', run: retro.id, at: T0, picked: ['r1'], left: ['r2', 'r3'], print: picksPrint(PISTES) }])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const shown = await texts(pane)
  // Seule la piste neuve se coche ; r1 n'a pas de case.
  expect(shown).toMatch(/Pistes de la rétro « Rétrospective · Mission de B » · 1/)
  expect(shown).toContain('Docs : une piste neuve')
  expect(await pane.find({ key: `coo-retro-tick-${retro.id}-r1` })).toBeUndefined()
  await pane.unmount()
})

test('une piste marquée prise ailleurs après le clic n’est ni découpée ni recopiée dans « À reprendre »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-R'
  const runId = await retroHere($, clock, w)
  const other = { ...newRun('implement', T0 - 9_000, 'Autre mission'), status: 'active', owner: 'session-B' } as Run
  writeBoard(w, b => ({ ...b, runs: [...b.runs, other] }))
  const taken = (item: string, id: string) => ({ id, kind: 'taken', run: runId, at: T0, item, by: { run: other.id, ticket: '7' } })
  w.coord.text = coordFile([{ id: 'cpick1234', kind: 'pick', run: runId, at: T0, picked: ['r1', 'r3'], left: ['r2'], print: picksPrint(PISTES) }, taken('r1', 'ctak1111'), taken('r2', 'ctak2222')])
  await settle(clock, 6)
  expect(boxOf(w, 'session-R')?.items ?? []).toHaveLength(0)
  const fill = w.fills.find(f => f.includes('cochée')) ?? ''
  const cut = fill.split('Puis : ')[1] ?? ''
  expect(cut).toContain('Tests : un faux moteur commun')
  expect(cut).not.toContain('Hooks : relire le siège après un sommeil')
})

test('en auto, la rétro envoie elle-même le découpage des cochées, après avoir mis les autres dans « À reprendre »', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-R'
  const runId = await retroHere($, clock, w)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'auto-on' })
  await pane.press({ key: 'auto-confirm' })
  await pane.unmount()
  await settle(clock, 1)
  const before = w.prompts.length
  w.coord.text = coordFile([{ id: 'cpick1234', kind: 'pick', run: runId, at: T0, picked: ['r1'], left: ['r2', 'r3'], print: picksPrint(PISTES) }])
  await settle(clock, 8)
  expect(boxOf(w, 'session-R')!.items).toHaveLength(2)
  const sent = w.prompts.slice(before).filter(p => p.includes('cochée'))
  expect(sent).toHaveLength(1)
  const cut = sent[0]!.split('Puis : ')[1] ?? ''
  expect(cut).toContain('Hooks : relire le siège après un sommeil')
  expect(cut).not.toContain('Docs : borner les entrées du relevé')
})

// ─── Ce que la passe d'après les correctifs a trouvé ─────────────────────

test('une sélection rejetée par la rétro rend ses pistes à cocher chez le COO', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const base = retroElsewhere(T0, 'mclosed01')
  // r1, cochée, est passée « faite » avant l'application : la rétro rejette la sélection, r2 et r3 restent à faire.
  const phase = { ...base.phases[0]!, items: [{ ...PISTES[0], status: 'done' }, PISTES[1], PISTES[2]] }
  const retro = { ...base, phases: [phase, ...base.phases.slice(1)] } as unknown as Run
  writeBoard(w, b => ({ ...b, runs: [retro] }))
  w.coord.text = coordFile([{ id: 'cpick1234', kind: 'pick', run: retro.id, at: T0, picked: ['r1'], left: ['r2', 'r3'], print: picksPrint(PISTES) }])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/Pistes de la rétro « Rétrospective · Mission de B » · 2/)
  expect(await pane.find({ key: `coo-retro-tick-${retro.id}-r2` })).toBeDefined()
  await pane.unmount()
})

test('une piste d’une autre mission au même texte dans la boîte n’empêche pas la non cochée d’y entrer', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-R'
  await start($)
  // Une déclaration d'avant, sans mission, à la même source que la piste r2 de la rétro.
  await $.tool.call({ tool: TOOL, setAside: [{ text: 'autre chose', source: 'rétro Rétrospective · Mission de B, piste r2' }] } as any)
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Rétrospective · Mission de B', items: PISTES, step: 'present' } as any)
  await settle(clock, 2)
  const runId = stored(w).activeId!
  w.coord.text = coordFile([{ id: 'cpick1234', kind: 'pick', run: runId, at: T0, picked: ['r1', 'r3'], left: ['r2'], print: picksPrint(PISTES) }])
  await settle(clock, 6)
  const box = boxOf(w, 'session-R')!.items
  expect(box.filter(i => i.run === runId).map(i => i.text).join('\n')).toContain('Docs : borner les entrées du relevé')
  expect(stored(w).runs.find(r => r.id === runId)!.phases[0]!.items.find(i => i.id === 'r2')!.status).toBe('dropped')
})

// ─── Ce que la revue du groupe a trouvé ──────────────────────────────────

test('une livraison arrêtée après le push propose aussi la rétro des missions closes', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = validated(T0)
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }], steps: [{ key: 'version', status: 'done', at: T0 - 5_000, detail: '0.80.0' }, { key: 'push', status: 'done', at: T0 - 4_000 }, { key: 'project', status: 'failed', at: T0 - 3_000 }], startedAt: T0 - 9_000 }
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-deliver-drop' })
  await pane.unmount()
  await settle(clock, 2)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(after)).toContain('Rétrospective · Mission de B')
  await after.unmount()
})
