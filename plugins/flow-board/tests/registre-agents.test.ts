import { expect, test } from 'claude-code/testing'

import { emptyRegistry, endCall, mergeRegistry, parseRegistry, reconcileAgents, reviewForkName, runningOf, spawnAgent, startCall, stopAgent } from '../hooks/registry.ts'

const call = (key: string, name = `Agent ${key}`) => ({ key, name, isBackground: true })

test('un appel Agent devient un sous-agent au travail, puis fini à son retour « completed »', () => {
  const r0 = emptyRegistry('s1', '/p', 1_000)
  const r1 = startCall(r0, { ...call('t1', 'Explorer le module'), model: 'haiku', subagentType: 'Explore', prompt: 'Cherche X' }, 2_000)!
  expect(runningOf(r1).map(a => a.name)).toEqual(['Explorer le module'])
  const r2 = endCall(r1, 't1', { agentId: 'a1', isFailed: false, isFinished: true }, 9_000)!
  expect(runningOf(r2)).toHaveLength(0)
  expect(r2.agents[0]).toMatchObject({ agentId: 'a1', status: 'done', startedAt: 2_000, finishedAt: 9_000, prompt: 'Cherche X', subagentType: 'Explore' })
})

test('un réveil (agent.spawn du même id) rouvre le sous-agent ; une fin pour un id inconnu est ignorée', () => {
  let r = startCall(emptyRegistry('s1', '/p', 0), call('t1', 'Relecteur du groupe'), 1_000)!
  r = spawnAgent(r, { agentId: 'a1', name: 'Relecteur du groupe', isBackground: true }, new Set(['t1']), 1_010)!
  r = endCall(r, 't1', { agentId: 'a1', isFailed: false, isFinished: false }, 1_050)!
  r = stopAgent(r, 'a1', 5_000)!
  expect(r.agents[0]).toMatchObject({ status: 'done', finishedAt: 5_000 })
  // La notification d'un de ses enfants le réveille : au travail de nouveau, sans nouvelle entrée.
  r = spawnAgent(r, { agentId: 'a1', isBackground: true }, new Set(), 6_000)!
  expect(r.agents).toHaveLength(1)
  expect(r.agents[0]).toMatchObject({ status: 'running', wakes: 1 })
  expect(r.agents[0]!.finishedAt).toBeUndefined()
  // Agents internes du moteur (titre, résumé de compaction) : aucun agent.spawn, rien ne change.
  expect(stopAgent(r, 'interne-9', 7_000)).toBeNull()
})

test('un agent lancé sans appel vu devient une entrée à lui, que le retour d’un appel fond avec la sienne', () => {
  let r = emptyRegistry('s1', '/p', 0)
  r = spawnAgent(r, { agentId: 'w1', name: 'Étape du workflow', isBackground: true, workflow: 'wf-1' }, new Set(), 1_000)!
  expect(r.agents[0]).toMatchObject({ key: 'agent:w1', agentId: 'w1', workflow: 'wf-1', status: 'running' })
  r = startCall(r, call('t2', 'Autre chose'), 2_000)!
  r = endCall(r, 't2', { agentId: 'w1', isFailed: false, isFinished: false }, 2_100)!
  expect(r.agents.filter(a => a.agentId === 'w1')).toHaveLength(1)
  expect(r.agents.find(a => a.agentId === 'w1')).toMatchObject({ key: 't2', workflow: 'wf-1', status: 'running' })
})

test('aucune limite de nombre : 50 sous-agents restent tous', () => {
  let r = emptyRegistry('s1', '/p', 0)
  for (let i = 0; i < 50; i++) r = endCall(startCall(r, call(`t${i}`), i)!, `t${i}`, { isFailed: false, isFinished: true }, i + 1)!
  expect(r.agents).toHaveLength(50)
})

