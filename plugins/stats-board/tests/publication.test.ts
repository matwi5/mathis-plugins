import { describe, expect, test } from 'claude-code/testing'

import { combine, measuresOf, periodOf, weightedSpeed } from '../hooks/durations.ts'
import { mergeMachines, parsePublished, publishedOf } from '../hooks/model.ts'
import type { Durations, Published, SessionRow, UsageRow } from '../types'

const row = (date: string, project: string, model: string, cost: number, machine = 'Mac'): UsageRow => ({ date, project, machine, model, input: 1, output: 400, cacheWrite: 0, cacheRead: 0, cost })
const session = (id: string, project: string, last: number, machine = 'Mac'): SessionRow => ({ id, machine, project, parent: null, first: last - 3_600_000, last, cost: 1, tokens: 10, output: 1, models: ['claude-opus-5-5'] })
const MIN = 60_000
const hours = (at: Record<number, number>) => Array.from({ length: 24 }, (_, h) => (at[h] ?? 0) * MIN)

/** Les durées du Mac : le 7 octobre, 45 min sur la démo (dont 30 à 10 h), une session. Des millisecondes partout. */
const MAC_DURATIONS: Durations = {
  since: '2026-10-07',
  files: { 's1_1.json': { mtimeMs: 1, days: ['2026-10-07'] } },
  api: [
    { date: '2026-10-07', project: '-p-demo', machine: 'Mac', model: 'claude-opus-5-5', apiMs: 600_400, genMs: 300_200, output: 12_000, calls: 30, speeds: { '40': 30 } },
    // Une durée que ccusage ne voit pas encore (pas de ligne) : elle part à part.
    { date: '2026-10-07', project: '-p-demo', machine: 'Mac', model: 'claude-haiku-5-5', apiMs: 60_000, genMs: 30_000, output: 3000, calls: 3, speeds: { '100': 3 } },
  ],
  active: [{ date: '2026-10-07', project: '-p-demo', machine: 'Mac', activeMs: 45 * MIN + 29_999, requests: 3 }],
  // Une requête seule de 14:50:03,120 à 15:10 : 9 min 56,880 s à 14 h.
  hours: [{ date: '2026-10-07', machine: 'Mac', hours: hours({ 10: 30, 11: 15, 14: 9.948, 15: 10 }) }],
  sessions: [{ date: '2026-10-07', session: 's1', project: '-p-demo', machine: 'Mac', activeMs: 45 * MIN, apiMs: 660_000, requests: 3 }],
  times: [{ date: '2026-10-07', project: '-p-demo', machine: 'Mac', seconds: [600, 900, 1200] }],
}

const macPublished = () =>
  publishedOf({
    machine: 'Mac',
    tzOffset: -120,
    rows: [row('2026-10-07', '-p-demo', 'claude-opus-5-5', 3), row('2026-09-01', '-p-demo', 'claude-opus-5-5', 1)],
    sessions: [session('s1', '-p-demo', Date.UTC(2026, 9, 7, 10))],
    projects: { '-p-demo': { name: 'demo', path: '/p/demo' } },
    durations: MAC_DURATIONS,
  })

