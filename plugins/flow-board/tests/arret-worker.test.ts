// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { memoryDisk } from './disque-memoire.ts'
import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'
import { TOOL, start, world, writeBoard } from './monde-coordination.ts'

import { applyReport, emptyBoard, factsRelayOf, isStillActive, newRun } from '../hooks/model.ts'
import { applyRelay, relayForGroup, shownWorkerStop, WORKER_RESUMED_TEXT, workerStopOf, workerStopText } from '../hooks/relay.ts'
import { silenceNote, silentWorkers } from '../hooks/silence.ts'
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

// ─── Le worker silencieux ─────────────────────────────────────────────────

const MIN = 60_000

/** Une mission à deux groupes, A en vol (envoyé à T0, la session « fille » notée ou non), C jamais envoyé. */
const flying = (link: Record<string, unknown> = { at: T0, session: 'fille' }): Run => {
  const run = { ...newRun('implement', T0 - 2_000, 'Boutique'), id: 'm1' } as Run
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const planned = applyReport(base, PLAN, T0 - 1_000).board.runs[0]!
  return { ...planned, groups: planned.groups!.map(g => (g.id === 'A' ? ({ ...g, sends: 1, linked: link } as any) : g)) }
}

test('le silence : 30 minutes sans signal ni compte rendu ; avant, rien ; un nouveau signal le repousse', () => {
  const relay = applyRelay(undefined, 'm1', 'fille', { kind: 'start', group: 'A' }, T0 + 1_000)!
  expect(silentWorkers(flying(), relay, T0 + 1_000 + 29 * MIN)).toEqual([])
  expect(silentWorkers(flying(), relay, T0 + 1_000 + 30 * MIN)).toEqual([{ group: 'A', lastAt: T0 + 1_000 }])
  const signal = applyRelay(relay, 'm1', 'fille', { kind: 'tickets', changes: [{ id: 'a1', status: 'doing' }] }, T0 + 20 * MIN)!
  expect(silentWorkers(flying(), signal, T0 + 1_000 + 30 * MIN)).toEqual([])
  expect(silentWorkers(flying(), signal, T0 + 50 * MIN)).toEqual([{ group: 'A', lastAt: T0 + 20 * MIN }])
})

test('pas de silence pour un groupe revenu, au compte rendu relayé ou déposé, ou dont rien ne mesure le silence', () => {
  const relay = applyRelay(undefined, 'm1', 'fille', { kind: 'start', group: 'A' }, T0 + 1_000)!
  const late = T0 + 2 * 60 * MIN
  // Revenu : plus de lien en vol.
  const back = flying()
  expect(silentWorkers({ ...back, groups: back.groups!.map(g => ({ ...g, linked: undefined, delegated: { at: T0 } }) as any) }, relay, late)).toEqual([])
  // Compte rendu au relais, ou déposé par le manager.
  expect(silentWorkers(flying(), applyRelay(relay, 'm1', 'fille', { kind: 'report', text: 'fini' } as any, T0 + 2_000)!, late)).toEqual([])
  expect(silentWorkers(flying({ at: T0, session: 'fille', managerReport: { at: T0 + 3_000, length: 10 } }), relay, late)).toEqual([])
  // Aucune entrée de relais : la session notée mesure depuis l'envoi (un worker sans outil flow) ; sans elle, rien.
  // Le relais que lit le manager quand aucune session n'y a écrit (aucune source, rien d'illisible).
  const empty = factsRelayOf(undefined, 0, 'm1')
  expect(silentWorkers(flying(), empty, late)).toEqual([{ group: 'A', lastAt: T0 }])
  expect(silentWorkers(flying({ at: T0 }), empty, late)).toEqual([])
  // Relais illisible, date dans le futur ou hors forme : rien.
  expect(silentWorkers(flying(), null, late)).toEqual([])
  expect(silentWorkers(flying(), relay, T0)).toEqual([])
  expect(silentWorkers(flying(), relay, Number.NaN)).toEqual([])
})

