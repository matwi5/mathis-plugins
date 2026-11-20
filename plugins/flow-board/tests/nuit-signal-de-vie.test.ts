// Stockage : les deux modes (scripts/check.sh relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).
import { expect, mock, test } from 'claude-code/testing'

import { cooStatement, nightViewsOf, statementText } from '../hooks/coo.ts'
import { isAutoReopenProposed, noteAutoReopens } from '../hooks/coo-liveness.ts'
import { AUTO_STOPS, detachOnLoad, emptyBoard, newRun, parkActive, switchOnAuto } from '../hooks/model.ts'
import { nightBlocks, parseNightLog, reopenCommand, type NightMissionView } from '../hooks/night.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { storageMode } from './stockage.ts'

// La nuit et le signal de vie (`hooks/liveness.ts`) : une mission en auto, aux groupes ouverts, dont
// la discussion d'arrière-plan est dite arrêtée est proposée « à rouvrir » ; une mission dont la discussion est dite
// vivante ne l'est jamais ; « inconnu » ne change rien. Invariant : « La nuit ne rouvre jamais une discussion dont la
// session tourne encore, ni une mission dont la discussion tient une autre mission en cours ; la commande de
// réouverture ne porte que l'id contrôlé de la mission et de la discussion et un texte fixe sans apostrophe ; le COO
// n'allume jamais l'auto ; le verdict n'ajoute une proposition que sur « arrêtée », jamais sur « inconnu ». »

const NOW = 300_000_000
const none = () => undefined

const view = (over: Partial<NightMissionView> = {}): NightMissionView => ({
  id: 'm1',
  title: 'Mission',
  isAuto: true,
  isPaused: false,
  isOpen: true,
  isEnded: false,
  isRelaunchPause: false,
  heldByUser: [],
  hasOpenGroups: true,
  questions: [],
  waveDue: [],
  holds: [],
  ...over,
})
const reopens = (v: NightMissionView) => nightBlocks([v], none, NOW).filter(b => b.act === 'reopen')

test('auto arrêtée : « à rouvrir » proposé (neuf), marqué `isAuto`', () => {
  expect(reopens(view({ liveness: 'stopped' }))).toEqual([{ mission: 'm1', title: 'Mission', act: 'reopen', isAuto: true }])
})

test('auto vivante, auto inconnu : pas de « à rouvrir », comme aujourd’hui', () => {
  for (const liveness of ['alive', 'unknown', undefined] as const) expect(reopens(view(liveness ? { liveness } : {}))).toEqual([])
})

test('pause, inconnu ou arrêtée : « à rouvrir » comme aujourd’hui (ouverte nulle part, ou « discussion fermée »)', () => {
  const nowhere = view({ isAuto: false, isPaused: true, isOpen: false })
  const ended = view({ isAuto: false, isPaused: true, isEnded: true })
  for (const v of [nowhere, ended])
    for (const liveness of ['unknown', 'stopped', undefined] as const) expect(reopens({ ...v, ...(liveness ? { liveness } : {}) })).toEqual([{ mission: 'm1', title: 'Mission', act: 'reopen' }])
})

test('pause, vivante : jamais « à rouvrir » (R261), même en pause « discussion fermée »', () => {
  expect(reopens(view({ isAuto: false, isPaused: true, isOpen: false, liveness: 'alive' }))).toEqual([])
  expect(reopens(view({ isAuto: false, isPaused: true, isEnded: true, liveness: 'alive' }))).toEqual([])
})

test('sans groupes ouverts : jamais proposée, quel que soit le verdict', () => {
  expect(reopens(view({ liveness: 'stopped', hasOpenGroups: false }))).toEqual([])
  expect(reopens(view({ isAuto: false, isPaused: true, isOpen: false, hasOpenGroups: false, liveness: 'stopped' }))).toEqual([])
})

