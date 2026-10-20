// flow-board : le tableau de bord du workflow mattpocock-skills.
//
// - Suit les skills du plugin dès qu'ils se chargent (commande slash, outil Skill) : le
//   skill de départ fixe la forme du parcours, les suivants le font avancer, les autres
//   s'y greffent en détours.
// - Claude complète par l'outil `flow` (étapes, éléments, tickets) : une courte note
//   ajoutée au texte de chaque skill lui donne les ids d'étapes à signaler.
// - Le reste est relevé seul : sous-agents, tests, commits, issues et PR, fichiers du
//   workflow (glossaire, ADR, specs, tickets locaux…), tâches Asana, questions du grilling.
// - Les parcours sont gardés par projet dans un fichier commun, `~/.claude/flow-board/parcours/`
//   (`$.store` en secours) : un workflow mattpocock s'étale sur plusieurs sessions (`/clear` entre
//   deux tickets), et le desktop comme le CLI doivent voir les mêmes.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Board, FlowPhase, Relay, Run, SyncState, Tab } from '../types'
import {
  CODE_SKILLS,
  GROUP_REVIEWER,
  NO_GIT_COPIES,
  NO_GIT_GROUP_FIXED_POINT,
  NO_GIT_TICKET_FIXED_POINT,
  PLUGIN,
  SECURITY_CRITERIA,
  SKILLS,
  TICKET_FIXED_POINT,
  commandLineOf,
  hintOf,
  skillIdOf,
  slashOf,
} from './catalog.ts'
import {
  activeDetour,
  activeRun,
  applyAgentEnd,
  applyAgentStart,
  applyAnswer,
  applyAsana,
  applyRelay,
  asanaChanges,
  applyCommand,
  applyCreatedTasks,
  markDecisionsSeen,
  reportFacts,
  validateReport,
  applyFileChange,
  applyReport,
  applySkill,
  applySubagentStop,
  applyAgentList,
  applyUserAnswer,
  backgroundLaunches,
  commandSignals,
  commandText,
  countTickets,
  currentPhase,
  isBugPass,
  archiveRun,
  cancelLinked,
  cancelLinkedGroup,
  clip,
  dropRun,
  linkGroupSession,
  linkSession,
  linkedSessionsOf,
  noteUnlaunched,
  retryLinked,
  startLinkedGroups,
  type GroupView,
  linkedInFlight,
  pickableItems,
  startLinkedItems,
  renameRun,
  unarchiveRun,
  EMPTY_SYNC,
  emptyBoard,
  finishActive,
  flowCallLabel,
  focusOf,
  clampFuture,
  groupPlan,
  hasSpecAndTickets,
  noActiveFrench,
  withoutPullRequest,
  isBoard,
  detachOnLoad,
  mergeBoards,
  nextCommandSkill,
  parkActive,
  resumeRun,
  setAsideActive,
  setQueue,
  togglePick,
  summaryOf,
  syncAdvice,
  type Effects,
  type Outcome,
  reportedChanges,
  reportedDecisions,
  type RelayEvent,
} from './model.ts'
import type { LiveAgent } from './model.ts'
import { drawBand, drawPane, drawWelcomeBand, kitOf, type Actions, type View } from './view.tsx'

const PANE = 'flow-board'
const PANE_TITLE = 'Parcours'
const TOOL = 'mcp__flow-board__flow'
/** Le plugin dont la suggestion `/project:push` s'écarte pendant un parcours (pas de push en cours de route). */
const GIT_BOARD = 'git-board'
/** Le second essai de la suggestion de fin de tour, si le premier tombe encore dans le tour. */
const SUGGEST_RETRY_MS = 300
/**
 * L'outil de l'app Desktop qui lance une session liée ; sa réponse donne l'id `local_…` de la
 * session. Le CLI ne l'a pas : il lance la session par `claude --bg` (voir `backgroundLaunches`).
 */
const START_SESSION = 'mcp__ccd_session__start_session'
/** La commande déclarée par `commands/flow.md`, préfixée du nom du plugin. */
const STATIC_FLOW = 'flow-board:flow'
/** Ce que la consigne de file dit de chaque ticket, selon son état. */
const QUEUE_STATE: Record<string, string> = {
  todo: '',
  doing: ' (in progress: partial work may already be uncommitted in the working tree)',
  done: ' (done and committed: skip it)',
  blocked: ' (blocked)',
}

/** Le texte d'un appel d'outil refusé ou interrompu par la personne. */
const CANCELLED = /doesn't want to proceed|tool use was rejected|interrupted by user/i

const BOARD_REF = { plugin: 'flow-board', key: 'board' } as const
const boardAtom = atom({ plugin: 'flow-board', key: 'board' } as const, null)
const liveAtom = atom({ plugin: 'flow-board', key: 'live' } as const, { mode: 'idle', since: 0, ask: null })
const uiAtom = atom({ plugin: 'flow-board', key: 'ui' } as const, {
  tab: 'flow',
  isBandHidden: false,
  isPaneDismissed: false,
  showAllTickets: false,
  showAllLog: false,
  showDecided: false,
  showFound: false,
  selection: [] as string[],
})
const commandsAtom = atom({ plugin: 'flow-board', key: 'commands' } as const, {})
const syncAtom = atom({ plugin: 'flow-board', key: 'sync' } as const, EMPTY_SYNC)
const relayAtom = atom({ plugin: 'flow-board', key: 'relay' } as const, null)

const TOOL_DESCRIPTION =
  'Live dashboard of the mattpocock-skills workflow (flow-board). When a mattpocock skill loads, its text ends ' +
  'with the step ids to report here. Silent bookkeeping: no need to mention it to the user; batch it with your ' +
  'other tool calls. Subagents, tests, commits, issues, PRs and workflow files are tracked automatically. ' +
  'Ticket status: a ticket that only waits for other tickets stays "todo" with "blockedBy" (shown as waiting); ' +
  '"blocked" is for a ticket that waits on something outside the lot (a decision or approval of the user, an access, ' +
  'someone else\'s work), with that reason in "why". Tasks you create in the tracker outside /to-tickets (review ' +
  'findings, anomalies, actions for the user) appear by themselves under "found on the way", outside the lot and its ' +
  'progress: send one in "tickets" (with its blockedBy) only when the lot depends on it. When the lot has groups and ' +
  'you add a ticket to it, send "groups" again with that ticket in the group of the work it belongs to. Each time you make a choice ' +
  'the user neither asked for nor approved (work on a ticket outside the queue, one approach among several, something ' +
  'skipped or deferred, a scope change, a fix beyond the ticket), report it at once in "decided": the user reviews ' +
  'these. Not for the routine steps a skill prescribes, nor for proposals you ask the user about. After each code review, ' +
  'report its findings in "review". The order and content of the reviews of a ticket and of a group are those of the steps the ' +
  'skill text lists (ticket: Standards and Spec axes, plus the bug pass /code-review in the same message for a sensitive area; group: ' +
  '/code-review high --fix, in a reviewer subagent that applies its fixes, then the security review). After the review of a finished group, judge whether a security review is worth it ' +
  'and send it in "security"; when it is, launch it yourself, in this discussion as in a linked session: a read-only reviewer subagent ' +
  'limited to the group\'s diff (never /security-review), then send its findings; the user decides on their fixes. ' +
  'A group the user delegated to a linked session from the dashboard stays in this workflow here: when that session ends, ' +
  'check its work, then send its tickets\' statuses in "set" together with {"returned": ["<group id>"]}. ' +
  'Only when the user asks for it (a new workflow for some tickets, even while another one is active here), or to repair your own mistake: ' +
  '"open" starts a new workflow in this discussion without any skill, and the rest of the same call (tickets, groups...) goes to it; ' +
  '"fix" corrects the active workflow (title, current phase, step). Never open a workflow on your own initiative: ' +
  'when nothing is active here, the answer names the workflows to resume, so ask the user. To take tickets out of the wrong ' +
  'workflow, send "remove" in a call before the "open" one.'

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: "What the work is about, 3 to 6 words, in the user's language; only the first one sent is kept (fix.title changes it)" },
    step: { type: 'string', description: 'Id of the step of the current skill that starts now' },
    items: {
      type: 'array',
      description: 'Full list of the items the current skill tracks (hypotheses, candidates, seams, decisions, variants)',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'doing', 'done', 'dropped'] },
        },
        required: ['id', 'label'],
      },
    },
    tickets: {
      type: 'array',
      description: 'Tickets to add or update (id = tracker id, name = short title); tickets not listed are kept. To take tickets off, use "remove"',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'] },
          blockedBy: { type: 'array', items: { type: 'string' }, description: 'Ids of the tickets that must be done before this one' },
          why: { type: 'string', description: "With status blocked: what it waits for outside the lot, short, in the user's language" },
          files: {
            type: 'array',
            items: { type: 'string' },
            description:
              "Repo paths the ticket touches, from its acceptance criteria (pages, tables, shared files such as a model or a measures file); they add to its group's files. Name files rather than a whole folder, unless the ticket creates files in it",
          },
        },
        required: ['id', 'name'],
      },
    },
    review: {
      type: 'object',
      description: 'After each code review (/mattpocock-skills:code-review or another): its real findings per axis, not the "nothing to report" lines, and how many you fixed',
      properties: {
        standards: { type: 'number' },
        spec: { type: 'number' },
        fixed: { type: 'number' },
      },
    },
    security: {
      type: 'object',
      description:
        'Security review of a finished group (or of the whole run when it has no groups). After its review: {"group", "advised", "why"}, your judgment. After the reviewer subagent you launched: {"group", "findings", "fixed"}',
      properties: {
        group: { type: 'string', description: 'Group id (A, B...); omitted = the last finished group, or the whole run when it has no groups' },
        advised: { type: 'boolean', description: 'true when the changes touch authentication, permissions or access rules, user input reaching a query, a path or HTML, secrets or tokens, network or file access, uploads or dependencies' },
        why: { type: 'string', description: "Why, short, in the user's language" },
        findings: { type: 'number', description: 'Real findings of the security review' },
        fixed: { type: 'number', description: 'How many of them were fixed' },
      },
    },
    decided: {
      type: 'array',
      description: 'Choices you made without the user asking for or approving them, to be reviewed; each sent once',
      items: {
        type: 'object',
        properties: {
          what: { type: 'string', description: "The choice, short, in the user's language" },
          why: { type: 'string', description: "Why, short, in the user's language" },
        },
        required: ['what'],
      },
    },
    remove: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ids of tickets to take off the dashboard (sent by mistake, out of scope); also dropped from groups, the queue and blockedBy',
    },
    set: {
      type: 'array',
      description: 'Status changes of tickets already listed (in the lot or found on the way)',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'] },
          why: { type: 'string', description: "With status blocked: what it waits for outside the lot, short, in the user's language" },
        },
        required: ['id', 'status'],
      },
    },
    externals: {
      type: 'array',
      description: 'Tasks outside the ticket lot that some tickets depend on (put their ids in those tickets\' blockedBy); added or updated, never removed',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Asana task GID' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['decision', 'task'], description: 'decision: a choice someone must make; task: work outside the lot' },
          status: { type: 'string', enum: ['todo', 'done'] },
        },
        required: ['id', 'name'],
      },
    },
    groups: {
      type: 'array',
      description:
        'Execution plan: the tickets grouped by shared context. Same group = tickets that touch the same files or modules, or chain through their dependencies: one discussion does them in a row with /implement and reuses the loaded context. Different context = another group, done later in a new discussion, or at the same time as other independent groups (one linked session per group, or /implement-spec in a git repository). A group of one ticket is fine when its context is its own. Full list: it replaces the previous one; every ticket in exactly one group',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short id: A, B, C…' },
          name: { type: 'string', description: "Short theme, in the user's language" },
          tickets: { type: 'array', items: { type: 'string' }, description: 'Ticket ids, in execution order' },
          why: { type: 'string', description: "The shared context, one short line in the user's language" },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Repo paths the group touches besides its tickets\' own files; groups that share one never run in parallel. A folder covers every file inside it: name files unless the group creates files there',
          },
          resources: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Things the group cannot share with another group working at the same time, same name in every group: an application driven on screen (e.g. "PowerBI Desktop"), a single database, device or account. Groups that share one never run in parallel',
          },
          continuesHere: { type: 'boolean', description: 'true on at most one group: the one that benefits from the context of this discussion' },
        },
        required: ['id', 'name', 'tickets'],
      },
    },
    reviewed: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Ids of finished groups whose /code-review ran somewhere the dashboard cannot see: a group\'s linked session, whether its final report says the review ran (send it with "returned") or it was asked for it after the group came back. Send it once the session reports the review done',
    },
    returned: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Ids of groups delegated to linked sessions that have ended: once you checked a session\'s work, send its tickets\' statuses in "set" in the same call. A group whose session stopped short goes back to the dashboard with its unfinished tickets',
    },
    delegate: {
      type: 'string',
      description:
        'Only when a linked session\'s brief gives it: id of the workflow this discussion works for, sent first, with "group" and "main".The workflow stays in the main discussion and nothing is recorded on it from here: your progress is relayed to its dashboard on its own (Asana ticket statuses, commits, tests). Afterwards, only "set" (a ticket status that changed without an Asana update), "decided" (sent at once, shown on the main dashboard for review) and "note" are accepted',
    },
    group: {
      type: 'string',
      description: 'With "delegate": the id of the group this linked session works on (A, B...), as the brief gives it',
    },
    main: {
      type: 'string',
      description: 'With "delegate": the main discussion as the brief names it, "<name> [ref]"; each answer then says how to reach it',
    },
    resume: {
      type: 'string',
      description:
        'Id of a workflow of this project to take over in this discussion before the rest of this report, as "↻ Reprendre ici" does. Only when a brief or the user asks for it: a linked session launched for a bug diagnosis sends it first; the main discussion sends it again once that session has finished',
    },
    open: {
      type: 'object',
      description:
        "Start a new workflow in this discussion, without a skill, even if another one is active here (that one is paused as it is). Only at the user's request. Everything else in this call goes to the new workflow",
      properties: {
        title: { type: 'string', description: "What the work is about, 3 to 6 words, in the user's language" },
        entry: { type: 'string', description: 'Starting skill that shapes its phases (implement, to-tickets, grill-with-docs, diagnosing-bugs...); default implement' },
      },
      required: ['title'],
    },
    fix: {
      type: 'object',
      description:
        "Correct the active workflow, at the user's request or after a mistake: a title already set, the current phase (going back resets the phases after it), the step (back too). Tickets and groups are corrected with \"tickets\", \"set\", \"remove\" and \"groups\"",
      properties: {
        title: { type: 'string', description: 'New title, replacing the current one' },
        phase: { type: 'string', description: 'Skill id of a phase of this workflow to make current (e.g. to-tickets, implement)' },
        step: { type: 'string', description: 'Id of a step of the current (or fixed) phase to make current; the steps after it become pending' },
      },
    },
    note: { type: 'string', description: 'One short line worth keeping in the activity log (a decision, a finding)' },
    complete: { type: 'boolean', description: 'true when the work of the current skill is finished' },
  },
}

// État du module, perdu au rechargement : de simples corrélations et minuteries.
/** Appels de l'outil Skill en cours : `skill.prompt` ne dit pas quel agent charge le skill. */
let pendingSkills: { skill: string; agentId?: string; args?: string }[] = []
/** Dernière commande slash d'un skill : `command.run` précède `skill.prompt` et porte les arguments. */
let lastCommand: { id: string; args: string; at: number } | null = null
let saveTimer: { cancel: () => void } | null = null
let ticks = 0

