// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { C } from '../hooks/catalog.ts'
import { attachRegistries, registryInfo, type ListedHead } from '../hooks/coo-agents.ts'
import { cooAgentRows, cooStatement } from '../hooks/coo.ts'
import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import { emptyRegistry } from '../hooks/registry.ts'
import type { Board, Run, SessionRegistry, TicketGroup } from '../types'
import { PANE, PLUGIN, openCoo, settle, world, writeBoard, type World } from './monde-coordination.ts'

/** La discussion démarre dans le dossier du projet : sa racine est celle des registres de ses missions. */
const start = ($: any) => $.session.start({ cwd: '/proj', surface: null, isInteractive: true })

// La liste des agents du COO lit les registres : l'état d'un manager (« travaille », « attend ta réponse », « au
// repos ») et le nombre de spécialistes au travail d'un manager et d'un worker. Invariant du ticket : « Pour sa liste
// des agents, le COO ne lit un registre que sous un nom rendu par la liste du dossier des registres, et cette lecture
// n'écrit rien : ni registre, ni relais. »

const T0 = 960_000_000
const ROOT = '/proj'
const nb = (t: string | undefined): string => (t ?? '').replace(/ /g, ' ')

/** Une mission à deux groupes (A : 1 et 2, B : 3), tenue par `owner`. */
const missionOf = (title: string, owner: string, groups: (g: TicketGroup) => TicketGroup = g => g, over: Partial<Run> = {}): Run => {
  const run = newRun('implement', T0 - 20_000, title)
  const base: Board = { ...emptyBoard(ROOT, 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = {
    tickets: [1, 2, 3].map(n => ({ id: String(n), name: `T${n}`, files: [`f${n}.ts`] })),
    groups: [
      { id: 'A', name: 'A', tickets: ['1', '2'] },
      { id: 'B', name: 'B', tickets: ['3'] },
    ],
  }
  const planned = applyReport(base, report as any, T0 - 19_000).board.runs[0] as Run
  return { ...planned, status: 'active', owner, updatedAt: T0 - 1000, groups: planned.groups!.map(groups), ...over }
}
const confided = (session: string) => (g: TicketGroup): TicketGroup => (g.id === 'A' ? { ...g, linked: { at: T0 - 40_000, session } } : g)
const boardOf = (runs: Run[]): Board => ({ ...emptyBoard(ROOT, 'p'), deleted: [], runs })

const agent = (key: string, status: 'running' | 'done') => ({ key, agentId: key, name: key, isBackground: false, status, startedAt: T0 - 5000, ...(status === 'done' ? { finishedAt: T0 - 1000 } : {}) })
/** Un registre : sa piste principale (`open` : la sorte de son segment en cours, sans segment en cours si absente) et ses spécialistes au travail. */
const registryOf = (session: string, over: Partial<SessionRegistry> & { open?: string; running?: number } = {}): SessionRegistry => {
  const { open, running = 0, ...rest } = over
  return {
    ...emptyRegistry(session, ROOT, T0 - 2000),
    main: { segments: [{ k: 'write', s: T0 - 9000, e: T0 - 8000 }, ...(open ? [{ k: open, s: T0 - 3000 }] : [])] } as any,
    agents: [...Array.from({ length: running }, (_, i) => agent(`r${i}`, 'running')), agent('fini', 'done')] as any,
    ...rest,
  }
}
const head = (session: string, over: Partial<SessionRegistry> = {}): ListedHead => ({ session, mtime: 1, head: { ...emptyRegistry(session, ROOT, T0 - 2000), ...over } })

// ─── Le rattachement et ce que dit un registre, purs ────────────────────────────

test('rattachement d’un registre à une ligne : la table des formes reçues', () => {
  const run = missionOf('Vue', 'session-m', g => (g.id === 'A' ? { ...g, linked: { at: T0 - 40_000, session: 'w-a' } } : g))
  const orphan = missionOf('Sans discussion', '')
  const board = boardOf([run, orphan])
  const heads = [
    head('session-m'),
    head('w-a-old', { run: run.id, group: 'A', updatedAt: T0 - 9000 }),
    head('w-a-new', { run: run.id, group: 'a', updatedAt: T0 - 1000 }),
    // Un autre projet, une mission inconnue, un groupe pas confié, un groupe inconnu du plan.
    head('w-ailleurs', { root: '/autre', run: run.id, group: 'A', updatedAt: T0 }),
    head('w-inconnue', { run: 'mission-inconnue', group: 'A' }),
    head('w-b', { run: run.id, group: 'B' }),
    head('w-z', { run: run.id, group: 'Z' }),
  ]
  const attached = attachRegistries(board, heads)
  expect(Object.fromEntries(attached)).toEqual({ [run.id]: 'session-m', [`${run.id}:A`]: 'w-a-new' })
  // Aucun registre ne porte la session qui tient la mission, ni ne déclare ce groupe : rien.
  expect(attachRegistries(board, [head('autre')]).size).toBe(0)
  // Un worktree du projet est le même projet.
  expect(attachRegistries(board, [head('session-m', { root: `${ROOT}/.claude/worktrees/groupe-x` })]).get(run.id)).toBe('session-m')
  // Le groupe déclaré se lit comme le relais le lit : « Groupe A », « A · Lecture ».
  expect(attachRegistries(board, [head('w-long', { run: run.id, group: 'Groupe A', updatedAt: T0 - 1000 })]).get(`${run.id}:A`)).toBe('w-long')
  expect(attachRegistries(board, [head('w-titre', { run: run.id, group: 'A · Lecture', updatedAt: T0 - 1000 })]).get(`${run.id}:A`)).toBe('w-titre')
  // Un registre d'avant le dernier envoi du groupe (la session d'un envoi précédent) n'est plus le sien, même plus récent qu'un autre.
  const resent = boardOf([{ ...run, groups: run.groups!.map(g => (g.id === 'A' ? { ...g, linked: { at: T0 - 5000, session: 'w-y' } } : g)) }])
  expect(attachRegistries(resent, [head('w-x', { run: run.id, group: 'A', updatedAt: T0 - 6000 })]).get(`${run.id}:A`)).toBeUndefined()
  expect(attachRegistries(resent, [head('w-x', { run: run.id, group: 'A', updatedAt: T0 - 6000 }), head('w-y', { run: run.id, group: 'A', updatedAt: T0 - 4000 })]).get(`${run.id}:A`)).toBe('w-y')
})

test('ce que dit un registre lu en entier : attente de la personne, travail, repos, spécialistes au travail', () => {
  expect(registryInfo(registryOf('s', { open: 'waitPerson', running: 2 }))).toEqual({ state: 'attend ta réponse', running: 2 })
  for (const k of ['think', 'write', 'tool', 'waitAgent', 'waitBg', 'waitAdvisor']) expect(registryInfo(registryOf('s', { open: k })).state, k).toBe('travaille')
  expect(registryInfo(registryOf('s'))).toEqual({ state: 'au repos' })
  expect(registryInfo(registryOf('s', { running: 1 })).running).toBe(1)
})

// ─── Le panneau du COO rendu ───────────────────────────────────────────────────

/** Pose un registre comme sa session l'écrit : son fichier dans le dossier des registres, sa clé de `$.store` en repli. */
const putRegistry = (w: World, name: string, reg: unknown, part = 0) => {
  const file = `flow-board/agents/${name}${part === 0 ? '' : `.${part}`}.json`
  w.files[file] = typeof reg === 'string' ? reg : JSON.stringify(reg)
  mtimes.set(file.slice('flow-board/agents/'.length), mtimes.size + 2 + Math.max(0, ...mtimes.values()))
  w.mem[part === 0 ? `agents:${name}` : `agents:${name}:${part}`] = typeof reg === 'string' ? reg : reg
}
const dropRegistry = (w: World, name: string) => {
  delete w.files[`flow-board/agents/${name}.json`]
  delete w.mem[`agents:${name}`]
}
/** Le dossier des registres liste ce qui y est posé (les noms seulement : `registryFiles` les filtre par leur forme). */
const listRegistries = (w: World) => {
  w.probe.list = dir => (dir.endsWith('/flow-board/agents') ? Object.keys(w.files).filter(k => k.startsWith('flow-board/agents/')).map(k => k.slice('flow-board/agents/'.length)) : undefined)
  // La date d'un fichier change à chaque écriture, comme sur le disque.
  mtimes.clear()
  w.probe.mtime = (_dir, name) => mtimes.get(name)
}
/** La date de chaque fichier de registre posé (son nom dans le dossier) : 2, 3… à chaque écriture. */
const mtimes = new Map<string, number>()

const textsOf = async (ui: any): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map((t: any) => nb(String(t.text ?? '')))
const cooWorld = async ($: any, on: any, runs: Run[]): Promise<{ w: World; clock: any }> => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  // La discussion tourne à la racine du projet (celle de son dépôt) : le siège s'y prend, et les registres du projet s'y rattachent.
  on('session.root', () => ({ value: ROOT }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    throw new Error(`ENOENT ${e.path}`)
  })
  listRegistries(w)
  writeBoard(w, b => ({ ...b, root: ROOT, runs }))
  // En `$.store`, le tableau d'un projet est sous la clé de sa racine.
  w.mem[`board:${ROOT}`] = w.mem['board:']
  w.ids.now = 'session-C'
  return { w, clock }
}
const agentsTab = async ($: any, clock: any): Promise<string[]> => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'tab-agents' })
  await settle(clock, 1)
  const texts = await textsOf(pane)
  await pane.unmount()
  return texts
}

