// Données pures de stats-board : palette, lecture des sorties de ccusage et du cache de
// /stats, fusion avec les usages des autres postes, filtres, agrégats et libellés en français.
// Aucun appel au moteur ici : tout ce qui touche `$` vit dans register.tsx.

import type { Activity, ApiRow, BlockRow, DiscussionEntry, Durations, Grain, Machine, Metric, PeerDurations, Period, ProjectInfo, Published, SessionRow, Ui, UsageRow } from '../types'

// Couleurs brutes (hex) mi-tons, copiées de git-board (hooks/model.ts) : lisibles en thème
// clair comme sombre, sur le terminal comme sur le desktop.
export const C = {
  violet: '#9B7BEA',
  lilac: '#B79BF5',
  blue: '#4A9EE8',
  cyan: '#2EB8C9',
  teal: '#3FB68B',
  tangerine: '#E8913A',
  coral: '#EF7D57',
  amber: '#D9A520',
  green: '#4CB782',
  red: '#E5534B',
  pink: '#E06C9F',
  magenta: '#C36BD9',
  indigo: '#7C83F2',
  sky: '#56B4E9',
  sand: '#C9A66B',
  slate: '#7F8EA3',
  gray: '#8B8B93',
  /** Texte foncé posé sur un aplat de couleur. */
  ink: '#17171C',
} as const

// L'app desktop fond les espaces ordinaires : les écarts dans un texte sont insécables.
// NB contient une espace insécable U+00A0 littérale (invisible) : ne pas la remplacer.
export const NB = ' '
export const SEP = `${NB}${NB}·${NB}${NB}`

/** Couleur d'identité du mod (bleu ciel, comme les stats du desktop) ; l'ambre dit l'argent. */
export const BRAND = C.sky
export const MONEY = C.amber

/** Format du relevé (`Snapshot.schema`) : 3 depuis que chaque ligne dit son poste, 4 avec les durées. */
export const SCHEMA = 4
/**
 * Format du fichier qu'un poste publie dans `claude-usage` (`Published.schema`). Les durées de la
 * 0.10.0 s'y ajoutent sans changer de format : un poste pas encore mis à jour lit le reste (décision
 * « Garder schema 1 + champs ») ; un fichier sans elles n'a pas de durée mesurée.
 */
export const PUBLISH_SCHEMA = 1
/** Le nom de ce poste quand aucun n'est réglé : ses usages ne sont alors pas publiés. */
export const LOCAL_LABEL = 'Ce poste'
/** Les brouillons du desktop (`scratch-workspaces`), réunis en un seul projet. */
export const DRAFTS = '@brouillons'
/** Lignes que ccusage n'a rattachées à aucun projet. */
export const UNKNOWN = '@inconnu'
export const UNKNOWN_MODEL = '@modele-inconnu'

export const DAY_MS = 86_400_000

type Json = Record<string, any>

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const finiteOrUndefined = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
export const unique = <T,>(list: readonly T[]): T[] => [...new Set(list)]

// ─── Lecture des sorties de ccusage ─────────────────────────────────────────

/** Le JSON d'une sortie de ccusage : ce qui précède la première accolade est ignoré. */
export function parseJson(out: string): Json {
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('sortie illisible (pas de JSON)')
  return JSON.parse(out.slice(start, end + 1))
}

const isDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date)

/** Les lignes d'un jour de ccusage, une par modèle. `date` en v20, `period` dans le rapport tous agents. */
function rowsOfDay(day: Json, project: string, machine: string): UsageRow[] {
  const date = str(day?.date) || str(day?.period)
  if (!isDate(date)) return []
  const parts: Json[] = Array.isArray(day.modelBreakdowns) ? day.modelBreakdowns : []
  const rows: UsageRow[] = parts.length
    ? parts.map((m) => ({
        date,
        project,
        machine,
        model: str(m.modelName) || UNKNOWN_MODEL,
        input: num(m.inputTokens),
        output: num(m.outputTokens),
        cacheWrite: num(m.cacheCreationTokens),
        cacheRead: num(m.cacheReadTokens),
        cost: num(m.cost),
      }))
    : [
        {
          date,
          project,
          machine,
          model: UNKNOWN_MODEL,
          input: num(day.inputTokens),
          output: num(day.outputTokens),
          cacheWrite: num(day.cacheCreationTokens),
          cacheRead: num(day.cacheReadTokens),
          cost: num(day.totalCost),
        },
      ]
  // `<synthetic>` : les messages que Claude Code fabrique lui-même, sans token.
  return rows.filter((r) => r.model !== '<synthetic>' && r.input + r.output + r.cacheWrite + r.cacheRead + r.cost > 0)
}

/** `ccusage claude daily --json --instances` : `{ projects: { clé: jours[] }, totals }` ; sans projets, `{ daily }`. */
export function rowsOfDaily(json: Json, machine: string): UsageRow[] {
  if (json?.projects && typeof json.projects === 'object') {
    return Object.entries(json.projects as Record<string, unknown>).flatMap(([key, days]) =>
      Array.isArray(days) ? days.flatMap((d) => rowsOfDay(d, key === 'unknown' ? UNKNOWN : key, machine)) : [],
    )
  }
  return (Array.isArray(json?.daily) ? json.daily : []).flatMap((d: Json) => rowsOfDay(d, UNKNOWN, machine))
}

/** `ccusage claude session --json` : `{ sessions: [...] }`. */
export function sessionsOf(json: Json, machine: string): SessionRow[] {
  const list: Json[] = Array.isArray(json?.sessions) ? json.sessions : Array.isArray(json?.session) ? json.session : []
  const out: SessionRow[] = []
  for (const s of list) {
    const last = Date.parse(str(s.lastActivity) || str(s.metadata?.lastActivity))
    const first = Date.parse(str(s.firstActivity))
    const id = str(s.sessionId) || str(s.period)
    if (!id || !Number.isFinite(last)) continue
    // Un sous-agent de workflow écrit sous `<projet>\<session>\subagents\…` : il compte pour son
    // projet et se rattache à la discussion qui l'a lancé.
    const path = str(s.projectPath).split(/[\\/]/)
    out.push({
      id,
      machine,
      project: path[0] || UNKNOWN,
      parent: path[2] === 'subagents' && path[1] ? path[1] : null,
      first: Number.isFinite(first) ? first : last,
      last,
      cost: num(s.totalCost),
      tokens: num(s.totalTokens),
      output: num(s.outputTokens),
      models: strings(s.modelsUsed).filter((m) => m !== '<synthetic>'),
    })
  }
  return out
}

/** `ccusage claude blocks --json` : les blocs de 5 h, sans les creux (`isGap`). */
export function blocksOf(json: Json): BlockRow[] {
  const list: Json[] = Array.isArray(json?.blocks) ? json.blocks : []
  const out: BlockRow[] = []
  for (const b of list) {
    if (b.isGap === true) continue
    const start = Date.parse(str(b.startTime))
    if (!Number.isFinite(start)) continue
    const end = Date.parse(str(b.endTime))
    const lastAt = Date.parse(str(b.actualEndTime))
    const tc = b.tokenCounts ?? {}
    const tokens = num(b.totalTokens) || num(tc.inputTokens) + num(tc.outputTokens) + num(tc.cacheCreationInputTokens) + num(tc.cacheReadInputTokens)
    out.push({
      start,
      end: Number.isFinite(end) ? end : start + 5 * 3_600_000,
      lastAt: Number.isFinite(lastAt) ? lastAt : start,
      isActive: b.isActive === true,
      cost: num(b.costUSD),
      tokens,
      models: strings(b.models).filter((m) => m !== '<synthetic>'),
      costPerHour: b.burnRate ? num(b.burnRate.costPerHour) : null,
      projectedCost: b.projection ? num(b.projection.totalCost) : null,
      remainingMinutes: b.projection ? num(b.projection.remainingMinutes) : null,
    })
  }
  return out
}

