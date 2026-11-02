import { describe, expect, test } from 'claude-code/testing'

import { canonicalModel, estimateUnknown, priceOf } from '../hooks/pricing.ts'
import { OUTSIDE, activeMs, attachAgent, costed, endLane, endTurn, endWait, extraMs, median, netSpans, noteTasks, openRequest, parallelPieces, recordCall, relaunchOwner, requestFile, startLane, startTurn, startWait, waitMsOf, withOpenLanes } from '../hooks/requests.ts'
import type { Tracker } from '../types'

const usage = (input: number, output: number, cacheWrite: number, cacheRead: number) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead })
const cents = (n: number | null) => (n === null ? null : Math.round(n * 1e6) / 1e4)

describe('tarifs', () => {
  test('coût d’un appel au tarif de son modèle, cache écrit à 2× l’entrée', async () => {
    // Opus 5.5 : 4 $ en entrée, 20 $ en sortie, 0,20 $ en cache lu, 8 $ en cache écrit, par million.
    // 0,004 + 0,04 + 0,08 + 0,02 = 0,144 $.
    expect(cents(priceOf('claude-opus-5-5', usage(1000, 2000, 10_000, 100_000)))).toBe(14.4)
    // Fable 5.1 : cache lu à 0,25 $ ; Fable 5 : à 1 $.
    expect(cents(priceOf('claude-fable-5-1', usage(0, 0, 0, 1_000_000)))).toBe(25)
    expect(cents(priceOf('claude-fable-5', usage(0, 0, 0, 1_000_000)))).toBe(100)
    // Opus 4.8 : 5 $ / 25 $, cache lu à 0,1×.
    expect(cents(priceOf('claude-opus-4-8', usage(1_000_000, 0, 0, 1_000_000)))).toBe(550)
    // Haiku 4.5 : 1 $ / 5 $ ; Sonnet 4.6 : 3 $ / 15 $.
    expect(cents(priceOf('claude-haiku-4-5-20251001', usage(1_000_000, 1_000_000, 0, 0)))).toBe(600)
    expect(cents(priceOf('claude-sonnet-4-6', usage(0, 1_000_000, 0, 0)))).toBe(1500)
  })

  test('Haiku 5.5 : deux paliers selon la taille du prompt', async () => {
    // 100 000 tokens de prompt au plus : 0,10 $ / 0,50 $.
    expect(cents(priceOf('claude-haiku-5-5', usage(100_000, 1_000_000, 0, 0)))).toBe(51)
    // Au-delà (cache lu compris) : 0,50 $ / 2,50 $, cache lu à 0,05 $.
    expect(cents(priceOf('claude-haiku-5-5', usage(1000, 0, 0, 200_000)))).toBe(1.05)
  })

  test('correspondance des identifiants : alias, [1m], date, fournisseur', async () => {
    expect(canonicalModel('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
    expect(canonicalModel('opus')).toBe('claude-opus-5-5')
    expect(canonicalModel('haiku')).toBe('claude-haiku-5-5')
    expect(canonicalModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
    expect(canonicalModel('us.anthropic.claude-sonnet-5-5-v1:0')).toBe('claude-sonnet-5-5')
    expect(cents(priceOf('claude-opus-5-5[1m]', usage(1_000_000, 0, 0, 0)))).toBe(400)
  })

  test('un modèle absent de la table n’a pas de prix, et s’estime au prorata du reste de la session', async () => {
    expect(priceOf('claude-opus-4-5-20251101', usage(1, 1, 1, 1))).toBeNull()
    expect(priceOf('claude-3-5-sonnet-20241022', usage(1, 1, 1, 1))).toBeNull()
    // 10 $ de session, 4 $ chiffrés : 6 $ répartis 1 pour 2.
    expect(estimateUnknown(10, 4, [100, 200])).toEqual([2, 4])
    // Coût de la session inconnu ou déjà couvert : rien à répartir.
    expect(estimateUnknown(null, 4, [100])).toEqual([0])
    expect(estimateUnknown(3, 4, [100])).toEqual([0])
  })
})

describe('requêtes', () => {
  const T0 = Date.UTC(2026, 9, 26, 14, 0, 0)
  const empty: Tracker = { log: null, current: null, turns: {} }
  const call = (model: string, u = usage(1000, 2000, 10_000, 100_000)) => ({ model, usage: u, apiMs: 4000, genMs: 3000 })

  test('médiane et temps actif sans double compte', async () => {
    expect(median([])).toBeNull()
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    // [0, 10] et [5, 20] se chevauchent ; [30, 40] est à part : 20 + 10.
    expect(activeMs([[0, 10], [30, 40], [5, 20]])).toBe(30)
    expect(activeMs([])).toBe(0)
  })

  test('les attentes de l’utilisateur sortent des morceaux actifs, sauf les appels pendant ce temps', async () => {
    // [0, 100], une question de 20 à 60, un spécialiste appelé de 30 à 35 : 20 + 5 + 40.
    expect(netSpans({ sentAt: 0, waits: [[20, 60]], busy: [[30, 35]] }, 100)).toEqual([[0, 20], [30, 35], [60, 100]])
    // Une attente restée ouverte va jusqu'à la fin donnée, jamais au-delà ; un appel hors de la requête ne compte pas.
    expect(netSpans({ sentAt: 0, waits: [[80, null]], busy: [[150, 160]] }, 100)).toEqual([[0, 80]])
    expect(netSpans({ sentAt: 0 }, 100)).toEqual([[0, 100]])
    expect(netSpans({ sentAt: 0, waits: [[0, 100]] }, 100)).toEqual([])
  })

  test('une attente se pose sur sa requête, et les appels faits pendant elle restent actifs', async () => {
    let t = openRequest(empty, { session: 's1', project: null, at: T0, now: T0 })
    t = startWait(t, 1, T0 + 10_000)
    // Un appel de spécialiste de T0+12 s à T0+16 s, pendant la question.
    t = recordCall(t, 1, { ...call('claude-opus-5-5'), span: [T0 + 12_000, T0 + 16_000] })
    // Un appel d'avant la question ne devient pas « pendant ».
    t = recordCall(t, 1, { ...call('claude-opus-5-5'), span: [T0, T0 + 4000] })
    t = endWait(t, 1, T0 + 10_000, T0 + 70_000)
    // Hors requête ou sans requête : rien ne change.
    expect(startWait(t, OUTSIDE, T0)).toBe(t)
    expect(startWait(t, undefined, T0)).toBe(t)
    const r = t.log!.requests[0]!
    expect(r.waits).toEqual([[T0 + 10_000, T0 + 70_000]])
    expect(r.busy).toEqual([[T0 + 12_000, T0 + 16_000]])
    // Encore en cours à T0+80 s : 80 s réelles, dont 60 s d'attente moins 4 s d'appel.
    expect(waitMsOf(r, T0 + 80_000)).toBe(56_000)
  })

  test('un nom de fichier de relevé par session et par ouverture', async () => {
    expect(requestFile('s1', T0)).toBe(`s1_${T0}.json`)
    expect(requestFile('a/b:c', T0)).toBe(`a_b_c_${T0}.json`)
    expect(requestFile('s1', T0 + 1)).not.toBe(requestFile('s1', T0))
  })

  test('un appel d’un modèle inconnu est marqué estimé, au prorata du coût de la session', async () => {
    let t = openRequest(empty, { session: 's1', project: 'p', at: T0, now: T0 })
    t = { ...t, turns: { t1: 1 } }
    t = recordCall(t, 1, call('claude-opus-5-5'))
    t = recordCall(t, 1, call('claude-opus-4-5-20251101'))
    t = endTurn(t, 't1', T0 + 10_000)
    const log = costed(t.log!, 1)
    const r = log.requests[0]!
    expect(cents(r.models['claude-opus-5-5']!.cost)).toBe(14.4)
    expect(r.models['claude-opus-5-5']!.isEstimated).toBe(false)
    // 1 $ de session − 0,144 $ chiffrés : 0,856 $ pour le seul appel inconnu.
    expect(cents(r.models['claude-opus-4-5-20251101']!.cost)).toBe(85.6)
    expect(r.models['claude-opus-4-5-20251101']!.isEstimated).toBe(true)
    expect(r).toMatchObject({ realMs: 10_000, isOpen: false, apiMs: 8000 })
  })

  test('un identifiant tiré d’un texte (constructor, __proto__) n’est jamais une requête', async () => {
    let t = openRequest(empty, { session: 's1', project: 'p', at: T0, now: T0 })
    t = noteTasks(t, ['__proto__', 'constructor', 'b1'], 1)
    // Ni tâche ni agent sous ces noms : jamais la propriété héritée d'un objet.
    for (const id of ['toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
      expect(relaunchOwner(t, { kind: 'peer', id })).toBe(OUTSIDE)
      expect(relaunchOwner(t, { kind: 'task', id })).toBe(OUTSIDE)
    }
    // Les tâches de la liste restent à la requête 1, même nommées comme une propriété d'objet.
    expect(relaunchOwner(t, { kind: 'task', id: 'constructor' })).toBe(1)
    expect(relaunchOwner(t, { kind: 'task', id: '__proto__' })).toBe(1)
    expect(t.log!.requests[0]!.tasks).toBe(3)
  })
})

describe('temps cumulé : les fils en même temps', () => {
  const T0 = Date.UTC(2026, 9, 26, 14, 0, 0)
  const empty: Tracker = { log: null, current: null, turns: {} }

  test('les moments à plusieurs fils, coupés aux morceaux actifs, sans les attentes du fil principal', async () => {
    // Fil principal [0, 100], spécialistes [20, 60] et [40, 80] : 2 fils de 20 à 40, 3 de 40 à 60, 2 de 60 à 80.
    const r = { turnSpans: [[0, 100]] as [number, number][], agentSpans: [[20, 60], [40, 80]] as [number, number][] }
    expect(parallelPieces([r], [[0, 100]])).toEqual([[20, 40, 1], [40, 60, 2], [60, 80, 1]])
    expect(extraMs(parallelPieces([r], [[0, 100]]))).toBe(20 + 40 + 20)
    // Coupé aux morceaux actifs : rien hors de [0, 50].
    expect(extraMs(parallelPieces([r], [[0, 50]]))).toBe(20 + 20)
    // Le fil principal attend une réponse de 30 à 70 : il ne compte pas pendant ce temps.
    expect(parallelPieces([{ ...r, waits: [[30, 70]] }], [[0, 100]])).toEqual([[20, 30, 1], [40, 60, 1], [70, 80, 1]])
    // Un seul fil à la fois (le fil principal attend son spécialiste) : rien de gagné.
    expect(parallelPieces([{ turnSpans: [[0, 10], [50, 60]], agentSpans: [[10, 50]] }], [[0, 60]])).toEqual([])
    // Deux requêtes de la même discussion se croisent aussi.
    expect(extraMs(parallelPieces([{ agentSpans: [[0, 30]] }, { turnSpans: [[10, 20]] }], [[0, 30]]))).toBe(10)
    expect(parallelPieces([], [[0, 10]])).toEqual([])
  })

  test('les tours du fil principal et des spécialistes de fond vont à leur requête', async () => {
    let t = openRequest(empty, { session: 's1', project: null, at: T0, now: T0 })
    t = startTurn(t, 'm1', 1)
    t = startLane(t, 'm1', T0, { request: 1 })
    // Un spécialiste de fond, un qui bloque son parent, un agent interne (sans agent.spawn).
    t = attachAgent(t, 'bg', { isSpawn: true, isParallel: true })
    t = startLane(t, 'a1', T0 + 1000, { agent: 'bg' })
    t = attachAgent(t, 'fg', { isSpawn: true })
    t = startLane(t, 'a2', T0 + 2000, { agent: 'fg' })
    t = startLane(attachAgent(t, 'inner', { isSpawn: false }), 'a3', T0 + 3000, { agent: 'inner' })
    // Encore en cours : la vue et l'écriture les comptent jusqu'à maintenant, sans rien fermer.
    const open = withOpenLanes(t, T0 + 5000)!.requests[0]!
    expect(open.turnSpans).toEqual([[T0, T0 + 5000]])
    expect(open.agentSpans).toEqual([[T0 + 1000, T0 + 5000]])
    expect(t.log!.requests[0]!.turnSpans).toBeUndefined()
    for (const id of ['a1', 'a2', 'a3', 'm1']) t = endLane(t, id, T0 + 10_000)
    const r = t.log!.requests[0]!
    expect(r.turnSpans).toEqual([[T0, T0 + 10_000]])
    expect(r.agentSpans).toEqual([[T0 + 1000, T0 + 10_000]])
    expect(Object.keys(t.lanes!)).toEqual([])
    // Une fin sans début connu, ou un tour hors requête : rien.
    expect(endLane(t, 'inconnu', T0)).toBe(t)
    expect(startLane(t, 'm2', T0, { request: OUTSIDE })).toBe(t)
  })
})