const normRoot = (root: string): string => root.replace(/\\/g, '/').replace(/\/+$/, '')
const storeKey = (root: string): string => `board:${normRoot(root).toLowerCase()}`
const projectName = (root: string): string => normRoot(root).split('/').pop() || root

// ─── Board : chargement, écriture, persistance ────────────────────────────

/** Racine lue il y a peu : chaque appel d'outil d'un parcours en a besoin, `/cd` la change rarement. */
let rootCache: { value: string; at: number } | null = null

/** La racine du projet de la session ; vide là où la session n'en dit rien (tests). */
const sessionRoot = async ($: any): Promise<string> => {
  const now = Date.now()
  if (rootCache !== null && now - rootCache.at < 5000) return rootCache.value
  let value = ''
  for (const ask of [() => $.session.root(), () => $.session.cwd()]) {
    try {
      const root = await ask()
      if (typeof root === 'string' && root !== '') {
        value = root
        break
      }
    } catch {
      // Essai suivant.
    }
  }
  rootCache = { value, at: now }
  return value
}

/** Id de cette discussion ; une valeur tirée au hasard là où le moteur n'en donne pas (tests). */
let sessionCache: string | null = null
/**
 * Dernier message de la personne (ms) : le tour qui le traite peut lancer une session liée demandée
 * avant lui. Les tours d'une notification ou d'une autre session ne comptent pas : ils n'ont pas vu la demande.
 */
let submitAt: number | null = null
const sessionId = async ($: any): Promise<string> => {
  if (sessionCache !== null) return sessionCache
  try {
    const id = await $.session.id()
    sessionCache = typeof id === 'string' && id !== '' ? id : null
  } catch {
    sessionCache = null
  }
  sessionCache ??= `local-${Math.random().toString(36).slice(2)}`
  return sessionCache
}

// ─── Fichier commun des parcours ──────────────────────────────────────────
//
// `$.store` range ses données selon la façon dont le mod est chargé : `inline` dans le desktop
// (plugins passés par l'application), `mods-locaux` dans le CLI (plugin installé). Les deux ne se
// voyaient pas. Les parcours vivent donc dans un fichier à nous, au même endroit pour tous.

/** Le dossier de configuration de Claude Code, tiré de l'emplacement du mod, qui est toujours dessous. */
const claudeHome = ($: any): string | null => {
  try {
    const root = String($.plugin.root ?? '').replace(/\\/g, '/')
    const at = root.toLowerCase().indexOf('/.claude/')
    return at >= 0 ? root.slice(0, at + '/.claude'.length) : null
  } catch {
    return null
  }
}

/** Un fichier par projet, nommé d'après sa racine. */
const sharedPath = ($: any, root: string): string | null => {
  const home = claudeHome($)
  if (!home) return null
  const slug = normRoot(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sans-projet'
  return `${home}/flow-board/parcours/${slug}.json`
}

/** `ok` faux : le fichier commun est hors d'atteinte (pas de chemin, lecture refusée), on se rabat sur `$.store`. */
const readShared = async ($: any, root: string): Promise<{ ok: boolean; value: unknown }> => {
  const path = sharedPath($, root)
  if (!path) return { ok: false, value: undefined }
  try {
    if (!(await $.fs.exists(path))) return { ok: true, value: undefined }
    return { ok: true, value: JSON.parse(String(await $.fs.read(path))) }
  } catch {
    return { ok: false, value: undefined }
  }
}

const writeShared = async ($: any, root: string, board: Board): Promise<boolean> => {
  const path = sharedPath($, root)
  if (!path) return false
  try {
    await $.fs.write(path, JSON.stringify(board))
    return true
  } catch {
    return false
  }
}

const legacyGet = async ($: any, root: string): Promise<unknown> => {
  try {
    return await $.store.get(storeKey(root))
  } catch {
    return undefined
  }
}

/** Projets dont l'ancien stockage de ce mode de chargement est déjà versé dans le fichier commun. */
const migrated = new Set<string>()
const migrationKey = (root: string): string => `migrated:${storeKey(root)}`

/**
 * Le board enregistré du projet : le fichier commun, sinon `$.store`. Une seule fois par mode de
 * chargement, l'ancien `$.store` est fusionné dans le fichier commun : le desktop y apporte son
 * historique, le CLI le sien.
 */
const loadStored = async ($: any, root: string): Promise<unknown> => {
  const shared = await readShared($, root)
  if (!shared.ok) return legacyGet($, root)
  const key = storeKey(root)
  if (migrated.has(key)) return shared.value
  let isDone = false
  try {
    isDone = (await $.store.get(migrationKey(root))) === true
  } catch {
    isDone = false
  }
  if (isDone) {
    migrated.add(key)
    return shared.value
  }
  const legacy = await legacyGet($, root)
  if (!isBoard(legacy) || normRoot(legacy.root) !== normRoot(root)) {
    migrated.add(key)
    return shared.value
  }
  const value = isBoard(shared.value) ? mergeBoards(shared.value, legacy) : legacy
  if (await writeShared($, root, value)) {
    migrated.add(key)
    try {
      await $.store.set(migrationKey(root), true)
    } catch {
      // Le versement sera refait au prochain chargement ; la fusion le rend sans effet.
    }
  }
  return value
}

/**
 * Le titre d'un parcours absent du board d'ici, lu dans celui du dépôt principal : une session
 * lancée dans un worktree a sa propre racine, donc son propre fichier. Lecture seule (pas de
 * versement de l'ancien stockage) ; rien quand la session n'est pas dans un worktree.
 */
const mainRepoTitle = async ($: any, runId: string): Promise<string | undefined> => {
  if (runId === '') return undefined
  const board = await read($, boardAtom)
  if (!board || board.runs.some(r => r.id === runId)) return undefined
  let root = ''
  await quietly(async () => {
    root = String((await $.session.repo())?.root ?? '')
  })
  if (root === '' || normRoot(root).toLowerCase() === normRoot(board.root).toLowerCase()) return undefined
  const shared = await readShared($, root)
  const stored = shared.ok ? shared.value : await legacyGet($, root)
  return isBoard(stored) ? stored.runs.find(r => r.id === runId)?.title : undefined
}

/** Écrit dans le fichier commun, sinon dans `$.store`. */
const saveStored = async ($: any, root: string, board: Board) => {
  if (await writeShared($, root, board)) return
  try {
    await $.store.set(storeKey(root), board)
  } catch {
    // Stockage indisponible (test, quota) : l'état de la session reste juste.
  }
}

// ─── Relais des sessions liées ────────────────────────────────────────────
//
// Un fichier par parcours, à côté des parcours : chaque session liée y tient son entrée, la
// discussion principale le lit. Il ne dépend pas de la racine : une session dans un worktree
// (autre racine, autre fichier de parcours) écrit au même endroit que si elle était dans le dossier.

const relayPath = ($: any, runId: string): string | null => {
  const home = claudeHome($)
  const slug = runId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return home && slug ? `${home}/flow-board/relais/${slug}.json` : null
}

const relayKey = (runId: string): string => `relay:${runId}`

const readRelay = async ($: any, runId: string): Promise<unknown> => {
  const path = relayPath($, runId)
  if (path) {
    try {
      return (await $.fs.exists(path)) ? JSON.parse(String(await $.fs.read(path))) : undefined
    } catch {
      // Fichier hors d'atteinte : l'ancien stockage prend le relais.
    }
  }
  try {
    return await $.store.get(relayKey(runId))
  } catch {
    return undefined
  }
}

const writeRelay = async ($: any, relay: Relay) => {
  const path = relayPath($, relay.run)
  if (path) {
    try {
      await $.fs.write(path, JSON.stringify(relay))
      return
    } catch {
      // Repli sur `$.store`.
    }
  }
  try {
    await $.store.set(relayKey(relay.run), relay)
  } catch {
    // Rien à relayer cette fois : le signal suivant réécrit toute l'entrée.
  }
}

/** Dans une session liée : un signal (ticket, commit, tests, fin) part au relais du parcours qu'elle sert. */
const relaySignal = async ($: any, event: RelayEvent) => {
  const board: Board | null = await read($, boardAtom)
  const runId = board?.delegate?.run
  if (!runId) return
  const now = await $.clock.now()
  const next = applyRelay(await readRelay($, runId), runId, await sessionId($), event, now)
  if (next) await writeRelay($, next)
}

/**
 * Dans une session liée, rien ne s'écrit sur le parcours : ses mises à jour Asana (tickets), ses
 * commits et ses tests partent au relais, que la discussion principale affiche.
 */
const relayTool = async ($: any, e: any, next: (e: any) => Promise<any>) => {
  const ran = await next(e)
  if (ran.deny !== undefined) return ran
  try {
    const isOk = ran.isError !== true
    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const record = ran.result as { stdout?: unknown; backgroundTaskId?: unknown } | undefined
      if (typeof record?.backgroundTaskId !== 'string') {
        const out = typeof record?.stdout === 'string' ? record.stdout : typeof ran.text === 'string' ? ran.text : ''
        const signals = commandSignals(String(e.command ?? ''), isOk, out)
        // Ni commit ni tests : pas de lecture du relais pour rien.
        if (signals.commit !== undefined || signals.test !== undefined) await relaySignal($, { kind: 'command', ...signals })
      }
    } else if (String(e.tool).endsWith('__update_tasks') && isOk) {
      await relaySignal($, { kind: 'tickets', changes: asanaChanges(e.tasks) })
    }
  } catch {
    // Un signal mal lu ne doit jamais gêner l'outil.
  }
  return ran
}

/** Dans la discussion principale : relit le relais du parcours actif quand un groupe est confié. */
const pullRelay = async ($: any, board: Board) => {
  const run = activeRun(board)
  const isWatching = run?.groups?.some(g => g.linked !== undefined) ?? false
  const before: Relay | null = await read($, relayAtom)
  const stored = run && isWatching ? await readRelay($, run.id) : undefined
  const next = stored !== null && typeof stored === 'object' && (stored as Relay).run === run?.id ? (stored as Relay) : null
  if (JSON.stringify(next) === JSON.stringify(before)) return
  await update($, relayAtom, () => next)
  $.ui.invalidate('ui.render')
}

/** Le board du projet de la session : celui de l'état, sinon celui du stockage, sinon un neuf. */
const ensureBoard = async ($: any): Promise<Board | null> => {
  const current = await read($, boardAtom)
  const root = await sessionRoot($)
  if (current && (root === '' || normRoot(current.root) === normRoot(root))) return current
  const stored = await loadStored($, root)
  const session = await sessionId($)
  const board =
    isBoard(stored) && normRoot(stored.root) === normRoot(root)
      ? detachOnLoad(stored, await $.clock.now(), session)
      : { ...emptyBoard(root, root ? projectName(root) : 'projet'), session, deleted: [] }
  await update($, boardAtom, () => board)
  return board
}

const readStored = async ($: any, root: string): Promise<Board | null> => {
  const stored = await loadStored($, root)
  return isBoard(stored) && normRoot(stored.root) === normRoot(root) ? clampFuture(stored, await $.clock.now()) : null
}

/**
 * Le stockage est partagé par toutes les discussions du projet : on y fusionne sa copie au lieu
 * de l'écraser, et la discussion récupère au passage les parcours des autres.
 */
const saveNow = async ($: any) => {
  saveTimer = null
  const { value, version } = await $.state.get(BOARD_REF)
  if (!value) return
  const stored = await readStored($, value.root)
  const merged = stored ? mergeBoards(value, stored) : value
  await saveStored($, value.root, merged)
  // Si l'état a bougé entre-temps, la prochaine sauvegarde refusionnera.
  if (merged !== value) await $.state.set(BOARD_REF, merged, { ifVersion: version })
}

/** Lit ce que les autres discussions ont enregistré, sans rien écrire dans le stockage. */
const pull = async ($: any) => {
  const { value, version } = await $.state.get(BOARD_REF)
  if (!value) return
  const stored = await readStored($, value.root)
  if (!stored) return
  const merged = mergeBoards(value, stored)
  if (JSON.stringify(merged) !== JSON.stringify(value)) await $.state.set(BOARD_REF, merged, { ifVersion: version })
}

const scheduleSave = ($: any) => {
  saveTimer?.cancel()
  saveTimer = $.clock.after(600, () => void saveNow($))
}

/** Applique une transition pure au board, avec une écriture conditionnelle (rejouée si l'état a bougé). */
const commit = async ($: any, change: (board: Board) => Outcome): Promise<Effects | null> => {
  if (!(await ensureBoard($))) return null
  for (let attempt = 0; attempt < 5; attempt++) {
    const { value, version } = await $.state.get(BOARD_REF)
    if (!value) return null
    const out = change(value)
    if (!out) return null
    const written = await $.state.set(BOARD_REF, out.board, { ifVersion: version })
    if (written.isSet) {
      await afterChange($, out.fx, out.board)
      return out.fx
    }
  }
  return null
}

/** Les appels Agent pas encore rendus (clé : tool_use_id) : leur id de sous-agent n'est pas connu. */
const agentCalls = new Set<string>()

/** Confronte les sous-agents « en cours » à ceux de la session ; une liste indisponible ne change rien. */
const reconcileAgents = async ($: any) => {
  try {
    const live = (await $.agent.list()) as LiveAgent[]
    const now = await $.clock.now()
    await commit($, board => applyAgentList(board, live, agentCalls, now))
  } catch {
    // Pas de liste (version de Claude Code sans `agent.list`) : on garde les lignes telles quelles.
  }
}

/** Un effet d'interface raté (pas d'écran, surface sans panneau) ne doit jamais gêner le suivi. */
const quietly = async (effect: () => unknown) => {
  try {
    await effect()
  } catch {
    // Rien à afficher ici : l'état, lui, est déjà écrit.
  }
}

const afterChange = async ($: any, fx: Effects, board: Board) => {
  scheduleSave($)
  for (const text of fx.toasts.slice(0, 2)) await quietly(() => $.ui.toast(text))
  if (fx.openPane) await quietly(() => openUnasked($))
  await quietly(() => syncStatus($, board))
}

/** Ouvre le panneau de lui-même, sauf si la personne l'a fermé pendant la session. */
const openUnasked = async ($: any) => {
  const ui = await read($, uiAtom)
  if (ui.isPaneDismissed) return
  const panes = await $.ui.panes()
  if (panes.some((p: { id: string }) => p.id === PANE)) return
  await $.ui.open({ id: PANE, title: PANE_TITLE })
}

/** La ligne d'état sous le prompt ne sert que quand le bandeau est masqué. */
const syncStatus = async ($: any, board: Board | null) => {
  const ui = await read($, uiAtom)
  const run = activeRun(board)
  if (!run || !ui.isBandHidden) {
    await quietly(() => $.ui.status(undefined))
    return
  }
  const { skill } = focusOf(run)
  const t = countTickets(run.tickets)
  await quietly(() => $.ui.status(`${skill.glyph} ${skill.label}${t.total > 0 ? ` ${t.done}/${t.total}` : ''} · ${run.title}`))
}