/** Les modèles sans prix : `totals.unpricedModels` et les `missingPricing` du détail par modèle. */
export function unpricedOf(...jsons: (Json | null)[]): string[] {
  const found = new Set<string>()
  const scanDays = (days: unknown) => {
    if (!Array.isArray(days)) return
    for (const d of days) for (const m of Array.isArray(d?.modelBreakdowns) ? d.modelBreakdowns : []) if (m?.missingPricing === true && typeof m.modelName === 'string') found.add(m.modelName)
  }
  for (const json of jsons) {
    if (!json) continue
    strings(json.totals?.unpricedModels).forEach((m) => found.add(m))
    scanDays(json.daily)
    scanDays(json.sessions)
    if (json.projects && typeof json.projects === 'object') Object.values(json.projects as Record<string, unknown>).forEach(scanDays)
  }
  found.delete('<synthetic>')
  return [...found].sort()
}

/** Le cache de /stats de Claude Code (`~/.claude/stats-cache.json`). */
export function activityOf(json: Json): Activity | null {
  if (!json || typeof json !== 'object' || !Array.isArray(json.dailyActivity)) return null
  const days = (json.dailyActivity as Json[])
    .map((d) => ({ date: str(d.date), messages: num(d.messageCount), sessions: num(d.sessionCount), tools: num(d.toolCallCount) }))
    .filter((d) => isDate(d.date))
  const hours = Array.from({ length: 24 }, (_, h) => num(json.hourCounts?.[String(h)]))
  const l = json.longestSession
  return {
    through: str(json.lastComputedDate) || null,
    days,
    hours,
    sessions: num(json.totalSessions),
    messages: num(json.totalMessages),
    longest: l && typeof l === 'object' ? { ms: num(l.duration), messages: num(l.messageCount), at: str(l.timestamp) } : null,
    since: str(json.firstSessionDate) || null,
  }
}

/**
 * Garde les jours que Claude Code a effacés (ses journaux ne vivent que `cleanupPeriodDays`
 * jours) : les lignes de ce poste dans le relevé précédent plus anciennes que le premier jour
 * du nouveau. Celles des autres postes reviennent par leurs fichiers publiés.
 */
export function keepHistory(fresh: UsageRow[], previous: readonly UsageRow[] | undefined, machine: string): { rows: UsageRow[]; kept: number } {
  const mine = (previous ?? []).filter((r) => r.machine === machine)
  if (!mine.length) return { rows: fresh, kept: 0 }
  // Rien de frais (poste resté inactif plus longtemps que les journaux) : tout l'historique reste.
  const first = fresh.length ? fresh.reduce((m, r) => (r.date < m ? r.date : m), fresh[0]!.date) : '9999-12-31'
  const old = mine.filter((r) => r.date < first)
  return { rows: [...old, ...fresh], kept: unique(old.map((r) => r.date)).length }
}

/** Les sessions de ce poste dans le relevé précédent que le nouveau n'a plus, parce que leurs journaux ont été effacés. */
export function keepSessions(fresh: SessionRow[], previous: readonly SessionRow[] | undefined, machine: string): SessionRow[] {
  const mine = (previous ?? []).filter((s) => s.machine === machine)
  if (!mine.length) return fresh
  const ids = new Set(fresh.map((s) => s.id))
  const first = minOf(fresh.map((s) => s.first))
  // À la minute près : une session reprise du fichier publié a sa fin arrondie à la minute d'après
  // (décision « Historique »).
  const limit = Number.isFinite(first) ? Math.ceil(first / 60_000) * 60_000 : first
  return [...mine.filter((s) => !ids.has(s.id) && (s.last < first || s.last <= limit)), ...fresh]
}

/**
 * L'historique connu de ce poste, sous son nom actuel, pour `keepHistory` et `keepSessions` :
 * le relevé gardé (ses lignes à ce nom ou encore « Ce poste »), un relevé gardé de l'ancien
 * format (schéma 2 : tout sauf l'ancien PC) et le fichier que ce poste a déjà publié. Ainsi ni
 * une mise à jour du mod, ni un premier nommage, ni un nouveau clone ne perdent les jours que
 * Claude Code a effacés. Une ligne présente deux fois (même jour, projet et modèle) compte une fois.
 */
export function ownHistory(machine: string, sources: { previous?: { rows: readonly UsageRow[]; sessions: readonly SessionRow[] } | null; legacy?: Json | null; published?: Published | null }): { rows: UsageRow[]; sessions: SessionRow[] } {
  const rows = new Map<string, UsageRow>()
  const sessions = new Map<string, SessionRow>()
  const addRow = (r: UsageRow) => {
    const key = `${r.date}|${r.project}|${r.model}`
    if (!rows.has(key)) rows.set(key, { ...r, machine })
  }
  const addSession = (s: SessionRow) => {
    if (!sessions.has(s.id)) sessions.set(s.id, { ...s, machine })
  }
  const isMine = (m: string) => m === machine || m === LOCAL_LABEL
  for (const r of sources.previous?.rows ?? []) if (isMine(r.machine)) addRow(r)
  for (const s of sources.previous?.sessions ?? []) if (isMine(s.machine)) addSession(s)
  const legacy = sources.legacy
  // Schéma 3 : la forme d'aujourd'hui, sans les durées (refaites depuis les fichiers de relevé).
  if (legacy && legacy.schema === 3 && Array.isArray(legacy.rows)) {
    for (const r of legacy.rows as UsageRow[]) if (r && isMine(str(r.machine)) && isDate(str(r.date)) && typeof r.project === 'string') addRow(r)
    for (const s of Array.isArray(legacy.sessions) ? (legacy.sessions as SessionRow[]) : []) if (s && isMine(str(s.machine)) && typeof s.id === 'string' && Number.isFinite(s.last)) addSession(s)
  }
  if (legacy && legacy.schema === 2 && Array.isArray(legacy.rows)) {
    for (const r of legacy.rows as Json[]) if (r && !r.isPast && isDate(str(r.date)) && typeof r.project === 'string') addRow({ date: r.date, project: r.project, machine, model: str(r.model) || UNKNOWN_MODEL, input: num(r.input), output: num(r.output), cacheWrite: num(r.cacheWrite), cacheRead: num(r.cacheRead), cost: num(r.cost) })
    for (const s of Array.isArray(legacy.sessions) ? (legacy.sessions as Json[]) : []) if (s && typeof s.id === 'string' && Number.isFinite(s.last)) addSession({ id: s.id, machine, project: str(s.project) || UNKNOWN, parent: typeof s.parent === 'string' ? s.parent : null, first: num(s.first) || num(s.last), last: num(s.last), cost: num(s.cost), tokens: num(s.tokens), output: num(s.output), models: strings(s.models) })
  }
  for (const r of sources.published?.rows ?? []) addRow(r)
  for (const s of sources.published?.sessions ?? []) addSession(s)
  return { rows: [...rows.values()], sessions: [...sessions.values()] }
}

// ─── Postes ─────────────────────────────────────────────────────────────────

/** Le fichier d'un poste dans le dépôt partagé : `Mac.json`, `Portable.json`… */
export const machineFile = (machine: string): string => `${machine.replace(/[^A-Za-z0-9_-]/g, '_')}.json`

/** Une durée publiée : à la minute, pour qu'aucune heure de requête ne se déduise des totaux (décision « Arrondir à la minute »). */
const toMinute = (ms: number): number => Math.round(ms / 60_000) * 60_000
/** Une heure publiée, vers la minute d'avant (début de session, date de publication). */
export const floorMinute = (ms: number): number => Math.floor(ms / 60_000) * 60_000
/**
 * La fin d'une session publiée : vers la minute d'après, pour ne pas la raccourcir (décision
 * « Heures publiées », avant la livraison), sauf si c'est passer minuit à l'heure du poste : vers la
 * minute d'avant alors, pour que la session reste dans son jour chez les autres postes (décision
 * « Minuit »).
 */
const endMinute = (ms: number, tzOffset: number): number => {
  const up = Math.ceil(ms / 60_000) * 60_000
  return dayOf(up, tzOffset) === dayOf(ms, tzOffset) ? up : floorMinute(ms)
}

