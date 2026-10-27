import { expect, mock, test } from 'claude-code/testing'

import { applyTraces } from '../hooks/erase.ts'
import { attachCarried, runsCarriedBy, withCarriedRuns } from '../hooks/history.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { emptyRegistry, mergeRegistry, noteCarried, parseRegistry } from '../hooks/registry.ts'
import { isTranscriptPath, type TranscriptAgent } from '../hooks/transcript.ts'
import type { Board, RegistryAgent, Run, SessionRegistry } from '../types'

const T0 = 80_000_000
const MIN = 60_000
const seen = (agentId: string, startedAt: number): TranscriptAgent => ({ agentId, lane: { segments: [], toolCount: 0, startedAt, endedAt: startedAt + 1_000 }, meta: { description: agentId } })
const row = (key: string, startedAt: number, source: RegistryAgent['source'], run?: string): RegistryAgent => ({
  key,
  agentId: key,
  name: key,
  isBackground: true,
  status: 'done',
  startedAt,
  source,
  ...(run !== undefined ? { run } : {}),
})

// ─── S31 : les parcours portés gardent leurs deux dates ───────────────────────

test('S31 : l’en-tête garde, pour chaque parcours porté, la première et la dernière date où la discussion le portait', () => {
  const reg = noteCarried(emptyRegistry('s-d', '/p', T0), ['r1'], T0)!
  expect(reg.carried).toEqual(['r1'])
  expect(reg.carriedAt).toEqual({ r1: [{ from: T0, to: T0 }] })
  // Porté encore plus tard, sans trou de plus de 10 min : la fin de la période avance, son début reste.
  const later = noteCarried(reg, ['r1'], T0 + 5 * MIN)!
  expect(later.carriedAt).toEqual({ r1: [{ from: T0, to: T0 + 5 * MIN }] })
  // Un id noté sans dates (en-tête d'avant) reste sans dates : pas de borne pour lui.
  const old: SessionRegistry = { ...emptyRegistry('s-d', '/p', T0), carried: ['ancien'] }
  expect(noteCarried(old, ['ancien'], T0)).toBeNull()
  // Deux processus de la même session : les périodes qui se recouvrent se fondent.
  const merged = mergeRegistry(later, { ...later, carriedAt: { r1: [{ from: T0 - MIN, to: T0 + MIN }] } })
  expect(merged.carriedAt).toEqual({ r1: [{ from: T0 - MIN, to: T0 + 5 * MIN }] })
  // Relu : des nombres seulement, la fin après le début, et pour les seuls parcours notés.
  const parsed = parseRegistry(
    JSON.stringify({ ...later, carriedAt: { r1: [{ from: T0, to: T0 + 5 * MIN }, { from: T0 + 9 * MIN, to: T0 + 8 * MIN }], autre: [{ from: 1, to: 2 }], r2: [{ from: 'x', to: 3 }] } }),
  )
  expect(parsed?.carriedAt).toEqual({ r1: [{ from: T0, to: T0 + 5 * MIN }] })
  // Le parcours supprimé quitte aussi les dates.
  expect(applyTraces(later, [{ id: 'run:r1', at: T0 + 6 * MIN }])?.carriedAt).toBeUndefined()
})

