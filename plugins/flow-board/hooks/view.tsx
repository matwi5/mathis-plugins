// Dessin du tableau de bord : le panneau à onglets (Mission, Activité, Historique) et le
// bandeau au-dessus du prompt. Un seul arbre pour toutes les surfaces : le desktop, VS Code
// et le mobile reçoivent les SVG animés, le terminal des glyphes et des barres en blocs.
//
// Pièges du desktop (relevés dans git-board) : les espaces ordinaires y sont fondus et
// `gap` ignoré ; les écarts dans un texte sont donc insécables, ceux entre éléments des
// marges. Aucune prop n'est passée à `undefined` : les arbres restent valides partout.
// `tests/dessin.test.mjs` refuse deux espaces ordinaires de suite dans un texte, `gap` et une
// prop à `undefined`, ici comme dans `cells.ts` et `svg.ts`.

import type { SyncState, AgentStatus, AgentsWindow, AdvisorCall, AdvisorLane, Artifact, ArtifactKind, Board, Closing, Detour, FlowItem, FlowPhase, FlowStep, FoundTask, ItemStatus, Live, Relay, Run, SecurityCheck, Tab, AgentLane, AgentMark, AgentType, RegistryAgent, SegmentKind, SessionRegistry, Ticket, ToolFamily, TicketGroup, TicketStatus, Tone, UiState } from '../types'
import { ANYTIME_GROUPS, C, CODE_SKILLS, COMMAND_GROUPS, FLOW_COMMANDS, LAUNCHERS, SKILLS, commandLineOf, slashOf, type AnytimeTool, type SkillDef, type StepDef } from './catalog.ts'
import {
  holdMapOf,
  PLAN_UNREAD_TEXT,
  LOT_KEY,
  type ForcedPair,
  type OutsideHold,
  activeDetour,
  autoStateOf,
  awaitedExternals,
  isAutoOn,
  CHOICES_LISTED,
  openQuestions,
  pendingAutoMarks,
  STALE_PREFIX,
  waitTargetLabel,
  asanaUrl,
  blockedCount,
  externalOf,
  commandText,
  delegatedTitle,
  doingOf,
  focusOf,
  groupPlan,
  resumable,
  type GroupPlan,
  type GroupView,
  isPickable,
  isNoLogicGroup,
  isTicketReviewEnough,
  isLotReviewEnough,
  isLotSecurityDue,
  isClosedTurnedOff,
  isLotAdvicePrevious,
  attachedIdsOf,
  groupProgress,
  isWaitingTicket,
  openBlockers,
  runProgress,
  suggestionsFor,
  nextLaunchFor,
  type NextLaunch,
  syncAdvice,
  tddCycles,
  unseenDecisions,
  isDelegable,
  groupReviewArgs,
  isPhaseOptional,
  type SyncStep,
} from './model.ts'
import {
  closingReason,
  linkedInFlight,
  pickableItems,
} from './link.ts'
import {
  relayForGroup,
  withRelay,
  type GroupRelay,
  inForce,
} from './relay.ts'
import {
  ORIGIN_LABELS,
  originOf,
  activeRun,
  countTickets,
  currentPhase,
  hasUnreadableCounts,
  isSecuritySettled,
  isSecuritySettledFor,
  hasGroupReview,
  clip,
} from './basics.ts'
import { MAIN, reviewForkName, runningOf } from './registry.ts'
import type { LinkedSession, LinkedState } from './linked.ts'
import type { HistoryEntry } from './history.ts'
import { forgetCount, forgetText } from './erase.ts'
import { seatState } from './seat.ts'
import { leadEffort, leadEffortPill, type LeadEffort } from './effort.ts'
import type { CooStatement } from './coo.ts'
import { cooBandParts, coordinationRows, securitySettingRows, type CooDo, type CooPart } from './coo-view.tsx'
import { SECURITY_UNREAD_FR, securityToggleLabel, securityToggleTarget, type SecurityReview } from './security-setting.ts'
import { suggestsCompaction } from './compaction.ts'
import { isSureLink } from './linked.ts'
import { archiveConsent, consentDay, neutralLine, reopenText, type ReopenText } from './closing.ts'
import { advisorCostOf, costOf, costText, familyOf, pricesFor, type UnitPrices } from './cost.ts'
import { HOUR_MS, TOOL_FAMILIES, WORKING_KINDS, activityOf, buildAxis, laneMarks, laneParts, laneTree, rulerTicks, sliceAxis, summaryOf, unionOf, windowBounds, zoomWindow, type Axis, type AxisPiece, type LanePart } from './timeline.ts'
import { DEFAULT, FAMILY_CELL, WAIT_COLOR, WAIT_GLYPH, laneCells, laneRaster, markLook, pack, rulerCells, textColorOf, type LaneCell } from './cells.ts'
import {
  barSvg,
  dotsSvg,
  laneSvg,
  miniRoadSvg,
  pulseSvg,
  ringSvg,
  roadmapSvg,
  rulerSvg,
  type BarPart,
  type NodeState,
  type RoadNode,
} from './svg.ts'

const NB = ' '
const SEP = `${NB}${NB}·${NB}${NB}`
/** Largeur estimée d'une cellule sur les surfaces distantes ; un SVG trop large est réduit à sa place. */
const PX_PER_CELL = 7.6

export type Kit = {
  Box: any
  Text: any
  Button: any
  Svg: any
  /** Lien externe ; absent d'une table qui n'en a pas. */
  Link: any
  /** La grille de cases du terminal (`Raster`), ou null : la frise passe alors en barres en blocs. */
  Raster: any
  /** La surface dessine les SVG (desktop, VS Code, mobile). */
  isRich: boolean
  /** Colonnes du corps. */
  width: number
}

/**
 * Ce que la surface dessine vraiment. La table de `$.ui.resolve(e)` est complétée : un élément
 * absent de la surface y figure quand même et dessine un fragment vide (au terminal 2.1.312, `Svg`
 * rend une boîte vide, et la frise des agents n'y montrait plus ni règle ni pistes). register.tsx
 * lit donc la capacité d'après la surface et la passe ici, comme git-board et stats-board.
 */
export type Caps = { hasSvg: boolean }

/** Une case vide, pour essayer le constructeur `Raster` de la table. */
const PROBE = pack([[[0x20, DEFAULT, DEFAULT]]])

/**
 * La table a vraiment `Raster` : le constructeur rend un élément `Raster`. Une surface qui ne le
 * connaît pas n'en a pas, ou le complète d'un fragment vide qui ne dessinerait rien (constaté par stats-board).
 */
const drawsRaster = (ctor: unknown): boolean => {
  if (typeof ctor !== 'function') return false
  try {
    return (ctor as (props: unknown) => { type?: unknown } | null)({ key: 'probe', columns: 1, rows: 1, cells: PROBE.cells })?.type === 'Raster'
  } catch {
    return false
  }
}

export const kitOf = (table: Record<string, unknown>, width: number, caps: Caps): Kit => ({
  Box: table.Box,
  Text: table.Text,
  Button: table.Button,
  Svg: caps.hasSvg ? (table.Svg ?? null) : null,
  Link: table.Link ?? null,
  Raster: !caps.hasSvg && drawsRaster(table.Raster) ? table.Raster : null,
  isRich: caps.hasSvg && typeof table.Svg === 'function',
  width: Math.max(24, Math.floor(width)),
})

export type View = {
  board: Board | null
  live: Live
  ui: UiState
  sync: SyncState
  now: number
  /** L'id de la discussion du moment (nouveau après un `/clear`) : le mode auto n'envoie que de celle qui l'a allumé. */
  here?: string
  /**
   * La date du second clic que cette discussion garde pour la mission active ici (`$.store`), null sans
   * clic gardé : l'auto n'envoie d'ici que si l'« allumé à » la vaut ; absent, pas vérifié.
   */
  autoConfirmedAt?: number | null
  /** L'avancement relayé par les workers de la mission active. */
  relay?: Relay | null
  /** Le registre des spécialistes de cette session (onglet Agents). */
  agents?: SessionRegistry | null
  /** Dans un worker : la règle d'effort que le mod a appliquée à sa dernière requête (un ticket sensible en cours), null sinon. */
  workerEffort?: LeadEffort | null
  /** Le suivi en défaut (S11, R2) : `true`, une écriture du registre refusée ; `'lost'`, un changement perdu. */
  agentsAlert?: boolean | 'lost'
  /** Le réglage « revue de sécurité » du projet, relu à ce rendu ; absent ou `unread` : montré « activée ». Jamais lu par une décision. */
  security?: SecurityReview
  /** Les effacements que cette discussion fait en ce moment (R1, S36) : `run:<id>` ou `session:<id>`, et leur titre. */
  erasing?: readonly { key: string; title: string }[]
  /** Les prix des modèles tirés de ccusage (Q15) ; null tant qu'ils manquent : « coût indisponible ». */
  agentPrices?: Readonly<Record<string, UnitPrices>> | null
  /** Le relevé d'état du projet, dans la seule discussion qui tient le siège du COO (sans mission ici) : sa vue Coordination. */
  coo?: CooStatement | null
  /** Le fichier de coordination ne se lit pas ici : l'auto ne lance rien (pause qui se lève seule à la relecture). */
  coordUnread?: boolean
  /** Les retenues de la mission portée ici par d'autres missions (calculées sur le fichier des missions relu). */
  holds?: readonly OutsideHold[]
  /** Le dernier lancement n'a pas relu le fichier des missions : rien n'est parti (la carte « Ensuite » le dit). */
  launchUnread?: boolean
  /** Le plan des vagues du projet ne se lit pas pour la mission d'ici (fichier de coordination ou entrée de plan) : rien ne part. */
  planUnread?: boolean
  /** La mission dont la suppression attend confirmation : ses comptes rendus de workers que le COO n'a pas encore relevés. */
  dropUngleaned?: number
  /** Les pistes de la rétro d'ici que le COO a vues déjà prises par une autre mission : hors du découpage. */
  taken?: readonly { item: string; title: string; ticket: string }[]
  /** Des marques de pistes qui ne se lisent pas : leurs pistes restent découpables, et la vue le dit. */
  takenNote?: string
  /** Les workers de cette discussion (onglet Agents), avec leur registre quand il se lit. */
  linked?: readonly { session: LinkedSession; reg: SessionRegistry | null }[]
  /**
   * Le sélecteur d'historique de l'onglet Agents, et la vue de l'entrée choisie (une mission passée,
   * une ancienne discussion) quand elle est lue.
   */
  history?: { entries: readonly HistoryEntry[]; shown: { key: string; title: string; self: SessionRegistry; linked: readonly { session: LinkedSession; reg: SessionRegistry | null }[] } | null }
}

export type Actions = {
  setTab: (tab: Tab) => unknown
  /** Lance la commande du skill (la suite de la mission). */
  launch: (skill: string, args?: string) => unknown
  /** Met la commande du skill dans le prompt (lanceur : la personne ajoute le sujet). */
  prepare: (skill: string, args?: string) => unknown
  /** Met une commande de Claude Code (`compact`) dans le prompt, sans passer par le catalogue. */
  fillCommand: (command: string) => unknown
  /** Met `/compact` dans le prompt après `/to-tickets` (carte « Ensuite ») ; le toast dit que flow-board ajoute ses consignes. */
  compactFirst: () => unknown
  /** Met dans le prompt une demande à Claude : mettre à jour le dossier `dir` par `git pull --ff-only`. */
  askFastForward: (dir: string | null) => unknown
  finish: () => unknown
  /** Met de côté la mission active ici, sans la clore : la discussion peut en ouvrir une autre. */
  setAside: () => unknown
  /** « ⚡ Auto », premier clic : montre ce que l'activation vaut et « Confirmer » (ou le cache). */
  askAuto: () => unknown
  /** « Confirmer » : allume le mode auto de la mission active ici, pour cette discussion. */
  confirmAuto: () => unknown
  /** Coupe le mode auto de la mission active ici. */
  stopAuto: () => unknown
  /** « ↻ Renvoyer » sur la question « envoi resté sans suite » d'une marque d'envoi du mode auto. */
  resendAuto: (runId: string, key: string) => unknown
  resume: (id: string) => unknown
  drop: (id: string) => unknown
  /** Range une mission aux archives. */
  archive: (id: string) => unknown
  /** Sort une mission des archives. */
  unarchive: (id: string) => unknown
  /** Montre ou cache les missions archivées dans l'historique. */
  toggleArchived: () => unknown
  toggleTickets: () => unknown
  /** Ajoute un ticket à la sélection, ou l'en retire. */
  pick: (id: string) => unknown
  clearPicks: () => unknown
  /** Lance la sélection : /implement, dans l'ordre choisi. */
  launchPicks: () => unknown
  /** Lot sans groupe : /implement sur tous ses tickets ouverts, dans l'ordre du lot. */
  launchAll: () => unknown
  /** Confie un groupe prêt à un worker ; la mission reste dans cette discussion. */
  launchGroupLinked: (id: string) => unknown
  /** Le même worker, en xhigh imposé ; `surface` : celle de l'appui (l'app y plafonne l'effort). */
  launchGroupLinkedXhigh: (id: string, surface?: string) => unknown
  /** Annule l'envoi d'un groupe à un worker qui n'a pas été lancé. */
  cancelGroupLinked: (id: string) => unknown
  /** Fait faire par son worker la revue d'un groupe rendu sans revue. */
  reviewLinkedGroup: (id: string) => unknown
  /** Demande à Claude de fermer le worker et le worktree d'un groupe rendu. */
  closeLinkedGroup: (id: string) => unknown
  closeLinkedItems: () => unknown
  /** Demande à Claude la revue de sécurité d'un groupe (ou du lot, `lot`) par un spécialiste relecteur. */
  securityReview: (id: string) => unknown
  /** La bascule du réglage « revue de sécurité » du projet : pose l'état visé, relu juste avant. */
  securityToggle: (to: 'on' | 'off') => unknown
  /** Demande à Claude un diagnostic de bug dans un worker, en détour de la phase en cours. */
  launchBugLinked: () => unknown
  /** Ajoute un élément de la phase (une piste de rétro) à la sélection, ou l'en retire. */
  pickItem: (id: string) => unknown
  /** Choisit tous les éléments encore à découper, ou les retire tous s'ils l'étaient déjà. */
  pickAllItems: () => unknown
  clearItemPicks: () => unknown
  /** Met dans le prompt la demande de découpage en tickets des éléments choisis, sans rien enregistrer. */
  splitItems: () => unknown
  /** Annule un envoi à un worker qui n'a pas été lancé. */
  cancelLinked: () => unknown
  /** Demande à Claude de vérifier le worker et de rendre ses éléments (session arrêtée sans note, ou jamais lancée). */
  recoverLinked: () => unknown
  /** Remet dans le prompt la demande de lancement des éléments qu'aucune session n'a pris. */
  relaunchLinked: () => unknown
  /** Demande (ou retire) la confirmation de suppression d'une mission archivée. */
  askDrop: (id: string) => unknown
  /** /ask-matt dans le prompt, prérempli avec l'endroit de la mission où l'on est. */
  askNext: () => unknown
  /** Confie chaque groupe d'un lot à son worker (0 : le lot principal, puis les autres lots). */
  launchParallelLinked: (lot?: number) => unknown
  toggleLog: () => unknown
  /** Déplie ou replie les éléments de la phase au-delà des 14 premiers. */
  toggleItems: () => unknown
  /** Déplie ou replie les livrables au-delà des 14 premiers. */
  toggleArtifacts: () => unknown
  /** La personne a relu les choix faits sans elle. */
  seeDecisions: () => unknown
  /** Déplie ou replie les choix déjà relus. */
  toggleDecided: () => unknown
  /** Déplie ou replie les tâches trouvées en route qui n'attendent pas la personne. */
  toggleFound: () => unknown
  /** Masque toute la liste « Trouvé en route », ou la réaffiche. */
  toggleHideFound: () => unknown
  /** La personne valide le compte rendu : la livraison peut venir. */
  validateReport: () => unknown
  /** Le compte rendu ne convient pas : le prompt reçoit le début de la réponse à Claude. */
  redoReport: () => unknown
  hideBand: () => unknown
  openPane: () => unknown
  /** Copie l'adresse d'un ticket (`what` : Asana, Issue) dans le presse-papiers de la surface pressée. */
  copyLink: (url: string, what: string, surface?: string) => unknown
  /** « ↺ Rouvrir » : copie la commande qui rouvre une session fermée (pour l'app, qui recrée son worktree) ; ne change rien d'enregistré. */
  reopenSession: (reopen: ReopenText, surface?: string) => unknown
  /** Onglet Commandes : allume ou éteint l'accord d'archivage d'office (`/flow archive on|off`). */
  toggleArchiveConsent: () => unknown
  /** Onglet Agents : la fenêtre de vue de la frise (zoom, déplacement) ; null, tout. */
  setAgentsWindow: (win: AgentsWindow | null) => unknown
  /** Onglet Agents : montre la frise d'un worker (sa clé), ou celle du manager (null). */
  selectAgentsSession: (key: string | null) => unknown
  /** Onglet Agents : déplie ou replie le sélecteur d'historique. */
  toggleAgentsHistory: () => unknown
  /** Onglet Agents : montre une entrée de l'historique (`now`, `run:<id>`, `session:<id>`). */
  chooseAgentsHistory: (key: string) => unknown
  /** Historique : ouvre l'onglet Agents sur une mission. */
  openAgentsOf: (runId: string) => unknown
  /** Onglet Agents : demande (ou retire) la confirmation d'« Oublier » une discussion (`session:<id>`). */
  askForget: (key: string) => unknown
  /** Onglet Agents : oublie une discussion et ses workers sûrs (S2, S15). */
  forget: (sessionId: string) => unknown
  /** Onglet Agents : ouvre ou referme la carte de détail d'une piste. */
  toggleAgentCard: (key: string) => unknown
  /** Carte de détail : déplie ou replie le prompt. */
  togglePrompt: () => unknown
  /** Onglet Agents : déplie ou replie la légende détaillée. */
  toggleLegend: () => unknown
  /** Frise : déplie ou replie la piste d'un Workflow. */
  toggleWorkflow: (id: string) => unknown
  /** Carte de détail : ouvre la transcription d'un spécialiste de cette discussion. */
  openAgentTranscript: (agentId: string) => unknown
  /** Bandeau d'accueil : fait de cette discussion le COO du projet (`/flow-board:coo`). */
  cooOpen: () => unknown
  /** Bandeau du COO : « ↻ Reprendre ici », le siège tenu ailleurs (ou libéré) passe à cette discussion. */
  cooTake: () => unknown
  /** Bandeau du COO : « Laisser », cette discussion ne demande plus le siège et redevient une discussion ordinaire. */
  cooLeave: () => unknown
  /** Vue Coordination : un geste sur la feuille de route (demande au Claude du COO, ou choix de l'endroit où elle vit). */
  cooDo: (d: CooDo) => unknown
  /** « ⇥ Forcer » sur une retenue entre missions : la seule paire nommée. */
  forceHold: (pair: ForcedPair) => unknown
}

// ─── Petits outils ────────────────────────────────────────────────────────

export const dur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}${NB}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}${NB}min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}${NB}h${NB}${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}${NB}j`
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n}${NB}${n > 1 ? many : one}`
const pct = (ratio: number): string => `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}${NB}%`
const shortModel = (model: string): string => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const spinFrame = (now: number): string => SPIN[Math.floor(now / 1000) % SPIN.length] ?? '⠋'
const px = (cells: number): number => Math.max(160, Math.floor(cells * PX_PER_CELL))

type Style = { color?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; strike?: boolean; wrap?: string }

/** Un Text sans prop indéfinie. */
const T = (k: Kit, text: string, style: Style = {}): unknown => {
  const props: Record<string, unknown> = {}
  if (style.color) props.color = style.color
  if (style.bg) props.backgroundColor = style.bg
  if (style.bold) props.bold = true
  if (style.dim) props.dimColor = true
  if (style.italic) props.italic = true
  if (style.strike) props.strikethrough = true
  if (style.wrap) props.wrap = style.wrap
  return h(k.Text, props, text)
}

/** Pastille pleine : texte foncé sur la couleur. */
const chip = (k: Kit, text: string, color: string): unknown => T(k, `${NB}${text}${NB}`, { bg: color, color: C.ink, bold: true })

const isShown = (item: unknown): boolean => item !== null && item !== undefined && item !== false && item !== ''

/** Une rangée d'éléments séparés par une marge (le desktop ignore `gap`). */
const line = (k: Kit, items: unknown[], wrap = false): unknown => {
  const { Box } = k
  const list = items.filter(isShown)
  return (
    <Box flexDirection="row" alignItems="center" flexWrap={wrap ? 'wrap' : 'nowrap'}>
      {list.map((item, i) => (i < list.length - 1 ? <Box marginRight={1}>{item}</Box> : item))}
    </Box>
  )
}

const svgOf = (k: Kit, drawn: { source: string; width: number; height: number }, alt: string, isAnimated: boolean, isSized = true): unknown => {
  const props: Record<string, unknown> = { source: drawn.source, alt }
  if (isSized) {
    props.width = drawn.width
    props.height = drawn.height
  }
  // Jamais `isInteractive` : ce mode dessine dans un cadre à fond blanc, rechargé (donc
  // clignotant) à chaque redessin. En image, le fond reste transparent et le dessin stable.
  void isAnimated
  return h(k.Svg, props)
}

/** Barre en blocs du terminal. */
const blocks = (k: Kit, parts: readonly BarPart[], total: number, cells: number): unknown => {
  const { Box } = k
  const width = Math.max(6, cells)
  const sum = Math.max(1, total, parts.reduce((n, p) => n + p.value, 0))
  let used = 0
  const segs: unknown[] = []
  parts.forEach(part => {
    if (part.value <= 0) return
    const n = Math.max(1, Math.round((part.value / sum) * width))
    const take = Math.min(n, width - used)
    if (take <= 0) return
    used += take
    segs.push(T(k, '█'.repeat(take), { color: part.color }))
  })
  if (used < width) segs.push(T(k, '░'.repeat(width - used), { color: C.gray, dim: true }))
  return <Box flexDirection="row">{segs}</Box>
}

const TONE: Record<Tone, string> = { info: C.gray, ok: C.green, warn: C.amber, error: C.red, accent: C.tangerine }

const KIND: Record<ArtifactKind, { glyph: string; color: string }> = {
  glossary: { glyph: '§', color: C.lilac },
  adr: { glyph: '▲', color: C.violet },
  spec: { glyph: '▤', color: C.blue },
  issue: { glyph: '▦', color: C.cyan },
  map: { glyph: '⚑', color: C.indigo },
  report: { glyph: '▲', color: C.teal },
  questionnaire: { glyph: '≡', color: C.lilac },
  prototype: { glyph: '✦', color: C.magenta },
  research: { glyph: '✧', color: C.indigo },
  handoff: { glyph: '➜', color: C.slate },
  lesson: { glyph: '✎', color: C.amber },
  config: { glyph: '⊞', color: C.slate },
  doc: { glyph: '¶', color: C.slate },
  script: { glyph: '⌘', color: C.sand },
  pr: { glyph: '⇄', color: C.green },
  plan: { glyph: '▧', color: C.teal },
  tracking: { glyph: '▥', color: C.slate },
}

const TICKET: Record<TicketStatus, { glyph: string; color: string; label: string }> = {
  todo: { glyph: '○', color: C.gray, label: 'à faire' },
  doing: { glyph: '◉', color: C.tangerine, label: 'en cours' },
  done: { glyph: '✓', color: C.green, label: 'fait' },
  blocked: { glyph: '!', color: C.amber, label: 'bloqué' },
}

const ITEM: Record<ItemStatus, { glyph: string; color: string }> = {
  todo: { glyph: '○', color: C.gray },
  doing: { glyph: '◉', color: C.tangerine },
  done: { glyph: '✓', color: C.green },
  dropped: { glyph: '✗', color: C.gray },
}

const STATE_WORD: Record<NodeState, string> = {
  done: 'fait',
  active: 'en cours',
  next: 'à lancer',
  pending: 'à venir',
  skipped: 'sauté',
}

// ─── Feuille de route ─────────────────────────────────────────────────────

const phaseSub = (run: Run, index: number): string => {
  const p = run.phases[index]!
  if (p.status === 'done') return p.startedAt !== undefined && p.finishedAt !== undefined ? `✓ ${dur(p.finishedAt - p.startedAt)}` : '✓'
  if (p.status === 'skipped') return 'sautée'
  if (p.status === 'active') {
    const def = SKILLS[p.skill]
    const t = countTickets(run.tickets)
    if (def?.hasTickets && t.total > 0) return `${t.done}/${t.total} tickets`
    const at = p.steps.findIndex(s => s.status === 'active')
    return at >= 0 ? `étape ${at + 1}/${p.steps.length}` : 'en cours'
  }
  return isPhaseOptional(run, p) ? 'facultative' : ''
}

/** Les stations : les phases, ou les étapes quand la mission n'a qu'une phase. */
const roadNodes = (run: Run): RoadNode[] => {
  if (run.phases.length === 1) {
    const only = run.phases[0]!
    const def = SKILLS[only.skill]!
    return only.steps.map(s => {
      const sd = def.steps.find(x => x.id === s.id)
      return {
        label: sd?.label ?? s.id,
        short: sd?.shortLabel,
        color: def.color,
        state: s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : s.status === 'skipped' ? 'skipped' : 'pending',
      }
    })
  }
  const nextAt =
    currentPhase(run).status === 'done' ? run.phases.findIndex((p, i) => i > run.cursor && p.status === 'pending') : -1
  return run.phases.map((p, i) => {
    const def = SKILLS[p.skill]!
    const state: NodeState =
      p.status === 'done' ? 'done' : p.status === 'active' ? 'active' : p.status === 'skipped' ? 'skipped' : i === nextAt ? 'next' : 'pending'
    return {
      label: def.label,
      short: def.shortLabel,
      sub: phaseSub(run, i),
      color: def.color,
      state,
      isOptional: isPhaseOptional(run, p),
      detours: p.detours.map(d => ({
        label: SKILLS[d.skill]?.label ?? d.skill,
        color: SKILLS[d.skill]?.color ?? C.gray,
        isActive: d.status === 'active',
      })),
    }
  })
}

