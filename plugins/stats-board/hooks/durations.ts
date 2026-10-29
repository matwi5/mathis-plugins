// Les durées d'un poste, tirées des fichiers de relevé des requêtes (`requests.ts`) : temps actif
// sans double compte (par jour, projet, discussion et heure locale), durée API et temps de
// génération (par jour, projet et modèle). Aucun appel au moteur ici : register.tsx liste les
// fichiers et passe un lecteur ; seuls les fichiers modifiés depuis le relevé précédent sont relus,
// avec ceux qui touchent les mêmes jours (l'union des intervalles d'un jour demande tous ses fichiers).
// Les totaux se rangent par mois (`monthsOf`), un fichier hors du store par mois, et se rassemblent
// (`joinMonths`) en faisant relire tout fichier sur lequel les mois ne s'accordent pas.

import type { ActiveRow, ApiRow, CallStats, Durations, HourRow, PeerDurations, ProjectInfo, RequestLog, RequestRecord, SessionDayRow, TimesRow } from '../types'
import { dayOf, earliest, groupOf, maxOf, UNKNOWN } from './model.ts'
import { REQUEST_SCHEMA, activeMs, mergeSpeeds, netSpans, weightedSpeed } from './requests.ts'

export { weightedSpeed }

export const EMPTY_DURATIONS: Durations = { since: null, files: {}, api: [], active: [], hours: [], sessions: [], times: [] }

/**
 * Le dossier des totaux de durée, sous `~/.claude` : un fichier par mois (`AAAA-MM.json`), hors du
 * store du plugin, que ses 4 Mio ne bornent plus (décision « Totaux »). Sans texte de
 * message, comme les fichiers de relevé dont ils se recalculent.
 */
export const TOTALS_DIR = 'stats-board/totaux'

/** Les totaux d'un mois : ses lignes, et l'entrée de chaque fichier de relevé qui le touche. */
export type MonthTotals = { v: 1; month: string } & Omit<Durations, 'since'>

/** Le nom du fichier des totaux d'un mois : `AAAA-MM.json`. */
export const MONTH_FILE = /^(\d{4}-\d{2})\.json$/

/** Les totaux vides d'un mois. */
export const emptyMonth = (month: string): MonthTotals => ({ v: 1, month, files: {}, api: [], active: [], hours: [], sessions: [], times: [] })

const monthOfDate = (date: string): string => date.slice(0, 7)

/** Les mois qu'un fichier de relevé touche ; un fichier laissé de côté (sans jour), le mois de sa date. */
const monthsOfFile = (f: { mtimeMs: number; days: string[] }): string[] =>
  f.days.length ? [...new Set(f.days.map(monthOfDate))] : [new Date(f.mtimeMs).toISOString().slice(0, 7)]

/** Un ordre fixe des lignes d'un jour, pour qu'un mois inchangé se réécrive à l'identique. */
const byDateThenAll = <T extends { date: string }>(a: T, b: T): number => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)]
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * Les totaux rangés par mois (`AAAA-MM`). L'entrée d'un fichier de relevé va dans chaque mois qu'il
 * touche : au rassemblement, des mois qui ne s'accordent pas sur lui le font relire (décision « Mois
 * sûrs »).
 */
export function monthsOf(d: Durations): Map<string, MonthTotals> {
  const out = new Map<string, MonthTotals>()
  const part = (month: string): MonthTotals => {
    const known = out.get(month)
    if (known) return known
    const made = emptyMonth(month)
    out.set(month, made)
    return made
  }
  for (const [name, f] of Object.entries(d.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) for (const month of monthsOfFile(f)) part(month).files[name] = f
  for (const r of [...d.api].sort(byDateThenAll)) part(monthOfDate(r.date)).api.push(r)
  for (const r of [...d.active].sort(byDateThenAll)) part(monthOfDate(r.date)).active.push(r)
  for (const r of [...d.hours].sort(byDateThenAll)) part(monthOfDate(r.date)).hours.push(r)
  for (const r of [...d.sessions].sort(byDateThenAll)) part(monthOfDate(r.date)).sessions.push(r)
  for (const r of [...(d.times ?? [])].sort(byDateThenAll)) part(monthOfDate(r.date)).times!.push(r)
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)))
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isText = (v: unknown): v is string => typeof v === 'string'
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isCounts = (v: unknown, length?: number): boolean => Array.isArray(v) && v.every(isCount) && (length === undefined || v.length === length)
const has = (r: unknown, texts: string[], counts: string[]): r is Record<string, unknown> =>
  typeof r === 'object' && r !== null && isDate((r as { date?: unknown }).date) && texts.every((k) => isText((r as Record<string, unknown>)[k])) && counts.every((k) => isCount((r as Record<string, unknown>)[k]))

