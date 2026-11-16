// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { unmarkedAskText } from '../hooks/closing.ts'
import { newRun } from '../hooks/model.ts'
import type { Run } from '../types'
import { TOOL, coordFile, entries, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'

// La demande unique pour les discussions des missions archivées sans marque d'archivage (avant ce changement, ou par
// un chemin qui ne marque pas) : nommées une fois au
// relevé du COO, fermées seulement sur le oui tapé de la personne, dans le seul tour de ce oui ; son repère, gardé avec
// l'état de la feuille de route, ne la fait jamais revenir. Invariant : « Le COO ne ferme jamais une discussion qui
// tient encore une mission non archivée, qui a un tour ou une tâche en cours, ou qui est la sienne ; […] ».

const T0 = 700_000_000
const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const UUID2 = '1c7a2d3f-4e5b-4c6d-9e0f-1a2b3c4d5e6f'
const REQUEST = 'One-time request'

/** Une mission close, archivée avant la marque (`mark` : avec la marque « clic »), née dans la discussion `bornIn`. */
const archived = (title: string, bornIn: string, mark = false): Run =>
  ({ ...newRun('implement', T0 - 90_000, title), status: 'done', finishedAt: T0 - 60_000, archivedAt: T0 - 50_000, bornIn, ...(mark ? { archivedBy: { by: 'clic', at: T0 - 50_000 } } : {}) }) as Run

const call = async ($: any, input: unknown, agentId?: string): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...(agentId ? { agentId } : {}), coordinate: input } as any)) as any).result)
/** Un tour ouvert par un message tapé par la personne : le relevé joint à son `prompt.submit`. */
let turnNo = 0
const typed = async ($: any, text: string): Promise<string> => {
  const out = JSON.stringify(await $.prompt.submit({ text, origin: { kind: 'composer' } } as any))
  await $.turn.start({ turnId: `t-${++turnNo}`, text } as any)
  return out
}
const endTurn = ($: any) => $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: `t-${turnNo}`, reason: 'answer' })

/** Le COO ici, avec ces missions dans le fichier. */
const cooWith = async ($: any, on: any, runs: Run[]) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  return { clock, w }
}

/** Ce que le mod garde de la feuille de route (fichier du poste, ou magasin) ; undefined tant qu'il n'a rien écrit. */
const stateKey = (w: World): string | undefined => Object.keys(w.files).find(k => k.endsWith('.feuille-de-route.json')) ?? Object.keys(w.mem).find(k => k.startsWith('coo-roadmap:'))
const stateOf = (w: World): any => {
  const k = stateKey(w)
  if (k === undefined) return undefined
  return k in w.files ? JSON.parse(w.files[k]!) : w.mem[k]
}
const setState = (w: World, change: (s: any) => any) => {
  const k = stateKey(w)!
  if (k in w.files) w.files[k] = JSON.stringify(change(JSON.parse(w.files[k]!)))
  else w.mem[k] = change(w.mem[k])
}

// ─── Le texte ──────────────────────────────────────────────────────────────

test('le texte : nomme chaque discussion une fois, fait chercher celles qui existent, attend le oui tapé, puis la procédure qui cite ce oui', () => {
  const text = unmarkedAskText([{ title: '« A »', id: UUID }, { title: '« B »', id: UUID }, { title: '« C »', id: 'local_4f2a9c' }], '/Users/moi/projet', 0) ?? ''
  expect(text).toContain(`la discussion de la mission « A » ou « B » (id de session ${UUID}) ; la discussion de la mission « C » (id de session local_4f2a9c)`)
  expect(text).toContain('demande unique (une fois tranchée par l’outil flow, elle ne reviendra pas ; si tu me l’as déjà posée dans cette discussion sans que je t’aie répondu, ne la repose pas : attends ma réponse ; si je t’ai déjà répondu non, renvoie ce non au tableau de bord')
  expect(text).toContain('un oui, lui, ne se renvoie jamais d’un tour à l’autre : redemande-le-moi')
  // Le contrôle de la procédure ne porte jamais la liste entière écrite d'avance : seuls les ids acceptés.
  expect(text).toContain('{"coordinate": {"toClose": [<les ids que j’ai acceptés, entre guillemets>]}}')
  expect(text).not.toContain(`{"coordinate": {"toClose": ["${UUID}"`)
  // Une discussion remise à plus tard après le oui ne revient pas : la personne l'apprend.
  expect(text).toContain('une discussion remise à plus tard, ou que le contrôle ne rend pas, ne te sera plus proposée : dis-moi en une ligne lesquelles restent ouvertes')
  expect(text).toContain('claude agents --json --all dont le "sessionId" est exactement cet id')
  expect(text).toContain('la session de list_sessions qui a exactement cet id')
  // Dans l'app, un UUID introuvable n'est jamais lu comme « n'existe plus » ; un oui partiel retire ses exclus du contrôle.
  expect(text).toContain('un id que tu ne peux pas retrouver ainsi alors que l’outil list_sessions est ici (dans l’app, une discussion de l’app peut porter un UUID que claude agents ne liste pas) compte comme existant encore')
  expect(text).toContain('un oui partiel, « oui sauf … » : retire celles que j’exclus ; dans l’appel de contrôle de la procédure, ne mets que les ids qui restent')
  expect(text).toContain('sans que le tableau de bord ait noté un clic d’archivage (avant ce changement, ou par un autre chemin)')
  expect(text).toContain('attends mon oui, tapé par moi dans cette discussion')
  expect(text).toContain('{"coordinate": {"unmarked": "none"}}')
  expect(text).toContain('{"coordinate": {"unmarked": "yes"}}')
  expect(text).toContain('{"coordinate": {"unmarked": "no"}}')
  // Le oui d'abord, puis la procédure, qui cite ce oui comme accord, jamais un clic.
  expect(text.indexOf('"unmarked": "yes"')).toBeLessThan(text.indexOf('"toClose"'))
  expect(text).toContain('Mon oui, tapé dans cette discussion, pour celles que tu m’as nommées et que je n’ai pas exclues, vaut mon accord pour fermer chacune de ces discussions')
  expect(text).toContain('en citant mon oui tapé dans cette discussion comme mon accord pour cette discussion')
  expect(text).not.toContain('clic d’archivage vaut')
  expect(text).not.toContain('autres discussions de missions archivées')
})

