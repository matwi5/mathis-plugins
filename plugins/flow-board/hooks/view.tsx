// Dessin du tableau de bord : le panneau à onglets (Parcours, Activité, Historique) et le
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
  relayForGroup,
  withRelay,
  type GroupRelay,
  activeDetour,
  activeRun,
  asanaUrl,
  blockedCount,
  externalOf,
  commandText,
  countTickets,
  currentPhase,
  delegatedTitle,
  doingOf,
  linkedInFlight,
  pickableItems,
  focusOf,
  groupPlan,
  resumable,
  type GroupPlan,
  type GroupView,
  isPickable,
  hasUnreadableCounts,
  isSecuritySettled,
  isTicketReviewEnough,
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
  inForce,
  isDelegable,
  groupReviewArgs,
  hasGroupReview,
  isPhaseOptional,
  type SyncStep,
} from './model.ts'
import { MAIN, reviewForkName, runningOf } from './registry.ts'
import type { LinkedSession, LinkedState } from './linked.ts'
import type { HistoryEntry } from './history.ts'
import { forgetCount, forgetText } from './erase.ts'
import { suggestsCompaction } from './compaction.ts'
import { isSureLink } from './linked.ts'
import { reopenText, type ReopenText } from './closing.ts'
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
  /** L'avancement relayé par les sessions liées du parcours actif. */
  relay?: Relay | null
  /** Le registre des sous-agents de cette session (onglet Agents). */
  agents?: SessionRegistry | null
  /** Le suivi en défaut (S11, R2) : `true`, une écriture du registre refusée ; `'lost'`, un changement perdu. */
  agentsAlert?: boolean | 'lost'
  /** Les effacements que cette discussion fait en ce moment (R1, S36) : `run:<id>` ou `session:<id>`, et leur titre. */
  erasing?: readonly { key: string; title: string }[]
  /** Les prix des modèles tirés de ccusage (Q15) ; null tant qu'ils manquent : « coût indisponible ». */
  agentPrices?: Readonly<Record<string, UnitPrices>> | null
  /** Les sessions liées de cette discussion (onglet Agents), avec leur registre quand il se lit. */
  linked?: readonly { session: LinkedSession; reg: SessionRegistry | null }[]
  /**
   * Le sélecteur d'historique de l'onglet Agents, et la vue de l'entrée choisie (un parcours passé,
   * une ancienne discussion) quand elle est lue.
   */
  history?: { entries: readonly HistoryEntry[]; shown: { key: string; title: string; self: SessionRegistry; linked: readonly { session: LinkedSession; reg: SessionRegistry | null }[] } | null }
}

