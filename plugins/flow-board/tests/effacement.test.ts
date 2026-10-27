import { expect, test } from 'claude-code/testing'

import { agentTraces, applyTraces, applyTracesToRebuilt, cleanTrace, CLOSED_MS, eraseWith, forgetCount, forgetText, isClosedSession, removeArgv } from '../hooks/erase.ts'
import { emptyRegistry, noteLaunch, startCall } from '../hooks/registry.ts'
import type { SessionRegistry } from '../types'

const at = (reg: SessionRegistry, key: string, name: string, startedAt: number, run?: string) => startCall(reg, { key, name, isBackground: true, ...(run ? { run } : {}) }, startedAt)!

test('S5 : une trace de session couvre tout ce qui précède sa date ; ce qui vient après reste', () => {
  let reg = at(at(emptyRegistry('s1', '/p', 0), 'k1', 'Avant', 1_000), 'k2', 'Après', 5_000)
  reg = { ...noteLaunch(reg, { id: 'aaaa1111', at: 1_500, via: 'bg' }, 1_500)!, main: { segments: [{ k: 'think', s: 900, e: 1_000 }, { k: 'write', s: 5_100, e: 5_200 }], marks: [{ k: 'commit', at: 950 }] } }
  const next = applyTraces(reg, [{ id: 's1', at: 3_000 }])!
  expect(next.agents.map(a => a.name)).toEqual(['Après'])
  expect(next.main!.segments).toEqual([{ k: 'write', s: 5_100, e: 5_200 }])
  expect(next.main!.marks).toEqual([])
  expect(next.linked).toBeUndefined()
  // Rien de couvert : rien ne change.
  expect(applyTraces(next, [{ id: 's1', at: 3_000 }])).toBeNull()
  expect(applyTraces(next, [{ id: 'autre', at: 9_000 }])).toBeNull()
})

test('Q6 a1 : la trace d’un parcours retire ses sous-agents, et toute la session liée qui le servait', () => {
  const orch = at(at(emptyRegistry('orch', '/p', 0), 'k1', 'Du parcours', 1_000, 'r1'), 'k2', 'Hors parcours', 2_000)
  expect(applyTraces(orch, [{ id: 'run:r1', at: 9_000 }])!.agents.map(a => a.name)).toEqual(['Hors parcours'])
  const linked = { ...at(emptyRegistry('fille', '/p', 0), 'k3', 'De la fille', 1_500), run: 'r1', main: { segments: [{ k: 'think' as const, s: 1_400, e: 1_450 }] } }
  const cleared = applyTraces(linked, [{ id: 'run:r1', at: 9_000 }])!
  expect(cleared.agents).toEqual([])
  expect(cleared.main!.segments).toEqual([])
})

test('S5 : un fichier à part (rattrapage, reprise, lignes recopiées) respecte les traces', () => {
  const lane = { toolCount: 0, startedAt: 1_000, segments: [] }
  const rebuilt = { v: 1 as const, session: 's1', agents: [{ agentId: 'a1', lane, meta: {} }, { agentId: 'a2', lane: { ...lane, startedAt: 8_000 }, meta: {} }, { agentId: 'a3', lane, meta: {}, run: 'r1' }] }
  expect(applyTracesToRebuilt(rebuilt, [{ id: 's1', at: 5_000 }])!.agents.map(a => a.agentId)).toEqual(['a2'])
  expect(applyTracesToRebuilt(rebuilt, [{ id: 'run:r1', at: 5_000 }])!.agents.map(a => a.agentId)).toEqual(['a1', 'a2'])
  const runFile = { v: 1 as const, session: 'run:r1', agents: [], rows: [{ key: 'k', name: 'Ligne', isBackground: true, status: 'done' as const, startedAt: 1_000, source: 'live' as const, run: 'r1' }] }
  expect(applyTracesToRebuilt(runFile, [{ id: 'run:r1', at: 5_000 }])!.rows).toEqual([])
})

test('S19 : une session est fermée sans écriture depuis 30 min et sans sous-agent au travail, ou quand sa fin est connue', () => {
  const idle = emptyRegistry('s1', '/p', 0)
  const busy = at(idle, 'k', 'Au travail', 0)
  expect(isClosedSession(idle, 0, CLOSED_MS + 1)).toBe(true)
  expect(isClosedSession(idle, 0, CLOSED_MS - 1)).toBe(false)
  expect(isClosedSession(busy, 0, CLOSED_MS + 1)).toBe(false)
  expect(isClosedSession(busy, 0, 10, true)).toBe(true)
})