test('la note : ListAgents, au repos demander où il en est ; en auto, sans attendre', () => {
  const manual = silenceNote([{ group: 'A', lastAt: Date.UTC(2026, 10, 17, 9, 5) }], false)
  expect(manual).toContain('no signal for 30 minutes from the worker of group A (last signal 09:05 UTC)')
  expect(manual).toContain('Check with ListAgents whether it still runs: if it is working, nothing to do.')
  expect(manual).toContain('write to it by SendMessage to ask where it stands')
  expect(manual).toContain('Then tell the user what you found.')
  expect(manual).not.toContain('without waiting')
  expect(silenceNote([{ group: 'A', lastAt: T0 }], true)).toContain('Auto mode: do it now, without waiting for the user.')
})

/** Chez le manager : sa mission, A envoyé à T0 (session notée), C jamais envoyé ; le relais posé par entrée de session. */
const silentWorld = (on: any) => {
  const w = world(on)
  const run = newRun('implement', T0 - 9_000, 'Boutique')
  const base: Board = { ...emptyBoard('', 'p'), session: 'session-A', deleted: [], runs: [run], activeId: run.id }
  const planned = applyReport(base, PLAN, T0 - 8_000).board.runs[0] as Run
  const sent: Run = { ...planned, status: 'active', owner: 'session-A', groups: planned.groups!.map(g => (g.id === 'A' ? { ...g, sends: 1, linked: { at: T0, session: 'abcd1234' } } : g)) }
  writeBoard(w, b => ({ ...b, session: 'session-A', runs: [sent], activeId: sent.id }))
  /** L'entrée de relais de la session du worker, à une date donnée (un nouveau signal la redate). */
  const signal = (at: number) => {
    const r = applyRelay(undefined, sent.id, 'abcd1234', { kind: 'start', group: 'A' }, at)!
    w.mem[`relay:${sent.id}:abcd1234`] = { v: 1, run: sent.id, session: 'abcd1234', entry: r.sessions.abcd1234 }
  }
  const notes = () => w.prompts.filter(t => t.startsWith('flow-board: no signal for 30 minutes'))
  return { w, run: sent, signal, notes }
}

test('chez le manager : la note part une fois par silence, le relais inchangé ; refusée, elle repart ; un nouveau signal la réarme', { timeoutMs: 120000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w, signal, notes } = silentWorld(on)
  signal(T0 + 1_000)
  await start($)
  await clock.advance(25 * MIN)
  expect(notes()).toEqual([])
  // Passé 30 minutes : la première note est refusée par la discussion, rien n'est marqué ; la suivante entre.
  w.submit.drop = true
  await clock.advance(6 * MIN)
  expect(notes()).toEqual([])
  w.submit.drop = false
  await clock.advance(10_000)
  expect(notes()).toHaveLength(1)
  expect(notes()[0]).toContain('group A')
  // Le relais inchangé, longtemps après : pas de deuxième note.
  await clock.advance(35 * MIN)
  expect(notes()).toHaveLength(1)
  // Le worker signale de nouveau : la note se réarme, et repart 30 minutes après ce signal.
  signal(T0 + 67 * MIN)
  await clock.advance(20 * MIN)
  expect(notes()).toHaveLength(1)
  await clock.advance(15 * MIN)
  expect(notes()).toHaveLength(2)
})

test('chez le manager, aucune session n’a écrit au relais (worker sans outil flow) : la note part 30 minutes après l’envoi', { timeoutMs: 120000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { notes } = silentWorld(on)
  await start($)
  await clock.advance(25 * MIN)
  expect(notes()).toEqual([])
  await clock.advance(10 * MIN)
  expect(notes()).toHaveLength(1)
})

test('chez le manager, un relais lu en partie (une entrée illisible) : aucune note, même longtemps après', { timeoutMs: 120000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w, run, signal, notes } = silentWorld(on)
  signal(T0 + 1_000)
  // Une entrée illisible : elle peut être celle d'un worker qui signale.
  w.mem[`relay:${run.id}:illisible`] = 'pas une entrée'
  await start($)
  await clock.advance(40 * MIN)
  expect(notes()).toEqual([])
})

// ─── La reprise : un worker reparti remplace lui-même sa note d'arrêt ─────
// Invariant fixé par Mathis : « Une note d'arrêt n'est retirée que
// par la session qui l'a posée, et son retrait n'efface ni ne remplace aucun autre signal du relais. »

const LOGIN = 'worker arrêté : /login'

