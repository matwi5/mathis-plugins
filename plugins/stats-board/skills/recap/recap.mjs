#!/usr/bin/env node
// Récap d'usage de la discussion et de la journée, ou d'un parcours, pour le skill /stats-board:recap.
// - Lancé par Claude : `node recap.mjs [<id de la discussion>]`. Écrit le récap en Markdown sur stdout.
// - Récap d'un parcours : `node recap.mjs --parcours "<préfixe de titre>" | --worktrees <dossier du projet>
//   [<id de la discussion principale>] [--since AAAA-MM-JJ] [--until AAAA-MM-JJ]` (60 jours par défaut).
// - Les chiffres viennent de ccusage (`npx ccusage@latest claude daily|session|blocks --json`),
//   comme le panneau ; les autres postes, de `~/.claude/claude-usage/machines/*.json`, et les noms
//   d'affichage des projets, de `~/.claude/claude-usage/names.json`.
// - Les durées (temps actif, temps API, requêtes) viennent des fichiers de relevé des requêtes de ce
//   poste (`~/.claude/stats-board/requetes/*.json`, écrits par le mod depuis la 0.10.0). Le temps
//   actif est l'union des intervalles des requêtes, sans double compte, comme `activeMs` de
//   `hooks/requests.ts`. Un fichier illisible (en cours d'écriture par sa session) est omis et signalé.
// - Script autonome, sans dépendance : les formats français, les niveaux de rythme et la lecture des noms
//   d'affichage reprennent ceux de `hooks/model.ts` (fmtCost, fmtTokens, fmtSeconds, RATE_LEVELS, parseLabels et
//   LABEL_MAX), et les durées ceux de `hooks/durations.ts` (spanOfRecord) et de `hooks/requests.ts` (activeMs),
//   à garder alignés à la main.

import { execFile } from 'node:child_process'
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const NB = ' '

/** `Math.min(...values)` et `Math.max(...values)` par une boucle : au-delà de 100 000 éléments, l'étalement lève une erreur. */
const minOf = (values) => values.reduce((min, v) => (v < min ? v : min), Infinity)
const maxOf = (values) => values.reduce((max, v) => (v > max ? v : max), -Infinity)

// ─── Formats (copie de model.ts) ────────────────────────────────────────────

export function fmtInt(n) {
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NB)
  return n < 0 ? `−${s}` : s
}

const dec = (n, digits) => n.toFixed(digits).replace('.', ',').replace(/,0+$/, '')

export function fmtTokens(n) {
  const a = Math.abs(n)
  const unit = a >= 1e9 ? [1e9, 'Md'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'k'] : null
  if (!unit) return String(Math.round(n))
  const v = n / unit[0]
  return `${dec(v, Math.abs(v) < 100 ? 1 : 0)}${NB}${unit[1]}`
}

export function fmtCost(n) {
  const a = Math.abs(n)
  if (a === 0) return `0${NB}$`
  if (a < 0.01) return `<${NB}0,01${NB}$`
  if (a < 100) return `${n.toFixed(2).replace('.', ',')}${NB}$`
  return `${fmtInt(n)}${NB}$`
}

export function fmtPct(ratio) {
  const p = ratio * 100
  if (p > 0 && p < 1) return `<${NB}1${NB}%`
  return `${dec(p, p < 10 && p % 1 !== 0 ? 1 : 0)}${NB}%`
}

export function fmtDuration(ms) {
  const min = Math.round(ms / 60_000)
  if (min < 1) return `<${NB}1${NB}min`
  if (min < 60) return `${min}${NB}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}${NB}h${NB}${String(min % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}${NB}j${NB}${h % 24}${NB}h`
}

/** À la seconde, pour une durée de requête : « 42 s », « 3 min 05 », « 1 h 02 » (`fmtSeconds` de model.ts). */
export function fmtSeconds(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}${NB}s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min}${NB}min${NB}${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(min / 60)}${NB}h${NB}${String(min % 60).padStart(2, '0')}`
}

/** Les seuils de `RATE_LEVELS` (model.ts), en $/h. */
const RATE_LEVELS = [7, 14, 22, 32]
const HEATS = ['calme', 'posé', 'soutenu', 'intense', 'en feu']
export const heatOf = (perHour) => HEATS[RATE_LEVELS.filter((t) => perHour >= t).length]

/** « claude-opus-5-5 » → « Opus 5.5 », « claude-sonnet-4-5-20250929 » → « Sonnet 4.5 ». */
export function modelName(id) {
  const m = String(id).replace(/^claude-/, '').replace(/-\d{8}$/, '').match(/^([a-z]+)-([\d-]+)$/)
  if (!m) return String(id)
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace(/-/g, '.')}`
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0)

// ─── Lecture des rapports ccusage ───────────────────────────────────────────

/** Le jour local « AAAA-MM-JJ » d'une date, dans le fuseau donné. */
export const localDay = (date, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

const clock = (ms, tz) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(ms))

