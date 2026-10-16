// Panneau de statistiques Claude Code (/ccstats) et bandeau au-dessus du prompt : récap de la
// journée, coût équivalent API, tokens, modèles, projets, sessions, blocs de 5 h, calendrier et rythme.
//
// - Ce module est le seul à parler au moteur (`$`) : état, hooks, ccusage, fichiers.
//   Le dessin est dans view.tsx, les données pures dans model.ts, les SVG dans svg.ts.
// - Les prix viennent de ccusage (`npx ccusage@latest claude daily|session|blocks --json`) ;
//   les messages, appels d'outils et heures du cache de /stats (`~/.claude/stats-cache.json`).
// - Partage entre postes : chaque poste publie ses lignes et ses sessions dans le dépôt git
//   `~/.claude/claude-usage` (`machines/<nom>.json`, nom du poste dans `.machine`) et lit ceux
//   des autres ; l'ancien serveur y a un fichier figé. Sans ce dépôt, le mod reste local.
// - Un relevé prend une quinzaine de secondes : il part au démarrage si le dernier a plus de
//   20 min, à l'ouverture du panneau s'il a plus de 5 min, après un tour s'il a plus de
//   20 min, et sur « ↻ Actualiser ». Le dernier relevé est gardé dans `$.store`.
// - `/stats-board:ccstats` (commands/ccstats.md) est connue dès le premier message ;
//   `/ccstats`, déclarée au démarrage, sort du menu mais reste utilisable tapée en entier.
//   Pas de `/stats` : la commande intégrée de Claude Code porte ce nom.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Discussion, Meta, Notice, ProjectInfo, Published, SessionRow, Snapshot, Tab, Ui, UsageRow } from '../types'
import {
  LOCAL_LABEL,
  SCHEMA,
  activityOf,
  blocksOf,
  cwdOf,
  dayOf,
  discussionOf,
  fmtCost,
  isStale,
  keepHistory,
  keepSessions,
  machineFile,
  mergeMachines,
  nameOfPath,
  ownHistory,
  parseJson,
  parsePublished,
  projectKey,
  publishedOf,
  rowsOfDaily,
  sessionsOf,
  statusText,
  sum,
  unique,
  unpricedOf,
} from './model.ts'
import { drawBand, drawPane, kitOf, type Actions, type Caps, type View } from './view.tsx'

const PANE = 'ccstats'
const PANE_TITLE = 'Stats Claude Code'
/** La commande déclarée par `commands/ccstats.md`, préfixée du nom du plugin. */
const STATIC_CMD = 'stats-board:ccstats'
const ARG_HINT = '[discussion|day|overview|trend|models|projects|sessions|rhythm|refresh|hide|show]'
const TAB_LABEL: Record<Tab, string> = { discussion: 'Discussion', day: 'Journée', overview: 'Aperçu', trend: 'Évolution', models: 'Modèles', projects: 'Projets', sessions: 'Sessions', rhythm: 'Rythme' }
const TAB_WORDS: Record<string, Tab> = {
  discussion: 'discussion',
  day: 'day',
  today: 'day',
  jour: 'day',
  journee: 'day',
  journée: 'day',
  aujourdhui: 'day',
  "aujourd'hui": 'day',
  recap: 'day',
  récap: 'day',
  overview: 'overview',
  apercu: 'overview',
  aperçu: 'overview',
  trend: 'trend',
  evolution: 'trend',
  évolution: 'trend',
  costs: 'trend',
  couts: 'trend',
  coûts: 'trend',
  models: 'models',
  modeles: 'models',
  modèles: 'models',
  projects: 'projects',
  projets: 'projects',
  sessions: 'sessions',
  rhythm: 'rhythm',
  rythme: 'rhythm',
}

/** Clés de `$.store`, d'une session à l'autre. */
const STORE_SNAPSHOT = 'snapshot'
/** Relevé automatique (démarrage, fin de tour) quand le dernier a plus de 20 min. */
const AUTO_MS = 20 * 60_000
/** Relevé à l'ouverture du panneau quand le dernier a plus de 5 min. */
const OPEN_MS = 5 * 60_000
/** Le dépôt git partagé entre les postes, sous le dossier de Claude Code. */
const USAGE_DIR = 'claude-usage'
/** Le nom de ce poste, une ligne, propre au poste (ignoré par git dans le dépôt partagé). */
const MACHINE_FILE = '.machine'
/** git sans invite : un push sans identifiants échoue au lieu d'attendre. */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
/** Plafond du relevé gardé dans `$.store` (4 Mio en tout pour le plugin). */
const STORE_LIMIT = 3_000_000