const setLive = async ($: any, mode: 'idle' | 'working' | 'waiting' | 'agents', ask?: string | null) => {
  const now = await $.clock.now()
  await update($, liveAtom, live => ({
    mode,
    since: live.mode === mode && live.since > 0 ? live.since : now,
    ask: ask === undefined ? (mode === 'waiting' ? live.ask : null) : ask,
  }))
}

/** Le projet est un dépôt git (mesuré à l'appel) ; faux quand la mesure échoue. */
const measureRepo = async ($: any): Promise<boolean> => {
  let isRepo = false
  await quietly(async () => {
    isRepo = (await $.session.repo()) !== null
  })
  return isRepo
}

// ─── Note ajoutée au texte des skills ─────────────────────────────────────

/**
 * La revue de sécurité d'un groupe dans sa session liée : un sous-agent relecteur au périmètre
 * explicite, pas `/security-review`, qui calcule son diff contre la branche par défaut et relit
 * aussi les autres groupes (il ignore la base qu'on lui donne). Les failles vont au compte rendu.
 */
const linkedSecurityReview = (scope: string): string =>
  `la confier à un sous-agent relecteur (outil Agent, type general-purpose, modèle opus, effort xhigh), en lecture seule, avec pour seul périmètre ${scope} et pour critères ceux de /security-review (${SECURITY_CRITERIA}) ; ne pas lancer /security-review, qui relit la branche face à la branche par défaut, donc aussi les autres groupes ; ne pas corriger ce qu'il trouve : les failles vont dans le compte rendu`

/** Les choix déjà déclarés par la session, à donner à une revue pour qu'elle ne les resignale pas. */
const DECIDED_LIST = 'la liste des choix déjà déclarés dans {"decided": …} de l\'outil flow, à ne pas resignaler'

/** Ce qu'une passe `/code-review --fix` fait d'un conflit entre la spec et une consigne. */
const NO_ARBITRATION = "elle ne tranche pas un conflit entre la spec et une consigne (CLAUDE.md, une demande de ma part) : elle ne corrige pas ce point et me le remonte"

/**
 * Le relecteur de la revue d'un groupe (`/code-review high --fix`) dans une session liée : un
 * sous-agent Opus en effort high, et c'est lui qui écrit les correctifs de `--fix`, pour
 * qu'ils aient son modèle et son effort. Seule exception à « sans sous-agents qui écrivent » : il
 * tourne seul, une fois les tickets commités, et la session relit ses correctifs avant de les commiter.
 */
const LINKED_GROUP_REVIEWER =
  "un sous-agent relecteur (outil Agent, type general-purpose, modèle opus, effort high), le seul sous-agent qui écrit : il lance lui-même la revue et applique lui-même ses correctifs"

/** Le même sous-agent relecteur, dit à Claude dans la discussion principale. */
const securityReviewer = (scope: string): string =>
  `launch it yourself: a reviewer subagent (Agent tool, general-purpose, model opus, effort xhigh), read-only, limited to ${scope}, with these criteria; never /security-review, which diffs against the default branch and rereads the other groups too. The subagent fixes nothing: tell the user its findings plainly, they decide on their fixes (fix one only once they agree; create a tracker task for each real finding left unfixed)`

/** La revue de sécurité après la revue d'un groupe : Claude juge, puis la lance lui-même. */
const securityAdvice = (isRepo: boolean): string =>
  `- Security review: once the review of a finished group (/code-review high --fix) is done and its fixes are in, judge whether a security review is worth it (its changes touch ${SECURITY_CRITERIA}). Tell the user in one line, with the reason, and send {"security": {"group": "<id>", "advised": true|false, "why": "<short reason, in the user's language>"}}. If it is worth it, ${securityReviewer(isRepo ? "git diff <group base>..HEAD (<group base>: the commit before the group's first ticket)" : `the group's diff (${NO_GIT_GROUP_FIXED_POINT}; new files read whole)`)}. Then send {"security": {"group": "<id>", "findings": <real findings>, "fixed": <fixed>}}.`

/** Le même avis pour un parcours sans groupes (relecture de branche, chasse au bug, TDD) : il porte sur tout le lot. */
const LOT_SECURITY_ADVICE = `- Security review: once this review is done and its fixes are in, judge whether a security review is worth it on these changes (they touch ${SECURITY_CRITERIA}). Tell the user in one line, with the reason, and send {"security": {"advised": true|false, "why": "<short reason, in the user's language>"}}, without "group": it covers the whole run. If it is worth it, ${securityReviewer('the changes this review covered')}. Then send {"security": {"findings": <real findings>, "fixed": <fixed>}}.`

/** La revue d'un groupe, lancée par la personne depuis la ligne du groupe : ce qu'elle doit savoir. */
const groupReviewNote = (isRepo: boolean): string =>
  `- This is the review of a finished group${isRepo ? '' : ` (${NO_GIT_GROUP_FIXED_POINT}: give it these copies and files)`}: run it in ${GROUP_REVIEWER}, not in this discussion, and give that subagent these instructions (it does not receive them). Focus it on the interactions between the group's tickets (each one had its own review), and leave out the choices already declared in "decided" of the flow tool (do not report them again). It does not settle a conflict between the spec and an instruction (CLAUDE.md, a request of the user): leave that point unfixed and raise it to the user. Then read the diff of its fixes, rerun the checks and commit them.`

/** La passe « bogues » d'un ticket en cours (zone sensible) : pas la revue du groupe. */
const bugPassNote = (isRepo: boolean): string =>
  `- This is the bug pass of the ticket in progress (sensitive area), not the review of a group: same scope as its /mattpocock-skills:code-review (${isRepo ? TICKET_FIXED_POINT : NO_GIT_TICKET_FIXED_POINT}); leave out the choices already declared in "decided" of the flow tool. Report its findings with the ticket's review ("review"), then commit the ticket.`

const coachingNote = (id: string, run: Run, sync: SyncState, isRepo: boolean, session?: string): string => {
  const def = SKILLS[id]!
  const lines = [
    '',
    '',
    '---',
    `Dashboard (flow-board): report progress with the \`${TOOL}\` tool. It is silent bookkeeping: no need to mention it to the user; batch it with your other tool calls when you can.`,
  ]
  if (!run.isTitled) lines.push(`- First call: {"title": "<what this work is about, 3 to 6 words, in the user's language>"}.`)
  if (def.steps.length > 0) {
    lines.push(`- Steps of ${id}, in order; send {"step": "<id>"} as each one starts: ${def.steps.map(s => `${s.id} (${hintOf(s, isRepo)})`).join('; ')}.`)
  }
  if (def.items) {
    lines.push(`- Items: ${def.items.hint}. Send the full list {"items": [{"id": "...", "label": "...", "status": "todo|doing|done|dropped"}]} whenever it changes.`)
    if (def.items.linkedStep) {
      lines.push(
        `- Once the items are presented, the user picks the ones to apply in the dashboard and may send them to a linked session: the request lands in the prompt and you launch the session; the items go "doing" and the "${def.steps.find(s => s.id === def.items!.linkedStep)?.label ?? def.items.linkedStep}" step opens only once the session is launched. Do not send {"complete": true} before the user has decided; while items are with the linked session, launched or not, the dashboard refuses it.`,
      )
    }
  }
  if (def.hasTickets) {
    lines.push('- Tickets: send the ones you know, {"tickets": [{"id": "<tracker id: the Asana task GID when the tracker is Asana>", "name": "<short title>", "blockedBy": ["<ids of the tickets that must be done first>"]}]}: they are added or updated, the others stay on the dashboard, so send only the tickets you work on. Then {"set": [{"id": "...", "status": "doing|done|blocked"}]} for changes the tracker tools do not show. A ticket sent by mistake: {"remove": ["<id>"]}.')
  }
  if (id === 'to-tickets') {
    lines.push('- When the tickets are published, send them all with their blocking edges in "blockedBy" (an empty list for a ticket nothing blocks).')
    lines.push('- Also check in the tracker whether a ticket depends on tasks outside this lot. Add the code tickets among them to the lot; send the others (decisions to make, work of someone else) as {"externals": [{"id": "<GID>", "name": "...", "kind": "decision|task", "status": "todo|done"}]} and keep their ids in the blocked tickets\' blockedBy. When one is done or decided, send it again with "status": "done".')
    lines.push('- Give each ticket the repo paths it touches, read from its acceptance criteria: {"tickets": [{"id": "...", "files": ["<pages, tables, shared files such as a model or a measures file>"]}]}. Name files, not a whole folder, unless the ticket creates files in it: a folder blocks every group that names a file inside it.')
    lines.push('- Last, group the tickets for execution: {"groups": [{"id": "A", "name": "<short theme>", "tickets": ["<ids in execution order>"], "why": "<the shared context>", "files": ["<other repo paths it touches>"], "resources": ["<what it cannot share>"], "continuesHere": true}]}. Same group = same files or modules, or a chain of dependencies: one discussion does them in a row with /implement. A different context = another group; a group of one ticket is fine when its context is its own, and a ticket that blocks nothing in its theme but could start now (an export, a query, a data check) is often better in a group of its own or with other data work. Groups that share no file, no resource and do not depend on each other can later run at the same time, one linked session per group (or /implement-spec, one subagent per group, in a git repository only). "resources": what a group cannot share with another group working at the same time, with the same name in every group: an application driven on screen and checked by screenshots (e.g. "PowerBI Desktop"), a single database, device or account; check the project\'s CLAUDE.md for such constraints. Set "continuesHere" on at most one group, the one that benefits from the context of this discussion. Every ticket in exactly one group.')
  }
  if (id === 'implement') {
    lines.push('- For each ticket, the steps above restart from "read". With "review", send the findings of the two axes: {"step": "review", "review": {"standards": <findings>, "spec": <findings>, "fixed": <fixed>}}.')
    lines.push('- In this discussion, /code-review (Claude Code) runs only as the bug pass of a ticket that touches a sensitive area. The review of a group, /code-review high --fix, is launched by the user from the dashboard once the group\'s tickets are committed: do not launch it yourself.')
  }
  if (def.groupSteps) {
    lines.push(`- Then, for each group once all its tickets are committed, in this order: ${def.groupSteps.map(s => `${s.label} (${hintOf(s, isRepo)})`).join('; ')}.`)
  }
  if (id === 'implement') lines.push(securityAdvice(isRepo))
  // Sans git, la méthode des copies : le point fixe de chaque revue.
  if (!isRepo && (id === 'implement' || id === 'final-review')) lines.push(`- ${NO_GIT_COPIES}.`)
  if (run.queue && run.queue.length > 0 && (id === 'implement' || id === 'implement-spec')) {
    // L'état de chaque ticket : après une discussion interrompue, Claude ne refait pas ce qui est
    // commité et retrouve le travail commencé.
    const names = run.queue
      .map((q, i) => {
        const t = run.tickets.find(x => x.id === q)
        return `${i + 1}) ${t?.name ?? q} [${q}]${t ? QUEUE_STATE[t.status] : ''}`
      })
      .join('; ')
    lines.push(`- Ticket queue chosen by the user, in order: ${names}. Set each one to doing when you start it and to done when it is finished.`)
  }
  if (id === 'implement' || id === 'implement-spec') {
    const started = run.tickets.filter(t => t.status === 'doing')
    if (started.length > 0) {
      lines.push(
        `- Already in progress when this skill loaded: ${started.map(t => `${t.name} [${t.id}]`).join('; ')}. A previous discussion may have stopped in the middle: ${isRepo ? 'check git status and git diff' : 'compare its copies with the current files ("Without git")'} before writing anything, and continue its uncommitted work instead of starting over. Tickets marked done are committed: do not redo them.`,
      )
    }
  }
  if (id === 'implement-spec') lines.push(securityAdvice(isRepo))
  const hasGroups = (run.groups ?? []).length > 0
  if (id === 'final-review') {
    if (isBugPass(run, session)) lines.push(bugPassNote(isRepo))
    else {
      if (hasGroups) lines.push(groupReviewNote(isRepo))
      lines.push(hasGroups ? securityAdvice(isRepo) : LOT_SECURITY_ADVICE)
    }
  }
  if (id === 'branch-review') {
    lines.push('- The review target and options (a PR number, a branch, --fix, --comment) are in the command arguments; if none is given, review the current branch against its base.')
    lines.push(LOT_SECURITY_ADVICE)
  }
  // La phase « Revue » de Chasse au bug, TDD ou Revue de code (le /code-review de Matt), sans groupes.
  if (id === 'code-review' && currentPhase(run).skill === 'code-review' && !hasGroups) lines.push(LOT_SECURITY_ADVICE)
  // Un /security-review tapé à la main : il relit toute la branche ; son résultat se rend pareil.
  if (id === 'security-review') {
    lines.push('- When the security review is done, tell the user plainly what it found. Fix a finding only once the user agrees; create a tracker task for each real finding left unfixed. Then send {"security": {"group": "<id>", "findings": <real findings>, "fixed": <fixed>}}.')
  }
  if (id === 'compte-rendu') {
    lines.push('- What the dashboard knows about this run (start from it, then check and complete it with git and the tracker):')
    lines.push(...reportFacts(run).map(l => `  ${l}`))
    lines.push('- When the report is written: {"step": "validate"}. Never send {"complete": true}: the user validates the report from the dashboard (✓ Valider le rapport). If the user asks for changes, rewrite the report and send {"step": "validate"} again.')
  }
  const advice = CODE_SKILLS.has(id) ? syncAdvice(sync) : null
  if (advice) {
    lines.push(`- The remote moved (${advice.reason}). Before your first code change, ask the user to run ${advice.commands.map(commandText).join(' then ')} (user-only commands) and wait until it is done.`)
  }
  if (id === 'implement' || id === 'implement-spec') {
    lines.push('- When every ticket of the lot is done: {"complete": true}. A finished group is not the end: while tickets of the lot remain open, the next step is the next group, which the user launches from the dashboard (▶ Lancer). Do not suggest /flow-board:compte-rendu or the delivery before every ticket is done. Add {"note": "<one short line>"} for a decision worth keeping.')
  } else if (id !== 'compte-rendu' && def.role !== 'event') {
    lines.push(`- When the work of ${id} is finished: {"complete": true}. Add {"note": "<one short line>"} for a decision worth keeping.`)
  }
  return lines.join('\n')
}

// ─── Gestes de l'interface ────────────────────────────────────────────────

const commandFor = async ($: any, skill: string): Promise<string> => {
  if (skill.includes(':')) return skill
  const own = SKILLS[skill]?.command
  if (own) return own
  const commands = await read($, commandsAtom)
  return commands[skill] ?? `${PLUGIN}:${skill}`
}

/** Met la commande du skill dans le prompt : la personne ajoute le sujet et valide. */
const prepare = async ($: any, skill: string, given = '') => {
  if (skill === 'retro' && given === '' && (await launchRetro($))) return
  const command = await commandFor($, skill)
  // Les arguments propres au skill (`--auto` pour /project:pr) passent avant ceux du bouton.
  const args = [SKILLS[skill]?.args ?? '', given].filter(Boolean).join(' ')
  const text = args ? `/${command} ${args}` : `/${command} `
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  const hint = args ? 'Entrée pour lancer' : 'ajoute le sujet, puis Entrée'
  await quietly(() => $.ui.toast(isFilled ? `${text.trim()} est dans le prompt : ${hint}` : `Tape ${text.trim()} dans le prompt`))
}

