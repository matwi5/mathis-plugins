// flow-board : le tableau de bord du workflow mattpocock-skills.
//
// - Suit les skills du plugin dès qu'ils se chargent (commande slash, outil Skill) : le
//   skill de départ fixe la forme de la mission, les suivants le font avancer, les autres
//   s'y greffent en détours.
// - Claude complète par l'outil `flow` (étapes, éléments, tickets) : une courte note
//   ajoutée au texte de chaque skill lui donne les ids d'étapes à signaler.
// - Le reste est relevé seul : spécialistes, tests, commits, issues et PR, fichiers du
//   workflow (glossaire, ADR, specs, tickets locaux…), tâches Asana, questions du grilling.
// - Les missions sont gardées par projet dans un fichier commun, `~/.claude/flow-board/parcours/`
//   (`$.store` en secours) : un workflow mattpocock s'étale sur plusieurs sessions (`/clear` entre
//   deux tickets), et le desktop comme le CLI doivent voir les mêmes.
// - Le registre des agents (`registry-file.ts`), son rattrapage par les transcripts
//   (`catch-up.ts`) et l'effacement (`erase-run.ts`) vivent à part : ce fichier n'en garde que
//   les hooks qui les appellent.

import { atom, read, update } from 'claude-code'
import type { Register, ToolCallInput } from 'claude-code'

import type { WaitsUser } from '../types'
import type { AgentLane, AgentMark, AgentsWindow, AgentSegment, AgentType, Board, FlowItem, FlowPhase, Relay, RelayEntry, RelayEntryFile, Run, SentRequest, SessionRegistry, SyncState, Tab, VersionUnit } from '../types'
import {
  CODE_SKILLS,
  PLUGIN,
  SECURITY_AREAS,
  SECURITY_OFF_REPLY,
  TRUST_COMMAND,
  SKILLS,
  skillIdOf,
  slashOf,
} from './catalog.ts'
import {
  activeDetour,
  applyAgentStart,
  applyAnswer,
  applyAsana,
  askCloseLinkedGroup,
  groupReportOf,
  reloadText,
  restoreDelegate,
  applyCommand,
  applyCreatedTasks,
  markDecisionsSeen,
  validateReport,
  applyFileChange,
  applyReport,
  applySkill,
  stripRunAgents,
  applyAgentActivity,
  applyUserAnswer,
  backgroundLaunches,
  backgroundLaunchCount,
  isBackgroundLaunch,
  commandSignals,
  archiveAwaiting,
  archiveRetroEnd,
  retroEndOf,
  type RetroBoxes,
  archiveRun,
  paneArchiveMark,
  closeDelivered,
  closeIdleRun,
  isDeliveryOver,
  isReportShipped,
  poseContradiction,
  withdrawOpposition,
  OPPOSITION_PREFIX,
  setAsidePistes,
  isWaitlistRetro,
  DELIVERY,
  deliveredText,
  type DeliveredResult,
  clearWaitsUser,
  nextLaunchFor,
  setWaitsUser,
  soundWaitsUser,
  forceHold,
  isLotUnderway,
  unitsOfTickets,
  holdMapOf,
  LOT_KEY,
  outsideHolds,
  inFlightElsewhere,
  type ForcedPair,
  type OutsideHold,
  dropRun,
  startLinkedGroups,
  type GroupView,
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
  keepNameText,
  groupTicketsOf,
  groupReviewArgs,
  noActiveFrench,
  withoutPullRequest,
  isBoard,
  detachOnLoad,
  isCooDiscussion,
  COO_NO_MISSION,
  mergeBoards,
  openHandoff,
  isOtherDiscussions,
  nextCommandSkill,
  VERSION_MANIFESTS,
  touchedManifests,
  versionSet,
  parkActive,
  resumeRun,
  setAsideActive,
  stopAutoUnread,
  AUTO_STOPS,
  autoDecision,
  awaitedExternals,
  externalOf,
  markAutoSent,
  markAutoStarted,
  nextAutoOnAt,
  pendingAutoMarks,
  raiseStaleAutoSends,
  resendAutoMark,
  raiseRelaunchQuestions,
  STALE_PREFIX,
  RELAUNCH_PREFIX,
  stopActiveAuto,
  unmarkAutoSent,
  isAutoMission,
  isAutoOn,
  autoResumedAt,
  autoResumedLabel,
  AUTO_RESUMED_RELAUNCH,
  isAutoLitBy,
  addOwnTraces,
  writtenTraces,
  hasUnsoundTombstones,
  isGroupLotStuck,
  markAutoLaunched,
  linkedReviewMark,
  securityReviewMark,
  hereReviewMark,
  type OwnTraces,
  type AutoAction,
  autoNotices,
  autoStateOf,
  switchOffAuto,
  cutAutoOf,
  autoOnAtOf,
  autoDatesOf,
  autoPauseWhy,
  canResumeStuck,
  relaunchStillDue,
  relaunchVerdict,
  autoOnByOf,
  retakenPaused,
  autoTurnedOffOnLoad,
  relaunchPauseNotice,
  type RelaunchVerdict,
  isAutoResumed,
  isStuckResumable,
  resumableQuestions,
  soundStuckResume,
  type StuckResume,
  isAutoPauseStored,
  isRelaunchPause,
  blockingQuestions,
  isCutDue,
  switchOnAuto,
  setQueue,
  togglePick,
  summaryOf,
  syncAdvice,
  commandArgsOf,
  isNoLogicGroup,
  archiveMarkOf,
} from './model.ts'
import {
  askCloseLinkedItems,
  groupSendSeq,
  markCleanupSent,
  cancelLinked,
  cancelLinkedGroup,
  earlierOf,
  linkGroupSession,
  linkRelaySessions,
  unnotedLaunchNotice,
  linkSession,
  linkedSessionsOf,
  noteUnlaunched,
  offRequestLaunches,
  retryLinked,
  linkedInFlight,
  pickableItems,
} from './link.ts'
import {
  applyRelayEntry,
  asanaChanges,
  localTicketChange,
  ticketFilesIn,
  reportedReport,
  decidedFileText,
  relayedReportKeys,
  relayedPartsOf,
  relayedSentence,
  reportedChanges,
  reportedCounts,
  reportedWithdrawals,
  latestRelayEntry,
  mergeRelay,
  nextRelayTime,
  parseRelayEntryFile,
  relayEntryFileName,
  relayRefusal,
  relayedReports,
  isRepeatedReview,
  isRelay,
  relayForGroup,
  workerStopOf,
  workerStopText,
  reportFileName,
  mainRefFileName,
  parseMainRef,
  updateDelegateMain,
  isMainRefNewer,
  mainRefAsk,
  mainRefAskText,
  newestMainRef,
  type MainRef,
  experienceChoiceNotice,
  reportedDecisions,
  type RelayEvent,
  type RelayLoss,
  type RelayPart,
} from './relay.ts'
import {
  activeRun,
  countTickets,
  currentPhase,
  clip,
  isJudgmentTicket,
  isReportValidated,
  shownGroupId,
  noFx,
  isTime,
  sameTicket,
  str,
  type Effects,
  type Outcome,
  normRoot,
} from './basics.ts'
import type { FableFirst, LiveAgent } from './model.ts'
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
  noteSent,
  addAdvisorCalls,
  linesOf,
  type ServerToolUse,
  type StepUsage,
} from './registry.ts'
import type { LinkedLaunch } from '../types'
import { isSameProject, linkedSessions, type JobInfo, type LinkedSession } from './linked.ts'
import { laneFromTranscript } from './transcript.ts'
import { GROUP_ID_FORM_FR, OLD_SEPARATORS, archiveConsent, asciiJson, closingRepo, closingScript, isSessionId, consentAt, consentDay, plainArgs, branchCleanup, closedHint, closingProcedure, groupTitle, groupWorktree, groupWorktreeTemplate, hasSendName, isNotedWorktree, sendRefusalFr, isGroupId, isSafeBranch, isSafeId, isVersionForm, itemsWorktree, missionSessionsArchiveText, unmarkedAskText, tempDirForm, briefFileName, neutralInPrompt, neutralLine, neutralRelayed, linkedPrefix, linkedTitles, shellQuote, type ReopenText, relayFileSlug } from './closing.ts'
import {
  COMPACT_FIRST_TOAST,
  COO_COMPACT_TOKENS,
  ORIGIN_FILE_RULE,
  WORKER_COMPACT_TOKENS,
  answerAwaitsPerson,
  breaksLine,
  compactionInstructions,
  compactionMoment,
  compactionRoleOf,
  retroTranscriptNote,
  suggestsCompaction,
  withCompactionInstructions,
  workerCompactNotice,
  workerCompactStep,
  workerResumeText,
  type CompactionRole,
} from './compaction.ts'
import { applyTraces } from './erase.ts'
import { applyOrphanCards, applyPistesFinish, backCardTaken, finishedLinesOf, isCardInLaunch, orphanCardHolds, orphanCardPlans, orphanLinesOf, pistesFinishCandidates, pistesMissionEnd, finishPlanHolds, planPistesFinish, type PistesFinishResult } from './pistes-fin.ts'
import { holdsPick, pickedOf, picksPrint, retroCommandArgs, retroRequestRefusal, retroTarget, retroTranscripts, isRetroRequestStale, isRetroResumeUseful, retroResumeUntil, type RetroRequestRefusal } from './retro-coo.ts'
import { NEW_MAX, contradictionQuestion, contradictionQuestionId, markSeen, newDecisionsOf, parseSeen, seriesOf, type DecisionsSeen, type NewDecision, relayMessage } from './oppositions.ts'
import { DELIVERY_COMMAND, DELIVERY_FR, DELIVERY_KEYS, abandonDelivery, deliveryWaits, failedStep, isDelivered, isDeliveryOpen, newDelivery, nextStep, parseDelivery, reportStep, retryStep, runningStep, startStep, type Delivery, type DeliveryKey } from './delivery.ts'
import { REPORT_CHANGED, REPORT_PAUSED, cooStatement, sameRoadmapTitle, cutStateWhere, failedPlaceWrite, wherePlaceRefusal, isModQuestion, nightViewsOf, isRetroCardRemovable, readyRetroOf, isOpenMission, isSha, retroWaitlistText, pistesWaitingOf, outsideCommitCounts, parseLoggedCommits, statementText, watchedGroups, watchedKey, type LoggedCommit, type OutsideCommits, type CooGlean, type CooDecisions, type CooRetroPicks, type CooDelivery, type CooReport, type CooRoadmap, type CooSetAside, type CooStatement, type CooWaitlist } from './coo.ts'
import type { CooDo, CooShow } from './coo-view.tsx'
import { RETRO_START, cardRoadmapIds, hasIntentTurn, launchFirstLine, LAUNCH_GRACE_MS, LAUNCH_TTL_MS, CLOCK_SKEW_MS, isOrdinaryCard, isPistesCard, pistesCard, soundRunLaunch, askMattCandidates, LAUNCH_CLAIM_SETTLE_MS, LAUNCH_KEY_PREFIX, LAUNCH_STALE, LAUNCH_STARTS, cardStateOf, consumeRefusal, liveLaunchOf, otherCarrierOf, runOfCard, sameFolder, isLaunchId, isRecordStale, launchKey, newLaunchId, AUTO_ON_KEY_PREFIX, autoOnKey, autoOnRefusal, soundAutoOnRecord, type AutoOnRecord, parseCard, runOfLaunch, soundRecord, type LaunchCard, type LaunchMode, type LaunchRecord, type LaunchStart, hasRetro, retroOf } from './launch.ts'
import { claimName, isCardTitle, isUnnamed, markNamed, markState, shellSafeTitle } from './named-mark.ts'
import { cardWriteWhy, cardWriteWhyEn } from './cards-list.ts'
import { cardsCtx, cardsHere, cardsOrNull, isOldCopied, offerDueRetros, surveyCards, offerRetros, orphanCardsOf, readCards, readCardsAt, writeCards } from './cards-store.ts'
import { assignNumbers, emptyNumberTable, freshNumberTable, keepsNumbers, numbersView, parseNumberTable, type CooNumbers, type NumberRead, type NumberTable } from './numbers.ts'
import { COO_AUTHOR, PISTE_BOX_MAX, applyBoxedOps, releaseCardPistes, validatePistes, type Piste, type PisteMoveState, type PistePick, emptyWaitlist, keepsOps, keepsPistes, viaTicketOf, chainsOf, missingSeen, newPisteOpId, opMark, parsePisteBox, parsePisteChange, parseWaitlist, isPisteId, pisteMoves, parsePistesLine, pistesOf, type TicketLink, releasableMarks, seenAfter, soundPisteOp, withoutApplied, missionChangeRefusal, missionDropsSaid, type BoxedOp, type PisteAuthor, type PisteBoxRead, type PisteMove, type PisteOp, type PisteOutcome, type Waitlist, type WaitlistRead, WAITLIST_REPO_FILE, WAITLIST_REPO_ROOT, holdsWaitlist, type WaitlistWhere } from './pistes.ts'
import { pistesBriefText } from './pistes-brief.ts'
import { attachLaunch, factsRelayOf, isWakeable, managerReachOf, reopenNotice, wakeTargets, isEndedPause, type ManagerReach, RETRO_REFUSED_TEXT, noteRetroRefused, noteAutoHold, untitledStepRefusal, FABLE_WORKER_TEXT, isFableMark, isRetroRun, autoMarksOf, isDelegable, liveWaits, loseLaunch, openQuestions, planHolds, PLAN_UNREAD_TEXT, projectUnits, questionPrint, unitsNamedInArgs, unitsOverlap, type ProjectUnit } from './model.ts'
import { hasWaitCycle, projectPlan, waitsKey, type PlanWait, type ProjectPlan } from './plan-projet.ts'
import { RELAY_PENDING_MS, ROUND_FORM, WAVE_TTL_MS, isOneLine, isRound, PICK_MAX, type CoordCompatible, type CoordContradiction, entryRun, isDecisionsPath, isPlanEntry, isPlanUnreadFor, isPrint, isQuestionRef, isReportPrint, isSeries, isCutDated, pendingCutsFor, pendingRelaysFor, pendingWavesFor, pendingInstructsFor, isInstructReceived, isInstructSent, instructOpenSince, instructOriginClash, soundInstructed, planWaitsOf, reportPrint, type CoordInstruct, type CoordAnswer, type CoordGesture, type CoordRelay, type CoordValidate } from './coordination.ts'
import type { CooPlan, CooWave } from './coo.ts'
import { clearLiveness, isAutoReopenProposed, livenessNowOf, livenessOf, noteAutoReopens, refreshLiveness } from './coo-liveness.ts'
import { ownerVerdictOf } from './liveness.ts'
import type { RunLaunch } from '../types'
import { isRoadmapId, parseRoadmap, partialSeen, roadmapTextPrint, unionSeen, watchRoadmap, type Roadmap, type RoadmapSeen } from './roadmap.ts'
import { parseSecuritySetting, securitySettingRecord, type SecurityReview, type SecuritySettingRead, type SecurityStored } from './security-setting.ts'
import { AUTO_GROUP_EFFORT, COO_EFFORT, FABLE_MODEL, FABLE_OFF_WORKER_EFFORT, FABLE_WORKER_EFFORT, EFFORT_LEVELS, GROUP_EFFORT, OPUS_CLI_ALIAS, OPUS_LAUNCH_FR, SONNET_LAUNCH_FR, effortSent, groupLaunchNote, isFableModelId, isFableStuck, leadEffort, modelName, quotaText, sentNote, withOpusBack, workerTicketEffort, type ImposedEffort, type LeadEffort, type QuotaWindow } from './effort.ts'
import { DISCUSSION_STATES, sameLabel, soundEntry, takenFor, takenLabels, unreadTakenFor, type CoordTaken, type DiscussionState } from './coordination.ts'
import { UNMARKED_ANSWERS, UNMARKED_MAX, discussionsToClose, discussionsToCloseBoth, mergeToClose, type ToClose, type UnmarkedAnswer } from './discussions.ts'
import { TOOL_DESCRIPTION, TOOL_SCHEMA } from './tool-schema.ts'
import { partialTitles, planTitles, TITLES_MAX, untitledIds, type RoadmapTitles } from './titles.ts'
import { BOX_MAX, SET_ASIDE_SOURCE_MAX, SET_ASIDE_TEXT_MAX, SET_ASIDE_UNWRITTEN, copiedIn, copiesOf, keepsItems, roadmapText, newSetAsideId, parseBox, soundSetAside, withoutCopied, type BoxRead, type SetAside } from './a-reprendre.ts'
import { CLOSE_KIND, COORD_MAX, COORD_UNREAD, DAY_WAKE_TEXT, NIGHT_ENTRY_ACTS, WAKE_TEXT, copiedDecls, gleanedRuns, isReleasedMark, isEntryGone, keepsEntries, liveEntries, forcesFor, markClosesDone, newEntryId, parseCoordination, pendingFor, pendingNightFor, refOf, soundApplied, withoutGone, type CoordClose, type CoordEntry, type CoordNight, type CoordRead, type CoordRetro } from './coordination.ts'
import { NIGHT_DEAD_MS, NIGHT_MS, NIGHT_WAKE_TEXT, nightCutsWritten, nightLogOf, reopenCommand, retroResumeCommand, type NightMorning, type NightReopen, nightLogEntries, nightResultsText, parseNightResults, type NightRefusal, appendNightLog, isNightWakeDue, withNightWake, type NightWakes, isSeatGap, isPersonOrigin, isTypedOrigin, newNightId, newNightWatch, nightBlocks, nightBlocksPrint, nightOff, nightValidity, parseNight, parseNightLog, type NightBlock, type NightMissionView, type NightLogLine, type NightRead, type NightStop, type NightWatch } from './night.ts'
import { SEAT_REFRESH_MS, SEAT_UNREAD, isSeatBehind, mergeSeat, refreshSeat, releaseSeat, seatState, soundSeat, takeSeat } from './seat.ts'
import { agentsOfRun, applyRebuilt, carriedRunAt, clipLane, historyEntries, runFileId, runRegistry, runWindow, unionRebuilt, withRun, type HistoryEntry } from './history.ts'
import { minOf, shortArg, toolFamily } from './timeline.ts'
import { pricesFromCcusage, type UnitPrices } from './cost.ts'
import { drawBand, drawPane, drawWelcomeBand, kitOf, type Actions, type Caps, type View } from './view.tsx'
import { commitRegistry, ensureRegistry, ownAgent, readPiece, readRegistry, registryDir, registryKey, registryQueue, registrySaveTimer, saveRegistryNow } from './registry-file.ts'
import { catchUpAgent, catchUpOwn, catchUpShown, claudeDir, needsRebuild, readRebuilt, readTranscript, transcriptAgents, updateRebuilt } from './catch-up.ts'
import { eraseFile, eraseRun, erasedRuns, erasingNow, forgetSession, readTraces, reconcileErased, reportFilesOf } from './erase-run.ts'
import { type Deposit, depositTarget, managerReportSession, withDeposit } from './depot-manager.ts'
import { silenceNote, silentWorkers } from './silence.ts'
import { AUTO_BRIEF_IN_TURN, autoOnNotice, AUTO_BRIEF_HEAD, autoBriefText } from './auto-consignes.ts'
import { TOOL, projectName, SECURITY_METHOD_FILE, READING_METHOD_FILE, securityMethod, readingMethod, setMethodPaths, SENSITIVE_AREAS_FR, INSTRUCTIONS_IN_PROMPT_FR, linkedSecurityReview, securityMethodFr, decidedList, LINKED_GROUP_REVIEW, isFramingSubSkill, framingSubSkillNote, REVIEW_NOTES, coachingNote, ticketList, launchHow, BACKGROUND, briefText, itemList, splitRequest, adviceText, type LaunchParts, isLaunchReceived, isShortLaunch, shortLaunchHow, SHORT_LAUNCH_FOLLOW, lotAdviceText } from './decoupage.ts'
import type { InFlightNote, LotProcedure, BriefParts } from './decoupage.ts'

const PANE = 'flow-board'
/** Le nom de ce mod, tel que le moteur le met dans l'origine de ses envois (`origin.name`) ; pas `PLUGIN`, celui des skills. */
const SELF = 'flow-board'
/** Le terminal seul ne dessine pas les SVG (sa table porte quand même un `Svg`, qui rend une boîte vide). */
const capsOf = (surface: string): Caps => ({ hasSvg: surface !== 'terminal' })
const PANE_TITLE = 'Mission'
/** Le plugin dont la suggestion `/project:push` s'écarte pendant une mission (pas de push en cours de route). */
const GIT_BOARD = 'git-board'
/** Le second essai de la suggestion de fin de tour, si le premier tombe encore dans le tour. */
const SUGGEST_RETRY_MS = 300
/**
 * L'outil de l'app Desktop qui lance un worker ; sa réponse donne l'id `local_…` de la
 * session. Le CLI ne l'a pas : il lance la session par `claude --bg` (voir `backgroundLaunches`).
 */
const START_SESSION = 'mcp__ccd_session__start_session'
/** La commande déclarée par `commands/flow.md`, préfixée du nom du plugin. */
const STATIC_FLOW = 'flow-board:flow'

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

// État du module, perdu au rechargement : de simples corrélations et minuteries.
/** Appels de l'outil Skill en cours : `skill.prompt` ne dit pas quel agent charge le skill. */
let pendingSkills: { skill: string; agentId?: string; args?: string }[] = []
/** Dernière commande slash d'un skill : `command.run` précède `skill.prompt` et porte les arguments. */
let lastCommand: { id: string; args: string; at: number } | null = null
/** La même commande, pour l'auto : elle n'explique que le premier chargement de son skill (Claude prévenu de l'allumage). */
let typedCommand: { id: string; at: number } | null = null
let saveTimer: { cancel: () => void } | null = null
let ticks = 0
/** Le mod vient d'être rechargé (le board était déjà là au démarrage) : la réponse suivante de l'outil le dit. */
let isReloadToAnnounce = false
/** La session précédente a fini par un /clear : le board reste en mémoire sans que le mod ait été rechargé. */
let isAfterClear = false
/** La délégation écrite pour cette session (JSON), pour ne pas réécrire `$.store` à chaque appel ; aucune au départ. */
let keptDelegate = 'null'
/**
 * Le verrou du premier appel `delegate`, pour la marque « worker Fable » (`FableFirst`) : `open` seulement quand le
 * premier chargement du board de ce processus a lu la clé `delegate:<session>` vide (sans erreur, sans valeur) et
 * que rien ne l'a fermé depuis. Un appel `delegate` du fil principal le prend (`pending`) à son entrée, ou juste
 * après le chargement qu'il fait, sans attente entre le test et la prise : un appel parallèle le trouve pris, donc
 * sans marque. Il se ferme, sans jamais se rouvrir, à l'instant où un appel `delegate` (du fil principal ou d'un
 * spécialiste) écrit sa délégation dans l'état, à un chargement qui lit la clé non vide ou illisible, quand le
 * board quitte une délégation en mémoire pour une autre racine, et au rechargement du mod (`session.start` avec un
 * board déjà en mémoire). Un appel qui l'a pris sans rien écrire (tableau de bord indisponible, état qui bouge
 * encore, appel refusé ou sans changement) le rend ouvert, s'il est encore `pending` : rien n'étant enregistré,
 * l'appel suivant est encore le premier. `unset` : aucun chargement n'a encore lu la clé ; dans le doute, pas de
 * marque.
 */
let fableFirstLatch: 'unset' | 'open' | 'pending' | 'closed' = 'unset'

/** Prend le verrou du premier appel quand il est ouvert : vrai si cet appel le tient. Sans attente. */
const claimFableFirst = (isDelegateCall: boolean, isMainLoop: boolean): boolean => {
  if (!isDelegateCall || !isMainLoop || fableFirstLatch !== 'open') return false
  fableFirstLatch = 'pending'
  return true
}

/** Ferme le verrou du premier appel, à l'instant où une délégation s'écrit dans l'état (ou dans le doute). */
const closeFableFirst = (): void => {
  fableFirstLatch = 'closed'
}

/**
 * Rend le verrou à la fin d'un appel qui le tenait sans rien écrire, s'il est encore à lui (une écriture ou un
 * chargement a pu le fermer entre-temps) : l'appel suivant est encore le premier.
 */
const releaseFableFirst = (isClaimed: boolean, isWritten: boolean): void => {
  if (isClaimed && !isWritten && fableFirstLatch === 'pending') fableFirstLatch = 'open'
}

/** La délégation en mémoire porte la marque « worker Fable » pour cette mission. */
const isMarkedFor = (board: Board | null, runId: string): boolean => board?.delegate?.run === runId && isFableMark(board.delegate.model)

/**
 * La réponse à un appel `delegate` qui portait `"model"` sans que rien ne s'écrive : la marque n'est pas posée, la
 * session tourne sur le modèle de la session (Opus) ; l'appel se renvoie, et le compte rendu le dit s'il échoue encore.
 */
export const FABLE_MARK_NOT_SET =
  ' The Fable worker mark was NOT set: this session runs on the session\'s model (Opus), not on Fable. Send the same delegate call once more; if the mark is still not set, say so in your final report.'

const storeKey = (root: string): string => `board:${normRoot(root).toLowerCase()}`

// ─── Board : chargement, écriture, persistance ────────────────────────────

/** Racine lue il y a peu : chaque appel d'outil d'une mission en a besoin, `/cd` la change rarement. */
let rootCache: { value: string; at: number } | null = null

/** La racine du projet de la session ; vide là où la session n'en dit rien (tests). */
export async function sessionRoot($: any): Promise<string> {
  // L'horloge du moteur : un test qui entre dans un worktree voit sa nouvelle racine en avançant l'horloge.
  let now = Date.now()
  await quietly(async () => {
    const at = await $.clock.now()
    if (typeof at === 'number' && Number.isFinite(at)) now = at
  })
  if (rootCache !== null && now >= rootCache.at && now - rootCache.at < 5000) return rootCache.value
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
 * Dernier message de la personne (ms) : le tour qui le traite peut lancer un worker demandé
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

/**
 * L'id de la discussion du moment, pour le mode auto (« allumé par ») : un `/clear` en donne un nouveau
 * sans recharger le mod (docs/evenements-moteur.md), que `sessionId` ne relit pas. Relu après chaque
 * `session.start`, `session.end` et `classic.SessionStart` ; sans id du moteur, celui de `sessionId`.
 */
let hereCache: string | null = null
export async function hereId($: any): Promise<string> {
  if (hereCache !== null) return hereCache
  hereCache = await freshHereId($)
  return hereCache
}

/** L'id de la discussion du moment, relu sans le garder : pour un geste qui ne doit pas remplir le cache (une fin de discussion). */
const freshHereId = async ($: any): Promise<string> => {
  let id: unknown
  await quietly(async () => {
    id = await $.session.id()
  })
  return typeof id === 'string' && id !== '' ? id : await sessionId($)
}

// ─── Fichier commun des missions ──────────────────────────────────────────
//
// `$.store` range ses données selon la façon dont le mod est chargé : `inline` dans le desktop
// (plugins passés par l'application), `mods-locaux` dans le CLI (plugin installé). Les deux ne se
// voyaient pas. Les missions vivent donc dans un fichier à nous, au même endroit pour tous.

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

/**
 * Le noyau de la procédure d'un worker de groupe (tickets, revues, règles ; la fin du groupe, le cas sans git,
 * le worker autonome et l'effort des workers dans ses annexes, à côté) : le texte de délégation le cite par son chemin au lieu de la recopier (15 000 signes par lancement, que le
 * manager recopiait à son tour dans le prompt de la session).
 */
const PROCEDURE_FILE = 'reference/procedure-groupe.md'
/** L'annexe de la procédure pour le manager (section 11) : l'effort d'un worker qu'il lance, et la suite de son compte rendu. */
const EFFORT_FILE = 'reference/effort-workers.md'
/** Le script qui imprime les rapports des spécialistes d'une session, nommé par la consigne de `/retro`. */
const REPORTS_SCRIPT_FILE = 'scripts/rapports-specialistes.mjs'
/** Le script des vérifications d'une fermeture, que cite la procédure de fermeture (`closingScript`). */
const CLOSING_SCRIPT_FILE = 'scripts/fermeture.mjs'
/**
 * Leurs chemins, tirés de `$.plugin.root` au premier hook qui construit une consigne qui les cite ; ceux des
 * deux fichiers de méthode des relectures vivent dans `decoupage.ts` (`setMethodPaths`).
 */
let procedurePath = PROCEDURE_FILE
let effortPath = EFFORT_FILE
let reportsScript = REPORTS_SCRIPT_FILE
const noteReferences = ($: any) => {
  try {
    const root = String($.plugin.root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
    if (root === '') return
    setMethodPaths(root)
    procedurePath = `${root}/${PROCEDURE_FILE}`
    effortPath = `${root}/${EFFORT_FILE}`
    reportsScript = `${root}/${REPORTS_SCRIPT_FILE}`
    // Un chemin hors forme (apostrophe, relatif…) est ignoré par la procédure, qui se recopie alors en entier.
    closingScript.path = `${root}/${CLOSING_SCRIPT_FILE}`
  } catch {
    // Racine inconnue : les chemins relatifs au mod.
  }
}

/** La version d'un `plugin.json` à ce chemin, en forme x.y.z (suffixe de préversion admis) ; null si elle ne se lit pas. */
const manifestVersion = async ($: any, path: string): Promise<string | null> => {
  try {
    const version: unknown = JSON.parse(String(await $.fs.read(path)))?.version
    return isVersionForm(version) ? version : null
  } catch {
    return null
  }
}

/** La version du mod qui tourne, lue dans son `plugin.json` sous `$.plugin.root` ; null si elle ne se lit pas. */
const installedVersion = async ($: any): Promise<string | null> => {
  let root = ''
  try {
    root = String($.plugin.root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  } catch {
    return null
  }
  return root === '' ? null : manifestVersion($, `${root}/.claude-plugin/plugin.json`)
}

/** Les clés que le moteur met dans l'appel d'un outil, à côté de ses arguments : jamais « inconnues ». */
const ENGINE_CALL_KEYS = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta'])

/**
 * La fin de la réponse de l'outil quand l'appel porte des clés absentes de son schéma : le mod les ignore,
 * et un worker qui suivait une procédure plus récente que le mod installé (`reportPath`, inconnu de la
 * 0.79.0) avait annoncé « déposé au relais » sans que rien y soit. Vide sans clé inconnue.
 */
const unknownFieldsText = async ($: any, call: Readonly<Record<string, unknown>>): Promise<string> => {
  const known = TOOL_SCHEMA.properties as Record<string, unknown>
  const unknown = Object.keys(call).filter(k => !ENGINE_CALL_KEYS.has(k) && !Object.hasOwn(known, k) && call[k] !== undefined)
  if (unknown.length === 0) return ''
  const version = await installedVersion($)
  const shown = unknown.slice(0, 8).map(k => neutralInPrompt(clip(k, 30))).join(', ')
  const more = unknown.length > 8 ? ` and ${unknown.length - 8} more` : ''
  return ` · Not read: ${shown}${more} (unknown to ${version ? `flow-board ${version}` : 'this flow-board'})`
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

/**
 * La copie du board pour le stockage partagé, sans `delegate` ni `cooHere` : la délégation est propre
 * au worker qui l'a déclarée (gardée à part, par `keepDelegate`), et la demande du siège du COO à la
 * discussion qui l'a faite, pas au fichier commun.
 */
const sharedCopy = (board: Board): Board => {
  const { delegate: _delegate, cooHere: _cooHere, ...shared } = board
  return shared
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

/** `$.store` lu, `ok` faux quand la lecture échoue (une valeur absente se lit bien). */
const legacyRead = async ($: any, root: string): Promise<{ ok: boolean; value: unknown }> => {
  try {
    return { ok: true, value: await $.store.get(storeKey(root)) }
  } catch {
    return { ok: false, value: undefined }
  }
}

const legacyGet = async ($: any, root: string): Promise<unknown> => (await legacyRead($, root)).value

/** Une valeur relue est le board de ce projet. */
const isOwnBoard = (value: unknown, root: string): value is Board => isBoard(value) && normRoot(value.root) === normRoot(root)

/** Projets dont l'ancien stockage de ce mode de chargement est déjà versé dans le fichier commun. */
const migrated = new Set<string>()
const migrationKey = (root: string): string => `migrated:${storeKey(root)}`

/**
 * Le board enregistré du projet : le fichier commun, sinon `$.store`. Une seule fois par mode de
 * chargement, l'ancien `$.store` est fusionné dans le fichier commun : le desktop y apporte son
 * historique, le CLI le sien. `isUnread` : le stockage ne s'est pas lu (fichier commun connu mais
 * illisible, `$.store` en échec quand il est le stockage, ou une valeur qui n'est pas le board du
 * projet) ; un stockage vide se lit bien. Le mode auto s'éteint alors : une lecture ratée ne le
 * laisse jamais allumé.
 */
const loadStored = async ($: any, root: string): Promise<{ value: unknown; isUnread: boolean }> => {
  const shared = await readShared($, root)
  if (!shared.ok) {
    const legacy = await legacyRead($, root)
    const isUnread = sharedPath($, root) !== null || !legacy.ok || (legacy.value !== undefined && !isOwnBoard(legacy.value, root))
    return { value: legacy.value, isUnread }
  }
  const isUnread = shared.value !== undefined && !isOwnBoard(shared.value, root)
  const key = storeKey(root)
  if (migrated.has(key)) return { value: shared.value, isUnread }
  let isDone = false
  try {
    isDone = (await $.store.get(migrationKey(root))) === true
  } catch {
    isDone = false
  }
  if (isDone) {
    migrated.add(key)
    return { value: shared.value, isUnread }
  }
  const legacy = await legacyGet($, root)
  if (!isOwnBoard(legacy, root)) {
    migrated.add(key)
    return { value: shared.value, isUnread }
  }
  // Les deux copies ramenées à maintenant, comme à toute lecture : une trace de suppression future ne s'applique pas.
  const at = await $.clock.now()
  const fused = isBoard(shared.value) ? mergeBoards(clampFuture(shared.value, at), clampFuture(legacy, at)) : clampFuture(legacy, at)
  // Le fichier commun ne se lisait pas comme un board : le versement l'écrase, mode auto éteint.
  const value = isUnread ? (stopAutoUnread(fused, at, await hereId($)) ?? fused) : fused
  if (await writeShared($, root, sharedCopy(value))) {
    migrated.add(key)
    try {
      await $.store.set(migrationKey(root), true)
    } catch {
      // Le versement sera refait au prochain chargement ; la fusion le rend sans effet.
    }
  }
  return { value, isUnread }
}

/**
 * Une mission absente du board d'ici (racine `here`), lue dans celui du dépôt principal : une session
 * lancée dans un worktree a sa propre racine, donc son propre fichier. Lecture seule (pas de
 * versement de l'ancien stockage) ; rien quand la session n'est pas dans un worktree. `isFileOnly` : un fichier
 * commun qui ne se lit pas (écriture en cours, lecture refusée) ne se remplace pas par la copie de `$.store`, peut-être
 * périmée : rien n'est rendu (la relecture d'un worker, `managerReachOf`, la dit alors illisible).
 */
const mainRepoRun = async ($: any, runId: string, here: string, isFileOnly = false): Promise<Run | undefined> => {
  if (runId === '') return undefined
  let root = ''
  await quietly(async () => {
    root = String((await $.session.repo())?.root ?? '')
  })
  if (root === '' || normRoot(root).toLowerCase() === normRoot(here).toLowerCase()) return undefined
  const shared = isFileOnly ? await readSharedTwice($, root) : await readShared($, root)
  if (!shared.ok && isFileOnly && sharedPath($, root) !== null) return undefined
  const stored = shared.ok ? shared.value : await legacyGet($, root)
  return isBoard(stored) ? stored.runs.find(r => r.id === runId) : undefined
}

/** Le fichier commun lu, relu une fois quand la première lecture rate (une écriture d'une autre discussion en cours). */
const readSharedTwice = async ($: any, root: string): Promise<{ ok: boolean; value: unknown }> => {
  const first = await readShared($, root)
  return first.ok ? first : await readShared($, root)
}

/**
 * La mission que relit un worker pour dire la référence de son manager (`managerReachOf`), à chaque appel : dans le
 * fichier commun de sa racine, relu à l'instant, sinon dans celui du dépôt principal (`mainRepoRun`). Un fichier commun
 * qui ne se lit pas, même relu une fois, ne se remplace jamais par une copie peut-être périmée (`$.store`, le board en
 * mémoire) : rien n'est rendu, et la réponse dit la mission illisible. Sans fichier commun (mode `$.store`), le board en
 * mémoire de cette discussion. Lecture seule.
 */
const reachRunOf = async ($: any, board: Board, runId: string): Promise<Run | undefined> => {
  if (sharedPath($, board.root) === null) return board.runs.find(r => r.id === runId) ?? (await mainRepoRun($, runId, board.root, true))
  const here = await readSharedTwice($, board.root)
  if (!here.ok) return undefined
  return (isBoard(here.value) ? here.value.runs.find(r => r.id === runId) : undefined) ?? (await mainRepoRun($, runId, board.root, true))
}

/** Le titre d'une mission absente du board d'ici, lu dans celui du dépôt principal (`mainRepoRun`). */
const mainRepoTitle = async ($: any, runId: string): Promise<string | undefined> => {
  const board = await read($, boardAtom)
  if (!board || board.runs.some(r => r.id === runId)) return undefined
  return (await mainRepoRun($, runId, board.root))?.title
}

/** Deux racines désignent le même dossier (fins de chemin et casse mises à part, comme `sharedPath`). */
const sameRoot = (a: string, b: string): boolean => normRoot(a).toLowerCase() === normRoot(b).toLowerCase()

/** Une valeur relue est le board de la racine `root`, casse mise à part. */
const isBoardOf = (value: unknown, root: string): value is Board => isBoard(value) && typeof value.root === 'string' && sameRoot(value.root, root)

/**
 * Le board enregistré d'une racine, lu sans rien écrire (ni versement de l'ancien stockage, que fait
 * `loadStored`) : le fichier commun, sinon `$.store`. `isUnread` comme `loadStored` : le fichier connu
 * ne se lit pas, ou ce qui s'y lit n'est pas le board de cette racine.
 */
const peekStored = async ($: any, root: string): Promise<{ value: unknown; isUnread: boolean }> => {
  const shared = await readShared($, root)
  if (!shared.ok) {
    const legacy = await legacyRead($, root)
    return { value: legacy.value, isUnread: sharedPath($, root) !== null || !legacy.ok || (legacy.value !== undefined && !isBoardOf(legacy.value, root)) }
  }
  if (shared.value !== undefined) return { value: shared.value, isUnread: !isBoardOf(shared.value, root) }
  // Pas encore de fichier : l'ancien stockage, que le premier chargement y versera.
  const legacy = await legacyRead($, root)
  return { value: isBoardOf(legacy.value, root) ? legacy.value : undefined, isUnread: false }
}

/**
 * Le dernier chargement n'a pas pu lire le fichier des missions du dépôt principal depuis un worktree :
 * la réponse de l'outil le dit. Seulement pour ce message : la règle elle-même se déduit à chaque chargement.
 */
let mainUnread = false

/** Ce que répond l'outil quand ce fichier ne se lit pas. */
const MAIN_UNREAD =
  'Dashboard unavailable: this discussion runs in a worktree, and the missions file of the main repository could not be read just now, so nothing was loaded nor recorded (neither in that file nor in the worktree\'s). Send the call again in a few seconds; tell the user if it keeps failing.'

/**
 * La racine dont la discussion lit et écrit le fichier des missions. Celle de la session, sauf dans un
 * worktree d'un dépôt quand la discussion porte une mission active du dépôt principal (son `owner`) :
 * elle garde alors le fichier de ce dépôt, comme à sa racine. `keep` : le board en mémoire (relu toutes les
 * 5 s, gardé par /reload-plugins) est celui du dépôt principal et sa mission active est celle de cette
 * discussion ; ou le moteur ne dit pas le dépôt et ce board porte la mission active de cette discussion (le
 * doute garde). Sans board en mémoire, le fichier du dépôt principal relu à l'instant, sans écriture, en
 * décide ; illisible, `unread` : rien ne se charge ni ne s'écrit. Un worker (sa délégation gardée, ou
 * l'appel qui la déclare) n'est jamais `owner` d'une mission du dépôt principal : il garde son fichier.
 */
const missionRoot = async ($: any, root: string, current: Board | null, isWorker: boolean): Promise<string | 'keep' | 'unread'> => {
  if (root === '') return root
  let repoRoot = ''
  let isAnswered = false
  await quietly(async () => {
    repoRoot = String((await $.session.repo())?.root ?? '')
    isAnswered = true
  })
  const run = current ? activeRun(current) : null
  const isMine = current !== null && run !== null && run.owner === current.session
  // Le moteur ne dit pas le dépôt : la discussion garde le board de sa mission, jamais de bascule sur un doute.
  if (!isAnswered) return isMine ? 'keep' : root
  if (repoRoot === '') return root
  // Seule une mission du dépôt principal se garde ; une mission ouverte dans un worktree reste à son fichier, et la discussion qui en sort passe au fichier du dossier où elle est.
  if (current) return isMine && sameRoot(current.root, repoRoot) ? 'keep' : root
  if (sameRoot(repoRoot, root)) return root
  if (isWorker) return root
  const session = await sessionId($)
  let kept: unknown = null
  await quietly(async () => {
    kept = await $.store.get(delegateKey(session))
  })
  if (kept !== null && kept !== undefined) return root
  const peek = await peekStored($, repoRoot)
  if (peek.isUnread) return 'unread'
  const stored = peek.value
  if (!isBoardOf(stored, repoRoot)) return root
  // La racine telle que le fichier l'écrit : le chargement la retrouve à l'identique (`isOwnBoard`).
  return stored.runs.some(r => r.status === 'active' && r.archivedAt === undefined && r.owner === session) ? stored.root : root
}

/**
 * Écrit le board dans le fichier commun, sinon dans `$.store`, sans ce qui est propre à la session
 * (`sharedCopy`). Rend vrai quand il est dans celui que la relecture lit : le fichier
 * commun, ou `$.store` quand le mod ne sait pas où est ce fichier. Un fichier connu qui refuse l'écriture
 * retombe sur `$.store`, que la relecture ne lit pas tant que le fichier se lit : faux.
 */
const saveStored = async ($: any, root: string, board: Board): Promise<boolean> => {
  const shared = sharedCopy(board)
  if (await writeShared($, root, shared)) return true
  try {
    await $.store.set(storeKey(root), shared)
    return sharedPath($, root) === null
  } catch {
    // Stockage indisponible (test, quota) : l'état de la session reste juste.
    return false
  }
}

// ─── Relais des workers ────────────────────────────────────────────
//
// Un fichier par worker, à côté des missions (`<parcours>.<session>.entry.json`) : chacun n'écrit
// que le sien, le manager les lit et les réunit, avec l'ancien fichier commun de la mission,
// plus jamais réécrit (un fichier par worker). Ils ne dépendent pas de la racine : une session dans un worktree
// (autre racine, autre fichier de mission) écrit au même endroit que si elle était dans le dossier.

const runSlug = relayFileSlug

/**
 * Les comptes rendus entiers des workers d'une mission, dits à Claude (`<id>` : l'id de la
 * session). L'id de la mission n'y entre que réduit à [a-z0-9-] (runSlug), comme le nom des fichiers du relais.
 */
const relayReportsPattern = ($: any, runId: string): string => `${claudeHome($) ?? '~/.claude'}/flow-board/relais/${runSlug(runId)}.<id>.report.md`

export function relayPath($: any, runId: string): string | null {
  const home = claudeHome($)
  const slug = runSlug(runId)
  return home && slug ? `${home}/flow-board/relais/${slug}.json` : null
}

/** Le compte rendu entier d'un worker, à côté du relais ; écrit par lui seul, ou, pour un worker sans outil flow, par le manager sous un nom de dépôt (`managerReportSession`). */
export function reportPath($: any, runId: string, session: string): string | null {
  const home = claudeHome($)
  return home && runSlug(runId) && relayFileSlug(session) ? `${home}/flow-board/relais/${reportFileName(runId, session)}` : null
}

/** La référence du moment du manager, à côté du relais ; écrite par lui seul. */
export function mainRefPath($: any, runId: string): string | null {
  const home = claudeHome($)
  return home && runSlug(runId) ? `${home}/flow-board/relais/${mainRefFileName(runId)}` : null
}

/** Sa clé de `$.store`, quand le fichier est hors d'atteinte. */
export const mainRefKey = (runId: string): string => `relay-main:${runId}`

/** Écrit le compte rendu entier d'un worker ; faux quand il n'a pas pu s'écrire. */
const writeReportFile = async ($: any, runId: string, session: string, text: string): Promise<boolean> => {
  const path = reportPath($, runId, session)
  if (!path) return false
  // Une mission effacée (S23) : rien ne s'écrit plus pour elle, son compte rendu non plus.
  await quietly(() => readTraces($))
  if (erasedRuns.has(runId)) return false
  try {
    await $.fs.write(path, text)
    return true
  } catch {
    return false
  }
}

/** Le plus long compte rendu qu'un worker donne par son chemin (`reportPath`), en signes, et la taille du fichier, en octets. */
const REPORT_PATH_MAX = 200_000
const REPORT_PATH_BYTES = 800_000

/**
 * Les dossiers d'où un worker peut donner son compte rendu par son chemin : son worktree (une racine
 * `<dépôt>/.claude/worktrees/<nom>`, jamais le dossier du projet) et son dossier temporaire
 * (`CLAUDE_JOB_DIR`, en forme) ; chacun résolu (liens suivis), tel que le disque le nomme, et encore en
 * forme une fois résolu (jamais la racine d'un disque ; un worktree résolu reste un worktree).
 */
const reportRoots = async ($: any): Promise<string[]> => {
  const isWorktree = (dir: string): boolean => /\/\.claude\/worktrees\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/i.test(dir)
  const roots: { dir: string; isWorktree: boolean }[] = []
  const root = normRoot(await sessionRoot($))
  if (isWorktree(root)) roots.push({ dir: root, isWorktree: true })
  let job: unknown
  try {
    job = await $.env.get('CLAUDE_JOB_DIR')
  } catch {
    job = undefined
  }
  const jobDir = typeof job === 'string' ? tempDirForm(job.trim()) : null
  if (jobDir) roots.push({ dir: jobDir, isWorktree: false })
  const real: string[] = []
  for (const r of roots) {
    try {
      const stat = await $.fs.stat(r.dir, { resolve: true })
      const resolved = stat?.kind === 'dir' && typeof stat.realPath === 'string' ? tempDirForm(stat.realPath) : null
      if (resolved && (!r.isWorktree || isWorktree(resolved))) real.push(resolved)
    } catch {
      // Un dossier qui ne se résout pas n'ouvre rien.
    }
  }
  return real
}

/** Le worktree noté d'un groupe, seule racine d'un dépôt du manager : résolu, un dossier, et encore un worktree une fois résolu. */
const reportRoot = async ($: any, worktree: string): Promise<string[]> => {
  try {
    const stat = await $.fs.stat(worktree, { resolve: true })
    const resolved = stat?.kind === 'dir' && typeof stat.realPath === 'string' ? tempDirForm(stat.realPath) : null
    // Résolu, il reste ce même worktree : le dossier des worktrees du dépôt, résolu lui aussi, suivi du nom noté, à la casse
    // près (un lien vers le worktree d'un autre groupe, d'un autre dépôt ou d'un nom qui ne diffère que par la casse ne vaut pas).
    const parent = await $.fs.stat(worktree.slice(0, worktree.lastIndexOf('/')), { resolve: true })
    const parentReal = parent?.kind === 'dir' && typeof parent.realPath === 'string' ? tempDirForm(parent.realPath) : null
    return resolved && parentReal && resolved === `${parentReal}/${worktree.split('/').pop()}` ? [resolved] : []
  } catch {
    return []
  }
}

/**
 * Le compte rendu d'un worker donné par le chemin de son fichier (`reportPath`), lu une fois : un
 * chemin absolu, un fichier ordinaire `.md` ou `.txt` (le nom donné comme le nom résolu), sous son
 * worktree ou son dossier temporaire (`CLAUDE_JOB_DIR`) une fois résolu (liens suivis, puis vérifié :
 * casse comprise), sans segment en `.` sous ce dossier, 800 000 octets et 200 000 signes au plus, pas
 * vide, et le même fichier relu après la lecture (même chemin résolu, pas un lien, même taille et même
 * date). Un lien physique garde son propre nom : la garde par le chemin résolu ne le voit pas (un
 * fichier du même compte). Rend son texte, ou la raison du refus, en mots, sans le chemin. `worktree` : pour un
 * dépôt du manager (depot-manager.ts), la seule racine, le worktree noté du groupe, résolu et encore un worktree.
 */
const readReportPath = async ($: any, raw: unknown, worktree?: string): Promise<{ text: string; real: string } | { why: string }> => {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > 1000) return { why: 'not a path' }
  const path = raw.trim().replace(/\\/g, '/')
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(path) || !/^(?:\/(?!\/)|[A-Za-z]:\/)/.test(path)) return { why: 'not an absolute path' }
  const isText = (p: string): boolean => /\.(?:md|txt)$/i.test(p)
  if (!isText(path)) return { why: 'only a .md or .txt file is read' }
  let before: { kind?: unknown; size?: unknown; mtimeMs?: unknown; realPath?: unknown } | undefined
  try {
    before = await $.fs.stat(path, { resolve: true })
  } catch {
    return { why: 'no such file' }
  }
  const real = typeof before?.realPath === 'string' ? before.realPath.replace(/\\/g, '/') : ''
  if (before?.kind !== 'file' || real === '') return { why: 'not a regular file' }
  const roots = (worktree === undefined ? await reportRoots($) : await reportRoot($, worktree)).filter(r => real.startsWith(`${r}/`))
  if (roots.length === 0) return { why: worktree === undefined ? 'outside your worktree and your temporary folder (CLAUDE_JOB_DIR)' : 'outside the worktree noted for this send of the group' }
  // Un dossier temporaire sous le worktree : il suffit qu'une des deux racines accepte le chemin.
  if (roots.every(r => real.slice(r.length + 1).split('/').some(part => part.startsWith('.')))) return { why: 'under a hidden folder or a hidden file' }
  // Un lien au nom en .md qui mène à un fichier d'un autre type : refusé comme ce fichier, une fois sous une racine
  // (avant, la réponse dirait le type d'un fichier hors des racines).
  if (!isText(real)) return { why: 'only a .md or .txt file is read' }
  if (typeof before.size !== 'number') return { why: 'its size could not be read' }
  if (before.size > REPORT_PATH_BYTES) return { why: `over ${REPORT_PATH_MAX} characters` }
  let text = ''
  try {
    text = String(await $.fs.read(real))
    // Relu après la lecture : le même fichier, pas un lien posé entre-temps, ni changé.
    const after = await $.fs.stat(real, { resolve: true })
    const again = typeof after?.realPath === 'string' ? after.realPath.replace(/\\/g, '/') : ''
    if (after?.kind !== 'file' || after.isLink === true || again !== real || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return { why: 'the file changed while it was read' }
  } catch {
    return { why: 'the file could not be read' }
  }
  if (text.length > REPORT_PATH_MAX) return { why: `over ${REPORT_PATH_MAX} characters` }
  if (text.trim() === '') return { why: 'the file is empty' }
  return { text, real }
}

/**
 * Le dépôt du compte rendu d'un groupe par le manager (`{"reportPath", "group"}`, depot-manager.ts) : gardes de
 * `depositTarget` (relais relu en entier), fichier lu sous le seul worktree noté de l'envoi, texte entier écrit dans un
 * fichier neuf du relais (jamais sur un fichier qui existe, jamais pour une mission effacée). La marque se pose
 * ensuite, dans l'écriture du board (`withDeposit`) ; refusé, rien n'est écrit.
 */
const depositCall = async ($: any, rawPath: unknown, rawGroup: unknown, now: number): Promise<{ deposit?: Deposit; text: string }> => {
  const refused = (why: string) => ({ text: ` · "reportPath" with "group" refused: ${neutralInPrompt(why)}; nothing was deposited.` })
  // Relu d'abord : une reprise de la mission par une autre discussion se voit avant le dépôt.
  if (!(await pull($))) return refused('the missions file could not be re-read')
  const board: Board | null = await read($, boardAtom)
  const run = activeRun(board)
  // Menée ici : la mission active de cette discussion, qu'elle tient (une autre discussion qui l'a reprise la mène).
  if (!board || board.delegate || !run || run.owner !== board.session) return refused('no mission is led in this discussion')
  // Aucun segment « . » ou « .. » : le chemin ne remonte jamais hors du worktree, quel que soit le chemin résolu que rend le moteur.
  if (typeof rawPath === 'string' && rawPath.replace(/\\/g, '/').split('/').some(part => part === '.' || part === '..')) return refused('a path with a . or .. segment is not read')
  const gaps = { count: 0 }
  const relay = await readRelay($, run.id, gaps)
  // La racine du dépôt principal, telle que le moteur la donne, sinon (aucune, ou « error » quand le moteur lève) celle du board.
  const repo = await mainRepoRoot($)
  const target = depositTarget(run, rawGroup, isRelay(relay, run.id) ? relay : null, gaps.count === 0, typeof repo === 'string' && repo !== 'error' ? repo : board.root)
  if ('why' in target) return refused(target.why)
  const outcome = await readReportPath($, rawPath, target.worktree)
  if ('why' in outcome) return refused(outcome.why)
  const session = managerReportSession(target.group.id, now)
  const path = reportPath($, run.id, session)
  if (!path) return refused('the Claude folder is unknown, so the whole report could not be kept')
  let isThere = true
  try {
    isThere = await $.fs.exists(path)
  } catch {
    // Dans le doute, le fichier est là : rien ne le remplace.
  }
  if (isThere) return refused('a deposit file of that name already exists, and nothing replaces it')
  if (!(await writeReportFile($, run.id, session, outcome.text))) return refused('the mission was erased, or the whole report could not be written')
  return { deposit: { runId: run.id, groupId: target.group.id, linkAt: target.link.at, worktreeName: String(target.link.worktreeName), mark: { at: now, length: outcome.text.length }, read: outcome.real }, text: '' }
}

/** Le dépôt en cours dans ce processus (son jeton et sa date ; null : aucun) ; passé ce délai, un appel resté en route ne bloque plus. */
let depositBusy: { at: number } | null = null
const DEPOSIT_BUSY_MS = 60_000

/**
 * Après l'écriture du board : la marque posée par cette écriture (`isWritten`, l'issue de la boucle d'écriture, jamais
 * une relecture), la réponse le dit ; sinon, le fichier écrit pour elle s'efface, rien n'est déposé.
 */
const depositOutcome = async ($: any, d: Deposit, isWritten: boolean): Promise<string> => {
  const run = ((await read($, boardAtom)) as Board | null)?.runs.find(r => r.id === d.runId)
  const g = run?.groups?.find(x => x.id === d.groupId)
  const link = [g?.linked, g?.delegated, ...earlierOf(g?.delegated)].find(l => l?.at === d.linkAt)
  const file = reportFileName(d.runId, managerReportSession(d.groupId, d.mark.at))
  if (isWritten) {
    // La fermeture ne le compte qu'avec une session du CLI notée pour l'envoi, comme un compte rendu du worker.
    const isCounted = run !== undefined && g !== undefined && link !== undefined && groupReportOf(null, g, run.groups, link) !== undefined
    return ` · final report of group ${shownGroupId(d.groupId)} deposited by you (the manager) for its worker, which lacked the flow tool: kept with its send, whole in ~/.claude/flow-board/relais/${file}; ${isCounted ? 'its closing counts it' : 'its closing does not count it (no CLI session noted for this send): it keeps the session'}, and a report its worker leaves later prevails. Now, only if git status in its worktree shows it untracked, delete the file it was read from, ${JSON.stringify(neutralInPrompt(d.read))} (its text is kept): an untracked file there stops the closing; a committed one stays.`
  }
  // Le fichier n'est effacé que s'il n'est pas celui d'une marque posée (un autre dépôt du même instant).
  if (link?.managerReport?.at !== d.mark.at) await eraseFile($, reportPath($, d.runId, managerReportSession(d.groupId, d.mark.at)))
  return ` · "reportPath" with "group": nothing was deposited (the send of group ${shownGroupId(d.groupId)} changed, or another deposit arrived, while it was recorded); send it again.`
}

/**
 * Les missions dont la demande de référence est close depuis le démarrage de ce processus, le dernier
 * rechargement (`session.start` la vide) ou la dernière reprise ici (qui en retire la mission) : la référence
 * écrite, une plus récente en place, un refus (cette discussion ne la porte pas), ou trois tentatives ratées
 * (`mainRefFailures`). Tant qu'une mission portée ici avec des groupes confiés n'y est pas, chaque tour demande à
 * Claude de l'envoyer (`mainRefAsk`).
 */
const mainRefWritten = new Set<string>()

/** Les tentatives ratées (fichier des missions illisible, aucune copie écrite) par mission, depuis le démarrage. */
const mainRefFailures = new Map<string, number>()

/**
 * La référence « [ref] » de cette discussion, par mission, que ce processus a écrite à côté du relais (réponse
 * « written ») depuis son démarrage, son dernier rechargement ou /clear (`session.start` la vide) et la dernière
 * reprise ici : la demande de lancement la donne au lieu de faire rappeler ListAgents. Seulement en mémoire : le
 * moteur ne donne pas la référence à un mod, et après un redémarrage elle a pu changer.
 */
const mainRefKnown = new Map<string, string>()

/**
 * Les parties communes de la dernière demande entière de lancement écrite (`launchOffered`), et celles que Claude a
 * reçues (`launchReceived`, posées au début du tour dont le texte les porte) : la demande suivante aux mêmes parties
 * prend la forme courte (`isShortLaunch`). En mémoire seulement : `session.start` (démarrage, rechargement, /clear)
 * et toute compaction les effacent, et la demande entière revient.
 */
let launchOffered: LaunchParts | null = null
let launchReceived: LaunchParts | null = null

/** Au-delà de ce nombre de tentatives ratées, la demande s'arrête : chaque reprise recite les comptes rendus. */
const MAIN_REF_TRIES = 3

/** `pull` qui rend faux quand il lève : le fichier des missions ne s'est pas relu. */
const pullOk = async ($: any): Promise<boolean> => {
  try {
    return await pull($)
  } catch {
    return false
  }
}

/**
 * Dans le manager, à la reprise : sa référence du moment, que les workers relisent. Seulement par la
 * discussion qui porte la mission (relue juste avant : active ici, `owner` cette discussion, pas un
 * worker, pas effacée), et seulement plus récente que celle en place. Écrite dans le fichier et dans
 * `$.store` : une écriture coupée de l'un laisse l'autre lisible, et la lecture prend la plus récente.
 * Rend `written`, `older` (une plus récente est en place), `failed` (aucune des deux ne s'est écrite) ou
 * `refused` (cette discussion ne porte pas la mission), `unread` (le fichier des missions ne s'est pas relu). Les
 * écritures se suivent une à une (`mainRefChain`) : deux appels qui se chevauchent ne lisent jamais la même
 * référence en place, et le plus ancien ne recouvre pas le plus récent. Une écriture qui ne rend pas la main
 * dans `MAIN_REF_WRITE_MS` (une lecture du moteur suspendue) compte comme ratée : ni l'outil ni la file ne
 * l'attendent plus.
 */
const writeMainRef = ($: any, ref: MainRef): Promise<MainRefOutcome> => {
  const late = new Promise<MainRefOutcome>(resolve => $.clock.after(MAIN_REF_WRITE_MS, () => resolve('failed')))
  const next = Promise.race([mainRefChain.then(() => writeMainRefNow($, ref)), late])
  mainRefChain = next.catch(() => undefined)
  return next
}

/** Le plus long qu'attend une écriture de la référence du manager (deux copies et la relecture des missions). */
const MAIN_REF_WRITE_MS = 15_000

type MainRefOutcome = 'written' | 'older' | 'failed' | 'refused' | 'unread'

/** La file des écritures de la référence du manager : une à la fois. */
let mainRefChain: Promise<unknown> = Promise.resolve()

const writeMainRefNow = async ($: any, ref: MainRef): Promise<MainRefOutcome> => {
  if (!(await pullOk($))) return 'unread'
  const board: Board | null = await read($, boardAtom)
  const run = activeRun(board)
  await quietly(() => readTraces($))
  // L'id qui pose `owner` (`board.session`, celui de `sessionId`), pas `hereId` : un /clear change le second, pas le premier.
  if (!board || board.delegate || run?.id !== ref.run || run.owner !== board.session || erasedRuns.has(ref.run)) return 'refused'
  if (!isMainRefNewer(await readMainRef($, ref.run), ref)) return 'older'
  let isWritten = false
  const path = mainRefPath($, ref.run)
  if (path) {
    try {
      await $.fs.write(path, JSON.stringify(ref))
      isWritten = true
    } catch {
      // L'autre copie reste.
    }
  }
  try {
    await $.store.set(mainRefKey(ref.run), ref)
    isWritten = true
  } catch {
    // L'autre copie reste.
  }
  return isWritten ? 'written' : 'failed'
}

/**
 * La référence du manager écrite à côté du relais : la plus récente du fichier et de `$.store`, chacune
 * bornée (`parseMainRef`) ; null quand aucune ne se lit.
 */
const readMainRef = async ($: any, runId: string): Promise<MainRef | null> => {
  // Une date au-delà de l'heure d'ici plus la marge ne se lit pas : elle refuserait à jamais les plus récentes.
  const now = await $.clock.now()
  let fromFile: MainRef | null = null
  const path = mainRefPath($, runId)
  if (path) {
    try {
      if (await $.fs.exists(path)) fromFile = parseMainRef(JSON.parse(String(await $.fs.read(path))), runId, now)
    } catch {
      // Fichier hors d'atteinte ou abîmé : la copie de `$.store` reste.
    }
  }
  let fromStore: MainRef | null = null
  try {
    fromStore = parseMainRef(await $.store.get(mainRefKey(runId)), runId, now)
  } catch {
    // Stockage hors d'atteinte : la copie du fichier reste.
  }
  return newestMainRef(fromFile, fromStore)
}

// ─── Fichier des choix déjà déclarés ──────────────────────────────────────
//
// Un fichier Markdown par mission, à côté du relais, écrit par le seul manager
// d'après la mission et le relais : les briefs et les consignes de revue citent son chemin au
// lieu de recopier la liste des choix, qui se périmait d'une consigne à l'autre.

export function decidedPath($: any, runId: string): string | null {
  const home = claudeHome($)
  const slug = runSlug(runId)
  return home && slug ? `${home}/flow-board/choix/${slug}.md` : null
}

/** Le dernier texte écrit par fichier : rien n'est réécrit quand la liste n'a pas bougé. */
const decidedWritten = new Map<string, string>()

/**
 * Réécrit le fichier des choix de la mission active, s'il a changé. Rend son chemin quand il est à
 * jour, null sinon (pas de mission, fichier hors d'atteinte) : une consigne ne cite alors pas le chemin.
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

/** Le fichier de l'entrée d'un worker, à côté du relais ; écrit par lui seul. */
export function relayEntryPath($: any, runId: string, session: string): string | null {
  const home = claudeHome($)
  return home && runSlug(runId) && relayFileSlug(session) ? `${home}/flow-board/relais/${relayEntryFileName(runId, session)}` : null
}

/** Sa clé de `$.store`, quand le fichier est hors d'atteinte. */
export const relayEntryKey = (runId: string, session: string): string => `relay:${runId}:${session}`

/** Les fichiers d'entrée des sessions d'une mission, trouvés dans le dossier du relais ; `gaps` compte un dossier qui ne se liste pas. */
export async function relayEntryFilesOf($: any, runId: string, gaps?: { count: number }): Promise<string[]> {
  const sample = relayEntryPath($, runId, 'x')
  if (!sample) return []
  const dir = sample.slice(0, sample.lastIndexOf('/'))
  const prefix = `${relayFileSlug(runId)}.`
  try {
    // Un dossier jamais créé (le relais vit sous `$.store`) n'a aucun fichier : ce n'est pas une liste qui ne se lit pas ;
    // mais `exists` répond aussi faux sur un droit refusé : seul un dossier que son parent ne liste pas est absent.
    if (gaps && !(await $.fs.exists(dir))) {
      const home = claudeHome($)
      if (!home || !(await isSettingMissing($, home, dir))) gaps.count++
      return []
    }
    const names = ((await $.fs.list(dir)) as { name: string }[]).map(x => x.name)
    return names.filter(n => n.startsWith(prefix) && n.endsWith('.entry.json')).map(n => `${dir}/${n}`)
  } catch {
    if (gaps) gaps.count++
    return []
  }
}

/** Les clés de `$.store` des entrées des sessions d'une mission ; `gaps` compte une liste qui ne se lit pas. */
export async function relayEntryKeysOf($: any, runId: string, gaps?: { count: number }): Promise<string[]> {
  try {
    return ((await $.store.keys()) as string[]).filter(k => k.startsWith(`${relayKey(runId)}:`))
  } catch {
    if (gaps) gaps.count++
    return []
  }
}

/** Ce qu'une lecture a trouvé : rien, une valeur, ou un contenu présent qui ne se lit pas (jamais réécrit). */
type Found = { state: 'absent' } | { state: 'unreadable' } | { state: 'read'; value: unknown }

/** Un fichier JSON : absent, lu, ou illisible (en pleine écriture, abîmé) ; null quand le disque est hors d'atteinte. */
const readJsonFile = async ($: any, path: string): Promise<Found | null> => {
  let text: string
  try {
    if (!(await $.fs.exists(path))) return { state: 'absent' }
    text = String(await $.fs.read(path))
  } catch {
    return null
  }
  try {
    return { state: 'read', value: JSON.parse(text) }
  } catch {
    return { state: 'unreadable' }
  }
}

/** L'ancien relais commun d'une mission (le fichier, sinon `$.store`) : lu seulement, plus jamais réécrit. */
const readSharedRelay = async ($: any, runId: string, gaps?: { count: number }): Promise<Found> => {
  const path = relayPath($, runId)
  const found = path ? await readJsonFile($, path) : null
  if (found) return found
  // Un fichier dont la lecture a levé n'est pas une absence : la copie du magasin peut être plus ancienne.
  if (path && gaps) gaps.count++
  try {
    const value = await $.store.get(relayKey(runId))
    return value === undefined ? { state: 'absent' } : { state: 'read', value }
  } catch {
    return { state: 'absent' }
  }
}

/**
 * Le relais d'une mission, pour le manager : l'ancien fichier commun et le fichier de
 * chaque session (puis leurs clés de `$.store`), réunis par `mergeRelay` ; un fichier qui ne se lit
 * pas est passé, jamais réécrit, et compté dans `gaps` quand il est donné (comme une liste qui ne se lit pas). Rien quand aucune source ne se lit.
 */
export async function readRelay($: any, runId: string, gaps?: { count: number }): Promise<unknown> {
  const shared = await readSharedRelay($, runId, gaps)
  if (gaps && shared.state === 'unreadable') gaps.count++
  const own: unknown[] = []
  // Une entrée hors forme compte aussi : `mergeRelay` la passerait comme absente.
  const keep = (value: unknown) => {
    own.push(value)
    if (gaps && parseRelayEntryFile(value, runId) === null) gaps.count++
  }
  for (const path of await relayEntryFilesOf($, runId, gaps)) {
    const found = await readJsonFile($, path)
    if (found?.state === 'read') keep(found.value)
    else if (gaps && (found === null || found.state === 'unreadable')) gaps.count++
  }
  for (const key of await relayEntryKeysOf($, runId, gaps)) {
    try {
      keep(await $.store.get(key))
    } catch {
      if (gaps) gaps.count++
    }
  }
  return mergeRelay(runId, shared.state === 'read' ? shared.value : undefined, own) ?? undefined
}

/**
 * L'entrée de cette session, telle qu'elle l'a laissée : la plus récente de son fichier, de sa clé de
 * `$.store` et de l'ancien relais commun (une session lancée avant le fichier par session). Son fichier
 * ou sa clé présents mais illisibles, ou une lecture ratée, arrêtent l'écriture : ils ne sont jamais
 * réécrits, et la réponse le dit. L'ancien relais commun, lui, n'est jamais réécrit du tout.
 */
const readOwnEntry = async ($: any, runId: string, session: string): Promise<{ entry: RelayEntry | undefined } | { why: string }> => {
  const candidates: RelayEntry[] = []
  const path = relayEntryPath($, runId, session)
  if (path) {
    const file = await readJsonFile($, path)
    // Une lecture ratée n'est pas une absence : l'entrée gardée là ne serait plus qu'à réécrire de zéro.
    if (file === null) return { why: 'its own relay file could not be read: nothing overwritten' }
    if (file.state === 'unreadable') return { why: 'its own relay file exists but does not read (cut or damaged): nothing overwritten' }
    if (file.state === 'read') {
      const read = parseRelayEntryFile(file.value, runId)
      if (!read || read.session !== session) return { why: 'its own relay file exists but is not an entry of this session: nothing overwritten' }
      candidates.push(read.entry)
    }
  }
  let stored: unknown
  let isStoreRead = true
  try {
    stored = await $.store.get(relayEntryKey(runId, session))
  } catch {
    isStoreRead = false
  }
  if (!isStoreRead) return { why: 'its own relay entry in the store could not be read: nothing overwritten' }
  if (stored !== undefined) {
    const read = parseRelayEntryFile(stored, runId)
    if (!read || read.session !== session) return { why: 'its own relay entry in the store is not an entry of this session: nothing overwritten' }
    candidates.push(read.entry)
  }
  // Une session lancée avant le fichier par session part de son entrée dans l'ancien relais commun.
  // Illisible, ce fichier n'est ni réécrit ni montré : la session part d'une entrée neuve, la sienne.
  if (candidates.length === 0) {
    const shared = await readSharedRelay($, runId)
    const old = shared.state === 'read' ? mergeRelay(runId, shared.value, [])?.sessions[session] : undefined
    if (old) candidates.push(old)
  }
  return { entry: latestRelayEntry(candidates) }
}

/** Écrit l'entrée de cette session, son fichier, sinon sa clé de `$.store` ; rend où, ou null quand rien n'a pu s'écrire. */
const writeOwnEntry = async ($: any, file: RelayEntryFile): Promise<'file' | 'store' | null> => {
  const path = relayEntryPath($, file.run, file.session)
  if (path) {
    try {
      await $.fs.write(path, JSON.stringify(file))
      return 'file'
    } catch {
      // Repli sur `$.store`.
    }
  }
  try {
    await $.store.set(relayEntryKey(file.run, file.session), file)
    return 'store'
  } catch {
    return null
  }
}

/**
 * Ce qu'un signal est devenu au relais : gardé (ou déjà là), ou pas gardé, avec la raison ; `isFinal` : le
 * renvoyer tel quel ne servirait à rien ou recompterait ; `isReview` : un refus de la revue de l'appel (ses bogues ou ses autres comptes) ; `isSecurity` : un refus de sa revue de sécurité (un compte de sécurité gardé illisible) ;
 * `isRepeated` : la revue de l'appel était déjà reçue (`isRepeatedReview`), laissée de côté, le reste de l'appel traité.
 */
type RelayOutcome =
  | { isKept: true; note?: string; closed?: string[]; isRepeated?: true }
  | { isKept: false; why: string; isFinal?: true; isReview?: true; isSecurity?: true; isRepeated?: true }

/** Les signaux de cette session, un à la fois : deux crochets en même temps ne relisent pas la même entrée. */
let relayQueue: Promise<unknown> = Promise.resolve()

/**
 * Dans un worker : un signal (ticket, commit, tests, choix, revue, compte rendu, fin) part à
 * l'entrée de cette session dans le relais, son fichier à elle (un fichier par worker), puis l'entrée est
 * relue. Invariant : un signal est gardé, ou l'outil répond qu'il ne l'a pas gardé et
 * pourquoi ; aucune écriture ne touche l'entrée d'une autre session, ni ne réécrit un contenu illisible.
 * Un ticket qui passe « doing » réarme le rappel de `workerStartNotice`.
 */
const relaySignal = ($: any, event: RelayEvent): Promise<RelayOutcome> => {
  if (event.kind === 'tickets' && event.changes.some(c => c.status === 'doing')) workerStartReminded = null
  const done = relayQueue.then(() => relaySignalNow($, event))
  relayQueue = done.catch(() => undefined)
  return done
}

const relaySignalNow = async ($: any, event: RelayEvent): Promise<RelayOutcome> => {
  const board: Board | null = await read($, boardAtom)
  const runId = board?.delegate?.run
  if (!runId) return { isKept: false, why: 'this session works for no mission: no "delegate" call is recorded here' }
  // Une mission effacée (S23) : le worker la lâche, son relais ne revient pas.
  await quietly(() => readTraces($))
  if (erasedRuns.has(runId)) return { isKept: false, why: 'the mission was erased' }
  const session = await sessionId($)
  const own = await readOwnEntry($, runId, session)
  if ('why' in own) return { isKept: false, why: own.why }
  // La même revue renvoyée (mêmes comptes, pas d'autre ticket relu) sans changement de statut ni revue lancée depuis :
  // déjà comptée, elle est laissée de côté (jamais comptée deux fois pour un même envoi), avant tout refus : la raison
  // d'un refus ferait renvoyer autrement, ou redonner au compte rendu, une revue déjà comptée. Une revue de sécurité
  // du même appel part seule, et seule elle peut être refusée.
  const counts = event.kind === 'counts' ? event : null
  const isRepeated = counts !== null && isRepeatedReview(own.entry, counts.review)
  const repeated = isRepeated ? { isRepeated: true as const } : {}
  if (isRepeated && !counts?.security) return { isKept: true, ...repeated }
  const sent: RelayEvent = isRepeated && counts ? { kind: 'counts', security: counts.security } : event
  const refusal = relayRefusal(own.entry, sent)
  if (refusal !== null) return { isKept: false, why: refusal.why, isFinal: true, ...(refusal.isReview ? { isReview: true as const } : {}), ...(refusal.isSecurity ? { isSecurity: true as const } : {}), ...repeated }
  // Toujours après l'entrée relue : à la lecture, la plus récente l'emporte, jamais une égalité.
  const now = nextRelayTime(own.entry, await $.clock.now())
  const entry = applyRelayEntry(own.entry, runId, session, sent, now)
  // Rien de neuf (le même compte rendu, un choix déjà gardé) : il est déjà au relais.
  if (!entry) return { isKept: true, ...repeated }
  const where = await writeOwnEntry($, { v: 1, run: runId, session, entry })
  if (!where) return { isKept: false, why: 'the relay could not be written, neither its file nor the store', ...repeated }
  // Relue là où elle vient de s'écrire : un disque qui n'a rien gardé se dit.
  const path = relayEntryPath($, runId, session)
  let back: unknown
  await quietly(async () => {
    if (where === 'file' && path) {
      const found = await readJsonFile($, path)
      back = found?.state === 'read' ? found.value : undefined
    } else back = await $.store.get(relayEntryKey(runId, session))
  })
  // Écrite, mais pas relue : ne pas la faire renvoyer (des comptes s'ajouteraient deux fois).
  if (parseRelayEntryFile(back, runId)?.entry.at !== now)
    return { isKept: false, why: 'it was written, but its relay entry could not be read back to confirm it: do not send it again before the manager checks the relay', isFinal: true, ...repeated }
  // Le fichier voulu ne s'est pas écrit : le store de cette session n'est pas celui d'une discussion
  // principale lancée dans l'autre application (desktop ou CLI), qui ne le lit donc pas.
  // Les tickets que ce signal fait passer « done » depuis un autre statut déjà relayé par cette session : la clôture
  // d'un de ses tickets (un ticket déjà fait, ou d'un autre groupe, qu'une commande ou un fichier relu redit, n'en est pas une).
  const closed = event.kind === 'tickets' ? event.changes.filter(c => { const before = own.entry?.tickets?.[c.id]?.status; return c.status === 'done' && before !== undefined && before !== 'done' }).map(c => c.id) : []
  if (where === 'store' && path) return { isKept: true, note: 'kept only in the store of this session, its relay file could not be written: a manager running in the other app (desktop or CLI) does not read it', ...(closed.length > 0 ? { closed } : {}), ...repeated }
  return { isKept: true, ...(closed.length > 0 ? { closed } : {}), ...repeated }
}

/**
 * Dans un worker, rien ne s'écrit sur la mission : ses mises à jour Asana (tickets), ses
 * commits et ses tests partent au relais, que le manager affiche. Au résultat de l'outil s'ajoutent
 * l'annonce de compaction d'un ticket clos (`workerClosureNotice`) et le rappel du ticket en cours
 * (`workerStartNotice`).
 */
const relayTool = async ($: any, e: any, next: (e: any) => Promise<any>) => {
  const ran = await next(e)
  if (ran.deny !== undefined) return ran
  try {
    const isOk = ran.isError !== true
    // Les tickets que cet outil a fait passer « done » au relais.
    let closed: readonly string[] = []
    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const record = ran.result as { stdout?: unknown; backgroundTaskId?: unknown } | undefined
      if (typeof record?.backgroundTaskId !== 'string') {
        const out = typeof record?.stdout === 'string' ? record.stdout : typeof ran.text === 'string' ? ran.text : ''
        const signals = commandSignals(String(e.command ?? ''), isOk, out)
        // Ni commit ni tests : pas de lecture du relais pour rien.
        if (signals.commit !== undefined || signals.test !== undefined) await relaySignal($, { kind: 'command', ...signals })
      }
      if (isOk) closed = await relayTicketFiles($, ticketFilesIn(String(e.command ?? '')))
    } else if (String(e.tool).endsWith('__update_tasks') && isOk) {
      const kept = await relaySignal($, { kind: 'tickets', changes: asanaChanges(e.tasks) })
      if (kept.isKept) closed = kept.closed ?? []
    } else if ((e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'MultiEdit') && isOk && typeof e.file_path === 'string') {
      // Write porte le texte entier : pas de relecture du fichier.
      closed = await relayTicketFiles($, [e.file_path], e.tool === 'Write' && typeof e.content === 'string' ? e.content : undefined)
    }
    // Un ticket clos au-delà du seuil de compaction d'un worker : Claude le lit après le résultat de l'outil
    // (pas un spécialiste : l'annonce ne vaut que pour le fil principal du worker).
    const notice = closed.length > 0 && e.agentId === undefined ? await workerClosureNotice($, closed) : ''
    // Un fichier du projet modifié sans ticket « en cours » au relais : le rappel de passer le suivant en cours.
    let start = ''
    if ((e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'MultiEdit') && isOk && typeof e.file_path === 'string' && e.agentId === undefined)
      await quietly(async () => {
        start = await workerStartNotice($, e.file_path)
      })
    const notices = [notice, start].filter(n => n !== '')
    if (notices.length > 0) return { ...ran, context: [...(ran.context ?? []), ...notices] }
  } catch {
    // Un signal mal lu ne doit jamais gêner l'outil.
  }
  return ran
}

/** Un fichier de ticket local, `…/issues/<NN>-<nom>.md`, sous `travail/` ou ailleurs (`.scratch/`, par exemple). */
const LOCAL_TICKET_FILE = /(?:^|[\\/])issues[\\/]\d+-[^\\/]+\.md$/

/**
 * Dans un worker, un tracker en fichiers locaux (`…/issues/<NN>-<nom>.md`) n'a pas d'appel
 * Asana à relayer : le statut part au relais quand un outil a touché le fichier d'un ticket, relu
 * tel qu'il est après l'écriture (Edit, Write, ou une commande shell qui le nomme). `written` : le
 * texte entier qu'un Write vient d'écrire, quand il y en a un.
 */
const relayTicketFiles = async ($: any, paths: string[], written?: string): Promise<string[]> => {
  const changes = []
  for (const path of paths) {
    if (!LOCAL_TICKET_FILE.test(path)) continue
    const text = written ?? (await $.fs.read(path).catch(() => null))
    const change = typeof text === 'string' ? localTicketChange(path, text) : null
    if (change) changes.push(change)
  }
  if (changes.length === 0) return []
  // Rend les tickets passés « done » par ce signal (pour la compaction d'un worker à la clôture d'un ticket).
  const kept = await relaySignal($, { kind: 'tickets', changes })
  return kept.isKept ? (kept.closed ?? []) : []
}

/**
 * Dans un worker : une référence du manager plus récente que celle connue
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
  // Relue d'un fichier à côté du relais : échappée, elle se recopie exacte sans rien glisser dans la réponse.
  return `The manager restarted: its reference is now ${asciiJson(next.delegate!.main)} (written by it next to the relay; the one in your brief is out of date). Send your messages there.`
}

/** Dans le manager : relit le relais de la mission active quand un groupe est confié, et notifie les arrêts de worker (`notifyWorkerStops`). */
const pullRelay = async ($: any, board: Board) => {
  const run = activeRun(board)
  const isWatching = run?.groups?.some(g => g.linked !== undefined) ?? false
  const before: Relay | null = await read($, relayAtom)
  const gaps = { count: 0 }
  const stored = run && isWatching ? await readRelay($, run.id, gaps) : undefined
  // Comment s'est passée cette lecture, pour le guet des workers silencieux (`watchSilentWorkers`), avant tout retour.
  relayReadNow = run && isWatching ? { run: run.id, gaps: gaps.count, isAbsent: stored === undefined } : null
  const next = stored !== null && typeof stored === 'object' && (stored as Relay).run === run?.id ? (stored as Relay) : null
  if (JSON.stringify(next) === JSON.stringify(before)) return
  await update($, relayAtom, () => next)
  // Avant le fichier des choix : une écriture qui lève ne doit pas taire un arrêt (la relecture suivante, inchangée, ne le redirait pas).
  if (run && next) await quietly(() => notifyWorkerStops($, run, next))
  await writeDecidedFile($, board)
  $.ui.invalidate('ui.render')
}

/**
 * Dans le manager : un envoi de groupe dont la sortie du lancement n'a pas été lue reçoit la session que son
 * worker a déclarée au relais par son appel `delegate` (`linkRelaySessions`). Jamais dans un worker.
 */
const noteRelaySessions = async ($: any) => {
  const board: Board | null = await read($, boardAtom)
  if (!board || board.delegate) return
  const relay: Relay | null = await read($, relayAtom)
  if (!relay) return
  const now = await $.clock.now()
  await commit($, b => (b.delegate ? null : linkRelaySessions(b, relay, now)))
}

/**
 * Le board du projet de la session : celui de l'état, sinon celui du stockage, sinon un neuf. La racine
 * dont il se charge vient de `missionRoot` : dans un worktree, la discussion garde le board du dépôt principal
 * quand elle y porte la mission active. Null, rien n'étant chargé ni écrit : le fichier du dépôt principal
 * ne se lit pas, une sauvegarde attend encore, ou l'état bouge encore après 3 essais. `isWorker` : l'appel
 * déclare une délégation.
 */
const ensureBoard = async ($: any, isWorker = false, attempt = 0): Promise<Board | null> => {
  const current = await read($, boardAtom)
  const here = await sessionRoot($)
  if (current && (here === '' || normRoot(current.root) === normRoot(here))) return current
  const target = await missionRoot($, here, current, isWorker)
  mainUnread = target === 'unread'
  if (target === 'keep' && current) return current
  if (target === 'unread' || target === 'keep') return null
  // Une délégation en mémoire que le board quitte : aucun appel suivant ne sera plus le premier de la session.
  if (current?.delegate) fableFirstLatch = 'closed'
  // Avant de quitter le board d'une racine pour celui d'une autre : chaque sauvegarde en attente part dans son
  // propre fichier, y compris celle qu'un changement pendant la précédente a programmée. L'état pris ensuite :
  // un commit ou une autre bascule qui le change pendant le chargement n'est pas écrasé.
  let version = (await $.state.get(BOARD_REF)).version
  for (let turn = 0; current && saveTimer !== null && turn < 3; turn++) {
    saveTimer.cancel()
    await saveNow($)
    version = (await $.state.get(BOARD_REF)).version
  }
  // Une sauvegarde attend encore : pas de bascule tant qu'elle n'est pas partie.
  if (current && saveTimer !== null) return null
  const root = target
  const { value: stored, isUnread } = await loadStored($, root)
  const session = await sessionId($)
  // Une seule horloge pour le chargement et le contrôle des traces de suppression qui suit.
  const loadedAt = await $.clock.now()
  // L'id de ce processus : il signe les prises de mission (`Run.claim`) de cette copie.
  const boot = await read($, bootAtom)
  // Le premier chargement de ce processus rend le verdict de la reprise à la relance, sur le fichier lu avant toute
  // écriture ; une lecture ratée ou une autre racine : pas de reprise. Gardé une fois le board posé.
  const verdict: RelaunchVerdict | null = (await read($, relaunchAtom)) !== null ? null : !isUnread && isOwnBoard(stored, root) ? relaunchVerdict(stored, loadedAt, session, boot) : { kind: 'none' }
  const detached =
    isOwnBoard(stored, root)
      ? detachOnLoad(stored, loadedAt, session, boot)
      : { ...emptyBoard(root, root ? projectName(root) : 'projet'), session, deleted: [], ...(boot ? { boot } : {}) }
  // Un stockage illisible : la copie chargée peut être périmée, son mode auto s'éteint.
  const loaded = isUnread ? (stopAutoUnread(detached, await $.clock.now(), await hereId($)) ?? detached) : detached
  // L'auto allumé par cette discussion que ce chargement vient d'éteindre (la pause « discussion arrêtée ») : dit si
  // aucune reprise n'est due.
  const turnedOff = verdict !== null && !isUnread && isOwnBoard(stored, root) ? autoTurnedOffOnLoad(stored, detached, session) : null
  // Un worker retrouve sa délégation, propre à lui et jamais dans le stockage partagé.
  let kept: unknown
  let isKeyRead = false
  await quietly(async () => {
    kept = await $.store.get(delegateKey(session))
    isKeyRead = true
  })
  // Lue sans erreur et vide, avant tout écart (mission finie, délégation ancienne) : sinon un appel suivant pourrait remarquer une délégation perdue.
  const isKeyEmpty = isKeyRead && (kept === null || kept === undefined)
  // Dans un worktree, la mission déléguée vit dans le board du dépôt principal : fini là-bas, la délégation ne revient pas.
  const keptRun = kept !== null && typeof kept === 'object' ? (kept as { run?: unknown }).run : undefined
  if (typeof keptRun === 'string' && !loaded.runs.some(r => r.id === keptRun) && (await mainRepoRun($, keptRun, loaded.root))?.status === 'done') kept = null
  const board = restoreDelegate(loaded, kept, await $.clock.now())
  if (!(await $.state.set(BOARD_REF, board, { ifVersion: version })).isSet) {
    // L'état a bougé pendant le chargement (un commit, une autre bascule) : on repart de lui.
    // Toujours en mouvement après 3 essais : rien plutôt que le board d'une autre racine.
    return attempt < 3 ? ensureBoard($, isWorker, attempt + 1) : null
  }
  keptDelegate = JSON.stringify(board.delegate ?? null)
  if (verdict !== null) await quietly(() => setRelaunchVerdict($, verdict, turnedOff))
  // Le premier chargement ouvre le verrou sur une clé lue vide ; un chargement suivant ne peut que le fermer.
  if (!isKeyEmpty) fableFirstLatch = 'closed'
  else if (fableFirstLatch === 'unset') fableFirstLatch = 'open'
  // Une trace de suppression tombée au chargement (mal formée ou future), lue du fichier commun (pas d'une
  // copie de secours) : le fichier se réécrit sans elle.
  if (!isUnread && isOwnBoard(stored, root) && hasUnsoundTombstones(stored, loadedAt)) scheduleSave($)
  // Une pause que le chargement pose (une active sans titulaire, un doublon de cette discussion) part dans ce
  // fichier : dans un worktree, celui du dépôt principal pris pour la reprise.
  if (!isUnread && here !== '' && !sameRoot(root, here) && isOwnBoard(stored, root) && JSON.stringify(stored.runs.map(r => r.status)) !== JSON.stringify(loaded.runs.map(r => r.status))) scheduleSave($)
  // La mission que cette discussion tenait lui revient (relancée sous son id) : son auto éteint et la prise de ce
  // processus (`Run.claim`) partent au fichier, pour qu'un autre processus de la même discussion la lui laisse. Sur une lecture
  // ratée, rien ne s'écrit d'ici. Sa reprise, quand le verdict la dit due, se tente juste après le chargement
  // (`tryRelaunchResume`) ; une pause que la relance laisse (pas de reprise, allumage raté, reprise encore due à la
  // première relecture) se dit après le chargement, jamais pendant lui (`watchRelaunchPause`).
  const keptId = loaded.activeId
  if (!isUnread && isOwnBoard(stored, root) && keptId !== null && JSON.stringify(stored.runs.find(r => r.id === keptId)) !== JSON.stringify(loaded.runs.find(r => r.id === keptId))) scheduleSave($)
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

/**
 * Le board enregistré, et si le stockage ne s'est pas lu (`isUnread`, voir `loadStored`) ;
 * `isTrimmed` : une trace de suppression y est tombée à la lecture (mal formée ou future), le fichier
 * est à réécrire sans elle.
 */
const readStored = async ($: any, root: string): Promise<{ board: Board | null; isUnread: boolean; isTrimmed: boolean }> => {
  const { value, isUnread } = await loadStored($, root)
  if (!isOwnBoard(value, root)) return { board: null, isUnread, isTrimmed: false }
  const now = await $.clock.now()
  // Seulement lue du fichier commun : une copie de secours ne fait pas réécrire un fichier qui ne s'est pas lu.
  return { board: clampFuture(value, now), isUnread, isTrimmed: !isUnread && hasUnsoundTombstones(value, now) }
}

/**
 * Le stockage est partagé par toutes les discussions du projet : on y fusionne sa copie au lieu
 * de l'écraser, et la discussion récupère au passage les missions des autres.
 */
const saveOnce = async ($: any): Promise<boolean> => {
  saveTimer = null
  const { value, version } = await $.state.get(BOARD_REF)
  if (!value) return false
  const { board: stored, isUnread } = await readStored($, value.root)
  // Le stockage ne s'est pas lu : ce qui s'écrit (fusionné, peut-être avec une copie de secours
  // périmée) a son mode auto éteint, puisque l'écriture remplace un fichier qu'on n'a pas lu.
  // La copie d'ici est ramenée à maintenant comme la copie relue : une date future de l'auto, prise
  // avant un recalage de l'horloge, gagnerait sinon la fusion sur une coupure posée après elle.
  const now = await $.clock.now()
  const local = clampFuture(value, now)
  // Pour chaque mission dont l'auto est allumé d'ici (`isAutoLitBy`), seules les traces écrites ici retirent une marque ou une question.
  const fused = stored ? mergeBoards(local, stored, await ownTracesFor($, value)) : local
  const kept = isUnread ? (stopAutoUnread(fused, now, await hereId($)) ?? fused) : fused
  // Le titulaire du siège du COO se montre à chaque écriture, sur le siège relu à l'instant (jamais sur un fichier illisible).
  const shown = isUnread || kept.cooHere === undefined ? null : refreshSeat(kept.coo, await hereId($), now)
  const merged = shown ? { ...kept, coo: shown } : kept
  const isDurable = await saveStored($, value.root, merged)
  await writeDecidedFile($, merged)
  // Si l'état a bougé entre-temps, la prochaine sauvegarde refusionnera, et notifiera alors.
  const isSet = merged === value || (await $.state.set(BOARD_REF, merged, { ifVersion: version })).isSet
  // Une pause que l'écriture pose (lecture ratée, copie abîmée) sur la mission portée ici, notifiée une fois écrite.
  if (isSet) await afterAuto($, value, merged, true)
  return isDurable && !isUnread
}

/**
 * Les sauvegardes, une à la fois et dans l'ordre : une sauvegarde partie avant la marque d'un envoi de
 * l'auto (lue avant elle) n'écrit plus le fichier après la sienne, ce qui l'en retirerait.
 */
let saveChain: Promise<unknown> = Promise.resolve()
const saveNow = ($: any): Promise<boolean> => {
  const next = saveChain.then(
    () => saveOnce($),
    () => saveOnce($),
  )
  saveChain = next.catch(() => undefined)
  return next
}

/** Le board réduit à la mission active ici : seule la discussion qui le porte notifie ce qu'une fusion lui fait. */
const carried = (board: Board): Board => ({ ...board, runs: board.runs.filter(r => r.id === board.activeId) })

/**
 * Lit ce que les autres discussions ont enregistré, sans rien écrire dans le stockage (sauf une
 * sauvegarde programmée quand une trace de suppression y est tombée à la lecture) ; rejoué si
 * l'état a bougé entre la lecture et l'écriture. Faux quand le stockage ne se lit pas : l'auto s'éteint
 * alors ici (la relecture avant un envoi de l'auto n'envoie rien).
 */
const pull = async ($: any): Promise<boolean> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { value, version } = await $.state.get(BOARD_REF)
    if (!value) return false
    const { board: stored, isUnread, isTrimmed } = await readStored($, value.root)
    // Une trace de suppression tombée à la lecture : le fichier se réécrit sans elle, sinon une lecture
    // plus tardive, l'horloge rattrapant sa date, l'appliquerait.
    if (isTrimmed) scheduleSave($)
    // Rien de relu et une lecture ratée : l'auto s'éteint quand même ici, comme à la sauvegarde.
    if (!stored && !isUnread) return true
    // Relu d'un stockage de secours, peut-être périmé, quand le fichier ne se lit pas : l'auto s'éteint.
    const now = await $.clock.now()
    const fused = stored ? mergeBoards(clampFuture(value, now), stored, await ownTracesFor($, value)) : value
    const merged = isUnread ? (stopAutoUnread(fused, now, await hereId($)) ?? fused) : fused
    // Le siège du COO tenu ici manque au fichier (une écriture croisée l'a recouvert d'une prise plus
    // ancienne) : il s'y réécrit tout de suite, sinon l'ancien titulaire se croirait encore au siège.
    if (!isUnread && stored && merged.cooHere !== undefined && seatState(merged.coo, await hereId($), now) === 'mine' && isSeatBehind(stored.coo, merged.coo)) await saveNow($)
    if (JSON.stringify(merged) === JSON.stringify(value)) return !isUnread
    if ((await $.state.set(BOARD_REF, merged, { ifVersion: version })).isSet) {
      await afterAuto($, value, merged, true)
      return !isUnread
    }
  }
  return false
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
      // Avant `afterAuto` : un arrêt de l'auto dans ce même changement oublie aussi ces traces.
      await quietly(() => recordOwnTraces($, value, out.board))
      await afterAuto($, value, out.board)
      await quietly(() => wakeWaiting($, value, out.board))
      return out.fx
    }
  }
  return null
}

// ─── Siège du COO ─────────────────────────────────────────────────────────
//
// Une discussion devient le COO du projet par `/flow-board:coo` (ou « ◆ COO » au bandeau d'accueil) :
// elle prend le siège, un champ du fichier des missions (`hooks/seat.ts`). Chaque écriture du siège
// relit d'abord le fichier : une discussion qui l'a perdu n'écrit plus rien comme COO.

/** Le skill qui fait d'une discussion le COO du projet. */
export const COO_SKILL = `${SELF}:coo`
/** Le skill qui allume la surveillance de nuit, tapé par la personne dans la discussion du COO. */
const NIGHT_SKILL = `${SELF}:nuit`

/** Une écriture du siège : prise (siège libre ou déjà ici), reprise (« ↻ Reprendre ici »), rafraîchissement, libération. */
type SeatWrite = 'take' | 'retake' | 'refresh' | 'release'

/**
 * Écrit le siège du COO, relu juste avant dans le fichier des missions, jamais depuis la mémoire :
 * rien quand le fichier ne se lit pas (`unread`), ni quand le siège n'est plus à cette discussion
 * (rafraîchissement, libération) ou qu'une autre le tient (prise sans « Reprendre ici »). Rend l'état
 * du siège vu d'ici après l'écriture.
 */
export const writeSeat = async ($: any, kind: SeatWrite): Promise<{ isWritten: boolean; state: 'mine' | 'other' | 'free' | 'unread' }> => {
  const board = await ensureBoard($)
  if (!board) return { isWritten: false, state: 'unread' }
  const { board: stored, isUnread } = await readStored($, board.root)
  if (isUnread) return { isWritten: false, state: 'unread' }
  const now = await $.clock.now()
  // Une fin de discussion relit l'id du moment, celui d'avant un éventuel /clear compris.
  const here = kind === 'release' ? await freshHereId($) : await hereId($)
  const local: Board | null = await read($, boardAtom)
  const current = mergeSeat(local?.coo, stored?.coo)
  const state = seatState(current, here, now)
  const next =
    kind === 'refresh'
      ? refreshSeat(current, here, now)
      : kind === 'release'
        ? releaseSeat(current, here, now)
        : state === 'mine'
          ? refreshSeat(current, here, now)
          : kind === 'retake' || state === 'free'
            ? takeSeat(here, now)
            : null
  // Une prise refusée (siège tenu ailleurs) note quand même la demande d'ici : le bandeau propose « ↻ Reprendre ici ».
  if (!next) {
    if (kind === 'take') {
      await commit($, b => (b.cooHere === here ? null : { board: { ...b, cooHere: here }, fx: noFx() }))
      await keepCooHere($, here)
    }
    return { isWritten: false, state }
  }
  await commit($, b => ({ board: { ...b, coo: mergeSeat(mergeSeat(b.coo, current), next), ...(kind === 'release' ? {} : { cooHere: here }) }, fx: noFx() }))
  if (kind !== 'release') await keepCooHere($, here)
  const isSaved = await saveNow($)
  const after: Board | null = await read($, boardAtom)
  const seen = seatState(after?.coo, here, await $.clock.now())
  if (seen === 'mine') seatWasMine = true
  return { isWritten: isSaved, state: isSaved ? seen : 'unread' }
}

/** Le siège était à cette discussion à la dernière relecture : sa perte se dit une fois. */
let seatWasMine = false

/**
 * Toutes les 5 s, après la relecture du fichier (`isRead` : elle a réussi) : le titulaire se montre au
 * moins toutes les 5 minutes ; une discussion qui vient de perdre le siège le dit une fois et n'écrit plus
 * rien comme COO. Après un redémarrage, une discussion qui tient encore le siège (même id,
 * `--continue`) le retrouve. Le titulaire y relit aussi la feuille de route et la table des numéros courts, où il
 * attribue ce qui manque ; hors du siège, la table gardée en mémoire s'oublie.
 */
const watchSeat = async ($: any, isRead: boolean) => {
  await restoreCooHere($)
  if (isRead) await quietly(() => markNamedOnLoad($))
  const board: Board | null = await read($, boardAtom)
  if (!board || board.delegate) {
    numbersNow = null
    if (clearSeatReads()) $.ui.invalidate('ui.render')
    return
  }
  const now = await $.clock.now()
  const here = await hereId($)
  const state = seatState(board.coo, here, now)
  if (state === 'mine') {
    if (board.cooHere !== here) await commit($, b => ({ board: { ...b, cooHere: here }, fx: noFx() }))
    seatWasMine = true
    const seat = soundSeat(board.coo)
    // Muet plus de 10 minutes (plantage puis reprise, mise en veille) : sa surveillance de nuit ne reprend pas avec le siège rafraîchi.
    // Un arrêt qui n'a pas pu s'écrire laisse le siège sans rafraîchissement : il se réessaie, et le siège finit libre plutôt que la surveillance réanimée.
    const isGapHeld = isRead && seat !== undefined && isSeatGap(seat, now) && (await stopNight($, 'gap').catch(() => 'failed' as const)) === 'failed'
    if (isRead && seat && !isGapHeld && now - seat.seenAt >= SEAT_REFRESH_MS) await writeSeat($, 'refresh')
    // La feuille de route relue toutes les 5 s par le titulaire (siège relu après son rafraîchissement) : une disparition paraît dans la vue.
    const fresh: Board | null = isRead ? await read($, boardAtom) : null
    if (fresh !== null && seatState(fresh.coo, here, await $.clock.now()) === 'mine' && !activeRun(fresh)) {
      const before = JSON.stringify(roadmapNowCache)
      roadmapNowCache = await readRoadmap($, fresh, true)
      // La table des numéros relue, et ce qui y manque attribué : à la même veille, par le seul titulaire.
      const numbersBefore = JSON.stringify(numbersNow)
      await quietly(() => attributeNumbers($, fresh))
      // La date de fin des workers qui retiennent, relue au relais comme la nuit : la marque « à forcer » et ses minutes.
      const deadBefore = deadPrint
      await readDeadSince($, fresh)
      // Le signal de vie de chaque mission ouverte, relu à la même veille (la marque « discussion arrêtée »).
      const isLivenessChanged = await refreshLiveness($, claudeHome($), fresh, await $.clock.now())
      if (JSON.stringify(roadmapNowCache) !== before || JSON.stringify(numbersNow) !== numbersBefore || deadPrint !== deadBefore || isLivenessChanged) $.ui.invalidate('ui.render')
    } else if (clearSeatReads()) $.ui.invalidate('ui.render')
    return
  }
  numbersNow = null
  // Sans relecture, une date gardée vieillirait jusqu'à « à forcer » : le siège perdu ou le fichier illisible l'effacent.
  if (clearSeatReads()) $.ui.invalidate('ui.render')
  // Sans le siège, une confirmation de « Changer l'endroit » ne reste jamais en attente : elle se redemande au retour.
  whereAsk = false
  // Une mission ouverte ici alors que le siège est ailleurs : la discussion ne demande plus le siège.
  if (board.cooHere !== undefined && activeRun(board)) await leaveCooHere($)
  if (!seatWasMine) return
  seatWasMine = false
  $.ui.toast(state === 'other' ? '◆ Le siège du COO n’est plus tenu par cette discussion : elle n’écrit plus rien comme COO (↻ Reprendre ici).' : '◆ Le siège du COO est libre : cette discussion n’écrit plus rien comme COO (↻ Reprendre ici).')
  $.ui.invalidate('ui.render')
}

/**
 * Ce que Claude lit avec chaque message d'une discussion qui a demandé le siège du COO, d'après le siège
 * relu à l'instant (`isRead` : la relecture a réussi) ; rien dans une discussion qui porte une mission.
 */
const seatContext = (board: Board, here: string, now: number, isRead: boolean): string | null => {
  if (board.delegate || board.cooHere === undefined || activeRun(board)) return null
  if (!isRead) return `COO seat (flow-board): the missions file could not be read, so the seat is unknown. Write nothing as COO until it reads again, and tell the user: « ${SEAT_UNREAD} »`
  if (seatState(board.coo, here, now) === 'mine') return 'COO seat (flow-board): held by this discussion. You are the COO of this project: follow the /flow-board:coo instructions.'
  return 'COO seat (flow-board): NOT held by this discussion (another discussion holds it, it was released, or this discussion was cleared). Write nothing as COO: no roadmap, no coordination entry, no relayed decision, no launch. Tell the user that « ↻ Reprendre ici » in the band takes the seat back.'
}

/**
 * « ↻ Reprendre ici » relance le skill du COO avec cet argument (ses consignes reviennent à Claude) : son
 * tour, reconnu à `prompt.submit` même mis en file derrière un tour long, arme la reprise, que le
 * chargement du skill consomme.
 */
const RETAKE_ARG = 'reprendre'
let isRetakeArmed = false

/**
 * Le délai avant chacune des deux relectures du siège qu'on vient de prendre : une prise presque
 * simultanée d'une autre discussion, écrite ou réécrite (`pull` la réécrit aussitôt quand le fichier l'a
 * perdue), y est alors arrivée.
 */
const SEAT_SETTLE_MS = 1500

/** La demande du siège du COO gardée par discussion (`$.store`) : retrouvée après un redémarrage (`--continue`). */
const cooHereKey = (session: string): string => `coo-here:${session}`
const cooHereChecked = new Set<string>()

/** Après un redémarrage, une discussion qui avait demandé le siège le retrouve : elle saura dire qu'elle l'a perdu. */
const restoreCooHere = async ($: any) => {
  const board: Board | null = await read($, boardAtom)
  if (!board || board.delegate || board.cooHere !== undefined) return
  const here = await hereId($)
  if (cooHereChecked.has(here)) return
  cooHereChecked.add(here)
  let kept: unknown
  await quietly(async () => {
    kept = await $.store.get(cooHereKey(here))
  })
  if (kept === true) await commit($, b => (b.cooHere !== undefined ? null : { board: { ...b, cooHere: here }, fx: noFx() }))
}

/** Les discussions dont la marque « nommée par flow-board » a déjà été posée ou vérifiée au chargement, dans ce processus. */
const namedChecked = new Set<string>()

/**
 * Au chargement : une discussion dont le tableau montre une mission titrée née chez elle reçoit sa marque si elle ne
 * l'a pas (`claimName` ne réécrit jamais une marque déjà là) ; une fois par discussion et par processus, une fois la
 * marque posée ou lue présente (une lecture ratée se refait à la relecture suivante), à partir de la première
 * relecture qui montre une telle mission (une relecture qui n'en montre pas encore, le fichier pas encore rattrapé,
 * laisse revérifier à la suivante, sans rien lire du magasin). Jamais dans un worker.
 */
const markNamedOnLoad = async ($: any) => {
  const board: Board | null = await read($, boardAtom)
  const session = board?.session
  if (!board || board.delegate || !session || namedChecked.has(session)) return
  const titled = board.runs.find(r => r.bornIn === session && r.isTitled)
  if (!titled) return
  // Vérifiée une fois la marque posée (ou déjà là, de ce titre ou d'un autre) : une lecture ratée se refait à la relecture suivante.
  if ((await claimName($, session, titled.title, await $.clock.now())) || (await markState($, session)) === 'present') namedChecked.add(session)
}

/**
 * Cette discussion ne demande plus le siège (« Laisser », ou une mission ouverte ici alors qu'elle ne le
 * tient pas) : elle redevient une discussion ordinaire ; le siège, tenu ailleurs ou libre, n'est pas touché.
 */
const leaveCooHere = async ($: any) => {
  const board: Board | null = await read($, boardAtom)
  const here = await hereId($)
  if (!board || board.cooHere === undefined || seatState(board.coo, here, await $.clock.now()) === 'mine') return
  const asked = board.cooHere
  await commit($, b => (b.cooHere === undefined ? null : { board: (({ cooHere: _gone, ...rest }) => rest)(b) as Board, fx: noFx() }))
  for (const id of new Set([asked, here])) await quietly(() => $.store.set(cooHereKey(id), false))
  $.ui.invalidate('ui.render')
}

/** Garde la demande du siège de cette discussion, pour la retrouver après un redémarrage. */
const keepCooHere = async ($: any, here: string) => {
  cooHereChecked.add(here)
  await quietly(() => $.store.set(cooHereKey(here), true))
}

// ─── Feuille de route du COO ──────────────────────────────────────────────
//
// Le Claude du COO l'écrit ; le mod ne l'écrit jamais (il n'écrit dans aucun projet). Il la relit, garde
// chaque entrée vue avec sa dernière version (jamais effacée) et montre en alerte une entrée qui
// disparaît. Invariant : « La feuille de route ne perd jamais une entrée sans ta décision ; une
// disparition est montrée et se répare. » Ce qu'il en garde (où elle vit, les entrées vues) est dans un
// fichier du poste, partagé par l'app et le terminal ; à défaut (dossier de Claude inconnu), `$.store`.

/**
 * Le nom des fichiers d'un projet sur ce poste : un nom lisible et l'empreinte de sa racine, casse
 * comprise, pour que deux projets aux noms voisins (ou qui ne diffèrent que par la casse) ne partagent rien.
 */
export const coordinationName = (root: string): string => {
  const norm = normRoot(root)
  const slug = norm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(-60) || 'sans-projet'
  let hash = 0x811c9dc5
  for (const ch of norm) hash = Math.imul(hash ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0
  return `${slug}-${hash.toString(16).padStart(8, '0')}`
}

/** Le fichier du poste où le mod garde la feuille de route d'un projet : où elle vit, les entrées vues ; null sans dossier de Claude. */
const roadmapStatePath = ($: any, root: string): string | null => {
  const home = claudeHome($)
  return home ? `${home}/flow-board/coordination/${coordinationName(root)}.feuille-de-route.json` : null
}
const roadmapStoreKey = (root: string): string => `coo-roadmap:${normRoot(root)}`

/**
 * Ce que le mod garde de la feuille de route d'un projet : le choix de la personne, les entrées vues, la date du relevé
 * unique de l'existant (`gleanedAt`) et celle de la fin de la demande unique pour les discussions des missions archivées
 * sans marque (`unmarkedAt`, son repère : posé, la demande ne revient jamais), et les titres que le COO a écrits pour les
 * entrées « À reprendre » (`titles`, chacun lié à l'empreinte du texte pour lequel il a été écrit).
 */
type RoadmapState = { where?: 'repo' | 'poste'; seen: RoadmapSeen; gleanedAt?: number; unmarkedAt?: number; titles?: RoadmapTitles }

/**
 * Relit ce qui est gardé : `unread` quand la lecture rate (rien ne s'écrit alors par-dessus) ; `broken`,
 * avec le texte relu, quand il ne se lit pas comme un état de ce projet (une écriture coupée, un fichier
 * vide, une retouche, une autre racine) : le titulaire le met de côté tel quel et repart d'un état neuf, qui
 * garde seulement l'endroit encore lisible en tête d'un texte coupé (`where`, `cutStateWhere`) ; `aside`,
 * quand une partie seulement est hors forme : les entrées en forme et le choix restent, et le texte
 * entier est mis de côté.
 */
const loadRoadmapState = async ($: any, root: string): Promise<(RoadmapState & { aside?: string }) | 'unread' | { broken: string; where?: 'repo' | 'poste' }> => {
  let raw: unknown
  let text = ''
  try {
    const path = roadmapStatePath($, root)
    if (path) {
      if (!(await $.fs.exists(path))) return { seen: {} }
      text = String(await $.fs.read(path))
      // Un fichier vide (vidé puis jamais réécrit) est une écriture coupée, pas un état jamais écrit : il part de côté.
      if (text === '') return { broken: '' }
    } else raw = await $.store.get(roadmapStoreKey(root))
  } catch {
    return 'unread'
  }
  if (text !== '') {
    try {
      raw = JSON.parse(text)
    } catch {
      // Coupé : l'endroit encore lisible en tête, exactement comme écrit, est gardé ; le texte part de côté quand même.
      const where = cutStateWhere(text, normRoot(root))
      return { broken: text, ...(where ? { where } : {}) }
    }
  }
  // Un fichier qui ne porte que « null » ne porte aucun état : une écriture coupée ou vidée, mise de côté comme un fichier vide.
  if (raw === null && text !== '') return { broken: text }
  if (raw === undefined || raw === null) return { seen: {} }
  const x = raw as { root?: unknown; where?: unknown; seen?: unknown; gleanedAt?: unknown; unmarkedAt?: unknown; titles?: unknown }
  const isOwn = typeof raw === 'object' && !Array.isArray(raw) && (x.root === undefined || (typeof x.root === 'string' && normRoot(x.root) === normRoot(root)))
  if (!isOwn) return { broken: text || JSON.stringify(raw) }
  const { seen, isWhole } = partialSeen(x.seen)
  // Un titre hors forme est écarté, comme une entrée vue hors forme : l'état entier se met de côté, les titres en forme restent.
  const titled = partialTitles(x.titles)
  const isWhereSound = x.where === undefined || x.where === 'repo' || x.where === 'poste'
  return {
    ...(x.where === 'repo' || x.where === 'poste' ? { where: x.where } : {}),
    seen,
    ...(typeof x.gleanedAt === 'number' && Number.isFinite(x.gleanedAt) && x.gleanedAt >= 0 ? { gleanedAt: x.gleanedAt } : {}),
    // Le repère de la demande unique : un nombre fini positif ; hors forme, il se lit absent (la demande revient) ; une date future se lit posée.
    ...(typeof x.unmarkedAt === 'number' && Number.isFinite(x.unmarkedAt) && x.unmarkedAt > 0 ? { unmarkedAt: x.unmarkedAt } : {}),
    ...(Object.keys(titled.titles).length > 0 ? { titles: titled.titles } : {}),
    ...(isWhole && isWhereSound && titled.isWhole ? {} : { aside: text || JSON.stringify(raw) }),
  }
}

/** Les écritures de ce qui est gardé, une à la fois et dans l'ordre : chacune relit la précédente. */
let roadmapSaveChain: Promise<unknown> = Promise.resolve()

/**
 * Écrit ce qui est gardé, relu juste avant : les entrées vues s'unissent (rien n'est jamais retiré), le
 * choix ne change que s'il est donné, les titres gardés passent à travers chaque écriture (un titre donné
 * remplace celui du même id). Un état hors forme est d'abord mis de côté, copié tel quel à côté
 * (jamais effacé), puis l'écriture repart d'un état neuf, avec l'endroit encore lisible en tête d'un texte coupé.
 */
const saveRoadmapState = ($: any, root: string, change: { seen?: RoadmapSeen; where?: 'repo' | 'poste'; gleanedAt?: number; unmarkedAt?: number; titles?: RoadmapTitles }): Promise<boolean> => {
  const run = async (): Promise<boolean> => {
    const loaded = await loadRoadmapState($, root)
    if (loaded === 'unread') return false
    const path = roadmapStatePath($, root)
    const kept = 'broken' in loaded ? loaded.broken : loaded.aside
    if (kept !== undefined) {
      const aside = path ? `${path}.illisible-${await $.clock.now()}` : null
      try {
        if (aside) await $.fs.write(aside, kept)
        else await $.store.set(`${roadmapStoreKey(root)}:illisible:${await $.clock.now()}`, kept)
      } catch {
        return false
      }
    }
    const now: RoadmapState = 'broken' in loaded ? { ...(loaded.where ? { where: loaded.where } : {}), seen: {} } : { ...(loaded.where ? { where: loaded.where } : {}), seen: loaded.seen, ...(loaded.gleanedAt !== undefined ? { gleanedAt: loaded.gleanedAt } : {}), ...(loaded.unmarkedAt !== undefined ? { unmarkedAt: loaded.unmarkedAt } : {}), ...(loaded.titles ? { titles: loaded.titles } : {}) }
    const where = change.where ?? now.where
    const titles = { ...(now.titles ?? {}), ...(change.titles ?? {}) }
    // Le relevé de l'existant et la demande unique, faits une fois : leur date se garde (la plus ancienne).
    const gleanedAt = now.gleanedAt ?? change.gleanedAt
    const unmarkedAt = now.unmarkedAt ?? change.unmarkedAt
    const next = { v: 1, root: normRoot(root), ...(where ? { where } : {}), seen: change.seen ? unionSeen(now.seen, change.seen) : now.seen, ...(gleanedAt !== undefined ? { gleanedAt } : {}), ...(unmarkedAt !== undefined ? { unmarkedAt } : {}), ...(Object.keys(titles).length > 0 ? { titles } : {}) }
    try {
      if (path) await $.fs.write(path, JSON.stringify(next))
      else await $.store.set(roadmapStoreKey(root), next)
      return true
    } catch {
      return false
    }
  }
  const next = roadmapSaveChain.then(run, run)
  roadmapSaveChain = next.catch(() => undefined)
  return next
}

// ─── Réglage « revue de sécurité » du projet ──────────────────────────────
//
// Gardé sur le poste, à part du fichier des missions (aucune fusion, reconstruction ni effacement de
// mission n'y touche), sous la racine du dépôt principal : un worker lit la même valeur que son manager.
// Seul le clic de la bascule l'écrit ; il se relit à chaque rendu et avant chaque décision, sans valeur gardée.
// Son dossier est celui du dossier personnel de la personne (`securityHome`), jamais celui de l'emplacement du
// mod ni `$.store` : toutes ses discussions sur ce poste lisent le même fichier, quel que soit le mod qui le lit
// (installé, chargé par `--plugin-dir` depuis un worktree, autre `CLAUDE_CONFIG_DIR`), et un réglage absent y
// vaut donc partout « désactivée » (le défaut) sans qu'une activation faite ailleurs passe inaperçue.

/**
 * La racine du dépôt comme clé, sans la casse : un worktree peut voir `c:/proj` quand son dépôt principal
 * voit `C:/proj` (le fichier des missions compare aussi ses racines sans la casse).
 */
const securityRootKey = (root: string): string => normRoot(root).toLowerCase()

/**
 * Le dossier du réglage : `.claude` du dossier personnel de la personne, `USERPROFILE` puis `HOME` (l'ordre de
 * Claude Code sous Windows, et de `claudeDir`), chaque variable lue à part ; null quand aucune ne se lit (le
 * réglage vaut alors « activée » et le clic refuse).
 */
const securityHome = async ($: any): Promise<string | null> => {
  // `$.env.get` veut un nom littéral : chaque variable a son appel, et une variable qui lève n'emporte pas l'autre.
  const env = async (read: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      const value = await read()
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    } catch {
      return undefined
    }
  }
  const home = (await env(() => $.env.get('USERPROFILE'))) ?? (await env(() => $.env.get('HOME')))
  const dir = home?.replace(/\\/g, '/').replace(/\/+$/, '')
  return dir ? `${dir}/.claude` : null
}

/**
 * Le fichier du réglage d'un projet, sous `<dossier>/flow-board/coordination/` et nommé par `coordinationName`
 * de la racine sans la casse (son empreinte diffère donc de celle de la feuille de route).
 */
const securitySettingPath = (dir: string, root: string): string => `${dir}/flow-board/coordination/${coordinationName(securityRootKey(root))}.revue-securite.json`


/**
 * Après une lecture ratée, le fichier du réglage est-il vraiment absent ? Seul ce cas vaut « jamais réglé ».
 * `$.fs.exists` répond faux aussi sur un droit refusé ou un dossier devenu fichier, et la forme de l'erreur
 * n'est pas documentée : on liste le dossier le plus proche qui se liste, sans remonter au-dessus du dossier du
 * réglage (`dir`), et l'absent est celui que ce dossier ne contient pas. Présent mais illisible, ou aucun dossier
 * listable : pas absent (une lecture ratée, qui vaut « activée »).
 */
export async function isSettingMissing($: any, dir: string, path: string): Promise<boolean> {
  if (!path.startsWith(`${dir}/`)) return false
  const parts = path.split('/')
  for (let at = parts.length - 1; at > dir.split('/').length - 1; at--) {
    const parent = parts.slice(0, at).join('/')
    let names: string[]
    try {
      names = ((await $.fs.list(parent)) as { name: string }[]).map(x => x.name)
    } catch {
      continue
    }
    return !names.includes(parts[at]!)
  }
  return false
}

/** La racine du dépôt principal, clé du réglage ; null pour un projet hors git, `error` quand le moteur ne répond pas. */
const mainRepoRoot = async ($: any): Promise<string | null | 'error'> => {
  try {
    const root = String((await $.session.repo())?.root ?? '')
    return root === '' ? null : root
  } catch {
    return 'error'
  }
}

/**
 * Le réglage lu à l'instant, la racine qui le porte (absente quand le moteur ne dit pas le dépôt) et son fichier
 * (absent quand le dossier personnel ne se lit pas : une lecture ratée). Jamais d'écriture.
 */
const loadSecuritySetting = async ($: any): Promise<SecuritySettingRead & { root?: string; path?: string }> => {
  const root = await mainRepoRoot($)
  if (root === 'error') return { review: 'unread', why: 'read' }
  if (root === null) return { review: 'unread', why: 'repo' }
  const dir = await securityHome($)
  if (dir === null) return { review: 'unread', why: 'read', root }
  const path = securitySettingPath(dir, root)
  let stored: SecurityStored
  try {
    stored = { kind: 'text', text: String(await $.fs.read(path)) }
  } catch {
    if (!(await isSettingMissing($, dir, path))) return { review: 'unread', why: 'read', root }
    stored = { kind: 'absent' }
  }
  return { ...parseSecuritySetting(stored, other => sameRoot(other, root)), root, path }
}

/** L'état du réglage pour une décision ou un dessin : `unread` vaut « activée ». */
const securityReviewNow = async ($: any): Promise<SecurityReview> => (await loadSecuritySetting($)).review

/** Les écritures du réglage, une à la fois. */
let securitySaveChain: Promise<unknown> = Promise.resolve()

/**
 * Le clic de la bascule : relit le réglage et pose l'état visé (celui que montrait le libellé, inversé). Une
 * lecture qui lève refuse sans rien écrire ; un texte hors forme est d'abord copié à côté (jamais effacé) ;
 * un réglage déjà dans l'état visé ne s'écrit pas. Rend le toast à montrer, à texte fixe.
 */
const toggleSecuritySetting = ($: any, to: 'on' | 'off'): Promise<string> => {
  const run = async (): Promise<string> => {
    const loaded = await loadSecuritySetting($)
    const root = loaded.root
    const path = loaded.path
    // Un projet hors git n'a pas de clé : son réglage ne se garde pas, et la revue y reste activée.
    if (loaded.review === 'unread' && loaded.why === 'repo') return '⛨ Ce projet n’a pas de dépôt git : son réglage ne se garde pas, la revue de sécurité y reste activée.'
    if (root === undefined || path === undefined || (loaded.review === 'unread' && loaded.why !== 'form')) return '⛨ Le réglage de la revue de sécurité ne se lit pas : rien n’est changé, réessaie.'
    if (loaded.review === to) return to === 'on' ? '⛨ La revue de sécurité est déjà activée pour ce projet : rien n’est changé.' : '⛨ La revue de sécurité est déjà désactivée pour ce projet : rien n’est changé.'
    // L'état que garde un échec : celui qu'on montrait (une lecture hors forme se montre activée).
    const kept = loaded.review === 'off' ? '⛨ Réglage non enregistré : la revue de sécurité reste désactivée.' : '⛨ Réglage non enregistré : la revue de sécurité reste activée.'
    const now = await $.clock.now()
    if (loaded.review === 'unread' && loaded.why === 'form') {
      try {
        // Une copie déjà là sous ce nom (même milliseconde) n'est jamais écrasée : un suffixe la distingue.
        let aside = `${path}.illisible-${now}`
        for (let n = 2; await $.fs.exists(aside); n++) {
          if (n > 20) return kept
          aside = `${path}.illisible-${now}-${n}`
        }
        await $.fs.write(aside, loaded.text)
      } catch {
        return kept
      }
    }
    const record = securitySettingRecord(normRoot(root), to, now)
    try {
      await $.fs.write(path, JSON.stringify(record))
    } catch {
      return kept
    }
    return to === 'on' ? '⛨ Revue de sécurité activée pour ce projet, sur ce poste.' : '⛨ Revue de sécurité désactivée pour ce projet, sur ce poste.'
  }
  const next = securitySaveChain.then(run, run)
  securitySaveChain = next.catch(() => undefined)
  return next
}

/** Le geste de la bascule, d'où qu'il vienne (vue du COO, ligne de sécurité d'un groupe ou du lot). */
const securityToggle = async ($: any, to: 'on' | 'off') => {
  let text = '⛨ Le réglage de la revue de sécurité ne se lit pas : rien n’est changé, réessaie.'
  try {
    text = await toggleSecuritySetting($, to)
  } catch {
    // Le toast par défaut le dit ; rien ne remonte au bouton.
  }
  $.ui.toast(text)
  $.ui.invalidate('ui.render')
}

/** Le chemin de la feuille de route : sous `travail/` du projet si la personne l'a choisi, sinon sur ce poste. */
const roadmapPath = ($: any, root: string, where: CooRoadmap['where']): string | null => {
  if (where === 'repo') return root === '' ? null : `${root.replace(/[\\/]+$/, '')}/travail/feuille-de-route.md`
  const home = claudeHome($)
  return home ? `${home}/flow-board/coordination/${coordinationName(root)}.feuille-de-route.md` : null
}

/** La feuille de route relue à l'instant, et ses disparitions face aux entrées déjà vues. */
let roadmapNowCache: CooRoadmap | null = null
/** La date de fin du worker de chaque groupe qui retient, relue à la veille du siège (`readDeadSince`), jamais à un dessin. */
let deadSinceNow: (mission: string, group: string) => number | undefined = () => undefined
/** Ce que la vue en montre (les minutes écoulées de chaque retenue datée) : un changement redessine. */
let deadPrint = ''
/**
 * Relit les dates de fin des workers qui retiennent, par la lecture de la nuit (`deadSinceOf`), pour toutes les missions
 * attendues, en mode strict (un fichier de relais qui ne se lit pas : aucune date pour sa mission) ; une lecture ratée les efface.
 */
const readDeadSince = async ($: any, board: Board) => {
  try {
    const views = nightViewsOf(board, { waveDue: () => [], forces: id => forcesFor(coordLive, id), plans: id => planWaitsOf(coordLive, id) })
    // Chaque mission attendue, ouverte ou non : le relevé porte la date de chaque retenue ; la marque exige « ouverte nulle part ».
    const dead = await deadSinceOf($, board, views.flatMap(v => v.holds.map(h => h.mission)), true)
    const now = await $.clock.now()
    deadSinceNow = dead
    deadPrint = JSON.stringify(views.flatMap(v => v.holds.map(h => dead(h.mission, h.group))).map(at => (at === undefined ? null : Math.floor((now - at) / 60_000))))
  } catch {
    clearDeadSince()
  }
}

/** Efface les dates de fin et les verdicts du signal de vie gardés pour la vue ; vrai quand il y en avait. */
const clearSeatReads = (): boolean => {
  const hadDead = clearDeadSince()
  return clearLiveness() || hadDead
}

/** Efface les dates gardées ; vrai quand il y en avait. */
const clearDeadSince = (): boolean => {
  const had = deadPrint !== ''
  deadSinceNow = () => undefined
  deadPrint = ''
  return had
}

/** Le fichier existe-t-il ? null quand la question n'a pas de réponse. */
const fileExists = async ($: any, path: string): Promise<boolean | null> => {
  try {
    return Boolean(await $.fs.exists(path))
  } catch {
    return null
  }
}

/**
 * Relit la feuille de route : lecture, comparaison avec les entrées vues, et ajout de celles-ci, seulement
 * depuis une lecture bien formée et par le titulaire du siège (`isMine`, relu par l'appelant juste avant).
 * Une lecture ratée (le fichier, ou ce qui est gardé) ne montre rien et n'écrit rien ; un état gardé hors
 * forme est mis de côté par le titulaire, et la surveillance repart.
 */
const readRoadmap = async ($: any, board: Board, isMine: boolean): Promise<CooRoadmap> => {
  const roadmap = await readRoadmapFile($, board, isMine)
  // Relues après la mise de côté qu'a pu faire cette lecture : la copie neuve se signale tout de suite.
  const asides = await roadmapAsides($, board.root)
  return asides.length > 0 ? { ...roadmap, asides } : roadmap
}

/**
 * Les copies de l'état gardé mises de côté (B8), jamais effacées : les fichiers `.illisible-<date>` à côté
 * de son fichier du poste, ou les clés `…:illisible:<date>` de `$.store` sans dossier de Claude. Une lecture
 * ratée ne rend rien (aucune ligne fausse) et ne bloque rien.
 */
const roadmapAsides = async ($: any, root: string): Promise<string[]> => {
  try {
    const path = roadmapStatePath($, root)
    if (path) {
      const cut = path.lastIndexOf('/')
      const dir = path.slice(0, cut)
      const prefix = `${path.slice(cut + 1)}.illisible-`
      const names = ((await $.fs.list(dir)) as { name?: unknown }[]).map(x => x?.name).filter((n): n is string => typeof n === 'string' && n.startsWith(prefix))
      return names.sort().map(n => `${dir}/${n}`)
    }
    const prefix = `${roadmapStoreKey(root)}:illisible:`
    return ((await $.store.keys()) as unknown[]).filter((k): k is string => typeof k === 'string' && k.startsWith(prefix)).sort()
  } catch {
    return []
  }
}

const readRoadmapFile = async ($: any, board: Board, isMine: boolean): Promise<CooRoadmap> => {
  let loaded = await loadRoadmapState($, board.root)
  if (loaded !== 'unread' && ('broken' in loaded || loaded.aside !== undefined) && isMine && (await saveRoadmapState($, board.root, {}))) loaded = await loadRoadmapState($, board.root)
  if (loaded === 'unread' || 'broken' in loaded) return { where: 'unasked', path: '', read: 'unread', gone: [] }
  const state = loaded
  const where: CooRoadmap['where'] = state.where ?? 'unasked'
  const path = roadmapPath($, board.root, where)
  // Nulle part où la garder sur ce poste (dossier de Claude inconnu) : la question de l'endroit reste posée.
  if (path === null) return { where, path: '', read: null, gone: [] }
  const isThere = await fileExists($, path)
  if (isThere === null) return { where, path, read: 'unread', gone: [] }
  let read: Roadmap | null = null
  if (isThere) {
    try {
      read = parseRoadmap(String(await $.fs.read(path)))
    } catch {
      return { where, path, read: 'unread', gone: [] }
    }
  }
  // L'autre endroit a un fichier : l'ancien après un changement choisi (à recopier si le nouveau manque),
  // ou, sans choix ici, une feuille de route déjà commitée dans le projet (choisie sur un autre poste).
  const other = roadmapPath($, board.root, where === 'repo' ? 'poste' : 'repo')
  const isOtherThere = other !== null && other !== path && (await fileExists($, other)) === true
  const previous = isOtherThere && read === null && where !== 'unasked' ? other : undefined
  const committed = isOtherThere && where === 'unasked' && other === roadmapPath($, board.root, 'repo') ? other : undefined
  // Gardée sur le poste alors qu'un fichier existe dans travail/ du projet (un retour du dépôt, ou un fichier commité
  // depuis un autre poste) : la page « Réglages » le dit.
  const isRepoLeft = isOtherThere && where === 'poste'
  const watched = watchRoadmap(state.seen, read ?? { ok: true, entries: [] }, await $.clock.now())
  if (isMine && read !== null && read.ok && JSON.stringify(watched.seen) !== JSON.stringify(state.seen)) await saveRoadmapState($, board.root, { seen: watched.seen })
  const known = read !== null && !read.ok ? Object.entries(state.seen).map(([id, v]) => ({ id, line: v.line, section: v.section, seenAt: v.seenAt })) : undefined
  return { where, path, read, gone: watched.gone, ...(watched.goneTexts.length > 0 ? { goneTexts: watched.goneTexts } : {}), ...(known ? { known } : {}), ...(previous ? { previous } : {}), ...(committed ? { committed } : {}), ...(isRepoLeft ? { isRepoLeft } : {}), ...(state.titles ? { titles: state.titles } : {}) }
}

/**
 * Les demandes au Claude du COO que font les boutons de la vue : textes fixes, l'id d'une entrée contrôlé,
 * sa section (une liste fermée), sa dernière version en chaîne JSON ; le commit seulement quand la feuille
 * de route vit dans le projet.
 */
export const roadmapAsk = (d: CooDo, r: CooRoadmap | null): string | null => {
  if (d.kind === 'security' || d.kind === 'where' || d.kind === 'where-ask' || d.kind === 'where-cancel' || d.kind === 'where-confirm' || d.kind === 'coord-fresh' || d.kind === 'numbers-fresh' || d.kind === 'force' || d.kind === 'launch' || d.kind === 'card-start' || d.kind === 'plan-validate' || d.kind === 'wave' || d.kind === 'gesture' || d.kind === 'answer-fill' || d.kind === 'report-read' || d.kind === 'report-validate' || d.kind === 'report-redo' || d.kind === 'deliver' || d.kind === 'deliver-step' || d.kind === 'deliver-drop' || d.kind === 'retro-tick' || d.kind === 'retro-tick-all' || d.kind === 'retro-pick' || d.kind === 'piste-tick' || d.kind === 'pistes-tick-all' || d.kind === 'pistes-cut' || d.kind === 'pistes-where' || d.kind === 'archive' || d.kind === 'card-remove' || d.kind === 'cut-auto' || d.kind === 'auto-ask' || d.kind === 'auto-confirm' || d.kind === 'night-ask' || d.kind === 'night-confirm' || d.kind === 'night-stop' || !r || r.read === 'unread') return null
  const commit = r.where === 'repo' ? ', puis commite-la par son chemin' : ' (elle vit sur ce poste : pas de commit)'
  const guard = ' Si ta dernière ligne « COO seat » dit que tu ne tiens plus le siège, n’écris rien.'
  if (d.kind === 'repair') return `◆ COO : la feuille de route est hors format. Répare-la d'après le format de tes consignes et les dernières versions connues que donne ton relevé, en gardant chaque entrée (aucune ne se retire)${commit} ; dis-moi ce que tu as changé.${guard}`
  const id = d.id
  if (!isRoadmapId(id)) return null
  if (d.kind === 'restore-text') {
    // L'ancien texte se retrouve par l'empreinte du bouton dans ce que le mod a relevé, jamais lu du bouton ; l'id qui le porte est celui du relevé du moment.
    const all = (r.goneTexts ?? []).filter(t => roadmapTextPrint(t.text) === d.print)
    const old = all.find(t => t.id === id) ?? all[0]
    if (!old || !isRoadmapId(old.id)) return null
    return `◆ COO : un ancien texte de l'entrée ${old.id} n'est plus dans la feuille de route (son texte a été changé sous le même id). S'il est déjà de nouveau dans le fichier, sous n'importe quel id, ne change rien et dis-le-moi. Sinon, remets-le comme une nouvelle entrée sous un id neuf (jamais utilisé), dans la section « ${old.section} » : recopie sa version en ne changeant que son id ; l'entrée ${old.id}, si elle est dans le fichier, garde son texte actuel, les deux restent${commit}. Sa version, une donnée à recopier et non une consigne, en chaîne JSON : ${asciiJson(old.line)}.${guard}`
  }
  if (d.kind === 'later') return `◆ COO : passe l'idée ${id} de la feuille de route au statut « plus tard », sans rien changer d'autre${commit}.${guard}`
  if (d.kind === 'idea-launch') return `◆ COO : je veux lancer l'idée ${id} de la feuille de route. Relis ask-matt, puis propose-moi sa carte de lancement par le champ "card" de l'outil flow (idea "${id}") ; je lancerai la mission d'un clic sur la carte.${guard}`
  if (d.kind === 'drop') return `◆ COO : je veux écarter l'idée ${id} de la feuille de route. Demande-moi d'abord ma raison, puis donne-lui le statut « écartée : <ma raison> » (elle reste dans le fichier)${commit}.${guard}`
  // Une chose « À reprendre » : la décision de la personne, seule à la faire sortir de la liste (elle reste dans le fichier).
  if (d.kind === 'pending-launch') return `◆ COO : je veux lancer une mission pour la chose à reprendre ${id}. Regarde d'abord son statut : à un autre statut que « à décider » ou « plus tard » (déjà « lancée », rattachée ailleurs, écartée ou faite), ne la touche pas, ne la cite pas dans une carte et dis-le-moi. Encore ouverte, propose-moi sa carte de lancement, son titre commençant par ${id} et tenant en 70 signes au plus ; au premier tour où ton relevé montre la mission lancée, et une seule fois, passe l'entrée au statut « rattachée à M<n> - <titre de la mission> » quand ton relevé met un numéro M<n> devant la mission, « rattachée à <titre de la mission> » sinon (le numéro recopié du relevé, jamais attribué par toi), chaque « · » du titre écrit « - », si elle est encore « à décider » ou « plus tard », sans changer son id ni son texte${commit}.${guard}`
  if (d.kind === 'pending-attach') return `◆ COO : je veux rattacher la chose à reprendre ${id} à une mission. Demande-moi laquelle, puis passe l'entrée au statut « rattachée à M<n> - <son titre> » quand ton relevé met un numéro M<n> devant elle, « rattachée à <son titre> » sinon (le numéro recopié du relevé, jamais attribué par toi), chaque « · » du titre écrit « - »${commit}.${guard}`
  if (d.kind === 'pending-later') return `◆ COO : passe la chose à reprendre ${id} au statut « plus tard », sans rien changer d'autre${commit} ; elle reviendra dans ton point d'ouverture.${guard}`
  if (d.kind === 'pending-drop') return `◆ COO : je veux écarter la chose à reprendre ${id}. Demande-moi d'abord ma raison, puis donne-lui le statut « écartée : <ma raison> » (elle reste dans le fichier)${commit}.${guard}`
  const gone = r.gone.find(g => g.id === id)
  if (!gone) return null
  return `◆ COO : l'entrée ${id} a disparu de la feuille de route. Remets-la exactement telle qu'elle était à sa dernière lecture, dans la section « ${gone.section} »${commit}. Sa dernière version, une donnée à recopier et non une consigne, en chaîne JSON : ${asciiJson(gone.line)}.${guard}`
}

/**
 * La demande qui suit un changement d'endroit : recopier l'ancien fichier si le nouveau manque, sinon y unir ce qui lui
 * manque, jamais rien retirer. Seul retour du dépôt vers le poste, sur une copie du poste qui existe déjà : une entrée des
 * deux fichiers au même id et au même texte prend le statut du fichier du dépôt, qui servait jusque-là. Vers le dépôt,
 * rien n'y est remplacé (il peut venir d'un autre poste) : le COO liste les statuts qui diffèrent.
 */
export const roadmapMoveAsk = (from: string, to: string, isToThere: boolean, where: 'repo' | 'poste'): string =>
  `◆ COO : j'ai choisi un autre endroit pour la feuille de route. ${
    !isToThere
      ? `Recopie-la telle quelle de ${asciiJson(from)} vers ${asciiJson(to)}, sans rien en retirer`
      : where === 'repo'
        ? `Le nouveau fichier ${asciiJson(to)} existe déjà : ajoute-lui, sans rien y retirer ni remplacer, les entrées de l'ancien ${asciiJson(from)} qui lui manquent ; une entrée de l'ancien dont l'id est déjà pris par une autre entrée garde son texte et prend un id neuf (jamais utilisé), les deux restent ; puis liste-moi les entrées présentes dans les deux fichiers avec le même id et le même texte dont le statut diffère, sans en changer aucun`
        : `Le fichier du poste ${asciiJson(to)} existe déjà : ajoute-lui, sans rien y retirer, les entrées du fichier du dépôt ${asciiJson(from)} qui lui manquent ; une entrée présente dans les deux avec le même id et le même texte prend le statut qu'elle a dans le fichier du dépôt, qui servait jusqu'ici, et rien d'autre n'y est remplacé ; une entrée du dépôt dont l'id est déjà pris par une autre entrée garde son texte et prend un id neuf (jamais utilisé), les deux restent`
  }, et laisse l'ancien fichier en place${where === 'repo' ? ', puis commite la nouvelle par son chemin' : ''}. Si ta dernière ligne « COO seat » dit que tu ne tiens plus le siège, n’écris rien.`

/** Un geste de la vue Coordination, par le seul titulaire du siège, relu juste avant ; seulement quand Claude est au repos. */
const cooDo = async ($: any, d: CooDo) => {
  // La bascule de la revue de sécurité n'écrit que son réglage : ni tour fermé ni siège requis.
  if (d.kind === 'security') {
    await securityToggle($, d.to)
    return
  }
  // « Arrêter » la surveillance de nuit ne fait qu'éteindre : il vaut aussi pendant un tour, et le siège se relit dans l'arrêt.
  if (d.kind === 'night-stop') {
    $.ui.toast(NIGHT_STOP_TOAST[await stopNight($, 'button')])
    $.ui.invalidate('ui.render')
    return
  }
  if (isTurnOpen) {
    $.ui.toast('◆ Claude travaille : reclique quand il a fini son tour.')
    return
  }
  const isRead = await pull($)
  const board: Board | null = await read($, boardAtom)
  if (!isRead || !board || seatState(board.coo, await hereId($), await $.clock.now()) !== 'mine') {
    $.ui.toast(`◆ ${isRead ? 'Cette discussion ne tient plus le siège du COO : rien n’est fait.' : SEAT_UNREAD}`)
    return
  }
  if (d.kind === 'force') {
    const out = await requestForce($, d)
    $.ui.toast(out)
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'wave') {
    $.ui.toast(await launchWave($, d.key))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'gesture') {
    $.ui.toast(await requestGesture($, d))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'cut-auto') {
    $.ui.toast(await requestCutClick($, d.mission))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'night-ask') {
    // Le premier clic (ou « Annuler ») : rien ne s'écrit, la vue montre « Confirmer » et « Annuler », ou les retire.
    nightAsk = !nightAsk
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'night-confirm') {
    // Le second clic ne vaut qu'après le premier.
    const asked = nightAsk
    nightAsk = false
    if (asked) $.ui.toast(nightClickToast(await startNight($, 'click')))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'where-ask' || d.kind === 'where-cancel') {
    // Le premier clic, ou « Annuler » : rien ne s'écrit, la page montre « Confirmer » et « Annuler », ou les retire (deux
    // gestes distincts : un double clic ou un dessin périmé ne retourne jamais l'état).
    whereAsk = d.kind === 'where-ask'
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'auto-ask') {
    // Le premier clic (ou « Annuler ») : rien ne s'écrit, la ligne montre « Confirmer » et « Annuler », ou les retire.
    cooAutoAsk = cooAutoAsk === d.mission ? null : d.mission
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'auto-confirm') {
    // Le second clic ne vaut que pour la mission dont le premier a montré « Confirmer ».
    const asked = cooAutoAsk
    cooAutoAsk = null
    if (asked === d.mission) $.ui.toast(await requestAutoOn($, d.mission))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'answer-fill') {
    const run = board.runs.find(r => r.id === d.mission)
    const title = neutralInPrompt(clip(run?.title ?? '', 60))
    // L'empreinte du texte affiché et l'id de la mission voyagent avec la réponse : le Claude du COO les renvoie tels quels.
    await fillRequest($, `Réponse à la question ${asciiJson(d.question)} de la mission « ${title} » (id ${asciiJson(d.mission)}, texte lu ${isPrint(d.print) ? d.print : 'inconnu'}) : `, '◆ Écris ta réponse, puis Entrée : le COO l’écrira dans le DECISIONS.md de la mission.', '◆ Écris ta réponse au COO : il l’écrira dans le DECISIONS.md de la mission.')
    return
  }
  if (d.kind === 'deliver' || d.kind === 'deliver-step' || d.kind === 'deliver-drop') {
    const toast = d.kind === 'deliver' ? await requestDelivery($, d.key) : d.kind === 'deliver-drop' ? await dropDelivery($) : await deliveryGesture($, d.gesture)
    if (toast !== '') $.ui.toast(toast)
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'report-read') {
    toggleReport(d.mission, d.print)
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'report-validate') {
    $.ui.toast(await requestValidate($, d.mission, d.print))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'report-redo') {
    const run = board.runs.find(r => r.id === d.mission)
    await fillRequest($, reportRedoFill(d.mission, run?.title ?? ''), '◆ Dis ce qui ne va pas dans le rapport, puis Entrée : le COO l’écrira dans le DECISIONS.md de la mission.', '◆ Écris au COO ce qui ne va pas dans le rapport : il l’écrira dans le DECISIONS.md de la mission.')
    return
  }
  if (d.kind === 'plan-validate') {
    $.ui.toast(await validatePlan($, d.key))
    $.ui.invalidate('ui.render')
    return
  }
  // La liste des cartes illisible : un clic sur une carte ou un découpage ne fait rien, et le dit (C3, C8).
  if ((d.kind === 'launch' || d.kind === 'card-start' || d.kind === 'card-remove' || d.kind === 'pistes-cut') && !(await cardsOrNull($))) return void $.ui.toast('◆ Rien n’est fait : la liste des cartes ne se lit pas.')
  if (d.kind === 'launch') {
    $.ui.toast(await launchCard($, d.card, d.mode, d.at))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'card-start') {
    $.ui.toast(await changeCardStart($, d.card, d.start))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'card-remove') {
    const card = (await cardsHere($)).find(c => c.id === d.card)
    $.ui.toast(card && isPistesCard(card) ? await removePistesCard($, d.card) : card && isOrdinaryCard(card) ? await removeLaunchCard($, d.card, d.at) : await removeRetroCard($, d.card))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'piste-tick') {
    // Seulement une piste « pas encore validée » de la liste relue : la case d'une autre ne se coche pas.
    const piste = cooWaitlistOf()?.pistes.find(p => p.id === d.piste)
    // Cochée sous le texte montré, elle se décoche ; une coche d'un texte changé depuis (montrée vide) se refait sur le texte montré.
    if (piste && pistesTicks.get(d.piste) === piste.history.length) pistesTicks.delete(d.piste)
    else if (piste?.state === 'pending') pistesTicks.set(d.piste, piste.history.length)
    else pistesTicks.delete(d.piste)
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'pistes-tick-all') {
    // Comme un clic sur chaque case vide montrée, sans rien décocher : seulement une piste « pas encore validée » de la liste relue.
    for (const id of d.pistes) {
      const piste = cooWaitlistOf()?.pistes.find(p => p.id === id)
      if (piste?.state === 'pending') pistesTicks.set(id, piste.history.length)
    }
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'pistes-cut') {
    $.ui.toast(await cutPistes($, d.print))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'pistes-where') {
    $.ui.toast(await chooseWaitlistWhere($, d.where))
    // Relue tout de suite à son nouvel endroit : la vue et le relevé suivent le choix.
    await quietly(() => applyWaitlist($))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'archive') {
    $.ui.toast(await archiveDelivered($, d.ids, d.print))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'retro-tick' || d.kind === 'retro-tick-all') {
    const p = cooRetroPicksOf(board).find(x => x.retro === d.retro)
    const ticks = new Set(retroTicks.get(d.retro) ?? [])
    if (d.kind === 'retro-tick-all') for (const i of p?.items ?? []) ticks.add(i.id)
    else if (ticks.has(d.item)) ticks.delete(d.item)
    else if (p?.items.some(i => i.id === d.item)) ticks.add(d.item)
    retroTicks.set(d.retro, ticks)
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'retro-pick') {
    $.ui.toast(await recordPick($, d.retro, d.print))
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'coord-fresh') {
    const out = await writeCoordination($, () => [], true)
    $.ui.toast(out === 'ok' ? '◆ Fichier de coordination neuf : la copie de l’ancien reste à côté.' : out === 'none' ? '◆ Le fichier de coordination se lit de nouveau : rien n’est changé.' : `◆ Rien n’est fait : ${coordWriteWhy(out)}`)
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'numbers-fresh') {
    const out = await freshNumbers($)
    $.ui.toast(out === 'ok' ? '◆ Table des numéros neuve : la copie de l’ancienne reste à côté ; des missions peuvent avoir changé de numéro.' : out === 'none' ? '◆ La table des numéros n’est plus hors forme : rien n’est changé.' : out === 'not-seat' ? '◆ Cette discussion ne tient plus le siège du COO : rien n’est fait.' : out === 'board-unread' ? `◆ ${SEAT_UNREAD}` : '◆ Rien n’est fait : la copie de l’ancienne table ou la table neuve n’a pas pu s’écrire, réessaie.')
    $.ui.invalidate('ui.render')
    return
  }
  if (d.kind === 'where' || d.kind === 'where-confirm') {
    // Le premier choix (page « À faire ») reste à un clic, et seulement lui ; un changement ne vaut qu'au second clic,
    // « Confirmer » après « Changer l'endroit », et vers l'autre endroit. Une lecture ou une écriture ratée laisse la
    // confirmation en attente ; elle ne se consomme qu'au changement fait ou refusé. Un seul choix à la fois : deux clics
    // en vol décidaient tous deux sur le même état d'avant.
    if (whereBusy) {
      $.ui.toast('◆ Un choix d’endroit est déjà en cours : rien de plus n’est changé.')
      return
    }
    whereBusy = true
    try {
      await placeChoice($, board, d)
    } finally {
      whereBusy = false
    }
    return
  }
  const text = roadmapAsk(d, roadmapNowCache)
  if (text === null) {
    $.ui.toast('◆ Rien à demander : relis la vue.')
    return
  }
  submitCooAsk($, text)
}

/** Le choix d'endroit de la feuille de route, un seul à la fois (`whereBusy`) : sa garde, son écriture, la demande de recopie. */
const placeChoice = async ($: any, board: Board, d: { kind: 'where' | 'where-confirm'; where: 'repo' | 'poste' }) => {
  const isAsked = whereAsk
  const before = await readRoadmap($, board, true)
  if (before.read === 'unread') {
    $.ui.toast('◆ La feuille de route ne se lit pas : rien n’est changé, réessaie.')
    $.ui.invalidate('ui.render')
    return
  }
  const refusal = wherePlaceRefusal(d.kind, isAsked, before.where, d.where)
  if (refusal !== null) {
    // Un premier choix périmé refusé ne retire pas une confirmation en attente qu'il ne visait pas.
    if (d.kind === 'where-confirm') whereAsk = false
    $.ui.toast(refusal === 'same' ? '◆ Rien n’est changé : la feuille de route est déjà à cet endroit ; relis la page.' : '◆ Rien n’est changé : l’endroit se change depuis la page « Réglages », par « Changer l’endroit » puis « Confirmer ».')
    $.ui.invalidate('ui.render')
    return
  }
  // Une écriture qui lève a pu écrire sa tête : l'état relu (sans rien écrire ni mettre de côté ici) dit ce qui a changé.
  if (!(await saveRoadmapState($, board.root, { where: d.where }))) {
    const again = await loadRoadmapState($, board.root)
    const outcome = failedPlaceWrite(again === 'unread' ? 'unread' : again.where, d.where, before.where)
    if (outcome !== 'changed') {
      $.ui.toast(outcome === 'lost' ? '◆ L’écriture a été coupée et l’endroit choisi s’est perdu : choisis-le de nouveau.' : '◆ La feuille de route ne se lit pas : rien n’est changé, réessaie.')
      $.ui.invalidate('ui.render')
      return
    }
  }
  whereAsk = false
  roadmapNowCache = await readRoadmap($, board, true)
  // Revenue sur le poste après le dépôt, elle a été commitée : le message ne dit plus « jamais commitée ».
  $.ui.toast(d.where === 'repo' ? '◆ Feuille de route : elle vivra sous travail/ de ce projet.' : before.where === 'repo' ? '◆ Feuille de route : gardée sur ce poste ; le fichier de travail/ et son historique git restent.' : '◆ Feuille de route : gardée sur ce poste, jamais commitée.')
  $.ui.invalidate('ui.render')
  // L'ancien fichier existe : le Claude du COO le recopie, ou l'unit au nouveau qui existe déjà (l'ancien reste). L'endroit
  // est déjà changé : une demande qui n'entre pas ne se reclique pas (un clic de plus ramènerait l'endroit d'avant).
  if (before.read !== null && before.path !== '' && roadmapNowCache.path !== '' && before.path !== roadmapNowCache.path) {
    submitCooAsk($, roadmapMoveAsk(before.path, roadmapNowCache.path, roadmapNowCache.read !== null, d.where), '◆ L’endroit est changé, mais la demande de recopie n’est pas partie : ne reclique pas, demande au COO dans le chat de recopier la feuille de route à son nouvel endroit.')
  }
}

/** Envoie une demande au Claude du COO (l'appelant a vérifié que Claude est au repos) et dit quand elle n'entre pas (`missed`, « reclique » par défaut). */
const submitCooAsk = ($: any, text: string, missed = '◆ La demande n’est pas partie : reclique.') => {
  void (async () => {
    let isIn = false
    await quietly(async () => {
      const r = await $.prompt.submit({ text })
      isIn = r !== null && typeof r === 'object' && typeof r.text === 'string' && r.drop === undefined
    })
    if (!isIn) $.ui.toast(missed)
  })()
}

/** Le texte que reçoit Claude au chargement de `/flow-board:coo`, après la prise (ou le refus) du siège. */
const cooOpening = async ($: any): Promise<string> => {
  const board = await ensureBoard($)
  if (!board) return 'COO seat: the dashboard is unavailable, nothing was taken. Tell the user to try again.'
  if (board.delegate) return 'This discussion is a worker of a mission: it cannot be the COO, nothing was taken. Tell the user to open the COO in another discussion.'
  const run = activeRun(board)
  if (run) return `This discussion carries the mission ${neutralInPrompt(run.title)}: the COO never carries a mission, nothing was taken. Tell the user to open the COO in a discussion without a mission (« ◆ COO » in its band), or to set this mission aside first (/flow pause).`
  // La racine de la session, pas celle du board : une discussion qui garde dans un worktree le fichier du dépôt principal n'y est pas à sa racine.
  if (await isOutsideProjectRoot($, (await sessionRoot($)) || board.root)) return 'This discussion does not run at the root of the main working tree of the project (a worktree, or a subfolder): the COO opens there only, so that the project has one seat. Nothing was taken. Tell the user to open it there.'
  const isRetake = isRetakeArmed
  isRetakeArmed = false
  const out = await writeSeat($, isRetake ? 'retake' : 'take')
  if (out.state === 'unread') return `COO seat: ${SEAT_UNREAD} Tell the user so, in these words, and act as COO only once the seat is taken.`
  if (out.state === 'other') return 'COO seat: held by another live discussion of this project, nothing was taken. Do not act as COO here. Tell the user that « ↻ Reprendre ici » in the band takes the seat (the other discussion then stops writing as COO).'
  if (out.state !== 'mine') return 'COO seat: it could not be taken (the dashboard changed meanwhile). Do not act as COO here; tell the user to run /flow-board:coo again.'
  // Une prise d'une autre discussion presque en même temps : relue deux fois un peu après (le temps que
  // l'autre relise et réécrive sa prise), la plus récente l'emporte.
  let isRead = true
  for (let round = 0; round < 2; round++) {
    await $.clock.sleep(SEAT_SETTLE_MS)
    isRead = (await pull($)) && isRead
  }
  const settled: Board | null = await read($, boardAtom)
  if (!isRead) return 'COO seat: written, but the missions file could not be read again to confirm it. Do not act as COO yet: the seat line of the next message says whether this discussion holds it.'
  if (seatState(settled?.coo, await hereId($), await $.clock.now()) !== 'mine') return 'COO seat: another discussion took it at the same moment and holds it now. Do not act as COO here. Tell the user that « ↻ Reprendre ici » in the band takes it.'
  return `COO seat: held by this discussion. You are now the COO of this project.\n\n${await cooStatementFor($, settled!)}`
}

// ─── Fichier de coordination ──────────────────────────────────────────────
//
// Le canal du COO vers les managers (`hooks/coordination.ts`) : un fichier du poste par projet, écrit
// par le seul titulaire du siège, relu juste avant chaque écriture ; le mod de chaque manager le relit
// toutes les 5 s et applique lui-même ce qui vise sa mission, une fois (ids notés dans `$.store`).
// Une entrée part avec sa mission : sa trace d'effacement (`run:<id>`, posée par « Supprimer ») ou sa
// pierre tombale, la mission absente du fichier des missions bien relu.

/** Le fichier de coordination d'un projet sur ce poste ; null sans dossier de Claude (`$.store` alors). */
const coordinationPath = ($: any, root: string): string | null => {
  const home = claudeHome($)
  return home ? `${home}/flow-board/coordination/${coordinationName(root)}.json` : null
}
const coordinationStoreKey = (root: string): string => `coo-coordination:${normRoot(root)}`

/** La raison d'une lecture ratée du fichier de coordination (rien ne dit alors qu'il existe). */
const READ_FAILED = 'the file could not be read'

/** Relit le fichier de coordination ; `unread` quand la lecture rate ou que le texte ne se lit pas comme le fichier de ce projet. */
const readCoordination = async ($: any, root: string): Promise<CoordRead & { text?: string }> => {
  let text: string
  try {
    const path = coordinationPath($, root)
    if (path) {
      if (!(await $.fs.exists(path))) return { state: 'absent' }
      text = String(await $.fs.read(path))
    } else {
      const raw = await $.store.get(coordinationStoreKey(root))
      if (raw === undefined || raw === null) return { state: 'absent' }
      text = JSON.stringify(raw)
    }
  } catch {
    return { state: 'unread', why: READ_FAILED }
  }
  return { ...parseCoordination(text, normRoot(root)), text }
}

/** Les missions effacées, vues à l'instant : leur trace (`run:<id>`) ou leur pierre tombale. */
const erasedRunsOf = async ($: any, boards: readonly (Board | null | undefined)[]): Promise<Set<string>> => {
  const out = new Set<string>()
  await quietly(async () => {
    for (const t of await readTraces($)) if (t.id.startsWith('run:')) out.add(t.id.slice(4))
  })
  for (const b of boards) for (const t of b?.deleted ?? []) out.add(t.id)
  return out
}

/** Ce que le COO sait du fichier : sa lecture, la copie gardée d'un fichier illisible, le nombre d'entrées. */
export type CoordState = { state: CoordRead['state']; aside?: string; count: number }
let coordNow: CoordState | null = null
/** Les entrées vivantes que le COO a relues à l'instant (ses forçages comptent dans les retenues qu'il montre). */
let coordLive: CoordEntry[] = []

/**
 * La copie d'un fichier illisible, gardée à côté et jamais supprimée : une par texte relu, sur le poste
 * (`.illisible-<date>`), ou dans `$.store` sans dossier de Claude (clé `…:illisible:<date>`). Rend où elle
 * est, ou undefined quand ce texte n'a pas pu être copié (rien de relu, écriture ratée).
 */
const keepCoordAside = async ($: any, root: string, text: string | undefined): Promise<string | undefined> => {
  if (text === undefined) return undefined
  if (coordAside?.text === text) return coordAside.place
  const now = await $.clock.now()
  const path = coordinationPath($, root)
  const place = path ? `${path}.illisible-${now}` : `${coordinationStoreKey(root)}:illisible:${now}`
  try {
    if (path) await $.fs.write(place, text)
    else await $.store.set(place, text)
  } catch {
    return undefined
  }
  coordAside = { text, place }
  return place
}
let coordAside: { text: string; place: string } | null = null

/** Le siège relu juste avant une écriture du COO : le fichier des missions, avec la copie d'ici ; jamais depuis la mémoire seule. */
export async function seatForWrite($: any): Promise<{ ok: true; local: Board; stored: Board | null } | { ok: false; why: 'unread' | 'not-seat' }> {
  const local = await ensureBoard($)
  if (!local) return { ok: false, why: 'unread' }
  const { board: stored, isUnread } = await readStored($, local.root)
  if (isUnread) return { ok: false, why: 'unread' }
  if (seatState(mergeSeat(local.coo, stored?.coo), await hereId($), await $.clock.now()) !== 'mine') return { ok: false, why: 'not-seat' }
  return { ok: true, local, stored }
}

// ─── Table des numéros courts ─────────────────────────────────────────────
//
// La table des numéros du COO (`hooks/numbers.ts`) : un fichier du poste à côté du fichier de coordination
// (à défaut `$.store`), écrit par le seul titulaire du siège, le siège relu avant et après, une écriture à la
// fois, chacune relisant la table juste avant ; elle ne fait que s'allonger. Le titulaire y attribue à chaque
// veille de son siège, et le dessin comme le relevé lisent la table gardée en mémoire (`numbersNow`), qui
// n'avance que sur une lecture ou une écriture réussie : un numéro n'est montré que s'il est écrit.

/** La table d'un projet ; null sans dossier de Claude (`$.store` alors). */
const numbersPath = ($: any, root: string): string | null => {
  const home = claudeHome($)
  return home ? `${home}/flow-board/coordination/${coordinationName(root)}.numeros.json` : null
}
const numbersStoreKey = (root: string): string => `coo-numbers:${normRoot(root)}`

/** Relit la table : absente, lue, lecture ratée, ou hors forme ; le texte relu va avec (copie de « Repartir d'une table neuve »). */
const readNumbers = async ($: any, root: string): Promise<NumberRead & { text?: string }> => {
  let text: string
  try {
    const path = numbersPath($, root)
    if (path) {
      // `exists` répond faux aussi sur un droit refusé : seule une absence que confirme le plus proche dossier listable sous celui de
      // Claude (le dossier de coordination peut ne pas exister encore) vaut table vide ; sinon, une lecture ratée (rien n'est réécrit).
      if (!(await $.fs.exists(path))) return (await isSettingMissing($, claudeHome($)!, path)) ? { state: 'absent' } : { state: 'unread' }
      text = String(await $.fs.read(path))
    } else {
      const raw = await $.store.get(numbersStoreKey(root))
      if (raw === undefined || raw === null) return { state: 'absent' }
      text = JSON.stringify(raw)
    }
  } catch {
    return { state: 'unread' }
  }
  const table = parseNumberTable(text, normRoot(root))
  return table ? { state: 'read', table, text } : { state: 'bad', text }
}

/** La table telle que le titulaire l'a relue ou écrite en dernier ; null hors du siège ou avant la première veille. */
let numbersNow: NumberRead | null = null
let numbersChain: Promise<unknown> = Promise.resolve()

/** Écrit une table, sur le poste ou dans `$.store` ; false quand l'écriture rate. */
const putNumbers = async ($: any, root: string, table: NumberTable): Promise<boolean> => {
  try {
    const path = numbersPath($, root)
    if (path) await $.fs.write(path, JSON.stringify(table))
    else await $.store.set(numbersStoreKey(root), table)
    return true
  } catch {
    return false
  }
}

/** La table relue, telle que la mémoire la garde (sans le texte relu). */
const numbersKept = (got: NumberRead): NumberRead => (got.state === 'read' ? { state: 'read', table: got.table } : { state: got.state })

/**
 * À la veille du siège du titulaire (`fresh`, le fichier des missions qu'elle vient de relire) : la table relue (gardée
 * en mémoire), puis, s'il manque des numéros aux cartes d'ici ou aux missions de cette relecture, une écriture par le
 * seul titulaire : le siège relu, la table relue juste avant, l'attribution refaite sur elle et sur les deux copies du
 * fichier des missions, le siège relu encore juste avant l'écriture (une mission que seule la copie du fichier porte
 * se numérote dès que la relecture de la veille la fusionne). Une table illisible ou hors forme n'est jamais réécrite ; une écriture
 * ratée laisse en mémoire la table relue, sans les nouvelles attributions, qui se refont à la veille suivante.
 */
const attributeNumbers = ($: any, fresh: Board): Promise<'ok' | 'none' | 'not-seat' | 'board-unread' | 'refused' | 'failed'> => {
  const run = async () => {
    const got = await readNumbers($, fresh.root)
    numbersNow = numbersKept(got)
    if (got.state === 'unread' || got.state === 'bad') return 'none' as const
    // La liste des cartes illisible : aucun numéro n'est attribué (une mission lancée prendrait un autre que sa carte).
    const cards = await cardsOrNull($)
    if (!cards) return 'none' as const
    const now = await $.clock.now()
    // Rien ne manque d'après la relecture de cette veille : ni le siège ni la table ne se relisent.
    if (assignNumbers(got.state === 'read' ? got.table : emptyNumberTable(normRoot(fresh.root)), cards, fresh.runs, now) === null) return 'none' as const
    const seat = await seatForWrite($)
    if (!seat.ok) return seat.why === 'unread' ? ('board-unread' as const) : ('not-seat' as const)
    const root = seat.local.root
    const again = await readNumbers($, root)
    numbersNow = numbersKept(again)
    if (again.state === 'unread' || again.state === 'bad') return 'none' as const
    const before = again.state === 'read' ? again.table : emptyNumberTable(normRoot(root))
    const runs = [...seat.local.runs, ...(seat.stored?.runs ?? []).filter(r => !seat.local.runs.some(x => x.id === r.id))]
    // Les cartes et l'horloge relues au moment d'écrire : une carte lancée ou une grâce passée pendant l'attente du siège compte.
    const cards2 = await cardsOrNull($)
    const after = cards2 && assignNumbers(before, cards2, runs, await $.clock.now())
    if (!after) return 'none' as const
    if (!keepsNumbers(before, after)) return 'refused' as const
    const last = await seatForWrite($)
    if (!last.ok) return last.why === 'unread' ? ('board-unread' as const) : ('not-seat' as const)
    if (!(await putNumbers($, root, after))) return 'failed' as const
    numbersNow = { state: 'read', table: after }
    return 'ok' as const
  }
  const next = numbersChain.then(run, run)
  numbersChain = next.catch(() => undefined)
  return next
}

/**
 * « Repartir d'une table neuve », le clic de la personne chez le titulaire du siège, hors d'un tour : seulement sur une
 * table encore hors forme à l'instant ; son texte est d'abord copié tel quel à côté (`.illisible-<date>`, jamais
 * effacé ; une copie ratée arrête tout), puis une table vide s'écrit, son prochain numéro après le plus grand
 * entier lisible de la copie.
 */
const freshNumbers = ($: any): Promise<'ok' | 'none' | 'not-seat' | 'board-unread' | 'failed'> => {
  const run = async () => {
    const seat = await seatForWrite($)
    if (!seat.ok) return seat.why === 'unread' ? ('board-unread' as const) : ('not-seat' as const)
    const root = seat.local.root
    const got = await readNumbers($, root)
    if (got.state !== 'bad' || got.text === undefined) {
      numbersNow = numbersKept(got)
      return 'none' as const
    }
    const now = await $.clock.now()
    const path = numbersPath($, root)
    const place = path ? `${path}.illisible-${now}` : `${numbersStoreKey(root)}:illisible:${now}`
    try {
      if (path) await $.fs.write(place, got.text)
      else await $.store.set(place, got.text)
    } catch {
      return 'failed' as const
    }
    const table = freshNumberTable(got.text, normRoot(root))
    const last = await seatForWrite($)
    if (!last.ok) return last.why === 'unread' ? ('board-unread' as const) : ('not-seat' as const)
    if (!(await putNumbers($, root, table))) return 'failed' as const
    numbersNow = { state: 'read', table }
    return 'ok' as const
  }
  const next = numbersChain.then(run, run)
  numbersChain = next.catch(() => undefined)
  return next
}

/** Ce que la vue et le relevé reçoivent de la table gardée en mémoire (avec les cartes d'ici) ; rien avant la première relecture. */
const numbersCtx = async ($: any): Promise<{ numbers?: CooNumbers }> => (numbersNow ? { numbers: numbersView(numbersNow, await cardsHere($)) } : {})

// ─── Surveillance de nuit ─────────────────────────────────────────────────
//
// L'enregistrement de la surveillance (`hooks/night.ts`) : un fichier du poste à côté du fichier de
// coordination, commun à l'app et au terminal (à défaut `$.store`), écrit par le seul titulaire du siège, relu
// avant chaque écriture ; une lecture ratée vaut éteinte. Le moteur n'efface pas de fichier : l'arrêt le
// réécrit « éteinte ». Le journal des gestes de la nuit, à côté, une ligne JSON par geste, écrit par le seul
// mod du COO, borné.

/** Le fichier de la surveillance d'un projet ; null sans dossier de Claude (`$.store` alors). */
const nightPath = ($: any, root: string): string | null => {
  const home = claudeHome($)
  return home ? `${home}/flow-board/coordination/${coordinationName(root)}.nuit.json` : null
}
const nightStoreKey = (root: string): string => `coo-night:${normRoot(root)}`
/** Le journal des gestes de la nuit d'un projet ; null sans dossier de Claude (`$.store` alors). */
const nightLogPath = ($: any, root: string): string | null => {
  const home = claudeHome($)
  return home ? `${home}/flow-board/coordination/${coordinationName(root)}.nuit-journal.jsonl` : null
}
const nightLogStoreKey = (root: string): string => `coo-night-log:${normRoot(root)}`

/** Relit la surveillance du projet ; `unread` quand la lecture rate ou que le texte ne se lit pas. */
const readNight = async ($: any, root: string): Promise<NightRead> => {
  try {
    const path = nightPath($, root)
    if (path) {
      if (!(await $.fs.exists(path))) return { state: 'absent' }
      return parseNight(String(await $.fs.read(path)), normRoot(root))
    }
    const raw = await $.store.get(nightStoreKey(root))
    if (raw === undefined || raw === null) return { state: 'absent' }
    return parseNight(typeof raw === 'string' ? raw : JSON.stringify(raw), normRoot(root))
  } catch {
    return { state: 'unread', why: READ_FAILED }
  }
}

/** La surveillance vue par le COO à sa dernière relecture (la vue et le bandeau) ; null hors du siège. */
let nightNow: NightRead | null = null
/** « 🌙 Surveillance de nuit » vient d'être cliqué : la vue montre « Confirmer » et « Annuler ». Retiré à tout allumage et à tout arrêt. */
let nightAsk = false
/**
 * « Changer l'endroit » de la feuille de route vient d'être cliqué : la page « Réglages » montre « Confirmer » et « Annuler ».
 * En mémoire de la discussion seulement (un rechargement la perd : il faut recliquer) ; « Confirmer » la consomme, sauf
 * une lecture ou une écriture ratée ; le siège perdu la retire.
 */
let whereAsk = false
/** Un choix d'endroit en cours d'application (posé avant toute attente) : un second clic pendant ce temps n'écrit rien. */
let whereBusy = false
/**
 * Le tour ouvert par `/flow-board:nuit` tapé par la personne : seul ce tour peut allumer la surveillance par
 * l'outil. Posé à son `prompt.submit` (`submitted`), chargé au `skill.prompt` de ce skill (`loaded`), démarré au
 * `turn.start` du fil principal qui suit (`started`) ; retiré à la fin de ce tour, à tout autre `turn.start` avant
 * le chargement, à tout autre message de la personne, et perdu au rechargement du mod. Le `turn.start` d'une commande
 * tapée ne porte pas le texte de son `prompt.submit` : le tour se reconnaît au chargement de son skill.
 */
let nightArm: { phase: 'submitted' | 'loaded' | 'started' } | null = null
/**
 * Le tour ouvert par un message tapé par la personne (`composer`, `bridge`, `sdk`) : posé à son `prompt.submit`
 * avec son texte (`submitted`), confirmé au `turn.start` du fil principal au même texte (`started`) ; retiré à tout
 * autre `turn.start`, à tout message d'une autre origine, à la fin de ce tour, et perdu au rechargement du mod.
 * Seul ce tour peut transmettre une consigne au nom de la personne (`coordinate.instruct`, origine `user`).
 */
let typedTurn: { text: string; phase: 'submitted' | 'started' } | null = null
/** Le nombre de messages tapés par la personne depuis le chargement du mod : le rang du tour tapé en cours. */
let typedTurnNo = 0
/**
 * La demande unique pour les discussions des missions archivées sans marque (`cooUnmarkedText`) : le rang du tour tapé
 * en cours quand elle a paru pour la première fois depuis le chargement du mod (null : pas encore paru), et le tour
 * tapé dont le oui a été enregistré (`coordinate.unmarked`). Seul un oui d'un tour tapé après sa première parution
 * s'enregistre ; pendant ce seul tour (le même objet `typedTurn`), le contrôle et le compte rendu des discussions à
 * fermer comptent aussi ces missions sans marque.
 */
let unmarkedAskedNo: number | null = null
let unmarkedYesTurn: { text: string; phase: 'submitted' | 'started' } | null = null
/** Les écritures de la surveillance et de son journal, une à la fois. */
let nightChain: Promise<unknown> = Promise.resolve()
/**
 * Le plus long qu'attend l'appelant d'une écriture de la surveillance (une lecture du moteur suspendue) : le
 * message de la personne entre, le clic répond. La file, elle, attend toujours l'écriture réelle : une écriture en
 * retard ne se pose jamais après une écriture demandée plus tard (un allumage en retard recouvrirait un arrêt).
 */
const NIGHT_WRITE_MS = 15_000

/** Une écriture de la surveillance, dans la file ; l'appelant reçoit `late` au-delà de `NIGHT_WRITE_MS`, sans que la file passe outre. */
const nightQueued = <T,>($: any, run: () => Promise<T>, late: T): Promise<T> => {
  const real = nightChain.then(run, run)
  nightChain = real.catch(() => undefined)
  let timer: { cancel: () => void } | null = null
  const timeout = new Promise<T>(resolve => (timer = $.clock.after(NIGHT_WRITE_MS, () => resolve(late))))
  return Promise.race([real, timeout]).finally(() => (timer as { cancel: () => void } | null)?.cancel())
}

/** Écrit l'enregistrement, par le seul titulaire du siège (relu juste avant). */
const putNight = async ($: any, root: string, value: unknown): Promise<boolean> => {
  try {
    const path = nightPath($, root)
    if (path) await $.fs.write(path, JSON.stringify(value))
    else await $.store.set(nightStoreKey(root), value)
    return true
  } catch {
    return false
  }
}

/**
 * Ajoute une ligne au journal, par le mod du COO seul : relu d'abord ; illisible, rien ne s'écrit par-dessus
 * (rien ne se perd) ; borné, les plus anciennes lignes sortent. Rend `written`, `taken` (`isTaken` a vu une ligne
 * qui la rend inutile : rien d'écrit) ou `failed` (journal illisible, écriture ratée) : un texte non vide, à comparer.
 */
const logNight = ($: any, root: string, line: NightLogLine, isTaken?: (lines: readonly string[]) => boolean): Promise<'written' | 'taken' | 'failed'> => {
  const p = nightLogChain.then(() => logNightNow($, root, line, isTaken))
  nightLogChain = p.catch(() => 'failed')
  return p
}

/** Les écritures du journal, l'une après l'autre : deux lignes ajoutées en même temps ne s'écrasent pas. */
let nightLogChain: Promise<unknown> = Promise.resolve()

/** Le texte du journal tel qu'écrit (vide quand il n'existe pas) ; lève quand la lecture rate. */
const readNightLogText = async ($: any, root: string): Promise<string> => {
  const path = nightLogPath($, root)
  if (path) return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
  const raw = await $.store.get(nightLogStoreKey(root))
  return typeof raw === 'string' ? raw : ''
}

/** Ajoute la ligne au journal relu ; `isTaken` : une ligne déjà là qui la rend inutile (`taken`, rien d'écrit). */
const logNightNow = async ($: any, root: string, line: NightLogLine, isTaken?: (lines: readonly string[]) => boolean): Promise<'written' | 'taken' | 'failed'> => {
  try {
    const path = nightLogPath($, root)
    const text = await readNightLogText($, root)
    const got = parseNightLog(text)
    if (got.state !== 'read') return 'failed'
    if (isTaken?.(got.lines)) return 'taken'
    const out = `${appendNightLog(got.lines, line).join('\n')}\n`
    if (path) await $.fs.write(path, out)
    else await $.store.set(nightLogStoreKey(root), out)
    return 'written'
  } catch {
    return 'failed'
  }
}

// ─── Gestes de nuit ───────────────────────────────────────────────────────
//
// Le Claude du COO écrit un geste de nuit (`coordinate.night`) pendant une surveillance valide ; le mod de la
// mission l'applique une fois, comme son bouton, après avoir revérifié la surveillance et les conditions du
// geste ; son résultat passe par un fichier de la mission, que le mod du COO recopie au journal.

/** Le fichier des résultats des gestes de nuit d'une mission, à côté du fichier de coordination ; null sans dossier de Claude. */
const nightResultPath = ($: any, root: string, run: string): string | null => {
  const home = claudeHome($)
  return home ? `${home}/flow-board/coordination/${coordinationName(root)}.nuit-resultats.${relayFileSlug(run)}.json` : null
}
const nightResultStoreKey = (root: string, run: string): string => `coo-night-result:${normRoot(root)}:${run}`

/** Relit les résultats des gestes de nuit d'une mission ; `unread` quand la lecture rate. */
const readNightResults = async ($: any, root: string, run: string): Promise<ReturnType<typeof parseNightResults>> => {
  try {
    const path = nightResultPath($, root, run)
    if (path) return parseNightResults((await $.fs.exists(path)) ? String(await $.fs.read(path)) : '', run)
    const raw = await $.store.get(nightResultStoreKey(root, run))
    return parseNightResults(typeof raw === 'string' ? raw : '', run)
  } catch {
    return { state: 'unread' }
  }
}

/** Les écritures des résultats, l'une après l'autre. */
let nightResultChain: Promise<unknown> = Promise.resolve()

/**
 * Écrit le résultat d'un geste de nuit, par le mod de la mission ; le premier résultat d'une entrée reste (un
 * rejeu ne le remplace pas), sauf un refus de l'app venu après l'envoi (`isOver`) ; un fichier illisible n'est
 * jamais réécrit. Rend faux quand rien ne s'est écrit.
 */
const writeNightResult = ($: any, root: string, run: string, entry: CoordNight, result: string, why: string, isOver = false): Promise<boolean> => {
  const go = async (): Promise<boolean> => {
    const got = await readNightResults($, root, run)
    if (got.state !== 'read') return false
    if (!isOver && got.results.some(r => r.entry === entry.id)) return true
    const text = nightResultsText(run, got.results, { entry: entry.id, watch: entry.watch, at: await $.clock.now(), act: entry.act, ...(entry.group !== undefined ? { group: entry.group } : {}), result, why })
    try {
      const path = nightResultPath($, root, run)
      if (path) await $.fs.write(path, text)
      else await $.store.set(nightResultStoreKey(root, run), text)
      return true
    } catch {
      return false
    }
  }
  const p = nightResultChain.then(go, go)
  nightResultChain = p.catch(() => false)
  return p
}

/**
 * Les coupures de nuit écrites (une ligne « cutAuto » écrite du journal, avec l'id de son entrée) qu'une mission a
 * prises depuis : son auto éteint, raison « coupé par le COO », après la coupure. Notées « applied » au journal, une fois.
 */
const logNightCuts = async ($: any, board: Board) => {
  // Aucune coupure du COO au fichier de coordination : rien à relire.
  if (!coordLive.some(e => e.kind === 'cutAuto' && e.by === 'coo')) return
  let lines: string[]
  try {
    const got = parseNightLog(await readNightLogText($, board.root))
    if (got.state !== 'read') return
    lines = got.lines
  } catch {
    return
  }
  const logged = nightLogEntries(lines)
  for (const l of nightCutsWritten(lines)) {
    if (logged.has(`${l.entry}:applied`)) continue
    const run = board.runs.find(r => r.id === l.mission)
    const off = run ? autoDatesOf(run).offAt : undefined
    if (!run || isAutoOn(run) || autoPauseWhy(run) !== AUTO_STOPS.coo || off === undefined || off < l.at) continue
    await logNight($, board.root, { at: off, watch: l.watch, act: 'cutAuto', mission: l.mission!, why: 'auto coupé par le tableau de bord de la mission', result: 'applied', entry: l.entry! })
  }
}

/** Le mod du COO recopie au journal, une fois par entrée, les résultats des gestes de nuit que les missions ont écrits. */
const copyNightResults = async ($: any, board: Board) => {
  const runs = [...new Set(coordLive.flatMap(e => (e.kind === 'night' ? [e.run] : [])))]
  if (runs.length === 0) return
  let logged: Set<string>
  try {
    const got = parseNightLog(await readNightLogText($, board.root))
    // Un journal illisible n'est jamais réécrit : rien ne s'y recopie.
    if (got.state === 'unread') return
    logged = got.state === 'read' ? nightLogEntries(got.lines) : new Set()
  } catch {
    return
  }
  for (const run of runs) {
    const got = await readNightResults($, board.root, run)
    if (got.state !== 'read') continue
    for (const r of got.results) {
      if (logged.has(`${r.entry}:${r.result}`)) continue
      if ((await logNight($, board.root, { at: r.at, watch: r.watch, act: r.act, mission: run, ...(r.group !== undefined ? { group: r.group } : {}), why: r.why, result: r.result, entry: r.entry })) === 'written') logged.add(`${r.entry}:${r.result}`)
    }
  }
}

/** Ce qu'un refus de la surveillance dit au Claude du COO. */
const NIGHT_REFUSALS: Record<NightRefusal, string> = {
  absent: 'no night watch is on',
  unread: 'the night watch could not be read (it counts as off)',
  'other-id': 'it does not name the night watch that is on',
  ended: 'the night watch is over (12 hours at most)',
  future: 'the night watch is dated in the future (it counts as off)',
  'seat-free': 'the COO seat is free',
  'seat-other': 'another discussion holds the COO seat',
  'seat-retaken': 'the COO seat was taken again since the night watch was switched on',
  'seat-stale': 'the COO discussion has not shown itself for more than 10 minutes',
}

/** Ce qu'un refus de la surveillance dit : le texte fixe de sa raison, jamais la valeur relue. */
const shownNightRefusal = (why: NightRefusal): string => NIGHT_REFUSALS[why] ?? 'the night watch counts as off'

/** Les gestes de nuit que le Claude du COO peut demander : ceux d'une entrée `night`, la coupure de l'auto et la réouverture. */
const NIGHT_ACTS_ASKED: readonly string[] = [...NIGHT_ENTRY_ACTS, 'cutAuto', 'reopen']

/**
 * La dernière surface qui a dessiné cette discussion (`terminal`, `vscode`, `desktop`, `mobile`) ; inconnue avant
 * le premier dessin. Seuls le terminal et VS Code sont le CLI, où `claude --bg` part la nuit (décision R31).
 */
let lastSurface: string | undefined
const isCliHere = (): boolean => lastSurface === 'terminal' || lastSurface === 'vscode'

/**
 * Les réouvertures de cette discussion (`<surveillance>:<mission>`), même quand leur ligne n'a pas pu s'écrire au
 * journal : une seconde commande ne se donne jamais pour la même surveillance. Et les refus « pour le matin » déjà
 * notés : la relecture de 5 s ne relit pas le journal pour eux.
 */
const reopenedHere = new Set<string>()
const appRefusedHere = new Set<string>()

/** Ce que le journal note d'une réouverture que l'app ne laisse pas partir la nuit. */
const NIGHT_APP_MORNING = 'refusé par l’app : pour le matin'

/** Ce que le journal de nuit note d'une réouverture refusée parce que la session de sa discussion tourne encore. */
const NIGHT_RUNNING = 'sa session tourne encore : pour le matin'

/** Une réouverture déjà notée pour cette mission pendant cette surveillance ; `isAny` : refusée par l'app comprise. */
const isReopenLogged = (lines: readonly NightLogLine[], mission: string, isAny: boolean): boolean =>
  lines.some(l => l.act === 'reopen' && l.mission === mission && (isAny || l.result === 'written'))

/** La réouverture de cette mission refusée pendant cette surveillance parce que sa session tournait encore. */
const isRunningLogged = (lines: readonly NightLogLine[], mission: string): boolean =>
  lines.some(l => l.act === 'reopen' && l.mission === mission && l.result === 'refused' && l.why === NIGHT_RUNNING)

/** Les refus « sa session tourne encore » de cette discussion (`<surveillance>:<mission>`), même quand leur ligne n'a pas pu s'écrire. */
const runningHere = new Set<string>()

/** Les lignes du journal de cette surveillance ; null quand il ne se lit pas. */
const nightLogLinesOf = async ($: any, root: string, watch: string): Promise<NightLogLine[] | null> => {
  try {
    const got = parseNightLog(await readNightLogText($, root))
    return got.state === 'read' ? nightLogOf(got.lines, watch) : null
  } catch {
    return null
  }
}

/**
 * Pour chaque mission à rouvrir, ce que le relevé en dit : la commande composée par le mod et l'id de la discussion
 * dont le texte fait d'abord chercher le `pid` (CLI), pour le matin (app, surface inconnue, sa session trouvée en
 * marche pendant cette surveillance), déjà rouverte pendant cette surveillance (journal), sans commande (id hors
 * forme, journal illisible, discussion qui tient une autre mission).
 */
const nightReopensNow = async ($: any, board: Board, blocks: readonly NightBlock[], root: string, watch: string): Promise<Record<string, NightReopen>> => {
  const asked = blocks.filter(b => b.act === 'reopen')
  if (asked.length === 0) return {}
  const lines = await nightLogLinesOf($, root, watch)
  // La discussion du COO, qui tourne : jamais relancée sous elle-même.
  const here = await hereId($)
  const out: Record<string, NightReopen> = {}
  for (const b of asked) {
    // La discussion de la mission : celle qui la tient, sinon celle où elle est née (relue du fichier, contrôlée par `reopenCommand`).
    const run = board.runs.find(r => r.id === b.mission)
    const session = run?.owner ?? run?.bornIn
    const command = reopenCommand(b.mission, session)
    // Cette discussion tient une autre mission (la reprendre la mettrait en pause, sans geste de la personne), ou c'est
    // celle du COO, qui tourne.
    const isBusy = session !== undefined && (session === here || board.runs.some(r => r.id !== b.mission && r.status === 'active' && r.owner === session))
    // Une mission en auto proposée sur « arrêtée » : toute ligne de réouverture de la surveillance, refusée comprise
    // (une note refusée après un /reload-plugins qui a vidé la mémoire), suffit : jamais une seconde commande ; sauf les
    // refus « sa session tourne encore » et « pour le matin » de l'app, que leurs propres cas disent plus bas.
    const isAutoTried =
      b.isAuto === true && lines !== null && lines.some(l => l.act === 'reopen' && l.mission === b.mission && l.why !== NIGHT_RUNNING && l.why !== NIGHT_APP_MORNING)
    const isDone = reopenedHere.has(`${watch}:${b.mission}`) || (lines !== null && isReopenLogged(lines, b.mission, false)) || isAutoTried
    // Sa session tournait encore quand le Claude du COO l'a vérifiée : plus reproposée pendant cette surveillance.
    const isRunning = runningHere.has(`${watch}:${b.mission}`) || (lines !== null && isRunningLogged(lines, b.mission))
    out[b.mission] =
      command === null || session === undefined
        ? { how: 'unsafe' }
        : isDone
          ? { how: 'done' }
          : isRunning
            ? { how: 'running' }
            : isBusy
              ? { how: 'busy' }
              : lines === null
                ? { how: 'unread' }
                : lastSurface === undefined
                  ? { how: 'unseen' }
                  : isCliHere()
                    ? { how: 'cli', command, session }
                    : { how: 'app' }
  }
  return out
}

/**
 * `coordinate.night` avec `reopen` (décision R38) : le Claude du COO a lancé la commande du relevé ; le mod le note
 * au journal, une fois par surveillance et mission, seulement dans le CLI et pour une mission présente, pas
 * archivée, en pause du mod (pas coupée par le COO) : un blocage relevé (ouverte nulle part, ou en pause « discussion
 * fermée »), ou tout juste rouverte (son auto déjà reparti de lui-même, d'une pause « discussion fermée », depuis l'allumage de la surveillance compris) ;
 * ou une mission en auto, sans pause, que ce mod du COO a proposée « à rouvrir » pendant cette surveillance sur une
 * discussion dite arrêtée (`isAutoReopenProposed`). Le blocage s'y relit sans le verdict : la note ne refuse jamais sur lui. Avec `running` (le Claude du COO a trouvé sa session en marche) : refusée, pour
 * le matin, notée une fois et plus reproposée de la surveillance. Dans l'app : refusée, pour le matin. Rien d'autre ne
 * s'écrit : la mission rouverte voit son auto repartir de lui-même quand sa reprise à la relance vaut encore, sinon
 * elle reste en manuel ; le COO ne l'allume jamais.
 */
const recordReopen = async ($: any, o: { root: string; now: number; watch: string; watchAt: number; mission: string; board: Board; name: string; title: string; isRunning: boolean }): Promise<string> => {
  const line = (result: string, why: string): NightLogLine => ({ at: o.now, watch: o.watch, act: 'reopen', mission: o.mission, why, result })
  const refuse = async (why: string, said: string, isTaken?: (lines: readonly string[]) => boolean) => {
    await logNight($, o.root, line('refused', why), isTaken)
    return `Night gesture ${o.name} for mission ${o.title} refused: ${said} Nothing written.`
  }
  const run = o.board.runs.find(r => r.id === o.mission)
  if (!run || run.archivedAt !== undefined || run.status === 'done') return refuse('mission absente, archivée ou close', 'the mission is absent, archived or done.')
  if (reopenedHere.has(`${o.watch}:${o.mission}`)) return refuse('déjà rouverte pendant cette surveillance', 'already reopened during this night watch (once per mission).')
  const isPaused = isAutoPauseStored(run) && autoPauseWhy(run) !== AUTO_STOPS.coo
  // Ouverte nulle part (le blocage que montre la section « Nuit »), ou reprise depuis l'allumage de la surveillance (pas
  // seulement notée ouverte au nom d'une discussion qui s'est fermée depuis, `isEndedPause`).
  const isJustReopened = isOpenMission(run) && !isEndedPause(run) && run.updatedAt >= o.watchAt
  // Rouverte, et son auto déjà reparti de lui-même depuis l'allumage de la surveillance, d'une pause « discussion
  // fermée » (le blocage « à rouvrir », la reprise à la relance : la discussion relancée a pu reprendre avant cet
  // appel) : la réouverture se note aussi ; rien ne s'allume ici.
  const isJustResumed = isJustReopened && isAutoOn(run) && (autoResumedAt(run) ?? -1) >= o.watchAt && autoResumedLabel(run) === AUTO_RESUMED_RELAUNCH
  // Le blocage sans le verdict : la discussion relancée a déjà son fichier de session quand la note arrive.
  const isBlock = !isJustReopened && (await nightBlocksNow($, o.board, o.now, false, true)).some(b => b.mission === o.mission && b.act === 'reopen')
  // Une mission en auto que ce mod a proposée « à rouvrir » pendant cette surveillance, sur une discussion dite arrêtée,
  // et dont l'auto est encore allumé, sans coupure du COO depuis.
  const isProposed = isAutoReopenProposed(o.watch, o.mission) && isAutoOn(run) && !(isAutoPauseStored(run) && autoPauseWhy(run) === AUTO_STOPS.coo)
  if (!isJustResumed && !isProposed && (!isPaused || (!isBlock && !isJustReopened)))
    return refuse('pas une mission à rouvrir', 'it is not a mission in auto paused by its dashboard with open groups, nor a mission in auto proposed for reopening during this night watch because its background discussion no longer ran.')
  // Le Claude du COO a trouvé sa session encore en marche (un « pid ») : rien n'est lancé ; un seul refus au journal par
  // surveillance et mission, et le relevé ne la repropose plus de la surveillance.
  if (o.isRunning) {
    runningHere.add(`${o.watch}:${o.mission}`)
    return refuse(NIGHT_RUNNING, 'its session still runs; it stays for the morning.', lines => isRunningLogged(nightLogOf(lines, o.watch), o.mission))
  }
  // Trouvée en marche plus tôt pendant cette surveillance : plus de réouverture de la nuit, sans ligne de plus.
  const logged = await nightLogLinesOf($, o.root, o.watch)
  if (runningHere.has(`${o.watch}:${o.mission}`) || (logged !== null && isRunningLogged(logged, o.mission)))
    return `Night gesture ${o.name} for mission ${o.title} refused: its session still ran when checked during this night watch; it stays for the morning. Nothing written.`
  // Hors du CLI : un seul refus « pour le matin » par surveillance et mission au journal, quel que soit le nombre d'appels.
  if (!isCliHere()) return refuse(NIGHT_APP_MORNING, 'in the app, a reopen does not leave at night; it stays for the morning.', lines => isReopenLogged(nightLogOf(lines, o.watch), o.mission, true))
  // Relu et écrit dans la file du journal : deux appels ne notent jamais deux réouvertures ; retenue ici même si la ligne ne s'écrit pas.
  const out = await logNight($, o.root, line('written', 'commande de réouverture lancée par le COO : mission rouverte'), lines => isReopenLogged(nightLogOf(lines, o.watch), o.mission, false))
  if (out === 'taken') return refuse('déjà rouverte pendant cette surveillance', 'already reopened during this night watch (once per mission).')
  reopenedHere.add(`${o.watch}:${o.mission}`)
  if (out === 'failed') return `Night gesture ${o.name} for mission ${o.title}: the night journal could not be written (unreadable, or the write failed); no second reopen will be given tonight; tell the user in the morning that this mission was reopened.`
  return `Night gesture ${o.name} recorded for mission ${o.title}: reopened; its auto resumes by itself when its resume still holds, otherwise the user switches it on from the Coordination view; never switch it on yourself; the morning summary tells the user which.`
}

/**
 * `coordinate.night` : un geste de nuit du Claude du COO, seulement chez le titulaire du siège, pendant la
 * surveillance valide qu'il nomme (relue à l'instant), et seulement sur un blocage que le mod relève à cet instant
 * (`nightBlocksNow`) ; une fois par surveillance, mission, geste et groupe. `cutAuto` passe par l'entrée de coupure
 * (`coordinate.cutAuto`). Chaque geste, écrit ou refusé, va au journal.
 */
const recordNight = async ($: any, one: unknown): Promise<string> => {
  const x = one !== null && typeof one === 'object' && !Array.isArray(one) ? (one as Record<string, unknown>) : {}
  const { mission, act, group } = x
  const name = typeof act === 'string' ? neutralQuoted(clip(act, 40)) : '(none)'
  if (!isSafeId(mission)) return 'A night gesture without a well-formed mission id was refused.'
  const seat = await seatForWrite($)
  if (!seat.ok) return `Night gesture ${name} refused: ${seat.why === 'unread' ? SEAT_UNREAD : 'this discussion does not hold the COO seat.'} Nothing written.`
  const root = seat.local.root
  const now = await $.clock.now()
  const v = nightValidity(await readNight($, root), mergeSeat(seat.local.coo, seat.stored?.coo), now, typeof x.watch === 'string' ? x.watch : '')
  if (!v.ok) return `Night gesture ${name} refused: ${shownNightRefusal(v.why)}. Nothing written.`
  const watch = v.watch.id
  // Au journal, le geste tel que nommé quand il se lit (des lettres, 40 au plus), sinon « unknown ».
  const logged = typeof act === 'string' && /^[A-Za-z]{1,40}$/.test(act) ? act : 'unknown'
  const log = (result: string, why: string) => logNight($, root, { at: now, watch, act: logged, mission, ...(isGroupId(group) ? { group } : {}), why, result })
  if (typeof act !== 'string' || !NIGHT_ACTS_ASKED.includes(act)) {
    await log('refused', 'geste hors de la liste de nuit')
    return `Night gesture ${name} refused: at night only "wave", "resend", "relaunch", "force", "reopen" and "cutAuto"; never answer a blocking question, validate a plan or a report, deliver, or switch auto on. Nothing written.`
  }
  if (group !== undefined && !isGroupId(group)) {
    await log('refused', 'groupe hors forme')
    return `Night gesture ${name} refused: "group" is not a group id. Nothing written.`
  }
  if (act === 'reopen') {
    const board = seat.stored ?? seat.local
    return recordReopen($, { root, now, watch, watchAt: v.watch.at, mission, board, name, title: neutralQuoted(board.runs.find(r => r.id === mission)?.title ?? mission), isRunning: x.running === true })
  }
  if (act === 'cutAuto') {
    const { said, entry } = await recordCutWith($, { mission })
    // Écrite : l'id de son entrée suit au journal, où sa prise par la mission se note ensuite (`logNightCuts`).
    await logNight($, root, { at: now, watch, act: 'cutAuto', mission, why: 'coupure de l’auto demandée par le COO', result: entry !== undefined ? 'written' : 'refused', ...(entry !== undefined ? { entry } : {}) })
    return said
  }
  const board = seat.stored ?? seat.local
  const title = neutralQuoted(board.runs.find(r => r.id === mission)?.title ?? mission)
  // Le blocage que nomme l'appel ; à défaut, un « resend » sans groupe désigne celui d'un groupe, quand il est seul pour la mission.
  // Un geste autre que la réouverture (traitée plus haut) : son blocage ne dépend pas du verdict, qui ne se lit pas.
  const all = (await nightBlocksNow($, board, now, false, true)).filter(b => b.mission === mission && b.act === act)
  const exact = all.filter(b => b.group === group)
  const blocks = exact.length > 0 || act !== 'resend' || group !== undefined ? exact : all
  if (blocks.length !== 1) {
    await log('refused', blocks.length === 0 ? 'pas un blocage relevé à cet instant' : 'plusieurs blocages : geste ambigu')
    return `Night gesture ${name} for mission ${title} refused: ${blocks.length === 0 ? 'it does not match a blockage of the « Nuit » section right now (each line names its gesture and group)' : 'several blockages match it; name the group'}. Nothing written.`
  }
  const b = blocks[0]!
  const entryId = newEntryId(now, Math.random())
  // Le doublon se dit par lui-même : une écriture qui ne fait que retirer les entrées d'une mission effacée rend aussi « ok ».
  let isTwice = false
  const written = await writeCoordination($, entries =>
    // Une fois par surveillance, mission, geste et groupe ; un « resend », une fois par question (une relance, une fois par groupe : sa question change d'id à chaque retour).
    (isTwice = liveEntries(entries, () => false).some(e => e.kind === 'night' && e.watch === watch && e.run === mission && e.act === act && e.group === b.group && (act !== 'resend' || e.question === b.question)))
      ? null
      : [...entries, { id: entryId, kind: 'night', run: mission, at: now, watch, act, ...(b.group !== undefined ? { group: b.group } : {}), ...(b.question !== undefined && act === 'resend' ? { question: b.question } : {}), ...(b.awaited ? { awaited: b.awaited.map(a => ({ run: a.mission, group: a.group, ...(a.on ? { on: a.on } : {}) })) } : {}) }],
  )
  if (isTwice) {
    await log('refused', 'déjà demandé pendant cette surveillance')
    return `Night gesture ${name} for mission ${title} refused: already asked during this night watch (once per mission, gesture and group; for "resend", once per question). Nothing written.`
  }
  if (written !== 'ok') {
    await log('refused', written === 'full' ? 'fichier de coordination plein (2 000 entrées)' : 'écriture ratée')
    return `Night gesture ${name} for mission ${title} refused: ${coordWriteWhy(written)} Nothing else is removed to make room.`
  }
  await log('written', 'geste écrit, à appliquer par le tableau de bord de la mission')
  return `Night gesture ${name} recorded for mission ${title}: its dashboard applies it once, if the night watch and its conditions still hold then${isOpenMission(board.runs.find(r => r.id === mission) ?? ({} as Run)) ? '' : ' (it is open in no discussion: the gesture waits for it to be resumed)'}; the night journal keeps its result.`
}

/**
 * Les gestes de nuit qui visent la mission portée ici, chacun une fois, dans l'ordre du fichier ; jamais pendant
 * un tour ni pendant un autre envoi du mod.
 */
const applyNight = async ($: any, runId: string, entries: readonly CoordEntry[], applied: ReadonlySet<string>) => {
  if (isApplyingWave || isTurnOpen || isAutoDeciding || isAutoCompacting) return
  const list = pendingNightFor(entries, runId, applied, await $.clock.now())
  if (list.length === 0) return
  isApplyingWave = true
  try {
    // Un geste à réessayer n'arrête pas les suivants : chacun se réessaie à la relecture suivante.
    for (const e of list) await applyNightOne($, e)
  } finally {
    isApplyingWave = false
    // L'auto, retenu pendant l'envoi, décide de nouveau.
    scheduleAutoTurn($)
  }
}

/**
 * Un geste de nuit pour la mission portée ici, appliqué comme son bouton après avoir revérifié, à cet instant, la
 * surveillance (`nightValidity` : le même id, avant sa fin, le siège de qui l'a allumée), la fenêtre du geste,
 * l'auto allumé et les conditions du geste ; sinon consommé sans effet. Une lecture ratée de la surveillance
 * n'applique rien et ne note rien (l'entrée périme avec elle). Une seule fois, d'une surface à l'autre : un
 * groupe parti depuis le geste, un envoi déjà repris valent appliqués.
 */
const applyNightOne = async ($: any, e: CoordNight): Promise<'retry' | 'done'> => {
  const board: Board | null = await read($, boardAtom)
  const run = board ? activeRun(board) : null
  if (!board || !run || run.id !== e.run) return 'retry'
  const now = await $.clock.now()
  const root = board.root
  const settle = async (result: string, why: string): Promise<'done'> => {
    await noteApplied($, run.id, e.id)
    await quietly(() => writeNightResult($, root, run.id, e, result, why))
    return 'done'
  }
  if (now - e.at > NIGHT_MS) return settle('refused', 'geste périmé (plus de 12 heures)')
  const got = await readNight($, root)
  if (got.state === 'unread') return 'retry'
  const v = nightValidity(got, board.coo, now, e.watch)
  if (!v.ok) return settle('refused', `surveillance qui ne vaut pas (${shownNightRefusal(v.why)})`)
  if (e.at < v.watch.at || e.at > v.watch.until) return settle('refused', 'geste hors de la fenêtre de la surveillance')
  // Allumé ; pour une relance seulement, aussi dans la pause d'un groupe revenu trop de fois (jamais une autre pause).
  if (!isAutoOn(run) && !(e.act === 'relaunch' && isRelaunchPause(run))) return settle('refused', 'auto éteint')
  if (e.act === 'resend') {
    if (!openQuestions(run).some(q => q.id === e.question)) return settle('refused', 'envoi déjà repris')
    if (!(await commit($, b => resendAutoMark(b, run.id, e.question!.slice(STALE_PREFIX.length), now)))) return settle('refused', 'envoi qui n’attend plus son démarrage')
    return settle('applied', 'envoi resté sans suite renvoyé')
  }
  const group = run.groups?.find(g => g.id === e.group)
  if (!group || e.group === undefined) return settle('refused', 'groupe absent du plan')
  // Une question qui t'attend (pas une question du mod) bloque le groupe : la nuit ne la contourne jamais.
  if (blockingQuestions(run, { kind: 'group', id: e.group }).some(q => !isModQuestion(q.id))) return settle('refused', 'une question qui t’attend bloque le groupe')
  if ([group.linked, group.delegated].some(l => l !== undefined && l !== null && typeof l === 'object' && isTime((l as { at?: unknown }).at) && (l as { at: number }).at >= e.at)) return settle('refused', 'groupe déjà parti depuis le geste')
  if (e.act === 'relaunch') {
    if (!openQuestions(run).some(q => q.id.startsWith(`${RELAUNCH_PREFIX}${e.group}#`))) return settle('refused', 'question « relance: » déjà levée')
    // Une fois par groupe et par surveillance : une relance déjà partie (son résultat gardé par cette mission) suffit,
    // même si le groupe, revenu de nouveau, porte une nouvelle question. Illisible : rien ne part, réessayé.
    const done = await readNightResults($, root, run.id)
    if (done.state !== 'read') return 'retry'
    if (done.results.some(r => r.watch === e.watch && r.act === 'relaunch' && r.group === e.group && r.result === 'applied')) return settle('refused', 'groupe déjà relancé pendant cette surveillance')
  }
  const extra: ForcedPair[] = []
  if (e.act === 'force') {
    // Chaque retenue du groupe, revérifiée à cet instant : toutes levées pour ce seul lancement, ou rien.
    const pairs = e.awaited ?? []
    const dead = await deadSinceOf($, board, pairs.map(a => a.run))
    const holds = holdsHere(board).filter(h => h.held === e.group)
    for (const a of pairs) {
      const holder = board.runs.find(r => r.id === a.run)
      if (!holder || holder.archivedAt !== undefined || isOpenMission(holder)) return settle('refused', 'mission qui retient ouverte quelque part, ou absente')
      const since = dead(a.run, a.group)
      if (since === undefined || now - since <= NIGHT_DEAD_MS) return settle('refused', 'worker qui retient sans signe sûr de fin depuis plus de 30 minutes')
      extra.push({ held: e.group, run: a.run, group: a.group, ...(a.on ? { on: a.on } : {}) })
    }
    // Une retenue que le geste ne nomme pas (née depuis) : rien ne part ; aucune retenue nommée encore là : déjà levée.
    if (holds.some(h => !pairs.some(a => a.run === h.run && a.group === h.group))) return settle('refused', 'une autre retenue tient le groupe')
    if (!holds.some(h => pairs.some(a => a.run === h.run && a.group === h.group))) return settle('refused', 'retenue déjà levée')
  }
  // Revérifiée juste avant l'envoi : une surveillance arrêtée pendant la préparation n'envoie rien.
  const isStillOn = async (): Promise<boolean | null> => {
    const again: Board | null = await read($, boardAtom)
    const read2 = await readNight($, root)
    // Une lecture ratée ne dit rien : rien ne part, rien ne se note, la relecture suivante réessaie.
    if (again === null || read2.state === 'unread') return null
    return nightValidity(read2, again.coo, await $.clock.now(), e.watch).ok
  }
  const out = await launchCooGroups($, run.id, [e.group], () => noteApplied($, run.id, e.id), extra, { root, run: run.id, entry: e }, isStillOn)
  if (out === 'retry') return 'retry'
  const why = out === 'sent' ? 'groupe lancé' : out === 'none' ? 'le plan ou une retenue ne le fait plus partir' : out === 'stopped' ? 'surveillance arrêtée avant l’envoi' : 'texte non entré'
  await quietly(() => writeNightResult($, root, run.id, e, out === 'sent' ? 'applied' : 'refused', why))
  return 'done'
}

/** Ce que le journal dit d'un arrêt, selon sa cause. */
const NIGHT_STOP_FR: Record<NightStop, string> = { person: 'message de la personne', button: 'clic « Arrêter »', ended: 'heure de fin', closed: 'discussion du COO fermée', clear: 'discussion du COO vidée (/clear)', gap: 'discussion du COO muette plus de 10 minutes (veille, plantage)' }

/**
 * Allume la surveillance, par le seul titulaire du siège : un clic « Confirmer », ou l'appel de l'outil dans le
 * tour de `/flow-board:nuit`. Une surveillance encore valide n'est pas remplacée ; un enregistrement illisible
 * n'est jamais écrit par-dessus ; une écriture ratée n'allume rien.
 */
const startNight = ($: any, how: NightWatch['how']): Promise<{ out: 'on' | 'already' | 'unread' | 'not-seat' | 'board-unread' | 'failed'; until?: number }> =>
  nightQueued(
    $,
    async () => {
      nightAsk = false
      const seat = await seatForWrite($)
      if (!seat.ok) return { out: seat.why === 'unread' ? ('board-unread' as const) : ('not-seat' as const) }
      const root = seat.local.root
      const got = await readNight($, root)
      nightNow = got
      if (got.state === 'unread') return { out: 'unread' as const }
      const now = await $.clock.now()
      const merged = mergeSeat(seat.local.coo, seat.stored?.coo)
      if (got.state === 'read' && nightValidity(got, merged, now).ok) return { out: 'already' as const, until: got.watch.until }
      // Un siège muet depuis plus de 10 minutes (le poste sort de veille) : la surveillance s'arrêterait aussitôt.
      if (isSeatGap(merged, now)) return { out: 'failed' as const }
      const here = await hereId($)
      const watch = newNightWatch(newNightId(now, Math.random()), normRoot(root), here, soundSeat(merged)!.at, now, how)
      if (!(await putNight($, root, watch))) return { out: 'failed' as const }
      // Relue : seule une surveillance qui s'est écrite telle quelle vaut allumée.
      const back = await readNight($, root)
      nightNow = back
      if (back.state !== 'read' || back.watch.id !== watch.id) return { out: 'failed' as const }
      await logNight($, root, { at: now, watch: watch.id, act: 'start', why: how === 'click' ? 'clic « Confirmer »' : `/${NIGHT_SKILL} tapé`, result: `allumée jusqu’à ${hhmmOf(watch.until)}` })
      return { out: 'on' as const, until: watch.until }
    },
    { out: 'failed' as const },
  )

/**
 * Arrête la surveillance allumée par cette discussion, par le seul titulaire du siège : l'enregistrement est
 * réécrit « éteinte », et le journal le note. Sans siège, rien ne s'écrit : la surveillance ne vaut plus chez qui
 * la lit (la validité y est vérifiée). Rend `stopped` (elle vient de s'arrêter), `none` (aucune surveillance
 * allumée par cette discussion, ou le siège n'est plus à elle : sa surveillance ne vaut plus), `unread`
 * (l'enregistrement ne se lit pas : il vaut éteinte, rien ne s'écrit par-dessus) ou `failed` (l'arrêt n'a pas pu
 * s'écrire : fichier des missions illisible, écriture ratée, délai dépassé).
 */
const stopNight = ($: any, why: NightStop): Promise<NightStopOut> =>
  nightQueued(
    $,
    async () => {
      nightAsk = false
      const seat = await seatForWrite($)
      if (!seat.ok) return seat.why === 'unread' ? ('failed' as const) : ('none' as const)
      const root = seat.local.root
      const got = await readNight($, root)
      nightNow = got
      if (got.state === 'unread') return 'unread' as const
      if (got.state !== 'read' || got.watch.by !== (await hereId($))) return 'none' as const
      const now = await $.clock.now()
      // Passée (heure de fin), l'arrêt garde sa vraie cause.
      const cause: NightStop = now >= got.watch.until ? 'ended' : why
      if (!(await putNight($, root, nightOff(normRoot(root), got.watch.id, now, cause)))) return 'failed' as const
      nightNow = await readNight($, root)
      await logNight($, root, { at: now, watch: got.watch.id, act: 'stop', why: NIGHT_STOP_FR[cause], result: 'arrêtée' })
      $.ui.invalidate('ui.render')
      return 'stopped' as const
    },
    'failed' as const,
  )

/**
 * Les groupes que la vague d'une mission propose (`cooWaveOf`), chacun avec l'heure où ce poste l'a vu proposé la
 * première fois ; un groupe qui part ou n'est plus proposé en sort.
 */
let nightWaveSeen: { run: string; group: string; at: number }[] = []

/**
 * Les groupes de la vague en cours qui ne partent pas : proposés depuis 10 minutes sans départ, comme un groupe
 * « pas parti » d'une vague lancée (`WAVE_TTL_MS`) ; un groupe tout juste proposé part d'ordinaire de lui-même.
 */
const nightWaveDue = (board: Board, now: number, isTick: boolean): ((runId: string) => string[]) => {
  const seen = cooWaveOf(board, now).next.flatMap(m => m.groups.map(group => ({ run: m.id, group, at: nightWaveSeen.find(x => x.run === m.id && x.group === group)?.at ?? now })))
  // Seule la relecture de 5 s tient la mémoire : un relevé ou un appel sur une autre copie du fichier ne la remet pas à zéro.
  if (isTick) nightWaveSeen = seen
  return runId => seen.filter(x => x.run === runId && now - x.at >= WAVE_TTL_MS).map(x => x.group)
}

/**
 * Le dernier signe sûr qu'a laissé au relais le worker de chaque groupe des missions ouvertes nulle part qui
 * retiennent un groupe : la fin de sa session, ou son compte rendu final, le plus récent des deux. Un relais
 * illisible ne donne aucun signe : rien ne se force sur une supposition.
 */
const nightDeadSince = ($: any, board: Board, views: readonly NightMissionView[]): Promise<(mission: string, group: string) => number | undefined> =>
  deadSinceOf($, board, views.flatMap(v => v.holds.map(h => h.mission)).filter(id => views.some(v => v.id === id && !v.isOpen)))

/**
 * Le dernier signe du worker de chaque groupe des missions `holders`, relu au relais (`nightDeadSince`) : seulement
 * pour un groupe qui a un signe sûr de fin, et la plus récente de ses dates relayées (fin, compte rendu, activité).
 */
const deadSinceOf = async ($: any, board: Board, ids: readonly string[], isStrict = false): Promise<(mission: string, group: string) => number | undefined> => {
  const holders = new Set(ids)
  const found = new Map<string, number>()
  for (const id of holders) {
    const run = board.runs.find(r => r.id === id)
    if (!run) continue
    // Strict (la vue) : un fichier de relais passé parce qu'il ne se lit pas cache peut-être une session relancée.
    const gaps = { count: 0 }
    const stored = await readRelay($, id, gaps).catch(() => null)
    if (isStrict && (stored === null || gaps.count > 0)) continue
    const relay = isRelay(stored, id) ? stored : null
    for (const g of run.groups ?? []) {
      const r = relayForGroup(relay, g, run.groups)
      // Un signe de fin (session finie ou compte rendu final), puis la plus récente activité relayée du groupe : un
      // worker qui travaille encore après son compte rendu, ou une session redémarrée, n'a pas fini.
      // Une dernière activité relayée sans date lisible : la session compte encore active (comme au relais), pas de signe.
      if (!r || (!isTime(r.endedAt) && !isTime(r.report?.at)) || (r.last !== undefined && !isTime(r.last.at))) continue
      let last: number | undefined
      for (const at of [r.endedAt, r.report?.at, r.at, r.last?.at]) if (isTime(at) && (last === undefined || at > last)) last = at
      if (last !== undefined) found.set(JSON.stringify([id, g.id]), last)
    }
  }
  return (mission, group) => found.get(JSON.stringify([mission, group]))
}

/**
 * Les blocages des missions en auto relevés à l'instant, chacun avec le geste de nuit qui le lève ; le verdict du
 * signal de vie de chaque mission lu à l'instant (`livenessNowOf`), sauf `isBlind` (la note d'une réouverture, qui ne
 * refuse jamais sur le verdict : les blocages d'avant le signal de vie).
 */
const nightBlocksNow = async ($: any, board: Board, now: number, isTick = false, isBlind = false): Promise<NightBlock[]> => {
  const liveness = isBlind ? undefined : await livenessNowOf($, claudeHome($), board, now)
  const views = nightViewsOf(board, { waveDue: nightWaveDue(board, now, isTick), forces: id => forcesFor(coordLive, id), plans: id => planWaitsOf(coordLive, id), ...(liveness ? { liveness } : {}) })
  return nightBlocks(views, await nightDeadSince($, board, views), now)
}

/** Les réveils de nuit envoyés d'ici : leur surveillance, les ensembles de blocages signalés, l'heure du dernier. */
let nightWake: NightWakes | null = null

/**
 * Le COO relit sa surveillance toutes les 5 s, pour la vue et le bandeau ; arrivée à son heure de fin, allumée
 * ici, il l'arrête. Hors du siège, rien n'est relu ni écrit. Pendant une surveillance valide, il réveille sa
 * discussion par le texte fixe du réveil quand il voit un ensemble de blocages nouveau (`isNightWakeDue`).
 */
const watchNight = async ($: any, board: Board) => {
  const now = await $.clock.now()
  const here = await hereId($)
  if (board.delegate || activeRun(board) || seatState(board.coo, here, now) !== 'mine') {
    if (nightNow !== null) $.ui.invalidate('ui.render')
    nightNow = null
    return
  }
  if (personStopDue && (await stopNight($, 'person')) !== 'failed') personStopDue = false
  const before = JSON.stringify(nightNow)
  const got = await readNight($, board.root)
  nightNow = got
  if (got.state === 'read' && got.watch.by === here && now >= got.watch.until) await stopNight($, 'ended')
  if (JSON.stringify(nightNow) !== before) $.ui.invalidate('ui.render')
  await quietly(() => copyNightResults($, board))
  await quietly(() => logNightCuts($, board))
  const watch = nightNow?.state === 'read' && nightShown(board, now) ? nightNow.watch.id : null
  // Hors surveillance, la mémoire de la vague s'efface : une surveillance suivante recompte ses 10 minutes.
  if (watch === null) nightWaveSeen = []
  if (watch === null || isTurnOpen) return
  const blocks = await nightBlocksNow($, board, now, true)
  noteAutoReopens(watch, blocks)
  // Dans l'app (une surface vue, hors du CLI), une mission à rouvrir reste pour le matin : le journal le note, une
  // fois par surveillance et mission, pour le résumé du matin. Avant tout dessin, la surface n'est pas connue : rien.
  if (lastSurface !== undefined && !isCliHere()) {
    for (const b of blocks.filter(x => x.act === 'reopen' && !appRefusedHere.has(`${watch}:${x.mission}`))) {
      const out = await logNight($, board.root, { at: now, watch, act: 'reopen', mission: b.mission, why: NIGHT_APP_MORNING, result: 'refused' }, lines => isReopenLogged(nightLogOf(lines, watch), b.mission, true))
      if (out !== 'failed') appRefusedHere.add(`${watch}:${b.mission}`)
    }
  }
  // Une réouverture que cette discussion ne peut pas lancer (hors du CLI) ne la réveille pas.
  const print = nightBlocksPrint(isCliHere() ? blocks : blocks.filter(b => b.act !== 'reopen'))
  if (!isNightWakeDue({ watch, isTurnOpen, print, last: nightWake, now })) return
  // Noté avant l'envoi (une relecture qui repasse pendant l'envoi ne le refait pas), retiré s'il n'est pas entré.
  const wakes = nightWake
  nightWake = withNightWake(wakes, watch, print, now)
  let isIn = false
  await quietly(async () => {
    const r = await modSubmit($, { text: NIGHT_WAKE_TEXT })
    isIn = r !== null && typeof r === 'object' && typeof r.text === 'string' && r.drop === undefined
  })
  if (!isIn) nightWake = wakes
}

/** Un message de la personne a demandé l'arrêt, qui n'a pas pu s'écrire : il se refait, et la surveillance ne vaut plus ici. */
let personStopDue = false

/** La surveillance que montrent la vue et le bandeau : allumée et encore valide d'après le siège d'ici. */
const nightShown = (board: Board, now: number): { until: number } | undefined => {
  if (nightNow?.state !== 'read' || personStopDue) return undefined
  return nightValidity(nightNow, board.coo, now).ok ? { until: nightNow.watch.until } : undefined
}

/** `coordinate.nightOn` : seulement dans le tour ouvert par `/flow-board:nuit` tapé par la personne. */
const recordNightOn = async ($: any): Promise<string> => {
  if (nightArm?.phase !== 'started') return `Refused: the night watch can be switched on only in the turn opened by /${NIGHT_SKILL} typed by the user (or by « 🌙 Surveillance de nuit » in the Coordination view); nothing written.`
  const { out, until } = await startNight($, 'command')
  if (out === 'on') return `Night watch on until ${hhmmOf(until!)} (local time); the user's next message here stops it. Tell the user so.`
  if (out === 'already') return `The night watch is already on, until ${hhmmOf(until!)} (local time): nothing replaced.`
  if (out === 'unread') return 'Not switched on: the night watch record could not be read; nothing is written over it.'
  if (out === 'not-seat') return 'Not switched on: this discussion does not hold the COO seat.'
  if (out === 'board-unread') return `Not switched on: ${SEAT_UNREAD}`
  return 'Not switched on: the night watch could not be written; the user can click « 🌙 Surveillance de nuit » again.'
}

/** Le toast d'un allumage par « Confirmer ». */
const nightClickToast = (out: Awaited<ReturnType<typeof startNight>>): string => {
  if (out.out === 'on') return `🌙 Surveillance de nuit allumée jusqu’à ${hhmmOf(out.until!)}.`
  if (out.out === 'already') return `🌙 Surveillance de nuit déjà allumée, jusqu’à ${hhmmOf(out.until!)}.`
  if (out.out === 'unread') return '🌙 Surveillance de nuit illisible : rien n’est allumé ni écrit par-dessus.'
  if (out.out === 'not-seat') return '◆ Cette discussion ne tient plus le siège du COO : rien n’est fait.'
  if (out.out === 'board-unread') return `◆ ${SEAT_UNREAD}`
  return '🌙 Surveillance de nuit non allumée : l’écriture a échoué, reclique.'
}

/** Le toast de « Arrêter ». */
type NightStopOut = 'stopped' | 'none' | 'unread' | 'failed'
const NIGHT_STOP_TOAST: Record<NightStopOut, string> = {
  stopped: '🌙 Surveillance de nuit arrêtée.',
  none: '🌙 Aucune surveillance de nuit allumée ici : rien n’est arrêté.',
  unread: '🌙 Surveillance de nuit illisible : elle vaut éteinte, rien n’est écrit par-dessus.',
  failed: '🌙 L’arrêt de la surveillance de nuit n’a pas pu s’écrire : reclique « Arrêter ».',
}

/** L'heure d'une date, comme la vue Coordination. */
const hhmmOf = (at: number): string => new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Ce qu'une écriture du COO a donné. */
type CoordWrite = 'ok' | 'none' | 'board-unread' | 'not-seat' | 'unread' | 'refused' | 'full' | 'failed'

/** Les écritures du COO, une à la fois et dans l'ordre : chacune relit le fichier que la précédente a écrit. */
let coordChain: Promise<unknown> = Promise.resolve()

/**
 * Écrit le fichier de coordination, par le seul titulaire du siège, relu juste avant (et relu encore
 * juste avant l'écriture elle-même). Le fichier est relu d'abord : illisible, rien ne s'écrit (sa copie
 * est gardée) ; les entrées des missions effacées partent ; `change` ajoute (null : rien à ajouter) ; une
 * écriture qui perdrait une autre entrée est refusée. `fresh` : la personne a cliqué « Repartir d'un
 * fichier neuf » sur un fichier illisible ; seulement s'il l'est encore.
 */
const writeCoordination = ($: any, change: (entries: unknown[], stored: Board | null) => unknown[] | null, fresh = false, isReleased: (raw: unknown) => boolean = () => false): Promise<CoordWrite> => {
  const run = async (): Promise<CoordWrite> => {
    const seat = await seatForWrite($)
    if (!seat.ok) return seat.why === 'unread' ? 'board-unread' : 'not-seat'
    const root = seat.local.root
    const got = await readCoordination($, root)
    if (got.state === 'unread' && !fresh) {
      const aside = await keepCoordAside($, root, got.text)
      coordNow = { state: 'unread', ...((aside ?? coordAside?.place) ? { aside: aside ?? coordAside?.place } : {}), count: 0 }
      return 'unread'
    }
    if (fresh && got.state !== 'unread') return 'none'
    // Repartir de zéro seulement sur un texte relu à l'instant, et une fois sa copie gardée à côté (sur le poste ou dans `$.store`).
    if (fresh && (await keepCoordAside($, root, got.text)) === undefined) return 'failed'
    const before = got.state === 'read' ? got.file.entries : []
    const erased = await erasedRunsOf($, [seat.local, seat.stored])
    const present = new Set([...seat.local.runs, ...(seat.stored?.runs ?? [])].map(r => r.id))
    const isGone = (id: string): boolean => erased.has(id) && !present.has(id)
    const base = withoutGone(before, isGone)
    const added = change(base, seat.stored)
    if (added === null && base.length === before.length && !fresh) return 'none'
    const after = added ?? base
    if (!fresh && !keepsEntries(before, after, isGone, isReleased)) return 'refused'
    if (after.length > COORD_MAX && after.length > base.length) return 'full'
    // Le siège relu une dernière fois : une reprise faite pendant la relecture arrête l'écriture.
    const last = await seatForWrite($)
    if (!last.ok) return last.why === 'unread' ? 'board-unread' : 'not-seat'
    const file = { v: 1, root: normRoot(root), entries: after }
    try {
      const path = coordinationPath($, root)
      if (path) await $.fs.write(path, JSON.stringify(file))
      else await $.store.set(coordinationStoreKey(root), file)
    } catch {
      return 'failed'
    }
    coordNow = { state: 'read', count: after.length }
    return 'ok'
  }
  const next = coordChain.then(run, run)
  coordChain = next.catch(() => undefined)
  return next
}

/** Le COO relit son fichier toutes les 5 s : sa lecture pour la vue et le relevé ; les entrées des missions effacées en partent. */
const watchCoordination = async ($: any, board: Board, isTick = false) => {
  if (seatState(board.coo, await hereId($), await $.clock.now()) !== 'mine') {
    coordNow = null
    // La liste relue pendant le siège ne sert plus : rien ne se fonde sur une copie figée (vue, coches, relevé).
    waitlistNow = null
    waitlistWhereNow = null
    return
  }
  // Les missions qui attendent la personne : une notification par attente, que le fichier de coordination se lise ou non.
  await quietly(() => notifyWaiting($, board))
  // La liste d'attente des rétros ne dépend pas du fichier de coordination : appliquée même quand il ne se lit pas.
  await quietly(() => applyWaitlist($))
  // L'ancien état des cartes de cette discussion copié dans la liste avant toute pose de carte du relevé (D2).
  const isCopied = isTick && (await surveyCards($).catch(() => 'failed')) === 'ok'
  // Les pistes des missions « Pistes de rétro » finies : après les boîtes, sur la liste qu'elles viennent d'écrire.
  if (isCopied) await quietly(() => finishPistesMissions($))
  // La carte de rétro de chaque mission close qui y a droit, livrée ou non : sur le fichier des missions relu (le tick
  // n'appelle ce relevé qu'après une lecture réussie), sans dépendre du fichier de coordination.
  if (isCopied) await quietly(() => offerDueRetros($, board))
  // La fin des rétros lancées par leur carte : après l'application des boîtes (les marques relues dans la liste).
  if (isTick) await quietly(() => finishRetros($, board))
  const got = await readCoordination($, board.root)
  if (got.state === 'unread') {
    const aside = await keepCoordAside($, board.root, got.text)
    coordNow = { state: 'unread', ...((aside ?? coordAside?.place) ? { aside: aside ?? coordAside?.place } : {}), count: 0 }
    // Illisible : aucun forçage ne s'applique, comme chez les managers.
    coordLive = []
    return
  }
  const entries = got.state === 'read' ? got.file.entries : []
  coordNow = { state: got.state, count: entries.length }
  // Relu de nouveau : la copie d'un illisible d'avant ne se montre plus.
  coordAside = null
  const erased = await erasedRunsOf($, [board])
  coordLive = liveEntries(entries, id => erased.has(id))
  coordRawNow = entries
  coordPlanBad = entries.some(e => isPlanEntry(e) && soundEntry(e) === null)
  // Les rapports à valider, relus avec le fichier : la vue montre la version que ce clic validera.
  await quietly(() => watchReports($, board))
  // Les décisions nouvelles des missions, que le Claude du COO compare ; une opposition dont la mission est close ou archivée passe à l'autre.
  await quietly(() => watchDecisions($, board))
  await quietly(() => carryContradictions($, board))
  // La livraison : ce que la carte dira avant le clic, puis l'étape suivante d'une livraison armée ici.
  await quietly(() => measureDeliveryPreview($, board))
  // Les commits hors mission sur les fichiers des groupes en cours (décision R6 (a) de la rétro « Coordinateur de parcours »).
  await quietly(() => measureOutsideCommits($, board))
  if (isTick) await quietly(() => continueDelivery($))
  // Son contexte lourd et rien n'attend la personne : le COO se compacte, sur le fichier relu à l'instant (illisible,
  // on ne sait pas si une vague se lance : jamais) ; seulement à la relecture des 5 s, jamais pendant l'envoi d'un
  // message (le tour n'est pas encore ouvert, Claude n'est déjà plus au repos).
  if (isTick) await quietly(() => watchCooCompaction($, board))
  // Le plan du projet, d'office pour les missions en auto.
  await quietly(() => applyPlanToAuto($, board))
  // Les boîtes « À reprendre » : marques des déclarations recopiées, libération de celles qu'aucune boîte ne porte plus.
  await quietly(async () => {
    boxesNow = await watchBoxes($, board, coordLive)
  })
  // Les clôtures ratées de la dernière livraison poussée : reprises à chaque relevé, jusqu'à ce qu'elles tiennent.
  await quietly(() => withDeliveryLock(() => catchUpCloses($, board)))
  if (entries.length === 0) return
  const present = new Set(board.runs.map(r => r.id))
  // Une demande de clôture dont la mission est passée en pause ou close entre-temps : le COO la clôt lui-même,
  // sans l'archiver ni la marquer livrée sans livraison. D'après le fichier des missions relu
  // (pas la copie d'ici : une clôture dont l'écriture a raté s'y réécrit).
  const { board: stored, isUnread } = await readStored($, board.root)
  if (isUnread) return
  for (const e of liveEntries(entries, id => erased.has(id))) {
    if (e.kind !== 'close') continue
    const run = (stored ?? board).runs.find(r => r.id === e.run)
    if (e.doneAt !== undefined || !run || run.archivedAt !== undefined || run.status === 'active' || isCloseApplied(run, e)) continue
    const out = await closeIdle($, e.run, e.delivered, e.report)
    if (out === 'unwritten' || out === 'not-seat') return
  }
  // Les demandes faites sont notées : seulement d'après le fichier des missions relu à l'instant (une clôture
  // restée dans la mémoire d'ici, son écriture ratée, ne lève jamais la demande) ; elles ne s'appliquent plus,
  // même à une mission reprise ensuite.
  const local = ((await read($, boardAtom)) as Board | null)?.runs ?? []
  const now = await $.clock.now()
  const isDue = entries.some(e => isEntryGone(e, id => erased.has(id) && !present.has(id))) || markClosesDone(entries, e => isCloseOver(local, e), now) !== null
  if (isDue) await writeCoordination($, (base, stored) => markClosesDone(base, e => isCloseOver(stored?.runs ?? [], e), now))
}

/**
 * Le rattrapage des clôtures d'une livraison, à chaque relevé du COO : les missions de la dernière livraison
 * poussée (son état gardé, qui survit à `/reload-plugins`), sur leur rapport livré, dont la livraison a encore
 * quelque chose à clore et qui ne sont pas archivées, se closent comme livrées (invariant des missions livrées,
 * qui tient ainsi après une écriture ratée, un fichier illisible ou une discussion morte avant d'appliquer son
 * entrée) : active nulle part, par le mod du COO sur le fichier relu à l'instant ; active ailleurs, par une
 * entrée `close`, réécrite seulement quand aucune n'attend encore (une seule). Une clôture ratée en fin de
 * livraison laisse aussi son entrée, que le relevé reprend même une fois une autre livraison partie. Une mission livrée puis reprise,
 * ou dont le travail a été relancé depuis (en cours ou fini : `isReportShipped`), n'est jamais reprise ; une
 * mission reprise avant que sa clôture ait tenu l'est (invariant : « qu'elle soit ouverte, en pause ou reprise »). Rien ne
 * s'écrit pour une mission dont la livraison n'a plus rien à clore : deux relevés de suite n'écrivent rien au second.
 */
const catchUpCloses = async ($: any, board: Board) => {
  const last = await readDelivery($, board.root ?? '')
  if (!last || last === 'unread' || !isPushed(last)) return
  const { board: stored, isUnread } = await readStored($, board.root)
  if (isUnread) return
  const runs = (stored ?? board).runs
  const result = deliveredResultOf(last)
  for (const m of last.missions) {
    const run = runs.find(r => r.id === m.id)
    if (!run || run.archivedAt !== undefined || isDeliveryOver(run) || !isReportShipped(run, m.validatedAt)) continue
    if (run.status !== 'active') {
      const out = await closeIdle($, run.id, result, m.validatedAt)
      if (out === 'unwritten' || out === 'not-seat') return
      continue
    }
    if (isDeliveryWaiting(coordLive, run)) continue
    const now = await $.clock.now()
    const written = await writeCoordination($, entries => (isDeliveryWaiting(entries, run) ? null : [...entries, { id: newEntryId(now, Math.random()), kind: CLOSE_KIND, run: run.id, at: now, delivered: result, report: m.validatedAt }]))
    if (written === 'ok') await wakeManager($, run.id)
  }
}

/**
 * Une demande de clôture d'une livraison attend encore pour la mission : pas faite, et sur ce qui est parti (une
 * demande d'un rapport dont le travail a été relancé depuis ne compte pas : elle ne s'appliquera plus). Une seule
 * par mission : ni le rattrapage ni la fin d'une livraison n'en écrivent une deuxième.
 */
const isDeliveryWaiting = (entries: readonly unknown[], run: Run): boolean =>
  liveEntries(entries, () => false).some(e => e.kind === 'close' && e.run === run.id && e.doneAt === undefined && e.delivered !== undefined && isReportShipped(run, e.report))

/**
 * Une demande de clôture appliquée à la mission : avec le résultat d'une livraison, sa
 * livraison n'a plus rien à clore (`isDeliveryOver` : close comme livrée, ou livrée puis reprise), ou la mission ne
 * porte plus le rapport que la livraison a emporté (un travail relancé depuis : la demande ne s'applique plus) ;
 * sans lui, elle est close.
 */
const isCloseApplied = (run: Run, e: Pick<CoordClose, 'delivered' | 'report'>): boolean => (e.delivered ? isDeliveryOver(run) || !isReportShipped(run, e.report) : run.status === 'done')

/**
 * Les missions qu'une clôture demandée (une entrée `close` du fichier de coordination pas encore faite) ou la livraison
 * visent encore (`ArchiveScope.held`) : la livraison ouverte, ou la dernière poussée dont la clôture comme livrée n'est
 * pas encore écrite (`isDeliveryOver` faux). « ✓ Archiver » ne les archive pas sans livraison : archivée, une mission
 * n'est plus close comme livrée (le rattrapage et `closeIdle` la sautent). `isFresh` : le fichier de coordination relu
 * à l'instant (au clic), sinon la dernière lecture du relevé (l'affichage ; une entrée écrite depuis fait différer
 * l'empreinte, et le clic n'archive rien). La mission que montre la discussion du COO y est aussi (jamais archivée par
 * ces boutons). Dans le doute (l'état de la livraison ou le fichier de coordination illisibles, ou pas encore lus),
 * toutes les missions du board.
 */
const archiveHeldOf = async ($: any, board: Board, isFresh = false): Promise<Set<string>> => {
  const all = new Set(board.runs.map(r => r.id))
  const d = await readDelivery($, board.root ?? '')
  if (d === 'unread') return all
  let entries: readonly unknown[]
  if (isFresh) {
    const got = await readCoordination($, board.root ?? '')
    if (got.state === 'unread') return all
    entries = got.state === 'read' ? got.file.entries : []
  } else {
    if (coordNow === null || coordNow.state === 'unread') return all
    entries = coordLive
  }
  const closes = liveEntries(entries, () => false).flatMap(e => (e.kind === 'close' && e.doneAt === undefined ? [e.run] : []))
  // La mission que montre la discussion du COO : `archiveAwaiting` ne l'archive jamais, la vue ne la montre donc pas.
  const shown = board.activeId ? [board.activeId] : []
  const delivering = (d?.missions ?? []).flatMap(m => {
    const run = board.runs.find(r => r.id === m.id)
    return d !== null && (isDeliveryOpen(d) || (isPushed(d) && run !== undefined && !isDeliveryOver(run))) ? [m.id] : []
  })
  return new Set([...closes, ...delivering, ...shown])
}

/** Une demande de clôture qui ne s'applique plus : sa mission, relue dans `runs`, est archivée ou close comme elle le demande. */
const isCloseOver = (runs: readonly Run[], e: CoordClose): boolean => {
  const run = runs.find(r => r.id === e.run)
  return run !== undefined && (run.archivedAt !== undefined || isCloseApplied(run, e))
}

/**
 * Clôt, par le mod du COO, une mission qui n'est active nulle part (en pause, ou close sans sa livraison
 * marquée) : comme livrée avec le résultat d'une livraison (`closeDelivered`), sinon close seule (`closeIdleRun`,
 * sans marque de livraison) ; jamais archivée (invariant des missions livrées). Sur le fichier des missions relu à l'instant et fusionné
 * (jamais sur la seule copie d'ici, qui pourrait la croire encore en pause), le siège relu juste avant ; une
 * mission redevenue active sur ce fichier n'est pas touchée (pas d'écritures croisées) : elle passe par l'entrée
 * `close`. Rend ce qui s'est passé ; `closed` seulement une fois le fichier écrit.
 */
const closeIdle = async ($: any, id: string, delivered?: DeliveredResult, report?: number): Promise<'closed' | 'already' | 'stale' | 'active' | 'absent' | 'unwritten' | 'not-seat'> => {
  if (!(await pull($))) return 'unwritten'
  if (!(await seatForWrite($)).ok) return 'not-seat'
  const now = await $.clock.now()
  let seen = 'absent' as 'closed' | 'already' | 'stale' | 'active' | 'absent'
  await commit($, b => {
    const r = b.runs.find(x => x.id === id)
    // `stale` : du travail relancé depuis la livraison, que sa clôture ne marque pas livré.
    seen = !r ? 'absent' : delivered && !isReportShipped(r, report) ? 'stale' : r.archivedAt !== undefined || isCloseApplied(r, { delivered, report }) ? 'already' : r.status === 'active' ? 'active' : 'closed'
    return seen !== 'closed' ? null : delivered ? closeDelivered(b, id, now, delivered) : closeIdleRun(b, id, now)
  })
  if (seen === 'active' || seen === 'absent' || seen === 'stale') return seen
  // Déjà close ici (une écriture d'avant a raté) : la sauvegarde la porte au fichier.
  return (await saveNow($)) ? seen : 'unwritten'
}

/** Les entrées déjà appliquées pour une mission, gardées dans le stockage de la discussion du manager ; effacées avec la mission. */
export const appliedKey = (runId: string): string => `coo-applied:${runId}`
const readApplied = async ($: any, runId: string): Promise<Set<string> | null> => {
  try {
    return new Set(soundApplied(await $.store.get(appliedKey(runId))))
  } catch {
    return null
  }
}
const noteApplied = async ($: any, runId: string, id: string): Promise<boolean> => {
  try {
    const before = soundApplied(await $.store.get(appliedKey(runId)))
    await $.store.set(appliedKey(runId), [...before.filter(x => x !== id), id].slice(-COORD_MAX))
    return true
  } catch {
    return false
  }
}

/**
 * Ce que le manager a relu du fichier de coordination à la dernière relecture : `unread` tant qu'il ne
 * se lit pas (rien ne s'applique, aucune consigne n'est levée, l'auto ne lance rien), sinon ses
 * entrées vivantes. Null avant la première relecture.
 */
export type CoordSeen = { state: 'unread'; isThere?: boolean } | { state: 'read'; entries: CoordEntry[]; raw: unknown[] }
let coordSeen: CoordSeen | null = null

/**
 * Relit le fichier de coordination pour la mission portée ici. Devenu illisible : la personne le voit
 * (toast, bandeau) ; relu de nouveau : l'auto, retenu pendant ce temps, décide de nouveau.
 */
const refreshCoordSeen = async ($: any, board: Board): Promise<CoordSeen> => {
  const got = await readCoordination($, board.root)
  const was = coordSeen?.state
  if (got.state === 'unread') {
    // Le fichier existe et ne se lit pas comme le fichier de ce projet (écriture coupée, retouche) : un plan y était peut-être.
    coordSeen = { state: 'unread', isThere: got.why !== READ_FAILED }
    if (was !== 'unread') {
      $.ui.toast(`◆ ${COORD_UNREAD}`)
      $.ui.invalidate('ui.render')
    }
    return coordSeen
  }
  const erased = await erasedRunsOf($, [board])
  const wasPlanBad = isPlanUnreadHere(board)
  coordSeen = { state: 'read', entries: got.state === 'read' ? liveEntries(got.file.entries, id => erased.has(id)) : [], raw: got.state === 'read' ? got.file.entries : [] }
  // Le plan du projet de nouveau lisible (son entrée hors forme réparée) : l'auto, retenu pendant ce temps, décide de nouveau.
  if (!wasPlanBad && isPlanUnreadHere(board)) $.ui.invalidate('ui.render')
  if (was !== 'unread' && wasPlanBad && !isPlanUnreadHere(board)) {
    $.ui.invalidate('ui.render')
    scheduleAutoTurn($)
  }
  if (was === 'unread') {
    $.ui.invalidate('ui.render')
    scheduleAutoTurn($)
  }
  return coordSeen
}

/** Les messages envoyés par le mod à son Claude (vague, relais, sélection), comptés : une relecture n'en envoie qu'un. */
let modSends = 0
const modSubmit = async ($: any, payload: { text: string }) => {
  modSends += 1
  return $.prompt.submit(payload)
}

/**
 * Les coupures de l'auto (`cutAuto`) qui visent la mission portée ici, appliquées une fois chacune dans cette
 * discussion : l'auto s'éteint (`cutAutoOf`), raison « coupé par toi » ou « coupé par le COO ». Une coupure sans
 * effet (auto déjà éteint, ou rallumé après elle) se note appliquée ; une coupure qui ne s'est pas écrite ici se
 * réessaie à la relecture suivante. Une coupure ne fait qu'éteindre : aucun chemin d'ici n'allume l'auto.
 * Rend vrai quand l'auto de la mission vient d'être coupé.
 */
const applyCuts = async ($: any, runId: string, entries: readonly CoordEntry[], applied: ReadonlySet<string>): Promise<boolean> => {
  let isCut = false
  for (const e of pendingCutsFor(entries, runId, applied, await $.clock.now())) {
    const now = await $.clock.now()
    const why = e.by === 'coo' ? AUTO_STOPS.coo : AUTO_STOPS.click
    const fx = await commit($, b => cutAutoOf(b, e.run, why, e.at, now))
    const after = ((await read($, boardAtom)) as Board | null)?.runs.find(r => r.id === e.run)
    // Toujours à couper (l'écriture d'ici n'a pas abouti) : la relecture suivante réessaie.
    if (after && isCutDue(after, why, e.at)) continue
    // Un clic (« coupé par toi ») est un geste, comme « Couper l'auto » dans la mission : aucun signal ; une coupure du COO
    // est une pause, et la mission t'attend, comme après toute pause posée par le mod.
    if (fx) {
      isCut = true
      if (e.by === 'coo') await afterAutoPause($, fx)
      await saveNow($)
    }
    await noteApplied($, runId, e.id)
  }
  return isCut
}

/**
 * Le manager relit le fichier toutes les 5 s et applique, une fois, ce qui vise la mission portée ici.
 * Une lecture ratée n'applique rien et ne lève rien.
 */
const applyCoordination = async ($: any, board: Board) => {
  const run = board.delegate ? null : activeRun(board)
  // Les traces de consignes reçues qui restent à écrire, de toute mission (sortie d'ici, ou une autre devenue active) : une trace n'envoie rien.
  if (instructTraceDue.size > 0) await quietly(() => writeInstructTraces($))
  if (!run) {
    coordSeen = null
    return
  }
  const seen = await refreshCoordSeen($, board)
  if (seen.state === 'unread') return
  const entries = seen.entries
  const applied = await readApplied($, run.id)
  if (!applied) return
  // Les coupures de l'auto demandées chez le COO, d'abord : rien ne part d'après un auto qu'on a coupé.
  await quietly(() => applyCuts($, run.id, entries, applied))
  // Les vagues lancées chez le COO : ce mod lance lui-même ses groupes, une fois, s'ils partent toujours.
  // Un seul message du mod par relecture : le suivant attend la prochaine, une fois le tour du premier ouvert.
  const sends = modSends
  await quietly(() => applyWaves($, run.id, entries, applied))
  // Les gestes de nuit du COO : chacun revérifié ici avant de partir.
  if (modSends === sends) await quietly(() => applyNight($, run.id, entries, applied))
  // Les réponses et les gestes relayés par le COO : une fois chacun, sur la question au même texte.
  if (modSends === sends) await quietly(() => applyRelays($, run.id, entries, applied))
  // Les consignes transmises par le COO : une fois chacune, par un message que compose le mod.
  if (modSends === sends) await quietly(() => applyInstructs($, run.id, entries, applied))
  else await quietly(() => writeInstructTraces($))
  // Les oppositions relevées par le COO dont cette mission a décidé en second : une question bloquante, une fois.
  await quietly(() => applyContradictions($, run.id, entries, applied))
  if (modSends === sends) await quietly(() => applyPicks($, run.id, entries, applied))
  for (const entry of pendingFor(entries, run.id, applied)) {
    if (entry.kind === 'close') {
      const now = await $.clock.now()
      // Avec le résultat d'une livraison : close comme livrée ; sans lui (le geste « clore » du COO) : close seule,
      // par `finishActive`. Jamais archivée (invariant des missions livrées).
      const delivered = entry.delivered
      await commit($, b => {
        const target = b.runs.find(r => r.id === entry.run)
        if (b.activeId !== entry.run || !target || isCloseApplied(target, entry)) return null
        return delivered ? closeDelivered(b, entry.run, now, delivered) : finishActive(b, now)
      })
      const after: Board | null = await read($, boardAtom)
      const target = after?.runs.find(r => r.id === entry.run)
      // Notée appliquée une fois faite ici (ou déjà faite, ou la mission archivée entre-temps) : l'écriture du
      // fichier des missions suit, et se refait à chaque sauvegarde tant qu'elle rate ; la mission n'étant plus
      // active ici, l'entrée ne se rejoue pas.
      if (!target || target.archivedAt !== undefined || isCloseApplied(target, entry)) {
        await noteApplied($, run.id, entry.id)
        await saveNow($)
      }
    }
  }
}

/**
 * Les fichiers que les autres missions non archivées vont encore toucher (leurs groupes pas encore partis
 * ou en cours, leurs lots), calculés au moment du découpage et jamais gardés : 40 au plus, sans doublon.
 */
const otherMissionFiles = (board: Board | null, runId: string): string[] => {
  if (!board) return []
  const out: string[] = []
  for (const u of projectUnits(board)) {
    if (u.run === runId) continue
    for (const z of u.zones) if (!out.includes(z.raw) && out.length < 40) out.push(z.raw)
  }
  return out
}

/**
 * Les groupes en cours des autres missions, pour la consigne d'un skill de code seulement : sur le board
 * en mémoire, relu toutes les 5 s (pas de relecture juste avant : une consigne n'est pas un lancement) ;
 * dans un worktree dont le board n'est pas celui du dépôt principal, plus les missions du fichier de ce
 * dépôt, relu sans écriture (illisible, il ne compte pas).
 */
const inFlightFor = async ($: any, skill: string, runId: string): Promise<InFlightNote | null> => {
  if (!CODE_SKILLS.has(skill)) return null
  const board: Board | null = await read($, boardAtom)
  if (!board) return null
  const here = await sessionRoot($)
  let repoRoot = ''
  await quietly(async () => {
    repoRoot = String((await $.session.repo())?.root ?? '')
  })
  let runs = board.runs
  if (repoRoot !== '' && !sameRoot(board.root, repoRoot)) {
    const main = await peekStored($, repoRoot)
    const stored = main.value
    if (!main.isUnread && isBoardOf(stored, repoRoot)) runs = [...runs, ...stored.runs.filter(r => !runs.some(x => x.id === r.id))]
  }
  const groups = inFlightElsewhere({ ...board, runs }, runId)
  return groups.length > 0 ? { groups, isInWorktree: repoRoot !== '' && here !== '' && !sameRoot(repoRoot, here) } : null
}

/** Une vague lancée chez le COO en cours d'application ici : la relecture des 5 s suivante attend. */
let isApplyingWave = false

/**
 * Lance d'ici, en envoyant le texte (comme l'auto), les groupes `groups` de la mission portée ici que le plan et
 * les retenues font toujours partir, relus juste avant (`extra` : une paire levée pour ce seul calcul) ; `mark`
 * note l'entrée appliquée, avant l'envoi. Rend `retry` (rien n'est fait ni noté : la relecture suivante
 * réessaie), `none` (aucun ne part plus, ou un texte refusé : noté), `sent` (parti), `stopped` (un geste de nuit
 * dont la surveillance ne vaut plus juste avant l'envoi, `isStillOn` : noté, rien ne part) ou `{ dropped }` (noté,
 * mais le moteur n'a pas fait entrer le texte : les liens de ces groupes sont annulés). `night` : le geste de nuit
 * d'où il part, que l'app Desktop peut refuser (`refusedLaunch`).
 */
const launchCooGroups = async (
  $: any,
  runId: string,
  groups: readonly string[],
  mark: () => Promise<unknown>,
  extra: readonly ForcedPair[] = [],
  night?: NonNullable<typeof autoLaunch>['night'],
  isStillOn?: () => Promise<boolean | null>,
): Promise<'retry' | 'none' | 'sent' | 'stopped' | { dropped: string[] }> => {
  // Le plan illisible ici : rien ne part, sans un mot (personne n'a cliqué ici ; la carte « Ensuite » le dit déjà),
  // et la relecture suivante réessaie.
  if (isPlanUnreadHere(await read($, boardAtom))) return 'retry'
  // Le plan et les retenues relus juste avant ; illisibles, rien ne part, et la relecture suivante réessaie.
  const held = await launchHolds($, groups, true, true)
  if (held === null || isTurnOpen) return 'retry'
  const board: Board | null = await read($, boardAtom)
  const run = board ? activeRun(board) : null
  if (!board || !run || run.id !== runId || !isSafeId(run.id)) return 'retry'
  // Ce que la carte « Ensuite » proposerait maintenant (plan, retenues, groupes déjà partis de la mission compris) :
  // seuls les groupes demandés qu'elle propose encore partent.
  const outside = holdMapOf(holdsHere(board, extra))
  const rec = nextLaunchFor(run, outside)
  const allowed = rec?.kind === 'parallel' ? rec.groups : rec?.kind === 'group' && rec.isDelegable ? [rec.group] : []
  const plan = groupPlan(run, outside)
  const ready = plan ? plan.groups.filter(g => groups.includes(g.group.id) && allowed.includes(g.group.id) && isGroupId(g.group.id) && isDelegable(g) && g.open.length > 0) : []
  if (ready.length === 0) {
    await mark()
    return 'none'
  }
  const now = await $.clock.now()
  const ids = ready.map(g => g.group.id)
  // Une autre mission devenue active avant la note n'est pas touchée : rien n'est lié, et la relecture suivante réessaie.
  const noted = await linkGroups($, runId, ids, now)
  if (!noted) return 'retry'
  // Un groupe lié entre-temps (l'auto, « ↗ Worker ») ferait deux sessions : seuls partent les groupes que ce lien a posés,
  // tous ; sinon les liens posés ici s'annulent, et la relecture suivante recalcule sans lui.
  const linkedNow = (noted.groups ?? []).filter(g => ids.includes(g.id) && g.linked?.at === now).map(g => g.id)
  if (linkedNow.length !== ids.length) {
    for (const id of linkedNow) await cancelNotedLink($, runId, id, now)
    return 'retry'
  }
  // Le texte d'après la mission écrite par la note de l'envoi : le gabarit et les noms du brief sont ceux que la fermeture cherchera.
  const text = await delegationText($, noted, withNotedGroups(ready, noted, now), await writeDecidedFile($, await read($, boardAtom)), undefined, await isAutoHere($, await read($, boardAtom)))
  if (isUnsafe(text)) {
    for (const id of ids) await cancelNotedLink($, runId, id, now)
    await mark()
    return 'none'
  }
  // Un message de la personne arrivé pendant la préparation : rien ne part derrière lui, les liens s'annulent, et la
  // relecture suivante réessaie.
  if (isTurnOpen) {
    for (const id of ids) await cancelNotedLink($, runId, id, now)
    return 'retry'
  }
  // Un geste de nuit dont la surveillance s'est arrêtée pendant la préparation : rien ne part, les liens s'annulent ;
  // une lecture ratée, ou un message de la personne arrivé pendant cette relecture : rien ne part, réessayé.
  const still = isStillOn ? await isStillOn() : true
  if (still !== true || isTurnOpen) {
    for (const id of ids) await cancelNotedLink($, runId, id, now)
    if (still !== false) return 'retry'
    await mark()
    return 'stopped'
  }
  // Notée appliquée et le lien écrit avant l'envoi : une relecture qui repasse pendant l'envoi ne la rejoue pas.
  await mark()
  await saveNow($)
  let isIn = false
  // Gardée avant l'envoi, comme une vague de l'auto : l'app Desktop refuse `start_session` sur un tour envoyé au nom
  // du mod, et ce refus remet alors la même demande dans la saisie (`refusedLaunch`).
  autoLaunch = { text, turnText: text, isStarted: false, isFilled: null, ...(night ? { night } : {}) }
  await quietly(async () => {
    const r = await modSubmit($, { text })
    isIn = r !== null && typeof r === 'object' && typeof r.text === 'string' && r.drop === undefined
    // Le tour de la vague se reconnaît aussi au texte que le moteur a fait entrer.
    if (isIn && autoLaunch?.text === text && !autoLaunch.isStarted) autoLaunch.turnText = r.text
  })
  if (isIn) return 'sent'
  if (autoLaunch?.text === text) autoLaunch = null
  for (const id of ids) await cancelNotedLink($, runId, id, now)
  return { dropped: ids }
}

/**
 * Une vague lancée chez le COO (« ⇉ Lancer la vague ») pour la mission portée ici : ce mod lance lui-même
 * ses groupes, comme « ↗ Worker » mais en envoyant le texte (comme l'auto), à l'effort de la règle des
 * workers. Seulement la discussion au repos (sinon il réessaie à la relecture suivante, dans les 10 minutes
 * du clic), et seulement les groupes que le plan et les retenues font toujours partir, relus juste avant ;
 * notée appliquée avant l'envoi : jamais deux fois. Un groupe qui ne part plus ne part pas, et le COO le dit.
 */
const applyWaves = async ($: any, runId: string, entries: readonly CoordEntry[], applied: ReadonlySet<string>) => {
  // Ni pendant une évaluation de l'auto, ni pendant sa compaction : les envois du mod ne se croisent jamais.
  if (isApplyingWave || isTurnOpen || isAutoDeciding || isAutoCompacting) return
  const waves = pendingWavesFor(entries, runId, applied, await $.clock.now())
  if (waves.length === 0) return
  isApplyingWave = true
  try {
    for (const wave of waves) {
      const out = await launchCooGroups($, runId, wave.groups, () => noteApplied($, runId, wave.id))
      if (out === 'retry') return
      if (typeof out === 'object') await quietly(() => $.ui.toast(`⇉ La vague du COO n’est pas partie : ${out.dropped.join(', ')} restent à lancer (« ↗ Worker » sur leur ligne).`))
    }
  } finally {
    isApplyingWave = false
    // L'auto, retenu pendant l'envoi de la vague, décide de nouveau (sans effet dans une mission en manuel).
    scheduleAutoTurn($)
  }
}

// ─── Pistes prises ailleurs ───────────────────────────────────────────────
//
// Une piste d'une rétro que le COO a vue déjà choisie par une autre mission : une entrée « taken » du
// fichier de coordination. Le mod de la rétro la montre ainsi et la retire de ce qu'on peut découper.
// Invariant : « Une piste marquée déjà prise ailleurs n'entre jamais dans un découpage ; une marque relue
// de travers la laisse découpable et le dit, jamais l'inverse. »

// ─── Signal « t'attend » ──────────────────────────────────────────────────
//
// Une mission en manuel, ou en auto mis en pause, dont le tour est fini et dont la suite demande la
// personne. Invariant : « Un signal "t'attend" ne survit jamais à la reprise du travail de la mission, ni à
// sa pause, sa clôture, son archivage ou sa suppression ; une attente n'est notifiée qu'une fois. »

/** Ce que la mission attend de la personne à la fin d'un tour, d'après la même détection que la suggestion grisée ; null : rien. */
const waitingKind = (answer: unknown, ask: string | null, board: Board | null, sync: Pick<SyncState, 'isGitHub' | 'isVersionSet'>, security: SecurityReview): WaitsUser['kind'] | null => {
  const run = board && !board.delegate ? activeRun(board) : null
  if (!run) return null
  if (ask !== null || endsWithQuestion(answer)) return 'question'
  if (currentPhase(run).skill === 'compte-rendu' && !isReportValidated(run)) return 'report'
  const holds = holdMapOf(holdsHere(board))
  const rec = nextLaunchFor(run, holds)
  if (rec !== null && (rec.kind === 'group' || rec.kind === 'parallel')) return 'step'
  // Sa suite est un groupe retenu, ou son lot sans groupes retenu : rien à faire avant qu'il parte, pas d'« étape suivante ».
  if (rec?.kind === 'held' || (rec === null && (run.groups ?? []).length === 0 && holds.has(LOT_KEY))) return null
  return nextCommandSkill(run, { hasPullRequests: sync.isGitHub !== false, isVersionSet: sync.isVersionSet, security }, holds) !== null || currentPhase(run).status === 'done' ? 'step' : null
}

/**
 * Pose le signal sur la mission portée ici, seulement hors de l'auto actif (l'auto envoie lui-même la
 * suite). `isTurnEnd` : posé pour un tour fini, il ne se pose plus si le tour suivant a déjà commencé
 * (un message en file, une commande d'un bouton), vérifié au moment même de l'écriture.
 */
const markWaiting = async ($: any, detected: WaitsUser['kind'] | null, isTurnEnd: boolean) => {
  const board: Board | null = await read($, boardAtom)
  const run = board && !board.delegate ? activeRun(board) : null
  if (!board || !run) return
  const here = await hereId($)
  const auto = autoStateOf(run, board, here, await confirmedAtFor($, run, here)).kind
  if (auto === 'on') return
  // L'auto mis en pause : la suite revient à la personne, même quand le tour ne propose rien.
  const kind = detected ?? (auto === 'paused' ? 'step' : null)
  if (kind === null) return
  const now = await $.clock.now()
  // Revérifié au moment de l'écriture : la même mission, l'auto pas rallumé entre-temps, et (fin de tour) pas de tour suivant commencé.
  const onAt = run.auto?.onAt
  const isStill = (b: Board) => activeRun(b)?.id === run.id && activeRun(b)?.auto?.onAt === onAt
  if (await commit($, b => ((isTurnEnd && isTurnOpen) || !isStill(b) ? null : setWaitsUser(b, kind, now)))) scheduleSave($)
}

/**
 * L'auto vient de se mettre en pause (`paused` : ce que l'écriture a rendu) hors d'un tour : la suite
 * revient à la personne, la mission l'attend (l'étape suivante).
 */
const afterAutoPause = async ($: any, paused: unknown) => {
  if (paused && !isTurnOpen) await quietly(() => markWaiting($, 'step', true))
}

/**
 * Les attentes que le COO a notifiées, une clé de son stockage : la date (`since`) de la dernière, par
 * mission. Réécrite à chaque passage, réduite aux missions en cours : elle ne grandit pas avec le temps.
 */
const WAITED_KEY = 'coo-waited'

/** Les attentes notifiées d'ici : une écriture refusée du stockage ne fait pas renotifier la même attente. */
const waitedHere = new Map<string, number>()

/** Les passages de la notification, l'un après l'autre : deux relevés à la fois ne notifient pas deux fois. */
let waitChain: Promise<void> = Promise.resolve()

/**
 * Le COO notifie chaque mission qui l'attend, une fois par valeur de `since` ; une mission en auto
 * actif garde seule la notification de ses questions bloquantes.
 */
const notifyWaiting = ($: any, board: Board): Promise<void> => {
  const pass = waitChain.then(() => notifyWaitingNow($, board))
  waitChain = pass.catch(() => undefined)
  return pass
}

const notifyWaitingNow = async ($: any, board: Board) => {
  if (seatState(board.coo, await hereId($), await $.clock.now()) !== 'mine') return
  const live = board.runs.filter(r => r.status === 'active' && r.archivedAt === undefined && isSafeId(r.id))
  let seen: Record<string, number> = {}
  await quietly(async () => {
    const got = await $.store.get(WAITED_KEY)
    if (got && typeof got === 'object' && !Array.isArray(got)) seen = got as Record<string, number>
  })
  const kept: Record<string, number> = {}
  const due: Run[] = []
  for (const run of live) {
    const w = soundWaitsUser(run.waitsUser)
    // La plus récente des attentes notifiées, d'ici ou d'ailleurs (le siège a pu passer) : une attente
    // qui n'est pas plus récente l'a déjà été, même relue sur un board d'avant.
    const marks = [waitedHere.get(run.id), seen[run.id]].filter((at): at is number => typeof at === 'number' && Number.isFinite(at))
    const before = marks.length > 0 ? Math.max(marks[0]!, marks[1] ?? marks[0]!) : undefined
    if (before !== undefined) kept[run.id] = before
    if (!w || (before !== undefined && w.since <= before)) continue
    kept[run.id] = w.since
    waitedHere.set(run.id, w.since)
    due.push(run)
  }
  for (const id of [...waitedHere.keys()]) if (!live.some(r => r.id === id)) waitedHere.delete(id)
  const isSame = Object.keys(kept).length === Object.keys(seen).length && Object.entries(kept).every(([id, at]) => seen[id] === at)
  if (!isSame) await quietly(() => $.store.set(WAITED_KEY, kept))
  if (due.length > 0) await notifyAll($, due.map(run => `Mission ${clip(neutralInPrompt(run.title), 80)} : elle t'attend`))
}

/**
 * Les pistes de la rétro d'une mission : celles de sa dernière phase de rétro commencée (la phase en cours
 * ou une d'avant), jamais celles d'une autre phase, qui peuvent porter les mêmes ids.
 */
const retroItems = (run: Run): FlowItem[] => run.phases.slice(0, run.cursor + 1).reverse().find(p => p.skill === 'retro')?.items ?? []

/**
 * Les pistes de la mission portée ici (ou de `target`, la mission que l'appel reprend) déjà prises
 * ailleurs, d'après la dernière relecture ; et ce qui ne s'est pas lu.
 */
const takenHere = (board: Board | null, target?: Run | null): { taken: Map<string, { run: string; ticket: string }>; unread: 'file' | number | null } => {
  const run = target !== undefined ? target : board && !board.delegate ? activeRun(board) : null
  if (!run || coordSeen === null) return { taken: new Map(), unread: null }
  if (coordSeen.state === 'unread') return { taken: new Map(), unread: 'file' }
  const taken = takenFor(coordSeen.entries, run.id, retroItems(run))
  const bad = unreadTakenFor(coordSeen.raw, run.id) + (taken.lost ?? 0)
  return { taken, unread: bad > 0 ? bad : null }
}

/**
 * L'appel de l'outil ferait avancer (`items`, « en cours » ou « faite ») une piste marquée prise ailleurs :
 * sous son id marqué, ou sous un autre id avec le libellé jugé. Rend le refus de tout l'appel, ou ''.
 */
const takenMoves = (input: Readonly<Record<string, unknown>>, board: Board | null): string => {
  if (!Array.isArray(input.items)) return ''
  // La mission que l'appel fait avancer : celle qu'il reprend (`resume`), aucune s'il en ouvre une nouvelle (`open`), sinon l'active.
  const resumed = typeof input.resume === 'string' ? input.resume.trim() : ''
  const isOpen = input.open !== undefined && input.open !== null
  const run = !board || board.delegate || isOpen ? null : resumed !== '' ? (board.runs.find(r => r.id === resumed) ?? null) : activeRun(board)
  if (!run || coordSeen?.state !== 'read') return ''
  const taken = takenHere(board, run).taken
  const labels = takenLabels(coordSeen.entries, run.id)
  const moved = input.items.flatMap(raw => {
    const x = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    if (x.status !== 'doing' && x.status !== 'done') return []
    const label = typeof x.label === 'string' ? x.label : undefined
    const isTaken = (typeof x.id === 'string' && taken.has(x.id) && (label === undefined || retroItems(run).some(i => i.id === x.id && sameLabel(i.label, label)))) || (label !== undefined && labels.some(l => sameLabel(l, label)))
    return isTaken ? [typeof x.id === 'string' ? x.id : '?'] : []
  })
  if (moved.length === 0) return ''
  return `Refused, nothing of this call was recorded: ${moved.map(id => `piste ${neutralInPrompt(clip(id, 40))}`).join(', ')} ${moved.length > 1 ? 'are' : 'is'} marked taken elsewhere by the COO and never enters a cut. Send the call again with ${moved.length > 1 ? 'these pistes' : 'this piste'} left « todo », without any ticket for ${moved.length > 1 ? 'them' : 'it'}.`
}

/** Les pistes prises ailleurs, pour la vue : chacune avec le titre de la mission qui la porte (relu) et son ticket. */
const takenView = (board: Board | null): { taken: { item: string; title: string; ticket: string }[]; takenNote?: string } => {
  const here = takenHere(board)
  const taken = [...here.taken].map(([item, by]) => ({ item, title: board?.runs.find(r => r.id === by.run)?.title ?? by.run, ticket: by.ticket }))
  const takenNote =
    here.unread === 'file'
      ? 'Fichier de coordination illisible : les pistes déjà prises ailleurs ne se voient pas, toutes restent découpables.'
      : typeof here.unread === 'number'
        ? `${here.unread} marque${here.unread > 1 ? 's' : ''} de piste illisible${here.unread > 1 ? 's' : ''} : ${here.unread > 1 ? 'leurs pistes restent découpables' : 'sa piste reste découpable'}.`
        : undefined
  return { taken, ...(takenNote ? { takenNote } : {}) }
}

/**
 * En auto, chaque piste que le COO a marquée prise ailleurs se déclare dans « Décidé sans toi », une fois
 * (l'id de la marque noté dans le stockage, comme une consigne appliquée).
 */
const declareTaken = async ($: any, board: Board) => {
  const run = activeRun(board)
  if (!run || board.delegate || !isAutoOn(run) || coordSeen?.state !== 'read') return
  const applied = await readApplied($, run.id)
  if (!applied) return
  const onAt = run.auto?.onAt ?? Number.POSITIVE_INFINITY
  const declared = new Set<string>()
  for (const e of coordSeen.entries) {
    // Une marque posée pendant l'auto, sur une piste encore « à faire », une fois par piste.
    if (e.kind !== 'taken' || e.run !== run.id || applied.has(e.id) || e.at < onAt) continue
    const pisteId = [...takenFor([e], run.id, retroItems(run)).keys()][0]
    const piste = retroItems(run).find(i => i.id === pisteId)
    const isDeclared = declared.has(piste?.id ?? '') || (run.decided ?? []).some(d => typeof d.what === 'string' && d.what.startsWith(`Piste ${piste?.id} déjà prise`))
    if (!piste || piste.status !== 'todo' || isDeclared) {
      await noteApplied($, run.id, e.id)
      continue
    }
    declared.add(piste.id)
    const title = board.runs.find(r => r.id === e.by.run)?.title ?? e.by.run
    const now = await $.clock.now()
    const what = `Piste ${piste.id} déjà prise par « ${neutralLine(clip(title, 60))} », ticket ${e.by.ticket} : retirée du découpage`
    const fx = await commit($, b => {
      const live = activeRun(b)
      if (!live || live.id !== run.id) return null
      const next = JSON.parse(JSON.stringify(b)) as Board
      const r = activeRun(next)!
      r.decided = [...(r.decided ?? []), { at: now, what, why: 'Marque du COO (piste prise ailleurs)', origin: 'recommendation' }]
      r.updatedAt = now
      return { board: next, fx: noFx() }
    })
    if (fx) await noteApplied($, run.id, e.id)
  }
}

// ─── Retenues entre missions ──────────────────────────────────────────────
//
// Calculées par chaque lecteur sur le fichier des missions (`outsideHolds`), jamais enregistrées ; les
// forçages viennent de la mission (`forced`) et du fichier de coordination (relu à la dernière relecture :
// illisible, aucun forçage ne s'applique, et toute retenue reste).

/** Les forçages du fichier de coordination pour la mission `runId`. */
const coordForces = (runId: string): ForcedPair[] => (coordSeen?.state === 'read' ? forcesFor(coordSeen.entries, runId) : [])

/**
 * Les retenues de la mission portée ici, sur ce board : celles des fichiers et des ressources, puis les
 * attentes du plan des vagues du projet validé (relues du fichier de coordination) ; aucune dans un worker
 * ou sans mission. `extra` : une paire levée pour ce seul calcul (le forçage d'un geste de nuit), jamais écrite.
 */
const holdsHere = (board: Board | null, extra: readonly ForcedPair[] = []): OutsideHold[] => {
  const run = board && !board.delegate ? activeRun(board) : null
  if (!board || !run) return []
  const forces = [...coordForces(run.id), ...extra]
  const plan = coordSeen?.state === 'read' ? planHolds(board, run.id, planWaitsOf(coordSeen.entries, run.id), forces) : []
  return [...outsideHolds(board, run.id, forces), ...plan]
}

/** Ce que dit un lancement quand le plan du projet ne se lit pas. */
const PLAN_UNREAD = `${PLAN_UNREAD_TEXT}.`

/**
 * Le plan du projet ne se lit pas pour la mission portée ici : le fichier de coordination est illisible,
 * ou une de ses entrées de plan qui la vise (ou ne vise aucune mission lisible) est hors forme. Rien ne
 * part alors (invariant du plan) ; tout repart à la relecture réussie.
 */
const isPlanUnreadHere = (board: Board | null): boolean => {
  const run = board && !board.delegate ? activeRun(board) : null
  if (!board || !run || coordSeen === null) return false
  // Seul un projet qui a un COO (un siège, même libre ou hors forme, dans le fichier des missions) a un fichier de
  // coordination, donc un plan : un siège présent suffit, sa forme ne compte pas.
  if (coordSeen.state === 'unread') return coordSeen.isThere === true || (board.coo !== undefined && board.coo !== null)
  return isPlanUnreadFor(coordSeen.raw, run.id)
}

/** Une unité d'une retenue, dite à la personne : « groupe A », ou « le lot » pour un lot sans groupes. */
const unitName = (key: string): string => (key === LOT_KEY ? 'le lot' : `groupe ${key}`)

/** Une retenue, dite à la personne : ce qui attend, quoi et de quelle mission, et ce qu'ils ont en commun (titres neutralisés). */
const holdLine = (h: OutsideHold): string => `${unitName(h.held)} attend ${unitName(h.group)} de « ${neutralLine(clip(h.title, 60))} » (${h.on === 'plan' ? 'plan du projet' : `${neutralLine(clip(h.shared, 40))} en commun`})`

/**
 * Juste avant un lancement (un groupe, un lot parallèle, le lot sans groupes) : le fichier des missions et
 * celui de coordination relus. Null quand le fichier des missions ne se lit pas (rien ne part) ; sinon les
 * retenues des unités nommées, dites par un toast. `isBackground` : un départ que personne n'a demandé ici
 * (une vague lancée chez le COO, relue toutes les 5 s) ne dit rien et ne change pas la carte « Ensuite ».
 */
const launchHolds = async ($: any, units: readonly string[], isQuiet = false, isBackground = false): Promise<OutsideHold[] | null> => {
  if (!(await pull($))) {
    if (isBackground) return null
    launchUnread = true
    await quietly(() => $.ui.toast('⏸ Fichier des missions illisible : rien ne part, réessaie.'))
    $.ui.invalidate('ui.render')
    return null
  }
  if (!isBackground) launchUnread = false
  const board: Board | null = await read($, boardAtom)
  if (board && activeRun(board)) await refreshCoordSeen($, board)
  // Le plan du projet illisible (le fichier de coordination, ou une entrée de plan) : rien ne part, même à la main.
  if (isPlanUnreadHere(board)) {
    if (!isBackground) await quietly(() => $.ui.toast(`⏸ ${PLAN_UNREAD}`))
    return null
  }
  const held = holdsHere(board).filter(h => units.includes(h.held))
  if (held.length > 0 && !isQuiet) await quietly(() => $.ui.toast(`⏸ Retenu : ${held.map(holdLine).join(' ; ')}. « ⇥ Forcer » sur sa ligne le lance quand même.`))
  return held
}

/** Les retenues vues à la dernière relecture, pour relancer l'auto quand l'une tombe. */
let heldSeen = ''

/** Les tâches externes que l'auto attendait au dernier passage du guet, avec leur mission. */
let awaitedSeen: { run: string; ids: string[] } | null = null

/** Une levée vue par le guet, gardée jusqu'à ce que l'auto ait pu décider tour fermé : sa mission et les relances déjà tentées. */
let liftedPending: { run: string; tries: number } | null = null

/** Les relances qu'une levée tente au plus, tour fermé, avant d'être oubliée (une retenue peut garder l'envoi). */
const LIFTED_TRIES = 3

/**
 * Toutes les 5 s : une tâche externe que l'auto attendait, marquée faite depuis (par l'outil flow, ou une
 * mise à jour Asana faite par Claude ; même dans un tour interrompu, qui ne relance rien), relance la
 * décision de l'auto. La levée reste en attente tant que l'auto aurait encore un envoi à faire : elle ne
 * relance que tour fermé (pendant un tour, l'auto ne décide pas), au plus `LIFTED_TRIES` fois. Ne fait que
 * relancer : le guet n'éteint ni n'allume rien lui-même ; la décision qu'il relance est celle d'une fin de
 * tour (elle peut mettre l'auto en pause sur une question ouverte) ; une action déjà marquée ne repart pas.
 */
const watchAwaited = async ($: any, board: Board) => {
  const run = activeRun(board)
  if (!run || !isAutoOn(run)) {
    awaitedSeen = null
    liftedPending = null
    return
  }
  const outside = holdMapOf(holdsHere(board))
  // Les tâches attendues se gardent d'un passage à l'autre jusqu'à leur levée : un passage où l'auto n'attend
  // rien un instant (une marque posée, une question ouverte) ne les oublie pas.
  const kept = awaitedSeen?.run === run.id ? awaitedSeen.ids : []
  const lifted = kept.filter(id => externalOf(run, id)?.status === 'done')
  const still = kept.filter(id => externalOf(run, id) !== undefined && !lifted.includes(id))
  awaitedSeen = { run: run.id, ids: [...new Set([...still, ...awaitedExternals(run, false, outside, await securityReviewNow($)).map(x => x.id)])] }
  if (liftedPending !== null && liftedPending.run !== run.id) liftedPending = null
  if (lifted.length > 0) liftedPending = { run: run.id, tries: 0 }
  // Pendant un tour, ou une évaluation empêchée (décision en cours, vague ou consigne en envoi, compaction) : on attend, sans compter d'essai.
  if (liftedPending === null || isTurnOpen || isAutoDeciding || isAutoCompacting || isApplyingWave || isApplyingRelay) return
  // La décision que prendrait l'auto lui-même (ses options, le travail de fond, les retenues entre missions).
  const decision = autoDecision(run, await autoOpts($), hasBackgroundWork, outside)
  // Rien à décider (ni envoi, ni relance, ni pause sur une question ouverte) : la levée est faite.
  if ((decision.kind === 'none' && decision.relaunch.length === 0) || liftedPending.tries >= LIFTED_TRIES || !(await isAutoHere($, board))) {
    liftedPending = null
    return
  }
  liftedPending = { ...liftedPending, tries: liftedPending.tries + 1 }
  scheduleAutoTurn($)
}
/** Le dernier lancement n'a pas pu relire le fichier des missions : la carte « Ensuite » le dit jusqu'à la relecture suivante réussie. */
let launchUnread = false

/** Toutes les 5 s : une retenue tombée (le groupe attendu clos ou annulé, un forçage) relance la décision de l'auto. */
const watchHolds = async ($: any, board: Board) => {
  const key = holdsHere(board)
    .map(h => `${h.held}>${h.run}/${h.group}`)
    .sort()
    .join(',')
  const was = heldSeen
  heldSeen = key
  if (was === key || was === '') return
  $.ui.invalidate('ui.render')
  const run = activeRun(board)
  if (run && (await isAutoHere($, board))) scheduleAutoTurn($)
}

/** « ⇥ Forcer » sur la ligne d'un groupe retenu : la seule paire nommée, écrite dans la mission par sa discussion. */
const forceHere = async ($: any, pair: ForcedPair) => {
  const now = await $.clock.now()
  const fx = await commit($, b => forceHold(b, pair, now))
  if (!fx) return
  await saveNow($)
  $.ui.toast(`⇥ Forcé : ${unitName(pair.held)} part sans attendre ${unitName(pair.group)} de l'autre mission (cette paire seulement${pair.on === 'plan' ? ', pour le plan du projet ; une retenue de fichier reste' : ''}).`)
  if (await isAutoHere($, await read($, boardAtom))) scheduleAutoTurn($, true)
}

// ─── Boîte « À reprendre » ────────────────────────────────────────────────
//
// Ce qu'un manager met de côté (`hooks/a-reprendre.ts`) : une boîte par discussion, écrite par elle seule,
// lue par le COO. Le mod du COO note une déclaration recopiée quand il la voit dans la section « À
// reprendre » de la feuille de route ; le mod de la discussion déclarante la retire alors de sa boîte, et
// seulement elle. Supprimer une mission ne touche aucune boîte.

const boxDir = ($: any): string | null => {
  const home = claudeHome($)
  return home ? `${home}/flow-board/a-reprendre` : null
}
const boxPath = ($: any, root: string, session: string): string | null => {
  const dir = boxDir($)
  return dir ? `${dir}/${coordinationName(root)}.${session}.json` : null
}
const boxStoreKey = (root: string, session: string): string => `a-reprendre:${normRoot(root)}:${session}`

/** Relit la boîte d'une discussion ; `unread` quand la lecture rate ou que le texte n'est pas sa boîte. */
const readBox = async ($: any, root: string, session: string): Promise<BoxRead & { text?: string }> => {
  let text: string
  try {
    const path = boxPath($, root, session)
    if (path) {
      if (!(await $.fs.exists(path))) return { state: 'absent' }
      text = String(await $.fs.read(path))
    } else {
      const raw = await $.store.get(boxStoreKey(root, session))
      if (raw === undefined || raw === null) return { state: 'absent' }
      text = JSON.stringify(raw)
    }
  } catch {
    return { state: 'unread' }
  }
  return { ...parseBox(text, normRoot(root), session), text }
}

/** Les écritures de la boîte d'ici, une à la fois : chacune relit la précédente. */
let boxChain: Promise<unknown> = Promise.resolve()

/**
 * Écrit la boîte de cette discussion, relue juste avant : illisible, rien ne s'écrit (une déclaration
 * n'efface jamais une boîte qu'on n'a pas lue) ; une écriture qui perdrait une déclaration pas recopiée
 * est refusée.
 */
const writeBox = ($: any, root: string, session: string, change: (items: unknown[]) => unknown[] | null, copied: ReadonlySet<string>, isFreshOnUnread = false): Promise<'ok' | 'none' | 'unread' | 'refused' | 'full' | 'failed'> => {
  const run = async () => {
    const got = await readBox($, root, session)
    // Illisible : seule une déclaration en repart, une fois la boîte copiée telle quelle à côté, jamais supprimée.
    if (got.state === 'unread') {
      if (!isFreshOnUnread || got.text === undefined) return 'unread' as const
      const now = await $.clock.now()
      const path = boxPath($, root, session)
      try {
        if (path) await $.fs.write(`${path}.illisible-${now}`, got.text)
        else await $.store.set(`${boxStoreKey(root, session)}:illisible:${now}`, got.text)
      } catch {
        return 'unread' as const
      }
    }
    const before = got.state === 'read' ? got.box.items : []
    const after = change(before)
    if (after === null) return 'none' as const
    if (!keepsItems(before, after, copied)) return 'refused' as const
    if (after.length > BOX_MAX && after.length > before.length) return 'full' as const
    const box = { v: 1, root: normRoot(root), session, items: after }
    try {
      const path = boxPath($, root, session)
      if (path) await $.fs.write(path, JSON.stringify(box))
      else await $.store.set(boxStoreKey(root, session), box)
    } catch {
      return 'failed' as const
    }
    return 'ok' as const
  }
  const next = boxChain.then(run, run)
  boxChain = next.catch(() => undefined)
  return next
}

/** Toutes les boîtes du projet sur ce poste ; `isWhole` quand chacune s'est bien relue (sinon rien ne se libère). */
const readAllBoxes = async ($: any, root: string): Promise<{ isWhole: boolean; items: (SetAside & { session: string })[]; unread: string[]; asides: string[] }> => {
  const sessions = new Set<string>()
  // Les copies des boîtes illisibles, gardées à côté : le relevé du COO les nomme.
  const asides: string[] = []
  let isWhole = true
  const dir = boxDir($)
  const prefix = `${coordinationName(root)}.`
  try {
    if (dir) {
      if (await $.fs.exists(dir)) {
        for (const x of (await $.fs.list(dir)) as { name: string; kind?: string }[]) {
          if (x.name.startsWith(prefix) && x.name.includes('.json.illisible-')) asides.push(`${dir}/${x.name}`)
          if (!x.name.startsWith(prefix) || !x.name.endsWith('.json')) continue
          const session = x.name.slice(prefix.length, -'.json'.length)
          if (isSafeId(session)) sessions.add(session)
        }
      }
    } else {
      const keyPrefix = `a-reprendre:${normRoot(root)}:`
      for (const key of (await $.store.keys()) as string[]) {
        if (key.startsWith(keyPrefix) && key.includes(':illisible:')) asides.push(key)
        else if (key.startsWith(keyPrefix) && isSafeId(key.slice(keyPrefix.length))) sessions.add(key.slice(keyPrefix.length))
      }
    }
  } catch {
    // Le dossier des boîtes ne se liste pas : le relevé le dit, au lieu de croire que rien n'attend.
    return { isWhole: false, items: [], unread: [dir ?? `a-reprendre:${normRoot(root)}:*`], asides }
  }
  const items: (SetAside & { session: string })[] = []
  const unread: string[] = []
  for (const session of sessions) {
    const got = await readBox($, root, session)
    if (got.state === 'unread') {
      isWhole = false
      unread.push(boxPath($, root, session) ?? boxStoreKey(root, session))
    }
    if (got.state !== 'read') continue
    for (const raw of got.box.items) {
      const s = soundSetAside(raw)
      if (s) items.push({ ...s, session })
    }
  }
  return { isWhole, items, unread, asides }
}

/** Le champ `setAside` de l'outil `flow` : un manager déclare ce qu'il met de côté ; la réponse le dit. */
const setAsideCall = async ($: any, input: unknown, isDelegating = false): Promise<string> => {
  const board: Board | null = await read($, boardAtom)
  if (!board || board.delegate || isDelegating) return 'Not recorded: a worker reports what it sets aside in its final report (its manager declares it).'
  if (board.cooHere !== undefined && !activeRun(board)) return 'Not recorded: the COO copies set-aside things into the roadmap itself; "setAside" is for a manager.'
  const run = activeRun(board)
  const list = Array.isArray(input) ? input : []
  const now = await $.clock.now()
  const items: SetAside[] = []
  // Ce qui n'entre pas se dit, un par un : rien ne se perd en silence.
  const refused: string[] = []
  if (list.length > 20) refused.push(`items ${21}-${list.length} (20 per call at most: send them again in another call)`)
  for (const [i, one] of list.slice(0, 20).entries()) {
    const x = one !== null && typeof one === 'object' && !Array.isArray(one) ? (one as Record<string, unknown>) : null
    const text = typeof x?.text === 'string' ? x.text.trim() : ''
    const source = typeof x?.source === 'string' ? x.source.trim().replace(/\s+/g, ' ') : ''
    if (text === '' || text.length > SET_ASIDE_TEXT_MAX) {
      refused.push(`item ${i + 1} (${x === null ? 'not an object {"text", "source"}' : text === '' ? 'empty text' : `${text.length} characters, ${SET_ASIDE_TEXT_MAX} at most: split it`})`)
      continue
    }
    items.push({ id: newSetAsideId(now, Math.random()), text, source: clip(source !== '' ? source : run ? `mission ${neutralLine(run.title)}` : 'discussion', SET_ASIDE_SOURCE_MAX), ...(run && isSafeId(run.id) ? { run: run.id } : {}), at: now })
  }
  const notKept = refused.length > 0 ? ` NOT recorded: ${refused.join('; ')}.` : ''
  if (items.length === 0) return `Nothing set aside: "setAside" takes [{"text": "<as written>", "source": "<where it comes from>"}].${notKept}`
  const out = await writeBox($, board.root, await hereId($), before => [...before, ...items], new Set(), true)
  if (out !== 'ok') return `${SET_ASIDE_UNWRITTEN} (${out === 'full' ? 'the box of this discussion is full' : out === 'unread' ? 'the box of this discussion could not be read' : 'it could not be written'})${notKept}`
  return `Set aside for the COO's « À reprendre » list: ${items.length} (${items.map(i => i.id).join(', ')}); it stays in the box of this discussion until the COO has copied it into the roadmap.${notKept}`
}

/** Toutes les 5 s, la discussion déclarante retire de sa boîte ce que le COO a noté recopié, et seulement cela. */
const pruneOwnBox = async ($: any, board: Board) => {
  if (board.delegate) return
  const session = await hereId($)
  const got = await readBox($, board.root, session)
  if (got.state !== 'read' || got.box.items.length === 0) return
  const coord = await readCoordination($, board.root)
  if (coord.state !== 'read') return
  const copied = copiedDecls(liveEntries(coord.file.entries, () => false))
  if (!got.box.items.some(raw => copied.has(soundSetAside(raw)?.id ?? ''))) return
  await writeBox($, board.root, session, items => withoutCopied(items, copied), copied)
}

/**
 * Le COO, toutes les 5 s : note recopiée chaque déclaration qu'il voit dans la section « À reprendre » de
 * la feuille de route lue, et libère la marque d'une déclaration qu'aucune boîte ne porte plus (toutes
 * les boîtes bien relues). Rend les déclarations encore à recopier, pour le relevé.
 */
const watchBoxes = async ($: any, board: Board, entries: readonly CoordEntry[]): Promise<(SetAside & { session: string; fixEntry?: string })[]> => {
  const boxes = await readAllBoxes($, board.root)
  const roadmap = roadmapNowCache?.read
  const inRoadmap = roadmap && roadmap !== 'unread' && roadmap.ok ? copiedIn(roadmap.entries, new Map(boxes.items.map(d => [d.id, d.text]))) : new Set<string>()
  const marked = copiedDecls(entries)
  const toMark = boxes.items.filter(d => inRoadmap.has(d.id) && !marked.has(d.id))
  const ids = new Set(boxes.items.map(d => d.id))
  const isReleased = (raw: unknown) => boxes.isWhole && isReleasedMark(raw, ids)
  const toRelease = boxes.isWhole && entries.some(e => e.kind === 'copied' && !ids.has(e.decl))
  if (toMark.length > 0 || toRelease) {
    const now = await $.clock.now()
    const fresh = toMark.map((d, i) => ({ id: newEntryId(now + i, Math.random()), kind: 'copied', decl: d.id, at: now }))
    await writeCoordination(
      $,
      base => {
        const kept = base.filter(raw => !isReleased(raw))
        const already = copiedDecls(liveEntries(kept, () => false))
        return [...kept, ...fresh.filter(f => !already.has(f.decl))]
      },
      false,
      isReleased,
    )
  }
  boxesUnread = boxes.unread
  boxesAside = boxes.asides
  // Ni vue dans la feuille de route, ni notée recopiée (une feuille de route illisible ne la fait pas recopier deux fois) ;
  // déjà recopiée sous un autre texte, l'entrée se corrige (le relevé le dit) au lieu d'en ajouter une autre.
  const copies = roadmap && roadmap !== 'unread' && roadmap.ok ? copiesOf(roadmap.entries) : new Map<string, { entry?: string; text: string }>()
  return boxes.items.filter(d => !inRoadmap.has(d.id) && !marked.has(d.id)).map(d => ({ ...d, ...(copies.get(d.id)?.entry ? { fixEntry: copies.get(d.id)!.entry } : {}) }))
}

/** Les copies des boîtes illisibles, gardées à côté, vues à la dernière relecture du COO. */
let boxesAside: string[] = []

/** Les boîtes qui ne se lisent pas, vues à la dernière relecture du COO : leurs déclarations n'arrivent pas, le relevé le dit. */
let boxesUnread: string[] = []

/**
 * Les comptes rendus de workers d'une mission que le COO n'a pas encore relevés (ni la mission notée
 * relevée dans le fichier de coordination) : ce que « Supprimer » emporterait sans relevé.
 */
const ungleanedReports = async ($: any, board: Board, runId: string): Promise<number> => {
  if (!isSafeId(runId) || !board.runs.some(r => r.id === runId)) return 0
  const coord = await readCoordination($, board.root)
  const run = board.runs.find(r => r.id === runId)!
  // Relevée seulement close, et après sa dernière clôture (une mission reprise depuis ne l'est plus).
  if (coord.state === 'read' && run.status === 'done' && (gleanedRuns(liveEntries(coord.file.entries, () => false)).get(runId) ?? -1) >= (run.finishedAt ?? Number.POSITIVE_INFINITY)) return 0
  return (await reportFilesOf($, runId)).length
}

/** Les déclarations encore à recopier, vues à la dernière relecture du COO. */
let boxesNow: (SetAside & { session: string; fixEntry?: string })[] = []

// ─── Liste d'attente des rétros ───────────────────────────────────────────
//
// Les pistes de toutes les rétros d'un projet (`hooks/pistes.ts`) : un fichier du poste, écrit par le seul
// mod de la discussion qui tient le siège du COO, relu avant chaque écriture. Chaque discussion dépose ses
// opérations dans sa propre boîte (un fichier par discussion, écrit par elle seule) ; le mod du COO les
// applique, une fois chacune, et note leur marque dans la liste, dans la même écriture que leur effet ; la
// discussion déposante retire de sa boîte une opération dont elle voit la marque depuis 2 minutes. Supprimer
// une mission ne touche ni la liste ni les boîtes.

const pistesDir = ($: any): string | null => {
  const home = claudeHome($)
  return home ? `${home}/flow-board/pistes` : null
}
/** La liste d'un projet sur ce poste ; null sans dossier de Claude (`$.store` alors). */
const waitlistPath = ($: any, root: string): string | null => {
  const dir = pistesDir($)
  return dir ? `${dir}/${coordinationName(root)}.json` : null
}
const waitlistStoreKey = (root: string): string => `coo-pistes:${normRoot(root)}`
/** La liste dans le projet : son chemin fixe, construit de la racine relue du projet, jamais d'une valeur venue d'une mission. */
const waitlistRepoPath = (root: string): string => `${normRoot(root)}/${WAITLIST_REPO_FILE}`
/**
 * Où vit la liste : le clic de la personne dans la vue Coordination, propre à la liste (jamais celui de la
 * feuille de route), gardé dans un fichier du poste à côté d'elle ; à défaut `$.store`.
 */
const waitlistWherePath = ($: any, root: string): string | null => {
  const dir = pistesDir($)
  return dir ? `${dir}/${coordinationName(root)}.endroit.json` : null
}
const waitlistWhereKey = (root: string): string => `coo-pistes-endroit:${normRoot(root)}`

/**
 * Relit le choix de l'endroit : null quand la lecture rate (la liste ne se lit alors nulle part, rien ne
 * s'écrit) ; absent, hors forme ou d'un autre projet : pas de choix, la liste vit sur le poste et la question
 * revient, sauf un choix présent mais hors forme quand le projet a déjà sa liste : null aussi (le fichier du
 * choix se nomme alors dans le relevé, `waitlistChoiceBroken`, pour que la personne le retire à la main).
 */
const loadWaitlistWhere = async ($: any, root: string): Promise<WaitlistWhere | null> => {
  let raw: unknown
  try {
    const path = waitlistWherePath($, root)
    if (path) {
      if (!(await $.fs.exists(path))) return 'unasked'
      const text = String(await $.fs.read(path))
      try {
        raw = JSON.parse(text)
      } catch {
        raw = text
      }
    } else raw = await $.store.get(waitlistWhereKey(root))
  } catch {
    return null
  }
  const x = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { v?: unknown; root?: unknown; where?: unknown }) : null
  if (x && x.v === 1 && x.root === normRoot(root) && (x.where === 'repo' || x.where === 'poste')) return x.where
  // Un choix présent mais hors forme alors que le projet a déjà sa liste : peut-être un choix « repo » abîmé ; la
  // copie du poste, peut-être périmée, ne se lit ni ne s'écrit alors (la liste est illisible, le relevé le dit).
  if (raw !== undefined && raw !== null && (await fileExists($, waitlistRepoPath(root))) !== false) {
    waitlistChoiceBroken = waitlistWherePath($, root) ?? waitlistWhereKey(root)
    return null
  }
  return 'unasked'
}
/** Le fichier (ou la clé) d'un choix hors forme qui rend la liste illisible, à la dernière relecture : le relevé le nomme. */
let waitlistChoiceBroken: string | undefined
const saveWaitlistWhere = async ($: any, root: string, where: 'repo' | 'poste'): Promise<boolean> => {
  const value = { v: 1, root: normRoot(root), where }
  try {
    const path = waitlistWherePath($, root)
    if (path) await $.fs.write(path, JSON.stringify(value))
    else await $.store.set(waitlistWhereKey(root), value)
    return true
  } catch {
    return false
  }
}

/** L'endroit de la liste d'après le choix relu : son fichier (null : la clé de `$.store` du poste) et la racine qu'elle porte. */
type WaitlistAt = { where: WaitlistWhere; path: string | null; root: string }
const waitlistAt = ($: any, root: string, where: WaitlistWhere): WaitlistAt =>
  where === 'repo' ? { where, path: waitlistRepoPath(root), root: WAITLIST_REPO_ROOT } : { where, path: waitlistPath($, root), root: normRoot(root) }
/**
 * Les ids des pistes que le COO a déjà vues dans la liste (une relecture qui en perd une n'est jamais écrasée) :
 * un fichier du poste à côté de la liste, commun à l'app et au terminal ; à défaut `$.store`.
 */
const waitlistSeenPath = ($: any, root: string): string | null => {
  const dir = pistesDir($)
  return dir ? `${dir}/${coordinationName(root)}.vues.json` : null
}
const waitlistSeenKey = (root: string): string => `coo-pistes-vues:${normRoot(root)}`

/** Les pistes vues ; null quand la lecture rate ou que le texte n'est pas une liste d'ids (rien ne s'écrit alors). */
const loadWaitlistSeen = async ($: any, root: string): Promise<string[] | null> => {
  try {
    const path = waitlistSeenPath($, root)
    let raw: unknown
    if (path) raw = (await $.fs.exists(path)) ? JSON.parse(String(await $.fs.read(path))) : []
    else raw = (await $.store.get(waitlistSeenKey(root))) ?? []
    // Une entrée qui n'est pas un id de piste ne compte pas (jamais une « piste perdue » qui n'a pas existé).
    return Array.isArray(raw) ? raw.filter((x): x is string => isPisteId(x)) : null
  } catch {
    return null
  }
}
const saveWaitlistSeen = async ($: any, root: string, seen: string[]): Promise<boolean> => {
  try {
    const path = waitlistSeenPath($, root)
    if (path) await $.fs.write(path, JSON.stringify(seen))
    else await $.store.set(waitlistSeenKey(root), seen)
    return true
  } catch {
    return false
  }
}
const pisteBoxDir = ($: any): string | null => {
  const dir = pistesDir($)
  return dir ? `${dir}/boites` : null
}
const pisteBoxPath = ($: any, root: string, session: string): string | null => {
  const dir = pisteBoxDir($)
  return dir ? `${dir}/${coordinationName(root)}.${session}.json` : null
}
const pisteBoxStoreKey = (root: string, session: string): string => `pistes-boite:${normRoot(root)}:${session}`

/**
 * Relit la liste là où le choix relu la met (dans le projet, ou sur le poste) ; `unread` quand le choix ou la
 * liste ne se lisent pas, ou que le texte n'est pas la liste de ce projet. `at` : l'endroit lu, où s'écrit la suite.
 */
const readWaitlist = async ($: any, root: string): Promise<WaitlistRead & { text?: string; at?: WaitlistAt }> => {
  const where = await loadWaitlistWhere($, root)
  if (where === null) return { state: 'unread' }
  const at = waitlistAt($, root, where)
  return { ...(await readWaitlistAt($, at)), at }
}
const readWaitlistAt = async ($: any, at: WaitlistAt): Promise<WaitlistRead & { text?: string }> => {
  let text: string
  try {
    if (at.path) {
      if (!(await $.fs.exists(at.path))) return { state: 'absent' }
      text = String(await $.fs.read(at.path))
    } else {
      const raw = await $.store.get(waitlistStoreKey(at.root))
      if (raw === undefined || raw === null) return { state: 'absent' }
      text = JSON.stringify(raw)
    }
  } catch {
    return { state: 'unread' }
  }
  return { ...parseWaitlist(text, at.root), text }
}

/** Relit la boîte de pistes d'une discussion ; `unread` quand la lecture rate ou que le texte n'est pas sa boîte. */
const readPisteBox = async ($: any, root: string, session: string): Promise<PisteBoxRead> => {
  let text: string
  try {
    const path = pisteBoxPath($, root, session)
    if (path) {
      if (!(await $.fs.exists(path))) return { state: 'absent' }
      text = String(await $.fs.read(path))
    } else {
      const raw = await $.store.get(pisteBoxStoreKey(root, session))
      if (raw === undefined || raw === null) return { state: 'absent' }
      text = JSON.stringify(raw)
    }
  } catch {
    return { state: 'unread' }
  }
  return parsePisteBox(text, normRoot(root), session)
}

/** Les écritures de la boîte de pistes d'ici, une à la fois : chacune relit la précédente. */
let pisteBoxChain: Promise<unknown> = Promise.resolve()

/**
 * Écrit la boîte de pistes de cette discussion, relue juste avant : illisible, rien ne s'écrit (jamais une
 * boîte neuve par-dessus) ; une écriture qui perdrait une opération pas encore appliquée est refusée.
 * `applied` : les ids des opérations de cette boîte que la liste note appliquées.
 */
const writePisteBox = ($: any, root: string, session: string, change: (ops: unknown[]) => unknown[] | null, applied: ReadonlySet<string>): Promise<'ok' | 'none' | 'unread' | 'refused' | 'full' | 'failed'> => {
  const run = async () => {
    const got = await readPisteBox($, root, session)
    if (got.state === 'unread') return 'unread' as const
    const before = got.state === 'read' ? got.box.ops : []
    const after = change(before)
    if (after === null) return 'none' as const
    if (!keepsOps(before, after, applied)) return 'refused' as const
    if (after.length > PISTE_BOX_MAX && after.length > before.length) return 'full' as const
    const box = { v: 1, root: normRoot(root), session, ops: after }
    try {
      const path = pisteBoxPath($, root, session)
      if (path) await $.fs.write(path, JSON.stringify(box))
      else await $.store.set(pisteBoxStoreKey(root, session), box)
    } catch {
      return 'failed' as const
    }
    return 'ok' as const
  }
  const next = pisteBoxChain.then(run, run)
  pisteBoxChain = next.catch(() => undefined)
  return next
}

/** Toutes les boîtes de pistes du projet sur ce poste ; `isWhole` quand chacune s'est bien relue (sinon aucune marque ne se libère). */
const readAllPisteBoxes = async ($: any, root: string): Promise<{ isWhole: boolean; ops: { raw: unknown; session: string }[]; unread: string[]; sessions: ReadonlySet<string> }> => {
  const sessions = new Set<string>()
  const dir = pisteBoxDir($)
  const prefix = `${coordinationName(root)}.`
  try {
    if (dir) {
      if (await $.fs.exists(dir)) {
        for (const x of (await $.fs.list(dir)) as { name: string }[]) {
          if (!x.name.startsWith(prefix) || !x.name.endsWith('.json')) continue
          const session = x.name.slice(prefix.length, -'.json'.length)
          if (isSafeId(session)) sessions.add(session)
        }
      }
    } else {
      const keyPrefix = `pistes-boite:${normRoot(root)}:`
      for (const key of (await $.store.keys()) as string[]) if (key.startsWith(keyPrefix) && isSafeId(key.slice(keyPrefix.length))) sessions.add(key.slice(keyPrefix.length))
    }
  } catch {
    return { isWhole: false, ops: [], unread: [dir ?? `pistes-boite:${normRoot(root)}:*`], sessions }
  }
  let isWhole = true
  const ops: { raw: unknown; session: string }[] = []
  const unread: string[] = []
  for (const session of sessions) {
    const got = await readPisteBox($, root, session)
    if (got.state === 'unread') {
      isWhole = false
      unread.push(pisteBoxPath($, root, session) ?? pisteBoxStoreKey(root, session))
    }
    if (got.state === 'read') for (const raw of got.box.ops) ops.push({ raw, session })
  }
  return { isWhole, ops, unread, sessions }
}

/**
 * Ce que le COO sait de la liste, à sa dernière relecture : pour la vue et le relevé ; `pendingBy` : les auteurs dont une opération reste sans marque
 * après lui (auteur pas prouvé, piste pas encore là), `pendingPistes` : les pistes qu'elles visent, `isWhole` : toutes les boîtes se sont lues.
 */
export type WaitlistNow = { state: 'absent' | 'read' | 'unread' | 'missing'; list?: Waitlist; aside?: string; missing?: string[]; boxesUnread: string[]; unproven?: number; seenUnread?: true; pendingBy?: string[]; pendingPistes?: string[]; isWhole?: boolean }
let waitlistNow: WaitlistNow | null = null
/**
 * Où vit la liste, à la dernière relecture du COO, la copie du poste laissée derrière un passage au projet, et
 * (sans choix ici) une liste déjà commitée dans le projet depuis un autre poste.
 */
let waitlistWhereNow: { where: WaitlistWhere; former?: string; committed?: true } | null = null
/**
 * Les commandes du shell (Bash, PowerShell) qui tournent dans cette discussion, spécialistes compris : tant qu'il y en
 * a une, le mod n'écrit pas la liste dans le projet (un `git pull` ou un commit du COO ne croise jamais une écriture).
 */
let shellRunning = 0

/** La copie de la liste restée sur le poste (fichier, ou clé de `$.store`), quand elle existe ; rien sur une lecture ratée. */
const formerWaitlist = async ($: any, root: string): Promise<string | undefined> => {
  try {
    const path = waitlistPath($, root)
    if (path) return (await $.fs.exists(path)) ? path : undefined
    const raw = await $.store.get(waitlistStoreKey(root))
    return raw === undefined || raw === null ? undefined : waitlistStoreKey(root)
  } catch {
    return undefined
  }
}

/** La copie d'une liste qu'on n'écrit pas (illisible, ou qui a perdu une piste vue), gardée à côté et jamais supprimée : une par texte relu. */
let waitlistAside: { text: string; place: string } | null = null
const keepWaitlistAside = async ($: any, root: string, text: string | undefined): Promise<string | undefined> => {
  if (text === undefined) return undefined
  if (waitlistAside?.text === text) return waitlistAside.place
  const now = await $.clock.now()
  const path = waitlistPath($, root)
  const place = path ? `${path}.illisible-${now}` : `${waitlistStoreKey(root)}:illisible:${now}`
  try {
    if (path) await $.fs.write(place, text)
    else await $.store.set(place, text)
  } catch {
    return undefined
  }
  waitlistAside = { text, place }
  return place
}

/** Le délai au-delà duquel une écriture de la liste s'abandonne : l'horloge a sauté depuis sa relecture (poste en veille). */
const WAITLIST_STALE_MS = 5000
/** Une boîte garde une opération appliquée au moins ce temps après avoir vu sa marque : une écriture périmée qui la perdrait la laisse rejouer. */
const PISTE_PRUNE_MS = 2 * 60_000
/** Quand cette discussion a vu pour la première fois la marque de chacune de ses opérations (perdu au rechargement : l'attente repart). */
const pisteMarksSeenAt = new Map<string, number>()

/** Les écritures de la liste, une à la fois : chacune relit la précédente. */
let waitlistChain: Promise<unknown> = Promise.resolve()

/** Ce que reçoit le changement d'un clic (ou du relevé) appliqué avec les boîtes : voir `applyWaitlist`. */
type WaitlistClickCtx = { copies: readonly (readonly Run[])[]; ops: readonly BoxedOp[]; isWhole: boolean; erased: ReadonlySet<string>; where?: string }
/** Ce qu'il rend en plus de la liste : voir `applyWaitlist`. */
type WaitlistClick = { list: Waitlist; viaTicket?: ReadonlySet<string>; still?: (copies: readonly (readonly Run[])[]) => boolean }

/**
 * Le COO applique les opérations des boîtes à la liste, par le seul titulaire du siège, relu juste avant et
 * juste avant l'écriture. La liste illisible, ou qui ne porte plus une piste déjà vue, n'est jamais écrite
 * (sa copie est gardée à côté, le relevé le dit) ; l'auteur de chaque opération est vérifié contre sa boîte
 * (« coo » : la boîte de cette discussion ; une mission : celle dont cette discussion est l'owner ou le
 * bornIn, d'après le fichier des missions relu), sa nature et sa carte donnés (`authorOf`, `cardOf`) ; une écriture qui perdrait une piste est refusée ; l'horloge
 * qui a sauté depuis la relecture l'abandonne. Rend les résultats par marque d'opération (vide : rien d'appliqué).
 * `click` : le changement d'un clic de la vue Coordination (le découpage, une carte retirée), appliqué après les
 * opérations des boîtes, sous les mêmes gardes et dans la même écriture ; son effet se prouve en relisant la liste.
 * Il reçoit aussi les deux copies des missions relues, les opérations des boîtes, les missions effacées et l'endroit de la liste relue, et peut
 * rendre, avec la liste, les pistes que sa garde admet d'en exécution à validée (`viaTicket`) et une condition
 * revérifiée sur les missions relues juste avant l'écriture (`still` : fausse, rien ne s'écrit).
 */
const applyWaitlist = ($: any, click?: (list: Waitlist, now: number, ctx: WaitlistClickCtx) => Waitlist | WaitlistClick): Promise<Map<string, PisteOutcome>> => {
  const run = async (): Promise<Map<string, PisteOutcome>> => {
    const none = new Map<string, PisteOutcome>()
    const seat = await seatForWrite($)
    if (!seat.ok) return none
    const root = seat.local.root
    const started = await $.clock.now()
    const boxes = await readAllPisteBoxes($, root)
    waitlistChoiceBroken = undefined
    const got = await readWaitlist($, root)
    waitlistWhereNow = got.at ? { where: got.at.where, ...(got.at.where === 'repo' ? { former: await formerWaitlist($, root) } : {}), ...(got.at.where === 'unasked' && (await fileExists($, waitlistRepoPath(root))) === true ? { committed: true as const } : {}) } : null
    if (got.state === 'unread' || !got.at) {
      const aside = await keepWaitlistAside($, root, got.text)
      waitlistNow = { state: 'unread', ...((aside ?? waitlistAside?.place) ? { aside: aside ?? waitlistAside?.place } : {}), boxesUnread: boxes.unread }
      return none
    }
    const seenRead = await loadWaitlistSeen($, root)
    // Ce que le COO a vu ne se relit pas : il n'écrit rien, faute de pouvoir dire si une piste a disparu, et le relevé le dit.
    if (seenRead === null) {
      waitlistNow = { state: got.state === 'read' ? 'read' : 'absent', ...(got.state === 'read' ? { list: got.list } : {}), boxesUnread: boxes.unread, seenUnread: true }
      return none
    }
    let seen = seenRead
    const at = got.at
    const list = got.state === 'read' ? got.list : emptyWaitlist(at.root)
    const missing = missingSeen(list, seen)
    if (missing.length > 0) {
      const aside = got.state === 'read' ? await keepWaitlistAside($, root, got.text) : undefined
      waitlistNow = { state: 'missing', list, missing, ...(aside ? { aside } : {}), boxesUnread: boxes.unread }
      return none
    }
    // Chaque liste bien relue s'ajoute aux pistes vues, même sans écriture : une liste ramenée en arrière ensuite se voit.
    const seenNow = seenAfter(seen, list)
    if (seenNow.length !== seen.length) {
      if (!(await saveWaitlistSeen($, root, seenNow))) {
        waitlistNow = { state: got.state === 'read' ? 'read' : 'absent', list, boxesUnread: boxes.unread, seenUnread: true }
        return none
      }
      seen = seenNow
    }
    const here = await hereId($)
    const runs = [...seat.local.runs, ...(seat.stored?.runs ?? [])]
    const isAuthorOf = (by: string, session: string): boolean => (by === COO_AUTHOR ? session === here : runs.some(r => r.id === by && (r.owner === session || r.bornIn === session)))
    // Une mission supprimée (sa trace ou sa pierre tombale, absente du fichier des missions) ne reviendra pas : ses
    // opérations sont refusées et marquées, pour que sa boîte s'en vide.
    const erased = await erasedRunsOf($, [seat.local, seat.stored])
    const isGone = (by: string): boolean => by !== COO_AUTHOR && erased.has(by) && !runs.some(r => r.id === by)
    // La carte du lancement vivant de la mission auteure : pour une transition d'état, et toute opération d'une autre mission.
    const cardOf = (by: string): string | undefined => {
      const r = runs.find(x => x.id === by)
      return r ? (liveLaunchOf(r)?.card ?? undefined) : undefined
    }
    // La nature de l'auteur, donnée à l'application : tout ce qui n'est ni le COO ni une rétro est une autre mission.
    const authorOf = (by: string): PisteAuthor => (by === COO_AUTHOR ? 'coo' : runs.some(r => r.id === by && isRetroRun(r)) ? 'retro' : 'other')
    const ops: BoxedOp[] = boxes.ops.flatMap(({ raw, session }) => {
      const op = soundPisteOp(raw)
      if (!op) return []
      const author = authorOf(op.by)
      const card = op.op === 'state' || author === 'other' ? cardOf(op.by) : undefined
      return [{ op, session, by: isAuthorOf(op.by, session) ? op.by : null, author, ...(isGone(op.by) ? { gone: true as const } : {}), ...(card !== undefined ? { card } : {}) }]
    })
    const now = await $.clock.now()
    const applied = applyBoxedOps(list, ops, now, boxes.isWhole)
    const clickOut = click ? click(applied.list, now, { copies: [seat.local.runs, seat.stored?.runs ?? []], ops, isWhole: boxes.isWhole, erased, where: got.at?.where }) : applied.list
    const clickRes: WaitlistClick = 'pistes' in clickOut ? { list: clickOut } : clickOut
    const clicked = clickRes.list
    const unproven = ops.filter(o => o.by === null && !o.gone && !list.applied.includes(opMark(o.session, o.op.id))).length
    // Une marque se libère quand aucune boîte, toutes bien relues, ne porte plus son opération.
    const live = new Set(ops.map(o => opMark(o.session, o.op.id)))
    // Dans le projet, la liste porte aussi les marques des discussions de l'autre poste, dont les boîtes ne sont pas
    // ici : seule une marque d'une discussion dont la boîte est sur ce poste se libère (jamais une opération rejouée là-bas).
    const isHere = (mark: string): boolean => at.where !== 'repo' || boxes.sessions.has(mark.slice(0, mark.indexOf('/')))
    const released = boxes.isWhole ? new Set([...releasableMarks(clicked.applied, live)].filter(isHere)) : new Set<string>()
    const next: Waitlist = { ...clicked, applied: clicked.applied.filter(m => !released.has(m)) }
    const unmarked = ops.filter(o => !clicked.applied.includes(opMark(o.session, o.op.id)))
    const pendingBy = [...new Set(unmarked.map(o => o.op.by))]
    const pendingPistes = [...new Set(unmarked.map(o => o.op.piste))]
    waitlistNow = { state: got.state === 'read' ? 'read' : 'absent', list, boxesUnread: boxes.unread, unproven, pendingBy, pendingPistes, isWhole: boxes.isWhole }
    if (JSON.stringify(next) === JSON.stringify(list)) return applied.outcomes
    if (!keepsPistes(list, next, released, new Set([...viaTicketOf(ops, applied.outcomes), ...(clickRes.viaTicket ?? [])]))) return none
    if ((await $.clock.now()) - started > WAITLIST_STALE_MS) return none
    const last = await seatForWrite($)
    if (!last.ok) return none
    if (clickRes.still && !clickRes.still([last.local.runs, last.stored?.runs ?? []])) return none
    // Relue juste avant l'écriture, au même endroit : changée entre-temps (un `git pull`, une autre main), rien ne
    // s'écrit, et la relecture suivante repart d'elle.
    const again = await readWaitlist($, root)
    if (again.at?.where !== at.where || again.state !== got.state || again.text !== got.text) return none
    // Une commande du shell de cette discussion en cours (le `git pull` ou le commit du COO) : rien ne s'écrit dans
    // le projet pendant qu'elle tourne (vérifié sans `await` jusqu'à l'écriture ; la commande, elle, attend l'écriture en cours).
    if (at.where === 'repo' && shellRunning > 0) return none
    try {
      if (at.path) await $.fs.write(at.path, JSON.stringify(next))
      else await $.store.set(waitlistStoreKey(root), next)
    } catch {
      return none
    }
    await saveWaitlistSeen($, root, seenAfter(seen, next))
    waitlistNow = { state: 'read', list: next, boxesUnread: boxes.unread, unproven, pendingBy, pendingPistes, isWhole: boxes.isWhole }
    return applied.outcomes
  }
  const next = waitlistChain.then(run, run)
  waitlistChain = next.catch(() => undefined)
  return next
}

/**
 * Le clic « Commiter dans travail/ » ou « Garder sur le poste » de la vue Coordination : le choix de l'endroit
 * de la liste, par le seul titulaire du siège, une fois (rien ne le défait depuis la vue), dans la file des
 * écritures de la liste. Vers le projet : la liste du poste y est recopiée quand le projet n'en a pas (racine
 * fixe, la copie relue avant que le choix s'écrive), et la copie du poste reste ; le projet qui a déjà la sienne
 * (commitée depuis un autre poste) n'est pris que s'il porte chaque piste et chaque marque d'ici telles quelles,
 * sinon rien ne change (jamais une liste écrasée ni unie en silence). Rend le texte du toast.
 */
const chooseWaitlistWhere = ($: any, where: 'repo' | 'poste'): Promise<string> => {
  const run = async (): Promise<string> => {
    const seat = await seatForWrite($)
    if (!seat.ok) return '◆ Rien n’est changé : cette discussion ne tient plus le siège du COO.'
    const root = seat.local.root
    const now = await loadWaitlistWhere($, root)
    if (now === null) return '◆ Rien n’est changé : le choix de l’endroit de la liste ne se lit pas, réessaie.'
    if (now !== 'unasked') return '◆ Rien n’est changé : l’endroit de la liste d’attente est déjà choisi.'
    if (where === 'repo') {
      const local = await readWaitlistAt($, waitlistAt($, root, 'poste'))
      if (local.state === 'unread') return '◆ Rien n’est changé : la liste d’attente de ce poste ne se lit pas.'
    // Une liste du poste qui a perdu une piste déjà vue ne part jamais dans le projet : elle y deviendrait la liste de référence.
    const seen = await loadWaitlistSeen($, root)
    if (seen === null) return '◆ Rien n’est changé : les pistes déjà vues de ce poste ne se lisent pas.'
    if (local.state === 'read' && missingSeen(local.list, seen).length > 0) return '◆ Rien n’est changé : la liste d’attente de ce poste a perdu des pistes déjà vues ; elle ne part pas dans le projet.'
      const at = waitlistAt($, root, 'repo')
      const there = await readWaitlistAt($, at)
      if (there.state === 'unread') return `◆ Rien n’est changé : la liste du projet (${WAITLIST_REPO_FILE}) ne se lit pas.`
      if (there.state === 'read') {
        if (local.state === 'read' && !holdsWaitlist(there.list, { ...local.list, root: WAITLIST_REPO_ROOT })) return `◆ Rien n’est changé : la liste du projet (${WAITLIST_REPO_FILE}) ne porte pas chaque piste de ce poste telle quelle ; demande à Claude de les comparer.`
      } else if (local.state === 'read') {
        const copy = JSON.stringify({ ...local.list, root: WAITLIST_REPO_ROOT })
        if (shellRunning > 0) return '◆ Rien n’est changé : une commande du shell tourne dans cette discussion ; reclique quand elle a fini.'
        try {
          await $.fs.write(at.path!, copy)
        } catch {
          return '◆ Rien n’est changé : la liste n’a pas pu s’écrire dans le projet, réessaie.'
        }
        const back = await readWaitlistAt($, at)
        if (back.state !== 'read' || back.text !== copy) return `◆ Choix non fait : la copie écrite dans le projet (${WAITLIST_REPO_FILE}) ne se relit pas telle qu’écrite. Elle y reste : ne la commite pas ; retire-la à la main, puis reclique.`
      }
    }
    if (!(await saveWaitlistWhere($, root, where)))
      return where === 'repo' ? `◆ Choix non fait : il n’a pas pu s’écrire. La liste recopiée reste dans le projet (${WAITLIST_REPO_FILE}) : ne la commite pas ; reclique (elle sera reprise si la liste de ce poste n’a pas changé), ou retire-la à la main.` : '◆ Rien n’est changé : le choix n’a pas pu s’écrire, réessaie.'
    return where === 'repo' ? `◆ Liste d’attente des rétros : elle vivra sous travail/ de ce projet (${WAITLIST_REPO_FILE}) ; la copie de ce poste reste.` : '◆ Liste d’attente des rétros : gardée sur ce poste, jamais commitée.'
  }
  const next = waitlistChain.then(run, run)
  waitlistChain = next.catch(() => undefined)
  return next
}

/**
 * Toutes les 5 s, chaque discussion retire de sa boîte de pistes les opérations dont elle voit la marque dans
 * la liste depuis au moins 2 minutes, et seulement elles ; une liste qui ne se lit pas ne retire rien.
 */
const prunePisteBox = async ($: any, board: Board) => {
  if (board.delegate) return
  const session = await hereId($)
  const got = await readPisteBox($, board.root, session)
  if (got.state !== 'read' || got.box.ops.length === 0) return
  const list = await readWaitlist($, board.root)
  if (list.state !== 'read') return
  const marks = new Set(list.list.applied)
  const now = await $.clock.now()
  const ripe = new Set<string>()
  for (const raw of got.box.ops) {
    const op = soundPisteOp(raw)
    if (!op) continue
    const mark = opMark(session, op.id)
    if (!marks.has(mark)) {
      pisteMarksSeenAt.delete(mark)
      continue
    }
    const since = pisteMarksSeenAt.get(mark) ?? now
    pisteMarksSeenAt.set(mark, since)
    if (now - since >= PISTE_PRUNE_MS) ripe.add(op.id)
  }
  if (ripe.size === 0) return
  const out = await writePisteBox($, board.root, session, ops => withoutApplied(ops, ripe), ripe)
  if (out === 'ok') for (const id of ripe) pisteMarksSeenAt.delete(opMark(session, id))
}

/** La liste d'attente pour le relevé et la vue du COO ; rien tant qu'elle n'existe pas et que toutes les boîtes se lisent. */
const cooWaitlistOf = (): CooWaitlist | undefined => {
  const w = waitlistNow
  if (!w || (w.state === 'absent' && w.boxesUnread.length === 0 && !w.seenUnread && !waitlistWhereNow?.committed)) return undefined
  const where = waitlistWhereNow
  const broken = waitlistChoiceBroken
  return { ...(broken ? { choiceBroken: broken } : {}), state: w.state, pistes: w.list ? pistesOf(w.list) : [], refused: w.list?.refused ?? [], ...(w.aside ? { aside: w.aside } : {}), ...(w.missing ? { missing: w.missing } : {}), boxesUnread: w.boxesUnread, ...(w.unproven ? { unproven: w.unproven } : {}), ...(w.seenUnread ? { seenUnread: true as const } : {}), ...(where ? { where: where.where, ...(where.former ? { former: where.former } : {}), ...(where.committed ? { committed: true as const } : {}) } : {}), ...(pistesLeftNow.length > 0 ? { left: pistesLeftNow } : {}) }
}

/** Ce que la ligne « Pistes : » des tickets n'a pas rattaché, déjà dit au manager (une fois par avertissement et par mission). */
const pistesWarned = new Set<string>()
/** Ce qui reste à dire au manager, à la fin de la prochaine réponse de l'outil `flow` dans cette discussion. */
let pistesToWarn: string[] = []
/** Les transitions que le COO a refusées à cette discussion, avec l'état qu'avait la piste : pas redéposées tant qu'il ne change pas. */
const pistesRefusedMoves = new Map<string, string>()

/**
 * Les lignes « Pistes : » des fichiers de tickets d'un lot (`travail/<dossier>/issues/<NN>-*.md`, le dossier tiré
 * d'un lancement relu, contrôlé par sa forme) : un dossier absent ne rend aucun lien ; un fichier illisible rend la
 * lecture incomplète ; un dossier qui ne se liste pas rend null.
 */
const readLotLinks = async ($: any, root: string, folder: string): Promise<{ links: TicketLink[]; isComplete: boolean } | null> => {
  const dir = `${normRoot(root)}/travail/${folder}/issues`
  const links: TicketLink[] = []
  let isComplete = true
  try {
    if (await $.fs.exists(dir)) {
      for (const x of (await $.fs.list(dir)) as { name?: unknown }[]) {
        const name = typeof x?.name === 'string' ? x.name : ''
        const m = /^(\d+)-[^\\/]+\.md$/.exec(name)
        if (!m) continue
        try {
          links.push({ ticket: m[1]!, line: parsePistesLine(String(await $.fs.read(`${dir}/${name}`))) })
        } catch {
          isComplete = false
        }
      }
    }
  } catch {
    return null
  }
  return { links, isComplete }
}

/**
 * Toutes les 5 s, dans la discussion qui porte une mission « Pistes de rétro » (une mission dont le lancement
 * vivant porte une carte que des pistes de la liste portent aussi) : relit ses fichiers de tickets
 * (`travail/<son dossier de lancement>/issues/<NN>-*.md`, le dossier contrôlé à la relecture du lancement),
 * leur ligne « Pistes : », ses tickets et ses groupes, et dépose dans sa boîte les transitions de ses pistes
 * (en ticket, en exécution, faite, revenue à validée), toute la chaîne d'une piste en une fois et dans l'ordre,
 * une fois chacune tant qu'elle attend dans la boîte.
 * Une ligne qui ne rattache rien se dit au manager. Une liste ou un dossier qui ne se lit pas ne dépose rien.
 */
const watchPistesMission = async ($: any, board: Board) => {
  if (board.delegate) return
  const run = activeRun(board)
  const launch = run ? liveLaunchOf(run) : null
  if (!run || !launch) return
  const got = await readWaitlist($, board.root)
  if (got.state !== 'read') return
  const pistes = pistesOf(got.list)
  if (!pistes.some(p => p.card === launch.card)) return
  const read = await readLotLinks($, board.root, launch.folder)
  if (!read) return
  const { links, isComplete } = read
  const { moves, warnings } = pisteMoves(pistes, {
    card: launch.card,
    mission: run.id,
    links,
    tickets: run.tickets.map(t => ({ id: t.id, status: t.status })),
    // Les tickets de chaque groupe tels que le plan les range (ceux qu'il rattache compris), comme le panneau et le worker.
    groups: (run.groups ?? []).map(g => ({ id: g.id, tickets: [...(groupTicketsOf(run).get(g.id) ?? g.tickets)], isOut: g.linked !== undefined })),
    isComplete,
    sameTicket,
  })
  for (const w of warnings) {
    const key = JSON.stringify([run.id, w])
    if (pistesWarned.has(key)) continue
    pistesWarned.add(key)
    pistesToWarn.push(w)
  }
  const session = await hereId($)
  const marked = new Set(got.list.applied)
  // Une transition que le COO a refusée ne se redépose pas tant que la piste reste dans l'état où elle l'a été (pas
  // de boucle de refus) ; la piste changée d'état depuis, elle se retente.
  const stateNow = new Map(pistes.map(p => [p.id, p.state] as const))
  const moveKey = (piste: string, state: string, group: string | undefined) => JSON.stringify([run.id, piste, state, group ?? ''])
  const refusedMarks = new Set(got.list.refused.map(r => r.op))
  if (refusedMarks.size > 0) {
    const own = await readPisteBox($, board.root, session)
    if (own.state === 'read')
      for (const raw of own.box.ops) {
        const o = soundPisteOp(raw)
        if (o && o.op === 'state' && refusedMarks.has(opMark(session, o.id))) pistesRefusedMoves.set(moveKey(o.piste, o.state!, o.group), stateNow.get(o.piste) ?? '')
      }
  }
  // Un pas retenu retient aussi les pas suivants de sa chaîne : déposés seuls, ils seraient refusés pour rien.
  const held = new Set<string>()
  const wanted = moves.filter(m => {
    if (held.has(m.piste)) return false
    if (pistesRefusedMoves.get(moveKey(m.piste, m.state, m.group)) !== stateNow.get(m.piste)) return true
    held.add(m.piste)
    return false
  })
  const now = await $.clock.now()
  await writePisteBox(
    $,
    board.root,
    session,
    before => {
      // La dernière chaîne déjà déposée et pas encore appliquée, par piste (`chainsOf`, la règle du COO) : la même ne
      // se redépose pas ; une autre (la cible a changé) se redépose entière, et le COO n'applique que la dernière.
      const sig = (m: { state?: string; group?: string; to?: string; toGroup?: string }) => JSON.stringify([m.state, m.group ?? '', m.to ?? '', m.toGroup ?? ''])
      const waiting = chainsOf(before.flatMap(raw => {
        const o = soundPisteOp(raw)
        return o && o.op === 'state' && o.by === run.id && !marked.has(opMark(session, o.id)) ? [o] : []
      })).last
      const sigsOf = (chain: readonly PisteMove[] | readonly PisteOp[] | undefined) => JSON.stringify((chain ?? []).map(sig))
      const changed = new Set([...chainsOf(wanted).last].filter(([piste, chain]) => sigsOf(chain) !== sigsOf(waiting.get(piste))).map(([piste]) => piste))
      // Une chaîne en attente vers « faite » que la mission ne veut plus (plus aucun pas pour sa piste : le ticket ne la
      // nomme plus, ou rouvert) : un pas vers l'état d'aujourd'hui la remplace, sans effet chez le COO (« faite » ne revient jamais).
      const undo = [...waiting]
        .filter(([piste, chain]) => chain.at(-1)?.state === 'done' && !wanted.some(m => m.piste === piste) && ['validated', 'ticket', 'running'].includes(stateNow.get(piste) ?? ''))
        .map(([piste]) => ({ piste, state: stateNow.get(piste) as PisteMoveState, group: pistes.find(p => p.id === piste)?.group }))
      const fresh: { piste: string; state: PisteMoveState; group?: string; to?: PisteMoveState; toGroup?: string }[] = [...wanted.filter(m => changed.has(m.piste)), ...undo]
      if (fresh.length === 0) return null
      // Les pas d'une chaîne, dans l'ordre : la même date, et un id dont le début (la date plus le rang) suit cet ordre,
      // que le COO suit à l'application (une date future ramenée à maintenant ne le change pas).
      return [
        ...before,
        ...fresh.map((m, i) => ({
          id: newPisteOpId(now + i, Math.random()),
          op: 'state',
          piste: m.piste,
          by: run.id,
          at: now,
          state: m.state,
          ...(m.group !== undefined ? { group: m.group } : {}),
          ...(m.to !== undefined ? { to: m.to } : {}),
          ...(m.toGroup !== undefined ? { toGroup: m.toGroup } : {}),
        })),
      ]
    },
    new Set(),
  )
}

/** Les avertissements des lignes « Pistes : » à dire au manager, vidés une fois dits. */
const takePistesWarnings = (): string => {
  if (pistesToWarn.length === 0) return ''
  const said = pistesToWarn.slice(0, 10)
  pistesToWarn = pistesToWarn.slice(10)
  return ` · Pistes lines that linked nothing (fix the ticket file, then the dashboard links it): ${said.map(w => neutralInPrompt(w)).join('; ')}.`
}

/** Les réponses d'un appel `pistes` par résultat d'opération. */
const pisteOutcomeText = (o: PisteOutcome | undefined): string => (o === undefined ? 'waiting in the box (not applied yet)' : o.kind === 'applied' ? 'applied' : o.kind === 'none' ? 'nothing to change' : `refused: ${neutralInPrompt(o.why)}`)

/**
 * La clé `pistes` de l'outil `flow` : le Claude du COO (le siège à cette discussion) modifie, commente ou
 * écarte des pistes de la liste ; une rétro y dépose aussi les siennes, et une mission « Pistes de rétro » ses
 * écarts (`missionChangeRefusal`, refait à l'application). Chaque changement part dans la boîte
 * de cette discussion ; chez le COO, son mod l'applique aussitôt et la réponse dit le résultat de chacun.
 */
const pistesCall = async ($: any, input: unknown): Promise<string> => {
  const board = await ensureBoard($)
  if (!board || board.delegate) return 'Refused: "pistes" is for the COO discussion or a retro, never a worker.'
  const run = activeRun(board)
  const isCoo = board.cooHere !== undefined && !run
  // Une mission « Pistes de rétro » : les pistes « validée » de sa carte, relues à l'instant (illisible : null).
  const l = run && !isRetroRun(run) ? liveLaunchOf(run) : null
  const ofCard = l && isPistesCard({ id: l.card, start: l.start as LaunchStart, folder: l.folder, ...(l.of ? { of: l.of } : {}) }) ? await validatedOfCard($, board.root, l.card) : undefined
  if (!isCoo && !(run && isRetroRun(run)) && ofCard === undefined) return 'Refused: "pistes" is for the COO discussion or a retro mission; nothing was recorded.'
  if (ofCard === null) return 'Refused: the retro waitlist could not be read; nothing was recorded: send it again later.'
  // Une rétro dépose seulement dans un projet qui a un COO, celle qui relit la liste (étape « attente », née avec lui).
  if (!isCoo && !ofCard && !isWaitlistRetro(run!)) return 'Refused: this retro has no waitlist step (the project had no COO when it started): its unticked pistes go to « À reprendre » as before; nothing was recorded.'
  if (isCoo && !(await seatForWrite($)).ok) return 'Refused: this discussion does not hold the COO seat, or the missions file could not be read; nothing was recorded.'
  const by = isCoo ? COO_AUTHOR : run!.id
  const list = Array.isArray(input) ? input : []
  if (list.length === 0) return 'Nothing recorded: "pistes" takes [{"op": "add|edit|comment|drop", "piste": "<retro mission id>/<piste id>", "text", "files", "reason"}].'
  const now = await $.clock.now()
  const refused: string[] = []
  if (list.length > 20) refused.push(`changes ${21}-${list.length} (20 per call at most: send them again in another call)`)
  const ops: PisteOp[] = []
  for (const [i, one] of list.slice(0, 20).entries()) {
    const change = parsePisteChange(one)
    if ('why' in change) {
      refused.push(`change ${i + 1} (${neutralInPrompt(change.why)})`)
      continue
    }
    const why = ofCard ? missionChangeRefusal(change, ofCard) : null
    if (why !== null) {
      refused.push(`change ${i + 1} (${neutralInPrompt(why)})`)
      continue
    }
    if (isCoo && change.op === 'add') {
      refused.push(`change ${i + 1} (the COO does not add pistes: a retro adds its own)`)
      continue
    }
    if (!isCoo && change.op === 'add' && !change.piste.startsWith(run!.id + '/')) {
      refused.push(`change ${i + 1} (a retro adds only its own pistes, ${asciiJson(run!.id + '/<item id>')})`)
      continue
    }
    ops.push({ id: newPisteOpId(now + i, Math.random()), by, at: now, ...change })
  }
  const notKept = refused.length > 0 ? ` NOT recorded: ${refused.join('; ')}.` : ''
  if (ops.length === 0) return `Nothing recorded.${notKept}`
  const session = await hereId($)
  const out = await writePisteBox($, board.root, session, before => [...before, ...ops], new Set())
  if (out !== 'ok') return `Not recorded: ${out === 'full' ? 'the box of this discussion is full (its changes are applied by the COO first)' : out === 'unread' ? 'the box of this discussion could not be read (it is never replaced)' : 'it could not be written'}; send it again later.${notKept}`
  if (ofCard) return `${missionDropsSaid(ops.map(o => o.piste))}${notKept}`
  if (!isCoo) return `Deposited for the COO's dashboard: ${ops.length} change(s) (${ops.map(o => `${o.op} ${neutralInPrompt(o.piste)}`).join(', ')}); it applies them once each, a piste « en exécution » or « faite » refusing any change.${notKept}`
  const outcomes = await applyWaitlist($)
  // Une opération appliquée par le relevé des 5 s, entre son dépôt et cet appel : sa marque est déjà dans la liste.
  const relisted = await readWaitlist($, board.root)
  const marked = new Set(relisted.state === 'read' ? relisted.list.applied : [])
  const said = (o: PisteOp): string => {
    const mark = opMark(session, o.id)
    if (outcomes.has(mark) || !marked.has(mark)) return pisteOutcomeText(outcomes.get(mark))
    // Traitée par le relevé des 5 s : refusée si un refus porte sa marque, sinon appliquée (ou sans effet).
    const refusal = relisted.state === 'read' ? relisted.list.refused.find(r => r.op === mark) : undefined
    return refusal ? `refused: ${neutralInPrompt(refusal.why)}` : 'already handled by the dashboard (applied, or nothing to change; do not send it again)'
  }
  return `Waitlist: ${ops.map(o => `${o.op} ${neutralInPrompt(o.piste)}: ${said(o)}`).join('; ')}.${notKept}`
}

/**
 * La liste d'attente donnée à une rétro quand son étape `attente` commence : relue à l'instant, ses pistes
 * ouvertes citées comme des données, et les changements de cette discussion encore dans sa boîte.
 */
const attenteText = async ($: any, board: Board, run: Run): Promise<string> => {
  const got = await readWaitlist($, board.root)
  const session = await hereId($)
  const own = await readPisteBox($, board.root, session)
  // Pas encore appliqués : sans marque dans la liste relue (une liste illisible n'en prouve aucun).
  const applied = new Set(got.state === 'read' ? got.list.applied : [])
  const pending = own.state === 'read' ? own.box.ops.filter(o => { const op = soundPisteOp(o); return op !== null && !applied.has(opMark(session, op.id)) }).length : 0
  return retroWaitlistText(got.state, got.state === 'read' ? pistesOf(got.list) : [], run.id, pending)
}

/** L'adresse du réveil d'une mission, relue au moment de l'envoi : l'id de la discussion qui la porte, et la référence du manager. */
const wakeAddress = async ($: any, runId: string): Promise<{ owner: string | null; ref: string | null; title: string }> => {
  await pull($)
  const run = ((await read($, boardAtom)) as Board | null)?.runs.find(r => r.id === runId)
  const owner = run && run.status === 'active' && isSafeId(run.owner) ? run.owner : null
  const ref = refOf((await readMainRef($, runId))?.main)
  return { owner, ref, title: run?.title ?? '' }
}

/**
 * Réveille le manager d'une mission (son Claude relit le tableau de bord) : texte fixe, adresse relue à
 * l'instant et contrôlée. Par le mod (`$.session.send`), sinon la phrase que Claude envoie par SendMessage
 * (refusé par le moteur quand cette discussion tourne en « auto mode » de Claude Code).
 */
const wakeManager = async ($: any, runId: string): Promise<string> => {
  const to = await wakeAddress($, runId)
  if (to.owner === null) return 'No wake-up sent: the mission is not open in any discussion. Once it is paused, the dashboard of this discussion closes it by itself, without archiving it.'
  let reason = 'not tried'
  try {
    const sent = await $.session.send({ to: { sessionId: to.owner }, text: WAKE_TEXT })
    if (sent?.isDelivered === true) return 'Its manager was woken up by the dashboard.'
    reason = String(sent?.reason ?? 'refused')
  } catch {
    reason = 'the engine refused the send'
  }
  return `The dashboard could not wake its manager (${neutralInPrompt(clip(reason, 120))}): send with SendMessage, to ${wakeTarget(to)}, exactly this text and nothing else: « ${WAKE_TEXT} ». If no session matches, tell the user the mission waits until its discussion is opened.`
}
const neutralQuoted = (text: string): string => `« ${neutralInPrompt(clip(text, 80))} »`
/** La cible d'un réveil que Claude envoie lui-même par SendMessage : la référence du manager relue, sinon le titre neutralisé. */
const wakeTarget = (to: { ref: string | null; title: string }): string =>
  to.ref !== null ? `the session whose [ref] is ${to.ref} in ListAgents` : `the session of ListAgents titled ${neutralQuoted(to.title)} (never a session whose title starts with it followed by « > »)`

// ─── Réveil de jour ───────────────────────────────────────────────────────
//
// La discussion d'une mission dont une unité vient de finir, par sa propre
// écriture (`commit`, l'appel de l'outil flow, la fin de la discussion), réveille chaque mission en auto qui
// l'attendait (`wakeTargets` de `model.ts`). Invariant : « Le réveil ne part que vers la discussion qui tient la
// mission réveillée, avec un texte fixe ; il n'écrit rien dans cette mission et ne lance aucune commande. »

/** Les réveils de jour déjà partis de ce processus (`<mission qui écrit>/<unité>><mission réveillée>`) : un par unité finie et par mission. */
const dayWoken = new Set<string>()
/** Les consignes de repli des réveils que le mod n'a pas pu envoyer : dites par la réponse du prochain appel de l'outil flow d'ici (ce processus seulement). */
let dayWakeNotes: string[] = []

/** Rend, une fois, les consignes de repli en attente (fil principal de la discussion seulement). */
const takeDayWakeNotes = (): string => {
  const notes = dayWakeNotes
  dayWakeNotes = []
  return notes.map(n => ` · ${n}`).join('')
}

/**
 * Réveille la discussion qui tient la mission `runId` : adresse relue à l'instant et contrôlée (`wakeAddress`),
 * mission encore réveillable sur le board relu, texte fixe (`DAY_WAKE_TEXT`). Envoi refusé ou non livré : rend la
 * consigne de repli pour Claude (SendMessage, puis « à rouvrir » par PushNotification) ; livré : '' ; rien d'envoyé
 * (plus de titulaire, ou la mission relue n'est plus réveillable) : null.
 */
const wakeWaitingRun = async ($: any, runId: string): Promise<string | null> => {
  const to = await wakeAddress($, runId)
  if (to.owner === null) return null
  const run = ((await read($, boardAtom)) as Board | null)?.runs.find(r => r.id === runId)
  if (!run || !isWakeable(run, await $.clock.now())) return null
  let reason = 'not tried'
  try {
    const sent = await $.session.send({ to: { sessionId: to.owner }, text: DAY_WAKE_TEXT })
    if (sent?.isDelivered === true) return ''
    reason = String(sent?.reason ?? 'refused')
  } catch {
    reason = 'the engine refused the send'
  }
  return `The dashboard could not wake the manager of mission ${neutralQuoted(to.title)}, which waited for a group of your mission that just finished (${neutralInPrompt(clip(reason, 120))}): send with SendMessage, to ${wakeTarget(to)}, exactly this text and nothing else: « ${DAY_WAKE_TEXT} ». If no session matches, or the send is refused, send one PushNotification (a deferred tool: load it with ToolSearch, select:PushNotification) with exactly this text and nothing else: « ${reopenNotice(to.title)} ». Launch nothing else for that mission.`
}

/**
 * Après une écriture de cette discussion (`before` → `after`) : réveille les missions qui attendaient une unité que
 * cette écriture a finie dans la mission tenue ici (active ici avant l'écriture). Rien dans un worker, ni sans mission
 * tenue ici (le COO) ; une relecture ou une sauvegarde après fusion ne passe pas par ici. Une paire envoyée (livrée, ou
 * sa consigne de repli gardée) ne repart plus de ce processus.
 */
const wakeWaiting = async ($: any, before: Board, after: Board) => {
  if (before.delegate || after.delegate) return
  const writer = activeRun(before)
  if (!writer) return
  const entries = coordSeen?.state === 'read' ? coordSeen.entries : []
  const targets = wakeTargets(before, after, writer.id, await $.clock.now(), id => planWaitsOf(entries, id), id => coordForces(id))
  if (targets.every(t => dayWoken.has(`${writer.id}/${t.group}>${t.run}`))) return
  // La fin de l'unité écrite dans le fichier avant le réveil : la mission réveillée la relit tout de suite.
  await saveNow($)
  for (const t of targets) {
    const key = `${writer.id}/${t.group}>${t.run}`
    if (dayWoken.has(key)) continue
    const note = await wakeWaitingRun($, t.run)
    if (note === null) continue
    dayWoken.add(key)
    if (note !== '') dayWakeNotes.push(note)
  }
}

/**
 * La clé `titles` de `coordinate` (le Claude du COO, chez le titulaire du siège) : 50 titres au plus par appel, chacun
 * avec l'id de son entrée « À reprendre ». La feuille de route se relit à l'instant et le mod prend lui-même l'empreinte
 * du texte de chaque entrée ; l'envoi n'écrit que si la feuille de route et l'état gardé se lisent, tout ou rien. Le
 * fichier de la feuille de route n'est jamais réécrit pour un titre.
 */
const recordTitles = async ($: any, raw: unknown): Promise<string> => {
  if (!Array.isArray(raw)) return 'Titles refused, nothing recorded: "titles" takes a list [{"id": "<entry id>", "title": "<short title>"}].'
  if (raw.length > TITLES_MAX) return `Titles refused, nothing recorded: ${TITLES_MAX} titles per call at most; send them in several calls.`
  const seat = await seatForWrite($)
  if (!seat.ok) return 'Titles refused, nothing recorded: this discussion does not hold the COO seat, or the missions file could not be read.'
  const r = await readRoadmap($, seat.local, true)
  if (r.read === null || r.read === 'unread' || !r.read.ok) return 'Titles refused, nothing recorded: the roadmap, or what the dashboard keeps of it, could not be read, or the roadmap is out of format; try again once it reads.'
  const plan = planTitles(raw, r.read.entries)
  const refused = plan.refused.length > 0 ? ` Refused: ${plan.refused.map(x => `${neutralInPrompt(x.id)} (${neutralInPrompt(x.why)})`).join(', ')}.` : ''
  const leftLine = (titles: RoadmapTitles | undefined): string => {
    const n = untitledIds((r.read as Roadmap & { ok: true }).entries, titles).length
    return ` ${n} open « À reprendre » entr${n === 1 ? 'y has' : 'ies have'} no title yet.`
  }
  if (Object.keys(plan.kept).length === 0) return `No title recorded.${refused}${leftLine(r.titles)}`
  if (!(await saveRoadmapState($, seat.local.root, { titles: plan.kept }))) return 'Titles refused, nothing recorded: the roadmap state could not be read or written; try again.'
  roadmapNowCache = await readRoadmap($, seat.local, true)
  $.ui.invalidate('ui.render')
  // Le reste se compte sur les titres relus après l'écriture (un état reparti de neuf entre-temps en a perdu) ; une relecture
  // ratée ne dit rien d'eux : le compte part alors de ce qui était gardé, plus ce qui vient de s'écrire.
  const after = roadmapNowCache.read === 'unread' ? { ...(r.titles ?? {}), ...plan.kept } : roadmapNowCache.titles
  return `Titles recorded: ${Object.keys(plan.kept).join(', ')}.${refused}${leftLine(after)}`
}

/**
 * Le champ `coordinate` de l'outil `flow`, dans la discussion du COO seulement : les consignes qu'il
 * écrit. `close` : demander la clôture d'une mission, sans archivage ni marque de livraison ; une mission en
 * pause est close tout de suite par le mod du COO, une mission ouverte reçoit une entrée et un réveil. `toClose`
 * (le contrôle à l'instant des discussions à fermer) et `discussionsClosed` (leur compte rendu) vont chacun seul. `titles` : les
 * titres des entrées « À reprendre » (`recordTitles`).
 */
const coordinateCall = async ($: any, input: unknown, isAgent = false): Promise<string> => {
  const board = await ensureBoard($)
  if (!board || board.delegate || activeRun(board) || board.cooHere === undefined) return 'Refused: "coordinate" is for the COO discussion only.'
  const x = input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  const close = Array.isArray(x.close) ? x.close : []
  const cuts = Array.isArray(x.cutAuto) ? x.cutAuto.slice(0, 20) : []
  const gleaned = Array.isArray(x.gleaned) ? x.gleaned.filter(isSafeId).slice(0, 20) : []
  const isExisting = x.gleanedExisting === true
  const isTitles = x.titles !== undefined
  const taken = Array.isArray(x.taken) ? x.taken.slice(0, 40) : []
  const answers = Array.isArray(x.answer) ? x.answer.slice(0, 20) : []
  const redos = Array.isArray(x.redo) ? x.redo.slice(0, 20) : []
  const instructs = Array.isArray(x.instruct) ? x.instruct.slice(0, 20) : []
  const oppositions = Array.isArray(x.contradiction) ? x.contradiction.slice(0, 20) : []
  const compatibles = Array.isArray(x.compatible) ? x.compatible.slice(0, 20) : []
  // Une opposition hors liste, ou au-delà de 20 : rien ne se marque vu (elle passerait sans question).
  const notTaken = [
    ...(x.contradiction !== undefined && !Array.isArray(x.contradiction) ? ['"contradiction" must be a list [{"first", "second", "subject"}]'] : []),
    ...(Array.isArray(x.contradiction) && x.contradiction.length > 20 ? [`contradictions ${21}-${x.contradiction.length} were not read (20 per call at most)`] : []),
    ...(x.compatible !== undefined && !Array.isArray(x.compatible) ? ['"compatible" must be a list [{"missions", "subject"}]'] : []),
    ...(Array.isArray(x.compatible) && x.compatible.length > 20 ? [`compatible subjects ${21}-${x.compatible.length} were not read (20 per call at most)`] : []),
  ]
  const isSeenAsked = x.decisionsSeen === true
  const isNightOn = x.nightOn === true
  const nights = Array.isArray(x.night) ? x.night.slice(0, 20) : []
  const toClose = sessionIdsOf(x.toClose)
  const closedDiscussions = Array.isArray(x.discussionsClosed) ? x.discussionsClosed : []
  if (x.toClose !== undefined || x.discussionsClosed !== undefined) {
    // Seuls dans leur appel : le contrôle d'abord, le compte rendu ensuite, jamais mêlés à une autre consigne (refusée
    // en entier, jamais une partie appliquée en silence).
    // Une liste vide aussi : elle a sa réponse (« none of these », « Nothing is written »), jamais le chemin des autres clés.
    if (Object.keys(x).some(k => k !== 'toClose' && k !== 'discussionsClosed') || (x.toClose !== undefined && x.discussionsClosed !== undefined))
      return 'Refused, nothing of this call applied: send "toClose" first, alone in its call, then "discussionsClosed", alone in another call; send any other instruction in a call of its own.'
    return x.toClose !== undefined ? await checkToClose($, toClose, isAgent) : await recordClosed($, closedDiscussions, isAgent)
  }
  // La fin de la demande unique : seule dans son appel, comme le contrôle.
  if (x.unmarked !== undefined) {
    if (Object.keys(x).some(k => k !== 'unmarked')) return 'Refused, nothing of this call applied: send "unmarked" alone in its call; send any other instruction in a call of its own.'
    return await recordUnmarked($, x.unmarked, isAgent)
  }
  if (!isNightOn && nights.length === 0 && close.length === 0 && cuts.length === 0 && gleaned.length === 0 && !isExisting && !isTitles && taken.length === 0 && answers.length === 0 && redos.length === 0 && instructs.length === 0 && oppositions.length === 0 && compatibles.length === 0 && !isSeenAsked && notTaken.length === 0)
    return 'Nothing to coordinate: "coordinate" takes {"close": [{"mission": "<mission id>"}]}, {"cutAuto": [{"mission": "<mission id>"}]}, {"gleaned": ["<mission id>"]}, {"gleanedExisting": true}, {"titles": [{"id", "title"}]}, {"taken": [{"mission", "item", "by": {"mission", "ticket"}}]}, {"answer": [{"mission", "question", "seen", "file", "series"}]}, {"redo": [{"mission", "file", "series"}]}, {"instruct": [{"mission", "file", "series", "origin"}]}, {"contradiction": [{"first", "second", "subject"}]}, {"compatible": [{"missions", "subject"}]}, {"night": [{"mission", "watch", "act", "group"}]}, {"toClose": ["<session id>"]}, {"discussionsClosed": [{"session", "state", "why"}]}, {"unmarked": "yes" | "no" | "none"} or {"decisionsSeen": true}.'
  const out: string[] = []
  if (isNightOn) out.push(await recordNightOn($))
  for (const one of nights) out.push(await recordNight($, one))
  for (const one of cuts) out.push(await recordCut($, one))
  for (const one of answers) out.push(await recordAnswer($, one))
  for (const one of redos) out.push(await recordRedo($, one))
  for (const one of instructs) out.push(await recordInstruct($, one, isAgent))
  // Un champ illisible ne se rattache à aucune opposition : il bloque jusqu'au relevé suivant.
  if (notTaken.length > 0) {
    out.push(`Not read: ${notTaken.join('; ')}.`)
    decisionsFailed.add('*')
  }
  // « Rien à demander » (les deux missions closes, ou l'une partie) compte comme traité : le redemander ne changerait rien.
  const isSettled = (said: string) => said.startsWith('Opposition recorded') || said.startsWith('Already recorded') || said.startsWith(NOTHING_TO_ASK)
  // Chaque opposition et chaque sujet compatible ratés restent notés, par leur contenu, jusqu'à ce qu'ils soient écrits.
  const keyOf = (one: unknown) => JSON.stringify(one ?? null)
  for (const one of oppositions) {
    const said = await recordContradiction($, one)
    if (isSettled(said)) decisionsFailed.delete(keyOf(one))
    else decisionsFailed.add(keyOf(one))
    out.push(said)
  }
  for (const one of compatibles) {
    const said = await recordCompatible($, one)
    if (said.startsWith('Noted as compatible') || said.startsWith('Already noted') || said.startsWith(NOTHING_TO_ASK)) decisionsFailed.delete(keyOf(one))
    else decisionsFailed.add(keyOf(one))
    out.push(said)
  }
  // Le relevé jugé ne se marque vu que si ce qu'il a fait relever est écrit depuis le dernier relevé : sinon ses décisions
  // reviendraient sans question.
  if (isSeenAsked) out.push(decisionsFailed.size === 0 ? await markReviewedDecisions($) : 'Not marked as reviewed: an opposition or a compatible subject was not recorded since your last statement; send each of them again (the same content), then {"decisionsSeen": true}.')
  if (taken.length > 0) out.push(await markTaken($, taken))
  if (gleaned.length > 0) out.push(await markGleaned($, gleaned))
  if (isExisting) {
    const seat = await seatForWrite($)
    out.push(!seat.ok ? 'The first gleaning was not recorded: this discussion does not hold the COO seat, or the missions file could not be read.' : (await saveRoadmapState($, seat.local.root, { gleanedAt: await $.clock.now() })) ? 'The first gleaning of the existing journal and reports is recorded: it is not asked again.' : 'The first gleaning could not be recorded (what the dashboard keeps could not be read or written); send it again.')
  }
  if (isTitles) out.push(await recordTitles($, x.titles))
  for (const one of close.slice(0, 20)) {
    const id = one !== null && typeof one === 'object' ? (one as Record<string, unknown>).mission : undefined
    if (!isSafeId(id)) {
      out.push('A "close" without a well-formed mission id was refused.')
      continue
    }
    out.push(await requestClose($, id))
  }
  return out.join(' ')
}

/**
 * « ⇥ Forcer » chez le COO : une entrée du fichier de coordination pour la seule paire nommée (le groupe
 * retenu d'une mission, le groupe attendu d'une autre), lue par le mod du manager à sa relecture suivante.
 */
const requestForce = async ($: any, d: { mission: string; held: string; run: string; group: string; on?: 'plan' }): Promise<string> => {
  const board: Board | null = await read($, boardAtom)
  const mission = board?.runs.find(r => r.id === d.mission)
  if (!mission || !board?.runs.some(r => r.id === d.run)) return '◆ Rien n’est forcé : la mission n’est plus dans le fichier des missions.'
  const now = await $.clock.now()
  const id = newEntryId(now, Math.random())
  const isAlready = (entries: readonly unknown[]) => forcesFor(liveEntries(entries, () => false), d.mission).some(f => f.held === d.held && f.run === d.run && f.group === d.group && f.on === d.on)
  const written = await writeCoordination($, entries => (isAlready(entries) ? null : [...entries, { id, kind: 'force', run: d.mission, at: now, held: d.held, awaited: { run: d.run, group: d.group }, ...(d.on === 'plan' ? { on: 'plan' } : {}) }]))
  if (written === 'none') return '◆ Déjà forcé.'
  if (written !== 'ok') return `◆ Rien n’est forcé : ${coordWriteWhy(written)}`
  return `◆ Forcé : ${unitName(d.held)} de « ${neutralLine(clip(mission.title, 60))} » part sans attendre (cette paire seulement).`
}

/**
 * Des pistes de rétro déjà prises ailleurs, marquées par le COO : une entrée « taken » chacune, contrôlée
 * (la rétro porte la piste, l'autre mission existe et n'est pas la même, le ticket a la forme d'un id).
 */
const markTaken = async ($: any, list: readonly unknown[]): Promise<string> => {
  const board: Board | null = await read($, boardAtom)
  const now = await $.clock.now()
  const fresh: CoordTaken[] = []
  const refused: string[] = []
  for (const [i, one] of list.entries()) {
    const x = one !== null && typeof one === 'object' && !Array.isArray(one) ? (one as Record<string, unknown>) : {}
    const by = x.by !== null && typeof x.by === 'object' && !Array.isArray(x.by) ? (x.by as Record<string, unknown>) : {}
    const retro = board?.runs.find(r => r.id === x.mission)
    const other = board?.runs.find(r => r.id === by.mission)
    // Seulement une piste de sa rétro encore « à faire » : une piste déjà découpée ou finie ne se marque plus
    // (la marque bloquerait ensuite sa fin dans la rétro).
    const item = retro ? retroItems(retro).find(it => it.id === x.item) : undefined
    const hasItem = item?.status === 'todo'
    // La marque garde le libellé jugé : une rétro qui renumérote ses pistes ne la déplace pas sur une autre.
    const label = item?.label
    const entry = { id: newEntryId(now + i, Math.random()), kind: 'taken' as const, run: String(x.mission), at: now, item: String(x.item), ...(label !== undefined ? { label } : {}), by: { run: String(by.mission), ticket: String(by.ticket) } }
    if (!retro || !other || !hasItem || soundEntry(entry) === null) refused.push(`item ${i + 1}`)
    else if (!fresh.some(f => f.run === entry.run && f.item === entry.item)) fresh.push(entry)
  }
  if (fresh.length === 0) return `No piste marked taken${refused.length > 0 ? ` (refused: ${refused.join(', ')}: unknown mission, piste not « todo » in its retro, or a ticket id out of form)` : ''}.`
  const written = await writeCoordination($, entries => {
    const live = liveEntries(entries, () => false)
    // Déjà marquée : la piste que les marques existantes désignent aujourd'hui (par leur libellé), pas leur ancien id.
    const missing = fresh.filter(f => { const r = board?.runs.find(x => x.id === f.run); return !takenFor(live, f.run, r ? retroItems(r) : undefined).has(f.item) })
    return missing.length === 0 ? null : [...entries, ...missing]
  })
  if (written !== 'ok' && written !== 'none') return `Pistes not marked taken: ${coordWriteWhy(written)}`
  return `Marked taken elsewhere: ${fresh.length} piste(s); the retro shows them so and leaves them out of its cut.${refused.length > 0 ? ` Refused: ${refused.join(', ')} (unknown mission, piste not « todo » in its retro, or a ticket id out of form).` : ''}`
}

/** Des missions closes relevées par le COO : une entrée « gleaned » chacune (partie avec sa mission). */
const markGleaned = async ($: any, ids: readonly string[]): Promise<string> => {
  // Le fichier des missions relu d'abord : une mission reprise puis close de nouveau depuis le relevé n'est pas notée relevée.
  if (!(await pull($))) return `Gleaned missions not recorded: ${SEAT_UNREAD}`
  const board: Board | null = await read($, boardAtom)
  // Seulement une mission close : relevée à sa clôture (une mission reprise puis close de nouveau se relève encore).
  const known = ids.filter(id => board?.runs.some(r => r.id === id && r.status === 'done'))
  if (known.length === 0) return 'No gleaned mission recorded: none of these ids is a closed mission of the missions file.'
  const now = await $.clock.now()
  const written = await writeCoordination($, entries => {
    const already = gleanedRuns(liveEntries(entries, () => false))
    const fresh = known.filter(id => (already.get(id) ?? -1) < (board?.runs.find(r => r.id === id)?.finishedAt ?? 0))
    return fresh.length === 0 ? null : [...entries, ...fresh.map((run, i) => ({ id: newEntryId(now + i, Math.random()), kind: 'gleaned', run, at: now }))]
  })
  return written === 'ok' || written === 'none' ? `Gleaned: ${known.length} mission(s) recorded; they are not listed again.` : `Gleaned missions not recorded: ${coordWriteWhy(written)}`
}


/**
 * Les discussions de managers encore à fermer, recalculées à l'instant (`discussionsToCloseBoth`) : le fichier des
 * missions relu et fusionné, la copie d'ici et celle du fichier d'accord, le siège tenu ici, le fichier de coordination
 * relu (absent : aucune trace). null quand l'un ne se relit pas ou que le siège n'est pas ici : alors rien n'est à fermer.
 */
const toCloseNow = async ($: any, isAgent: boolean): Promise<{ list: ToClose[]; root: string } | null> => {
  if (!(await pull($))) return null
  const seat = await seatForWrite($)
  if (!seat.ok || !seat.stored) return null
  const root = seat.local.root
  const list = await toCloseFrom($, root, seat.local.runs, seat.stored.runs, undefined, isUnmarkedTurn(isAgent))
  return list === null ? null : { list, root }
}

/**
 * Le tour en cours est celui du oui à la demande unique (`unmarkedYesTurn`, le même tour tapé, encore ouvert), et l'appel
 * vient du fil principal : alors seulement les missions archivées sans marque comptent parmi les discussions à fermer.
 */
const isUnmarkedTurn = (isAgent: boolean): boolean => !isAgent && unmarkedYesTurn !== null && unmarkedYesTurn === typedTurn && typedTurn?.phase === 'started'

/**
 * Les discussions à fermer d'après une copie (`stored` null) ou les deux copies du fichier des missions, sans plafond, et,
 * `withUnmarked` (le tour du oui à la demande unique), celles des missions archivées sans marque, réunies (`mergeToClose`).
 */
const closable = (local: readonly Run[], stored: readonly Run[] | null, entries: readonly CoordEntry[], here: string, only: ReadonlySet<string> | undefined, withUnmarked: boolean): ToClose[] => {
  const list = (unmarked: boolean) => (stored === null ? discussionsToClose(local, entries, here, unmarked, only, Number.POSITIVE_INFINITY) : discussionsToCloseBoth(local, stored, entries, here, unmarked, only, Number.POSITIVE_INFINITY))
  const marked = list(false)
  if (!withUnmarked) return marked
  // Les discussions sans marque : au plus celles que la demande nomme (`unmarkedNamed` : les `UNMARKED_MAX` premières de
  // la copie d'ici), jamais une de celles d'au-delà, que la personne n'a pas vues ; les deux copies sans plafond, puis
  // restreintes à elles.
  const named = new Set(unmarkedNamed(local, entries, here).map(d => d.session))
  return mergeToClose(marked, list(true).filter(d => named.has(d.session)))
}

/**
 * Les discussions que nomme la demande unique, d'après la copie d'ici : celles des missions archivées sans marque, sauf
 * une discussion que la section « discussions à fermer » porte déjà (une mission marquée la désigne aussi : le clic vaut
 * accord pour elle), `UNMARKED_MAX` au plus, dans l'ordre du fichier ; `total` : combien il y en a en tout.
 */
const unmarkedNamed = (local: readonly Run[], entries: readonly CoordEntry[], here: string): ToClose[] & { total?: number } => {
  const marked = new Set(discussionsToClose(local, entries, here, false, undefined, Number.POSITIVE_INFINITY).map(d => d.session))
  const all = discussionsToClose(local, entries, here, true, undefined, Number.POSITIVE_INFINITY).filter(d => !marked.has(d.session))
  return Object.assign(all.slice(0, UNMARKED_MAX), { total: all.length })
}

/**
 * Les discussions à fermer, sans plafond (le plafond ne borne que le texte du relevé : un contrôle ne refuse jamais une
 * discussion parce que d'autres l'attendent avant elle), vues d'ici : la copie d'ici `local` et celle du fichier commun
 * `stored` (`discussionsToCloseBoth` ; null : la copie d'ici seule, pour le seul compte d'un toast quand l'archivage n'est
 * pas sûr d'être écrit), le fichier de coordination relu (absent : aucune trace) ; `only` : ces missions seules. null
 * quand le fichier de coordination ne se relit pas. `withUnmarked` : aussi les missions archivées sans marque (`closable`).
 */
const toCloseFrom = async ($: any, root: string, local: readonly Run[], stored: readonly Run[] | null, only?: ReadonlySet<string>, withUnmarked = false): Promise<ToClose[] | null> => {
  const got = await readCoordination($, root)
  if (got.state === 'unread') return null
  const entries = got.state === 'read' ? got.file.entries.flatMap(raw => soundEntry(raw) ?? []) : []
  return closable(local, stored, entries, await hereId($), only, withUnmarked)
}

/** Les ids de session du contrôle (`toClose`) : des chaînes, `UNMARKED_MAX` au plus (la demande unique en nomme jusque-là). */
const sessionIdsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, UNMARKED_MAX) : [])

/**
 * `coordinate.toClose` : le contrôle à l'instant, avant tout arrêt. Rend, parmi les ids demandés, ceux qui sont encore à
 * fermer d'après `toCloseNow`, et eux seuls ; hors du siège ou sans relecture sûre : aucun.
 */
const checkToClose = async ($: any, asked: readonly string[], isAgent: boolean): Promise<string> => {
  const now = await toCloseNow($, isAgent)
  if (!now) return 'Discussions still to close: none (the missions file or the coordination file could not be read, or this discussion does not hold the COO seat); close nothing.'
  const live = new Set(now.list.map(d => d.session))
  const still = asked.filter((id, i) => live.has(id) && asked.indexOf(id) === i)
  return still.length === 0 ? 'Discussions still to close: none of these; close nothing, and send no report for them.' : `Discussions still to close: ${still.map(id => `"${id}"`).join(', ')}; close these only, never another id of your list.`
}

/**
 * `coordinate.discussionsClosed` : le compte rendu du Claude du COO. Chaque discussion encore à fermer à l'instant
 * (`toCloseNow`) et rendue avec un état connu reçoit une trace par mission qui la désigne ; un état hors liste, ou un
 * id que le contrôle ne rendrait pas, est refusé et rien ne s'écrit pour lui. Écriture refusée : rien n'est écrit, la
 * discussion revient au relevé suivant.
 */
const recordClosed = async ($: any, items: readonly unknown[], isAgent: boolean): Promise<string> => {
  // Le tour du oui à la demande unique, jugé à l'entrée pour le tour d'écriture (le contrôle, `toCloseNow`, le rejuge après
  // ses attentes : un tour fini entre-temps y fait refuser les discussions sans marque, jamais l'inverse).
  const withUnmarked = isUnmarkedTurn(isAgent)
  const now = await toCloseNow($, isAgent)
  if (!now) return 'Nothing is written: the missions file or the coordination file could not be read, or this discussion does not hold the COO seat; these discussions come back at the next statement.'
  const refused: string[] = []
  const traced: { run: string; session: string; state: DiscussionState }[] = []
  const seen = new Set<string>()
  for (const raw of items.slice(0, UNMARKED_MAX)) {
    const x = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    const session = x.session
    const state = x.state
    const found = typeof session === 'string' ? now.list.find(d => d.session === session) : undefined
    if (found && seen.has(found.session)) {
      refused.push(`"${found.session}" (sent twice: the first one counts)`)
      continue
    }
    if (!found || !DISCUSSION_STATES.includes(state as DiscussionState)) {
      refused.push(typeof session === 'string' && isSessionId(session) ? `"${session}"` : 'an id out of form')
      continue
    }
    seen.add(found.session)
    for (const r of found.runs) traced.push({ run: r.id, session: found.session, state: state as DiscussionState })
  }
  // Au-delà du plafond d'un appel : dit, jamais tu (ces discussions reviennent par un autre compte rendu).
  const unread = items.length > UNMARKED_MAX ? ` Not read: entries ${UNMARKED_MAX + 1}-${items.length} (${UNMARKED_MAX} per call at most); send them in another call.` : ''
  const tail = `${refused.length > 0 ? ` Refused, nothing written for them (a state outside ${DISCUSSION_STATES.join(', ')}, a discussion that is not to close any more, or one sent twice): ${refused.join(', ')}.` : ''}${unread}`
  if (traced.length === 0) return `Nothing is written.${tail}`
  const clock = await $.clock.now()
  const here = await hereId($)
  const local = (await read($, boardAtom))?.runs ?? null
  let kept: string[] = []
  let isUnread = false
  const written = await writeCoordination($, (entries, stored) => {
    // Rejugé dans le tour d'écriture, sur le fichier relu à l'instant et la copie d'ici : une discussion qui n'est plus à
    // fermer (mission reprise, désarchivée, déjà tracée) n'y reçoit rien.
    if (!stored || !local) {
      isUnread = true
      return null
    }
    // La date de l'archivage relue ici : une trace datée au plus tôt de lui, pour qu'une horloge en retard ne la rende pas inopérante.
    const live = new Map(closable(local, stored.runs, entries.flatMap(raw => soundEntry(raw) ?? []), here, undefined, withUnmarked).flatMap(d => d.runs.map(r => [`${d.session} ${r.id}`, r.at] as const)))
    const fresh = traced.filter(t => live.has(`${t.session} ${t.run}`))
    kept = [...new Set(fresh.map(t => t.session))]
    if (fresh.length === 0) return null
    return [...entries, ...fresh.map((t, i) => { const at = Math.max(clock, live.get(`${t.session} ${t.run}`) ?? 0); return { id: newEntryId(at + i, Math.random()), kind: 'discussion', run: t.run, at, session: t.session, state: t.state } })]
  })
  // Les discussions rendues que le tour d'écriture a écartées : dites, jamais tues.
  const dropped = [...new Set(traced.map(t => t.session))].filter(s => !kept.includes(s))
  const droppedTail = dropped.length > 0 && written !== 'ok' ? '' : dropped.length > 0 ? ` Not recorded, no longer to close at the time of writing (a mission resumed, unarchived, or already traced): ${dropped.map(s => `"${s}"`).join(', ')}; tell the user.` : ''
  if (isUnread) return `Nothing is written: the missions file could not be read at the time of writing; these discussions come back at the next statement.${tail}`
  if (written === 'none' || (written === 'ok' && kept.length === 0)) return `Nothing is written: these discussions are not to close any more at the time of writing (a mission resumed, unarchived, or already traced); tell the user.${tail}`
  if (written !== 'ok') return `Nothing is written: ${coordWriteWhy(written)} These discussions come back at the next statement.${tail}`
  return `Recorded: ${kept.length} discussion(s); they are not listed again.${droppedTail}${tail}`
}

/** Le relevé du siège : la procédure de fermeture des discussions encore à fermer, sur le fichier relu au relevé ; rien quand le fichier de coordination n'est pas bien relu. */
const cooToCloseText = async ($: any, board: Board): Promise<string | null> => {
  if (coordNow?.state !== 'read' && coordNow?.state !== 'absent') return null
  const list = discussionsToClose(board.runs, coordLive, await hereId($))
  return missionSessionsArchiveText(
    list.flatMap(d => d.runs.map(r => ({ title: neutralQuoted(r.title), id: d.session, ...(r.by === 'retro' ? { byRetro: true } : {}) }))),
    closingRepo(board.root),
  )
}
/**
 * Le relevé du siège : la demande unique pour les discussions des missions archivées sans marque, tant que son repère
 * n'est pas posé (`RoadmapState.unmarkedAt`). Ce que le mod garde illisible, ou le fichier de coordination pas bien relu :
 * rien n'est demandé ni posé. Aucune telle discussion, sur la copie d'ici comme sur le fichier commun relus avec le siège
 * vérifié : le repère est posé sans rien demander. Sa première parution depuis le chargement du mod note le rang du tour
 * tapé en cours (`unmarkedAskedNo`) : seul un oui tapé après elle s'enregistre.
 */
const cooUnmarkedText = async ($: any, board: Board): Promise<string | null> => {
  const state = await loadRoadmapState($, board.root)
  if (state === 'unread' || 'broken' in state || state.unmarkedAt !== undefined) return null
  if (coordNow?.state !== 'read' && coordNow?.state !== 'absent') return null
  const here = await hereId($)
  const shown = unmarkedNamed(board.runs, coordLive, here)
  if (shown.length === 0) {
    // « Aucune » ne se conclut que sur les deux copies relues, le siège vérifié, et seulement quand aucune mission archivée
    // sans marque n'a de discussion notée, même tenue pour un temps par une autre mission (elle serait nommée plus tard) :
    // le repère posé ne se reprend jamais.
    const seat = await seatForWrite($)
    if (!seat.ok || !seat.stored) return null
    const entries = (await readCoordination($, seat.local.root))
    if (entries.state === 'unread') return null
    const sound = entries.state === 'read' ? entries.file.entries.flatMap(raw => soundEntry(raw) ?? []) : []
    const isPending = (runs: readonly Run[]) =>
      runs.some(r => isTime(r.archivedAt) && archiveMarkOf(r) === undefined && (isSessionId(r.bornIn) || isSessionId(r.owner)) && !sound.some(e => e.kind === 'discussion' && e.run === r.id && e.at >= (r.archivedAt as number)))
    if (isPending(seat.local.runs) || isPending(seat.stored.runs)) return null
    await saveRoadmapState($, seat.local.root, { unmarkedAt: await $.clock.now() })
    return null
  }
  const text = unmarkedAskText(
    shown.flatMap(d => d.runs.map(r => ({ title: neutralQuoted(r.title), id: d.session }))),
    closingRepo(board.root),
    (shown.total ?? shown.length) - shown.length,
  )
  if (text !== null && unmarkedAskedNo === null) unmarkedAskedNo = typedTurnNo
  return text
}

/**
 * `coordinate.unmarked` : la fin de la demande unique (`yes`, `no` ou `none`), qui pose son repère avec ce que le mod
 * garde de la feuille de route. Refusée sans demande parue ici depuis le chargement du mod, hors du siège, ce qui est
 * gardé illisible, ou le repère déjà posé (sauf le même oui renvoyé dans son tour, qui dit la fenêtre encore ouverte).
 * Un oui ne s'enregistre que du fil principal, dans un tour tapé par la personne après la première parution de la
 * demande, ce tour encore en cours juste avant l'écriture du repère ; il ouvre la fermeture des discussions sans marque
 * pour ce seul tour.
 */
const recordUnmarked = async ($: any, value: unknown, isAgent: boolean): Promise<string> => {
  if (!UNMARKED_ANSWERS.includes(value as UnmarkedAnswer)) return `Refused: "unmarked" takes ${UNMARKED_ANSWERS.map(a => `"${a}"`).join(', ')}; nothing recorded, close nothing.`
  // Un spécialiste ne tranche jamais la demande, ni par un oui ni par un non : elle revient alors à la discussion du COO.
  if (isAgent) return 'Refused: "unmarked" is sent only by the COO discussion itself, never by a specialist; nothing recorded, close nothing.'
  if (unmarkedAskedNo === null) return 'Refused: no one-time request about these discussions was shown in this discussion since the dashboard loaded; nothing recorded, close nothing.'
  if (value === 'yes' && (isAgent || typedTurn?.phase !== 'started' || typedTurnNo <= unmarkedAskedNo))
    return 'Refused: a "yes" is recorded only from you, in the turn of a message the user typed after the request was shown; close nothing, and ask the user again.'
  const yesOpen = 'Recorded: the one-time request is settled; it does not come back. In this turn only, the control {"coordinate": {"toClose": [...]}} also returns these discussions: follow the procedure now, in this turn.'
  // Le même oui renvoyé dans le tour où il est enregistré (une réponse perdue) : la fenêtre reste ouverte, dit tel quel.
  if (value === 'yes' && isUnmarkedTurn(isAgent)) return yesOpen
  // Le tour vérifié ici, gardé avant les attentes : la fenêtre ne s'ouvre que s'il est encore le tour en cours à la fin.
  const turn = typedTurn
  const seat = await seatForWrite($)
  if (!seat.ok) return 'Not recorded: this discussion does not hold the COO seat, or the missions file could not be read; close nothing.'
  const state = await loadRoadmapState($, seat.local.root)
  if (state === 'unread' || 'broken' in state) return 'Not recorded: what the dashboard keeps could not be read; close nothing, and send it again.'
  if (state.unmarkedAt !== undefined) return 'Not recorded: the one-time request was already settled; close nothing for it.'
  // Le oui ne se consomme jamais pour un autre tour : un tour changé pendant les relectures ne pose rien.
  if (value === 'yes' && typedTurn !== turn) return 'Not recorded: the turn of the yes changed meanwhile (a new message, or an interruption); close nothing, and ask the user again.'
  if (!(await saveRoadmapState($, seat.local.root, { unmarkedAt: await $.clock.now() }))) return 'Not recorded: what the dashboard keeps could not be written; close nothing, and send it again.'
  if (value !== 'yes') return 'Recorded: the one-time request is settled; it does not come back.'
  if (typedTurn !== turn) return 'Recorded, but the turn of the yes changed during the write: the one-time request is settled and these discussions are not closed; tell the user, in one line, that they stay open (to close by hand if they want).'
  unmarkedYesTurn = turn
  return yesOpen
}

/** Ce que le relevé du COO ajoute pour « À reprendre » : les déclarations à recopier, les missions closes à relever, le relevé unique de l'existant. */
const cooSetAsideCtx = async ($: any, board: Board): Promise<{ setAside: CooSetAside[]; boxesUnread: string[]; toGlean: CooGlean[]; existingGleaned: boolean | null }> => {
  const state = await loadRoadmapState($, board.root)
  const isRead = state !== 'unread' && !('broken' in state)
  const since = isRead ? (state.gleanedAt ?? 0) : 0
  // Sans fichier de coordination bien relu, on ne sait ni ce qui est recopié ni ce qui est relevé : rien n'est redemandé.
  if (coordNow?.state !== 'read' && coordNow?.state !== 'absent') return { setAside: [], boxesUnread: [...boxesUnread, ...boxesAside], toGlean: [], existingGleaned: isRead ? state.gleanedAt !== undefined : null }
  const gleaned = gleanedRuns(coordLive)
  const toGlean: CooGlean[] = []
  for (const run of board.runs) {
    if (toGlean.length >= 10) break
    if (run.status !== 'done' || (gleaned.get(run.id) ?? -1) >= (run.finishedAt ?? 0) || !isSafeId(run.id) || (run.finishedAt ?? run.updatedAt) < since) continue
    const reports = await reportFilesOf($, run.id)
    const markedAway = takenFor(coordLive, run.id, retroItems(run))
    // Une piste d'une rétro qui relit la liste, relue dans la liste d'attente, y vit déjà : pas recopiée dans « À reprendre ».
    const waitlisted = new Set(isWaitlistRetro(run) ? (cooWaitlistOf()?.pistes ?? []).filter(p => p.retro === run.id).map(p => p.id) : [])
    const untaken = run.phases.filter(p => p.skill === 'retro').flatMap(p => p.items.filter(i => i.status === 'todo' && !markedAway.has(i.id) && !waitlisted.has(run.id + '/' + i.id)).map(i => ({ id: i.id, label: i.label })))
    const own = missionReportPath($, run.id)
    // Une présence qui ne se relit pas retient la mission (`reportUnread`), comme un rapport illisible : jamais « pas de rapport ».
    let hasOwn: boolean | 'unread' = false
    if (own)
      try {
        hasOwn = (await $.fs.exists(own)) === true
      } catch {
        hasOwn = 'unread'
      }
    // La validation du compte rendu se relit ici (`isReportValidated`), et le fichier doit porter le tour validé : un
    // rapport réécrit après la validation ne vaut pas. Seule source des états « faite : » au relevé.
    const round = own && hasOwn === true ? validatedRoundOf(run) : null
    const kept = round ? await readMissionReport($, run.id) : null
    const titleShared = board.runs.some(r => r.id !== run.id && sameRoadmapTitle(r.title, run.title))
    // Validé, mais le fichier ne se relit pas ou ne porte pas ce tour : dit tel quel, jamais « pas validé ».
    const fileState = hasOwn === 'unread' || (isReportValidated(run) && kept === 'unread') ? { reportUnread: true } : !isReportValidated(run) ? {} : round === null || kept === null || kept === 'unread' || kept.round !== round ? { reportOtherRound: true } : {}
    toGlean.push({ id: run.id, title: run.title, reports, untaken, ...(own && hasOwn ? { report: own, reportValidated: round !== null && kept !== null && kept !== 'unread' && kept.round === round, ...(round ? { reportRound: round } : {}), ...(titleShared ? { titleShared } : {}), ...fileState } : {}) })
  }
  return { setAside: boxesNow.map(d => ({ id: d.id, source: d.source, text: roadmapText(d.text), ...(d.fixEntry ? { fixEntry: d.fixEntry } : {}) })), boxesUnread: [...boxesUnread, ...boxesAside.map(p => `${p} (copy of an unreadable box, kept)`)], toGlean, existingGleaned: isRead ? state.gleanedAt !== undefined : null }
}

// ─── Plan des vagues du projet, chez le COO ───────────────────────────────
//
// Calculé par le code (`hooks/plan-projet.ts`) sur toutes les missions non archivées, recalculé seulement
// à la fin d'un découpage, à la clôture d'un groupe et à une livraison, et proposé quand il change l'ordre
// validé. Validé (le clic de la personne, ou d'office pour une mission en auto), il s'écrit dans le fichier
// de coordination, une entrée « plan » par attente ; le plan suivant validé remplace celles qu'il couvre.

/** Le dernier plan calculé, et ce qui l'a fait calculer : il ne change qu'aux trois moments du recalcul. */
let planCache: { stamp: string; computed: ProjectPlan } | null = null

/**
 * Ce qui fait recalculer le plan : pour chaque mission non archivée, son découpage fini, son nombre de groupes
 * et d'unités pas encore finies (un découpage, une clôture), sa livraison faite et sa clôture.
 */
const planStamp = (board: Board, units: readonly ProjectUnit[]): string =>
  board.runs
    .filter(r => r.archivedAt === undefined)
    .map(r => {
      const cut = r.phases.some(p => p.skill === 'to-tickets' && p.status === 'done')
      // La livraison : la phase « Version et push » finie (le push en est une étape).
      const delivered = r.phases.some(p => p.skill === 'project:version' && p.status === 'done')
      // Les groupes et les unités pas finies, comptés à part : un découpage qui pose ses groupes (une rétro, une mission sans
      // phase de découpage) les fait changer ensemble, une clôture ne change que les unités.
      return `${r.id}:${cut ? 1 : 0}:${(r.groups ?? []).length}:${units.filter(u => u.run === r.id).length}:${delivered ? 1 : 0}:${r.status === 'done' ? 1 : 0}`
    })
    .sort()
    .join(';')

/** Le plan vu du COO, sur le board relu ; le fichier de coordination illisible : aucun plan ne vaut. */
const cooPlanOf = (board: Board): CooPlan => {
  if (coordNow?.state === 'unread') return { computed: { waves: [], waits: [], delivery: [] }, key: '', isValidated: true, unread: true }
  const units = projectUnits(board)
  const stamp = planStamp(board, units)
  if (!planCache || planCache.stamp !== stamp) planCache = { stamp, computed: projectPlan(units, unitsOverlap) }
  const computed = planCache.computed
  const key = waitsKey(liveWaits(board, computed.waits))
  // Une entrée de plan hors forme : le plan n'est pas validé tel quel, et « ✓ Valider le plan » la remplace.
  return { computed, key, isValidated: !coordPlanBad && key === waitsKey(liveWaits(board, planWaitsOf(coordLive))) }
}

/** Le fichier de coordination relu par le COO porte une entrée de plan hors forme. */
let coordPlanBad = false
/** Les entrées relues à l'instant par le COO, telles quelles (hors forme comprises). */
let coordRawNow: unknown[] = []

/**
 * Écrit le plan validé dans le fichier de coordination, par le seul titulaire du siège : les attentes de
 * `runs` (null : toutes les missions) remplacent en entier les entrées « plan » de ces missions (une entrée
 * hors forme comprise, quand c'est tout le plan) ; rien quand elles sont déjà les mêmes.
 */
const writePlan = async ($: any, waits: readonly PlanWait[], runs: ReadonlySet<string> | null): Promise<CoordWrite> => {
  const now = await $.clock.now()
  const isCovered = (raw: unknown): boolean => isPlanEntry(raw) && (runs === null || runs.has(entryRun(raw) ?? ''))
  const wanted = waits.filter(w => runs === null || runs.has(w.run))
  return writeCoordination(
    $,
    entries => {
      const before = planWaitsOf(liveEntries(entries.filter(isCovered), () => false))
      if (waitsKey(before) === waitsKey(wanted) && !entries.some(e => isCovered(e) && soundEntry(e) === null)) return null
      return [...entries.filter(e => !isCovered(e)), ...wanted.map((w, i) => ({ id: newEntryId(now + i, Math.random()), kind: 'plan', run: w.run, at: now, held: w.group, awaited: { run: w.awaited.run, group: w.awaited.group } }))]
    },
    false,
    isCovered,
  )
}

/** « ✓ Valider le plan » chez le COO : seulement le plan affiché (sa clé), qui devient l'ordre de départ. */
const validatePlan = async ($: any, key: string): Promise<string> => {
  const board: Board | null = await read($, boardAtom)
  if (!board) return '◆ Rien n’est validé : le tableau de bord ne se lit pas.'
  const plan = cooPlanOf(board)
  if (plan.unread) return `◆ Rien n’est validé : ${COORD_UNREAD}`
  if (plan.key !== key) return '◆ Rien n’est validé : le plan vient de changer ; relis-le, puis reclique.'
  const out = await writePlan($, liveWaits(board, plan.computed.waits), null)
  // Relu tout de suite : la vue ne propose plus ce qui vient d'être validé.
  if (out === 'ok') await quietly(() => refreshCooPlanRead($, board))
  return out === 'ok' ? '◆ Plan du projet validé : les missions le suivent.' : out === 'none' ? '◆ Ce plan est déjà celui du projet.' : `◆ Rien n’est validé : ${coordWriteWhy(out)}`
}

/** Relit le fichier de coordination pour le seul plan du COO (après une validation), sans rien appliquer d'autre. */
const refreshCooPlanRead = async ($: any, board: Board) => {
  const got = await readCoordination($, board.root)
  if (got.state !== 'read') return
  const erased = await erasedRunsOf($, [board])
  coordLive = liveEntries(got.file.entries, id => erased.has(id))
  coordRawNow = got.file.entries
  coordPlanBad = got.file.entries.some(e => isPlanEntry(e) && soundEntry(e) === null)
}

/** D'office, pour les missions en auto : le plan calculé s'écrit pour elles quand il change ce qu'il leur fait attendre. */
const applyPlanToAuto = async ($: any, board: Board) => {
  const plan = cooPlanOf(board)
  if (plan.unread) return
  const autoRuns = new Set(board.runs.filter(r => r.archivedAt === undefined && isAutoOn(r)).map(r => r.id))
  if (autoRuns.size === 0) return
  const live = liveWaits(board, plan.computed.waits)
  const want = waitsKey(live.filter(w => autoRuns.has(w.run)))
  const have = waitsKey(liveWaits(board, planWaitsOf(coordLive)).filter(w => autoRuns.has(w.run)))
  // Une entrée de plan hors forme qui vise une mission en auto la bloque : réécrite d'office, comme un plan changé.
  // (Une entrée sans mission lisible vise toutes les missions : seul le clic « ✓ Valider le plan » la remplace.)
  const isBadHere = coordRawNow.some(e => isPlanEntry(e) && soundEntry(e) === null && autoRuns.has(entryRun(e) ?? ''))
  if (want === have && !isBadHere) return
  // Jamais d'attente croisée : les attentes nouvelles des missions en auto, avec celles des autres missions gardées
  // telles qu'elles sont validées, ne doivent former aucun cycle ; sinon le plan reste proposé, à valider d'un clic.
  const kept = liveWaits(board, planWaitsOf(coordLive)).filter(w => !autoRuns.has(w.run))
  if (hasWaitCycle([...kept, ...live.filter(w => autoRuns.has(w.run))])) return
  await writePlan($, live, autoRuns)
}

/**
 * La prochaine vague du projet vue du COO : pour chaque mission ouverte ici ou ailleurs (une discussion la
 * porte), les groupes que sa carte « Ensuite » propose maintenant, plan du projet et retenues compris, sans
 * deux groupes de missions différentes sur un même fichier ; et ce que sont devenues les vagues lancées depuis
 * moins de 20 minutes (parti, en attente, retenu, pas parti).
 */
const cooWaveOf = (board: Board, now: number): CooWave => {
  // Le fichier de coordination illisible chez le COO : aucun plan ne vaut, aucune vague ne se propose.
  const isUnread = coordNow?.state === 'unread'
  // Ce que la carte « Ensuite » de chaque mission ouverte propose maintenant.
  const proposals: { run: Run; groups: string[] }[] = []
  for (const run of isUnread ? [] : board.runs) {
    if (run.archivedAt !== undefined || run.status !== 'active' || !isSafeId(run.owner) || !isSafeId(run.id)) continue
    // Une entrée de plan hors forme qui vise la mission (ou aucune mission lisible) : sa carte « Ensuite » ne propose rien.
    if (isPlanUnreadFor(coordRawNow, run.id)) continue
    const forces = forcesFor(coordLive, run.id)
    const holds = [...outsideHolds(board, run.id, forces), ...planHolds(board, run.id, planWaitsOf(coordLive, run.id), forces)]
    const rec = nextLaunchFor(run, holdMapOf(holds))
    const groups = (rec?.kind === 'parallel' ? rec.groups : rec?.kind === 'group' && rec.isDelegable ? [rec.group] : []).filter(isGroupId)
    if (groups.length > 0) proposals.push({ run, groups })
  }
  const proposedOf = (id: string): string[] => proposals.find(p => p.run.id === id)?.groups ?? []
  const units = projectUnits(board)
  const unitOf = (run: string, group: string) => units.find(u => u.run === run && u.group === group)
  // Les groupes d'une vague encore en cours de lancement (pas partis, toujours proposés) gardent leurs fichiers :
  // une nouvelle vague n'y met aucun groupe d'une autre mission qui les touche.
  const taken: ProjectUnit[] = []
  for (const e of coordLive) {
    if (e.kind !== 'wave' || now - e.at >= WAVE_TTL_MS) continue
    const group = (g: string) => board.runs.find(r => r.id === e.run)?.groups?.find(x => x.id === g)
    for (const g of e.groups) {
      const unit = unitOf(e.run, g)
      if (unit && proposedOf(e.run).includes(g) && group(g)?.linked === undefined) taken.push(unit)
    }
  }
  // Deux groupes de missions différentes qui touchent un même fichier (ou une même ressource) ne partent jamais
  // dans la même vague, ni pendant qu'une vague lance l'un d'eux : le premier proposé garde sa place.
  const next: CooWave['next'] = []
  for (const { run, groups: proposed } of proposals) {
    const groups = proposed.filter(g => {
      const unit = unitOf(run.id, g)
      if (!unit || taken.some(t => t.run !== run.id && unitsOverlap(t, unit))) return false
      taken.push(unit)
      return true
    })
    if (groups.length > 0) next.push({ id: run.id, title: run.title, groups })
  }
  const report: CooWave['report'] = []
  for (const e of coordLive) {
    if (e.kind !== 'wave' || now - e.at >= 2 * WAVE_TTL_MS) continue
    const run = board.runs.find(r => r.id === e.run)
    const isOpen = run !== undefined && run.archivedAt === undefined && run.status === 'active' && isSafeId(run.owner)
    // Ce que la mission propose elle-même (sans le tri entre missions de la prochaine vague) : son groupe d'une vague
    // en cours y reste « en attente » tant qu'elle le propose.
    const proposed = proposedOf(e.run)
    for (const g of e.groups) {
      const group = run?.groups?.find(x => x.id === g)
      // Parti : lancé depuis le clic (un groupe rendu par son worker avant le clic n'est pas parti avec la vague).
      const isGone = group !== undefined && [group.linked, group.delegated].some(l => l !== undefined && l.at >= e.at)
      // Retenu : la mission est ouverte mais le plan ou une retenue ne le fait plus partir ; en attente : elle le propose
      // toujours (sa discussion occupée) ; pas parti : la mission n'est plus ouverte, ou 10 minutes ont passé sans départ.
      const state = isGone ? 'launched' : !isOpen ? 'missed' : !proposed.includes(g) ? 'held' : now - e.at < WAVE_TTL_MS ? 'pending' : 'missed'
      report.push({ wave: e.wave, mission: run?.title ?? e.run, group: g, at: e.at, state })
    }
  }
  return { next, key: next.map(m => `${m.id}:${m.groups.join('+')}`).join(','), isLaunching: report.some(r => r.state === 'pending'), report }
}

/** Un clic « ⇉ Lancer la vague » en cours d'écriture : un second clic pendant ce temps ne fait rien. */
let isWaveLaunching = false

/**
 * « ⇉ Lancer la vague » chez le COO : une entrée « wave » par mission, avec les seuls groupes affichés au
 * clic (`key`), écrite par le seul titulaire du siège ; le mod de chaque manager lance lui-même les siens.
 * Rien quand la vague a changé depuis l'affichage, ou qu'une vague est encore en cours de lancement.
 */
const launchWave = async ($: any, key: string): Promise<string> => {
  if (isWaveLaunching) return '◆ Lancement en cours : rien de plus.'
  isWaveLaunching = true
  try {
    const board: Board | null = await read($, boardAtom)
    if (!board) return '◆ Rien n’est lancé : le tableau de bord ne se lit pas.'
    const now = await $.clock.now()
    const wave = cooWaveOf(board, now)
    if (wave.isLaunching) return '◆ Une vague est encore en cours de lancement : rien de plus.'
    if (wave.key !== key || wave.next.length === 0) return '◆ Rien n’est lancé : la prochaine vague vient de changer ; relis-la, puis reclique.'
    const waveId = newEntryId(now, Math.random())
    const written = await writeCoordination($, entries => [...entries, ...wave.next.map((m, i) => ({ id: newEntryId(now + i + 1, Math.random()), kind: 'wave', run: m.id, at: now, wave: waveId, groups: m.groups }))])
    if (written !== 'ok') return `◆ Rien n’est lancé : ${coordWriteWhy(written)}`
    await quietly(() => refreshCooPlanRead($, board))
    return `⇉ Vague lancée : chaque manager lance lui-même ses groupes (${wave.next.map(m => `« ${neutralLine(clip(m.title, 40))} » : ${m.groups.join(', ')}`).join(' · ')}).`
  } finally {
    isWaveLaunching = false
  }
}

/**
 * Une coupure de l'auto d'une mission, par le seul titulaire du siège : d'un clic « ✋ Couper l'auto » sur sa
 * ligne (`click`, sur un auto allumé), ou par son Claude (`coo`, aussi sur une pause posée par le mod, pour
 * qu'elle ne reprenne pas). Une entrée `cutAuto` que le mod de la mission applique dans sa discussion ; le COO
 * n'écrit jamais l'état auto lui-même, et aucune entrée ne peut l'allumer. Une coupure déjà demandée depuis le
 * dernier allumage ne s'écrit pas deux fois.
 */
const requestCut = async ($: any, id: string, by: 'click' | 'coo'): Promise<{ out: 'ok' | 'gone' | 'off' | 'already' | CoordWrite; title: string; isOpen: boolean; entryId: string }> => {
  const local: Board | null = await read($, boardAtom)
  const now = await $.clock.now()
  const entryId = newEntryId(now, Math.random())
  let why: 'gone' | 'off' | 'already' | null = null
  let title = ''
  let isOpen = false
  const written = await writeCoordination($, (entries, stored) => {
    const run = (stored ?? local)?.runs.find(r => r.id === id && r.archivedAt === undefined)
    title = run?.title ?? ''
    isOpen = run !== undefined && isOpenMission(run)
    const isCuttable = run !== undefined && (isAutoOn(run) || (by === 'coo' && isAutoPauseStored(run)))
    why = !run ? 'gone' : !isCuttable ? 'off' : null
    // Bornée par le modèle (`autoOnAtOf`) ; une coupure datée dans le futur ne compte pas (elle ne s'applique pas encore).
    const onAt = run ? (autoOnAtOf(run) ?? -1) : -1
    if (why === null && liveEntries(entries, () => false).some(e => e.kind === 'cutAuto' && e.run === id && e.at >= onAt && isCutDated(e, now))) why = 'already'
    return why === null ? [...entries, { id: entryId, kind: 'cutAuto', run: id, at: now, by }] : null
  })
  return { out: why ?? written, title, isOpen, entryId }
}

/** Le bouton « ✋ Couper l'auto » d'une ligne de mission chez le COO : un toast qui dit ce qui s'est passé. */
const requestCutClick = async ($: any, mission: string): Promise<string> => {
  if (!isSafeId(mission)) return '◆ Rien n’est fait : ce bouton ne se lit pas ; relis la vue.'
  const { out, title, isOpen } = await requestCut($, mission, 'click')
  const name = `« ${neutralLine(clip(title, 60))} »`
  if (out === 'gone') return '◆ Rien n’est fait : la mission n’est plus dans le fichier des missions.'
  if (out === 'off') return `◆ Rien n’est fait : l’auto de ${name} est déjà éteint.`
  if (out === 'already') return `◆ Coupure déjà notée : ${name} coupe son auto d’elle-même.`
  if (out !== 'ok') return `◆ Rien n’est fait : ${coordWriteWhy(out)}`
  return isOpen ? `◆ Coupure notée : ${name} coupe son auto d’elle-même.` : `◆ Coupure notée, mais ${name} n’est ouverte dans aucune discussion : son auto n’envoie rien, et la coupure s’applique à sa reprise.`
}

/** `coordinate.cutAuto` : le Claude du COO coupe l'auto d'une mission qui part de travers ; il ne peut jamais l'allumer. */
const recordCut = async ($: any, one: unknown): Promise<string> => (await recordCutWith($, one)).said

/** `recordCut`, avec l'id de l'entrée de coupure écrite (absent sans écriture) : le journal de la nuit le garde. */
const recordCutWith = async ($: any, one: unknown): Promise<{ said: string; entry?: string }> => {
  const mission = one !== null && typeof one === 'object' && !Array.isArray(one) ? (one as Record<string, unknown>).mission : undefined
  if (!isSafeId(mission)) return { said: 'A "cutAuto" without a well-formed mission id was refused.' }
  const { out, title, isOpen, entryId } = await requestCut($, mission, 'coo')
  const name = neutralQuoted(title)
  if (out === 'gone') return { said: `Mission ${neutralQuoted(mission)} is not in the missions file: nothing written.` }
  if (out === 'off') return { said: `Mission ${name}: its auto mode is already off (switched off by the user or the mission is over): nothing written.` }
  if (out === 'already') return { said: `Mission ${name}: a cut of its auto mode is already recorded since it was last switched on: nothing written.` }
  if (out !== 'ok') return { said: `Nothing written for mission ${name}: ${coordWriteWhy(out)}` }
  return {
    said: `Auto cut recorded for mission ${name}: ${isOpen ? 'its dashboard switches its auto mode off by itself, reason « coupé par le COO »' : 'it is open in no discussion, so its auto sends nothing; the cut applies when it is resumed'}. Tell the user, in your next message, that you cut it and why. You can never switch auto on: only the user does, by a click.`,
    entry: entryId,
  }
}

/**
 * Le geste « clore » du COO hors livraison (`coordinate.close`) : la mission se clôt sans marque de
 * livraison et sans archivage ; en pause, par le mod du COO ; ouverte, par une entrée « close » sans résultat.
 */
const requestClose = async ($: any, id: string): Promise<string> => {
  const seat = await seatForWrite($)
  if (!seat.ok) return seat.why === 'unread' ? `Nothing written: ${SEAT_UNREAD}` : 'Nothing written: this discussion does not hold the COO seat.'
  const run = (seat.stored ?? seat.local).runs.find(r => r.id === id)
  if (!run) return `Mission ${neutralQuoted(id)} is not in the missions file: nothing written.`
  if (run.archivedAt !== undefined) return `Mission ${neutralQuoted(run.title)} is already archived.`
  if (run.status === 'done') return `Mission ${neutralQuoted(run.title)} is already closed: nothing changed (it is not archived).`
  if (run.status !== 'active') {
    const out = await closeIdle($, id)
    if (out === 'closed' || out === 'already' || out === 'stale') return `Mission ${neutralQuoted(run.title)} was paused: the dashboard closed it, without archiving it and without marking it delivered.`
    if (out === 'unwritten') return `Mission ${neutralQuoted(run.title)}: the missions file could not be read or written just now; if it was closed here, the next save writes it. Check the COO statement of the next message before asking again.`
    if (out !== 'active') return `Mission ${neutralQuoted(run.title)} could not be closed (${out === 'not-seat' ? 'this discussion does not hold the COO seat' : 'it is no longer in the missions file'}): nothing changed.`
  }
  const now = await $.clock.now()
  const entryId = newEntryId(now, Math.random())
  const written = await writeCoordination($, entries => [...entries, { id: entryId, kind: CLOSE_KIND, run: id, at: now }])
  if (written !== 'ok') return `Nothing written for mission ${neutralQuoted(run.title)}: ${coordWriteWhy(written)}`
  return `Close requested for mission ${neutralQuoted(run.title)} (without archiving it). ${await wakeManager($, id)}`
}

// ─── Questions et gestes chez le COO ──────────────────────────────────────
//
// Les questions bloquantes des missions en auto paraissent chez le COO. Un geste (autoriser une dépense ou
// une action externe, laisser une faille sans correctif) se fait d'un clic : une entrée « gesture » avec
// l'empreinte du texte affiché. Une décision écrite passe par le `DECISIONS.md` de la mission, que le Claude
// du COO écrit et commite, puis une entrée « answer ». Le mod de la mission applique l'une ou l'autre une
// fois, seulement si la question n'a pas changé. Invariant : « Un geste n'est appliqué que sur le texte de
// question que l'utilisateur a vu ; une question changée depuis le clic n'est pas répondue. »

/** Les gestes et les réponses écrites relus à l'instant par le COO. */
const relaysLive = (): (CoordGesture | CoordAnswer)[] => coordLive.filter((e): e is CoordGesture | CoordAnswer => e.kind === 'gesture' || e.kind === 'answer')

const isOpenRun = isOpenMission

/**
 * Note une réponse sur une question bloquante, par le seul titulaire du siège : seulement sur la question
 * encore ouverte, au texte dont l'empreinte est celle que la personne a lue (relue du fichier des missions au
 * moment d'écrire), et une seule fois par texte. Rend ce qui s'est passé.
 */
const writeRelay = async ($: any, mission: string, question: string, print: string, entry: (id: string, now: number) => CoordGesture | CoordAnswer): Promise<{ out: 'ok' | 'changed' | 'gone' | 'already' | 'kind' | CoordWrite; title: string; isOpen: boolean }> => {
  const local: Board | null = await read($, boardAtom)
  const now = await $.clock.now()
  const id = newEntryId(now, Math.random())
  let why: 'changed' | 'gone' | 'already' | 'kind' | null = null
  let title = ''
  let isOpen = false
  const kind = entry(id, now).kind
  const written = await writeCoordination($, (entries, stored) => {
    const run = (stored ?? local)?.runs.find(r => r.id === mission && r.archivedAt === undefined)
    const q = run ? openQuestions(run).find(x => x.id === question) : undefined
    title = run?.title ?? ''
    isOpen = run !== undefined && isOpenRun(run)
    why = !q ? 'gone' : questionPrint(q) !== print ? 'changed' : null
    // Un geste ne se fait que d'un clic, sur une question qui le porte ; une réponse écrite ne vise ni un geste
    // (le message d'une autre session n'en tient jamais lieu) ni une question du mod lui-même.
    if (why === null && q && (kind === 'gesture' ? !q.gesture : q.gesture !== undefined || isModQuestion(q.id))) why = 'kind'
    // Déjà répondu sur ce texte, il y a moins de deux minutes ; passé ce délai, une nouvelle réponse s'écrit.
    if (why === null && liveEntries(entries, () => false).some(e => (e.kind === 'gesture' || e.kind === 'answer') && e.run === mission && e.question === question && e.print === print && now - e.at < RELAY_PENDING_MS)) why = 'already'
    return why === null ? [...entries, entry(id, now)] : null
  })
  if (local) await quietly(() => refreshCooPlanRead($, local))
  return { out: why ?? written, title, isOpen }
}

/** Un bouton de geste chez le COO : l'entrée porte l'empreinte du texte affiché au clic. */
const requestGesture = async ($: any, d: { mission: string; question: string; print: string; answer: 'yes' | 'no' }): Promise<string> => {
  if (!isSafeId(d.mission) || !isQuestionRef(d.question) || !isPrint(d.print) || (d.answer !== 'yes' && d.answer !== 'no')) return '◆ Rien n’est fait : ce bouton ne se lit pas ; relis la vue.'
  const { out, title, isOpen } = await writeRelay($, d.mission, d.question, d.print, (id, now) => ({ id, kind: 'gesture', run: d.mission, at: now, question: d.question, print: d.print, answer: d.answer }))
  const name = `« ${neutralLine(clip(title, 60))} »`
  if (out === 'changed') return `◆ Rien n’est fait : la question de ${name} a changé depuis ; relis-la, puis reclique.`
  if (out === 'gone') return '◆ Rien n’est fait : la question n’est plus ouverte.'
  if (out === 'kind') return '◆ Rien n’est fait : cette question ne porte pas ce geste ; relis la vue.'
  if (out === 'already') return '◆ Déjà répondu sur ce texte : la mission l’applique.'
  if (out !== 'ok') return `◆ Rien n’est fait : ${coordWriteWhy(out)}`
  return isOpen ? `◆ Réponse notée : ${name} l’applique d’elle-même.` : `◆ Réponse notée, mais ${name} n’est ouverte dans aucune discussion : reprends-la pour que la réponse s’applique.`
}

/**
 * Une décision écrite, relayée par le Claude du COO (`coordinate.answer`) : la question et l'empreinte du
 * texte que la personne a lu, le `DECISIONS.md` de la mission (un fichier qui existe sous `travail/`, nommé
 * ainsi, sans `..`) et le numéro de la série qu'il y a écrite.
 */
const recordAnswer = async ($: any, one: unknown): Promise<string> => {
  const x = one !== null && typeof one === 'object' && !Array.isArray(one) ? (one as Record<string, unknown>) : {}
  if (!isSafeId(x.mission) || !isQuestionRef(x.question) || !isPrint(x.seen) || !isSeries(x.series)) return 'An "answer" was refused: it needs "mission" (a mission id), "question" (the question id), "seen" (the text print the statement gave) and "series" (a whole number).'
  if (!isDecisionsPath(x.file)) return 'An "answer" was refused: "file" must be the path, from the project root, of an existing DECISIONS.md under travail/ (no « .. »); ask the user where to write when the mission has none.'
  const file = x.file
  if (!(await projectFileExists($, file))) return `An "answer" was refused: ${asciiJson(file)} does not exist in the project; ask the user where to write.`
  const mission = x.mission
  const question = x.question
  const seen = x.seen
  const series = x.series
  const { out, title, isOpen } = await writeRelay($, mission, question, seen, (id, now) => ({ id, kind: 'answer', run: mission, at: now, question, print: seen, file, series }))
  const name = neutralQuoted(title)
  if (out === 'changed') return `Not recorded: question ${neutralQuoted(question)} of mission ${name} changed since the user read it. Show them its new text (the next statement gives it) and ask again.`
  if (out === 'gone') return `Not recorded: question ${neutralQuoted(question)} is no longer open in that mission.`
  if (out === 'kind') return `Not recorded: question ${neutralQuoted(question)} is a gesture (answered only by the user's click on its buttons in the Coordination view, never by a written answer) or a question of the dashboard itself (answered in its mission).`
  if (out === 'already') return 'Already recorded for this text of the question.'
  if (out !== 'ok') return `Not recorded: ${coordWriteWhy(out)}`
  return `Answer to question ${neutralQuoted(question)} of mission ${name} recorded: ${isOpen ? 'its dashboard relays it to its manager, which withdraws the question.' : "that mission is not open in any discussion: tell the user to resume it so that the answer applies (« reprends-la pour que la réponse s'applique »)."}`
}

/** Un fichier du projet, par son chemin depuis la racine (déjà contrôlé) : vrai seulement s'il existe. */
const projectFileExists = async ($: any, rel: string): Promise<boolean> => {
  const board: Board | null = await read($, boardAtom)
  const root = (board?.root ?? '').replace(/[\\/]+$/, '')
  let isThere = false
  await quietly(async () => {
    isThere = (await $.fs.exists(root === '' ? rel : `${root}/${rel}`)) === true
  })
  return isThere
}

/** Une réponse en cours d'application ici : la relecture suivante attend. */
let isApplyingRelay = false

const unnoteApplied = async ($: any, runId: string, id: string) => {
  await quietly(async () => {
    const before = soundApplied(await $.store.get(appliedKey(runId)))
    await $.store.set(appliedKey(runId), before.filter(x => x !== id))
  })
}

/**
 * La validation ou la reprise du rapport relayée par le COO, pour la mission portée ici. Une validation ne
 * s'applique que sur la version que la personne a lue (le rapport relu à l'instant, même empreinte) et
 * seulement pendant le compte rendu : c'est alors la validation d'aujourd'hui (phase close, choix relus,
 * message de nettoyage des branches à son Claude) ; sinon l'entrée se consomme sans rien valider. Une
 * reprise part à son Claude dans un message composé par le mod. Rend faux pour réessayer à la relecture suivante.
 */
const applyReportRelay = async ($: any, run: Run, e: CoordValidate | Extract<CoordRelay, { kind: 'redo' }>): Promise<boolean> => {
  if (e.kind === 'validate') {
    return withReportLock(async () => {
      const kept = await readMissionReport($, run.id)
      if (kept === 'unread') return false
      await noteApplied($, run.id, e.id)
      // Une autre version que celle lue chez le COO (texte ou tour du compte rendu), ou plus de compte rendu en cours : rien n'est validé.
      if (!kept || keptPrint(kept) !== e.print) return true
      // Relu sur le board de l'écriture : le même tour du compte rendu, toujours en cours et pas encore validé.
      const isAtReport = (r: Run): boolean => r.id === run.id && reportRoundOf(r) === kept.round
      if (await validateHere($, isAtReport)) return true
      // Rien d'écrit alors que le compte rendu est toujours en cours (l'écriture a raté) : la relecture suivante réessaie.
      const still = activeRun(await read($, boardAtom))
      if (still && isAtReport(still)) {
        await unnoteApplied($, run.id, e.id)
        return false
      }
      return true
    })
  }
  if (isTurnOpen) return false
  await noteApplied($, run.id, e.id)
  // Une reprise d'un autre tour du compte rendu, ou d'un rapport déjà validé : rien n'est redemandé.
  if (reportRoundOf(run) !== e.round) return true
  let isIn = false
  await quietly(async () => {
    const r = await modSubmit($, {
      text: `Le COO a écrit dans ${e.file}, série ${e.series}, ce que je veux changer dans le rapport (ma phrase exacte). Relis cette série, réécris le rapport en entier, redonne-le par l'outil flow ({"report": "<le rapport entier>"}), puis envoie {"step": "validate"} : je le relirai chez le COO.`,
    })
    isIn = r !== null && typeof r === 'object' && typeof r.text === 'string' && r.drop === undefined
  })
  if (!isIn) await unnoteApplied($, run.id, e.id)
  return isIn
}

/**
 * Le manager applique, une fois, les réponses que le COO relaie pour la mission portée ici : seulement sur
 * la question encore ouverte au même texte (une question changée ou retirée depuis consomme l'entrée sans
 * rien faire). Une faille laissée s'applique comme un envoi de cette discussion (`security.dismissed`, la
 * question retirée) ; le reste part à son Claude dans un message composé par le mod, Claude au repos.
 */
const applyRelays = async ($: any, runId: string, entries: readonly CoordEntry[], applied: ReadonlySet<string>) => {
  if (isApplyingRelay || isApplyingWave || isTurnOpen || isAutoDeciding || isAutoCompacting) return
  const pending = pendingRelaysFor(entries, runId, applied)
  if (pending.length === 0) return
  isApplyingRelay = true
  // Une question au même texte déjà relayée (un second clic, une seconde réponse après le délai de 2 minutes) : sans effet.
  const relayed = new Set(entries.flatMap(x => ((x.kind === 'gesture' || x.kind === 'answer') && x.run === runId && applied.has(x.id) ? [`${x.question}|${x.print}`] : [])))
  try {
    for (const e of pending) {
      const run = activeRun(await read($, boardAtom))
      if (!run || run.id !== runId) return
      if ((e.kind === 'gesture' || e.kind === 'answer') && relayed.has(`${e.question}|${e.print}`)) {
        await noteApplied($, runId, e.id)
        continue
      }
      if (e.kind === 'gesture' || e.kind === 'answer') relayed.add(`${e.question}|${e.print}`)
      if (e.kind === 'validate' || e.kind === 'redo') {
        if (!(await applyReportRelay($, run, e))) return
        continue
      }
      const q = openQuestions(run).find(x => x.id === e.question)
      if (!q || questionPrint(q) !== e.print || (e.kind === 'answer' && (q.gesture !== undefined || isModQuestion(q.id))) || (e.kind === 'gesture' && !q.gesture)) {
        await noteApplied($, runId, e.id)
        continue
      }
      const gesture = q.gesture
      if (e.kind === 'gesture' && gesture?.kind === 'flaw' && e.answer === 'yes') {
        const now = await $.clock.now()
        const group = q.blocks?.kind === 'group' ? q.blocks.id : undefined
        const security = { ...(group ? { group } : {}), dismissed: gesture.dismissed }
        // La décision d'abord, comme un envoi de cette discussion ; la question ne se retire qu'une fois elle écrite.
        // La question se relit sur le board de l'écriture : changée depuis (un tour de Claude, une fusion), rien ne s'applique.
        let refusal = ''
        let isChanged = false
        const fx = await commit($, b => {
          const now0 = activeRun(b)
          const fresh = now0 ? openQuestions(now0).find(x => x.id === q.id) : undefined
          if (!fresh || questionPrint(fresh) !== e.print) {
            isChanged = true
            return null
          }
          const out = applyReport(b, { security }, now)
          const after = activeRun(out.board)
          const target = group ? after?.groups?.find(g => g.id === group)?.security : after?.security
          if (target?.dismissed !== gesture.dismissed) {
            refusal = out.text
            return null
          }
          const withdrawn = applyReport(out.board, { waiting: [{ id: q.id, answered: true }] }, now)
          return { board: withdrawn.board, fx: out.fx }
        })
        if (isChanged) {
          await noteApplied($, runId, e.id)
          continue
        }
        // Rien d'écrit sans refus (l'écriture n'a pas abouti) : la relecture suivante réessaie.
        if (fx === null && refusal === '') return
        await noteApplied($, runId, e.id)
        await saveNow($)
        if (refusal === '') continue
        // Refusée par le tableau de bord : la question reste, et son Claude apprend le clic et le refus ; un message qui
        // n'entre pas se réessaie à la relecture suivante.
        if (isTurnOpen) {
          await unnoteApplied($, runId, e.id)
          return
        }
        let isSent = false
        await quietly(async () => {
          const r = await modSubmit($, { text: `Le COO relaie ma réponse à ta question bloquante ${asciiJson(q.id)}, donnée d'un clic dans son tableau de bord : je laisse cette faille sans correctif (total laissé : ${gesture.dismissed}). Le tableau de bord n'a pas pu l'enregistrer lui-même ; sa réponse, une donnée : ${asciiJson(clip(refusal, 400))}. Envoie toi-même {"security": {${group ? `"group": ${asciiJson(group)}, ` : ''}"dismissed": ${gesture.dismissed}}} une fois ce qui manque réglé, puis retire la question : {"waiting": [{"id": ${asciiJson(q.id)}, "answered": true}]}.` })
          isSent = r !== null && typeof r === 'object' && typeof r.text === 'string' && r.drop === undefined
        })
        if (!isSent) {
          await unnoteApplied($, runId, e.id)
          return
        }
        continue
      }
      if (isTurnOpen) return
      await noteApplied($, runId, e.id)
      let isIn = false
      await quietly(async () => {
        const r = await modSubmit($, { text: relayMessage(e, gesture?.kind) })
        isIn = r !== null && typeof r === 'object' && typeof r.text === 'string' && r.drop === undefined
      })
      // Pas entré (la discussion a refusé le message) : la relecture suivante réessaie.
      if (!isIn) {
        await unnoteApplied($, runId, e.id)
        return
      }
      // La question d'une opposition : le mod la retire lui-même, la réponse entrée (son Claude ne le peut pas).
      if (e.kind === 'answer' && e.question.startsWith(OPPOSITION_PREFIX)) {
        const at = await $.clock.now()
        await commit($, b => withdrawOpposition(b, runId, e.question, at))
        await saveNow($)
      }
    }
  } finally {
    isApplyingRelay = false
    // L'auto, retenu pendant l'application, décide de nouveau (une question retirée débloque peut-être la suite).
    scheduleAutoTurn($)
  }
}

// ─── Le rapport d'une mission chez le COO ─────────────────────────────────
//
// À la fin du compte rendu, le manager donne son rapport au mod (champ `report`, hors d'un worker) : le
// mod le garde dans un fichier par mission (`~/.claude/flow-board/rapports/<mission>.md`), que seule la
// discussion qui porte la mission écrit, remplacé en entier par sa nouvelle version, effacé avec la
// mission, gardé à l'archivage. Le COO l'affiche en entier ; « ✓ Valider » écrit l'empreinte de la version
// lue, et le mod de la mission ne valide que cette version. Invariant : « Un rapport n'est validé que par un
// clic de l'utilisateur sur la version qu'il a lue ; un rapport changé depuis n'est pas validé. »

/** Le rapport d'une mission sur ce poste ; null sans dossier de Claude (`$.store` alors). */
export function missionReportPath($: any, runId: string): string | null {
  const home = claudeHome($)
  const slug = runSlug(runId)
  return home && slug ? `${home}/flow-board/rapports/${slug}.md` : null
}
export const missionReportKey = (runId: string): string => `coo-report:${runId}`

/**
 * Le rapport s'écrit et se valide l'un après l'autre, jamais en même temps : une validation relue sur une
 * version ne s'écrit pas pendant que Claude en donne une autre.
 */
let reportLock: Promise<unknown> = Promise.resolve()
const withReportLock = <T,>(work: () => Promise<T>): Promise<T> => {
  const run = reportLock.then(work, work)
  reportLock = run.catch(() => undefined)
  return run
}

/** Le plus long rapport gardé : au-delà, refusé (jamais coupé). */
const MISSION_REPORT_MAX = 200_000

/**
 * Le tour du compte rendu en cours d'une mission (la place de sa phase active, son tour, son début) ; null hors
 * du compte rendu ou une fois le rapport validé. Gardé avec le rapport et compté dans son empreinte : le rapport
 * d'un tour précédent ne se montre ni ne se valide, et une validation d'un tour ne vaut jamais pour un autre.
 */
export const reportRoundOf = (run: Run): string | null => {
  if (isReportValidated(run)) return null
  const at = run.phases.findIndex(p => p.skill === 'compte-rendu' && p.status === 'active')
  return at < 0 ? null : roundAt(run, at)
}

/** Le tour de la phase de compte rendu à cette place : sa place, son tour, son début ; seule source de cette forme. */
const roundAt = (run: Run, at: number): string | null => {
  const phase = run.phases[at]!
  const round = `${at}.${phase.round}.${Math.trunc(phase.startedAt ?? 0)}`
  // Une forme que l'entrée « redo » ne relirait pas : pas de tour, rien ne se garde ni ne se valide.
  return isRound(round) ? round : null
}

/** Le tour du dernier compte rendu d'une mission, une fois validé (le même que `reportRoundOf` pendant ce tour) ; null sans validation. */
export const validatedRoundOf = (run: Run): string | null => (isReportValidated(run) ? roundAt(run, run.phases.map(p => p.skill).lastIndexOf('compte-rendu')) : null)

/** Un rapport gardé : le tour du compte rendu où il a été donné, et son texte. */
export type KeptReport = { round: string; text: string }

/** La première ligne du fichier : le tour du compte rendu, hors du texte du rapport. */
const REPORT_HEAD = new RegExp(`^<!-- flow-board report round (${ROUND_FORM}) -->\n`)

/** L'empreinte d'une version : son tour et son texte entier. */
export const keptPrint = (k: KeptReport): string => reportPrint(`${k.round}\n${k.text}`)

/** Garde le rapport de la mission portée ici, en entier, avec son tour ; faux quand il n'a pas pu s'écrire. */
const writeMissionReport = async ($: any, runId: string, kept: KeptReport): Promise<boolean> => {
  await quietly(() => readTraces($))
  if (erasedRuns.has(runId)) return false
  const path = missionReportPath($, runId)
  const body = `<!-- flow-board report round ${kept.round} -->\n${kept.text}`
  try {
    if (path) await $.fs.write(path, body)
    else await $.store.set(missionReportKey(runId), body)
    return true
  } catch {
    return false
  }
}

/** Relit le rapport d'une mission : son tour et son texte, null sans rapport lisible comme tel, `unread` quand la lecture rate. */
export async function readMissionReport($: any, runId: string): Promise<KeptReport | null | 'unread'> {
  if (!isSafeId(runId)) return null
  const path = missionReportPath($, runId)
  let body: unknown
  try {
    if (path) body = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : null
    else body = await $.store.get(missionReportKey(runId))
  } catch {
    return 'unread'
  }
  if (typeof body !== 'string') return null
  const head = REPORT_HEAD.exec(body)
  return head ? { round: head[1]!, text: body.slice(head[0].length) } : null
}

/** Le champ `report` d'un manager : gardé seulement pendant le compte rendu en cours, avant sa validation. */
const keepMissionReport = async ($: any, input: Readonly<Record<string, unknown>>): Promise<string> => {
  const text = typeof input.report === 'string' ? input.report.trim() : ''
  if (text === '') return ''
  if (text.length > MISSION_REPORT_MAX) return `"report" not kept: ${MISSION_REPORT_MAX} characters at most.`
  return withReportLock(async () => {
    // Relu sous le verrou : une validation appliquée juste avant ferme le tour, et la version d'après n'est plus gardée.
    const board: Board | null = await read($, boardAtom)
    const run = board && !board.delegate ? activeRun(board) : null
    if (!run || !isSafeId(run.id)) return '"report" not kept: no mission is carried by this discussion.'
    const round = reportRoundOf(run)
    if (round === null) return isReportValidated(run) ? '"report" not kept: the report of this round is already validated.' : '"report" not kept: the mission is not at its report (phase « Compte rendu »).'
    if (!(await writeMissionReport($, run.id, { round, text }))) return '"report" not kept: the file could not be written; send it again.'
    return 'Report is kept for the COO, which shows it in full and lets the user validate this version; after any change, give it again in full.'
  })
}

/** Les rapports à valider, relus par le COO à sa dernière relecture : par mission, le texte et son empreinte. */
let reportsNow: { missionId: string; text: string; print: string }[] = []
/** Les rapports que la personne a ouverts dans la vue Coordination : par mission, l'empreinte de la version ouverte. */
const openReports = new Map<string, string>()

/**
 * « ▸ Lire » ouvre la version affichée sur le bouton (son empreinte voyage avec le clic, jamais celle relue
 * entre-temps) ; « ↻ Relire » ouvre de même la version affichée ; « ▾ Replier » replie.
 */
const toggleReport = (mission: string, print: string) => {
  const opened = openReports.get(mission)
  if (opened !== undefined && opened === print) openReports.delete(mission)
  else if (isReportPrint(print)) openReports.set(mission, print)
}

/** Le COO relit les rapports des missions arrivées à leur compte rendu, pas encore validé. */
const watchReports = async ($: any, board: Board) => {
  const out: typeof reportsNow = []
  for (const run of board.runs) {
    if (run.archivedAt !== undefined || run.status === 'done' || !isSafeId(run.id)) continue
    const round = reportRoundOf(run)
    if (round === null) continue
    const kept = await readMissionReport($, run.id)
    // Seulement le rapport de ce tour : celui d'un tour précédent ne se montre pas.
    if (kept && kept !== 'unread' && kept.round === round && kept.text !== '') out.push({ missionId: run.id, text: kept.text, print: keptPrint(kept) })
  }
  reportsNow = out
  // Un rapport qui n'est plus à valider (validé, autre tour, mission close) : son ouverture part avec lui.
  for (const mission of [...openReports.keys()]) if (!out.some(r => r.missionId === mission)) openReports.delete(mission)
}

/** Les rapports vus du COO : la version relue, ouverte ou non, et ce que ses validations en disent. */
const cooReportsOf = (board: Board, now: number): CooReport[] =>
  reportsNow.flatMap(r => {
    const run = board.runs.find(x => x.id === r.missionId)
    if (!run) return []
    const sent = coordLive.filter((e): e is CoordValidate => e.kind === 'validate' && e.run === r.missionId)
    // « En cours d'application » les deux premières minutes seulement, comme un geste : une validation consommée sans
    // effet (rapport réécrit puis revenu au même texte, écriture refusée) ne bloque jamais le bouton.
    // Ouvert sur une autre version que celle relue : la personne n'a pas lu celle-ci, elle la relit avant de valider.
    const opened = openReports.get(r.missionId)
    const state: CooReport['state'] =
      opened !== undefined && opened !== r.print ? 'stale' : sent.some(e => e.print === r.print && now - e.at < RELAY_PENDING_MS) ? 'validating' : sent.some(e => e.print !== r.print) ? 'changed' : 'ready'
    const launch = liveLaunchOf(run)
    return [{ missionId: r.missionId, mission: run.title, print: r.print, text: r.text, isOpen: opened !== undefined, isMissionOpen: isOpenRun(run), state, ...(launch ? { decisions: `travail/${launch.folder}/DECISIONS.md` } : {}) }]
  })

/** « ✓ Valider » chez le COO : seulement sur la version affichée, relue juste avant ; jamais deux fois la même. */
const requestValidate = async ($: any, mission: string, print: string): Promise<string> => {
  if (!isSafeId(mission) || !isReportPrint(print)) return '◆ Rien n’est fait : ce bouton ne se lit pas ; relis la vue.'
  // La version ouverte par la personne, et celle-là seulement.
  if (openReports.get(mission) !== print) return `◆ ${REPORT_CHANGED}.`
  const kept = await readMissionReport($, mission)
  if (kept === 'unread') return '◆ Rien n’est validé : le rapport ne se lit pas ; reclique.'
  if (!kept || keptPrint(kept) !== print) return `◆ ${REPORT_CHANGED}.`
  const local: Board | null = await read($, boardAtom)
  const now = await $.clock.now()
  const id = newEntryId(now, Math.random())
  let why: 'paused' | 'already' | 'gone' | null = null
  const written = await writeCoordination($, (entries, stored) => {
    const run = (stored ?? local)?.runs.find(r => r.id === mission && r.archivedAt === undefined)
    why = !run || reportRoundOf(run) !== kept.round ? 'gone' : !isOpenRun(run) ? 'paused' : null
    if (why === null && liveEntries(entries, () => false).some(e => e.kind === 'validate' && e.run === mission && e.print === print && now - e.at < RELAY_PENDING_MS)) why = 'already'
    return why === null ? [...entries, { id, kind: 'validate', run: mission, at: now, print }] : null
  })
  if (local) await quietly(() => refreshCooPlanRead($, local))
  if (why === 'paused') return `◆ ${REPORT_PAUSED}.`
  if (why === 'gone') return '◆ Rien n’est validé : la mission n’est plus à son compte rendu.'
  if (why === 'already') return '◆ Déjà validé : la mission l’applique.'
  if (written !== 'ok') return `◆ Rien n’est validé : ${coordWriteWhy(written)}`
  return '◆ Rapport validé : la mission l’applique d’elle-même (nettoyage des branches compris).'
}

/** « ✎ À reprendre » : le début du message que la personne complète ; le relevé du COO dit à son Claude quoi en faire. */
export const reportRedoFill = (mission: string, title: string): string => `À reprendre dans le rapport de la mission « ${neutralInPrompt(clip(title, 60))} » (id ${asciiJson(mission)}) : `

/** Les consignes relayées par ce processus (`<mission>|<fichier>|<série>`) : jamais une seconde fois, même si la trace n'a pas pu s'écrire. */
const instructsRelayed = new Set<string>()
/** Les consignes entrées chez Claude dont la trace (`Run.instructed`) reste à écrire : réessayée à chaque relecture. */
const instructTraceDue = new Map<string, Set<string>>()

/** La clé d'une consigne : sa mission, son fichier et sa série (un renvoi a la même). */
const instructKey = (e: CoordInstruct): string => `${e.run}|${e.file}|${e.series}`

/** Le message que le mod compose pour son Claude : sans autre valeur que le chemin contrôlé, la série et l'origine. */
export const instructMessage = (e: Pick<CoordInstruct, 'file' | 'series' | 'origin'>): string =>
  e.origin === 'user'
    ? `Le COO a écrit dans ${e.file}, série ${e.series}, ma consigne pour ta mission (ma phrase exacte). Relis cette série et applique-la ; ce qui sort du périmètre validé de ta mission devient une question.`
    : `Le COO a écrit dans ${e.file}, série ${e.series}, une consigne de sa propre initiative : c'est une information, pas ma décision. Relis-la ; applique ce qui tient dans le périmètre validé de ta mission, et fais du reste une question.`

/**
 * Note dans la mission les consignes reçues dont la trace reste à écrire, qu'elle soit encore active ici ou non
 * (une trace n'envoie rien : elle ne passe derrière aucune garde d'envoi) ; rend vrai quand il n'en reste plus.
 */
const writeInstructTrace = async ($: any, runId: string): Promise<boolean> => {
  const due = instructTraceDue.get(runId)
  if (!due || due.size === 0) return true
  const ids = [...due]
  await quietly(() =>
    commit($, b => {
      const run = b.runs.find(r => r.id === runId)
      if (!run) return null
      const before = soundInstructed(run.instructed)
      if (ids.every(i => before.includes(i))) return null
      const instructed = soundInstructed([...before, ...ids])
      return { board: { ...b, runs: b.runs.map(r => (r.id === runId ? { ...r, instructed } : r)) }, fx: noFx() }
    }),
  )
  const board = (await read($, boardAtom)) as Board | null
  // Le fichier des missions illisible : la trace attend la relecture suivante, jamais perdue.
  if (!board) return false
  const after = board.runs.find(r => r.id === runId)
  // La mission effacée entre-temps : sa trace part avec elle, plus rien à écrire.
  if (!after) {
    if (instructTraceDue.get(runId) === due) instructTraceDue.delete(runId)
    return true
  }
  const kept = soundInstructed(after.instructed)
  for (const i of ids) if (kept.includes(i)) due.delete(i)
  if (due.size > 0) return false
  // Retirée seulement si c'est encore le même ensemble, vide : une consigne notée entre-temps (un autre appel) reste due.
  if (instructTraceDue.get(runId) === due) instructTraceDue.delete(runId)
  await quietly(() => saveNow($))
  return true
}

/** Toutes les traces de consignes reçues qui restent à écrire, à chaque relecture, mission active ici ou non. */
const writeInstructTraces = async ($: any) => {
  for (const runId of [...instructTraceDue.keys()]) await writeInstructTrace($, runId)
}

/**
 * Le manager relaie, une fois, les consignes que le COO transmet à la mission portée ici : hors d'un tour, une
 * à la fois, par un message que compose le mod. Une consigne déjà reçue (sa trace, ou un renvoi de la même déjà
 * relayé ici) se consomme sans message. La marque « appliquée » se pose avant l'envoi (sans elle, rien ne part),
 * se retire sur un refus visible du message (`drop`) ou un appel qui échoue (la relecture suivante réessaie) ;
 * entré, la trace le note.
 */
const applyInstructs = async ($: any, runId: string, entries: readonly CoordEntry[], applied: ReadonlySet<string>) => {
  if (isApplyingRelay || isApplyingWave || isTurnOpen || isAutoDeciding || isAutoCompacting) {
    await writeInstructTrace($, runId)
    return
  }
  // Posé avant tout `await` : une relecture suivante qui chevauche celle-ci ne relaie rien en même temps.
  isApplyingRelay = true
  try {
    await writeInstructTrace($, runId)
    const now = await $.clock.now()
    const pending = pendingInstructsFor(entries, runId, applied, now)
    for (const e of pending) {
      const run = activeRun(await read($, boardAtom))
      if (!run || run.id !== runId) return
      const received = new Set([...soundInstructed(run.instructed), ...(instructTraceDue.get(runId) ?? [])])
      if (instructsRelayed.has(instructKey(e)) || isInstructReceived(e, entries, received)) {
        await noteApplied($, runId, e.id)
        continue
      }
      // Le fichier des missions relu juste avant l'envoi : une autre discussion (ou un autre processus de celle-ci)
      // qui a pris la mission ou noté la consigne reçue l'emporte, et rien ne part d'ici.
      if (!(await pull($))) return
      const fresh = activeRun(await read($, boardAtom))
      if (!fresh || fresh.id !== runId || isInstructReceived(e, entries, new Set(soundInstructed(fresh.instructed)))) return
      const marks = await readApplied($, runId)
      if (!marks || marks.has(e.id)) return
      if (isTurnOpen) return
      if (!(await noteApplied($, runId, e.id))) return
      // Entré, sauf un refus visible (`drop`) ou un appel qui échoue : dans le doute, rien ne se renvoie (au plus une fois).
      let isIn = true
      try {
        const r = await modSubmit($, { text: instructMessage(e) })
        if (r !== null && typeof r === 'object' && (r as { drop?: unknown }).drop !== undefined) isIn = false
      } catch {
        isIn = false
      }
      if (!isIn) {
        await unnoteApplied($, runId, e.id)
        return
      }
      instructsRelayed.add(instructKey(e))
      // Ajoutée à l'ensemble en place (jamais remplacé) : un appel de trace en cours sur lui ne la retire pas.
      const due = instructTraceDue.get(runId) ?? new Set<string>()
      due.add(e.id)
      instructTraceDue.set(runId, due)
      await writeInstructTrace($, runId)
      // Un seul message du mod par relecture : la consigne suivante attend la prochaine.
      return
    }
  } finally {
    isApplyingRelay = false
  }
}

/** Une reprise du rapport relayée par le Claude du COO (`coordinate.redo`) : le `DECISIONS.md` de la mission et la série écrite. */
const recordRedo = async ($: any, one: unknown): Promise<string> => {
  const x = one !== null && typeof one === 'object' && !Array.isArray(one) ? (one as Record<string, unknown>) : {}
  if (!isSafeId(x.mission) || !isSeries(x.series)) return 'A "redo" was refused: it needs "mission" (a mission id) and "series" (a whole number).'
  if (!isDecisionsPath(x.file)) return 'A "redo" was refused: "file" must be the path, from the project root, of an existing DECISIONS.md under travail/ (no « .. »); ask the user where to write when the mission has none.'
  if (!(await projectFileExists($, x.file))) return `A "redo" was refused: ${asciiJson(x.file)} does not exist in the project; ask the user where to write.`
  const mission = x.mission
  const file = x.file
  const series = x.series
  const local: Board | null = await read($, boardAtom)
  const now = await $.clock.now()
  const id = newEntryId(now, Math.random())
  let title = ''
  let isGone = false
  let isOpen = false
  let round: string | null = null
  const written = await writeCoordination($, (entries, stored) => {
    const run = (stored ?? local)?.runs.find(r => r.id === mission && r.archivedAt === undefined)
    title = run?.title ?? ''
    isGone = !run
    isOpen = run !== undefined && isOpenRun(run)
    round = run ? reportRoundOf(run) : null
    return run && round !== null ? [...entries, { id, kind: 'redo', run: mission, at: now, file, series, round }] : null
  })
  if (isGone) return 'Not recorded: no such mission in the missions file.'
  if (written !== 'ok' && written !== 'none') return `Not recorded: ${coordWriteWhy(written)}`
  if (round === null) return `Not recorded: mission ${neutralQuoted(title)} is not at its report, or its report is already validated.`
  if (written !== 'ok') return `Not recorded: ${coordWriteWhy(written)}`
  if (!isOpen) return `Rework of the report of mission ${neutralQuoted(title)} recorded, but that mission is open in no discussion: tell the user « Reprends-la pour que la reprise s’applique » ; its dashboard relays it to its manager once resumed.`
  return `Rework of the report of mission ${neutralQuoted(title)} recorded: its dashboard relays it to its manager, which rewrites the report.`
}

/**
 * Une consigne transmise par le Claude du COO (`coordinate.instruct`) : la série qu'il a écrite dans le
 * `DECISIONS.md` de la mission (un fichier qui existe sous `travail/`, sans `..`), et son origine. L'origine
 * `user` (la phrase de la personne) n'est acceptée que dans un tour ouvert par un message qu'elle a tapé. Une
 * consigne déjà transmise (même mission, même fichier, même série), reçue ou en attente de relais, est refusée ;
 * une consigne « non reçue » au relevé se renvoie par une nouvelle entrée.
 */
const recordInstruct = async ($: any, one: unknown, isAgent: boolean): Promise<string> => {
  const x = one !== null && typeof one === 'object' && !Array.isArray(one) ? (one as Record<string, unknown>) : {}
  if (!isSafeId(x.mission) || !isSeries(x.series)) return 'An "instruct" was refused: it needs "mission" (a mission id) and "series" (a whole number).'
  if (x.origin !== 'user' && x.origin !== 'coo') return 'An "instruct" was refused: "origin" must be "user" (the user\'s sentence) or "coo" (your own initiative).'
  // Un spécialiste n'écrit jamais au nom de la personne, même pendant le tour de son message.
  if (x.origin === 'user' && (isAgent || typedTurn?.phase !== 'started')) return 'An "instruct" was refused: origin "user" is accepted only from you, in a turn opened by a message the user typed. A new instruction of yours goes with origin "coo"; to resend one of theirs, wait for their next message.'
  if (!isDecisionsPath(x.file)) return 'An "instruct" was refused: "file" must be the path, from the project root, of an existing DECISIONS.md under travail/ (no « .. »); ask the user where to write when the mission has none.'
  if (!(await projectFileExists($, x.file))) return `An "instruct" was refused: ${asciiJson(x.file)} does not exist in the project; ask the user where to write.`
  const mission = x.mission
  const file = x.file
  const series = x.series
  const origin = x.origin
  const local: Board | null = await read($, boardAtom)
  const now = await $.clock.now()
  const id = newEntryId(now, Math.random())
  let title = ''
  let isGone = false
  let isClosed = false
  let isOpen = false
  let isSent = false
  let otherOrigin: 'user' | 'coo' | null = null
  const written = await writeCoordination($, (entries, stored) => {
    const run = (stored ?? local)?.runs.find(r => r.id === mission && r.archivedAt === undefined)
    title = run?.title ?? ''
    isGone = !run
    // Une mission close (livrée, ou close par le COO) ne relaiera jamais : refusée, au lieu d'une consigne en attente pour toujours.
    isClosed = run?.status === 'done'
    isOpen = run !== undefined && isOpenRun(run)
    if (!run || isClosed) return null
    const entry: CoordInstruct = { id, kind: 'instruct', run: mission, at: now, file, series, origin }
    const sound = entries.flatMap(raw => soundEntry(raw) ?? [])
    otherOrigin = instructOriginClash(entry, sound, now)
    if (otherOrigin !== null) return null
    isSent = isInstructSent(entry, sound, new Set(soundInstructed(run.instructed)), instructOpenSince(run), now)
    return isSent ? null : [...entries, entry]
  })
  if (isGone) return 'Not recorded: no such mission in the missions file.'
  if (isClosed) return `Not recorded: mission ${neutralQuoted(title)} is closed, it relays nothing; an instruction for that work goes to a new mission (a launch card).`
  if (otherOrigin !== null) return `Not recorded: this instruction (${file}, series ${series}) was first sent with origin "${otherOrigin}"; a resend keeps that origin.`
  if (isSent) return `Not recorded: this instruction (${file}, series ${series}) was already sent to mission ${neutralQuoted(title)}, and it is received or waiting to be relayed; resend it only when the COO statement shows it « non reçue ».`
  if (written !== 'ok') return `Not recorded: ${coordWriteWhy(written)}`
  if (!isOpen) return `Instruction to mission ${neutralQuoted(title)} recorded, but that mission is open in no discussion: its dashboard relays it to its manager once resumed; tell the user « reprends-la pour que la consigne s'applique ».`
  return `Instruction to mission ${neutralQuoted(title)} recorded: its dashboard relays it once to its manager; tell the user what you sent (mission, file, series).`
}

// ─── La livraison chez le COO (« ▶ Livrer ») ──────────────────────────────
//
// Une fois un rapport validé, la carte « ▶ Livrer » du COO dit ce qui partira ; le clic de la personne lance,
// dans la discussion du COO, l'une après l'autre : `/project:version`, `/project:push`, `/project:pr` (projet
// sur GitHub, hors de sa branche par défaut), puis les étapes que le `CLAUDE.md` du projet ajoute après une
// livraison. Claude rend l'issue de chaque étape par le champ `delivery` de l'outil flow ; le mod ne lance la
// suivante que sur une réussite, et seulement dans le processus où la personne a cliqué (`chainArmed`) : après
// un rechargement, la carte dit où elle en était et propose de reprendre. Livrée, chaque mission reçoit une
// entrée de clôture avec le résultat. Chaque geste de la livraison passe par un verrou : deux clics ne se
// croisent jamais. Invariant : « Rien n'est poussé sans un clic "▶ Livrer" de l'utilisateur ; une étape de la
// livraison ne part que si la précédente a réussi ; une seule livraison à la fois. »

/** La livraison du projet, gardée par le poste du COO (`$.store`) : une seule à la fois. */
const deliveryKey = (root: string): string => `coo-delivery:${normRoot(root)}`

/** La livraison que ce processus enchaîne, armée par un clic (« ▶ Livrer », « ↻ Réessayer », « ▶ Reprendre ») ; un rechargement la désarme. */
let chainArmed: string | null = null

/** Les gestes de la livraison, l'un après l'autre : chacun relit l'état que le précédent a écrit. */
let deliveryLock: Promise<unknown> = Promise.resolve()
const withDeliveryLock = <T,>(work: () => Promise<T>): Promise<T> => {
  const run = deliveryLock.then(work, work)
  deliveryLock = run.catch(() => undefined)
  return run
}

/** Relit la livraison gardée : null sans livraison, `unread` quand elle ne se lit pas (rien ne part alors). */
const readDelivery = async ($: any, root: string): Promise<Delivery | null | 'unread'> => {
  try {
    const raw = await $.store.get(deliveryKey(root))
    if (raw === undefined || raw === null) return null
    return parseDelivery(raw) ?? 'unread'
  } catch {
    return 'unread'
  }
}

const writeDelivery = async ($: any, root: string, d: Delivery): Promise<boolean> => {
  try {
    await $.store.set(deliveryKey(root), d)
    return true
  } catch {
    return false
  }
}

/** Une mission dont la discussion livre ou a livré elle-même (une phase de livraison en cours ou faite) : le COO ne la livre pas. */
const isDeliveringHere = (run: Run): boolean => run.phases.some(p => DELIVERY.has(p.skill) && (p.status === 'active' || p.status === 'done'))

/** Une livraison finie dont le push a réussi (livrée en entier, ou abandonnée après le push) : ses missions sont parties. */
const isPushed = (d: Delivery): boolean => d.finishedAt !== undefined && d.steps.some(s => s.key === 'push' && s.status === 'done')

/**
 * Les missions à livrer : rapport validé, ni close ni archivée, pas en train de livrer dans leur discussion,
 * sans clôture demandée depuis leur validation, et pas déjà livrées par la dernière livraison finie sur ce même
 * rapport (une trace durable, gardée avec la livraison, que le fichier de coordination soit lisible ou non).
 */
const deliverables = (board: Board, last: Delivery | null): Run[] =>
  board.runs.filter(
    r =>
      r.archivedAt === undefined &&
      r.status !== 'done' &&
      isReportValidated(r) &&
      isSafeId(r.id) &&
      !isDeliveringHere(r) &&
      !coordLive.some(e => e.kind === 'close' && e.run === r.id && e.at >= (r.reportValidatedAt ?? 0)) &&
      !(last !== null && isPushed(last) && last.missions.some(m => m.id === r.id && m.validatedAt === r.reportValidatedAt)),
  )

/** Ce que la carte dit avant le clic : les commits non poussés, par mission quand on sait les situer, et les missions pas finies à attendre. */
let deliveryPreview: { key: string; commits: { mission: string | null; lines: string[] }[]; waitFor: string[]; waitCommits: string[]; more: number } | null = null

/** Les commits relevés pour l'aperçu (HEAD et la base de la branche dans `key`), relus seulement quand l'une change. */
let previewLog: { key: string; entries: { line: string; at: number }[]; more: number } | null = null

/** Le plus de commits listés par la carte ; au-delà, elle dit combien d'autres partiront. */
const PREVIEW_MAX = 60

/**
 * Les commits que la livraison enverra (ceux de la branche absents du distant), rangés par mission d'après
 * la fenêtre de temps de chaque mission (un commit dans une seule fenêtre lui revient, sinon « hors mission »),
 * et les missions pas finies dont des groupes sont déjà fusionnés ou dont des commits partent (`deliveryWaits`) :
 * la carte recommande alors d'attendre. Les commits ne se relisent que quand HEAD ou la base changent ; leur
 * rangement et les missions à attendre se recalculent à chaque fois, d'après les missions du moment.
 * Rien à relever sans mission à livrer, ni pendant une livraison ouverte.
 */
const measureDeliveryPreview = async ($: any, board: Board): Promise<void> => {
  const root = board.root ?? ''
  const last = await readDelivery($, root)
  if (root === '' || last === 'unread' || isDeliveryOpen(last) || deliverables(board, last).length === 0) {
    deliveryPreview = null
    return
  }
  const head = (await runGit($, root, ['rev-parse', 'HEAD'], 5000)).stdout
  const upstream = await runGit($, root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 5000)
  const base = upstream.exitCode === 0 && upstream.stdout ? '@{u}' : 'origin/HEAD'
  const baseSha = (await runGit($, root, ['rev-parse', base], 5000)).stdout
  const logKey = `${head}|${baseSha}`
  if (previewLog?.key !== logKey) {
    const count = await runGit($, root, ['rev-list', '--no-merges', '--count', `${base}..HEAD`], 5000)
    const log = await runGit($, root, ['log', '--no-merges', `--max-count=${PREVIEW_MAX}`, '--format=%h%x1f%ct%x1f%s', `${base}..HEAD`], 10_000)
    const entries: { line: string; at: number }[] = []
    for (const line of log.exitCode === 0 ? log.stdout.split('\n') : []) {
      const [sha, ct, subject] = line.split('\u001f')
      if (!sha || !subject) continue
      entries.push({ line: `${sha} ${subject}`, at: Number(ct) * 1000 })
    }
    const total = Number(count.stdout)
    // Une relecture ratée ne se garde pas : la suivante la refait, sinon les missions à attendre resteraient tues jusqu'au prochain commit.
    previewLog = { key: log.exitCode === 0 ? logKey : '', entries, more: count.exitCode === 0 && Number.isFinite(total) && total > entries.length ? total - entries.length : 0 }
  }
  const groups = new Map<string | null, string[]>()
  const windows = board.runs.filter(r => r.archivedAt === undefined).map(r => ({ title: r.title, from: r.startedAt, to: r.finishedAt ?? Number.MAX_SAFE_INTEGER }))
  for (const { line, at } of previewLog.entries) {
    const inside = windows.filter(w => at >= w.from && at <= w.to)
    const mission = inside.length === 1 ? inside[0]!.title : null
    groups.set(mission, [...(groups.get(mission) ?? []), line])
  }
  // Une mission qui livre déjà elle-même pousse ses propres commits : rien à attendre d'elle (comme `deliverables`).
  const waits = deliveryWaits(board.runs.filter(r => !isDeliveringHere(r)), previewLog.entries.map(e => e.at), previewLog.more === 0)
  // La clé dit ce que montre la carte (la branche relevée et les missions à attendre) : le clic « ▶ Livrer » ne vaut que pour elle.
  const key = `${logKey}|${waits.groups.join('\u0001')}|${waits.commits.join('\u0001')}`
  deliveryPreview = { key, commits: [...groups.entries()].map(([mission, lines]) => ({ mission, lines })), waitFor: waits.groups, waitCommits: waits.commits, more: previewLog.more }
}

/** Les commits de la branche de travail depuis le départ du plus ancien groupe en cours, et ceux de la branche du worker de chaque groupe ; relus quand HEAD, ce départ ou la pointe d'une de ces branches changent. */
let outsideLog: { key: string; commits: LoggedCommit[]; own: Map<string, Set<string>> } | null = null

/** Le plus de commits relus ; au-delà, les plus anciens ne comptent pas. */
const OUTSIDE_MAX = 2000

/**
 * Relit les commits de la première lignée de la branche de travail depuis le départ du plus ancien groupe en cours,
 * avec leurs fichiers (une fusion face à son premier parent : un commit hors mission arrivé par une fusion se voit,
 * une fusion d'un manager est excusée par son journal), et les commits de la branche du worker de chaque groupe
 * (une fusion en avance rapide les met dans la première lignée). Aucune valeur du fichier des missions n'entre dans
 * une commande, hors la date, un entier : les chemins des groupes ne servent qu'à comparer, et une branche de worker
 * se reconnaît dans la liste que git rend, puis passe par son sha. Une commande ratée ne montre rien.
 */
const measureOutsideCommits = async ($: any, board: Board): Promise<void> => {
  const root = board.root ?? ''
  const groups = watchedGroups(board)
  const since = Math.floor(groups.reduce((min, g) => (g.since < min ? g.since : min), Number.POSITIVE_INFINITY) / 1000)
  if (root === '' || groups.length === 0 || !Number.isSafeInteger(since) || since <= 0) {
    outsideLog = null
    return
  }
  const head = await runGit($, root, ['rev-parse', 'HEAD'], 5000)
  const refs = await runGit($, root, ['for-each-ref', '--format=%(refname)%1f%(objectname)', 'refs/heads/'], 5000)
  if (head.exitCode !== 0 || !isSha(head.stdout) || refs.exitCode !== 0) {
    outsideLog = null
    return
  }
  const tips = new Map<string, string>()
  for (const line of refs.stdout.split('\n')) {
    const [name, sha] = line.split('\u001f')
    if (name?.startsWith('refs/heads/') && isSha(sha)) tips.set(name.slice('refs/heads/'.length), sha)
  }
  const mine = groups.flatMap(g => [...tips].filter(([name]) => g.isBranch(name)).map(([, tip]) => ({ key: watchedKey(g), tip })))
  const key = `${head.stdout}|${since}|${mine.map(m => `${m.key}@${m.tip}`).join(',')}`
  if (outsideLog?.key === key) return
  const log = await runGit($, root, ['-c', 'log.showSignature=false', 'log', '--first-parent', '--diff-merges=first-parent', '--no-renames', `--since=@${since}`, `--max-count=${OUTSIDE_MAX}`, '--format=%x1e%H%x1f%ct%x1f%P%x1f%s', '--name-only', head.stdout], 10_000)
  if (log.exitCode !== 0) {
    outsideLog = null
    return
  }
  const own = new Map<string, Set<string>>()
  for (const m of mine) {
    const list = await runGit($, root, ['rev-list', `--since=@${since}`, `--max-count=${OUTSIDE_MAX}`, m.tip], 10_000)
    // La branche d'un worker qui ne se relit pas : rien de compté pour son groupe plutôt que ses propres commits.
    if (list.exitCode !== 0) {
      outsideLog = null
      return
    }
    own.set(m.key, new Set([...(own.get(m.key) ?? []), ...list.stdout.split('\n').filter(isSha)]))
  }
  outsideLog = { key, commits: parseLoggedCommits(log.stdout), own }
}

/** Ce que la vue et le relevé disent des commits hors mission : rien sans relecture réussie. */
const cooOutsideOf = (board: Board): OutsideCommits[] => (outsideLog ? outsideCommitCounts(watchedGroups(board), outsideLog.commits, board, outsideLog.own) : [])

/**
 * Les groupes encore confiés de chaque mission non archivée dont le worker a laissé son compte rendu final au
 * relais, relus à l'instant (seules les missions qui ont un groupe confié se lisent) : le relevé du COO les dit
 * « reported », pas « working ». Un relais qui ne se lit pas n'en signale aucun. Gardé 5 secondes tant que les
 * envois en cours ne changent pas (un groupe rendu puis confié de nouveau se relit) : la vue se redessine souvent,
 * et chaque relecture parcourt le dossier du relais ; les missions se relisent en parallèle.
 */
const cooReportedOf = async ($: any, board: Board): Promise<(runId: string) => readonly string[]> => {
  const now = await $.clock.now()
  const runs = board.runs.filter(run => run.archivedAt === undefined && (run.groups ?? []).some(g => g.linked !== undefined))
  const key = JSON.stringify(runs.map(run => [run.id, (run.groups ?? []).filter(g => g.linked !== undefined).map(g => [g.id, g.linked!.at])]))
  if (reportedSeen && reportedSeen.key === key && now >= reportedSeen.at && now - reportedSeen.at < REPORTED_TTL_MS) return reportedSeen.of
  const found = new Map<string, string[]>()
  await Promise.all(
    runs.map(async run => {
      const stored = await readRelay($, run.id)
      const ids = relayedReports(run, isRelay(stored, run.id) ? stored : null).map(x => x.g.id)
      if (ids.length > 0) found.set(run.id, ids)
    }),
  )
  const of = (id: string): readonly string[] => found.get(id) ?? []
  reportedSeen = { at: now, key, of }
  return of
}

/** La dernière relecture des comptes rendus déposés au relais, pour le relevé et la vue du COO, avec les envois qu'elle a vus. */
let reportedSeen: { at: number; key: string; of: (runId: string) => readonly string[] } | null = null
const REPORTED_TTL_MS = 5_000

/** Ce que la carte montrait au clic « ▶ Livrer » : ses missions (et leur validation) et la branche relevée. */
const deliveryCardKey = (ready: readonly Run[]): string => `${ready.map(r => `${r.id}@${r.reportValidatedAt ?? 0}`).join(',')}|${deliveryPreview?.key ?? ''}`

/** La carte de livraison vue du COO. */
const cooDeliveryOf = async ($: any, board: Board): Promise<CooDelivery | undefined> => {
  const d = await readDelivery($, board.root ?? '')
  if (d === 'unread') return { state: 'unread', missions: [], commits: [], waitFor: [], waitCommits: [], isArmed: false }
  if (d && isDeliveryOpen(d)) {
    const failed = failedStep(d)
    const running = runningStep(d)
    const next = nextStep(d)
    return {
      state: failed ? 'failed' : running ? 'running' : 'paused',
      missions: d.missions.map(m => m.title),
      commits: [],
      waitFor: [],
      waitCommits: [],
      steps: d.steps.map(s => ({ label: DELIVERY_FR[s.key], status: s.status, ...(s.detail ? { detail: s.detail } : {}) })),
      ...(failed ? { step: DELIVERY_FR[failed.key] } : running ? { step: DELIVERY_FR[running.key] } : next ? { step: DELIVERY_FR[next.key] } : {}),
      isArmed: chainArmed === d.id,
    }
  }
  // Sans fichier de coordination lisible, on ne sait pas quelles missions ont déjà leur clôture : rien n'est proposé.
  if (coordNow?.state === 'unread') return undefined
  const ready = deliverables(board, d)
  if (ready.length === 0) return undefined
  return { state: 'ready', missions: ready.map(r => r.title), commits: deliveryPreview?.commits ?? [], waitFor: deliveryPreview?.waitFor ?? [], waitCommits: deliveryPreview?.waitCommits ?? [], ...(deliveryPreview && deliveryPreview.more > 0 ? { more: deliveryPreview.more } : {}), key: deliveryCardKey(ready), isArmed: false }
}

/**
 * Lance l'étape suivante de la livraison armée ici : siège relu, Claude au repos, la précédente réussie ;
 * l'étape notée lancée avant de partir. Rend le texte à dire, vide quand rien n'est à faire. Sous le verrou.
 */
const launchNextStep = async ($: any): Promise<string> => {
  const seat = await seatForWrite($)
  if (!seat.ok) return seat.why === 'unread' ? '◆ Rien ne part : le fichier des missions ne se lit pas ; reclique dans un instant.' : '◆ Rien ne part : cette discussion ne tient plus le siège du COO.'
  const root = seat.local.root ?? ''
  const d = await readDelivery($, root)
  if (d === 'unread') return '◆ Rien ne part : l’état de la livraison ne se lit pas.'
  if (!d || !isDeliveryOpen(d) || chainArmed !== d.id) return ''
  const step = nextStep(d)
  if (!step || isTurnOpen) return ''
  const now = await $.clock.now()
  const started = startStep(d, step.key, now)
  // L'étape notée lancée avant de partir : un rechargement ne la relance jamais d'elle-même.
  if (!started || !(await writeDelivery($, root, started))) return '◆ Rien ne part : l’état de la livraison ne s’écrit pas.'
  const command = DELIVERY_COMMAND[step.key]
  // Sans l'attendre : une commande ou un message mis en file attendent la fin d'un tour, et le verrou ne se garde pas jusque-là.
  if (command) void quietly(() => $.command.run({ command, args: commandArgsOf(null, command) }))
  else
    void quietly(() =>
      $.prompt.submit({
        text: `Livraison lancée chez le COO, dernière étape : fais les étapes que le CLAUDE.md de ce projet ajoute après une livraison (lis-le ; il dit lesquelles et ce qu'il réserve à l'utilisateur), l'une après l'autre, chacune seulement si la précédente a réussi, et laisse-moi ce que le projet me réserve en me le disant. Puis rends l'issue par l'outil flow : {"delivery": {"step": "project", "ok": true ou false, "detail": "<ce qui est fait, ou ce qui a échoué>"}} (ok true s'il n'y a rien à faire).`,
      }),
    )
  return `◆ Livraison : ${DELIVERY_FR[step.key]} lancé.`
}

/** « ▶ Livrer » : la livraison naît de ce clic seul, sur la carte que la personne a vue, une à la fois, et sa première étape part. */
const requestDelivery = ($: any, key: string): Promise<string> =>
  withDeliveryLock(async () => {
    const seat = await seatForWrite($)
    if (!seat.ok) return seat.why === 'unread' ? '◆ Rien ne part : le fichier des missions ne se lit pas ; reclique dans un instant.' : '◆ Rien ne part : cette discussion ne tient plus le siège du COO.'
    if (isTurnOpen) return '◆ Rien ne part : Claude travaille ; reclique à la fin de son tour.'
    const root = seat.local.root ?? ''
    const d = await readDelivery($, root)
    if (d === 'unread') return '◆ Rien ne part : l’état de la livraison ne se lit pas.'
    if (isDeliveryOpen(d)) return '◆ Une livraison est déjà en cours : une seule à la fois.'
    if (coordNow?.state === 'unread') return '◆ Rien ne part : le fichier de coordination ne se lit pas.'
    const ready = deliverables(seat.stored ?? seat.local, d)
    if (ready.length === 0) return '◆ Rien à livrer : aucun rapport validé.'
    // La carte a changé depuis l'affichage (une mission validée de plus, des commits arrivés) : rien ne part.
    if (deliveryCardKey(ready) !== key) return '◆ Rien ne part : ce qui partira a changé depuis l’affichage ; relis la carte, puis reclique.'
    const now = await $.clock.now()
    const sync = await read($, syncAtom)
    // Sans dépôt distant, rien à pousser.
    if (sync.hasRemote === false) return '◆ Rien ne part : ce projet n’a pas de dépôt distant.'
    // La pull request seulement sur GitHub mesuré, hors de la branche par défaut (sur elle, /project:pr refuse).
    const hasPr = sync.checkedAt !== null && sync.isGitHub === true && sync.isOnMain === false
    const fresh = newDelivery(newEntryId(now, Math.random()), ready.map(r => ({ id: r.id, title: r.title, validatedAt: r.reportValidatedAt ?? 0 })), hasPr, now)
    if (!(await writeDelivery($, root, fresh))) return '◆ Rien ne part : l’état de la livraison ne s’écrit pas.'
    chainArmed = fresh.id
    return launchNextStep($)
  })

/** Les trois gestes d'une livraison ouverte, chacun seulement dans l'état que son bouton montrait. */
type DeliveryGesture = 'retry' | 'resume' | 'check'

/**
 * « ↻ Réessayer » (une étape échouée : elle seule), « ▶ Reprendre » (après un rechargement : l'étape suivante),
 * « ↻ Demander l'issue » (une étape lancée sans issue revenue : Claude la vérifie, sans la refaire ni armer la suite).
 */
const deliveryGesture = ($: any, gesture: DeliveryGesture): Promise<string> =>
  withDeliveryLock(async () => {
    const seat = await seatForWrite($)
    if (!seat.ok) return '◆ Rien ne part : cette discussion ne tient plus le siège du COO, ou le fichier des missions ne se lit pas.'
    if (isTurnOpen) return '◆ Claude travaille : reclique à la fin de son tour.'
    const root = seat.local.root ?? ''
    const d = await readDelivery($, root)
    if (d === 'unread' || !d || !isDeliveryOpen(d)) return '◆ Aucune livraison en cours.'
    const failed = failedStep(d)
    const running = runningStep(d)
    if (gesture === 'check') {
      if (!running) return '◆ Rien n’est fait : l’étape a rendu son issue depuis ; relis la carte.'
      // Une vérification seulement : l'enchaînement se désarme, et l'étape suivante attend « ▶ Reprendre ».
      chainArmed = null
      void quietly(() =>
        $.prompt.submit({
          text: `L'étape ${DELIVERY_FR[running.key]} de la livraison lancée chez le COO n'a pas rendu son issue. Ne la refais pas : vérifie seulement si elle a réussi (git log, git status, la branche distante, la PR), puis rends-la par l'outil flow : {"delivery": {"step": "${running.key}", "ok": true ou false, "detail": "<ce que tu as constaté>"}}.`,
        }),
      )
      return `◆ Claude vérifie l’issue de ${DELIVERY_FR[running.key]}.`
    }
    if (gesture === 'retry' ? !failed : failed || running) return '◆ Rien ne part : la livraison a changé depuis l’affichage ; relis la carte.'
    const again = gesture === 'retry' ? retryStep(d) : d
    if (!again || !(await writeDelivery($, root, again))) return '◆ Rien ne part : l’état de la livraison ne s’écrit pas.'
    chainArmed = again.id
    return launchNextStep($)
  })

/** « ✕ Abandonner » une livraison arrêtée : elle se ferme, sans clore aucune mission. */
const dropDelivery = ($: any): Promise<string> =>
  withDeliveryLock(async () => {
    const seat = await seatForWrite($)
    if (!seat.ok) return '◆ Rien n’est fait : cette discussion ne tient plus le siège du COO, ou le fichier des missions ne se lit pas.'
    const root = seat.local.root ?? ''
    const d = await readDelivery($, root)
    const out = d && d !== 'unread' ? abandonDelivery(d, await $.clock.now()) : null
    if (!out || !(await writeDelivery($, root, out))) return '◆ Rien à abandonner.'
    chainArmed = null
    if (!isPushed(out)) return '◆ Livraison abandonnée : les missions restent à livrer.'
    // Le push a réussi : le code est parti, les missions se closent avec ce qui est fait, et ne se relivrent pas.
    const result = deliveredResultOf(out)
    for (const m of out.missions) await requestDeliveredClose($, m.id, result, m.validatedAt)
    const offered = await offerRetros($, out.missions.map(m => m.id))
    return `◆ Livraison arrêtée après le push : les missions sont closes avec ce qui est fait.${offered > 0 ? ` La rétro des missions livrées qui ne sont pas des rétros est proposée dans « Lancements », page « Missions ».` : ''}`
  })

/**
 * Le champ `delivery` de l'outil flow, dans la discussion du COO : l'issue de l'étape lancée. Faite, la suivante
 * part à la fin du tour si la livraison est armée ici ; la dernière faite, chaque mission livrée reçoit sa clôture.
 */
const deliveryCall = ($: any, raw: unknown): Promise<string> =>
  withDeliveryLock(async () => {
    const x = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    const key = x.step
    if (typeof key !== 'string' || !(DELIVERY_KEYS as readonly string[]).includes(key) || typeof x.ok !== 'boolean') return '"delivery" refused: it needs "step" (version, push, pr or project) and "ok" (true or false).'
    const seat = await seatForWrite($)
    if (!seat.ok) return '"delivery" refused: this discussion does not hold the COO seat.'
    const root = seat.local.root ?? ''
    const d = await readDelivery($, root)
    if (d === 'unread' || !d) return '"delivery" refused: no delivery is under way.'
    const now = await $.clock.now()
    const out = reportStep(d, key as DeliveryKey, x.ok, typeof x.detail === 'string' ? x.detail : '', now)
    if (!out) return `"delivery" refused: step ${key} is not the one under way${runningStep(d) ? ` (${runningStep(d)!.key})` : ''}.`
    if (!(await writeDelivery($, root, out))) return '"delivery" not recorded: the delivery state could not be written; send it again.'
    if (!x.ok) {
      chainArmed = null
      return `Delivery stopped at ${DELIVERY_FR[key as DeliveryKey]}: nothing after it runs. Tell the user which step failed and why; the delivery card offers « ↻ Réessayer » (this step only) or « ✕ Abandonner ».`
    }
    if (!isDelivered(out))
      return chainArmed === out.id
        ? `Step ${key} recorded as done; the dashboard runs the next one (${DELIVERY_FR[nextStep(out)!.key]}) at the end of this turn.`
        : `Step ${key} recorded as done; the next one (${DELIVERY_FR[nextStep(out)!.key]}) waits for the user's « ▶ Reprendre » on the delivery card.`
    chainArmed = null
    const result = deliveredResultOf(out)
    const notes: string[] = []
    for (const m of out.missions) notes.push(await requestDeliveredClose($, m.id, result, m.validatedAt))
    const offered = await offerRetros($, out.missions.map(m => m.id))
    return `Delivery done (${deliveredText(result)}). ${notes.join(' ')} Add a « Jalons » line to the roadmap with this result.${offered > 0 ? ` The Coordination view now offers the retro of each delivered mission that is not itself a retro (${offered} card(s) « Rétrospective · … »; a delivered retro gets none, only its « livrée » line and « ✓ Archiver »; recommended or not, launched by the user's click, which also archives the mission it studies, or « ✓ Archiver », which archives the mission without a retro): tell the user, never launch one yourself.` : ''}`
  })

/** Le résultat de chaque étape faite, pour la mission et le journal (« faite » quand Claude n'en a rien dit). */
const deliveredResultOf = (d: Delivery): DeliveredResult => {
  const of = (key: DeliveryKey) => {
    const s = d.steps.find(x => x.key === key && x.status === 'done')
    return s ? s.detail || 'faite' : undefined
  }
  const version = of('version')
  const push = of('push')
  const pr = of('pr')
  return { ...(version ? { version } : {}), ...(push ? { push } : {}), ...(pr ? { pr } : {}) }
}

/**
 * La clôture d'une mission livrée, sans archivage (invariant des missions livrées) :
 * ouverte dans une discussion, une entrée « close » avec le résultat, que son mod inscrit puis applique ; active
 * nulle part, le COO la clôt lui-même comme livrée (redevenue active sur le fichier relu : l'entrée).
 * Rien pour une mission archivée ou dont la clôture est déjà faite, ni pour une mission où du travail a été relancé
 * depuis le départ de la livraison (`isReportShipped` : `report`, la date du rapport emporté, va dans l'entrée).
 */
const requestDeliveredClose = async ($: any, id: string, result: DeliveredResult, report: number | undefined): Promise<string> => {
  const seat = await seatForWrite($)
  if (!seat.ok) return `Mission ${neutralQuoted(id)}: not closed (${seat.why === 'unread' ? 'missions file unread: the dashboard retries by itself at its next statements, until it holds' : 'seat lost'}).`
  const run = (seat.stored ?? seat.local).runs.find(r => r.id === id)
  if (!run || run.archivedAt !== undefined || isDeliveryOver(run)) return ''
  // Un travail relancé pendant la livraison (son rapport rouvert ou changé) n'est pas parti : rien ne le clôt.
  if (!isReportShipped(run, report)) return `Mission ${neutralQuoted(run.title)}: not closed, work was relaunched in it since the delivery started: a later delivery takes it.`
  let isFailed = false
  if (!isOpenRun(run)) {
    const out = await closeIdle($, id, result, report)
    if (out === 'stale') return `Mission ${neutralQuoted(run.title)}: not closed, work was relaunched in it since the delivery started: a later delivery takes it.`
    if (out === 'closed' || out === 'already') return `Mission ${neutralQuoted(run.title)} (open nowhere) closed as delivered by the dashboard, not archived.`
    if (out === 'absent') return `Mission ${neutralQuoted(run.title)} is no longer in the missions file: nothing closed.`
    // Ratée (écriture, siège) : l'entrée garde la clôture à faire, que le relevé reprend même une fois une autre
    // livraison partie (le rattrapage ne suit que la dernière).
    isFailed = out !== 'active'
  }
  const now = await $.clock.now()
  const entryId = newEntryId(now, Math.random())
  const written = await writeCoordination($, entries => (isDeliveryWaiting(entries, run) ? null : [...entries, { id: entryId, kind: CLOSE_KIND, run: id, at: now, delivered: result, ...(report !== undefined ? { report } : {}) }]))
  if (written === 'none') return `Mission ${neutralQuoted(run.title)}: its close is already requested; the dashboard applies it, or retries by itself, until it holds.`
  if (isFailed) return `Mission ${neutralQuoted(run.title)} could not be closed just now: the dashboard retries by itself at its next statements, until it holds${written === 'ok' ? ' (its close entry is written)' : ''}.`
  if (written !== 'ok') return `Mission ${neutralQuoted(run.title)}: close not written (${coordWriteWhy(written)}); the dashboard retries by itself at its next statements, until it holds.`
  return `Mission ${neutralQuoted(run.title)}: close requested with the result. ${await wakeManager($, id)}`
}

/** Le dernier refus dit par l'enchaînement : un refus qui dure ne se redit pas à chaque relecture. */
let lastChainToast = ''

/** À la relecture du COO : la livraison armée ici lance son étape suivante, une fois la précédente faite ; chaque départ se dit, un refus une fois. */
const continueDelivery = async ($: any) => {
  if (chainArmed === null) return
  const toast = await withDeliveryLock(() => launchNextStep($))
  if (toast === '' || (!toast.startsWith('◆ Livraison :') && toast === lastChainToast)) return
  lastChainToast = toast
  await quietly(() => $.ui.toast(toast))
}

// ─── Décisions opposées entre missions ────────────────────────────────────
//
// Le COO relève, par le code, les décisions nouvelles de chaque mission non archivée depuis son relevé précédent
// (les séries de son `DECISIONS.md`, ses choix « décidé sans toi ») ; son Claude juge si deux s'opposent et
// l'écrit : une entrée « contradiction », que le mod de la mission qui a décidé en second applique en posant une
// question bloquante sur sa phase en cours, ou une entrée « compatible », une ligne chez le COO. Invariant :
// « Deux décisions opposées de deux missions ne passent jamais sans question à l'utilisateur ; une décision
// n'est marquée "remplacée" que sur sa réponse. »

/** Ce que le COO a déjà relevé des décisions des missions, gardé par son poste (`$.store`). */
const decisionsSeenKey = (root: string): string => `coo-decisions-seen:${normRoot(root)}`

/** Le dernier relevé : les décisions montrées et les séries lues par mission, que « decisionsSeen » marque vues. */
let decisionsNow: { items: NewDecision[]; more: number; unread: boolean; earlier: CooDecisions['earlier'] } = { items: [], more: 0, unread: false, earlier: [] }

/** Les décisions que le dernier relevé donné à Claude a montrées : « decisionsSeen » ne marque vu que celles-là. */
let decisionsShown: NewDecision[] = []

/** Une opposition ou un sujet compatible n'a pas été écrit depuis le dernier relevé : « decisionsSeen » attend qu'il le soit. */
const decisionsFailed = new Set<string>()

/** Le début de la réponse quand une opposition n'a rien à demander (missions parties ou closes) : traitée, pas en échec. */
const NOTHING_TO_ASK = 'Nothing to ask:'

/** Relit ce qui est vu : `unread` quand le stockage ou sa forme ne se lit pas (tout se relève alors). */
const readDecisionsSeen = async ($: any, root: string): Promise<DecisionsSeen | 'unread'> => {
  try {
    return parseSeen(await $.store.get(decisionsSeenKey(root))) ?? 'unread'
  } catch {
    return 'unread'
  }
}

/** Le `DECISIONS.md` d'une mission née d'une carte : son dossier de lancement. */
const missionDecisionsPath = (run: Run): string | null => {
  const launch = liveLaunchOf(run)
  return launch ? `travail/${launch.folder}/DECISIONS.md` : null
}

/** Le COO relève les décisions nouvelles des missions non archivées : séries jamais vues, choix déclarés plus récents. */
const watchDecisions = async ($: any, board: Board) => {
  const root = (board.root ?? '').replace(/[\\/]+$/, '')
  const seen = await readDecisionsSeen($, root)
  const items: NewDecision[] = []
  const earlier: CooDecisions['earlier'] = []
  for (const run of board.runs) {
    if (run.archivedAt !== undefined || !isSafeId(run.id)) continue
    const file = missionDecisionsPath(run)
    let text = ''
    if (file && isDecisionsPath(file))
      await quietly(async () => {
        const path = root === '' ? file : `${root}/${file}`
        if ((await $.fs.exists(path)) === true) text = String(await $.fs.read(path))
      })
    const found = seriesOf(text)
    const fresh = newDecisionsOf(run, file, found, seen === 'unread' ? undefined : seen[run.id])
    items.push(...fresh)
    // Ce que Claude compare aux nouvelles : le DECISIONS.md de chaque mission et ses choix déjà vus (le relevé ne les redonne pas).
    const all = (Array.isArray(run.decided) ? run.decided : []).filter(d => typeof d?.what === 'string' && !fresh.some(f => f.at === d.at && f.text === d.what))
    const old = all.slice(-EARLIER_MAX)
    const choices = all.length > old.length || old.some(d => d.what.length > EARLIER_TEXT_MAX) ? decidedPath($, run.id) : null
    if ((file && found.length > 0) || old.length > 0) earlier.push({ mission: run.id, title: run.title, ...(file && found.length > 0 ? { file } : {}), decided: old.map(d => clip(d.what, EARLIER_TEXT_MAX)), ...(choices ? { choices } : {}) })
  }
  decisionsNow = { items: items.slice(0, NEW_MAX), more: Math.max(0, items.length - NEW_MAX), unread: seen === 'unread', earlier }
}

/** Les choix déclarés d'une mission donnés à comparer, au plus, et la longueur de chacun (au-delà, le fichier des choix les porte tous). */
const EARLIER_MAX = 60
const EARLIER_TEXT_MAX = 400

/** Les décisions et leurs oppositions vues du COO. */
const cooDecisionsOf = (board: Board, isStatement = false): CooDecisions => {
  const title = (id: string) => board.runs.find(r => r.id === id)?.title ?? id
  const contradictions = coordLive
    .filter((e): e is CoordContradiction => e.kind === 'contradiction')
    .flatMap(e => {
      const run = board.runs.find(r => r.id === e.run)
      // Close ou archivée : la question est passée à l'autre mission (`carryContradictions`), ou ne bloque plus rien.
      if (!run || run.archivedAt !== undefined || run.status === 'done' || isContradictionAnswered(run, e.id)) return []
      const other = board.runs.find(r => r.id === e.other)
      // L'empreinte de la question ouverte : la réponse écrite (`coordinate.answer`) la cite, mission en auto ou non.
      const q = openQuestions(run).find(x => x.id === contradictionQuestionId(e.id))
      return [{ question: contradictionQuestionId(e.id), mission: run.title, missionId: run.id, other: title(e.other), subject: e.subject, isOtherArchived: other?.archivedAt !== undefined, isOpen: q !== undefined, ...(q ? { print: questionPrint(q) } : {}), ...(missionDecisionsPath(run) ? { file: missionDecisionsPath(run)! } : {}), ...(other && missionDecisionsPath(other) ? { otherFile: missionDecisionsPath(other)! } : {}) }]
    })
  const isLive = (id: string) => board.runs.some(r => r.id === id && r.archivedAt === undefined)
  const compatibles = coordLive.filter((e): e is CoordCompatible => e.kind === 'compatible' && isLive(e.run) && isLive(e.other)).map(e => ({ a: title(e.run), b: title(e.other), subject: e.subject }))
  // Donné à Claude : ce relevé devient celui que « decisionsSeen » marquera vu.
  if (isStatement) {
    decisionsShown = decisionsNow.items
    decisionsFailed.clear()
  }
  const shown = decisionsNow.items.map(d => ({ mission: d.mission, title: d.title, ref: d.ref, text: d.text }))
  return { items: shown, more: decisionsNow.more, ...(decisionsNow.unread ? { unread: true } : {}), earlier: decisionsNow.earlier, contradictions, compatibles }
}

/** La question d'une opposition a été répondue (retirée, sa trace gardée), dans la mission qui la portait. */
const isContradictionAnswered = (run: Run, entryId: string): boolean =>
  !openQuestions(run).some(q => q.id === contradictionQuestionId(entryId)) && (Array.isArray(run.answered) ? (run.answered as unknown[]) : []).some(t => t !== null && typeof t === 'object' && (t as { id?: unknown }).id === contradictionQuestionId(entryId))

/**
 * Le COO : une opposition dont la mission qui portait la question a été close (une livraison ne l'archive plus) ou archivée avant la réponse passe à
 * l'autre mission, encore ouverte : la question y est posée à son tour (une entrée inverse, une fois).
 */
const carryContradictions = async ($: any, board: Board) => {
  for (const e of coordLive) {
    if (e.kind !== 'contradiction') continue
    const run = board.runs.find(r => r.id === e.run)
    const other = board.runs.find(r => r.id === e.other)
    if (!run || (run.archivedAt === undefined && run.status !== 'done') || !other || other.archivedAt !== undefined || other.status === 'done' || isContradictionAnswered(run, e.id)) continue
    if (coordLive.some(x => x.kind === 'contradiction' && x.run === e.other && x.other === e.run && sameSide(x.mine, e.theirs) && sameSide(x.theirs, e.mine))) continue
    const now = await $.clock.now()
    const id = newEntryId(now, Math.random())
    await writeCoordination($, entries =>
      liveEntries(entries, () => false).some(x => x.kind === 'contradiction' && x.run === e.other && x.other === e.run && sameSide(x.mine, e.theirs) && sameSide(x.theirs, e.mine))
        ? null
        : [...entries, { id, kind: 'contradiction', run: e.other, at: now, other: e.run, mine: e.theirs, theirs: e.mine, subject: e.subject }],
    )
  }
}

/** Deux citations d'une même décision : même source et même texte. */
const sameSide = (a: { ref: string; text: string }, b: { ref: string; text: string }): boolean => a.ref === b.ref && a.text === b.text

/** Une décision citée par le Claude du COO : sa mission, sa source et son texte mot pour mot. */
const opposedSide = (v: unknown): { mission: string; ref: string; text: string } | null => {
  const x = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  return isSafeId(x.mission) && isOneLine(x.ref, 200) && isOneLine(x.text, 600) ? { mission: x.mission, ref: x.ref, text: x.text } : null
}

/**
 * `coordinate.contradiction` : deux décisions opposées (ou un doute) ; la mission qui a décidé en second pose
 * la question. Les deux missions existent, non archivées ; une même opposition ne s'écrit pas deux fois.
 */
const recordContradiction = async ($: any, one: unknown): Promise<string> => {
  const x = one !== null && typeof one === 'object' && !Array.isArray(one) ? (one as Record<string, unknown>) : {}
  const first = opposedSide(x.first)
  const second = opposedSide(x.second)
  if (!first || !second || first.mission === second.mission || !isOneLine(x.subject, 200))
    return 'A "contradiction" was refused: it needs "first" and "second" ({"mission": "<id>", "ref": "<source, one line>", "text": "<the decision word for word, one line>"}, two different missions) and "subject" (one line).'
  const subject = x.subject
  const local: Board | null = await read($, boardAtom)
  const now = await $.clock.now()
  const id = newEntryId(now, Math.random())
  let why: 'unknown' | 'already' | 'closed' | null = null
  let title = ''
  let isSwapped = false
  const written = await writeCoordination($, (entries, stored) => {
    const runs = (stored ?? local)?.runs ?? []
    const a = runs.find(r => r.id === first.mission)
    const b = runs.find(r => r.id === second.mission)
    why = !a || !b ? 'unknown' : null
    if (!a || !b) return null
    // La question va à la mission qui a décidé en second ; close ou archivée, elle va à l'autre, encore en cours :
    // jamais à une mission où elle ne bloque rien. Une décision d'une mission archivée vaut toujours.
    const isWorking = (r: Run) => r.archivedAt === undefined && r.status !== 'done'
    if (!isWorking(a) && !isWorking(b)) {
      why = 'closed'
      return null
    }
    isSwapped = !isWorking(b)
    const [asker, theirs, mine] = isSwapped ? [a, second, first] : [b, first, second]
    title = asker.title
    if (why === null && liveEntries(entries, () => false).some(e => e.kind === 'contradiction' && ((e.run === asker.id && sameSide(e.mine, mine) && sameSide(e.theirs, theirs)) || (e.other === asker.id && sameSide(e.mine, theirs) && sameSide(e.theirs, mine))))) why = 'already'
    return why === null ? [...entries, { id, kind: 'contradiction', run: asker.id, at: now, other: asker.id === b.id ? a.id : b.id, mine: { ref: mine.ref, text: mine.text }, theirs: { ref: theirs.ref, text: theirs.text }, subject }] : null
  })
  if (why === 'unknown') return 'Not recorded: one of the two missions is not in the missions file (check its id in your statement).'
  if (why === 'closed') return `${NOTHING_TO_ASK} both missions are closed or archived; tell the user both decisions word for word, who decides whether one of them reopens.`
  if (why === 'already') return 'Already recorded: its question is posed (or will be, once that mission is open).'
  if (written !== 'ok') return `Not recorded: ${coordWriteWhy(written)}`
  return `Opposition recorded: mission ${neutralQuoted(title)} ${isSwapped ? '(the one that decided second is closed or archived, so this one)' : '(decided second)'} gets the blocking question on its current phase. Show the user both decisions word for word with their source; their answer goes in both DECISIONS.md.`
}

/** `coordinate.compatible` : deux missions qui décident sur un même sujet, compatibles ; une ligne chez le COO. */
const recordCompatible = async ($: any, one: unknown): Promise<string> => {
  const x = one !== null && typeof one === 'object' && !Array.isArray(one) ? (one as Record<string, unknown>) : {}
  const ids = Array.isArray(x.missions) ? x.missions : []
  const a = ids[0]
  const b = ids[1]
  if (ids.length !== 2 || !isSafeId(a) || !isSafeId(b) || a === b || !isOneLine(x.subject, 200)) return 'A "compatible" was refused: it needs "missions" (two different mission ids) and "subject" (one line).'
  const subject = x.subject
  const local: Board | null = await read($, boardAtom)
  const now = await $.clock.now()
  const id = newEntryId(now, Math.random())
  let why: 'unknown' | 'gone' | 'already' | null = null
  const written = await writeCoordination($, (entries, stored) => {
    const runs = (stored ?? local)?.runs ?? []
    why = !runs.some(r => r.id === a) || !runs.some(r => r.id === b) ? 'unknown' : !runs.some(r => r.id === a && r.archivedAt === undefined) || !runs.some(r => r.id === b && r.archivedAt === undefined) ? 'gone' : null
    if (why === null && liveEntries(entries, () => false).some(e => e.kind === 'compatible' && ((e.run === a && e.other === b) || (e.run === b && e.other === a)) && e.subject === subject)) why = 'already'
    return why === null ? [...entries, { id, kind: 'compatible', run: a, at: now, other: b, subject }] : null
  })
  if (why === 'unknown') return 'Not recorded: one of the two missions is not in the missions file (check its id in your statement).'
  if (why === 'gone') return `${NOTHING_TO_ASK} one of the two missions is archived.`
  if (why === 'already') return 'Already noted.'
  if (written !== 'ok') return `Not recorded: ${coordWriteWhy(written)}`
  return 'Noted as compatible: a line in the Coordination view says so.'
}

/** `coordinate.decisionsSeen` : le dernier relevé est jugé ; ses décisions ne reviennent plus. */
const markReviewedDecisions = async ($: any): Promise<string> => {
  const board: Board | null = await read($, boardAtom)
  const root = (board?.root ?? '').replace(/[\\/]+$/, '')
  const seen = await readDecisionsSeen($, root)
  const next = markSeen(seen === 'unread' ? {} : seen, decisionsShown)
  try {
    await $.store.set(decisionsSeenKey(root), next)
  } catch {
    return 'Not recorded: the record of reviewed decisions could not be written; send it again.'
  }
  const count = decisionsShown.length
  decisionsShown = []
  return `Reviewed: ${count} decision(s) marked as seen.`
}

/**
 * Le manager : chaque opposition relevée par le COO dont sa mission a décidé en second devient, une fois, une
 * question bloquante sur sa phase en cours, au texte composé ici (titres et textes neutralisés).
 */
const applyContradictions = async ($: any, runId: string, entries: readonly CoordEntry[], applied: ReadonlySet<string>) => {
  // Une réponse relayée (notée appliquée) dont le retrait a raté : la question encore ouverte, au même texte, se retire ici ;
  // jamais pendant un relais (sa marque posée avant l'envoi se retire si le message n'entre pas).
  for (const e of isApplyingRelay ? [] : entries) {
    if (e.kind !== 'answer' || e.run !== runId || !applied.has(e.id) || !e.question.startsWith(OPPOSITION_PREFIX)) continue
    const run = activeRun(await read($, boardAtom))
    const q = run?.id === runId ? openQuestions(run).find(x => x.id === e.question) : undefined
    if (!q || questionPrint(q) !== e.print) continue
    const now = await $.clock.now()
    if (await commit($, b => withdrawOpposition(b, runId, e.question, now))) await saveNow($)
  }
  for (const e of entries) {
    if (e.kind !== 'contradiction' || e.run !== runId || applied.has(e.id)) continue
    const board: Board | null = await read($, boardAtom)
    const other = board?.runs.find(r => r.id === e.other)
    const text = contradictionQuestion({ mission: e.run, ...e.mine }, { mission: e.other, title: other?.title ?? 'une autre mission', ...e.theirs }, e.subject)
    const now = await $.clock.now()
    const fx = await commit($, b => poseContradiction(b, runId, contradictionQuestionId(e.id), text, now))
    const after = activeRun(await read($, boardAtom))
    const isPosed = after?.id === runId && (openQuestions(after).some(q => q.id === contradictionQuestionId(e.id)) || (after.answered ?? []).some((t: { id?: unknown }) => t?.id === contradictionQuestionId(e.id)))
    // Notée appliquée seulement une fois la question posée (ou déjà posée) : une écriture ratée se réessaie.
    if (fx || isPosed) {
      await noteApplied($, runId, e.id)
      await saveNow($)
    }
  }
}

const coordWriteWhy = (w: CoordWrite): string =>
  w === 'board-unread'
    ? SEAT_UNREAD
    : w === 'not-seat'
      ? 'this discussion does not hold the COO seat.'
      : w === 'unread'
        ? `${COORD_UNREAD} A copy of it is kept; show the user what it holds, and tell them « Repartir d'un fichier neuf » in the Coordination view starts a new one.`
        : w === 'full'
          ? 'the coordination file is full.'
          : w === 'refused'
            ? 'the write would have lost another entry.'
            : w === 'failed'
              ? 'the file could not be written.'
              : 'nothing changed.'

// ─── Cartes de lancement du COO ───────────────────────────────────────────
//
// Le Claude du COO propose une carte (champ `card`) ; la personne clique ; le mod écrit l'enregistrement
// de lancement dans son stockage (`$.store`, `coo-launch:<id>`) et met dans le prompt du COO le texte qui
// fait lancer la nouvelle discussion ; celle-ci le consomme à son premier appel de l'outil (`launch`).
// Invariant : « Une carte ne lance qu'une mission ; un enregistrement de lancement n'est consommé qu'une
// fois, par une seule discussion, dans les 10 minutes. » (sa garde : `hooks/launch.ts`).

// Les cartes vivent dans la liste des cartes du projet : sa lecture et sa seule écriture sont dans `hooks/cards-store.ts`.

// ─── La rétro d'une mission livrée ────────────────────────────────────────
//
// À la livraison, le mod du COO pose la carte de rétro de chaque mission livrée ; la rétro lancée garde l'id
// de la mission close et lit ses transcripts ; ses pistes se cochent chez le COO, et la sélection va à son mod
// par une entrée « pick », qui met d'abord les non cochées dans « À reprendre » (celles d'une rétro qui relit la
// liste d'attente et qui y sont, « pas encore validée », y restent), puis fait découper les cochées.
// Invariant : « Une piste de la rétro n'est découpée que si l'utilisateur l'a cochée ; une piste non cochée
// part dans À reprendre, jamais nulle part. » Depuis la liste d'attente (R11 de coo-autonome) : ou reste dans
// la liste, « pas encore validée », relue là ; jamais nulle part.

/** Les pistes cochées chez le COO, par rétro (en mémoire : un rechargement les décoche, rien ne part sans clic). */
const retroTicks = new Map<string, Set<string>>()

// ─── Les pistes en attente : découpage et carte « Pistes de rétro » ───────
//
// Au clic « ✂ Découper la sélection » de la section « Pistes en attente », le mod du COO pose d'abord la carte
// « Pistes de rétro » (ici, sans rien de plus que ses champs connus, R39), puis passe les pistes cochées encore
// « pas encore validée » (et au texte inchangé) à « validée » avec l'id de la carte, dans l'écriture de la liste,
// sous ses gardes ; une carte qu'aucune piste ne porte, relue, repart aussitôt. La mission lancée par la carte
// relit ses pistes dans la liste. La carte retirée rend ses pistes encore « validée » à « pas encore validée »,
// seulement si aucune mission ni aucun lancement ne la porte, toutes les lectures réussies.
// Invariant de la liste d'attente : « Une écriture d'une rétro ou du COO n'efface ni ne change jamais en silence la piste d'une
// autre ; une piste ne quitte jamais le fichier, et une piste en exécution ne change plus. »

/**
 * Les pistes « pas encore validée » cochées dans « Pistes en attente », avec leur nombre de textes précédents au moment
 * de la coche (en mémoire : un rechargement les décoche ; un texte changé depuis ne compte plus coché).
 */
const pistesTicks = new Map<string, number>()
/** Un découpage de pistes en cours : un second clic ne fait rien. */
let isCuttingPistes = false

/** Les pistes refusées d'un découpage, chacune avec sa raison, pour un toast. */
const refusedText = (refused: readonly { id: string; why: string }[]): string => refused.map(r => `${neutralLine(r.id)} (${neutralLine(r.why)})`).join(', ')

/** Les pistes de la liste relue à l'instant qui portent la carte `card` encore « validée » ; null quand la liste ne se lit pas. */
const validatedOfCard = async ($: any, root: string, card: string): Promise<Piste[] | null> => {
  const got = await readWaitlist($, root)
  if (got.state === 'unread') return null
  return got.state === 'read' ? pistesOf(got.list).filter(p => p.card === card && p.state === 'validated') : []
}

/**
 * « ✂ Découper la sélection » : les pistes cochées, telles que la vue les montrait (`print`), passent « validée »
 * avec la carte « Pistes de rétro » posée par le mod ; une piste changée d'état ou de texte depuis est refusée, décochée,
 * et le toast le dit. La carte pas écrite dans la liste des cartes : rien n'est découpé. Aucune piste validée sur la
 * liste relue (siège perdu, écriture abandonnée, toutes refusées) : la carte repart (si elle ne le peut pas, le toast
 * dit de la retirer) ; une relecture ratée la garde (l'écriture a peut-être eu lieu) et décoche toute la sélection.
 */
const cutPistes = async ($: any, print: string): Promise<string> => {
  if (isCuttingPistes) return '◆ Découpage en cours : rien de plus.'
  isCuttingPistes = true
  try {
    const seat = await seatForWrite($)
    if (!seat.ok) return '◆ Rien n’est découpé : ce COO ne tient plus le siège, ou le fichier des missions ne se lit pas.'
    const shown = pistesWaitingOf(cooWaitlistOf()?.pistes ?? [], seat.local.runs, await cardsHere($), pistesTicks)
    if (shown.print !== print) return '◆ Rien n’est découpé : les pistes ont changé depuis ton affichage ; relis-les, puis reclique.'
    const picks: PistePick[] = shown.rows.filter(r => r.isTicked).map(r => ({ id: r.id, texts: r.texts }))
    if (picks.length === 0) return '◆ Rien n’est découpé : coche d’abord des pistes « pas encore validée ».'
    const now = await $.clock.now()
    const card = pistesCard(newCardId(now), now)
    // La carte d'abord : une carte sans piste ne perd rien et repart ; des pistes sans carte resteraient « validée ».
    // Tenue pendant le découpage : ni « Lancer » ni « ✕ Retirer » ne s'y entrelacent.
    launchingNow.add(card.id)
    try {
    // La carte pas écrite (siège, liste illisible ou changée, écriture ratée) : aucune piste ne passe « validée ».
    const posted = await writeCards($, { kind: 'add', cards: [card] })
    if (posted.state !== 'ok') return `◆ Rien n’est découpé : ${cardWriteWhy(posted.state)}.`
    let refused: { id: string; why: string }[] = []
    await applyWaitlist($, (list, at) => {
      const out = validatePistes(list, picks, card.id, at)
      refused = out.refused
      return out.list
    })
    const held = await validatedOfCard($, seat.local.root, card.id)
    // Une piste refusée quitte la sélection : elle ne repart pas au clic suivant avec un texte que tu n'as pas revu.
    for (const r of refused) pistesTicks.delete(r.id)
    // Relue ratée : l'écriture a peut-être eu lieu ; la carte reste (une carte sans piste ne perd rien, des pistes sans carte si).
    if (held === null) {
      for (const p of picks) pistesTicks.delete(p.id)
      return `◆ La liste d’attente ne se relit pas : la carte « ${neutralLine(card.title)} » reste dans « Lancements », page « Missions » ; si aucune piste ne la porte, retire-la.`
    }
    if (held.length === 0) {
      const gone = await writeCards($, { kind: 'remove', which: c => c.id === card.id })
      const accepted = picks.length - refused.length
      const said = `${refused.length > 0 ? ` Refusées : ${refusedText(refused)}.` : ''}${accepted > 0 ? ' La liste n’a pas pu s’écrire (siège, lecture ou écriture) ; reclique dans un instant.' : ''}`
      // La carte n'a pas pu repartir : elle reste, sans piste (elle ne se lance pas), et se retire d'un clic.
      const stays = gone.state === 'ok' || gone.state === 'none' ? '' : ` La carte « ${neutralLine(card.title)} » reste dans « Lancements » (${cardWriteWhy(gone.state)}) : aucune piste ne la porte, retire-la.`
      return '◆ Rien n’est découpé.' + said + stays
    }
    for (const p of held) pistesTicks.delete(p.id)
    const shownRefused = refused.filter(r => !held.some(p => p.id === r.id))
    return `✂ ${held.length} piste(s) validée(s), portée(s) par la carte « ${neutralLine(card.title)} » dans « Lancements », page « Missions » : lance-la d’un clic.${shownRefused.length > 0 ? ` Retirées de la sélection : ${refusedText(shownRefused)}.` : ''}`
    } finally {
      launchingNow.delete(card.id)
    }
  } finally {
    isCuttingPistes = false
  }
}

/**
 * « ✕ Retirer » sur une carte « Pistes de rétro » prête : ses pistes encore « validée » redeviennent « pas encore
 * validée », puis la carte part. Seulement si, relus à l'instant, aucune mission (fichier des missions compris,
 * archivées comprises) ne porte la carte ou son dossier et aucun lancement gardé encore valable (pas périmé) ne la
 * nomme, toutes les lectures réussies ; sinon rien ne change. La carte qui ne part pas ensuite (liste des cartes pas
 * écrite) reste prête, sans piste : elle ne se lance pas, et le clic suivant la retire. Appelée seulement par `cooDo`,
 * qui vérifie que Claude est au repos, puis le siège du COO.
 */
const removePistesCard = async ($: any, id: string): Promise<string> => {
  if (launchingNow.has(id)) return '◆ Rien n’est retiré : la carte est en train de partir ; relis-la.'
  launchingNow.add(id)
  try {
    const seat = await seatForWrite($)
    if (!seat.ok) return '◆ Rien n’est retiré : ce COO ne tient plus le siège, ou le fichier des missions ne se lit pas.'
    const now = await $.clock.now()
    const runs = [...seat.local.runs, ...(seat.stored?.runs ?? [])]
    const card = (await cardsHere($)).find(c => c.id === id)
    if (!card || !isPistesCard(card) || cardStateOf(card, runs, now).kind !== 'ready' || runOfCard(runs, card.id, card.folder)) return '◆ Rien n’est retiré : la carte est lancée ou en lancement ; relis-la.'
    const live = await launchRecords($)
    if (live.unread > 0) return '◆ Rien n’est retiré : un lancement gardé ne se lit pas ; réessaie.'
    if (isCardInLaunch(live.records, id, card.folder, now)) return '◆ Rien n’est retiré : un lancement de cette carte est en cours.'
    await applyWaitlist($, (list, at) => releaseCardPistes(list, id, at).list)
    const left = await validatedOfCard($, seat.local.root, id)
    if (left === null || left.length > 0) return '◆ Rien n’est retiré : ses pistes n’ont pas pu redevenir « pas encore validée » (liste illisible ou pas écrite) ; reclique dans un instant.'
    // Les pistes rendues d'abord ; la carte qui ne part pas reste prête, sans piste (elle ne se lance pas), et se retire au clic suivant.
    const out = await writeCards($, { kind: 'remove', which: c => c.id === id })
    if (out.state !== 'ok' && out.state !== 'none') return `◆ Ses pistes sont de nouveau « pas encore validée », mais la carte « ${neutralLine(card.title)} » reste (${cardWriteWhy(out.state)}) : reclique « ✕ Retirer ».`
    return `◆ Carte « ${neutralLine(card.title)} » retirée : ses pistes encore « validée » sont de nouveau « pas encore validée », à cocher.`
  } finally {
    launchingNow.delete(id)
  }
}

/** Les mouvements à dire au prochain relevé du COO (pistes rendues, faites, changées de carte), gardés jusqu'à ce qu'il les lise. */
const pistesFinishedKey = (root: string): string => `coo-pistes-rendues:${normRoot(root)}`
/** Ce que le relevé laisse et pourquoi, recalculé à chaque passage du siège qui relit tout. */
let pistesLeftNow: string[] = []
let isFinishingPistes = false
/** Les lectures et écritures des lignes gardées, une à la fois : jamais une ligne perdue ni dite deux fois. */
let pistesFinishedChain: Promise<unknown> = Promise.resolve()
const onFinishedLines = <T,>(f: () => Promise<T>): Promise<T> => {
  const next = pistesFinishedChain.then(f, f)
  pistesFinishedChain = next.catch(() => undefined)
  return next
}
/** Les lignes que le stockage n'a pas pu garder (lecture ou écriture ratée) : gardées ici jusqu'au relevé. */
let pistesFinishedMem: string[] = []
/** Les lignes gardées, relues dans la file ; une lecture ratée rend null (jamais prise pour une liste vide). */
const finishedLinesNow = async ($: any, root: string): Promise<string[] | null> => {
  try {
    const raw = await $.store.get(pistesFinishedKey(root))
    return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string') : []
  } catch {
    return null
  }
}
/** Les lignes gardées pour le relevé, les plus anciennes d'abord (20 par relevé, les autres au suivant). */
const peekFinishedLines = (root: string, $: any): Promise<string[]> => onFinishedLines(async () => [...((await finishedLinesNow($, root)) ?? []), ...pistesFinishedMem].slice(0, 20))
/** Retire les lignes dites (celles-là seulement : une ligne ajoutée entre-temps reste pour le relevé suivant). */
const dropFinishedLines = (root: string, $: any, said: readonly string[]): Promise<unknown> =>
  said.length === 0
    ? Promise.resolve()
    : onFinishedLines(async () => {
        pistesFinishedMem = pistesFinishedMem.filter(l => !said.includes(l))
        const kept = await finishedLinesNow($, root)
        if (kept !== null) await quietly(() => $.store.set(pistesFinishedKey(root), kept.filter(l => !said.includes(l))))
      })
/** Ajoute des lignes ; une lecture ou une écriture ratée les garde en mémoire, jamais par-dessus les lignes d'avant. */
const addFinishedLines = (root: string, $: any, lines: readonly string[]): Promise<unknown> =>
  onFinishedLines(async () => {
    const kept = await finishedLinesNow($, root)
    let isSaved = false
    if (kept !== null)
      await quietly(async () => {
        await $.store.set(pistesFinishedKey(root), [...kept, ...lines].slice(-200))
        isSaved = true
      })
    if (!isSaved) pistesFinishedMem = [...pistesFinishedMem, ...lines]
  })

/**
 * Au relevé du siège (tick), les pistes des missions « Pistes de rétro » finies (`hooks/pistes-fin.ts`) : les
 * missions candidates (`pistesFinishCandidates`), leur fin lue d'abord sans les traces (seule une mission finie ou
 * absente des deux copies demande les autres lectures), puis les traces, les lancements gardés et les fichiers de
 * tickets de chaque mission finie, lus en dernier ; le plan (`planPistesFinish`) ; la carte de chaque plan posée
 * d'abord dans « Lancements » ; puis, dans la même écriture que les boîtes, appliquées d'abord, les plans revérifiés
 * (`applyPistesFinish`, et `finishPlanHolds` sur le fichier relu juste avant l'écriture). Le relevé dit une fois ce qui a
 * changé, et à chaque relevé ce qui reste et pourquoi. Une carte posée qu'aucune piste ne porte après l'écriture repart ;
 * son retrait pas écrit, ou la liste d'attente pas relue, elle reste, et le relevé dit de la retirer.
 * De même, une nouvelle carte pour des pistes « validée » dont la carte a disparu (`orphanCardPlans`).
 */
const finishPistesMissions = async ($: any): Promise<void> => {
  if (isFinishingPistes) return
  const now0 = waitlistNow
  const before = now0?.state === 'read' && now0.list ? now0.list : undefined
  // Une liste qui ne se lit pas, ou le siège perdu : ce qui restait ne se dit plus (il se redira au relevé qui relit tout).
  if (!before || !now0) return void (pistesLeftNow = [])
  isFinishingPistes = true
  try {
    const pistes = pistesOf(before)
    const seat = await seatForWrite($)
    // L'ancien état des cartes pas encore copié : aucune carte posée, ni de plan, ni de remplacement (D2).
    if (!seat.ok || !(await isOldCopied($))) return void (pistesLeftNow = [])
    const root = seat.local.root
    const copies = [seat.local.runs, seat.stored?.runs ?? []]
    const runs = copies.flat()
    const candidates = pistesFinishCandidates(pistes, runs)
    const isWhole = now0.isWhole === true && now0.pendingBy !== undefined
    // La liste des cartes ne se lit pas : une carte dite disparue y est peut-être ; aucune carte posée, aucune piste déplacée.
    const cardsRead = await readCardsAt($, root)
    if (cardsRead.state === 'unread') return void (pistesLeftNow = [])
    const orphanCtx = { pistes, cards: orphanCardsOf(cardsRead), runs, where: waitlistWhereNow?.where, isWhole, isSeatOld: (await $.clock.now()) - (mergeSeat(seat.local.coo, seat.stored?.coo)?.at ?? Infinity) > LAUNCH_TTL_MS + LAUNCH_GRACE_MS + CLOCK_SKEW_MS }
    const due = orphanCardPlans({ ...orphanCtx, isTaken: card => backCardTaken(runs, [], card, 0) })
    if (due.plans.length + due.left.length === 0 && !candidates.some(id => ['finished', 'unknown'].includes(pistesMissionEnd(id, copies, new Set())))) {
      pistesLeftNow = []
      return
    }
    const erased = await erasedRunsOf($, [seat.local, seat.stored])
    const live = await launchRecords($)
    if (live.unread > 0) {
      pistesLeftNow = ['A kept launch could not be read: the dashboard finished no « Pistes de rétro » mission and gave no piste a new card this time (it retries at each reading). Tell the user if it lasts.']
      return
    }
    const now = await $.clock.now()
    // Les fichiers de tickets en dernier, juste avant l'écriture.
    const lots = new Map<string, { links: TicketLink[]; isComplete: boolean } | null>()
    for (const id of candidates) {
      if (pistesMissionEnd(id, copies, erased) !== 'finished') continue
      const launch = liveLaunchOf(runs.find(r => r.id === id)!)
      if (launch) lots.set(id, await readLotLinks($, root, launch.folder))
    }
    const isTaken = (card: string) => backCardTaken(runs, live.records, card, now) || launchingNow.has(card)
    const { plans, left } = planPistesFinish({ pistes, copies, erased, candidates, lots, pendingBy: now0.pendingBy ?? [], isWhole, isTaken })
    const orphans = orphanCardPlans({ ...orphanCtx, erased, pending: now0.pendingPistes ?? [], isTaken })
    pistesLeftNow = [...left, ...orphans.left]
    if (plans.length + orphans.plans.length === 0) return
    // Les cartes d'abord : une carte sans piste ne perd rien et repart ; des pistes sans carte resteraient sans sortie.
    const relisted = await readCardsAt($, root)
    if (relisted.state === 'unread') return
    const have = new Set(relisted.cards.map(c => c.id))
    const all = [...plans.filter(p => !p.isCardless), ...orphans.plans].map(p => p.card)
    const posted = all.filter(c => !have.has(c))
    const holds = all.filter(c => !launchingNow.has(c))
    for (const c of holds) launchingNow.add(c)
    try {
      // Les cartes pas écrites : aucune piste ne passe sur elles (le relevé suivant réessaie).
      if (posted.length > 0) {
        const out = await writeCards($, { kind: 'add', cards: posted.map(id => pistesCard(id, now)) })
        if (out.state !== 'ok' || posted.some(id => !out.changed.includes(id))) return
      }
      let results = new Map<string, PistesFinishResult>()
      let moved = new Map<string, string[]>()
      let oLeft: string[] = []
      await applyWaitlist($, (list, at, ctx) => {
        const out = applyPistesFinish(list, plans, at, ctx)
        // Revérifié sur les missions relues par l'écriture ; les cartes tenues ici par ce relevé ne comptent pas comme prises.
        const o = applyOrphanCards(out.list, orphans.plans, at, { ...orphanCtx, ...ctx, isTaken: c => backCardTaken(ctx.copies.flat(), live.records, c, now) || (launchingNow.has(c) && !holds.includes(c)) })
        results = out.results
        moved = o.moved
        oLeft = o.left
        return { list: o.list, viaTicket: out.viaTicket, still: copies2 => plans.every(p => !out.results.has(p.mission) || finishPlanHolds(p, copies2, erased)) && orphans.plans.every(p => !o.moved.has(p.card) || orphanCardHolds(p, copies2)) }
      })
      // L'effet se prouve en relisant la liste écrite.
      const after = waitlistNow?.state === 'read' && waitlistNow.list ? pistesOf(waitlistNow.list) : null
      const lines = [...finishedLinesOf(plans, results, after), ...orphanLinesOf(orphans.plans, moved, after)]
      pistesLeftNow = [...pistesLeftNow, ...oLeft]
      if (lines.length > 0) await addFinishedLines(root, $, lines)
      // Une carte posée ici qu'aucune piste ne porte (écriture abandonnée, rien à rendre) repart. Son retrait pas écrit
      // (déjà partie : rien), ou la liste d'attente pas relue : elle reste, et le relevé dit de la retirer si aucune piste
      // ne la porte (le relevé suivant ne la revoit pas : elle est dans la liste).
      const stuck: string[] = []
      for (const card of posted) {
        const kept = await validatedOfCard($, root, card)
        if (kept !== null && kept.length > 0) continue
        const out = kept === null ? null : await writeCards($, { kind: 'remove', which: c => c.id === card })
        if (out?.state !== 'ok' && out?.state !== 'none') stuck.push(card)
      }
      if (stuck.length > 0) await addFinishedLines(root, $, [`Launch cards « Pistes de rétro » ${stuck.map(c => `« ${c} »`).join(', ')}, posted by this statement, may carry no piste and could not be removed: tell the user in one line to remove each that carries no piste with « ✕ Retirer » (page « Missions »).`])
      $.ui.invalidate('ui.render')
    } finally {
      for (const c of holds) launchingNow.delete(c)
    }
  } finally {
    isFinishingPistes = false
  }
}

/** Le SKILL.md du skill de rétro, dans l'installation où `askMattPath` a trouvé ask-matt ; null sans lui. */
const retroSkillPath = async ($: any): Promise<string | null> => {
  const p = (await askMattPath($))?.replace(/\/ask-matt\/SKILL\.md$/, '/retro/SKILL.md')
  return p?.endsWith('/skills/engineering/retro/SKILL.md') && (await fileExists($, p)) === true ? p : null
}
/** Le brief de la mission lancée par une carte « Pistes de rétro », d'après la liste relue à l'instant (`pistesBriefText`). */
const pistesBrief = async ($: any, root: string, card: string): Promise<string> => pistesBriefText(await readWaitlist($, root), card, await retroSkillPath($))

/** Le toast d'un clic d'archivage sur une liste qui a changé depuis l'affichage, mot pour mot comme la personne l'a décidé. */
const ARCHIVE_LIST_CHANGED = "La liste a changé depuis : rien n'est archivé, regarde-la de nouveau"

/**
 * « ✓ Archiver » et « ✓ Tout archiver (n) » : par le mod du COO, sur le fichier des missions relu à l'instant et
 * fusionné, le siège relu juste avant (comme `closeIdle`) ; seulement si la liste des missions qui attendent
 * « ✓ Archiver » (livrées, ou closes sans livraison avec leur carte de rétro prête ici et que ni une clôture demandée
 * ni la livraison ne visent, `archiveHeldOf`) est encore celle de l'affichage (`print`) et que chaque id montré en
 * fait partie (`archiveAwaiting`) :
 * une mission archivée, reprise, redevenue active ou ajoutée depuis n'archive rien (invariant des missions livrées :
 * aucune mission n'est archivée sans le choix de la personne). Puis les cartes de rétro encore prêtes des missions
 * archivées quittent la vue. Chaque mission archivée porte la marque « clic » (l'accord de la personne pour fermer
 * sa discussion). Rend les missions archivées (vide sinon), le toast et la procédure de fermeture de leurs discussions
 * remise au Claude du COO (`ask`, `missionSessionsArchiveText` ; null quand aucune ne se nomme), formée sur le fichier relu,
 * pour les discussions de ces missions que la liste des discussions à fermer rend (`discussionsToCloseBoth`).
 */
const archiveShown = async ($: any, ids: readonly string[], print: string): Promise<ArchiveOut> => {
  if (!(await pull($))) return { archived: [], toast: '◆ Rien n’est archivé : le fichier des missions ne se lit pas ; reclique dans un instant.' }
  const seat = await seatForWrite($)
  if (!seat.ok) return seat.why === 'unread' ? { archived: [], toast: '◆ Rien n’est archivé : le fichier des missions ne se lit pas ; reclique dans un instant.' } : { archived: [], toast: '◆ Rien n’est archivé : cette discussion ne tient plus le siège du COO.' }
  const now = await $.clock.now()
  // Ce que seul le COO sait d'une mission close sans livraison, relu à l'instant comme pour l'affichage : sa carte de
  // rétro prête ici (l'état de la carte jugé sur le fichier fusionné), et la clôture ou la livraison qui la visent.
  const cards = await cardsHere($)
  const pulled: Board | null = await read($, boardAtom)
  // Sans board relu (`pulled` null) : dans le doute, toutes les missions retenues.
  const heldIds = pulled ? await archiveHeldOf($, pulled, true) : null
  let archived: Run[] = []
  const fx = await commit($, b => {
    const scope = { carded: readyRetroOf(cards.map(c => ({ ...(c.of !== undefined ? { of: c.of } : {}), state: cardStateOf(c, b.runs, now) }))), held: heldIds ?? new Set(b.runs.map(r => r.id)) }
    const out = archiveAwaiting(b, ids, print, now, undefined, 'clic', scope)
    archived = out ? out.board.runs.filter(r => ids.includes(r.id)) : []
    return out
  })
  if (fx === null || archived.length === 0) return { archived: [], toast: ARCHIVE_LIST_CHANGED }
  // Pas sûr d'être écrit (écriture ratée, ou fichier illisible) : la sauvegarde suivante réessaie ; rien ne se fonde dessus
  // (ni carte retirée, ni discussion à archiver) tant que le fichier relu ne le porte pas. Sinon, relu du fichier commun
  // après la sauvegarde (jamais la seule copie d'ici) : seules les missions qui y sont bien archivées comptent ; une autre
  // discussion qui en a repris une entre-temps garde sa copie, plus récente. Relu introuvable ou illisible : rien ne se
  // fonde sur la copie d'ici, comme pour une sauvegarde pas sûre.
  const reread = (await saveNow($)) ? await readStored($, seat.local.root ?? '') : null
  if (reread === null || reread.isUnread || reread.board === null) {
    // Les discussions que la liste des discussions à fermer rend pour ces missions, d'après la copie d'ici : le toast dit
    // que le COO fermera celles-là à son prochain tour (la section du relevé, calculée sur la copie d'ici, les porte ; le
    // contrôle ne les rend qu'une fois l'archivage écrit dans le fichier commun).
    const local: Board | null = await read($, boardAtom)
    const unasked = local ? ((await toCloseFrom($, seat.local.root, local.runs, null, new Set(ids))) ?? []).length : 0
    return { archived: [], unasked, toast: `◆ L’archivage n’est peut-être pas encore écrit dans le fichier des missions : le tableau de bord réessaie à sa prochaine sauvegarde ; regarde la vue de nouveau dans un instant.${unaskedText(unasked)}` }
  }
  const board: Board = reread.board
  const held = (board?.runs ?? []).filter(r => ids.includes(r.id) && r.archivedAt !== undefined)
  const missed = (board?.runs ?? []).filter(r => ids.includes(r.id) && r.archivedAt === undefined)
  if (held.length === 0) return { archived: [], toast: ARCHIVE_LIST_CHANGED }
  const gone = new Set(held.map(r => r.id))
  await quietly(() => writeCards($, { kind: 'remove', which: s => s.of !== undefined && gone.has(s.of) && cardStateOf(s, board.runs, now).kind === 'ready' }))
  $.ui.invalidate('ui.render')
  const named = (runs: Run[]) => runs.map(r => `« ${neutralLine(clip(r.title, 60))} »`).join(', ')
  // Les discussions de ces missions que la liste des discussions à fermer rend (les deux copies du fichier des missions,
  // le fichier de coordination relu : illisible, rien n'est demandé ici, le relevé suivant la reprend).
  const local: Board | null = await read($, boardAtom)
  const list = local ? ((await toCloseFrom($, seat.local.root, local.runs, board.runs, gone)) ?? []) : []
  const sessions = list.flatMap(d => d.runs.map(r => ({ title: neutralQuoted(r.title), id: d.session, ...(r.by === 'retro' ? { byRetro: true } : {}) })))
  return {
    archived: held,
    toast: `▣ Archivée${held.length > 1 ? 's' : ''} : ${named(held)}.${missed.length > 0 ? ` Pas archivée${missed.length > 1 ? 's' : ''} (reprise${missed.length > 1 ? 's' : ''} ailleurs entre-temps) : ${named(missed)}.` : ''}`,
    ask: missionSessionsArchiveText(sessions, closingRepo(board.root)),
    unasked: list.length,
  }
}

/**
 * « ✕ Retirer » : la carte de rétro encore prête d'une mission qui n'attend pas « ✓ Archiver » et n'a plus droit à sa carte (`isRetroCardRemovable`)
 * quitte la vue, sans rien écrire sur la mission ; rien quand la carte n'est plus prête, que sa mission attend
 * « ✓ Archiver » sur le board d'ici (le bouton qui archive la mission et retire la carte) ou qu'elle a encore droit à
 * sa carte (retirée, elle reviendrait au relevé suivant) ; rien non plus quand la liste des cartes ne s'écrit pas (le
 * siège repris ailleurs depuis le dessin, la liste changée ou pas écrite), et le toast dit pourquoi. Appelée seulement
 * par `cooDo`, qui vérifie que Claude est au repos, puis le siège du COO.
 */
const removeRetroCard = async ($: any, id: string): Promise<string> => {
  const board: Board | null = await read($, boardAtom)
  const now = await $.clock.now()
  const card = (await cardsHere($)).find(c => c.id === id)
  if (!card || !board || !isRetroCardRemovable(card.of, board.runs) || cardStateOf(card, board.runs, now).kind !== 'ready') return '◆ Rien n’est retiré : relis la carte.'
  // Le siège relu juste avant l'écriture : repris ailleurs depuis le dessin, rien n'est écrit, et le message le dit.
  const out = await writeCards($, { kind: 'remove', which: s => s.id === id && cardStateOf(s, board.runs, now).kind === 'ready' })
  if (out.state === 'ok') return `◆ Carte retirée : « ${neutralLine(clip(card.title, 60))} ».`
  return out.state === 'none' ? '◆ Rien n’est retiré : relis la carte.' : `◆ Rien n’est retiré : ${cardWriteWhy(out.state)}.`
}

/**
 * « ✕ Retirer » d'une carte de lancement ordinaire (ni de rétro, ni « Pistes de rétro ») : relue au clic, elle quitte la vue
 * seulement si elle est encore prête, ordinaire et dans la version que le clic montrait (`shownAt`, sa date : une carte
 * reproposée par le Claude du COO garde son id), qu'aucun clic de lancement ni autre retrait ne la tient à l'instant
 * (`launchingNow`, `removingNow` : ce dernier, pris pendant le retrait, fait refuser un clic de lancement avec son propre
 * message) et qu'aucun lancement gardé encore valable ne la nomme, les lancements relus (un lancement gardé illisible :
 * rien) ; sinon rien. Rien n'est écrit sur la feuille de route : l'idée que portait la carte garde son statut.
 * Appelée seulement par `cooDo`, qui vérifie que Claude est au repos, puis le siège du COO.
 */
const removeLaunchCard = async ($: any, id: string, shownAt: number | undefined): Promise<string> => {
  const late = '◆ Rien n’est retiré : relis la carte.'
  if (shownAt === undefined || launchingNow.has(id) || removingNow.has(id)) return late
  removingNow.add(id)
  try {
    const board: Board | null = await read($, boardAtom)
    const now = await $.clock.now()
    const card = (await cardsHere($)).find(c => c.id === id)
    if (!card || !board || !isOrdinaryCard(card) || card.at !== shownAt || cardStateOf(card, board.runs, now).kind !== 'ready') return late
    const live = await launchRecords($)
    // Seulement les lancements de ce projet : un dossier du même nom ailleurs ne retient pas la carte (comme `launchCard`).
    if (live.unread > 0 || isCardInLaunch(live.records.filter(r => r.root === normRoot(board.root)), id, card.folder, now)) return late
    // Calculé sur la liste relue à l'écriture : ce qui a changé dit si la carte est partie.
    const out = await writeCards($, { kind: 'remove', which: s => s.id === id && s.at === shownAt && isOrdinaryCard(s) && cardStateOf(s, board.runs, now).kind === 'ready' })
    if (out.state === 'ok') return `◆ Carte retirée : « ${neutralLine(clip(card.title, 60))} ».`
    return out.state === 'none' ? late : `◆ Rien n’est retiré : ${cardWriteWhy(out.state)}.`
  } finally {
    removingNow.delete(id)
  }
}

/**
 * Ce que dit un toast quand la procédure de fermeture de `count` discussions n'est pas envoyée d'ici : rien n'est perdu,
 * la section « discussions à fermer » du relevé suivant la porte ; rien pour aucune.
 */
const unaskedText = (count: number): string =>
  count === 0 ? '' : count > 1 ? ' Le COO fermera leurs discussions à son prochain tour.' : ' Le COO fermera sa discussion à son prochain tour.'

/**
 * Ce que rend `archiveShown` ; `unasked` : le nombre de discussions à fermer de ces missions (celles que sa demande nomme,
 * ou, archivage pas sûr d'être écrit, celles de la copie d'ici).
 */
type ArchiveOut = { archived: Run[]; toast: string; ask?: string | null; unasked?: number }

/**
 * Ce que disent toutes les boîtes de pistes du projet sur ce poste (`boxes`, relues une fois par relevé) des
 * opérations de la rétro `retro` : `pending` quand une opération de cette rétro (`by`) n'a pas sa marque dans la liste
 * d'attente (`applied`), où que soit sa boîte (une rétro reprise dans plusieurs discussions a pu déposer dans chacune) ;
 * `doubt` quand une boîte ne se relit pas, ou qu'une opération hors forme est de cette rétro ou n'a pas d'auteur
 * lisible ; `none` sinon (aucune boîte : rien n'attend).
 */
const retroBoxesOf = (boxes: { isWhole: boolean; ops: { raw: unknown; session: string }[] }, retro: Run, applied: ReadonlySet<string>): RetroBoxes => {
  if (!boxes.isWhole) return 'doubt'
  let out: RetroBoxes = 'none'
  for (const { raw, session } of boxes.ops) {
    const op = soundPisteOp(raw)
    if (!op) {
      const by = raw !== null && typeof raw === 'object' ? (raw as { by?: unknown }).by : undefined
      if (typeof by !== 'string' || by === retro.id) return 'doubt'
      continue
    }
    if (op.by === retro.id && !applied.has(opMark(session, op.id))) out = 'pending'
  }
  return out
}

/** La liste d'attente (ses marques) et toutes les boîtes de pistes du projet, relues à l'instant ; null quand la liste ne se relit pas. */
const retroMarksOf = async ($: any, root: string): Promise<{ all: { isWhole: boolean; ops: { raw: unknown; session: string }[] }; applied: ReadonlySet<string> } | null> => {
  const list = await readWaitlist($, root)
  if (list.state === 'unread') return null
  return { all: await readAllPisteBoxes($, root), applied: new Set(list.state === 'read' ? list.list.applied : []) }
}

/**
 * À chaque relevé du siège, après l'application des boîtes à la liste d'attente : chaque rétro lancée par sa carte,
 * close et pas archivée, dont toutes les opérations sont écrites dans la liste (`retroBoxesOf`), s'archive avec la
 * mission qu'elle étudie (`archiveRetroEnd`, marque « retro »), sans clic, par les gardes du chemin de « ✓ Archiver » :
 * liste d'attente et boîtes relues juste avant, fichier des missions relu et fusionné, siège revérifié, la rétro toujours
 * close à la date du relevé (reprise puis reclose entre-temps, elle a pu déposer une piste que ces boîtes n'ont pas vue),
 * fichier de coordination relu à l'instant, conditions rejugées sur le fichier fusionné, sauvegarde. Rien
 * ne se fonde sur le résultat (ni toast, ni carte, ni demande) : pas de relecture après la sauvegarde, et une écriture
 * pas sûre se refait à la sauvegarde suivante (l'archivage reste dans la copie d'ici). Une liste ou une boîte
 * illisible : rien, le relevé suivant réessaie. Une `/retro` tapée à la main (sans lancement) n'est pas concernée.
 */
const finishRetros = async ($: any, board: Board): Promise<void> => {
  const candidates = board.runs.filter(r => r.status === 'done' && r.archivedAt === undefined && retroOf(r) !== null)
  if (candidates.length === 0) return
  // La liste telle que le relevé vient de l'appliquer : illisible, privée de pistes déjà vues, ou les pistes vues
  // illisibles, c'est un doute (son écrivain la refuse aussi) ; puis relue pour ses marques.
  if (waitlistNow === null || waitlistNow.state === 'unread' || waitlistNow.state === 'missing' || waitlistNow.seenUnread) return
  const seen = await retroMarksOf($, board.root)
  if (!seen) return
  // Jugé d'abord sur le fichier du relevé, sans rien tirer : une rétro qui ne peut pas finir ne coûte rien de plus, et
  // les retenues ne se lisent qu'une fois par relevé, seulement pour une rétro dont toutes les pistes sont écrites.
  const ready = candidates.filter(r => retroBoxesOf(seen.all, r, seen.applied) === 'none')
  if (ready.length === 0) return
  const heldSeen = await archiveHeldOf($, board)
  for (const retro of ready) {
    if (!retroEndOf(board, retro.id, 'none', heldSeen)) continue
    // Ce qui a décidé, relu juste avant de tirer le fichier des missions : marques et boîtes.
    const fresh = await retroMarksOf($, board.root)
    if (!fresh) return
    const boxes = retroBoxesOf(fresh.all, retro, fresh.applied)
    if (!(await pull($))) return
    const seat = await seatForWrite($)
    if (!seat.ok) return
    const pulled: Board | null = await read($, boardAtom)
    if (!pulled) return
    // Reprise puis reclose depuis le relevé (sa date de fin a changé), la rétro a pu déposer une piste que ces boîtes
    // n'ont pas vue : rien, le relevé suivant la rejuge.
    if (pulled.runs.find(r => r.id === retro.id)?.finishedAt !== retro.finishedAt) continue
    // Le fichier de coordination relu à l'instant, comme au clic.
    const held = await archiveHeldOf($, pulled, true)
    const now = await $.clock.now()
    const fx = await commit($, b => archiveRetroEnd(b, retro.id, boxes, held, now))
    if (fx === null) continue
    // Pas sûr d'être écrit : l'archivage reste dans la copie d'ici, et la sauvegarde suivante l'écrit.
    if (!(await saveNow($))) return
  }
}

/** Le clic « ✓ Archiver » ou « ✓ Tout archiver (n) » de la vue Coordination. */
const archiveDelivered = async ($: any, ids: readonly string[], print: string): Promise<string> => {
  // Le clic de la personne : la marque « clic » part avec la date (son accord pour fermer la discussion de la mission).
  const out = await archiveShown($, ids, print)
  // Une seule demande pour toutes les discussions (« ✓ Tout archiver (n) ») ; `cooDo` a vérifié que Claude est au repos.
  // Refusée à l'envoi, rien n'est perdu : la section « discussions à fermer » du relevé suivant la porte ; le toast le dit, sans « reclique ».
  if (out.ask) submitCooAsk($, out.ask, `◆ La demande de fermer ${(out.unasked ?? 0) > 1 ? 'leurs discussions' : 'sa discussion'} n’est pas partie.${unaskedText(out.unasked ?? 0)}`)
  return out.toast
}

/** Les pistes des rétros lancées par le COO, à cocher chez lui : celles encore à faire, celles prises ailleurs, ce qui est coché. */
const cooRetroPicksOf = (board: Board): CooRetroPicks[] =>
  board.runs.flatMap(r => {
    if (!retroOf(r) || r.archivedAt !== undefined || r.status === 'done' || currentPhase(r).skill !== 'retro') return []
    const phase = currentPhase(r)
    const taken = takenFor(coordLive, r.id, retroItems(r))
    // Les pistes d'une sélection déjà envoyée (encore valable) ne se recochent pas : cochées ou non, elles sont tranchées.
    const sent = new Set(coordLive.flatMap(e => (e.kind === 'pick' && e.run === r.id && holdsPick(e, phase.items) ? [...e.picked, ...e.left] : [])))
    // Une rétro qui relit la liste d'attente : ses pistes relues dans la liste se cochent dans « Pistes en attente » ;
    // seules celles qui n'y sont pas (jamais déposées, ajout refusé ou pas encore appliqué, liste illisible) gardent sa section.
    const listed = isWaitlistRetro(r) ? new Set((cooWaitlistOf()?.pistes ?? []).filter(p => p.retro === r.id).map(p => p.id)) : new Set<string>()
    const items = phase.items.filter(i => i.status === 'todo' && !taken.has(i.id) && !sent.has(i.id) && !listed.has(`${r.id}/${i.id}`))
    const isSent = items.length === 0 && phase.items.some(i => i.status === 'todo' && sent.has(i.id))
    if (items.length === 0 && !isSent) return []
    const print = picksPrint(items)
    const ticks = retroTicks.get(r.id) ?? new Set<string>()
    const takenRows = phase.items.filter(i => taken.has(i.id)).map(i => ({ id: i.id, label: i.label, by: board.runs.find(x => x.id === taken.get(i.id)!.run)?.title ?? taken.get(i.id)!.run }))
    return [{ retro: r.id, title: r.title, items: items.map(i => ({ id: i.id, label: i.label, isTicked: ticks.has(i.id) })), taken: takenRows, print, ...(isSent ? { isSent: true } : {}) }]
  })

/** « ✂ Découper la sélection » : la sélection s'écrit dans le fichier de coordination, sur les pistes affichées au clic. */
const recordPick = async ($: any, retro: string, print: string): Promise<string> => {
  const seat = await seatForWrite($)
  if (!seat.ok) return '◆ Rien n’est envoyé : ce COO ne tient plus le siège, ou le fichier des missions ne se lit pas.'
  const board: Board | null = await read($, boardAtom)
  const p = board ? cooRetroPicksOf(board).find(x => x.retro === retro) : undefined
  if (!p || p.print !== print) return '◆ Rien n’est envoyé : les pistes ont changé depuis ton affichage ; relis-les, puis reclique.'
  if (p.items.length === 0) return '◆ Sélection déjà envoyée : la rétro l’applique dès qu’elle est ouverte.'
  if (p.items.some(i => !isGroupId(i.id))) return '◆ Rien n’est envoyé : une piste de cette rétro a un id hors forme ; demande à la rétro de le corriger.'
  if (p.items.length > PICK_MAX) return `◆ Rien n’est envoyé : ${p.items.length} pistes, ${PICK_MAX} au plus par sélection ; demande à la rétro d’en regrouper.`
  const picked = p.items.filter(i => i.isTicked).map(i => i.id)
  const left = p.items.filter(i => !i.isTicked).map(i => i.id)
  const now = await $.clock.now()
  const id = newEntryId(now, Math.random())
  const written = await writeCoordination($, entries => (liveEntries(entries, () => false).some(e => e.kind === 'pick' && e.run === retro && e.print === print) ? null : [...entries, { id, kind: 'pick', run: retro, at: now, picked, left, print }]))
  if (written === 'none') return '◆ Sélection déjà envoyée : la rétro l’applique dès qu’elle est ouverte.'
  if (written !== 'ok') return `◆ Rien n’est envoyé : ${coordWriteWhy(written)}`
  retroTicks.delete(retro)
  return `✂ Sélection envoyée à « ${neutralLine(clip(p.title, 60))} » : ${picked.length} à découper, ${left.length} vers À reprendre.`
}

/**
 * Le mod de la rétro applique une sélection du COO, une fois, sur les mêmes pistes seulement : les non cochées
 * s'écrivent d'abord dans la boîte « À reprendre » de cette discussion (sauf celles relues « pas encore validée »
 * dans la liste d'attente d'une rétro qui la relit, qui y restent), puis s'écartent ; ensuite seulement la
 * demande de découpage des cochées part (en auto) ou va dans la saisie (en manuel). Changées depuis : sans effet.
 */
const applyPicks = async ($: any, runId: string, entries: readonly CoordEntry[], applied: ReadonlySet<string>) => {
  if (isApplyingRelay || isApplyingWave || isTurnOpen || isAutoDeciding || isAutoCompacting) return
  if (!entries.some(e => e.kind === 'pick' && e.run === runId && !applied.has(e.id))) return
  isApplyingRelay = true
  try {
    await applyPicksNow($, runId, entries, applied)
  } finally {
    isApplyingRelay = false
    // L'auto, retenu pendant l'application, décide de nouveau.
    scheduleAutoTurn($)
  }
}
/**
 * Les pistes de la rétro `runId` relues « pas encore validée » dans la liste d'attente des rétros : seule preuve
 * qu'une non cochée n'a pas à partir dans « À reprendre » (une piste écartée, validée ou plus loin n'attend plus
 * un choix : elle y part aussi, au pire aux deux endroits). Une liste absente ou illisible n'en prouve aucune.
 */
const waitlistedItems = async ($: any, root: string, runId: string): Promise<Set<string>> => {
  const got = await readWaitlist($, root)
  if (got.state !== 'read') return new Set()
  const prefix = `${runId}/`
  return new Set(pistesOf(got.list).flatMap(p => (p.id.startsWith(prefix) && p.state === 'pending' ? [p.id.slice(prefix.length)] : [])))
}

const applyPicksNow = async ($: any, runId: string, entries: readonly CoordEntry[], applied: ReadonlySet<string>) => {
  for (const e of entries) {
    if (e.kind !== 'pick' || e.run !== runId || applied.has(e.id)) continue
    const board: Board | null = await read($, boardAtom)
    const run = board && !board.delegate ? activeRun(board) : null
    if (!board || !run || run.id !== runId || run.status !== 'active' || isTurnOpen) return
    const phase = currentPhase(run)
    const shown = phase.skill === 'retro' ? pickedOf(e, phase.items) : null
    const isSame = shown !== null && shown.every(i => (e.picked.includes(i.id) ? i.status === 'todo' : i.status === 'todo' || i.status === 'dropped'))
    if (!shown || !isSame) {
      await noteApplied($, runId, e.id)
      await quietly(() => $.ui.toast('◆ La sélection du COO ne vaut plus : les pistes de la rétro ont changé ; recoche-les chez le COO.'))
      continue
    }
    const now = await $.clock.now()
    // Les marques « prise ailleurs » relues à l'instant : une telle piste n'est ni découpée, ni recopiée dans « À reprendre ».
    const taken = takenFor(entries, runId, retroItems(run))
    const unticked = shown.filter(i => e.left.includes(i.id) && i.status === 'todo' && !taken.has(i.id))
    // Une rétro qui relit la liste d'attente : ses non cochées relues dans la liste y restent, « pas encore validée » ;
    // les autres (jamais déposées, ajout refusé ou pas encore appliqué, liste illisible) vont dans « À reprendre ».
    const listed = isWaitlistRetro(run) ? await waitlistedItems($, board.root, runId) : new Set<string>()
    const kept = unticked.filter(i => listed.has(i.id))
    const away = unticked.filter(i => !listed.has(i.id))
    if (kept.length > 0) {
      if (!(await commit($, b => setAsidePistes(b, runId, kept.map(i => i.id), now, 'waitlist')))) return
      await saveNow($)
    }
    if (away.length > 0) {
      const items: SetAside[] = away.map((i, k) => ({ id: newSetAsideId(now + k, Math.random()), text: clip(`Piste non cochée de la rétro « ${neutralLine(run.title)} » : ${i.label}`, SET_ASIDE_TEXT_MAX), source: clip(`rétro ${neutralLine(run.title)}, piste ${i.id}`, SET_ASIDE_SOURCE_MAX), ...(isSafeId(run.id) ? { run: run.id } : {}), at: now }))
      // Écrites d'abord : une boîte qui refuse laisse tout tel quel, et la relecture suivante réessaie.
      // Une piste déjà dans la boîte (une application reprise après un écart raté) ne s'y ajoute pas deux fois.
      const box = await writeBox($, board.root, await hereId($), before => { const fresh = items.filter(i => !before.some(b => { const x = soundSetAside(b); return x?.run === runId && x.source === i.source })); return fresh.length > 0 ? [...before, ...fresh] : null }, new Set(), true)
      if (box !== 'ok' && box !== 'none') return
      // Écartées ensuite ; une écriture ratée se réessaie à la relecture suivante (la boîte, elle, ne change plus).
      if (!(await commit($, b => setAsidePistes(b, runId, away.map(i => i.id), now)))) return
      await saveNow($)
    }
    await noteApplied($, runId, e.id)
    // Une piste cochée puis marquée prise ailleurs ne se découpe pas : elle reste, montrée prise.
    const picked = shown.filter(i => e.picked.includes(i.id) && !taken.has(i.id))
    if (picked.length === 0) {
      await quietly(() => $.ui.toast(`◆ COO : aucune piste cochée à découper ; ${away.length} partie(s) dans « À reprendre »${kept.length > 0 ? `, ${kept.length} restée(s) dans la liste d’attente` : ''}.`))
      continue
    }
    const folder = soundRunLaunch(run.launch)?.folder
    const where = folder ? `de travail/${folder}/DECISIONS.md` : 'du DECISIONS.md du dossier de cette mission'
    const text =
      `◆ COO : j'ai coché chez le COO ${picked.length} piste(s) de cette rétro. ` +
      `${kept.length > 0 ? `Restées dans la liste d'attente des rétros, « pas encore validée » (écartées ici) : ${itemList(kept)}. ` : ''}` +
      `${away.length > 0 ? `Mises de côté dans « À reprendre » (écartées ici) : ${itemList(away)}. ` : ''}` +
      `${shown.some(i => taken.has(i.id)) ? `Prises ailleurs entre-temps, ni découpées ni mises de côté : ${itemList(shown.filter(i => taken.has(i.id)))}. ` : ''}` +
      `Écris d'abord cette sélection en série neuve ${where} : les pistes cochées (listées plus bas) et celles mises de côté, avec leur id et leur libellé tels que listés ici, et la mention « cochées chez le COO » ; commite-la par son chemin. Puis : ` +
      splitRequest(run, phase, picked, otherMissionFiles(board, run.id))
    if (isAutoOn(run)) {
      let isIn = false
      await quietly(async () => {
        const r = await modSubmit($, { text })
        isIn = r !== null && typeof r === 'object' && typeof r.text === 'string' && r.drop === undefined
      })
      // Pas entrée : la relecture suivante la renvoie (les non cochées, déjà mises de côté, ne s'écrivent pas deux fois).
      if (!isIn) await unnoteApplied($, runId, e.id)
      return
    }
    await fillRequest($, text, `Découpage des ${picked.length} piste(s) cochées chez le COO : la demande est dans le prompt, Entrée pour l’envoyer à Claude`, 'Demande à taper : découpe en tickets les pistes cochées chez le COO')
    return
  }
}

/** Un clic de lancement en cours d'écriture, par carte : un second clic pendant ce temps ne fait rien. */
const launchingNow = new Set<string>()
/** Un retrait de carte ordinaire en cours, par carte : un clic de lancement pendant ce temps ne fait rien et le dit. */
const removingNow = new Set<string>()

/** Un id de carte neuf. */
const newCardId = (now: number): string => `k${newLaunchId(now, Math.random()).slice(1)}`

/** Le champ `card` : une carte de lancement proposée par le Claude du COO, montrée dans la vue Coordination. */
const cardCall = async ($: any, input: unknown): Promise<string> => {
  const board = await ensureBoard($)
  if (!board || board.delegate || activeRun(board) || board.cooHere === undefined) return 'Refused: "card" is for the COO discussion only.'
  const seat = await seatForWrite($)
  if (!seat.ok) return seat.why === 'unread' ? `No card shown: ${SEAT_UNREAD}` : 'No card shown: this discussion does not hold the COO seat.'
  const now = await $.clock.now()
  const runs = [...seat.local.runs, ...(seat.stored?.runs ?? [])]
  const got = await readCards($)
  if (got.state === 'unread') return `No card shown: ${cardWriteWhyEn('unread')}`
  const cards = got.cards
  const folder = input !== null && typeof input === 'object' ? (input as Record<string, unknown>).folder : undefined
  const same = cards.find(c => typeof folder === 'string' && sameFolder(c.folder, folder))
  if (same && cardStateOf(same, runs, now).kind !== 'ready') return `No card shown: the card for travail/${neutralInPrompt(same.folder)}/ is ${cardStateOf(same, runs, now).kind === 'launched' ? 'already launched' : 'being launched'}; a card launches only once (another mission needs another folder).`
  // Le dossier d'une carte prête du tableau de bord (rétro, « Pistes de rétro ») : la carte de Claude la remplacerait sous
  // son id, et la carte prête quitterait la vue sans clic. Refusée : une autre mission a besoin d'un autre dossier.
  const dashboardCard = cards.find(c => typeof folder === 'string' && sameFolder(c.folder, folder) && !isOrdinaryCard(c) && cardStateOf(c, runs, now).kind === 'ready')
  if (dashboardCard) return `No card shown: travail/${neutralInPrompt(dashboardCard.folder)}/ is the folder of a card the dashboard shows (a retro or a « Pistes de rétro » card); a card of yours needs another folder.`
  const parsed = parseCard(input, now, same?.id ?? newCardId(now))
  if ('refused' in parsed) return `No card shown: ${parsed.refused}.`
  // Reproposée sous le même id, elle prend une date plus récente que la carte remplacée, même si l'horloge recule ou se
  // répète : un clic sur un dessin d'avant (lancement, « ✕ Retirer ») se reconnaît à sa date et ne vise pas la nouvelle.
  if (same && parsed.card.at <= same.at) parsed.card = { ...parsed.card, at: same.at + 1 }
  // Une mission lancée par une carte porte déjà ce dossier (carte d'origine retirée depuis, ou perdue avec l'ancien état
  // d'une discussion) : la carte serait lancée
  // dès sa pose, donc cachée de la vue ; refusée comme la carte gardée d'un dossier lancé.
  if (!same && cardStateOf(parsed.card, runs, now).kind === 'launched') return `No card shown: the card for travail/${neutralInPrompt(parsed.card.folder)}/ is already launched; a card launches only once (another mission needs another folder).`
  // Plus de plafond : la carte remplace seulement sa version d'avant (même id) et aucune autre ne part. Les entrées hors
  // forme de la liste restent telles quelles : rien ne s'efface sur un doute. Les cartes de ce dossier, relues à
  // l'écriture, doivent être celles que ce refus ou ce remplacement a jugées (version et marque de lancement comprises) :
  // sinon rien n'est écrit (un clic de lancement entre-temps ne perd pas sa marque).
  const onFolder = (list: readonly LaunchCard[]): string => JSON.stringify(list.filter(c => sameFolder(c.folder, parsed.card.folder)).map(c => [c.id, c.at, c.launch?.id ?? null]))
  const judged = onFolder(cards)
  const out = await writeCards($, { kind: 'put', cards: [parsed.card], expect: fresh => onFolder(fresh) === judged })
  if (out.state !== 'ok') return `No card shown: ${cardWriteWhyEn(out.state)}`
  $.ui.invalidate('ui.render')
  return `Launch card ${parsed.card.id} ${same ? 'updated' : 'shown'} in the Coordination view: « ${neutralInPrompt(parsed.card.title)} », /${parsed.card.start}, ${parsed.card.mode}, ${parsed.card.effort}, travail/${parsed.card.folder}/. The user launches it with its button; never launch a mission without that click.`
}

/**
 * « → /<départ> » sur une carte prête : un autre départ, choisi par la personne avant de lancer. Appelée seulement par
 * `cooDo`, qui vérifie que Claude est au repos, puis le siège du COO.
 */
const changeCardStart = async ($: any, id: string, start: LaunchStart): Promise<string> => {
  const board: Board | null = await read($, boardAtom)
  const now = await $.clock.now()
  const card = (await cardsHere($)).find(c => c.id === id)
  const unchanged = '◆ Rien n’est changé : relis la carte.'
  if (!card || !board || removingNow.has(id) || card.start === RETRO_START || cardStateOf(card, board.runs, now).kind !== 'ready' || !card.alts.includes(start)) return unchanged
  // Une nouvelle date : un clic sur un dessin d'avant ce changement ne lance pas un départ qu'il ne montrait pas.
  const moved: LaunchCard = { ...card, start, alts: [card.start as LaunchStart, ...card.alts.filter(a => a !== start)], at: Math.max(now, card.at + 1) }
  // Une carte retirée, reproposée ou cliquée entre-temps n'est plus celle-ci, relue à l'écriture : rien n'est changé, et le
  // message le dit ; le siège repris ailleurs depuis le dessin : rien non plus.
  const isStill = (c: LaunchCard) => c.id === id && c.at === card.at && cardStateOf(c, board.runs, now).kind === 'ready'
  const out = await writeCards($, { kind: 'set', id, card: moved, expect: fresh => fresh.some(isStill) })
  if (out.state === 'ok') return `◆ Départ de « ${neutralLine(clip(card.title, 60))} » : /${start}.`
  return out.state === 'none' || out.state === 'stale' ? unchanged : `◆ Rien n’est changé : ${cardWriteWhy(out.state)}.`
}

/**
 * Les enregistrements de lancement relus du stockage : ceux en forme, et le nombre de ceux qui ne se lisent
 * pas (lecture ratée, ou forme d'une autre version). Avec `prune`, un enregistrement en forme et périmé
 * s'efface (au chargement et à chaque clic) ; un enregistrement qui ne se lit pas reste : rien ne s'efface
 * sur un doute.
 */
const launchRecords = async ($: any, prune = false): Promise<{ records: LaunchRecord[]; unread: number }> => {
  const now = await $.clock.now()
  const records: LaunchRecord[] = []
  let unread = 0
  let keys: string[] = []
  let isListed = false
  await quietly(async () => {
    keys = ((await $.store.keys()) as string[]).filter(k => k.startsWith(LAUNCH_KEY_PREFIX))
    isListed = true
  })
  // La liste ne s'est pas lue : on ne sait rien, ce qui compte comme une lecture ratée.
  if (!isListed) unread += 1
  for (const key of keys) {
    let isRead = false
    let record: LaunchRecord | null = null
    await quietly(async () => {
      record = soundRecord(await $.store.get(key))
      isRead = true
    })
    const rec = record as LaunchRecord | null
    // Une lecture ratée compte ; un enregistrement hors forme (une autre version) ne se consomme jamais : il reste, sans rien bloquer.
    if (!isRead) unread += 1
    else if (rec === null) continue
    else if (prune && isRecordStale(rec, now)) await quietly(() => $.store.delete(key))
    else records.push(rec)
  }
  return { records, unread }
}
const pruneLaunches = async ($: any) => {
  await launchRecords($, true)
  // Les enregistrements d'allumage périmés aussi (une mission dont la discussion ne l'a jamais pris) : en forme et périmés seulement.
  const now = await $.clock.now()
  let keys: string[] = []
  await quietly(async () => {
    keys = ((await $.store.keys()) as string[]).filter(k => k.startsWith(AUTO_ON_KEY_PREFIX))
  })
  for (const key of keys)
    await quietly(async () => {
      const rec = soundAutoOnRecord(await $.store.get(key))
      if (rec && isRecordStale(rec, now)) await $.store.delete(key)
    })
}

/**
 * Le bouton « Lancer en manuel » (ou en auto) d'une carte prête : l'enregistrement de lancement s'écrit, puis le
 * texte de lancement va dans le prompt du COO ; pour une carte de rétro dont la discussion du manager se désigne
 * (`retroTarget`), une demande de rétro va à sa place dans le fichier de coordination (sans prise, le repli vient
 * ensuite : `watchRetroAsked`). Rien quand la carte n'est plus
 * prête (un second clic, une mission déjà lancée) ou que l'écriture rate. Appelée seulement par `cooDo`, qui vérifie
 * que Claude est au repos, puis le siège du COO.
 */
const launchCard = async ($: any, id: string, mode: LaunchMode, shownAt: number): Promise<string> => {
  if (removingNow.has(id)) return '◆ Rien n’est lancé : la carte est en train d’être retirée ; relis-la.'
  if (launchingNow.has(id)) return '◆ Lancement en cours : rien de plus.'
  launchingNow.add(id)
  try {
    const board: Board | null = await read($, boardAtom)
    const now = await $.clock.now()
    // La carte relue dans la liste, en forme : le texte de lancement est bâti sur elle, jamais sur la carte affichée.
    const got = await readCards($)
    if (got.state === 'unread') return `◆ Rien n’est lancé : ${cardWriteWhy('unread')}.`
    const card = got.cards.find(c => c.id === id)
    if (!board || !card) return '◆ Rien n’est lancé : la carte n’est plus là.'
    // Le clic prend la carte telle qu'elle était affichée : renvoyée entre-temps par Claude, elle se relit d'abord.
    if (card.at !== shownAt) return '◆ Rien n’est lancé : la carte vient de changer ; relis-la, puis reclique.'
    const state = cardStateOf(card, board.runs, now)
    if (state.kind === 'launched') {
      const shownTitle = neutralLine(clip(state.run.title, 60))
      return `◆ Déjà lancée : « ${shownTitle} ».`
    }
    if (state.kind === 'launching') return '◆ Lancement en cours : rien de plus.'
    if (mode === 'auto' && card.effort === 'xhigh') return '◆ Rien n’est lancé : une mission en auto ne tourne jamais en xhigh.'
    // Une carte « Pistes de rétro » ne part qu'avec au moins une piste qui la porte encore « validée », relue à l'instant.
    if (isPistesCard(card)) {
      const held = await validatedOfCard($, board.root, card.id)
      if (held === null) return '◆ Rien n’est lancé : la liste d’attente ne se lit pas ; réessaie.'
      if (held.length === 0) return '◆ Rien n’est lancé : plus aucune piste ne porte cette carte ; retire-la.'
    }
    // Un lancement encore valable pour ce dossier (une carte perdue avec l'ancien état d'une discussion, ou lancée d'un autre poste, puis reproposée) : pas un second.
    const live = await launchRecords($, true)
    if (live.unread > 0) return '◆ Rien n’est lancé : un lancement gardé ne se lit pas ; réessaie.'
    if (live.records.some(r => r.root === normRoot(board.root) && sameFolder(r.folder, card.folder))) return '◆ Rien n’est lancé : un lancement de ce dossier est déjà en cours (valable 10 minutes depuis son clic).'
    const here = await hereId($)
    // Une carte de rétro : la discussion du manager de la mission étudiée, désignée sur le fichier relu à l'instant.
    const target = card.of === undefined ? null : await retroTargetNow($, card.of, here)
    const launch = newLaunchId(now, Math.random())
    const record: LaunchRecord = { v: 1, id: launch, card: card.id, root: normRoot(board.root), title: card.title, start: card.start, ...(card.of ? { of: card.of } : {}), mode, effort: card.effort, folder: card.folder, at: now, by: here }
    // La carte passe d'abord « en lancement » : un second clic ne trouve plus de carte prête, même si l'écriture suit.
    // Seulement la carte relue à l'écriture encore prête et dans cette version ; sinon (ou le siège repris ailleurs, la
    // liste pas écrite) rien n'est lancé, et aucun lancement n'est gardé.
    const marked = await writeCards($, { kind: 'set', id, card: { ...card, launch: { id: launch, at: now, mode } }, expect: fresh => fresh.some(c => c.id === id && c.at === card.at && cardStateOf(c, board.runs, now).kind === 'ready') })
    if (marked.state !== 'ok') return `◆ Rien n’est lancé : ${marked.state === 'none' || marked.state === 'stale' ? 'la carte vient de changer ; relis-la, puis reclique' : cardWriteWhy(marked.state)}.`
    // Le retrait de la marque : seulement si la carte relue porte encore celle de ce lancement ; raté, elle redevient prête après 11 minutes.
    const unmark = { kind: 'set' as const, id, card, expect: (fresh: readonly LaunchCard[]) => fresh.some(c => c.id === id && c.launch?.id === launch) }
    try {
      await $.store.set(launchKey(launch), record)
    } catch {
      await quietly(() => writeCards($, unmark))
      return '◆ Rien n’est lancé : le stockage du tableau de bord refuse l’écriture ; réessaie.'
    }
    // La rétro part chez le manager : une demande dans le fichier de coordination, la saisie du COO n'est pas remplie.
    // Écriture refusée : le lancement gardé est retiré et la carte redevient prête.
    if (card.of !== undefined && target !== null) {
      const of = card.of
      const wrote = await writeCoordination($, entries => [...entries, { id: newEntryId(now, Math.random()), kind: 'retro', run: of, at: now, launch, session: target }])
      if (wrote !== 'ok') {
        await quietly(() => $.store.delete(launchKey(launch)))
        await quietly(() => writeCards($, unmark))
        return '◆ Rien n’est lancé : la demande de rétro ne s’écrit pas dans le fichier de coordination ; réessaie.'
      }
      const asked = neutralLine(clip(card.title, 60))
      return `▶ Rétro « ${asked} » : demandée à la discussion du manager de la mission étudiée (lancement ${launch}, valable 10 minutes) ; le tableau de bord attend qu’elle la prenne, sinon la demande de repli viendra dans le prompt.`
    }
    const text = await missionLaunchText($, card, launch, mode)
    const { isFilled, isQueued } = await fillLaunchAsk($, launch, text)
    const shown = neutralLine(clip(card.title, 60))
    // Le lancement d'une rétro n'archive rien : la mission étudiée et la rétro s'archivent à la fin de la rétro (`finishRetros`).
    if (!isFilled) return `▶ Demande à taper : lance la mission « ${shown} » (lancement ${launch}, valable 10 minutes).`
    return isQueued ? `▶ Lancement de « ${shown} » : la demande s'ajoute à celle qui attend dans le prompt, Entrée lance les deux (valable 10 minutes).` : `▶ Lancement de « ${shown} » : la demande est dans le prompt, Entrée pour la lancer (valable 10 minutes).`
  } finally {
    launchingNow.delete(id)
  }
}

/** Le début de la demande de lancement d'une carte : il la reconnaît dans le prompt du COO. */
const LAUNCH_ASK_START = '◆ COO : lance maintenant la mission'

/** Les ids de lancement que porte un texte (la ligne `{"launch": "<id>"}` d'une demande de lancement). */
const launchIdsIn = (text: string): string[] => [...text.matchAll(/\{"launch": "(l[0-9a-z]{1,24})"\}/g)].map(m => m[1]!)

/** Le tour des clics de cartes sur le prompt du COO : chacun lit puis remplit le prompt après le précédent. */
let launchFillTurn: Promise<unknown> = Promise.resolve()

/** Au-delà, un clic de carte n'attend plus le tour précédent : il ne remplit rien et donne sa demande à taper. */
const LAUNCH_FILL_WAIT_MS = 5_000

/**
 * La demande de lancement `text` (lancement `launch`) mise dans le prompt du COO, à son tour dans la file des clics de
 * cartes (`launchFillTurn`), et le repli d'une rétro que personne n'a prise passe par la même file.
 * La demande d'une autre carte, dont le lancement vaut encore, attend dans le prompt (deux cartes cliquées coup sur
 * coup) : celle-ci s'ajoute à sa suite, jamais à sa place, sans quoi la première carte restait « en lancement » sans
 * demande. Une demande périmée (son lancement n'est plus gardé) est remplacée, jamais renvoyée. Un tour précédent resté
 * sans réponse au-delà de quelques secondes ne retient pas celui-ci, qui ne remplit alors rien. Rien ne se remplit non
 * plus quand le prompt porte une demande et que les lancements gardés ne se relisent pas, ou qu'il mêle une demande
 * périmée et une valable : la demande à taper, avec son id, ne perd ni ne renvoie rien. `keepDraft` (le repli, qui
 * arrive sans geste de la personne) : une saisie qui porte autre chose qu'une demande de lancement valable n'est pas
 * remplacée, et rend `isDraft` ; une lecture ratée rend `isUnread`.
 */
const fillLaunchAsk = async ($: any, launch: string, text: string, keepDraft = false): Promise<{ isFilled: boolean; isQueued: boolean; isDraft: boolean; isUnread: boolean }> => {
  let isQueued = false
  let isFilled = false
  let isHeld = false
  let isDraft = false
  let isUnread = false
  const previous = launchFillTurn
  const turn = (async () => {
    let timer: { cancel: () => void } | null = null
    const isOnTime = await Promise.race([previous.then(() => true), new Promise<boolean>(resolve => (timer = $.clock.after(LAUNCH_FILL_WAIT_MS, () => resolve(false))))])
    ;(timer as { cancel: () => void } | null)?.cancel()
    if (!isOnTime) {
      isHeld = true
      return
    }
    // Le repli (`keepDraft`) : une lecture qui rate retient le remplissage (`isUnread`), jamais un brouillon remplacé à l'aveugle.
    if (keepDraft) isUnread = isHeld = true
    await quietly(async () => {
      // Les lancements valables relus dans le tour, leur péremption à l'heure de maintenant : un clic presque
      // simultané sur une autre carte a écrit le sien avant.
      const read = await launchRecords($, false)
      const at = await $.clock.now()
      const box = String((await $.prompt.read())?.text ?? '')
      isUnread = isHeld = false
      if (!box.includes(LAUNCH_ASK_START)) {
        if (keepDraft && box.trim() !== '') isDraft = isHeld = true
        return
      }
      const ids = launchIdsIn(box).filter(x => x !== launch)
      const valid = ids.filter(x => read.records.some(r => r.id === x && !isRecordStale(r, at)))
      // Une demande dont l'id ne se lit plus (ligne retouchée) : rien n'est remplacé, la demande est à taper.
      if (read.unread > 0 || ids.length === 0 || (valid.length > 0 && valid.length < ids.length)) isHeld = true
      else isQueued = valid.length > 0
      // Le repli ne remplace jamais une saisie : une demande périmée peut voisiner avec un texte tapé par la personne.
      if (keepDraft && !isHeld && !isQueued) isDraft = isHeld = true
    })
    if (isHeld) return
    await quietly(async () => {
      isFilled = (await $.prompt.fill(isQueued ? { text: `\n\n${text}`, mode: 'append' } : { text, mode: 'replace' })).isFilled === true
    })
  })()
  // Le tour suivant attend aussi le précédent : un clic qui a renoncé à l'attendre ne libère pas la file pendant
  // que son remplissage peut encore arriver (en `replace`) par-dessus la demande d'un clic plus tardif.
  launchFillTurn = Promise.all([previous, turn]).catch(() => undefined)
  await turn
  return { isFilled, isQueued, isDraft, isUnread }
}

/**
 * Le texte qui fait lancer la nouvelle discussion par le Claude du COO : son premier message (le skill de
 * départ, le sujet, la ligne qui porte le seul id du lancement), puis comment la lancer dans l'app et dans
 * le CLI, à l'effort de la carte. Le titre, le dossier et le départ viennent de la carte (contrôlés à sa
 * pose) ; le mode n'y est pas : la nouvelle discussion le lit dans l'enregistrement.
 */
const missionLaunchText = async ($: any, card: LaunchCard, launch: string, mode: LaunchMode): Promise<string> => launchText(card, launch, mode, `/${await commandFor($, card.start)}`)

// ─── Rétro dans la discussion du manager ──────────────────────────────────
//
// Au clic « Lancer » d'une carte de rétro, le mod du COO écrit le lancement gardé d'aujourd'hui, puis une demande de
// rétro (`retro`) dans le fichier de coordination quand la discussion du manager de la mission étudiée se désigne
// (`retroTarget`). Le mod de cette discussion la voit à sa relecture de 5 s, même sans mission en cours, la
// revérifie (`retroRequestRefusal`), prend le lancement à son nom, relit la prise, puis lance la commande de rétro.
// Invariant : « Une demande de rétro n'est jamais appliquée deux fois, ni dans une discussion qui tient une mission
// en cours ou qui n'est pas celle de la mission étudiée. » La prise du lancement, posée une seule fois, en est la
// garde : la nouvelle discussion du repli la trouve prise et reçoit le refus d'aujourd'hui.

/** `retroTarget` sur le fichier des missions relu à l'instant ; null quand il ne se relit pas (le chemin d'aujourd'hui). */
const retroTargetNow = async ($: any, of: string, here: string): Promise<string | null> => {
  if (!(await pull($))) return null
  const board: Board | null = await read($, boardAtom)
  const studied = board?.runs.find(r => r.id === of)
  // Une mission étudiée qui n'est plus close, archivée ou qui a déjà sa rétro : le chemin d'aujourd'hui, dont le toast le dit.
  if (!board || !studied || studied.status !== 'done' || studied.archivedAt !== undefined || hasRetro(board.runs, studied.id)) return null
  return retroTarget(studied, board.runs, here)
}


/**
 * La commande de rétro que ce mod a mise en file (son lancement, ses arguments, la date de sa prise) : son propre hook
 * `command.run` ne la voit pas, et `skill.prompt` en reprend les arguments quand elle se charge, sans délai (elle peut
 * attendre derrière un tour).
 */
let retroQueued: { launch: string; args: string; claimAt: number; until: number } | null = null

/** Au-delà de la péremption de son lancement, la commande de rétro en file que le moteur n'a toujours pas chargée se tient pour perdue. */
const RETRO_QUEUE_LOST_MS = 60 * 60_000

/** Une application de demande de rétro en cours dans ce processus : une à la fois, sans retenir la relecture de 5 s. */
let isApplyingRetro = false

/** Le lancement gardé `id` sans prise : la prise d'ici rendue (le lancement redevient libre). Rien quand une autre discussion l'a prise. */
const releaseRetroClaim = async ($: any, id: string, here: string, at: number): Promise<void> => {
  await quietly(async () => {
    const cur = soundRecord(await $.store.get(launchKey(id)))
    // La seule prise de cette application (son nom et sa date) : jamais celle d'un autre processus de la même discussion.
    if (!cur || cur.claim?.by !== here || cur.claim.at !== at) return
    const { claim: _claim, ...free } = cur
    await $.store.set(launchKey(id), free)
  })
}

/**
 * Les demandes de rétro qui désignent cette discussion, relues à chaque relecture de 5 s, avec ou sans mission en
 * cours ici (l'application des autres entrées s'arrête sans mission) ; une à la fois. Une demande appliquée se note
 * dans les entrées appliquées de la mission étudiée (`coo-applied:<mission>`) avant que la commande parte : rejouée
 * (relecture suivante, `/reload-plugins`, discussion relancée), elle ne relance rien.
 */
const applyRetroRequests = async ($: any, board: Board) => {
  if (board.delegate) return
  // La discussion qui tient le siège du COO n'ouvre aucune mission (`applySkill`) : la prise y serait perdue.
  if (isCooDiscussion(board, await $.clock.now())) return
  const here = await hereId($)
  // La discussion qui pose `owner` (`board.session`) et celle d'aujourd'hui diffèrent (un /clear) : dans le doute, rien.
  if (board.session !== undefined && board.session !== here) return
  const got = await readCoordination($, board.root)
  if (got.state !== 'read') return
  const erased = await erasedRunsOf($, [board])
  const now = await $.clock.now()
  // Une commande de rétro encore en file ici : aucune autre demande ne s'applique avant son chargement (ses arguments
  // n'ont qu'une place), même après la péremption de son lancement ; une heure après, elle se tient pour perdue.
  if (retroQueued !== null && now >= retroQueued.until + RETRO_QUEUE_LOST_MS) retroQueued = null
  if (retroQueued !== null) return
  // Une demande périmée ne s'essaie plus (les entrées ne quittent le fichier qu'avec leur mission) : elle ne retient pas les suivantes.
  const mine = liveEntries(got.file.entries, id => erased.has(id)).filter((e): e is CoordRetro => e.kind === 'retro' && e.session === here && !isRetroRequestStale(e, now))
  for (const entry of mine) {
    const applied = await readApplied($, entry.run)
    if (!applied || applied.has(entry.id)) continue
    const out = await applyRetroRequest($, entry, here)
    // Une commande partie, ou un tour ouvert ici : la suivante attend la relecture suivante ; un refus passe à la suivante.
    if (out !== 'skip') return
  }
}

/**
 * Une demande de rétro revérifiée à l'instant, sur le fichier des missions relu et le lancement gardé relu : prise du
 * lancement à son nom, relue après le délai d'aujourd'hui (la même marque, à la même date), tout revérifié une dernière
 * fois, notée appliquée, puis la commande de rétro en file (`$.command.run`). Un refus du moteur rend la prise et se dit
 * au journal de la mission étudiée. Rend `sent` (la commande partie), `wait` (un tour ouvert ici) ou `skip` (pas
 * appliquée ; une mission archivée, reprise ou qui a déjà sa rétro la fait noter vue, sans retour).
 */
const applyRetroRequest = async ($: any, entry: CoordRetro, here: string): Promise<'sent' | 'wait' | 'skip'> => {
  // Le dernier refus de `check`, lu après lui.
  const last: { why: RetroRequestRefusal | null } = { why: null }
  const check = async (claimAt?: number): Promise<LaunchRecord | null> => {
    last.why = null
    if (!(await pull($))) return null
    const board: Board | null = await read($, boardAtom)
    if (!board || board.delegate || isCooDiscussion(board, await $.clock.now())) return null
    let record: LaunchRecord | null = null
    let isRead = false
    await quietly(async () => {
      record = soundRecord(await $.store.get(launchKey(entry.launch)))
      isRead = true
    })
    if (!isRead) return null
    const rec = record as LaunchRecord | null
    // Après la prise, la sienne seulement (son nom et sa date : un second processus de la même discussion a une autre
    // date) ; elle se juge à part, le reste comme avant.
    if (claimAt !== undefined && (rec?.claim?.by !== here || rec.claim.at !== claimAt)) return null
    const seen = claimAt !== undefined && rec ? (({ claim: _claim, ...free }) => free)(rec) : rec
    last.why = retroRequestRefusal({ entry, runs: board.runs, here, root: normRoot(board.root), record: seen, isTurnOpen, now: await $.clock.now() })
    return last.why === null ? rec : null
  }
  const first = await check()
  if (!first) {
    if (last.why === 'turn') return 'wait'
    // La mission étudiée archivée, reprise ou qui a déjà sa rétro : la demande notée vue, elle ne se relit plus.
    if (last.why === 'state') await noteApplied($, entry.run, entry.id)
    return 'skip'
  }
  const claimAt = await $.clock.now()
  try {
    await $.store.set(launchKey(first.id), { ...first, claim: { by: here, at: claimAt } })
  } catch {
    return 'skip'
  }
  // Relu un peu après : une autre discussion (la nouvelle du repli) qui l'a prise en même temps a écrit son nom.
  await $.clock.sleep(LAUNCH_CLAIM_SETTLE_MS)
  const kept = await check(claimAt)
  if (!kept || !(await noteApplied($, entry.run, entry.id))) {
    await releaseRetroClaim($, entry.launch, here, claimAt)
    return last.why === 'turn' ? 'wait' : 'skip'
  }
  const command = await commandFor($, RETRO_START)
  const args = retroCommandArgs(kept)
  // Le hook `command.run` du mod ne voit pas une commande que le mod lance lui-même : ses arguments (la ligne du
  // lancement, qui fait ouvrir une mission neuve, jamais reprendre une mission en pause) se gardent ici pour `skill.prompt`.
  retroQueued = { launch: entry.launch, args, claimAt, until: kept.at + LAUNCH_TTL_MS }
  // Sans l'attendre : la commande part quand la discussion est au repos, et sa rétro peut durer.
  void (async () => {
    try {
      await $.command.run({ command, args })
    } catch {
      if (retroQueued?.launch === entry.launch) retroQueued = null
      await releaseRetroClaim($, entry.launch, here, claimAt)
      // Le fichier des missions relu d'abord : un archivage fait ailleurs entre-temps n'est jamais défait par cette ligne.
      let isLogged = false
      await quietly(async () => {
        if (!(await pull($))) return
        const now = await $.clock.now()
        isLogged = (await commit($, b => noteRetroRefused(b, entry.run, now))) !== null
        if (isLogged) await saveNow($)
      })
      // Le journal pas écrit (fichier des missions illisible) : la personne l'apprend quand même.
      if (!isLogged) $.ui.toast(`◆ ${RETRO_REFUSED_TEXT}.`)
    }
  })()
  return 'sent'
}

/** Ce que dit une discussion dont la commande de rétro, en file, trouve une mission en cours à son chargement. */
const RETRO_BUSY_FR = 'Rétro demandée par le COO pas ouverte ici : une mission est en cours dans cette discussion ; le lancement est rendu'

/** Les demandes de rétro dont le COO a déjà dit la prise (id de lancement) : un toast par demande et par chargement du mod. */
const retroTakenSaid = new Set<string>()

/** Ce que dit le COO quand la discussion du manager a pris sa demande de rétro. */
const retroTakenText = (title: string): string => `▶ La rétro « ${title} » part dans la discussion du manager de la mission étudiée. L’effort de la carte ne s’y applique pas : cette discussion garde le sien.`

/**
 * Chez le COO, à chaque relecture : les demandes de rétro encore valables du fichier de coordination relu (rien n'est
 * gardé en mémoire que le toast déjà dit). La prise ne se dit, d'un toast et une fois, qu'une fois le lancement porté
 * par une mission née dans la discussion désignée : une marque de prise seule peut encore être rendue (refus du moteur,
 * tour ouvert pendant sa relecture). Sans prise passé `RETRO_CLAIM_WAIT_MS`, le repli (`offerRetroFallback`).
 */
const watchRetroAsked = async ($: any, board: Board) => {
  const now = await $.clock.now()
  if (seatState(board.coo, await hereId($), now) !== 'mine') return
  const asks = coordLive.filter((e): e is CoordRetro => e.kind === 'retro' && !isRetroRequestStale(e, now, LAUNCH_GRACE_MS))
  for (const ask of asks) {
    const carrier = runOfLaunch(board.runs, ask.launch)
    const isCarried = carrier !== undefined && (carrier.bornIn === ask.session || carrier.owner === ask.session)
    if (isCarried && !retroTakenSaid.has(ask.launch)) {
      retroTakenSaid.add(ask.launch)
      const studied = board.runs.find(r => r.id === ask.run)
      $.ui.toast(retroTakenText(neutralLine(clip(`Rétrospective · ${studied?.title ?? ''}`, 60))))
    }
    // Portée par une mission (ici ou ailleurs : le lancement est consommé), ou le repli déjà proposé : rien de plus.
    if (carrier !== undefined || retroFallbackSaid.has(ask.launch)) continue
    // Sans prise au bout du délai, le repli ; un à la fois, hors de la relecture (il attend la file des
    // clics de cartes sur le prompt). La surface pas encore connue (le mod rechargé, la vue pas encore dessinée) : il attend.
    if (now - ask.at < RETRO_CLAIM_WAIT_MS || isFillingRetroFallback || lastSurface === undefined) continue
    isFillingRetroFallback = true
    void quietly(() => offerRetroFallback($, ask)).finally(() => {
      isFillingRetroFallback = false
    })
  }
}

/**
 * Le délai sans prise au-delà duquel le COO propose le repli d'une demande de rétro : environ quatre relectures de
 * 5 s chez le manager, prise relue comprise.
 */
export const RETRO_CLAIM_WAIT_MS = 20_000

/**
 * Les lancements de rétro dont le repli a été mis dans le prompt du COO (ou dit à taper) : une fois par chargement du
 * mod (un rechargement après l'envoi peut le proposer encore : la seconde nouvelle discussion serait refusée).
 */
const retroFallbackSaid = new Set<string>()

/** Les lancements de rétro dont le repli attend qu'un brouillon quitte la saisie du COO : le toast dit une fois. */
const retroDraftSaid = new Set<string>()

/** Un repli de rétro en cours de remplissage : un à la fois, sans retenir la relecture. */
let isFillingRetroFallback = false

/**
 * Le repli d'une demande de rétro que personne n'a prise : le lancement gardé relu à l'instant, encore valable, sans
 * prise (jamais prise, ou rendue avant sa péremption) ; alors la demande de lancement d'aujourd'hui (nouvelle
 * discussion), composée d'après le lancement gardé, et au terminal précédée de la reprise de la discussion du manager
 * (`retroFallbackText`) sauf pour une demande déjà notée appliquée chez lui (rouvert, il ne la reprendrait pas), dans
 * le prompt du COO, par la file des clics de cartes. Une prise lue, un lancement absent
 * (consommé, ou gardé dans le stockage de l'autre surface) ou périmé (la carte redevient prête) : rien. La reprise
 * n'est proposée que si elle peut servir (`isRetroResumeUseful`), avec l'heure au-delà de laquelle elle ne sert plus.
 * Un brouillon dans la saisie (autre chose qu'une demande de lancement) n'est jamais remplacé : un toast le dit une
 * fois, et le repli attend les relectures suivantes.
 */
const offerRetroFallback = async ($: any, ask: CoordRetro): Promise<void> => {
  let record: LaunchRecord | null = null
  let isRead = false
  await quietly(async () => {
    record = soundRecord(await $.store.get(launchKey(ask.launch)))
    isRead = true
  })
  // Illisible : la relecture suivante réessaie.
  if (!isRead) return
  const rec = record as LaunchRecord | null
  if (!rec || rec.of !== ask.run || isRecordStale(rec, await $.clock.now())) return
  if (rec.claim !== undefined) return
  // Le repli déjà dans le prompt (un rechargement du mod depuis) : pas une seconde fois.
  const box = String((await $.prompt.read())?.text ?? '')
  if (launchIdsIn(box).includes(rec.id)) {
    retroFallbackSaid.add(ask.launch)
    return
  }
  // La demande déjà notée appliquée chez le manager (sa prise rendue ensuite : refus du moteur, mission ouverte
  // entre-temps) : rouverte, cette discussion ne la reprendrait pas ; pas de reprise (`isRetroResumeUseful`).
  // Les entrées appliquées ou le fichier des missions illisibles : pas de reprise, la demande d'aujourd'hui seule.
  // Lus seulement au terminal (dans l'app, le repli n'en dépend pas).
  const isCli = isCliHere()
  const applied = isCli ? await readApplied($, ask.run) : null
  const board: Board | null = isCli ? await read($, boardAtom) : null
  const card: LaunchCard = { id: rec.card, title: rec.title, start: rec.start, ...(rec.of !== undefined ? { of: rec.of } : {}), askMatt: '', alts: [], mode: rec.mode, modeWhy: '', effort: rec.effort, effortWhy: '', folder: rec.folder, at: rec.at }
  const plain = await missionLaunchText($, card, rec.id, rec.mode)
  const isUseful = applied !== null && board !== null && isRetroResumeUseful({ ask, runs: board.runs, here: await hereId($), applied, record: rec, now: await $.clock.now() })
  const command = isUseful ? retroResumeCommand(ask.run, ask.session) : null
  const text = command === null ? plain : retroFallbackText({ plain, command, session: ask.session, until: Math.floor(retroResumeUntil(rec) / 1000) })
  const { isFilled, isQueued, isDraft, isUnread } = await fillLaunchAsk($, rec.id, text, true)
  // Le lancement gardé ou la saisie ne se relisent pas : rien n'est dit, la relecture suivante réessaie.
  if (isUnread) return
  const shown = neutralLine(clip(rec.title, 60))
  // Un brouillon dans la saisie : gardé ; le repli attend qu'elle se vide (relectures suivantes), dit une fois.
  if (isDraft) {
    if (!retroDraftSaid.has(ask.launch)) {
      retroDraftSaid.add(ask.launch)
      $.ui.toast(`◆ La discussion du manager n’a pas pris la rétro « ${shown} » : la demande de repli attend que la saisie du COO soit vide (ton brouillon est gardé).`)
    }
    return
  }
  retroFallbackSaid.add(ask.launch)
  if (!isFilled) $.ui.toast(`▶ Demande à taper : la discussion du manager n’a pas pris la rétro « ${shown} » ; lance-la dans une nouvelle discussion (lancement ${rec.id}, valable 10 minutes depuis le clic).`)
  else $.ui.toast(`▶ La discussion du manager n’a pas pris la rétro « ${shown} » : la demande de repli ${isQueued ? 's’ajoute à celle qui attend dans le prompt' : 'est dans le prompt'}, Entrée pour la lancer (valable 10 minutes depuis le clic).`)
}

/**
 * Le texte du repli d'une demande de rétro que personne n'a prise, au terminal, quand la reprise de la discussion du
 * manager peut servir (sans elle, le repli est la demande d'aujourd'hui, `plain`, telle quelle). Au moment de l'envoi :
 * l'heure (`date +%s`) avant `until` (secondes Unix), puis une entrée de `claude agents --json --all` au `sessionId`
 * exact et sans `pid` (absente : une discussion de l'app ou une discussion interactive fermée, que rien ne dit
 * reprenable ; un `pid` : elle tourne) ; alors la commande telle quelle, et l'arrêt sur « backgrounded » pour cette
 * rétro seulement ; sinon la demande d'aujourd'hui, seulement si la reprise n'a pas eu lieu. Une demande de lancement
 * qui suit ce texte dans la saisie (un autre clic) reste à lancer.
 */
export const retroFallbackText = (o: { plain: string; command: string; session: string; until: number }): string =>
  `◆ COO : la discussion du manager de la mission étudiée n’a pas pris la demande de rétro. Ce texte a pu attendre dans le prompt : fais dans l’ordre, au moment où tu le lis, sans rien me demander.\n` +
  `1. Par le shell, lance date +%s : si le nombre affiché dépasse ${o.until}, ou ne se lit pas, ne reprends rien, passe au point 4. Sinon, lance claude agents --json --all et cherche l’entrée dont le sessionId est exactement ${o.session}. Si aucune entrée n’a ce sessionId, ou si elle a un pid (elle tourne), ne reprends rien, passe au point 4.\n` +
  `2. Sinon (l’entrée existe, sans pid), lance par le shell, au premier plan, cette commande telle quelle (tu peux seulement y ajouter --permission-mode au mode de cette discussion si tu le connais) : ${o.command}\n` +
  `3. Si elle répond « backgrounded », arrête-toi là pour cette rétro : la discussion rouverte la lance d’elle-même, ne lance pas sa nouvelle discussion. Si elle échoue, répond « Workspace not trusted » ou quoi que ce soit d’autre, passe au point 4.\n` +
  `4. Seulement si la reprise n’a pas eu lieu (heure dépassée, discussion absente de la liste ou qui tourne, ou commande qui n’a pas répondu « backgrounded ») : ${o.plain}\n` +
  `Fin de la demande de rétro : une autre demande de lancement qui la suit dans ce message en est indépendante, lance-la quand même.`

/** Le texte de `missionLaunchText`, la commande du départ déjà lue (`/<skill>` tel que ce poste le nomme). */
export const launchText = (card: LaunchCard, launch: string, mode: LaunchMode, command: string): string => {
  const title = neutralInPrompt(card.title)
  // Le titre qui entre dans la commande du shell : lettres, chiffres, espaces et ponctuation simple, rien d'autre.
  const shellTitle = shellSafeTitle(card.title)
  const firstLine = launchFirstLine(launch)
  // Les entrées de la feuille de route que cite la carte : leur fichier part avec elles, sans quoi la nouvelle discussion le cherchait.
  // Pas pour une rétro : son premier message n'a « rien d'autre », la mission close est sa demande (son titre en reprend les ids).
  const ids = card.of ? [] : cardRoadmapIds(card)
  const roadmap = ids.length > 0 ? `La carte cite ${ids.join(', ')} de la feuille de route : dans le premier message, écris à côté de ${ids.length > 1 ? 'ces entrées' : 'cette entrée'} le chemin de la feuille de route que donne ton relevé, pour que la nouvelle discussion la lise sans la chercher. ` : ''
  const xhigh =
    card.effort === 'xhigh'
      ? "Effort xhigh : si tu as start_session (l'app), demande-moi d'abord de taper /effort xhigh dans cette discussion (l'app ne donne jamais à la session un effort plus haut que le sien), attends que ce soit fait, lance, puis rappelle-moi de redescendre cette discussion en high. "
      : ''
  return (
    `${LAUNCH_ASK_START} « ${title} » dans une nouvelle discussion (je viens de cliquer « ${mode === 'auto' ? 'Lancer en auto' : 'Lancer en manuel'} » sur sa carte ; le lancement vaut 10 minutes). ` +
    (card.of
      ? `Son premier message : ${command} Rétrospective de la mission livrée « ${neutralInPrompt(card.title.replace(/^Rétrospective · /, ''))} », proposée par le COO à sa livraison (son dossier est travail/${card.folder}/), puis cette ligne telle quelle : « ${firstLine} » Rien d'autre : le tableau de bord de la nouvelle discussion lui donne la mission close et ses transcripts ; l'effort part au lancement, ci-dessous. `
      : `Son premier message : ${command} suivi du sujet de la mission en quelques phrases (ce que je t'ai demandé, dans mes mots ; son dossier est travail/${card.folder}/), puis cette ligne telle quelle : « ${firstLine} » Rien d'autre sur le mode : le tableau de bord de la nouvelle discussion le lit lui-même ; l'effort part au lancement, ci-dessous. `) +
    roadmap +
    xhigh +
    `Dans l'app (tu as l'outil start_session) : start_session avec initiation user_asked, context "fresh", effort "${card.effort}", use_worktree false, titre « ${title} ». ` +
    `Dans le CLI (pas de start_session) : par le shell, au premier plan, claude --bg -n ${shellQuote(shellTitle)} --effort ${card.effort} "<premier message>" (sans -w : elle travaille dans ce dossier ; le premier message écrit dans un fichier temporaire passé par "$(cat <fichier>)") ; ajoute --permission-mode au mode de cette discussion si tu le connais. S'il répond « Workspace not trusted », demande-moi de lancer claude une fois dans ce dossier, puis lis cette seule valeur par ${TRUST_COMMAND} (python sous Windows), jamais le fichier entier, qui peut porter des jetons. ` +
    `La nouvelle discussion tourne dans le même mode que celle-ci (app ou terminal) : l'enregistrement du lancement est dans le stockage du tableau de bord, propre à chacun. ` +
    (mode !== 'auto'
      ? ''
      : hasIntentTurn(card)
        ? `Avant de lancer, vérifie que travail/${card.folder}/demande.md existe et est commité (git log -1 -- travail/${card.folder}/demande.md ; dans un projet sans git, qu'il existe), et qu'il porte le tour d'intention de cette carte, pas celui d'une mission précédente du même dossier : le tour d'intention se recueille avant le clic. S'il manque, ne lance pas : dis-le-moi en une ligne (le tour d'intention à recueillir et à commiter, puis un nouveau clic). S'il y est, lance-la tout de suite, sans me poser d'autre question d'abord (le lancement ne vaut que 10 minutes). `
        : `Lance-la tout de suite, sans me poser d'autre question d'abord (le lancement ne vaut que 10 minutes) : ${card.of ? 'une rétro' : 'un découpage de pistes de rétro'} n'a pas de tour d'intention. `) +
    `Ensuite, ne la suis pas activement : elle paraît dans ton relevé ; ${mode === 'auto' ? 'en auto, ses questions bloquantes paraissent ici' : 'en manuel, tu me préviens quand elle m’attend'}.`
  )
}

/**
 * Le champ `launch` d'un appel, avant que son titre décide du nom : l'enregistrement de lancement relu (le même que
 * `consumeLaunch` relit), en forme, dont le titre est celui que les hooks ont relevé pour la discussion
 * (`hookTitle`, tel quel ou tel que l'app ou le terminal l'a reçu) pose la marque « discussion nommée » avec ce
 * titre : la discussion porte déjà le titre de la carte, que le lancement se consomme ou non ensuite. Titre relevé
 * différent ou inconnu, id hors forme, enregistrement absent ou lecture ratée : rien ; le premier titre de la mission
 * la nommera, une fois. Le titre n'est que comparé, jamais écrit dans un chemin ni une commande.
 */
const markFromLaunch = async ($: any, raw: unknown, session: string) => {
  if (!isLaunchId(raw) || session === '' || hookTitle === undefined) return
  let record: LaunchRecord | null = null
  await quietly(async () => {
    record = soundRecord(await $.store.get(launchKey(raw)))
  })
  const rec = record as LaunchRecord | null
  if (rec && isCardTitle(hookTitle, rec.title)) await markNamed($, session, rec.title, await $.clock.now())
}

/**
 * Le champ `launch` d'une mission lancée par le COO : l'enregistrement relu, contrôlé (forme, projet,
 * péremption, déjà porté par une mission, sa carte ou son dossier, mission créée après le clic), pris au
 * nom de cette discussion, relu 1,5 s plus tard ; puis la mission se rattache à sa carte, s'écrit, et le
 * fichier des missions se relit : une autre mission qui porte le même lancement, la même carte ou le même
 * dossier, ou une écriture ou une relecture ratée, fait marquer ce rattachement perdu (sens unique : au
 * pire les deux perdent). L'enregistrement ne s'efface qu'à la fin. Une lecture ratée avant le
 * rattachement ne consomme rien (Claude renvoie l'id) ; un refus laisse la mission en manuel et le dit.
 */
const consumeLaunch = async ($: any, raw: unknown): Promise<string> => {
  // La raison est un texte fixe d'ici (`reasons`), jamais une valeur relue.
  const refused = (fixed: string): string => `Launch: ${fixed} This mission is not attached to a launch card and stays in manual; tell the user, in these words: « ${LAUNCH_STALE} »`
  if (!isLaunchId(raw)) return 'Launch: its id is out of form, so it was not looked up and nothing was consumed: send "launch" again with the id exactly as the first message of this discussion gives it.'
  const board: Board | null = await read($, boardAtom)
  const run = board && !board.delegate ? activeRun(board) : null
  if (!run) return 'Launch: no mission is open in this discussion yet, so the launch was not consumed: send "launch" again once the skill has opened the mission (it stays valid for 10 minutes from the click).'
  if (!(await pull($))) return 'Launch: the missions file could not be read just now, so the launch was not consumed: send "launch" again in a few seconds.'
  const fresh: Board | null = await read($, boardAtom)
  const here = await hereId($)
  const now = await $.clock.now()
  const mine = fresh ? activeRun(fresh) : null
  if (!fresh || !mine || mine.id !== run.id) return 'Launch: the mission of this discussion changed meanwhile, so the launch was not consumed.'
  let record: LaunchRecord | null = null
  let isRead = false
  await quietly(async () => {
    record = soundRecord(await $.store.get(launchKey(raw)))
    isRead = true
  })
  // Une lecture ratée ne dit rien du lancement : il reste, et un nouvel appel le relira.
  if (!isRead) return RETRY_LAUNCH
  const why = consumeRefusal(record, mine, fresh.runs, normRoot(fresh.root), now)
  const reasons: Record<string, string> = {
    unknown: 'no launch of this project has this id (or it was launched from the other mode, app or terminal, whose storage differs).',
    stale: 'it is more than 10 minutes old.',
    consumed: 'another mission already took it.',
    attached: 'this mission is already attached to a launch card.',
    older: 'this mission was opened before the click on the card.',
  }
  if (why !== null) return why === 'attached' ? `Launch: ${reasons.attached} Nothing changed.` : refused(reasons[why]!)
  const rec = record as unknown as LaunchRecord
  // Pris par une autre discussion (même id reçu ailleurs) : jamais deux.
  if (rec.claim !== undefined && rec.claim.by !== here) return refused(reasons.consumed!)
  try {
    await $.store.set(launchKey(rec.id), { ...rec, claim: { by: here, at: now } })
  } catch {
    return 'Launch: the dashboard storage refused the write, so the launch was not consumed: send "launch" again in a few seconds.'
  }
  // Relu un peu après : une autre discussion qui l'a pris en même temps a écrit son nom, et la dernière marque l'emporte.
  await $.clock.sleep(LAUNCH_CLAIM_SETTLE_MS)
  let again: LaunchRecord | null = null
  let isReadAgain = false
  await quietly(async () => {
    again = soundRecord(await $.store.get(launchKey(rec.id)))
    isReadAgain = true
  })
  if (!isReadAgain) return RETRY_LAUNCH
  const kept = again as LaunchRecord | null
  if (!kept || kept.claim?.by !== here) return refused(reasons.consumed!)
  // Le fichier des missions relu une dernière fois : une mission qui porte déjà ce lancement, sa carte ou son dossier l'a pris.
  if (!(await pull($))) return RETRY_LAUNCH
  const last: Board | null = await read($, boardAtom)
  if (!last || activeRun(last)?.id !== run.id || runOfLaunch(last.runs, rec.id) || runOfCard(last.runs, rec.card, rec.folder)) return refused(reasons.consumed!)
  const attached: RunLaunch = { id: rec.id, card: rec.card, at: rec.at, folder: rec.folder, start: rec.start, mode: rec.mode, ...(rec.of ? { of: rec.of } : {}) }
  // Rattachée et écrite d'abord, l'enregistrement effacé ensuite : un rattachement raté laisse le lancement consommable.
  if (!(await commit($, b => attachLaunch(b, attached, now)))) return RETRY_LAUNCH
  // Le rattachement perdu : marqué ici (il s'écrit avec la prochaine sauvegarde, et ne se défait jamais à la fusion).
  const lose = async (): Promise<string> => {
    const isLost = (await commit($, b => loseLaunch(b, run.id, now))) !== null
    if (isLost) await saveNow($)
    return isLost ? refused(reasons.consumed!) : 'Launch: this mission could not be marked as having lost its launch; tell the user that the launch card may show it, and that its mode auto must not be switched on from the card.'
  }
  // Écrit, puis relu : deux discussions passées en même temps (un stockage pas encore relu ailleurs) se voient,
  // et chacune qui en voit une autre perd. Une écriture ou une relecture ratée perd aussi (rien n'a été vérifié).
  if (!(await saveNow($)) || !(await pull($))) return lose()
  const settled: Board | null = await read($, boardAtom)
  if (!settled || otherCarrierOf(settled.runs, attached, run.id)) return lose()
  // Le lancement en auto : le clic « Lancer en auto » du COO allume l'auto au nom de cette discussion, comme le second clic,
  // seulement encore dans ses 10 minutes (relues juste avant l'allumage).
  const auto = rec.mode !== 'auto' ? null : await lightLaunchedAuto($, run.id, rec)
  await quietly(() => $.store.delete(launchKey(rec.id)))
  const intent = `the COO gathers the intent round (the goal, the scope, what is out of scope) before the click, in travail/${rec.folder}/demande.md: read that file first when it exists, it is the user's intent (never rewrite it)`
  // Une rétro lancée par le COO : la mission close et ses transcripts, trouvés ici.
  const retro = rec.of ? await retroBrief($, settled, rec.of, settled.runs.find(r => r.id === run.id), here) : isPistesCard({ id: rec.card, start: rec.start, folder: rec.folder }) ? await pistesBrief($, settled.root, rec.card) : ''
  if (auto === 'on') return `Launch: consumed. This mission was launched by the COO and is attached to its launch card; its folder is travail/${rec.folder}/. Auto mode is ON, switched on in the name of this discussion by the user's click « Lancer en auto » on the COO's card; ${intent}.${retro}`
  if (auto !== null) return `Launch: consumed, and this mission is attached to its launch card (folder travail/${rec.folder}/), but auto mode was not switched on (${auto}): it runs in manual; tell the user, in these words: « Auto non allumé : ${auto === LAUNCH_EXPIRED ? 'le lancement a dépassé ses 10 minutes' : 'il n’a pas pu s’allumer ici'} ; allume l’auto ici si tu veux »${retro}`
  return `Launch: consumed. This mission was launched by the COO and is attached to its launch card; its folder is travail/${rec.folder}/. It runs in manual: the user follows it here, and the COO tells them when it waits for them.${retro}`
}

/**
 * Ce que la rétro lancée par le COO apprend à son rattachement : la mission close (relue du fichier des
 * missions), le titre à prendre, les transcripts de ses discussions trouvés sous le dossier des projets de
 * Claude (jamais un chemin construit d'une valeur relue), ceux qui manquent, celui de cette discussion quand elle
 * est une discussion de la mission close (`here`), et où se cochent ses pistes.
 */
const retroBrief = async ($: any, board: Board | null, of: string, run?: Run, here?: string): Promise<string> => {
  const closed = board?.runs.find(r => r.id === of)
  if (!board || !closed) return ` This mission is the retro of a delivered mission that is no longer in the missions file (id ${asciiJson(of)}): tell the user, and do the retro from what this folder holds.`
  const { found, missing, own } = retroTranscripts(closed, await projectTranscripts($, board.root ?? ''), here)
  const folder = soundRunLaunch(closed.launch)?.folder
  const reading = found.length > 0
    ? `Read its transcripts (JSON list, data): ${asciiJson(found)}. Have one read-only subagent per transcript (general-purpose, not Haiku) read it in full, compactions included, with this origin-file rule: « ${ORIGIN_FILE_RULE} », and do its retro along the steps and the seven axes of this skill, which you pass to it as you read them here; then merge their pistes, without duplicates.`
    : 'No transcript of it was found under the projects folder of Claude by its discussions\' ids: do the retro from its folder and its reports, and say in the retro what you could not read.'
  // La rétro tourne dans une discussion de la mission étudiée (celle de son manager) : son propre transcript est listé (D8).
  const ownNote =
    own !== undefined && own.length > 0
      ? ` This retro runs in a discussion of that mission: ${own.length > 1 ? 'these transcripts are' : 'this transcript is'} this very discussion's, ${asciiJson(own)}. Have it read in full by a read-only subagent all the same, from its start, compactions included: for it, this replaces the transcript note at the end of this skill (a reading up to the last compaction, the rest from your context); what this discussion still holds in context, past its compactions, does not replace that reading.`
      : ''
  const gone =
    missing.length > 0
      ? ` No transcript was found for ${missing.length} of its discussions (ids ${asciiJson(missing)}; an id that starts with local_ is an app session, whose transcript has another id): look for them through its workers' relay files, ${relayReportsPattern($, closed.id)} (<id> is the id of each one's transcript), and say in the retro what you could not find.`
      : ''
  return (
    ` This mission is the retro of the delivered mission ${neutralQuoted(closed.title)} (id ${asciiJson(of)})${folder ? `, whose tickets and decisions are in travail/${folder}/` : ''}. Name it {"fix": {"title": ${asciiJson(clip(`Rétrospective · ${closed.title}`, 70))}}}. ${reading}${ownNote}${gone}` +
    (run && isWaitlistRetro(run)
      ? ' Present the pistes of this repository as items, each deposited in the retro waitlist at your « attente » step; the user ticks those in the waitlist in « Pistes en attente » of the COO\'s Coordination view, not here, and a separate « Pistes de rétro » mission cuts them. A piste not in the waitlist (refused, or not yet applied) stays in this retro\'s own section at the COO: once the user clicks there, this dashboard puts its unticked ones in « À reprendre » and sends you the cut of its ticked ones. Never ask the user to tick or name pistes here. Once every item is deposited (each « pistes » answer says « Deposited ») and no cut was sent to you, send {"complete": true}: an item the COO has not applied yet when the mission closes also goes to « À reprendre ».'
      : ' Present the pistes of this repository as items; the user ticks them in the COO\'s Coordination view, not here: never ask them to tick or name pistes here. Once they click there, this dashboard puts the unticked ones in « À reprendre » and sends you the cut of the ticked ones.')
  )
}

/** La raison d'un allumage refusé parce que le lancement a dépassé ses 10 minutes pendant sa consommation. */
const LAUNCH_EXPIRED = 'its 10 minutes ran out during the consumption'

/**
 * Allume l'auto de la mission lancée ici, au nom de cette discussion, avec la date du clic du COO (ou de la
 * reprise d'une pause, `why`), comme le second clic « Confirmer » : la date se garde d'abord
 * (`auto-confirm:<mission>`), puis `switchOnAuto` la pose ; une date qui ne se garde pas, une écriture ratée du
 * fichier des missions, ou une mission qui n'est plus active ici, laisse l'auto éteint.
 * `isStillDue` : relu sur le board de l'écriture même (l'allumage de la vue Coordination : aucune date de l'auto
 * d'après le clic). Rend `on`, ou la raison en mots.
 */
const lightLaunchedAuto = async ($: any, runId: string, rec: { at: number }, isStillDue: (b: Board) => boolean = () => true, why?: 'resumed'): Promise<'on' | string> => {
  const here = await hereId($)
  const board: Board | null = await read($, boardAtom)
  const run = board ? activeRun(board) : null
  if (!board || !run || run.id !== runId) return 'the mission is no longer active in this discussion'
  // Relu avant de garder la date : une date de l'auto d'après le clic (un « Confirmer » dans la mission) l'emporte, sans rien écraser.
  if (!isStillDue(board)) return 'the mission changed meanwhile'
  const wasConfirmed = await confirmedAtFor($, run, here)
  const onAt = nextAutoOnAt(run, rec.at)
  if (!(await writeConfirm($, run.id, here, onAt))) return 'the dashboard storage refused to keep the date of the click'
  // Les 10 minutes relues juste avant d'allumer, après l'attente et les écritures de la consommation.
  if (isRecordStale(rec, await $.clock.now())) {
    await forgetConfirm($, runId, here)
    return LAUNCH_EXPIRED
  }
  const fx = await commit($, b => (activeRun(b)?.id === runId && isStillDue(b) ? switchOnAuto(b, here, onAt, wasConfirmed, why) : null))
  const lit = activeRun(await read($, boardAtom))
  if (!fx || lit?.id !== runId) {
    await forgetConfirm($, runId, here, false, onAt)
    return 'the mission changed meanwhile'
  }
  // Comme « Confirmer » : la mission a bougé entre la lecture et l'écriture, la date gardée suit celle qui a été posée,
  // sinon l'auto s'éteint (jamais un auto allumé sans sa date gardée ici).
  const litAt = lit.auto?.onAt
  if (litAt !== undefined && litAt !== onAt && !(await writeConfirm($, runId, here, litAt))) {
    await commit($, b => switchOffAuto(b, litAt))
    await saveNow($)
    return 'the dashboard storage refused to keep the date of the click'
  }
  // L'allumage ne s'écrit pas dans le fichier des missions (ou le fichier ne se relit pas) : l'auto s'éteint ici, jamais l'inverse.
  if (!(await saveNow($))) {
    const now = await $.clock.now()
    await afterAutoPause($, await commit($, b => (activeRun(b)?.id === runId ? stopActiveAuto(b, AUTO_STOPS.unwritten, now) : null)))
    await forgetConfirm($, runId, here, false, litAt ?? onAt)
    return 'the missions file refused the write'
  }
  // « on » seulement si l'auto envoie bien d'ici : allumé à son nom, sa date gardée ici et non coupée par une fusion.
  const final: Board | null = await read($, boardAtom)
  const finalRun = final ? activeRun(final) : null
  if (!final || !finalRun || finalRun.id !== runId || autoStateOf(finalRun, final, here, await confirmedAtFor($, finalRun, here)).kind !== 'on') {
    await forgetConfirm($, runId, here)
    return 'the mission changed meanwhile'
  }
  return 'on'
}

// ─── Allumage depuis la vue Coordination ──────────────────────────────────
//
// Le second clic chez le COO écrit l'enregistrement d'allumage (`autoOnKey`), une clé par mission ; la
// discussion de la mission le prend, le relit 1,5 s plus tard, l'efface, puis allume l'auto en son nom avec
// la date du clic gardée chez elle, comme « Confirmer » dans la mission (`lightLaunchedAuto`). Invariant en
// tête de la section de `launch.ts`. Le COO ne peut jamais allumer l'auto : seul ce clic le fait.

/** La mission dont « ⚡ Auto » a été cliqué sur sa ligne chez le COO (le premier clic), null sinon. */
let cooAutoAsk: string | null = null

/**
 * Le second clic « Confirmer » sur la ligne d'une mission chez le COO, par le seul titulaire du siège (vérifié
 * par `cooDo`) : sur le fichier des missions relu, une mission en manuel ouverte dans une discussion ; une
 * mission ouverte nulle part n'écrit rien. Un second clic remplace un enregistrement non pris, jamais un
 * enregistrement pris. Rend le toast.
 */
const requestAutoOn = async ($: any, mission: string): Promise<string> => {
  if (!isSafeId(mission)) return '◆ Rien n’est fait : ce bouton ne se lit pas ; relis la vue.'
  // Les enregistrements périmés s'effacent à chaque clic, comme au chargement.
  await quietly(() => pruneLaunches($))
  if (!(await pull($))) return `◆ Rien n’est fait : ${SEAT_UNREAD}`
  const board: Board | null = await read($, boardAtom)
  const run = board?.runs.find(r => r.id === mission && r.archivedAt === undefined)
  if (!board || !run || run.status === 'done') return '◆ Rien n’est fait : la mission n’est plus ouverte.'
  const name = neutralQuoted(run.title)
  if (isAutoOn(run)) return `◆ Rien n’est fait : l’auto de ${name} est déjà allumé.`
  if (!isOpenMission(run) || !isSafeId(run.owner)) return `◆ Rien n’est fait : ${name} n’est ouverte dans aucune discussion. Reprends-la pour l’allumer.`
  const key = autoOnKey(run.id)
  let kept: AutoOnRecord | null = null
  let isRead = false
  await quietly(async () => {
    kept = soundAutoOnRecord(await $.store.get(key))
    isRead = true
  })
  if (!isRead) return '◆ Rien n’est fait : le stockage du tableau de bord ne s’est pas lu ; reclique.'
  const now = await $.clock.now()
  const held = kept as AutoOnRecord | null
  if (held?.claim !== undefined && !isRecordStale(held, now)) return `◆ Allumage déjà en cours : ${name} l’allume d’elle-même.`
  const record: AutoOnRecord = { v: 1, id: newEntryId(now, Math.random()), run: run.id, root: normRoot(board.root), at: now, by: await hereId($), owner: run.owner }
  try {
    await $.store.set(key, record)
  } catch {
    return '◆ Rien n’est fait : le stockage du tableau de bord a refusé l’écriture ; reclique.'
  }
  // Depuis le 09/11/2026, une mission reste ouverte au nom d'une discussion fermée : elle ne l'allume que si sa discussion tourne.
  return `◆ Allumage noté : ${name} l’allume d’elle-même, dans les 10 minutes, si sa discussion est ouverte.`
}

/** Une consommation d'un enregistrement d'allumage en cours ici : la relecture suivante attend. */
let isConsumingAutoOn = false

/**
 * La discussion de la mission prend l'enregistrement d'allumage écrit chez le COO pour sa mission active, à
 * la relecture des 5 s : contrôlé (`autoOnRefusal` : la mission, le projet, cette discussion celle qui la
 * porte au clic, 10 minutes, aucune date de l'auto d'après le clic, pas pris ailleurs), pris à son nom, relu
 * 1,5 s plus tard, contrôlé de nouveau sur le fichier des missions relu, effacé, puis l'auto s'allume ici
 * avec la date du clic gardée ici. Une lecture ou une écriture ratée n'allume rien ; un effacement raté non
 * plus. Périmé ou dépassé par une date de l'auto, il s'efface sans rien allumer.
 */
const consumeAutoOn = async ($: any, board: Board) => {
  const run = board.delegate ? null : activeRun(board)
  if (isConsumingAutoOn || isResumingStuck || isRelaunching || !run) return
  isConsumingAutoOn = true
  try {
    const key = autoOnKey(run.id)
    const readRecord = async (): Promise<{ rec: AutoOnRecord | null } | null> => {
      let out: { rec: AutoOnRecord | null } | null = null
      await quietly(async () => {
        out = { rec: soundAutoOnRecord(await $.store.get(key)) }
      })
      return out
    }
    const first = await readRecord()
    // Illisible : rien ne s'allume ; absent ou hors forme : rien à prendre (un enregistrement hors forme reste, sans rien allumer).
    if (!first || !first.rec) return
    const rec = first.rec
    const here = await hereId($)
    const judge = (b: Board, r: Run, now: number) => autoOnRefusal(rec, r, activeRun(b)?.id === r.id, b.session ?? '', here, normRoot(b.root), autoDatesOf(r), now)
    const now = await $.clock.now()
    const why = judge(board, run, now)
    // Pour une autre discussion (ou une autre mission) : rien ne s'efface ici, elle le prendra, ou il périmera.
    if (why === 'other' || why === 'taken') return
    // Périmé, ou une date de l'auto d'après le clic (déjà allumé, ou coupé depuis) : il ne vaut plus rien.
    if (why !== null || isAutoOn(run)) {
      await quietly(() => $.store.delete(key))
      return
    }
    try {
      await $.store.set(key, { ...rec, claim: { by: here, at: now } })
    } catch {
      return
    }
    // Relu un peu après : une autre discussion qui l'a pris en même temps a écrit son nom, et la dernière marque l'emporte.
    await $.clock.sleep(LAUNCH_CLAIM_SETTLE_MS)
    const again = await readRecord()
    if (!again || !again.rec || again.rec.id !== rec.id || again.rec.claim?.by !== here) return
    // Le fichier des missions relu une dernière fois : la mission toujours active ici, portée par cette discussion, sans date de l'auto d'après le clic.
    if (!(await pull($))) return
    const last: Board | null = await read($, boardAtom)
    const lastRun = last ? activeRun(last) : null
    if (!last || !lastRun || lastRun.id !== rec.run || isAutoOn(lastRun) || judge(last, lastRun, await $.clock.now()) !== null) return
    // Consommé une seule fois : l'id se note dans les entrées appliquées de la mission avant tout, et un id déjà noté (une
    // copie rejouée du même clic, même après un allumage raté) n'allume rien ; une lecture ou une écriture ratée non plus.
    const applied = await readApplied($, rec.run)
    if (!applied) return
    if (applied.has(rec.id)) {
      await quietly(() => $.store.delete(key))
      return
    }
    if (!(await noteApplied($, rec.run, rec.id))) return
    // Effacé ensuite : un effacement raté n'allume rien, un allumage raté perd le clic (il se reclique).
    let isGone = false
    await quietly(async () => {
      await $.store.delete(key)
      isGone = true
    })
    if (!isGone) return
    // Allumé seulement si, au moment même de l'écriture, aucune date de l'auto ne dépasse le clic (une coupure appliquée entre-temps l'emporte).
    const out = await lightLaunchedAuto($, rec.run, rec, b => {
      const r = activeRun(b)
      return r !== null && r !== undefined && judge(b, r, rec.at) === null
    })
    // Pas allumé (la mission a bougé, la date du clic ne s'est pas gardée) : l'auto ne s'envoie pas d'ici, et l'on reclique.
    if (out !== 'on') return
    // Comme « Confirmer » : l'évaluation envoie à Claude la consigne de l'allumage, au repos tout de suite.
    autoGestureAt = await $.clock.now()
    if (!isTurnOpen) scheduleAutoTurn($, true)
  } finally {
    isConsumingAutoOn = false
  }
}

// ─── Reprise d'une pause « plus rien ne peut avancer sans toi » ───────────
//
// Invariant (validé par Mathis, l'invariant de la bascule complété de la reprise) : « L'auto d'une mission ne s'allume jamais sans un clic de Mathis,
// consommé une seule fois, par la seule discussion de cette mission, dans les 10 minutes ; une lecture ou une écriture
// ratée laisse l'auto éteint, sauf deux reprises d'elles-mêmes, dans la discussion qui l'avait allumé : celle d'une pause
// « plus rien ne peut avancer sans toi », une fois toutes ses questions bloquantes répondues, et celle d'une pause
// « discussion arrêtée », quand cette discussion est relancée sous son id dans les 24 h qui suivent la dernière activité
// de la mission. » La pause posée ici, quand l'auto
// envoyait d'ici (la date de son clic gardée ici valait « allumé à »), garde sa trace à part (`resumeKey`) ; la
// reprise se décide dans cette seule discussion, sur la trace et la pause inchangées, sans question ouverte : dans ce
// processus (ci-dessous), ou dans un nouveau à la relance (« Reprise à la relance ») ; elle efface la trace d'abord, puis allume comme un clic, avec une date gardée neuve. Tout autre arrêt
// pendant la pause change la raison (`stopAuto`) : plus de reprise. Une lecture ou une écriture ratée : pas de reprise.

/**
 * La clé de la trace d'une pause qui peut reprendre, dans le stockage de la discussion qui l'a posée ; effacée avec la
 * mission, à la reprise, et quand la reprise à la relance est refusée, rate ou est consommée (`eraseProof`).
 */
export const resumeKey = (runId: string): string => `auto-resume:${runId}`

/**
 * Garde la trace de la pause « plus rien ne peut avancer sans toi » que l'auto vient de poser ici, si elle peut
 * reprendre : « allumé à » valait la date du clic gardée ici juste avant (`confirmedBefore`), la pause est celle-là,
 * et ses questions ouvertes sont des questions de la personne (`resumableQuestions`). Une écriture ratée : pas de trace, pas de reprise.
 */
const armStuckResume = async ($: any, runId: string, confirmedBefore: number) => {
  const board: Board | null = await read($, boardAtom)
  const run = board ? activeRun(board) : null
  if (!run || run.id !== runId || autoPauseWhy(run) !== AUTO_STOPS.stuck) return
  const { onAt, offAt } = autoDatesOf(run)
  if (onAt !== confirmedBefore || offAt === undefined) return
  const questions = resumableQuestions(run)
  if (!questions) return
  const boot = await read($, bootAtom)
  if (boot === '') return
  const rec: StuckResume = { by: await hereId($), boot, onAt, offAt, questions }
  await $.store.set(resumeKey(runId), rec)
}

/** Une reprise en cours ici : la relecture suivante attend. */
let isResumingStuck = false

/**
 * Oublie la trace de reprise de la mission active ici (une lecture ratée) : la pause ne se lève plus que par deux clics.
 * Une reprise à la relance encore due pour elle est consommée aussi (sa date du clic comprise).
 */
const dropStuckResume = async ($: any, board: Board) => {
  const run = board.delegate ? null : activeRun(board)
  if (!run) return
  await quietly(() => $.store.delete(resumeKey(run.id)))
  const v = await read($, relaunchAtom)
  if (v?.kind === 'due' && v.run === run.id) {
    // Une tentative en cours (hors du verrou) n'allume plus : elle relit la génération à l'instant d'écrire.
    relaunchGen += 1
    await quietly(async () => void (await consumeProof($, v, await hereId($))))
  }
}

/**
 * La reprise d'elle-même, à la relecture des 5 s, de la mission active ici : sa trace relue, de cette discussion et
 * de ce processus, la pause inchangée et plus aucune question ouverte (`canResumeStuck`), aucune coupure (du COO ou de la vue Coordination) en
 * attente (elle passe d'abord) ; la trace s'efface, puis l'auto s'allume ici, avec une date gardée neuve, et la
 * mission dit « ⚡ Auto · repris : questions répondues ». Rien ne reprend sur une lecture ou une écriture ratée.
 * Repris, la nouvelle date est liée en mémoire à celle d'avant la pause (`resumedFrom`), pour le rappel court.
 */
const resumeStuckAuto = async ($: any, board: Board) => {
  const run = board.delegate ? null : activeRun(board)
  // Jamais en même temps qu'une consommation d'un clic du COO : les deux gardent la même date du clic.
  if (isResumingStuck || isConsumingAutoOn || isRelaunching || !run || isTurnOpen || isAutoDeciding || isApplyingRelay || isApplyingWave) return
  isResumingStuck = true
  try {
    let rec: StuckResume | null = null
    let isRead = false
    await quietly(async () => {
      rec = soundStuckResume(await $.store.get(resumeKey(run.id)))
      isRead = true
    })
    const kept = rec as StuckResume | null
    if (!isRead || !kept) return
    const here = await hereId($)
    const boot = await read($, bootAtom)
    if (boot === '' || kept.boot !== boot || !canResumeStuck(board, here, kept)) return
    // Une coupure demandée chez le COO, pas encore appliquée ici (ou un fichier de coordination illisible) : pas de reprise.
    const seen = coordSeen
    if (!seen || seen.state === 'unread') return
    const now = await $.clock.now()
    const applied = await readApplied($, run.id)
    if (!applied || pendingCutsFor(seen.entries, run.id, applied, now).length > 0) return
    // Le fichier des missions relu juste avant : la pause et les questions telles qu'elles sont partout.
    if (!(await pull($))) return void (await dropStuckResume($, board))
    const fresh: Board | null = await read($, boardAtom)
    if (!fresh || !canResumeStuck(fresh, here, kept)) return
    // Effacée d'abord : une reprise ne se fait qu'une fois ; un effacement raté ne reprend rien.
    let isGone = false
    await quietly(async () => {
      await $.store.delete(resumeKey(run.id))
      isGone = true
    })
    if (!isGone) return
    const out = await lightLaunchedAuto($, run.id, { at: now }, b => canResumeStuck(b, here, kept), 'resumed')
    if (out !== 'on') return
    // La nouvelle date du clic gardée ici, liée à celle d'avant la pause : Claude, prévenu pour celle-là, n'aura qu'un rappel court.
    const at = await confirmedAtFor($, run, here)
    if (at !== null) resumedFrom.set(run.id, { at, from: kept.onAt })
    // Repris : l'auto décide de lui-même la suite (pas un geste : la personne n'est peut-être pas là).
    if (!isTurnOpen) scheduleAutoTurn($)
  } finally {
    isResumingStuck = false
  }
}

// ─── Reprise de l'auto à la relance de sa discussion ──────────────────────
//
// Invariant : celui de la reprise à la relance, en tête de `relaunchVerdict` (model.ts). Le premier chargement d'un
// nouveau processus rend un verdict (`relaunchAtom`), avant ses propres écritures ; tant qu'il dit « reprise due », la
// reprise se tente dans le chargement, au début de chaque appel de l'outil flow et à chaque relecture des 5 s, qu'un
// tour soit ouvert ou non, une tentative à la fois. Elle n'allume que si la pause du verdict est toujours là, relue
// sur le fichier des missions juste avant, la date du clic (ou, pour une pause « plus rien ne peut avancer sans toi »,
// la trace de reprise, sans question ouverte) gardée au nom de cette discussion à la même date, aucune coupure en
// attente et le fichier de coordination lisible ; un allumage raté consomme la preuve.

/** Le verdict du chargement de ce processus : gardé dans l'état du mod (survit à /reload-plugins, perdu avec le processus). */
const relaunchAtom = atom({ plugin: 'flow-board', key: 'autoRelaunch' } as const, null)

/**
 * Les effacements de la preuve encore à refaire (refus définitif, allumage raté, reprise explicite, fin d'un processus
 * après `/clear`, pause « plus rien ne peut avancer sans toi »), un par mission, discussion, date et portée : gardés
 * dans l'état du mod, réessayés à chaque tentative et à la fin de la discussion, jamais avalés.
 */
const relaunchErasesAtom = atom({ plugin: 'flow-board', key: 'autoRelaunchErases' } as const, [] as RelaunchErase[])

/**
 * Un effacement de la preuve à refaire : la date du clic et la trace de reprise de la discussion `by` à la date `onAt`,
 * ou la seule date du clic (`isConfirmOnly`), ou la trace sauf celle du processus `keepBoot` (celle d'ici garde la
 * règle de la reprise dans un processus vivant).
 */
type RelaunchErase = { run: string; onAt: number; by: string; isConfirmOnly?: boolean; keepBoot?: string }

/** Le verdict gardé. */
type RelaunchState = RelaunchVerdict | null

/**
 * L'issue d'une tentative : `answers` (la preuve est une trace de reprise et une question reste ouverte), `notyet`
 * (une condition ne tient pas encore : rien n'est consommé), `dropped` (la pause n'est plus celle du verdict, ou pas de
 * preuve), `failed` (allumage raté ou fichier illisible : la preuve est consommée), `on` (repris).
 */
type RelaunchOutcome = 'answers' | 'notyet' | 'dropped' | 'failed' | 'on'

/** Le même verdict « reprise due » (mission, « allumé à », prise du chargement). */
const isSameDue = (a: RelaunchState, v: Extract<RelaunchVerdict, { kind: 'due' }>): boolean =>
  a?.kind === 'due' && a.run === v.run && a.onAt === v.onAt && a.claim.boot === v.claim.boot && a.claim.at === v.claim.at

/** Efface le verdict `v`, seulement s'il est encore celui gardé (une écriture d'ailleurs pendant la tentative reste). */
const dropVerdict = async ($: any, v: Extract<RelaunchVerdict, { kind: 'due' }>) => update($, relaunchAtom, cur => (isSameDue(cur, v) ? { kind: 'none' as const } : cur))

/**
 * La génération de la discussion dans ce processus : avancée à chaque fin de discussion (`/clear` compris) et à chaque
 * démarrage du mod, et quand une lecture ratée consomme la reprise hors d'une tentative (`dropStuckResume`). Une
 * tentative qui la voit changer au moment même d'écrire l'allumage n'allume rien.
 */
let relaunchGen = 0

/** Les fins de la discussion dans ce processus (`/clear` compris), seules : une pause de la relance ne se met plus en file pour une discussion finie. */
let relaunchEndGen = 0

/**
 * Une tentative de reprise à la relance en cours ici : jamais deux à la fois, ni avec une consommation du COO ou une
 * reprise d'ici ; un appel de l'outil flow qui arrive pendant elle l'attend, pour que sa réponse dise l'auto repris.
 */
let isRelaunching = false
let relaunchRunning: Promise<void> | null = null
/** Ni verdict « reprise due » ni effacement noté, vu dans ce chargement du mod : les appels suivants ne relisent rien. */
let isRelaunchQuiet = false

/** Une valeur de `$.store` relue sans cache et bornée par `sound` : illisible (`unread`), ou lue (absente ou hors forme : null). */
const readFresh = async <T,>($: any, key: string, sound: (v: unknown) => T | null): Promise<{ state: 'unread' } | { state: 'read'; value: T | null }> => {
  try {
    return { state: 'read', value: sound(await $.store.get(key)) }
  } catch {
    return { state: 'unread' }
  }
}

/** La date du clic relue sans le cache. */
const readProofFresh = ($: any, runId: string) => readFresh($, confirmKey(runId), readConfirmValue)

/** La trace de reprise d'une pause « plus rien ne peut avancer sans toi », relue. */
const readTraceFresh = ($: any, runId: string) => readFresh($, resumeKey(runId), soundStuckResume)

/**
 * Efface la preuve de la discussion `by` pour la mission, seulement à la date `onAt` (une date plus récente, un nouveau
 * clic, reste) : la date du clic et la trace de reprise ; vrai quand rien ne reste à effacer, faux quand `$.store` ne
 * s'est pas lu ou a refusé.
 */
const eraseProof = async ($: any, runId: string, by: string, onAt: number, o: Pick<RelaunchErase, 'isConfirmOnly' | 'keepBoot'> = {}): Promise<boolean> => {
  confirms.delete(runId)
  try {
    const kept = readConfirmValue(await $.store.get(confirmKey(runId)))
    if (kept !== null && kept.by === by && kept.onAt === onAt) await $.store.delete(confirmKey(runId))
    if (o.isConfirmOnly === true) return true
    const trace = soundStuckResume(await $.store.get(resumeKey(runId)))
    if (trace !== null && trace.by === by && trace.onAt === onAt && (o.keepBoot === undefined || trace.boot !== o.keepBoot)) await $.store.delete(resumeKey(runId))
    return true
  } catch {
    return false
  }
}

/** Oublie la preuve de la discussion `by` pour la mission, à la date `onAt` ; un effacement raté se note pour être refait. */
const forgetProofFor = async ($: any, runId: string, by: string, onAt: number, o: Pick<RelaunchErase, 'isConfirmOnly' | 'keepBoot'> = {}): Promise<boolean> => {
  if (await eraseProof($, runId, by, onAt, o)) return true
  isRelaunchQuiet = false
  const rec: RelaunchErase = { run: runId, onAt, by, ...(o.isConfirmOnly === true ? { isConfirmOnly: true } : {}), ...(o.keepBoot !== undefined ? { keepBoot: o.keepBoot } : {}) }
  const isSame = (x: RelaunchErase) => x.run === runId && x.by === by && x.onAt === onAt && x.isConfirmOnly === rec.isConfirmOnly && x.keepBoot === rec.keepBoot
  await update($, relaunchErasesAtom, list => [...list.filter(x => !isSame(x)), rec].slice(-50))
  return false
}

/** Refait les effacements notés ; ceux qui réussissent quittent la liste. */
const retryErases = async ($: any) => {
  const list = await read($, relaunchErasesAtom)
  for (const x of list) {
    if (await eraseProof($, x.run, x.by, x.onAt, x)) await update($, relaunchErasesAtom, cur => cur.filter(y => y !== x && JSON.stringify(y) !== JSON.stringify(x)))
  }
}

/** Consomme la preuve du verdict `v` de la discussion `by` (allumage raté, fichier illisible) : le verdict s'efface, et la preuve, ou son effacement se note. */
const consumeProof = async ($: any, v: Extract<RelaunchVerdict, { kind: 'due' }>, by: string): Promise<RelaunchOutcome> => {
  await dropVerdict($, v)
  await forgetProofFor($, v.run, by, v.onAt)
  return 'failed'
}

/**
 * Le verdict du premier chargement de ce processus, posé par `ensureBoard` une fois son board posé : refus définitif
 * (24 h passées), la preuve de cette discussion s'efface aussitôt. Pas de reprise alors que ce chargement a éteint un
 * auto allumé par cette discussion (`turnedOff`), ou qu'une preuve de cette discussion existait pour cet allumage (24 h
 * passées ; relue illisible, comptée comme là) : la pause est à dire.
 */
const setRelaunchVerdict = async ($: any, verdict: RelaunchVerdict, turnedOff: { run: string; onAt: number } | null = null) => {
  isRelaunchQuiet = false
  await update($, relaunchAtom, () => verdict)
  if (verdict.kind === 'none' && turnedOff !== null) await quietly(() => queueRelaunchNotice($, turnedOff.run, turnedOff.onAt))
  if (verdict.kind === 'none' && verdict.expired) {
    const { run, onAt } = verdict.expired
    const here = await hereId($)
    // Lue avant l'effacement, qui passe quoi qu'il arrive à la mise en file.
    await quietly(async () => {
      const proof = await readProofFresh($, run)
      const trace = await readTraceFresh($, run)
      const isHere = (x: { state: 'unread' } | { state: 'read'; value: { by: string; onAt: number } | null }) => x.state === 'unread' || (x.value !== null && x.value.by === here && x.value.onAt === onAt)
      if (isHere(proof) || isHere(trace)) await queueRelaunchNotice($, run, onAt)
    })
    await forgetProofFor($, run, here, onAt)
  }
}

// ─── La pause laissée par la relance, dite ────────────────────────────────
//
// Invariant (validé par Mathis, celui du signal « t'attend ») : « Un signal "t'attend" ne survit jamais à
// la reprise du travail de la mission, ni à sa pause, sa clôture, son archivage ou sa suppression ; une attente n'est
// notifiée qu'une fois. » Une relance qui laisse l'auto en pause le dit une fois par verdict : la notification
// « Mission <titre> : auto en pause (discussion arrêtée) » et le signal « t'attend », posé par `markWaiting` (le seul
// qui l'écrit). Mise en file pendant le chargement ou une tentative, elle part à la relecture des 5 s suivante, marquée
// « dite » avant d'être envoyée (gardée dans l'état du mod : `/reload-plugins` ne la refait pas).

/** Une pause à dire (`pending`) ou déjà dite (`sent`), pour le verdict de ce processus (`key` : processus, mission, « allumé à »). */
type RelaunchNotice = { key: string; run: string; state: 'pending' | 'sent' }

/** La pause de la relance à dire, ou dite : gardée dans l'état du mod (survit à /reload-plugins, perdue avec le processus). */
const relaunchNoticeAtom = atom({ plugin: 'flow-board', key: 'autoRelaunchNotice' } as const, null as RelaunchNotice | null)

/** Met en file la pause de la relance de la mission `run` (allumée à `onAt`) ; rien quand elle l'est déjà, ou déjà dite. */
const queueRelaunchNotice = async ($: any, run: string, onAt: number) => {
  const key = `${await read($, bootAtom)}:${run}:${onAt}`
  await update($, relaunchNoticeAtom, cur => (cur?.key === key ? cur : { key, run, state: 'pending' as const }))
}

/** La première relecture qui suit le chargement a jugé la reprise encore due (une fois par démarrage du mod). */
let isFirstRelaunchChecked = false

/** L'issue de la dernière tentative de reprise à la relance de ce démarrage du mod (null : aucune encore). */
let lastRelaunchOutcome: RelaunchOutcome | null = null

/**
 * À chaque relecture des 5 s, après la tentative de reprise : à la première qui suit le chargement, une reprise
 * encore due avec la date du clic de cette discussion à la date du verdict (relue illisible : comptée là) se met en
 * file, jamais sur une trace de reprise à cette date (la mission n'attend que des réponses) ; puis la pause en file se
 * dit, si la mission est toujours active ici, en pause « discussion arrêtée » (ou « plus rien ne peut avancer sans
 * toi », laissée par un processus tué, dont la reprise est refusée) : la notification, et le signal « t'attend » tout
 * de suite hors d'un tour (à la fin du tour sinon, comme toute pause de l'auto). Une pause d'une autre raison depuis
 * (une coupure, ou une écriture ratée pendant l'allumage, déjà notifiée par `autoNotices`) ne se redit pas. Une
 * notification non envoyée ne retient rien.
 */
const watchRelaunchPause = async ($: any) => {
  if (!isFirstRelaunchChecked) {
    const v = await read($, relaunchAtom)
    if (v?.kind === 'due' && lastRelaunchOutcome === null) return
    isFirstRelaunchChecked = true
    if (v?.kind === 'due' && v.stuck !== true && lastRelaunchOutcome !== 'answers' && lastRelaunchOutcome !== 'on') {
      const here = await hereId($)
      const trace = await readTraceFresh($, v.run)
      const proof = await readProofFresh($, v.run)
      // Une trace relue illisible : dans le doute, la mission n'attend peut-être que des réponses, rien ne se dit.
      const isTrace = trace.state === 'unread' || (trace.value !== null && trace.value.by === here && trace.value.onAt === v.onAt)
      const isClick = proof.state === 'unread' || (proof.value !== null && proof.value.by === here && proof.value.onAt === v.onAt)
      // La mémoire du mod illisible en entier (date du clic et trace) : la pause se dit (S4).
      const isUnreadable = trace.state === 'unread' && proof.state === 'unread'
      if (isUnreadable || (!isTrace && isClick)) await queueRelaunchNotice($, v.run, v.onAt)
    }
  }
  const n = await read($, relaunchNoticeAtom)
  if (n?.state !== 'pending') return
  let isMarked = false
  await update($, relaunchNoticeAtom, cur => {
    // Remis à faux à chaque passage : l'écriture peut se refaire après une version manquée.
    isMarked = false
    if (cur?.key !== n.key || cur.state !== 'pending') return cur
    isMarked = true
    return { ...cur, state: 'sent' as const }
  })
  if (!isMarked) return
  const board: Board | null = await read($, boardAtom)
  const run = board?.runs.find(r => r.id === n.run)
  // Toujours en pause par la relance, la mission active ici ; une pause d'une autre raison depuis (une coupure, une
  // écriture ratée, que `autoNotices` a déjà dite) : rien.
  const why = run ? autoPauseWhy(run) : undefined
  if (!board || !run || board.delegate || activeRun(board)?.id !== run.id || run.status !== 'active' || isAutoOn(run) || (why !== AUTO_STOPS.ended && why !== AUTO_STOPS.stuck)) return
  await notifyAll($, [relaunchPauseNotice(run)])
  if (!isTurnOpen) await quietly(() => markWaiting($, 'step', false))
}

/** Une tentative qui échoue (allumage raté, fichier illisible) : la pause se dit, puis la preuve se consomme. */
const failRelaunch = async ($: any, v: Extract<RelaunchVerdict, { kind: 'due' }>, by: string, endGen: number): Promise<RelaunchOutcome> => {
  // Pas après la fin de la discussion (ni un /clear) pendant la tentative : la discussion du verdict n'est plus là ; un
  // /reload-plugins, lui, n'empêche pas de la dire.
  // Ni après une consommation par une lecture ratée pendant la tentative (`dropStuckResume` a effacé le verdict).
  if (relaunchEndGen === endGen && isSameDue(await read($, relaunchAtom), v)) await quietly(() => queueRelaunchNotice($, v.run, v.onAt))
  return consumeProof($, v, by)
}

/**
 * Une tentative de reprise à la relance (voir l'en-tête de la section). Une condition qui ne tient pas encore (mémoire
 * du mod ou coordination illisible, coupure en attente, question encore ouverte sous une trace de reprise) ne
 * consomme rien ; une pause qui n'est plus celle du verdict l'efface ; une preuve absente, hors forme, d'une autre
 * discussion ou d'une autre date est un refus ; un allumage qui ne rend pas « on », ou un fichier des missions
 * illisible, consomme la preuve. Repris, l'auto décide de lui-même la suite, tout de suite hors d'un tour, à la fin du
 * tour sinon. Les effacements notés se refont d'abord.
 */
const tryRelaunchResume = async ($: any): Promise<void> => {
  if (relaunchRunning) return relaunchRunning
  if (isRelaunchQuiet) return
  const v = await read($, relaunchAtom)
  const erases = await read($, relaunchErasesAtom)
  if (v?.kind !== 'due' && erases.length === 0) {
    // Rien à tenter dans ce chargement du mod tant qu'aucun verdict ni effacement ne s'écrit (`setRelaunchVerdict`, `forgetProofFor`).
    if (v !== null) isRelaunchQuiet = true
    return
  }
  // Relu après les lectures, sans attente avant la prise : une consommation du COO ou un autre appel qui arrive ensuite voit le verrou.
  if (relaunchRunning) return relaunchRunning
  if (isRelaunching || isConsumingAutoOn || isResumingStuck) return
  isRelaunching = true
  const running: Promise<void> = (async () => {
    if (erases.length > 0) await retryErases($)
    const due = await read($, relaunchAtom)
    if (due?.kind === 'due') lastRelaunchOutcome = await attemptRelaunch($, due)
  })().finally(() => {
    // Relâché seulement par la tentative qui le tient (un démarrage du mod a pu le relâcher et en lancer une autre).
    if (relaunchRunning !== running) return
    isRelaunching = false
    relaunchRunning = null
  })
  relaunchRunning = running
  return running
}

/** Plus aucune question ouverte sur la mission active de `b`. */
const hasNoOpenQuestion = (b: Board): boolean => {
  const run = activeRun(b)
  return run !== null && run !== undefined && openQuestions(run).length === 0
}

/**
 * Le corps d'une tentative (`tryRelaunchResume`), sur le verdict `v` lu juste avant. La preuve : la date du clic, ou la
 * trace de reprise d'une pause « plus rien ne peut avancer sans toi » ; quand la trace est là, sa règle vaut (plus
 * aucune question ouverte), même avec la date du clic.
 */
const attemptRelaunch = async ($: any, v: Extract<RelaunchVerdict, { kind: 'due' }>): Promise<RelaunchOutcome> => {
  const gen = relaunchGen
  const endGen = relaunchEndGen
  const board: Board | null = await read($, boardAtom)
  // La discussion du verdict, gardée pour toute la tentative : un /clear pendant elle n'en fait jamais une autre.
  const here = await hereId($)
  if (!board || !relaunchStillDue(board, here, v)) return (await dropVerdict($, v), 'dropped')
  // La preuve relue sans cache ; une lecture ratée de l'une ou l'autre : on réessaie (jamais l'une à la place de l'autre).
  const proof = await readProofFresh($, v.run)
  const trace = await readTraceFresh($, v.run)
  if (proof.state === 'unread' || trace.state === 'unread') return 'notyet'
  const isTrace = trace.value !== null && trace.value.by === here && trace.value.onAt === v.onAt
  const isClick = proof.value !== null && proof.value.by === here && proof.value.onAt === v.onAt
  // Une pause « plus rien ne peut avancer sans toi » lue telle quelle au chargement : sa trace seule la prouve.
  if (!isTrace && (!isClick || v.stuck === true)) {
    // Pas de preuve alors que ce chargement a éteint l'auto allumé : la pause se dit.
    if (v.wasOn && relaunchEndGen === endGen) await quietly(() => queueRelaunchNotice($, v.run, v.onAt))
    return (await dropVerdict($, v), 'dropped')
  }
  // Une trace de reprise : la reprise attend la dernière réponse, sans rien consommer.
  if (isTrace && !hasNoOpenQuestion(board)) return 'answers'
  // Une coupure demandée pendant l'arrêt passe d'abord (la relecture des 5 s l'applique) ; un fichier de coordination illisible : on réessaie.
  const seen = await refreshCoordSeen($, board)
  if (seen.state === 'unread') return 'notyet'
  const applied = await readApplied($, v.run)
  if (!applied || pendingCutsFor(seen.entries, v.run, applied, await $.clock.now()).length > 0) return 'notyet'
  // Deux processus de la même discussion : la prise de ce chargement écrite, puis relue un peu après ; seul celui qui la tient encore allume.
  if (!(await saveNow($)) || !(await pull($))) return failRelaunch($, v, here, endGen)
  await $.clock.sleep(LAUNCH_CLAIM_SETTLE_MS)
  if (!(await pull($))) return failRelaunch($, v, here, endGen)
  const fresh: Board | null = await read($, boardAtom)
  if (!fresh || !relaunchStillDue(fresh, here, v)) return (await dropVerdict($, v), 'dropped')
  if (isTrace && !hasNoOpenQuestion(fresh)) return 'answers'
  // Pendant l'attente, la discussion a pu finir ou être vidée (`/clear` : un autre id) : le verdict relu doit être
  // encore celui-ci, la discussion la même, et sa génération aussi, relue au moment même d'écrire l'allumage.
  if (!isSameDue(await read($, relaunchAtom), v) || (await freshHereId($)) !== here || relaunchGen !== gen) return 'notyet'
  // La trace s'efface d'abord, comme pour la reprise dans un processus vivant : une reprise ne se fait qu'une fois, et
  // un effacement raté n'allume rien (on réessaie).
  if (isTrace) {
    let isGone = false
    await quietly(async () => {
      await $.store.delete(resumeKey(v.run))
      isGone = true
    })
    if (!isGone) return 'notyet'
  }
  const out = await lightLaunchedAuto($, v.run, { at: await $.clock.now() }, b => relaunchGen === gen && relaunchStillDue(b, here, v) && (!isTrace || hasNoOpenQuestion(b)), 'resumed')
  if (out !== 'on') return failRelaunch($, v, here, endGen)
  await dropVerdict($, v)
  if (!isTurnOpen) scheduleAutoTurn($)
  return 'on'
}

/** Une lecture ratée pendant la consommation : rien n'est consommé, et le lancement reste valable. */
const RETRY_LAUNCH = 'Launch: something could not be read or written just now, so the launch was not consumed: send "launch" again in a few seconds (it stays valid for 10 minutes from the click).'

/** Le skill ask-matt du plugin mattpocock-skills installé, retrouvé par le registre des plugins de Claude Code (gardé une minute). */
let askMattCache: { at: number; path: string | null } | null = null
const askMattPath = async ($: any): Promise<string | null> => {
  const now = await $.clock.now()
  if (askMattCache && now - askMattCache.at < 60_000) return askMattCache.path
  let path: string | null = null
  const home = claudeHome($)
  if (home) {
    await quietly(async () => {
      // Un chemin relu d'un fichier du poste : seulement sous le dossier des plugins de Claude, sans « .. » (`askMattCandidates`).
      for (const candidate of askMattCandidates(JSON.parse(String(await $.fs.read(`${home}/plugins/installed_plugins.json`))), home)) {
        if (path === null && (await fileExists($, candidate)) === true) path = candidate
      }
    })
  }
  askMattCache = { at: now, path }
  return path
}

/**
 * La discussion ne tourne pas à la racine du dossier principal du dépôt (un worktree, ou un sous-dossier) :
 * le fichier des missions, et donc le siège, y serait un autre. Faux hors d'un dépôt, sans racine ou sans réponse.
 */
const isOutsideProjectRoot = async ($: any, root: string): Promise<boolean> => {
  if (root === '') return false
  let repoRoot = ''
  let isAnswered = false
  await quietly(async () => {
    repoRoot = String((await $.session.repo())?.root ?? '')
    isAnswered = true
  })
  if (repoRoot !== '') return normRoot(repoRoot).toLowerCase() !== normRoot(root).toLowerCase()
  // Sans réponse du moteur : au moins un worktree se reconnaît à son `.git`, un fichier et non un dossier.
  if (isAnswered) return false
  try {
    return (await $.fs.stat(`${root.replace(/[\\/]+$/, '')}/.git`))?.kind === 'file'
  } catch {
    return false
  }
}

/** Les appels Agent pas encore rendus (clé : tool_use_id) : leur id de spécialiste n'est pas connu. */
export const agentCalls = new Set<string>()

/** Confronte les spécialistes « en cours » à ceux de la session ; une liste indisponible ne change rien. */
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

// ─── Workers de l'onglet Agents ────────────────────────────────────
//
// Le manager relève ses lancements (`start_session`, `claude --bg`) dans son registre, avec ou
// sans mission, puis lit, toutes les 5 s, les fichiers des sessions qu'il a lancées ou que sa
// mission déclare. Il ne les écrit jamais (Q7). Un fichier lu à moitié écrit est ignoré jusqu'à
// la relecture suivante.

/** Les workers vus à la dernière relecture, avec leur registre (null : pas encore lisible). */
const linkedAtom = atom({ plugin: 'flow-board', key: 'agentsLinked' } as const, [] as LinkedSession[])
/**
 * Ce qui a été lu des autres sessions, par id, avec la date du fichier : l'en-tête (premier
 * morceau) de chaque fichier récent, pour les reconnaître ; le registre entier des seuls
 * workers. Relus seulement quand la date change ; oubliés quand ils ne servent plus.
 */
export const otherHeads = new Map<string, { mtime: number; head: SessionRegistry }>()
export const otherRegistries = new Map<string, { mtime: number; reg: SessionRegistry; traces?: string }>()
/** Les jobs de `claude --bg` finis : leur `state.json` ne change plus. */
const endedJobs = new Map<string, JobInfo>()

/** Une relecture a trouvé le registre d'un worker changé : l'onglet se redessine. */
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
 * Le registre entier des workers (tous ses morceaux). Un morceau lu à moitié écrit garde
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
 * Relit les workers de cette discussion, une relecture à la fois (demandée pendant qu'une
 * autre tourne, elle la suit). Rien à lire sans mission ni lancement : pas de worker.
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
  // Un worker écrit son fichier après son lancement : les fichiers plus anciens sont d'autres sessions.
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

/** Les lancements hors de la demande déjà dits dans une réponse de l'outil, une fois chacun (`<mission>:<lancement>`). */
const offRequestTold = new Set<string>()

/**
 * Un groupe lancé ici par une commande à part, hors de la demande du mod (signalé, jamais rattaché d'après son titre) : la réponse de l'outil
 * le dit une fois par session lancée, d'après le registre d'ici et les workers de la dernière relecture.
 */
const offRequestNotice = async ($: any, run: Run): Promise<string> => {
  const self: SessionRegistry | null = await read($, registryAtom)
  let text = ''
  for (const o of offRequestLaunches(run, self?.linked ?? [], await read($, linkedAtom))) {
    const key = [run.id, o.launch].join(':')
    if (offRequestTold.has(key)) continue
    offRequestTold.add(key)
    // Un id relu hors forme n'entre dans aucune commande dictée (comme à la fermeture) : la personne l'arrête elle-même.
    const stop = isSafeId(o.launch)
      ? `stop it only with their agreement and only once it is idle (CLI: claude stop ${shellQuote(o.launch)} once claude agents --json shows it "status": "idle"; app: archive it with archive_session after the user agrees for this session)`
      : 'its session id is out of form, so no command is given for it: the user stops it themselves'
    text += ` · Group ${o.group} was launched outside its launch request (session ${isSafeId(o.launch) ? o.launch : 'id de session hors forme'}): the dashboard does not tie it to the group and does not see its work. Tell the user, and ${stop}; then relaunch the group from its launch request (« ↗ Worker »): a separate launch is not seen.`
  }
  return text
}

/** Le registre lu d'un worker, pour l'onglet ; null tant qu'il ne se lit pas. */
const linkedRegistryOf = (session: string | undefined): SessionRegistry | null => (session !== undefined ? (otherRegistries.get(session)?.reg ?? null) : null)

/**
 * Un worker vient d'être lancé (`start_session`, `claude --bg`) : son lancement va dans le
 * registre d'ici, avec un départ sur la piste du manager. Dans toute session, avec ou sans
 * mission. La relecture des workers part sans être attendue (la durée de l'outil n'en dépend pas).
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
 * d'après la phase ou le détour en cours de la mission active ici. Rien hors mission.
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

/** La mission à laquelle rattacher un spécialiste qui part : l'active ici, ou celle que sert le worker ; jamais une mission effacée (S23). */
const agentRunOf = (board: Board | null): string | undefined => {
  const run = board?.delegate?.run ?? activeRun(board)?.id
  return run !== undefined && !erasedRuns.has(run) ? run : undefined
}

/**
 * Un appel Agent, dans toute session (mission active, worker, ou aucune mission) : le
 * registre le suit, et la mission active d'ici garde ses étapes (implementers, relecteurs…).
 * Un suivi en échec ne gêne jamais l'appel.
 */
const trackAgentCall = async ($: any, e: any, next: (e: any) => Promise<any>) => {
  const key = String(e.tool_use_id)
  const startedAt = await $.clock.now()
  const isBackground = e.run_in_background !== false
  const board0: Board | null = await read($, boardAtom)
  const isRunHere = !board0?.delegate && activeRun(board0) !== null
  // Un worker relit les traces : une mission effacée ne reçoit plus ses spécialistes (S23).
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
  // Un lancement refusé (par la personne ou un hook) ou interrompu n'est pas un échec du spécialiste.
  const isCancelled = ran.deny !== undefined || (ran.isError === true && CANCELLED.test(String(ran.text ?? ran.result ?? '')))
  const record = failed ? undefined : (ran.result as { agentId?: string; resolvedModel?: string; status?: string } | undefined)
  // Un spécialiste rendu `completed` est fini, même demandé en fond : son SubagentStop est passé
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

/** Une fin de tour de spécialiste (SubagentStop, `turn.complete` avec son id), dans toute session. */
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
  // Lancé par un spécialiste : son rapport revient au lanceur sans message du fil principal ; le
  // retour se pose sur la piste du lanceur à sa première fin (essai, point 6).
  const launcher = await launcherOf($, agentId)
  if (launcher && launcher.lane !== MAIN) {
    const parentLane = ((await read($, registryAtom)) as SessionRegistry | null)?.agents.find(a => a.agentId === launcher.lane)
    if (!(parentLane?.marks ?? []).some(m => m.k === 'back' && m.to === launcher.key)) await markLane($, launcher.lane, { k: 'back', at: now, to: launcher.key })
  }
}

/**
 * Le retour d'un spécialiste au fil principal (essai, point 6) : son message (`<agent-message
 * from="<id>">`) ou sa notification (`<task-id><id></task-id>`) ; l'id du spécialiste, ou null.
 */
const returnedAgentOf = (text: string): string | null =>
  /^\s*<agent-message\s+from="([^"]+)"/.exec(text)?.[1] ?? /<task-notification>[\s\S]*?<task-id>([^<]+)<\/task-id>/.exec(text)?.[1] ?? null

/**
 * Le dernier titre de la discussion que les hooks classiques ont porté (`session_title`), dans ce processus ;
 * inconnu tant qu'aucun ne l'a porté. Jamais le titre de la mission en repli (celui du registre l'est) : seul
 * ce relevé dit le titre que la discussion porte, comparé au titre d'une carte au rattachement.
 */
let hookTitle: string | undefined

/** Le chemin du transcript de la session, tel que les hooks classiques le donnent. */
const noteTranscript = async ($: any, e: any) => {
  const transcript = typeof e?.transcript_path === 'string' ? e.transcript_path : undefined
  // Le titre de la discussion, quand le hook le porte (SessionStart, UserPromptSubmit).
  const title = typeof e?.session_title === 'string' && e.session_title.trim() !== '' ? e.session_title.trim() : undefined
  if (title !== undefined) hookTitle = title
  if (transcript === undefined && title === undefined) return
  await quietly(() => commitRegistry($, reg => withHeader(reg, { transcript, title })))
  if (needsRebuild && transcript !== undefined) await quietly(() => catchUpOwn($, true))
}

/** La clé du titre qu'une discussion doit encore prendre : à elle seule, hors du board partagé (série 5, Q2). */
export const discussionTitleKey = (session: string): string => `discussion-title:${session}`

/** L'outil de l'app qui renomme une session : Claude l'appelle lui-même, le mod ne lance pas /rename. */
const SET_TITLE_TOOL = 'mcp__ccd_session__set_session_title'

/** Le délai entre la fin d'un tour et `/rename` : le hook de fin de tour a rendu la main, le moteur est au repos. */
const RENAME_DELAY_MS = 300

/**
 * Le titre que la discussion doit prendre, posé dès la fin du tour où il est né, par `/rename` (le CLI le
 * connaît ; décision de Mathis du 02/11/2026 : tout parcours renomme la discussion dès son début) au lieu d'attendre le
 * message suivant, quand la session liste `/rename`. Pas dans l'app, où Claude a l'outil `set_session_title` et le titre attend aussi le
 * message suivant en filet. Renommée, la discussion n'a plus de titre en attente ; `/rename` refusé, le
 * message suivant le pose comme avant. Le titre perd ses fins de ligne et ses caractères de contrôle.
 */
const renameNow = async ($: any) => {
  const session = await sessionId($)
  if (session === '') return
  const key = discussionTitleKey(session)
  const pending = await $.store.get(key)
  if (typeof pending !== 'string' || pending.trim() === '') return
  // Seulement quand la session connaît /rename et dit ses outils : sinon, le message suivant pose le titre.
  const commands: readonly { name?: unknown }[] | null = await $.command.list().catch(() => null)
  if (!commands?.some(c => c.name === 'rename' && (c as { source?: unknown }).source === 'builtin')) return
  const tools: readonly { name?: unknown }[] | null = await $.tool.list().catch(() => null)
  if (tools === null || tools.some(t => t.name === SET_TITLE_TOOL)) return
  const title = plainArgs(pending)
  if (title === '') return
  await $.command.run({ command: 'rename', args: title })
  if ((await $.store.get(key)) === pending) await $.store.delete(key)
}

/**
 * Le titre que la discussion doit prendre (mission née ici, série 1 Q14) part une fois au moteur,
 * dans `sessionTitle` du prochain message ou de la reprise ; rien quand elle le porte déjà (Claude
 * l'a renommée par l'outil de l'app), ni dans un worker. Le titre en attente s'efface dans
 * tous les cas. Sans le board : `classic.SessionStart` suit `session.start` dans la même
 * milliseconde (mesuré le 28/10/2026, docs/evenements-moteur.md), trop tôt pour compter sur ce
 * qu'il charge, et un worker n'a
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
// sans index commun écrit par plusieurs sessions. Une mission passée se montre d'après les
// registres des discussions qui l'ont portée, leurs fichiers à part et celui de la mission.

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
 * Q-c : les spécialistes en échec d'une mission, dans le registre de cette discussion et dans ceux
 * de ses workers (ceux que leur fichier déclare, et ceux du relais), relus entiers.
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

/** Ce que montre une entrée du sélecteur : sa vue de manager, ses workers, son titre. */
export type HistoryShown = { key: string; title: string; self: SessionRegistry; linked: { session: LinkedSession; reg: SessionRegistry | null }[] }

/** Le sélecteur de l'onglet ; la vue de l'entrée choisie vit à côté (`historyShown`), trop grosse pour l'état. */
const historyAtom = atom({ plugin: 'flow-board', key: 'agentsHistory' } as const, [] as HistoryEntry[])
export let historyShown: HistoryShown | null = null
/** L'effacement (`erase-run.ts`) oublie la vue choisie : `historyShown` ne s'écrit que d'ici. */
export const clearHistoryShown = () => {
  historyShown = null
}

/** La vue d'une entrée passée : une mission, ou une discussion sans mission. */
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
    // Les discussions qui l'ont portée : leurs spécialistes de cette mission, ou leur fichier à part qui la reprend.
    // Ses workers ont leur pastille : ils ne se fondent pas dans le manager.
    const stored = await readRelay($, run.id)
    const relayIds = stored !== null && typeof stored === 'object' && typeof (stored as Relay).sessions === 'object' ? Object.keys((stored as Relay).sessions) : []
    const linkedIds = new Set([...heads.filter(h => h.run === run.id).map(h => h.session), ...relayIds])
    const self: SessionRegistry | null = await read($, registryAtom)
    if (self?.run === run.id) linkedIds.add(self.session)
    // Un registre en morceaux peut tenir les spécialistes de la mission ailleurs que dans son en-tête.
    const isMaybe = (h: SessionRegistry) => (h.parts ?? 1) > 1 && h.updatedAt >= run.startedAt && self !== null && isSameProject(self.root, h.root)
    const carriers = heads.filter(h => !linkedIds.has(h.session) && (h.agents.some(a => a.run === run.id) || isMaybe(h))).map(h => h.session)
    for (const id of await rebuiltIds($)) {
      if (id.startsWith('run-') || carriers.includes(id) || linkedIds.has(id)) continue
      if ((await readRebuilt($, id))?.runs?.includes(run.id)) carriers.push(id)
    }
    const regs: SessionRegistry[] = []
    // Cette discussion, quand elle l'a portée (et n'en est pas un worker) : son registre tel qu'il est maintenant.
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
 * S1, S18 et S21 : les lignes de l'ancien champ des spécialistes d'une mission vont dans le fichier
 * de la mission, puis le champ se vide dans le board (liste vide : une version d'avant qui le lirait
 * ne casse pas). Rien n'est vidé tant que la copie relue ne tient pas toutes ses lignes.
 */
const migrateRunAgents = async ($: any) => {
  const board: Board | null = await read($, boardAtom)
  const legacy = (board?.runs ?? []).filter(r => (r.agents?.length ?? 0) > 0)
  if (legacy.length === 0) return
  for (const run of legacy) {
    const rows = rowsFromRun(run)
    if (rows.length === 0) continue
    // Un fichier de la mission qui ne se relit pas n'est pas réécrit : cette mission attend.
    await updateRebuilt($, runFileId(run.id), `run:${run.id}`, before => unionRebuilt(before, { v: 1, session: `run:${run.id}`, agents: [], rows, runs: [run.id] }))
  }
  // Ce que le fichier de chaque mission tient, relu après l'écriture : seule une mission dont toutes
  // les lignes y sont perd les siennes (une fusion a pu en apporter d'autres entre-temps).
  const copied = new Map<string, Set<string>>()
  for (const run of legacy) copied.set(run.id, new Set(((await readRebuilt($, runFileId(run.id), `run:${run.id}`))?.rows ?? []).map(r => r.key)))
  await commit($, b => {
    const next = stripRunAgents(b, run => rowsFromRun(run).every(r => copied.get(run.id)?.has(r.key) === true))
    return next ? { board: next, fx: { toasts: [], openPane: false, note: 'none' as const } } : null
  })
}

/** Les missions déjà reprises depuis les transcripts (Q14), sur ce poste : une fois chacune. */
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
 * Q14 : au premier affichage de l'onglet, les missions existantes (en cours et archivées) retrouvent
 * leur frise depuis les transcripts, une fois chacune, et seulement celles d'avant la première reprise
 * sur ce poste (les suivantes sont suivies en direct). Les discussions d'une mission : celle qui la
 * tient, ses workers (relais), les registres qui la citent, les tickets passés « en cours »,
 * et celles dont le transcript contient un appel de ses anciennes lignes. Ce qui est reconstruit
 * va dans leur fichier à part (S13, S20) ; pour cette discussion, dans son propre registre. Une
 * ligne retrouvée, une fois sa copie relue, quitte le fichier de la mission (S18).
 */
const rebuildPastRuns = async ($: any) => {
  if (isRebuildingRuns || isRunsRebuildDone) return
  isRebuildingRuns = true
  try {
    const board: Board | null = await read($, boardAtom)
    const self: SessionRegistry | null = await read($, registryAtom)
    if (!board || !self) return
    // `since` : la première reprise sur ce poste ; les missions nées après sont suivies en direct.
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
    // Une mission dont l'ancien champ n'est pas encore recopié attend la migration.
    const todo = board.runs.filter(r => !done.includes(r.id) && r.startedAt <= since && (r.agents?.length ?? 0) === 0)
    if (todo.length === 0) {
      await save()
      isRunsRebuildDone = true
      return
    }
    const now = await $.clock.now()
    const heads = await readAllHeads($, self.session)
    const transcripts = await projectTranscripts($, self.root || board.root)
    // Les anciennes lignes encore sans session, de toutes les missions à reprendre : un seul passage
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
    // La piste d'une session, relue une fois pour toutes ses missions.
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
        // R3 (S31) : une discussion qui a porté la mission puis l'a rendue ne lui donne que les spécialistes de sa période.
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
      // S18 : une ligne retrouvée dans le transcript de sa session quitte le fichier de la mission.
      if (found.size > 0) {
        const isOut = await updateRebuilt($, runFileId(run.id), `run:${run.id}`, before => (before?.rows?.some(r => found.has(r.key)) ? { ...before, rows: before.rows.filter(r => !found.has(r.key)) } : null))
        if (!isOut) isComplete = false
      }
      // Une écriture refusée : la mission se reprendra à la prochaine ouverture.
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

// ─── Prix des modèles (coût estimé des spécialistes) ───────────────────────
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
// du spécialiste qui le fait (`agentId`), ou celle de la session (MAIN). Règles de l'essai du
// Frise : Réflexion du début de la requête au premier morceau de texte ou d'outil,
// Rédaction le temps d'un bloc de texte, l'appel d'outil dès que le modèle l'écrit.

/** La piste d'une boucle : celle du spécialiste, ou celle de la session (fil principal). */
const laneOfLoop = (agentId: unknown): string => (typeof agentId === 'string' && agentId !== '' ? agentId : MAIN)

/** Les appels dont le modèle a commencé l'écriture (morceau `tool`) : leur segment part de là. */
const toolWritten = new Map<string, number>()
/** Une demande d'autorisation en cours, par piste et par outil : le début de l'attente de la personne. */
const permissionAt = new Map<string, number>()
/** La durée hors autorisation de chaque appel (`classic.PostToolUse`). */
const toolDurations = new Map<string, number>()
/** Le dernier `classic.Stop` listait des tâches de fond : le repos qui suit est une attente. */
let hasBackgroundWork = false

/** Le dernier `classic.Stop` portait sa liste de tâches de fond (une version qui ne la donne pas : repli sur `$.agent.list()`). */
let hasBackgroundList = false

const isModelSegment = (s: AgentSegment): boolean => s.k === 'think' || s.k === 'write'

/** Un repère sur une piste ; un suivi raté ne gêne rien. */
const markLane = ($: any, lane: string, mark: AgentMark) => quietly(() => commitRegistry($, reg => addRegistryMark(reg, lane, mark, mark.at)))

/** La piste du lanceur d'un spécialiste (son parent, ou la session) et sa clé. */
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
      // Un spécialiste rendu `completed` dans l'appel : le lanceur l'a attendu au premier plan.
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
      // Sur le manager : les commits et les verdicts de tests, d'où qu'ils viennent.
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

/** Rend `refused` quand le nom décidé (`fx.discussionTitle`) n'a pas été posé : la réponse de l'outil le dit alors. */
const afterChange = async ($: any, fx: Effects, board: Board): Promise<'refused' | undefined> => {
  scheduleSave($)
  let named: 'refused' | undefined
  if (fx.discussionTitle !== undefined && board.session) {
    const title = fx.discussionTitle
    // Le nom décidé, revérifié dans la file des poses de la marque, qui le retient : une marque posée entre-temps (un
    // lancement, un appel parallèle) ou une lecture ratée l'emporte, et la discussion garde son nom.
    if (await claimName($, board.session, title, await $.clock.now())) await quietly(() => $.store.set(discussionTitleKey(board.session!), title))
    else named = 'refused'
  }
  for (const text of fx.toasts.slice(0, 2)) await quietly(() => $.ui.toast(text))
  if (fx.openPane) await quietly(() => openUnasked($))
  await quietly(() => syncStatus($, board))
  return named
}

/**
 * Lève les notifications du mode auto sur le poste (`$.ui.notify`), au texte fixé (`autoNotices`) :
 * un échec (pas de canal, pas de terminal, discussion qui se ferme) ne bloque rien.
 */
const notifyAll = async ($: any, texts: readonly string[]) => {
  for (const text of texts) await quietly(() => $.ui.notify(text))
}

// ─── Date du second clic, gardée à part ───────────────────────────────────
//
// Le second clic (« Confirmer ») garde sa date dans `$.store`, une entrée par mission (la discussion
// du clic, sa date, et l'id du processus qui l'a gardée), réécrite à chaque clic : l'auto n'envoie d'ici
// que si l'« allumé à » fusionné la vaut, qu'elle vient de cette discussion et de ce processus. Un
// fichier de mission seul, forgé ou rejoué, ne rallume donc rien, même avec une date restée d'avant un
// redémarrage. L'entrée s'efface dès que cette discussion voit l'auto de cette mission éteint après ce
// clic (coupure, mise de côté, clôture, archivage, rapport prêt, pause du mod), mais pas par la fin de la
// discussion (elle prouve alors l'allumage à la relance : `relaunchVerdict`). Elle s'efface aussi quand cette
// discussion reprend explicitement la mission en pause « discussion fermée » (`retakenPaused`), à la fin d'un processus
// qui l'avait gardée sous un id qu'il n'a plus (après un `/clear`), quand la reprise à la relance est refusée pour de
// bon ou rate, et à l'effacement de la mission. Si `$.store` refuse l'écriture au clic, l'auto ne s'allume pas.

/** La date du clic gardée pour une mission : la discussion du clic, son « allumé à » et le processus qui l'a gardée. */
type AutoConfirm = { by: string; onAt: number; boot: string }

const confirmKey = (runId: string): string => `auto-confirm:${runId}`

/** L'id de ce processus (`autoBoot` de l'état de la session) : gardé après /reload-plugins, neuf après un redémarrage. */
const bootAtom = atom({ plugin: 'flow-board', key: 'autoBoot' } as const, '')

/** Pose l'id de ce processus au premier chargement du mod ; un rechargement le garde. */
const ensureBoot = async ($: any): Promise<string> => {
  const kept = await read($, bootAtom)
  if (kept !== '') return kept
  const boot = `${await $.clock.now()}-${Math.random().toString(36).slice(2)}`
  await update($, bootAtom, was => (was === '' ? boot : was))
  return read($, bootAtom)
}

/** Une date du clic relue : bornée ici (un id de discussion, une date lisible, un id de processus), sinon aucune. */
const readConfirmValue = (value: unknown): AutoConfirm | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const x = value as Record<string, unknown>
  const isDate = typeof x.onAt === 'number' && Number.isFinite(x.onAt) && x.onAt >= 0
  const isId = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= 200
  return isId(x.by) && isId(x.boot) && isDate ? { by: x.by, onAt: x.onAt as number, boot: x.boot } : null
}

/** Les dates du clic lues depuis le chargement du mod, par mission (null : aucune) ; une lecture ratée ne s'y garde pas. */
const confirms = new Map<string, AutoConfirm | null>()

const readConfirm = async ($: any, runId: string): Promise<AutoConfirm | null> => {
  if (confirms.has(runId)) return confirms.get(runId)!
  try {
    const value = readConfirmValue(await $.store.get(confirmKey(runId)))
    confirms.set(runId, value)
    return value
  } catch {
    // Illisible ce coup-ci : aucune date, donc aucun envoi, et on relira.
    return null
  }
}

/** Garde la date d'un clic de cette discussion, pour ce processus ; faux quand `$.store` refuse l'écriture. */
const writeConfirm = async ($: any, runId: string, by: string, onAt: number): Promise<boolean> => {
  const value: AutoConfirm = { by, onAt, boot: await ensureBoot($) }
  try {
    await $.store.set(confirmKey(runId), value)
    confirms.set(runId, value)
    return true
  } catch {
    return false
  }
}

/**
 * Oublie la date du clic d'une mission : d'abord ici (rien n'envoie plus d'ici), puis dans `$.store`,
 * l'entrée de cette discussion, relue juste avant : celle d'une autre discussion (un nouveau clic
 * là-bas) reste, et son auto se juge là-bas ; sauf pour une mission effacée (`isErased`), dont l'entrée
 * part quelle que soit sa discussion.
 */
const forgetConfirm = async ($: any, runId: string, here: string, isErased = false, onlyAt?: number) => {
  confirms.set(runId, null)
  await quietly(async () => {
    // Une mission effacée emporte l'entrée de n'importe quelle discussion : il n'y a plus d'auto à juger.
    const kept = isErased ? null : readConfirmValue(await $.store.get(confirmKey(runId)))
    // `onlyAt` : seulement la date que cet appel a gardée ; une autre (un clic « Confirmer » arrivé entre-temps) reste, relue ensuite.
    if (onlyAt !== undefined && kept !== null && kept.onAt !== onlyAt) {
      confirms.delete(runId)
      return
    }
    if (isErased || (kept !== null && kept.by === here)) await $.store.delete(confirmKey(runId))
  })
}

/** La date du clic que cette discussion (`here`) garde pour cette mission dans ce processus, null sinon. */
const confirmedAtFor = async ($: any, run: Run, here: string): Promise<number | null> => {
  const kept = await readConfirm($, run.id)
  // Lecture seule (un dessin peut l'appeler) : l'id du processus se pose au démarrage du mod ; vide, rien ne vaut.
  const boot = await read($, bootAtom)
  return kept !== null && boot !== '' && kept.by === here && kept.boot === boot ? kept.onAt : null
}

/**
 * Les dates du clic à oublier après un changement du board : celles d'une mission dont l'auto était
 * allumé et ne l'est plus, sauf quand il s'éteint par la fin de la discussion (la raison enregistrée « discussion
 * fermée » : la date prouve l'allumage à la relance), ou qui a quitté le board (effacée) ; et celles d'une mission que
 * cette discussion vient de prendre de nouveau explicitement, son auto en pause « discussion fermée » ou « plus rien ne
 * peut avancer sans toi » (`retakenPaused`) : pour la seconde, avec la trace de reprise d'un autre processus, celle de
 * ce processus gardant la règle de la reprise dans un processus vivant (relue illisible : rien n'est effacé, et
 * l'effacement se refait plus tard). Une pause « plus rien ne peut avancer sans toi » efface la date du clic pour de bon.
 * Les traces de retrait gardées s'oublient pour tout auto éteint, la fin de la discussion comprise.
 */
const pruneConfirms = async ($: any, before: Board, after: Board) => {
  const gone = before.runs.filter(run => {
    const now = after.runs.find(r => r.id === run.id)
    return !now || (isAutoOn(run) && !isAutoOn(now))
  })
  // La prise d'une mission en pause « discussion fermée » ou « plus rien ne peut avancer sans toi » : lue seulement quand une mission de `after` en a une.
  const mayRetake = after.runs.some(r => r.status === 'active' && (autoPauseWhy(r) === AUTO_STOPS.ended || autoPauseWhy(r) === AUTO_STOPS.stuck))
  const boot = mayRetake ? await read($, bootAtom) : ''
  const retaken = mayRetake ? retakenPaused(before, after, boot).filter(id => !gone.some(r => r.id === id)) : []
  if (gone.length === 0 && retaken.length === 0) return
  // Relu sans le garder : appelée aussi pendant une fin de discussion, après que `session.end` a vidé le cache.
  const here = await freshHereId($)
  for (const run of gone) {
    const left = after.runs.find(r => r.id === run.id)
    const isErased = left === undefined
    if (isErased || autoPauseWhy(left) !== AUTO_STOPS.ended) await forgetConfirm($, run.id, here, isErased)
    // Une pause « plus rien ne peut avancer sans toi » : sa trace seule doit la prouver à la relance, et la date du
    // clic s'efface pour de bon (un effacement refusé se note et se refait).
    const onAt = autoDatesOf(run).onAt
    if (!isErased && autoPauseWhy(left) === AUTO_STOPS.stuck && onAt !== undefined) await forgetProofFor($, run.id, here, onAt, { isConfirmOnly: true })
    await forgetOwnTraces($, run.id, here, isErased)
  }
  for (const id of retaken) {
    const run = after.runs.find(r => r.id === id)!
    const onAt = autoDatesOf(run).onAt
    // « Plus rien ne peut avancer sans toi » : la date du clic à son « allumé à », et la trace d'un autre processus ;
    // celle de ce processus reste (la reprise dans le processus qui a posé la pause garde sa règle).
    if (autoPauseWhy(run) === AUTO_STOPS.stuck && onAt !== undefined) await forgetProofFor($, id, here, onAt, { keepBoot: boot })
    else if (onAt === undefined) await forgetConfirm($, id, here)
    else await forgetProofFor($, id, here, onAt)
  }
}

// ─── Traces de retrait écrites ici, gardées à part ────────────────────────
//
// Les traces « ↻ Renvoyer » et « répondue » que cette discussion écrit se gardent aussi dans `$.store`,
// une entrée par mission, avec la discussion et le processus, comme la date du clic : tant que l'auto
// d'une mission est allumé au nom de cette discussion, la date du clic gardée ici (même mis en pause par
// l'ouverture d'une autre mission), la fusion ne lui applique qu'elles (`mergeBoards`, `own`), et une
// trace forgée ou rejouée ne retire rien ici. Écrites au moment du retrait, par un changement fait ici (jamais par une fusion) ;
// effacées quand l'auto s'éteint (la fin de la discussion comprise, qui garde pourtant la date du clic) et à
// l'effacement de la mission ; un nouveau processus ne lit jamais celles d'un processus d'avant ; les 100 plus récentes de
// chaque sorte. Reconnues après /reload-plugins, pas après un redémarrage (l'auto est alors en pause
// « allumage non confirmé ici »).

/** Les traces gardées pour une mission : la discussion qui les a écrites, le processus, et les traces. */
type StoredTraces = { by: string; boot: string; traces: OwnTraces }

const tracesKey = (runId: string): string => `auto-traces:${runId}`

/** Des traces gardées relues : bornées ici (un id de discussion et de processus, des traces lisibles, 100 de chaque sorte), sinon aucune. */
const readTracesValue = (value: unknown, runId: string): StoredTraces | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const x = value as Record<string, unknown>
  const isId = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= 200
  if (!isId(x.by) || !isId(x.boot)) return null
  const list = (v: unknown) => (Array.isArray(v) ? v : []) as OwnTraces['resent'] & OwnTraces['answered']
  return { by: x.by, boot: x.boot, traces: addOwnTraces({ runId, resent: [], answered: [] }, { runId, resent: list(x.resent), answered: list(x.answered) }) }
}

/** Les traces gardées lues depuis le chargement du mod, par mission (null : aucune) ; une lecture ratée ne s'y garde pas. */
const ownTraceCache = new Map<string, StoredTraces | null>()

const readOwnTraces = async ($: any, runId: string): Promise<StoredTraces | null> => {
  if (ownTraceCache.has(runId)) return ownTraceCache.get(runId)!
  try {
    const value = readTracesValue(await $.store.get(tracesKey(runId)), runId)
    ownTraceCache.set(runId, value)
    return value
  } catch {
    // Illisibles ce coup-ci : aucune trace d'ici ne retire rien (sens sûr), et on relira.
    return null
  }
}

/**
 * Les traces que cette discussion (`here`) a écrites pour cette mission, dans ce processus ; aucune sinon.
 * Une trace datée à plus d'une minute dans le futur est ramenée à maintenant, comme celles de la mission
 * (`clampFuture`) ; la fusion ne la compte en plus jamais plus tard que la trace de la mission de même clé.
 */
const ownTracesHere = async ($: any, runId: string, here: string): Promise<OwnTraces> => {
  const kept = await readOwnTraces($, runId)
  const boot = await read($, bootAtom)
  if (kept === null || boot === '' || kept.by !== here || kept.boot !== boot) return { runId, resent: [], answered: [] }
  const now = await $.clock.now()
  const atMost = <T extends { at: number }>(t: T): T => (t.at > now + 60_000 ? { ...t, at: now } : t)
  return { runId, resent: kept.traces.resent.map(atMost), answered: kept.traces.answered.map(atMost) }
}

/**
 * Pour la fusion : les traces écrites ici, pour chaque mission dont l'auto est allumé au nom de cette
 * discussion avec la date du clic gardée ici (`isAutoLitBy`), qu'il envoie d'ici ou y reprenne sans
 * nouveau clic (mis en pause par l'ouverture d'une autre mission) ; les autres missions reçoivent
 * l'union. L'id de la discussion est relu sans le garder : la sauvegarde d'une fin de discussion passe
 * par ici, après que `session.end` a vidé le cache.
 */
const ownTracesFor = async ($: any, board: Board | null): Promise<OwnTraces[]> => {
  if (board === null || board.delegate) return []
  const here = await freshHereId($)
  const out: OwnTraces[] = []
  for (const run of board.runs) {
    const at = await confirmedAtFor($, run, here)
    // Une date du clic qui ne s'est pas lue (`readConfirm` ne garde pas l'échec) : dans le doute, allumé d'ici.
    if (isAutoLitBy(run, here, at === null && !confirms.has(run.id) ? 'unread' : at)) out.push(await ownTracesHere($, run.id, here))
  }
  return out
}

/** Les écritures et oublis des traces gardées, un à la fois et dans l'ordre. */
let tracesChain: Promise<unknown> = Promise.resolve()

const inTracesChain = async (work: () => Promise<void>) => {
  const next = tracesChain.then(work, work)
  tracesChain = next.catch(() => undefined)
  await next
}

/**
 * Garde les traces qu'un changement fait ici (une transition du board, pas une fusion) vient d'écrire
 * sur la mission active. Gardées d'abord pour ce chargement du mod : une écriture que `$.store` refuse
 * ne les perd qu'au rechargement (une copie en retard ramène alors une marque ou une question : elle
 * bloque, rien ne repart).
 */
const recordOwnTraces = async ($: any, before: Board, after: Board) => {
  const written = writtenTraces(before, after)
  if (!written || (written.resent.length === 0 && written.answered.length === 0)) return
  await inTracesChain(async () => {
    // Relu sans le garder, comme pour la fusion : jamais l'id d'avant un /clear remis dans le cache.
    const here = await freshHereId($)
    const boot = await ensureBoot($)
    const traces = addOwnTraces(await ownTracesHere($, written.runId, here), written)
    ownTraceCache.set(written.runId, { by: here, boot, traces })
    await quietly(() => $.store.set(tracesKey(written.runId), { by: here, boot, resent: traces.resent, answered: traces.answered }))
  })
}

/** Oublie les traces gardées d'une mission, comme la date du clic (`forgetConfirm`) : l'entrée de cette discussion, ou toute entrée d'une mission effacée. */
const forgetOwnTraces = async ($: any, runId: string, here: string, isErased = false) =>
  inTracesChain(async () => {
    ownTraceCache.set(runId, null)
    await quietly(async () => {
      const kept = isErased ? null : readTracesValue(await $.store.get(tracesKey(runId)), runId)
      if (isErased || (kept !== null && kept.by === here)) await $.store.delete(tracesKey(runId))
    })
  })

/** Après un changement du board : les notifications de l'auto (`isCarried` : de la seule mission portée ici) et l'oubli des dates du clic d'un auto éteint. */
const afterAuto = async ($: any, before: Board, after: Board, isCarried = false) => {
  await notifyAll($, autoNotices(isCarried ? carried(before) : before, isCarried ? carried(after) : after))
  await pruneConfirms($, before, after)
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

/** La source de flow-board dans un dépôt qui la contient (le dépôt de ce plugin), depuis sa racine. */
const MOD_SOURCE = 'plugins/flow-board'

/**
 * Le projet contient la source de flow-board (une mission qui modifie le mod) : la délégation cite
 * alors la procédure et les fichiers de méthode du dépôt, à lire dans le worktree de la session, avant
 * les chemins installés. Une session avait suivi la procédure installée, sans la section qu'un groupe
 * précédent venait d'ajouter dans le dépôt.
 */
const hasModSource = async ($: any): Promise<boolean> => {
  const root = (await read($, boardAtom))?.root || (await sessionRoot($))
  if (!root) return false
  let isThere = false
  await quietly(async () => {
    isThere = (await $.fs.exists(`${normRoot(root)}/${MOD_SOURCE}/${PROCEDURE_FILE}`)) === true
  })
  return isThere
}

/**
 * Dans le dépôt de flow-board, la phrase des deux versions quand elles diffèrent (celle du mod installé,
 * qui tourne, et celle du dépôt) ; vide quand elles sont égales ou que l'une ne se lit pas. Le worker du
 * groupe B avait suivi la procédure du dépôt, qui citait un champ que le mod installé ne connaissait pas.
 */
const modVersionsNote = async ($: any): Promise<string> => {
  const root = (await read($, boardAtom))?.root || (await sessionRoot($))
  if (!root) return ''
  const installed = await installedVersion($)
  const source = await manifestVersion($, `${normRoot(root)}/${MOD_SOURCE}/.claude-plugin/plugin.json`)
  return installed && source && installed !== source ? `flow-board installé : ${installed} ; dépôt : ${source} : le mod qui tourne est l'installé. ` : ''
}

/**
 * La procédure et ses fichiers de méthode pour un lot sans groupes, cités comme dans la délégation
 * (`delegationText`) : ceux du dépôt quand le projet contient la source de flow-board, sinon les installés.
 */
const lotProcedure = async ($: any): Promise<LotProcedure> => {
  noteReferences($)
  const isSource = await hasModSource($)
  const cite = (installed: string, file: string): string => (isSource ? `${MOD_SOURCE}/${file} of the working folder (the repository's source, which prevails; else ${installed})` : installed)
  return {
    procedure: cite(procedurePath, PROCEDURE_FILE),
    tdd: `/${await commandFor($, 'tdd')}`,
    ticketReview: `/${await commandFor($, 'code-review')}`,
    securityMethod: cite(securityMethod, SECURITY_METHOD_FILE),
    readingMethod: cite(readingMethod, READING_METHOD_FILE),
  }
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
 * Le point 4 de la demande de revue renvoyée à un worker, la revue de sécurité désactivée pour le projet
 * (réglage relu à l'écriture de la demande) : l'avis se juge et se rend, sans relecteur.
 */
const LINKED_SECURITY_OFF_FR =
  "ne lancer aucun relecteur : la revue de sécurité est désactivée pour ce projet (réglage du tableau de bord) ; l'avis se donne quand même et se note au compte rendu : « revue de sécurité désactivée pour ce projet ; le groupe touchait : <zone> »"

/** Une revue de groupe en zone sensible n'applique rien seule : la session trie les constats. */
const SENSITIVE_NO_FIX_FR = `si un ticket du groupe touche une zone sensible (${SENSITIVE_AREAS_FR}), sans --fix : la session applique elle-même les seuls constats qu'elle retient`

/** Ce qu'une passe `/code-review --fix` fait d'un conflit entre la spec et une consigne. */
const NO_ARBITRATION = "elle ne tranche pas un conflit entre la spec et une consigne (CLAUDE.md, une demande de ma part) : elle ne corrige pas ce point et me le remonte"


// ─── Consignes du mode auto ───────────────────────────────────────────────
//
// Une mission en auto (il envoie d'ici : `isAutoHere`) reçoit, à la fin de la consigne de chaque skill,
// ce que Claude fait sans la personne : un bloc commun (l'accord du second clic, les choix déclarés avec
// leur origine, la question sensible tranchée seule à sa condition, les six catégories qui restent des
// questions bloquantes, la notification), puis le bloc
// de sa phase. Hors auto, la consigne est inchangée. Les six catégories sont celles que montre le
// premier clic sur « ⚡ Auto » (`AUTO_BLOCKS` de view.tsx) ; `consignes-coherentes.test.mjs` les compare.

/**
 * Les missions dont une consigne a porté le bloc du mode auto, depuis le chargement du mod : coupé ou en
 * pause ensuite, la réponse suivante de l'outil le dit une fois, selon l'état (`autoNotOnNotice`), sinon
 * Claude suivrait encore le bloc ; une pause dite « reprend d'elle-même » qui change ensuite sans reprendre
 * est redite une fois (`resumingSaid`).
 */
const autoNoted = new Set<string>()

/**
 * Les missions dont la réponse de l'outil a dit la pause qui reprend d'elle-même (`AUTO_PAUSED_RESUMING_NOTICE`) :
 * si la pause change ensuite sans reprendre (une coupure, la trace perdue), la réponse suivante le redit une fois.
 */
const resumingSaid = new Set<string>()

/**
 * Ce que la réponse de l'outil dit quand l'auto d'une mission dont la consigne portait le bloc est éteint par un
 * geste de la personne ou la fin de la mission, ou allumé ailleurs : les règles habituelles reviennent.
 */
export const AUTO_OFF_NOTICE =
  ' · Auto mode is OFF for this mission now (cut or stopped): the auto mode block of the skill instructions no longer applies; from now on, ask the user for every validation (button question) and every tracker write, as without the auto mode.'

/**
 * La pause « plus rien ne peut avancer sans toi » qui reprendra d'elle-même ici (sa trace gardée, la pause en place) :
 * ce n'est pas un arrêt ; rien ne part, et Claude ne demande pas ce que l'auto saute.
 */
const AUTO_PAUSED_RESUMING_NOTICE =
  ' · Auto mode is PAUSED for this mission now, not stopped: nothing more can go on without the user, whose blocking questions wait. It resumes by itself here once they are all answered. Until then nothing of the auto mode is sent: go on only with what those questions do not block; ask no button question for a validation the auto mode skips, and declare no validation skipped.'

/** La même pause, plus aucune question ouverte quand l'avis part (la reprise d'elle-même n'a pas encore eu lieu) : elle suit sous peu, rien à demander d'ici là. */
const AUTO_PAUSED_ANSWERED_NOTICE =
  ' · Auto mode is PAUSED for this mission now, not stopped: its blocking questions are all answered, and it resumes by itself here shortly. Until then nothing of the auto mode is sent: ask no button question for a validation the auto mode skips, and declare no validation skipped.'

/**
 * Toute autre pause (la raison, bornée par `autoStateOf` : une de `AUTO_STOPS` ou de `AUTO_PAUSES` ; neutralisée
 * quand même, son « · » d'une pause qui nomme la suite ne devient pas une section de la réponse) : elle ne reprend
 * pas d'elle-même, et les règles habituelles reviennent d'ici là.
 */
const autoPausedNotice = (why: string): string =>
  ` · Auto mode is PAUSED for this mission now (${neutralRelayed(why)}): it does not resume by itself; the user lights it again or cuts it. Until then nothing of the auto mode is sent, and the auto mode block of the skill instructions no longer applies: ask the user for every validation (button question) and every tracker write, as without the auto mode.`

/**
 * La pause « plus rien ne peut avancer sans toi » de `run` reprendra d'elle-même ici : sa trace gardée ici relue
 * (`resumeKey`), de ce processus, et la pause toujours en place (`isStuckResumable`), questions ouvertes ou non.
 * Une lecture ratée : non (l'avis sans reprise, le sens sûr).
 */
const isResumingHere = async ($: any, board: Board, here: string, run: Run): Promise<boolean> => {
  let rec: StuckResume | null = null
  await quietly(async () => {
    rec = soundStuckResume(await $.store.get(resumeKey(run.id)))
  })
  const kept = rec as StuckResume | null
  const boot = await read($, bootAtom)
  return kept !== null && boot !== '' && kept.boot === boot && isStuckResumable(board, here, kept)
}

/**
 * L'avis de la réponse de l'outil quand l'auto de `run` n'envoie plus d'ici, selon son état : éteint ou allumé
 * ailleurs (`AUTO_OFF_NOTICE`), la pause qui reprend d'elle-même, ou une autre pause, avec sa raison.
 */
const autoNotOnNotice = async ($: any, board: Board, run: Run): Promise<{ text: string; isResuming: boolean }> => {
  const here = await hereId($)
  const view = autoStateOf(run, board, here, await confirmedAtFor($, run, here))
  if (view.kind !== 'paused') return { text: AUTO_OFF_NOTICE, isResuming: false }
  if (await isResumingHere($, board, here, run)) return { text: openQuestions(run).length > 0 ? AUTO_PAUSED_RESUMING_NOTICE : AUTO_PAUSED_ANSWERED_NOTICE, isResuming: true }
  return { text: autoPausedNotice(view.why), isResuming: false }
}

/** La mission active ici est en auto et envoie d'ici : sa consigne porte le bloc du mode auto. */
const isAutoHere = async ($: any, board: Board | null): Promise<boolean> => {
  const run = activeRun(board)
  if (run === null || board === null) return false
  const here = await hereId($)
  return autoStateOf(run, board, here, await confirmedAtFor($, run, here)).kind === 'on'
}

/** La date du clic gardée ici pour la mission active, pour le dessin ; null sans mission ni clic gardé. */
const autoConfirmedHere = async ($: any, board: Board | null): Promise<number | null> => {
  const run = activeRun(board)
  return run ? await confirmedAtFor($, run, await hereId($)) : null
}

// ─── Claude prévenu de l'allumage ─────────────────────────────────────────
//
// Invariant : aucune étape de l'auto ne part d'un allumage avant que Claude en ait reçu la consigne
// dans cette discussion ; une consigne qui ne passe pas laisse l'auto en pause, jamais en envoi.
// Claude est prévenu par la consigne d'un skill qui porte le bloc du mode auto, ou par l'avis
// « auto allumé » d'une réponse de l'outil, donné une fois par allumage. L'état vit en mémoire du mod
// seulement : après `/reload-plugins` ou un redémarrage, Claude est prévenu une fois de plus.
// La reprise d'elle-même d'une pause « plus rien ne peut avancer sans toi » est un nouvel allumage : Claude
// en est prévenu par un rappel court (`autoAgainNotice`, `autoAgainText`) au lieu du bloc entier, seulement
// quand il a reçu le bloc pour l'allumage d'avant la pause, dans ce processus, et que la discussion n'a pas
// été compactée depuis (`canRemind`) ; sinon, le bloc entier, comme pour tout allumage.

/**
 * Les missions dont Claude a reçu la consigne du mode auto : l'id de la mission, et la date du clic gardée
 * ici (`confirmedAtFor`) de l'allumage pour lequel il l'a reçue. Un nouvel allumage a une autre date :
 * Claude repart non prévenu.
 */
const briefedAt = new Map<string, number>()

/** Claude a reçu la consigne de l'allumage en cours de la mission `run` (une date du clic gardée ici, la même). */
const isBriefed = async ($: any, run: Run): Promise<boolean> => {
  const at = await confirmedAtFor($, run, await hereId($))
  return at !== null && briefedAt.get(run.id) === at
}

/**
 * L'heure (horloge du mod) où Claude a reçu le bloc entier du mode auto de chaque mission, dans ce processus, et la
 * phase en cours alors : une compaction depuis l'a peut-être résumé, une autre phase a un autre bloc, et le rappel
 * court ne suffit plus.
 */
const blockAt = new Map<string, { at: number; phase: string }>()

/**
 * Les reprises d'elles-mêmes faites ici : l'id de la mission → la date du clic gardée pour la reprise (`at`) et celle
 * de l'allumage d'avant la pause (`from`), que la trace gardait.
 */
const resumedFrom = new Map<string, { at: number; from: number }>()

/**
 * Claude vient de recevoir la consigne du mode auto de `run` : la coupure ou la pause suivante lui sera dite
 * (`autoNoted`, `autoNotOnNotice`), et il est prévenu pour l'allumage en cours, seulement s'il est
 * celui que la consigne visait (`expectedAt`, la date du clic de son envoi, quand elle est connue).
 * `isBlock` : la consigne portait le bloc entier de la phase en cours (son heure et sa phase sont gardées), pas le rappel
 * court d'une reprise ni la consigne d'un autre skill déjà prévenu.
 */
const noteBriefed = async ($: any, run: Run, expectedAt?: number, isBlock = true) => {
  autoNoted.add(run.id)
  const at = await confirmedAtFor($, run, await hereId($))
  if (at === null || (expectedAt !== undefined && at !== expectedAt)) return
  briefedAt.set(run.id, at)
  if (isBlock) blockAt.set(run.id, { at: await $.clock.now(), phase: currentPhase(run).skill })
}

/**
 * L'allumage en cours de `run` est la reprise d'elle-même faite ici d'une pause dont Claude avait reçu le bloc
 * (`briefedAt` vaut la date d'avant la pause), dans ce processus, sans compaction de la discussion depuis l'heure de
 * ce bloc, et dans la même phase (une phase passée pendant la pause a un autre bloc, que sa consigne n'a pas porté en
 * pause) : un rappel court suffit. Dans le doute (registre illisible, compaction à la même heure), non : le bloc entier.
 */
const canRemind = async ($: any, run: Run): Promise<boolean> => {
  const resumed = resumedFrom.get(run.id)
  const block = blockAt.get(run.id)
  if (!resumed || block === undefined || block.phase !== currentPhase(run).skill || !isAutoResumed(run) || briefedAt.get(run.id) !== resumed.from) return false
  const blockedAt = block.at
  if ((await confirmedAtFor($, run, await hereId($))) !== resumed.at) return false
  let compactedAt: number | null | undefined
  await quietly(async () => {
    compactedAt = lastCompactionAt(await read($, registryAtom))
  })
  return compactedAt === null || (compactedAt !== undefined && compactedAt < blockedAt)
}

/** Le rappel court d'une reprise d'elle-même : le bloc reçu avant la pause vaut de nouveau. */
const AUTO_AGAIN =
  'Auto mode is ON again for this mission: it resumed by itself here, its blocking questions all answered, in this same discussion and without a compaction since you received its instructions. The auto mode block you received before the pause applies again, as it was.'

/** Le rappel court dans la réponse de l'outil, donné en plein tour. */
const autoAgainNotice = (): string => ['', '', '---', `${AUTO_AGAIN} Go on with the current phase: never launch the next step yourself, flow-board sends it at the end of a turn once the phase is complete and nothing waits.`].join('\n')

/** Le rappel court d'une reprise d'elle-même, dans le message du mod au repos. */
const autoAgainText = (): string => [AUTO_BRIEF_HEAD, `${AUTO_AGAIN} End your turn, unless the current phase still has work for you, which you go on with: never launch the next step yourself, flow-board sends it at the end of a turn once the phase is complete and nothing waits.`].join('\n')

/** Le message de consigne en cours, soumis et pas encore revenu : l'id de la mission → la date du clic qu'il prévient. */
const briefingAt = new Map<string, number>()

/**
 * Le message de consigne refusé : l'id de la mission → la date du clic. Plus aucun message pour cet
 * allumage, même si la pause ne s'est pas écrite : un refus met en pause, il ne se réessaie pas (décision de Mathis).
 */
const refusedAt = new Map<string, number>()

/** Le message parti d'un geste et entré : l'id de la mission → la date du clic ; la décision qui suit son tour vaut geste. */
const gestureBriefAt = new Map<string, number>()

/**
 * Au repos (ou à la fin d'un tour où Claude n'a pas été prévenu), le mod envoie lui-même la consigne de
 * l'allumage en cours, sans l'attendre : un message par allumage et par processus (le bloc entier, ou le
 * rappel court d'une reprise d'elle-même quand `canRemind` le permet). Entré, Claude est
 * prévenu pour cet allumage, et la fin du tour de ce message fait décider l'auto, comme tout tour
 * répondu. Refusé, l'auto se met en pause « Claude pas prévenu » ; rien n'est marqué, rien ne part.
 * Le message se reconnaît par la date posée avant l'appel, jamais par son texte.
 */
const sendBrief = ($: any, run: Run, at: number, isGesture: boolean) => {
  if (briefingAt.get(run.id) === at || refusedAt.get(run.id) === at) return
  // Un tour ouvert depuis la décision (un message de la personne) : rien ne part derrière lui, sa fin réévalue.
  if (isTurnOpen) return
  briefingAt.set(run.id, at)
  void (async () => {
    let isEntered = false
    // Le rappel court d'une reprise d'elle-même, sinon le bloc entier (décidé avant l'envoi : c'est ce que Claude reçoit).
    // Une lecture ratée : le bloc entier (le sens sûr), jamais un refus du message.
    let isReminder = false
    await quietly(async () => {
      isReminder = await canRemind($, run)
    })
    try {
      const result = await $.prompt.submit({ text: isReminder ? autoAgainText() : autoBriefText(run) })
      // Entré : un texte rendu, sans `drop` (absent ou `undefined`, que le type permet à un message entré).
      isEntered = result !== null && typeof result === 'object' && typeof result.text === 'string' && result.drop === undefined
    } catch {
      isEntered = false
    }
    if (briefingAt.get(run.id) === at) briefingAt.delete(run.id)
    if (isEntered) {
      // Coupé ou rallumé pendant que le message attendait : il ne prévient pas l'allumage d'après.
      await noteBriefed($, run, at, !isReminder)
      // Parti d'un geste (le second clic, « ↻ Renvoyer ») : la décision qui suit son tour garde le sens
      // du geste, et ne pose pas la pause « plus rien ne peut avancer sans toi » (la personne est là).
      if (isGesture && briefedAt.get(run.id) === at) gestureBriefAt.set(run.id, at)
      return
    }
    refusedAt.set(run.id, at)
    // La pause ne vise que l'allumage que le message devait prévenir : coupé ou rallumé entre-temps, rien.
    const now = await $.clock.now()
    const isSameLighting = (await confirmedAtFor($, run, await hereId($))) === at
    if (isSameLighting) await quietly(async () => afterAutoPause($, await commit($, b => (activeRun(b)?.id === run.id ? stopActiveAuto(b, AUTO_STOPS.unbriefed, now) : null))))
  })()
}

// ─── Envoi du mode auto ───────────────────────────────────────────────────
//
// À la fin d'un tour de la discussion qui porte la mission (ni un spécialiste, ni un tour interrompu),
// l'auto relit le fichier de mission, choisit la suite (`autoDecision`), pose sa marque « envoyée »
// dans le fichier, puis l'envoie : une commande par `$.command.run` (jamais `$.prompt.submit`, que le
// moteur refuse pour un texte en « / »), hors du hook qui l'a décidé et sans l'attendre. Invariant :
// une même action auto n'est jamais envoyée deux fois. Une lecture ratée n'envoie rien et éteint
// l'auto ; une écriture ratée de la marque n'envoie rien, retire la marque et le met en pause.

/** Le délai entre la fin d'un tour et l'envoi : le hook de fin de tour a rendu la main, le moteur est au repos. */
const AUTO_SEND_DELAY_MS = 300

/** Un envoi de l'auto se décide à la fois, jamais deux en même temps. */
let isAutoDeciding = false
/** Une évaluation demandée pendant qu'une autre tournait : à refaire après elle (`gesture` : un geste l'a demandée). */
let autoAgain: 'turn' | 'gesture' | null = null
let autoTimer: { cancel: () => void } | null = null

/**
 * Un tour du fil principal est ouvert (de `turn.start` à `turn.complete`) : rien ne part pendant ce tour,
 * même quand la discussion attend la réponse à une question à boutons (`live` dit alors « waiting »).
 */
let isTurnOpen = false

/**
 * La demande de lancement d'une vague que l'auto vient de soumettre au nom du mod, gardée pour son tour :
 * l'app Desktop compte ce tour comme un événement automatique et y refuse `start_session` (« Start
 * sessions only on the user's own words to you here »). Un refus dans ce tour remet la même demande
 * dans la saisie, une fois (`isFilled`), pour que la personne la lance d'un Entrée, un tour à elle.
 * `isStarted` : le tour de la demande a commencé, reconnu à son texte (`text`, ou `turnText`, celui que
 * le moteur a fait entrer), pas au premier tour venu : un message d'une autre session ou une
 * notification peut ouvrir un tour avant elle, et le `prompt.submit` du mod attend alors sa fin. La fin
 * du tour de la demande efface l'entrée.
 */
let autoLaunch: { text: string; turnText: string; isStarted: boolean; isFilled: boolean | null; night?: { root: string; run: string; entry: CoordNight } } | null = null

/** Ce que Claude lit après un `start_session` refusé dans le tour d'une vague de l'auto. */
const refusedLaunchContext = (isFilled: boolean): string =>
  'flow-board : ce lancement n’a pas démarré. L’app Desktop refuse de lancer une session sur un tour que flow-board a envoyé lui-même (une vague du mode auto, ou une vague lancée chez le COO) : elle ne compte que les messages que la personne tape. ' +
  (isFilled
    ? 'La même demande de lancement est dans la saisie : la personne n’a qu’à appuyer sur Entrée. '
    : 'La saisie n’a pas pu être remplie : la personne relance par le bouton « ↗ Worker » du groupe. ') +
  'Ne relance rien toi-même : ni dans ce tour, ni plus tard sur un message qui ne demande pas ce lancement, et ne lui demande pas de taper un message pour cela. Dis-le-lui en une ligne, puis rends la main.'

/**
 * Un `start_session` refusé dans le tour d'une vague de l'auto : la demande gardée revient dans la
 * saisie, une fois par tour (plusieurs groupes, plusieurs refus), et Claude lit la consigne après l'erreur.
 */
const refusedLaunch = async ($: any, ran: any) => {
  const kept = autoLaunch
  if (kept === null) return ran
  // Un lancement d'un geste de nuit : l'app l'a refusé, il reste pour le matin (jamais de contournement par le shell).
  if (kept.isFilled === null && kept.night) await quietly(() => writeNightResult($, kept.night!.root, kept.night!.run, kept.night!.entry, 'refused', "refusé par l'app : pour le matin", true))
  if (kept.isFilled === null) {
    let isFilled = false
    await quietly(async () => {
      isFilled = (await $.prompt.fill({ text: kept.text, mode: 'replace' })).isFilled === true
    })
    kept.isFilled = isFilled
    await quietly(() => $.ui.toast(isFilled ? 'Lancement refusé par l’app : la demande est dans le prompt, Entrée pour la lancer' : 'Lancement refusé par l’app : relance le groupe par « ↗ Worker »'))
  }
  return { ...ran, context: [...(ran.context ?? []), refusedLaunchContext(kept.isFilled)] }
}

/**
 * L'évaluation de l'auto, un peu après la fin d'un tour, ou après un geste au repos (`isGesture` : deux
 * clics sur « ⚡ Auto », « ↻ Renvoyer ») ; un geste n'envoie que ce qui peut partir, sans poser la pause
 * « plus rien ne peut avancer sans toi » (la personne est là, et va répondre).
 */
const scheduleAutoTurn = ($: any, isGesture = false) => {
  autoTimer?.cancel()
  autoTimer = $.clock.after(AUTO_SEND_DELAY_MS, () => void quietly(() => autoTurn($, isGesture)))
}

/** Ce que l'auto choisit d'après la mission : la carte « Ensuite » du moment (GitHub, versions). */
const autoOpts = async ($: any) => {
  const sync: SyncState = await read($, syncAtom)
  // Le réglage « revue de sécurité » relu juste avant chaque décision de l'auto : une lecture ratée vaut « activée ».
  return { hasPullRequests: sync.isGitHub !== false, isVersionSet: sync.isVersionSet, security: await securityReviewNow($) }
}


/**
 * L'envoi d'une action marquée, sans l'attendre : une commande par `$.command.run`, un texte (vague,
 * revue du groupe, revue de sécurité) par `$.prompt.submit`, au nom du mod. Partie, sa marque démarre ;
 * refusée (nom inconnu, limite de l'hôte, message que le moteur n'a pas fait entrer), elle reste, et
 * devient tout de suite la question « envoi resté sans suite ». Une tenue de compte ratée après l'envoi
 * ne la fait jamais passer pour refusée.
 */
const sendAutoAction = ($: any, action: AutoAction, run: Run, text: string) => {
  void (async () => {
    let isRefused = false
    try {
      if (action.kind === 'command') {
        const command = await commandFor($, action.skill)
        await $.command.run({ command, args: commandArgsOf(run, action.skill) })
      } else {
        // Gardée avant l'envoi : `prompt.submit` rend la main avant `turn.start` du tour qu'il ouvre.
        if (action.kind === 'groups') autoLaunch = { text, turnText: text, isStarted: false, isFilled: null }
        const result = await $.prompt.submit({ text })
        // Entré : un texte rendu, sans `drop` (absent ou `undefined`, que le type permet à un message entré).
        isRefused = !(result !== null && typeof result === 'object' && typeof result.text === 'string' && result.drop === undefined)
        if (isRefused && autoLaunch?.text === text) autoLaunch = null
        else if (autoLaunch?.text === text && !autoLaunch.isStarted) autoLaunch.turnText = result.text
      }
    } catch {
      isRefused = true
      if (autoLaunch?.text === text) autoLaunch = null
    }
    const at = await $.clock.now()
    if (isRefused) await quietly(() => commit($, board => raiseStaleAutoSends(board, at, true)))
    else await quietly(() => commit($, board => markAutoStarted(board, m => m.key === action.key, at)))
  })()
}

/**
 * Le texte d'une action de l'auto, construit à l'instant de l'envoi comme le bouton l'aurait mis dans
 * le prompt : les groupes d'une vague (« ⇉ en parallèle », « ↗ Worker », en mode auto), la revue
 * d'un groupe rendu (« ◆ Revue du groupe · worker »), sa revue de sécurité (« ⛨ Revue de
 * sécurité »), l'avis de sécurité d'un lot d'un seul ticket (`lotAdviceText`). Vide pour une commande, et quand il n'y a rien à demander (rien ne part alors) ;
 * `Unsafe` quand une valeur relue du fichier partagé qu'il porterait est hors forme (l'auto se met
 * alors en pause « lecture de la mission ratée »).
 */
const autoActionText = async ($: any, run: Run, action: AutoAction): Promise<string | Unsafe> => {
  if (action.kind === 'command') return ''
  if (action.kind === 'review') return (await linkedReviewText($, run, action.group)) ?? ''
  if (action.kind === 'security') return (await securityReviewText($, run, action.group)) ?? ''
  if (action.kind === 'advice') return lotAdviceText((await securityReviewNow($)) === 'off')
  if (action.kind === 'compact') return ''
  const checked = waveCheck(run, action)
  if (!Array.isArray(checked)) return checked
  return delegationText($, run, checked, await writeDecidedFile($, await read($, boardAtom)), undefined, true)
}

/**
 * Les vues d'une vague (ses groupes qui ont un ticket ouvert), ou ce qui l'arrête, sans rien écrire : vide quand aucun
 * n'a de ticket ouvert, hors forme pour un id de mission ou de groupe que le texte refuserait (`delegationText`).
 * Le même contrôle avant la marque (`autoTurn`, rien d'écrit) et au calcul du texte, d'après la mission de la note.
 */
const waveCheck = (run: Run, action: Extract<AutoAction, { kind: 'groups' }>): GroupView[] | '' | Unsafe => {
  const plan = groupPlan(run)
  const views = plan ? plan.groups.filter(g => action.groups.includes(g.group.id) && g.open.length > 0) : []
  if (views.length === 0) return ''
  // Refusé avant d'écrire le fichier des choix : un id hors forme ne fait rien écrire.
  if (!isSafeId(run.id)) return { unsafe: 'l’id de la mission' }
  if (!views.every(v => isGroupId(v.group.id))) return { unsafe: 'l’id d’un groupe' }
  return views
}

/** Le contrôle d'une vague avant sa marque : `waveCheck`, une valeur non vide (qui ne part jamais) quand elle peut partir. */
const autoGroupsGate = (run: Run, action: Extract<AutoAction, { kind: 'groups' }>): string | Unsafe => {
  const checked = waveCheck(run, action)
  return Array.isArray(checked) ? 'ok' : checked
}

/** L'auto en pause sur une valeur relue hors forme, rien n'étant parti, et le toast qui dit laquelle. */
const pauseUnsafe = async ($: any, text: Unsafe, now: number) => {
  await afterAutoPause($, await commit($, b => stopActiveAuto(b, AUTO_STOPS.unreadable, now)))
  await quietly(() => $.ui.toast(`⚡ Auto en pause : ${text.unsafe} est hors forme dans le fichier de mission (relu, peut-être retouché) ; rien n’est parti.`))
}

/**
 * Pose la marque « envoyée » d'une action ; pour une vague, ses groupes passent « worker à
 * lancer » dans la même écriture (comme au clic sur « ↗ Worker »), pour qu'aucun ne reparte.
 */
const markAutoAction = (board: Board, action: AutoAction, now: number): Outcome => {
  if (action.kind !== 'groups') return markAutoSent(board, action, now)
  const linked = startLinkedGroups(board, action.groups, now)
  // Chacun des groupes du texte, lié par cette écriture même : un groupe lié entre-temps (un bouton) ferait deux sessions.
  const run = linked ? activeRun(linked.board) : null
  const isWhole = run !== null && action.groups.every(id => run.groups?.find(g => g.id === id)?.linked?.at === now)
  const marked = linked && isWhole ? markAutoSent(linked.board, action, now) : null
  return linked && marked ? { board: marked.board, fx: linked.fx } : null
}

/** Défait la marque d'une action qui n'est pas partie ; pour une vague, ses groupes reviennent à lancer. */
const unmarkAutoAction = async ($: any, action: AutoAction, at: number, runId: string, linkedAt: number) => {
  await commit($, b => unmarkAutoSent(b, action.key, at))
  if (action.kind === 'groups') for (const id of action.groups) await cancelNotedLink($, runId, id, linkedAt, at)
}

/**
 * Annule le lien d'un groupe que la note de `linkedAt` a posé sur la mission `runId` (« worker à lancer » redevient
 * « à lancer »), relu à l'instant d'écrire : rien quand une autre mission est devenue active, ni pour un lien d'un
 * autre envoi (une autre date), qu'un worker attend peut-être déjà. `at` date la ligne du journal.
 */
async function cancelNotedLink($: any, runId: string, id: string, linkedAt: number, at: number = linkedAt): Promise<void> {
  await commit($, b => {
    const run = activeRun(b)
    return run?.id === runId && run.groups?.find(g => g.id === id)?.linked?.at === linkedAt ? cancelLinkedGroup(b, id, at) : null
  })
}

/**
 * L'auto, à la fin d'un tour : rien hors auto ici ; sinon relire le fichier, puis, Claude pas encore
 * prévenu de l'allumage, lui envoyer la consigne et s'arrêter là ; prévenu, décider, marquer, écrire,
 * vérifier, envoyer. Une fin de tour qu'un nouveau tour a déjà suivie (un message de la personne) attend
 * la fin de celui-ci.
 */
const autoTurn = async ($: any, isGesture = false) => {
  // Une évaluation déjà en cours : celle-ci repart après elle, sur l'état d'alors (un geste n'est jamais perdu).
  if (isAutoDeciding) {
    autoAgain = autoAgain === 'gesture' || isGesture ? 'gesture' : 'turn'
    return
  }
  isAutoDeciding = true
  try {
    // Une compaction de l'auto ou une vague du COO en cours d'envoi : rien d'autre ne part (la fin de l'une relance l'auto).
    if (isTurnOpen || isAutoCompacting || isApplyingWave || isApplyingRelay) return
    if (!(await isAutoHere($, await read($, boardAtom)))) return
    // Relu juste avant : une lecture ratée éteint l'auto ici, et rien ne part, consigne comprise.
    if (!(await pull($))) return
    // Claude pas encore prévenu de cet allumage : rien ne part, ni marque, ni pause (invariant ci-dessus) ;
    // le mod lui envoie la consigne, sur la mission relue, et la fin du tour de ce message fait décider l'auto.
    const lit: Board | null = await read($, boardAtom)
    const litRun = activeRun(lit)
    if (!litRun || !(await isAutoHere($, lit))) return
    // Le fichier de coordination relu une fois, juste avant. Une coupure demandée chez le COO s'applique d'abord, avant la
    // consigne de l'allumage et toute décision : une mission reprise ici avant la relecture des 5 s ne repart pas.
    const seen = await refreshCoordSeen($, lit!)
    if (seen.state !== 'unread') {
      const applied = await readApplied($, litRun.id)
      if (!applied || (await applyCuts($, litRun.id, seen.entries, applied))) return
      if (pendingCutsFor(seen.entries, litRun.id, applied, await $.clock.now()).some(e => isCutDue(litRun, e.by === 'coo' ? AUTO_STOPS.coo : AUTO_STOPS.click, e.at))) return
    }
    if (!(await isBriefed($, litRun))) {
      const at = await confirmedAtFor($, litRun, await hereId($))
      if (at !== null) sendBrief($, litRun, at, isGesture)
      return
    }
    // Illisible (ou le plan du projet qu'il porte), l'auto ne lance rien, et reprend à la relecture réussie.
    if (seen.state === 'unread' || isPlanUnreadHere(lit)) return
    // La première décision après un message parti d'un geste vaut geste : elle n'envoie que ce qui peut partir.
    const gestureAt = gestureBriefAt.get(litRun.id)
    gestureBriefAt.delete(litRun.id)
    const isGestureNow = isGesture || (gestureAt !== undefined && gestureAt === briefedAt.get(litRun.id))
    const now = await $.clock.now()
    // Après le découpage d'une mission à groupes (ou d'une rétro), avant sa première vague : une compaction, une fois.
    if (await autoCompact($, now)) return
    const decide = async () => {
      const board: Board | null = await read($, boardAtom)
      const run = activeRun(board)
      // Les retenues entre missions, sur le fichier des missions relu juste avant : seule la branche retenue attend.
      return run && board && (await isAutoHere($, board)) ? { run, decision: autoDecision(run, await autoOpts($), hasBackgroundWork, holdMapOf(holdsHere(board))) } : null
    }
    let decided = await decide()
    if (!decided) return
    // Un groupe revenu trop de fois pour repartir seul : sa question d'abord, puis la décision, qui la voit.
    if (decided.decision.relaunch.length > 0) {
      const units = decided.decision.relaunch
      const own = (await ownTracesFor($, await read($, boardAtom))).find(o => o.runId === decided!.run.id)
      if (await commit($, b => raiseRelaunchQuestions(b, units, now, own))) decided = await decide()
      if (!decided) return
    }
    const { run, decision } = decided
    // Un geste (deux clics, « ↻ Renvoyer ») n'envoie que ce qui peut partir : la personne est là, et va répondre.
    if (decision.kind === 'stop' && !(isGestureNow && decision.why !== AUTO_STOPS.unreadable)) {
      // La date du clic gardée ici, lue avant la pause (la pause l'oublie) : la reprise d'elle-même en part.
      const confirmedBefore = decision.why === AUTO_STOPS.stuck ? await confirmedAtFor($, run, await hereId($)) : null
      const paused = await commit($, b => stopActiveAuto(b, decision.why, now))
      await afterAutoPause($, paused)
      if (paused && confirmedBefore !== null) await quietly(() => armStuckResume($, run.id, confirmedBefore))
    }
    // Une retenue que la décision explique (l'Implémentation sans ticket) : une ligne au journal, une fois.
    if (decision.kind === 'none' && decision.note !== undefined) await commit($, b => noteAutoHold(b, decision.note!, now))
    if (decision.kind !== 'send') return
    const action = decision.action
    // Le texte d'abord, sur la mission telle qu'elle est ; pour une vague, son seul contrôle ici (rien d'écrit) : son
    // texte se calcule sur la mission écrite par la note de l'envoi, plus bas.
    const text = action.kind === 'groups' ? autoGroupsGate(run, action) : await autoActionText($, run, action)
    // Une valeur relue hors forme n'entre pas dans le texte : rien ne part, l'auto se met en pause, et un toast dit laquelle.
    if (isUnsafe(text)) {
      await pauseUnsafe($, text, now)
      return
    }
    if (action.kind !== 'command' && text === '') return
    // La mission telle que la marque l'a écrite : pour une vague, avec le nom de worktree noté à l'envoi de chaque groupe.
    // Seulement sur la mission décidée, relue à l'instant d'écrire : une autre devenue active entre-temps n'est pas touchée.
    const noted = await commitRun($, run.id, b => markAutoAction(b, action, now))
    if (!noted) return
    // Le texte d'une vague, d'après cette mission-là : le brief donne le gabarit et les noms de cette note, jamais ceux
    // d'un titre lu avant elle. Hors forme ou vide : rien ne part, la marque se retire.
    // Un texte qui lève (une écriture du fichier des choix ou d'un brief) : la marque se retire et l'auto se met en pause
    // (« écriture ratée »), sans quoi chaque nouvel essai consommerait un numéro d'envoi en silence.
    let sent: string | Unsafe = text
    let isThrown = false
    if (action.kind === 'groups') {
      try {
        sent = await autoActionText($, noted, action)
      } catch {
        sent = ''
        isThrown = true
      }
    }
    if (isUnsafe(sent) || (action.kind === 'groups' && sent === '')) {
      const at = await $.clock.now()
      await unmarkAutoAction($, action, at, run.id, now)
      if (isUnsafe(sent)) await pauseUnsafe($, sent, now)
      else if (isThrown) await afterAutoPause($, await commit($, b => stopActiveAuto(b, AUTO_STOPS.unwritten, at)))
      return
    }
    // La marque est dans le fichier avant l'envoi : une reprise après un plantage ne le refait pas.
    saveTimer?.cancel()
    const isWritten = await saveNow($)
    const after: Board | null = await read($, boardAtom)
    const marked = activeRun(after)
    // Un tour ouvert entre-temps (un message de la personne) : rien ne part derrière lui, la marque se retire.
    // La marque doit avoir passé la fusion de la sauvegarde : sans elle, l'action repartirait au tour suivant.
    const isStillMarked = marked !== null && pendingAutoMarks(marked).some(m => m.key === action.key)
    // Le plan du projet relu illisible entre-temps (une relecture des 5 s) : rien ne part, la marque se retire.
    if (!isWritten || !marked || !isStillMarked || isTurnOpen || coordSeen?.state === 'unread' || isPlanUnreadHere(after) || !(await isAutoHere($, after))) {
      const at = await $.clock.now()
      await unmarkAutoAction($, action, at, run.id, now)
      if (!isWritten) await afterAutoPause($, await commit($, b => stopActiveAuto(b, AUTO_STOPS.unwritten, at)))
      return
    }
    sendAutoAction($, action, marked, sent)
  } finally {
    isAutoDeciding = false
    const again = autoAgain
    autoAgain = null
    if (again !== null) scheduleAutoTurn($, again === 'gesture')
  }
}
/**
 * La compaction stratégique d'un manager en auto : au moment où `/compact` se propose en manuel (le découpage
 * fini, aucun groupe lancé, la discussion pas compactée depuis), que l'auto ait été allumé avant ou après ce
 * découpage, le mod envoie lui-même `/compact`, une seule fois, sa marque posée et écrite
 * avant l'envoi (comme toute action de l'auto) ; les consignes du rôle s'y ajoutent (hook de compaction). La
 * fin de la compaction ne fait pas de tour : l'auto reprend quand sa promesse se résout, et lance la
 * vague. Sa marque démarre dès l'envoi, sans attendre son issue : une compaction
 * longue n'est jamais un envoi resté sans suite, que « ↻ Renvoyer » referait. Une compaction refusée ou ratée ne
 * se retente pas, et l'auto continue ; une écriture ratée de la marque met l'auto en pause, comme pour toute action.
 */
const autoCompact = async ($: any, now: number): Promise<boolean> => {
  const board: Board | null = await read($, boardAtom)
  const run = activeRun(board)
  if (!board || !run || (run.groups ?? []).length === 0) return false
  const moment = compactionMoment(run)
  if (moment === null || autoMarksOf(run).some(m => m.key === moment.key)) return false
  // L'auto allumé avant ou après ce découpage (la suggestion grisée proposée en manuel n'a pas compacté) ; pas
  // une discussion déjà compactée depuis ce découpage (à la main, ou au seuil).
  const compactedAt = lastCompactionAt(await read($, registryAtom))
  if (compactedAt !== null && compactedAt >= moment.at) return false
  const action: AutoAction = { kind: 'compact', key: moment.key, what: '/compact', blocks: { kind: 'phase', id: currentPhase(run).skill } }
  if (!(await commit($, b => markAutoSent(b, action, now)))) return false
  saveTimer?.cancel()
  const isWritten = await saveNow($)
  const after: Board | null = await read($, boardAtom)
  const marked = activeRun(after)
  if (!isWritten || !marked || !pendingAutoMarks(marked).some(m => m.key === action.key) || isTurnOpen || !(await isAutoHere($, after))) {
    await commit($, b => unmarkAutoSent(b, action.key, now))
    if (!isWritten) await afterAutoPause($, await commit($, b => stopActiveAuto(b, AUTO_STOPS.unwritten, now)))
    return true
  }
  // Rien d'autre de l'auto ne part pendant la compaction (une vague partirait dans un contexte en train d'être résumé).
  isAutoCompacting = true
  const done = quietly(() => $.command.run({ command: 'compact', args: '' }))
  // Démarrée dès l'envoi : jamais « restée sans suite », donc jamais renvoyée pendant qu'elle tourne.
  await quietly(() => commit($, b => markAutoStarted(b, m => m.key === action.key, now)))
  void (async () => {
    await done
    isAutoCompacting = false
    // Pas de tour après une compaction : l'auto reprend ici, et lance la première vague.
    scheduleAutoTurn($)
  })()
  return true
}

/** Une compaction envoyée par l'auto tourne : l'auto ne décide rien d'autre jusqu'à sa fin. */
let isAutoCompacting = false

// ─── Compaction du COO ────────────────────────────────────────────────────

/** Une compaction du COO ne se retente pas avant ce délai. */
const COO_COMPACT_RETRY_MS = 30 * 60_000

/** Une vérification de la compaction du COO en cours (la relecture des 5 s et un message peuvent se croiser). */
let isCooCompactChecking = false

/** La dernière réponse de cette discussion pose une question à la personne (`answerAwaitsPerson`) : elle attend sa réponse. */
let isAnswerAsking = false

/** La date de la dernière compaction du COO lancée par le mod, gardée dans `$.store` (un rechargement ne l'efface pas). */
const cooCompactKey = (session: string): string => `coo-compact:${session}`

/**
 * Le COO se compacte lui-même : la discussion tient le siège, Claude est au repos, aucune question (la sienne,
 * une question de sa dernière réponse (`answerAwaitsPerson`), ou celle d'une mission) ni mission n'attend la personne, aucun lancement (carte, vague) ni livraison n'est en cours, et son contexte dépasse
 * `COO_COMPACT_TOKENS` (450 000 tokens) ; jamais deux fois en 30 minutes. Les consignes du rôle COO s'y ajoutent (hook de compaction).
 */
const watchCooCompaction = async ($: any, board: Board) => {
  if (isCooCompactChecking) return
  isCooCompactChecking = true
  try {
    await cooCompactIfDue($, board)
  } finally {
    isCooCompactChecking = false
  }
}

const cooCompactIfDue = async ($: any, board: Board) => {
  const now = await $.clock.now()
  const here = await hereId($)
  if (isTurnOpen || isAnswerAsking || board.delegate || activeRun(board) || !isSafeId(here) || seatState(board.coo, here, now) !== 'mine') return
  const last = await $.store.get(cooCompactKey(here))
  if (typeof last === 'number' && now - last < COO_COMPACT_RETRY_MS) return
  const usage = await $.session.usage()
  const tokens = usage?.context?.tokens
  if (typeof tokens !== 'number' || tokens <= COO_COMPACT_TOKENS) return
  const statement = cooStatement(board, { now, forces: id => forcesFor(coordLive, id), plans: id => planWaitsOf(coordLive, id) })
  if (statement.waits.length + statement.waiting.length > 0) return
  // La liste des cartes ne se lit pas : un lancement peut être en cours, pas de compaction.
  const cardsRead = await readCards($)
  if (cardsRead.state === 'unread') return
  if (cardsRead.cards.some(c => cardStateOf(c, board.runs, now).kind === 'launching') || cooWaveOf(board, now).isLaunching) return
  // Une livraison en cours (une mission ouverte dans sa phase « Version et push ») : pas maintenant.
  if (board.runs.some(r => r.archivedAt === undefined && r.status === 'active' && currentPhase(r).skill === 'project:version')) return
  if (isTurnOpen) return
  // Posée avant l'envoi : un rechargement ou une relecture pendant la compaction ne la relance pas.
  await $.store.set(cooCompactKey(here), now)
  void quietly(() => $.command.run({ command: 'compact', args: '' }))
}

// ─── Compaction d'un worker entre deux tickets ────────────────────────────
//
// Un ticket du groupe passe « done » (revue rendue, correctifs commités) quand le contexte du worker dépasse
// 450 000 tokens, aucun autre ticket commencé : la réponse de l'outil lui dit de finir son tour avant le ticket
// suivant ; au repos (tour fermé, aucune revue ni tâche de fond, aucun ticket « doing »), le mod pose sa marque
// dans `$.store`, compacte une fois (`$.session.compact`, qui refuse pendant un tour), puis relance le worker.
// En manuel comme en auto. Invariant : une même action n'est jamais envoyée deux fois, et jamais pendant un
// ticket en cours ni pendant une revue qui tourne.

/**
 * Le ticket clos qui attend la compaction de ce worker, annoncée à Claude (`at` : depuis quand elle attend un repos
 * libre ; `isCompacted` : déjà faite, la relance seule reste à envoyer) ; null sans annonce.
 */
let workerCompactAsk: { run: string; ticket: string; at?: number; isCompacted?: boolean } | null = null

/** Une compaction annoncée qui attend encore une tâche de fond au-delà de ce délai y renonce, et le worker est relancé. */
const WORKER_COMPACT_WAIT_MS = 10 * 60_000

/** Une attente (tâche de fond) se revérifie à ce rythme : aucune fin de tour ne viendra si le worker s'est arrêté. */
const WORKER_COMPACT_RECHECK_MS = 60_000

/** Une vérification au repos en cours (compaction comprise) : deux fins de tour rapprochées n'en lancent qu'une. */
let isWorkerCompactChecking = false

/** Une compaction de worker qui ne rend jamais la main est abandonnée au bout de ce délai, et le worker relancé. */
const WORKER_COMPACT_TIMEOUT_MS = 15 * 60_000

/** La marque d'une compaction de worker : une par session, mission et ticket clos, posée avant l'envoi. */
const workerCompactKey = (session: string, run: string, ticket: string): string => `worker-compact:${session}:${run}:${ticket}`

/** La marque relue : vraie aussi quand elle ne se lit pas (dans le doute, le ticket compte déjà compacté). */
const isWorkerCompactMarked = async ($: any, session: string, run: string, ticket: string): Promise<boolean> => {
  try {
    return (await $.store.get(workerCompactKey(session, run, ticket))) !== undefined
  } catch {
    return true
  }
}

/** Le remplissage du contexte de la discussion, en tokens ; undefined quand il ne se lit pas (avant la première réponse). */
const contextTokens = async ($: any): Promise<number | undefined> => {
  let tokens: unknown
  await quietly(async () => {
    tokens = (await $.session.usage())?.context?.tokens
  })
  return typeof tokens === 'number' ? tokens : undefined
}

/** La mission du worker : dans le board d'ici, sinon dans celui du dépôt principal (un worker tourne dans un worktree). */
const workerMission = async ($: any, board: Board, run: string): Promise<Run | undefined> =>
  board.runs.find(r => r.id === run) ?? (await mainRepoRun($, run, board.root))

/**
 * Le ticket suivant du groupe : le premier de ses tickets qui peut commencer, ni fait ni bloqué (dans la mission ou
 * au relais de la session), et dont chaque ticket attendu (`blockedBy`) est fait.
 */
const nextGroupTicket = (mission: Run | undefined, group: string, relayed: Record<string, { status: string }>, done: string): string | undefined => {
  const isDone = (id: string) => id === done || relayed[id]?.status === 'done' || mission?.tickets.find(t => t.id === id)?.status === 'done'
  const isBlocked = (id: string) => relayed[id]?.status === 'blocked' || mission?.tickets.find(t => t.id === id)?.status === 'blocked'
  return (mission?.groups?.find(g => g.id === group)?.tickets ?? []).find(
    id => isSafeId(id) && !isDone(id) && !isBlocked(id) && (mission?.tickets.find(t => t.id === id)?.blockedBy ?? []).every(isDone),
  )
}

/**
 * Des tickets viennent de passer « done » au relais (`ids`, pas ceux qui l'étaient déjà), dans le fil principal
 * d'un worker de groupe : au-delà du seuil, le dernier sûr et pas encore compacté s'annonce, si aucun autre
 * ticket n'est commencé et que ce n'est pas le dernier du groupe ; l'annonce est gardée et son texte rendu.
 */
const workerClosureNotice = async ($: any, ids: readonly string[]): Promise<string> => {
  const closed = ids.filter(id => isSafeId(id)).at(-1)
  if (!closed) return ''
  const board: Board | null = await read($, boardAtom)
  const delegate = board?.delegate
  if (!board || !delegate?.group || !isSafeId(delegate.run)) return ''
  const session = await sessionId($)
  if (!isSafeId(session) || (await isWorkerCompactMarked($, session, delegate.run, closed))) return ''
  const tokens = await contextTokens($)
  if (tokens === undefined || tokens < WORKER_COMPACT_TOKENS) return ''
  // Un autre ticket déjà commencé (le suivant, lancé pendant la revue de celui-ci) : le moment est passé, rien ne
  // s'annonce (l'annonce le ferait s'arrêter en plein ticket) ; ses statuts illisibles : rien non plus.
  const own = await readOwnEntry($, delegate.run, session)
  if ('why' in own || Object.entries(own.entry?.tickets ?? {}).some(([id, t]) => id !== closed && t.status === 'doing')) return ''
  // Le dernier ticket du groupe, quand la mission est connue : pas « entre deux tickets », rien ne s'annonce.
  const mission = await workerMission($, board, delegate.run)
  if (mission?.groups?.some(g => g.id === delegate.group) && nextGroupTicket(mission, delegate.group, own.entry?.tickets ?? {}, closed) === undefined) return ''
  workerCompactAsk = { run: delegate.run, ticket: closed }
  return workerCompactNotice(closed, tokens)
}

/**
 * La mission pour laquelle le rappel de `workerStartNotice` est déjà parti, en mémoire du mod : il ne repart
 * qu'après un ticket passé « doing » (`relaySignal`), ou une fois de plus après `/reload-plugins`.
 */
let workerStartReminded: string | null = null

/**
 * Le chemin d'un fichier relatif au dossier de travail de la session, ou null quand il n'est pas dessous
 * (dossier inconnu, chemin absolu ailleurs, segment « .. »). Barres obliques inverses lues comme des barres ;
 * un chemin Windows se compare sans la casse.
 */
const projectRelativePath = (cwd: string, path: string): string | null => {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = norm(cwd)
  const file = norm(path)
  if (base === '' || file === '') return null
  let rel = file.replace(/^\.\//, '')
  if (/^(?:\/|[A-Za-z]:\/)/.test(file)) {
    const isWindows = /^[A-Za-z]:\//.test(base)
    const head = `${base}/`
    if (!(isWindows ? file.toLowerCase().startsWith(head.toLowerCase()) : file.startsWith(head))) return null
    rel = file.slice(head.length)
  }
  if (rel === '' || rel.split('/').some(s => s === '..')) return null
  return rel
}

/**
 * Le fil principal d'un worker de groupe vient de modifier un fichier du projet (Edit, Write ou MultiEdit, sous le
 * dossier de travail de la session, hors de `travail/` et d'un fichier de ticket local, `…/issues/<NN>-<nom>.md`
 * où qu'il soit, dont l'écriture change justement un statut) alors que son relais ne
 * porte aucun ticket « doing » : le rappel de passer en cours le premier ticket ouvert de son groupe, une fois
 * jusqu'au prochain ticket passé « doing ». Sans ticket en cours, ni le tableau de bord du manager ni la règle
 * d'effort du worker (`workerEffortRule`) ne voient le ticket. Rien dans le doute : dossier de travail, relais ou
 * mission illisibles, groupe absent du plan, plus aucun ticket ouvert. Les écritures par Bash n'y passent pas.
 */
const workerStartNotice = async ($: any, filePath: string): Promise<string> => {
  const board: Board | null = await read($, boardAtom)
  const delegate = board?.delegate
  if (!board || !delegate?.group || !isSafeId(delegate.run) || workerStartReminded === delegate.run) return ''
  const rel = projectRelativePath(String((await $.session.cwd()) ?? ''), filePath)
  if (rel === null || rel === 'travail' || rel.startsWith('travail/') || LOCAL_TICKET_FILE.test(rel)) return ''
  const own = await readOwnEntry($, delegate.run, await sessionId($))
  if ('why' in own) return ''
  const relayed = own.entry?.tickets ?? {}
  if (Object.values(relayed).some(t => t.status === 'doing')) return ''
  const mission = await workerMission($, board, delegate.run)
  if (!mission?.groups?.some(g => g.id === delegate.group)) return ''
  const next = nextGroupTicket(mission, delegate.group, relayed, '')
  if (next === undefined) return ''
  workerStartReminded = delegate.run
  return `flow-board: you changed a project file while your relay shows no ticket of your group in progress. Set ticket ${next} in progress now (the Status line of its ticket file, or its tracker task), before going on: the manager's dashboard and your effort rule only see a ticket in progress.`
}

/**
 * Relance le worker une fois sa compaction faite (ou pas faite), par un message simple, jamais en `/` ; un refus se dit.
 * Un tour ouvert entre-temps (un message de la personne) : le worker travaille déjà, rien ne part derrière ce tour.
 */
const resumeWorker = async ($: any, ask: { run: string; ticket: string }, next: string | undefined, isCompacted: boolean) => {
  // Un tour ouvert : rien derrière lui ; l'annonce reste, et la fin de ce tour relance (le worker attend ce message).
  if (isTurnOpen) {
    workerCompactAsk = { run: ask.run, ticket: ask.ticket, isCompacted }
    return
  }
  const done = ask.ticket
  let isIn = false
  await quietly(async () => {
    const sent = await $.prompt.submit({ text: workerResumeText(done, next, isCompacted) })
    isIn = typeof sent?.text === 'string' && sent.drop === undefined
  })
  if (!isIn) await quietly(() => $.ui.toast('flow-board : la relance du worker après la compaction n’est pas entrée ; écris-lui de continuer.'))
}

/** Au repos, un peu après la fin d'un tour : la compaction annoncée part, une fois, si rien ne s'y oppose. */
const scheduleWorkerCompact = ($: any) => {
  if (workerCompactAsk === null) return
  $.clock.after(AUTO_SEND_DELAY_MS, () => void quietly(() => workerCompactCheck($)))
}

/** Un spécialiste encore au travail d'après le moteur : seulement en repli, quand `classic.Stop` ne liste pas les tâches de fond. */
const hasLiveAgent = async ($: any): Promise<boolean> => {
  if (hasBackgroundList) return false
  let isLive = false
  await quietly(async () => {
    const agents = (await $.agent.list()) as { status?: unknown }[]
    isLive = agents.some(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
  })
  return isLive
}

const workerCompactCheck = async ($: any) => {
  const ask = workerCompactAsk
  if (ask === null || isWorkerCompactChecking) return
  isWorkerCompactChecking = true
  try {
    const board: Board | null = await read($, boardAtom)
    const delegate = board?.delegate
    // La session ne travaille plus pour cette mission : l'annonce tombe.
    if (!board || !delegate?.group || delegate.run !== ask.run) {
      workerCompactAsk = null
      return
    }
    const session = await sessionId($)
    const own = isSafeId(session) ? await readOwnEntry($, ask.run, session) : { why: 'unsafe session id' }
    const relayed = 'why' in own ? null : (own.entry?.tickets ?? {})
    const doing = relayed === null ? null : Object.entries(relayed).filter(([, t]) => t.status === 'doing').map(([id]) => id)
    const isBusy = hasBackgroundWork || (await hasLiveAgent($))
    const isMarked = await isWorkerCompactMarked($, session, ask.run, ask.ticket)
    const now = await $.clock.now()
    let step = workerCompactStep({ tokens: await contextTokens($), isTurnOpen, hasBackgroundWork: isBusy, doing, isMarked })
    // Une tâche de fond qui dure : revérifié au repos sans attendre de tour (le worker s'est arrêté), puis abandonné.
    if (step === 'wait' && !isTurnOpen) {
      const since = ask.at ?? now
      if (now - since < WORKER_COMPACT_WAIT_MS) {
        workerCompactAsk = { ...ask, at: since }
        $.clock.after(WORKER_COMPACT_RECHECK_MS, () => void quietly(() => workerCompactCheck($)))
        return
      }
      step = 'drop'
    }
    if (step === 'wait') return
    workerCompactAsk = null
    const mission = await workerMission($, board, ask.run)
    const next = nextGroupTicket(mission, delegate.group, relayed ?? {}, ask.ticket)
    // Le ticket suivant déjà commencé : le worker travaille, rien ne le relance.
    if (step === 'drop') {
      if (doing === null || doing.length === 0) await resumeWorker($, ask, next, ask.isCompacted === true)
      return
    }
    // La marque avant l'envoi : écrite, puis relue ; sinon rien ne part.
    let isWritten = false
    await quietly(async () => {
      await $.store.set(workerCompactKey(session, ask.run, ask.ticket), await $.clock.now())
      isWritten = (await $.store.get(workerCompactKey(session, ask.run, ask.ticket))) !== undefined
    })
    if (!isWritten) {
      await resumeWorker($, ask, next, false)
      return
    }
    // Un tour ouvert pendant ces lectures (un message) : la marque reste, rien ne part ; l'annonce reste, et la fin de
    // ce tour relance le worker (sa marque posée, la vérification suivante y renonce et le relance).
    if (isTurnOpen) {
      workerCompactAsk = ask
      return
    }
    // Les consignes du rôle « groupe » entre deux tickets, données à l'appel : `$.session.compact` saute le hook de
    // compaction de ce mod, et refuse pendant un tour (rien ne se met en file derrière un tour qui commencerait un ticket).
    const role = compactionRoleOf(board, await read($, registryAtom), await $.clock.now(), { done: ask.ticket, ...(next ? { next } : {}) })
    // `$.session.compact` saute le hook de compaction : la demande entière de lancement reçue plus haut revient.
    launchReceived = null
    let isCompacted = false
    let timer: { cancel: () => void } | null = null
    try {
      const result = await Promise.race([
        $.session.compact(role ? { instructions: compactionInstructions(role) } : {}),
        new Promise(resolve => {
          timer = $.clock.after(WORKER_COMPACT_TIMEOUT_MS, () => resolve(null))
        }),
      ])
      isCompacted = result !== null && typeof result === 'object' && Array.isArray((result as { messages?: unknown }).messages)
    } catch {
      // Refusée (un tour ouvert) ou ratée : pas de nouvel essai pour ce ticket (sa marque reste).
    } finally {
      ;(timer as { cancel: () => void } | null)?.cancel()
    }
    if (isCompacted) await markLane($, MAIN, { k: 'compact', at: await $.clock.now() })
    await resumeWorker($, ask, next, isCompacted)
  } finally {
    isWorkerCompactChecking = false
  }
}
/** Le tour d'une commande que l'auto a envoyée commence : sa marque passe « démarrée ». */
const noteAutoStart = async ($: any, skill: string | null) => {
  if (!skill) return
  const now = await $.clock.now()
  // Reconnue par la commande partie (`what`) comme par sa clé : une phase peut partir par un skill de rechange.
  await quietly(() => commit($, board => markAutoStarted(board, m => m.key.startsWith('phase:') && (m.what === `/${skill}` || m.key.startsWith(`phase:${skill}#`)), now)))
}

/** Une marque « envoyée » sans démarrage, la discussion au repos depuis un moment : la question « envoi resté sans suite ». */
const AUTO_IDLE_MS = 30_000

/** Le dernier geste sur l'auto (deux clics, « ↻ Renvoyer ») : la personne est là, le guet ne pose pas la pause d'un lot bloqué juste après. */
let autoGestureAt = -Infinity

const watchAutoSends = async ($: any) => {
  const live = await read($, liveAtom)
  const now = await $.clock.now()
  if (live.mode === 'working' || now - live.since < AUTO_IDLE_MS) return
  const board: Board | null = await read($, boardAtom)
  const run = activeRun(board)
  if (!run) return
  if (pendingAutoMarks(run).length > 0) {
    await commit($, b => raiseStaleAutoSends(b, now))
    return
  }
  // Un lot à groupes que plus rien ne fait avancer sans un geste : l'auto se met en pause et le notifie,
  // au lieu d'attendre en silence ; au repos seulement, car Claude envoie parfois l'avis au tour suivant.
  const review = await securityReviewNow($)
  if (isTurnOpen || isAutoDeciding || now - autoGestureAt < AUTO_IDLE_MS || !isGroupLotStuck(run, hasBackgroundWork, review) || !(await isAutoHere($, board))) return
  // Revérifié sur le board du moment de l'écriture : un tour ouvert ou un avis arrivé entre-temps l'emporte.
  const paused = await commit($, b => {
    const fresh = activeRun(b)
    return fresh && !isTurnOpen && isGroupLotStuck(fresh, hasBackgroundWork, review) ? stopActiveAuto(b, AUTO_STOPS.stuck, now) : null
  })
  await afterAutoPause($, paused)
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

/**
 * La demande d'avance rapide mise dans la saisie : le dossier en prose reste lisible et exact, celui de
 * la commande est cité pour le shell (entre apostrophes : ni `$`, ni accent grave, ni `"` n'y sont lus).
 * Un dossier qui ouvrirait une ligne ou retournerait l'affichage (`breaksLine` : fin de ligne, contrôle,
 * forçage bidirectionnel) n'entre pas dans une commande : la prose le montre neutralisé, et la demande
 * dit de vérifier le chemin, sans rien que Claude lancerait tel quel.
 */
export const fastForwardText = (dir: string | null): string => {
  if (!dir) return 'Mets à jour la branche en avance rapide : git pull --ff-only'
  if (breaksLine(dir)) return `Mets à jour ${neutralLine(dir)} en avance rapide : git pull --ff-only dans ce dossier, dont le nom porte des fins de ligne ou des caractères invisibles (vérifie son chemin exact avant de lancer)`
  return `Mets à jour ${dir} en avance rapide : git -C ${shellQuote(dir)} pull --ff-only`
}

/** L'avance rapide d'un dossier en retard sur origin : une demande à Claude dans le prompt, Entrée la lance. */
const askFastForward = async ($: any, dir: string | null) => {
  const text = fastForwardText(dir)
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? 'La demande de mise à jour est dans le prompt : Entrée pour la lancer' : `Tape dans le prompt : ${text}`))
}

/** La suite de la mission : la commande va dans le prompt, Entrée la lance (rien ne part sans toi). */
const launch = async ($: any, skill: string, given?: string) => {
  if (skill === 'retro' && (await launchRetro($))) return
  // Le lot sans groupes d'une mission, lancé par sa phase de code : relu et retenu comme un groupe.
  const here = activeRun(await read($, boardAtom))
  if (here && CODE_SKILLS.has(skill) && (here.groups ?? []).length === 0) {
    const held = await launchHolds($, [LOT_KEY])
    if (held === null || held.length > 0) return
  }
  // « ◆ Revue du groupe » (le /code-review des groupes finis ici) lancé à la main : la marque de l'auto,
  // démarrée, pour qu'il ne redemande pas cette revue (mission qui a été en auto).
  if (skill === 'final-review') {
    const run = activeRun(await read($, boardAtom))
    const now = await $.clock.now()
    if (run) await commit($, b => markAutoLaunched(b, hereReviewMark(run), now))
  }
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
 * question attend la personne, dans un worker, ou quand la suite n'est pas une commande.
 */
const suggestNext = async ($: any, answer: unknown, ask: string | null) => {
  if (ask !== null || endsWithQuestion(answer)) return
  const board: Board | null = await read($, boardAtom)
  const run = activeRun(board)
  if (!run || board?.delegate) return
  // Après /to-tickets, avant les groupes : alléger le manager (la suite n'est pas une commande).
  if (suggestsCompaction(board, await read($, registryAtom))) return showSuggestion($, '/compact')
  const sync = await read($, syncAtom)
  // Un groupe retenu par une autre mission : rien n'est suggéré (la suite attend le groupe attendu, ou un forçage).
  const skill = nextCommandSkill(run, { hasPullRequests: sync.isGitHub !== false, isVersionSet: sync.isVersionSet, security: await securityReviewNow($) }, holdMapOf(holdsHere(board)))
  // La rétro d'une mission à workers part avec sa consigne (bouton), pas en commande seule.
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
  // Le script des rapports des spécialistes : celui du dépôt quand le projet contient la source du mod, l'installé en repli.
  noteReferences($)
  const reports = (await hasModSource($)) ? { script: `${MOD_SOURCE}/${REPORTS_SCRIPT_FILE}`, fallback: reportsScript } : { script: reportsScript }
  return retroTranscriptNote(self?.transcript, session, lastCompactionAt(self) !== null, reports)
}

/** Le texte d'un skill, suivi d'une consigne (vide : tel quel). */
const withTail = <R extends { text: string }>(result: R, tail: string): R => (tail === '' ? result : { ...result, text: `${result.text}${tail}` })

/**
 * La rétro d'une mission qui a eu des workers : le manager (la session mère)
 * fait la sienne, et un spécialiste par session fille fait celle de sa session sur son transcript,
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
  // Une session fermée d'office (archivée, ou retirée par claude rm) n'est plus dans ListAgents : son relais reste.
  const reports = relayReportsPattern($, run.id)
  const text =
    `/${await commandFor($, 'retro')} Rétro globale de la mission « ${neutralInPrompt(run.title)} » : cette discussion (la session mère) et ses sessions filles, ${who}, à retrouver d'abord par leurs fichiers de relais, ${reports} (un par session qui a déposé son compte rendu ; <id> est celui de son transcript, <id>.jsonl sous ~/.claude/projects/), puis par ListAgents, qui ne liste plus une session archivée ou retirée par claude rm. ` +
    `1) D'abord, lance un spécialiste par session fille, tous en parallèle et en lecture seule (general-purpose, pas Haiku) : chacun lit le transcript de sa session, son fichier .jsonl sous ~/.claude/projects/ (pas claude logs, dont la sortie de terminal est illisible), en entier, compactions comprises, avec cette règle du fichier d'origine : « ${ORIGIN_FILE_RULE} », et en fait la rétro selon les étapes et les sept axes de ce skill, que tu lui transmets tels que tu les lis ici ; il ne modifie rien et rend ses pistes par sévérité, une par ligne « axe : correction », chacune avec ce qui l'a révélée dans la session. ` +
    `2) Pendant ce temps, fais la rétro de cette discussion. ` +
    `3) Une fois tous les spécialistes revenus, fais le compte rendu global : les pistes de toutes les sessions, fusionnées et sans doublon, par sévérité, chacune avec la ou les sessions où elle est apparue ; seules les pistes de ce dépôt vont dans les items de l'outil flow (donc, au choix, à leur découpage en tickets) ; celles qui touchent un autre dépôt (plugins, config commune, autre projet) n'y vont pas : rends-les à part, en une liste de corrections prête à confier à un agent de ce dépôt, un point par piste, le constat puis la correction attendue.`
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
 * Lance la sélection : la file est enregistrée dans la mission (visible des autres discussions),
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
  // Un lot sans groupes compte comme un groupe ; des tickets choisis dans une mission à groupes partent avec
  // leurs groupes : retenus par une autre mission, ils ne partent pas.
  const held = await launchHolds($, unitsOfTickets(run, ids))
  if (held === null || held.length > 0) return
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

/**
 * La règle que le mod d'un worker a appliquée à sa dernière requête (`workerEffortRule`), pour son bandeau ;
 * null sans règle (aucun ticket sensible ni de jugement en cours) ou hors d'un worker. Perdue au redémarrage : la requête
 * suivante la repose.
 */
let workerEffortNow: LeadEffort | null = null

/**
 * La règle d'effort d'un worker de groupe à cette requête (`workerTicketEffort`) : ses tickets « doing »
 * d'après sa propre entrée du relais (illisible : null) et, parmi eux, le dernier passé « doing » (son ticket en
 * cours), puis, s'il en a, leur drapeau « Jugement » et leur sensibilité dans la mission
 * pour laquelle il travaille (`workerMission` : le board d'ici, sinon celui du dépôt principal ; une
 * lecture ratée la laisse absente). Rien n'est lu dans la mission sans ticket en cours.
 */
const workerEffortRule = async ($: any, board: Board, run: string): Promise<LeadEffort | null> => {
  // Une lecture qui lève (l'id de session compris) vaut un relais illisible.
  const own = await (async () => readOwnEntry($, run, await sessionId($)))().catch((): { why: string } => ({ why: 'not read' }))
  if ('why' in own) return workerTicketEffort(null, undefined)
  const entries = Object.entries(own.entry?.tickets ?? {}).filter(([, t]) => t.status === 'doing')
  if (entries.length === 0) return null
  // Le ticket en cours : le dernier passé « doing », ex aequo compris (un ticket fini mais en attente de sa revue
  // reste « doing » pendant le suivant).
  const startedAt = (t: { at?: unknown }): number => (typeof t.at === 'number' ? t.at : 0)
  const latest = entries.reduce((max, [, t]) => Math.max(max, startedAt(t)), 0)
  let mission: Run | undefined
  await quietly(async () => {
    mission = await workerMission($, board, run)
  })
  return workerTicketEffort(entries.map(([id]) => id), mission, entries.filter(([, t]) => startedAt(t) === latest).map(([id]) => id))
}

/**
 * Un `/model` tapé (ou choisi au sélecteur) dans cette session : le mod n'y réécrit plus le modèle d'aucune requête,
 * jusqu'à la fin de la session (la personne garde la main) ; remis à faux au rechargement du mod.
 */
let isModelPinned = false

/**
 * Fable 5.2 indisponible pour cette session : un échec de tour (`classic.StopFailure`) de type `rate_limit` ou
 * `billing_error` juste après une requête partie sur Fable (la limite atteinte, l'usage supplémentaire coupé) ;
 * jusqu'à la fin de la session, remis à faux au rechargement du mod (rien dans `$.state` ni `$.store`).
 */
let isFableOff = false

/** La dernière requête du fil principal est partie sur Fable : seul un échec qui la suit éteint Fable. */
let isLastStepFable = false

/** Le message de reprise d'un worker Fable arrêté par le repli : envoyé une seule fois par session. */
let isFableResumeSent = false

/** Le toast du repli, dit une fois (libellé validé par Mathis le 09/11/2026). */
const FABLE_OFF_TOAST = 'Fable indisponible : retour sur Opus jusqu’à la fin de la session'

/** Le message que le mod renvoie à un worker Fable arrêté par le repli, à la fin du tour. */
const FABLE_RESUME_TEXT = 'Fable indisponible : reprends sur Opus là où tu t’es arrêté'

/** Le toast quand ce message n'entre pas (refus d'un hook, Stop qui tient, limite de l'hôte) : le worker reste arrêté. */
const FABLE_RESUME_REFUSED_TOAST = 'Fable indisponible : le message de reprise n’est pas entré, le worker reste arrêté ; dis-lui de reprendre sur Opus'

/**
 * Un worker de groupe (`delegate`) dont le tour échoue sur une erreur de la liste fermée (`workerStopText`) : un toast,
 * puis le dépôt d'une note au même texte à sa propre entrée du relais, par le signal de note existant, que le manager
 * montre sur la ligne du groupe et notifie (`notifyWorkerStops`). Les deux sont indépendants : un dépôt refusé ou raté
 * n'empêche pas le toast, ne lève pas et n'écrit rien d'autre. Le texte ne porte que le nom de l'erreur, jamais son
 * détail (`error_details`). Rien hors d'un worker, ni pour une erreur hors de la liste.
 */
const workerStopped = async ($: any, error: unknown, isResumed: boolean): Promise<void> => {
  const text = workerStopText(error, isResumed)
  if (text === null) return
  const board: Board | null = await read($, boardAtom)
  if (!board?.delegate) return
  await quietly(() => $.ui.toast(text))
  await quietly(() => relaySignal($, { kind: 'note', text }))
}

/** Les arrêts de worker déjà notifiés ici (mission, groupe et date de la note), en mémoire du mod. */
const notifiedStops = new Set<string>()

/**
 * Chez le manager, à la relecture du relais : chaque groupe confié dont le dernier signal du worker est une note
 * d'arrêt (`workerStopOf`) lève une notification du poste au texte de la note, une seule fois par date de note (après
 * `/reload-plugins`, une note encore là peut l'être une fois de plus). Sans terminal (app desktop), la notification
 * n'a pas de surface : la ligne du groupe reste le signal.
 */
const notifyWorkerStops = async ($: any, run: Run, relay: Relay): Promise<void> => {
  for (const g of run.groups ?? []) {
    const stop = workerStopOf(relayForGroup(relay, g, run.groups)?.last)
    if (stop === null) continue
    const key = [run.id, g.id, stop.at].join(':')
    if (notifiedStops.has(key)) continue
    notifiedStops.add(key)
    await notifyAll($, [stop.text])
  }
}

/** Le dernier silence signalé ici pour chaque groupe (clé mission et groupe ; valeur, la date du dernier signal), en mémoire du mod. */
const notifiedSilences = new Map<string, number>()

/** La dernière lecture du relais par `pullRelay` : sa mission, ses sources illisibles, et s'il n'y avait aucun relais. */
let relayReadNow: { run: string; gaps: number; isAbsent: boolean } | null = null

/**
 * Chez le manager qui tient la mission active, toutes les 5 s, hors du retour anticipé de `pullRelay` (un relais qui se
 * tait ne change plus) : les groupes dont le worker se tait depuis 30 minutes sans compte rendu (`silentWorkers`)
 * reçoivent une note, une fois par silence (un nouveau signal du worker la réarme). Rien ne part pendant un tour ouvert ;
 * une note qui n'entre pas ne marque pas le silence, la relecture suivante la renvoie. Rien n'est écrit sur le disque.
 */
const watchSilentWorkers = async ($: any): Promise<void> => {
  if (isTurnOpen) return
  const board: Board | null = await read($, boardAtom)
  const run = board ? activeRun(board) : undefined
  if (!board || !run || board.delegate || run.owner !== board.session) return
  // La lecture de `pullRelay` à ce passage : un relais lu en partie (une entrée illisible peut être celle d'un worker qui
  // signale) ne mesure rien ; aucun relais (des workers sans outil flow) vaut un relais vide, la session notée mesurant
  // alors depuis l'envoi.
  const got = relayReadNow
  if (got === null || got.run !== run.id || got.gaps > 0) return
  const relay: Relay | null = got.isAbsent ? factsRelayOf(undefined, 0, run.id) : await read($, relayAtom)
  const key = (s: { group: string }) => [run.id, s.group].join(':')
  const silent = silentWorkers(run, relay, await $.clock.now()).filter(s => notifiedSilences.get(key(s)) !== s.lastAt)
  if (silent.length === 0) return
  let isIn = false
  await quietly(async () => {
    const r = await modSubmit($, { text: silenceNote(silent, await isAutoHere($, board)) })
    isIn = r !== null && typeof r === 'object' && typeof r.text === 'string' && r.drop === undefined
  })
  if (isIn) for (const s of silent) notifiedSilences.set(key(s), s.lastAt)
}

/**
 * Envoie au worker Fable arrêté par le repli son message de reprise, en file derrière le tour : noté envoyé
 * seulement une fois entré (un résultat sans `drop`) ; refusé, un toast le dit : la personne relance le worker. Un
 * `billing_error` du fil principal (`stopError`, undefined pour celui d'un spécialiste) dont la reprise n'entre pas
 * laisse le worker arrêté : sa note d'arrêt part alors (`workerStopped`).
 */
const sendFableResume = async ($: any, stopError: unknown): Promise<void> => {
  let isIn = false
  await quietly(async () => {
    const r = await modSubmit($, { text: FABLE_RESUME_TEXT })
    isIn = r !== null && typeof r === 'object' && typeof r.text === 'string' && r.drop === undefined
  })
  if (isIn) return
  isFableResumeSent = false
  await quietly(() => $.ui.toast(FABLE_RESUME_REFUSED_TOAST))
  await quietly(() => workerStopped($, stopError, false))
}

/** Le mod peut imposer Fable 5.2 au fil principal de cette session : aucun `/model` tapé, Fable pas éteint. */
const isFableAllowed = (): boolean => !isModelPinned && !isFableOff

/** Fable éteint par le repli « Fable indisponible », sans `/model` tapé : le repli d'un cadrage en auto joue. */
const isFableFallback = (): boolean => isFableOff && !isModelPinned

/**
 * La dernière requête du fil principal pouvait partir sur Fable (Fable permis, et la requête sur le modèle de la
 * session) : le bandeau ne dit le modèle imposé que sur ce qui part vraiment ; faux avant la première requête.
 */
let isFableStep = false

/**
 * La dernière requête du fil principal partait déjà sur Fable sans que le mod réécrive son modèle (un `/model` tapé,
 * une bascule de l'app vue comme telle) : la règle du cadrage sur Fable s'y applique, et le bandeau le dit ; faux
 * avant la première requête.
 */
let isOnFableStep = false

/**
 * La dernière requête du fil principal partait sur Fable et le mod l'a ramenée sur Opus (`withOpusBack`) : le bandeau
 * le dit (« modèle : Opus 5.5 … ») ; faux avant la première requête.
 */
let isOpusBackStep = false

/**
 * La marque de ce processus sur ses relevés (`SentRequest.by`) : à la fusion avec le fichier, son propre relevé en
 * mémoire l'emporte toujours sur celui qu'il y a écrit avant, même sous une horloge recalée en arrière.
 */
const SENT_MARK = `p${Math.random().toString(36).slice(2, 10)}`

/** Deux relevés que la barre d'état montre pareil : même nom de modèle (`fable` et `claude-fable-5-2` : Fable 5.2), même effort, même réglage. */
const isSameShown = (a: SentRequest | undefined, b: SentRequest): boolean =>
  a !== undefined &&
  (modelName(a.model) ?? a.model) === (modelName(b.model) ?? b.model) &&
  a.effort === b.effort &&
  a.session.model === b.session.model &&
  a.session.effort === b.session.effort

/**
 * Relève ce qui part au fil principal (`noteSent`) et, quand la barre d'état le montrerait autrement que le relevé du
 * registre de cette session, l'écrit tout de suite dans son fichier, que la barre relit : sans attendre l'écriture
 * différée.
 */
const recordSentNow = async ($: any, record: SentRequest): Promise<void> => {
  const before = ((await read($, registryAtom)) as SessionRegistry | null)?.main?.sent
  await quietly(() => commitRegistry($, reg => noteSent(reg, record, record.at)))
  if (!isSameShown(before, record)) await quietly(() => saveRegistryNow($))
}

/**
 * Le réglage de la session vient de changer (`/model`, `/effort`, une bascule de modèle) : un relevé sans effort
 * envoyé, sous ce modèle (et l'effort tapé avec `/effort <niveau>`, `typedEffort`, qui devient celui de la piste ;
 * aucun sinon), remplace celui de la dernière requête ; la barre d'état montre le réglage de la session, et l'onglet
 * Agents l'effort tapé ou aucun, jusqu'à la requête suivante.
 */
const recordSettingNow = async ($: any, model: unknown, typedEffort?: string): Promise<void> => {
  if (typeof model !== 'string' || model === '') return
  await recordSentNow($, { model, session: { model, ...(typedEffort !== undefined ? { effort: typedEffort } : {}) }, at: await $.clock.now(), by: SENT_MARK })
}

/**
 * La requête nomme le modèle de la session (`$.session.model()`, l'id complet, comme `e.model`) : seule une telle
 * requête se réécrit sur Fable ; une requête que le moteur a repliée (filtre de sécurité vers Opus 4.8) part
 * telle quelle. Un modèle de la session illisible : non, la requête garde le sien.
 */
const isSessionModel = async ($: any, model: string): Promise<boolean> => {
  try {
    return (await $.session.model()) === model
  } catch {
    return false
  }
}

/**
 * Chez un manager (ni worker, ni le COO), le cadrage fini et la session restée sur un modèle Fable (`isFableStuck`) :
 * le bandeau dit « tape /model opus » (les requêtes du fil principal reviennent seules sur Opus, pas les forks ni
 * les agents sans modèle propre, qui suivent la session). Le modèle de la session se relit à
 * chaque appel (un `/model opus` tapé l'éteint sans attendre une requête) ; illisible : non.
 */
const isFableStuckHere = async ($: any, board: Board | null): Promise<boolean> => {
  if (!board || board.delegate || isCooDiscussion(board, await $.clock.now())) return false
  const run = activeRun(board)
  if (!run) return false
  let model: unknown
  try {
    model = await $.session.model()
  } catch {
    return false
  }
  return isFableStuck(run, model)
}

/**
 * Ce que le mod impose à une requête du fil principal de cette discussion, selon son rôle et sa phase : son
 * effort, le modèle quand la règle en donne un (`model`) et la règle elle-même (`rule`, pour la note à Claude) : dans un worker, xhigh au moins pendant un ticket de
 * jugement en cours, high au moins pendant un ticket sensible en cours (`workerEffortRule`) ; medium pour la discussion qui tient le siège du COO (`COO_EFFORT`) ;
 * la règle du manager de la mission active ici sinon (`leadEffort` : règle d'un worker pendant son travail,
 * Fable 5.2 en cadrage quand `isFableOn`, en high quand l'auto de la mission envoie d'ici (`isAutoHere`) et en
 * medium sinon, le même effort sans réécrire le modèle quand la requête part déjà sur Fable (`isOnFable`), xhigh au
 * moins pour un cadrage en auto dont Fable a été éteint par le repli sans `/model` tapé,
 * medium pendant le suivi des groupes, high au moins ailleurs) ; rien sans mission active ici. Recalculé à chaque
 * requête. Dans un worker, la règle trouvée devient celle que montre le bandeau (`workerEffortNow`), sauf avec
 * `isDry` : le calcul de la note à Claude (`sentNoteHere`) ne change rien de ce que voit la personne.
 */
const leadEffortHere = async <E extends string | number>($: any, current: E, isFableOn: boolean, isOnFable = false, isDry = false, requestModel: unknown = undefined): Promise<{ effort: E | 'medium' | 'high' | 'xhigh'; model?: string; rule: LeadEffort } | null> => {
  const board: Board | null = await read($, boardAtom)
  if (!board) return null
  if (board.delegate) {
    // Un worker Fable : Fable 5.2 high à chaque requête, seulement sous une marque valide (`isFableMark`) ; Fable
    // éteint, le modèle de la session en xhigh ; sinon (un `/model` tapé, une requête repliée) la règle d'un worker.
    const isFableWorker = isFableMark(board.delegate.model)
    const rule = isFableWorker && isFableOn ? FABLE_WORKER_EFFORT : isFableWorker && isFableOff && !isModelPinned ? FABLE_OFF_WORKER_EFFORT : await workerEffortRule($, board, board.delegate.run)
    // Hors du worker Fable, une requête partie sur Fable revient sur Opus (`withOpusBack`), même sans règle d'effort.
    const worker = isFableWorker ? rule : withOpusBack(rule, requestModel, true)
    if (!isDry) workerEffortNow = worker
    return worker ? { effort: effortSent(worker, current), ...(worker.model ? { model: worker.model } : {}), rule: worker } : null
  }
  if (!isDry) workerEffortNow = null
  const own = isCooDiscussion(board, await $.clock.now()) ? COO_EFFORT : leadEffort(activeRun(board), isFableOn, { isAutoHere: await isAutoHere($, board), isFableOff: isFableFallback(), isOnFable })
  // Hors du cadrage, une requête du COO ou du manager partie sur Fable revient sur Opus ; sans mission active, rien.
  const rule = withOpusBack(own, requestModel)
  return rule ? { effort: effortSent(rule, current), ...(rule.model ? { model: rule.model } : {}), rule } : null
}

/**
 * La dernière note sur ce qui part, donnée à Claude (au contexte d'un message ou dans la réponse de l'outil flow) ;
 * null : aucune, ou plus rien d'imposé. Remise à null au rechargement du mod.
 */
let lastSentNote: string | null = null

/**
 * Ce que le mod dit à Claude de la prochaine requête du fil principal (`sentNote`), calculé comme `turn.step` le
 * ferait sur le réglage de la session : son modèle (`$.session.model()`), son effort relevé (`sessionEffort`),
 * Fable permis (`isFableAllowed`) ou la session déjà sur Fable (`isOnFable`). Un modèle illisible : rien.
 */
const sentNoteHere = async ($: any): Promise<{ note: string | null; reset: string | null; isUnknown?: true }> => {
  let model: unknown
  try {
    model = await $.session.model()
  } catch {
    return { note: null, reset: null, isUnknown: true }
  }
  const current = await sessionEffort($)
  const isFableOn = isFableAllowed() && typeof model === 'string'
  const lead = await leadEffortHere($, current ?? '', isFableOn, !isFableOn && isFableModelId(model), true, model)
  // Un effort de session inconnu (après un `/model` ou un `/effort` sans niveau, ou sur un modèle sans effort, que
  // `turn.step` ne réécrit pas) sous une règle : le mod ne sait pas ce qui part, il ne dit rien de neuf.
  if (current === undefined && lead !== null) return { note: null, reset: null, isUnknown: true }
  const sentEffort = lead === null || lead.effort === '' ? current : String(lead.effort)
  return sentNote(lead?.rule ?? null, { model, effort: current }, { model: lead?.model ?? model, effort: sentEffort })
}

/**
 * La réponse de l'outil flow, avec la note sur ce qui part quand l'appel l'a changée (une phase de cadrage qui
 * commence ou finit, un ticket en cours) : la nouvelle note, ou celle du retour au réglage quand plus rien n'est imposé.
 */
const withSentChange = async ($: any, result: string): Promise<string> => {
  const { note, reset, isUnknown } = await sentNoteHere($).catch(() => ({ note: null, reset: null, isUnknown: true as const }))
  if (isUnknown || note === lastSentNote) return result
  const told = note ?? reset
  lastSentNote = note
  return told === null ? result : `${result}\n\n${told}`
}

/**
 * L'effort de la session de cette discussion : celui du dernier relevé de sa piste (`main.sent`, une requête partie ou
 * un réglage changé, sans effort quand il n'est pas connu), sinon l'effort relevé ; inconnu avant sa première réponse.
 */
const sessionEffort = async ($: any): Promise<string | undefined> => {
  const lane = ((await read($, registryAtom)) as SessionRegistry | null)?.main
  return lane?.sent ? lane.sent.session.effort : lane?.effort
}

/**
 * Les fenêtres de quota de la discussion (`$.session.usage().rateLimits`) ; vide quand le moteur n'en donne pas
 * (hors abonnement, avant la première réponse) ou que la lecture échoue : rien ne s'affiche ni ne se cite alors.
 */
const quotaWindows = async ($: any): Promise<readonly QuotaWindow[]> => {
  let limits: unknown
  await quietly(async () => {
    limits = (await $.session.usage())?.rateLimits
  })
  return Array.isArray(limits) ? (limits as QuotaWindow[]) : []
}

/** Comment le manager suit un worker : `claude logs` rend une sortie de terminal illisible. */
const FOLLOW = (isRepo: boolean): string =>
  `pour savoir où en est une session, lire ${isRepo ? "l'état git de son worktree (git -C <worktree> log --oneline et git -C <worktree> status)" : 'les fichiers modifiés dans ce dossier'}, le tracker (statuts des tickets) et ListAgents (la session est-elle encore là), jamais claude logs (illisible)`

/**
 * La fusion d'un groupe : toujours en avance rapide, le geste de fin du worker (`procedure-groupe-fin.md`) ayant amené
 * la branche de travail dans celle du groupe et passé la suite dans son worktree. Une fusion faite ici restait en cours
 * dans le clone principal pendant que la suite tournait (une autre mission demandait si une fusion était en cours).
 */
const MERGE_MOVED =
  "seulement en avance rapide, dans le clone principal : git merge --ff-only <branche du groupe> ; refusée (la branche de travail a bougé depuis le geste de fin du worker), refaire ce geste dans le worktree du groupe, encore là avant sa fermeture, tel que le dit la procédure d'un worker (son « Geste de fin », dans procedure-groupe-fin.md : la branche de travail amenée par une fusion, ou par un rebase quand elle a été réécrite depuis, par un /project:sync par exemple, jamais fusionnée alors ; la suite complète passée là), puis recommencer l'avance rapide : jamais une fusion laissée en cours dans le clone principal pendant qu'une suite tourne"

/** Ce qui sert de note de fin au manager, selon que la session a été lancée par l'app ou par le CLI. */
const atEnd = (whose: string): string => `À la note de fin de ${whose} (dans le CLI : son message reçu par SendMessage)`

/** Une faille corrigée après le retour d'un groupe : sans nouvel envoi, le tableau de bord gardait « 0 corrigé ». */
const fixedLater = (isAuto: boolean): string =>
  `une faille corrigée après coup${isAuto ? '' : ' (avec mon accord)'} se renvoie aussi, avec "fixed" mis à jour, sinon le tableau de bord garde « 0 corrigé » ; une faille laissée, sur ma confirmation, par "dismissed" (le total, à jour avec "findings" et "fixed")`
const FIXED_LATER = fixedLater(false)

/** La même consigne en mode auto, où une faille se corrige d'office, sans accord à demander. */
const FIXED_LATER_AUTO = fixedLater(true)

const LINKED_NO_GIT_GROUP_POINT =
  "point fixe : pour chaque fichier, la plus ancienne copie parmi les tickets du groupe (un fichier touché seulement par un ticket suivant n'a pas de copie du premier), comparée au fichier actuel, les fichiers nouveaux en entier ; lui donner la liste des copies et des fichiers"

/**
 * Une demande que le mod ne construit pas : une valeur relue du fichier de mission partagée (que tout
 * processus de la session peut réécrire) n'a pas sa forme. Invariant : un texte que le mod soumet ou
 * rend à Claude n'insère jamais une valeur relue du fichier partagé sans l'avoir contrôlée (forme d'id,
 * de branche) ou échappée. `unsafe` : ce qui est hors forme, en mots, sans la valeur elle-même.
 */
type Unsafe = { unsafe: string }

const isUnsafe = (x: unknown): x is Unsafe => x !== null && typeof x === 'object' && 'unsafe' in x

/** Le toast d'un bouton dont la demande ne s'écrit pas : la valeur hors forme n'y est pas recopiée. */
const unsafeToast = (u: Unsafe): string => `Rien n’est mis dans le prompt : ${u.unsafe} est hors forme dans le fichier de mission (relu, peut-être retouché).`

/**
 * Le dossier temporaire du système où s'écrivent les briefs : `TMPDIR`, sinon `TEMP`, sinon `TMP`
 * (un appel par nom : `$.env.get` veut un nom littéral ; la première variable posée décide), en forme
 * (`tempDirForm`) et déjà là comme dossier (le mod n'en crée jamais un). Rendu tel que le disque le
 * nomme (`realPath`, à barres obliques) : sous Windows, un `/tmp` d'un shell POSIX se résout en chemin
 * à lettre de lecteur, que le shell de Claude relit au même endroit. Null quand aucun ne convient : le
 * brief ne s'écrit pas, la demande d'avant prend le relais.
 */
const systemTempDir = async ($: any): Promise<string | null> => {
  const env = async (ask: () => Promise<unknown>): Promise<string | null> => {
    try {
      const value = await ask()
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
    } catch {
      return null
    }
  }
  const value = (await env(() => $.env.get('TMPDIR'))) ?? (await env(() => $.env.get('TEMP'))) ?? (await env(() => $.env.get('TMP')))
  // Aucune variable : pas de repli sur un `/tmp` partagé entre utilisateurs ; la demande d'avant prend le relais.
  const dir = value === null ? null : tempDirForm(value)
  if (!dir) return null
  try {
    // Le dossier nommé lui-même n'est pas un lien (un TMPDIR=/tmp de macOS mène au /private/tmp partagé) ; puis son chemin résolu.
    const own = await $.fs.stat(dir)
    if (own?.kind !== 'dir' || own.isLink === true) return null
    const stat = await $.fs.stat(dir, { resolve: true })
    const real = typeof stat?.realPath === 'string' ? tempDirForm(stat.realPath) : null
    return stat?.kind === 'dir' && real ? real : null
  } catch {
    return null
  }
}

/**
 * Écrit le brief d'un groupe dans le dossier temporaire du système (`dir`, déjà résolu), à un nom
 * neuf : rend son chemin, ou null quand il ne s'écrit pas (nom hors forme, un fichier ou un lien déjà
 * à ce nom, écriture refusée, relecture différente). Un fichier ou un lien déjà là au contrôle n'est
 * pas réécrit ; `$.fs.write` n'a pas de création exclusive : un lien posé entre le contrôle et
 * l'écriture, par un processus du même compte (le dossier temporaire de macOS et de Windows est propre
 * au compte), serait suivi, et seule la relecture le voit (repli, rien de supprimé).
 */
const writeBrief = async ($: any, dir: string, runId: string, groupId: string, at: number, text: string, isFable = false): Promise<string | null> => {
  const name = briefFileName(runId, groupId, at, isFable)
  if (!name) return null
  const path = `${dir}/${name}`
  try {
    if ((await $.fs.exists(path)) !== false) return null
  } catch {
    return null
  }
  // Un lien qui ne mène nulle part n'« existe » pas : `stat` le voit encore, et rien ne s'écrit à travers lui.
  let isTaken = true
  try {
    await $.fs.stat(path)
  } catch {
    isTaken = false
  }
  if (isTaken) return null
  try {
    await $.fs.write(path, text)
    // Relu après l'écriture : un vrai fichier (pas un lien posé entre-temps), à ce nom sous le dossier
    // résolu, et le texte écrit ; sinon la demande d'avant (rien n'est supprimé).
    const own = await $.fs.stat(path, { resolve: true })
    const real = typeof own?.realPath === 'string' ? own.realPath.replace(/\\/g, '/') : ''
    if (own?.kind !== 'file' || own.isLink === true || real !== path) return null
    return String(await $.fs.read(path)) === text ? path : null
  } catch {
    return null
  }
}

/**
 * Écrit le brief de chaque groupe lancé (`briefText`), un par groupe (`o.variants` : le Fable sous « ↗ Fable »,
 * l'Opus sinon) : rend leurs chemins, ou la raison, en mots, pour laquelle l'un d'eux ne s'est pas écrit (sans
 * la valeur hors forme) ; la demande d'avant revient alors, pour tous.
 */
const writeBriefs = async ($: any, run: Run, views: readonly GroupView[], o: BriefParts): Promise<{ paths: { group: string; path: string; isFable: boolean }[]; why?: undefined } | { paths: null; why: string }> => {
  const dir = await systemTempDir($)
  if (!dir) return { paths: null, why: 'dossier temporaire du système introuvable ou hors forme' }
  let hasRules = false
  if (o.root) {
    await quietly(async () => {
      hasRules = (await $.fs.exists(`${normRoot(o.root)}/config/rules`)) === true
    })
  }
  const at = await $.clock.now()
  const paths: { group: string; path: string; isFable: boolean }[] = []
  for (const view of views) {
    for (const isFable of o.variants(view)) {
      const path = await writeBrief($, dir, run.id, view.group.id, at, briefText(run, view, views, hasRules, o, isFable), isFable)
      if (!path) return { paths: null, why: `écriture du brief${isFable ? ' Fable' : ''} du groupe ${shownGroupId(view.group.id)} refusée dans le dossier temporaire` }
      paths.push({ group: view.group.id, path, isFable })
    }
  }
  return { paths }
}

/**
 * La demande à Claude pour confier des groupes à des workers, une par groupe. La mission
 * reste ici (un seul écrivain) : chaque session se déclare (`delegate`), suit la procédure de
 * `reference/procedure-groupe.md` (citée par son chemin, jamais recopiée) selon le CLAUDE.md du
 * projet, puis rend compte ; Claude rend les statuts ici. Le prompt ne porte que ce qui varie. Hors
 * forme, l'id de la mission ou d'un groupe n'y entre pas : la demande ne s'écrit pas (`Unsafe`). Ses parties communes déjà
 * reçues à l'identique dans cette discussion se remplacent par un renvoi à la demande entière (`isShortLaunch`).
 */
const delegationText = async ($: any, run: Run, views: readonly GroupView[], decidedAt: string | null = null, imposed?: ImposedEffort, isAuto = false): Promise<string | Unsafe> => {
  if (!isSafeId(run.id)) return { unsafe: 'l’id de la mission' }
  if (!views.every(v => isGroupId(v.group.id))) return { unsafe: 'l’id d’un groupe' }
  noteReferences($)
  // Sans git, pas de worktree possible : les sessions travaillent dans ce dossier.
  const isRepo = await measureRepo($)
  const implement = `/${await commandFor($, 'implement')}`
  const tdd = `/${await commandFor($, 'tdd')}`
  const ticketReview = `/${await commandFor($, 'code-review')}`
  const standards = await standardsPath($)
  const many = views.length > 1
  // L'appel delegate du point 1, écrit une fois : le groupe en clair dans un brief, « <id du groupe> » dans une demande pour plusieurs.
  // Le worker Fable porte la marque dans ce même appel : `"model": "fable"`, le seul champ qui la pose (son premier appel delegate).
  const delegateCall = (groupId: string, isFable = false): string => `{"delegate": ${asciiJson(run.id)}, "group": ${asciiJson(groupId)}, "main": "[<ref>]"${isFable ? ', "model": "fable"' : ''}}`
  const delegate = delegateCall(many ? '<id du groupe>' : views[0]!.group.id, imposed === 'fable')
  // Chaque ligne porte l'effort calculé par le mod (ou imposé par un bouton) : Claude le lit au lieu de refaire la règle.
  // Un groupe qui porte un ticket ouvert « Jugement : oui » (`isJudgmentTicket`) : son mod le passe en xhigh le temps
  // du ticket, sa ligne le dit, il ne part jamais sur Sonnet et son worker est autonome.
  const hasJudgment = (v: GroupView): boolean => v.open.some(isJudgmentTicket)
  // Un groupe sans logique part sur Sonnet (option fusion), sauf sous un effort imposé, qui garde Opus (ou Fable),
  // et sauf un groupe qui porte un ticket de jugement.
  const isSonnet = (v: GroupView): boolean => !imposed && isNoLogicGroup(run, v.group) && !hasJudgment(v)
  // Un seul brief par groupe : le Fable sous « ↗ Fable », l'Opus dans tous les autres cas.
  const variants = (_v: GroupView): readonly boolean[] => (imposed === 'fable' ? [true] : [false])
  const groups = views.map(v => `Groupe ${v.group.id} (${neutralInPrompt(v.group.name)}) : ${ticketList(run, v.open.map(t => t.id))}${groupLaunchNote(v.open, v.group.files ?? [], imposed, isSonnet(v))}`).join(' ∥ ')
  const prefix = linkedPrefix(run)
  // Dans le dépôt de flow-board, ses fichiers à jour sont ceux du dépôt, pas ceux installés ; les
  // fichiers de méthode, à côté de la procédure, se retrouvent sans répéter leur chemin installé.
  const isSource = await hasModSource($)
  const procedure = isSource ? `${MOD_SOURCE}/${PROCEDURE_FILE} du dossier de travail (source du dépôt, qui fait foi ; sinon ${procedurePath})` : procedurePath
  // Le chemin seul de l'annexe de la section 11, pour la consigne d'effort qui y renvoie.
  const effortFile = isSource ? `${MOD_SOURCE}/${EFFORT_FILE}` : effortPath
  const cite = (installed: string, file: string): string =>
    isSource ? `${MOD_SOURCE}/${file} (dossier de travail, sinon à côté de la procédure installée)` : installed
  const autonomous = "qu'elle est un worker autonome : elle applique la section « Worker autonome » de la procédure (procedure-groupe-autonome.md)"
  const fableWorker =
    "qu'elle est un worker Fable (son mod passe ses requêtes sur Fable 5.2 high, la réponse de l'outil flow le lui dit ; ses revues vont à un relecteur Opus, section 3 de la procédure) et un worker autonome : elle applique la section « Worker autonome » de la procédure (procedure-groupe-autonome.md)"
  // Dans le dépôt de flow-board : l'index du README (aucun worker ne l'ouvrait), et le mod qui tourne n'est pas celui du dépôt.
  const sourceBody = `l'« Index : concept → fichier et fonction » de ${MOD_SOURCE}/README.md d'abord, puis les fichiers lus par fonction ; le mod qui tourne est sa version installée, pas celle du dépôt. `
  const sourceNote = isSource ? `Le prompt dit aussi : ${sourceBody}` : ''
  // Dans le dépôt de flow-board, les deux versions quand elles diffèrent : un correctif du dépôt n'agit pas dans la session.
  const versionsNote = isSource ? await modVersionsNote($) : ''
  // Les trois points du prompt de la session, écrits une fois : `here` désigne la discussion principale
  // (« ici », « cette discussion » dans la demande ; « la discussion principale » dans le brief).
  // `judged` : le groupe porte un ticket ouvert « Jugement : oui » (null : la consigne vaut pour plusieurs groupes).
  const steps = (call: string, isBrief: boolean, isFable = false, judged: boolean | null = null): string => {
    const here = isBrief ? 'dans la discussion principale' : 'ici'
    const back = isBrief ? 'à la discussion principale' : 'à cette discussion'
    return (
      `1) d'abord, appeler une seule fois l'outil flow de flow-board avec ${call} : la mission reste ${here}, et l'avancement de la session (statuts Asana des tickets, commits, tests) est relayé tout seul au tableau de bord ${isBrief ? 'de la discussion principale' : "d'ici"} ; ` +
      `2) puis lire la procédure d'un worker de groupe, ${procedure}, et la suivre jusqu'au bout : questions sensibles d'abord, puis chaque section dans l'ordre jusqu'au compte rendu déposé au relais puis une ligne ${back} ; chaque fichier lu à part, et de la spec les seules sections que cite le ticket ; ` +
      `3) ce qui varie, que la procédure attend du prompt : les commandes de ce poste (TDD : ${tdd} ; revue du ticket : ${ticketReview} ; ${implement} est réservé à l'utilisateur), le fichier de méthode de la revue de sécurité, ${cite(securityMethod, SECURITY_METHOD_FILE)}, le fichier de méthode de la relecture du fond et de la forme, ${cite(readingMethod, READING_METHOD_FILE)}, ${decidedAt ? `le fichier des choix déjà déclarés de la mission, ${decidedAt}` : 'la liste des choix déjà déclarés (leur fichier est hors d\'atteinte : section 8 de la procédure)'}, ${standards ? 'que le projet a un CODING_STANDARDS.md à sa racine (son chemin, à la racine du dossier de travail de la session, va dans le fichier de consignes de chaque revue)' : "que le projet n'a pas de CODING_STANDARDS.md à sa racine"}, ${isRepo ? 'que son dossier est un dépôt git' : "que son dossier n'a pas de git (section 9 de la procédure)"}, ${isFable ? `et ${fableWorker}` : isAuto ? `et qu'elle est un worker autonome quel que soit son effort (la mission est en mode auto${imposed ? '' : ', jamais sur Fable'}) : elle applique la section « Worker autonome » de la procédure (procedure-groupe-autonome.md)` : imposed ? `et ${autonomous}` : judged === true ? `et ${autonomous} (son groupe porte un ticket « Jugement : oui »)` : judged === false ? "et qu'elle n'est pas un worker autonome (aucun ticket « Jugement : oui » dans son groupe)" : `et, si son groupe porte un ticket « Jugement : oui », ${autonomous}`}. `
    )
  }
  const head =
    `${many ? 'Confie chacun de ces groupes à son worker, en parallèle,' : 'Confie ce groupe à un worker,'} pour la mission « ${neutralInPrompt(run.title)} » : ${groups}. ` +
    (isAuto
      ? `Avant de lancer : ce dont ${many ? 'une session aura' : 'la session aura'} besoin de ma part (une décision, un accès, un geste qui m'est réservé), déclare-le en question bloquante sur son groupe ("waiting") et ne lance ce groupe qu'une fois ma réponse donnée${many ? ' ; lance les autres tout de suite' : ''}. `
      : `Avant de lancer : repère ce dont ${many ? 'les sessions auront' : 'la session aura'} besoin de ma part (une décision, un accès, un geste qui m'est réservé) et règle-le d'abord avec moi ici, sinon ${many ? 'elles y buteront' : 'elle y butera'}. `) +
    `Puis lance ${many ? 'une session par groupe' : 'la session'}, avec un titre qui commence par « ${prefix}Groupe <id> · » : le début dit de quelle discussion ${many ? 'elles viennent' : 'elle vient'}, et « Groupe <id> » relie la session à son groupe au tableau de bord. ` +
    `Lance ${many ? 'chaque' : 'le'} worker seulement depuis cette demande : un lancement à part n'est pas vu. `
  // L'effort relevé de la discussion et le quota ne se citent que sous un xhigh imposé : rien à lire sinon.
  const effortRule =
    isAuto && !imposed
      ? AUTO_GROUP_EFFORT(many, effortFile)
      : imposed === 'xhigh'
        ? GROUP_EFFORT(many, imposed, await sessionEffort($), effortFile, quotaText(await quotaWindows($), await $.clock.now()))
        : GROUP_EFFORT(many, imposed, undefined, effortFile)
  // Les phrases sur Sonnet et sur Opus suivent la consigne d'effort, séparées d'une espace (celle hors auto finit sur un
  // point) : Opus pour tout groupe qui n'est ni « Sonnet high » ni lancé par « ↗ Fable » (le worker Fable part aussi sur Opus, que `FABLE_LAUNCH` écrit).
  const models = [views.some(isSonnet) ? SONNET_LAUNCH_FR : '', imposed !== 'fable' && views.some(v => !isSonnet(v)) ? OPUS_LAUNCH_FR : ''].join('')
  const how = { many, isRepo, ownFolder: true, trustInProcedure: true, title: `${prefix}Groupe <id> · <thème>`, worktree: groupWorktreeTemplate(run), effort: models !== '' ? `${effortRule.trimEnd()} ${models}` : effortRule, ref: mainRefKnown.get(run.id) ?? null }
  const resent = (isRepo ? resentWorktrees(run, views) : '') + (isAuto ? resentFindings(views) : '')
  const root = await sessionRoot($)
  // Le brief de chaque groupe, écrit par flow-board dans le dossier temporaire du système : Claude le
  // passe tel quel. Un seul qui ne s'écrit pas, et la demande d'avant revient pour tous, en le disant.
  const briefs = await writeBriefs($, run, views, {
    root,
    isRepo,
    isAuto,
    decidedAt,
    steps: (groupId: string, isFable: boolean) => steps(delegateCall(groupId, isFable), true, isFable, views.some(v => v.group.id === groupId && hasJudgment(v))),
    sourceNote: isSource ? `Dans ce dépôt : ${sourceBody}` : '',
    variants,
  })
  const managerPart =
    `Ici : garder la mission (pas de nouvelle mission) et suivre ${many ? 'les sessions sans les ' : "la session sans l'"}attendre activement : ${FOLLOW(isRepo)}. ` +
    `Le compte rendu complet d'une session est dans le relais, son message n'en porte qu'une ligne. ` +
    `Si l'app ou cette discussion redémarre, la mission reste à cette discussion et lui revient seule (flow-board redemande alors ta référence du moment, que les workers relisent par leur outil flow) ; si le tableau de bord la dit suivie dans une autre discussion, ne pas la reprendre : me le dire. Puis rendre les statuts des tickets faits pendant l'arrêt d'après le suivi des tickets. ` +
    `${atEnd(many ? 'chacune' : 'la session')}, vérifier son travail ; avant d'appliquer ici un correctif que son compte rendu propose, lire ${isRepo ? 'sa branche (git log et git diff de son worktree)' : 'ses fichiers'} : elle l'a peut-être déjà fait ; une question de son compte rendu se tranche ici, et la session n'applique rien d'autre sans un message d'ici ; vérifier aussi, dans son compte rendu, que la revue du groupe a tourné (sinon, la lui demander par SendMessage avant tout ; pas de revue du groupe pour un groupe d'un seul ticket ; ni revue du groupe ni revue de sécurité sans logique ni zone sensible)${isRepo ? `, fusionner sa branche (${MERGE_MOVED})` : ''}, puis envoyer à l'outil flow les statuts de ses tickets dans "set"${isAuto ? " (un ticket dont les contrôles ont échoué reste à faire, en todo : l'auto renvoie le groupe une fois)" : ''}, avec {"returned": ["<id du groupe>"]} et, si son compte rendu dit que la revue du groupe a tourné, {"reviewed": ["<id du groupe>"]} (le tableau de bord ne la voit pas toujours : sans cela, il la proposerait encore), ` +
    `et, d'après son compte rendu, {"security": {"group": "<id du groupe>", "advised": true|false, "why": "<raison>"}}, avec "findings" et "fixed" si la revue de sécurité a tourné ; ${isAuto ? AUTO_FINDINGS_FR : 'me dire les failles trouvées : je décide de leur correction'} ; ${isAuto ? FIXED_LATER_AUTO : FIXED_LATER}. ` +
    `Enfin, un groupe clos (« Close now » dans la réponse de l’outil) se ferme selon sa procédure, puis {"closed": [...]}.`
  if (briefs.paths) {
    // Un seul brief par groupe : le Fable sous « ↗ Fable », l'Opus sinon.
    const list = briefs.paths.map(b => `${b.isFable ? 'brief Fable' : 'brief'} du groupe ${b.group} : ${shellQuote(b.path)}`).join(' ; ')
    // Les parties communes déjà reçues à l'identique dans cette discussion : la forme courte, qui y renvoie.
    const parts: LaunchParts = { how: launchHow({ ...how, brief: true }), follow: managerPart }
    const isShort = isShortLaunch(launchReceived, parts)
    if (!isShort) launchOffered = parts
    return (
      head +
      versionsNote +
      (isShort ? shortLaunchHow(many) : parts.how) +
      resent +
      `Briefs écrits par flow-board (un par groupe, à passer tels quels) : ${list}. ` +
      (decidedAt ? '' : "Ajoute aussi à ce qui varie la liste des choix déjà déclarés (ceux envoyés dans decided) : leur fichier est hors d'atteinte. ") +
      (isShort ? SHORT_LAUNCH_FOLLOW : managerPart)
    )
  }
  // Dit là où commence ce que Claude rédige : le début de la demande reste celui d'avant.
  const fallback = `Le brief n'a pas pu être écrit par flow-board (${neutralInPrompt(briefs.why)}) : rédige-le toi-même, comme suit. `
  return (
    head +
    versionsNote +
    launchHow(how) +
    resent +
    fallback +
    `${BACKGROUND(many, root)}${decidedAt ? `le fichier des choix déjà déclarés de la mission se cite par son chemin, ${decidedAt}` : 'les choix déjà déclarés (ceux envoyés dans decided) se donnent en liste : leur fichier est hors d\'atteinte'}. ` +
    `Le prompt de ${many ? 'chaque session' : 'la session'} : ${steps(delegate, false, imposed === 'fable', many ? null : hasJudgment(views[0]!))}` +
    sourceNote +
    managerPart
  )
}

/**
 * Lie les groupes `ids` (« worker à lancer »), et rend la mission telle que cette écriture l'a posée, avec le nom de
 * worktree noté à l'envoi de chacun ; null quand rien n'est écrit. Le brief se calcule d'après elle, jamais d'après la
 * mission lue avant la note : un titre changé entre-temps donnerait un autre nom que celui que la fermeture cherchera.
 */
async function linkGroups($: any, runId: string, ids: readonly string[], now: number): Promise<Run | null> {
  return commitRun($, runId, b => startLinkedGroups(b, ids, now))
}

/**
 * Applique `change` (comme `commit`) seulement quand la mission active, relue à l'instant d'écrire, est `runId`, et rend
 * cette mission telle que l'écriture réussie l'a posée ; null quand rien n'est écrit (une autre mission devenue active
 * entre-temps n'est jamais touchée). Chaque nouvel essai de `commit` repart du board relu et remplace la mission rendue.
 */
async function commitRun($: any, runId: string, change: (board: Board) => Outcome): Promise<Run | null> {
  const written: { run: Run | null } = { run: null }
  const isWritten = await commit($, b => {
    if (activeRun(b)?.id !== runId) return null
    const out = change(b)
    written.run = out ? activeRun(out.board) : null
    return out
  })
  return isWritten ? written.run : null
}

/**
 * Les vues d'avant la note réduites aux groupes que cette note a liés, chacune avec son groupe tel qu'elle l'a écrit
 * (son lien, son nom noté) : un groupe qu'elle n'a pas lié (lié avant elle par un autre envoi, ou plus délégable) ne
 * part pas dans le brief, où il aurait un autre nom que celui noté à son envoi en cours, et une seconde session.
 */
export const withNotedGroups = (views: readonly GroupView[], run: Run, now: number): GroupView[] =>
  views.flatMap(v => {
    const g = run.groups?.find(x => x.id === v.group.id)
    return g && g.linked?.at === now ? [{ ...v, group: g }] : []
  })

/**
 * Un groupe confié de nouveau a son worktree à lui, numéroté (`-2`, `-3`…) : la branche gardée d'un
 * envoi précédent porte le nom sans numéro : le nom noté à cet envoi (`linked.worktreeName`) quand il est en forme,
 * sinon le nom calculé depuis le titre, comme avant. Rien pour un premier envoi.
 */
export const resentWorktrees = (run: Run, views: readonly GroupView[]): string =>
  views
    .map(v => ({ id: v.group.id, seq: groupSendSeq(v.group), noted: v.group.linked?.worktreeName }))
    // Un id hors forme n'a pas de nom de worktree (`groupWorktree` rend null) : rien ne se lance pour lui.
    .filter(x => x.seq > 1 && isGroupId(x.id))
    // Le nom noté à cet envoi, celui que la fermeture cherchera, quand il est en forme ; sinon le nom calculé, comme avant.
    .map(x => `Worktree et branche de cet envoi : ${isNotedWorktree(x.noted, x.id, x.seq) ? x.noted : (groupWorktree(run, x.id, x.seq) ?? '')} (${x.seq}e envoi du groupe ${x.id} : les noms des envois précédents restent pris), à la place de ${groupWorktree(run, x.id) ?? ''} ; titre : « ${linkedPrefix(run)}${groupTitle(x.id, x.seq)}<thème> », qui le distingue de la session précédente. `)
    .join('')

/**
 * En mode auto, un groupe renvoyé (deuxième envoi, revenu avec des tickets ouverts) repart avec ce que
 * la session précédente a trouvé. Rien pour un premier envoi.
 */
const resentFindings = (views: readonly GroupView[]): string =>
  views
    .filter(v => v.group.delegated !== undefined)
    .map(v => `Le groupe ${v.group.id} repart après un envoi revenu avec des tickets ouverts : donne à sa session ce que la précédente a trouvé (son compte rendu au relais, sa branche), pour qu'elle reprenne là où elle s'est arrêtée. `)
    .join('')

/** Le refus de lancer un groupe à l'id hors forme : ce qu'il faut faire pour le lancer. */
export const unsafeGroupToast = (ids: readonly string[]): string =>
  `Pas de worker pour ${ids.map(id => `« ${neutralInPrompt(String(id))} »`).join(', ')} : un id de groupe n’a que des ${GROUP_ID_FORM_FR}, sinon sa session ne se fermerait jamais d’office. Renomme le groupe dans le plan (demande à Claude de renvoyer les groupes avec un id en forme), puis lance-le.`

/** Les efforts sous xhigh : relevée à l'un d'eux, une discussion de l'app plafonne la session xhigh qu'elle lance. */
const BELOW_XHIGH: readonly string[] = ['low', 'medium', 'high']

/**
 * Confie des groupes prêts à des workers : ils passent « worker à lancer », la demande
 * va dans le prompt. `imposed` : l'effort fixé par le bouton ; `surface` : celle de l'appui, où
 * l'app Desktop plafonne la session à l'effort de cette discussion.
 */
const delegateGroups = async ($: any, ids0: readonly string[], imposed?: ImposedEffort, surface?: string) => {
  // Juste avant de lancer, le fichier des missions relu : une lecture ratée ne lance rien ; un groupe retenu par une autre mission reste.
  const held = await launchHolds($, ids0, true)
  if (held === null) return
  const ids = ids0.filter(id => !held.some(h => h.held === id))
  // Les groupes retenus se disent dans le seul toast de l'action : un second le cacherait.
  const heldNote = held.length > 0 ? `⏸ Retenu : ${held.map(holdLine).join(' ; ')}` : ''
  if (ids.length === 0) {
    if (heldNote) await quietly(() => $.ui.toast(`${heldNote}. « ⇥ Forcer » sur sa ligne le lance quand même.`))
    return
  }
  const run = activeRun(await read($, boardAtom))
  const plan = run ? groupPlan(run) : null
  if (!run || !plan) return
  // L'id de la mission, relu du fichier partagé, entre dans le brief : hors forme, rien n'est lié ni mis dans le prompt.
  if (!isSafeId(run.id)) {
    await quietly(() => $.ui.toast(unsafeToast({ unsafe: 'l’id de la mission' })))
    return
  }
  const now = await $.clock.now()
  // Un id hors forme (d'avant la règle) ne se lance pas : il faut d'abord renommer le groupe. Le
  // refus va dans le seul toast de l'action, après le lancement des autres : un second toast le cacherait.
  const bad = ids.filter(id => !isGroupId(id))
  const refusal = [heldNote, bad.length > 0 ? unsafeGroupToast(bad) : ''].filter(x => x !== '').join(' — ')
  const fine = ids.filter(id => isGroupId(id))
  // Une autre mission devenue active entre la lecture et la note n'est pas touchée : rien n'est lié, rien ne part.
  const noted = fine.length > 0 ? await linkGroups($, run.id, fine, now) : null
  if (!noted) {
    if (refusal) await quietly(() => $.ui.toast(refusal))
    return
  }
  const views = withNotedGroups(
    plan.groups.filter(g => fine.includes(g.group.id) && g.open.length > 0),
    noted,
    now,
  )
  if (views.length === 0) {
    if (refusal) await quietly(() => $.ui.toast(refusal))
    return
  }
  await update($, uiAtom, ui => ({ ...ui, selection: [] }))
  // Le brief cite le fichier des choix : il existe avant que la session le lise, sinon le brief n'en cite pas le chemin.
  const decidedAt = await writeDecidedFile($, await read($, boardAtom))
  // Dans une mission en auto, le bouton confie le groupe avec la demande du mode auto (worker autonome, sans question xhigh).
  // La mission écrite par la note de l'envoi : le gabarit et les noms du brief sont ceux que la fermeture cherchera.
  const text = await delegationText($, noted, views, decidedAt, imposed, await isAutoHere($, await read($, boardAtom)))
  // Contrôlés avant le lien : ce cas ne se voit pas ; s'il se voyait, les groupes redeviennent à lancer.
  if (isUnsafe(text)) {
    // Les seuls liens que cette note a posés, sur cette mission : un lien d'un autre envoi reste.
    for (const v of views) await cancelNotedLink($, run.id, v.group.id, now)
    await quietly(() => $.ui.toast(unsafeToast(text)))
    return
  }
  const names = views.map(v => v.group.id).join(', ')
  // Le chemin Fable n'a pas de plafond à lever : le mod du worker impose son effort, rien à monter ici.
  const how = imposed === 'fable' ? ' sur Fable 5.2 high' : imposed ? ` en ${imposed}` : ''
  const current = imposed === 'xhigh' ? await sessionEffort($) : undefined
  const raise = surface === 'desktop' && current !== undefined && BELOW_XHIGH.includes(current) ? `. Avant Entrée, passe cette discussion en xhigh (elle est en ${current}) : l'app ne donne jamais à la session un effort plus haut` : ''
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() =>
    // Le refus d'abord : à la fin d'un long toast, il serait coupé (barre de notification sur une ligne).
    $.ui.toast(`${refusal ? `${refusal} — ` : ''}${isFilled ? `Worker${views.length > 1 ? 's' : ''} pour ${names}${how} : la demande est dans le prompt, Entrée pour la lancer${raise}` : `Demande à taper : confie ${names} à des workers${how}`}`),
  )
}

/**
 * Ce qu'une demande de revue dit des failles en mode auto : la règle de l'auto (toutes corrigées d'office),
 * à la place de « je décide de leur correction ».
 */
const AUTO_FINDINGS_FR =
  "la mission est en mode auto : corrige d'office chaque faille gardée (applique, teste, commite, puis renvoie \"fixed\") ; seule la décision d'en laisser une sans correctif me revient, en question bloquante sur son groupe"

/**
 * La demande de revue d'un groupe rendu par son worker sans revue : ici, sa branche est fusionnée
 * et `/code-review` n'aurait rien à lire ; Claude la fait faire à la session, sur les commits du groupe
 * lus sur le code actuel, puis marque le groupe relu. Null quand le groupe n'a pas été rendu par une
 * worker. `isAuto` : envoyée par le mode auto. L'id du groupe et celui de sa session, relus du
 * fichier partagé, hors forme : la demande ne s'écrit pas (`Unsafe`) ; la branche par défaut du
 * distant, hors forme ou inconnue : la demande la nomme « la branche principale », sans commande.
 */
const linkedReviewText = async ($: any, run: Run, groupId: string, isAuto = true): Promise<string | null | Unsafe> => {
  const group = run.groups?.find(g => g.id === groupId)
  if (!group?.delegated) return null
  if (!isGroupId(group.id)) return { unsafe: 'l’id du groupe' }
  const sessionId: unknown = group.delegated.session
  if (sessionId !== undefined && sessionId !== '' && !isSafeId(sessionId)) return { unsafe: `l’id de la session du groupe ${group.id}` }
  noteReferences($)
  const isRepo = await measureRepo($)
  const main = (await read($, syncAtom)).main
  const session = isSafeId(sessionId) ? ` (id ${sessionId})` : ''
  // Les arguments de sa revue suivent sa sensibilité : sans --fix pour un groupe sensible, comme depuis le panneau.
  const args = groupReviewArgs(run, group)
  return (
    `Fais faire la revue du groupe ${group.id} (${neutralInPrompt(group.name)}) de la mission « ${neutralInPrompt(run.title)} » par son worker : le groupe est revenu sans revue, et ici sa branche est déjà fusionnée. ` +
    `Sa session a un titre qui commence par ${linkedTitles(run, group.id)}${session} : retrouve-la par ListAgents. ` +
    `Envoie-lui par SendMessage : ` +
    (isRepo
      ? isSafeBranch(main)
        ? `1) remettre sa branche au niveau de ${main} par une avance rapide (git merge --ff-only ${main}), pour que les correctifs portent sur le code actuel ; `
        : '1) remettre sa branche au niveau de la branche principale par une avance rapide, pour que les correctifs portent sur le code actuel ; '
      : '1) travailler sur le code actuel ; ') +
    `2) lancer elle-même la revue, ${LINKED_GROUP_REVIEW} ; la revue est /${slashOf('final-review')} ${args} (outil Skill « ${slashOf('final-review')} », arguments « ${args} ${isRepo ? '<plage> ' : ''}consignes : <chemin> ») ${isRepo ? "sur les seuls commits du groupe, lus sur le code actuel, avec pour cible leur plage <commit d'avant le premier du groupe>..<dernier commit du groupe> (une revue sans cible n'y verrait aucun changement, et un hash seul ne relirait qu'un commit)" : `sur les seuls changements du groupe, lus sur le code actuel (${LINKED_NO_GIT_GROUP_POINT} : sa session a pris ces copies dans son dossier temporaire)`}, en lui donnant ${decidedList(await writeDecidedFile($, await read($, boardAtom)))} et la consigne des relecteurs (section 7 de la procédure des workers de groupe, ${procedurePath}), par son fichier de consignes, et en lui demandant de se concentrer sur les interactions entre les tickets ; ${SENSITIVE_NO_FIX_FR} ; ${NO_ARBITRATION} ; ` +
    `3) au retour de la revue, relire le diff de ses correctifs, relancer les contrôles du projet, suite complète comprise, et commiter ; un correctif qui contredit une série en vigueur du fichier de décisions se défait avant le commit et devient une question (--fix l'a appliqué avant toute recherche) ; ` +
    `4) juger si une revue de sécurité vaut la peine (les changements du groupe touchent : ${SECURITY_AREAS}) et, si oui, ${(await securityReviewNow($)) === 'off' ? LINKED_SECURITY_OFF_FR : linkedSecurityReview(isRepo ? 'les commits du groupe' : `les changements du groupe (${LINKED_NO_GIT_GROUP_POINT})`)} ; ` +
    `5) envoyer son compte rendu par SendMessage : constats et corrigés, commits, contrôles, avis et failles de sécurité. ` +
    `Si la session n'existe plus ou si l'outil Skill refuse la revue, ${isAuto ? 'déclare-le en question bloquante sur le groupe ("waiting")' : 'dis-le-moi'} : je la lancerai moi-même. ` +
    `Au compte rendu : vérifier son travail${isRepo ? `, fusionner sa branche (${MERGE_MOVED})` : ''}, puis envoyer à l'outil flow {"reviewed": [${asciiJson(group.id)}]} et {"security": {"group": ${asciiJson(group.id)}, "advised": true|false, "why": "<raison>"}}, avec "findings" et "fixed" si la revue de sécurité a tourné ; ${isAuto ? AUTO_FINDINGS_FR : 'me dire les failles trouvées : je décide de leur correction'} ; ${isAuto ? FIXED_LATER_AUTO : FIXED_LATER}.`
  )
}

/** « ◆ Revue du groupe · worker » : la demande va dans le prompt, Entrée la lance. */
const reviewLinkedGroup = async ($: any, groupId: string) => {
  const run = activeRun(await read($, boardAtom))
  const text = run ? await linkedReviewText($, run, groupId, await isAutoHere($, await read($, boardAtom))) : null
  if (!text) return
  if (isUnsafe(text)) {
    await quietly(() => $.ui.toast(unsafeToast(text)))
    return
  }
  // Lancée à la main : la marque de l'auto, démarrée, pour qu'il ne la redemande pas (mission qui a été en auto).
  const now = await $.clock.now()
  await commit($, b => markAutoLaunched(b, run ? linkedReviewMark(run, groupId) : null, now))
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() =>
    $.ui.toast(isFilled ? `Revue de ${groupId} par son worker : la demande est dans le prompt, Entrée pour la lancer` : `Demande à taper : fais relire ${groupId} par son worker`),
  )
}

/**
 * La demande de revue de sécurité d'un groupe relu (ou du lot sans groupes, `id` « lot ») : Claude la
 * lance d'ordinaire lui-même après la revue ; le bouton, ou le mode auto pour une revue conseillée, la
 * lui demande. Jamais `/security-review`, qui relit la branche face à la branche par défaut. Null pour
 * un groupe inconnu. `isAuto` : envoyée par le mode auto. L'id du groupe, relu du fichier partagé,
 * hors forme : la demande ne s'écrit pas (`Unsafe`).
 */
const securityReviewText = async ($: any, run: Run, id: string, isAuto = true): Promise<string | null | Unsafe> => {
  const group = id === 'lot' ? undefined : run.groups?.find(g => g.id === id)
  if (id !== 'lot' && !group) return null
  if (group && !isGroupId(group.id)) return { unsafe: 'l’id du groupe' }
  const isRepo = await measureRepo($)
  const scope = !group
    ? 'les changements que la revue de cette mission a relus'
    : !isRepo
      ? `les changements du groupe ${group.id} (pour chaque fichier, la différence entre la plus ancienne copie prise avant ses tickets, dans le dossier temporaire de la session qui les a faits, et le fichier actuel ; les fichiers nouveaux en entier)`
      : group.delegated
        ? `les commits du groupe ${group.id}, lus sur le code actuel`
        : `git diff <base>..<lancement> (<base> : le commit d'avant le premier ticket du groupe ${group.id} ; <lancement> : le hash de HEAD au lancement, écrit en clair dans ses consignes, pour que les correctifs de la revue du groupe se commitent pendant qu'elle tourne sans changer son périmètre)`
  const what = group ? `du groupe ${group.id} (${neutralInPrompt(group.name)})` : 'de cette mission'
  const send = group ? `{"security": {"group": ${asciiJson(group.id)}, "findings": <failles gardées>, "fixed": <corrigées>}}` : '{"security": {"findings": <failles gardées>, "fixed": <corrigées>}}'
  // Le lot : l'avis du passage d'abord, au lancement, seul envoi qui ouvre le passage en cours quand l'avis
  // enregistré est d'avant la dernière fin de ticket ou la dernière revue ; les comptes suivent sans lui, et des comptes arrivés
  // après une nouvelle fin de ticket restent sur l'avis d'avant, sans rien trancher.
  const advise = group || run.tickets.length === 0 ? '' : 'Avant de la lancer, envoie à l\'outil flow {"security": {"advised": true, "why": "<raison>"}} : l\'avis de ce passage. '
  noteReferences($)
  const decide = isAuto ? ` ; ${AUTO_FINDINGS_FR}.` : ', je décide de leur correction ; une réponse comme « corrige F1 et F3 » suffit : applique-les, teste-les, commite-les.'
  return (
    `${advise}Lance la revue de sécurité ${what} : confie-la à un spécialiste relecteur (outil Agent, type general-purpose, modèle opus, effort high, en une seule passe : il cherche et vérifie lui-même, sans lancer d'agent), en lecture seule, avec pour seul périmètre ${scope}, pour critères ${SECURITY_AREAS} et pour méthode ${securityMethodFr().replace('le fichier de méthode', 'le chemin du fichier de méthode')}, ${INSTRUCTIONS_IN_PROMPT_FR} ; ` +
    `pas /security-review, qui relit la branche face à la branche par défaut, donc aussi les autres groupes. Le spécialiste ne corrige rien : chaque faille gardée arrive numérotée (F1, F2…) avec un correctif prêt (ce qu'il change, le choix qu'il implique s'il y en a un)${decide} Puis envoie à l'outil flow ${send} (les failles gardées seulement, pas la liste « à surveiller ») ; ${isAuto ? FIXED_LATER_AUTO : FIXED_LATER}.`
  )
}

/**
 * « ⛨ Revue de sécurité » sur un groupe relu (ou sur le lot sans groupes) : la demande va dans le
 * prompt, Entrée la lance.
 */
const securityReview = async ($: any, id: string) => {
  const run = activeRun(await read($, boardAtom))
  const text = run ? await securityReviewText($, run, id, await isAutoHere($, await read($, boardAtom))) : null
  if (!run || !text) return
  if (isUnsafe(text)) {
    await quietly(() => $.ui.toast(unsafeToast(text)))
    return
  }
  const group = id === 'lot' ? undefined : run.groups?.find(g => g.id === id)
  const what = group ? `du groupe ${group.id} (${neutralInPrompt(group.name)})` : 'de cette mission'
  // Lancée à la main : la marque de l'auto, démarrée, pour qu'il ne la redemande pas (mission qui a été en auto).
  const now = await $.clock.now()
  // Le lot seulement sans groupes : avec des groupes, « lot » nommerait un groupe de ce nom, dont la demande n'est pas partie.
  const mark = group ? securityReviewMark(run, group.id) : (run.groups ?? []).length === 0 ? securityReviewMark(run, 'lot') : null
  await commit($, b => markAutoLaunched(b, mark, now))
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? `Revue de sécurité ${what} : la demande est dans le prompt, Entrée pour la lancer` : `Demande à taper : revue de sécurité ${what}`))
}

/** « ↗ Worker » sur un groupe prêt : un worker le fait, la mission reste ici. */
const launchGroupLinked = ($: any, groupId: string) => delegateGroups($, [groupId])

/** « ↗ xhigh » sur un groupe prêt : le même worker, en xhigh imposé, sans question sur l'effort. */
const launchGroupLinkedXhigh = ($: any, groupId: string, surface?: string) => delegateGroups($, [groupId], 'xhigh', surface)

/** « ↗ Fable » sur un groupe prêt : le worker Fable (Fable 5.2 high par son mod), le seul brief Fable, sans question sur l'effort. */
const launchGroupLinkedFable = ($: any, groupId: string) => delegateGroups($, [groupId], 'fable')

/**
 * « ↻ Relancer la fermeture » sur un groupe rendu dont la fermeture s'est arrêtée (elle part sinon
 * d'office, par la réponse de l'outil) : la cause réglée, la demande va dans le prompt, avec la
 * procédure partagée de `closing.ts` (vérifier d'abord, rien de forcé, la branche gardée).
 */
const closeLinkedGroup = async ($: any, groupId: string) => {
  const run = activeRun(await read($, boardAtom))
  const group = run?.groups?.find(g => g.id === groupId)
  if (!run || !group?.delegated) return
  const now = await $.clock.now()
  if (!(await commit($, b => askCloseLinkedGroup(b, groupId, now)))) return
  const isRepo = await measureRepo($)
  const target = { kind: 'group', id: group.id, name: group.name } as const
  // Le compte rendu de sa session, relu au relais à l'instant, ou, sans aucun compte rendu de lui au relais, le dépôt du
  // manager pour cet envoi : absent des deux, pas de claude rm (session gardée) ; relais lu en partie ou illisible, le dépôt
  // ne compte pas (une entrée illisible peut cacher le compte rendu du worker).
  // Sa fenêtre s'arrête au nouvel envoi du groupe, s'il y en a un : le compte rendu de la nouvelle session ne vaut pas pour elle.
  const gaps = { count: 0 }
  const stored = await readRelay($, run.id, gaps)
  const relay = isRelay(stored, run.id) ? stored : null
  const report = groupReportOf(relay, group, run.groups, group.delegated, group.linked?.at ?? Infinity, gaps.count === 0)
  const hasReport = report !== undefined
  const text = `${closingProcedure({ run, target, isRepo, ...(group.delegated.session ? { session: group.delegated.session } : {}), ...(group.delegated.seq !== undefined ? { seq: group.delegated.seq } : {}), hasReport, isReportByManager: report?.isByManager === true, noted: group.delegated.closing, send: group.delegated })} ${closedHint(target, undefined, group.delegated)}`
  await fillRequest(
    $,
    text,
    // Un id ou un nom de worktree noté hors forme (ou en conflit), ou un id de session non noté sûrement : la demande est un refus ; le toast ne propose jamais de fermer à la main.
    !isGroupId(group.id)
      ? 'Fermeture refusée : l’id du groupe est hors forme ; la demande le dit à Claude, Entrée pour l’envoyer'
      : !hasSendName(group.id, group.delegated.seq, group.delegated)
        ? `Fermeture de ${group.id} refusée : ${sendRefusalFr(group.delegated)} ; la demande le dit à Claude, Entrée pour l’envoyer`
        : `Fermeture de ${group.id} : la demande est dans le prompt, Entrée pour la lancer`,
    !isGroupId(group.id)
      ? 'Fermeture refusée : l’id du groupe est hors forme, aucune session ni aucun worktree ne se ferme d’ici'
      : !hasSendName(group.id, group.delegated.seq, group.delegated)
        ? `Fermeture de ${group.id} refusée : ${sendRefusalFr(group.delegated)}, aucune session ni aucun worktree ne se ferme d’ici`
        : `Demande à taper : ferme la session et le worktree de ${group.id}, en vérifiant d'abord, sans rien forcer, seulement propre et fusionné, la branche gardée`,
  )
}

/**
 * « ↻ Relancer la fermeture » sur la session des éléments de la phase (les pistes d'une rétro),
 * arrêtée : la demande va dans le prompt, avec la même procédure que la réponse de l'outil.
 */
const closeLinkedItems = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  const phase = run ? currentPhase(run) : undefined
  const session = phase?.linked?.session
  if (!run || !phase || !session) return
  const now = await $.clock.now()
  if (!(await commit($, b => askCloseLinkedItems(b, now)))) return
  const isRepo = await measureRepo($)
  const target = { kind: 'items', skill: phase.skill } as const
  const label = SKILLS[phase.skill]?.items?.label.toLowerCase() ?? 'éléments'
  const seq = phase.linked?.seq
  await fillRequest(
    $,
    `${closingProcedure({ run, target, isRepo, session, ...(seq !== undefined ? { seq } : {}), hasReport: false })} ${closedHint(target)}`,
    `Fermeture de la session des ${label} : la demande est dans le prompt, Entrée pour la lancer`,
    `Demande à taper : ferme la session des ${label} et son worktree, en vérifiant d'abord, sans rien forcer, la branche gardée`,
  )
}

/** Annule l'envoi d'un groupe à un worker qui n'a pas été lancée. */
const cancelGroupLinked = async ($: any, groupId: string) => {
  const now = await $.clock.now()
  await commit($, b => cancelLinkedGroup(b, groupId, now))
}

/** Le lot n° `at` du plan : 0 pour le lot principal, puis les autres lots. */
const lotAt = (run: Run, at: number, outside?: ReadonlyMap<string, readonly OutsideHold[]>): string[] => {
  // Le lot affiché : calculé avec les retenues entre missions, comme le panneau et la carte.
  const plan = groupPlan(run, outside)
  if (!plan) return []
  return at === 0 ? plan.parallelBatch : (plan.otherBatches[at - 1] ?? [])
}

/** « ⇉ … en parallèle · workers » : un worker par groupe du lot. */
const launchParallelLinked = async ($: any, at = 0) => {
  const board: Board | null = await read($, boardAtom)
  const run = activeRun(board)
  const lot = run ? lotAt(run, at, holdMapOf(holdsHere(board))) : []
  if (lot.length < 2) return
  await delegateGroups($, lot)
}

/**
 * L'effort d'une session de diagnostic de bug : high, un bug difficile demandant du raisonnement
 * sans choix de conception ; xhigh pour une deuxième tentative sur le même bug ; pas de troisième.
 */
const BUG_EFFORT =
  "Effort de la session (<effort>) : high pour une première tentative ; xhigh pour une deuxième, quand une session de bug de cette mission a déjà essayé de corriger ce même bug et qu'il est toujours là : son brief donne alors ce que la première a trouvé et essayé. Pas de troisième session après un second échec : on replanifie ensemble ici. Dis-moi en une ligne l'effort choisi et pourquoi."

/**
 * Fait diagnostiquer un bug par un worker, en détour de la phase de code ou de revue en
 * cours : la demande va dans le prompt, et la personne décrit le bug à la fin, après « Bug : ».
 */
const launchBugLinked = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  if (!run) return
  // Le passage de la mission à la session de diagnostic, ouvert par ce clic : elle la prend par `resume`, une fois, dans l'heure.
  const now = await $.clock.now()
  await commit($, board => (activeRun(board)?.id === run.id ? openHandoff(board, now) : null))
  const phase = SKILLS[currentPhase(run).skill]?.label ?? neutralInPrompt(String(currentPhase(run).skill))
  // L'id de la mission, relu du fichier partagé, échappé en JSON : il se recopie exact sans rien glisser dans le brief.
  const resume = `{"resume": ${asciiJson(run.id)}}`
  const prefix = linkedPrefix(run)
  const text =
    `Lance un diagnostic de bug dans un worker, pour la mission « ${neutralInPrompt(run.title)} » (phase ${phase}), avec un titre qui commence par « ${prefix}Bug · ». ` +
    // Elle reprend la mission (`resume`) : il faut qu'elle lise le même fichier, donc ce dossier, pas un worktree.
    launchHow({ many: false, isRepo: false, ownFolder: false, title: `${prefix}Bug · <sujet>`, worktree: '', effort: BUG_EFFORT, isOpus: true }) +
    `Brief de la session : 1) d'abord, appeler l'outil flow de flow-board avec ${resume}, pour reprendre la mission dans la session (dans l'heure : le passage ouvert par mon clic ne vaut qu'une fois) ; ` +
    `2) puis lancer /${await commandFor($, 'diagnosing-bugs')} avec la description du bug ci-dessous : le diagnostic s'affiche en détour de la phase en cours ; ` +
    `3) corriger en suivant le CLAUDE.md du projet (contrôles, revue et commit) et proposer en tâche ce qui reste ouvert ; ` +
    `4) à la fin, envoyer {"complete": true} pour clore le détour. ` +
    `Ici, ne rien enregistrer sur cette mission tant que la session travaille ; ${atEnd('la session').replace(/^À/, 'à')}, vérifier son travail, puis, dans les deux cas, reprendre d'abord la mission ici avec ${resume} (la session la tient jusque-là) ; si le bug est toujours là, arrêter la session (ci-dessous), puis me le dire et me proposer la deuxième tentative (règle d'effort ci-dessus), que je lance par un nouveau clic sur « 🐞 Bug · worker » (le passage ne sert qu'une fois) ; sinon, poursuivre la mission. Dans les deux cas, arrêter la session, seulement si elle ne travaille plus (claude agents --json : "status": "idle", pas "state": "working" ; ListAgents pour une session de l’app) et qu’aucune question de sa part n’attend : claude stop <id> (sa conversation est gardée) ; dans l’app, me demander mon accord pour cette session, puis l’archiver par l’outil archive_session (l’accord donné d’avance par /flow archive on ne vaut que pour la fermeture d’un groupe ou des pistes, relue à chaque fois), sinon me dire le geste ; pas de worktree ici ; après un échec, avant de me proposer la deuxième tentative (une nouvelle session ; le transcript de la première reste) ou de replanifier ; après un correctif vérifié et commité, une fois la mission reprise ici. ` +
    `Bug : `
  let isFilled = false
  await quietly(async () => {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled === true
  })
  await quietly(() => $.ui.toast(isFilled ? 'Bug dans un worker : décris-le après « Bug : », puis Entrée' : 'Demande à taper : lance un diagnostic de bug dans un worker'))
}

/** Comment rendre chaque élément confié à la note de fin de sa session. */
const ITEM_VERDICTS = "done si elle est faite et vérifiée ; todo si elle n'a pas été faite (elle revient à mon choix, sans être écartée) ; dropped seulement si je décide de l'abandonner"

/**
 * La demande à Claude pour lancer un worker sur des éléments de la phase (les pistes d'une
 * rétro). Les éléments ne portent qu'un libellé : c'est la discussion d'ici, qui connaît la session
 * étudiée, qui rédige le brief.
 */
const itemsRequest = async ($: any, run: Run, phase: FlowPhase, ids: readonly string[]): Promise<string> => {
  const def = SKILLS[phase.skill]!
  const label = def.items!.label.toLowerCase()
  const list = itemList(phase.items.filter(i => ids.includes(i.id)))
  // Sans git, pas de worktree possible : la session travaille dans ce dossier.
  const isRepo = await measureRepo($)
  return (
    `Traite ces ${label} de la phase ${def.label} de la mission « ${neutralInPrompt(run.title)} » dans un worker : ${list}. ` +
    `Avant de la lancer : repère les ${label} qui ont besoin d'une information ou d'une décision de ma part (un accès, un choix entre options) et règle-les d'abord avec moi ici, sinon la session y butera. ` +
    `Puis lance la session, avec un titre qui commence par « ${linkedPrefix(run)}${def.items!.label} · ». ` +
    launchHow({ many: false, isRepo, ownFolder: true, title: `${linkedPrefix(run)}${def.items!.label} · <sujet>`, worktree: itemsWorktree(run, label, phase.linked?.seq), isOpus: true }) +
    `Si tu ne peux pas la lancer (outil absent, refus, erreur), dis-le-moi avec la raison et n'envoie rien sur ces ${label} à l'outil flow : le tableau de bord les garde à lancer, avec « Redemander » et « Annuler ». ` +
    `Seules les ${label} de ce dépôt vont à la session : une ${def.items!.label.toLowerCase().replace(/s$/, '')} qui touche un autre dépôt (plugins, config commune, autre projet) ne s'applique pas d'ici : ne la mets pas dans le prompt de la session, donne-la-moi dans une liste de corrections prête à confier à un agent de ce dépôt (le constat, puis la correction attendue), et, une fois la session lancée (son id relevé), rends-la à l'outil flow en todo : elle quitte l'envoi et revient à mon choix. Si aucune de ces ${label} n'est de ce dépôt, ne lance pas de session : donne-moi la liste et dis-moi d'utiliser « Annuler » au tableau de bord. ` +
    `Rédige toi-même le background, sans y reprendre le texte des règles : les règles de travail (écritures permises, gestes qui me sont réservés, dépôt public, contraintes du projet) sont dans le document du projet pour les sessions déléguées s'il en a un (son CLAUDE.md le nomme), sinon dans son CLAUDE.md, et dans mes règles communes ; la session les charge d'elle-même, le background les cite par leur chemin. Il ne garde que ce qui varie : le projet en une phrase, la session étudiée par la rétro, la ressource unique à ne pas partager (une appli ouverte), les décisions déjà prises par renvoi au fichier de décisions du projet. ` +
    `Rédige le prompt avec une section par piste : le problème constaté (une phrase), la correction attendue, les fichiers touchés et un critère de fin vérifiable. ` +
    `Consignes du prompt : travailler en séquence, en regroupant les pistes qui touchent les mêmes fichiers, sans spécialistes qui écrivent (des spécialistes en parallèle seulement pour des recherches en lecture seule et indépendantes) ; suivre le CLAUDE.md du projet et lancer à la fin les contrôles qu'il déclare ; ne pas utiliser l'outil flow de flow-board ni reprendre cette mission, qui reste dans le manager ; finir par un compte rendu avec une ligne par piste (faite, ou pas faite et pourquoi), les fichiers modifiés${isRepo ? ', sa branche' : ''}, les contrôles lancés et leur résultat, et ce qui m'attend. ` +
    `Ici : garder la mission (pas de resume ni de nouvelle mission) et suivre la session sans l'attendre activement : ${FOLLOW(isRepo)}. ` +
    `${atEnd('la session')}, vérifier son travail (diff, commits, contrôles${isRepo ? ', fusion de sa branche' : ''}), puis envoyer à l'outil flow la liste complète des items avec le statut de chacun : ${ITEM_VERDICTS}, puis, si la session est close (la réponse de l’outil la liste « Close now »), la fermer selon la procédure qu’elle donne et envoyer {"closed": [...]}, et enfin {"complete": true} si aucune n'est revenue à todo : la rétro ne se clôt qu'une fois la fermeture de la session tentée.`
  )
}

/**
 * Le message que « ✓ Valider le rapport » envoie à Claude : la validation, la suite qu'elle ouvre,
 * et, dans un dépôt git, ce qu'elle fait des branches des workers (`branchCleanup`), avec les
 * branches que vise sa consigne. Avec elles, le titre de la mission, du texte libre, n'y entre pas : il
 * ne peut pas se glisser parmi les commandes.
 */
const reportValidated = (run: Run | undefined, isRepo: boolean, root: unknown): { text: string; branches: string[] } => {
  let cleanup: { text: string; branches: string[] } | null = null
  let isBroken = false
  // Une consigne qui ne s'écrit pas (un tableau de bord mal formé) ne fait perdre ni la validation, ni le dire.
  try {
    cleanup = run ? branchCleanup({ run, isRepo, root }) : null
  } catch {
    isBroken = true
  }
  const suite = "dis-moi la suite en une ligne, d'après la réponse de l'outil flow."
  if (cleanup) return { text: `J'ai validé le compte rendu depuis le tableau de bord (✓ Valider le rapport). Ne me le redemande pas. ${cleanup.text} Puis ${suite}`, branches: cleanup.branches }
  const head = `J'ai validé le compte rendu${run?.title ? ` de la mission « ${neutralInPrompt(run.title)} »` : ''} depuis le tableau de bord (✓ Valider le rapport). Ne me le redemande pas`
  const text = isBroken ? `${head}. La consigne des branches des workers n’a pas pu s’écrire : aucune n’est supprimée ; dis-le-moi. Puis ${suite}` : `${head} ; ${suite}`
  return { text, branches: [] }
}

/**
 * Valide le compte rendu de la mission portée ici, comme « ✓ Valider le rapport » : la phase close, les choix
 * relus, puis le message de validation à son Claude (nettoyage des branches des workers compris).
 * `isAllowed` se relit sur le board de l'écriture (la validation relayée par le COO y vérifie la version lue) ;
 * rend vrai quand la validation s'est écrite.
 */
const validateHere = async ($: any, isAllowed: (run: Run) => boolean = () => true): Promise<boolean> => {
  const now = await $.clock.now()
  const isRepo = await measureRepo($)
  // La consigne part de la mission tel que la transition l'a validé (l'écriture rejouée comprise), pas d'une copie lue avant.
  let run: Run | undefined
  let root: unknown
  const fx = await commit($, board => {
    const run0 = activeRun(board)
    if (!run0 || !isAllowed(run0)) return null
    const out = validateReport(board, now)
    run = out ? (activeRun(out.board) ?? undefined) : undefined
    root = out?.board.root
    return out
  })
  if (!fx) return false
  // Le clic vaut réponse : sans message, Claude attendait sans savoir que le rapport était validé.
  // Il part au nom du mod (jamais `asUser`), et ne retient pas le bouton pendant le tour qu'il ouvre.
  const { text, branches } = reportValidated(run, isRepo, root)
  const runId = run?.id
  void quietly(async () => {
    const result = await $.prompt.submit({ text })
    // Le message entré dans la session (ni refusé, ni retiré : `drop` absent ou `undefined`, que le type
    // permet à un message entré), chaque fermeture visée se marque (série 24) : un envoi raté ne marque
    // rien. L'heure se relit : l'envoi a pu attendre.
    const isEntered = result !== null && typeof result === 'object' && typeof result.text === 'string' && result.drop === undefined
    if (!isEntered || runId === undefined || branches.length === 0) return
    const at = await $.clock.now()
    await commit($, board => markCleanupSent(board, runId, branches, at))
  })
  return true
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
 * « ✂ Découper » : les éléments choisis de la phase (les pistes d'une rétro) partent dans une demande
 * de découpage en tickets, mise dans le prompt. Rien n'est enregistré au tableau de bord : seule la
 * sélection se vide ; l'appel du découpage, validé par la personne, enregistre tout d'un coup.
 */
const splitItems = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  if (!run || run.status !== 'active') return
  const phase = currentPhase(run)
  const def = SKILLS[phase.skill]
  const picked = (await read($, uiAtom)).itemSelection ?? []
  // Le fichier de coordination relu juste avant : une piste marquée déjà prise ailleurs n'entre jamais dans le découpage.
  const board: Board | null = await read($, boardAtom)
  if (board) await refreshCoordSeen($, board)
  const items = pickableItems(phase, new Set(takenHere(board).taken.keys())).filter(i => picked.includes(i.id))
  if (!def?.items?.linkedStep || items.length === 0) return
  await update($, uiAtom, ui => ({ ...ui, itemSelection: [] }))
  const label = def.items.label.toLowerCase()
  await fillRequest($, splitRequest(run, phase, items, otherMissionFiles(board, run.id)), `Découpage de ${items.length} ${label} : la demande est dans le prompt, Entrée pour l’envoyer à Claude`, `Demande à taper : découpe en tickets les ${label} choisies`)
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
  await fillRequest($, text, `Worker redemandé pour ${ids.length} ${label} : Entrée pour l'envoyer à Claude`, `Demande à taper : traite les ${label} confiées dans un worker`)
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
  const list = itemList(linkedInFlight(phase))
  const title = neutralInPrompt(run.title)
  // Lire une session : l'outil de l'app Desktop, le CLI ou son transcript, qui marche partout.
  const howToRead =
    "avec tes outils de session de l'app Desktop si tu les as, sinon par ListAgents (est-elle encore là), l'état git de son worktree ou de ce dossier (commits, fichiers modifiés), le tracker, et au besoin son transcript, le fichier .jsonl sous ~/.claude/projects/ (pas claude logs, dont la sortie de terminal est illisible)"
  // L'id relevé vient du tableau de bord (un fichier partagé) : recopié seulement en forme, sinon la session se cherche par son titre.
  const session = isSafeId(linked.session) ? linked.session : undefined
  const opening =
    linked.session === undefined
      ? `Aucune session n'a été relevée pour les ${label} de la mission « ${title} » : ${list}.`
      : `L'id de session relevé pour les ${label} de la mission « ${title} » n'a pas une forme sûre : il n'est pas recopié ici. ${list}.`
  const text =
    session !== undefined
      ? `Vérifie l'état du worker (${session}) qui traite les ${label} de la mission « ${title} » : ${list}. Lis-le ${howToRead}. ` +
        `Si elle travaille encore, dis-le-moi et n'envoie rien. Sinon, contrôle son travail (diff, commits, contrôles), puis envoie à l'outil flow la liste complète des items avec le statut de chacun : ${ITEM_VERDICTS} ; enfin {"complete": true} seulement si aucune n'est revenue à todo.`
      : `${opening} Cherche d'abord si une session a été lancée pour elles : un titre qui commence par « ${linkedPrefix(run)}${def?.items?.label ?? ''} · », ${howToRead}, et cette discussion (un appel de lancement, une erreur). ` +
        `Si tu n'en trouves aucune, le lancement n'a pas eu lieu : n'envoie aucun statut à l'outil flow et ne clos pas la phase ; dis-moi ce qui l'a empêché si tu le vois, je choisis dans le tableau de bord entre « Redemander » et « Annuler » (les ${label} reviennent à mon choix). ` +
        `Si tu en trouves une : contrôle son travail (diff, commits, contrôles), envoie à l'outil flow la liste complète des items, les ${label} faites et vérifiées en done et les autres en todo, sans en clore la phase, et dis-moi celles qui restent : je les rends à mon choix par « Annuler ».`
  await fillRequest($, text, `Reprise des ${label} : la demande est dans le prompt, Entrée pour l'envoyer`, `Demande à taper : vérifie le worker et rends les ${label}`)
}

/**
 * « Et maintenant ? » : /ask-matt dans le prompt, avec l'endroit de la mission où l'on est (phase,
 * étape, détour), pour qu'il réponde sur la suite au lieu de repartir de zéro.
 */
const askNext = async ($: any) => {
  const run = activeRun(await read($, boardAtom))
  if (!run) return prepare($, 'ask-matt', 'Aucune mission en cours : par où commencer ?')
  const phase = currentPhase(run)
  const def = SKILLS[phase.skill]
  const stepId = phase.steps.find(s => s.status === 'active')?.id
  const step = def?.steps.find(s => s.id === stepId)?.label
  const detour = activeDetour(phase)
  const where = [
    `mission « ${neutralInPrompt(run.title)} »`,
    `phase ${def?.label ?? neutralInPrompt(String(phase.skill))}${phase.status === 'done' ? ' (terminée)' : ''}`,
    step ? `étape ${step}` : '',
    detour ? `détour ${SKILLS[detour.skill]?.label ?? neutralInPrompt(String(detour.skill))}` : '',
  ]
    .filter(Boolean)
    .join(', ')
  await prepare($, 'ask-matt', `Je suis dans la ${where} : quelle est la suite ?`)
}

const actionsFor = ($: any): Actions => ({
  setTab: async (tab: Tab) => {
    // La fenêtre de la frise repart de « tout » à chaque ouverture de l'onglet Agents.
    await update($, uiAtom, ui => ({ ...ui, tab, ...(tab === 'agents' && ui.tab !== 'agents' ? { agentsWindow: undefined } : {}) }))
    // L'onglet Agents s'ouvre : le rattrapage de la session affichée, l'historique et, la première
    // fois, la reprise des missions existants (Q14), sans attendre.
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
  // Le mode auto, jamais allumé sans le second clic : un premier clic montre ce que l'activation
  // vaut, « Confirmer » l'allume pour la discussion du moment ; un clic le coupe.
  askAuto: async () => {
    const run = activeRun(await read($, boardAtom))
    await update($, uiAtom, ui => ({ ...ui, confirmAuto: run && ui.confirmAuto !== run.id ? run.id : undefined }))
  },
  confirmAuto: async () => {
    const asked = (await read($, uiAtom)).confirmAuto
    await update($, uiAtom, ui => ({ ...ui, confirmAuto: undefined }))
    const now = await $.clock.now()
    const here = await hereId($)
    // Le second clic vaut seulement pour la mission dont le premier a montré le texte.
    const run = activeRun(await read($, boardAtom))
    if (!run || run.id !== asked) return
    // Sa date se garde à part d'abord : sans elle, l'auto ne s'allume pas (il n'enverrait jamais d'ici).
    const wasConfirmed = await confirmedAtFor($, run, here)
    // Déjà allumé d'ici, son clic gardé (un double clic, un panneau pas encore redessiné) : rien à refaire.
    const board0: Board | null = await read($, boardAtom)
    if (board0 && autoStateOf(run, board0, here, wasConfirmed).kind === 'on') return
    const onAt = nextAutoOnAt(run, now)
    if (!(await writeConfirm($, run.id, here, onAt))) {
      await quietly(() => $.ui.toast('⚡ Auto non allumé : le stockage du mod a refusé de garder la date du clic'))
      return
    }
    const fx = await commit($, board => (activeRun(board)?.id === asked ? switchOnAuto(board, here, onAt, wasConfirmed) : null))
    const lit = activeRun(await read($, boardAtom))
    const litAt = lit?.id === run.id ? lit.auto?.onAt : undefined
    if (!fx) await forgetConfirm($, run.id, here)
    // La mission a bougé entre la lecture et l'écriture : la date gardée suit celle qui a été posée.
    else if (litAt !== undefined && litAt !== onAt && !(await writeConfirm($, run.id, here, litAt))) await commit($, board => switchOffAuto(board, litAt))
    // Allumé au repos : l'évaluation envoie à Claude la consigne de l'allumage (`sendBrief`), et la fin du tour
    // de ce message fait décider la suite ; pendant un tour, la fin de ce tour le fait.
    if (fx) autoGestureAt = now
    if (fx && !isTurnOpen) scheduleAutoTurn($, true)
  },
  resendAuto: async (runId: string, key: string) => {
    const now = await $.clock.now()
    if (!(await commit($, board => resendAutoMark(board, runId, key, now)))) return
    autoGestureAt = now
    // Au repos, l'auto renvoie tout de suite, ou d'abord la consigne si Claude n'a pas reçu celle de
    // l'allumage (`sendBrief`) ; pendant un tour, à sa fin.
    if (!isTurnOpen) scheduleAutoTurn($, true)
  },
  stopAuto: async () => {
    const now = await $.clock.now()
    await commit($, board => switchOffAuto(board, now))
  },
  // La mission d'une autre discussion se reprend ici en secours seulement : un premier clic demande « Confirmer
  // (secours) », le second la reprend (choix de Mathis du 09/11/2026 : une mission ne vit que dans sa discussion).
  resume: async (id: string) => {
    const now = await $.clock.now()
    const isConfirmed = (await read($, uiAtom)).confirmResume === id
    // Jugé sur le fichier des missions relu juste avant d'écrire : une mission passée à une autre discussion entre
    // l'affichage et le clic demande encore la confirmation. Une relecture ratée ne reprend rien.
    if (!(await pull($))) {
      await update($, uiAtom, ui => ({ ...ui, confirmResume: undefined }))
      $.ui.toast('◆ Le fichier des missions ne se relit pas : rien n’est repris ; reclique dans un instant.')
      return
    }
    let isAsked = false
    await commit($, board => {
      const target = board.runs.find(r => r.id === id)
      isAsked = target !== undefined && isOtherDiscussions(target, board.session) && !isConfirmed
      return isAsked ? null : resumeRun(board, id, now)
    })
    await update($, uiAtom, ui => ({ ...ui, confirmResume: isAsked ? id : undefined }))
    if (isAsked) return
    // Reprise ici : la référence du moment se redemande au tour suivant (une autre discussion a pu l'écrire entre-temps).
    mainRefWritten.delete(id)
    mainRefFailures.delete(id)
    mainRefKnown.delete(id)
    await update($, uiAtom, ui => ({ ...ui, tab: 'flow' as const }))
  },
  cancelResume: async () => {
    await update($, uiAtom, ui => ({ ...ui, confirmResume: undefined }))
  },
  drop: async (id: string) => {
    const now = await $.clock.now()
    const run = ((await read($, boardAtom)) as Board | null)?.runs.find(r => r.id === id)
    await update($, uiAtom, ui => ({ ...ui, confirmDrop: undefined, ...(ui.agentsHistory === `run:${id}` ? { agentsHistory: undefined } : {}) }))
    // « Définitivement » : ses agents, ses workers, son relais et ses choix (Q6 a1, S3) ; les
    // traces d'abord, et la mission ne quitte le board qu'une fois elles posées (S24).
    if (run) await quietly(() => eraseRun($, run))
    else await commit($, board => dropRun(board, id, now))
  },
  askForget: (key: string) => update($, uiAtom, ui => ({ ...ui, confirmForget: ui.confirmForget === key ? undefined : key })),
  forget: (id: string) => quietly(() => forgetSession($, id)),
  archive: async (id: string) => {
    // Relu d'abord : la marque « clic » ne se pose que sur la mission telle que le fichier la porte à l'instant, et une
    // mission en cours (reprise ailleurs depuis l'affichage : la vue n'offre jamais « ▣ » pour une mission en cours)
    // n'est jamais archivée, avec ou sans marque. Une relecture ratée archive sans marque, comme avant : rien ne se
    // fermera d'office sur un doute, et une reprise ailleurs que la copie d'ici ignore l'emporte à la fusion
    // (`mergeBoards`, une copie en cours ailleurs contre une copie archivée ici).
    const isRead = await pull($)
    const now = await $.clock.now()
    // Refusé par la mission elle-même (absente, reprise, déjà archivée), pas par une écriture ratée : le toast le dit.
    let isRefused = false
    await commit($, board => {
      const run = board.runs.find(r => r.id === id)
      const out = run ? archiveRun(board, id, now, undefined, isRead ? paneArchiveMark(board, run) : undefined) : null
      isRefused = out === null
      return out
    })
    if (isRefused) $.ui.toast('◆ Rien n’est archivé : la mission a changé depuis l’affichage (reprise ailleurs, ou déjà archivée) ; regarde-la de nouveau.')
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
  launchGroupLinkedXhigh: (id: string, surface?: string) => launchGroupLinkedXhigh($, id, surface),
  launchGroupLinkedFable: (id: string) => launchGroupLinkedFable($, id),
  cancelGroupLinked: (id: string) => cancelGroupLinked($, id),
  reviewLinkedGroup: (id: string) => reviewLinkedGroup($, id),
  closeLinkedGroup: (id: string) => closeLinkedGroup($, id),
  closeLinkedItems: () => closeLinkedItems($),
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
    const all = pickableItems(currentPhase(run), new Set(takenHere(await read($, boardAtom)).taken.keys())).map(i => i.id)
    await update($, uiAtom, ui => ({ ...ui, itemSelection: all.every(id => (ui.itemSelection ?? []).includes(id)) ? [] : all }))
  },
  clearItemPicks: () => update($, uiAtom, ui => ({ ...ui, itemSelection: [] })),
  splitItems: () => splitItems($),
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
  validateReport: () => withReportLock(() => validateHere($)),
  redoReport: async () => {
    let isFilled = false
    await quietly(async () => {
      isFilled = (await $.prompt.fill({ text: 'Rapport non validé : ', mode: 'replace' })).isFilled === true
    })
    await quietly(() => $.ui.toast(isFilled ? 'Dis à Claude ce qui ne va pas dans le rapport, puis Entrée' : 'Écris à Claude ce qui ne va pas dans le rapport'))
  },
  seeDecisions: async () => {
    const now = await $.clock.now()
    // Les choix relayés par les workers sont relus avec les autres.
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
  // Le skill du COO se lance comme si la personne l'avait tapé : il prend le siège à son chargement.
  cooOpen: () => quietly(() => $.command.run({ command: COO_SKILL, args: '' })),
  cooTake: () => quietly(() => $.command.run({ command: COO_SKILL, args: RETAKE_ARG })),
  cooDo: (d: CooDo) => cooDo($, d),
  // Un geste d'affichage (changer de page, déplier une entrée ou une liste) : l'état d'affichage seul, sans les gardes des
  // gestes du COO (il marche pendant un tour) ; déplier une entrée replie celle qui l'était.
  cooShow: (d: CooShow) =>
    update($, uiAtom, ui => ({
      ...ui,
      ...(d.page !== undefined ? { cooPage: d.page } : {}),
      ...(d.open !== undefined ? { cooOpen: d.open ?? undefined } : {}),
      ...(d.isAllPending !== undefined ? { cooAllPending: d.isAllPending } : {}),
      ...(d.isLaterOpen !== undefined ? { cooLaterOpen: d.isLaterOpen } : {}),
    })),
  securityToggle: (to: 'on' | 'off') => securityToggle($, to),
  forceHold: (pair: ForcedPair) => forceHere($, pair),
  cooLeave: () => leaveCooHere($),
  openPane: async () => {
    await update($, uiAtom, ui => ({ ...ui, isPaneDismissed: false, agentsWindow: undefined }))
    await quietly(() => $.ui.open({ id: PANE, title: PANE_TITLE }))
  },
  copyLink: (url: string, what: string, surface?: string) => copyWithToast($, url, `Lien ${what} copié`, `Copie impossible : ${url}`, surface),
  // Rouvrir ne change rien d'enregistré : la commande copiée recrée le worktree, Claude n'y est pour rien.
  reopenSession: (reopen: ReopenText, surface?: string) => copyWithToast($, reopen.text, reopen.copied, reopen.uncopied, surface, REOPEN_TOAST_MS),
  toggleArchiveConsent: () => toggleArchiveConsent($),
})

/** Copie un texte dans le presse-papiers de la surface pressée et le dit ; sans copie, le toast donne le texte à recopier. */
const copyWithToast = async ($: any, text: string, copied: string, uncopied: string, surface?: string, timeoutMs?: number) => {
  let done: { isCopied?: boolean } | null = null
  try {
    done = await $.ui.copy({ text, ...(surface ? { surface } : {}) })
  } catch {
    // Le toast donne alors le texte à recopier.
  }
  await quietly(() => $.ui.toast(done?.isCopied ? copied : uncopied, ...(timeoutMs !== undefined ? [{ timeoutMs }] : [])))
}

/** Le toast de « ↺ Rouvrir » dit ce qu'il reste à faire (désarchiver dans l'app, avec le titre) : 30 s pour le lire. */
const REOPEN_TOAST_MS = 30_000

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

/** Le nom et la version qu'un manifeste déclare (JSON ou TOML), lus dans son texte ; null sans version. */
const manifestFields = (text: string): { name: string | null; version: string } | null => {
  const version = /"version"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? /^version\s*=\s*"([^"]+)"/m.exec(text)?.[1]
  if (version === undefined) return null
  const name = /"name"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? /^name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null
  return { name, version }
}

/** Le motif (`git log -G`) d'une ligne de version d'un manifeste : `"version":` en JSON, `version =` en TOML. */
const versionLinePattern = (manifest: string): string => (manifest.endsWith('.json') ? '"version"[[:space:]]*:' : '^version[[:space:]]*=')

/**
 * Ce que l'aperçu de version dit d'un manifeste changé (Mathis, V2 de la rétro de la mission xhigh) :
 * sa version, et soit celle d'où il part quand elle a déjà changé depuis `fork` (le point où la
 * branche quitte le distant), soit les commits faits depuis son dernier changement de version, hors
 * fusions (le « Merge branch » de chaque groupe ne compte pas). Null s'il ne se lit pas.
 */
const measureUnit = async ($: any, dir: string, fork: string, manifest: string, isBumped: boolean): Promise<VersionUnit | null> => {
  const now = await runGit($, dir, ['show', `HEAD:${manifest}`], 5000)
  const fields = now.exitCode === 0 ? manifestFields(now.stdout) : null
  if (!fields) return null
  const folder = manifest.endsWith('.claude-plugin/plugin.json') ? manifest.slice(0, -'/.claude-plugin/plugin.json'.length) : manifest.replace(/\/?[^/]*$/, '')
  const name = fields.name ?? (folder.split('/').pop() || 'projet')
  if (isBumped) {
    const before = await runGit($, dir, ['show', `${fork}:${manifest}`], 5000)
    const from = before.exitCode === 0 ? manifestFields(before.stdout)?.version : undefined
    return from !== undefined && from !== fields.version ? { name, version: fields.version, from } : { name, version: fields.version }
  }
  const last = await runGit($, dir, ['log', '-1', '--format=%H', '-G', versionLinePattern(manifest), '--', manifest], 10_000)
  const range = last.exitCode === 0 && last.stdout !== '' ? [`${last.stdout}..HEAD`] : ['HEAD']
  const log = await runGit($, dir, ['log', '--no-merges', '--max-count=500', '--format=%x1e%s%x1f%b', ...range, '--', folder === '' ? '.' : folder], 10_000)
  if (log.exitCode !== 0) return null
  const commits = log.stdout
    .split('\x1e')
    .filter(c => c.trim() !== '')
    .map(c => {
      const [subject = '', body = ''] = c.split('\x1f')
      return { subject: subject.trim(), isBreaking: /^BREAKING[ -]CHANGE:/m.test(body) }
    })
  return { name, version: fields.version, commits }
}

/**
 * Les versions déjà posées face au distant (`base` : la branche suivie, sinon origin/main) : les
 * fichiers changés depuis, les manifestes de version du dépôt (ceux que liste la marketplace quand le
 * dépôt en a une : un plugin d'essai non publié ne compte pas) et ceux dont la ligne de version a changé ;
 * puis, pour l'aperçu, chaque manifeste changé (`measureUnit`).
 */
const measureVersions = async ($: any, dir: string, base: string): Promise<{ isVersionSet: boolean | null; versionUnits: VersionUnit[] | null }> => {
  const unknown = { isVersionSet: null, versionUnits: null }
  const changed = await runGit($, dir, ['diff', '--name-only', `${base}...HEAD`], 10_000)
  if (changed.exitCode !== 0) return unknown
  const listed = await runGit($, dir, ['ls-files', ...VERSION_MANIFESTS.flatMap(m => [m, `*/${m}`])], 10_000)
  if (listed.exitCode !== 0) return unknown
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
  const isVersionSet = versionSet(files, manifests, bumped)
  const fork = (await runGit($, dir, ['merge-base', base, 'HEAD'], 5000)).stdout
  const versionUnits: VersionUnit[] = []
  for (const m of touchedManifests(files, manifests)) {
    const unit = fork ? await measureUnit($, dir, fork, m, bumped.includes(m)) : null
    if (unit) versionUnits.push(unit)
  }
  return { isVersionSet, versionUnits }
}

/**
 * Le retard d'un dossier (racine de son worktree) sur le distant, d'après les références déjà
 * rapportées par le dernier fetch (communes à tous les worktrees du dépôt) : rien de lent ici, sinon
 * quelques `git diff` locaux pour les versions.
 */
const measureIn = async ($: any, dir: string, main: string): Promise<Pick<SyncState, 'behindMain' | 'behindUpstream' | 'aheadMain' | 'branch' | 'isOnMain' | 'remoteKey' | 'dir' | 'isVersionSet' | 'versionUnits'>> => {
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
  const { isVersionSet, versionUnits } = base ? await measureVersions($, dir, base) : { isVersionSet: null, versionUnits: null }
  return {
    isVersionSet,
    versionUnits,
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

/** La mission dont la suppression attend confirmation : ses comptes rendus pas encore relevés par le COO. */
const dropNote = async ($: any, board: Board | null): Promise<{ dropUngleaned?: number }> => {
  const ui = await read($, uiAtom)
  return ui.confirmDrop !== undefined && board ? { dropUngleaned: await ungleanedReports($, board, ui.confirmDrop) } : {}
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
    here: await hereId($),
    autoConfirmedAt: await autoConfirmedHere($, board),
    relay: await read($, relayAtom),
    agents: await read($, registryAtom),
    workerEffort: board?.delegate ? workerEffortNow : null,
    isFableOn: isFableStep && isFableAllowed(),
    isOnFable: isOnFableStep,
    isOpusBack: isOpusBackStep,
    isFableOff: isFableFallback(),
    isFableStuck: await isFableStuckHere($, board),
    linked: (await read($, linkedAtom)).map(session => ({ session, reg: linkedRegistryOf(session.session) })),
    history: { entries: await read($, historyAtom), shown: historyShown },
    agentsAlert: await read($, registryAlertAtom),
    security: await securityReviewNow($),
    erasing: [...erasingNow].map(([key, title]) => ({ key, title })),
    agentPrices: (await read($, pricesAtom))?.prices ?? null,
    quota: await quotaWindows($),
    coo: board ? await cooView($, board) : null,
    coordUnread: coordSeen?.state === 'unread',
    planUnread: isPlanUnreadHere(board),
    holds: holdsHere(board),
    ...takenView(board),
    launchUnread,
    ...(await dropNote($, board)),
  }
}

/** Le relevé que montre la vue Coordination : seulement dans la discussion qui tient le siège du COO, sans mission ici. */
const cooView = async ($: any, board: Board): Promise<CooStatement | null> => {
  if (board.delegate || activeRun(board)) return null
  const now = await $.clock.now()
  if (seatState(board.coo, await hereId($), now) !== 'mine') return null
  // Le quota de la discussion, montré sous une carte prête en xhigh.
  const quota = quotaText(await quotaWindows($), now)
  const night = nightShown(board, now)
  return { ...cooStatement(board, { now, ...(await numbersCtx($)), reported: await cooReportedOf($, board), ...(roadmapNowCache ? { roadmap: roadmapNowCache } : {}), ...(coordNow ? { coordination: coordNow } : {}), forces: id => forcesFor(coordLive, id), deadSince: deadSinceNow, liveness: livenessOf, plans: id => planWaitsOf(coordLive, id), plan: cooPlanOf(board), wave: cooWaveOf(board, now), ...(await cardsCtx($)), archiveHeld: await archiveHeldOf($, board), relays: relaysLive(), entries: coordLive, reports: cooReportsOf(board, now), delivery: await cooDeliveryOf($, board), decisions: cooDecisionsOf(board), retroPicks: cooRetroPicksOf(board), outside: cooOutsideOf(board), ...(cooWaitlistOf() ? { waitlist: cooWaitlistOf(), pistesTicks } : {}) }), ...(quota ? { quota } : {}), ...(cooAutoAsk !== null && board.runs.some(r => r.id === cooAutoAsk) ? { autoAsk: cooAutoAsk } : {}), ...(night ? { night } : nightAsk ? { nightAsk: true as const } : {}), ...(whereAsk ? { whereAsk: true as const } : {}) }
}


/** La clé de la dernière surveillance dont le résumé a été donné, par projet. */
const morningKey = (root: string): string => `coo-night-morning:${normRoot(root)}`

/**
 * Le résumé de la dernière surveillance arrêtée, s'il n'a pas encore été donné (puis noté donné) : ses lignes du
 * journal, ou le journal illisible ; null sans surveillance arrêtée, ou déjà résumée.
 */
const morningDue = async ($: any, root: string): Promise<NightMorning | null> => {
  const got = await readNight($, root)
  if (got.state !== 'off') return null
  let shown: unknown
  await quietly(async () => {
    shown = await $.store.get(morningKey(root))
  })
  if (shown === got.last.id) return null
  const lines = await nightLogLinesOf($, root, got.last.id)
  await quietly(() => $.store.set(morningKey(root), got.last.id))
  const base = { watch: got.last.id, at: got.last.at, why: got.last.why }
  return lines === null ? { ...base, unread: true } : { ...base, lines }
}

/**
 * Le relevé d'état que lit le Claude du COO, recalculé à chaque tour : missions, attentes, effort actif, `BRIEF.md`.
 * `isPerson` : un message de la personne, le seul qui porte le résumé de la nuit.
 */
const cooStatementFor = async ($: any, board: Board, isPerson = false): Promise<string> => {
  let hasBrief: boolean | null = null
  if (board.root !== '') {
    await quietly(async () => {
      hasBrief = Boolean(await $.fs.exists(`${board.root.replace(/[\\/]+$/, '')}/BRIEF.md`))
    })
  }
  // La feuille de route relue à l'instant, par le titulaire du siège (seul à garder ses entrées vues).
  const roadmap = await readRoadmap($, board, seatState(board.coo, await hereId($), await $.clock.now()) === 'mine')
  roadmapNowCache = roadmap
  await quietly(() => watchCoordination($, board))
  // Les dates de fin relues pour ce relevé aussi (après les forçages et attentes du plan) : le premier relevé du siège
  // n'attend pas la veille ; la vue se redessine si elles changent (la veille suivante n'y verrait plus de changement).
  const deadBefore = deadPrint
  await readDeadSince($, board)
  const isLivenessChanged = await refreshLiveness($, claudeHome($), board, await $.clock.now())
  if (deadPrint !== deadBefore || isLivenessChanged) $.ui.invalidate('ui.render')
  // L'accord d'archivage relu à l'instant ; une lecture ratée le laisse « pas relu », jamais deviné.
  let archive: number | null | undefined
  try {
    await loadArchiveConsent($)
    archive = archiveConsent.at
  } catch {
    archive = undefined
  }
  // La surveillance valide d'après la dernière relecture du siège, et ses blocages : la section « Nuit ».
  const nightAt = await $.clock.now()
  const shown = nightShown(board, nightAt)
  const blocks = shown && nightNow?.state === 'read' ? await nightBlocksNow($, board, nightAt) : []
  if (nightNow?.state === 'read') noteAutoReopens(nightNow.watch.id, blocks)
  const night = shown && nightNow?.state === 'read' ? { until: shown.until, id: nightNow.watch.id, blocks, reopens: await nightReopensNow($, board, blocks, board.root, nightNow.watch.id) } : undefined
  // Le résumé de la nuit, au premier message de la personne qui suit l'arrêt.
  const morning = isPerson && !night ? await morningDue($, board.root) : null
  // Les pistes rendues par le relevé (mission finie), dites une fois : retirées du stockage une fois le relevé composé.
  const finished = await peekFinishedLines(board.root, $)
  const waitlist = cooWaitlistOf()
  const said = statementText(cooStatement(board, { ...(night ? { night } : {}), ...(morning ? { morning } : {}), now: await $.clock.now(), reported: await cooReportedOf($, board), ...(archive !== undefined ? { archive } : {}), ...(await numbersCtx($)), ...(await cardsCtx($)), archiveHeld: await archiveHeldOf($, board), askMatt: await askMattPath($), plans: id => planWaitsOf(coordLive, id), plan: cooPlanOf(board), wave: cooWaveOf(board, await $.clock.now()), effort: (await sessionEffort($)) ?? null, hasBrief, roadmap, ...(coordNow ? { coordination: coordNow } : {}), forces: id => forcesFor(coordLive, id), deadSince: deadSinceNow, liveness: livenessOf, taken: id => { const r = board.runs.find(x => x.id === id); return new Set(takenFor(coordLive, id, r ? retroItems(r) : undefined).keys()) }, relays: relaysLive(), entries: coordLive, reports: cooReportsOf(board, await $.clock.now()), delivery: await cooDeliveryOf($, board), decisions: cooDecisionsOf(board, true), retroPicks: cooRetroPicksOf(board), outside: cooOutsideOf(board), ...(waitlist || finished.length > 0 ? { waitlist: { ...(waitlist ?? { state: 'absent' as const, pistes: [], refused: [], boxesUnread: [] }), ...(finished.length > 0 ? { finished } : {}) }, pistesTicks } : {}), ...(await cooSetAsideCtx($, board)), toClose: await cooToCloseText($, board), unmarked: await cooUnmarkedText($, board) }))
  await dropFinishedLines(board.root, $, finished)
  return said
}

/** Redessine pour faire avancer les durées affichées. */
const tick = async ($: any) => {
  ticks += 1
  const board = await read($, boardAtom)
  if (!board) {
    if (ticks % 5 === 0) await ensureBoard($)
    return
  }
  // Toutes les 5 s, les missions des autres discussions du projet.
  if (ticks % 5 === 0) {
    const isRead = await pull($)
    await quietly(() => watchSeat($, isRead))
    // Le fichier de coordination : le COO le relit (et en retire les entrées des missions effacées), le manager applique ce qui vise sa mission.
    // Le fichier des missions illisible : les forçages relus par le COO ne comptent plus, comme chez les managers.
    if (!isRead) coordLive = []
    // Une lecture ratée du fichier des missions pendant une pause qui pouvait reprendre : plus de reprise d'elle-même.
    if (!isRead) await quietly(() => dropStuckResume($, board))
    if (isRead && launchUnread) {
      launchUnread = false
      $.ui.invalidate('ui.render')
    }
    if (isRead) {
      const fresh: Board = (await read($, boardAtom)) ?? board
      await quietly(() => watchCoordination($, fresh, true))
      await quietly(() => watchNight($, fresh))
      await quietly(() => applyCoordination($, fresh))
      // Les demandes de rétro qui désignent cette discussion : avec ou sans mission en cours ici ; une application à la
      // fois, sans retenir la relecture (sa prise attend 1,5 s).
      if (!isApplyingRetro) {
        isApplyingRetro = true
        void quietly(() => applyRetroRequests($, fresh)).finally(() => {
          isApplyingRetro = false
        })
      }
      await quietly(() => watchRetroAsked($, fresh))
      // L'une après l'autre, jamais ensemble : les deux gardent la date du clic de la même mission.
      void quietly(async () => {
        await quietly(() => consumeAutoOn($, fresh))
        await quietly(() => resumeStuckAuto($, fresh))
        await quietly(() => tryRelaunchResume($))
        // Après la tentative : la pause que la relance laisse se dit (`watchRelaunchPause`).
        await quietly(() => watchRelaunchPause($))
      })
      await quietly(() => watchHolds($, fresh))
      await quietly(() => declareTaken($, fresh))
      await quietly(() => pruneOwnBox($, fresh))
      await quietly(() => prunePisteBox($, fresh))
      await quietly(() => watchPistesMission($, fresh))
    }
    await pullRelay($, (await read($, boardAtom)) ?? board)
    // Hors du retour anticipé de pullRelay (relais inchangé) : un envoi peut attendre sa session alors que le relais ne bouge plus.
    await quietly(() => noteRelaySessions($))
    await quietly(() => watchSilentWorkers($))
    await quietly(async () => watchAwaited($, (await read($, boardAtom)) ?? board))
    await quietly(() => loadArchiveConsent($))
    await quietly(() => refreshLinked($))
    await quietly(() => migrateRunAgents($))
    await quietly(() => watchAutoSends($))
    const ui = await read($, uiAtom)
    if (ui.tab === 'agents' && ui.agentsHistory !== undefined) await quietly(() => refreshHistory($))
    if (ui.tab === 'agents') await quietly(() => reconcileErased($))
  }
  const run = activeRun(board)
  // Un worker au travail fait aussi avancer les durées de l'onglet Agents.
  const hasAgentsAtWork = runningOf(await read($, registryAtom)).length > 0 || (await read($, linkedAtom)).some(l => l.state === 'working')
  if (!run) {
    // Sans mission, l'onglet Agents garde ses durées vivantes tant qu'un spécialiste travaille.
    if (hasAgentsAtWork && ticks % 5 === 0) $.ui.invalidate('ui.render')
    return
  }
  if (ticks % 300 === 0 && CODE_SKILLS.has(currentPhase(run).skill)) void checkRemote($, true)
  const live = await read($, liveAtom)
  // Durées vivantes : toutes les 5 s pendant le travail, toutes les 30 s au repos.
  const isBusy = live.mode === 'working' || hasAgentsAtWork
  if (ticks % (isBusy ? 5 : 30) === 0) $.ui.invalidate('ui.render')
}

/**
 * Les origines d'un `/flow archive on` reçues comme un geste de la personne : Entrée au prompt
 * (`composer`), un message par Remote Control (`bridge`), le message que l'app Desktop fait entrer (`sdk`).
 */
const CONSENT_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

/** La clé de `$.store` de l'accord d'archivage d'office (`{ at }`), commune aux projets de ce poste. */
const ARCHIVE_CONSENT_KEY = 'archive-consent'

/** Relit l'accord d'archivage d'office : une valeur sans date lisible vaut « pas d'accord ». */
const loadArchiveConsent = async ($: any) => {
  archiveConsent.at = consentAt(await $.store.get(ARCHIVE_CONSENT_KEY), await $.clock.now())
}

/**
 * `/flow archive on|off` : l'accord, donné d'avance, d'archiver les sessions de l'app que la fermeture
 * a vérifiées (décision de Mathis du 02/11/2026 : un réglage d'accord, donné une fois).
 * `on` ne vient que d'un geste de la personne (liste blanche `CONSENT_ORIGINS` ; origine absente, plugin,
 * tâche programmée, autre session : refusé) ; `off`, qui ne fait que retirer l'accord, de partout. Sans
 * argument : l'état.
 */
export const runArchiveConsent = async ($: any, value: string | undefined, origin: string | undefined, now: number) => {
  await quietly(() => loadArchiveConsent($))
  if (value === undefined) return { text: archiveStateText() }
  if (value === 'on' && (origin === undefined || !CONSENT_ORIGINS.has(origin))) return { text: 'Refusé : seul ton propre geste donne l’accord d’archivage (tape /flow archive on).' }
  return { text: await writeArchiveConsent($, value === 'on', now) }
}

/** L'état de l'accord d'archivage d'office, en une phrase (réponse de `/flow archive`, toast de l'interrupteur). */
const archiveStateText = (): string =>
  archiveConsent.at !== null
    ? `Archivage d’office allumé depuis le ${consentDay(archiveConsent.at)} : Claude archive sans redemander les sessions de l’app que la fermeture d’un groupe ou des pistes a vérifiées (/flow archive off pour l’éteindre).`
    : 'Archivage d’office éteint : Claude te demande ton accord avant d’archiver une session de l’app (/flow archive on pour le donner d’avance).'

/** Écrit (`isOn`) ou retire l'accord, puis rend l'état ; une écriture ratée ne change rien. */
const writeArchiveConsent = async ($: any, isOn: boolean, now: number): Promise<string> => {
  try {
    if (isOn) await $.store.set(ARCHIVE_CONSENT_KEY, { at: now })
    else await $.store.delete(ARCHIVE_CONSENT_KEY)
  } catch {
    return 'L’accord n’a pas pu s’écrire : rien n’a changé.'
  }
  archiveConsent.at = isOn ? now : null
  return archiveStateText()
}

/**
 * L'interrupteur de l'onglet Commandes : un clic dans le panneau, ton geste comme `/flow archive` tapé
 * (ni Claude ni un plugin ne cliquent), allume ou éteint l'accord d'après l'état relu juste avant.
 */
const toggleArchiveConsent = async ($: any) => {
  await quietly(() => loadArchiveConsent($))
  const text = await writeArchiveConsent($, archiveConsent.at === null, await $.clock.now())
  await quietly(() => $.ui.toast(text))
  $.ui.invalidate('ui.render')
}

// `/flow` n'existe qu'après le démarrage du mod ; `/flow-board:flow`, déclaré par
// `commands/flow.md`, est connu dès le premier message. Les deux reçoivent la même réponse.
const runFlow = async ($: any, e: { args: string; origin?: { kind?: string } }) => {
  const arg = e.args.trim().toLowerCase()
  const now = await $.clock.now()
  // L'accord d'archivage d'office : un geste de la personne, jamais d'un plugin (flow-board compris).
  const archive = /^archive(?:\s+(on|off))?$/.exec(arg)
  if (archive) return runArchiveConsent($, archive[1], e.origin?.kind, now)
  const board = await ensureBoard($)
  // Depuis un worktree, le fichier du dépôt principal illisible : rien n'est chargé, rien ne s'enregistre.
  if (!board) return { text: mainUnread ? 'Fichier des missions du dépôt principal illisible depuis ce worktree : rien n’est chargé ni enregistré. Réessaie dans quelques secondes.' : 'Tableau de bord indisponible.' }
  // `rename <titre>` : le titre garde sa casse, d'où la lecture de `e.args` et non de `arg`.
  const renamed = /^rename(?:\s+([\s\S]*))?$/i.exec(e.args.trim())
  if (renamed) {
    const title = (renamed[1] ?? '').trim()
    if (!title) return { text: 'Usage : /flow rename <titre>' }
    const run = activeRun(board)
    if (!run) return { text: 'Aucune mission en cours.' }
    const fx = await commit($, b => renameRun(b, run.id, title, now))
    return { text: fx ? `Mission renommée : ${clip(title.replace(/\s+/g, ' '), 70)}` : 'Aucune mission en cours.' }
  }
  if (arg === 'hide') {
    await update($, uiAtom, ui => ({ ...ui, isBandHidden: true }))
    await syncStatus($, board)
    return { text: 'Bandeau de la mission masqué (/flow show pour le réafficher).' }
  }
  if (arg === 'done') {
    const fx = await commit($, b => finishActive(b, now))
    return { text: fx ? 'Mission close.' : 'Aucune mission en cours.' }
  }
  if (arg === 'pause') {
    const run = activeRun(board)
    const fx = await commit($, b => setAsideActive(b, now))
    return { text: fx && run ? `Mission mise de côté : ${neutralInPrompt(run.title)} (Historique, « Reprendre », pour la rouvrir telle quelle).` : 'Aucune mission en cours.' }
  }
  if (arg === 'reset') {
    const run = activeRun(board)
    if (!run) return { text: 'Aucune mission en cours.' }
    // On n'efface plus : la mission abandonnée part aux archives, d'où elle peut revenir.
    // Reprise ailleurs entre-temps (la mission n'est plus tenue ici) : `archiveRun` refuse, et la réponse le dit ; une
    // écriture ratée se dit autrement.
    let isRefused = false
    const fx = await commit($, b => {
      const out = archiveRun(b, run.id, now)
      isRefused = out === null
      return out
    })
    if (isRefused) return { text: `Rien n’est archivé : « ${neutralInPrompt(run.title)} » n’est plus la mission de cette discussion (reprise ailleurs entre-temps).` }
    if (fx === null) return { text: `Rien n’est archivé : l’écriture de « ${neutralInPrompt(run.title)} » a échoué ; relance /flow reset dans un instant.` }
    return { text: `Mission archivée : ${neutralInPrompt(run.title)} (Historique, « Archivées », pour la rouvrir).` }
  }
  const tab: Tab = arg === 'history' ? 'history' : arg === 'activity' ? 'activity' : arg === 'commands' ? 'commands' : 'flow'
  await update($, uiAtom, ui => ({ ...ui, tab, isPaneDismissed: false, isBandHidden: arg === 'show' ? false : ui.isBandHidden }))
  await syncStatus($, board)
  await quietly(() => $.ui.open({ id: PANE, title: PANE_TITLE }))
  const run = activeRun(board)
  return { text: run ? summaryOf(run).replace(/^Dashboard: /, 'Mission : ') : noActiveFrench((board ?? (await read($, boardAtom)))!) }
}

// `/flow` reste utilisable tapée en entier, mais sort du menu : `/flow-board:flow`, déjà là
// avant le premier message, y suffit et le doublon disparaît.
const hideFlow = async ($: any, e: any, next: any) => ({ ...(await next(e)), isHidden: true })

// ─── Hooks ────────────────────────────────────────────────────────────────

/**
 * Le corps de l'outil flow. `fable` : le verrou du premier appel tenu par cet appel (`isClaimed`, pris aussi après
 * le chargement que fait cet appel, qui peut l'ouvrir) et, rempli ici, si sa délégation s'est écrite (`isWritten`).
 */
const flowCall = async ($: any, e: ToolCallInput, isDelegateCall: boolean, isMainLoop: boolean, fable: { isClaimed: boolean; isWritten: boolean }): Promise<{ result: string }> => {
  const now = await $.clock.now()
  // Les clés que le schéma ne connaît pas : dites à la fin de chaque réponse, après le reste de l'appel lu comme avant.
  const unknownTail = await unknownFieldsText($, e as unknown as Readonly<Record<string, unknown>>)
  // Un appel qui déclare une délégation vient d'un worker : il garde le fichier de son worktree.
  if (!(await ensureBoard($, typeof (e as { delegate?: unknown }).delegate === 'string'))) return { result: `${mainUnread ? MAIN_UNREAD : 'Dashboard unavailable.'}${unknownTail}` }
  // Le premier chargement du board, fait par cet appel, a pu ouvrir le verrou (une clé lue vide) : il le prend alors,
  // sans attente entre le test et la prise.
  if (!fable.isClaimed) fable.isClaimed = claimFableFirst(isDelegateCall, isMainLoop)
  // La reprise à la relance se tente au début de chaque appel (après la prise du verrou ci-dessus), avant sa réponse,
  // qui dit alors l'auto allumé.
  await quietly(() => tryRelaunchResume($))
  const fableFirst: FableFirst = e.agentId !== undefined ? 'subagent' : fable.isClaimed ? 'yes' : 'unknown'
  let text = 'Dashboard unavailable.'
  let input = e as unknown as Readonly<Record<string, unknown>>
  // Une piste marquée prise ailleurs n'entre jamais dans un découpage : l'appel qui la ferait avancer est refusé en entier
  // (tickets, groupes et fin de phase compris), le fichier de coordination relu juste avant.
  const cutBoard = (await read($, boardAtom)) as Board | null
  if (Array.isArray(input.items) && cutBoard && activeRun(cutBoard)) await quietly(() => refreshCoordSeen($, cutBoard))
  const cut = takenMoves(input, cutBoard)
  if (cut !== '') return { result: `${cut}${unknownTail}` }
  // Une étape sans titre sur une mission qui n'en a pas : refusée en entier, avant le lancement, la mise de côté ou la reprise qu'elle porterait.
  const untitled = untitledStepRefusal(cutBoard, input)
  if (untitled !== '') return { result: `${untitled}${unknownTail}` }
  // Après un rechargement, l'état retrouvé se dit tel qu'il était, avant ce que l'appel change.
  const found = isReloadToAnnounce ? reloadText((await read($, boardAtom)) ?? emptyBoard('', '')) : ''
  isReloadToAnnounce = false
  // Les consignes du COO (`coordinate`) : seulement dans sa discussion, rien d'autre de l'appel n'est lu.
  if (input.coordinate !== undefined && input.coordinate !== null && (typeof input.coordinate !== 'object' || Array.isArray(input.coordinate))) {
    return { result: `${found}${found === '' ? '' : ' '}Refused: "coordinate" must be a JSON object, {"close": [{"mission": "<mission id>"}]}, alone in its call; nothing of this call was recorded.${unknownTail}` }
  }
  // Une carte de lancement du COO (`card`) : seulement dans sa discussion, seule dans son appel.
  if (input.card !== undefined && input.card !== null) {
    const others = Object.keys(input).filter(k => k !== 'card' && k !== 'tool' && input[k] !== undefined && input[k] !== null)
    const ignored = others.length > 0 ? ` The rest of this call was not read (${others.slice(0, 8).map(k => neutralInPrompt(clip(k, 30))).join(', ')}): "card" goes alone in its call.` : ''
    return { result: `${found}${found === '' ? '' : ' '}${await cardCall($, input.card)}${ignored}${unknownTail}` }
  }
  // L'issue d'une étape de la livraison (`delivery`) : seulement chez le COO, seule dans son appel.
  if (input.delivery !== undefined && input.delivery !== null) {
    const others = Object.keys(input).filter(k => k !== 'delivery' && k !== 'tool' && input[k] !== undefined && input[k] !== null)
    const ignored = others.length > 0 ? ` The rest of this call was not read (${others.slice(0, 8).map(k => neutralInPrompt(clip(k, 30))).join(', ')}): "delivery" goes alone in its call.` : ''
    return { result: `${found}${found === '' ? '' : ' '}${await deliveryCall($, input.delivery)}${ignored}${unknownTail}` }
  }
  // La liste d'attente des rétros (`pistes`) : seule dans son appel.
  if (input.pistes !== undefined && input.pistes !== null) {
    const others = Object.keys(input).filter(k => k !== 'pistes' && k !== 'tool' && input[k] !== undefined && input[k] !== null)
    const ignored = others.length > 0 ? ` The rest of this call was not read (${others.slice(0, 8).map(k => neutralInPrompt(clip(k, 30))).join(', ')}): "pistes" goes alone in its call.` : ''
    return { result: `${found}${found === '' ? '' : ' '}${await pistesCall($, input.pistes)}${ignored}${unknownTail}` }
  }
  if (input.coordinate !== null && typeof input.coordinate === 'object' && !Array.isArray(input.coordinate)) {
    const others = Object.keys(input).filter(k => k !== 'coordinate' && k !== 'tool' && input[k] !== undefined && input[k] !== null)
    const ignored = others.length > 0 ? ` The rest of this call was not read (${others.slice(0, 8).map(k => neutralInPrompt(clip(k, 30))).join(', ')}): "coordinate" goes alone in its call.` : ''
    return { result: `${found}${found === '' ? '' : ' '}${await coordinateCall($, input.coordinate, e.agentId !== undefined)}${ignored}${unknownTail}` }
  }

  // Un compte rendu donné par son chemin (`reportPath`), dans le fil principal d'un worker : lu une fois, il suit
  // ensuite le chemin de `report` (fichier du relais, extrait, avis au manager). Refusé, ou envoyé avec `report`
  // (partout : worker, spécialiste, manager), rien du compte rendu ne part.
  let reportPathText = ''
  // Le dépôt du compte rendu d'un groupe par le manager (`reportPath` avec `group`), lu et gardé avant l'écriture du board ;
  // un seul à la fois dans ce processus (deux appels parallèles écriraient le même fichier).
  let deposit: Deposit | undefined
  let isDepositWritten = false
  let depositToken: { at: number } | null = null
  if (input.reportPath !== undefined && input.reportPath !== null) {
    const isWorker = Boolean(cutBoard?.delegate) || typeof input.delegate === 'string'
    const { reportPath: _path, ...rest } = input
    if (input.report !== undefined && input.report !== null) {
      const { report: _report, ...others } = rest
      input = others
      reportPathText = ' · "report" and "reportPath" came together: neither was read, nothing of your report was relayed; send one of them.'
    } else if (!isWorker && e.agentId === undefined && input.group !== undefined && input.group !== null) {
      const { group: _group, ...others } = rest
      input = others
      // L'âge du verrou se juge à l'horloge relue maintenant ; seul l'appel qui l'a pris le rend (son jeton).
      const lockAt = await $.clock.now()
      if (depositBusy !== null && lockAt - depositBusy.at < DEPOSIT_BUSY_MS) reportPathText = ' · "reportPath" with "group" refused: another deposit is being recorded in this discussion; nothing was deposited: send it again once it answered.'
      else {
        depositToken = { at: lockAt }
        depositBusy = depositToken
        const outcome = await depositCall($, _path, _group, now)
        deposit = outcome.deposit
        reportPathText = outcome.text
      }
    } else if (!isWorker || e.agentId !== undefined) {
      // Hors du fil principal d'un worker, le chemin n'est jamais lu ; le reste de l'appel suit son cours.
      input = rest
      reportPathText = ` · "reportPath" not read: ${!isWorker ? 'only the worker of a group gives its final report by a path (here, a path is read only with "group": the report of a worker that lacks the flow tool, deposited for its group); your own report goes by "report"' : 'a subagent does not send the final report: the worker does'}.`
    } else {
      const outcome = await readReportPath($, input.reportPath)
      if ('text' in outcome) input = { ...rest, report: outcome.text }
      else {
        input = rest
        reportPathText = ` · "reportPath" refused: ${neutralInPrompt(outcome.why)}; nothing of your report was relayed: send it again, by "report" or by "reportPath" (a .md or .txt file under your worktree or your temporary folder, CLAUDE_JOB_DIR).`
      }
    }
  }

  // Avant une reprise, l'état d'ici rattrape ce que l'autre discussion a enregistré ; de même avant une question
  // posée ou mise à jour (`waiting` sans `answered`), hors d'un worker (qui n'en enregistre pas) : une réponse donnée
  // ailleurs (sa trace) fait refuser le renvoi de son id ici, au lieu de rouvrir la question. Le fichier ne se relit
  // pas : les questions posées ne s'enregistrent pas (une réponse donnée ailleurs n'y serait pas vue), les retraits si.
  const asked: unknown[] = Array.isArray(input.waiting) ? input.waiting : input.waiting === undefined || input.waiting === null ? [] : [input.waiting]
  const isAnswer = (w: unknown) => w !== null && typeof w === 'object' && !Array.isArray(w) && (w as Record<string, unknown>).answered === true
  const isAsking = asked.some(w => !isAnswer(w))
  const isResuming = typeof input.resume === 'string' && input.resume.trim() !== ''
  const isWorkerCall = Boolean(cutBoard?.delegate) || typeof input.delegate === 'string'
  const isPulled = isResuming || (isAsking && !isWorkerCall) ? await pull($) : true
  let waitingUnreadText = ''
  if (isAsking && !isWorkerCall && !isPulled) {
    const answers = asked.filter(isAnswer)
    const { waiting: _waiting, ...others } = input
    input = answers.length > 0 ? { ...others, waiting: answers } : others
    waitingUnreadText = ' · waiting refused: the missions file could not be re-read to check the answers given in other discussions; nothing recorded for the questions asked: send them again'
  }
  const delegateTitle = typeof input.delegate === 'string' ? await mainRepoTitle($, input.delegate.trim()) : undefined
  // Le relais de la mission reprise ou actif : un groupe rendu y trouve les revues relayées par sa
  // session, et la réponse y cite les comptes rendus finals déposés (un SendMessage peut se perdre).
  // Un worker relit d'abord la référence du manager : elle change à son redémarrage.
  let moved: string | undefined
  await quietly(async () => {
    moved = await followMainRef($)
  })
  const board0: Board | null = await read($, boardAtom)
  // Un worker relit à chaque appel la mission de son manager, ici ou dans le dépôt principal, sans rien écrire : ce que
  // la réponse dit de sa référence (`managerReachOf`), avec le signal de vie de son titulaire (`ownerVerdictOf`). Une
  // lecture qui lève : rien de relu, la réponse le traite ainsi.
  // La mission que l'appel déclare passe avant une délégation déjà gardée : la réponse décrit celle de l'appel.
  const reachRunId = (typeof input.delegate === 'string' ? input.delegate.trim() : '') || (board0?.delegate?.run ?? '')
  let managerReach: ManagerReach | undefined
  // La même mission relue dit aussi si le worker travaille pour une mission en auto (`experienceChoiceNotice`).
  let isReachAuto = false
  if (board0 && reachRunId !== '') {
    await quietly(async () => {
      const run = await reachRunOf($, board0, reachRunId)
      isReachAuto = run !== undefined && isAutoMission(run)
      managerReach = managerReachOf(run, await ownerVerdictOf($, claudeHome($), run, now))
    })
  }
  const relayRun = board0?.delegate ? '' : typeof input.resume === 'string' && input.resume.trim() !== '' ? input.resume.trim() : (activeRun(board0)?.id ?? '')
  const relayGaps = { count: 0 }
  const relay = relayRun !== '' ? await readRelay($, relayRun, relayGaps) : undefined
  // La procédure de fermeture d'un groupe clos dépend du dépôt : sans git, l'arrêt seul.
  const isRepo = await measureRepo($)
  // Une mission lancée par le COO. La discussion qui porte déjà le titre de la carte compte comme nommée : la marque
  // se pose d'après l'enregistrement relu, avant que le titre de l'appel décide du nom, que le lancement se consomme
  // ou non (refus, nouvel essai). Puis le lancement se consomme avant l'écriture, seulement quand une mission est déjà
  // ouverte ici et que l'appel ne change pas de mission active : sans mission, ou avec `open` ou `resume` dans le même
  // appel, après l'écriture, comme avant (la carte va à la mission ouverte ou reprise).
  const hasLaunch = input.launch !== undefined && input.launch !== null && e.agentId === undefined
  const namedSession = board0 && !board0.delegate ? (board0.session ?? '') : ''
  if (hasLaunch) await markFromLaunch($, input.launch, namedSession)
  const isMissionChange = (input.open !== undefined && input.open !== null && input.open !== false) || (typeof input.resume === 'string' && input.resume.trim() !== '')
  const isLaunchFirst = hasLaunch && board0 !== null && !board0.delegate && activeRun(board0) !== null && !isMissionChange
  const launchFirstText = isLaunchFirst ? await consumeLaunch($, input.launch) : ''
  // La marque relue ensuite : présente, illisible ou hors forme, la discussion garde son nom. Seulement pour un appel
  // qui peut nommer (une ouverture, ou un titre pour une mission encore sans titre) : les autres ne lisent rien de plus.
  const isOpening = input.open !== undefined && input.open !== null && input.open !== false
  // La mission que le titre vise : celle que l'appel reprend, sinon l'active.
  const resumeId = typeof input.resume === 'string' ? input.resume.trim() : ''
  const titledRun = resumeId !== '' ? board0?.runs.find(r => r.id === resumeId) : activeRun(board0)
  const canName = isOpening || (input.title !== undefined && input.title !== null && titledRun?.isTitled !== true)
  const isNamed = !canName || namedSession === '' ? true : !(await isUnnamed($, namedSession))

  // À la reprise, les comptes rendus déposés se citent de nouveau en entier ; une reprise refusée les garde vus (plus bas).
  const unseen = relayRun !== '' && typeof input.resume === 'string' && input.resume.trim() !== '' ? [...seenReports].filter(key => key.startsWith(`${relayRun}:`)) : []
  for (const key of unseen) seenReports.delete(key)
  // Comment l'écriture a fini : écrite, rien à écrire (l'appel ne change rien, ou il est refusé), l'état parti, ou
  // l'état qui bougeait encore au cinquième essai.
  let fate: 'written' | 'same' | 'gone' | 'conflict' = 'conflict'
  for (let attempt = 0; attempt < 5; attempt++) {
    const { value, version } = await $.state.get(BOARD_REF)
    if (!value) {
      fate = 'gone'
      break
    }
    // Le réglage « revue de sécurité », relu à chaque essai d'écriture : la marque d'un avis et la fermeture
    // « désactivée » ne se posent que sur ce qu'il dit à l'instant de l'écriture.
    const security = await securityReviewNow($)
    // La marque du dépôt posée avant le reste de l'appel : la fermeture que la réponse décrit la compte déjà.
    const deposited = deposit ? withDeposit(value, deposit, now) : null
    const out = applyReport(deposited ?? value, input, now, { hasPullRequests: (await read($, syncAtom)).isGitHub !== false, isVersionSet: (await read($, syncAtom)).isVersionSet, delegateTitle, fableFirst, relay, seenReports, isRepo, security, isNamed, isRelayWhole: relayGaps.count === 0, managerReach })
    text = out.text
    const shown = activeRun(out.board)
    if (shown && !out.board.delegate && relay !== null && typeof relay === 'object' && (relay as Relay).run === shown.id) for (const key of relayedReportKeys(shown, relay as Relay)) seenReports.add(key)
    if (out.board === value) {
      fate = 'same'
      break
    }
    const written = await $.state.set(BOARD_REF, out.board, { ifVersion: version })
    if (written.isSet) {
      fate = 'written'
      isDepositWritten = deposited !== null
      // La délégation de cet appel écrite dans l'état : le verrou du premier appel se ferme tout de suite, avant
      // toute attente, pour qu'aucun appel parallèle ne le trouve encore ouvert.
      if (isDelegateCall && out.board.delegate) {
        fable.isWritten = true
        closeFableFirst()
      }
      // Le nom refusé au moment de l'écrire (une marque posée entre-temps, une lecture ratée) : la réponse ne demande
      // pas à Claude de renommer la discussion, elle dit qu'elle garde son nom.
      if ((await afterChange($, out.fx, out.board)) === 'refused' && out.fx.discussionTitle !== undefined) text = keepNameText(text, out.fx.discussionTitle)
      // Une question retirée par Claude ici : sa trace est gardée ici.
      await quietly(() => recordOwnTraces($, value, out.board))
      await afterAuto($, value, out.board)
      await quietly(() => wakeWaiting($, value, out.board))
      break
    }
  }

  if (deposit) reportPathText = await depositOutcome($, deposit, isDepositWritten)
  if (depositToken !== null && depositBusy === depositToken) depositBusy = null
  // Un appel `delegate` dont rien ne s'est écrit (l'état a bougé à chaque essai, ou n'est plus là) et sans délégation
  // en mémoire : sa réponse ne dit ni une délégation ni une marque, qui ne sont pas enregistrées. Avec une délégation
  // en mémoire, sa réponse reste (ce qui est parti au relais n'est pas à renvoyer) ; l'outil dit la marque non posée.
  if (isDelegateCall && (fate === 'gone' || fate === 'conflict') && !(await read($, boardAtom))?.delegate) {
    text = `Nothing of this "delegate" call was recorded (the dashboard state ${fate === 'gone' ? 'is gone' : 'kept changing'}): send it again.`
  }
  // Ce qu'un manager met de côté (`setAside`) : dans sa boîte, une fois la reprise ou l'ouverture de l'appel faite
  // (la déclaration prend la mission active d'après l'appel) ; la réponse le dit à la fin.
  const asideText = input.setAside !== undefined && input.setAside !== null ? await setAsideCall($, input.setAside, typeof input.delegate === 'string') : ''
  // Une mission lancée par le COO : son lancement, consommé une fois, la rattache à sa carte.
  const launchText = !hasLaunch ? '' : isLaunchFirst ? launchFirstText : await consumeLaunch($, input.launch)
  const resumed = typeof input.resume === 'string' ? input.resume.trim() : ''
  // Ce que la réponse dit de la référence du moment envoyée avec `resume` (vide sans `main`).
  let mainRefText = ''
  // Seulement une reprise faite, ici : un id mal recopié ou ignoré (avec "open") n'écrit rien.
  const after: Board | null = await read($, boardAtom)
  // Une reprise sans référence (la mission reprise ici) : la référence se redemande au tour suivant.
  // Jamais d'un spécialiste ni d'un worker : seule la discussion qui porte la mission, la reprise faite ici.
  const isResumedHere = resumed !== '' && e.agentId === undefined && !after?.delegate && activeRun(after)?.id === resumed
  if (!isResumedHere) for (const key of unseen) seenReports.add(key)
  if (isResumedHere && (typeof input.main !== 'string' || input.main.trim() === '')) {
    mainRefWritten.delete(resumed)
    mainRefFailures.delete(resumed)
    mainRefKnown.delete(resumed)
  }
  if (isResumedHere && typeof input.main === 'string' && input.main.trim() !== '') {
    const ref = parseMainRef({ run: resumed, main: input.main, at: now }, resumed)
    let outcome: MainRefOutcome | 'thrown' = 'thrown'
    if (ref) {
      try {
        outcome = await writeMainRef($, ref)
      } catch {
        // Une lecture du moteur qui lève : rien d'écrit, la réponse le dit.
      }
      // Écrite, une plus récente en place, ou un refus : la demande s'arrête. Une tentative ratée la laisse, jusqu'à
      // trois : au-delà, chaque tour la referait, et chaque reprise recite les comptes rendus.
      const failures = outcome === 'written' || outcome === 'older' || outcome === 'refused' ? 0 : (mainRefFailures.get(resumed) ?? 0) + 1
      mainRefFailures.set(resumed, failures)
      if (failures === 0 || failures >= MAIN_REF_TRIES) mainRefWritten.add(resumed)
      // La référence que la demande de lancement donne : seulement celle que ce processus vient d'écrire.
      const known = outcome === 'written' ? refOf(ref.main) : null
      if (known) mainRefKnown.set(resumed, known)
      else mainRefKnown.delete(resumed)
    }
    mainRefText = !ref
      ? ` Your reference was not written: "main" must end with your [ref] as ListAgents shows it (4 to 12 lowercase letters or digits between brackets), not ${asciiJson(clip(input.main, 40))}.`
      : outcome === 'written'
        ? ' Your reference of the moment is written next to the relay: each worker follows it at its next call.'
        : outcome === 'older'
          ? ' Your reference was not written: a newer one is already next to the relay.'
          : outcome === 'refused'
            ? ' Your reference was not written: this discussion does not carry this mission.'
            : outcome === 'unread'
              ? ' Your reference was not written: the missions file could not be re-read just before; send it again later.'
              : ' Your reference could not be written next to the relay (file and storage out of reach): your workers keep the one of their brief; send it again later.'
  }
  // Ce que le relais garde se dit une fois les écritures faites : la phrase que le modèle a écrite
  // d'avance (`relayedSentence(input)`) est remplacée par celle des pertes, ou ajoutée si elle manque.
  // Un compte de bogues hors forme : la phrase dit sa raison à lui, d'après l'appel, et remplace celle
  // qu'une perte d'ici lui aurait donnée (une déclaration ratée) ; dans une revue refusée en entier pour
  // ses autres comptes (`refusedRelayText`), seul le refus de la revue se dit.
  const lost: RelayLoss[] = []
  // Une revue déjà reçue, laissée de côté : la réponse le dit à la place de « relayée ».
  let isReviewRepeated = false
  const notes = new Set<string>()
  let startText = ''
  // Un ticket clos au-delà du seuil de compaction d'un worker : la réponse le dit à la fin.
  let closureText = ''
  if ((await read($, boardAtom))?.delegate) {
    if (typeof input.delegate === 'string') {
      // Le worker vient de se déclarer : son entrée de relais dit quel groupe elle fait.
      const started = await relaySignal($, { kind: 'start', ...(typeof input.group === 'string' && input.group.trim() !== '' ? { group: input.group.trim() } : {}) })
      if (started.isKept && started.note) notes.add(started.note)
      if (!started.isKept)
        startText = ` · NOT kept in the relay: the declaration of this session (${started.why}); without it, what it relays next is not tied to its group: call again with "delegate", "group" and "main", and send your final report by SendMessage too.`
    }
    // Ses `set`, ses choix faits sans la personne, ses comptes, son compte rendu et sa note partent au
    // relais, pas sur la mission, qu'ils arrivent seuls ou avec "delegate" (la session du groupe C le
    // renvoyait à chaque appel, et tout le reste se perdait). Ce que le relais ne garde pas se dit.
    const send = async (parts: RelayPart[], event: RelayEvent): Promise<RelayOutcome> => {
      const outcome = await relaySignal($, event)
      if (outcome.isRepeated) isReviewRepeated = true
      if (outcome.isKept && outcome.note) notes.add(outcome.note)
      if (!outcome.isKept) for (const part of parts) if (!(outcome.isRepeated && part === 'review')) lost.push({ part, why: outcome.why, ...(outcome.isFinal ? { isFinal: true as const } : {}) })
      return outcome
    }
    const changes = reportedChanges(input)
    if (changes.length > 0) {
      const kept = await send(['set'], { kind: 'tickets', changes })
      if (kept.isKept && e.agentId === undefined) closureText = await workerClosureNotice($, kept.closed ?? [])
    }
    const decided = reportedDecisions(input)
    const isDecidedKept = decided.length > 0 && (await send(['decided'], { kind: 'decided', items: decided })).isKept
    const withdrawn = reportedWithdrawals(input)
    const isWithdrawnKept = withdrawn.length > 0 && (await send(['withdrawn'], { kind: 'withdrawn', items: withdrawn })).isKept
    // Les choix gardés par le relais, remplaçants (`replacedBy`) compris : le rappel des choix d'expérience les lit.
    const replacing = isWithdrawnKept ? withdrawn.flatMap(w => (w.replacedBy ? [{ what: w.replacedBy }] : [])) : []
    if (isReachAuto) text += experienceChoiceNotice([...(isDecidedKept ? decided : []), ...replacing], true)
    const counts = reportedCounts(input)
    if (counts.review && !counts.security) await send(['review'], counts)
    else if (counts.security && !counts.review) await send(['security'], counts)
    else if (counts.review && counts.security) {
      // Une revue refusée pour ses comptes (`relayRefusal`, bogues compris) n'emporte pas la revue de sécurité : elle part seule ;
      // de même, un avis refusé pour un compte de sécurité gardé illisible n'emporte pas la revue.
      const outcome = await relaySignal($, counts)
      if (outcome.isRepeated) isReviewRepeated = true
      if (outcome.isKept && outcome.note) notes.add(outcome.note)
      // La revue déjà reçue est laissée de côté : seul l'avis de sécurité a pu se perdre.
      if (!outcome.isKept && outcome.isRepeated) lost.push({ part: 'security', why: outcome.why, ...(outcome.isFinal ? { isFinal: true as const } : {}) })
      else if (!outcome.isKept && outcome.isReview) {
        lost.push({ part: 'review', why: outcome.why, isFinal: true })
        await send(['security'], { kind: 'counts', security: counts.security })
      } else if (!outcome.isKept && outcome.isSecurity) {
        lost.push({ part: 'security', why: outcome.why, isFinal: true })
        await send(['review'], { kind: 'counts', review: counts.review })
      } else if (!outcome.isKept) for (const part of ['review', 'security'] as const) lost.push({ part, why: outcome.why, ...(outcome.isFinal ? { isFinal: true as const } : {}) })
    }
    // Un avis « conseillée » d'un worker, la revue de sécurité désactivée pour le projet : son mod relit le
    // même réglage que le manager (la racine du dépôt principal) et le lui dit, avant qu'il lance un relecteur.
    // Seulement un avis gardé au relais, sans comptes d'une revue déjà faite.
    const isAdviceKept = counts.security?.advised === true && counts.security.findings === undefined && !lost.some(l => l.part === 'security')
    if (isAdviceKept && (await securityReviewNow($)) === 'off') text = `${text} · ${SECURITY_OFF_REPLY.replace('<unit>', 'le groupe')}`
    const report = reportedReport(input)
    if (report !== '') {
      const runId = (await read($, boardAtom))?.delegate?.run ?? ''
      // Le fichier garde le texte tel qu'envoyé, sauts de ligne compris (le relais le met sur une ligne).
      const isWhole = runId !== '' && (await writeReportFile($, runId, await sessionId($), String(input.report).trim()))
      await send(['report'], { kind: 'report', text: report, ...(isWhole ? { isWhole } : {}) })
    }
    if (typeof input.note === 'string' && input.note.trim() !== '') await send(['note'], { kind: 'note', text: input.note.trim() })
  } else if (typeof input.delegate === 'string') {
    // La déclaration n'a pas pu s'enregistrer (l'état du tableau de bord ne s'est pas écrit) : rien n'est parti.
    for (const part of relayedPartsOf(input)) lost.push({ part, why: 'this session could not record its "delegate" declaration, so nothing was sent' })
  } else if (e.agentId === undefined && input.report !== undefined) {
    // Le rapport du compte rendu, donné par la discussion qui porte la mission : gardé pour le COO.
    const kept = await keepMissionReport($, input)
    if (kept !== '') text = `${text} · ${kept}`
  }
  const sentence = relayedSentence(input)
  if ((lost.length > 0 || isReviewRepeated) && sentence !== '') {
    const told = relayedSentence(input, lost, isReviewRepeated)
    text = text.includes(sentence) ? text.replace(sentence, told) : `${text} · ${told}`
  }
  text += startText + reportPathText + waitingUnreadText
  // Coupé ou en pause depuis une consigne qui portait le bloc du mode auto : la réponse le dit une fois.
  // Seulement à Claude, le fil principal : l'appel d'un spécialiste ne prévient pas Claude, ni ne consomme l'avis.
  const shown: Board | null = await read($, boardAtom)
  const shownRun = shown?.delegate || !isMainLoop ? null : activeRun(shown)
  const isShownAuto = shownRun !== null && (await isAutoHere($, shown))
  // L'avis suit l'état : éteint, la pause qui reprend d'elle-même, ou une autre pause ; une pause dite « reprend
  // d'elle-même » qui change ensuite sans reprendre (une coupure, la trace perdue) est redite une fois.
  if (shownRun && shown && !isShownAuto && (autoNoted.has(shownRun.id) || resumingSaid.has(shownRun.id))) {
    const notice = await autoNotOnNotice($, shown, shownRun)
    if (autoNoted.has(shownRun.id) || !notice.isResuming) {
      autoNoted.delete(shownRun.id)
      resumingSaid.delete(shownRun.id)
      if (notice.isResuming) resumingSaid.add(shownRun.id)
      text += notice.text
    }
  }
  if (shownRun && isShownAuto) resumingSaid.delete(shownRun.id)
  // Allumé en cours de phase, Claude pas encore prévenu : la réponse lui donne la consigne, une fois ; après la
  // reprise d'elle-même d'une pause dont il avait reçu le bloc, un rappel court (`canRemind`).
  const shownAt = shownRun ? await confirmedAtFor($, shownRun, await hereId($)) : null
  if (shownRun && isShownAuto && !(await isBriefed($, shownRun)) && briefingAt.get(shownRun.id) !== shownAt) {
    const isReminder = await canRemind($, shownRun)
    // L'avis d'abord : un texte qui ne se construit pas (un titre relu qui n'est pas un texte) ne laisse pas Claude compté prévenu.
    const notice = isReminder ? autoAgainNotice() : autoOnNotice(shownRun)
    await noteBriefed($, shownRun, undefined, !isReminder)
    text += notice
  }
  for (const note of notes) text += ` · Relayed, but ${note}: send your final report by SendMessage too.`
  if (moved !== undefined) text = `${moved} ${text}`
  await keepDelegate($)
  if (found !== '') text = `${found} ${text}`
  if (asideText !== '') text = `${text} · ${asideText}`
  if (launchText !== '') text = `${text} · ${launchText}`
  if (mainRefText !== '') text = `${text}${mainRefText}`
  if (closureText !== '') text = `${text} · ${closureText}`
  // Au fil principal du manager seulement : un spécialiste ne consomme jamais ces avertissements.
  if (e.agentId === undefined && !(await read($, boardAtom))?.delegate) text += takePistesWarnings() + takeDayWakeNotes()
  // L'étape « attente » d'une rétro qui commence : la liste d'attente relue, au fil principal seulement.
  if (shownRun && shown && input.step === 'attente' && currentPhase(shownRun).steps.find(s => s.status === 'active')?.id === 'attente') text += await attenteText($, shown, shownRun)
  // Un groupe lancé hors de la demande : dit une fois par session lancée, à Claude seulement (fil principal du manager).
  if (shownRun) text += await offRequestNotice($, shownRun)
  // `model` hors d'un appel `delegate` : connu du schéma, il n'est pas lu, et la réponse le dit.
  if (input.model !== undefined && input.model !== null && !isDelegateCall) text += ' · "model" ignored: it is read only with "delegate" (the Fable mark of a worker\'s first call).'

  return { result: text + unknownTail }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Le titre relevé par les hooks se relève de nouveau dans cette discussion : remis à zéro avant toute attente, pour
    // ne pas effacer celui qu'un SessionStart classique arrivé pendant ce démarrage a déjà porté.
    hookTitle = undefined
    // Un enregistrement refusé ne doit pas empêcher la minuterie (durées, relecture du stockage).
    await quietly(() => $.tool.register({ name: 'flow', description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA }))
    await quietly(() => loadArchiveConsent($))
    // Les chemins des références et du script de fermeture, cités dès la première réponse de l'outil.
    noteReferences($)
    await quietly(() => $.command.register({
      name: 'flow',
      description: 'Tableau de bord du workflow mattpocock : /flow [activity | history | commands | hide | show | pause | done | reset | rename <titre> | archive on|off]',
      argumentHint: '[activity|history|commands|hide|show|pause|done|reset|rename <titre>|archive on|off]',
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
    // Un rechargement : le verrou repart de zéro alors que la session a pu déjà faire son premier appel `delegate`
    // (sans que sa clé s'écrive) ; dans le doute, plus aucun appel n'est le premier, et la session reste sur Opus.
    if (isReloadToAnnounce) closeFableFirst()
    // Démarrage ou rechargement : la référence « [ref] » de la discussion a pu changer ; chaque mission portée
    // ici avec des groupes confiés la redemande à Claude (`mainRefAsk`).
    mainRefWritten.clear()
    mainRefFailures.clear()
    mainRefKnown.clear()
    // La demande entière de lancement reçue plus haut n'est plus sûre d'être dans la conversation : elle revient.
    launchOffered = null
    launchReceived = null
    // Une écriture restée en suspens (une lecture du moteur qui ne rend jamais la main) ne bloque pas les suivantes.
    mainRefChain = Promise.resolve()
    isAfterClear = false
    hereCache = null
    // Les traces gardées ici se relisent de `$.store` : après /reload-plugins, comme un mod rechargé.
    ownTraceCache.clear()
    // Claude prévenu de l'allumage : rien ne survit à un rechargement, il est prévenu une fois de plus (le sens sûr).
    briefedAt.clear()
    // Ni rappel court : après un rechargement, une reprise d'elle-même redonne le bloc entier.
    blockAt.clear()
    resumedFrom.clear()
    briefingAt.clear()
    refusedAt.clear()
    gestureBriefAt.clear()
    // Une tentative de reprise à la relance d'avant ce démarrage (un /clear, un moteur qui ne rend plus la main) ne retient
    // rien : son verrou se relâche, et sa génération passée lui interdit d'allumer.
    relaunchGen += 1
    relaunchRunning = null
    isRelaunching = false
    isRelaunchQuiet = false
    isFirstRelaunchChecked = false
    lastRelaunchOutcome = null
    // L'id de ce processus pour la date du clic de l'auto, hors d'un dessin (où l'état ne s'écrit pas).
    await quietly(() => ensureBoot($))
    // Les enregistrements de lancement périmés s'effacent au chargement.
    await quietly(() => pruneLaunches($))
    await ensureBoard($)
    // La reprise à la relance, dans le chargement même, sans retenir le démarrage (elle attend 1,5 s sa prise relue).
    void quietly(() => tryRelaunchResume($))
    await quietly(() => ensureRegistry($))
    // S1 : les anciens spécialistes des missions rejoignent le registre, puis quittent le board.
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
    // La marque « worker Fable » : seulement du premier appel `delegate` du processus qui écrit sa délégation, au fil
    // principal, le verrou ouvert ; pris sans attente entre le test et la prise, pour qu'aucun autre appel (parallèle)
    // ne passe pour le premier, fermé à l'écriture et rendu à la fin d'un appel qui n'a rien écrit.
    const delegateId = str((e as { delegate?: unknown }).delegate)
    const isDelegateCall = delegateId !== ''
    const isMainLoop = e.agentId === undefined
    const fable = { isClaimed: claimFableFirst(isDelegateCall, isMainLoop), isWritten: false }
    try {
      const { result: answer } = await flowCall($, e, isDelegateCall, isMainLoop, fable)
      // Au fil principal, la note sur ce qui part quand l'appel l'a changée.
      const result = isMainLoop ? await withSentChange($, answer) : answer
      if (!isDelegateCall) return { result }
      // Quelle que soit la sortie de l'appel (tableau de bord indisponible, refus, état qui bouge), la réponse ne dit
      // « worker Fable » que sous une délégation en mémoire marquée pour sa mission, et dit la marque non posée quand
      // l'appel portait `"model"` sans qu'elle le soit.
      const isMarked = isMarkedFor(await read($, boardAtom), delegateId)
      const model = (e as { model?: unknown }).model
      const isModelSent = isMainLoop && model !== undefined && model !== null
      const told = isMarked ? result : result.split(FABLE_WORKER_TEXT).join('')
      return { result: isModelSent && !isMarked && !fable.isWritten && !told.includes(FABLE_MARK_NOT_SET) ? `${told}${FABLE_MARK_NOT_SET}` : told }
    } finally {
      releaseFableFirst(fable.isClaimed, fable.isWritten)
    }
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
    if (id) typedCommand = { id, at: lastCommand!.at }
    // `/effort` ou `/model` (leur sélecteur compris, qui peut changer l'effort sans changer de modèle) : le relevé de la
    // dernière requête ne vaut plus, avant même le choix ; un niveau tapé avec `/effort` devient l'effort de la session.
    if (e.command === 'effort' || e.command === 'model') {
      const result = await next(e)
      const level = e.command === 'effort' && typeof e.args === 'string' ? e.args.trim().toLowerCase() : ''
      await quietly(async () => recordSettingNow($, await $.session.model(), EFFORT_LEVELS.has(level) ? level : undefined))
      return result
    }
    return next(e)
  })

  // Un skill du plugin se charge : la mission démarre, avance ou prend un détour, et Claude
  // reçoit, à la fin du texte du skill, les ids des étapes à signaler.
  on('skill.prompt', async ($, e, next) => {
    // `/flow-board:nuit` tapé : son skill se charge, le tour qui suit peut allumer la surveillance (posé avant `next` : le
    // `turn.start` de ce tour peut arriver avant qu'il rende la main).
    if (e.skill === NIGHT_SKILL && nightArm?.phase === 'submitted') nightArm = { phase: 'loaded' }
    const result = await next(e)
    // `/flow-board:coo` : la discussion prend le siège du COO (ou apprend qu'une autre le tient).
    if (e.skill === COO_SKILL) return { ...result, text: `${result.text}\n\n${await cooOpening($)}` }
    if (e.skill === NIGHT_SKILL) return result
    const id = skillIdOf(e.skill)
    if (!id) return result
    // Un skill de départ d'une mission dans la discussion du COO : rien ne s'ouvre, et Claude le lit.
    const cooBoard: Board | null = await read($, boardAtom)
    if (SKILLS[id]?.role === 'flow' && cooBoard && !cooBoard.delegate && isCooDiscussion(cooBoard, await $.clock.now())) {
      // Le skill de départ devient une carte de lancement : la personne lance la mission d'un clic.
      const asCard = (LAUNCH_STARTS as readonly string[]).includes(id)
        ? ` Do not run this skill here: propose instead a launch card for this mission with "card" of the flow tool (start "${id}" unless ask-matt points elsewhere, its subject from the user's words), and tell the user to launch it from the card.`
        : ' Do not run this skill here.'
      return { ...result, text: `${result.text}\n\n${COO_NO_MISSION}${asCard}` }
    }
    // Une étape de la livraison lancée chez le COO (« ▶ Livrer ») : Claude la fait, rend son issue, et ne lance rien d'autre.
    const deliveryStep = (DELIVERY_KEYS as readonly DeliveryKey[]).find(k => DELIVERY_COMMAND[k] === id)
    if (deliveryStep && cooBoard && !cooBoard.delegate && isCooDiscussion(cooBoard, await $.clock.now())) {
      const d = await readDelivery($, cooBoard.root ?? '')
      if (d && d !== 'unread' && runningStep(d)?.key === deliveryStep)
        return {
          ...result,
          text: `${result.text}\n\nflow-board: this is step ${DELIVERY_FR[deliveryStep]} of the delivery the user started with « ▶ Livrer » in the COO. Do this step only, then report its outcome with the flow tool, alone in its call: {"delivery": {"step": "${deliveryStep}", "ok": true or false, "detail": "<what it did, or why it failed>"}}. Never run the next step yourself: the dashboard runs it only on success.`,
        }
    }
    const call = pendingSkills.find(p => p.skill === e.skill || skillIdOf(p.skill) === id)
    const isMain = call ? call.agentId === undefined : true
    const now = await $.clock.now()
    // La commande de rétro que ce mod a mise en file (sa prise du lancement) : ses arguments à elle, sans le délai de
    // `lastCommand`, jusqu'à son chargement même après la péremption de son lancement (la garde d'une mission en cours
    // ici joue alors encore), et jamais à la place d'un `/retro` tapé après elle.
    const isTypedAfter = lastCommand !== null && lastCommand.id === id && retroQueued !== null && lastCommand.at > retroQueued.claimAt
    const queued = id === 'retro' && isMain && call === undefined && !isTypedAfter ? retroQueued : null
    // Un `/retro` tapé après elle : ses arguments à lui ; la demande du COO n'a plus de commande à elle, sa prise est
    // rendue (le COO propose alors son repli), et rien ne la confond avec la rétro tapée.
    if (id === 'retro' && isMain && call === undefined && isTypedAfter && retroQueued !== null) {
      const dropped = retroQueued
      retroQueued = null
      await releaseRetroClaim($, dropped.launch, await hereId($), dropped.claimAt)
    }
    const args =
      call?.args ?? queued?.args ?? (lastCommand !== null && lastCommand.id === id && now - lastCommand.at < 60_000 ? lastCommand.args : undefined)
    // La commande tapée n'explique, pour l'auto, que le premier chargement de son skill, même sans consigne.
    const isTyped = typedCommand !== null && typedCommand.id === id && now - typedCommand.at < 60_000
    if (isTyped) typedCommand = null
    if (id === 'project:sync' && isMain) isRecheckAfterTurn = true
    // La rétro relit le transcript de la discussion si elle a été compactée, avec ou sans mission.
    const tail = id === 'retro' && isMain ? await retroTail($) : ''
    // Un worker lance lui-même les revues de son groupe : le tableau de bord d'ici l'apprend par le relais.
    if ((await read($, boardAtom))?.delegate) {
      if (id === 'final-review') await relaySignal($, { kind: 'review' })
      if (id === 'security-review') await relaySignal($, { kind: 'security' })
      return withTail(result, tail)
    }
    // La phase de code d'un lot sans groupes, quel que soit son départ (suggestion, onglet Commandes, commande
    // tapée) : relu et retenu comme un groupe ; retenu ou illisible, rien ne démarre et Claude le lit.
    const lotHere = activeRun(await read($, boardAtom))
    if (isMain && CODE_SKILLS.has(id) && lotHere && (lotHere.groups ?? []).length === 0 && lotHere.tickets.some(t => t.status !== 'done') && !isLotUnderway(lotHere)) {
      const held = await launchHolds($, [LOT_KEY], true)
      if (held === null) return { ...result, text: `${result.text}\n\nflow-board: the missions file or the plan of the project could not be read just now, so this lot does not start. Do not follow this skill: tell the user to try again in a few seconds.` }
      if (held.length > 0)
        return {
          ...result,
          text: `${result.text}\n\nflow-board: this lot is held by another mission (${held.map(h => `${h.group === LOT_KEY ? 'its lot' : `group ${neutralInPrompt(h.group)}`} of mission « ${neutralInPrompt(clip(h.title, 60))} », ${h.on === 'plan' ? 'by the validated plan of the project' : `${h.on === 'file' ? 'a file' : 'a resource'} in common: « ${neutralInPrompt(clip(h.shared, 40))} »`}`).join('; ')}). Do not follow this skill: tell the user that the lot starts once that work is closed, or right away with « ⇥ Forcer » on the « Ensuite » card.`,
        }
    }
    // Le premier message d'une mission lancée par le COO porte l'id du lancement : sa mission s'ouvre neuve, jamais une mission en pause reprise.
    const launchArg = typeof args === 'string' ? /"launch"\s*:\s*"([^"]{1,40})"/.exec(args)?.[1] : undefined
    const isLaunched = isMain && isLaunchId(launchArg) && !activeRun(await read($, boardAtom))
    if (queued !== null && queued.launch === launchArg) {
      retroQueued = null
      // Un tour de la personne a ouvert une mission ici pendant que la rétro attendait en file : rien ne s'ouvre, la
      // mission en cours reste telle quelle, et la prise du lancement est rendue (le COO le voit sans prise).
      if (!isLaunched) {
        await releaseRetroClaim($, queued.launch, await hereId($), queued.claimAt)
        return { ...result, text: `${result.text}\n\nflow-board: a mission is in progress in this discussion, so the retro the COO asked for does not open here, and its launch is handed back. Do not follow this skill: tell the user, in these words: « ${RETRO_BUSY_FR} »` }
      }
    }
    // La phase de code d'une mission à groupes, lancée sur des tickets nommés (commande tapée, Skill) : leurs groupes passent
    // par les retenues et le plan du projet, comme un lancement du panneau.
    const groupsHere = activeRun(await read($, boardAtom))
    if (isMain && (id === 'implement' || id === 'tdd') && groupsHere && (groupsHere.groups ?? []).length > 0 && typeof args === 'string') {
      const units = unitsNamedInArgs(groupsHere, args)
      if (units.length > 0) {
        const held = await launchHolds($, units, true)
        if (held === null || held.length > 0)
          return { ...result, text: `${result.text}\n\nflow-board: ${held === null ? 'the missions file or the plan of the project could not be read just now' : 'these tickets belong to a group held by another mission or by the plan of the project'}, so they do not start. Do not follow this skill: tell the user (« ⇥ Forcer » on the group's line launches it anyway).` }
      }
    }
    const fx = await commit($, board => applySkill(board, e.skill, { now, isMain, args, isLaunched }))
    // Depuis un worktree, le fichier du dépôt principal illisible : rien ne s'est chargé, Claude le lit.
    if (!fx && isMain && mainUnread) return { ...result, text: `${result.text}\n\nflow-board: ${MAIN_UNREAD}${tail}` }
    // Le skill d'une phase que l'auto a envoyée se charge : sa marque passe « démarrée ».
    if (isMain) await noteAutoStart($, id)
    // Un sous-skill de cadrage (`/grilling` pendant un tri) : les seules règles du cadrage, sans les étapes ni le bloc auto du skill.
    if (fx && fx.note === 'none' && isFramingSubSkill(id, fx.usedBy)) {
      const board = await read($, boardAtom)
      return withTail({ ...result, text: `${result.text}${framingSubSkillNote(await isAutoHere($, board))}` }, tail)
    }
    // Les revues du groupe et de sécurité ne changent pas de phase, mais leurs consignes comptent.
    if (!fx || (fx.note === 'none' && id !== 'final-review' && id !== 'security-review')) return withTail(result, tail)
    const run = activeRun(await read($, boardAtom))
    // Une phase qui touche au code commence : on regarde tout de suite si le distant a avancé.
    if (run && CODE_SKILLS.has(currentPhase(run).skill)) scheduleCheck($, true)
    // `/code-review` qui vient d'ouvrir (ou de relancer) une relecture de branche en reçoit la consigne.
    const noteId = id === 'final-review' && run && currentPhase(run).skill === 'branch-review' ? 'branch-review' : id
    // Les spécialistes de cette mission en échec, d'après les registres (S1 : plus dans la mission) :
    // celui de cette discussion et ceux de ses workers (Q-c), pour le seul compte rendu.
    const failedAgents = run && noteId === 'compte-rendu' ? await failedOfRun($, run) : 0
    noteReferences($)
    const isAuto = await isAutoHere($, await read($, boardAtom))
    // Claude n'est prévenu que par un texte qui reste dans le fil principal : un skill appelé par Claude
    // lui-même (Skill, sans spécialiste) ou tapé par la personne, jamais un skill forké (`context: fork`,
    // ou intégré à Claude Code comme /code-review, dont le moteur ne donne pas l'en-tête) ni un skill
    // qu'aucun appel d'ici n'explique (préchargé dans un spécialiste).
    const isForked = e.source === 'built-in' || e.frontmatter.context === 'fork'
    const isInMainLoop = isMain && !isForked && (call !== undefined || isTyped)
    // Le skill qui prévient Claude porte aussi la consigne de l'allumage : relire son dernier message,
    // déclarer ses questions ouvertes, et le bloc de la phase en cours (pas seulement celui de ce skill).
    let brief = ''
    if (isAuto && run && isInMainLoop) {
      // Le skill de la phase en cours porte déjà son bloc : il n'y manque que la consigne de relecture.
      const wasBriefed = await isBriefed($, run)
      if (!wasBriefed) brief = noteId === currentPhase(run).skill ? `\n${AUTO_BRIEF_IN_TURN}` : autoOnNotice(run)
      // Le bloc de la phase en cours n'est reçu que par l'avis ou par la consigne du skill de cette phase : la consigne
      // d'un autre skill (`/code-review` en cours de lot) ne déplace pas l'heure du bloc que `canRemind` compare à la compaction.
      await noteBriefed($, run, undefined, !wasBriefed || noteId === currentPhase(run).skill)
    } else if (isAuto && run) autoNoted.add(run.id)
    // Un lot sans groupes : la procédure d'un worker, ses fichiers de méthode et les commandes de ce poste.
    const lot = run && noteId === 'implement' && (run.groups ?? []).length === 0 ? await lotProcedure($) : null
    // Le compte rendu d'une mission à groupes : les fichiers où les workers ont déposé le leur.
    const reports = run && noteId === 'compte-rendu' && (run.groups ?? []).length > 0 ? relayReportsPattern($, run.id) : null
    // Le compte rendu : le relais entier, pour les totaux de revue de chaque groupe (lu en partie : inconnus).
    const factsGaps = { count: 0 }
    const factsRelay = run && noteId === 'compte-rendu' ? factsRelayOf(await readRelay($, run.id, factsGaps), factsGaps.count, run.id) : undefined
    // Une phase de code : les groupes en cours des autres missions, que le travail d'ici pourrait recouper.
    const inFlight = run ? await inFlightFor($, noteId, run.id) : null
    return run ? { text: `${result.text}${coachingNote(noteId, run, await read($, syncAtom), await measureRepo($), (await read($, boardAtom))?.session, await writeDecidedFile($, await read($, boardAtom)), failedAgents, REVIEW_NOTES.has(noteId) ? await standardsPath($) : null, isAuto, lot, reports, noteId === 'to-tickets' ? otherMissionFiles(await read($, boardAtom), run.id) : [], inFlight, SKILLS[noteId]?.isGrilling ? await askMattPath($) : null, await securityReviewNow($), factsRelay)}${brief}${tail}` } : withTail(result, tail)
  })

  // Ce qui se passe pendant une mission : spécialistes, fichiers, commandes, Asana, questions.
  on('tool.call', async ($, e, next) =>
    timedTool($, e, async () => {
      if (e.tool === TOOL || e.tool === 'Skill') return next(e)
      // Les spécialistes d'abord, dans toute session : avant la sortie vers le relais d'un
      // worker et celle de l'absence de mission.
      if (e.tool === 'Agent') return trackAgentCall($, e, next)
      // Les workers lancés ici, dans toute session : avant les mêmes sorties.
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

      // Un worker lancé pendant que des éléments ou des groupes lui sont confiés : son id est
      // gardé, et va au groupe que son titre nomme (« Groupe A · … »).
      if (e.tool === START_SESSION) {
        const ran = await nextNoting(e)
        // Un lancement que la personne a refusé ou interrompu (Échap) n'est pas un refus de l'app.
        if (ran.isError === true && e.agentId === undefined && autoLaunch?.isStarted === true && !CANCELLED.test(String(ran.text ?? ran.result ?? ''))) return refusedLaunch($, ran)
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
      // Un lancement `claude --bg` dont la sortie n'a pas de ligne « backgrounded » : la réponse au tour le dit.
      let launchNotice = ''
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
            // Le CLI lance ses workers par `claude --bg` : leur id va au groupe que leur titre nomme.
            const launches = backgroundLaunches(command, out)
            for (const launched of launches) {
              if (!(await commit($, board => linkGroupSession(board, launched.title, launched.id, now)))) await commit($, board => linkSession(board, launched.id, now, launched.title))
            }
            // Moins de lignes « backgrounded » que de lancements : des envois restent sans session après ce lancement.
            if (launches.length < backgroundLaunchCount(command)) launchNotice = unnotedLaunchNotice(activeRun(await read($, boardAtom)), 'filtered')
          } else if (isBackgroundLaunch(command)) {
            launchNotice = unnotedLaunchNotice(activeRun(await read($, boardAtom)), 'background')
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
      return launchNotice !== '' ? { ...ran, context: [...(ran.context ?? []), launchNotice] } : ran
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
      // Une exécution de /code-review : le moteur la nomme d'après sa commande, coupée vers 50
      // caractères ; l'appel Skill en cours en a les arguments entiers (l'id du ticket de sa cible).
      const described = text('description')
      // Seul l'appel du même lanceur dont la commande prolonge la description coupée : deux
      // /code-review peuvent être en vol.
      const shown = described?.replace(/…$/, '').trimEnd()
      const launcher = text('parentAgentId')
      const fork = shown?.startsWith('/code-review')
        ? pendingSkills.find(p => p.skill.replace(/^\//, '') === 'code-review' && p.args !== undefined && p.args !== '' && `/code-review ${p.args}`.startsWith(shown) && (p.agentId === undefined || launcher === undefined || p.agentId === launcher))
        : undefined
      await commitRegistry($, reg =>
        spawnRegistryAgent(
          reg,
          {
            agentId,
            callKey: workflowRun === undefined ? text('tool_use_id') : undefined,
            parent: text('parentAgentId'),
            name: fork ? `/code-review ${fork.args}` : described,
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
    hasBackgroundList = Array.isArray(tasks)
    return next(e)
  })

  // Une requête au modèle, de la session ou d'un spécialiste : Réflexion jusqu'au premier morceau
  // de texte ou d'outil, Rédaction le temps d'un bloc de texte ; l'écriture d'un appel d'outil
  // ouvre son segment (essai de la frise en direct : moins d'une milliseconde par réponse).
  on('turn.step', async function* ($, e, next) {
    const lane = laneOfLoop(e.agentId)
    const startedAt = await $.clock.now()
    await quietly(() => commitRegistry($, reg => openSegment(reg, lane, { k: 'think', s: startedAt }, startedAt)))
    let phase: 'think' | 'write' | 'tool' = 'think'
    // Chaque requête du fil principal part à l'effort de son rôle et de sa phase (`leadEffortHere`) :
    // le COO en medium, un manager selon sa phase ou la règle du worker dont il fait le travail, un worker
    // en xhigh au moins pendant un ticket de jugement en cours, en high au moins pendant un ticket sensible en
    // cours ; un manager en cadrage sur Fable 5.2 medium (high quand l'auto de la mission envoie d'ici),
    // seulement si la requête nomme le modèle de la session et qu'aucun `/model` n'a été tapé. Jamais un
    // spécialiste ni un fork (`agentId`).
    const isMain = e.agentId === undefined && e.effort !== undefined
    const isFableOn = isMain && isFableAllowed() && (await isSessionModel($, e.model))
    // Une requête déjà sur Fable sans réécriture (un `/model` tapé) : la règle du cadrage sur Fable, sans toucher au modèle.
    const isOnFable = isMain && !isFableOn && isFableModelId(e.model)
    if (isMain) {
      isFableStep = isFableOn
      isOnFableStep = isOnFable
    }
    const lead = isMain ? await leadEffortHere($, e.effort!, isFableOn, isOnFable, false, e.model) : null
    if (isMain) isOpusBackStep = lead?.model === OPUS_CLI_ALIAS
    const sent = lead === null ? e : { ...e, ...(lead.effort !== e.effort ? { effort: lead.effort } : {}), ...(lead.model ? { model: lead.model } : {}) }
    // Le repli « Fable indisponible » ne joue que sur un échec qui suit une requête partie sur Fable.
    if (isMain) isLastStepFable = sent.model === FABLE_MODEL
    // Au fil principal, effort relevé ou non, la requête telle qu'elle part (l'effort envoyé) et le réglage de la
    // session sous lequel elle part : relevée avant son envoi, pour que la barre d'état et l'onglet la montrent
    // pendant qu'elle tourne, puis précisée à sa fin du modèle qui a répondu.
    // Une requête sans effort ne compte que sur le modèle de la session (un modèle sans niveau d'effort) : une requête
    // annexe du moteur, sur un autre modèle, ne remplace pas le relevé.
    // Seule une requête du fil principal avec un effort se relève, comme seule elle se réécrit (`isMain`) : une requête
    // sans effort (annexe, ou sur un modèle sans niveau d'effort) laisse le relevé, celui d'un `/model` y compris.
    const isMainThread = isMain
    const effort = e.effort === undefined ? undefined : String(e.effort)
    const sentAs = (model: string, at: number): SentRequest => ({
      model,
      ...(sent.effort !== undefined ? { effort: String(sent.effort) } : {}),
      session: { model: String(e.model), ...(effort !== undefined ? { effort } : {}) },
      at,
      by: SENT_MARK,
    })
    if (isMainThread) await recordSentNow($, sentAs(String(sent.model), startedAt))
    const stream = next(sent.effort !== e.effort || sent.model !== e.model ? sent : e)
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
      // Les appels à l'advisor ne se voient qu'ici, dans le résultat de l'étape (`serverToolUses`) :
      // posés après coup, avec leurs vraies heures.
      const served = (result?.serverToolUses ?? []) as readonly ServerToolUse[]
      // Au fil principal, le relevé précisé du modèle qui a répondu (sinon celui envoyé).
      const answered = ((result?.usage ?? null) as StepUsage | null)?.model
      const sentRequest: SentRequest | null = isMainThread ? sentAs(typeof answered === 'string' && answered !== '' ? answered : String(sent.model), endedAt) : null
      await quietly(() =>
        commitRegistry($, reg => {
          const closed = closeSegment(reg, lane, isModelSegment, endedAt) ?? reg
          const used = addUsage(closed, lane, (result?.usage ?? null) as StepUsage | null, effort, endedAt) ?? closed
          const advised = addAdvisorCalls(used, lane, served, endedAt) ?? used
          // Un réglage changé pendant la requête (`/model`, `/effort` : un relevé plus récent que son départ) garde son
          // relevé : celui de la fin de la requête le dirait d'un réglage qui n'est plus en place.
          const isSettingSince = (advised.main?.sent?.at ?? startedAt) > startedAt
          const noted = sentRequest && !isSettingSince ? (noteSent(advised, sentRequest, endedAt) ?? advised) : advised
          return noted === reg ? null : noted
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

  // La compaction se voit en direct (essai, point 9) : un repère sur le manager, pour une
  // compaction de la discussion elle-même ; un calcul à l'avance n'installe rien, et celle d'un
  // spécialiste n'est pas la sienne.
  // Les consignes de compaction (selon le rôle de la discussion) suivent le texte reçu, pour toute
  // compaction de la discussion, calcul à l'avance compris : la compaction suivante le réutilise.
  // Le repère suit le résultat : une compaction refusée (`skip`) ou ratée n'en pose pas.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // Une compaction (même rejetée, dans le doute) : la demande entière de lancement reçue plus haut revient.
    launchReceived = null
    // Chaque lecture à part : un registre illisible ne retire que le chemin du transcript.
    let board: Board | null = null
    let reg: SessionRegistry | null = null
    await quietly(async () => {
      board = await read($, boardAtom)
    })
    await quietly(async () => {
      reg = await read($, registryAtom)
    })
    let now: number | undefined
    await quietly(async () => {
      now = await $.clock.now()
    })
    const role: CompactionRole | null = compactionRoleOf(board, reg, now)
    const result = await next(role ? { ...e, instructions: withCompactionInstructions(e.instructions, compactionInstructions(role)) } : e)
    if (e.trigger !== 'precompute' && result.messages !== undefined) await markLane($, MAIN, { k: 'compact', at: await $.clock.now() })
    return result
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteTranscript($, e)
    return withDiscussionTitle($, e, await next(e))
  })
  on('classic.SessionStart', async ($, e, next) => {
    // Après un /clear, la discussion a un nouvel id : le mode auto le relit.
    hereCache = null
    // La demande du siège du COO passe au nouvel id : le siège, tenu par l'ancien, se reprend par « ↻ Reprendre ici ».
    if ((e as { source?: unknown }).source === 'clear') {
      const here = await hereId($)
      const before: Board | null = await read($, boardAtom)
      if (before?.cooHere !== undefined && before.cooHere !== here) {
        await quietly(() => commit($, b => (b.cooHere === undefined || b.cooHere === here ? null : { board: { ...b, cooHere: here }, fx: noFx() })))
        await keepCooHere($, here)
      }
    }
    await noteTranscript($, e)
    return withDiscussionTitle($, e, await next(e))
  })

  // Le tour d'un spécialiste (`agentId`) ne rend pas la main à Claude : seul le fil principal compte.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // Fin de l'attente d'une tâche de fond, s'il y en avait une.
    const at = await $.clock.now()
    await quietly(() => commitRegistry($, reg => closeSegment(reg, MAIN, s => s.k === 'waitBg', at)))
    await setLive($, 'working', null)
    isTurnOpen = true
    // Le tour de `/flow-board:nuit` commence (son skill chargé) : lui seul peut allumer la surveillance ; un autre tour l'annule.
    if (nightArm !== null) nightArm = nightArm.phase === 'loaded' ? { phase: 'started' } : null
    // Le tour du message tapé commence (même texte) ; tout autre tour l'annule.
    typedTurn = typedTurn?.phase === 'submitted' && e.text === typedTurn.text ? { text: typedTurn.text, phase: 'started' } : null
    // Le tour de la vague que l'auto vient de soumettre commence : sa fin effacera la demande gardée.
    if (e.agentId === undefined && autoLaunch !== null && !autoLaunch.isStarted && (e.text === autoLaunch.text || e.text === autoLaunch.turnText)) autoLaunch.isStarted = true
    // Le tour qui porte la dernière demande entière de lancement : Claude l'a reçue, la suivante peut être courte.
    if (isLaunchReceived(e.text, launchOffered)) launchReceived = launchOffered
    // Le travail de la mission reprend : elle n'attend plus la personne.
    await quietly(() => commit($, b => (b.delegate ? null : clearWaitsUser(b, at))))
    await reconcileAgents($)
    return next(e)
  })

  // Une commande du shell compte toujours (quel que soit l'endroit que la vue croit) : le mod n'écrit pas la liste
  // dans le projet tant qu'elle tourne ; la liste vivant dans le projet, elle attend aussi l'écriture en cours.
  // Le `git pull` ou le commit du COO ne croise jamais une écriture du mod dans le projet.
  const shellApart = async (run: () => Promise<any>) => {
    shellRunning++
    try {
      // Toujours après l'écriture en cours de la liste (la copie d'un clic vers le projet comprise).
      await waitlistChain.catch(() => undefined)
      return await run()
    } finally {
      shellRunning--
    }
  }
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => shellApart(() => next(e)))
  on('tool.call', { tool: 'PowerShell' } as any, async ($: any, e: any, next: any) => shellApart(() => next(e)))
  // Une question à boutons posée pendant un tour : la mission attend la validation de la personne, le temps qu'elle réponde.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId === undefined) await quietly(() => markWaiting($, 'validation', false))
    try {
      return await next(e)
    } finally {
      if (e.agentId === undefined) {
        const at = await $.clock.now()
        await quietly(async () => commit($, b => (b.delegate ? null : clearWaitsUser(b, at))))
      }
    }
  })

  // Fin d'un tour de la boucle principale : la main revient à la personne. La réponse dit
  // s'il reste des questions (grilling) ou si une revue vient de rendre.
  on('turn.complete', async ($, e, next) => {
    // Lu à l'entrée : un message en file peut ouvrir le tour suivant pendant ce traitement.
    const askedAt = submitAt
    // Fermé à l'entrée, pour la même raison : le `turn.start` d'un tour suivant, pendant ce traitement, le rouvre.
    if (e.agentId === undefined) isTurnOpen = false
    // Le tour de `/flow-board:nuit` fini : la surveillance ne s'allume plus par l'outil.
    if (e.agentId === undefined && nightArm?.phase === 'started') nightArm = null
    // Le tour du message tapé fini : plus de consigne au nom de la personne.
    if (e.agentId === undefined && typedTurn?.phase === 'started') typedTurn = null
    // Une réponse qui pose une question (finie sur « ? », sur une ligne « needs input », ou un « ? » de question ailleurs hors code) : la personne la lit, le COO ne se compacte pas avant sa réponse (posé avec
    // la fermeture du tour, pour qu'aucune relecture ne voie le tour fermé sans elle).
    if (e.agentId === undefined) isAnswerAsking = !e.isAborted && answerAwaitsPerson(e.answer)
    if (e.agentId === undefined && autoLaunch?.isStarted === true) autoLaunch = null
    const result = await next(e)
    // La fin du tour d'un spécialiste : sa réponse est rendue, il a fini.
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
    // Un message de la personne envoyé après la demande d'un worker, et le tour fini sans la lancer : le panneau le dit.
    if (askedAt !== null) {
      const ended = await $.clock.now()
      await commit($, board => noteUnlaunched(board, askedAt, ended))
    }
    // Un titre né pendant ce tour : la discussion le prend tout de suite, hors du hook (le moteur refuse une commande que le tour attend).
    if (!e.isAborted) $.clock.after(RENAME_DELAY_MS, () => void quietly(() => renameNow($)))
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
    // Le tour fini demande la personne (une question, le rapport, l'étape suivante) : le signal « t'attend », hors de l'auto actif.
    // Un tour fini en erreur (quota) : seule la pause de l'auto qu'il a posée fait attendre la personne.
    if (!e.isAborted && e.reason === 'answer') await quietly(async () => markWaiting($, waitingKind(e.answer, ask, (await read($, boardAtom)) as Board | null, await read($, syncAtom), await securityReviewNow($)), true))
    else if (!e.isAborted && e.reason === 'error') await quietly(() => markWaiting($, null, true))
    // L'auto décide de la suite à la fin d'un tour répondu de la discussion, pas d'un tour interrompu ni en erreur.
    // Une levée de tâche externe vue par le guet pendant ce tour ne relance plus rien après un tour fini (répondu :
    // la décision de fin de tour la couvre ; en erreur : l'auto ne décide pas) ; seul un tour interrompu la garde.
    if (!e.isAborted) liftedPending = null
    if (!e.isAborted && e.reason === 'answer') scheduleAutoTurn($)
    // Un worker dont un ticket vient de se clore au-delà du seuil : sa compaction, au repos.
    if (!e.isAborted && e.reason === 'answer') scheduleWorkerCompact($)
    return result
  })

  // Un `/model` tapé (ou choisi au sélecteur) : la personne garde la main, le mod ne réécrit plus le modèle
  // d'aucune requête de cette session ; un changement automatique (repli du moteur, reprise) ne compte pas.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const source = (e as unknown as { source?: unknown }).source
    if (source === 'command' || source === 'picker') isModelPinned = true
    // Le bandeau ne nomme Fable 5.2 que sur ce qui part vraiment : une session qui quitte Fable ne l'est plus, sans attendre une requête.
    if (!isFableModelId((e as unknown as { to_model?: unknown }).to_model)) {
      isOnFableStep = false
      isOpusBackStep = false
    }
    // Le bandeau relit le modèle de la session (« tape /model opus ») : redessiné tout de suite, sans attendre une requête.
    $.ui.invalidate('ui.render')
    // Le relevé de la dernière requête ne vaut plus : la barre d'état et l'onglet montrent le nouveau réglage.
    // L'effort de la session sous le nouveau modèle n'est pas connu (un modèle peut ne pas en avoir) : aucun.
    await quietly(() => recordSettingNow($, (e as unknown as { to_model?: unknown }).to_model))
    return next(e)
  })

  // Une erreur de quota en fin de tour met l'auto en pause (« quota atteint ») ; un nouveau clic le relance. Un worker
  // arrêté par une erreur que réessayer ne résout pas le dit, chez lui et au relais (`workerStopped`).
  on('classic.StopFailure', async ($, e, next) => {
    const error = (e as unknown as { error?: unknown }).error
    // L'échec du tour d'un spécialiste (`agent_id`) n'arrête pas le worker : pas de note d'arrêt pour lui.
    const isMainThread = (e as unknown as { agent_id?: unknown }).agent_id === undefined
    // Fable indisponible (limite atteinte juste après une requête partie sur Fable) : retour sur le modèle de la
    // session jusqu'à la fin de la session, dit une fois ; un worker Fable, arrêté avec son tour, reçoit une seule
    // fois un message de reprise, en file derrière le tour (un nouvel échec, sur Opus, ne relance rien).
    // Le tour que le repli Fable va reprendre (un message de reprise programmé par cet échec) : pas encore un worker
    // arrêté ; si ce message n'entre pas, `sendFableResume` dépose la note d'arrêt d'un `billing_error`.
    let isResumed = false
    if ((error === 'rate_limit' || error === 'billing_error') && isLastStepFable && !isFableOff) {
      isFableOff = true
      isLastStepFable = false
      await quietly(() => $.ui.toast(FABLE_OFF_TOAST))
      const board: Board | null = await read($, boardAtom)
      if (board?.delegate && isFableMark(board.delegate.model) && !isFableResumeSent) {
        isFableResumeSent = true
        isResumed = true
        // Seul l'échec du fil principal arrête le worker : celui d'un spécialiste ne dépose pas de note d'arrêt.
        $.clock.after(300, () => void sendFableResume($, isMainThread ? error : undefined))
      }
      $.ui.invalidate('ui.render')
    }
    // Un worker arrêté par une erreur que réessayer ne résout pas : il le dit, chez lui et au manager.
    // Sans l'attendre : un signal du relais resté en file ne doit jamais retenir `next(e)` ni la pause de l'auto.
    if (isMainThread) void quietly(() => workerStopped($, error, isResumed))
    if ((error === 'rate_limit' || error === 'billing_error') && (await isAutoHere($, await read($, boardAtom)))) {
      const now = await $.clock.now()
      await quietly(async () => afterAutoPause($, await commit($, board => stopActiveAuto(board, AUTO_STOPS.quota, now))))
    }
    return next(e)
  })

  // Pas de push en cours de mission : la suggestion `/project:push` de git-board s'écarte tant
  // qu'une mission est active ; elle revient hors mission.
  on('prompt.suggest', async ($, e, next) => {
    if (e.origin.kind === 'plugin' && e.origin.name === GIT_BOARD && activeRun(await read($, boardAtom))) return { isShown: false }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin.kind
    // Un message d'une autre session (pas le rapport d'un spécialiste) : un repère sur le manager.
    if ((kind === 'peer' && !e.text.trimStart().startsWith('<agent-message')) || kind === 'peer-send-message') await markLane($, MAIN, { k: 'msg', at: await $.clock.now() })
    // Le retour d'un spécialiste au fil principal : sur la piste de son lanceur.
    const returned = kind === 'peer' || kind === 'task-notification' ? returnedAgentOf(e.text) : null
    const launcher = returned !== null ? await launcherOf($, returned) : null
    if (launcher) await markLane($, launcher.lane, { k: 'back', at: await $.clock.now(), to: launcher.key })
    if (kind === 'composer' || kind === 'bridge' || kind === 'sdk') submitAt = await $.clock.now()
    // Le tour d'un message tapé par la personne : lui seul transmet une consigne en son nom ; tout autre message l'annule.
    typedTurn = isTypedOrigin(e.origin) ? { text: e.text, phase: 'submitted' } : null
    if (isTypedOrigin(e.origin)) typedTurnNo++
    // La surveillance de nuit : `/flow-board:nuit` tapé ouvre le seul tour qui peut l'allumer ; tout autre message
    // de la personne l'arrête (et annule ce tour), jamais un tour d'un mod, d'une autre session ou une notification.
    if (e.command?.name === NIGHT_SKILL && isTypedOrigin(e.origin)) nightArm = { phase: 'submitted' }
    else if (isPersonOrigin(e.origin)) {
      nightArm = null
      if ((await read($, boardAtom))?.cooHere !== undefined) {
        // Un arrêt raté reste dû : la surveillance ne vaut plus ici (relevé, réveil), et la relecture le refait.
        const out = await stopNight($, 'person').catch(() => 'failed' as const)
        personStopDue = out === 'failed'
      }
    }
    // Le tour d'une commande que l'auto a envoyée (`$.command.run` de ce mod) : sa marque passe « démarrée ».
    if (kind === 'plugin' && (e.origin as { name?: unknown }).name === SELF && e.command) await noteAutoStart($, skillIdOf(e.command.name))
    if ((kind === 'composer' || kind === 'bridge' || kind === 'sdk') && !e.text.trimStart().startsWith('/')) {
      const now = await $.clock.now()
      await commit($, board => applyUserAnswer(board, now))
    }
    // Le siège du COO d'avant un redémarrage, retrouvé avant la note : la règle du COO en dépend.
    await quietly(() => restoreCooHere($))
    // Chaque tour du fil principal (message, notification, message d'une autre discussion, tour de `/flow-board:coo`),
    // pas seulement un message tapé. Ce qui part vraiment, quand le mod envoie autre chose que le réglage de la
    // session : une note au contexte ; quand plus rien n'est imposé après une note, celle du retour au réglage.
    const told = await sentNoteHere($).catch(() => ({ note: null, reset: null, isUnknown: true as const }))
    const sentNow = told.isUnknown ? null : (told.note ?? (lastSentNote !== null ? told.reset : null))
    if (!told.isUnknown) lastSentNote = told.note
    const withNote = <T extends { context?: readonly string[] }>(ev: T): T => (sentNow === null ? ev : ({ ...ev, context: [...(ev.context ?? []), sentNow] } as T))
    // Dans une discussion qui a demandé le siège du COO, chaque message de la personne dit à Claude s'il le
    // tient encore, relu du fichier juste avant.
    // Le tour de `/flow-board:coo` : sa reprise armée si « ↻ Reprendre ici » l'a lancé ; son chargement dit le siège lui-même.
    if (e.command?.name === COO_SKILL) {
      isRetakeArmed = e.command.args.trim() === RETAKE_ARG
      return next(withNote(e))
    }
    const asked: Board | null = await read($, boardAtom)
    if (asked?.cooHere !== undefined) {
      const isRead = await pull($)
      const fresh: Board | null = await read($, boardAtom)
      const note = fresh ? seatContext(fresh, await hereId($), await $.clock.now(), isRead) : null
      // Au titulaire, le relevé d'état suit la ligne du siège : il ne parle de l'état qu'à partir de lui.
      const isHeld = isRead && fresh !== null && seatState(fresh.coo, await hereId($), await $.clock.now()) === 'mine'
      const statement = isHeld && fresh && note !== null ? await cooStatementFor($, fresh, isPersonOrigin(e.origin)) : null
      if (note !== null) return next(withNote({ ...e, context: [...(e.context ?? []), note, ...(statement !== null ? [statement] : [])] }))
    }
    // La mission portée ici avec des groupes confiés, sa référence pas encore envoyée depuis ce démarrage ou cette
    // reprise : Claude la relit et l'envoie. Jugé sur le fichier des missions relu : une mission reprise ailleurs
    // entre-temps ne se demande pas (l'appel la reprendrait).
    if (mainRefAsk(asked, asked?.session ?? '', mainRefWritten)) {
      const fresh: Board | null = (await pullOk($)) ? await read($, boardAtom) : null
      const askedRun = mainRefAsk(fresh, fresh?.session ?? '', mainRefWritten)
      if (askedRun) return next(withNote({ ...e, context: [...(e.context ?? []), mainRefAskText(askedRun)] }))
    }
    return next(withNote(e))
  })

  on('session.end', async ($, e, next) => {
    saveTimer?.cancel()
    hereCache = null
    hookTitle = undefined
    isAfterClear = e.reason === 'clear'
    // Le verdict de la reprise à la relance ne survit pas à la fin de la discussion (ni à un /clear) : le même processus
    // revenu à sa discussion n'en a aucun ; un effacement de la preuve encore à refaire reste.
    relaunchGen += 1
    relaunchEndGen += 1
    await quietly(() => update($, relaunchAtom, v => (v?.kind === 'due' ? { kind: 'none' as const } : v)))
    // Une pause de la relance pas encore dite ne se dit plus (la discussion qu'elle concernait s'arrête).
    await quietly(() => update($, relaunchNoticeAtom, n => (n?.state === 'pending' ? null : n)))
    // Les effacements de preuve encore à refaire, avant que la fin renomme une pause (la date du clic d'une pause « plus
    // rien ne peut avancer sans toi » ne doit jamais prouver sa relance).
    await quietly(() => retryErases($))
    // Une vraie fin de ce processus après un /clear : la date du clic que ce processus a gardée au nom d'un id qu'il
    // n'a plus ne prouve plus rien (jamais de reprise après /clear) ; le même processus revenu à cet id avant sa fin
    // (un /resume, qui finit la discussion vidée sous la raison « resume ») la garde, et son auto avec. Seules les
    // missions dont l'auto est allumé ou en pause qui peut reprendre à la relance se relisent.
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      await quietly(async () => {
        const here = await freshHereId($)
        const boot = await read($, bootAtom)
        for (const run of (await read($, boardAtom))?.runs ?? []) {
          const by = autoOnByOf(run)
          if (by === undefined || by === here || boot === '') continue
          if (!isAutoOn(run) && autoPauseWhy(run) !== AUTO_STOPS.ended && autoPauseWhy(run) !== AUTO_STOPS.stuck) continue
          const proof = await readProofFresh($, run.id)
          if (proof.state === 'read' && proof.value !== null && proof.value.by === by && proof.value.boot === boot) await forgetProofFor($, run.id, by, proof.value.onAt)
          const trace = await readTraceFresh($, run.id)
          if (trace.state === 'read' && trace.value !== null && trace.value.by === by && trace.value.boot === boot) await forgetProofFor($, run.id, by, trace.value.onAt)
        }
      })
    }
    // La fin ou le vidage de la discussion du COO arrête sa surveillance de nuit, avant que le siège soit libéré.
    nightArm = null
    if ((await read($, boardAtom))?.cooHere !== undefined) await quietly(() => stopNight($, e.reason === 'clear' ? 'clear' : 'closed'))
    let notices: string[] = []
    // Une vraie fin (pas un /clear) éteint l'auto de la mission ; elle reste active au nom de cette discussion, qui la retrouve relancée sous son id.
    if (e.reason !== 'clear') {
      // La fin de la discussion du COO libère son siège (relu d'abord : rien s'il est déjà ailleurs).
      // Un /clear le garde : le nouvel id le voit tenu et propose « ↻ Reprendre ici ».
      if ((await read($, boardAtom))?.cooHere !== undefined) await quietly(() => writeSeat($, 'release'))
      await quietly(() => relaySignal($, { kind: 'end' }))
      const now = await $.clock.now()
      // Rejouée si l'état a bougé entre la lecture et l'écriture (une relecture du stockage) : sinon l'« éteint à »
      // de l'auto, ou la clôture d'une mission finie, se perdraient.
      for (let attempt = 0; attempt < 5; attempt++) {
        const { value, version } = await $.state.get(BOARD_REF)
        const parked = value ? parkActive(value, now) : null
        if (!parked) break
        if ((await $.state.set(BOARD_REF, parked.board, { ifVersion: version })).isSet) {
          notices = autoNotices(value!, parked.board)
          await pruneConfirms($, value!, parked.board)
          // Une mission close par la fin de sa discussion (ses phases requises faites) réveille celles qui l'attendaient.
          await quietly(() => wakeWaiting($, value!, parked.board))
          break
        }
      }
    }
    await saveNow($)
    // Après la dernière sauvegarde, que l'« éteint à » soit écrit avant : la discussion se ferme, la
    // notification peut ne plus trouver de terminal, et elle ne bloque rien.
    await notifyAll($, notices)
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
    lastSurface = e.surface
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
  // le leur reste au-dessus, la mission dessous. Sans mission active, un bandeau d'accueil.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    lastSurface = e.surface
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
