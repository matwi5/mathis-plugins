// Dessin du panneau Git (/git) et du bandeau au-dessus du prompt. Un seul arbre pour
// toutes les surfaces : le desktop, VS Code et le mobile reçoivent les SVG, le terminal
// des glyphes et des barres en blocs. Aucun appel au moteur ici : l'état arrive dans
// `View`, les actions dans `Actions` (des fermetures préparées par register.tsx).
//
// Pièges du desktop : les espaces ordinaires y sont fondus et `gap` ignoré ; les écarts
// dans un texte sont donc insécables, ceux entre éléments des marges. Aucune prop n'est
// passée à `undefined` : les arbres restent valides partout. Le mobile n'a ni `Input` ni
// `Select` : le panneau s'en passe et le dit en une ligne atténuée.

import type { Action, CiWatch, Expanded, Form, GitBranch, GitCommit, GitFile, GitRemoteBranch, GitRepo, Meta, Notice, PrState, PullRequest, Running, Switching, Tab } from '../types'
import {
  ACTION_COLOR,
  C,
  MAX_FILES,
  NB,
  NEXT_LABEL,
  OPERATION,
  SEP,
  ago,
  bandNext,
  branchLabel,
  checksText,
  ciOf,
  ciText,
  canSyncBase,
  countsOf,
  fetchedText,
  glyphOf,
  localOf,
  plural,
  prColor,
  prLabel,
  prOfBranch,
  reviewOf,
  sameDir,
  VERSION_COMMAND,
  localState,
  suggest,
  unique,
} from './model.ts'
import { barSvg, gaugeSvg, roadmapSvg, spinnerSvg, type BarPart, type NodeState, type RoadNode } from './svg.ts'

/** Largeur estimée d'une cellule sur les surfaces distantes ; un SVG trop large est réduit à sa place. */
const PX_PER_CELL = 7.6
/** Plafonds des listes avant « ▸ tout voir (N) ». */
const FILES_CAP = 20
const BRANCHES_CAP = 12
const COMMITS_CAP = 12

export type Kit = {
  Box: any
  Text: any
  Button: any
  Svg: any
  /** Lien externe ; absent d'une table qui n'en a pas. */
  Link: any
  /** Champ de saisie et liste de choix : absents sur le mobile. */
  Input: any
  Select: any
  /** La surface dessine les SVG (desktop, VS Code, mobile). */
  isRich: boolean
  /** Colonnes du corps. */
  width: number
}

/**
 * Ce que la surface dessine vraiment. La table de `$.ui.resolve(e)` est complétée : un
 * élément absent de la surface y figure quand même et dessine un fragment vide (constaté
 * dans le kit de test : `Svg` sur le terminal, `Input` et `Select` sur le mobile). Un
 * `typeof table.Svg` ne suffit donc pas : register.tsx lit ces capacités dans le contrat
 * `Elements` du moteur et les passe ici, la vue ne connaît pas le nom de la surface.
 */
export type Caps = { hasSvg: boolean; hasFields: boolean }

export const kitOf = (table: Record<string, unknown>, width: number, caps: Caps): Kit => ({
  Box: table.Box,
  Text: table.Text,
  Button: table.Button,
  Svg: caps.hasSvg ? (table.Svg ?? null) : null,
  Link: table.Link ?? null,
  Input: caps.hasFields ? (table.Input ?? null) : null,
  Select: caps.hasFields ? (table.Select ?? null) : null,
  isRich: caps.hasSvg && typeof table.Svg === 'function',
  width: Math.max(24, Math.floor(width)),
})

export type View = {
  repo: GitRepo | null
  pr: PrState
  meta: Meta
  tab: Tab
  action: Action | null
  form: Form
  notice: Notice
  busy: string | null
  running: Running
  switching: Switching
  showRemotes: boolean
  expanded: Expanded
  isBandHidden: boolean
  /** Suivi de la CI après un push ; affiché seulement pour la branche et le commit en tête. */
  ci: CiWatch
  /** Un parcours flow-board est actif dans la discussion (pas d'envoi en cours de parcours). */
  isFlowActive: boolean
  now: number
}

export type Actions = {
  setTab: (tab: Tab) => unknown
  /** Ouvre le tiroir d'une action, ou le referme. */
  toggleAction: (a: Action) => unknown
  closeAction: () => unknown
  setForm: (patch: Partial<Form>) => unknown
  /** ↻ : oublie une commande restée en file, puis relit tout (fetch et PR compris). */
  refresh: () => unknown
  launch: (a: Action) => unknown
  /** Tiroir Pull : intègre la branche par défaut (`/project:sync base`). */
  launchBase: () => unknown
  /** Lance /project:version, suggérée avant le push. */
  launchVersion: () => unknown
  openFolder: (value: string) => unknown
  /** Revient au dossier de la session. */
  backToSession: () => unknown
  askSwitch: (name: string, isRemote: boolean) => unknown
  confirmSwitch: (name: string, isRemote: boolean) => unknown
  cancelSwitch: () => unknown
  createBranch: (value: string) => unknown
  toggleRemotes: () => unknown
  toggleExpanded: (list: keyof Expanded) => unknown
  dismissNotice: () => unknown
  hideBand: () => unknown
  openPane: () => unknown
  /** Copie une adresse (PR, commit) dans le presse-papiers de la surface pressée ; `copied` : le toast qui le dit. */
  copyLink: (url: string, copied: string, surface?: string) => unknown
}

// ─── Petits outils ────────────────────────────────────────────────────────

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const spinFrame = (now: number): string => SPIN[Math.floor(now / 1000) % SPIN.length] ?? '⠋'
const px = (cells: number): number => Math.max(160, Math.floor(cells * PX_PER_CELL))

type Style = { color?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; strike?: boolean; wrap?: string }

const propsOf = (style: Style): Record<string, unknown> => {
  const props: Record<string, unknown> = {}
  if (style.color) props.color = style.color
  if (style.bg) props.backgroundColor = style.bg
  if (style.bold) props.bold = true
  if (style.dim) props.dimColor = true
  if (style.italic) props.italic = true
  if (style.strike) props.strikethrough = true
  if (style.wrap) props.wrap = style.wrap
  return props
}

/** Un Text sans prop indéfinie. */
const T = (k: Kit, text: string, style: Style = {}): unknown => h(k.Text, propsOf(style), text)

/** Un Text fait de morceaux (Text imbriqués ou chaînes), sans prop indéfinie. */
const TT = (k: Kit, parts: unknown[], style: Style = {}): unknown => h(k.Text, propsOf(style), ...parts.filter(isShown))

/** Pastille pleine : texte foncé sur la couleur. `style` ajoute par exemple une troncature. */
const chip = (k: Kit, text: string, color: string, style: Style = {}): unknown => T(k, `${NB}${text}${NB}`, { ...style, bg: color, color: C.ink, bold: true })

/**
 * Un lien externe : `Link` sur les surfaces riches ; au terminal, qui écrit l'adresse entière
 * derrière son libellé quand il ne sait pas faire de lien, un bouton qui la copie.
 */
const urlCell = (k: Kit, key: string, href: string, link: { label: string; copyLabel: string; copied: string }, act: Actions): unknown => {
  const { Button, Link } = k
  if (!k.isRich) return <Button key={key} plain={true} dimColor={true} label={link.copyLabel} onPress={(press?: { surface?: string }) => act.copyLink(href, link.copied, press?.surface)} />
  return Link ? <Link key={key} href={href} label={link.label} /> : null
}