/** Chaque sorte de ligne, avec ce qu'il lui faut pour être lue sans faire planter un calcul. */
const ROW_CHECKS = {
  api: (r: unknown) => has(r, ['project', 'machine', 'model'], ['apiMs', 'genMs', 'output', 'calls']) && typeof r.speeds === 'object' && r.speeds !== null,
  active: (r: unknown) => has(r, ['project', 'machine'], ['activeMs', 'requests']) && (r.cumulMs === undefined || isCount(r.cumulMs)),
  hours: (r: unknown) => has(r, ['machine'], []) && isCounts(r.hours, 24) && (r.cumul === undefined || isCounts(r.cumul, 24)),
  sessions: (r: unknown) => has(r, ['session', 'project', 'machine'], ['activeMs', 'apiMs', 'requests']),
  times: (r: unknown) => has(r, ['project', 'machine'], []) && isCounts(r.seconds),
} as const

/**
 * Un mois lu sur le disque, ou null s'il n'a pas exactement la forme attendue : un mois douteux est
 * ignoré en entier, ses fichiers de relevé relus et ses jours refaits, plutôt que lu en partie
 * (une ligne écartée en silence serait perdue pour de bon).
 */
export function monthOfJson(v: unknown): MonthTotals | null {
  const m = v as Partial<MonthTotals> | null
  if (typeof m !== 'object' || m === null || m.v !== 1 || typeof m.month !== 'string' || !/^\d{4}-\d{2}$/.test(m.month)) return null
  if (typeof m.files !== 'object' || m.files === null || Array.isArray(m.files)) return null
  const files: Durations['files'] = {}
  for (const [name, f] of Object.entries(m.files)) {
    const entry = f as { mtimeMs?: unknown; days?: unknown }
    // -1 : un fichier marqué à relire (`joinMonths`).
    if (name === '__proto__' || !isFiniteIn(entry?.mtimeMs, -1, LAST_DATE) || !Array.isArray(entry.days) || !entry.days.every(isDate)) return null
    files[name] = { mtimeMs: entry.mtimeMs, days: entry.days as string[] }
  }
  for (const key of Object.keys(ROW_CHECKS) as (keyof typeof ROW_CHECKS)[]) if (!Array.isArray(m[key]) || !(m[key] as unknown[]).every(ROW_CHECKS[key])) return null
  // Des lignes d'avant la 0.11.0, sans temps cumulé (ou réécrites par une session pas encore à jour) :
  // tous les fichiers du mois sont à relire (`mtimeMs` -1), leurs jours se refont avec lui.
  if (m.active!.some((r) => r.cumulMs === undefined) || m.hours!.some((h) => h.cumul === undefined)) for (const name of Object.keys(files)) files[name] = { ...files[name]!, mtimeMs: -1 }
  return { v: 1, month: m.month, files, api: m.api!, active: m.active!, hours: m.hours!, sessions: m.sessions!, times: m.times! }
}

/**
 * Les totaux rassemblés depuis les fichiers de chaque mois ; un mois illisible, d'un autre format
 * ou mal formé est ignoré. Une entrée d'index n'est jamais retirée par doute : un fichier de relevé
 * sur lequel les mois lus ne s'accordent pas (dates ou jours différents), ou dont un mois manque,
 * est marqué à relire (`mtimeMs` -1) avec tous les jours que ses entrées lui donnent, que le relevé
 * suivant refait, ou garde s'il ne le lit pas (décision « Mois sûrs »). Null sans aucun mois.
 */
export function joinMonths(parts: readonly unknown[]): Durations | null {
  const months = parts.map(monthOfJson).filter((m): m is MonthTotals => m !== null).sort((a, b) => a.month.localeCompare(b.month))
  if (!months.length) return null
  const read = new Map(months.map((m) => [m.month, m] as const))
  const entries = new Map<string, { mtimeMs: number; days: string[] }[]>()
  for (const m of months) for (const [name, f] of Object.entries(m.files)) entries.set(name, [...(entries.get(name) ?? []), f])
  const files: Durations['files'] = {}
  for (const [name, list] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const days = [...new Set(list.flatMap((f) => f.days))].sort()
    const first = list[0]!
    const isSame = list.every((f) => f.mtimeMs === first.mtimeMs && f.days.join() === first.days.join())
    const isCovered = monthsOfFile({ mtimeMs: first.mtimeMs, days }).every((month) => read.get(month)?.files[name] !== undefined)
    if (isSame && isCovered) files[name] = first
    // Sans aucun jour (fichier laissé de côté), rien à refaire : la date la plus récente suffit.
    else files[name] = days.length ? { mtimeMs: -1, days } : { mtimeMs: maxOf(list.map((f) => f.mtimeMs)), days: [] }
  }
  const all = <T extends { date: string }>(pick: (m: MonthTotals) => readonly T[]): T[] => months.flatMap((m) => [...pick(m)]).sort(byDateThenAll)
  const next = { files, api: all((m) => m.api), active: all((m) => m.active), hours: all((m) => m.hours), sessions: all((m) => m.sessions), times: all((m) => m.times ?? []) }
  return { since: earliest([...next.active, ...next.api].map((r) => r.date)), ...next }
}

