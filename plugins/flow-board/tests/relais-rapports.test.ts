import { expect, mock, test } from 'claude-code/testing'

import { RELAY_CHOICES_MAX, activeRun, applyReport, emptyBoard, mergeRelay, newRun, nextRelayTime } from '../hooks/model.ts'
import type { Board, Relay } from '../types'

// Le relais garde ce qu'une session liée y dépose (compte rendu, choix déclarés, comptes de revue et
// de sécurité), ou la réponse de l'outil dit qu'il ne l'a pas gardé et pourquoi. Invariant :
// une entrée déjà gardée n'est jamais réécrite vide ni effacée par l'écriture d'une autre session.

const TOOL = 'mcp__flow-board__flow'
const T0 = 95_000_000

/** Le faux moteur, avec un disque et un store lisibles ; `session` est l'id de cette session. */
const world = (on: any, session: string, opts: { isRelayBroken?: boolean } = {}) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  // Un relais qu'on ne peut pas écrire : ni son fichier, ni sa clé du store.
  const isRelayPath = (p: string) => p.includes('/flow-board/relais/') && p.endsWith('.json') && !p.endsWith('.main.json')
  const isRelayKey = (k: string) => k.startsWith('relay:')
  // Une autre session qui écrit le relais commun entre la lecture et l'écriture de celle-ci (`race`).
  let racer: { session: string; entry: unknown } | null = null
  const runOf = (target: string) => (target.startsWith('relay:') ? target.slice('relay:'.length).split(':')[0]! : '')
  const raceOn = (target: string) => {
    if (!racer) return
    const { session: other, entry } = racer
    racer = null
    // Le relais commun du même parcours : sa clé du store, ou `<dossier>/<parcours>.json`.
    const shared = target.startsWith('relay:') ? `relay:${runOf(target)}` : target.replace(/^(.*\/[^/.]+)\.[^/]+\.json$/, '$1.json')
    const was = target.startsWith('relay:') ? mem[shared] : shared in files ? JSON.parse(files[shared]!) : undefined
    const relay = was !== null && typeof was === 'object' ? (was as Relay) : { v: 1, run: runOf(target), sessions: {} }
    const next = { ...relay, sessions: { ...relay.sessions, [other]: entry } }
    if (target.startsWith('relay:')) mem[shared] = next
    else files[shared] = JSON.stringify(next)
  }
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: session }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (isRelayKey(e.key) && opts.isRelayBroken === true) throw new Error('EACCES')
    if (isRelayKey(e.key)) raceOn(e.key)
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isRelayPath(e.path) && opts.isRelayBroken === true) throw new Error('EACCES')
    if (isRelayPath(e.path)) raceOn(e.path)
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('fs.list', (_$: unknown, e: { path: string }) => ({
    value: Object.keys(files)
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: files[p]!.length, mtimeMs: 0, isLink: false })),
  }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  /** À la prochaine écriture du relais par cette session, `other` écrit d'abord son entrée dans le relais commun. */
  const race = (other: string, entry: unknown) => {
    racer = { session: other, entry }
  }
  return { mem, files, race }
}

const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/**
 * Le relais d'un parcours tel qu'il est gardé : ses fichiers sous …/flow-board/relais/ (le commun
 * `<parcours>.json`, et ceux d'une session, `<parcours>.<session>.json`), sinon `$.store` ; les entrées
 * de toutes ces sources réunies, celle d'une session prise dans son propre fichier d'abord.
 */
const relayOf = (mem: Record<string, unknown>, files: Record<string, string>, runId: string): Relay | null => {
  const slug = runId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const sources: unknown[] = [
    ...Object.entries(files)
      .filter(([p]) => p.includes('/flow-board/relais/') && p.endsWith('.json') && !p.endsWith('.main.json') && p.split('/').pop()!.startsWith(`${slug}.`))
      .sort(([a], [b]) => a.split('.').length - b.split('.').length)
      .flatMap(([, text]) => {
        try {
          return [JSON.parse(text)]
        } catch {
          return []
        }
      }),
    ...Object.entries(mem)
      .filter(([k]) => k === `relay:${runId}` || k.startsWith(`relay:${runId}:`))
      .map(([, v]) => v),
  ]
  const sessions: Relay['sessions'] = {}
  for (const s of sources) {
    const relay = s as { sessions?: Relay['sessions']; session?: string; entry?: Relay['sessions'][string] }
    Object.assign(sessions, relay.sessions ?? {})
    if (relay.session && relay.entry) sessions[relay.session] = relay.entry
  }
  return sources.length > 0 ? { v: 1, run: runId, sessions } : null
}