test('S7 : la fusion garde les sous-agents des deux processus, et l’état le plus avancé de chacun', () => {
  const base = startCall(startCall(emptyRegistry('s1', '/p', 0), call('t1'), 1_000)!, call('t2'), 2_000)!
  // Ici, t1 vient de finir ; dans le fichier (l'autre processus), t2 a échoué et t3 est apparu.
  const local = endCall(base, 't1', { isFailed: false, isFinished: true }, 3_000)!
  const stored = startCall(endCall(base, 't2', { isFailed: true, isFinished: false }, 3_500)!, call('t3'), 4_000)!
  const merged = mergeRegistry(local, stored)
  expect(merged.agents.map(a => `${a.key}:${a.status}`)).toEqual(['t1:done', 't2:failed', 't3:running'])
  // Un réveil est plus avancé qu'une fin : une copie plus ancienne ne le défait pas.
  const woke = spawnAgent(endCall(local, 't2', { agentId: 'a2', isFailed: false, isFinished: true }, 5_000)!, { agentId: 'a2', isBackground: true }, new Set(), 6_000)!
  expect(mergeRegistry(woke, stored).agents.find(a => a.key === 't2')).toMatchObject({ status: 'running', wakes: 1 })
  // Rien à apporter : le registre d'ici est rendu tel quel.
  expect(mergeRegistry(local, local)).toBe(local)
  // L'entrée d'un agent.spawn qu'un appel a absorbée ici ne revient pas du fichier (et inversement).
  const spawned = spawnAgent(startCall(emptyRegistry('s1', '/p', 0), call('t9', 'X'), 1)!, { agentId: 'z9', name: 'Ailleurs', isBackground: true }, new Set(), 2)!
  const absorbed = endCall(spawnAgent(startCall(emptyRegistry('s1', '/p', 0), call('t9', 'X'), 1)!, { agentId: 'z9', name: 'Ailleurs', isBackground: true }, new Set(), 2)!, 't9', { agentId: 'z9', isFailed: false, isFinished: false }, 3)!
  expect(mergeRegistry(absorbed, spawned).agents.filter(a => a.agentId === 'z9').map(a => a.key)).toEqual(['t9'])
  expect(mergeRegistry(spawned, absorbed).agents.filter(a => a.agentId === 'z9').map(a => a.key)).toEqual(['t9'])
  // Le fichier d'une autre session ne se fusionne jamais.
  expect(mergeRegistry(local, { ...stored, session: 's2' })).toBe(local)
})

test('S8 : un fichier coupé ou étranger ne se lit pas', () => {
  const r = startCall(emptyRegistry('s1', '/p', 0), call('t1'), 1)!
  expect(parseRegistry(JSON.stringify(r))).toEqual(r)
  expect(parseRegistry(JSON.stringify(r).slice(0, 40))).toBeNull()
  expect(parseRegistry('{"v":1,"session":"s1"}')).toBeNull()
  expect(parseRegistry('')).toBeNull()
})

test('le rattrapage par la liste ne touche que les sous-agents de ce processus, hors appels en vol', () => {
  let r = emptyRegistry('s1', '/p', 0)
  for (const k of ['t1', 't2', 't3', 't4']) r = startCall(r, call(k), 1)!
  r = endCall(r, 't1', { agentId: 'a1', isFailed: false, isFinished: false }, 2)!
  const live = [{ id: 'a1', description: 'Agent t1', status: 'completed' }]
  const out = reconcileAgents(r, live, new Set(['t2']), new Set(['t1', 't2', 't3']), 9)!
  expect(out.agents.map(a => `${a.key}:${a.status}`)).toEqual(['t1:done', 't2:running', 't3:done', 't4:running'])
  expect(out.agents.find(a => a.key === 't3')?.isEndUnseen).toBe(true)
  // Une vraie fin arrivée ensuite donne son heure à une fin constatée.
  const real = stopAgent(endCall(out, 't3', { agentId: 'a3', isFailed: false, isFinished: false }, 10)!, 'a3', 12)!
  expect(real.agents.find(a => a.key === 't3')).toMatchObject({ status: 'done', finishedAt: 12 })
  expect(real.agents.find(a => a.key === 't3')?.isEndUnseen).toBeUndefined()
})

test('une exécution de /code-review prend un nom standard d’après sa cible ; un autre nom reste le sien', () => {
  const tagOf = (id: string) => (id === '1200000000000042' ? 'E2' : undefined)
  expect(reviewForkName('/code-review xhigh refs/worktree/flow-board/1200000000000042^..refs/worktree/flow-board/1200000000000042 consignes : /tmp/c.md', tagOf, 'E')).toBe('Passe bogues · E2')
  expect(reviewForkName('/code-review high refs/worktree/flow-board/120000…', tagOf)).toBe('Passe bogues')
  expect(reviewForkName('/code-review high --fix', tagOf, 'A')).toBe('Revue du groupe A')
  expect(reviewForkName('/code-review high dc096d8..HEAD consignes : /User…', tagOf)).toBe('Revue du groupe')
  expect(reviewForkName('/code-review high dc096d8a..ac00508f consignes : /tmp/c.md', tagOf)).toBe('Revue · dc096d8..ac00508')
  expect(reviewForkName('/code-review', tagOf)).toBe('Revue de code')
  expect(reviewForkName('Revue Standards+Spec E1', tagOf)).toBeNull()
  expect(reviewForkName('/code-reviewer', tagOf)).toBeNull()
})