test('les autres blocages ne changent pas avec le verdict', () => {
  const busy = view({ waveDue: ['B'], questions: [{ id: 'sans-suite:A#1', group: 'A' }, { id: 'relance:C#2', group: 'C' }] })
  const before = nightBlocks([busy], none, NOW)
  for (const liveness of ['alive', 'unknown'] as const) expect(nightBlocks([{ ...busy, liveness }], none, NOW)).toEqual(before)
  expect(nightBlocks([{ ...busy, liveness: 'stopped' }], none, NOW)).toEqual([...before, { mission: 'm1', title: 'Mission', act: 'reopen', isAuto: true }])
})

test('les vues de nuit portent le verdict remis à `nightViewsOf` ; sans lui, aucun', () => {
  const run: Run = { ...newRun('implement', NOW, 'Boutique'), status: 'active', owner: 'sb' }
  const board: Board = { ...emptyBoard('', 'p'), deleted: [], runs: [run] }
  expect(nightViewsOf(board, { waveDue: () => [], liveness: () => 'stopped' })[0]!.liveness).toBe('stopped')
  expect(nightViewsOf(board, { waveDue: () => [] })[0]!.liveness).toBeUndefined()
})

test('la ligne « Nuit » d’une mission en auto arrêtée dit ce qui est vrai ; la suite (pid, commande, note) est celle d’une mission en pause', () => {
  const run: Run = { ...newRun('implement', NOW, 'Boutique'), status: 'active', owner: '5e1f0a2b-7c3d-4e8f-9a1b-2c3d4e5f6a7b' }
  const board: Board = { ...emptyBoard('', 'p'), deleted: [], runs: [run] }
  const reopen = { how: 'cli' as const, command: `claude --bg --resume 5e1f0a2b-7c3d-4e8f-9a1b-2c3d4e5f6a7b 'texte'`, session: '5e1f0a2b-7c3d-4e8f-9a1b-2c3d4e5f6a7b' }
  const lineOf = (isAuto: boolean) => {
    const block = { mission: run.id, title: run.title, act: 'reopen' as const, ...(isAuto ? { isAuto: true as const } : {}) }
    const text = statementText(cooStatement(board, { now: NOW, night: { until: NOW + 3_600_000, id: 'w1', blocks: [block], reopens: { [run.id]: reopen } } }))
    return text.split('\n').find(l => l.includes('night gesture: reopen'))!
  }
  const auto = lineOf(true)
  const paused = lineOf(false)
  expect(auto).toMatch(/auto on with open groups, but its background discussion no longer runs \(its session has no process\); night gesture: reopen, /)
  expect(auto).not.toMatch(/auto paused by the dashboard/)
  expect(paused).toMatch(/auto paused by the dashboard with open groups/)
  const tail = (l: string) => l.slice(l.indexOf('; night gesture: reopen, '))
  expect(tail(auto)).toBe(tail(paused))
})

test('la mémoire des propositions : par surveillance et par mission, seulement « à rouvrir » d’une mission en auto', () => {
  noteAutoReopens('w1', [
    { mission: 'a', act: 'reopen', isAuto: true },
    { mission: 'b', act: 'reopen' },
    { mission: 'c', act: 'wave' },
  ])
  expect(isAutoReopenProposed('w1', 'a')).toBe(true)
  expect(isAutoReopenProposed('w2', 'a')).toBe(false)
  expect(isAutoReopenProposed('w1', 'b')).toBe(false)
  expect(isAutoReopenProposed('w1', 'c')).toBe(false)
})

// ─── Chez le COO : la note d'une réouverture (monde à faux moteur) ─────────

const T0 = 800_000_000
const OWNER = '5e1f0a2b-7c3d-4e8f-9a1b-2c3d4e5f6a7b'
const isFileMode = storageMode() === 'fichier'

