import { expect, mock, test } from 'claude-code/testing'

import { WORKER_COMPACT_TOKENS, compactionInstructions, workerCompactStep, workerResumeText } from '../hooks/compaction.ts'
import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { TOOL, settle, start, world, writeBoard } from './monde-coordination.ts'

// La compaction d'un worker entre deux tickets : à la clôture d'un ticket (passé à « done »), son contexte au-delà
// de 450 000 tokens, le mod du worker envoie /compact au repos suivant, une fois, puis le relance.
// Invariant (celui des actions de l'auto) : « une même action auto (phase, vague, groupe, revue) n'est jamais
// envoyée deux fois » ; en plus : une compaction de worker n'est jamais envoyée pendant un ticket en cours ni
// pendant une revue qui tourne.

const T0 = 900_000_000

/** Un worker du groupe A, le contexte de sa discussion à `usage.tokens`. */
const worker = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const usage: { tokens: number | undefined } = { tokens: 500_000 }
  on('session.usage', () => ({ value: { context: { ...(usage.tokens !== undefined ? { tokens: usage.tokens } : {}), window: 1_000_000, percent: 50 } } }) as any)
  // La marque de la compaction d'un worker ne s'écrit pas quand `failMark.on`.
  const failMark = { on: false }
  w.probe.refuseStore = key => failMark.on && key.startsWith('worker-compact:')
  // La compaction que le mod lance (`$.session.compact`) : notée comme une commande, avec ses consignes.
  const instructions: (string | undefined)[] = []
  on('session.compact', (_$: unknown, e: { instructions?: string }) => {
    w.runs.push('compact')
    instructions.push(e.instructions)
    return { messages: [{ role: 'user', text: 'résumé', toolUses: [] }] }
  })
  await start($)
  await $.tool.call({ tool: TOOL, delegate: 'run-w', group: 'A', main: '[abc123]' } as any)
  return { clock, w, usage, failMark, instructions }
}

const say = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const endTurn = async ($: any, id: string) => {
  await $.turn.start({ turnId: id, text: id } as any)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: id, reason: 'answer' })
}
const compactions = (w: { runs: string[] }) => w.runs.filter(c => c === 'compact').length

test('le seuil est 450 000 tokens ; la décision au repos : attendre un tour ou une revue, ne rien faire pendant un ticket', () => {
  expect(WORKER_COMPACT_TOKENS).toBe(450_000)
  const base = { tokens: 460_000, isTurnOpen: false, hasBackgroundWork: false, doing: [] as string[], isMarked: false }
  expect(workerCompactStep(base)).toBe('compact')
  // Un tour ouvert ou une revue de fond : attendre le repos suivant.
  expect(workerCompactStep({ ...base, isTurnOpen: true })).toBe('wait')
  expect(workerCompactStep({ ...base, hasBackgroundWork: true })).toBe('wait')
  // Un ticket en cours, des statuts illisibles, déjà compacté pour ce ticket, ou sous le seuil : rien.
  expect(workerCompactStep({ ...base, doing: ['t2'] })).toBe('drop')
  expect(workerCompactStep({ ...base, doing: null })).toBe('drop')
  expect(workerCompactStep({ ...base, isMarked: true })).toBe('drop')
  expect(workerCompactStep({ ...base, tokens: 449_999 })).toBe('drop')
  expect(workerCompactStep({ ...base, tokens: undefined })).toBe('drop')
})

