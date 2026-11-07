import { expect, mock, test } from 'claude-code/testing'

import { applyReport, autoDecision, clampFuture, closingText, emptyBoard, isClosedTurnedOff, isCloseCandidate, isLotSecurityDue, mergeBoards, newRun, nextCommandSkill, reportFacts, startLinkedGroups, suggestionsFor } from '../hooks/model.ts'
import { activeRun } from '../hooks/basics.ts'
import { applyRelay } from '../hooks/relay.ts'
import { MISSION_FAMILIES, WORKER_FAMILIES, missionFamilyKey, workerFamilyKey } from '../hooks/erase-run.ts'
import type { Board, Run, TicketGroup } from '../types'

// La revue de sécurité désactivée pour un projet (réglage du tableau de bord, ticket du réglage). Invariant :
// « la revue d'un projet où tu l'as activée n'est jamais désactivée sans un clic de toi ». D'où : une décision
// qui lit le réglage traite une lecture ratée (`unread`) comme « activée », et la marque `offAt` ne se pose que
// si le réglage lu à cet instant dit « désactivée ».

type Review = 'on' | 'off' | 'unread'
const LOGIC = { sensitive: false, logic: true }

/** Le groupe D (un ticket avec logique) rendu par son worker et relu : seule sa sécurité reste ; E garde le plan à deux groupes. */
const reviewedGroup = (): Board => {
  const run = { ...newRun('implement', 1_000, 'Jetons'), owner: 's' }
  const board: Board = { ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  let b = applyReport(board, { tickets: [{ id: 'd1', name: 'Jetons', ...LOGIC }, { id: 'e1', name: 'Code', ...LOGIC }], groups: [{ id: 'D', name: 'Jetons', tickets: ['d1'] }, { id: 'E', name: 'Code', tickets: ['e1'] }] }, 2_000).board
  b = startLinkedGroups(b, ['D'], 3_000)!.board
  b = applyReport(b, { set: [{ id: 'd1', status: 'done' }], returned: ['D'] }, 4_000).board
  return applyReport(b, { reviewed: ['D'] }, 5_000).board
}
const runOf = (b: Board): Run => activeRun(b)!
const groupD = (b: Board): TicketGroup => runOf(b).groups!.find(g => g.id === 'D')!
const advise = (b: Board, review: Review, at = 6_000): Board => applyReport(b, { security: { group: 'D', advised: true, why: 'touche les jetons' } }, at, { security: review }).board
const facts = (b: Board, review: Review): string => reportFacts(runOf(b), 0, null, review).join('\n')
const OFF_LINE = '« revue de sécurité désactivée pour ce projet ; le groupe touchait : touche les jetons »'

test('avis reçu, revue désactivée : marque posée, groupe tranché et à fermer, ligne « désactivée » au compte rendu', () => {
  const b = advise(reviewedGroup(), 'off')
  const run = runOf(b)
  expect(groupD(b).security?.offAt).toBe(6_000)
  expect(isCloseCandidate(run, groupD(b), null, 'off')).toBe(true)
  expect(closingText(run, null, true, 'off')).toContain('Close now: group D (Jetons) is closed')
  expect(closingText(run, null, true, 'off')).not.toContain('lacks')
  expect(facts(b, 'off')).toContain(OFF_LINE)
})

test('avis reçu, revue activée ou réglage illisible : aucune marque, la revue reste due', () => {
  for (const review of ['on', 'unread'] as const) {
    const b = advise(reviewedGroup(), review)
    const run = runOf(b)
    expect(groupD(b).security?.offAt, review).toBeUndefined()
    expect(isCloseCandidate(run, groupD(b), null, review), review).toBe(false)
    expect(closingText(run, null, true, review), review).toContain('group D (Jetons) lacks: the security review it was advised')
    expect(facts(b, review), review).toContain('security review advised but not run (touche les jetons)')
    // Sans réglage passé (appelant d'avant), la revue reste due aussi.
    expect(isCloseCandidate(run, groupD(b))).toBe(false)
  }
})

test('désactivée après l’avis, groupe ouvert : tranché tant que la lecture dit « désactivée »', () => {
  const b = advise(reviewedGroup(), 'on')
  const run = runOf(b)
  expect(isCloseCandidate(run, groupD(b), null, 'off')).toBe(true)
  expect(facts(b, 'off')).toContain(OFF_LINE)
  expect(isCloseCandidate(run, groupD(b), null, 'unread')).toBe(false)
})

test('réactivée, groupe ouvert conseillé sans revue : redevient dû, l’auto peut la lancer ; la marque reste sans effet', () => {
  const b = advise(reviewedGroup(), 'off')
  const run = runOf(b)
  expect(isCloseCandidate(run, groupD(b), null, 'on')).toBe(false)
  expect(closingText(run, null, true, 'on')).toContain('lacks: the security review it was advised')
  expect(facts(b, 'on')).toContain('security review advised but not run, turned back on since the advice (touche les jetons)')
  // En auto : réactivée, la revue de sécurité part ; désactivée, elle ne part pas.
  const on = autoDecision(run, { security: 'on' }, false)
  expect(on.kind === 'send' && on.action.kind === 'security' ? on.action.group : null).toBe('D')
  const unread = autoDecision(run, { security: 'unread' }, false)
  expect(unread.kind === 'send' && unread.action.kind === 'security').toBe(true)
  const off = autoDecision(run, { security: 'off' }, false)
  expect(off.kind === 'send' && off.action.kind === 'security').toBe(false)
})

test('groupe clos revue désactivée, puis réactivée : l’auto ne lance pas sa revue, et rien ne le retient', () => {
  const advised = advise(reviewedGroup(), 'on')
  const closed = applyReport(advised, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'off' }).board
  for (const review of ['on', 'unread'] as const) {
    const d = autoDecision(runOf(closed), { security: review }, false)
    expect(d.kind === 'send' && d.action.kind === 'security', review).toBe(false)
    expect(isCloseCandidate(runOf(closed), groupD(closed), null, review), review).toBe(false)
  }
  // Témoin : clos revue activée, sans marque, réactivée : l'auto lance bien sa revue.
  const kept = applyReport(advised, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'on' }).board
  const d = autoDecision(runOf(kept), { security: 'on' }, false)
  expect(d.kind === 'send' && d.action.kind === 'security' ? d.action.group : null).toBe('D')
})

