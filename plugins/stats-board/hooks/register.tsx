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
import type { PromptOrigin, Register } from 'claude-code'

import type { Discussion, Meta, Notice, ProjectInfo, Published, SessionRow, Snapshot, Tab, Tracker, Ui, UsageRow } from '../types'
import {
  LOCAL_LABEL,
  SCHEMA,
  activityOf,
  blocksOf,
  cwdOf,
  dayOf,
  discussionOf,
  floorMinute,
  fmtCost,
  isStale,
  keepHistory,
  keepSessions,
  machineFile,
  mergeMachines,
  nameOfPath,
  ownHistory,
  parseJson,
  parseLabels,
  parsePublished,
  projectKey,
  publishedOf,
  rowsOfDaily,
  sessionsOf,
  statusText,
  sum,
  unique,
  unpricedOf,
  withLabels,
} from './model.ts'
import {
  EMPTY_TRACKER,
  REQUESTS_DIR,
  attachAgent,
  costed,
  endTurn,
  finishTask,
  noteTasks,
  openRequest,
  endWait,
  ownerNow,
  recordCall,
  relaunchOwner,
  requestFile,
  requestOfAgent,
  requestOfTurn,
  startTurn,
  startWait,
  type Call,
  type Relaunch,
} from './requests.ts'
import { BROKEN, EMPTY_DURATIONS, MONTH_FILE, TOTALS_DIR, emptyMonth, joinMonths, monthOfJson, monthsOf, parseRequestLog, refreshDurations } from './durations.ts'
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
/** Les noms d'affichage des projets, communs aux postes, à la racine du dépôt partagé. */
const LABELS_FILE = 'names.json'
/** git sans invite : un push sans identifiants échoue au lieu d'attendre. */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
/** Plafond du relevé gardé dans `$.store` (4 Mio en tout pour le plugin). */
const STORE_LIMIT = 3_000_000
/** Le délai d'un nouveau relevé après un relevé qui n'est pas net (totaux de durée lus en partie). */
const RETRY_MS = 45_000
/**
 * Un mois de totaux illisible modifié depuis moins de 2 minutes est en cours d'écriture par une autre
 * session (une écriture dure quelques millisecondes) ; plus ancien, il est cassé pour de bon (décision « Seuil »).
 */
const MONTH_BUSY_MS = 2 * 60_000