/**
 * `Math.min(bound, ...values)` et `Math.max(bound, ...values)` par une boucle : au-delà de 100 000
 * éléments, l'étalement lève une erreur (`scripts/check.py` le refuse).
 */
export const minOf = (values: Iterable<number>, bound = Infinity): number => {
  let min = bound
  for (const v of values) if (v < min) min = v
  return min
}
export const maxOf = (values: Iterable<number>, bound = -Infinity): number => {
  let max = bound
  for (const v of values) if (v > max) max = v
  return max
}

/** La plus petite date d'une liste ; null pour une liste vide. */
export const earliest = (dates: Iterable<string>): string | null => {
  let first: string | null = null
  for (const d of dates) if (first === null || d < first) first = d
  return first
}

/**
 * Ce que ce poste publie : ses lignes, ses sessions, et les projets qu'elles citent (sans
 * `updatedAt`). Depuis la 0.10.0, ses totaux de durée aussi, jamais ses requêtes, leurs heures ni
 * aucun texte (Q13, Q18 révisée), arrondis à la minute : chaque ligne (jour, projet, modèle) reçoit
 * sa durée API, son temps de génération, ses appels relevés et leurs tokens de sortie (`apiOnly`
 * quand ccusage n'a pas encore la ligne) ; chaque session, son temps actif, sa durée API et ses
 * requêtes, et ses heures de début et de fin à la minute aussi ; s'y ajoutent le temps actif par
 * jour et projet, et par jour et heure locale.
 */
export function publishedOf(o: { machine: string; tzOffset: number; rows: readonly UsageRow[]; sessions: readonly SessionRow[]; projects: Record<string, ProjectInfo>; durations?: Durations | null }): Omit<Published, 'updatedAt'> {
  const d = o.durations ?? null
  const timesOf = (a: ApiRow) => ({ apiMs: toMinute(a.apiMs), genMs: toMinute(a.genMs), calls: a.calls, genOutput: a.output })
  const api = new Map<string, ApiRow>((d?.api ?? []).map((a) => [`${a.date}|${a.project}|${a.model}`, a]))
  const used = new Set<string>()
  const rows: UsageRow[] = o.rows.map(({ apiMs: _a, genMs: _g, calls: _c, genOutput: _o, ...r }) => {
    const key = `${r.date}|${r.project}|${r.model}`
    const a = api.get(key)
    if (!a) return r
    used.add(key)
    return { ...r, ...timesOf(a) }
  })
  const apiOnly = [...api]
    .filter(([key]) => !used.has(key))
    .map(([, a]) => ({ date: a.date, project: a.project, model: a.model, ...timesOf(a) }))
    .sort((x, y) => x.date.localeCompare(y.date) || x.project.localeCompare(y.project) || x.model.localeCompare(y.model))
  const totals = new Map<string, { activeMs: number; apiMs: number; requests: number }>()
  for (const s of d?.sessions ?? []) {
    const t = totals.get(s.session) ?? { activeMs: 0, apiMs: 0, requests: 0 }
    t.activeMs += s.activeMs
    t.apiMs += s.apiMs
    t.requests += s.requests
    totals.set(s.session, t)
  }
  const sessions = o.sessions.map(({ activeMs: _a, apiMs: _p, requests: _r, ...row }) => {
    const s = { ...row, first: floorMinute(row.first), last: endMinute(row.last, o.tzOffset) }
    const t = totals.get(s.id)
    return t ? { ...s, activeMs: toMinute(t.activeMs), apiMs: toMinute(t.apiMs), requests: t.requests } : s
  })
  const active = (d?.active ?? [])
    .map((r) => ({ date: r.date, project: r.project, activeMs: toMinute(r.activeMs), requests: r.requests }))
    .sort((x, y) => x.date.localeCompare(y.date) || x.project.localeCompare(y.project))
  const hours = (d?.hours ?? []).map((h) => ({ date: h.date, hours: h.hours.map(toMinute) })).sort((x, y) => x.date.localeCompare(y.date))
  const keys = new Set([...rows.map((r) => r.project), ...sessions.map((s) => s.project), ...apiOnly.map((a) => a.project)])
  const projects: Record<string, ProjectInfo> = {}
  for (const k of [...keys].sort()) if (o.projects[k]) projects[k] = { name: o.projects[k]!.name, path: o.projects[k]!.path }
  // Le temps actif est rangé au dépôt d'un worktree : son dossier, déduit d'un worktree cité, pour le rapprochement des postes.
  for (const r of active) {
    if (projects[r.project] || o.projects[r.project]) {
      if (!projects[r.project] && o.projects[r.project]) projects[r.project] = { name: o.projects[r.project]!.name, path: o.projects[r.project]!.path }
      continue
    }
    const member = Object.entries(o.projects).find(([k, info]) => baseKey(k) === r.project && info.path)
    const path = member?.[1].path?.replace(WORKTREE_PATH, '')
    if (path && projectKey(path) === r.project) projects[r.project] = { name: segments(path).pop() ?? '', path }
  }
  const body: Omit<Published, 'updatedAt'> = { schema: PUBLISH_SCHEMA, machine: o.machine, tzOffset: o.tzOffset, rows, sessions, projects }
  if (d) Object.assign(body, { active, hours, apiOnly })
  return body
}

/** Les champs de durée d'une ligne lue, seulement ceux qui sont là. */
const durationFieldsOf = <K extends string>(x: Json, keys: readonly K[]): Partial<Record<K, number>> =>
  Object.fromEntries(keys.flatMap((k) => (finiteOrUndefined(x[k]) === undefined ? [] : [[k, finiteOrUndefined(x[k])!]]))) as Partial<Record<K, number>>

/** Le fichier publié d'un autre poste, ou null s'il n'a pas la bonne forme. Ses lignes prennent son nom. */
export function parsePublished(json: Json): Published | null {
  if (!json || json.schema !== PUBLISH_SCHEMA || typeof json.machine !== 'string' || !json.machine || !Array.isArray(json.rows)) return null
  const machine: string = json.machine
  const rows = (json.rows as Json[])
    .filter((r) => r && isDate(str(r.date)) && typeof r.project === 'string' && typeof r.model === 'string')
    .map((r): UsageRow => ({ date: r.date, project: r.project, machine, model: r.model, input: num(r.input), output: num(r.output), cacheWrite: num(r.cacheWrite), cacheRead: num(r.cacheRead), cost: num(r.cost), ...durationFieldsOf(r, ['apiMs', 'genMs', 'calls', 'genOutput'] as const) }))
  const sessions = (Array.isArray(json.sessions) ? (json.sessions as Json[]) : [])
    .filter((s) => s && typeof s.id === 'string' && typeof s.project === 'string' && Number.isFinite(s.last))
    .map((s): SessionRow => ({ id: s.id, machine, project: s.project, parent: typeof s.parent === 'string' ? s.parent : null, first: num(s.first) || num(s.last), last: num(s.last), cost: num(s.cost), tokens: num(s.tokens), output: num(s.output), models: strings(s.models), ...durationFieldsOf(s, ['activeMs', 'apiMs', 'requests'] as const) }))
  const projects: Record<string, ProjectInfo> = {}
  for (const [k, v] of Object.entries((json.projects ?? {}) as Record<string, Json>)) {
    if (v && typeof v === 'object') projects[k] = { name: str(v.name), path: typeof v.path === 'string' ? v.path : null }
  }
  const out: Published = { schema: PUBLISH_SCHEMA, machine, updatedAt: num(json.updatedAt), tzOffset: num(json.tzOffset), rows, sessions, projects }
  // Un poste d'avant la 0.10.0 ne publie pas de durée : elles valent « non mesuré ».
  if (Array.isArray(json.active)) out.active = (json.active as Json[]).filter((r) => r && isDate(str(r.date)) && typeof r.project === 'string').map((r) => ({ date: r.date, project: r.project, activeMs: num(r.activeMs), requests: num(r.requests) }))
  if (Array.isArray(json.hours)) out.hours = (json.hours as Json[]).filter((h) => h && isDate(str(h.date)) && Array.isArray(h.hours)).map((h) => ({ date: h.date, hours: Array.from({ length: 24 }, (_, i) => num(h.hours[i])) }))
  if (Array.isArray(json.apiOnly))
    out.apiOnly = (json.apiOnly as Json[])
      .filter((a) => a && isDate(str(a.date)) && typeof a.project === 'string' && typeof a.model === 'string')
      .map((a) => ({ date: a.date, project: a.project, model: a.model, apiMs: num(a.apiMs), genMs: num(a.genMs), calls: num(a.calls), genOutput: num(a.genOutput) }))
  return out
}

