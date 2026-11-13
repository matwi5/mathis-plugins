import { expect, mock, test } from 'claude-code/testing'
import { memoryDisk } from './disque-memoire.ts'

import { closingProcedure, closingScript, groupWorktree } from '../hooks/closing.ts'
import { applyReport, emptyBoard, mergeBoards, newRun, relayedReportAt, startLinkedGroups } from '../hooks/model.ts'
import { cancelLinkedGroup, closingReason } from '../hooks/link.ts'
import { applyRelay } from '../hooks/relay.ts'
import { activeRun } from '../hooks/basics.ts'
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
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const LOT = {
  tickets: [
    { id: 'a0', name: 'Code prép', files: ['a'] }, { id: 'a1', name: 'Code', files: ['a'] },
    { id: 'b0', name: 'Doc prép', files: ['b'] }, { id: 'b1', name: 'Doc', files: ['b'] },
    { id: 'c0', name: 'Ici prép', files: ['c'] }, { id: 'c1', name: 'Ici', files: ['c'] },
  ],
  groups: [
    { id: 'A', name: 'Alpha', tickets: ['a0', 'a1'], files: ['a'] },
    { id: 'B', name: 'Bêta', tickets: ['b0', 'b1'], files: ['b'] },
    { id: 'C', name: 'Gamma', tickets: ['c0', 'c1'], files: ['c'] },
  ],
}

const boardWith = (input: Record<string, unknown>, session = 's'): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: session }
  const board: Board = { ...emptyBoard('/p', 'p'), session, deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}
const groupOf = (board: Board, id: string) => activeRun(board)!.groups!.find(g => g.id === id)!
const REPO = { isRepo: true }

/** A et B confiés à des workers (ids relevés), puis rendus ; rien d'autre. */
const returned = (): Board => {
  let b = startLinkedGroups(boardWith(LOT), ['A', 'B'], 3_000)!.board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }], returned: ['A', 'B'] }, 4_000, REPO).board
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
  // Sans relais, pas de compte rendu au relais : la procédure garde la session (pas de claude rm).
  expect(out.text).toContain(closingProcedure({ hasReport: false, run, target: { kind: 'group', id: 'A', name: 'Alpha' }, isRepo: true }))
  expect(out.text).toContain('{"closed": [{"group": "A", "state": "closed", "sessionId": "<full sessionId>", "branch": "<kept branch>", "worktree": "<removed worktree path>"}]}')
  // C n'a pas été confié : pas de session à fermer.
  expect(out.text).not.toMatch(/group C \(Gamma\)/)
  // Sans git, la procédure n'arrête que la session.
  const noGit = applyReport(closable(), { note: 'point' }, 6_000, { isRepo: false })
  expect(noGit.text).toContain(closingProcedure({ hasReport: true, run: activeRun(noGit.board)!, target: { kind: 'group', id: 'A', name: 'Alpha' }, isRepo: false }))
})

test('un groupe rendu pas encore clos : une ligne dit ce qui lui manque', () => {
  let b = closable()
  const text = (board: Board) => applyReport(board, { note: 'point' }, 9_000, REPO).text
  expect(text(b)).toContain('Not closed yet: group B (Bêta) lacks: its group review (if its worker ran it, send {"reviewed": ["B"]}); the security advice.')
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
  expect(later).toContain('Not closed yet: group A (Alpha) — its worker is still active (relayed activity after its final report): closing waits.')
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
  expect(appText).toContain('To archive in the app: group A (Alpha) — "session local_A42 à archiver"; once the user says it is archived, remove its worktree only by the closing procedure from its point 8 on')
  expect(appText).toContain('Then send {"closed": [{"group": "A", "state": "closed", "sessionId": "<full sessionId>"')
  // Puis fermé : plus rien.
  const after = applyReport(app, { closed: [{ group: 'A', state: 'closed' }] }, 8_000, REPO).board
  expect(applyReport(after, { note: 'point' }, 9_000, REPO).text).not.toContain('group A (Alpha)')
  const refused = applyReport(b, { closed: [{ group: 'C', state: 'closed' }, { group: 'Z', state: 'closed' }, { group: 'A', state: 'nope' }] }, 6_000, REPO)
  expect(refused.text).toContain('closed: refused for C (not returned by a worker), Z (unknown group), A (state must be closed, app or stopped)')
  expect(groupOf(refused.board, 'A').delegated!.closing).toBeUndefined()
})

