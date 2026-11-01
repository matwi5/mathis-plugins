import { expect, mock, test } from 'claude-code/testing'

import { applyReport, applySkill, clampFuture, emptyBoard, mergeBoards, needsReview, newRun, reportFacts, suggestionsFor } from '../hooks/model.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board, Run } from '../types'

// L'avis de sécurité d'un lot sans groupes porte sa date : il ne tranche la sécurité du lot que s'il
// est postérieur à la dernière fin de ticket et à la dernière revue du lot. Invariant : l'avis n'est jamais effacé ni réécrit vide
// par un nouveau passage, et un avis antérieur à la dernière fin de ticket ne rend jamais la sécurité
// du lot tranchée. Un nouveau passage remplace l'avis par le nouvel avis reçu ; les comptes du passage
// précédent vont au journal.

const CODE = { sensitive: false, logic: true }
const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

/** Un lot sans groupes d'un ticket de logique, fait à 4 000. */
const doneLot = (): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const b = applyReport(board, { tickets: [{ id: 't1', name: 'Un', ...CODE }] }, 2_000).board
  return applyReport(b, { set: [{ id: 't1', status: 'done' }] }, 4_000).board
}
const runOf = (b: Board): Run => activeRun(b)!
const review = (b: Board, now: number): Board => applySkill(b, 'code-review', { now, isMain: true })!.board
const send = (b: Board, security: Record<string, unknown>, now: number) => applyReport(b, { security }, now)
/** Un ticket t<n> ajouté à `at`, fini à `at + 500`. */
const addDone = (b: Board, n: number, at: number): Board => {
  const added = applyReport(b, { tickets: [{ id: `t${n}`, name: `Ticket ${n}`, ...CODE }] }, at).board
  return applyReport(added, { set: [{ id: `t${n}`, status: 'done' }] }, at + 500).board
}

/** Le premier passage relu, sa sécurité tranchée : 2 failles, 1 corrigée, 1 laissée. */
const settled = (): Board => {
  const reviewed = review(doneLot(), 5_000)
  const advised = send(reviewed, { advised: true, why: 'un chemin lu ailleurs' }, 5_100).board
  return send(advised, { findings: 2, fixed: 1, dismissed: 1 }, 5_200).board
}

test('chaque envoi de sécurité du lot pose sa date, même un envoi qui ne change que les comptes', () => {
  const reviewed = review(doneLot(), 5_000)
  const advised = send(reviewed, { advised: true }, 5_100).board
  expect(runOf(advised).security?.at).toBe(5_100)
  const counted = send(advised, { findings: 1, fixed: 1 }, 5_200).board
  expect(runOf(counted).security?.at).toBe(5_200)
  expect(runOf(counted).security?.isAdvised).toBe(true)
  expect(suggestionsFor(runOf(counted)).primary).toBe('compte-rendu')
})

test('un avis antérieur à la dernière fin de ticket ne tranche pas la sécurité du lot', () => {
  const next = review(addDone(settled(), 9, 6_000), 7_000)
  const run = runOf(next)
  expect(needsReview(run)).toBe(false)
  // L'avis du passage précédent est toujours là, jamais effacé, mais ne compte plus.
  expect(run.security?.findings).toBe(2)
  expect(suggestionsFor(run).primary).toBeNull()
  expect(suggestionsFor(run).others).not.toContain('compte-rendu')
  expect(reportFacts(run).join('\n')).toContain('security advice older than the last ticket end or the last lot review, not settled for the current pass')
})

test('le premier avis d’un nouveau passage repart de zéro ; les comptes de l’ancien vont au journal, et la réponse le dit', () => {
  const next = review(addDone(settled(), 9, 6_000), 7_000)
  const out = send(next, { advised: true, why: 'un autre chemin' }, 7_100)
  const sec = runOf(out.board).security!
  expect(sec).toEqual({ isAdvised: true, why: 'un autre chemin', at: 7_100 })
  expect(runOf(out.board).log.some(l => /nouveau passage/.test(l.text) && /2 faille\(s\), 1 corrigée\(s\), 1 laissée\(s\)/.test(l.text))).toBe(true)
  expect(out.text).toContain('the counts of the previous pass no longer count')
  // Le passage en cours se tranche par ses propres comptes.
  const fixed = send(out.board, { findings: 1, fixed: 1 }, 7_200).board
  expect(runOf(fixed).security).toEqual({ isAdvised: true, why: 'un autre chemin', at: 7_200, findings: 1, fixed: 1, ranAt: 7_200 })
  expect(suggestionsFor(runOf(fixed)).primary).toBe('compte-rendu')
})