/** Le dossier d'une session lancée par SSH depuis le desktop : `ssh-<id de la session>`. */
const SSH_KEY = /^ssh-(.+)$/

/**
 * Ajoute aux usages de ce poste ceux des autres. Un projet d'un autre poste rejoint celui qui porte
 * le même nom de dossier (`C:\dev\PolePredict` et `~/dev/PolePredict`) : il prend la clé déjà connue,
 * celle de ce poste d'abord ; un worktree compte sous le nom de son dépôt. Les brouillons du desktop
 * gardent leur clé : ils se regroupent seuls. Une session SSH du desktop, que le poste qui l'a
 * lancée garde sous `ssh-<id>`, ne compte qu'une fois si le poste où elle a tourné la publie.
 */
export function mergeMachines(
  local: { machine: string; rows: readonly UsageRow[]; sessions: readonly SessionRow[]; projects: Record<string, ProjectInfo> },
  others: readonly Published[],
): { rows: UsageRow[]; sessions: SessionRow[]; projects: Record<string, ProjectInfo>; machines: string[]; sessionless: string[]; peers: PeerDurations } {
  const projects: Record<string, ProjectInfo> = { ...local.projects }
  const peers: PeerDurations = { sinceBy: {}, api: [], active: [], hours: [], sessions: [] }
  const sessionless: string[] = []
  const byName = new Map<string, string>()
  const nameOf = (key: string, info: ProjectInfo | undefined): string | null => {
    const name = info?.name?.toLowerCase()
    return name && !key.startsWith('@') && !isDraft(key, info) ? name : null
  }
  // Les sessions qui ont tourné sur chaque poste : une copie `ssh-<id>` d'une session d'un autre poste est écartée.
  const ranOn = new Map<string, string>()
  for (const p of [{ machine: local.machine, sessions: local.sessions }, ...others]) for (const x of p.sessions) if (!SSH_KEY.test(x.project)) ranOn.set(x.id, p.machine)
  const isCopy = (project: string, machine: string): boolean => {
    const host = ranOn.get(project.match(SSH_KEY)?.[1] ?? '')
    return !!host && host !== machine
  }
  const ownRows = local.rows.filter((r) => !isCopy(r.project, local.machine))
  const ownSessions = local.sessions.filter((x) => !isCopy(x.project, local.machine))
  for (const key of unique([...ownRows.map((r) => r.project), ...ownSessions.map((s) => s.project)])) {
    const root = rootOf(key, local.projects)
    if (root.info && !projects[root.key]) projects[root.key] = root.info
    const name = nameOf(root.key, root.info)
    if (name && !byName.has(name)) byName.set(name, root.key)
  }
  const rows = [...ownRows]
  const sessions = [...ownSessions]
  const machines = [local.machine]
  for (const o of others) {
    if (o.machine === local.machine) continue
    if (!machines.includes(o.machine)) machines.push(o.machine)
    if (!o.sessions.length && !sessionless.includes(o.machine)) sessionless.push(o.machine)
    const keyOf = new Map<string, string>()
    const target = (key: string): string => {
      const known = keyOf.get(key)
      if (known) return known
      const root = rootOf(key, o.projects)
      const name = nameOf(root.key, root.info)
      const out = (name && byName.get(name)) || root.key
      if (out === root.key) {
        if (root.info && !projects[root.key]) projects[root.key] = root.info
        if (name && !byName.has(name)) byName.set(name, root.key)
      }
      keyOf.set(key, out)
      return out
    }
    // Les durées publiées d'un autre poste ne sont gardées qu'une fois, dans `peers`, que lisent les
    // vues : ses lignes et ses sessions les laissent (décision « Doublon »).
    for (const { apiMs: _apiMs, genMs: _genMs, calls: _calls, genOutput: _genOutput, ...r } of o.rows) if (!isCopy(r.project, o.machine)) rows.push({ ...r, project: target(r.project) })
    for (const { activeMs: _activeMs, apiMs: _apiMs, requests: _requests, ...s } of o.sessions) if (!isCopy(s.project, o.machine)) sessions.push({ ...s, project: target(s.project) })
    addPeer(peers, o, target, (project) => isCopy(project, o.machine))
  }
  return { rows, sessions: sessions.sort((a, b) => a.last - b.last), projects, machines, sessionless, peers }
}

/**
 * Les durées d'un fichier publié, aux projets de ce poste (`target`) ; rien pour un poste d'avant la
 * 0.10.0. Une session y a un total : il est rangé au jour de sa dernière activité (décision « Total au dernier jour »).
 */
function addPeer(peers: PeerDurations, o: Published, target: (key: string) => string, isCopy: (project: string) => boolean): void {
  const before = peers.active.length + peers.api.length
  const calls = [...o.rows.filter((r) => r.apiMs !== undefined), ...(o.apiOnly ?? [])]
  // La vitesse : les tokens de sortie des seuls appels relevés (Q5), jamais la sortie de ccusage.
  for (const r of calls) if (!isCopy(r.project)) peers.api.push({ date: r.date, project: target(r.project), machine: o.machine, model: r.model, apiMs: r.apiMs ?? 0, genMs: r.genMs ?? 0, output: r.genOutput ?? 0, calls: r.calls ?? 0 })
  for (const r of o.active ?? []) peers.active.push({ date: r.date, project: target(r.project), machine: o.machine, activeMs: r.activeMs, requests: r.requests })
  for (const h of o.hours ?? []) peers.hours.push({ date: h.date, machine: o.machine, hours: h.hours })
  for (const s of o.sessions) if (s.activeMs !== undefined && !isCopy(s.project)) peers.sessions.push({ date: dayOf(s.last, o.tzOffset), session: s.id, project: target(s.project), machine: o.machine, activeMs: s.activeMs, apiMs: s.apiMs ?? 0, requests: s.requests ?? 0 })
  if (peers.active.length + peers.api.length === before) return
  const first = earliest([...(o.active ?? []), ...calls].map((r) => r.date))
  if (first) peers.sinceBy[o.machine] = first
}

// ─── Projets ────────────────────────────────────────────────────────────────

/** La clé ccusage d'un dossier : chaque caractère hors lettres et chiffres devient « - ». */
export const projectKey = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')

/**
 * Le dossier d'une transcription : le premier `"cwd":"…"` qui donne la clé `key`, à défaut le
 * premier tout court. Une session commencée ailleurs (un brouillon du desktop rangé ensuite dans
 * un projet) cite d'abord son dossier de départ.
 */
export function cwdOf(text: string, key?: string): string | null {
  let first: string | null = null
  for (const m of text.matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)) {
    let path: string
    try {
      path = JSON.parse(`"${m[1]}"`) as string
    } catch {
      continue
    }
    if (!key || projectKey(path) === key) return path
    first ??= path
  }
  return first
}

const segments = (path: string): string[] => path.split(/[\\/]+/).filter(Boolean)

const WORKTREE_KEY = /--claude-worktrees-.+$/
const WORKTREE_PATH = /[\\/]\.claude[\\/]worktrees[\\/].*$/

/** Le projet d'un worktree de Claude (`<dépôt>/.claude/worktrees/<nom>`) : celui de son dépôt. */
export const baseKey = (key: string): string => key.replace(WORKTREE_KEY, '') || key

