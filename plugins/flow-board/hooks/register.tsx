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

import type { AgentLane, AgentMark, AgentSegment, AgentType, Board, FlowPhase, Relay, Run, SessionRegistry, SyncState, Tab } from '../types'
import {
  CODE_SKILLS,
  GROUP_REVIEWER,
  NO_GIT_COPIES,
  NO_GIT_GROUP_FIXED_POINT,
  NO_GIT_TICKET_FIXED_POINT,
  PLUGIN,
  INSTRUCTIONS_IN_PROMPT,
  REVIEWER_BRIEF,
  REVIEW_RULE,
  SECURITY_CRITERIA,
  SENSITIVE_AREAS,
  SENSITIVE_NO_FIX,
  SINGLE_TICKET_GROUP,
  SKILLS,
  TICKET_FIXED_POINT,
  commandLineOf,
  hintOf,
  reviewInstructions,
  skillIdOf,
  slashOf,
} from './catalog.ts'
import {
  activeDetour,
  activeRun,
  applyAgentStart,
  applyAnswer,
  applyAsana,
  applyRelay,
  asanaChanges,
  localTicketChange,
  ticketFilesIn,
  askCloseLinkedGroup,
  reloadText,
  restoreDelegate,
  applyCommand,
  applyCreatedTasks,
  markDecisionsSeen,
  reportFacts,
  validateReport,
  applyFileChange,
  applyReport,
  applySkill,
  stripRunAgents,
  applyAgentActivity,
  applyUserAnswer,
  backgroundLaunches,
  commandSignals,
  reportedReport,
  commandText,
  countTickets,
  currentPhase,
  decidedFileText,
  isBugPass,
  relayedReportKeys,
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
  commandArgsOf,
} from './model.ts'
import type { LiveAgent } from './model.ts'
import { delegatedTitle } from './model.ts'
import {
  emptyRegistry,
  endCall as endRegistryCall,
  failedAgentsOf,
  joinRegistry,
  noteCarried,
  mergeRegistry,
  parsePart,
  parseOwnRegistry,
  registrySlug,
  PARTS_MAX,
  splitRegistry,
  noteLaunch,
  rowsFromRun,
  reconcileAgents as reconcileRegistry,
  spawnAgent as spawnRegistryAgent,
  startCall as startRegistryCall,
  stopAgent as stopRegistryAgent,
  runningOf,
  withHeader,
  MAIN,
  addMark as addRegistryMark,
  closeSegment,
  closeToolCall,
  closeOpen,
  openSegment,
  addLines,
  addUsage,
  linesOf,
  type StepUsage,
} from './registry.ts'
import type { LinkedLaunch, RegistryPart } from '../types'
import { isSameProject, isSureLink, linkedSessions, type JobInfo, type LinkedSession } from './linked.ts'
import { catchUp, drainWithin, isTranscriptPath, laneFromTranscript, metaFromText, readArgv, SUBAGENT_FILE, subagentsDirOf, type TranscriptAgent } from './transcript.ts'
import { agentTraces, applyTraces, applyTracesToRebuilt, cleanTrace, eraseWith, isClosedSession, removeArgv, type Trace } from './erase.ts'
import { agentsOfRun, applyRebuilt, attachCarried, carriedRunAt, cleanRebuilt, clipLane, historyEntries, runFileId, runRegistry, runsCarriedBy, runWindow, unionRebuilt, withCarriedRuns, withRun, type HistoryEntry, type Rebuilt } from './history.ts'
import { shortArg, toolFamily } from './timeline.ts'
import { pricesFromCcusage, type UnitPrices } from './cost.ts'
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
  '/code-review high --fix, without --fix for a group with a sensitive ticket, in a reviewer subagent that applies its fixes, with the security review in the same message). With the review of a finished group, judge whether a security review is worth it ' +
  'and send it in "security"; when it is, launch it yourself, in this discussion as in a linked session: a read-only reviewer subagent ' +
  'limited to the group\'s diff (never /security-review), then send its findings; the user decides on their fixes. ' +
  'A plugin reload (/reload-plugins) never requires sending tickets, groups or steps again: the dashboard keeps its state, and its first answer after a reload says what it found. ' +
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
          sensitive: { type: 'boolean', description: `Its line "Zone sensible": true when it touches a sensitive area (${SENSITIVE_AREAS})` },
          logic: { type: 'boolean', description: 'Its line "Logique": false for a visual asset or a document, which has no logic to review' },
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
        'Security review of a finished group (or of the whole run when it has no groups). In the same message as the review of a finished group (without groups: once the review of the run is done): {"group", "advised", "why"}, your judgment. After the reviewer subagent you launched: {"group", "findings", "fixed"}',
      properties: {
        group: { type: 'string', description: 'Group id (A, B...); omitted = the last finished group, or the whole run when it has no groups' },
        advised: { type: 'boolean', description: 'true when the changes touch authentication, permissions or access rules, user input reaching a query, a path or HTML, secrets or tokens, network or file access, uploads or dependencies' },
        why: { type: 'string', description: "Why, short, in the user's language" },
        findings: { type: 'number', description: 'Kept findings of the security review (confidence 8/10 or more, high or medium severity), not its "to watch" list' },
        fixed: { type: 'number', description: 'How many of them were fixed' },
      },
    },
    decided: {
      type: 'array',
      description: `Choices you made without the user asking for or approving them, to be reviewed; each sent once. Never a choice that touches a sensitive area (${SENSITIVE_AREAS}): ask the user instead`,
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
        'Only when a linked session\'s brief gives it: id of the workflow this discussion works for, sent first, with "group" and "main".The workflow stays in the main discussion and nothing is recorded on it from here: your progress is relayed to its dashboard on its own (Asana ticket statuses, commits, tests). Afterwards, only "set" (a ticket status that changed without an Asana update or an edit of a local ticket file), "decided" (sent at once, shown on the main dashboard for review), "report" (your final report) and "note" are accepted',
    },
    group: {
      type: 'string',
      description: 'With "delegate": the id of the group this linked session works on (A, B...), as the brief gives it',
    },
    report: {
      type: 'string',
      description:
        'Only in a linked session: your whole final report, also sent to the main discussion with SendMessage. It is kept in the run\'s relay file, which the main discussion rereads if the message gets lost (renamed or restarted discussion)',
    },
    main: {
      type: 'string',
      description: 'With "delegate": the main discussion as the brief names it, its "[ref]" (or "<name> [ref]"); each answer then says how to reach it',
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
/** Le mod vient d'être rechargé (le board était déjà là au démarrage) : la réponse suivante de l'outil le dit. */
let isReloadToAnnounce = false
/** La session précédente a fini par un /clear : le board reste en mémoire sans que le mod ait été rechargé. */
let isAfterClear = false
/** La délégation écrite pour cette session (JSON), pour ne pas réécrire `$.store` à chaque appel ; aucune au départ. */
let keptDelegate = 'null'

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

/** Le fichier de méthode de la revue de sécurité (ticket 13), à la racine du mod. */
const SECURITY_METHOD_FILE = 'reference/revue-securite.md'
/** Son chemin, tiré de `$.plugin.root` au premier hook qui construit une consigne de sécurité. */
let securityMethod = SECURITY_METHOD_FILE
const noteSecurityMethod = ($: any) => {
  try {
    const root = String($.plugin.root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
    if (root !== '') securityMethod = `${root}/${SECURITY_METHOD_FILE}`
  } catch {
    // Racine inconnue : le chemin relatif au mod.
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
 * Un parcours absent du board d'ici (racine `here`), lu dans celui du dépôt principal : une session
 * lancée dans un worktree a sa propre racine, donc son propre fichier. Lecture seule (pas de
 * versement de l'ancien stockage) ; rien quand la session n'est pas dans un worktree.
 */
const mainRepoRun = async ($: any, runId: string, here: string): Promise<Run | undefined> => {
  if (runId === '') return undefined
  let root = ''
  await quietly(async () => {
    root = String((await $.session.repo())?.root ?? '')
  })
  if (root === '' || normRoot(root).toLowerCase() === normRoot(here).toLowerCase()) return undefined
  const shared = await readShared($, root)
  const stored = shared.ok ? shared.value : await legacyGet($, root)
  return isBoard(stored) ? stored.runs.find(r => r.id === runId) : undefined
}

/** Le titre d'un parcours absent du board d'ici, lu dans celui du dépôt principal (`mainRepoRun`). */
const mainRepoTitle = async ($: any, runId: string): Promise<string | undefined> => {
  const board = await read($, boardAtom)
  if (!board || board.runs.some(r => r.id === runId)) return undefined
  return (await mainRepoRun($, runId, board.root))?.title
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

const runSlug = (runId: string): string => runId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const relayPath = ($: any, runId: string): string | null => {
  const home = claudeHome($)
  const slug = runSlug(runId)
  return home && slug ? `${home}/flow-board/relais/${slug}.json` : null
}

// ─── Fichier des choix déjà déclarés ──────────────────────────────────────
//
// Un fichier Markdown par parcours, à côté du relais, écrit par la seule discussion principale
// d'après le parcours et le relais : les briefs et les consignes de revue citent son chemin au
// lieu de recopier la liste des choix, qui se périmait d'une consigne à l'autre.

const decidedPath = ($: any, runId: string): string | null => {
  const home = claudeHome($)
  const slug = runSlug(runId)
  return home && slug ? `${home}/flow-board/choix/${slug}.md` : null
}

/** Le dernier texte écrit par fichier : rien n'est réécrit quand la liste n'a pas bougé. */
const decidedWritten = new Map<string, string>()

/**
 * Réécrit le fichier des choix du parcours actif, s'il a changé. Rend son chemin quand il est à
 * jour, null sinon (pas de parcours, fichier hors d'atteinte) : une consigne ne cite alors pas le chemin.
 */
const writeDecidedFile = async ($: any, board: Board | null): Promise<string | null> => {
  const run = board ? activeRun(board) : null
  const path = run ? decidedPath($, run.id) : null
  if (!run || !path) return null
  const relay: Relay | null = await read($, relayAtom)
  const text = decidedFileText(run, relay?.run === run.id ? relay : null)
  if (decidedWritten.get(path) === text) return path
  try {
    await $.fs.write(path, text)
    decidedWritten.set(path, text)
    return path
  } catch {
    // Fichier hors d'atteinte : les consignes donnent alors la liste des choix.
    return null
  }
}

/** Les comptes rendus du relais déjà cités en entier dans cette discussion (perdu au redémarrage : ils le sont de nouveau). */
const seenReports = new Set<string>()

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
  // Un parcours effacé (S23) : la session liée le lâche, son relais ne revient pas.
  await quietly(() => readTraces($))
  if (erasedRuns.has(runId)) return
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
      if (isOk) await relayTicketFiles($, ticketFilesIn(String(e.command ?? '')))
    } else if (String(e.tool).endsWith('__update_tasks') && isOk) {
      await relaySignal($, { kind: 'tickets', changes: asanaChanges(e.tasks) })
    } else if ((e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'MultiEdit') && isOk && typeof e.file_path === 'string') {
      // Write porte le texte entier : pas de relecture du fichier.
      await relayTicketFiles($, [e.file_path], e.tool === 'Write' && typeof e.content === 'string' ? e.content : undefined)
    }
  } catch {
    // Un signal mal lu ne doit jamais gêner l'outil.
  }
  return ran
}

/**
 * Dans une session liée, un tracker en fichiers locaux (`…/issues/<NN>-<nom>.md`) n'a pas d'appel
 * Asana à relayer : le statut part au relais quand un outil a touché le fichier d'un ticket, relu
 * tel qu'il est après l'écriture (Edit, Write, ou une commande shell qui le nomme). `written` : le
 * texte entier qu'un Write vient d'écrire, quand il y en a un.
 */
const relayTicketFiles = async ($: any, paths: string[], written?: string) => {
  const changes = []
  for (const path of paths) {
    if (!/(?:^|[\\/])issues[\\/]\d+-[^\\/]+\.md$/.test(path)) continue
    const text = written ?? (await $.fs.read(path).catch(() => null))
    const change = typeof text === 'string' ? localTicketChange(path, text) : null
    if (change) changes.push(change)
  }
  if (changes.length > 0) await relaySignal($, { kind: 'tickets', changes })
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
  await writeDecidedFile($, board)
  $.ui.invalidate('ui.render')
}

/** Le board du projet de la session : celui de l'état, sinon celui du stockage, sinon un neuf. */
const ensureBoard = async ($: any): Promise<Board | null> => {
  const current = await read($, boardAtom)
  const root = await sessionRoot($)
  if (current && (root === '' || normRoot(current.root) === normRoot(root))) return current
  const stored = await loadStored($, root)
  const session = await sessionId($)
  const loaded =
    isBoard(stored) && normRoot(stored.root) === normRoot(root)
      ? detachOnLoad(stored, await $.clock.now(), session)
      : { ...emptyBoard(root, root ? projectName(root) : 'projet'), session, deleted: [] }
  // Une session liée retrouve sa délégation, propre à elle et jamais dans le stockage partagé.
  let kept: unknown
  await quietly(async () => {
    kept = await $.store.get(delegateKey(session))
  })
  // Dans un worktree, le parcours délégué vit dans le board du dépôt principal : fini là-bas, la délégation ne revient pas.
  const keptRun = kept !== null && typeof kept === 'object' ? (kept as { run?: unknown }).run : undefined
  if (typeof keptRun === 'string' && !loaded.runs.some(r => r.id === keptRun) && (await mainRepoRun($, keptRun, loaded.root))?.status === 'done') kept = null
  const board = restoreDelegate(loaded, kept, await $.clock.now())
  keptDelegate = JSON.stringify(board.delegate ?? null)
  await update($, boardAtom, () => board)
  return board
}

const delegateKey = (session: string): string => `delegate:${session}`

/** Garde la délégation de cette session (ou son absence) pour la retrouver après un rechargement du mod. */
const keepDelegate = async ($: any) => {
  const board: Board | null = await read($, boardAtom)
  const value = JSON.stringify(board?.delegate ?? null)
  if (!board || value === keptDelegate) return
  await quietly(async () => {
    await $.store.set(delegateKey(await sessionId($)), board.delegate ?? null)
    keptDelegate = value
  })
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
  await writeDecidedFile($, merged)
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
    // Les appels en vol tels qu'au moment de la liste : un appel rendu pendant l'attente de la file
    // n'en sort pas avant que son retour soit passé.
    const inFlight = new Set(agentCalls)
    const now = await $.clock.now()
    const own = new Set(await read($, ownAtom))
    await quietly(() => commitRegistry($, reg => reconcileRegistry(reg, live, inFlight, own, now)))
  } catch {
    // Pas de liste (version de Claude Code sans `agent.list`) : on garde les lignes telles quelles.
  }
}

// ─── Registre des agents de la session ────────────────────────────────────
//
// Un fichier par session, `~/.claude/flow-board/agents/<session>.json` (`$.store` en secours),
// écrit par cette session seule (Q7) et lu par l'onglet Agents. Pendant un parcours comme sans.

const REGISTRY_REF = { plugin: 'flow-board', key: 'agents' } as const
const registryAtom = atom(REGISTRY_REF, null)
/**
 * Les clés des sous-agents que ce processus a vus partir : les seuls que la liste du moteur peut
 * clore (S9). Dans l'état de la session, qui survit à /reload-plugins ; jamais sur le disque.
 */
const ownAtom = atom({ plugin: 'flow-board', key: 'agentsOwn' } as const, [] as string[])
/**
 * Le suivi en défaut, que l'onglet dit (S11, R2) : `true`, une écriture du registre a été refusée
 * (fichier trop gros, disque) ; `'lost'`, un changement n'a pas pu s'appliquer à l'état.
 */
const registryAlertAtom = atom({ plugin: 'flow-board', key: 'agentsAlert' } as const, false as boolean | 'lost')
const registryKey = (session: string, part = 0): string => (part === 0 ? `agents:${session}` : `agents:${session}:${part}`)

/** Le dossier du registre, `~/.claude/flow-board/agents` ; null quand le dossier de Claude ne se déduit pas. */
const registryDir = ($: any): string | null => {
  const home = claudeHome($)
  return home ? `${home}/flow-board/agents` : null
}

/** Le fichier d'un morceau du registre d'une session (R1) : `<session>.json`, puis `<session>.1.json`… */
const registryPath = ($: any, session: string, part = 0): string | null => {
  const dir = registryDir($)
  const slug = registrySlug(session)
  return dir && slug ? `${dir}/${slug}${part === 0 ? '' : `.${part}`}.json` : null
}

let registrySaveTimer: { cancel: () => void } | null = null

type ReadPiece = { ok: boolean; value: unknown; isAbsent: boolean }

/**
 * Un morceau du registre tel qu'il est enregistré : le fichier s'il existe, sinon `$.store`.
 * `ok` faux : la relecture a échoué (fichier occupé, droits). Un fichier absent dont l'ancien
 * stockage répond par une erreur est absent, pas en erreur (R3) : il se crée.
 */
const readPiece = async ($: any, session: string, part: number): Promise<ReadPiece> => {
  const path = registryPath($, session, part)
  let isThere = false
  let isKnown = path === null
  if (path) {
    try {
      isThere = await $.fs.exists(path)
      isKnown = true
    } catch {
      // Dossier hors d'atteinte : l'ancien stockage prend le relais.
    }
    if (isThere) {
      try {
        return { ok: true, value: String(await $.fs.read(path)), isAbsent: false }
      } catch {
        return { ok: false, value: null, isAbsent: false }
      }
    }
  }
  // Sans fichier, le registre a pu être écrit dans `$.store` (écriture du fichier refusée).
  try {
    const value = await $.store.get(registryKey(session, part))
    return { ok: true, value: value ?? null, isAbsent: value === undefined || value === null }
  } catch {
    return { ok: isKnown, value: null, isAbsent: isKnown }
  }
}

/**
 * `count` : le nombre de morceaux trouvés, que la prochaine écriture ne descend pas (R1) ;
 * `isWhole` : l'en-tête s'est lu (sinon `value` ne tient que des morceaux, le repli de S8).
 */
type ReadRegistry = { ok: boolean; value: SessionRegistry | null; placed: Map<string, number>; count: number; isWhole: boolean; isBroken?: boolean }

/**
 * Le registre enregistré de la session, morceaux réunis (R1). `ok` faux : une relecture a échoué
 * (fichier occupé, droits), à ne pas confondre avec un contenu illisible, qui rend `value: null`
 * (S8 : il sera réécrit) ou saute le morceau. Au-delà du nombre que dit l'en-tête, les morceaux
 * qui existent se lisent aussi : un morceau né d'une écriture coupée avant l'en-tête, qui l'aurait
 * compté, garde ce qui y est monté.
 */
const readRegistry = async ($: any, session: string): Promise<ReadRegistry> => {
  const failed: ReadRegistry = { ok: false, value: null, placed: new Map(), count: 1, isWhole: false }
  const first = await readPiece($, session, 0)
  if (!first.ok) return failed
  const head = parseOwnRegistry(first.value, session)
  const parts: (RegistryPart | null)[] = []
  for (let i = 1; i < PARTS_MAX; i++) {
    const piece = await readPiece($, session, i)
    if (!piece.ok) return failed
    if (piece.isAbsent && i >= (head?.parts ?? 1)) break
    const part = parsePart(piece.value)
    parts.push(part?.part === i ? part : null)
  }
  const count = parts.length + 1
  // Un en-tête là mais illisible (écriture coupée) : sa session le reconstruira depuis son transcript (ticket 08).
  const isBroken = head === null && !first.isAbsent
  // En-tête illisible (S8) : il sera réécrit, mais les morceaux lisibles comptent déjà.
  const base = head ?? (parts.some(p => p !== null) ? emptyRegistry(session, '', 0) : null)
  if (!base) return { ok: true, value: null, placed: new Map(), count, isWhole: false, isBroken }
  const joined = joinRegistry(base, parts)
  return { ok: true, value: joined.reg, placed: joined.placed, count, isWhole: head !== null && parts.every(p => p !== null), isBroken }
}

/**
 * Écrit un morceau : le fichier, sinon `$.store` ; faux quand les deux le refusent. Un morceau
 * après le premier ne se replie pas dans `$.store` quand son fichier existe ailleurs : la lecture
 * prendrait l'ancien fichier, et ce qui y est monté disparaîtrait.
 */
const writePiece = async ($: any, session: string, part: number, value: SessionRegistry | RegistryPart): Promise<boolean> => {
  const path = registryPath($, session, part)
  if (path) {
    try {
      await $.fs.write(path, JSON.stringify(value))
      await lockRegistryDir($)
      return true
    } catch {
      // Repli sur `$.store`, pour le premier morceau seulement.
      if (part > 0) return false
    }
  }
  try {
    await $.store.set(registryKey(session, part), value)
    return true
  } catch {
    return false
  }
}

/**
 * Écrit le registre en morceaux (R1), du dernier au premier : une unité qui monte d'un morceau
 * est en double un instant plutôt que perdue. Faux quand un morceau est refusé partout.
 */
const writeRegistry = async ($: any, reg: SessionRegistry, placed: ReadonlyMap<string, number>, minParts: number): Promise<boolean> => {
  const { head, parts } = splitRegistry(reg, placed, undefined, Math.max(minParts, reg.parts ?? 1))
  // Un morceau refusé arrête tout : ceux d'avant gardent ce qui serait monté dans le refusé.
  for (const part of [...parts].reverse()) if (!(await writePiece($, reg.session, part.part, part))) return false
  return writePiece($, reg.session, 0, head)
}

/**
 * Le dossier du registre fermé aux autres comptes une fois par processus (F2) ; rien sous Windows
 * ni sans commande. Noté fait une fois réussi seulement (F6) : un échec se retente à l'écriture suivante.
 */
let isRegistryLocked = false
let isRegistryLocking = false
const lockRegistryDir = async ($: any) => {
  if (isRegistryLocked || isRegistryLocking) return
  const dir = registryDir($)
  if (!dir || /^[a-z]:/i.test(dir)) {
    isRegistryLocked = true
    return
  }
  isRegistryLocking = true
  try {
    isRegistryLocked = (await $.process.run(['chmod', '700', dir], { timeoutMs: 10_000 })).exitCode === 0
  } catch {
    // Commande absente ou refusée : retentée à l'écriture suivante.
  } finally {
    isRegistryLocking = false
  }
}

/** Le registre de cette session : celui de l'état, sinon celui du fichier, sinon un neuf. */
const ensureRegistry = async ($: any): Promise<SessionRegistry> => {
  const current: SessionRegistry | null = await read($, registryAtom)
  if (current) return current
  // L'id lu à l'instant : après un /clear, la discussion suivante a le sien, donc son propre fichier.
  let session = ''
  await quietly(async () => {
    const id = await $.session.id()
    if (typeof id === 'string') session = id
  })
  if (session === '') session = await sessionId($)
  const now = await $.clock.now()
  const got = await readRegistry($, session)
  if (got.isBroken) needsRebuild = true
  const read0 = got.value
  // Un en-tête illisible relu par ses seuls morceaux n'a pas de racine : celle de la session.
  const loaded = read0 ? (read0.root === '' ? { ...read0, root: await sessionRoot($) } : read0) : emptyRegistry(session, await sessionRoot($), now)
  await update($, registryAtom, reg => reg ?? loaded)
  return (await read($, registryAtom)) ?? loaded
}

/**
 * Toutes les écritures de l'état du registre passent par cette file, une à la fois (R2) : les hooks
 * d'outils, de requêtes et de fins ne se disputent plus la même version. Une tâche de la file
 * n'attend jamais une autre tâche de la file.
 */
let registryQueue: Promise<unknown> = Promise.resolve()
const inRegistryQueue = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = registryQueue.then(job, job)
  registryQueue = run.catch(() => undefined)
  return run
}

/**
 * Applique une transition pure au registre, par la file (R2), puis l'enregistre bientôt
 * (`isSaved` faux : un changement venu du disque, déjà enregistré). Un changement qui ne
 * s'applique toujours pas se dit dans l'onglet au lieu de se perdre en silence.
 */
const commitRegistry = ($: any, change: (reg: SessionRegistry) => SessionRegistry | null, isSaved = true): Promise<void> =>
  inRegistryQueue(async () => {
    await ensureRegistry($)
    for (let attempt = 0; attempt < 5; attempt++) {
      const { value, version } = await $.state.get(REGISTRY_REF)
      if (!value) return
      const next = change(value)
      if (!next) return
      if ((await $.state.set(REGISTRY_REF, next, { ifVersion: version })).isSet) {
        if (isSaved) scheduleRegistrySave($)
        return
      }
    }
    await update($, registryAlertAtom, alert => alert || 'lost')
  })

/** Ce processus a vu partir ce sous-agent. */
const ownAgent = ($: any, key: string) => update($, ownAtom, own => (own.includes(key) ? own : [...own, key]))

/** Sous la charge de la frise, l'attente d'une écriture ne dépasse pas ce délai. */
const REGISTRY_SAVE_MAX_MS = 5_000
/** L'échéance posée au premier changement en attente, jamais repoussée. */
let registryDueTimer: { cancel: () => void } | null = null

/**
 * Au rythme des parcours : 600 ms après le dernier changement. Les `turn.step` et les appels
 * d'outil des sous-agents en parallèle peuvent se suivre sans répit : l'échéance garantit une
 * écriture au plus REGISTRY_SAVE_MAX_MS après le premier changement en attente.
 */
const scheduleRegistrySave = ($: any) => {
  registrySaveTimer?.cancel()
  const soon: { cancel: () => void } = $.clock.after(600, () => {
    if (registrySaveTimer === soon) void saveRegistryNow($)
  })
  registrySaveTimer = soon
  if (registryDueTimer) return
  const due: { cancel: () => void } = $.clock.after(REGISTRY_SAVE_MAX_MS, () => {
    if (registryDueTimer === due) void saveRegistryNow($)
  })
  registryDueTimer = due
}

/**
 * Relit le fichier, fusionne (S7 : un autre processus de la même session a pu l'écrire), écrit.
 * Un contenu illisible n'apporte rien et se trouve réécrit (S8) ; une relecture en erreur
 * reporte l'écriture au prochain changement (S10). Une écriture refusée se dit une fois (S11).
 * Ce que le fichier apportait rejoint l'état par la file (R2), sans rien écraser de ce qui a
 * changé entre-temps. Une seule écriture à la fois : demandée pendant qu'une autre tourne, elle
 * suit celle-ci.
 */
let registrySaving: Promise<void> | null = null
let isRegistrySaveAgain = false
const saveRegistryNow = async ($: any): Promise<void> => {
  // L'une des deux minuteries a tiré (ou un /clear) : l'autre n'a plus lieu d'être. Oubliée sans
  // être annulée : annuler une minuterie depuis le rappel d'une autre fait attendre l'horloge des
  // tests une seconde de temps réel par écriture (le test instable du groupe B) ; arrivée à son
  // heure, elle voit qu'elle n'est plus la bonne et ne fait rien.
  registrySaveTimer = null
  registryDueTimer = null
  if (registrySaving) {
    isRegistrySaveAgain = true
    return registrySaving
  }
  registrySaving = (async () => {
    do {
      isRegistrySaveAgain = false
      await saveRegistryOnce($)
    } while (isRegistrySaveAgain)
  })().finally(() => {
    registrySaving = null
  })
  return registrySaving
}

const saveRegistryOnce = async ($: any) => {
  const { value } = await $.state.get(REGISTRY_REF)
  if (!value) return
  const stored = await readRegistry($, value.session)
  if (!stored.ok) return
  const board: Board | null = await read($, boardAtom)
  const patch = {
    // Le titre de la discussion d'abord (hooks classiques), sinon celui du parcours qu'elle porte ou sert.
    title: value.title ?? (board?.delegate ? delegatedTitle(board) : activeRun(board)?.title),
    // Un parcours effacé n'est plus déclaré (S23).
    run: board?.delegate?.run !== undefined && !erasedRuns.has(board.delegate.run) ? board.delegate.run : undefined,
    group: board?.delegate?.run !== undefined && !erasedRuns.has(board.delegate.run) ? board.delegate.group : undefined,
  }
  // S28 : le parcours actif ici et ceux dont elle porte un ticket « en cours », notés dans l'en-tête ;
  // S31 : avec la date de cette écriture, la dernière où elle les portait.
  const carriedNow = board && !board.delegate ? board.runs.filter(r => (r.id === board.activeId && r.status === 'active') || r.tickets.some(t => t.by === value.session)).map(r => r.id).filter(id => !erasedRuns.has(id)) : []
  const noted = await $.clock.now()
  const titled = withHeader(value, patch) ?? value
  const header = noteCarried(titled, carriedNow, noted) ?? (titled === value ? null : titled)
  // S6 : les traces relues avant chaque écriture ; ce qu'elles couvrent sort du fichier et de l'état.
  const traces = await readTraces($)
  const joined = mergeRegistry(header ?? value, stored.value)
  // Les traces d'abord (celle du parcours couvre la session liée qui le déclare), puis le parcours
  // effacé quitte l'en-tête : la fusion, qui garde l'en-tête déjà écrit, ne le retirerait jamais.
  const merged = withoutErasedRun(applyTraces(joined, traces) ?? joined)
  const isWritten = await writeRegistry($, merged, stored.placed, stored.count)
  if (!isWritten && (await read($, registryAlertAtom)) !== true) {
    await update($, registryAlertAtom, () => true)
    await quietly(() => $.ui.toast('Registre des agents : écriture refusée, la suite n’est plus enregistrée'))
  }
  if (merged !== value) await quietly(() => commitRegistry($, reg => {
    const titledReg = withHeader(reg, patch) ?? reg
    const joined = mergeRegistry(noteCarried(titledReg, carriedNow, noted) ?? titledReg, merged)
    const next = withoutErasedRun(applyTraces(joined, traces) ?? joined)
    return next === reg ? null : next
  }, false))
}

/** Le registre sans le parcours effacé qu'il déclarait (S23), ni son groupe ; tel quel sinon. */
const withoutErasedRun = (reg: SessionRegistry): SessionRegistry => {
  if (reg.run === undefined || !erasedRuns.has(reg.run)) return reg
  const next = { ...reg }
  delete next.run
  delete next.group
  return next
}

// ─── Sessions liées de l'onglet Agents ────────────────────────────────────
//
// L'orchestrateur relève ses lancements (`start_session`, `claude --bg`) dans son registre, avec ou
// sans parcours, puis lit, toutes les 5 s, les fichiers des sessions qu'il a lancées ou que son
// parcours déclare. Il ne les écrit jamais (Q7). Un fichier lu à moitié écrit est ignoré jusqu'à
// la relecture suivante.

/** Les sessions liées vues à la dernière relecture, avec leur registre (null : pas encore lisible). */
const linkedAtom = atom({ plugin: 'flow-board', key: 'agentsLinked' } as const, [] as LinkedSession[])
/**
 * Ce qui a été lu des autres sessions, par id, avec la date du fichier : l'en-tête (premier
 * morceau) de chaque fichier récent, pour les reconnaître ; le registre entier des seules
 * sessions liées. Relus seulement quand la date change ; oubliés quand ils ne servent plus.
 */
const otherHeads = new Map<string, { mtime: number; head: SessionRegistry }>()
const otherRegistries = new Map<string, { mtime: number; reg: SessionRegistry; traces?: string }>()
/** Les jobs de `claude --bg` finis : leur `state.json` ne change plus. */
const endedJobs = new Map<string, JobInfo>()

/** Une relecture a trouvé le registre d'une session liée changé : l'onglet se redessine. */
let isOtherChanged = false

/** Les fichiers du dossier du registre (`<session>.json`), avec leur date ; `$.store` quand le dossier ne se lit pas (date -1). */
const registryFiles = async ($: any): Promise<{ session: string; mtime: number }[]> => {
  const dir = registryDir($)
  if (dir) {
    try {
      const entries = (await $.fs.list(dir)) as { name: string; kind: string; mtimeMs: number }[]
      return entries.filter(x => x.kind === 'file' && /^[a-z0-9_-]+\.json$/.test(x.name)).map(x => ({ session: x.name.replace(/\.json$/, ''), mtime: x.mtimeMs }))
    } catch {
      // Dossier absent ou hors d'atteinte : l'ancien stockage.
    }
  }
  try {
    const head = registryKey('')
    return ((await $.store.keys()) as string[]).filter(k => k.startsWith(head) && !k.slice(head.length).includes(':')).map(k => ({ session: k.slice(head.length), mtime: -1 }))
  } catch {
    return []
  }
}

/**
 * Les en-têtes des autres sessions du dossier, modifiés depuis `since` (le premier morceau seul).
 * Lu à moitié écrit, un en-tête garde la lecture d'avant jusqu'à la suivante.
 */
const readOtherHeads = async ($: any, self: string, since: number): Promise<SessionRegistry[]> => {
  const files = (await registryFiles($)).filter(f => f.session !== self && (f.mtime < 0 || f.mtime >= since))
  const seen = new Set(files.map(f => f.session))
  for (const id of [...otherHeads.keys()]) if (!seen.has(id)) otherHeads.delete(id)
  for (const { session, mtime } of files) {
    const kept = otherHeads.get(session)
    if (kept && mtime >= 0 && kept.mtime === mtime) continue
    const piece = await readPiece($, session, 0)
    const head = piece.ok ? parseOwnRegistry(piece.value, session) : null
    if (head) otherHeads.set(session, { mtime, head })
  }
  const traces = await readTraces($)
  return [...otherHeads.values()].map(x => applyTraces(x.head, traces) ?? x.head)
}

/**
 * Le registre entier des sessions liées (tous ses morceaux). Un morceau lu à moitié écrit garde
 * la lecture d'avant jusqu'à la suivante ; un registre qui ne sert plus est oublié.
 */
const readLinkedRegistries = async ($: any, ids: ReadonlySet<string>) => {
  for (const id of [...otherRegistries.keys()]) if (!ids.has(id)) otherRegistries.delete(id)
  const traces = await readTraces($)
  const tracesKey = traces.map(t => `${t.id}@${t.at}`).sort().join(',')
  for (const id of ids) {
    const mtime = otherHeads.get(id)?.mtime ?? -1
    const kept = otherRegistries.get(id)
    // Une nouvelle trace change ce qui se montre sans changer la date du fichier.
    if (kept && mtime >= 0 && kept.mtime === mtime && kept.traces === tracesKey) continue
    const got = await readRegistry($, id)
    if (!got.ok || !got.value || !got.isWhole) continue
    // Ce que le rattrapage a reconstruit à part (S13) complète le fichier de la session.
    const rebuiltValue = applyRebuilt(got.value, await readRebuilt($, id), await $.clock.now())
    const value = applyTraces(rebuiltValue, traces) ?? rebuiltValue
    if (JSON.stringify(value) !== JSON.stringify(kept?.reg)) isOtherChanged = true
    otherRegistries.set(id, { mtime, reg: value, traces: tracesKey })
  }
}

/** Ce que `~/.claude/jobs/<id court>/state.json` dit d'une session de `claude --bg` ; un job fini n'est plus relu. */
const readJob = async ($: any, id: string): Promise<JobInfo | null> => {
  const ended = endedJobs.get(id)
  if (ended) return ended
  const home = claudeHome($)
  if (!home || !/^[0-9a-f]{8,}$/i.test(id)) return null
  try {
    const raw = JSON.parse(String(await $.fs.read(`${home}/jobs/${id}/state.json`))) as Record<string, unknown>
    const text = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined)
    const updatedAt = Date.parse(text('updatedAt') ?? '')
    const job: JobInfo = { sessionId: text('sessionId'), name: text('name'), state: text('state'), ...(Number.isFinite(updatedAt) ? { updatedAt } : {}) }
    if (job.state !== undefined && /done|finished|exited|stopped|fail|error|crash/i.test(job.state)) endedJobs.set(id, job)
    return job
  } catch {
    return null
  }
}