test('S37 : une discussion qui reprend un parcours après plus de 10 min sans le porter ouvre une nouvelle période ; 20 au plus', () => {
  const run = { ...newRun('implement', T0, 'Repris'), status: 'done', updatedAt: T0 + 50 * MIN, finishedAt: T0 + 50 * MIN } as Run
  let reg = noteCarried(emptyRegistry('s-d', '/p', T0), [run.id], T0)!
  reg = noteCarried(reg, [run.id], T0 + 10 * MIN)!
  // Une écriture qui ne le porte plus (S40) : la reprise ouvre une nouvelle période.
  reg = noteCarried(reg, [], T0 + 20 * MIN)!
  reg = noteCarried(reg, [run.id], T0 + 40 * MIN)!
  reg = noteCarried(reg, [run.id], T0 + 45 * MIN)!
  expect(reg.carriedAt).toEqual({
    [run.id]: [
      { from: T0, to: T0 + 10 * MIN },
      { from: T0 + 40 * MIN, to: T0 + 45 * MIN },
    ],
  })
  // Le sous-agent manqué de l'écart (T0 + 25 min, hors des marges) ne va pas au parcours.
  const out = withCarriedRuns([seen('ecart', T0 + 25 * MIN), seen('apres-reprise', T0 + 42 * MIN)], reg, [run])
  expect(out.map(a => [a.agentId, a.run])).toEqual([
    ['ecart', undefined],
    ['apres-reprise', run.id],
  ])
  // Au-delà de 20 périodes, les plus anciennes se fondent : rien ne se perd au début.
  let many = noteCarried(emptyRegistry('s-d', '/p', T0), ['r1'], T0)!
  for (let i = 1; i <= 25; i++) many = noteCarried(noteCarried(many, [], T0 + i * 20 * MIN - 5 * MIN)!, ['r1'], T0 + i * 20 * MIN)!
  expect(many.carriedAt!.r1).toHaveLength(20)
  expect(many.carriedAt!.r1![0]!.from).toBe(T0)
})

test('S40 : une discussion qui porte un parcours sans rien écrire pendant plus de 10 min garde une seule période, trou compris', () => {
  const run = { ...newRun('implement', T0, 'Porté sans écrire'), status: 'done', updatedAt: T0 + 60 * MIN, finishedAt: T0 + 60 * MIN } as Run
  let reg = noteCarried(emptyRegistry('s-d', '/p', T0), [run.id], T0)!
  // Aucune écriture entre T0 + 5 min et T0 + 50 min (mod rechargé, long tour) : le parcours restait porté.
  reg = noteCarried(reg, [run.id], T0 + 5 * MIN)!
  reg = noteCarried(reg, [run.id], T0 + 50 * MIN)!
  expect(reg.carriedAt).toEqual({ [run.id]: [{ from: T0, to: T0 + 50 * MIN }] })
  // Le sous-agent manqué pendant le trou va au parcours.
  expect(withCarriedRuns([seen('trou', T0 + 30 * MIN)], reg, [run])[0]!.run).toBe(run.id)
  // Une écriture sans lui note la date ; elle survit à la relecture et à la fusion.
  const left = noteCarried(reg, [], T0 + 52 * MIN)!
  expect(left.carriedNotedAt).toBe(T0 + 52 * MIN)
  expect(noteCarried(left, [], T0 + 53 * MIN)).toBeNull()
  expect(parseRegistry(JSON.stringify(left))?.carriedNotedAt).toBe(T0 + 52 * MIN)
  expect(mergeRegistry(reg, left).carriedNotedAt).toBe(T0 + 52 * MIN)
})

// ─── R3 : le rattachement est borné par la période où la discussion portait le parcours ──

test('R3 : un sous-agent rattrapé ne rejoint un parcours porté puis rendu que dans la période où la discussion le portait', () => {
  // La discussion s-d a porté le parcours de T0 à T0 + 20 min, puis l'a rendu ; une autre l'a repris jusqu'à T0 + 2 h.
  const run = { ...newRun('implement', T0, 'Rendu'), owner: 's-autre', updatedAt: T0 + 120 * MIN } as Run
  const reg = noteCarried(noteCarried(emptyRegistry('s-d', '/p', T0), [run.id], T0)!, [run.id], T0 + 20 * MIN)!
  const carried = runsCarriedBy([run], reg)
  expect(carried.map(r => r.id)).toEqual([run.id])
  const out = withCarriedRuns([seen('pendant', T0 + 10 * MIN), seen('marge', T0 + 29 * MIN), seen('apres', T0 + 60 * MIN)], reg, carried)
  expect(out.map(a => [a.agentId, a.run])).toEqual([
    ['pendant', run.id],
    // La marge de Q14 (10 min après la dernière date) compte encore.
    ['marge', run.id],
    // Pendant que l'autre discussion le portait : aucun.
    ['apres', undefined],
  ])
  // Portée encore ici (propriétaire) : pas de borne de fin, la période du parcours seule.
  const mine = { ...run, owner: 's-d' } as Run
  expect(withCarriedRuns([seen('apres', T0 + 60 * MIN)], reg, [mine])[0]!.run).toBe(mine.id)
  // Un en-tête sans dates (d'avant) : la période du parcours seule, comme avant.
  const undated: SessionRegistry = { ...emptyRegistry('s-d', '/p', T0), carried: [run.id] }
  expect(withCarriedRuns([seen('apres', T0 + 60 * MIN)], undated, [run])[0]!.run).toBe(run.id)
})

