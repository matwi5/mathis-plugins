// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { autoOnKey, autoOnRefusal, soundAutoOnRecord, type AutoOnRecord } from '../hooks/launch.ts'
import { isAutoOn, newRun } from '../hooks/model.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// Allumer l'auto d'une mission depuis la vue Coordination. Invariant : « L'auto d'une mission ne s'allume jamais sans
// un clic de Mathis, consommé une seule fois, par la seule discussion de cette mission, dans les 10 minutes ; une
// lecture ou une écriture ratée laisse l'auto éteint, sauf la reprise d'une pause « plus rien ne peut avancer sans toi », d'elle-même,
// dans la discussion qui l'avait allumé, une fois toutes ses questions bloquantes répondues. »

const T0 = 500_000_000

/** Une mission en manuel d'une autre discussion. */
const manualMission = (now: number, over: Partial<Run> = {}): Run => ({ ...newRun('implement', now - 60_000, 'Mission de B'), status: 'active', owner: 'session-B', updatedAt: now - 1_000, ...over }) as Run

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key })
  await pane.unmount()
}

// ─── Le modèle ────────────────────────────────────────────────────────────

const REC: AutoOnRecord = { v: 1, id: 'cabcdefgh12', run: 'r1', root: '', at: T0, by: 'coo', owner: 's1' }
const RUN = { ...newRun('implement', T0 - 60_000, 'M'), id: 'r1', status: 'active', owner: 's1' } as Run

test('un enregistrement d’allumage se relit borné ; hors forme, il ne vaut rien', () => {
  expect(soundAutoOnRecord(REC)).toEqual(REC)
  expect(soundAutoOnRecord({ ...REC, owner: '' })).toBeNull()
  expect(soundAutoOnRecord({ ...REC, at: 'demain' })).toBeNull()
  expect(soundAutoOnRecord({ ...REC, claim: { by: '' } })).toBeNull()
  expect(soundAutoOnRecord({ ...REC, v: 2 })).toBeNull()
})

test('seule la discussion qui porte la mission au clic le prend, dans les 10 minutes, sans date de l’auto d’après le clic', () => {
  expect(autoOnRefusal(REC, RUN, true, 's1', 's1', '', {}, T0 + 1_000)).toBeNull()
  // Une autre discussion, une autre mission, un autre projet, la mission pas active ici.
  expect(autoOnRefusal(REC, RUN, true, 's2', 's2', '', {}, T0 + 1_000)).toBe('other')
  expect(autoOnRefusal({ ...REC, owner: 's2' }, RUN, true, 's1', 's1', '', {}, T0 + 1_000)).toBe('other')
  expect(autoOnRefusal({ ...REC, run: 'r2' }, RUN, true, 's1', 's1', '', {}, T0 + 1_000)).toBe('other')
  expect(autoOnRefusal({ ...REC, root: '/ailleurs' }, RUN, true, 's1', 's1', '', {}, T0 + 1_000)).toBe('other')
  expect(autoOnRefusal(REC, RUN, false, 's1', 's1', '', {}, T0 + 1_000)).toBe('other')
  // Périmé, ou daté loin dans le futur.
  expect(autoOnRefusal(REC, RUN, true, 's1', 's1', '', {}, T0 + 10 * 60_000)).toBe('stale')
  expect(autoOnRefusal({ ...REC, at: T0 + 3_600_000 }, RUN, true, 's1', 's1', '', {}, T0)).toBe('stale')
  // Rejoué après un allumage, ou après une coupure.
  expect(autoOnRefusal(REC, RUN, true, 's1', 's1', '', { onAt: T0 }, T0 + 1_000)).toBe('later')
  expect(autoOnRefusal(REC, RUN, true, 's1', 's1', '', { onAt: T0 - 5, offAt: T0 + 5 }, T0 + 1_000)).toBe('later')
  // Pris par une autre discussion.
  expect(autoOnRefusal({ ...REC, claim: { by: 'x', at: T0 } }, RUN, true, 's1', 's1', '', {}, T0 + 1_000)).toBe('taken')
})

