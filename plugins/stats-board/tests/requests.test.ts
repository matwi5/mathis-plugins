import { describe, expect, test } from 'claude-code/testing'

import { canonicalModel, estimateUnknown, priceOf } from '../hooks/pricing.ts'
import { OUTSIDE, activeMs, costed, endTurn, median, noteTasks, openRequest, recordCall, relaunchOwner, requestFile } from '../hooks/requests.ts'
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
