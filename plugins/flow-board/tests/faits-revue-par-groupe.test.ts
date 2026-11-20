import { expect, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { applyReport, emptyBoard, factsRelayOf, newRun, reportFacts } from '../hooks/model.ts'
import { applyRelay } from '../hooks/relay.ts'
import type { Board, Relay, Run } from '../types'

// Le premier jet d'un rapport de mission portait des comptes de revue faux (12 constats au lieu de 10) : les faits du
// compte rendu ne donnaient les totaux que d'un groupe, celui en alerte au journal, et « done, 0 min » pour chaque
// ticket passé d'un coup à « fait ». Ils donnent maintenant une ligne de totaux par groupe (Standards, Spec, bogues,
// corrigés), telle que le relais de chaque worker la garde, un compte absent dit absent, et la durée d'un ticket
// seulement quand son début et sa fin diffèrent. Rien n'est écrit : les faits lisent.

/** Une mission à deux groupes, A et B, rendus par leurs workers (envoyés à 3 000, rendus à 9 000). */
const missionOf = (): Run => {
  const run = { ...newRun('implement', 1_000, 'Boutique'), id: 'm1' } as Run
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const plan = {
    tickets: [{ id: 'a1', name: 'Synchro' }, { id: 'b1', name: 'Statut' }],
    groups: [{ id: 'A', name: 'Synchro', tickets: ['a1'] }, { id: 'B', name: 'Statut', tickets: ['b1'] }],
  }
  const planned = activeRun(applyReport(base, plan, 2_000).board)!
  return { ...planned, groups: planned.groups!.map(g => ({ ...g, sends: 1, delegated: { at: 3_000 } })) }
}

/** Le relais : A a relayé deux revues (dont une passe « bogues »), B une seule, sans bogues. */
const relayOf = (): Relay => {
  let r = applyRelay(undefined, 'm1', 'sa', { kind: 'start', group: 'A' }, 3_500)!
  r = applyRelay(r, 'm1', 'sa', { kind: 'counts', review: { standards: 2, spec: 1, fixed: 3 } } as any, 4_000)!
  r = applyRelay(r, 'm1', 'sa', { kind: 'counts', review: { standards: 0, spec: 0, bugs: 4, fixed: 2 } } as any, 5_000)!
  r = applyRelay(r, 'm1', 'sb', { kind: 'start', group: 'B' }, 3_600)!
  r = applyRelay(r, 'm1', 'sb', { kind: 'counts', review: { standards: 1, spec: 2, fixed: 1 } } as any, 4_500)!
  return r
}

test('une ligne de totaux par groupe, chacun ses comptes ; un compte de bogues absent se dit absent, jamais 0', () => {
  const facts = reportFacts(missionOf(), 0, null, 'on', relayOf()).join('\n')
  const line = facts.split('\n').find(l => l.startsWith('- Review totals by group'))!
  expect(line).toContain('A: 2 Standards, 1 Spec, 4 bugs, 5 fixed')
  expect(line).toContain('B: 1 Standards, 2 Spec, bugs absent, 1 fixed')
})

test('un groupe sans revue relayée : ses totaux absents, jamais 0 ; un relais illisible : inconnus', () => {
  const r = applyRelay(undefined, 'm1', 'sa', { kind: 'start', group: 'A' }, 3_500)!
  const line = reportFacts(missionOf(), 0, null, 'on', r).find(l => l.startsWith('- Review totals by group'))!
  expect(line).toContain('A: no review relayed (Standards, Spec, bugs and fixed absent)')
  expect(line).not.toMatch(/A: 0 Standards/)
  const unread = reportFacts(missionOf(), 0, null, 'on', null).find(l => l.startsWith('- Review totals by group'))!
  expect(unread).toContain('relay unreadable: review totals unknown')
  // Sans relais donné (les appelants d'avant), les faits d'avant, sans ligne de plus.
  expect(reportFacts(missionOf()).some(l => l.startsWith('- Review totals'))).toBe(false)
})

test('un lot sans groupes : une ligne de totaux, tels que la phase les garde, un compte absent dit absent', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), id: 'm2' } as Run
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const b = applyReport(base, { tickets: [{ id: 't1', name: 'Un' }] }, 2_000).board
  const fresh = reportFacts(activeRun(b)!, 0, null, 'on', null).find(l => l.startsWith('- Review totals of the lot'))!
  expect(fresh).toContain('Standards absent, Spec absent, bugs absent (not kept for a lot: take them from the bug passes this discussion ran), fixed absent')
  const reviewed = applyReport(b, { review: { standards: 2, spec: 1, fixed: 2 } }, 3_000).board
  const line = reportFacts(activeRun(reviewed)!, 0, null, 'on', null).find(l => l.startsWith('- Review totals of the lot'))!
  expect(line).toContain('2 Standards, 1 Spec, bugs absent (not kept for a lot: take them from the bug passes this discussion ran), 2 fixed')
})