// ─── Chez le COO ──────────────────────────────────────────────────────────

test('chez le COO, une mission en manuel ouverte ailleurs porte « ⚡ Auto », puis « Confirmer » écrit l’enregistrement au nom de sa discussion', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = manualMission(T0)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect((await pane.find({ key: `coo-auto-on-${run.id}` }))?.props.label).toMatch(/Auto/)
  expect(await pane.find({ key: `coo-auto-confirm-${run.id}` })).toBeUndefined()
  await pane.unmount()
  // « Annuler » : rien d'écrit.
  await press($, `coo-auto-on-${run.id}`)
  await press($, `coo-auto-cancel-${run.id}`)
  await settle(clock, 1)
  expect(w.mem[autoOnKey(run.id)]).toBeUndefined()
  // « ⚡ Auto » puis « Confirmer ».
  await press($, `coo-auto-on-${run.id}`)
  await press($, `coo-auto-confirm-${run.id}`)
  await settle(clock, 1)
  expect(soundAutoOnRecord(w.mem[autoOnKey(run.id)])).toMatchObject({ run: run.id, owner: 'session-B', at: expect.any(Number) })
  expect(w.toasts.join('\n')).toMatch(/Allumage noté : « Mission de B » l’allume d’elle-même, dans les 10 minutes, si sa discussion est ouverte/)
  // Le COO n'allume rien lui-même : ni l'état auto, ni la date gardée d'un clic.
  expect(isAutoOn(stored(w).runs[0]!)).toBe(false)
  expect(w.mem[`auto-confirm:${run.id}`]).toBeUndefined()
})

test('chez le COO, une mission ouverte nulle part dit « Reprends-la pour l’allumer », sans bouton ; rien ne s’écrit', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = manualMission(T0, { status: 'paused', owner: undefined })
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  for (const surface of ['desktop', 'terminal'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await texts(pane)).toMatch(/Reprends-la pour l’allumer/)
    expect(await pane.find({ key: `coo-auto-on-${run.id}` })).toBeUndefined()
    await pane.unmount()
  }
  expect(w.mem[autoOnKey(run.id)]).toBeUndefined()
})

// ─── Dans la discussion de la mission ─────────────────────────────────────

/** Ouvre une mission ici, en manuel, et rend son id et la discussion qui la porte. */
const openHere = async ($: any, clock: any, w: ReturnType<typeof world>): Promise<{ id: string; owner: string }> => {
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  await settle(clock, 1)
  const run = stored(w).runs.find(r => r.id === stored(w).activeId)!
  return { id: run.id, owner: run.owner! }
}

const recordFor = (id: string, owner: string, at: number, over: Partial<AutoOnRecord> = {}): AutoOnRecord => ({ v: 1, id: 'cclick12345', run: id, root: '', at, by: 'session-COO', owner, ...over })

test('un clic valide allume l’auto une fois, au nom de cette discussion, la date du clic gardée ici ; rejoué, rien ne bouge', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const { id, owner } = await openHere($, clock, w)
  const at = T0 + 1_000
  w.mem[autoOnKey(id)] = recordFor(id, owner, at)
  await settle(clock, 8)
  const run = stored(w).runs.find(r => r.id === id)!
  expect(isAutoOn(run)).toBe(true)
  expect(run.auto).toMatchObject({ onAt: at, onBy: owner })
  expect(w.mem[`auto-confirm:${id}`]).toMatchObject({ by: owner, onAt: at })
  expect(w.mem[autoOnKey(id)]).toBeUndefined()
  // Le même clic rejoué (recopié dans le stockage) : la date de l'auto le dépasse déjà, il s'efface sans rien changer.
  w.mem[autoOnKey(id)] = recordFor(id, owner, at)
  await settle(clock, 8)
  expect(stored(w).runs.find(r => r.id === id)!.auto).toEqual(run.auto)
  expect(w.mem[autoOnKey(id)]).toBeUndefined()
})