/**
 * Un dossier gardé qui ne donne pas sa clé, lu avant que `cwdOf` ne préfère le bon : à relire.
 * Un worktree lu à son dépôt (session partie du dépôt) compte pour le même projet. Seulement
 * pour une clé qui est un chemin (pas `ssh-…`) et que Claude Code n'a pas tronquée.
 */
export const isStale = (key: string, info: ProjectInfo): boolean =>
  /^(-|[A-Za-z]--)/.test(key) && key.length <= 200 && !!info.path && baseKey(projectKey(info.path)) !== baseKey(key)

/** La clé et le dossier du projet d'une clé : pour un worktree, ceux du dépôt, déduits du worktree s'ils manquent. */
function rootOf(key: string, projects: Record<string, ProjectInfo>): { key: string; info: ProjectInfo | undefined } {
  const base = baseKey(key)
  if (base === key || projects[base]) return { key: base, info: projects[base] }
  const path = projects[key]?.path?.replace(WORKTREE_PATH, '')
  return { key: base, info: path && projectKey(path) === base ? { name: segments(path).pop() ?? '', path } : undefined }
}

/** Le nom court d'un dossier : son dernier segment, `~` pour le dossier personnel. */
export function nameOfPath(path: string, home: string | null): string {
  if (home && segments(path).join('/').toLowerCase() === segments(home).join('/').toLowerCase()) return '~'
  return segments(path).pop() ?? path
}

export const isDraft = (key: string, info?: ProjectInfo): boolean => /Claude-scratch-workspaces/i.test(key) || /[\\/]scratch-workspaces[\\/]/i.test(info?.path ?? '')

/** Le projet affiché d'une clé : les brouillons du desktop sont réunis en un seul, un worktree rejoint son dépôt. */
export const groupOf = (key: string, projects: Record<string, ProjectInfo>): string => (key.startsWith('@') ? key : isDraft(key, projects[key]) ? DRAFTS : baseKey(key))

/** Longueur maximale d'un nom d'affichage de `names.json`. */
const LABEL_MAX = 60

/**
 * Les noms d'affichage de `names.json` (dépôt partagé) : `{ "<nom de dossier>": "<nom affiché>" }`. Le nom de
 * dossier se compare sans la casse, comme au rapprochement des postes ; une entrée vide ou qui n'est pas du texte
 * est ignorée. `null` si le fichier n'est pas un objet.
 */
export function parseLabels(json: unknown): Record<string, string> | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    const folder = k.trim().toLowerCase()
    const label = typeof v === 'string' ? v.trim().slice(0, LABEL_MAX) : ''
    if (folder && label) out[folder] = label
  }
  return out
}

/**
 * Les projets avec leur nom d'affichage : celui de `names.json` pour le dernier segment de leur dossier (pas « ~ »
 * pour le dossier personnel, comme le récap), à défaut leur nom, s'il y en a un.
 */
export function withLabels(projects: Record<string, ProjectInfo>, labels: Record<string, string>): Record<string, ProjectInfo> {
  const out: Record<string, ProjectInfo> = {}
  for (const [k, info] of Object.entries(projects)) {
    const folder = (info.path ? segments(info.path).pop() : null) ?? info.name
    const label = folder ? labels[folder.toLowerCase()] : undefined
    out[k] = label ? { ...info, label } : { name: info.name, path: info.path }
  }
  return out
}

/** Le nom d'un projet affiché ; à défaut de dossier connu, la clé sans le préfixe du dossier personnel. */
export function projectLabel(key: string, projects: Record<string, ProjectInfo>, homeKey: string | null): string {
  if (key === DRAFTS) return 'Brouillons du desktop'
  if (key === UNKNOWN) return 'Sans projet'
  const info = projects[key]
  if (info?.name) return info.label || info.name
  if (homeKey && key === homeKey) return '~'
  // Sans dossier connu : sans le lecteur ni le dossier personnel ; un worktree de Claude par son nom ;
  // « -- » est un séparateur suivi d'un point (`\.claude`).
  const rest = homeKey && key.startsWith(`${homeKey}-`) ? key.slice(homeKey.length + 1) : key.replace(/^[A-Za-z]--/, '')
  const worktree = rest.match(/--claude-worktrees-(.+)$/)
  if (worktree) return worktree[1]!
  return rest.replace(/^-/, '.').replace(/--/g, '/.') || key
}

/** Les noms affichés de plusieurs projets ; deux noms égaux prennent leur dossier parent. */
export function projectLabels(keys: readonly string[], projects: Record<string, ProjectInfo>, homeKey: string | null): Map<string, string> {
  const base = new Map(keys.map((k) => [k, projectLabel(k, projects, homeKey)] as const))
  const count = new Map<string, number>()
  base.forEach((v) => count.set(v, (count.get(v) ?? 0) + 1))
  const out = new Map<string, string>()
  for (const [k, v] of base) {
    const parent = projects[k]?.path ? segments(projects[k]!.path!).slice(-2, -1)[0] : undefined
    out.set(k, (count.get(v) ?? 0) > 1 && parent ? `${parent}/${v}` : v)
  }
  return out
}

// ─── Modèles ────────────────────────────────────────────────────────────────

type ModelId = { family: string; version: number[] }

/** `claude-opus-5-5` → opus 5.5 ; `claude-haiku-4-5-20251001` → haiku 4.5 ; `claude-3-5-sonnet-…` → sonnet 3.5. */
function parseModel(id: string): ModelId | null {
  const a = id.match(/^claude-([a-z]+)-([\d-]+?)(?:-\d{8})?$/)
  if (a) return { family: a[1]!, version: a[2]!.split('-').map(Number) }
  const b = id.match(/^claude-([\d-]+?)-([a-z]+)(?:-\d{8})?$/)
  if (b) return { family: b[2]!, version: b[1]!.split('-').map(Number) }
  return null
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function modelName(id: string): string {
  if (id === UNKNOWN_MODEL) return 'Modèle inconnu'
  const m = parseModel(id)
  return m ? `${cap(m.family)}${NB}${m.version.join('.')}` : id
}

// Teintes ordonnées pour que deux voisines se distinguent : une famille compte trop de
// versions (sept Opus) pour des nuances d'une même teinte.
const MODEL_PALETTE = [C.violet, C.sky, C.amber, C.teal, C.coral, C.pink, C.indigo, C.green, C.magenta, C.cyan, C.tangerine, C.sand, C.blue, C.lilac, C.slate, C.red]

/** Une couleur par modèle, dans l'ordre donné (les plus utilisés d'abord) : les plus utilisés ont les plus distinctes. */
export function modelColors(ranked: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  unique(ranked).forEach((id, i) => (out[id] = MODEL_PALETTE[i % MODEL_PALETTE.length]!))
  return out
}

// ─── Dates ──────────────────────────────────────────────────────────────────

/** Le jour local d'un instant, d'après le décalage horaire relevé. */
export const dayOf = (ms: number, tzOffset: number): string => new Date(ms - tzOffset * 60_000).toISOString().slice(0, 10)
const utc = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
export const addDays = (date: string, n: number): string => new Date(utc(date) + n * DAY_MS).toISOString().slice(0, 10)
export const daysBetween = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / DAY_MS)
/** Jour de la semaine, 0 pour lundi. */
export const weekdayOf = (date: string): number => (new Date(utc(date)).getUTCDay() + 6) % 7
export const weekOf = (date: string): string => addDays(date, -weekdayOf(date))
export const monthOf = (date: string): string => date.slice(0, 7)
const nextMonth = (month: string): string => {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}
export const daysInMonth = (month: string): number => daysBetween(`${month}-01`, `${nextMonth(month)}-01`)

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
export const WEEKDAY_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
export const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

export const monthShort = (date: string): string => MONTHS[Number(date.slice(5, 7)) - 1] ?? date.slice(5, 7)
/** « 7 oct. », avec l'année si `withYear`. */
export const fmtDate = (date: string, withYear = false): string =>
  `${Number(date.slice(8, 10))}${NB}${monthShort(date)}${withYear ? `${NB}${date.slice(0, 4)}` : ''}`
