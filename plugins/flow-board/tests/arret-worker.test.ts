// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { memoryDisk } from './disque-memoire.ts'
import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'
import { TOOL, start, world, writeBoard } from './monde-coordination.ts'

import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import { applyRelay, workerStopOf, workerStopText } from '../hooks/relay.ts'
import type { Board, Run, Ticket } from '../types'

// Un worker arrêté par une erreur que réessayer ne résout pas le dit : un toast et une note à son relais ; le manager
// montre la note sur la ligne du groupe, à la place de son état, et lève une notification, une fois par note.
// Invariant du ticket : sur une erreur de la liste fermée, le mod du worker ne dépose au relais que sa propre note,
// par le signal de note existant ; le texte ne porte que le nom d'une erreur de la liste, jamais son détail ; un
// dépôt raté ou refusé ne change rien d'autre, et n'empêche ni le toast ni la suite du handler.

const T0 = 920_000_000
const OPUS = 'claude-opus-5-5'

/** La liste fermée, avec le texte attendu de chacune (le nom de l'erreur tel que le moteur le donne). */
const STOPS: [string, string][] = [
  ['authentication_failed', 'worker arrêté : /login'],
  ['oauth_org_not_allowed', 'worker arrêté : oauth_org_not_allowed'],
  ['account_on_hold', 'worker arrêté : account_on_hold'],
  ['verification_required', 'worker arrêté : verification_required'],
  ['cloud_credential_error', 'worker arrêté : cloud_credential_error'],
  ['model_not_found', 'worker arrêté : model_not_found'],
  ['billing_error', 'worker arrêté : billing_error'],
]

test('le texte d’arrêt : la liste fermée, le nom de l’erreur seul, rien hors de la liste ni pour un billing_error repris', () => {
  for (const [error, text] of STOPS) expect(workerStopText(error, false)).toBe(text)
  expect(workerStopText('billing_error', true)).toBeNull()
  expect(workerStopText('authentication_failed', true)).toBe('worker arrêté : /login')
  for (const other of ['rate_limit', 'overloaded', 'server_error', 'invalid_request', 'max_output_tokens', 'unknown', 'autre', '', undefined, null, 42, { error: 'authentication_failed' }])
    expect(workerStopText(other, false)).toBeNull()
})

// ─── Le prédicat du manager, une ligne par forme reçue ───────────────────

test('un last d’un autre genre ne dit rien', () => {
  expect(workerStopOf(undefined)).toBeNull()
  for (const kind of ['ticket', 'commit', 'test', 'choice', 'review', 'report']) expect(workerStopOf({ kind, text: 'worker arrêté : /login', at: T0 })).toBeNull()
})

test('une note ordinaire ne dit rien', () => {
  expect(workerStopOf({ kind: 'note', text: 'revue lancée', at: T0 })).toBeNull()
  // Un texte qui commence comme un arrêt sans en être un (détail ajouté, autre nom) : rien.
  expect(workerStopOf({ kind: 'note', text: 'worker arrêté : /login (Please run /login)', at: T0 })).toBeNull()
  expect(workerStopOf({ kind: 'note', text: 'worker arrêté : rate_limit', at: T0 })).toBeNull()
})

test('un last hors forme ne dit rien', () => {
  expect(workerStopOf({ kind: 'note', text: 'worker arrêté : /login', at: Number.NaN })).toBeNull()
  expect(workerStopOf({ kind: 'note', text: 'worker arrêté : /login', at: 'hier' })).toBeNull()
  expect(workerStopOf({ kind: 'note', text: '', at: Number.NaN })).toBeNull()
  expect(workerStopOf('worker arrêté : /login')).toBeNull()
  expect(workerStopOf(null)).toBeNull()
  // La bonne forme, pour mémoire : elle dit l'arrêt.
  expect(workerStopOf({ kind: 'note', text: 'worker arrêté : /login', at: T0 })).toEqual({ text: 'worker arrêté : /login', at: T0 })
})

// ─── Côté worker ──────────────────────────────────────────────────────────

const stopFailure = ($: any, error: unknown, details?: string) =>
  $.classic.StopFailure({ session_id: 'session-A', transcript_path: '/t', cwd: '', hook_event_name: 'StopFailure', error, ...(details ? { error_details: details } : {}) })

