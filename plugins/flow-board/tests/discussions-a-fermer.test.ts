// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { soundEntry, withoutGone, keepsEntries, type CoordEntry } from '../hooks/coordination.ts'
import { discussionsToClose, discussionsToCloseBoth } from '../hooks/discussions.ts'
import { missionSessionsArchiveText } from '../hooks/closing.ts'
import { newRun } from '../hooks/model.ts'
import type { Run } from '../types'
import { TOOL, coordFile, entries, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'

// La liste des discussions de managers à fermer, recalculée à chaque relevé du siège et à chaque appel de contrôle,
// jamais gardée : missions archivées par un clic ou une rétro (la marque), leur discussion désignée par
// `missionSessionId`, de la même surface, sans trace de fermeture datée de l'archivage ou après. Chaque ligne de la
// table de désignation a son test, nommé comme la ligne.

const T0 = 900_000_000
const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const UUID2 = '1c7a2d3f-4e5b-4c6d-9e0f-1a2b3c4d5e6f'
const COO_UUID = '2d8b3e4a-5f6c-4d7e-8f9a-2b3c4d5e6f7a'
const LOCAL = 'local_4f2a9c'

/** Une mission close, archivée par un clic (marque datée de l'archivage ; `null` : sans marque), née dans `bornIn`. */
const archived = (title: string, bornIn?: string, at = T0 - 10_000, mark: unknown = { by: 'clic', at }): Run =>
  ({ ...newRun('implement', T0 - 90_000, title), status: 'done', finishedAt: at - 1_000, archivedAt: at, ...(mark !== null ? { archivedBy: mark } : {}), ...(bornIn !== undefined ? { bornIn } : {}) }) as Run

/** Une trace de fermeture, telle que le mod du siège l'écrit. */
const trace = (run: string, session: string, at: number, state = 'closed') => ({ id: `c${at.toString(36)}aaaaaa`, kind: 'discussion', run, at, session, state })

/** Le relevé joint au message suivant de la personne, en texte. */
const statement = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))

/** Un appel de l'outil flow chez le COO. */
const coordinate = async ($: any, input: unknown): Promise<string> => String(((await $.tool.call({ tool: TOOL, coordinate: input } as any)) as any).result)

/** Le COO ouvert sur ces missions, ce fichier de coordination, et cet id de discussion. */
const cooWith = async ($: any, on: any, runs: Run[], coord: unknown[] = [], here?: string): Promise<{ w: World; clock: any }> => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  if (here !== undefined) w.ids.now = here
  writeBoard(w, x => ({ ...x, runs }))
  if (coord.length > 0) w.coord.text = coordFile(coord)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  return { w, clock }
}

test('Ni bornIn ni owner en forme d’id de session (absent, gabarit, hors forme) : pas listée ; jamais cherchée par son titre', { timeoutMs: 20000 }, async ($, on) => {
  await cooWith($, on, [archived('Sans id'), archived('Gabarit', '<id de session>'), archived('Hors forme', 'abc"; rm -rf ~')])
  const text = await statement($)
  expect(text).not.toContain('Discussions to close')
  expect(text).not.toContain('rm -rf')
})

test('L’id est celui de la discussion du COO : jamais listée', { timeoutMs: 20000 }, async ($, on) => {
  await cooWith($, on, [archived('Née chez le COO', COO_UUID)], [], COO_UUID)
  expect(await statement($)).not.toContain('Discussions to close')
  expect(await coordinate($, { toClose: [COO_UUID] })).toContain('none of these')
})

test('L’id est nommé (bornIn ou owner) par une autre mission non archivée : pas listée tant que l’autre n’est pas archivée', { timeoutMs: 20000 }, async ($, on) => {
  const busy = { ...newRun('implement', T0 - 5_000, 'En cours'), owner: UUID } as Run
  const one = archived('Une', UUID)
  await cooWith($, on, [one, busy])
  expect(await statement($)).not.toContain('Discussions to close')
  expect(await coordinate($, { toClose: [UUID] })).toContain('none of these')
  // L'autre archivée à son tour : la discussion est listée.
  expect(discussionsToClose([one, { ...busy, status: 'done', archivedAt: T0 - 1_000 } as Run], [], COO_UUID).map(d => d.session)).toEqual([UUID])
})