// ─── R2 : une entrée rattrapée sans parcours est rattachée à chaque rattrapage ──

test('R2 : à chaque rattrapage, une entrée venue des transcripts sans parcours est rattachée ; une entrée suivie en direct sans parcours ne l’est pas', () => {
  const run = { ...newRun('implement', T0, 'Porté'), status: 'done', updatedAt: T0 + 30 * MIN, finishedAt: T0 + 30 * MIN } as Run
  const base = noteCarried(noteCarried(emptyRegistry('s-d', '/p', T0), [run.id], T0)!, [run.id], T0 + 30 * MIN)!
  const reg: SessionRegistry = {
    ...base,
    agents: [
      row('rattrape-tot', T0 + 5 * MIN, 'transcript'),
      row('direct', T0 + 6 * MIN, 'live'),
      row('deja', T0 + 7 * MIN, 'transcript', 'autre'),
      row('hors', T0 + 90 * MIN, 'transcript'),
    ],
  }
  const out = attachCarried(reg, runsCarriedBy([run], reg))!
  expect(out.agents.map(a => [a.key, a.run])).toEqual([
    ['rattrape-tot', run.id],
    ['direct', undefined],
    ['deja', 'autre'],
    ['hors', undefined],
  ])
  // Plus rien à rattacher : rien ne change.
  expect(attachCarried(out, runsCarriedBy([run], out))).toBeNull()
})

// Les suites de la revue du groupe C et de sa revue de sécurité (DECISIONS.md, série 21 ;
// S31 à S34) : garde des chemins de transcripts, une trace par fichier, rattachement borné.

// ─── D2 (a) : la garde des chemins exige un chemin absolu ──────────────────────

test('D2 (a) : sur Mac, un chemin relatif ou qui contient « \\ » n’est pas un transcript', () => {
  expect(isTranscriptPath('/h/.claude/projects/-p/abc.jsonl', '/h/.claude')).toBe(true)
  // Relatif : il se lirait depuis le dossier courant, hors du dossier Claude.
  expect(isTranscriptPath('h/.claude/projects/-p/abc.jsonl', 'h/.claude')).toBe(false)
  expect(isTranscriptPath('projects/-p/abc.jsonl', '/h/.claude')).toBe(false)
  // « \ » n'est pas un séparateur hors de Windows : il ne se convertit pas, le chemin est refusé.
  expect(isTranscriptPath('/h/.claude/projects/-p\\..\\..\\x.jsonl', '/h/.claude')).toBe(false)
  expect(isTranscriptPath('\\h\\.claude\\projects\\-p\\abc.jsonl', '/h/.claude')).toBe(false)
  // Un chemin Windows avec un dossier Claude de Mac : refusé (Windows se lit au seul dossier Claude).
  expect(isTranscriptPath('C:\\h\\.claude\\projects\\-p\\abc.jsonl', '/h/.claude')).toBe(false)
})

