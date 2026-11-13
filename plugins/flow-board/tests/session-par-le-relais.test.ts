import { expect, mock, test } from 'claude-code/testing'
import { memoryDisk } from './disque-memoire.ts'

import { applyReport, backgroundLaunchCount, backgroundLaunches, closingText, emptyBoard, isBackgroundLaunch, mergeBoards, newRun, relayedReportAt, startLinkedGroups } from '../hooks/model.ts'
import { cancelLinkedGroup, isAwaitingSession, keepSessions, linkGroupSession, linkRelaySessions, relayShortId, unnotedLaunchNotice } from '../hooks/link.ts'
import { applyRelay } from '../hooks/relay.ts'
import { closedHint, closingProcedure, closingScript } from '../hooks/closing.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board, Relay, Run } from '../types'

// La session d'un envoi de groupe est notée même quand la sortie de son lancement n'est pas lue
// (`claude --bg … 2>&1 | tail -2` avait retiré la ligne « backgrounded »). Invariant de la session notée :
// l'id de session d'un envoi de groupe ne vient que de la sortie de son lancement ou de l'entrée de relais
// déposée par la session de ce même groupe pendant ce même envoi ; une fois noté, il ne change plus ; un id hors
// forme, ou plus d'une session candidate pour un même envoi, ne sont jamais notés, et la fermeture garde alors la
// session (ni `claude stop` ni `claude rm`).

const TOOL = 'mcp__flow-board__flow'
const PLUGIN = 'flow-board'
const KEY = 'board:'
const T0 = 80_000_000

// Les ids complets que le relais donne (le sessionId, un UUID) : `claude --bg` affiche ses 8 premiers signes.
const UUID_A = '9f3e21aa-0416-4d88-8317-cc583d9f0d47'
const UUID_B = '4c9ac344-1111-4d88-8317-cc583d9f0d47'
const UUID_C = '60481870-2222-4d88-8317-cc583d9f0d47'
const UUID_D = '178bd61c-3333-4d88-8317-cc583d9f0d47'

const PLAN = {
  tickets: [
    { id: 'a1', name: 'Séparer la synchro' },
    { id: 'b1', name: 'Export des retours' },
    { id: 'c1', name: 'Statut de commande' },
    { id: 'd1', name: 'Délai de livraison' },
  ],
  groups: [
    { id: 'A', name: 'Synchro', tickets: ['a1'] },
    { id: 'B', name: 'Règles', tickets: ['b1'] },
    { id: 'C', name: 'Statut', tickets: ['c1'] },
    { id: 'D', name: 'Commandes', tickets: ['d1'] },
  ],
}

/** Une mission à quatre groupes, envoyés à `sentAt`. */
const sent = (sentAt = 3_000, ids = ['A', 'B', 'C', 'D']): Board => {
  const run = { ...newRun('implement', 1_000, 'Boutique'), owner: 's' }
  const board: Board = applyReport({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }, PLAN, 2_000).board
  return startLinkedGroups(board, ids, sentAt)!.board
}

/** Le relais tel que le manager le lit après l'appel `delegate` de chaque worker (`group`, puis son compte rendu). */
const relayOf = (board: Board, workers: readonly { session: string; group?: string; at: number; report?: boolean }[]): Relay => {
  const runId = activeRun(board)!.id
  let relay: unknown = null
  for (const w of workers) {
    relay = applyRelay(relay, runId, w.session, { kind: 'start', ...(w.group !== undefined ? { group: w.group } : {}) }, w.at) ?? relay
    if (w.report) relay = applyRelay(relay, runId, w.session, { kind: 'report', text: `Compte rendu ${w.group}`, isWhole: true }, w.at + 10) ?? relay
  }
  return relay as Relay
}

const linkOf = (board: Board, id: string) => activeRun(board)!.groups!.find(g => g.id === id)!.linked
const logText = (board: Board) => JSON.stringify(activeRun(board)!.log ?? [])

