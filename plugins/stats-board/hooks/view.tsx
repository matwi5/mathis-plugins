// Dessin du panneau de statistiques (/ccstats) et du bandeau au-dessus du prompt. Un seul
// arbre pour toutes les surfaces : le desktop, VS Code et le mobile reçoivent des SVG, le
// terminal des grilles de cases (`Raster`) pour le calendrier et les colonnes, des glyphes et
// des barres en blocs pour le reste (et pour tout, si sa table n'a pas `Raster`). Aucun appel
// au moteur ici : l'état arrive dans `View`, les actions dans `Actions` (des fermetures préparées par register.tsx).
//
// Pièges du desktop (relevés par git-board) : les espaces ordinaires y sont fondus et `gap`
// ignoré ; les écarts dans un texte sont donc insécables, ceux entre éléments des marges.
// Aucune prop n'est passée à `undefined` : les arbres restent valides partout.

import type { Discussion, Expanded, Grain, Machine, Meta, Metric, Notice, Period, SessionRow, SessionSort, Snapshot, Tab, Ui, UsageRow } from '../types'
import {
  BRAND,
  C,
  DAY_LETTERS,
  DRAFTS,
  MONEY,
  NB,
  RATE_LEVELS,
  SEP,
  WEEKDAY_LONG,
  activeDates,
  blockRate,
  blocksOfDay,
  bucketMinutes,
  compareDay,
  discussionsOfDay,
  entryTokens,
  estimateCosts,
  heatLegend,
  heatOf as rateHeat,
  unitPricesOf,
  addDays,
  ago,
  cacheRatio,
  dayOf,
  daysBetween,
  filterOf,
  firstDate,
  fitGrain,
  fmtCost,
  fmtCostShort,
  fmtDate,
  fmtDay,
  fmtDelta,
  fmtDuration,
  fmtInt,
  fmtMetric,
  fmtMonth,
  fmtMonthShort,
  fmtPct,
  fmtTokens,
  funFact,
  groupOf,
  modelColors,
  modelName,
  modelsOf,
  monthOf,
  monthPlan,
  monthShort,
  plural,
  previousOf,
  projectLabels,
  projectsOf,
  selectRows,
  selectSessions,
  seriesOf,
  streaksOf,
  sum,
  unique,
  valueOf,
  weekOf,
  weekdaysOf,
  zero,
  type Filter,
  type Totals,
} from './model.ts'
import { DEFAULT, columnsCells, heatCells, heatLegendCells, pack, type RasterCells } from './raster.ts'
import { barSvg, blockSvg, columnsSvg, donutSvg, flameSvg, heatGaugeSvg, heatmapSvg, heroSvg, ringSvg, sparkSvg, spinnerSvg, stackSvg, type BarPart, type HeatCell } from './svg.ts'

/** Largeur estimée d'une cellule sur les surfaces distantes ; un SVG trop large est réduit à sa place. */
const PX_PER_CELL = 7.6
/** Plafonds des listes avant « ▸ tout voir (N) ». */
const MODELS_CAP = 6
const PROJECTS_CAP = 8
const SESSIONS_CAP = 10
const SESSIONS_MAX = 40
const DAYS_CAP = 5
const DAYS_MAX = 15

export type Kit = {
  Box: any
  Text: any
  Button: any
  Svg: any
  /**
   * La grille de cases du terminal, ou null : les graphiques passent alors aux glyphes. Jamais
   * donnée à une surface qui dessine les SVG : la table complétée de `$.ui.resolve` y porte un
   * `Raster` (fragment vide, constaté dans le kit de test), et le SVG garde la priorité.
   */
  Raster: any
  /** La surface dessine les SVG (desktop, VS Code, mobile). */
  isRich: boolean
  /** Colonnes du corps. */
  width: number
}

/**
 * Ce que la surface dessine vraiment. La table de `$.ui.resolve(e)` est complétée : un
 * élément absent de la surface y figure quand même et dessine un fragment vide (constaté par
 * git-board : `Svg` sur le terminal). register.tsx lit donc la capacité dans le contrat
 * `Elements` du moteur et la passe ici ; la vue ne connaît pas le nom de la surface.
 */
export type Caps = { hasSvg: boolean }

/** Une case vide, pour essayer le constructeur `Raster` de la table. */
const PROBE = pack([[[0x20, DEFAULT, DEFAULT]]])

/**
 * La table a vraiment `Raster` : le constructeur existe et rend un élément `Raster`. Un moteur
 * qui ne le connaît pas n'en a pas ; un `Raster` retenu par un hook `ui.resolve` est complété
 * par un fragment vide (constaté dans le kit de test), qui ne dessinerait rien.
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
  Raster: !caps.hasSvg && drawsRaster(table.Raster) ? table.Raster : null,
  isRich: caps.hasSvg && typeof table.Svg === 'function',
  width: Math.max(24, Math.floor(width)),
})

export type View = {
  snapshot: Snapshot | null
  ui: Ui
  meta: Meta
  notice: Notice
  isBandHidden: boolean
  /** Clé ccusage du dossier de la session. */
  here: string | null
  discussion: Discussion
  now: number
}

export type Actions = {
  setUi: (patch: Partial<Ui>) => unknown
  toggleExpanded: (list: keyof Expanded) => unknown
  /** ↻ : relance ccusage, relit le cache de /stats et détaille la discussion. */
  refresh: () => unknown
  /** ↻ de l'onglet Discussion : ccusage sur cette seule discussion. */
  refreshDiscussion: () => unknown
  dismissNotice: () => unknown
  hideBand: () => unknown
  openPane: () => unknown
}

// ─── Petits outils ────────────────────────────────────────────────────────

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const spinFrame = (now: number): string => SPIN[Math.floor(now / 1000) % SPIN.length] ?? '⠋'
const px = (cells: number): number => Math.max(160, Math.floor(cells * PX_PER_CELL))
const EIGHTHS = '▁▂▃▄▅▆▇█'

type Style = { color?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; wrap?: string }

const propsOf = (style: Style): Record<string, unknown> => {
  const props: Record<string, unknown> = {}
  if (style.color) props.color = style.color
  if (style.bg) props.backgroundColor = style.bg
  if (style.bold) props.bold = true
  if (style.dim) props.dimColor = true
  if (style.italic) props.italic = true
  if (style.wrap) props.wrap = style.wrap
  return props
}

const isShown = (item: unknown): boolean => item !== null && item !== undefined && item !== false && item !== ''

/** Un Text sans prop indéfinie. */
const T = (k: Kit, text: string, style: Style = {}): unknown => h(k.Text, propsOf(style), text)

/** Un Text fait de morceaux (Text imbriqués ou chaînes), sans prop indéfinie. */
const TT = (k: Kit, parts: unknown[], style: Style = {}): unknown => h(k.Text, propsOf(style), ...parts.filter(isShown))

/** Pastille pleine : texte foncé sur la couleur. */
const chip = (k: Kit, text: string, color: string, style: Style = {}): unknown => T(k, `${NB}${text}${NB}`, { ...style, bg: color, color: C.ink, bold: true })

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

const svgOf = (k: Kit, drawn: { source: string; width: number; height: number }, alt: string, isSized = true): unknown => {
  const props: Record<string, unknown> = { source: drawn.source, alt }
  if (isSized) {
    props.width = drawn.width
    props.height = drawn.height
  }
  // Jamais `isInteractive` : ce mode dessine dans un cadre à fond blanc, rechargé à chaque redessin.
  return h(k.Svg, props)
}

/** Barre en blocs du terminal. */
const blocks = (k: Kit, parts: readonly BarPart[], total: number, cells: number): unknown => {
  const { Box } = k
  const width = Math.max(4, cells)
  const all = Math.max(1e-9, total, parts.reduce((n, p) => n + p.value, 0))
  let used = 0
  const segs: unknown[] = []
  parts.forEach((part) => {
    if (part.value <= 0) return
    const n = Math.max(1, Math.round((part.value / all) * width))
    const take = Math.min(n, width - used)
    if (take <= 0) return
    used += take
    segs.push(T(k, '█'.repeat(take), { color: part.color }))
  })
  if (used < width) segs.push(T(k, '░'.repeat(width - used), { color: C.gray, dim: true }))
  return <Box flexDirection="row">{segs}</Box>
}

/** Une jauge horizontale : SVG arrondi, ou blocs sur le terminal. */
const meter = (k: Kit, parts: readonly BarPart[], total: number, cells: number, alt: string): unknown =>
  k.isRich ? svgOf(k, barSvg(parts, total, px(cells), 7), alt) : blocks(k, parts, total, cells)

/** Indicateur de travail : arc qui tourne (SVG) ou spinner braille (terminal). */
const spinner = (k: Kit, color: string, now: number, alt: string): unknown => (k.isRich ? svgOf(k, spinnerSvg(color, 12), alt) : T(k, spinFrame(now), { color }))

/** Bascule « ▸ tout voir (N) » / « ▾ réduire » d'une liste plafonnée. */
const showAllToggle = (k: Kit, key: string, isOpen: boolean, total: number, onPress: () => unknown, more = `tout${NB}voir${NB}(${total})`): unknown => {
  const { Box, Button } = k
  return (
    <Box marginTop={1}>
      <Button key={key} plain={true} dimColor={true} label={isOpen ? `▾${NB}réduire` : `▸${NB}${more}`} onPress={onPress} />
    </Box>
  )
}

/** Un choix d'une rangée de bascules : le choix courant marqué « ▸ », les autres atténués. */
const toggle = (k: Kit, key: string, label: string, isOn: boolean, onPress: () => unknown): unknown =>
  h(k.Button, { key, plain: true, dimColor: !isOn, label: isOn ? `▸${NB}${label}` : label, onPress })

/** Une valeur seule par jour, échantillonnée sur `cells` colonnes au plus (sommes par paquet). */
const resample = (values: readonly number[], cells: number): number[] => {
  if (values.length <= cells) return [...values]
  const size = Math.ceil(values.length / cells)
  const out: number[] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size).reduce((n, v) => n + v, 0))
  return out
}

/** Une courbe cumulée, échantillonnée sur `cells` points au plus : la dernière valeur de chaque paquet. */
const sampleLast = (values: readonly number[], cells: number): number[] => {
  if (values.length <= cells) return [...values]
  const size = Math.ceil(values.length / cells)
  const out: number[] = []
  for (let i = size - 1; i < values.length + size - 1; i += size) out.push(values[Math.min(i, values.length - 1)]!)
  return out
}

/** Courbe d'une ligne en huitièmes de bloc (terminal). */
const sparkText = (k: Kit, values: readonly number[], cells: number, color: string): unknown => {
  const vals = resample(values, Math.max(4, cells))
  const max = Math.max(...vals, 1e-9)
  const text = vals.map((v) => (v <= 0 ? '▁' : EIGHTHS[Math.min(7, Math.max(0, Math.ceil((v / max) * 8) - 1))] ?? '▁')).join('')
  return T(k, text, { color })
}

/**
 * Colonnes sur plusieurs rangées en huitièmes de bloc (terminal) ; `cell` caractères par
 * colonne. Avec `stacks` (les parts de chaque colonne, du bas vers le haut), chaque case prend
 * la couleur de la part qu'elle couvre : des barres empilées par modèle.
 */
const columnsText = (k: Kit, values: readonly number[], height: number, color: string, cell = 1, highlight = -1, stacks: readonly (readonly BarPart[])[] | null = null): unknown => {
  const { Box } = k
  const max = Math.max(...values, 1e-9)
  const tall = values.map((v) => (v > 0 ? Math.max(1, Math.round((v / max) * height * 8)) : 0))
  const colorAt = (i: number, at8: number): string => {
    const parts = stacks?.[i]
    const all = values[i] ?? 0
    if (!parts || all <= 0) return i === highlight ? C.coral : color
    let top = 0
    for (const p of parts) {
      top += (Math.max(0, p.value) / all) * (tall[i] ?? 0)
      if (at8 < top) return p.color
    }
    return parts[parts.length - 1]?.color ?? color
  }
  const rows: unknown[] = []
  for (let r = height - 1; r >= 0; r--) {
    const runs: { text: string; color: string }[] = []
    tall.forEach((h8, i) => {
      const fill = Math.max(0, Math.min(8, h8 - r * 8))
      const glyph = fill === 0 ? NB : (EIGHTHS[fill - 1] ?? '█')
      const text = cell > 1 ? glyph.repeat(cell - 1) + NB : glyph
      const c = colorAt(i, r * 8 + fill / 2)
      const last = runs[runs.length - 1]
      if (last && last.color === c) last.text += text
      else runs.push({ text, color: c })
    })
    rows.push(<Box key={`r${r}`}>{TT(k, runs.map((x) => T(k, x.text, { color: x.color })))}</Box>)
  }
  return <Box flexDirection="column">{rows}</Box>
}

/** Une grille de cases (`Raster`) ; `key` unique parmi celles d'un même arbre. */
const raster = (k: Kit, key: string, drawn: RasterCells): unknown => h(k.Raster, { key, columns: drawn.columns, rows: drawn.rows, cells: drawn.cells })

/** Colonnes du terminal : une grille de cases quand la table a `Raster`, sinon des glyphes. */
const columnsChart = (k: Kit, key: string, values: readonly number[], height: number, color: string, cell = 1, highlight = -1, stacks: readonly (readonly BarPart[])[] | null = null): unknown =>
  k.Raster && values.length > 0 && values.length * cell <= 512 ? raster(k, key, columnsCells(values, height, color, cell, highlight, stacks)) : columnsText(k, values, height, color, cell, highlight, stacks)

const TONE = { ok: C.green, error: C.red, info: C.tangerine } as const
const toneOf = (metric: Metric): string => (metric === 'cost' ? MONEY : BRAND)
const hhmm = (ms: number, tz: number): string => new Date(ms - tz * 60_000).toISOString().slice(11, 16)
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

// ─── Contexte d'un dessin ─────────────────────────────────────────────────

type Ctx = {
  s: Snapshot
  ui: Ui
  now: number
  today: string
  f: Filter
  rows: UsageRow[]
  total: Totals
  /** Premier jour montré : début de la période, ou premier jour connu pour « Tout ». */
  from: string
  metric: Metric
  colors: Record<string, string>
  names: Map<string, string>
  sessions: SessionRow[]
  /** Le projet de la session, tel qu'affiché (les brouillons réunis). */
  here: string | null
  /** Colonnes dans une carte bordée. */
  inner: number
}