test('bornIn et owner en forme et différents : bornIn, sous les deux lignes ci-dessus pour chacun', () => {
  const run = { ...archived('M', UUID), owner: UUID2 } as Run
  expect(discussionsToClose([run], [], COO_UUID).map(d => d.session)).toEqual([UUID])
  // owner est la discussion d'ici : rien du tout.
  expect(discussionsToClose([{ ...run, owner: COO_UUID } as Run], [], COO_UUID)).toEqual([])
  // owner nommé par une autre mission non archivée : rien.
  const other = { ...newRun('implement', T0, 'Autre'), owner: UUID2 } as Run
  expect(discussionsToClose([run, other], [], COO_UUID)).toEqual([])
})

test('Id de l’app (local_…) et COO au terminal, ou l’inverse : pas listée d’ici', { timeoutMs: 20000 }, async ($, on) => {
  await cooWith($, on, [archived('App', LOCAL)], [], COO_UUID)
  expect(await statement($)).not.toContain('Discussions to close')
  expect(await coordinate($, { toClose: [LOCAL] })).toContain('none of these')
  // L'inverse, en fonction pure : le COO dans l'app, une discussion du terminal.
  expect(discussionsToClose([archived('Terminal', UUID)], [], 'local_coo')).toEqual([])
  expect(discussionsToClose([archived('App', LOCAL)], [], 'local_coo').map(d => d.session)).toEqual([LOCAL])
})

test('Marque d’archivage absente ou hors forme : pas listée', { timeoutMs: 20000 }, async ($, on) => {
  const at = T0 - 10_000
  await cooWith($, on, [archived('Sans marque', UUID, at, null), archived('Autre valeur', UUID2, at, { by: 'reset', at }), archived('Autre date', COO_UUID, at, { by: 'clic', at: at - 1 })])
  expect(await statement($)).not.toContain('Discussions to close')
  expect(await coordinate($, { toClose: [UUID, UUID2, COO_UUID] })).toContain('none of these')
})

test('Trace de fermeture postérieure à l’archivage : pas listée', { timeoutMs: 20000 }, async ($, on) => {
  const run = archived('Fermée', UUID)
  const other = archived('Encore ouverte', UUID2)
  await cooWith($, on, [run, other], [trace(run.id, UUID, (run.archivedAt as number) + 5_000)])
  // Le fichier de coordination est bien lu : l'autre mission, sans trace, est listée ; celle qui a sa trace, non.
  const text = await statement($)
  expect(text).toContain(`(id de session ${UUID2})`)
  expect(text).not.toContain(`(id de session ${UUID})`)
  expect(await coordinate($, { toClose: [UUID] })).toContain('none of these')
})

test('Trace de fermeture antérieure à l’archivage (désarchivée, puis archivée de nouveau) : listée', { timeoutMs: 20000 }, async ($, on) => {
  const run = archived('Rearchivée', UUID)
  await cooWith($, on, [run], [trace(run.id, UUID, (run.archivedAt as number) - 1)])
  const text = await statement($)
  expect(text).toContain('Discussions to close')
  expect(text).toContain(`(id de session ${UUID})`)
})

test('une trace datée dans le futur, ou qui nomme une autre session, ne fait que retenir', () => {
  const run = archived('M', UUID)
  const at = run.archivedAt as number
  const future = soundEntry(trace(run.id, UUID, at + 10 ** 9)) as CoordEntry
  const other = soundEntry(trace(run.id, UUID2, at + 1)) as CoordEntry
  expect(discussionsToClose([run], [future], COO_UUID)).toEqual([])
  expect(discussionsToClose([run], [other], COO_UUID)).toEqual([])
  // Sans trace, listée ; une trace d'une autre mission ne la retient pas.
  expect(discussionsToClose([run], [], COO_UUID).length).toBe(1)
  expect(discussionsToClose([run], [soundEntry(trace('autre', UUID, at + 1)) as CoordEntry], COO_UUID).length).toBe(1)
  // Une trace mal formée (état inconnu, session hors forme) n'est pas une trace.
  expect(soundEntry(trace(run.id, UUID, at, 'fermée'))).toBeNull()
  expect(soundEntry(trace(run.id, 'pas-un-id', at))).toBeNull()
})