test('un groupe envoyé deux fois : ses totaux somment les revues des deux envois, chacun dans sa fenêtre', () => {
  const base = missionOf()
  // A rendu une première fois (envoi à 3 000), puis renvoyé à 8 000 : le premier envoi est gardé dans `earlier`.
  const run = { ...base, groups: base.groups!.map(g => (g.id === 'A' ? { ...g, sends: 2, delegated: { at: 8_000, earlier: [{ at: 3_000 }] } as any } : g)) }
  let r = relayOf()
  r = applyRelay(r, 'm1', 'sa2', { kind: 'start', group: 'A' }, 8_500)!
  r = applyRelay(r, 'm1', 'sa2', { kind: 'counts', review: { standards: 1, spec: 0, bugs: 2, fixed: 1 } } as any, 9_000)!
  const line = reportFacts(run, 0, null, 'on', r).find(l => l.startsWith('- Review totals by group'))!
  expect(line).toContain('A: 3 Standards, 1 Spec, 6 bugs, 6 fixed')
})

test('le relais des faits : lu en partie ou d’une autre mission, inconnu ; absent, aucune revue relayée', () => {
  expect(factsRelayOf(relayOf(), 1, 'm1')).toBeNull()
  expect(factsRelayOf(relayOf(), 0, 'autre')).toBeNull()
  expect(factsRelayOf(relayOf(), 0, 'm1')).toEqual(relayOf())
  const none = factsRelayOf(undefined, 0, 'm1')
  const line = reportFacts(missionOf(), 0, null, 'on', none).find(l => l.startsWith('- Review totals by group'))!
  expect(line).toContain('A: no review relayed')
  expect(line).toContain('B: no review relayed')
})

test('un groupe dont l’envoi a été annulé : ses revues inconnues, jamais « never sent » ; un ticket de 45 s : « <1 min »', () => {
  const base = missionOf()
  const run = { ...base, groups: base.groups!.map(g => (g.id === 'A' ? { ...g, sends: 1, delegated: undefined } : g.id === 'B' ? { ...g, sends: undefined, delegated: undefined } : g)) }
  const line = reportFacts(run, 0, null, 'on', relayOf()).find(l => l.startsWith('- Review totals by group'))!
  expect(line).toContain('A: no send kept (cancelled), its reviews unknown')
  expect(line).toContain('B: never sent, no review relayed')
  const quick = { ...base, tickets: base.tickets.map(t => ({ ...t, status: 'done' as const, startedAt: 6_000, finishedAt: 6_000 + 45_000 })) }
  expect(reportFacts(quick).find(l => l.startsWith('- Tickets of the lot'))!).toContain('Synchro [a1]: done, <1 min')
})

test('la durée d’un ticket : donnée seulement quand son début et sa fin diffèrent', () => {
  const run = missionOf()
  const same = { ...run, tickets: run.tickets.map(t => (t.id === 'a1' ? { ...t, status: 'done' as const, startedAt: 6_000, finishedAt: 6_000 } : { ...t, status: 'done' as const, startedAt: 6_000, finishedAt: 6_000 + 12 * 60_000 })) }
  const lot = reportFacts(same).find(l => l.startsWith('- Tickets of the lot'))!
  expect(lot).toContain('Synchro [a1]: done;')
  expect(lot).not.toContain('0 min')
  expect(lot).toContain('Statut [b1]: done, 12 min')
})

test('les faits ne changent rien à la mission', () => {
  const run = missionOf()
  const before = JSON.stringify(run)
  reportFacts(run, 0, null, 'on', relayOf())
  expect(JSON.stringify(run)).toBe(before)
})