/** Une entrée de worker riche (tickets, commit, tests, revue, sécurité, choix, compte rendu) dont le dernier signal est une note d'arrêt à `stopAt`. */
const richStopped = (stopAt: number) => {
  const steps: [unknown, number][] = [
    [{ kind: 'start', group: 'A' }, T0],
    [{ kind: 'tickets', changes: [{ id: 'a1', status: 'doing' }] }, T0 + 10],
    [{ kind: 'command', commit: 'feat: a', test: true }, T0 + 20],
    [{ kind: 'counts', review: { standards: 1, spec: 2, fixed: 1, bugs: 3, ticket: 'a1' }, security: { advised: true, why: 'réseau', findings: 1, fixed: 1 } }, T0 + 30],
    [{ kind: 'decided', items: [{ what: 'un choix', why: 'parce que' }] }, T0 + 40],
    [{ kind: 'report', text: 'compte rendu' }, T0 + 50],
    [{ kind: 'note', text: LOGIN }, stopAt],
  ]
  return steps.reduce<any>((relay, [event, at]) => applyRelay(relay, 'm1', 'fille', event as any, at)!, undefined)
}

test('la reprise remplace une note d’arrêt plus ancienne que le tour par « worker reparti », datée de maintenant, et rien d’autre', () => {
  const before = richStopped(T0 + 100)
  const after = applyRelay(before, 'm1', 'fille', { kind: 'resume', turnAt: T0 + 200 }, T0 + 300)!
  const was: any = before.sessions.fille
  const now: any = after.sessions.fille
  expect(now.last).toEqual({ kind: 'note', text: WORKER_RESUMED_TEXT, at: T0 + 300 })
  expect(now.at).toBe(T0 + 300)
  // Champ par champ : seuls le dernier signal et la date de l'entrée changent.
  const keys = new Set([...Object.keys(was), ...Object.keys(now)])
  for (const key of keys) if (key !== 'last' && key !== 'at') expect([key, now[key]]).toEqual([key, was[key]])
  // « worker reparti » n'est pas un texte d'arrêt : un manager, rechargé ou non, le lit comme une note ordinaire.
  expect(WORKER_RESUMED_TEXT).toBe('worker reparti')
  expect(workerStopOf(now.last)).toBeNull()
})

test('la reprise ne change rien sans note d’arrêt plus ancienne que le tour : rien de neuf (null)', () => {
  const stopped = richStopped(T0 + 100)
  // La note du tour même (posée à son début ou après), ou datée dans le futur : jamais remplacée par la reprise.
  expect(applyRelay(stopped, 'm1', 'fille', { kind: 'resume', turnAt: T0 + 100 }, T0 + 300)).toBeNull()
  expect(applyRelay(stopped, 'm1', 'fille', { kind: 'resume', turnAt: T0 + 50 }, T0 + 300)).toBeNull()
  const future = richStopped(T0 + 10_000_000)
  expect(applyRelay(future, 'm1', 'fille', { kind: 'resume', turnAt: T0 + 300 }, T0 + 400)).toBeNull()
  // Un autre dernier signal : un commit, une note ordinaire, une note dont le texte n'est pas de la liste fermée, « worker reparti » lui-même.
  const commit = applyRelay(stopped, 'm1', 'fille', { kind: 'command', commit: 'fix: b' }, T0 + 150)!
  expect(applyRelay(commit, 'm1', 'fille', { kind: 'resume', turnAt: T0 + 200 }, T0 + 300)).toBeNull()
  for (const text of ['revue lancée', 'worker arrêté : rate_limit', `${LOGIN} (détail)`, WORKER_RESUMED_TEXT]) {
    const noted = applyRelay(stopped, 'm1', 'fille', { kind: 'note', text }, T0 + 150)!
    expect(applyRelay(noted, 'm1', 'fille', { kind: 'resume', turnAt: T0 + 200 }, T0 + 300)).toBeNull()
  }
  // Une note d'arrêt à la date hors forme, une date de tour hors forme : rien.
  const broken = JSON.parse(JSON.stringify(stopped))
  broken.sessions.fille.last = { kind: 'note', text: LOGIN, at: 'hier' }
  expect(applyRelay(broken, 'm1', 'fille', { kind: 'resume', turnAt: T0 + 200 }, T0 + 300)).toBeNull()
  expect(applyRelay(stopped, 'm1', 'fille', { kind: 'resume', turnAt: Number.NaN }, T0 + 300)).toBeNull()
  // Aucune entrée pour cette session : la reprise n'en crée pas, et l'entrée d'une autre session n'est jamais touchée.
  expect(applyRelay(undefined, 'm1', 'fille', { kind: 'resume', turnAt: T0 }, T0 + 1)).toBeNull()
  expect(applyRelay(stopped, 'm1', 'autre', { kind: 'resume', turnAt: T0 + 200 }, T0 + 300)).toBeNull()
})