test('rejoué après une coupure : la date d’arrêt dépasse le clic, l’auto reste éteint', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const { id, owner } = await openHere($, clock, w)
  const at = T0 + 1_000
  w.mem[autoOnKey(id)] = recordFor(id, owner, at)
  await settle(clock, 8)
  expect(isAutoOn(stored(w).runs.find(r => r.id === id)!)).toBe(true)
  await press($, 'auto-off')
  await settle(clock, 2)
  w.mem[autoOnKey(id)] = recordFor(id, owner, at)
  await settle(clock, 8)
  expect(isAutoOn(stored(w).runs.find(r => r.id === id)!)).toBe(false)
})

test('périmé, daté dans le futur, pour une autre discussion, ou pris ailleurs : l’auto reste éteint', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const { id, owner } = await openHere($, clock, w)
  const now = T0 + 1_000
  const cases: [string, AutoOnRecord, 'gone' | 'kept'][] = [
    ['périmé', recordFor(id, owner, now - 11 * 60_000), 'gone'],
    ['futur', recordFor(id, owner, now + 3_600_000), 'gone'],
    ['autre discussion', recordFor(id, 'session-X', now), 'kept'],
    ['pris ailleurs', recordFor(id, owner, now, { claim: { by: 'session-X', at: now } }), 'kept'],
  ]
  for (const [name, rec, fate] of cases) {
    w.mem[autoOnKey(id)] = rec
    await settle(clock, 8)
    expect(isAutoOn(stored(w).runs.find(r => r.id === id)!), name).toBe(false)
    expect(w.mem[autoOnKey(id)] === undefined, name).toBe(fate === 'gone')
    delete w.mem[autoOnKey(id)]
  }
  expect(w.mem[`auto-confirm:${id}`]).toBeUndefined()
})

test('une écriture ratée (la prise refusée) ou une lecture ratée du fichier des missions : l’auto reste éteint', { timeoutMs: 40000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  const { id, owner } = await openHere($, clock, w)
  // La prise ne s'écrit pas.
  w.probe.refuseStore = key => key === autoOnKey(id)
  w.mem[autoOnKey(id)] = recordFor(id, owner, T0 + 1_000, { id: 'cprise123456' })
  await settle(clock, 8)
  expect(isAutoOn(stored(w).runs.find(r => r.id === id)!)).toBe(false)
  // La date du clic ne se garde pas ici.
  w.probe.refuseStore = key => key === `auto-confirm:${id}`
  w.mem[autoOnKey(id)] = recordFor(id, owner, T0 + 1_000)
  await settle(clock, 8)
  expect(isAutoOn(stored(w).runs.find(r => r.id === id)!)).toBe(false)
  w.probe.refuseStore = undefined
  // Ce clic, déjà consommé sans allumer (son id noté appliqué), recopié tel quel : il n'allume plus rien.
  expect(w.mem[`coo-applied:${id}`]).toContain('cclick12345')
  w.mem[autoOnKey(id)] = recordFor(id, owner, T0 + 1_000)
  await settle(clock, 8)
  expect(isAutoOn(stored(w).runs.find(r => r.id === id)!)).toBe(false)
  expect(w.mem[autoOnKey(id)]).toBeUndefined()
  // Le fichier des missions ne se relit plus, entre la prise et l'allumage (pendant la seconde et demie de la relecture).
  w.mem[autoOnKey(id)] = recordFor(id, owner, T0 + 1_000, { id: 'cautre123456' })
  for (let i = 0; i < 10 && (w.mem[autoOnKey(id)] as AutoOnRecord | undefined)?.claim === undefined; i++) await settle(clock, 1)
  expect((w.mem[autoOnKey(id)] as AutoOnRecord).claim).toBeDefined()
  w.disk.unreadable = true
  await settle(clock, 3)
  w.disk.unreadable = false
  expect(isAutoOn(stored(w).runs.find(r => r.id === id)!)).toBe(false)
  // Rien n'est consommé : l'enregistrement, pris à son nom, reste.
  expect(soundAutoOnRecord(w.mem[autoOnKey(id)])?.claim).toBeDefined()
})