const HOUR_MS = 3_600_000
/** Un fichier de relevé illisible et inchangé depuis une heure n'est plus en cours d'écriture. */
export const ABANDONED_MS = HOUR_MS
/** Ce que rend un lecteur pour un fichier lu mais au contenu coupé (JSON illisible). */
export const BROKEN = 'broken'

type Span = readonly [number, number]

/** L'intervalle [envoi, fin] d'une requête relevée : jusqu'à la fin de son dernier tour connu. */
const spanOfRecord = (r: RequestRecord): Span => [r.sentAt, r.sentAt + Math.max(r.realMs, (r.endedAt ?? r.sentAt) - r.sentAt)]

/** Les morceaux actifs d'une requête relevée : son intervalle sans ses attentes de l'utilisateur (`netSpans`). */
const activeSpansOf = (r: RequestRecord): Span[] => netSpans(r, spanOfRecord(r)[1])

/** L'heure locale d'un instant, de 0 à 23. */
const hourOf = (ms: number, tz: number): number => new Date(ms - tz * 60_000).getUTCHours()

/** Un intervalle coupé aux heures locales (donc aussi à minuit) : [jour, heure, début, fin] par morceau. */
function piecesOf([a, b]: Span, tz: number): [string, number, number, number][] {
  const out: [string, number, number, number][] = []
  let start = a
  while (start < b) {
    // La fin de l'heure locale en cours : les décalages horaires sont des heures entières ou des demi-heures.
    const local = start - tz * 60_000
    const end = Math.min(b, start + (HOUR_MS - (((local % HOUR_MS) + HOUR_MS) % HOUR_MS)))
    out.push([dayOf(start, tz), hourOf(start, tz), start, end])
    start = end
  }
  return out
}

/** Les jours qu'un relevé touche : ceux de ses intervalles et de l'envoi de ses requêtes. */
export function daysOfLog(log: RequestLog, tz: number): string[] {
  const days = new Set<string>()
  for (const r of log.requests) {
    days.add(dayOf(r.sentAt, tz))
    for (const [day] of piecesOf(spanOfRecord(r), tz)) days.add(day)
  }
  return [...days].sort()
}

/** Le projet d'un relevé (sa clé ccusage) ; le temps actif se regroupe ensuite par projet affiché (`groupOf`). */
const projectOf = (log: RequestLog): string => log.project ?? UNKNOWN