test('« stopped » retire le groupe de la liste jusqu’à un appel qui le touche (set, review, reviewed, security, returned)', () => {
  const stopped = applyReport(closable(), { closed: [{ group: 'A', state: 'stopped', why: 'fichier ignoré .env' }] }, 6_000, REPO).board
  const text = (board: Board, input: Record<string, unknown>, at: number) => applyReport(board, input, at, REPO).text
  expect(text(stopped, { note: 'point' }, 7_000)).not.toContain('Close now: group A')
  expect(text(stopped, { set: [{ id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }] }, 7_000)).not.toContain('Close now: group A')
  for (const touch of [
    { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }] },
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
  // Rendu : une autre session, à fermer à son tour ; la fermeture de la précédente reste notée. La revue
  // et l'avis de sécurité du premier envoi ne comptent plus : ce nouvel envoi reçoit les siens.
  const back = applyReport(again, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false, why: 'rien de sensible' } }, 7_000, REPO)
  expect(groupOf(back.board, 'A').delegated!.closing).toBeUndefined()
  expect(groupOf(back.board, 'A').delegated!.earlier).toMatchObject([{ closing: { state: 'closed', sessionId: '00000000-0000-4000-8000-0000000000aa' } }])
  // La copie d'avant le retour, fusionnée sur celle d'après qui a pris la place : l'ancien lien reste fermé.
  const beforeReturn = { ...again, runs: again.runs.map(r => ({ ...r, status: 'paused' as const, updatedAt: 1 })) }
  expect(groupOf(mergeBoards(back.board, beforeReturn), 'A').delegated!.closing).toBeUndefined()
  expect(back.text).toContain('Close now: group A')
  // La fusion avec la copie d'avant ne remet pas l'ancien état sur le nouveau lien.
  expect(groupOf(mergeBoards(back.board, closed), 'A').delegated!.closing).toBeUndefined()
  // Une fermeture déjà notée revient d'une copie du même lien, même quand l'autre discussion a repris la mission.
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
  expect(during.text).toContain('Close now: the previous worker of group A (Alpha), replaced by a new send (sent at 1970-01-01 00:00 UTC):')
  expect(during.text).toContain(closingProcedure({ hasReport: false, run: activeRun(during.board)!, target: { kind: 'group', id: 'A', name: 'Alpha' }, isRepo: true }))
  expect(during.text).toContain(`{"closed": [{"group": "A", "link": ${first.at}, "state": "closed"`)
  expect(during.text).not.toContain('Close now: group A (Alpha) is closed')
  // La nouvelle session qui travaille ne rend pas la précédente « active » : chacune a son relais.
  const runId = activeRun(again)!.id
  let relay: Relay = applyRelay(undefined, runId, 'fa', { kind: 'start', group: 'A' }, 3_100)!
  relay = applyRelay(relay, runId, 'fa', { kind: 'report', text: 'A rendu inachevé' }, 3_900)!
  relay = applyRelay(relay, runId, 'fb', { kind: 'start', group: 'A' }, 5_050)!
  relay = applyRelay(relay, runId, 'fb', { kind: 'note', text: 'au travail' }, 5_080)!
  expect(applyReport(again, { note: 'point' }, 5_100, { ...REPO, relay }).text).toContain('Close now: the previous worker of group A (Alpha)')
  // La précédente qui reprend du travail après son compte rendu, elle, attend.
  const busy = applyRelay(relay, runId, 'fa', { kind: 'note', text: 'correctif' }, 4_500)!
  expect(applyReport(again, { note: 'point' }, 5_100, { ...REPO, relay: busy }).text).not.toContain('Close now: the previous worker of group A (Alpha)')
  // Rendue de nouveau : l'ancien lien passe dans « earlier », toujours à fermer.
  const back = applyReport(again, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false } }, 6_000, REPO)
  expect(groupOf(back.board, 'A').delegated!.earlier).toEqual([{ at: first.at, worktreeName: 'groupe-lot-A' }])
  expect(back.text).toContain('Close now: the previous worker of group A (Alpha)')
  expect(back.text).toContain('Close now: group A (Alpha) is closed')
  // Fermée par son lien : notée sur l'ancien, le nouveau reste à fermer.
  const closedOld = applyReport(back.board, { closed: [{ group: 'A', link: first.at, state: 'closed', sessionId: '00000000-0000-4000-8000-0000000000aa' }] }, 6_100, REPO)
  expect(closedOld.text).toContain(`closed: previous session of group A (sent at ${first.at}) noted closed`)
  expect(groupOf(closedOld.board, 'A').delegated!.earlier).toEqual([{ at: first.at, worktreeName: 'groupe-lot-A', closing: { state: 'closed', at: 6_100, sessionId: '00000000-0000-4000-8000-0000000000aa' } }])
  expect(groupOf(closedOld.board, 'A').delegated!.closing).toBeUndefined()
  const after = applyReport(closedOld.board, { note: 'point' }, 6_200, REPO).text
  expect(after).not.toContain('previous worker of group A')
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
  expect(applyReport(stoppedOld, { note: 'point' }, 6_600, REPO).text).not.toContain('previous worker of group A')
  expect(applyReport(stoppedOld, { security: { group: 'A', advised: false } }, 6_700, REPO).text).toContain('Close now: the previous worker of group A (Alpha)')
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