const EMPTY_UI: Ui = {
  tab: 'overview',
  period: 'all',
  machine: 'all',
  metric: 'cost',
  grain: 'day',
  project: null,
  model: null,
  sessionSort: 'cost',
  expanded: { models: false, projects: false, sessions: false, days: false },
  day: null,
}
const EMPTY_META: Meta = { loading: null, error: null, startedAt: null }
const EMPTY_DISCUSSION: Discussion = { id: null, live: null, detail: null, turns: [], loading: false, error: null }

// Gardés par l'hôte : survivent au rechargement à chaud du module.
const snapshot = atom({ plugin: 'stats-board', key: 'snapshot' } as const, null as Snapshot | null)
const ui = atom({ plugin: 'stats-board', key: 'ui' } as const, EMPTY_UI)
const meta = atom({ plugin: 'stats-board', key: 'meta' } as const, EMPTY_META)
const notice = atom({ plugin: 'stats-board', key: 'notice' } as const, null as Notice)
// Bandeau masqué : le temps de la session, comme git-board.
const isBandHidden = atom({ plugin: 'stats-board', key: 'isBandHidden' } as const, false)
const here = atom({ plugin: 'stats-board', key: 'here' } as const, null as string | null)
const discussion = atom({ plugin: 'stats-board', key: 'discussion' } as const, EMPTY_DISCUSSION)

// Le contrat `Elements` du moteur : pas de `Svg` sur le terminal. La table de `$.ui.resolve`
// le contient quand même (fragment vide) : on ne peut pas s'y fier.
const capsOf = (surface: string): Caps => ({ hasSvg: surface !== 'terminal' })

type Run = { exitCode: number; stdout: string; stderr: string }
type Json = Record<string, any>

// État du module, perdu au rechargement : rien que des optimisations.
let inFlight: Promise<void> | null = null
let detailInFlight: Promise<void> | null = null
/** Le lanceur de npx qui a marché : `npx` direct, `npx.cmd`, ou `cmd.exe /c npx` sous Windows. */
let launcher: string[] | null = null
let ticks = 0

/** Un effet d'interface raté (pas d'écran, surface sans panneau) ne doit jamais gêner le relevé. */
const quietly = async (effect: () => unknown) => {
  try {
    await effect()
  } catch {
    // Rien à afficher ici : l'état, lui, est déjà écrit.
  }
}

const firstLine = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !/^\s*$/.test(l)) ?? ''

const messageOf = (err: unknown): string => String((err as { message?: unknown })?.message ?? err)

// ─── Commande /ccstats et /stats-board:ccstats ──────────────────────────────

// `/ccstats` n'existe qu'après le démarrage du mod ; `/stats-board:ccstats`, déclarée par
// `commands/ccstats.md`, est connue dès le premier message. Les deux reçoivent la même
// réponse, sans passer par le modèle. Aucun état posé par `session.start` n'est supposé ici.
const answer = async ($: any, e: { args: string }) => {
  const word = e.args.trim().toLowerCase()
  if (word === 'hide') {
    await setBandHidden($, true)
    return { text: 'Bandeau Stats masqué (/ccstats show pour le réafficher).' }
  }
  let text = 'Panneau Stats ouvert.'
  if (word === 'show') {
    await setBandHidden($, false)
    text = 'Bandeau Stats réaffiché, panneau Stats ouvert.'
  }
  const tab = TAB_WORDS[word]
  if (tab) {
    // `/ccstats day` montre la journée du relevé, même après un jour choisi dans l'onglet.
    await update($, ui, (x) => ({ ...x, tab, ...(tab === 'day' ? { day: null } : {}) }))
    text = `Panneau Stats ouvert (onglet ${TAB_LABEL[tab]}).`
    // L'onglet Discussion sans détail encore : ccusage sur cette seule discussion.
    if (tab === 'discussion' && !(await read($, discussion)).detail) $.clock.after(0, () => void refreshDiscussion($))
  }
  await quietly(() => $.ui.open({ id: PANE, title: PANE_TITLE }))
  const s = await read($, snapshot)
  const isForced = word === 'refresh'
  if (isForced) text = 'Panneau Stats ouvert : relevé ccusage relancé.'
  // Par une minuterie : le relevé (une quinzaine de secondes) survit à la fin de la commande.
  if (isForced || !s || (await $.clock.now()) - s.fetchedAt > OPEN_MS) $.clock.after(0, () => void refresh($, isForced))
  return { text }
}

