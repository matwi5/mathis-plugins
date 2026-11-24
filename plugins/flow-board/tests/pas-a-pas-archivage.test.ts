// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { closeDelivered, emptyBoard, newRun } from '../hooks/model.ts'
import { retroCardId } from '../hooks/retro-coo.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, openCoo, seatOf, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'
import { findAny, pressAny } from './page-coo.ts'

// Le pas à pas vérifié sur le clic « ✓ Archiver » : la tâche des fermetures envoyée, jugée à la fin du tour qui suit,
// renvoyée une fois avec ce qui manque, puis arrêtée. Invariant : « Un message de tâche ne part que de la discussion qui
// tient le siège du COO, Claude au repos, hors d'une compaction, un seul pas à pas à la fois ; aucun effet n'est noté
// avant un envoi entré dans la session ; et le pas à pas ne ferme ni n'archive rien lui-même, et n'enregistre pas son
// propre état : il envoie un texte et relit des fichiers. »

const T0 = 900_000_000
const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const UUID2 = '1c7a2d3f-4e5b-4c6d-9e0f-1a2b3c4d5e6f'
const TASK = /Tidy-up task « fermetures »/

/** Une mission au rapport validé, close comme livrée par le COO, née dans la discussion `bornIn` : « ✓ Archiver » sur sa carte. */
const delivered = (now: number, title: string, bornIn: string): Run => {
  const run = newRun('implement', now - 90_000, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: now - 50_000, finishedAt: now - 40_000, steps: [], items: [] }
  const r = { ...run, phases: [done, report], cursor: 1, status: 'paused', reportValidatedAt: now - 40_000, updatedAt: now - 1_000, bornIn } as Run
  const board: Board = { ...emptyBoard('', 'projet'), runs: [r] }
  return closeDelivered(board, r.id, now - 500, { version: '0.80.0', push: 'main' })!.board.runs[0]!
}

const call = async ($: any, input: unknown) => String(((await $.tool.call({ tool: 'mcp__flow-board__flow', coordinate: input } as any)) as any).result)

/** Le COO tient le siège ; une mission livrée par discussion donnée ; rend le monde prêt au clic. */
const atArchive = async ($: any, clock: any, w: World, runs: Run[]) => {
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
}

const archive = async ($: any, run: Run) => {
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pressAny(view, { key: `coo-card-archive-${retroCardId(run.id)}` })
  await view.unmount()
}

/** Le tour du message de tâche : commencé, puis fini (interrompu ou non). */
let turnNo = 0
const turn = async ($: any, isAborted = false) => {
  const turnId = `t${++turnNo}`
  await $.turn.start({ turnId, text: 'tâche' } as any)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted, turnId, reason: isAborted ? 'aborted' : 'answer' })
}

/** Ferme la discussion comme la procédure le dit : le contrôle, puis le compte rendu (une trace). */
const closeIt = async ($: any, session: string, state = 'closed') => {
  await call($, { toClose: [session] })
  await call($, { discussionsClosed: [{ session, state }] })
}

const tasks = (w: World) => w.prompts.filter(p => TASK.test(p))

test('le clic archive, la tâche des fermetures part aussitôt ; faite, jugée à la fin du tour qui suit : plus rien ne part', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  await archive($, a)
  expect(stored(w).runs.find(r => r.id === a.id)!.archivedAt).toBeDefined()
  expect(tasks(w)).toHaveLength(1)
  expect(tasks(w)[0]).toContain(UUID)
  await closeIt($, UUID)
  await turn($)
  await settle(clock, 12)
  expect(tasks(w)).toHaveLength(1)
})