function contextOf(k: Kit, view: View): Ctx | null {
  const s = view.snapshot
  if (!s) return null
  const today = dayOf(view.now, s.tzOffset)
  const machine = view.ui.machine === 'all' || s.machines.includes(view.ui.machine) ? view.ui.machine : 'all'
  const f = filterOf({ ...view.ui, machine }, today)
  const rows = selectRows(s.rows, f, s.projects)
  const homeKey = Object.entries(s.projects).find(([, i]) => i.name === '~')?.[0] ?? null
  const keys = unique([...s.rows.map((r) => groupOf(r.project, s.projects)), ...s.sessions.map((x) => groupOf(x.project, s.projects))])
  return {
    s,
    ui: view.ui,
    now: view.now,
    today,
    f,
    rows,
    total: sum(rows),
    from: f.from ?? firstDate(rows) ?? today,
    metric: view.ui.metric,
    // Couleurs sur tout le relevé, pas sur la vue filtrée : un modèle garde la sienne d'un filtre à l'autre.
    colors: modelColors(modelsOf(s.rows, 'tokens').map((m) => m.model)),
    names: projectLabels(keys, s.projects, homeKey),
    sessions: selectSessions(s.sessions, f, s.projects, s.tzOffset),
    here: view.here ? groupOf(view.here, s.projects) : null,
    inner: Math.max(20, k.width - 6),
  }
}

const nameOf = (ctx: Ctx, key: string): string => ctx.names.get(key) ?? key

/** Une carte bordée : un titre de couleur, des réglages à droite (qui passent dessous si la place manque). */
const card = (k: Kit, key: string, title: string, color: string, right: unknown, body: unknown[]): unknown => {
  const { Box } = k
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
        <Box flexShrink={1} marginRight={1}>
          {T(k, title, { color, bold: true, wrap: 'truncate-end' })}
        </Box>
        {isShown(right) && <Box flexShrink={0}>{right}</Box>}
      </Box>
      {body.filter(isShown)}
    </Box>
  )
}

const say = (k: Kit, text: string, style: Style = { dim: true }): unknown => {
  const { Box } = k
  return <Box marginTop={1}>{T(k, text, { wrap: 'wrap', ...style })}</Box>
}

const metricToggle = (k: Kit, ctx: Ctx, act: Actions): unknown =>
  line(k, [
    toggle(k, 'metric-cost', `$${NB}coût`, ctx.metric === 'cost', () => act.setUi({ metric: 'cost' })),
    toggle(k, 'metric-tokens', `#${NB}tokens`, ctx.metric === 'tokens', () => act.setUi({ metric: 'tokens' })),
  ])

/** Des pastilles de couleur, une par modèle. */
const modelDots = (k: Kit, ctx: Ctx, models: readonly string[]): unknown => TT(k, models.map((m) => T(k, '●', { color: ctx.colors[m] ?? C.gray })))

// ─── Panneau ──────────────────────────────────────────────────────────────

const TABS: [Tab, string][] = [
  ['discussion', 'Discussion'],
  ['day', 'Journée'],
  ['overview', 'Aperçu'],
  ['trend', 'Évolution'],
  ['models', 'Modèles'],
  ['projects', 'Projets'],
  ['sessions', 'Sessions'],
  ['rhythm', 'Rythme'],
]

export const drawPane = (k: Kit, view: View, act: Actions): unknown => {
  const { Box } = k
  const ctx = contextOf(k, view)
  if (!ctx) {
    return (
      <Box flexDirection="column" paddingX={1} paddingBottom={1}>
        {welcome(k, view, act)}
        {activity(k, view, act)}
      </Box>
    )
  }
  const tab = view.ui.tab
  const body =
    tab === 'discussion'
      ? discussionTab(k, view, ctx, act)
      : tab === 'day'
      ? dayTab(k, view, ctx, act)
      : ctx.rows.length === 0
      ? emptyCard(k, act)
      : tab === 'trend'
        ? trendTab(k, ctx, act)
        : tab === 'models'
          ? modelsTab(k, ctx, act)
          : tab === 'projects'
            ? projectsTab(k, ctx, act)
            : tab === 'sessions'
              ? sessionsTab(k, ctx, act)
              : tab === 'rhythm'
                ? rhythmTab(k, ctx, act)
                : overviewTab(k, ctx, act)
  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      {header(k, view, ctx, act)}
      {activity(k, view, act)}
      {tabsRow(k, view, act)}
      {body}
    </Box>
  )
}

/** Sans relevé : une carte d'accueil, jamais un panneau vide. */
const welcome = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const m = view.meta
  return (
    <Box key="welcome" flexDirection="column" borderStyle="round" borderColor={BRAND} paddingX={2} paddingY={1}>
      {T(k, `◆${NB}Stats${NB}Claude${NB}Code`, { color: BRAND, bold: true })}
      {T(
        k,
        m.loading
          ? 'Premier relevé en cours : ccusage lit les journaux de Claude Code, puis le mod publie ceux de ce poste et ajoute ceux des autres postes.'
          : 'Aucun relevé pour l’instant. Le relevé lance « npx ccusage@latest » (coût, tokens, sessions, blocs de 5 h), lit le cache de /stats et ajoute les usages des autres postes.',
        { dim: true, wrap: 'wrap' },
      )}
      {m.error && <Box marginTop={1}>{T(k, m.error, { color: C.red, wrap: 'wrap' })}</Box>}
      {!m.loading && (
        <Box marginTop={1}>
          <Button key="refresh" variant="primary" label={`▶${NB}Lancer${NB}le${NB}relevé`} onPress={() => act.refresh()} />
        </Box>
      )}
    </Box>
  )
}

const emptyCard = (k: Kit, act: Actions): unknown => {
  const { Box, Button } = k
  return (
    <Box key="empty" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {T(k, 'Rien à montrer pour ces filtres.', { bold: true })}
      {T(k, 'Aucune consommation sur cette période, ce poste, ce projet ou ce modèle.', { dim: true, wrap: 'wrap' })}
      <Box marginTop={1}>
        <Button key="reset-filters" label={`↺${NB}Tout${NB}afficher`} onPress={() => act.setUi({ period: 'all', machine: 'all', project: null, model: null })} />
      </Box>
    </Box>
  )
}

const PERIODS: [Period, string][] = [
  ['all', 'Tout'],
  ['90', `90${NB}j`],
  ['30', `30${NB}j`],
  ['7', `7${NB}j`],
]
/** Les bascules de poste : tous, puis chaque poste du relevé (celui-ci d'abord) ; rien avec un seul poste. */
const machineToggles = (s: Snapshot): [Machine, string][] =>
  s.machines.length > 1 ? [['all', `Tous${NB}les${NB}postes`], ...s.machines.map((m): [Machine, string] => [m, m.replace(/ /g, NB)])] : []

/** Les données que seul ce poste connaît (cache de /stats, blocs de 5 h) valent pour la vue. */
const isLocalView = (ctx: Ctx): boolean => ctx.f.machine === 'all' || ctx.f.machine === ctx.s.machine

/** Le poste choisi n'a publié que des totaux par jour (l'ancien serveur) : pas de sessions. */
const lacksSessions = (ctx: Ctx): boolean => ctx.f.machine !== 'all' && ctx.s.sessionless.includes(ctx.f.machine)

/** Carte d'en-tête : titre, fraîcheur et ↻, période, machine, filtres, couverture, avertissements. */
const header = (k: Kit, view: View, ctx: Ctx, act: Actions): unknown => {
  const { Box, Button } = k
  const s = ctx.s
  const m = view.meta
  const ui = ctx.ui
  const status = m.loading ? T(k, `relevé${NB}en${NB}cours…`, { color: C.tangerine }) : T(k, `relevé${NB}${ago(s.fetchedAt, view.now)}`, { dim: true })
  const days = daysBetween(ctx.from, ctx.today) + 1
  const coverage = [
    `${fmtDate(ctx.from, ctx.from.slice(0, 4) !== ctx.today.slice(0, 4))}${NB}→${NB}${fmtDate(ctx.today)}`,
    plural(days, 'jour'),
    s.version ? `ccusage${NB}${s.version}` : null,
    s.isOffline ? `prix${NB}hors${NB}ligne` : null,
  ]
    .filter(Boolean)
    .join(SEP)
  const isHereOn = ctx.here !== null && ui.project === ctx.here
  const hasHere = ctx.here !== null && s.rows.some((r) => groupOf(r.project, s.projects) === ctx.here)
  const machines = machineToggles(s)
  const filters = [
    ui.project && !isHereOn && <Button key="clear-project" plain={true} label={`⌂${NB}${nameOf(ctx, ui.project)}${NB}✕`} onPress={() => act.setUi({ project: null })} />,
    ui.model && <Button key="clear-model" plain={true} label={`◆${NB}${modelName(ui.model)}${NB}✕`} onPress={() => act.setUi({ model: null })} />,
  ].filter(isShown)
  const unpriced = s.unpriced.map(modelName)
  return (
    <Box key="head" flexDirection="column" borderStyle="round" borderColor={BRAND} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexShrink={1}>{chip(k, `◆${NB}Stats${NB}Claude${NB}Code`, BRAND, { wrap: 'truncate-end' })}</Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={1} alignItems="center">
          <Box marginRight={1}>{status}</Box>
          <Button key="refresh" plain={true} label={`↻${NB}Actualiser`} onPress={() => act.refresh()} />
        </Box>
      </Box>
      <Box marginTop={1}>
        {line(
          k,
          [
            ...PERIODS.map(([p, label]) => toggle(k, `period-${p}`, label, ui.period === p, () => act.setUi({ period: p }))),
            machines.length > 0 && T(k, '│', { dim: true }),
            ...machines.map(([x, label]) => toggle(k, `machine-${x}`, label, ctx.f.machine === x, () => act.setUi({ machine: x }))),
            hasHere && T(k, '│', { dim: true }),
            hasHere && toggle(k, 'here', `⌂${NB}Ce${NB}projet`, isHereOn, () => act.setUi({ project: isHereOn ? null : ctx.here })),
          ],
          true,
        )}
      </Box>
      {filters.length > 0 && <Box marginTop={1}>{line(k, [T(k, 'Filtres', { dim: true }), ...filters], true)}</Box>}
      <Box marginTop={1}>{T(k, coverage, { dim: true, wrap: 'truncate-end' })}</Box>
      {unpriced.length > 0 && T(k, `⚠${NB}Sans prix connu chez ccusage, compté 0${NB}$ : ${unpriced.join(', ')}`, { color: C.amber, wrap: 'wrap' })}
      {s.keptDays > 0 && T(k, `↺${NB}${plural(s.keptDays, 'jour gardé', 'jours gardés')} par le mod : Claude Code a effacé leurs journaux.`, { dim: true, wrap: 'wrap' })}
      {s.warnings.map((w) => T(k, `⚠${NB}${w}`, { color: C.amber, wrap: 'wrap' }))}
    </Box>
  )
}

/** La zone d'activité, toujours juste sous l'en-tête : relevé en cours, dernier message. */
const activity = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const m = view.meta
  const said = view.notice
  const secs = m.startedAt ? Math.max(0, Math.round((view.now - m.startedAt) / 1000)) : 0
  const rows = [
    m.loading && line(k, [spinner(k, C.tangerine, view.now, 'relevé'), T(k, `${m.loading}${secs >= 2 ? ` (${secs}${NB}s)` : ''}`, { color: C.tangerine, wrap: 'truncate-end' })]),
    said && (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexShrink={1}>{T(k, said.text, { color: TONE[said.tone], wrap: 'wrap' })}</Box>
        {said.tone === 'error' && (
          <Box flexShrink={0} marginLeft={1}>
            <Button key="notice-dismiss" plain={true} dimColor={true} label="x" onPress={() => act.dismissNotice()} />
          </Box>
        )}
      </Box>
    ),
  ].filter(isShown)
  if (rows.length === 0) return null
  return (
    <Box key="activity" flexDirection="column" marginTop={1} paddingX={1}>
      {rows}
    </Box>
  )
}

const tabsRow = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  return (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" marginTop={1}>
      {TABS.map(([tab, label]) => (
        <Box marginRight={2}>
          <Button key={`tab-${tab}`} plain={true} dimColor={tab !== view.ui.tab} label={tab === view.ui.tab ? `▸${NB}${label}` : label} onPress={() => act.setUi({ tab })} />
        </Box>
      ))}
    </Box>
  )
}

// ─── Rythme horaire : le feu ──────────────────────────────────────────────

/** Les couleurs des cinq niveaux (calme → en feu), dans l'ordre de `heatOf`. */
const HEAT_COLORS = [C.teal, C.amber, C.tangerine, C.coral, C.red] as const

/** Le feu d'un rythme horaire : une flamme SVG ; sur le terminal, quatre crans colorés et 🔥 au dernier niveau. */
const flame = (k: Kit, perHour: number, height = 14): unknown => {
  const heat = rateHeat(perHour)
  if (k.isRich) return svgOf(k, flameSvg(heat.level, height), `Rythme ${fmtCostShort(perHour)}/h : ${heat.label}`)
  const notches = [1, 2, 3, 4].map((i) => T(k, i <= heat.level ? '▰' : '▱', i <= heat.level ? { color: HEAT_COLORS[i] } : { color: C.gray, dim: true }))
  return TT(k, [...notches, heat.level === 4 ? T(k, `${NB}🔥`) : ''])
}

/** « 48 $/h » à la couleur de son niveau, en gras dès « intense ». */
const rateText = (k: Kit, perHour: number, withLabel = false): unknown => {
  const heat = rateHeat(perHour)
  return T(k, `${fmtCostShort(perHour)}/h${withLabel ? `${NB}·${NB}${heat.label}` : ''}`, { color: heat.color, bold: heat.level >= 3 })
}

/** La jauge du rythme : SVG en dégradé et seuils, ou cinq zones de blocs colorées sur le terminal. */
const heatGauge = (k: Kit, perHour: number, cells: number): unknown => {
  if (k.isRich) return svgOf(k, heatGaugeSvg({ perHour, thresholds: RATE_LEVELS, colors: HEAT_COLORS, width: px(cells) }), `Jauge du rythme : ${fmtCostShort(perHour)}/h, ${rateHeat(perHour).label}`)
  const { Box } = k
  const zone = Math.max(2, Math.floor(cells / 5))
  const edges = [0, ...RATE_LEVELS, RATE_LEVELS[3] * 2]
  const parts: unknown[] = []
  for (let i = 0; i < 5; i++) {
    const lo = edges[i]!
    const hi = edges[i + 1]!
    const fill = perHour >= hi ? zone : perHour <= lo ? 0 : Math.max(1, Math.round(((perHour - lo) / (hi - lo)) * zone))
    if (fill > 0) parts.push(T(k, '█'.repeat(fill), { color: HEAT_COLORS[i] }))
    if (zone - fill > 0) parts.push(T(k, '░'.repeat(zone - fill), { color: HEAT_COLORS[i], dim: true }))
  }
  const ticks = RATE_LEVELS.map((t) => String(t).padStart(zone, NB)).join('')
  return (
    <Box flexDirection="column">
      <Box>{TT(k, parts)}</Box>
      {T(k, ticks, { dim: true })}
    </Box>
  )
}