/** Une session (`ccusage claude session`) et ses sous-agents, rattachés comme dans `sessionsOf` (model.ts). */
export function sessionInfo(row) {
  const path = String(row.projectPath ?? '').split(/[\\/]/)
  return {
    id: String(row.sessionId ?? ''),
    project: path[0] || '?',
    parent: path[2] === 'subagents' && path[1] ? path[1] : null,
    first: Date.parse(row.firstActivity) || Date.parse(row.lastActivity),
    last: Date.parse(row.lastActivity),
    cost: num(row.totalCost),
    tokens: num(row.totalTokens),
    cacheRead: num(row.cacheReadTokens),
    output: num(row.outputTokens),
    models: (Array.isArray(row.modelBreakdowns) ? row.modelBreakdowns : []).map((b) => ({ model: String(b.modelName), cost: num(b.cost) })),
  }
}

/** Les coûts par modèle d'une liste de ventilations, du plus cher au moins cher. */
function byModel(breakdowns) {
  const out = new Map()
  for (const b of breakdowns) if (b.model !== '<synthetic>') out.set(b.model, (out.get(b.model) ?? 0) + b.cost)
  return [...out].sort((a, b) => b[1] - a[1])
}

const modelLine = (pairs, total) => pairs.filter(([, c]) => c > 0).map(([m, c]) => `${modelName(m)} ${fmtCost(c)}${total > 0 ? ` (${fmtPct(c / total)})` : ''}`).join(' · ') || '—'

// ─── Durées des fichiers de relevé ──────────────────────────────────────────

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** La session d'un fichier de relevé, d'après son nom : `<session>_<heure d'ouverture>.json`. */
const sessionOfFile = (name) => name.replace(/_\d+\.json$/, '')

/**
 * L'avertissement des fichiers de relevé illisibles qui comptent pour ce récap (ceux de `isRelevant`) :
 * en cours d'écriture par leur session, ils sont relus au récap suivant.
 */
function unreadableLine(names, isRelevant) {
  const n = (names ?? []).filter(isRelevant).length
  return n ? `⚠ ${plural(n, 'fichier de relevé illisible', 'fichiers de relevé illisibles')} (en cours d'écriture ?), omis : relancer le récap.` : null
}

/** Les durées quand rien n'est relevé : « — », jamais 0. */
const noTimes = (why) => `- Temps actif — · temps API — (${why})`

/** L'intervalle [envoi, fin] d'une requête relevée (comme `spanOfRecord` de `hooks/durations.ts`). */
const spanOf = (r) => [num(r.sentAt), num(r.sentAt) + Math.max(num(r.realMs), num(r.endedAt ?? r.sentAt) - num(r.sentAt))]

/** La durée de l'union des intervalles : les chevauchements comptés une fois (`activeMs` de `hooks/requests.ts`). */
export function unionMs(spans) {
  let total = 0
  let end = -Infinity
  for (const [a, b] of spans.filter(([x, y]) => y > x).sort((x, y) => x[0] - y[0])) {
    if (b <= end) continue
    total += b - Math.max(a, end)
    end = b
  }
  return total
}

/** Les morceaux d'intervalles du jour `day` (dans le fuseau `tz`), coupés à chaque heure pile. */
function piecesOfDay(spans, day, tz) {
  const out = []
  for (const [a, b] of spans) {
    for (let start = a; start < b; ) {
      const end = Math.min(b, (Math.floor(start / HOUR_MS) + 1) * HOUR_MS)
      if (localDay(new Date(start), tz) === day) out.push([start, end])
      start = end
    }
  }
  return out
}

const requestCost = (r) => Object.values(r.models ?? {}).reduce((n, m) => n + num(m.cost), 0)
const isEstimated = (r) => Object.values(r.models ?? {}).some((m) => m.isEstimated)