describe('publication des durées', () => {
  test('des totaux par jour, projet, modèle, session et heure, à la minute, au même format 1', async () => {
    const body = macPublished()
    // Le même format : un poste pas encore mis à jour lit le reste.
    expect(body.schema).toBe(1)
    expect(body.rows).toEqual([{ ...row('2026-10-07', '-p-demo', 'claude-opus-5-5', 3), apiMs: 10 * MIN, genMs: 5 * MIN, calls: 30, genOutput: 12_000 }, row('2026-09-01', '-p-demo', 'claude-opus-5-5', 1)])
    expect(body.apiOnly).toEqual([{ date: '2026-10-07', project: '-p-demo', model: 'claude-haiku-5-5', apiMs: 1 * MIN, genMs: 1 * MIN, calls: 3, genOutput: 3000 }])
    expect(body.sessions[0]).toMatchObject({ id: 's1', activeMs: 45 * MIN, apiMs: 11 * MIN, requests: 3 })
    expect(body.active).toEqual([{ date: '2026-10-07', project: '-p-demo', activeMs: 45 * MIN, requests: 3 }])
    // À la minute : l'heure de début de la requête de 14:50:03 ne se déduit plus.
    expect(body.hours).toEqual([{ date: '2026-10-07', hours: hours({ 10: 30, 11: 15, 14: 10, 15: 10 }) }])
    // Seules ces clés partent : ni requête, ni heure de requête, ni durée de chaque requête, ni vitesse d'appel.
    expect(Object.keys(body).sort()).toEqual(['active', 'apiOnly', 'hours', 'machine', 'projects', 'rows', 'schema', 'sessions', 'tzOffset'])
    expect(Object.keys(body.rows[0]!).sort()).toEqual(['apiMs', 'cacheRead', 'cacheWrite', 'calls', 'cost', 'date', 'genMs', 'genOutput', 'input', 'machine', 'model', 'output', 'project'])
    expect(Object.keys(body.sessions[0]!).sort()).toEqual(['activeMs', 'apiMs', 'cost', 'first', 'id', 'last', 'machine', 'models', 'output', 'parent', 'project', 'requests', 'tokens'])
    for (const list of [body.active!, body.hours!, body.apiOnly!]) for (const x of list) expect(Object.keys(x).every((k) => ['date', 'project', 'model', 'activeMs', 'requests', 'hours', 'apiMs', 'genMs', 'calls', 'genOutput'].includes(k))).toBe(true)
    expect(JSON.stringify(body)).not.toContain('s1_1.json')
  })

  test('l’heure de début et de fin d’une session part à la minute, sans jamais raccourcir la session', async () => {
    const at = (h: number, m: number, sec: number, ms: number) => Date.UTC(2026, 9, 7, h, m, sec, ms)
    const precise: SessionRow = { ...session('s2', '-p-demo', at(11, 2, 5, 1)), first: at(10, 14, 23, 456) }
    const exact: SessionRow = { ...session('s3', '-p-demo', at(12, 0, 0, 0)), first: at(11, 30, 0, 0) }
    const body = publishedOf({ machine: 'Mac', tzOffset: -120, rows: [], sessions: [precise, exact], projects: {}, durations: null })
    // Le début vers la minute d'avant, la fin vers la minute d'après ; une heure déjà ronde ne bouge pas.
    expect(body.sessions.map((s) => [s.first, s.last])).toEqual([
      [at(10, 14, 0, 0), at(11, 3, 0, 0)],
      [at(11, 30, 0, 0), at(12, 0, 0, 0)],
    ])
  })

  test('une session finie dans la dernière minute du jour reste dans son jour', async () => {
    // Poste à UTC+2 : 21:59:30 UTC est 23:59:30 à l'heure du poste ; vers le haut, ce serait minuit.
    const late: SessionRow = { ...session('s4', '-p-demo', Date.UTC(2026, 9, 7, 21, 59, 30)), first: Date.UTC(2026, 9, 7, 21, 0, 10) }
    const body = publishedOf({ machine: 'Mac', tzOffset: -120, rows: [], sessions: [late], projects: {}, durations: null })
    expect(body.sessions[0]).toMatchObject({ first: Date.UTC(2026, 9, 7, 21, 0), last: Date.UTC(2026, 9, 7, 21, 59) })
  })

  test('le temps actif d’un projet en worktree part avec le dossier de son dépôt', async () => {
    const wt = '/p/demo/.claude/worktrees/groupe-A'
    const body = publishedOf({
      machine: 'Mac',
      tzOffset: -120,
      rows: [row('2026-10-07', '-p-demo--claude-worktrees-groupe-A', 'claude-opus-5-5', 3)],
      sessions: [],
      projects: { '-p-demo--claude-worktrees-groupe-A': { name: 'groupe-A', path: wt } },
      durations: { ...MAC_DURATIONS, active: [{ date: '2026-10-07', project: '-p-demo', machine: 'Mac', activeMs: 20 * MIN, requests: 1 }], api: [], sessions: [] },
    })
    expect(body.projects['-p-demo']).toEqual({ name: 'demo', path: '/p/demo' })
    // Chez le lecteur, le temps actif rejoint le projet du même nom de dossier.
    const merged = mergeMachines({ machine: 'Portable', rows: [row('2026-10-07', 'C--p-demo', 'claude-opus-5-5', 1, 'Portable')], sessions: [], projects: { 'C--p-demo': { name: 'demo', path: 'C:\\p\\demo' } } }, [parsePublished(JSON.parse(JSON.stringify({ ...body, updatedAt: 1 })))!])
    expect(merged.peers.active[0]).toMatchObject({ project: 'C--p-demo', activeMs: 20 * MIN })
  })

  test('les durées d’un autre poste ne sont gardées qu’une fois : dans les durées des postes, pas dans ses lignes', async () => {
    const mac = parsePublished(JSON.parse(JSON.stringify({ ...macPublished(), updatedAt: 1 })))!
    const merged = mergeMachines({ machine: 'Portable', rows: [], sessions: [], projects: {} }, [mac])
    const theirs = merged.rows.filter((r) => r.machine === 'Mac')
    expect(theirs.length).toBeGreaterThan(0)
    for (const r of theirs) for (const k of ['apiMs', 'genMs', 'calls', 'genOutput']) expect(k in r).toBe(false)
    for (const s of merged.sessions.filter((x) => x.machine === 'Mac')) for (const k of ['activeMs', 'apiMs', 'requests']) expect(k in s).toBe(false)
    // La copie qui reste : celle que lisent les vues.
    expect(merged.peers.api.some((r) => r.machine === 'Mac' && r.apiMs === 10 * MIN)).toBe(true)
    expect(merged.peers.sessions[0]).toMatchObject({ session: 's1', activeMs: 45 * MIN })
  })

  test('relecture des durées, et d’un fichier sans durée (poste pas encore mis à jour)', async () => {
    const back = parsePublished(JSON.parse(JSON.stringify({ ...macPublished(), updatedAt: 5 })))!
    expect(back.rows[0]).toMatchObject({ apiMs: 10 * MIN, genMs: 5 * MIN, calls: 30, genOutput: 12_000 })
    expect(back.sessions[0]).toMatchObject({ activeMs: 45 * MIN, requests: 3 })
    expect(back.active).toHaveLength(1)
    expect(back.apiOnly).toHaveLength(1)
    expect(back.hours![0]!.hours[10]).toBe(30 * MIN)
    // Sans durée : lisible, rien de mesuré.
    const old = parsePublished({ schema: 1, machine: 'PC', updatedAt: 1, tzOffset: 0, rows: [row('2026-10-07', '-p-demo', 'claude-opus-5-5', 2, 'PC')], sessions: [], projects: {} })!
    expect(old.active).toBeUndefined()
    expect(old.rows[0]!.apiMs).toBeUndefined()
    expect(mergeMachines({ machine: 'Portable', rows: [], sessions: [], projects: {} }, [old]).peers).toEqual({ sinceBy: {}, api: [], active: [], hours: [], sessions: [] })
    expect(parsePublished({ schema: 2, machine: 'x', rows: [] })).toBeNull()
  })

  test('les postes s’additionnent, et suivent le filtre « poste »', async () => {
    const mac = parsePublished(JSON.parse(JSON.stringify({ ...macPublished(), updatedAt: 5 }))) as Published
    // Ce poste (Portable) : 1 h sur la démo le 7, à 16 h ; suivi depuis le 6.
    const own: Durations = {
      since: '2026-10-06',
      files: {},
      api: [{ date: '2026-10-07', project: 'C--p-demo', machine: 'Portable', model: 'claude-opus-5-5', apiMs: 120_000, genMs: 60_000, output: 6000, calls: 5, speeds: {} }],
      active: [{ date: '2026-10-07', project: 'C--p-demo', machine: 'Portable', activeMs: 60 * MIN, requests: 2 }],
      hours: [{ date: '2026-10-07', machine: 'Portable', hours: hours({ 16: 60 }) }],
      sessions: [],
      times: [{ date: '2026-10-07', project: 'C--p-demo', machine: 'Portable', seconds: [1800, 1800] }],
    }
    const merged = mergeMachines({ machine: 'Portable', rows: [row('2026-10-07', 'C--p-demo', 'claude-opus-5-5', 5, 'Portable')], sessions: [], projects: { 'C--p-demo': { name: 'demo', path: 'C:\\p\\demo' } } }, [mac])
    // Le projet du Mac rejoint celui de ce poste, au même nom de dossier.
    expect(merged.peers.active[0]).toMatchObject({ project: 'C--p-demo', machine: 'Mac' })
    expect(merged.peers.sinceBy).toEqual({ Mac: '2026-10-07' })
    const all = combine(own, 'Portable', merged.peers)
    const f = { machine: 'all', project: null, model: null }
    const m = measuresOf(all, f, merged.projects)
    // 60 + 45 min, plus les 20 min arrondies de 14 h et 15 h du Mac ; suivi depuis le plus ancien des postes.
    expect(m.active.get('2026-10-07')).toBe(125 * MIN)
    expect(m.since).toBe('2026-10-06')
    expect(m.projects.get('2026-10-07')!.get('C--p-demo')).toBe(105 * MIN)
    const p = periodOf(all, f, null, '2026-10-07', merged.projects)
    expect(p.hours[10]).toBe(30 * MIN)
    expect(p.hours[16]).toBe(60 * MIN)
    // La vitesse d'Opus 5.5 sur les deux postes : les seuls tokens relevés, 18 000 en 6 min, 50 tok/s.
    const opus = p.models.get('claude-opus-5-5')!
    expect(opus).toMatchObject({ apiMs: 12 * MIN, calls: 35, output: 18_000 })
    expect(weightedSpeed(opus.output, opus.genMs)).toBe(50)
    expect(p.models.get('claude-haiku-5-5')).toMatchObject({ calls: 3, output: 3000 })
    // Les médianes de requêtes restent sur ce poste.
    expect(p.requestMs).toEqual([1_800_000, 1_800_000])
    // Filtre « Mac » : ses seules durées, et sa date de début.
    const onMac = measuresOf(all, { ...f, machine: 'Mac' }, merged.projects)
    expect(onMac.active.get('2026-10-07')).toBe(65 * MIN)
    expect(onMac.since).toBe('2026-10-07')
    expect(periodOf(all, { ...f, machine: 'Mac' }, null, '2026-10-07', merged.projects).hours[16]).toBe(0)
    // Un poste sans durée publiée : pas de date de suivi, ses durées « — ».
    expect(measuresOf(all, { ...f, machine: 'PC' }, merged.projects).since).toBeNull()
  })
})