test('la fermeture attend un worker reparti après son compte rendu, puis le lâche à la fin de sa session', () => {
  const group = { id: 'A', name: 'A', tickets: ['a1'], delegated: { at: T0 - 1 } } as any
  const stopped = richStopped(T0 + 100)
  // Compte rendu, puis arrêt : actif (la note est postérieure au compte rendu, comme aujourd'hui).
  expect(isStillActive(stopped, group, [group])).toBe(true)
  const resumed = applyRelay(stopped, 'm1', 'fille', { kind: 'resume', turnAt: T0 + 200 }, T0 + 300)!
  expect(isStillActive(resumed, group, [group])).toBe(true)
  const ended = applyRelay(resumed, 'm1', 'fille', { kind: 'end' }, T0 + 400)!
  expect(isStillActive(ended, group, [group])).toBe(false)
})

test('la note montrée sur la ligne d’un groupe : jamais après une fin de session postérieure ou égale ; une note postérieure à la fin se montre', () => {
  const stop = { kind: 'note', text: LOGIN, at: T0 + 100 }
  expect(shownWorkerStop({ last: stop })).toEqual({ text: LOGIN, at: T0 + 100 })
  expect(shownWorkerStop({ last: stop, endedAt: T0 + 100 })).toBeNull()
  expect(shownWorkerStop({ last: stop, endedAt: T0 + 200 })).toBeNull()
  expect(shownWorkerStop({ last: stop, endedAt: T0 + 50 })).toEqual({ text: LOGIN, at: T0 + 100 })
  // Une fin relue hors forme ne cache pas la note.
  expect(shownWorkerStop({ last: stop, endedAt: 'hier' })).toEqual({ text: LOGIN, at: T0 + 100 })
  expect(shownWorkerStop({ last: { kind: 'note', text: WORKER_RESUMED_TEXT, at: T0 + 300 } })).toBeNull()
  expect(shownWorkerStop(null)).toBeNull()
})

test('un groupe relancé dans une session neuve : l’ancienne entrée garde sa note, jamais touchée ; la ligne lit la nouvelle', () => {
  const group = { id: 'A', name: 'A', tickets: ['a1'], linked: { at: T0 - 1 } } as any
  const old = richStopped(T0 + 100)
  const fresh = applyRelay(old, 'm1', 'neuve', { kind: 'start', group: 'A' }, T0 + 500)!
  expect(fresh.sessions.fille).toEqual(old.sessions.fille)
  const read = relayForGroup(fresh, group, [group])
  // La ligne lit l'entrée neuve (sa date), qui n'a pas de note : « en cours ».
  expect(read?.at).toBe(T0 + 500)
  expect(shownWorkerStop(read)).toBeNull()
  // La reprise de la session neuve ne touche pas l'ancienne entrée.
  expect(applyRelay(fresh, 'm1', 'neuve', { kind: 'resume', turnAt: T0 + 600 }, T0 + 700)).toBeNull()
})

/** Le moteur des tests de l'arrêt (le monde répond déjà aux tours du fil principal), ses écritures de relais comptées. */
const turnsEngine = (on: any) => {
  const out = engine(on)
  // Les écritures de l'entrée de relais de la session, au fichier et au magasin, comptées sans être refusées (sauf demande).
  const writes = { file: 0, store: 0, refuseFile: false, refuseStore: false }
  out.w.probe.refuseWrite = (path: string) => {
    if (!path.endsWith('.entry.json')) return false
    writes.file += 1
    return writes.refuseFile
  }
  out.w.probe.refuseStore = (key: string) => {
    if (!key.startsWith('relay:') || !key.endsWith(':session-A')) return false
    writes.store += 1
    return writes.refuseStore
  }
  return { ...out, writes }
}