test('l’id court d’une session vient de son id complet, seulement en forme (corpus hostile : corpus-hostile.test.ts)', () => {
  expect(relayShortId(UUID_A)).toBe('9f3e21aa')
  // Pas un UUID en minuscules : hors forme, rien.
  for (const bad of ['9f3e21aa', 'local_ab12', UUID_A.toUpperCase(), `${UUID_A}\n`, ` ${UUID_A}`, `${UUID_A}x`, '9f3e21aa-0416-4d88-8317', 42, null, undefined, {}]) expect(relayShortId(bad)).toBeNull()
})

test('un envoi sans session reçoit l’id court de la seule session que son appel delegate a déclarée pendant cet envoi', () => {
  const board = sent()
  const relay = relayOf(board, [{ session: UUID_A, group: 'A', at: 4_000 }])
  const out = linkRelaySessions(board, relay, 5_000)!
  expect(linkOf(out.board, 'A')?.session).toBe('9f3e21aa')
  // Les autres envois n'ont personne : rien pour eux.
  expect(linkOf(out.board, 'B')?.session).toBeUndefined()
  expect(logText(out.board)).toMatch(/groupe A.*relais/)
  // Déjà noté : plus rien à faire.
  expect(linkRelaySessions(out.board, relay, 6_000)).toBeNull()
})

test('seule une entrée déclarée pour ce groupe, pendant cet envoi, compte', () => {
  const board = sent(3_000)
  // Avant l'envoi (une session d'un envoi précédent), un autre groupe, aucun groupe déclaré : rien.
  const relay = relayOf(board, [
    { session: UUID_A, group: 'A', at: 2_500 },
    { session: UUID_B, group: 'Z', at: 4_000 },
    { session: UUID_C, at: 4_000 },
  ])
  expect(linkRelaySessions(board, relay, 5_000)).toBeNull()
  // « Groupe B », « B · Règles » nomment B, comme pour le reste du relais.
  const named = linkRelaySessions(board, relayOf(board, [{ session: UUID_B, group: 'Groupe B', at: 4_000 }]), 5_000)!
  expect(linkOf(named.board, 'B')?.session).toBe('4c9ac344')
  // Le relais d'une autre mission : rien.
  expect(linkRelaySessions(board, { ...relayOf(board, [{ session: UUID_A, group: 'A', at: 4_000 }]), run: 'autre' }, 5_000)).toBeNull()
})

test('deux sessions candidates, ou un id hors forme : rien n’est noté, l’envoi est marqué et le journal le dit, une fois', () => {
  const board = sent()
  const twice = linkRelaySessions(board, relayOf(board, [{ session: UUID_A, group: 'A', at: 4_000 }, { session: UUID_B, group: 'A', at: 4_100 }]), 5_000)!
  expect(linkOf(twice.board, 'A')?.session).toBeUndefined()
  expect(linkOf(twice.board, 'A')?.sessionClash).toBe(true)
  expect(logText(twice.board)).toMatch(/groupe A.*2 sessions/)
  // Marqué : plus rien, même quand le relais ne change pas (pas une ligne de journal par relecture).
  expect(linkRelaySessions(twice.board, relayOf(board, [{ session: UUID_A, group: 'A', at: 4_000 }]), 6_000)).toBeNull()

  const odd = linkRelaySessions(board, relayOf(board, [{ session: 'session-hors-forme', group: 'B', at: 4_000 }]), 5_000)!
  expect(linkOf(odd.board, 'B')?.session).toBeUndefined()
  expect(linkOf(odd.board, 'B')?.sessionClash).toBe(true)
  // L'id hors forme n'est jamais recopié, pas même dans le journal.
  expect(logText(odd.board)).not.toContain('session-hors-forme')
  expect(logText(odd.board)).toMatch(/groupe B.*hors forme/)
})

test('une session déjà notée pour un autre envoi n’est pas notée une deuxième fois', () => {
  const board = linkGroupSession(sent(), 'Boutique > Groupe A · Synchro', '9f3e21aa', 3_500)!.board
  // La même session (même id court) se déclare ensuite pour B.
  const out = linkRelaySessions(board, relayOf(board, [{ session: UUID_A, group: 'B', at: 4_000 }]), 5_000)!
  expect(linkOf(out.board, 'B')?.session).toBeUndefined()
  expect(linkOf(out.board, 'B')?.sessionClash).toBe(true)
  expect(linkOf(out.board, 'A')?.session).toBe('9f3e21aa')
})

