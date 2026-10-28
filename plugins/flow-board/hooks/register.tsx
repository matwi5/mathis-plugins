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
// - Le registre des agents (`registry-file.ts`), son rattrapage par les transcripts
//   (`catch-up.ts`) et l'effacement (`erase-run.ts`) vivent à part : ce fichier n'en garde que
//   les hooks qui les appellent.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentLane, AgentMark, AgentsWindow, AgentSegment, AgentType, Board, FlowPhase, Relay, Run, SessionRegistry, SyncState, Tab } from '../types'
import {
  CODE_SKILLS,
  NO_GIT_COPIES,
  NO_GIT_GROUP_FIXED_POINT,
  NO_GIT_TICKET_FIXED_POINT,
  PLUGIN,
  INSTRUCTIONS_IN_PROMPT,
  REVIEWER_BRIEF,
  SECURITY_CRITERIA,
  SECURITY_FIXES_PASS,
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
  EMPTY_UI,
  emptyBoard,
  finishActive,
  flowCallLabel,
  focusOf,
  clampFuture,
  groupPlan,
  noActiveFrench,
  withoutPullRequest,
  isBoard,
  detachOnLoad,
  mergeBoards,
  nextCommandSkill,
  VERSION_MANIFESTS,
  versionSet,
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
  reportedCounts,
  reportedWithdrawals,
  relayFileSlug,
  reportFileName,
  mainRefFileName,
  parseMainRef,
  updateDelegateMain,
  type MainRef,
  reportedDecisions,
  type RelayEvent,
  commandArgsOf,
} from './model.ts'
import type { LiveAgent, SyncAdvice } from './model.ts'
import {
  emptyRegistry,
  endCall as endRegistryCall,
  failedAgentsOf,
  parseOwnRegistry,
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
  lastCompactionAt,
  closeSegment,
  closeToolCall,
  closeOpen,
  openSegment,
  addLines,
  addUsage,
  addAdvisorCalls,
  linesOf,
  type ServerToolUse,
  type StepUsage,
} from './registry.ts'
import type { LinkedLaunch } from '../types'
import { TITLE_SEPARATOR, isSameProject, linkedSessions, type JobInfo, type LinkedSession } from './linked.ts'
import { laneFromTranscript } from './transcript.ts'
import { COMPACT_FIRST_TOAST, ORIGIN_FILE_RULE, compactionInstructions, compactionRoleOf, retroTranscriptNote, suggestsCompaction, withCompactionInstructions, type CompactionRole } from './compaction.ts'
import { applyTraces } from './erase.ts'
import { agentsOfRun, applyRebuilt, carriedRunAt, clipLane, historyEntries, runFileId, runRegistry, runWindow, unionRebuilt, withRun, type HistoryEntry } from './history.ts'
import { minOf, shortArg, toolFamily } from './timeline.ts'
import { pricesFromCcusage, type UnitPrices } from './cost.ts'
import { drawBand, drawPane, drawWelcomeBand, kitOf, type Actions, type Caps, type View } from './view.tsx'
import { commitRegistry, ensureRegistry, ownAgent, readPiece, readRegistry, registryDir, registryKey, registryQueue, registrySaveTimer, saveRegistryNow } from './registry-file.ts'
import { catchUpAgent, catchUpOwn, catchUpShown, claudeDir, needsRebuild, readRebuilt, readTranscript, transcriptAgents, updateRebuilt } from './catch-up.ts'
import { eraseRun, erasedRuns, erasingNow, forgetSession, readTraces, reconcileErased } from './erase-run.ts'

