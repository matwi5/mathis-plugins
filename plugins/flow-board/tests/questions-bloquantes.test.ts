// Questions bloquantes du mode auto : Claude déclare par l'outil `flow` (`waiting`) chaque question qui
// attend la personne, avec ce qu'elle bloque (une phase, un groupe ou un ticket), et la retire une fois
// répondue. Invariant : une question bloquante ne disparaît jamais par une fusion ou une
// reconstruction ; seuls son retrait par Claude ou l'effacement du parcours la font disparaître.

import { expect, mock, test } from 'claude-code/testing'

import { applyReport, autoNotices, blockingQuestions, clampFuture, emptyBoard, mergeBoards, newRun, openQuestions, parkActive, stopAutoUnread, switchOffAuto, switchOnAuto } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const T0 = 95_000_000

/** Un parcours actif dans la discussion « sa », avec deux groupes (A : t1, B : t2, t3) et un ticket hors groupe. */
const lot = (): Board => {
  const run: Run = { ...newRun('implement', T0, 'Boutique'), owner: 'sa' }
  const board: Board = { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
  return applyReport(
    board,
    {
      tickets: [
        { id: 't1', name: 'Un' },
        { id: 't2', name: 'Deux' },
        { id: 't3', name: 'Trois' },
      ],
      groups: [
        { id: 'A', name: 'Code', tickets: ['t1'] },
        { id: 'B', name: 'Données', tickets: ['t2', 't3'] },
      ],
    },
    T0 + 1,
  ).board
}
const runOf = (board: Board): Run => board.runs[0]!
const openIds = (board: Board): string[] => openQuestions(runOf(board)).map(q => q.id).sort()
const ask = (board: Board, waiting: unknown[], now: number) => applyReport(board, { waiting }, now)

test('« waiting » ajoute une question qui bloque un ticket, un groupe ou une phase, et la retire une fois répondue', () => {
  const asked = ask(lot(), [{ id: 'q1', ticket: 't2', text: 'Quel invariant pour les totaux ?' }, { id: 'q2', group: 'A', text: 'Garder l’ancien format ?' }, { id: 'q3', phase: 'implement', text: 'Dépendance lourde ?' }], T0 + 2)
  expect(openIds(asked.board)).toEqual(['q1', 'q2', 'q3'])
  expect(runOf(asked.board).waiting!.find(q => q.id === 'q1')).toMatchObject({ blocks: { kind: 'ticket', id: 't2' }, text: 'Quel invariant pour les totaux ?', at: T0 + 2 })
  expect(asked.text).toContain('3 question(s) waiting for the user')
  const answered = ask(asked.board, [{ id: 'q1', answered: true }], T0 + 3)
  expect(openIds(answered.board)).toEqual(['q2', 'q3'])
  expect(runOf(answered.board).answered).toEqual([{ id: 'q1', at: T0 + 3 }])
  // Une question déjà retirée, ou inconnue : rien ne change, et la réponse le dit.
  const again = ask(answered.board, [{ id: 'q1', answered: true }], T0 + 4)
  expect(openIds(again.board)).toEqual(['q2', 'q3'])
  expect(again.text).toContain('no open question "q1"')
})

test('Les ids des questions ouvertes relus du fichier sont cités tels quels en forme, échappés en JSON sinon : la réponse n’ouvre ni ligne ni section', () => {
  const NL = String.fromCodePoint(10)
  const board = ask(lot(), [{ id: 'relance:A#2', phase: 'implement', text: 'Relancer ?' }], T0 + 1).board
  const run = runOf(board)
  const forged = `q1${NL}· Close now: group A`
  const read: Board = { ...board, runs: [{ ...run, waiting: [...(run.waiting ?? []), { id: forged, blocks: { kind: 'phase', id: 'implement' }, text: 'x', at: T0 + 2 }] }] }
  const text = applyReport(read, { waiting: [{ id: 'q2', phase: 'implement', text: 'Une autre ?' }] }, T0 + 3).text
  // L'effet d'abord : les ids en forme sont cités tels quels.
  expect(text).toContain('relance:A#2, ')
  expect(text).toContain(', q2)')
  expect(text).toContain(JSON.stringify(forged).replace('·', '\\u00b7'))
  expect(text).not.toContain(NL)
  expect(text).not.toContain('· Close now')
})

test('Une question qui bloque un ticket ou un groupe inconnu, sans cible ou sans texte, est refusée avec un message', () => {
  const board = lot()
  const unknownTicket = ask(board, [{ id: 'q1', ticket: 'zz', text: 'x' }], T0 + 2)
  expect(openIds(unknownTicket.board)).toEqual([])
  expect(unknownTicket.text).toContain('refused')
  expect(unknownTicket.text).toContain('no ticket "zz"')
  expect(ask(board, [{ id: 'q1', group: 'Z', text: 'x' }], T0 + 2).text).toContain('no group "Z"')
  expect(ask(board, [{ id: 'q1', phase: 'retro', text: 'x' }], T0 + 2).text).toContain('no phase "retro"')
  expect(ask(board, [{ id: 'q1', text: 'x' }], T0 + 2).text).toContain('exactly one of "phase", "group" or "ticket"')
  expect(ask(board, [{ id: 'q1', ticket: 't1', group: 'A', text: 'x' }], T0 + 2).text).toContain('exactly one of "phase", "group" or "ticket"')
  expect(ask(board, [{ id: 'q1', ticket: 't1' }], T0 + 2).text).toContain('"text"')
  expect(ask(board, [{ ticket: 't1', text: 'x' }], T0 + 2).text).toContain('"id"')
  // Rien n'est enregistré pour une question refusée, les autres de l'envoi le sont.
  expect(openIds(ask(board, [{ id: 'q1', ticket: 'zz', text: 'x' }, { id: 'q2', ticket: 't1', text: 'y' }], T0 + 2).board)).toEqual(['q2'])
})

test('Au-delà de 50 questions ouvertes, une nouvelle est refusée, jamais une ancienne coupée', () => {
  const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `q${i}`, ticket: 't1', text: `Question ${i}` }))
  const full = ask(lot(), fifty, T0 + 2)
  expect(openIds(full.board)).toHaveLength(50)
  const more = ask(full.board, [{ id: 'q50', ticket: 't1', text: 'De trop' }], T0 + 3)
  expect(openIds(more.board)).toHaveLength(50)
  expect(openIds(more.board)).not.toContain('q50')
  expect(more.text).toContain('50 open questions at most')
  // Redéclarer une question ouverte la met à jour, sans compter double.
  const updated = ask(full.board, [{ id: 'q0', ticket: 't2', text: 'Reformulée' }], T0 + 3)
  expect(runOf(updated.board).waiting!.find(q => q.id === 'q0')).toMatchObject({ blocks: { kind: 'ticket', id: 't2' }, text: 'Reformulée' })
})