test('un avis sans date se date par la dernière revue du lot ; sans revue du lot, il ne compte pas', () => {
  const old = settled()
  delete (runOf(old).security as Record<string, unknown>).at
  // Aucun ticket fini après la revue : il compte.
  expect(suggestionsFor(runOf(old)).primary).toBe('compte-rendu')
  // Un ticket fini après la revue : il ne compte plus, ni après la revue suivante, qui le date d'abord
  // par la revue d'avant (seul `at` s'écrit).
  const finished = addDone(old, 9, 6_000)
  expect(needsReview(runOf(finished))).toBe(true)
  const next = review(finished, 7_000)
  expect(runOf(next).security).toEqual({ isAdvised: true, why: 'un chemin lu ailleurs', ranAt: 5_200, findings: 2, fixed: 1, dismissed: 1, at: 5_000 })
  expect(suggestionsFor(runOf(next)).primary).toBeNull()
  // Sans revue d'avant, la revue le date à 0 : il ne comptera jamais.
  const first = doneLot()
  runOf(first).security = { isAdvised: false }
  const firstReviewed = review(first, 5_000)
  expect(runOf(firstReviewed).security).toEqual({ isAdvised: false, at: 0 })
  expect(suggestionsFor(runOf(firstReviewed)).primary).toBeNull()
  // Sans revue du lot (un lot dispensé n'en a pas, et l'envoi explicite l'emporte sur sa dispense) : il ne compte pas.
  const light = applyReport(doneLot(), { tickets: [{ id: 't1', name: 'Un', sensitive: false, logic: false }] }, 4_100).board
  runOf(light).security = { isAdvised: false }
  expect(needsReview(runOf(light))).toBe(false)
  expect(suggestionsFor(runOf(light)).primary).toBeNull()
  // Daté, le même avis tranche.
  runOf(light).security = { isAdvised: false, at: 4_200 }
  expect(suggestionsFor(runOf(light)).primary).toBe('compte-rendu')
})

test('/security-review tapé sans groupes date l’avis ; sur un nouveau passage, il repart de zéro en gardant son lancement', () => {
  const same = applySkill(review(doneLot(), 5_000), 'security-review', { now: 5_100, isMain: true })!.board
  expect(runOf(same).security).toEqual({ ranAt: 5_100, at: 5_100 })
  const next = review(addDone(settled(), 9, 6_000), 7_000)
  const typed = applySkill(next, 'security-review', { now: 7_100, isMain: true })!.board
  expect(runOf(typed).security).toEqual({ ranAt: 7_100, at: 7_100 })
  expect(runOf(typed).log.some(l => /nouveau passage/.test(l.text))).toBe(true)
  // Les comptes qui suivent sont ceux de ce passage, son lancement gardé.
  const counted = send(typed, { findings: 0, fixed: 0 }, 7_200).board
  expect(runOf(counted).security).toEqual({ ranAt: 7_100, at: 7_200, findings: 0, fixed: 0 })
  expect(suggestionsFor(runOf(counted)).primary).toBe('compte-rendu')
})

/** Les deux copies fusionnées, dans les deux ordres : celle de cette discussion d'abord, puis l'autre. */
const bothWays = (a: Board, b: Board): Run[] => [runOf(mergeBoards(a, b)), runOf(mergeBoards(b, a))]

test('fusion : la dernière revue du lot la plus récente et l’avis de date la plus récente l’emportent, dans les deux ordres', () => {
  const base = review(doneLot(), 5_000)
  const early = send(base, { advised: true, why: 'a' }, 5_100).board
  const late = send(review(base, 6_000), { advised: false, why: 'b' }, 6_100).board
  for (const run of bothWays(early, late)) {
    expect(run.reviewedAt).toBe(6_000)
    expect(run.security).toEqual({ isAdvised: false, why: 'b', at: 6_100 })
  }
  // Une revue plus récente d'un côté, un avis plus récent de l'autre : chacun garde le sien.
  const reviewedLater = review(base, 6_500)
  for (const run of bothWays(early, reviewedLater)) {
    expect(run.reviewedAt).toBe(6_500)
    expect(run.security).toEqual({ isAdvised: true, why: 'a', at: 5_100 })
  }
})

test('fusion : un avis daté l’emporte sur un avis sans date, et aucune copie ne vide l’avis du lot', () => {
  const base = review(doneLot(), 5_000)
  const dated = send(base, { advised: true, why: 'daté' }, 5_100).board
  const undated = send(base, { advised: false, why: 'sans date' }, 6_100).board
  delete (runOf(undated).security as Record<string, unknown>).at
  for (const run of bothWays(dated, undated)) expect(run.security).toEqual({ isAdvised: true, why: 'daté', at: 5_100 })
  // Une copie sans avis (écrite plus tard ailleurs) ne vide pas celui de l'autre.
  const without = applyReport(base, { note: 'rien' }, 9_000).board
  for (const run of bothWays(dated, without)) expect(run.security).toEqual({ isAdvised: true, why: 'daté', at: 5_100 })
})