/** Les lignes de durée des jours `days`, tirées de tous les relevés qui les touchent. */
function rowsOf(logs: readonly RequestLog[], days: ReadonlySet<string>, tz: number, machine: string): Required<Pick<Durations, 'api' | 'active' | 'hours' | 'sessions' | 'times'>> {
  const times = new Map<string, TimesRow>()
  const byHour = new Map<string, Span[]>()
  // Le temps cumulé d'une heure : la somme des temps actifs de chaque discussion dans cette heure.
  const bySessionHour = new Map<string, Span[]>()
  const byProject = new Map<string, { spans: Span[]; requests: number }>()
  const bySession = new Map<string, { project: string; spans: Span[]; apiMs: number; requests: number }>()
  const api = new Map<string, ApiRow>()
  /** L'entrée `key` de `map`, créée par `make` si elle manque. */
  const slot = <T,>(map: Map<string, T>, key: string, make: () => T): T => {
    let x = map.get(key)
    if (!x) map.set(key, (x = make()))
    return x
  }
  for (const log of logs) {
    const project = projectOf(log)
    const group = groupOf(project, {})
    for (const r of log.requests) {
      for (const [day, hour, a, b] of activeSpansOf(r).flatMap((span) => piecesOf(span, tz))) {
        if (!days.has(day)) continue
        slot(byHour, `${day}|${hour}`, () => []).push([a, b])
        slot(bySessionHour, `${day}|${hour}|${log.session}`, () => []).push([a, b])
        slot(byProject, `${day}|${group}`, () => ({ spans: [], requests: 0 })).spans.push([a, b])
        slot(bySession, `${day}|${log.session}`, () => ({ project, spans: [], apiMs: 0, requests: 0 })).spans.push([a, b])
      }
      // Requêtes et appels : au jour de l'envoi.
      const sent = dayOf(r.sentAt, tz)
      if (!days.has(sent)) continue
      slot(byProject, `${sent}|${group}`, () => ({ spans: [], requests: 0 })).requests += 1
      const s = slot(bySession, `${sent}|${log.session}`, () => ({ project, spans: [], apiMs: 0, requests: 0 }))
      s.requests += 1
      s.apiMs += r.apiMs
      slot(times, `${sent}|${group}`, () => ({ date: sent, project: group, machine, seconds: [] })).seconds.push(Math.round(activeSpansOf(r).reduce((n, [a, b]) => n + b - a, 0) / 1000))
      for (const [model, m] of Object.entries(r.models)) {
        const row = slot(api, `${sent}|${project}|${model}`, () => ({ date: sent, project, machine, model, apiMs: 0, genMs: 0, output: 0, calls: 0, speeds: {} }))
        row.apiMs += m.apiMs
        row.genMs += m.genMs
        row.output += m.output
        row.calls += m.calls
        mergeSpeeds((row.speeds ??= {}), m.speeds)
      }
    }
  }
  const hours = new Map<string, HourRow>()
  const hourOfDate = (date: string) => slot(hours, date, () => ({ date, machine, hours: Array.from({ length: 24 }, () => 0), cumul: Array.from({ length: 24 }, () => 0) }))
  for (const [key, spans] of byHour) {
    const [date, hour] = key.split('|') as [string, string]
    hourOfDate(date).hours[Number(hour)] = activeMs(spans)
  }
  for (const [key, spans] of bySessionHour) {
    const [date, hour] = key.split('|') as [string, string]
    hourOfDate(date).cumul![Number(hour)]! += activeMs(spans)
  }
  const sessions: SessionDayRow[] = [...bySession].map(([key, x]) => {
    const [date, session] = key.split('|') as [string, string]
    return { date, session, project: x.project, machine, activeMs: activeMs(x.spans), apiMs: x.apiMs, requests: x.requests }
  })
  // Le temps cumulé d'un projet : la somme des temps actifs de ses discussions ce jour-là.
  const cumul = new Map<string, number>()
  for (const s of sessions) cumul.set(`${s.date}|${groupOf(s.project, {})}`, (cumul.get(`${s.date}|${groupOf(s.project, {})}`) ?? 0) + s.activeMs)
  const active: ActiveRow[] = [...byProject].map(([key, x]) => {
    const [date, project] = key.split('|') as [string, string]
    return { date, project, machine, activeMs: activeMs(x.spans), requests: x.requests, cumulMs: cumul.get(key) ?? 0 }
  })
  return { api: [...api.values()], active, hours: [...hours.values()], sessions, times: [...times.values()] }
}

const byDate = <T extends { date: string }>(a: T, b: T): number => a.date.localeCompare(b.date)

/**
 * Les durées du poste après un nouveau relevé. Un fichier modifié (`mtimeMs`), ajouté ou effacé
 * fait recalculer les jours qu'il touchait et qu'il touche ; ces jours sont refaits à partir de
 * tous les fichiers qui les touchent. Un fichier illisible (en cours d'écriture par une autre
 * session) est laissé de côté : ses jours gardent leurs totaux, et il est relu au relevé suivant
 * (décision « Ignorer et relire »). Illisible et inchangé depuis plus d'une
 * heure (`now`), il n'est plus en cours d'écriture : il est laissé de côté pour de bon, ses jours refaits
 * sans lui, jamais réécrit ni supprimé, et relu s'il change (décision « Laisser de côté après 1 h »). `read` rend
 * `BROKEN` pour un contenu coupé (JSON illisible), le seul cas qui se laisse de côté, et null pour une
 * lecture qui échoue (erreur passagère, autre format) : ses jours attendent le relevé suivant. Sans
 * `now`, aucun fichier n'est laissé de côté.
 */