test('un « closed » renvoyé pour un groupe déjà clos garde l’état de la fermeture, dans les deux sens', () => {
  const advised = advise(reviewedGroup(), 'on')
  // Clos revue désactivée, renvoyé revue activée : il reste clos « désactivée ».
  const off = applyReport(advised, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'off' }).board
  const offAgain = applyReport(off, { closed: [{ group: 'D', state: 'closed' }] }, 8_000, { security: 'on' }).board
  expect(groupD(offAgain).delegated?.closing?.at).toBe(8_000)
  expect(isClosedTurnedOff(groupD(offAgain))).toBe(true)
  expect(facts(offAgain, 'on')).toContain(OFF_LINE)
  // Clos revue activée, renvoyé revue désactivée : aucune marque, il ne devient jamais clos « désactivée ».
  const on = applyReport(advised, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'on' }).board
  const onAgain = applyReport(on, { closed: [{ group: 'D', state: 'closed' }] }, 8_000, { security: 'off' }).board
  expect(groupD(onAgain).security?.offAt).toBeUndefined()
  expect(isClosedTurnedOff(groupD(onAgain))).toBe(false)
  expect(isCloseCandidate(runOf(onAgain), groupD(onAgain), null, 'on')).toBe(false)
})

test('clos « désactivée » seulement par une lecture « off » à sa première fermeture, jamais d’après des dates', () => {
  // Une marque d'avis en avance de 50 s (dans la tolérance), la fermeture faite revue activée avant elle : pas clos « désactivée ».
  const ahead = advise(reviewedGroup(), 'off', 7_050)
  const closed = applyReport(ahead, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'on' }).board
  expect(groupD(closed).security?.offAt).toBe(7_050)
  expect(isClosedTurnedOff(groupD(closed))).toBe(false)
  // Un avis reçu après la fermeture, revue désactivée : sa marque ne fait pas du groupe un clos « désactivée ».
  const advisedOn = advise(reviewedGroup(), 'on')
  const shut = applyReport(advisedOn, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'on' }).board
  const late = applyReport(shut, { security: { group: 'D', advised: true, why: 'autre' } }, 8_000, { security: 'off' }).board
  expect(isClosedTurnedOff(groupD(late))).toBe(false)
  expect(groupD(late).delegated?.closing?.securityOff).toBeUndefined()
})

