// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { TOOL, start, world, writeBoard } from './monde-coordination.ts'
import { settle } from './horloge.ts'

import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import { applyRelay, ownRefIn, relayForGroup, relayRefusal, soundOwnRef, WORKER_REF_ASK, workerRefSessions, workerRefsText } from '../hooks/relay.ts'
import type { Board, Relay, RelayEntry, Run, Ticket } from '../types'

// La réponse de l'outil flow du manager donne la référence du moment de chaque worker lié et son adresse « <nom> [ref] »
// (SendMessage ne résout pas une [ref] seule), que le mod du worker lit lui-même dans le résultat d'un ListAgents de son
// fil principal (le moteur ne la donne pas à un mod par `$`).
// Invariant (validé par le porteur le 22/11/2026) : « La référence d'un worker et son adresse (« <nom> [ref] », telle que
// la première ligne de son ListAgents la montre) ne sont écrites que par sa propre session, dans sa propre entrée du
// relais, dans leur forme bornée ; elles ne sont jamais réécrites vides ni remplacées par de plus anciennes, et la réponse
// de l'outil flow ne les présente jamais comme sûres quand la fin de cette session est prouvée. »

const T0 = 940_000_000
const RUN = 'run-ref'
const SESSION = 'session-A'

const listing = (ref: string) => `This session is Pistes > Groupe A · Code ${ref} — the name other sessions use to message it (it is not listed below; a message to it would be a message to yourself).\n\nPeer sessions (2):\n  Manager [e0282d]  ·  bg  ·  idle\n  Autre [c9cb8d]  ·  bg  ·  idle`

// ─── La lecture de la ligne de ListAgents ─────────────────────────────────

test('ownRefIn : la référence de la première ligne et son adresse, dans sa forme bornée ; sinon rien', () => {
  expect(ownRefIn({ listing: listing('[afff26]') }, '')).toEqual({ ref: '[afff26]', address: 'Pistes > Groupe A · Code [afff26]' })
  // Sans liste structurée, le texte du résultat.
  expect(ownRefIn(undefined, listing('[a1b2c3d4]'))?.ref).toBe('[a1b2c3d4]')
  // Une ligne sans pairs (rien après la référence).
  expect(ownRefIn({ listing: 'This session is Seul [abcd]' }, '')).toEqual({ ref: '[abcd]', address: 'Seul [abcd]' })
  // Un nom qui porte lui-même des crochets et un tiret long : la dernière référence avant « — » est celle de la session.
  expect(ownRefIn({ listing: 'This session is Fix [abcd] — suite [afff26] — the name other sessions use to message it' }, '')).toEqual({ ref: '[afff26]', address: 'Fix [abcd] — suite [afff26]' })
  // La référence d'un pair, sur une autre ligne, n'est jamais prise.
  expect(ownRefIn({ listing: 'Peer sessions (1):\n  Manager [e0282d]  ·  bg' }, '')).toBeNull()
  // Hors forme : majuscules, trop court, trop long, espace, sosies, rien entre crochets.
  for (const ref of ['[AFFF26]', '[abc]', '[abcdefghijklm]', '[ab cd]', '[ａｂｃｄ]', '[]', 'afff26']) expect(ownRefIn({ listing: listing(ref) }, '')).toBeNull()
  for (const odd of [null, 42, {}, { listing: 42 }, []]) expect(ownRefIn(odd, undefined)).toBeNull()
})

// ─── L'entrée de relais du worker ─────────────────────────────────────────

const entryOf = (relay: Relay | null): RelayEntry | undefined => relay?.sessions[SESSION]
const started = (): Relay => applyRelay(null, RUN, SESSION, { kind: 'start', group: 'A' }, T0)!

/** Des signes qui n'ont pas leur place dans une adresse, par leur point de code (jamais bruts dans la source). */
const ZWSP = String.fromCodePoint(0x200b)
const LINE_SEP = String.fromCodePoint(0x2028)
const BIDI = String.fromCodePoint(0x202e)
const ADDRESS = 'Pistes > Groupe A · Code [afff26]'

