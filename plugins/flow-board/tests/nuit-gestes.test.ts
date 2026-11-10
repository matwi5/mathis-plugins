// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun, startLinkedGroups } from '../hooks/model.ts'
import { NIGHT_MS, newNightWatch, parseNightLog } from '../hooks/night.ts'
import { relayFileSlug } from '../hooks/relay.ts'
import { soundEntry } from '../hooks/coordination.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, seatOf, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// Les gestes de nuit. Invariant : « Hors d'une surveillance allumée par Mathis et encore valide, aucun
// geste ne part sans son clic ; pendant la surveillance, seul un geste de la liste fermée part, une seule fois, et
// une lecture ratée de la surveillance vaut éteinte. » Chez le COO : `coordinate.night` n'écrit qu'un geste de la
// liste, pendant la surveillance valide, sur un blocage relevé, une fois. Chez la mission : le geste ne part
// qu'après avoir revérifié la surveillance et ses conditions, une seule fois, et son résultat va au journal.

const T0 = 700_000_000
const WATCH = 'nwatchabcd1'
const NAME = 'sans-projet-811c9dc5'

/** L'enregistrement de la surveillance, posé comme le COO l'écrit (fichier du poste, et `$.store` à défaut). */
const putWatch = (w: World, over: Partial<ReturnType<typeof newNightWatch>> = {}) => {
  const watch = { ...newNightWatch(WATCH, '', 'session-COO', T0 - 60_000, T0 - 30_000, 'click'), ...over }
  w.files[`flow-board/coordination/${NAME}.nuit.json`] = JSON.stringify(watch)
  w.mem['coo-night:'] = watch
}
/** Les résultats que la mission a écrits pour le COO. */
const results = (w: World): any[] => {
  // Le fichier du poste ou `$.store`, selon le mode du stockage ; un test qui pose les deux voit leur réunion, une ligne par entrée.
  const texts = [...Object.keys(w.files).filter(p => p.includes('.nuit-resultats.')).map(p => w.files[p]!), ...Object.keys(w.mem).filter(k => k.startsWith('coo-night-result:')).map(k => String(w.mem[k]))]
  const all = texts.flatMap(t => JSON.parse(t).results as any[])
  return all.filter((r, i) => all.findIndex(x => x.entry === r.entry && x.result === r.result) === i).sort((a, b) => a.at - b.at)
}
const confie = (w: World) => w.prompts.filter(p => /Confie/.test(p))

/** La mission d'ici, deux groupes (A sur x.ts, B sur y.ts), son auto allumé par une autre discussion (il n'envoie rien d'ici). */
const manager = async ($: any, on: any, seat = seatOf('session-COO', T0 - 60_000)) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, coo: { ...seat, seenAt: T0 - 1000 } }))
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ici', entry: 'implement' }, tickets: [{ id: 't1', name: 'Un', files: ['x.ts'] }, { id: 't2', name: 'Deux', files: ['y.ts'] }], groups: [{ id: 'A', name: 'Alpha', tickets: ['t1'] }, { id: 'B', name: 'Bêta', tickets: ['t2'] }] } as any)
  await settle(clock, 1)
  const here = stored(w).runs.find(r => r.title === 'Ici')!
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === here.id ? { ...r, auto: { onAt: T0 - 500, onBy: 'session-Z' } } : r)) }))
  return { clock, w, here }
}
const night = (run: string, act: string, extra: Record<string, unknown> = {}, id = 'cnight0001') => ({ id, kind: 'night', run, at: T0 - 10_000, watch: WATCH, act, ...extra })

test('chez la mission : un geste « wave » valide lance son seul groupe, une fois, et son résultat attend le COO', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  w.coord.text = coordFile([night(here.id, 'wave', { group: 'A' })])
  await settle(clock, 6)
  expect(confie(w)).toHaveLength(1)
  expect(confie(w)[0]).toMatch(/Groupe A/)
  expect(confie(w)[0]).not.toMatch(/Groupe B/)
  expect(results(w)).toEqual([expect.objectContaining({ entry: 'cnight0001', watch: WATCH, act: 'wave', group: 'A', result: 'applied' })])
  // Relu et rechargé, puis la marque « appliquée » perdue (une autre surface) : le groupe parti depuis le geste suffit.
  await start($)
  for (const k of Object.keys(w.mem)) if (k.startsWith('coo-applied:')) delete w.mem[k]
  await settle(clock, 11)
  expect(confie(w)).toHaveLength(1)
})