test('la réponse au manager : un avis « conseillée » reçu revue désactivée dit de ne lancer aucun relecteur', () => {
  const b = reviewedGroup()
  const off = applyReport(b, { security: { group: 'D', advised: true, why: 'touche les jetons' } }, 6_000, { security: 'off' })
  expect(off.text).toContain('security of group D: the security review is turned off for this project (its dashboard setting, read now): launch no security reviewer')
  expect(off.text).toContain('« revue de sécurité désactivée pour ce projet ; le groupe touchait : <zone> »')
  for (const review of ['on', 'unread'] as const) {
    const kept = applyReport(b, { security: { group: 'D', advised: true, why: 'touche les jetons' } }, 6_000, { security: review })
    expect(kept.text, review).not.toContain('security review is turned off for this project')
  }
  // Le lot : la même réponse, au nom du lot.
  const lot = applyReport(reviewedLot(), { security: { advised: true, why: 'touche les jetons' } }, 3_000, { security: 'off' })
  expect(lot.text).toContain('security of the lot: the security review is turned off')
  expect(lot.text).toContain('le lot touchait : <zone>')
})

test('fusion de deux copies d’un groupe clos : « clos revue désactivée » gardé quelle que soit la fermeture qui l’emporte', () => {
  const advised = advise(reviewedGroup(), 'on')
  const off = applyReport(advised, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'off' }).board
  const on = applyReport(advised, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'on' }).board
  expect(isClosedTurnedOff(groupD(mergeBoards(on, off)))).toBe(true)
  expect(isClosedTurnedOff(groupD(mergeBoards(off, on)))).toBe(true)
  // Deux copies closes revue activée : jamais « désactivée ».
  expect(isClosedTurnedOff(groupD(mergeBoards(on, on)))).toBe(false)
})

test('compte rendu : un réglage illisible n’est pas une réactivation', () => {
  const b = advise(reviewedGroup(), 'off')
  expect(facts(b, 'unread')).toContain('security review advised but not run, its setting unreadable now (counted as on)')
  expect(facts(b, 'unread')).not.toContain('turned back on')
})

test('une marque datée dans le futur (horloge en avance) tombe à la lecture : la revue redevient due', () => {
  const ahead = advise(reviewedGroup(), 'off', 6_000 + 86_400_000)
  expect(groupD(ahead).security?.offAt).toBe(6_000 + 86_400_000)
  const read = clampFuture(ahead, 7_000)
  expect(groupD(read).security?.offAt).toBeUndefined()
  expect(groupD(read).security?.isAdvised).toBe(true)
  // Fermée ensuite revue activée : jamais close « désactivée ».
  const closed = applyReport(read, { closed: [{ group: 'D', state: 'closed' }] }, 8_000, { security: 'on' }).board
  expect(isClosedTurnedOff(groupD(closed))).toBe(false)
  expect(isCloseCandidate(runOf(closed), groupD(closed), null, 'on')).toBe(false)
  // Le lot aussi.
  const lot = applyReport(reviewedLot(), { security: { advised: true, why: 'touche les jetons' } }, 3_000 + 86_400_000, { security: 'off' }).board
  expect(runOf(clampFuture(lot, 4_000)).security?.offAt).toBeUndefined()
})

test('compte rendu d’un groupe clos sans marque valide : la lecture du moment décide, comme la fermeture et la vue', () => {
  const advised = advise(reviewedGroup(), 'off')
  // Fermé sur une lecture ratée : pas de nouvelle marque ; celle de l'avis date d'avant la fermeture.
  const closed = applyReport(advised, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'unread' }).board
  expect(isClosedTurnedOff(groupD(closed))).toBe(false)
  expect(closingText(runOf(closed), null, true, 'off')).not.toContain('group D (Jetons) lacks')
  expect(facts(closed, 'off')).toContain(OFF_LINE)
  expect(facts(closed, 'off')).not.toContain('turned back on')
  expect(facts(closed, 'on')).toContain('turned back on since the advice')
})