export type Actions = {
  setTab: (tab: Tab) => unknown
  /** Lance la commande du skill (la suite du parcours). */
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
  /** Met de côté le parcours actif ici, sans le clore : la discussion peut en ouvrir un autre. */
  setAside: () => unknown
  resume: (id: string) => unknown
  drop: (id: string) => unknown
  /** Range un parcours aux archives. */
  archive: (id: string) => unknown
  /** Sort un parcours des archives. */
  unarchive: (id: string) => unknown
  /** Montre ou cache les parcours archivés dans l'historique. */
  toggleArchived: () => unknown
  toggleTickets: () => unknown
  /** Ajoute un ticket à la sélection, ou l'en retire. */
  pick: (id: string) => unknown
  clearPicks: () => unknown
  /** Lance la sélection : /implement, dans l'ordre choisi. */
  launchPicks: () => unknown
  /** Lot sans groupe : /implement sur tous ses tickets ouverts, dans l'ordre du lot. */
  launchAll: () => unknown
  /** Confie un groupe prêt à une session liée ; le parcours reste dans cette discussion. */
  launchGroupLinked: (id: string) => unknown
  /** La même session liée, en xhigh imposé ; `surface` : celle de l'appui (l'app y plafonne l'effort). */
  launchGroupLinkedXhigh: (id: string, surface?: string) => unknown
  /** Annule l'envoi d'un groupe à une session liée qui n'a pas été lancée. */
  cancelGroupLinked: (id: string) => unknown
  /** Fait faire par sa session liée la revue d'un groupe rendu sans revue. */
  reviewLinkedGroup: (id: string) => unknown
  /** Demande à Claude de fermer la session liée et le worktree d'un groupe rendu. */
  closeLinkedGroup: (id: string) => unknown
  closeLinkedItems: () => unknown
  /** Demande à Claude la revue de sécurité d'un groupe (ou du lot, `lot`) par un sous-agent relecteur. */
  securityReview: (id: string) => unknown
  /** Demande à Claude un diagnostic de bug dans une session liée, en détour de la phase en cours. */
  launchBugLinked: () => unknown
  /** Ajoute un élément de la phase (une piste de rétro) à la sélection, ou l'en retire. */
  pickItem: (id: string) => unknown
  /** Choisit tous les éléments encore à découper, ou les retire tous s'ils l'étaient déjà. */
  pickAllItems: () => unknown
  clearItemPicks: () => unknown
  /** Met dans le prompt la demande de découpage en tickets des éléments choisis, sans rien enregistrer. */
  splitItems: () => unknown
  /** Annule un envoi à une session liée qui n'a pas été lancée. */
  cancelLinked: () => unknown
  /** Demande à Claude de vérifier la session liée et de rendre ses éléments (session arrêtée sans note, ou jamais lancée). */
  recoverLinked: () => unknown
  /** Remet dans le prompt la demande de lancement des éléments qu'aucune session n'a pris. */
  relaunchLinked: () => unknown
  /** Demande (ou retire) la confirmation de suppression d'un parcours archivé. */
  askDrop: (id: string) => unknown
  /** /ask-matt dans le prompt, prérempli avec l'endroit du parcours où l'on est. */
  askNext: () => unknown
  /** Confie chaque groupe d'un lot à sa session liée (0 : le lot principal, puis les autres lots). */
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
  /** Onglet Agents : la fenêtre de vue de la frise (zoom, déplacement) ; null, tout. */
  setAgentsWindow: (win: AgentsWindow | null) => unknown
  /** Onglet Agents : montre la frise d'une session liée (sa clé), ou celle de l'orchestrateur (null). */
  selectAgentsSession: (key: string | null) => unknown
  /** Onglet Agents : déplie ou replie le sélecteur d'historique. */
  toggleAgentsHistory: () => unknown
  /** Onglet Agents : montre une entrée de l'historique (`now`, `run:<id>`, `session:<id>`). */
  chooseAgentsHistory: (key: string) => unknown
  /** Historique : ouvre l'onglet Agents sur un parcours. */
  openAgentsOf: (runId: string) => unknown
  /** Onglet Agents : demande (ou retire) la confirmation d'« Oublier » une discussion (`session:<id>`). */
  askForget: (key: string) => unknown
  /** Onglet Agents : oublie une discussion et ses sessions liées sûres (S2, S15). */
  forget: (sessionId: string) => unknown
  /** Onglet Agents : ouvre ou referme la carte de détail d'une piste. */
  toggleAgentCard: (key: string) => unknown
  /** Carte de détail : déplie ou replie le prompt. */
  togglePrompt: () => unknown
  /** Onglet Agents : déplie ou replie la légende détaillée. */
  toggleLegend: () => unknown
  /** Frise : déplie ou replie la piste d'un Workflow. */
  toggleWorkflow: (id: string) => unknown
  /** Carte de détail : ouvre la transcription d'un sous-agent de cette discussion. */
  openAgentTranscript: (agentId: string) => unknown
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

/** Les stations : les phases, ou les étapes quand le parcours n'a qu'une phase. */
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
  // Des éléments chez une session liée lancée : c'est elle qui travaille, pas la personne.
  const phase = currentPhase(run)
  const isGroupBusy = (run.groups ?? []).some(g => g.linked?.session !== undefined && relayForGroup(view.relay, g)?.endedAt === undefined)
  const isLinkedBusy = (phase.linked?.session !== undefined && linkedInFlight(phase).length > 0) || isGroupBusy
  const mode = live.mode === 'waiting' && running > 0 ? 'agents' : isLinkedBusy && live.mode !== 'working' ? 'linked' : live.mode
  const look =
    mode === 'working'
      ? { color: C.tangerine, text: 'Claude travaille', isLive: true }
      : mode === 'linked'
        ? { color: C.blue, text: 'Session liée au travail', isLive: true }
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

/** Les éléments d'une phase qui peut en demander le découpage en tickets (les pistes d'une rétro), et l'ancien envoi à une session liée qu'elle suit. */
type Linkable = { phase: FlowPhase; view: View; act: Actions }

/**
 * Où en est l'envoi à la session liée : à lancer, ou pas lancée après un tour de Claude (avec
 * « Redemander » et « Annuler » dans les deux cas), au travail, ou terminée.
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
        {line(k, [T(k, `✓${NB}Session${NB}liée${NB}terminée`, { color: C.green, bold: true }), T(k, `fermer d'abord la session précédente avant un nouveau découpage`, { dim: true, wrap: 'wrap' })], true)}
        {closingRow(k, 'items', linked.closing, () => l.act.closeLinkedItems())}
      </Box>
    )
  }
  const parts =
    inFlight === 0
      ? [
          T(k, `✓${NB}Session${NB}liée${NB}terminée`, { color: C.green, bold: true }),
          T(k, `${label}${NB}:${NB}${total}/${total}`, { dim: true }),
          linked.closing?.state === 'closed' && T(k, `✕${NB}session et worktree fermés`, { dim: true }),
        ]
      : linked.session !== undefined
        ? [
            T(k, `↗${NB}Session${NB}liée${NB}au${NB}travail`, { color: C.blue, bold: true }),
            // Les éléments ne bougent qu'à la note de fin : un compteur à 0 ferait croire la session bloquée.
            T(k, `${plural(inFlight, label.replace(/s$/, ''), label)}${NB}en${NB}cours`, { dim: true }),
            T(k, dur(l.view.now - linked.at), { dim: true }),
          ]
        : linked.missedAt !== undefined
          ? [
              T(k, `⚠${NB}Aucun${NB}lancement${NB}relevé`, { color: C.amber, bold: true }),
              T(k, `${plural(inFlight, label.replace(/s$/, ''), label)} en attente : Claude a rendu la main sans lancer de session. S'il te pose une question, réponds-lui ; sinon redemande, ou annule pour les remettre au choix.`, { dim: true, wrap: 'wrap' }),
            ]
          : [T(k, `↗${NB}Session${NB}liée${NB}à${NB}lancer`, { color: C.amber, bold: true }), T(k, `${plural(inFlight, label.replace(/s$/, ''), label)} en attente : envoie la demande à Claude, qui lance la session (plus dans le prompt : « Redemander »)`, { dim: true, wrap: 'wrap' })]
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
  const pickable = linkable ? pickableItems(linkable.phase).map(i => i.id) : []
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
                dim: item.status === 'done' || item.status === 'dropped',
                strike: item.status === 'dropped',
              })}
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

/** Un ticket tel que sa session liée le relaie, tant que le groupe n'est pas rendu. */
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
  // Le statut relayé par la session liée prime à l'affichage, jamais dans le parcours.
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

/** Où en est la session liée d'un groupe : à lancer, au travail, ou terminée avec des tickets ouverts (ambre). */
const linkLabel = (k: Kit, link: NonNullable<TicketGroup['linked']>, relay: GroupRelay | null, open: number, now: number): unknown =>
  link.session === undefined
    ? T(k, `↗${NB}session liée à lancer`, { color: C.blue, bold: true })
    : relay?.endedAt !== undefined
      ? open > 0
        ? T(k, `↗${NB}session terminée il y a ${dur(now - relay.endedAt)}`, { color: C.amber, bold: true })
        : T(k, `↗${NB}session terminée · à rendre`, { color: C.blue, bold: true })
      : T(k, `↗${NB}en cours · session liée`, { color: C.blue, bold: true })

/** En-tête d'un groupe : où il en est, avec qui il peut avancer, ce qu'il attend, sa session liée. */
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
      g.state === 'waiting' && waits.length > 0 ? T(k, `⏸${NB}attend ${waits.join(', ')}`, { color: C.amber }) : null,
      g.isCyclic ? T(k, `⚠${NB}ordre à revoir`, { color: C.red }) : null,
      g.isDelegated && link ? linkLabel(k, link, relayForGroup(view.relay, g.group), g.open.length, view.now) : null,
      g.isDelegated && link?.session === undefined ? (
        <Button key={`group-linked-cancel-${g.group.id}`} plain={true} dimColor={true} label="Annuler" onPress={() => act.cancelGroupLinked(g.group.id)} />
      ) : null,
      isDelegable(g) ? <Button key={`launch-linked-${g.group.id}`} variant="primary" label={`↗${NB}Session${NB}liée`} onPress={() => act.launchGroupLinked(g.group.id)} /> : null,
      isDelegable(g) ? xhighButton(k, `launch-xhigh-${g.group.id}`, g.group.id, act) : null,
    ],
    true,
  )
}

/** Un bouton avant son dessin : la carte « Ensuite » le dessine, le bandeau reprend tel quel le bouton de l'étape suivante. */
type NextButton = { key: string; label: string; onPress: (press?: { surface?: string }) => unknown; isPrimary?: true; isQuiet?: true }

const nextButton = (k: Kit, b: NextButton): unknown =>
  b.isQuiet ? <k.Button key={b.key} plain={true} dimColor={true} label={b.label} onPress={b.onPress} /> : <k.Button key={b.key} {...(b.isPrimary ? { variant: 'primary' } : {})} label={b.label} onPress={b.onPress} />

