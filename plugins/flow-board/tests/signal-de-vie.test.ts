// Le signal de vie d'une discussion (`hooks/liveness.ts`) : le verdict, fonction pure, un test par ligne des deux
// tableaux du verdict et du prédicat d'attache ; puis ses lecteurs sur un faux disque, en lecture seule.

import { expect, test } from 'claude-code/testing'

import { JOBS_MAX, SESSIONS_MAX, livenessVerdict, readJobOf, readSessions, readVerdicts } from '../hooks/liveness.ts'
import type { JobRead, SessionsRead } from '../hooks/liveness.ts'

const HOME = '/poste/.claude'
const ID = '5e1f0a2b-7c3d-4e8f-9a1b-2c3d4e5f6a7b'
const OTHER = '5e1f0a2b-0000-4000-8000-000000000000'
const CLEARED = '7c1d2e3f-aaaa-4bbb-8ccc-dddddddddddd'
const T = Date.parse('2026-11-17T12:00:00.000Z')
const MIN = 60_000

const seen = (ids: string[], isComplete = true): SessionsRead => ({ ids: new Set(ids), isComplete })
const jobOf = (o: Partial<JobRead> = {}): JobRead => ({ sessionId: ID, updatedAt: T, ...o })
const claimAt = (at: number) => ({ boot: 'boot-P1', at })

// ─── Le verdict, ligne par ligne ───────────────────────────────────────────

test('son fichier de session : vivante, même sans job ni prise, même sur une lecture incomplète', () => {
  expect(livenessVerdict(ID, seen([ID]), null, undefined, T)).toBe('alive')
  expect(livenessVerdict(ID, seen([ID], false), null, undefined, T)).toBe('alive')
})

test('après un /clear : un fichier de session porte le `resumeSessionId` (ou le `sessionId`) de son job : vivante', () => {
  expect(livenessVerdict(ID, seen([CLEARED]), jobOf({ resumeSessionId: CLEARED }), claimAt(T - MIN), T)).toBe('alive')
  expect(livenessVerdict(CLEARED, seen([ID]), jobOf({ resumeSessionId: CLEARED }), claimAt(T - MIN), T)).toBe('alive')
})

test('lecture incomplète : inconnu, jamais arrêtée', () => {
  expect(livenessVerdict(ID, seen([], false), jobOf(), claimAt(T - MIN), T)).toBe('unknown')
})

test('sans job : inconnu', () => {
  expect(livenessVerdict(ID, seen([]), null, claimAt(T - MIN), T)).toBe('unknown')
})

test('arrêtée : une lecture complète, son job, la prise en forme avant `updatedAt`, lui-même pas dans le futur', () => {
  expect(livenessVerdict(ID, seen([OTHER]), jobOf(), claimAt(T - MIN), T + MIN)).toBe('stopped')
  // Bornes justes : la prise à la date même du job, le job à l'heure même.
  expect(livenessVerdict(ID, seen([]), jobOf(), claimAt(T), T)).toBe('stopped')
})

test('reprise ailleurs : une prise postérieure à `updatedAt` du job (la mission reprise par un autre processus) : inconnu', () => {
  expect(livenessVerdict(ID, seen([]), jobOf(), claimAt(T + 1), T + MIN)).toBe('unknown')
})

test('updatedAt futur : inconnu', () => {
  expect(livenessVerdict(ID, seen([]), jobOf({ updatedAt: T + MIN }), claimAt(T - MIN), T)).toBe('unknown')
})

test('sans prise : absente ou hors forme, inconnu', () => {
  for (const claim of [undefined, null, 'boot-P1', { boot: '', at: T - MIN }, { boot: 'boot-P1', at: 'hier' }]) {
    expect(livenessVerdict(ID, seen([]), jobOf(), claim, T)).toBe('unknown')
  }
})

// ─── Un faux disque, en lecture seule ──────────────────────────────────────

type Node = { kind: 'file' | 'dir' | 'other'; text?: string; size?: number; isLink?: boolean }