/** « mar. 7 oct. » */
export const fmtDay = (date: string): string => `${WEEKDAYS[weekdayOf(date)]}${NB}${fmtDate(date)}`
/** « octobre 2026 » pour `2026-10`. */
export const fmtMonth = (month: string): string => `${MONTHS_LONG[Number(month.slice(5, 7)) - 1] ?? month}${NB}${month.slice(0, 4)}`
export const fmtMonthShort = (month: string): string => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month}`

/** « à l'instant », « il y a 3 min », « il y a 2 h », « il y a 4 j ». */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return "à l'instant"
  if (s < 3600) return `il${NB}y${NB}a${NB}${Math.max(1, Math.round(s / 60))}${NB}min`
  if (s < 86_400) return `il${NB}y${NB}a${NB}${Math.round(s / 3600)}${NB}h`
  return `il${NB}y${NB}a${NB}${Math.round(s / 86_400)}${NB}j`
}

/** Pour les axes et les chiffres courts d'une durée : « 42 min », « 3,2 h », « 120 h ». */
export function fmtHours(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}${NB}min`
  const h = ms / 3_600_000
  return `${dec(h, h < 100 ? 1 : 0)}${NB}h`
}

/** La date courte d'un jour : « 26/10 ». */
export const fmtDayMonth = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`

/** « 45 min », « 2 h 05 », « 19 j 23 h ». */
export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 1) return `<${NB}1${NB}min`
  if (min < 60) return `${min}${NB}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}${NB}h${NB}${String(min % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}${NB}j${NB}${h % 24}${NB}h`
}

/** À la seconde, pour une requête : « 42 s », « 3 min 05 », « 1 h 02 ». */
export function fmtSeconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}${NB}s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min}${NB}min${NB}${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(min / 60)}${NB}h${NB}${String(min % 60).padStart(2, '0')}`
}

// ─── Nombres ────────────────────────────────────────────────────────────────

/** Un entier groupé par milliers (espaces insécables) : « 120 394 ». */
export function fmtInt(n: number): string {
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NB)
  return n < 0 ? `−${s}` : s
}

const dec = (n: number, digits: number): string => n.toFixed(digits).replace('.', ',').replace(/,0+$/, '')

/** « 999 », « 85,4 k », « 46,5 M », « 21,9 Md ». */
export function fmtTokens(n: number): string {
  const a = Math.abs(n)
  const unit = a >= 1e9 ? ([1e9, 'Md'] as const) : a >= 1e6 ? ([1e6, 'M'] as const) : a >= 1e3 ? ([1e3, 'k'] as const) : null
  if (!unit) return String(Math.round(n))
  const v = n / unit[0]
  return `${dec(v, Math.abs(v) < 100 ? 1 : 0)}${NB}${unit[1]}`
}

/** « 4,56 $ », « 9 977 $ ». */
export function fmtCost(n: number): string {
  const a = Math.abs(n)
  if (a === 0) return `0${NB}$`
  if (a < 0.01) return `<${NB}0,01${NB}$`
  if (a < 100) return `${n.toFixed(2).replace('.', ',')}${NB}$`
  return `${fmtInt(n)}${NB}$`
}

/** Pour les axes et le bandeau : « 47 $ », « 1,2 k$ ». */
export function fmtCostShort(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e3) return `${dec(n / 1e3, a < 1e4 ? 1 : 0)}${NB}k$`
  if (a >= 10) return `${Math.round(n)}${NB}$`
  return `${dec(n, 1)}${NB}$`
}

export const fmtMetric = (n: number, metric: Metric, short = false): string => (metric === 'cost' ? (short ? fmtCostShort(n) : fmtCost(n)) : fmtTokens(n))

export function fmtPct(ratio: number): string {
  const p = ratio * 100
  if (p > 0 && p < 1) return `<${NB}1${NB}%`
  return `${dec(p, p < 10 && p % 1 !== 0 ? 1 : 0)}${NB}%`
}

