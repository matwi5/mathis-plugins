// La garde des questions reposées : la trace d'une question répondue garde sa phrase de tête (le texte jusqu'au premier
// « ? », normalisé), et une question neuve qui la reprend est refusée, sous tout id et sur toute cible, même dans l'appel
// qui retire la question d'origine. Invariant : une question répondue n'est jamais reposée, sous son id ni sous un autre,
// tant que sa trace est gardée ; la garde ne fait jamais perdre une question ouverte, une réponse ni une trace.

import { expect, test } from 'claude-code/testing'

import { addOwnTraces, applyReport, clampFuture, emptyBoard, headPhrase, mergeBoards, newRun, openQuestions, withdrawOpposition, writtenTraces } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const T0 = 95_000_000

/** Le texte réel de UI-1, reposé tel quel sous l'id UI-1b dans l'appel même qui retirait UI-1 (06/11/2026). */
const UI1 =
  'Où mettre la bascule « revue de sécurité » du projet, et avec quel libellé ? (a) barre « À tout moment », « ⛨ Sécurité : activée / désactivée » (recommandé) ; (b) vue du COO seulement ; (c) ligne de sécurité de chaque groupe'
const LONG_B = 'Faut-il garder le journal des envois une fois la mission livrée ?'
const LONG_C = 'Quel format donner au rapport de fin de groupe pour le COO ?'