const EMPTY_UI: Ui = {
  tab: 'overview',
  period: 'all',
  machine: 'all',
  metric: 'cost',
  grain: 'day',
  project: null,
  model: null,
  sessionSort: 'cost',
  requestSort: 'cost',
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
// Sans texte de message : lisible par les autres plugins, comme tout `$.state`.
const requests = atom({ plugin: 'stats-board', key: 'requests' } as const, EMPTY_TRACKER as Tracker)

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
/** Heure (horloge du mod) où la relance d'un relevé qui n'est pas net a été armée ; null sans relance prévue. */
let retryArmedAt: number | null = null

// Les prompts reçus, en attente du `turn.start` de leur tour : le moteur rend la main de
// `prompt.submit` avant ce tour (essai du 26/10/2026, Claude Code 2.1.310 et 2.1.308), donc
// `turn.start` retrouve le sien par le texte, le même dans les deux événements (comme le chrono de
// session-tools). Un message tapé pendant un tour a déjà sa requête (`request`) : s'il attend le
// tour suivant, ce tour travaille pour elle. Seule l'empreinte du texte est gardée, jamais le
// texte. Les dix derniers suffisent : un prompt attend son tour quelques millisecondes.
let submitted: Submitted[] = []
type Submitted = { print: string; at: number; isUser: boolean; kind: string | undefined; request?: number }

// Le début de chaque message (Q15 bis) : dans cette variable seulement, jamais dans `$.state`,
// `$.store` ni un fichier. Perdu au rechargement du module ou à la reprise de la session : la carte
// « Requêtes » n'affiche alors que l'heure. Clé : `<fichier de relevé>#<requête>`.
const openings = new Map<string, string>()
const OPENINGS_MAX = 500
const OPENING_CHARS = 60

// L'écriture du fichier de relevé : une à la fois, dans l'ordre, et regroupée quand les arrêts se suivent.
/** Heure (horloge du système) de la dernière écriture demandée et pas encore partie ; null sans attente. */
let writeDueAt: number | null = null
let writes: Promise<void> = Promise.resolve()
const WRITE_DELAY_MS = 500
const WRITE_STALE_MS = 10 * WRITE_DELAY_MS

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

/**
 * Une question à boutons ou un plan à valider : tout l'appel attend la réponse de l'utilisateur, une
 * attente exclue du temps actif de la requête. Sa requête est lue à l'entrée, comme pour un appel au
 * modèle ; le résultat de `next` est rendu tel quel (le moteur y retrouve ses messages). Un crochet
 * par outil, chacun nommé en toutes lettres : un nom d'outil en variable fait déborder la mémoire de tsc.
 */
async function waitForAnswer($: any, e: { agentId?: string }, next: (e: any) => Promise<any>) {
  const from = await $.clock.now()
  const t = await read($, requests)
  const request = e.agentId ? requestOfAgent(t, e.agentId) : (ownerNow(t) ?? undefined)
  await quietly(() => update($, requests, (x) => startWait(x, request, from)))
  try {
    return await next(e)
  } finally {
    const at = await $.clock.now()
    await quietly(() => update($, requests, (x) => endWait(x, request, from, at)))
  }
}

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
    // Une nouvelle session repart sans relance prévue : une minuterie d'avant a pu se perdre au rechargement.
    retryArmedAt = null
    // Le dernier relevé, gardé d'une session à l'autre : bandeau et panneau l'ont tout de suite.
    if (!(await read($, snapshot))) {
      const stored = await Promise.resolve($.store.get(STORE_SNAPSHOT)).catch(() => undefined)
      if (isSnapshot(stored)) {
        // Le store ne garde pas les durées : celles de ce poste se relisent dans leurs fichiers par
        // mois, celles des autres dans leurs fichiers publiés (clone local, sans git).
        const dir = await claudeDir($)
        // Un store réduit à ce poste (trop gros) : les autres postes reviennent au relevé, comme avant.
        const [found, peers] = await Promise.all([
          readTotals($, dir, await $.clock.now()).catch(() => null),
          stored.machines.length > 1 ? peersOf($, dir, stored).catch(() => undefined) : undefined,
        ])
        const totals = found?.durations ?? null
        // Un mois mal lu à l'ouverture : un relevé sous une minute plutôt qu'à l'âge du dernier.
        if (found && !found.isClean) await retrySoon($)
        await update($, snapshot, () => ({ ...stored, ...(totals ? { durations: totals } : {}), ...(peers ? { peers } : {}) }))
      }
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

  // Requêtes : un message de l'utilisateur en ouvre une. Au repos, il est noté en attendant son
  // tour ; pendant un tour, il le rejoint et prend la suite du tour.
  on('prompt.submit', async ($, e, next) => {
    const at = await $.clock.now()
    const isUser = fromUser(e.origin)
    const print = printOf(e.text)
    const kind = e.origin?.kind
    // Une notification livrée pendant un tour n'en crée pas : sa tâche, finie, quitte sa requête
    // à cet instant, et le travail qui suit reste au tour en cours.
    if (e.turnId && !isUser) await quietly(() => update($, requests, (t) => finishTask(t, notifiedTask(relaunchOf(kind, e.text)))))
    // Une commande tapée pendant un tour (locale, ou un skill qui attendra le tour suivant) n'ouvre
    // rien ici : si elle passe au modèle, son tour l'ouvre.
    if (!e.turnId || !isUser || e.command) {
      submitted = [...submitted.slice(-9), { print, at, isUser, kind }]
      return next(e)
    }
    // Envoyé pendant un tour : le message ouvre sa requête et prend la suite du tour, s'il entre.
    const result = await next(e)
    if (!('drop' in result)) {
      await quietly(async () => {
        const request = await openFor($, e.text, at, e.turnId)
        submitted = [...submitted.slice(-9), { print, at, isUser, kind, request }]
      })
    }
    return result
  }).catch(() => undefined) // en cas de panne du mod, le message passe sans lui

  on('turn.start', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId === undefined) await quietly(() => noteTurn($, e.text, e.turnId))
    // Le premier tour d'un agent vu sans `agent.spawn` (un agent interne de Claude Code) : rattaché en attendant.
    else await quietly(() => update($, requests, (t) => attachAgent(t, agentId, { isSpawn: false })))
    return next(e)
  })

  // Un agent lancé : rattaché à la requête de son parent, ou à celle du fil principal (docs/evenements-moteur.md, « Filiation »).
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const agentId = result.agentId
    if (agentId) await quietly(() => update($, requests, (t) => attachAgent(t, agentId, { parent: e.parentAgentId, isSpawn: true })))
    return result
  }).catch(() => undefined) // en cas de panne du mod, l'agent part sans lui

  // Chaque appel au modèle, du fil principal ou d'un agent : ses tokens, son modèle, sa durée (de
  // l'entrée dans l'étape à la fin du flux) et son temps de génération (du premier morceau au dernier).
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    // La requête à l'entrée de l'appel : un message envoyé pendant l'appel ne le lui prend pas.
    const t = await read($, requests)
    const request = e.agentId ? requestOfAgent(t, e.agentId) : requestOfTurn(t, e.turnId)
    const stream = next(e)
    let firstAt: number | null = null
    let stopAt: number | null = null
    let usage: Call['usage'] & { model?: string } | null = null
    for await (const chunk of stream) {
      // Le premier morceau de la réponse ; l'enveloppe et les marques de nouvel essai n'en sont pas.
      if (firstAt === null && chunk.kind !== 'engine') firstAt = await $.clock.now()
      if (chunk.kind === 'stop' && chunk.usage) {
        usage = chunk.usage
        stopAt = await $.clock.now()
      }
      yield chunk
    }
    const result = await stream.result
    usage ??= result?.usage ?? null
    // Sans usage (appel interrompu ou en échec) : ses durées comptent, sans token.
    const end = await $.clock.now()
    // Sans usage, le modèle demandé, sans sa marque de variante (`[1m]`) : l'id que l'API rend aux autres appels.
    const call: Call = { model: usage?.model || e.model.replace(/\[[^\]]*\]$/, ''), usage: usage ?? NO_USAGE, apiMs: end - startedAt, genMs: (stopAt ?? end) - (firstAt ?? end), span: [startedAt, end] }
    await quietly(() => update($, requests, (t) => recordCall(t, request, call)))
    return result
  })

  on('tool.call', { tool: 'AskUserQuestion' }, waitForAnswer)
  on('tool.call', { tool: 'ExitPlanMode' }, waitForAnswer)

  // Le fil principal s'arrête : la liste des tâches de fond est à jour (repli sans elle : les agents
  // encore actifs), puis le relevé de la session est écrit (un peu après, pour la fin du tour).
  on('classic.Stop', async ($, e, next) => {
    const ids = e.background_tasks ? e.background_tasks.map((x) => x.id) : await activeAgents($)
    await quietly(() => update($, requests, (t) => noteTasks(t, ids, ownerNow(t))))
    scheduleWrite($)
    return next(e)
  }).catch(() => undefined) // en cas de panne du mod, l'arrêt passe sans lui

  // Un agent s'arrête : sa liste est à jour aussi. Une tâche qui y apparaît pour la première fois va
  // à la requête courante, comme à l'arrêt du fil principal (docs/evenements-moteur.md, « Filiation »).
  on('classic.SubagentStop', async ($, e, next) => {
    const list = e.background_tasks
    if (list) await quietly(() => update($, requests, (t) => noteTasks(t, list.map((x) => x.id), ownerNow(t))))
    return next(e)
  }).catch(() => undefined) // en cas de panne du mod, l'arrêt passe sans lui

  // Après un tour de la conversation principale : sa requête, ses tokens et le coût du moteur pour
  // la discussion, puis un relevé si le dernier a vieilli.
  on('turn.complete', async ($, e, next) => {
    // L'heure de fin avant les hooks d'en dessous, et la requête close même si l'un d'eux échoue.
    const at = await $.clock.now()
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } finally {
      if (!e.agentId) {
        // Hors d'une fin normale, pas de `classic.Stop` (interruption : docs/evenements-moteur.md ; erreur : à
        // confirmer) : la requête garde ses tâches connues et ses agents encore actifs.
        const isInterrupted = e.reason !== 'answer'
        const active = isInterrupted ? await activeAgents($) : []
        await quietly(() => update($, requests, (t) => endTurn(t, e.turnId, at, { isInterrupted, activeAgents: active })))
      }
      // Une interruption n'a pas de `classic.Stop`, un agent qui finit son tour non plus : l'écriture part d'ici aussi.
      scheduleWrite($)
    }
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

  // Fin de la session (sortie, `claude -p` fini, `/clear`, reprise) : le relevé est écrit tout de
  // suite, sans attendre le regroupement. Après `/clear`, le suivi repart de zéro.
  on('session.end', async ($, e, next) => {
    await quietly(() => writes.then(() => writeLog($)))
    if (e.reason === 'clear') {
      await quietly(() => update($, requests, () => EMPTY_TRACKER))
      // Les débuts de message de la discussion d'avant ne servent plus.
      openings.clear()
    }
    return next(e)
  }).catch(() => undefined) // en cas de panne du mod, la fin passe sans lui

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await readView($, true)
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

/** `withRequests` : le panneau seulement ; le bandeau n'affiche pas les requêtes et ne s'abonne pas à elles. */
async function readView($: any, withRequests = false): Promise<View> {
  const tracker = withRequests ? await read($, requests) : EMPTY_TRACKER
  return {
    snapshot: await read($, snapshot),
    ui: await read($, ui),
    meta: await read($, meta),
    notice: await read($, notice),
    isBandHidden: await read($, isBandHidden),
    here: await read($, here),
    discussion: await read($, discussion),
    requests: tracker,
    openings: openingsOf(tracker),
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

/**
 * Un relevé sous une minute, après un relevé qui n'est pas net : une seule relance prévue à la fois,
 * quel que soit le nombre de relevés non nets entre-temps. Échue pendant un relevé en cours, elle
 * attend sa fin puis repart : ce relevé a pu passer son propre appel avant elle.
 */
async function retrySoon($: any) {
  const now = await $.clock.now()
  // Une minuterie refusée par un hook n'appelle jamais sa fonction : passé deux délais, une nouvelle est armée.
  if (retryArmedAt !== null && now - retryArmedAt < 2 * RETRY_MS) return
  retryArmedAt = now
  try {
    $.clock.after(RETRY_MS, () => {
      void (async () => {
        if (inFlight) await inFlight
        retryArmedAt = null
        await refresh($, false)
      })()
    })
  } catch {
    retryArmedAt = null
  }
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

  await step('Durées : fichiers de relevé des requêtes…')
  // Les totaux d'avant : ceux des fichiers par mois, que d'autres sessions ont pu avancer ; lus en
  // partie seulement, ceux que cette session a déjà en mémoire (décision « Règle »).
  const totals = await readTotals($, dir, await $.clock.now()).catch(() => ({ durations: null, texts: new Map<string, string>(), isClean: false }))
  const prevDurations = (totals.isClean ? totals.durations : (previous?.durations ?? totals.durations)) ?? previous?.durations ?? EMPTY_DURATIONS
  const fresh = await readDurations($, dir, prevDurations, tz.offset, machine)
  const durations = fresh.durations
  // Relevé net : le dossier des totaux, tous ses mois et la liste des fichiers de relevé se sont lus.
  // Sinon, ni écriture ni publication ; un relevé repart sous une minute.
  const isNet = totals.isClean && fresh.isListed
  if (totals.isClean && fresh.isLost) {
    warnings.push('Durées : dossier des relevés introuvable (~/.claude/stats-board/requetes) ; les totaux déjà connus sont gardés, rien n’est réécrit.')
  } else if (isNet) {
    try {
      await writeTotals($, dir, durations, totals.texts)
    } catch (err) {
      warnings.push(`Totaux de durée : écriture impossible (${messageOf(err)}) ; ils se refont depuis les relevés à chaque relevé.`)
    }
  } else {
    warnings.push('Durées : totaux lus en partie (un mois en cours d’écriture ou illisible) ; ni écrits ni publiés, nouveau relevé dans une minute.')
    await retrySoon($)
  }

  await step('Partage entre postes : publication et lecture des autres postes…')
  const own = { machine, tzOffset: tz.offset, rows: kept.rows, sessions: ownSessions, projects: ownProjects, durations }
  const others = await share($, dir, name, own, warnings, isNet || (totals.isClean && !!fresh.isLost))
  const merged = mergeMachines(own, others)

  let snap: Snapshot = {
    schema: SCHEMA,
    fetchedAt: await $.clock.now(),
    tzOffset: tz.offset,
    rows: merged.rows,
    sessions: merged.sessions.slice(-1500),
    blocks: blockRows.slice(-400),
    activity,
    projects: withLabels(merged.projects, await readLabels($, dir, warnings)),
    unpriced: unpricedOf(daily.json, sessions.json),
    isOffline: daily.isOffline || sessions.isOffline,
    machine,
    machines: merged.machines,
    sessionless: merged.sessionless,
    version,
    keptDays: kept.kept,
    durations,
    peers: merged.peers,
    warnings,
  }
  // Le store du plugin tient en 4 Mio, sans les durées, gardées dans leurs fichiers par mois : au-delà, les
  // plus vieilles sessions et blocs cèdent.
  const sizeOf = (x: Snapshot) => JSON.stringify({ ...x, durations: EMPTY_DURATIONS, peers: undefined }).length
  while (sizeOf(snap) > STORE_LIMIT && (snap.sessions.length > 100 || snap.blocks.length > 50)) {
    blockRows = snap.blocks.slice(Math.floor(snap.blocks.length / 4))
    snap = { ...snap, sessions: snap.sessions.slice(Math.floor(snap.sessions.length / 4)), blocks: blockRows }
  }
  // Encore trop gros : le store ne garde que ce poste ; les autres reviennent au relevé suivant.
  const trimmed = sizeOf(snap) > STORE_LIMIT ? { ...snap, rows: snap.rows.filter((r) => r.machine === machine), sessions: snap.sessions.filter((s) => s.machine === machine), machines: [machine] } : snap
  // Ni les durées de ce poste (fichiers par mois) ni celles des autres (fichiers publiés) : elles se relisent à l'ouverture.
  const toStore = { ...trimmed, durations: EMPTY_DURATIONS, peers: undefined }

  await update($, snapshot, () => snap)
  await update($, meta, () => EMPTY_META)
  await quietly(() => $.store.set(STORE_SNAPSHOT, toStore))
  await syncStatus($)
  if (isAsked) await say($, 'ok', `✓ Relevé à jour : ${fmtCost(sum(snap.rows).cost)} au total, ${daily.isOffline ? 'prix hors ligne' : 'prix en ligne'}.`)
}

// ─── Durées ─────────────────────────────────────────────────────────────────

/**
 * Les durées de ce poste d'après les fichiers de relevé (`~/.claude/stats-board/requetes/`) : seuls
 * les fichiers modifiés depuis le relevé précédent sont relus (`refreshDurations`). Un fichier
 * illisible, en cours d'écriture par sa session, est relu au relevé suivant.
 */
async function readDurations($: any, dir: string | null, prev: Snapshot['durations'], tz: number, machine: string): Promise<{ durations: Snapshot['durations']; isListed: boolean; isLost?: boolean }> {
  if (!dir) return { durations: prev, isListed: false }
  const folder = `${dir}/${REQUESTS_DIR}`
  let entries: { name: string; kind: string; mtimeMs: number }[]
  try {
    entries = await $.fs.list(folder)
  } catch {
    // Pas encore de dossier (aucune requête relevée sur ce poste, tous les postes à la mise à jour) :
    // rien de neuf, et le relevé reste net tant qu'il n'y a aucun fichier d'avant à retirer. Une liste
    // qui échoue sur un dossier qui existe, ou un dossier disparu sous des totaux, ne l'est pas.
    // Disparu sous des totaux (effacé à la main) : les totaux restent tels quels, rien n'est réécrit, mais
    // le relevé publie ses coûts avec les durées déjà connues (décision « Dossier perdu »).
    const isAbsent = !(await Promise.resolve($.fs.exists(folder)).catch(() => true))
    const isEmpty = !Object.keys(prev.files).length
    return { durations: prev, isListed: isAbsent && isEmpty, isLost: isAbsent && !isEmpty }
  }
  const files = entries.filter((e) => e.kind === 'file' && e.name.endsWith('.json'))
  // Une lecture qui échoue (erreur passagère, plus de 4 Mio) attend le relevé suivant ; un JSON coupé
  // peut être laissé de côté ; un autre format (une version plus récente) attend aussi.
  const read = async (name: string) => {
    let text: string
    try {
      text = await $.fs.read(`${folder}/${name}`)
    } catch {
      return null
    }
    try {
      return parseRequestLog(JSON.parse(text))
    } catch {
      return BROKEN
    }
  }
  return { durations: await refreshDurations(prev, files, read, tz, machine, await $.clock.now()), isListed: true }
}

/**
 * Les totaux de durée gardés par mois (`~/.claude/stats-board/totaux/`), lus ensemble, avec le texte
 * de chaque mois (pour ne réécrire que ceux qui changent). `isClean` : le dossier et tous ses mois se
 * sont lus proprement ; sinon (liste ou lecture en échec, mois illisible modifié depuis moins de 2
 * minutes, donc en cours d'écriture par une autre session), le relevé n'écrit ni ne publie rien
 * (décision « Règle »). Un mois illisible plus ancien est cassé pour de bon : il compte comme absent,
 * et se réécrit depuis les relevés (décision « Mois illisible »). `durations` vaut null sans aucun
 * mois lisible.
 */
async function readTotals($: any, dir: string | null, now: number): Promise<{ durations: Snapshot['durations'] | null; texts: Map<string, string>; isClean: boolean }> {
  const texts = new Map<string, string>()
  if (!dir) return { durations: null, texts, isClean: false }
  const folder = `${dir}/${TOTALS_DIR}`
  let entries: { name: string; kind: string; mtimeMs: number }[]
  try {
    entries = await $.fs.list(folder)
  } catch {
    // Pas encore de dossier : rien à lire, et c'est net. Une liste qui échoue sur un dossier qui existe ne l'est pas.
    const isAbsent = !(await Promise.resolve($.fs.exists(folder)).catch(() => true))
    return { durations: null, texts, isClean: isAbsent }
  }
  let isClean = true
  const parts = await Promise.all(
    entries
      .filter((e) => e.kind === 'file' && MONTH_FILE.test(e.name))
      .map(async (e) => {
        const month = MONTH_FILE.exec(e.name)![1]!
        let text: string
        try {
          text = await $.fs.read(`${folder}/${e.name}`)
        } catch {
          // Une lecture qui échoue (erreur passagère, verrou) attend le relevé suivant, comme un fichier de relevé.
          isClean = false
          return null
        }
        let part: ReturnType<typeof monthOfJson> = null
        try {
          part = monthOfJson(JSON.parse(text))
        } catch {
          // JSON coupé : illisible.
        }
        // Illisible, mal formé ou rangé sous un autre nom que le sien.
        if (part?.month !== month) {
          if (now - e.mtimeMs < MONTH_BUSY_MS) isClean = false
          return null
        }
        texts.set(month, text)
        return part
      }),
  )
  return { durations: joinMonths(parts), texts, isClean }
}

/**
 * Après un relevé net (décision « Règle ») : réécrit les mois dont les totaux ont changé, et vide un
 * mois qui n'a vraiment plus rien. Deux sessions qui réécrivent les mêmes mois en même temps : la
 * dernière gagne ; des mois qui ne s'accordent plus sur un fichier de relevé le font relire au relevé
 * suivant. Lève si l'écriture échoue.
 */
async function writeTotals($: any, dir: string | null, d: Snapshot['durations'], texts: ReadonlyMap<string, string>) {
  if (!dir) return
  const folder = `${dir}/${TOTALS_DIR}`
  const parts = monthsOf(d)
  for (const month of texts.keys()) if (!parts.has(month)) parts.set(month, emptyMonth(month))
  for (const [month, part] of parts) {
    const text = JSON.stringify(part)
    if (texts.get(month) !== text) await $.fs.write(`${folder}/${month}.json`, text)
  }
}

/** Les durées des autres postes, relues dans leurs fichiers publiés du clone local de `claude-usage` (sans git). */
async function peersOf($: any, dir: string | null, snap: Snapshot): Promise<Snapshot['peers']> {
  if (!dir) return undefined
  const repo = `${dir}/${USAGE_DIR}`
  if (!(await Promise.resolve($.fs.exists(`${repo}/.git`)).catch(() => false))) return undefined
  const others = await readOthers($, repo, await machineName($, dir), [])
  const own = { machine: snap.machine, rows: snap.rows.filter((r) => r.machine === snap.machine), sessions: snap.sessions.filter((s) => s.machine === snap.machine), projects: snap.projects }
  return mergeMachines(own, others).peers
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

/** Les noms d'affichage de `names.json` dans le dépôt partagé ; absent, aucun ; illisible, un avertissement. */
async function readLabels($: any, dir: string | null, warnings: string[]): Promise<Record<string, string>> {
  if (!dir) return {}
  const file = `${dir}/${USAGE_DIR}/${LABELS_FILE}`
  if (!(await Promise.resolve($.fs.exists(file)).catch(() => false))) return {}
  try {
    // Un fichier écrit par PowerShell commence par un BOM, que JSON.parse refuse.
    const labels = parseLabels(JSON.parse(String(await $.fs.read(file)).replace(/^\uFEFF/, '')))
    if (labels) return labels
    warnings.push(`Noms des projets ignorés : ${USAGE_DIR}/${LABELS_FILE} n’est pas un objet { "dossier": "nom" }.`)
  } catch (err) {
    warnings.push(`Noms des projets illisibles (${USAGE_DIR}/${LABELS_FILE}) : ${messageOf(err)}`)
  }
  return {}
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
async function share($: any, dir: string | null, name: string | null, own: Parameters<typeof publishedOf>[0], warnings: string[], isPublishing = true): Promise<Published[]> {
  if (!dir) return []
  const repo = `${dir}/${USAGE_DIR}`
  if (!(await Promise.resolve($.fs.exists(`${repo}/.git`)).catch(() => false))) {
    warnings.push(`Partage entre postes désactivé : pas de dépôt ${USAGE_DIR} dans le dossier de Claude Code (/setup:install le clone).`)
    return []
  }
  // Un relevé qui n'est pas net ne publie rien : les autres postes se lisent dans le clone local, sans git.
  if (!isPublishing) return readOthers($, repo, name, warnings)
  if (!name) warnings.push(`Ce poste n’a pas de nom : ses usages ne sont pas publiés (/setup:install, ou une ligne dans ${USAGE_DIR}/${MACHINE_FILE}).`)
  // Plusieurs sessions de Claude Code font leur relevé en même temps sur ce poste : git refuse
  // alors la seconde (`index.lock`), ou son `pull` trouve `origin/main` déjà avancé par l'autre
  // (`cannot lock ref`). On réessaie un peu plus tard ; si ça bloque encore, l'autre session
  // publie les mêmes données, sauf si le verrou d'index traîne depuis longtemps (git planté).
  for (let attempt = 1; ; attempt++) {
    try {
      if (name) await publish($, repo, name, own)
      else {
        const pull = await git($, repo, ['pull', '--ff-only'])
        if (pull.exitCode !== 0) throw new Error(firstLine(pull.stderr) || `git pull : code ${pull.exitCode}`)
      }
      break
    } catch (err) {
      const isRefRace = /cannot lock ref/i.test(messageOf(err))
      const isLocked = isRefRace || /\.lock\b|another git process/i.test(messageOf(err))
      if (isLocked && attempt < 3) {
        await $.clock.sleep(2_000 * attempt)
        continue
      }
      if (!isLocked) warnings.push(`Partage entre postes : ${messageOf(err)}`)
      else if (!isRefRace && (await isStaleLock($, repo))) warnings.push(`Partage entre postes : un verrou git traîne depuis plus de 10 min (${USAGE_DIR}/.git/index.lock, git a dû s’arrêter en route) ; le supprimer débloque la publication.`)
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
  // La date de publication part à la minute : un relevé suit de près l'ouverture d'une session ou
  // la fin d'un tour, qu'elle ne doit pas dater à la seconde (décision « updatedAt »).
  if (!isSame) await $.fs.write(`${repo}/${file}`, JSON.stringify({ ...body, updatedAt: floorMinute(await $.clock.now()) }))
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

// ─── Requêtes ───────────────────────────────────────────────────────────────

// Les messages de l'utilisateur : tapés au terminal ou dans l'app desktop, par Remote Control
// ou Slack. `unclassified` en fait partie : l'app desktop peut envoyer sans marque d'origine.
const USER_ORIGINS = new Set(['composer', 'sdk', 'bridge', 'slack-ping', 'unclassified'])

function fromUser(origin: PromptOrigin | undefined): boolean {
  if (!origin) return true
  if (origin.kind === 'plugin') return origin.asUser === true
  return USER_ORIGINS.has(origin.kind)
}

/** Les caractères de contrôle (C0, DEL, C1) : un seul ferait refuser tout le dessin du panneau (constaté par files-board). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

/** Le début d'un message : sa première ligne non vide, sans caractère de contrôle, coupée à 60 caractères (sans couper un emoji). */
function openingOf(text: string): string {
  const chars = Array.from(firstLine(text).replace(/\s+/g, ' ').replace(CONTROL, ''))
  return chars.length > OPENING_CHARS ? `${chars.slice(0, OPENING_CHARS - 1).join('').trimEnd()}…` : chars.join('')
}

/** L'empreinte d'un texte (FNV-1a sur 32 bits, et sa longueur) : de quoi retrouver un prompt sans garder son texte. */
function printOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return `${text.length}:${(h >>> 0).toString(36)}`
}

const NO_USAGE: Call['usage'] = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const logKey = (t: Tracker): string | null => (t.log ? requestFile(t.log.session, t.log.openedAt) : null)

/** Les débuts de message des requêtes du relevé en cours, gardés par ce module. */
function openingsOf(t: Tracker): Record<number, string> {
  const key = logKey(t)
  const out: Record<number, string> = {}
  if (!key || !t.log) return out
  for (const r of t.log.requests) {
    const text = openings.get(`${key}#${r.id}`)
    if (text) out[r.id] = text
  }
  return out
}

/** Un message de l'utilisateur ouvre une requête, dont l'id est rendu ; son début reste dans ce module. */
async function openFor($: any, text: string, at: number, turnId?: string): Promise<number | undefined> {
  const session: string = await $.session.id()
  const project = await read($, here)
  const now = await $.clock.now()
  const t = await update($, requests, (x) => openRequest(x, { session, project, at, now, turnId }))
  // Une autre discussion (après `/clear`) : la vue suit tout de suite la nouvelle.
  if ((await read($, discussion)).id !== session) await quietly(() => readLive($))
  const key = logKey(t)
  if (!key || t.current === null) return undefined
  openings.set(`${key}#${t.current}`, openingOf(text))
  while (openings.size > OPENINGS_MAX) openings.delete(openings.keys().next().value!)
  return t.current
}

/**
 * Le début d'un tour du fil principal : celui d'un message de l'utilisateur ouvre sa requête. Sans
 * prompt noté (module rechargé entre les deux), une notification se reconnaît à son texte, et tout
 * autre texte non vide compte comme un message (commande qui passe au modèle).
 */
async function noteTurn($: any, text: string, turnId: string): Promise<void> {
  const print = printOf(text)
  const noted = submitted[submitted.findLastIndex((p) => p.print === print)] ?? null
  if (noted) submitted = submitted.filter((p) => p.print !== print)
  // Tapé pendant le tour d'avant, le message a déjà sa requête : ce tour travaille pour elle.
  if (noted?.request !== undefined) {
    const request = noted.request
    await update($, requests, (t) => startTurn(t, turnId, request))
    return
  }
  const kind = noted?.kind ?? notificationKind(text)
  const isUser = noted ? noted.isUser : text !== '' && kind === undefined
  if (isUser) {
    const request = await openFor($, text, noted?.at ?? (await $.clock.now()))
    if (request !== undefined) await update($, requests, (t) => startTurn(t, turnId, request))
    return
  }
  // Relancé sans message : la requête de la tâche notifiée, qui a fini, ou hors requête.
  const relaunch = relaunchOf(kind, text)
  await update($, requests, (t) => startTurn(finishTask(t, notifiedTask(relaunch)), turnId, relaunchOwner(t, relaunch)))
}

/** L'origine d'une notification reconnue à son seul texte (module rechargé, prompt non noté) ; undefined pour un autre texte. */
const notificationKind = (text: string): string | undefined =>
  text.startsWith('<task-notification>') ? 'task-notification' : text.startsWith('<agent-message from=') ? 'peer' : undefined

/**
 * Ce qui relance un tour sans message de l'utilisateur, d'après son origine et son texte : la
 * `task-notification` d'une tâche (`<task-id>`), le message de retour d'un agent
 * (`<agent-message from="…">`), une reprise (sans texte, `auto-continuation`), ou autre chose.
 */
function relaunchOf(kind: string | undefined, text: string): Relaunch {
  if (kind === 'task-notification') return { kind: 'task', id: /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1] ?? null }
  if (kind === 'peer') return { kind: 'peer', id: /^<agent-message from="([^"]+)"/.exec(text)?.[1] ?? null }
  if (kind === 'auto-continuation' || (kind === undefined && text === '')) return { kind: 'continue', id: null }
  return { kind: 'other', id: null }
}

/** La tâche qui a fini d'après une relance : celle d'une notification ; aucune pour le message d'un agent, qui peut encore tourner. */
const notifiedTask = (why: Relaunch): string | null => (why.kind === 'task' ? why.id : null)

/** Repli sans liste des tâches de fond : les agents encore actifs ; aucun si la liste des agents manque aussi. */
async function activeAgents($: any): Promise<string[]> {
  try {
    const agents: { id: string; status: string }[] = await $.agent.list()
    return agents.filter((a) => a.status === 'running' || a.status === 'pending' || a.status === 'waiting').map((a) => a.id)
  } catch {
    return []
  }
}

function scheduleWrite($: any) {
  // Une minuterie refusée par un hook n'appelle jamais sa fonction et ne rejette rien (`$.clock.after`
  // rend un `Timer`) : passé `WRITE_STALE_MS` sans écriture, une nouvelle est demandée.
  if (writeDueAt !== null && Date.now() - writeDueAt < WRITE_STALE_MS) return
  writeDueAt = Date.now()
  try {
    $.clock.after(WRITE_DELAY_MS, () => {
      writeDueAt = null
      writes = writes.then(() => quietly(() => writeLog($)))
    })
  } catch {
    // Une minuterie qui lève ne doit ni gêner le hook appelant ni bloquer les écritures suivantes.
    writeDueAt = null
  }
}

/**
 * Le relevé de la session, réécrit en entier dans son fichier : seule cette session l'écrit. Le
 * coût des modèles sans tarif y est estimé au prorata du coût du moteur (celui de la même session).
 */
async function writeLog($: any): Promise<void> {
  const t = await read($, requests)
  const dir = await claudeDir($)
  if (!t.log || !dir) return
  const isSame = (await $.session.id()) === t.log.session
  const usage = isSame ? await Promise.resolve($.session.usage()).catch(() => null) : null
  const cost = typeof usage?.cost?.usd === 'number' ? usage.cost.usd : null
  await $.fs.write(`${dir}/${REQUESTS_DIR}/${requestFile(t.log.session, t.log.openedAt)}`, JSON.stringify(costed(t.log, cost)))
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