/** Une mission aux groupes ouverts, tenue par `owner` : en auto (allumé par sa discussion), prise à T0 - 50 s. */
const autoRun = (title: string, id = 'run-1', owner = OWNER): Run =>
  ({
    ...newRun('implement', T0 - 60_000, title),
    id,
    status: 'active',
    owner,
    bornIn: owner,
    claim: { boot: 'boot-1', at: T0 - 50_000 },
    auto: { onAt: T0 - 30_000, onBy: owner },
    tickets: [
      { id: '1', name: 'Un', status: 'done' },
      { id: '2', name: 'Deux', status: 'todo' },
    ],
    groups: [
      { id: 'A', name: 'A', tickets: ['1'] },
      { id: 'B', name: 'B', tickets: ['2'] },
    ],
    waiting: [],
  }) as unknown as Run

/**
 * Les fichiers de Claude Code sous le dossier que rend `claudeHome` (posés par la fin de leur chemin) : le job de la
 * discussion `owner`, et les fichiers de session des discussions `alive` ; `fs.stat` leur répond.
 */
const claudeFiles = (on: any, w: World, owner: string, alive: () => readonly string[]) => {
  w.files[`jobs/${owner.slice(0, 8)}/state.json`] = JSON.stringify({ sessionId: owner, resumeSessionId: owner, state: 'done', updatedAt: new Date(T0 - 10_000).toISOString() })
  const sessionKey = (i: number) => `sessions/${100 + i}.json`
  w.probe.list = dir => (dir.endsWith('/.claude/sessions') ? alive().map((_, i) => `${100 + i}.json`) : undefined)
  const sync = () => alive().forEach((id, i) => (w.files[sessionKey(i)] = JSON.stringify({ pid: 100 + i, sessionId: id })))
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    sync()
    const ours = Object.keys(w.files).filter(k => !k.startsWith('/') && (k.startsWith('jobs/') || k.startsWith('sessions/')))
    const key = ours.find(k => e.path.endsWith(`/.claude/${k}`))
    // Un dossier : le parent d'un fichier posé (le dossier du job).
    if (key === undefined && ours.some(k => e.path.endsWith(`/.claude/${k.slice(0, k.lastIndexOf('/'))}`))) return { value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false } } as any
    if (key === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file', size: w.files[key]!.length, mtimeMs: 1, isLink: false } } as any
  })
}

const night = async ($: any, on: any, runs: Run[], alive: () => readonly string[] = () => []) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  claudeFiles(on, w, OWNER, alive)
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  await openCoo($, clock)
  for (const key of ['coo-night-ask', 'coo-night-confirm']) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
    expect(await pane.find({ key })).toBeDefined()
    await pane.press({ key })
    await pane.unmount()
  }
  await settle(clock, 1)
  const path = Object.keys(w.files).find(p => p.endsWith('.nuit.json'))
  const raw = path ? JSON.parse(w.files[path]!) : w.mem[Object.keys(w.mem).find(k => k.startsWith('coo-night:'))!]
  const watch = (typeof raw === 'string' ? JSON.parse(raw) : raw).id as string
  return { clock, w, watch }
}
const statementOf = async ($: any): Promise<string> => {
  const out = (await $.prompt.submit({ text: 'Message', origin: { kind: 'peer' } } as any)) as any
  await $.turn.start({ turnId: 'peer', text: 'Message' } as any)
  await $.turn.complete({ answer: 'Vu.', durationMs: 10, isAborted: false, turnId: 'peer', reason: 'answer' } as any)
  return ((out?.context ?? []) as string[]).join('\n')
}
const note = async ($: any, mission: string, watch: string) => String(((await $.tool.call({ tool: TOOL, coordinate: { night: [{ mission, watch, act: 'reopen' }] } } as any)) as any).result)
const reopenLog = (w: World): string[] => {
  const path = Object.keys(w.files).find(p => p.endsWith('.nuit-journal.jsonl'))
  const key = Object.keys(w.mem).find(k => k.startsWith('coo-night-log:'))
  const read = parseNightLog((path ? w.files[path] : key ? String(w.mem[key]) : '') ?? '')
  return read.state === 'read' ? read.lines.map(l => JSON.parse(l)).filter(l => l.act === 'reopen').map(l => l.result) : []
}

