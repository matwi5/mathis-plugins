import { expect, test } from 'claude-code/testing'

import { closingProcedure, closingScript, isKeptForReport } from '../hooks/closing.ts'
import { applyReport, closingText, emptyBoard, newRun, startLinkedGroups } from '../hooks/model.ts'
import { linkRelaySessions } from '../hooks/link.ts'
import { applyRelay } from '../hooks/relay.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board, Relay, Run } from '../types'

// Sans session notée pour l'envoi (ni la sortie du lancement ni l'entrée de relais ne l'ont donnée), la fermeture dit
// la vraie raison du `claude rm` sauté : aucune session n'est notée, la session est gardée, et la personne peut la
// retirer elle-même. Le texte d'avant (« le relais n'a pas son compte rendu ») envoyait réclamer un compte rendu
// peut-être déjà là. Invariant de la session notée : un id hors forme, ou plus d'une session candidate pour un même
// envoi, ne sont jamais notés, et la fermeture garde alors la session (ni `claude stop` ni `claude rm`).

const SCRIPT = '/opt/poste/.claude/plugins/cache/m/flow-board/1.0.0/scripts/fermeture.mjs'
const NO_SESSION = 'pas de claude rm : aucune session n’est notée pour cet envoi, donc la session est gardée'
const WHY = 'aucune session notée pour cet envoi : session gardée'
const NO_REPORT = 'pas de claude rm : le relais n’a pas son compte rendu'

const run = (): Run => ({ ...newRun('implement', 1_000, 'Boutique'), id: 'm1' }) as Run
const group = { kind: 'group', id: 'A', name: 'Code' } as const

/** Les deux formes du texte : la procédure entière (sans script) et la courte (le script de vérification là). */
const bothForms = (fn: () => string): { whole: string; short: string } => {
  const before = closingScript.path
  try {
    closingScript.path = null
    const whole = fn()
    closingScript.path = SCRIPT
    return { whole, short: fn() }
  } finally {
    closingScript.path = before
  }
}

test('sans session notée : les deux formes disent la vraie raison, la session gardée et la commande à lancer soi-même', () => {
  for (const hasReport of [false, true]) {
    const { whole, short } = bothForms(() => closingProcedure({ run: run(), target: group, isRepo: true, hasReport }))
    expect(whole).toContain(`10) ${NO_SESSION}`)
    expect(short).toContain(`3) ${NO_SESSION}`)
    for (const text of [whole, short]) {
      expect(text).toContain('dis-moi que je peux la retirer moi-même, une fois le worktree retiré, par claude rm suivi de l’id court que montre claude agents')
      // Le compte rendu peut n'exister que dans son dossier de job, que claude rm effacerait : sans lui, claude rm n'est pas proposé.
      const missing = text.indexOf('si son compte rendu ne t’est parvenu ni par SendMessage ni par l’outil flow, dis-le-moi et ne me propose pas claude rm')
      expect(missing).toBeGreaterThan(-1)
      expect(missing).toBeLessThan(text.indexOf('dis-moi que je peux la retirer moi-même'))
      expect(text).not.toContain(NO_REPORT)
    }
  }
})