/** Une commande de Claude Code (`/compact`) dans le prompt : la personne ajoute ses consignes si elle veut, puis Entrée. */
const fillCommand = async ($: any, command: string) => {
  const text = `/${command} `
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? `${text.trim()} est dans le prompt : ajoute des consignes si tu veux, puis Entrée` : `Tape ${text.trim()} dans le prompt`))
}

/** La suite du parcours : la commande va dans le prompt, Entrée la lance (rien ne part sans toi). */
const launch = async ($: any, skill: string) => {
  if (skill === 'retro' && (await launchRetro($))) return
  const args = SKILLS[skill]?.args
  const command = `${await commandFor($, skill)}${args ? ` ${args}` : ''}`
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text: `/${command}`, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? `/${command} est dans le prompt : Entrée pour lancer` : `Tape /${command} dans le prompt`))
}

/** La réponse finit sur une question : la personne a à répondre, pas à lancer la suite. */
const endsWithQuestion = (answer: unknown): boolean => typeof answer === 'string' && /\?[\s*_)"»]*$/.test(answer.trim())

/**
 * Fin d'un tour principal : la commande de la suite (celle de la carte « Ensuite ») se propose,
 * grisée, dans le prompt vide ; Tab la prend, rien ne part sans la personne. Rien quand une
 * question attend la personne, dans une session liée, ou quand la suite n'est pas une commande.
 */
const suggestNext = async ($: any, answer: unknown, ask: string | null) => {
  if (ask !== null || endsWithQuestion(answer)) return
  const board: Board | null = await read($, boardAtom)
  const run = activeRun(board)
  if (!run || board?.delegate) return
  const skill = nextCommandSkill(run, { hasPullRequests: (await read($, syncAtom)).isGitHub !== false })
  // La rétro d'un parcours à sessions liées part avec sa consigne (bouton), pas en commande seule.
  if (skill === null || (skill === 'retro' && linkedSessionsOf(run).count > 0)) return
  const args = SKILLS[skill]?.args
  const text = `/${await commandFor($, skill)}${args ? ` ${args}` : ''}`
  let isShown = false
  await quietly(async () => {
    isShown = (await $.prompt.suggest({ text })).isShown === true
  })
  // Le tour n'est peut-être pas encore tout à fait fini : un second essai, juste après.
  if (!isShown) $.clock.after(SUGGEST_RETRY_MS, () => void quietly(() => $.prompt.suggest({ text })))
}

/**
 * La rétro d'un parcours qui a eu des sessions liées : la discussion principale (la session mère)
 * fait la sienne, et un sous-agent par session fille fait celle de sa session sur son transcript,
 * qui ne dépend pas de la session encore ouverte ; elle en tire un compte rendu global. Rend faux
 * sans session fille : /retro seul suffit.
 */
const launchRetro = async ($: any): Promise<boolean> => {
  const run = activeRun(await read($, boardAtom))
  const daughters = run ? linkedSessionsOf(run) : null
  if (!run || !daughters || daughters.count === 0) return false
  const prefix = linkedPrefix(run).trim()
  const known = daughters.ids.length > 0 ? ` (ids relevés : ${daughters.ids.join(', ')})` : ''
  const who = prefix ? `les sessions dont le titre commence par « ${prefix} »${known}` : `les sessions lancées pour ses groupes ou ses pistes${known}`
  const text =
    `/${await commandFor($, 'retro')} Rétro globale du parcours « ${run.title} » : cette discussion (la session mère) et ses sessions filles, ${who}, à retrouver par ListAgents. ` +
    `1) D'abord, lance un sous-agent par session fille, tous en parallèle et en lecture seule (general-purpose, pas Haiku) : chacun lit le transcript de sa session (dans le CLI : claude logs <id>, ou son fichier .jsonl sous ~/.claude/projects/) et en fait la rétro selon les étapes et les sept axes de ce skill, que tu lui transmets tels que tu les lis ici ; il ne modifie rien et rend ses pistes par sévérité, une par ligne « axe : correction », chacune avec ce qui l'a révélée dans la session. ` +
    `2) Pendant ce temps, fais la rétro de cette discussion. ` +
    `3) Une fois tous les sous-agents revenus, fais le compte rendu global : les pistes de toutes les sessions, fusionnées et sans doublon, par sévérité, chacune avec la ou les sessions où elle est apparue ; c'est cette liste qui va dans les items de l'outil flow.`
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  const n = daughters.count
  await quietly(() =>
    $.ui.toast(
      isFilled
        ? `Rétro de cette discussion et de ${n > 1 ? `ses ${n} sessions filles` : 'sa session fille'} : la demande est dans le prompt, Entrée pour la lancer`
        : 'Demande à taper : rétro de cette discussion et de ses sessions filles',
    ),
  )
  return true
}

/**
 * Lance la sélection : la file est enregistrée dans le parcours (visible des autres discussions),
 * et la commande va dans le prompt avec les tickets dans l'ordre choisi ; Entrée la lance.
 */
const launchPicks = async ($: any, isParallel: boolean) => {
  const run = activeRun(await read($, boardAtom))
  const selection = (await read($, uiAtom)).selection ?? []
  if (!run || selection.length === 0) return
  if (isParallel) {
    let isRepo = false
    await quietly(async () => {
      isRepo = (await $.session.repo()) !== null
    })
    if (!isRepo) {
      await quietly(() => $.ui.toast('Pas de dépôt git ici : /implement-spec a besoin de worktrees.'))
      return
    }
  }
  const now = await $.clock.now()
  await commit($, b => setQueue(b, selection, now))
  const list = ticketList(run, selection)
  const args = isParallel ? `Tickets à traiter : ${list}${noSpecClause(run)}` : `Tickets à traiter, un par un et dans cet ordre : ${list}`
  await update($, uiAtom, ui => ({ ...ui, selection: [] }))
  await prepare($, isParallel ? 'implement-spec' : 'implement', args)
}

/** /implement-spec attend une spec : sans elle, le graphe des tickets lui suffit, et on le lui dit. */
const noSpecClause = (run: Run): string =>
  hasSpecAndTickets(run) ? '' : '. Pas de spec : les tickets et leurs dépendances (dans le tracker) suffisent.'

const ticketList = (run: Run, ids: readonly string[]): string =>
  ids.map((id, i) => `${i + 1}) ${id} — ${run.tickets.find(t => t.id === id)?.name ?? id}`).join(' ; ')

/** Lance un groupe prêt : ses tickets ouverts, dans l'ordre, avec /implement. */
const launchGroup = async ($: any, groupId: string) => {
  const run = activeRun(await read($, boardAtom))
  const view = run ? groupPlan(run)?.groups.find(g => g.group.id === groupId) : undefined
  if (!run || !view || view.open.length === 0) return
  const ids = view.open.map(t => t.id)
  const now = await $.clock.now()
  await commit($, b => setQueue(b, ids, now))
  await update($, uiAtom, ui => ({ ...ui, selection: [] }))
  await prepare($, 'implement', `Groupe ${view.group.id} (${view.group.name}), tickets un par un et dans cet ordre : ${ticketList(run, ids)}`)
}

/** Lance seuls les tickets déjà prêts d'un groupe qui attend : /implement, dans l'ordre du groupe. */
const launchReady = async ($: any, groupId: string) => {
  const run = activeRun(await read($, boardAtom))
  const view = run ? groupPlan(run)?.groups.find(g => g.group.id === groupId) : undefined
  if (!run || !view || view.readyNow.length === 0) return
  const ids = view.readyNow.map(t => t.id)
  const now = await $.clock.now()
  await commit($, b => setQueue(b, ids, now))
  await update($, uiAtom, ui => ({ ...ui, selection: [] }))
  await prepare($, 'implement', `Groupe ${view.group.id} (${view.group.name}), tickets déjà prêts, un par un et dans cet ordre : ${ticketList(run, ids)}`)
}

/** Longueur au-delà de laquelle le titre du parcours est coupé dans le titre d'une session liée. */
const PREFIX_MAX = 28

/**
 * Le début du titre de toute session liée : le titre du parcours, raccourci, puis « › ». Dans la
 * liste des discussions, les sessions filles d'une même discussion mère se reconnaissent ainsi. Sans
 * guillemets ni `$`, `\`, accent grave : le titre passe aussi entre guillemets dans `claude --bg -n`.
 */