test('une discussion que nomme une mission archivée mais redevenue active, ou sans date d’archivage lisible, n’est jamais listée par une autre mission', () => {
  const sibling = archived('Sœur', UUID)
  const reopened = { ...archived('Reprise', undefined), status: 'active', owner: UUID } as Run
  expect(discussionsToClose([sibling, reopened], [], COO_UUID)).toEqual([])
  const odd = { ...newRun('implement', T0, 'Date illisible'), status: 'done', owner: UUID, archivedAt: null } as unknown as Run
  expect(discussionsToClose([sibling, odd], [], COO_UUID)).toEqual([])
  // Témoin : la sœur seule est listée.
  expect(discussionsToClose([sibling], [], COO_UUID).map(d => d.session)).toEqual([UUID])
})

test('une mission archivée à la fin de sa rétro : le texte cite le clic qui a lancé la rétro', () => {
  const list = discussionsToClose([archived('Étudiée', UUID, T0 - 10_000, { by: 'retro', at: T0 - 10_000 })], [], COO_UUID)
  expect(list[0]!.runs[0]!.by).toBe('retro')
  const text = missionSessionsArchiveText([{ title: '« Étudiée »', id: UUID, byRetro: true }], '/p') ?? ''
  expect(text).toContain('Mon clic d’archivage, ou celui qui a lancé sa rétro par sa carte, vaut mon accord pour fermer cette discussion')
  expect(text).toContain('en citant mon clic d’archivage, ou celui qui a lancé sa rétro, dans le tableau de bord comme mon accord')
})

test('une mission archivée mais redevenue active n’est jamais listée', () => {
  const run = { ...archived('Reprise', UUID), status: 'active' } as Run
  expect(discussionsToClose([run], [], COO_UUID)).toEqual([])
})

test('le relevé : la procédure du ticket 03, deux missions de la même discussion la nomment une fois', { timeoutMs: 20000 }, async ($, on) => {
  await cooWith($, on, [archived('Mission A', UUID), archived('Mission B', UUID), archived('Mission C', UUID2)])
  const text = await statement($)
  expect(text).toContain('Discussions to close (managers of archived missions), the procedure to follow now, written in French: ◆ COO')
  expect(text).toContain(`la discussion de la mission « Mission A » ou « Mission B » (id de session ${UUID})`)
  expect(text).toContain(`la discussion de la mission « Mission C » (id de session ${UUID2})`)
  expect(text.split(`(id de session ${UUID})`).length).toBe(2)
})

test('fichier de coordination illisible : pas de section, et le contrôle ne rend rien', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Mission A', UUID)])
  w.coord.unread = true
  expect(await statement($)).not.toContain('Discussions to close')
  expect(await coordinate($, { toClose: [UUID] })).toContain('Discussions still to close: none (the missions file or the coordination file could not be read')
})

test('de bout en bout : contrôle, compte rendu, trace ; la discussion n’est plus listée', { timeoutMs: 20000 }, async ($, on) => {
  const run = archived('Mission A', UUID)
  const { w } = await cooWith($, on, [run])
  const said = JSON.parse(await statement($)).context.join('\n') as string
  expect(said).toContain(`(id de session ${UUID})`)
  // Les appels que le texte dicte, rejoués tels quels : le contrôle, puis le compte rendu (gabarit rempli).
  const check = said.match(/\{"coordinate": \{"toClose": \[[^\]]*\]\}\}/)![0]
  expect(await coordinate($, JSON.parse(check).coordinate)).toContain(`Discussions still to close: "${UUID}"; close these only`)
  // Le contrôle ne rend que ce qui est encore à fermer.
  expect(await coordinate($, { toClose: [UUID, UUID2] })).toContain(`Discussions still to close: "${UUID}"; close these only`)
  const report = said.match(/\{"coordinate": \{"discussionsClosed": \[\{[^\]]*\]\}\}/)![0].replace('<id de session>', UUID).replace('<état>', 'closed').replace('<raison>', '')
  const out = await coordinate($, JSON.parse(report).coordinate)
  expect(out).toContain('Recorded: 1 discussion(s)')
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'discussion', run: run.id, session: UUID, state: 'closed' })])
  expect(entries(w)[0].at).toBeGreaterThanOrEqual(run.archivedAt as number)
  expect(await statement($)).not.toContain('Discussions to close')
  // Un second compte rendu : la discussion n'est plus à fermer, rien ne s'écrit.
  expect(await coordinate($, { discussionsClosed: [{ session: UUID, state: 'closed' }] })).toContain('Nothing is written')
  expect(entries(w).length).toBe(1)
})