const refusals: [string, (w: World) => void, Record<string, unknown>?][] = [
  ['sans surveillance', () => undefined],
  ['surveillance arrêtée', w => {
    w.files[`flow-board/coordination/${NAME}.nuit.json`] = JSON.stringify({ v: 1, root: '', off: { id: WATCH, at: T0 - 5000, why: 'button' } })
    w.mem['coo-night:'] = { v: 1, root: '', off: { id: WATCH, at: T0 - 5000, why: 'button' } }
  }],
  ['surveillance expirée', w => putWatch(w, { at: T0 - NIGHT_MS - 60_000, until: T0 - 60_000 })],
  ['autre surveillance', w => putWatch(w, { id: 'nautreid999' })],
  ['siège tenu par une autre discussion', w => putWatch(w, { by: 'session-AUTRE' })],
  ['geste daté avant la surveillance', w => putWatch(w, { at: T0 - 5000, until: T0 - 5000 + NIGHT_MS })],
]
for (const [name, setup] of refusals) {
  test(`chez la mission : ${name}, le geste ne part pas et se consomme sans effet`, { timeoutMs: 30000 }, async ($, on) => {
    const { clock, w, here } = await manager($, on)
    setup(w)
    w.coord.text = coordFile([night(here.id, 'wave', { group: 'A' })])
    await settle(clock, 6)
    expect(confie(w)).toHaveLength(0)
    expect(results(w).map(r => r.result)).toEqual(['refused'])
    // Témoin : la même mission, la surveillance valide, un geste neuf part.
    putWatch(w)
    w.coord.text = coordFile([night(here.id, 'wave', { group: 'A' }), night(here.id, 'wave', { group: 'A' }, 'cnight0002')])
    await settle(clock, 6)
    expect(confie(w)).toHaveLength(1)
  })
}

test('chez la mission : une lecture ratée de la surveillance n’applique rien et ne note rien ; l’auto éteint, un geste hors liste ou mal formé ne font rien', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  w.files[`flow-board/coordination/${NAME}.nuit.json`] = '{"v":1,"id":'
  w.mem['coo-night:'] = '{"v":1,"id":'
  w.coord.text = coordFile([night(here.id, 'wave', { group: 'A' }), night(here.id, 'answer', { group: 'A' }, 'cnight0002'), night(here.id, 'wave', {}, 'cnight0003'), { ...night(here.id, 'wave', { group: 'A' }, 'cnight0004'), watch: 'pas-un-id' }])
  await settle(clock, 6)
  expect(confie(w)).toHaveLength(0)
  expect(results(w)).toEqual([])
  // L'auto éteint : consommé sans effet.
  putWatch(w)
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === here.id ? { ...r, auto: { onAt: T0 - 500, offAt: T0 - 100, offWhy: 'coupé par toi' } } : r)) }))
  await settle(clock, 6)
  expect(confie(w)).toHaveLength(0)
  expect(results(w)).toEqual([expect.objectContaining({ entry: 'cnight0001', result: 'refused', why: 'auto éteint' })])
})

test('chez la mission : « relaunch » relance une fois le groupe qui porte « relance: », et retire la question ; un second geste ne fait rien', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === here.id ? { ...r, waiting: [{ id: 'relance:A#2', blocks: { kind: 'group', id: 'A' }, text: 'Revenu deux fois', at: T0 - 20_000 }] } : r)) }))
  w.coord.text = coordFile([night(here.id, 'relaunch', { group: 'A' }), night(here.id, 'relaunch', { group: 'A' }, 'cnight0002')])
  await settle(clock, 6)
  await settle(clock, 6)
  expect(confie(w)).toHaveLength(1)
  expect(confie(w)[0]).toMatch(/Groupe A/)
  const run = stored(w).runs.find(r => r.id === here.id)!
  expect((run.waiting ?? []).some((q: any) => q.id === 'relance:A#2')).toBe(false)
  expect(results(w).map(r => `${r.entry}:${r.result}`)).toEqual(['cnight0001:applied', 'cnight0002:refused'])
})