let turnSeq = 0
/** Un tour du fil principal : son début, puis sa fin (`reason`), l'horloge avancée entre les deux et après. */
const turnOf = async ($: any, clock: { advance: (ms: number) => Promise<void> }, during?: () => Promise<void>, reason: 'answer' | 'aborted' | 'error' = 'answer') => {
  const turnId = `t${++turnSeq}`
  await clock.advance(1000)
  await $.turn.start({ turnId, text: 'x' })
  await clock.advance(1000)
  if (during) await during()
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: reason === 'aborted', turnId, reason })
  await clock.advance(1000)
  await clock.advance(1000)
}

/** L'entrée de relais de cette session la plus récente de ses deux copies (fichier, magasin), comme la relecture. */
const entryOf = (w: ReturnType<typeof world>, runId: string): any => {
  const file = Object.entries(w.files).find(([path]) => path.endsWith('.entry.json') && path.includes(runId))?.[1]
  const fromFile = file !== undefined ? JSON.parse(file).entry : undefined
  const fromStore = (w.mem[`relay:${runId}:session-A`] as any)?.entry
  return [fromFile, fromStore].filter(Boolean).sort((x, y) => y.at - x.at)[0]
}

/** Un worker délégué dont un tour vient d'échouer sur /login : sa note est le dernier signal. */
const stoppedWorker = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: T0 })
  const t = turnsEngine(on)
  const mission = missionWith(t.w)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[abc123]' } as any)
  await turnOf($, clock, () => stopFailure($, 'authentication_failed'), 'error')
  expect(entryOf(t.w, mission.id).last).toMatchObject({ kind: 'note', text: LOGIN })
  return { ...t, clock, mission }
}

test('le worker arrêté puis un tour réussi : sa note devient « worker reparti », le reste de son entrée ne bouge pas', { timeoutMs: 30000 }, async ($, on) => {
  const { w, clock, mission } = await stoppedWorker($, on)
  const before = entryOf(w, mission.id)
  await turnOf($, clock)
  const after = entryOf(w, mission.id)
  expect(after.last).toEqual({ kind: 'note', text: WORKER_RESUMED_TEXT, at: after.at })
  expect(after.at).toBeGreaterThan(before.last.at)
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (key !== 'last' && key !== 'at') expect([key, after[key]]).toEqual([key, before[key]])
  // Un tour réussi de plus : plus de note à remplacer, rien ne s'écrit.
  const written = entryOf(w, mission.id)
  await turnOf($, clock)
  expect(entryOf(w, mission.id)).toEqual(written)
})

test('les deux ordres d’un tour en échec (échec puis fin normale, fin normale puis échec) : la note reste ; le tour réussi suivant la remplace', { timeoutMs: 30000 }, async ($, on) => {
  const { w, clock, mission } = await stoppedWorker($, on)
  // Échec puis fin normale du même tour, une note plus ancienne déjà là : la note nouvelle reste.
  await turnOf($, clock, () => stopFailure($, 'account_on_hold'))
  expect(entryOf(w, mission.id).last).toMatchObject({ kind: 'note', text: 'worker arrêté : account_on_hold' })
  // Fin normale puis échec, sans l'attendre : le dépôt de la note passe après la reprise, la note reste.
  const turnId = `t${++turnSeq}`
  await clock.advance(1000)
  await $.turn.start({ turnId, text: 'x' })
  await clock.advance(1000)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId, reason: 'answer' })
  await stopFailure($, 'model_not_found')
  await clock.advance(1000)
  await clock.advance(1000)
  expect(entryOf(w, mission.id).last).toMatchObject({ kind: 'note', text: 'worker arrêté : model_not_found' })
  await turnOf($, clock)
  expect(entryOf(w, mission.id).last).toMatchObject({ kind: 'note', text: WORKER_RESUMED_TEXT })
})