/**
 * Le disque de ce test : `nodes` par chemin absolu (modifiables en route), servi par un faux `$` (seulement `$.fs`,
 * posé dans `fake`, que le test passe aux lecteurs) ; toute lecture et toute écriture tentées sont notées.
 */
let fake: any = null
const disk = (nodes: Record<string, Node>) => {
  const reads: string[] = []
  const writes: string[] = []
  const sizeOf = (n: Node) => (n.kind === 'file' ? (n.size ?? (n.text ?? '').length) : 0)
  fake = {
    fs: {
      list: async (path: string) => {
        const dir = `${path}/`
        if (nodes[path]?.kind !== 'dir') throw new Error(`ENOENT ${path}`)
        const names = Object.keys(nodes).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
        return names.map(p => ({ name: p.slice(dir.length), kind: nodes[p]!.kind, size: sizeOf(nodes[p]!), mtimeMs: 1, isLink: nodes[p]!.isLink === true }))
      },
      // Comme le vrai `stat` : le genre de ce vers quoi mène un lien, et `isLink`.
      stat: async (path: string) => {
        const n = nodes[path]
        if (!n) throw new Error(`ENOENT ${path}`)
        return { kind: n.isLink ? 'file' : n.kind, size: sizeOf(n), mtimeMs: 1, isLink: n.isLink === true }
      },
      read: async (path: string) => {
        reads.push(path)
        const n = nodes[path]
        if (!n || n.text === undefined) throw new Error(`EIO ${path}`)
        return n.text
      },
      exists: async (path: string) => nodes[path] !== undefined,
      write: async (path: string) => {
        writes.push(path)
      },
    },
  }
  return { reads, writes }
}

/** Un fichier de session de Claude Code, `<pid>.json`, aux champs relevés (`essais.md`). */
const sessionFile = (sessionId: string, pid = 4242) =>
  JSON.stringify({ pid, sessionId, cwd: '/poste/projet', startedAt: T - 60 * MIN, updatedAt: T - 60 * MIN, kind: 'bg', entrypoint: 'cli', status: 'idle', version: '2.1.326' })
/** Le `state.json` d'un job de `claude --bg`, aux champs relevés (`essais.md`), dates ISO. */
const stateFile = (sessionId: string, updatedAt = T, resumeSessionId = sessionId) =>
  JSON.stringify({ sessionId, resumeSessionId, state: 'done', tempo: 'idle', name: 'manager', updatedAt: new Date(updatedAt).toISOString() })

const dirs = (...paths: string[]): Record<string, Node> => Object.fromEntries(paths.map(p => [p, { kind: 'dir' } as Node]))

test('le lecteur des sessions : les seuls `<chiffres>.json`, jamais un `.key`, un lien ni un autre nom ; un lien rend la lecture incomplète ; rien d’écrit', async () => {
  const d = disk({
    ...dirs(HOME, `${HOME}/sessions`),
    [`${HOME}/sessions/4242.json`]: { kind: 'file', text: sessionFile(ID) },
    [`${HOME}/sessions/4242.abcdef.key`]: { kind: 'file', text: 'secret' },
    [`${HOME}/sessions/4243.json`]: { kind: 'other', isLink: true, text: sessionFile(OTHER, 4243) },
    [`${HOME}/sessions/notes.json`]: { kind: 'file', text: sessionFile(OTHER) },
    [`${HOME}/sessions/12345678901.json`]: { kind: 'file', text: sessionFile(OTHER) },
  })
  const read = await readSessions(fake, HOME)
  expect([...read.ids]).toEqual([ID])
  // Le lien `4243.json`, jamais ouvert, rend la lecture incomplète (P4) ; un `.key` ou un autre nom n'y change rien.
  expect(read.isComplete).toBe(false)
  expect(d.reads).toEqual([`${HOME}/sessions/4242.json`])
  expect(d.writes).toEqual([])
})