test('chez la mission : un groupe déjà relancé pendant la surveillance ne l’est pas une seconde fois, même revenu avec une nouvelle question', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  const done = JSON.stringify({ v: 1, run: here.id, results: [{ entry: 'cnight0000', watch: WATCH, at: T0 - 20_000, act: 'relaunch', group: 'A', result: 'applied', why: 'groupe lancé' }] })
  w.files[`flow-board/coordination/${NAME}.nuit-resultats.${relayFileSlug(here.id)}.json`] = done
  w.mem[`coo-night-result::${here.id}`] = done
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === here.id ? { ...r, waiting: [{ id: 'relance:A#3', blocks: { kind: 'group', id: 'A' }, text: 'Revenu trois fois', at: T0 - 15_000 }] } : r)) }))
  w.coord.text = coordFile([night(here.id, 'relaunch', { group: 'A' })])
  await settle(clock, 6)
  expect(confie(w)).toHaveLength(0)
  expect(results(w).map(r => `${r.entry}:${r.result}`)).toEqual(['cnight0000:applied', 'cnight0001:refused'])
})

/** Une autre mission, en pause, ouverte nulle part, dont le groupe A (sur x.ts) a été confié à `linkedAt`. */
const holder = (linkedAt: number): Run => {
  const run0 = newRun('implement', linkedAt - 60_000, 'Tient')
  const b0: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run0], activeId: run0.id }
  const planned = applyReport(b0, { tickets: [{ id: 'h1', name: 'H', files: ['x.ts'] }, { id: 'h2', name: 'Z', files: ['z.ts'] }], groups: [{ id: 'A', name: 'A', tickets: ['h1'] }, { id: 'Z', name: 'Z', tickets: ['h2'] }] } as any, linkedAt - 1000).board
  const active = { ...planned, runs: planned.runs.map(r => ({ ...r, status: 'active' as const })) }
  const linked = startLinkedGroups(active, ['A'], linkedAt)!.board
  return { ...(linked.runs[0] as Run), status: 'paused' as const, owner: undefined }
}
/** Le relais du worker du groupe A de `run`, sa session finie à `ended`. */
const relayOf = (w: World, run: Run, linkedAt: number, ended: number) => {
  const relay = { v: 1, run: run.id, sessions: { 'sess-w': { group: 'A', tickets: { h1: { status: 'doing', at: linkedAt + 1000 } }, commits: 0, startedAt: linkedAt + 500, at: linkedAt + 1000, endedAt: ended } } }
  w.files[`flow-board/relais/${relayFileSlug(run.id)}.json`] = JSON.stringify(relay)
  w.mem[`relay:${run.id}`] = relay
}

test('chez la mission : « force » ne fait partir le groupe retenu qu’une fois, si le worker qui retient a fini depuis plus de 30 minutes et que sa mission n’est ouverte nulle part', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  const linkedAt = T0 - 3 * 3_600_000
  const other = holder(linkedAt)
  writeBoard(w, b => ({ ...b, runs: [...b.runs, other] }))
  // Un worker qui a fini il y a 10 minutes : rien ne part.
  relayOf(w, other, linkedAt, T0 - 10 * 60_000)
  w.coord.text = coordFile([night(here.id, 'force', { group: 'A', awaited: [{ run: other.id, group: 'A' }] })])
  await settle(clock, 6)
  expect(confie(w).some(p => /Groupe A/.test(p))).toBe(false)
  expect(results(w)).toEqual([expect.objectContaining({ entry: 'cnight0001', result: 'refused' })])
  // Fini depuis plus de 30 minutes : un geste neuf la fait partir, une fois, sans forçage écrit dans la mission.
  relayOf(w, other, linkedAt, T0 - 40 * 60_000)
  w.coord.text = coordFile([night(here.id, 'force', { group: 'A', awaited: [{ run: other.id, group: 'A' }] }), night(here.id, 'force', { group: 'A', awaited: [{ run: other.id, group: 'A' }] }, 'cnight0002')])
  await settle(clock, 6)
  await settle(clock, 6)
  expect(confie(w).filter(p => /Groupe A/.test(p))).toHaveLength(1)
  expect(stored(w).runs.find(r => r.id === here.id)!.forced ?? []).toEqual([])
  expect(results(w).map(r => `${r.entry}:${r.result}`)).toEqual(['cnight0001:refused', 'cnight0002:applied'])
})