/** Le moteur des tests de coordination, une requête qui répond, et un échec de tour qui passe. */
const engine = (on: any) => {
  const w = world(on)
  on('session.model', () => ({ value: OPUS }))
  on('turn.step', async function* ($: unknown, e: any) {
    return yield* stoppedStep(stepUsage(OPUS))($, e)
  })
  const passed: unknown[] = []
  on('classic.StopFailure', (_$: unknown, e: { error?: unknown }) => {
    passed.push(e.error)
    return {}
  })
  return { w, passed }
}

const TICKETS: Ticket[] = [
  { id: 't1', name: 'Un', status: 'todo', sensitive: false, files: ['a.ts'] },
  { id: 'b1', name: 'Autre', status: 'todo', sensitive: false, files: ['b.ts'] },
]

const missionWith = (w: ReturnType<typeof world>): Run => {
  const run = newRun('implement', T0 - 6000, 'Boutique')
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = { tickets: TICKETS, groups: [{ id: 'A', name: 'A', tickets: ['t1'] }, { id: 'B', name: 'B', tickets: ['b1'] }] }
  const mission = { ...(applyReport(base, report, T0 - 5000).board.runs[0] as Run), status: 'active' as const, owner: 'session-B' }
  writeBoard(w, b => ({ ...b, runs: [mission] }))
  return mission
}

/** Le dernier signal de l'entrée de relais de cette session (fichier ou `$.store`). */
const lastOf = (w: ReturnType<typeof world>, runId: string): any => {
  const file = Object.entries(w.files).find(([path]) => path.endsWith('.entry.json') && path.includes(runId))?.[1]
  const stored = w.mem[`relay:${runId}:session-A`] as any
  const entry = file !== undefined ? JSON.parse(file).entry : stored?.entry
  return entry?.last
}

for (const [error, text] of STOPS) {
  test(`un worker arrêté par ${error} : un toast et une note au même texte, sans le détail de l’erreur`, { timeoutMs: 20000 }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const { w, passed } = engine(on)
    const mission = missionWith(w)
    await start($)
    await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[abc123]' } as any)
    const toastsBefore = w.toasts.length
    await stopFailure($, error, 'Please run /login · secret-detail')
    await clock.advance(1000)
    // Liste blanche : le seul toast ajouté est le texte fixé, et la note n'a que son genre, ce texte et sa date.
    expect(w.toasts.slice(toastsBefore)).toEqual([text])
    const last = lastOf(w, mission.id)
    expect(Object.keys(last).sort()).toEqual(['at', 'kind', 'text'])
    expect(last).toEqual({ kind: 'note', text, at: last.at })
    expect(typeof last.at).toBe('number')
    // La suite du handler : l'événement passe au moteur.
    expect(passed).toEqual([error])
  })
}

test('une erreur hors de la liste, ou hors d’un worker : rien de neuf', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w, passed } = engine(on)
  const mission = missionWith(w)
  await start($)
  // Hors d'un worker : rien.
  await stopFailure($, 'authentication_failed')
  await clock.advance(1000)
  expect(w.toasts.filter(t => t.startsWith('worker arrêté'))).toEqual([])
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[abc123]' } as any)
  const before = lastOf(w, mission.id)
  for (const other of ['rate_limit', 'overloaded', 'server_error', 'unknown', 42]) await stopFailure($, other)
  await clock.advance(1000)
  expect(w.toasts.filter(t => t.startsWith('worker arrêté'))).toEqual([])
  expect(lastOf(w, mission.id)).toEqual(before)
  expect(passed).toEqual(['authentication_failed', 'rate_limit', 'overloaded', 'server_error', 'unknown', 42])
  // L'échec du tour d'un spécialiste du worker (agent_id) : rien non plus.
  await $.classic.StopFailure({ session_id: 'session-A', transcript_path: '/t', cwd: '', hook_event_name: 'StopFailure', error: 'model_not_found', agent_id: 'agent-1' } as any)
  await clock.advance(1000)
  expect(w.toasts.filter(t => t.startsWith('worker arrêté'))).toEqual([])
  expect(lastOf(w, mission.id)).toEqual(before)
  // Puis une erreur de la liste au fil principal : cette fois, le toast (le hook a tourné).
  await stopFailure($, 'account_on_hold')
  await clock.advance(1000)
  expect(w.toasts).toContain('worker arrêté : account_on_hold')
})