/** Les durées d'une liste de relevés : temps actif sans double compte, temps API, requêtes, la plus chère. */
function durationsOf(logs) {
  const requests = logs.flatMap((l) => l.requests ?? [])
  const top = requests.reduce((best, r) => (!best || requestCost(r) > requestCost(best) ? r : best), null)
  return { activeMs: unionMs(requests.map(spanOf)), apiMs: sum(requests, (r) => num(r.apiMs)), requests: requests.length, top }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`

// ─── Rendu ──────────────────────────────────────────────────────────────────

/**
 * Le récap en Markdown, à partir des rapports déjà lus.
 * data : { now, tz, today, sessionId, isGuessed, version, isOffline, daily, sessions, blocks, projectNames, machine, others,
 *          requestLogs (fichiers de relevé lus), unreadable (noms des fichiers de relevé illisibles) }
 */
export function render(data) {
  const { now, tz, today } = data
  const names = data.projectNames ?? {}
  // Les brouillons du desktop (`scratch-workspaces`) sont réunis sous un seul nom, comme dans le panneau.
  const nameOf = (key) => (/scratch-workspaces/i.test(key) ? 'brouillons du desktop' : names[key] ?? key)
  const out = []
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(now))
  out.push(`## Récap d'usage · ${dateLabel}, ${clock(now, tz)}`)
  out.push('')
  out.push(`Coût équivalent API d'après ccusage${data.version ? ` ${data.version}` : ''}${data.isOffline ? ', prix hors ligne' : ''}. Le 💬 du bandeau vient du moteur (\`/cost\`) et peut différer un peu.`)

  // La discussion : sa ligne et celles de ses sous-agents.
  const rows = (data.sessions ?? []).map(sessionInfo)
  const logs = data.requestLogs ?? []
  // Ceux de cette discussion, et ceux du jour (la fenêtre de lecture : modifiés depuis deux jours).
  const warning = unreadableLine(data.unreadable, () => true)
  if (warning) out.push('', warning)
  const own = rows.find((r) => r.id === data.sessionId && !r.parent)
  const subs = rows.filter((r) => r.parent === data.sessionId)
  out.push('', '### Cette discussion', '')
  if (!data.sessionId) out.push('- Discussion introuvable : pas d\'identifiant de session.')
  else if (!own && !subs.length) out.push('- Pas encore d\'appel enregistré par ccusage pour cette discussion.')
  else {
    const all = [own, ...subs].filter(Boolean)
    const cost = sum(all, (r) => r.cost)
    const tokens = sum(all, (r) => r.tokens)
    const cacheRead = sum(all, (r) => r.cacheRead)
    const first = minOf(all.map((r) => r.first))
    const last = maxOf(all.map((r) => r.last))
    out.push(`- **${fmtCost(cost)}** · ${fmtTokens(tokens)} tokens${tokens > 0 ? `, dont ${fmtPct(cacheRead / tokens)} lus en cache` : ''} · sortie ${fmtTokens(sum(all, (r) => r.output))}`)
    out.push(`- ${clock(first, tz)} → ${clock(last, tz)} (${fmtDuration(last - first)}) · projet ${nameOf((own ?? subs[0]).project)}`)
    out.push(`- Modèles : ${modelLine(byModel(all.flatMap((r) => r.models)), cost)}`)
    if (subs.length) out.push(`- Dont ${subs.length} sous-agent${subs.length > 1 ? 's' : ''} de workflow : ${fmtCost(sum(subs, (r) => r.cost))}`)
    out.push(discussionTimes(logs.filter((l) => l.session === data.sessionId), tz))
    if (data.isGuessed) out.push('- ⚠ Discussion devinée (la plus récente du dossier) : l\'identifiant de session manquait.')
  }

  // Le jour sur ce poste.
  const day = []
  for (const list of Object.values(data.daily?.projects ?? {})) for (const r of Array.isArray(list) ? list : []) if (r.date === today) day.push(r)
  const dayCost = sum(day, (r) => num(r.totalCost))
  const dayTokens = sum(day, (r) => num(r.totalTokens))
  // Les durées du jour : les morceaux de requêtes de ce jour-là ; temps API et requêtes au jour de l'envoi.
  const dayLogs = logs.filter((l) => (l.requests ?? []).some((r) => piecesOfDay([spanOf(r)], today, tz).length || localDay(new Date(num(r.sentAt)), tz) === today))
  const sentToday = dayLogs.flatMap((l) => (l.requests ?? []).filter((r) => localDay(new Date(num(r.sentAt)), tz) === today))
  const dayActiveOf = (list) => unionMs(piecesOfDay(list.flatMap((l) => (l.requests ?? []).map(spanOf)), today, tz))
  const dayTimes = dayLogs.length
    ? `- Temps actif ${fmtSeconds(dayActiveOf(dayLogs))} · temps API ${fmtSeconds(sum(sentToday, (r) => num(r.apiMs)))} · ${plural(sentToday.length, 'requête')}`
    : noTimes("aucune requête relevée aujourd'hui")
  out.push('', `### Aujourd'hui${data.machine ? ` sur ${data.machine}` : ''}`, '')
  if (!day.length) out.push('- Aucun usage enregistré aujourd\'hui.')
  else {
    out.push(`- **${fmtCost(dayCost)}** · ${fmtTokens(dayTokens)} tokens`)
    out.push(dayTimes)
    out.push(`- Modèles : ${modelLine(byModel(day.flatMap((r) => (r.modelBreakdowns ?? []).map((b) => ({ model: String(b.modelName), cost: num(b.cost) })))), dayCost)}`)
    out.push('', '| Projet | Coût | Part | Tokens | Temps actif |', '|---|---:|---:|---:|---:|')
    const projects = new Map()
    for (const r of day) {
      const p = projects.get(r.project) ?? { cost: 0, tokens: 0 }
      p.cost += num(r.totalCost)
      p.tokens += num(r.totalTokens)
      projects.set(r.project, p)
    }
    for (const [key, p] of [...projects].sort((a, b) => b[1].cost - a[1].cost)) {
      const projectLogs = dayLogs.filter((l) => l.project === key)
      out.push(`| ${nameOf(key)} | ${fmtCost(p.cost)} | ${dayCost > 0 ? fmtPct(p.cost / dayCost) : '—'} | ${fmtTokens(p.tokens)} | ${projectLogs.length ? fmtSeconds(dayActiveOf(projectLogs)) : '—'} |`)
    }
  }

  // Les discussions actives aujourd'hui (sous-agents rattachés à leur discussion).
  const activeToday = rows.filter((r) => localDay(new Date(r.last), tz) === today)
  const parents = new Map()
  for (const r of activeToday) {
    const id = r.parent ?? r.id
    const p = parents.get(id) ?? { id, project: r.project, first: r.first, last: r.last, cost: 0 }
    p.cost += r.cost
    p.first = Math.min(p.first, r.first)
    p.last = Math.max(p.last, r.last)
    parents.set(id, p)
  }
  const discussions = [...parents.values()].sort((a, b) => b.cost - a.cost)
  if (discussions.length) {
    out.push('', `Discussions actives aujourd'hui : ${discussions.length} (coût total de chacune, jours précédents compris)`, '')
    out.push('| Projet | Heures | Coût |', '|---|---|---:|')
    for (const d of discussions.slice(0, 5)) out.push(`| ${nameOf(d.project)}${d.id === data.sessionId ? ' (celle-ci)' : ''} | ${clock(d.first, tz)}–${clock(d.last, tz)} | ${fmtCost(d.cost)} |`)
    if (discussions.length > 5) out.push(`| … ${discussions.length - 5} autres | | ${fmtCost(sum(discussions.slice(5), (d) => d.cost))} |`)
  }

  // Le bloc de 5 h en cours.
  const block = (data.blocks?.blocks ?? []).find((b) => b.isActive && !b.isGap)
  if (block) {
    const rate = num(block.burnRate?.costPerHour)
    const end = Date.parse(block.endTime)
    const proj = block.projection ? ` · projection ${fmtCost(num(block.projection.totalCost))} à ${clock(end, tz)}` : ''
    out.push('', `Bloc de 5 h en cours (depuis ${clock(Date.parse(block.startTime), tz)}) : ${fmtCost(num(block.costUSD))} · rythme ${fmtCost(rate)}/h, ${heatOf(rate)}${proj}`)
  }

  // Les autres postes, d'après leur dernier fichier publié.
  const others = (data.others ?? []).filter((o) => o.cost > 0 || o.tokens > 0)
  if (others.length) {
    out.push('', '### Autres postes aujourd\'hui', '')
    for (const o of others) out.push(`- ${o.machine} : ${fmtCost(o.cost)} · ${fmtTokens(o.tokens)} tokens (publié à ${clock(o.updatedAt, tz)})`)
    out.push(`- **Tous les postes : ${fmtCost(dayCost + sum(others, (o) => o.cost))}** · ${fmtTokens(dayTokens + sum(others, (o) => o.tokens))} tokens`)
  }
  return out.join('\n')
}