test('lecture incomplète : un `<chiffres>.json` qui est un lien ou un dossier, jamais ouvert ; sans eux, complète', async () => {
  const nodes: Record<string, Node> = {
    ...dirs(HOME, `${HOME}/sessions`),
    [`${HOME}/sessions/4242.json`]: { kind: 'file', text: sessionFile(ID) },
    [`${HOME}/sessions/4242.abcdef.key`]: { kind: 'file', text: 'secret' },
  }
  const d = disk(nodes)
  expect((await readSessions(fake, HOME)).isComplete).toBe(true)
  for (const node of [{ kind: 'other', isLink: true, text: sessionFile(OTHER) }, { kind: 'dir' }] as Node[]) {
    nodes[`${HOME}/sessions/4243.json`] = node
    expect(await readSessions(fake, HOME)).toEqual({ ids: new Set([ID]), isComplete: false })
  }
  expect(d.reads.every(p => p === `${HOME}/sessions/4242.json`)).toBe(true)
})

test('lecture incomplète : dossier de Claude Code absent, dossier qui ne se liste pas', async () => {
  disk(dirs(HOME))
  expect(await readSessions(fake, null)).toEqual({ ids: new Set(), isComplete: false })
  expect((await readSessions(fake, HOME)).isComplete).toBe(false)
})

test('lecture incomplète : un fichier trop gros, un JSON coupé, sans `sessionId` sûr, qui ne se lit pas ; les trouvés restent vivants', async () => {
  const nodes: Record<string, Node> = { ...dirs(HOME, `${HOME}/sessions`), [`${HOME}/sessions/9.json`]: { kind: 'file', text: sessionFile(ID, 9) } }
  disk(nodes)
  expect((await readSessions(fake, HOME)).isComplete).toBe(true)
  const cases: [string, Node][] = [
    ['trop gros', { kind: 'file', text: sessionFile(OTHER), size: 65_537 }],
    ['JSON coupé', { kind: 'file', text: '{"sessionId":"5e1f' }],
    ['id hors forme', { kind: 'file', text: JSON.stringify({ sessionId: '../../etc' }) }],
    ['sans id', { kind: 'file', text: JSON.stringify({ pid: 1 }) }],
    ['illisible', { kind: 'file', size: 10 }],
  ]
  for (const [what, node] of cases) {
    nodes[`${HOME}/sessions/1.json`] = node
    const read = await readSessions(fake, HOME)
    expect([what, read.isComplete, [...read.ids]]).toEqual([what, false, [ID]])
    // Sur une lecture incomplète, une discussion absente n'est jamais « arrêtée ».
    expect(livenessVerdict(OTHER, read, jobOf({ sessionId: OTHER }), claimAt(T - MIN), T)).toBe('unknown')
  }
})

test('lecture incomplète : plus de 256 fichiers de session, seuls les 256 premiers se lisent et leurs discussions restent vivantes ; 256 se lisent tous', async () => {
  const nodes: Record<string, Node> = dirs(HOME, `${HOME}/sessions`)
  for (let i = 0; i < SESSIONS_MAX; i++) nodes[`${HOME}/sessions/${1000 + i}.json`] = { kind: 'file', text: sessionFile(ID, 1000 + i) }
  const d = disk(nodes)
  expect(await readSessions(fake, HOME)).toEqual({ ids: new Set([ID]), isComplete: true })
  nodes[`${HOME}/sessions/9999.json`] = { kind: 'file', text: sessionFile(OTHER, 9999) }
  d.reads.length = 0
  const read = await readSessions(fake, HOME)
  // Le 257e dans l'ordre des noms (« 9999.json ») n'est pas lu ; ceux qui le sont gardent leur discussion vivante.
  expect(read).toEqual({ ids: new Set([ID]), isComplete: false })
  expect(d.reads).toHaveLength(SESSIONS_MAX)
  expect(d.reads).not.toContain(`${HOME}/sessions/9999.json`)
})

// ─── Le prédicat d'attache : quel job est celui de la discussion ──────────