test('le texte : un id hors forme n’y entre jamais ; aucun id en forme : rien ; celles d’au-delà du plafond sont comptées', () => {
  expect(unmarkedAskText([{ title: '« A »', id: 'abc"; rm -rf ~' }], null, 0)).toBeNull()
  expect(unmarkedAskText([], null, 0)).toBeNull()
  const text = unmarkedAskText([{ title: '« A »', id: 'x y' }, { title: '« B »', id: UUID }], null, 3) ?? ''
  expect(text).not.toContain('« A »')
  expect(text).toContain('3 autres discussions de missions archivées sans marque ne sont pas listées ici : elles restent ouvertes')
  // Sans racine sûre : jamais claude rm.
  expect(text).not.toContain('claude rm <id> sans aucune option')
})

// ─── Le monde du COO ───────────────────────────────────────────────────────

test('la demande paraît une fois ; le oui tapé ensuite ferme, dans ce seul tour ; le relevé suivant ne la porte plus', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Ancienne A', UUID)])
  const first = await typed($, 'bonjour')
  expect(first).toContain(REQUEST)
  expect(first).toContain(`(id de session ${UUID})`)
  // Sans le oui, le contrôle ne rend rien : la mission n'a pas de marque.
  expect(await call($, { toClose: [UUID] })).toContain('none of these')
  await endTurn($)
  // Le oui tapé par la personne, dans le tour suivant.
  await typed($, 'oui, ferme-la')
  expect(await call($, { unmarked: 'yes' })).toContain('Recorded')
  // Le même oui renvoyé dans ce tour (une réponse perdue) : la fenêtre reste ouverte, et la réponse le dit.
  expect(await call($, { unmarked: 'yes' })).toContain('In this turn only, the control')
  expect(stateOf(w).unmarkedAt).toBeGreaterThan(0)
  expect(await call($, { toClose: [UUID] })).toContain(`Discussions still to close: "${UUID}"`)
  expect(await call($, { discussionsClosed: [{ session: UUID, state: 'closed' }] })).toContain('Recorded: 1 discussion(s)')
  expect(entries(w).some((e: any) => e.kind === 'discussion' && e.session === UUID)).toBe(true)
  await endTurn($)
  const next = await typed($, 'et ?')
  expect(next).not.toContain(REQUEST)
  expect(next).not.toContain('Discussions to close')
})

test('le oui hors du tour du oui : la fin du tour, un tour du mod ou un spécialiste ne rendent rien', { timeoutMs: 20000 }, async ($, on) => {
  await cooWith($, on, [archived('Ancienne A', UUID)])
  await typed($, 'bonjour')
  await endTurn($)
  await typed($, 'oui')
  // Un spécialiste, même dans ce tour : le contrôle ne rend pas les discussions sans marque.
  expect(await call($, { unmarked: 'yes' }, 'a-specialiste')).toContain('Refused')
  expect(await call($, { unmarked: 'yes' })).toContain('Recorded')
  expect(await call($, { toClose: [UUID] }, 'a-specialiste')).toContain('none of these')
  await endTurn($)
  // Le tour fini : plus rien.
  expect(await call($, { toClose: [UUID] })).toContain('none of these')
  // Un tour ouvert par le mod : rien non plus.
  await $.prompt.submit({ text: 'relance du mod', origin: { kind: 'plugin', name: 'flow-board' } } as any)
  await $.turn.start({ turnId: 't-mod', text: 'relance du mod' } as any)
  expect(await call($, { toClose: [UUID] })).toContain('none of these')
})