/** « ↗ xhigh », discret après « ↗ Session liée » : le même groupe, en xhigh imposé ; l'appui donne sa surface. */
const xhighOf = (key: string, id: string, act: Actions): NextButton => ({
  key,
  isQuiet: true,
  label: `↗${NB}xhigh`,
  onPress: press => act.launchGroupLinkedXhigh(id, press?.surface),
})
const xhighButton = (k: Kit, key: string, id: string, act: Actions): unknown => nextButton(k, xhighOf(key, id, act))

/** Un lot parallèle : une session liée par groupe. */
const lotRow = (k: Kit, ids: readonly string[], at: number, act: Actions): unknown => {
  const { Box, Button } = k
  const suffix = at === 0 ? '' : `-${at}`
  const lot = ids.join(' ∥ ')
  return (
    <Box key={`lot${suffix}`} flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={at === 0 ? 1 : 0}>
      <Box marginRight={1}>
        <Button key={`launch-parallel-linked${suffix}`} label={`⇉${NB}${lot} en parallèle · sessions liées`} onPress={() => act.launchParallelLinked(at)} />
      </Box>
      {at === 0 && T(k, 'une session liée par groupe', { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

/**
 * La revue de sécurité d'un groupe fini, ou du lot entier quand le parcours n'a pas de groupes,
 * facultative : l'avis de Claude une fois la revue faite (il la lance lui-même quand il la juge
 * utile), puis son résultat. Rien tant que Claude n'a pas donné d'avis (groupes d'avant la 0.23.0
 * compris). Le bouton la lui demande quand il ne l'a pas lancée. `id` : le groupe, ou « lot ».
 */
const securityRow = (k: Kit, sec: SecurityCheck | undefined, id: string, act: Actions): unknown => {
  const { Box, Button } = k
  const group = { id }
  if (!sec) return null
  if (sec.ranAt !== undefined) {
    const counts = hasUnreadableCounts(sec)
      ? ` · comptes relus hors forme (—), à renvoyer`
      : sec.findings !== undefined
        ? ` · ${plural(sec.findings, 'constat')}${(sec.fixed ?? 0) > 0 ? ` · ${sec.fixed} corrigé${sec.fixed! > 1 ? 's' : ''}` : ''}${(sec.dismissed ?? 0) > 0 ? ` · ${sec.dismissed} laissée${sec.dismissed! > 1 ? 's' : ''}` : ''}${(sec.proposedDismissed ?? 0) > 0 && !isSecuritySettled(sec) ? ` · ${sec.proposedDismissed} à laisser, proposé${sec.proposedDismissed! > 1 ? 'es' : 'e'} par la session` : ''}`
        : ''
    const isOpen = !isSecuritySettled(sec)
    return <Box key={`sec-${group.id}`} marginLeft={2}>{T(k, `⛨${NB}sécurité relue${counts}`, { color: isOpen ? C.amber : C.green })}</Box>
  }
  if (sec.isAdvised === undefined) return null
  const launch = (
    <Button
      key={`security-group-${group.id}`}
      label={sec.isAdvised ? `⛨${NB}Revue de sécurité · sous-agent relecteur` : `⛨${NB}La lancer quand même`}
      onPress={() => act.securityReview(group.id)}
    />
  )
  return (
    <Box key={`sec-${group.id}`} flexDirection="row" flexWrap="wrap" alignItems="center" marginLeft={2}>
      {sec.isAdvised && <Box marginRight={1}>{launch}</Box>}
      <Box marginRight={1} flexShrink={1}>
        {T(k, `${sec.isAdvised ? 'conseillée' : `⛨${NB}sécurité jugée inutile`}${sec.why ? ` : ${sec.why}` : ''}`, { color: sec.isAdvised ? C.amber : undefined, dim: !sec.isAdvised, wrap: 'wrap' })}
      </Box>
      {!sec.isAdvised && launch}
    </Box>
  )
}

/** « ↺ Rouvrir » d'une session fermée, quand la commande (pour l'app, celle qui recrée son worktree) a pu s'écrire. */
const reopenButton = (k: Kit, id: string, reopen: ReopenText | null | undefined, act: Actions | undefined): unknown => {
  const { Button } = k
  if (!reopen || !act) return null
  return <Button key={`reopen-${id}`} plain={true} dimColor={true} label={`↺${NB}Rouvrir`} onPress={(press?: { surface?: string }) => act.reopenSession(reopen, press?.surface)} />
}

/**
 * Où en est la fermeture d'une session liée rendue : rien tant que rien n'a été tenté (elle part
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
  if (closing.state === 'app') return <Box key={`close-row-${id}`}>{T(k, `⧗${NB}à archiver dans l'app${closing.why ? ` : ${closing.why}` : ''}`, { color: C.amber, wrap: 'wrap' })}</Box>
  return (
    <Box key={`close-row-${id}`} flexDirection="row" flexWrap="wrap" alignItems="center">
      <Box marginRight={1} flexShrink={1}>
        {T(k, `!${NB}fermeture arrêtée${closing.why ? ` : ${closing.why}` : ''}`, { color: C.amber, wrap: 'wrap' })}
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
    const relay = g.isDelegated ? relayForGroup(view.relay, g.group) : null
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
              // Aucun ticket sensible ni avec logique : les revues des tickets suffisent, sans revue de sécurité.
              T(k, `✓${NB}revu par ${g.group.tickets.length > 1 ? 'ses tickets' : 'son ticket'}`, { color: C.green, bold: true })
            ) : g.group.delegated !== undefined ? (
              // Fait par une session liée : ici la branche est fusionnée, la revue se fait là-bas.
              <Button key={`review-linked-${g.group.id}`} variant="primary" label={`◆${NB}Revue du groupe · session liée`} onPress={() => act.reviewLinkedGroup(g.group.id)} />
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
        {!g.isFallback && securityRow(k, g.group.security, g.group.id, act)}
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
        T(k, `↗${NB}${plan.delegated.join(', ')} en session liée : son avancement (tickets d'après Asana, commits, tests) s'affiche sur le groupe, marqué ↗. Claude vérifie le travail à sa note de fin, puis rend les statuts ici.`, { dim: true, wrap: 'wrap' })}
      {isNewHere &&
        T(k, `↗${NB}« Session liée » : Claude lance une session qui fait le groupe, et le parcours reste ici. « ↗ xhigh » : la même session, lancée en xhigh, sans question sur l'effort, pour un groupe qui demande du jugement.`, { dim: true, wrap: 'wrap' })}
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
  const rows = [...unseen].reverse().concat(isOpen ? [...seen].reverse() : [])
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
            <Box flexShrink={1}>{T(k, d.relayedFrom !== undefined ? `${d.what} (↗${NB}Groupe${NB}${d.relayedFrom})` : d.what, { wrap: 'wrap', dim: d.seenAt !== undefined })}</Box>
          </Box>
          {d.why !== undefined && <Box paddingLeft={4}>{T(k, `car : ${d.why}`, { dim: true, wrap: 'wrap' })}</Box>}
        </Box>
      ))}
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
  const plan = groupPlan(run)
  const hint = plan ? 'Lance un groupe en session liée (↗), ou choisis les tickets (○) dans l’ordre voulu.' : 'Choisis les tickets à traiter (○), dans l’ordre voulu.'
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
 * tickets peuvent avancer en même temps (sessions liées).
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
  // Implémentation : les groupes partent en parallèle ou en sessions liées, le suivi ticket par
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
      {(run.groups ?? []).length === 0 && securityRow(k, run.security, 'lot', act)}
      {detour !== null && detourCard(k, detour, view, act)}
    </Box>
  )
}

// ─── Sous-agents ──────────────────────────────────────────────────────────

/** Ce que dit l'état d'un sous-agent, et sa couleur. */
const AGENT_STATE: Record<AgentStatus, { word: string; color: string }> = {
  running: { word: `au${NB}travail`, color: C.blue },
  done: { word: 'fini', color: C.green },
  failed: { word: 'échoué', color: C.red },
  cancelled: { word: 'annulé', color: C.gray },
}

/** Les sous-agents de la session au travail : l'onglet, le bandeau et la pastille d'état les comptent. */
const agentsAtWork = (view: View): number => runningOf(view.agents ?? null).length

/** La couleur de la piste de l'orchestrateur ; celle d'un sous-agent est celle de son type (AGENT_TYPE). */
const ORCHESTRATOR_COLOR = C.violet

/** Le glyphe d'une famille d'outils dans le SVG ; le terminal a les siens (cells.ts). */
const FAMILY_GLYPH: Record<ToolFamily, string> = { read: '⌕', edit: '✎', run: '❯', web: '🌐', agent: '⇢', other: '•' }

/** Le nom de chaque sorte de segment, le même dans la légende et le texte `alt` des pistes. */
const SEGMENT_WORD: Record<SegmentKind, string> = {
  think: 'réflexion',
  write: 'rédaction',
  tool: 'outil',
  waitAgent: 'attend un sous-agent',
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
  /** La piste d'une session liée, dans la frise de l'orchestrateur : son bouton ouvre sa frise. */
  linked?: LinkedSession
  /** Sous le nom d'une piste sans sous-agent : « cette discussion » par défaut. */
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
 * Les 9 types de sous-agents (Q9) : libellé, glyphe et couleur, distincte et lisible en thème clair
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

const FAMILY_WORD: Record<ToolFamily, string> = { read: 'lecture', edit: 'modification', run: 'commande', web: 'web', agent: 'sous-agents', other: 'autres outils' }

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
 * coût et de la somme avec ses sous-agents ; null quand il ne l'a pas consulté.
 */
const advisorOfCaller = (calls: readonly AdvisorCall[], by: string, view: View): string | null => {
  const own = calls.filter(c => c.by === by)
  if (own.length === 0) return null
  const sum = advisorCostOf(own, view.agentPrices ?? {})
  return sum.tokens || sum.isUnknown ? `${plural(own.length, 'appel')}, ${advisorCostText(sum)}` : plural(own.length, 'appel')
}

/**
 * La carte de la ligne advisor : le nombre d'appels, puis chacun avec son heure, sa durée et qui
 * l'a fait : l'orchestrateur de la frise, ou le sous-agent nommé, cherché parmi tous les
 * sous-agents de la session (ceux d'un Workflow replié n'ont pas de piste).
 */
const advisorCard = (k: Kit, l: FriseLane, lanes: readonly FriseLane[], agents: readonly RegistryAgent[], view: View): unknown => {
  const { Box } = k
  const advisor = l.advisor!
  const callerOf = (by: string): string => (by === MAIN ? (lanes[0]?.name ?? 'Orchestrateur') : (lanes.find(x => x.agent?.agentId === by)?.name ?? agents.find(a => a.agentId === by)?.name ?? by))
  const shown = advisor.calls.slice(-ADVISOR_CALLS_SHOWN)
  const sum = advisorCostOf(advisor.calls, view.agentPrices ?? {})
  const t = sum.tokens
  return (
    <Box key={`card-${l.key}`} flexDirection="column" borderStyle="round" borderColor={l.color} paddingX={1} marginBottom={1}>
      {line(k, [T(k, `✦${NB}${ADVISOR_NAME}`, { color: l.color, bold: true }), T(k, 'un modèle relecteur consulté par la discussion et ses sous-agents', { dim: true, wrap: 'truncate-end' })], true)}
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
 * sous-agent de cette discussion.
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
  // Lancé par son parent, sinon par la session de la frise (l'orchestrateur, ou la session liée choisie).
  const parent = a?.parent !== undefined ? lanes.find(x => x.agent?.agentId === a.parent)?.name ?? a.parent : (lanes[0]?.name ?? 'Orchestrateur')
  const models = [...new Set([...(a?.model !== undefined ? [a.model] : []), ...(lane.models ?? [])].map(shortModel))]
  const prompt = a?.prompt ?? ''
  const promptLines = prompt.split('\n')
  const isPromptOpen = view.ui.isPromptOpen === true
  // Un sous-agent qui en a lancé d'autres : son coût et ses tokens avec ceux de ses descendants.
  const agents = lanes.map(x => x.agent).filter((x): x is RegistryAgent => x !== undefined)
  const sum = a ? familyOf(a, agents, m => agentCost(m, m, view)) : null
  const family = sum && sum.descendants > 0 ? sum : null
  // Ses appels à l'advisor, chiffrés à part : jamais dans son coût ni dans celui de sa famille.
  const caller = a?.agentId ?? (l.key === MAIN ? MAIN : undefined)
  const advisorCalls = lanes.find(x => x.advisor)?.advisor?.calls ?? []
  const advised = caller !== undefined ? advisorOfCaller(advisorCalls, caller, view) : null
  return (
    <Box key={`card-${l.key}`} flexDirection="column" borderStyle="round" borderColor={l.color} paddingX={1} marginBottom={1}>
      {line(k, [type ? T(k, `${type.glyph}${NB}${type.label}`, { color: type.color, bold: true }) : T(k, l.caption !== undefined ? `↗${NB}Session${NB}liée` : `◆${NB}Orchestrateur`, { color: l.color, bold: true }), T(k, l.name, { bold: true, wrap: 'truncate-end' })], true)}
      {models.length > 0 && cardLine(k, 'Modèles', models.join(' · '))}
      {lane.effort !== undefined && cardLine(k, 'Effort', lane.effort)}
      {a && l.name !== a.name && cardLine(k, 'Commande', a.name)}
      {a && cardLine(k, 'Lancé par', parent)}
      {a && cardLine(k, 'Période', `${clockText(a.startedAt)}${a.finishedAt !== undefined ? ` → ${clockText(a.finishedAt)}` : ' → en cours'}${a.isEndUnseen === true ? ' (fin constatée après coup)' : ` · ${dur((a.finishedAt ?? now) - a.startedAt)}`}`)}
      {t && cardLine(k, 'Coût', agentCost(l.lane, a, view) !== null ? costText(agentCost(l.lane, a, view)!) : 'coût indisponible')}
      {t && cardLine(k, 'Tokens', `entrée ${tokensText(t.input)} · sortie ${tokensText(t.output)} · cache lu ${tokensText(t.cacheRead)} · cache écrit ${tokensText(t.cacheWrite)} · réflexion non comptée à part`)}
      {advised !== null && cardLine(k, `✦${NB}Advisor`, advised)}
      {family && cardLine(k, 'Avec ses sous-agents', `${family.cost !== null ? costText(family.cost) : 'coût indisponible'} · ${plural(family.descendants, 'sous-agent')}${family.tokens ? ` · entrée ${tokensText(family.tokens.input)} · sortie ${tokensText(family.tokens.output)} · cache lu ${tokensText(family.tokens.cacheRead)} · cache écrit ${tokensText(family.tokens.cacheWrite)}` : ''}`)}
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
 * L'effort demandé aux requêtes d'une session liée ou d'un sous-agent, sous son nom (jamais pour
 * l'orchestrateur) ; rien quand il n'est pas relevé.
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
          {line(k, [T(k, look.word, { color: look.color, dim: ls.state === 'closed' }), T(k, `session${NB}liée`, { dim: true }), effortText(k, l.lane.effort)], true)}
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

/** Dans l'onglet Parcours, une ligne de résumé à la place de l'ancien encadré : elle mène à l'onglet Agents. */
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
  { mark: { k: 'fail', at: 0 }, word: 'échec d’un outil ou d’un sous-agent' },
  { mark: { k: 'stop', at: 0 }, word: 'interrompu ou annulé' },
  { mark: { k: 'relay', at: 0 }, word: 'départ d’un sous-agent ou d’une session liée (relais)' },
  { mark: { k: 'back', at: 0 }, word: 'retour de son rapport' },
  { mark: { k: 'compact', at: 0 }, word: 'compaction du contexte' },
  { mark: { k: 'msg', at: 0 }, word: 'message d’une autre session (orchestrateur)' },
  { mark: { k: 'commit', at: 0 }, word: 'commit (orchestrateur)' },
  { mark: { k: 'test', at: 0, ok: true }, word: 'tests au vert (orchestrateur)' },
  { mark: { k: 'test', at: 0, ok: false }, word: 'tests en échec (orchestrateur)' },
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
        legendItem(k, '◆', 'Orchestrateur', ORCHESTRATOR_COLOR),
        legendItem(k, '✦', `${ADVISOR_NAME} : le modèle relecteur que la discussion et ses sous-agents consultent ; une barre cerclée par appel, vue à la fin de l’étape qui l’a fait`, ADVISOR_COLOR),
        legendItem(k, '↗', 'Session liée', LINKED_COLOR),
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
 * Les repères que la piste d'un sous-agent porte d'elle-même : son départ et son retour (les
 * points du relais, en face de ceux du lanceur), son échec ou son annulation à sa fin.
 */
const ownMarks = (a: RegistryAgent): AgentMark[] => {
  const marks: AgentMark[] = [{ k: 'relay', at: a.startedAt }]
  if (a.finishedAt === undefined || a.isEndUnseen === true || a.status === 'running') return marks
  return [...marks, { k: a.status === 'failed' ? 'fail' : a.status === 'cancelled' ? 'stop' : 'back', at: a.finishedAt }]
}

/** L'état d'une session liée (pastille, piste) : glyphe, mot, couleur. */
const LINKED_STATE: Record<LinkedState, { glyph: string; word: string; color: string }> = {
  working: { glyph: '◉', word: `au${NB}travail`, color: C.blue },
  returned: { glyph: '✓', word: 'rendue', color: C.green },
  failed: { glyph: '✗', word: 'échouée', color: C.red },
  closed: { glyph: '○', word: 'fermée', color: C.gray },
}

/** La couleur des pistes des sessions liées dans la frise de l'orchestrateur : mauve, loin du violet de l'orchestrateur (planche `teintes.*`). */
const LINKED_COLOR = C.mauve

/**
 * Une session liée qui ne travaille plus ne s'allonge plus : ses segments restés ouverts (session
 * arrêtée en plein outil) se ferment à son retour, sinon à sa dernière écriture.
 */
const settledLane = (lane: AgentLane, ls: LinkedSession, reg: SessionRegistry | null): AgentLane => {
  const end = ls.returnedAt ?? reg?.updatedAt
  if (ls.state === 'working' || end === undefined || !(lane.segments ?? []).some(x => x.e === undefined)) return lane
  return { ...lane, segments: (lane.segments ?? []).map(x => (x.e === undefined ? { ...x, e: Math.max(x.s, end) } : x)) }
}

/**
 * Le sélecteur d'historique en tête de l'onglet (Q12) : un bouton dit l'entrée montrée ; déplié, il
 * liste « Ici, maintenant », les parcours (archivés compris), puis les discussions sans parcours qui
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
          {runs.length > 0 && T(k, 'Parcours', { color: C.slate, bold: true })}
          {runs.map(entry)}
          {discussions.length > 0 && T(k, `Discussions${NB}sans${NB}parcours`, { color: C.slate, bold: true })}
          {discussions.map(entry)}
        </Box>
      )}
    </Box>
  )
}

/**
 * La confirmation d'« ✗ Oublier » une discussion (S2), comme « Supprimer » d'un parcours : ce qui
 * sera effacé, en nombres ; les sessions liées reconnues par leur titre seul n'y sont pas (S15).
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
 * La rangée de pastilles en tête de l'onglet : « ◆ Orchestrateur », puis une pastille par session
 * liée avec son état ; la sélectionnée porte « ▸ », comme les onglets.
 */
const sessionPills = (k: Kit, linked: readonly LinkedSession[], selected: string | null, act: Actions): unknown => {
  const { Box, Button } = k
  return (
    <Box key="agents-sessions" flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1}>
      <Box marginRight={2}>
        <Button key="agents-session-main" plain={true} dimColor={selected !== null} label={`${selected === null ? '▸' : NB}${NB}◆${NB}Orchestrateur`} onPress={() => act.selectAgentsSession(null)} />
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
  const lines = all.map(e => `⏳${NB}Effacement${NB}en${NB}cours ${e.key.startsWith('run:') ? `du${NB}parcours` : `de${NB}la${NB}discussion`} « ${e.title} »…`)
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
 * L'onglet Agents : en tête, l'orchestrateur et ses sessions liées en pastilles ; puis le résumé
 * et la frise de la session choisie. Celle de l'orchestrateur a sa piste en tête, une piste par
 * session liée (lancement et retour), puis une par sous-agent dans l'ordre de départ, sans
 * limite. Pendant un parcours comme sans. La barre de navigation règle la fenêtre de vue, propre à la
 * discussion. Ouvert dans une session liée, l'onglet la montre comme son propre orchestrateur.
 */
const agentsTab = (k: Kit, view: View, act: Actions): unknown[] => {
  const { Box, Button } = k
  // L'entrée du sélecteur d'historique : un parcours passé, une ancienne discussion, ou ici.
  const past = view.ui.agentsHistory !== undefined && view.history?.shown?.key === view.ui.agentsHistory ? view.history.shown : null
  const isPastLoading = view.ui.agentsHistory !== undefined && past === null
  const linked = past ? past.linked : isPastLoading ? [] : (view.linked ?? [])
  const chosen = linked.find(l => l.session.key === view.ui.agentsSession) ?? null
  const chosenReg = chosen?.reg ?? null
  // La session liée choisie, figée si elle ne travaille plus.
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
  // Les sous-agents en arbre (Q13) : enfants en retrait sous leur parent, Workflow repliés.
  const tree = laneTree(agents, new Set(view.ui.openWorkflows ?? []))
  // Les exécutions de /code-review sous leur nom standard ; le groupe, celui de la session montrée.
  const tagOf = ticketTagOf(view.board ?? null)
  const shownName = (a: RegistryAgent): string => reviewForkName(a.name, tagOf, reg?.group) ?? a.name
  // Dans la frise de l'orchestrateur, une piste par session liée : ses périodes de travail et
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
      name: chosen ? chosen.session.title : 'Orchestrateur',
      color: ORCHESTRATOR_COLOR,
      lane: returns.length > 0 ? { ...main, marks: [...(main.marks ?? []), ...returns] } : main,
      ...(chosen ? { caption: `session${NB}liée` } : {}),
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
  // Qui travaille : les pistes sans sous-agent (orchestrateur, advisor, sessions liées), puis les
  // segments bruts de tous les sous-agents, pas la piste réunie d'un Workflow.
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
  // Ce que montre la frise : cette discussion, la session liée choisie, ou cette session liée elle-même.
  const context = chosen
    ? `session${NB}liée${NB}·${NB}${LINKED_STATE[chosen.session.state].word}`
    : past
      ? `${past.key.startsWith('run:') ? 'parcours' : 'discussion'}${NB}·${NB}${past.title}`
      : delegate
        ? `session${NB}liée${NB}de${NB}${delegate.main ?? delegate.title ?? 'l’orchestrateur'}`
        : `cette${NB}discussion`
  const isBusy = chosen ? chosen.session.state === 'working' : agentsAtWork(view) > 0
  return [
    historySelector(k, view, act),
    erasingLine(k, view),
    sessionPills(k, linked.map(l => l.session), chosen ? chosen.session.key : null, act),
    <Box key="agents-head" flexDirection="row" flexWrap="wrap" alignItems="center">
      <Box marginRight={1}>{chip(k, chosen ? `↗${NB}${chosen.session.title}` : `◆${NB}Orchestrateur`, chosen ? LINKED_COLOR : C.violet)}</Box>
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
          ? T(k, chosen ? 'Aucun sous-agent dans cette session pour l’instant.' : 'Aucun sous-agent dans cette discussion pour l’instant.', { dim: true, wrap: 'wrap' })
          : line(k, [
              T(k, agentsSummary(agents), { bold: true }),
              linkedLanes.length > 0 && T(k, `·${NB}${plural(linkedLanes.length, 'session')}${NB}${linkedLanes.length > 1 ? 'liées' : 'liée'}`, { dim: true }),
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

/** Les boutons et la ligne de la suite recommandée pendant l'Implémentation d'un parcours à groupes. */
const launchParts = (rec: NextLaunch, act: Actions): { buttons: NextButton[]; note: string } => {
  const and = (ids: readonly string[]) => ids.join(', ')
  if (rec.kind === 'parallel') {
    const lot = rec.groups.join(' ∥ ')
    return {
      buttons: [{ key: 'next-parallel-linked', isPrimary: true, label: `⇉${NB}${lot} en parallèle · sessions liées`, onPress: () => act.launchParallelLinked(0) }],
      note: 'groupes indépendants : ils partent ensemble',
    }
  }
  if (rec.kind === 'group') {
    // Un groupe ne se fait qu'en session liée.
    const id = rec.group
    return {
      buttons: rec.isDelegable
        ? [
            { key: `next-linked-${id}`, isPrimary: true, label: `↗${NB}Groupe ${id} · session liée`, onPress: () => act.launchGroupLinked(id) },
            xhighOf(`next-xhigh-${id}`, id, act),
          ]
        : [],
      note: 'le prochain groupe prêt',
    }
  }
  if (rec.kind === 'busy') return { buttons: [], note: `${rec.groups.length > 1 ? 'groupes' : 'groupe'} ${and(rec.groups)} en cours ici : la suite viendra une fois ${rec.groups.length > 1 ? 'finis' : 'fini'}` }
  if (rec.kind === 'linked') return { buttons: [], note: `${and(rec.groups)} en session liée : la suite une fois ${rec.groups.length > 1 ? 'rendus' : 'rendu'}` }
  return { buttons: [], note: `tickets faits ; le compte rendu attend la revue de ${and(rec.groups)} (bouton sur la ligne du groupe)` }
}

/**
 * La carte « Ensuite » avant son dessin : son titre, sa note, ses boutons, et le bouton de l'étape
 * suivante (`lead`, l'un d'eux) que le bandeau reprend. C'est le lancement de groupes quand il y en
 * a un ; sinon, l'étape finie, la suite principale, ou « Clore le parcours » quand elle n'est que la
 * rétro ou qu'il n'y en a pas. Jamais la compaction, la rétro ni « xhigh » ; rien en pleine étape.
 */
const nextStepOf = (run: Run, view: View, act: Actions): { title: string; note: string; buttons: NextButton[]; lead: NextButton | null; preview: string[] } | null => {
  const sug = suggestionsFor(run, { hasPullRequests: view.sync.isGitHub !== false, isVersionSet: view.sync.isVersionSet, versionUnits: view.sync.versionUnits })
  const rec = nextLaunchFor(run)
  const phase = currentPhase(run)
  if (rec === null && sug.primary === null && !sug.canFinish) return null
  const title = sug.canFinish && sug.primary === null ? 'Parcours bouclé' : phase.status === 'done' ? 'Prochaine étape' : 'Ensuite'
  const buttons: NextButton[] = []
  let lead: NextButton | null = null
  let note = phase.status !== 'done' ? 'la commande va dans le prompt ; la lancer clôt la phase en cours' : 'la commande va dans le prompt'
  if (rec !== null) {
    // Les groupes d'abord : relancer /implement ou proposer la livraison n'y ajouterait rien.
    const parts = launchParts(rec, act)
    buttons.push(...parts.buttons)
    lead = parts.buttons[0] ?? null
    note = parts.buttons.length > 0 ? `${parts.note} · la demande va dans le prompt, la phase continue` : parts.note
    // Après /to-tickets, avant les groupes : alléger l'orchestrateur d'abord (bouton secondaire).
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
    buttons.push({ key: 'finish', label: '✓ Clore le parcours', onPress: () => act.finish() })
    if (phase.status === 'done' && lead === null) lead = buttons.at(-1)!
  }
  if (sug.versionNote) note = sug.versionNote
  return { title, note, buttons, lead, preview: sug.versionPreview ?? [] }
}

const nextCard = (k: Kit, run: Run, view: View, act: Actions): unknown => {
  const { Box } = k
  const next = nextStepOf(run, view, act)
  if (next === null) return null
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
  const tabs: [Tab, string][] = [
    ['flow', 'Parcours'],
    ['agents', agentsAtWork(view) > 0 ? `Agents${NB}·${NB}${agentsAtWork(view)}` : 'Agents'],
    ['activity', run && run.log.length > 0 ? `Activité${NB}·${NB}${run.log.length}` : 'Activité'],
    ['history', `Historique${NB}·${NB}${view.board?.runs.filter(r => r.archivedAt === undefined).length ?? 0}`],
    ['commands', 'Commandes'],
  ]
  return (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" marginTop={1}>
      {tabs.map(([tab, label]) => (
        <Box marginRight={2}>
          <Button key={`tab-${tab}`} plain={true} dimColor={tab !== view.ui.tab} label={tab === view.ui.tab ? `▸ ${label}` : label} onPress={() => act.setTab(tab)} />
        </Box>
      ))}
    </Box>
  )
}

const launcher = (k: Kit, act: Actions): unknown => {
  const { Box, Button } = k
  return (
    <Box key="launcher" flexDirection="column" marginTop={1}>
      {T(k, 'Démarrer un parcours', { bold: true })}
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
      {T(k, 'Les étapes et outils qui se greffent sur un parcours, ou servent seuls.', { dim: true, wrap: 'wrap' })}
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
  ]
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
 * La barre du bas de la page Parcours : des outils qui servent à tout moment, sans clore la phase.
 * Avec un parcours actif ici dans une phase de code ou de revue, « 🐞 Bug · session liée » s'ajoute.
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
              <Button key="any-bug" label={`🐞${NB}Bug${NB}·${NB}session${NB}liée`} onPress={() => act.launchBugLinked()} />
            </Box>
            {T(k, 'diagnostic dans une session à part, en détour de la phase', { dim: true, wrap: 'truncate-end' })}
          </Box>
        </Box>
      )}
    </Box>
  )
}

/** Mettre de côté le parcours actif : ni clos ni archivé, il attend dans l'historique. */
const asideRow = (k: Kit, act: Actions): unknown => {
  const { Box, Button } = k
  return (
    <Box key="aside" flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1}>
      <Box marginRight={1}>
        <Button key="set-aside" plain={true} dimColor={true} label={`‖${NB}Mettre de côté`} onPress={() => act.setAside()} />
      </Box>
      {T(k, 'pour en ouvrir un autre ; « Reprendre » le rouvre tel quel', { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

const flowTab = (k: Kit, run: Run, view: View, act: Actions): unknown[] => {
  const isMine = run.id === view.board?.activeId
  if (run.status === 'active' && isMine) return [phaseCard(k, run, view, act), agentsLine(k, view, act), nextCard(k, run, view, act), asideRow(k, act), anytimeCard(k, act, run)]
  const { Box, Button } = k
  const isElsewhere = run.status === 'active'
  const isAside = run.status === 'paused' && run.asideAt !== undefined
  const head = isElsewhere
    ? `Le dernier parcours, « ${run.title} », est en cours dans une autre discussion.`
    : isAside
      ? `Le dernier parcours, « ${run.title} », est mis de côté.`
      : run.status === 'paused'
        ? `Le dernier parcours, « ${run.title} », est en pause.`
        : 'Aucun parcours en cours.'
  const hint = isElsewhere
    ? 'Le reprendre ici le retire de l’autre discussion.'
    : isAside
      ? 'Il reprend tel quel avec « Reprendre » ; un skill lancé d’ici ouvre un autre parcours.'
      : run.status === 'paused'
        ? 'Il reprend tout seul quand tu relances un de ses skills.'
        : 'Le suivant démarre au prochain skill.'
  return [
    <Box key="idle" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {T(k, head, { bold: true })}
      {T(k, hint, { dim: true, wrap: 'wrap' })}
      {(run.status === 'paused' || isElsewhere) && (
        <Box marginTop={1}>
          <Button key={`resume-${run.id}`} variant="primary" label="↻ Reprendre" onPress={() => act.resume(run.id)} />
        </Box>
      )}
    </Box>,
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
  // Chaque parcours, archivés compris, ouvre l'onglet Agents sur lui (Q12).
  const agentsOf = (r: Run) => <Button key={`agents-of-${r.id}`} plain={true} dimColor={true} label={`◆${NB}Agents`} onPress={() => act.openAgentsOf(r.id)} />
  const card = (r: Run) => {
    const isArchived = r.archivedAt !== undefined
    const def = SKILLS[r.entry]!
    const phase = currentPhase(r)
    const ratio = runProgress(r)
    const isMine = r.id === board.activeId
    const status = isArchived
      ? T(k, `▣${NB}archivé`, { color: C.gray, bold: true })
      : r.status === 'active' && !isMine
        ? T(k, `⇆${NB}autre discussion`, { color: C.blue, bold: true })
        : r.status === 'active'
        ? T(k, `◉${NB}en cours`, { color: def.color, bold: true })
        : r.status === 'paused'
          ? T(k, r.asideAt !== undefined ? `‖${NB}mis de côté` : `‖${NB}en pause`, { color: C.gray, bold: true })
          : T(k, `✓${NB}terminé`, { color: C.green, bold: true })
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
              <Box marginRight={1}>{T(k, 'Supprimer définitivement ce parcours ?', { color: C.red, bold: true })}</Box>
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
    T(k, `Projet${NB}${board.name}${SEP}${plural(live.length, 'parcours', 'parcours')}${archived.length > 0 ? `${SEP}${archived.length}${NB}archivé${archived.length > 1 ? 's' : ''}` : ''}`, { dim: true, wrap: 'truncate-end' }),
    ...live.map(card),
    archived.length > 0 && (
      <Box key="archived-toggle" marginTop={1}>
        <Button key="archived-toggle" plain={true} dimColor={true} label={isArchiveOpen ? `▾ Cacher les archivés` : `▸ Archivés (${archived.length})`} onPress={() => act.toggleArchived()} />
      </Box>
    ),
    ...(isArchiveOpen ? archived.map(card) : []),
  ]
}

/**
 * L'en-tête quand aucun parcours n'est choisi dans cette discussion : aucun parcours n'y est montré.
 * Une session liée qui travaille pour un groupe le dit : son parcours est suivi par la discussion principale.
 */
const noRunHero = (k: Kit, board: Board): unknown => {
  // Le parcours peut manquer à ce board (session dans un worktree) : le titre relevé à la déclaration le remplace.
  const delegated = board.delegate ? delegatedTitle(board) : undefined
  return (
    <k.Box key="hero" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1}>
      {delegated
        ? T(k, `↗${NB}Session liée du parcours « ${delegated} »`, { bold: true, color: C.blue })
        : T(k, `◇${NB}Aucun parcours sélectionné`, { bold: true })}
      {T(
        k,
        delegated
          ? 'La discussion principale suit ce parcours : elle rend les statuts des tickets à la fin de cette session.'
          : 'Reprends-en un depuis l’onglet Historique, ou lance un skill pour en démarrer un.',
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
          `Le suivi démarre au premier skill mattpocock lancé${board ? ` dans ${board.name}` : ''} : phases, étapes, tickets, sous-agents, tests et livrables, le tout en direct.`,
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
  // Une session liée dans un worktree a un board vide : elle dit pour quel parcours elle travaille, pas l'accueil.
  if (!board || (board.runs.length === 0 && !board.delegate)) {
    return (
      <Box flexDirection="column" paddingX={1} paddingBottom={1}>
        {welcome(k, board)}
        {tabsRow(k, view, null, act)}
        {view.ui.tab === 'commands' ? commandsTab(k, act) : view.ui.tab === 'agents' ? agentsTab(k, view, act) : [launcher(k, act), anytimeCard(k, act)]}
      </Box>
    )
  }
  // Sans parcours en cours, le dernier touché, hors archives : archiver le rafraîchit sans le remettre en avant.
  // Les tickets relayés par les sessions liées comptent à l'affichage (jamais dans le parcours enregistré).
  const shown = (r: Run | null) => (r ? withRelay(r, view.relay) : null)
  const run = shown(activeRun(board) ?? [...board.runs].filter(r => r.archivedAt === undefined).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null)
  // L'en-tête ne montre que le parcours choisi dans cette discussion (en cours, ou fini ici).
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
 * Le bandeau d'accueil, tant que la discussion n'a pas de parcours actif : une ligne qui le dit,
 * et, si le projet en a un en pause ou suivi ailleurs, le plus récent à reprendre. Une session
 * liée dit à la place pour quel parcours elle travaille : il est suivi par la discussion principale.
 */
export const drawWelcomeBand = (k: Kit, view: View, act: Actions): unknown => {
  if (view.ui.isBandHidden || (view.board && activeRun(view.board))) return null
  const { Box, Button } = k
  const width = k.width
  const delegated = view.board?.delegate ? delegatedTitle(view.board) : undefined
  const latest = view.board && !delegated ? [...resumable(view.board)].sort((x, y) => y.updatedAt - x.updatedAt)[0] : undefined
  const def = latest ? SKILLS[latest.entry] : undefined
  return (
    <Box key="flow-welcome" flexDirection="row" alignItems="center" justifyContent="space-between" width={width}>
      <Box flexShrink={1}>
        {line(k, [
          bandTag(k, 'Flow', C.violet),
          delegated !== undefined && T(k, `↗${NB}Session${NB}liée`, { color: C.blue, bold: true }),
          delegated !== undefined && T(k, '·', { dim: true }),
          delegated !== undefined && <Box flexShrink={1}>{T(k, `« ${delegated} »`, { wrap: 'truncate-end' })}</Box>,
          delegated === undefined && T(k, width < 40 ? 'Aucun workflow' : `Aucun${NB}workflow${NB}sélectionné`, { dim: true }),
          latest && def && T(k, '·', { dim: true }),
          latest && def && T(k, def.glyph, { color: def.color, bold: true }),
          latest && def && width >= 56 && <Box flexShrink={1}>{T(k, latest.title, { wrap: 'truncate-end' })}</Box>,
          latest && def && <Button key="band-resume" plain={true} label={`↻${NB}Reprendre`} onPress={() => act.resume(latest.id)} />,
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

/** Une pastille du bandeau, avant son dessin : elle ne se coupe pas. */
type BandPill = Style & { text: string }

/** Dans le bandeau, l'avancement relayé de chaque groupe confié : « ↗A 2/4 ». */
const relayPills = (run: Run, view: View): BandPill[] =>
  (run.groups ?? [])
    .map(g => ({ g, relay: g.linked ? relayForGroup(view.relay, g, g.linked, Infinity, attachedIdsOf(run, g)) : null }))
    // En cours dès que l'id de sa session est relevé, avant le premier signal relayé.
    .filter(x => x.relay !== null || x.g.linked?.session !== undefined)
    .map(({ g, relay }) => {
      // Les tickets que le plan lui rattache comptent aussi : le parcours les tient, pas sa session.
      const { done, total } = groupProgress(run, g, relay)
      return { text: `↗${g.id}${NB}${done}/${total}`, color: relay?.endedAt !== undefined && done < total ? C.amber : C.blue, bold: true }
    })

/** Les pastilles du bandeau après la phase : les tickets, les groupes en sessions liées, les agents au travail, les choix à relire. */
const bandPills = (run: Run, view: View): BandPill[] => {
  const t = countTickets(run.tickets)
  const running = agentsAtWork(view)
  const unseen = unseenDecisions(run, view.relay)
  return [
    ...(t.total > 0 ? [{ text: `${t.done}/${t.total}`, bold: true }] : []),
    ...relayPills(run, view),
    ...(running > 0 ? [{ text: `${spinFrame(view.now)}${NB}${plural(running, 'agent')}`, color: C.blue }] : []),
    ...(unseen > 0 ? [{ text: `⚑${NB}${unseen}${NB}à${NB}relire`, color: C.amber, bold: true }] : []),
  ]
}

/**
 * Ce que le bandeau garde au moins : l'étiquette, le glyphe et la phase à gauche, « ▸ Ouvrir » et
 * « x » à droite. Le bouton de l'étape suivante ne vient qu'au-delà, et après les pastilles.
 */
const BAND_KEEP = 40

/** Largeur estimée d'un texte du bandeau, en cellules : « ⚑ » en prend deux sur certains terminaux. */
const bandCells = (text: string): number => [...text].reduce((n, ch) => n + (ch === '⚑' ? 2 : 1), 0)

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
  // Une seule ligne, l'essentiel : le parcours, sa phase, les tickets, les groupes en sessions
  // liées, ce qui attend la personne. L'état de la session et le détail des tickets sont dans /flow.
  return (
    <Box key="flow-band" flexDirection="row" alignItems="center" justifyContent="space-between" width={width}>
      <Box flexShrink={1}>
        {line(k, [
          bandTag(k, 'Flow', C.violet),
          T(k, def.glyph, { color: def.color, bold: true }),
          width >= 90 + room && <Box flexShrink={1}>{T(k, run.title, { bold: true, wrap: 'truncate-end' })}</Box>,
          mini,
          <Box flexShrink={1}>{T(k, `${skill.glyph}${NB}${skill.label}`, { color: skill.color, bold: true, wrap: 'truncate-end' })}</Box>,
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