const textRoad = (k: Kit, nodes: readonly RoadNode[], cells: number): unknown => {
  const { Box } = k
  const n = nodes.length
  const slot = Math.max(3, Math.floor((cells - 1) / Math.max(1, n)))
  const glyph = (x: RoadNode): string =>
    x.state === 'done' ? '●' : x.state === 'active' ? '◉' : x.state === 'next' ? '◎' : x.state === 'skipped' ? '·' : x.isOptional ? '◌' : '○'
  const marks: unknown[] = []
  const labels: unknown[] = []
  nodes.forEach((x, i) => {
    const isLit = x.state !== 'pending' && x.state !== 'skipped'
    marks.push(T(k, glyph(x), { color: isLit ? x.color : C.gray, bold: x.state === 'active' }))
    if (i < n - 1) {
      const isDone = x.state === 'done' || x.state === 'skipped'
      marks.push(T(k, (isDone ? '━' : x.state === 'active' ? '╍' : '┄').repeat(slot - 1), { color: isDone ? x.color : C.gray, dim: !isDone }))
    }
    const showLabel = slot >= 6 || x.state === 'active'
    const text = showLabel ? (x.short ?? x.label).slice(0, Math.max(1, slot - 1)) : ''
    labels.push(
      T(k, i < n - 1 ? text.padEnd(slot) : text, {
        color: x.state === 'active' || x.state === 'next' ? x.color : '',
        bold: x.state === 'active',
        dim: x.state !== 'active' && x.state !== 'next',
      }),
    )
  })
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">{marks}</Box>
      <Box flexDirection="row">{labels}</Box>
    </Box>
  )
}

const roadmap = (k: Kit, run: Run, cells: number): unknown => {
  const { Box } = k
  const nodes = roadNodes(run)
  if (nodes.length === 0) return null
  if (!k.isRich) return textRoad(k, nodes, cells)
  const drawn = roadmapSvg(nodes, px(cells))
  const alt = nodes.map(x => `${x.label} : ${STATE_WORD[x.state]}`).join(', ')
  return <Box marginTop={1}>{svgOf(k, drawn, alt, true, false)}</Box>
}

// ─── État vivant ──────────────────────────────────────────────────────────

const livePill = (k: Kit, run: Run, view: View): unknown => {
  if (run.status === 'done') return T(k, `✓${NB}Terminé`, { color: C.green, bold: true })
  if (run.status === 'active' && view.board?.activeId !== run.id) return T(k, `⇆${NB}Dans une autre discussion`, { color: C.blue, bold: true })
  if (run.status === 'paused') return T(k, run.asideAt !== undefined ? `‖${NB}Mis de côté` : `‖${NB}En pause`, { color: C.gray, bold: true })
  const running = agentsAtWork(view)
  const { live, now } = view
  // Des éléments chez un worker lancé : c'est lui qui travaille, pas la personne.
  const phase = currentPhase(run)
  const isGroupBusy = (run.groups ?? []).some(g => g.linked?.session !== undefined && relayForGroup(view.relay, g, run.groups)?.endedAt === undefined)
  const isLinkedBusy = (phase.linked?.session !== undefined && linkedInFlight(phase).length > 0) || isGroupBusy
  const mode = live.mode === 'waiting' && running > 0 ? 'agents' : isLinkedBusy && live.mode !== 'working' ? 'linked' : live.mode
  const look =
    mode === 'working'
      ? { color: C.tangerine, text: 'Claude travaille', isLive: true }
      : mode === 'linked'
        ? { color: C.blue, text: 'Worker au travail', isLive: true }
      : mode === 'agents'
        ? { color: C.blue, text: `${plural(Math.max(1, running), 'agent')} au travail`, isLive: true }
        : mode === 'waiting'
          ? { color: C.amber, text: live.ask ? `À toi : ${live.ask}` : 'À toi de jouer', isLive: false }
          : { color: C.gray, text: 'Prêt', isLive: false }
  const since = live.since > 0 && mode !== 'idle' ? dur(now - live.since) : ''
  const dot = k.isRich
    ? svgOf(k, pulseSvg(look.color, look.isLive), look.text, look.isLive)
    : T(k, look.isLive ? (Math.floor(now / 1000) % 2 === 0 ? '●' : '○') : '●', { color: look.color })
  return line(k, [dot, T(k, look.text, { color: look.color, bold: true }), since && T(k, since, { dim: true })])
}

// ─── En-tête ──────────────────────────────────────────────────────────────

const hero = (k: Kit, run: Run, view: View): unknown => {
  const { Box } = k
  const def = SKILLS[run.entry]!
  const color = def.color
  const ratio = runProgress(run)
  const phase = currentPhase(run)
  const inner = k.width - 6
  const where =
    run.phases.length > 1
      ? `phase${NB}${run.cursor + 1}/${run.phases.length}`
      : `étape${NB}${Math.max(1, phase.steps.findIndex(s => s.status === 'active') + 1 || phase.steps.length)}/${phase.steps.length}`
  const meta = [`/${slashOf(run.entry)}`, dur((run.finishedAt ?? view.now) - run.startedAt), where].join(SEP)
  const ring = k.isRich ? svgOf(k, ringSvg(ratio, color), `Avancement ${pct(ratio)}`, false) : T(k, pct(ratio), { color, bold: true })
  return (
    <Box key="hero" flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexShrink={1}>{chip(k, `${def.glyph}${NB}${def.flowLabel.toUpperCase()}`, color)}</Box>
        <Box marginLeft={1} flexShrink={0}>
          {livePill(k, run, view)}
        </Box>
      </Box>
      <Box flexDirection="row" alignItems="center" marginTop={1}>
        <Box marginRight={2} flexShrink={0}>
          {ring}
        </Box>
        <Box flexDirection="column" flexShrink={1}>
          {T(k, run.title, { bold: true, wrap: 'truncate-end' })}
          {T(k, meta, { dim: true, wrap: 'truncate-end' })}
          {!k.isRich && blocks(k, [{ value: ratio, color }], 1, Math.min(32, inner - 8))}
        </Box>
      </Box>
      {roadmap(k, run, inner)}
    </Box>
  )
}

// ─── Carte de la phase ────────────────────────────────────────────────────

const stepsList = (k: Kit, steps: readonly FlowStep[], def: SkillDef, color: string, now: number): unknown => {
  const { Box } = k
  if (steps.length === 0) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      {steps.map(s => {
        const label = def.steps.find(x => x.id === s.id)?.label ?? s.id
        const isActive = s.status === 'active'
        const glyph = s.status === 'done' ? '✓' : isActive ? '◉' : s.status === 'skipped' ? '–' : '○'
        const mark = s.status === 'done' ? C.green : isActive ? color : C.gray
        return (
          <Box flexDirection="row">
            <Box marginRight={1} flexShrink={0}>
              {T(k, glyph, { color: mark, bold: isActive })}
            </Box>
            <Box flexShrink={1}>{T(k, label, { color: isActive ? color : '', bold: isActive, dim: s.status === 'pending' || s.status === 'skipped', strike: s.status === 'skipped', wrap: 'truncate-end' })}</Box>
            {isActive && s.at !== undefined && <Box marginLeft={1} flexShrink={0}>{T(k, dur(now - s.at), { dim: true })}</Box>}
          </Box>
        )
      })}
    </Box>
  )
}

/** Les éléments d'une phase qui peut en demander le découpage en tickets (les pistes d'une rétro), et l'ancien envoi à un worker qu'elle suit. */
type Linkable = { phase: FlowPhase; view: View; act: Actions }

/**
 * Où en est l'envoi au worker : à lancer, ou pas lancé après un tour de Claude (avec
 * « Redemander » et « Annuler » dans les deux cas), au travail, ou terminé.
 */
const linkedRow = (k: Kit, l: Linkable, label: string): unknown => {
  const { Box, Button } = k
  const linked = l.phase.linked
  if (!linked) return null
  const inFlight = linkedInFlight(l.phase).length
  const total = linked.items.length
  const isWaiting = inFlight > 0 && linked.session === undefined
  // Terminée : sa fermeture s'affiche, et un nouveau découpage attend qu'elle soit fermée.
  if (inFlight === 0 && linked.session !== undefined && linked.closing?.state !== 'closed') {
    return (
      <Box key="linked" flexDirection="column">
        {line(k, [T(k, `✓${NB}Worker${NB}terminé`, { color: C.green, bold: true }), T(k, `fermer d'abord la session précédente avant un nouveau découpage`, { dim: true, wrap: 'wrap' })], true)}
        {closingRow(k, 'items', linked.closing, () => l.act.closeLinkedItems())}
      </Box>
    )
  }
  const parts =
    inFlight === 0
      ? [
          T(k, `✓${NB}Worker${NB}terminé`, { color: C.green, bold: true }),
          T(k, `${label}${NB}:${NB}${total}/${total}`, { dim: true }),
          linked.closing?.state === 'closed' && T(k, `✕${NB}session et worktree fermés`, { dim: true }),
        ]
      : linked.session !== undefined
        ? [
            T(k, `↗${NB}Worker${NB}au${NB}travail`, { color: C.blue, bold: true }),
            // Les éléments ne bougent qu'à la note de fin : un compteur à 0 ferait croire la session bloquée.
            T(k, `${plural(inFlight, label.replace(/s$/, ''), label)}${NB}en${NB}cours`, { dim: true }),
            T(k, dur(l.view.now - linked.at), { dim: true }),
          ]
        : linked.missedAt !== undefined
          ? [
              T(k, `⚠${NB}Aucun${NB}lancement${NB}relevé`, { color: C.amber, bold: true }),
              T(k, `${plural(inFlight, label.replace(/s$/, ''), label)} en attente : Claude a rendu la main sans lancer de session. S'il te pose une question, réponds-lui ; sinon redemande, ou annule pour les remettre au choix.`, { dim: true, wrap: 'wrap' }),
            ]
          : [T(k, `↗${NB}Worker${NB}à${NB}lancer`, { color: C.amber, bold: true }), T(k, `${plural(inFlight, label.replace(/s$/, ''), label)} en attente : envoie la demande à Claude, qui lance la session (plus dans le prompt : « Redemander »)`, { dim: true, wrap: 'wrap' })]
  // Fermée : de quoi la rouvrir sur sa branche gardée.
  const run = l.view.board?.runs.find(r => r.phases.includes(l.phase))
  const reopen = inFlight === 0 && run ? reopenText({ run, target: { kind: 'items', skill: l.phase.skill }, closing: linked.closing, session: linked.session, seq: linked.seq, root: l.view.board?.root ?? '' }) : null
  return (
    <Box key="linked" flexDirection="row" flexWrap="wrap" alignItems="center">
      <Box flexShrink={1}>{line(k, parts, true)}</Box>
      {reopen && <Box marginLeft={1} flexShrink={0}>{reopenButton(k, 'items', reopen, l.act)}</Box>}
      {isWaiting && (
        <Box marginLeft={1} flexShrink={0}>
          <Button key="linked-retry" plain={true} dimColor={linked.missedAt === undefined} label={`↻${NB}Redemander`} onPress={() => l.act.relaunchLinked()} />
        </Box>
      )}
      {isWaiting && (
        <Box marginLeft={1} flexShrink={0}>
          <Button key="linked-cancel" plain={true} dimColor={true} label="Annuler" onPress={() => l.act.cancelLinked()} />
        </Box>
      )}
      {/* Sans id relevé, la session a pu partir quand même (lancée autrement que prévu) : la reprise la cherche. */}
      {inFlight > 0 && (
        <Box marginLeft={1} flexShrink={0}>
          <Button key="linked-recover" plain={true} dimColor={true} label={`↻${NB}Reprendre${NB}les${NB}${label}`} onPress={() => l.act.recoverLinked()} />
        </Box>
      )}
    </Box>
  )
}

const ITEMS_SHOWN = 14

const itemsBlock = (k: Kit, items: readonly FlowItem[], def: SkillDef, color: string, view: View, act: Actions, linkable?: Linkable): unknown => {
  const { Box, Button } = k
  if (items.length === 0) return null
  const kept = items.filter(i => i.status !== 'dropped')
  const done = items.filter(i => i.status === 'done').length
  const isAll = view.ui.showAllItems === true
  const shown = isAll ? items : items.slice(0, ITEMS_SHOWN)
  // Une piste déjà prise par une autre mission (marque du COO) n'entre jamais dans un découpage.
  const takenBy = new Map((view.taken ?? []).map(t => [t.item, t]))
  const pickable = linkable ? pickableItems(linkable.phase, new Set(takenBy.keys())).map(i => i.id) : []
  // Confiés à une session pas encore lancée : ni à choisir, ni en cours.
  const waiting = linkable && linkable.phase.linked?.session === undefined ? linkedInFlight(linkable.phase).map(i => i.id) : []
  const selection = linkable ? (linkable.view.ui.itemSelection ?? []).filter(id => pickable.includes(id)) : []
  const isAllPicked = pickable.length > 0 && selection.length === pickable.length
  const label = (def.items?.label ?? 'Éléments').toLowerCase()
  const one = label.replace(/s$/, '')
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexShrink={1}>
          {line(k, [T(k, def.items?.label ?? 'Éléments', { bold: true }), T(k, `${done}/${items.length}`, { dim: true }), items.length > kept.length && T(k, `✗${NB}${items.length - kept.length}${NB}écarté${items.length - kept.length > 1 ? 's' : ''}`, { dim: true })])}
        </Box>
        {pickable.length > 0 && (
          <Box marginLeft={1} flexShrink={0}>
            <Button key="items-all" plain={true} dimColor={true} label={isAllPicked ? 'Tout désélectionner' : 'Tout sélectionner'} onPress={() => linkable!.act.pickAllItems()} />
          </Box>
        )}
      </Box>
      {linkable && linkedRow(k, linkable, label)}
      {pickable.length > 0 && selection.length === 0 && T(k, `Choisis les ${label} à traiter (○), puis demande leur découpage en tickets.`, { dim: true, wrap: 'wrap' })}
      {linkable && view.takenNote ? T(k, `⚠ ${view.takenNote}`, { color: C.amber, wrap: 'wrap' }) : null}
      {shown.map(item => {
        const look = ITEM[item.status]
        const isPicked = selection.includes(item.id)
        const cell = pickable.includes(item.id) ? (
          <Button key={`item-pick-${item.id}`} plain={true} dimColor={!isPicked} label={isPicked ? '●' : '○'} onPress={() => linkable!.act.pickItem(item.id)} />
        ) : waiting.includes(item.id) ? (
          T(k, '↗', { color: C.amber })
        ) : (
          T(k, look.glyph, { color: item.status === 'doing' ? color : look.color, bold: item.status === 'doing' })
        )
        return (
          <Box flexDirection="row">
            <Box marginRight={1} flexShrink={0}>
              {cell}
            </Box>
            <Box flexShrink={1}>
              {T(k, item.label, {
                wrap: 'wrap',
                bold: item.status === 'doing',
                dim: item.status === 'done' || item.status === 'dropped' || takenBy.has(item.id),
                strike: item.status === 'dropped',
              })}
              {linkable && takenBy.has(item.id) && item.status !== 'done' && item.status !== 'dropped'
                ? T(k, `déjà prise par « ${neutralLine(clip(takenBy.get(item.id)!.title, 50))} », ticket ${neutralLine(clip(takenBy.get(item.id)!.ticket, 40))}`, { color: C.amber, wrap: 'wrap' })
                : null}
            </Box>
          </Box>
        )
      })}
      {items.length > ITEMS_SHOWN && (
        <Button key="items-toggle" plain={true} dimColor={true} label={isAll ? '▾ réduire' : `▸ tout voir (${items.length})`} onPress={() => act.toggleItems()} />
      )}
      {selection.length > 0 && (
        <Box key="item-picks" flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1}>
          <Box marginRight={1}>
            <Button
              key="items-split"
              variant="primary"
              label={`✂${NB}Découper${NB}${selection.length}${NB}${selection.length > 1 ? label : one}${NB}en${NB}tickets`}
              onPress={() => linkable!.act.splitItems()}
            />
          </Box>
          <Button key="items-clear" plain={true} dimColor={true} label="Effacer" onPress={() => linkable!.act.clearItemPicks()} />
        </Box>
      )}
    </Box>
  )
}

const ORDINALS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']
const ordinal = (i: number): string => ORDINALS[i] ?? `${i + 1}.`

const shortName = (name: string): string => (name.length > 22 ? `${name.slice(0, 21)}…` : name)

/** Un ticket tel que son worker le relaie, tant que le groupe n'est pas rendu. */
const RELAYED: Record<TicketStatus, { glyph: string; color: string; label: string }> = {
  todo: TICKET.todo,
  doing: { glyph: '◉', color: C.tangerine, label: 'en cours ↗' },
  done: TICKET.done,
  blocked: { glyph: '!', color: C.amber, label: 'bloqué ↗' },
}

/**
 * Le lien d'un ticket : `Link` sur les surfaces riches ; au terminal, qui écrivait l'adresse
 * entière sur la ligne, un bouton qui la copie.
 */
const urlCell = (k: Kit, key: string, href: string, what: string, act: Actions): unknown => {
  const { Button, Link } = k
  if (!k.isRich) return <Button key={key} plain={true} dimColor={true} label={`⧉${NB}${what}`} onPress={(press?: { surface?: string }) => act.copyLink(href, what, press?.surface)} />
  return Link ? <Link href={href} label={`${what} ↗`} /> : null
}

/**
 * Une ligne de ticket : le choix (numéro d'ordre, ou cadenas tant qu'un bloqueur n'est ni fait ni
 * choisi avant), le titre, l'état, les dépendances et le lien vers Asana.
 */
const ticketRow = (k: Kit, run: Run, t: Ticket, view: View, act: Actions, relayed?: GroupRelay['tickets'][string]): unknown => {
  const { Box, Button } = k
  const selection = view.ui.selection ?? []
  const picked = selection.findIndex(s => s === t.id)
  const queued = (run.queue ?? []).indexOf(t.id)
  const blockers = openBlockers(run, t)
  // Bloqué sans raison mais derrière un ticket ouvert : c'est une attente, pas un blocage.
  const isWaiting = isWaitingTicket(run, t)
  // Le statut relayé par le worker prime à l'affichage, jamais dans la mission.
  const look =
    relayed && t.status !== 'done' && relayed.status !== 'todo'
      ? RELAYED[relayed.status]
      : isWaiting
        ? { glyph: '⏸', color: C.amber, label: 'en attente' }
        : TICKET[t.status]
  const nameOf = (id: string) => {
    const inLot = run.tickets.find(x => x.id === id)
    if (inLot) return shortName(inLot.name)
    const ext = externalOf(run, id)
    return ext ? `${shortName(ext.name)} (${ext.isDecision ? 'décision' : 'externe'})` : `${id} (inconnu)`
  }
  // Les décisions encore attendues : mises en avant, avec leur lien.
  const decisions = blockers.map(id => externalOf(run, id)).filter((x): x is NonNullable<typeof x> => x !== undefined && x.isDecision)
  const pickCell =
    t.status === 'done'
      ? T(k, '✓', { color: C.green })
      : picked >= 0
        ? <Button key={`pick-${t.id}`} plain={true} label={ordinal(picked)} onPress={() => act.pick(t.id)} />
        : isPickable(run, selection, t)
          ? <Button key={`pick-${t.id}`} plain={true} dimColor={true} label="○" onPress={() => act.pick(t.id)} />
          : T(k, '⛓', { color: C.amber })
  const url = asanaUrl(t.id)
  return (
    <Box key={`t-${t.id}`} flexDirection="column">
      <Box flexDirection="row" alignItems="center">
        <Box marginRight={1} flexShrink={0} width={3}>
          {pickCell}
        </Box>
        {queued >= 0 && t.status !== 'done' && <Box marginRight={1} flexShrink={0}>{T(k, `#${queued + 1}`, { color: C.tangerine, bold: true })}</Box>}
        {t.id.length <= 6 && <Box marginRight={1} flexShrink={0}>{T(k, t.id, { dim: true })}</Box>}
        <Box flexShrink={1}>{T(k, t.name, { wrap: 'wrap', dim: t.status === 'done', bold: t.status === 'doing' || picked >= 0 })}</Box>
        {/* Fait : la coche verte et le titre grisé suffisent. */}
        {t.status !== 'done' && <Box marginLeft={1} flexShrink={0}>{T(k, `${look.glyph}${NB}${look.label}`, { color: look.color })}</Box>}
        {t.status === 'doing' && t.by !== undefined && t.by !== view.board?.session && <Box marginLeft={1} flexShrink={0}>{T(k, `⇆${NB}autre discussion`, { color: C.blue })}</Box>}
        {t.startedAt !== undefined && <Box marginLeft={1} flexShrink={0}>{T(k, dur((t.finishedAt ?? view.now) - t.startedAt), { dim: true })}</Box>}
        {url !== null && <Box marginLeft={1} flexShrink={0}>{urlCell(k, `copy-${t.id}`, url, 'Asana', act)}</Box>}
      </Box>
      {(t.blockedBy ?? []).length > 0 && t.status !== 'done' && (
        <Box paddingLeft={4}>
          {T(k, `⛓${NB}après : ${(t.blockedBy ?? []).map(id => `${nameOf(id)}${blockers.includes(id) ? '' : ' ✓'}`).join(', ')}`, { dim: true, wrap: 'wrap' })}
        </Box>
      )}
      {relayed?.status === 'blocked' && t.status !== 'done' && relayed.why && (
        <Box paddingLeft={4}>{T(k, `!${NB}attend : ${relayed.why}`, { color: C.amber, wrap: 'wrap' })}</Box>
      )}
      {t.status === 'blocked' && !isWaiting && (
        <Box paddingLeft={4}>
          {T(k, t.why ? `!${NB}attend : ${t.why}` : `!${NB}raison non précisée`, { color: C.amber, dim: !t.why, wrap: 'wrap' })}
        </Box>
      )}
      {t.status !== 'done' &&
        decisions.map(d => {
          const href = asanaUrl(d.id)
          return (
            <Box key={`d-${t.id}-${d.id}`} flexDirection="row" paddingLeft={4}>
              <Box flexShrink={1}>{T(k, `⚖${NB}Décision à prendre : ${d.name}`, { color: C.amber, bold: true, wrap: 'wrap' })}</Box>
              {href !== null && <Box marginLeft={1} flexShrink={0}>{urlCell(k, `copy-${t.id}-${d.id}`, href, 'Asana', act)}</Box>}
            </Box>
          )
        })}
    </Box>
  )
}

const ticketParts = (run: Run): BarPart[] => {
  const t = countTickets(run.tickets)
  return [
    { value: t.done, color: C.green },
    { value: t.doing, color: C.tangerine, isLive: true },
    // Une attente (derrière un ticket ouvert) reste grise, comme sur sa ligne : seul le vrai blocage est ambre.
    { value: blockedCount(run), color: C.amber },
  ]
}

const GROUP_COLORS = [C.blue, C.teal, C.magenta, C.coral, C.indigo, C.sand]

/** Où en est le worker d'un groupe : à lancer, au travail, ou terminé avec des tickets ouverts (ambre). */
const linkLabel = (k: Kit, link: NonNullable<TicketGroup['linked']>, relay: GroupRelay | null, open: number, now: number): unknown =>
  link.session === undefined
    ? T(k, `↗${NB}worker à lancer`, { color: C.blue, bold: true })
    : relay?.endedAt !== undefined
      ? open > 0
        ? T(k, `↗${NB}worker terminé il y a ${dur(now - relay.endedAt)}`, { color: C.amber, bold: true })
        : T(k, `↗${NB}worker terminé · à rendre`, { color: C.blue, bold: true })
      : T(k, `↗${NB}en cours · worker`, { color: C.blue, bold: true })

/** En-tête d'un groupe : où il en est, avec qui il peut avancer, ce qu'il attend, son worker. */
const groupHead = (k: Kit, run: Run, g: GroupView, color: string, view: View, act: Actions): unknown => {
  const { Button } = k
  const done = g.tickets.length - g.open.length
  const nameOf = (id: string) => run.tickets.find(t => t.id === id)?.name ?? externalOf(run, id)?.name ?? id
  const waits = [...g.waitsOn, ...g.waitsOutside.map(id => shortName(nameOf(id)))]
  const link = g.group.linked
  return line(
    k,
    [
      T(k, `${g.isFallback ? '' : `${g.group.id}${NB}·${NB}`}${g.group.name}`, { bold: true, color }),
      T(k, `${done}/${g.tickets.length}`, { dim: true }),
      g.parallelWith.length > 0 ? T(k, `∥${NB}${g.parallelWith.join(', ')}`, { color: C.cyan, bold: true }) : null,
      g.conflicts.length > 0 ? T(k, `∦${NB}${g.conflicts.map(c => `${c.with}${NB}:${NB}${c.on}`).join(', ')}`, { color: C.amber }) : null,
      g.state === 'waiting' && (waits.length > 0 || g.waitsElsewhere.length > 0)
        ? T(k, `⏸${NB}attend ${[...(waits.length > 0 ? [waits.join(', ')] : []), ...g.waitsElsewhere.map(elsewhereText)].join(' · ')}`, { color: C.amber })
        : null,
      ...g.waitsElsewhere.map(x => (
        <Button key={`force-${g.group.id}-${x.run}-${x.group}${x.on === 'plan' ? '-plan' : ''}`} plain={true} dimColor={true} label={x.on === 'plan' ? `⇥${NB}Forcer${NB}(plan)` : `⇥${NB}Forcer`} onPress={() => act.forceHold({ held: x.held, run: x.run, group: x.group, ...(x.on === 'plan' ? { on: 'plan' as const } : {}) })} />
      )),
      g.isCyclic ? T(k, `⚠${NB}ordre à revoir`, { color: C.red }) : null,
      g.isDelegated && link ? linkLabel(k, link, relayForGroup(view.relay, g.group, run.groups), g.open.length, view.now) : null,
      g.isDelegated && link?.session === undefined ? (
        <Button key={`group-linked-cancel-${g.group.id}`} plain={true} dimColor={true} label="Annuler" onPress={() => act.cancelGroupLinked(g.group.id)} />
      ) : null,
      isDelegable(g) ? <Button key={`launch-linked-${g.group.id}`} variant="primary" label={`↗${NB}Worker`} onPress={() => act.launchGroupLinked(g.group.id)} /> : null,
      isDelegable(g) ? xhighButton(k, `launch-xhigh-${g.group.id}`, g.group.id, act) : null,
    ],
    true,
  )
}

