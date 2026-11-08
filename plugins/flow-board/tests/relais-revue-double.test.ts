// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { REPEATED_REVIEW, applyRelay, isRepeatedReview, parseRelayEntryFile, reportedCounts, reviewPrint } from '../hooks/relay.ts'
import type { Relay, RelayEntry } from '../types'
import { TOOL, start, world } from './monde-coordination.ts'

// Une revue envoyée deux fois au relais (une reprise, un doute sur la réception) avait doublé les comptes de trois
// groupes. Invariant : une revue n'est jamais comptée deux fois pour un même envoi, et une revue réelle n'est
// jamais perdue. Une revue identique, reçue sans qu'aucun ticket ait changé de statut entre-temps, est ignorée.

const RUN = 'run-w'
const REVIEW = { standards: 1, spec: 2, fixed: 1 }

/** Le relais de la session `fa` après un départ et des signaux, chacun à son heure. */
const relayAfter = (events: Parameters<typeof applyRelay>[3][]): Relay => {
  let relay = applyRelay(undefined, RUN, 'fa', { kind: 'start', group: 'A' }, 1_000)!
  events.forEach((event, i) => {
    relay = applyRelay(relay, RUN, 'fa', event, 2_000 + i * 100) ?? relay
  })
  return relay
}
const reviews = (relay: Relay) => relay.sessions.fa!.reviews

// ─── La règle, sur l'entrée ───────────────────────────────────────

test('deux revues identiques sans changement de ticket entre elles : reconnues, l’empreinte gardée à la première', () => {
  const relay = relayAfter([{ kind: 'tickets', changes: [{ id: 't1', status: 'doing' }] }, { kind: 'counts', review: REVIEW }])
  const entry = relay.sessions.fa!
  expect(entry.reviewPrint).toBe(reviewPrint(entry, REVIEW))
  expect(isRepeatedReview(entry, REVIEW)).toBe(true)
  // D'autres comptes, un compte facultatif en plus (absent n'est pas 0) : une autre revue.
  expect(isRepeatedReview(entry, { ...REVIEW, fixed: 2 })).toBe(false)
  expect(isRepeatedReview(entry, { ...REVIEW, bugs: 0 })).toBe(false)
})

test('deux revues identiques séparées par un changement de statut d’un ticket : deux revues', () => {
  const relay = relayAfter([
    { kind: 'tickets', changes: [{ id: 't1', status: 'doing' }] },
    { kind: 'counts', review: REVIEW },
    { kind: 'tickets', changes: [{ id: 't1', status: 'done' }, { id: 't2', status: 'doing' }] },
  ])
  expect(isRepeatedReview(relay.sessions.fa!, REVIEW)).toBe(false)
  const after = applyRelay(relay, RUN, 'fa', { kind: 'counts', review: REVIEW }, 3_000)!
  expect(reviews(after)).toMatchObject({ count: 2, standards: 2, spec: 4, fixed: 2 })
})

test('une revue lancée (/code-review) entre deux envois identiques : deux revues (la passe high d’après la passe « bogues »)', () => {
  const bugs = { standards: 0, spec: 0, fixed: 1, bugs: 2 }
  const relay = relayAfter([
    { kind: 'tickets', changes: [{ id: 't1', status: 'doing' }] },
    { kind: 'review' },
    { kind: 'counts', review: bugs },
    { kind: 'review' },
  ])
  expect(isRepeatedReview(relay.sessions.fa!, bugs)).toBe(false)
  const after = applyRelay(relay, RUN, 'fa', { kind: 'counts', review: bugs }, 3_000)!
  expect(reviews(after)).toMatchObject({ count: 2, fixed: 2, bugs: 4 })
})

test('un ticket qui change de statut puis revient au précédent : la revue suivante compte ; une raison seule changée ne la fait pas compter', () => {
  const back = relayAfter([
    { kind: 'tickets', changes: [{ id: 't1', status: 'doing' }] },
    { kind: 'counts', review: REVIEW },
    { kind: 'tickets', changes: [{ id: 't1', status: 'done' }] },
    { kind: 'tickets', changes: [{ id: 't1', status: 'doing' }] },
  ])
  expect(isRepeatedReview(back.sessions.fa!, REVIEW)).toBe(false)
  const why = relayAfter([
    { kind: 'tickets', changes: [{ id: 't1', status: 'blocked', why: 'attend A' }] },
    { kind: 'counts', review: REVIEW },
    { kind: 'tickets', changes: [{ id: 't1', status: 'blocked', why: 'attend B' }] },
  ])
  expect(isRepeatedReview(why.sessions.fa!, REVIEW)).toBe(true)
})