export async function refreshDurations(
  prev: Durations,
  entries: readonly { name: string; mtimeMs: number }[],
  read: (name: string) => Promise<RequestLog | typeof BROKEN | null>,
  tz: number,
  machine: string,
  now = 0,
): Promise<Durations> {
  const onDisk = new Map(entries.map((e) => [e.name, e.mtimeMs]))
  const changed = entries.filter((e) => prev.files[e.name]?.mtimeMs !== e.mtimeMs).map((e) => e.name)
  const isChanged = new Set(changed)
  const removed = Object.keys(prev.files).filter((name) => !onDisk.has(name))
  const isSameMachine = [...prev.api, ...prev.active, ...prev.hours, ...prev.sessions, ...(prev.times ?? [])].every((r) => r.machine === machine)
  if (!changed.length && !removed.length && isSameMachine) return prev
  const logs = new Map<string, RequestLog>()
  const blocked = new Set<string>()
  const days = new Set<string>()
  // Illisible depuis plus d'une heure : abandonné par sa session, ses jours se refont sans lui.
  const abandoned = new Set<string>()
  const isAbandoned = (name: string) => now - (onDisk.get(name) ?? now) > ABANDONED_MS
  const unreadable = (name: string, why: typeof BROKEN | null) => {
    if (why === BROKEN && isAbandoned(name)) {
      abandoned.add(name)
      prev.files[name]?.days.forEach((d) => days.add(d))
    } else prev.files[name]?.days.forEach((d) => blocked.add(d))
  }
  for (const name of changed) {
    const log = await read(name)
    if (!log || log === BROKEN) {
      unreadable(name, log)
      continue
    }
    logs.set(name, log)
    for (const d of [...(prev.files[name]?.days ?? []), ...daysOfLog(log, tz)]) days.add(d)
  }
  for (const name of removed) prev.files[name]!.days.forEach((d) => days.add(d))
  // Les autres fichiers de ces jours : leur union en dépend. Un fichier laissé de côté en route ajoute
  // ses jours : on repasse tant que la liste des jours grandit.
  const tried = new Set<string>()
  for (let size = -1; size !== days.size; ) {
    size = days.size
    for (const [name, f] of Object.entries(prev.files)) {
      if (tried.has(name) || logs.has(name) || !onDisk.has(name) || isChanged.has(name) || !f.days.some((d) => days.has(d))) continue
      tried.add(name)
      const log = await read(name)
      if (log && log !== BROKEN) logs.set(name, log)
      else unreadable(name, log)
    }
  }
  blocked.forEach((d) => days.delete(d))
  const fresh = rowsOf([...logs.values()], days, tz, machine)
  const keep = <T extends { date: string; machine: string }>(rows: readonly T[], add: readonly T[]): T[] => [...rows.filter((r) => !days.has(r.date)).map((r) => ({ ...r, machine })), ...add].sort(byDate)
  const files = { ...prev.files }
  for (const name of removed) delete files[name]
  // Gardé dans l'index sans jour : il n'est relu que s'il change.
  for (const name of abandoned) files[name] = { mtimeMs: onDisk.get(name)!, days: [] }
  // Un fichier relu dont un jour reste à refaire garde son ancienne date : il sera relu.
  for (const [name, log] of logs) {
    const touched = daysOfLog(log, tz)
    if (isChanged.has(name) && !touched.some((d) => blocked.has(d))) files[name] = { mtimeMs: onDisk.get(name)!, days: touched }
  }
  const next = { files, api: keep(prev.api, fresh.api), active: keep(prev.active, fresh.active), hours: keep(prev.hours, fresh.hours), sessions: keep(prev.sessions, fresh.sessions), times: keep(prev.times ?? [], fresh.times) }
  return { since: earliest([...next.active, ...next.api].map((r) => r.date)), ...next }
}

/** Bornes d'une requête plausible : envoyée entre 2020 et 2100, durée réelle de 30 jours au plus. */
const FIRST_DATE = Date.UTC(2020, 0, 1)
const LAST_DATE = Date.UTC(2100, 0, 1)
const MAX_REQUEST_MS = 30 * 24 * HOUR_MS

const isFiniteIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const finiteOrZero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Les appels d'un modèle lus sur le disque : des nombres finis, sinon 0 ; null pour autre chose qu'un objet. */
function parseStats(v: unknown): CallStats | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const s = v as Record<string, unknown>
  const speeds: Record<string, number> = {}
  if (s.speeds && typeof s.speeds === 'object') for (const [k, n] of Object.entries(s.speeds)) if (/^\d+$/.test(k) && isFiniteIn(n, 0, Number.MAX_SAFE_INTEGER)) speeds[k] = n
  const [calls, input, output, cacheWrite, cacheRead, apiMs, genMs, cost] = [s.calls, s.input, s.output, s.cacheWrite, s.cacheRead, s.apiMs, s.genMs, s.cost].map(finiteOrZero) as number[]
  return { calls: calls!, input: input!, output: output!, cacheWrite: cacheWrite!, cacheRead: cacheRead!, apiMs: apiMs!, genMs: genMs!, cost: cost!, isEstimated: s.isEstimated === true, speeds }
}