// ─── Discussion ouverte ───────────────────────────────────────────────────

/**
 * Les chiffres de la discussion ouverte, une source chacun : le coût du moteur (comme /cost) ;
 * les tokens de ccusage (détail au dernier ↻, sinon la session du relevé), plus les tours finis
 * depuis, et ceux des sous-agents de workflow qu'elle a lancés.
 */
export function figuresOf(view: View): { cost: number | null; tokens: number | null; own: SessionRow | null; children: SessionRow[] } {
  const d = view.discussion
  const s = view.snapshot
  const own = (d.id && s?.sessions.find((x) => x.id === d.id)) || null
  const children = d.id && s ? s.sessions.filter((x) => x.parent === d.id) : []
  const base = d.detail ? { at: d.detail.fetchedAt, tokens: d.detail.tokens, cost: d.detail.cost } : own && s ? { at: s.fetchedAt, tokens: own.tokens, cost: own.cost } : null
  const later = d.turns.filter((t) => !base || t.at > base.at).reduce((n, t) => n + t.tokens, 0)
  const kids = children.reduce((n, x) => n + x.tokens, 0)
  const tokens = base ? base.tokens + later + kids : d.turns.length ? later : null
  const cost = d.live?.cost ?? (base ? base.cost + children.reduce((n, x) => n + x.cost, 0) : null)
  return { cost, tokens, own, children }
}