test('une trace est datée au plus tôt de l’archivage qu’elle couvre : une horloge en retard ne la rend pas inopérante', { timeoutMs: 20000 }, async ($, on) => {
  const run = archived('En avance', UUID, T0 + 30_000)
  const { w } = await cooWith($, on, [run])
  expect(await coordinate($, { discussionsClosed: [{ session: UUID, state: 'absent' }] })).toContain('Recorded: 1')
  expect(entries(w)[0].at).toBeGreaterThanOrEqual(T0 + 30_000)
  expect(await coordinate($, { toClose: [UUID] })).toContain('none of these')
})

test('compte rendu : un état hors liste, ou un id que le contrôle ne rend pas, est refusé et rien ne s’écrit pour lui', { timeoutMs: 20000 }, async ($, on) => {
  const a = archived('Mission A', UUID)
  const { w } = await cooWith($, on, [a])
  const out = await coordinate($, { discussionsClosed: [{ session: UUID, state: 'fermée' }, { session: UUID2, state: 'closed' }, { session: 'x"; rm', state: 'closed' }] })
  expect(out).toContain('Nothing is written.')
  expect(out).toContain(`"${UUID}", "${UUID2}", an id out of form`)
  expect(out).not.toContain('rm -')
  expect(out).not.toContain('x"')
  expect(entries(w)).toEqual([])
  // Les deux champs ensemble : refusés.
  expect(await coordinate($, { toClose: [UUID], discussionsClosed: [{ session: UUID, state: 'absent' }] })).toContain('Refused, nothing of this call applied')
  // Mêlés à une autre consigne : refusés en entier, l'autre consigne non plus appliquée.
  expect(await coordinate($, { toClose: [UUID], decisionsSeen: true })).toContain('Refused, nothing of this call applied')
  expect(await coordinate($, { discussionsClosed: [{ session: UUID, state: 'closed' }], gleanedExisting: true })).toContain('Refused, nothing of this call applied')
  expect(entries(w)).toEqual([])
  // Envoyée deux fois : la première compte, la seconde est dite telle.
  const twice = await coordinate($, { discussionsClosed: [{ session: UUID, state: 'closed' }, { session: UUID, state: 'stopped' }] })
  expect(twice).toContain('Recorded: 1 discussion(s)')
  expect(twice).toContain(`"${UUID}" (sent twice: the first one counts)`)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'discussion', session: UUID, state: 'closed' })])
})

test('sans compte rendu (tour interrompu), la discussion revient au relevé suivant ; rendue « absente » alors, elle n’y revient plus', { timeoutMs: 20000 }, async ($, on) => {
  await cooWith($, on, [archived('Mission A', UUID)])
  await coordinate($, { toClose: [UUID] })
  expect(await statement($)).toContain(`(id de session ${UUID})`)
  expect(await coordinate($, { discussionsClosed: [{ session: UUID, state: 'absent', why: 'introuvable au terminal' }] })).toContain('Recorded')
  expect(await statement($)).not.toContain('Discussions to close')
})

test('écriture de la trace refusée : « rien n’est écrit », et la discussion revient au relevé suivant', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Mission A', UUID)])
  // La relecture du contrôle passe, celle de l'écriture trouve le fichier illisible.
  let reads = 0
  w.probe.onCoordRead = () => {
    reads += 1
    if (reads === 2) w.coord.unread = true
  }
  const out = await coordinate($, { discussionsClosed: [{ session: UUID, state: 'closed' }] })
  w.probe.onCoordRead = undefined
  expect(out).toContain('Nothing is written')
  expect(out).toContain('These discussions come back at the next statement.')
})

test('hors du siège : le contrôle ne rend rien, et rien ne s’écrit', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await cooWith($, on, [archived('Mission A', UUID)])
  writeBoard(w, x => ({ ...x, coo: { by: 'session-B', at: T0 + 7_000, seenAt: T0 + 7_000 } }))
  expect(await coordinate($, { toClose: [UUID] })).toContain('none (')
  expect(await coordinate($, { discussionsClosed: [{ session: UUID, state: 'closed' }] })).toContain('Nothing is written')
  expect(entries(w)).toEqual([])
})

test('une trace part avec sa mission effacée ; une écriture qui ne connaît pas son genre la garde', () => {
  const t = trace('m1', UUID, T0)
  expect(withoutGone([t], id => id === 'm1')).toEqual([])
  expect(withoutGone([t], () => false)).toEqual([t])
  // Une écriture d'une version qui ignore le genre : la trace reste, sinon l'écriture est refusée.
  const unknown = { ...t, kind: 'discussion', extra: 'champ d’une version future' }
  expect(keepsEntries([t, unknown], [t, unknown, { id: 'cnouveau1', kind: 'gleaned', run: 'm2', at: T0 }], () => false)).toBe(true)
  expect(keepsEntries([t], [], () => false)).toBe(false)
})