/** La ligne des durées d'une discussion : temps actif, temps API, requêtes et la plus chère ; « — » sans relevé. */
function discussionTimes(logs, tz) {
  if (!logs.length) return noTimes("pas de relevé : discussion d'avant la 0.10.0")
  const d = durationsOf(logs)
  const top = d.top ? ` · la plus chère : ${clock(num(d.top.sentAt), tz)}, ${isEstimated(d.top) ? '≈' : ''}${fmtCost(requestCost(d.top))}` : ''
  return `- Temps actif ${fmtSeconds(d.activeMs)} · temps API ${fmtSeconds(d.apiMs)} · ${plural(d.requests, 'requête')}${top}`
}

// ─── Récap d'un parcours ────────────────────────────────────────────────────

const TITLE_LINE = /"type":"(custom|ai)-title","(?:customTitle|aiTitle)":"((?:[^"\\]|\\.)*)"/g

/** Les derniers titres d'un texte : `custom-title` (donné ou renommé) et `ai-title` (titre automatique). */
function titlesIn(text) {
  const last = { custom: null, ai: null }
  for (const m of String(text).matchAll(TITLE_LINE)) last[m[1]] = m[2]
  const decode = (s) => (s === null ? null : JSON.parse(`"${s}"`))
  return { custom: decode(last.custom), ai: decode(last.ai) }
}

/**
 * Le titre d'une session : la dernière ligne `custom-title` de sa transcription (un renommage en ajoute une),
 * sinon la dernière `ai-title`, le titre automatique qu'affiche Claude Code à une session jamais renommée.
 */
export function titleOf(text) {
  const t = titlesIn(text)
  return t.custom ?? t.ai
}

const dayClock = (ms, tz) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))

/** Le marqueur des dossiers de projet des worktrees de groupe : `<clé du projet>--claude-worktrees-groupe-<id>`. */
const GROUP_WORKTREES = '--claude-worktrees-groupe-'