const discussionTab = (k: Kit, view: View, ctx: Ctx, act: Actions): unknown => {
  const { Box, Button } = k
  const d = view.discussion
  const live = d.live
  const fig = figuresOf(view)
  const tz = ctx.s.tzOffset
  const metric = ctx.metric
  const entries = d.detail?.entries ?? []
  const costs = d.detail ? estimateCosts(entries, d.detail.cost, unitPricesOf(ctx.s.rows)) : []
  const startedAt = live?.startedAt ?? entries[0]?.[0] ?? fig.own?.first ?? null
  const elapsed = startedAt ? Math.max(0, view.now - startedAt) : 0
  const project = fig.own ? groupOf(fig.own.project, ctx.s.projects) : ctx.here
  const isToday = (ms: number) => dayOf(ms, tz) === ctx.today
  const when = (ms: number) => (isToday(ms) ? hhmm(ms, tz) : `${fmtDate(dayOf(ms, tz))}${NB}${hhmm(ms, tz)}`)
  // Rythme : la dernière heure d'appels (l'intensité du moment), et la moyenne depuis le début.
  const hourAgo = view.now - 3_600_000
  const lastHour = d.detail && view.now - d.detail.fetchedAt < 30 * 60_000 ? entries.reduce((n, e, i) => (e[0] > hourAgo ? n + (costs[i] ?? 0) : n), 0) : null
  const average = fig.cost !== null && elapsed > 6 * 60_000 ? fig.cost / (elapsed / 3_600_000) : null
  const totals = entries.reduce((t, e) => ({ input: t.input + e[2], output: t.output + e[3], cacheWrite: t.cacheWrite + e[4], cacheRead: t.cacheRead + e[5] }), { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })
  const cacheShare = totals.input + totals.cacheWrite + totals.cacheRead > 0 ? totals.cacheRead / (totals.input + totals.cacheWrite + totals.cacheRead) : null
  const turns = live?.turns ?? 0

  const status = d.loading
    ? line(k, [spinner(k, C.tangerine, view.now, 'détail'), T(k, 'ccusage…', { color: C.tangerine })])
    : d.detail
      ? T(k, `détail${NB}${ago(d.detail.fetchedAt, view.now)}`, { dim: true })
      : null
  const head = (
    <Box key="disc-head" flexDirection="column" borderStyle="round" borderColor={C.violet} paddingX={1} marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexShrink={1}>{chip(k, `◉${NB}Cette${NB}discussion`, C.violet, { wrap: 'truncate-end' })}</Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={1} alignItems="center">
          {status && <Box marginRight={1}>{status}</Box>}
          <Button key="discussion-refresh" plain={true} label={`↻${NB}Discussion`} onPress={() => act.refreshDiscussion()} />
        </Box>
      </Box>
      <Box marginTop={1}>
        {T(
          k,
          [
            project ? nameOf(ctx, project) : null,
            live?.model ? modelName(live.model) : null,
            turns ? plural(turns, 'tour') : null,
            startedAt ? `commencée ${ago(startedAt, view.now)}` : null,
            d.id ? `id ${d.id.slice(0, 8)}` : null,
          ]
            .filter(Boolean)
            .join(SEP),
          { dim: true, wrap: 'truncate-end' },
        )}
      </Box>
      {T(k, 'Les filtres de période, de machine et de projet ne s’appliquent pas à cet onglet.', { dim: true, italic: true, wrap: 'wrap' })}
      {d.error && T(k, d.error, { color: C.red, wrap: 'wrap' })}
    </Box>
  )

  // La carte du coût : le moteur pour le chiffre, la courbe cumulée de l'estimation par appel.
  let run = 0
  const curve = costs.map((c) => (run += c))
  const sub = [entries.length ? plural(entries.length, 'appel API', 'appels API') : null, turns && fig.cost !== null ? `moy. ${fmtCost(fig.cost / turns)} par tour` : null, live?.cost !== null && live ? 'coût du moteur (/cost)' : 'coût de ccusage']
    .filter(Boolean)
    .join(' · ')
  const value = fig.cost !== null ? fmtCost(fig.cost) : '—'
  const hero = k.isRich ? (
    <Box key="disc-hero" borderStyle="round" borderColor={MONEY} paddingX={1} marginTop={1}>
      {svgOf(k, heroSvg({ label: 'Coût de cette discussion', value, sub, delta: null, deltaColor: C.green, values: sampleLast(curve, 120), color: MONEY, width: px(ctx.inner) }), `Coût de cette discussion : ${value}. ${sub}`)}
    </Box>
  ) : (
    <Box key="disc-hero" flexDirection="column" borderStyle="round" borderColor={MONEY} paddingX={1} marginTop={1}>
      {T(k, 'COÛT DE CETTE DISCUSSION', { dim: true, bold: true })}
      <Box marginTop={1}>{chip(k, value, MONEY)}</Box>
      {T(k, sub, { dim: true, wrap: 'truncate-end' })}
      {curve.length > 1 && <Box marginTop={1}>{columnsChart(k, 'discussion-curve', resample(costs, Math.max(8, ctx.inner - 2)), 3, MONEY)}</Box>}
    </Box>
  )

  // Le rythme : la flamme, le chiffre, la jauge et ses niveaux.
  const shown = lastHour ?? average
  const rateCard =
    shown !== null
      ? card(k, 'disc-rate', 'Rythme', rateHeat(shown).color, T(k, lastHour !== null ? 'dernière heure' : 'moyenne depuis le début', { dim: true }), [
          <Box flexDirection="row" alignItems="center" marginTop={1}>
            <Box marginRight={1}>{flame(k, shown, 28)}</Box>
            {rateText(k, shown, true)}
            {lastHour !== null && average !== null && <Box marginLeft={2}>{T(k, `moyenne ${fmtCostShort(average)}/h`, { dim: true })}</Box>}
          </Box>,
          <Box marginTop={1}>{heatGauge(k, shown, Math.min(ctx.inner, 60))}</Box>,
          say(k, heatLegend()),
        ])
      : null

  const window = live?.window ?? null
  const tiles: Tile[] = ([
    fig.tokens !== null ? { key: 'd-tokens', label: 'Tokens', value: fmtTokens(fig.tokens), sub: entries.length ? `entrée ${fmtTokens(totals.input)} · sortie ${fmtTokens(totals.output)}` : 'au dernier relevé', color: BRAND } : null,
    cacheShare !== null ? { key: 'd-cache', label: 'Lu en cache', value: fmtPct(cacheShare), sub: `lu ${fmtTokens(totals.cacheRead)} · écrit ${fmtTokens(totals.cacheWrite)}`, color: C.teal } : null,
    live?.contextPercent !== null && live?.contextPercent !== undefined
      ? { key: 'd-context', label: 'Contexte', value: fmtPct(live.contextPercent / 100), sub: live.contextTokens !== null && window ? `${fmtTokens(live.contextTokens)} sur ${fmtTokens(window)}` : 'de la fenêtre', color: live.contextPercent >= 80 ? C.red : live.contextPercent >= 60 ? C.amber : C.green }
      : null,
    startedAt ? { key: 'd-duration', label: 'Durée', value: fmtDuration(elapsed), sub: 'depuis le début', color: C.lilac } : null,
    entries.length ? { key: 'd-calls', label: 'Appels API', value: fmtInt(entries.length), sub: turns ? `${fmtInt(Math.round(entries.length / turns))} par tour` : 'sur la discussion', color: C.indigo } : null,
    fig.children.length ? { key: 'd-agents', label: 'Sous-agents', value: fmtInt(fig.children.length), sub: `${fmtCost(fig.children.reduce((n, x) => n + x.cost, 0))} · workflows`, color: C.pink } : null,
  ] as (Tile | null)[]).filter((x): x is Tile => x !== null)

  if (d.detail && entries.length === 0) {
    return (
      <Box key="discussion" flexDirection="column">
        {head}
        {hero}
        {rateCard}
        {tileGrid(k, tiles)}
        {card(k, 'disc-none', 'Détail', C.violet, null, [say(k, 'Pas encore d’appel enregistré pour cette discussion : ↻ Discussion après le prochain tour.')])}
      </Box>
    )
  }

  if (!d.detail) {
    return (
      <Box key="discussion" flexDirection="column">
        {head}
        {hero}
        {rateCard}
        {tileGrid(k, tiles)}
        {card(k, 'disc-empty', 'Détail', C.violet, null, [
          say(k, d.loading ? 'ccusage lit la transcription de cette discussion…' : 'Le détail (frise, modèles, appels les plus chers) vient de ccusage, sur cette seule discussion.'),
          !d.loading && (
            <Box marginTop={1}>
              <Button key="discussion-detail" variant="primary" label={`▶${NB}Détailler${NB}la${NB}discussion`} onPress={() => act.refreshDiscussion()} />
            </Box>
          ),
        ])}
      </Box>
    )
  }

  // La frise : des seaux de 5 min à 2 j selon la durée, empilés par modèle, et le cumul.
  const first = entries[0]?.[0] ?? view.now
  const last = Math.max(entries[entries.length - 1]?.[0] ?? view.now, first + 60_000)
  const step = bucketMinutes(first, last) * 60_000
  const start = Math.floor(first / step) * step
  const n = Math.max(1, Math.floor((last - start) / step) + 1)
  const models = unique(entries.map((e) => e[1]))
  const byModel = new Map<string, { cost: number; tokens: number; calls: number }>(models.map((m) => [m, { cost: 0, tokens: 0, calls: 0 }]))
  const buckets = Array.from({ length: n }, () => new Map<string, number>())
  entries.forEach((e, i) => {
    const v = metric === 'cost' ? (costs[i] ?? 0) : entryTokens(e)
    const b = buckets[Math.min(n - 1, Math.floor((e[0] - start) / step))]!
    b.set(e[1], (b.get(e[1]) ?? 0) + v)
    const m = byModel.get(e[1])!
    m.cost += costs[i] ?? 0
    m.tokens += entryTokens(e)
    m.calls += 1
  })
  const ranked = [...byModel.entries()].sort((a, b) => b[1].tokens - a[1].tokens)
  const values = buckets.map((b) => [...b.values()].reduce((s, v) => s + v, 0))
  let cum = 0
  const cumulative = values.map((v) => (cum += v))
  const isLong = last - first > 20 * 3_600_000
  const label = (i: number) => {
    const at = start + i * step
    return isLong ? fmtDate(dayOf(at, tz)) : hhmm(at, tz)
  }
  const stepText = step >= 86_400_000 ? `${step / 86_400_000}${NB}j` : step >= 3_600_000 ? `${step / 3_600_000}${NB}h` : `${step / 60_000}${NB}min`
  const chart = k.isRich
    ? svgOf(
        k,
        stackSvg({
          buckets: buckets.map((b, i) => ({ label: label(i), parts: ranked.map(([m]) => ({ value: b.get(m) ?? 0, color: ctx.colors[m] ?? C.gray })) })),
          width: px(ctx.inner),
          fmt: (v) => fmtMetric(v, metric, true),
          cumulative: n > 1 ? { values: cumulative, color: C.coral, label: `cumul ${fmtMetric(cum, metric, true)}` } : null,
        }),
        `${metric === 'cost' ? 'Coût estimé' : 'Tokens'} par tranche de ${stepText}, empilé par modèle`,
      )
    : (() => {
        const cell = n * 2 <= ctx.inner - 2 ? 2 : 1
        const firstLabel = label(0)
        const lastLabel = label(n - 1)
        const stacks = buckets.map((b) => ranked.map(([m]) => ({ value: b.get(m) ?? 0, color: ctx.colors[m] ?? C.gray })))
        return (
          <Box flexDirection="column">
            {T(k, `max${NB}${fmtMetric(Math.max(...values, 0), metric, true)}`, { dim: true })}
            {columnsChart(k, 'discussion-chart', values, 6, MONEY, cell, -1, stacks)}
            {T(k, `${firstLabel}${NB.repeat(Math.max(1, n * cell - firstLabel.length - lastLabel.length))}${lastLabel}`, { dim: true })}
          </Box>
        )
      })()

  const top = entries
    .map((e, i) => ({ e, cost: costs[i] ?? 0 }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)
  const maxCost = top[0]?.cost ?? 0
  const cells = Math.max(6, Math.min(18, ctx.inner - 50))

  return (
    <Box key="discussion" flexDirection="column">
      {head}
      {hero}
      {rateCard}
      {tileGrid(k, tiles)}
      {card(k, 'disc-chart', `${metric === 'cost' ? 'Coût estimé' : 'Tokens'} par tranche de ${stepText}`, toneOf(metric), metricToggle(k, ctx, act), [
        <Box marginTop={1}>{chart}</Box>,
        <Box marginTop={1}>{line(k, ranked.map(([m]) => TT(k, [T(k, '●', { color: ctx.colors[m] ?? C.gray }), T(k, `${NB}${modelName(m)}`, { dim: true })])), true)}</Box>,
      ])}
      {card(k, 'disc-models', 'Modèles de la discussion', C.violet, null, [
        ...ranked.map(([m, x], i) => (
          <Box key={`dm-${m}`} flexDirection="row" alignItems="center" marginTop={i === 0 ? 1 : 0}>
            <Box width={2} flexShrink={0}>
              {T(k, '●', { color: ctx.colors[m] ?? C.gray })}
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              {TT(k, [T(k, modelName(m), { bold: true }), T(k, `${NB}${NB}${plural(x.calls, 'appel')}`, { dim: true })], { wrap: 'truncate-end' })}
            </Box>
            <Box flexShrink={0} marginLeft={1}>
              {line(k, [
                <Box width={9} justifyContent="flex-end">{T(k, fmtTokens(x.tokens), { color: BRAND })}</Box>,
                <Box width={10} justifyContent="flex-end">{T(k, fmtCost(x.cost), { color: MONEY, bold: true })}</Box>,
              ])}
            </Box>
          </Box>
        )),
      ])}
      {card(k, 'disc-top', 'Appels les plus chers', MONEY, null, [
        ...top.map(({ e, cost }, i) => (
          <Box key={`dt-${i}`} flexDirection="row" alignItems="center" marginTop={i === 0 ? 1 : 0}>
            <Box width={14} flexShrink={0}>
              {T(k, when(e[0]), { dim: true })}
            </Box>
            <Box flexShrink={0} marginRight={1}>
              {meter(k, [{ value: cost, color: MONEY }], maxCost, cells, fmtCost(cost))}
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              {TT(k, [T(k, fmtCost(cost), { color: MONEY, bold: true }), T(k, `${NB}${NB}${modelName(e[1])}${NB}·${NB}${fmtTokens(entryTokens(e))}`, { dim: true })], { wrap: 'truncate-end' })}
            </Box>
          </Box>
        )),
      ])}
      {fig.children.length > 0 &&
        card(k, 'disc-agents', 'Sous-agents de workflow', C.pink, null, [
          ...fig.children.slice(0, 8).map((x, i) => (
            <Box key={`da-${x.id}`} flexDirection="row" marginTop={i === 0 ? 1 : 0}>
              <Box flexGrow={1} flexShrink={1}>
                {T(k, `${when(x.first)}${NB}·${NB}${fmtDuration(x.last - x.first)}`, { dim: true, wrap: 'truncate-end' })}
              </Box>
              {line(k, [T(k, fmtTokens(x.tokens), { color: BRAND }), T(k, fmtCost(x.cost), { color: MONEY, bold: true })])}
            </Box>
          )),
        ])}
      {say(k, 'Coût en tête : celui du moteur (/cost). Tokens et détail : ccusage, au dernier ↻ Discussion. Le coût par appel est estimé : ccusage ne donne que le total, réparti selon les tokens de chaque appel et le barème de son modèle.')}
    </Box>
  )
}

// ─── Journée ──────────────────────────────────────────────────────────────

/** Plafond de la liste des discussions du jour ; les suivantes sont additionnées sur une ligne. */
const DAY_DISCUSSIONS_CAP = 8

/** Une ligne de classement : marque, nom, jauge, valeur, part ; un détail atténué dessous. */
const shareRow = (k: Kit, o: { key: string; mark: unknown; name: unknown; value: number; max: number; share: number; metric: Metric; cells: number; detail: string | null; isFirst: boolean }): unknown => {
  const { Box } = k
  const color = toneOf(o.metric)
  return (
    <Box key={o.key} flexDirection="column" marginTop={o.isFirst ? 1 : 0}>
      <Box flexDirection="row" alignItems="center">
        <Box width={2} flexShrink={0}>
          {o.mark}
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          {o.name}
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          {line(k, [
            meter(k, [{ value: o.value, color }], o.max, o.cells, `${fmtPct(o.share)} du jour`),
            <Box width={10} justifyContent="flex-end">
              {T(k, fmtMetric(o.value, o.metric), { color, bold: true })}
            </Box>,
            <Box width={6} justifyContent="flex-end">
              {T(k, fmtPct(o.share), { dim: true })}
            </Box>,
          ])}
        </Box>
      </Box>
      {o.detail && <Box marginLeft={2}>{T(k, o.detail, { dim: true, wrap: 'truncate-end' })}</Box>}
    </Box>
  )
}

/**
 * Le récap d'une journée : celle du relevé, comme le bandeau (aujourd'hui, ou le jour d'un relevé
 * plus ancien). Les filtres de poste, de projet et de modèle s'appliquent ; la période, non.
 */
const dayTab = (k: Kit, view: View, ctx: Ctx, act: Actions): unknown => {
  const { Box } = k
  const s = ctx.s
  const tz = s.tzOffset
  const metric = ctx.metric
  const day = dayOf(s.fetchedAt, tz)
  const isToday = day === ctx.today
  const dayText = isToday ? 'aujourd’hui' : `le${NB}${fmtDay(day)}`
  // Tous les jours, sous les filtres de poste, de projet et de modèle : le jour et ses 30 jours de comparaison.
  const scope: Filter = { ...ctx.f, from: null }
  const all = selectRows(s.rows, scope, s.projects)
  const rows = all.filter((r) => r.date === day)
  const isFiltered = ctx.f.machine !== 'all' || ctx.f.project !== null || ctx.f.model !== null
  const notes = [
    !isToday && say(k, `Relevé du ${fmtDay(day)} : ↻${NB}Actualiser pour la journée en cours.`, { color: C.amber }),
    ctx.ui.period !== 'all' && say(k, 'La période ne s’applique pas à cet onglet, qui montre une journée ; les filtres de poste, de projet et de modèle, si.', { dim: true, italic: true }),
  ].filter(isShown)
  if (rows.length === 0) {
    return (
      <Box key="day" flexDirection="column">
        {notes}
        {card(k, 'day-empty', cap(isToday ? 'aujourd’hui' : fmtDay(day)), MONEY, null, [say(k, `Aucune consommation ${dayText}${isFiltered ? ' pour ces filtres' : ''}.`)])}
      </Box>
    )
  }

  const t = sum(rows)
  const cmp = compareDay(all, day, 'cost')
  const discussions = lacksSessions(ctx) ? [] : discussionsOfDay(selectSessions(s.sessions, scope, s.projects, tz), day, tz)
  const agents = discussions.reduce((n, d) => n + d.agents, 0)

  // La carte du coût : le chiffre du jour, l'écart avec la veille, la courbe des 30 jours qui finissent ce jour-là.
  const label = isToday ? 'Coût d’aujourd’hui' : `Coût du ${fmtDay(day)}`
  const delta = cmp.previous > 0 ? (t.cost - cmp.previous) / cmp.previous : null
  const deltaText = delta !== null ? `${fmtDelta(delta)} vs la veille` : null
  const deltaColor = delta !== null && delta > 0 ? C.coral : C.green
  const sub = [`${fmtTokens(t.tokens)} tokens`, discussions.length ? plural(discussions.length, 'discussion') : null, `30${NB}j jusqu’au ${fmtDate(day)}`].filter(Boolean).join(' · ')
  const curve = seriesOf(all, 'day', addDays(day, -29), day).map((b) => b.total.cost)
  const hero = k.isRich ? (
    <Box key="day-hero" borderStyle="round" borderColor={MONEY} paddingX={1} marginTop={1}>
      {svgOf(k, heroSvg({ label, value: fmtCost(t.cost), sub, delta: deltaText, deltaColor, values: curve, color: MONEY, width: px(ctx.inner) }), `${label} : ${fmtCost(t.cost)}${deltaText ? `, ${deltaText}` : ''}. ${sub}`)}
    </Box>
  ) : (
    <Box key="day-hero" flexDirection="column" borderStyle="round" borderColor={MONEY} paddingX={1} marginTop={1}>
      {T(k, label.toUpperCase(), { dim: true, bold: true })}
      <Box marginTop={1}>{line(k, [chip(k, fmtCost(t.cost), MONEY), deltaText && T(k, deltaText, { color: deltaColor })])}</Box>
      {T(k, sub, { dim: true, wrap: 'truncate-end' })}
      <Box marginTop={1}>{columnsChart(k, 'day-curve', curve, 3, MONEY, 1, curve.length - 1)}</Box>
    </Box>
  )

  const lead = modelsOf(rows, 'cost')[0]
  // Le cache de /stats a en général un jour de retard : ses messages seulement s'il compte déjà ce jour-là.
  const acts = s.activity && isLocalView(ctx) && !ctx.f.project && !ctx.f.model ? (s.activity.days.find((d) => d.date === day) ?? null) : null
  const tiles: Tile[] = ([
    { key: 'day-tokens', label: 'Tokens', value: fmtTokens(t.tokens), sub: `entrée ${fmtTokens(t.input)} · sortie ${fmtTokens(t.output)}`, color: BRAND },
    { key: 'day-cache', label: 'Lu en cache', value: fmtPct(cacheRatio(t)), sub: `lu ${fmtTokens(t.cacheRead)} · écrit ${fmtTokens(t.cacheWrite)}`, color: C.teal },
    { key: 'day-previous', label: 'La veille', value: fmtCost(cmp.previous), sub: fmtDay(addDays(day, -1)), color: C.slate },
    cmp.average !== null ? { key: 'day-average', label: 'Moyenne sur 30 j', value: fmtCost(cmp.average), sub: `par jour actif · écart ${fmtDelta((t.cost - cmp.average) / cmp.average)}`, color: C.lilac } : null,
    cmp.rank !== null && cmp.activeDays > 1 ? { key: 'day-rank', label: 'Rang sur 30 j', value: cmp.rank === 1 ? 'record' : `n°${NB}${cmp.rank}`, sub: `sur ${plural(cmp.activeDays, 'jour actif', 'jours actifs')}`, color: cmp.rank === 1 ? C.coral : MONEY } : null,
    !lacksSessions(ctx) ? { key: 'day-discussions', label: 'Discussions', value: fmtInt(discussions.length), sub: agents ? `avec ${plural(agents, 'sous-agent')}` : 'actives ce jour-là', color: C.violet } : null,
    lead ? { key: 'day-model', label: 'Modèle principal', value: modelName(lead.model), sub: `${fmtPct(lead.share)} du coût`, color: ctx.colors[lead.model] ?? BRAND } : null,
    acts ? { key: 'day-messages', label: 'Messages (ce poste)', value: fmtInt(acts.messages), sub: `${fmtInt(acts.tools)} appels d’outils`, color: C.indigo } : null,
  ] as (Tile | null)[]).filter((x): x is Tile => x !== null)

  const cells = Math.max(6, Math.min(22, ctx.inner - 46))
  const total = valueOf(t, metric)
  // Une seule bascule coût / tokens, sur la carte des projets : les autres cartes disent leur mesure.
  const unitText = T(k, metric === 'cost' ? 'en coût' : 'en tokens', { dim: true })

  // Par poste : seulement quand plusieurs postes ont travaillé ce jour-là.
  const machines = ctx.f.machine === 'all' ? s.machines.map((m) => ({ m, total: sum(rows.filter((r) => r.machine === m)) })).filter((x) => valueOf(x.total, metric) > 0) : []
  const machinesCard =
    machines.length > 1
      ? card(k, 'day-machines', 'Par poste', toneOf(metric), unitText, [
          ...machines.map((x, i) =>
            shareRow(k, {
              key: `day-machine-${x.m}`,
              mark: T(k, x.m === s.machine ? '●' : '○', { color: x.m === s.machine ? BRAND : C.gray }),
              name: TT(k, [T(k, x.m.replace(/ /g, NB), { bold: true }), x.m === s.machine ? T(k, `${NB}${NB}ce poste`, { color: BRAND }) : ''], { wrap: 'truncate-end' }),
              value: valueOf(x.total, metric),
              max: valueOf(machines[0]!.total, metric),
              share: total > 0 ? valueOf(x.total, metric) / total : 0,
              metric,
              cells,
              detail: null,
              isFirst: i === 0,
            }),
          ),
          say(k, 'Les autres postes comptent jusqu’à leur dernière publication dans claude-usage.'),
        ])
      : null

  const projects = projectsOf(rows, [], s.projects, metric)
  const projectsCard = card(k, 'day-projects', 'Projets du jour', toneOf(metric), metricToggle(k, ctx, act), [
    ...projects.slice(0, PROJECTS_CAP).map((p, i) => {
      const isHere = p.key === ctx.here
      const count = discussions.filter((d) => groupOf(d.project, s.projects) === p.key).length
      const detail = [count ? plural(count, 'discussion') : null, elsewhere(ctx, p.byMachine, metric)].filter(Boolean).join(SEP)
      return shareRow(k, {
        key: `day-project-${p.key}`,
        mark: T(k, isHere ? '●' : '○', { color: isHere ? BRAND : C.gray, bold: isHere }),
        name: TT(k, [T(k, nameOf(ctx, p.key), { bold: true }), isHere ? T(k, `${NB}${NB}ce projet`, { color: BRAND }) : ''], { wrap: 'truncate-end' }),
        value: valueOf(p.total, metric),
        max: projects.length ? valueOf(projects[0]!.total, metric) : 0,
        share: p.share,
        metric,
        cells,
        detail: detail || null,
        isFirst: i === 0,
      })
    }),
    projects.length > PROJECTS_CAP && say(k, `… ${plural(projects.length - PROJECTS_CAP, 'autre projet', 'autres projets')} : ${fmtMetric(projects.slice(PROJECTS_CAP).reduce((n, p) => n + valueOf(p.total, metric), 0), metric)}.`),
  ])

  // Les discussions : une heure ce jour-là, une date sinon (commencée avant, ou finie après).
  const at = (ms: number) => (dayOf(ms, tz) === day ? hhmm(ms, tz) : fmtDate(dayOf(ms, tz)))
  const isMulti = ctx.f.machine === 'all' && s.machines.length > 1
  const rest = discussions.slice(DAY_DISCUSSIONS_CAP)
  const discussionsCard = lacksSessions(ctx)
    ? card(k, 'day-discussions', 'Discussions du jour', C.violet, null, [say(k, `${ctx.f.machine} n’a publié que des totaux par jour : pas de détail des discussions.`)])
    : discussions.length > 0
      ? card(k, 'day-discussions', 'Discussions du jour', C.violet, T(k, plural(discussions.length, 'discussion'), { dim: true }), [
          ...discussions.slice(0, DAY_DISCUSSIONS_CAP).map((d, i) => (
            <Box key={`day-disc-${d.id}`} flexDirection="row" alignItems="center" marginTop={i === 0 ? 1 : 0}>
              <Box width={14} flexShrink={0}>
                {T(k, `${at(d.first)}–${at(d.last)}`, { dim: true, wrap: 'truncate-end' })}
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                {TT(
                  k,
                  [
                    T(k, nameOf(ctx, groupOf(d.project, s.projects)), { bold: true }),
                    d.id === view.discussion.id ? T(k, `${NB}${NB}celle-ci`, { color: C.violet }) : '',
                    isMulti ? T(k, `${NB}·${NB}${d.machine}`, { dim: true }) : '',
                    d.agents ? T(k, `${NB}·${NB}+${plural(d.agents, 'sous-agent')}`, { dim: true }) : '',
                  ],
                  { wrap: 'truncate-end' },
                )}
              </Box>
              <Box flexShrink={0} marginLeft={1}>
                {/* Largeurs fixes : modèles, tokens et coûts en colonnes. */}
                {line(k, [
                  ctx.inner >= 50 && <Box width={4}>{modelDots(k, ctx, d.models)}</Box>,
                  ctx.inner >= 70 && <Box width={8} justifyContent="flex-end">{T(k, fmtTokens(d.tokens), { color: BRAND, dim: true })}</Box>,
                  <Box width={9} justifyContent="flex-end">{T(k, fmtCost(d.cost), { color: MONEY, bold: true })}</Box>,
                ])}
              </Box>
            </Box>
          )),
          rest.length > 0 && say(k, `… ${plural(rest.length, 'autre discussion', 'autres discussions')} : ${fmtCost(rest.reduce((n, d) => n + d.cost, 0))}.`),
          say(k, 'Coût de chaque discussion : son total, sous-agents et jours précédents compris (ccusage ne le découpe pas par jour). D’où un total qui peut dépasser celui du jour.'),
        ])
      : null

  const models = modelsOf(rows, metric)
  const modelsCard = card(k, 'day-models', 'Modèles du jour', toneOf(metric), unitText, [
    ...models.map((m, i) =>
      shareRow(k, {
        key: `day-model-${m.model}`,
        mark: T(k, '●', { color: ctx.colors[m.model] ?? C.gray }),
        name: TT(k, [T(k, modelName(m.model), { bold: true }), T(k, `${NB}${NB}${metric === 'cost' ? `${fmtTokens(m.total.tokens)}${NB}tokens` : fmtCost(m.total.cost)}`, { dim: true })], { wrap: 'truncate-end' }),
        value: valueOf(m.total, metric),
        max: models.length ? valueOf(models[0]!.total, metric) : 0,
        share: m.share,
        metric,
        cells,
        detail: null,
        isFirst: i === 0,
      }),
    ),
  ])

  // Les blocs de 5 h du jour : ce poste seul, tous projets (ccusage ne les sépare pas).
  const dayBlocks = isLocalView(ctx) ? blocksOfDay(s.blocks, day, tz) : []
  const blocksCard =
    dayBlocks.length > 0
      ? card(k, 'day-blocks', 'Blocs de 5 h', C.tangerine, T(k, `ce${NB}poste, tous projets`, { dim: true }), [
          ...dayBlocks.map((b, i) => {
            const rate = blockRate(b)
            const isActive = b.isActive && b.end > ctx.now
            return (
              <Box key={`day-block-${b.start}`} marginTop={i === 0 ? 1 : 0}>
                {line(
                  k,
                  [
                    T(k, `${hhmm(b.start, tz)}–${hhmm(b.end, tz)}`, isActive ? { color: C.tangerine, bold: true } : { dim: true }),
                    T(k, fmtCost(b.cost), { color: MONEY, bold: true }),
                    T(k, `${fmtTokens(b.tokens)}${NB}tokens`, { color: BRAND }),
                    rate !== null && line(k, [flame(k, rate, 14), rateText(k, rate, true)]),
                    isActive && T(k, `en${NB}cours, reste${NB}${fmtDuration(b.end - ctx.now)}`, { color: C.tangerine }),
                    isActive && b.projectedCost !== null && T(k, `projection${NB}${fmtCost(b.projectedCost)}`, { dim: true }),
                    modelDots(k, ctx, b.models),
                  ],
                  true,
                )}
              </Box>
            )
          }),
          say(k, `Rythme : dépense par heure active du bloc (celui de ccusage pour le bloc en cours). ${heatLegend()}`),
        ])
      : null

  return (
    <Box key="day" flexDirection="column">
      {notes}
      {hero}
      {tileGrid(k, tiles)}
      {projectsCard}
      {machinesCard}
      {discussionsCard}
      {modelsCard}
      {blocksCard}
    </Box>
  )
}

// ─── Aperçu ───────────────────────────────────────────────────────────────

type Tile = { key: string; label: string; value: string; sub: string; color: string }

/** Des tuiles en grille : le nombre de colonnes qui ne laisse pas de tuile seule ; sinon la dernière prend toute la rangée. */
const tileGrid = (k: Kit, tiles: readonly Tile[]): unknown => {
  const { Box } = k
  const room = k.width - 2
  const most = Math.max(1, Math.min(4, Math.floor(room / 24)))
  const cols = [most, most - 1].find((c) => c >= 2 && tiles.length % c !== 1) ?? most
  const tw = Math.max(16, Math.floor(room / cols) - 1)
  const isAlone = cols > 1 && tiles.length % cols === 1
  return (
    <Box key="tiles" flexDirection="row" flexWrap="wrap">
      {tiles.map((t, i) => (
        <Box key={`tile-${t.key}`} flexDirection="column" width={isAlone && i === tiles.length - 1 ? cols * (tw + 1) - 1 : tw} borderStyle="round" borderDimColor={true} paddingX={1} marginRight={1} marginTop={1}>
          {T(k, t.label, { dim: true, wrap: 'truncate-end' })}
          {T(k, t.value, { color: t.color, bold: true, wrap: 'truncate-end' })}
          {T(k, t.sub, { dim: true, wrap: 'truncate-end' })}
        </Box>
      ))}
    </Box>
  )
}

/** Les jours actifs de l'activité de /stats sur la période ; null quand un filtre la rend fausse. */
const activityDays = (ctx: Ctx) => {
  const a = ctx.s.activity
  if (!a || !isLocalView(ctx) || ctx.f.project || ctx.f.model) return null
  return a.days.filter((d) => (!ctx.f.from || d.date >= ctx.f.from) && d.date <= ctx.today)
}

const overviewTab = (k: Kit, ctx: Ctx, act: Actions): unknown => {
  const { Box } = k
  const t = ctx.total
  const dates = activeDates(ctx.rows)
  const span = daysBetween(ctx.from, ctx.today) + 1
  const streak = streaksOf(dates, ctx.today)
  const prevF = previousOf(ctx.f)
  const prev = prevF ? sum(selectRows(ctx.s.rows, prevF, ctx.s.projects)) : null
  const daily = seriesOf(ctx.rows, 'day', ctx.from, ctx.today)
  const models = modelsOf(ctx.rows, 'tokens')
  const fav = models[0]
  const peak = daily.reduce((best, b) => (valueOf(b.total, ctx.metric) > valueOf(best.total, ctx.metric) ? b : best), daily[0] ?? { key: ctx.today, total: zero(), byModel: new Map() })
  const delta = prev && prev.cost > 0 ? (t.cost - prev.cost) / prev.cost : null
  const deltaText = delta !== null && prevF ? `${fmtDelta(delta)} vs ${daysBetween(prevF.from ?? ctx.from, prevF.to) + 1}${NB}j d’avant` : null
  const sub = `${plural(dates.length, 'jour actif', 'jours actifs')} · moy. ${fmtCost(t.cost / Math.max(1, dates.length))} par jour actif`

  // La carte du coût : grand chiffre, variation, courbe de la période.
  const costValues = resample(
    daily.map((b) => b.total.cost),
    120,
  )
  const hero = k.isRich ? (
    <Box key="hero" borderStyle="round" borderColor={MONEY} paddingX={1} marginTop={1}>
      {svgOf(
        k,
        heroSvg({ label: 'Coût équivalent API', value: fmtCost(t.cost), sub, delta: deltaText, deltaColor: delta !== null && delta > 0 ? C.coral : C.green, values: costValues, color: MONEY, width: px(ctx.inner) }),
        `Coût équivalent API : ${fmtCost(t.cost)}. ${sub}${deltaText ? `. ${deltaText}` : ''}`,
      )}
    </Box>
  ) : (
    <Box key="hero" flexDirection="column" borderStyle="round" borderColor={MONEY} paddingX={1} marginTop={1}>
      {T(k, 'COÛT ÉQUIVALENT API', { dim: true, bold: true })}
      <Box marginTop={1}>{line(k, [chip(k, fmtCost(t.cost), MONEY), deltaText && T(k, deltaText, { color: delta !== null && delta > 0 ? C.coral : C.green })])}</Box>
      {T(k, sub, { dim: true, wrap: 'truncate-end' })}
      {costValues.length > 1 && <Box marginTop={1}>{columnsChart(k, 'overview-curve', resample(costValues, Math.max(8, ctx.inner - 2)), 3, MONEY)}</Box>}
    </Box>
  )

  const acts = activityDays(ctx)
  const longest = ctx.sessions.reduce<SessionRow | null>((best, s) => (!best || s.last - s.first > best.last - best.first ? s : best), null)
  const hours = ctx.s.activity?.hours ?? []
  const peakHour = hours.length ? hours.indexOf(Math.max(...hours)) : -1
  const tiles: Tile[] = [
    { key: 'tokens', label: 'Tokens', value: fmtTokens(t.tokens), sub: `entrée ${fmtTokens(t.input)} · sortie ${fmtTokens(t.output)}`, color: BRAND },
    { key: 'cache', label: 'Lu en cache', value: fmtPct(cacheRatio(t)), sub: `lu ${fmtTokens(t.cacheRead)} · écrit ${fmtTokens(t.cacheWrite)}`, color: C.teal },
    { key: 'days', label: 'Jours actifs', value: `${dates.length}/${span}`, sub: `record ${streak.longest}${NB}j · en cours ${streak.current}${NB}j`, color: C.green },
    fav ? { key: 'fav', label: 'Modèle favori', value: modelName(fav.model), sub: `${fmtPct(fav.share)} des tokens`, color: ctx.colors[fav.model] ?? BRAND } : null,
    valueOf(peak.total, ctx.metric) > 0 ? { key: 'peak', label: 'Jour record', value: fmtDay(peak.key), sub: fmtMetric(valueOf(peak.total, ctx.metric), ctx.metric), color: toneOf(ctx.metric) } : null,
    !lacksSessions(ctx)
      ? { key: 'sessions', label: 'Sessions', value: fmtInt(ctx.sessions.length), sub: ctx.sessions.length ? `moy. ${fmtCost(ctx.sessions.reduce((n, s) => n + s.cost, 0) / ctx.sessions.length)} / session` : 'aucune sur la période', color: C.violet }
      : null,
    acts && acts.length ? { key: 'messages', label: 'Messages (ce poste)', value: fmtInt(acts.reduce((n, d) => n + d.messages, 0)), sub: `${fmtInt(acts.reduce((n, d) => n + d.tools, 0))} appels d’outils`, color: C.indigo } : null,
    peakHour >= 0 && hours[peakHour]! > 0 && !ctx.f.project && !ctx.f.model && isLocalView(ctx) ? { key: 'hour', label: 'Heure de pointe (ce poste)', value: `${peakHour}${NB}h`, sub: 'début des sessions', color: C.pink } : null,
    longest ? { key: 'longest', label: 'Plus longue session', value: fmtDuration(longest.last - longest.first), sub: nameOf(ctx, groupOf(longest.project, ctx.s.projects)), color: C.lilac } : null,
  ].filter((x): x is Tile => x !== null)

  const fact = funFact(t.output)
  return (
    <Box key="overview" flexDirection="column">
      {hero}
      {tileGrid(k, tiles)}
      {heatCard(k, ctx, act)}
      {fact && <Box marginTop={1}>{T(k, `✦${NB}${fact}`, { color: C.lilac, wrap: 'wrap' })}</Box>}
    </Box>
  )
}

// ─── Calendrier ───────────────────────────────────────────────────────────

const MONTH_TEXT = (date: string): string => monthShort(date).replace('.', '')

/** Le calendrier : semaines du lundi, niveaux par quartiles des jours actifs (comme GitHub). */
function heatOf(values: Map<string, number>, from: string, to: string, maxWeeks: number, today: string) {
  const lastMonday = weekOf(to)
  const count = Math.floor(daysBetween(weekOf(from), lastMonday) / 7) + 1
  const n = Math.max(1, Math.min(maxWeeks, count))
  const firstMonday = addDays(lastMonday, -(n - 1) * 7)
  const start = from > firstMonday ? from : firstMonday
  const nonzero = [...values.entries()]
    .filter(([d, v]) => v > 0 && d >= start)
    .map(([, v]) => v)
    .sort((a, b) => a - b)
  const q = (p: number): number => nonzero[Math.floor((nonzero.length - 1) * p)] ?? 0
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)]
  const level = (v: number): number => (v <= 0 ? 0 : v <= q1 ? 1 : v <= q2 ? 2 : v <= q3 ? 3 : 4)
  const weeks: HeatCell[][] = []
  const months: { index: number; label: string }[] = []
  for (let i = 0; i < n; i++) {
    const monday = addDays(firstMonday, i * 7)
    const week: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(monday, d)
      week.push(date < start || date > to ? null : { date, level: level(values.get(date) ?? 0), isToday: date === today })
    }
    weeks.push(week)
    const firstOfMonth = [0, 1, 2, 3, 4, 5, 6].map((d) => addDays(monday, d)).find((d) => d.endsWith('-01'))
    if (i === 0 || firstOfMonth) months.push({ index: i, label: MONTH_TEXT(firstOfMonth ?? addDays(monday, 6)) })
  }
  return { weeks, months, start }
}