/** Une mission active en phase implement, avec deux tickets, « 03 » et « 04 », et deux groupes (A : « 03 », B : « 04 »). */
const lot = (): Board => {
  const run: Run = { ...newRun('implement', T0, 'Économie'), owner: 'sa' }
  const board: Board = { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
  return applyReport(
    board,
    {
      tickets: [
        { id: '03', name: 'Bascule' },
        { id: '04', name: 'Journal' },
      ],
      groups: [
        { id: 'A', name: 'Code', tickets: ['03'] },
        { id: 'B', name: 'Données', tickets: ['04'] },
      ],
    },
    T0 + 1,
  ).board
}
const runOf = (board: Board): Run => board.runs[0]!
const openIds = (board: Board): string[] => openQuestions(runOf(board)).map(q => q.id).sort()
const traces = (board: Board) => runOf(board).answered ?? []
const ask = (board: Board, waiting: unknown[], now: number) => applyReport(board, { waiting }, now)
const minute = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
const withAnswered = (board: Board, answered: unknown[]): Board => ({ ...board, runs: board.runs.map(r => ({ ...r, answered }) as unknown as Run) })

test('La phrase de tête : jusqu’au premier « ? », casse, guillemets et ponctuation ignorés, bornée ; aucune sous trois mots', () => {
  expect(headPhrase(UI1)).toBe('où mettre la bascule revue de sécurité du projet et avec quel libellé')
  expect(headPhrase('« OÙ mettre » la BASCULE, revue de sécurité du projet ; et avec quel libellé ?!')).toBe(headPhrase(UI1))
  expect(headPhrase('Un ?')).toBeUndefined()
  expect(headPhrase('Un, encore ?')).toBeUndefined()
  expect(headPhrase('')).toBeUndefined()
  // Sans « ? », le texte entier ; trop long, coupé à 200.
  expect(headPhrase('Garder le journal des envois')).toBe('garder le journal des envois')
  expect(headPhrase('mot '.repeat(100))!.length).toBeLessThanOrEqual(200)
})

test('Le cas réel : UI-1 retirée et UI-1b posée au même texte dans le même appel, dans les deux ordres : UI-1b refusée, UI-1 répondue', () => {
  const asked = ask(lot(), [{ id: 'UI-1', phase: 'implement', text: UI1 }], T0 + 2).board
  const now = T0 + 60_000
  for (const call of [
    [{ id: 'UI-1', answered: true }, { id: 'UI-1b', ticket: '03', text: UI1 }],
    [{ id: 'UI-1b', ticket: '03', text: UI1 }, { id: 'UI-1', answered: true }],
  ]) {
    const out = ask(asked, call, now)
    expect(openIds(out.board)).toEqual([])
    expect(traces(out.board)).toEqual([{ id: 'UI-1', at: now, head: headPhrase(UI1) }])
    expect(out.text).toContain(`"UI-1b" reprend la phrase de tête de "UI-1", répondue le ${minute(now)} UTC`)
  }
})

test('Le refus dit l’id refusé, l’id et la date de la réponse, la part restante et la sortie ; les autres entrées de l’appel s’enregistrent', () => {
  const answeredAt = T0 + 60_000
  const answered = ask(ask(lot(), [{ id: 'UI-1', phase: 'implement', text: UI1 }], T0 + 2).board, [{ id: 'UI-1', answered: true }], answeredAt).board
  const out = ask(answered, [{ id: 'UI-1b', group: 'B', text: `${UI1} (reposée)` }, { id: 'J1', ticket: '04', text: LONG_B }], T0 + 120_000)
  expect(openIds(out.board)).toEqual(['J1'])
  expect(out.text).toContain(
    `"UI-1b" reprend la phrase de tête de "UI-1", répondue le ${minute(answeredAt)} UTC : applique cette réponse et ne pose que la part restante, sous un id neuf, sa question d'abord puis la citation de la réponse ; si c'est une autre question, ou une part restante qui commence comme elle, reformule sa phrase de tête pour dire ce qui la distingue`,
  )
})

test('Une phrase de tête différente passe ; une question ouverte se met à jour sur place ; une question longue répondue reposée sous un id neuf est refusée', () => {
  const asked = ask(lot(), [{ id: 'q1', ticket: '03', text: LONG_B }, { id: 'q2', group: 'A', text: LONG_C }], T0 + 2).board
  const answered = ask(asked, [{ id: 'q1', answered: true }], T0 + 3).board
  // Le même texte long sous un id neuf : refusé.
  expect(openIds(ask(answered, [{ id: 'q1b', ticket: '03', text: LONG_B }], T0 + 4).board)).toEqual(['q2'])
  // Une autre phrase de tête : enregistrée.
  expect(openIds(ask(answered, [{ id: 'q1b', ticket: '03', text: 'Faut-il garder le journal des envois une semaine seulement ?' }], T0 + 4).board)).toEqual(['q1b', 'q2'])
  // Une question encore ouverte se met à jour sur place : reciblée ou reformulée sans changer sa phrase de tête, elle passe.
  const retarget = ask(answered, [{ id: 'q2', group: 'B', text: `${LONG_C} (a) un fichier ; (b) un message` }], T0 + 5)
  expect(retarget.text).not.toContain('reprend la phrase de tête')
  expect(runOf(retarget.board).waiting!.find(q => q.id === 'q2')).toMatchObject({ blocks: { kind: 'group', id: 'B' } })
  // Mise à jour vers la phrase de tête d'une question répondue d'un autre id : refusée, la question reste
  // telle qu'elle était, la réponse nomme l'id répondu, et le reste de l'appel s'enregistre.
  const updated = ask(answered, [{ id: 'q2', group: 'B', text: LONG_B }, { id: 'q3', group: 'A', text: 'Quel nom donner au bouton de relance ?' }], T0 + 5)
  expect(updated.text).toContain('"q2" reprend la phrase de tête de "q1"')
  expect(runOf(updated.board).waiting!.find(q => q.id === 'q2')).toEqual(runOf(answered).waiting!.find(q => q.id === 'q2'))
  expect(openIds(updated.board)).toEqual(['q2', 'q3'])
})

test('Une question ouverte qui porte déjà la phrase d’une trace d’un autre id (fusion) se recible et se retire toujours ; une question à geste ou sans phrase de tête se met à jour hors de la garde', () => {
  const base = lot()
  // q2 ouverte au texte LONG_B, à côté de la trace de q1 au même texte (venue d'une autre copie).
  const asked = ask(base, [{ id: 'q2', ticket: '03', text: LONG_B }, { id: 'sp', group: 'A', gesture: 'spend', text: LONG_C }, { id: 'c', group: 'A', text: 'Un ?' }], T0 + 2).board
  const both = withAnswered(asked, [{ id: 'q1', at: T0 + 1, head: headPhrase(LONG_B) }, { id: 'q0', at: T0 + 1, head: headPhrase(LONG_C) }])
  const retarget = ask(both, [{ id: 'q2', group: 'B', text: `${LONG_B} (a) oui ; (b) non` }], T0 + 3)
  expect(retarget.text).not.toContain('reprend la phrase de tête')
  expect(runOf(retarget.board).waiting!.find(q => q.id === 'q2')).toMatchObject({ blocks: { kind: 'group', id: 'B' } })
  const withdrawn = ask(both, [{ id: 'q2', answered: true }], T0 + 3)
  expect(openIds(withdrawn.board)).toEqual(['c', 'sp'])
  // Une question à geste prend le texte d'une répondue : hors de la garde ; une question sans phrase de tête de même.
  const gesture = ask(both, [{ id: 'sp', group: 'B', gesture: 'spend', text: LONG_B }, { id: 'c', group: 'B', text: 'Deux ?' }], T0 + 3)
  expect(gesture.text).not.toContain('reprend la phrase de tête')
  expect(runOf(gesture.board).waiting!.find(q => q.id === 'sp')).toMatchObject({ blocks: { kind: 'group', id: 'B' }, text: LONG_B })
})

test('Une question du mod et une question à geste n’ont pas de phrase de tête : ni comparées ni refusées par la garde', () => {
  // Une question d'opposition, posée et retirée par le mod : sa trace n'a pas de phrase de tête.
  const base = lot()
  const posed: Board = { ...base, runs: base.runs.map(r => ({ ...r, waiting: [{ id: 'opposition:e1', blocks: { kind: 'phase', id: 'implement' }, text: LONG_B, at: T0 + 2 }] }) as Run) }
  const withdrawn = withdrawOpposition(posed, runOf(posed).id, 'opposition:e1', T0 + 3)!.board
  expect(traces(withdrawn)).toEqual([{ id: 'opposition:e1', at: T0 + 3 }])
  expect(openIds(ask(withdrawn, [{ id: 'q1', ticket: '03', text: LONG_B }], T0 + 4).board)).toEqual(['q1'])
  // Un accord de dépense pour le groupe A, répondu, se repose pour le groupe B au même texte.
  const spend = ask(ask(lot(), [{ id: 'sp-A', group: 'A', gesture: 'spend', text: LONG_C }], T0 + 2).board, [{ id: 'sp-A', answered: true }], T0 + 3).board
  expect(traces(spend)).toEqual([{ id: 'sp-A', at: T0 + 3 }])
  expect(openIds(ask(spend, [{ id: 'sp-B', group: 'B', gesture: 'spend', text: LONG_C }], T0 + 4).board)).toEqual(['sp-B'])
  // Une question à geste neuve n'est pas comparée aux traces des autres non plus.
  const plain = ask(ask(lot(), [{ id: 'q1', ticket: '03', text: LONG_C }], T0 + 2).board, [{ id: 'q1', answered: true }], T0 + 3).board
  expect(openIds(ask(plain, [{ id: 'sp-B', group: 'B', gesture: 'spend', text: LONG_C }], T0 + 4).board)).toEqual(['sp-B'])
})

test('Fusion de deux copies dont une seule porte la phrase de tête : la trace fusionnée la garde, dans les deux sens ; traces propres de même', () => {
  const head = headPhrase(LONG_B)!
  const base = lot()
  const older = withAnswered(base, [{ id: 'q1', at: T0 + 5, head }])
  const newer = withAnswered(base, [{ id: 'q1', at: T0 + 9 }])
  for (const merged of [mergeBoards(older, newer), mergeBoards(newer, older)]) expect(traces(merged)).toEqual([{ id: 'q1', at: T0 + 9, head }])
  // La plus récente porte la sienne : elle l'emporte, dans les deux sens, l'autre gardée à côté.
  const newerHead = withAnswered(base, [{ id: 'q1', at: T0 + 9, head: 'autre phrase de tête' }])
  for (const merged of [mergeBoards(older, newerHead), mergeBoards(newerHead, older)]) expect(traces(merged)).toEqual([{ id: 'q1', at: T0 + 9, head: 'autre phrase de tête', earlier: [head] }])
  // À la même date, deux phrases : la même dans les deux sens.
  const sameAt = withAnswered(base, [{ id: 'q1', at: T0 + 5, head: 'zzz phrase de tête' }])
  expect(traces(mergeBoards(older, sameAt))).toEqual(traces(mergeBoards(sameAt, older)))
  // Traces propres de la discussion : la phrase de tête suit, ajoutée ou gardée.
  const kept = { runId: 'r', resent: [], answered: [{ id: 'q1', at: T0 + 5, head }] }
  const added = { runId: 'r', resent: [], answered: [{ id: 'q1', at: T0 + 9 }] }
  expect(addOwnTraces(kept, added).answered).toEqual([{ id: 'q1', at: T0 + 9, head }])
  expect(addOwnTraces(added, kept).answered).toEqual([{ id: 'q1', at: T0 + 9, head }])
  // Écrite par un retrait d'ici : la trace propre porte la phrase de tête.
  const asked = ask(base, [{ id: 'q1', ticket: '03', text: LONG_B }], T0 + 2).board
  expect(writtenTraces(asked, ask(asked, [{ id: 'q1', answered: true }], T0 + 3).board)!.answered).toEqual([{ id: 'q1', at: T0 + 3, head }])
})

test('Une trace d’avant le changement, une phrase de tête hors forme, une date future : la trace reste valide, et le refus par id tient', () => {
  const base = lot()
  for (const trace of [{ id: 'q1', at: T0 + 5 }, { id: 'q1', at: T0 + 5, head: 42 }, { id: 'q1', at: T0 + 5, head: 'x'.repeat(201) }, { id: 'q1', at: T0 + 5, head: '  ' }]) {
    const board = withAnswered(base, [trace])
    const merged = mergeBoards(board, withAnswered(base, []))
    expect(traces(merged)).toEqual([{ id: 'q1', at: T0 + 5 }])
    const out = ask(board, [{ id: 'q1', ticket: '03', text: LONG_B }], T0 + 10)
    expect(openIds(out.board)).toEqual([])
    expect(out.text).toContain(`"q1" a été répondue le ${minute(T0 + 5)} UTC`)
    // Sans phrase de tête, la même question sous un id neuf passe (rien à comparer).
    expect(openIds(ask(board, [{ id: 'q1b', ticket: '03', text: LONG_B }], T0 + 10).board)).toEqual(['q1b'])
  }
  // Une date future : ramenée à maintenant à la lecture, la phrase de tête gardée ; le refus par phrase dit maintenant.
  const now = T0 + 1_000_000
  const ahead = withAnswered(base, [{ id: 'q1', at: now + 3_600_000, head: headPhrase(LONG_B) }])
  expect(traces(clampFuture(ahead, now))).toEqual([{ id: 'q1', at: now, head: headPhrase(LONG_B) }])
  const out = ask(ahead, [{ id: 'q1b', ticket: '03', text: LONG_B }], now)
  expect(openIds(out.board)).toEqual([])
  expect(out.text).toContain(`"q1b" reprend la phrase de tête de "q1", répondue le ${minute(now)} UTC`)
})

// Une entrée plus loin dans l'appel qui change, ou pose, puis retire une question à la phrase de tête d'une question neuve
// acceptée plus haut : la relecture de fin d'appel la refuse (sinon elle restait ouverte, la phrase d'une question répondue).
test('Une question neuve acceptée, puis une question au même texte posée ou changée et retirée plus loin dans l’appel : la neuve est refusée à la fin de l’appel', () => {
  const asked = ask(lot(), [{ id: 'p', phase: 'implement', text: LONG_C }], T0 + 2).board
  const changed = ask(asked, [{ id: 'n', ticket: '03', text: LONG_B }, { id: 'p', phase: 'implement', text: LONG_B }, { id: 'p', answered: true }], T0 + 10)
  expect(openIds(changed.board)).toEqual([])
  expect(traces(changed.board)).toEqual([{ id: 'p', at: T0 + 10, head: headPhrase(LONG_B), earlier: [headPhrase(LONG_C)!] }])
  expect(changed.text).toContain('"n" reprend la phrase de tête de "p"')
  const posedLater = ask(lot(), [{ id: 'n', ticket: '03', text: LONG_B }, { id: 'n1', group: 'B', text: LONG_B }, { id: 'n1', answered: true }], T0 + 10)
  expect(openIds(posedLater.board)).toEqual([])
  expect(posedLater.text).toContain('"n" reprend la phrase de tête de "n1"')
  // Sans retrait plus loin, deux questions neuves au même texte restent ouvertes (rien n'est répondu).
  expect(openIds(ask(lot(), [{ id: 'n', ticket: '03', text: LONG_B }, { id: 'n1', group: 'B', text: LONG_B }], T0 + 10).board)).toEqual(['n', 'n1'])
})
// Une question reformulée puis retirée dans le même appel perdait la phrase que la personne avait vue.
test('Une question reformulée puis retirée dans le même appel garde dans sa trace la phrase qu’elle avait avant l’appel : une question neuve qui la reprend est refusée, dans les deux ordres', () => {
  const asked = ask(lot(), [{ id: 'p', phase: 'implement', text: LONG_C }], T0 + 2).board
  for (const call of [
    [{ id: 'n', ticket: '03', text: LONG_C }, { id: 'p', phase: 'implement', text: LONG_B }, { id: 'p', answered: true }],
    [{ id: 'p', phase: 'implement', text: LONG_B }, { id: 'p', answered: true }, { id: 'n', ticket: '03', text: LONG_C }],
  ]) {
    const out = ask(asked, call, T0 + 10)
    expect(openIds(out.board)).toEqual([])
    expect(traces(out.board)).toEqual([{ id: 'p', at: T0 + 10, head: headPhrase(LONG_B), earlier: [headPhrase(LONG_C)!] }])
    expect(out.text).toContain('"n" reprend la phrase de tête de "p"')
  }
})

// Une mise à jour vers la phrase d'une question répondue, suivie du retrait de la question dans le même appel, passait.
test('Une mise à jour vers la phrase d’une répondue, puis le retrait de la question dans le même appel : la mise à jour est refusée, la trace garde la phrase d’origine', () => {
  const asked = ask(lot(), [{ id: 'y', ticket: '03', text: LONG_B }, { id: 'x', group: 'A', text: LONG_C }], T0 + 2).board
  const answered = ask(asked, [{ id: 'y', answered: true }], T0 + 3).board
  const out = ask(answered, [{ id: 'x', group: 'A', text: LONG_B }, { id: 'x', answered: true }], T0 + 10)
  expect(out.text).toContain('"x" reprend la phrase de tête de "y"')
  expect(traces(out.board).find(t => t.id === 'x')).toEqual({ id: 'x', at: T0 + 10, head: headPhrase(LONG_C) })
  expect(openIds(ask(out.board, [{ id: 'z', ticket: '03', text: LONG_C }], T0 + 11).board)).toEqual([])
  // La trace de la question répondue est écrite plus loin dans l'appel : la phrase d'avant l'appel reste dans la trace.
  const both = ask(lot(), [{ id: 'y', ticket: '03', text: LONG_B }, { id: 'x', group: 'A', text: LONG_C }], T0 + 2).board
  const later = ask(both, [{ id: 'x', group: 'A', text: LONG_B }, { id: 'y', answered: true }, { id: 'x', answered: true }], T0 + 10)
  expect(openIds(later.board)).toEqual([])
  expect(traces(later.board).find(t => t.id === 'x')).toEqual({ id: 'x', at: T0 + 10, head: headPhrase(LONG_B), earlier: [headPhrase(LONG_C)!] })
  expect(openIds(ask(later.board, [{ id: 'z', ticket: '03', text: LONG_C }], T0 + 11).board)).toEqual([])
})

// Une question refusée à la fin de l'appel prenait une place de la borne des 50 pendant l'appel.
test('Une question neuve qui reprend la phrase d’une trace déjà gardée est refusée avant la borne des 50 : une question valide plus loin dans l’appel passe', () => {
  const many = Array.from({ length: 49 }, (_, i) => ({ id: `o${i}`, ticket: '03', text: `Question ouverte numéro ${i} pour remplir ?` }))
  const asked = ask(ask(lot(), [{ id: 'y', ticket: '03', text: LONG_B }, ...many], T0 + 2).board, [{ id: 'y', answered: true }], T0 + 3).board
  expect(openIds(asked).length).toBe(49)
  const out = ask(asked, [{ id: 'q1', ticket: '03', text: LONG_B }, { id: 'q2', ticket: '03', text: LONG_C }], T0 + 10)
  expect(openIds(out.board)).toContain('q2')
  expect(openIds(out.board)).not.toContain('q1')
  expect(out.text).not.toContain('open questions at most')
})

// Un id rouvert par une copie en retard puis répondu de nouveau perdait la phrase de sa première réponse.
test('Un id rouvert puis répondu de nouveau garde les phrases de tête de ses réponses plus anciennes, comparées de même, dans les deux sens de fusion', () => {
  const base = lot()
  const a = ask(ask(base, [{ id: 'q1', ticket: '03', text: LONG_B }], T0 + 2).board, [{ id: 'q1', answered: true }], T0 + 3).board
  // La copie d'une autre discussion, en retard : sans la trace, q1 y est reposée au texte LONG_C après ce retrait.
  const stale: Board = { ...base, runs: base.runs.map(r => ({ ...r, waiting: [{ id: 'q1', blocks: { kind: 'ticket', id: '03' }, text: LONG_C, at: T0 + 5 }], updatedAt: T0 + 5 }) as Run) }
  for (const merged of [mergeBoards(a, stale), mergeBoards(stale, a)]) {
    const again = ask(merged, [{ id: 'q1', answered: true }], T0 + 6).board
    expect(traces(again)).toEqual([{ id: 'q1', at: T0 + 6, head: headPhrase(LONG_C), earlier: [headPhrase(LONG_B)!] }])
    for (const text of [LONG_B, LONG_C]) {
      const out = ask(again, [{ id: 'q9', ticket: '03', text }], T0 + 7)
      expect(openIds(out.board)).toEqual([])
      expect(out.text).toContain('"q9" reprend la phrase de tête de "q1"')
    }
    // Une question ouverte mise à jour vers la phrase plus ancienne : refusée de même.
    const open = ask(again, [{ id: 'q8', ticket: '03', text: 'Quel nom donner au bouton de relance ?' }], T0 + 7).board
    const moved = ask(open, [{ id: 'q8', ticket: '03', text: LONG_B }], T0 + 8)
    expect(moved.text).toContain('"q8" reprend la phrase de tête de "q1"')
    expect(runOf(moved.board).waiting!.find(q => q.id === 'q8')!.text).toBe('Quel nom donner au bouton de relance ?')
    // Les phrases plus anciennes suivent la fusion, dans les deux sens.
    for (const m of [mergeBoards(again, a), mergeBoards(a, again)]) expect(traces(m)).toEqual(traces(again))
  }
  // Une liste `earlier` hors forme : ses entrées hors forme sont ignorées, la trace reste.
  const odd = withAnswered(base, [{ id: 'q1', at: T0 + 5, head: 'une phrase de tête', earlier: ['autre phrase gardée', 42, 'x'.repeat(201)] }])
  expect(traces(mergeBoards(odd, withAnswered(base, [])))).toEqual([{ id: 'q1', at: T0 + 5, head: 'une phrase de tête', earlier: ['autre phrase gardée'] }])
})

/** Les ordres d'une liste tirés au hasard, d'une graine fixe (le même tirage à chaque passage). */
const shuffles = <T,>(list: readonly T[], count: number): T[][] => {
  let seed = 7
  const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648
  return Array.from({ length: count }, () => {
    const out = list.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      ;[out[i], out[j]] = [out[j]!, out[i]!]
    }
    return out
  })
}

