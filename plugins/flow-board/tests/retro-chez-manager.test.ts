// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { isEntryGone, keepsEntries, soundEntry, type CoordRetro } from '../hooks/coordination.ts'
import { LAUNCH_TTL_MS, launchKey, type LaunchRecord } from '../hooks/launch.ts'
import { RETRO_REFUSED_TEXT, newRun } from '../hooks/model.ts'
import { retroCardId, retroCommandArgs, retroRequestRefusal, retroTarget, retroTranscripts } from '../hooks/retro-coo.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'
import { pressAny } from './page-coo.ts'

// La rétro lancée dans la discussion du manager de la mission étudiée. Invariant : « Une demande de rétro
// n'est jamais appliquée deux fois, ni dans une discussion qui tient une mission en cours ou qui n'est pas celle de la
// mission étudiée. »

const T0 = 800_000_000
const MANAGER = 'aaaa1111-2222-3333-4444-555566667777'
const OTHER = 'bbbb1111-2222-3333-4444-555566667777'
const LAUNCH = 'labcdefgh12'

/** La mission étudiée : close, née dans la discussion du manager. */
const studiedRun = (now: number, extra: Partial<Run> = {}): Run => ({ ...newRun('implement', now - 900_000, 'Mission de B'), status: 'done', bornIn: MANAGER, updatedAt: now - 60_000, ...extra }) as Run

const recordOf = (studied: Run, extra: Partial<LaunchRecord> = {}): LaunchRecord => ({ v: 1, id: LAUNCH, card: retroCardId(studied.id), root: '', title: 'Rétrospective · Mission de B', start: 'retro', of: studied.id, mode: 'auto', effort: 'high', folder: 'retro-Mission-de-B', at: T0 - 30_000, by: 'session-COO', ...extra })

const entryOf = (studied: Run, extra: Partial<CoordRetro> = {}): CoordRetro => ({ id: 'cabcdef01', kind: 'retro', run: studied.id, at: T0 - 30_000, launch: LAUNCH, session: MANAGER, ...extra })

/** La discussion du manager chargée, la demande et le lancement posés par le COO. */
const managerWorld = (on: any, o: { runs: Run[]; record?: LaunchRecord | null; entry: CoordRetro; here?: string }): World => {
  const w = world(on)
  w.ids.now = o.here ?? MANAGER
  writeBoard(w, b => ({ ...b, runs: o.runs }))
  if (o.record !== null && o.record !== undefined) w.mem[launchKey(o.record.id)] = o.record
  w.coord.text = coordFile([o.entry])
  return w
}

const PROOF_LAUNCH = 'lproof00001'

/**
 * Le témoin d'un refus : une seconde demande valable, pour une autre mission close de la même discussion, posée après
 * la demande refusée. Sa prise montre que le mod a bien relu et jugé le fichier (l'effet positif dans les mêmes conditions).
 */
const withProof = (w: World, here = MANAGER): void => {
  const s2 = { ...studiedRun(T0, { bornIn: here } as Partial<Run>), title: 'Témoin' } as Run
  writeBoard(w, b => ({ ...b, runs: [...b.runs, s2] }))
  w.mem[launchKey(PROOF_LAUNCH)] = recordOf(s2, { id: PROOF_LAUNCH, folder: 'retro-Temoin' })
  w.coord.text = coordFile([...JSON.parse(w.coord.text!).entries, entryOf(s2, { id: 'cproof0001', launch: PROOF_LAUNCH, session: here })])
}

/** Le témoin a été appliqué, et lui seul : la demande refusée n'a rien pris. */
const expectOnlyProof = (w: World) => {
  expect(retroRuns(w)).toHaveLength(1)
  expect((w.mem[launchKey(PROOF_LAUNCH)] as LaunchRecord).claim?.by).toBeDefined()
}

const retroRuns = (w: World): string[] => w.runs.filter(c => c.includes('retro'))

// ─── Fonctions pures ───────────────────────────────────────────────────────

test('Entrée sans mission lisible, id de mission ou de lancement hors forme, gabarit : ignorée', () => {
  const s = studiedRun(T0)
  expect(soundEntry(entryOf(s))).not.toBeNull()
  expect(soundEntry({ ...entryOf(s), run: undefined })).toBeNull()
  expect(soundEntry({ ...entryOf(s), run: '../x' })).toBeNull()
  expect(soundEntry({ ...entryOf(s), launch: 'pas-un-lancement' })).toBeNull()
  expect(soundEntry({ ...entryOf(s), launch: '<id du lancement>' })).toBeNull()
  expect(soundEntry({ ...entryOf(s), session: '<session>' })).toBeNull()
  expect(soundEntry({ ...entryOf(s), session: 'session-B' })).toBeNull()
})