test('pas faite : renvoyée une fois avec ce qui manque ; pas faite de nouveau : le pas à pas s’arrête et le dit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  await archive($, a)
  await turn($)
  await settle(clock, 6)
  expect(tasks(w)).toHaveLength(2)
  expect(w.prompts.at(-1)).toMatch(/^Not done yet after the previous message \(what is missing, in French: discussion\(s\) encore à fermer : 0b6f1c2e/)
  await turn($)
  await settle(clock, 12)
  expect(tasks(w)).toHaveLength(2)
  expect(w.toasts.some(t => t.includes('Rangement arrêté : tâche « fermetures » pas faite : discussion(s) encore à fermer : 0b6f1c2e'))).toBe(true)
  // Le bloc « Projet » dit le rangement encore dû : la fermeture, et le relevé de la mission livrée.
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(JSON.stringify(await findAny(pane, { key: 'coo-tidy-up' }))).toMatch(/Rangement : 2 à faire/)
  await pane.unmount()
})

test('un tour interrompu compte comme un essai : après une seconde interruption, l’arrêt', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  await archive($, a)
  await turn($, true)
  await settle(clock, 6)
  await turn($, true)
  await settle(clock, 12)
  expect(tasks(w)).toHaveLength(2)
  expect(w.toasts.some(t => t.includes('Rangement arrêté : tâche « fermetures » pas faite : discussion(s) encore à fermer : 0b6f1c2e'))).toBe(true)
})

test('envoi refusé : réessayé au repos sans compter ; rien n’est noté entre-temps ; au troisième refus, l’arrêt', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  w.submit.drop = true
  await archive($, a)
  expect(w.toasts.some(t => t.includes('La demande de fermer sa discussion n’est pas partie'))).toBe(true)
  w.submit.drop = false
  await settle(clock, 6)
  // Réessayé, et entré cette fois : pas un renvoi (aucun essai compté).
  expect(tasks(w)).toHaveLength(1)
  expect(w.prompts.at(-1)).not.toMatch(/Not done yet/)
  await closeIt($, UUID)
  await turn($)
  await settle(clock, 6)
  expect(tasks(w)).toHaveLength(1)
})

test('refus répété : trois envois refusés de suite, le pas à pas s’arrête', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  w.submit.drop = true
  await archive($, a)
  await settle(clock, 18)
  w.submit.drop = false
  await settle(clock, 12)
  expect(tasks(w)).toHaveLength(0)
  expect(w.toasts.some(t => t.includes('Rangement arrêté : tâche « fermetures » : message refusé 3 fois'))).toBe(true)
})

test('chose remise : déclarée « postponed », elle n’est pas redonnée et le pas à pas finit', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  await archive($, a)
  await call($, { discussionsClosed: [{ session: UUID, state: 'postponed', why: 'au travail' }] })
  await turn($)
  await settle(clock, 12)
  expect(tasks(w)).toHaveLength(1)
})

test('message de la personne pendant le pas à pas : désarmé, rien ne part plus ; ce qui est dû reste en tête du relevé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  await archive($, a)
  const said = JSON.stringify(await $.prompt.submit({ text: 'attends', origin: { kind: 'composer' } } as any))
  await turn($)
  await settle(clock, 12)
  expect(tasks(w)).toHaveLength(1)
  expect(said).toContain('TIDY-UP TASK DUE NOW')
})

test('compaction en cours : aucun envoi avant sa fin', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  let release = () => {}
  const gate = new Promise<void>(r => (release = r))
  on('session.compact', async () => {
    await gate
    return { messages: [{ role: 'user', text: 'résumé', toolUses: [] }] }
  })
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  const compacting = $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'x', toolUses: [] }] } as any)
  await settle(clock, 1)
  await archive($, a)
  await settle(clock, 12)
  expect(tasks(w)).toHaveLength(0)
  release()
  await compacting
  await settle(clock, 6)
  expect(tasks(w)).toHaveLength(1)
})

test('second clic pendant un pas à pas : un seul pas à pas, la discussion nouvelle entre dans la liste recalculée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  const b = delivered(T0, 'Mission B', UUID2)
  await atArchive($, clock, w, [a, b])
  await archive($, a)
  await closeIt($, UUID)
  await turn($)
  await archive($, b)
  // Le second clic n'a pas armé de second pas à pas : sa tâche part au repos, une seule.
  await settle(clock, 6)
  const sent = tasks(w)
  expect(sent).toHaveLength(2)
  expect(sent[1]).toContain(UUID2)
  expect(sent[1]).not.toContain(UUID)
})

