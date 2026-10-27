import { describe, expect, test } from 'claude-code/testing'

import { BROKEN, EMPTY_DURATIONS, averageOf, combine, costPerActiveHour, joinMonths, monthsOf, parseRequestLog, periodOf, refreshDurations, speedMedian, weightedSpeed } from '../hooks/durations.ts'
import { median, speedClass } from '../hooks/requests.ts'
import type { RequestLog, RequestRecord } from '../types'

/** Paris en heure d'été : UTC+2 (décalage de `Date#getTimezoneOffset`). */
const TZ = -120
/** L'heure locale du 7 octobre 2026, en ms. */
const at = (h: number, m = 0, day = 7) => Date.UTC(2026, 9, day, h - 2, m)
const MIN = 60_000

const request = (id: number, sentAt: number, realMs: number, apiMs = 0): RequestRecord => ({
  id,
  sentAt,
  endedAt: sentAt + realMs,
  realMs,
  isOpen: false,
  tasks: 0,
  apiMs,
  agents: 0,
  models: apiMs ? { 'claude-opus-5-5': { calls: 2, input: 10, output: 400, cacheWrite: 0, cacheRead: 0, apiMs, genMs: apiMs / 2, cost: 0.01, isEstimated: false } } : {},
})
const log = (session: string, project: string, requests: RequestRecord[]): RequestLog => ({ schema: 1, session, openedAt: requests[0]?.sentAt ?? 0, project, requests, outside: {} })

/** Un lecteur de fichiers de relevé qui compte ses lectures. */
const disk = (files: Record<string, RequestLog | typeof BROKEN | null>) => {
  const reads: string[] = []
  return { reads, read: async (name: string) => (reads.push(name), files[name] ?? null) }
}