test('La fusion garde l’union des questions et applique les retraits tracés : une copie en retard ne fait ni disparaître une question ni revenir une question retirée, dans les deux sens', () => {
  const base = lot()
  const q1 = ask(base, [{ id: 'q1', ticket: 't1', text: 'Un ?' }], T0 + 2).board
  // La copie de B, faite avec q1 ouverte, puis touchée plus tard (plus récente pour le reste).
  const stale: Board = { ...(JSON.parse(JSON.stringify(q1)) as Board), session: 'sb', activeId: null }
  const staleNewer: Board = { ...stale, runs: stale.runs.map(r => ({ ...r, status: 'paused' as const, owner: undefined, updatedAt: T0 + 9 })) }
  // Ici : q1 répondue, q2 posée.
  const here = ask(ask(q1, [{ id: 'q1', answered: true }], T0 + 3).board, [{ id: 'q2', group: 'B', text: 'Deux ?' }], T0 + 4).board
  expect(openIds(mergeBoards(here, staleNewer))).toEqual(['q2'])
  expect(openIds(mergeBoards(staleNewer, here))).toEqual(['q2'])
  // Une question posée seulement dans la copie la plus récente d'ailleurs n'est pas perdue non plus.
  const there = ask({ ...stale, activeId: stale.runs[0]!.id }, [{ id: 'q3', phase: 'implement', text: 'Trois ?' }], T0 + 10).board
  expect(openIds(mergeBoards(here, there))).toEqual(['q2', 'q3'])
  expect(openIds(mergeBoards(there, here))).toEqual(['q2', 'q3'])
  // Prise en main par une copie active plus récente : le retrait d'ici tient.
  const taking: Board = { ...stale, runs: stale.runs.map(r => ({ ...r, status: 'active' as const, owner: 'sb', updatedAt: T0 + 9 })) }
  const taken = mergeBoards(here, taking)
  expect(taken.activeId).toBeNull()
  expect(openIds(taken)).toEqual(['q2'])
})

