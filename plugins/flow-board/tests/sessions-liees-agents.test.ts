import { expect, test } from 'claude-code/testing'

import { isSureLink, linkedSessions, LINKED_STALE_MS } from '../hooks/linked.ts'
import { emptyRegistry, mergeRegistry, noteLaunch, parseRegistry, startCall } from '../hooks/registry.ts'
import type { Relay, SessionRegistry } from '../types'

const NOW = 50_000_000
const reg = (session: string, patch: Partial<SessionRegistry> = {}): SessionRegistry => ({ ...emptyRegistry(session, '/p', NOW - 1_000), ...patch })

test('avec un parcours, ses sessions liées se reconnaissent par leur fichier et par le relais, sûrement', () => {
  const self = reg('orch')
  const relay: Relay = {
    v: 1,
    run: 'r1',
    sessions: {
      'sess-a': { group: 'A', tickets: { '01': { status: 'done', at: NOW - 500 } }, commits: 1, startedAt: NOW - 9_000, at: NOW - 500, report: { text: 'fini', at: NOW - 400 } },
      'sess-c': { group: 'C', tickets: {}, commits: 0, startedAt: NOW - 9_000, at: NOW - 900 },
    },
  }
  const others = [reg('sess-a', { run: 'r1', group: 'A', title: 'Boutique › Groupe A · Synchro' }), reg('sess-b', { run: 'r1', group: 'B' }), reg('autre', { run: 'r2' })]
  const linked = linkedSessions({ self, run: 'r1', relay, others, now: NOW })
  expect(linked.map(l => [l.key, l.how, l.state])).toEqual([
    ['sess-a', 'run', 'returned'],
    ['sess-c', 'relay', 'working'],
    ['sess-b', 'run', 'working'],
  ])
  // Sans lancement relevé ici, le départ est le premier signal du relais.
  expect(linked[0]!.launchedAt).toBe(NOW - 9_000)
  expect(linked[0]!.title).toBe('Groupe A · Synchro')
  expect(linked[0]!.returnedAt).toBe(NOW - 400)
  expect(linked.every(l => isSureLink(l.how))).toBe(true)
})

test('sans parcours, une session de claude --bg se reconnaît par son id court ou son job, une session du desktop par son titre en repli', () => {
  const self = reg('orch', {
    linked: [
      { id: '9f3e21aa', title: 'Explorer le cache', at: NOW - 8_000, via: 'bg' },
      { id: '77aa0000', title: 'Par le job', at: NOW - 7_000, via: 'bg' },
      { id: 'local_0d4e', title: 'Pistes de rétro', at: NOW - 6_000, via: 'desktop' },
      { id: 'local_ffff', title: 'Jamais vue', at: NOW - 5_000, via: 'desktop' },
    ],
  })
  const others = [
    reg('9f3e21aa-1111-2222-3333-444455556666', { title: 'Explorer le cache' }),
    reg('b0b0b0b0-0000', { title: 'Autre nom' }),
    reg('c1c1c1c1-0000', { title: 'Pistes de rétro' }),
  ]
  const jobs = { '77aa0000': { sessionId: 'b0b0b0b0-0000', name: 'Par le job', state: 'done', updatedAt: NOW - 100 } }
  const linked = linkedSessions({ self, others, jobs, now: NOW })
  // La clé reste l'id du lancement (la sélection de la pastille y tient) ; le fichier trouvé est dans `session`.
  expect(linked.map(l => [l.key, l.session, l.how, l.state])).toEqual([
    ['9f3e21aa', '9f3e21aa-1111-2222-3333-444455556666', 'id', 'working'],
    ['77aa0000', 'b0b0b0b0-0000', 'job', 'closed'],
    ['local_0d4e', 'c1c1c1c1-0000', 'title', 'working'],
    ['local_ffff', undefined, 'none', 'working'],
  ])
  // Reconnue par son titre seul : montrée, jamais effacée avec l'orchestrateur (S15).
  expect(isSureLink('title')).toBe(false)
  expect(linked[3]!.session).toBeUndefined()
})

test('l’état d’une session liée : échouée si elle finit avec un ticket ouvert ou si son job échoue, fermée sans signe de vie', () => {
  const self = reg('orch', { linked: [{ id: 'aaaa1111', title: 'En échec', at: NOW - 9_000, via: 'bg' }] })
  const relay: Relay = {
    v: 1,
    run: 'r1',
    sessions: { 'sess-x': { group: 'X', tickets: { '02': { status: 'doing', at: NOW - 9_000 } }, commits: 0, startedAt: NOW - 9_000, at: NOW - 8_000, endedAt: NOW - 7_000 } },
  }
  const quiet = startCall(reg('sess-q', { run: 'r1', updatedAt: NOW - LINKED_STALE_MS - 1 }), { key: 'k', name: 'fini', isBackground: true }, NOW - LINKED_STALE_MS - 5)!
  const done = { ...quiet, updatedAt: NOW - LINKED_STALE_MS - 1, agents: quiet.agents.map(a => ({ ...a, status: 'done' as const })) }
  const linked = linkedSessions({ self, run: 'r1', relay, others: [done], jobs: { aaaa1111: { state: 'failed', updatedAt: NOW - 50 } }, now: NOW })
  const byKey = Object.fromEntries(linked.map(l => [l.key, l.state]))
  expect(byKey).toEqual({ 'sess-q': 'closed', 'sess-x': 'failed', aaaa1111: 'failed' })
})