/** Les retenues entre missions de la vue, rangées par unité retenue. */
const outsideOf = (view: View): Map<string, OutsideHold[]> => holdMapOf(view.holds ?? [])

/** Ce qu'une unité attend dans une autre mission, sur sa ligne : « groupe D de « M » (fichier commun) » (titre neutralisé). */
const elsewhereText = (h: OutsideHold): string =>
  `${h.group === LOT_KEY ? 'le lot' : `groupe${NB}${h.group}`} de « ${neutralLine(clip(h.title, 50))} » (${h.on === 'plan' ? 'plan du projet' : h.on === 'file' ? 'fichier commun' : 'ressource commune'})`

/** Une retenue dite en entier : l'unité retenue, puis ce qu'elle attend. */
const heldText = (h: OutsideHold): string => `${h.held === LOT_KEY ? 'le lot' : `groupe${NB}${h.held}`} attend ${elsewhereText(h)}`

/** Un bouton avant son dessin : la carte « Ensuite » le dessine, le bandeau reprend tel quel le bouton de l'étape suivante. */
type NextButton = { key: string; label: string; onPress: (press?: { surface?: string }) => unknown; isPrimary?: true; isQuiet?: true }

const nextButton = (k: Kit, b: NextButton): unknown =>
  b.isQuiet ? <k.Button key={b.key} plain={true} dimColor={true} label={b.label} onPress={b.onPress} /> : <k.Button key={b.key} {...(b.isPrimary ? { variant: 'primary' } : {})} label={b.label} onPress={b.onPress} />

/** « ↗ xhigh », discret après « ↗ Worker » : le même groupe, en xhigh imposé ; l'appui donne sa surface. */
const xhighOf = (key: string, id: string, act: Actions): NextButton => ({
  key,
  isQuiet: true,
  label: `↗${NB}xhigh`,
  onPress: press => act.launchGroupLinkedXhigh(id, press?.surface),
})
const xhighButton = (k: Kit, key: string, id: string, act: Actions): unknown => nextButton(k, xhighOf(key, id, act))