/** Un titre sans les signes que flow-board retire du titre d'une session liée (`linkedPrefix` de `hooks/register.tsx`). */
const bareTitle = (s) => String(s ?? '').replace(/["`$\\«»]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Le titre `title` relève-t-il du parcours `prefix` ? Il commence par le préfixe, ou c'est celui d'une session
 * liée de flow-board, « <titre du parcours coupé à 28 signes>… > Groupe X · … », dont le début coupé
 * commence le préfixe. Jusqu'à flow-board 0.60.0, le séparateur était « › », que l'app affichait « ' ».
 */
function titleMatches(title, prefix) {
  const t = bareTitle(title)
  const p = bareTitle(prefix)
  if (!p) return false
  if (t.startsWith(p)) return true
  const head = t.match(/^(.+?)… [>›'] /)?.[1]
  return !!head && p.startsWith(head)
}

/** Une session du parcours : par son titre, ou par son dossier (worktree `groupe-*`, discussion principale). */
const inParcours = (r, title, { prefix, worktreesKey, sessionId }) =>
  titleMatches(title, prefix) ||
  (!!worktreesKey && (r.project.startsWith(`${worktreesKey}${GROUP_WORKTREES}`) || r.id === sessionId))

/**
 * Le récap d'un parcours en Markdown, sous-agents compris : les sessions dont le titre commence par `prefix`,
 * et celles des worktrees `groupe-*` du projet `worktreesKey` avec la discussion principale `sessionId`.
 * La durée d'une session va de sa première à sa dernière activité ; son temps actif et celui du parcours
 * viennent des fichiers de relevé (`requestLogs`), sans double compte entre sessions qui tournent en même temps.
 * data : { tz, since, until (AAAA-MM-JJ, facultatif), prefix, worktreesKey, sessionId, sessions, titles, projectNames, requestLogs,
 *          unreadable (noms des fichiers de relevé illisibles) }
 */
export function renderParcours(data) {
  const { tz } = data
  const names = data.projectNames ?? {}
  const titles = data.titles ?? {}
  const prefix = String(data.prefix ?? '').trim()
  const wt = !!data.worktreesKey
  const rows = (data.sessions ?? []).map(sessionInfo)
  const picked = rows.filter((r) => !r.parent && inParcours(r, titles[r.id], { prefix, worktreesKey: data.worktreesKey, sessionId: data.sessionId }))
  const ids = new Set(picked.map((r) => r.id))
  // ccusage 20 compte déjà les sous-agents dans leur session ; une ligne `<projet>/<session>/subagents`
  // (versions plus anciennes) s'ajoute à sa session.
  const subs = rows.filter((r) => r.parent && ids.has(r.parent))
  const all = [...picked, ...subs]
  const cost = sum(all, (r) => r.cost)
  const what = [prefix && `« ${prefix} »`, wt && `worktrees groupe-* de ${names[data.worktreesKey] ?? data.worktreesKey}`].filter(Boolean).join(' et ')
  const frDate = (d) => String(d).split('-').reverse().join('/')
  const period = data.until ? `du ${frDate(data.since)} au ${frDate(data.until)}` : `depuis le ${frDate(data.since)}`
  const out = [`## Récap du parcours${prefix ? ' ' : ' · '}${what}`, '']
  if (!picked.length) {
    out.push(`Aucune session retrouvée ${period}.`)
    return out.join('\n')
  }
  out.push(`Coût équivalent API d'après ccusage, sous-agents compris, sessions retrouvées ${period}.`, '')
  if (wt && !prefix && !data.sessionId) out.push('- ⚠ Discussion principale non comptée : son identifiant manque.')
  out.push(`- **${fmtCost(cost)}** · ${picked.length} session${picked.length > 1 ? 's' : ''} · ${fmtTokens(sum(all, (r) => r.tokens))} tokens`)
  out.push(`- Modèles : ${modelLine(byModel(all.flatMap((r) => r.models)), cost)}`)
  const logs = (data.requestLogs ?? []).filter((l) => ids.has(l.session))
  const times = durationsOf(logs)
  // Des sessions sans relevé (d'avant la 0.10.0) : le total ne les compte pas, et le dit.
  const missing = picked.filter((r) => !logs.some((l) => l.session === r.id)).length
  const partial = missing && logs.length ? `, sans ${plural(missing, 'session')} non relevée${missing > 1 ? 's' : ''}` : ''
  out.push(logs.length ? `- Temps actif ${fmtSeconds(times.activeMs)} (sans double compte entre sessions${partial}) · temps API ${fmtSeconds(times.apiMs)} · ${plural(times.requests, 'requête')}` : noTimes("pas de relevé : sessions d'avant la 0.10.0"))
  // Seuls les fichiers des sessions du parcours comptent.
  const warning = unreadableLine(data.unreadable, (name) => ids.has(sessionOfFile(name)))
  if (warning) out.push(`- ${warning}`)
  out.push('', '| Session | Projet | Heures | Durée | Actif | Coût |', '|---|---|---|---|---:|---:|')
  const cell = (s) => String(s).replace(/\|/g, '\\|')
  for (const r of picked.sort((a, b) => a.first - b.first)) {
    // La session et ses sous-agents : heures et coût d'ensemble, comme pour la discussion du récap du jour.
    const own = [r, ...subs.filter((s) => s.parent === r.id)]
    const first = minOf(own.map((s) => s.first))
    const last = maxOf(own.map((s) => s.last))
    const ownLogs = logs.filter((l) => l.session === r.id)
    out.push(`| ${cell(titles[r.id] ?? '(sans titre)')} | ${cell(names[r.project] ?? r.project)} | ${dayClock(first, tz)} → ${dayClock(last, tz)} | ${fmtDuration(last - first)} | ${ownLogs.length ? fmtSeconds(durationsOf(ownLogs).activeMs) : '—'} | ${fmtCost(sum(own, (s) => s.cost))} |`)
  }
  return out.join('\n')
}

// ─── Entrées-sorties ────────────────────────────────────────────────────────

function npx(args) {
  return new Promise((resolve) => {
    execFile('npx', ['-y', 'ccusage@latest', ...args], {
      // Sous Windows, npx est un .cmd : il passe par le shell.
      shell: process.platform === 'win32',
      maxBuffer: 256 * 1024 * 1024,
      timeout: 240_000,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_update_notifier: 'false', npm_config_fund: 'false' },
    }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout), stderr: String(stderr) }))
  })
}