test('id de l’app : un `local_…` n’a jamais de job ; inconnu sans fichier de session, vivant avec', async () => {
  const nodes: Record<string, Node> = { ...dirs(HOME, `${HOME}/sessions`, `${HOME}/jobs`, `${HOME}/jobs/local_ab`), [`${HOME}/jobs/local_ab/state.json`]: { kind: 'file', text: stateFile('local_abc') } }
  const d = disk(nodes)
  expect(await readJobOf(fake, HOME, 'local_abc')).toBeNull()
  expect(await readVerdicts(fake, HOME, [{ owner: 'local_abc', claim: claimAt(T - MIN) }], T)).toEqual(['unknown'])
  expect(d.reads.some(p => p.includes('/jobs/'))).toBe(false)
  nodes[`${HOME}/sessions/5.json`] = { kind: 'file', text: sessionFile('local_abc', 5) }
  expect(await readVerdicts(fake, HOME, [{ owner: 'local_abc', claim: claimAt(T - MIN) }], T)).toEqual(['alive'])
})

test('sans job : un UUID sans job ni fichier de session est inconnu', async () => {
  disk(dirs(HOME, `${HOME}/sessions`, `${HOME}/jobs`))
  expect(await readJobOf(fake, HOME, ID)).toBeNull()
  expect(await readVerdicts(fake, HOME, [{ owner: ID, claim: claimAt(T - MIN) }], T + MIN)).toEqual(['unknown'])
})

test('job d’un autre id : le job du même préfixe qui porte un autre id (ni `sessionId` ni `resumeSessionId`) est ignoré', async () => {
  disk({ ...dirs(HOME, `${HOME}/sessions`, `${HOME}/jobs`, `${HOME}/jobs/5e1f0a2b`), [`${HOME}/jobs/5e1f0a2b/state.json`]: { kind: 'file', text: stateFile(OTHER) } })
  expect(await readJobOf(fake, HOME, ID)).toBeNull()
  expect(await readVerdicts(fake, HOME, [{ owner: ID, claim: claimAt(T - MIN) }], T + MIN)).toEqual(['unknown'])
})

test('titulaire d’après un /clear : le job d’un autre préfixe dont seul le `resumeSessionId` porte l’id est trouvé par la recherche bornée ; arrêtée', async () => {
  // Le job est nommé par l'ancien id (ID) ; la mission reprise après le /clear a pour titulaire le nouveau (CLEARED).
  disk({
    ...dirs(HOME, `${HOME}/sessions`, `${HOME}/jobs`, `${HOME}/jobs/aaaaaaaa`, `${HOME}/jobs/5e1f0a2b`, `${HOME}/jobs/notes`),
    [`${HOME}/jobs/aaaaaaaa/state.json`]: { kind: 'file', text: stateFile('aaaaaaaa-1111-4111-8111-111111111111') },
    [`${HOME}/jobs/5e1f0a2b/state.json`]: { kind: 'file', text: stateFile(ID, T, CLEARED) },
  })
  expect(await readJobOf(fake, HOME, CLEARED)).toEqual({ sessionId: ID, resumeSessionId: CLEARED, updatedAt: T })
  expect(await readVerdicts(fake, HOME, [{ owner: CLEARED, claim: claimAt(T - MIN) }], T + MIN)).toEqual(['stopped'])
})

test('trop de jobs : trouvé parmi 128 dossiers ; au-delà, la recherche s’arrête, pas de job', async () => {
  const nodes: Record<string, Node> = dirs(HOME, `${HOME}/sessions`, `${HOME}/jobs`)
  for (let i = 0; i < JOBS_MAX; i++) nodes[`${HOME}/jobs/${(0xa0000000 + i).toString(16)}`] = { kind: 'dir' }
  nodes[`${HOME}/jobs/a0000000/state.json`] = { kind: 'file', text: stateFile('a0000000-0000-4000-8000-000000000000', T, ID) }
  disk(nodes)
  expect(await readJobOf(fake, HOME, ID)).toMatchObject({ resumeSessionId: ID })
  nodes[`${HOME}/jobs/bfffffff`] = { kind: 'dir' }
  expect(await readJobOf(fake, HOME, ID)).toBeNull()
})