test('un id noté ne change plus : ni par le relais, ni par un lancement suivant', () => {
  const board = linkGroupSession(sent(), 'Boutique > Groupe A · Synchro', 'aaaaaaaa', 3_500)!.board
  // Le relais montre une autre session pour A : l'id noté reste (l'envoi est marqué : plus d'une candidate).
  const other = linkRelaySessions(board, relayOf(board, [{ session: UUID_A, group: 'A', at: 4_000 }]), 5_000)!.board
  expect(linkOf(other, 'A')?.session).toBe('aaaaaaaa')
  expect(linkOf(other, 'A')?.sessionClash).toBe(true)
  // Noté par le relais, puis une ligne « backgrounded » relue plus tard : rien ne change.
  const fresh = sent()
  const viaRelay = linkRelaySessions(fresh, relayOf(fresh, [{ session: UUID_B, group: 'B', at: 4_000 }]), 5_000)!.board
  const late = linkGroupSession(viaRelay, 'Boutique > Groupe B · Règles', 'bbbbbbbb', 6_000)
  expect(late === null ? linkOf(viaRelay, 'B')?.session : linkOf(late.board, 'B')?.session).toBe('4c9ac344')
})

test('la fusion garde l’id noté, le reprend de l’autre copie s’il manque, et marque deux ids différents', () => {
  const base = sent()
  const noted = linkGroupSession(base, 'Boutique > Groupe A · Synchro', '9f3e21aa', 3_500)!.board
  const runNoted = activeRun(noted)!
  const runBare = activeRun(base)!
  // La copie gardée n'a pas l'id : il vient de l'autre (même envoi : même `at`).
  expect(keepSessions(runBare, runNoted).groups!.find(g => g.id === 'A')!.linked?.session).toBe('9f3e21aa')
  // La copie gardée l'a : il reste.
  expect(keepSessions(runNoted, runBare).groups!.find(g => g.id === 'A')!.linked?.session).toBe('9f3e21aa')
  // Deux ids différents pour le même envoi : l'id gardé reste, l'envoi est marqué (la fermeture garde la session).
  const other = activeRun(linkGroupSession(base, 'Boutique > Groupe A · Synchro', 'bbbbbbbb', 3_500)!.board)!
  const clash = keepSessions(runNoted, other).groups!.find(g => g.id === 'A')!.linked
  expect(clash?.session).toBe('9f3e21aa')
  expect(clash?.sessionClash).toBe(true)
  // Un id hors forme de l'autre copie n'est jamais repris : l'envoi est marqué.
  const odd: Run = { ...runNoted, groups: runNoted.groups!.map(g => (g.id === 'A' ? { ...g, linked: { ...g.linked!, session: 'x y' } } : g)) }
  const fromOdd = keepSessions(runBare, odd).groups!.find(g => g.id === 'A')!.linked
  expect(fromOdd?.session).toBeUndefined()
  expect(fromOdd?.sessionClash).toBe(true)
  // Une marque de l'une des copies reste.
  const marked: Run = { ...runBare, groups: runBare.groups!.map(g => (g.id === 'B' ? { ...g, linked: { ...g.linked!, sessionClash: true as const } } : g)) }
  expect(keepSessions(runBare, marked).groups!.find(g => g.id === 'B')!.linked?.sessionClash).toBe(true)
  // Par la fusion complète des deux tableaux de bord.
  const merged = mergeBoards({ ...base, runs: [{ ...runBare, updatedAt: 9_000 }] }, { ...noted, runs: [{ ...runNoted, updatedAt: 8_000 }] })
  expect(activeRun(merged)?.groups?.find(g => g.id === 'A')?.linked?.session).toBe('9f3e21aa')
})

/** Une mission dont l'envoi de A a deux sessions candidates au relais : marqué. */
const clashed = (): Board => {
  const base = sent()
  return linkRelaySessions(base, relayOf(base, [{ session: UUID_A, group: 'A', at: 4_000 }, { session: UUID_B, group: 'A', at: 4_100 }]), 5_000)!.board
}