/** Les modèles d'une requête ou du hors-requête, sans ce qui n'est pas un objet de chiffres. */
function parseModels(v: unknown): Record<string, CallStats> {
  const out: Record<string, CallStats> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [model, raw] of Object.entries(v)) {
    const stats = parseStats(raw)
    if (stats) Object.defineProperty(out, model, { value: stats, enumerable: true, writable: true, configurable: true })
  }
  return out
}

/**
 * Une requête relevée plausible, ou null : dates et durées finies et dans des bornes raisonnables (un
 * fichier édité à la main ou abîmé ne doit ni faire boucler la découpe aux heures ni faire lever `dayOf`).
 */
function parseRecord(v: unknown): RequestRecord | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (!isFiniteIn(r.sentAt, FIRST_DATE, LAST_DATE) || !isFiniteIn(r.realMs, 0, MAX_REQUEST_MS) || !isFiniteIn(r.apiMs, 0, Number.MAX_SAFE_INTEGER)) return null
  if (r.endedAt !== null && r.endedAt !== undefined && !isFiniteIn(r.endedAt, r.sentAt, r.sentAt + MAX_REQUEST_MS)) return null
  return {
    id: finiteOrZero(r.id),
    sentAt: r.sentAt,
    endedAt: typeof r.endedAt === 'number' ? r.endedAt : null,
    realMs: r.realMs,
    isOpen: r.isOpen === true,
    tasks: finiteOrZero(r.tasks),
    apiMs: r.apiMs,
    agents: finiteOrZero(r.agents),
    models: parseModels(r.models),
    ...waitsOf(r, r.sentAt),
  }
}

/**
 * Les attentes et les appels pendant les attentes d'une requête lue sur le disque, bornés à ses 30
 * jours : un intervalle impossible est écarté ; une attente restée ouverte (un redémarrage pendant
 * la question) garde sa fin null, et va jusqu'à la fin de la requête (`netSpans`), jamais jusqu'à
 * maintenant.
 */
function waitsOf(r: Record<string, unknown>, sentAt: number): Pick<RequestRecord, 'waits' | 'busy'> {
  const isIn = (v: unknown): v is number => isFiniteIn(v, sentAt, sentAt + MAX_REQUEST_MS)
  const pairs = (v: unknown): unknown[][] => (Array.isArray(v) ? v.filter((p): p is unknown[] => Array.isArray(p) && p.length === 2) : [])
  const waits = pairs(r.waits)
    .filter(([a, b]) => isIn(a) && (b === null || (isIn(b) && b >= a)))
    .map(([a, b]) => [a, b] as [number, number | null])
  const busy = pairs(r.busy)
    .filter(([a, b]) => isIn(a) && isIn(b) && b > a)
    .map(([a, b]) => [a, b] as [number, number])
  return { ...(waits.length ? { waits } : {}), ...(busy.length ? { busy } : {}) }
}

/**
 * Un fichier de relevé lu sur le disque. Null pour un autre format (une version plus récente : il
 * attend) ; `BROKEN` pour un fichier au format 1 sans session ni liste de requêtes (il peut être
 * laissé de côté). Ses requêtes impossibles sont écartées une à une.
 */
export function parseRequestLog(json: unknown): RequestLog | typeof BROKEN | null {
  const x = json as Record<string, unknown> | null
  if (!x || typeof x !== 'object' || x.schema !== REQUEST_SCHEMA) return null
  if (typeof x.session !== 'string' || !Array.isArray(x.requests)) return BROKEN
  const requests = x.requests.map(parseRecord).filter((r): r is RequestRecord => r !== null)
  return { schema: REQUEST_SCHEMA, session: x.session, openedAt: finiteOrZero(x.openedAt), project: typeof x.project === 'string' ? x.project : null, requests, outside: parseModels(x.outside) }
}

/** La moyenne par jour actif d'une durée, sur les jours suivis seulement (depuis `since`) ; null sans jour actif suivi. */
export function averageOf(values: ReadonlyMap<string, number>, since: string | null): number | null {
  if (since === null) return null
  const tracked = [...values].filter(([d, v]) => d >= since && v > 0).map(([, v]) => v)
  return tracked.length ? tracked.reduce((n, v) => n + v, 0) / tracked.length : null
}

/** Les durées de tous les postes lus : celles de ce poste et celles que publient les autres. */
export type AllDurations = Pick<Durations, 'api' | 'active' | 'hours' | 'sessions' | 'times'> & {
  /** Premier jour suivi de chaque poste qui a des durées. */
  sinceBy: Record<string, string>
}