const GLYPHS = ['·', '░', '▒', '▓', '█']

const HEAT_DAYS = ['L', '', 'M', '', 'V', '', '']

/** Les mois au-dessus du calendrier, alignés sur ses colonnes (`cell` par semaine). */
const heatMonths = (k: Kit, hm: ReturnType<typeof heatOf>, cell: number): unknown => {
  const n = hm.weeks.length * cell
  const head = Array<string>(n).fill(NB)
  let next = 0
  for (const m of hm.months) {
    const at = m.index * cell
    if (at < next || at + m.label.length > n) continue
    for (let j = 0; j < m.label.length; j++) head[at + j] = m.label[j]!
    next = at + m.label.length + 1
  }
  return <k.Box key="months">{T(k, `${NB}${NB}${NB}${head.join('')}`, { dim: true })}</k.Box>
}

/** Le calendrier en grille de cases : les jours à la teinte de leur niveau, mois, jours et légende en texte autour. */
const heatRaster = (k: Kit, hm: ReturnType<typeof heatOf>, color: string, cell: number): unknown => {
  const { Box } = k
  return (
    <Box flexDirection="column">
      {heatMonths(k, hm, cell)}
      <Box key="grid" flexDirection="row">
        <Box flexDirection="column" width={3} flexShrink={0}>
          {HEAT_DAYS.map((d, i) => (
            <Box key={`l${i}`}>{T(k, d || NB, { dim: true })}</Box>
          ))}
        </Box>
        {raster(k, 'heat', heatCells(hm.weeks, color, cell))}
      </Box>
      <Box key="legend" flexDirection="row">
        {T(k, `${NB}${NB}${NB}Moins${NB}`, { dim: true })}
        {raster(k, 'heat-legend', heatLegendCells(color))}
        {T(k, `${NB}Plus`, { dim: true })}
      </Box>
    </Box>
  )
}