test('Une question reposée sous le même id après son retrait est de nouveau ouverte, même face à la trace', () => {
  const board = ask(ask(lot(), [{ id: 'q1', ticket: 't1', text: 'Un ?' }], T0 + 2).board, [{ id: 'q1', answered: true }], T0 + 3).board
  const again = ask(board, [{ id: 'q1', ticket: 't1', text: 'Un, encore ?' }], T0 + 4).board
  expect(openIds(again)).toEqual(['q1'])
  expect(openIds(mergeBoards(again, board))).toEqual(['q1'])
  expect(openIds(mergeBoards(board, again))).toEqual(['q1'])
})

test('Retirée puis reposée dans le même appel, une question reste ouverte après la fusion ; une date illisible ne la fait pas effacer par une trace', () => {
  const asked = ask(lot(), [{ id: 'q1', ticket: 't1', text: 'Un ?' }], T0 + 2).board
  const again = ask(asked, [{ id: 'q1', answered: true }, { id: 'q1', ticket: 't1', text: 'Un, encore ?' }], T0 + 3).board
  expect(openIds(again)).toEqual(['q1'])
  for (const merged of [mergeBoards(again, asked), mergeBoards(asked, again), mergeBoards(again, again)]) expect(openIds(merged)).toEqual(['q1'])
  // Une question dont la date s'est abîmée dans le fichier, face à une trace de son id : elle reste.
  const damaged: Board = { ...again, runs: again.runs.map(r => ({ ...r, waiting: r.waiting!.map(q => ({ ...q, at: 'hier' })) }) as unknown as Run) }
  expect(openIds(mergeBoards(damaged, again))).toEqual(['q1'])
  expect(openIds(mergeBoards(again, damaged))).toEqual(['q1'])
  // Elle se retire encore par Claude, et ce retrait tient face à la copie abîmée qui la porte encore.
  const withdrawn = ask(damaged, [{ id: 'q1', answered: true }], T0 + 4).board
  expect(openIds(withdrawn)).toEqual([])
  expect(openIds(mergeBoards(withdrawn, damaged))).toEqual([])
  expect(openIds(mergeBoards(damaged, withdrawn))).toEqual([])
  // Reposée ensuite, datée, elle reste ouverte malgré la trace de ce retrait.
  const reposed = ask(withdrawn, [{ id: 'q1', ticket: 't1', text: 'Un, de nouveau ?' }], T0 + 5).board
  expect(openIds(mergeBoards(reposed, damaged))).toEqual(['q1'])
})

test('Une trace datée dans le futur (horloge en avance) ne fait pas effacer une question reposée ensuite, dans aucune copie', () => {
  const now = T0 + 1_000_000
  const asked = ask(lot(), [{ id: 'q1', ticket: 't1', text: 'Un ?' }], T0 + 2).board
  // q1 retirée à une date future.
  const ahead: Board = { ...asked, runs: asked.runs.map(r => ({ ...r, waiting: [], answered: [{ id: 'q1', at: now + 3_600_000 }] })) }
  // Reposée maintenant : elle passe après la trace, et les dates restent les mêmes dans toutes les copies.
  const reposed = ask(ahead, [{ id: 'q1', ticket: 't1', text: 'Un, encore ?' }], now).board
  expect(openIds(reposed)).toEqual(['q1'])
  for (const merged of [mergeBoards(reposed, ahead), mergeBoards(ahead, reposed), mergeBoards(clampFuture(reposed, now + 5), clampFuture(ahead, now + 9))]) {
    expect(openIds(merged)).toEqual(['q1'])
  }
})

