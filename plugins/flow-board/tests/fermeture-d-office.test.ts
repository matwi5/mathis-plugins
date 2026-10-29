import { expect, mock, test } from 'claude-code/testing'

import { closingProcedure, groupWorktree } from '../hooks/closing.ts'
import { activeRun, applyRelay, applyReport, cancelLinkedGroup, emptyBoard, mergeBoards, newRun, startLinkedGroups } from '../hooks/model.ts'
import type { Board, Relay } from '../types'

// Un groupe rendu, relu et à la sécurité tranchée est clos : la réponse de l'outil flow le liste
// « à fermer maintenant » avec sa procédure, et Claude rapporte le résultat par `closed`.
// Invariant : l'état de fermeture d'un groupe n'est jamais perdu ni reculé par un renvoi des
// groupes, un retour, une reprise ou une fusion de copies : un groupe noté fermé ne redevient
// jamais à fermer, et seul un nouvel envoi de `closed` pour ce groupe le change.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const START = 'mcp__ccd_session__start_session'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const LOT = {
  tickets: [
    { id: 'a1', name: 'Code', files: ['a'] },
    { id: 'b1', name: 'Doc', files: ['b'] },
    { id: 'c1', name: 'Ici', files: ['c'] },
  ],
  groups: [
    { id: 'A', name: 'Alpha', tickets: ['a1'], files: ['a'] },
    { id: 'B', name: 'Bêta', tickets: ['b1'], files: ['b'] },
    { id: 'C', name: 'Gamma', tickets: ['c1'], files: ['c'] },
  ],
}

const boardWith = (input: Record<string, unknown>, session = 's'): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: session }
  const board: Board = { ...emptyBoard('/p', 'p'), session, deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}
const groupOf = (board: Board, id: string) => activeRun(board)!.groups!.find(g => g.id === id)!
const REPO = { isRepo: true }

/** A et B confiés à des sessions liées (ids relevés), puis rendus ; rien d'autre. */
const returned = (): Board => {
  let b = startLinkedGroups(boardWith(LOT), ['A', 'B'], 3_000)!.board
  b = applyReport(b, { set: [{ id: 'a1', status: 'done' }, { id: 'b1', status: 'done' }], returned: ['A', 'B'] }, 4_000, REPO).board
  return b
}
/** A rendu, relu, sécurité jugée inutile : clos. B rendu, sans revue. */
const closable = (): Board => {
  let b = returned()
  b = applyReport(b, { reviewed: ['A'] }, 5_000, REPO).board
  return applyReport(b, { security: { group: 'A', advised: false, why: 'doc seule' } }, 5_100, REPO).board
}

test('un groupe rendu, relu, à la sécurité tranchée est listé « à fermer maintenant » avec sa procédure', () => {
  const out = applyReport(closable(), { note: 'point' }, 6_000, REPO)
  const run = activeRun(out.board)!
  expect(out.text).toContain('Close now: group A (Alpha) is closed (returned, reviewed, security settled).')
  expect(out.text).toContain(closingProcedure({ run, target: { kind: 'group', id: 'A', name: 'Alpha' }, isRepo: true }))
  expect(out.text).toContain('{"closed": [{"group": "A", "state": "closed", "sessionId": "<full sessionId>", "branch": "<kept branch>", "worktree": "<removed worktree path>"}]}')
  // C n'a pas été confié : pas de session à fermer.
  expect(out.text).not.toMatch(/group C \(Gamma\)/)
  // Sans git, la procédure n'arrête que la session.
  const noGit = applyReport(closable(), { note: 'point' }, 6_000, { isRepo: false })
  expect(noGit.text).toContain(closingProcedure({ run: activeRun(noGit.board)!, target: { kind: 'group', id: 'A', name: 'Alpha' }, isRepo: false }))
})