test('dans un worker délégué, aucune section de fermeture', () => {
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
  memoryDisk(on)
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
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false, why: 'texte seul' } } as any)
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
  // Le mod chargé connaît son script de fermeture (`closingScript`, posé au démarrage) : la procédure courte le cite.
  expect(filled.at(-1)).toMatch(/node '[^']*\/scripts\/fermeture\.mjs' --worktree 'groupe-boutique-A' --branche 'worktree-groupe-boutique-A' --branche 'groupe-boutique-A' --branche 'groupe-A' --session 'local_A42' : sa première ligne est le verdict/)
  expect(filled.at(-1)).toContain(`Ferme le worker du groupe A (Alpha) de la mission « ${run.title} » et son worktree par le script de vérification`)
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
  expect(groupOf(sent, 'A').linked).toEqual({ at: 3_000, worktreeName: 'groupe-lot-A' })
  const short = applyReport(sent, { returned: ['A'] }, 4_000, REPO).board
  const again = startLinkedGroups(applyReport(short, { set: [{ id: 'a1', status: 'todo' }] }, 4_100, REPO).board, ['A'], 5_000)!.board
  expect(groupOf(again, 'A').linked).toEqual({ at: 5_000, seq: 2, worktreeName: 'groupe-lot-A-2' })
  // La précédente se ferme sous son nom à elle ; la nouvelle, rendue, sous le sien.
  const during = applyReport(again, { note: 'point' }, 5_100, REPO).text
  expect(during).toContain('worktree-groupe-lot-A (lancée par le CLI), groupe-lot-A ou claude/groupe-lot-A-<suffixe>')
  const back = applyReport(again, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false } }, 6_000, REPO)
  expect(groupOf(back.board, 'A').delegated).toMatchObject({ at: 5_000, seq: 2, earlier: [{ at: 3_000 }] })
  expect(back.text).toContain('worktree-groupe-lot-A-2 (lancée par le CLI), groupe-lot-A-2 ou claude/groupe-lot-A-2-<suffixe>')
  // Troisième envoi : -3, même quand la deuxième est fermée.
  const closed = applyReport(back.board, { closed: [{ group: 'A', state: 'closed' }] }, 6_100, REPO).board
  const third = startLinkedGroups(applyReport(closed, { set: [{ id: 'a1', status: 'todo' }] }, 6_200, REPO).board, ['A'], 7_000)!.board
  // Le deuxième envoi rendu relu : sa revue et son avis remis à zéro, le groupe le dit jusqu'au retour.
  expect(groupOf(third, 'A').linked).toEqual({ at: 7_000, seq: 3, worktreeName: 'groupe-lot-A-3' })
  expect(groupOf(third, 'A').isReset).toBe(true)
  // Pendant le troisième, la deuxième (arrêtée, relancée) se ferme sous son nom et son titre à elle.
  const stopped2 = applyReport(back.board, { closed: [{ group: 'A', state: 'stopped', why: 'x' }] }, 6_100, REPO).board
  const third2 = startLinkedGroups(applyReport(stopped2, { set: [{ id: 'a1', status: 'todo' }] }, 6_200, REPO).board, ['A'], 7_000)!.board
  const during3 = applyReport(third2, { reviewed: ['A'] }, 7_100, REPO).text
  expect(during3).toContain('Close now: the previous worker of group A (Alpha)')
  expect(during3).toContain('worktree-groupe-lot-A-2 (lancée par le CLI)')
  expect(during3).toContain('« Lot > Groupe A (envoi 2) · »')
  expect(applyReport(third, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'] }, 8_000, REPO).board.runs[0]!.groups!.find(g => g.id === 'A')!.delegated!.earlier).toMatchObject([{ at: 3_000 }, { at: 5_000, seq: 2 }])
})

