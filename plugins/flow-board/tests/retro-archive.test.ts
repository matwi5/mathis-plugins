// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { RETRO_END_TEXT, archiveMarkOf, newRun, retroEndOf } from '../hooks/model.ts'
import { emptyWaitlist, opMark, type Waitlist } from '../hooks/pistes.ts'
import { retroCardId } from '../hooks/retro-coo.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, coordFile, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'
import { pressAny } from './page-coo.ts'

// La fin d'une rétro lancée par sa carte archive la mission étudiée et la rétro, sans clic. Invariant : « Le COO ne
// ferme jamais une discussion qui tient encore une mission non archivée, qui a un tour ou une tâche en cours, ou qui
// est la sienne ; et une rétro n'archive rien tant qu'une de ses pistes n'est pas écrite dans la liste d'attente. »
// Et : « […] un archivage fait ailleurs sur une mission close n'est jamais défait par la copie de sa discussion,
// tandis qu'une mission en cours n'est jamais archivée sous elle. »

const T0 = 1_100_000_000
const MANAGER = 'aaaa1111-2222-3333-4444-555566667777'
const OTHER = 'bbbb1111-2222-3333-4444-555566667777'
/** Le nom des fichiers du projet de ces tests (racine vide) sur ce poste, comme `coordinationName`. */
const PROJECT = 'sans-projet-811c9dc5'

/** La mission étudiée : close sans livraison, née dans la discussion du manager. */
const studiedRun = (extra: Partial<Run> = {}): Run => ({ ...newRun('implement', T0 - 900_000, 'Mission de B'), status: 'done', bornIn: MANAGER, finishedAt: T0 - 600_000, updatedAt: T0 - 600_000, ...extra }) as Run

/** La rétro lancée par sa carte (son lancement porte la mission étudiée), close, née chez le manager. */
const retroRun = (of: string, extra: Partial<Run> = {}): Run =>
  ({ ...newRun('retro', T0 - 500_000, 'Rétrospective · Mission de B'), status: 'done', bornIn: MANAGER, finishedAt: T0 - 100_000, updatedAt: T0 - 100_000, launch: { id: 'lretro00001', card: retroCardId(of), at: T0 - 510_000, folder: 'retro-Mission-de-B', start: 'retro', of, mode: 'auto' }, ...extra }) as unknown as Run

/** Une rétro tapée à la main : sans lancement. */
const handRetro = (): Run => ({ ...newRun('retro', T0 - 500_000, 'Rétro à la main'), status: 'done', bornIn: MANAGER, finishedAt: T0 - 100_000, updatedAt: T0 - 100_000 }) as Run

/** La boîte de pistes d'une discussion, au fichier comme dans le stockage ; `text` : un contenu illisible. */
const putBox = (w: World, session: string, ops: unknown[] | null) => {
  const box = { v: 1, root: '', session, ops: ops ?? [] }
  w.files[`flow-board/pistes/boites/${PROJECT}.${session}.json`] = ops === null ? '{ illisible' : JSON.stringify(box)
  w.mem[`pistes-boite::${session}`] = ops === null ? 'illisible' : box
}
/** La liste d'attente des rétros, au fichier du poste et dans le stockage ; `null` : illisible. */
const putList = (w: World, list: Waitlist | null) => {
  w.files[`flow-board/pistes/${PROJECT}.json`] = list === null ? '{ illisible' : JSON.stringify(list)
  w.mem['coo-pistes:'] = list === null ? 'illisible' : list
}
const op = (retro: Run, id: string, over: Record<string, unknown> = {}) => ({ id, op: 'add', piste: `${retro.id}/p1`, by: retro.id, at: T0 - 50_000, text: 'Relire le siège', ...over })

/** Le COO ouvert sur ces missions, puis les relevés de quelques relectures. */
const coo = async ($: any, on: any, runs: Run[], setup: (w: World) => void = () => {}) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-COO'
  writeBoard(w, b => ({ ...b, runs }))
  setup(w)
  await start($)
  await openCoo($, clock)
  await settle(clock, 16)
  return { clock, w }
}
const runOf = (w: World, id: string): Run => stored(w).runs.find(r => r.id === id)!
const archived = (w: World): string[] => stored(w).runs.filter(r => r.archivedAt !== undefined).map(r => r.id)