/** Les liens d'une PR ; le terminal n'a que le bouton qui copie. */
const PR_LINK = { copyLabel: `⧉${NB}PR`, copied: 'Lien PR copié' }

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

const svgOf = (k: Kit, drawn: { source: string; width: number; height: number }, alt: string, isSized = true): unknown => {
  const props: Record<string, unknown> = { source: drawn.source, alt }
  if (isSized) {
    props.width = drawn.width
    props.height = drawn.height
  }
  // Jamais `isInteractive` : ce mode dessine dans un cadre à fond blanc, rechargé (donc
  // clignotant) à chaque redessin. En image, le fond reste transparent et le dessin stable.
  return h(k.Svg, props)
}

/** Barre en blocs du terminal. */
const blocks = (k: Kit, parts: readonly BarPart[], total: number, cells: number): unknown => {
  const { Box } = k
  const width = Math.max(6, cells)
  const sum = Math.max(1, total, parts.reduce((n, p) => n + p.value, 0))
  let used = 0
  const segs: unknown[] = []
  parts.forEach((part) => {
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

/** Indicateur de travail : arc qui tourne (SVG) ou spinner braille (terminal). */
const spinner = (k: Kit, color: string, now: number, alt: string): unknown =>
  k.isRich ? svgOf(k, spinnerSvg(color, 12), alt) : T(k, spinFrame(now), { color })

/** Ce que la surface ne permet pas, dit en une ligne atténuée plutôt que caché en silence. */
const unavailable = (k: Kit, text: string, marginTop = 1): unknown => {
  const { Box } = k
  return <Box marginTop={marginTop}>{T(k, `⊘${NB}${text}`, { dim: true, wrap: 'wrap' })}</Box>
}

/** Bascule « ▸ tout voir (N) » / « ▾ réduire » d'une liste plafonnée. */
const showAllToggle = (k: Kit, key: string, isOpen: boolean, total: number, onPress: () => unknown): unknown => {
  const { Box, Button } = k
  return (
    <Box marginTop={1}>
      <Button key={key} plain={true} dimColor={true} label={isOpen ? `▾${NB}réduire` : `▸${NB}tout${NB}voir${NB}(${total})`} onPress={onPress} />
    </Box>
  )
}

const TONE = { ok: C.green, error: C.red, info: C.tangerine } as const

/** Couleur d'identité du mod (règle 8 : le violet est la marque du mod ; la mandarine dit « en cours »). */
const BRAND = C.violet

/**
 * Une branche sans distante, pareille dans le bandeau, les pastilles et la route : vide,
 * fusionnée, à fusionner (worktree lié) ou non publiée. Le mot garde ses espaces ordinaires
 * (route SVG).
 */
const unpublishedOf = (r: GitRepo): { glyph: string; word: string; color: string } => {
  const s = localState(r)
  if (s === 'empty') return { glyph: '○', word: 'vide', color: C.gray }
  if (s === 'merged') return { glyph: '✓', word: 'fusionnée', color: C.green }
  if (s === 'toMerge') return { glyph: '⤞', word: `${r.toMerge} à fusionner`, color: C.slate }
  return { glyph: '◌', word: 'non publiée', color: C.amber }
}
const unpublishedText = (r: GitRepo): [string, string] => {
  const u = unpublishedOf(r)
  return [`${u.glyph} ${u.word}`.replace(/ /g, NB), u.color]
}

// ─── Route de livraison (Commit → Push → PR → Checks → Fusion) ────────────

/** Formes courtes de la route en texte, quand le libellé entier ne tient pas. */
const SHORT_LABEL: Record<string, string> = { Commit: 'Com.', Checks: 'CI', Fusion: 'Fus.' }

const STATE_WORD: Record<NodeState, string> = { done: 'fait', active: 'en cours', next: 'à lancer', pending: 'à venir', skipped: 'sauté' }

const roadNodes = (r: GitRepo, pr: PullRequest | null, watch: NonNullable<CiWatch> | null = null): RoadNode[] => {
  if (!r.hasRemote || !r.branch) return []
  const n = countsOf(r)
  const steps: { label: string; sub: string; color: string; isDone: boolean }[] = [
    { label: 'Commit', sub: r.files.length ? plural(r.files.length, 'fichier') : 'propre', color: n.conflicts ? C.red : C.green, isDone: r.files.length === 0 },
    {
      label: 'Push',
      sub: !r.upstream ? unpublishedOf(r).word : r.ahead ? `↑${r.ahead}` : 'à jour',
      color: C.cyan,
      isDone: (Boolean(r.upstream) && r.ahead === 0) || localState(r) === 'merged',
    },
  ]
  if (r.webUrl && r.branch !== r.defaultBranch) {
    const live = pr && pr.state !== 'CLOSED' ? pr : null
    steps.push({ label: 'PR', sub: live ? `#${live.number}` : 'à ouvrir', color: C.violet, isDone: live !== null })
    // Pendant le suivi de la CI, ses checks l'emportent : « en attente » tant que rien n'est
    // lancé, au lieu d'un « aucun » fait (sans suivi, les deux se confondent).
    const ch = live ? (watch?.checks ?? live.checks) : undefined
    const hasChecks = ch !== undefined && ch.passed + ch.failed + ch.pending > 0
    const isWaiting = Boolean(live) && watch?.phase === 'waiting'
    steps.push({
      label: 'Checks',
      sub: !ch ? '' : isWaiting ? 'attente' : ch.failed ? `✗${ch.failed}` : ch.pending ? `◌${ch.pending}` : hasChecks ? `✓${ch.passed}` : 'aucun',
      color: ch && ch.failed ? C.red : C.cyan,
      isDone: Boolean(live) && ch !== undefined && !isWaiting && ch.failed === 0 && ch.pending === 0,
    })
    steps.push({ label: 'Fusion', sub: live?.state === 'MERGED' ? 'fusionnée' : '', color: C.violet, isDone: live?.state === 'MERGED' })
  }
  // Une route se parcourt dans l'ordre : la première étape non faite est active, et toutes
  // les suivantes sont à venir, même si leur état propre dit « fait ». Un commit à pousser
  // rend la PR, les checks et la fusion d'avant caducs : il en faudra de nouveaux. Leur
  // sous-titre ne garde que le numéro d'une PR encore ouverte, que le push mettra à jour.
  let isOpen = true
  return steps.map((s) => {
    let state: NodeState = 'pending'
    let sub = s.sub
    if (s.isDone && isOpen) state = 'done'
    else if (isOpen) {
      state = 'active'
      isOpen = false
    } else if (!(s.label === 'PR' && pr?.state === 'OPEN')) sub = ''
    return sub ? { label: s.label, sub, color: s.color, state } : { label: s.label, color: s.color, state }
  })
}

/** La route en texte (repli terminal) : glyphes reliés, libellés dessous. */
const textRoad = (k: Kit, nodes: readonly RoadNode[], cells: number): unknown => {
  const { Box } = k
  const n = nodes.length
  const slot = Math.max(3, Math.floor((cells - 1) / Math.max(1, n)))
  const glyph = (x: RoadNode): string => (x.state === 'done' ? '●' : x.state === 'active' ? '◉' : x.state === 'next' ? '◎' : x.state === 'skipped' ? '·' : '○')
  const marks: unknown[] = []
  const labels: unknown[] = []
  nodes.forEach((x, i) => {
    const isLit = x.state !== 'pending' && x.state !== 'skipped'
    marks.push(T(k, glyph(x), { color: isLit ? x.color : C.gray, bold: x.state === 'active' }))
    if (i < n - 1) {
      const isDone = x.state === 'done' || x.state === 'skipped'
      marks.push(T(k, (isDone ? '━' : x.state === 'active' ? '╍' : '┄').repeat(slot - 1), { color: isDone ? x.color : C.gray, dim: !isDone }))
    }
    // Un libellé entier ou sa forme courte fixe, jamais coupé au milieu du mot.
    const showLabel = slot >= 6 || x.state === 'active'
    const short = SHORT_LABEL[x.label] ?? x.label
    const text = !showLabel ? '' : x.label.length <= slot - 1 ? x.label : short.length <= slot - 1 ? short : ''
    labels.push(T(k, i < n - 1 ? text.padEnd(slot) : text, { color: x.state === 'active' ? x.color : '', bold: x.state === 'active', dim: x.state !== 'active' }))
  })
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">{marks}</Box>
      <Box flexDirection="row">{labels}</Box>
    </Box>
  )
}

const roadmap = (k: Kit, r: GitRepo, pr: PullRequest | null, watch: NonNullable<CiWatch> | null, cells: number): unknown => {
  const { Box } = k
  const nodes = roadNodes(r, pr, watch)
  if (nodes.length === 0) return null
  if (!k.isRich) return textRoad(k, nodes, cells)
  const alt = nodes.map((x) => `${x.label} : ${STATE_WORD[x.state]}${x.sub ? ` (${x.sub})` : ''}`).join(', ')
  return <Box marginTop={1}>{svgOf(k, roadmapSvg(nodes, px(cells)), alt, false)}</Box>
}

// ─── Panneau ──────────────────────────────────────────────────────────────

export const drawPane = (k: Kit, view: View, act: Actions): unknown => {
  const { Box } = k
  const r = view.repo
  if (!r) {
    return (
      <Box flexDirection="column" paddingX={1} paddingBottom={1}>
        {welcome(k, view, act)}
        {activity(k, view, act)}
      </Box>
    )
  }
  const body = view.tab === 'branches' ? branchesTab(k, view, r, act) : view.tab === 'history' ? historyTab(k, view, r, act) : changesTab(k, view, r, act)
  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      {hero(k, view, r, act)}
      {activity(k, view, act)}
      {operationCard(k, r)}
      {actionBar(k, view, r, act)}
      {drawer(k, view, r, act)}
      {tabsRow(k, view, r, act)}
      {body}
    </Box>
  )
}

/** Sans dépôt : une carte d'accueil, jamais un panneau vide. */
const welcome = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button, Input } = k
  const m = view.meta
  return (
    <Box key="empty" flexDirection="column" borderStyle="round" borderColor={C.violet} paddingX={2} paddingY={1}>
      {/* Pendant une lecture, l'indicateur est dans la zone d'activité, juste dessous. */}
      {T(k, m.loading ? `◆${NB}Git` : `◆${NB}Pas de dépôt git ici`, { color: C.violet, bold: true })}
      {m.error && T(k, m.error, { dim: true, wrap: 'wrap' })}
      {T(k, 'Le panneau se remplit dès que le dossier suivi est dans un dépôt git.', { dim: true, wrap: 'wrap' })}
      {Input ? (
        <Box flexDirection="column" marginTop={1}>
          <Input key="folder" label="Dossier" placeholder="chemin d'un dépôt git" submitLabel="ouvrir" onSubmit={(v: string) => act.openFolder(v)} />
          <Box marginTop={1}>{T(k, 'ou /git <dossier>', { dim: true })}</Box>
        </Box>
      ) : (
        unavailable(k, 'Saisie du dossier indisponible ici : tape /git <dossier>.')
      )}
      {m.folder !== null && (
        <Box marginTop={1}>
          <Button key="back-session" label={`↩${NB}Dossier${NB}de${NB}la${NB}session`} onPress={() => act.backToSession()} />
        </Box>
      )}
    </Box>
  )
}