test('Mission absente du fichier des missions : ignorée', () => {
  const s = studiedRun(T0)
  expect(retroRequestRefusal({ entry: entryOf(s), runs: [], here: MANAGER, root: '', record: recordOf(s), isTurnOpen: false, now: T0 })).toBe('absent')
})

test('Demande plus vieille que la durée d’un lancement, ou datée du futur : jamais appliquée', () => {
  const s = studiedRun(T0)
  const base = { runs: [s], here: MANAGER, root: '', record: recordOf(s), isTurnOpen: false }
  expect(retroRequestRefusal({ ...base, entry: entryOf(s, { at: T0 - 10 * 60_000 }), now: T0 })).toBe('stale')
  expect(retroRequestRefusal({ ...base, entry: entryOf(s, { at: T0 + 5 * 60_000 }), now: T0 })).toBe('stale')
  expect(retroRequestRefusal({ ...base, entry: entryOf(s), now: T0 })).toBeNull()
})

test('la discussion désignée : celle du manager, jamais occupée ni partagée', () => {
  const s = studiedRun(T0)
  expect(retroTarget(s, [s], 'session-COO')).toBe(MANAGER)
  // Une mission en cours la tient : le chemin d'aujourd'hui.
  const busy = { ...newRun('implement', T0, 'Autre'), status: 'active', owner: MANAGER } as Run
  expect(retroTarget(s, [s, busy], 'session-COO')).toBeNull()
  // Née chez le COO : jamais.
  expect(retroTarget(s, [s], MANAGER)).toBeNull()
  // Sans id de session en forme.
  expect(retroTarget({ ...s, bornIn: 'session-B' } as Run, [s], 'session-COO')).toBeNull()
})

test('les arguments de la commande disent la discussion du manager, jamais « la nouvelle discussion »', () => {
  const args = retroCommandArgs(recordOf(studiedRun(T0)))
  expect(args).toContain('lancée par le COO dans cette discussion, celle du manager de la mission étudiée')
  expect(args).toContain(`{"launch": "${LAUNCH}"}`)
  expect(args).toContain('travail/retro-Mission-de-B/')
  expect(args).not.toMatch(/nouvelle discussion/)
})

test('la demande part avec sa mission effacée, et une écriture qui la perdrait est refusée', () => {
  const s = studiedRun(T0)
  const e = entryOf(s)
  expect(isEntryGone(e, id => id === s.id)).toBe(true)
  expect(isEntryGone(e, () => false)).toBe(false)
  expect(keepsEntries([e], [], () => false)).toBe(false)
  // Une version qui ne connaît pas ce genre le garde tel quel : seul son id compte pour la garde des écritures.
  expect(keepsEntries([{ ...e, kind: 'inconnu' }], [{ ...e, kind: 'inconnu' }], () => false)).toBe(true)
})

test('le brief nomme le transcript de la discussion où la rétro tourne, sans changer la liste', () => {
  const s = studiedRun(T0, { owner: OTHER } as Partial<Run>)
  const listed = [{ path: `/p/${MANAGER}.jsonl`, id: MANAGER }, { path: `/p/${OTHER}.jsonl`, id: OTHER }]
  const got = retroTranscripts(s, listed, MANAGER)
  expect(got.found).toEqual(retroTranscripts(s, listed).found)
  expect(got.own).toEqual([`/p/${MANAGER}.jsonl`])
  expect(retroTranscripts(s, listed).own).toBeUndefined()
  expect(retroTranscripts(s, listed, 'cccc1111-2222-3333-4444-555566667777').own).toEqual([])
})

// ─── Monde du COO ──────────────────────────────────────────────────────────

test('Tout tient : prise du lancement, puis commande, une seule fois', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  const w = managerWorld(on, { runs: [s], record: recordOf(s), entry: entryOf(s) })
  await start($)
  await settle(clock, 12)
  expect(retroRuns(w)).toHaveLength(1)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim?.by).toBe(MANAGER)
  expect(w.mem['coo-applied:' + s.id]).toEqual(['cabcdef01'])
  // Rejouée (relectures suivantes, mod rechargé) : rien de plus.
  await settle(clock, 30)
  expect(retroRuns(w)).toHaveLength(1)
})