test('Propriété : aucune question ouverte, réponse ni trace n’est perdue par la garde, et aucune question neuve ou changée ne garde la phrase d’une autre répondue, dans tous les ordres d’un appel mêlé', () => {
  const X = 'Combien de groupes lancer en même temps sur ce poste ?'
  // Avant l'appel : p (à retirer), u (à mettre à jour) et v (à mettre à jour puis retirer) ouvertes ; t répondue.
  const before0 = ask(
    lot(),
    [
      { id: 't', ticket: '04', text: LONG_C },
      { id: 'p', phase: 'implement', text: UI1 },
      { id: 'u', group: 'A', text: 'Quel nom donner au bouton de relance ?' },
      { id: 'v', group: 'A', text: 'Quel délai laisser avant la relance automatique ?' },
    ],
    T0 + 2,
  ).board
  const before = ask(before0, [{ id: 't', answered: true }], T0 + 3).board
  const entries = [
    { id: 'p', answered: true },
    { id: 'absente', answered: true },
    { id: 'n1', ticket: '03', text: UI1 },
    { id: 'n2', group: 'B', text: LONG_B },
    { id: 'u', ticket: '03', text: 'Quel libellé donner au bouton de relance ?' },
    { id: 'g', group: 'B', gesture: 'spend', text: LONG_C },
    // Posée puis retirée dans l'appel, et une neuve à son texte.
    { id: 'x', group: 'B', text: X },
    { id: 'x', answered: true },
    { id: 'n4', ticket: '03', text: X },
    // Mise à jour puis retirée dans l'appel.
    { id: 'v', group: 'A', text: 'Quel délai laisser avant la relance manuelle ?' },
    { id: 'v', answered: true },
  ]
  const openBefore = openQuestions(runOf(before))
  const tracesBefore = traces(before).map(t => t.id)
  const head = (q: { id: string; text: string; gesture?: unknown }) => (q.gesture !== undefined || q.id.startsWith('sans-suite:') ? undefined : headPhrase(q.text))
  const permutationsSeen = [entries, entries.slice().reverse(), ...shuffles(entries, 1500)]
  for (const order of permutationsSeen) {
    const after = ask(before, order, T0 + 10).board
    for (const board of [after, mergeBoards(after, before), mergeBoards(before, after)]) {
      const open = openQuestions(runOf(board))
      const ids = open.map(q => q.id)
      // Rien d'ouvert avant n'est perdu, sauf ce que l'appel retire (p, v) ; n2 et g passent toujours, n1 jamais.
      expect(ids).toContain('u')
      expect(ids).toContain('n2')
      expect(ids).toContain('g')
      expect(ids).not.toContain('n1')
      expect(ids).not.toContain('p')
      expect(ids).not.toContain('v')
      for (const q of openBefore.filter(o => !['p', 'v'].includes(o.id))) expect(ids).toContain(q.id)
      // Aucune trace d'avant ne manque ; p et v ont la leur.
      const final = traces(board)
      for (const id of [...tracesBefore, 'p', 'v']) expect(final.map(t => t.id)).toContain(id)
      // Aucune question ouverte neuve, ou changée par l'appel, ne garde la phrase de tête d'une répondue d'un autre id.
      for (const q of open) {
        const prior = openBefore.find(o => o.id === q.id)
        const h = head(q)
        if (h === undefined || (prior && head(prior) === h)) continue
        expect(final.filter(t => t.id !== q.id && [t.head, ...(t.earlier ?? [])].includes(h)).map(t => t.id)).toEqual([])
      }
    }
  }
})