test('S2 et S15 : la confirmation d’« Oublier » dit combien de sessions et de sous-agents elle efface, et ce qu’elle laisse', () => {
  const self = at(at(emptyRegistry('d', '/p', 0), 'k1', 'Un', 1), 'k2', 'Deux', 2)
  const linked = at(emptyRegistry('l', '/p', 0), 'k3', 'Trois', 3)
  const n = forgetCount(self, [linked, null], 1)
  expect(n).toEqual({ sessions: 3, agents: 3, byTitle: 1 })
  expect(forgetText(n)).toBe('Oublier cette discussion ? 3\u00A0sessions et 3\u00A0sous-agents seront effacés définitivement. 1\u00A0session liée reconnue par le titre seul n’est pas comprise.')
  expect(forgetText({ sessions: 1, agents: 0, byTitle: 0 })).toBe('Oublier cette discussion ? 1\u00A0session et 0\u00A0sous-agent seront effacés définitivement.')
})

test('S4 : la suppression passe par une commande système sans shell, le chemin en dernier ; une trace ne garde que l’id et la date', () => {
  expect(removeArgv('/Users/x/.claude/flow-board/agents/s1.json')).toEqual(['rm', '-f', '--', '/Users/x/.claude/flow-board/agents/s1.json'])
  expect(removeArgv('C:/Users/x/.claude/flow-board/agents/s1.json')).toEqual(['cmd.exe', '/d', '/c', 'del', '/f', '/q', 'C:\\Users\\x\\.claude\\flow-board\\agents\\s1.json'])
  expect(cleanTrace({ id: 's1', at: 5, prompt: 'rien' })).toEqual({ id: 's1', at: 5 })
  expect(cleanTrace({ id: '', at: 5 })).toBeNull()
})

test('S4 : effacer un fichier, c’est le réécrire vide puis le supprimer ; si la commande échoue ou manque, le fichier vide reste', async () => {
  const disk: Record<string, string> = { '/a/s1.json': '{"données":1}' }
  const steps: string[] = []
  const io = (isOk: boolean | 'none') => ({
    write: async (path: string, text: string) => {
      steps.push(`write ${path} ${JSON.stringify(text)}`)
      disk[path] = text
    },
    ...(isOk === 'none'
      ? {}
      : {
          remove: async (path: string) => {
            steps.push(`rm ${path}`)
            if (isOk) delete disk[path]
            return isOk
          },
        }),
  })
  expect(await eraseWith(io(true), '/a/s1.json')).toEqual({ isEmptied: true, isRemoved: true })
  expect(steps).toEqual(['write /a/s1.json ""', 'rm /a/s1.json'])
  expect('/a/s1.json' in disk).toBe(false)
  disk['/a/s2.json'] = '{"données":2}'
  expect(await eraseWith(io(false), '/a/s2.json')).toEqual({ isEmptied: true, isRemoved: false })
  expect(disk['/a/s2.json']).toBe('')
  disk['/a/s3.json'] = '{"données":3}'
  expect(await eraseWith(io('none'), '/a/s3.json')).toEqual({ isEmptied: true, isRemoved: false })
  expect(disk['/a/s3.json']).toBe('')
})

test('S22 : un sous-agent effacé avec son parcours a sa trace à lui, que le rattrapage respecte même sans parcours connu', () => {
  const traces = agentTraces({ key: 'call-1', agentId: 'a1' }, 9_000)
  expect(traces).toEqual([{ id: 'call:call-1', at: 9_000 }, { id: 'agent:a1', at: 9_000 }])
  // Revenu du transcript sans parcours (le rattrapage ne le sait pas) : il reste effacé.
  const back = { ...at(emptyRegistry('orch', '/p', 0), 'call-1', 'Revenu', 1_000), agents: [] as SessionRegistry['agents'] }
  const reg = { ...back, agents: [{ key: 'call-1', agentId: 'a1', name: 'Revenu', isBackground: true, status: 'done' as const, startedAt: 1_000, source: 'transcript' as const }, { key: 'call-2', name: 'Autre', isBackground: true, status: 'done' as const, startedAt: 1_000, source: 'live' as const }] }
  expect(applyTraces(reg, traces)!.agents.map(a => a.key)).toEqual(['call-2'])
  const rebuilt = { v: 1 as const, session: 'orch', agents: [{ agentId: 'a1', lane: { toolCount: 0, startedAt: 1_000 }, meta: {} }] }
  expect(applyTracesToRebuilt(rebuilt, traces)!.agents).toEqual([])
})