const linkedPrefix = (run: Run): string => {
  const clean = run.title.replace(/["`$\\«»]/g, '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  if (clean.length <= PREFIX_MAX) return `${clean} › `
  const cut = clean.slice(0, PREFIX_MAX)
  const at = cut.lastIndexOf(' ')
  return `${(at > PREFIX_MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:·–-]+$/, '')}… › `
}

/**
 * Comment lancer une session liée, dans l'app Desktop comme dans le CLI. Claude choisit selon ses
 * outils, pas selon la surface : une session du CLI ouverte dans VS Code n'a pas `start_session`
 * non plus. Dans le CLI, la fille rend compte par SendMessage, qui réveille la discussion
 * principale même inactive ; l'avis d'inactivité n'est qu'un filet, car il arrive au premier
 * arrêt de la fille, qui peut être une demande d'accord.
 * `ownFolder` faux : la session reste dans ce dossier (elle reprend le parcours, qui vit dans son fichier).
 * `effort` : la règle qui choisit l'effort de la session ; sans elle, la session prend celui de
 * cette discussion (start_session ne lui en donne jamais un plus haut).
 */
const launchHow = (o: { many: boolean; isRepo: boolean; ownFolder: boolean; title: string; worktree: string; effort?: string }): string => {
  const each = o.many ? 'chaque session' : 'la session'
  const desktopEffort = o.effort ? ', effort "<effort>"' : ''
  const cliEffort = o.effort ? ' --effort <effort>' : ''
  const desktopWhere = !o.ownFolder
    ? 'use_worktree false (elle reprend le parcours, qui vit dans ce dossier)'
    : o.isRepo
      ? 'use_worktree true (un worktree à elle)'
      : 'use_worktree false (ce dossier n’a pas de git)'
  const cliWhere = !o.ownFolder
    ? ' (sans -w : elle reste dans ce dossier, où vit le parcours)'
    : o.isRepo
      ? ` -w ${o.worktree} (un worktree à elle)`
      : ' (sans -w : ce dossier n’a pas de git)'
  return (
    (o.effort ? `${o.effort} ` : '') +
    `Dans l'app Desktop (tu as l'outil start_session) : start_session${o.many ? ' une fois par groupe' : ''}, avec initiation user_asked, context "fresh", wake_when_done true${desktopEffort} et ${desktopWhere}. ` +
    `Dans le CLI (pas de start_session) : appelle d'abord ListAgents pour lire le nom de cette discussion et sa référence entre crochets (« This session is <nom> [<ref>] » : le nom peut changer, la référence non), puis lance ${each} par le shell : claude --bg -n "${o.title}"${cliEffort}${cliWhere} "<prompt>" ; ` +
    `le background va en tête du prompt, et le tout s'écrit dans un fichier temporaire passé par "$(cat <fichier>)". ` +
    `Ajoute --permission-mode avec le mode de cette discussion si tu le connais : avec un mode différent, ses messages attendraient mon accord. ` +
    `claude --bg affiche « backgrounded · <id> · <titre> », que le tableau de bord relève ; s'il répond « Workspace not trusted », demande-moi de lancer claude une fois dans ce dossier. ` +
    `Le prompt donne le nom de cette discussion et sa référence (« <nom> [<ref>] », à passer aussi dans "main" de l'appel delegate) et demande à ${each} d'envoyer son compte rendu final par SendMessage à ce nom : ce message la réveille, même inactive. ` +
    `Si ce nom n'est plus joignable (discussion renommée), ${each} appelle ListAgents, trouve la ligne qui porte cette référence et envoie à « <nom du moment> [<ref>] » tel que la liste l'affiche ; si aucune ligne ne la porte, ${each} le dit en tête de son message final. ` +
    `Dans le CLI seulement, puis SendMessage à ${each} (par son titre) avec notify_when_idle true et sans message, en filet seulement : l'avis arrive à son premier arrêt, qui peut être une demande d'accord et non la fin ; dans l'app Desktop, notify_when_idle est inopérant : wake_when_done et le compte rendu par SendMessage suffisent, ne l'y envoie pas. `
  )
}

/**
 * L'effort d'une session de groupe : medium par défaut, ses tickets étant cadrés et ses revues
 * confiées à des sous-agents à l'effort explicite ; high pour un groupe délicat.
 */
const GROUP_EFFORT = (many: boolean): string =>
  `Effort de ${many ? 'chaque session (<effort>, choisi groupe par groupe)' : 'la session (<effort>)'} : medium par défaut ; high si ${many ? 'son' : 'le'} groupe a un ticket qui touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence), s'il reste des choix de conception à faire ou s'il touche plusieurs modules à la fois. Dis-moi en une ligne l'effort choisi${many ? ' pour chaque groupe' : ''} et pourquoi.`

/** Ce qui sert de note de fin à la discussion principale, selon que la session a été lancée par l'app ou par le CLI. */
const atEnd = (whose: string): string => `À la note de fin de ${whose} (dans le CLI : son compte rendu reçu par SendMessage)`

/**
 * Sans git, le point fixe des revues d'une session liée : la copie des fichiers prise avant chaque
 * ticket dans son dossier temporaire (sans elle, les revues relisaient des fichiers entiers).
 */
const LINKED_NO_GIT_COPY =
  "puis, ce dossier n'ayant pas de git, avant de toucher à son premier fichier, copier les fichiers qu'il va modifier dans son dossier temporaire (celui des règles de travail ci-dessous), un sous-dossier par ticket qui garde le chemin dans le projet (<dossier temporaire>/<id du ticket>/<chemin dans le projet>) : ces copies sont le point fixe des revues, qui lisent la différence entre la copie et le fichier actuel (diff unifié ; git diff --no-index <copie> <fichier> marche hors d'un dépôt) au lieu de relire les fichiers entiers ; un fichier que le ticket crée n'a pas de copie : il est nouveau et se lit en entier"

const LINKED_NO_GIT_TICKET_POINT = 'point fixe : la copie de ses fichiers prise avant le ticket, comparée aux fichiers actuels'

const LINKED_NO_GIT_GROUP_POINT =
  "point fixe : pour chaque fichier, la plus ancienne copie parmi les tickets du groupe (un fichier touché seulement par un ticket suivant n'a pas de copie du premier), comparée au fichier actuel, les fichiers nouveaux en entier ; lui donner la liste des copies et des fichiers"

/**
 * La demande à Claude pour confier des groupes à des sessions liées, une par groupe. Le parcours
 * reste ici (un seul écrivain) : chaque session se déclare (`delegate`), fait ses tickets avec
 * /implement selon le CLAUDE.md du projet, puis rend compte ; Claude rend les statuts ici.
 */
const delegationText = async ($: any, run: Run, views: readonly GroupView[]): Promise<string> => {
  // Sans git, pas de worktree possible : les sessions travaillent dans ce dossier.
  const isRepo = await measureRepo($)
  const implement = `/${await commandFor($, 'implement')}`
  const tdd = `/${await commandFor($, 'tdd')}`
  const ticketReview = `/${await commandFor($, 'code-review')}`
  const ticketPoint = isRepo ? "point fixe : le commit d'avant le ticket" : LINKED_NO_GIT_TICKET_POINT
  const many = views.length > 1
  const delegate = `{"delegate": "${run.id}", "group": "${many ? '<id du groupe>' : views[0]!.group.id}", "main": "<nom> [<ref>] de cette discussion"}`
  const groups = views.map(v => `Groupe ${v.group.id} (${v.group.name}) : ${ticketList(run, v.open.map(t => t.id))}`).join(' ∥ ')
  const prefix = linkedPrefix(run)
  return (
    `${many ? 'Confie chacun de ces groupes à sa session liée, en parallèle,' : 'Confie ce groupe à une session liée,'} pour le parcours « ${run.title} » : ${groups}. ` +
    `Avant de lancer : repère ce dont ${many ? 'les sessions auront' : 'la session aura'} besoin de ma part (une décision, un accès, un geste qui m'est réservé) et règle-le d'abord avec moi ici, sinon ${many ? 'elles y buteront' : 'elle y butera'}. ` +
    `Puis lance ${many ? 'une session par groupe' : 'la session'}, avec un titre qui commence par « ${prefix}Groupe <id> · » : le début dit de quelle discussion ${many ? 'elles viennent' : 'elle vient'}, et « Groupe <id> » relie la session à son groupe au tableau de bord. ` +
    launchHow({ many, isRepo, ownFolder: true, title: `${prefix}Groupe <id> · <thème>`, worktree: 'groupe-<id>', effort: GROUP_EFFORT(many) }) +
    `Rédige toi-même le background : le projet, les contraintes (ressource à ne pas partager, écritures autorisées, gestes qui me sont réservés)${many ? ', ce que font les autres sessions en même temps' : ''}, et les décisions déjà prises par renvoi, sans les réécrire dans le brief : le fichier de décisions du projet (DECISIONS.md, ou celui que nomme son CLAUDE.md) et les commentaires « mise à jour du porteur » des tickets font foi, et une décision que je viens de prendre ici s'y écrit AVANT d'être relayée, avec ma phrase exacte entre guillemets ; une décision qui remplace un geste humain (un accord, une validation, un ok de dépense) se confirme par moi directement dans la session liée, jamais par ton seul message. ` +
    `Le prompt de ${many ? 'chaque session' : 'la session'} : 1) d'abord, appeler une seule fois l'outil flow de flow-board avec ${delegate} : le parcours reste ici, et l'avancement de la session (statuts Asana des tickets, commits, tests) est relayé tout seul au tableau de bord d'ici ; ` +
    `2) puis faire les tickets du groupe, un par un et dans l'ordre, chacun ainsi : relire d'abord le fichier de décisions du projet et les commentaires « mise à jour du porteur » du ticket (ils priment sur ce prompt) ; le passer « en cours » dans le tracker en le commençant (le relais y reconnaît la passe « bogues » d'un ticket en cours) ; un geste de ma part que le groupe prévoit lui-même (un ok, une vérification à l'écran, une réponse sur un ticket du groupe) n'est pas un blocage externe : le ticket reste « en cours », ligne « Statut : en attente (porteur) », jamais « blocked » au tableau de bord ; ${isRepo ? '' : `${LINKED_NO_GIT_COPY} ; ensuite `}${tdd} par l'outil Skill, les contrôles du projet, ${ticketReview} par l'outil Skill sur les seuls changements du ticket (${ticketPoint}), même pour un petit diff ; si le ticket touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence), lancer dans le même message la passe « bogues » /${slashOf('final-review')} xhigh (outil Skill « ${slashOf('final-review')} », arguments « xhigh »), sur le même périmètre (${ticketPoint}), en lui donnant ${DECIDED_LIST} ; puis le commit et le suivi du ticket ; ne pas lancer ${implement} par l'outil Skill : il est réservé à l'utilisateur, et ces étapes sont les siennes ; ` +
    `3) suivre le CLAUDE.md du projet (contrôles, commit, suivi des tickets), sans sous-agents qui écrivent (des sous-agents en parallèle seulement pour des recherches en lecture seule ; seule exception, le relecteur de la revue du groupe, au point 4) ; ` +
    `et ces règles de travail : écrire le script par l'outil Write, puis le lancer par une commande simple ; son dossier temporaire se désigne par son chemin absolu, écrit en clair dans les commandes et les appels Write : le lire une fois au début (printenv CLAUDE_JOB_DIR, seule dans sa commande ; à défaut, le dossier temporaire que donnent ses instructions) ; ne jamais attendre par \`sleep\` : la fin d'un sous-agent ou d'une commande en arrière-plan est notifiée ; si je change d'avis en cours de route sur un ticket, ajouter au ticket un commentaire daté « mise à jour du porteur » qui le dit, sans modifier son contenu ; citer un nombre de tests d'après la ligne de résumé de la sortie des tests, jamais de mémoire ; ` +
    `4) une fois tous les tickets commités, lancer elle-même la revue du groupe en la confiant à ${LINKED_GROUP_REVIEWER} ; la revue est /${commandLineOf('final-review')} (la revue de Claude Code, outil Skill « ${slashOf('final-review')} », arguments « ${SKILLS['final-review']!.args} »)${isRepo ? ", sur sa branche face à sa base (si la revue ne voit aucun changement, lui donner le nom de la branche)" : `, sur les changements du groupe (${LINKED_NO_GIT_GROUP_POINT})`}, en lui donnant ${DECIDED_LIST}, et en lui demandant de se concentrer sur les interactions entre les tickets (chacun a déjà eu sa revue) ; ${NO_ARBITRATION} ; à son retour, relire le diff de ses correctifs, relancer les contrôles et les commiter ; ` +
    `5) puis juger si une revue de sécurité vaut la peine (les changements du groupe touchent : ${SECURITY_CRITERIA}) ; si oui, ${linkedSecurityReview(isRepo ? 'git diff <base>..HEAD (<base> : le commit d\'où part sa branche)' : `les changements du groupe (${LINKED_NO_GIT_GROUP_POINT})`)} ; ` +
    `6) finir par un compte rendu : une ligne par ticket (fait, ou pas fait et pourquoi), les fichiers modifiés${isRepo ? ', sa branche' : ''}, les contrôles lancés et leur résultat, la revue du groupe (constats, corrigés), la revue de sécurité (lancée ou non, pourquoi, failles trouvées), et ce qui m'attend. ` +
    `Ici : garder le parcours (pas de nouveau parcours) et suivre ${many ? 'les sessions sans les ' : "la session sans l'"}attendre activement. ` +
    `Si l'app ou cette discussion redémarre, le parcours passe en pause et ne reçoit plus rien : à la reprise de cette discussion, le reprendre ici avant toute autre écriture, par l'appel flow {"resume": "${run.id}"} (comme « ↻ Reprendre ici »), puis rendre les statuts des tickets faits pendant la pause d'après Asana ; dans ${many ? 'chaque session liée' : 'la session liée'}, si l'outil flow répond que le parcours est en pause, continuer les tickets (tracker, commits) et le dire dans le compte rendu. ` +
    `${atEnd(many ? 'chacune' : 'la session')}, vérifier son travail et, dans son compte rendu, que la revue du groupe a tourné (sinon, la lui demander par SendMessage avant tout)${isRepo ? ', fusionner sa branche' : ''}, puis envoyer à l'outil flow les statuts de ses tickets dans "set", avec {"returned": ["<id du groupe>"]} et, si son compte rendu dit que la revue du groupe a tourné, {"reviewed": ["<id du groupe>"]} (le tableau de bord ne la voit pas toujours : sans cela, il la proposerait encore), ` +
    `et, d'après son compte rendu, {"security": {"group": "<id du groupe>", "advised": true|false, "why": "<raison>"}}, avec "findings" et "fixed" si la revue de sécurité a tourné ; me dire les failles trouvées : je décide de leur correction.`
  )
}

/** Confie des groupes prêts à des sessions liées : ils passent « session liée à lancer », la demande va dans le prompt. */
const delegateGroups = async ($: any, ids: readonly string[]) => {
  const run = activeRun(await read($, boardAtom))
  const plan = run ? groupPlan(run) : null
  if (!run || !plan) return
  const now = await $.clock.now()
  if (!(await commit($, b => startLinkedGroups(b, ids, now)))) return
  const views = plan.groups.filter(g => ids.includes(g.group.id) && g.open.length > 0)
  await update($, uiAtom, ui => ({ ...ui, selection: [] }))
  const text = await delegationText($, run, views)
  const names = views.map(v => v.group.id).join(', ')
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() =>
    $.ui.toast(isFilled ? `Session${views.length > 1 ? 's liées' : ' liée'} pour ${names} : la demande est dans le prompt, Entrée pour la lancer` : `Demande à taper : confie ${names} à des sessions liées`),
  )
}

/**
 * La revue d'un groupe rendu par sa session liée sans revue : ici, sa branche est fusionnée et
 * `/code-review` n'aurait rien à lire. La demande va dans le prompt : Claude la fait faire à la
 * session, sur les commits du groupe lus sur le code actuel, puis marque le groupe relu.
 */
const reviewLinkedGroup = async ($: any, groupId: string) => {
  const run = activeRun(await read($, boardAtom))
  const group = run?.groups?.find(g => g.id === groupId)
  if (!run || !group?.delegated) return
  const isRepo = await measureRepo($)
  const main = (await read($, syncAtom)).main ?? 'la branche principale'
  const session = group.delegated.session ? ` (id ${group.delegated.session})` : ''
  const text =
    `Fais faire la revue du groupe ${group.id} (${group.name}) du parcours « ${run.title} » par sa session liée : le groupe est revenu sans revue, et ici sa branche est déjà fusionnée. ` +
    `Sa session a un titre qui commence par « ${linkedPrefix(run)}Groupe ${group.id} · » ou « Groupe ${group.id} · »${session} : retrouve-la par ListAgents. ` +
    `Envoie-lui par SendMessage (dans le CLI seulement, avec notify_when_idle true ; dans l'app Desktop, il est inopérant) : ` +
    (isRepo ? `1) remettre sa branche au niveau de ${main} par une avance rapide (git merge --ff-only ${main}), pour que les correctifs portent sur le code actuel ; ` : '1) travailler sur le code actuel ; ') +
    `2) lancer elle-même la revue en la confiant à ${LINKED_GROUP_REVIEWER} ; la revue est /${commandLineOf('final-review')} (outil Skill « ${slashOf('final-review')} », arguments « ${SKILLS['final-review']!.args} ») ${isRepo ? "sur les seuls commits du groupe, lus sur le code actuel (une revue sans cible n'y verrait aucun changement : lui donner les commits)" : `sur les seuls changements du groupe, lus sur le code actuel (${LINKED_NO_GIT_GROUP_POINT} : sa session a pris ces copies dans son dossier temporaire)`}, en lui donnant ${DECIDED_LIST}, et en lui demandant de se concentrer sur les interactions entre les tickets ; ${NO_ARBITRATION} ; ` +
    `3) au retour du relecteur, relire le diff de ses correctifs, relancer les contrôles du projet et commiter ; ` +
    `4) juger si une revue de sécurité vaut la peine (les changements du groupe touchent : ${SECURITY_CRITERIA}) et, si oui, ${linkedSecurityReview(isRepo ? 'les commits du groupe' : `les changements du groupe (${LINKED_NO_GIT_GROUP_POINT})`)} ; ` +
    `5) envoyer son compte rendu par SendMessage : constats et corrigés, commits, contrôles, avis et failles de sécurité. ` +
    `Si la session n'existe plus ou si l'outil Skill refuse la revue, dis-le-moi : je la lancerai moi-même. ` +
    `Au compte rendu : vérifier son travail${isRepo ? ', fusionner sa branche' : ''}, puis envoyer à l'outil flow {"reviewed": ["${group.id}"]} et {"security": {"group": "${group.id}", "advised": true|false, "why": "<raison>"}}, avec "findings" et "fixed" si la revue de sécurité a tourné ; me dire les failles trouvées : je décide de leur correction.`
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() =>
    $.ui.toast(isFilled ? `Revue de ${group.id} par sa session liée : la demande est dans le prompt, Entrée pour la lancer` : `Demande à taper : fais relire ${group.id} par sa session liée`),
  )
}

/**
 * « ⛨ Revue de sécurité » sur un groupe relu (ou sur le lot sans groupes) : Claude la lance
 * d'ordinaire lui-même après la revue ; le bouton la lui demande quand il ne l'a pas fait (avis
 * « inutile », ou relance). Jamais `/security-review`, qui relit la branche face à la branche par défaut.
 */
const securityReview = async ($: any, id: string) => {
  const run = activeRun(await read($, boardAtom))
  if (!run) return
  const group = id === 'lot' ? undefined : run.groups?.find(g => g.id === id)
  if (id !== 'lot' && !group) return
  const isRepo = await measureRepo($)
  const scope = !group
    ? 'les changements que la revue de ce parcours a relus'
    : !isRepo
      ? `les changements du groupe ${group.id} (pour chaque fichier, la différence entre la plus ancienne copie prise avant ses tickets, dans le dossier temporaire de la session qui les a faits, et le fichier actuel ; les fichiers nouveaux en entier)`
      : group.delegated
        ? `les commits du groupe ${group.id}, lus sur le code actuel`
        : `git diff <base>..HEAD (<base> : le commit d'avant le premier ticket du groupe ${group.id})`
  const what = group ? `du groupe ${group.id} (${group.name})` : 'de ce parcours'
  const send = group ? `{"security": {"group": "${group.id}", "findings": <failles réelles>, "fixed": <corrigées>}}` : '{"security": {"findings": <failles réelles>, "fixed": <corrigées>}}'
  const text =
    `Lance la revue de sécurité ${what} : confie-la à un sous-agent relecteur (outil Agent, type general-purpose, modèle opus, effort xhigh), en lecture seule, avec pour seul périmètre ${scope} et pour critères ${SECURITY_CRITERIA} ; ` +
    `pas /security-review, qui relit la branche face à la branche par défaut, donc aussi les autres groupes. Le sous-agent ne corrige rien : dis-moi les failles trouvées, je décide de leur correction. Puis envoie à l'outil flow ${send}.`
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? `Revue de sécurité ${what} : la demande est dans le prompt, Entrée pour la lancer` : `Demande à taper : revue de sécurité ${what}`))
}

/** « ↗ Session liée » sur un groupe prêt : une session liée le fait, le parcours reste ici. */
const launchGroupLinked = ($: any, groupId: string) => delegateGroups($, [groupId])

/** Annule l'envoi d'un groupe à une session liée qui n'a pas été lancée. */
const cancelGroupLinked = async ($: any, groupId: string) => {
  const now = await $.clock.now()
  await commit($, b => cancelLinkedGroup(b, groupId, now))
}

/** Le lot n° `at` du plan : 0 pour le lot principal, puis les autres lots. */
const lotAt = (run: Run, at: number): string[] => {
  const plan = groupPlan(run)
  if (!plan) return []
  return at === 0 ? plan.parallelBatch : (plan.otherBatches[at - 1] ?? [])
}

/** « ⇉ … en parallèle · sessions liées » : une session liée par groupe du lot. */
const launchParallelLinked = async ($: any, at = 0) => {
  const run = activeRun(await read($, boardAtom))
  const lot = run ? lotAt(run, at) : []
  if (lot.length < 2) return
  await delegateGroups($, lot)
}

