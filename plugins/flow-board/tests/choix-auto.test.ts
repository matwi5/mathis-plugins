// « Décidé sans toi » en mode auto : chaque choix peut porter son origine (reco prise, validation
// sautée, choix de session liée) ; un parcours qui a été en auto ne coupe aucun choix avant la
// validation du rapport (invariant : en auto, aucun choix déclaré n'est coupé avant la validation du
// rapport), se met en pause à 200, refuse un nouveau choix au-delà de 1 000, puis garde les 200 plus
// récents une fois le rapport validé. Hors auto, rien ne change : les 30 plus récents.

import { expect, test } from 'claude-code/testing'

import { applyRelay, applyReport, autoNotices, decidedFileText, finishActive, emptyBoard, isAutoOn, mergeBoards, newRun, reportFacts, switchOffAuto, switchOnAuto, validateReport } from '../hooks/model.ts'
import type { Board, Relay, Run } from '../types'

const T0 = 97_000_000

/** Un parcours en Implémentation actif dans la discussion « sa », avec un groupe confié (B) et un compte rendu à venir. */
const lot = (): Board => {
  const run: Run = { ...newRun('implement', T0, 'Boutique'), owner: 'sa' }
  const board: Board = { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
  return applyReport(
    board,
    {
      tickets: [
        { id: 't1', name: 'Un' },
        { id: 't2', name: 'Deux' },
      ],
      groups: [
        { id: 'A', name: 'Code', tickets: ['t1'] },
        { id: 'B', name: 'Données', tickets: ['t2'] },
      ],
    },
    T0 + 1,
  ).board
}
const runOf = (board: Board): Run => board.runs[0]!
const declare = (board: Board, n: number, from: number, now: number, origin?: string): Board =>
  applyReport(board, { decided: Array.from({ length: n }, (_, i) => ({ what: `Choix ${from + i}`, ...(origin ? { origin } : {}) })) }, now).board

test('Un choix déclaré garde son origine ; un choix sans origine reste valide ; une origine inconnue est écartée, le choix gardé', () => {
  const out = applyReport(
    lot(),
    {
      decided: [
        { what: 'Spec validée', why: 'auto', origin: 'skipped-validation' },
        { what: 'Option A', origin: 'recommendation' },
        { what: 'Sans origine' },
        { what: 'Origine bizarre', origin: 'autre' },
      ],
    },
    T0 + 2,
  )
  const decided = runOf(out.board).decided!
  expect(decided.map(d => [d.what, d.origin])).toEqual([
    ['Spec validée', 'skipped-validation'],
    ['Option A', 'recommendation'],
    ['Sans origine', undefined],
    ['Origine bizarre', undefined],
  ])
  expect(out.text).toContain('origin "autre" ignored')
})

test('Hors auto, les choix se comportent comme avant : les 30 plus récents', () => {
  const board = declare(lot(), 35, 0, T0 + 2)
  const decided = runOf(board).decided!
  expect(decided).toHaveLength(30)
  expect(decided[0]!.what).toBe('Choix 5')
})

test('En auto, aucun choix n’est coupé ; à 200, l’auto se met en pause (« limite de 200 choix atteinte ») et le choix suivant n’en efface aucun', () => {
  const on = switchOnAuto(lot(), 'sa', T0 + 2)!.board
  const at199 = declare(on, 199, 0, T0 + 3)
  expect(runOf(at199).decided).toHaveLength(199)
  expect(isAutoOn(runOf(at199))).toBe(true)
  const at200 = declare(at199, 1, 199, T0 + 4)
  expect(runOf(at200).decided).toHaveLength(200)
  expect(isAutoOn(runOf(at200))).toBe(false)
  expect(runOf(at200).auto).toMatchObject({ offWhy: 'limite de 200 choix atteinte' })
  // L'auto éteint, le parcours a été en auto : rien n'est coupé, ni retour à 30.
  const at201 = declare(at200, 1, 200, T0 + 5)
  expect(runOf(at201).decided).toHaveLength(201)
  expect(runOf(at201).decided![0]!.what).toBe('Choix 0')
  // La pause à la limite se notifie, au texte fixé.
  expect(autoNotices(at199, at200)).toEqual(['Parcours Boutique : auto en pause (limite de 200 choix atteinte)'])
  // Coupé par la personne : pareil.
  const cut = declare(switchOffAuto(declare(on, 40, 0, T0 + 3), T0 + 4)!.board, 5, 40, T0 + 5)
  expect(runOf(cut).decided).toHaveLength(45)
})

test('La pause vient au passage des 200 choix : rallumé ensuite par deux clics, l’auto ne retombe pas à l’appel suivant', () => {
  const on = switchOnAuto(lot(), 'sa', T0 + 2)!.board
  const paused = declare(on, 200, 0, T0 + 3)
  expect(isAutoOn(runOf(paused))).toBe(false)
  const relit = switchOnAuto(paused, 'sa', T0 + 4)!.board
  expect(isAutoOn(runOf(relit))).toBe(true)
  // Un appel sans choix, puis un choix de plus : l'auto reste allumé, rien n'est coupé.
  const noted = applyReport(relit, { note: 'un pas' }, T0 + 5).board
  expect(isAutoOn(runOf(noted))).toBe(true)
  const more = declare(noted, 1, 200, T0 + 6)
  expect(isAutoOn(runOf(more))).toBe(true)
  expect(runOf(more).decided).toHaveLength(201)
})

test('Un état auto abîmé dans les deux copies reste au parcours : il a été en auto, et la fusion ne coupe aucun de ses choix', () => {
  const on = switchOnAuto(lot(), 'sa', T0 + 2)!.board
  const many = declare(on, 300, 0, T0 + 3)
  for (const auto of [{ onAt: 'bad' }, 'x', null]) {
    const damaged: Board = { ...many, runs: many.runs.map(r => ({ ...r, auto }) as unknown as Run) }
    const merged = mergeBoards(damaged, damaged)
    expect(runOf(merged).auto).toEqual(auto)
    expect(runOf(merged).decided).toHaveLength(300)
    // Le choix suivant n'en coupe aucun.
    expect(runOf(declare(merged, 1, 300, T0 + 4)).decided).toHaveLength(301)
  }
})

test('Au-delà de 1 000 choix avant le rapport, un nouveau choix est refusé avec un message, jamais un ancien coupé', () => {
  const on = switchOnAuto(lot(), 'sa', T0 + 2)!.board
  let board = on
  for (let i = 0; i < 1000; i += 250) board = declare(board, 250, i, T0 + 3 + i)
  expect(runOf(board).decided).toHaveLength(1000)
  const refused = applyReport(board, { decided: [{ what: 'Choix de trop' }] }, T0 + 2000)
  expect(runOf(refused.board).decided).toHaveLength(1000)
  expect(runOf(refused.board).decided!.some(d => d.what === 'Choix de trop')).toBe(false)
  expect(refused.text).toContain('1000 choices at most')
})

test('Une fois le rapport validé, un parcours qui a été en auto garde les 200 choix les plus récents', () => {
  const on = switchOnAuto(lot(), 'sa', T0 + 2)!.board
  const many = declare(on, 250, 0, T0 + 3)
  // Le parcours arrive au compte rendu, que la personne valide.
  const atReport = applyReport(many, { fix: { phase: 'compte-rendu', step: 'validate' } }, T0 + 4).board
  const validated = validateReport(atReport, T0 + 5)!.board
  expect(runOf(validated).decided).toHaveLength(250)
  const after = declare(validated, 1, 250, T0 + 6)
  expect(runOf(after).decided).toHaveLength(200)
  expect(runOf(after).decided!.at(-1)!.what).toBe('Choix 250')
})

/** Le groupe B du lot confié à la session « lb », qui relaie `items` comme choix faits sans la personne. */
const relayedFromB = (board: Board, items: { what: string; why?: string }[], at = T0 + 5) => {
  const sent: Board = { ...board, runs: board.runs.map(r => ({ ...r, groups: r.groups!.map(g => (g.id === 'B' ? { ...g, linked: { at: T0 + 3, session: 'lb' } } : g)) })) }
  const relay = applyRelay(applyRelay(null, runOf(sent).id, 'lb', { kind: 'start', group: 'B' }, T0 + 4), runOf(sent).id, 'lb', { kind: 'decided', items }, at) as Relay
  return { sent, relay }
}

test('En auto, les choix venus du relais d’une session liée prennent l’origine « choix de session liée », affichés comme gardés ; hors auto, aucune origine', () => {
  const { sent, relay } = relayedFromB(switchOnAuto(lot(), 'sa', T0 + 2)!.board, [{ what: 'Choix de B', why: 'raison' }])
  const file = decidedFileText(runOf(sent), relay)
  expect(file).toContain('Choix de B — raison (choix de session liée, groupe B')
  // Rendu, le groupe verse ses choix dans le parcours, avec leur origine.
  const back = applyReport(sent, { set: [{ id: 't2', status: 'done' }], returned: ['B'] }, T0 + 6, { relay }).board
  expect(runOf(back).decided!.find(d => d.what === 'Choix de B')).toMatchObject({ origin: 'linked-session' })
  // Un parcours qui n'a jamais été en auto : rien ne change, ni origine ni regroupement.
  const plain = relayedFromB(lot(), [{ what: 'Choix de B', why: 'raison' }])
  expect(decidedFileText(runOf(plain.sent), plain.relay)).toContain('Choix de B — raison (groupe B,')
  const plainBack = applyReport(plain.sent, { set: [{ id: 't2', status: 'done' }], returned: ['B'] }, T0 + 6, { relay: plain.relay }).board
  expect(runOf(plainBack).decided!.find(d => d.what === 'Choix de B')!.origin).toBeUndefined()
  expect(reportFacts(runOf(plainBack)).join('\n')).not.toContain('by origin')
})

test('Au retour d’un groupe, tous ses choix relayés sont gardés, même au-delà de 1 000', () => {
  let board = switchOnAuto(lot(), 'sa', T0 + 2)!.board
  for (let i = 0; i < 1000; i += 250) board = declare(board, 250, i, T0 + 3 + i)
  const { sent, relay } = relayedFromB(board, [{ what: 'Relayé un' }, { what: 'Relayé deux' }], T0 + 2000)
  const back = applyReport(sent, { set: [{ id: 't2', status: 'done' }], returned: ['B'] }, T0 + 2001, { relay }).board
  expect(runOf(back).decided).toHaveLength(1002)
  expect(runOf(back).decided!.some(d => d.what === 'Relayé deux')).toBe(true)
})

test('« ✓ Clore le parcours » avant la validation du rapport ne vaut pas validation : aucun choix n’est coupé', () => {
  const many = declare(switchOnAuto(lot(), 'sa', T0 + 2)!.board, 250, 0, T0 + 3)
  const atReport = applyReport(many, { fix: { phase: 'compte-rendu', step: 'validate' } }, T0 + 4).board
  const closed = finishActive(atReport, T0 + 5)!.board
  expect(runOf(closed).reportValidatedAt).toBeUndefined()
  expect(runOf(mergeBoards(closed, many)).decided).toHaveLength(250)
  // Validé par la personne : la marque tient à la fusion, et la coupe à 200 vient ensuite.
  const validated = validateReport(atReport, T0 + 5)!.board
  expect(runOf(mergeBoards(many, validated)).reportValidatedAt).toBe(T0 + 5)
})

test('Un rapport validé puis rouvert (retour en arrière) n’est plus validé : aucun choix n’est coupé avant la nouvelle validation', () => {
  const many = declare(switchOnAuto(lot(), 'sa', T0 + 2)!.board, 150, 0, T0 + 3)
  const atReport = applyReport(many, { fix: { phase: 'compte-rendu', step: 'validate' } }, T0 + 4).board
  const validated = validateReport(atReport, T0 + 5)!.board
  const reopened = applyReport(validated, { fix: { phase: 'implement' } }, T0 + 6).board
  const more = declare(reopened, 100, 150, T0 + 7)
  expect(runOf(more).decided).toHaveLength(250)
  expect(runOf(mergeBoards(more, validated)).decided).toHaveLength(250)
})

test('Un rapport validé, rouvert puis fini par « ✓ Clore le parcours » n’est plus validé : aucun choix n’est coupé', () => {
  const many = declare(switchOnAuto(lot(), 'sa', T0 + 2)!.board, 250, 0, T0 + 3)
  const atReport = applyReport(many, { fix: { phase: 'compte-rendu', step: 'validate' } }, T0 + 4).board
  const validated = validateReport(atReport, T0 + 5)!.board
  // Passé à la livraison, puis revenu au compte rendu : la phase est rouverte.
  const ahead = applyReport(validated, { fix: { phase: 'project:version' } }, T0 + 6).board
  const reopened = applyReport(ahead, { fix: { phase: 'compte-rendu' } }, T0 + 6).board
  expect(runOf(reopened).phases.find(p => p.skill === 'compte-rendu')!.status).toBe('active')
  const closed = finishActive(reopened, T0 + 7)!.board
  expect(runOf(mergeBoards(closed, many)).decided).toHaveLength(250)
  // Une autre copie, plus ancienne (la copie gardée est la close), qui porte un choix de plus :
  // l'union les garde tous, sans coupe à 200.
  const other = declare(reopened, 1, 250, T0 + 6)
  expect(runOf(other).updatedAt).toBeLessThan(runOf(closed).updatedAt)
  expect(runOf(mergeBoards(closed, other)).decided).toHaveLength(251)
})

test('Un choix remis en vigueur sous le texte d’un choix retiré reste en vigueur à la fusion', () => {
  const board = applyReport(switchOnAuto(lot(), 'sa', T0 + 2)!.board, { decided: [{ what: 'X' }] }, T0 + 3).board
  const swapped = applyReport(board, { withdrawn: [{ what: 'X', why: 'non', replacedBy: 'Y' }] }, T0 + 4).board
  const back = applyReport(swapped, { withdrawn: [{ what: 'Y', why: 'finalement', replacedBy: 'X' }] }, T0 + 5).board
  const inForce = (b: Board) => runOf(b).decided!.filter(d => d.withdrawnAt === undefined).map(d => d.what)
  expect(inForce(back)).toEqual(['X'])
  for (const merged of [mergeBoards(back, board), mergeBoards(board, back), mergeBoards(back, back)]) expect(inForce(merged)).toEqual(['X'])
})

test('Un retrait dont le remplaçant a le même texte que le choix retiré le remplace bien', () => {
  const board = applyReport(switchOnAuto(lot(), 'sa', T0 + 2)!.board, { decided: [{ what: 'Cache en mémoire', why: 'ancienne raison' }] }, T0 + 3).board
  const out = applyReport(board, { withdrawn: [{ what: 'Cache en mémoire', why: 'nouvelle raison', replacedBy: 'Cache en mémoire' }] }, T0 + 4).board
  const inForce = runOf(out).decided!.filter(d => d.what === 'Cache en mémoire' && d.withdrawnAt === undefined)
  expect(inForce).toHaveLength(1)
})

test('Au plafond, un retrait avec remplaçant laisse le choix d’origine en vigueur et le dit', () => {
  let board = switchOnAuto(lot(), 'sa', T0 + 2)!.board
  for (let i = 0; i < 1000; i += 250) board = declare(board, 250, i, T0 + 3 + i)
  const out = applyReport(board, { withdrawn: [{ what: 'Choix 3', why: 'faux', replacedBy: 'Choix neuf' }] }, T0 + 2000)
  expect(runOf(out.board).decided!.find(d => d.what === 'Choix 3')!.withdrawnAt).toBeUndefined()
  expect(out.text).toContain('kept in force')
})

test('Au-delà de 40 choix, les faits du compte rendu en donnent les comptes par origine, les 40 plus récents et le chemin du fichier des choix', () => {
  const board = declare(declare(switchOnAuto(lot(), 'sa', T0 + 2)!.board, 30, 0, T0 + 3, 'recommendation'), 30, 30, T0 + 4, 'skipped-validation')
  const facts = reportFacts(runOf(board), 0, '/h/.claude/flow-board/choix/r.md').join('\n')
  expect(facts).toContain('60 choices reported as made without the user (30 « reco prise », 30 « validation sautée », 0 « choix de session liée », 0 without origin)')
  expect(facts).toContain('read them all in the file of declared choices, /h/.claude/flow-board/choix/r.md')
  expect(facts).not.toContain('Choix 19 [origin')
  expect(facts).toContain('Choix 59 [origin: validation sautée]')
})

test('Le fichier des choix et les faits du compte rendu gardent l’origine, et demandent le regroupement par origine', () => {
  const board = applyReport(lot(), { decided: [{ what: 'Spec validée', origin: 'skipped-validation' }, { what: 'Option A', why: 'plus simple', origin: 'recommendation' }, { what: 'Sans origine' }] }, T0 + 2).board
  const file = decidedFileText(runOf(board), null)
  expect(file).toContain('- Spec validée (validation sautée,')
  expect(file).toContain('- Option A — plus simple (reco prise,')
  expect(file).toContain('- Sans origine (')
  const facts = reportFacts(runOf(board)).join('\n')
  expect(facts).toContain('Spec validée [origin: validation sautée]')
  expect(facts).toContain('Option A (because plus simple) [origin: reco prise]')
  expect(facts).toContain('group « Décidé sans toi » by origin')
  // Sans origine nulle part : la consigne d'avant, sans regroupement.
  const plain = applyReport(lot(), { decided: [{ what: 'Sans origine' }] }, T0 + 2).board
  expect(reportFacts(runOf(plain)).join('\n')).not.toContain('by origin')
})

test('En auto, la fusion de deux copies garde l’union des choix : un choix déclaré dans une copie n’est pas perdu parce que l’autre est plus récente', () => {
  const on = switchOnAuto(lot(), 'sa', T0 + 2)!.board
  const here = declare(on, 3, 0, T0 + 3, 'recommendation')
  // L'autre copie, faite avant ces choix, en a déclaré d'autres et est plus récente.
  const there0: Board = { ...(JSON.parse(JSON.stringify(on)) as Board), session: 'sb' }
  const there = declare(there0, 2, 10, T0 + 9)
  const whats = (b: Board) => runOf(b).decided!.map(d => d.what).sort()
  expect(whats(mergeBoards(here, there))).toEqual(['Choix 0', 'Choix 1', 'Choix 10', 'Choix 11', 'Choix 2'])
  expect(whats(mergeBoards(there, here))).toEqual(['Choix 0', 'Choix 1', 'Choix 10', 'Choix 11', 'Choix 2'])
  // Un choix relu ou retiré dans une copie le reste après la fusion.
  const seen = applyReport(here, { withdrawn: [{ what: 'Choix 1', why: 'remplacé' }] }, T0 + 10).board
  const merged = mergeBoards(there, seen)
  expect(runOf(merged).decided!.find(d => d.what === 'Choix 1')!.withdrawnAt).toBe(T0 + 10)
  expect(runOf(merged).decided!.find(d => d.what === 'Choix 0')!.origin).toBe('recommendation')
  // Hors auto, la règle d'avant : la copie la plus récente.
  const plainHere = declare(lot(), 3, 0, T0 + 3)
  const plainThere = declare({ ...(JSON.parse(JSON.stringify(lot())) as Board), session: 'sb' }, 2, 10, T0 + 9)
  expect(whats(mergeBoards(plainHere, plainThere))).toEqual(['Choix 10', 'Choix 11'])
})