test('D2 (a) : sous Windows, un chemin absolu à « \\ » ou à « / » est accepté, un chemin relatif non', () => {
  expect(isTranscriptPath('C:\\Users\\M\\.claude\\projects\\-p\\abc.jsonl', 'C:\\Users\\M\\.claude')).toBe(true)
  expect(isTranscriptPath('C:/Users/M/.claude/projects/-p/abc.jsonl', 'C:\\Users\\M\\.claude')).toBe(true)
  expect(isTranscriptPath('Users\\M\\.claude\\projects\\-p\\abc.jsonl', 'C:\\Users\\M\\.claude')).toBe(false)
  expect(isTranscriptPath('\\\\serveur\\partage\\.claude\\projects\\-p\\abc.jsonl', 'C:\\Users\\M\\.claude')).toBe(false)
})

// ─── Par le mod entier ──────────────────────────────────────────────────────

const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const BOARD_KEY = 'board:/p'
const PROJECTS = '/h/.claude/projects/-p'

/**
 * Le moteur sous le plugin, la session `s-c` du projet `/p`, un stockage en mémoire (le registre et
 * les traces y vont : le dossier du registre est refusé) et un disque simulé qui tient les transcripts.
 */
const world = (
  on: any,
  seed: Record<string, unknown>,
  opts: { files?: Record<string, string>; failingTrace?: number; onTrace?: () => Promise<void>; mtimes?: Record<string, number>; ghosts?: string[] } = {},
) => {
  const mem: Record<string, unknown> = { ...seed }
  const files: Record<string, string> = { ...opts.files }
  const reads: string[] = []
  // `mtimes` : la date d'un fichier (sinon bien après le parcours) ; `ghosts` : listés, mais absents à la lecture.
  const mtimeOf = (path: string) => opts.mtimes?.[path] ?? T0 + 3 * 60 * MIN
  const sets: string[] = []
  const toasts: string[] = []
  let traces = 0
  const isRefused = (path: string) => path.includes('/flow-board/')
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-c' }))
  on('session.root', () => ({ value: '/p' }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', async (_$: unknown, e: { key: string; value: unknown }) => {
    sets.push(e.key)
    // `onTrace` : appelé à chaque écriture de trace, avant elle ; `failingTrace` : la n-ième est refusée.
    if (e.key.endsWith(':erased')) await opts.onTrace?.()
    if (e.key.endsWith(':erased') && ++traces === opts.failingTrace) throw new Error('plein')
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    delete mem[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: !isRefused(e.path) && e.path in files }) as any)
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file', size: files[e.path]!.length, mtimeMs: 1 } } as any
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    reads.push(e.path)
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isRefused(e.path)) throw new Error('EACCES')
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('fs.list', (_$: unknown, e: { path?: string }) => {
    const dir = `${String(e.path ?? '').replace(/\/$/, '')}/`
    const names = [...Object.keys(files), ...(opts.ghosts ?? [])].filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    if (names.length === 0) throw new Error(`ENOENT ${e.path}`)
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file', size: files[p]?.length ?? 1, mtimeMs: mtimeOf(p), isLink: false })) } as any
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.toast', (_$: unknown, e: unknown) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  return { mem, files, sets, toasts, reads }
}

const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1_000)
}

const traceIds = (mem: Record<string, unknown>): string[] =>
  Object.entries(mem)
    .filter(([k]) => k.endsWith(':erased'))
    .map(([, v]) => (v as { id: string }).id)
    .sort()

/** Le transcript d'un sous-agent qui travaille à `at`. */
const agentTranscript = (at: number): string =>
  [
    { type: 'api-request', timestamp: new Date(at).toISOString() },
    { type: 'assistant', isSidechain: true, timestamp: new Date(at + 1_000).toISOString(), message: { id: `m${at}`, model: 'claude-haiku-5-5', content: [{ type: 'text', text: '' }], usage: { input_tokens: 1, output_tokens: 1 } } },
  ]
    .map(l => JSON.stringify(l))
    .join('\n')

/** Un parcours archivé et fini, de `T0` à `T0 + 30 min`. */
const archivedRun = (title: string): Run => ({ ...newRun('implement', T0, title), status: 'done', updatedAt: T0 + 30 * MIN, finishedAt: T0 + 30 * MIN, archivedAt: T0 + 40 * MIN }) as Run

