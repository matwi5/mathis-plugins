import { expect, test } from 'claude-code/testing'

import { activeRun, applyRelay, applyReport, askCloseLinkedGroup, attachedIdsOf, closingText, emptyBoard, groupDone, groupProgress, needsReview, newRun, relayForGroup, reportFacts, startLinkedGroups } from '../hooks/model.ts'
import type { Board } from '../types'

// La fin d'un groupe compte les tickets que le plan lui rattache, comme sa sensibilité. Invariant :
// un groupe n'est jamais tenu pour fini, relu, clos ni fermé tant qu'un ticket que le plan lui
// rattache est ouvert.

const REPO = { isRepo: true }

const LOT = {
  tickets: [
    { id: 'a1', name: 'Code', files: ['a'], sensitive: false, logic: true },
    { id: 'b1', name: 'Doc', files: ['b'], sensitive: false, logic: true },
  ],
  groups: [
    { id: 'A', name: 'Alpha', tickets: ['a1'], files: ['a'] },
    { id: 'B', name: 'Bêta', tickets: ['b1'], files: ['b'] },
  ],
}

const boardWith = (input: Record<string, unknown>): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}
const groupOf = (board: Board, id: string) => activeRun(board)!.groups!.find(g => g.id === id)!

/** A confié, rendu, relu, sa sécurité tranchée : il se fermerait d'office. */
const closable = (): Board => {
  let b = startLinkedGroups(boardWith(LOT), ['A'], 3_000)!.board
  b = applyReport(b, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 4_000, REPO).board
  b = applyReport(b, { reviewed: ['A'] }, 5_000, REPO).board
  return applyReport(b, { security: { group: 'A', advised: false, why: 'sans risque' } }, 5_100, REPO).board
}

/** Un ticket trouvé ensuite, qui attend a1 : le plan le rattache au groupe A (`attachLoose`). */
const ATTACHED = { id: 'x1', name: 'Rattaché', blockedBy: ['a1'], sensitive: false, logic: true }

test('un groupe dont un ticket rattaché par le plan est ouvert n’est ni fini, ni proposé à la fermeture d’office, et son compte le compte', () => {
  const ready = closable()
  // Sans le rattaché, le groupe se ferme d'office : l'effet existe.
  expect(applyReport(ready, { note: 'point' }, 6_000, REPO).text).toContain('Close now: group A (Alpha)')
  const b = applyReport(ready, { tickets: [ATTACHED] }, 5_500, REPO).board
  // x1 n'est pas enregistré dans A : c'est le plan qui le lui rattache.
  expect(groupOf(b, 'A').tickets).toEqual(['a1'])
  const out = applyReport(b, { note: 'point' }, 6_000, REPO)
  const run = activeRun(out.board)!
  expect(out.text).not.toContain('Close now: group A')
  expect(out.text).toContain('Not closed yet: group A (Alpha) — still open, attached to it by the plan: Rattaché [x1]; closing waits for it.')
  expect(groupDone(run, groupOf(out.board, 'A'))).toEqual({ done: 1, total: 2 })
  const facts = reportFacts(run).join('\n')
  expect(facts).toContain('A (Alpha): 1/2 done')
  expect(facts).not.toMatch(/A \(Alpha\): [^;]*reviewed/)
})

test('une fois le rattaché fait, le groupe se finit comme aujourd’hui', () => {
  const b = applyReport(closable(), { tickets: [ATTACHED] }, 5_500, REPO).board
  const done = applyReport(b, { set: [{ id: 'x1', status: 'done' }] }, 5_800, REPO).board
  const out = applyReport(done, { note: 'point' }, 6_000, REPO)
  expect(out.text).toContain('Close now: group A (Alpha)')
  expect(groupDone(activeRun(out.board)!, groupOf(out.board, 'A'))).toEqual({ done: 2, total: 2 })
  expect(reportFacts(activeRun(out.board)!).join('\n')).toContain('A (Alpha): 2/2 done, reviewed by /code-review')
})