/** Le calendrier en glyphes : 7 rangées, une colonne par semaine (deux caractères quand la place le permet), mois au-dessus. */
const heatText = (k: Kit, hm: ReturnType<typeof heatOf>, color: string, cell: number): unknown => {
  const { Box } = k
  const rows: unknown[] = [heatMonths(k, hm, cell)]
  const labels = HEAT_DAYS
  for (let d = 0; d < 7; d++) {
    const runs: { text: string; level: number }[] = []
    hm.weeks.forEach((w) => {
      const day = w[d]
      const lv = day ? day.level : -1
      const glyph = (day ? (GLYPHS[lv] ?? '·') : NB) + (cell > 1 ? NB : '')
      const last = runs[runs.length - 1]
      if (last && last.level === lv) last.text += glyph
      else runs.push({ text: glyph, level: lv })
    })
    rows.push(
      <Box key={`d${d}`}>
        {TT(k, [T(k, `${(labels[d] ?? '').padEnd(1, NB)}${NB}${NB}`, { dim: true }), ...runs.map((r) => T(k, r.text, r.level <= 0 ? { color: C.gray, dim: true } : { color }))])}
      </Box>,
    )
  }
  rows.push(<Box key="legend">{TT(k, [T(k, `${NB}${NB}${NB}Moins${NB}`, { dim: true }), ...GLYPHS.map((g, i) => T(k, g, i === 0 ? { color: C.gray, dim: true } : { color })), T(k, `${NB}Plus`, { dim: true })])}</Box>)
  return <Box flexDirection="column">{rows}</Box>
}

const heatCard = (k: Kit, ctx: Ctx, act: Actions): unknown => {
  const values = new Map(seriesOf(ctx.rows, 'day', ctx.from, ctx.today).map((b) => [b.key, valueOf(b.total, ctx.metric)] as const))
  const maxWeeks = k.isRich ? Math.max(4, Math.floor((px(ctx.inner) - 26) / 10)) : Math.max(4, ctx.inner - 3)
  const hm = heatOf(values, ctx.from, ctx.today, maxWeeks, ctx.today)
  const color = toneOf(ctx.metric)
  const active = [...values.entries()].filter(([d, v]) => v > 0 && d >= hm.start).length
  const shown = daysBetween(hm.start, ctx.today) + 1
  const drawing = k.isRich
    ? svgOf(k, heatmapSvg(hm.weeks, hm.months, color, px(ctx.inner)), `Calendrier d'activité : ${active} jours actifs sur ${shown}`)
    : (k.Raster && hm.weeks.length <= 512 ? heatRaster : heatText)(k, hm, color, hm.weeks.length * 2 <= ctx.inner - 3 && hm.weeks.length * 2 <= 512 ? 2 : 1)
  return card(k, 'heat', 'Calendrier d’activité', color, metricToggle(k, ctx, act), [
    <k.Box marginTop={1}>{drawing}</k.Box>,
    hm.start > ctx.from && say(k, `Les ${plural(shown, 'jour')} les plus récents : la largeur ne permet pas plus.`),
  ])
}

// ─── Évolution ────────────────────────────────────────────────────────────

const GRAINS: [Grain, string][] = [
  ['day', 'Jour'],
  ['week', 'Semaine'],
  ['month', 'Mois'],
]
const GRAIN_WORD: Record<Grain, string> = { day: 'jour', week: 'semaine', month: 'mois' }
const GRAIN_ACTIVE: Record<Grain, string> = { day: 'jour actif', week: 'semaine active', month: 'mois actif' }
const GRAIN_PLURAL: Record<Grain, string> = { day: 'jours', week: 'semaines', month: 'mois' }

const bucketLabel = (key: string, grain: Grain): string => (grain === 'month' ? fmtMonthShort(key) : fmtDate(key))

const trendTab = (k: Kit, ctx: Ctx, act: Actions): unknown => {
  const { Box } = k
  const metric = ctx.metric
  const color = toneOf(metric)
  const slots = k.isRich ? Math.floor(px(ctx.inner) / 5) : Math.max(8, ctx.inner - 2)
  const grain = fitGrain(ctx.ui.grain, ctx.from, ctx.today, slots)
  const buckets = seriesOf(ctx.rows, grain, ctx.from, ctx.today)
  const values = buckets.map((b) => valueOf(b.total, metric))
  const models = modelsOf(ctx.rows, metric)
  let run = 0
  const cumulative = values.map((v) => (run += v))
  const total = valueOf(ctx.total, metric)
  const maxIndex = values.indexOf(Math.max(...values))
  const active = values.filter((v) => v > 0)
  const sorted = [...active].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0

  const right = line(k, [...GRAINS.map(([g, label]) => toggle(k, `grain-${g}`, label, ctx.ui.grain === g, () => act.setUi({ grain: g }))), T(k, '│', { dim: true }), metricToggle(k, ctx, act)], true)
  const chart = k.isRich
    ? svgOf(
        k,
        stackSvg({
          buckets: buckets.map((b) => ({
            label: bucketLabel(b.key, grain),
            parts: models.map((m) => ({ value: valueOf(b.byModel.get(m.model) ?? zero(), metric), color: ctx.colors[m.model] ?? C.gray })),
          })),
          width: px(ctx.inner),
          fmt: (v) => fmtMetric(v, metric, true),
          cumulative: buckets.length > 1 ? { values: cumulative, color: C.coral, label: `cumul ${fmtMetric(total, metric, true)}` } : null,
        }),
        `${metric === 'cost' ? 'Coût' : 'Tokens'} par ${GRAIN_WORD[grain]}, empilé par modèle, du ${fmtDate(ctx.from)} au ${fmtDate(ctx.today)} ; cumul ${fmtMetric(total, metric)}`,
      )
    : (() => {
        const cell = buckets.length * 2 <= ctx.inner - 2 ? 2 : 1
        const width = buckets.length * cell
        const first = bucketLabel(buckets[0]?.key ?? ctx.from, grain)
        const last = bucketLabel(buckets[buckets.length - 1]?.key ?? ctx.today, grain)
        // Les barres prennent les couleurs des modèles, du plus utilisé (en bas) au moins utilisé.
        const stacks = buckets.map((b) => models.map((m) => ({ value: valueOf(b.byModel.get(m.model) ?? zero(), metric), color: ctx.colors[m.model] ?? C.gray })))
        return (
          <Box flexDirection="column">
            {T(k, `max${NB}${fmtMetric(Math.max(...values, 0), metric, true)}`, { dim: true })}
            {columnsChart(k, 'trend', values, 7, color, cell, -1, stacks)}
            {T(k, `${first}${NB.repeat(Math.max(1, width - first.length - last.length))}${last}`, { dim: true })}
          </Box>
        )
      })()
  const legend = line(
    k,
    [
      ...models.slice(0, 8).map((m) => TT(k, [T(k, '●', { color: ctx.colors[m.model] ?? C.gray }), T(k, `${NB}${modelName(m.model)}`, { dim: true })])),
      models.length > 8 && T(k, `+${NB}${models.length - 8}${NB}autres`, { dim: true }),
    ],
    true,
  )
  return (
    <Box key="trend" flexDirection="column">
      {card(k, 'chart', `${metric === 'cost' ? 'Coût' : 'Tokens'} par ${GRAIN_WORD[grain]}`, color, right, [
        <Box marginTop={1}>{chart}</Box>,
        <Box marginTop={1}>{legend}</Box>,
        grain !== ctx.ui.grain && say(k, `Par ${GRAIN_WORD[grain]} : trop de ${GRAIN_PLURAL[ctx.ui.grain]} pour la largeur.`),
        <Box marginTop={1}>
          {T(
            k,
            [
              `moyenne ${fmtMetric(active.length ? total / active.length : 0, metric)} par ${GRAIN_ACTIVE[grain]}`,
              `médiane ${fmtMetric(median, metric)}`,
              maxIndex >= 0 && values[maxIndex]! > 0 ? `record ${fmtMetric(values[maxIndex]!, metric)} (${bucketLabel(buckets[maxIndex]!.key, grain)})` : null,
            ]
              .filter(Boolean)
              .join(SEP),
            { dim: true, wrap: 'wrap' },
          )}
        </Box>,
      ])}
      {monthCard(k, ctx)}
      {blockCard(k, ctx)}
      {topDaysCard(k, ctx, act)}
    </Box>
  )
}

/** Le mois en cours : dépensé, projection, et le mois d'avant à la même date. */
const monthCard = (k: Kit, ctx: Ctx): unknown => {
  const metric = ctx.metric
  const color = toneOf(metric)
  const plan = monthPlan(selectRows(ctx.s.rows, { ...ctx.f, from: null }, ctx.s.projects), ctx.today, metric)
  if (plan.spent <= 0 && plan.lastMonth <= 0) return null
  const delta = plan.lastMonthToDate > 0 ? (plan.spent - plan.lastMonthToDate) / plan.lastMonthToDate : null
  return card(k, 'month', cap(fmtMonth(plan.month)), color, T(k, `jour${NB}${plan.day}/${plan.total}`, { dim: true }), [
    <k.Box marginTop={1}>
      {line(k, [T(k, fmtMetric(plan.spent, metric), { color, bold: true }), T(k, `à ce jour${SEP}projection fin de mois ≈ ${fmtMetric(plan.projected, metric)}`, { dim: true, wrap: 'truncate-end' })])}
    </k.Box>,
    <k.Box marginTop={1}>{meter(k, [{ value: plan.spent, color }], Math.max(plan.projected, plan.spent), Math.min(ctx.inner, 48), `${fmtMetric(plan.spent, metric)} sur ${fmtMetric(plan.projected, metric)} projetés`)}</k.Box>,
    plan.lastMonth > 0 &&
      say(
        k,
        `${cap(fmtMonth(plan.prev))} : ${fmtMetric(plan.lastMonth, metric)} en tout, ${fmtMetric(plan.lastMonthToDate, metric)} au ${plan.day}${delta !== null ? ` (${fmtDelta(delta)} ce mois-ci)` : ''}.`,
      ),
  ])
}

/** Le bloc de facturation de 5 h en cours, ou le dernier. Tous projets : ccusage ne les sépare pas. */
const blockCard = (k: Kit, ctx: Ctx): unknown => {
  if (!isLocalView(ctx) || ctx.s.blocks.length === 0) return null
  const { Box } = k
  const tz = ctx.s.tzOffset
  const active = ctx.s.blocks.find((b) => b.isActive && b.end > ctx.now) ?? null
  const last = ctx.s.blocks[ctx.s.blocks.length - 1]!
  if (!active) {
    return card(k, 'block', 'Bloc de 5 h', C.tangerine, T(k, 'aucun en cours', { dim: true }), [
      say(k, `Dernier : ${fmtDay(dayOf(last.start, tz))}, ${hhmm(last.start, tz)}–${hhmm(last.end, tz)}${SEP}${fmtCost(last.cost)}${SEP}${fmtTokens(last.tokens)} tokens`),
    ])
  }
  const elapsed = (ctx.now - active.start) / Math.max(1, active.end - active.start)
  const stale = ctx.now - ctx.s.fetchedAt > 5 * 60_000
  return card(k, 'block', 'Bloc de 5 h en cours', C.tangerine, T(k, `reste${NB}${fmtDuration(active.end - ctx.now)}`, { color: C.tangerine }), [
    <Box marginTop={1}>
      {k.isRich
        ? svgOf(k, blockSvg({ elapsed, startLabel: hhmm(active.start, tz), endLabel: hhmm(active.end, tz), nowLabel: hhmm(ctx.now, tz), color: C.tangerine, width: px(Math.min(ctx.inner, 70)) }), `Bloc de ${hhmm(active.start, tz)} à ${hhmm(active.end, tz)}, ${Math.round(elapsed * 100)} % écoulé`)
        : (
          <Box flexDirection="column">
            {blocks(k, [{ value: elapsed, color: C.tangerine }], 1, Math.min(ctx.inner, 50))}
            {T(k, `${hhmm(active.start, tz)}${NB.repeat(Math.max(1, Math.min(ctx.inner, 50) - 10))}${hhmm(active.end, tz)}`, { dim: true })}
          </Box>
        )}
    </Box>,
    <Box marginTop={1}>
      {line(
        k,
        [
          T(k, fmtCost(active.cost), { color: MONEY, bold: true }),
          T(k, `${fmtTokens(active.tokens)}${NB}tokens`, { color: BRAND }),
          active.costPerHour !== null && line(k, [flame(k, active.costPerHour, 16), rateText(k, active.costPerHour, true)]),
          active.projectedCost !== null && T(k, `projection${NB}${fmtCost(active.projectedCost)}`, { dim: true }),
          modelDots(k, ctx, active.models),
        ],
        true,
      )}
    </Box>,
    stale && say(k, `Chiffres du relevé ${ago(ctx.s.fetchedAt, ctx.now)} : ↻ pour les mettre à jour.`),
  ])
}