/**
 * Carte d'en-tête : pastille de la branche, jauge ↑/↓ (SVG) à gauche du dépôt et de sa
 * méta, état en pastilles par gravité, PR sur une ligne, route. Chaque chiffre n'y est
 * dit qu'une fois : sur une surface riche la jauge porte ↑/↓, ailleurs ce sont les pastilles.
 */
const hero = (k: Kit, view: View, r: GitRepo, act: Actions): unknown => {
  const { Box, Button } = k
  const m = view.meta
  const n = countsOf(r)
  const pr = prOfBranch(r, view.pr)
  const prs = view.pr
  const watch = ciOf(r, view.ci)
  const inner = k.width - 6
  const color = r.operation || n.conflicts ? C.red : r.branch ? BRAND : C.gray
  const isHere = m.sessionRoot !== null && sameDir(m.sessionRoot, r.root)
  const fetched = fetchedText(m, view.now, r.hasRemote)
  const hasGauge = k.isRich && Boolean(r.upstream)

  // L'état, par gravité : ce qui bloque d'abord, l'anecdotique (stash) en dernier.
  const pills: [string, string][] = []
  if (r.operation) pills.push([`${OPERATION[r.operation] ?? r.operation}${NB}en${NB}cours`, C.red])
  if (n.conflicts) pills.push([`✖${NB}${n.conflicts}${NB}en${NB}conflit`, C.red])
  if (r.branch && r.upstream) {
    if (r.behind && !hasGauge) pills.push([`↓${NB}${r.behind}${NB}à${NB}récupérer`, C.amber])
    if (r.ahead && !hasGauge) pills.push([`↑${NB}${r.ahead}${NB}à${NB}pousser`, C.green])
    if (!r.ahead && !r.behind) pills.push([`✓${NB}à${NB}jour`, C.green])
  } else if (r.branch && r.hasRemote) {
    pills.push(unpublishedText(r))
  }
  if (n.changed) pills.push([`●${NB}${n.changed}${NB}modifié${n.changed > 1 ? 's' : ''}`, C.amber])
  if (n.fresh) pills.push([`+${NB}${n.fresh}${NB}nouveau${n.fresh > 1 ? 'x' : ''}`, C.teal])
  if (r.stash) pills.push([`⚑${NB}${r.stash}${NB}stash`, C.slate])

  const gauge = hasGauge
    ? svgOf(k, gaugeSvg(r.ahead, r.behind, C.green, C.amber), `${r.ahead} commit${r.ahead > 1 ? 's' : ''} à pousser, ${r.behind} à récupérer`)
    : null
  const meta = [r.upstream ? `suit${NB}${r.upstream}` : r.hasRemote ? 'aucune branche distante suivie' : 'pas de distant', fetched && !fetched.isError ? fetched.text : null]
    .filter(Boolean)
    .join(SEP)

  // La pastille vivante ne dit que la commande /project ; lectures et bascules sont dans
  // la zone d'activité, juste dessous.
  const pending = view.running
  const live = pending !== null ? T(k, pending.isStarted ? `◉${NB}Claude${NB}travaille` : `▶${NB}en${NB}file`, { color: C.tangerine, bold: true }) : null

  const review = pr ? reviewOf(pr.review) : null
  const prLine = pr ? (
    <Box key="pr" flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
      <Box flexShrink={1}>
        {TT(
          k,
          [
            T(k, `⇄${NB}#${pr.number}`, { color: C.violet, bold: true }),
            T(k, SEP, { dim: true }),
            T(k, prLabel(pr), { color: prColor(pr), bold: true }),
            ...(review ? [T(k, SEP, { dim: true }), T(k, review[0], { color: review[1] })] : []),
            ...(watch ? [ciText(watch)] : checksText(pr.checks)).flatMap(([text, c]) => [T(k, SEP, { dim: true }), T(k, text, { color: c })]),
            pr.title ? T(k, `${SEP}${pr.title}`, { dim: true }) : '',
          ],
          { wrap: 'truncate-end' },
        )}
      </Box>
      {pr.url && (
        <Box flexShrink={0} marginLeft={1}>
          {urlCell(k, 'pr-link', pr.url, { label: 'Ouvrir ↗', ...PR_LINK }, act)}
        </Box>
      )}
    </Box>
  ) : prs && prs.branch === (r.branch ?? '') && !prs.error && r.webUrl && r.branch && r.branch !== r.defaultBranch ? (
    <Box key="no-pr" marginTop={1}>
      {T(k, `⇄${NB}pas encore de pull request pour cette branche`, { dim: true, wrap: 'truncate-end' })}
    </Box>
  ) : null

  return (
    <Box key="head" flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexShrink={1}>{chip(k, `⎇${NB}${branchLabel(r)}`, color, { wrap: 'truncate-end' })}</Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={1} alignItems="center">
          {live && <Box marginRight={1}>{live}</Box>}
          {m.folder !== null && (
            <Box marginRight={1}>
              <Button key="back-session" plain={true} dimColor={true} label={`↩${NB}session`} onPress={() => act.backToSession()} />
            </Box>
          )}
          <Button key="refresh" plain={true} label={`↻${NB}Relire`} onPress={() => act.refresh()} />
        </Box>
      </Box>
      <Box flexDirection="row" alignItems="center" marginTop={1}>
        {gauge && (
          <Box marginRight={2} flexShrink={0}>
            {gauge}
          </Box>
        )}
        <Box flexDirection="column" flexShrink={1}>
          {TT(k, [T(k, r.name, { bold: true }), T(k, `${SEP}${meta}`, { dim: true })], { wrap: 'truncate-end' })}
          {fetched && fetched.isError && T(k, `${fetched.text}${m.fetchError ? ` : ${m.fetchError}` : ''}`, { color: C.red, wrap: 'truncate-end' })}
          {!isHere && T(k, `↗${NB}hors du dossier de la session : les commandes /project n'agissent pas ici`, { color: C.amber, wrap: 'truncate-end' })}
        </Box>
      </Box>
      {pills.length > 0 && <Box marginTop={1}>{line(k, pills.map(([text, c]) => chip(k, text, c)), true)}</Box>}
      {prLine}
      {/* Sans PR, la CI suivie après un push a sa propre ligne. */}
      {!pr && watch && <Box marginTop={1}>{T(k, ciText(watch)[0], { color: ciText(watch)[1], wrap: 'truncate-end' })}</Box>}
      {prs && prs.branch === (r.branch ?? '') && prs.error && <Box marginTop={1}>{T(k, prs.error, { color: C.amber, wrap: 'truncate-end' })}</Box>}
      {roadmap(k, r, pr, watch, inner)}
    </Box>
  )
}