test('la référence et son adresse s’écrivent dans la seule entrée de la session, datées ; jamais vides, jamais hors forme, jamais sans entrée ni sur une session finie', () => {
  // Sans entrée (pas encore de "delegate") : refusée, donc jamais tenue pour gardée (le mod la redemande).
  expect(relayRefusal(undefined, { kind: 'ref', ref: '[afff26]' })).not.toBeNull()
  expect(applyRelay(null, RUN, SESSION, { kind: 'ref', ref: '[afff26]' }, T0)).toBeNull()
  const relay = applyRelay(started(), RUN, SESSION, { kind: 'ref', ref: '[afff26]', address: ADDRESS }, T0 + 10)!
  expect(relayRefusal(entryOf(relay), { kind: 'ref', ref: '[afff26]' })).toBeNull()
  expect(entryOf(relay)!.ref).toEqual({ value: '[afff26]', at: T0 + 10, address: ADDRESS })
  expect(Object.keys(relay.sessions)).toEqual([SESSION])
  // Vide ou hors forme : rien ne change.
  for (const ref of ['', '[]', 'afff26', '[AFFF26]', '[ab]', '[afff26] ', ' [afff26]']) expect(applyRelay(relay, RUN, SESSION, { kind: 'ref', ref }, T0 + 20)).toBeNull()
  // Une adresse hors forme (invisible, séparateur de ligne, contrôle, inversion, trop longue, une autre référence, un
  // nom vide ou entouré d'espaces, autre chose qu'un texte) : la référence seule est gardée.
  for (const address of [`Pistes${ZWSP} [afff26]`, `Pistes${LINE_SEP}x [afff26]`, 'Pistes\n [afff26]', 'Pistes\u0007 [afff26]', `${BIDI}Pistes [afff26]`, `${'x'.repeat(300)} [afff26]`, 'Pistes [b01476]', ' [afff26]', 'Pistes  [afff26]', ' Pistes [afff26]', '[afff26]', 42])
    expect(entryOf(applyRelay(started(), RUN, SESSION, { kind: 'ref', ref: '[afff26]', address } as any, T0 + 10)!)!.ref).toEqual({ value: '[afff26]', at: T0 + 10 })
  // Une session finie : rien.
  const ended = applyRelay(relay, RUN, SESSION, { kind: 'end' }, T0 + 30)!
  expect(applyRelay(ended, RUN, SESSION, { kind: 'ref', ref: '[b01476]', address: 'Pistes > Groupe A · Code [b01476]' }, T0 + 40)).toBeNull()
})

test('une référence plus récente remplace l’ancienne, datée ; la même relue sous la même adresse ne réécrit jamais rien, et la date de l’entrée ne bouge pas', () => {
  const A1 = 'Pistes > Groupe A · Code [a3debb]'
  const first = applyRelay(started(), RUN, SESSION, { kind: 'ref', ref: '[a3debb]', address: A1 }, T0 + 10)!
  // Ni dans la minute, ni au-delà, ni après le silence de 30 minutes : un worker qui ne fait plus que relire ListAgents
  // ne repousse pas la date de son entrée (`silentWorkers` le voit se taire).
  for (const later of [T0 + 30_000, T0 + 70_000, T0 + 45 * 60_000]) expect(applyRelay(first, RUN, SESSION, { kind: 'ref', ref: '[a3debb]', address: A1 }, later)).toBeNull()
  // La même référence sous un autre nom (la discussion renommée) : réécrite, datée.
  const renamed = applyRelay(first, RUN, SESSION, { kind: 'ref', ref: '[a3debb]', address: 'Autre nom [a3debb]' }, T0 + 60_000)!
  expect(entryOf(renamed)!.ref).toEqual({ value: '[a3debb]', at: T0 + 60_000, address: 'Autre nom [a3debb]' })
  // Le worker redémarré : une autre référence, plus récente.
  const restarted = applyRelay(renamed, RUN, SESSION, { kind: 'ref', ref: '[b01476]', address: 'Autre nom [b01476]' }, T0 + 80_000)!
  expect(entryOf(restarted)!.ref).toEqual({ value: '[b01476]', at: T0 + 80_000, address: 'Autre nom [b01476]' })
  // Les autres champs de l'entrée restent.
  expect(entryOf(restarted)!.group).toBe('A')
})