test('« reviewed » est refusé tant qu’un rattaché est ouvert, avec le ticket nommé ; la revue n’est due qu’une fois le groupe fini', () => {
  let b = boardWith({ ...LOT, set: [{ id: 'a1', status: 'done' }] })
  // A, fini, attend sa revue : l'effet existe.
  expect(needsReview(activeRun(b)!)).toBe(true)
  b = applyReport(b, { tickets: [ATTACHED] }, 2_500).board
  expect(needsReview(activeRun(b)!)).toBe(false)
  const refused = applyReport(b, { reviewed: ['A'] }, 3_000)
  expect(refused.text).toContain('reviewed: group A not finished, still open (attached to it by the plan): Rattaché [x1]; send it once they are done')
  expect(groupOf(refused.board, 'A').reviewedAt).toBeUndefined()
  b = applyReport(b, { set: [{ id: 'x1', status: 'done' }] }, 3_500).board
  expect(needsReview(activeRun(b)!)).toBe(true)
  expect(groupOf(applyReport(b, { reviewed: ['A'] }, 4_000).board, 'A').reviewedAt).toBe(4_000)
})

test('un avis de sécurité sans groupe, quand aucun groupe n’est fini, est refusé sans rien écrire', () => {
  let b = boardWith({ ...LOT, set: [{ id: 'a1', status: 'done' }] })
  b = applyReport(b, { tickets: [ATTACHED] }, 2_500).board
  const out = applyReport(b, { security: { advised: true, why: 'chemins' } }, 3_000)
  const run = activeRun(out.board)!
  expect(out.text).toContain('security: no finished group to give it to (groups: A, B); send it with "group"; nothing recorded')
  expect(run.security).toBeUndefined()
  expect(run.groups!.every(g => g.security === undefined)).toBe(true)
})

test('la pastille d’un groupe confié compte aussi le rattaché, une fois sa session relayée', () => {
  const sent = startLinkedGroups(boardWith(LOT), ['A'], 3_000)!.board
  const runId = activeRun(sent)!.id
  const relay = applyRelay(applyRelay(undefined, runId, 'sa', { kind: 'start', group: 'A' }, 3_100)!, runId, 'sa', { kind: 'tickets', changes: [{ id: 'a1', status: 'done' }] }, 3_200)!
  const b = applyReport(sent, { tickets: [ATTACHED] }, 3_300).board
  const run = activeRun(b)!
  const g = groupOf(b, 'A')
  // Le relais de la session ne connaît que a1 : 1/1 ; le rattaché, ouvert dans le parcours, s'y ajoute.
  expect(relayForGroup(relay, g)).toMatchObject({ done: 1, total: 1 })
  expect(groupProgress(run, g, relayForGroup(relay, g))).toEqual({ done: 1, total: 2 })
  expect(groupProgress(run, g, null)).toEqual(groupDone(run, g))
})

test('une session à archiver dans l’app attend aussi le rattaché ouvert : son worktree ne se retire pas', () => {
  const app = applyReport(closable(), { closed: [{ group: 'A', state: 'app', why: 'session de l’app' }] }, 5_200, REPO).board
  // Sans le rattaché, la réponse demande l'archivage puis le retrait du worktree : l'effet existe.
  expect(applyReport(app, { note: 'point' }, 6_000, REPO).text).toContain('To archive in the app: group A (Alpha)')
  const b = applyReport(app, { tickets: [ATTACHED] }, 5_500, REPO).board
  const out = applyReport(b, { note: 'point' }, 6_000, REPO)
  expect(out.text).not.toContain('To archive in the app: group A')
  expect(out.text).toContain('Not closed yet: group A (Alpha) — still open, attached to it by the plan: Rattaché [x1]; closing waits for it.')
})

test('au retour d’un groupe dont un rattaché est ouvert, la réponse ne demande « reviewed » qu’une fois ce ticket fait', () => {
  let b = startLinkedGroups(boardWith(LOT), ['A'], 3_000)!.board
  b = applyReport(b, { tickets: [ATTACHED] }, 3_500, REPO).board
  const out = applyReport(b, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 4_000, REPO)
  expect(out.text).toContain('returned with tickets the plan attaches to it still open: A (Rattaché [x1]): send {"reviewed": [...]} for it only once they are done')
  expect(out.text).not.toContain('returned without a /code-review relayed by its linked session: A')
})