/**
 * Fait diagnostiquer un bug par une session liée, en détour de la phase de code ou de revue en
 * cours : la demande va dans le prompt, et la personne décrit le bug à la fin, après « Bug : ».
 */
const launchBugLinked = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  if (!run) return
  const phase = SKILLS[currentPhase(run).skill]?.label ?? currentPhase(run).skill
  const resume = `{"resume": "${run.id}"}`
  const prefix = linkedPrefix(run)
  const text =
    `Lance un diagnostic de bug dans une session liée, pour le parcours « ${run.title} » (phase ${phase}), avec un titre qui commence par « ${prefix}Bug · ». ` +
    // Elle reprend le parcours (`resume`) : il faut qu'elle lise le même fichier, donc ce dossier, pas un worktree.
    launchHow({ many: false, isRepo: false, ownFolder: false, title: `${prefix}Bug · <sujet>`, worktree: '' }) +
    `Brief de la session : 1) d'abord, appeler l'outil flow de flow-board avec ${resume}, pour reprendre le parcours dans la session ; ` +
    `2) puis lancer /${await commandFor($, 'diagnosing-bugs')} avec la description du bug ci-dessous : le diagnostic s'affiche en détour de la phase en cours ; ` +
    `3) corriger en suivant le CLAUDE.md du projet (contrôles, revue et commit) et proposer en tâche ce qui reste ouvert ; ` +
    `4) à la fin, envoyer {"complete": true} pour clore le détour. ` +
    `Ici, ne rien enregistrer sur ce parcours tant que la session travaille ; ${atEnd('la session').replace(/^À/, 'à')}, vérifier son travail, puis reprendre le parcours ici avec ${resume}. ` +
    `Bug : `
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? 'Bug en session liée : décris-le après « Bug : », puis Entrée' : 'Demande à taper : lance un diagnostic de bug dans une session liée'))
}

/** Comment rendre chaque élément confié à la note de fin de sa session. */
const ITEM_VERDICTS = "done si elle est faite et vérifiée ; todo si elle n'a pas été faite (elle revient à mon choix, sans être écartée) ; dropped seulement si je décide de l'abandonner"

/**
 * La demande à Claude pour lancer une session liée sur des éléments de la phase (les pistes d'une
 * rétro). Les éléments ne portent qu'un libellé : c'est la discussion d'ici, qui connaît la session
 * étudiée, qui rédige le brief.
 */
const itemsRequest = async ($: any, run: Run, phase: FlowPhase, ids: readonly string[]): Promise<string> => {
  const def = SKILLS[phase.skill]!
  const label = def.items!.label.toLowerCase()
  const list = phase.items
    .filter(i => ids.includes(i.id))
    .map((i, n) => `${n + 1}) [${i.id}] ${i.label}`)
    .join(' ; ')
  // Sans git, pas de worktree possible : la session travaille dans ce dossier.
  const isRepo = await measureRepo($)
  return (
    `Traite ces ${label} de la phase ${def.label} du parcours « ${run.title} » dans une session liée : ${list}. ` +
    `Avant de la lancer : repère les ${label} qui ont besoin d'une information ou d'une décision de ma part (un accès, un choix entre options) et règle-les d'abord avec moi ici, sinon la session y butera. ` +
    `Puis lance la session, avec un titre qui commence par « ${linkedPrefix(run)}${def.items!.label} · ». ` +
    launchHow({ many: false, isRepo, ownFolder: true, title: `${linkedPrefix(run)}${def.items!.label} · <sujet>`, worktree: label.replace(/[^a-z0-9]+/g, '-') }) +
    `Si tu ne peux pas la lancer (outil absent, refus, erreur), dis-le-moi avec la raison et n'envoie rien sur ces ${label} à l'outil flow : le tableau de bord les garde à lancer, avec « Redemander » et « Annuler ». ` +
    `Rédige toi-même le background : le projet, la session étudiée par la rétro, les décisions déjà prises et les contraintes (ressource unique comme une appli ouverte, écritures autorisées, gestes qui me sont réservés). ` +
    `Rédige le prompt avec une section par piste : le problème constaté (une phrase), la correction attendue, les fichiers touchés et un critère de fin vérifiable. ` +
    `Consignes du prompt : travailler en séquence, en regroupant les pistes qui touchent les mêmes fichiers, sans sous-agents qui écrivent (des sous-agents en parallèle seulement pour des recherches en lecture seule et indépendantes) ; suivre le CLAUDE.md du projet et lancer à la fin les contrôles qu'il déclare ; ne pas utiliser l'outil flow de flow-board ni reprendre ce parcours, qui reste dans la discussion principale ; finir par un compte rendu avec une ligne par piste (faite, ou pas faite et pourquoi), les fichiers modifiés${isRepo ? ', sa branche' : ''}, les contrôles lancés et leur résultat, et ce qui m'attend. ` +
    `Ici : garder le parcours (pas de resume ni de nouveau parcours) et suivre la session sans l'attendre activement. ` +
    `${atEnd('la session')}, vérifier son travail (diff, commits, contrôles${isRepo ? ', fusion de sa branche' : ''}), puis envoyer à l'outil flow la liste complète des items avec le statut de chacun : ${ITEM_VERDICTS}, puis {"complete": true} si aucune n'est revenue à todo.`
  )
}

/** Met une demande dans le prompt ; le toast dit si elle y est ou s'il faut la taper. */
const fillRequest = async ($: any, text: string, filled: string, typed: string) => {
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? filled : typed))
}

/**
 * Confie les éléments choisis de la phase (les pistes d'une rétro) à une session liée : la demande
 * va dans le prompt pour Claude, qui lance la session. Les éléments passent « en cours » et l'étape
 * « Modifications en cours » s'ouvre au lancement seulement. Le parcours reste ici : la session ne le
 * reprend pas, Claude la suit et rend les statuts.
 */
const launchItemsLinked = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  if (!run) return
  const phase = currentPhase(run)
  const def = SKILLS[phase.skill]
  const allowed = pickableItems(phase).map(i => i.id)
  const ids = ((await read($, uiAtom)).itemSelection ?? []).filter(id => allowed.includes(id))
  if (!def?.items?.linkedStep || ids.length === 0) return
  const now = await $.clock.now()
  if (!(await commit($, b => startLinkedItems(b, ids, now)))) return
  await update($, uiAtom, ui => ({ ...ui, itemSelection: [] }))
  const label = def.items.label.toLowerCase()
  // Un envoi encore sans session reprend aussi les éléments d'avant : la demande les liste tous.
  const sent = activeRun(await read($, boardAtom))
  const sentPhase = sent ? currentPhase(sent) : phase
  const all = linkedInFlight(sentPhase).map(i => i.id)
  const text = await itemsRequest($, run, sentPhase, all)
  await fillRequest($, text, `Session liée pour ${all.length} ${label} : la demande est dans le prompt, Entrée pour l'envoyer à Claude`, `Demande à taper : traite les ${label} choisies dans une session liée`)
}

/** « Redemander » : aucune session n'a pris les éléments ; la même demande revient dans le prompt. */
const relaunchLinked = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  const phase = run ? currentPhase(run) : null
  const def = phase ? SKILLS[phase.skill] : undefined
  if (!run || !phase || !def?.items) return
  const ids = linkedInFlight(phase).map(i => i.id)
  const now = await $.clock.now()
  if (!(await commit($, b => retryLinked(b, now)))) return
  const label = def.items.label.toLowerCase()
  // Une session a pu partir sans que son id soit relevé : la vérifier avant d'en lancer une seconde.
  const check =
    `D'abord, vérifie qu'aucune session n'a déjà été lancée pour ces ${label} : dans cette discussion (un appel de lancement), puis par ListAgents ou claude agents (un titre qui commence par « ${linkedPrefix(run)}${def.items.label} · »). ` +
    `Si tu en trouves une, ne lance rien : dis-le-moi, avec son id, et suis-la comme ci-dessous. Sinon : `
  const text = check + (await itemsRequest($, run, phase, ids))
  await fillRequest($, text, `Session liée redemandée pour ${ids.length} ${label} : Entrée pour l'envoyer à Claude`, `Demande à taper : traite les ${label} confiées dans une session liée`)
}

/**
 * « Reprendre les pistes » : les éléments confiés sont restés en cours ou à lancer (session arrêtée
 * sans note de fin, ou jamais lancée). La demande va dans le prompt pour que Claude retrouve la
 * session, ou constate qu'il n'y en a pas, et rende les éléments sans en abandonner aucun à tort.
 */
const recoverLinked = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  const phase = run ? currentPhase(run) : null
  const linked = phase?.linked
  if (!run || !phase || !linked) return
  const def = SKILLS[phase.skill]
  const label = (def?.items?.label ?? 'éléments').toLowerCase()
  const list = linkedInFlight(phase)
    .map((i, n) => `${n + 1}) [${i.id}] ${i.label}`)
    .join(' ; ')
  // Lire une session : l'outil de l'app Desktop, le CLI ou son transcript, qui marche partout.
  const howToRead = "avec tes outils de session de l'app Desktop si tu les as, sinon claude agents puis claude logs <id> dans le CLI, ou son fichier .jsonl sous ~/.claude/projects/"
  const text =
    linked.session !== undefined
      ? `Vérifie l'état de la session liée (${linked.session}) qui traite les ${label} du parcours « ${run.title} » : ${list}. Lis-la ${howToRead}. ` +
        `Si elle travaille encore, dis-le-moi et n'envoie rien. Sinon, contrôle son travail (diff, commits, contrôles), puis envoie à l'outil flow la liste complète des items avec le statut de chacun : ${ITEM_VERDICTS} ; enfin {"complete": true} seulement si aucune n'est revenue à todo.`
      : `Aucune session n'a été relevée pour les ${label} du parcours « ${run.title} » : ${list}. Cherche d'abord si une session a été lancée pour elles : un titre qui commence par « ${linkedPrefix(run)}${def?.items?.label ?? ''} · », ${howToRead}, et cette discussion (un appel de lancement, une erreur). ` +
        `Si tu n'en trouves aucune, le lancement n'a pas eu lieu : n'envoie aucun statut à l'outil flow et ne clos pas la phase ; dis-moi ce qui l'a empêché si tu le vois, je choisis dans le tableau de bord entre « Redemander » et « Annuler » (les ${label} reviennent à mon choix). ` +
        `Si tu en trouves une : contrôle son travail (diff, commits, contrôles), envoie à l'outil flow la liste complète des items, les ${label} faites et vérifiées en done et les autres en todo, sans en clore la phase, et dis-moi celles qui restent : je les rends à mon choix par « Annuler ».`
  await fillRequest($, text, `Reprise des ${label} : la demande est dans le prompt, Entrée pour l'envoyer`, `Demande à taper : vérifie la session liée et rends les ${label}`)
}

/**
 * « Et maintenant ? » : /ask-matt dans le prompt, avec l'endroit du parcours où l'on est (phase,
 * étape, détour), pour qu'il réponde sur la suite au lieu de repartir de zéro.
 */
const askNext = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  if (!run) return prepare($, 'ask-matt', 'Aucun parcours en cours : par où commencer ?')
  const phase = currentPhase(run)
  const def = SKILLS[phase.skill]
  const stepId = phase.steps.find(s => s.status === 'active')?.id
  const step = def?.steps.find(s => s.id === stepId)?.label
  const detour = activeDetour(phase)
  const where = [
    `parcours « ${run.title} »`,
    `phase ${def?.label ?? phase.skill}${phase.status === 'done' ? ' (terminée)' : ''}`,
    step ? `étape ${step}` : '',
    detour ? `détour ${SKILLS[detour.skill]?.label ?? detour.skill}` : '',
  ]
    .filter(Boolean)
    .join(', ')
  await prepare($, 'ask-matt', `Je suis dans le ${where} : quelle est la suite ?`)
}

/**
 * Lance un lot avec /implement-spec : les groupes prêts, pas encore commencés et sans fichier ni
 * ressource en commun, un sous-agent par groupe qui garde le contexte de ses tickets. Les autres
 * groupes viendront par un lancement suivant. Seulement dans un dépôt git : le skill fait une
 * branche d'intégration et un worktree par implémenteur.
 */
const launchParallel = async ($: any, at = 0) => {
  const run = activeRun(await read($, boardAtom))
  const plan = run ? groupPlan(run) : null
  const lot = run ? lotAt(run, at) : []
  if (!run || !plan || lot.length < 2) return
  let isRepo = false
  await quietly(async () => {
    isRepo = (await $.session.repo()) !== null
  })
  if (!isRepo) {
    await quietly(() => $.ui.toast('Pas de dépôt git ici : /implement-spec a besoin de worktrees. Lance le lot en sessions liées.'))
    return
  }
  const batch = plan.groups.filter(g => lot.includes(g.group.id))
  const parts = batch.map(g => `${g.group.id} (${g.group.name}) : ${ticketList(run, g.open.map(t => t.id))}`)
  const ids = batch.flatMap(g => g.open.map(t => t.id))
  const now = await $.clock.now()
  await commit($, b => setQueue(b, ids, now))
  await update($, uiAtom, ui => ({ ...ui, selection: [] }))
  // Le skill prévoit un implémenteur par ticket ; ici, les tickets d'un groupe partagent leurs fichiers.
  const args =
    `Groupes en parallèle, un sous-agent implémenteur par groupe, à la place d'un par ticket (étape 4 du skill) : les tickets d'un groupe partagent leurs fichiers. ` +
    `Chaque implémenteur travaille dans son worktree, sur sa branche, et traite les tickets de son groupe dans l'ordre, un commit par ticket ; ` +
    `le merger fusionne sa branche dans la branche d'intégration quand le groupe est fini. Le reste du skill s'applique (branche d'intégration, revue finale, nettoyage des worktrees). ` +
    `Groupes : ${parts.join(' ∥ ')}${noSpecClause(run)}`
  await prepare($, 'implement-spec', args)
}

