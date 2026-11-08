import { expect, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun, startLinkedGroups } from '../hooks/model.ts'
import { FORM_LATE, applyRelay, mergeRelay, relayForGroup, relayRefusal } from '../hooks/relay.ts'
import { activeRun, addedCount } from '../hooks/basics.ts'
import type { Board, Relay } from '../types'

// Le compte `form` de `review` : les constats de la relecture du fond et de la forme, comptés à part de
// l'axe Spec (un groupe les avait additionnés au compte Spec, et les comptes du tableau de bord étaient
// faux). Invariant : les comptes de forme déposés au relais ne sont jamais réécrits plus petits ni
// effacés, sauf quand on efface toute la mission ; un compte absent reste absent, jamais 0.

const LOT = {
  tickets: [
    { id: 'a1', name: 'Premier' },
    { id: 'b1', name: 'Second' },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Données', tickets: ['b1'] },
  ],
}

/** Une mission à deux groupes, dans la discussion qui la porte. */
const boardWith = (input: Record<string, unknown>): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}

/** Les stats de la phase d'implémentation. */
const implStats = (board: Board) => activeRun(board)!.phases.find(p => p.skill === 'implement')!.stats

/** Le groupe A confié à un worker, et le relais de sa session `fa` démarrée. */
const sentA = () => {
  const sent = startLinkedGroups(boardWith(LOT), ['A'], 5_000)!.board
  const run = activeRun(sent)!
  const relay = applyRelay(undefined, run.id, 'fa', { kind: 'start', group: 'A' }, 5_500)!
  return { sent, run, relay, group: () => activeRun(sent)!.groups!.find(g => g.id === 'A')! }
}

/** Le compte de forme gardé pour la session `fa`, tel quel. */
const keptForm = (relay: Relay | null, session = 'fa'): unknown => (relay?.sessions[session]?.reviews as Record<string, unknown> | undefined)?.form

test('dans la discussion de la mission, form s’ajoute aux stats et au journal, à part de Spec ; absent, il reste absent', () => {
  const plain = applyReport(boardWith(LOT), { review: { standards: 1, spec: 2, fixed: 3 } }, 3_000).board
  // Aucune relecture : pas de compte de forme, ni dans les stats ni au journal.
  expect(implStats(plain)).not.toHaveProperty('form')
  expect(activeRun(plain)!.log.find(l => l.text.startsWith('Revue :'))!.text).toBe('Revue : 1 Standards · 2 Spec · 3 corrigés')
  const first = applyReport(plain, { review: { standards: 0, spec: 1, form: 2, fixed: 1 } }, 3_100)
  expect(first.text).not.toContain('form ignored')
  expect(implStats(first.board)).toMatchObject({ reviews: 2, standards: 1, spec: 3, fixed: 4, form: 2 })
  const line = activeRun(first.board)!.log.find(l => l.text.startsWith('Revue :'))!
  expect(line.text).toBe('Revue : 0 Standards · 1 Spec · 2 constats de forme (relecture du fond et de la forme) · 1 corrigé')
  // Constats, forme compris, au-delà des corrigés : alerte.
  expect(line.tone).toBe('warn')
  // Une revue sans relecture ne touche pas au compte ; une autre relecture s'y ajoute.
  const second = applyReport(first.board, { review: { standards: 1, spec: 0, fixed: 1 } }, 3_200).board
  expect(implStats(second).form).toBe(2)
  const third = applyReport(second, { review: { standards: 0, spec: 0, form: 1, fixed: 1 } }, 3_300).board
  expect(implStats(third).form).toBe(3)
  expect(activeRun(third)!.log.find(l => l.text.startsWith('Revue :'))!.text).toBe('Revue : 0 Standards · 0 Spec · 1 constat de forme (relecture du fond et de la forme) · 1 corrigé')
})