// ─── Chez le COO ──────────────────────────────────────────────────────────

const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const button = await pane.find({ key })
  if (button) await pane.press({ key })
  await pane.unmount()
  return button
}
const staleQ = { id: 'sans-suite:B#1', blocks: { kind: 'group', id: 'B' }, text: 'Envoi resté sans suite', at: T0 - 10_000 }
const blocked = (): Run =>
  ({
    ...newRun('implement', T0 - 60_000, 'Bloquée'),
    id: 'run-1',
    status: 'active',
    owner: 'session-B',
    auto: { onAt: T0 - 30_000, onBy: 'session-B' },
    tickets: [{ id: '1', name: 'Un', status: 'todo' }],
    groups: [{ id: 'B', name: 'B', tickets: ['1'] }],
    waiting: [staleQ],
  }) as unknown as Run
const coo = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: [blocked()] }))
  await start($)
  await openCoo($, clock)
  return { clock, w }
}
const ask = async ($: any, list: unknown[]) => String(((await $.tool.call({ tool: TOOL, coordinate: { night: list } } as any)) as any).result)
const watchId = (w: World): string => {
  const path = Object.keys(w.files).find(p => p.endsWith('.nuit.json'))
  const raw = path ? JSON.parse(w.files[path]!) : w.mem[Object.keys(w.mem).find(k => k.startsWith('coo-night:'))!]
  return (typeof raw === 'string' ? JSON.parse(raw) : raw).id
}
const journal = (w: World): any[] => {
  const path = Object.keys(w.files).find(p => p.endsWith('.nuit-journal.jsonl'))
  const key = Object.keys(w.mem).find(k => k.startsWith('coo-night-log:'))
  const read = parseNightLog((path ? w.files[path] : key ? String(w.mem[key]) : '') ?? '')
  return read.state === 'read' ? read.lines.map(l => JSON.parse(l)) : []
}

test('chez le COO : sans surveillance, aucun geste ne s’écrit ; allumée, un geste d’un blocage relevé s’écrit une fois, et le journal le note', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await coo($, on)
  expect(await ask($, [{ mission: 'run-1', watch: 'nwatchabcd1', act: 'resend', group: 'B' }])).toMatch(/refused: no night watch is on/)
  expect(entries(w).filter(e => e.kind === 'night')).toEqual([])
  expect(await press($, 'coo-night-ask')).toBeDefined()
  expect(await press($, 'coo-night-confirm')).toBeDefined()
  await settle(clock, 1)
  const id = watchId(w)
  // Une autre surveillance, un geste interdit, un blocage qui n'existe pas : refusés.
  expect(await ask($, [{ mission: 'run-1', watch: 'nautreid999', act: 'resend', group: 'B' }])).toMatch(/does not name the night watch that is on/)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'answer', group: 'B' }])).toMatch(/never answer a blocking question, validate a plan or a report, deliver, or switch auto on/)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'wave', group: 'B' }])).toMatch(/does not match a blockage/)
  expect(entries(w).filter(e => e.kind === 'night')).toEqual([])
  // Le blocage relevé : écrit, une fois.
  // Sans groupe, il désigne le seul envoi resté sans suite de la mission ; avec son groupe, c'est le même geste.
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'resend' }])).toMatch(/Night gesture « resend » recorded/)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'resend', group: 'B' }])).toMatch(/already asked during this night watch/)
  expect(entries(w).filter(e => e.kind === 'night')).toEqual([expect.objectContaining({ run: 'run-1', watch: id, act: 'resend', group: 'B', question: 'sans-suite:B#1' })])
  // Le journal : chaque geste nommé pendant la surveillance valide, écrit ou refusé (un refus hors surveillance n'a pas de surveillance où se ranger).
  expect(journal(w).filter(l => l.act === 'resend').map(l => l.result)).toEqual(['written', 'refused'])
  expect(journal(w).filter(l => l.act !== 'start' && l.act !== 'resend').map(l => `${l.act}:${l.result}`)).toEqual(['answer:refused', 'wave:refused'])
  // « cutAuto » passe par l'entrée de coupure du COO.
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'cutAuto' }])).toMatch(/Auto cut recorded/)
  const cut = entries(w).filter(e => e.kind === 'cutAuto')
  expect(cut).toEqual([expect.objectContaining({ run: 'run-1', by: 'coo' })])
  // Prise par la mission (son auto éteint, « coupé par le COO ») : le journal le note, une fois.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === 'run-1' ? { ...r, auto: { onAt: T0 - 30_000, onBy: 'session-B', offAt: T0 + 5000, offWhy: 'coupé par le COO' } } : r)) }))
  await clock.advance(5000)
  await settle(clock, 12)
  expect(journal(w).filter(l => l.act === 'cutAuto').map(l => `${l.result}:${l.entry === cut[0].id}`)).toEqual(['written:true', 'applied:true'])
})