/** Supprime un parcours archivé depuis l'onglet Historique. */
const dropRun = async ($: any, clock: { advance: (ms: number) => Promise<void> }, run: Run) => {
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: 'archived-toggle' })
  await ui.press({ key: `drop-${run.id}` })
  await ui.press({ key: `drop-yes-${run.id}` })
  await settle(clock, 2)
  await ui.unmount()
}

test('D2 (b) par le mod : un nouvel effacement pose sa trace dans une entrée à elle ; la trace d’avant n’est jamais réécrite et reste lue', async ($, on) => {
  const NOW = T0 + 4 * 60 * MIN
  const clock = mock.clock(on, { now: NOW })
  const old = NOW - 2 * 60 * MIN
  const before = { id: 's-deux', at: old - MIN }
  const theirs: SessionRegistry = { ...emptyRegistry('s-deux', '/p', old), agents: [row('k1', old, 'live')], updatedAt: old }
  const { mem, sets } = world(on, { 'agents:s-deux': theirs, 'agents:s-deux:erased': before })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-history' })
  await ui.press({ key: 'agents-history-session:s-deux' })
  await clock.advance(200)
  await ui.press({ key: 'agents-forget' })
  await ui.press({ key: 'agents-forget-yes' })
  await settle(clock, 2)
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
  // La trace d'avant : jamais réécrite.
  expect(sets.filter(k => k === 'agents:s-deux:erased')).toEqual([])
  expect(mem['agents:s-deux:erased']).toEqual(before)
  // La nouvelle, à côté, sous sa date.
  const fresh = Object.keys(mem).filter(k => /^agents:s-deux:\d+:erased$/.test(k))
  expect(fresh).toHaveLength(1)
  expect(mem[fresh[0]!]).toEqual({ id: 's-deux', at: expect.any(Number) })
  expect((mem[fresh[0]!] as { at: number }).at).toBeGreaterThan(before.at)
  // La discussion, fermée, est effacée.
  expect(mem['agents:s-deux']).toBeUndefined()
})

test('R1 par le mod : de la première trace à la fin de « Supprimer », l’onglet dit « effacement en cours » pour ce parcours', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 4 * 60 * MIN })
  const run = archivedRun('Lot à jeter')
  // La première trace attend qu'on la laisse passer : l'effacement est en cours pendant ce temps.
  let reached: () => void = () => undefined
  const isReached = new Promise<void>(resolve => (reached = resolve))
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => (release = resolve))
  const { mem, sets } = world(on, { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] } }, { onTrace: async () => (reached(), gate) })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: 'archived-toggle' })
  await ui.press({ key: `drop-${run.id}` })
  const pressing = ui.press({ key: `drop-yes-${run.id}` })
  try {
    await isReached
    const during = await $.ui.mount({ plugin: 'flow-board', surface: 'desktop', ...PANE })
    await during.press({ key: 'tab-history' })
    expect(await during.find({ type: 'Text', text: /Effacement\sen\scours\sdu\sparcours\s« Lot à jeter »/ })).toBeDefined()
    // S36 : un second « Supprimer » du même parcours pendant le premier ne fait rien.
    const before = sets.filter(k => k.endsWith(':erased')).length
    await during.press({ key: `drop-${run.id}` })
    await during.press({ key: `drop-yes-${run.id}` })
    expect(sets.filter(k => k.endsWith(':erased')).length).toBe(before)
    await during.press({ key: 'tab-agents' })
    expect(await during.find({ type: 'Text', text: /Effacement\sen\scours\sdu\sparcours\s« Lot à jeter »/ })).toBeDefined()
    await during.unmount()
  } finally {
    release()
  }
  await pressing
  await settle(clock, 2)
  expect(traceIds(mem).filter(id => id === `run:${run.id}`)).toHaveLength(1)
  // Fini : plus rien.
  await ui.press({ key: 'tab-history' })
  expect(await ui.find({ type: 'Text', text: /Effacement\sen\scours/ })).toBeUndefined()
  await ui.unmount()
})