test('un groupe rendu pas encore clos : une ligne dit ce qui lui manque', () => {
  let b = closable()
  const text = (board: Board) => applyReport(board, { note: 'point' }, 9_000, REPO).text
  expect(text(b)).toContain('Not closed yet: group B (Bêta) lacks: its group review; the security advice.')
  b = applyReport(b, { reviewed: ['B'] }, 6_000, REPO).board
  expect(text(b)).toContain('Not closed yet: group B (Bêta) lacks: the security advice.')
  b = applyReport(b, { security: { group: 'B', advised: true, why: 'chemins' } }, 6_100, REPO).board
  expect(text(b)).toContain('Not closed yet: group B (Bêta) lacks: the security review it was advised.')
  b = applyReport(b, { security: { group: 'B', findings: 3, fixed: 1 } }, 6_200, REPO).board
  expect(text(b)).toContain('Not closed yet: group B (Bêta) lacks: a decision on 2 kept security finding(s) (fixed or dismissed).')
  b = applyReport(b, { security: { group: 'B', dismissed: 2 } }, 6_300, REPO).board
  expect(text(b)).toContain('Close now: group B (Bêta)')
})

test('une activité relayée après le compte rendu remet la fermeture à plus tard', () => {
  const b = closable()
  const runId = activeRun(b)!.id
  let relay: Relay = applyRelay(undefined, runId, 'fa', { kind: 'start', group: 'A' }, 3_500)!
  relay = applyRelay(relay, runId, 'fa', { kind: 'report', text: 'A fait' }, 3_900)!
  expect(applyReport(b, { note: 'point' }, 6_000, { ...REPO, relay }).text).toContain('Close now: group A')
  // La session reprend du travail (un correctif) après son compte rendu.
  relay = applyRelay(relay, runId, 'fa', { kind: 'command', commit: 'fix: F1' }, 7_000)!
  const later = applyReport(b, { note: 'point' }, 7_500, { ...REPO, relay }).text
  expect(later).not.toContain('Close now: group A')
  expect(later).toContain('Not closed yet: group A (Alpha) — its linked session is still active (relayed activity after its final report): closing waits.')
  // Un nouveau compte rendu, après ce travail, la rend de nouveau candidate.
  relay = applyRelay(relay, runId, 'fa', { kind: 'report', text: 'A fait, F1 corrigé' }, 8_000)!
  expect(applyReport(b, { note: 'point' }, 8_500, { ...REPO, relay }).text).toContain('Close now: group A')
})

test('« closed » retire le groupe de la liste ; « app » reste en une ligne ; un groupe inconnu ou non rendu est refusé', () => {
  const b = closable()
  const done = applyReport(b, { closed: [{ group: 'A', state: 'closed', sessionId: '00000000-0000-4000-8000-00000000abcd', branch: 'worktree-groupe-lot-A', worktree: '/p/.claude/worktrees/groupe-lot-A' }] }, 6_000, REPO)
  expect(groupOf(done.board, 'A').delegated!.closing).toEqual({ state: 'closed', at: 6_000, sessionId: '00000000-0000-4000-8000-00000000abcd', branch: 'worktree-groupe-lot-A', worktree: '/p/.claude/worktrees/groupe-lot-A' })
  expect(done.text).toContain('closed: group A noted closed')
  expect(applyReport(done.board, { note: 'point' }, 7_000, REPO).text).not.toContain('group A (Alpha)')
  const app = applyReport(b, { closed: [{ group: 'A', state: 'app', why: 'session local_A42 à archiver' }] }, 6_000, REPO).board
  const appText = applyReport(app, { note: 'point' }, 7_000, REPO).text
  expect(appText).not.toContain('Close now: group A')
  expect(appText).toContain('To archive in the app: group A (Alpha) — session local_A42 à archiver; once the user says it is archived, remove its worktree only by the closing procedure from its point 8 on')
  expect(appText).toContain('Then send {"closed": [{"group": "A", "state": "closed", "sessionId": "<full sessionId>"')
  // Puis fermé : plus rien.
  const after = applyReport(app, { closed: [{ group: 'A', state: 'closed' }] }, 8_000, REPO).board
  expect(applyReport(after, { note: 'point' }, 9_000, REPO).text).not.toContain('group A (Alpha)')
  const refused = applyReport(b, { closed: [{ group: 'C', state: 'closed' }, { group: 'Z', state: 'closed' }, { group: 'A', state: 'nope' }] }, 6_000, REPO)
  expect(refused.text).toContain('closed: refused for C (not returned by a linked session), Z (unknown group), A (state must be closed, app or stopped)')
  expect(groupOf(refused.board, 'A').delegated!.closing).toBeUndefined()
})