/**
 * Relit les sessions liées de cette discussion, une relecture à la fois (demandée pendant qu'une
 * autre tourne, elle la suit). Rien à lire sans parcours ni lancement : pas de session liée.
 */
let linkedReading: Promise<void> | null = null
let isLinkedReadAgain = false
const refreshLinked = async ($: any): Promise<void> => {
  if (linkedReading) {
    isLinkedReadAgain = true
    return linkedReading
  }
  linkedReading = (async () => {
    do {
      isLinkedReadAgain = false
      await refreshLinkedOnce($)
    } while (isLinkedReadAgain)
  })().finally(() => {
    linkedReading = null
  })
  return linkedReading
}

const refreshLinkedOnce = async ($: any) => {
  const self: SessionRegistry | null = await read($, registryAtom)
  if (!self) return
  const board: Board | null = await read($, boardAtom)
  const run = board?.delegate ? null : activeRun(board)
  const launches = self.linked ?? []
  if (!run && launches.length === 0) {
    otherHeads.clear()
    otherRegistries.clear()
    if ((await read($, linkedAtom)).length > 0) await update($, linkedAtom, () => [])
    return
  }
  // Une session liée écrit son fichier après son lancement : les fichiers plus anciens sont d'autres sessions.
  const since = Math.min(run?.startedAt ?? Infinity, ...launches.map(l => l.at)) - 60_000
  const heads = await readOtherHeads($, self.session, since)
  const stored = run ? await readRelay($, run.id) : undefined
  const relay = stored !== null && typeof stored === 'object' && (stored as Relay).run === run?.id && typeof (stored as Relay).sessions === 'object' ? (stored as Relay) : null
  const jobs: Record<string, JobInfo> = {}
  for (const l of launches) {
    if (l.via !== 'bg') continue
    const job = await readJob($, l.id)
    if (job) jobs[l.id] = job
  }
  const sessions = linkedSessions({ self, ...(run ? { run: run.id } : {}), relay, others: heads, jobs, now: await $.clock.now() })
  await readLinkedRegistries($, new Set(sessions.flatMap(l => (l.session !== undefined ? [l.session] : []))))
  const isSame = JSON.stringify(sessions) === JSON.stringify(await read($, linkedAtom))
  if (isSame && !isOtherChanged) return
  isOtherChanged = false
  if (!isSame) await update($, linkedAtom, () => sessions)
  $.ui.invalidate('ui.render')
}

/** Le registre lu d'une session liée, pour l'onglet ; null tant qu'il ne se lit pas. */
const linkedRegistryOf = (session: string | undefined): SessionRegistry | null => (session !== undefined ? (otherRegistries.get(session)?.reg ?? null) : null)

/**
 * Une session liée vient d'être lancée (`start_session`, `claude --bg`) : son lancement va dans le
 * registre d'ici, avec un départ sur la piste de l'orchestrateur. Dans toute session, avec ou sans
 * parcours. La relecture des sessions liées part sans être attendue (la durée de l'outil n'en dépend pas).
 */
const noteLinkedLaunches = async ($: any, e: any, ran: any) => {
  if (!ran || ran.deny !== undefined || ran.isError === true) return
  const launches: Omit<LinkedLaunch, 'at'>[] = []
  if (e.tool === START_SESSION) {
    const id = /\blocal_[A-Za-z0-9_-]+/.exec(JSON.stringify(ran.result ?? ran.text ?? ''))?.[0]
    const asked = e as { title?: unknown; name?: unknown }
    const title = String(asked.title ?? asked.name ?? '').trim()
    if (id) launches.push({ id, via: 'desktop', ...(title !== '' ? { title } : {}) })
  } else if (e.tool === 'Bash' || (e.tool as string) === 'PowerShell') {
    const record = ran.result as { stdout?: unknown; backgroundTaskId?: unknown } | undefined
    if (typeof record?.backgroundTaskId === 'string') return
    const out = typeof record?.stdout === 'string' ? record.stdout : typeof ran.text === 'string' ? ran.text : ''
    for (const l of backgroundLaunches(String(e.command ?? ''), out)) launches.push({ id: l.id, via: 'bg', ...(l.title.trim() !== '' ? { title: l.title.trim() } : {}) })
  }
  if (launches.length === 0) return
  const at = await $.clock.now()
  for (const l of launches) {
    const isKnown = ((await read($, registryAtom)) as SessionRegistry | null)?.linked?.some(x => x.id === l.id) === true
    if (isKnown) continue
    await quietly(() => commitRegistry($, reg => noteLaunch(reg, { ...l, at }, at)))
    await markLane($, MAIN, { k: 'relay', at, to: `session:${l.id}` })
  }
  void quietly(() => refreshLinked($))
}

/**
 * Ce que flow-board a lui-même demandé au moment d'un lancement (Q9, deuxième source du type) :
 * d'après la phase ou le détour en cours du parcours actif ici. Rien hors parcours.
 */
const askedTypeOf = (board: Board | null): AgentType | undefined => {
  const run = board?.delegate ? null : activeRun(board)
  if (!run) return undefined
  const { phase, detour } = focusOf(run)
  const target = detour ?? phase
  // Une phase de revue l'est tout entière ; ailleurs, c'est l'étape en cours qui dit ce qui est demandé.
  const bySkill: Record<string, AgentType> = { 'security-review': 'security', 'final-review': 'review', 'code-review': 'review', 'branch-review': 'review', 'codebase-design': 'plan', research: 'research', 'improve-codebase-architecture': 'explore' }
  if (bySkill[target.skill] !== undefined) return bySkill[target.skill]
  const step = target.steps.find(st => st.status === 'active')?.id
  if (step === undefined) return undefined
  if (target.skill === 'retro') return step === 'read' ? 'transcripts' : undefined
  const byStep: Record<string, AgentType> = { security: 'security', review: 'review', 'group-review': 'review', implementers: 'implement', merge: 'merge', graph: 'explore', explore: 'explore' }
  return byStep[step]
}

/** Le parcours auquel rattacher un sous-agent qui part : l'actif ici, ou celui que sert la session liée ; jamais un parcours effacé (S23). */
const agentRunOf = (board: Board | null): string | undefined => {
  const run = board?.delegate?.run ?? activeRun(board)?.id
  return run !== undefined && !erasedRuns.has(run) ? run : undefined
}

/**
 * Un appel Agent, dans toute session (parcours actif, session liée, ou aucun parcours) : le
 * registre le suit, et le parcours actif d'ici garde ses étapes (implementers, relecteurs…).
 * Un suivi en échec ne gêne jamais l'appel.
 */
const trackAgentCall = async ($: any, e: any, next: (e: any) => Promise<any>) => {
  const key = String(e.tool_use_id)
  const startedAt = await $.clock.now()
  const isBackground = e.run_in_background !== false
  const board0: Board | null = await read($, boardAtom)
  const isRunHere = !board0?.delegate && activeRun(board0) !== null
  // Une session liée relit les traces : un parcours effacé ne reçoit plus ses sous-agents (S23).
  if (board0?.delegate) await quietly(() => readTraces($))
  agentCalls.add(key)
  await quietly(async () => {
    await ownAgent($, key)
    await commitRegistry($, reg =>
      startRegistryCall(
        reg,
        {
          key,
          name: String(e.description ?? ''),
          model: typeof e.model === 'string' ? e.model : undefined,
          subagentType: typeof e.subagent_type === 'string' ? e.subagent_type : undefined,
          prompt: typeof e.prompt === 'string' ? e.prompt : undefined,
          isBackground,
          parent: typeof e.agentId === 'string' ? e.agentId : undefined,
          run: agentRunOf(board0),
          asked: askedTypeOf(board0),
        },
        startedAt,
      ),
    )
  })
  await markLane($, laneOfLoop(e.agentId), { k: 'relay', at: startedAt, to: key })
  if (isRunHere) await commit($, board => applyAgentStart(board, { key, name: e.description, model: e.model, type: e.subagent_type, isBackground }, startedAt))
  const ran = await Promise.resolve(next(e)).finally(() => agentCalls.delete(key))
  const failed = ran.deny !== undefined || ran.isError === true
  // Un lancement refusé (par la personne ou un hook) ou interrompu n'est pas un échec du sous-agent.
  const isCancelled = ran.deny !== undefined || (ran.isError === true && CANCELLED.test(String(ran.text ?? ran.result ?? '')))
  const record = failed ? undefined : (ran.result as { agentId?: string; resolvedModel?: string; status?: string } | undefined)
  // Un sous-agent rendu `completed` est fini, même demandé en fond : son SubagentStop est passé
  // avant que son id soit connu, et ne le marquera plus.
  const isFinished = record?.status === 'completed' || (record?.status === undefined && !isBackground)
  const end = { agentId: record?.agentId, model: record?.resolvedModel, isFailed: failed, isFinished, isCancelled }
  const endedAt = await $.clock.now()
  await quietly(() => commitRegistry($, reg => endRegistryCall(reg, key, end, endedAt)))
  if (isRunHere) await commit($, board => applyAgentActivity(board, endedAt))
  // Annulé ou échoué au lancement : le repère va sur la piste du lanceur ; rendu fini, le retour aussi.
  if (isCancelled || failed) await markLane($, laneOfLoop(e.agentId), { k: isCancelled ? 'stop' : 'fail', at: endedAt, to: key })
  else if (isFinished) await markLane($, laneOfLoop(e.agentId), { k: 'back', at: endedAt, to: key })
  return ran
}

/** Une fin de tour de sous-agent (SubagentStop, `turn.complete` avec son id), dans toute session. */
const stopAgentHere = async ($: any, agentId: string) => {
  const now = await $.clock.now()
  await commit($, board => applyAgentActivity(board, now))
  // Fini (jusqu'à un éventuel réveil) : tous ses segments encore ouverts se ferment avec lui.
  await quietly(() =>
    commitRegistry($, reg => {
      const stopped = stopRegistryAgent(reg, agentId, now)
      return closeOpen(stopped ?? reg, agentId, now) ?? stopped
    }),
  )
  // Lancé par un sous-agent : son rapport revient au lanceur sans message du fil principal ; le
  // retour se pose sur la piste du lanceur à sa première fin (essai, point 6).
  const launcher = await launcherOf($, agentId)
  if (launcher && launcher.lane !== MAIN) {
    const parentLane = ((await read($, registryAtom)) as SessionRegistry | null)?.agents.find(a => a.agentId === launcher.lane)
    if (!(parentLane?.marks ?? []).some(m => m.k === 'back' && m.to === launcher.key)) await markLane($, launcher.lane, { k: 'back', at: now, to: launcher.key })
  }
}

/**
 * Le retour d'un sous-agent au fil principal (essai, point 6) : son message (`<agent-message
 * from="<id>">`) ou sa notification (`<task-id><id></task-id>`) ; l'id du sous-agent, ou null.
 */
const returnedAgentOf = (text: string): string | null =>
  /^\s*<agent-message\s+from="([^"]+)"/.exec(text)?.[1] ?? /<task-notification>[\s\S]*?<task-id>([^<]+)<\/task-id>/.exec(text)?.[1] ?? null

/** Le chemin du transcript de la session, tel que les hooks classiques le donnent. */
const noteTranscript = async ($: any, e: any) => {
  const transcript = typeof e?.transcript_path === 'string' ? e.transcript_path : undefined
  // Le titre de la discussion, quand le hook le porte (SessionStart, UserPromptSubmit).
  const title = typeof e?.session_title === 'string' && e.session_title.trim() !== '' ? e.session_title.trim() : undefined
  if (transcript === undefined && title === undefined) return
  await quietly(() => commitRegistry($, reg => withHeader(reg, { transcript, title })))
  if (needsRebuild && transcript !== undefined) await quietly(() => catchUpOwn($, true))
}