/** Un rapport ccusage en JSON ; en cas d'échec avec les prix en ligne, un second essai avec les prix embarqués. */
async function ccusage(args) {
  for (const offline of [false, true]) {
    const res = await npx([...args, ...(offline ? ['--offline'] : [])])
    if (res.err) {
      if (offline) throw new Error(`ccusage ${args.slice(0, 2).join(' ')} : ${(res.stderr || res.err.message).trim().split('\n')[0]}`)
      continue
    }
    return { json: JSON.parse(res.stdout || 'null'), isOffline: offline || /embedded pricing|failed to fetch/i.test(res.stderr) }
  }
}

const readJson = (path) => {
  try {
    // Un fichier écrit par PowerShell commence par un BOM, que JSON.parse refuse.
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** La transcription la plus récente du dossier courant : la discussion probable quand l'identifiant manque. */
function guessSession(projectsDir, cwd) {
  try {
    const dir = join(projectsDir, cwd.replace(/[^a-zA-Z0-9]/g, '-'))
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    files.sort((a, b) => b.t - a.t)
    return files[0] ? files[0].f.replace(/\.jsonl$/, '') : null
  } catch {
    return null
  }
}

const projectKey = (path) => path.replace(/[^a-zA-Z0-9]/g, '-')
const lastSegment = (path) => path.split(/[\\/]/).filter(Boolean).pop() ?? null
/** Un worktree de Claude dans un chemin ; capture son nom (premier segment après `.claude/worktrees/`). */
const WORKTREE_IN_PATH = /[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+).*$/
/** Longueur maximale d'un nom d'affichage de `names.json` (`LABEL_MAX` de `hooks/model.ts`). */
const LABEL_MAX = 60

/**
 * Les noms d'affichage de `names.json` : nom de dossier (sans la casse) → nom affiché, comme `parseLabels`
 * de `hooks/model.ts`.
 */
export function labelsOf(json) {
  const out = {}
  if (!json || typeof json !== 'object' || Array.isArray(json)) return out
  for (const [k, v] of Object.entries(json)) {
    const label = typeof v === 'string' ? v.trim().slice(0, LABEL_MAX) : ''
    if (k.trim() && label) out[k.trim().toLowerCase()] = label
  }
  return out
}

/**
 * Le nom de `names.json` du dossier `path`, ou `null` s'il n'en a pas ; un worktree de Claude d'un projet
 * renommé garde son nom après celui du projet (« Chambre noire · dev »).
 */
export function labelOf(path, labels) {
  const worktree = path.match(WORKTREE_IN_PATH)?.[1]
  const label = labels[(lastSegment(path.replace(WORKTREE_IN_PATH, '')) ?? '').toLowerCase()]
  if (!label) return null
  return worktree ? `${label} · ${worktree}` : label
}

/**
 * Le dossier d'un projet : un `"cwd"` de ses transcriptions dont le chemin redonne la clé. Une discussion peut
 * commencer ailleurs (un brouillon du desktop) : son premier `cwd` seul ne suffit pas.
 */
function projectPath(projectsDir, key) {
  try {
    const dir = join(projectsDir, key)
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).slice(0, 10)) {
      const fd = openSync(join(dir, f), 'r')
      const buf = Buffer.alloc(262144)
      const n = readSync(fd, buf, 0, buf.length, 0)
      closeSync(fd)
      for (const m of buf.toString('utf8', 0, n).matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)) {
        const cwd = JSON.parse(`"${m[1]}"`)
        if (projectKey(cwd) === key) return cwd
      }
    }
  } catch {
    // Dossier effacé : la clé reste.
  }
  return null
}

/**
 * Le dernier titre d'une transcription (comme `titleOf`), lue par blocs depuis la fin : un renommage ajoute
 * une ligne `custom-title`, et les plus longues transcriptions font plusieurs dizaines de Mo.
 */