const PANE = 'flow-board'
/** Le terminal seul ne dessine pas les SVG (sa table porte quand même un `Svg`, qui rend une boîte vide). */
const capsOf = (surface: string): Caps => ({ hasSvg: surface !== 'terminal' })
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
const uiAtom = atom({ plugin: 'flow-board', key: 'ui' } as const, EMPTY_UI)
const commandsAtom = atom({ plugin: 'flow-board', key: 'commands' } as const, {})
const syncAtom = atom({ plugin: 'flow-board', key: 'sync' } as const, EMPTY_SYNC)
const relayAtom = atom({ plugin: 'flow-board', key: 'relay' } as const, null)
const registryAtom = atom({ plugin: 'flow-board', key: 'agents' } as const, null)
const ownAtom = atom({ plugin: 'flow-board', key: 'agentsOwn' } as const, [] as string[])
const registryAlertAtom = atom({ plugin: 'flow-board', key: 'agentsAlert' } as const, false as boolean | 'lost')

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
    title: { type: 'string', description: "A short title you choose that sums up the whole work, 3 to 6 words, in the user's language; never their message itself; only the first one sent is kept (fix.title changes it). The discussion where the workflow was born takes it too, unless another workflow was born there: the answer says which" },
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
    withdrawn: {
      type: 'array',
      description: 'Choices declared earlier in "decided" that no longer hold: each with its reason, and the choice that replaces it if any; the file of declared choices and the dashboard then show only the choices in force',
      items: {
        type: 'object',
        properties: {
          what: { type: 'string', description: 'The choice exactly as it was declared' },
          why: { type: 'string', description: "Why it no longer holds, short, in the user's language" },
          replacedBy: { type: 'string', description: "The choice that replaces it, short, in the user's language" },
        },
        required: ['what', 'why'],
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
        'Execution plan: the tickets grouped by shared context. Each group is done in a linked session, never in this discussion. Same group = tickets that touch the same files or modules, or chain through their dependencies: its linked session does them in a row with /implement and reuses the loaded context. Different context = another group, done later in its own linked session, or at the same time as other independent groups (one linked session per group). A group of one ticket is fine when its context is its own. Full list: it replaces the previous one; every ticket in exactly one group. Never a single group: a plan of one group (or one group plus tickets outside it) is ignored, so send no groups and do the lot here with /implement',
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
        'Only when a linked session\'s brief gives it: id of the workflow this discussion works for, sent first, with "group" and "main".The workflow stays in the main discussion and nothing is recorded on it from here: your progress is relayed to its dashboard on its own (Asana ticket statuses, commits, tests). Afterwards, only "set" (a ticket status that changed without an Asana update or an edit of a local ticket file), "decided" (sent at once, shown on the main dashboard for review), "withdrawn" (a declared choice that no longer holds), "review" (after each review), "security" (after the security review), "report" (your final report, kept whole next to the relay) and "note" are accepted',
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
      description: 'With "delegate": the main discussion as the brief names it, its "[ref]" (or "<name> [ref]"); each answer then says how to reach it, with a newer [ref] when the main discussion restarted. With "resume", in the main discussion: your own [ref] of the moment, read by ListAgents (it changes when the discussion restarts); the linked sessions of the workflow read it from there',
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
        title: { type: 'string', description: "A short title you choose that sums up the whole work, 3 to 6 words, in the user's language; never their message itself" },
        entry: { type: 'string', description: 'Starting skill that shapes its phases (implement, to-tickets, grill-with-docs, diagnosing-bugs...); default implement' },
      },
      required: ['title'],
    },
    fix: {
      type: 'object',
      description:
        "Correct the active workflow, at the user's request or after a mistake: a title already set, the current phase (going back resets the phases after it), the step (back too). Tickets and groups are corrected with \"tickets\", \"set\", \"remove\" and \"groups\"",
      properties: {
        title: { type: 'string', description: 'New title, replacing the current one; the discussion follows when the workflow was born here and no linked session was launched yet' },
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
export async function sessionRoot($: any): Promise<string> {
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
export async function sessionId($: any): Promise<string> {
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
export function claudeHome($: any): string | null {
  try {
    const root = String($.plugin.root ?? '').replace(/\\/g, '/')
    const at = root.toLowerCase().indexOf('/.claude/')
    return at >= 0 ? root.slice(0, at + '/.claude'.length) : null
  } catch {
    return null
  }
}

/** Le fichier de méthode de la revue de sécurité, à la racine du mod. */
const SECURITY_METHOD_FILE = 'reference/revue-securite.md'
/**
 * La procédure d'une session liée de groupe (tickets, revues, compte rendu) : le texte de
 * délégation la cite par son chemin au lieu de la recopier (15 000 signes par lancement, que la
 * discussion principale recopiait à son tour dans le prompt de la session).
 */
const PROCEDURE_FILE = 'reference/procedure-groupe.md'
/** Leurs chemins, tirés de `$.plugin.root` au premier hook qui construit une consigne qui les cite. */
let securityMethod = SECURITY_METHOD_FILE
let procedurePath = PROCEDURE_FILE
const noteReferences = ($: any) => {
  try {
    const root = String($.plugin.root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
    if (root === '') return
    securityMethod = `${root}/${SECURITY_METHOD_FILE}`
    procedurePath = `${root}/${PROCEDURE_FILE}`
  } catch {
    // Racine inconnue : les chemins relatifs au mod.
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

const runSlug = relayFileSlug

export function relayPath($: any, runId: string): string | null {
  const home = claudeHome($)
  const slug = runSlug(runId)
  return home && slug ? `${home}/flow-board/relais/${slug}.json` : null
}

/** Le compte rendu entier d'une session liée, à côté du relais ; écrit par elle seule. */
export function reportPath($: any, runId: string, session: string): string | null {
  const home = claudeHome($)
  return home && runSlug(runId) && relayFileSlug(session) ? `${home}/flow-board/relais/${reportFileName(runId, session)}` : null
}

/** La référence du moment de la discussion principale, à côté du relais ; écrite par elle seule. */
export function mainRefPath($: any, runId: string): string | null {
  const home = claudeHome($)
  return home && runSlug(runId) ? `${home}/flow-board/relais/${mainRefFileName(runId)}` : null
}

/** Sa clé de `$.store`, quand le fichier est hors d'atteinte. */
export const mainRefKey = (runId: string): string => `relay-main:${runId}`

/** Écrit le compte rendu entier d'une session liée ; faux quand il n'a pas pu s'écrire. */
const writeReportFile = async ($: any, runId: string, session: string, text: string): Promise<boolean> => {
  const path = reportPath($, runId, session)
  if (!path) return false
  // Un parcours effacé (S23) : rien ne s'écrit plus pour lui, son compte rendu non plus.
  await quietly(() => readTraces($))
  if (erasedRuns.has(runId)) return false
  try {
    await $.fs.write(path, text)
    return true
  } catch {
    return false
  }
}

/** Dans la discussion principale, à la reprise : sa référence du moment, que les sessions liées relisent. */
const writeMainRef = async ($: any, ref: MainRef) => {
  const path = mainRefPath($, ref.run)
  if (path) {
    try {
      await $.fs.write(path, JSON.stringify(ref))
      return
    } catch {
      // Repli sur `$.store`.
    }
  }
  try {
    await $.store.set(mainRefKey(ref.run), ref)
  } catch {
    // Rien à écrire cette fois : la session liée garde la référence de son brief.
  }
}

/** Dans une session liée : la référence de la discussion principale écrite à côté du relais, null sinon. */
const readMainRef = async ($: any, runId: string): Promise<MainRef | null> => {
  const path = mainRefPath($, runId)
  if (path) {
    try {
      if (await $.fs.exists(path)) return parseMainRef(JSON.parse(String(await $.fs.read(path))), runId)
    } catch {
      // Fichier hors d'atteinte ou abîmé : l'ancien stockage prend le relais.
    }
  }
  try {
    return parseMainRef(await $.store.get(mainRefKey(runId)), runId)
  } catch {
    return null
  }
}

// ─── Fichier des choix déjà déclarés ──────────────────────────────────────
//
// Un fichier Markdown par parcours, à côté du relais, écrit par la seule discussion principale
// d'après le parcours et le relais : les briefs et les consignes de revue citent son chemin au
// lieu de recopier la liste des choix, qui se périmait d'une consigne à l'autre.

export function decidedPath($: any, runId: string): string | null {
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

export const relayKey = (runId: string): string => `relay:${runId}`

export async function readRelay($: any, runId: string): Promise<unknown> {
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

/**
 * Dans une session liée : une référence de la discussion principale plus récente que celle connue
 * (écrite par elle à sa reprise) remplace celle du brief. Rend la phrase qui le dit, ou rien.
 */
const followMainRef = async ($: any): Promise<string | undefined> => {
  const { value, version } = await $.state.get(BOARD_REF)
  const runId = value?.delegate?.run
  if (!runId) return undefined
  const next = updateDelegateMain(value, await readMainRef($, runId))
  if (!next) return undefined
  const written = await $.state.set(BOARD_REF, next, { ifVersion: version })
  if (!written.isSet) return undefined
  return `The main discussion restarted: its reference is now "${next.delegate!.main}" (written by it next to the relay; the one in your brief is out of date). Send your messages there.`
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

export const delegateKey = (session: string): string => `delegate:${session}`

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
export async function commit($: any, change: (board: Board) => Outcome): Promise<Effects | null> {
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
export const agentCalls = new Set<string>()

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
export const otherHeads = new Map<string, { mtime: number; head: SessionRegistry }>()
export const otherRegistries = new Map<string, { mtime: number; reg: SessionRegistry; traces?: string }>()
/** Les jobs de `claude --bg` finis : leur `state.json` ne change plus. */
const endedJobs = new Map<string, JobInfo>()

/** Une relecture a trouvé le registre d'une session liée changé : l'onglet se redessine. */
let isOtherChanged = false

/** Les fichiers du dossier du registre (`<session>.json`), avec leur date ; `$.store` quand le dossier ne se lit pas (date -1). */
export async function registryFiles($: any): Promise<{ session: string; mtime: number }[]> {
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
export async function refreshLinked($: any): Promise<void> {
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
  const since = minOf(launches.map(l => l.at), run?.startedAt ?? Infinity) - 60_000
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

/** La clé du titre qu'une discussion doit encore prendre : à elle seule, hors du board partagé (série 5, Q2). */
export const discussionTitleKey = (session: string): string => `discussion-title:${session}`

/**
 * Le titre que la discussion doit prendre (parcours né ici, série 1 Q14) part une fois au moteur,
 * dans `sessionTitle` du prochain message ou de la reprise ; rien quand elle le porte déjà (Claude
 * l'a renommée par l'outil de l'app), ni dans une session liée. Le titre en attente s'efface dans
 * tous les cas. Sans le board : `classic.SessionStart` suit `session.start` dans la même
 * milliseconde (mesuré le 28/10/2026, docs/evenements-moteur.md), trop tôt pour compter sur ce
 * qu'il charge, et une session liée n'a
 * jamais de titre en attente (`nameDiscussion` le refuse).
 */
const withDiscussionTitle = async ($: any, e: any, result: any) => {
  let title: string | null = null
  await quietly(async () => {
    const session = await sessionId($)
    if (session === '') return
    const key = discussionTitleKey(session)
    const pending = await $.store.get(key)
    if (pending === undefined) return
    await $.store.delete(key)
    const current = typeof e?.session_title === 'string' ? e.session_title.trim() : ''
    if (typeof pending === 'string' && pending !== '' && pending !== current) title = pending
  })
  return title !== null ? { ...result, sessionTitle: title } : result
}

// ─── Historique de l'onglet Agents ────────────────────────────────────────
//
// Le sélecteur liste le dossier du registre et lit les en-têtes (relus quand leur date change),
// sans index commun écrit par plusieurs sessions. Un parcours passé se montre d'après les
// registres des discussions qui l'ont porté, leurs fichiers à part et celui du parcours.

/** Les en-têtes de tout le dossier, par id, avec la date du fichier lu. */
export const historyHeads = new Map<string, { mtime: number; head: SessionRegistry }>()

/** Les en-têtes de toutes les autres sessions du dossier ; lu à moitié écrit, un en-tête garde la lecture d'avant. */
export async function readAllHeads($: any, self: string): Promise<SessionRegistry[]> {
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
export async function rebuiltIds($: any): Promise<string[]> {
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
export type HistoryShown = { key: string; title: string; self: SessionRegistry; linked: { session: LinkedSession; reg: SessionRegistry | null }[] }

/** Le sélecteur de l'onglet ; la vue de l'entrée choisie vit à côté (`historyShown`), trop grosse pour l'état. */
const historyAtom = atom({ plugin: 'flow-board', key: 'agentsHistory' } as const, [] as HistoryEntry[])
export let historyShown: HistoryShown | null = null
/** L'effacement (`erase-run.ts`) oublie la vue choisie : `historyShown` ne s'écrit que d'ici. */
export const clearHistoryShown = () => {
  historyShown = null
}

/** La vue d'une entrée passée : un parcours, ou une discussion sans parcours. */
export async function buildShown($: any, key: string, board: Board | null, heads: readonly SessionRegistry[]): Promise<HistoryShown | null> {
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
export async function refreshHistory($: any) {
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
    const oldest = minOf(todo.map(r => runWindow(r).s))
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
// Frise : Réflexion du début de la requête au premier morceau de texte ou d'outil,
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
export const quietly = async (effect: () => unknown) => {
  try {
    await effect()
  } catch {
    // Rien à afficher ici : l'état, lui, est déjà écrit.
  }
}

const afterChange = async ($: any, fx: Effects, board: Board) => {
  scheduleSave($)
  if (fx.discussionTitle !== undefined && board.session) {
    const title = fx.discussionTitle
    await quietly(() => $.store.set(discussionTitleKey(board.session!), title))
  }
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

/**
 * Le `CODING_STANDARDS.md` à la racine du projet, s'il existe : les consignes des revues en écrivent
 * le chemin elles-mêmes. Laissé à la session, il manquait aux six fichiers de consignes d'un groupe.
 */
const standardsPath = async ($: any): Promise<string | null> => {
  const root = (await read($, boardAtom))?.root || (await sessionRoot($))
  if (!root) return null
  const path = `${normRoot(root)}/CODING_STANDARDS.md`
  let isThere = false
  await quietly(async () => {
    isThere = (await $.fs.exists(path)) === true
  })
  return isThere ? path : null
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
const REVIEW_RULE_FR = 'règle des revues, config/rules/agents.md et son détail config/reference/revues.md, une fois installés'

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
  `le fichier de méthode de la revue de sécurité, ${securityMethod} (il le suit : la recherche part d'abord, sans relecture préalable du diff ; catégories, exclusions, une vérification par faille de gravité moyenne ou haute seulement, seuil 8/10, format du rapport ; son chemin va dans le prompt du relecteur, à côté du fichier de consignes)`

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
    ? `le chemin du fichier des choix déjà déclarés du parcours, ${path} (tenu par l'outil flow, à relire au moment de la revue), et en plus les choix que la session a déclarés et qui n'y figurent pas encore (ils n'y arrivent qu'une fois lus par la discussion principale), à ne pas défaire par préférence, en signalant tout cas où l'un d'eux produit un défaut, avec son scénario`
    : 'la liste des choix déjà déclarés dans {"decided": …} de l\'outil flow (ceux que tu connais, ceux de la session compris), à ne pas défaire par préférence, en signalant tout cas où l\'un d\'eux produit un défaut, avec son scénario'

/** Une revue de groupe en zone sensible n'applique rien seule : la session trie les constats. */
const SENSITIVE_NO_FIX_FR = `si un ticket du groupe touche une zone sensible (${SENSITIVE_AREAS_FR}), sans --fix : la session applique elle-même les seuls constats qu'elle retient`

/** Ce qu'une passe `/code-review --fix` fait d'un conflit entre la spec et une consigne. */
const NO_ARBITRATION = "elle ne tranche pas un conflit entre la spec et une consigne (CLAUDE.md, une demande de ma part) : elle ne corrige pas ce point et me le remonte"

/**
 * Qui lance la revue d'un groupe (`/code-review high --fix`) dans une session liée : la session
 * elle-même, par l'outil Skill, comme `GROUP_REVIEWER`. Plus de sous-agent qui l'enveloppe, donc
 * plus d'exception à « sans sous-agents qui écrivent » : les correctifs de `--fix` sont ceux de la revue.
 */
const LINKED_GROUP_REVIEW =
  `par l'outil Skill, sans sous-agent qui l'enveloppe : /code-review tourne en exécution dérivée de celui qui la lance, à l'effort de son niveau (seule une session qui ne tourne pas sur Opus la confie à un sous-agent relecteur de modèle opus, qui la lance lui-même ; ${REVIEW_RULE_FR})`

/** Le même sous-agent relecteur, dit à Claude dans la discussion principale. */
const securityReviewer = (scope: string): string =>
  `launch it yourself: a reviewer subagent (Agent tool, general-purpose, model opus, effort high or xhigh as the criterion of the method file decides), read-only, limited to ${scope}; give it in its prompt the path of the security review method file, ${securityMethod} (it follows it: the search starts at once, without a reading of the diff beforehand; categories, exclusions, one verification subtask per finding of medium or high severity only, threshold 8/10, report format), next to ${INSTRUCTIONS_IN_PROMPT}; never /security-review, which diffs against the default branch and rereads the other groups too. The subagent fixes nothing: each kept finding comes numbered (F1, F2…) with a ready fix (what it changes, and the choice it implies if any), the "to watch" list apart. Tell the user plainly; they decide: a reply such as "fix F1 and F3" is enough: apply those fixes, test them, commit them, then send "fixed". Create a tracker task for each kept finding left unfixed`

/** La revue de sécurité après la revue d'un groupe : Claude juge, puis la lance lui-même. */
const securityAdvice = (isRepo: boolean): string =>
  `- Security review: in the same message as the review of a finished group (/code-review high --fix, or high for a sensitive group), since it is read-only and does not wait for the fixes, judge whether a security review is worth it (its changes touch ${SECURITY_CRITERIA}). Tell the user in one line, with the reason, and send {"security": {"group": "<id>", "advised": true|false, "why": "<short reason, in the user's language>"}}. If it is worth it, ${securityReviewer(isRepo ? "git diff <group base>..HEAD (<group base>: the commit before the group's first ticket)" : `the group's diff (${NO_GIT_GROUP_FIXED_POINT}; new files read whole)`)}. Once the group review's fixes are committed: ${SECURITY_FIXES_PASS}. Then send {"security": {"group": "<id>", "findings": <kept findings, not the to-watch list>, "fixed": <fixed>}}.`

/** Le même avis pour un parcours sans groupes (relecture de branche, chasse au bug, TDD) : il porte sur tout le lot. */
const lotSecurityAdvice = (): string =>
  `- Security review: once this review is done and its fixes are in, judge whether a security review is worth it on these changes (they touch ${SECURITY_CRITERIA}). Tell the user in one line, with the reason, and send {"security": {"advised": true|false, "why": "<short reason, in the user's language>"}}, without "group": it covers the whole run. If it is worth it, ${securityReviewer('the changes this review covered')}. Then send {"security": {"findings": <kept findings, not the to-watch list>, "fixed": <fixed>}}.`

/** La revue d'un groupe, lancée par la personne depuis la ligne du groupe : ce qu'elle doit savoir. */
const groupReviewNote = (isRepo: boolean): string =>
  `- This is the review of a finished group${isRepo ? '' : ` (${NO_GIT_GROUP_FIXED_POINT}: give it these copies and files)`}: run it right here, as this skill (a fork of this discussion, at the effort of its level), never wrapped in a reviewer subagent when this discussion runs on Opus${isRepo ? '; its exact command is /code-review high --fix <group base>..HEAD consignes : <path> (high without --fix for a sensitive group; <group base>: the commit before the group\'s first ticket; when launched without a target, review that range)' : ''}. Focus it on the interactions between the group's tickets (each one had its own review), with the path of the file of declared choices and the reviewer brief (both under "Declared choices" below). ${SENSITIVE_NO_FIX[0]!.toUpperCase()}${SENSITIVE_NO_FIX.slice(1)}. It does not settle a conflict between the spec and an instruction (CLAUDE.md, a request of the user): leave that point unfixed and raise it to the user. Then read the diff of its fixes, rerun the checks and commit them.`

/** La passe « bogues » d'un ticket en cours (zone sensible) : pas la revue du groupe. */
const bugPassNote = (isRepo: boolean): string =>
  `- This is the bug pass of the ticket in progress (sensitive area), not the review of a group: same scope as its /mattpocock-skills:code-review (${isRepo ? TICKET_FIXED_POINT : NO_GIT_TICKET_FIXED_POINT}); give it the path of the file of declared choices and the reviewer brief (both under "Declared choices" below), and in its instructions file the ticket's invariant when it has one (fixed at framing): the reviewer looks first for what breaks it. Report its findings with the ticket's review ("review"), then commit the ticket.`

/**
 * La taille d'un groupe au découpage (Mathis, L3 a de la rétro de l'onglet Agents) : mesuré sur
 * quatre sessions liées, le premier ticket coûte 375 à 500k tokens de contexte, chaque suivant 60 à 150k.
 */
const GROUP_SIZE =
  'A group holds 5 tickets at most: the context of a linked session reached 820 to 920k tokens, close to its ceiling of about 1M, for 6 tickets (the first ticket costs 375 to 500k, each next one 60 to 150k); keep a sensitive ticket with other tickets rather than alone, where it costs the most per ticket'

/** L'ordre des tickets d'un groupe : un ticket indépendant attendait derrière un ticket sensible en attente d'une réponse. */
const SENSITIVE_ORDER =
  'In a group, a sensitive ticket goes first only when it blocks the next one; otherwise it comes after the independent tickets, which do not wait behind its questions'

/** Une écriture hors du dépôt avait bloqué une session liée 42 min (un README d'un autre dépôt). */
const OUTSIDE_WRITE =
  'A write planned outside the repository (a file of another repository, of ~/.claude or anywhere else on the machine) is a decision to take with the user before the group is launched: ask it now, with options, and write the answer in the ticket; a linked session cannot settle it alone'

/**
 * Les cas à trancher au cadrage d'un ticket sensible : 26 décisions sensibles étaient nées des
 * revues en cours de route (rétro de l'onglet Agents). L'invariant vient de la règle « Invariant
 * d'un ticket en zone concurrence ou suppression » de config/rules/flow-board.md.
 */
const SENSITIVE_FRAMING =
  'For a ticket in a sensitive area, settle with the user while framing, among the cases that apply: erasures that overlap, a resume after an interruption, the state after /reload-plugins, and what a failure message says. A ticket in the concurrency or deletion area also fixes with the user the one-sentence invariant of its persisted data, what it must never become whatever happens (crossed writes, a cut write, a failed read), for example « a totals file is never deleted nor rewritten empty »; the ticket carries it, and the instructions file of its bug pass copies it'

/**
 * Un champ ajouté à des données persistées est en zone sensible : trois tickets qui ajoutaient un
 * champ au registre des agents ou au board partagé se disaient « Zone sensible : non », et son
 * effacement oublié avait coûté trois revues et deux correctifs.
 */
const PERSISTED_FIELD =
  'A ticket that adds a field to persisted data (a stored file or registry, a record shared between discussions or sessions, a key of the store) says « Zone sensible : oui » and is sent with "sensitive": true: such a field is in the deletion area (what erases its record must erase it too) or the concurrency area (several discussions write it); the ticket names every path that erases the field and every path that merges or rebuilds it, and carries the invariant of its persisted data (see the framing of a sensitive ticket)'

/** Une spec qui s'appuyait sur un skill sans le nommer avait fait chercher son contenu par un `find /` de 49 s. */
const SKILL_IN_SPEC =
  'A spec that relies on a skill (prices, an API, a method) says « charger le skill <name> » where it needs it, so that the session loads it instead of searching the disk'

/** Les skills de cadrage : un choix sensible y devient une question, jamais un choix déclaré. */
const FRAMING_SKILLS = new Set(['grilling', 'grill-with-docs', 'grill-me', 'to-questionnaire', 'to-spec', 'to-tickets', 'domain-modeling'])

/** Les consignes où une revue reçoit le fichier des choix déclarés. */
const REVIEW_NOTES = new Set(['implement', 'final-review', 'code-review', 'branch-review'])

const coachingNote = (id: string, run: Run, sync: SyncState, isRepo: boolean, session?: string, decidedAt?: string | null, failedAgents = 0, standards: string | null = null): string => {
  const def = SKILLS[id]!
  const lines = [
    '',
    '',
    '---',
    `Dashboard (flow-board): report progress with the \`${TOOL}\` tool. It is silent bookkeeping: no need to mention it to the user; batch it with your other tool calls when you can.`,
  ]
  if (!run.isTitled) {
    lines.push(`- First call: {"title": "<a short title you choose that sums up the whole work, 3 to 6 words, in the user's language; never their message itself>"}. If you have a tool that renames this discussion (in the app: set_session_title), call it right away with the same title, unless the answer says this discussion keeps its name.`)
  }
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
    lines.push(`- ${PERSISTED_FIELD}.`)
    lines.push('- A write to CLAUDE.md never goes into the done criteria of a group ticket: a linked session cannot make it. It is a gesture of the main discussion, done when the group is back.')
    lines.push(`- ${GROUP_SIZE}.`)
    lines.push(`- ${SENSITIVE_ORDER}.`)
    lines.push(`- ${OUTSIDE_WRITE}.`)
    lines.push('- Last, group the tickets for execution: {"groups": [{"id": "A", "name": "<short theme>", "tickets": ["<ids in execution order>"], "why": "<the shared context>", "files": ["<other repo paths it touches>"], "resources": ["<what it cannot share>"]}]}. Each group runs in a linked session, never in this discussion. Same group = same files or modules, or a chain of dependencies: its linked session does them in a row with /implement. A different context = another group; a group of one ticket is fine when its context is its own, and a ticket that blocks nothing in its theme but could start now (an export, a query, a data check) is often better in a group of its own or with other data work. Groups that share no file, no resource and do not depend on each other can later run at the same time, one linked session per group. "resources": what a group cannot share with another group working at the same time, with the same name in every group: an application driven on screen and checked by screenshots (e.g. "PowerBI Desktop"), a single database, device or account; check the project\'s CLAUDE.md for such constraints. Every ticket in exactly one group. Send no groups when there would be only one (one group, or one group plus tickets left outside it): a single group brings nothing, the dashboard ignores such a plan, and the lot is done in this discussion with /implement.')
  }
  if (id === 'implement') {
    lines.push('- For each ticket, the steps above restart from "read". With "review", send the findings of the two axes: {"step": "review", "review": {"standards": <findings>, "spec": <findings>, "fixed": <fixed>}}.')
    lines.push('- In this discussion, /code-review (Claude Code) runs only as the bug pass of a ticket that touches a sensitive area. The review of a group, /code-review high --fix <group base>..HEAD consignes : <path> (high without --fix for a group with a sensitive ticket; <group base>: the commit before the group\'s first ticket), is launched by the user from the dashboard once the group\'s tickets are committed: do not launch it yourself.')
  }
  if (def.groupSteps) {
    lines.push(`- Then, for each group once all its tickets are committed and reviewed (their review fixes committed), in this order: ${def.groupSteps.map(s => `${s.label} (${hintOf(s, isRepo)})`).join('; ')}.`)
    lines.push(`- ${SINGLE_TICKET_GROUP}.`)
  }
  if (id === 'implement') lines.push(securityAdvice(isRepo))
  // Sans git, la méthode des copies : le point fixe de chaque revue.
  if (!isRepo && (id === 'implement' || id === 'final-review')) lines.push(`- ${NO_GIT_COPIES}.`)
  if (run.queue && run.queue.length > 0 && id === 'implement') {
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
  if (id === 'implement') {
    const started = run.tickets.filter(t => t.status === 'doing')
    if (started.length > 0) {
      lines.push(
        `- Already in progress when this skill loaded: ${started.map(t => `${t.name} [${t.id}]`).join('; ')}. A previous discussion may have stopped in the middle: ${isRepo ? 'check git status and git diff' : 'compare its copies with the current files ("Without git")'} before writing anything, and continue its uncommitted work instead of starting over. Tickets marked done are committed: do not redo them.`,
      )
    }
  }
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
    lines.push(
      advice.commands.every(c => !('shell' in c))
        ? `- The remote moved (${advice.reason}). Before your first code change, ask the user to run ${adviceText(advice, ' then ', 'in')} (user-only commands) and wait until it is done.`
        : `- The remote moved (${advice.reason}) and the branch has no local commit ahead. Before your first code change, offer the user a fast-forward update, ${adviceText(advice, ' then ', 'in')}, and wait for their agreement.`,
    )
  }
  if (id === 'to-spec' || id === 'to-tickets') lines.push(`- ${SENSITIVE_FRAMING}.`)
  if (id === 'to-spec') lines.push(`- ${SKILL_IN_SPEC}.`)
  if (FRAMING_SKILLS.has(id)) {
    lines.push(
      `- A choice that touches a sensitive area (${SENSITIVE_AREAS}) is never a declared choice ({"decided": …}): ask the user while framing, with options, and wait for the answer. Before a privacy question, have a read-only subagent check the real exposure (who can read the data, from where, with what access); without that check, the question says the exposure is "à confirmer". A decision entry (DECISIONS.md, an ADR) copies the question asked and the accepted answer word for word, the user's sentence in quotes, instead of summarising them.`,
    )
  }
  if (id === 'retro') {
    lines.push(
      '- Improvements that touch another repository (shared plugins, common config, another project) are not applied from this discussion: keep them out of the items and give them in your message as a correction list ready to hand to an agent working in that repository, one point per improvement: the finding, then the expected correction, with the plugin or files it touches. Only the improvements of this repository go to the items, hence to a linked session.',
    )
  }
  if (REVIEW_NOTES.has(id)) {
    lines.push(
      standards
        ? `- Project judgement rules: ${standards}. Write this path in the instructions file of every review (both axes of a ticket, the bug pass, the group review), for the reviewer to read besides CLAUDE.md.`
        : '- Project judgement rules: this project has no CODING_STANDARDS.md at its root; say so in the instructions file of every review, so that no reviewer looks for it.',
    )
    lines.push(
      decidedAt
        ? `- Declared choices: the file ${decidedAt}, kept by the flow tool from every "decided" of this run (main discussion and linked sessions). Give its path to every reviewer instead of pasting the list, with this reviewer brief, word for word: ${REVIEWER_BRIEF}. To that end, ${reviewInstructions(isRepo)}.`
        : `- Declared choices: their file is out of reach; give every reviewer the list of the choices sent in "decided" of the flow tool, with this reviewer brief, word for word: ${REVIEWER_BRIEF}. To that end, ${reviewInstructions(isRepo)}.`,
    )
  }
  if (id === 'implement') {
    lines.push('- When every ticket of the lot is done: {"complete": true}. If reviews kept apart findings on code older than the lot, propose them to the user as a « durcissement » group (one ticket per finding), without creating it before they agree. A finished group is not the end: while tickets of the lot remain open, the next step is the next group, which the user launches from the dashboard, in its linked session (↗ Session liée). Do not suggest /flow-board:compte-rendu or the delivery before every ticket is done. Add {"note": "<one short line>"} for a decision worth keeping.')
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
const fillCommand = async ($: any, command: string, toast?: string) => {
  const text = `/${command} `
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? (toast ?? `${text.trim()} est dans le prompt : ajoute des consignes si tu veux, puis Entrée`) : `Tape ${text.trim()} dans le prompt`))
}

/** L'avance rapide d'un dossier en retard sur origin : une demande à Claude dans le prompt, Entrée la lance. */
const askFastForward = async ($: any, dir: string | null) => {
  const text = dir ? `Mets à jour ${dir} en avance rapide : git -C "${dir}" pull --ff-only` : 'Mets à jour la branche en avance rapide : git pull --ff-only'
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? 'La demande de mise à jour est dans le prompt : Entrée pour la lancer' : `Tape dans le prompt : ${text}`))
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
  // Après /to-tickets, avant les groupes : alléger l'orchestrateur (la suite n'est pas une commande).
  if (suggestsCompaction(board, await read($, registryAtom))) return showSuggestion($, '/compact')
  const sync = await read($, syncAtom)
  const skill = nextCommandSkill(run, { hasPullRequests: sync.isGitHub !== false, isVersionSet: sync.isVersionSet })
  // La rétro d'un parcours à sessions liées part avec sa consigne (bouton), pas en commande seule.
  if (skill === null || (skill === 'retro' && linkedSessionsOf(run).count > 0)) return
  const args = commandArgsOf(run, skill)
  await showSuggestion($, `/${await commandFor($, skill)}${args ? ` ${args}` : ''}`)
}

/** Une commande grisée dans le prompt vide. */
const showSuggestion = async ($: any, text: string) => {
  let isShown = false
  await quietly(async () => {
    isShown = (await $.prompt.suggest({ text })).isShown === true
  })
  // Le tour n'est peut-être pas encore tout à fait fini : un second essai, juste après.
  if (!isShown) $.clock.after(SUGGEST_RETRY_MS, () => void quietly(() => $.prompt.suggest({ text })))
}

/**
 * La consigne de transcript de `/retro` : affirmative quand le registre porte une compaction, sinon
 * une vérification d'abord (une discussion reprise après une compaction n'a pas de repère ici).
 */
const retroTail = async ($: any): Promise<string> => {
  let reg: SessionRegistry | null = null
  await quietly(async () => {
    reg = await read($, registryAtom)
  })
  const self = reg as SessionRegistry | null
  let session: string | undefined = self?.session
  if (session === undefined) await quietly(async () => {
    session = (await read($, boardAtom))?.session
  })
  return retroTranscriptNote(self?.transcript, session, lastCompactionAt(self) !== null)
}

/** Le texte d'un skill, suivi d'une consigne (vide : tel quel). */
const withTail = <R extends { text: string }>(result: R, tail: string): R => (tail === '' ? result : { ...result, text: `${result.text}${tail}` })

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
  const who = prefix ? `les sessions dont le titre commence par « ${prefix} » (${OLD_SEPARATORS})${known}` : `les sessions lancées pour ses groupes ou ses pistes${known}`
  const text =
    `/${await commandFor($, 'retro')} Rétro globale du parcours « ${run.title} » : cette discussion (la session mère) et ses sessions filles, ${who}, à retrouver par ListAgents. ` +
    `1) D'abord, lance un sous-agent par session fille, tous en parallèle et en lecture seule (general-purpose, pas Haiku) : chacun lit le transcript de sa session, son fichier .jsonl sous ~/.claude/projects/ (pas claude logs, dont la sortie de terminal est illisible), en entier, compactions comprises, avec cette règle du fichier d'origine : « ${ORIGIN_FILE_RULE} », et en fait la rétro selon les étapes et les sept axes de ce skill, que tu lui transmets tels que tu les lis ici ; il ne modifie rien et rend ses pistes par sévérité, une par ligne « axe : correction », chacune avec ce qui l'a révélée dans la session. ` +
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
const launchPicks = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  const selection = (await read($, uiAtom)).selection ?? []
  if (!run || selection.length === 0) return
  await launchQueue($, run, selection)
}

/** Enregistre la file, vide la sélection et met /implement dans le prompt, tickets dans l'ordre. */
const launchQueue = async ($: any, run: Run, ids: readonly string[]) => {
  const now = await $.clock.now()
  await commit($, b => setQueue(b, ids, now))
  const list = ticketList(run, ids)
  const args = `Tickets à traiter, un par un et dans cet ordre : ${list}`
  await update($, uiAtom, ui => ({ ...ui, selection: [] }))
  await prepare($, 'implement', args)
}

/** « ▶ Tout implémenter ici » : un lot sans groupe se fait dans cette discussion, tickets ouverts dans l'ordre du lot. */
const launchAll = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  const ids = (run?.tickets ?? []).filter(t => t.status !== 'done').map(t => t.id)
  if (!run || ids.length === 0) return
  await launchQueue($, run, ids)
}

const ticketList = (run: Run, ids: readonly string[]): string =>
  ids.map((id, i) => `${i + 1}) ${id} — ${run.tickets.find(t => t.id === id)?.name ?? id}`).join(' ; ')

/** Longueur au-delà de laquelle le titre du parcours est coupé dans le titre d'une session liée. */
const PREFIX_MAX = 28

/**
 * Le début du titre de toute session liée : le titre du parcours, raccourci, puis « > » (ASCII :
 * l'app affichait « ' » à la place de « › »). Dans la
 * liste des discussions, les sessions filles d'une même discussion mère se reconnaissent ainsi. Sans
 * guillemets ni `$`, `\`, accent grave : le titre passe aussi entre guillemets dans `claude --bg -n`.
 */
const linkedPrefix = (run: Run): string => {
  const clean = run.title.replace(/["`$\\«»]/g, '').replace(/[>›]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  if (clean.length <= PREFIX_MAX) return `${clean} ${TITLE_SEPARATOR} `
  const cut = clean.slice(0, PREFIX_MAX)
  const at = cut.lastIndexOf(' ')
  return `${(at > PREFIX_MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:·–-]+$/, '')}… ${TITLE_SEPARATOR} `
}

/**
 * Le nom court d'un parcours dans le nom du worktree d'une session de groupe : `-w groupe-<id>`
 * était entré en collision avec le worktree d'un autre parcours. Le préfixe `groupe-` reste :
 * `/stats-board:recap --worktrees` retrouve les sessions d'un parcours par les worktrees `groupe-*`.
 */
const WORKTREE_SLUG_MAX = 20
const worktreeSlug = (run: Run): string => {
  const slug = run.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= WORKTREE_SLUG_MAX) return slug
  const cut = slug.slice(0, WORKTREE_SLUG_MAX)
  const at = cut.lastIndexOf('-')
  return (at > WORKTREE_SLUG_MAX / 2 ? cut.slice(0, at) : cut).replace(/-+$/, '')
}
/** Le worktree d'un groupe : `groupe-<nom court du parcours>-<id>`, `groupe-<id>` pour un parcours sans titre. */
const groupWorktree = (run: Run, id: string): string => {
  const slug = worktreeSlug(run)
  return slug ? `groupe-${slug}-${id}` : `groupe-${id}`
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
      ? `use_worktree true et branch_name "${o.worktree}" (un worktree à elle, à ce nom : sans branch_name, l'app en invente un que la fermeture du groupe ne reconnaît pas)`
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
    `Le prompt désigne cette discussion par sa référence entre crochets ([<ref>]), à passer aussi dans "main" de l'appel delegate, et donne en repli son nom du moment : son nom peut changer, sa référence aussi quand elle redémarre. Pour lui écrire, ${each} appelle ListAgents, trouve la ligne qui porte cette référence et envoie par SendMessage à « <nom du moment> [<ref>] » tel que la liste l'affiche ; la référence change quand cette discussion redémarre : l'outil flow de ${each} donne la référence du moment, que cette discussion lui transmet à la reprise ; si aucune ligne ne porte la référence, ${each} cherche la ligne qui porte le nom de cette discussion (le prompt le donne aussi, en repli), jamais une session dont le titre commence par « ${o.title.replace(/ > .*$/, '')} > » (ses sœurs), lui envoie son message, et le dit en tête de sa réponse finale. ` +
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
  "Rédige toi-même le background, sans y reprendre le texte des règles : les règles de travail de la session (écritures permises, gestes qui me sont réservés, dépôt public, contraintes du projet) sont dans le document du projet pour les sessions déléguées s'il en a un (son CLAUDE.md le nomme), sinon dans son CLAUDE.md, et le modèle et l'effort des revues dans mes règles communes (config/rules/agents.md quand elles sont installées) ; la session les charge d'elle-même, le background les cite par leur chemin : un texte repris se périme quand la règle change ; si le projet a un dossier config/rules (des règles communes versionnées avec lui), le background dit que leur version du dépôt fait foi sur celle installée sous ~/.claude tant que je n'ai pas poussé (des sessions avaient suivi une règle installée périmée). " +
  `Il ne garde que ce qui varie : le projet en une phrase, ${many ? 'le groupe de la session et ses tickets' : 'le groupe et ses tickets'}, la ressource à ne pas partager${many ? ', ce que font les autres sessions en même temps' : ''}, les décisions déjà prises par renvoi, sans les réécrire : le fichier de décisions du projet (DECISIONS.md, ou celui que nomme son CLAUDE.md) et les commentaires « mise à jour du porteur » des tickets font foi, et une décision que je viens de prendre ici s'y écrit AVANT d'être relayée, avec ma phrase exacte entre guillemets ; une décision qui remplace un geste humain (un accord, une validation, un ok de dépense) se confirme par moi directement dans la session liée, jamais par ton seul message ; `

/** Comment la discussion principale suit une session liée : `claude logs` rend une sortie de terminal illisible. */
const FOLLOW = (isRepo: boolean): string =>
  `pour savoir où en est une session, lire ${isRepo ? "l'état git de son worktree (git -C <worktree> log --oneline et git -C <worktree> status)" : 'les fichiers modifiés dans ce dossier'}, le tracker (statuts des tickets) et ListAgents (la session est-elle encore là), jamais claude logs, dont la sortie de terminal est illisible`

/** Ce qui sert de note de fin à la discussion principale, selon que la session a été lancée par l'app ou par le CLI. */
const atEnd = (whose: string): string => `À la note de fin de ${whose} (dans le CLI : son message reçu par SendMessage)`

/** Une faille corrigée après le retour d'un groupe : sans nouvel envoi, le tableau de bord gardait « 0 corrigé ». */
const FIXED_LATER = "une faille corrigée après coup (avec mon accord) se renvoie aussi, avec \"fixed\" mis à jour, sinon le tableau de bord garde « 0 corrigé »"

const LINKED_NO_GIT_GROUP_POINT =
  "point fixe : pour chaque fichier, la plus ancienne copie parmi les tickets du groupe (un fichier touché seulement par un ticket suivant n'a pas de copie du premier), comparée au fichier actuel, les fichiers nouveaux en entier ; lui donner la liste des copies et des fichiers"

/**
 * La demande à Claude pour confier des groupes à des sessions liées, une par groupe. Le parcours
 * reste ici (un seul écrivain) : chaque session se déclare (`delegate`), suit la procédure de
 * `reference/procedure-groupe.md` (citée par son chemin, jamais recopiée) selon le CLAUDE.md du
 * projet, puis rend compte ; Claude rend les statuts ici. Le prompt ne porte que ce qui varie.
 */
const delegationText = async ($: any, run: Run, views: readonly GroupView[], decidedAt: string | null = null): Promise<string> => {
  noteReferences($)
  // Sans git, pas de worktree possible : les sessions travaillent dans ce dossier.
  const isRepo = await measureRepo($)
  const implement = `/${await commandFor($, 'implement')}`
  const tdd = `/${await commandFor($, 'tdd')}`
  const ticketReview = `/${await commandFor($, 'code-review')}`
  const standards = await standardsPath($)
  const many = views.length > 1
  const delegate = `{"delegate": "${run.id}", "group": "${many ? '<id du groupe>' : views[0]!.group.id}", "main": "[<ref>]"}`
  const groups = views.map(v => `Groupe ${v.group.id} (${v.group.name}) : ${ticketList(run, v.open.map(t => t.id))}`).join(' ∥ ')
  const prefix = linkedPrefix(run)
  return (
    `${many ? 'Confie chacun de ces groupes à sa session liée, en parallèle,' : 'Confie ce groupe à une session liée,'} pour le parcours « ${run.title} » : ${groups}. ` +
    `Avant de lancer : repère ce dont ${many ? 'les sessions auront' : 'la session aura'} besoin de ma part (une décision, un accès, un geste qui m'est réservé) et règle-le d'abord avec moi ici, sinon ${many ? 'elles y buteront' : 'elle y butera'}. ` +
    `Puis lance ${many ? 'une session par groupe' : 'la session'}, avec un titre qui commence par « ${prefix}Groupe <id> · » : le début dit de quelle discussion ${many ? 'elles viennent' : 'elle vient'}, et « Groupe <id> » relie la session à son groupe au tableau de bord. ` +
    launchHow({ many, isRepo, ownFolder: true, title: `${prefix}Groupe <id> · <thème>`, worktree: groupWorktree(run, '<id>'), effort: GROUP_EFFORT(many) }) +
    `${BACKGROUND(many)}${decidedAt ? `le fichier des choix déjà déclarés du parcours se cite par son chemin, ${decidedAt}` : 'les choix déjà déclarés (ceux envoyés dans decided) se donnent en liste : leur fichier est hors d\'atteinte'}. ` +
    `Le prompt de ${many ? 'chaque session' : 'la session'} : 1) d'abord, appeler une seule fois l'outil flow de flow-board avec ${delegate} : le parcours reste ici, et l'avancement de la session (statuts Asana des tickets, commits, tests) est relayé tout seul au tableau de bord d'ici ; ` +
    `2) puis lire la procédure d'une session liée de groupe, ${procedurePath}, et la suivre jusqu'au bout : questions sensibles d'abord, chaque ticket (TDD, contrôles, revue du ticket, passe « bogues » s'il est sensible, commit et suivi), règles de travail, revue du groupe, revue de sécurité, compte rendu déposé au relais puis une ligne à cette discussion ; ` +
    `3) ce qui varie, que la procédure attend du prompt : les commandes de ce poste (TDD : ${tdd} ; revue du ticket : ${ticketReview} ; ${implement} est réservé à l'utilisateur), le fichier de méthode de la revue de sécurité, ${securityMethod}, ${decidedAt ? `le fichier des choix déjà déclarés du parcours, ${decidedAt}` : 'la liste des choix déjà déclarés (leur fichier est hors d\'atteinte : section 8 de la procédure)'}, ${standards ? 'que le projet a un CODING_STANDARDS.md à sa racine (son chemin, à la racine du dossier de travail de la session, va dans le fichier de consignes de chaque revue)' : "que le projet n'a pas de CODING_STANDARDS.md à sa racine"}, et ${isRepo ? 'que son dossier est un dépôt git' : "que son dossier n'a pas de git (section 9 de la procédure)"}. ` +
    `Ici : garder le parcours (pas de nouveau parcours) et suivre ${many ? 'les sessions sans les ' : "la session sans l'"}attendre activement : ${FOLLOW(isRepo)}. ` +
    `Le compte rendu complet d'une session est dans le relais, son message n'en porte qu'une ligne : chaque réponse de l'outil flow ici cite ceux qu'ont déposés les sessions des groupes pas encore rendus, à la reprise comme ensuite. ` +
    `Si l'app ou cette discussion redémarre, le parcours passe en pause et ne reçoit plus rien : à la reprise de cette discussion, le reprendre ici avant toute autre écriture, par l'appel flow {"resume": "${run.id}", "main": "[<ref>]"} (comme « ↻ Reprendre ici » ; "main" : ta référence du moment, lue par ListAgents, qui change au redémarrage : les sessions liées la relisent par leur outil flow), puis rendre les statuts des tickets faits pendant la pause d'après Asana. ` +
    `${atEnd(many ? 'chacune' : 'la session')}, vérifier son travail ; avant d'appliquer ici un correctif que son compte rendu propose, lire ${isRepo ? 'sa branche (git log et git diff de son worktree)' : 'ses fichiers'} : elle l'a peut-être déjà fait ; une question de son compte rendu se tranche ici, et la session n'applique rien d'autre sans un message d'ici ; vérifier aussi, dans son compte rendu, que la revue du groupe a tourné (sinon, la lui demander par SendMessage avant tout ; un groupe d'un seul ticket ni sensible ni avec logique n'en a pas : la revue de son ticket suffit)${isRepo ? ', fusionner sa branche' : ''}, puis envoyer à l'outil flow les statuts de ses tickets dans "set", avec {"returned": ["<id du groupe>"]} et, si son compte rendu dit que la revue du groupe a tourné, {"reviewed": ["<id du groupe>"]} (le tableau de bord ne la voit pas toujours : sans cela, il la proposerait encore), ` +
    `et, d'après son compte rendu, {"security": {"group": "<id du groupe>", "advised": true|false, "why": "<raison>"}}, avec "findings" et "fixed" si la revue de sécurité a tourné ; me dire les failles trouvées : je décide de leur correction ; ${FIXED_LATER}.`
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
  // Le brief cite le fichier des choix : il existe avant que la session le lise, sinon le brief n'en cite pas le chemin.
  const decidedAt = await writeDecidedFile($, await read($, boardAtom))
  const text = await delegationText($, run, views, decidedAt)
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
  noteReferences($)
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
    `2) lancer elle-même la revue, ${LINKED_GROUP_REVIEW} ; la revue est /${commandLineOf('final-review')} (outil Skill « ${slashOf('final-review')} », arguments « ${SKILLS['final-review']!.args} ${isRepo ? '<plage> ' : ''}consignes : <chemin> ») ${isRepo ? "sur les seuls commits du groupe, lus sur le code actuel, avec pour cible leur plage <commit d'avant le premier du groupe>..<dernier commit du groupe> (une revue sans cible n'y verrait aucun changement, et un hash seul ne relirait qu'un commit)" : `sur les seuls changements du groupe, lus sur le code actuel (${LINKED_NO_GIT_GROUP_POINT} : sa session a pris ces copies dans son dossier temporaire)`}, en lui donnant ${decidedList(await writeDecidedFile($, await read($, boardAtom)))} et la consigne des relecteurs (section 7 de la procédure des sessions liées de groupe, ${procedurePath}), par son fichier de consignes, et en lui demandant de se concentrer sur les interactions entre les tickets ; ${SENSITIVE_NO_FIX_FR} ; ${NO_ARBITRATION} ; ` +
    `3) au retour de la revue, relire le diff de ses correctifs, relancer les contrôles du projet et commiter ; ` +
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
  noteReferences($)
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
    : `retrouve son id par claude agents ou list_sessions, titre qui commence par ${linkedTitles(run, group.id)}`
  // Une session de l'app a un id local_… : stop_session n'interrompt qu'un tour en cours, la
  // personne l'archive dans l'app (son worktree restait sinon en place).
  const stop = session?.startsWith('local_')
    ? "c'est une session de l'app Desktop : demande-moi de l'archiver dans l'app (stop_session n'interrompt qu'un tour en cours, il ne ferme pas une session inactive), et attends que je te confirme qu'elle est archivée avant toute autre commande"
    : `claude stop ${session ?? '<id>'} (sa conversation est gardée ; jamais claude rm, qui l'efface) ; si claude agents ne connaît pas cet id, c'est une session de l'app : demande-moi de l'archiver dans l'app (stop_session ne ferme pas une session inactive), et attends que je te confirme qu'elle est archivée avant toute autre commande`
  const text = isRepo
    ? `Ferme la session liée et le worktree du groupe ${group.id} (${group.name}) du parcours « ${run.title} », rendu ici. Vérifie d'abord, n'arrête et ne retire qu'ensuite, par des commandes séparées lancées dans ce dossier : ` +
      `1) prends la branche de la session dans la liste des sessions liées (list_sessions dans l'app Desktop) ou dans sa note de fin ; à défaut, elle s'appelle normalement worktree-${groupWorktree(run, group.id)} (lancée par le CLI), ${groupWorktree(run, group.id)} ou claude/${groupWorktree(run, group.id)}-<suffixe> (lancée par l'app, avec ou sans branch_name), groupe-${group.id} pour un groupe lancé avant la 0.59.0 : trouve sa ligne par git worktree list, et vérifie par git log <branche> --oneline -5 que ses commits sont ceux du groupe ; au moindre doute (nom différent, branche sans commit du groupe, un autre parcours), arrête-toi et demande-moi ; ` +
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
const linkedTitles = (run: Run, groupId: string): string => `« ${linkedPrefix(run)}Groupe ${groupId} · » (${OLD_SEPARATORS}) ou « Groupe ${groupId} · »`

/** Les titres des sessions liées lancées avant le séparateur « > » : l'app y affichait « ' » à la place de « › ». */
const OLD_SEPARATORS = "« › » ou « ' » à la place de « > » pour une session lancée avant la 0.61.0"

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

const actionsFor = ($: any): Actions => ({
  setTab: async (tab: Tab) => {
    // La fenêtre de la frise repart de « tout » à chaque ouverture de l'onglet Agents.
    await update($, uiAtom, ui => ({ ...ui, tab, ...(tab === 'agents' && ui.tab !== 'agents' ? { agentsWindow: undefined } : {}) }))
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
    await update($, uiAtom, ui => ({ ...ui, agentsHistory: key === 'now' ? undefined : key, isAgentsHistoryOpen: false, agentsSession: undefined, agentCard: undefined, isPromptOpen: false, confirmForget: undefined, agentsWindow: undefined }))
    await quietly(() => refreshHistory($))
  },
  openAgentsOf: async (runId: string) => {
    await update($, uiAtom, ui => ({ ...ui, tab: 'agents' as const, agentsHistory: `run:${runId}`, isAgentsHistoryOpen: false, agentsSession: undefined, agentCard: undefined, isPromptOpen: false, agentsWindow: undefined }))
    await quietly(() => refreshHistory($))
    void quietly(() => rebuildPastRuns($))
  },
  launch: (skill: string, args?: string) => launch($, skill, args),
  prepare: (skill: string, args?: string) => prepare($, skill, args),
  fillCommand: (command: string) => fillCommand($, command),
  compactFirst: () => fillCommand($, 'compact', COMPACT_FIRST_TOAST),
  askFastForward: (dir: string | null) => askFastForward($, dir),
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
  launchPicks: () => launchPicks($),
  launchAll: () => launchAll($),
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
  setAgentsWindow: (win: AgentsWindow | null) => update($, uiAtom, ui => ({ ...ui, agentsWindow: win ?? undefined })),
  selectAgentsSession: async (key: string | null) => {
    await update($, uiAtom, ui => ({ ...ui, agentsSession: key ?? undefined, agentCard: undefined, isPromptOpen: false, agentsWindow: undefined }))
    void quietly(() => catchUpShown($))
  },
  toggleAgentCard: (key: string) => update($, uiAtom, ui => ({ ...ui, agentCard: ui.agentCard === key ? undefined : key, isPromptOpen: false })),
  togglePrompt: () => update($, uiAtom, ui => ({ ...ui, isPromptOpen: ui.isPromptOpen !== true })),
  toggleLegend: () => update($, uiAtom, ui => ({ ...ui, isLegendOpen: ui.isLegendOpen !== true })),
  toggleWorkflow: (id: string) =>
    update($, uiAtom, ui => {
      const open = ui.openWorkflows ?? []
      return { ...ui, openWorkflows: open.includes(id) ? open.filter(x => x !== id) : [...open, id] }
    }),
  openAgentTranscript: (agentId: string) => quietly(() => $.ui.view({ agentId })),
  openPane: async () => {
    await update($, uiAtom, ui => ({ ...ui, isPaneDismissed: false, agentsWindow: undefined }))
    await quietly(() => $.ui.open({ id: PANE, title: PANE_TITLE }))
  },
  copyLink: async (url: string, what: string, surface?: string) => {
    let done: { isCopied?: boolean } | null = null
    try {
      done = await $.ui.copy({ text: url, ...(surface ? { surface } : {}) })
    } catch {
      // Le toast donne alors l'adresse à recopier.
    }
    await quietly(() => $.ui.toast(done?.isCopied ? `Lien ${what} copié` : `Copie impossible : ${url}`))
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

const samePath = (a: string, b: string): boolean => normRoot(a).toLowerCase() === normRoot(b).toLowerCase()

/** La racine du worktree git qui contient `dir`, ou null hors d'un dépôt (ou dossier absent). */
const toplevel = async ($: any, dir: string): Promise<string | null> => {
  const res = await runGit($, dir, ['rev-parse', '--show-toplevel'], 5000)
  return res.exitCode === 0 && res.stdout !== '' ? normRoot(res.stdout) : null
}

/** Le dossier d'un fichier, sans le nom du fichier. */
const parentOf = (path: string): string => normRoot(path).replace(/\/[^/]*$/, '')

/**
 * Le worktree d'un fichier du projet : `git rev-parse --show-toplevel` depuis son dossier, en
 * remontant jusqu'au premier dossier qui existe (un Write peut créer un dossier) sans sortir de `root`.
 */
const worktreeOfFile = async ($: any, root: string, path: string): Promise<string | null> => {
  const base = normRoot(root).toLowerCase()
  for (let dir = parentOf(path); dir.length >= base.length && dir.toLowerCase().startsWith(base); dir = parentOf(dir)) {
    const top = await toplevel($, dir)
    if (top !== null) return top
    if (dir.toLowerCase() === base) break
  }
  return null
}

/**
 * Les versions déjà posées face au distant (`base` : la branche suivie, sinon origin/main) : les
 * fichiers changés depuis, les manifestes de version du dépôt (ceux que liste la marketplace quand le
 * dépôt en a une : un plugin d'essai non publié ne compte pas) et ceux dont la ligne de version a changé.
 */
const measureVersions = async ($: any, dir: string, base: string): Promise<boolean | null> => {
  const changed = await runGit($, dir, ['diff', '--name-only', `${base}...HEAD`], 10_000)
  if (changed.exitCode !== 0) return null
  const listed = await runGit($, dir, ['ls-files', ...VERSION_MANIFESTS.flatMap(m => [m, `*/${m}`])], 10_000)
  if (listed.exitCode !== 0) return null
  let manifests = listed.stdout.split('\n').filter(Boolean)
  const market = await runGit($, dir, ['show', 'HEAD:.claude-plugin/marketplace.json'], 5000)
  if (market.exitCode === 0) {
    try {
      const sources = (JSON.parse(market.stdout).plugins ?? []).map((p: any) => String(p?.source ?? '').replace(/^\.\//, '').replace(/\/+$/, ''))
      manifests = manifests.filter(m => sources.some((s: string) => m === `${s}/.claude-plugin/plugin.json`))
    } catch {
      // Marketplace illisible : tous les manifestes comptent.
    }
  }
  const files = changed.stdout.split('\n').filter(Boolean)
  const bumped: string[] = []
  for (const m of manifests) {
    if (!files.includes(m)) continue
    const diff = await runGit($, dir, ['diff', '-U0', `${base}...HEAD`, '--', m], 5000)
    if (/^\+\s*("version"\s*:|version\s*=)/m.test(diff.stdout)) bumped.push(m)
  }
  return versionSet(files, manifests, bumped)
}

/**
 * Le retard d'un dossier (racine de son worktree) sur le distant, d'après les références déjà
 * rapportées par le dernier fetch (communes à tous les worktrees du dépôt) : rien de lent ici, sinon
 * quelques `git diff` locaux pour les versions.
 */
const measureIn = async ($: any, dir: string, main: string): Promise<Pick<SyncState, 'behindMain' | 'behindUpstream' | 'aheadMain' | 'branch' | 'isOnMain' | 'remoteKey' | 'dir' | 'isVersionSet'>> => {
  const branch = (await runGit($, dir, ['rev-parse', '--abbrev-ref', 'HEAD'], 5000)).stdout || null
  const count = async (range: string): Promise<number | null> => {
    const res = await runGit($, dir, ['rev-list', '--count', range], 5000)
    const n = Number(res.stdout)
    return res.exitCode === 0 && res.stdout !== '' && Number.isFinite(n) ? n : null
  }
  const behindMain = main ? await count(`HEAD..origin/${main}`) : null
  const aheadMain = main ? await count(`origin/${main}..HEAD`) : null
  const upstream = await runGit($, dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 5000)
  const behindUpstream = upstream.exitCode === 0 && upstream.stdout ? await count('HEAD..@{u}') : null
  const mainSha = main ? (await runGit($, dir, ['rev-parse', `origin/${main}`], 5000)).stdout : ''
  const upSha = upstream.exitCode === 0 ? (await runGit($, dir, ['rev-parse', '@{u}'], 5000)).stdout : ''
  const base = upstream.exitCode === 0 && upstream.stdout ? '@{u}' : main ? `origin/${main}` : ''
  const isVersionSet = base ? await measureVersions($, dir, base) : null
  return {
    isVersionSet,
    behindMain,
    behindUpstream,
    aheadMain,
    branch,
    isOnMain: branch !== null && branch === main,
    remoteKey: mainSha || upSha ? `${mainSha}|${upSha}` : null,
    dir,
  }
}

/**
 * Mesure le retard sur le distant : `git fetch` d'abord (sans toucher aux fichiers ni aux branches
 * locales), puis les commits de origin/main et de la branche suivie absents du dossier où l'on code.
 * Ce dossier est le worktree de la session quand elle travaille dans un autre worktree du dépôt que
 * la racine du board (dossier principal resté sur main pour un service, code sur `dev` dans
 * `.claude/worktrees/dev`) ; sinon la racine du board.
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
    let cwd = ''
    await quietly(async () => {
      cwd = String((await $.session.cwd()) ?? '')
    })
    const here = cwd !== '' ? await toplevel($, cwd) : null
    const dir = here !== null && !samePath(here, root) ? here : normRoot(root)
    const measured = await measureIn($, dir, main)
    const now = await $.clock.now()
    await update($, syncAtom, s => ({
      ...s,
      ...measured,
      main: main || null,
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

/** Le conseil en une ligne, avec le dossier d'une commande git (« git pull --ff-only dans /x »). */
const adviceText = (advice: SyncAdvice, joiner: string, where: string): string =>
  advice.commands.map(c => ('shell' in c && c.dir ? `${commandText(c)} ${where} ${c.dir}` : commandText(c))).join(joiner)

/**
 * La raison du refus quand le distant a avancé et que la mise à jour n'a pas encore été demandée
 * pour ces commits-là, sinon null. Une fois par avancée du distant : si la personne s'en passe,
 * la même modification passe au second essai, et rien n'est redemandé avant la prochaine fusion.
 * Le retard est celui du worktree du fichier : la dernière vérification (minuterie) quand c'est le
 * dossier qu'elle a mesuré, sinon une mesure locale de ce worktree, sans fetch.
 */
const syncGate = async ($: any, path: string): Promise<string | null> => {
  const sync: SyncState = await read($, syncAtom)
  if (sync.checkedAt === null || sync.hasRemote !== true) return null
  const board = await read($, boardAtom)
  if (!board || !isCodeFile(path, board.root)) return null
  const tree = sync.dir ? await worktreeOfFile($, board.root, path) : null
  const state: SyncState = tree !== null && !samePath(tree, sync.dir ?? '') ? { ...sync, ...(await measureIn($, tree, sync.main ?? '')) } : sync
  const advice = syncAdvice(state)
  const key = state.remoteKey
  if (!advice || key === null || sync.askedFor === key) return null
  const now = await $.clock.now()
  const isSkill = advice.commands.every(c => !('shell' in c))
  const commands = adviceText(advice, ' puis ', 'dans')
  await update($, syncAtom, s => ({ ...s, askedFor: key }))
  await commit($, b => {
    if (!activeRun(b)) return null
    const next = JSON.parse(JSON.stringify(b)) as Board
    const live = activeRun(next)!
    live.log = [{ at: now, glyph: '⟳', text: `${commands} demandé : ${advice.reason}`, tone: 'warn' as const }, ...live.log].slice(0, 80)
    live.updatedAt = now
    return { board: next, fx: { toasts: [], openPane: false, note: 'none' as const } }
  })
  const ask = isSkill
    ? `demande à l'utilisateur de lancer ${commands} (commande réservée à l'utilisateur) et attends qu'il l'ait fait. `
    : `propose à l'utilisateur une mise à jour en avance rapide (la branche n'a aucun commit local en avance) : ${commands}, et attends son accord. `
  return `flow-board : le dépôt distant a avancé (${advice.reason}). Avant de modifier le code, ${ask}` + "S'il préfère s'en passer, refais simplement cette modification : elle passera."
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
    // Une session liée relit d'abord la référence de la discussion principale : elle change à son redémarrage.
    let moved: string | undefined
    await quietly(async () => {
      moved = await followMainRef($)
    })
    const board0: Board | null = await read($, boardAtom)
    const relayRun = board0?.delegate ? '' : typeof input.resume === 'string' && input.resume.trim() !== '' ? input.resume.trim() : (activeRun(board0)?.id ?? '')
    const relay = relayRun !== '' ? await readRelay($, relayRun) : undefined
    // À la reprise, les comptes rendus déposés se citent de nouveau en entier.
    if (relayRun !== '' && typeof input.resume === 'string' && input.resume.trim() !== '') for (const key of [...seenReports]) if (key.startsWith(`${relayRun}:`)) seenReports.delete(key)
    for (let attempt = 0; attempt < 5; attempt++) {
      const { value, version } = await $.state.get(BOARD_REF)
      if (!value) break
      const out = applyReport(value, input, now, { hasPullRequests: (await read($, syncAtom)).isGitHub !== false, isVersionSet: (await read($, syncAtom)).isVersionSet, delegateTitle, relay, seenReports })
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
    const resumed = typeof input.resume === 'string' ? input.resume.trim() : ''
    // Seulement une reprise faite, ici : un id mal recopié ou ignoré (avec "open") n'écrit rien.
    const after: Board | null = await read($, boardAtom)
    if (resumed !== '' && typeof input.main === 'string' && input.main.trim() !== '' && !after?.delegate && activeRun(after)?.id === resumed) {
      const ref = parseMainRef({ run: resumed, main: input.main, at: now }, resumed)
      if (ref) await quietly(() => writeMainRef($, ref))
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
        const withdrawn = reportedWithdrawals(input)
        if (withdrawn.length > 0) await relaySignal($, { kind: 'withdrawn', items: withdrawn })
        const counts = reportedCounts(input)
        if (counts.review || counts.security) await relaySignal($, counts)
        const report = reportedReport(input)
        if (report !== '') {
          const runId = (await read($, boardAtom))?.delegate?.run ?? ''
          // Le fichier garde le texte tel qu'envoyé, sauts de ligne compris (le relais le met sur une ligne).
          const isWhole = runId !== '' && (await writeReportFile($, runId, await sessionId($), String(input.report).trim()))
          await relaySignal($, { kind: 'report', text: report, ...(isWhole ? { isWhole } : {}) })
        }
        if (typeof input.note === 'string' && input.note.trim() !== '') await relaySignal($, { kind: 'note', text: input.note.trim() })
      }
    }
    if (moved !== undefined) text = `${moved} ${text}`
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
    // La rétro relit le transcript de la discussion si elle a été compactée, avec ou sans parcours.
    const tail = id === 'retro' && isMain ? await retroTail($) : ''
    // Une session liée lance elle-même les revues de son groupe : le tableau de bord d'ici l'apprend par le relais.
    if ((await read($, boardAtom))?.delegate) {
      if (id === 'final-review') await relaySignal($, { kind: 'review' })
      if (id === 'security-review') await relaySignal($, { kind: 'security' })
      return withTail(result, tail)
    }
    const fx = await commit($, board => applySkill(board, e.skill, { now, isMain, args }))
    // Les revues du groupe et de sécurité ne changent pas de phase, mais leurs consignes comptent.
    if (!fx || (fx.note === 'none' && id !== 'final-review' && id !== 'security-review')) return withTail(result, tail)
    const run = activeRun(await read($, boardAtom))
    // Une phase qui touche au code commence : on regarde tout de suite si le distant a avancé.
    if (run && CODE_SKILLS.has(currentPhase(run).skill)) scheduleCheck($, true)
    // `/code-review` qui vient d'ouvrir (ou de relancer) une relecture de branche en reçoit la consigne.
    const noteId = id === 'final-review' && run && currentPhase(run).skill === 'branch-review' ? 'branch-review' : id
    // Les sous-agents de ce parcours en échec, d'après les registres (S1 : plus dans le parcours) :
    // celui de cette discussion et ceux de ses sessions liées (Q-c), pour le seul compte rendu.
    const failedAgents = run && noteId === 'compte-rendu' ? await failedOfRun($, run) : 0
    noteReferences($)
    return run ? { text: `${result.text}${coachingNote(noteId, run, await read($, syncAtom), await measureRepo($), (await read($, boardAtom))?.session, await writeDecidedFile($, await read($, boardAtom)), failedAgents, REVIEW_NOTES.has(noteId) ? await standardsPath($) : null)}${tail}` } : withTail(result, tail)
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
          if (/\bgit\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?(?:fetch|pull|rebase|merge)\b/.test(command)) scheduleCheck($, false)
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
  // ouvre son segment (essai de la frise en direct : moins d'une milliseconde par réponse).
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
      // Les appels à l'advisor ne se voient qu'ici, dans le résultat de l'étape (`serverToolUses`) :
      // posés après coup, avec leurs vraies heures.
      const served = (result?.serverToolUses ?? []) as readonly ServerToolUse[]
      await quietly(() =>
        commitRegistry($, reg => {
          const closed = closeSegment(reg, lane, isModelSegment, endedAt) ?? reg
          const used = addUsage(closed, lane, (result?.usage ?? null) as StepUsage | null, effort, endedAt) ?? closed
          const advised = addAdvisorCalls(used, lane, served, endedAt) ?? used
          return advised === reg ? null : advised
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

  // La compaction se voit en direct (essai, point 9) : un repère sur l'orchestrateur, pour une
  // compaction de la discussion elle-même ; un calcul à l'avance n'installe rien, et celle d'un
  // sous-agent n'est pas la sienne.
  // Les consignes de compaction (selon le rôle de la discussion) suivent le texte reçu, pour toute
  // compaction de la discussion, calcul à l'avance compris : la compaction suivante le réutilise.
  // Le repère suit le résultat : une compaction refusée (`skip`) ou ratée n'en pose pas.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // Chaque lecture à part : un registre illisible ne retire que le chemin du transcript.
    let board: Board | null = null
    let reg: SessionRegistry | null = null
    await quietly(async () => {
      board = await read($, boardAtom)
    })
    await quietly(async () => {
      reg = await read($, registryAtom)
    })
    const role: CompactionRole | null = compactionRoleOf(board, reg)
    const result = await next(role ? { ...e, instructions: withCompactionInstructions(e.instructions, compactionInstructions(role)) } : e)
    if (e.trigger !== 'precompute' && result.messages !== undefined) await markLane($, MAIN, { k: 'compact', at: await $.clock.now() })
    return result
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteTranscript($, e)
    return withDiscussionTitle($, e, await next(e))
  })
  on('classic.SessionStart', async ($, e, next) => {
    await noteTranscript($, e)
    return withDiscussionTitle($, e, await next(e))
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
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.props.bodyColumns, capsOf(e.surface))
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
    const kit = kitOf($.ui.resolve(e) as unknown as Record<string, unknown>, e.props.bodyColumns, capsOf(e.surface))
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