describe('durées', () => {
  test('temps actif sans double compte, coupé aux heures', async () => {
    // Session A (projet demo) : 10:30–11:30 et 11:00–12:15 ; session B (projet api) : 11:45–12:05.
    const files = {
      'a.json': log('a', '-p-demo', [request(1, at(10, 30), 60 * MIN, 20_000), request(2, at(11), 75 * MIN, 10_000)]),
      'b.json': log('b', '-p-api', [request(1, at(11, 45), 20 * MIN)]),
    }
    const d = await refreshDurations(EMPTY_DURATIONS, [{ name: 'a.json', mtimeMs: 1 }, { name: 'b.json', mtimeMs: 1 }], disk(files).read, TZ, 'Mac')
    const hours = d.hours.find((h) => h.date === '2026-10-07')!.hours
    // 10 h : 30 min ; 11 h : 60 min ; 12 h : 15 min. 1 h 45 en tout, pas 2 h 35.
    expect(hours.slice(10, 13).map((ms) => ms / MIN)).toEqual([30, 60, 15])
    expect(hours.reduce((n, ms) => n + ms, 0) / MIN).toBe(105)
    expect(d.active.map((r) => [r.project, r.activeMs / MIN, r.requests]).sort()).toEqual([
      ['-p-api', 20, 1],
      ['-p-demo', 105, 2],
    ])
    expect(d.sessions.find((s) => s.session === 'a')).toMatchObject({ date: '2026-10-07', activeMs: 105 * MIN, apiMs: 30_000, requests: 2, machine: 'Mac' })
    expect(d.api).toEqual([{ date: '2026-10-07', project: '-p-demo', machine: 'Mac', model: 'claude-opus-5-5', apiMs: 30_000, genMs: 15_000, output: 800, calls: 4, speeds: {} }])
    // La durée réelle de chaque requête, pour les médianes.
    expect(d.times).toEqual([
      { date: '2026-10-07', project: '-p-demo', machine: 'Mac', seconds: [3600, 4500] },
      { date: '2026-10-07', project: '-p-api', machine: 'Mac', seconds: [1200] },
    ])
    expect(d.since).toBe('2026-10-07')
  })

  test('une requête qui passe minuit compte pour les deux jours', async () => {
    const files = { 'a.json': log('a', '-p-demo', [request(1, at(23, 30), 60 * MIN)]) }
    const d = await refreshDurations(EMPTY_DURATIONS, [{ name: 'a.json', mtimeMs: 1 }], disk(files).read, TZ, 'Mac')
    expect(d.hours.map((h) => [h.date, h.hours.reduce((n, ms) => n + ms, 0) / MIN])).toEqual([
      ['2026-10-07', 30],
      ['2026-10-08', 30],
    ])
    expect(d.hours[1]!.hours[0]).toBe(30 * MIN)
    // La requête compte pour le jour de son envoi.
    expect(d.active.map((r) => [r.date, r.requests])).toEqual([
      ['2026-10-07', 1],
      ['2026-10-08', 0],
    ])
    expect(d.files['a.json']).toEqual({ mtimeMs: 1, days: ['2026-10-07', '2026-10-08'] })
  })

  test('seuls les fichiers modifiés sont relus, avec ceux qui touchent les mêmes jours', async () => {
    const files: Record<string, RequestLog> = {
      'a.json': log('a', '-p-demo', [request(1, at(9, 0, 5), 10 * MIN)]),
      'b.json': log('b', '-p-demo', [request(1, at(9, 0, 6), 10 * MIN)]),
      'c.json': log('c', '-p-api', [request(1, at(9, 0, 7), 10 * MIN)]),
    }
    const first = disk(files)
    const entries = (b: number, c = 1) => [{ name: 'a.json', mtimeMs: 1 }, { name: 'b.json', mtimeMs: b }, { name: 'c.json', mtimeMs: c }]
    let d = await refreshDurations(EMPTY_DURATIONS, entries(1), first.read, TZ, 'Mac')
    expect(first.reads.sort()).toEqual(['a.json', 'b.json', 'c.json'])
    // Rien de modifié : aucune lecture.
    const none = disk(files)
    expect(await refreshDurations(d, entries(1), none.read, TZ, 'Mac')).toBe(d)
    expect(none.reads).toEqual([])
    // b grandit d'une requête : lui seul est relu, et son jour recalculé.
    files['b.json'] = log('b', '-p-demo', [request(1, at(9, 0, 6), 10 * MIN), request(2, at(10, 0, 6), 5 * MIN)])
    const second = disk(files)
    d = await refreshDurations(d, entries(2), second.read, TZ, 'Mac')
    expect(second.reads).toEqual(['b.json'])
    expect(d.active.find((r) => r.date === '2026-10-06')).toMatchObject({ activeMs: 15 * MIN, requests: 2 })
    expect(d.active.find((r) => r.date === '2026-10-05')).toMatchObject({ activeMs: 10 * MIN })
    // c passe sur le jour de b : les deux sont relus, pour l'union du 6.
    files['c.json'] = log('c', '-p-api', [request(1, at(9, 0, 7), 10 * MIN), request(2, at(9, 5, 6), 10 * MIN)])
    const third = disk(files)
    d = await refreshDurations(d, entries(2, 2), third.read, TZ, 'Mac')
    expect(third.reads.sort()).toEqual(['b.json', 'c.json'])
    expect(d.hours.find((h) => h.date === '2026-10-06')!.hours[9]).toBe(15 * MIN)
  })

  test('un fichier illisible (en cours d’écriture) garde ses totaux et sera relu', async () => {
    const files: Record<string, RequestLog | null> = { 'a.json': log('a', '-p-demo', [request(1, at(9), 10 * MIN)]) }
    let d = await refreshDurations(EMPTY_DURATIONS, [{ name: 'a.json', mtimeMs: 1 }], disk(files).read, TZ, 'Mac')
    files['a.json'] = null
    d = await refreshDurations(d, [{ name: 'a.json', mtimeMs: 2 }], disk(files).read, TZ, 'Mac')
    expect(d.active[0]).toMatchObject({ activeMs: 10 * MIN })
    expect(d.files['a.json']!.mtimeMs).toBe(1)
    files['a.json'] = log('a', '-p-demo', [request(1, at(9), 20 * MIN)])
    d = await refreshDurations(d, [{ name: 'a.json', mtimeMs: 2 }], disk(files).read, TZ, 'Mac')
    expect(d.active[0]).toMatchObject({ activeMs: 20 * MIN })
  })

  test('un fichier illisible depuis plus d’une heure est laissé de côté, et relu s’il change', async () => {
    const files: Record<string, RequestLog | typeof BROKEN | null> = {
      'a.json': log('a', '-p-demo', [request(1, at(9), 10 * MIN)]),
      'b.json': log('b', '-p-api', [request(1, at(9, 30), 10 * MIN)]),
    }
    const now = at(18)
    let d = await refreshDurations(EMPTY_DURATIONS, [{ name: 'a.json', mtimeMs: at(9) }, { name: 'b.json', mtimeMs: at(9) }], disk(files).read, TZ, 'Mac', now)
    // Une lecture qui échoue (erreur passagère) ne le laisse pas de côté : ses jours attendent.
    files['b.json'] = null
    const failed = await refreshDurations(d, [{ name: 'a.json', mtimeMs: at(9) }, { name: 'b.json', mtimeMs: at(10) }], disk(files).read, TZ, 'Mac', now)
    expect(failed.files['b.json']!.mtimeMs).toBe(at(9))
    expect(failed.hours.find((h) => h.date === '2026-10-07')!.hours[9]).toBe(20 * MIN)
    // b est coupé par un plantage à 10 h : son JSON est illisible, inchangé depuis 8 h.
    files['b.json'] = BROKEN
    const reads = disk(files)
    d = await refreshDurations(d, [{ name: 'a.json', mtimeMs: at(9) }, { name: 'b.json', mtimeMs: at(10) }], reads.read, TZ, 'Mac', now)
    expect(d.hours.find((h) => h.date === '2026-10-07')!.hours[9]).toBe(10 * MIN)
    expect(d.files['b.json']).toEqual({ mtimeMs: at(10), days: [] })
    // Il n'est plus relu tant qu'il ne change pas.
    const again = disk(files)
    await refreshDurations(d, [{ name: 'a.json', mtimeMs: at(9) }, { name: 'b.json', mtimeMs: at(10) }], again.read, TZ, 'Mac', now)
    expect(again.reads).toEqual([])
    // Réparé : il est relu.
    files['b.json'] = log('b', '-p-api', [request(1, at(9, 30), 10 * MIN)])
    d = await refreshDurations(d, [{ name: 'a.json', mtimeMs: at(9) }, { name: 'b.json', mtimeMs: at(19) }], disk(files).read, TZ, 'Mac', at(19, 5))
    expect(d.hours.find((h) => h.date === '2026-10-07')!.hours[9]).toBe(20 * MIN)
  })

  test('moyennes sur les seuls jours suivis', async () => {
    const values = new Map([
      ['2026-10-01', 0],
      ['2026-10-05', 3 * MIN],
      ['2026-10-06', 0],
      ['2026-10-07', 1 * MIN],
    ])
    // Le 1er est avant le suivi ; le 6, suivi mais sans requête : la moyenne porte sur le 5 et le 7.
    expect(averageOf(values, '2026-10-05')).toBe(2 * MIN)
    expect(averageOf(values, null)).toBeNull()
    expect(averageOf(new Map(), '2026-10-05')).toBeNull()
  })

  test('vitesse d’un modèle : moyenne pondérée, et médiane des appels', async () => {
    // Un appel de 20 tokens en 0,1 s (200 tok/s) et un de 4 000 tokens en 100 s (40 tok/s).
    expect(speedClass(20, 100)).toBe('200')
    expect(speedClass(4000, 100_000)).toBe('40')
    expect(speedClass(0, 100)).toBeNull()
    // La moyenne pondérée : 4 020 tokens en 100,1 s, environ 40 tok/s, pas 120.
    expect(Math.round(weightedSpeed(4020, 100_100)!)).toBe(40)
    expect(weightedSpeed(10, 0)).toBeNull()
    // La médiane : le milieu de la classe où tombe l'appel du milieu.
    expect(speedMedian({ '40': 2, '200': 1 })).toBe(45)
    expect(speedMedian({ '40': 1, '60': 1, '200': 2 })).toBe(65)
    expect(speedMedian({})).toBeNull()
  })

  test('coût par heure active, et médiane des requêtes d’une période', async () => {
    expect(costPerActiveHour(12, 2 * 3_600_000)).toBe(6)
    expect(costPerActiveHour(12, 30_000)).toBeNull()
    const files = {
      'a.json': log('a', '-p-demo', [request(1, at(9, 0, 5), 2 * MIN), request(2, at(10, 0, 6), 10 * MIN), request(3, at(11, 0, 7), 4 * MIN)]),
    }
    const d = await refreshDurations(EMPTY_DURATIONS, [{ name: 'a.json', mtimeMs: 1 }], disk(files).read, TZ, 'Mac')
    const all = periodOf(combine(d, 'Mac'), { machine: 'all', project: null, model: null }, '2026-10-01', '2026-10-07', {})
    expect(median(all.requestMs)).toBe(4 * MIN)
    // Le 5 hors de la période ; un autre poste : rien de mesuré.
    expect(periodOf(combine(d, 'Mac'), { machine: 'all', project: null, model: null }, '2026-10-06', '2026-10-07', {}).requestMs).toEqual([10 * MIN, 4 * MIN])
    expect(periodOf(combine(d, 'Mac'), { machine: 'PC', project: null, model: null }, '2026-10-01', '2026-10-07', {}).requestMs).toEqual([])
    expect(all.sessions.get('a')).toBe(16 * MIN)
    // Sous un filtre de projet : ses requêtes, mais pas les heures, qui ne disent pas leur projet.
    const demo = periodOf(combine(d, 'Mac'), { machine: 'all', project: '-p-demo', model: null }, null, '2026-10-07', {})
    expect(demo.requestMs).toHaveLength(3)
    expect(demo.hours.every((ms) => ms === 0)).toBe(true)
    expect(periodOf(combine(d, 'Mac'), { machine: 'all', project: '-p-api', model: null }, null, '2026-10-07', {}).requestMs).toEqual([])
    expect(all.hours[10]).toBe(10 * MIN)
  })

  test('un fichier de relevé aux valeurs extrêmes : ses requêtes impossibles sont écartées, le relevé finit', async () => {
    const good = request(1, at(9), 10 * MIN, 1000)
    // `1e400` se lit `Infinity` ; une date hors bornes ; une fin avant l'envoi ; une durée de 400 jours ; un modèle nul.
    const extra = [
      ',{"id":2,"sentAt":' + String(at(10)) + ',"endedAt":null,"realMs":1e400,"isOpen":false,"tasks":0,"apiMs":0,"agents":0,"models":{}}',
      ',{"id":3,"sentAt":1e400,"endedAt":null,"realMs":0,"isOpen":false,"tasks":0,"apiMs":0,"agents":0,"models":{}}',
      ',{"id":4,"sentAt":' + String(at(11)) + ',"endedAt":' + String(at(10)) + ',"realMs":0,"isOpen":false,"tasks":0,"apiMs":0,"agents":0,"models":{}}',
      ',{"id":5,"sentAt":' + String(at(12)) + ',"endedAt":null,"realMs":34560000000,"isOpen":false,"tasks":0,"apiMs":0,"agents":0,"models":{}}',
      ',{"id":6,"sentAt":' + String(at(13)) + ',"endedAt":null,"realMs":60000,"isOpen":false,"tasks":0,"apiMs":0,"agents":0,"models":{"claude-opus-5-5":null}}',
      ',null',
    ].join('')
    const text = JSON.stringify(log('a', '-p-demo', [good])).replace('],"outside"', `${extra}],"outside"`)
    const parsed = parseRequestLog(JSON.parse(text)) as RequestLog
    expect(parsed.requests.map((r) => r.id)).toEqual([1, 6])
    expect(parsed.requests[1]!.models).toEqual({})
    const d = await refreshDurations(EMPTY_DURATIONS, [{ name: 'a.json', mtimeMs: 1 }], async () => parsed, TZ, 'Mac')
    expect(d.hours.find((h) => h.date === '2026-10-07')!.hours.reduce((n, ms) => n + ms, 0)).toBe(11 * MIN)
    // Un fichier d'un autre format attend (null) ; un fichier au format 1 sans liste de requêtes est coupé.
    expect(parseRequestLog({ schema: 2, session: 'a', requests: [] })).toBeNull()
    expect(parseRequestLog({ schema: 1, session: 'a', requests: 'x' })).toBe(BROKEN)
  })

  test('les totaux se rangent par mois, puis se rassemblent à l’identique', async () => {
    // Une requête du 30 septembre à 23 h 30, d'une heure : elle touche deux jours, et deux mois.
    const lateSept = log('s1', '-p-demo', [request(1, at(23, 30, 30) - 30 * 24 * 3_600_000, 60 * MIN, 5 * MIN)])
    const october = log('s2', '-p-api', [request(1, at(10), 20 * MIN, 2 * MIN)])
    const { read } = disk({ 'a.json': lateSept, 'b.json': october, 'c.json': BROKEN })
    const files = [
      { name: 'a.json', mtimeMs: 1 },
      { name: 'b.json', mtimeMs: 2 },
      { name: 'c.json', mtimeMs: Date.UTC(2026, 9, 2) },
    ]
    const d = await refreshDurations(EMPTY_DURATIONS, files, read, TZ, 'Mac', Date.UTC(2026, 9, 26))
    const months = monthsOf(d)
    expect([...months.keys()].sort()).toEqual(['2026-09', '2026-10'])
    // Chaque mois ne garde que ses jours.
    expect(months.get('2026-09')!.active.every((r) => r.date.startsWith('2026-09'))).toBe(true)
    // Un fichier est indexé dans chaque mois qu'il touche ; un fichier laissé de côté (sans jour), au mois de sa date.
    expect(Object.keys(months.get('2026-09')!.files)).toEqual(['a.json'])
    expect(Object.keys(months.get('2026-10')!.files).sort()).toEqual(['a.json', 'b.json', 'c.json'])
    // Rassemblés, ils redonnent les mêmes totaux ; un morceau illisible ou d'un autre format est ignoré.
    const parts = [...months.values()].map((m) => JSON.parse(JSON.stringify(m)))
    expect(monthsOf(joinMonths(parts)!)).toEqual(months)
    expect(monthsOf(joinMonths([null, { v: 9, month: '2026-08' }, ...parts])!)).toEqual(months)
    expect(joinMonths([])).toBeNull()
    // Le rangement ne dépend pas de l'ordre des lignes : un mois inchangé se réécrit à l'identique.
    const shuffled = { ...d, active: [...d.active].reverse(), api: [...d.api].reverse(), sessions: [...d.sessions].reverse() }
    expect(JSON.stringify([...monthsOf(shuffled)])).toBe(JSON.stringify([...months]))
  })

  test('un fichier dont les mois ne s’accordent pas, ou dont un mois manque, est relu, sans perdre ses jours', async () => {
    const lateSept = log('s1', '-p-demo', [request(1, at(23, 30, 30) - 30 * 24 * 3_600_000, 60 * MIN, 5 * MIN)])
    const d = await refreshDurations(EMPTY_DURATIONS, [{ name: 'a.json', mtimeMs: 1 }], disk({ 'a.json': lateSept }).read, TZ, 'Mac')
    const [sept, oct] = ['2026-09', '2026-10'].map((m) => JSON.parse(JSON.stringify(monthsOf(d).get(m))))
    const DAYS = ['2026-09-30', '2026-10-01']
    // Deux sessions se sont croisées : septembre a vu la version 2 du fichier, octobre la version 1.
    // L'entrée reste, marquée à relire (-1), avec tous ses jours : ils seront refaits, ou gardés s'il ne se lit pas.
    const crossed = joinMonths([{ ...sept, files: { 'a.json': { ...sept.files['a.json'], mtimeMs: 2 } } }, oct])!
    expect(crossed.files['a.json']).toEqual({ mtimeMs: -1, days: DAYS })
    // Octobre ne se lit pas : même chose.
    expect(joinMonths([sept])!.files['a.json']).toEqual({ mtimeMs: -1, days: DAYS })
    // Une entrée périmée d'un mois ne masque pas celle d'un autre : elles ne s'accordent pas.
    const stale = joinMonths([sept, { ...oct, files: { 'a.json': { mtimeMs: 3, days: ['2026-10-01'] } } }])!
    expect(stale.files['a.json']).toEqual({ mtimeMs: -1, days: DAYS })
    // D'accord : il reste lu.
    expect(joinMonths([sept, oct])!.files['a.json']).toEqual({ mtimeMs: 1, days: DAYS })
    // Marqué à relire et illisible (en cours d'écriture) : ses jours sont gardés tels quels, pas refaits sans lui.
    const busy = await refreshDurations(crossed, [{ name: 'a.json', mtimeMs: 2 }], disk({ 'a.json': null }).read, TZ, 'Mac')
    expect(busy.active.map((r) => r.date)).toEqual(DAYS)
    expect(busy.files['a.json']).toEqual({ mtimeMs: -1, days: DAYS })
    // Lisible : relu, ses deux jours refaits, une seule fois.
    const { reads, read } = disk({ 'a.json': lateSept })
    const again = await refreshDurations(crossed, [{ name: 'a.json', mtimeMs: 2 }], read, TZ, 'Mac')
    expect(reads).toEqual(['a.json'])
    expect(again.active.map((r) => r.date)).toEqual(DAYS)
    expect(again.files['a.json']).toEqual({ mtimeMs: 2, days: DAYS })
    // Le marqueur survit à l'écriture et à la relecture du mois.
    expect(joinMonths([...monthsOf(busy).values()].map((m) => JSON.parse(JSON.stringify(m))))!.files['a.json']).toEqual({ mtimeMs: -1, days: DAYS })
  })

  test('un mois mal formé est ignoré en entier : ses fichiers sont relus, rien ne plante', () => {
    const good = { date: '2026-10-07', project: 'p', machine: 'Mac', activeMs: MIN, requests: 1 }
    const base = { v: 1, month: '2026-10', files: { 'a.json': { mtimeMs: 1, days: ['2026-10-07'] } }, api: [], active: [good], hours: [], sessions: [], times: [] }
    expect(joinMonths([base])!.active).toEqual([good])
    for (const bad of [
      { active: [null, good] },
      { active: [{ project: 'p' }] },
      { hours: [{ date: '2026-10-07', machine: 'Mac' }] },
      { times: [{ date: '2026-10-07', project: 'p', machine: 'Mac' }] },
      { hours: 'non' },
      { files: { 'b.json': { days: ['2026-10-07'] } } },
    ])
      expect(joinMonths([{ ...base, ...bad }])).toBeNull()
    // Une clé « __proto__ » dans l'index ne change pas le prototype.
    const proto = joinMonths([JSON.parse(JSON.stringify(base).replace('"a.json"', '"__proto__"'))])
    expect(proto === null || Object.getPrototypeOf(proto.files) === Object.prototype).toBe(true)
  })
})
