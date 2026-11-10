import { expect, test } from 'claude-code/testing'

import { NIGHT_LOG_MAX, NIGHT_MS, appendNightLog, isPersonOrigin, isSeatGap, isTypedOrigin, newNightWatch, nightLogOf, nightOff, nightValidity, parseNight, parseNightLog, type NightRead } from '../hooks/night.ts'

// L'état de la surveillance de nuit, par les fonctions exportées de `hooks/night.ts`.
// Invariant : « Hors d'une surveillance allumée par Mathis et encore valide, aucun geste ne part sans son
// clic ; pendant la surveillance, seul un geste de la liste fermée part, une seule fois, et une lecture ratée de
// la surveillance vaut éteinte. »

const T0 = 1_800_000_000_000
const ROOT = '/projet'
const ID = 'nabcdefgh12'
const watch = newNightWatch(ID, ROOT, 'session-A', T0 - 60_000, T0, 'click')
const read: NightRead = { state: 'read', watch }
const seat = (by = 'session-A', at = T0 - 60_000, seenAt = T0) => ({ by, at, seenAt })

test('une surveillance lue, au même id, avant sa fin, siège tenu par la même prise : elle vaut', () => {
  expect(nightValidity(read, seat(), T0 + 60_000, ID)).toEqual({ ok: true, watch })
  // Sans id demandé (la vue, le relevé) : la même.
  expect(nightValidity(read, seat(), T0 + 60_000).ok).toBe(true)
})

test('absente ou illisible : éteinte', () => {
  expect(nightValidity({ state: 'absent' }, seat(), T0, ID)).toEqual({ ok: false, why: 'absent' })
  expect(nightValidity({ state: 'unread', why: 'x' }, seat(), T0, ID)).toEqual({ ok: false, why: 'unread' })
  // Un texte coupé, un autre projet, une forme fausse : illisible.
  expect(parseNight('{"v":1,"id"', ROOT).state).toBe('unread')
  expect(parseNight(JSON.stringify(watch), '/autre').state).toBe('unread')
  expect(parseNight(JSON.stringify({ ...watch, by: 'a b' }), ROOT).state).toBe('unread')
  expect(parseNight(JSON.stringify(watch), ROOT)).toEqual(read)
})

test('arrêtée : éteinte, avec la dernière surveillance et la cause de l’arrêt', () => {
  const off = parseNight(JSON.stringify(nightOff(ROOT, ID, T0, 'person')), ROOT)
  expect(off).toEqual({ state: 'off', last: { id: ID, at: T0, why: 'person' } })
  expect(nightValidity(off, seat(), T0, ID)).toEqual({ ok: false, why: 'absent' })
  expect(parseNight(JSON.stringify({ v: 1, root: ROOT, off: { id: ID, at: T0, why: 'autre' } }), ROOT).state).toBe('unread')
})

test('un geste d’une autre surveillance ne vaut pas', () => {
  expect(nightValidity(read, seat(), T0, 'nzzzzzzzz99')).toEqual({ ok: false, why: 'other-id' })
})

test('l’heure de fin passée : éteinte, même au plus juste', () => {
  expect(nightValidity(read, seat('session-A', T0 - 60_000, T0 + NIGHT_MS - 1000), T0 + NIGHT_MS, ID)).toEqual({ ok: false, why: 'ended' })
  expect(nightValidity(read, seat('session-A', T0 - 60_000, T0 + NIGHT_MS - 2000), T0 + NIGHT_MS - 1, ID).ok).toBe(true)
})

test('une date d’allumage au-delà d’une minute dans le futur, ou une fin au-delà de 12 heures : éteinte', () => {
  expect(nightValidity(read, seat(), T0 - 61_000, ID)).toEqual({ ok: false, why: 'future' })
  // Un siège vu « dans le futur » ne se périmerait pas : éteinte.
  expect(nightValidity(read, seat('session-A', T0 - 60_000, T0 + 5 * 60_000), T0, ID)).toEqual({ ok: false, why: 'future' })
  expect(parseNight(JSON.stringify({ ...watch, until: watch.at + NIGHT_MS + 1 }), ROOT).state).toBe('unread')
  expect(parseNight(JSON.stringify({ ...watch, until: watch.at }), ROOT).state).toBe('unread')
})