function readTitle(file) {
  const CHUNK = 1 << 20
  const OVERLAP = 1 << 14
  let fd
  let ai = null
  try {
    fd = openSync(file, 'r')
    const size = statSync(file).size
    const buf = Buffer.alloc(CHUNK + OVERLAP)
    for (let end = size; end > 0; end -= CHUNK) {
      // Chaque bloc déborde sur le suivant, pour ne pas couper une ligne de titre en deux.
      const start = Math.max(0, end - CHUNK)
      const n = readSync(fd, buf, 0, Math.min(end + OVERLAP, size) - start, start)
      const t = titlesIn(buf.toString('utf8', 0, n))
      if (t.custom !== null) return t.custom
      // Le titre automatique ne sert que sans `custom-title` dans toute la transcription.
      ai ??= t.ai
    }
  } catch {
    // Transcription effacée ou illisible : pas de titre.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  return ai
}

/** Les noms des projets publiés par ce poste dans claude-usage, et les autres postes du jour. */
function readMachines(usageDir, machine, labels, today) {
  const projectNames = {}
  const others = []
  try {
    for (const f of readdirSync(join(usageDir, 'machines')).filter((x) => x.endsWith('.json'))) {
      const file = readJson(join(usageDir, 'machines', f))
      if (!file) continue
      // Un nom publié n'est repris que si son dossier redonne la clé.
      for (const [key, p] of Object.entries(file.projects ?? {})) if (p?.name && p.path && file.machine === machine && projectKey(p.path) === key) projectNames[key] = labelOf(p.path, labels) ?? p.name
      if (file.machine === machine) continue
      const rows = (file.rows ?? []).filter((r) => r.date === today)
      others.push({ machine: String(file.machine), updatedAt: num(file.updatedAt), cost: sum(rows, (r) => num(r.cost)), tokens: sum(rows, (r) => num(r.input) + num(r.output) + num(r.cacheWrite) + num(r.cacheRead)) })
    }
  } catch {
    // Pas de clone claude-usage : ce poste seul.
  }
  return { projectNames, others }
}

/** Complète `projectNames` pour les clés sans nom publié, d'après les transcriptions. */
function nameMissing(projectNames, keys, projectsDir, labels) {
  for (const key of keys) {
    if (!key || projectNames[key]) continue
    const path = projectPath(projectsDir, key)
    projectNames[key] = (path && (labelOf(path, labels) ?? lastSegment(path))) ?? key
  }
}

/** Bornes d'une requête plausible (`parseRecord` de durations.ts) : envoyée entre 2020 et 2100, 30 jours au plus. */
const FIRST_DATE = Date.UTC(2020, 0, 1)
const LAST_DATE = Date.UTC(2100, 0, 1)
const MAX_REQUEST_MS = 30 * DAY_MS
const isFiniteIn = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

/**
 * Une requête relevée plausible : dates et durées finies et dans les bornes (un fichier édité à la main
 * ou abîmé ne doit pas faire tourner la découpe aux heures des millions de fois). Ses modèles non objets sont écartés.
 */
export function plausibleRequest(r) {
  if (!r || typeof r !== 'object') return null
  if (!isFiniteIn(r.sentAt, FIRST_DATE, LAST_DATE) || !isFiniteIn(r.realMs, 0, MAX_REQUEST_MS) || !isFiniteIn(r.apiMs, 0, Number.MAX_SAFE_INTEGER)) return null
  if (r.endedAt !== null && r.endedAt !== undefined && !isFiniteIn(r.endedAt, r.sentAt, r.sentAt + MAX_REQUEST_MS)) return null
  const models = {}
  for (const [k, m] of Object.entries(r.models && typeof r.models === 'object' ? r.models : {})) if (m && typeof m === 'object' && !Array.isArray(m)) models[k] = m
  return { ...r, models }
}

/** Un fichier de relevé illisible et inchangé depuis une heure n'est plus en cours d'écriture (`ABANDONED_MS` de durations.ts). */
const ABANDONED_MS = HOUR_MS

/**
 * Les fichiers de relevé des requêtes de ce poste que `wanted(nom, date de modification)` retient, et les
 * noms des fichiers illisibles récents (en cours d'écriture par leur session : relus au récap suivant).
 * Illisible depuis plus d'une heure, un fichier est laissé de côté sans avertissement.
 */
export function readRequestLogs(dir, wanted, now = Date.now()) {
  const logs = []
  const unreadable = []
  let names = []
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    // Pas encore de relevé sur ce poste (avant la 0.10.0).
    return { logs, unreadable }
  }
  for (const name of names) {
    let mtimeMs = 0
    try {
      mtimeMs = statSync(join(dir, name)).mtimeMs
    } catch {
      continue
    }
    if (!wanted(name, mtimeMs)) continue
    const log = readJson(join(dir, name))
    if (log && log.schema === 1 && typeof log.session === 'string' && Array.isArray(log.requests)) logs.push({ ...log, requests: log.requests.map(plausibleRequest).filter(Boolean) })
    else if (now - mtimeMs <= ABANDONED_MS) unreadable.push(name)
  }
  return { logs, unreadable }
}

/** Le dossier de Claude Code : `CLAUDE_CONFIG_DIR` (le premier s'il y en a plusieurs, comme `claudeDir` de register.tsx), sinon `~/.claude`. */
const claudeDir = (home) => process.env.CLAUDE_CONFIG_DIR?.split(',')[0]?.trim() || join(home, '.claude')

/** Le dossier des fichiers de relevé : `stats-board/requetes` du dossier de Claude Code. */
const requestsDir = (home) => join(claudeDir(home), 'stats-board', 'requetes')

const readMachineName = (usageDir) => {
  try {
    return readFileSync(join(usageDir, '.machine'), 'utf8').trim() || null
  } catch {
    // Poste sans nom : pas de partage.
    return null
  }
}