// `/ccstats` reste utilisable tapée en entier, mais sort du menu : `/stats-board:ccstats`,
// déjà là avant le premier message, y suffit et le doublon disparaît.
const hideDuplicate = async ($: any, e: any, next: any) => ({ ...(await next(e)), isHidden: true })

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Un enregistrement refusé ne doit empêcher ni la minuterie ni le relevé.
    await quietly(() =>
      $.command.register({
        name: 'ccstats',
        description: 'Statistiques Claude Code : journée, coût (ccusage), tokens, modèles, projets, sessions, rythme',
        argumentHint: ARG_HINT,
      }),
    )
    // « Ce projet » : la clé ccusage du dossier de la session.
    const cwd = await Promise.resolve($.session.cwd()).catch(() => null)
    if (typeof cwd === 'string' && cwd) await update($, here, () => projectKey(cwd))
    // Un relevé d'un autre format (gardé par l'hôte au rechargement) est écarté, puis refait.
    const current = await read($, snapshot)
    if (current && !isSnapshot(current)) await update($, snapshot, () => null)
    // Le dernier relevé, gardé d'une session à l'autre : bandeau et panneau l'ont tout de suite.
    if (!(await read($, snapshot))) {
      const stored = await Promise.resolve($.store.get(STORE_SNAPSHOT)).catch(() => undefined)
      if (isSnapshot(stored)) await update($, snapshot, () => stored)
    }
    // La discussion ouverte : coût et contexte d'après le moteur, tout de suite.
    await quietly(() => readLive($))
    // Toutes les 5 s : les secondes d'un relevé en cours ; à la minute, les âges et le bloc de 5 h.
    $.clock.every(5_000, () => void tick($))
    await syncStatus($)
    const s = await read($, snapshot)
    if (!s || (await $.clock.now()) - s.fetchedAt > AUTO_MS) $.clock.after(3_000, () => void refresh($, false))
    return result
  })

  on('command.run', { command: 'ccstats' }, answer)
  on('command.describe', { command: 'ccstats' }, hideDuplicate)
  // En panne, le mod s'efface : la commande statique dit alors qu'il n'est pas actif.
  on('command.run', { command: STATIC_CMD }, answer).catch(() => undefined)

  // Après un tour de la conversation principale : ses tokens et le coût du moteur pour la
  // discussion, puis un relevé si le dernier a vieilli.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      const u = (result as { usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } }).usage
      if (u) {
        const tokens = u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        const at = await $.clock.now()
        await update($, discussion, (d) => ({ ...d, turns: [...d.turns, { at, tokens }].slice(-500) }))
      }
      await quietly(() => readLive($))
      const s = await read($, snapshot)
      if (s && (await $.clock.now()) - s.fetchedAt > AUTO_MS) $.clock.after(1_000, () => void refresh($, false))
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await readView($)
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.props.bodyColumns, capsOf(e.surface))
    return drawPane(kit, view, actionsFor($)) as any
  })

  // Le bandeau se compose avec ceux des autres plugins (git-board, flow-board…) : le leur reste
  // au-dessus, celui de Stats dessous ; jamais seul quand un autre bandeau existe.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Lire AVANT tout retour anticipé : la lecture abonne le bandeau aux changements.
    const view = await readView($)
    if (view.isBandHidden) return next(e)
    const below = await next(e)
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.props.bodyColumns, capsOf(e.surface))
    const own = drawBand(kit, view, actionsFor($)) as any
    if (!own) return below
    if (below.type === 'engine') return own
    const { Box } = kit
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {below}
        {own}
      </Box>
    )
  })
}

// ─── Vue et actions ─────────────────────────────────────────────────────────

async function readView($: any): Promise<View> {
  return {
    snapshot: await read($, snapshot),
    ui: await read($, ui),
    meta: await read($, meta),
    notice: await read($, notice),
    isBandHidden: await read($, isBandHidden),
    here: await read($, here),
    discussion: await read($, discussion),
    now: await $.clock.now(),
  }
}

function actionsFor($: any): Actions {
  return {
    setUi: (patch) => update($, ui, (x) => ({ ...x, ...patch })),
    toggleExpanded: (list) => update($, ui, (x) => ({ ...x, expanded: { ...x.expanded, [list]: !x.expanded[list] } })),
    // ↻ de l'en-tête : le relevé complet et, en même temps, le détail de la discussion.
    refresh: () => Promise.all([refresh($, true), refreshDiscussion($)]),
    refreshDiscussion: () => refreshDiscussion($),
    dismissNotice: () => update($, notice, () => null),
    hideBand: async () => {
      await setBandHidden($, true)
      await quietly(() => $.ui.toast('Bandeau Stats masqué : /ccstats show pour le réafficher'))
    },
    openPane: async () => {
      await quietly(() => $.ui.open({ id: PANE, title: PANE_TITLE }))
      const s = await read($, snapshot)
      if (!s || (await $.clock.now()) - s.fetchedAt > OPEN_MS) void refresh($, false)
    },
  }
}

async function setBandHidden($: any, hidden: boolean) {
  await update($, isBandHidden, () => hidden)
  await syncStatus($)
}