test('aucune commande claude ni archivage par le tableau de bord pendant un pas à pas complet', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const argv: string[][] = []
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    argv.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  await archive($, a)
  const before = JSON.stringify(stored(w).runs)
  await turn($)
  await settle(clock, 6)
  await turn($)
  await settle(clock, 12)
  expect(argv.filter(x => x[0] === 'claude')).toEqual([])
  expect(w.runs.filter(c => c.startsWith('claude'))).toEqual([])
  // Le pas à pas n'a rien archivé de plus : le fichier des missions n'a pas changé depuis le clic.
  expect(JSON.stringify(stored(w).runs.map(r => [r.id, r.archivedAt]))).toBe(JSON.stringify(JSON.parse(before).map((r: Run) => [r.id, r.archivedAt])))
})

test('clic en plein tour : refusé comme avant, rien n’est archivé ni envoyé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  await $.turn.start({ turnId: 'plein', text: 'travail' } as any)
  await archive($, a)
  expect(stored(w).runs.find(r => r.id === a.id)!.archivedAt).toBeUndefined()
  expect(tasks(w)).toHaveLength(0)
  expect(w.toasts.some(t => t.includes('Claude travaille'))).toBe(true)
})

test('lecture ratée au jugement : pas de verdict, jugé de nouveau au repos sans compter comme un essai', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  await archive($, a)
  w.coord.unread = true
  await turn($)
  await settle(clock, 6)
  // Rien de jugé tant que le fichier ne se relit pas : aucun renvoi.
  expect(tasks(w)).toHaveLength(1)
  w.coord.unread = false
  await settle(clock, 12)
  // Relu : pas faite, renvoyée une fois (la lecture ratée n'a pas compté d'essai, sinon le pas à pas se serait arrêté).
  expect(tasks(w)).toHaveLength(2)
  expect(w.prompts.at(-1)).toMatch(/^Not done yet after the previous message/)
})

test('siège perdu pendant le pas à pas : plus rien ne part', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  await archive($, a)
  // Une autre discussion prend le siège du COO.
  writeBoard(w, b => ({ ...b, coo: seatOf('session-Z', T0 + 5_000) }))
  await turn($)
  await settle(clock, 12)
  expect(tasks(w)).toHaveLength(1)
})

test('état de la feuille de route illisible au clic : la tâche des fermetures part quand même', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  w.probe.refuseRead = key => key.endsWith('.feuille-de-route.json') || key.startsWith('coo-roadmap:')
  await archive($, a)
  expect(tasks(w)).toHaveLength(1)
  expect(tasks(w)[0]).toContain(UUID)
})

test('fichier de coordination illisible au clic : rien ne part ni ne se dit, et le pas à pas ne reste pas armé (un clic suivant repart)', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  const b = delivered(T0, 'Mission B', UUID2)
  await atArchive($, clock, w, [a, b])
  w.coord.unread = true
  await archive($, a)
  await settle(clock, 6)
  expect(tasks(w)).toHaveLength(0)
  w.coord.unread = false
  await settle(clock, 6)
  await archive($, b)
  expect(tasks(w)).toHaveLength(1)
})

test('clic juste après une réponse qui pose une question : la tâche des fermetures part quand même (le clic est la réponse de la personne)', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  await atArchive($, clock, w, [a])
  await $.turn.start({ turnId: 'question', text: 'point' } as any)
  await $.turn.complete({ answer: 'Veux-tu que je relance la mission X ?', durationMs: 10, isAborted: false, turnId: 'question', reason: 'answer' })
  await settle(clock, 2)
  await archive($, a)
  expect(tasks(w)).toHaveLength(1)
})