test('les deux copies du fichier des missions doivent lister la discussion : un archivage pas encore écrit, ou une reprise que la copie d’ici ne voit pas, ne fait rien fermer', () => {
  const x = archived('X', UUID)
  const notArchived = { ...x, archivedAt: undefined, archivedBy: undefined, status: 'done' } as Run
  const resumed = { ...x, archivedAt: undefined, archivedBy: undefined, status: 'active', owner: UUID } as Run
  // Témoin : listée des deux côtés.
  expect(discussionsToCloseBoth([x], [x], [], COO_UUID).map(d => d.session)).toEqual([UUID])
  // Archivée ici seulement (sauvegarde pas encore écrite) : rien.
  expect(discussionsToCloseBoth([x], [notArchived], [], COO_UUID)).toEqual([])
  // Reprise dans le fichier, pas encore vue ici : rien.
  expect(discussionsToCloseBoth([x], [resumed], [], COO_UUID)).toEqual([])
  // Fichier commun illisible : rien.
  expect(discussionsToCloseBoth([x], null, [], COO_UUID)).toEqual([])
  // La date gardée est la plus récente des deux copies.
  const later = { ...x, archivedAt: (x.archivedAt as number) + 5_000, archivedBy: { by: 'clic', at: (x.archivedAt as number) + 5_000 } } as Run
  expect(discussionsToCloseBoth([x], [later], [], COO_UUID)[0]!.runs[0]!.at).toBe((x.archivedAt as number) + 5_000)
})

test('le relevé d’une mission archivée à la fin de sa rétro cite le clic qui a lancé la rétro', { timeoutMs: 20000 }, async ($, on) => {
  const at = T0 - 10_000
  await cooWith($, on, [archived('Étudiée', UUID, at, { by: 'retro', at })])
  const text = await statement($)
  expect(text).toContain('Mon clic d’archivage, ou celui qui a lancé sa rétro par sa carte, vaut mon accord pour fermer cette discussion')
})

// La remise d'une discussion encore au travail : l'état « postponed » du compte rendu des fermetures n'écrit aucune
// trace, la discussion reste à fermer, et elle quitte la tête du relevé jusqu'au message suivant de la personne.
test('compte rendu « postponed », rejoué d’après la tâche en tête : aucune trace, la discussion reste à fermer, nommée hors de la tête ; le message de la personne la redonne', { timeoutMs: 20000 }, async ($, on) => {
  const run = archived('Mission A', UUID)
  const { w, clock } = await cooWith($, on, [run])
  const said = await openCoo($, clock)
  expect(said).toMatch(/Tidy-up task « fermetures »/)
  const report = said.match(/\{"coordinate": \{"discussionsClosed": \[\{[^\]]*\]\}\}/)![0].replace('<id de session>', UUID).replace('<état>', 'postponed').replace('<raison>', '')
  const out = await coordinate($, JSON.parse(report).coordinate)
  expect(out).toContain(`Postponed, nothing written: "${UUID}"; each stays to close`)
  expect(entries(w)).toEqual([])
  expect(await coordinate($, { toClose: [UUID] })).toContain(`Discussions still to close: "${UUID}"`)
  // Deux fois : sans effet de plus. Un id inconnu : refusé, rien n'est retenu.
  expect(await coordinate($, { discussionsClosed: [{ session: UUID, state: 'postponed' }] })).toContain('Postponed, nothing written')
  expect(await coordinate($, { discussionsClosed: [{ session: UUID2, state: 'postponed' }] })).toContain(`Refused, nothing written for them (a state outside closed, stopped, app, absent, postponed`)
  expect(await coordinate($, { discussionsClosed: [{ session: 'x"; rm -rf ~', state: 'postponed' }] })).toContain('an id out of form')
  expect(entries(w)).toEqual([])
  const later = await openCoo($, clock)
  expect(later).not.toMatch(/Tidy-up task « fermetures »/)
  expect(later).toMatch(/Postponed by you, still due and not given at the head \(1\): the discussion of « Mission A » \(session id « 0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e »\)/)
  // Le message tapé par la personne lève la remise : la fermeture revient en tête.
  expect(await statement($)).toMatch(/Tidy-up task « fermetures »/)
})
