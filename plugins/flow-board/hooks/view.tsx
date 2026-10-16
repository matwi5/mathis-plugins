// Dessin du tableau de bord : le panneau à onglets (Parcours, Activité, Historique) et le
// bandeau au-dessus du prompt. Un seul arbre pour toutes les surfaces : le desktop, VS Code
// et le mobile reçoivent les SVG animés, le terminal des glyphes et des barres en blocs.
//
// Pièges du desktop (relevés dans git-board) : les espaces ordinaires y sont fondus et
// `gap` ignoré ; les écarts dans un texte sont donc insécables, ceux entre éléments des
// marges. Aucune prop n'est passée à `undefined` : les arbres restent valides partout.

import type { SyncState, AgentRow, Artifact, ArtifactKind, Board, Detour, FlowItem, FlowPhase, FlowStep, FoundTask, ItemStatus, Live, Relay, Run, SecurityCheck, Tab, Ticket, TicketGroup, TicketStatus, Tone, UiState } from '../types'
import { ANYTIME_GROUPS, C, CODE_SKILLS, COMMAND_GROUPS, FLOW_COMMANDS, LAUNCHERS, SKILLS, commandLineOf, slashOf, type AnytimeTool, type SkillDef } from './catalog.ts'
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
  hasSpecAndTickets,
  isPickable,
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
} from './model.ts'
import {
  barSvg,
  dotsSvg,
  miniRoadSvg,
  pulseSvg,
  ringSvg,
  roadmapSvg,
  spinnerSvg,
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
  /** La surface dessine les SVG (desktop, VS Code, mobile). */
  isRich: boolean
  /** Colonnes du corps. */
  width: number
}

