import { expect, test } from 'claude-code/testing'

import { cooStatement, statementText } from '../hooks/coo.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { clearLiveness, livenessOf, refreshLiveness } from '../hooks/coo-liveness.ts'
import type { Liveness } from '../hooks/liveness.ts'
import { emptyBoard, newRun, switchOnAuto } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// La vue Coordination et le relevé du COO disent « discussion arrêtée » pour une mission dont la discussion
// d'arrière-plan ne tourne plus (le verdict « arrêtée » du signal de vie, `hooks/liveness.ts`) :
// sa marque gagne le libellé, son mode et ses boutons restent ; « vivante » et « inconnu » ne changent rien.

const T0 = 1_000_000

/** Une mission active de la discussion « sb », vue du COO. */
const runWith = (over: Partial<Run> = {}): Run => ({ ...newRun('implement', T0, 'Boutique'), status: 'active', owner: 'sb', ...over })
const boardOf = (run: Run): Board => ({ ...emptyBoard('', 'p'), deleted: [], runs: [run] })
const litRun = (): Run => {
  const run = runWith()
  return switchOnAuto({ ...emptyBoard('', 'p'), session: 'sb', deleted: [], runs: [run], activeId: run.id }, 'sb', T0 + 1)!.board.runs[0]!
}

/** La ligne de la mission dans la vue (texte et boutons) et sa ligne du relevé, pour un verdict donné (aucun : absent). */
const seen = (run: Run, verdict?: Liveness) => {
  const board = boardOf(run)
  const s = cooStatement(board, { now: T0 + 10_000, ...(verdict ? { liveness: (id: string) => (id === run.id ? verdict : 'unknown') } : {}) })
  const row = coordinationRows(s, { page: 'missions' }).find(r => r.key === `coo-mission-${run.id}`)!
  const line = statementText(s).split('\n').find(l => l.includes('mission id'))!
  return { text: row.parts.map(p => p.text).join(' '), actions: JSON.stringify(row.actions ?? null), line }
}

test('auto arrêtée : « ⚡ Auto · discussion arrêtée », mêmes boutons qu’en auto', () => {
  const run = litRun()
  const stopped = seen(run, 'stopped')
  expect(stopped.text).toMatch(/⚡\sAuto · discussion arrêtée/)
  expect(stopped.actions).toBe(seen(run).actions)
})

test('auto arrêtée qui portait « repris : … » : « discussion arrêtée » à sa place', () => {
  const run: Run = { ...litRun(), auto: { onAt: T0 + 5, onBy: 'sb', onWhy: 'resumed', offAt: T0 + 2, offWhy: 'discussion fermée' } } as Run
  expect(seen(run).text).toMatch(/⚡\sAuto · repris : discussion relancée/)
  const stopped = seen(run, 'stopped')
  expect(stopped.text).toMatch(/⚡\sAuto · discussion arrêtée/)
  expect(stopped.text).not.toMatch(/repris/)
})

test('manuel sans pause écrite, arrêtée : « ✋ Manuel · discussion arrêtée », mêmes boutons qu’en manuel', () => {
  const run = runWith()
  expect(seen(run).text).toMatch(/✋\sManuel Boutique/)
  const stopped = seen(run, 'stopped')
  expect(stopped.text).toMatch(/✋\sManuel · discussion arrêtée/)
  expect(stopped.actions).toBe(seen(run).actions)
})

test('manuel avec une pause écrite : la ligne garde le libellé de sa pause', () => {
  const run = runWith({ auto: { onAt: T0, onBy: 'sb', offAt: T0 + 1, offWhy: 'quota' } } as Partial<Run>)
  const before = seen(run).text
  expect(before).toMatch(/✋\sManuel · /)
  expect(seen(run, 'stopped').text).toBe(before)
})

test('vivante et inconnu : ni la ligne ni le relevé ne changent', () => {
  for (const run of [litRun(), runWith()]) {
    const none = seen(run)
    for (const v of ['alive', 'unknown'] as const) {
      expect(seen(run, v)).toEqual(none)
    }
  }
})

test('le relevé dit, après le mode d’une mission arrêtée, que sa discussion ne tourne plus ; rien de plus pour les autres', () => {
  expect(seen(litRun(), 'stopped').line).toMatch(/mode auto, its discussion no longer runs \(its background session has no process\), tickets/)
  expect(seen(runWith(), 'stopped').line).toMatch(/mode manual, its discussion no longer runs/)
  expect(seen(litRun(), 'alive').line).not.toMatch(/no longer runs/)
  expect(seen(litRun()).line).not.toMatch(/no longer runs/)
})