test('dans la discussion de la mission, un form hors forme est ignoré et dit, sans faire tomber les autres comptes ni le compte gardé', () => {
  const kept = applyReport(boardWith(LOT), { review: { standards: 0, spec: 0, form: 4, fixed: 0 } }, 3_000).board
  for (const bad of ['3', null, -1, 2.5, 10_001, [], {}]) {
    const out = applyReport(kept, { review: { standards: 1, spec: 1, form: bad, fixed: 1 } }, 3_100)
    expect(out.text).toContain('form ignored: not a whole number from 0 to 10 000; the rest of this review is recorded')
    expect(implStats(out.board)).toMatchObject({ standards: 1, spec: 1, fixed: 1, form: 4 })
    expect(activeRun(out.board)!.log.find(l => l.text.startsWith('Revue :'))!.text).toBe('Revue : 1 Standards · 1 Spec · 1 corrigé')
  }
})

test('envoyé par un worker, form est relayé, cumulé, sommé sur les sessions du lien et repris au retour du groupe', () => {
  const a = sentA()
  const { sent, run, group } = a
  let relay = a.relay
  // L'outil l'accepte dans un worker, le dit relayé, et dit qu'envoyé après le retour il n'est plus compté.
  const delegated = applyReport(sent, { delegate: run.id, group: 'A' }, 5_100).board
  const told = applyReport(delegated, { review: { standards: 1, spec: 0, form: 2, fixed: 1 } }, 5_200).text
  expect(told).toMatch(/^Relayed to the manager's dashboard: the review findings\. /)
  expect(told).toContain(FORM_LATE)
  // Sans form, la réponse n'en parle pas.
  expect(applyReport(delegated, { review: { standards: 1, spec: 0, fixed: 1 } }, 5_200).text).not.toContain(FORM_LATE)
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 1, spec: 0, fixed: 1 } }, 6_000)!
  // Sans relecture : pas de « 0 ».
  expect(keptForm(relay)).toBeUndefined()
  expect(relayForGroup(relay, group(), undefined)!.reviews).not.toHaveProperty('form')
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 1, form: 2, fixed: 1 } }, 6_100)!
  // Une revue sans relecture, puis une passe « bogues » : le compte de forme reste, jamais réécrit plus petit.
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 0, fixed: 0 } }, 6_150)!
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 0, bugs: 3, fixed: 3 } }, 6_160)!
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 0, form: 1, fixed: 0 } }, 6_200)!
  expect(relay.sessions['fa']!.reviews).toEqual({ count: 5, standards: 1, spec: 1, fixed: 5, bugs: 3, form: 3 })
  // Une session redémarrée sous un autre id : son compte s'ajoute.
  relay = applyRelay(relay, run.id, 'fb', { kind: 'start', group: 'A' }, 6_300)!
  relay = applyRelay(relay, run.id, 'fb', { kind: 'counts', review: { standards: 0, spec: 0, form: 4, fixed: 0 } }, 6_400)!
  expect(relayForGroup(relay, group(), undefined)!.reviews).toEqual({ count: 6, standards: 1, spec: 1, fixed: 5, bugs: 3, form: 7 })
  const back = applyReport(sent, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 7_000, { relay }).board
  expect(implStats(back)).toMatchObject({ reviews: 6, standards: 1, spec: 1, fixed: 5, form: 7 })
  const line = activeRun(back)!.log.find(l => l.text.startsWith('Revues du groupe A (worker)'))!
  expect(line.text).toBe('Revues du groupe A (worker) : 1 Standards · 1 Spec · 3 bogues (passe « bogues ») · 7 constats de forme (relecture du fond et de la forme) · 5 corrigé(s)')
  expect(line.tone).toBe('warn')
})

test('au retour, un groupe sans relecture laisse le compte de forme absent des stats ; il ne remet pas à zéro celui d’avant', () => {
  const a = sentA()
  const { sent, run } = a
  let relay = a.relay
  const before = applyReport(sent, { review: { standards: 0, spec: 0, form: 2, fixed: 0 } }, 5_900).board
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 1, spec: 0, fixed: 1 } }, 6_000)!
  const back = applyReport(before, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 7_000, { relay }).board
  expect(implStats(back).form).toBe(2)
  const plain = applyReport(sent, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 7_000, { relay }).board
  expect(implStats(plain)).not.toHaveProperty('form')
  expect(activeRun(plain)!.log.find(l => l.text.startsWith('Revues du groupe A (worker)'))!.text).not.toMatch(/forme/)
})