// ─── Rattrapage par transcripts (ticket 08) ───────────────────────────────
//
// Les transcripts de Claude Code font foi pour les chiffres. Le rattrapage tourne à l'ouverture de
// l'onglet sur la session affichée, et à la fin d'un sous-agent dont les chiffres manquent. Pour
// cette session, il complète son propre registre ; pour une session liée affichée, il écrit son
// fichier à part, `<session>.rebuilt.json`, que seule le rattrapage écrit (S13).

/** Le fichier de registre de cette session était illisible au chargement : il se reconstruit dès que son transcript est connu. */
let needsRebuild = false
/** Les transcripts de sous-agents déjà lus, par chemin, avec leur date : relus seulement quand elle change. */
const transcriptCache = new Map<string, { mtime: number; agent: TranscriptAgent }>()
/** Au-delà, un transcript ne se relit pas en entier (la piste de la session seulement : ses sous-agents ont chacun le leur). */
const TRANSCRIPT_MAX_BYTES = 64 * 1024 * 1024

/** Au-delà, la lecture en flux d'un transcript est abandonnée (F6 : un délai sur chaque commande). */
const TRANSCRIPT_READ_MS = 60_000

/**
 * Le dossier de Claude Code où vivent les transcripts : `CLAUDE_CONFIG_DIR` (le premier s'il y en a
 * plusieurs), sinon celui d'où le mod est installé, sinon `~/.claude` ; null quand rien ne le dit.
 */
const claudeDir = async ($: any): Promise<string | null> => {
  // `$.env.get` veut un nom littéral : chaque variable a son appel.
  const env = async (read: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      const value = await read()
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    } catch {
      return undefined
    }
  }
  const custom = await env(() => $.env.get('CLAUDE_CONFIG_DIR'))
  // Sans barre finale : les chemins listés sous lui et la garde de lecture se comparent pareil.
  const first = custom?.split(',')[0]!.trim().replace(/[\\/]+$/, '')
  if (first) return first
  const home = claudeHome($)
  if (home) return home
  const user = (await env(() => $.env.get('USERPROFILE'))) ?? (await env(() => $.env.get('HOME')))
  return user ? `${user.replace(/[\\/]+$/, '')}/.claude` : null
}

/**
 * Le texte d'un transcript : `$.fs.read` jusqu'à 4 Mio, sinon lu en flux par une commande
 * système (`cat --`, `type` sous Windows), dans un délai ; null quand il ne se lit pas. Seul un
 * transcript sous `<dossier Claude>/projects/` se lit (F4).
 */
const readTranscript = async ($: any, path: string): Promise<string | null> => {
  if (!isTranscriptPath(path, await claudeDir($))) return null
  try {
    return String(await $.fs.read(path))
  } catch {
    // Trop gros pour une lecture, ou absent.
  }
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file' || stat.size > TRANSCRIPT_MAX_BYTES) return null
    const argv = readArgv(path)
    if (!argv) return null
    // Le délai ne s'annule pas : arrivé après la fin, il ne fait rien.
    const deadline = new Promise<void>(resolve => $.clock.after(TRANSCRIPT_READ_MS, () => resolve()))
    return await drainWithin($.process.spawn({ argv }), deadline)
  } catch {
    return null
  }
}

/** Un sous-agent d'après son transcript et son `.meta.json` (à côté) ; relu seulement quand le fichier change. */
const transcriptAgent = async ($: any, path: string, mtime: number): Promise<TranscriptAgent | null> => {
  const agentId = SUBAGENT_FILE.exec(path.split(/[\\/]/).pop() ?? '')?.[1]
  if (!agentId) return null
  const kept = transcriptCache.get(path)
  if (kept && mtime >= 0 && kept.mtime === mtime) return kept.agent
  const text = await readTranscript($, path)
  if (text === null) return kept?.agent ?? null
  let meta = {}
  try {
    meta = metaFromText(String(await $.fs.read(path.replace(/\.jsonl$/, '.meta.json'))))
  } catch {
    // Sans `.meta.json` : le transcript seul.
  }
  const agent: TranscriptAgent = { agentId, lane: laneFromTranscript(text), meta }
  transcriptCache.set(path, { mtime, agent })
  return agent
}

/** Un fichier présent ; faux quand il manque ou ne se voit pas. */
const isPresent = async ($: any, path: string): Promise<boolean> => {
  try {
    return Boolean(await $.fs.exists(path))
  } catch {
    return false
  }
}

/**
 * Les sous-agents d'une session d'après leurs transcripts (`<session>/subagents/agent-<id>.jsonl`),
 * et le nombre de transcripts qui n'ont pas pu se relire (S34, S39) : refusé par la garde, dossier
 * illisible, trop gros, délai dépassé. Un dossier ou un fichier absent (pas de sous-agent, nettoyé
 * par Claude Code) n'est pas un échec. `since` : les fichiers modifiés pour la dernière fois avant
 * ne sont pas relus (ils ne peuvent pas tenir un sous-agent parti après).
 */
const scanTranscriptAgents = async ($: any, transcript: string, since = -Infinity): Promise<{ agents: TranscriptAgent[]; failed: number }> => {
  const dir = subagentsDirOf(transcript)
  // Le dossier d'un transcript que la garde refuse ne se liste pas non plus (F4).
  if (!isTranscriptPath(transcript, await claudeDir($))) return { agents: [], failed: 1 }
  if (!dir) return { agents: [], failed: 0 }
  let entries: { name: string; kind: string; mtimeMs: number }[] = []
  try {
    entries = (await $.fs.list(dir)) as typeof entries
  } catch {
    return { agents: [], failed: (await isPresent($, dir)) ? 1 : 0 }
  }
  const agents: TranscriptAgent[] = []
  let failed = 0
  for (const x of entries) {
    if (x.kind !== 'file' || !SUBAGENT_FILE.test(x.name) || x.mtimeMs < since) continue
    const path = `${dir}/${x.name}`
    const agent = await transcriptAgent($, path, x.mtimeMs)
    if (agent) agents.push(agent)
    else if (await isPresent($, path)) failed += 1
  }
  return { agents, failed }
}

/** Les sous-agents d'une session d'après leurs transcripts. */
const transcriptAgents = async ($: any, transcript: string): Promise<TranscriptAgent[]> => (await scanTranscriptAgents($, transcript)).agents

/**
 * Le rattrapage de cette session : ses sous-agents d'après leurs transcripts ; reconstruit
 * (`isRebuild`, fichier illisible), aussi la piste de la session d'après son propre transcript.
 */
const catchUpOwn = async ($: any, isRebuild = false) => {
  const reg: SessionRegistry | null = await read($, registryAtom)
  const transcript = reg?.transcript
  if (!transcript) return
  const found = await transcriptAgents($, transcript)
  const mainText = isRebuild ? await readTranscript($, transcript) : null
  const main = mainText !== null ? laneFromTranscript(mainText, true) : null
  const now = await $.clock.now()
  // Les appels encore en vol ici ne se closent pas d'après leur transcript.
  const inFlight = new Set(agentCalls)
  const traces = await readTraces($)
  const board: Board | null = await read($, boardAtom)
  // Une session liée n'est pas concernée (S27) : sa suppression l'efface déjà en entier.
  const runs = board && !board.delegate ? board.runs : []
  await commitRegistry($, r => {
    // Q-a (S27) : un sous-agent qui manquait au registre rejoint le parcours que la discussion portait à son départ ;
    // R2 (S32) : une entrée rattrapée plus tôt sans parcours aussi, à chaque rattrapage.
    let next = catchUp(r, withCarriedRuns(found, r, runsCarriedBy(runs, r)), now, inFlight) ?? r
    next = attachCarried(next, runsCarriedBy(runs, next)) ?? next
    // Une session effacée en partie ne reprend pas les totaux de tout son transcript.
    const isCovered = traces.some(t => t.id === r.session)
    if (main && (main.segments ?? []).length > 0) {
      // La piste vécue ici depuis le démarrage reste ; le transcript rend ce qui la précède, et ses
      // chiffres font foi.
      const live = next.main?.segments ?? []
      const since = live.length > 0 ? Math.min(...live.map(x => x.s)) : Infinity
      const before = (main.segments ?? []).filter(x => (x.e ?? x.s) <= since)
      next = {
        ...next,
        main: { ...next.main, segments: [...before, ...live].sort((a, b) => a.s - b.s), ...(main.tokens && !isCovered ? { tokens: main.tokens } : {}), ...(main.models ? { models: main.models } : {}) },
      }
    }
    // Les traces après la fusion : rien de ce qu'elles couvrent ne revient (S5).
    next = applyTraces(next, traces) ?? next
    return next === r ? null : next
  })
  if (isRebuild) needsRebuild = false
}

/**
 * Le fichier à part d'une session reconstruite (S13), `<session>.rebuilt.json`, ou d'un parcours
 * (S18), `run-<parcours>.rebuilt.json` ; sa clé de `$.store` en repli.
 */
const rebuiltPath = ($: any, id: string): string | null => registryPath($, id)?.replace(/\.json$/, '.rebuilt.json') ?? null
const rebuiltKey = (id: string): string => `${registryKey(id)}:rebuilt`

/**
 * Le fichier à part `id`, entrée par entrée (F3) ; `session` : ce qu'il doit déclarer. `ok` faux :
 * la relecture a échoué (fichier occupé, droits, écriture coupée), à ne pas confondre avec un
 * fichier absent (`value: null`) ; un écrivain ne réécrit jamais un fichier qu'il n'a pas pu relire.
 */
const readRebuiltState = async ($: any, id: string, session: string = id): Promise<{ ok: boolean; value: Rebuilt | null }> => {
  const path = rebuiltPath($, id)
  let isThere = false
  try {
    isThere = path !== null && (await $.fs.exists(path))
  } catch {
    // Dossier hors d'atteinte : l'ancien stockage.
  }
  try {
    const raw = isThere ? JSON.parse(String(await $.fs.read(path!))) : await $.store.get(rebuiltKey(id))
    if (raw === undefined || raw === null) return { ok: true, value: null }
    const value = cleanRebuilt(raw, session)
    return value ? { ok: true, value } : { ok: false, value: null }
  } catch {
    return { ok: false, value: null }
  }
}

/** Le fichier à part `id` pour l'affichage, sans ce que les traces couvrent (S5) ; null quand il manque ou ne se lit pas. */
const readRebuilt = async ($: any, id: string, session: string = id): Promise<Rebuilt | null> => {
  const value = (await readRebuiltState($, id, session)).value
  return value ? (applyTracesToRebuilt(value, await readTraces($)) ?? value) : null
}

/** Écrit le fichier à part `id` : le fichier, sinon `$.store` quand il n'existe pas déjà ; faux quand rien ne l'accepte. */
const writeRebuilt = async ($: any, id: string, rebuilt: Rebuilt): Promise<boolean> => {
  const path = rebuiltPath($, id)
  let isThere = false
  if (path) {
    try {
      await $.fs.write(path, JSON.stringify(rebuilt))
      await lockRegistryDir($)
      return true
    } catch {
      try {
        isThere = await $.fs.exists(path)
      } catch {
        // Inconnu : le repli reste permis.
      }
    }
  }
  // Un fichier là mais refusé : un repli dans `$.store` serait caché par lui à la lecture.
  if (isThere) return false
  try {
    await $.store.set(rebuiltKey(id), rebuilt)
    return true
  } catch {
    return false
  }
}

/** Un fichier à part qui ne tient rien : ni sous-agent, ni ligne recopiée, ni parcours repris, ni piste. */
const isEmptyRebuilt = (r: Rebuilt): boolean =>
  r.agents.length === 0 && (r.rows ?? []).length === 0 && (r.runs ?? []).length === 0 && (r.main?.segments ?? []).length === 0 && (r.main?.marks ?? []).length === 0

/** Une écriture des fichiers à part à la fois dans ce processus (S20). */
let rebuiltQueue: Promise<unknown> = Promise.resolve()
const inRebuiltQueue = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = rebuiltQueue.then(job, job)
  rebuiltQueue = run.catch(() => undefined)
  return run
}

/**
 * Change le fichier à part `id` (S20) : relu juste avant, `change` rend sa nouvelle version (une
 * fusion, sauf la sortie d'une ligne retrouvée, S18), écrite si elle diffère. Faux quand il ne se
 * relit pas, ou que l'écriture est refusée.
 */
const updateRebuilt = (
  $: any,
  id: string,
  session: string,
  change: (before: Rebuilt | null) => Rebuilt | null,
): Promise<boolean> =>
  inRebuiltQueue(async () => {
    const before = await readRebuiltState($, id, session)
    if (!before.ok) return false
    // Ce que les traces couvrent ne s'y réécrit pas (S5) : une écriture compacte aussi.
    const traces = await readTraces($)
    const changed = change(before.value)
    const next = changed ? (applyTracesToRebuilt(changed, traces) ?? changed) : null
    if (!next || JSON.stringify(next) === JSON.stringify(before.value)) return true
    // Un fichier absent ne se crée pas vide (tout couvert par les traces) : un effacement passé entre-temps ne revient pas.
    if (before.value === null && isEmptyRebuilt(next)) return true
    return writeRebuilt($, id, next)
  })

/**
 * Le rattrapage d'une session liée affichée : d'après le transcript que son en-tête relève, son
 * fichier à part se fusionne (S13, S20) ; son propre fichier n'est jamais touché (Q7).
 */
const catchUpLinked = async ($: any, session: string) => {
  const reg = otherRegistries.get(session)?.reg
  if (!reg?.transcript) return
  const agents = await transcriptAgents($, reg.transcript)
  if (agents.length === 0) return
  const before = JSON.stringify(await readRebuilt($, session))
  await updateRebuilt($, session, session, was => unionRebuilt(was, { v: 1, session, agents }))
  if (JSON.stringify(await readRebuilt($, session)) === before) return
  // La prochaine relecture applique le fichier à part.
  otherRegistries.delete(session)
  await refreshLinked($)
}

/** Le rattrapage de ce que l'onglet montre : cette session, ou la session liée choisie. */
const catchUpShown = async ($: any) => {
  const ui = await read($, uiAtom)
  if (ui.tab !== 'agents') return
  const chosen = ui.agentsSession !== undefined ? (await read($, linkedAtom)).find(l => l.key === ui.agentsSession) : undefined
  if (chosen?.session !== undefined) await catchUpLinked($, chosen.session)
  else await catchUpOwn($, needsRebuild)
}

/**
 * La fin d'un sous-agent dont les chiffres manquent (aucun token relevé) : son transcript, donné
 * par la fin elle-même (`agent_transcript_path`), les apporte.
 */
const catchUpAgent = async ($: any, agentId: string, path: unknown) => {
  if (typeof path !== 'string' || !/\.jsonl$/.test(path)) return
  const known = ((await read($, registryAtom)) as SessionRegistry | null)?.agents.find(a => a.agentId === agentId)
  if (!known || known.tokens !== undefined) return
  const agent = await transcriptAgent($, path, -1)
  if (!agent) return
  const now = await $.clock.now()
  const inFlight = new Set(agentCalls)
  const traces = await readTraces($)
  await commitRegistry($, r => {
    const next = catchUp(r, [agent], now, inFlight)
    return next ? (applyTraces(next, traces) ?? next) : null
  })
}

// ─── Historique de l'onglet Agents (ticket 09) ────────────────────────────
//
// Le sélecteur liste le dossier du registre et lit les en-têtes (relus quand leur date change),
// sans index commun écrit par plusieurs sessions. Un parcours passé se montre d'après les
// registres des discussions qui l'ont porté, leurs fichiers à part et celui du parcours.

/** Les en-têtes de tout le dossier, par id, avec la date du fichier lu. */
const historyHeads = new Map<string, { mtime: number; head: SessionRegistry }>()

/** Les en-têtes de toutes les autres sessions du dossier ; lu à moitié écrit, un en-tête garde la lecture d'avant. */
const readAllHeads = async ($: any, self: string): Promise<SessionRegistry[]> => {
  const files = (await registryFiles($)).filter(f => f.session !== self)
  const seen = new Set(files.map(f => f.session))
  for (const id of [...historyHeads.keys()]) if (!seen.has(id)) historyHeads.delete(id)
  for (const { session, mtime } of files) {
    const kept = historyHeads.get(session)
    if (kept && mtime >= 0 && kept.mtime === mtime) continue
    const piece = await readPiece($, session, 0)
    const head = piece.ok ? parseOwnRegistry(piece.value, session) : null
    if (head) historyHeads.set(session, { mtime, head })
  }
  const traces = await readTraces($)
  return [...historyHeads.values()].map(x => applyTraces(x.head, traces) ?? x.head)
}

/** Les ids des fichiers à part du dossier (`<id>.rebuilt.json`), ou de leurs clés de `$.store`. */
const rebuiltIds = async ($: any): Promise<string[]> => {
  const dir = registryDir($)
  if (dir) {
    try {
      const entries = (await $.fs.list(dir)) as { name: string; kind: string }[]
      return entries.flatMap(x => (x.kind === 'file' ? (/^([a-z0-9_-]+)\.rebuilt\.json$/.exec(x.name)?.slice(1, 2) ?? []) : []))
    } catch {
      // Dossier absent : l'ancien stockage.
    }
  }
  try {
    return ((await $.store.keys()) as string[]).flatMap(k => /^agents:([^:]+):rebuilt$/.exec(k)?.slice(1, 2) ?? [])
  } catch {
    return []
  }
}

/**
 * Q-c : les sous-agents en échec d'un parcours, dans le registre de cette discussion et dans ceux
 * de ses sessions liées (celles que leur fichier déclare, et celles du relais), relus entiers.
 */
const failedOfRun = async ($: any, run: Run): Promise<number> => {
  const self: SessionRegistry | null = await read($, registryAtom)
  const regs: (SessionRegistry | null)[] = [self]
  try {
    const heads = await readAllHeads($, self?.session ?? '')
    const stored = await readRelay($, run.id)
    const relayIds = stored !== null && typeof stored === 'object' && typeof (stored as Relay).sessions === 'object' ? Object.keys((stored as Relay).sessions) : []
    const ids = new Set([...heads.filter(h => h.run === run.id).map(h => h.session), ...relayIds])
    if (self) ids.delete(self.session)
    for (const id of ids) regs.push(await fullRegistry($, id))
  } catch {
    // Les autres registres hors d'atteinte : celui de cette discussion seul.
  }
  return failedAgentsOf(run.id, regs)
}

/** Le registre d'une session complété par son fichier à part ; null quand ni l'un ni l'autre ne se lit. */
const fullRegistry = async ($: any, id: string): Promise<SessionRegistry | null> => {
  const got = await readRegistry($, id)
  const rebuilt = await readRebuilt($, id)
  if (!got.value && !rebuilt) return null
  const full = applyRebuilt(got.value ?? emptyRegistry(id, '', 0), rebuilt, await $.clock.now())
  return applyTraces(full, await readTraces($)) ?? full
}

/** Ce que montre une entrée du sélecteur : sa vue d'orchestrateur, ses sessions liées, son titre. */
type HistoryShown = { key: string; title: string; self: SessionRegistry; linked: { session: LinkedSession; reg: SessionRegistry | null }[] }

/** Le sélecteur de l'onglet ; la vue de l'entrée choisie vit à côté (`historyShown`), trop grosse pour l'état. */
const historyAtom = atom({ plugin: 'flow-board', key: 'agentsHistory' } as const, [] as HistoryEntry[])
let historyShown: HistoryShown | null = null

/** La vue d'une entrée passée : un parcours, ou une discussion sans parcours. */
const buildShown = async ($: any, key: string, board: Board | null, heads: readonly SessionRegistry[]): Promise<HistoryShown | null> => {
  const now = await $.clock.now()
  const linkedOf = async (self: SessionRegistry, run: string | undefined, others: readonly SessionRegistry[]) => {
    const stored = run !== undefined ? await readRelay($, run) : undefined
    const relay = stored !== null && typeof stored === 'object' && (stored as Relay).run === run && typeof (stored as Relay).sessions === 'object' ? (stored as Relay) : null
    const sessions = linkedSessions({ self, ...(run !== undefined ? { run } : {}), relay, others, now })
    const out: HistoryShown['linked'] = []
    for (const session of sessions) out.push({ session, reg: session.session !== undefined ? await fullRegistry($, session.session) : null })
    return out
  }
  if (key.startsWith('run:')) {
    const run = board?.runs.find(r => r.id === key.slice(4))
    if (!run) return null
    // Les discussions qui l'ont porté : leurs sous-agents de ce parcours, ou leur fichier à part qui le reprend.
    // Ses sessions liées ont leur pastille : elles ne se fondent pas dans l'orchestrateur.
    const stored = await readRelay($, run.id)
    const relayIds = stored !== null && typeof stored === 'object' && typeof (stored as Relay).sessions === 'object' ? Object.keys((stored as Relay).sessions) : []
    const linkedIds = new Set([...heads.filter(h => h.run === run.id).map(h => h.session), ...relayIds])
    const self: SessionRegistry | null = await read($, registryAtom)
    if (self?.run === run.id) linkedIds.add(self.session)
    // Un registre en morceaux peut tenir les sous-agents du parcours ailleurs que dans son en-tête.
    const isMaybe = (h: SessionRegistry) => (h.parts ?? 1) > 1 && h.updatedAt >= run.startedAt && self !== null && isSameProject(self.root, h.root)
    const carriers = heads.filter(h => !linkedIds.has(h.session) && (h.agents.some(a => a.run === run.id) || isMaybe(h))).map(h => h.session)
    for (const id of await rebuiltIds($)) {
      if (id.startsWith('run-') || carriers.includes(id) || linkedIds.has(id)) continue
      if ((await readRebuilt($, id))?.runs?.includes(run.id)) carriers.push(id)
    }
    const regs: SessionRegistry[] = []
    // Cette discussion, quand elle l'a porté (et n'en est pas une session liée) : son registre tel qu'il est maintenant.
    if (self && !linkedIds.has(self.session) && self.agents.some(a => a.run === run.id)) regs.push(self)
    for (const id of carriers) {
      const reg = await fullRegistry($, id)
      if (reg) regs.push(reg)
    }
    const view = runRegistry(run, regs, await readRebuilt($, runFileId(run.id), `run:${run.id}`), now)
    const linkedHeads = [...heads.filter(h => h.run === run.id), ...(self?.run === run.id ? [self] : [])]
    return { key, title: run.title, self: view, linked: await linkedOf(view, run.id, linkedHeads) }
  }
  if (key.startsWith('session:')) {
    const self = await fullRegistry($, key.slice(8))
    if (!self) return null
    return { key, title: self.title ?? self.session.slice(0, 8), self, linked: await linkedOf(self, undefined, heads) }
  }
  return null
}

/** Relit le sélecteur, et la vue de l'entrée choisie s'il y en a une. */
const refreshHistory = async ($: any) => {
  const self: SessionRegistry | null = await read($, registryAtom)
  if (!self) return
  const board: Board | null = await read($, boardAtom)
  const heads = await readAllHeads($, self.session)
  const entries = historyEntries(board, self, heads)
  if (JSON.stringify(entries) !== JSON.stringify(await read($, historyAtom))) await update($, historyAtom, () => entries)
  const key = (await read($, uiAtom)).agentsHistory
  const found = key !== undefined && key !== 'now' ? await buildShown($, key, board, heads) : null
  const shown = found ?? (key !== undefined && key !== 'now' ? { key, title: 'introuvable', self: emptyRegistry(key, '', 0), linked: [] } : null)
  if (JSON.stringify(shown) !== JSON.stringify(historyShown)) {
    historyShown = shown
    $.ui.invalidate('ui.render')
  }
}