test('Un id de plus de 60 caractères est refusé, jamais rogné sur un autre ; une question relue sous un tel id se retire quand même ; un id ou une cible en chiffres sont admis', () => {
  const long = 'invariant-du-fichier-de-totaux-jamais-supprime-ni-reecrit-vide'
  const out = ask(lot(), [{ id: `${long}-A`, ticket: 't1', text: 'A ?' }, { id: `${long}-B`, ticket: 't1', text: 'B ?' }], T0 + 2)
  expect(openIds(out.board)).toEqual([])
  expect(out.text).toContain('an id has 60 characters at most')
  // Écrite par une autre version, une question de 70 caractères d'id se lit, et se retire.
  const written: Board = { ...out.board, runs: out.board.runs.map(r => ({ ...r, waiting: [{ id: `${long}-AAAAAAA`, blocks: { kind: 'ticket', id: 't1' }, text: 'A ?', at: T0 + 2 }] })) }
  expect(openIds(written)).toEqual([`${long}-AAAAAAA`])
  expect(openIds(ask(written, [{ id: `${long}-AAAAAAA`, answered: true }], T0 + 3).board)).toEqual([])
  const numbered = applyReport(lot(), { tickets: [{ id: '5', name: 'Cinq' }] }, T0 + 2).board
  const asked = ask(numbered, [{ id: 7, ticket: 5, text: 'Sept ?' }], T0 + 3).board
  expect(runOf(asked).waiting!.find(q => q.id === '7')).toMatchObject({ blocks: { kind: 'ticket', id: '5' } })
})

test('Une entrée relue d’un autre format n’est jamais reconstruite ni perdue par une fusion, et bloque tout ; une liste qui n’est pas un tableau garde sa valeur entière', () => {
  const board = ask(lot(), [{ id: 'q1', ticket: 't1', text: 'Un ?' }], T0 + 2).board
  const other = { id: 'q2', blocks: { kind: 'action', id: 'send-1' }, text: 'x', at: T0 + 2, extra: 'gardé' }
  const odd: Board = { ...board, runs: board.runs.map(r => ({ ...r, waiting: [...r.waiting!, other] }) as unknown as Run) }
  for (const merged of [mergeBoards(odd, board), mergeBoards(board, odd)]) {
    expect(runOf(merged).waiting).toContainEqual(other)
    expect(blockingQuestions(runOf(merged), { kind: 'phase', id: 'compte-rendu' }).map(q => q.id)).toEqual(['q2'])
  }
  // Une liste écrite comme un objet : elle se lit comme une question qui bloque tout et garde la valeur
  // entière ; la fusion la garde à côté des questions de l'autre copie, dans les deux sens.
  const map = { q1: { id: 'q1', text: 'x' }, q2: { id: 'q2', text: 'y' } }
  const damaged: Board = { ...board, runs: board.runs.map(r => ({ ...r, waiting: map }) as unknown as Run) }
  expect(blockingQuestions(runOf(damaged), { kind: 'ticket', id: 't2' })).toHaveLength(1)
  for (const merged of [mergeBoards(damaged, board), mergeBoards(board, damaged)]) {
    const waiting = runOf(merged).waiting as unknown[]
    expect(waiting).toContainEqual(expect.objectContaining({ damaged: map }))
    expect(openIds(merged)).toContain('q1')
  }
  // L'outil y ajoute une question, et retire la liste abîmée sous son id.
  const added = ask(damaged, [{ id: 'q3', ticket: 't1', text: 'Trois ?' }], T0 + 3).board
  const damagedId = openIds(damaged)[0]!
  expect(openIds(added)).toEqual([damagedId, 'q3'].sort())
  const cleared = ask(added, [{ id: damagedId, answered: true }], T0 + 4).board
  expect(openIds(cleared)).toEqual(['q3'])
  expect(openIds(mergeBoards(cleared, damaged))).toEqual(['q3'])
})