/** Un lot parallèle : un worker par groupe. */
const lotRow = (k: Kit, ids: readonly string[], at: number, act: Actions): unknown => {
  const { Box, Button } = k
  const suffix = at === 0 ? '' : `-${at}`
  const lot = ids.join(' ∥ ')
  return (
    <Box key={`lot${suffix}`} flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={at === 0 ? 1 : 0}>
      <Box marginRight={1}>
        <Button key={`launch-parallel-linked${suffix}`} label={`⇉${NB}${lot} en parallèle · workers`} onPress={() => act.launchParallelLinked(at)} />
      </Box>
      {at === 0 && T(k, 'un worker par groupe', { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

/**
 * La revue de sécurité d'un groupe fini, ou du lot entier quand la mission n'a pas de groupes,
 * facultative : l'avis de Claude une fois la revue faite (il la lance lui-même quand il la juge
 * utile), puis son résultat. Rien tant que Claude n'a pas donné d'avis (groupes d'avant la 0.23.0
 * compris). Le bouton la lui demande quand il ne l'a pas lancée. `id` : le groupe, ou « lot ».
 */
const securityRow = (k: Kit, sec: SecurityCheck | undefined, id: string, act: Actions, review: SecurityReview, isClosedOff = false): unknown => {
  const { Box, Button } = k
  const group = { id }
  if (!sec) return null
  const toggle = securityToggleParts(k, id, review, act)
  const counts = hasUnreadableCounts(sec)
    ? ` · comptes relus hors forme (—), à renvoyer`
    : sec.findings !== undefined
      ? ` · ${plural(sec.findings, 'constat')}${(sec.fixed ?? 0) > 0 ? ` · ${sec.fixed} corrigé${sec.fixed! > 1 ? 's' : ''}` : ''}${(sec.dismissed ?? 0) > 0 ? ` · ${sec.dismissed} laissée${sec.dismissed! > 1 ? 's' : ''}` : ''}${(sec.proposedDismissed ?? 0) > 0 && !isSecuritySettled(sec) ? ` · ${sec.proposedDismissed} à laisser, proposé${sec.proposedDismissed! > 1 ? 'es' : 'e'} par la session` : ''}`
      : ''
  // Un avis « inutile » prime sur des comptes envoyés avec lui (un worker envoyait l'avis et des comptes à zéro) :
  // il ne se dit « relue » que par les failles trouvées quand même, ou des comptes illisibles à renvoyer.
  const isRunAnyway = sec.isAdvised === false && (hasUnreadableCounts(sec) || (sec.findings ?? 0) > 0)
  // Une revue lancée (ou des comptes reçus) : « La lancer quand même » ne se propose plus.
  const isLaunched = sec.ranAt !== undefined
  if (sec.ranAt !== undefined && sec.isAdvised !== false) {
    const isOpen = !isSecuritySettled(sec)
    return (
      <Box key={`sec-${group.id}`} flexDirection="row" flexWrap="wrap" alignItems="center" marginLeft={2}>
        <Box marginRight={1} flexShrink={1}>{T(k, `⛨${NB}sécurité relue${counts}`, { color: isOpen ? C.amber : C.green })}</Box>
        {toggle}
      </Box>
    )
  }
  if (isRunAnyway) {
    const isOpen = !isSecuritySettled(sec)
    return (
      <Box key={`sec-${group.id}`} flexDirection="row" flexWrap="wrap" alignItems="center" marginLeft={2}>
        <Box marginRight={1} flexShrink={1}>{T(k, `⛨${NB}sécurité jugée inutile${sec.why ? ` : ${neutralLine(sec.why)}` : ''} · relue quand même${counts}`, { color: isOpen ? C.amber : C.green, wrap: 'wrap' })}</Box>
        {toggle}
      </Box>
    )
  }
  if (sec.isAdvised === undefined) return null
  const launch = (
    <Button
      key={`security-group-${group.id}`}
      label={sec.isAdvised ? `⛨${NB}Revue de sécurité · spécialiste relecteur` : `⛨${NB}La lancer quand même`}
      onPress={() => act.securityReview(group.id)}
    />
  )
  // Conseillée sans revue, la revue désactivée pour le projet (relue « off », ou groupe clos avec sa marque) : tranchée,
  // pas « due » ; le bouton reste pour une revue ponctuelle.
  const isOff = sec.isAdvised === true && isSecuritySettledFor(sec, review, isClosedOff) && !isSecuritySettled(sec)
  return (
    <Box key={`sec-${group.id}`} flexDirection="row" flexWrap="wrap" alignItems="center" marginLeft={2}>
      {sec.isAdvised && <Box marginRight={1}>{launch}</Box>}
      <Box marginRight={1} flexShrink={1}>
        {T(k, `${sec.isAdvised ? 'conseillée' : `⛨${NB}sécurité jugée inutile`}${sec.why ? ` : ${sec.why}` : ''}${isOff ? ` · revue de sécurité désactivée pour ce projet` : ''}`, { color: sec.isAdvised && !isOff ? C.amber : undefined, dim: !sec.isAdvised || isOff, wrap: 'wrap' })}
      </Box>
      {!sec.isAdvised && !isLaunched && <Box marginRight={1}>{launch}</Box>}
      {toggle}
    </Box>
  )
}

/**
 * La bascule de la revue de sécurité du projet, à côté du bouton « ⛨ Revue de sécurité » : son état relu à
 * ce rendu ; une lecture ratée se montre « activée », avec sa ligne ambre ; un clic pose l'état inverse.
 */
const securityToggleParts = (k: Kit, id: string, review: SecurityReview, act: Actions): unknown[] => [
  <k.Box key={`security-toggle-${id}-box`} marginRight={1}>
    <k.Button key={`security-toggle-${id}`} plain={true} label={securityToggleLabel(review)} onPress={() => act.securityToggle(securityToggleTarget(review))} />
  </k.Box>,
  review === 'unread' && (
    <k.Box key={`security-unread-${id}`} flexShrink={1}>
      {T(k, `⚠${NB}${SECURITY_UNREAD_FR}`, { color: C.amber, wrap: 'wrap' })}
    </k.Box>
  ),
]

/**
 * La ligne de sécurité d'un lot sans groupes : comme celle d'un groupe ; un lot fini dispensé (aucun
 * ticket avec logique ni zone sensible), sans envoi de sécurité, se dit relu par les revues de ses
 * tickets, sans revue du lot ni de sécurité ; relu sans avis du passage en cours, elle dit l'avis
 * attendu, avec le bouton qui le demande.
 */
const lotSecurityRow = (k: Kit, run: Run, act: Actions, review: SecurityReview): unknown => {
  const { Box, Button } = k
  const isDone = run.tickets.length > 0 && run.tickets.every(t => t.status === 'done')
  if (isDone && run.security === undefined && isLotReviewEnough(run)) {
    return <Box key="sec-lot" marginLeft={2}>{T(k, `✓${NB}relu par les revues de ${run.tickets.length > 1 ? 'ses tickets' : 'son ticket'}`, { color: C.green })}</Box>
  }
  // Un avis antérieur à la dernière fin de ticket ou à la dernière revue du lot ne compte plus : il ne se montre pas comme celui du
  // passage, et ne se dit qu'une fois le lot relu, quand c'est lui qu'on attend.
  const isPrevious = isLotAdvicePrevious(run)
  const sec = run.security
  // Relu, pas dispensé, sans avis du passage (aucun, d'un passage précédent, ou sans avis ni lancement) :
  // le compte rendu attend l'avis de Claude ; la ligne le dit, et son bouton lui demande la revue de sécurité.
  if (isLotSecurityDue(run, review) && (sec === undefined || isPrevious || (sec.isAdvised === undefined && sec.ranAt === undefined))) {
    return (
      <Box key="sec-lot" flexDirection="row" flexWrap="wrap" alignItems="center" marginLeft={2}>
        <Box marginRight={1}>
          <Button key="security-group-lot" label={`⛨${NB}Revue de sécurité · spécialiste relecteur`} onPress={() => act.securityReview('lot')} />
        </Box>
        <Box marginRight={1} flexShrink={1}>
          {T(k, isPrevious ? 'avis de sécurité d’avant la dernière fin de ticket ou la dernière revue : celui de ce passage est attendu' : 'avis de sécurité attendu : le compte rendu attend que Claude le donne', { color: C.amber, wrap: 'wrap' })}
        </Box>
        {securityToggleParts(k, 'lot', review, act)}
      </Box>
    )
  }
  if (isPrevious) return null
  return securityRow(k, sec, 'lot', act, review)
}

/** « ↺ Rouvrir » d'une session fermée, quand la commande (pour l'app, celle qui recrée son worktree) a pu s'écrire. */
const reopenButton = (k: Kit, id: string, reopen: ReopenText | null | undefined, act: Actions | undefined): unknown => {
  const { Button } = k
  if (!reopen || !act) return null
  return <Button key={`reopen-${id}`} plain={true} dimColor={true} label={`↺${NB}Rouvrir`} onPress={(press?: { surface?: string }) => act.reopenSession(reopen, press?.surface)} />
}

/**
 * Où en est la fermeture d'un worker rendu : rien tant que rien n'a été tenté (elle part
 * d'office par la réponse de l'outil), puis fermée, à archiver dans l'app, ou arrêtée avec sa
 * raison et « ↻ Relancer la fermeture », le seul bouton, pour relancer une fois la cause réglée.
 * Fermée avec de quoi la rouvrir : « ↺ Rouvrir ».
 */
const closingRow = (k: Kit, id: string, closing: Closing | undefined, relaunch: () => unknown, reopen?: ReopenText | null, act?: Actions): unknown => {
  const { Box, Button } = k
  if (!closing) return null
  if (closing.state === 'closed')
    return (
      <Box key={`close-row-${id}`} flexDirection="row" flexWrap="wrap" alignItems="center">
        <Box marginRight={1} flexShrink={1}>
          {T(k, `✕${NB}session et worktree fermés`, { dim: true })}
        </Box>
        {reopenButton(k, id, reopen, act)}
      </Box>
    )
  const reason = closingReason(closing.why)
  if (closing.state === 'app') return <Box key={`close-row-${id}`}>{T(k, `⧗${NB}à archiver dans l'app${reason ? ` : ${reason}` : ''}`, { color: C.amber, wrap: 'wrap' })}</Box>
  return (
    <Box key={`close-row-${id}`} flexDirection="row" flexWrap="wrap" alignItems="center">
      <Box marginRight={1} flexShrink={1}>
        {T(k, `!${NB}fermeture arrêtée${reason ? ` : ${reason}` : ''}`, { color: C.amber, wrap: 'wrap' })}
      </Box>
      <Button key={`close-linked-${id}`} plain={true} dimColor={true} label={`↻${NB}Relancer la fermeture`} onPress={relaunch} />
    </Box>
  )
}

/** Les tickets rangés par vague puis par groupe, comme Claude les a regroupés. */
const groupsSection = (k: Kit, run: Run, plan: GroupPlan, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const colorOf = (g: GroupView) => (g.isFallback ? C.gray : GROUP_COLORS[plan.groups.indexOf(g) % GROUP_COLORS.length]!)
  const done = plan.groups.filter(g => g.state === 'done')
  const groupBox = (g: GroupView) => {
    const resources = g.group.resources ?? []
    // Les chemins servent au calcul du parallélisme ; la carte n'en montre que le nombre.
    const files = g.group.files ?? []
    const about = [g.group.why, files.length > 0 ? plural(files.length, 'fichier') : '', resources.length > 0 ? `⛁${NB}${resources.join(', ')}` : ''].filter(Boolean).join(' · ')
    // Un groupe confié montre aussi ses tickets faits dans la session : on y suit son avancement.
    const rows = view.ui.showAllTickets || g.isDelegated ? g.tickets : g.open
    const relay = g.isDelegated ? relayForGroup(view.relay, g.group, run.groups) : null
    return (
      <Box key={`g-${g.group.id}`} flexDirection="column" marginTop={1}>
        {groupHead(k, run, g, colorOf(g), view, act)}
        {about !== '' && <Box paddingLeft={2}>{T(k, about, { dim: true, wrap: 'wrap' })}</Box>}
        {rows.map(ticket => ticketRow(k, run, ticket, view, act, relay?.tickets[ticket.id]))}
      </Box>
    )
  }
  const waves = Array.from({ length: plan.waves }, (_, w) => plan.groups.filter(g => g.wave === w))
  const isNewHere = plan.groups.some(g => g.state === 'ready' && !g.isFallback && !g.isDelegated)
  const busyNames = plan.groups.filter(g => plan.busy.includes(g.group.id)).map(g => (g.isFallback ? 'Autres' : g.group.id))
  return (
    <Box key="groups" flexDirection="column">
      {waves.map((groups, w) => (
        <Box key={`wave-${w}`} flexDirection="column" marginTop={1}>
          {plan.hasParallelWave && T(k, `Vague ${w + 1}${groups.length > 1 && groups.every(g => g.parallelWith.length > 0) ? `${NB}·${NB}en parallèle` : ''}`, { bold: true, dim: true })}
          {groups.map(groupBox)}
        </Box>
      ))}
      {done.map(g => (
        <Box key={`g-done-${g.group.id}`} flexDirection="column" marginTop={1}>
        <Box flexDirection="row" flexWrap="wrap" alignItems="center">
          <Box marginRight={1} flexShrink={1}>
            {T(k, `✓${NB}${g.isFallback ? '' : `${g.group.id}${NB}·${NB}`}${g.group.name} : ${plural(g.tickets.length, 'ticket')} ${g.tickets.length > 1 ? 'faits' : 'fait'}`, { color: C.green, dim: true, wrap: 'truncate-end' })}
          </Box>
          {!g.isFallback &&
            (hasGroupReview(g.group) ? (
              T(k, `✓${NB}revu`, { color: C.green, bold: true })
            ) : isTicketReviewEnough(run, run.groups?.find(x => x.id === g.group.id) ?? g.group) ? (
              // Aucun ticket sensible ni avec logique, ou un seul ticket : les revues des tickets suffisent (l'avis de sécurité d'un groupe d'un ticket reste dû).
              // Un groupe d'un seul ticket avec logique, sensible ou muet : son avis de sécurité reste dû, la ligne le dit.
              T(k, `✓${NB}revu par ${g.group.tickets.length > 1 ? 'ses tickets' : 'son ticket'}${g.group.security === undefined && !isNoLogicGroup(run, run.groups?.find(x => x.id === g.group.id) ?? g.group) ? `${NB}·${NB}avis de sécurité dû` : ''}`, { color: C.green, bold: true })
            ) : g.group.delegated !== undefined ? (
              // Fait par un worker : ici la branche est fusionnée, la revue se fait là-bas.
              <Button key={`review-linked-${g.group.id}`} variant="primary" label={`◆${NB}Revue du groupe · worker`} onPress={() => act.reviewLinkedGroup(g.group.id)} />
            ) : (
              <Button key={`review-group-${g.group.id}`} variant="primary" label={`◆${NB}Revue du groupe`} onPress={() => act.launch('final-review', groupReviewArgs(run, g.group))} />
            ))}
        </Box>
        {/* Pas avant sa revue : elle se fait dans la session et son worktree. */}
        {!g.isFallback &&
          g.group.delegated !== undefined &&
          closingRow(
            k,
            g.group.id,
            g.group.delegated.closing,
            () => act.closeLinkedGroup(g.group.id),
            reopenText({ run, target: { kind: 'group', id: g.group.id, name: g.group.name }, closing: g.group.delegated.closing, session: g.group.delegated.session, seq: g.group.delegated.seq, root: view.board?.root ?? '' }),
            act,
          )}
        {!g.isFallback && securityRow(k, g.group.security, g.group.id, act, view.security ?? 'unread', isClosedTurnedOff(g.group))}
        {/* « tout voir » déplie aussi les groupes finis : leurs tickets restent consultables. */}
        {view.ui.showAllTickets && g.tickets.map(ticket => ticketRow(k, run, ticket, view, act))}
        </Box>
      ))}
      {plan.parallelBatch.length >= 2 && lotRow(k, plan.parallelBatch, 0, act)}
      {plan.otherBatches.length > 0 && (
        <Box key="other-lots" flexDirection="column" marginTop={plan.parallelBatch.length >= 2 ? 0 : 1}>
          {T(k, plan.parallelBatch.length >= 2 ? 'Autres lots possibles :' : 'Lots possibles :', { dim: true })}
          {plan.otherBatches.map((ids, i) => lotRow(k, ids, i + 1, act))}
        </Box>
      )}
      {plan.heldBatch.length >= 2 && (
        <Box key="parallel-held" marginTop={1}>
          {T(k, `⇉${NB}${plan.heldBatch.join(' ∥ ')} en parallèle une fois ${busyNames.join(', ')} fini${busyNames.length > 1 ? 's' : ''}`, { dim: true, wrap: 'wrap' })}
        </Box>
      )}
      {plan.delegated.length > 0 &&
        T(k, `↗${NB}${plan.delegated.join(', ')} dans un worker : son avancement (tickets d'après Asana, commits, tests) s'affiche sur le groupe, marqué ↗. Claude vérifie le travail à sa note de fin, puis rend les statuts ici.`, { dim: true, wrap: 'wrap' })}
      {isNewHere &&
        T(k, `↗${NB}« Worker » : Claude lance une session qui fait le groupe, et la mission reste ici. « ↗ xhigh » : la même session, lancée en xhigh, sans question sur l'effort, pour un groupe qui demande du jugement.`, { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

/**
 * La validation du compte rendu, réservée à la personne : le rapport se lit dans la discussion,
 * la décision se prend ici.
 */
const reportGate = (k: Kit, phase: FlowPhase, act: Actions): unknown => {
  const { Box, Button } = k
  if (phase.skill !== 'compte-rendu' || phase.status !== 'active') return null
  const isReady = phase.steps.some(s => s.id === 'validate' && s.status === 'active')
  return (
    <Box key="report-gate" flexDirection="column" marginTop={1}>
      {T(
        k,
        isReady
          ? 'Le rapport est dans la discussion : lis-le, puis valide-le ou dis ce qui ne va pas. Pas de livraison avant.'
          : 'Claude rédige le rapport. Tu le valideras ici une fois lu ; pas de livraison avant.',
        { color: isReady ? C.pink : undefined, dim: !isReady, wrap: 'wrap' },
      )}
      <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
        <Box marginRight={1}>
          <Button key="report-ok" variant="primary" label="✓ Valider le rapport" onPress={() => act.validateReport()} />
        </Box>
        <Button key="report-redo" label="✎ À reprendre" onPress={() => act.redoReport()} />
      </Box>
    </Box>
  )
}

/**
 * Les choix que Claude a faits sans la personne : ceux à relire, en avant avec leur raison ; les
 * relus restent pliés en une ligne, dépliables.
 */
const decidedBlock = (k: Kit, run: Run, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  // Un choix retiré (`withdrawn`) ne se montre plus : seuls les choix en vigueur.
  const all = inForce(run.decided ?? [], view.relay)
  if (all.length === 0) return null
  const unseen = all.filter(d => d.seenAt === undefined)
  const seen = all.filter(d => d.seenAt !== undefined)
  const isOpen = view.ui.showDecided === true
  // Une mission en auto en déclare des centaines : les plus récents de chaque sorte, le reste compté.
  const shownUnseen = [...unseen].reverse().slice(0, CHOICES_LISTED)
  const shownSeen = isOpen ? [...seen].reverse().slice(0, CHOICES_LISTED) : []
  const rows = shownUnseen.concat(shownSeen)
  const hidden = unseen.length - shownUnseen.length + (isOpen ? seen.length - shownSeen.length : 0)
  return (
    <Box key="decided" flexDirection="column" marginTop={1}>
      <Box flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexShrink={1}>
          {line(k, [
            T(k, `⚑${NB}Décidé sans toi`, { color: unseen.length > 0 ? C.amber : undefined, bold: unseen.length > 0, dim: unseen.length === 0 }),
            T(k, [unseen.length > 0 ? `${unseen.length}${NB}à relire` : '', seen.length > 0 ? `${seen.length}${NB}relu${seen.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '), { dim: true }),
          ])}
        </Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={1}>
          {seen.length > 0 && (
            <Box marginRight={unseen.length > 0 ? 1 : 0}>
              <Button key="decided-toggle" plain={true} dimColor={true} label={isOpen ? '▾ replier' : '▸ voir'} onPress={() => act.toggleDecided()} />
            </Box>
          )}
          {unseen.length > 0 && <Button key="decided-seen" plain={true} label="✓ Relu" onPress={() => act.seeDecisions()} />}
        </Box>
      </Box>
      {rows.map((d, i) => (
        <Box key={`d-${d.at}-${i}`} flexDirection="column">
          <Box flexDirection="row">
            <Box marginRight={1} flexShrink={0} width={3}>
              {T(k, d.seenAt === undefined ? '⚑' : '✓', { color: d.seenAt === undefined ? C.amber : C.gray, dim: d.seenAt !== undefined })}
            </Box>
            <Box flexShrink={1}>
              {T(k, d.relayedFrom !== undefined ? `${d.what} (↗${NB}Groupe${NB}${d.relayedFrom})` : originOf(d.origin) ? `${d.what} (${ORIGIN_LABELS[originOf(d.origin)!]})` : d.what, { wrap: 'wrap', dim: d.seenAt !== undefined })}
            </Box>
          </Box>
          {d.why !== undefined && <Box paddingLeft={4}>{T(k, `car : ${d.why}`, { dim: true, wrap: 'wrap' })}</Box>}
        </Box>
      ))}
      {hidden > 0 && T(k, `+${NB}${hidden}${NB}autres, plus anciens : le fichier des choix déjà déclarés les donne tous`, { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

/** Ce qui attend la personne d'abord (décision, action à elle), puis le reste ouvert, puis le fait. */
const foundRank = (f: FoundTask): number => (f.status === 'done' ? 3 : f.status === 'blocked' || f.isForUser === true ? 0 : f.status === 'doing' ? 1 : 2)

/** Lignes montrées sans dépliage : toutes celles qui attendent la personne, et le reste jusqu'à 4. */
const FOUND_SHOWN = 4

/**
 * Les tâches créées en route (constats de revue, anomalies, actions pour la personne) : visibles,
 * hors du lot, sans compter dans la progression ni retenir la livraison. L'état est le glyphe de
 * tête ; seuls un blocage et « pour toi » se disent en toutes lettres.
 */
const foundBlock = (k: Kit, run: Run, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const found = run.found ?? []
  if (found.length === 0) return null
  const ordered = [...found].sort((a, b) => foundRank(a) - foundRank(b))
  const open = ordered.filter(f => f.status !== 'done')
  const done = ordered.filter(f => f.status === 'done')
  const urgent = open.filter(f => foundRank(f) === 0).length
  const isOpen = view.ui.showFound === true
  const isHidden = view.ui.hideFound === true
  const rows = isHidden ? [] : isOpen ? ordered : open.slice(0, Math.max(urgent, FOUND_SHOWN))
  const hidden = ordered.length - rows.length
  const counts = [
    open.length > 0 ? `${open.length}${NB}ouverte${open.length > 1 ? 's' : ''}` : '',
    done.length > 0 ? `${done.length}${NB}faite${done.length > 1 ? 's' : ''}` : '',
    'hors du lot',
  ].filter(Boolean)
  return (
    <Box key="found" flexDirection="column" marginTop={1}>
      <Box flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexShrink={1}>{line(k, [T(k, 'Trouvé en route', { bold: true }), T(k, counts.join(' · '), { dim: true })])}</Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={1}>
          {!isHidden && (hidden > 0 || isOpen) && (
            <Box marginRight={1}>
              <Button key="found-toggle" plain={true} dimColor={true} label={isOpen ? '▾ replier' : `▸ ${hidden} de plus`} onPress={() => act.toggleFound()} />
            </Box>
          )}
          {/* Masquer tout, même ce qui attend la personne : le titre et ses comptes restent. */}
          <Button key="found-hide" plain={true} dimColor={true} label={isHidden ? '▸ afficher' : '× masquer'} onPress={() => act.toggleHideFound()} />
        </Box>
      </Box>
      {rows.map(f => {
        const look = TICKET[f.status]
        const href = f.url ?? asanaUrl(f.id)
        return (
          <Box key={`f-${f.id}`} flexDirection="column">
            <Box flexDirection="row">
              <Box marginRight={1} flexShrink={0} width={3}>
                {T(k, look.glyph, { color: look.color, bold: f.status === 'blocked' })}
              </Box>
              {/* Les noms Asana sont longs : ils passent à la ligne, sans pousser le lien hors du panneau. */}
              <Box flexShrink={1}>{T(k, f.name.replace(/^\[[^\]]{1,12}\]\s*/, ''), { wrap: 'wrap', dim: f.status === 'done' })}</Box>
              {f.isForUser === true && <Box marginLeft={1} flexShrink={0}>{T(k, 'pour toi', { color: C.violet })}</Box>}
              {href !== null && <Box marginLeft={1} flexShrink={0}>{urlCell(k, `copy-f-${f.id}`, href, f.url ? 'Issue' : 'Asana', act)}</Box>}
            </Box>
            {f.status === 'blocked' && (
              <Box paddingLeft={4}>{T(k, `!${NB}attend${f.why ? ` : ${f.why}` : ' : raison non précisée'}`, { color: C.amber, wrap: 'wrap' })}</Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

const ticketsBlock = (k: Kit, run: Run, view: View, act: Actions, cells: number): unknown => {
  const { Box, Button } = k
  const t = countTickets(run.tickets)
  const barCells = Math.max(8, Math.min(40, cells - 18))
  const bar = k.isRich
    ? svgOf(k, barSvg(ticketParts(run), t.total, px(barCells)), `${t.done} tickets faits sur ${t.total}`, t.doing > 0)
    : blocks(k, ticketParts(run), t.total, barCells)
  // Ordre affiché : la file lancée d'abord, puis le reste dans l'ordre du lot ; les faits à la fin.
  const queue = run.queue ?? []
  const rank = (x: Ticket) => (x.status === 'done' ? 2 : queue.includes(x.id) ? 0 : 1)
  const ordered = [...run.tickets].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? queue.indexOf(a.id) - queue.indexOf(b.id) : 0))
  const open = ordered.filter(x => x.status !== 'done')
  const shown = view.ui.showAllTickets ? ordered : open.slice(0, 20)
  const hidden = run.tickets.length - shown.length
  const selection = (view.ui.selection ?? []).filter(id => run.tickets.some(x => x.id === id))
  const plan = groupPlan(run, outsideOf(view))
  const hint = plan ? 'Lance un groupe dans un worker (↗), ou choisis les tickets (○) dans l’ordre voulu.' : 'Choisis les tickets à traiter (○), dans l’ordre voulu.'
  return (
    <Box flexDirection="column" marginTop={1}>
      {line(k, [T(k, 'Tickets', { bold: true }), bar, T(k, `${t.done}/${t.total}`, { bold: true }), T(k, pct(t.done / Math.max(1, t.total)), { dim: true })])}
      {open.length > 0 && selection.length === 0 && T(k, hint, { dim: true, wrap: 'wrap' })}
      {plan ? groupsSection(k, run, plan, view, act) : shown.map(ticket => ticketRow(k, run, ticket, view, act))}
      {/* Pendant le découpage (tickets, rétro), les groupes peuvent encore venir : pas de lancement du lot entier. */}
      {!plan && open.length > 0 && selection.length === 0 && currentPhase(run).skill !== 'to-tickets' && currentPhase(run).skill !== 'retro' && (
        <Box key="launch-all-row" marginTop={1}>
          <Button key="launch-all" label={`▶${NB}Tout implémenter ici`} onPress={() => act.launchAll()} />
        </Box>
      )}
      {open.length === 0 && T(k, `✓${NB}Tous les tickets sont faits`, { color: C.green })}
      {(plan ? run.tickets.length > open.length : hidden > 0 || view.ui.showAllTickets) && (
        <Button
          key="tickets-toggle"
          plain={true}
          dimColor={true}
          label={view.ui.showAllTickets ? '▾ réduire' : `▸ tout voir (${run.tickets.length})`}
          onPress={() => act.toggleTickets()}
        />
      )}
      {selection.length > 0 && (
        <Box key="picks" flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1}>
          <Box marginRight={1}>
            <Button key="launch-picks" variant="primary" label={`▶ Implémenter ${plural(selection.length, 'ticket')}`} onPress={() => act.launchPicks()} />
          </Box>
          <Button key="clear-picks" plain={true} dimColor={true} label="Effacer" onPress={() => act.clearPicks()} />
        </Box>
      )}
    </Box>
  )
}

const testsBlock = (k: Kit, run: Run, cells: number): unknown => {
  const { Box } = k
  const tests = run.tests.filter(t => t.kind === 'test')
  const checks = run.tests.filter(t => t.kind === 'check')
  if (tests.length === 0 && checks.length === 0) return null
  const green = tests.filter(t => t.ok).length
  const red = tests.length - green
  const cycles = tddCycles(run)
  const last = tests[tests.length - 1]
  const dots =
    tests.length === 0
      ? null
      : k.isRich
        ? svgOf(k, dotsSvg(tests, px(cells), C.green, C.red), `${green} lancements verts, ${red} rouges`, true)
        : (
            <k.Box flexDirection="row">
              {tests.slice(-Math.max(4, cells - 2)).map(t => T(k, '●', { color: t.ok ? C.green : C.red }))}
            </k.Box>
          )
  return (
    <Box flexDirection="column" marginTop={1}>
      {line(k, [
        T(k, 'Tests', { bold: true }),
        last && T(k, last.ok ? `✓${NB}au vert` : `✗${NB}au rouge`, { color: last.ok ? C.green : C.red, bold: true }),
        cycles > 0 && T(k, `${plural(cycles, 'cycle')} rouge${NB}→${NB}vert`, { dim: true }),
      ])}
      {dots}
      {line(k, [
        tests.length > 0 && T(k, `✓${NB}${green}`, { color: C.green }),
        tests.length > 0 && T(k, `✗${NB}${red}`, { color: C.red }),
        checks.length > 0 && T(k, `vérifications${NB}${checks.filter(c => c.ok).length}/${checks.length}`, { dim: true }),
      ])}
    </Box>
  )
}

const statsRow = (k: Kit, run: Run, def: SkillDef): unknown => {
  const { Box } = k
  const phase = currentPhase(run)
  const items: unknown[] = []
  if (def.isGrilling || phase.stats.rounds > 0) {
    items.push(T(k, `?${NB}${plural(phase.stats.questions, 'question')}`, { color: C.violet, bold: true }))
    if (phase.stats.rounds > 0) items.push(T(k, `↻${NB}${plural(phase.stats.rounds, 'tour')}`, { dim: true }))
    if (phase.stats.answers > 0) items.push(T(k, `✎${NB}${plural(phase.stats.answers, 'réponse')}`, { dim: true }))
  }
  if (run.counters.terms > 0) items.push(T(k, `§${NB}${plural(run.counters.terms, 'terme')}`, { color: C.lilac }))
  if (run.counters.adrs > 0) items.push(T(k, `▲${NB}${run.counters.adrs}${NB}ADR`, { color: C.violet }))
  if (items.length === 0) return null
  return <Box marginTop={1}>{line(k, items, true)}</Box>
}

const waitCallout = (k: Kit, run: Run, view: View): unknown => {
  const { Box } = k
  const phase = currentPhase(run)
  if (view.live.mode !== 'waiting' || !view.live.ask || phase.stats.rounds <= phase.stats.answers) return null
  return (
    <Box marginTop={1} borderStyle="round" borderColor={C.amber} paddingX={1}>
      {T(k, `◐${NB}À toi : réponds à ${view.live.ask} pour continuer.`, { color: C.amber, wrap: 'wrap' })}
    </Box>
  )
}

/** « dans .claude/worktrees/dev » quand le retard est mesuré ailleurs qu'à la racine du board, sinon rien. */
const whereMeasured = (view: View): string => {
  const dir = (view.sync.dir ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  const root = (view.board?.root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (dir === '' || root === '' || dir.toLowerCase() === root.toLowerCase()) return ''
  return ` dans ${dir.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? dir.slice(root.length + 1) : dir}`
}

/** Le bouton dit ce qu'il prépare, sans la commande : le texte gris au-dessus la donne. */
const syncButtonLabel = (c: SyncStep): string => ('shell' in c ? 'Préparer l’avance rapide' : c.args === 'base' ? 'Préparer la synchro avec la base' : 'Préparer la synchro')

/** Phase qui modifie le code : le distant a-t-il avancé depuis le dernier sync ? */
const syncCallout = (k: Kit, run: Run, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const phase = currentPhase(run)
  if (!CODE_SKILLS.has(phase.skill) || phase.status !== 'active' || view.sync.checkedAt === null) return null
  const advice = syncAdvice(view.sync)
  if (!advice) {
    const ref = view.sync.main ? `origin/${view.sync.main}` : 'le distant'
    return <Box key="sync" marginTop={1}>{T(k, `✓${NB}À jour avec ${ref}${whereMeasured(view)}${SEP}vérifié il y a ${dur(view.now - view.sync.checkedAt)}`, { dim: true })}</Box>
  }
  const first = advice.commands[0]!
  const where = whereMeasured(view)
  return (
    <Box key="sync" flexDirection="row" alignItems="center" marginTop={1} borderStyle="round" borderColor={C.cyan} paddingX={1}>
      <Box flexDirection="column" flexShrink={1} marginRight={1}>
        {T(k, `⟳${NB}${advice.reason[0]!.toUpperCase()}${advice.reason.slice(1)}`, { color: C.cyan, bold: true, wrap: 'wrap' })}
        {T(k, `Avant de modifier le code${where} : ${advice.commands.map(commandText).join(' puis ')}`, { dim: true, wrap: 'wrap' })}
      </Box>
      <Box flexShrink={0}>
        <Button
          key="sync-now"
          label={syncButtonLabel(first)}
          onPress={() => ('shell' in first ? act.askFastForward(first.dir) : act.prepare(first.skill, first.args))}
        />
      </Box>
    </Box>
  )
}

const reviewBlock = (k: Kit, run: Run): unknown => {
  const { Box } = k
  const phase = currentPhase(run)
  if (phase.stats.standards < 0) return null
  const st = phase.stats.standards
  const sp = Math.max(0, phase.stats.spec)
  const reviews = phase.stats.reviews ?? 0
  const fixed = phase.stats.fixed ?? 0
  const found = st + sp
  // Cumulé sur les revues de la phase, tel que Claude les a comptées.
  return (
    <Box marginTop={1}>
      {line(k, [
        T(k, reviews > 1 ? `Revues${NB}·${NB}${reviews}` : 'Revue', { bold: true }),
        T(k, `${plural(found, 'constat')}`, { color: found > fixed ? C.amber : C.green, bold: true }),
        T(k, `Standards${NB}${st} · Spec${NB}${sp}`, { dim: true }),
        found > 0 && T(k, `${fixed}${NB}corrigé${fixed > 1 ? 's' : ''}`, { color: fixed >= found ? C.green : undefined, dim: fixed < found }),
      ])}
    </Box>
  )
}

const detourCard = (k: Kit, detour: Detour, view: View, act: Actions): unknown => {
  const now = view.now
  const { Box } = k
  const def = SKILLS[detour.skill]!
  const steps = detour.steps
  return (
    <Box key="detour" flexDirection="column" borderStyle="round" borderColor={def.color} paddingX={1} marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexShrink={1}>
          {line(k, [T(k, `↳${NB}Détour`, { dim: true }), T(k, `${def.glyph}${NB}${def.label}`, { color: def.color, bold: true }), T(k, `/${slashOf(detour.skill)}`, { dim: true })])}
        </Box>
        <Box marginLeft={1} flexShrink={0}>
          {T(k, dur(now - detour.startedAt), { dim: true })}
        </Box>
      </Box>
      <Box flexDirection="row" flexWrap="wrap">
        {steps.map((s, i) => {
          const label = def.steps.find(x => x.id === s.id)?.label ?? s.id
          const glyph = s.status === 'done' ? '✓' : s.status === 'active' ? '◉' : s.status === 'skipped' ? '–' : '○'
          return (
            <Box marginRight={1}>
              {T(k, `${glyph}${NB}${label}${i < steps.length - 1 ? `${NB}›` : ''}`, {
                color: s.status === 'active' ? def.color : s.status === 'done' ? C.green : C.gray,
                bold: s.status === 'active',
              })}
            </Box>
          )
        })}
      </Box>
      {itemsBlock(k, detour.items, def, def.color, view, act)}
    </Box>
  )
}

/** Qui porte un ticket en cours : cette discussion, une autre, ou rien de connu (avant la 0.32.0). */
const holderOf = (t: Ticket, view: View): string | null =>
  t.by === undefined ? null : t.by === view.board?.session ? 'ici' : `⇆${NB}autre discussion`

/**
 * Les tickets en cours, chacun avec son groupe et la discussion qui le porte. Un seul : la ligne
 * au-dessus des étapes, avec sa place dans la file ; plusieurs (parallèle) : un en-tête qui les
 * compte, puis une ligne par ticket.
 */
const doingBlock = (k: Kit, run: Run, view: View, color: string): unknown => {
  const { Box } = k
  const doing = doingOf(run)
  if (doing.length === 0) return null
  const queue = run.queue ?? []
  const row = ({ ticket, group, groupAt }: (typeof doing)[number], isSingle: boolean) => {
    const at = queue.indexOf(ticket.id)
    const holder = holderOf(ticket, view)
    return (
      <Box key={`doing-${ticket.id}`} flexDirection="row">
        {line(
          k,
          [
            T(k, `▸${NB}${ticket.name}`, { color, bold: true, wrap: 'truncate-end' }),
            group && T(k, `${group.id}${NB}·${NB}${shortName(group.name)}`, { color: GROUP_COLORS[groupAt % GROUP_COLORS.length], bold: true }),
            isSingle && at >= 0 && queue.length > 1 ? T(k, `ticket ${at + 1}/${queue.length}`, { dim: true }) : null,
            holder && T(k, holder, { color: holder === 'ici' ? C.gray : C.blue, dim: holder === 'ici' }),
            !isSingle && ticket.startedAt !== undefined ? T(k, dur(view.now - ticket.startedAt), { dim: true }) : null,
          ],
          true,
        )}
      </Box>
    )
  }
  if (doing.length === 1) return row(doing[0]!, true)
  return (
    <Box key="doing" flexDirection="column">
      {T(k, `◉${NB}${doing.length}${NB}tickets en cours en parallèle`, { color: C.tangerine, bold: true })}
      {doing.map(d => row(d, false))}
    </Box>
  )
}

/**
 * L'ordre des choses pendant l'Implémentation : les étapes d'un ticket, puis ce qui suit pour
 * chaque groupe une fois ses tickets commités. Une ligne fixe, sans l'étape en cours : plusieurs
 * tickets peuvent avancer en même temps (workers).
 */
const orderBlock = (k: Kit, def: SkillDef): unknown => {
  const { Box } = k
  const chain = (steps: readonly Pick<StepDef, 'label' | 'isWithPrevious'>[]) =>
    steps.map((s, i) => (i === 0 ? s.label : `${NB}${s.isWithPrevious ? '∥' : '›'}${NB}${s.label}`)).join('')
  return (
    <Box key="order" flexDirection="column" marginTop={1}>
      {T(k, `Par ticket : ${chain(def.steps)}`, { dim: true, wrap: 'wrap' })}
      {def.groupSteps && T(k, `Par groupe, ses tickets faits : ${chain(def.groupSteps)}`, { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

const phaseCard = (k: Kit, run: Run, view: View, act: Actions): unknown => {
  const { Box } = k
  const phase = currentPhase(run)
  const def = SKILLS[phase.skill]!
  const detour = activeDetour(phase)
  const color = def.color
  const cells = k.width - 6
  const elapsed = phase.startedAt !== undefined ? dur((phase.finishedAt ?? view.now) - phase.startedAt) : ''
  const t = countTickets(run.tickets)
  const showTickets = t.total > 0 && (def.hasTickets === true || t.done < t.total)
  const showTests = def.hasTests === true || (detour !== null && SKILLS[detour.skill]?.hasTests === true)
  // Implémentation : les groupes partent en parallèle ou dans des workers, le suivi ticket par
  // ticket (ticket en cours, étapes) n'a plus de sens ici ; les vagues et les groupes le disent.
  const isImplement = phase.skill === 'implement'
  return (
    <Box key="phase" flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexShrink={1}>
          {line(k, [
            T(k, `${def.glyph}${NB}${def.label}`, { color, bold: true }),
            T(k, `/${slashOf(phase.skill)}`, { dim: true }),
            phase.round > 1 && T(k, `tour${NB}${phase.round}`, { dim: true }),
            phase.status === 'done' && T(k, `✓${NB}fait`, { color: C.green, bold: true }),
          ])}
        </Box>
        {elapsed !== '' && <Box marginLeft={1} flexShrink={0}>{T(k, elapsed, { dim: true })}</Box>}
      </Box>
      {T(k, def.verb, { dim: true, wrap: 'wrap' })}
      {!isImplement && doingBlock(k, run, view, color)}
      {!isImplement && stepsList(k, phase.steps, def, color, view.now)}
      {phase.skill === 'implement' && orderBlock(k, def)}
      {waitCallout(k, run, view)}
      {syncCallout(k, run, view, act)}
      {reportGate(k, phase, act)}
      {decidedBlock(k, run, view, act)}
      {statsRow(k, run, def)}
      {itemsBlock(k, phase.items, def, color, view, act, def.items?.linkedStep !== undefined && detour === null ? { phase, view, act } : undefined)}
      {showTickets && ticketsBlock(k, run, view, act, cells)}
      {foundBlock(k, run, view, act)}
      {showTests && testsBlock(k, run, cells)}
      {reviewBlock(k, run)}
      {(run.groups ?? []).length === 0 && lotSecurityRow(k, run, act, view.security ?? 'unread')}
      {detour !== null && detourCard(k, detour, view, act)}
    </Box>
  )
}

// ─── Spécialistes ──────────────────────────────────────────────────────────

/** Ce que dit l'état d'un spécialiste, et sa couleur. */
const AGENT_STATE: Record<AgentStatus, { word: string; color: string }> = {
  running: { word: `au${NB}travail`, color: C.blue },
  done: { word: 'fini', color: C.green },
  failed: { word: 'échoué', color: C.red },
  cancelled: { word: 'annulé', color: C.gray },
}

/** Les spécialistes de la session au travail : l'onglet, le bandeau et la pastille d'état les comptent. */
const agentsAtWork = (view: View): number => runningOf(view.agents ?? null).length

/** La couleur de la piste du manager ; celle d'un spécialiste est celle de son type (AGENT_TYPE). */
const ORCHESTRATOR_COLOR = C.violet

/** Le glyphe d'une famille d'outils dans le SVG ; le terminal a les siens (cells.ts). */
const FAMILY_GLYPH: Record<ToolFamily, string> = { read: '⌕', edit: '✎', run: '❯', web: '🌐', agent: '⇢', other: '•' }

/** Le nom de chaque sorte de segment, le même dans la légende et le texte `alt` des pistes. */
const SEGMENT_WORD: Record<SegmentKind, string> = {
  think: 'réflexion',
  write: 'rédaction',
  tool: 'outil',
  waitAgent: 'attend un spécialiste',
  waitPerson: 'attend ta réponse',
  waitBg: 'attend une tâche de fond',
  waitAdvisor: 'consulte l’advisor',
}

/** La pause compressée, dans la légende : une coupure du rail, pas une attente. */
const PAUSE_WORD = 'pause : personne ne travaillait'

/**
 * Le texte `alt` d'une piste : ce qui s'y voit, dans l'ordre, sans répétition côte à côte ; une
 * pause compressée y est nommée avec sa durée, après l'attente qu'elle écrase.
 */
const laneAlt = (name: string, parts: readonly LanePart[], pauses: readonly AxisPiece[] = []): string => {
  const items = [
    ...parts.map(p => ({ x: p.x0, rank: 0, word: p.kind === 'tool' && p.family !== undefined ? `${SEGMENT_WORD.tool} ${FAMILY_GLYPH[p.family]}` : SEGMENT_WORD[p.kind] })),
    ...pauses.map(p => ({ x: p.x0, rank: 1, word: `pause de ${dur(p.pause ?? 0)}` })),
  ].sort((a, b) => a.x - b.x || a.rank - b.rank)
  const words: string[] = []
  for (const { word } of items) {
    if (words[words.length - 1] !== word) words.push(word)
  }
  return `${name} : ${words.length > 0 ? words.slice(0, 12).join(', ') + (words.length > 12 ? '…' : '') : 'rien sur cette période'}`
}

/** Une piste de la frise, prête à dessiner. */
type FriseLane = {
  key: string
  name: string
  color: string
  lane: AgentLane
  agent?: RegistryAgent
  /** Le retrait sous le parent (Q13). */
  depth?: number
  /** La piste d'un Workflow : ses agents réunis, et si elle est dépliée. */
  workflow?: { id: string; count: number; running: number; isOpen: boolean }
  /** La piste d'un worker, dans la frise du manager : son bouton ouvre sa frise. */
  linked?: LinkedSession
  /** Sous le nom d'une piste sans spécialiste : « cette discussion » par défaut. */
  caption?: string
  /** La ligne advisor : ses appels, ses barres cerclées, sa carte. */
  advisor?: AdvisorLane
}

/** La ligne advisor, à part des agents : or, ✦, « advisor · relecteur ». */
const ADVISOR_COLOR = C.gold
const ADVISOR_NAME = `advisor${NB}·${NB}relecteur`

/**
 * La piste repliée d'un Workflow : l'union des périodes où au moins un de ses agents travaille
 * (ses agents tournent en parallèle : leurs segments ne se suivent pas), ouverte tant que l'un
 * d'eux travaille ; et les repères de ses agents, leurs échecs et interruptions compris.
 */
const workflowLane = (members: readonly RegistryAgent[], now: number): AgentLane => {
  const segs = members.flatMap(m => m.segments ?? []).filter(s => WORKING_KINDS.has(s.k))
  const open = segs.filter(s => s.e === undefined)
  const union = unionOf(segs.map(s => ({ s: s.s, e: s.e ?? now })))
  return {
    segments: union.map(i => (open.some(s => s.s >= i.s && s.s <= i.e) ? { k: 'write' as const, s: i.s } : { k: 'write' as const, s: i.s, e: i.e })),
    marks: members.flatMap(m => [...(m.marks ?? []), ...ownMarks(m).filter(mark => mark.k === 'fail' || mark.k === 'stop')]),
  }
}

/**
 * La piste dessinée : SVG sur les surfaces riches, grille de cases (`Raster`) au terminal quand
 * il l'a, sinon des barres en blocs. Les glyphes d'outil ne vont au terminal que si la piste a la place.
 */
const laneTrack = (k: Kit, l: FriseLane, axis: Axis, cells: number, now: number): unknown => {
  const parts = laneParts(l.lane, axis, now)
  const marks = laneMarks(l.agent ? { ...l.lane, marks: [...(l.lane.marks ?? []), ...ownMarks(l.agent)] } : l.lane, axis)
  const pauses = axis.pieces.filter(p => p.pause !== undefined)
  const cuts = pauses.map(p => ({ x0: p.x0, x1: p.x1, label: dur(p.pause ?? 0) }))
  if (k.isRich) {
    const drawn = laneSvg(
      parts.map(p => ({ x0: p.x0, x1: p.x1, kind: p.kind, ...(p.kind === 'tool' && p.family !== undefined ? { glyph: FAMILY_GLYPH[p.family] } : {}), ...(p.isLive ? { isLive: true } : {}), ...(p.isError ? { isError: true } : {}) })),
      marks.map(m => {
        const look = markLook(m, l.color)
        return { x: m.x, glyph: look.glyph, color: look.color, ...(m.k === 'relay' || m.k === 'back' ? { isRelay: true, isStart: m.k === 'relay' } : {}) }
      }),
      cuts,
      px(cells),
      l.color,
      `lane-${l.key}`,
      l.advisor !== undefined,
    )
    // La ligne advisor : les appels que montre la fenêtre (une part chacun).
    const alt = l.advisor ? `${l.name} : ${plural(parts.length, 'appel')}${pauses.length > 0 ? `, ${plural(pauses.length, 'pause')}` : ''}` : laneAlt(l.name, parts, pauses)
    return svgOf(k, drawn, alt, parts.some(p => p.isLive === true))
  }
  const row = laneCells(parts, marks, cuts, cells, l.color, cells >= 40, l.advisor !== undefined)
  if (k.Raster) return h(k.Raster, { key: `cells-${l.key}`, columns: cells, rows: 1, cells: laneRaster(row).cells })
  // Sans grille : des Text par suite de cases de même allure.
  const runs: { text: string; cell: LaneCell }[] = []
  for (const c of row) {
    const last = runs[runs.length - 1]
    if (last && last.cell.color === c.color && last.cell.alpha === c.alpha && last.cell.bg === c.bg) last.text += c.glyph
    else runs.push({ text: c.glyph, cell: c })
  }
  return <k.Box flexDirection="row">{runs.map(r => T(k, r.text, { color: textColorOf(r.cell), ...(r.cell.bg !== '' ? { bg: r.cell.bg } : {}) }))}</k.Box>
}

/**
 * Les 9 types de spécialistes (Q9) : libellé, glyphe et couleur, distincte et lisible en thème clair
 * comme sombre. P1 : rose à la place du corail (proche de la mandarine et du rouge des échecs) ;
 * B1 : vert anis pour les transcripts, à la place du ciel (proche du cyan) puis du bleu (celui des
 * hachures « attente d'une tâche de fond ») ; planches de la carte et des teintes validées par Mathis, dans le dépôt privé.
 */
const AGENT_TYPE: Record<AgentType, { label: string; glyph: string; color: string }> = {
  explore: { label: 'Exploration du code', glyph: '⌕', color: C.cyan },
  research: { label: 'Recherche web/doc', glyph: '🌐', color: C.indigo },
  implement: { label: 'Implémentation', glyph: '✎', color: C.tangerine },
  review: { label: 'Relecture de code', glyph: '◇', color: C.magenta },
  security: { label: 'Revue de sécurité', glyph: '⛨', color: C.pink },
  merge: { label: 'Fusion', glyph: '⤞', color: C.teal },
  plan: { label: 'Plan/Design', glyph: '▤', color: C.sand },
  transcripts: { label: 'Lecture de transcripts', glyph: '↺', color: C.anise },
  other: { label: 'Autre', glyph: '●', color: C.slate },
}

const FAMILY_WORD: Record<ToolFamily, string> = { read: 'lecture', edit: 'modification', run: 'commande', web: 'web', agent: 'spécialistes', other: 'autres outils' }

/** Une durée courte, au dixième de seconde sous 10 s. */
const durShort = (ms: number): string => (ms < 10_000 ? `${(Math.max(0, ms) / 1000).toFixed(1).replace('.', ',')}${NB}s` : dur(ms))

/** Un nombre de tokens : 820, 12,3 k, 1,2 M. */
const tokensText = (n: number): string =>
  n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(1).replace('.', ',').replace(/,0$/, '')}${NB}k` : `${(n / 1_000_000).toFixed(1).replace('.', ',').replace(/,0$/, '')}${NB}M`

/** L'heure d'un instant, au format local. */
const clockText = (ms: number): string => new Date(ms).toTimeString().slice(0, 8)

/**
 * Le coût estimé d'une piste : ses tokens aux prix de son modèle (le premier qui a répondu, sinon
 * celui de l'appel) ; null sans tokens ou sans prix.
 */
const agentCost = (lane: AgentLane, a: RegistryAgent | undefined, view: View): number | null =>
  costOf(lane.tokens, pricesFor(view.agentPrices ?? {}, lane.models?.[0] ?? a?.model))

/** Les appels d'une famille gardés dans la carte : les plus récents, les autres comptés. */
const CALLS_SHOWN = 8

/** Une ligne « intitulé : valeur » de la carte. */
const cardLine = (k: Kit, label: string, value: unknown): unknown =>
  line(k, [T(k, `${label}${NB}:`, { color: C.slate, bold: true }), typeof value === 'string' ? T(k, value, { wrap: 'wrap' }) : value])

/** Les appels gardés dans la carte de la ligne advisor : les plus récents, les autres comptés. */
const ADVISOR_CALLS_SHOWN = 12

/** Le coût d'appels à l'advisor : « ≈ x $ », ou « coût inconnu » dès qu'un appel relu n'a pas de prix. */
const advisorCostText = (sum: ReturnType<typeof advisorCostOf>): string => (sum.cost !== null && !sum.isUnknown ? costText(sum.cost) : 'coût inconnu')

/**
 * Sur la carte d'un agent qui a consulté l'advisor : « 2 appels, ≈ 0,42 $ », hors de son propre
 * coût et de la somme avec ses spécialistes ; null quand il ne l'a pas consulté.
 */
const advisorOfCaller = (calls: readonly AdvisorCall[], by: string, view: View): string | null => {
  const own = calls.filter(c => c.by === by)
  if (own.length === 0) return null
  const sum = advisorCostOf(own, view.agentPrices ?? {})
  return sum.tokens || sum.isUnknown ? `${plural(own.length, 'appel')}, ${advisorCostText(sum)}` : plural(own.length, 'appel')
}

/**
 * La carte de la ligne advisor : le nombre d'appels, puis chacun avec son heure, sa durée et qui
 * l'a fait : le manager de la frise, ou le spécialiste nommé, cherché parmi tous les
 * spécialistes de la session (ceux d'un Workflow replié n'ont pas de piste).
 */
const advisorCard = (k: Kit, l: FriseLane, lanes: readonly FriseLane[], agents: readonly RegistryAgent[], view: View): unknown => {
  const { Box } = k
  const advisor = l.advisor!
  const callerOf = (by: string): string => (by === MAIN ? (lanes[0]?.name ?? 'Manager') : (lanes.find(x => x.agent?.agentId === by)?.name ?? agents.find(a => a.agentId === by)?.name ?? by))
  const shown = advisor.calls.slice(-ADVISOR_CALLS_SHOWN)
  const sum = advisorCostOf(advisor.calls, view.agentPrices ?? {})
  const t = sum.tokens
  return (
    <Box key={`card-${l.key}`} flexDirection="column" borderStyle="round" borderColor={l.color} paddingX={1} marginBottom={1}>
      {line(k, [T(k, `✦${NB}${ADVISOR_NAME}`, { color: l.color, bold: true }), T(k, 'un modèle relecteur consulté par la discussion et ses spécialistes', { dim: true, wrap: 'truncate-end' })], true)}
      {sum.models.length > 0 && cardLine(k, 'Modèles', sum.models.map(shortModel).join(' · '))}
      {cardLine(k, 'Appels', `${plural(advisor.calls.length, 'appel')}${advisor.calls.length > shown.length ? ` · les ${shown.length} derniers` : ''}`)}
      {(t || sum.isUnknown) && cardLine(k, 'Coût', advisorCostText(sum))}
      {t && cardLine(k, 'Tokens', `entrée ${tokensText(t.input)} · sortie ${tokensText(t.output)} · cache lu ${tokensText(t.cacheRead)} · cache écrit ${tokensText(t.cacheWrite)}`)}
      {sum.unread > 0 && T(k, `${plural(sum.unread, 'appel')} pas encore relu${sum.unread > 1 ? 's' : ''} dans le transcript : modèle, tokens et coût au prochain rattrapage`, { dim: true, wrap: 'wrap' })}
      <Box flexDirection="column" marginLeft={2}>
        {shown.map(c =>
          line(k, [T(k, clockText(c.s), { dim: true }), T(k, c.e !== undefined ? durShort(c.e - c.s) : 'sans fin connue', { dim: true }), T(k, callerOf(c.by), { wrap: 'truncate-end' })]),
        )}
      </Box>
    </Box>
  )
}

/**
 * La carte de détail d'une piste, ouverte par son bouton : type, modèles, effort, parent, début et
 * fin ; tokens par sorte ; appels d'outils par famille, avec argument, durée et erreur ; lignes
 * ajoutées et retirées ; prompt (déplié à la demande) ; « ↗ Ouvrir la transcription » pour un
 * spécialiste de cette discussion.
 */
const agentCard = (k: Kit, l: FriseLane, lanes: readonly FriseLane[], view: View, act: Actions, isOwn = true): unknown => {
  const { Box, Button } = k
  const a = l.agent
  const now = view.now
  const type = a ? AGENT_TYPE[a.type ?? 'other'] : null
  const lane = l.lane
  const tools = (lane.segments ?? []).filter(s => (s.k === 'tool' || s.k === 'waitAgent') && s.t !== undefined)
  const families = (Object.keys(FAMILY_WORD) as ToolFamily[]).map(f => ({ f, calls: tools.filter(s => (s.f ?? 'other') === f) })).filter(g => g.calls.length > 0)
  const t = lane.tokens
  // Lancé par son parent, sinon par la session de la frise (le manager, ou le worker choisi).
  const parent = a?.parent !== undefined ? lanes.find(x => x.agent?.agentId === a.parent)?.name ?? a.parent : (lanes[0]?.name ?? 'Manager')
  const models = [...new Set([...(a?.model !== undefined ? [a.model] : []), ...(lane.models ?? [])].map(shortModel))]
  const prompt = a?.prompt ?? ''
  const promptLines = prompt.split('\n')
  const isPromptOpen = view.ui.isPromptOpen === true
  // Un spécialiste qui en a lancé d'autres : son coût et ses tokens avec ceux de ses descendants.
  const agents = lanes.map(x => x.agent).filter((x): x is RegistryAgent => x !== undefined)
  const sum = a ? familyOf(a, agents, m => agentCost(m, m, view)) : null
  const family = sum && sum.descendants > 0 ? sum : null
  // Ses appels à l'advisor, chiffrés à part : jamais dans son coût ni dans celui de sa famille.
  const caller = a?.agentId ?? (l.key === MAIN ? MAIN : undefined)
  const advisorCalls = lanes.find(x => x.advisor)?.advisor?.calls ?? []
  const advised = caller !== undefined ? advisorOfCaller(advisorCalls, caller, view) : null
  return (
    <Box key={`card-${l.key}`} flexDirection="column" borderStyle="round" borderColor={l.color} paddingX={1} marginBottom={1}>
      {line(k, [type ? T(k, `${type.glyph}${NB}${type.label}`, { color: type.color, bold: true }) : T(k, l.caption !== undefined ? `↗${NB}Worker` : `◆${NB}Manager`, { color: l.color, bold: true }), T(k, l.name, { bold: true, wrap: 'truncate-end' })], true)}
      {models.length > 0 && cardLine(k, 'Modèles', models.join(' · '))}
      {lane.effort !== undefined && cardLine(k, 'Effort', lane.effort)}
      {a && l.name !== a.name && cardLine(k, 'Commande', a.name)}
      {a && cardLine(k, 'Lancé par', parent)}
      {a && cardLine(k, 'Période', `${clockText(a.startedAt)}${a.finishedAt !== undefined ? ` → ${clockText(a.finishedAt)}` : ' → en cours'}${a.isEndUnseen === true ? ' (fin constatée après coup)' : ` · ${dur((a.finishedAt ?? now) - a.startedAt)}`}`)}
      {t && cardLine(k, 'Coût', agentCost(l.lane, a, view) !== null ? costText(agentCost(l.lane, a, view)!) : 'coût indisponible')}
      {t && cardLine(k, 'Tokens', `entrée ${tokensText(t.input)} · sortie ${tokensText(t.output)} · cache lu ${tokensText(t.cacheRead)} · cache écrit ${tokensText(t.cacheWrite)} · réflexion non comptée à part`)}
      {advised !== null && cardLine(k, `✦${NB}Advisor`, advised)}
      {family && cardLine(k, 'Avec ses spécialistes', `${family.cost !== null ? costText(family.cost) : 'coût indisponible'} · ${plural(family.descendants, 'spécialiste')}${family.tokens ? ` · entrée ${tokensText(family.tokens.input)} · sortie ${tokensText(family.tokens.output)} · cache lu ${tokensText(family.tokens.cacheRead)} · cache écrit ${tokensText(family.tokens.cacheWrite)}` : ''}`)}
      {lane.lines && cardLine(k, 'Lignes', line(k, [T(k, `+${lane.lines.added}`, { color: C.green, bold: true }), T(k, `−${lane.lines.removed}`, { color: C.red, bold: true })]))}
      {families.length > 0 && (
        <Box flexDirection="column">
          {T(k, `Outils${NB}:`, { color: C.slate, bold: true })}
          {families.map(g => {
            const count = g.calls.reduce((n, s) => n + (s.n ?? 1), 0)
            const shown = g.calls.slice(-CALLS_SHOWN)
            return (
              <Box key={`card-${l.key}-${g.f}`} flexDirection="column" marginLeft={2}>
                {T(k, `${FAMILY_GLYPH[g.f]}${NB}${FAMILY_WORD[g.f]}${NB}(${count})${g.calls.length > shown.length ? `${NB}·${NB}les${NB}${shown.length}${NB}derniers` : ''}`, { bold: true })}
                {shown.map(s =>
                  line(k, [
                    T(k, s.a ?? s.t ?? '', { dim: s.x !== true, wrap: 'truncate-end' }),
                    T(k, s.e !== undefined ? durShort(s.e - s.s) : 'en cours', { dim: true }),
                    (s.n ?? 1) > 1 && T(k, `×${s.n}`, { dim: true }),
                    s.x === true && T(k, 'erreur', { color: C.red }),
                  ]),
                )}
              </Box>
            )
          })}
        </Box>
      )}
      {prompt !== '' && (
        <Box flexDirection="column">
          {T(k, `Prompt${NB}:`, { color: C.slate, bold: true })}
          <Box marginLeft={2}>{T(k, isPromptOpen ? prompt : `${promptLines.slice(0, 3).join('\n')}${promptLines.length > 3 || prompt.length > 300 ? ' …' : ''}`.slice(0, isPromptOpen ? undefined : 300), { wrap: 'wrap' })}</Box>
          {(promptLines.length > 3 || prompt.length > 300) && (
            <Button key={`prompt-${l.key}`} plain={true} dimColor={true} label={isPromptOpen ? '▾ réduire le prompt' : '▸ tout le prompt'} onPress={() => act.togglePrompt()} />
          )}
        </Box>
      )}
      {a?.agentId !== undefined && isOwn && (
        <Box marginTop={1}>
          <Button key={`transcript-${l.key}`} label={`↗${NB}Ouvrir${NB}la${NB}transcription`} onPress={() => act.openAgentTranscript(a.agentId!)} />
        </Box>
      )}
    </Box>
  )
}


/**
 * L'effort demandé aux requêtes d'un worker ou d'un spécialiste, sous son nom (jamais pour
 * le manager) ; rien quand il n'est pas relevé.
 */
const effortText = (k: Kit, effort: string | undefined): unknown => (effort !== undefined && effort !== '' ? T(k, effort, { color: C.lilac }) : null)

/** Une rangée de la frise : à gauche le bouton (nom) et l'état, à droite la piste. */
const laneRow = (k: Kit, l: FriseLane, axis: Axis, view: View, act: Actions, labelCells: number, trackCells: number): unknown => {
  const { Box, Button } = k
  const a = l.agent
  const now = view.now
  const state = a ? AGENT_STATE[a.status] : null
  // Le glyphe de son type (Q9) ; l'état se dit à côté, en mots et en couleur.
  const glyph = a ? AGENT_TYPE[a.type ?? 'other'].glyph : '◆'
  const indent = Math.min(6, l.depth ?? 0) * 2
  const wf = l.workflow
  const ls = l.linked
  if (l.advisor) {
    return (
      <Box key={`lane-row-${l.key}`} flexDirection="row" alignItems="center">
        <Box width={labelCells} flexShrink={0} flexDirection="column" marginRight={1} paddingLeft={indent}>
          <Button key={`lane-${l.key}`} plain={true} label={`✦${NB}${l.name}`} onPress={() => act.toggleAgentCard(l.key)} />
          {T(k, plural(l.advisor.calls.length, 'appel'), { color: l.color, dim: true })}
        </Box>
        <Box flexShrink={1}>{laneTrack(k, l, axis, trackCells, now)}</Box>
      </Box>
    )
  }
  if (ls) {
    const look = LINKED_STATE[ls.state]
    return (
      <Box key={`lane-row-${l.key}`} flexDirection="row" alignItems="center">
        <Box width={labelCells} flexShrink={0} flexDirection="column" marginRight={1} paddingLeft={indent}>
          <Button key={`lane-${l.key}`} plain={true} label={`↗${NB}${l.name}`} onPress={() => act.selectAgentsSession(ls.key)} />
          {line(k, [T(k, look.word, { color: look.color, dim: ls.state === 'closed' }), T(k, `worker`, { dim: true }), effortText(k, l.lane.effort)], true)}
        </Box>
        <Box flexShrink={1}>{laneTrack(k, l, axis, trackCells, now)}</Box>
      </Box>
    )
  }
  if (wf) {
    return (
      <Box key={`lane-row-${l.key}`} flexDirection="row" alignItems="center">
        <Box width={labelCells} flexShrink={0} flexDirection="column" marginRight={1} paddingLeft={indent}>
          <Button key={`workflow-${wf.id}`} plain={true} label={`${wf.isOpen ? '▾' : '▸'}${NB}${l.name}`} onPress={() => act.toggleWorkflow(wf.id)} />
          {T(k, wf.running > 0 ? `${wf.running}${NB}au${NB}travail` : `au${NB}repos`, { color: wf.running > 0 ? C.blue : C.gray, dim: wf.running === 0 })}
        </Box>
        <Box flexShrink={1}>{laneTrack(k, l, axis, trackCells, now)}</Box>
      </Box>
    )
  }
  return (
    <Box key={`lane-row-${l.key}`} flexDirection="row" alignItems="center">
      <Box width={labelCells} flexShrink={0} flexDirection="column" marginRight={1} paddingLeft={indent}>
        <Button key={`lane-${l.key}`} plain={true} label={`${glyph}${NB}${l.name}`} onPress={() => act.toggleAgentCard(l.key)} />
        {a && state
          ? line(
              k,
              [
                a.model !== undefined && chip(k, shortModel(a.model), C.lilac),
                effortText(k, a.effort),
                T(k, state.word, { color: state.color, dim: a.status === 'done' }),
                a.isEndUnseen !== true && T(k, dur((a.finishedAt ?? now) - a.startedAt), { dim: true }),
              ],
              true,
            )
          : l.caption !== undefined
            ? line(k, [T(k, l.caption, { dim: true }), effortText(k, l.lane.effort)], true)
            : T(k, `cette${NB}discussion`, { dim: true })}
      </Box>
      <Box flexShrink={1}>{laneTrack(k, l, axis, trackCells, now)}</Box>
    </Box>
  )
}

/**
 * La barre de navigation de la frise, au-dessus des pistes : zoom arrière et avant, déplacement
 * d'une demi-fenêtre, « dernière heure » et « tout » ; chaque bouton affiche sa lettre de raccourci,
 * active quand le volet a le focus. À droite, ce que montre la fenêtre : « maintenant » pour sa fin
 * seulement quand elle suit une frise en direct (`isLiveNow`), sinon l'heure.
 */
const navBar = (k: Kit, full: Axis, shown: Axis, isLiveNow: boolean, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const win = view.ui.agentsWindow ?? null
  const set = (next: AgentsWindow | null) => () => act.setAgentsWindow(next)
  const lastHour: AgentsWindow | null = full.end - full.start > HOUR_MS ? { start: full.end - HOUR_MS, end: full.end, isLive: true } : null
  const buttons: [string, string, string | null, () => unknown][] = [
    ['agents-zoom-out', `−${NB}s`, 's', set(zoomWindow(full, win, 'out'))],
    ['agents-zoom-in', `＋${NB}z`, 'z', set(zoomWindow(full, win, 'in'))],
    ['agents-left', `◀${NB}q`, 'q', set(zoomWindow(full, win, 'left'))],
    ['agents-right', `▶${NB}d`, 'd', set(zoomWindow(full, win, 'right'))],
    ['agents-hour', `dernière${NB}heure`, null, set(lastHour)],
    ['agents-all', `tout${NB}t`, 't', set(null)],
  ]
  const where = win === null ? 'tout' : `${clockText(shown.start).slice(0, 5)}${NB}→${NB}${win.isLive && isLiveNow ? 'maintenant' : clockText(shown.end).slice(0, 5)}`
  return (
    <Box key="agents-nav" flexDirection="row" flexWrap="wrap" alignItems="center">
      {buttons.map(([key, label, hotkey, onPress]) => (
        <Box key={`${key}-box`} marginRight={1}>
          <Button key={key} label={label} {...(hotkey !== null ? { hotkey } : {})} onPress={onPress} />
        </Box>
      ))}
      {T(k, where, { dim: true })}
    </Box>
  )
}

/** La règle graduée, alignée sur les pistes : SVG sur les surfaces riches, caractères au terminal. */
const rulerRow = (k: Kit, axis: Axis, labelCells: number, trackCells: number): unknown => {
  const { Box } = k
  const pauses = axis.pieces.filter(p => p.pause !== undefined)
  const { ticks } = rulerTicks(axis, k.isRich ? Math.max(2, Math.floor(px(trackCells) / 70)) : Math.max(2, Math.floor(trackCells / 8)))
  const alt = `règle graduée : ${ticks.map(t => t.label).join(', ') || 'aucune graduation'}`
  return (
    <Box key="agents-ruler" flexDirection="row" alignItems="center">
      <Box width={labelCells} flexShrink={0} marginRight={1}>
        {T(k, 'heure', { dim: true })}
      </Box>
      <Box flexShrink={1}>{k.isRich ? svgOf(k, rulerSvg(ticks, pauses, px(trackCells)), alt, false) : T(k, rulerCells(ticks, pauses, trackCells), { dim: true, wrap: 'truncate-end' })}</Box>
    </Box>
  )
}

/** « 3 agents · 1 au travail », ou « … · au repos ». */
const agentsSummary = (agents: readonly RegistryAgent[]): string => {
  const running = runningOf({ agents } as SessionRegistry).length
  return `${plural(agents.length, 'agent')}${NB}·${NB}${running > 0 ? `${running}${NB}au${NB}travail` : `au${NB}repos`}`
}

/** Le gain par rapport à une exécution en série, quand il y en a un. */
const gainText = (gain: number | null): string =>
  gain !== null && gain >= 1.05 ? `${gain.toFixed(1).replace('.', ',')}×${NB}plus${NB}rapide${NB}qu’en${NB}série` : ''

/** Dans l'onglet Mission, une ligne de résumé à la place de l'ancien encadré : elle mène à l'onglet Agents. */
const agentsLine = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const agents = view.agents?.agents ?? []
  if (agents.length === 0) return null
  const running = agentsAtWork(view)
  const text = running > 0 ? `◉${NB}${plural(running, 'agent')}${NB}au${NB}travail` : `○${NB}${agentsSummary(agents)}`
  return (
    <Box key="agents" flexDirection="row" alignItems="center" marginTop={1}>
      <Box marginRight={1}>{T(k, text, { color: running > 0 ? C.blue : C.gray, bold: running > 0 })}</Box>
      <Button key="agents-open" plain={true} dimColor={true} label={`▸${NB}Agents`} onPress={() => act.setTab('agents')} />
    </Box>
  )
}

/** Les glyphes des familles d'outils sur cette surface : ceux du SVG, ou ceux des cases du terminal. */
export const familyGlyphs = (k: Kit): Record<ToolFamily, string> => (k.isRich ? FAMILY_GLYPH : FAMILY_CELL)

/**
 * Le glyphe d'un départ et d'un retour sur cette surface : des points sur le rail en SVG, les
 * flèches de `markLook` au terminal.
 */
export const relayGlyphs = (k: Kit): [string, string] =>
  k.isRich ? ['●', '○'] : [markLook({ k: 'relay', at: 0 }, C.blue).glyph, markLook({ k: 'back', at: 0 }, C.blue).glyph]

/** Une entrée de légende : son glyphe dans sa couleur, puis son mot. */
const legendItem = (k: Kit, glyph: string, word: string, color: string) => line(k, [T(k, glyph, { color, bold: true }), T(k, word, { dim: true })])

/**
 * La légende : chaque entrée dans sa couleur, les attentes hachurées et nommées par ce qu'elles
 * attendent, la pause en coupure du rail. Une ligne quand la largeur le permet ; sur un panneau
 * étroit, elle passe à la ligne plutôt que de perdre ses dernières entrées. Écarts insécables (le
 * desktop fond les espaces ordinaires).
 */
const legendRow = (k: Kit): unknown =>
  line(
    k,
    [
      legendItem(k, '▒', 'réflexion', C.blue),
      legendItem(k, '█', 'rédaction', C.blue),
      legendItem(k, (['read', 'edit', 'run', 'web', 'agent'] as const).map(f => familyGlyphs(k)[f]).join(''), 'outils', C.blue),
      ...WAIT_KINDS.map(w => legendItem(k, WAIT_GLYPH[w], SEGMENT_WORD[w], WAIT_COLOR[w])),
      legendItem(k, '✗', 'échec', C.red),
      legendItem(k, '⊘', 'interrompu', C.gray),
      legendItem(k, relayGlyphs(k).join(''), 'départ/retour', C.blue),
      legendItem(k, '⇣', 'compaction', C.slate),
      legendItem(k, `✉⎇✓`, 'message/commit/tests', C.green),
      legendItem(k, '┊', PAUSE_WORD, C.gray),
    ],
    true,
  )

/** Les attentes, dans l'ordre de la légende. */
const WAIT_KINDS = ['waitAgent', 'waitPerson', 'waitBg', 'waitAdvisor'] as const

/** Les repères, dans la légende détaillée : le repère (dessiné par `markLook`) et ce qu'il marque. */
const MARK_LEGEND: readonly { mark: AgentMark; word: string }[] = [
  { mark: { k: 'fail', at: 0 }, word: 'échec d’un outil ou d’un spécialiste' },
  { mark: { k: 'stop', at: 0 }, word: 'interrompu ou annulé' },
  { mark: { k: 'relay', at: 0 }, word: 'départ d’un spécialiste ou d’un worker (relais)' },
  { mark: { k: 'back', at: 0 }, word: 'retour de son rapport' },
  { mark: { k: 'compact', at: 0 }, word: 'compaction du contexte' },
  { mark: { k: 'msg', at: 0 }, word: 'message d’une autre session (manager)' },
  { mark: { k: 'commit', at: 0 }, word: 'commit (manager)' },
  { mark: { k: 'test', at: 0, ok: true }, word: 'tests au vert (manager)' },
  { mark: { k: 'test', at: 0, ok: false }, word: 'tests en échec (manager)' },
]

/**
 * La légende détaillée, repliée par défaut : chaque famille d'outils avec ses outils (la table du
 * classement des outils elle-même), les segments et les attentes, la pause, chaque type d'agent,
 * chaque repère. Une section de plus s'y ajoute en une entrée de `sections`.
 */
const legendDetail = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const isOpen = view.ui.isLegendOpen === true
  const sections: { title: string; items: unknown[] }[] = [
    {
      title: 'Segments',
      items: [
        legendItem(k, '▒', 'réflexion : le modèle réfléchit', C.blue),
        legendItem(k, '█', 'rédaction : le modèle écrit sa réponse', C.blue),
        ...WAIT_KINDS.map(w => legendItem(k, WAIT_GLYPH[w], `${SEGMENT_WORD[w]} : barre ${w === 'waitAdvisor' ? 'pointillée' : 'hachurée'}, l’agent ne travaille pas lui-même`, WAIT_COLOR[w])),
        legendItem(k, '┊', `${PAUSE_WORD} : le rail est coupé, la durée entre les traits`, C.gray),
      ],
    },
    {
      title: 'Outils',
      items: (Object.keys(FAMILY_WORD) as ToolFamily[]).map(f =>
        legendItem(k, familyGlyphs(k)[f], f === 'other' ? `${FAMILY_WORD[f]} : tout autre outil (MCP, skills…)` : `${FAMILY_WORD[f]} : ${TOOL_FAMILIES[f].join(', ')}`, C.blue),
      ),
    },
    {
      title: 'Agents',
      items: [
        legendItem(k, '◆', 'Manager', ORCHESTRATOR_COLOR),
        legendItem(k, '✦', `${ADVISOR_NAME} : le modèle relecteur que la discussion et ses spécialistes consultent ; une barre cerclée par appel, vue à la fin de l’étape qui l’a fait`, ADVISOR_COLOR),
        legendItem(k, '↗', 'Worker', LINKED_COLOR),
        ...Object.values(AGENT_TYPE).map(t => legendItem(k, t.glyph, t.label, t.color)),
      ],
    },
    {
      title: 'Repères',
      items: MARK_LEGEND.map(({ mark, word }) => {
        // Départ et retour : des points en SVG, des flèches au terminal ; les autres, ceux de markLook.
        const look = markLook(mark, C.blue)
        const glyph = mark.k === 'relay' ? relayGlyphs(k)[0] : mark.k === 'back' ? relayGlyphs(k)[1] : look.glyph
        return legendItem(k, glyph, word, look.color)
      }),
    },
  ]
  return (
    <Box key="agents-legend-box" flexDirection="column">
      <Button key="agents-legend" plain={true} dimColor={true} label={`${isOpen ? '▾' : '▸'}${NB}légende${NB}détaillée`} onPress={() => act.toggleLegend()} />
      {isOpen &&
        sections.map(sec => (
          <Box key={`legend-${sec.title}`} flexDirection="column" marginTop={1}>
            {T(k, sec.title, { color: C.slate, bold: true })}
            {sec.items.map(item => (
              <Box marginLeft={2}>{item}</Box>
            ))}
          </Box>
        ))}
    </Box>
  )
}

/**
 * Les repères que la piste d'un spécialiste porte d'elle-même : son départ et son retour (les
 * points du relais, en face de ceux du lanceur), son échec ou son annulation à sa fin.
 */
const ownMarks = (a: RegistryAgent): AgentMark[] => {
  const marks: AgentMark[] = [{ k: 'relay', at: a.startedAt }]
  if (a.finishedAt === undefined || a.isEndUnseen === true || a.status === 'running') return marks
  return [...marks, { k: a.status === 'failed' ? 'fail' : a.status === 'cancelled' ? 'stop' : 'back', at: a.finishedAt }]
}

/** L'état d'un worker (pastille, piste) : glyphe, mot, couleur. */
const LINKED_STATE: Record<LinkedState, { glyph: string; word: string; color: string }> = {
  working: { glyph: '◉', word: `au${NB}travail`, color: C.blue },
  returned: { glyph: '✓', word: 'rendue', color: C.green },
  failed: { glyph: '✗', word: 'échouée', color: C.red },
  closed: { glyph: '○', word: 'fermée', color: C.gray },
}

/** La couleur des pistes des workers dans la frise du manager : mauve, loin du violet du manager (planche `teintes.*`). */
const LINKED_COLOR = C.mauve

/**
 * Un worker qui ne travaille plus ne s'allonge plus : ses segments restés ouverts (session
 * arrêtée en plein outil) se ferment à son retour, sinon à sa dernière écriture.
 */
const settledLane = (lane: AgentLane, ls: LinkedSession, reg: SessionRegistry | null): AgentLane => {
  const end = ls.returnedAt ?? reg?.updatedAt
  if (ls.state === 'working' || end === undefined || !(lane.segments ?? []).some(x => x.e === undefined)) return lane
  return { ...lane, segments: (lane.segments ?? []).map(x => (x.e === undefined ? { ...x, e: Math.max(x.s, end) } : x)) }
}

/**
 * Le sélecteur d'historique en tête de l'onglet (Q12) : un bouton dit l'entrée montrée ; déplié, il
 * liste « Ici, maintenant », les missions (archivées comprises), puis les discussions sans mission qui
 * ont lancé des agents, les plus récentes d'abord.
 */
const historySelector = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const entries = view.history?.entries ?? []
  const current = entries.find(e => e.key === (view.ui.agentsHistory ?? 'now'))
  const isOpen = view.ui.isAgentsHistoryOpen === true
  const label = current?.title ?? (view.ui.agentsHistory !== undefined ? '…' : 'Ici, maintenant')
  const entry = (e: HistoryEntry) => {
    const isShown = e.key === (view.ui.agentsHistory ?? 'now')
    const glyph = e.kind === 'now' ? '◉' : e.kind === 'run' ? (e.isArchived ? '▣' : '◆') : '○'
    const when = e.at !== undefined ? `il${NB}y${NB}a${NB}${dur(view.now - e.at)}` : ''
    return (
      <Box key={`history-${e.key}`} flexDirection="row" alignItems="center" marginLeft={2}>
        <Button key={`agents-history-${e.key}`} plain={true} dimColor={!isShown} label={`${isShown ? '▸' : NB}${NB}${glyph}${NB}${e.title}`} onPress={() => act.chooseAgentsHistory(e.key)} />
        {when !== '' && <Box marginLeft={1}>{T(k, [when, e.agents !== undefined ? plural(e.agents, 'agent') : ''].filter(Boolean).join(SEP), { dim: true, wrap: 'truncate-end' })}</Box>}
      </Box>
    )
  }
  const runs = entries.filter(e => e.kind === 'run')
  const discussions = entries.filter(e => e.kind === 'session')
  return (
    <Box key="agents-history-box" flexDirection="column" marginTop={1}>
      <Button key="agents-history" plain={true} label={`🕘${NB}${label}${NB}${isOpen ? '▴' : '▾'}`} onPress={() => act.toggleAgentsHistory()} />
      {isOpen && (
        <Box flexDirection="column">
          {entries.filter(e => e.kind === 'now').map(entry)}
          {runs.length > 0 && T(k, 'Missions', { color: C.slate, bold: true })}
          {runs.map(entry)}
          {discussions.length > 0 && T(k, `Discussions${NB}sans${NB}mission`, { color: C.slate, bold: true })}
          {discussions.map(entry)}
        </Box>
      )}
    </Box>
  )
}

/**
 * La confirmation d'« ✗ Oublier » une discussion (S2), comme « Supprimer » d'une mission : ce qui
 * sera effacé, en nombres ; les workers reconnus par leur titre seul n'y sont pas (S15).
 */
const forgetBox = (k: Kit, past: NonNullable<NonNullable<View['history']>['shown']>, act: Actions): unknown => {
  const { Box, Button } = k
  const sure = past.linked.filter(l => isSureLink(l.session.how) && l.session.session !== undefined).map(l => l.reg)
  const byTitle = past.linked.filter(l => l.session.how === 'title').length
  return (
    <Box key="agents-forget-box" flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1}>
      <Box marginRight={1}>{T(k, forgetText(forgetCount(past.self, sure, byTitle)), { color: C.red, bold: true, wrap: 'wrap' })}</Box>
      <Box marginRight={1}>
        <Button key="agents-forget-yes" variant="primary" label={`✗${NB}Oublier`} onPress={() => act.forget(past.key.slice('session:'.length))} />
      </Box>
      <Button key="agents-forget-no" plain={true} dimColor={true} label="Annuler" onPress={() => act.askForget(past.key)} />
    </Box>
  )
}

/**
 * La rangée de pastilles en tête de l'onglet : « ◆ Manager », puis une pastille par
 * worker avec son état ; le sélectionné porte « ▸ », comme les onglets.
 */
const sessionPills = (k: Kit, linked: readonly LinkedSession[], selected: string | null, act: Actions): unknown => {
  const { Box, Button } = k
  return (
    <Box key="agents-sessions" flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1}>
      <Box marginRight={2}>
        <Button key="agents-session-main" plain={true} dimColor={selected !== null} label={`${selected === null ? '▸' : NB}${NB}◆${NB}Manager`} onPress={() => act.selectAgentsSession(null)} />
      </Box>
      {linked.map(ls => {
        const look = LINKED_STATE[ls.state]
        return (
          <Box key={`pill-${ls.key}`} flexDirection="row" marginRight={2}>
            <Button key={`agents-session-${ls.key}`} plain={true} dimColor={selected !== ls.key} label={`${selected === ls.key ? '▸' : NB}${NB}${ls.title}`} onPress={() => act.selectAgentsSession(ls.key)} />
            <Box marginLeft={1}>{T(k, `${look.glyph}${NB}${look.word}`, { color: look.color, dim: ls.state === 'closed' })}</Box>
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * R1, S36 : les effacements que cette discussion fait en ce moment, du début à la fin, dans la ligne
 * ambre des alertes de l'onglet, une ligne chacun ; rien sinon.
 */
const erasingLine = (k: Kit, view: View): unknown => {
  const all = view.erasing ?? []
  if (all.length === 0) return null
  const lines = all.map(e => `⏳${NB}Effacement${NB}en${NB}cours ${e.key.startsWith('run:') ? `de${NB}la${NB}mission` : `de${NB}la${NB}discussion`} « ${e.title} »…`)
  return T(k, lines.join('\n'), { color: C.amber, wrap: 'wrap' })
}

/**
 * Le repère court d'un ticket, pour le nom d'une passe « bogues » : la lettre de son groupe et son
 * rang dans le groupe (E2), comme les relecteurs nomment les tickets ; sinon son id s'il est court
 * (`03`, `#12`), jamais un id Asana entier.
 */
const ticketTagOf =
  (board: Board | null) =>
  (ticket: string): string | undefined => {
    for (const run of board?.runs ?? []) {
      for (const g of run.groups ?? []) {
        const i = g.tickets.indexOf(ticket)
        if (i >= 0) return `${g.id}${i + 1}`
      }
    }
    return ticket.length <= 4 ? ticket : undefined
  }

/**
 * L'onglet Agents : en tête, le manager et ses workers en pastilles ; puis le résumé
 * et la frise de la session choisie. Celle du manager a sa piste en tête, une piste par
 * worker (lancement et retour), puis une par spécialiste dans l'ordre de départ, sans
 * limite. Pendant une mission comme sans. La barre de navigation règle la fenêtre de vue, propre à la
 * discussion. Ouvert dans un worker, l'onglet la montre comme son propre manager.
 */
const agentsTab = (k: Kit, view: View, act: Actions): unknown[] => {
  const { Box, Button } = k
  // L'entrée du sélecteur d'historique : une mission passée, une ancienne discussion, ou ici.
  const past = view.ui.agentsHistory !== undefined && view.history?.shown?.key === view.ui.agentsHistory ? view.history.shown : null
  const isPastLoading = view.ui.agentsHistory !== undefined && past === null
  const linked = past ? past.linked : isPastLoading ? [] : (view.linked ?? [])
  const chosen = linked.find(l => l.session.key === view.ui.agentsSession) ?? null
  const chosenReg = chosen?.reg ?? null
  // Le worker choisi, figé s'il ne travaille plus.
  const reg = chosen
    ? chosenReg && { ...chosenReg, main: settledLane(chosenReg.main ?? {}, chosen.session, chosenReg), agents: chosenReg.agents.map(a => ({ ...a, ...settledLane(a, chosen.session, chosenReg) })) }
    : past
      ? past.self
      : isPastLoading
        ? null
        : (view.agents ?? null)
  // Un appel à l'advisor sans réponse n'a pas fait attendre son appelant : son attente part de sa piste.
  const voidWaits = new Set((reg?.advisor?.calls ?? []).filter(c => c.isVoid === true).map(c => `${c.by}|${c.s}`))
  const withoutVoidWaits = <L extends AgentLane>(lane: L, by: string | undefined): L =>
    voidWaits.size === 0 || by === undefined || !(lane.segments ?? []).some(x => x.k === 'waitAdvisor' && voidWaits.has(`${by}|${x.s}`))
      ? lane
      : { ...lane, segments: lane.segments!.filter(x => !(x.k === 'waitAdvisor' && voidWaits.has(`${by}|${x.s}`))) }
  const agents = [...(reg?.agents ?? [])].map(a => withoutVoidWaits(a, a.agentId)).sort((a, b) => a.startedAt - b.startedAt)
  const now = view.now
  // Les spécialistes en arbre (Q13) : enfants en retrait sous leur parent, Workflow repliés.
  const tree = laneTree(agents, new Set(view.ui.openWorkflows ?? []))
  // Les exécutions de /code-review sous leur nom standard ; le groupe, celui de la session montrée.
  const tagOf = ticketTagOf(view.board ?? null)
  const shownName = (a: RegistryAgent): string => reviewForkName(a.name, tagOf, reg?.group) ?? a.name
  // Dans la frise du manager, une piste par worker : ses périodes de travail et
  // d'attente, un départ à son lancement, un retour à son compte rendu (ou à sa fin).
  const linkedLanes: FriseLane[] = chosen
    ? []
    : linked.map(({ session: ls, reg: theirs }) => ({
        key: `linked-${ls.key}`,
        name: ls.title,
        color: LINKED_COLOR,
        lane: {
          ...(theirs?.main?.effort !== undefined ? { effort: theirs.main.effort } : {}),
          segments: settledLane(theirs?.main ?? {}, ls, theirs).segments ?? [],
          marks: [
            ...(ls.launchedAt !== undefined ? [{ k: 'relay' as const, at: ls.launchedAt }] : []),
            ...(ls.returnedAt !== undefined ? [{ k: 'back' as const, at: ls.returnedAt }] : []),
          ],
        },
        linked: ls,
      }))
  const returns: AgentMark[] = chosen ? [] : linked.flatMap(({ session: ls }) => (ls.returnedAt !== undefined ? [{ k: 'back' as const, at: ls.returnedAt, to: `session:${ls.key}` }] : []))
  const main = withoutVoidWaits(reg?.main ?? {}, MAIN)
  // Les appels à l'advisor qui ont eu lieu : un appel sans réponse ne coûte rien et ne se montre pas.
  const advisorCalls = (reg?.advisor?.calls ?? []).filter(c => c.isVoid !== true)
  const advisor: AdvisorLane | undefined = advisorCalls.length > 0 ? { calls: advisorCalls } : undefined
  const lanes: FriseLane[] = [
    {
      key: MAIN,
      name: chosen ? chosen.session.title : 'Manager',
      color: ORCHESTRATOR_COLOR,
      lane: returns.length > 0 ? { ...main, marks: [...(main.marks ?? []), ...returns] } : main,
      ...(chosen ? { caption: `worker` } : {}),
    },
    // La ligne advisor de la session montrée, seulement si elle l'a consulté.
    ...(advisor
      ? [{ key: 'advisor', name: ADVISOR_NAME, color: ADVISOR_COLOR, lane: { segments: advisor.calls.map(c => ({ k: 'write' as const, s: c.s, e: c.e ?? c.s })) }, advisor }]
      : []),
    ...linkedLanes,
    ...tree.map((row): FriseLane =>
      row.kind === 'agent'
        ? { key: row.agent.key, name: shownName(row.agent), color: AGENT_TYPE[row.agent.type ?? 'other'].color, lane: row.agent, agent: row.agent, depth: row.depth }
        : {
            key: `wf-${row.id}`,
            name: `⚙${NB}Workflow${NB}·${NB}${plural(row.agents.length, 'agent')}`,
            color: C.teal,
            lane: workflowLane(row.agents, now),
            depth: row.depth,
            workflow: { id: row.id, count: row.agents.length, running: row.agents.filter(a => a.status === 'running').length, isOpen: row.isOpen },
          },
    ),
  ]
  // Qui travaille : les pistes sans spécialiste (manager, advisor, workers), puis les
  // segments bruts de tous les spécialistes, pas la piste réunie d'un Workflow.
  const activity = activityOf(lanes.filter(l => l.workflow === undefined && l.agent === undefined).map(l => l.lane), agents, now)
  // Ce qui se dessine, attentes de la personne comprises : l'axe va de son début à sa fin. Une
  // boucle, pas `Math.min(...)` : au-delà de 100 000 valeurs, l'étalement lève une erreur.
  const isLive = agents.some(a => a.status === 'running') || linkedLanes.some(l => l.linked?.state === 'working')
  let first = Infinity
  let last = isLive ? now : -Infinity
  const see = (s: number, e: number) => {
    if (s < first) first = s
    if (e > last) last = e
  }
  for (const i of activity) see(i.s, i.e)
  for (const l of lanes) for (const seg of l.lane.segments ?? []) see(seg.s, seg.e ?? now)
  if (!Number.isFinite(first)) first = now
  if (!Number.isFinite(last)) last = now
  // L'axe entier, pauses compressées ; la fenêtre de vue en découpe la partie montrée.
  const full = buildAxis(activity, first, Math.max(last, first + 1))
  const axis = sliceAxis(full, windowBounds(full, view.ui.agentsWindow))
  const summary = summaryOf(agents, now)
  // Le résumé additionne les coûts connus (Q15) ; aucun connu : rien.
  const costs = agents.map(a => agentCost(a, a, view)).filter((c): c is number => c !== null)
  const totalCost = costs.length > 0 ? costs.reduce((n, c) => n + c, 0) : null
  // L'advisor à part, sous son nom : compté une seule fois, sur sa ligne.
  const advisorSum = advisor ? advisorCostOf(advisor.calls, view.agentPrices ?? {}) : null
  const advisorPart = advisorSum?.tokens || advisorSum?.isUnknown ? (advisorSum.cost !== null && !advisorSum.isUnknown ? `advisor${NB}${costText(advisorSum.cost)}` : `advisor${NB}:${NB}coût${NB}inconnu`) : null
  const pauses = axis.pieces.filter(p => p.pause !== undefined)
  const labelCells = Math.max(18, Math.min(34, Math.floor(k.width * 0.36)))
  const trackCells = Math.max(16, k.width - labelCells - 5)
  const delegate = view.board?.delegate
  // Ce que montre la frise : cette discussion, le worker choisi, ou ce worker lui-même.
  const context = chosen
    ? `worker${NB}·${NB}${LINKED_STATE[chosen.session.state].word}`
    : past
      ? `${past.key.startsWith('run:') ? 'mission' : 'discussion'}${NB}·${NB}${past.title}`
      : delegate
        ? `worker${NB}de${NB}${delegate.main ?? delegate.title ?? 'son manager'}`
        : `cette${NB}discussion`
  const isBusy = chosen ? chosen.session.state === 'working' : agentsAtWork(view) > 0
  return [
    historySelector(k, view, act),
    erasingLine(k, view),
    sessionPills(k, linked.map(l => l.session), chosen ? chosen.session.key : null, act),
    <Box key="agents-head" flexDirection="row" flexWrap="wrap" alignItems="center">
      <Box marginRight={1}>{chip(k, chosen ? `↗${NB}${chosen.session.title}` : `◆${NB}Manager`, chosen ? LINKED_COLOR : C.violet)}</Box>
      <Box marginRight={1}>{T(k, context, { dim: true })}</Box>
      {past?.key.startsWith('session:') === true && view.ui.confirmForget !== past.key && (
        <Button key="agents-forget" plain={true} dimColor={true} label={`✗${NB}Oublier`} onPress={() => act.askForget(past.key)} />
      )}
    </Box>,
    past?.key.startsWith('session:') === true && view.ui.confirmForget === past.key && forgetBox(k, past, act),
    <Box key="agents-body" flexDirection="column" borderStyle="round" borderColor={isBusy ? C.blue : C.gray} borderDimColor={!isBusy} paddingX={1} marginTop={1}>
      {isPastLoading
        ? T(k, 'Lecture de l’historique…', { dim: true })
        : chosen && !reg
        ? T(k, 'Pas encore de registre lisible pour cette session (pas encore écrit, ou en cours d’écriture).', { dim: true, wrap: 'wrap' })
        : agents.length === 0 && linkedLanes.length === 0 && advisorPart === null
          ? T(k, chosen ? 'Aucun spécialiste dans cette session pour l’instant.' : 'Aucun spécialiste dans cette discussion pour l’instant.', { dim: true, wrap: 'wrap' })
          : line(k, [
              T(k, agentsSummary(agents), { bold: true }),
              linkedLanes.length > 0 && T(k, `·${NB}${plural(linkedLanes.length, 'worker')}`, { dim: true }),
              summary.activeMs > 0 && T(k, `·${NB}${dur(summary.activeMs)}`, { dim: true }),
              gainText(summary.gain) !== '' && T(k, `·${NB}${gainText(summary.gain)}`, { color: C.teal }),
              totalCost !== null && T(k, `·${NB}${costText(totalCost)}`, { color: C.sand }),
              advisorPart !== null && T(k, `·${NB}✦${NB}${advisorPart}`, { color: ADVISOR_COLOR }),
            ], true)}
      {!chosen && !past && view.agentsAlert === true && T(k, '⚠ Le registre des agents n’est plus enregistré : une écriture a été refusée (fichier trop gros ou disque).', { color: C.amber, wrap: 'wrap' })}
      {!chosen && !past && view.agentsAlert === 'lost' && T(k, '⚠ Un changement du suivi des agents n’a pas pu s’appliquer : la frise peut être incomplète.', { color: C.amber, wrap: 'wrap' })}
      {pauses.length > 0 && T(k, `┊${NB}pauses${NB}compressées${NB}:${NB}${pauses.map(p => dur(p.pause ?? 0)).join(', ')}`, { dim: true, wrap: 'truncate-end' })}
      {!isPastLoading && (!chosen || reg) && (
        <Box flexDirection="column" marginTop={1}>
          {navBar(k, full, axis, isLive, view, act)}
          {rulerRow(k, axis, labelCells, trackCells)}
          {lanes.flatMap(l => [laneRow(k, l, axis, view, act, labelCells, trackCells), view.ui.agentCard !== l.key ? null : l.advisor ? advisorCard(k, l, lanes, agents, view) : agentCard(k, l, lanes, view, act, !chosen && !past)])}
        </Box>
      )}
      <Box marginTop={1}>{legendRow(k)}</Box>
      {legendDetail(k, view, act)}
    </Box>,
  ]
}

// ─── Prochaine étape ──────────────────────────────────────────────────────

/** Les boutons et la ligne de la suite recommandée pendant l'Implémentation d'une mission à groupes. */
const launchParts = (rec: NextLaunch, act: Actions): { buttons: NextButton[]; note: string } => {
  const and = (ids: readonly string[]) => ids.join(', ')
  if (rec.kind === 'parallel') {
    const lot = rec.groups.join(' ∥ ')
    return {
      buttons: [{ key: 'next-parallel-linked', isPrimary: true, label: `⇉${NB}${lot} en parallèle · workers`, onPress: () => act.launchParallelLinked(0) }],
      note: 'groupes indépendants : ils partent ensemble',
    }
  }
  if (rec.kind === 'group') {
    // Un groupe ne se fait que dans un worker.
    const id = rec.group
    return {
      buttons: rec.isDelegable
        ? [
            { key: `next-linked-${id}`, isPrimary: true, label: `↗${NB}Groupe ${id} · worker`, onPress: () => act.launchGroupLinked(id) },
            xhighOf(`next-xhigh-${id}`, id, act),
          ]
        : [],
      note: 'le prochain groupe prêt',
    }
  }
  if (rec.kind === 'held')
    return {
      buttons: rec.holds.map(h => ({ key: `next-force-${h.held}-${h.run}-${h.group}${h.on === 'plan' ? '-plan' : ''}`, isQuiet: true as const, label: `⇥${NB}Forcer ${h.held === LOT_KEY ? 'le lot' : h.held}${h.on === 'plan' ? `${NB}(plan)` : ''}`, onPress: () => act.forceHold({ held: h.held, run: h.run, group: h.group, ...(h.on === 'plan' ? { on: 'plan' as const } : {}) }) })),
      note: `retenu par une autre mission : ${rec.holds.map(heldText).join(' ; ')} ; part une fois le groupe attendu clos`,
    }
  if (rec.kind === 'busy') return { buttons: [], note: `${rec.groups.length > 1 ? 'groupes' : 'groupe'} ${and(rec.groups)} en cours ici : la suite viendra une fois ${rec.groups.length > 1 ? 'finis' : 'fini'}` }
  if (rec.kind === 'linked') return { buttons: [], note: `${and(rec.groups)} dans un worker : la suite une fois ${rec.groups.length > 1 ? 'rendus' : 'rendu'}` }
  return { buttons: [], note: `tickets faits ; le compte rendu attend la revue de ${and(rec.groups)} (bouton sur la ligne du groupe)` }
}

/**
 * La carte « Ensuite » avant son dessin : son titre, sa note, ses boutons, et le bouton de l'étape
 * suivante (`lead`, l'un d'eux) que le bandeau reprend. C'est le lancement de groupes quand il y en
 * a un ; sinon, l'étape finie, la suite principale, ou « Clore la mission » quand elle n'est que la
 * rétro ou qu'il n'y en a pas. Jamais la compaction, la rétro ni « xhigh » ; rien en pleine étape.
 */
const nextStepOf = (run: Run, view: View, act: Actions): { title: string; note: string; buttons: NextButton[]; lead: NextButton | null; preview: string[] } | null => {
  const sug = suggestionsFor(run, { hasPullRequests: view.sync.isGitHub !== false, isVersionSet: view.sync.isVersionSet, versionUnits: view.sync.versionUnits, security: view.security ?? 'unread' })
  const rec = nextLaunchFor(run, outsideOf(view))
  const phase = currentPhase(run)
  if (rec === null && sug.primary === null && !sug.canFinish) return null
  // Le lot sans groupes retenu par une autre mission : la carte le dit, et propose de forcer.
  // Seulement quand la suite est la phase de code du lot : les autres étapes (compte rendu, clôture) restent proposées.
  const lotHolds = (run.groups ?? []).length === 0 && sug.primary !== null && CODE_SKILLS.has(sug.primary) ? (view.holds ?? []).filter(h => h.held === LOT_KEY) : []
  if (rec === null && lotHolds.length > 0) {
    const parts = launchParts({ kind: 'held', groups: [LOT_KEY], holds: lotHolds }, act)
    return { title: 'Ensuite', note: parts.note, buttons: parts.buttons, lead: null, preview: [] }
  }
  const title = sug.canFinish && sug.primary === null ? 'Mission bouclée' : phase.status === 'done' ? 'Prochaine étape' : 'Ensuite'
  const buttons: NextButton[] = []
  let lead: NextButton | null = null
  let note = phase.status !== 'done' ? 'la commande va dans le prompt ; la lancer clôt la phase en cours' : 'la commande va dans le prompt'
  if (rec !== null) {
    // Les groupes d'abord : relancer /implement ou proposer la livraison n'y ajouterait rien.
    const parts = launchParts(rec, act)
    buttons.push(...parts.buttons)
    lead = parts.buttons[0] ?? null
    note = parts.buttons.length > 0 ? `${parts.note} · la demande va dans le prompt, la phase continue` : parts.note
    // Un autre groupe retenu par une autre mission : la carte le dit aussi.
    if (rec.kind !== 'held' && (view.holds ?? []).length > 0) note = `${note} · retenu par une autre mission : ${(view.holds ?? []).map(heldText).join(' ; ')}`
    // Après /to-tickets, avant les groupes : alléger le manager d'abord (bouton secondaire).
    if (view.live.ask === null && suggestsCompaction(view.board, view.agents)) buttons.push({ key: 'next-compact', label: `⇣${NB}Compacter d’abord`, onPress: () => act.compactFirst() })
    if (phase.skill !== 'retro') buttons.push({ key: 'go-retro', label: `${SKILLS.retro!.glyph} ${SKILLS.retro!.label}`, onPress: () => act.launch('retro') })
    return { title, note, buttons, lead, preview: [] }
  }
  if (sug.primary !== null) {
    const skill = sug.primary
    const d = SKILLS[skill]!
    buttons.push({ key: `go-${skill}`, isPrimary: true, label: `▶ ${d.label}`, onPress: () => act.launch(skill) })
    if (phase.status === 'done' && skill !== 'retro') lead = buttons[0]!
  }
  for (const skill of sug.others) {
    const d = SKILLS[skill]!
    buttons.push({ key: `go-${skill}`, label: `${d.glyph} ${d.label}`, onPress: () => act.launch(skill) })
  }
  if (sug.canFinish) {
    buttons.push({ key: 'finish', label: '✓ Clore la mission', onPress: () => act.finish() })
    if (phase.status === 'done' && lead === null) lead = buttons.at(-1)!
  }
  if (sug.versionNote) note = sug.versionNote
  return { title, note, buttons, lead, preview: sug.versionPreview ?? [] }
}

const nextCard = (k: Kit, run: Run, view: View, act: Actions): unknown => {
  const { Box } = k
  const found = nextStepOf(run, view, act)
  if (found === null) return null
  const withPlan = view.planUnread ? { ...found, note: `${PLAN_UNREAD_TEXT.toLowerCase()} · ${found.note}` } : found
  const next = view.launchUnread ? { ...withPlan, note: `fichier des missions illisible au dernier lancement : rien n’est parti, réessaie · ${withPlan.note}` } : withPlan
  return (
    <Box key="next" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {line(k, [T(k, next.title, { bold: true }), T(k, next.note, { dim: true })])}
      {next.buttons.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
          {next.buttons.map(b => (
            <Box marginRight={1}>{nextButton(k, b)}</Box>
          ))}
        </Box>
      )}
      {next.preview.length > 0 && (
        <Box key="version-preview" flexDirection="column" marginTop={1}>
          {next.preview.map(l => T(k, l, { dim: true, wrap: 'wrap' }))}
        </Box>
      )}
    </Box>
  )
}

// ─── Onglets ──────────────────────────────────────────────────────────────

const tabsRow = (k: Kit, view: View, run: Run | null, act: Actions): unknown => {
  const { Box, Button } = k
  const agents: [Tab, string] = ['agents', agentsAtWork(view) > 0 ? `Agents${NB}·${NB}${agentsAtWork(view)}` : 'Agents']
  const history: [Tab, string] = ['history', `Historique${NB}·${NB}${view.board?.runs.filter(r => r.archivedAt === undefined).length ?? 0}`]
  // La discussion du COO ne porte pas de mission : Coordination à la place de Mission et Activité.
  const tabs: [Tab, string][] = view.coo
    ? [['coord', 'Coordination'], agents, history, ['commands', 'Commandes']]
    : [['flow', 'Mission'], agents, ['activity', run && run.log.length > 0 ? `Activité${NB}·${NB}${run.log.length}` : 'Activité'], history, ['commands', 'Commandes']]
  const current = shownTab(view)
  return (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" marginTop={1}>
      {tabs.map(([tab, label]) => (
        <Box marginRight={2}>
          <Button key={`tab-${tab}`} plain={true} dimColor={tab !== current} label={tab === current ? `▸ ${label}` : label} onPress={() => act.setTab(tab)} />
        </Box>
      ))}
    </Box>
  )
}

/** L'onglet montré : dans la discussion du COO, Coordination remplace Mission et Activité ; ailleurs, Coordination n'existe pas. */
const shownTab = (view: View): Tab => {
  const tab = view.ui.tab
  if (view.coo) return tab === 'flow' || tab === 'activity' ? 'coord' : tab
  return tab === 'coord' ? 'flow' : tab
}

/** Une ligne de morceaux de texte décrite par la vue du COO (`coo-view.tsx`). */
const cooLine = (k: Kit, parts: readonly CooPart[]): unknown => line(k, parts.map(p => T(k, p.text, { ...(p.color ? { color: p.color } : {}), ...(p.bold ? { bold: true } : {}), ...(p.dim ? { dim: true } : {}) })), true)

/** L'onglet Coordination : le point, ce qui t'attend, les missions, la feuille de route (variante A des planches), la bascule de la revue de sécurité. */
const coordinationTab = (k: Kit, s: CooStatement, act: Actions, security: SecurityReview): unknown[] =>
  [...coordinationRows(s), ...securitySettingRows(security)].map(row =>
    row.kind === 'heading' ? (
      <k.Box key={row.key} marginTop={1}>
        {cooLine(k, row.parts)}
      </k.Box>
    ) : (
      <k.Box key={row.key} flexDirection="row" flexWrap="wrap">
        <k.Box flexShrink={1}>{cooLine(k, row.parts)}</k.Box>
        {(row.actions ?? []).map(a => (
          <k.Box key={`${a.key}-box`} marginLeft={1}>
            <k.Button key={a.key} plain={true} label={a.label} onPress={() => act.cooDo(a.act)} />
          </k.Box>
        ))}
      </k.Box>
    ),
  )

/** Le panneau de la discussion du COO. */
const cooPane = (k: Kit, view: View, s: CooStatement, act: Actions): unknown => {
  const tab = shownTab(view)
  const body: unknown = tab === 'commands' ? commandsTab(k, act) : tab === 'agents' ? agentsTab(k, view, act) : tab === 'history' && view.board ? historyTab(k, view.board, view, act) : coordinationTab(k, s, act, view.security ?? 'unread')
  return (
    <k.Box flexDirection="column" paddingX={1} paddingBottom={1}>
      {tabsRow(k, view, null, act)}
      {body}
    </k.Box>
  )
}

const launcher = (k: Kit, act: Actions): unknown => {
  const { Box, Button } = k
  return (
    <Box key="launcher" flexDirection="column" marginTop={1}>
      {T(k, 'Démarrer une mission', { bold: true })}
      {T(k, 'La commande arrive dans le prompt : ajoute le sujet, puis Entrée.', { dim: true, wrap: 'wrap' })}
      <Box flexDirection="column" marginTop={1}>
        {LAUNCHERS.map(l => {
          const d = SKILLS[l.skill]!
          return (
            <Box key={`l-${l.skill}`} flexDirection="row" alignItems="center">
              <Box marginRight={1} flexShrink={0}>
                <Button key={`new-${l.skill}`} label={`${d.glyph} ${l.title}`} onPress={() => act.prepare(l.skill)} />
              </Box>
              <Box flexShrink={1}>{T(k, `/${slashOf(l.skill)}${SEP}${l.hint}`, { dim: true, wrap: 'truncate-end' })}</Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** Une ligne de commande : le bouton (qui met la commande dans le prompt) et ce qu'elle fait. */
const commandRow = (k: Kit, skill: string, act: Actions): unknown => {
  const { Box, Button } = k
  const d = SKILLS[skill]!
  return (
    <Box key={`c-${skill}`} flexDirection="row" alignItems="center">
      <Box marginRight={1} flexShrink={0}>
        <Button key={`cmd-${skill}`} label={`${d.glyph} ${d.label}`} onPress={() => act.prepare(skill)} />
      </Box>
      <Box flexShrink={1}>{T(k, `/${commandLineOf(skill)}${SEP}${d.verb}`, { dim: true, wrap: 'truncate-end' })}</Box>
    </Box>
  )
}

const commandsTab = (k: Kit, act: Actions): unknown[] => {
  const { Box } = k
  return [
    launcher(k, act),
    <Box key="others" flexDirection="column" marginTop={1}>
      {T(k, 'Autres commandes', { bold: true })}
      {T(k, 'Les étapes et outils qui se greffent sur une mission, ou servent seuls.', { dim: true, wrap: 'wrap' })}
      {COMMAND_GROUPS.map(group => (
        <Box key={`g-${group.title}`} flexDirection="column" marginTop={1}>
          {T(k, group.title, { color: C.slate, bold: true })}
          {group.skills.map(skill => commandRow(k, skill, act))}
        </Box>
      ))}
    </Box>,
    <Box key="flow-commands" flexDirection="column" marginTop={1}>
      {T(k, 'Tableau de bord', { bold: true })}
      {FLOW_COMMANDS.map(c => (
        <Box key={`f-${c.args || 'open'}`} flexDirection="row">
          <Box marginRight={1} flexShrink={0} width={16}>
            {T(k, `/flow${c.args ? `${NB}${c.args}` : ''}`, { color: C.violet })}
          </Box>
          <Box flexShrink={1}>{T(k, c.hint, { dim: true, wrap: 'truncate-end' })}</Box>
        </Box>
      ))}
    </Box>,
    archiveToggle(k, act),
  ]
}

/**
 * L'interrupteur de l'archivage d'office : l'état de l'accord (relu par le mod toutes les 5 s) et le
 * clic qui le bascule. Allumé, Claude archive sans redemander les sessions de l'app que la fermeture
 * d'un groupe ou des pistes a vérifiées ; éteint, il demande pour chacune.
 */
const archiveToggle = (k: Kit, act: Actions): unknown => {
  const { Box, Button } = k
  const at = archiveConsent.at
  const state = at !== null ? `allumé depuis le ${consentDay(at)}` : 'éteint'
  return (
    <Box key="archive" flexDirection="column" marginTop={1}>
      {T(k, 'Sessions de l’app', { bold: true })}
      <Button key="archive-toggle" label={`Archivage d’office : ${state} · ${at !== null ? 'éteindre' : 'allumer'}`} onPress={() => act.toggleArchiveConsent()} />
      {T(k, 'Allumé, Claude archive sans redemander les sessions de l’app que la fermeture d’un groupe ou des pistes a vérifiées (comme claude stop dans le CLI) ; éteint, il te demande pour chacune.', { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

// ─── À tout moment ────────────────────────────────────────────────────────

const anytimeButton = (k: Kit, tool: AnytimeTool, act: Actions): unknown => {
  const { Button } = k
  if ('command' in tool) return <Button key={`any-${tool.key}`} label={`${tool.glyph}${NB}${tool.label}`} onPress={() => act.fillCommand(tool.command)} />
  const d = SKILLS[tool.skill]!
  const label = `${tool.glyph ?? d.glyph}${NB}${(tool.label ?? d.label).replace(/ /g, NB)}`
  const press = tool.withState ? () => act.askNext() : () => (tool.asks ? act.prepare(tool.skill) : act.launch(tool.skill))
  return <Button key={`any-${tool.key}`} label={label} onPress={press} />
}

/**
 * La barre du bas de la page Mission : des outils qui servent à tout moment, sans clore la phase.
 * Avec une mission active ici dans une phase de code ou de revue, « 🐞 Bug · worker » s'ajoute.
 */
const anytimeCard = (k: Kit, act: Actions, run?: Run): unknown => {
  const { Box, Button } = k
  const isBugHere = run !== undefined && (SKILLS['diagnosing-bugs']!.detourIn ?? []).includes(currentPhase(run).skill)
  return (
    <Box key="anytime" flexDirection="column" borderStyle="round" borderColor={C.violet} borderDimColor={true} paddingX={1} marginTop={1}>
      {line(k, [T(k, 'À tout moment', { bold: true, color: C.violet }), T(k, 'la commande va dans le prompt, la phase en cours continue', { dim: true, wrap: 'truncate-end' })])}
      {ANYTIME_GROUPS.map(g => (
        <Box key={`any-g-${g.title}`} flexDirection="column" marginTop={1}>
          {T(k, g.title, { color: C.slate, bold: true })}
          <Box flexDirection="row" flexWrap="wrap">
            {g.tools.map(tool => (
              <Box marginRight={1}>{anytimeButton(k, tool, act)}</Box>
            ))}
          </Box>
        </Box>
      ))}
      {isBugHere && (
        <Box key="any-g-bug" flexDirection="column" marginTop={1}>
          {T(k, 'Déléguer', { color: C.slate, bold: true })}
          <Box flexDirection="row" flexWrap="wrap" alignItems="center">
            <Box marginRight={1}>
              <Button key="any-bug" label={`🐞${NB}Bug${NB}·${NB}worker`} onPress={() => act.launchBugLinked()} />
            </Box>
            {T(k, 'diagnostic dans une session à part, en détour de la phase', { dim: true, wrap: 'truncate-end' })}
          </Box>
        </Box>
      )}
    </Box>
  )
}

/** Ce que vaut l'allumage du mode auto, décidé au cadrage du mode auto, montré au premier clic sur « ⚡ Auto ». */
const AUTO_WORTH =
  'Ton second clic vaut ton accord, pour cette mission seulement, sur ses validations à boutons (accord du cadrage, spec, découpage, plan) et sur les écritures Asana qu’elle prévoit (création des tickets, statuts) : chacune sera inscrite dans « Décidé sans toi ». Une question en zone sensible se tranche seule quand l’option recommandée respecte l’invariant déjà validé (quand il y en a un) et qu’elle est la plus prudente (elle ne perd rien, n’expose rien, ne supprime rien sans retour) : elle est inscrite dans « Décidé sans toi », son texte commençant par « Zone sensible : », et le compte rendu la range à part, pour que tu la relises. L’auto s’arrête au rapport du compte rendu ; le valider, la version et le push restent à toi. Restent aussi à toi, et n’arrêtent que ce qu’elles concernent :'

/** Les six catégories de décisions qui bloquent toujours, même en auto : seuls les choix d'expérience et les décisions qui sont vraiment à la personne. */
const AUTO_BLOCKS: readonly string[] = [
  'un choix d’expérience : ce que tu vois et fais (mise en page, maquette, libellés, boutons, notifications), ou toute question où les options se valent techniquement et ne diffèrent que par ta préférence ;',
  'fixer ou affaiblir un invariant, ou un changement qui contredit une décision déjà prise ;',
  'une suppression sans retour ou une exposition de tes données hors du poste (une publication) ;',
  'laisser une faille de sécurité sans correctif ;',
  'l’effort xhigh d’un worker ;',
  'une dépense ou une action externe hors de la mission (dépendance lourde, service tiers).',
]

/**
 * Le bouton « ⚡ Auto » de la mission active ici, seul moyen de l'allumer : un premier clic montre ce que l'activation vaut,
 * « Confirmer » l'allume pour cette discussion ; quand il envoie d'ici, le même bouton le coupe d'un clic.
 */
const autoRow = (k: Kit, run: Run, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const state = view.board ? autoStateOf(run, view.board, view.here ?? view.board.session ?? '', view.autoConfirmedAt) : ({ kind: 'off' } as const)
  if (state.kind !== 'on' && view.ui.confirmAuto === run.id) {
    return (
      <Box key="auto" flexDirection="column" borderStyle="round" borderColor={C.amber} paddingX={1} marginTop={1}>
        {T(k, `⚡${NB}Allumer le mode auto de cette mission ?`, { bold: true, color: C.amber })}
        {T(k, AUTO_WORTH, { wrap: 'wrap' })}
        {AUTO_BLOCKS.map((text, i) => (
          <Box key={`auto-block-${i}`} flexDirection="row">
            <Box marginRight={1} flexShrink={0}>
              {T(k, `${i + 1}.`, { dim: true })}
            </Box>
            <Box flexShrink={1}>{T(k, text, { wrap: 'wrap' })}</Box>
          </Box>
        ))}
        <Box flexDirection="row" marginTop={1}>
          <Box marginRight={1}>
            <Button key="auto-confirm" variant="primary" label="Confirmer" onPress={() => act.confirmAuto()} />
          </Box>
          <Button key="auto-cancel" plain={true} dimColor={true} label="Annuler" onPress={() => act.askAuto()} />
        </Box>
      </Box>
    )
  }
  // Allumé par une autre discussion (pause déduite) : il se coupe d'ici d'un clic, ou se rallume pour elle en deux.
  const isOn = isAutoOn(run)
  // Une pause posée par le mod s'efface d'un clic aussi : sinon le bandeau la redirait jusqu'au rallumage.
  // Lu sur le même état que le texte, pour que le bouton et le texte disent la même chose.
  const canCut = isOn || state.kind === 'paused'
  const hint =
    state.kind === 'on'
      ? 'la mission avance seule ; un clic rend la main'
      : state.kind === 'paused' && isOn
        ? `en pause : ${state.why} ; deux clics le rallument ici, un clic le coupe`
        : state.kind === 'paused'
          ? `en pause : ${state.why} ; deux clics le rallument, un clic l’éteint pour de bon`
          : 'la mission avance seule jusqu’au rapport ; deux clics pour l’allumer'
  return (
    <Box key="auto" flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1}>
      {state.kind !== 'on' && (
        <Box marginRight={1}>
          <Button key="auto-on" label={`⚡${NB}Auto`} onPress={() => act.askAuto()} />
        </Box>
      )}
      {canCut && (
        <Box marginRight={1}>
          <Button key="auto-off" label={`⚡${NB}Couper l’auto`} onPress={() => act.stopAuto()} />
        </Box>
      )}
      {T(k, hint, { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

/**
 * Les questions qui attendent la personne (`waiting`), chacune avec ce qu'elle bloque : Claude les
 * retire une fois qu'elle y a répondu. Rien sans question.
 */
const waitingCard = (k: Kit, run: Run, act?: Actions): unknown => {
  const { Box, Button } = k
  const open = openQuestions(run)
  if (open.length === 0) return null
  // « Envoi resté sans suite » : la marque attend encore son démarrage, « ↻ Renvoyer » l'efface et laisse l'auto renvoyer.
  // Seulement sur la mission active ici (`act` donné) : ailleurs, il ne pourrait pas renvoyer.
  const stale = new Set(act ? pendingAutoMarks(run).filter(m => m.staleAt !== undefined).map(m => m.key) : [])
  return (
    <Box key="waiting" flexDirection="column" borderStyle="round" borderColor={C.amber} paddingX={1} marginTop={1}>
      {line(k, [T(k, `❓${NB}Questions qui t’attendent`, { bold: true, color: C.amber }), T(k, `${open.length}`, { dim: true })])}
      {open.map(q => (
        <Box key={`wait-${q.id}`} flexDirection="column" marginTop={1}>
          {T(k, q.text || '(question sans texte)', { wrap: 'wrap' })}
          {T(k, `bloque ${waitTargetLabel(run, q)}${SEP}${q.id}`, { dim: true, wrap: 'wrap' })}
          {q.id.startsWith(STALE_PREFIX) && stale.has(q.id.slice(STALE_PREFIX.length)) && (
            <Box flexDirection="row">
              <Button key={`auto-resend-${q.id.slice(STALE_PREFIX.length)}`} label={`↻${NB}Renvoyer`} onPress={() => act?.resendAuto(run.id, q.id.slice(STALE_PREFIX.length))} />
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}

/** Mettre de côté la mission active : ni close ni archivée, elle attend dans l'historique. */
const asideRow = (k: Kit, act: Actions): unknown => {
  const { Box, Button } = k
  return (
    <Box key="aside" flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1}>
      <Box marginRight={1}>
        <Button key="set-aside" plain={true} dimColor={true} label={`‖${NB}Mettre de côté`} onPress={() => act.setAside()} />
      </Box>
      {T(k, 'pour en ouvrir une autre ; « Reprendre » la rouvre telle quelle', { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

const flowTab = (k: Kit, run: Run, view: View, act: Actions): unknown[] => {
  const isMine = run.id === view.board?.activeId
  if (run.status === 'active' && isMine) return [phaseCard(k, run, view, act), waitingCard(k, run, act), agentsLine(k, view, act), nextCard(k, run, view, act), autoRow(k, run, view, act), asideRow(k, act), anytimeCard(k, act, run)]
  const { Box, Button } = k
  const isElsewhere = run.status === 'active'
  const isAside = run.status === 'paused' && run.asideAt !== undefined
  const head = isElsewhere
    ? `La dernière mission, « ${run.title} », est en cours dans une autre discussion.`
    : isAside
      ? `La dernière mission, « ${run.title} », est mise de côté.`
      : run.status === 'paused'
        ? `La dernière mission, « ${run.title} », est en pause.`
        : 'Aucune mission en cours.'
  const hint = isElsewhere
    ? 'La reprendre ici la retire de l’autre discussion.'
    : isAside
      ? 'Elle reprend telle quelle avec « Reprendre » ; un skill lancé d’ici ouvre une autre mission.'
      : run.status === 'paused' && view.board?.session !== undefined && run.bornIn === view.board.session
        ? 'Elle reprend toute seule quand tu relances un de ses skills.'
        : run.status === 'paused'
          ? 'Elle reprend telle quelle avec « Reprendre » ; un skill lancé d’ici ouvre une autre mission.'
        : 'La suivante démarre au prochain skill.'
  // Le mode auto d'une mission qui n'est pas actif ici : en pause (déduite ou posée), ou envoyé d'ailleurs.
  const auto = view.board ? autoStateOf(run, view.board, view.here ?? view.board.session ?? '') : ({ kind: 'off' } as const)
  const autoLine =
    auto.kind === 'paused' ? `⚡${NB}Auto en pause : ${auto.why}` : auto.kind === 'elsewhere' ? `⚡${NB}Auto allumé, la mission est suivie dans une autre discussion` : ''
  return [
    <Box key="idle" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {T(k, head, { bold: true })}
      {T(k, hint, { dim: true, wrap: 'wrap' })}
      {autoLine !== '' && T(k, autoLine, { color: auto.kind === 'paused' ? C.amber : C.teal, wrap: 'wrap' })}
      {(run.status === 'paused' || isElsewhere) && (
        <Box marginTop={1}>
          <Button key={`resume-${run.id}`} variant="primary" label="↻ Reprendre" onPress={() => act.resume(run.id)} />
        </Box>
      )}
    </Box>,
    waitingCard(k, run),
    launcher(k, act),
    anytimeCard(k, act),
  ]
}

const artifactRow = (k: Kit, a: Artifact, now: number): unknown => {
  const { Box } = k
  const look = KIND[a.kind]
  return (
    <Box flexDirection="row">
      <Box marginRight={1} flexShrink={0}>
        {T(k, look.glyph, { color: look.color, bold: true })}
      </Box>
      <Box flexShrink={0} marginRight={1}>
        {T(k, a.label, { bold: true })}
      </Box>
      {a.detail !== undefined && <Box flexShrink={1}>{T(k, a.detail, { dim: true, wrap: 'wrap' })}</Box>}
      <Box marginLeft={1} flexShrink={0}>
        {T(k, dur(now - a.at), { dim: true })}
      </Box>
    </Box>
  )
}

const ARTIFACTS_SHOWN = 14

const activityTab = (k: Kit, run: Run, view: View, act: Actions): unknown[] => {
  const { Box, Button } = k
  const tests = run.tests.filter(t => t.kind === 'test')
  const counters: [string, string][] = [
    [`✎${NB}${plural(run.touched.length, 'fichier')}`, C.slate],
    [`⎇${NB}${plural(run.counters.commits, 'commit')}`, C.green],
  ]
  if (run.counters.merges > 0) counters.push([`⤞${NB}${plural(run.counters.merges, 'merge')}`, C.cyan])
  if (run.counters.worktrees > 0) counters.push([`⧉${NB}${plural(run.counters.worktrees, 'worktree')}`, C.cyan])
  if (run.counters.terms > 0) counters.push([`§${NB}${plural(run.counters.terms, 'terme')}`, C.lilac])
  if (run.counters.adrs > 0) counters.push([`▲${NB}${run.counters.adrs}${NB}ADR`, C.violet])
  if (run.counters.testFiles > 0) counters.push([`◑${NB}${plural(run.counters.testFiles, 'fichier')} de test`, C.coral])
  if (tests.length > 0) counters.push([`✓${NB}${tests.filter(t => t.ok).length}${NB}/${NB}✗${NB}${tests.filter(t => !t.ok).length}`, C.green])
  if (run.counters.repitches > 0) counters.push([`?${NB}${plural(run.counters.repitches, 'reformulation')}`, C.gray])
  const logShown = view.ui.showAllLog ? run.log : run.log.slice(0, 12)
  return [
    <Box key="counters" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {T(k, 'En chiffres', { bold: true })}
      <Box marginTop={1}>{line(k, counters.map(([text, color]) => T(k, text, { color, bold: true })), true)}</Box>
    </Box>,
    <Box key="artifacts" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {line(k, [T(k, 'Livrables', { bold: true }), T(k, `${run.artifacts.length}`, { dim: true })])}
      {run.artifacts.length === 0 && T(k, 'Glossaire, ADR, spec, rapports, prototypes, PR… apparaissent ici dès qu’ils sont écrits.', { dim: true, wrap: 'wrap' })}
      {(view.ui.showAllArtifacts ? run.artifacts : run.artifacts.slice(0, ARTIFACTS_SHOWN)).map(a => artifactRow(k, a, view.now))}
      {run.artifacts.length > ARTIFACTS_SHOWN && (
        <Button key="artifacts-toggle" plain={true} dimColor={true} label={view.ui.showAllArtifacts ? '▾ réduire' : `▸ tout voir (${run.artifacts.length})`} onPress={() => act.toggleArtifacts()} />
      )}
    </Box>,
    tests.length > 0 && (
      <Box key="tests" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
        {testsBlock(k, run, k.width - 6)}
      </Box>
    ),
    <Box key="log" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {T(k, 'Journal', { bold: true })}
      {logShown.map(entry => (
        <Box flexDirection="row">
          <Box marginRight={1} flexShrink={0} width={8}>
            {T(k, dur(view.now - entry.at), { dim: true })}
          </Box>
          <Box marginRight={1} flexShrink={0}>
            {T(k, entry.glyph, { color: TONE[entry.tone], bold: true })}
          </Box>
          <Box flexShrink={1}>{T(k, entry.text, { wrap: 'wrap', color: entry.tone === 'error' ? C.red : '' })}</Box>
        </Box>
      ))}
      {run.log.length > 12 && (
        <Button key="log-toggle" plain={true} dimColor={true} label={view.ui.showAllLog ? '▾ réduire' : `▸ tout le journal (${run.log.length})`} onPress={() => act.toggleLog()} />
      )}
    </Box>,
  ]
}

const historyTab = (k: Kit, board: Board, view: View, act: Actions): unknown[] => {
  const { Box, Button } = k
  const rank = (r: Run) => (r.status === 'active' ? 0 : r.status === 'paused' ? 1 : 2)
  const sorted = [...board.runs].sort((a, b) => rank(a) - rank(b) || (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt))
  // Les archives sont cachées par défaut, sous la liste, plus récemment archivées d'abord.
  const live = sorted.filter(r => r.archivedAt === undefined)
  const archived = sorted.filter(r => r.archivedAt !== undefined).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
  const isArchiveOpen = view.ui.showArchived === true
  // Chaque mission, archivées comprises, ouvre l'onglet Agents sur elle (Q12).
  const agentsOf = (r: Run) => <Button key={`agents-of-${r.id}`} plain={true} dimColor={true} label={`◆${NB}Agents`} onPress={() => act.openAgentsOf(r.id)} />
  const card = (r: Run) => {
    const isArchived = r.archivedAt !== undefined
    const def = SKILLS[r.entry]!
    const phase = currentPhase(r)
    const ratio = runProgress(r)
    const isMine = r.id === board.activeId
    const status = isArchived
      ? T(k, `▣${NB}archivée`, { color: C.gray, bold: true })
      : r.status === 'active' && !isMine
        ? T(k, `⇆${NB}autre discussion`, { color: C.blue, bold: true })
        : r.status === 'active'
        ? T(k, `◉${NB}en cours`, { color: def.color, bold: true })
        : r.status === 'paused'
          ? T(k, r.asideAt !== undefined ? `‖${NB}mise de côté` : `‖${NB}en pause`, { color: C.gray, bold: true })
          : T(k, `✓${NB}terminée`, { color: C.green, bold: true })
    const bar = k.isRich
      ? svgOf(k, barSvg([{ value: ratio, color: def.color }], 1, px(Math.min(24, k.width - 10))), pct(ratio), false)
      : blocks(k, [{ value: ratio, color: def.color }], 1, Math.min(24, k.width - 12))
    return (
      <Box key={`run-${r.id}`} flexDirection="column" borderStyle="round" borderColor={isArchived ? C.gray : def.color} borderDimColor={!isMine} hover={{ borderDimColor: false }} paddingX={1} marginTop={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexShrink={1}>{line(k, [T(k, def.glyph, { color: def.color, bold: true }), T(k, r.title, { bold: true, wrap: 'truncate-end' })])}</Box>
          <Box marginLeft={1} flexShrink={0}>
            {status}
          </Box>
        </Box>
        {T(k, [def.flowLabel, SKILLS[phase.skill]?.label ?? phase.skill, isArchived ? `archivé il y a ${dur(view.now - (r.archivedAt ?? r.updatedAt))}` : `il y a ${dur(view.now - (r.finishedAt ?? r.updatedAt))}`].filter((part, i, all) => all.indexOf(part) === i).join(SEP), { dim: true, wrap: 'truncate-end' })}
        <Box flexDirection="row" alignItems="center">
          <Box marginRight={1}>{bar}</Box>
          {T(k, pct(ratio), { dim: true })}
        </Box>
        {isArchived ? (
          view.ui.confirmDrop === r.id ? (
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1}>
              <Box marginRight={1}>{T(k, 'Supprimer définitivement cette mission ?', { color: C.red, bold: true })}</Box>
              {view.dropUngleaned !== undefined && view.dropUngleaned > 0 ? (
                <Box marginRight={1}>{T(k, `${view.dropUngleaned} ${view.dropUngleaned > 1 ? 'comptes rendus pas encore relevés' : 'compte rendu pas encore relevé'} par le COO`, { color: C.amber, bold: true })}</Box>
              ) : null}
              <Box marginRight={1}>
                <Button key={`drop-yes-${r.id}`} variant="primary" label="✗ Supprimer" onPress={() => act.drop(r.id)} />
              </Box>
              <Button key={`drop-no-${r.id}`} plain={true} dimColor={true} label="Annuler" onPress={() => act.askDrop(r.id)} />
            </Box>
          ) : (
            <Box flexDirection="row" marginTop={1}>
              <Box marginRight={1}>
                <Button key={`unarchive-${r.id}`} label="▢ Désarchiver" onPress={() => act.unarchive(r.id)} />
              </Box>
              <Box marginRight={1}>{agentsOf(r)}</Box>
              <Button key={`drop-${r.id}`} plain={true} dimColor={true} label="✗ Supprimer" onPress={() => act.askDrop(r.id)} />
            </Box>
          )
        ) : (
          <Box flexDirection="row" marginTop={1}>
            {!isMine && (
              <Box marginRight={1}>
                <Button key={`resume-${r.id}`} label={r.status === 'active' ? '↻ Reprendre ici' : '↻ Reprendre'} onPress={() => act.resume(r.id)} />
              </Box>
            )}
            <Box marginRight={1}>{agentsOf(r)}</Box>
            {!isMine && r.status !== 'active' && <Button key={`archive-${r.id}`} plain={true} dimColor={true} label="▣ Archiver" onPress={() => act.archive(r.id)} />}
          </Box>
        )}
      </Box>
    )
  }
  return [
    erasingLine(k, view),
    T(k, `Projet${NB}${board.name}${SEP}${plural(live.length, 'mission', 'missions')}${archived.length > 0 ? `${SEP}${archived.length}${NB}archivée${archived.length > 1 ? 's' : ''}` : ''}`, { dim: true, wrap: 'truncate-end' }),
    ...live.map(card),
    archived.length > 0 && (
      <Box key="archived-toggle" marginTop={1}>
        <Button key="archived-toggle" plain={true} dimColor={true} label={isArchiveOpen ? `▾ Cacher les archivées` : `▸ Archivées (${archived.length})`} onPress={() => act.toggleArchived()} />
      </Box>
    ),
    ...(isArchiveOpen ? archived.map(card) : []),
  ]
}

/**
 * L'en-tête quand aucune mission n'est choisie dans cette discussion : aucune mission n'y est montrée.
 * Un worker qui travaille pour un groupe le dit : sa mission est suivie par le manager.
 */
const noRunHero = (k: Kit, board: Board): unknown => {
  // La mission peut manquer à ce board (session dans un worktree) : le titre relevé à la déclaration le remplace.
  const delegated = board.delegate ? delegatedTitle(board) : undefined
  return (
    <k.Box key="hero" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1}>
      {delegated
        ? T(k, `↗${NB}Worker de la mission « ${delegated} »`, { bold: true, color: C.blue })
        : T(k, `◇${NB}Aucune mission sélectionnée`, { bold: true })}
      {T(
        k,
        delegated
          ? 'Le manager suit cette mission : il rend les statuts des tickets à la fin de cette session.'
          : 'Reprends-en une depuis l’onglet Historique, ou lance un skill pour en démarrer une.',
        { dim: true, wrap: 'wrap' },
      )}
    </k.Box>
  )
}

const welcome = (k: Kit, board: Board | null): unknown => {
  const { Box } = k
  return (
    <Box flexDirection="column">
      <Box key="hello" flexDirection="column" borderStyle="round" borderColor={C.violet} paddingX={2} paddingY={1}>
        {T(k, `◆${NB}Tableau de bord du workflow`, { color: C.violet, bold: true })}
        {T(
          k,
          `Le suivi démarre au premier skill mattpocock lancé${board ? ` dans ${board.name}` : ''} : phases, étapes, tickets, spécialistes, tests et livrables, le tout en direct.`,
          { dim: true, wrap: 'wrap' },
        )}
      </Box>
    </Box>
  )
}

// ─── Panneau ──────────────────────────────────────────────────────────────

export const drawPane = (k: Kit, view: View, act: Actions): unknown => {
  const { Box } = k
  const board = view.board
  if (view.coo) return cooPane(k, view, view.coo, act)
  // Un worker dans un worktree a un board vide : il dit pour quelle mission il travaille, pas l'accueil.
  if (!board || (board.runs.length === 0 && !board.delegate)) {
    return (
      <Box flexDirection="column" paddingX={1} paddingBottom={1}>
        {welcome(k, board)}
        {tabsRow(k, view, null, act)}
        {view.ui.tab === 'commands' ? commandsTab(k, act) : view.ui.tab === 'agents' ? agentsTab(k, view, act) : [launcher(k, act), anytimeCard(k, act)]}
      </Box>
    )
  }
  // Sans mission en cours, la dernière touchée, hors archives : archiver la rafraîchit sans la remettre en avant.
  // Les tickets relayés par les workers comptent à l'affichage (jamais dans la mission enregistrée).
  const shown = (r: Run | null) => (r ? withRelay(r, view.relay) : null)
  const run = shown(activeRun(board) ?? [...board.runs].filter(r => r.archivedAt === undefined).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null)
  // L'en-tête ne montre que la mission choisie dans cette discussion (en cours, ou fini ici).
  const selected = shown(board.runs.find(r => r.id === board.activeId) ?? null)
  const tab = view.ui.tab
  const body: unknown[] =
    tab === 'commands'
      ? commandsTab(k, act)
      : tab === 'agents'
        ? agentsTab(k, view, act)
        : tab === 'history' || !run
          ? historyTab(k, board, view, act)
          : tab === 'activity'
            ? activityTab(k, run, view, act)
            : flowTab(k, run, view, act)
  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      {selected !== null ? hero(k, selected, view) : noRunHero(k, board)}
      {tabsRow(k, view, run, act)}
      {body}
    </Box>
  )
}

// ─── Bandeau au-dessus du prompt ──────────────────────────────────────────

const LABEL_CELLS = 5

/**
 * L'étiquette d'outil en tête de ligne, comme celles de git-board et asana-board : une barre,
 * une espace, le nom calé sur LABEL_CELLS. Avec un nom vide, la colonne reste vide sous la barre
 * (ligne 2) ; avec null, la barre seule.
 */
const bandTag = (k: Kit, label: string | null, color: string): unknown => (
  <k.Box flexDirection="row" flexShrink={0}>
    {T(k, '▍', { color, bold: true })}
    {label !== null && T(k, `${NB}${label.padEnd(LABEL_CELLS, NB)}`, { color, bold: true })}
  </k.Box>
)

/**
 * Le bandeau d'accueil, tant que la discussion n'a pas de mission active : une ligne qui le dit,
 * et, si le projet en a une en pause ou suivie ailleurs, la plus récente à reprendre. Un
 * worker dit à la place pour quelle mission il travaille : il est suivi par le manager.
 */
export const drawWelcomeBand = (k: Kit, view: View, act: Actions): unknown => {
  if (view.ui.isBandHidden || (view.board && activeRun(view.board))) return null
  const { Box, Button } = k
  const width = k.width
  const delegated = view.board?.delegate ? delegatedTitle(view.board) : undefined
  // Le siège du COO vu d'ici : tenu ici, ou demandé ici (`cooHere`) et tenu ailleurs ou libéré.
  const seat = view.board && !delegated ? seatState(view.board.coo, view.here ?? view.board.session, view.now) : 'free'
  const isCoo = seat === 'mine'
  const isCooAway = !isCoo && delegated === undefined && view.board?.cooHere !== undefined
  // La discussion du COO ne reprend pas de mission : pas de proposition de reprise.
  const latest = view.board && !delegated && !isCoo && !isCooAway ? [...resumable(view.board)].sort((x, y) => y.updatedAt - x.updatedAt)[0] : undefined
  const def = latest ? SKILLS[latest.entry] : undefined
  // Dans un worker : l'effort que le mod impose pendant un ticket sensible en cours, quand il change celui de la session.
  const effortPill = delegated !== undefined && view.workerEffort ? leadEffortPill(view.workerEffort, view.agents?.main?.effort) : null
  if (isCoo || isCooAway) {
    return (
      <Box key="flow-welcome" flexDirection="row" alignItems="center" justifyContent="space-between" width={width}>
        <Box flexShrink={1}>
          {line(k, [
            bandTag(k, 'Flow', C.violet),
            ...(isCoo && view.coo ? cooBandParts(view.coo, view.agents?.main?.effort).map(p => T(k, p.text, { ...(p.color ? { color: p.color } : {}), ...(p.bold ? { bold: true } : {}), ...(p.dim ? { dim: true } : {}) })) : [T(k, `◆${NB}COO`, { color: C.teal, bold: true })]),
            isCooAway && T(k, '·', { dim: true }),
            isCooAway && <Box flexShrink={1}>{T(k, seat === 'other' ? 'siège tenu par une autre discussion' : 'siège libre', { color: C.amber, wrap: 'truncate-end' })}</Box>,
            isCooAway && <Button key="band-coo-take" plain={true} label={`↻${NB}Reprendre${NB}ici`} onPress={() => act.cooTake()} />,
            isCooAway && <Button key="band-coo-leave" plain={true} dimColor={true} label="Laisser" onPress={() => act.cooLeave()} />,
          ])}
        </Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={1}>
          <Box marginRight={1}>
            <Button key="band-open" plain={true} dimColor={true} label="▸ Ouvrir" onPress={() => act.openPane()} />
          </Box>
          <Button key="band-hide" plain={true} dimColor={true} role="dismiss" label="x" onPress={() => act.hideBand()} />
        </Box>
      </Box>
    )
  }
  return (
    <Box key="flow-welcome" flexDirection="row" alignItems="center" justifyContent="space-between" width={width}>
      <Box flexShrink={1}>
        {line(k, [
          bandTag(k, 'Flow', C.violet),
          delegated !== undefined && T(k, `↗${NB}Worker`, { color: C.blue, bold: true }),
          delegated !== undefined && T(k, '·', { dim: true }),
          delegated !== undefined && <Box flexShrink={1}>{T(k, `« ${delegated} »`, { wrap: 'truncate-end' })}</Box>,
          effortPill !== null && T(k, '·', { dim: true }),
          effortPill !== null && T(k, effortPill.replace(/ /g, NB), { color: C.blue }),
          delegated === undefined && T(k, width < 40 ? 'Aucune mission' : `Aucune${NB}mission${NB}sélectionnée`, { dim: true }),
          latest && def && T(k, '·', { dim: true }),
          latest && def && T(k, def.glyph, { color: def.color, bold: true }),
          latest && def && width >= 56 && <Box flexShrink={1}>{T(k, latest.title, { wrap: 'truncate-end' })}</Box>,
          latest && def && <Button key="band-resume" plain={true} label={`↻${NB}Reprendre`} onPress={() => act.resume(latest.id)} />,
        ])}
      </Box>
      <Box flexDirection="row" flexShrink={0} marginLeft={1}>
        {delegated === undefined && (
          <Box marginRight={1}>
            <Button key="band-coo" plain={true} dimColor={true} label={`◆${NB}COO`} onPress={() => act.cooOpen()} />
          </Box>
        )}
        <Box marginRight={1}>
          <Button key="band-open" plain={true} dimColor={true} label="▸ Ouvrir" onPress={() => act.openPane()} />
        </Box>
        <Button key="band-hide" plain={true} dimColor={true} role="dismiss" label="x" onPress={() => act.hideBand()} />
      </Box>
    </Box>
  )
}

/** Une pastille du bandeau, avant son dessin : elle ne se coupe pas. */
type BandPill = Style & { text: string }

/** Dans le bandeau, l'avancement relayé de chaque groupe confié : « ↗A 2/4 ». */
const relayPills = (run: Run, view: View): BandPill[] =>
  (run.groups ?? [])
    .map(g => ({ g, relay: g.linked ? relayForGroup(view.relay, g, run.groups, g.linked, Infinity, attachedIdsOf(run, g)) : null }))
    // En cours dès que l'id de sa session est relevé, avant le premier signal relayé.
    .filter(x => x.relay !== null || x.g.linked?.session !== undefined)
    .map(({ g, relay }) => {
      // Les tickets que le plan lui rattache comptent aussi : la mission les tient, pas sa session.
      const { done, total } = groupProgress(run, g, relay)
      return { text: `↗${g.id}${NB}${done}/${total}`, color: relay?.endedAt !== undefined && done < total ? C.amber : C.blue, bold: true }
    })

/**
 * Dans le bandeau, le mode auto de la mission : « ⚡ Auto · en cours » quand il envoie d'ici, « ⚡ Auto ·
 * en attente de <tâche> » quand il n'attend plus qu'une tâche externe pas faite (`awaitedExternals`), « ⚡ Auto ·
 * attend ta réponse (N) » quand des questions bloquantes l'attendent,
 * « ⚡ Auto en pause : <raison> » quand il s'est arrêté sans un geste de la personne ni la fin de la
 * mission, ou que la pause se déduit (discussion changée) ; rien, éteint. À part des autres
 * pastilles : il se coupe quand la place manque et ne retire jamais le bouton de l'étape suivante.
 */
const autoPill = (run: Run, view: View): BandPill | null => {
  if (!view.board) return null
  const state = autoStateOf(run, view.board, view.here ?? view.board.session ?? '', view.autoConfirmedAt)
  const waiting = openQuestions(run).length
  if (state.kind === 'on' && view.planUnread && !view.coordUnread) return { text: `⚡${NB}Auto${NB}en${NB}pause${NB}:${NB}plan${NB}du${NB}projet${NB}illisible`, color: C.amber, bold: true }
  if (state.kind === 'on' && view.coordUnread) return { text: `⚡${NB}Auto${NB}en${NB}pause${NB}:${NB}fichier${NB}de${NB}coordination${NB}illisible`, color: C.amber, bold: true }
  if (state.kind === 'on' && waiting > 0) return { text: `⚡${NB}Auto${NB}·${NB}attend${NB}ta${NB}réponse${NB}(${waiting})`, color: C.amber, bold: true }
  // Une tâche externe que l'auto attend : son nom (relu de la mission, neutralisé), sans pause.
  const awaited = state.kind === 'on' ? awaitedExternals(run, false, outsideOf(view), view.security ?? 'unread') : []
  if (awaited.length > 0) {
    const first = awaited[0]!
    const name = clip(neutralLine(typeof first.name === 'string' && first.name !== '' ? first.name : first.id), 48).replace(/ /g, NB)
    return { text: `⚡${NB}Auto${NB}·${NB}en${NB}attente${NB}de${NB}${name}${awaited.length > 1 ? `${NB}(+${awaited.length - 1})` : ''}`, color: C.teal, bold: true }
  }
  if (state.kind === 'on') return { text: `⚡${NB}Auto${NB}·${NB}en${NB}cours`, color: C.teal, bold: true }
  if (state.kind === 'paused') return { text: `⚡${NB}Auto${NB}en${NB}pause${NB}:${NB}${state.why.replace(/ /g, NB)}`, color: C.amber, bold: true }
  return null
}

/** Les pastilles du bandeau après la phase : les tickets, les groupes dans des workers, les agents au travail, les choix à relire. */
const bandPills = (run: Run, view: View): BandPill[] => {
  const t = countTickets(run.tickets)
  const running = agentsAtWork(view)
  const unseen = unseenDecisions(run, view.relay)
  // L'effort que le mod impose à chaque requête du manager, et sa raison (règle des workers, suivi des groupes, phase), quand il joue.
  const effort = leadEffort(run)
  const pill = effort ? leadEffortPill(effort, view.agents?.main?.effort) : null
  return [
    ...(pill ? [{ text: pill.replace(/ /g, NB), color: C.blue }] : []),
    ...(t.total > 0 ? [{ text: `${t.done}/${t.total}`, bold: true }] : []),
    ...relayPills(run, view),
    // Retenu par une autre mission : ce qui attend, et quoi (titre neutralisé).
    ...(view.holds && view.holds.length > 0 ? [{ text: `⏸${NB}${heldText(view.holds[0]!)}${view.holds.length > 1 ? `${NB}(+${view.holds.length - 1})` : ''}`, color: C.amber }] : []),
    ...(running > 0 ? [{ text: `${spinFrame(view.now)}${NB}${plural(running, 'agent')}`, color: C.blue }] : []),
    ...(unseen > 0 ? [{ text: `⚑${NB}${unseen}${NB}à${NB}relire`, color: C.amber, bold: true }] : []),
  ]
}

/**
 * Ce que le bandeau garde au moins : l'étiquette, le glyphe et la phase à gauche, « ▸ Ouvrir » et
 * « x » à droite. Le bouton de l'étape suivante ne vient qu'au-delà, et après les pastilles.
 */
const BAND_KEEP = 40

/** Largeur estimée d'un texte du bandeau, en cellules : « ⚑ » et « ⚡ » en prennent deux sur certains terminaux. */
const bandCells = (text: string): number => [...text].reduce((n, ch) => n + (ch === '⚑' || ch === '⚡' ? 2 : 1), 0)

/** La place du bouton de l'étape suivante au bandeau : son libellé, ses crochets de bouton principal au terminal, sa marge. */
const leadCells = (b: NextButton): number => bandCells(b.label) + 4 + 1

export const drawBand = (k: Kit, view: View, act: Actions): unknown => {
  const stored = activeRun(view.board)
  if (!stored || view.ui.isBandHidden) return null
  const run = withRelay(stored, view.relay)
  const { Box, Button } = k
  const width = k.width
  const def = SKILLS[run.entry]!
  const { skill } = focusOf(run)
  const nodes = roadNodes(run)
  const pills = bandPills(run, view)
  // Le mode auto se coupe plutôt que de prendre la place du bouton : il ne compte pas dans `room`.
  const auto = autoPill(run, view)
  // Le bouton de l'étape suivante, celui de la carte « Ensuite » : la frise et le titre tombent avant
  // lui ; lui ne vient que si les pastilles, qui ne se coupent pas, gardent leur place. La place se
  // compte dès qu'il y a un bouton, même trop large pour venir : la frise ne passe jamais devant lui.
  const found = nextStepOf(run, view, act)?.lead ?? null
  const pillCells = pills.reduce((n, p) => n + bandCells(p.text) + 1, 0)
  const room = found === null ? 0 : leadCells(found) + pillCells
  const lead = found !== null && width >= BAND_KEEP + room ? found : null
  const mini =
    width < 64 + room
      ? null
      : k.isRich
        ? svgOf(k, miniRoadSvg(nodes), nodes.map(x => `${x.label} : ${STATE_WORD[x.state]}`).join(', '), true)
        : line(
            k,
            nodes.map(x => T(k, x.state === 'done' ? '●' : x.state === 'active' ? '◉' : x.state === 'next' ? '◎' : x.state === 'skipped' ? '·' : '○', {
              color: x.state === 'pending' || x.state === 'skipped' ? C.gray : x.color,
              bold: x.state === 'active',
            })),
          )
  // Une seule ligne, l'essentiel : la mission, sa phase, les tickets, les groupes dans des
  // workers, ce qui attend la personne. L'état de la session et le détail des tickets sont dans /flow.
  return (
    <Box key="flow-band" flexDirection="row" alignItems="center" justifyContent="space-between" width={width}>
      <Box flexShrink={1}>
        {line(k, [
          bandTag(k, 'Flow', C.violet),
          T(k, def.glyph, { color: def.color, bold: true }),
          width >= 90 + room && <Box flexShrink={1}>{T(k, run.title, { bold: true, wrap: 'truncate-end' })}</Box>,
          mini,
          <Box flexShrink={1}>{T(k, `${skill.glyph}${NB}${skill.label}`, { color: skill.color, bold: true, wrap: 'truncate-end' })}</Box>,
          auto !== null && <Box flexShrink={1}>{T(k, auto.text, { ...auto, wrap: 'truncate-end' })}</Box>,
          ...pills.map(p => T(k, p.text, p)),
        ])}
      </Box>
      <Box flexDirection="row" flexShrink={0} marginLeft={1}>
        {lead !== null && <Box marginRight={1}>{nextButton(k, { ...lead, isPrimary: true })}</Box>}
        <Box marginRight={1}>
          <Button key="band-open" plain={true} dimColor={true} label="▸ Ouvrir" onPress={() => act.openPane()} />
        </Box>
        <Button key="band-hide" plain={true} dimColor={true} role="dismiss" label="x" onPress={() => act.hideBand()} />
      </Box>
    </Box>
  )
}
