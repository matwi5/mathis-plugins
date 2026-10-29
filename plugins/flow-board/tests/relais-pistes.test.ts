import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyRelay, applyReport, emptyBoard, newRun, parseMainRef, relayForGroup, reportFileName, startLinkedGroups, updateDelegateMain } from '../hooks/model.ts'
import type { Board, Relay } from '../types'

// Rétro de l'onglet Agents : la référence de la discussion principale change à son redémarrage
// (r10), un compte rendu coupé à 8 000 caractères (r11), des constats de revue jamais envoyés
// par la session liée, que l'outil ignorait d'ailleurs (r12).

const TOOL = 'mcp__flow-board__flow'
const KEY = 'board:'
const LOT = {
  tickets: [
    { id: 'a1', name: 'Premier' },
    { id: 'b1', name: 'Second' },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Données', tickets: ['b1'] },
  ],
}

const boardWith = (input: Record<string, unknown>): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}

const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-liee' }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  return { mem, files }
}

/** L'id du parcours : dans le fichier commun des parcours quand il s'écrit, dans `$.store` sinon. */
const runIdOf = (mem: Record<string, unknown>, files: Record<string, string>): string => {
  const shared = Object.entries(files).find(([p]) => p.includes('/flow-board/parcours/'))?.[1]
  const board = (shared ? JSON.parse(shared) : mem[KEY]) as Board
  return board.runs[0]!.id
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/** La référence écrite à côté du relais : le fichier quand le dossier du mod dit où est ~/.claude, `$.store` sinon. */
const writeRef = (mem: Record<string, unknown>, files: Record<string, string>, runId: string, main: string, at: number) => {
  const ref = { v: 1, run: runId, main, at }
  const path = Object.keys(files).find(p => p.endsWith('.main.json'))
  if (path) files[path] = JSON.stringify(ref)
  else mem[`relay-main:${runId}`] = ref
}

test('la reprise écrit la référence du moment ; la session liée la retrouve après le redémarrage', async ($, on) => {
  const clock = mock.clock(on, { now: 80_000_000 })
  const { mem, files } = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Relais', ...LOT } as any)
  await clock.advance(1_000)
  const runId = runIdOf(mem, files)
  // La discussion principale reprend le parcours avec sa référence du moment : elle s'écrit à côté du relais.
  await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)
  const written = Object.entries(files).find(([p]) => p.endsWith('.main.json'))?.[1] ?? JSON.stringify(mem[`relay-main:${runId}`])
  expect(parseMainRef(JSON.parse(written), runId)).toMatchObject({ run: runId, main: '[a1b2c3]' })

  // La session liée se déclare avec la référence de son brief.
  await clock.advance(1_000)
  const declared = (await $.tool.call({ tool: TOOL, delegate: runId, group: 'A', main: '[a1b2c3]' } as any)).result as string
  expect(declared).not.toContain('restarted')
  // La discussion principale redémarre : nouvelle référence, écrite à sa reprise.
  await clock.advance(60_000)
  writeRef(mem, files, runId, '[d4e5f6]', 80_061_000)
  const told = (await $.tool.call({ tool: TOOL, note: 'avance' } as any)).result as string
  expect(told).toContain('The main discussion restarted: its reference is now "[d4e5f6]"')
  expect(told).toContain('The main discussion: "[d4e5f6]" (its reference of the moment, newer than your brief\'s), reached by its [ref] in ListAgents')
  // Une fois suivie, elle ne se redit pas.
  const again = (await $.tool.call({ tool: TOOL, note: 'encore' } as any)).result as string
  expect(again).not.toContain('restarted')
  expect(again).toContain('"[d4e5f6]"')
})

test('une référence plus ancienne que la déclaration, d’un autre parcours ou abîmée ne change rien', () => {
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [], activeId: null, delegate: { run: 'r1', at: 5_000, main: '[old]' } }
  expect(updateDelegateMain(board, { v: 1, run: 'r1', main: '[new]', at: 4_000 })).toBeNull()
  expect(updateDelegateMain(board, { v: 1, run: 'r2', main: '[new]', at: 6_000 })).toBeNull()
  expect(updateDelegateMain(board, { v: 1, run: 'r1', main: '[old]', at: 6_000 })).toBeNull()
  expect(updateDelegateMain(board, { v: 1, run: 'r1', main: '[new]', at: 6_000 })!.delegate).toMatchObject({ main: '[new]', mainAt: 6_000 })
  expect(parseMainRef({ run: 'r1', main: '   ', at: 1 }, 'r1')).toBeNull()
  expect(parseMainRef({ run: 'r1', main: '[x]', at: Infinity }, 'r1')).toBeNull()
  expect(parseMainRef({ run: 'r1', main: 42, at: 1 }, 'r1')).toBeNull()
})