test('chez le COO : le manager « travaille » avec ses spécialistes au travail, le worker les siens ; la liste se relit sans perdre ses comptes', { timeoutMs: 30000 }, async ($, on) => {
  const run = missionOf('Vue', 'session-m', confided('w-a'))
  const { w, clock } = await cooWorld($, on, [run])
  putRegistry(w, 'session-m', registryOf('session-m', { open: 'think', running: 2 }))
  putRegistry(w, 'w-a', registryOf('w-a', { run: run.id, group: 'A', running: 1 }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const texts = await agentsTab($, clock)
  for (const text of ['· travaille', '· 2 spécialistes au travail', '· 1 spécialiste au travail']) expect(texts, text).toContain(text)
  // Les relectures suivantes (celles des workers de la discussion comprises) gardent ce que la liste a lu.
  await settle(clock, 12)
  const again = await agentsTab($, clock)
  for (const text of ['· travaille', '· 2 spécialistes au travail', '· 1 spécialiste au travail']) expect(again, text).toContain(text)
})

test('chez le COO : « attend ta réponse » et « au repos » lus du registre ; un registre absent ne dit rien', { timeoutMs: 30000 }, async ($, on) => {
  const waiting = missionOf('Attend', 'session-m')
  const idle = missionOf('Repos', 'session-r')
  const silent = missionOf('Muette', 'session-s')
  const { w, clock } = await cooWorld($, on, [waiting, idle, silent])
  putRegistry(w, 'session-m', registryOf('session-m', { open: 'waitPerson' }))
  putRegistry(w, 'session-r', registryOf('session-r'))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const texts = await agentsTab($, clock)
  expect(texts).toContain('· attend ta réponse')
  expect(texts).toContain('· au repos')
  // La mission muette : sa ligne, sans mot d'état.
  const at = texts.indexOf('Muette')
  expect(at).toBeGreaterThan(-1)
  expect(texts[at + 2] ?? '').not.toMatch(/^· (travaille|au repos|attend ta réponse)$/)
})

test('chez le COO : un registre pas entier (morceau suivant illisible) ne donne ni état ni compte ; un registre effacé retire le compte, pas la ligne', { timeoutMs: 30000 }, async ($, on) => {
  const broken = missionOf('Coupée', 'session-k')
  const erased = missionOf('Effacée', 'session-e')
  const { w, clock } = await cooWorld($, on, [broken, erased])
  putRegistry(w, 'session-k', registryOf('session-k', { open: 'think', running: 3, parts: 2 }))
  putRegistry(w, 'session-k', '{"v":1,"part":1,"agen', 1)
  putRegistry(w, 'session-e', registryOf('session-e', { open: 'think', running: 2 }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  let texts = await agentsTab($, clock)
  expect(texts).not.toContain('· 3 spécialistes au travail')
  expect(texts).toContain('· 2 spécialistes au travail')
  dropRegistry(w, 'session-e')
  await settle(clock, 6)
  texts = await agentsTab($, clock)
  expect(texts).toContain('Effacée')
  expect(texts).not.toContain('· 2 spécialistes au travail')
  expect(texts).not.toContain('· travaille')
})

test('chez le COO : un registre lu en entier puis relu à moitié écrit garde la lecture d’avant, jamais un compte partiel', { timeoutMs: 30000 }, async ($, on) => {
  // Au fichier, sa date change à l'écriture coupée : la relecture a bien lieu (en `$.store`, date -1, à chaque veille).
  const run = missionOf('Relue', 'session-k')
  const { w, clock } = await cooWorld($, on, [run])
  putRegistry(w, 'session-k', registryOf('session-k', { open: 'think', running: 3 }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  expect(await agentsTab($, clock)).toContain('· 3 spécialistes au travail')
  // Une écriture coupée : l'en-tête annonce un second morceau, illisible, et porte un autre compte.
  putRegistry(w, 'session-k', registryOf('session-k', { open: 'think', running: 1, parts: 2 }))
  putRegistry(w, 'session-k', '{"v":1,"part":1,"agen', 1)
  await settle(clock, 6)
  const texts = await agentsTab($, clock)
  expect(texts).toContain('· 3 spécialistes au travail')
  expect(texts).not.toContain('· 1 spécialiste au travail')
})

test('chez le COO : un registre réécrit se relit à la veille suivante, et la ligne le suit', { timeoutMs: 30000 }, async ($, on) => {
  const run = missionOf('Suivie', 'session-m', confided('w-a'))
  const { w, clock } = await cooWorld($, on, [run])
  putRegistry(w, 'session-m', registryOf('session-m', { open: 'think', running: 2 }))
  putRegistry(w, 'w-a', registryOf('w-a', { run: run.id, group: 'A', running: 1 }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  expect(await agentsTab($, clock)).toContain('· travaille')
  putRegistry(w, 'session-m', registryOf('session-m'))
  putRegistry(w, 'w-a', registryOf('w-a', { run: run.id, group: 'A', running: 3 }))
  await settle(clock, 6)
  const texts = await agentsTab($, clock)
  expect(texts).toContain('· au repos')
  expect(texts).not.toContain('· travaille')
  expect(texts).toContain('· 3 spécialistes au travail')
})

test('pas de compte de spécialistes pour une discussion arrêtée, une mission en pause ou en pause de l’auto, ni un worker arrêté ou fini', () => {
  const run = missionOf('Morte', 'session-m', g => ({ ...g, linked: { at: T0 - 40_000, session: `w-${g.id.toLowerCase()}` } }))
  const relay = {
    v: 1,
    run: run.id,
    sessions: {
      'w-a': { group: 'A', startedAt: T0 - 30_000, at: T0 - 5_000, commits: 0, tickets: {}, last: { kind: 'note', text: 'worker arrêté : /login', at: T0 - 6000 } },
      'w-b': { group: 'B', startedAt: T0 - 30_000, at: T0 - 5_000, commits: 0, tickets: {}, endedAt: T0 - 1000 },
    },
  } as any
  const agents = () => ({ state: 'travaille' as const, running: 2 })
  const rowsOf = (r: Run, ctx: Record<string, unknown> = {}) => cooAgentRows(cooStatement(boardOf([r]), { now: T0, agents, relayOf: () => relay, ...ctx }))
  const stopped = rowsOf(run, { liveness: () => 'stopped' })
  expect(stopped.map(r => r.running)).toEqual([undefined, undefined, undefined])
  const parked = rowsOf({ ...run, auto: { onAt: T0 - 100, onBy: 'x', offAt: T0 - 50, offWhy: 'lecture du parcours ratée' } } as any)
  expect(parked[0]!.running).toBeUndefined()
  // Une mission mise en pause : sa discussion en travaille peut-être une autre, dont la ligne compte déjà ses spécialistes.
  const paused = rowsOf({ ...run, status: 'paused' }, { relayOf: () => null })
  expect(paused[0]!.state?.text).toBe('en pause')
  expect(paused[0]!.running).toBeUndefined()
  // Une session au travail garde le sien.
  const live = rowsOf(missionOf('Vive', 'session-v', confided('w-c')), { relayOf: () => null })
  expect(live.map(r => r.running)).toEqual([2, 2])
})

test('l’ordre des cas d’un manager : en pause, discussion arrêtée et « t’attend » passent avant ce que dit le registre', () => {
  const stateOf = (run: Run, ctx: Record<string, unknown> = {}) => {
    const row = cooAgentRows(cooStatement(boardOf([run]), { now: T0, agents: (_m: string, group?: string) => (group === undefined ? { state: 'travaille', running: 2 } : undefined), ...ctx }))[0]
    return row?.kind === 'manager' ? row.state?.text : 'absent'
  }
  expect(stateOf(missionOf('P', 'session-p', g => g, { status: 'paused' }))).toBe('en pause')
  expect(stateOf(missionOf('S', 'session-s'), { liveness: () => 'stopped' })).toBe('discussion arrêtée')
  expect(stateOf(missionOf('W', 'session-w', g => g, { waitsUser: { kind: 'validation', since: T0 - 100 } } as any))).toBe('attend ta réponse')
  expect(stateOf(missionOf('T', 'session-t'))).toBe('travaille')
  // Le registre dit « attend ta réponse » : ambre, comme le signal « t'attend ».
  const row = cooAgentRows(cooStatement(boardOf([missionOf('A', 'session-a')]), { now: T0, agents: () => ({ state: 'attend ta réponse' }) }))[0]
  expect(row?.kind === 'manager' ? row.state : null).toEqual({ text: 'attend ta réponse', color: C.amber })
})

test('chez le COO : le registre d’un manager se retrouve par la forme fichier de son id, capitales comprises', { timeoutMs: 30000 }, async ($, on) => {
  const run = missionOf('Capitales', 'Session-M')
  const { w, clock } = await cooWorld($, on, [run])
  putRegistry(w, 'session-m', registryOf('Session-M', { open: 'think', running: 2 }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const texts = await agentsTab($, clock)
  for (const text of ['· travaille', '· 2 spécialistes au travail']) expect(texts, text).toContain(text)
})

test('invariant : un nom listé dont la forme fichier diffère (« -x ») est écarté, sans ouvrir le fichier d’un autre nom', { timeoutMs: 30000 }, async ($, on) => {
  const run = missionOf('Tiret', '-x')
  const { w, clock } = await cooWorld($, on, [run])
  // « -x » est listé ; « x » existe mais n'est pas listé : sa forme fichier, que « -x » ferait ouvrir.
  w.files['flow-board/agents/-x.json'] = JSON.stringify(registryOf('-x', { open: 'think', running: 1 }))
  w.mem['agents:-x'] = registryOf('-x', { open: 'think', running: 1 })
  w.files['flow-board/agents/x.json'] = JSON.stringify(registryOf('x', { open: 'think', running: 3 }))
  w.probe.list = dir => (dir.endsWith('/flow-board/agents') ? ['-x.json'] : undefined)
  const reads: string[] = []
  w.probe.refuseRead = key => {
    reads.push(key)
    return false
  }
  await start($)
  await openCoo($, clock)
  await settle(clock, 12)
  // Les lectures de la liste des agents, à la veille du siège, avant que l'onglet s'ouvre : ouvrir l'onglet Agents relit
  // aussi l'historique des discussions (`readAllHeads` de `register.tsx`, antérieur à cette liste), qui ne trie pas ses noms ainsi.
  expect(reads.filter(r => /flow-board\/agents\/x(\.\d+)?\.json$/.test(r) || /^agents:x(:\d+)?$/.test(r))).toEqual([])
  const texts = await agentsTab($, clock)
  expect(texts.filter(t => /spécialistes? au travail|^· travaille$/.test(t))).toEqual([])
})

test('chez le COO : un en-tête qui se dit d’une autre session que son nom, ou d’un autre projet, est ignoré', { timeoutMs: 30000 }, async ($, on) => {
  const run = missionOf('Vue', 'session-m', confided('w-a'))
  const { w, clock } = await cooWorld($, on, [run])
  putRegistry(w, 'session-m', registryOf('session-z', { open: 'think', running: 2 }))
  putRegistry(w, 'w-a', registryOf('w-a', { root: '/autre', run: run.id, group: 'A', running: 1 }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const texts = await agentsTab($, clock)
  expect(texts.filter(t => /spécialistes? au travail|^· travaille$/.test(t))).toEqual([])
})

test('invariant : des ids hostiles dans la mission et le relais ne font lire aucun registre hors des noms listés, et la lecture n’écrit ni registre ni relais', { timeoutMs: 30000 }, async ($, on) => {
  const run = missionOf('Hostile', '../../secret', g => (g.id === 'A' ? { ...g, linked: { at: T0 - 40_000, session: 'a/../../b' } } : g))
  const { w, clock } = await cooWorld($, on, [run])
  w.mem[`relay:${run.id}:x/../y`] = { v: 1, run: run.id, session: '../../z', entry: { group: 'A', startedAt: T0 - 30_000, at: T0 - 5_000, commits: 0, tickets: {} } }
  putRegistry(w, 'session-l', registryOf('session-l', { open: 'think', running: 1 }))
  const reads: string[] = []
  const writes: string[] = []
  w.probe.refuseRead = key => {
    reads.push(key)
    return false
  }
  w.probe.refuseWrite = path => {
    writes.push(path)
    return false
  }
  w.probe.refuseStore = key => {
    writes.push(key)
    return false
  }
  await start($)
  await openCoo($, clock)
  await settle(clock, 12)
  await agentsTab($, clock)
  // Les registres lus : seulement sous les noms listés (et celui de la discussion elle-même, qu'elle écrit).
  // (un registre : un fichier `<nom>.json` du dossier, ou sa clé `agents:<nom>` ; `agents:<mission>:rebuilt` est le rattrapage, d'avant ce ticket.)
  const registryReads = reads.filter(r => /flow-board\/agents\/[^/]*\.json$/.test(r) || /^agents:[^:]+(:\d+)?$/.test(r))
  expect(registryReads.length).toBeGreaterThan(0)
  for (const r of registryReads) expect(r, r).toMatch(/(flow-board\/agents\/|^agents:)(session-l|session-C)(\.\d+)?(\.json|:\d+)?$/)
  // Aucune lecture faite d'un id hostile (la clé du relais posée ici se lit par la liste des clés, comme avant ce ticket).
  expect(reads.filter(r => !r.startsWith('relay:') && (r.includes('secret') || r.includes('..')))).toEqual([])
  // Aucune écriture vers un registre d'une autre discussion ni un relais.
  const foreign = writes.filter(p => (p.includes('flow-board/agents/') || p.startsWith('agents:')) && !p.includes('session-C'))
  expect(foreign).toEqual([])
  expect(writes.filter(p => p.includes('/relais/') || p.startsWith('relay:'))).toEqual([])
})