/** Les durées de ce poste (`own`, au nom `machine`) et celles des autres postes, ensemble. */
export function combine(own: Durations, machine: string, peers?: PeerDurations | null): AllDurations {
  return {
    api: [...own.api, ...(peers?.api ?? [])],
    active: [...own.active, ...(peers?.active ?? [])],
    hours: [...own.hours, ...(peers?.hours ?? [])],
    sessions: [...own.sessions, ...(peers?.sessions ?? [])],
    times: own.times ?? [],
    sinceBy: { ...(peers?.sinceBy ?? {}), ...(own.since ? { [machine]: own.since } : {}) },
  }
}

/** Les durées sous les filtres de l'en-tête, par jour : ce que les vues affichent. */
export type Measures = {
  /**
   * Premier jour suivi pour ces filtres : celui du poste filtré, sinon le plus ancien des postes
   * lus ; null : rien de mesuré (un poste au format publié 1, avant la 0.10.0).
   */
  since: string | null
  /** Premier jour suivi de chaque poste. */
  sinceBy: Record<string, string>
  /** Le temps actif n'a pas de sens par modèle (une requête mêle plusieurs modèles) : faux sous un filtre de modèle. */
  hasActive: boolean
  active: Map<string, number>
  api: Map<string, number>
  requests: Map<string, number>
  /** Temps actif par jour et par projet affiché. */
  projects: Map<string, Map<string, number>>
  /**
   * Temps cumulé par jour (la somme des temps actifs des discussions), et par jour et projet affiché.
   * Un jour où un poste ne le publie pas encore (d'avant la 0.11.0) est dans `cumulGaps` : « — », jamais 0.
   */
  cumul: Map<string, number>
  projectsCumul: Map<string, Map<string, number>>
  cumulGaps: Set<string>
  /** Temps actif par jour et par discussion. */
  sessions: Map<string, Map<string, number>>
}

/**
 * Les durées sous les filtres de poste, de projet et de modèle. Sans filtre de projet, le temps
 * actif d'un jour est celui de ses heures, sans double compte entre projets ; entre deux postes, les
 * temps s'additionnent (deux postes, deux travaux).
 */
export function measuresOf(d: AllDurations, f: { machine: string; project: string | null; model: string | null }, projects: Record<string, ProjectInfo>): Measures {
  const since = earliest(f.machine === 'all' ? Object.values(d.sinceBy) : d.sinceBy[f.machine] ? [d.sinceBy[f.machine]!] : [])
  const out: Measures = { since, sinceBy: d.sinceBy, hasActive: f.model === null, active: new Map(), api: new Map(), requests: new Map(), projects: new Map(), sessions: new Map(), cumul: new Map(), projectsCumul: new Map(), cumulGaps: new Set() }
  const gaps = new Set<string>()
  const add = (map: Map<string, number>, key: string, v: number) => map.set(key, (map.get(key) ?? 0) + v)
  const inner = (map: Map<string, Map<string, number>>, date: string) => map.get(date) ?? map.set(date, new Map()).get(date)!
  const isKept = (r: { project: string; machine: string }) => (f.machine === 'all' || r.machine === f.machine) && (f.project === null || groupOf(r.project, projects) === f.project)
  for (const r of d.api) if (isKept(r) && (f.model === null || r.model === f.model)) add(out.api, r.date, r.apiMs)
  for (const r of d.active) {
    if (!isKept(r)) continue
    add(inner(out.projects, r.date), groupOf(r.project, projects), r.activeMs)
    add(out.requests, r.date, r.requests)
    if (r.cumulMs === undefined) gaps.add(`${r.date}|${groupOf(r.project, projects)}`)
    else add(inner(out.projectsCumul, r.date), groupOf(r.project, projects), r.cumulMs)
    if (f.project !== null) add(out.active, r.date, r.activeMs)
  }
  if (f.project === null) for (const h of d.hours) if (f.machine === 'all' || h.machine === f.machine) add(out.active, h.date, h.hours.reduce((n, ms) => n + ms, 0))
  for (const s of d.sessions) if (isKept(s)) add(inner(out.sessions, s.date), s.session, s.activeMs)
  for (const key of gaps) {
    const [date, group] = key.split('|') as [string, string]
    out.projectsCumul.get(date)?.delete(group)
  }
  for (const key of gaps) out.cumulGaps.add(key.slice(0, key.indexOf('|')))
  for (const [date, byProject] of out.projectsCumul) if (!out.cumulGaps.has(date)) out.cumul.set(date, [...byProject.values()].reduce((n, v) => n + v, 0))
  if (!out.hasActive) {
    out.active.clear()
    out.cumul.clear()
    out.projectsCumul.clear()
  }
  return out
}