test('un tour interrompu, en échec hors liste, d’un spécialiste, ou dont le début n’a pas été vu : la note reste', { timeoutMs: 30000 }, async ($, on) => {
  const { w, clock, mission } = await stoppedWorker($, on)
  const note = entryOf(w, mission.id)
  await turnOf($, clock, undefined, 'aborted')
  await turnOf($, clock, () => stopFailure($, 'overloaded'), 'error')
  expect(entryOf(w, mission.id)).toEqual(note)
  // La fin du tour d'un spécialiste du worker.
  await $.turn.start({ turnId: 'sp1', text: 'x', agentId: 'agent-1' } as any)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 'sp1', reason: 'answer', agentId: 'agent-1' } as any)
  await clock.advance(1000)
  expect(entryOf(w, mission.id)).toEqual(note)
  // Une fin dont le mod n'a pas vu le début (après /reload-plugins) : rien ; le tour suivant, vu, remplace.
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 'jamais-vu', reason: 'answer' })
  await clock.advance(1000)
  await clock.advance(1000)
  expect(entryOf(w, mission.id)).toEqual(note)
  await turnOf($, clock)
  expect(entryOf(w, mission.id).last).toMatchObject({ kind: 'note', text: WORKER_RESUMED_TEXT })
})

test('un ticket relayé avant la fin du tour remplace la note ; la reprise ne change plus rien', { timeoutMs: 30000 }, async ($, on) => {
  const { w, clock, mission } = await stoppedWorker($, on)
  await turnOf($, clock, async () => {
    await $.tool.call({ tool: TOOL, set: [{ id: 't1', status: 'doing' }] } as any)
  })
  expect(entryOf(w, mission.id).last).toMatchObject({ kind: 'ticket', ticket: 't1' })
})

test('sans note à remplacer, la fin d’un tour relit l’entrée et n’écrit rien ; hors d’un worker, rien non plus', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w, writes } = turnsEngine(on)
  const mission = missionWith(w)
  await start($)
  await turnOf($, clock)
  expect(writes).toMatchObject({ file: 0, store: 0 })
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[abc123]' } as any)
  await clock.advance(1000)
  // D'abord l'effet : une note d'arrêt, puis un tour réussi qui la remplace (une écriture).
  await turnOf($, clock, () => stopFailure($, 'authentication_failed'), 'error')
  writes.file = 0
  writes.store = 0
  await turnOf($, clock)
  expect(writes.file + writes.store).toBeGreaterThan(0)
  expect(entryOf(w, mission.id).last).toMatchObject({ kind: 'note', text: WORKER_RESUMED_TEXT })
  // Puis plus de note à remplacer : les tours suivants n'écrivent rien.
  writes.file = 0
  writes.store = 0
  for (let i = 0; i < 3; i++) await turnOf($, clock)
  expect(writes).toMatchObject({ file: 0, store: 0 })
})

test('l’entrée illisible : rien n’est réécrit ; l’écriture ratée : la note reste, le tour suivant réessaie ; le fichier refusé : la reprise au magasin l’emporte', { timeoutMs: 30000 }, async ($, on) => {
  const { w, clock, mission, writes } = await stoppedWorker($, on)
  // Écriture ratée partout : la note reste.
  writes.refuseFile = true
  writes.refuseStore = true
  await turnOf($, clock)
  expect(entryOf(w, mission.id).last).toMatchObject({ kind: 'note', text: LOGIN })
  // Le fichier seul refusé : la reprise s'écrit au magasin, et la relecture la prend (la plus récente).
  writes.refuseStore = false
  await turnOf($, clock)
  expect(entryOf(w, mission.id).last).toMatchObject({ kind: 'note', text: WORKER_RESUMED_TEXT })
})

test('une entrée de relais illisible n’est jamais réécrite par la reprise', { timeoutMs: 30000 }, async ($, on) => {
  const { w, clock, mission } = await stoppedWorker($, on)
  const key = `relay:${mission.id}:session-A`
  const files = Object.keys(w.files).filter(path => path.endsWith('.entry.json'))
  for (const path of files) w.files[path] = '{"coupé'
  if (files.length === 0) w.mem[key] = 'pas une entrée'
  await turnOf($, clock)
  for (const path of files) expect(w.files[path]).toBe('{"coupé')
  if (files.length === 0) expect(w.mem[key]).toBe('pas une entrée')
  // L'entrée redevenue lisible (la note toujours là) : le tour réussi suivant la remplace, la reprise a bien tourné.
  for (const path of files) w.files[path] = JSON.stringify({ v: 1, run: mission.id, session: 'session-A', entry: { tickets: {}, commits: 0, startedAt: T0, at: T0 + 1, last: { kind: 'note', text: LOGIN, at: T0 + 1 } } })
  if (files.length === 0) w.mem[key] = { v: 1, run: mission.id, session: 'session-A', entry: { tickets: {}, commits: 0, startedAt: T0, at: T0 + 1, last: { kind: 'note', text: LOGIN, at: T0 + 1 } } }
  await turnOf($, clock)
  expect(entryOf(w, mission.id).last).toMatchObject({ kind: 'note', text: WORKER_RESUMED_TEXT })
})