test('sur un nouveau passage, seul un avis l’ouvre : un envoi vide, une raison, des comptes ou des failles laissées en retard restent sur l’ancien avis et ne tranchent rien', () => {
  const next = review(addDone(settled(), 9, 6_000), 7_000)
  const sends: Record<string, unknown>[] = [{}, { why: 'précision' }, { findings: 0, fixed: 0 }, { dismissed: 2 }]
  for (const security of sends) {
    const out = send(next, security, 7_100)
    const sec = runOf(out.board).security!
    // Jamais réécrit vide : l'avis enregistré reste, avec sa date d'avant la dernière fin de ticket.
    expect(sec.isAdvised).toBe(true)
    expect(sec.at).toBe(5_200)
    expect(suggestionsFor(runOf(out.board)).primary).toBeNull()
    expect(out.text).toContain('settles nothing for the current pass')
    expect(runOf(out.board).log.some(l => /nouveau passage/.test(l.text))).toBe(false)
  }
  // Un avis sans date d'un lot relu reçoit la date qu'il avait : celle de sa revue.
  const undated = review(addDone(settled(), 9, 6_000), 7_000)
  delete (runOf(undated).security as Record<string, unknown>).at
  runOf(undated).reviewedAt = 5_000
  const late = send(undated, { findings: 3, fixed: 3 }, 7_100).board
  expect(runOf(late).security?.at).toBe(5_000)
})

test('fusion : la revue de l’autre copie n’est reprise que si elle a vu chaque ticket fini de la copie gardée', () => {
  const base = review(doneLot(), 5_000)
  // Cette discussion finit t2 à 6 500 ; l'autre, qui ne l'a pas vu, relit le lot à 7 000.
  const mine = addDone(base, 2, 6_000)
  const theirs = review(base, 7_000)
  const merged = runOf(mergeBoards(mine, theirs))
  expect(merged.reviewedAt).toBe(5_000)
  expect(needsReview(merged)).toBe(true)
  // Une revue qui a vu t2 fini avant elle est reprise.
  const seen = review(mine, 8_000)
  const kept = runOf(mergeBoards(mine, seen))
  expect(kept.reviewedAt).toBe(8_000)
  expect(needsReview(kept)).toBe(false)
  // Dans l'autre sens, la copie gardée a vu moins de tickets : la revue de l'autre, qui a tout vu, est reprise.
  const back = runOf(mergeBoards(theirs, seen))
  expect(back.reviewedAt).toBe(8_000)
})

test('fusion : l’avis de l’autre copie n’est repris que si elle avait vu, avant lui, chaque ticket fini de la copie gardée', () => {
  const base = review(doneLot(), 5_000)
  // Ici : t2 fini à 6 500, relu à 7 000, avis conseillé à 7 100. L'autre copie, sans t2, juge inutile à 8 000.
  const mine = send(review(addDone(base, 2, 6_000), 7_000), { advised: true, why: 'conseillée' }, 7_100).board
  const theirs = send(review(base, 7_500), { advised: false, why: 'inutile' }, 8_000).board
  const merged = runOf(mergeBoards(mine, theirs))
  expect(merged.security).toEqual({ isAdvised: true, why: 'conseillée', at: 7_100 })
  expect(suggestionsFor(merged).primary).toBeNull()
  // Un avis de l'autre copie qui avait vu t2 avant lui est repris.
  const seen = send(mine, { advised: false, why: 'inutile' }, 9_000).board
  expect(runOf(mergeBoards(mine, seen)).security).toEqual({ isAdvised: false, why: 'inutile', at: 9_000 })
})

test('fusion : un ticket rouvert puis refini ici, après que l’autre copie l’a vu fini, n’est pas couvert par sa revue', () => {
  const base = review(doneLot(), 5_000)
  // L'autre copie relit à 7 000, après avoir vu t1 fini à 4 000 ; ici, t1 est rouvert puis refini à 6 500.
  const theirs = review(base, 7_000)
  const reopened = applyReport(base, { set: [{ id: 't1', status: 'doing' }] }, 6_000).board
  const mine = applyReport(reopened, { set: [{ id: 't1', status: 'done' }] }, 6_500).board
  const merged = runOf(mergeBoards(mine, theirs))
  expect(merged.reviewedAt).toBe(5_000)
  expect(needsReview(merged)).toBe(true)
})