test('« stopped » retire le groupe de la liste jusqu’à un appel qui le touche (set, review, reviewed, security, returned)', () => {
  const stopped = applyReport(closable(), { closed: [{ group: 'A', state: 'stopped', why: 'fichier ignoré .env' }] }, 6_000, REPO).board
  const text = (board: Board, input: Record<string, unknown>, at: number) => applyReport(board, input, at, REPO).text
  expect(text(stopped, { note: 'point' }, 7_000)).not.toContain('Close now: group A')
  expect(text(stopped, { set: [{ id: 'b1', status: 'done' }] }, 7_000)).not.toContain('Close now: group A')
  for (const touch of [
    { set: [{ id: 'a1', status: 'done' }] },
    { review: { standards: 0, spec: 0, fixed: 0 } },
    { reviewed: ['A'] },
    { security: { group: 'A', findings: 1, fixed: 1 } },
    // Un groupe déjà rendu, renvoyé dans « returned » : refusé comme retour, il touche quand même sa fermeture.
    { returned: ['A'] },
  ]) {
    expect(text(stopped, touch, 7_000)).toContain('Close now: group A')
  }
})

test('l’état « closed » ne recule jamais : renvoi des groupes, nouvel envoi stopped ou app, fusion de copies', () => {
  const closed = applyReport(closable(), { closed: [{ group: 'A', state: 'closed' }] }, 6_000, REPO).board
  // Le plan renvoyé garde l'état.
  const resent = applyReport(closed, { groups: LOT.groups }, 7_000, REPO).board
  expect(groupOf(resent, 'A').delegated!.closing?.state).toBe('closed')
  // Un envoi stopped ou app après closed est refusé.
  const back = applyReport(resent, { closed: [{ group: 'A', state: 'stopped', why: 'x' }, { group: 'A', state: 'app' }] }, 8_000, REPO)
  expect(back.text).toContain('closed: refused for A (already closed: a closed group never goes back)')
  expect(groupOf(back.board, 'A').delegated!.closing?.state).toBe('closed')
  // Une copie plus ancienne ne le fait pas reculer, qu'elle soit stockée ou locale.
  const older = closable()
  expect(groupOf(mergeBoards(resent, older), 'A').delegated!.closing?.state).toBe('closed')
  const paused = { ...resent, runs: resent.runs.map(r => ({ ...r, status: 'paused' as const, updatedAt: 9_999_999 })) }
  const merged = mergeBoards(older, paused)
  expect(merged.runs[0]!.groups!.find(g => g.id === 'A')!.delegated!.closing?.state).toBe('closed')
})

test('« app » puis « closed » : sessionId, branche et worktree demandés et gardés ; un envoi sans eux garde les précédents', () => {
  const app = applyReport(closable(), { closed: [{ group: 'A', state: 'app', why: 'à archiver', sessionId: '00000000-0000-4000-8000-000000000001', branch: 'groupe-lot-A', worktree: '/p/.claude/worktrees/A' }] }, 6_000, REPO).board
  expect(groupOf(app, 'A').delegated!.closing).toMatchObject({ state: 'app', sessionId: '00000000-0000-4000-8000-000000000001', branch: 'groupe-lot-A', worktree: '/p/.claude/worktrees/A' })
  expect(applyReport(app, { note: 'point' }, 6_500, REPO).text).toContain('"state": "closed", "sessionId": "<full sessionId>", "branch": "<kept branch>", "worktree": "<removed worktree path>"}]} (the last three when known).')
  // Le retrait du worktree, une fois archivée, repasse par la procédure entière.
  expect(applyReport(app, { note: 'point' }, 6_500, REPO).text).toContain('remove its worktree only by the closing procedure from its point 8 on')
  const closed = applyReport(app, { closed: [{ group: 'A', state: 'closed' }] }, 7_000, REPO).board
  expect(groupOf(closed, 'A').delegated!.closing).toEqual({ state: 'closed', at: 7_000, sessionId: '00000000-0000-4000-8000-000000000001', branch: 'groupe-lot-A', worktree: '/p/.claude/worktrees/A' })
})

