import { expect, mock, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import { RELAY_CHOICES_MAX, applyRelay, mergeRelay, nextRelayTime, refusedRelayText, relayedSentence } from '../hooks/relay.ts'
import { activeRun } from '../hooks/basics.ts'
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

test('les bogues d’une passe « bogues » partent au relais ; un compte illisible n’y part pas, et la réponse le dit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  const ok = (await $.tool.call({ tool: TOOL, review: { standards: 1, spec: 0, bugs: 2, fixed: 3 } } as any)) as { result: string }
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 1, standards: 1, spec: 0, fixed: 3, bugs: 2 })
  expect(ok.result).toMatch(/Relayed to the main discussion's dashboard: the review findings\./)
  expect(ok.result).not.toMatch(/NOT kept|bug count/)
  // Une revue sans passe « bogues » ne touche pas aux bogues déjà relayés.
  await $.tool.call({ tool: TOOL, review: { standards: 0, spec: 1, fixed: 1 } } as any)
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 2, standards: 1, spec: 1, fixed: 4, bugs: 2 })
  for (const bad of ['3', null, -1, 2.5, 10_001]) {
    const out = (await $.tool.call({ tool: TOOL, review: { standards: 1, spec: 0, bugs: bad, fixed: 0 } } as any)) as { result: string }
    expect(out.result).toMatch(/Relayed to the main discussion's dashboard: the review findings\. NOT kept in the relay: the bug count \(not a whole number from 0 to 10 000; the rest of this review is relayed: do not send it again, give the bug count in your final report\): the main discussion does not see it; do what each reason says, and send your final report by SendMessage too\./)
    expect(out.result).not.toMatch(/again in a new call/)
  }
  // Les autres comptes de ces revues sont gardés, les bogues restent ceux d'avant.
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 7, standards: 6, spec: 1, fixed: 4, bugs: 2 })
})

test('une entrée dont le compte de bogues est illisible n’est jamais réécrite : la revue avec bogues est refusée, et la réponse le dit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, review: { standards: 1, spec: 0, bugs: 2, fixed: 1 } } as any)
  const slug = runId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const ownFile = Object.keys(files).find(p => p.endsWith(`/flow-board/relais/${slug}.s-fille.entry.json`))
  const write = (f: (v: any) => void) => {
    if (ownFile) {
      const v = JSON.parse(files[ownFile]!)
      f(v)
      files[ownFile] = JSON.stringify(v)
    } else f(mem[`relay:${runId}:s-fille`])
  }
  // Modifié à la main : le compte de bogues n'est plus un compte.
  write(v => {
    v.entry.reviews.bugs = 'deux'
  })
  // Avec la revue de sécurité : celle-ci part seule, la revue est refusée.
  const out = (await $.tool.call({ tool: TOOL, review: { standards: 0, spec: 0, bugs: 1, fixed: 0 }, security: { group: 'C', advised: true, why: 'chemins', findings: 1, fixed: 1 } } as any)) as { result: string }
  expect(out.result).toMatch(/Relayed to the main discussion's dashboard: the security review\. NOT kept in the relay: the review findings \(its relay entry holds an unreadable bug count, never rewritten; send this review again without "bugs", and give the bug count in your final report\)/)
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 1, standards: 1, spec: 0, fixed: 1, bugs: 'deux' })
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.security).toMatchObject({ advised: true, findings: 1, fixed: 1 })
  // Sans bogues, la revue se garde : le compte illisible reste tel quel.
  await $.tool.call({ tool: TOOL, review: { standards: 2, spec: 0, fixed: 0 } } as any)
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 2, standards: 3, spec: 0, fixed: 1, bugs: 'deux' })
})

test('une revue dont les bogues pousseraient le compte de la session au-delà de 10 000 est refusée, et la réponse le dit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, review: { standards: 0, spec: 0, bugs: 9_999, fixed: 0 } } as any)
  const out = (await $.tool.call({ tool: TOOL, review: { standards: 0, spec: 0, bugs: 2, fixed: 0 } } as any)) as { result: string }
  expect(out.result).toMatch(/NOT kept in the relay: the review findings \(its relay entry would pass 10 000 bugs; send this review again without "bugs", and give the bug count in your final report\)/)
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 1, standards: 0, spec: 0, fixed: 0, bugs: 9_999 })
})