test('rejouée après un rechargement (la prise d’ici reste) : rien n’est relancé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  // Le lancement déjà pris ici, la demande pas notée appliquée (notée perdue) : la prise suffit à ne rien relancer.
  const w = managerWorld(on, { runs: [s], record: recordOf(s, { claim: { by: MANAGER, at: T0 - 20_000 } }), entry: entryOf(s) })
  withProof(w)
  await start($)
  await settle(clock, 20)
  expectOnlyProof(w)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim?.at).toBe(T0 - 20_000)
})

test('Mission d’une autre discussion (ni bornIn ni owner n’est celle-ci) : ignorée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  // La demande nomme le manager, cette discussion est une autre : rien, et le lancement reste libre.
  const w = managerWorld(on, { runs: [s], record: recordOf(s), entry: entryOf(s), here: OTHER })
  withProof(w, OTHER)
  await start($)
  await settle(clock, 15)
  expectOnlyProof(w)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim).toBeUndefined()
  // Une demande qui nommerait cette discussion pour une mission qui n'y est ni née ni tenue : rien non plus.
  const w2 = { runs: [s], here: OTHER, root: '', record: recordOf(s), isTurnOpen: false, now: T0 }
  expect(retroRequestRefusal({ ...w2, entry: entryOf(s, { session: OTHER }) })).toBe('other')
})

for (const [name, extra] of [
  ['archivée', { archivedAt: T0 - 5_000 }],
  ['reprise (plus close)', { status: 'active', owner: OTHER }],
] as const) {
  test(`Mission ${name} : pas appliquée`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const s = studiedRun(T0, extra as Partial<Run>)
    const w = managerWorld(on, { runs: [s], record: recordOf(s), entry: entryOf(s) })
    withProof(w)
    await start($)
    await settle(clock, 15)
    expectOnlyProof(w)
    expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim).toBeUndefined()
  })
}

test('Mission qui a déjà une rétro : pas appliquée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  const retro = { ...newRun('retro', T0 - 100_000, 'Rétrospective · Mission de B'), status: 'done', launch: { id: 'lzzzzzzzz99', card: retroCardId(s.id), at: T0 - 200_000, folder: 'retro-old', start: 'retro', of: s.id, mode: 'manual' } } as unknown as Run
  const w = managerWorld(on, { runs: [s, retro], record: recordOf(s), entry: entryOf(s) })
  withProof(w)
  await start($)
  await settle(clock, 15)
  expectOnlyProof(w)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim).toBeUndefined()
})

test('Une mission en cours dans cette discussion : pas appliquée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  const busy = { ...newRun('implement', T0 - 50_000, 'Autre mission'), status: 'active', owner: MANAGER } as Run
  // Le témoin : une demande pour une mission archivée, posée après, qui se note vue (le hook a bien relu et jugé le fichier).
  const gone = { ...studiedRun(T0, { archivedAt: T0 - 5_000 } as Partial<Run>), title: 'Archivée' } as Run
  const w = managerWorld(on, { runs: [s, busy, gone], record: recordOf(s), entry: entryOf(s) })
  w.coord.text = coordFile([entryOf(s), entryOf(gone, { id: 'cgone00001', launch: 'lgone000001' })])
  await start($)
  await settle(clock, 15)
  expect(w.mem['coo-applied:' + gone.id]).toEqual(['cgone00001'])
  expect(retroRuns(w)).toHaveLength(0)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim).toBeUndefined()
  expect(w.mem['coo-applied:' + s.id]).toBeUndefined()
})

test('Un tour ouvert dans cette discussion : pas prise, attend la relecture suivante, jusqu’à la péremption', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  const w = managerWorld(on, { runs: [s], record: recordOf(s), entry: entryOf(s) })
  await start($)
  await $.turn.start({ turnId: 't1', text: 'travail' } as any)
  await settle(clock, 15)
  expect(retroRuns(w)).toHaveLength(0)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim).toBeUndefined()
  // Le tour fini, la relecture suivante la prend.
  await $.turn.complete({ turnId: 't1', answer: 'fini' } as any)
  await settle(clock, 12)
  expect(retroRuns(w)).toHaveLength(1)
})