/**
 * S1, S18 et S21 : les lignes de l'ancien champ des sous-agents d'un parcours vont dans le fichier
 * du parcours, puis le champ se vide dans le board (liste vide : une version d'avant qui le lirait
 * ne casse pas). Rien n'est vidé tant que la copie relue ne tient pas toutes ses lignes.
 */
const migrateRunAgents = async ($: any) => {
  const board: Board | null = await read($, boardAtom)
  const legacy = (board?.runs ?? []).filter(r => (r.agents?.length ?? 0) > 0)
  if (legacy.length === 0) return
  for (const run of legacy) {
    const rows = rowsFromRun(run)
    if (rows.length === 0) continue
    // Un fichier du parcours qui ne se relit pas n'est pas réécrit : ce parcours attend.
    await updateRebuilt($, runFileId(run.id), `run:${run.id}`, before => unionRebuilt(before, { v: 1, session: `run:${run.id}`, agents: [], rows, runs: [run.id] }))
  }
  // Ce que le fichier de chaque parcours tient, relu après l'écriture : seul un parcours dont toutes
  // les lignes y sont perd les siennes (une fusion a pu en apporter d'autres entre-temps).
  const copied = new Map<string, Set<string>>()
  for (const run of legacy) copied.set(run.id, new Set(((await readRebuilt($, runFileId(run.id), `run:${run.id}`))?.rows ?? []).map(r => r.key)))
  await commit($, b => {
    const next = stripRunAgents(b, run => rowsFromRun(run).every(r => copied.get(run.id)?.has(r.key) === true))
    return next ? { board: next, fx: { toasts: [], openPane: false, note: 'none' as const } } : null
  })
}

/** Les parcours déjà repris depuis les transcripts (Q14), sur ce poste : une fois chacun. */
const REBUILT_RUNS_KEY = 'agentsRebuiltRuns'
let isRebuildingRuns = false
let isRunsRebuildDone = false

/** Le nom de dossier que Claude Code donne aux transcripts d'un projet : sa racine, chaque signe non alphanumérique en tiret. */
const projectSlug = (root: string): string => root.replace(/[^A-Za-z0-9]/g, '-')

/** Les transcripts de session du projet (et de ses worktrees) : chemin, date. */
const projectTranscripts = async ($: any, root: string): Promise<{ path: string; id: string; mtime: number }[]> => {
  // Le même dossier que la garde de lecture (F4) : rien n'est listé qu'elle refuserait ensuite.
  const home = await claudeDir($)
  if (!home || root === '') return []
  const slug = projectSlug(root)
  const out: { path: string; id: string; mtime: number }[] = []
  try {
    for (const dir of (await $.fs.list(`${home}/projects`)) as { name: string; kind: string }[]) {
      // Le projet, ou un de ses worktrees (`<racine>/.claude/worktrees/…`) ; pas un voisin au même début.
      if (dir.kind !== 'dir' || (dir.name !== slug && !dir.name.startsWith(`${slug}--claude-worktrees-`))) continue
      for (const f of (await $.fs.list(`${home}/projects/${dir.name}`)) as { name: string; kind: string; mtimeMs: number }[]) {
        const id = /^([0-9a-f-]{8,})\.jsonl$/i.exec(f.name)?.[1]
        if (f.kind === 'file' && id) out.push({ path: `${home}/projects/${dir.name}/${f.name}`, id, mtime: f.mtimeMs })
      }
    }
  } catch {
    // Dossier des transcripts hors d'atteinte : rien à reprendre.
  }
  return out
}

/**
 * Q14 : au premier affichage de l'onglet, les parcours existants (en cours et archivés) retrouvent
 * leur frise depuis les transcripts, une fois chacun, et seulement ceux d'avant la première reprise
 * sur ce poste (les suivants sont suivis en direct). Les discussions d'un parcours : celle qui le
 * tient, ses sessions liées (relais), les registres qui le citent, les tickets passés « en cours »,
 * et celles dont le transcript contient un appel de ses anciennes lignes. Ce qui est reconstruit
 * va dans leur fichier à part (S13, S20) ; pour cette discussion, dans son propre registre. Une
 * ligne retrouvée, une fois sa copie relue, quitte le fichier du parcours (S18).
 */
const rebuildPastRuns = async ($: any) => {
  if (isRebuildingRuns || isRunsRebuildDone) return
  isRebuildingRuns = true
  try {
    const board: Board | null = await read($, boardAtom)
    const self: SessionRegistry | null = await read($, registryAtom)
    if (!board || !self) return
    // `since` : la première reprise sur ce poste ; les parcours nés après sont suivis en direct.
    let done: string[] = []
    let since = await $.clock.now()
    try {
      const kept = (await $.store.get(REBUILT_RUNS_KEY)) as { since?: unknown; done?: unknown } | undefined
      if (kept && typeof kept.since === 'number') since = kept.since
      if (kept && Array.isArray(kept.done)) done = kept.done.filter((x): x is string => typeof x === 'string')
    } catch {
      return
    }
    const save = () => quietly(() => $.store.set(REBUILT_RUNS_KEY, { since, done }))
    // Un parcours dont l'ancien champ n'est pas encore recopié attend la migration.
    const todo = board.runs.filter(r => !done.includes(r.id) && r.startedAt <= since && (r.agents?.length ?? 0) === 0)
    if (todo.length === 0) {
      await save()
      isRunsRebuildDone = true
      return
    }
    const now = await $.clock.now()
    const heads = await readAllHeads($, self.session)
    const transcripts = await projectTranscripts($, self.root || board.root)
    // Les anciennes lignes encore sans session, de tous les parcours à reprendre : un seul passage
    // sur les transcripts du projet, chaque clé retrouvée sortant de la recherche.
    const looseRuns = new Map<string, string>()
    for (const run of todo) for (const r of (await readRebuilt($, runFileId(run.id), `run:${run.id}`))?.rows ?? []) looseRuns.set(r.key, run.id)
    const keyHolders = new Map<string, Set<string>>()
    const oldest = Math.min(...todo.map(r => runWindow(r).s))
    for (const t of transcripts) {
      if (looseRuns.size === 0) break
      if (t.mtime < oldest) continue
      const text = await readTranscript($, t.path)
      if (text === null) continue
      for (const [key, runId] of [...looseRuns]) {
        if (!text.includes(key)) continue
        looseRuns.delete(key)
        const holders = keyHolders.get(runId) ?? new Set<string>()
        holders.add(t.id)
        keyHolders.set(runId, holders)
      }
    }
    // La piste d'une session, relue une fois pour tous ses parcours.
    const mainLanes = new Map<string, AgentLane | null>()
    const mainOf = async (path: string): Promise<AgentLane | null> => {
      if (!mainLanes.has(path)) {
        const text = await readTranscript($, path)
        mainLanes.set(path, text !== null ? laneFromTranscript(text, true) : null)
      }
      return mainLanes.get(path) ?? null
    }
    for (const run of todo) {
      const w = runWindow(run)
      const ids = new Set<string>(keyHolders.get(run.id) ?? [])
      if (run.owner) ids.add(run.owner)
      const stored = await readRelay($, run.id)
      if (stored !== null && typeof stored === 'object' && typeof (stored as Relay).sessions === 'object') for (const id of Object.keys((stored as Relay).sessions)) ids.add(id)
      for (const h of heads) if (h.run === run.id || h.agents.some(a => a.run === run.id)) ids.add(h.session)
      for (const t of run.tickets) if (t.by) ids.add(t.by)
      const found = new Set<string>()
      let isComplete = true
      for (const id of ids) {
        const transcript = id === self.session ? self.transcript : (heads.find(h => h.session === id)?.transcript ?? transcripts.find(t => t.id === id)?.path)
        if (!transcript) continue
        // R3 (S31) : une discussion qui a porté le parcours puis l'a rendu ne lui donne que les sous-agents de sa période.
        const holder = id === self.session ? self : heads.find(h => h.session === id)
        const agents = agentsOfRun(await transcriptAgents($, transcript), run, board.runs).filter(a => !holder || carriedRunAt([run], holder, a.lane.startedAt!) === run.id)
        const whole = await mainOf(transcript)
        const main = whole ? clipLane(whole, w) : null
        if (agents.length === 0 && (main?.segments ?? []).length === 0) continue
        if (id === self.session) {
          // Cette discussion se rattrape elle-même, dans son propre registre (jamais de fichier à part pour elle).
          // Comme catchUpOwn : les appels en vol ne se closent pas, et rien de ce que les traces couvrent ne revient.
          const inFlight = new Set(agentCalls)
          const traces = await readTraces($)
          await commitRegistry($, r => {
            const rebuilt = applyRebuilt(r, { v: 1, session: r.session, agents, ...(main ? { main } : {}) }, now, inFlight)
            const next = applyTraces(rebuilt, traces) ?? rebuilt
            return next === r ? null : next
          })
        } else if (!(await updateRebuilt($, id, id, before => withRun(before, id, run, agents, main)))) {
          isComplete = false
          continue
        }
        // La copie relue : seuls les appels qui y sont vraiment comptent comme retrouvés.
        const kept = id === self.session ? ((await read($, registryAtom)) as SessionRegistry | null)?.agents.map(a => a.key) ?? [] : ((await readRebuilt($, id))?.agents ?? []).map(a => a.meta.toolUseId)
        for (const a of agents) if (a.meta.toolUseId && kept.includes(a.meta.toolUseId)) found.add(a.meta.toolUseId)
      }
      // S18 : une ligne retrouvée dans le transcript de sa session quitte le fichier du parcours.
      if (found.size > 0) {
        const isOut = await updateRebuilt($, runFileId(run.id), `run:${run.id}`, before => (before?.rows?.some(r => found.has(r.key)) ? { ...before, rows: before.rows.filter(r => !found.has(r.key)) } : null))
        if (!isOut) isComplete = false
      }
      // Une écriture refusée : le parcours se reprendra à la prochaine ouverture.
      if (!isComplete) continue
      done.push(run.id)
      await save()
    }
    isRunsRebuildDone = todo.every(r => done.includes(r.id))
    await refreshHistory($)
  } finally {
    isRebuildingRuns = false
  }
}

// ─── Effacement (ticket 10) ───────────────────────────────────────────────
//
// Supprimer un parcours efface ses agents, ceux de ses sessions liées, son relais et ses choix ;
// « ✗ Oublier » efface une discussion et ses sessions liées sûres (S15). Une trace par id effacé
// (session, parcours, sous-agent : S5, S22), dans le dossier du registre. Le fichier d'une session
// fermée s'efface tout de suite (réécrit vide, puis supprimé : S4) ; celui d'une session ouverte
// n'est jamais touché, elle se compacte elle-même d'après les traces (S6, S19). Les transcripts
// de Claude Code ne sont jamais touchés.

/**
 * Le nom de fichier d'une trace (D2 b) : son id, chaque signe hors `[a-z0-9_-]` en tiret, puis sa
 * date ; un fichier par couple (id, date), jamais réécrit. Les traces d'avant, `<id>.erased.json`
 * (une par id, réécrite), se lisent toujours.
 */
const traceSlug = (id: string): string => id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
const tracePath = ($: any, t: Trace): string | null => {
  const dir = registryDir($)
  return dir ? `${dir}/${traceSlug(t.id)}.${t.at}.erased.json` : null
}
const traceKey = (t: Trace): string => `${registryKey(traceSlug(t.id))}:${t.at}:erased`

/** Les traces déjà lues, par nom de fichier, avec sa date : relues seulement quand elle change. */
const traceCache = new Map<string, { mtime: number; trace: Trace }>()

/** Toutes les traces : les fichiers `*.erased.json` du dossier du registre, et les clés de `$.store`. */
const readTraces = async ($: any): Promise<Trace[]> => {
  const out: Trace[] = []
  const dir = registryDir($)
  if (dir) {
    try {
      const entries = (await $.fs.list(dir)) as { name: string; kind: string; mtimeMs: number }[]
      for (const x of entries) {
        if (x.kind !== 'file' || !x.name.endsWith('.erased.json')) continue
        const kept = traceCache.get(x.name)
        if (kept && kept.mtime === x.mtimeMs) {
          out.push(kept.trace)
          continue
        }
        let trace: Trace | null = null
        try {
          trace = cleanTrace(JSON.parse(String(await $.fs.read(`${dir}/${x.name}`))))
        } catch {
          // Illisible (en pleine écriture) : relue au prochain tour.
        }
        // Seule une trace bien lue se garde : une lecture ratée se refait.
        if (trace) {
          traceCache.set(x.name, { mtime: x.mtimeMs, trace })
          out.push(trace)
        }
      }
    } catch {
      // Dossier absent : seulement `$.store`.
    }
  }
  try {
    for (const key of (await $.store.keys()) as string[]) {
      if (!key.endsWith(':erased')) continue
      const trace = cleanTrace(await $.store.get(key))
      if (trace) out.push(trace)
    }
  } catch {
    // Stockage indisponible : les traces du dossier seulement.
  }
  for (const t of out) if (t.id.startsWith('run:')) erasedRuns.add(t.id.slice(4))
  return out
}

/** Les parcours effacés (leur trace), vus par les dernières lectures : une session liée les lâche (S23). */
const erasedRuns = new Set<string>()

/** Une trace posée par un appel de writeTraces : son fichier, ou sa clé de `$.store`. */
type PosedTrace = { path: string } | { key: string }

/** Une trace de sous-agent ou de lancement (S22, S25) couvre quelle que soit sa date. */
const isUndatedTrace = (id: string): boolean => id.startsWith('agent:') || id.startsWith('call:') || id.startsWith('launch:')

/**
 * Pose les traces (S5) : l'id et la date, rien d'autre, chacune dans un fichier à elle (D2 b) : une
 * trace existante n'est jamais réécrite, une plus récente s'ajoute à côté (la lecture prend la plus
 * récente). Une trace déjà là aussi récente, ou de sous-agent ou de lancement, ne se repose pas.
 * Toutes ou aucune (S29) : si l'une échoue, celles que cet appel vient de poser sont retirées.
 * `ok` : toutes posées ; `none` : aucune posée ; `retracted` : posées puis toutes retirées ;
 * `partial` : le retrait a échoué aussi.
 */
const writeTraces = async ($: any, traces: readonly Trace[]): Promise<'ok' | 'none' | 'retracted' | 'partial'> => {
  const known = await readTraces($)
  const posed: PosedTrace[] = []
  for (const t of traces) {
    const before = known.filter(k => k.id === t.id)
    if (before.length > 0 && (isUndatedTrace(t.id) || before.some(k => k.at >= t.at))) continue
    const value: Trace = { id: t.id, at: t.at }
    const path = tracePath($, value)
    let isWritten = false
    if (path) {
      try {
        // Le même fichier déjà là (même id, même date, en pleine écriture ailleurs) : pas touché.
        if (!(await $.fs.exists(path))) {
          await $.fs.write(path, JSON.stringify(value))
          posed.push({ path })
        }
        isWritten = true
      } catch {
        // Repli sur `$.store`.
      }
    }
    if (!isWritten) {
      try {
        if ((await $.store.get(traceKey(value))) === undefined) {
          await $.store.set(traceKey(value), value)
          posed.push({ key: traceKey(value) })
        }
      } catch {
        // S38 : rien de posé, rien à retirer ; posées puis retirées, une session ouverte a pu s'en servir (S33).
        if (posed.length === 0) return 'none'
        return (await removeTraces($, posed)) ? 'retracted' : 'partial'
      }
    }
    // Le même id plus loin dans la liste (un sous-agent vu dans deux fichiers) ne se repose pas.
    known.push(value)
  }
  return 'ok'
}

/**
 * Retire les traces qu'un effacement vient de poser (S29), et elles seules : un fichier se vide
 * (une trace vide ne se lit plus) puis se supprime, une clé s'efface. Une trace d'avant n'est
 * jamais touchée. Faux quand l'une reste lisible.
 */
const removeTraces = async ($: any, posed: readonly PosedTrace[]): Promise<boolean> => {
  let isOk = true
  for (const p of posed) {
    if ('path' in p) {
      traceCache.delete(p.path.split('/').pop() ?? p.path)
      const done = await eraseWith(
        {
          write: (path, text) => $.fs.write(path, text),
          remove: async (path: string) => {
            const argv = removeArgv(path)
            return argv !== null && (await $.process.run(argv, { timeoutMs: 10_000 })).exitCode === 0
          },
        },
        p.path,
      )
      if (!done.isEmptied) isOk = false
    } else {
      try {
        await $.store.delete(p.key)
      } catch {
        isOk = false
      }
    }
  }
  return isOk
}

/**
 * Ce que dit un effacement dont les traces n'ont pas toutes pu s'écrire (S24, S29). Retirées, elles
 * ont pu servir entre-temps à une session ouverte qui s'est compactée d'après elles (S33) ; aucune
 * posée, rien n'a été effacé (S38).
 */
const tracesRefusedText = (result: 'none' | 'retracted' | 'partial'): string =>
  result === 'none'
    ? 'Effacement impossible : les traces n’ont pas pu s’écrire, rien n’a été effacé.'
    : result === 'retracted'
      ? 'Effacement annulé : les traces n’ont pas pu s’écrire ; une session ouverte a pu en effacer une partie entre-temps.'
      : 'Effacement partiel : les traces n’ont pas toutes pu s’écrire ni se retirer ; une partie de l’historique est masquée, rien d’autre n’a été effacé.'

/**
 * Efface un fichier (S4) : réécrit vide, puis supprimé par `rm` (`del` sous Windows) ; sans
 * commande, le fichier vide reste. Faux quand il n'a pas pu être vidé.
 */
const eraseFile = async ($: any, path: string | null): Promise<boolean> => {
  if (!path) return true
  let isThere = false
  try {
    isThere = await $.fs.exists(path)
  } catch {
    // Hors d'atteinte : rien à effacer là.
  }
  if (!isThere) return true
  const done = await eraseWith(
    {
      write: (p, text) => $.fs.write(p, text),
      // Sans `$.process.run` (surface sans commandes) ou sans commande sûre, le fichier vide reste (S4).
      remove: async (p: string) => {
        const argv = removeArgv(p)
        return argv !== null && (await $.process.run(argv, { timeoutMs: 10_000 })).exitCode === 0
      },
    },
    path,
  )
  if (!done.isEmptied || !done.isRemoved) eraseFailures.push(path.split(/[\\/]/).pop() ?? path)
  return done.isEmptied
}

/** Les fichiers qu'un effacement n'a pas pu vider ou supprimer, dits à la fin (S24). */
let eraseFailures: string[] = []

/** Dit ce qu'un effacement n'a pas pu faire (S24). */
const reportEraseFailures = async ($: any) => {
  if (eraseFailures.length === 0) return
  const names = eraseFailures.slice(0, 3).join(', ') + (eraseFailures.length > 3 ? '…' : '')
  eraseFailures = []
  await quietly(() => $.ui.toast(`Effacement incomplet : ${names} n’a pas pu être supprimé (vidé s’il a pu l’être).`))
}

/** Efface une clé de `$.store` (le repli des fichiers). */
const eraseKey = async ($: any, key: string) => {
  await quietly(async () => {
    if ((await $.store.get(key)) !== undefined) await $.store.delete(key)
  })
}

/** Un texte pris tel quel dans une expression régulière. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Efface tout ce qu'une session a dans le registre : tous ses morceaux et son fichier à part, fichiers et clés. */
const eraseSession = async ($: any, id: string) => {
  const dir = registryDir($)
  const slug = registryPath($, id)?.split('/').pop()?.replace(/\.json$/, '')
  if (dir && slug) {
    let names: string[] = []
    try {
      names = ((await $.fs.list(dir)) as { name: string }[]).map(x => x.name)
    } catch {
      // Dossier absent.
    }
    // Tous ses morceaux, même après un trou (ils s'écrivent du dernier au premier).
    // Les ids sont échappés (F6) : un signe d'expression régulière n'y vise pas d'autres fichiers.
    for (const name of names) if (name === `${slug}.json` || new RegExp(`^${escapeRegExp(slug)}\\.\\d+\\.json$`).test(name)) await eraseFile($, `${dir}/${name}`)
  }
  await quietly(async () => {
    for (const key of (await $.store.keys()) as string[]) if (key === registryKey(id) || new RegExp(`^${escapeRegExp(registryKey(id))}:\\d+$`).test(key)) await eraseKey($, key)
  })
  await eraseFile($, rebuiltPath($, id))
  await eraseKey($, rebuiltKey(id))
  // Sa délégation gardée ne lui fait plus reprendre un parcours effacé (S23).
  await eraseKey($, delegateKey(id))
  otherRegistries.delete(id)
  otherHeads.delete(id)
  historyHeads.delete(id)
}

/** La dernière écriture du fichier d'une session (sa date, sinon celle de son en-tête), pour savoir si elle est fermée (S19). */
const lastWriteOf = async ($: any, head: SessionRegistry): Promise<number> => {
  const file = (await registryFiles($)).find(f => f.session === head.session)
  return file && file.mtime >= 0 ? file.mtime : head.updatedAt
}

/**
 * Le registre entier d'une session dont l'en-tête annonce des morceaux (R1) : ses sous-agents au
 * travail et ce que les traces couvrent peuvent être dans un morceau suivant (les nouveaux vont au
 * dernier). L'en-tête seul quand il n'y a qu'un morceau, ou quand la relecture échoue.
 */
const wholeOf = async ($: any, head: SessionRegistry): Promise<SessionRegistry> => {
  if ((head.parts ?? 1) <= 1) return head
  const got = await readRegistry($, head.session)
  return got.ok && got.value ? got.value : head
}

/**
 * Supprimer un parcours (Q6 a1, S3, S14) : les traces d'abord (le parcours, ses sessions liées,
 * chacun de ses sous-agents), puis cette discussion se compacte, les orchestrateurs fermés sont
 * réécrits sans lui, ses sessions liées fermées s'effacent, et son relais, ses choix et son
 * fichier à part s'effacent. Les sessions ouvertes se compactent elles-mêmes.
 */
const eraseRun = async ($: any, run: Run): Promise<boolean> => (await whileErasing($, `run:${run.id}`, run.title, () => eraseRunNow($, run))) === true

/**
 * R1, S36 : les effacements en cours dans ce processus, par clé (`run:<id>`, `session:<id>`), avec
 * leur titre. En mémoire seulement : un rechargement du mod repart d'une liste vide, et la ligne
 * « effacement en cours » ne peut pas rester bloquée.
 */
const erasingNow = new Map<string, string>()

/**
 * Fait un effacement en le disant dans l'onglet du début à la fin (R1) ; chacun ne retire que le
 * sien (S36). Un second effacement de la même clé déjà en cours ne fait rien (rend null).
 */
const whileErasing = async <T,>($: any, key: string, title: string, work: () => Promise<T>): Promise<T | null> => {
  if (erasingNow.has(key)) return null
  // Un redessin refusé n'arrête rien : la clé part toujours, la ligne ne reste jamais bloquée (S36).
  const redraw = () => {
    try {
      $.ui.invalidate('ui.render')
    } catch {
      // L'onglet se redessinera au prochain changement.
    }
  }
  erasingNow.set(key, title)
  try {
    redraw()
    return await work()
  } finally {
    erasingNow.delete(key)
    redraw()
  }
}

/**
 * D4 (S34) : les sous-agents manqués d'un parcours qu'on supprime, relus dans les transcripts des
 * discussions qui l'ont porté (les sessions liées sont couvertes en entier par leur trace) : ceux
 * dont le départ tombe dans la période où elles le portaient (R3), sauf ceux qu'un registre ou un
 * fichier à part range ailleurs, dans un autre parcours ou suivis en direct sans parcours (S32).
 * `failed` : les transcripts qui n'ont pas pu se relire (S39).
 */