test('un oui dans le tour même où la demande paraît pour la première fois, ou dans un tour du mod : refusé, rien n’est posé', { timeoutMs: 20000 }, async ($, on) => {
  // Le fichier de coordination illisible à l'ouverture : la demande ne paraît qu'au premier message tapé.
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: [archived('Ancienne A', UUID)] }))
  w.coord.unread = true
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  w.coord.unread = false
  await settle(clock, 6)
  expect(await typed($, 'bonjour')).toContain(REQUEST)
  expect(await call($, { unmarked: 'yes' })).toContain('Refused')
  await endTurn($)
  await $.prompt.submit({ text: 'relance du mod', origin: { kind: 'plugin', name: 'flow-board' } } as any)
  await $.turn.start({ turnId: 't-mod', text: 'relance du mod' } as any)
  expect(await call($, { unmarked: 'yes' })).toContain('Refused')
  expect(stateOf(w)?.unmarkedAt).toBeUndefined()
  expect(await call($, { toClose: [UUID] })).toContain('none of these')
})

test('un non pose le repère sans rien fermer ; « none » de même ; un second oui ensuite ne rouvre rien', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Ancienne A', UUID)])
  await typed($, 'bonjour')
  expect(await call($, { unmarked: 'no' })).toContain('Recorded')
  await endTurn($)
  expect(stateOf(w).unmarkedAt).toBeGreaterThan(0)
  const next = await typed($, 'oui finalement')
  expect(next).not.toContain(REQUEST)
  expect(await call($, { unmarked: 'yes' })).toContain('already settled')
  expect(await call($, { toClose: [UUID] })).toContain('none of these')
  expect(entries(w).some((e: any) => e.kind === 'discussion')).toBe(false)
})

test('« unmarked » sans demande parue, hors liste, ou mêlé à une autre clé : refusé', { timeoutMs: 20000 }, async ($, on) => {
  await cooWith($, on, [])
  expect(await call($, { unmarked: 'no' })).toContain('no one-time request')
  expect(await call($, { unmarked: 'peut-être' })).toContain('"unmarked" takes')
  expect(await call($, { unmarked: 'no', decisionsSeen: true })).toContain('Refused, nothing of this call applied')
})

test('aucune discussion sans marque : le repère est posé sans rien demander ; les missions marquées restent dans leur section', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Marquée', UUID, true)])
  const first = await typed($, 'bonjour')
  expect(first).not.toContain(REQUEST)
  expect(first).toContain('Discussions to close')
  expect(stateOf(w).unmarkedAt).toBeGreaterThan(0)
})

test('une discussion sans marque et une marquée : le oui les rend toutes les deux, une fois chacune', { timeoutMs: 20000 }, async ($, on) => {
  await cooWith($, on, [archived('Marquée', UUID, true), archived('Sans marque', UUID2), archived('Sans marque bis', UUID)])
  const first = await typed($, 'bonjour')
  expect(first).toContain(`la discussion de la mission « Sans marque » (id de session ${UUID2})`)
  // La discussion que la section des discussions à fermer porte déjà (une mission marquée la désigne) n'est pas redemandée.
  expect(first).not.toContain('la discussion de la mission « Sans marque bis »')
  expect(first).not.toContain('« Marquée » ou « Sans marque bis »')
  await endTurn($)
  await typed($, 'oui')
  expect(await call($, { unmarked: 'yes' })).toContain('Recorded')
  expect(await call($, { toClose: [UUID, UUID2, UUID] })).toContain(`Discussions still to close: "${UUID}", "${UUID2}"`)
})

test('une mission sans marque dont la discussion tient une mission en cours n’est jamais nommée ni rendue', { timeoutMs: 20000 }, async ($, on) => {
  const busy = { ...newRun('implement', T0, 'En cours'), owner: UUID }
  const { w } = await cooWith($, on, [archived('Sans marque', UUID), busy])
  const first = await typed($, 'bonjour')
  expect(first).not.toContain(REQUEST)
  // Rien à demander pour l'instant, mais le repère n'est pas posé : la discussion sera nommée une fois libre.
  expect(stateOf(w)?.unmarkedAt).toBeUndefined()
})

