#!/usr/bin/env node
// Récap d'usage de la discussion et de la journée, pour le skill /stats-board:recap.
// - Lancé par Claude : `node recap.mjs [<id de la discussion>]`. Écrit le récap en Markdown sur stdout.
// - Les chiffres viennent de ccusage (`npx ccusage@latest claude daily|session|blocks --json`),
//   comme le panneau ; les autres postes, de `~/.claude/claude-usage/machines/*.json`.
// - Script autonome, sans dépendance : les formats français et les niveaux de rythme reprennent
//   ceux de `hooks/model.ts` (fmtCost, fmtTokens, RATE_LEVELS), à garder alignés à la main.

import { execFile } from 'node:child_process'
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const NB = ' '

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

// ─── Rendu ──────────────────────────────────────────────────────────────────

/**
 * Le récap en Markdown, à partir des rapports déjà lus.
 * data : { now, tz, today, sessionId, isGuessed, version, isOffline, daily, sessions, blocks, projectNames, machine, others }
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
    const first = Math.min(...all.map((r) => r.first))
    const last = Math.max(...all.map((r) => r.last))
    out.push(`- **${fmtCost(cost)}** · ${fmtTokens(tokens)} tokens${tokens > 0 ? `, dont ${fmtPct(cacheRead / tokens)} lus en cache` : ''} · sortie ${fmtTokens(sum(all, (r) => r.output))}`)
    out.push(`- ${clock(first, tz)} → ${clock(last, tz)} (${fmtDuration(last - first)}) · projet ${nameOf((own ?? subs[0]).project)}`)
    out.push(`- Modèles : ${modelLine(byModel(all.flatMap((r) => r.models)), cost)}`)
    if (subs.length) out.push(`- Dont ${subs.length} sous-agent${subs.length > 1 ? 's' : ''} de workflow : ${fmtCost(sum(subs, (r) => r.cost))}`)
    if (data.isGuessed) out.push('- ⚠ Discussion devinée (la plus récente du dossier) : l\'identifiant de session manquait.')
  }

  // Le jour sur ce poste.
  const day = []
  for (const list of Object.values(data.daily?.projects ?? {})) for (const r of Array.isArray(list) ? list : []) if (r.date === today) day.push(r)
  const dayCost = sum(day, (r) => num(r.totalCost))
  const dayTokens = sum(day, (r) => num(r.totalTokens))
  out.push('', `### Aujourd'hui${data.machine ? ` sur ${data.machine}` : ''}`, '')
  if (!day.length) out.push('- Aucun usage enregistré aujourd\'hui.')
  else {
    out.push(`- **${fmtCost(dayCost)}** · ${fmtTokens(dayTokens)} tokens`)
    out.push(`- Modèles : ${modelLine(byModel(day.flatMap((r) => (r.modelBreakdowns ?? []).map((b) => ({ model: String(b.modelName), cost: num(b.cost) })))), dayCost)}`)
    out.push('', '| Projet | Coût | Part | Tokens |', '|---|---:|---:|---:|')
    const projects = new Map()
    for (const r of day) {
      const p = projects.get(r.project) ?? { cost: 0, tokens: 0 }
      p.cost += num(r.totalCost)
      p.tokens += num(r.totalTokens)
      projects.set(r.project, p)
    }
    for (const [key, p] of [...projects].sort((a, b) => b[1].cost - a[1].cost)) out.push(`| ${nameOf(key)} | ${fmtCost(p.cost)} | ${dayCost > 0 ? fmtPct(p.cost / dayCost) : '—'} | ${fmtTokens(p.tokens)} |`)
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
    return JSON.parse(readFileSync(path, 'utf8'))
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

/**
 * Le nom d'un projet : le dernier segment d'un `"cwd"` de ses transcriptions dont le chemin redonne
 * la clé. Une discussion peut commencer ailleurs (un brouillon du desktop) : son premier `cwd` seul
 * ne suffit pas.
 */
function projectName(projectsDir, key) {
  try {
    const dir = join(projectsDir, key)
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).slice(0, 10)) {
      const fd = openSync(join(dir, f), 'r')
      const buf = Buffer.alloc(262144)
      const n = readSync(fd, buf, 0, buf.length, 0)
      closeSync(fd)
      for (const m of buf.toString('utf8', 0, n).matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)) {
        const cwd = JSON.parse(`"${m[1]}"`)
        if (projectKey(cwd) === key) return lastSegment(cwd)
      }
    }
  } catch {
    // Dossier effacé : la clé reste.
  }
  return null
}

async function main() {
  const arg = (process.argv[2] ?? '').trim()
  const home = homedir()
  const projectsDir = join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'projects')
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = Date.now()
  const today = localDay(new Date(now), tz)
  // Une discussion commencée il y a quelques jours reste trouvée : les sessions sont prises sur 7 jours.
  const since = localDay(new Date(now - 7 * 86_400_000), tz).replace(/-/g, '')
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
  let machine = null
  try {
    machine = readFileSync(join(usageDir, '.machine'), 'utf8').trim() || null
  } catch {
    // Poste sans nom : pas de partage.
  }
  const projectNames = {}
  const others = []
  try {
    for (const f of readdirSync(join(usageDir, 'machines')).filter((x) => x.endsWith('.json'))) {
      const file = readJson(join(usageDir, 'machines', f))
      if (!file) continue
      // Un nom publié n'est repris que si son dossier redonne la clé.
      for (const [key, p] of Object.entries(file.projects ?? {})) if (p?.name && p.path && file.machine === machine && projectKey(p.path) === key) projectNames[key] = p.name
      if (file.machine === machine) continue
      const rows = (file.rows ?? []).filter((r) => r.date === today)
      others.push({ machine: String(file.machine), updatedAt: num(file.updatedAt), cost: sum(rows, (r) => num(r.cost)), tokens: sum(rows, (r) => num(r.input) + num(r.output) + num(r.cacheWrite) + num(r.cacheRead)) })
    }
  } catch {
    // Pas de clone claude-usage : ce poste seul.
  }
  const keys = new Set(Object.keys(daily.json?.projects ?? {}))
  for (const s of sessions.json?.sessions ?? []) keys.add(String(s.projectPath ?? '').split(/[\\/]/)[0])
  for (const key of keys) if (key && !projectNames[key]) projectNames[key] = projectName(projectsDir, key) ?? key

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
  })}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(`Récap impossible : ${err?.message ?? err}\n`)
    process.exit(1)
  })
}