test('un groupe fermé puis confié de nouveau : pas « à fermer » pendant que sa nouvelle session travaille ; à son retour, la nouvelle se ferme et l’ancienne fermeture reste notée', () => {
  const closed = applyReport(closable(), { closed: [{ group: 'A', state: 'closed', sessionId: '00000000-0000-4000-8000-0000000000aa' }] }, 6_000, REPO).board
  // Un ticket du groupe rouvert : le groupe se confie de nouveau.
  const reopened = applyReport(closed, { set: [{ id: 'a1', status: 'todo' }] }, 6_100, REPO).board
  const again = startLinkedGroups(reopened, ['A'], 6_200)!.board
  expect(groupOf(again, 'A').linked).toBeDefined()
  const during = applyReport(again, { note: 'point' }, 6_300, REPO).text
  expect(during).not.toContain('Close now: group A')
  expect(during).not.toContain('Not closed yet: group A')
  // Rendu : une autre session, à fermer à son tour ; la fermeture de la précédente reste notée.
  const back = applyReport(again, { set: [{ id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'] }, 7_000, REPO)
  expect(groupOf(back.board, 'A').delegated!.closing).toBeUndefined()
  expect(groupOf(back.board, 'A').delegated!.earlier).toMatchObject([{ closing: { state: 'closed', sessionId: '00000000-0000-4000-8000-0000000000aa' } }])
  // La copie d'avant le retour, fusionnée sur celle d'après qui a pris la place : l'ancien lien reste fermé.
  const beforeReturn = { ...again, runs: again.runs.map(r => ({ ...r, status: 'paused' as const, updatedAt: 1 })) }
  expect(groupOf(mergeBoards(back.board, beforeReturn), 'A').delegated!.closing).toBeUndefined()
  expect(back.text).toContain('Close now: group A')
  // La fusion avec la copie d'avant ne remet pas l'ancien état sur le nouveau lien.
  expect(groupOf(mergeBoards(back.board, closed), 'A').delegated!.closing).toBeUndefined()
  // Une fermeture déjà notée revient d'une copie du même lien, même quand l'autre discussion a repris le parcours.
  const done = applyReport(back.board, { closed: [{ group: 'A', state: 'closed', sessionId: '00000000-0000-4000-8000-0000000000bb' }] }, 8_000, REPO).board
  const takenOver = { ...back.board, runs: back.board.runs.map(r => ({ ...r, owner: 'autre', status: 'active' as const, updatedAt: 9_000 })) }
  const merged = mergeBoards(done, takenOver)
  expect(merged.runs[0]!.groups!.find(g => g.id === 'A')!.delegated!.closing).toMatchObject({ state: 'closed', sessionId: '00000000-0000-4000-8000-0000000000bb' })
})

test('un groupe re-confié dont la session précédente n’est pas fermée : l’ancien lien reste, listé « à fermer », pendant la nouvelle session et après son retour', () => {
  // A rendu inachevé : sa session est rendue, pas fermée.
  const sent = startLinkedGroups(boardWith(LOT), ['A'], 3_000)!.board
  const short = applyReport(sent, { returned: ['A'] }, 4_000, REPO).board
  const first = groupOf(short, 'A').delegated!
  // Re-confié : la nouvelle session travaille, l'ancienne est à fermer.
  const again = startLinkedGroups(short, ['A'], 5_000)!.board
  const during = applyReport(again, { note: 'point' }, 5_100, REPO)
  expect(during.text).toContain('Close now: the previous linked session of group A (Alpha), replaced by a new send (sent at 1970-01-01 00:00 UTC):')
  expect(during.text).toContain(closingProcedure({ run: activeRun(during.board)!, target: { kind: 'group', id: 'A', name: 'Alpha' }, isRepo: true }))
  expect(during.text).toContain(`{"closed": [{"group": "A", "link": ${first.at}, "state": "closed"`)
  expect(during.text).not.toContain('Close now: group A (Alpha) is closed')
  // La nouvelle session qui travaille ne rend pas la précédente « active » : chacune a son relais.
  const runId = activeRun(again)!.id
  let relay: Relay = applyRelay(undefined, runId, 'fa', { kind: 'start', group: 'A' }, 3_100)!
  relay = applyRelay(relay, runId, 'fa', { kind: 'report', text: 'A rendu inachevé' }, 3_900)!
  relay = applyRelay(relay, runId, 'fb', { kind: 'start', group: 'A' }, 5_050)!
  relay = applyRelay(relay, runId, 'fb', { kind: 'note', text: 'au travail' }, 5_080)!
  expect(applyReport(again, { note: 'point' }, 5_100, { ...REPO, relay }).text).toContain('Close now: the previous linked session of group A (Alpha)')
  // La précédente qui reprend du travail après son compte rendu, elle, attend.
  const busy = applyRelay(relay, runId, 'fa', { kind: 'note', text: 'correctif' }, 4_500)!
  expect(applyReport(again, { note: 'point' }, 5_100, { ...REPO, relay: busy }).text).not.toContain('Close now: the previous linked session of group A (Alpha)')
  // Rendue de nouveau : l'ancien lien passe dans « earlier », toujours à fermer.
  const back = applyReport(again, { set: [{ id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false } }, 6_000, REPO)
  expect(groupOf(back.board, 'A').delegated!.earlier).toEqual([{ at: first.at }])
  expect(back.text).toContain('Close now: the previous linked session of group A (Alpha)')
  expect(back.text).toContain('Close now: group A (Alpha) is closed')
  // Fermée par son lien : notée sur l'ancien, le nouveau reste à fermer.
  const closedOld = applyReport(back.board, { closed: [{ group: 'A', link: first.at, state: 'closed', sessionId: '00000000-0000-4000-8000-0000000000aa' }] }, 6_100, REPO)
  expect(closedOld.text).toContain(`closed: previous session of group A (sent at ${first.at}) noted closed`)
  expect(groupOf(closedOld.board, 'A').delegated!.earlier).toEqual([{ at: first.at, closing: { state: 'closed', at: 6_100, sessionId: '00000000-0000-4000-8000-0000000000aa' } }])
  expect(groupOf(closedOld.board, 'A').delegated!.closing).toBeUndefined()
  const after = applyReport(closedOld.board, { note: 'point' }, 6_200, REPO).text
  expect(after).not.toContain('previous linked session of group A')
  expect(after).toContain('Close now: group A (Alpha) is closed')
  // « closed » ne recule pas, ni par un nouvel envoi, ni par une fusion avec la copie d'avant.
  expect(applyReport(closedOld.board, { closed: [{ group: 'A', link: first.at, state: 'stopped', why: 'x' }] }, 6_300, REPO).text).toContain('already closed')
  const older = { ...back.board, runs: back.board.runs.map(r => ({ ...r, status: 'paused' as const, updatedAt: 1 })) }
  // La copie active d'ici, d'avant la fermeture, l'emporte sur une copie stockée plus récente : la fermeture de l'ancien lien revient.
  const merged = mergeBoards(back.board, { ...closedOld.board, runs: closedOld.board.runs.map(r => ({ ...r, status: 'paused' as const, updatedAt: 99_999 })) })
  expect(merged.runs[0]!.groups!.find(g => g.id === 'A')!.delegated!.earlier![0]!.closing?.state).toBe('closed')
  expect(groupOf(mergeBoards(closedOld.board, older), 'A').delegated!.earlier![0]!.closing?.state).toBe('closed')
  // Un lien inconnu, ou illisible, est refusé : jamais posé sur le lien courant.
  expect(applyReport(back.board, { closed: [{ group: 'A', link: 1, state: 'closed' }] }, 6_400, REPO).text).toContain('closed: refused for A (no previous session sent at 1)')
  const unreadable = applyReport(back.board, { closed: [{ group: 'A', link: '1970-01-01 00:00', state: 'closed' }] }, 6_400, REPO)
  expect(unreadable.text).toContain('"link" must be the number given in the answer')
  expect(groupOf(unreadable.board, 'A').delegated!.closing).toBeUndefined()
  // Une session précédente arrêtée se relance sur un appel qui touche le groupe, même quand la fermeture courante ne l'est pas.
  const stoppedOld = applyReport(back.board, { closed: [{ group: 'A', link: first.at, state: 'stopped', why: 'commits pas fusionnés' }] }, 6_500, REPO).board
  expect(applyReport(stoppedOld, { note: 'point' }, 6_600, REPO).text).not.toContain('previous linked session of group A')
  expect(applyReport(stoppedOld, { security: { group: 'A', advised: false } }, 6_700, REPO).text).toContain('Close now: the previous linked session of group A (Alpha)')
})

test('un ticket rouvert dans un groupe rendu : pas « à fermer » ; une session terminée n’est plus active', () => {
  const reopened = applyReport(closable(), { set: [{ id: 'a1', status: 'doing' }] }, 6_000, REPO)
  expect(reopened.text).not.toContain('Close now: group A')
  const b = closable()
  const runId = activeRun(b)!.id
  let relay: Relay = applyRelay(undefined, runId, 'fa', { kind: 'start', group: 'A' }, 3_500)!
  relay = applyRelay(relay, runId, 'fa', { kind: 'report', text: 'A fait' }, 3_900)!
  relay = applyRelay(relay, runId, 'fa', { kind: 'note', text: 'correctif' }, 7_000)!
  relay = applyRelay(relay, runId, 'fa', { kind: 'end' }, 7_100)!
  expect(applyReport(b, { note: 'point' }, 7_500, { ...REPO, relay }).text).toContain('Close now: group A')
})

test('une session encore active : la réponse dit comment la débloquer', () => {
  const b = closable()
  const runId = activeRun(b)!.id
  let relay: Relay = applyRelay(undefined, runId, 'fa', { kind: 'start', group: 'A' }, 3_500)!
  relay = applyRelay(relay, runId, 'fa', { kind: 'report', text: 'A fait' }, 3_900)!
  relay = applyRelay(relay, runId, 'fa', { kind: 'note', text: 'correctif F1 commité' }, 7_000)!
  expect(applyReport(b, { note: 'point' }, 7_500, { ...REPO, relay }).text).toContain('ask it by SendMessage to leave its final report in the relay again')
})

test('dans une session liée déléguée, aucune section de fermeture', () => {
  const b = closable()
  const runId = activeRun(b)!.id
  const delegated = applyReport(b, { delegate: runId, group: 'B' }, 6_000, REPO).board
  const out = applyReport(delegated, { note: 'point' }, 6_100, REPO)
  expect(out.text).not.toContain('Close now')
  expect(out.text).not.toContain('Not closed yet')
  expect(applyReport(delegated, { closed: [{ group: 'A', state: 'closed' }] }, 6_200, REPO).text).not.toContain('noted closed')
})

const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'main' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('tool.call', { tool: START }, (_$: unknown, e: { title: string }) => ({
    result: { text: `Started session local_${/Groupe (\w+)/.exec(e.title)?.[1] ?? 'x'}42.` },
  }))
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return { mem, filled }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

test('la ligne d’un groupe rendu et relu : rien tant que rien n’est tenté, puis fermé, à archiver, ou arrêté avec « ↻ Relancer la fermeture »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 93_000_000 })
  const { mem, filled } = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  // Le texte de délégation demande la fermeture après le retour.
  expect(filled.at(-1)).toContain('Enfin, un groupe clos (« Close now » dans la réponse de l’outil) se ferme selon sa procédure, puis {"closed": [...]}.')
  await $.tool.call({ tool: START, title: 'Boutique > Groupe A · Alpha' } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false, why: 'texte seul' } } as any)
  const rendered = async (surface: 'terminal' | 'desktop') => {
    for (let i = 0; i < 6; i++) await clock.advance(1000)
    const u = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    const found = {
      button: await u.find({ key: 'close-linked-A' }),
      closed: await u.find({ type: 'Text', text: /session et worktree fermés/ }),
      app: await u.find({ type: 'Text', text: /à archiver dans l.app/ }),
      stopped: await u.find({ type: 'Text', text: /fermeture arrêtée : fichier ignoré \.env/ }),
    }
    return { u, ...found }
  }
  // Rien tant que rien n'a été tenté : plus de bouton « ✕ Fermer… ».
  let r = await rendered('terminal')
  expect(r.button).toBeUndefined()
  expect(r.closed ?? r.app ?? r.stopped).toBeUndefined()
  await r.u.unmount()
  // Arrêtée : la raison et le bouton de repli, qui remplit le prompt avec la procédure.
  await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'stopped', why: 'fichier ignoré .env' }] } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    r = await rendered(surface)
    expect(r.stopped).toBeDefined()
    expect(String(r.button?.props?.label)).toMatch(/^↻.Relancer la fermeture$/)
    await r.u.unmount()
  }
  r = await rendered('terminal')
  await r.u.press({ key: 'close-linked-A' })
  await r.u.unmount()
  const run = (mem['board:'] as Board).runs.find(x => x.title === 'Boutique')!
  expect(filled.at(-1)).toContain(closingProcedure({ run, target: { kind: 'group', id: 'A', name: 'Alpha' }, isRepo: true, session: 'local_A42' }))
  expect(filled.at(-1)).toContain('{"closed": [{"group": "A", "state": "closed"')
  // Le clic relance la fermeture : la réponse suivante la repropose.
  expect(JSON.stringify(await $.tool.call({ tool: TOOL, note: 'point' } as any))).toContain('Close now: group A')
  // À archiver dans l'app, puis fermée.
  await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'app', why: 'session de l’app' }] } as any)
  r = await rendered('terminal')
  expect(r.app).toBeDefined()
  expect(r.button).toBeUndefined()
  await r.u.unmount()
  await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'closed', sessionId: '00000000-0000-4000-8000-0000000000c1' }] } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    r = await rendered(surface)
    expect(r.closed).toBeDefined()
    expect(r.button).toBeUndefined()
    await r.u.unmount()
  }
  // Le groupe repart (un ticket rouvert) : son deuxième envoi a son propre worktree, -2 ; le premier gardait le nom seul.
  expect(filled.find(t => t.startsWith('Confie ce groupe'))).toContain("-w 'groupe-boutique-<id>' (un worktree à elle)")
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'todo' }] } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const u = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await u.press({ key: 'launch-linked-A' })
  await u.unmount()
  const second = filled.at(-1)!
  expect(second).toContain('Worktree et branche de cet envoi : groupe-boutique-A-2 (2e envoi du groupe A : les noms des envois précédents restent pris), à la place de groupe-boutique-A ; titre : « Boutique > Groupe A (envoi 2) · <thème> »')
})