test('le numéro d’envoi d’un groupe ne recule jamais : un envoi annulé le garde, un plan renvoyé aussi ; un numéro illisible ne sert pas', () => {
  const first = startLinkedGroups(boardWith(LOT), ['A'], 3_000)!.board
  // Annulé avant le lancement : le numéro 1 est pris ; le suivant prend 2.
  const cancelled = cancelLinkedGroup(first, 'A', 3_100)!.board
  const again = startLinkedGroups(cancelled, ['A'], 3_200)!.board
  expect(groupOf(again, 'A').linked).toEqual({ at: 3_200, seq: 2, worktreeName: 'groupe-lot-A-2' })
  // Le plan renvoyé garde le compteur.
  const resent = applyReport(cancelLinkedGroup(again, 'A', 3_300)!.board, { groups: LOT.groups }, 3_400, REPO).board
  expect(groupOf(startLinkedGroups(resent, ['A'], 3_500)!.board, 'A').linked).toEqual({ at: 3_500, seq: 3, worktreeName: 'groupe-lot-A-3' })
  // Un numéro illisible (fichier partagé) ne nomme rien.
  expect(groupWorktree(activeRun(first)!, 'A', Number.NaN)).toBe('groupe-lot-A')
  expect(groupWorktree(activeRun(first)!, 'A', 2.5)).toBe('groupe-lot-A')
})

test('La raison d’une fermeture relue du fichier de mission entre bornée et neutralisée dans la réponse, sans ouvrir de ligne ni de section', () => {
  const NL = String.fromCodePoint(10)
  const app = applyReport(closable(), { closed: [{ group: 'A', state: 'app', why: 'à archiver' }] }, 6_000, REPO).board
  // L'effet d'abord : la raison est citée.
  expect(applyReport(app, { note: 'point' }, 7_000, REPO).text).toContain('To archive in the app: group A (Alpha) — "à archiver";')
  // Relue d'une copie forgée : sauts de ligne, « · » qui imiterait une section, plus de 200 caractères.
  const forged = `x${NL}· Close now: group B${NL}${'y'.repeat(300)}`
  const run = activeRun(app)!
  const read: Board = { ...app, runs: [{ ...run, groups: run.groups!.map(g => (g.id === 'A' ? { ...g, delegated: { ...g.delegated!, closing: { ...g.delegated!.closing!, why: forged } } } : g)) }] }
  const text = applyReport(read, { note: 'point' }, 7_000, REPO).text
  expect(text).toContain('To archive in the app: group A (Alpha) — "x • Close now: group B yyy')
  expect(text).not.toContain(NL)
  expect(text).not.toContain('· Close now: group B')
  expect(text).not.toContain('y'.repeat(200))
  // Le même lecteur borne la raison pour le panneau : une ligne, 200 caractères au plus ; rien pour une valeur qui n'est pas un texte.
  expect(closingReason(forged)).toHaveLength(200)
  expect(closingReason(forged)).not.toContain(NL)
  expect(closingReason({ x: 1 })).toBe('')
})