/** La ligne d'état sous le prompt ne sert que de relais quand le bandeau est masqué. */
async function syncStatus($: any) {
  const s = await read($, snapshot)
  const hidden = await read($, isBandHidden)
  let text: string | undefined
  if (s && hidden) {
    const now = await $.clock.now()
    const today = dayOf(now, s.tzOffset)
    const active = s.blocks.find((b) => b.isActive && b.end > now) ?? null
    const d = await read($, discussion)
    text = statusText({ perHour: active?.costPerHour ?? null, discussion: d.live?.cost ?? null, today: sum(s.rows.filter((r) => r.date === today)).cost })
  }
  await quietly(() => $.ui.status(text))
}

/** Redessine pour faire avancer les secondes d'un relevé (toutes les 5 s) et les âges (à la minute). */
async function tick($: any) {
  ticks += 1
  // Un relevé ou un détail de discussion en cours : l'indicateur du terminal avance.
  const isBusy = (await read($, meta)).loading !== null || (await read($, discussion)).loading
  if (isBusy || ticks % 12 === 0) await quietly(() => $.ui.invalidate('ui.render'))
}

// ─── Relevé ─────────────────────────────────────────────────────────────────

/** Un relevé à la fois ; un autre demandé entre-temps attend celui en cours. */
function refresh($: any, isAsked: boolean): Promise<void> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      await load($, isAsked)
    } catch (err) {
      const text = `Relevé impossible : ${messageOf(err)}`
      await update($, meta, (m) => ({ ...m, loading: null, startedAt: null, error: text }))
      await say($, 'error', text)
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

async function load($: any, isAsked: boolean) {
  const startedAt = await $.clock.now()
  const step = (loading: string) => update($, meta, (m) => ({ ...m, loading, startedAt: m.startedAt ?? startedAt }))
  await step('Relevé ccusage : consommation par jour, projet et modèle…')
  const stored = await read($, snapshot)
  const previous = isSnapshot(stored) ? stored : null
  const tz = await timezone($)
  const base = ['--json', '--order', 'asc', ...(tz.name ? ['--timezone', tz.name] : [])]

  // Le premier appel installe ccusage dans le cache de npx ; les suivants partent ensemble.
  const daily = await ccusage($, ['claude', 'daily', '--instances', '--breakdown', ...base], false)
  await step('Relevé ccusage : sessions et blocs de 5 h…')
  const [sessions, blocks, version] = await Promise.all([
    ccusage($, ['claude', 'session', ...base], daily.isOffline),
    ccusage($, ['claude', 'blocks', '--breakdown', ...base], daily.isOffline),
    ccusageVersion($),
  ])
  await step('Lecture du cache de /stats et des projets…')
  const dir = await claudeDir($)
  const home = await homeDir($)
  const warnings: string[] = []
  const name = await machineName($, dir)
  const machine = name ?? LOCAL_LABEL
  const activity = await readActivity($, dir)

  // L'historique de ce poste : relevé gardé (même d'avant la 0.3.0) et fichier déjà publié.
  const legacy = previous ? null : await Promise.resolve($.store.get(STORE_SNAPSHOT)).catch(() => null)
  const history = ownHistory(machine, { previous, legacy, published: await readOwn($, dir, name) })
  const kept = keepHistory(rowsOfDaily(daily.json, machine), history.rows, machine)
  const ownSessions: SessionRow[] = keepSessions(sessionsOf(sessions.json, machine), history.sessions, machine)
    .sort((a, b) => a.last - b.last)
    .slice(-800)
  let blockRows = blocksOf(blocks.json)
  const keys = unique([...kept.rows.map((r) => r.project), ...ownSessions.map((s) => s.project)])
  const ownProjects = await resolveProjects($, keys, previous?.projects ?? {}, dir, home)

  await step('Partage entre postes : publication et lecture des autres postes…')
  const own = { machine, tzOffset: tz.offset, rows: kept.rows, sessions: ownSessions, projects: ownProjects }
  const others = await share($, dir, name, own, warnings)
  const merged = mergeMachines(own, others)

  let snap: Snapshot = {
    schema: SCHEMA,
    fetchedAt: await $.clock.now(),
    tzOffset: tz.offset,
    rows: merged.rows,
    sessions: merged.sessions.slice(-1500),
    blocks: blockRows.slice(-400),
    activity,
    projects: merged.projects,
    unpriced: unpricedOf(daily.json, sessions.json),
    isOffline: daily.isOffline || sessions.isOffline,
    machine,
    machines: merged.machines,
    sessionless: merged.sessionless,
    version,
    keptDays: kept.kept,
    warnings,
  }
  // Le store du plugin tient en 4 Mio : au-delà, les plus vieilles sessions et blocs cèdent.
  while (JSON.stringify(snap).length > STORE_LIMIT && (snap.sessions.length > 100 || snap.blocks.length > 50)) {
    blockRows = snap.blocks.slice(Math.floor(snap.blocks.length / 4))
    snap = { ...snap, sessions: snap.sessions.slice(Math.floor(snap.sessions.length / 4)), blocks: blockRows }
  }
  // Encore trop gros : le store ne garde que ce poste ; les autres reviennent au relevé suivant.
  const toStore = JSON.stringify(snap).length > STORE_LIMIT ? { ...snap, rows: snap.rows.filter((r) => r.machine === machine), sessions: snap.sessions.filter((s) => s.machine === machine), machines: [machine] } : snap

  await update($, snapshot, () => snap)
  await update($, meta, () => EMPTY_META)
  await quietly(() => $.store.set(STORE_SNAPSHOT, toStore))
  await syncStatus($)
  if (isAsked) await say($, 'ok', `✓ Relevé à jour : ${fmtCost(sum(snap.rows).cost)} au total, ${daily.isOffline ? 'prix hors ligne' : 'prix en ligne'}.`)
}

// ─── Partage entre postes ───────────────────────────────────────────────────

/** Le nom de ce poste, lu dans `claude-usage/.machine` ; null s'il n'est pas réglé. */
async function machineName($: any, dir: string | null): Promise<string | null> {
  if (!dir) return null
  try {
    const name = firstLine(await $.fs.read(`${dir}/${USAGE_DIR}/${MACHINE_FILE}`))
    return name || null
  } catch {
    return null
  }
}

/** Le fichier que ce poste a déjà publié, s'il existe : son historique survit à un nouveau clone ou à une mise à jour. */
async function readOwn($: any, dir: string | null, name: string | null): Promise<Published | null> {
  if (!dir || !name) return null
  try {
    return parsePublished(JSON.parse(await $.fs.read(`${dir}/${USAGE_DIR}/machines/${machineFile(name)}`)))
  } catch {
    return null
  }
}

async function git($: any, repo: string, args: string[]): Promise<Run> {
  return $.process.run(['git', '-C', repo, ...args], { timeoutMs: 60_000, env: GIT_ENV })
}

/**
 * Publie les usages de ce poste dans le dépôt partagé, puis lit ceux des autres. Chaque poste
 * n'écrit que son fichier : `pull --rebase` ne peut pas entrer en conflit. Un échec de git
 * (hors ligne, identifiants) devient un avertissement ; les fichiers déjà là sont lus quand même.
 */
async function share($: any, dir: string | null, name: string | null, own: Parameters<typeof publishedOf>[0], warnings: string[]): Promise<Published[]> {
  if (!dir) return []
  const repo = `${dir}/${USAGE_DIR}`
  if (!(await Promise.resolve($.fs.exists(`${repo}/.git`)).catch(() => false))) {
    warnings.push(`Partage entre postes désactivé : pas de dépôt ${USAGE_DIR} dans le dossier de Claude Code (/setup:install le clone).`)
    return []
  }
  if (!name) warnings.push(`Ce poste n’a pas de nom : ses usages ne sont pas publiés (/setup:install, ou une ligne dans ${USAGE_DIR}/${MACHINE_FILE}).`)
  // Plusieurs sessions de Claude Code font leur relevé en même temps sur ce poste : git refuse
  // alors la seconde (`index.lock`). On réessaie un peu plus tard ; si le verrou tient encore,
  // l'autre session publie les mêmes données, sauf s'il traîne depuis longtemps (git planté).
  for (let attempt = 1; ; attempt++) {
    try {
      if (name) await publish($, repo, name, own)
      else {
        const pull = await git($, repo, ['pull', '--ff-only'])
        if (pull.exitCode !== 0) throw new Error(firstLine(pull.stderr) || `git pull : code ${pull.exitCode}`)
      }
      break
    } catch (err) {
      const isLocked = /\.lock\b|another git process/i.test(messageOf(err))
      if (isLocked && attempt < 3) {
        await $.clock.sleep(2_000 * attempt)
        continue
      }
      if (!isLocked) warnings.push(`Partage entre postes : ${messageOf(err)}`)
      else if (await isStaleLock($, repo)) warnings.push(`Partage entre postes : un verrou git traîne depuis plus de 10 min (${USAGE_DIR}/.git/index.lock, git a dû s’arrêter en route) ; le supprimer débloque la publication.`)
      break
    }
  }
  return readOthers($, repo, name, warnings)
}

/** Le verrou d'index de git date de plus de 10 min : aucun git ne tourne plus, il est abandonné. */
async function isStaleLock($: any, repo: string): Promise<boolean> {
  try {
    const entries: { name: string; mtimeMs: number }[] = await $.fs.list(`${repo}/.git`)
    const lock = entries.find((e) => e.name === 'index.lock')
    return !!lock && (await $.clock.now()) - lock.mtimeMs > 10 * 60_000
  } catch {
    return false
  }
}

async function publish($: any, repo: string, name: string, own: Parameters<typeof publishedOf>[0]) {
  const file = `machines/${machineFile(name)}`
  const body = publishedOf(own)
  // Rien de neuf depuis la dernière publication : ni écriture, ni commit (l'heure seule ne compte pas).
  const before = await Promise.resolve($.fs.read(`${repo}/${file}`)).catch(() => null)
  let isSame = false
  try {
    const { updatedAt: _, ...old } = JSON.parse(before ?? 'null') ?? {}
    isSame = JSON.stringify(old) === JSON.stringify(body)
  } catch {
    // Fichier absent ou abîmé : il est réécrit.
  }
  if (!isSame) await $.fs.write(`${repo}/${file}`, JSON.stringify({ ...body, updatedAt: await $.clock.now() }))
  // Pas commité, cette fois ou une précédente (commit raté) : on (re)tente, sinon le rebase refuserait.
  const pending = await git($, repo, ['status', '--porcelain', '--', file])
  if (pending.exitCode === 0 && pending.stdout.trim()) {
    const add = await git($, repo, ['add', '--', file])
    if (add.exitCode !== 0) throw new Error(`git add : ${firstLine(add.stderr) || `code ${add.exitCode}`}`)
    const commit = await git($, repo, ['commit', '-q', '-m', `usage: ${name}`, '--', file])
    if (commit.exitCode !== 0) throw new Error(`git commit : ${firstLine(commit.stderr) || firstLine(commit.stdout) || `code ${commit.exitCode}`}`)
  }
  const pull = await git($, repo, ['pull', '--rebase', '-q'])
  if (pull.exitCode !== 0) {
    // Un rebase arrêté en route bloquerait tous les relevés suivants : on revient à l'état d'avant.
    await git($, repo, ['rebase', '--abort']).catch(() => undefined)
    throw new Error(`git pull : ${firstLine(pull.stderr) || `code ${pull.exitCode}`}`)
  }
  // Sans branche suivie (`@{u}` inconnu), on pousse quand même.
  const ahead = await git($, repo, ['rev-list', '--count', '@{u}..HEAD'])
  if (ahead.exitCode !== 0 || Number(ahead.stdout.trim()) > 0) {
    const push = await git($, repo, ['push', '-q'])
    if (push.exitCode !== 0) throw new Error(`git push : ${firstLine(push.stderr) || `code ${push.exitCode}`}`)
  }
}

/** Les fichiers publiés des autres postes (`machines/*.json`), sauf celui de ce poste. */
async function readOthers($: any, repo: string, name: string | null, warnings: string[]): Promise<Published[]> {
  const own = name ? machineFile(name) : null
  let entries: { name: string; kind: string }[] = []
  try {
    entries = await $.fs.list(`${repo}/machines`)
  } catch {
    return []
  }
  const out: Published[] = []
  for (const e of entries) {
    if (e.kind !== 'file' || !e.name.endsWith('.json') || e.name === own) continue
    try {
      const p = parsePublished(JSON.parse(await $.fs.read(`${repo}/machines/${e.name}`)))
      if (p) out.push(p)
      else warnings.push(`Usages d’un autre poste ignorés : machines/${e.name} n’a pas le format attendu.`)
    } catch (err) {
      warnings.push(`Usages d’un autre poste illisibles (machines/${e.name}) : ${messageOf(err)}`)
    }
  }
  return out.sort((a, b) => a.machine.localeCompare(b.machine))
}

// ─── Discussion ouverte ─────────────────────────────────────────────────────

/** La discussion ouverte d'après le moteur : son identifiant, son coût (comme /cost), son contexte, ses tours. */
async function readLive($: any) {
  const id: string = await $.session.id()
  const u = await $.session.usage()
  const turns = await Promise.resolve($.session.turns()).catch(() => 0)
  const model = await Promise.resolve($.session.model()).catch(() => null)
  const live: NonNullable<Discussion['live']> = {
    cost: typeof u?.cost?.usd === 'number' ? u.cost.usd : null,
    contextPercent: typeof u?.context?.percent === 'number' ? u.context.percent : null,
    contextTokens: typeof u?.context?.tokens === 'number' ? u.context.tokens : null,
    window: typeof u?.context?.window === 'number' ? u.context.window : null,
    turns: typeof turns === 'number' ? turns : 0,
    model: typeof model === 'string' ? model : null,
    startedAt: typeof u?.startedAt === 'number' ? u.startedAt : null,
    at: await $.clock.now(),
  }
  // Une autre discussion (après /clear) : son détail et ses tours repartent de zéro.
  await update($, discussion, (d) => (d.id === id ? { ...d, live } : { ...EMPTY_DISCUSSION, id, live }))
}

/** Le détail de la discussion ouverte (`ccusage claude session --id`) : quelques secondes, un à la fois. */
function refreshDiscussion($: any): Promise<void> {
  if (detailInFlight) return detailInFlight
  detailInFlight = (async () => {
    try {
      await update($, discussion, (d) => ({ ...d, loading: true, error: null }))
      await quietly(() => readLive($))
      const id: string = await $.session.id()
      const res = await npx($, ['-y', 'ccusage@latest', 'claude', 'session', '--id', id, '--json'])
      if (res.exitCode !== 0) throw new Error(firstLine(res.stderr) || firstLine(res.stdout) || `code ${res.exitCode}`)
      // `null` : ccusage ne trouve pas encore la discussion (aucun appel écrit dans sa transcription).
      const parsed = res.stdout.trim() === 'null' ? { cost: 0, tokens: 0, entries: [] } : discussionOf(parseJson(res.stdout))
      const fetchedAt = await $.clock.now()
      await update($, discussion, (d) => ({ ...(d.id === id ? d : { ...EMPTY_DISCUSSION, id }), detail: { fetchedAt, ...parsed }, loading: false, error: null }))
    } catch (err) {
      await update($, discussion, (d) => ({ ...d, loading: false, error: `Détail de la discussion impossible : ${messageOf(err)}` }))
    } finally {
      detailInFlight = null
    }
  })()
  return detailInFlight
}

/** Lance npx, en essayant les lanceurs connus de Windows ; ne passe au suivant que si le précédent ne démarre pas. */
async function npx($: any, args: string[]): Promise<Run> {
  const tries = launcher ? [launcher] : [['npx'], ['npx.cmd'], ['cmd.exe', '/d', '/s', '/c', 'npx']]
  // L'erreur citée est celle de `npx` lui-même : les lanceurs suivants n'existent que sous Windows.
  let first: unknown = null
  for (const l of tries) {
    try {
      const res: Run = await $.process.run([...l, ...args], {
        timeoutMs: 240_000,
        env: { NO_COLOR: '1', FORCE_COLOR: '0', npm_config_update_notifier: 'false', npm_config_fund: 'false' },
      })
      launcher = l
      return res
    } catch (err) {
      first ??= err
      // Lancé mais trop lent : un autre lanceur ne ferait pas mieux.
      if (/time|still running|délai/i.test(messageOf(err))) throw new Error(`ccusage n'a pas répondu à temps (${messageOf(err)})`)
    }
  }
  throw new Error(`npx introuvable : Node.js est-il installé ? (${messageOf(first)})`)
}

/** Une commande ccusage en JSON ; en cas d'échec avec les prix en ligne, un second essai avec les prix embarqués. */
async function ccusage($: any, args: string[], isOffline: boolean): Promise<{ json: Json; isOffline: boolean }> {
  const once = async (offline: boolean) => {
    const res = await npx($, ['-y', 'ccusage@latest', ...args, ...(offline ? ['--offline'] : [])])
    if (res.exitCode !== 0) throw new Error(`ccusage ${args.slice(0, 2).join(' ')} : ${firstLine(res.stderr) || firstLine(res.stdout) || `code ${res.exitCode}`}`)
    // Sans réseau, ccusage retombe seul sur ses prix embarqués et le dit sur stderr.
    return { json: parseJson(res.stdout), isOffline: offline || /embedded pricing|failed to fetch/i.test(res.stderr) }
  }
  if (isOffline) return once(true)
  try {
    return await once(false)
  } catch {
    return once(true)
  }
}

async function ccusageVersion($: any): Promise<string | null> {
  try {
    const res = await npx($, ['-y', 'ccusage@latest', '--version'])
    return res.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null
  } catch {
    return null
  }
}

/** Le fuseau de la machine (par Node) : ccusage groupe les jours avec, le mod calcule « aujourd'hui » avec. */
async function timezone($: any): Promise<{ offset: number; name: string | null }> {
  try {
    const res: Run = await $.process.run(['node', '-p', 'JSON.stringify([new Date().getTimezoneOffset(), Intl.DateTimeFormat().resolvedOptions().timeZone])'], { timeoutMs: 15_000 })
    const [offset, name] = JSON.parse(res.stdout.trim()) as [unknown, unknown]
    if (typeof offset === 'number') return { offset, name: typeof name === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(name) ? name : null }
  } catch {
    // Pas de Node à part : le fuseau de l'environnement du mod.
  }
  return { offset: new Date().getTimezoneOffset(), name: null }
}

async function homeDir($: any): Promise<string | null> {
  return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? null
}

/** Le dossier de Claude Code : `CLAUDE_CONFIG_DIR` (le premier s'il y en a plusieurs), sinon `~/.claude`. */
async function claudeDir($: any): Promise<string | null> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  if (custom) return custom.split(',')[0]!.trim()
  const home = await homeDir($)
  return home ? `${home}/.claude` : null
}