/**
 * Le témoin d'un refus : une autre rétro close, lancée par sa carte, sur une autre mission close, que rien ne retient.
 * Son archivage montre que la fin des rétros a bien tourné dans les mêmes conditions.
 */
const witness = (): Run[] => {
  const s = studiedRun({ title: 'Témoin' } as Partial<Run>)
  return [s, retroRun(s.id, { id: 'mtemoin0001', title: 'Rétrospective · Témoin' } as Partial<Run>)]
}
/** Seul le témoin s'est archivé. */
const expectOnlyWitness = (w: World, wit: Run[]) => expect(archived(w).sort()).toEqual(wit.map(r => r.id).sort())

// ─── La table du ticket ───────────────────────────────────────────────────

test('Sans lancement ni mission étudiée (tapée à la main) : rien d’automatique', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun()
  const wit = witness()
  const { w } = await coo($, on, [s, handRetro(), ...wit])
  expectOnlyWitness(w, wit)
})

test('Mission étudiée hors forme, ou absente du fichier : hors forme, rien (la rétro ne se rattache pas) ; absente, la rétro seule s’archive', { timeoutMs: 30000 }, async ($, on) => {
  const odd = retroRun('../x')
  const gone = retroRun('mabsente001', { id: 'mretrogone1' } as Partial<Run>)
  const { w } = await coo($, on, [odd, gone])
  expect(archived(w)).toEqual([gone.id])
  const r = runOf(w, gone.id)
  expect(archiveMarkOf(r)).toBe('retro')
  expect(r.log[0]!.text).toBe(`${RETRO_END_TEXT} (la mission étudiée n’est plus dans le fichier des missions)`)
})

test('Mission étudiée déjà archivée : la rétro seule s’archive', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun({ archivedAt: T0 - 200_000, archivedBy: { by: 'clic', at: T0 - 200_000 } } as Partial<Run>)
  const r = retroRun(s.id)
  const { w } = await coo($, on, [s, r])
  expect(runOf(w, r.id).archivedAt).toBeDefined()
  expect(runOf(w, r.id).log[0]!.text).toBe(`${RETRO_END_TEXT} (la mission étudiée était déjà archivée)`)
  // La mission étudiée garde son archivage d'avant, et sa marque.
  expect(runOf(w, s.id).archivedAt).toBe(T0 - 200_000)
  expect(archiveMarkOf(runOf(w, s.id))).toBe('clic')
})

test('Mission étudiée reprise (plus close) : rien ne s’archive', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun({ status: 'active', owner: OTHER, finishedAt: undefined } as Partial<Run>)
  const wit = witness()
  const { w } = await coo($, on, [s, retroRun(s.id), ...wit])
  expectOnlyWitness(w, wit)
})

test('Rétro pas close, ou reprise : rien', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id, { status: 'active', owner: MANAGER, finishedAt: undefined } as Partial<Run>)
  const wit = witness()
  const { w } = await coo($, on, [s, r, ...wit])
  expectOnlyWitness(w, wit)
})

test('Une opération de la rétro attend dans sa boîte, sans marque dans la liste : rien ; marquée, l’archivage se fait', { timeoutMs: 40000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id)
  // Une modification d'une piste absente de la liste attend sans marque tant qu'une autre boîte ne se relit pas.
  const { clock, w } = await coo($, on, [s, r], w => {
    putList(w, emptyWaitlist(''))
    putBox(w, MANAGER, [op(r, 'oattend0001', { op: 'edit', piste: `${r.id}/p9` })])
    putBox(w, 'session-X', null)
  })
  expect(archived(w)).toEqual([])
  // L'autre boîte relisible : l'opération est marquée (refusée, la piste absente), et la fin de la rétro se fait.
  putBox(w, 'session-X', [])
  await settle(clock, 16)
  expect(archived(w).sort()).toEqual([s.id, r.id].sort())
})