test('chez le COO : le relevé dicte l’appel des gestes de nuit, et cet appel, rejoué tel quel, s’écrit', { timeoutMs: 30000 }, async ($, on) => {
  const { clock } = await coo($, on)
  expect(await press($, 'coo-night-ask')).toBeDefined()
  expect(await press($, 'coo-night-confirm')).toBeDefined()
  await settle(clock, 1)
  const out = (await $.prompt.submit({ text: 'Message', origin: { kind: 'peer' } } as any)) as any
  const text = ((out?.context ?? []) as string[]).join('\n')
  const dictated = /send (\{"coordinate": \{"night": \[\{"mission": "<its mission id>", "watch": "(n[a-z0-9]+)", "act": "<its night gesture>", "group": "<its group, only when its line names one>"\}\]\}\})/.exec(text)
  expect(dictated).not.toBeNull()
  const call = JSON.parse(dictated![1]!.replace('<its mission id>', 'run-1').replace('<its night gesture>', 'resend').replace('<its group, only when its line names one>', 'B'))
  expect(String(((await $.tool.call({ tool: TOOL, ...call } as any)) as any).result)).toMatch(/Night gesture « resend » recorded for mission « Bloquée »/)
})

test('chez le COO : à la borne du fichier de coordination, un geste de nuit est refusé, rien n’est retiré, et le journal le note', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await coo($, on)
  expect(await press($, 'coo-night-ask')).toBeDefined()
  expect(await press($, 'coo-night-confirm')).toBeDefined()
  await settle(clock, 1)
  const full = Array.from({ length: 2000 }, (_, i) => ({ id: `cfull${String(i).padStart(4, '0')}`, kind: 'gleaned', run: 'run-1', at: T0 - 100_000 + i }))
  w.coord.text = coordFile(full)
  expect(await ask($, [{ mission: 'run-1', watch: watchId(w), act: 'resend', group: 'B' }])).toMatch(/the coordination file is full/)
  expect(entries(w)).toHaveLength(2000)
  expect(journal(w).some(l => l.act === 'resend' && l.result === 'refused' && /plein/.test(l.why))).toBe(true)
})

test('chez le COO : le résultat écrit par la mission est recopié au journal, une seule fois', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await coo($, on)
  expect(await press($, 'coo-night-ask')).toBeDefined()
  expect(await press($, 'coo-night-confirm')).toBeDefined()
  await settle(clock, 1)
  const id = watchId(w)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'resend', group: 'B' }])).toMatch(/recorded/)
  const entry = entries(w).find(e => e.kind === 'night')!
  const text = JSON.stringify({ v: 1, run: 'run-1', results: [{ entry: entry.id, watch: id, at: T0 + 2000, act: 'resend', group: 'B', result: 'applied', why: 'envoi resté sans suite renvoyé' }] })
  w.files[`flow-board/coordination/${NAME}.nuit-resultats.${relayFileSlug('run-1')}.json`] = text
  w.mem['coo-night-result::run-1'] = text
  await settle(clock, 12)
  expect(journal(w).filter(l => l.entry === entry.id)).toEqual([expect.objectContaining({ mission: 'run-1', act: 'resend', result: 'applied' })])
})