test('un UUID avec son job : arrêtée sur une lecture complète ; vivante avec son fichier de session ; rien d’écrit, aucun `.key` lu', async () => {
  const nodes: Record<string, Node> = {
    ...dirs(HOME, `${HOME}/sessions`, `${HOME}/jobs`, `${HOME}/jobs/5e1f0a2b`),
    [`${HOME}/jobs/5e1f0a2b/state.json`]: { kind: 'file', text: stateFile(ID, T) },
    [`${HOME}/sessions/77.json`]: { kind: 'file', text: sessionFile(OTHER, 77) },
    [`${HOME}/sessions/77.0a1b.key`]: { kind: 'file', text: 'secret' },
  }
  const d = disk(nodes)
  // Deux missions de la même discussion, à deux prises : le dossier des sessions est lu une fois pour les deux.
  expect(await readVerdicts(fake, HOME, [{ owner: ID, claim: claimAt(T - MIN) }, { owner: ID, claim: claimAt(T + 1) }], T + MIN)).toEqual(['stopped', 'unknown'])
  expect(d.reads.filter(p => p.includes('/sessions/'))).toEqual([`${HOME}/sessions/77.json`])
  nodes[`${HOME}/sessions/78.json`] = { kind: 'file', text: sessionFile(ID, 78) }
  expect(await readVerdicts(fake, HOME, [{ owner: ID, claim: claimAt(T - MIN) }], T + MIN)).toEqual(['alive'])
  expect(d.writes).toEqual([])
  expect(d.reads.some(p => p.endsWith('.key'))).toBe(false)
})

test('le `state.json` d’un job : un lien, trop gros, illisible, pas du JSON ou sans `updatedAt` lisible est ignoré', async () => {
  const bad: [string, Node][] = [
    ['lien', { kind: 'other', isLink: true, text: stateFile(ID) }],
    ['trop gros', { kind: 'file', text: stateFile(ID), size: 65_537 }],
    ['illisible', { kind: 'file', size: 10 }],
    ['pas du JSON', { kind: 'file', text: '{"sessionId":' }],
    ['date illisible', { kind: 'file', text: JSON.stringify({ sessionId: ID, updatedAt: 'hier' }) }],
  ]
  const nodes: Record<string, Node> = dirs(HOME, `${HOME}/sessions`, `${HOME}/jobs`, `${HOME}/jobs/5e1f0a2b`)
  disk(nodes)
  nodes[`${HOME}/jobs/5e1f0a2b/state.json`] = { kind: 'file', text: stateFile(ID) }
  expect(await readJobOf(fake, HOME, ID)).toEqual({ sessionId: ID, resumeSessionId: ID, updatedAt: T })
  for (const [what, node] of bad) {
    nodes[`${HOME}/jobs/5e1f0a2b/state.json`] = node
    expect([what, await readJobOf(fake, HOME, ID)]).toEqual([what, null])
  }
})

test('le dossier du job à son propre préfixe, quand c’est un lien vers un dossier ailleurs : ignoré, comme dans la recherche', async () => {
  const nodes: Record<string, Node> = dirs(HOME, `${HOME}/sessions`, `${HOME}/jobs`)
  nodes[`${HOME}/jobs/5e1f0a2b`] = { kind: 'dir', isLink: true }
  nodes[`${HOME}/jobs/5e1f0a2b/state.json`] = { kind: 'file', text: stateFile(ID) }
  disk(nodes)
  expect(await readJobOf(fake, HOME, ID)).toBe(null)
  nodes[`${HOME}/jobs/5e1f0a2b`] = { kind: 'dir' }
  expect(await readJobOf(fake, HOME, ID)).toEqual({ sessionId: ID, resumeSessionId: ID, updatedAt: T })
})

test('un `$` dont chaque lecture lève, ou sans système de fichiers : « inconnu » pour toutes', async () => {
  const fails = async () => {
    throw new Error('EIO')
  }
  const broken = { fs: { list: fails, stat: fails, read: fails, exists: fails, write: fails } }
  expect(await readVerdicts(broken, HOME, [{ owner: ID, claim: claimAt(T - MIN) }, { owner: 'local_x', claim: undefined }], T)).toEqual(['unknown', 'unknown'])
  // Un `$` sans système de fichiers : de même.
  expect(await readVerdicts({}, HOME, [{ owner: ID, claim: claimAt(T - MIN) }], T)).toEqual(['unknown'])
})