test('fermeture d’un groupe conseillé sans revue, lu « désactivée » : marque posée à la fermeture ; lu activé ou illisible, aucune', () => {
  const advised = advise(reviewedGroup(), 'on')
  const closed = applyReport(advised, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'off' }).board
  expect(groupD(closed).delegated?.closing?.state).toBe('closed')
  expect(groupD(closed).security?.offAt).toBe(7_000)
  expect(isClosedTurnedOff(groupD(closed))).toBe(true)
  // Clos avec sa marque : ligne « désactivée » quel que soit le réglage ensuite, et plus rien ne le retient.
  for (const review of ['on', 'unread', 'off'] as const) expect(facts(closed, review), review).toContain(OFF_LINE)
  expect(closingText(runOf(closed), null, true, 'on')).not.toContain('group D (Jetons) lacks')
  for (const review of ['on', 'unread'] as const) {
    const kept = applyReport(advised, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: review }).board
    expect(groupD(kept).security?.offAt, review).toBeUndefined()
    expect(isClosedTurnedOff(groupD(kept)), review).toBe(false)
  }
})

test('une marque de l’avis antérieure à la fermeture (revue réactivée depuis) ne vaut pas « désactivée » au compte rendu', () => {
  const advised = advise(reviewedGroup(), 'off')
  // La revue réactivée ; un « closed » arrive quand même : la marque date de l'avis, avant la fermeture.
  const closed = applyReport(advised, { closed: [{ group: 'D', state: 'closed' }] }, 7_000, { security: 'on' }).board
  expect(groupD(closed).security?.offAt).toBe(6_000)
  expect(isClosedTurnedOff(groupD(closed))).toBe(false)
  expect(facts(closed, 'on')).not.toContain(OFF_LINE)
})

test('une revue lancée au bouton se compte comme toute revue ; la marque est alors sans effet', () => {
  const b = advise(reviewedGroup(), 'off')
  const ran = applyReport(b, { security: { group: 'D', findings: 1, fixed: 0 } }, 7_000, { security: 'off' }).board
  expect(groupD(ran).security?.ranAt).toBe(7_000)
  // Une faille gardée, pas corrigée : la revue désactivée ne la tranche pas.
  expect(isCloseCandidate(runOf(ran), groupD(ran), null, 'off')).toBe(false)
  expect(facts(ran, 'off')).toContain('security review run (1 finding, 0 fixed)')
  expect(facts(ran, 'off')).not.toContain(OFF_LINE)
})

test('la marque survit à la fusion des copies, au bornage des dates futures et au retour d’un groupe relayé', () => {
  const b = advise(reviewedGroup(), 'off')
  expect(groupD(clampFuture(b, 6_500)).security?.offAt).toBe(6_000)
  // La copie qui porte la marque gardée (la copie active d'ici, ou la plus récente relue sur le disque) :
  // la fusion ne la perd pas. Les groupes ne se fusionnent pas champ par champ : la copie gardée l'emporte.
  const older = reviewedGroup()
  expect(groupD(mergeBoards(b, older)).security?.offAt).toBe(6_000)
  const parked: Board = { ...older, activeId: null }
  expect(groupD({ ...mergeBoards(parked, b), activeId: runOf(b).id } as Board).security?.offAt).toBe(6_000)
  // Renvoyé à un worker, puis rendu avec l'avis « conseillée » relayé, la revue désactivée : la marque se pose au retour.
  const run0 = { ...newRun('implement', 1_000, 'Jetons'), owner: 's' }
  let r: Board = { ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run0], activeId: run0.id }
  r = applyReport(r, { tickets: [{ id: 'd1', name: 'Jetons', ...LOGIC }, { id: 'e1', name: 'Code', ...LOGIC }], groups: [{ id: 'D', name: 'Jetons', tickets: ['d1'] }, { id: 'E', name: 'Code', tickets: ['e1'] }] }, 2_000).board
  r = startLinkedGroups(r, ['D'], 3_000)!.board
  let relay = applyRelay(undefined, runOf(r).id, 'w1', { kind: 'start', group: 'D' }, 3_500)!
  relay = applyRelay(relay, runOf(r).id, 'w1', { kind: 'counts', security: { advised: true, why: 'touche les jetons' } }, 3_600)!
  const back = applyReport(r, { set: [{ id: 'd1', status: 'done' }], returned: ['D'] }, 4_000, { relay, security: 'off' }).board
  expect(groupD(back).security?.isAdvised).toBe(true)
  expect(groupD(back).security?.offAt).toBe(4_000)
})