/** Le parcours du groupe C, enregistré par la discussion principale, pas actif ici. */
const seeded = (mem: Record<string, unknown>): string => {
  const run = { ...newRun('implement', 1_000, 'Pistes'), owner: 's-main' }
  const board: Board = applyReport({ ...emptyBoard('', 'p'), session: 's-main', deleted: [], runs: [run], activeId: run.id }, { tickets: [{ id: '08', name: 'Neutraliser' }], groups: [{ id: 'C', name: 'Durcissement', tickets: ['08'] }] }, 2_000).board
  mem['board:'] = { ...board, activeId: null }
  return activeRun(board)!.id
}

test('le scénario du groupe C : un compte rendu, des choix et des comptes envoyés avec "delegate" sont gardés au relais, et la réponse le dit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  const declare = { tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' }
  await $.tool.call(declare as any)
  // La session du groupe C renvoyait "delegate", "group" et "main" à chaque appel.
  const out = (await $.tool.call({
    ...declare,
    decided: [{ what: 'Un choix', why: 'sa raison' }],
    review: { standards: 1, spec: 2, fixed: 3 },
    security: { group: 'C', advised: true, why: 'chemins', findings: 0, fixed: 0 },
    report: 'Compte rendu du groupe C',
  } as any)) as { result: string }
  const entry = relayOf(mem, files, runId)?.sessions['s-fille']
  expect(entry?.report?.text).toBe('Compte rendu du groupe C')
  expect(entry?.decided?.map(d => d.what)).toEqual(['Un choix'])
  expect(entry?.reviews).toMatchObject({ count: 1, standards: 1, spec: 2, fixed: 3 })
  expect(entry?.security).toMatchObject({ advised: true, findings: 0, fixed: 0 })
  expect(out.result).toMatch(/Relayed to the main discussion's dashboard: 1 choice\(s\) made without the user and the review findings and the security review and the final report\./)
})

test('un dépôt que le relais ne garde pas reçoit une réponse qui le dit, avec la raison, sans se dire relayé', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille', { isRelayBroken: true })
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  const out = (await $.tool.call({ tool: TOOL, report: 'Compte rendu du groupe C', decided: [{ what: 'Un choix' }] } as any)) as { result: string }
  expect(relayOf(mem, files, runId)).toBeNull()
  expect(out.result).toMatch(/NOT kept in the relay: 1 choice\(s\) made without the user \(the relay could not be written, neither its file nor the store\); the final report \(the relay could not be written, neither its file nor the store\): the main discussion does not see them; send them again in a new call of this tool, and send your final report by SendMessage too\./)
  expect(out.result).not.toMatch(/Relayed to the main discussion's dashboard/)
})

/** Une entrée de relais d'une autre session, déjà gardée, avec son compte rendu. */
const otherEntry = { group: 'A', tickets: { '01': { status: 'done', at: T0 - 500 } }, commits: 2, startedAt: T0 - 1_000, at: T0 - 100, report: { text: 'Compte rendu du groupe A', at: T0 - 100 } }

test('deux sessions qui écrivent le relais en même temps ne perdent ni n’effacent l’entrée de l’autre (invariant)', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files, race } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  // Entre la lecture du relais par cette session et son écriture, la session du groupe A y écrit son compte rendu.
  race('s-autre', otherEntry)
  const out = (await $.tool.call({ tool: TOOL, report: 'Compte rendu du groupe C' } as any)) as { result: string }
  const relay = relayOf(mem, files, runId)
  expect(relay?.sessions['s-autre']?.report?.text).toBe('Compte rendu du groupe A')
  expect(relay?.sessions['s-fille']?.report?.text).toBe('Compte rendu du groupe C')
  expect(out.result).toMatch(/^Relayed to the main discussion's dashboard: the final report\./)
})

test('un ancien relais commun qui ne se lit pas n’est jamais réécrit : la session garde son entrée dans la sienne', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  // Coupé en pleine écriture par une version d'avant : illisible, mais il porte les entrées des autres sessions.
  const cut = '{"v":1,"run":"' + runId + '","sessions":{"s-autre":{"report":{"text":"Compte rendu du gr'
  const slug = runId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  mem[`relay:${runId}`] = cut
  await start($)
  const declared = (await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)) as { result: string }
  // Le dossier du mod ne dit pas toujours où est ~/.claude : l'ancien fichier commun s'y pose quand il le dit.
  const own = Object.keys(files).find(p => p.endsWith(`/flow-board/relais/${slug}.s-fille.entry.json`))
  const shared = own?.replace(/\.s-fille\.entry\.json$/, '.json')
  if (shared) files[shared] = cut
  const out = (await $.tool.call({ tool: TOOL, report: 'Compte rendu du groupe C' } as any)) as { result: string }
  // L'entrée de la session est gardée dans la sienne, et la réponse le dit.
  expect(declared.result).not.toMatch(/NOT kept/)
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.report?.text).toBe('Compte rendu du groupe C')
  expect(out.result).toMatch(/^Relayed to the main discussion's dashboard: the final report\./)
  // L'ancien relais commun, illisible, n'a pas été touché.
  expect(mem[`relay:${runId}`]).toBe(cut)
  if (shared) expect(files[shared]).toBe(cut)
})