test('un relais qui ne s’écrit pas n’efface pas la raison d’un compte de bogues hors forme', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem } = world(on, 's-fille', { isRelayBroken: true })
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  const out = (await $.tool.call({ tool: TOOL, review: { standards: 1, spec: 0, bugs: 'x', fixed: 0 } } as any)) as { result: string }
  // La revue se renvoie (sans bogues), les bogues vont au compte rendu.
  expect(out.result).toMatch(/the review findings \(the relay could not be written, neither its file nor the store\); the bug count \(not a whole number from 0 to 10 000; send this review again without "bugs", and give the bug count in your final report\)/)
  expect(out.result).toMatch(/send the review findings again in a new call of this tool, do what each other reason says/)
})

test('une revue écrite mais pas relue ne se renvoie pas, même avec un compte de bogues hors forme', () => {
  const input = { review: { standards: 2, spec: 1, bugs: '2', fixed: 0 } }
  const why = 'it was written, but its relay entry could not be read back to confirm it: do not send it again before the main discussion checks the relay'
  const text = relayedSentence(input, [{ part: 'review', why, isFinal: true }])
  // Le message dit la perte de la revue et des bogues, sans jamais demander de renvoyer la revue.
  expect(text).toContain(`the review findings (${why})`)
  expect(text).toContain('the bug count (not a whole number from 0 to 10 000; give the bug count in your final report)')
  expect(text).not.toMatch(/again in a new call|send this review again/)
  // Une perte qui se renvoie garde sa consigne.
  expect(relayedSentence({ review: { standards: 1, spec: 0, fixed: 0 } }, [{ part: 'review', why: 'the relay could not be written, neither its file nor the store' }])).toMatch(/send it again in a new call of this tool/)
})

test('au relais, une revue dont un compte est hors forme est refusée en entier, sa revue de sécurité part seule, et la réponse le dit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, review: { standards: 1, spec: 1, fixed: 1 } } as any)
  for (const field of ['standards', 'spec', 'fixed'] as const) {
    for (const bad of ['3', null, -1, 2.5, 10_001]) {
      const out = (await $.tool.call({ tool: TOOL, review: { standards: 0, spec: 0, fixed: 0, [field]: bad }, security: { group: 'C', advised: true, why: 'chemins', findings: 1, fixed: 0 } } as any)) as { result: string }
      expect(out.result).toContain(`review: refused, counts out of range (${field}): each is a whole number from 0 to 10 000; nothing relayed for it, send it again`)
      expect(out.result).toMatch(/Relayed to the main discussion's dashboard: the security review\./)
      // Un compte de bogues ne se dit pas relayé à part quand la revue entière est refusée.
      const withBugs = (await $.tool.call({ tool: TOOL, review: { standards: 0, spec: 0, fixed: 0, bugs: 'x', [field]: bad } } as any)) as { result: string }
      expect(withBugs.result).toContain(`review: refused, counts out of range (${field}): each is a whole number from 0 to 10 000`)
      expect(withBugs.result).not.toMatch(/the rest of this review is relayed|the review findings/)
    }
  }
  // Rien de ces revues n'est relayé ; la revue de sécurité l'est.
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 1, standards: 1, spec: 1, fixed: 1 })
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.security).toMatchObject({ advised: true, findings: 1, fixed: 0 })
  // Un compte absent vaut 0, comme avant.
  await $.tool.call({ tool: TOOL, review: { spec: 2 } } as any)
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 2, standards: 1, spec: 3, fixed: 1 })
})

test('une revue dont un compte de la session passerait 10 000 est refusée, sa revue de sécurité part seule, et la réponse dit de donner les comptes dans le compte rendu', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, review: { standards: 9_999, spec: 0, fixed: 10_000 } } as any)
  const out = (await $.tool.call({ tool: TOOL, review: { standards: 2, spec: 0, fixed: 0 }, security: { group: 'C', advised: false, why: 'aucun risque' } } as any)) as { result: string }
  expect(out.result).toMatch(/NOT kept in the relay: the review findings \(its relay entry would pass 10 000 \(standards\); give the review counts in your final report\)/)
  expect(out.result).toMatch(/Relayed to the main discussion's dashboard: the security review\./)
  expect(out.result).not.toMatch(/again in a new call/)
  const fixed = (await $.tool.call({ tool: TOOL, review: { standards: 0, spec: 0, fixed: 1 } } as any)) as { result: string }
  expect(fixed.result).toMatch(/its relay entry would pass 10 000 \(fixed\)/)
  // L'entrée reste telle quelle ; la revue de sécurité est gardée.
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 1, standards: 9_999, spec: 0, fixed: 10_000 })
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.security).toMatchObject({ advised: false })
  // Jusqu'à la borne, la revue se garde.
  await $.tool.call({ tool: TOOL, review: { standards: 1, spec: 0, fixed: 0 } } as any)
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 2, standards: 10_000, spec: 0, fixed: 10_000 })
})