test('l’empreinte se relit telle qu’écrite : le fichier de l’entrée la garde', () => {
  const entry = relayAfter([{ kind: 'counts', review: REVIEW }]).sessions.fa!
  const read = parseRelayEntryFile(JSON.parse(JSON.stringify({ v: 1, run: RUN, session: 'fa', entry })), RUN)
  expect(read?.entry.reviewPrint).toBe(entry.reviewPrint)
  expect(isRepeatedReview(read?.entry, REVIEW)).toBe(true)
})

test('une empreinte absente ou illisible ne fait rien ignorer : la revue est comptée', () => {
  const relay = relayAfter([{ kind: 'counts', review: REVIEW }])
  const entry = relay.sessions.fa!
  for (const print of [undefined, 12, null, { counts: [] }, ['x'], 'pas du json', '{"counts":1}', '[]', '{"counts":[],"tickets":[],"ticket":3}']) {
    const forged = { ...entry, reviewPrint: print } as unknown as RelayEntry
    expect(isRepeatedReview(forged, REVIEW)).toBe(false)
  }
  expect(isRepeatedReview(undefined, REVIEW)).toBe(false)
  // Une empreinte restée seule, sans comptes gardés (une entrée réécrite à la main) : la revue est comptée.
  const { reviews: _gone, ...bare } = entry
  expect(isRepeatedReview(bare as RelayEntry, REVIEW)).toBe(false)
})

// ─── Dans le mod d'un worker : la réponse, et les comptes du relais ────────────

/** L'entrée de relais de cette session, telle qu'écrite (fichier ou store). */
const ownEntry = (w: ReturnType<typeof world>): RelayEntry | undefined => {
  const file = Object.entries(w.files).find(([path]) => path.endsWith('.entry.json'))?.[1]
  if (file !== undefined) return JSON.parse(file).entry
  const key = Object.keys(w.mem).find(k => k.startsWith(`relay:${RUN}:`))
  return key ? (w.mem[key] as { entry: RelayEntry }).entry : undefined
}
const text = (out: any): string => String(out?.result ?? '')

test('dans un worker : la revue renvoyée telle quelle n’est pas recomptée et la réponse le dit ; après un changement de ticket, elle compte', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: 900_000_000 })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: RUN, group: 'A', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 't1', status: 'doing' }] } as any)
  expect(text(await $.tool.call({ tool: TOOL, review: REVIEW } as any))).not.toContain(REPEATED_REVIEW)
  expect(ownEntry(w)?.reviews).toMatchObject({ count: 1, standards: 1, spec: 2, fixed: 1 })
  const at = ownEntry(w)!.at
  // Le même envoi, après une reprise : ignoré, rien n'est réécrit (ni comptes ni date).
  const repeat = text(await $.tool.call({ tool: TOOL, review: REVIEW } as any))
  expect(repeat).toContain(REPEATED_REVIEW)
  // Elle ne se dit ni relayée ni perdue (rien à renvoyer).
  expect(repeat).not.toContain('Relayed to the manager’s dashboard: the review findings')
  expect(repeat).not.toContain("Relayed to the manager's dashboard: the review findings")
  expect(repeat).not.toContain('NOT kept in the relay')
  expect(ownEntry(w)?.reviews).toMatchObject({ count: 1, standards: 1, spec: 2, fixed: 1 })
  expect(ownEntry(w)!.at).toBe(at)
  // Avec une revue de sécurité dans le même appel : seule la revue est laissée de côté, l'avis est gardé.
  expect(text(await $.tool.call({ tool: TOOL, review: REVIEW, security: { group: 'A', advised: false, why: 'texte seul' } } as any))).toContain(REPEATED_REVIEW)
  expect(ownEntry(w)?.security).toMatchObject({ advised: false })
  expect(ownEntry(w)?.reviews).toMatchObject({ count: 1 })
  // Un ticket change de statut : la même revue est une nouvelle revue (celle d'un autre ticket).
  await $.tool.call({ tool: TOOL, set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'doing' }] } as any)
  expect(text(await $.tool.call({ tool: TOOL, review: REVIEW } as any))).not.toContain(REPEATED_REVIEW)
  expect(ownEntry(w)?.reviews).toMatchObject({ count: 2, standards: 2, spec: 4, fixed: 2 })
})