test('relue d’un fichier : une référence hors forme vaut absente, une adresse hors forme aussi (soundOwnRef), sans faire tomber l’entrée', () => {
  expect(soundOwnRef({ value: '[afff26]', at: T0 })).toEqual({ value: '[afff26]', at: T0 })
  expect(soundOwnRef({ value: '[afff26]', at: T0, address: ADDRESS })).toEqual({ value: '[afff26]', at: T0, address: ADDRESS })
  for (const address of ['Nom [b01476]', `Nom${ZWSP} [afff26]`, `Nom${LINE_SEP} [afff26]`, 42, null]) expect(soundOwnRef({ value: '[afff26]', at: T0, address })).toEqual({ value: '[afff26]', at: T0 })
  for (const odd of [null, 'afff26', { value: '[AFFF26]', at: T0 }, { value: '[afff26]' }, { value: '[afff26]', at: 'hier' }, { value: '[afff26]', at: Number.NaN }, { value: 42, at: T0 }, { value: '[AFFF26]', at: T0, address: 'Nom [AFFF26]' }])
    expect(soundOwnRef(odd)).toBeUndefined()
})

// ─── La réponse du manager ────────────────────────────────────────────────

const TICKETS: Ticket[] = [
  { id: 'a1', name: 'Un', status: 'todo', sensitive: false, files: ['a.ts'] },
  { id: 'b1', name: 'Deux', status: 'todo', sensitive: false, files: ['b.ts'] },
]
const boardWith = (linked: string[], link: Record<string, unknown> = {}): Board => {
  const run = newRun('implement', T0 - 6000, 'Boutique')
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const b = applyReport(base, { tickets: TICKETS, groups: [{ id: 'A', name: 'Code', tickets: ['a1'] }, { id: 'B', name: 'Données', tickets: ['b1'] }] }, T0 - 5000).board
  const r = b.runs[0]!
  return { ...b, runs: [{ ...r, groups: r.groups!.map(g => (linked.includes(g.id) ? { ...g, linked: { at: T0 - 4000, ...link } } : g)) }] }
}
const relayOf = (runId: string, sessions: Record<string, unknown>): Relay => ({ v: 1, run: runId, sessions: sessions as Relay['sessions'] })
const entry = (over: Record<string, unknown>) => ({ group: 'A', tickets: {}, commits: 0, startedAt: T0 - 3000, at: T0 - 100, ...over })

const NOTED = `noted ${new Date(T0 - 200).toISOString().slice(0, 16).replace('T', ' ')} UTC`