test('envoyé hors forme par un worker, form ne part pas, la réponse le dit, et le reste de la revue est relayé', () => {
  const { sent, run } = sentA()
  const delegated = applyReport(sent, { delegate: run.id, group: 'A' }, 5_100).board
  for (const bad of ['3', null, -1, 2.5, 10_001]) {
    const out = applyReport(delegated, { review: { standards: 1, spec: 0, form: bad, fixed: 0 } }, 5_200).text
    expect(out).toContain("Relayed to the manager's dashboard: the review findings. ")
    expect(out).toContain('NOT kept in the relay: the form count (not a whole number from 0 to 10 000; the rest of this review is relayed: do not send it again, give the form count in your final report)')
    // Rien de relayé n'a de compte de forme : la phrase du retour tardif ne se dit pas.
    expect(out).not.toContain(FORM_LATE)
  }
  // Bogues et forme hors forme ensemble : chacun se dit, la revue part.
  const both = applyReport(delegated, { review: { standards: 1, spec: 0, bugs: 'x', form: 'y', fixed: 0 } }, 5_200).text
  expect(both).toContain('the bug count (not a whole number')
  expect(both).toContain('the form count (not a whole number')
})

test('un compte de forme gardé illisible n’est jamais réécrit ni poussé au-delà de 10 000 : la revue qui en ajoute est refusée, et la raison le dit', () => {
  const a = sentA()
  const { run } = a
  let relay = a.relay
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 0, form: 9_999, fixed: 0 } }, 6_000)!
  const own = relay.sessions['fa']
  expect(relayRefusal(own, { kind: 'counts', review: { standards: 0, spec: 0, form: 2, fixed: 0 } })).toEqual({
    why: 'its relay entry would pass 10 000 form findings; send this review again without "form", and give the form count in your final report',
    isReview: true,
  })
  const hand = structuredClone(relay)
  ;(hand.sessions['fa']!.reviews as Record<string, unknown>).form = 'deux'
  expect(relayRefusal(hand.sessions['fa'], { kind: 'counts', review: { standards: 0, spec: 0, form: 1, fixed: 0 } })).toEqual({
    why: 'its relay entry holds an unreadable form count, never rewritten; send this review again without "form", and give the form count in your final report',
    isReview: true,
  })
  // Appelé quand même, l'ajout ne réécrit ni le compte illisible ni ne l'efface ; sans form, la revue se garde et le compte reste tel quel.
  expect(keptForm(applyRelay(hand, run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 0, form: 1, fixed: 0 } }, 6_100))).toBe('deux')
  expect(keptForm(applyRelay(hand, run.id, 'fa', { kind: 'counts', review: { standards: 1, spec: 0, fixed: 0 } }, 6_100))).toBe('deux')
})

test('un relais d’avant, sans form, se lit « absent » sans réécriture, et un compte de forme hors forme lu d’un fichier ne fait pas tomber les autres', () => {
  const a = sentA()
  const { run, group } = a
  let relay = a.relay
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 1, spec: 1, bugs: 2, fixed: 1 } }, 6_000)!
  // Une entrée telle qu'une version d'avant l'écrivait : pas de clé form.
  const old = JSON.parse(JSON.stringify(relay)) as Relay
  expect(Object.keys(old.sessions['fa']!.reviews!)).not.toContain('form')
  const merged = mergeRelay(run.id, old, [])!
  expect(keptForm(merged)).toBeUndefined()
  expect(relayForGroup(merged, group(), undefined)!.reviews).toEqual({ count: 1, standards: 1, spec: 1, fixed: 1, bugs: 2 })
  // La lecture n'a rien réécrit.
  expect(old).toEqual(JSON.parse(JSON.stringify(relay)))
  for (const bad of [2.5, -1, 10_001, 'deux', null]) {
    const hand = structuredClone(relay)
    ;(hand.sessions['fa']!.reviews as Record<string, unknown>).form = bad
    expect(relayForGroup(hand, group(), undefined)!.reviews).toEqual({ count: 1, standards: 1, spec: 1, fixed: 1, bugs: 2 })
  }
})