for (const [name, rec] of [
  ['absent', null],
  ['périmé', 'stale'],
  ['pris par une autre discussion', 'taken'],
  ['déjà porté par une mission', 'carried'],
] as const) {
  test(`Lancement ${name} : pas appliquée`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const s = studiedRun(T0)
    const carrier = { ...newRun('retro', T0 - 10_000, 'Rétrospective · Mission de B'), status: 'active', owner: OTHER, launch: { id: LAUNCH, card: retroCardId(s.id), at: T0 - 30_000, folder: 'retro-Mission-de-B', start: 'retro', of: s.id, mode: 'auto' } } as unknown as Run
    const record = rec === null ? null : rec === 'stale' ? recordOf(s, { at: T0 - 11 * 60_000 }) : rec === 'taken' ? recordOf(s, { claim: { by: OTHER, at: T0 - 5_000 } }) : recordOf(s)
    const w = managerWorld(on, { runs: rec === 'carried' ? [s, carrier] : [s], record, entry: entryOf(s) })
    withProof(w)
    await start($)
    await settle(clock, 15)
    expectOnlyProof(w)
    if (rec === 'taken') expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim?.by).toBe(OTHER)
    else if (rec === 'carried') expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim).toBeUndefined()
  })
}

test('une autre discussion prend le lancement pendant le délai de relecture : rien n’est lancé ici', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  const w = managerWorld(on, { runs: [s], record: recordOf(s), entry: entryOf(s) })
  // Juste après la prise d'ici (à la relecture du fichier qui suit le délai), la nouvelle discussion du repli écrit la
  // sienne : la dernière marque l'emporte.
  let isCrossed = false
  w.probe.onBoardRead = () => {
    const r = w.mem[launchKey(LAUNCH)] as LaunchRecord | undefined
    if (!isCrossed && r?.claim?.by === MANAGER) {
      isCrossed = true
      w.mem[launchKey(LAUNCH)] = { ...r, claim: { by: OTHER, at: T0 } }
    }
  }
  await start($)
  await settle(clock, 15)
  expect(isCrossed).toBe(true)
  expect(retroRuns(w)).toHaveLength(0)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim?.by).toBe(OTHER)
})

test('$.command.run refuse : la prise est rendue, et le journal de la mission étudiée le dit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  const w = managerWorld(on, { runs: [s], record: recordOf(s), entry: entryOf(s) })
  // Le moteur refuse la commande de rétro (une limite de l'hôte).
  w.probe.refuseCommand = command => command.includes('retro')
  await start($)
  await settle(clock, 15)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim).toBeUndefined()
  const after = stored(w).runs.find(r => r.id === s.id)!
  expect(after.log.some(l => l.text === RETRO_REFUSED_TEXT)).toBe(true)
})

test('au clic, la discussion du manager désignée : lancement gardé et demande écrite, la saisie du COO vide ; la prise lue, le toast le dit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-COO'
  const s = studiedRun(T0)
  writeBoard(w, b => ({ ...b, runs: [s] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(pane, { key: `coo-card-auto-${retroCardId(s.id)}` })
  await pane.unmount()
  const asked = entries(w).filter(e => e.kind === 'retro')
  expect(asked).toHaveLength(1)
  expect(asked[0]).toMatchObject({ run: s.id, session: MANAGER })
  const rec = w.mem[launchKey(asked[0].launch)] as LaunchRecord
  expect(rec).toMatchObject({ of: s.id, mode: 'auto' })
  expect(w.fills).toEqual([])
  expect(w.toasts.some(t => t.includes('demandée à la discussion du manager de la mission étudiée'))).toBe(true)
  // La discussion du manager prend le lancement : sa marque seule ne se dit pas (elle peut être rendue).
  w.mem[launchKey(rec.id)] = { ...rec, claim: { by: MANAGER, at: T0 + 10_000 } }
  await settle(clock, 12)
  expect(w.toasts.filter(t => t.includes('part dans la discussion du manager'))).toHaveLength(0)
  // La rétro née chez le manager porte le lancement : le COO le dit, une fois.
  const retro = { ...newRun('retro', T0 + 20_000, 'Rétrospective · Mission de B'), status: 'active', owner: MANAGER, bornIn: MANAGER, launch: { id: rec.id, card: retroCardId(s.id), at: rec.at, folder: rec.folder, start: 'retro', of: s.id, mode: 'auto' } } as unknown as Run
  writeBoard(w, b => ({ ...b, runs: [...b.runs, retro] }))
  await settle(clock, 30)
  const taken = w.toasts.filter(t => t.includes('part dans la discussion du manager'))
  expect(taken).toHaveLength(1)
  expect(taken[0]).toContain('L’effort de la carte ne s’y applique pas')
})

test('une demande refusée (lancement absent) ne retient pas la suivante pour la même discussion', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  const w = managerWorld(on, { runs: [s], record: recordOf(s, { id: 'lsecond0001' }), entry: entryOf(s) })
  // Une première demande, périmée, et une deuxième dont le lancement manque, avant la bonne.
  w.coord.text = coordFile([entryOf(s, { id: 'cold000001', at: T0 - 30 * 60_000 }), entryOf(s, { id: 'cgone00001', launch: 'lmissing001' }), entryOf(s, { id: 'cnew000001', launch: 'lsecond0001' })])
  await start($)
  await settle(clock, 12)
  expect(retroRuns(w)).toHaveLength(1)
  expect((w.mem[launchKey('lsecond0001')] as LaunchRecord).claim?.by).toBe(MANAGER)
})

test('Mission archivée : la demande notée vue, elle ne se relit plus', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0, { archivedAt: T0 - 5_000 })
  const w = managerWorld(on, { runs: [s], record: recordOf(s), entry: entryOf(s) })
  await start($)
  await settle(clock, 12)
  expect(w.mem['coo-applied:' + s.id]).toEqual(['cabcdef01'])
  expect(retroRuns(w)).toHaveLength(0)
})