test('la borne des comptes s’écrit « 10 000 » dans les réponses, pour la revue comme pour la sécurité', () => {
  for (const input of [{ security: { group: 'C', findings: -1 } }, { review: { standards: -1, spec: 0, fixed: 0 } }]) {
    const text = refusedRelayText(input)
    expect(text).toContain('each is a whole number from 0 to 10 000')
    expect(text).not.toContain('10000')
  }
  // Dans la discussion du parcours aussi.
  const run = newRun('implement', 1_000, 'Lot')
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  expect(applyReport(board, { security: { findings: -1 } }, 3_000).text).toContain('each is a whole number from 0 to 10 000')
})

/** L'entrée de relais de la session « s-fille », modifiée à la main (son fichier, sinon sa clé du store). */
const handEdit = (mem: Record<string, unknown>, files: Record<string, string>, runId: string, f: (entry: any) => void) => {
  const slug = runId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const ownFile = Object.keys(files).find(p => p.endsWith(`/flow-board/relais/${slug}.s-fille.entry.json`))
  if (ownFile) {
    const v = JSON.parse(files[ownFile]!)
    f(v.entry)
    files[ownFile] = JSON.stringify(v)
  } else f((mem[`relay:${runId}:s-fille`] as any).entry)
}

test('un compte de revue gardé illisible n’est jamais réécrit : la revue est refusée, sa revue de sécurité part seule, et la réponse le dit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, review: { standards: 1, spec: 1, fixed: 1 } } as any)
  for (const field of ['count', 'standards', 'spec', 'fixed'] as const) {
    for (const bad of ['3', null, -1, 2.5, 10_001]) {
      const kept = { count: 1, standards: 1, spec: 1, fixed: 1, [field]: bad }
      handEdit(mem, files, runId, e => {
        e.reviews = { ...kept }
        delete e.security
      })
      const out = (await $.tool.call({ tool: TOOL, review: { standards: 2, spec: 0, fixed: 0 }, security: { group: 'C', advised: true, why: 'chemins', findings: 1, fixed: 1 } } as any)) as { result: string }
      expect(out.result).toContain(`NOT kept in the relay: the review findings (its relay entry holds an unreadable review count (${field}), never rewritten; give the review counts in your final report)`)
      expect(out.result).toMatch(/Relayed to the main discussion's dashboard: the security review\./)
      expect(out.result).not.toMatch(/again in a new call/)
      expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual(kept)
      expect(relayOf(mem, files, runId)?.sessions['s-fille']?.security).toMatchObject({ advised: true, findings: 1, fixed: 1 })
    }
  }
})

test('des comptes de revue gardés qui ne sont pas un objet ne sont jamais réécrits ; un compte gardé absent vaut 0', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, review: { standards: 1, spec: 1, fixed: 1 } } as any)
  for (const bad of ['abîmé', null, [1, 2], 7]) {
    handEdit(mem, files, runId, e => {
      e.reviews = bad
    })
    const out = (await $.tool.call({ tool: TOOL, review: { standards: 2, spec: 0, fixed: 0 } } as any)) as { result: string }
    expect(out.result).toContain('NOT kept in the relay: the review findings (its relay entry holds unreadable review counts, never rewritten; give the review counts in your final report)')
    expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual(bad)
  }
  // Un compte gardé absent (une entrée d'avant, ou modifiée) vaut 0 : la revue s'y ajoute.
  handEdit(mem, files, runId, e => {
    e.reviews = { count: 1, standards: 1, fixed: 1 }
  })
  await $.tool.call({ tool: TOOL, review: { standards: 0, spec: 2, fixed: 0 } } as any)
  expect(relayOf(mem, files, runId)?.sessions['s-fille']?.reviews).toEqual({ count: 2, standards: 1, spec: 2, fixed: 1 })
})