/** Une variation signée : « +40 % », « −12 % ». */
export function fmtDelta(ratio: number): string {
  const p = Math.round(ratio * 100)
  return `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)}${NB}%`
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${fmtInt(n)}${NB}${n > 1 ? many : one}`

// ─── Filtres et agrégats ────────────────────────────────────────────────────

export type Totals = { input: number; output: number; cacheWrite: number; cacheRead: number; tokens: number; cost: number }
export const zero = (): Totals => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, tokens: 0, cost: 0 })

const add = (t: Totals, r: UsageRow): Totals => {
  t.input += r.input
  t.output += r.output
  t.cacheWrite += r.cacheWrite
  t.cacheRead += r.cacheRead
  t.tokens += r.input + r.output + r.cacheWrite + r.cacheRead
  t.cost += r.cost
  return t
}
export const sum = (rows: readonly UsageRow[]): Totals => rows.reduce(add, zero())
export const valueOf = (t: Totals, metric: Metric): number => (metric === 'cost' ? t.cost : t.tokens)
/** Part du cache lu dans tout ce que le modèle a lu : entrée, cache écrit et cache lu. */
export const cacheRatio = (t: Totals): number => (t.input + t.cacheWrite + t.cacheRead > 0 ? t.cacheRead / (t.input + t.cacheWrite + t.cacheRead) : 0)

export const PERIOD_DAYS: Record<Exclude<Period, 'all'>, number> = { '90': 90, '30': 30, '7': 7 }

export type Filter = { from: string | null; to: string; machine: Machine; project: string | null; model: string | null }

export const filterOf = (ui: Ui, today: string): Filter => ({
  from: ui.period === 'all' ? null : addDays(today, -(PERIOD_DAYS[ui.period] - 1)),
  to: today,
  machine: ui.machine,
  project: ui.project,
  model: ui.model,
})

/** La même fenêtre, juste avant : de quoi comparer une période ; null pour « Tout ». */
export function previousOf(f: Filter): Filter | null {
  if (!f.from) return null
  const n = daysBetween(f.from, f.to) + 1
  return { ...f, from: addDays(f.from, -n), to: addDays(f.from, -1) }
}

export function keepRow(r: UsageRow, f: Filter, projects: Record<string, ProjectInfo>): boolean {
  if (f.from && r.date < f.from) return false
  if (r.date > f.to) return false
  if (f.machine !== 'all' && r.machine !== f.machine) return false
  if (f.project && groupOf(r.project, projects) !== f.project) return false
  if (f.model && r.model !== f.model) return false
  return true
}

export const selectRows = (rows: readonly UsageRow[], f: Filter, projects: Record<string, ProjectInfo>): UsageRow[] => rows.filter((r) => keepRow(r, f, projects))

/** Les sessions de la période et des filtres. */
export function selectSessions(sessions: readonly SessionRow[], f: Filter, projects: Record<string, ProjectInfo>, tzOffset: number): SessionRow[] {
  return sessions.filter((s) => {
    const day = dayOf(s.last, tzOffset)
    if (f.machine !== 'all' && s.machine !== f.machine) return false
    if (f.from && day < f.from) return false
    if (f.project && groupOf(s.project, projects) !== f.project) return false
    if (f.model && !s.models.includes(f.model)) return false
    return true
  })
}

export type Bucket = { key: string; total: Totals; byModel: Map<string, Totals> }

const bucketKey = (date: string, grain: Grain): string => (grain === 'day' ? date : grain === 'week' ? weekOf(date) : monthOf(date))
const nextKey = (key: string, grain: Grain): string => (grain === 'day' ? addDays(key, 1) : grain === 'week' ? addDays(key, 7) : nextMonth(key))

/** Des seaux continus de `from` à `to` (jours, semaines du lundi ou mois), vides compris. */
export function seriesOf(rows: readonly UsageRow[], grain: Grain, from: string, to: string): Bucket[] {
  const map = new Map<string, Bucket>()
  const last = bucketKey(to, grain)
  for (let key = bucketKey(from, grain), i = 0; key <= last && i < 2000; key = nextKey(key, grain), i++) map.set(key, { key, total: zero(), byModel: new Map() })
  for (const r of rows) {
    const b = map.get(bucketKey(r.date, grain))
    if (!b) continue
    add(b.total, r)
    const m = b.byModel.get(r.model) ?? zero()
    b.byModel.set(r.model, add(m, r))
  }
  return [...map.values()]
}

/** Le grain le plus fin qui tient dans `slots` colonnes ou barres. */
export function fitGrain(grain: Grain, from: string, to: string, slots: number): Grain {
  const span = daysBetween(from, to) + 1
  if (grain === 'day' && span <= slots) return 'day'
  if (grain !== 'month' && Math.ceil(span / 7) + 1 <= slots) return 'week'
  return 'month'
}

export const firstDate = (rows: readonly UsageRow[]): string | null => rows.reduce<string | null>((m, r) => (m === null || r.date < m ? r.date : m), null)

export type ModelStat = { model: string; total: Totals; share: number }

export function modelsOf(rows: readonly UsageRow[], metric: Metric): ModelStat[] {
  const map = new Map<string, Totals>()
  for (const r of rows) map.set(r.model, add(map.get(r.model) ?? zero(), r))
  const all = [...map.values()].reduce((n, t) => n + valueOf(t, metric), 0)
  return [...map.entries()]
    .map(([model, total]) => ({ model, total, share: all > 0 ? valueOf(total, metric) / all : 0 }))
    .sort((a, b) => valueOf(b.total, metric) - valueOf(a.total, metric) || b.total.tokens - a.total.tokens)
}

/** Un projet affiché : son total, sa part par poste, ses sessions. */
export type ProjectStat = { key: string; total: Totals; byMachine: Record<string, Totals>; share: number; sessions: number; first: string; last: string; members: number }

export function projectsOf(rows: readonly UsageRow[], sessions: readonly SessionRow[], projects: Record<string, ProjectInfo>, metric: Metric): ProjectStat[] {
  const map = new Map<string, { total: Totals; byMachine: Record<string, Totals>; first: string; last: string; members: Set<string> }>()
  for (const r of rows) {
    const key = groupOf(r.project, projects)
    const x = map.get(key) ?? { total: zero(), byMachine: {}, first: r.date, last: r.date, members: new Set<string>() }
    add(x.total, r)
    x.byMachine[r.machine] = add(x.byMachine[r.machine] ?? zero(), r)
    if (r.date > x.last) x.last = r.date
    if (r.date < x.first) x.first = r.date
    x.members.add(r.project)
    map.set(key, x)
  }
  const counts = new Map<string, number>()
  for (const s of sessions) {
    const key = groupOf(s.project, projects)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const all = [...map.values()].reduce((n, x) => n + valueOf(x.total, metric), 0)
  return [...map.entries()]
    .map(([key, x]) => ({ key, total: x.total, byMachine: x.byMachine, share: all > 0 ? valueOf(x.total, metric) / all : 0, sessions: counts.get(key) ?? 0, first: x.first, last: x.last, members: x.members.size }))
    .sort((a, b) => valueOf(b.total, metric) - valueOf(a.total, metric))
}

/** Les jours actifs, triés. */
export function activeDates(rows: readonly UsageRow[]): string[] {
  return unique(rows.filter((r) => r.input + r.output + r.cacheWrite + r.cacheRead > 0).map((r) => r.date)).sort()
}

/** La plus longue série de jours actifs et la série en cours (qui finit aujourd'hui ou hier). */
export function streaksOf(dates: readonly string[], today: string): { longest: number; longestEnd: string | null; current: number } {
  let longest = 0
  let longestEnd: string | null = null
  let run = 0
  let prev: string | null = null
  for (const d of dates) {
    run = prev !== null && daysBetween(prev, d) === 1 ? run + 1 : 1
    if (run > longest) {
      longest = run
      longestEnd = d
    }
    prev = d
  }
  const set = new Set(dates)
  let current = 0
  let day = set.has(today) ? today : addDays(today, -1)
  while (set.has(day)) {
    current += 1
    day = addDays(day, -1)
  }
  return { longest, longestEnd, current }
}

/** Le mois en cours : dépensé, projection linéaire à la fin du mois, et le mois d'avant. */
export function monthPlan(rows: readonly UsageRow[], today: string, metric: Metric) {
  const month = monthOf(today)
  const prev = monthOf(addDays(`${month}-01`, -1))
  const day = Number(today.slice(8, 10))
  const total = daysInMonth(month)
  let spent = 0
  let lastMonth = 0
  let lastMonthToDate = 0
  for (const r of rows) {
    const v = metric === 'cost' ? r.cost : r.input + r.output + r.cacheWrite + r.cacheRead
    const m = monthOf(r.date)
    if (m === month && r.date <= today) spent += v
    else if (m === prev) {
      lastMonth += v
      if (Number(r.date.slice(8, 10)) <= day) lastMonthToDate += v
    }
  }
  return { month, prev, day, total, spent, projected: day > 0 ? (spent / day) * total : spent, lastMonth, lastMonthToDate }
}

/** Le total de la mesure par jour de la semaine, lundi d'abord. */
export function weekdaysOf(rows: readonly UsageRow[], metric: Metric): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0]
  for (const r of rows) out[weekdayOf(r.date)]! += metric === 'cost' ? r.cost : r.input + r.output + r.cacheWrite + r.cacheRead
  return out
}

// Ordres de grandeur en tokens (estimations : ~1,4 token par mot français).
const BOOKS = [
  { title: 'Le Petit Prince', tokens: 25_000 },
  { title: "Harry Potter à l'école des sorciers", tokens: 110_000 },
  { title: 'Les Misérables', tokens: 750_000 },
  { title: 'À la recherche du temps perdu', tokens: 1_800_000 },
] as const

/** Une comparaison parlante pour les tokens de sortie : le plus gros livre écrit au moins trois fois. */
export function funFact(output: number): string | null {
  if (output < 1000) return null
  const book = [...BOOKS].reverse().find((b) => output / b.tokens >= 3) ?? BOOKS[0]
  const ratio = output / book.tokens
  const times = ratio >= 10 ? fmtInt(ratio) : dec(ratio, 1)
  return `Claude t'a écrit ~${times}${NB}× ${book.title} (${fmtTokens(output)} tokens de sortie).`
}

// ─── Journée ────────────────────────────────────────────────────────────────

/** Une discussion d'un jour : la session principale et ses sous-agents de workflow, réunis. */
export type DayDiscussion = { id: string; machine: string; project: string; first: number; last: number; cost: number; tokens: number; models: string[]; agents: number }

/**
 * Les discussions actives un jour donné : commencées ou terminées ce jour-là (ccusage ne donne
 * que la première et la dernière activité). Une discussion compte avec tous ses sous-agents de
 * workflow dès que l'un d'eux est actif ce jour-là ; son coût est son total, jours précédents
 * compris. Les plus chères d'abord.
 */
export function discussionsOfDay(sessions: readonly SessionRow[], day: string, tzOffset: number): DayDiscussion[] {
  const isOn = (s: SessionRow) => dayOf(s.first, tzOffset) === day || dayOf(s.last, tzOffset) === day
  const ids = new Set(sessions.filter(isOn).map((s) => s.parent ?? s.id))
  const out = new Map<string, DayDiscussion>()
  for (const s of sessions) {
    const id = s.parent ?? s.id
    if (!ids.has(id)) continue
    const d = out.get(id) ?? { id, machine: s.machine, project: s.project, first: s.first, last: s.last, cost: 0, tokens: 0, models: [], agents: 0 }
    if (!s.parent) {
      d.machine = s.machine
      d.project = s.project
    } else d.agents += 1
    d.first = Math.min(d.first, s.first)
    d.last = Math.max(d.last, s.last)
    d.cost += s.cost
    d.tokens += s.tokens
    d.models = unique([...d.models, ...s.models])
    out.set(id, d)
  }
  return [...out.values()].sort((a, b) => b.cost - a.cost || b.last - a.last)
}