test('entre deux tickets, les consignes du groupe gardent le ticket suivant, la place dans la procédure, et pas le détail du ticket fini', () => {
  const text = compactionInstructions({ kind: 'group', run: 'run-w', runTitle: 'Boutique', group: 'A', main: '[abc123]', between: { done: 't1', next: 't2' } })
  expect(text).toMatch(/between two tickets: ticket t1 is done, and the next one to start is t2/)
  expect(text).toMatch(/at step 1 of section 2 of the procedure/)
  expect(text).toMatch(/keep its commit hashes \(the ticket's, and its review fixes'\) and, for the final report, its tracks .*, its findings on code older than the lot and what the CHANGELOG must say for it, but not the rest of the detail of its work/)
  expect(text).toMatch(/the commit hash of each ticket done/)
  expect(text).toMatch(/the questions sent to the manager still without an answer, word for word, and the choices already declared/)
  expect(text).toMatch(/the paths of the brief, of DECISIONS\.md and of the procedure of a worker/)
  expect(text).toMatch(/the branch and the worktree/)
  expect(text).toContain('the manager to report to: [abc123]')
  // Hors de ce moment (la compaction automatique en plein ticket) : ni ticket fini, ni ticket suivant.
  expect(compactionInstructions({ kind: 'group', run: 'run-w', group: 'A' })).not.toMatch(/between two tickets/)
})

test('un ticket passé « done » au-delà du seuil : la réponse dit de finir le tour ; au repos, une compaction, puis le mod relance le worker', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, instructions } = await worker($, on)
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  const answer = await say($, { set: [{ id: 't1', status: 'done' }] })
  expect(answer).toMatch(/ticket t1 is done and this discussion's context holds 500k tokens, past the 450k threshold/)
  expect(answer).toMatch(/end your turn before starting the next ticket/)
  // Pendant le tour : rien ne part.
  expect(compactions(w)).toBe(0)
  await endTurn($, 'fin')
  await settle(clock, 2)
  expect(compactions(w)).toBe(1)
  // Ses consignes sont celles du rôle « groupe » entre deux tickets, données par le mod à l'appel.
  expect(instructions[0]).toMatch(/worker working on group A of the mission/)
  expect(instructions[0]).toMatch(/this compaction runs between two tickets: ticket t1 is done/)
  // La compaction finie : le worker est relancé, sur le ticket suivant de sa procédure.
  expect(w.prompts.at(-1)).toMatch(/this discussion was compacted between two tickets \(ticket t1 done\)/)
  expect(w.prompts.at(-1)).toMatch(/step 1 of section 2 of your procedure/)
  // Un autre repos, le même ticket redit « done » : jamais une seconde compaction.
  expect(await say($, { set: [{ id: 't1', status: 'done' }] })).not.toMatch(/end your turn/)
  await endTurn($, 'encore')
  await settle(clock, 2)
  expect(compactions(w)).toBe(1)
})

test('le ticket suivant commencé dans le même tour, ou un ticket déjà « done » redit : jamais de compaction (une revue qui tourne : premier test)', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, usage } = await worker($, on)
  // Le ticket clos s'annonce, puis le suivant commence dans le même tour : le moment est passé.
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  expect(await say($, { set: [{ id: 't1', status: 'done' }] })).toMatch(/end your turn before starting the next ticket/)
  await say($, { set: [{ id: 't2', status: 'doing' }] })
  await endTurn($, 'suite')
  await settle(clock, 2)
  expect(compactions(w)).toBe(0)
  // Aucun relancement non plus : le worker travaille.
  expect(w.prompts.some(p => /flow-board: (this discussion was compacted|no compaction was made)/.test(p))).toBe(false)
  // Un ticket déjà « done », redit plus tard au-delà du seuil (un fichier de ticket relu, une commande qui le nomme) : pas une clôture.
  usage.tokens = 300_000
  await say($, { set: [{ id: 't2', status: 'done' }] })
  usage.tokens = 600_000
  expect(await say($, { set: [{ id: 't2', status: 'done' }] })).not.toMatch(/end your turn/)
  // Un ticket d'un autre groupe, déjà fait, que cette session n'a jamais relayé avant : pas une clôture non plus.
  expect(await say($, { set: [{ id: 't9', status: 'done' }] })).not.toMatch(/end your turn/)
  await endTurn($, 'redit')
  await settle(clock, 2)
  expect(compactions(w)).toBe(0)
})