// Le refus dicte un nouvel appel : une part restante qui commençait comme la question répondue était refusée sans issue.
test('Les appels que dicte le refus, rejoués : une part restante qui commence comme la question répondue est refusée, puis passe reformulée pour dire ce qui reste', () => {
  const Q = 'Quel libellé pour la bascule « revue de sécurité » ? Et où la mettre : (a) barre ; (b) vue du COO ; (c) chaque groupe'
  const asked = ask(lot(), [{ id: 'UI-1', phase: 'implement', text: Q }], T0 + 2).board
  const first = ask(asked, [{ id: 'UI-1', answered: true }, { id: 'UI-1b', phase: 'implement', text: 'Quel libellé pour la bascule « revue de sécurité » ? Tu as répondu « b et c ».' }], T0 + 3)
  expect(first.text).toContain('sa question d\'abord puis la citation de la réponse ; si c\'est une autre question, ou une part restante qui commence comme elle, reformule sa phrase de tête')
  expect(openIds(first.board)).toEqual([])
  const again = ask(first.board, [{ id: 'UI-1c', phase: 'implement', text: 'Reste le libellé de la bascule « revue de sécurité » : lequel ? Tu as répondu « b et c ».' }], T0 + 4)
  expect(openIds(again.board)).toEqual(['UI-1c'])
})

test('La phrase de tête se coupe par points de code : jamais une moitié de paire de substitution', () => {
  const head = headPhrase(`ab cd ${'𝒜'.repeat(250)} ?`)!
  expect(Array.from(head).length).toBeLessThanOrEqual(200)
  expect(head.endsWith('𝒜')).toBe(true)
})