const missedAgentsOf = async ($: any, run: Run, runs: readonly Run[], carriers: readonly SessionRegistry[]): Promise<{ agents: { key: string; agentId?: string }[]; failed: number }> => {
  const agents: { key: string; agentId?: string }[] = []
  let failed = 0
  for (const reg of carriers) {
    // S39 (a) : sans transcript connu, rien ne se relit : non relu.
    if (!reg.transcript) {
      failed += 1
      continue
    }
    const scanned = await scanTranscriptAgents($, reg.transcript, runWindow(run).s)
    failed += scanned.failed
    const carried = runsCarriedBy(runs, reg)
    // Son fichier à part (Q14) range aussi des sous-agents, chacun avec son parcours.
    const side = (await readRebuiltState($, reg.session)).value?.agents ?? []
    for (const a of scanned.agents) {
      if (a.lane.startedAt === undefined || carriedRunAt(carried, reg, a.lane.startedAt) !== run.id) continue
      const known = reg.agents.find(x => x.agentId === a.agentId || (a.meta.toolUseId !== undefined && x.key === a.meta.toolUseId))
      if (known && (known.run !== undefined ? known.run !== run.id : known.source === 'live')) continue
      const ranged = side.find(x => x.agentId === a.agentId)
      if (ranged?.run !== undefined && ranged.run !== run.id) continue
      agents.push({ key: a.meta.toolUseId ?? `agent:${a.agentId}`, agentId: a.agentId })
    }
  }
  return { agents, failed }
}

const eraseRunNow = async ($: any, run: Run): Promise<boolean> => {
  const now = await $.clock.now()
  const self: SessionRegistry | null = await read($, registryAtom)
  const board: Board | null = await read($, boardAtom)
  const heads = await readAllHeads($, self?.session ?? '')
  const stored = await readRelay($, run.id)
  const relay = stored !== null && typeof stored === 'object' && typeof (stored as Relay).sessions === 'object' ? (stored as Relay) : null
  const linkedIds = new Set([...heads.filter(h => h.run === run.id).map(h => h.session), ...Object.keys(relay?.sessions ?? {})])
  if (self) linkedIds.delete(self.session)
  const orchestrators: SessionRegistry[] = []
  // Les discussions qui l'ont porté (S27, S28), à relire pour D4.
  const carriers: SessionRegistry[] = []
  // S39 : une discussion qui l'a porté dont le registre ne se relit pas en entier n'est pas relue : elle compte.
  let unreadCarriers = 0
  const runs = board?.runs.some(r => r.id === run.id) ? board.runs : [...(board?.runs ?? []), run]
  for (const h of heads) {
    if (linkedIds.has(h.session)) continue
    const isMaybe = self !== null && (h.parts ?? 1) > 1 && h.updatedAt >= run.startedAt && isSameProject(self.root, h.root)
    // R5 : une discussion qui l'a porté, même sans sous-agent de lui, perd aussi son id tout de suite.
    const isCarrier = runsCarriedBy([run], h).length > 0
    if (!h.agents.some(a => a.run === run.id) && !isMaybe && !isCarrier) continue
    const full = (await readRegistry($, h.session)).value
    if (!full) {
      if (isCarrier) unreadCarriers += 1
      continue
    }
    const isFullCarrier = runsCarriedBy([run], full).length > 0
    if (isFullCarrier) carriers.push(full)
    if (full.agents.some(a => a.run === run.id) || isFullCarrier) orchestrators.push(full)
  }
  if (self && runsCarriedBy([run], self).length > 0) carriers.unshift(self)
  // S22 : une trace par sous-agent effacé, qu'il vive dans un registre, un fichier à part repris
  // (Q14) ou le fichier du parcours (anciennes lignes).
  const erased: { key: string; agentId?: string }[] = [...(self?.agents ?? []), ...orchestrators.flatMap(o => o.agents)].filter(a => a.run === run.id)
  const sideIds = (await rebuiltIds($)).filter(id => !id.startsWith('run-'))
  for (const id of sideIds) {
    for (const a of (await readRebuiltState($, id)).value?.agents ?? []) if (a.run === run.id) erased.push({ key: a.meta.toolUseId ?? `agent:${a.agentId}`, agentId: a.agentId })
  }
  for (const r of (await readRebuiltState($, runFileId(run.id), `run:${run.id}`)).value?.rows ?? []) erased.push(r)
  // D4 (S34) : relus avant d'effacer, les sous-agents manqués partent aussi ; un transcript qui ne se relit pas n'arrête rien.
  const missed = await missedAgentsOf($, run, runs, carriers)
  missed.failed += unreadCarriers
  erased.push(...missed.agents)
  // Les traces datent de leur pose : ce qui part pendant la relecture dans une session ouverte est couvert aussi.
  const at = await $.clock.now()
  // S25 : les lancements de ses sessions liées, chez les orchestrateurs.
  const launches: string[] = []
  for (const o of [...(self ? [self] : []), ...orchestrators]) {
    for (const ls of linkedSessions({ self: o, run: run.id, relay, others: heads, now })) {
      if ((ls.session !== undefined && linkedIds.has(ls.session)) || ls.how === 'run' || ls.how === 'relay') if (o.linked?.some(l => l.id === ls.key)) launches.push(ls.key)
    }
  }
  const traces: Trace[] = [
    { id: `run:${run.id}`, at },
    ...[...linkedIds].map(id => ({ id, at })),
    ...erased.flatMap(a => agentTraces(a, at)),
    ...launches.map(id => ({ id: `launch:${id}`, at })),
  ]
  // S24, S29 : sans toutes les traces posées, rien n'est effacé, et le parcours reste.
  const posed = await writeTraces($, traces)
  if (posed !== 'ok') {
    await quietly(() => $.ui.toast(tracesRefusedText(posed)))
    return false
  }
  // La pierre tombale prend la date des traces : un parcours mis à jour ailleurs pendant la relecture D4 ne revient pas par la fusion du board.
  await commit($, board => dropRun(board, run.id, at))
  const all = await readTraces($)
  // Cette discussion : tout de suite, dans son état ; son fichier suit à la prochaine écriture.
  if (self) await quietly(() => commitRegistry($, r => applyTraces(r, all)))
  // Un orchestrateur fermé (jugé sans ce que les traces retirent) est réécrit sans le parcours
  // (S14), s'il se relit en entier ; ouvert, il se compacte lui-même.
  for (const o of orchestrators) {
    const head = heads.find(h => h.session === o.session)!
    if (!isClosedSession(applyTraces(o, all) ?? o, await lastWriteOf($, head), now)) continue
    await rewriteCovered($, o.session, all)
  }
  // Ses sessions liées fermées s'effacent ; les ouvertes, ou celles dont l'en-tête ne se lit pas
  // (peut-être en pleine écriture), se compactent d'après la trace (S6).
  for (const id of linkedIds) {
    const head = heads.find(h => h.session === id)
    const isEnded = relay?.sessions[id]?.endedAt !== undefined
    if (head && isClosedSession(await wholeOf($, head), await lastWriteOf($, head), now, isEnded)) await eraseSession($, id)
    // Ouverte aussi, sa délégation gardée part (S23) : rechargée, elle ne reprend pas le parcours effacé.
    else await eraseKey($, delegateKey(id))
  }
  // Les fichiers à part se compactent (seul le rattrapage les écrit : leur session ne le fera pas) ;
  // le sien, son relais et ses choix s'effacent.
  for (const id of sideIds) await updateRebuilt($, id, id, before => before)
  await eraseFile($, rebuiltPath($, runFileId(run.id)))
  await eraseKey($, rebuiltKey(runFileId(run.id)))
  await eraseFile($, relayPath($, run.id))
  await eraseKey($, relayKey(run.id))
  await eraseFile($, decidedPath($, run.id))
  await reportEraseFailures($)
  if (missed.failed > 0) await quietly(() => $.ui.toast(`${missed.failed} ${missed.failed > 1 ? 'transcripts non relus' : 'transcript non relu'} : un sous-agent manqué pourrait revenir sans parcours.`))
  await refreshHistory($)
  return true
}

/** Réécrit le registre d'une session fermée sans ce que les traces couvrent (S14), s'il se relit en entier. */
const rewriteCovered = async ($: any, id: string, traces: readonly Trace[]) => {
  const got = await readRegistry($, id)
  const next = got.ok && got.value && got.isWhole ? applyTraces(got.value, traces) : null
  if (next && !(await writeRegistry($, next, got.placed, got.count))) eraseFailures.push(`${id}.json`)
}

/**
 * « ✗ Oublier » une discussion (S2) : sa trace et celles de ses sessions liées sûres (S15), puis
 * l'effacement de leurs fichiers, tout de suite pour une session fermée ; une session ouverte se
 * compacte elle-même.
 */
const forgetSession = async ($: any, id: string) => {
  const heads = await readAllHeads($, ((await read($, registryAtom)) as SessionRegistry | null)?.session ?? '')
  const shown = historyShown?.key === `session:${id}` ? historyShown : await buildShown($, `session:${id}`, await read($, boardAtom), heads)
  await whileErasing($, `session:${id}`, shown?.title ?? id, () => forgetSessionNow($, id, heads, shown))
}

const forgetSessionNow = async ($: any, id: string, heads: SessionRegistry[], shown: HistoryShown | null) => {
  const now = await $.clock.now()
  const self: SessionRegistry | null = await read($, registryAtom)
  const sure = (shown?.linked ?? []).filter(l => isSureLink(l.session.how) && l.session.session !== undefined).map(l => l.session.session!)
  const ids = [id, ...sure]
  // Q-b (comme S22) : une trace par sous-agent oublié, de son registre ou de son fichier à part ;
  // un sous-agent de fond qui se réveille ensuite ne revient pas dans l'historique.
  const erased: { key: string; agentId?: string }[] = []
  for (const x of ids) {
    const reg = self && x === self.session ? self : (await readRegistry($, x)).value
    erased.push(...(reg?.agents ?? []))
    for (const a of (await readRebuiltState($, x)).value?.agents ?? []) erased.push({ key: a.meta.toolUseId ?? `agent:${a.agentId}`, agentId: a.agentId })
  }
  const posed = await writeTraces($, [...ids.map(x => ({ id: x, at: now })), ...erased.flatMap(a => agentTraces(a, now))])
  if (posed !== 'ok') {
    await quietly(() => $.ui.toast(tracesRefusedText(posed)))
    return
  }
  const all = await readTraces($)
  for (const x of ids) {
    if (self && x === self.session) {
      await quietly(() => commitRegistry($, r => applyTraces(r, all)))
      await updateRebuilt($, x, x, before => before)
      continue
    }
    // Fermée, elle s'efface ; ouverte, ou d'en-tête illisible (peut-être en pleine écriture), elle se compacte elle-même (S6).
    const head = heads.find(h => h.session === x)
    if (head && isClosedSession(await wholeOf($, head), await lastWriteOf($, head), now)) await eraseSession($, x)
    else await updateRebuilt($, x, x, before => before)
  }
  await reportEraseFailures($)
  await update($, uiAtom, ui => ({ ...ui, agentsHistory: undefined, confirmForget: undefined, agentsSession: undefined }))
  historyShown = null
  await refreshHistory($)
}

/**
 * S26 : à chaque relecture, une session fermée qu'une trace couvre et qui ne l'a pas encore
 * appliquée (trace plus récente que sa dernière écriture) est traitée comme à l'effacement :
 * effacée si une trace la couvre toute (la sienne, ou celle du parcours qu'elle servait),
 * réécrite sans ce qu'elles couvrent sinon. Les fichiers à part se compactent quand les traces changent.
 */
let reconciledTraces = ''
/** Les registres en morceaux que les traces ne couvrent pas, par session (date du fichier et traces) : pas relus en entier pour rien. */
const uncoveredParts = new Map<string, string>()
const reconcileErased = async ($: any) => {
  const self: SessionRegistry | null = await read($, registryAtom)
  const traces = await readTraces($)
  if (traces.length === 0) return
  const now = await $.clock.now()
  await readAllHeads($, self?.session ?? '')
  const key = traces.map(t => `${t.id}@${t.at}`).sort().join(',')
  for (const { mtime, head } of [...historyHeads.values()]) {
    // Ce que les traces couvrent encore dans son fichier (tel qu'écrit, tous ses morceaux) ; rien : rien à faire.
    const seen = `${mtime}|${key}`
    if (mtime >= 0 && uncoveredParts.get(head.session) === seen) continue
    const raw = await wholeOf($, head)
    const covered = applyTraces(raw, traces)
    if (!covered) {
      if (raw !== head) uncoveredParts.set(head.session, seen)
      continue
    }
    const last = await lastWriteOf($, raw)
    // Fermée d'après ce qui reste une fois les traces appliquées (S19).
    if (!isClosedSession(covered, last, now)) continue
    const isWhole = traces.some(t => (t.id === raw.session || (raw.run !== undefined && t.id === `run:${raw.run}`)) && t.at > last)
    if (isWhole) await eraseSession($, raw.session)
    else await rewriteCovered($, raw.session, traces)
  }
  if (key !== reconciledTraces) {
    reconciledTraces = key
    for (const id of await rebuiltIds($)) await updateRebuilt($, id, id.startsWith('run-') ? `run:${id.slice(4)}` : id, before => before)
  }
  await reportEraseFailures($)
}

// ─── Prix des modèles (coût estimé des sous-agents) ───────────────────────
//
// Q15 : les prix de ccusage, comme stats-board, repris ici pour que les deux plugins restent
// indépendants. Relevés au plus une fois par jour, essai raté compris, gardés dans `$.store`
// d'une session à l'autre. Sans npx, sans `$.process.run` ou en échec : pas de prix, et la carte
// dit « coût indisponible ». F1 : une version exacte de ccusage, lancée depuis le dossier du mod
// (jamais celui du projet, dont un `.npmrc` détournerait le téléchargement), le registre npm
// officiel imposé.

const PRICES_KEY = 'agentPrices'
const DAY_MS = 86_400_000
/** Les discussions des 60 derniers jours suffisent à tirer les prix des modèles en usage. */
const PRICES_SINCE_MS = 60 * DAY_MS
/** La version de ccusage lancée (F1) : publiée depuis plus de deux semaines, essayée sur ce poste. */
const CCUSAGE = 'ccusage@20.0.30'
const NPM_REGISTRY = 'https://registry.npmjs.org/'
/** `at` : le relevé des prix ; `triedAt` : le dernier essai, réussi ou non (au plus un par jour). */
type KeptPrices = { at: number; prices: Record<string, UnitPrices>; triedAt?: number }
const pricesAtom = atom({ plugin: 'flow-board', key: 'agentPrices' } as const, null as KeptPrices | null)
let isPricing = false
/** Le lanceur de npx qui a marché (Windows en a plusieurs) ; le premier essai les parcourt. */
let npxLauncher: string[] | null = null

const runNpx = async ($: any, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const tries = npxLauncher ? [npxLauncher] : [['npx'], ['npx.cmd'], ['cmd.exe', '/d', '/s', '/c', 'npx']]
  let first: unknown = null
  for (const l of tries) {
    try {
      const res = await $.process.run([...l, ...args], {
        timeoutMs: 240_000,
        cwd: String($.plugin.root),
        env: { NO_COLOR: '1', FORCE_COLOR: '0', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_registry: NPM_REGISTRY },
      })
      npxLauncher = l
      return { exitCode: res.exitCode, stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? '') }
    } catch (err) {
      first ??= err
      // Lancé mais trop lent : un autre lanceur ne ferait pas mieux.
      if (/time|still running|délai/i.test(String(err))) break
    }
  }
  throw first ?? new Error('npx introuvable')
}

/** `AAAAMMJJ` d'un instant, pour `--since` de ccusage. */
const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '')

/**
 * Relève les prix des modèles par ccusage (`claude session --json`), au plus une fois par jour ;
 * second essai `--offline` si le barème en ligne échoue. Hors d'un hook d'outil : ccusage prend
 * quelques secondes. Un échec garde les prix d'avant (ou aucun) jusqu'au lendemain.
 */
const refreshPrices = async ($: any) => {
  if (isPricing) return
  isPricing = true
  try {
    const now = await $.clock.now()
    let kept: KeptPrices | null = await read($, pricesAtom)
    let isKnown = kept !== null
    if (kept === null) {
      await quietly(async () => {
        const stored = (await $.store.get(PRICES_KEY)) as KeptPrices | undefined
        isKnown = true
        if (stored && typeof stored.at === 'number' && stored.prices && typeof stored.prices === 'object') kept = stored
      })
    }
    if (kept !== null && now - (kept.triedAt ?? kept.at) < DAY_MS) {
      await update($, pricesAtom, () => kept)
      return
    }
    // L'essai compte avant même d'aboutir : un échec ne se retente que le lendemain.
    const tried: KeptPrices = { at: kept?.at ?? 0, prices: kept?.prices ?? {}, triedAt: now }
    await update($, pricesAtom, () => tried)
    // Des prix gardés qu'on n'a pas pu relire ne s'écrasent pas.
    if (isKnown) await quietly(() => $.store.set(PRICES_KEY, tried))
    const args = ['-y', CCUSAGE, 'claude', 'session', '--json', '--since', ymd(now - PRICES_SINCE_MS)]
    const once = async (offline: boolean): Promise<unknown> => {
      const res = await runNpx($, offline ? [...args, '--offline'] : args)
      if (res.exitCode !== 0) throw new Error(res.stderr.split('\n')[0] || `code ${res.exitCode}`)
      // Ce qui précède la première accolade (messages de npx) est ignoré, comme dans stats-board.
      const start = res.stdout.indexOf('{')
      const end = res.stdout.lastIndexOf('}')
      if (start < 0 || end < start) throw new Error('sortie illisible (pas de JSON)')
      return JSON.parse(res.stdout.slice(start, end + 1))
    }
    let json: unknown
    try {
      json = await once(false)
    } catch {
      json = await once(true)
    }
    const value: KeptPrices = { at: now, prices: pricesFromCcusage(json), triedAt: now }
    await update($, pricesAtom, () => value)
    await quietly(() => $.store.set(PRICES_KEY, value))
    $.ui.invalidate('ui.render')
  } catch {
    // ccusage absent ou en échec : « coût indisponible », sans erreur.
  } finally {
    isPricing = false
  }
}

// ─── Frise : segments et repères en direct ────────────────────────────────
//
// Chaque requête au modèle et chaque appel d'outil devient un segment daté de sa piste : celle
// du sous-agent qui le fait (`agentId`), ou celle de la session (MAIN). Règles de l'essai du
// ticket 01 : Réflexion du début de la requête au premier morceau de texte ou d'outil,
// Rédaction le temps d'un bloc de texte, l'appel d'outil dès que le modèle l'écrit.

/** La piste d'une boucle : celle du sous-agent, ou celle de la session (fil principal). */
const laneOfLoop = (agentId: unknown): string => (typeof agentId === 'string' && agentId !== '' ? agentId : MAIN)

/** Les appels dont le modèle a commencé l'écriture (morceau `tool`) : leur segment part de là. */
const toolWritten = new Map<string, number>()
/** Une demande d'autorisation en cours, par piste et par outil : le début de l'attente de la personne. */
const permissionAt = new Map<string, number>()
/** La durée hors autorisation de chaque appel (`classic.PostToolUse`). */
const toolDurations = new Map<string, number>()
/** Le dernier `classic.Stop` listait des tâches de fond : le repos qui suit est une attente. */
let hasBackgroundWork = false

const isModelSegment = (s: AgentSegment): boolean => s.k === 'think' || s.k === 'write'

/** Un repère sur une piste ; un suivi raté ne gêne rien. */
const markLane = ($: any, lane: string, mark: AgentMark) => quietly(() => commitRegistry($, reg => addRegistryMark(reg, lane, mark, mark.at)))

/** La piste du lanceur d'un sous-agent (son parent, ou la session) et sa clé. */
const launcherOf = async ($: any, agentId: string): Promise<{ lane: string; key: string } | null> => {
  const reg: SessionRegistry | null = await read($, registryAtom)
  const agent = reg?.agents.find(a => a.agentId === agentId)
  return agent ? { lane: agent.parent ?? MAIN, key: agent.key } : null
}

/**
 * Un appel d'outil devient un segment de sa piste : ouvert à son écriture par le modèle (ou à son
 * départ), fermé à son retour. Une question posée est une attente de la personne ; une
 * autorisation demandée coupe le segment par une attente de la personne (essai, point 5).
 */