test('un billing_error repris par le repli Fable : pas de note ; le relais illisible : le toast seul', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' } as any)
  // Une requête partie sur Fable, puis billing_error : le repli reprend le tour, ce n'est pas un arrêt.
  await playStep($, { model: OPUS, effort: 'medium' })
  const before = lastOf(w, mission.id)
  await stopFailure($, 'billing_error')
  await clock.advance(1000)
  // Le repli a bien joué (son toast), et le message de reprise est entré : pas d'arrêt.
  expect(w.toasts).toContain('Fable indisponible : retour sur Opus jusqu’à la fin de la session')
  expect(w.prompts.some(p => p.includes('Fable indisponible : reprends sur Opus'))).toBe(true)
  expect(w.toasts.filter(t => t.startsWith('worker arrêté'))).toEqual([])
  expect(lastOf(w, mission.id)).toEqual(before)
  // Le relais de la session illisible : le toast part quand même, rien ne s'écrit.
  const key = `relay:${mission.id}:session-A`
  w.mem[key] = 'pas une entrée'
  for (const path of Object.keys(w.files)) if (path.endsWith('.entry.json')) w.files[path] = '{"coupé'
  await stopFailure($, 'authentication_failed')
  await clock.advance(1000)
  expect(w.toasts).toContain('worker arrêté : /login')
  expect(w.mem[key]).toBe('pas une entrée')
})

test('un billing_error dont le message de reprise Fable n’entre pas : le worker reste arrêté, sa note part', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' } as any)
  await playStep($, { model: OPUS, effort: 'medium' })
  w.submit.drop = true
  await stopFailure($, 'billing_error')
  await clock.advance(1000)
  // Le repli a joué, sa reprise a été refusée : c'est de là que part la note, une seule fois.
  expect(w.toasts).toContain('Fable indisponible : retour sur Opus jusqu’à la fin de la session')
  expect(w.toasts).toContain('Fable indisponible : le message de reprise n’est pas entré, le worker reste arrêté ; dis-lui de reprendre sur Opus')
  expect(w.toasts.filter(t => t === 'worker arrêté : billing_error')).toHaveLength(1)
  expect(lastOf(w, mission.id)).toMatchObject({ kind: 'note', text: 'worker arrêté : billing_error' })
})

test('un billing_error d’un spécialiste après une requête Fable, la reprise refusée : pas de note d’arrêt', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' } as any)
  await playStep($, { model: OPUS, effort: 'medium' })
  const before = lastOf(w, mission.id)
  w.submit.drop = true
  await $.classic.StopFailure({ session_id: 'session-A', transcript_path: '/t', cwd: '', hook_event_name: 'StopFailure', error: 'billing_error', agent_id: 'agent-1' } as any)
  await clock.advance(1000)
  // Le repli a joué (comportement d'avant, inchangé), mais rien ne dit le worker arrêté.
  expect(w.toasts).toContain('Fable indisponible : le message de reprise n’est pas entré, le worker reste arrêté ; dis-lui de reprendre sur Opus')
  expect(w.toasts.filter(t => t.startsWith('worker arrêté'))).toEqual([])
  expect(lastOf(w, mission.id)).toEqual(before)
})

// ─── Côté manager ─────────────────────────────────────────────────────────

const PLUGIN = 'flow-board'
const KEY = 'board:'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

/** Le manager : un groupe A lancé par l'app, son relais posé par le test. */
const manager = (on: any) => {
  memoryDisk(on)
  const mem: Record<string, unknown> = {}
  const notices: string[] = []
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-M' }))
  on('session.repo', () => ({ value: null }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('ui.notify', (_$: unknown, e: { text: string }) => {
    notices.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'mcp__ccd_session__start_session' }, (_$: unknown, e: { title: string }) => ({
    result: { text: `Started session local_${/Groupe (\w+)/.exec(e.title)?.[1] ?? 'x'}42.` },
  }))
  on('prompt.fill', () => ({ isFilled: true }))
  return { mem, notices }
}

const PLAN = {
  tickets: [
    { id: 'a1', name: 'Synchro', files: ['a.ts'] },
    { id: 'c1', name: 'Statut', files: ['c.ts'] },
  ],
  groups: [
    { id: 'A', name: 'Synchro', tickets: ['a1'] },
    { id: 'C', name: 'Statut', tickets: ['c1'] },
  ],
}

/** Les textes de la ligne du panneau, au terminal. */
const paneTexts = async ($: any): Promise<string> => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const texts = (await pane.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '').replace(/ /g, ' '))
  await pane.unmount()
  return texts.join('\n')
}