test('nouveau passage du lot : l’avis repart de zéro, sa marque comprise', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  let b: Board = { ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(b, { tickets: [{ id: 'c1', name: 'Un', ...LOGIC }], set: [{ id: 'c1', status: 'done' }] }, 2_000).board
  // Le lot relu (sa revue faite) : seule sa sécurité reste.
  b = { ...b, runs: [{ ...runOf(b), reviewedAt: 2_500 }] }
  b = applyReport(b, { security: { advised: true, why: 'touche les jetons' } }, 3_000, { security: 'off' }).board
  expect(runOf(b).security?.offAt).toBe(3_000)
  // Lot : tranché par la lecture du moment ; réactivée, la revue redevient due.
  expect(isLotSecurityDue(runOf(b), 'off')).toBe(false)
  expect(isLotSecurityDue(runOf(b), 'on')).toBe(true)
  expect(isLotSecurityDue(runOf(b), 'unread')).toBe(true)
  // En auto : la revue du lot part, activée ou illisible ; désactivée, elle ne part pas.
  const isLotSent = (review: Review) => {
    const d = autoDecision(runOf(b), { security: review }, false)
    return d.kind === 'send' && d.action.kind === 'security'
  }
  expect(isLotSent('on')).toBe(true)
  expect(isLotSent('unread')).toBe(true)
  expect(isLotSent('off')).toBe(false)
  // Un ticket ajouté puis fini ouvre un nouveau passage : l'avis suivant repart d'un objet vide.
  b = applyReport(b, { tickets: [{ id: 'c2', name: 'Deux', ...LOGIC }] }, 4_000).board
  b = applyReport(b, { set: [{ id: 'c2', status: 'done' }] }, 5_000).board
  b = applyReport(b, { security: { advised: true, why: 'autre' } }, 6_000, { security: 'on' }).board
  expect(runOf(b).security?.offAt).toBeUndefined()
})

/** Un lot sans groupes, ses tickets finis et relus : seule sa sécurité reste. */
const reviewedLot = (): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  let b: Board = { ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(b, { tickets: [{ id: 'c1', name: 'Un', ...LOGIC }], set: [{ id: 'c1', status: 'done' }] }, 2_000).board
  return { ...b, runs: [{ ...runOf(b), reviewedAt: 2_500 }] }
}

test('lot conseillé : désactivée, marque posée, compte rendu « désactivée » et proposé ; activée ou illisible, aucune marque et la revue retient', () => {
  const off = applyReport(reviewedLot(), { security: { advised: true, why: 'touche les jetons' } }, 3_000, { security: 'off' }).board
  expect(runOf(off).security?.offAt).toBe(3_000)
  expect(reportFacts(runOf(off), 0, null, 'off').join('\n')).toContain('revue de sécurité désactivée pour ce projet ; le lot touchait : touche les jetons')
  // En manuel : la suite proposée (carte « Ensuite », commande grisée, signal « t'attend ») est le compte rendu.
  expect(suggestionsFor(runOf(off), { security: 'off' }).primary).toBe('compte-rendu')
  expect(nextCommandSkill(runOf(off), { security: 'off' })).toBe('compte-rendu')
  for (const review of ['on', 'unread'] as const) {
    const kept = applyReport(reviewedLot(), { security: { advised: true, why: 'touche les jetons' } }, 3_000, { security: review }).board
    expect(runOf(kept).security?.offAt, review).toBeUndefined()
    expect(reportFacts(runOf(kept), 0, null, review).join('\n'), review).not.toContain('revue de sécurité désactivée pour ce projet')
    expect(suggestionsFor(runOf(kept), { security: review }).primary, review).not.toBe('compte-rendu')
    // Lu désactivé plus tard, la marque posée à l'avis manque, mais la lecture du moment tranche le lot.
    expect(suggestionsFor(runOf(kept), { security: 'off' }).primary, review).toBe('compte-rendu')
  }
  // Sans réglage passé (appelant d'avant), la revue du lot retient le compte rendu.
  expect(suggestionsFor(runOf(off)).primary).not.toBe('compte-rendu')
})