test('R5 par le mod : « Supprimer » réécrit tout de suite une discussion fermée qui portait le parcours, même sans sous-agent de lui', async ($, on) => {
  const NOW = T0 + 4 * 60 * MIN
  const clock = mock.clock(on, { now: NOW })
  const run = archivedRun('Lot porté ailleurs')
  const old = NOW - 2 * 60 * MIN
  const carrier: SessionRegistry = {
    ...emptyRegistry('orch-porte', '/p', old),
    agents: [row('hors', T0 + 90 * MIN, 'live')],
    carried: [run.id, 'autre'],
    carriedAt: { [run.id]: [{ from: T0, to: T0 + 20 * MIN }], autre: [{ from: T0 + 60 * MIN, to: T0 + 70 * MIN }] },
    updatedAt: old,
  }
  const { mem } = world(on, { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] }, 'agents:orch-porte': carrier })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  await dropRun($, clock, run)
  const after = parseRegistry(mem['agents:orch-porte'])!
  expect(after.carried).toEqual(['autre'])
  expect(after.carriedAt).toEqual({ autre: [{ from: T0 + 60 * MIN, to: T0 + 70 * MIN }] })
  // Son sous-agent hors du parcours reste.
  expect(after.agents.map(a => a.key)).toEqual(['hors'])
})

test('D4 (a) par le mod : « Supprimer » relit les transcripts des discussions qui ont porté le parcours ; un sous-agent manqué de sa période part aussi, un transcript illisible se dit', async ($, on) => {
  const NOW = T0 + 4 * 60 * MIN
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/h/.claude' })
  const run = archivedRun('Lot relu')
  const old = NOW - 2 * 60 * MIN
  // Une discussion fermée l'a porté de T0 à T0 + 10 min ; deux sous-agents manquent à son registre.
  const carrier: SessionRegistry = {
    ...emptyRegistry('orch-relu', '/p', old),
    transcript: `${PROJECTS}/orch-relu.jsonl`,
    carried: [run.id],
    carriedAt: { [run.id]: [{ from: T0, to: T0 + 10 * MIN }] },
    updatedAt: old,
  }
  // Une autre l'a porté aussi, mais son transcript est hors du dossier Claude : la garde le refuse.
  const elsewhere: SessionRegistry = { ...emptyRegistry('orch-ailleurs', '/p', old), transcript: '/ailleurs/orch-ailleurs.jsonl', carried: [run.id], updatedAt: old }
  const sub = `${PROJECTS}/orch-relu/subagents`
  const { mem, toasts } = world(
    on,
    { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] }, 'agents:orch-relu': carrier, 'agents:orch-ailleurs': elsewhere },
    {
      files: {
        [`${PROJECTS}/orch-relu.jsonl`]: '',
        [`${sub}/agent-manque.jsonl`]: agentTranscript(T0 + 5 * MIN),
        [`${sub}/agent-manque.meta.json`]: JSON.stringify({ description: 'Manqué', toolUseId: 'call-manque', finished: true }),
        // Pendant le parcours, mais après que cette discussion l'a rendu (marge comprise) : pas à lui.
        [`${sub}/agent-apres.jsonl`]: agentTranscript(T0 + 25 * MIN),
        [`${sub}/agent-apres.meta.json`]: JSON.stringify({ description: 'Après', toolUseId: 'call-apres', finished: true }),
        '/ailleurs/orch-ailleurs.jsonl': '',
      },
    },
  )
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  await dropRun($, clock, run)
  const ids = traceIds(mem)
  expect(ids).toContain('agent:manque')
  expect(ids).toContain('call:call-manque')
  expect(ids).not.toContain('agent:apres')
  expect(ids).not.toContain('call:call-apres')
  // S34 : l'effacement s'est fait, et le transcript refusé se dit.
  expect((mem[BOARD_KEY] as Board).runs.some(r => r.id === run.id)).toBe(false)
  expect(toasts.some(t => t.includes('1 transcript non relu : un sous-agent manqué pourrait revenir sans parcours'))).toBe(true)
})

