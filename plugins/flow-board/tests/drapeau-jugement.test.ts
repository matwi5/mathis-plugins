// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { TOOL, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

import { activeRun, isJudgmentTicket } from '../hooks/basics.ts'
import { applyReport, emptyBoard, mergeBoards, newRun, openRun, upgradeRun } from '../hooks/model.ts'
import type { Board, Run, Ticket } from '../types'

// Le drapeau « Jugement » d'un ticket (`judgment`), écrit au découpage par la discussion qui tient la mission.
// Invariant (décision de Mathis du 13/11/2026, celui de la ligne « Jugement ») : un ticket n'est traité en
// xhigh que si la mission le dit « Jugement : oui », par un envoi de la discussion qui tient la mission ; un
// drapeau absent, illisible ou hors forme, ou une mission qui ne se lit pas, laisse le ticket à l'effort calculé,
// jamais l'inverse ; à la fusion de deux copies, le drapeau suit la copie que la fusion garde (la plus récente ;
// pour la mission active ici, celle d'ici tant qu'aucune autre discussion ne l'a reprise), comme les autres champs.

const T0 = 1_000_000

/** Une mission active, tenue par la discussion « s », après un appel de l'outil `flow`. */
const boardWith = (input: Record<string, unknown>): Board => {
  const run = { ...newRun('to-tickets', T0, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, T0 + 1000).board
}

const ticketOf = (board: Board, id: string): Ticket | undefined => activeRun(board)?.tickets.find(t => t.id === id)

test('un envoi "judgment": true le pose ; un envoi sans le champ le garde ; false le remplace', () => {
  let board = boardWith({ tickets: [{ id: '03', name: 'Lancement', judgment: true }, { id: '04', name: 'Cadrage', judgment: false }, { id: '05', name: 'Bug' }] })
  expect(ticketOf(board, '03')?.judgment).toBe(true)
  expect(ticketOf(board, '04')?.judgment).toBe(false)
  expect(ticketOf(board, '05')?.judgment).toBeUndefined()
  expect([isJudgmentTicket(ticketOf(board, '03')), isJudgmentTicket(ticketOf(board, '04')), isJudgmentTicket(ticketOf(board, '05'))]).toEqual([true, false, false])
  // Un deuxième envoi sans le champ (un statut, des fichiers) garde la valeur posée.
  board = applyReport(board, { tickets: [{ id: '03', name: 'Lancement', status: 'doing', files: ['a.ts'] }] }, T0 + 2000).board
  expect(ticketOf(board, '03')).toMatchObject({ judgment: true, status: 'doing' })
  // false la remplace.
  board = applyReport(board, { tickets: [{ id: '03', name: 'Lancement', judgment: false }] }, T0 + 3000).board
  expect(ticketOf(board, '03')?.judgment).toBe(false)
  expect(isJudgmentTicket(ticketOf(board, '03'))).toBe(false)
})

for (const [label, value] of [['"oui"', 'oui'], ['1', 1], ['null', null], ['"true"', 'true'], ['objet', { v: true }]] as [string, unknown][]) {
  test(`une valeur hors forme (${label}) est ignorée : la valeur posée reste, et rien ne passe à « oui »`, () => {
    // Posée à false, une valeur hors forme ne la met jamais à « oui ».
    let board = boardWith({ tickets: [{ id: '03', name: 'Lancement', judgment: false }, { id: '07', name: 'Compte rendu', judgment: true }, { id: '08', name: 'Réglages' }] })
    board = applyReport(board, { tickets: [{ id: '03', name: 'Lancement', judgment: value }, { id: '07', name: 'Compte rendu', judgment: value }, { id: '08', name: 'Réglages', judgment: value }] }, T0 + 2000).board
    expect(ticketOf(board, '03')?.judgment).toBe(false)
    expect(ticketOf(board, '07')?.judgment).toBe(true)
    expect(ticketOf(board, '08')?.judgment).toBeUndefined()
    expect(isJudgmentTicket(ticketOf(board, '08'))).toBe(false)
  })
}

test('à la lecture, seul true vaut « oui » : une valeur gardée hors forme laisse le ticket à l’effort calculé', () => {
  for (const judgment of ['oui', 'true', 1, null, {}, []] as unknown[]) expect(isJudgmentTicket({ judgment } as unknown as Ticket)).toBe(false)
  expect(isJudgmentTicket(undefined)).toBe(false)
  expect(isJudgmentTicket({ judgment: true })).toBe(true)
})

test('un appel d’un worker de groupe (delegate) avec tickets et judgment n’écrit rien dans la mission', () => {
  const board = boardWith({ tickets: [{ id: '03', name: 'Lancement' }, { id: '04', name: 'Cadrage', judgment: false }] })
  const run = activeRun(board)!
  // L'appel qui porte delegate : la délégation se pose, les tickets ne s'écrivent pas.
  const delegated = applyReport(board, { delegate: run.id, group: 'A', main: '[abc123]', tickets: [{ id: '03', name: 'Lancement', judgment: true }, { id: '04', name: 'Cadrage', judgment: true }] }, T0 + 2000).board
  const same = delegated.runs.find(r => r.id === run.id)!
  expect(delegated.delegate).toBeDefined()
  expect(same.tickets.find(t => t.id === '03')?.judgment).toBeUndefined()
  expect(same.tickets.find(t => t.id === '04')?.judgment).toBe(false)
  // Puis un appel de la même session sans delegate : la session est déléguée, rien ne s'écrit non plus.
  const after = applyReport(delegated, { tickets: [{ id: '03', name: 'Lancement', judgment: true }] }, T0 + 3000).board
  expect(after.runs.find(r => r.id === run.id)!.tickets.find(t => t.id === '03')?.judgment).toBeUndefined()
})

test('remove retire le ticket avec son drapeau ; une mission ancienne mise à niveau garde ses tickets sans drapeau', () => {
  let board = boardWith({ tickets: [{ id: '03', name: 'Lancement', judgment: true }, { id: '04', name: 'Cadrage' }] })
  board = applyReport(board, { remove: ['03'] }, T0 + 2000).board
  expect(ticketOf(board, '03')).toBeUndefined()
  // Renvoyé ensuite sans le champ, le ticket revient sans drapeau : rien ne le remet à « oui ».
  board = applyReport(board, { tickets: [{ id: '03', name: 'Lancement' }] }, T0 + 3000).board
  expect(ticketOf(board, '03')?.judgment).toBeUndefined()
  // Une mission d'une version précédente : ses tickets n'ont pas le champ, la mise à niveau n'en pose pas.
  const old = { ...newRun('implement', T0, 'Ancienne'), tickets: [{ id: '01', name: 'Un', status: 'todo' as const }, { id: '02', name: 'Deux', status: 'doing' as const, sensitive: true }] }
  const upgraded = upgradeRun(old)
  expect(upgraded.tickets.map(t => t.judgment)).toEqual([undefined, undefined])
  expect(upgraded.tickets.some(t => isJudgmentTicket(t))).toBe(false)
})

/** Deux copies d'une même mission, rangées (aucune active ici), qui ne diffèrent que par le drapeau d'un ticket et leur date. */
const copies = (newer: boolean | undefined, older: boolean | undefined): { recent: Run; stale: Run } => {
  const run = { ...newRun('implement', T0, 'Lot'), status: 'paused' as const }
  const ticket = (judgment: boolean | undefined): Ticket => ({ id: '03', name: 'Lancement', status: 'todo', ...(judgment === undefined ? {} : { judgment }) })
  return { recent: { ...run, updatedAt: T0 + 5000, tickets: [ticket(newer)] }, stale: { ...run, updatedAt: T0 + 1000, tickets: [ticket(older)] } }
}

const boardOf = (runs: Run[]): Board => ({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs, activeId: null })

for (const [label, newer, older] of [
  ['un « oui » plus récent gagne', true, false],
  ['un « non » plus récent gagne', false, true],
  ['un drapeau retiré plus récent gagne', undefined, true],
] as [string, boolean | undefined, boolean | undefined][]) {
  test(`fusion de deux copies : ${label}, dans les deux sens de la fusion`, () => {
    const { recent, stale } = copies(newer, older)
    for (const merged of [mergeBoards(boardOf([recent]), boardOf([stale])), mergeBoards(boardOf([stale]), boardOf([recent]))]) {
      const ticket = merged.runs[0]!.tickets.find(t => t.id === '03')
      expect(ticket?.judgment).toBe(newer)
      expect(isJudgmentTicket(ticket)).toBe(newer === true)
    }
  })
}

// La mission active ici : la fusion garde la copie d'ici tant qu'aucune autre discussion ne l'a reprise, et
// celle de la discussion qui l'a reprise sinon, quelle que soit la date (règle des autres champs du ticket) :
// le drapeau suit la copie gardée, jamais un mélange des deux.
test('fusion de la mission active ici : le drapeau suit la copie que la fusion garde, ici ou chez la discussion qui l’a reprise', () => {
  const run = { ...newRun('implement', T0, 'Lot'), status: 'active' as const, owner: 's' }
  const ticket = (judgment: boolean): Ticket => ({ id: '03', name: 'Lancement', status: 'todo', judgment })
  const here: Board = { ...boardOf([{ ...run, updatedAt: T0 + 1000, tickets: [ticket(false)] }]), activeId: run.id }
  // Une copie plus récente, de la même discussion : la copie d'ici reste (aucune reprise), son « non » aussi.
  const same = mergeBoards(here, boardOf([{ ...run, updatedAt: T0 + 5000, tickets: [ticket(true)] }]))
  expect(same.activeId).toBe(run.id)
  expect(same.runs[0]!.tickets[0]!.judgment).toBe(false)
  // Reprise par une autre discussion, plus récente : sa copie l'emporte entière, son « oui » compris.
  const taken = mergeBoards(here, boardOf([{ ...run, owner: 'autre', updatedAt: T0 + 5000, tickets: [ticket(true)] }]))
  expect(taken.activeId).toBeNull()
  expect(taken.runs[0]!.tickets[0]!.judgment).toBe(true)
  // Et l'inverse : un « non » de la discussion qui l'a reprise l'emporte sur le « oui » d'ici.
  const yesHere: Board = { ...boardOf([{ ...run, updatedAt: T0 + 1000, tickets: [ticket(true)] }]), activeId: run.id }
  const takenNo = mergeBoards(yesHere, boardOf([{ ...run, owner: 'autre', updatedAt: T0 + 5000, tickets: [ticket(false)] }]))
  expect(isJudgmentTicket(takenNo.runs[0]!.tickets[0])).toBe(false)
})

/** La mission du manager, ouverte par la discussion « session-A » du monde des tests, avec trois tickets gardés. */
const seededMission = (w: ReturnType<typeof world>, now: number): string => {
  const opened = openRun({ ...emptyBoard('', 'projet'), session: 'session-A', deleted: [] }, { title: 'Lot' }, now - 60_000)
  const sent = applyReport(opened.board, { tickets: [{ id: '03', name: 'Lancement', judgment: true }, { id: '04', name: 'Cadrage', judgment: false }, { id: '05', name: 'Bug' }] }, now - 50_000).board
  // Une valeur gardée hors forme (écrite à la main, ou par une version future) : jamais lue « oui ».
  const board: Board = { ...sent, runs: sent.runs.map(r => ({ ...r, tickets: r.tickets.map(t => (t.id === '05' ? ({ ...t, judgment: 'oui' } as unknown as Ticket) : t)) })) }
  writeBoard(w, () => board)
  return opened.board.activeId!
}

test('le drapeau gardé dans le fichier des missions se relit au démarrage du mod, et un envoi sans le champ le garde', { timeoutMs: 30000 }, async ($, on) => {
  const now = 80_000_000
  const clock = mock.clock(on, { now })
  const w = world(on)
  const id = seededMission(w, now)
  // Le processus de la discussion repart : le mod relit la mission dans le stockage, puis Claude envoie des statuts.
  await start($)
  await settle(clock, 6)
  await $.tool.call({ tool: TOOL, tickets: [{ id: '03', name: 'Lancement', status: 'doing' }, { id: '04', name: 'Cadrage', status: 'doing' }, { id: '05', name: 'Bug', status: 'doing' }] } as any)
  await settle(clock, 3)
  const tickets = stored(w).runs.find(r => r.id === id)!.tickets
  // L'effet positif d'abord : l'envoi a bien été écrit.
  expect(tickets.map(t => t.status)).toEqual(['doing', 'doing', 'doing'])
  expect(tickets.find(t => t.id === '03')?.judgment).toBe(true)
  expect(tickets.find(t => t.id === '04')?.judgment).toBe(false)
  // La valeur hors forme reste telle quelle (rien ne la réécrit), et ne vaut jamais « oui ».
  expect(isJudgmentTicket(tickets.find(t => t.id === '05'))).toBe(false)
  expect(tickets.map(t => isJudgmentTicket(t))).toEqual([true, false, false])
})

test('un appel d’un worker par l’outil flow (delegate, tickets et judgment) n’écrit rien dans la mission gardée', { timeoutMs: 30000 }, async ($, on) => {
  const now = 80_000_000
  const clock = mock.clock(on, { now })
  const w = world(on)
  const id = seededMission(w, now)
  // La mission est tenue par une autre discussion ; cette session-ci est un worker de son groupe.
  writeBoard(w, b => ({ ...b, activeId: null, runs: b.runs.map(r => ({ ...r, owner: 'session-B' })) }))
  await start($)
  await settle(clock, 6)
  const answer = JSON.stringify(await $.tool.call({ tool: TOOL, delegate: id, group: 'A', main: '[abc123]', tickets: [{ id: '04', name: 'Cadrage', judgment: true }, { id: '05', name: 'Bug', judgment: true }] } as any))
  // L'effet positif d'abord : la délégation est posée (la réponse le dit).
  expect(answer).toContain('This discussion works for the mission')
  await $.tool.call({ tool: TOOL, tickets: [{ id: '04', name: 'Cadrage', judgment: true }] } as any)
  await settle(clock, 3)
  const tickets = stored(w).runs.find(r => r.id === id)!.tickets
  expect(tickets.map(t => isJudgmentTicket(t))).toEqual([true, false, false])
  expect(tickets.find(t => t.id === '04')?.judgment).toBe(false)
})

// La déclaration des tickets de jugement en auto, rejouée telle que le bloc du découpage la dicte : un choix est
// coupé à 300 signes, d'où plusieurs choix au même libellé pour une longue liste ; chacun est gardé entier.
test('la déclaration des tickets de jugement, en plusieurs choix au même libellé, est gardée entière, choix par choix', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `90000000000000${String(i).padStart(2, '0')}`)
  const wording = (part: string[]) => `Tickets de jugement, en xhigh le temps du ticket : ${part.map(id => `${id} (jugement sur un existant)`).join(', ')}`
  const parts = [ids.slice(0, 5), ids.slice(5, 10), ids.slice(10)]
  for (const part of parts) expect(wording(part).length).toBeLessThan(300)
  // En un seul choix, la liste dépasserait 300 signes : c'est pourquoi la consigne la coupe.
  expect(wording(ids).length).toBeGreaterThan(300)
  const board = applyReport(boardWith({}), { decided: parts.map(part => ({ what: wording(part), origin: 'recommendation' })) }, T0 + 2000).board
  const kept = (activeRun(board)?.decided ?? []).map(d => d.what)
  expect(kept).toEqual(parts.map(wording))
  // Le cas qui motive la coupe : envoyée en un seul choix, la liste perd sa fin.
  const single = applyReport(boardWith({}), { decided: [{ what: wording(ids), origin: 'recommendation' }] }, T0 + 2000).board
  const what = activeRun(single)!.decided![0]!.what
  expect(what.endsWith('…')).toBe(true)
  expect(what.includes(ids[11]!)).toBe(false)
})

test('un appel de worker suivi d’un envoi de tickets n’ouvre aucune mission : le nombre de missions ne change pas', () => {
  const board = boardWith({ tickets: [{ id: '03', name: 'Lancement' }] })
  const run = activeRun(board)!
  const delegated = applyReport(board, { delegate: run.id, group: 'A', main: '[abc123]' }, T0 + 2000).board
  // Même sans mission à reprendre ici, l'envoi d'une session déléguée n'écrit rien, ni une nouvelle mission.
  const alone: Board = { ...delegated, runs: delegated.runs.map(r => ({ ...r, status: 'done' as const })) }
  const after = applyReport(alone, { tickets: [{ id: '03', name: 'Lancement', judgment: true }] }, T0 + 3000).board
  expect(after.runs.length).toBe(1)
  expect(after.runs.flatMap(r => r.tickets).some(t => isJudgmentTicket(t))).toBe(false)
})