const topDaysCard = (k: Kit, ctx: Ctx, act: Actions): unknown => {
  const { Box } = k
  const metric = ctx.metric
  const color = toneOf(metric)
  const days = seriesOf(ctx.rows, 'day', ctx.from, ctx.today)
    .filter((b) => valueOf(b.total, metric) > 0)
    .sort((a, b) => valueOf(b.total, metric) - valueOf(a.total, metric))
  if (days.length < 2) return null
  const shown = days.slice(0, ctx.ui.expanded.days ? DAYS_MAX : DAYS_CAP)
  const max = valueOf(days[0]!.total, metric)
  const cells = Math.max(6, Math.min(24, ctx.inner - 40))
  return card(k, 'top-days', 'Jours les plus chargés', color, null, [
    ...shown.map((b, i) => {
      const lead = [...b.byModel.entries()].sort((x, y) => valueOf(y[1], metric) - valueOf(x[1], metric))[0]
      return (
        <Box key={`day-${b.key}`} flexDirection="row" alignItems="center" marginTop={i === 0 ? 1 : 0}>
          <Box width={16} flexShrink={0}>
            {T(k, fmtDay(b.key) + (b.key.slice(0, 4) !== ctx.today.slice(0, 4) ? ` ${b.key.slice(0, 4)}` : ''), { wrap: 'truncate-end' })}
          </Box>
          <Box flexShrink={0} marginRight={1}>
            {meter(k, [{ value: valueOf(b.total, metric), color }], max, cells, fmtMetric(valueOf(b.total, metric), metric))}
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            {TT(k, [T(k, fmtMetric(valueOf(b.total, metric), metric), { color, bold: true }), lead ? T(k, `${NB}${NB}${modelName(lead[0])}`, { dim: true }) : ''], { wrap: 'truncate-end' })}
          </Box>
        </Box>
      )
    }),
    days.length > DAYS_CAP && showAllToggle(k, 'days-all', ctx.ui.expanded.days, days.length, () => act.toggleExpanded('days'), `voir${NB}les${NB}${Math.min(days.length, DAYS_MAX)}${NB}premiers`),
  ])
}

// ─── Modèles ──────────────────────────────────────────────────────────────