test('chez le manager : « worker reparti » se lit « en cours » ; la fin postérieure à la note dit « worker terminé » ; un nouvel arrêt renotifie', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { mem, notices, runId, relay } = await launched($, on, clock)
  const stopped = applyRelay(relay, runId, 'fille', { kind: 'note', text: LOGIN }, T0 + 3000)!
  mem[`relay:${runId}`] = stopped
  await settle(clock)
  expect(await paneTexts($)).toContain(LOGIN)
  expect(notices).toEqual([LOGIN])
  // Le tour réussi suivant : « en cours ».
  const resumed = applyRelay(stopped, runId, 'fille', { kind: 'resume', turnAt: T0 + 3500 }, T0 + 4000)!
  mem[`relay:${runId}`] = resumed
  await settle(clock)
  const back = await paneTexts($)
  expect(back).not.toContain('worker arrêté')
  expect(back).not.toContain('reparti')
  expect(back).toContain('en cours · worker')
  // Un nouvel arrêt après la reprise : montré et notifié de nouveau.
  const again = applyRelay(resumed, runId, 'fille', { kind: 'note', text: LOGIN }, T0 + 5000)!
  mem[`relay:${runId}`] = again
  await settle(clock)
  expect(await paneTexts($)).toContain(LOGIN)
  expect(notices).toEqual([LOGIN, LOGIN])
  // La session finie après la note : « worker terminé », sans la note.
  mem[`relay:${runId}`] = applyRelay(again, runId, 'fille', { kind: 'end' }, T0 + 6000)!
  await settle(clock)
  const ended = await paneTexts($)
  expect(ended).not.toContain('worker arrêté')
  expect(ended).toContain('worker terminé')
})

test('chez le manager : la session finie après sa note, tous ses tickets faits, dit « worker terminé · à rendre », sans la note', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { mem, runId, relay } = await launched($, on, clock)
  const done = applyRelay(relay, runId, 'fille', { kind: 'tickets', changes: [{ id: 'a1', status: 'done' }] }, T0 + 2500)!
  const stopped = applyRelay(done, runId, 'fille', { kind: 'note', text: LOGIN }, T0 + 3000)!
  // Fin à la même date que la note : elle l'emporte aussi.
  mem[`relay:${runId}`] = applyRelay(stopped, runId, 'fille', { kind: 'end' }, T0 + 3000)!
  await settle(clock)
  const shown = await paneTexts($)
  expect(shown).not.toContain('worker arrêté')
  expect(shown).toContain('worker terminé · à rendre')
})

// ─── La relance : une session relancée sous le même id après sa fin retire sa fin gardée ───

test('la relance retire la seule fin gardée de l’entrée ; sans fin ni entrée, rien', () => {
  const ended = applyRelay(richStopped(T0 + 100), 'm1', 'fille', { kind: 'end' }, T0 + 200)!
  const revived = applyRelay(ended, 'm1', 'fille', { kind: 'revive' }, T0 + 300)!
  const was: any = ended.sessions.fille
  const now: any = revived.sessions.fille
  expect(now.endedAt).toBeUndefined()
  expect(now.at).toBe(T0 + 300)
  // Champ par champ : seuls la fin et la date de l'entrée changent, la note d'arrêt reste son dernier signal.
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) if (key !== 'endedAt' && key !== 'at') expect([key, now[key]]).toEqual([key, was[key]])
  expect(now.last).toEqual({ kind: 'note', text: LOGIN, at: T0 + 100 })
  // La fin suivante se pose de nouveau.
  expect(applyRelay(revived, 'm1', 'fille', { kind: 'end' }, T0 + 400)!.sessions.fille!.endedAt).toBe(T0 + 400)
  expect(applyRelay(richStopped(T0 + 100), 'm1', 'fille', { kind: 'revive' }, T0 + 300)).toBeNull()
  expect(applyRelay(undefined, 'm1', 'fille', { kind: 'revive' }, T0 + 300)).toBeNull()
  expect(applyRelay(ended, 'm1', 'autre', { kind: 'revive' }, T0 + 300)).toBeNull()
  // Une entrée close dont le dernier signal n'est pas une note d'arrêt (une session relancée pour autre chose) : rien.
  const committed = applyRelay(applyRelay(richStopped(T0 + 100), 'm1', 'fille', { kind: 'command', commit: 'fix: c' }, T0 + 150)!, 'm1', 'fille', { kind: 'end' }, T0 + 200)!
  expect(applyRelay(committed, 'm1', 'fille', { kind: 'revive' }, T0 + 300)).toBeNull()
  // Une session finie ne reprend pas : une reprise passée dans la file après sa fin ne la ferait plus compter active
  // pour toujours (compte rendu à +50, note à +100, fin à +200, reprise d'un tour commencé à +300).
  const group = { id: 'A', name: 'A', tickets: ['a1'], delegated: { at: T0 - 1 } } as any
  expect(applyRelay(ended, 'm1', 'fille', { kind: 'resume', turnAt: T0 + 300 }, T0 + 310)).toBeNull()
  expect(isStillActive(ended, group, [group])).toBe(false)
})