test('la réponse du manager : une ligne par groupe confié, chaque forme de la référence gardée et son sort', () => {
  const b = boardWith(['A', 'B'])
  const run = b.runs[0]! as Run
  // Le repli est ListAgents, jamais le nom seul : un nom peut désigner une autre session que le worker du groupe.
  const TAIL = " · Worker addresses (each read by the worker's mod in its own ListAgents; send to one exactly as written; a restart may have changed its [ref]: if a send fails, call ListAgents): "
  // Absente, et pas de relais du tout.
  expect(workerRefsText(run, null)).toBe(`${TAIL}group "A": none kept, call ListAgents; group "B": none kept, call ListAgents`)
  // Hors forme : ignorée, comme absente.
  const odd = relayOf(run.id, { s1: entry({ ref: { value: '[AFFF26]', at: T0 - 200 } }) })
  expect(workerRefsText(run, odd)).toContain('group "A": none kept, call ListAgents')
  // De forme sûre, session en cours : son adresse telle que son ListAgents la montre, avec l'heure où elle a été notée.
  const live = relayOf(run.id, { s1: entry({ ref: { value: '[afff26]', at: T0 - 200, address: ADDRESS } }) })
  expect(workerRefsText(run, live)).toContain(`group "A": "${ADDRESS}", ${NOTED}`)
  // Sans adresse en forme : la référence seule, et où la chercher (SendMessage ne la résout pas seule).
  const bare = relayOf(run.id, { s1: entry({ ref: { value: '[afff26]', at: T0 - 200 } }) })
  expect(workerRefsText(run, bare)).toContain(`group "A": [afff26] (no name kept: send to the ListAgents row that shows it), ${NOTED}`)
  // De forme sûre, fin de la session prouvée (sa fin gardée au relais) : « not confirmed ».
  const ended = relayOf(run.id, { s1: entry({ ref: { value: '[afff26]', at: T0 - 200, address: ADDRESS }, endedAt: T0 - 50 }) })
  expect(workerRefsText(run, ended)).toContain(`group "A": "${ADDRESS}", not confirmed (its session ended)`)
  // Fin prouvée par le signal de vie (session d'arrière-plan arrêtée sans fin gardée) : « not confirmed » ; vivante ou
  // inconnue : donnée.
  expect(workerRefsText(run, live, new Map([['s1', 'stopped' as const]]))).toContain(`group "A": "${ADDRESS}", not confirmed (its session has stopped)`)
  for (const verdict of ['alive', 'unknown'] as const) expect(workerRefsText(run, live, new Map([['s1', verdict]]))).toContain(`group "A": "${ADDRESS}", ${NOTED}`)
  // Le verdict d'une autre session ne compte pas.
  expect(workerRefsText(run, live, new Map([['s9', 'stopped' as const]]))).toContain(`group "A": "${ADDRESS}", ${NOTED}`)
  // Les sessions dont le manager lit le signal de vie : celle de chaque référence donnée, avec la date où elle a été notée.
  expect(workerRefSessions([run], live)).toEqual([{ session: 's1', at: T0 - 200 }])
  expect(workerRefSessions([run], null)).toEqual([])
  expect(workerRefSessions(undefined, live)).toEqual([])
  // Un appel `resume` lit le relais de la mission qu'il reprend, pas celui de la mission active avant l'appel : la
  // mission est celle du relais lu, où qu'elle soit dans le tableau de bord.
  const otherRun = boardWith(['A']).runs[0]!
  const elsewhere = { ...otherRun, id: 'autre-mission' } as Run
  expect(workerRefSessions([elsewhere, run], live)).toEqual([{ session: 's1', at: T0 - 200 }])
  expect(workerRefSessions([elsewhere], live)).toEqual([])
  // Jamais la référence d'une session d'un envoi précédent (avant le lien).
  const before = relayOf(run.id, { s0: entry({ startedAt: T0 - 9000, ref: { value: '[old111]', at: T0 - 8000 } }) })
  expect(workerRefsText(run, before)).toContain('group "A": none kept, call ListAgents')
  // La session du moment, pas une plus ancienne du même lien.
  const two = relayOf(run.id, { s1: entry({ at: T0 - 900, ref: { value: '[a3debb]', at: T0 - 950 } }), s2: entry({ startedAt: T0 - 800, at: T0 - 10, ref: { value: '[b01476]', at: T0 - 20 } }) })
  expect(relayForGroup(two, run.groups![0]!, run.groups)?.ref?.value).toBe('[b01476]')
  // Sans groupe confié : rien.
  expect(workerRefsText(boardWith([]).runs[0]!, live)).toBe('')
})

