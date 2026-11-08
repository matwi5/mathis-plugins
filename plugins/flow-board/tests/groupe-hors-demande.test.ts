// Un groupe lancé hors de la demande du mod : un manager avait lancé le groupe E par sa propre commande
// `claude --bg`, sans demande en attente ; le tableau de bord ne l'avait pas lié et la personne ne le voyait
// pas. Une telle session est signalée (ligne du groupe, réponse de l'outil une fois), jamais rattachée
// d'après son titre (choix de la personne : le lien reste posé seulement par une demande en attente).

import { expect, mock, test } from 'claude-code/testing'

import { newRun } from '../hooks/model.ts'
import { offRequestLaunches } from '../hooks/link.ts'
import type { LinkedSession } from '../hooks/linked.ts'
import { memoryDisk } from './disque-memoire.ts'
import type { Board, LinkedLaunch, Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const T0 = 70_000_000
const SIGNAL = /Groupe A lancé hors de la demande : arrête-le, puis relance-le depuis la demande/

// ─── La règle, fonction pure ───────────────────────────────────────

const runWith = (groups: Run['groups'], startedAt = T0): Run => ({ ...newRun('implement', startedAt, 'Boutique'), groups })
const GROUPS = (patch: Partial<NonNullable<Run['groups']>[number]> = {}): Run['groups'] => [
  { id: 'A', name: 'Synchro', tickets: ['a1'], ...patch },
  { id: 'B', name: 'Icône', tickets: ['b1'] },
]
const launch = (id: string, title: string, at = T0 + 10_000): LinkedLaunch => ({ id, title, at, via: 'bg' })
const live = (key: string, state: LinkedSession['state'] = 'working'): LinkedSession => ({ key, title: '', how: 'none', state })

test('une session titrée « Groupe A · », sans lien ni demande en attente pour A, est signalée', () => {
  const run = runWith(GROUPS())
  const got = offRequestLaunches(run, [launch('9f3e21aa', 'Boutique > Groupe A · Synchro')], [live('9f3e21aa')])
  expect(got).toEqual([{ group: 'A', launch: '9f3e21aa' }])
  // Sans séparateur, le titre ne nomme pas d'autre mission : signalé aussi.
  expect(offRequestLaunches(run, [launch('9f3e21aa', 'Groupe a · Synchro')], [live('9f3e21aa')])).toEqual([{ group: 'A', launch: '9f3e21aa' }])
})

test('la session liée par la demande n’est jamais signalée, ni pendant qu’une demande attend', () => {
  const linked = runWith(GROUPS({ linked: { at: T0 + 5_000, session: '9f3e21aa' } }))
  expect(offRequestLaunches(linked, [launch('9f3e21aa', 'Boutique > Groupe A · Synchro')], [live('9f3e21aa')])).toEqual([])
  const pending = runWith(GROUPS({ linked: { at: T0 + 5_000 } }))
  expect(offRequestLaunches(pending, [launch('9f3e21aa', 'Boutique > Groupe A · Synchro')], [live('9f3e21aa')])).toEqual([])
  // Rendu, puis sa session précédente : jamais signalées.
  const back = runWith(GROUPS({ delegated: { at: T0 + 20_000, session: 'cafe1234', earlier: [{ at: T0 + 1_000, session: '9f3e21aa' }] } }))
  expect(offRequestLaunches(back, [launch('9f3e21aa', 'Boutique > Groupe A · Synchro'), launch('cafe1234', 'Boutique > Groupe A · Synchro', T0 + 21_000)], [live('9f3e21aa'), live('cafe1234')])).toEqual([])
})

test('le groupe lié ensuite par une demande, ou la session arrêtée ou absente du registre : plus de signalement', () => {
  const l = launch('9f3e21aa', 'Boutique > Groupe A · Synchro')
  const after = runWith(GROUPS({ linked: { at: T0 + 30_000, session: 'local_autre' } }))
  expect(offRequestLaunches(after, [l], [live('9f3e21aa')])).toEqual([])
  const run = runWith(GROUPS())
  expect(offRequestLaunches(run, [l], [live('9f3e21aa', 'closed')])).toEqual([])
  expect(offRequestLaunches(run, [l], [live('9f3e21aa', 'failed')])).toEqual([])
  expect(offRequestLaunches(run, [l], [])).toEqual([])
  // Lancée après le retour de son groupe, elle n'est pas vue : signalée.
  const returned = runWith(GROUPS({ delegated: { at: T0 + 1_000, session: 'local_avant' } }))
  expect(offRequestLaunches(returned, [l], [live('9f3e21aa', 'returned')])).toEqual([{ group: 'A', launch: '9f3e21aa' }])
})

test('un titre d’une autre mission, un groupe inconnu, ou un lancement d’avant la mission : rien', () => {
  const run = runWith(GROUPS())
  expect(offRequestLaunches(run, [launch('9f3e21aa', 'Atelier > Groupe A · Synchro')], [live('9f3e21aa')])).toEqual([])
  expect(offRequestLaunches(run, [launch('9f3e21aa', 'Boutique > Groupe Z · Autre')], [live('9f3e21aa')])).toEqual([])
  expect(offRequestLaunches(run, [launch('9f3e21aa', 'Boutique > Bug · cache')], [live('9f3e21aa')])).toEqual([])
  expect(offRequestLaunches(run, [launch('9f3e21aa', 'Boutique > Groupe A · Synchro', T0 - 1)], [live('9f3e21aa')])).toEqual([])
})

// ─── Dans le mod : la ligne du groupe et la réponse de l'outil ───────────────

const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-orch' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('prompt.fill', () => ({ isFilled: true }))
  // Un lancement relit le fichier des missions juste avant (suite complète) : absent, il se lit bien.
  memoryDisk(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'backgrounded · 9f3e21aa · Boutique > Groupe A · Synchro\n' } }))
  return mem
}
const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
const LOT = {
  title: 'Boutique',
  tickets: [
    { id: 'a1', name: 'Synchro' },
    { id: 'b1', name: 'Icône' },
  ],
  groups: [
    { id: 'A', name: 'Synchro', tickets: ['a1'] },
    { id: 'B', name: 'Icône', tickets: ['b1'] },
  ],
}
const LAUNCH = 'claude --bg -n "Boutique > Groupe A · Synchro" "$(cat /tmp/brief.txt)"'