/**
 * Un jour dans les 30 derniers jours, lui compris : la veille, la moyenne par jour actif avant
 * lui dans la fenêtre, et son rang parmi les jours actifs de la fenêtre (null s'il n'a rien consommé).
 */
export function compareDay(rows: readonly UsageRow[], day: string, metric: Metric): { value: number; previous: number; average: number | null; rank: number | null; activeDays: number } {
  const from = addDays(day, -29)
  const byDate = new Map<string, number>()
  for (const r of rows) {
    if (r.date < from || r.date > day) continue
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + (metric === 'cost' ? r.cost : r.input + r.output + r.cacheWrite + r.cacheRead))
  }
  const value = byDate.get(day) ?? 0
  const before = [...byDate.entries()].filter(([d, v]) => d < day && v > 0).map(([, v]) => v)
  return {
    value,
    previous: byDate.get(addDays(day, -1)) ?? 0,
    average: before.length ? before.reduce((n, v) => n + v, 0) / before.length : null,
    rank: value > 0 ? 1 + before.filter((v) => v > value).length : null,
    activeDays: before.length + (value > 0 ? 1 : 0),
  }
}

/**
 * Le jour montré par l'onglet Journée : le jour choisi, ramené entre le premier jour connu et
 * celui du relevé (rien n'existe après lui), ou celui du relevé. Avec les jours actifs voisins
 * (`dates`, sous les filtres), null quand il n'y en a pas.
 */
export function dayChoice(chosen: string | null, latest: string, first: string | null, dates: readonly string[]): { day: string; first: string; latest: string; prevActive: string | null; nextActive: string | null } {
  const start = first !== null && first < latest ? first : latest
  const day = chosen === null || chosen > latest ? latest : chosen < start ? start : chosen
  let prevActive: string | null = null
  let nextActive: string | null = null
  for (const d of dates) {
    if (d < day && d >= start && (prevActive === null || d > prevActive)) prevActive = d
    if (d > day && d <= latest && (nextActive === null || d < nextActive)) nextActive = d
  }
  return { day, first: start, latest, prevActive, nextActive }
}

/** Les blocs de 5 h commencés ou terminés ce jour-là. */
export const blocksOfDay = (blocks: readonly BlockRow[], day: string, tzOffset: number): BlockRow[] =>
  blocks.filter((b) => dayOf(b.start, tzOffset) === day || dayOf(b.lastAt, tzOffset) === day)

/** Le rythme d'un bloc : celui de ccusage pour le bloc en cours, sinon sa dépense par heure active (comme les seuils) ; null sous 6 min. */
export function blockRate(b: BlockRow): number | null {
  if (b.costPerHour !== null) return b.costPerHour
  const hours = (b.lastAt - b.start) / 3_600_000
  return hours > 0.1 ? b.cost / hours : null
}

// ─── Rythme horaire ─────────────────────────────────────────────────────────

/**
 * Les seuils du rythme horaire, en $/h : tirés des 45 blocs de 5 h du 9 septembre au 7 octobre
 * 2026 (dépense du bloc par heure active) : 1er quartile 6,9, médiane 13,5, 3e quartile 21,7,
 * 9e décile 31,9, maximum 71.
 */
export const RATE_LEVELS = [7, 14, 22, 32] as const

export type Heat = { level: 0 | 1 | 2 | 3 | 4; label: string; color: string }

const HEATS: readonly Heat[] = [
  { level: 0, label: 'calme', color: C.teal },
  { level: 1, label: 'posé', color: C.amber },
  { level: 2, label: 'soutenu', color: C.tangerine },
  { level: 3, label: 'intense', color: C.coral },
  { level: 4, label: 'en feu', color: C.red },
]

/** Le niveau d'un rythme horaire : calme, posé, soutenu, intense, en feu. */
export const heatOf = (perHour: number): Heat => HEATS[RATE_LEVELS.filter((t) => perHour >= t).length]!

/** La légende des niveaux : « calme < 7 · posé 7–14 · … · en feu ≥ 32 $/h ». */
export const heatLegend = (): string =>
  HEATS.map((h, i) => (i === 0 ? `${h.label} <${NB}${RATE_LEVELS[0]}` : i === HEATS.length - 1 ? `${h.label} ≥${NB}${RATE_LEVELS[i - 1]}` : `${h.label} ${RATE_LEVELS[i - 1]}–${RATE_LEVELS[i]}`)).join(' · ') + `${NB}$/h`

// ─── Discussion ouverte ─────────────────────────────────────────────────────

/** `ccusage claude session --id <id> --json` : `{ sessionId, totalCost, totalTokens, entries }`. */
export function discussionOf(json: Json): { cost: number; tokens: number; entries: DiscussionEntry[] } {
  const entries: DiscussionEntry[] = []
  for (const e of Array.isArray(json?.entries) ? json.entries : []) {
    const at = Date.parse(str(e?.timestamp))
    const model = str(e?.model)
    if (!Number.isFinite(at) || !model || model === '<synthetic>') continue
    entries.push([at, model, num(e.inputTokens), num(e.outputTokens), num(e.cacheCreationTokens), num(e.cacheReadTokens)])
  }
  entries.sort((a, b) => a[0] - b[0])
  return { cost: num(json?.totalCost), tokens: num(json?.totalTokens), entries }
}

/** Les poids relatifs du barème d'Anthropic, l'entrée valant 1 : cache écrit 1,25, cache lu 0,1, sortie 5. */
const units = (input: number, output: number, cacheWrite: number, cacheRead: number): number => input + 1.25 * cacheWrite + 0.1 * cacheRead + 5 * output

/** Le prix d'une unité pondérée, par modèle, d'après le coût et les tokens de tout le relevé. */
export function unitPricesOf(rows: readonly UsageRow[]): Record<string, number> {
  const acc = new Map<string, { cost: number; units: number }>()
  for (const r of rows) {
    const x = acc.get(r.model) ?? { cost: 0, units: 0 }
    x.cost += r.cost
    x.units += units(r.input, r.output, r.cacheWrite, r.cacheRead)
    acc.set(r.model, x)
  }
  const out: Record<string, number> = {}
  for (const [model, x] of acc) if (x.cost > 0 && x.units > 0) out[model] = x.cost / x.units
  return out
}

/**
 * Le coût estimé de chaque appel : ccusage ne donne que le total de la discussion. Chaque appel
 * reçoit ses unités pondérées (barème relatif) au prix unitaire de son modèle, puis le tout est
 * ramené au total exact de ccusage.
 */
export function estimateCosts(entries: readonly DiscussionEntry[], total: number, prices: Record<string, number>): number[] {
  const known = Object.values(prices)
  const fallback = known.length ? known.reduce((n, v) => n + v, 0) / known.length : 1
  const raw = entries.map(([, model, i, o, cw, cr]) => units(i, o, cw, cr) * (prices[model] ?? fallback))
  const all = raw.reduce((n, v) => n + v, 0)
  return all > 0 ? raw.map((v) => (v / all) * total) : raw.map(() => 0)
}

export const entryTokens = (e: DiscussionEntry): number => e[2] + e[3] + e[4] + e[5]

/** La durée d'un seau de la frise : la plus courte qui tient en 60 seaux au plus. */
export function bucketMinutes(from: number, to: number, slots = 60): number {
  const span = Math.max(1, (to - from) / 60_000)
  return [5, 15, 30, 60, 180, 360, 720, 1440, 2880].find((m) => span / m <= slots) ?? 10_080
}

/** Le texte de la ligne d'état quand le bandeau est masqué. */
export function statusText(o: { perHour: number | null; discussion: number | null; today: number }): string {
  const parts: string[] = []
  if (o.perHour !== null) parts.push(`${o.perHour >= RATE_LEVELS[3] ? '🔥' : '◆'} ${fmtCostShort(o.perHour)}/h`)
  if (o.discussion !== null) parts.push(`discussion ${fmtCost(o.discussion)}`)
  parts.push(`${fmtCost(o.today)} aujourd'hui`)
  return parts.join(' · ').replace(new RegExp(NB, 'g'), ' ')
}