test('S33 par le mod : un « Supprimer » dont une trace ne s’écrit pas est annulé, et le message dit qu’une session ouverte a pu en effacer une partie', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 4 * 60 * MIN })
  const run = archivedRun('Lot gardé')
  const self: SessionRegistry = { ...emptyRegistry('s-c', '/p', T0), agents: [row('ici', T0 + 5 * MIN, 'live', run.id)], updatedAt: T0 + 3 * 60 * MIN }
  const { mem, toasts } = world(on, { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] }, 'agents:s-c': self }, { failingTrace: 2 })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  await dropRun($, clock, run)
  expect((mem[BOARD_KEY] as Board).runs.some(r => r.id === run.id)).toBe(true)
  expect(traceIds(mem)).toEqual([])
  expect(toasts.some(t => t.includes('Effacement annulé : les traces n’ont pas pu s’écrire ; une session ouverte a pu en effacer une partie entre-temps.'))).toBe(true)
  // L'effacement annulé ne reste pas « en cours ».
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-history' })
  expect(await ui.find({ type: 'Text', text: /Effacement\sen\scours/ })).toBeUndefined()
  await ui.unmount()
})

test('S38 par le mod : si la toute première trace ne s’écrit pas, rien n’a été posé : le message dit que rien n’a été effacé', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 4 * 60 * MIN })
  const run = archivedRun('Lot gardé')
  const { mem, toasts } = world(on, { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] } }, { failingTrace: 1 })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  await dropRun($, clock, run)
  expect((mem[BOARD_KEY] as Board).runs.some(r => r.id === run.id)).toBe(true)
  expect(toasts.some(t => t.includes('Effacement impossible : les traces n’ont pas pu s’écrire, rien n’a été effacé.'))).toBe(true)
  expect(toasts.some(t => t.includes('Effacement annulé'))).toBe(false)
})

test('R1 par le mod : « ✗ Oublier » dit aussi « effacement en cours » pour la discussion, du début à la fin', async ($, on) => {
  const NOW = T0 + 4 * 60 * MIN
  const clock = mock.clock(on, { now: NOW })
  const old = NOW - 2 * 60 * MIN
  let reached: () => void = () => undefined
  const isReached = new Promise<void>(resolve => (reached = resolve))
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => (release = resolve))
  const theirs: SessionRegistry = { ...emptyRegistry('s-vieille', '/p', old), title: 'Vieille discussion', agents: [row('k1', old, 'live')], updatedAt: old }
  const { mem } = world(on, { 'agents:s-vieille': theirs }, { onTrace: async () => (reached(), gate) })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-history' })
  await ui.press({ key: 'agents-history-session:s-vieille' })
  await clock.advance(200)
  await ui.press({ key: 'agents-forget' })
  const pressing = ui.press({ key: 'agents-forget-yes' })
  try {
    await isReached
    const during = await $.ui.mount({ plugin: 'flow-board', surface: 'desktop', ...PANE })
    await during.press({ key: 'tab-agents' })
    expect(await during.find({ type: 'Text', text: /Effacement\sen\scours\sde\sla\sdiscussion\s« Vieille discussion »/ })).toBeDefined()
    await during.unmount()
  } finally {
    release()
  }
  await pressing
  await settle(clock, 2)
  expect(mem['agents:s-vieille']).toBeUndefined()
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /Effacement\sen\scours/ })).toBeUndefined()
  await ui.unmount()
})