/** La mission découpée, puis le groupe A lancé par une commande à part, sans demande. */
const offRequest = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: T0 })
  const mem = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, ...LOT } as any)
  await settle(clock, 1)
  await $.tool.call({ tool: 'Bash', command: LAUNCH } as any)
  await settle(clock, 6)
  return { clock, mem }
}

const resultOf = (out: any): string => String(out?.result ?? '')

test('dans le mod : la ligne du groupe le dit, la réponse de l’outil une fois, et le groupe reste sans lien', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, mem } = await offRequest($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: SIGNAL })).toBeDefined()
    await ui.unmount()
  }
  const first = resultOf(await $.tool.call({ tool: TOOL, note: 'point' } as any))
  expect(first).toContain('Group A was launched outside its launch request (session 9f3e21aa)')
  // L'id du lancement, en forme, entre cité dans la commande d'arrêt (jamais un id hors forme).
  expect(first).toContain("claude stop '9f3e21aa' once")
  const second = resultOf(await $.tool.call({ tool: TOOL, note: 'encore' } as any))
  expect(second).not.toContain('launched outside its launch request')
  // Rien ne se rattache d'après le titre.
  const run = (mem['board:'] as Board).runs.find(r => r.title === 'Boutique')!
  expect(run.groups!.find(g => g.id === 'A')!.linked).toBeUndefined()
  // Arrêtée (plus de signe de vie au-delà de 30 minutes) : la ligne ne le dit plus.
  await clock.advance(31 * 60_000)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: SIGNAL })).toBeUndefined()
  await ui.unmount()
})

test('dans le mod : le groupe lancé depuis sa demande n’est jamais signalé', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const mem = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, ...LOT } as any)
  await settle(clock, 1)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await pane.press({ key: 'launch-linked-A' })
  await pane.unmount()
  await $.tool.call({ tool: 'Bash', command: LAUNCH } as any)
  await settle(clock, 6)
  const run = (mem['board:'] as Board).runs.find(r => r.title === 'Boutique')!
  expect(run.groups!.find(g => g.id === 'A')!.linked?.session).toBe('9f3e21aa')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: SIGNAL })).toBeUndefined()
  await ui.unmount()
  expect(resultOf(await $.tool.call({ tool: TOOL, note: 'point' } as any))).not.toContain('launched outside its launch request')
})