/** Les options du récap d'un parcours, ou `null` sans `--parcours` ni `--worktrees` (récap de la discussion). */
function parcoursArgs(argv) {
  const out = { prefix: null, worktrees: null, since: null, until: null, sessionId: null }
  const unknown = []
  let isParcours = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--parcours' || a === '--worktrees' || a === '--since' || a === '--until') {
      const v = (argv[++i] ?? '').trim()
      if (!v) throw new Error(`${a} attend une valeur`)
      if (a === '--parcours') out.prefix = v
      else if (a === '--worktrees') out.worktrees = v
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${a} attend une date AAAA-MM-JJ`)
      else out[a.slice(2)] = v
      if (a === '--parcours' || a === '--worktrees') isParcours = true
    } else if (/^[0-9a-f-]{36}$/i.test(a.trim())) out.sessionId = a.trim()
    else if (a.trim()) unknown.push(a)
  }
  if (!isParcours) return null
  // Un préfixe sans guillemets ou une option mal écrite (`--since=…`) changerait le parcours sans rien dire.
  if (unknown.length) throw new Error(`argument inconnu : ${unknown[0]} (préfixe entre guillemets, dates en « --since AAAA-MM-JJ »)`)
  return out
}

async function mainParcours(opts, { home, projectsDir, tz, now }) {
  // Un parcours dure souvent plusieurs semaines : 60 jours par défaut.
  const since = opts.since ?? localDay(new Date(now - 60 * DAY_MS), tz)
  const until = opts.until ? ['--until', opts.until.replace(/-/g, '')] : []
  const report = await ccusage(['claude', 'session', '--since', since.replace(/-/g, ''), ...until, '--json', '--timezone', tz])
  const sessions = report.json?.sessions ?? report.json?.session ?? []
  // La clé du projet, même lancé depuis un de ses worktrees.
  const worktreesKey = opts.worktrees ? projectKey(resolve(opts.worktrees).replace(WORKTREE_IN_PATH, '')) : null

  const titles = {}
  const match = { prefix: opts.prefix, worktreesKey, sessionId: opts.sessionId }
  // Seuls les projets du parcours sont nommés : chaque nom manquant coûte des lectures de transcriptions.
  const keys = new Set(worktreesKey ? [worktreesKey] : [])
  for (const s of sessions) {
    const info = sessionInfo(s)
    if (info.parent) continue
    // Sans préfixe, seuls les titres des sessions des worktrees et de la discussion principale servent.
    if (!opts.prefix && !inParcours(info, null, match)) continue
    const title = readTitle(join(projectsDir, info.project, `${info.id}.jsonl`))
    if (title !== null) titles[info.id] = title
    if (inParcours(info, title, match)) keys.add(info.project)
  }
  const usageDir = join(home, '.claude', 'claude-usage')
  const labels = labelsOf(readJson(join(usageDir, 'names.json')))
  const { projectNames } = readMachines(usageDir, readMachineName(usageDir), labels, localDay(new Date(now), tz))
  nameMissing(projectNames, keys, projectsDir, labels)

  // Les relevés modifiés depuis le début du parcours : ceux de ses sessions en font partie.
  const from = Date.parse(`${since}T00:00:00Z`) - DAY_MS
  const { logs, unreadable } = readRequestLogs(requestsDir(home), (_, mtimeMs) => mtimeMs >= from)
  process.stdout.write(`${renderParcours({ tz, since, until: opts.until, prefix: opts.prefix, worktreesKey, sessionId: opts.sessionId, sessions, titles, projectNames, requestLogs: logs, unreadable })}\n`)
}

async function main() {
  const home = homedir()
  const projectsDir = join(claudeDir(home), 'projects')
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = Date.now()
  const parcours = parcoursArgs(process.argv.slice(2))
  if (parcours) return mainParcours(parcours, { home, projectsDir, tz, now })

  const arg = (process.argv[2] ?? '').trim()
  const today = localDay(new Date(now), tz)
  // Une discussion commencée il y a quelques jours reste trouvée : les sessions sont prises sur 7 jours.
  const since = localDay(new Date(now - 7 * DAY_MS), tz).replace(/-/g, '')
  const base = ['--json', '--timezone', tz]

  const isValid = /^[0-9a-f-]{36}$/i.test(arg)
  const sessionId = isValid ? arg : guessSession(projectsDir, process.cwd())

  // Le premier rapport installe ccusage dans le cache de npx ; les suivants partent ensemble.
  const daily = await ccusage(['claude', 'daily', '--since', today.replace(/-/g, ''), '--instances', '--breakdown', ...base])
  const [sessions, blocks, version] = await Promise.all([
    ccusage(['claude', 'session', '--since', since, ...base]),
    ccusage(['claude', 'blocks', '--active', ...base]).catch(() => null),
    npx(['--version']).then((r) => r.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null),
  ])

  // Les noms des projets, et les autres postes publiés dans claude-usage.
  const usageDir = join(home, '.claude', 'claude-usage')
  const machine = readMachineName(usageDir)
  const labels = labelsOf(readJson(join(usageDir, 'names.json')))
  const { projectNames, others } = readMachines(usageDir, machine, labels, today)
  const keys = new Set(Object.keys(daily.json?.projects ?? {}))
  for (const s of sessions.json?.sessions ?? []) keys.add(String(s.projectPath ?? '').split(/[\\/]/)[0])
  nameMissing(projectNames, keys, projectsDir, labels)
  // Les relevés de cette discussion, et ceux modifiés depuis deux jours (la journée en cours).
  const { logs, unreadable } = readRequestLogs(requestsDir(home), (name, mtimeMs) => (!!sessionId && name.startsWith(`${sessionId}_`)) || mtimeMs >= now - 2 * DAY_MS)

  process.stdout.write(`${render({
    now,
    tz,
    today,
    sessionId,
    isGuessed: !isValid && !!sessionId,
    version,
    isOffline: daily.isOffline || sessions.isOffline,
    daily: daily.json,
    sessions: sessions.json?.sessions ?? sessions.json?.session ?? [],
    blocks: blocks?.json,
    projectNames,
    machine,
    others,
    requestLogs: logs,
    unreadable,
  })}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(`Récap impossible : ${err?.message ?? err}\n`)
    process.exit(1)
  })
}