test('auto arrêtée : proposée « à rouvrir », la commande d’aujourd’hui ; la note, arrivée quand la discussion relancée a son fichier de session, est acceptée', { timeoutMs: 40000 }, async ($, on) => {
  let alive: string[] = []
  const { w, watch } = await night($, on, [autoRun('Arrêtée en auto')], () => alive)
  const text = await statementOf($)
  if (!isFileMode) {
    // Hors de ~/.claude (`$.store`), aucun dossier de Claude Code : tout verdict est « inconnu », rien n'est proposé.
    expect(text).not.toMatch(/night gesture: reopen/)
    return
  }
  const line = text.split('\n').find(l => /night gesture: reopen/.test(l))!
  expect(line).toMatch(/auto on with open groups, but its background discussion no longer runs \(its session has no process\); night gesture: reopen, first check/)
  expect(/when you know it \(else its messages would wait for an approval\): (claude --bg .*) ; once it answers/.exec(line)?.[1]).toBe(reopenCommand('run-1', OWNER))
  // La commande lancée : la discussion relancée a son fichier de session, son verdict est « vivante » ; la note est acceptée quand même.
  alive = [OWNER]
  const dictated = JSON.parse(/« backgrounded », send (\{"coordinate".*\}\]\}\}); if it fails/.exec(line)![1]!)
  expect(String(((await $.tool.call({ tool: TOOL, ...dictated } as any)) as any).result)).toMatch(/recorded for mission « Arrêtée en auto »: reopened;/)
  expect(await note($, 'run-1', watch)).toMatch(/already reopened during this night watch/)
  expect(reopenLog(w)).toEqual(['written', 'refused'])
})

test('une mission en auto jamais proposée (son verdict « inconnu » : pas de job) est refusée, le refus dit les deux cas', { timeoutMs: 40000 }, async ($, on) => {
  const run = autoRun('Jamais proposée', 'run-1', '7c1d2e3f-aaaa-4bbb-8ccc-dddddddddddd')
  const { w, watch } = await night($, on, [run])
  expect(await statementOf($)).not.toMatch(/night gesture: reopen/)
  expect(await note($, 'run-1', watch)).toMatch(/it is not a mission in auto paused by its dashboard with open groups, nor a mission in auto proposed for reopening during this night watch because its background discussion no longer ran/)
  expect(reopenLog(w)).toEqual(['refused'])
})