test('les envois d’un groupe sont numérotés : le premier garde son nom, les suivants -2, -3 ; la procédure reconnaît le nom de chaque envoi', () => {
  // Premier envoi : pas de numéro.
  const sent = startLinkedGroups(boardWith(LOT), ['A'], 3_000)!.board
  expect(groupOf(sent, 'A').linked).toEqual({ at: 3_000 })
  const short = applyReport(sent, { returned: ['A'] }, 4_000, REPO).board
  const again = startLinkedGroups(applyReport(short, { set: [{ id: 'a1', status: 'todo' }] }, 4_100, REPO).board, ['A'], 5_000)!.board
  expect(groupOf(again, 'A').linked).toEqual({ at: 5_000, seq: 2 })
  // La précédente se ferme sous son nom à elle ; la nouvelle, rendue, sous le sien.
  const during = applyReport(again, { note: 'point' }, 5_100, REPO).text
  expect(during).toContain('worktree-groupe-lot-A (lancée par le CLI), groupe-lot-A ou claude/groupe-lot-A-<suffixe>')
  const back = applyReport(again, { set: [{ id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false } }, 6_000, REPO)
  expect(groupOf(back.board, 'A').delegated).toMatchObject({ at: 5_000, seq: 2, earlier: [{ at: 3_000 }] })
  expect(back.text).toContain('worktree-groupe-lot-A-2 (lancée par le CLI), groupe-lot-A-2 ou claude/groupe-lot-A-2-<suffixe>')
  // Troisième envoi : -3, même quand la deuxième est fermée.
  const closed = applyReport(back.board, { closed: [{ group: 'A', state: 'closed' }] }, 6_100, REPO).board
  const third = startLinkedGroups(applyReport(closed, { set: [{ id: 'a1', status: 'todo' }] }, 6_200, REPO).board, ['A'], 7_000)!.board
  expect(groupOf(third, 'A').linked).toEqual({ at: 7_000, seq: 3 })
  // Pendant le troisième, la deuxième (arrêtée, relancée) se ferme sous son nom et son titre à elle.
  const stopped2 = applyReport(back.board, { closed: [{ group: 'A', state: 'stopped', why: 'x' }] }, 6_100, REPO).board
  const third2 = startLinkedGroups(applyReport(stopped2, { set: [{ id: 'a1', status: 'todo' }] }, 6_200, REPO).board, ['A'], 7_000)!.board
  const during3 = applyReport(third2, { reviewed: ['A'] }, 7_100, REPO).text
  expect(during3).toContain('Close now: the previous linked session of group A (Alpha)')
  expect(during3).toContain('worktree-groupe-lot-A-2 (lancée par le CLI)')
  expect(during3).toContain('« Lot > Groupe A (envoi 2) · »')
  expect(applyReport(third, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 8_000, REPO).board.runs[0]!.groups!.find(g => g.id === 'A')!.delegated!.earlier).toMatchObject([{ at: 3_000 }, { at: 5_000, seq: 2 }])
})

test('le numéro d’envoi d’un groupe ne recule jamais : un envoi annulé le garde, un plan renvoyé aussi ; un numéro illisible ne sert pas', () => {
  const first = startLinkedGroups(boardWith(LOT), ['A'], 3_000)!.board
  // Annulé avant le lancement : le numéro 1 est pris ; le suivant prend 2.
  const cancelled = cancelLinkedGroup(first, 'A', 3_100)!.board
  const again = startLinkedGroups(cancelled, ['A'], 3_200)!.board
  expect(groupOf(again, 'A').linked).toEqual({ at: 3_200, seq: 2 })
  // Le plan renvoyé garde le compteur.
  const resent = applyReport(cancelLinkedGroup(again, 'A', 3_300)!.board, { groups: LOT.groups }, 3_400, REPO).board
  expect(groupOf(startLinkedGroups(resent, ['A'], 3_500)!.board, 'A').linked).toEqual({ at: 3_500, seq: 3 })
  // Un numéro illisible (fichier partagé) ne nomme rien.
  expect(groupWorktree(activeRun(first)!, 'A', Number.NaN)).toBe('groupe-lot-A')
  expect(groupWorktree(activeRun(first)!, 'A', 2.5)).toBe('groupe-lot-A')
})