const timedTool = async ($: any, e: any, inner: () => Promise<any>) => {
  const lane = laneOfLoop(e.agentId)
  const id = String(e.tool_use_id ?? '')
  const tool = String(e.tool)
  const written = toolWritten.get(id)
  toolWritten.delete(id)
  const startedAt = written ?? (await $.clock.now())
  const arg = shortArg(tool, e as Record<string, unknown>)
  const seg: AgentSegment = { k: tool === 'AskUserQuestion' ? 'waitPerson' : 'tool', s: startedAt, f: toolFamily(tool), t: tool }
  if (arg !== undefined) seg.a = arg
  await quietly(() => commitRegistry($, reg => openSegment(reg, lane, seg, startedAt)))
  let ran: any
  try {
    ran = await inner()
    return ran
  } finally {
    await quietly(async () => {
      const end = await $.clock.now()
      const permission = permissionAt.get(`${lane}|${tool}`)
      permissionAt.delete(`${lane}|${tool}`)
      const execMs = toolDurations.get(id)
      toolDurations.delete(id)
      const isError = ran === undefined || ran.isError === true || ran.deny !== undefined
      // Un sous-agent rendu `completed` dans l'appel : le lanceur l'a attendu au premier plan.
      const isForeground = tool === 'Agent' && (ran?.result as { status?: string } | undefined)?.status === 'completed'
      const patch: Partial<AgentSegment> = {}
      if (isError) patch.x = true
      if (isForeground) patch.k = 'waitAgent'
      await commitRegistry($, reg =>
        closeToolCall(reg, lane, tool, { end, patch, start: startedAt, ...(permission !== undefined && execMs !== undefined ? { permission: { at: permission, execMs } } : {}) }),
      )
      if (isError && ran?.deny === undefined) await markLane($, lane, { k: 'fail', at: end })
      if (!isError) {
        const lines = linesOf(tool, e as Record<string, unknown>)
        await commitRegistry($, reg => addLines(reg, lane, lines.added, lines.removed, end))
      }
      // Sur l'orchestrateur : les commits et les verdicts de tests, d'où qu'ils viennent.
      if ((tool === 'Bash' || tool === 'PowerShell') && ran !== undefined && ran.deny === undefined) {
        const record = ran.result as { stdout?: unknown } | undefined
        const out = typeof record?.stdout === 'string' ? record.stdout : typeof ran.text === 'string' ? ran.text : ''
        const signals = commandSignals(String(e.command ?? ''), ran.isError !== true, out)
        if (signals.commit !== undefined) await markLane($, MAIN, { k: 'commit', at: end })
        if (signals.test !== undefined) await markLane($, MAIN, { k: 'test', at: end, ok: signals.test })
      }
    })
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

/** Les zones sensibles, dites en français dans les briefs. */
const SENSITIVE_AREAS_FR = 'confidentialité, suppression de données, chiffrement, concurrence'

/** La règle des revues, citée par les consignes des relecteurs des sessions liées. */
const REVIEW_RULE_FR = 'règle des revues, config/rules/agents.md quand elle est installée'

/** Un relecteur lancé par l'outil Agent reçoit le chemin de son fichier de consignes dans son prompt. */
const INSTRUCTIONS_IN_PROMPT_FR = `ses consignes dans un fichier dont le chemin va dans son prompt (${REVIEW_RULE_FR})`

/**
 * La revue de sécurité d'un groupe dans sa session liée : un sous-agent relecteur au périmètre
 * explicite, pas `/security-review`, qui calcule son diff contre la branche par défaut et relit
 * aussi les autres groupes (il ignore la base qu'on lui donne). Les failles vont au compte rendu.
 */
const linkedSecurityReview = (scope: string): string =>
  `la confier à un sous-agent relecteur (outil Agent, type general-purpose, modèle opus, effort high ou xhigh selon le critère du fichier de méthode), en lecture seule, avec pour seul périmètre ${scope} et pour méthode ${securityMethodFr()}, ${INSTRUCTIONS_IN_PROMPT_FR} ; ne pas lancer /security-review, qui relit la branche face à la branche par défaut, donc aussi les autres groupes ; ne pas corriger ce qu'il trouve : les failles vont dans le compte rendu ; ${SECURITY_FIXES_FR}`

/** Le fichier de méthode de la revue de sécurité, dit dans les consignes en français : cité, jamais recopié. */
const securityMethodFr = (): string =>
  `le fichier de méthode de la revue de sécurité, ${securityMethod} (il le suit : catégories, exclusions, une recherche puis une vérification par faille, seuil 8/10, format du rapport ; son chemin va dans le prompt du relecteur, à côté du fichier de consignes)`

/** C5 a : la revue reste en lecture seule et rend des correctifs prêts, que la personne accepte en une ligne. */
const SECURITY_FIXES_FR =
  "chaque faille gardée arrive numérotée (F1, F2…) avec un correctif prêt (ce qu'il change, le choix qu'il implique s'il y en a un), la liste « à surveiller » à part ; une réponse comme « corrige F1 et F3 » suffit : la session applique ces correctifs, les teste, les commite, puis envoie \"fixed\" à l'outil flow ; \"findings\" ne compte que les failles gardées"

/**
 * Les choix déjà déclarés du parcours, à donner à une revue pour qu'elle ne les resignale pas : le
 * chemin du fichier que tient la discussion principale, pas une liste recopiée à la main.
 * `path` nul : le fichier est hors d'atteinte, la session donne alors ses propres choix.
 */
const decidedList = (path: string | null): string =>
  path
    ? `le chemin du fichier des choix déjà déclarés du parcours, ${path} (tenu par l'outil flow, à relire au moment de la revue), et en plus les choix que la session a déclarés et qui n'y figurent pas encore (ils n'y arrivent qu'une fois lus par la discussion principale), à ne pas resignaler ni défaire`
    : 'la liste des choix déjà déclarés dans {"decided": …} de l\'outil flow (ceux que tu connais, ceux de la session compris), à ne pas resignaler ni défaire'

/** Commit avant la revue, en français pour le brief des sessions liées (même règle que COMMIT_BEFORE_REVIEW). */
const COMMIT_BEFORE_REVIEW_FR =
  "un ticket dit hors zone sensible (\"sensitive\": false) se commite dès ses contrôles passés, avant sa revue, pour que le ticket suivant démarre pendant qu'elle tourne : sa cible est alors <commit d'avant le ticket>..<commit du ticket>, jamais ..HEAD (HEAD et l'arbre portent déjà le ticket suivant) ; ses correctifs arrivent dans un commit à part, ses constats partent dans \"review\" sans \"step\", et le ticket ne passe « fait » dans le tracker qu'une fois sa revue revenue et ses correctifs commités ; un ticket qui touche une zone sensible, ou ne l'a pas dit, garde sa revue avant son commit"

/**
 * La consigne que tout relecteur reçoit telle quelle : un relecteur avait rendu son rapport avant
 * le second axe (revue Spec lancée deux fois), et une passe `--fix` avait appliqué un correctif
 * laissé à un autre groupe. Le tri des constats suit celui de `REVIEWER_BRIEF`.
 */
const REVIEWER_BRIEF_FR =
  "la consigne des relecteurs, à leur donner telle quelle : si la revue a plusieurs axes (Standards et Spec), ne rendre son rapport qu'une fois tous les axes revenus, sans relancer un axe déjà lancé ; ne relancer ni les tests ni les contrôles (la session les a lancés) ; classer à part les constats sur du code antérieur au lot (des lignes qu'il n'a pas changées) : ne pas les corriger, ils me sont proposés comme un groupe « durcissement » en fin de lot ; étiqueter chaque constat Important, Mineur ou Antérieur (le code antérieur au lot, juste avant) : seuls les Importants sont corrigés, les Mineurs (style, nommage, nettoyage qui ne change aucun comportement) sont listés sans être corrigés, pour qu'un constat mineur ne coûte ni commit ni nouveau tour de revue ; pour un défaut, nommer sa classe (le motif, pas seulement la ligne) pour que toutes ses occurrences soient corrigées ; ne signaler comme défaut ni appliquer rien de ce que la spec, le ticket ou le fichier des choix laisse à un autre groupe ou exclut ; ne pas resignaler ni défaire les choix de ce fichier ; ne jamais écrire dans l'arbre de travail, même un instant (un test qui prouve un défaut reste à la session) : les seules écritures sont les correctifs d'une revue de groupe"

/**
 * Le canal des consignes d'une revue dans une session liée : `/code-review` tourne en exécution
 * dérivée et ne reçoit que ses arguments (forme essayée avec Claude Code 2.1.310, voir
 * `reviewInstructions`), et un hash seul lui avait fait relire un commit au lieu du groupe.
 */
const reviewInstructionsFr = (isRepo: boolean): string =>
  `écrire ses consignes dans un fichier de son dossier temporaire (le périmètre, le chemin du fichier des choix, les points qui me sont réservés, ce qu'elle ne doit pas faire, et la consigne des relecteurs) et en passer le chemin après la cible, ${isRepo ? "/code-review <niveau> <base>..HEAD consignes : <chemin> (la cible est toujours une plage <base>..HEAD ou une branche, jamais un hash seul ; avant le commit du ticket, le périmètre nomme aussi les changements non commités)" : '/code-review <niveau> consignes : <chemin> (le fichier liste les copies et les fichiers à comparer)'}, et à un sous-agent relecteur dans son prompt (${REVIEW_RULE_FR})`

/** Le seuil d'un seul relecteur pour les deux axes (`SMALL_DIFF`). */
const SMALL_DIFF_FR = 'moins de 100 lignes comptées par git diff --numstat, sans fichiers générés ni binaires, et hors zone sensible : les deux axes dans un seul sous-agent relecteur ; sinon deux en parallèle'

/** Un groupe d'un seul ticket sans logique ni zone sensible (`SINGLE_TICKET_GROUP`). */
const SINGLE_TICKET_GROUP_FR = "un groupe d'un seul ticket ni sensible ni avec logique n'a pas de revue du groupe : la revue de son ticket est la seule, et la sécurité se juge une fois ce ticket commité"

/** Une revue de groupe en zone sensible n'applique rien seule : son relecteur trie les constats. */
const SENSITIVE_NO_FIX_FR = `si un ticket du groupe touche une zone sensible (${SENSITIVE_AREAS_FR}), sans --fix : le relecteur applique lui-même les seuls constats qu'il retient`

/** Ce qu'une passe `/code-review --fix` fait d'un conflit entre la spec et une consigne. */
const NO_ARBITRATION = "elle ne tranche pas un conflit entre la spec et une consigne (CLAUDE.md, une demande de ma part) : elle ne corrige pas ce point et me le remonte"

/**
 * Le relecteur de la revue d'un groupe (`/code-review high --fix`) dans une session liée : un
 * sous-agent Opus en effort high, et c'est lui qui écrit les correctifs de `--fix`, pour
 * qu'ils aient son modèle et son effort. Seule exception à « sans sous-agents qui écrivent » : il
 * tourne seul, une fois les tickets commités, et la session relit ses correctifs avant de les commiter.
 */
const LINKED_GROUP_REVIEWER =
  `un sous-agent relecteur (outil Agent, type general-purpose, modèle opus, effort high ; ${REVIEW_RULE_FR}), le seul sous-agent qui écrit : il lance lui-même la revue et applique lui-même ses correctifs`

/** Le même sous-agent relecteur, dit à Claude dans la discussion principale. */
const securityReviewer = (scope: string): string =>
  `launch it yourself: a reviewer subagent (Agent tool, general-purpose, model opus, effort high or xhigh as the criterion of the method file decides), read-only, limited to ${scope}; give it in its prompt the path of the security review method file, ${securityMethod} (it follows it: categories, exclusions, one search then one verification subtask per finding, threshold 8/10, report format), next to ${INSTRUCTIONS_IN_PROMPT}; never /security-review, which diffs against the default branch and rereads the other groups too. The subagent fixes nothing: each kept finding comes numbered (F1, F2…) with a ready fix (what it changes, and the choice it implies if any), the "to watch" list apart. Tell the user plainly; they decide: a reply such as "fix F1 and F3" is enough: apply those fixes, test them, commit them, then send "fixed". Create a tracker task for each kept finding left unfixed`

/** La revue de sécurité après la revue d'un groupe : Claude juge, puis la lance lui-même. */
const securityAdvice = (isRepo: boolean): string =>
  `- Security review: in the same message as the review of a finished group (/code-review high --fix, or high for a sensitive group), since it is read-only and does not wait for the fixes, judge whether a security review is worth it (its changes touch ${SECURITY_CRITERIA}). Tell the user in one line, with the reason, and send {"security": {"group": "<id>", "advised": true|false, "why": "<short reason, in the user's language>"}}. If it is worth it, ${securityReviewer(isRepo ? "git diff <group base>..HEAD (<group base>: the commit before the group's first ticket)" : `the group's diff (${NO_GIT_GROUP_FIXED_POINT}; new files read whole)`)}. Once the group review's fixes are committed, have it (or a new reviewer) read the diff of those fixes only, with the same criteria. Then send {"security": {"group": "<id>", "findings": <kept findings, not the to-watch list>, "fixed": <fixed>}}.`

/** Le même avis pour un parcours sans groupes (relecture de branche, chasse au bug, TDD) : il porte sur tout le lot. */
const lotSecurityAdvice = (): string =>
  `- Security review: once this review is done and its fixes are in, judge whether a security review is worth it on these changes (they touch ${SECURITY_CRITERIA}). Tell the user in one line, with the reason, and send {"security": {"advised": true|false, "why": "<short reason, in the user's language>"}}, without "group": it covers the whole run. If it is worth it, ${securityReviewer('the changes this review covered')}. Then send {"security": {"findings": <kept findings, not the to-watch list>, "fixed": <fixed>}}.`

/** La revue d'un groupe, lancée par la personne depuis la ligne du groupe : ce qu'elle doit savoir. */
const groupReviewNote = (isRepo: boolean): string =>
  `- This is the review of a finished group${isRepo ? '' : ` (${NO_GIT_GROUP_FIXED_POINT}: give it these copies and files)`}: run it in ${GROUP_REVIEWER}, not in this discussion, and give that subagent these instructions (it does not receive them). Focus it on the interactions between the group's tickets (each one had its own review), and give it the path of the file of declared choices and the reviewer brief (both under "Declared choices" below). ${SENSITIVE_NO_FIX[0]!.toUpperCase()}${SENSITIVE_NO_FIX.slice(1)}. It does not settle a conflict between the spec and an instruction (CLAUDE.md, a request of the user): leave that point unfixed and raise it to the user. Then read the diff of its fixes, rerun the checks and commit them.`

/** La passe « bogues » d'un ticket en cours (zone sensible) : pas la revue du groupe. */
const bugPassNote = (isRepo: boolean): string =>
  `- This is the bug pass of the ticket in progress (sensitive area), not the review of a group: same scope as its /mattpocock-skills:code-review (${isRepo ? TICKET_FIXED_POINT : NO_GIT_TICKET_FIXED_POINT}); give it the path of the file of declared choices and the reviewer brief (both under "Declared choices" below). Report its findings with the ticket's review ("review"), then commit the ticket.`

/** Les skills de cadrage : un choix sensible y devient une question, jamais un choix déclaré. */
const FRAMING_SKILLS = new Set(['grilling', 'grill-with-docs', 'grill-me', 'to-questionnaire', 'to-spec', 'to-tickets', 'domain-modeling'])

/** Les consignes où une revue reçoit le fichier des choix déclarés. */
const REVIEW_NOTES = new Set(['implement', 'implement-spec', 'final-review', 'code-review', 'branch-review'])

const coachingNote = (id: string, run: Run, sync: SyncState, isRepo: boolean, session?: string, decidedAt?: string | null, failedAgents = 0): string => {
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
    lines.push('- Give each ticket the repo paths it touches, read from its acceptance criteria: {"tickets": [{"id": "...", "files": ["<pages, tables, shared files such as a model or a measures file>"]}]}. Name files, not a whole folder, unless the ticket creates files in it: a folder blocks every group that names a file inside it. README, DECISIONS.md and the code map (carte-du-code.md, CODEMAP.md) stay out of "files": almost every ticket cites them, their additions merge without trouble, and the dashboard ignores them anyway.')
    lines.push('- Each ticket says, on lines of its own, « Zone sensible : oui/non (pourquoi) » and « Logique : oui/non » (no logic: a visual asset, a document), and you send both: {"tickets": [{"id": "...", "sensitive": true|false, "logic": true|false}]}.')
    lines.push('- A write to CLAUDE.md never goes into the done criteria of a group ticket: a linked session cannot make it. It is a gesture of the main discussion, done when the group is back.')
    lines.push('- Last, group the tickets for execution: {"groups": [{"id": "A", "name": "<short theme>", "tickets": ["<ids in execution order>"], "why": "<the shared context>", "files": ["<other repo paths it touches>"], "resources": ["<what it cannot share>"], "continuesHere": true}]}. Same group = same files or modules, or a chain of dependencies: one discussion does them in a row with /implement. A different context = another group; a group of one ticket is fine when its context is its own, and a ticket that blocks nothing in its theme but could start now (an export, a query, a data check) is often better in a group of its own or with other data work. Groups that share no file, no resource and do not depend on each other can later run at the same time, one linked session per group (or /implement-spec, one subagent per group, in a git repository only). "resources": what a group cannot share with another group working at the same time, with the same name in every group: an application driven on screen and checked by screenshots (e.g. "PowerBI Desktop"), a single database, device or account; check the project\'s CLAUDE.md for such constraints. Set "continuesHere" on at most one group, the one that benefits from the context of this discussion. Every ticket in exactly one group.')
  }
  if (id === 'implement') {
    lines.push('- For each ticket, the steps above restart from "read". With "review", send the findings of the two axes: {"step": "review", "review": {"standards": <findings>, "spec": <findings>, "fixed": <fixed>}}.')
    lines.push('- In this discussion, /code-review (Claude Code) runs only as the bug pass of a ticket that touches a sensitive area. The review of a group, /code-review high --fix (high without --fix for a group with a sensitive ticket), is launched by the user from the dashboard once the group\'s tickets are committed: do not launch it yourself.')
  }
  if (def.groupSteps) {
    lines.push(`- Then, for each group once all its tickets are committed and reviewed (their review fixes committed), in this order: ${def.groupSteps.map(s => `${s.label} (${hintOf(s, isRepo)})`).join('; ')}.`)
    lines.push(`- ${SINGLE_TICKET_GROUP}.`)
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
      lines.push(hasGroups ? securityAdvice(isRepo) : lotSecurityAdvice())
    }
  }
  if (id === 'branch-review') {
    lines.push('- The review target and options (a PR number, a branch, --fix, --comment) are in the command arguments; if none is given, review the current branch against its base.')
    lines.push(lotSecurityAdvice())
  }
  // La phase « Revue » de Chasse au bug, TDD ou Revue de code (le /code-review de Matt), sans groupes.
  if (id === 'code-review' && currentPhase(run).skill === 'code-review' && !hasGroups) lines.push(lotSecurityAdvice())
  // Un /security-review tapé à la main : il relit toute la branche ; son résultat se rend pareil.
  if (id === 'security-review') {
    lines.push('- When the security review is done, tell the user plainly what it found. Fix a finding only once the user agrees; create a tracker task for each real finding left unfixed. Then send {"security": {"group": "<id>", "findings": <kept findings, not the to-watch list>, "fixed": <fixed>}}.')
  }
  if (id === 'compte-rendu') {
    lines.push('- What the dashboard knows about this run (start from it, then check and complete it with git and the tracker):')
    lines.push(...reportFacts(run, failedAgents).map(l => `  ${l}`))
    lines.push('- When the report is written: {"step": "validate"}. Never send {"complete": true}: the user validates the report from the dashboard (✓ Valider le rapport). If the user asks for changes, rewrite the report and send {"step": "validate"} again.')
  }
  const advice = CODE_SKILLS.has(id) ? syncAdvice(sync) : null
  if (advice) {
    lines.push(`- The remote moved (${advice.reason}). Before your first code change, ask the user to run ${advice.commands.map(commandText).join(' then ')} (user-only commands) and wait until it is done.`)
  }
  if (FRAMING_SKILLS.has(id)) {
    lines.push(
      `- A choice that touches a sensitive area (${SENSITIVE_AREAS}) is never a declared choice ({"decided": …}): ask the user while framing, with options, and wait for the answer. Before a privacy question, have a read-only subagent check the real exposure (who can read the data, from where, with what access); without that check, the question says the exposure is "à confirmer". A decision entry (DECISIONS.md, an ADR) copies the question asked and the accepted answer word for word, the user's sentence in quotes, instead of summarising them.`,
    )
  }
  if (id === 'implement' && (run.groups ?? []).length > 1 && !(run.groups ?? []).some(g => g.linked !== undefined || g.delegated !== undefined)) {
    lines.push(
      '- At the start of implementation, if groups of this run may go to linked sessions, ask the user once to rename this discussion to its final name (CLI: /rename <name>; app: rename the discussion), before the first linked session, and wait until it is done: the name given in the linked sessions\' briefs must not change afterwards, or their reports get lost.',
    )
  }
  if (id === 'retro') {
    lines.push(
      '- Improvements that touch another repository (shared plugins, common config, another project) are not applied from this discussion: keep them out of the items and give them in your message as a correction list ready to hand to an agent working in that repository, one point per improvement: the finding, then the expected correction, with the plugin or files it touches. Only the improvements of this repository go to the items, hence to a linked session.',
    )
  }
  if (REVIEW_NOTES.has(id)) {
    lines.push(
      decidedAt
        ? `- Declared choices: the file ${decidedAt}, kept by the flow tool from every "decided" of this run (main discussion and linked sessions). Give its path to every reviewer instead of pasting the list, with this reviewer brief, word for word: ${REVIEWER_BRIEF}. To that end, ${reviewInstructions(isRepo)}.`
        : `- Declared choices: their file is out of reach; give every reviewer the list of the choices sent in "decided" of the flow tool, with this reviewer brief, word for word: ${REVIEWER_BRIEF}. To that end, ${reviewInstructions(isRepo)}.`,
    )
  }
  if (id === 'implement' || id === 'implement-spec') {
    lines.push('- When every ticket of the lot is done: {"complete": true}. If reviews kept apart findings on code older than the lot, propose them to the user as a « durcissement » group (one ticket per finding), without creating it before they agree. A finished group is not the end: while tickets of the lot remain open, the next step is the next group, which the user launches from the dashboard (▶ Lancer). Do not suggest /flow-board:compte-rendu or the delivery before every ticket is done. Add {"note": "<one short line>"} for a decision worth keeping.')
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
const launch = async ($: any, skill: string, given?: string) => {
  if (skill === 'retro' && (await launchRetro($))) return
  const args = given ?? commandArgsOf(activeRun(await read($, boardAtom)), skill)
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
  const args = commandArgsOf(run, skill)
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
    `1) D'abord, lance un sous-agent par session fille, tous en parallèle et en lecture seule (general-purpose, pas Haiku) : chacun lit le transcript de sa session, son fichier .jsonl sous ~/.claude/projects/ (pas claude logs, dont la sortie de terminal est illisible), et en fait la rétro selon les étapes et les sept axes de ce skill, que tu lui transmets tels que tu les lis ici ; il ne modifie rien et rend ses pistes par sévérité, une par ligne « axe : correction », chacune avec ce qui l'a révélée dans la session. ` +
    `2) Pendant ce temps, fais la rétro de cette discussion. ` +
    `3) Une fois tous les sous-agents revenus, fais le compte rendu global : les pistes de toutes les sessions, fusionnées et sans doublon, par sévérité, chacune avec la ou les sessions où elle est apparue ; seules les pistes de ce dépôt vont dans les items de l'outil flow (donc, au choix, à une session liée) ; celles qui touchent un autre dépôt (plugins, config commune, autre projet) n'y vont pas : rends-les à part, en une liste de corrections prête à confier à un agent de ce dépôt, un point par piste, le constat puis la correction attendue.`
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
 * non plus. La fille finit par un SendMessage, qui réveille la discussion principale même
 * inactive ; plus de filet d'inactivité (0.56.0) : son avis arrivait au premier arrêt de la fille.
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
    (o.ownFolder && o.isRepo
      ? "Si le projet déclare une installation de worktree (son CLAUDE.md ou son document pour les sessions déléguées : une commande à lancer dans un worktree neuf), écris-la en clair en tête du background : c'est la première commande de la session, avant toute lecture, car les documents du projet peuvent manquer tant qu'elle n'a pas tourné ; sinon, écris qu'aucune installation n'est déclarée. "
      : '') +
    `Le prompt désigne cette discussion par sa seule référence entre crochets ([<ref>]), à passer aussi dans "main" de l'appel delegate : son nom peut changer, sa référence non. Pour lui écrire, ${each} appelle ListAgents, trouve la ligne qui porte cette référence et envoie par SendMessage à « <nom du moment> [<ref>] » tel que la liste l'affiche ; si aucune ligne ne la porte, ${each} le dit en tête de sa réponse finale. ` +
    `Le prompt demande à ${each} de finir par un message à cette discussion (il la réveille, même inactive) : son compte rendu, ou la ligne qui y renvoie quand il le fait déposer au relais. ` +
    `Pas de filet d'inactivité (un avis au premier arrêt de la session, souvent sans rien à faire) : le message final de ${each} réveille cette discussion ; pour un groupe, le relais rattrape un message perdu. `
  )
}

/**
 * L'effort d'une session de groupe : medium par défaut, ses tickets étant cadrés et ses revues
 * confiées à des sous-agents à l'effort explicite ; high pour un groupe délicat.
 */
const GROUP_EFFORT = (many: boolean): string =>
  `Effort de ${many ? 'chaque session (<effort>, choisi groupe par groupe)' : 'la session (<effort>)'} : medium par défaut ; high si ${many ? 'son' : 'le'} groupe a un ticket qui touche une zone sensible (${SENSITIVE_AREAS_FR}), s'il reste des choix de conception à faire ou s'il touche plusieurs modules à la fois. Dis-moi en une ligne l'effort choisi${many ? ' pour chaque groupe' : ''} et pourquoi.`

/**
 * Ce que le background d'une session liée garde : ce qui varie d'une session à l'autre. Les règles
 * (écritures permises, gestes réservés, dépôt public, modèle et effort des revues) se citent par
 * leur document : recopiées, elles se périmaient (un brief imposait encore un effort abandonné).
 */
const BACKGROUND = (many: boolean): string =>
  "Rédige toi-même le background, sans y reprendre le texte des règles : les règles de travail de la session (écritures permises, gestes qui me sont réservés, dépôt public, contraintes du projet) sont dans le document du projet pour les sessions déléguées s'il en a un (son CLAUDE.md le nomme), sinon dans son CLAUDE.md, et le modèle et l'effort des revues dans mes règles communes (config/rules/agents.md quand elles sont installées) ; la session les charge d'elle-même, le background les cite par leur chemin : un texte repris se périme quand la règle change. " +
  `Il ne garde que ce qui varie : le projet en une phrase, ${many ? 'le groupe de la session et ses tickets' : 'le groupe et ses tickets'}, la ressource à ne pas partager${many ? ', ce que font les autres sessions en même temps' : ''}, les décisions déjà prises par renvoi, sans les réécrire : le fichier de décisions du projet (DECISIONS.md, ou celui que nomme son CLAUDE.md) et les commentaires « mise à jour du porteur » des tickets font foi, et une décision que je viens de prendre ici s'y écrit AVANT d'être relayée, avec ma phrase exacte entre guillemets ; une décision qui remplace un geste humain (un accord, une validation, un ok de dépense) se confirme par moi directement dans la session liée, jamais par ton seul message ; `

/**
 * Une commande sans délai maximal lancée en arrière-plan peut ne jamais finir : deux sessions ont
 * rendu la main sur « j'attends le résultat » pendant des heures. La notification de fin ne couvre
 * pas ce cas.
 */
const LONG_COMMANDS =
  "une commande longue (tests, build) se lance avec un délai maximal : au premier plan, le paramètre timeout de l'outil Bash ; en arrière-plan, un délai dans la commande elle-même (option de délai du lanceur de tests, ou timeout s'il existe) ; ne jamais rendre la main en attendant un processus d'arrière-plan qui n'a pas de délai : le surveiller (outil Monitor) ou l'arrêter"

/** Comment la discussion principale suit une session liée : `claude logs` rend une sortie de terminal illisible. */
const FOLLOW = (isRepo: boolean): string =>
  `pour savoir où en est une session, lire ${isRepo ? "l'état git de son worktree (git -C <worktree> log --oneline et git -C <worktree> status)" : 'les fichiers modifiés dans ce dossier'}, le tracker (statuts des tickets) et ListAgents (la session est-elle encore là), jamais claude logs, dont la sortie de terminal est illisible`

/** Ce qui sert de note de fin à la discussion principale, selon que la session a été lancée par l'app ou par le CLI. */
const atEnd = (whose: string): string => `À la note de fin de ${whose} (dans le CLI : son message reçu par SendMessage)`

/** Une faille corrigée après le retour d'un groupe : sans nouvel envoi, le tableau de bord gardait « 0 corrigé ». */
const FIXED_LATER = "une faille corrigée après coup (avec mon accord) se renvoie aussi, avec \"fixed\" mis à jour, sinon le tableau de bord garde « 0 corrigé »"

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
const delegationText = async ($: any, run: Run, views: readonly GroupView[], isFirst = false, decidedAt: string | null = null): Promise<string> => {
  noteSecurityMethod($)
  // Sans git, pas de worktree possible : les sessions travaillent dans ce dossier.
  const isRepo = await measureRepo($)
  const implement = `/${await commandFor($, 'implement')}`
  const tdd = `/${await commandFor($, 'tdd')}`
  const ticketReview = `/${await commandFor($, 'code-review')}`
  const ticketPoint = isRepo ? "point fixe : le commit d'avant le ticket" : LINKED_NO_GIT_TICKET_POINT
  const many = views.length > 1
  const delegate = `{"delegate": "${run.id}", "group": "${many ? '<id du groupe>' : views[0]!.group.id}", "main": "[<ref>]"}`
  const decided = decidedList(decidedAt)
  const groups = views.map(v => `Groupe ${v.group.id} (${v.group.name}) : ${ticketList(run, v.open.map(t => t.id))}`).join(' ∥ ')
  const prefix = linkedPrefix(run)
  return (
    `${many ? 'Confie chacun de ces groupes à sa session liée, en parallèle,' : 'Confie ce groupe à une session liée,'} pour le parcours « ${run.title} » : ${groups}. ` +
    (isFirst
      ? "C'est la première session liée de ce parcours : si ce n'est pas déjà fait (la consigne d'/implement l'a peut-être demandé), demande-moi d'abord de renommer cette discussion de son nom définitif (dans le CLI : /rename <nom> ; dans l'app : renommer la discussion) et attends que ce soit fait ; ce nom, donné dans les briefs, ne doit plus bouger ensuite, sinon les comptes rendus se perdent. "
      : '') +
    `Avant de lancer : repère ce dont ${many ? 'les sessions auront' : 'la session aura'} besoin de ma part (une décision, un accès, un geste qui m'est réservé) et règle-le d'abord avec moi ici, sinon ${many ? 'elles y buteront' : 'elle y butera'}. ` +
    `Puis lance ${many ? 'une session par groupe' : 'la session'}, avec un titre qui commence par « ${prefix}Groupe <id> · » : le début dit de quelle discussion ${many ? 'elles viennent' : 'elle vient'}, et « Groupe <id> » relie la session à son groupe au tableau de bord. ` +
    launchHow({ many, isRepo, ownFolder: true, title: `${prefix}Groupe <id> · <thème>`, worktree: 'groupe-<id>', effort: GROUP_EFFORT(many) }) +
    `${BACKGROUND(many)}${decidedAt ? `le fichier des choix déjà déclarés du parcours se cite par son chemin, ${decidedAt}` : 'les choix déjà déclarés (ceux envoyés dans decided) se donnent en liste : leur fichier est hors d\'atteinte'}. ` +
    `Le prompt de ${many ? 'chaque session' : 'la session'} : 1) d'abord, appeler une seule fois l'outil flow de flow-board avec ${delegate} : le parcours reste ici, et l'avancement de la session (statuts Asana des tickets, commits, tests) est relayé tout seul au tableau de bord d'ici ; ` +
    `2) avant le premier ticket, me poser en une fois les questions sensibles du groupe (un choix qui touche ${SENSITIVE_AREAS_FR}, que les tickets laissent ouvert) et attendre mes réponses ; puis faire les tickets du groupe, un par un et dans l'ordre, chacun ainsi : relire d'abord le fichier de décisions du projet et les commentaires « mise à jour du porteur » du ticket (ils priment sur ce prompt) ; le passer « en cours » dans le tracker en le commençant (le relais y reconnaît la passe « bogues » d'un ticket en cours) ; un geste de ma part que le groupe prévoit lui-même (un ok, une vérification à l'écran, une réponse sur un ticket du groupe) n'est pas un blocage externe : le ticket reste « en cours », ligne « Statut : en attente (porteur) », jamais « blocked » au tableau de bord ; ${isRepo ? '' : `${LINKED_NO_GIT_COPY} ; ensuite `}${tdd} par l'outil Skill (sauter ${tdd} pour un ticket sans comportement testable : une ressource visuelle, un document), les contrôles du projet, ${ticketReview} par l'outil Skill sur les seuls changements du ticket (${ticketPoint}), même pour un petit diff (${SMALL_DIFF_FR}) ; si le ticket touche une zone sensible (${SENSITIVE_AREAS_FR}), lancer dans le même message la passe « bogues » /${slashOf('final-review')} xhigh (outil Skill « ${slashOf('final-review')} », arguments « xhigh ${isRepo ? '<base>..HEAD ' : ''}consignes : <chemin> »), sur le même périmètre (${ticketPoint}), en lui donnant ${decided} ; à chaque revue, ${reviewInstructionsFr(isRepo)}, et y mettre ${REVIEWER_BRIEF_FR} ; puis le commit et le suivi du ticket${isRepo ? ` (${COMMIT_BEFORE_REVIEW_FR})` : ''} ; ne pas lancer ${implement} par l'outil Skill : il est réservé à l'utilisateur, et ces étapes sont les siennes ; ` +
    `3) suivre le CLAUDE.md du projet (contrôles, commit, suivi des tickets), sans sous-agents qui écrivent (des sous-agents en parallèle seulement pour des recherches en lecture seule ; seule exception, le relecteur de la revue du groupe, au point 4) ; ` +
    `et ces règles de travail : une modification unique passe par l'outil Edit ; au-delà de quelques remplacements liés, écrire un script par l'outil Write, puis le lancer par une commande simple ; son dossier temporaire se désigne par son chemin absolu, écrit en clair dans les commandes et les appels Write : le lire une fois au début (printenv CLAUDE_JOB_DIR, seule dans sa commande ; à défaut, le dossier temporaire que donnent ses instructions) ; ne jamais attendre par \`sleep\` : la fin d'un sous-agent ou d'une commande en arrière-plan est notifiée, et un sous-agent s'attend par cette notification, sans surveillance armée (pas de Monitor pour un sous-agent) ; un relecteur sans nouvelles depuis 10 à 15 minutes se relance par SendMessage, et s'il ne répond toujours pas, son axe se relance seul (seule exception à « sans relancer un axe déjà lancé » de la consigne des relecteurs) ; ${LONG_COMMANDS} ; un visuel à valider par moi (absent de la session) : produire une planche (les variantes côte à côte, dans un fichier), l'intégrer de façon réversible, déclarer le choix fait dans {"decided"} et me laisser la validation au retour du groupe ; si je change d'avis en cours de route sur un ticket, ajouter au ticket un commentaire daté « mise à jour du porteur » qui le dit, sans modifier son contenu ; citer un nombre de tests d'après la ligne de résumé de la sortie des tests, jamais de mémoire ; ` +
    `4) une fois tous les tickets commités et relus, leurs correctifs commités (${SINGLE_TICKET_GROUP_FR}), lancer elle-même la revue du groupe en la confiant à ${LINKED_GROUP_REVIEWER} ; la revue est /${commandLineOf('final-review')} (la revue de Claude Code, outil Skill « ${slashOf('final-review')} », arguments « ${SKILLS['final-review']!.args} ${isRepo ? '<base>..HEAD ' : ''}consignes : <chemin> »)${isRepo ? ", avec pour cible <base>..HEAD (<base> : le commit d'où part sa branche)" : `, sur les changements du groupe (${LINKED_NO_GIT_GROUP_POINT})`}, en lui donnant ${decided} et ${REVIEWER_BRIEF_FR}, par le fichier de consignes du point 2, et en lui demandant de se concentrer sur les interactions entre les tickets (chacun a déjà eu sa revue) ; ${SENSITIVE_NO_FIX_FR} ; ${NO_ARBITRATION} ; à son retour, relire le diff de ses correctifs, relancer les contrôles et les commiter ; ` +
    `5) dans le même message que le relecteur du point 4 (elle est en lecture seule et n'attend pas ses correctifs), juger si une revue de sécurité vaut la peine (les changements du groupe touchent : ${SECURITY_CRITERIA}) ; si oui, ${linkedSecurityReview(isRepo ? 'git diff <base>..HEAD (<base> : le commit d\'où part sa branche)' : `les changements du groupe (${LINKED_NO_GIT_GROUP_POINT})`)} ; une fois les correctifs de la revue du groupe commités, lui faire relire (ou à un nouveau relecteur) le seul diff de ces correctifs ; ` +
    `6) finir par un compte rendu : une ligne par ticket (fait, ou pas fait et pourquoi), les fichiers modifiés${isRepo ? ', sa branche' : ''}, les contrôles lancés et leur résultat, la revue du groupe (constats, corrigés, et à part les constats sur du code antérieur au lot), la revue de sécurité (lancée ou non, pourquoi, failles trouvées), et ce qui m'attend ; le déposer en entier par l'outil flow, {"report": "<le compte rendu entier>"} : il s'écrit dans le relais du parcours, un fichier fixe que cette discussion relit ; puis envoyer à cette discussion par SendMessage une seule ligne qui renvoie au relais (ce message la réveille), et finir la session sur cette même ligne. ` +
    `Ici : garder le parcours (pas de nouveau parcours) et suivre ${many ? 'les sessions sans les ' : "la session sans l'"}attendre activement : ${FOLLOW(isRepo)}. ` +
    `Le compte rendu complet d'une session est dans le relais, son message n'en porte qu'une ligne : chaque réponse de l'outil flow ici cite ceux qu'ont déposés les sessions des groupes pas encore rendus, à la reprise comme ensuite. ` +
    `Si l'app ou cette discussion redémarre, le parcours passe en pause et ne reçoit plus rien : à la reprise de cette discussion, le reprendre ici avant toute autre écriture, par l'appel flow {"resume": "${run.id}"} (comme « ↻ Reprendre ici »), puis rendre les statuts des tickets faits pendant la pause d'après Asana ; dans ${many ? 'chaque session liée' : 'la session liée'}, si l'outil flow répond que le parcours est en pause, continuer les tickets (tracker, commits) et le dire dans le compte rendu. ` +
    `${atEnd(many ? 'chacune' : 'la session')}, vérifier son travail et, dans son compte rendu, que la revue du groupe a tourné (sinon, la lui demander par SendMessage avant tout ; un groupe d'un seul ticket ni sensible ni avec logique n'en a pas : la revue de son ticket suffit)${isRepo ? ', fusionner sa branche' : ''}, puis envoyer à l'outil flow les statuts de ses tickets dans "set", avec {"returned": ["<id du groupe>"]} et, si son compte rendu dit que la revue du groupe a tourné, {"reviewed": ["<id du groupe>"]} (le tableau de bord ne la voit pas toujours : sans cela, il la proposerait encore), ` +
    `et, d'après son compte rendu, {"security": {"group": "<id du groupe>", "advised": true|false, "why": "<raison>"}}, avec "findings" et "fixed" si la revue de sécurité a tourné ; me dire les failles trouvées : je décide de leur correction ; ${FIXED_LATER}.`
  )
}

/** Confie des groupes prêts à des sessions liées : ils passent « session liée à lancer », la demande va dans le prompt. */
const delegateGroups = async ($: any, ids: readonly string[]) => {
  const run = activeRun(await read($, boardAtom))
  const plan = run ? groupPlan(run) : null
  if (!run || !plan) return
  // Avant l'envoi : la première session liée du parcours fait d'abord renommer la discussion.
  const isFirst = !(run.groups ?? []).some(g => g.linked !== undefined || g.delegated !== undefined)
  const now = await $.clock.now()
  if (!(await commit($, b => startLinkedGroups(b, ids, now)))) return
  const views = plan.groups.filter(g => ids.includes(g.group.id) && g.open.length > 0)
  await update($, uiAtom, ui => ({ ...ui, selection: [] }))
  // Le brief cite le fichier des choix : il existe avant que la session le lise, sinon le brief n'en cite pas le chemin.
  const decidedAt = await writeDecidedFile($, await read($, boardAtom))
  const text = await delegationText($, run, views, isFirst, decidedAt)
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
  noteSecurityMethod($)
  const run = activeRun(await read($, boardAtom))
  const group = run?.groups?.find(g => g.id === groupId)
  if (!run || !group?.delegated) return
  const isRepo = await measureRepo($)
  const main = (await read($, syncAtom)).main ?? 'la branche principale'
  const session = group.delegated.session ? ` (id ${group.delegated.session})` : ''
  const text =
    `Fais faire la revue du groupe ${group.id} (${group.name}) du parcours « ${run.title} » par sa session liée : le groupe est revenu sans revue, et ici sa branche est déjà fusionnée. ` +
    `Sa session a un titre qui commence par ${linkedTitles(run, group.id)}${session} : retrouve-la par ListAgents. ` +
    `Envoie-lui par SendMessage : ` +
    (isRepo ? `1) remettre sa branche au niveau de ${main} par une avance rapide (git merge --ff-only ${main}), pour que les correctifs portent sur le code actuel ; ` : '1) travailler sur le code actuel ; ') +
    `2) lancer elle-même la revue en la confiant à ${LINKED_GROUP_REVIEWER} ; la revue est /${commandLineOf('final-review')} (outil Skill « ${slashOf('final-review')} », arguments « ${SKILLS['final-review']!.args} ${isRepo ? '<plage> ' : ''}consignes : <chemin> ») ${isRepo ? "sur les seuls commits du groupe, lus sur le code actuel, avec pour cible leur plage <commit d'avant le premier du groupe>..<dernier commit du groupe> (une revue sans cible n'y verrait aucun changement, et un hash seul ne relirait qu'un commit)" : `sur les seuls changements du groupe, lus sur le code actuel (${LINKED_NO_GIT_GROUP_POINT} : sa session a pris ces copies dans son dossier temporaire)`}, en lui donnant ${decidedList(await writeDecidedFile($, await read($, boardAtom)))} et ${REVIEWER_BRIEF_FR}, par son fichier de consignes, et en lui demandant de se concentrer sur les interactions entre les tickets ; ${SENSITIVE_NO_FIX_FR} ; ${NO_ARBITRATION} ; ` +
    `3) au retour du relecteur, relire le diff de ses correctifs, relancer les contrôles du projet et commiter ; ` +
    `4) juger si une revue de sécurité vaut la peine (les changements du groupe touchent : ${SECURITY_CRITERIA}) et, si oui, ${linkedSecurityReview(isRepo ? 'les commits du groupe' : `les changements du groupe (${LINKED_NO_GIT_GROUP_POINT})`)} ; ` +
    `5) envoyer son compte rendu par SendMessage : constats et corrigés, commits, contrôles, avis et failles de sécurité. ` +
    `Si la session n'existe plus ou si l'outil Skill refuse la revue, dis-le-moi : je la lancerai moi-même. ` +
    `Au compte rendu : vérifier son travail${isRepo ? ', fusionner sa branche' : ''}, puis envoyer à l'outil flow {"reviewed": ["${group.id}"]} et {"security": {"group": "${group.id}", "advised": true|false, "why": "<raison>"}}, avec "findings" et "fixed" si la revue de sécurité a tourné ; me dire les failles trouvées : je décide de leur correction ; ${FIXED_LATER}.`
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
  const send = group ? `{"security": {"group": "${group.id}", "findings": <failles gardées>, "fixed": <corrigées>}}` : '{"security": {"findings": <failles gardées>, "fixed": <corrigées>}}'
  noteSecurityMethod($)
  const text =
    `Lance la revue de sécurité ${what} : confie-la à un sous-agent relecteur (outil Agent, type general-purpose, modèle opus, effort high ou xhigh selon le critère du fichier de méthode), en lecture seule, avec pour seul périmètre ${scope}, pour critères ${SECURITY_CRITERIA} et pour méthode ${securityMethodFr().replace('le fichier de méthode', 'le chemin du fichier de méthode')}, ${INSTRUCTIONS_IN_PROMPT_FR} ; ` +
    `pas /security-review, qui relit la branche face à la branche par défaut, donc aussi les autres groupes. Le sous-agent ne corrige rien : chaque faille gardée arrive numérotée (F1, F2…) avec un correctif prêt (ce qu'il change, le choix qu'il implique s'il y en a un), je décide de leur correction ; une réponse comme « corrige F1 et F3 » suffit : applique-les, teste-les, commite-les. Puis envoie à l'outil flow ${send} (les failles gardées seulement, pas la liste « à surveiller »).`
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? `Revue de sécurité ${what} : la demande est dans le prompt, Entrée pour la lancer` : `Demande à taper : revue de sécurité ${what}`))
}