test('lot : une revue lancée au bouton se compte comme toute revue, revue désactivée comprise', () => {
  const off = applyReport(reviewedLot(), { security: { advised: true, why: 'touche les jetons' } }, 3_000, { security: 'off' }).board
  const ran = applyReport(off, { security: { findings: 0, fixed: 0 } }, 4_000, { security: 'off' }).board
  expect(runOf(ran).security?.ranAt).toBe(4_000)
  expect(reportFacts(runOf(ran), 0, null, 'off').join('\n')).not.toContain('revue de sécurité désactivée pour ce projet')
})

test('retour d’un groupe relayé, réglage activé ou illisible : aucune marque', () => {
  for (const review of ['on', 'unread'] as const) {
    const run0 = { ...newRun('implement', 1_000, 'Jetons'), owner: 's' }
    let r: Board = { ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run0], activeId: run0.id }
    r = applyReport(r, { tickets: [{ id: 'd1', name: 'Jetons', ...LOGIC }, { id: 'e1', name: 'Code', ...LOGIC }], groups: [{ id: 'D', name: 'Jetons', tickets: ['d1'] }, { id: 'E', name: 'Code', tickets: ['e1'] }] }, 2_000).board
    r = startLinkedGroups(r, ['D'], 3_000)!.board
    let relay = applyRelay(undefined, runOf(r).id, 'w1', { kind: 'start', group: 'D' }, 3_500)!
    relay = applyRelay(relay, runOf(r).id, 'w1', { kind: 'counts', security: { advised: true, why: 'touche les jetons' } }, 3_600)!
    const back = applyReport(r, { set: [{ id: 'd1', status: 'done' }], returned: ['D'] }, 4_000, { relay, security: review }).board
    expect(groupD(back).security?.isAdvised, review).toBe(true)
    expect(groupD(back).security?.offAt, review).toBeUndefined()
  }
})

test('l’effacement d’une mission ne touche pas le réglage : aucune de ses familles ne porte sa clé', () => {
  const runId = newRun('implement', 1_000, 'X').id
  for (const family of MISSION_FAMILIES) expect(String(missionFamilyKey(family, runId)).startsWith('security-review:'), family).toBe(false)
  for (const family of WORKER_FAMILIES) expect(String(workerFamilyKey(family, runId, 'w1')).startsWith('security-review:'), family).toBe(false)
})

// ─── Le mod, réglage relu sur un disque en mémoire ─────────────────────────

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const ROOT = '/proj'
const NOW = 150_000_000
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const
const SETTING_KEY = `security-review:${ROOT}`
const isSettingFile = (path: string): boolean => /\/flow-board\/coordination\/[^/]+\.revue-securite\.json$/.test(path)

/** Le moteur sous le plugin : le réglage posé par le test (`review`, absent : jamais réglé), lu sous le dossier personnel. */
const world = (on: any) => {
  const w = { review: undefined as 'on' | 'off' | undefined, files: {} as Record<string, string>, mem: {} as Record<string, unknown>, filled: [] as string[] }
  const record = () => (w.review === undefined ? undefined : { v: 1, root: ROOT, review: w.review, at: NOW - 1_000 })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    w.filled.push(e.text)
    return { isFilled: true }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'session-A' }))
  on('session.root', () => ({ value: ROOT }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  // Le dossier personnel, sous lequel vit le réglage.
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  // L'app répond au lancement d'un worker avec son id, tiré du groupe que le titre nomme.
  on('tool.call', { tool: 'mcp__ccd_session__start_session' }, (_$: unknown, e: { title: string }) => ({
    result: { text: `Started session local_${/Groupe (\w+)/.exec(e.title)?.[1] ?? 'x'}42.` },
  }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: e.key === SETTING_KEY ? record() : w.mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    w.mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  const fileOf = (path: string): string | undefined => (isSettingFile(path) ? (record() ? JSON.stringify(record()) : undefined) : w.files[path])
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: fileOf(e.path) !== undefined }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const text = fileOf(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text } as any
  })
  on('fs.list', (_$: unknown, e: { path?: string }) => {
    const dir = (e.path ?? '').replace(/\/+$/, '')
    const names = new Set(Object.keys(w.files).filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1).split('/')[0]!))
    return { value: [...names].map(name => ({ name, kind: 'file', size: 0, mtimeMs: 0, isLink: false })) } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    w.files[e.path] = e.text
    return { value: undefined } as any
  })
  return w
}