test('fusion des fichiers d’une même session (S7) : les lancements des deux processus se gardent tous, sans doublon', () => {
  const here = noteLaunch(reg('orch'), { id: '11112222', title: 'Ici', at: NOW - 3_000, via: 'bg' }, NOW - 3_000)!
  const there = noteLaunch(noteLaunch(reg('orch'), { id: 'local_ab', title: 'Ailleurs', at: NOW - 5_000, via: 'desktop' }, NOW - 5_000)!, { id: '11112222', title: 'Ici', at: NOW - 3_000, via: 'bg' }, NOW - 3_000)!
  const merged = mergeRegistry(here, there)
  expect(merged.linked!.map(l => l.id)).toEqual(['local_ab', '11112222'])
  // Relu du disque, un lancement abîmé est ignoré (F3), les autres restent.
  const text = JSON.stringify({ ...merged, linked: [...merged.linked!, { id: 42, at: 'hier' }] })
  expect(parseRegistry(text)!.linked!.map(l => l.id)).toEqual(['local_ab', '11112222'])
  // Un lancement déjà connu ne change rien.
  expect(noteLaunch(merged, { id: 'local_ab', at: NOW, via: 'desktop' }, NOW)).toBeNull()
})

test('le relais se lit par l’id de session du job, le lancement donne l’heure et le titre, un job bloqué reste au travail', () => {
  const self = reg('orch', {
    linked: [
      { id: '11112222', title: 'Lot › Groupe A · Synchro', at: NOW - 9_000, via: 'bg' },
      { id: '33334444', title: 'Bloquée', at: NOW - LINKED_STALE_MS - 9_000, via: 'bg' },
    ],
  })
  const relay: Relay = { v: 1, run: 'r1', sessions: { 'uuid-a': { group: 'A', tickets: {}, commits: 0, startedAt: NOW - 5_000, at: NOW - 400, report: { text: 'fini', at: NOW - 300 } } } }
  const jobs = { '11112222': { sessionId: 'uuid-a', state: 'working' }, '33334444': { sessionId: 'uuid-b', state: 'blocked', updatedAt: NOW - LINKED_STALE_MS - 9_000 } }
  const linked = linkedSessions({ self, run: 'r1', relay, others: [], jobs, now: NOW })
  expect(linked.map(l => [l.key, l.state, l.launchedAt, l.title])).toEqual([
    ['33334444', 'working', NOW - LINKED_STALE_MS - 9_000, 'Bloquée'],
    ['11112222', 'returned', NOW - 9_000, 'Groupe A · Synchro'],
  ])
})

test('un lancement du desktop que le parcours connaît déjà par son groupe ne fait pas une seconde pastille', () => {
  const self = reg('orch', { linked: [{ id: 'local_9z', title: 'Lot › Groupe B · Export', at: NOW - 9_000, via: 'desktop' }] })
  const others = [reg('uuid-b', { run: 'r1', group: 'B', title: 'Lot' })]
  const linked = linkedSessions({ self, run: 'r1', others, now: NOW })
  expect(linked.map(l => [l.key, l.session, l.how, l.title])).toEqual([['local_9z', 'uuid-b', 'run', 'Groupe B · Export']])
})

test('S15 et S17 : un id trop court ne reconnaît rien sûrement ; le titre seul ne vaut que dans le projet ou ses worktrees', () => {
  const self = reg('orch', {
    root: '/p',
    linked: [
      { id: 'local_ab', title: 'Inconnu', at: NOW - 3_000, via: 'desktop' },
      { id: 'local_cd', title: 'Pistes de rétro', at: NOW - 2_000, via: 'desktop' },
      { id: 'local_ef', title: 'Revue du worktree', at: NOW - 1_000, via: 'desktop' },
    ],
  })
  const others = [
    reg('ab12-0000', { title: 'Autre chose' }),
    { ...reg('c1-0000', { title: 'Pistes de rétro' }), root: '/autre-projet' },
    { ...reg('e1-0000', { title: 'Revue du worktree' }), root: '/p/.claude/worktrees/x' },
  ]
  const linked = linkedSessions({ self, others, now: NOW })
  expect(linked.map(l => [l.key, l.session, l.how])).toEqual([
    ['local_ab', undefined, 'none'],
    ['local_cd', undefined, 'none'],
    ['local_ef', 'e1-0000', 'title'],
  ])
})