test('compte rendu, arrêt, fin, relance : la fermeture attend la session relancée, puis la lâche à sa fin suivante', () => {
  const group = { id: 'A', name: 'A', tickets: ['a1'], delegated: { at: T0 - 1 } } as any
  const ended = applyRelay(richStopped(T0 + 100), 'm1', 'fille', { kind: 'end' }, T0 + 200)!
  expect(isStillActive(ended, group, [group])).toBe(false)
  const revived = applyRelay(ended, 'm1', 'fille', { kind: 'revive' }, T0 + 300)!
  expect(isStillActive(revived, group, [group])).toBe(true)
  const resumed = applyRelay(revived, 'm1', 'fille', { kind: 'resume', turnAt: T0 + 300 }, T0 + 400)!
  expect(isStillActive(resumed, group, [group])).toBe(true)
  expect(isStillActive(applyRelay(resumed, 'm1', 'fille', { kind: 'end' }, T0 + 500)!, group, [group])).toBe(false)
})

test('le worker arrêté, sa session finie puis relancée sous le même id : sa note revient au début du tour, « worker reparti » après un tour réussi, sa fin suivante se pose', { timeoutMs: 30000 }, async ($, on) => {
  const { w, clock, mission } = await stoppedWorker($, on)
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  await clock.advance(1000)
  const ended = entryOf(w, mission.id)
  expect(typeof ended.endedAt).toBe('number')
  expect(shownWorkerStop(ended)).toBeNull()
  // Relancée : le premier tour commence, la fin gardée part, la note se montre de nouveau ; ce tour réussit.
  let atStart: any
  await turnOf($, clock, async () => {
    atStart = entryOf(w, mission.id)
  })
  expect(atStart.endedAt).toBeUndefined()
  expect(shownWorkerStop(atStart)).toMatchObject({ text: LOGIN })
  const after = entryOf(w, mission.id)
  expect(after.last).toMatchObject({ kind: 'note', text: WORKER_RESUMED_TEXT })
  expect(after.endedAt).toBeUndefined()
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  await clock.advance(1000)
  expect(typeof entryOf(w, mission.id).endedAt).toBe('number')
})

test('la relance refusée à l’écriture : la fin reste, la ligne dit « worker terminé » ; le tour suivant la réessaie, puis la reprise', { timeoutMs: 30000 }, async ($, on) => {
  const { w, clock, mission, writes } = await stoppedWorker($, on)
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  await clock.advance(1000)
  writes.refuseFile = true
  writes.refuseStore = true
  await turnOf($, clock)
  const kept = entryOf(w, mission.id)
  expect(typeof kept.endedAt).toBe('number')
  expect(kept.last).toMatchObject({ kind: 'note', text: LOGIN })
  expect(shownWorkerStop(kept)).toBeNull()
  writes.refuseFile = false
  writes.refuseStore = false
  await turnOf($, clock)
  const after = entryOf(w, mission.id)
  expect(after.endedAt).toBeUndefined()
  expect(after.last).toMatchObject({ kind: 'note', text: WORKER_RESUMED_TEXT })
})