// ─── Le ticket relu : deux revues de tickets différents ne se confondent jamais ────────────

test('deux revues de tickets différents aux mêmes comptes, sans changement de statut entre elles : deux revues ; le même ticket renvoyé : une seule', () => {
  const zero = { standards: 0, spec: 0, fixed: 0 }
  // La revue de t1 part avec son « done », t2 était déjà en cours : la revue de t2 arrive sans changement de statut.
  const relay = relayAfter([
    { kind: 'tickets', changes: [{ id: 't2', status: 'doing' }] },
    { kind: 'tickets', changes: [{ id: 't1', status: 'done' }] },
    { kind: 'counts', review: { ...zero, ticket: 't1' } },
  ])
  const entry = relay.sessions.fa!
  expect(isRepeatedReview(entry, { ...zero, ticket: 't2' })).toBe(false)
  expect(isRepeatedReview(entry, { ...zero, ticket: 't1' })).toBe(true)
  // Le même envoi renvoyé sans son ticket (de mémoire, après une reprise) : le même, jamais recompté.
  expect(isRepeatedReview(entry, zero)).toBe(true)
  // Et l'inverse : une revue comptée sans ticket, renvoyée avec un ticket.
  const bare = relayAfter([{ kind: 'tickets', changes: [{ id: 't1', status: 'doing' }] }, { kind: 'counts', review: zero }]).sessions.fa!
  expect(isRepeatedReview(bare, { ...zero, ticket: 't1' })).toBe(true)
  const after = applyRelay(relay, RUN, 'fa', { kind: 'counts', review: { ...zero, ticket: 't2' } }, 3_000)!
  expect(reviews(after)).toEqual({ count: 2, standards: 0, spec: 0, fixed: 0 })
})

test('le ticket relu part avec la revue (un texte ou un nombre, pris en entier), jamais compté ; hors forme ou au-delà de 200 signes, il ne part pas et la revue part quand même', () => {
  expect(reportedCounts({ review: { spec: 1, ticket: ' t2 ' } }).review).toEqual({ standards: 0, spec: 1, fixed: 0, ticket: 't2' })
  expect(reportedCounts({ review: { spec: 1, ticket: 27 } }).review?.ticket).toBe('27')
  // Pris en entier, jamais coupé : deux ids au même début restent deux tickets ; au-delà de 200 signes, il ne part pas.
  const long = `${'refonte-du-relais-des-revues-en-double-'.repeat(2)}partie-1`
  expect(reportedCounts({ review: { spec: 1, ticket: long } }).review?.ticket).toBe(long)
  expect(reportedCounts({ review: { spec: 1, ticket: '  t  1 ' } }).review?.ticket).toBe('t 1')
  expect(reportedCounts({ review: { spec: 1, ticket: 'x'.repeat(201) } }).review).toEqual({ standards: 0, spec: 1, fixed: 0 })
  const twin = relayAfter([{ kind: 'counts', review: { standards: 0, spec: 1, fixed: 0, ticket: long } }]).sessions.fa!
  expect(isRepeatedReview(twin, { standards: 0, spec: 1, fixed: 0, ticket: long.replace('partie-1', 'partie-2') })).toBe(false)
  for (const bad of [null, '', '  ', {}, ['t1'], Number.NaN, true]) expect(reportedCounts({ review: { spec: 1, ticket: bad } }).review).toEqual({ standards: 0, spec: 1, fixed: 0 })
  const relay = applyRelay(undefined, RUN, 'fa', { kind: 'counts', review: { standards: 0, spec: 1, fixed: 0, ticket: 't2' } }, 1_000)!
  expect(relay.sessions.fa!.reviews).toEqual({ count: 1, standards: 0, spec: 1, fixed: 0 })
})