test('une opération de la rétro dans la boîte d’une discussion qui ne la tient plus (reprise ailleurs depuis) : elle attend, rien ne s’archive', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id)
  // Son auteur ne se prouve plus (ni bornIn ni owner) : la liste ne la marque pas, et la fin de la rétro l'attend.
  const wit = witness()
  const { w } = await coo($, on, [s, r, ...wit], w => putBox(w, OTHER, [op(r, 'oailleurs01')]))
  expectOnlyWitness(w, wit)
})

test('Boîte de sa discussion absente : rien n’attend, l’archivage se fait (les deux, marque « rétro », une ligne de journal)', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id)
  const { w } = await coo($, on, [s, r])
  for (const id of [s.id, r.id]) {
    const run = runOf(w, id)
    expect(archiveMarkOf(run)).toBe('retro')
    expect(run.log[0]!.text).toBe(RETRO_END_TEXT)
  }
  // Rejouée (relevés suivants) : rien de plus.
  expect(runOf(w, r.id).log.filter(l => l.text.startsWith(RETRO_END_TEXT))).toHaveLength(1)
})

test('Boîte ou liste d’attente illisible : rien ; relisible, l’archivage se fait', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id)
  const { clock, w } = await coo($, on, [s, r], w => putBox(w, MANAGER, null))
  expect(archived(w)).toEqual([])
  putBox(w, MANAGER, [])
  await settle(clock, 16)
  expect(archived(w).sort()).toEqual([s.id, r.id].sort())
})

test('Liste d’attente illisible : rien ; relisible, l’archivage se fait', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id)
  const { clock, w } = await coo($, on, [s, r], w => putList(w, null))
  expect(archived(w)).toEqual([])
  putList(w, emptyWaitlist(''))
  await settle(clock, 16)
  expect(archived(w).sort()).toEqual([s.id, r.id].sort())
})

test('Une opération hors forme de la rétro dans une boîte : rien ; sans auteur lisible, aucune rétro ne finit', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id)
  const wit = witness()
  const { clock, w } = await coo($, on, [s, r, ...wit], w => putBox(w, MANAGER, [{ id: 'pas une opération', by: r.id }]))
  expectOnlyWitness(w, wit)
  // Une opération sans auteur lisible : elle peut être de n'importe quelle rétro, rien ne s'archive.
  putBox(w, MANAGER, [{ id: 'pas une opération' }])
  const at = T0 + 16_000
  writeBoard(w, b => ({ ...b, runs: b.runs.map(x => (wit.some(y => y.id === x.id) ? { ...x, archivedAt: undefined, archivedBy: undefined, updatedAt: at } : x)) }))
  await settle(clock, 16)
  expect(archived(w)).toEqual([])
  // Le témoin, désarchivé dans le fichier, l'est resté : l'opération sans auteur l'a retenu. Elle partie, tout s'archive.
  putBox(w, MANAGER, [])
  await settle(clock, 16)
  expect(archived(w).sort()).toEqual([s.id, r.id, ...wit.map(x => x.id)].sort())
})

test('Un groupe de la rétro encore chez un worker : rien', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id, { groups: [{ id: 'A', name: 'A', tickets: ['01'], linked: { session: 'local_w1', at: T0 - 300_000 } }, { id: 'B', name: 'B', tickets: ['02'] }] } as unknown as Partial<Run>)
  const wit = witness()
  const { w } = await coo($, on, [s, r, ...wit])
  expectOnlyWitness(w, wit)
})

// ─── Les autres critères ──────────────────────────────────────────────────

test('le clic « Lancer » d’une carte de rétro n’archive rien et n’ajoute aucune demande d’archiver une discussion', { timeoutMs: 30000 }, async ($, on) => {
  const s = studiedRun({ bornIn: 'session-COO' } as Partial<Run>)
  const { clock, w } = await coo($, on, [s])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(pane, { key: `coo-card-auto-${retroCardId(s.id)}` })
  await pane.unmount()
  await settle(clock, 4)
  expect(w.fills.some(t => t.includes('Rétrospective · Mission de B'))).toBe(true)
  expect(archived(w)).toEqual([])
  expect(w.box.text).not.toMatch(/archiv/)
})