const actionsFor = ($: any): Actions => ({
  setTab: (tab: Tab) => update($, uiAtom, ui => ({ ...ui, tab })),
  launch: (skill: string) => launch($, skill),
  prepare: (skill: string, args?: string) => prepare($, skill, args),
  fillCommand: (command: string) => fillCommand($, command),
  finish: async () => {
    const now = await $.clock.now()
    await commit($, board => finishActive(board, now))
  },
  setAside: async () => {
    const now = await $.clock.now()
    await commit($, board => setAsideActive(board, now))
  },
  resume: async (id: string) => {
    const now = await $.clock.now()
    await commit($, board => resumeRun(board, id, now))
    await update($, uiAtom, ui => ({ ...ui, tab: 'flow' }))
  },
  drop: async (id: string) => {
    const now = await $.clock.now()
    await commit($, board => dropRun(board, id, now))
    await update($, uiAtom, ui => ({ ...ui, confirmDrop: undefined }))
  },
  archive: async (id: string) => {
    const now = await $.clock.now()
    await commit($, board => archiveRun(board, id, now))
  },
  unarchive: async (id: string) => {
    const now = await $.clock.now()
    await commit($, board => unarchiveRun(board, id, now))
  },
  toggleArchived: () => update($, uiAtom, ui => ({ ...ui, showArchived: !ui.showArchived })),
  toggleTickets: () => update($, uiAtom, ui => ({ ...ui, showAllTickets: !ui.showAllTickets })),
  pick: async (id: string) => {
    const run = activeRun(await read($, boardAtom))
    if (run) await update($, uiAtom, ui => ({ ...ui, selection: togglePick(run, ui.selection ?? [], id) }))
  },
  clearPicks: () => update($, uiAtom, ui => ({ ...ui, selection: [] })),
  launchPicks: (isParallel: boolean) => launchPicks($, isParallel),
  launchGroup: (id: string) => launchGroup($, id),
  launchReady: (id: string) => launchReady($, id),
  launchGroupLinked: (id: string) => launchGroupLinked($, id),
  cancelGroupLinked: (id: string) => cancelGroupLinked($, id),
  reviewLinkedGroup: (id: string) => reviewLinkedGroup($, id),
  securityReview: (id: string) => securityReview($, id),
  launchBugLinked: () => launchBugLinked($),
  pickItem: (id: string) =>
    update($, uiAtom, ui => {
      const picked = ui.itemSelection ?? []
      return { ...ui, itemSelection: picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id] }
    }),
  pickAllItems: async () => {
    const run = activeRun(await read($, boardAtom))
    if (!run) return
    const all = pickableItems(currentPhase(run)).map(i => i.id)
    await update($, uiAtom, ui => ({ ...ui, itemSelection: all.every(id => (ui.itemSelection ?? []).includes(id)) ? [] : all }))
  },
  clearItemPicks: () => update($, uiAtom, ui => ({ ...ui, itemSelection: [] })),
  launchItemsLinked: () => launchItemsLinked($),
  recoverLinked: () => recoverLinked($),
  relaunchLinked: () => relaunchLinked($),
  cancelLinked: async () => {
    const now = await $.clock.now()
    await commit($, board => cancelLinked(board, now))
  },
  askDrop: (id: string) => update($, uiAtom, ui => ({ ...ui, confirmDrop: ui.confirmDrop === id ? undefined : id })),
  askNext: () => askNext($),
  launchParallel: (at?: number) => launchParallel($, at),
  launchParallelLinked: (at?: number) => launchParallelLinked($, at),
  toggleLog: () => update($, uiAtom, ui => ({ ...ui, showAllLog: !ui.showAllLog })),
  toggleItems: () => update($, uiAtom, ui => ({ ...ui, showAllItems: !ui.showAllItems })),
  toggleArtifacts: () => update($, uiAtom, ui => ({ ...ui, showAllArtifacts: !ui.showAllArtifacts })),
  toggleAgents: () => update($, uiAtom, ui => ({ ...ui, showAllAgents: !ui.showAllAgents })),
  toggleDecided: () => update($, uiAtom, ui => ({ ...ui, showDecided: !ui.showDecided })),
  toggleFound: () => update($, uiAtom, ui => ({ ...ui, showFound: !ui.showFound })),
  toggleHideFound: () => update($, uiAtom, ui => ({ ...ui, hideFound: !ui.hideFound })),
  validateReport: async () => {
    const now = await $.clock.now()
    await commit($, board => validateReport(board, now))
  },
  redoReport: async () => {
    let isFilled = false
    await quietly(async () => {
      isFilled = (await $.prompt.fill({ text: 'Rapport non validé : ', mode: 'replace' })).isFilled === true
    })
    await quietly(() => $.ui.toast(isFilled ? 'Dis à Claude ce qui ne va pas dans le rapport, puis Entrée' : 'Écris à Claude ce qui ne va pas dans le rapport'))
  },
  seeDecisions: async () => {
    const now = await $.clock.now()
    // Les choix relayés par les sessions liées sont relus avec les autres.
    const run = activeRun(await read($, boardAtom))
    const relay = run ? await readRelay($, run.id) : undefined
    await commit($, board => markDecisionsSeen(board, now, relay))
  },
  hideBand: async () => {
    await update($, uiAtom, ui => ({ ...ui, isBandHidden: true }))
    await syncStatus($, await read($, boardAtom))
    await quietly(() => $.ui.toast('Bandeau masqué : /flow show pour le réafficher'))
  },
  openPane: async () => {
    await update($, uiAtom, ui => ({ ...ui, isPaneDismissed: false }))
    await quietly(() => $.ui.open({ id: PANE, title: PANE_TITLE }))
  },
})