test('un spécialiste ne tranche jamais la demande, ni par « none » ni par « no »', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Ancienne A', UUID)])
  await typed($, 'bonjour')
  expect(await call($, { unmarked: 'none' }, 'a-specialiste')).toContain('never by a specialist')
  expect(await call($, { unmarked: 'no' }, 'a-specialiste')).toContain('never by a specialist')
  expect(stateOf(w)?.unmarkedAt).toBeUndefined()
})

test('une liste vide au contrôle ou au compte rendu a sa réponse ; mêlée à une autre clé, l’appel entier est refusé', { timeoutMs: 20000 }, async ($, on) => {
  await cooWith($, on, [archived('Marquée', UUID, true)])
  expect(await call($, { toClose: [] })).toContain('none of these')
  expect(await call($, { discussionsClosed: [] })).toContain('Nothing is written')
  expect(await call($, { toClose: [], close: [{ mission: 'x' }] })).toContain('Refused, nothing of this call applied')
})

test('le repère survit aux autres écritures de l’état de la feuille de route', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Ancienne A', UUID)])
  await typed($, 'bonjour')
  expect(await call($, { unmarked: 'none' })).toContain('Recorded')
  const at = stateOf(w).unmarkedAt
  expect(await call($, { gleanedExisting: true })).toContain('recorded')
  expect(stateOf(w).unmarkedAt).toBe(at)
  expect(stateOf(w).gleanedAt).toBeGreaterThan(0)
  await endTurn($)
  expect(await typed($, 'et ?')).not.toContain(REQUEST)
})

test('bornes du repère : hors forme, il se lit absent ; une date future se lit posée ; un état hors forme est mis de côté tel quel', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Ancienne A', UUID)])
  // Un état écrit d'abord (le relevé unique de l'existant), puis retouché.
  expect(await call($, { gleanedExisting: true })).toContain('recorded')
  for (const bad of ['x', -1, 0, null]) {
    setState(w, s => ({ ...s, unmarkedAt: bad }))
    expect(await typed($, `et ? ${String(bad)}`)).toContain(REQUEST)
    await endTurn($)
  }
  setState(w, s => ({ ...s, unmarkedAt: T0 + 10 * 365 * 86_400_000 }))
  expect(await typed($, 'et ? futur')).not.toContain(REQUEST)
  await endTurn($)
  // Hors forme : l'état est mis de côté tel quel (jamais effacé) et repart neuf, comme pour le relevé de l'existant ; la
  // demande revient alors (elle ne ferme rien d'elle-même).
  const k = stateKey(w)!
  const isFile = k in w.files
  if (isFile) w.files[k] = '{"v":1,"root":"","se'
  else w.mem[k] = 'pas un état'
  expect(await typed($, 'et ? hors forme')).toContain(REQUEST)
  await endTurn($)
  expect(Object.values(w.asides).some(t => t.includes(isFile ? '{"v":1,"root":"","se' : 'pas un état'))).toBe(true)
})

test('l’état de la feuille de route qui ne se lit pas (magasin) : rien n’est demandé ni posé', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Ancienne A', UUID)])
  expect(await call($, { gleanedExisting: true })).toContain('recorded')
  const k = stateKey(w)!
  // Le fichier du poste ne sait pas échouer à la lecture dans ce faux moteur : seul le magasin le peut.
  if (k in w.files) return
  w.probe.refuseRead = key => key === k
  expect(await typed($, 'bonjour')).not.toContain(REQUEST)
  await endTurn($)
  w.probe.refuseRead = undefined
  expect(stateOf(w).unmarkedAt).toBeUndefined()
})

test('plus de 30 discussions sans marque : la demande les nomme toutes, et le oui les rend toutes', { timeoutMs: 30000 }, async ($, on) => {
  const ids = Array.from({ length: 35 }, (_, i) => `${String(i).padStart(8, '0')}-3d4a-4b5c-8d9e-0f1a2b3c4d5e`)
  await cooWith($, on, ids.map((id, i) => archived(`Ancienne ${i}`, id)))
  const first = await typed($, 'bonjour')
  for (const id of ids) expect(first).toContain(`(id de session ${id})`)
  await endTurn($)
  await typed($, 'oui')
  expect(await call($, { unmarked: 'yes' })).toContain('Recorded')
  const out = await call($, { toClose: ids })
  for (const id of ids) expect(out).toContain(`"${id}"`)
  expect(await call($, { discussionsClosed: ids.map(session => ({ session, state: 'absent' })) })).toContain('Recorded: 35 discussion(s)')
})

test('le fichier de coordination illisible : rien n’est demandé ni posé', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Ancienne A', UUID)])
  w.coord.unread = true
  w.coord.text = coordFile([]).slice(0, 10)
  expect(await typed($, 'bonjour')).not.toContain(REQUEST)
  expect(stateOf(w)?.unmarkedAt).toBeUndefined()
})