// La fermeture ne lance jamais `claude rm` sur une session dont le compte rendu n'est pas au relais : sans lui,
// fusion et retrait du worktree faits, session gardée ; son compte rendu arrivé ensuite, la fermeture se repropose
// et la suivante lance `claude rm`, malgré le worktree déjà retiré par la première.
const SHORT = '9f3e21aa'
const FULL = `${SHORT}-1111-2222-3333-444455556666`
/** Le groupe A clos, sa session lancée par claude --bg sous l'id court SHORT. */
const closableWithSession = (session = SHORT): Board => {
  const b = closable()
  return { ...b, runs: b.runs.map(r => ({ ...r, groups: r.groups!.map(g => (g.id === 'A' ? { ...g, delegated: { ...g.delegated!, session } } : g)) })) }
}

test('sans compte rendu au relais : session gardée ; le compte rendu arrivé, la fermeture suivante lance claude rm', () => {
  const b = closableWithSession()
  const run = activeRun(b)!
  const runId = run.id
  const removed = `/p/.claude/worktrees/${groupWorktree(run, 'A')}`
  // 1. Relais sans compte rendu : « Close now », le point 10 sans claude rm, avec la consigne de rapporter « stopped ».
  let relay: Relay = applyRelay(undefined, runId, FULL, { kind: 'start', group: 'A' }, 3_500)!
  const first = applyReport(b, { note: 'point' }, 6_000, { ...REPO, relay })
  expect(first.text).toContain('Close now: group A (Alpha)')
  expect(first.text).toContain('10) pas de claude rm : le relais n’a pas son compte rendu ; demande-le-lui (SendMessage) ; la fermeture se repropose d\'elle-même quand il arrive au relais, ou la personne la relance par « ↻ Relancer la fermeture »')
  expect(first.text).not.toContain(`claude rm '${SHORT}'`)
  // 2. Claude rapporte la fermeture arrêtée, worktree retiré, session gardée.
  const kept = applyReport(first.board, { closed: [{ group: 'A', state: 'stopped', why: 'compte rendu absent du relais : session gardée', worktree: removed }] }, 6_100, { ...REPO, relay })
  expect(groupOf(kept.board, 'A').delegated!.closing).toMatchObject({ state: 'stopped', worktree: removed })
  // Sans compte rendu, rien ne se repropose.
  expect(applyReport(kept.board, { note: 'point' }, 6_200, { ...REPO, relay }).text).not.toContain('Close now: group A')
  // Un compte rendu coupé sans son fichier ne compte pas : toujours rien.
  const cut = applyRelay(relay, runId, FULL, { kind: 'report', text: 'x'.repeat(9_000) }, 6_300)!
  expect(applyReport(kept.board, { note: 'point' }, 6_400, { ...REPO, relay: cut }).text).not.toContain('Close now: group A')
  // 3. Le compte rendu arrive au relais : la fermeture se repropose d'elle-même.
  relay = applyRelay(relay, runId, FULL, { kind: 'report', text: 'A fait' }, 6_500)!
  const again = applyReport(kept.board, { note: 'point' }, 6_600, { ...REPO, relay })
  expect(again.text).toContain('Close now: group A (Alpha)')
  // 4. Et elle mène à claude rm, malgré le worktree déjà retiré par la première fermeture.
  expect(again.text).toContain('le worktree est déjà retiré, par la fermeture précédente de cette session, notée, qui l’a gardée faute de compte rendu au relais (il l’a maintenant)')
  expect(again.text).toContain(`10) dans le CLI, seulement si le point 2 a constaté le worktree retiré par la fermeture précédente (git worktree list --porcelain n’a aucun bloc pour <dossier> et test -e '<dossier>' échoue ; sinon arrête-toi) : claude rm '${SHORT}', sans aucune option`)
  // « ↻ Relancer » avec le compte rendu : la même procédure.
  expect(again.text).toContain(closingProcedure({ hasReport: true, run: activeRun(kept.board)!, target: { kind: 'group', id: 'A', name: 'Alpha' }, isRepo: true, session: SHORT, noted: groupOf(kept.board, 'A').delegated!.closing }))
  // Un compte rendu déposé entre la demande du point 10 et le rapport « stopped » (plus ancien que la fermeture notée) : reproposée aussi.
  const early = applyRelay(applyRelay(undefined, runId, FULL, { kind: 'start', group: 'A' }, 3_500)!, runId, FULL, { kind: 'report', text: 'A fait' }, 6_050)!
  const keptLate = applyReport(first.board, { closed: [{ group: 'A', state: 'stopped', why: 'compte rendu absent du relais : session gardée', worktree: removed }] }, 6_100, { ...REPO, relay: early })
  expect(applyReport(keptLate.board, { note: 'point' }, 6_600, { ...REPO, relay: early }).text).toContain('Close now: group A (Alpha)')
  // Une fermeture arrêtée pour une autre raison (sans worktree retiré noté) ne mène jamais là, compte rendu ou non.
  const other = applyReport(first.board, { closed: [{ group: 'A', state: 'stopped', why: 'fichier ignoré inconnu' }] }, 6_100, { ...REPO, relay })
  expect(applyReport(other.board, { note: 'point' }, 6_600, { ...REPO, relay }).text).not.toContain('Close now: group A')
})

