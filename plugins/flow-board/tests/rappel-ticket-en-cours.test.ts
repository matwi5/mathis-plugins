// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { KEY, TOOL, start, world, writeBoard } from './monde-coordination.ts'

import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run, Ticket } from '../types'

// Le rappel du mod à un worker qui modifie un fichier du projet sans ticket « en cours » à son relais : il nomme le
// premier ticket ouvert de son groupe, une fois jusqu'au prochain ticket passé « doing ».

const T0 = 910_000_000
const CWD = '/w'
const REMINDER = /Set ticket (\S+) in progress/

/**
 * Le moteur des tests de coordination, le dossier de travail de la session (sa racine aussi, où le mod lit son
 * board) et les outils d'écriture qui réussissent.
 */
const engine = (on: any, o: { cwd?: () => string } = {}) => {
  const w = world(on)
  on('session.root', () => ({ value: CWD }))
  on('session.cwd', () => {
    if (o.cwd) return { value: o.cwd() }
    return { value: CWD }
  })
  for (const tool of ['Edit', 'Write', 'MultiEdit']) on('tool.call', { tool: tool as any }, () => ({ result: { filePath: 'x' } }))
  return w
}

/** La mission du groupe A dans le fichier des missions (un plan d'un seul groupe ne s'enregistre pas : B a son ticket). */
const missionWith = (w: ReturnType<typeof world>, tickets: Ticket[]): Run => {
  const run = newRun('implement', T0 - 6000, 'Boutique')
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const other: Ticket = { id: 'b1', name: 'Autre', status: 'todo', sensitive: false, files: ['z.ts'] }
  const report = { tickets: [...tickets, other], groups: [{ id: 'A', name: 'A', tickets: tickets.map(t => t.id) }, { id: 'B', name: 'B', tickets: [other.id] }] }
  const mission = { ...(applyReport(base, report, T0 - 5000).board.runs[0] as Run), status: 'active' as const, owner: 'session-B' }
  writeBoard(w, b => ({ ...b, root: CWD, runs: [mission] }))
  // En `$.store`, le board d'une racine se garde sous sa clé.
  w.mem[`board:${CWD}`] = w.mem[KEY]
  return mission
}

const TICKETS: Ticket[] = [
  { id: 't1', name: 'Un', status: 'todo', sensitive: false, files: ['a.ts'] },
  { id: 't2', name: 'Deux', status: 'todo', sensitive: false, files: ['b.ts'] },
]

const say = ($: any, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input } as any)

/** Le ticket que nomme le rappel ajouté au résultat de l'outil, ou null sans rappel. */
const reminded = (ran: any): string | null => REMINDER.exec(((ran?.context ?? []) as string[]).join('\n'))?.[1] ?? null

const edit = ($: any, path: string, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b', ...extra } as any)

test('un worker qui modifie un fichier du projet sans ticket « doing » reçoit le rappel du premier ticket ouvert, une seule fois', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const w = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  const first = await edit($, `${CWD}/src/a.ts`)
  expect(reminded(first)).toBe('t1')
  // Le résultat de l'outil lui-même ne change pas.
  expect(first.result).toEqual({ filePath: 'x' })
  expect(first.isError).not.toBe(true)
  // Un second Edit sans ticket « doing » ne le répète pas, ni un Write, ni un chemin relatif.
  expect(reminded(await edit($, `${CWD}/src/b.ts`))).toBe(null)
  expect(reminded(await $.tool.call({ tool: 'Write', file_path: 'src/c.ts', content: 'x' } as any))).toBe(null)
})

test('après un ticket passé « doing » puis fini, le rappel repart et nomme le ticket suivant ; rien pendant un ticket « doing »', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const w = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  expect(reminded(await edit($, `${CWD}/src/a.ts`))).toBe('t1')
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  expect(reminded(await edit($, `${CWD}/src/a.ts`))).toBe(null)
  expect(reminded(await $.tool.call({ tool: 'MultiEdit', file_path: `${CWD}/src/a.ts`, edits: [] } as any))).toBe(null)
  await say($, { set: [{ id: 't1', status: 'done' }] })
  expect(reminded(await $.tool.call({ tool: 'MultiEdit', file_path: `${CWD}/src/b.ts`, edits: [] } as any))).toBe('t2')
})

test('aucun rappel : sous travail/, hors du dossier de travail, dans un spécialiste, groupe fini, relais ou dossier illisibles, hors d’un worker', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  let cwd = CWD
  const w = engine(on, { cwd: () => cwd })
  const mission = missionWith(w, TICKETS)
  // Hors d'un worker : rien.
  await start($)
  expect(reminded(await edit($, `${CWD}/src/a.ts`))).toBe(null)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  // Le dossier des tickets, le dossier temporaire de la session, un chemin qui sort du dossier par « .. ».
  expect(reminded(await edit($, `${CWD}/travail/lot/issues/01-un.md`))).toBe(null)
  // Un fichier de ticket local hors de travail/ (le traceur par défaut de /to-tickets) : il passe un statut, pas du code.
  expect(reminded(await edit($, `${CWD}/.scratch/lot/issues/02-deux.md`))).toBe(null)
  expect(reminded(await edit($, '/Users/x/.claude/jobs/1/tmp/notes.md'))).toBe(null)
  expect(reminded(await edit($, `${CWD}/../autre/a.ts`))).toBe(null)
  expect(reminded(await edit($, '/wx/a.ts'))).toBe(null)
  // Un spécialiste du worker : rien.
  expect(reminded(await edit($, `${CWD}/src/a.ts`, { agentId: 'agent-1' }))).toBe(null)
  // Le dossier de travail illisible : rien.
  cwd = ''
  expect(reminded(await edit($, `${CWD}/src/a.ts`))).toBe(null)
  cwd = CWD
  // Le relais de la session illisible : rien.
  const key = `relay:${mission.id}:session-A`
  const kept = w.mem[key]
  w.mem[key] = 'pas une entrée'
  expect(reminded(await edit($, `${CWD}/src/a.ts`))).toBe(null)
  w.mem[key] = kept
  // Aucun des cas muets n'a consommé le rappel : le relais relu, il part (le hook a bien tourné).
  expect(reminded(await edit($, `${CWD}/src/a.ts`))).toBe('t1')
  // Un ticket passé « doing » le réarme ; tous les tickets du groupe faits (les correctifs de la revue du groupe) : rien.
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await say($, { set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'done' }] })
  expect(reminded(await edit($, `${CWD}/src/a.ts`))).toBe(null)
})

test('le premier Edit utile après les cas muets reçoit encore le rappel : ils ne le consomment pas', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const w = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  expect(reminded(await edit($, `${CWD}/travail/lot/notes.md`))).toBe(null)
  expect(reminded(await edit($, `${CWD}/src/a.ts`, { agentId: 'agent-1' }))).toBe(null)
  expect(reminded(await edit($, `${CWD}/src/a.ts`))).toBe('t1')
})