test('chez la mission : un lancement de nuit que l’app refuse (start_session) reste pour le matin, noté au résultat, la demande dans la saisie', { timeoutMs: 30000 }, async ($, on) => {
  const refusal = 'Start sessions only on the user’s own words to you here'
  on('tool.call', { tool: 'mcp__ccd_session__start_session' }, () => ({ isError: true, result: refusal, text: refusal }))
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  w.coord.text = coordFile([night(here.id, 'wave', { group: 'A' })])
  await settle(clock, 6)
  expect(confie(w)).toHaveLength(1)
  await $.turn.start({ turnId: 'nuit', text: confie(w)[0] } as any)
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 'Ici > Groupe A · Alpha', initiation: 'user_asked', prompt: 'x' } as any)
  await settle(clock, 1)
  expect(w.fills).toEqual([confie(w)[0]])
  expect(results(w)).toEqual([expect.objectContaining({ entry: 'cnight0001', result: 'refused', why: "refusé par l'app : pour le matin" })])
})

test('chez la mission : « resend » renvoie l’envoi resté sans suite, comme « ↻ Renvoyer », une fois', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  const key = 'phase:implement#1'
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === here.id ? { ...r, autoSent: [{ key, at: T0 - 50_000, staleAt: T0 - 20_000, what: 'x' }], waiting: [{ id: `sans-suite:${key}`, blocks: { kind: 'phase', id: 'implement' }, text: 'Envoi resté sans suite', at: T0 - 20_000 }] } : r)) }))
  w.coord.text = coordFile([night(here.id, 'resend', { question: `sans-suite:${key}` }), night(here.id, 'resend', { question: `sans-suite:${key}` }, 'cnight0002')])
  await settle(clock, 6)
  await settle(clock, 6)
  const run = stored(w).runs.find(r => r.id === here.id)! as any
  expect((run.waiting ?? []).some((q: any) => q.id === `sans-suite:${key}`)).toBe(false)
  expect(results(w).map(r => `${r.entry}:${r.result}`)).toEqual(['cnight0001:applied', 'cnight0002:refused'])
})

test('chez la mission : « force » ne part pas quand la mission qui retient est ouverte quelque part ; un plan illisible ne lance rien', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  const linkedAt = T0 - 3 * 3_600_000
  const other = { ...holder(linkedAt), status: 'active' as const, owner: 'session-OUVERTE' }
  writeBoard(w, b => ({ ...b, runs: [...b.runs, other] }))
  relayOf(w, other, linkedAt, T0 - 40 * 60_000)
  w.coord.text = coordFile([night(here.id, 'force', { group: 'A', awaited: [{ run: other.id, group: 'A' }] })])
  await settle(clock, 6)
  expect(confie(w)).toHaveLength(0)
  expect(results(w)).toEqual([expect.objectContaining({ entry: 'cnight0001', result: 'refused' })])
  // Une entrée de plan illisible qui vise la mission : la vague de nuit ne lance rien, et réessaie.
  w.coord.text = coordFile([night(here.id, 'force', { group: 'A', awaited: [{ run: other.id, group: 'A' }] }), night(here.id, 'wave', { group: 'B' }, 'cnight0002'), { id: 'cplanbad01', kind: 'plan', run: here.id, at: T0 }])
  await settle(clock, 12)
  expect(confie(w)).toHaveLength(0)
  expect(results(w).map(r => r.entry)).toEqual(['cnight0001'])
  // Témoin : le plan relu, le même geste part.
  w.coord.text = coordFile([night(here.id, 'force', { group: 'A', awaited: [{ run: other.id, group: 'A' }] }), night(here.id, 'wave', { group: 'B' }, 'cnight0002')])
  await settle(clock, 6)
  expect(confie(w).filter(p => /Groupe B/.test(p))).toHaveLength(1)
})

/** Une mission en auto ouverte ailleurs, trois groupes (A sur x.ts, B sur y.ts, C sur z.ts), un envoi de B resté sans suite et C revenu trop souvent. */
const rich = (): Run => {
  const run0 = { ...newRun('implement', T0 - 60_000, 'Riche'), id: 'run-1' }
  const b0: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run0], activeId: run0.id }
  const planned = applyReport(b0, { tickets: [{ id: 'r1', name: 'A', files: ['x.ts'] }, { id: 'r2', name: 'B', files: ['y.ts'] }, { id: 'r3', name: 'C', files: ['z.ts'] }], groups: [{ id: 'A', name: 'A', tickets: ['r1'] }, { id: 'B', name: 'B', tickets: ['r2'] }, { id: 'C', name: 'C', tickets: ['r3'] }] } as any, T0 - 50_000).board
  return {
    ...(planned.runs[0] as Run),
    status: 'active',
    owner: 'session-B',
    auto: { onAt: T0 - 30_000, onBy: 'session-B' },
    waiting: [
      { id: 'sans-suite:groups:B#1', blocks: { kind: 'group', id: 'B' }, text: 'Envoi resté sans suite', at: T0 - 10_000 },
      { id: 'relance:C#2', blocks: { kind: 'group', id: 'C' }, text: 'Revenu deux fois', at: T0 - 9_000 },
    ],
  } as unknown as Run
}