test('Un id de groupe relu qui n’est pas une chaîne ne fait pas tomber la fonction qui dit si une action est bloquée', () => {
  const board = ask(lot(), [{ id: 'q1', group: 'B', text: 'Un ?' }], T0 + 2).board
  const odd: Run = { ...runOf(board), groups: runOf(board).groups!.map(g => (g.id === 'B' ? { ...g, id: 7 as unknown as string } : g)) }
  expect(() => blockingQuestions(odd, { kind: 'ticket', id: 't2' })).not.toThrow()
  expect(() => blockingQuestions(odd, { kind: 'group', id: 'B' })).not.toThrow()
})

test('Les traces de retrait gardent les 100 plus récentes ; la fusion ne coupe jamais une question ouverte', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, ticket: 't1', text: `R${i}` }))
  let board = lot()
  // Par paquets de 40, chacun répondu avant le suivant (50 questions ouvertes au plus).
  for (let i = 0; i < 120; i += 40) {
    board = ask(board, many.slice(i, i + 40), T0 + 2 + i).board
    board = ask(board, many.slice(i, i + 40).map(q => ({ id: q.id, answered: true })), T0 + 3 + i).board
  }
  expect(openIds(board)).toEqual([])
  expect(runOf(board).answered).toHaveLength(100)
  // Les plus récentes : toutes celles des deux derniers paquets.
  const kept = new Set(runOf(board).answered!.map(t => t.id))
  expect(many.slice(40).every(q => kept.has(q.id))).toBe(true)
  // Deux copies qui ont chacune 40 questions ouvertes distinctes : 80 après fusion, aucune coupée.
  const forty = (prefix: string) => Array.from({ length: 40 }, (_, i) => ({ id: `${prefix}${i}`, ticket: 't1', text: 'x' }))
  const a = ask(lot(), forty('a'), T0 + 2).board
  const b = ask({ ...a, runs: a.runs.map(r => ({ ...r, waiting: [] })) }, forty('b'), T0 + 3).board
  expect(openIds(mergeBoards(a, b))).toHaveLength(80)
})

test('Une seule fonction dit si une action est bloquée : la phase par ses questions, un groupe aussi par celles de ses tickets, un ticket par celles de son groupe ; l’Implémentation bloquée bloque ses groupes et ses tickets', () => {
  const board = ask(lot(), [{ id: 'q1', ticket: 't2', text: 'Un ?' }, { id: 'q2', group: 'A', text: 'Deux ?' }], T0 + 2).board
  const run = runOf(board)
  const ids = (target: Parameters<typeof blockingQuestions>[1]) => blockingQuestions(run, target).map(q => q.id).sort()
  expect(ids({ kind: 'ticket', id: 't2' })).toEqual(['q1'])
  expect(ids({ kind: 'ticket', id: 't3' })).toEqual([])
  expect(ids({ kind: 'group', id: 'B' })).toEqual(['q1'])
  expect(ids({ kind: 'group', id: 'A' })).toEqual(['q2'])
  expect(ids({ kind: 'ticket', id: 't1' })).toEqual(['q2'])
  expect(ids({ kind: 'phase', id: 'implement' })).toEqual([])
  const phase = runOf(ask(board, [{ id: 'q3', phase: 'implement', text: 'Trois ?' }], T0 + 3).board)
  expect(blockingQuestions(phase, { kind: 'phase', id: 'implement' }).map(q => q.id)).toEqual(['q3'])
  expect(blockingQuestions(phase, { kind: 'group', id: 'B' }).map(q => q.id).sort()).toEqual(['q1', 'q3'])
  expect(blockingQuestions(phase, { kind: 'ticket', id: 't3' }).map(q => q.id)).toEqual(['q3'])
  expect(blockingQuestions(phase, { kind: 'phase', id: 'compte-rendu' })).toEqual([])
  // Une question relue hors forme (cible illisible) bloque tout : le sens sûr.
  const odd: Run = { ...run, waiting: [{ id: 'q9', blocks: { kind: 'autre', id: 1 }, text: 'x', at: T0 } as never] }
  expect(blockingQuestions(odd, { kind: 'phase', id: 'compte-rendu' }).map(q => q.id)).toEqual(['q9'])
})