test('au clic, l’écriture de la demande refusée : le lancement gardé est retiré, la carte redevient prête', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-COO'
  const s = studiedRun(T0)
  writeBoard(w, b => ({ ...b, runs: [s] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  // Le fichier de coordination ne se relit pas au moment du clic : rien ne s'y écrit.
  w.coord.text = coordFile([])
  w.coord.throws = true
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(pane, { key: `coo-card-auto-${retroCardId(s.id)}` })
  await pane.unmount()
  w.coord.throws = false
  expect(Object.keys(w.mem).filter(k => k.startsWith('coo-launch:'))).toEqual([])
  expect(w.toasts.some(t => t.includes('la demande de rétro ne s’écrit pas'))).toBe(true)
  expect(w.fills).toEqual([])
  // La carte redevient prête : un second clic part.
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(again, { key: `coo-card-auto-${retroCardId(s.id)}` })
  await again.unmount()
  expect(entries(w).filter(e => e.kind === 'retro')).toHaveLength(1)
})

test('sans discussion à désigner (née chez le COO) : le chemin d’aujourd’hui, la demande dans la saisie', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = MANAGER
  const s = studiedRun(T0)
  writeBoard(w, b => ({ ...b, runs: [s] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(pane, { key: `coo-card-auto-${retroCardId(s.id)}` })
  await pane.unmount()
  expect(entries(w).filter(e => e.kind === 'retro')).toHaveLength(0)
  expect(w.fills.some(t => t.includes('dans une nouvelle discussion'))).toBe(true)
})

test('la rétro née chez le manager, de la commande du mod : une mission neuve qui porte son lancement et la mission étudiée, jamais la mission en pause née ici', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  // Une rétro en pause, née dans cette discussion (une phase « retro ») : sans les arguments de la commande, elle serait reprise.
  const paused = { ...newRun('retro', T0 - 400_000, 'Rétro en pause'), status: 'paused', bornIn: MANAGER, updatedAt: T0 - 300_000 } as Run
  const w = managerWorld(on, { runs: [s, paused], record: recordOf(s), entry: entryOf(s) })
  await start($)
  await settle(clock, 12)
  expect(retroRuns(w)).toHaveLength(1)
  // La commande attend en file derrière un tour plus d'une minute : ses arguments, gardés par le mod, valent encore.
  await settle(clock, 90)
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  const call = $.tool.call({ tool: TOOL, launch: LAUNCH } as any)
  await settle(clock, 3)
  const text = String(((await call) as any).result)
  expect(text).toMatch(/Launch: consumed/)
  expect(text).toMatch(/Auto mode is ON/)
  const runs = stored(w).runs
  const retro = runs.find(r => r.id !== s.id && r.id !== paused.id)!
  expect(retro.launch).toMatchObject({ start: 'retro', of: s.id, id: LAUNCH })
  expect(retro.bornIn).toBe(MANAGER)
  expect(runs.find(r => r.id === paused.id)!.status).toBe('paused')
})

test('la commande en file trouve à son chargement une mission ouverte ici par un tour de la personne : rien ne s’ouvre, la prise est rendue', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  const w = managerWorld(on, { runs: [s], record: recordOf(s), entry: entryOf(s) })
  await start($)
  await settle(clock, 12)
  expect(retroRuns(w)).toHaveLength(1)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim?.by).toBe(MANAGER)
  // Un tour de la personne ouvre une mission avant que la commande de rétro ne se charge.
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await settle(clock, 3)
  const before = stored(w).runs.length
  const loaded = String(((await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })) as any).text)
  expect(loaded).toContain('Rétro demandée par le COO pas ouverte ici')
  await settle(clock, 3)
  const runs = stored(w).runs
  expect(runs).toHaveLength(before)
  expect(runs.filter(r => r.status === 'active')).toHaveLength(1)
  expect(runs.find(r => r.status === 'active')!.entry).not.toBe('retro')
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim).toBeUndefined()
})