test('chez le COO : chaque ligne de la section « Nuit », rejouée telle que le relevé la dicte, s’écrit une fois, en entrée lisible par la mission', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const linkedAt = T0 - 3 * 3_600_000
  const other = holder(linkedAt)
  relayOf(w, other, linkedAt, T0 - 40 * 60_000)
  writeBoard(w, b => ({ ...b, runs: [rich(), other] }))
  await start($)
  await openCoo($, clock)
  expect(await press($, 'coo-night-ask')).toBeDefined()
  expect(await press($, 'coo-night-confirm')).toBeDefined()
  await settle(clock, 6)
  const out = (await $.prompt.submit({ text: 'Message', origin: { kind: 'peer' } } as any)) as any
  const text = ((out?.context ?? []) as string[]).join('\n')
  const dictated = /send (\{"coordinate": \{"night": \[\{"mission": "<its mission id>", "watch": "(n[a-z0-9]+)", "act": "<its night gesture>", "group": "<its group, only when its line names one>"\}\]\}\})/.exec(text)
  expect(dictated).not.toBeNull()
  const lines = text.split('\n').filter(l => /night gesture: (\w+)/.test(l))
  expect(lines.map(l => /night gesture: (\w+)/.exec(l)![1]).sort()).toEqual(['force', 'relaunch', 'resend'])
  for (const line of lines) {
    const mission = /\(mission id « ([^»]+) »\)/.exec(line)![1]!
    const act = /night gesture: (\w+)/.exec(line)![1]!
    const group = /\): group « ([^»]+) »/.exec(line)?.[1]
    // L'appel dicté, ses marques remplacées par ce que la ligne nomme ; sans groupe nommé, la clé « group » part.
    const call = JSON.parse(dictated![1]!.replace('<its mission id>', mission).replace('<its night gesture>', act).replace('<its group, only when its line names one>', group ?? ''))
    if (group === undefined) delete call.coordinate.night[0].group
    expect(String(((await $.tool.call({ tool: TOOL, ...call } as any)) as any).result), line).toMatch(/recorded for mission « Riche »/)
    expect(String(((await $.tool.call({ tool: TOOL, ...call } as any)) as any).result), line).toMatch(/already asked during this night watch/)
  }
  const written = entries(w).filter(e => e.kind === 'night')
  expect(written.map(e => soundEntry(e)).map(e => (e?.kind === 'night' ? e.act : null)).sort()).toEqual(['force', 'relaunch', 'resend'])
  // « cutAuto », comme le relevé le dit, sans groupe.
  const cut = JSON.parse(dictated![1]!.replace('<its mission id>', 'run-1').replace('<its night gesture>', 'cutAuto').replace('<its group, only when its line names one>', ''))
  delete cut.coordinate.night[0].group
  expect(String(((await $.tool.call({ tool: TOOL, ...cut } as any)) as any).result)).toMatch(/Auto cut recorded/)
})

test('chez la mission : un groupe revenu trop souvent se relance aussi dans la pause qu’a posée ce retour', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === here.id ? { ...r, auto: { onAt: T0 - 500, offAt: T0 - 300, offWhy: 'plus rien ne peut avancer sans toi' }, waiting: [{ id: 'relance:A#2', blocks: { kind: 'group', id: 'A' }, text: 'Revenu deux fois', at: T0 - 20_000 }] } : r)) }))
  w.coord.text = coordFile([night(here.id, 'relaunch', { group: 'A' })])
  await settle(clock, 6)
  expect(confie(w).filter(p => /Groupe A/.test(p))).toHaveLength(1)
  expect(results(w).map(r => `${r.entry}:${r.result}`)).toEqual(['cnight0001:applied'])
})