/** « ↗ Session liée » sur un groupe prêt : une session liée le fait, le parcours reste ici. */
const launchGroupLinked = ($: any, groupId: string) => delegateGroups($, [groupId])

/**
 * « ✕ Fermer la session et le worktree » sur un groupe rendu : des sessions de groupe restaient
 * ouvertes après leur fusion. Le mod n'a pas d'API pour arrêter une session : la demande va dans
 * le prompt. Rien n'est forcé : le worktree ne part que propre et fusionné, la branche reste.
 */
const closeLinkedGroup = async ($: any, groupId: string) => {
  const run = activeRun(await read($, boardAtom))
  const group = run?.groups?.find(g => g.id === groupId)
  if (!run || !group?.delegated) return
  const now = await $.clock.now()
  if (!(await commit($, b => askCloseLinkedGroup(b, groupId, now)))) return
  const isRepo = await measureRepo($)
  const session = group.delegated.session
  const who = session
    ? `id ${session}`
    : `retrouve son id par claude agents, titre qui commence par ${linkedTitles(run, group.id)}`
  // Une session de l'app a un id local_… : aucun outil connu ne l'arrête, la personne la ferme.
  const stop = session?.startsWith('local_')
    ? "c'est une session de l'app Desktop : demande-moi de la fermer dans l'app (à confirmer : aucun outil connu ne l'arrête), et attends que je te confirme qu'elle est fermée avant toute autre commande"
    : `claude stop ${session ?? '<id>'} (sa conversation est gardée ; jamais claude rm, qui l'efface) ; si claude agents ne connaît pas cet id, c'est une session de l'app : demande-moi de la fermer dans l'app, et attends que je te confirme qu'elle est fermée avant toute autre commande`
  const text = isRepo
    ? `Ferme la session liée et le worktree du groupe ${group.id} (${group.name}) du parcours « ${run.title} », rendu ici. Vérifie d'abord, n'arrête et ne retire qu'ensuite, par des commandes séparées lancées dans ce dossier : ` +
      `1) le worktree du groupe s'appelle normalement groupe-${group.id} (branche worktree-groupe-${group.id}) : trouve sa ligne par git worktree list, et vérifie par git log <branche> --oneline -5 que ses commits sont ceux du groupe ; au moindre doute (nom différent, branche sans commit du groupe, un autre parcours), arrête-toi et demande-moi ; ` +
      `2) git branch --merged doit lister sa branche, et git -C <worktree> status --porcelain --ignored doit être vide ; s'il montre des fichiers ignorés (un .env, des sorties), liste-les-moi et attends mon accord ; si la branche n'est pas fusionnée ou si l'arbre n'est pas propre, n'arrête rien, ne retire rien, et dis-moi ce qui manque ; ` +
      `3) seulement si tout tient : arrêter la session (${who}) : ${stop} ; une fois la session arrêtée, relancer git -C <worktree> status --porcelain --ignored : s'il montre autre chose qu'au point 2, ne retire rien et dis-le-moi ; sinon git worktree remove <worktree>, sans rien forcer ; la branche reste : ne la supprime pas ; ` +
      `4) dis-moi ce qui a été fermé et ce qui reste.`
    : `Ferme la session liée du groupe ${group.id} (${group.name}) du parcours « ${run.title} », rendu ici ; ce dossier n'a pas de git, donc pas de worktree. ` +
      `Vérifie d'abord que ses tickets sont faits et son travail rendu (son compte rendu), puis arrête la session (${who}) : ${stop}. Dis-moi ce qui a été fermé.`
  await fillRequest(
    $,
    text,
    `Fermeture de ${group.id} : la demande est dans le prompt, Entrée pour la lancer`,
    `Demande à taper : ferme la session et le worktree de ${group.id}, en vérifiant d'abord, sans rien forcer, seulement propre et fusionné, la branche gardée`,
  )
}

/** Le début du titre de la session liée d'un groupe, tel que la demande de lancement le fixe (ou sans préfixe, avant la 0.37.0). */
const linkedTitles = (run: Run, groupId: string): string => `« ${linkedPrefix(run)}Groupe ${groupId} · » ou « Groupe ${groupId} · »`

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
 * L'effort d'une session de diagnostic de bug : high, un bug difficile demandant du raisonnement
 * sans choix de conception ; xhigh pour une deuxième tentative sur le même bug ; pas de troisième.
 */