test('un compte de sécurité gardé illisible n’est jamais écrasé : l’avis qui le remplacerait est refusé, la revue du même appel part seule, et la réponse le dit', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, security: { group: 'C', advised: true, findings: 2, fixed: 1, dismissed: 1 } } as any)
  for (const field of ['findings', 'fixed', 'dismissed'] as const) {
    for (const bad of ['3', null, -1, 2.5, 10_001]) {
      handEdit(mem, files, runId, e => {
        e.security = { advised: true, findings: 2, fixed: 1, dismissed: 1, at: T0, [field]: bad }
        delete e.reviews
      })
      const out = (await $.tool.call({ tool: TOOL, review: { standards: 1, spec: 0, fixed: 0 }, security: { group: 'C', findings: 2, fixed: 2, dismissed: 0 } } as any)) as { result: string }
      expect(out.result).toContain(`NOT kept in the relay: the security review (its relay entry holds an unreadable security count (${field}), never overwritten; give the security counts in your final report)`)
      expect(out.result).toMatch(/Relayed to the main discussion's dashboard: the review findings\./)
      const entry = relayOf(mem, files, runId)?.sessions['s-fille']
      expect(entry?.security).toMatchObject({ advised: true, findings: 2, fixed: 1, dismissed: 1, [field]: bad })
      expect(entry?.reviews).toEqual({ count: 1, standards: 1, spec: 0, fixed: 0 })
      // Un avis qui ne touche pas ce compte le laisse tel quel et se garde (il remplace les autres, même plus petits).
      const other = field === 'dismissed' ? { findings: 1 } : { dismissed: 0 }
      const next = (await $.tool.call({ tool: TOOL, security: { group: 'C', ...other } } as any)) as { result: string }
      expect(next.result).toMatch(/Relayed to the main discussion's dashboard: the security review\./)
      expect(relayOf(mem, files, runId)?.sessions['s-fille']?.security).toMatchObject({ [field]: bad, ...other })
    }
  }
})

test('un avis de sécurité gardé qui n’est pas un objet n’est jamais écrasé', async ($, on) => {
  mock.clock(on, { now: T0 })
  const { mem, files } = world(on, 's-fille')
  const runId = seeded(mem)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'C', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, security: { group: 'C', advised: false, why: 'rien' } } as any)
  for (const bad of ['abîmé', null, [1]]) {
    handEdit(mem, files, runId, e => {
      e.security = bad
    })
    const out = (await $.tool.call({ tool: TOOL, security: { group: 'C', advised: true, findings: 0 } } as any)) as { result: string }
    expect(out.result).toContain('NOT kept in the relay: the security review (its relay entry holds an unreadable security review, never overwritten; give the security counts in your final report)')
    expect(relayOf(mem, files, runId)?.sessions['s-fille']?.security).toEqual(bad)
  }
})

test('appelé sans refus préalable, l’ajout au relais ne réécrit jamais un compte gardé illisible, de revue ou de sécurité', () => {
  const at = T0
  const base = { tickets: {}, commits: 0, startedAt: at, at }
  const relay = (entry: object) => ({ v: 1 as const, run: 'r', sessions: { s: { ...base, ...entry } as any } })
  const review = applyRelay(relay({ reviews: { count: 1, standards: '3', spec: null, fixed: 1 } }), 'r', 's', { kind: 'counts', review: { standards: 2, spec: 2, fixed: 2 } }, at + 1)!
  expect(review.sessions.s!.reviews).toEqual({ count: 2, standards: '3', spec: null, fixed: 3 })
  const odd = applyRelay(relay({ reviews: 'abîmé' }), 'r', 's', { kind: 'counts', review: { standards: 2, spec: 2, fixed: 2 } }, at + 1)
  // Rien ne s'écrit : l'entrée garde sa valeur, jamais effacée.
  expect(odd).toBeNull()
  const security = applyRelay(relay({ security: { findings: 'x', fixed: 1, at } }), 'r', 's', { kind: 'counts', security: { findings: 0, fixed: 0 } }, at + 1)!
  expect(security.sessions.s!.security).toMatchObject({ findings: 'x', fixed: 0 })
  const oddSecurity = applyRelay(relay({ security: 'abîmé' }), 'r', 's', { kind: 'counts', security: { findings: 0 } }, at + 1)
  expect(oddSecurity).toBeNull()
  // Avec une revue lisible dans le même envoi, seule la revue s'écrit : l'avis gardé reste tel quel.
  const both = applyRelay(relay({ security: 'abîmé' }), 'r', 's', { kind: 'counts', review: { standards: 1, spec: 0, fixed: 0 }, security: { findings: 0 } }, at + 1)!
  expect(both.sessions.s!.security).toBe('abîmé')
  expect(both.sessions.s!.reviews).toEqual({ count: 1, standards: 1, spec: 0, fixed: 0 })
})