/** La mission lancée : le groupe A confié à un worker, la session « fille » déclarée pour lui. */
const launched = async ($: any, on: any, clock: { advance: (ms: number) => Promise<void> }) => {
  const m = manager(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...PLAN } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 'Boutique › Groupe A · Synchro', prompt: 'x' } as any)
  for (let i = 0; i < 2; i++) await clock.advance(1000)
  const runId = (m.mem[KEY] as Board).runs.find(r => r.title === 'Boutique')!.id
  const relay = applyRelay(undefined, runId, 'fille', { kind: 'start', group: 'A' }, T0 + 1500)!
  return { ...m, runId, relay }
}

const settle = async (clock: { advance: (ms: number) => Promise<void> }) => {
  for (let i = 0; i < 6; i++) await clock.advance(1000)
}

test('l’arrêt d’un worker s’affiche et notifie une fois ; la relecture ne renotifie pas ; le signal suivant rend l’état', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { mem, notices, runId, relay } = await launched($, on, clock)
  mem[`relay:${runId}`] = relay
  await settle(clock)
  expect(await paneTexts($)).toContain('en cours · worker')
  // Le worker dépose sa note d'arrêt.
  const stopped = applyRelay(relay, runId, 'fille', { kind: 'note', text: 'worker arrêté : /login' }, T0 + 3000)!
  mem[`relay:${runId}`] = stopped
  await settle(clock)
  const shown = await paneTexts($)
  expect(shown).toContain('worker arrêté : /login')
  expect(shown).not.toContain('en cours · worker')
  expect(notices).toEqual(['worker arrêté : /login'])
  // Relue sans changement, puis avec un autre fichier sans rapport (même note, même date) : pas de nouvelle notification.
  mem[`relay:${runId}`] = applyRelay(stopped, runId, 'autre', { kind: 'start', group: 'C' }, T0 + 4000)!
  await settle(clock)
  expect(notices).toEqual(['worker arrêté : /login'])
  // Le worker repris passe un ticket : l'état revient, la note s'efface de la ligne.
  mem[`relay:${runId}`] = applyRelay(mem[`relay:${runId}`] as any, runId, 'fille', { kind: 'tickets', changes: [{ id: 'a1', status: 'doing' }] }, T0 + 5000)!
  await settle(clock)
  const back = await paneTexts($)
  expect(back).not.toContain('worker arrêté')
  expect(back).toContain('en cours · worker')
  // Un nouvel arrêt, à une autre date : une nouvelle notification.
  mem[`relay:${runId}`] = applyRelay(mem[`relay:${runId}`] as any, runId, 'fille', { kind: 'note', text: 'worker arrêté : account_on_hold' }, T0 + 6000)!
  await settle(clock)
  expect(notices).toEqual(['worker arrêté : /login', 'worker arrêté : account_on_hold'])
})

test('une note ordinaire, un last hors forme ou une entrée hors du plan ne disent rien chez le manager', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { mem, notices, runId, relay } = await launched($, on, clock)
  // Une note ordinaire du worker.
  mem[`relay:${runId}`] = applyRelay(relay, runId, 'fille', { kind: 'note', text: 'revue lancée' }, T0 + 3000)!
  await settle(clock)
  expect(await paneTexts($)).toContain('en cours · worker')
  // Le texte d'arrêt, mais d'une session que le plan ne rattache à aucun groupe (nommée pour un groupe absent, sans ticket du plan).
  const stray = applyRelay(mem[`relay:${runId}`] as any, runId, 'egaree', { kind: 'start', group: 'Z' }, T0 + 3500)!
  mem[`relay:${runId}`] = applyRelay(stray, runId, 'egaree', { kind: 'note', text: 'worker arrêté : /login' }, T0 + 4000)!
  await settle(clock)
  // Un last hors forme pour la session du groupe : rien non plus.
  const broken = JSON.parse(JSON.stringify(mem[`relay:${runId}`]))
  broken.sessions.fille.last = { kind: 'note', text: 'worker arrêté : /login', at: 'hier' }
  broken.sessions.fille.at = T0 + 5000
  mem[`relay:${runId}`] = broken
  await settle(clock)
  const shown = await paneTexts($)
  expect(shown).not.toContain('worker arrêté')
  expect(notices).toEqual([])
})
