import { expect, mock, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { applyAsana, applyReport, clampFuture, emptyBoard, mergeBoards, newRun, openBlockers } from '../hooks/model.ts'
import { TOOL_SCHEMA } from '../hooks/register.tsx'
import type { Board, ExternalBlocker, Run } from '../types'

// Un bloqueur externe peut être local (la session d'une autre mission, levée par "status": "done" une fois
// fusionnée), et un renvoi sans status ne remet plus « à faire » un bloqueur levé.
// Invariant : un bloqueur externe levé ne redevient à faire que par un envoi explicite "status": "todo" ;
// un bloqueur n'est jamais effacé hors de l'effacement de la mission.

const T0 = 70_000_000
const LOCAL = 'session-autre-mission'
const LOT = {
  tickets: [
    { id: 'a1', name: 'Premier', files: ['a.ts'] },
    { id: 'b1', name: 'Second', files: ['b.ts'], blockedBy: [LOCAL] },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Données', tickets: ['b1'] },
  ],
  externals: [{ id: LOCAL, name: 'Groupe C de « Mode auto » à fusionner', kind: 'task' }],
}

const boardWith = (): Board => {
  const run = newRun('implement', T0, 'Boutique')
  const b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(b, LOT, T0 + 1).board
}

const ext = (b: Board): ExternalBlocker[] => activeRun(b)!.externals ?? []
const statusOf = (b: Board, id = LOCAL) => ext(b).find(x => x.id === id)?.status
const waitsOf = (b: Board) => {
  const run = activeRun(b)!
  return openBlockers(run, run.tickets.find(t => t.id === 'b1')!)
}

test('un bloqueur local, sans tâche Asana : le ticket qu’il bloque attend, puis se libère une fois le bloqueur levé', () => {
  const b = boardWith()
  // L'effet d'abord : le bloqueur est gardé, à faire, sous son nom ; sans statut envoyé, sans date de changement.
  expect(ext(b)).toEqual([{ id: LOCAL, name: 'Groupe C de « Mode auto » à fusionner', status: 'todo', isDecision: false }])
  expect(waitsOf(b)).toEqual([LOCAL])
  const lifted = applyReport(b, { externals: [{ id: LOCAL, status: 'done' }] }, T0 + 2).board
  expect(statusOf(lifted)).toBe('done')
  expect(activeRun(lifted)!.log.some(l => l.text === 'Dépendance externe levée : Groupe C de « Mode auto » à fusionner')).toBe(true)
  expect(waitsOf(lifted)).toEqual([])
})

test('un renvoi sans status (ou avec un status inconnu) garde un bloqueur levé ; seul "status": "todo" le rouvre', () => {
  let b = applyReport(boardWith(), { externals: [{ id: LOCAL, status: 'done' }] }, T0 + 2).board
  // Un renvoi qui ne change que le nom : le statut, sa date et le type restent, le nom change.
  b = applyReport(b, { externals: [{ id: LOCAL, name: 'Groupe C fusionné' }] }, T0 + 3).board
  expect(ext(b)).toEqual([{ id: LOCAL, name: 'Groupe C fusionné', status: 'done', isDecision: false, statusAt: T0 + 2 }])
  // Un status qui n'est ni « todo » ni « done » exacts : rien ne change de statut.
  for (const status of ['Done', ' todo', 'fini', 'blocked', '', 1, null]) {
    b = applyReport(b, { externals: [{ id: LOCAL, status }] }, T0 + 4).board
    expect(statusOf(b)).toBe('done')
    expect(waitsOf(b)).toEqual([])
  }
  // Un renvoi sans nom garde le nom connu.
  b = applyReport(b, { externals: [{ id: LOCAL, status: 'done' }] }, T0 + 5).board
  expect(ext(b)[0]!.name).toBe('Groupe C fusionné')
  // L'envoi explicite : rouvert, daté, et le journal le dit.
  b = applyReport(b, { externals: [{ id: LOCAL, status: 'todo' }] }, T0 + 6).board
  expect(ext(b)[0]).toMatchObject({ status: 'todo', statusAt: T0 + 6 })
  expect(waitsOf(b)).toEqual([LOCAL])
  expect(activeRun(b)!.log.some(l => l.text === 'Dépendance externe rouverte : Groupe C fusionné')).toBe(true)
  // Un nouveau bloqueur sans status est à faire, son id pour nom, sans date (aucun statut envoyé) ; avec un status, daté.
  b = applyReport(b, { externals: [{ id: 'autre-session' }, { id: 'troisieme', status: 'todo' }] }, T0 + 7).board
  expect(ext(b).find(x => x.id === 'autre-session')).toEqual({ id: 'autre-session', name: 'autre-session', status: 'todo', isDecision: false })
  expect(ext(b).find(x => x.id === 'troisieme')).toMatchObject({ status: 'todo', statusAt: T0 + 7 })
})

test('les deux chemins de réouverture d’un bloqueur levé : sa tâche Asana décochée (série 25), ou "status": "todo" (test plus haut) ; cochée, elle le lève', () => {
  let b = applyReport(boardWith(), { externals: [{ id: '1200000000000001', name: 'Tâche Asana', status: 'done' }] }, T0 + 2).board
  b = applyAsana(b, [{ task: '1200000000000001', completed: false }], T0 + 3)!.board
  expect(ext(b).find(x => x.id === '1200000000000001')).toMatchObject({ status: 'todo', statusAt: T0 + 3 })
  expect(activeRun(b)!.log.some(l => l.text === 'Dépendance externe rouverte : Tâche Asana')).toBe(true)
  // Une mise à jour Asana sans « completed » ne change pas le statut.
  expect(applyAsana(b, [{ task: '1200000000000001' }], T0 + 4)).toBeNull()
  b = applyReport(b, { externals: [{ id: '1200000000000002', name: 'Autre tâche' }] }, T0 + 4).board
  b = applyAsana(b, [{ task: '1200000000000002', completed: true }], T0 + 5)!.board
  expect(ext(b).find(x => x.id === '1200000000000002')).toMatchObject({ status: 'done', statusAt: T0 + 5 })
})

test('au plafond, un nouveau bloqueur est refusé et la réponse le dit ; aucun bloqueur gardé n’est rogné', () => {
  let b = boardWith()
  const many = Array.from({ length: 149 }, (_, i) => ({ id: `x-${i}`, name: `X ${i}` }))
  b = applyReport(b, { externals: many }, T0 + 2).board
  expect(ext(b)).toHaveLength(150)
  const out = applyReport(b, { externals: [{ id: 'x-149', name: 'De trop' }, { id: LOCAL, status: 'done' }] }, T0 + 3)
  expect(ext(out.board)).toHaveLength(150)
  expect(ext(out.board).some(x => x.id === 'x-149')).toBe(false)
  // La mise à jour d'un bloqueur gardé passe ; le refus est dit.
  expect(statusOf(out.board)).toBe('done')
  expect(out.text).toContain('externals: not recorded, the mission keeps 150 external blockers (at most 150; 150 before this call): "x-149"; the updates of the kept ones were applied')
  // Une liste gardée au-delà du plafond (fichier relu) n'est jamais rognée par un envoi.
  const over = { ...activeRun(out.board)!, externals: [...ext(out.board), { id: 'y', name: 'Y', status: 'todo' as const, isDecision: false }] }
  const b2: Board = { ...out.board, runs: [over] }
  const after = applyReport(b2, { externals: [{ id: 'y', status: 'done' }] }, T0 + 4).board
  expect(ext(after)).toHaveLength(151)
  expect(statusOf(after, 'y')).toBe('done')
})

test('mergeBoards : une copie en retard ne rouvre pas un bloqueur levé, un "todo" explicite plus récent tient, rien n’est effacé', () => {
  const base = boardWith()
  const run = activeRun(base)!
  const at = (r: Run, updatedAt: number, externals: ExternalBlocker[]): Board => ({ ...base, runs: [{ ...r, updatedAt, externals }] })
  const todo: ExternalBlocker = { id: LOCAL, name: 'Groupe C', status: 'todo', isDecision: false, statusAt: T0 + 1 }
  const done: ExternalBlocker = { ...todo, status: 'done', statusAt: T0 + 4 }
  const added: ExternalBlocker = { id: 'nouveau', name: 'Nouveau', status: 'todo', isDecision: false, statusAt: T0 + 3 }
  // La copie la plus récente a encore le bloqueur à faire (d'avant sa levée) ; l'autre l'a levé : levé, dans les deux sens.
  expect(mergeBoards(at(run, T0 + 10, [todo]), at(run, T0 + 5, [done])).runs[0]!.externals).toEqual([done])
  expect(mergeBoards(at(run, T0 + 5, [done]), at(run, T0 + 10, [todo])).runs[0]!.externals).toEqual([done])
  // Rouvert explicitement après la levée : le « todo » tient face à la copie écrite où il était levé.
  const reopened: ExternalBlocker = { ...todo, statusAt: T0 + 8 }
  expect(mergeBoards(at(run, T0 + 9, [reopened]), at(run, T0 + 5, [done])).runs[0]!.externals).toEqual([reopened])
  // Sans date (entrées d'avant ce champ) ou à date égale : le levé l'emporte.
  const { statusAt: _a, ...oldTodo } = todo
  const { statusAt: _b, ...oldDone } = done
  expect(mergeBoards(at(run, T0 + 10, [oldTodo]), at(run, T0 + 5, [oldDone])).runs[0]!.externals).toEqual([oldDone])
  expect(mergeBoards(at(run, T0 + 10, [{ ...todo, statusAt: T0 + 4 }]), at(run, T0 + 5, [done])).runs[0]!.externals).toEqual([done])
  // Un bloqueur ajouté dans la copie la plus ancienne n'est pas effacé par la plus récente.
  expect(mergeBoards(at(run, T0 + 10, [done]), at(run, T0 + 5, [todo, added])).runs[0]!.externals).toEqual([done, added])
  // Sans bloqueur de l'autre côté, la copie gardée ne change pas.
  expect(mergeBoards(at(run, T0 + 10, [todo]), at(run, T0 + 5, [])).runs[0]!.externals).toEqual([todo])
})

test('mergeBoards : un bloqueur renvoyé sans status à une copie qui ne le connaissait pas ne rouvre pas, à la fusion, celui levé dans l’autre', () => {
  const base = boardWith()
  const run = activeRun(base)!
  // La copie en retard ne connaît pas le bloqueur ; elle le reçoit plus tard, sans status (le lot renvoyé en entier).
  const late: Board = { ...base, runs: [{ ...run, externals: [] }] }
  const resent = applyReport(late, { externals: [{ id: LOCAL, name: 'Groupe C' }] }, T0 + 8).board
  const lifted = applyReport(base, { externals: [{ id: LOCAL, status: 'done' }] }, T0 + 5).board
  for (const [local, stored] of [
    [resent, lifted],
    [lifted, resent],
  ] as const) {
    expect(mergeBoards(local, stored).runs[0]!.externals!.find(x => x.id === LOCAL)).toMatchObject({ status: 'done', statusAt: T0 + 5 })
  }
})

test('une levée datée au-delà de la tolérance est ramenée à maintenant à la lecture : elle ne perd pas contre un « todo » daté plus ancien', () => {
  const base = boardWith()
  const run = activeRun(base)!
  const todo: ExternalBlocker = { id: LOCAL, name: 'Groupe C', status: 'todo', isDecision: false, statusAt: T0 + 1 }
  const file: Board = { ...base, runs: [{ ...run, updatedAt: T0 + 5, externals: [{ ...todo, status: 'done', statusAt: T0 + 86_400_000 }] }] }
  expect(activeRun(clampFuture(file, T0 + 10))!.externals![0]).toMatchObject({ status: 'done', statusAt: T0 + 10 })
  // Une autre discussion, encore au « todo » explicite d'avant, sauvegarde : le fichier relu (horloge recalée) garde la levée.
  const stale: Board = { ...base, runs: [{ ...run, updatedAt: T0 + 9, externals: [todo] }] }
  expect(mergeBoards(clampFuture(stale, T0 + 10), clampFuture(file, T0 + 10)).runs[0]!.externals![0]!.status).toBe('done')
})

test('un « todo » daté au-delà de la tolérance perd sa date à la lecture : relu à chaque sauvegarde, il ne gagne jamais sur une levée', () => {
  const base = boardWith()
  const run = activeRun(base)!
  const future: ExternalBlocker = { id: LOCAL, name: 'Groupe C', status: 'todo', isDecision: false, statusAt: T0 + 86_400_000 }
  const file: Board = { ...base, runs: [{ ...run, externals: [future] }] }
  const read = clampFuture(file, T0 + 10)
  expect(activeRun(read)!.externals![0]).toEqual({ id: LOCAL, name: 'Groupe C', status: 'todo', isDecision: false })
  // Levé ici, puis la sauvegarde relit le fichier, qui garde encore la date future : relu juste après la levée.
  const lifted = applyReport(read, { externals: [{ id: LOCAL, status: 'done' }] }, T0 + 20).board
  expect(mergeBoards(clampFuture(lifted, T0 + 21), clampFuture(file, T0 + 21)).runs[0]!.externals![0]).toMatchObject({ status: 'done', statusAt: T0 + 20 })
})

test('mergeBoards : un statut hors forme de l’autre copie ne remplace jamais un statut lu ; à statut égal, la date la plus récente reste', () => {
  const base = boardWith()
  const run = activeRun(base)!
  const at = (updatedAt: number, externals: unknown[]): Board => ({ ...base, runs: [{ ...run, updatedAt, externals: externals as ExternalBlocker[] }] })
  const done: ExternalBlocker = { id: LOCAL, name: 'Groupe C', status: 'done', isDecision: false, statusAt: T0 + 5 }
  for (const status of ['DONE', 'blocked', undefined, 1]) {
    expect(mergeBoards(at(T0 + 10, [done]), at(T0 + 5, [{ ...done, status, statusAt: T0 + 9 }])).runs[0]!.externals).toEqual([done])
  }
  // Même statut des deux côtés : la date du dernier changement est la plus récente, et une copie restée à un « todo »
  // intermédiaire (rouvert à T4, avant la levée à T6) ne rouvre plus à la fusion suivante.
  const merged = mergeBoards(at(T0 + 10, [{ ...done, statusAt: T0 + 2 }]), at(T0 + 9, [{ ...done, statusAt: T0 + 6 }]))
  expect(merged.runs[0]!.externals).toEqual([{ ...done, statusAt: T0 + 6 }])
  const stale = at(T0 + 4, [{ ...done, status: 'todo', statusAt: T0 + 4 }])
  expect(mergeBoards(merged, stale).runs[0]!.externals![0]!.status).toBe('done')
})

test('des bloqueurs relus qui ne sont pas une liste ne font échouer ni la lecture, ni la fusion, ni les lecteurs ; la fusion garde les bloqueurs de l’autre copie', () => {
  const base = boardWith()
  const run = activeRun(base)!
  for (const externals of [{}, 'x', 42]) {
    const odd: Board = { ...base, runs: [{ ...run, updatedAt: T0 + 10, externals: externals as unknown as ExternalBlocker[] }] }
    expect(clampFuture(odd, T0 + 10).runs[0]!.externals).toEqual(externals)
    // La copie gardée hors forme (la plus récente) : les bloqueurs lisibles de l'autre la remplacent, jamais effacés.
    expect(mergeBoards(odd, base).runs[0]!.externals).toEqual(run.externals)
    expect(mergeBoards(base, odd).runs[0]!.externals).toEqual(run.externals)
    // Lecteurs : le bloqueur inconnu bloque par prudence, sans erreur ; Asana ne trouve rien à lever.
    const oddRun = activeRun(odd)!
    expect(openBlockers(oddRun, oddRun.tickets.find(t => t.id === 'b1')!)).toEqual([LOCAL])
    expect(applyAsana(odd, [{ task: LOCAL, completed: true }], T0 + 11)).toBeNull()
  }
})

test('un renvoi sans nom répare un nom gardé illisible avec l’id, et le journal le nomme', () => {
  const base = boardWith()
  const run = activeRun(base)!
  const unnamed: Board = { ...base, runs: [{ ...run, externals: [{ id: LOCAL, name: undefined, status: 'todo', isDecision: false }] as unknown as ExternalBlocker[] }] }
  const b = applyReport(unnamed, { externals: [{ id: LOCAL, status: 'done' }] }, T0 + 5).board
  expect(ext(b)[0]).toMatchObject({ name: LOCAL, status: 'done' })
  expect(activeRun(b)!.log.some(l => l.text === `Dépendance externe levée : ${LOCAL}`)).toBe(true)
})

test('la description de l’outil dit le bloqueur local, comment le lever, et qu’un renvoi ne change que les champs envoyés', () => {
  const externals = (TOOL_SCHEMA as any).properties.externals
  expect(externals.description).toBe('Tasks outside the lot that tickets depend on (ids in their blockedBy); updated field by field, lifted by "status": "done", never removed')
  expect(externals.items.properties.id.description).toBe('Asana task GID, or a local id (another mission\'s session on the same files)')
})

test('la consigne de découpage dit le bloqueur local, comment le lever, et le renvoi sans status', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  expect(note.text).toContain('Without a tracker task, a blocker is local: a short id of your own, for example the session of another mission that touches the same files.')
  expect(note.text).toContain('When one is done, decided or merged, send it again with "status": "done"; a resend without "status" keeps the recorded one.')
})