/** La médiane de vitesses rangées par classes de 10 tokens/s : le milieu de la classe médiane ; null sans appel. */
export function speedMedian(speeds: Readonly<Record<string, number>>): number | null {
  const classes = Object.entries(speeds)
    .map(([k, n]) => [Number(k), n] as const)
    .filter(([k, n]) => Number.isFinite(k) && n > 0)
    .sort((a, b) => a[0] - b[0])
  const all = classes.reduce((n, [, c]) => n + c, 0)
  if (!all) return null
  let seen = 0
  for (const [k, n] of classes) {
    seen += n
    if (seen * 2 >= all) return k + 5
  }
  return null
}

/** Le coût par heure active ; null sous une minute de temps actif, où le chiffre ne veut rien dire. */
export const costPerActiveHour = (cost: number, activeMs: number): number | null => (activeMs >= 60_000 ? cost / (activeMs / HOUR_MS) : null)

/** Les durées d'une période (de `from` à `to`) sous les filtres : par modèle, par projet, par discussion, par heure, et les requêtes. */
export type PeriodMeasures = {
  models: Map<string, Pick<ApiRow, 'apiMs' | 'genMs' | 'output' | 'calls'> & { speeds: Record<string, number> }>
  projects: Map<string, number>
  /** Temps cumulé par projet ; null pour un projet dont un poste ne le publie pas encore sur la période. */
  projectsCumul: Map<string, number | null>
  sessions: Map<string, number>
  hours: number[]
  /** Temps cumulé par heure ; null quand un poste ne le publie pas encore sur la période. */
  hoursCumul: number[] | null
  /** Durées réelles des requêtes de la période, en ms (ce poste seulement : les autres ne publient que des totaux). */
  requestMs: number[]
}

/** `from` : premier jour de la période ; null pour « tout ». */
export function periodOf(d: AllDurations, f: { machine: string; project: string | null; model: string | null }, from: string | null, to: string, projects: Record<string, ProjectInfo>): PeriodMeasures {
  const out: PeriodMeasures = { models: new Map(), projects: new Map(), projectsCumul: new Map(), sessions: new Map(), hours: Array.from({ length: 24 }, () => 0), hoursCumul: Array.from({ length: 24 }, () => 0), requestMs: [] }
  const isIn = (date: string) => (from === null || date >= from) && date <= to
  const isMachine = (machine: string) => f.machine === 'all' || machine === f.machine
  const isKept = (r: { project: string; machine: string }) => isMachine(r.machine) && (f.project === null || groupOf(r.project, projects) === f.project)
  for (const r of d.api) {
    if (!isIn(r.date) || !isKept(r) || (f.model !== null && r.model !== f.model)) continue
    const m = out.models.get(r.model) ?? { apiMs: 0, genMs: 0, output: 0, calls: 0, speeds: {} }
    m.apiMs += r.apiMs
    m.genMs += r.genMs
    m.output += r.output
    m.calls += r.calls
    mergeSpeeds(m.speeds, r.speeds)
    out.models.set(r.model, m)
  }
  // Pas de temps actif par modèle : sous un filtre de modèle, projets, discussions et heures restent vides.
  if (f.model !== null) return out
  for (const r of d.active) {
    if (!isIn(r.date) || !isKept(r)) continue
    const group = groupOf(r.project, projects)
    out.projects.set(group, (out.projects.get(group) ?? 0) + r.activeMs)
    const known = out.projectsCumul.has(group) ? out.projectsCumul.get(group)! : 0
    out.projectsCumul.set(group, known === null || r.cumulMs === undefined ? null : known + r.cumulMs)
  }
  for (const s of d.sessions) if (isIn(s.date) && isKept(s)) out.sessions.set(s.session, (out.sessions.get(s.session) ?? 0) + s.activeMs)
  for (const t of d.times ?? []) if (isIn(t.date) && isKept(t)) out.requestMs.push(...t.seconds.map((s) => s * 1000))
  // Les heures ne disent pas leur projet : seulement sans filtre de projet.
  if (f.project !== null) return out
  for (const h of d.hours) {
    if (!isIn(h.date) || !isMachine(h.machine)) continue
    h.hours.forEach((ms, i) => (out.hours[i]! += ms))
    if (!h.cumul) out.hoursCumul = null
    else if (out.hoursCumul) h.cumul.forEach((ms, i) => (out.hoursCumul![i]! += ms))
  }
  return out
}