test('un envoi marqué : la fermeture ne ferme rien, ni claude stop ni claude rm', () => {
  const board = clashed()
  const run = activeRun(board)!
  const link = run.groups!.find(g => g.id === 'A')!.linked!
  for (const isRepo of [true, false]) {
    const text = closingProcedure({ run, target: { kind: 'group', id: 'A', name: 'Synchro' }, isRepo, hasReport: true, send: link })
    expect(text).toMatch(/^Ne ferme pas/)
    // Aucune commande : ni l'arrêt, ni l'effacement, ni le script de vérification avec un id.
    expect(text).not.toMatch(/claude (stop|rm) '|--session|fermeture\.mjs/)
  }
  // Ce qui entoure la procédure le dit aussi : seul « stopped » se rapporte, et « closed » est refusé.
  expect(closedHint({ kind: 'group', id: 'A', name: 'Synchro' }, undefined, link)).toMatch(/"state": "stopped", "why": "id de session non noté sûrement/)
  let back = applyReport(board, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 6_000).board
  back = applyReport(back, { security: { group: 'A', advised: false, why: 'rien qui franchit la limite du compte' } }, 6_100).board
  const returned = activeRun(back)!
  const closing = closingText(returned, null, true)
  expect(closing).toMatch(/Do not close: Ne ferme pas le worker de l’envoi 1 du groupe A/)
  expect(closing).not.toMatch(/Close now: group A|"state": "closed"/)
  const refused = applyReport(back, { closed: [{ group: 'A', state: 'closed' }] }, 7_000)
  expect(refused.text).toMatch(/its session id could not be noted surely/)
  expect(activeRun(refused.board)!.groups!.find(g => g.id === 'A')!.delegated?.closing?.state).not.toBe('closed')
})

test('deux sessions aux mêmes 8 premiers signes sont deux candidates : rien n’est noté', () => {
  const board = sent()
  const twins = linkRelaySessions(board, relayOf(board, [{ session: UUID_A, group: 'A', at: 4_000 }, { session: '9f3e21aa-ffff-4d88-8317-cc583d9f0d47', group: 'A', at: 4_100 }]), 5_000)!
  expect(linkOf(twins.board, 'A')?.session).toBeUndefined()
  expect(linkOf(twins.board, 'A')?.sessionClash).toBe(true)
})

test('le marquage d’un envoi suit le lien au retour du groupe et dans les envois précédents', () => {
  const board = clashed()
  // Rendu avec son ticket encore ouvert : le groupe peut repartir.
  const back = applyReport(board, { returned: ['A'] }, 6_000).board
  expect(activeRun(back)!.groups!.find(g => g.id === 'A')!.delegated?.sessionClash).toBe(true)
  // Renvoyé, puis rendu : l'envoi précédent garde sa marque dans `earlier`, le nouvel envoi n'en a pas.
  const again = startLinkedGroups(back, ['A'], 7_000)
  expect(again).not.toBeNull()
  expect(linkOf(again!.board, 'A')?.sessionClash).toBeUndefined()
  const back2 = applyReport(again!.board, { returned: ['A'] }, 8_000).board
  const earlier = activeRun(back2)!.groups!.find(g => g.id === 'A')!.delegated?.earlier ?? []
  expect(earlier.some(e => e.at === 3_000 && e.sessionClash === true)).toBe(true)
})

test('une session déjà notée : une autre candidate qui se déclare ensuite marque l’envoi, sans changer l’id', () => {
  const base = sent()
  const noted = linkRelaySessions(base, relayOf(base, [{ session: UUID_A, group: 'A', at: 4_000 }]), 5_000)!.board
  expect(linkOf(noted, 'A')?.session).toBe('9f3e21aa')
  // La même session seule, relue : rien.
  expect(linkRelaySessions(noted, relayOf(base, [{ session: UUID_A, group: 'A', at: 4_000 }]), 5_500)).toBeNull()
  const late = linkRelaySessions(noted, relayOf(base, [{ session: UUID_A, group: 'A', at: 4_000 }, { session: UUID_B, group: 'A', at: 4_500 }]), 6_000)!.board
  expect(linkOf(late, 'A')?.session).toBe('9f3e21aa')
  expect(linkOf(late, 'A')?.sessionClash).toBe(true)
  // Noté par la ligne « backgrounded » (un id court de 6 signes ou plus) : sa propre entrée de relais n'est pas une autre candidate.
  const bg = linkGroupSession(base, 'Boutique > Groupe A · Synchro', '9f3e21', 3_500)!.board
  expect(linkRelaySessions(bg, relayOf(base, [{ session: UUID_A, group: 'A', at: 4_000 }]), 5_000)).toBeNull()
  // Une session de l'app (local_…) ne se compare pas à son entrée de relais : jamais marquée par elle.
  const app = linkGroupSession(base, 'Boutique > Groupe A · Synchro', 'local_A42', 3_500)!.board
  expect(linkRelaySessions(app, relayOf(base, [{ session: UUID_A, group: 'A', at: 4_000 }]), 5_000)).toBeNull()
})

test('une session notée par la ligne « backgrounded », puis deux entrées de relais à ses 8 premiers signes : l’envoi est marqué', () => {
  const base = sent()
  const bg = linkGroupSession(base, 'Boutique > Groupe A · Synchro', '9f3e21aa', 3_500)!.board
  // Sa seule entrée : rien.
  expect(linkRelaySessions(bg, relayOf(base, [{ session: UUID_A, group: 'A', at: 4_000 }]), 5_000)).toBeNull()
  // Deux sessions (deux ids complets) qui commencent comme l'id noté : plus d'une candidate.
  const two = linkRelaySessions(bg, relayOf(base, [{ session: UUID_A, group: 'A', at: 4_000 }, { session: '9f3e21aa-ffff-4d88-8317-cc583d9f0d47', group: 'A', at: 4_100 }]), 5_000)!.board
  expect(linkOf(two, 'A')?.session).toBe('9f3e21aa')
  expect(linkOf(two, 'A')?.sessionClash).toBe(true)
})

test('un seul prédicat « en attente de session » : un envoi marqué n’y est pas, ni à lancer ni à renvoyer', () => {
  const board = clashed()
  expect(isAwaitingSession(linkOf(board, 'A'))).toBe(false)
  expect(isAwaitingSession(linkOf(board, 'B'))).toBe(true)
  expect(isAwaitingSession(undefined)).toBe(false)
})

test('la fermeture refusée d’un envoi marqué : l’appel « stopped » qu’elle dicte se note, rejoué contre le modèle', () => {
  let back = applyReport(clashed(), { returned: ['A'] }, 6_000).board
  back = applyReport(back, { security: { group: 'A', advised: false, why: 'rien qui franchit la limite du compte' } }, 6_100).board
  const why = 'id de session non noté sûrement (plus d’une session candidate, un id hors forme, une session déjà notée pour un autre envoi ou deux copies en désaccord)'
  expect(closedHint({ kind: 'group', id: 'A', name: 'Synchro' }, undefined, activeRun(back)!.groups!.find(g => g.id === 'A')!.delegated)).toContain(JSON.stringify(why))
  const stopped = applyReport(back, { closed: [{ group: 'A', state: 'stopped', why }] }, 7_000).board
  const closing = activeRun(stopped)!.groups!.find(g => g.id === 'A')!.delegated?.closing
  expect(closing?.state).toBe('stopped')
  expect(closing?.why).toContain('id de session non noté sûrement')
  // Rejoué : toujours « stopped », la marque reste, et « Do not close » ne repropose pas de fermer.
  const again = applyReport(stopped, { closed: [{ group: 'A', state: 'stopped', why }] }, 7_100).board
  expect(activeRun(again)!.groups!.find(g => g.id === 'A')!.delegated?.sessionClash).toBe(true)
  expect(closingText(activeRun(again)!, null, true)).not.toMatch(/Close now: group A/)
})

test('la fusion : la même session notée sous deux longueurs n’est pas un désaccord', () => {
  const base = sent()
  const short = activeRun(linkGroupSession(base, 'Boutique > Groupe A · Synchro', '9f3e21', 3_500)!.board)!
  const long = activeRun(linkGroupSession(base, 'Boutique > Groupe A · Synchro', '9f3e21aa', 3_500)!.board)!
  const merged = keepSessions(short, long).groups!.find(g => g.id === 'A')!.linked
  expect(merged?.session).toBe('9f3e21')
  expect(merged?.sessionClash).toBeUndefined()
})

test('un envoi marqué n’attend plus de session : ni une ligne « backgrounded » ni « Annuler » ne le touchent', () => {
  const board = clashed()
  expect(linkGroupSession(board, 'Boutique > Groupe A · Synchro', 'deadbeef', 6_000)).toBeNull()
  expect(cancelLinkedGroup(board, 'A', 6_000)).toBeNull()
  // Le signal d'un lancement filtré ne le compte pas parmi les envois en attente.
  expect(unnotedLaunchNotice(activeRun(board)!, 'filtered')).toMatch(/groups B, C, D/)
})

test('la même session, notée par un id court de 6 signes, n’est pas notée une deuxième fois pour un autre envoi', () => {
  const board = linkGroupSession(sent(), 'Boutique > Groupe A · Synchro', '9f3e21', 3_500)!.board
  const out = linkRelaySessions(board, relayOf(board, [{ session: UUID_A, group: 'B', at: 4_000 }]), 5_000)!
  expect(linkOf(out.board, 'B')?.session).toBeUndefined()
  expect(linkOf(out.board, 'B')?.sessionClash).toBe(true)
})

test('le scénario de la mission : quatre lancements filtrés par | tail -2, puis l’appel delegate de chaque worker : fermeture complète', () => {
  const board = sent(3_000)
  // La commande fautive : la sortie filtrée ne garde que « claude logs » et « claude stop ».
  const command = ['A', 'B', 'C', 'D'].map(g => `test -s "$P-${g}.md" && claude --bg -n 'Boutique > Groupe ${g} · x' -w 'groupe-boutique-${g}' "$(cat "$P-${g}.md")" 2>&1 | tail -2`).join('\n')
  const out = '  claude logs 9f3e21aa\n  claude stop 9f3e21aa\n'
  expect(isBackgroundLaunch(command)).toBe(true)
  expect(backgroundLaunches(command, out)).toEqual([])
  const workers = [
    { session: UUID_A, group: 'A', at: 4_000, report: true },
    { session: UUID_B, group: 'B', at: 4_000, report: true },
    { session: UUID_C, group: 'C', at: 4_000, report: true },
    { session: UUID_D, group: 'D', at: 4_000, report: true },
  ]
  const relay = relayOf(board, workers)
  const linked = linkRelaySessions(board, relay, 5_000)!.board
  const shorts = { A: '9f3e21aa', B: '4c9ac344', C: '60481870', D: '178bd61c' } as const
  for (const [g, id] of Object.entries(shorts)) expect(linkOf(linked, g)?.session).toBe(id)
  // Les quatre rendus, tickets faits.
  let back = applyReport(linked, { set: ['a1', 'b1', 'c1', 'd1'].map(id => ({ id, status: 'done' })), returned: ['A', 'B', 'C', 'D'] }, 6_000, { relay }).board
  // L'avis de sécurité de chaque groupe, que la fermeture attend.
  for (const g of ['A', 'B', 'C', 'D']) back = applyReport(back, { security: { group: g, advised: false, why: 'rien qui franchit la limite du compte' } }, 6_100, { relay }).board
  const run = activeRun(back)!
  for (const [g, id] of Object.entries(shorts)) {
    const group = run.groups!.find(x => x.id === g)!
    expect(relayedReportAt(relay, group, run.groups)).toBeDefined()
    const text = closingProcedure({ run, target: { kind: 'group', id: g, name: group.name }, isRepo: true, session: group.delegated!.session!, hasReport: true, noted: undefined, send: group.delegated! })
    expect(text).toContain(`'${id}'`)
    expect(text).toContain(`claude rm '${id}'`)
  }
  const closing = closingText(run, relay, true)
  for (const id of Object.values(shorts)) expect(closing).toContain(`claude rm '${id}'`)
  // Par le script de vérification : sa commande porte --session, et la procédure propose claude rm.
  const before = closingScript.path
  closingScript.path = '/opt/poste/.claude/plugins/flow-board/scripts/fermeture.mjs'
  try {
    const short = closingText(run, relay, true)
    for (const id of Object.values(shorts)) {
      expect(short).toContain(`--session '${id}'`)
      expect(short).toContain(`claude rm '${id}'`)
    }
  } finally {
    closingScript.path = before
  }
})

test('un lancement claude --bg sans ligne « backgrounded » se dit, seulement quand un envoi attend sa session', () => {
  const board = sent(3_000, ['A', 'B'])
  const run = activeRun(board)!
  expect(unnotedLaunchNotice(run, 'filtered')).toMatch(/A, B/)
  expect(unnotedLaunchNotice(run, 'filtered')).toMatch(/backgrounded/)
  expect(unnotedLaunchNotice(run, 'filtered')).toMatch(/one command per worker/)
  expect(unnotedLaunchNotice(run, 'background')).toMatch(/run in the background/)
  // Plus aucun envoi en attente : rien.
  const both = linkRelaySessions(board, relayOf(board, [{ session: UUID_A, group: 'A', at: 4_000 }, { session: UUID_B, group: 'B', at: 4_000 }]), 5_000)!.board
  expect(unnotedLaunchNotice(activeRun(both)!, 'filtered')).toBe('')
  expect(isBackgroundLaunch('claude agents --json')).toBe(false)
  expect(isBackgroundLaunch('echo "claude --bg"')).toBe(false)
  // Deux lancements dans une commande, un seul relevé : il en manque un (le register compare ces deux nombres).
  const two = `claude --bg -n 'Boutique > Groupe A · x' "a"\nclaude --bg -n 'Boutique > Groupe B · x' "b" 2>&1 | tail -2`
  expect(backgroundLaunchCount(two)).toBe(2)
  expect(backgroundLaunches(two, 'backgrounded · 9f3e21aa · Boutique > Groupe A · x\n').length).toBe(1)
})

test('un envoi rendu sans session notée ni marque : le journal le dit', () => {
  const back = applyReport(sent(), { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 6_000).board
  expect(logText(back)).toMatch(/Groupe A rendu sans session notée/)
  // Avec une session notée : rien de tel.
  const noted = linkGroupSession(sent(), 'Boutique > Groupe A · Synchro', '9f3e21aa', 3_500)!.board
  expect(logText(applyReport(noted, { set: [{ id: 'a1', status: 'done' }], returned: ['A'] }, 6_000).board)).not.toMatch(/rendu sans session notée/)
})

// ─── Dans le moteur ──────────────────────────────────────────────────────

/** Le moteur sous le plugin : un stockage en mémoire, un shell qui répond comme `claude --bg … | tail -2`. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  // La sortie filtrée : la ligne « backgrounded » n'y est plus.
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '  claude logs 9f3e21aa\n  claude stop 9f3e21aa\n' } }))
  return { mem }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

test('dans le manager : la réponse au lancement filtré le dit, puis la session vient de l’entrée de relais du worker', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  memoryDisk(on)
  const { mem } = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...PLAN } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'flow-board', props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} } } as any)
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  const ran: any = await $.tool.call({ tool: 'Bash', command: `test -s "$P-A.md" && claude --bg -n 'Boutique > Groupe A · Synchro' -w 'groupe-boutique-A' "$(cat "$P-A.md")" 2>&1 | tail -2` } as any)
  expect(JSON.stringify(ran.context ?? [])).toMatch(/backgrounded/)
  expect(JSON.stringify(ran.context ?? [])).toMatch(/group A/)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const runId = (mem[KEY] as Board).runs.find(r => r.title === 'Boutique')!.id
  expect((mem[KEY] as Board).runs.find(r => r.id === runId)!.groups!.find(g => g.id === 'A')!.linked?.session).toBeUndefined()
  // Le worker s'est déclaré : son entrée de relais, sous son id complet.
  const relay = applyRelay(null, runId, UUID_A, { kind: 'start', group: 'A' }, T0 + 1_000)!
  mem[`relay:${runId}:${UUID_A}`] = { v: 1, run: runId, session: UUID_A, entry: relay.sessions[UUID_A] }
  for (let i = 0; i < 12; i++) await clock.advance(1000)
  expect((mem[KEY] as Board).runs.find(r => r.id === runId)!.groups!.find(g => g.id === 'A')!.linked?.session).toBe('9f3e21aa')
})