test('un ticket clos pendant que le suivant est déjà « doing » (commit avant la revue) : aucune annonce, le worker n’est pas arrêté', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await worker($, on)
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await say($, { set: [{ id: 't2', status: 'doing' }] })
  // La revue de t1 revient pendant t2 : t1 passe « done ».
  expect(await say($, { set: [{ id: 't1', status: 'done' }] })).not.toMatch(/end your turn/)
  await endTurn($, 'pendant-t2')
  await settle(clock, 2)
  expect(compactions(w)).toBe(0)
})

test('la mission connue : la compaction nomme le ticket suivant ; le dernier ticket du groupe n’annonce rien ; sans suivant connu, la consigne dit la suite du groupe', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  on('session.usage', () => ({ value: { context: { tokens: 500_000, window: 1_000_000, percent: 50 } } }) as any)
  const instructions: (string | undefined)[] = []
  on('session.compact', (_$: unknown, e: { instructions?: string }) => {
    w.runs.push('compact')
    instructions.push(e.instructions)
    return { messages: [{ role: 'user', text: 'résumé', toolUses: [] }] }
  })
  const run = newRun('implement', T0 - 6000, 'Boutique')
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = { tickets: [{ id: 't1', name: 'Un', files: ['a.ts'] }, { id: 't3', name: 'Trois', files: ['c.ts'] }, { id: 't2', name: 'Deux', files: ['b.ts'] }], groups: [{ id: 'A', name: 'A', tickets: ['t1', 't3'] }, { id: 'B', name: 'B', tickets: ['t2'] }] }
  const mission = { ...(applyReport(base, report, T0 - 5000).board.runs[0] as Run), status: 'active' as const, owner: 'session-B' }
  writeBoard(w, b => ({ ...b, runs: [mission] }))
  await start($)
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[abc123]' } as any)
  // t1 clos, t3 reste : la compaction et la relance nomment t3.
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  expect(await say($, { set: [{ id: 't1', status: 'done' }] })).toMatch(/end your turn/)
  await endTurn($, 'premier')
  await settle(clock, 2)
  expect(compactions(w)).toBe(1)
  expect(instructions[0]).toMatch(/ticket t1 is done, and the next one to start is t3/)
  expect(w.prompts.at(-1)).toMatch(/Go on with ticket t3, from step 1 of section 2 of your procedure/)
  // t3, le dernier du groupe : pas « entre deux tickets », aucune annonce.
  await say($, { set: [{ id: 't3', status: 'doing' }] })
  expect(await say($, { set: [{ id: 't3', status: 'done' }] })).not.toMatch(/end your turn/)
  await endTurn($, 'dernier')
  await settle(clock, 2)
  expect(compactions(w)).toBe(1)
  // Sans ticket suivant connu, la consigne et la relance disent aussi la revue du groupe et le compte rendu.
  expect(compactionInstructions({ kind: 'group', run: 'r', group: 'A', between: { done: 't1' } })).toMatch(/when no ticket of the group is left, the group review and the report follow/)
  expect(workerResumeText('t1', undefined, true)).toMatch(/or, when none is left, with its group review and your report/)
})

test('un spécialiste encore au travail au repos : la compaction attend, revérifiée sans nouveau tour ; au-delà de 10 minutes, elle y renonce et relance le worker', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  on('session.usage', () => ({ value: { context: { tokens: 500_000, window: 1_000_000, percent: 50 } } }) as any)
  // Sans liste de tâches de fond au `classic.Stop`, le moteur dit les spécialistes au travail.
  const agents = { list: [{ agentId: 'a1', status: 'running' }] as unknown[] }
  on('agent.list', () => ({ value: agents.list }) as any)
  on('session.compact', () => {
    w.runs.push('compact')
    return { messages: [{ role: 'user', text: 'résumé', toolUses: [] }] }
  })
  await start($)
  await $.tool.call({ tool: TOOL, delegate: 'run-w', group: 'A', main: '[abc123]' } as any)
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  expect(await say($, { set: [{ id: 't1', status: 'done' }] })).toMatch(/end your turn/)
  await endTurn($, 'attente')
  await settle(clock, 2)
  expect(compactions(w)).toBe(0)
  // Le spécialiste fini, sans nouveau tour : la vérification suivante compacte.
  agents.list = []
  await settle(clock, 61)
  expect(compactions(w)).toBe(1)
  expect(w.prompts.at(-1)).toMatch(/this discussion was compacted between two tickets/)
  // Un ticket suivant clos, un spécialiste qui ne finit pas : au-delà de 10 minutes, rien ne part et le worker reprend.
  agents.list = [{ agentId: 'a2', status: 'waiting' }]
  await say($, { set: [{ id: 't2', status: 'doing' }] })
  expect(await say($, { set: [{ id: 't2', status: 'done' }] })).toMatch(/end your turn/)
  await endTurn($, 'longue')
  for (let i = 0; i < 11; i++) await settle(clock, 61)
  expect(compactions(w)).toBe(1)
  expect(w.prompts.at(-1)).toMatch(/no compaction was made after ticket t2/)
})