test('un avis du lot ne compte que s’il suit aussi la dernière revue du lot : un /security-review tapé avant le /code-review ne compte pas', () => {
  const typed = applySkill(doneLot(), 'security-review', { now: 4_500, isMain: true })!.board
  const counted = send(typed, { findings: 0, fixed: 0 }, 4_600).board
  const reviewed = review(counted, 5_000)
  expect(needsReview(runOf(reviewed))).toBe(false)
  expect(suggestionsFor(runOf(reviewed)).primary).toBeNull()
  // L'avis donné après la revue tranche.
  const advised = send(reviewed, { advised: false, why: 'rien de sensible' }, 5_100).board
  expect(suggestionsFor(runOf(advised)).primary).toBe('compte-rendu')
})

test('fusion : un avis sans date, à côté d’une revue plus récente de l’autre copie, se date par la revue de sa copie et ne compte pas', () => {
  const old = settled()
  delete (runOf(old).security as Record<string, unknown>).at
  // L'autre copie du même parcours : un ticket fini après la revue, puis relu, sans avis.
  const other = review(addDone(old, 9, 6_000), 7_000)
  delete runOf(other).security
  // Gardée ici (sans t9), la revue de l'autre copie, qui a tout vu, est reprise : l'avis sans date se date
  // d'abord par la revue de sa copie, et ne compte pas.
  const [kept, back] = bothWays(old, other)
  expect(kept!.reviewedAt).toBe(7_000)
  expect(kept!.security?.at).toBe(5_000)
  expect(suggestionsFor(kept!).primary).toBeNull()
  // Gardée là-bas (avec t9, sans avis), l'avis de la copie qui n'a pas vu t9 n'est pas perdu, mais repris
  // daté 0 : il ne vaut pour aucun passage d'ici.
  expect(back!.reviewedAt).toBe(7_000)
  expect(back!.security).toMatchObject({ isAdvised: true, findings: 2, fixed: 1, dismissed: 1, at: 0 })
  expect(suggestionsFor(back!).primary).toBeNull()
})

test('l’envoi qui ouvre un nouveau passage ne prend pas les comptes qu’il porte : ils viennent d’une revue de sécurité lancée avant lui', () => {
  const next = review(addDone(settled(), 9, 6_000), 7_000)
  const out = send(next, { advised: true, why: 'conseillée', findings: 2, fixed: 2 }, 7_100)
  expect(runOf(out.board).security).toEqual({ isAdvised: true, why: 'conseillée', at: 7_100 })
  expect(suggestionsFor(runOf(out.board)).primary).toBeNull()
  expect(out.text).toContain('the counts sent with it are not recorded')
  // Ceux d'une revue lancée après l'avis, dans un autre envoi, tranchent.
  const counted = send(out.board, { findings: 0, fixed: 0 }, 7_300).board
  expect(suggestionsFor(runOf(counted)).primary).toBe('compte-rendu')
})

test('un avis de sécurité du lot daté au-delà de la tolérance ne vaut plus pour aucun passage', () => {
  const b = settled()
  runOf(b).security!.at = 99_000_000
  const read = clampFuture(b, 10_000)
  expect(runOf(read).security?.at).toBe(0)
  expect(runOf(read).security?.findings).toBe(2)
  expect(suggestionsFor(runOf(read)).primary).toBeNull()
})

const world = (on: any): string[] => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

test('le panneau : relu de nouveau, un avis d’avant la dernière fin de ticket laisse la ligne du lot demander celui du passage', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 96_000_000 })
  mock.store(on)
  const filled = world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Code', tickets: [{ id: 'c1', name: 'Un', ...CODE }] } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'c1', status: 'done' }] } as any)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, security: { advised: false, why: 'rien de sensible' } } as any)
  await clock.advance(1000)
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'c2', name: 'Deux', ...CODE }] } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'c2', status: 'done' }] } as any)
  // À relire : la revue d'abord, rien sur l'avis d'avant.
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-final-review' })).toBeDefined()
  expect(await ui.find({ key: 'security-group-lot' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /jugée inutile/ })).toBeUndefined()
  await ui.unmount()
  await clock.advance(1000)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const shown = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await shown.find({ type: 'Text', text: /^avis de sécurité d’avant la dernière fin de ticket ou la dernière revue : celui de ce passage est attendu$/ })).toBeDefined()
    expect(await shown.find({ key: 'security-group-lot' })).toBeDefined()
    expect(await shown.find({ key: 'go-compte-rendu' })).toBeUndefined()
    await shown.unmount()
  }
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'security-group-lot' })
  await ui.unmount()
  expect(filled.at(-1)).toMatch(/^Avant de la lancer, envoie à l'outil flow \{"security": \{"advised": true, "why": "<raison>"\}\} : l'avis de ce passage\. Lance la revue de sécurité de ce parcours/)
})