test('chez la mission : un worker qui retient, actif au relais après son compte rendu, ne se force pas', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  const linkedAt = T0 - 3 * 3_600_000
  const other = holder(linkedAt)
  writeBoard(w, b => ({ ...b, runs: [...b.runs, other] }))
  const relay = { v: 1, run: other.id, sessions: { 'sess-w': { group: 'A', tickets: { h1: { status: 'doing', at: T0 - 60_000 } }, commits: 0, startedAt: linkedAt + 500, at: T0 - 60_000, report: { text: 'Fini.', at: T0 - 50 * 60_000 } } } }
  w.files[`flow-board/relais/${relayFileSlug(other.id)}.json`] = JSON.stringify(relay)
  w.mem[`relay:${other.id}`] = relay
  w.coord.text = coordFile([night(here.id, 'force', { group: 'A', awaited: [{ run: other.id, group: 'A' }] })])
  await settle(clock, 6)
  expect(confie(w)).toHaveLength(0)
  expect(results(w)).toEqual([expect.objectContaining({ entry: 'cnight0001', result: 'refused' })])
})

test('chez la mission : « force » ne part pas quand une autre retenue que celles du geste tient encore le groupe', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  const linkedAt = T0 - 3 * 3_600_000
  const other = holder(linkedAt)
  // Une seconde mission, ouverte ailleurs, qui tient aussi x.ts : le geste ne la nomme pas.
  const second = { ...holder(linkedAt - 5000), id: 'run-autre', title: 'Autre', status: 'active' as const, owner: 'session-AUTRE' }
  writeBoard(w, b => ({ ...b, runs: [...b.runs, other, second] }))
  relayOf(w, other, linkedAt, T0 - 40 * 60_000)
  w.coord.text = coordFile([night(here.id, 'force', { group: 'A', awaited: [{ run: other.id, group: 'A' }] })])
  await settle(clock, 6)
  expect(confie(w)).toHaveLength(0)
  // Le refus vient bien de la retenue que le geste ne nomme pas (le même geste, sans elle, part : test du « force » plus haut).
  expect(results(w)).toEqual([expect.objectContaining({ entry: 'cnight0001', result: 'refused', why: 'une autre retenue tient le groupe' })])
})

test('chez le COO : un « resend » sans groupe vise l’envoi sans groupe de la mission, même à côté de celui d’un groupe', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const whole = { id: 'sans-suite:phase#1', blocks: { kind: 'phase', id: 'implement' }, text: 'Envoi de la phase resté sans suite', at: T0 - 9_000 }
  writeBoard(w, b => ({ ...b, runs: [{ ...blocked(), waiting: [staleQ, whole] } as unknown as Run] }))
  await start($)
  await openCoo($, clock)
  expect(await press($, 'coo-night-ask')).toBeDefined()
  expect(await press($, 'coo-night-confirm')).toBeDefined()
  await settle(clock, 1)
  const id = watchId(w)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'resend' }])).toMatch(/Night gesture « resend » recorded/)
  expect(await ask($, [{ mission: 'run-1', watch: id, act: 'resend', group: 'B' }])).toMatch(/Night gesture « resend » recorded/)
  const written = entries(w).filter(e => e.kind === 'night').map(e => `${e.question}:${e.group ?? '-'}`)
  expect(written).toEqual(['sans-suite:phase#1:-', 'sans-suite:B#1:B'])
})

test('chez la mission : un groupe qu’une question de la personne bloque ne part pas la nuit, même par un geste écrit', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here } = await manager($, on)
  putWatch(w)
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === here.id ? { ...r, waiting: [{ id: 'q-choix', blocks: { kind: 'group', id: 'A' }, text: 'Quel libellé ?', at: T0 - 20_000 }] } : r)) }))
  w.coord.text = coordFile([night(here.id, 'wave', { group: 'A' })])
  await settle(clock, 6)
  expect(confie(w)).toHaveLength(0)
  expect(results(w)).toEqual([expect.objectContaining({ entry: 'cnight0001', result: 'refused', why: 'une question qui t’attend bloque le groupe' })])
  // Témoin : le groupe B, libre, part.
  w.coord.text = coordFile([night(here.id, 'wave', { group: 'A' }), night(here.id, 'wave', { group: 'B' }, 'cnight0002')])
  await settle(clock, 6)
  expect(confie(w).filter(p => /Groupe B/.test(p))).toHaveLength(1)
})