const modelsTab = (k: Kit, ctx: Ctx, act: Actions): unknown => {
  const { Box, Button } = k
  const metric = ctx.metric
  const color = toneOf(metric)
  const list = modelsOf(ctx.rows, metric)
  const total = valueOf(ctx.total, metric)
  const slots = k.isRich ? 60 : Math.max(8, Math.min(30, ctx.inner - 44))
  const grain = fitGrain('day', ctx.from, ctx.today, slots)
  const buckets = seriesOf(ctx.rows, grain, ctx.from, ctx.today)
  const shown = ctx.ui.expanded.models ? list : list.slice(0, MODELS_CAP)
  const parts = list.map((m) => ({ value: valueOf(m.total, metric), color: ctx.colors[m.model] ?? C.gray }))
  const lead = list[0]
  const dear = [...list].filter((m) => m.total.tokens > 0).sort((a, b) => b.total.cost / b.total.tokens - a.total.cost / a.total.tokens)[0]

  const summary = (
    <Box flexDirection="column" flexShrink={1}>
      {lead && TT(k, [T(k, `En${NB}tête${NB}:${NB}`, { dim: true }), T(k, modelName(lead.model), { color: ctx.colors[lead.model] ?? C.gray, bold: true }), T(k, `${NB}(${fmtPct(lead.share)})`, { dim: true })], { wrap: 'truncate-end' })}
      {T(k, `${plural(list.length, 'modèle utilisé', 'modèles utilisés')}${SEP}${fmtMetric(total, metric)}`, { dim: true, wrap: 'truncate-end' })}
      {dear && ctx.total.cost > 0 && T(k, `Le plus cher au token : ${modelName(dear.model)} (${fmtCost((dear.total.cost / dear.total.tokens) * 1e6)} / M tokens)`, { dim: true, wrap: 'wrap' })}
      {ctx.ui.model && T(k, `Filtré sur ${modelName(ctx.ui.model)} : « ✕ » en haut pour tout revoir.`, { color: C.amber, wrap: 'wrap' })}
    </Box>
  )
  const head = k.isRich ? (
    <Box flexDirection="row" alignItems="center" marginTop={1}>
      <Box flexShrink={0} marginRight={2}>
        {svgOf(k, donutSvg(parts, 132, fmtMetric(total, metric, true), metric === 'cost' ? 'coût' : 'tokens', color), `Répartition par modèle : ${list.map((m) => `${modelName(m.model)} ${fmtPct(m.share)}`).join(', ')}`)}
      </Box>
      {summary}
    </Box>
  ) : (
    <Box flexDirection="column" marginTop={1}>
      {blocks(k, parts, total, Math.min(ctx.inner, 60))}
      <Box marginTop={1}>{summary}</Box>
    </Box>
  )
  const share =
    k.isRich && buckets.length > 1
      ? card(k, 'share', `Part des modèles par ${GRAIN_WORD[grain]}`, color, null, [
          <Box marginTop={1}>
            {svgOf(
              k,
              stackSvg({
                buckets: buckets.map((b) => {
                  const all = valueOf(b.total, metric)
                  return { label: bucketLabel(b.key, grain), parts: list.map((m) => ({ value: all > 0 ? valueOf(b.byModel.get(m.model) ?? zero(), metric) / all : 0, color: ctx.colors[m.model] ?? C.gray })) }
                }),
                width: px(ctx.inner),
                height: 140,
                fmt: (v) => fmtPct(v),
                max: 1,
              }),
              `Part de chaque modèle par ${GRAIN_WORD[grain]}`,
            )}
          </Box>,
        ])
      : null
  const sparkCells = Math.max(6, Math.min(24, ctx.inner - 50))
  return (
    <Box key="models" flexDirection="column">
      {card(k, 'models-head', 'Répartition par modèle', color, metricToggle(k, ctx, act), [head])}
      {share}
      {card(k, 'models-list', 'Détail', color, null, [
        ...shown.map((m, i) => {
          const c = ctx.colors[m.model] ?? C.gray
          const isOn = ctx.ui.model === m.model
          const series = buckets.map((b) => valueOf(b.byModel.get(m.model) ?? zero(), metric))
          return (
            <Box key={`model-${m.model}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row" alignItems="center">
                <Box width={2} flexShrink={0}>
                  {T(k, '●', { color: c })}
                </Box>
                <Box flexGrow={1} flexShrink={1}>
                  {TT(k, [T(k, modelName(m.model), { bold: true }), T(k, `${NB}${NB}${fmtPct(m.share)}`, { color: c })], { wrap: 'truncate-end' })}
                </Box>
                <Box flexShrink={0} marginLeft={1}>
                  {line(k, [
                    ctx.inner >= 56 && (k.isRich ? svgOf(k, sparkSvg(series, c, px(sparkCells), 16), `Évolution de ${modelName(m.model)}`) : sparkText(k, series, sparkCells, c)),
                    <Box width={10} justifyContent="flex-end">
                      {T(k, fmtMetric(valueOf(m.total, metric), metric), { color, bold: true })}
                    </Box>,
                    <Button key={`model-${i}`} plain={true} dimColor={!isOn} label={isOn ? `✕${NB}filtre` : `⌕${NB}filtrer`} onPress={() => act.setUi({ model: isOn ? null : m.model })} />,
                  ])}
                </Box>
              </Box>
              <Box marginLeft={2}>
                {T(
                  k,
                  [`entrée ${fmtTokens(m.total.input)}`, `sortie ${fmtTokens(m.total.output)}`, `cache lu ${fmtTokens(m.total.cacheRead)}`, `écrit ${fmtTokens(m.total.cacheWrite)}`, metric === 'tokens' ? fmtCost(m.total.cost) : `${fmtTokens(m.total.tokens)} tokens`].join(SEP),
                  { dim: true, wrap: 'truncate-end' },
                )}
              </Box>
            </Box>
          )
        }),
        list.length > MODELS_CAP && showAllToggle(k, 'models-all', ctx.ui.expanded.models, list.length, () => act.toggleExpanded('models')),
      ])}
    </Box>
  )
}

// ─── Projets ──────────────────────────────────────────────────────────────

const projectsTab = (k: Kit, ctx: Ctx, act: Actions): unknown => {
  const { Box, Button } = k
  const metric = ctx.metric
  const color = toneOf(metric)
  const list = projectsOf(ctx.rows, ctx.sessions, ctx.s.projects, metric)
  const shown = ctx.ui.expanded.projects ? list : list.slice(0, PROJECTS_CAP)
  const max = list.length ? valueOf(list[0]!.total, metric) : 0
  const rank = ctx.here ? list.findIndex((p) => p.key === ctx.here) : -1
  const cells = Math.max(6, Math.min(22, ctx.inner - 46))
  return (
    <Box key="projects" flexDirection="column">
      {card(k, 'projects-list', 'Projets', color, metricToggle(k, ctx, act), [
        say(k, [plural(list.length, 'projet'), rank >= 0 ? `ce projet : n°${NB}${rank + 1} (${fmtPct(list[rank]!.share)})` : null].filter(Boolean).join(SEP)),
        ...shown.map((p, i) => {
          const isHere = p.key === ctx.here
          const isOn = ctx.ui.project === p.key
          const info = ctx.s.projects[p.key]
          const detail = [
            p.key === DRAFTS ? plural(p.members, 'dossier') : null,
            p.sessions ? plural(p.sessions, 'session') : null,
            elsewhere(ctx, p.byMachine, metric),
            `dernier jour ${fmtDate(p.last)}`,
            ctx.inner >= 90 && info?.path ? info.path : null,
          ]
            .filter(Boolean)
            .join(SEP)
          return (
            <Box key={`project-${p.key}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row" alignItems="center">
                <Box width={2} flexShrink={0}>
                  {T(k, isHere ? '●' : '○', { color: isHere ? BRAND : C.gray, bold: isHere })}
                </Box>
                <Box flexGrow={1} flexShrink={1}>
                  {TT(k, [T(k, nameOf(ctx, p.key), { bold: true }), isHere ? T(k, `${NB}${NB}ce projet`, { color: BRAND }) : ''], { wrap: 'truncate-end' })}
                </Box>
                <Box flexShrink={0} marginLeft={1}>
                  {line(k, [
                    meter(k, [{ value: valueOf(p.total, metric), color }], max, cells, `${fmtPct(p.share)} du total`),
                    // Largeurs fixes : les jauges s'alignent d'une ligne à l'autre.
                    <Box width={10} justifyContent="flex-end">
                      {T(k, fmtMetric(valueOf(p.total, metric), metric), { color, bold: true })}
                    </Box>,
                    <Box width={6} justifyContent="flex-end">
                      {T(k, fmtPct(p.share), { dim: true })}
                    </Box>,
                    <Button key={`proj-${i}`} plain={true} dimColor={!isOn} label={isOn ? `✕${NB}filtre` : `⌕${NB}filtrer`} onPress={() => act.setUi({ project: isOn ? null : p.key })} />,
                  ])}
                </Box>
              </Box>
              <Box marginLeft={2}>{T(k, detail, { dim: true, wrap: 'truncate-end' })}</Box>
            </Box>
          )
        }),
        list.length > PROJECTS_CAP && showAllToggle(k, 'projects-all', ctx.ui.expanded.projects, list.length, () => act.toggleExpanded('projects')),
      ])}
    </Box>
  )
}

// ─── Sessions ─────────────────────────────────────────────────────────────

const SORTS: [SessionSort, string][] = [
  ['cost', `Plus${NB}chères`],
  ['recent', 'Récentes'],
  ['long', `Plus${NB}longues`],
]

/** Dans un projet, la part des autres postes : « dont Mac 3,00 $, Serveur 41,50 $ » ; rien sous un filtre de poste. */
function elsewhere(ctx: Ctx, byMachine: Record<string, Totals>, metric: Metric): string | null {
  if (ctx.f.machine !== 'all') return null
  const parts = ctx.s.machines
    .filter((m) => m !== ctx.s.machine && byMachine[m] && valueOf(byMachine[m]!, metric) > 0)
    .map((m) => `${m} ${fmtMetric(valueOf(byMachine[m]!, metric), metric)}`)
  return parts.length ? `dont ${parts.join(', ')}` : null
}

const sessionsTab = (k: Kit, ctx: Ctx, act: Actions): unknown => {
  const { Box } = k
  if (lacksSessions(ctx)) {
    return card(k, 'no-sessions', 'Sessions', C.violet, null, [say(k, `${ctx.f.machine} n’a publié que des totaux par jour : pas de détail des sessions.`)])
  }
  const list = ctx.sessions
  const dur = (s: SessionRow) => s.last - s.first
  const sorted = [...list].sort((a, b) => (ctx.ui.sessionSort === 'recent' ? b.last - a.last : ctx.ui.sessionSort === 'long' ? dur(b) - dur(a) : b.cost - a.cost))
  const shown = sorted.slice(0, ctx.ui.expanded.sessions ? SESSIONS_MAX : SESSIONS_CAP)
  const costs = list.reduce((n, s) => n + s.cost, 0)
  const durations = list.map(dur).sort((a, b) => a - b)
  const median = durations.length ? durations[Math.floor(durations.length / 2)]! : 0
  const longest = durations.length ? durations[durations.length - 1]! : 0
  const tiles: Tile[] = [
    { key: 's-count', label: 'Sessions', value: fmtInt(list.length), sub: 'sur la période', color: C.violet },
    { key: 's-avg', label: 'Coût moyen', value: fmtCost(list.length ? costs / list.length : 0), sub: 'par session', color: MONEY },
    { key: 's-median', label: 'Durée médiane', value: fmtDuration(median), sub: 'par session', color: BRAND },
    { key: 's-long', label: 'Plus longue', value: fmtDuration(longest), sub: 'reprises comprises', color: C.lilac },
  ]
  const tz = ctx.s.tzOffset
  return (
    <Box key="sessions" flexDirection="column">
      {tileGrid(k, tiles)}
      {card(k, 'sessions-list', 'Sessions', C.violet, line(k, SORTS.map(([x, label]) => toggle(k, `sort-${x}`, label, ctx.ui.sessionSort === x, () => act.setUi({ sessionSort: x })))), [
        list.length === 0 && say(k, 'Aucune session sur cette période.'),
        ...shown.map((s, i) => (
          <Box key={`session-${s.id}`} flexDirection="row" alignItems="center" marginTop={i === 0 ? 1 : 0}>
            <Box width={13} flexShrink={0}>
              {T(k, fmtDay(dayOf(s.last, tz)), { dim: true, wrap: 'truncate-end' })}
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              {T(k, `${nameOf(ctx, groupOf(s.project, ctx.s.projects))}${ctx.f.machine === 'all' && ctx.s.machines.length > 1 ? `${NB}·${NB}${s.machine}` : ''}`, { bold: true, wrap: 'truncate-end' })}
            </Box>
            <Box flexShrink={0} marginLeft={1}>
              {/* Largeurs fixes : durées, modèles, tokens et coûts en colonnes. */}
              {line(k, [
                ctx.inner >= 60 && <Box width={9} justifyContent="flex-end">{T(k, fmtDuration(dur(s)), { dim: true })}</Box>,
                ctx.inner >= 50 && <Box width={4}>{modelDots(k, ctx, s.models)}</Box>,
                ctx.inner >= 70 && <Box width={8} justifyContent="flex-end">{T(k, fmtTokens(s.tokens), { color: BRAND, dim: true })}</Box>,
                <Box width={9} justifyContent="flex-end">{T(k, fmtCost(s.cost), { color: MONEY, bold: true })}</Box>,
              ])}
            </Box>
          </Box>
        )),
        list.length > SESSIONS_CAP &&
          showAllToggle(k, 'sessions-all', ctx.ui.expanded.sessions, list.length, () => act.toggleExpanded('sessions'), `voir${NB}les${NB}${Math.min(list.length, SESSIONS_MAX)}${NB}premières${NB}(sur${NB}${fmtInt(list.length)})`),
      ])}
      {blocksHistory(k, ctx)}
    </Box>
  )
}

/** Les derniers blocs de 5 h : coût de chacun, moyenne et record. */
const blocksHistory = (k: Kit, ctx: Ctx): unknown => {
  const { Box } = k
  const tz = ctx.s.tzOffset
  const list = ctx.s.blocks.filter((b) => !ctx.f.from || dayOf(b.start, tz) >= ctx.f.from).slice(-Math.max(8, Math.min(40, Math.floor(ctx.inner / (k.isRich ? 2 : 1)))))
  if (list.length < 2) return null
  const costs = list.map((b) => b.cost)
  const top = list.reduce((best, b) => (b.cost > best.cost ? b : best), list[0]!)
  const avg = costs.reduce((n, v) => n + v, 0) / costs.length
  const labels = list.map((b, i) => (i === 0 || dayOf(b.start, tz) !== dayOf(list[i - 1]!.start, tz) ? fmtDate(dayOf(b.start, tz)) : ''))
  // Une étiquette sur deux au plus quand elles se chevaucheraient.
  const room = px(ctx.inner) / list.length
  const sparse = labels.map((l, i) => (room < 40 && i % Math.ceil(40 / room) !== 0 ? '' : l))
  return card(k, 'blocks', 'Blocs de 5 h', C.tangerine, T(k, `${list.length}${NB}derniers`, { dim: true }), [
    <Box marginTop={1}>
      {k.isRich
        ? svgOf(k, columnsSvg({ values: costs, labels: sparse, color: C.tangerine, width: px(ctx.inner), fmt: (v) => fmtCostShort(v), highlight: list.indexOf(top) }), `Coût des ${list.length} derniers blocs de 5 h`)
        : columnsChart(k, 'blocks', costs, 5, C.tangerine, list.length * 2 <= ctx.inner ? 2 : 1, list.indexOf(top))}
    </Box>,
    say(k, `moyenne ${fmtCost(avg)} par bloc${SEP}record ${fmtCost(top.cost)} (${fmtDay(dayOf(top.start, tz))}, ${hhmm(top.start, tz)})`),
  ])
}

// ─── Rythme ───────────────────────────────────────────────────────────────

const rhythmTab = (k: Kit, ctx: Ctx, act: Actions): unknown => {
  const { Box } = k
  const metric = ctx.metric
  const color = toneOf(metric)
  const a = ctx.s.activity
  const weekdays = weekdaysOf(ctx.rows, metric)
  const wTop = weekdays.indexOf(Math.max(...weekdays))
  const wMax = Math.max(...weekdays, 1e-9)
  const dates = activeDates(ctx.rows)
  const span = daysBetween(ctx.from, ctx.today) + 1
  const streak = streaksOf(dates, ctx.today)
  const acts = activityDays(ctx)

  const hoursCard =
    a && isLocalView(ctx)
      ? (() => {
          const peak = a.hours.indexOf(Math.max(...a.hours))
          const labels = a.hours.map((_, h) => (h % 3 === 0 ? `${h}h` : ''))
          const cell = ctx.inner >= 50 ? 2 : 1
          const axis = a.hours.map((_, h) => (h % 6 === 0 ? String(h).padEnd(cell * 6, NB) : '')).join('')
          return card(k, 'hours', 'Heures de début des sessions', C.pink, T(k, `ce${NB}poste${a.since ? `, depuis le ${fmtDate(a.since.slice(0, 10), true)}` : ''}`, { dim: true }), [
            <Box marginTop={1}>
              {k.isRich ? (
                svgOf(k, columnsSvg({ values: a.hours, labels, color: C.pink, width: px(Math.min(ctx.inner, 90)), fmt: (v) => fmtInt(v), highlight: peak }), `Sessions commencées par heure ; pointe à ${peak} h`)
              ) : (
                <Box flexDirection="column">
                  {columnsChart(k, 'hours', a.hours, 5, C.pink, cell, peak)}
                  {T(k, axis, { dim: true })}
                </Box>
              )}
            </Box>,
            say(k, `Pointe à ${peak}${NB}h (${plural(a.hours[peak] ?? 0, 'session')})${SEP}tout l’historique de /stats, tous projets.`),
          ])
        })()
      : null

  const weekCard = card(k, 'weekdays', 'Jours de la semaine', color, metricToggle(k, ctx, act), [
    k.isRich ? (
      <Box marginTop={1}>{svgOf(k, columnsSvg({ values: weekdays, labels: DAY_LETTERS, color, width: px(Math.min(ctx.inner, 60)), fmt: (v) => fmtMetric(v, metric, true), highlight: wTop }), `Par jour de la semaine ; le plus chargé : ${WEEKDAY_LONG[wTop]}`)}</Box>
    ) : (
      <Box flexDirection="column" marginTop={1}>
        {weekdays.map((v, i) => (
          <Box key={`wd-${i}`} flexDirection="row">
            <Box width={6} flexShrink={0}>
              {T(k, WEEKDAY_LONG[i]!.slice(0, 3), { dim: i !== wTop, bold: i === wTop })}
            </Box>
            <Box marginRight={1}>{blocks(k, [{ value: v, color: i === wTop ? C.coral : color }], wMax, Math.max(6, Math.min(30, ctx.inner - 20)))}</Box>
            {T(k, fmtMetric(v, metric, true), { dim: i !== wTop })}
          </Box>
        ))}
      </Box>
    ),
    say(k, `Le plus chargé : le ${WEEKDAY_LONG[wTop]} (${fmtPct(weekdays[wTop]! / Math.max(1e-9, weekdays.reduce((n, v) => n + v, 0)))}).`),
  ])

  const msgCard =
    acts && acts.length
      ? (() => {
          const messages = acts.reduce((n, d) => n + d.messages, 0)
          const tools = acts.reduce((n, d) => n + d.tools, 0)
          const top = acts.reduce((best, d) => (d.messages > best.messages ? d : best), acts[0]!)
          const series = seriesOf([], 'day', acts[0]!.date, a?.through ?? ctx.today).map((b) => acts.find((d) => d.date === b.key)?.messages ?? 0)
          return card(k, 'messages', 'Messages et outils', C.indigo, T(k, `ce${NB}PC${a?.through ? `, jusqu’au ${fmtDate(a.through)}` : ''}`, { dim: true }), [
            <Box marginTop={1}>
              {line(
                k,
                [
                  TT(k, [T(k, fmtInt(messages), { color: C.indigo, bold: true }), T(k, `${NB}messages`, { dim: true })]),
                  T(k, '·', { dim: true }),
                  TT(k, [T(k, fmtInt(tools), { color: C.cyan, bold: true }), T(k, `${NB}appels d’outils`, { dim: true })]),
                  T(k, '·', { dim: true }),
                  TT(k, [T(k, fmtInt(Math.round(messages / acts.length)), { bold: true }), T(k, `${NB}messages par jour actif`, { dim: true })]),
                ],
                true,
              )}
            </Box>,
            series.length > 1 && <Box marginTop={1}>{k.isRich ? svgOf(k, sparkSvg(series, C.indigo, px(Math.min(ctx.inner, 80)), 34), 'Messages par jour') : sparkText(k, series, Math.min(ctx.inner, 60), C.indigo)}</Box>,
            say(k, `Jour le plus bavard : ${fmtDay(top.date)} (${plural(top.messages, 'message')}).${a?.longest ? ` Plus longue session de /stats : ${fmtDuration(a.longest.ms)}, ${plural(a.longest.messages, 'message')}.` : ''}`),
          ])
        })()
      : null

  const ratio = dates.length / Math.max(1, span)
  const streakCard = card(k, 'streaks', 'Régularité', C.green, null, [
    <Box flexDirection="row" alignItems="center" marginTop={1}>
      {k.isRich && <Box marginRight={2}>{svgOf(k, ringSvg(ratio, C.green, 56), `${fmtPct(ratio)} des jours actifs`)}</Box>}
      <Box flexDirection="column" flexShrink={1}>
        {TT(k, [T(k, `${dates.length}/${span}`, { color: C.green, bold: true }), T(k, `${NB}jours actifs (${fmtPct(ratio)})`, { dim: true })])}
        {TT(k, [T(k, `${streak.longest}${NB}j`, { bold: true }), T(k, `${NB}de série record${streak.longestEnd ? `, jusqu’au ${fmtDate(streak.longestEnd)}` : ''}`, { dim: true })])}
        {TT(k, [T(k, `${streak.current}${NB}j`, { bold: true, color: streak.current > 0 ? C.green : '' }), T(k, `${NB}de série en cours`, { dim: true })])}
      </Box>
    </Box>,
  ])

  return (
    <Box key="rhythm" flexDirection="column">
      {hoursCard}
      {weekCard}
      {msgCard}
      {streakCard}
    </Box>
  )
}

// ─── Bandeau ──────────────────────────────────────────────────────────────

/** Largeur du nom dans la colonne d'étiquette, la même dans les bandeaux Git, Flow et Asana. */
const LABEL_CELLS = 5
/** La couleur de Stats dans les bandeaux : bleu ciel (Flow violet, Git mandarine, Asana rose). */
const TAG_COLOR = BRAND

/** L'étiquette d'outil en tête du bandeau : une barre verticale et le nom du mod (copiée de git-board). */
const bandTag = (k: Kit, label: string | null, color: string): unknown => (
  <k.Box flexDirection="row" flexShrink={0}>
    {T(k, '▍', { color, bold: true })}
    {label !== null && T(k, `${NB}${label.padEnd(LABEL_CELLS, NB)}`, { color, bold: true })}
  </k.Box>
)

/**
 * Le bandeau au-dessus du prompt : une ligne, deux pendant un relevé. Le coût du jour, le
 * bloc de 5 h en cours, le mois et le bouton qui ouvre le panneau, sur le terminal comme
 * sur le desktop.
 */
export const drawBand = (k: Kit, view: View, act: Actions): unknown => {
  if (view.isBandHidden) return null
  const { Box, Button } = k
  const width = k.width
  const s = view.snapshot
  const m = view.meta
  // Un groupe « libellé prix tokens » ; le mot « tokens » seulement quand la place le permet.
  // Le terminal, plus compact : un émoji pour libellé (💬 discussion, 🌞 jour, 📅 mois, chacun de
  // deux cellules sans sélecteur de variante) et « tok » ; le desktop garde les mots.
  const isCompact = !k.isRich
  const unit = isCompact ? (width >= 120 ? `${NB}tok` : '') : width >= 150 ? `${NB}tokens` : ''
  const group = (label: string, icon: string, cost: number | null, tokens: number | null) =>
    TT(k, [
      isCompact ? T(k, `${icon}${NB}`) : T(k, `${label}${NB}`, { dim: true }),
      cost !== null ? T(k, fmtCost(cost), { color: MONEY, bold: true }) : '',
      tokens !== null ? T(k, `${NB}${fmtTokens(tokens)}${unit}`, { color: BRAND }) : '',
    ])
  const fig = figuresOf(view)
  const discussionBit = (fig.cost !== null || fig.tokens !== null) && group('discussion', '💬', fig.cost, fig.tokens)
  let bits: unknown[]
  if (s) {
    const today = dayOf(view.now, s.tzOffset)
    // Un relevé d'un autre jour : son jour, pas « aujourd'hui » à 0 $.
    const day = dayOf(s.fetchedAt, s.tzOffset) === today ? today : dayOf(s.fetchedAt, s.tzOffset)
    const t = sum(s.rows.filter((r) => r.date === day))
    const active = s.blocks.find((b) => b.isActive && b.end > view.now) ?? null
    const rate = active?.costPerHour ?? null
    bits = [
      // En tête : le rythme horaire du bloc de 5 h en cours, sa flamme à la couleur de son niveau.
      rate !== null && line(k, [flame(k, rate, 14), rateText(k, rate)]),
      discussionBit,
      width >= 64 && group(day === today ? 'aujourd’hui' : `le${NB}${fmtDate(day)}`, day === today ? '🌞' : `🌞${NB}${fmtDate(day)}`, t.cost, t.tokens),
      width >= 92 && group(fmtMonthShort(monthOf(day)), '📅', monthPlan(s.rows, day, 'cost').spent, monthPlan(s.rows, day, 'tokens').spent),
      width >= 150 && T(k, `relevé${NB}${ago(s.fetchedAt, view.now)}`, { dim: true }),
    ]
  } else {
    bits = [discussionBit || T(k, m.loading ? 'premier relevé ccusage…' : `Statistiques${NB}Claude${NB}Code`, { dim: true })]
  }
  const second = m.loading && width >= 56 ? line(k, [spinner(k, C.tangerine, view.now, 'relevé'), T(k, m.loading, { color: C.tangerine, wrap: 'truncate-end' })]) : null
  // Un « · » atténué entre les groupes de chiffres.
  const shown = bits.filter(isShown).flatMap((b, i) => (i === 0 ? [b] : [T(k, '·', { dim: true }), b]))
  return (
    <Box key="stats-band" flexDirection="column" width={width}>
      <Box flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexShrink={1}>{line(k, [bandTag(k, 'Stats', TAG_COLOR), ...shown])}</Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={1}>
          <Box marginRight={1}>
            <Button key="stats-band-open" plain={true} dimColor={true} label={`▸${NB}/ccstats`} onPress={() => act.openPane()} />
          </Box>
          {/* Pas de role="dismiss" : plusieurs bandeaux empilés auraient chacun leur fermeture native au même endroit. */}
          <Button key="stats-band-hide" plain={true} dimColor={true} label="x" onPress={() => act.hideBand()} />
        </Box>
      </Box>
      {second && (
        <Box flexDirection="row">
          {bandTag(k, '', TAG_COLOR)}
          <Box flexShrink={1} marginLeft={1}>
            {second}
          </Box>
        </Box>
      )}
    </Box>
  )
}