async function readActivity($: any, dir: string | null) {
  if (!dir) return null
  try {
    return activityOf(JSON.parse(await $.fs.read(`${dir}/stats-cache.json`)))
  } catch {
    return null
  }
}

// Lit le début (256 Kio) des plus petites transcriptions de chaque projet et rend `{ clé: dossier }` :
// le premier `"cwd"` qui donne la clé, à défaut le premier tout court (comme `cwdOf`).
// Par Node : une transcription dépasse souvent les 4 Mio que `$.fs.read` accepte.
const CWD_SCRIPT = String.raw`const fs=require('fs'),p=require('path');const [dir,...keys]=process.argv.slice(1);const out={};for(const k of keys){try{const d=p.join(dir,'projects',k);const fl=fs.readdirSync(d).filter(f=>f.endsWith('.jsonl')).map(f=>({f,s:fs.statSync(p.join(d,f)).size})).filter(x=>x.s>0).sort((a,b)=>a.s-b.s).slice(0,5);let first=null,hit=null;for(const {f} of fl){const fd=fs.openSync(p.join(d,f),'r');const b=Buffer.alloc(262144);const n=fs.readSync(fd,b,0,b.length,0);fs.closeSync(fd);for(const m of b.toString('utf8',0,n).matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)){let c;try{c=JSON.parse('"'+m[1]+'"')}catch{continue}if(c.replace(/[^a-zA-Z0-9]/g,'-')===k){hit=c;break}if(first===null)first=c}if(hit!==null)break}const r=hit??first;if(r!==null)out[k]=r}catch{}}console.log(JSON.stringify(out))`