test('R3 et S35 par le mod : la reprise d’un ancien parcours par transcripts ne lui donne que les sous-agents de la période où la discussion le portait', async ($, on) => {
  const NOW = T0 + 4 * 60 * MIN
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/h/.claude' })
  const run = { ...newRun('implement', T0, 'Ancien lot'), status: 'done', updatedAt: T0 + 30 * MIN, finishedAt: T0 + 30 * MIN } as Run
  // La discussion l'a porté de T0 à T0 + 5 min, puis l'a rendu ; un sous-agent vu en direct la fait relire.
  const holder: SessionRegistry = {
    ...emptyRegistry('sess-q14', '/p', T0),
    transcript: `${PROJECTS}/sess-q14.jsonl`,
    agents: [row('vu', T0 + MIN, 'live', run.id)],
    carried: [run.id],
    carriedAt: { [run.id]: [{ from: T0, to: T0 + 5 * MIN }] },
    updatedAt: T0 + 30 * MIN,
  }
  const sub = `${PROJECTS}/sess-q14/subagents`
  const { mem } = world(
    on,
    { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] }, 'agents:sess-q14': holder },
    {
      files: {
        [`${PROJECTS}/sess-q14.jsonl`]: '',
        [`${sub}/agent-pendant.jsonl`]: agentTranscript(T0 + 2 * MIN),
        [`${sub}/agent-pendant.meta.json`]: JSON.stringify({ description: 'Pendant', toolUseId: 'call-pendant', finished: true }),
        // Dans la période du parcours, mais après que la discussion l'a rendu (marge comprise).
        [`${sub}/agent-apres.jsonl`]: agentTranscript(T0 + 20 * MIN),
        [`${sub}/agent-apres.meta.json`]: JSON.stringify({ description: 'Après', toolUseId: 'call-apres', finished: true }),
      },
    },
  )
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await clock.advance(500)
  const file = mem['agents:sess-q14:rebuilt'] as { agents: { agentId: string; run?: string }[] } | undefined
  expect(file?.agents.map(a => [a.agentId, a.run])).toEqual([['pendant', run.id]])
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('D2 (a) et I3 : sous Windows, un dossier Claude UNC ou en chemin long garde ses transcripts lisibles', () => {
  expect(isTranscriptPath('\\\\srv\\profil\\.claude\\projects\\-p\\a.jsonl', '\\\\srv\\profil\\.claude')).toBe(true)
  expect(isTranscriptPath('C:\\Users\\M\\.claude\\projects\\-p\\a.jsonl', '//?/C:/Users/M/.claude')).toBe(true)
  expect(isTranscriptPath('\\\\srv\\autre\\x.jsonl', '\\\\srv\\profil\\.claude')).toBe(false)
})

test('S39 par le mod : « Supprimer » compte comme non relue une discussion porteuse sans transcript, pas un fichier disparu ni un vieux fichier d’avant le parcours', async ($, on) => {
  const NOW = T0 + 4 * 60 * MIN
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/h/.claude' })
  const run = archivedRun('Lot compté')
  const old = NOW - 2 * 60 * MIN
  const noTranscript: SessionRegistry = { ...emptyRegistry('orch-muet', '/p', old), carried: [run.id], updatedAt: old }
  const reading: SessionRegistry = { ...emptyRegistry('orch-lu', '/p', old), transcript: `${PROJECTS}/orch-lu.jsonl`, carried: [run.id], updatedAt: old }
  const sub = `${PROJECTS}/orch-lu/subagents`
  const { toasts, reads } = world(
    on,
    { [BOARD_KEY]: { ...emptyBoard('/p', 'p'), runs: [run] }, 'agents:orch-muet': noTranscript, 'agents:orch-lu': reading },
    {
      files: { [`${PROJECTS}/orch-lu.jsonl`]: '', [`${sub}/agent-vieux.jsonl`]: agentTranscript(T0 - 60 * MIN) },
      mtimes: { [`${sub}/agent-vieux.jsonl`]: T0 - 59 * MIN },
      // Listé, puis disparu avant sa lecture (nettoyé par Claude Code).
      ghosts: [`${sub}/agent-parti.jsonl`],
    },
  )
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await settle(clock, 6)
  await dropRun($, clock, run)
  // Le vieux fichier n'est même pas lu ; seul le porteur sans transcript compte.
  expect(reads.filter(p => p.endsWith('agent-vieux.jsonl'))).toEqual([])
  expect(toasts.some(t => t.includes('1 transcript non relu : un sous-agent manqué pourrait revenir sans parcours'))).toBe(true)
})