/** Un fichier de code du projet (pas la doc ni les notes de planification du workflow). */
const isCodeFile = (path: string, root: string): boolean => {
  const norm = path.replace(/\\/g, '/').toLowerCase()
  const base = normRoot(root).toLowerCase()
  if (base === '' || !norm.startsWith(`${base}/`)) return false
  const rel = norm.slice(base.length + 1)
  if (/\.(?:md|mdx|txt|rst)$/.test(rel)) return false
  if (/(?:^|\/)(?:\.scratch|docs\/adr|learning-records|lessons)\//.test(rel)) return false
  return true
}

// ─── Retard sur le distant ────────────────────────────────────────────────

/** git dans le dossier du projet, sans invite d'identifiants ; une erreur devient un code de sortie. */
const runGit = async ($: any, cwd: string, args: string[], timeoutMs = 20_000): Promise<{ exitCode: number; stdout: string }> => {
  try {
    const res = await $.process.run(['git', '--no-optional-locks', '-c', 'core.quotepath=off', ...args], {
      cwd,
      timeoutMs,
      env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    })
    return { exitCode: res.exitCode, stdout: String(res.stdout ?? '').trim() }
  } catch {
    return { exitCode: -1, stdout: '' }
  }
}

let isChecking = false

/**
 * Mesure le retard de la branche sur le distant : `git fetch` d'abord (sans toucher aux fichiers
 * ni aux branches locales), puis les commits de origin/main et de la branche suivie absents d'ici.
 * Toujours lancé hors d'un hook d'outil (minuterie) : le fetch peut prendre quelques secondes.
 */
const checkRemote = async ($: any, isFetching: boolean) => {
  if (isChecking) return
  isChecking = true
  try {
    const board = await read($, boardAtom)
    const root = board?.root ?? ''
    if (root === '') return
    const inside = await runGit($, root, ['rev-parse', '--is-inside-work-tree'], 5000)
    if (inside.exitCode !== 0 || inside.stdout !== 'true') return
    // Sans distant `origin`, il n'y a rien à mesurer : surtout pas un « À jour avec le distant ».
    const origin = await runGit($, root, ['remote', 'get-url', 'origin'], 5000)
    if (origin.exitCode !== 0 || origin.stdout === '') {
      await update($, syncAtom, s => ({ ...s, behindMain: null, behindUpstream: null, remoteKey: null, checkedAt: null, hasRemote: false, isGitHub: false }))
      return
    }
    const isGitHub = /github\.com[:/]/i.test(origin.stdout)
    if (isFetching) await runGit($, root, ['fetch', '--quiet', '--prune', 'origin'])
    const head = await runGit($, root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], 5000)
    let main = head.exitCode === 0 && head.stdout.startsWith('origin/') ? head.stdout.slice('origin/'.length) : ''
    if (main === '') {
      for (const name of ['main', 'master']) {
        if ((await runGit($, root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`], 5000)).exitCode === 0) {
          main = name
          break
        }
      }
    }
    const branch = (await runGit($, root, ['rev-parse', '--abbrev-ref', 'HEAD'], 5000)).stdout || null
    const count = async (range: string): Promise<number | null> => {
      const res = await runGit($, root, ['rev-list', '--count', range], 5000)
      const n = Number(res.stdout)
      return res.exitCode === 0 && Number.isFinite(n) ? n : null
    }
    const behindMain = main ? await count(`HEAD..origin/${main}`) : null
    const upstream = await runGit($, root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 5000)
    const behindUpstream = upstream.exitCode === 0 && upstream.stdout ? await count('HEAD..@{u}') : null
    const mainSha = main ? (await runGit($, root, ['rev-parse', `origin/${main}`], 5000)).stdout : ''
    const upSha = upstream.exitCode === 0 ? (await runGit($, root, ['rev-parse', '@{u}'], 5000)).stdout : ''
    const now = await $.clock.now()
    await update($, syncAtom, s => ({
      ...s,
      behindMain,
      behindUpstream,
      branch,
      main: main || null,
      isOnMain: branch !== null && branch === main,
      remoteKey: mainSha || upSha ? `${mainSha}|${upSha}` : null,
      checkedAt: now,
      hasRemote: true,
      isGitHub,
    }))
  } finally {
    isChecking = false
  }
}

/** Relance la mesure à la prochaine occasion, hors du hook en cours. */
const scheduleCheck = ($: any, isFetching: boolean) => {
  $.clock.after(0, () => void checkRemote($, isFetching))
}

/** /project:sync chargé : la mesure est refaite à la fin du tour, une fois le sync fait. */
let isRecheckAfterTurn = false

/**
 * La raison du refus quand le distant a avancé et que /project:sync n'a pas encore été demandé
 * pour ces commits-là, sinon null. Une fois par avancée du distant : si la personne s'en passe,
 * la même modification passe au second essai, et rien n'est redemandé avant la prochaine fusion.
 * La mesure vient de la dernière vérification (minuterie) : rien de lent ici.
 */
const syncGate = async ($: any, path: string): Promise<string | null> => {
  const sync = await read($, syncAtom)
  const advice = syncAdvice(sync)
  if (!advice || sync.remoteKey === null || sync.askedFor === sync.remoteKey) return null
  const board = await read($, boardAtom)
  if (!board || !isCodeFile(path, board.root)) return null
  const now = await $.clock.now()
  const commands = advice.commands.map(commandText).join(' puis ')
  await update($, syncAtom, s => ({ ...s, askedFor: s.remoteKey }))
  await commit($, b => {
    if (!activeRun(b)) return null
    const next = JSON.parse(JSON.stringify(b)) as Board
    const live = activeRun(next)!
    live.log = [{ at: now, glyph: '⟳', text: `${commands} demandé : ${advice.reason}`, tone: 'warn' as const }, ...live.log].slice(0, 80)
    live.updatedAt = now
    return { board: next, fx: { toasts: [], openPane: false, note: 'none' as const } }
  })
  return (
    `flow-board : le dépôt distant a avancé (${advice.reason}). Avant de modifier le code, demande à l'utilisateur ` +
    `de lancer ${commands} (commande réservée à l'utilisateur) et attends qu'il l'ait fait. ` +
    "S'il préfère s'en passer, refais simplement cette modification : elle passera."
  )
}

const readView = async ($: any): Promise<View> => {
  const board: Board | null = await read($, boardAtom)
  const sync: SyncState = await read($, syncAtom)
  return {
    board: board && sync.isGitHub === false ? { ...board, runs: board.runs.map(withoutPullRequest) } : board,
    live: await read($, liveAtom),
    ui: await read($, uiAtom),
    sync,
    now: await $.clock.now(),
    relay: await read($, relayAtom),
  }
}

/** Redessine pour faire avancer les durées affichées. */
const tick = async ($: any) => {
  ticks += 1
  const board = await read($, boardAtom)
  if (!board) {
    if (ticks % 5 === 0) await ensureBoard($)
    return
  }
  // Toutes les 5 s, les parcours des autres discussions du projet.
  if (ticks % 5 === 0) {
    await pull($)
    await pullRelay($, (await read($, boardAtom)) ?? board)
  }
  const run = activeRun(board)
  if (!run) return
  if (ticks % 300 === 0 && CODE_SKILLS.has(currentPhase(run).skill)) void checkRemote($, true)
  const live = await read($, liveAtom)
  // Durées vivantes : toutes les 5 s pendant le travail, toutes les 30 s au repos.
  const isBusy = live.mode === 'working' || run.agents.some(a => a.status === 'running')
  if (ticks % (isBusy ? 5 : 30) === 0) $.ui.invalidate('ui.render')
}

// `/flow` n'existe qu'après le démarrage du mod ; `/flow-board:flow`, déclaré par
// `commands/flow.md`, est connu dès le premier message. Les deux reçoivent la même réponse.
const runFlow = async ($: any, e: { args: string }) => {
  const arg = e.args.trim().toLowerCase()
  const now = await $.clock.now()
  const board = await ensureBoard($)
  // `rename <titre>` : le titre garde sa casse, d'où la lecture de `e.args` et non de `arg`.
  const renamed = /^rename(?:\s+([\s\S]*))?$/i.exec(e.args.trim())
  if (renamed) {
    const title = (renamed[1] ?? '').trim()
    if (!title) return { text: 'Usage : /flow rename <titre>' }
    const run = activeRun(board)
    if (!run) return { text: 'Aucun parcours en cours.' }
    const fx = await commit($, b => renameRun(b, run.id, title, now))
    return { text: fx ? `Parcours renommé : ${clip(title.replace(/\s+/g, ' '), 70)}` : 'Aucun parcours en cours.' }
  }
  if (arg === 'hide') {
    await update($, uiAtom, ui => ({ ...ui, isBandHidden: true }))
    await syncStatus($, board)
    return { text: 'Bandeau du parcours masqué (/flow show pour le réafficher).' }
  }
  if (arg === 'done') {
    const fx = await commit($, b => finishActive(b, now))
    return { text: fx ? 'Parcours clos.' : 'Aucun parcours en cours.' }
  }
  if (arg === 'pause') {
    const run = activeRun(board)
    const fx = await commit($, b => setAsideActive(b, now))
    return { text: fx && run ? `Parcours mis de côté : ${run.title} (Historique, « Reprendre », pour le rouvrir tel quel).` : 'Aucun parcours en cours.' }
  }
  if (arg === 'reset') {
    const run = activeRun(board)
    if (!run) return { text: 'Aucun parcours en cours.' }
    // On n'efface plus : le parcours abandonné part aux archives, d'où il peut revenir.
    await commit($, b => archiveRun(b, run.id, now))
    return { text: `Parcours archivé : ${run.title} (Historique, « Archivés », pour le rouvrir).` }
  }
  const tab: Tab = arg === 'history' ? 'history' : arg === 'activity' ? 'activity' : arg === 'commands' ? 'commands' : 'flow'
  await update($, uiAtom, ui => ({ ...ui, tab, isPaneDismissed: false, isBandHidden: arg === 'show' ? false : ui.isBandHidden }))
  await syncStatus($, board)
  await quietly(() => $.ui.open({ id: PANE, title: PANE_TITLE }))
  const run = activeRun(board)
  return { text: run ? summaryOf(run).replace(/^Dashboard: /, 'Parcours : ') : noActiveFrench(board ?? (await read($, boardAtom))) }
}

// `/flow` reste utilisable tapée en entier, mais sort du menu : `/flow-board:flow`, déjà là
// avant le premier message, y suffit et le doublon disparaît.
const hideFlow = async ($: any, e: any, next: any) => ({ ...(await next(e)), isHidden: true })

// ─── Hooks ────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Un enregistrement refusé ne doit pas empêcher la minuterie (durées, relecture du stockage).
    await quietly(() => $.tool.register({ name: 'flow', description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA }))
    await quietly(() => $.command.register({
      name: 'flow',
      description: 'Tableau de bord du workflow mattpocock : /flow [activity | history | commands | hide | show | pause | done | reset | rename <titre>]',
      argumentHint: '[activity|history|commands|hide|show|pause|done|reset|rename <titre>]',
    }))
    try {
      const map: Record<string, string> = {}
      for (const command of await $.command.list()) {
        const id = skillIdOf(command.name)
        if (id && command.name.startsWith(`${PLUGIN}:`)) map[id] = command.name
      }
      await update($, commandsAtom, () => map)
    } catch {
      // Liste indisponible : les boutons retombent sur `mattpocock-skills:<skill>`.
    }
    await ensureBoard($)
    // /implement-spec a besoin d'un dépôt git (worktrees, branche d'intégration) : le panneau ne le propose pas ailleurs.
    await quietly(async () => {
      const repo = await $.session.repo()
      await update($, syncAtom, s => ({ ...s, isRepo: repo !== null }))
    })
    $.clock.every(1000, () => void tick($))
    scheduleCheck($, true)
    return next(e)
  })

  // L'outil de Claude : toujours dans la liste (pas derrière ToolSearch) et sans demande d'accord.
  on('tool.describe', { tool: TOOL }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false }))
  on('tool.check', { tool: TOOL }, () => ({ decision: 'allow' as const }))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const now = await $.clock.now()
    if (!(await ensureBoard($))) return { result: 'Dashboard unavailable.' }
    let text = 'Dashboard unavailable.'
    const input = e as unknown as Readonly<Record<string, unknown>>
    // Avant une reprise, l'état d'ici rattrape ce que l'autre discussion a enregistré.
    if (typeof input.resume === 'string' && input.resume.trim() !== '') await pull($)
    const delegateTitle = typeof input.delegate === 'string' ? await mainRepoTitle($, input.delegate.trim()) : undefined
    // Un groupe rendu par sa session liée : les revues qu'elle a relayées valent les siennes.
    const returning = input.returned !== undefined ? activeRun(await read($, boardAtom)) : null
    const relay = returning ? await readRelay($, returning.id) : undefined
    for (let attempt = 0; attempt < 5; attempt++) {
      const { value, version } = await $.state.get(BOARD_REF)
      if (!value) break
      const out = applyReport(value, input, now, { hasPullRequests: (await read($, syncAtom)).isGitHub !== false, delegateTitle, relay })
      text = out.text
      if (out.board === value) break
      const written = await $.state.set(BOARD_REF, out.board, { ifVersion: version })
      if (written.isSet) {
        await afterChange($, out.fx, out.board)
        break
      }
    }
    if ((await read($, boardAtom))?.delegate) {
      if (typeof input.delegate === 'string') {
        // La session liée vient de se déclarer : son entrée de relais dit quel groupe elle fait.
        await relaySignal($, { kind: 'start', ...(typeof input.group === 'string' && input.group.trim() !== '' ? { group: input.group.trim() } : {}) })
      } else {
        // Ses `set`, ses choix faits sans la personne et sa note partent au relais, pas sur le parcours.
        const changes = reportedChanges(input)
        if (changes.length > 0) await relaySignal($, { kind: 'tickets', changes })
        const decided = reportedDecisions(input)
        if (decided.length > 0) await relaySignal($, { kind: 'decided', items: decided })
        if (typeof input.note === 'string' && input.note.trim() !== '') await relaySignal($, { kind: 'note', text: input.note.trim() })
      }
    }
    return { result: text }
  })

  // Corrélation : l'outil Skill porte l'agent et les arguments, `skill.prompt` non.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const entry = { skill: String(e.skill ?? ''), agentId: e.agentId, args: typeof e.args === 'string' ? e.args : undefined }
    pendingSkills.push(entry)
    try {
      return await next(e)
    } finally {
      pendingSkills = pendingSkills.filter(p => p !== entry)
    }
  })

  on('command.run', async ($, e, next) => {
    const id = e.command === 'flow' ? null : skillIdOf(e.command)
    if (id) lastCommand = { id, args: e.args, at: await $.clock.now() }
    return next(e)
  })

  // Un skill du plugin se charge : le parcours démarre, avance ou prend un détour, et Claude
  // reçoit, à la fin du texte du skill, les ids des étapes à signaler.
  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    const id = skillIdOf(e.skill)
    if (!id) return result
    const call = pendingSkills.find(p => p.skill === e.skill || skillIdOf(p.skill) === id)
    const isMain = call ? call.agentId === undefined : true
    const now = await $.clock.now()
    const args =
      call?.args ?? (lastCommand !== null && lastCommand.id === id && now - lastCommand.at < 60_000 ? lastCommand.args : undefined)
    if (id === 'project:sync' && isMain) isRecheckAfterTurn = true
    // Une session liée lance elle-même les revues de son groupe : le tableau de bord d'ici l'apprend par le relais.
    if ((await read($, boardAtom))?.delegate) {
      if (id === 'final-review') await relaySignal($, { kind: 'review' })
      if (id === 'security-review') await relaySignal($, { kind: 'security' })
      return result
    }
    const fx = await commit($, board => applySkill(board, e.skill, { now, isMain, args }))
    // Les revues du groupe et de sécurité ne changent pas de phase, mais leurs consignes comptent.
    if (!fx || (fx.note === 'none' && id !== 'final-review' && id !== 'security-review')) return result
    const run = activeRun(await read($, boardAtom))
    // Une phase qui touche au code commence : on regarde tout de suite si le distant a avancé.
    if (run && CODE_SKILLS.has(currentPhase(run).skill)) scheduleCheck($, true)
    // `/code-review` qui vient d'ouvrir (ou de relancer) une relecture de branche en reçoit la consigne.
    const noteId = id === 'final-review' && run && currentPhase(run).skill === 'branch-review' ? 'branch-review' : id
    return run ? { text: `${result.text}${coachingNote(noteId, run, await read($, syncAtom), await measureRepo($), (await read($, boardAtom))?.session)}` } : result
  })

  // Ce qui se passe pendant un parcours : sous-agents, fichiers, commandes, Asana, questions.
  on('tool.call', async ($, e, next) => {
    if (e.tool === TOOL || e.tool === 'Skill') return next(e)
    const board0: Board | null = await read($, boardAtom)
    if (board0?.delegate) return relayTool($, e, next)
    if (!activeRun(board0)) return next(e)

    // Avant de modifier le code : /project:sync, demandé une fois quand le distant a avancé.
    if ((e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'NotebookEdit') && e.agentId === undefined) {
      const path = String((e as { file_path?: unknown; notebook_path?: unknown }).file_path ?? (e as { notebook_path?: unknown }).notebook_path ?? '')
      const reason = await syncGate($, path)
      if (reason) return { deny: reason }
    }

    // Une session liée lancée pendant que des éléments ou des groupes lui sont confiés : son id est
    // gardé, et va au groupe que son titre nomme (« Groupe A · … »).
    if (e.tool === START_SESSION) {
      const ran = await next(e)
      if (ran.deny !== undefined || ran.isError === true) return ran
      const session = /\blocal_[A-Za-z0-9_-]+/.exec(JSON.stringify(ran.result ?? ran.text ?? ''))?.[0]
      if (session) {
        const now = await $.clock.now()
        const asked = e as { title?: unknown; name?: unknown }
        const title = `${String(asked.title ?? '')} ${String(asked.name ?? '')}`
        // Une session prise par un groupe n'est pas celle des éléments confiés.
        if (!(await commit($, board => linkGroupSession(board, title, session, now)))) await commit($, board => linkSession(board, session, now, title))
      }
      return ran
    }

    if (e.tool === 'Agent') {
      const key = e.tool_use_id
      const startedAt = await $.clock.now()
      const isBackground = e.run_in_background !== false
      agentCalls.add(key)
      await commit($, board =>
        applyAgentStart(board, { key, name: e.description, model: e.model, type: e.subagent_type, isBackground }, startedAt),
      )
      const ran = await Promise.resolve(next(e)).finally(() => agentCalls.delete(key))
      const failed = ran.deny !== undefined || ran.isError === true
      // Un lancement refusé (par la personne ou un hook) ou interrompu n'est pas un échec du sous-agent.
      const isCancelled = ran.deny !== undefined || (ran.isError === true && CANCELLED.test(String(ran.text ?? ran.result ?? '')))
      const record = failed ? undefined : (ran.result as { agentId?: string; resolvedModel?: string; status?: string } | undefined)
      // Un sous-agent rendu `completed` est fini, même demandé en fond : son SubagentStop est passé
      // avant que son id soit connu, et ne le marquera plus.
      const isFinished = record?.status === 'completed' || (record?.status === undefined && !isBackground)
      const endedAt = await $.clock.now()
      await commit($, board =>
        applyAgentEnd(board, key, { agentId: record?.agentId, model: record?.resolvedModel, isFailed: failed, isFinished, isCancelled }, endedAt),
      )
      return ran
    }

    if (e.tool === 'AskUserQuestion') {
      await setLive($, 'waiting', null)
      const ran = await next(e)
      await setLive($, 'working', null)
      const answeredAt = await $.clock.now()
      await commit($, board => applyUserAnswer(board, answeredAt))
      return ran
    }

    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    try {
      const now = await $.clock.now()
      const isOk = ran.isError !== true
      if (e.tool === 'Write' && isOk) {
        await commit($, board => applyFileChange(board, { path: e.file_path, content: e.content }, now))
      } else if (e.tool === 'Edit' && isOk) {
        await commit($, board => applyFileChange(board, { path: e.file_path, before: e.old_string, after: e.new_string }, now))
      } else if (e.tool === 'Bash' || e.tool === 'PowerShell') {
        // Après un fetch, pull, rebase ou merge (le travail de /project:sync), le retard est remesuré.
        if (/\bgit\s+(?:fetch|pull|rebase|merge)\b/.test(String(e.command ?? ''))) scheduleCheck($, false)
        const record = ran.result as { stdout?: unknown; backgroundTaskId?: unknown } | undefined
        if (typeof record?.backgroundTaskId !== 'string') {
          const out = typeof record?.stdout === 'string' ? record.stdout : typeof ran.text === 'string' ? ran.text : ''
          await commit($, board => applyCommand(board, String(e.command ?? ''), isOk, out, now))
          // Le CLI lance ses sessions liées par `claude --bg` : leur id va au groupe que leur titre nomme.
          for (const launched of backgroundLaunches(String(e.command ?? ''), out)) {
            if (!(await commit($, board => linkGroupSession(board, launched.title, launched.id, now)))) await commit($, board => linkSession(board, launched.id, now, launched.title))
          }
        }
      } else if (e.tool.endsWith('__update_tasks') && isOk) {
        await commit($, board => applyAsana(board, (e as unknown as { tasks?: unknown }).tasks, now))
      } else if (e.tool.endsWith('__create_tasks') && isOk) {
        // Les tâches créées en route : « Trouvé en route », hors du lot. `text` (ce que lit le
        // modèle) est toujours là depuis le cœur ; `result` a la forme propre à chaque outil.
        await commit($, board => applyCreatedTasks(board, (e as unknown as { tasks?: unknown }).tasks, ran.text ?? ran.result, now))
      }
    } catch {
      // Un signal mal lu ne doit jamais gêner l'outil.
    }
    return ran
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const now = await $.clock.now()
    await commit($, board => applySubagentStop(board, e.agent_id, now))
    return next(e)
  })

  // Le tour d'un sous-agent (`agentId`) ne rend pas la main à Claude : seul le fil principal compte.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await setLive($, 'working', null)
    await reconcileAgents($)
    return next(e)
  })

  // Fin d'un tour de la boucle principale : la main revient à la personne. La réponse dit
  // s'il reste des questions (grilling) ou si une revue vient de rendre.
  on('turn.complete', async ($, e, next) => {
    // Lu à l'entrée : un message en file peut ouvrir le tour suivant pendant ce traitement.
    const askedAt = submitAt
    const result = await next(e)
    // La fin du tour d'un sous-agent : sa réponse est rendue, il a fini.
    if (e.agentId !== undefined) {
      const ended = await $.clock.now()
      await commit($, board => applySubagentStop(board, e.agentId!, ended))
      return result
    }
    await reconcileAgents($)
    // Un message de la personne envoyé après la demande d'une session liée, et le tour fini sans la lancer : le panneau le dit.
    if (askedAt !== null) {
      const ended = await $.clock.now()
      await commit($, board => noteUnlaunched(board, askedAt, ended))
    }
    if (isRecheckAfterTurn) {
      isRecheckAfterTurn = false
      scheduleCheck($, false)
    }
    const now = await $.clock.now()
    let ask: string | null = null
    if (e.answer) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { value, version } = await $.state.get(BOARD_REF)
        if (!value) break
        const out = applyAnswer(value, e.answer, now)
        if (!out) break
        const written = await $.state.set(BOARD_REF, out.board, { ifVersion: version })
        if (written.isSet) {
          ask = out.ask
          scheduleSave($)
          break
        }
      }
    }
    await setLive($, 'waiting', ask)
    await suggestNext($, e.answer, ask)
    return result
  })

  // Pas de push en cours de parcours : la suggestion `/project:push` de git-board s'écarte tant
  // qu'un parcours est actif ; elle revient hors parcours.
  on('prompt.suggest', async ($, e, next) => {
    if (e.origin.kind === 'plugin' && e.origin.name === GIT_BOARD && activeRun(await read($, boardAtom))) return { isShown: false }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    if (kind === 'composer' || kind === 'bridge' || kind === 'sdk') submitAt = await $.clock.now()
    if ((kind === 'composer' || kind === 'bridge' || kind === 'sdk') && !e.text.trimStart().startsWith('/')) {
      const now = await $.clock.now()
      await commit($, board => applyUserAnswer(board, now))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    saveTimer?.cancel()
    // Une vraie fin (pas un /clear) laisse le parcours en pause pour la prochaine discussion.
    if (e.reason !== 'clear') {
      await quietly(() => relaySignal($, { kind: 'end' }))
      const now = await $.clock.now()
      const { value, version } = await $.state.get(BOARD_REF)
      const parked = value ? parkActive(value, now) : null
      if (parked) await $.state.set(BOARD_REF, parked.board, { ifVersion: version })
    }
    await saveNow($)
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, uiAtom, ui => ({ ...ui, isPaneDismissed: true }))
    return next(e)
  })

  on('command.run', { command: 'flow' }, runFlow)
  on('command.describe', { command: 'flow' }, hideFlow)
  on('command.run', { command: STATIC_FLOW }, runFlow)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await readView($)
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.props.bodyColumns)
    return drawPane(kit, view, actionsFor($)) as any
  })

  // Les appels de l'outil `flow` sont une tenue de compte : une ligne grisée dit ce qu'ils ont
  // enregistré, à la place du JSON de l'appel et de sa réponse. Une erreur garde le dessin du moteur.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== TOOL || e.props.isErrored || e.props.isInterrupted) return next(e)
    const { Text } = $.ui.resolve(e) as unknown as Record<string, any>
    if (typeof Text !== 'function') return next(e)
    return (
      <Text dimColor={true} wrap="truncate-end">
        {flowCallLabel(e.props.input)}
      </Text>
    )
  })
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== TOOL || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e) as unknown as Record<string, any>
    // Une boîte vide : la ligne de l'appel dit déjà tout.
    return typeof Box === 'function' ? <Box /> : next(e)
  })

  // Le bandeau se compose avec celui du dessous (la météo du contexte de mods-mathis…) :
  // le leur reste au-dessus, le parcours dessous. Sans parcours actif, un bandeau d'accueil.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const view = await readView($)
    if (view.ui.isBandHidden) return next(e)
    const below = await next(e)
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.props.bodyColumns)
    const draw = view.board && activeRun(view.board) ? drawBand : drawWelcomeBand
    const own = draw(kit, view, actionsFor($)) as any
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