/**
 * Le dossier de chaque projet de ce poste, lu une fois dans ses transcriptions puis gardé : la clé
 * ccusage seule ne dit pas où étaient les tirets. Un dossier gardé qui ne donne pas sa clé
 * (`isStale`) est relu ; s'il n'est plus lisible, l'ancien reste. Seules les clés de ce poste
 * sont rendues : les projets des autres postes reviennent de leurs fichiers publiés. Un seul
 * processus Node pour tous les projets à lire ; s'il échoue, une lecture directe des petites
 * transcriptions.
 */
async function resolveProjects($: any, keys: readonly string[], known: Record<string, ProjectInfo>, dir: string | null, home: string | null): Promise<Record<string, ProjectInfo>> {
  const out: Record<string, ProjectInfo> = {}
  for (const k of keys) if (known[k] && !isStale(k, known[k]!)) out[k] = known[k]!
  const todo = keys.filter((k) => !k.startsWith('@') && !out[k]).slice(0, 120)
  let found: Record<string, unknown> = {}
  if (dir && todo.length) {
    try {
      const res: Run = await $.process.run(['node', '-e', CWD_SCRIPT, dir, ...todo], { timeoutMs: 60_000 })
      if (res.exitCode === 0) found = JSON.parse(res.stdout.trim() || '{}')
    } catch {
      // Pas de Node à part : la lecture directe ci-dessous.
    }
  }
  for (const key of todo) {
    let path: string | null = typeof found[key] === 'string' ? (found[key] as string) : null
    if (dir && !path) {
      try {
        const entries: { name: string; kind: string; size: number }[] = await $.fs.list(`${dir}/projects/${key}`)
        const files = entries
          .filter((x) => x.kind === 'file' && x.name.endsWith('.jsonl') && x.size > 0 && x.size < 3_500_000)
          .sort((a, b) => a.size - b.size)
          .slice(0, 5)
        let first: string | null = null
        for (const f of files) {
          const cwd = cwdOf(await $.fs.read(`${dir}/projects/${key}/${f.name}`), key)
          if (cwd && projectKey(cwd) === key) {
            path = cwd
            break
          }
          first ??= cwd
        }
        path ??= first
      } catch {
        // Dossier effacé ou illisible : le nom vient de la clé.
      }
    }
    out[key] = path ? { name: nameOfPath(path, home), path } : (known[key] ?? { name: '', path: null })
  }
  // Au-delà des 120 lus par relevé : le dossier gardé, en attendant le relevé suivant.
  for (const k of keys) if (!out[k] && known[k]) out[k] = known[k]!
  return out
}

// ─── Petits outils ──────────────────────────────────────────────────────────

const isSnapshot = (value: unknown): value is Snapshot =>
  typeof value === 'object' && value !== null && (value as Snapshot).schema === SCHEMA && Array.isArray((value as Snapshot).rows) && typeof (value as Snapshot).fetchedAt === 'number' && Array.isArray((value as Snapshot).sessions)

// Un mot dans la zone d'activité, doublé d'un toast ; les confirmations s'effacent seules,
// les erreurs restent jusqu'au « x ».
async function say($: any, tone: 'ok' | 'error' | 'info', text: string) {
  await update($, notice, () => ({ text, tone }))
  await quietly(() => $.ui.toast(text))
  if (tone !== 'error') $.clock.after(8000, () => void update($, notice, (x) => (x && x.text === text ? null : x)))
}