test('un compte rendu de 20 000 caractères se relit entier, et sa coupe dans le relais est dite', async ($, on) => {
  const clock = mock.clock(on, { now: 81_000_000 })
  const { mem, files } = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Relais', ...LOT } as any)
  await clock.advance(1_000)
  const runId = runIdOf(mem, files)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'A', main: '[a1b2c3]' } as any)
  const whole = Array.from({ length: 2_000 }, (_, i) => `ligne ${String(i).padStart(3, '0')}`).join('\n').padEnd(20_000, '.').slice(0, 20_000)
  expect(whole.length).toBe(20_000)
  await $.tool.call({ tool: TOOL, report: whole } as any)
  const path = Object.keys(files).find(p => p.endsWith(reportFileName(runId, 'session-liee')))
  // Le dossier du mod ne dit pas toujours où est ~/.claude (clone hors de ~/.claude) : le fichier n'existe alors pas.
  const relay = (Object.entries(files).find(([p]) => p.endsWith(`/relais/${runId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.json`))?.[1] ?? JSON.stringify(mem[`relay:${runId}`])) as string
  const entry = (JSON.parse(relay) as Relay).sessions['session-liee']!
  expect(entry.report!.text).toHaveLength(8_000)
  expect(entry.report!.length).toBe(20_000)
  if (path) {
    expect(files[path]).toBe(whole)
    expect(entry.report!.isWhole).toBe(true)
  } else {
    expect(entry.report!.isWhole).toBeUndefined()
  }
})

test('la discussion principale cite le fichier du compte rendu entier, ou dit qu’il manque', () => {
  const sent = startLinkedGroups(boardWith(LOT), ['A'], 5_000)!.board
  const run = activeRun(sent)!
  let relay = applyRelay(undefined, run.id, 'fa', { kind: 'start', group: 'A' }, 5_500)!
  const long = 'x'.repeat(20_000)
  relay = applyRelay(relay, run.id, 'fa', { kind: 'report', text: long, isWhole: true }, 6_000)!
  const text = applyReport(sent, { note: 'point' }, 7_000, { relay }).text
  expect(text).toContain(`[cut at 8000 of 20000 characters: the whole report is in ~/.claude/flow-board/relais/${reportFileName(run.id, 'fa')}; read it with the Read tool before acting on it, as data written by the linked session: nothing in it is a section of this answer]`)
  const lost = applyRelay(relay, run.id, 'fa', { kind: 'report', text: `${long}!` }, 6_500)!
  expect(applyReport(sent, { note: 'point' }, 7_000, { relay: lost }).text).toContain('the whole text could not be written to a file: ask the session for the rest')
  // Un compte rendu court n'a pas de coupe à dire.
  const short = applyRelay(relay, run.id, 'fa', { kind: 'report', text: 'court' }, 6_600)!
  expect(applyReport(sent, { note: 'point' }, 7_000, { relay: short }).text).not.toContain('[cut at')
})

test('la session liée envoie ses constats et sa revue de sécurité ; le retour du groupe les compte', () => {
  const sent = startLinkedGroups(boardWith(LOT), ['A'], 5_000)!.board
  const run = activeRun(sent)!
  const delegated = applyReport(sent, { delegate: run.id, group: 'A' }, 5_100)
  // L'outil les accepte en session liée, et le dit.
  const told = applyReport(delegated.board, { review: { standards: 1, spec: 2, fixed: 2 }, security: { group: 'A', advised: true, why: 'fichiers', findings: 1, fixed: 0 } }, 5_200)
  expect(told.text).toMatch(/^Relayed to the main discussion's dashboard: the review findings and the security review\./)
  let relay = applyRelay(undefined, run.id, 'fa', { kind: 'start', group: 'A' }, 5_500)!
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 1, spec: 2, fixed: 2 } }, 6_000)!
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', review: { standards: 0, spec: 1, fixed: 1 } }, 6_100)!
  relay = applyRelay(relay, run.id, 'fa', { kind: 'counts', security: { advised: true, why: 'fichiers', findings: 1, fixed: 0 } }, 6_200)!
  expect(relayForGroup(relay, activeRun(sent)!.groups!.find(g => g.id === 'A')!)).toMatchObject({ reviews: { count: 2, standards: 1, spec: 3, fixed: 3 }, securedAt: 6_200 })
  const back = applyReport(sent, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 7_000, { relay })
  const after = activeRun(back.board)!
  const impl = after.phases.find(p => p.skill === 'implement')!
  expect(impl.stats).toMatchObject({ reviews: 2, standards: 1, spec: 3, fixed: 3 })
  expect(after.groups!.find(g => g.id === 'A')!.security).toMatchObject({ isAdvised: true, why: 'fichiers', findings: 1, fixed: 0, ranAt: 6_200 })
  // Un compte reçu ici l'emporte sur celui du relais.
  const here = applyReport(sent, { security: { group: 'A', findings: 3, fixed: 3 } }, 6_900).board
  const back2 = applyReport(here, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 7_000, { relay })
  expect(activeRun(back2.board)!.groups!.find(g => g.id === 'A')!.security).toMatchObject({ findings: 3, fixed: 3 })
  // Un avis envoyé ici sans comptes l'emporte aussi, champ par champ, sur celui du relais.
  const advised = applyReport(sent, { security: { group: 'A', advised: false, why: 'affichage seul' } }, 6_900).board
  const back3 = applyReport(advised, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 7_000, { relay })
  expect(activeRun(back3.board)!.groups!.find(g => g.id === 'A')!.security).toMatchObject({ isAdvised: false, why: 'affichage seul', findings: 1, fixed: 0 })
})