test('le ticket suivant nommé est le premier qui peut commencer : ni bloqué, ni en attente d’un ticket pas fait', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  on('session.usage', () => ({ value: { context: { tokens: 500_000, window: 1_000_000, percent: 50 } } }) as any)
  const instructions: (string | undefined)[] = []
  on('session.compact', (_$: unknown, e: { instructions?: string }) => {
    instructions.push(e.instructions)
    return { messages: [{ role: 'user', text: 'résumé', toolUses: [] }] }
  })
  const run = newRun('implement', T0 - 6000, 'Boutique')
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = {
    tickets: [
      { id: 't1', name: 'Un', files: ['a.ts'] },
      { id: 't3', name: 'Trois', files: ['c.ts'] },
      { id: 't4', name: 'Quatre', files: ['d.ts'], blockedBy: ['t3'] },
      { id: 't5', name: 'Cinq', files: ['e.ts'] },
      { id: 't6', name: 'Six', files: ['f.ts'] },
    ],
    // Deux groupes : un plan d'un seul groupe ne s'enregistre pas.
    groups: [{ id: 'A', name: 'A', tickets: ['t1', 't3', 't4', 't5'] }, { id: 'B', name: 'B', tickets: ['t6'] }],
  }
  const mission = { ...(applyReport(base, report, T0 - 5000).board.runs[0] as Run), status: 'active' as const, owner: 'session-B' }
  writeBoard(w, b => ({ ...b, runs: [mission] }))
  await start($)
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[abc123]' } as any)
  // t3 bloqué (une décision attendue), t4 attend t3 : le suivant est t5.
  await say($, { set: [{ id: 't3', status: 'blocked', why: 'décision' }] })
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  expect(await say($, { set: [{ id: 't1', status: 'done' }] })).toMatch(/end your turn/)
  await endTurn($, 'bloque')
  await settle(clock, 2)
  expect(instructions[0]).toMatch(/the next one to start is t5/)
  expect(w.prompts.at(-1)).toMatch(/Go on with ticket t5/)
})

test('sous le seuil, rien n’est dit ni envoyé ; une marque qui ne s’écrit pas n’envoie rien et relance le worker', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, usage, failMark } = await worker($, on)
  usage.tokens = 300_000
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  expect(await say($, { set: [{ id: 't1', status: 'done' }] })).not.toMatch(/end your turn/)
  await endTurn($, 'sous')
  await settle(clock, 2)
  expect(compactions(w)).toBe(0)
  // Au-delà du seuil, mais la marque ne s'écrit pas : rien ne part, et le worker reprend.
  usage.tokens = 600_000
  failMark.on = true
  await say($, { set: [{ id: 't2', status: 'doing' }] })
  expect(await say($, { set: [{ id: 't2', status: 'done' }] })).toMatch(/end your turn/)
  await endTurn($, 'marque')
  await settle(clock, 2)
  expect(compactions(w)).toBe(0)
  expect(w.prompts.at(-1)).toMatch(/no compaction was made/)
})