test('un form envoyé après le retour du groupe n’est pas cumulé : les stats gardent le compte du retour', () => {
  const a = sentA()
  const { sent, run } = a
  let relay = applyRelay(a.relay, run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 0, form: 2, fixed: 0 } }, 6_000)!
  const back = applyReport(sent, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 7_000, { relay }).board
  expect(implStats(back).form).toBe(2)
  // Après le retour, le worker relaie encore une relecture : gardée au relais, jamais comptée.
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 0, form: 5, fixed: 0 } }, 7_500)!
  expect(keptForm(relay)).toBe(7)
  const later = applyReport(back, { note: 'point' }, 8_000, { relay }).board
  expect(implStats(later).form).toBe(2)
  // Un second « returned » du même groupe ne le recompte pas non plus.
  const again = applyReport(later, { returned: ['A'] }, 8_100, { relay }).board
  expect(implStats(again).form).toBe(2)
})

test('un seul envoi avec bugs et form, comme le dit la procédure : chacun compté à part, dans la mission comme au relais', () => {
  const here = applyReport(boardWith(LOT), { review: { standards: 1, spec: 1, bugs: 2, form: 3, fixed: 7 } }, 3_000).board
  expect(implStats(here)).toMatchObject({ standards: 1, spec: 1, fixed: 7, form: 3 })
  const line = activeRun(here)!.log.find(l => l.text.startsWith('Revue :'))!
  expect(line.text).toBe('Revue : 1 Standards · 1 Spec · 2 bogues (passe « bogues ») · 3 constats de forme (relecture du fond et de la forme) · 7 corrigés')
  expect(line.tone).toBe('ok')
  const a = sentA()
  const delegated = applyReport(a.sent, { delegate: a.run.id, group: 'A' }, 5_100).board
  expect(applyReport(delegated, { review: { standards: 1, spec: 1, bugs: 2, form: 3, fixed: 7 } }, 5_200).text).toMatch(/^Relayed to the manager's dashboard: the review findings\. /)
  const relay = applyRelay(a.relay, a.run.id, 'fa', { kind: 'counts', review: { standards: 1, spec: 1, bugs: 2, form: 3, fixed: 7 } }, 6_000)!
  expect(relay.sessions['fa']!.reviews).toEqual({ count: 1, standards: 1, spec: 1, fixed: 7, bugs: 2, form: 3 })
})

test('les stats de forme ne baissent jamais, même au-delà de la borne d’un envoi', () => {
  expect(addedCount(12_000, 1)).toBe(12_001)
  expect(addedCount(undefined, 2)).toBe(2)
  expect(addedCount('deux', 2)).toBe(2)
  // Deux sessions à 6 000 chacune : 12 000 au retour, puis une relecture d'ici s'y ajoute.
  const a = sentA()
  let relay = applyRelay(a.relay, a.run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 0, form: 6_000, fixed: 0 } }, 6_000)!
  relay = applyRelay(relay, a.run.id, 'fb', { kind: 'start', group: 'A' }, 6_100)!
  relay = applyRelay(relay, a.run.id, 'fb', { kind: 'counts', review: { standards: 0, spec: 0, form: 6_000, fixed: 0 } }, 6_200)!
  const back = applyReport(a.sent, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 7_000, { relay }).board
  expect(implStats(back).form).toBe(12_000)
  expect(implStats(applyReport(back, { review: { standards: 0, spec: 0, form: 1, fixed: 0 } }, 7_100).board).form).toBe(12_001)
})

test('refusée pour son compte de forme, la revue renvoyée sans form se garde une fois, et le compte gardé reste intact', () => {
  const a = sentA()
  let relay = applyRelay(a.relay, a.run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 0, form: 9_999, fixed: 0 } }, 6_000)!
  const refused = { kind: 'counts', review: { standards: 2, spec: 1, form: 2, fixed: 1 } } as const
  expect(relayRefusal(relay.sessions['fa'], refused)?.isReview).toBe(true)
  const again = { kind: 'counts', review: { standards: 2, spec: 1, fixed: 1 } } as const
  expect(relayRefusal(relay.sessions['fa'], again)).toBeNull()
  relay = applyRelay(relay, a.run.id, 'fa', again, 6_100)!
  expect(relay.sessions['fa']!.reviews).toEqual({ count: 2, standards: 2, spec: 1, fixed: 1, form: 9_999 })
})