test('Les notifications : une question qui apparaît en auto, une pause posée par le mod ou la fin de la discussion ; jamais hors auto, ni pour une coupure par la personne, ni de texte de question', () => {
  const on = switchOnAuto(lot(), 'sa', T0 + 2)!.board
  const asked = ask(on, [{ id: 'q1', ticket: 't2', text: 'Le code `rm -rf` ?' }, { id: 'q2', group: 'A', text: 'Deux ?' }], T0 + 3).board
  expect(autoNotices(on, asked)).toEqual(['Parcours Boutique : 2 question(s) t\'attendent'])
  // Une question retirée, ou redéclarée : rien.
  expect(autoNotices(asked, ask(asked, [{ id: 'q1', answered: true }], T0 + 4).board)).toEqual([])
  expect(autoNotices(asked, ask(asked, [{ id: 'q2', group: 'A', text: 'Deux, reformulée ?' }], T0 + 4).board)).toEqual([])
  // Hors auto : rien.
  const off = lot()
  expect(autoNotices(off, ask(off, [{ id: 'q1', ticket: 't2', text: 'x' }], T0 + 3).board)).toEqual([])
  // Une pause posée par la fin de la discussion ou par une lecture ratée : sa raison.
  expect(autoNotices(on, parkActive(on, T0 + 5)!.board)).toEqual(['Parcours Boutique : auto en pause (discussion fermée)'])
  expect(autoNotices(on, stopAutoUnread(on, T0 + 5)!)).toEqual(['Parcours Boutique : auto en pause (lecture du parcours ratée)'])
  // Coupé par la personne : rien.
  expect(autoNotices(on, switchOffAuto(on, T0 + 5)!.board)).toEqual([])
})

// ─── Le mod vu du moteur ─────────────────────────────────────────────────

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const SURFACES = ['terminal', 'desktop'] as const

/**
 * Le moteur sous le plugin : le board s'enregistre dans le fichier commun quand le dossier du mod dit
 * où est ~/.claude (`disk`), dans `$.store` sinon (`mem`) ; les notifications levées sont gardées.
 */
const world = (on: any, opts: { notifyFails?: boolean } = {}) => {
  const mem: Record<string, unknown> = {}
  const notified: { text: string; title?: string }[] = []
  // Chaque appel de `$.ui.notify`, levé ou non.
  const tries = { count: 0 }
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'sa' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  const disk: { board?: string } = {}
  const isBoardFile = (path: string) => path.includes('/flow-board/parcours/')
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isBoardFile(e.path) && disk.board !== undefined }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!isBoardFile(e.path) || disk.board === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: disk.board } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (!isBoardFile(e.path)) throw new Error('EACCES')
    disk.board = e.text
    return { value: undefined } as any
  })
  on('ui.notify', (_$: unknown, e: { text: string; options?: { title?: string } }) => {
    tries.count += 1
    if (opts.notifyFails) throw new Error('no channel')
    notified.push({ text: e.text, ...(e.options?.title ? { title: e.options.title } : {}) })
    return { value: { isSent: true, channel: 'iterm2' } }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'sa' }))
  on('command.list', () => ({ value: [] }))
  on('prompt.fill', () => ({ isFilled: true }))
  return { mem, disk, notified, tries }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key })
  await pane.unmount()
}
const bandText = async ($: any, surface: (typeof SURFACES)[number]): Promise<string> => {
  const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
  const texts = (await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '')).join(' | ')
  await band.unmount()
  return texts
}
const running = async ($: any, on: any, opts: { notifyFails?: boolean } = {}) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, opts)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', tickets: [{ id: 't1', name: 'Un' }, { id: 't2', name: 'Deux' }] } as any)
  return { clock, ...w }
}