const groupedImplement = async ($: any): Promise<string> => {
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'A1', name: 'Un', blockedBy: [] }, { id: 'B1', name: 'Deux', blockedBy: [] }], groups: [{ id: 'A', name: 'Worker', tickets: ['A1'] }, { id: 'B', name: 'App', tickets: ['B1'] }] } as any)
  return (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text
}

test('le mod : désactivée, la consigne d’avis dit de juger et d’envoyer l’avis sans lancer de relecteur ; activée, elle ne le dit pas', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  w.review = 'off'
  const off = await groupedImplement($)
  expect(off).toContain('The security review is turned off for this project (its dashboard setting, read now): still judge the advice and send it as above, but launch no security reviewer')
  expect(off).toContain('« revue de sécurité désactivée pour ce projet ; le groupe touchait : <zone> »')
  w.review = 'on'
  const on2 = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text
  expect(on2).toContain('- Security review:')
  expect(on2).not.toContain('The security review is turned off for this project')
})

test('le mod : un avis « conseillée » reçu revue désactivée est marqué ; la ligne dit « désactivée », le bouton reste ; réactivée, elle redevient conseillée', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  w.review = 'off'
  await groupedImplement($)
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }] } as any)
  const reply = String(((await $.tool.call({ tool: TOOL, security: { group: 'A', advised: true, why: 'touche les jetons' } } as any)) as any)?.result ?? '')
  expect(reply).not.toContain('error')
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'security-group-A' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /conseillée : touche les jetons · revue de sécurité désactivée pour ce projet/ })).toBeDefined()
  await ui.unmount()
  // Réactivée par un clic (ici, posée par le test) : la ligne redevient « conseillée », sans la mention.
  w.review = 'on'
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^conseillée : touche les jetons$/ })).toBeDefined()
  await ui.unmount()
})

test('le mod : la demande de revue renvoyée au worker ne fait lancer aucun relecteur de sécurité quand la revue est désactivée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Jetons', tickets: [{ id: 'd1', name: 'Jetons', blockedBy: [] }, { id: 'd2', name: 'Clés', blockedBy: [] }, { id: 'e1', name: 'Code', blockedBy: [] }], groups: [{ id: 'D', name: 'Jetons', tickets: ['d1', 'd2'] }, { id: 'E', name: 'Code', tickets: ['e1'] }] } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-D' })
  await ui.unmount()
  await $.tool.call({ tool: TOOL, set: [{ id: 'd1', status: 'done' }, { id: 'd2', status: 'done' }], returned: ['D'] } as any)
  for (let i = 0; i < 3; i++) await clock.advance(1000)
  const ask = async (): Promise<string> => {
    ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
    await ui.press({ key: 'review-linked-D' })
    await ui.unmount()
    return w.filled.at(-1) ?? ''
  }
  w.review = 'off'
  const off = await ask()
  expect(off).toMatch(/^Fais faire la revue du groupe D/)
  expect(off).toContain('ne lancer aucun relecteur : la revue de sécurité est désactivée pour ce projet')
  expect(off).not.toContain('la confier à un spécialiste relecteur')
  w.review = 'on'
  const on2 = await ask()
  expect(on2).toContain('la confier à un spécialiste relecteur')
  expect(on2).not.toContain('la revue de sécurité est désactivée pour ce projet')
})

test('le mod d’un worker : son avis « conseillée » reçoit, revue désactivée, la consigne de ne lancer aucun relecteur', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.tool.call({ tool: TOOL, delegate: 'mission-x', group: 'B', main: 'Mission [abc123]' } as any)
  const advise = async (): Promise<string> => JSON.stringify(await $.tool.call({ tool: TOOL, security: { group: 'B', advised: true, why: 'touche les jetons' } } as any))
  w.review = 'off'
  expect(await advise()).toContain('the security review is turned off for this project (its dashboard setting, read now): launch no security reviewer')
  w.review = 'on'
  const onText = await advise()
  expect(onText).toContain('Relayed')
  expect(onText).not.toContain('security review is turned off for this project')
  // Une revue déjà faite (ses comptes avec l'avis) : rien ne lui dit de s'en passer ni de la noter « désactivée ».
  w.review = 'off'
  const ran = JSON.stringify(await $.tool.call({ tool: TOOL, security: { group: 'B', advised: true, why: 'touche les jetons', findings: 1, fixed: 1 } } as any))
  expect(ran).toContain('Relayed')
  expect(ran).not.toContain('security review is turned off for this project')
})