test('sans session notée : Claude ne lance claude rm dans aucune forme, et ne cherche aucun id pour cela', () => {
  for (const hasReport of [false, true]) {
    const { whole, short } = bothForms(() => closingProcedure({ run: run(), target: group, isRepo: true, hasReport }))
    for (const text of [whole, short]) {
      // Aucune commande claude rm avec un id, ni le placeholder de l'id.
      expect(text).not.toMatch(/claude rm '/)
      expect(text).not.toMatch(/claude rm <id>/)
      expect(text).toContain('ne lance pas claude rm et ne cherche pas son id pour cela')
    }
    // Le script de vérification ne reçoit aucune session.
    expect(short).not.toContain('--session')
  }
})

test('avec une session notée mais sans compte rendu au relais : le texte d’avant reste, dans les deux formes', () => {
  const { whole, short } = bothForms(() => closingProcedure({ run: run(), target: group, isRepo: true, session: 'abc12345', hasReport: false }))
  expect(whole).toContain(`10) ${NO_REPORT}`)
  expect(short).toContain(`3) ${NO_REPORT}`)
  for (const text of [whole, short]) {
    expect(text).toContain('"why": "compte rendu absent du relais : session gardée"')
    expect(text).not.toContain(NO_SESSION)
  }
  // Avec son compte rendu : claude rm par l'id noté, comme avant.
  const done = bothForms(() => closingProcedure({ run: run(), target: group, isRepo: true, session: 'abc12345', hasReport: true }))
  expect(done.whole).toContain(`claude rm 'abc12345'`)
  expect(done.short).toContain(`claude rm 'abc12345'`)
})

/** Une mission à deux groupes dont l'envoi de A a deux sessions candidates au relais : marqué. */
const clashedBoard = (): Board => {
  const r = { ...newRun('implement', 1_000, 'Boutique'), owner: 's' }
  const plan = { tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }], groups: [{ id: 'A', name: 'Code', tickets: ['a1'] }, { id: 'B', name: 'Doc', tickets: ['b1'] }] }
  let board: Board = applyReport({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [r], activeId: r.id }, plan, 2_000).board
  board = startLinkedGroups(board, ['A'], 3_000)!.board
  const runId = activeRun(board)!.id
  let relay: Relay | null = null
  relay = applyRelay(relay, runId, '9f3e21aa-0416-4d88-8317-cc583d9f0d47', { kind: 'start', group: 'A' }, 4_000) as Relay
  relay = applyRelay(relay, runId, '4c9ac344-1111-4d88-8317-cc583d9f0d47', { kind: 'start', group: 'A' }, 4_100) as Relay
  return linkRelaySessions(board, relay, 5_000)!.board
}

test('sous une marque de doute : le texte d’avant reste, dans les deux formes, sans la nouvelle raison', () => {
  const board = clashedBoard()
  const r = activeRun(board)!
  const send = r.groups!.find(g => g.id === 'A')!.linked!
  expect(send.sessionClash).toBe(true)
  const { whole, short } = bothForms(() => closingProcedure({ run: r, target: group, isRepo: true, hasReport: false, send }))
  for (const text of [whole, short]) {
    expect(text).toMatch(/^Ne ferme pas le worker de l’envoi 1 du groupe A/)
    expect(text).toContain('la session est gardée, ni claude stop ni claude rm')
    expect(text).not.toContain(NO_SESSION)
  }
})

test('l’état rendu au tableau de bord dit la même raison : « stopped », ce why, sans worktree ni sessionId', () => {
  const { whole, short } = bothForms(() => closingProcedure({ run: run(), target: group, isRepo: true, hasReport: false }))
  for (const text of [whole, short]) {
    expect(text).toContain(`"state": "stopped", pas "closed" (la session reste), avec "why": "${WHY}", sans "worktree" ni "sessionId"`)
    expect(text).not.toContain('"why": "compte rendu absent du relais : session gardée"')
  }
})

test('le rapport dicté, rejoué contre le modèle : la raison est gardée entière, la session n’est pas « gardée faute de compte rendu », rien n’est reproposé', () => {
  const r = { ...newRun('implement', 1_000, 'Boutique'), owner: 's' }
  const plan = { tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }], groups: [{ id: 'A', name: 'Code', tickets: ['a1'] }, { id: 'B', name: 'Doc', tickets: ['b1'] }] }
  let board: Board = applyReport({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [r], activeId: r.id }, plan, 2_000).board
  board = startLinkedGroups(board, ['A'], 3_000)!.board
  board = applyReport(board, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 6_000).board
  board = applyReport(board, { security: { group: 'A', advised: false, why: 'texte seul' } }, 6_100).board
  // Rendu sans session notée : la fermeture proposée dit la nouvelle raison.
  expect(closingText(activeRun(board)!, null, true)).toContain(NO_SESSION)
  const stopped = applyReport(board, { closed: [{ group: 'A', state: 'stopped', why: WHY }] }, 7_000).board
  const run1 = activeRun(stopped)!
  const sent = run1.groups!.find(g => g.id === 'A')!.delegated!
  expect(sent.closing?.state).toBe('stopped')
  expect(sent.closing?.why).toBe(WHY)
  expect(isKeptForReport(run1, group, sent.seq as number | undefined, sent.closing, sent)).toBe(false)
  // Plus de « Close now » pour ce groupe : rien ne se ferme d'office, la session reste gardée.
  expect(closingText(run1, null, true)).not.toMatch(/Close now: group A/)
})