/** La zone d'activité, toujours juste sous la carte d'en-tête. */
const activity = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const m = view.meta
  const run = view.running
  const said = view.notice
  const rows = [
    m.loading && line(k, [spinner(k, C.gray, view.now, 'lecture'), T(k, m.loading, { color: C.gray })]),
    view.busy && line(k, [spinner(k, C.tangerine, view.now, 'git au travail'), T(k, view.busy, { color: C.tangerine })]),
    run &&
      (run.isStarted
        ? T(k, `◉${NB}${run.command} en cours dans la conversation…`, { color: C.tangerine, wrap: 'wrap' })
        : T(k, `▶${NB}${run.command} en file : il part dès que Claude est libre.`, { color: C.tangerine, wrap: 'wrap' })),
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

const operationCard = (k: Kit, r: GitRepo): unknown => {
  const { Box } = k
  if (!r.operation) return null
  const n = countsOf(r).conflicts
  return (
    <Box key="operation" flexDirection="column" borderStyle="round" borderColor={C.red} paddingX={1} marginTop={1}>
      {T(k, `${OPERATION[r.operation] ?? r.operation} en cours`, { color: C.red, bold: true })}
      {T(k, n ? `${plural(n, 'fichier')} en conflit : résous-les, puis termine ou annule l'opération.` : "Termine-la ou annule-la avant de commiter ou de changer de branche.", { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

/**
 * Barre d'actions : un seul `primary`, l'étape suggérée, et seulement tant que son tiroir
 * est fermé (le tiroir porte alors « ▶ Lancer »). Le tiroir ouvert est marqué « ▾ ». Pas
 * de comptes dans les libellés : l'en-tête les dit déjà.
 */
const actionBar = (k: Kit, view: View, r: GitRepo, act: Actions): unknown => {
  const { Box, Button } = k
  const lead = suggest(r, view.pr)
  const pr = prOfBranch(r, view.pr)
  const button = (a: Action, glyph: string, label: string) => {
    const props: Record<string, unknown> = { key: `act-${a}`, label: `${view.action === a ? '▾' : glyph}${NB}${label}`, onPress: () => act.toggleAction(a) }
    if (a === lead && view.action !== a) props.variant = 'primary'
    return h(Button, props)
  }
  return (
    <Box key="bar" marginTop={1}>
      {line(
        k,
        [
          button('commit', '✓', 'Commit'),
          button('pull', '↓', 'Pull'),
          button('push', '↑', 'Push'),
          button('pr', '⇄', pr && pr.state === 'OPEN' ? `PR${NB}#${pr.number}` : `Pull${NB}request`),
        ],
        true,
      )}
    </Box>
  )
}

// ─── Tiroir de l'action choisie ─────────────────────────────────────────

const drawer = (k: Kit, view: View, r: GitRepo, act: Actions): unknown => {
  const { Box, Button, Input, Select } = k
  const open = view.action
  if (!open) return null
  const m = view.meta
  const f = view.form
  const n = countsOf(r)
  const pr = prOfBranch(r, view.pr)
  // Les commandes /project agissent sur le dossier de la session, pas sur celui du panneau.
  const isHere = m.sessionRoot !== null && sameDir(m.sessionRoot, r.root)
  const say = (text: string, color = '') => <Box marginTop={1}>{T(k, text, color ? { color, wrap: 'wrap' } : { dim: true, wrap: 'wrap' })}</Box>
  // `canLaunch` : « ▶ Lancer » est proposé ; `more` : un second bouton de lancement à côté.
  const card = (a: Action, title: string, body: unknown[], canLaunch: boolean, more: unknown = null) => (
    <Box key={`drawer-${a}`} flexDirection="column" borderStyle="round" borderColor={ACTION_COLOR[a]} paddingX={1} marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {T(k, title, { color: ACTION_COLOR[a], bold: true })}
        {/* Pas de role="dismiss" : sur le desktop, il deviendrait la fermeture native du panneau. */}
        <Button key="drawer-close" plain={true} dimColor={true} label="✕" onPress={() => act.closeAction()} />
      </Box>
      {body.filter(isShown)}
      {(canLaunch || isShown(more)) && !isHere && say(`Les commandes /project agissent sur le dossier de la session${m.sessionRoot ? ` (${m.sessionRoot})` : ''} : ouvre une session dans ${r.root} pour les lancer d'ici.`, C.amber)}
      {(canLaunch || isShown(more)) && isHere && (
        <Box flexDirection="row" alignItems="center" marginTop={1}>
          {line(k, [canLaunch && <Button key="launch" variant="primary" label={`▶${NB}Lancer`} onPress={() => act.launch(a)} />, more, T(k, 'part dès que Claude est libre', { dim: true })], true)}
        </Box>
      )}
    </Box>
  )

  if (open === 'commit') {
    if (!r.files.length) return card('commit', '✓ Commit', [say("Rien à commiter : l'arbre de travail est propre.")], false)
    if (n.conflicts) return card('commit', '✓ Commit', [say('Résous d’abord les fichiers en conflit.', C.red)], false)
    return card(
      'commit',
      '✓ Commit',
      [
        say('Claude lit le diff, rédige le message et commite (fichiers indexés par chemin).'),
        Input ? (
          <Box marginTop={1}>
            <Input
              key="hint"
              label="Indice"
              placeholder="facultatif : l'intention du changement"
              value={f.hint}
              submitLabel="lancer"
              onInput={(v: string) => act.setForm({ hint: v })}
              onSubmit={async (v: string) => {
                await act.setForm({ hint: v })
                if (isHere) await act.launch('commit')
              }}
            />
          </Box>
        ) : (
          unavailable(k, "Indice indisponible ici : la commande part sans indice.")
        ),
      ],
      true,
    )
  }
  // HEAD détachée (aussi pendant un rebase) : ni pull, ni push, ni PR n'ont de branche.
  if (!r.branch) {
    const title = open === 'pull' ? '↓ Pull' : open === 'push' ? '↑ Push' : '⇄ Pull request'
    return card(open, title, [say('HEAD détachée : bascule sur une branche (onglet Branches) avant pull, push ou PR.', C.amber)], false)
  }
  if (open === 'pull') {
    // Deux boutons : « ▶ Lancer » depuis la branche distante, « ▶ Intégrer <défaut> » depuis la base.
    const canBase = canSyncBase(r)
    return card(
      'pull',
      '↓ Pull',
      [
        r.upstream ? say(`▶ Lancer : pull --rebase --autostash depuis ${r.upstream}.`) : say("Branche pas encore publiée : rien à récupérer de son côté.", C.amber),
        canBase && say(`▶ Intégrer ${r.defaultBranch} : intègre origin/${r.defaultBranch}, par merge si la branche est publiée, par rebase sinon.`),
      ],
      Boolean(r.upstream),
      canBase && <Button key="launch-base" label={`▶${NB}Intégrer${NB}${r.defaultBranch}`} onPress={() => act.launchBase()} />,
    )
  }
  if (open === 'push') {
    // Une branche sans distante qui ne se pousse pas d'ici : ni version, ni push à proposer.
    const s = localState(r)
    if (r.hasRemote && s && s !== 'unpublished') {
      const base = r.defaultBranch ?? 'la branche par défaut'
      const why =
        s === 'empty'
          ? say('○ Branche vide : aucun commit depuis sa création, rien à pousser.', C.gray)
          : s === 'merged'
            ? say(`✓ Fusionnée dans ${base} : rien à pousser d'ici.`, C.green)
            : say(`⤞ À fusionner dans ${base} d'abord : la branche d'un worktree se fusionne en local, elle ne se pousse pas.`, C.slate)
      return card('push', '↑ Push', [why], false)
    }
    const nothing = !r.files.length && !r.ahead && Boolean(r.upstream)
    return card(
      'push',
      '↑ Push',
      [
        say('Commit du reste, contrôles du projet, pull --rebase puis push, jamais en force.'),
        !r.hasRemote && say('Pas de dépôt distant : rien où pousser.', C.amber),
        r.hasRemote && r.branch && r.branch === r.defaultBranch && say(`Tu es sur ${r.branch} : Claude demandera s'il faut y pousser ou créer une branche.`, C.amber),
        r.hasRemote && nothing && say(`✓ Rien à pousser : tout est déjà sur ${r.upstream}.`, C.green),
        // Le numéro de version et le CHANGELOG se montent avant de pousser, pas après.
        r.hasRemote && !nothing && say(`Avant de pousser : ${VERSION_COMMAND} monte le numéro de version et le CHANGELOG d'après les commits.`, C.amber),
        r.hasRemote && !nothing && isHere && (
          <Box flexDirection="row" alignItems="center" marginTop={1}>
            {line(k, [<Button key="launch-version" label={`▶${NB}D'abord${NB}la${NB}version`} onPress={() => act.launchVersion()} />])}
          </Box>
        ),
      ],
      r.hasRemote && !nothing,
    )
  }
  // Pull request.
  if (!r.webUrl) return card('pr', '⇄ Pull request', [say("Pas de distant GitHub : pas de pull request possible.", C.amber)], false)
  if (pr && pr.state === 'OPEN') {
    return card(
      'pr',
      `⇄ Pull request #${pr.number}`,
      [
        say(pr.title),
        <Box marginTop={1}>
          {line(k, [T(k, `${prLabel(pr)} vers ${pr.base}`, { color: prColor(pr) }), pr.url && urlCell(k, 'pr-card-link', pr.url, { label: 'Ouvrir sur GitHub ↗', ...PR_LINK }, act)])}
        </Box>,
      ],
      false,
    )
  }
  if (r.branch === r.defaultBranch) {
    return card('pr', '⇄ Pull request', [say("Branche par défaut : crée d'abord une branche de travail (onglet Branches).", C.amber)], false)
  }
  const bases = unique([r.defaultBranch, ...r.branches.map((b) => b.name)].filter((b): b is string => Boolean(b) && b !== r.branch)).slice(0, 30)
  const base = f.prBase && bases.includes(f.prBase) ? f.prBase : (bases[0] ?? '')
  return card(
    'pr',
    '⇄ Pull request',
    [
      say('Titre et description tirés des commits ; la branche est poussée si besoin.'),
      pr && say(`La dernière PR de cette branche (#${pr.number}) est ${prLabel(pr).toLowerCase()} : une nouvelle sera créée.`),
      Select ? (
        bases.length > 0 && (
          <Box marginTop={1}>
            {line(
              k,
              [
                <Select key="pr-base" label="Vers" options={bases.map((b) => ({ value: b, label: b === r.defaultBranch ? `${b} (défaut)` : b }))} value={base} onSelect={(v: string) => act.setForm({ prBase: v })} />,
                <Select
                  key="pr-draft"
                  label="État"
                  options={[
                    { value: 'ready', label: 'Prête à relire' },
                    { value: 'draft', label: 'Brouillon' },
                  ]}
                  value={f.prDraft ? 'draft' : 'ready'}
                  onSelect={(v: string) => act.setForm({ prDraft: v === 'draft' })}
                />,
                <Select
                  key="pr-auto"
                  label="Fusion"
                  options={[
                    { value: 'manual', label: 'Manuelle' },
                    { value: 'auto', label: 'Auto (squash)' },
                  ]}
                  value={f.prAuto ? 'auto' : 'manual'}
                  onSelect={(v: string) => act.setForm({ prAuto: v === 'auto' })}
                />,
              ],
              true,
            )}
          </Box>
        )
      ) : (
        unavailable(k, 'Base, brouillon et fusion auto indisponibles ici : PR prête à relire vers la branche par défaut.')
      ),
    ],
    true,
  )
}

// ─── Onglets ──────────────────────────────────────────────────────────────

const tabsRow = (k: Kit, view: View, r: GitRepo, act: Actions): unknown => {
  const { Box, Button } = k
  const tabs: [Tab, string][] = [
    ['changes', `Modifications${NB}·${NB}${r.files.length}`],
    ['branches', `Branches${NB}·${NB}${r.branches.length + r.remotes.length}`],
    ['history', `Historique${NB}·${NB}${r.commits.length}`],
  ]
  return (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" marginTop={1}>
      {tabs.map(([tab, label]) => (
        <Box marginRight={2}>
          <Button key={`tab-${tab}`} plain={true} dimColor={tab !== view.tab} label={tab === view.tab ? `▸${NB}${label}` : label} onPress={() => act.setTab(tab)} />
        </Box>
      ))}
    </Box>
  )
}

// ─── Modifications ────────────────────────────────────────────────────────

const GROUPS: { id: string; glyph: string; label: string; color: string; test: (f: GitFile) => boolean }[] = [
  { id: 'conflict', glyph: '✖', label: 'En conflit', color: C.red, test: (f) => f.kind === 'conflict' },
  { id: 'staged', glyph: '◆', label: 'Indexés', color: C.green, test: (f) => f.kind === 'changed' && f.work === '.' },
  { id: 'changed', glyph: '●', label: 'Modifiés', color: C.amber, test: (f) => f.kind === 'changed' && f.work !== '.' },
  { id: 'untracked', glyph: '+', label: 'Nouveaux', color: C.teal, test: (f) => f.kind === 'untracked' },
]

const changesTab = (k: Kit, view: View, r: GitRepo, act: Actions): unknown => {
  const { Box } = k
  if (!r.files.length) {
    return (
      <Box key="clean" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
        {T(k, `✓${NB}Arbre de travail propre`, { color: C.green, bold: true })}
        {T(k, 'Rien à commiter. Les fichiers modifiés apparaîtront ici.', { dim: true, wrap: 'wrap' })}
      </Box>
    )
  }
  const n = countsOf(r)
  const sorted = GROUPS.flatMap((g) => r.files.filter(g.test).sort((a, b) => a.path.localeCompare(b.path)))
  const limit = view.expanded.files ? MAX_FILES : FILES_CAP
  const shown = new Set(sorted.slice(0, limit))
  const total = n.added + n.removed
  const cells = Math.min(24, Math.max(8, k.width - 50))
  const parts: BarPart[] = [
    { value: n.added, color: C.green },
    { value: n.removed, color: C.red },
  ]
  const bar = total > 0 ? (k.isRich ? svgOf(k, barSvg(parts, total, px(cells)), `${n.added} lignes ajoutées, ${n.removed} retirées`) : blocks(k, parts, total, cells)) : null
  // L'onglet actif dit déjà le nombre de fichiers : la carte n'ouvre que sur le total des
  // lignes et sa barre, quand il y en a.
  const head =
    total > 0 ? (
      <Box key="diff-total" flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexShrink={1}>{line(k, [n.added > 0 && T(k, `+${n.added}`, { color: C.green }), n.removed > 0 && T(k, `−${n.removed}`, { color: C.red }), T(k, 'lignes', { dim: true })])}</Box>
        {bar && k.width >= 56 && (
          <Box flexShrink={0} marginLeft={1}>
            {bar}
          </Box>
        )}
      </Box>
    ) : null
  let isFirst = head === null
  return (
    <Box key="files" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {head}
      {GROUPS.map((g) => {
        const files = sorted.filter((f) => g.test(f))
        const visible = files.filter((f) => shown.has(f))
        if (visible.length === 0) return null
        const top = isFirst ? 0 : 1
        isFirst = false
        return (
          <Box key={`g-${g.id}`} flexDirection="column" marginTop={top}>
            {line(k, [T(k, `${g.glyph}${NB}${g.label}`, { color: g.color, bold: true }), T(k, String(files.length), { dim: true })])}
            {visible.map((f) => fileRow(k, f))}
          </Box>
        )
      })}
      {sorted.length > FILES_CAP && showAllToggle(k, 'files-all', view.expanded.files, sorted.length, () => act.toggleExpanded('files'))}
      {view.expanded.files && sorted.length > MAX_FILES && T(k, `+${sorted.length - MAX_FILES}`, { dim: true })}
    </Box>
  )
}

const fileRow = (k: Kit, file: GitFile): unknown => {
  const { Box } = k
  const g = glyphOf(file)
  // Un dossier non suivi finit par « / » : son nom est le dernier segment, barre comprise.
  const cut = file.path.replace(/\/$/, '').lastIndexOf('/')
  const partial = file.kind === 'changed' && file.index !== '.' && file.work !== '.'
  return (
    <Box key={`f-${file.path}`} flexDirection="row">
      <Box width={2} flexShrink={0}>
        {T(k, g.letter, { color: g.color, bold: true })}
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {TT(k, [T(k, file.path.slice(0, cut + 1), { dim: true }), file.path.slice(cut + 1), file.from ? T(k, ` ← ${file.from}`, { dim: true }) : ''], { wrap: 'truncate-start' })}
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        {line(k, [
          partial && T(k, `en${NB}partie${NB}indexé`, { dim: true }),
          file.added !== null && T(k, `+${file.added}`, { color: C.green }),
          file.removed !== null && T(k, `−${file.removed}`, { color: C.red }),
        ])}
      </Box>
    </Box>
  )
}

// ─── Branches ─────────────────────────────────────────────────────────────

const branchesTab = (k: Kit, view: View, r: GitRepo, act: Actions): unknown => {
  const { Box, Button, Input } = k
  const f = view.form
  const pending = view.switching
  const q = f.filter.trim().toLowerCase()
  const locals = r.branches.filter((b) => !q || b.name.toLowerCase().includes(q))
  const remotes = r.remotes.filter((b) => !q || b.name.toLowerCase().includes(q))
  const showRemotes = view.showRemotes || Boolean(q)
  // Chaque liste a sa bascule « tout voir » ; un filtre montre tout.
  const shownLocals = view.expanded.branches || q ? locals : locals.slice(0, BRANCHES_CAP)
  const shownRemotes = view.expanded.remotes || q ? remotes : remotes.slice(0, BRANCHES_CAP)
  return (
    <Box key="branches" flexDirection="column" marginTop={1}>
      {pending && confirmCard(k, view, r, pending, act)}
      {Input ? (
        <Box flexDirection="column" marginTop={pending ? 1 : 0}>
          <Input
            key="new-branch"
            label="Nouvelle branche"
            placeholder="feat/nom-court"
            value={f.newBranch}
            submitLabel="créer et basculer"
            onInput={(v: string) => act.setForm({ newBranch: v })}
            onSubmit={(v: string) => act.createBranch(v)}
          />
          {r.branches.length + r.remotes.length > 6 && (
            <Box marginTop={1}>
              <Input key="filter" label="Filtrer" placeholder="nom de branche" value={f.filter} onInput={(v: string) => act.setForm({ filter: v })} onSubmit={(v: string) => act.setForm({ filter: v })} />
            </Box>
          )}
        </Box>
      ) : (
        unavailable(k, 'Création et filtre de branches indisponibles ici (pas de champ de saisie).', pending ? 1 : 0)
      )}
      <Box key="locals" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
        {line(k, [T(k, 'Locales', { bold: true }), T(k, String(locals.length), { dim: true })])}
        {shownLocals.map((b) => branchRow(k, view, r, b, act))}
        {q && !locals.length && !remotes.length && T(k, 'Aucune branche ne correspond.', { dim: true })}
        {!q && locals.length > BRANCHES_CAP && showAllToggle(k, 'branches-all', view.expanded.branches, locals.length, () => act.toggleExpanded('branches'))}
      </Box>
      {remotes.length > 0 && (
        <Box key="remotes" flexDirection="column" marginTop={1}>
          <Button
            key="remotes-toggle"
            plain={true}
            dimColor={true}
            label={`${showRemotes ? '▾' : '▸'}${NB}Seulement${NB}sur${NB}le${NB}distant${NB}·${NB}${remotes.length}`}
            onPress={() => act.toggleRemotes()}
          />
          {showRemotes && shownRemotes.map((b) => remoteRow(k, view, b, act))}
          {showRemotes && !q && remotes.length > BRANCHES_CAP && showAllToggle(k, 'remotes-all', Boolean(view.expanded.remotes), remotes.length, () => act.toggleExpanded('remotes'))}
        </Box>
      )}
    </Box>
  )
}

const branchRow = (k: Kit, view: View, r: GitRepo, b: GitBranch, act: Actions): unknown => {
  const { Box, Button } = k
  const track: [string, string] = b.worktree
    ? ['ouverte dans un autre worktree', C.gray]
    : b.isGone
      ? [`distante${NB}supprimée`, C.red]
      : !b.upstream
        ? ['locale', C.gray]
        : b.ahead || b.behind
          ? [[b.ahead ? `↑${b.ahead}` : '', b.behind ? `↓${b.behind}` : ''].filter(Boolean).join(NB), b.behind ? C.amber : C.green]
          : [`✓${NB}à${NB}jour`, C.green]
  return (
    <Box key={`b-${b.name}`} flexDirection="row" alignItems="center">
      <Box width={2} flexShrink={0}>
        {T(k, b.isCurrent ? '●' : '○', { color: b.isCurrent ? BRAND : C.gray, bold: b.isCurrent })}
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {TT(k, [T(k, b.name, { bold: b.isCurrent }), b.name === r.defaultBranch ? T(k, `${NB}${NB}défaut`, { dim: true }) : ''], { wrap: 'truncate-end' })}
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        {line(k, [
          T(k, track[0], { color: track[1], dim: track[1] === C.gray }),
          k.width >= 64 && T(k, ago(b.date, view.now), { dim: true }),
          !b.isCurrent && !b.worktree && <Button key={`sw-${b.name}`} plain={true} dimColor={true} label={`↪${NB}basculer`} onPress={() => act.askSwitch(b.name, false)} />,
        ])}
      </Box>
    </Box>
  )
}

const remoteRow = (k: Kit, view: View, b: GitRemoteBranch, act: Actions): unknown => {
  const { Box, Button } = k
  return (
    <Box key={`rb-${b.name}`} flexDirection="row" alignItems="center">
      <Box width={2} flexShrink={0}>
        {T(k, '☁', { color: C.blue })}
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {T(k, b.name, { wrap: 'truncate-end' })}
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        {line(k, [k.width >= 64 && T(k, ago(b.date, view.now), { dim: true }), <Button key={`swr-${b.name}`} plain={true} dimColor={true} label={`↪${NB}basculer`} onPress={() => act.askSwitch(b.name, true)} />])}
      </Box>
    </Box>
  )
}

const confirmCard = (k: Kit, view: View, r: GitRepo, s: NonNullable<Switching>, act: Actions): unknown => {
  const { Box, Button } = k
  const target = s.isRemote ? localOf(s.name) : s.name
  const changed = countsOf(r).changed + countsOf(r).conflicts
  return (
    <Box key="confirm" flexDirection="column" borderStyle="round" borderColor={C.amber} paddingX={1}>
      {T(k, `Basculer vers ${target} ?`, { color: C.amber, bold: true })}
      {T(k, `${plural(changed, 'fichier modifié', 'fichiers modifiés')} suivr${changed > 1 ? 'ont' : 'a'} ; git refuse si l'un entre en conflit. Pour les garder ici, commite d'abord.`, { dim: true, wrap: 'wrap' })}
      <Box marginTop={1}>
        {line(k, [
          <Button key="confirm-yes" variant="primary" label={`↪${NB}Basculer${NB}quand${NB}même`} onPress={() => act.confirmSwitch(s.name, s.isRemote)} />,
          <Button key="confirm-no" label="Annuler" onPress={() => act.cancelSwitch()} />,
        ])}
      </Box>
    </Box>
  )
}

// ─── Historique ───────────────────────────────────────────────────────────

const historyTab = (k: Kit, view: View, r: GitRepo, act: Actions): unknown => {
  const { Box } = k
  if (!r.commits.length) {
    return (
      <Box key="no-commits" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
        {T(k, "Aucun commit pour l'instant.", { bold: true })}
        {T(k, 'Les commits de la branche apparaîtront ici.', { dim: true })}
      </Box>
    )
  }
  const unpushed = r.hasRemote ? r.unpushed : 0
  const shown = view.expanded.commits ? r.commits : r.commits.slice(0, COMMITS_CAP)
  return (
    <Box key="history" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {line(k, [
        T(k, 'Historique', { bold: true }),
        T(k, `${r.commits.length}${NB}derniers`, { dim: true }),
        unpushed > 0 && T(k, `↑${NB}${unpushed >= 500 ? '500+' : unpushed}${NB}pas${NB}encore${NB}poussé${unpushed > 1 ? 's' : ''}`, { color: C.green, bold: true }),
      ])}
      {shown.map((c) => commitRow(k, view, r, c, act))}
      {r.commits.length > COMMITS_CAP && showAllToggle(k, 'commits-all', view.expanded.commits, r.commits.length, () => act.toggleExpanded('commits'))}
    </Box>
  )
}

const commitRow = (k: Kit, view: View, r: GitRepo, c: GitCommit, act: Actions): unknown => {
  const { Box } = k
  const isLocal = r.hasRemote && !c.isPushed
  const tags = c.refs
    .split(', ')
    .filter((x) => x.startsWith('tag: '))
    .map((x) => `◆${NB}${x.slice(5)}`)
  return (
    <Box key={`c-${c.hash}`} flexDirection="row">
      <Box width={2} flexShrink={0}>
        {T(k, isLocal ? '↑' : '○', { color: isLocal ? C.green : C.gray, bold: isLocal })}
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {T(k, c.subject, { wrap: 'truncate-end' })}
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        {line(k, [
          ...tags.map((t) => T(k, t, { color: C.violet })),
          T(k, c.short, { dim: true }),
          k.width >= 90 && T(k, c.author, { dim: true }),
          k.width >= 64 && T(k, ago(c.date, view.now), { dim: true }),
          r.webUrl && urlCell(k, `commit-link-${c.hash}`, `${r.webUrl}/commit/${c.hash}`, { label: '↗', copyLabel: '⧉', copied: 'Lien du commit copié' }, act),
        ])}
      </Box>
    </Box>
  )
}

// ─── Bandeau ──────────────────────────────────────────────────────────────




/** Largeur du nom dans la colonne d'étiquette, la même dans les bandeaux Git, Flow et Asana. */
const LABEL_CELLS = 5
/** La colonne d'étiquette : la barre, une espace, le nom calé sur LABEL_CELLS. */
export const TAG_CELLS = 2 + LABEL_CELLS
/**
 * Le bouton de l'étape suivante du bandeau ne paraît que s'il laisse au nom de la branche au
 * moins ces cases (ou son nom entier, s'il est plus court), à côté de ce que la ligne 1 garde
 * toujours : étiquette, état face au distant, fichiers, fetch en échec.
 */
const BRANCH_MIN = 12
/** La couleur de Git dans les bandeaux (mandarine, comme son logo) ; le violet reste celui de Flow. */
const TAG_COLOR = C.tangerine

/**
 * L'étiquette d'outil en tête du bandeau : une barre verticale et le nom du mod en gras, de la
 * couleur du mod. Les bandeaux empilés s'alignent sur cette colonne et se distinguent par sa
 * couleur, sans trait horizontal (un « ─ » répété n'a pas la même largeur sur le desktop que
 * sur le terminal). `label` vide : la barre et la colonne vide, pour la ligne 2 ; `null` : la
 * barre seule, sur un bandeau trop étroit.
 */
const bandTag = (k: Kit, label: string | null, color: string): unknown => (
  <k.Box flexDirection="row" flexShrink={0}>
    {T(k, '▍', { color, bold: true })}
    {label !== null && T(k, `${NB}${label.padEnd(LABEL_CELLS, NB)}`, { color, bold: true })}
  </k.Box>
)

/**
 * Le bandeau au-dessus du prompt : une ligne, deux au plus. Rien hors d'un dépôt ni quand
 * il est masqué (le hook rend alors le bandeau du dessous).
 */
export const drawBand = (k: Kit, view: View, act: Actions): unknown => {
  const r = view.repo
  if (!r || view.isBandHidden) return null
  const { Box, Button } = k
  const width = k.width
  const m = view.meta
  const n = countsOf(r)
  const pr = prOfBranch(r, view.pr)
  const watch = ciOf(r, view.ci)
  const isElsewhere = m.sessionRoot === null || !sameDir(m.sessionRoot, r.root)
  const fetched = fetchedText(m, view.now, r.hasRemote)

  // Ce que la ligne 1 garde toujours, en textes : leur largeur dit si le bouton de l'étape suivante tient.
  const [localText, localColor] = unpublishedText(r)
  const remoteParts: [string, Style][] = r.upstream
    ? r.ahead || r.behind
      ? [r.ahead > 0 && ([`↑${r.ahead}`, { color: C.green, bold: true }] as [string, Style]), r.behind > 0 && ([`↓${r.behind}`, { color: C.amber, bold: true }] as [string, Style])].filter(
          (x): x is [string, Style] => x !== false,
        )
      : [[`✓${NB}à${NB}jour`, { color: C.green }]]
    : r.branch && r.hasRemote
      ? [[localText, { color: localColor }]]
      : []
  const fileParts: [string, Style][] = [
    n.conflicts > 0 && ([`✖${NB}${n.conflicts}`, { color: C.red, bold: true }] as [string, Style]),
    n.changed > 0 && ([`●${NB}${n.changed}`, { color: C.amber }] as [string, Style]),
    n.fresh > 0 && ([`+${NB}${n.fresh}`, { color: C.teal }] as [string, Style]),
  ].filter((x): x is [string, Style] => x !== false)
  const fetchError = fetched && fetched.isError && width >= 64 ? fetched.text : ''
  const remote = remoteParts.length ? line(k, remoteParts.map(([text, style]) => T(k, text, style))) : null
  const files = line(k, fileParts.map(([text, style]) => T(k, text, style)))

  // Le bouton de l'étape suivante passe avant les éléments secondaires : avec lui, ceux-ci
  // demandent sa largeur en plus de leur palier (« [ ▶ Commit ] » au terminal et sa marge).
  // Il ne paraît que si la ligne 1 le tient sans couper la branche sous BRANCH_MIN : à droite
  // le bouton, « ▸ Ouvrir » et « x » avec leurs marges ; à gauche l'étiquette, « ⎇ » et ce
  // qu'elle garde toujours, chacun suivi d'une marge.
  const candidate = bandNext(r, view.pr, m, view.running, view.isFlowActive)
  const nextLabel = candidate ? `▶${NB}${NEXT_LABEL[candidate]}` : ''
  const nextCells = nextLabel.length + 5
  const kept = [...remoteParts.map(([text]) => text), fileParts.map(([text]) => text).join(NB), fetchError].filter(Boolean)
  const leftCells = TAG_CELLS + 1 + 2 + kept.reduce((sum, text) => sum + text.length + 1, 0)
  const rightCells = nextCells + `▸${NB}Ouvrir`.length + 1 + 1 + 1
  const lead = candidate && width - rightCells - leftCells >= Math.min(BRANCH_MIN, branchLabel(r).length) ? candidate : null
  const room = lead ? width - nextCells : width
  // Un « · » sépare les fichiers (« + 1 » nouveau) du total des lignes (« +13 »).
  const diff =
    room >= 72 &&
    n.added + n.removed > 0 &&
    line(k, [r.files.length > 0 && T(k, '·', { dim: true }), n.added > 0 && T(k, `+${n.added}`, { color: C.green, dim: true }), n.removed > 0 && T(k, `−${n.removed}`, { color: C.red, dim: true })])
  const prBit =
    room >= 72 &&
    pr &&
    line(k, [
      T(k, `⇄${NB}#${pr.number}`, { color: C.violet, bold: true }),
      T(k, prLabel(pr), { color: prColor(pr) }),
      ...(watch ? [ciText(watch, true)] : checksText(pr.checks)).map(([text, c]) => T(k, text, { color: c })),
    ])
  // Sans PR, la CI suivie après un push, à la place de la PR.
  const ciBit = room >= 72 && !pr && watch && T(k, ciText(watch, true)[0], { color: ciText(watch, true)[1] })
  // Un fetch en échec n'est pas secondaire : il garde son palier.
  const fetchBit = fetched && (fetched.isError ? fetchError && T(k, fetchError, { color: C.red }) : room >= 90 && T(k, fetched.text, { dim: true }))

  const run = view.running
  const second =
    width < 56
      ? null
      : r.operation
        ? T(k, `${OPERATION[r.operation] ?? r.operation} en cours${n.conflicts ? `${SEP}${plural(n.conflicts, 'conflit')}` : ''}`, { color: C.red, bold: true, wrap: 'truncate-end' })
        : run
          ? line(k, [
              // Rien ne tourne tant que la commande attend son tour : « ▶ », pas de spinner.
              run.isStarted ? spinner(k, C.tangerine, view.now, 'commande en cours') : T(k, '▶', { color: C.tangerine }),
              T(k, run.isStarted ? `${run.command} en cours` : `${run.command} en file`, { color: C.tangerine, wrap: 'truncate-end' }),
            ])
          : view.busy
            ? line(k, [spinner(k, C.tangerine, view.now, 'git au travail'), T(k, view.busy, { color: C.tangerine, wrap: 'truncate-end' })])
            : null

  return (
    <Box key="git-band" flexDirection="column" width={width}>
      <Box flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexShrink={1}>
          {line(k, [
            bandTag(k, 'Git', TAG_COLOR),
            T(k, '⎇', { color: r.operation || n.conflicts ? C.red : BRAND, bold: true }),
            <Box flexShrink={1}>{T(k, branchLabel(r), { bold: true, wrap: 'truncate-end' })}</Box>,
            width >= 90 && isElsewhere && T(k, r.name, { dim: true }),
            remote,
            r.files.length > 0 && files,
            diff,
            prBit,
            ciBit,
            fetchBit,
          ])}
        </Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={1}>
          {lead && (
            <Box marginRight={1}>
              <Button key="git-band-next" variant="primary" label={nextLabel} onPress={() => act.launch(lead)} />
            </Box>
          )}
          <Box marginRight={1}>
            <Button key="git-band-open" plain={true} dimColor={true} label={`▸${NB}Ouvrir`} onPress={() => act.openPane()} />
          </Box>
          {/* Pas de role="dismiss" : plusieurs bandeaux empilés auraient chacun leur fermeture native au même endroit. */}
          <Button key="git-band-hide" plain={true} dimColor={true} label="x" onPress={() => act.hideBand()} />
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