test('le siège tenu par une autre discussion, libre, repris depuis, ou muet depuis plus de 10 minutes : éteinte', () => {
  expect(nightValidity(read, seat('session-B'), T0, ID)).toEqual({ ok: false, why: 'seat-other' })
  expect(nightValidity(read, { ...seat(), releasedAt: T0 }, T0, ID)).toEqual({ ok: false, why: 'seat-free' })
  expect(nightValidity(read, undefined, T0, ID)).toEqual({ ok: false, why: 'seat-free' })
  // « ↻ Reprendre ici » par la même discussion : une prise neuve, qui ne réanime pas la surveillance.
  expect(nightValidity(read, seat('session-A', T0 + 1000, T0 + 1000), T0 + 2000, ID)).toEqual({ ok: false, why: 'seat-retaken' })
  expect(nightValidity(read, seat('session-A', T0 - 60_000, T0), T0 + 10 * 60_000 + 1, ID)).toEqual({ ok: false, why: 'seat-stale' })
})

test('un siège muet plus de 10 minutes (plantage, veille) : son titulaire arrête d’abord sa surveillance', () => {
  expect(isSeatGap(seat('session-A', T0 - 60_000, T0), T0 + 10 * 60_000)).toBe(false)
  expect(isSeatGap(seat('session-A', T0 - 60_000, T0), T0 + 10 * 60_000 + 1)).toBe(true)
  expect(isSeatGap(undefined, T0)).toBe(false)
})

test('qui arrête la surveillance : un message de la personne, jamais un tour d’un mod, d’une autre session ou une notification', () => {
  for (const kind of ['composer', 'bridge', 'sdk', 'slack-ping', 'unclassified', 'inconnue']) expect(isPersonOrigin({ kind })).toBe(true)
  expect(isPersonOrigin(undefined)).toBe(true)
  expect(isPersonOrigin({ kind: 'plugin', name: 'flow-board', asUser: true })).toBe(true)
  for (const o of [{ kind: 'plugin', name: 'flow-board' }, { kind: 'peer' }, { kind: 'peer-send-message' }, { kind: 'task-notification' }]) expect(isPersonOrigin(o)).toBe(false)
})

test('qui allume par la commande : seulement un message tapé, jamais un mod', () => {
  for (const kind of ['composer', 'bridge', 'sdk']) expect(isTypedOrigin({ kind })).toBe(true)
  for (const o of [{ kind: 'plugin', name: 'flow-board', asUser: true }, { kind: 'peer' }, { kind: 'task-notification' }, { kind: 'unclassified' }, undefined]) expect(isTypedOrigin(o)).toBe(false)
})

test('le journal est borné : les plus anciennes lignes sortent, une à une', () => {
  let lines: string[] = []
  for (let i = 0; i < 5; i++) lines = appendNightLog(lines, { at: T0 + i, watch: ID, act: 'wave', why: `w${i}`, result: 'ok' }, 3)
  expect(lines.map(l => JSON.parse(l).why)).toEqual(['w2', 'w3', 'w4'])
  expect(NIGHT_LOG_MAX).toBe(2000)
  expect(nightLogOf(lines, ID).map(l => l.why)).toEqual(['w2', 'w3', 'w4'])
  expect(nightLogOf(lines, 'nautreid000')).toEqual([])
})

test('un journal dont une ligne est coupée est illisible : il ne se réécrit pas', () => {
  expect(parseNightLog('{"at":1}\n{"at":2,"wat')).toEqual({ state: 'unread' })
  expect(parseNightLog('')).toEqual({ state: 'read', lines: [] })
  expect(parseNightLog('{"at":1}\n\n{"at":2}\n')).toEqual({ state: 'read', lines: ['{"at":1}', '{"at":2}'] })
})