test('dans un worker : une revue renvoyée avec un autre ticket compte ; après un /code-review lancé, la même revue compte ; la réponse donne le recours', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: 900_000_000 })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: RUN, group: 'A', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'doing' }] } as any)
  await $.tool.call({ tool: TOOL, review: { ...REVIEW, ticket: 't1' } } as any)
  // La revue de t2 envoyée sous le ticket de t1, aux mêmes comptes : prise pour la même ; la réponse dit de la renvoyer avec "ticket".
  const aside = text(await $.tool.call({ tool: TOOL, review: { ...REVIEW, ticket: 't1' } } as any))
  expect(aside).toContain(REPEATED_REVIEW)
  expect(aside).toContain('renvoie-la avec "ticket"')
  expect(ownEntry(w)?.reviews).toMatchObject({ count: 1 })
  expect(text(await $.tool.call({ tool: TOOL, review: { ...REVIEW, ticket: 't2' } } as any))).not.toContain(REPEATED_REVIEW)
  expect(ownEntry(w)?.reviews).toMatchObject({ count: 2, standards: 2, spec: 4, fixed: 2 })
  // La passe high d'après les correctifs, lancée par /code-review, aux mêmes comptes que la précédente : comptée.
  await $.skill.prompt({ skill: 'code-review', text: 'x' })
  expect(text(await $.tool.call({ tool: TOOL, review: { ...REVIEW, ticket: 't2' } } as any))).not.toContain(REPEATED_REVIEW)
  expect(ownEntry(w)?.reviews).toMatchObject({ count: 3 })
})

test('dans un worker : une revue renvoyée avec un compte de bogues hors forme ne se dit pas relayée ; avec un avis de sécurité refusé, seul l’avis se dit perdu, sans faire renvoyer la revue', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: 900_000_000 })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: RUN, group: 'A', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 't1', status: 'doing' }] } as any)
  await $.tool.call({ tool: TOOL, review: REVIEW, security: { group: 'A', advised: true, findings: 2, fixed: 1 } } as any)
  const bugs = text(await $.tool.call({ tool: TOOL, review: { ...REVIEW, bugs: '3' } } as any))
  expect(bugs).toContain(REPEATED_REVIEW)
  expect(bugs).not.toContain('the rest of this review is relayed')
  expect(bugs).not.toContain('NOT kept in the relay')
  expect(ownEntry(w)?.reviews).toMatchObject({ count: 1 })
  // Un compte de sécurité gardé illisible (l'entrée modifiée à la main) : l'avis du même appel est refusé.
  const path = Object.keys(w.files).find(p => p.endsWith('.entry.json'))
  if (path !== undefined) {
    const file = JSON.parse(w.files[path]!)
    file.entry.security.findings = 'deux'
    w.files[path] = JSON.stringify(file)
  } else {
    const key = Object.keys(w.mem).find(k => k.startsWith(`relay:${RUN}:`))!
    ;(w.mem[key] as { entry: RelayEntry }).entry.security!.findings = 'deux' as unknown as number
  }
  const both = text(await $.tool.call({ tool: TOOL, review: REVIEW, security: { group: 'A', findings: 2, fixed: 2 } } as any))
  expect(both).toContain(REPEATED_REVIEW)
  expect(both).toContain('NOT kept in the relay: the security review')
  expect(both).not.toContain('the review findings (')
  expect(both).not.toMatch(/send (it|them) again in a new call/)
  expect(ownEntry(w)?.reviews).toMatchObject({ count: 1 })
})

test('dans un worker : une revue déjà comptée, renvoyée quand un compte gardé est devenu illisible, est laissée de côté avant tout refus : rien ne la fait renvoyer autrement ni redonner au compte rendu', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: 900_000_000 })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: RUN, group: 'A', main: '[abc123]' } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 't1', status: 'doing' }] } as any)
  const sent = { ...REVIEW, bugs: 2, ticket: 't1' }
  await $.tool.call({ tool: TOOL, review: sent } as any)
  // L'entrée modifiée à la main : le compte de bogues n'est plus un compte.
  const path = Object.keys(w.files).find(p => p.endsWith('.entry.json'))
  if (path !== undefined) {
    const file = JSON.parse(w.files[path]!)
    file.entry.reviews.bugs = 'deux'
    w.files[path] = JSON.stringify(file)
  } else {
    const key = Object.keys(w.mem).find(k => k.startsWith(`relay:${RUN}:`))!
    ;(w.mem[key] as { entry: RelayEntry }).entry.reviews!.bugs = 'deux' as unknown as number
  }
  const again = text(await $.tool.call({ tool: TOOL, review: sent } as any))
  expect(again).toContain(REPEATED_REVIEW)
  expect(again).not.toContain('without "bugs"')
  expect(again).not.toContain('NOT kept in the relay')
  expect(ownEntry(w)?.reviews).toMatchObject({ count: 1, standards: 1, spec: 2, fixed: 1 })
})