test('une mission étudiée livrée garde les retenues d’une mission livrée : un groupe envoyé depuis le push retient tout', () => {
  const version = newRun('project:version', T0 - 800_000, 'v').phases[0]!
  const pushed = { ...version, status: 'done' as const, finishedAt: T0 - 700_000, steps: version.steps.map(st => ({ id: st.id, status: 'done' as const, ...(st.id === 'pushed' ? { at: T0 - 700_000 } : {}) })) }
  const base = studiedRun()
  const delivered = { ...base, phases: [...base.phases.map(p => ({ ...p, status: 'done' as const })), pushed] } as Run
  const r = retroRun(delivered.id)
  const board = (runs: Run[]): Board => ({ runs, activeId: null } as unknown as Board)
  const none = new Set<string>()
  expect(retroEndOf(board([delivered, r]), r.id, 'none', none)?.ids).toEqual([delivered.id, r.id])
  const sent = { ...delivered, groups: [{ id: 'A', name: 'A', tickets: ['01'], delegated: { at: T0 - 600_000, closing: { state: 'closed' } } }] } as unknown as Run
  expect(retroEndOf(board([sent, r]), r.id, 'none', none)).toBeNull()
  // Une étape de livraison encore à faire : retenue aussi.
  const unpushed = { ...delivered, phases: [...delivered.phases, { ...pushed, skill: 'project:pr', status: 'pending' as const }] } as Run
  expect(retroEndOf(board([unpushed, r]), r.id, 'none', none)).toBeNull()
  // Montrée par la discussion du COO, retenue par le COO (clôture demandée, livraison), ou une boîte en doute : rien.
  expect(retroEndOf({ ...board([delivered, r]), activeId: r.id } as Board, r.id, 'none', none)).toBeNull()
  expect(retroEndOf({ ...board([delivered, r]), activeId: delivered.id } as Board, r.id, 'none', none)).toBeNull()
  expect(retroEndOf(board([delivered, r]), r.id, 'none', new Set([delivered.id]))).toBeNull()
  expect(retroEndOf(board([delivered, r]), r.id, 'none', new Set([r.id]))).toBeNull()
  expect(retroEndOf(board([delivered, r]), r.id, 'pending', none)).toBeNull()
  expect(retroEndOf(board([delivered, r]), r.id, 'doubt', none)).toBeNull()
})

test('les workers et la livraison en cours retiennent la fin d’une rétro, sur la mission étudiée comme sur la rétro', () => {
  const s = studiedRun()
  const r = retroRun(s.id)
  const board = (runs: Run[]): Board => ({ runs, activeId: null } as unknown as Board)
  const none = new Set<string>()
  expect(retroEndOf(board([s, r]), r.id, 'none', none)?.ids).toEqual([s.id, r.id])
  const group = { groups: [{ id: 'A', name: 'A', tickets: ['01'], linked: { session: 'local_w1', at: T0 - 300_000 } }] }
  expect(retroEndOf(board([{ ...s, ...group } as unknown as Run, r]), r.id, 'none', none)).toBeNull()
  const items = (run: Run) => ({ ...run, phases: run.phases.map((p, i) => (i === 0 ? { ...p, linked: { items: ['i1'], at: T0 - 300_000, session: 'local_w2' } } : p)) }) as unknown as Run
  expect(retroEndOf(board([items(s), r]), r.id, 'none', none)).toBeNull()
  expect(retroEndOf(board([s, items(r)]), r.id, 'none', none)).toBeNull()
  const version = newRun('project:version', T0 - 800_000, 'v').phases[0]!
  const delivering = { ...s, phases: [...s.phases, { ...version, status: 'active' as const }] } as Run
  expect(retroEndOf(board([delivering, r]), r.id, 'none', none)).toBeNull()
})

test('une piste dont l’ajout a été refusé ne retient pas l’archivage, et la rétro archivée reste à relever', { timeoutMs: 40000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id)
  const refused = op(r, 'orefuse0001')
  const { clock, w } = await coo($, on, [s, r], w => {
    putList(w, { ...emptyWaitlist(''), applied: [opMark(MANAGER, refused.id)], refused: [{ op: opMark(MANAGER, refused.id), piste: refused.piste, by: r.id, why: 'refusée', at: T0 - 40_000 }] } as Waitlist)
    putBox(w, MANAGER, [refused])
  })
  expect(archived(w).sort()).toEqual([s.id, r.id].sort())
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/Closed mission « Rétrospective · Mission de B » \(mission id « [^»]+ »\) is not gleaned yet/)
})