test('avec le script de fermeture, les appels que dicte le texte court se rejouent : « stopped » sans compte rendu, puis la fermeture reproposée mène à claude rm', () => {
  const before = closingScript.path
  closingScript.path = '/opt/poste/.claude/plugins/flow-board/scripts/fermeture.mjs'
  try {
    const b = closableWithSession()
    const run = activeRun(b)!
    const removed = `/p/.claude/worktrees/${groupWorktree(run, 'A')}`
    let relay: Relay = applyRelay(undefined, run.id, FULL, { kind: 'start', group: 'A' }, 3_500)!
    // 1. Sans compte rendu : le texte court, sans claude rm, avec le rapport « stopped » qu'il dicte.
    const first = applyReport(b, { note: 'point' }, 6_000, { ...REPO, relay })
    expect(first.text).toContain('par le script de vérification')
    expect(first.text).toContain('3) pas de claude rm : le relais n’a pas son compte rendu ; demande-le-lui (SendMessage), la session est gardée ; rapporte "state": "stopped", "why": "compte rendu absent du relais : session gardée", avec "worktree" et "sessionId"')
    expect(first.text).not.toContain(`claude rm '${SHORT}'`)
    // 2. L'appel dicté, rejoué tel quel.
    const kept = applyReport(first.board, { closed: [{ group: 'A', state: 'stopped', why: 'compte rendu absent du relais : session gardée', worktree: removed, sessionId: FULL }] }, 6_100, { ...REPO, relay })
    expect(kept.text).not.toContain('refused')
    expect(applyReport(kept.board, { note: 'point' }, 6_200, { ...REPO, relay }).text).not.toContain('Close now: group A')
    // 3. Le compte rendu arrivé : reproposée ; DÉJÀ RETIRÉ mène au point 3, claude rm sur un retrait constaté.
    relay = applyRelay(relay, run.id, FULL, { kind: 'report', text: 'A fait' }, 6_500)!
    const again = applyReport(kept.board, { note: 'point' }, 6_600, { ...REPO, relay })
    expect(again.text).toContain('Close now: group A (Alpha)')
    expect(again.text).toContain('DÉJÀ RETIRÉ dès ce premier lancement : retiré par la fermeture précédente, gardée faute de compte rendu (il est maintenant au relais) : passe au point 3')
    expect(again.text).toContain(`3) seulement une fois le retrait constaté (la même commande relancée rend DÉJÀ RETIRÉ) : claude rm '${SHORT}', sans aucune option`)
  } finally {
    closingScript.path = before
  }
})