test('auto arrêtée dont la discussion tient une autre mission active : pas de commande, comme une mission en pause', { timeoutMs: 40000 }, async ($, on) => {
  const other = { ...autoRun('Autre', 'run-2'), auto: undefined, claim: undefined } as unknown as Run
  await night($, on, [autoRun('Arrêtée en auto'), other])
  const text = await statementOf($)
  if (!isFileMode) return
  expect(text).toMatch(/night gesture: reopen, no command \(its discussion carries another mission now/)
  expect(text).not.toMatch(/claude --bg/)
})

/** La mission en pause « discussion fermée », écrite par la fin de sa discussion (`parkActive`), titulaire gardé. */
const parkedRun = (title: string): Run => {
  const run = autoRun(title)
  return parkActive({ ...emptyBoard('/p', 'p'), activeId: run.id, runs: [run] }, T0 - 1000)!.board.runs[0]!
}

test('pause écrite, discussion vivante : jamais « à rouvrir » ; pause écrite, discussion d’abord arrêtée : proposée, et la note acceptée une fois la discussion relancée vivante', { timeoutMs: 40000 }, async ($, on) => {
  let alive: string[] = [OWNER]
  const { watch } = await night($, on, [parkedRun('En pause')], () => alive)
  if (isFileMode) expect(await statementOf($)).not.toMatch(/night gesture: reopen/)
  // La discussion n'a plus de processus : la pause écrite se propose comme aujourd'hui.
  alive = []
  expect(await statementOf($)).toMatch(/auto paused by the dashboard with open groups.*night gesture: reopen/)
  alive = [OWNER]
  expect(await note($, 'run-1', watch)).toMatch(/recorded for mission « En pause »: reopened;/)
})

test('auto reparti de lui-même dans la discussion relancée, vivante : la note est acceptée', { timeoutMs: 40000 }, async ($, on) => {
  const { w, clock, watch } = await night($, on, [parkedRun('Reprise')], () => [OWNER])
  // La discussion relancée (un nouveau processus) charge la mission, puis son auto repart de lui-même.
  writeBoard(w, b => {
    const loaded = detachOnLoad({ ...b, activeId: null }, T0 + 5_000, OWNER, 'boot-2')
    const lit = switchOnAuto(loaded, OWNER, T0 + 6_000, null, 'resumed')!.board
    return { ...b, runs: lit.runs.map(r => ({ ...r })) }
  })
  await settle(clock, 6)
  expect(await note($, 'run-1', watch)).toMatch(/recorded for mission « Reprise »: reopened;/)
})

test('pause écrite, ouverte nulle part, la discussion où elle est née vivante : jamais « à rouvrir » (le verdict lu sur la discussion que la commande relancerait)', { timeoutMs: 40000 }, async ($, on) => {
  const nowhere = { ...autoRun('Ouverte nulle part'), status: 'paused', owner: undefined, claim: undefined, auto: { onAt: T0 - 30_000, offAt: T0 - 1000, offWhy: 'discussion fermée' } } as unknown as Run
  let alive: string[] = [OWNER]
  await night($, on, [nowhere], () => alive)
  if (isFileMode) expect(await statementOf($)).not.toMatch(/night gesture: reopen/)
  // Sa discussion n'a plus de processus (et aucune prise lisible) : la pause se propose comme avant.
  alive = []
  expect(await statementOf($)).toMatch(/auto paused by the dashboard with open groups.*night gesture: reopen/)
})

test('auto arrêtée proposée, sa session trouvée en marche : le relevé dit « encore en marche », pas « déjà rouverte »', { timeoutMs: 40000 }, async ($, on) => {
  const { w, watch } = await night($, on, [autoRun('En marche')])
  const text = await statementOf($)
  if (!isFileMode) return
  expect(text).toMatch(/night gesture: reopen, first check/)
  const said = String(((await $.tool.call({ tool: TOOL, coordinate: { night: [{ mission: 'run-1', watch, act: 'reopen', running: true }] } } as any)) as any).result)
  expect(said).toMatch(/its session still runs; it stays for the morning/)
  expect(reopenLog(w)).toEqual(['refused'])
  const after = (await statementOf($)).split('\n').find(l => /night gesture: reopen/.test(l))!
  expect(after).toMatch(/its session still ran when checked during this night watch/)
  expect(after).not.toMatch(/already reopened/)
})

test('auto arrêtée proposée puis coupée par le COO : la note est refusée', { timeoutMs: 40000 }, async ($, on) => {
  const { w, watch } = await night($, on, [autoRun('Coupée')])
  const text = await statementOf($)
  if (!isFileMode) return
  expect(text).toMatch(/night gesture: reopen, first check/)
  // La coupure du COO, écrite sur la mission (comme `cutAuto`) : l'auto éteint, sa pause « coupée par le COO ».
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === 'run-1' ? ({ ...r, auto: { ...(r as any).auto, offAt: T0 + 1000, offWhy: AUTO_STOPS.coo } } as unknown as Run) : r)) }))
  expect(await note($, 'run-1', watch)).toMatch(/it is not a mission in auto paused by its dashboard with open groups, nor a mission in auto proposed/)
  expect(reopenLog(w)).toEqual(['refused'])
})