test('la commande en file chargée après la péremption de son lancement, une mission ouverte ici entre-temps : rien ne s’ouvre non plus', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  const w = managerWorld(on, { runs: [s], record: recordOf(s), entry: entryOf(s) })
  await start($)
  await settle(clock, 12)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim?.by).toBe(MANAGER)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  // Le tour de la personne dure au-delà de la péremption du lancement.
  await clock.advance(LAUNCH_TTL_MS + 60_000)
  await settle(clock, 3)
  const before = stored(w).runs.length
  const loaded = String(((await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })) as any).text)
  expect(loaded).toContain('Rétro demandée par le COO pas ouverte ici')
  await settle(clock, 3)
  const runs = stored(w).runs
  expect(runs).toHaveLength(before)
  expect(runs.filter(r => r.status === 'active' && r.entry === 'retro')).toHaveLength(0)
})

test('une mission étudiée reprise dans cette discussion même : refusée comme reprise (notée vue), pas comme mission en cours', () => {
  const s = studiedRun(T0, { status: 'active', owner: MANAGER } as Partial<Run>)
  expect(retroRequestRefusal({ entry: entryOf(s), runs: [s], here: MANAGER, root: '', record: recordOf(s), isTurnOpen: false, now: T0 })).toBe('state')
})

test('une commande en file : aucune autre demande ne s’applique avant son chargement ; un /retro tapé après elle garde ses propres arguments', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  // Une rétro en pause née ici : un /retro tapé sans ligne de lancement la reprend (le chemin d'avant).
  const paused = { ...newRun('retro', T0 - 400_000, 'Rétro en pause'), status: 'paused', bornIn: MANAGER, updatedAt: T0 - 300_000 } as Run
  const w = managerWorld(on, { runs: [s, paused], record: recordOf(s), entry: entryOf(s) })
  withProof(w)
  await start($)
  await settle(clock, 20)
  // La première demande appliquée, sa commande en file : le témoin attend.
  expect(retroRuns(w)).toHaveLength(1)
  expect((w.mem[launchKey(PROOF_LAUNCH)] as LaunchRecord).claim).toBeUndefined()
  // La personne tape /retro avec ses propres arguments : ce sont les siens, sans la ligne de lancement de la commande en file.
  await $.command.run({ command: 'mattpocock-skills:retro', args: 'ma propre rétro' } as any)
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  await settle(clock, 3)
  const runs = stored(w).runs
  expect(runs.find(r => r.id === paused.id)!.status).toBe('active')
  expect(runs.filter(r => r.entry === 'retro')).toHaveLength(1)
  // La demande du COO n'a plus de commande à elle : sa prise est rendue (le COO propose son repli), jamais perdue sans signe.
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim).toBeUndefined()
})

test('Lancement à moins de deux minutes de sa péremption : pas pris (la rétro ne pourrait plus le consommer)', () => {
  const s = studiedRun(T0)
  const base = { entry: entryOf(s, { at: T0 - 9 * 60_000 }), runs: [s], here: MANAGER, root: '', isTurnOpen: false, now: T0 }
  expect(retroRequestRefusal({ ...base, record: recordOf(s, { at: T0 - 9 * 60_000 }) })).toBe('launch')
  expect(retroRequestRefusal({ ...base, record: recordOf(s, { at: T0 - 7 * 60_000 }) })).toBeNull()
})

test('une discussion qui tient le siège du COO ne prend aucune demande de rétro', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const s = studiedRun(T0)
  const w = managerWorld(on, { runs: [s], record: recordOf(s), entry: entryOf(s) })
  await start($)
  await openCoo($, clock)
  await settle(clock, 15)
  expect(retroRuns(w)).toHaveLength(0)
  expect((w.mem[launchKey(LAUNCH)] as LaunchRecord).claim).toBeUndefined()
})