test('hors du siège : rien', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.ids.now = 'session-Y'
  const s = studiedRun()
  const r = retroRun(s.id)
  writeBoard(w, b => ({ ...b, runs: [s, r] }))
  await start($)
  await settle(clock, 16)
  expect(archived(w)).toEqual([])
  // Témoin : la même discussion, une fois au siège, archive la rétro et sa mission.
  w.ids.now = 'session-COO'
  await openCoo($, clock)
  await settle(clock, 16)
  expect(archived(w).sort()).toEqual([s.id, r.id].sort())
})

test('une demande de clôture écrite entre deux relevés retient la fin de la rétro : le fichier de coordination se relit au moment d’écrire', { timeoutMs: 40000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id)
  const wit = witness()
  // Une opération de chaque rétro attend tant qu'une autre boîte ne se relit pas.
  const { clock, w } = await coo($, on, [s, r, ...wit], w => {
    putList(w, emptyWaitlist(''))
    putBox(w, MANAGER, [op(r, 'oattend0001', { op: 'edit', piste: `${r.id}/p9` }), op(wit[1]!, 'oattend0002', { op: 'edit', piste: `${wit[1]!.id}/p9` })])
    putBox(w, 'session-X', null)
  })
  expect(archived(w)).toEqual([])
  // Le Claude du COO demande la clôture de la mission étudiée ; le relevé suivant ne l'a pas encore lue quand la boîte se relit.
  w.coord.text = coordFile([{ id: 'cclose001', kind: 'close', run: s.id, at: T0 }])
  putBox(w, 'session-X', [])
  await settle(clock, 6)
  expectOnlyWitness(w, wit)
})

test('une rétro reprise puis reclose pendant l’archivage, avec une piste pas encore écrite : rien ne s’archive ; la piste écrite, l’archivage se fait', { timeoutMs: 40000 }, async ($, on) => {
  const s = studiedRun()
  const r = retroRun(s.id)
  const wit = witness()
  const { clock, w } = await coo($, on, [s, r, ...wit], w => {
    putList(w, emptyWaitlist(''))
    putBox(w, MANAGER, [op(r, 'oattend0001', { op: 'edit', piste: `${r.id}/p9` }), op(wit[1]!, 'oattend0002', { op: 'edit', piste: `${wit[1]!.id}/p9` })])
    putBox(w, 'session-X', null)
  })
  expect(archived(w)).toEqual([])
  // Au tirage du fichier des missions qui précède l'écriture (après l'application des boîtes de ce relevé : l'opération
  // du témoin marquée), la rétro a été reprise, a déposé une piste et s'est reclose : ses boîtes relues ne l'ont pas vue.
  const at = T0 + 16_000
  let armed = true
  const marked = () => JSON.stringify([...Object.entries(w.files).filter(([k]) => k.endsWith(`pistes/${PROJECT}.json`)).map(([, v]) => v), w.mem['coo-pistes:'] ?? '']).includes('oattend0002')
  w.probe.onBoardRead = () => {
    if (!armed || !marked()) return
    armed = false
    writeBoard(w, b => ({ ...b, runs: b.runs.map(x => (x.id === r.id ? { ...x, finishedAt: at, updatedAt: at } : x)) }))
    putBox(w, MANAGER, [op(r, 'oattend0001', { op: 'edit', piste: `${r.id}/p9` }), op(r, 'onouvelle01', { at })])
  }
  putBox(w, 'session-X', [])
  await settle(clock, 6)
  expect(armed).toBe(false)
  expectOnlyWitness(w, wit)
  // La nouvelle piste écrite dans la liste d'attente, la fin de la rétro se fait.
  await settle(clock, 16)
  expect(archived(w).sort()).toEqual([s.id, r.id, ...wit.map(x => x.id)].sort())
})