export const kitOf = (table: Record<string, unknown>, width: number): Kit => ({
  Box: table.Box,
  Text: table.Text,
  Button: table.Button,
  Svg: table.Svg ?? null,
  Link: table.Link ?? null,
  isRich: typeof table.Svg === 'function',
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
}

export type Actions = {
  setTab: (tab: Tab) => unknown
  /** Lance la commande du skill (la suite du parcours). */
  launch: (skill: string) => unknown
  /** Met la commande du skill dans le prompt (lanceur : la personne ajoute le sujet). */
  prepare: (skill: string, args?: string) => unknown
  /** Met une commande de Claude Code (`compact`) dans le prompt, sans passer par le catalogue. */
  fillCommand: (command: string) => unknown
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
  /** Lance la sélection : /implement dans l'ordre, ou /implement-spec en parallèle. */
  launchPicks: (isParallel: boolean) => unknown
  /** Lance un groupe prêt : ses tickets ouverts, dans l'ordre, avec /implement. */
  launchGroup: (id: string) => unknown
  /** Lance seuls les tickets déjà prêts d'un groupe qui attend, avec /implement. */
  launchReady: (id: string) => unknown
  /** Confie un groupe prêt à une session liée ; le parcours reste dans cette discussion. */
  launchGroupLinked: (id: string) => unknown
  /** Annule l'envoi d'un groupe à une session liée qui n'a pas été lancée. */
  cancelGroupLinked: (id: string) => unknown
  /** Fait faire par sa session liée la revue d'un groupe rendu sans revue. */
  reviewLinkedGroup: (id: string) => unknown
  /** Demande à Claude la revue de sécurité d'un groupe (ou du lot, `lot`) par un sous-agent relecteur. */
  securityReview: (id: string) => unknown
  /** Demande à Claude un diagnostic de bug dans une session liée, en détour de la phase en cours. */
  launchBugLinked: () => unknown
  /** Ajoute un élément de la phase (une piste de rétro) à la sélection, ou l'en retire. */
  pickItem: (id: string) => unknown
  /** Choisit tous les éléments encore à confier, ou les retire tous s'ils l'étaient déjà. */
  pickAllItems: () => unknown
  clearItemPicks: () => unknown
  /** Confie les éléments choisis à une session liée ; le parcours reste dans cette discussion. */
  launchItemsLinked: () => unknown
  /** Annule un envoi à une session liée qui n'a pas été lancée. */
  cancelLinked: () => unknown
  /** Demande à Claude de vérifier la session liée et de rendre ses éléments (session arrêtée sans note). */
  recoverLinked: () => unknown
  /** Demande (ou retire) la confirmation de suppression d'un parcours archivé. */
  askDrop: (id: string) => unknown
  /** /ask-matt dans le prompt, prérempli avec l'endroit du parcours où l'on est. */
  askNext: () => unknown
  /** Lance un lot avec /implement-spec, un sous-agent par groupe (0 : le lot principal, puis les autres lots). */
  launchParallel: (lot?: number) => unknown
  /** Confie chaque groupe d'un lot à sa session liée (0 : le lot principal, puis les autres lots). */
  launchParallelLinked: (lot?: number) => unknown
  toggleLog: () => unknown
  /** Déplie ou replie les éléments de la phase au-delà des 14 premiers. */
  toggleItems: () => unknown
  /** Déplie ou replie les livrables au-delà des 14 premiers. */
  toggleArtifacts: () => unknown
  /** Déplie ou replie les sous-agents terminés au-delà des 3 derniers. */
  toggleAgents: () => unknown
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
const TICKET_ORDER: Record<TicketStatus, number> = { doing: 0, blocked: 1, todo: 2, done: 3 }

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
  return p.isOptional ? 'facultative' : ''
}

/** Les stations : les phases, ou les étapes quand le parcours n'a qu'une phase. */
const roadNodes = (run: Run): RoadNode[] => {
  if (run.phases.length === 1) {
    const only = run.phases[0]!
    const def = SKILLS[only.skill]!
    return only.steps.map(s => ({
      label: def.steps.find(x => x.id === s.id)?.label ?? s.id,
      color: def.color,
      state: s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : s.status === 'skipped' ? 'skipped' : 'pending',
    }))
  }
  const nextAt =
    currentPhase(run).status === 'done' ? run.phases.findIndex((p, i) => i > run.cursor && p.status === 'pending') : -1
  return run.phases.map((p, i) => {
    const def = SKILLS[p.skill]!
    const state: NodeState =
      p.status === 'done' ? 'done' : p.status === 'active' ? 'active' : p.status === 'skipped' ? 'skipped' : i === nextAt ? 'next' : 'pending'
    return {
      label: def.label,
      sub: phaseSub(run, i),
      color: def.color,
      state,
      isOptional: p.isOptional,
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
    const text = showLabel ? x.label.slice(0, Math.max(1, slot - 1)) : ''
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
  const running = run.agents.filter(a => a.status === 'running').length
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

/** Les éléments d'une phase qui peut les confier à une session liée (les pistes d'une rétro). */
type Linkable = { phase: FlowPhase; view: View; act: Actions }

/** Où en est l'envoi à la session liée : à lancer (avec « Annuler »), au travail, ou terminé. */
const linkedRow = (k: Kit, l: Linkable, label: string): unknown => {
  const { Box, Button } = k
  const linked = l.phase.linked
  if (!linked) return null
  const inFlight = linkedInFlight(l.phase).length
  const total = linked.items.length
  const parts =
    inFlight === 0
      ? [T(k, `✓${NB}Session${NB}liée${NB}terminée`, { color: C.green, bold: true }), T(k, `${label}${NB}:${NB}${total}/${total}`, { dim: true })]
      : linked.session === undefined
        ? [T(k, `↗${NB}Session${NB}liée${NB}à${NB}lancer`, { color: C.amber, bold: true }), T(k, 'la demande est dans le prompt : Entrée pour la lancer', { dim: true, wrap: 'wrap' })]
        : [
            T(k, `↗${NB}Session${NB}liée${NB}au${NB}travail`, { color: C.blue, bold: true }),
            // Les éléments ne bougent qu'à la note de fin : un compteur à 0 ferait croire la session bloquée.
            T(k, `${plural(inFlight, label.replace(/s$/, ''), label)}${NB}en${NB}cours`, { dim: true }),
            T(k, dur(l.view.now - linked.at), { dim: true }),
          ]
  return (
    <Box key="linked" flexDirection="row" flexWrap="wrap" alignItems="center">
      <Box flexShrink={1}>{line(k, parts, true)}</Box>
      {inFlight > 0 && linked.session === undefined && (
        <Box marginLeft={1} flexShrink={0}>
          <Button key="linked-cancel" plain={true} dimColor={true} label="Annuler" onPress={() => l.act.cancelLinked()} />
        </Box>
      )}
      {/* Sans id relevé, la session a pu partir quand même (lancée autrement que prévu) : la reprise reste possible. */}
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
      {pickable.length > 0 && selection.length === 0 && T(k, `Choisis les ${label} à traiter (○), puis confie-les à une session liée.`, { dim: true, wrap: 'wrap' })}
      {shown.map(item => {
        const look = ITEM[item.status]
        const isPicked = selection.includes(item.id)
        const cell = pickable.includes(item.id) ? (
          <Button key={`item-pick-${item.id}`} plain={true} dimColor={!isPicked} label={isPicked ? '●' : '○'} onPress={() => linkable!.act.pickItem(item.id)} />
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
              key="items-linked"
              variant="primary"
              label={`↗${NB}Traiter${NB}${selection.length}${NB}${selection.length > 1 ? label : one}${NB}·${NB}session${NB}liée`}
              onPress={() => linkable!.act.launchItemsLinked()}
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

/**
 * Une ligne de ticket : le choix (numéro d'ordre, ou cadenas tant qu'un bloqueur n'est ni fait ni
 * choisi avant), le titre, l'état, les dépendances et le lien vers Asana.
 */
/** Un ticket tel que sa session liée le relaie, tant que le groupe n'est pas rendu. */
const RELAYED: Record<TicketStatus, { glyph: string; color: string; label: string }> = {
  todo: TICKET.todo,
  doing: { glyph: '◉', color: C.tangerine, label: 'en cours ↗' },
  done: TICKET.done,
  blocked: { glyph: '!', color: C.amber, label: 'bloqué ↗' },
}

const ticketRow = (k: Kit, run: Run, t: Ticket, view: View, act: Actions, relayed?: GroupRelay['tickets'][string]): unknown => {
  const { Box, Button, Link } = k
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
        {url !== null && Link && <Box marginLeft={1} flexShrink={0}><Link href={url} label="Asana ↗" /></Box>}
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
              {href !== null && Link && <Box marginLeft={1} flexShrink={0}><Link href={href} label="Asana ↗" /></Box>}
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

/**
 * Où faire un groupe : « ↩ cette discussion » seulement dans la discussion qui a envoyé le plan
 * (celle dont le contexte lui sert) ; vu d'ailleurs, « ↩ discussion de découpage ».
 */
const whereLabel = (g: GroupView, session: string | undefined): string =>
  !g.group.continuesHere
    ? `↗${NB}nouvelle discussion`
    : g.group.continuesIn === undefined || g.group.continuesIn === session
      ? `↩${NB}cette discussion`
      : `↩${NB}discussion de découpage`

/** Où en est la session liée d'un groupe : à lancer, au travail, ou terminée avec des tickets ouverts (ambre). */
const linkLabel = (k: Kit, link: NonNullable<TicketGroup['linked']>, relay: GroupRelay | null, open: number, now: number): unknown =>
  link.session === undefined
    ? T(k, `↗${NB}session liée à lancer`, { color: C.blue, bold: true })
    : relay?.endedAt !== undefined && open > 0
      ? T(k, `↗${NB}session terminée il y a ${dur(now - relay.endedAt)}`, { color: C.amber, bold: true })
      : T(k, `↗${NB}session liée au travail`, { color: C.blue, bold: true })

/** En-tête d'un groupe : où le faire, où il en est, avec qui il peut avancer, ce qu'il attend. */
const groupHead = (k: Kit, run: Run, g: GroupView, color: string, view: View, act: Actions): unknown => {
  const { Button } = k
  const done = g.tickets.length - g.open.length
  const nameOf = (id: string) => run.tickets.find(t => t.id === id)?.name ?? externalOf(run, id)?.name ?? id
  const waits = [...g.waitsOn, ...g.waitsOutside.map(id => shortName(nameOf(id)))]
  const isLaunchable = g.state === 'ready' && !g.isFallback && !g.isDelegated
  const link = g.group.linked
  return line(
    k,
    [
      T(k, `${g.isFallback ? '' : `${g.group.id}${NB}·${NB}`}${g.group.name}`, { bold: true, color }),
      // Confié à une session liée : c'est là qu'il se fait, pas ici.
      g.isFallback || g.isDelegated ? null : T(k, whereLabel(g, view.board?.session), { color: g.group.continuesHere ? C.tangerine : C.violet }),
      T(k, `${done}/${g.tickets.length}`, { dim: true }),
      g.parallelWith.length > 0 ? T(k, `∥${NB}${g.parallelWith.join(', ')}`, { color: C.cyan, bold: true }) : null,
      g.conflicts.length > 0 ? T(k, `∦${NB}${g.conflicts.map(c => `${c.with}${NB}:${NB}${c.on}`).join(', ')}`, { color: C.amber }) : null,
      g.state === 'waiting' && waits.length > 0 ? T(k, `⏸${NB}attend ${waits.join(', ')}`, { color: C.amber }) : null,
      g.isCyclic ? T(k, `⚠${NB}ordre à revoir`, { color: C.red }) : null,
      g.isDelegated && link ? linkLabel(k, link, relayForGroup(view.relay, g.group), g.open.length, view.now) : null,
      g.isDelegated && link?.session === undefined ? (
        <Button key={`group-linked-cancel-${g.group.id}`} plain={true} dimColor={true} label="Annuler" onPress={() => act.cancelGroupLinked(g.group.id)} />
      ) : null,
      isLaunchable ? (
        <Button key={`launch-group-${g.group.id}`} variant="primary" label={`▶${NB}Lancer ${g.group.id}`} onPress={() => act.launchGroup(g.group.id)} />
      ) : null,
      isDelegable(g) ? <Button key={`launch-linked-${g.group.id}`} label={`↗${NB}Session${NB}liée`} onPress={() => act.launchGroupLinked(g.group.id)} /> : null,
      g.readyNow.length > 0 ? (
        <Button
          key={`launch-ready-${g.group.id}`}
          label={`▶${NB}Lancer ${g.readyNow.length > 1 ? `les ${g.readyNow.length} prêts` : 'le prêt'}`}
          onPress={() => act.launchReady(g.group.id)}
        />
      ) : null,
    ],
    true,
  )
}

/** Un lot parallèle : en sessions liées (partout), ou par /implement-spec (dépôt git seulement). */
const lotRow = (k: Kit, ids: readonly string[], at: number, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const suffix = at === 0 ? '' : `-${at}`
  const lot = ids.join(' ∥ ')
  return (
    <Box key={`lot${suffix}`} flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={at === 0 ? 1 : 0}>
      <Box marginRight={1}>
        <Button key={`launch-parallel-linked${suffix}`} label={`⇉${NB}${lot} en parallèle · sessions liées`} onPress={() => act.launchParallelLinked(at)} />
      </Box>
      {view.sync.isRepo !== false && (
        <Box marginRight={1}>
          <Button key={`launch-parallel${suffix}`} label={`⇉${NB}${lot} en parallèle · /implement-spec`} onPress={() => act.launchParallel(at)} />
        </Box>
      )}
      {at === 0 &&
        T(k, view.sync.isRepo === false ? 'une session liée par groupe · /implement-spec demande un dépôt git' : 'une session liée, ou un sous-agent, par groupe', { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

/** Les tickets rangés par vague puis par groupe, comme Claude les a regroupés. */
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
    const counts =
      sec.findings !== undefined
        ? ` · ${plural(sec.findings, 'constat')}${(sec.fixed ?? 0) > 0 ? ` · ${sec.fixed} corrigé${sec.fixed! > 1 ? 's' : ''}` : ''}`
        : ''
    const isOpen = (sec.findings ?? 0) > (sec.fixed ?? 0)
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
          {plan.waves > 1 && T(k, `Vague ${w + 1}${groups.length > 1 && groups.every(g => g.parallelWith.length > 0) ? `${NB}·${NB}en parallèle` : ''}`, { bold: true, dim: true })}
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
            (g.group.reviewedAt !== undefined ? (
              T(k, `✓${NB}revu`, { color: C.green, bold: true })
            ) : g.group.delegated !== undefined ? (
              // Fait par une session liée : ici la branche est fusionnée, la revue se fait là-bas.
              <Button key={`review-linked-${g.group.id}`} variant="primary" label={`◆${NB}Revue du groupe · session liée`} onPress={() => act.reviewLinkedGroup(g.group.id)} />
            ) : (
              <Button key={`review-group-${g.group.id}`} variant="primary" label={`◆${NB}Revue du groupe · /${commandLineOf('final-review')}`} onPress={() => act.launch('final-review')} />
            ))}
        </Box>
        {!g.isFallback && securityRow(k, g.group.security, g.group.id, act)}
        {/* « tout voir » déplie aussi les groupes finis : leurs tickets restent consultables. */}
        {view.ui.showAllTickets && g.tickets.map(ticket => ticketRow(k, run, ticket, view, act))}
        </Box>
      ))}
      {plan.parallelBatch.length >= 2 && lotRow(k, plan.parallelBatch, 0, view, act)}
      {plan.otherBatches.length > 0 && (
        <Box key="other-lots" flexDirection="column" marginTop={plan.parallelBatch.length >= 2 ? 0 : 1}>
          {T(k, plan.parallelBatch.length >= 2 ? 'Autres lots possibles :' : 'Lots possibles :', { dim: true })}
          {plan.otherBatches.map((ids, i) => lotRow(k, ids, i + 1, view, act))}
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
        T(k, `↗${NB}« Session liée » : Claude lance une session qui fait le groupe, et le parcours reste ici. Ou bien une autre discussion : /flow-board:flow, « Reprendre ici », ▶${NB}Lancer.`, { dim: true, wrap: 'wrap' })}
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
  const all = run.decided ?? []
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
  const { Box, Button, Link } = k
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
              {href !== null && Link && (
                <Box marginLeft={1} flexShrink={0}>
                  <Link href={href} label={f.url ? 'Issue ↗' : 'Asana ↗'} />
                </Box>
              )}
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
  // /implement-spec : après la spec et les tickets, ou dès que deux groupes prêts peuvent avancer
  // ensemble ; jamais hors d'un dépôt git (ses worktrees et sa branche d'intégration en ont besoin).
  const canParallel = view.sync.isRepo !== false && (hasSpecAndTickets(run) || (plan?.parallelBatch.length ?? 0) >= 2)
  const hint = plan ? 'Lance un groupe (▶), ou choisis les tickets (○) dans l’ordre voulu.' : 'Choisis les tickets à traiter (○), dans l’ordre voulu.'
  return (
    <Box flexDirection="column" marginTop={1}>
      {line(k, [T(k, 'Tickets', { bold: true }), bar, T(k, `${t.done}/${t.total}`, { bold: true }), T(k, pct(t.done / Math.max(1, t.total)), { dim: true })])}
      {open.length > 0 && selection.length === 0 && T(k, hint, { dim: true, wrap: 'wrap' })}
      {plan ? groupsSection(k, run, plan, view, act) : shown.map(ticket => ticketRow(k, run, ticket, view, act))}
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
            <Button key="launch-picks" variant="primary" label={`▶ Implémenter ${plural(selection.length, 'ticket')} · /implement`} onPress={() => act.launchPicks(false)} />
          </Box>
          {canParallel && (
            <Box marginRight={1}>
              <Button key="launch-picks-parallel" label="⇉ En parallèle · /implement-spec" onPress={() => act.launchPicks(true)} />
            </Box>
          )}
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

/** Phase qui modifie le code : le distant a-t-il avancé depuis le dernier sync ? */
const syncCallout = (k: Kit, run: Run, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const phase = currentPhase(run)
  if (!CODE_SKILLS.has(phase.skill) || phase.status !== 'active' || view.sync.checkedAt === null) return null
  const advice = syncAdvice(view.sync)
  if (!advice) {
    const ref = view.sync.main ? `origin/${view.sync.main}` : 'le distant'
    return <Box key="sync" marginTop={1}>{T(k, `✓${NB}À jour avec ${ref}${SEP}vérifié il y a ${dur(view.now - view.sync.checkedAt)}`, { dim: true })}</Box>
  }
  const first = advice.commands[0]!
  return (
    <Box key="sync" flexDirection="row" alignItems="center" marginTop={1} borderStyle="round" borderColor={C.cyan} paddingX={1}>
      <Box flexDirection="column" flexShrink={1} marginRight={1}>
        {T(k, `⟳${NB}${advice.reason[0]!.toUpperCase()}${advice.reason.slice(1)}`, { color: C.cyan, bold: true, wrap: 'wrap' })}
        {T(k, `Avant de modifier le code : ${advice.commands.map(commandText).join(' puis ')}`, { dim: true, wrap: 'wrap' })}
      </Box>
      <Box flexShrink={0}>
        <Button key="sync-now" label={`Préparer ${commandText(first)}`} onPress={() => act.prepare(first.skill, first.args)} />
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
 * tickets peuvent avancer en même temps (sessions liées, /implement-spec).
 */
const orderBlock = (k: Kit, def: SkillDef): unknown => {
  const { Box } = k
  const chain = (steps: readonly { label: string }[]) => steps.map(s => s.label).join(`${NB}›${NB}`)
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
  const isImplement = phase.skill === 'implement' || phase.skill === 'implement-spec'
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

const agentRow = (k: Kit, a: AgentRow, now: number): unknown => {
  const { Box } = k
  const icon =
    a.status === 'running'
      ? k.isRich
        ? svgOf(k, spinnerSvg(C.blue), 'en cours', true)
        : T(k, spinFrame(now), { color: C.blue })
      : a.status === 'done'
        ? T(k, '✓', { color: C.green })
        : a.status === 'cancelled'
          ? T(k, '⊘', { color: C.gray })
          : T(k, '✗', { color: C.red })
  return (
    <Box flexDirection="row" alignItems="center">
      <Box marginRight={1} flexShrink={0}>
        {icon}
      </Box>
      <Box flexShrink={1}>{T(k, a.name, { wrap: 'wrap', dim: a.status !== 'running' })}</Box>
      {a.role !== undefined && <Box marginLeft={1} flexShrink={0}>{T(k, a.role, { color: C.indigo })}</Box>}
      {a.model !== undefined && <Box marginLeft={1} flexShrink={0}>{chip(k, shortModel(a.model), C.lilac)}</Box>}
      {a.status === 'cancelled' && <Box marginLeft={1} flexShrink={0}>{T(k, 'annulé', { dim: true })}</Box>}
      {a.status === 'failed' && <Box marginLeft={1} flexShrink={0}>{T(k, 'échoué', { color: C.red })}</Box>}
      {a.isEndUnseen !== true && (
        <Box marginLeft={1} flexShrink={0}>
          {T(k, dur((a.finishedAt ?? now) - a.startedAt), { dim: true })}
        </Box>
      )}
    </Box>
  )
}

const AGENTS_SHOWN = 3

const agentsCard = (k: Kit, run: Run, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const now = view.now
  const running = run.agents.filter(a => a.status === 'running')
  const allEnded = run.agents.filter(a => a.status !== 'running')
  const ended = (view.ui.showAllAgents ? allEnded : allEnded.slice(-AGENTS_SHOWN)).reverse()
  if (running.length === 0 && ended.length === 0) return null
  return (
    <Box key="agents" flexDirection="column" borderStyle="round" borderColor={running.length > 0 ? C.blue : C.gray} borderDimColor={running.length === 0} paddingX={1} marginTop={1}>
      {line(k, [
        T(k, 'Sous-agents', { bold: true }),
        T(k, running.length > 0 ? `${running.length}${NB}actif${running.length > 1 ? 's' : ''}` : 'au repos', { color: running.length > 0 ? C.blue : C.gray }),
      ])}
      {running.map(a => agentRow(k, a, now))}
      {ended.map(a => agentRow(k, a, now))}
      {allEnded.length > AGENTS_SHOWN && (
        <Button key="agents-toggle" plain={true} dimColor={true} label={view.ui.showAllAgents ? '▾ réduire' : `▸ tous les terminés (${allEnded.length})`} onPress={() => act.toggleAgents()} />
      )}
    </Box>
  )
}

// ─── Prochaine étape ──────────────────────────────────────────────────────

/** Les boutons et la ligne de la suite recommandée pendant l'Implémentation d'un parcours à groupes. */
const launchParts = (k: Kit, run: Run, rec: NextLaunch, view: View, act: Actions): { buttons: unknown[]; note: string } => {
  const { Button } = k
  const and = (ids: readonly string[]) => ids.join(', ')
  if (rec.kind === 'parallel') {
    const lot = rec.groups.join(' ∥ ')
    return {
      buttons: [
        <Button key="next-parallel-linked" variant="primary" label={`⇉${NB}${lot} en parallèle · sessions liées`} onPress={() => act.launchParallelLinked(0)} />,
        ...(view.sync.isRepo !== false ? [<Button key="next-parallel" label={`⇉${NB}en parallèle · /implement-spec`} onPress={() => act.launchParallel(0)} />] : []),
      ],
      note: 'groupes indépendants : ils partent ensemble',
    }
  }
  if (rec.kind === 'group') {
    const id = rec.group
    const group = run.groups?.find(g => g.id === id)
    // Un groupe que le plan garde pour la discussion du découpage s'y lance d'abord, comme sa ligne le dit.
    const isHere = group?.continuesHere === true && (group.continuesIn === undefined || group.continuesIn === view.board?.session)
    const here = (primary: boolean) => (
      <Button key={`next-group-${id}`} {...(primary ? { variant: 'primary' } : {})} label={`▶${NB}Lancer ${id} ici`} onPress={() => act.launchGroup(id)} />
    )
    const linked = (primary: boolean) => (
      <Button key={`next-linked-${id}`} {...(primary ? { variant: 'primary' } : {})} label={`↗${NB}Groupe ${id} · session liée`} onPress={() => act.launchGroupLinked(id)} />
    )
    return {
      buttons: !rec.isDelegable ? [here(true)] : isHere ? [here(true), linked(false)] : [linked(true), here(false)],
      note: 'le prochain groupe prêt',
    }
  }
  if (rec.kind === 'busy') return { buttons: [], note: `${rec.groups.length > 1 ? 'groupes' : 'groupe'} ${and(rec.groups)} en cours ici : la suite viendra une fois ${rec.groups.length > 1 ? 'finis' : 'fini'}` }
  if (rec.kind === 'linked') return { buttons: [], note: `${and(rec.groups)} en session liée : la suite une fois ${rec.groups.length > 1 ? 'rendus' : 'rendu'}` }
  return { buttons: [], note: `tickets faits ; le compte rendu attend la revue de ${and(rec.groups)} (bouton sur la ligne du groupe)` }
}

const nextCard = (k: Kit, run: Run, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const sug = suggestionsFor(run, { hasPullRequests: view.sync.isGitHub !== false })
  const rec = nextLaunchFor(run)
  const phase = currentPhase(run)
  if (rec === null && sug.primary === null && !sug.canFinish) return null
  const title = sug.canFinish && sug.primary === null ? 'Parcours bouclé' : phase.status === 'done' ? 'Prochaine étape' : 'Ensuite'
  const buttons: unknown[] = []
  let note = phase.status !== 'done' ? 'la commande va dans le prompt ; la lancer clôt la phase en cours' : 'la commande va dans le prompt'
  if (rec !== null) {
    // Les groupes d'abord : relancer /implement ou proposer la livraison n'y ajouterait rien.
    const parts = launchParts(k, run, rec, view, act)
    buttons.push(...parts.buttons)
    note = parts.buttons.length > 0 ? `${parts.note} · la demande va dans le prompt, la phase continue` : parts.note
    if (phase.skill !== 'retro') buttons.push(<Button key="go-retro" label={`${SKILLS.retro!.glyph} ${SKILLS.retro!.label}`} onPress={() => act.launch('retro')} />)
  } else {
    if (sug.primary !== null) {
      const skill = sug.primary
      const d = SKILLS[skill]!
      buttons.push(<Button key={`go-${skill}`} variant="primary" label={`▶ ${d.label} · /${commandLineOf(skill)}`} onPress={() => act.launch(skill)} />)
    }
    for (const skill of sug.others) {
      const d = SKILLS[skill]!
      buttons.push(<Button key={`go-${skill}`} label={`${d.glyph} ${d.label}`} onPress={() => act.launch(skill)} />)
    }
    if (sug.canFinish) buttons.push(<Button key="finish" label="✓ Clore le parcours" onPress={() => act.finish()} />)
  }
  return (
    <Box key="next" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {line(k, [T(k, title, { bold: true }), T(k, note, { dim: true })])}
      {buttons.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
          {buttons.map(b => (
            <Box marginRight={1}>{b}</Box>
          ))}
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
  if (run.status === 'active' && isMine) return [phaseCard(k, run, view, act), agentsCard(k, run, view, act), nextCard(k, run, view, act), asideRow(k, act), anytimeCard(k, act, run)]
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
              <Button key={`drop-${r.id}`} plain={true} dimColor={true} label="✗ Supprimer" onPress={() => act.askDrop(r.id)} />
            </Box>
          )
        ) : (
          !isMine && (
            <Box flexDirection="row" marginTop={1}>
              <Box marginRight={1}>
                <Button key={`resume-${r.id}`} label={r.status === 'active' ? '↻ Reprendre ici' : '↻ Reprendre'} onPress={() => act.resume(r.id)} />
              </Box>
              {r.status !== 'active' && <Button key={`archive-${r.id}`} plain={true} dimColor={true} label="▣ Archiver" onPress={() => act.archive(r.id)} />}
            </Box>
          )
        )}
      </Box>
    )
  }
  return [
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
        {view.ui.tab === 'commands' ? commandsTab(k, act) : [launcher(k, act), anytimeCard(k, act)]}
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
          <Button key="band-open" plain={true} dimColor={true} label="▸ /flow" onPress={() => act.openPane()} />
        </Box>
        <Button key="band-hide" plain={true} dimColor={true} role="dismiss" label="x" onPress={() => act.hideBand()} />
      </Box>
    </Box>
  )
}

/** Dans le bandeau, l'avancement relayé de chaque groupe confié : « ↗A 2/4 ». */
const relayPills = (k: Kit, run: Run, view: View): unknown[] =>
  (run.groups ?? [])
    .map(g => ({ g, relay: g.linked ? relayForGroup(view.relay, g) : null }))
    .filter((x): x is { g: TicketGroup; relay: GroupRelay } => x.relay !== null)
    .map(({ g, relay }) => T(k, `↗${g.id}${NB}${relay.done}/${relay.total}`, { color: relay.endedAt !== undefined && relay.done < relay.total ? C.amber : C.blue, bold: true }))

export const drawBand = (k: Kit, view: View, act: Actions): unknown => {
  const stored = activeRun(view.board)
  if (!stored || view.ui.isBandHidden) return null
  const run = withRelay(stored, view.relay)
  const { Box, Button } = k
  const width = k.width
  const def = SKILLS[run.entry]!
  const { skill } = focusOf(run)
  const t = countTickets(run.tickets)
  const nodes = roadNodes(run)
  const mini =
    width < 64
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
  const running = run.agents.filter(a => a.status === 'running').length
  // Une seule ligne, l'essentiel : le parcours, sa phase, les tickets, les groupes en sessions
  // liées, ce qui attend la personne. L'état de la session et le détail des tickets sont dans /flow.
  return (
    <Box key="flow-band" flexDirection="row" alignItems="center" justifyContent="space-between" width={width}>
      <Box flexShrink={1}>
        {line(k, [
          bandTag(k, 'Flow', C.violet),
          T(k, def.glyph, { color: def.color, bold: true }),
          width >= 90 && <Box flexShrink={1}>{T(k, run.title, { bold: true, wrap: 'truncate-end' })}</Box>,
          mini,
          <Box flexShrink={1}>{T(k, `${skill.glyph}${NB}${skill.label}`, { color: skill.color, bold: true, wrap: 'truncate-end' })}</Box>,
          t.total > 0 && T(k, `${t.done}/${t.total}`, { bold: true }),
          ...relayPills(k, run, view),
          running > 0 && T(k, `${spinFrame(view.now)}${NB}${plural(running, 'agent')}`, { color: C.blue }),
          unseenDecisions(run) > 0 && T(k, `⚑${NB}${unseenDecisions(run)}${NB}à${NB}relire`, { color: C.amber, bold: true }),
        ])}
      </Box>
      <Box flexDirection="row" flexShrink={0} marginLeft={1}>
        <Box marginRight={1}>
          <Button key="band-open" plain={true} dimColor={true} label="▸ /flow" onPress={() => act.openPane()} />
        </Box>
        <Button key="band-hide" plain={true} dimColor={true} role="dismiss" label="x" onPress={() => act.hideBand()} />
      </Box>
    </Box>
  )
}