test('la réponse du manager ne donne jamais pour sûre la référence d’une autre session que celle du groupe', () => {
  const FULL = 'abcdef12-3456-4789-8abc-def012345678'
  const relay = (runId: string) => relayOf(runId, { [FULL]: entry({ ref: { value: '[afff26]', at: T0 - 200, address: ADDRESS } }) })
  // La session de l'envoi n'a pas pu être notée sûrement (l'envoi marqué : plusieurs candidates, un id hors forme, une
  // session notée ailleurs) : ni adresse ni référence.
  const clash = boardWith(['A'], { sessionClash: true }).runs[0]! as Run
  expect(workerRefsText(clash, relay(clash.id))).toContain('group "A": not confirmed (the session of this send could not be noted safely), call ListAgents')
  expect(workerRefsText(clash, relay(clash.id))).not.toContain('[afff26]')
  // La session notée sur le lien n'est pas celle de l'entrée retenue.
  const other = boardWith(['A'], { session: '12345678' }).runs[0]! as Run
  expect(workerRefsText(other, relay(other.id))).toContain('group "A": not confirmed (not the session noted for this group), call ListAgents')
  // La session notée (son id court) est celle de l'entrée : donnée.
  for (const session of ['abcdef12', 'ABCDEF12', FULL]) {
    const same = boardWith(['A'], { session }).runs[0]! as Run
    expect(workerRefsText(same, relay(same.id))).toContain(`group "A": "${ADDRESS}", ${NOTED}`)
  }
  // Une session de l'app (`local_…`) ne se compare pas à l'id d'une entrée de relais : donnée, son entrée déclarant ce groupe.
  const app = boardWith(['A'], { session: 'local_0a1b2c' }).runs[0]! as Run
  expect(workerRefsText(app, relay(app.id))).toContain(`group "A": "${ADDRESS}", ${NOTED}`)
  // Sans session notée comparable, une entrée rattachée par ses seuls tickets (aucun groupe, ou un nom qui ne désigne
  // aucun groupe du plan) n'est pas le worker du groupe : ni adresse ni référence. Avec la session notée, c'est elle.
  const touching = (runId: string, group: unknown) => relayOf(runId, { [FULL]: entry({ group, tickets: { a1: { status: 'doing', at: T0 - 150 } }, ref: { value: '[c9cb8d]', at: T0 - 200, address: 'Autre > Groupe X · Y [c9cb8d]' } }) })
  const unnoted = boardWith(['A']).runs[0]! as Run
  for (const group of [undefined, 'Group A', 'Groupe Z']) {
    expect(workerRefsText(unnoted, touching(unnoted.id, group))).toContain('group "A": not confirmed (its relay entry does not declare this group), call ListAgents')
    expect(workerRefsText(unnoted, touching(unnoted.id, group))).not.toContain('[c9cb8d]')
    expect(workerRefsText(app, touching(app.id, group))).toContain('group "A": not confirmed (its relay entry does not declare this group), call ListAgents')
  }
  const noted = boardWith(['A'], { session: 'abcdef12' }).runs[0]! as Run
  expect(workerRefsText(noted, touching(noted.id, undefined))).toContain(`group "A": "Autre > Groupe X · Y [c9cb8d]", ${NOTED}`)
})

test('la réponse de l’outil du manager porte la ligne, avec le signal de vie lu avant l’appel ; celle d’un worker, non', () => {
  const b = boardWith(['A'])
  const run = b.runs[0]!
  const relay = relayOf(run.id, { s1: entry({ ref: { value: '[afff26]', at: T0 - 200, address: ADDRESS } }) })
  expect(applyReport(b, { note: 'où en est-on' }, T0, { relay }).text).toContain(`group "A": "${ADDRESS}", noted `)
  expect(applyReport(b, { note: 'et maintenant' }, T0, { relay, workerVerdicts: new Map([['s1', 'stopped' as const]]) }).text).toContain(`group "A": "${ADDRESS}", not confirmed (its session has stopped)`)
  const worker: Board = { ...b, delegate: { run: run.id, at: T0 } }
  expect(applyReport(worker, { note: 'x' }, T0, { relay }).text).not.toContain('Worker addresses')
})

// ─── Le mod du worker ─────────────────────────────────────────────────────