test('l’entrée d’une session qui ne se lit pas n’est jamais réécrite : le dépôt est refusé, et la réponse le dit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  const slug = runId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const ownFile = Object.keys(files).find(p => p.endsWith(`/flow-board/relais/${slug}.s-fille.entry.json`))
  // Son entrée existe (la déclaration l'a écrite), puis elle est abîmée : coupée sur le disque, ou d'une autre forme dans le store.
  const damaged = '{"v":1,"run":"' + runId + '","session":"s-fille","entry":{"report":{"text":"Compte rendu gardé'
  if (ownFile) files[ownFile] = damaged
  else mem[`relay:${runId}:s-fille`] = damaged
  const out = (await $.tool.call({ tool: TOOL, report: 'Compte rendu du groupe C' } as any)) as { result: string }
  expect(out.result).toMatch(/NOT kept in the relay: the final report \(its own relay (file exists but does not read \(cut or damaged\)|entry in the store is not an entry of this session): nothing overwritten\)/)
  expect(out.result).not.toMatch(/Relayed to the main discussion's dashboard/)
  if (ownFile) expect(files[ownFile]).toBe(damaged)
  else expect(mem[`relay:${runId}:s-fille`]).toBe(damaged)
})

test('au-delà de la borne des choix d’une session, un nouveau choix est refusé et dit, jamais un ancien retiré', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  const many = Array.from({ length: RELAY_CHOICES_MAX }, (_, i) => ({ what: `Choix ${i + 1}` }))
  const first = (await $.tool.call({ tool: TOOL, decided: many } as any)) as { result: string }
  expect(first.result).toMatch(new RegExp(`^Relayed to the main discussion's dashboard: ${RELAY_CHOICES_MAX} choice\\(s\\)`))
  const out = (await $.tool.call({ tool: TOOL, decided: [{ what: 'Un de trop' }] } as any)) as { result: string }
  expect(out.result).toMatch(new RegExp(`NOT kept in the relay: 1 choice\\(s\\) made without the user \\(the relay keeps at most ${RELAY_CHOICES_MAX} choices per session; give these in your final report instead\\)`))
  const kept = relayOf(mem, files, runId)?.sessions['s-fille']?.decided?.map(d => d.what) ?? []
  expect(kept).toHaveLength(RELAY_CHOICES_MAX)
  expect(kept[0]).toBe('Choix 1')
  expect(kept).not.toContain('Un de trop')
})

test('une déclaration que le relais ne garde pas se dit dans la réponse à "delegate"', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem } = world(on, 's-fille', { isRelayBroken: true })
  const runId = seeded(mem)
  await start($)
  const out = (await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)) as { result: string }
  expect(out.result).toMatch(/NOT kept in the relay: the declaration of this session \(the relay could not be written, neither its file nor the store\)/)
})

test('le relais réuni passe les entrées hors forme de l’ancien fichier commun sans tomber', () => {
  const sound = { tickets: {}, commits: 0, startedAt: T0, at: T0 }
  const merged = mergeRelay('r1', { v: 1, run: 'r1', sessions: { a: null, b: sound, c: { at: 'x' }, d: 7 } }, [{ v: 1, run: 'r1', session: 'e', entry: null }, 'abîmé'])
  expect(Object.keys(merged?.sessions ?? {})).toEqual(['b'])
})
test('une écriture de l’entrée d’une session vient toujours après la précédente, même dans la même milliseconde', () => {
  const entry = { tickets: {}, commits: 0, startedAt: T0, at: T0 }
  expect(nextRelayTime(undefined, T0)).toBe(T0)
  expect(nextRelayTime(entry, T0 + 5)).toBe(T0 + 5)
  expect(nextRelayTime(entry, T0)).toBe(T0 + 1)
  expect(nextRelayTime({ ...entry, at: T0 + 9 }, T0)).toBe(T0 + 10)
})