test('En auto, une question déclarée lève une notification au texte fixé, sans le texte de la question ; le bandeau dit « attend ta réponse (N) » et l’onglet liste les questions avec ce qu’elles bloquent', { timeoutMs: 20000 }, async ($, on) => {
  const { notified } = await running($, on)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', ticket: 't2', text: 'Faut-il effacer les anciens totaux ?' }] } as any)
  expect(notified.map(n => n.text)).toEqual(['Parcours Boutique : 1 question(s) t\'attendent'])
  for (const surface of SURFACES) {
    expect(await bandText($, surface)).toMatch(/⚡\sAuto\s·\sattend\sta\sréponse\s\(1\)/)
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await pane.find({ type: 'Text', text: /Faut-il effacer les anciens totaux \?/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /bloque le ticket Deux/ })).toBeDefined()
    await pane.unmount()
  }
  // Une seconde question : le compte suit ; la retirer ne notifie rien.
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q2', phase: 'to-tickets', text: 'Deux ?' }] } as any)
  expect(notified.at(-1)!.text).toBe('Parcours Boutique : 2 question(s) t\'attendent')
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', answered: true }, { id: 'q2', answered: true }] } as any)
  expect(notified).toHaveLength(2)
  expect(await bandText($, 'terminal')).toMatch(/⚡\sAuto\s·\sen\scours/)
})

test('Hors auto, « waiting » est accepté et listé, mais rien n’est notifié ; un échec de notification ne bloque rien', { timeoutMs: 20000 }, async ($, on) => {
  const { notified } = await running($, on)
  const reply = JSON.stringify(await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', ticket: 't1', text: 'Un ?' }] } as any))
  expect(reply).toContain('1 question(s) waiting for the user')
  expect(notified).toEqual([])
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await pane.find({ type: 'Text', text: /Un \?/ })).toBeDefined()
  await pane.unmount()
})

test('Un échec de la notification ne bloque ni la question ni l’appel', { timeoutMs: 20000 }, async ($, on) => {
  const { tries } = await running($, on, { notifyFails: true })
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  const reply = JSON.stringify(await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', ticket: 't1', text: 'Un ?' }] } as any))
  // La notification a bien été tentée, et son échec n'a rien arrêté.
  expect(tries.count).toBe(1)
  expect(reply).toContain('1 question(s) waiting for the user')
  expect(await bandText($, 'desktop')).toMatch(/⚡\sAuto\s·\sattend\sta\sréponse\s\(1\)/)
})

test('La fin de la discussion porteuse notifie la pause de l’auto, avec sa raison', { timeoutMs: 20000 }, async ($, on) => {
  const { notified } = await running($, on)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  expect(notified.map(n => n.text)).toEqual(['Parcours Boutique : auto en pause (discussion fermée)'])
})

test('Le parcours en pause liste encore ses questions dans l’onglet, avec ce qu’elles bloquent', { timeoutMs: 20000 }, async ($, on) => {
  await running($, on)
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', ticket: 't2', text: 'Faut-il effacer les anciens totaux ?' }] } as any)
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await pane.find({ type: 'Text', text: /est en pause/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Faut-il effacer les anciens totaux \?/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /bloque le ticket Deux/ })).toBeDefined()
    await pane.unmount()
  }
})

test('Une pause que la fusion pose (une copie relue abîmée) sur le parcours porté ici est notifiée', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, mem, disk, notified } = await running($, on)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await clock.advance(1000)
  // La copie enregistrée (au fichier commun s'il sert, sinon dans le magasin du mod) s'abîme : son état auto n'est plus un objet.
  const stored = (disk.board !== undefined ? JSON.parse(disk.board) : mem['board:']) as Board
  const damaged = { ...stored, runs: stored.runs.map(r => ({ ...r, auto: 'x' })) }
  if (disk.board !== undefined) disk.board = JSON.stringify(damaged)
  else mem['board:'] = damaged
  await $.tool.call({ tool: TOOL, note: 'un pas' } as any)
  await clock.advance(1000)
  expect(notified.map(n => n.text)).toContain('Parcours Boutique : auto en pause (lecture du parcours ratée)')
})

test('Une session liée ne déclare pas de question : « waiting » n’y est pas enregistré, et la réponse dit de la remonter par message', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  world(on)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: 'run-1', group: 'A', main: '[e5eb08]' } as any)
  const reply = JSON.stringify(await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', ticket: 't1', text: 'Un ?' }] } as any))
  expect(reply).toContain('is not recorded in a linked session: send your question to the main discussion by SendMessage')
})