test('« closed » ou « app » est refusé tant qu’un rattaché est ouvert ; « stopped » reste noté', () => {
  const b = applyReport(closable(), { tickets: [ATTACHED] }, 5_500, REPO).board
  for (const state of ['closed', 'app'] as const) {
    const out = applyReport(b, { closed: [{ group: 'A', state }] }, 6_000, REPO)
    expect(groupOf(out.board, 'A').delegated?.closing).toBeUndefined()
    expect(out.text).toContain('A (still open, attached to it by the plan: Rattaché [x1]; a group is closed only once they are done)')
  }
  const stopped = applyReport(b, { closed: [{ group: 'A', state: 'stopped', why: 'à revoir' }] }, 6_000, REPO).board
  expect(groupOf(stopped, 'A').delegated?.closing?.state).toBe('stopped')
})

test('une session à archiver attend le rattaché ouvert même quand un ticket du groupe est rouvert', () => {
  let b = applyReport(closable(), { closed: [{ group: 'A', state: 'app' }] }, 5_200, REPO).board
  b = applyReport(b, { set: [{ id: 'a1', status: 'todo' }], tickets: [ATTACHED] }, 5_500, REPO).board
  const out = applyReport(b, { note: 'point' }, 6_000, REPO)
  expect(out.text).not.toContain('To archive in the app: group A')
  expect(out.text).toContain('Not closed yet: group A (Alpha) — still open, attached to it by the plan: Rattaché [x1]; closing waits for it')
})

test('revue du groupe D : un rattaché que la session relaie fait compte fait ; un id hors forme n’a pas de promesse ; « ↻ Relancer » attend le rattaché', () => {
  const sent = startLinkedGroups(boardWith(LOT), ['A'], 3_000)!.board
  const runId = activeRun(sent)!.id
  const b = applyReport(sent, { tickets: [ATTACHED] }, 3_300).board
  const run = activeRun(b)!
  const g = groupOf(b, 'A')
  // La session a reçu x1 dans son brief, l'a fait et l'a relayé : 2/2, pas 1/2.
  let relay = applyRelay(undefined, runId, 'sa', { kind: 'start', group: 'A' }, 3_400)!
  relay = applyRelay(relay, runId, 'sa', { kind: 'tickets', changes: [{ id: 'a1', status: 'done' }, { id: 'x1', status: 'done' }] }, 3_500)!
  const relayed = relayForGroup(relay, g, g.linked, Infinity, attachedIdsOf(run, g))!
  expect(relayed).toMatchObject({ done: 1, total: 1 })
  expect(groupProgress(run, g, relayed)).toEqual({ done: 2, total: 2 })
  // Un groupe hors forme, rendu, avec un rattaché ouvert : la fermeture attend, et rien ne se fermera d'ici.
  const odd = applyReport(closable(), { tickets: [ATTACHED] }, 5_500, REPO).board
  activeRun(odd)!.groups = activeRun(odd)!.groups!.map(x => (x.id === 'A' ? { ...x, id: 'A b' } : x))
  expect(closingText(activeRun(odd)!, null, true)).toContain('closing waits for it; then nothing is closed from here either (its id is out of form)')
  // « ↻ Relancer la fermeture » d'une fermeture arrêtée ne relance rien tant que le rattaché est ouvert.
  const stopped = applyReport(closable(), { closed: [{ group: 'A', state: 'stopped', why: 'à revoir' }] }, 5_200, REPO).board
  expect(askCloseLinkedGroup(stopped, 'A', 5_300)).not.toBeNull()
  expect(askCloseLinkedGroup(applyReport(stopped, { tickets: [ATTACHED] }, 5_400, REPO).board, 'A', 5_500)).toBeNull()
})