const BUG_EFFORT =
  "Effort de la session (<effort>) : high pour une première tentative ; xhigh pour une deuxième, quand une session de bug de ce parcours a déjà essayé de corriger ce même bug et qu'il est toujours là : son brief donne alors ce que la première a trouvé et essayé. Pas de troisième session après un second échec : on replanifie ensemble ici. Dis-moi en une ligne l'effort choisi et pourquoi."

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
    launchHow({ many: false, isRepo: false, ownFolder: false, title: `${prefix}Bug · <sujet>`, worktree: '', effort: BUG_EFFORT }) +
    `Brief de la session : 1) d'abord, appeler l'outil flow de flow-board avec ${resume}, pour reprendre le parcours dans la session ; ` +
    `2) puis lancer /${await commandFor($, 'diagnosing-bugs')} avec la description du bug ci-dessous : le diagnostic s'affiche en détour de la phase en cours ; ` +
    `3) corriger en suivant le CLAUDE.md du projet (contrôles, revue et commit) et proposer en tâche ce qui reste ouvert ; ` +
    `4) à la fin, envoyer {"complete": true} pour clore le détour. ` +
    `Ici, ne rien enregistrer sur ce parcours tant que la session travaille ; ${atEnd('la session').replace(/^À/, 'à')}, vérifier son travail ; si le bug est toujours là, me le dire et me proposer la deuxième tentative (règle d'effort ci-dessus) ; sinon, reprendre le parcours ici avec ${resume}. ` +
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
    `Seules les ${label} de ce dépôt vont à la session : une ${def.items!.label.toLowerCase().replace(/s$/, '')} qui touche un autre dépôt (plugins, config commune, autre projet) ne s'applique pas d'ici : ne la mets pas dans le prompt de la session, donne-la-moi dans une liste de corrections prête à confier à un agent de ce dépôt (le constat, puis la correction attendue), et, une fois la session lancée (son id relevé), rends-la à l'outil flow en todo : elle quitte l'envoi et revient à mon choix. Si aucune de ces ${label} n'est de ce dépôt, ne lance pas de session : donne-moi la liste et dis-moi d'utiliser « Annuler » au tableau de bord. ` +
    `Rédige toi-même le background, sans y reprendre le texte des règles : les règles de travail (écritures permises, gestes qui me sont réservés, dépôt public, contraintes du projet) sont dans le document du projet pour les sessions déléguées s'il en a un (son CLAUDE.md le nomme), sinon dans son CLAUDE.md, et dans mes règles communes ; la session les charge d'elle-même, le background les cite par leur chemin. Il ne garde que ce qui varie : le projet en une phrase, la session étudiée par la rétro, la ressource unique à ne pas partager (une appli ouverte), les décisions déjà prises par renvoi au fichier de décisions du projet. ` +
    `Rédige le prompt avec une section par piste : le problème constaté (une phrase), la correction attendue, les fichiers touchés et un critère de fin vérifiable. ` +
    `Consignes du prompt : travailler en séquence, en regroupant les pistes qui touchent les mêmes fichiers, sans sous-agents qui écrivent (des sous-agents en parallèle seulement pour des recherches en lecture seule et indépendantes) ; suivre le CLAUDE.md du projet et lancer à la fin les contrôles qu'il déclare ; ne pas utiliser l'outil flow de flow-board ni reprendre ce parcours, qui reste dans la discussion principale ; finir par un compte rendu avec une ligne par piste (faite, ou pas faite et pourquoi), les fichiers modifiés${isRepo ? ', sa branche' : ''}, les contrôles lancés et leur résultat, et ce qui m'attend. ` +
    `Ici : garder le parcours (pas de resume ni de nouveau parcours) et suivre la session sans l'attendre activement : ${FOLLOW(isRepo)}. ` +
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
  const howToRead =
    "avec tes outils de session de l'app Desktop si tu les as, sinon par ListAgents (est-elle encore là), l'état git de son worktree ou de ce dossier (commits, fichiers modifiés), le tracker, et au besoin son transcript, le fichier .jsonl sous ~/.claude/projects/ (pas claude logs, dont la sortie de terminal est illisible)"
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
  setTab: async (tab: Tab) => {
    await update($, uiAtom, ui => ({ ...ui, tab }))
    // L'onglet Agents s'ouvre : le rattrapage de la session affichée, l'historique et, la première
    // fois, la reprise des parcours existants (Q14), sans attendre.
    if (tab === 'agents') {
      void quietly(() => catchUpShown($))
      void quietly(() => refreshHistory($))
      void quietly(() => rebuildPastRuns($))
    }
  },
  toggleAgentsHistory: () => update($, uiAtom, ui => ({ ...ui, isAgentsHistoryOpen: ui.isAgentsHistoryOpen !== true })),
  chooseAgentsHistory: async (key: string) => {
    await update($, uiAtom, ui => ({ ...ui, agentsHistory: key === 'now' ? undefined : key, isAgentsHistoryOpen: false, agentsSession: undefined, agentCard: undefined, isPromptOpen: false, confirmForget: undefined }))
    await quietly(() => refreshHistory($))
  },
  openAgentsOf: async (runId: string) => {
    await update($, uiAtom, ui => ({ ...ui, tab: 'agents' as const, agentsHistory: `run:${runId}`, isAgentsHistoryOpen: false, agentsSession: undefined, agentCard: undefined, isPromptOpen: false }))
    await quietly(() => refreshHistory($))
    void quietly(() => rebuildPastRuns($))
  },
  launch: (skill: string, args?: string) => launch($, skill, args),
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
    await update($, uiAtom, ui => ({ ...ui, tab: 'flow' as const }))
  },
  drop: async (id: string) => {
    const now = await $.clock.now()
    const run = ((await read($, boardAtom)) as Board | null)?.runs.find(r => r.id === id)
    await update($, uiAtom, ui => ({ ...ui, confirmDrop: undefined, ...(ui.agentsHistory === `run:${id}` ? { agentsHistory: undefined } : {}) }))
    // « Définitivement » : ses agents, ses sessions liées, son relais et ses choix (Q6 a1, S3) ; les
    // traces d'abord, et le parcours ne quitte le board qu'une fois elles posées (S24).
    if (run) await quietly(() => eraseRun($, run))
    else await commit($, board => dropRun(board, id, now))
  },
  askForget: (key: string) => update($, uiAtom, ui => ({ ...ui, confirmForget: ui.confirmForget === key ? undefined : key })),
  forget: (id: string) => quietly(() => forgetSession($, id)),
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
  closeLinkedGroup: (id: string) => closeLinkedGroup($, id),
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
  toggleAgentsRange: () => update($, uiAtom, ui => ({ ...ui, agentsRange: ui.agentsRange === 'hour' ? ('all' as const) : ('hour' as const) })),
  selectAgentsSession: async (key: string | null) => {
    await update($, uiAtom, ui => ({ ...ui, agentsSession: key ?? undefined, agentCard: undefined, isPromptOpen: false }))
    void quietly(() => catchUpShown($))
  },
  toggleAgentCard: (key: string) => update($, uiAtom, ui => ({ ...ui, agentCard: ui.agentCard === key ? undefined : key, isPromptOpen: false })),
  togglePrompt: () => update($, uiAtom, ui => ({ ...ui, isPromptOpen: ui.isPromptOpen !== true })),
  toggleWorkflow: (id: string) =>
    update($, uiAtom, ui => {
      const open = ui.openWorkflows ?? []
      return { ...ui, openWorkflows: open.includes(id) ? open.filter(x => x !== id) : [...open, id] }
    }),
  openAgentTranscript: (agentId: string) => quietly(() => $.ui.view({ agentId })),
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
    agents: await read($, registryAtom),
    linked: (await read($, linkedAtom)).map(session => ({ session, reg: linkedRegistryOf(session.session) })),
    history: { entries: await read($, historyAtom), shown: historyShown },
    agentsAlert: await read($, registryAlertAtom),
    erasing: [...erasingNow].map(([key, title]) => ({ key, title })),
    agentPrices: (await read($, pricesAtom))?.prices ?? null,
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
    await quietly(() => refreshLinked($))
    await quietly(() => migrateRunAgents($))
    const ui = await read($, uiAtom)
    if (ui.tab === 'agents' && ui.agentsHistory !== undefined) await quietly(() => refreshHistory($))
    if (ui.tab === 'agents') await quietly(() => reconcileErased($))
  }
  const run = activeRun(board)
  // Une session liée au travail fait aussi avancer les durées de l'onglet Agents.
  const hasAgentsAtWork = runningOf(await read($, registryAtom)).length > 0 || (await read($, linkedAtom)).some(l => l.state === 'working')
  if (!run) {
    // Sans parcours, l'onglet Agents garde ses durées vivantes tant qu'un sous-agent travaille.
    if (hasAgentsAtWork && ticks % 5 === 0) $.ui.invalidate('ui.render')
    return
  }
  if (ticks % 300 === 0 && CODE_SKILLS.has(currentPhase(run).skill)) void checkRemote($, true)
  const live = await read($, liveAtom)
  // Durées vivantes : toutes les 5 s pendant le travail, toutes les 30 s au repos.
  const isBusy = live.mode === 'working' || hasAgentsAtWork
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
  return { text: run ? summaryOf(run).replace(/^Dashboard: /, 'Parcours : ') : noActiveFrench((board ?? (await read($, boardAtom)))!) }
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
    // Un board déjà là au démarrage, hors d'un /clear : le mod a été rechargé (/reload-plugins), son état est intact.
    isReloadToAnnounce = !isAfterClear && (await read($, boardAtom)) !== null
    isAfterClear = false
    await ensureBoard($)
    await quietly(() => ensureRegistry($))
    // S1 : les anciens sous-agents des parcours rejoignent le registre, puis quittent le board.
    await quietly(() => migrateRunAgents($))
    // /implement-spec a besoin d'un dépôt git (worktrees, branche d'intégration) : le panneau ne le propose pas ailleurs.
    await quietly(async () => {
      const repo = await $.session.repo()
      await update($, syncAtom, s => ({ ...s, isRepo: repo !== null }))
    })
    $.clock.every(1000, () => void tick($))
    scheduleCheck($, true)
    // Les prix des modèles, hors du démarrage : ccusage prend quelques secondes.
    $.clock.after(1000, () => void refreshPrices($))
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
    // Après un rechargement, l'état retrouvé se dit tel qu'il était, avant ce que l'appel change.
    const found = isReloadToAnnounce ? reloadText((await read($, boardAtom)) ?? emptyBoard('', '')) : ''
    isReloadToAnnounce = false
    // Avant une reprise, l'état d'ici rattrape ce que l'autre discussion a enregistré.
    if (typeof input.resume === 'string' && input.resume.trim() !== '') await pull($)
    const delegateTitle = typeof input.delegate === 'string' ? await mainRepoTitle($, input.delegate.trim()) : undefined
    // Le relais du parcours repris ou actif : un groupe rendu y trouve les revues relayées par sa
    // session, et la réponse y cite les comptes rendus finals déposés (un SendMessage peut se perdre).
    const board0: Board | null = await read($, boardAtom)
    const relayRun = board0?.delegate ? '' : typeof input.resume === 'string' && input.resume.trim() !== '' ? input.resume.trim() : (activeRun(board0)?.id ?? '')
    const relay = relayRun !== '' ? await readRelay($, relayRun) : undefined
    // À la reprise, les comptes rendus déposés se citent de nouveau en entier.
    if (relayRun !== '' && typeof input.resume === 'string' && input.resume.trim() !== '') for (const key of [...seenReports]) if (key.startsWith(`${relayRun}:`)) seenReports.delete(key)
    for (let attempt = 0; attempt < 5; attempt++) {
      const { value, version } = await $.state.get(BOARD_REF)
      if (!value) break
      const out = applyReport(value, input, now, { hasPullRequests: (await read($, syncAtom)).isGitHub !== false, delegateTitle, relay, seenReports })
      text = out.text
      const shown = activeRun(out.board)
      if (shown && !out.board.delegate && relay !== null && typeof relay === 'object' && (relay as Relay).run === shown.id) for (const key of relayedReportKeys(shown, relay as Relay)) seenReports.add(key)
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
        const report = reportedReport(input)
        if (report !== '') await relaySignal($, { kind: 'report', text: report })
        if (typeof input.note === 'string' && input.note.trim() !== '') await relaySignal($, { kind: 'note', text: input.note.trim() })
      }
    }
    await keepDelegate($)
    if (found !== '') text = `${found} ${text}`
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
    // Les sous-agents de ce parcours en échec, d'après les registres (S1 : plus dans le parcours) :
    // celui de cette discussion et ceux de ses sessions liées (Q-c), pour le seul compte rendu.
    const failedAgents = run && noteId === 'compte-rendu' ? await failedOfRun($, run) : 0
    noteSecurityMethod($)
    return run ? { text: `${result.text}${coachingNote(noteId, run, await read($, syncAtom), await measureRepo($), (await read($, boardAtom))?.session, await writeDecidedFile($, await read($, boardAtom)), failedAgents)}` } : result
  })

  // Ce qui se passe pendant un parcours : sous-agents, fichiers, commandes, Asana, questions.
  on('tool.call', async ($, e, next) =>
    timedTool($, e, async () => {
      if (e.tool === TOOL || e.tool === 'Skill') return next(e)
      // Les sous-agents d'abord, dans toute session : avant la sortie vers le relais d'une session
      // liée et celle de l'absence de parcours.
      if (e.tool === 'Agent') return trackAgentCall($, e, next)
      // Les sessions liées lancées ici, dans toute session : avant les mêmes sorties.
      const isLaunch = e.tool === START_SESSION || e.tool === 'Bash' || (e.tool as string) === 'PowerShell'
      const nextNoting = isLaunch
        ? async (ev: any) => {
            const ran = await next(ev)
            await quietly(() => noteLinkedLaunches($, e, ran))
            return ran
          }
        : next
      const board0: Board | null = await read($, boardAtom)
      if (board0?.delegate) return relayTool($, e, nextNoting)
      if (!activeRun(board0)) return nextNoting(e)

      // Avant de modifier le code : /project:sync, demandé une fois quand le distant a avancé.
      if ((e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'NotebookEdit') && e.agentId === undefined) {
        const path = String((e as { file_path?: unknown; notebook_path?: unknown }).file_path ?? (e as { notebook_path?: unknown }).notebook_path ?? '')
        const reason = await syncGate($, path)
        if (reason) return { deny: reason }
      }

      // Une session liée lancée pendant que des éléments ou des groupes lui sont confiés : son id est
      // gardé, et va au groupe que son titre nomme (« Groupe A · … »).
      if (e.tool === START_SESSION) {
        const ran = await nextNoting(e)
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

      if (e.tool === 'AskUserQuestion') {
        await setLive($, 'waiting', null)
        const ran = await next(e)
        await setLive($, 'working', null)
        const answeredAt = await $.clock.now()
        await commit($, board => applyUserAnswer(board, answeredAt))
        return ran
      }

      const ran = await nextNoting(e)
      if (ran.deny !== undefined) return ran
      try {
        const now = await $.clock.now()
        const isOk = ran.isError !== true
        if (e.tool === 'Write' && isOk) {
          await commit($, board => applyFileChange(board, { path: e.file_path, content: e.content }, now))
        } else if (e.tool === 'Edit' && isOk) {
          await commit($, board => applyFileChange(board, { path: e.file_path, before: e.old_string, after: e.new_string }, now))
        } else if (e.tool === 'Bash' || (e.tool as string) === 'PowerShell') {
          // PowerShell n'existe pas dans tous les builds : sa commande se lit sans le type de l'outil.
          const command = String((e as { command?: unknown }).command ?? '')
          // Après un fetch, pull, rebase ou merge (le travail de /project:sync), le retard est remesuré.
          if (/\bgit\s+(?:fetch|pull|rebase|merge)\b/.test(command)) scheduleCheck($, false)
          const record = ran.result as { stdout?: unknown; backgroundTaskId?: unknown } | undefined
          if (typeof record?.backgroundTaskId !== 'string') {
            const out = typeof record?.stdout === 'string' ? record.stdout : typeof ran.text === 'string' ? ran.text : ''
            await commit($, board => applyCommand(board, command, isOk, out, now))
            // Le CLI lance ses sessions liées par `claude --bg` : leur id va au groupe que leur titre nomme.
            for (const launched of backgroundLaunches(command, out)) {
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
    }),
  )

  on('classic.SubagentStop', async ($, e, next) => {
    await stopAgentHere($, e.agent_id)
    await quietly(() => catchUpAgent($, e.agent_id, (e as unknown as { agent_transcript_path?: unknown }).agent_transcript_path))
    await noteTranscript($, e)
    return next(e)
  })

  // Le premier lancement d'un id donne son identité ; un suivant le réveille (notification d'une
  // de ses tâches de fond) : il repasse au travail.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const agentId = (result as { agentId?: unknown } | undefined)?.agentId
    if (typeof agentId !== 'string' || agentId === '') return result
    await quietly(async () => {
      const now = await $.clock.now()
      const spawned = e as unknown as Record<string, unknown>
      const text = (k: string): string | undefined => (typeof spawned[k] === 'string' && spawned[k] !== '' ? (spawned[k] as string) : undefined)
      const run = agentRunOf(await read($, boardAtom))
      // Un agent de Workflow : `workflow` est `{ runId, agentIndex }`, et son `tool_use_id` est celui du Workflow.
      const workflow = spawned.workflow as { runId?: unknown } | undefined
      const workflowRun = workflow && typeof workflow === 'object' ? String(workflow.runId ?? '') || 'workflow' : undefined
      const resolved = (result as { model?: unknown }).model
      await commitRegistry($, reg =>
        spawnRegistryAgent(
          reg,
          {
            agentId,
            callKey: workflowRun === undefined ? text('tool_use_id') : undefined,
            parent: text('parentAgentId'),
            name: text('description'),
            subagentType: text('subagentType'),
            model: text('model') ?? (typeof resolved === 'string' ? resolved : undefined),
            isBackground: spawned.background !== false,
            workflow: workflowRun,
            run,
            isTeammate: spawned.teammate === true,
          },
          agentCalls,
          now,
        ),
      )
      // Lancé dans ce processus : la liste du moteur pourra le clore (S9).
      const entry = (await read($, registryAtom))?.agents.find(a => a.agentId === agentId)
      if (entry) await ownAgent($, entry.key)
    })
    return result
  })

  // Le chemin du transcript de la session, relevé tel quel pour l'en-tête du registre.
  on('classic.Stop', async ($, e, next) => {
    await noteTranscript($, e)
    // Des tâches de fond encore en cours à la fin du tour : le repos qui suit est une attente.
    const tasks = (e as unknown as { background_tasks?: unknown }).background_tasks
    hasBackgroundWork = Array.isArray(tasks) && tasks.length > 0
    return next(e)
  })

  // Une requête au modèle, de la session ou d'un sous-agent : Réflexion jusqu'au premier morceau
  // de texte ou d'outil, Rédaction le temps d'un bloc de texte ; l'écriture d'un appel d'outil
  // ouvre son segment (essai du ticket 01, points 3 et 4 : moins d'une milliseconde par réponse).
  on('turn.step', async function* ($, e, next) {
    const lane = laneOfLoop(e.agentId)
    const startedAt = await $.clock.now()
    await quietly(() => commitRegistry($, reg => openSegment(reg, lane, { k: 'think', s: startedAt }, startedAt)))
    let phase: 'think' | 'write' | 'tool' = 'think'
    const stream = next(e)
    let result: any
    try {
      for await (const chunk of stream) {
        if (chunk.kind === 'text' && phase !== 'write') {
          const at = await $.clock.now()
          await quietly(() => commitRegistry($, reg => openSegment(closeSegment(reg, lane, isModelSegment, at) ?? reg, lane, { k: 'write', s: at }, at)))
          phase = 'write'
        } else if (chunk.kind === 'tool') {
          const at = await $.clock.now()
          toolWritten.set(chunk.id, at)
          if (phase !== 'tool') await quietly(() => commitRegistry($, reg => closeSegment(reg, lane, isModelSegment, at)))
          phase = 'tool'
        }
        yield chunk
      }
      result = await stream.result
    } finally {
      // Fin normale, interruption ou erreur : la réflexion ou la rédaction se ferme ; les tokens
      // de la réponse, son modèle et l'effort demandé s'ajoutent à la piste.
      const endedAt = await $.clock.now()
      const effort = e.effort === undefined ? undefined : String(e.effort)
      await quietly(() =>
        commitRegistry($, reg => {
          const closed = closeSegment(reg, lane, isModelSegment, endedAt) ?? reg
          return addUsage(closed, lane, (result?.usage ?? null) as StepUsage | null, effort, endedAt) ?? (closed === reg ? null : closed)
        }),
      )
    }
    return result
  })

  // Le début d'une demande d'autorisation, et la durée d'un outil hors autorisation.
  on('classic.PermissionRequest', async ($, e, next) => {
    const at = await $.clock.now()
    const input = e as unknown as { tool_name?: unknown; agent_id?: unknown }
    permissionAt.set(`${laneOfLoop(input.agent_id)}|${String(input.tool_name ?? '')}`, at)
    return next(e)
  })
  on('classic.PostToolUse', async ($, e, next) => {
    const input = e as unknown as { tool_use_id?: unknown; duration_ms?: unknown }
    if (typeof input.tool_use_id === 'string' && typeof input.duration_ms === 'number') toolDurations.set(input.tool_use_id, input.duration_ms)
    return next(e)
  })

  // La compaction se voit en direct (essai, point 9) : un repère sur l'orchestrateur.
  on('session.compact', async ($, e, next) => {
    await markLane($, MAIN, { k: 'compact', at: await $.clock.now() })
    return next(e)
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteTranscript($, e)
    return next(e)
  })
  on('classic.SessionStart', async ($, e, next) => {
    await noteTranscript($, e)
    return next(e)
  })

  // Le tour d'un sous-agent (`agentId`) ne rend pas la main à Claude : seul le fil principal compte.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // Fin de l'attente d'une tâche de fond, s'il y en avait une.
    const at = await $.clock.now()
    await quietly(() => commitRegistry($, reg => closeSegment(reg, MAIN, s => s.k === 'waitBg', at)))
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
      if (e.isAborted) await markLane($, e.agentId, { k: 'stop', at: await $.clock.now() })
      await stopAgentHere($, e.agentId)
      return result
    }
    // Le tour de la session est fini : ce qui restait ouvert se ferme ; interrompu, un repère ;
    // des tâches de fond restent, une attente.
    const endedAt = await $.clock.now()
    await quietly(() => commitRegistry($, reg => closeOpen(reg, MAIN, endedAt, s => s.k === 'waitBg')))
    if (e.isAborted) await markLane($, MAIN, { k: 'stop', at: endedAt })
    if (hasBackgroundWork && !e.isAborted) await quietly(() => commitRegistry($, reg => openSegment(reg, MAIN, { k: 'waitBg', s: endedAt }, endedAt)))
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
    // Un message d'une autre session (pas le rapport d'un sous-agent) : un repère sur l'orchestrateur.
    if ((kind === 'peer' && !e.text.trimStart().startsWith('<agent-message')) || kind === 'peer-send-message') await markLane($, MAIN, { k: 'msg', at: await $.clock.now() })
    // Le retour d'un sous-agent au fil principal : sur la piste de son lanceur.
    const returned = kind === 'peer' || kind === 'task-notification' ? returnedAgentOf(e.text) : null
    const launcher = returned !== null ? await launcherOf($, returned) : null
    if (launcher) await markLane($, launcher.lane, { k: 'back', at: await $.clock.now(), to: launcher.key })
    if (kind === 'composer' || kind === 'bridge' || kind === 'sdk') submitAt = await $.clock.now()
    if ((kind === 'composer' || kind === 'bridge' || kind === 'sdk') && !e.text.trimStart().startsWith('/')) {
      const now = await $.clock.now()
      await commit($, board => applyUserAnswer(board, now))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    saveTimer?.cancel()
    isAfterClear = e.reason === 'clear'
    // Une vraie fin (pas un /clear) laisse le parcours en pause pour la prochaine discussion.
    if (e.reason !== 'clear') {
      await quietly(() => relaySignal($, { kind: 'end' }))
      const now = await $.clock.now()
      const { value, version } = await $.state.get(BOARD_REF)
      const parked = value ? parkActive(value, now) : null
      if (parked) await $.state.set(BOARD_REF, parked.board, { ifVersion: version })
    }
    await saveNow($)
    registrySaveTimer?.cancel()
    // Les changements encore dans la file passent d'abord, puis la dernière écriture (R2).
    await registryQueue
    await quietly(() => saveRegistryNow($))
    // Le registre est celui de cette discussion : après un /clear, la suivante charge le sien.
    await update($, registryAtom, () => null)
    await update($, ownAtom, () => [])
    await update($, registryAlertAtom, () => false)
    await update($, linkedAtom, () => [])
    otherHeads.clear()
    otherRegistries.clear()
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