// ─── La relecture du COO (`coo-liveness.ts`) ─────────────────────────────

const HOME = '/poste/.claude'
const OWNER = '5e1f0a2b-7c3d-4e8f-9a1b-2c3d4e5f6a7b'

/** Un faux `$` (seulement `$.fs`) : le job arrêté de la discussion OWNER, aucun fichier de session ; `fails` fait tout lever. */
const fakeOf = (o: { fails?: boolean; alive?: boolean } = {}) => {
  const files: Record<string, string> = {
    [`${HOME}/jobs/5e1f0a2b/state.json`]: JSON.stringify({ sessionId: OWNER, resumeSessionId: OWNER, state: 'done', updatedAt: new Date(T0 + 5_000).toISOString() }),
    ...(o.alive ? { [`${HOME}/sessions/42.json`]: JSON.stringify({ pid: 42, sessionId: OWNER }) } : {}),
  }
  const fail = async () => {
    throw new Error('EIO')
  }
  return {
    fs: {
      list: o.fails ? fail : async (path: string) => (path === `${HOME}/sessions` ? Object.keys(files).filter(p => p.startsWith(`${path}/`)).map(p => ({ name: p.slice(path.length + 1), kind: 'file', size: files[p]!.length, mtimeMs: 1, isLink: false })) : []),
      // Un dossier : le parent d'un fichier posé.
      stat: o.fails
        ? fail
        : async (path: string) =>
            files[path] !== undefined
              ? { kind: 'file', size: files[path]!.length, mtimeMs: 1, isLink: false }
              : Object.keys(files).some(p => p.startsWith(`${path}/`))
                ? { kind: 'dir', size: 0, mtimeMs: 1, isLink: false }
                : fail(),
      read: o.fails ? fail : async (path: string) => files[path] ?? fail(),
    },
  }
}

test('la relecture du COO : arrêtée, puis vivante à la relance ; une relecture qui échoue rend « inconnu » sans garder l’ancien verdict', async () => {
  const run = runWith({ owner: OWNER, claim: { boot: 'b1', at: T0 } })
  const board = boardOf(run)
  clearLiveness()
  expect(livenessOf(run.id)).toBe('unknown')
  expect(await refreshLiveness(fakeOf(), HOME, board, T0 + 10_000)).toBe(true)
  expect(livenessOf(run.id)).toBe('stopped')
  // Rien de changé : la vue ne se redessine pas.
  expect(await refreshLiveness(fakeOf(), HOME, board, T0 + 11_000)).toBe(false)
  // Relancée : son fichier de session paraît, le libellé disparaît à la relecture suivante.
  expect(await refreshLiveness(fakeOf({ alive: true }), HOME, board, T0 + 12_000)).toBe(true)
  expect(livenessOf(run.id)).toBe('alive')
  await refreshLiveness(fakeOf(), HOME, board, T0 + 13_000)
  expect(livenessOf(run.id)).toBe('stopped')
  // Une relecture qui échoue : « inconnu », l'ancien verdict n'est pas gardé.
  expect(await refreshLiveness(fakeOf({ fails: true }), HOME, board, T0 + 14_000)).toBe(true)
  expect(livenessOf(run.id)).toBe('unknown')
  // Sans dossier de Claude Code (`$.store`, hors de ~/.claude) : « inconnu ».
  await refreshLiveness(fakeOf(), null, board, T0 + 15_000)
  expect(livenessOf(run.id)).toBe('unknown')
})

test('la relecture du COO ne lit que les missions non archivées, actives, avec un titulaire ; « oublier » efface tout', async () => {
  const lone = runWith({ owner: undefined, claim: { boot: 'b1', at: T0 } })
  const paused = runWith({ owner: undefined, bornIn: OWNER, status: 'paused', claim: { boot: 'b1', at: T0 } })
  const archived = runWith({ owner: OWNER, archivedAt: T0 + 1, claim: { boot: 'b1', at: T0 } })
  const open = runWith({ owner: OWNER, claim: { boot: 'b1', at: T0 } })
  const board: Board = { ...emptyBoard('', 'p'), deleted: [], runs: [lone, paused, archived, open] }
  await refreshLiveness(fakeOf(), HOME, board, T0 + 10_000)
  expect([lone, paused, archived, open].map(r => livenessOf(r.id))).toEqual(['unknown', 'unknown', 'unknown', 'stopped'])
  expect(clearLiveness()).toBe(true)
  expect(livenessOf(open.id)).toBe('unknown')
  expect(clearLiveness()).toBe(false)
})