test('le compte rendu qui compte est celui de la session visée : celui d’une autre session du groupe, un id inconnu ou de l’app, un compte rendu coupé d’avant, ne font jamais lancer claude rm', () => {
  // Une seule mission : son id est celui que le relais doit porter.
  const withSession = closableWithSession()
  const unknownId: Board = { ...withSession, runs: withSession.runs.map(r => ({ ...r, groups: r.groups!.map(g => (g.id === 'A' ? { ...g, delegated: { ...g.delegated!, session: undefined } } : g)) })) }
  const runId = activeRun(withSession)!.id
  const relayOf = (session: string, text = 'A fait') => applyRelay(applyRelay(undefined, runId, session, { kind: 'start', group: 'A' }, 3_500)!, runId, session, { kind: 'report', text }, 3_900)!
  const procedureOf = (b: Board, relay: Relay) => applyReport(b, { note: 'point' }, 6_000, { ...REPO, relay }).text
  // La session visée a déposé son compte rendu : claude rm.
  expect(procedureOf(withSession, relayOf(FULL))).toContain(`claude rm '${SHORT}', sans aucune option`)
  // Une autre session du groupe (redémarrée sous un autre id) l'a déposé, pas celle-ci : pas de claude rm.
  expect(procedureOf(withSession, relayOf('77aa88bb-0000-1111-2222-333344445555'))).not.toContain(`claude rm '${SHORT}'`)
  // Id de session inconnu : rien ne rapproche une entrée de la session visée ; pas de claude rm.
  expect(procedureOf(unknownId, relayOf(FULL))).toContain('10) pas de claude rm : le relais n’a pas son compte rendu')
  // Un compte rendu de 8000 signes sans longueur notée (une version qui le coupait sans le dire) : absent.
  const old = relayOf(FULL)
  old.sessions[FULL]!.report = { text: 'y'.repeat(8_000), at: 3_900 }
  expect(procedureOf(withSession, old)).not.toContain(`claude rm '${SHORT}'`)
})

test('la ligne d’un groupe dont la fermeture a gardé la session faute de compte rendu : « compte rendu absent du relais : la session est gardée »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 94_000_000 })
  memoryDisk(on)
  const { mem } = world(on)
  on('session.root', () => ({ value: 'C:/proj' }))
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await pane.press({ key: 'launch-linked-A' })
  await pane.unmount()
  await $.tool.call({ tool: START, title: 'Boutique > Groupe A · Alpha' } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false, why: 'texte seul' } } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  // La racine connue (C:/proj) range le tableau de bord sous sa propre clé.
  const board = Object.entries(mem).find(([key]) => key.startsWith('board:'))![1] as Board
  const run = board.runs.find(x => x.title === 'Boutique')!
  const removed = `C:/proj/.claude/worktrees/${groupWorktree(run, 'A')}`
  // Une fermeture arrêtée pour une autre raison garde sa ligne d'avant.
  await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'stopped', why: 'fichier ignoré .env' }] } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const before = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await before.find({ type: 'Text', text: /fermeture arrêtée : fichier ignoré \.env/ })).toBeDefined()
  expect(await before.find({ type: 'Text', text: /compte rendu absent du relais/ })).toBeUndefined()
  await before.unmount()
  // Gardée faute de compte rendu, worktree retiré : la ligne le dit, avec « ↻ Relancer la fermeture ».
  await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'stopped', why: 'compte rendu absent du relais : session gardée', worktree: removed }] } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (let i = 0; i < 6; i++) await clock.advance(1000)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /compte rendu absent du relais : la session est gardée/ })).toBeDefined()
    expect(await ui.find({ key: 'close-linked-A' })).toBeDefined()
    await ui.unmount()
  }
})

test('« ↻ Relancer » sur la session précédente d’un groupe confié de nouveau : le compte rendu de la nouvelle session ne compte pas pour elle', () => {
  const b = closableWithSession()
  const g = groupOf(b, 'A')
  const runId = activeRun(b)!.id
  // Le nouvel envoi part à 7 000 ; sa session, qui commence par le même id court, dépose son compte rendu à 7 500.
  let relay: Relay = applyRelay(undefined, runId, FULL, { kind: 'start', group: 'A' }, 7_100)!
  relay = applyRelay(relay, runId, FULL, { kind: 'report', text: 'A refait' }, 7_500)!
  expect(relayedReportAt(relay, g, activeRun(b)!.groups, g.delegated)).toBe(7_500)
  expect(relayedReportAt(relay, g, activeRun(b)!.groups, g.delegated, 7_000)).toBeUndefined()
})