/** L'entrée de relais de cette session (fichier ou `$.store`). */
const entryIn = (w: ReturnType<typeof world>, runId: string): RelayEntry | undefined => {
  const file = Object.entries(w.files).find(([path]) => path.endsWith('.entry.json') && path.includes(runId))?.[1]
  const stored = w.mem[`relay:${runId}:${SESSION}`] as { entry?: RelayEntry } | undefined
  return file !== undefined ? JSON.parse(file).entry : stored?.entry
}

test('le mod du worker lit sa référence dans le ListAgents de son fil principal et la garde ; il la redemande au tour suivant tant qu’il ne l’a pas vue, puis plus', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  let result: unknown = { listing: 'Peer sessions (0):' }
  on('tool.call', { tool: 'ListAgents' as any }, () => ({ result, text: '' }))
  const run = { ...newRun('implement', T0 - 6000, 'Boutique'), status: 'active' as const, owner: 'session-B' }
  const mission = applyReport({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }, { tickets: TICKETS, groups: [{ id: 'A', name: 'Code', tickets: ['a1'] }, { id: 'B', name: 'Données', tickets: ['b1'] }] }, T0 - 5000).board.runs[0]!
  writeBoard(w, b => ({ ...b, runs: [{ ...mission, owner: 'session-B' }] }))
  await start($)
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[e0282d]' } as any)
  // Un ListAgents sans la ligne de la session : rien de gardé.
  await $.tool.call({ tool: 'ListAgents' } as any)
  await settle(clock, 1)
  expect(entryIn(w, mission.id)?.ref).toBeUndefined()
  // Un ListAgents d'un spécialiste (agentId) : jamais lu.
  result = { listing: listing('[f00ba4]') }
  await $.tool.call({ tool: 'ListAgents', agentId: 'agent-1' } as any)
  await settle(clock, 1)
  expect(entryIn(w, mission.id)?.ref).toBeUndefined()
  // Le fil principal : gardée avec son adresse, datée.
  result = { listing: listing('[afff26]') }
  await $.tool.call({ tool: 'ListAgents' } as any)
  await settle(clock, 1)
  expect(entryIn(w, mission.id)?.ref).toMatchObject({ value: '[afff26]', address: 'Pistes > Groupe A · Code [afff26]' })
  expect(typeof entryIn(w, mission.id)?.ref?.at).toBe('number')
  // Vue : la demande s'arrête au tour suivant.
  const turn = async (text: string): Promise<string[]> => [...((((await $.prompt.submit({ text, origin: { kind: 'composer' } } as any)) as any)?.context ?? []) as string[])]
  expect(await turn('reprends')).not.toContain(WORKER_REF_ASK)
  // Une autre délégation dans le même processus (un autre groupe : une autre entrée de relais) : la demande revient.
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'B', main: '[e0282d]' } as any)
  expect(await turn('groupe B')).toContain(WORKER_REF_ASK)
  result = { listing: listing('[afff26]') }
  await $.tool.call({ tool: 'ListAgents' } as any)
  await settle(clock, 1)
  expect(await turn('groupe B, suite')).not.toContain(WORKER_REF_ASK)
  // Un rechargement (un nouveau démarrage du mod) : la référence a pu changer, la demande revient.
  await start($)
  expect(await turn('après le rechargement')).toContain(WORKER_REF_ASK)
})

test('la demande au worker : faite au tour d’après un démarrage tant que la référence n’est pas vue, trois fois au plus', { timeoutMs: 30000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const w = world(on)
  const contexts: string[][] = []
  const run = { ...newRun('implement', T0 - 6000, 'Boutique'), status: 'active' as const, owner: 'session-B' }
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await $.tool.call({ tool: TOOL, delegate: run.id, group: 'A', main: '[e0282d]' } as any)
  for (let i = 0; i < 5; i++) {
    const out: any = await $.prompt.submit({ text: `tour ${i}`, origin: { kind: 'composer' } } as any)
    contexts.push([...(out?.context ?? [])])
  }
  expect(contexts.map(c => c.includes(WORKER_REF_ASK))).toEqual([true, true, true, false, false])
})
