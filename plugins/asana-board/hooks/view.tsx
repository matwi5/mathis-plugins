// Dessin du panneau Asana et de son bandeau au-dessus du prompt. Un seul arbre pour toutes
// les surfaces, sur le modèle de flow-board : le desktop, VS Code et le mobile reçoivent
// des SVG, le terminal des glyphes et des barres en blocs.
//
// Pièges du desktop (relevés dans git-board et flow-board) : les espaces ordinaires y sont
// fondus et `gap` ignoré ; les écarts dans un texte sont donc insécables, ceux entre
// éléments des marges. Aucune prop n'est passée à `undefined` : les arbres restent valides
// partout. Aucun `$` ici : les actions arrivent en fermetures depuis register.tsx.

import type { AsanaTask, Draft, Notice, PanelMeta } from '../types'
import {
  BRAND,
  C,
  COUNT_ORDER,
  GROUPS,
  isMe,
  byDueThenName,
  countsOf,
  dueOf,
  groupBy,
  groupOf,
  isShown,
  labelOf,
  matchesWho,
  notesMarkdown,
  shortName,
  statutChoices,
  STATUTS,
  whoOf,
  type Counts,
  type Group,
} from './model.ts'
import { barSvg, donutSvg, pulseSvg, spinnerSvg, type BarPart } from './svg.ts'

const NB = '\u00a0'
const SEP = `${NB}${NB}·${NB}${NB}`
/** Tâches montrées par groupe avant « ▸ tout voir (N) ». */
const CAP = 12

export type Kit = {
  Box: any
  Text: any
  Button: any
  Svg: any
  /** Lien externe ; absent d'une table qui n'en a pas. */
  Link: any
  Markdown: any
  /** Champ et liste de choix : absents sur le mobile. */
  Input: any
  Select: any
  /** La surface dessine les SVG (desktop, VS Code, mobile). */
  isRich: boolean
  /** Colonnes du corps. */
  width: number
}

/**
 * Ce que la surface sait dessiner, dit par register.tsx d'après la table du moteur : une
 * table complète toujours chaque nom (un élément absent y dessine un fragment vide), donc
 * `typeof table.Svg` ne suffit pas à dire si la surface dessine les SVG.
 */
export type Abilities = { isRich: boolean; hasFields: boolean }

export const kitOf = (table: Record<string, unknown>, width: number, can: Abilities): Kit => ({
  Box: table.Box,
  Text: table.Text,
  Button: table.Button,
  Svg: can.isRich ? (table.Svg ?? null) : null,
  Link: table.Link ?? null,
  Markdown: table.Markdown ?? null,
  Input: can.hasFields ? (table.Input ?? null) : null,
  Select: can.hasFields ? (table.Select ?? null) : null,
  isRich: can.isRich && typeof table.Svg === 'function',
  width: Math.max(24, Math.floor(width)),
})

/** Ce que le panneau dessine : tout l'état du mod, lu avant le rendu. */
export type View = {
  tasks: AsanaTask[]
  meta: PanelMeta
  who: string
  expanded: string[]
  collapsed: string[]
  showDone: boolean
  showAll: string[]
  notice: Notice
  editing: string | null
  confirmDelete: string | null
  creating: boolean
  draft: Draft
  busy: string[]
  now: number
}

/** Ce que le bandeau dessine : peu de lectures, la chaîne des bandeaux est partagée. */
export type BandView = {
  /** Colonnes du bandeau, telles que le moteur les donne (le kit, lui, plancher à 24). */
  columns: number
  tasks: AsanaTask[]
  meta: PanelMeta
  isBandHidden: boolean
  now: number
}

export type Actions = {
  setWho: (who: string) => unknown
  flipTask: (gid: string) => unknown
  flipGroup: (key: string) => unknown
  flipDone: () => unknown
  flipAll: (key: string) => unknown
  toggleCreating: () => unknown
  setDraft: (patch: Partial<Draft>) => unknown
  cancelCreate: () => unknown
  create: () => unknown
  refresh: () => unknown
  setDone: (t: AsanaTask, completed: boolean) => unknown
  setStatut: (t: AsanaTask, value: string) => unknown
  assign: (t: AsanaTask, assignee: string | null) => unknown
  work: (t: AsanaTask) => unknown
  comment: (t: AsanaTask, text: string) => unknown
  startEdit: (gid: string) => unknown
  endEdit: () => unknown
  rename: (t: AsanaTask, name: string) => unknown
  setDue: (t: AsanaTask, text: string) => unknown
  editLine: (t: AsanaTask, before: string, after: string | null) => unknown
  addLine: (t: AsanaTask, text: string) => unknown
  abandon: (t: AsanaTask) => unknown
  askDelete: (gid: string) => unknown
  cancelDelete: () => unknown
  remove: (t: AsanaTask) => unknown
  hideBand: () => unknown
  openPane: () => unknown
  /** Copie l'adresse d'une tâche dans le presse-papiers de la surface pressée. */
  copyLink: (url: string, surface?: string) => unknown
}

// ─── Petits outils (copiés de flow-board, hooks/view.tsx:104-183) ─────────

export const dur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}${NB}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}${NB}min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}${NB}h${NB}${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}${NB}j`
}

/** « à l'instant », « il y a 4 min ». */
export const ago = (ms: number): string => (ms < 10_000 ? `à${NB}l'instant` : `il${NB}y${NB}a${NB}${dur(ms)}`)

const plural = (n: number, one: string, many = `${one}s`): string => `${n}${NB}${n > 1 ? many : one}`
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const spinFrame = (now: number): string => SPIN[Math.floor(now / 1000) % SPIN.length] ?? '⠋'

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

const isPresent = (item: unknown): boolean => item !== null && item !== undefined && item !== false && item !== ''

/** Une rangée d'éléments séparés par une marge (le desktop ignore `gap`). */
const line = (k: Kit, items: unknown[], wrap = false): unknown => {
  const { Box } = k
  const list = items.filter(isPresent)
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

/** Un indicateur « en cours » : arc qui tourne (SVG) ou spinner braille. */
const spinner = (k: Kit, now: number, color: string, alt: string): unknown =>
  k.isRich ? svgOf(k, spinnerSvg(color, 12), alt) : T(k, spinFrame(now), { color })

// ─── Données dérivées ─────────────────────────────────────────────────────

const barParts = (counts: Counts): BarPart[] => COUNT_ORDER.map(g => ({ value: counts.byGroup[g.key], color: g.color }))

const countsAlt = (counts: Counts): string => {
  const parts = COUNT_ORDER.filter(g => counts.byGroup[g.key] > 0).map(g => `${counts.byGroup[g.key]} ${g.short}`)
  return parts.length > 0 ? `${counts.open} tâches ouvertes : ${parts.join(', ')}` : 'Aucune tâche ouverte'
}

const whoColor = (t: AsanaTask): string => (!t.assignee ? C.tangerine : isMe(t.assignee) ? C.amber : C.slate)

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`)

// ─── Panneau ──────────────────────────────────────────────────────────────

/** Au-delà, la lecture n'est plus dite « à jour » : le panneau ne se relit pas seul (sauf après une écriture de Claude). */
const FRESH_MS = 10 * 60_000

const isFresh = (view: View): boolean => view.meta.loadedAt !== null && view.now - view.meta.loadedAt < FRESH_MS

/**
 * La pastille d'état de l'en-tête : lecture, erreur, à jour, lue. Statique pendant une
 * lecture : le spinner et la progression sont dans la zone d'état, juste dessous.
 */
const livePill = (k: Kit, view: View): unknown => {
  const m = view.meta
  if (m.loading) return T(k, `◌${NB}Lecture…`, { color: C.tangerine, bold: true })
  if (m.error) return T(k, `⚠${NB}Erreur`, { color: C.red, bold: true })
  if (m.loadedAt === null) return T(k, `○${NB}Pas encore lue`, { color: C.gray, bold: true })
  if (!isFresh(view)) return T(k, `●${NB}Lue`, { color: C.gray, bold: true })
  const dot = k.isRich ? svgOf(k, pulseSvg(C.green, false), 'À jour') : T(k, '●', { color: C.green })
  return line(k, [dot, T(k, 'À jour', { color: C.green, bold: true })])
}

const hero = (k: Kit, view: View, act: Actions, counts: Counts): unknown => {
  const { Box, Button } = k
  const m = view.meta
  const inner = k.width - 6
  const parts = barParts(counts)
  const visual = k.isRich ? svgOf(k, donutSvg(parts, counts.open), countsAlt(counts)) : T(k, String(counts.open), { color: BRAND, bold: true })
  const scope = view.who === 'toi' ? `filtre${NB}:${NB}pour${NB}toi` : view.who === 'claude' ? `filtre${NB}:${NB}pour${NB}Claude` : ''
  const meta = [
    plural(counts.open, `tâche${NB}ouverte`, `tâches${NB}ouvertes`),
    scope,
    view.who === 'tous' ? `pour${NB}toi${NB}:${NB}${counts.mine}` : '',
    m.loadedAt !== null ? `${isFresh(view) ? `à${NB}jour` : 'lue'}${NB}${ago(view.now - m.loadedAt)}` : '',
  ]
    .filter(Boolean)
    .join(SEP)
  // Les comptes suivent le filtre : la méta le dit (« filtre : pour toi »), une seule fois.
  const legend = [
    ...COUNT_ORDER.filter(g => counts.byGroup[g.key] > 0).map(g =>
      T(k, `${g.glyph}${NB}${counts.byGroup[g.key]}${NB}${g.short}`, { color: g.color, bold: !g.isQuiet, dim: g.isQuiet }),
    ),
    counts.done > 0 && T(k, `✓${NB}${counts.done}${NB}${counts.done > 1 ? 'cochées' : 'cochée'}`, { color: C.green, dim: true }),
  ]
  const canWrite = k.Input !== null && k.Select !== null
  return (
    <Box key="hero" flexDirection="column" borderStyle="round" borderColor={BRAND} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexShrink={1}>{chip(k, `◆${NB}ASANA`, BRAND)}</Box>
        <Box marginLeft={1} flexShrink={0}>
          {livePill(k, view)}
        </Box>
      </Box>
      <Box flexDirection="row" alignItems="center" marginTop={1}>
        <Box marginRight={2} flexShrink={0}>
          {visual}
        </Box>
        <Box flexDirection="column" flexShrink={1}>
          {T(k, view.meta.section ?? 'Asana', { bold: true, wrap: 'truncate-end' })}
          {line(k, [T(k, meta, { dim: true, wrap: 'truncate-end' }), counts.overdue > 0 && T(k, `⚠${NB}${counts.overdue}${NB}en${NB}retard`, { color: C.red, bold: true })])}
          {!k.isRich && blocks(k, parts, counts.open, Math.min(32, inner - 8))}
        </Box>
      </Box>
      {legend.some(isPresent) && <Box marginTop={1}>{line(k, legend, true)}</Box>}
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1}>
        {canWrite && (
          <Box marginRight={2}>
            {/* Formulaire ouvert : une bascule qui dit ce qu'elle fait (le brouillon reste ; « Annuler » le vide). */}
            {view.creating ? (
              <Button key="new" plain={true} dimColor={true} label="▾ Replier le formulaire" onPress={() => act.toggleCreating()} />
            ) : (
              <Button key="new" label="+ Nouvelle tâche" onPress={() => act.toggleCreating()} />
            )}
          </Box>
        )}
        {/* Pendant une lecture, ↻ attendrait la lecture en cours : il le dit, atténué. */}
        {m.loading ? (
          <Button key="refresh" plain={true} dimColor={true} label="Lecture…" onPress={() => act.refresh()} />
        ) : (
          <Button key="refresh" label="↻ Relire" onPress={() => act.refresh()} />
        )}
      </Box>
    </Box>
  )
}

/** Avant toute lecture : ce que fait le panneau, et de quoi partir. */
const welcome = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const m = view.meta
  return (
    <Box key="welcome" flexDirection="column" borderStyle="round" borderColor={BRAND} paddingX={2} paddingY={1}>
      {T(k, `◆${NB}Tâches Asana du projet`, { color: BRAND, bold: true })}
      {T(k, 'Le panneau lit la section Asana nommée dans le CLAUDE.md du dossier (ou docs/agents/issue-tracker.md), puis ses tâches ouvertes et leurs sous-tâches.', { dim: true, wrap: 'wrap' })}
      {m.folder !== null && T(k, `Dossier${NB}:${NB}${m.folder}`, { dim: true, wrap: 'truncate-end' })}
      {m.section !== null && T(k, `Section${NB}:${NB}${m.section}`, { dim: true, wrap: 'truncate-end' })}
      {!m.error && !m.loading && (
        <Box marginTop={1}>
          <Button key="refresh" variant="primary" label="↻ Lire la section" onPress={() => act.refresh()} />
        </Box>
      )}
    </Box>
  )
}

const tabsRow = (k: Kit, view: View, open: readonly AsanaTask[], act: Actions): unknown => {
  const { Box, Button } = k
  const count = (who: string) => open.filter(t => matchesWho(t, who)).length
  const tabs: [string, string][] = [
    ['tous', `Tous${NB}·${NB}${count('tous')}`],
    ['toi', `Pour toi${NB}·${NB}${count('toi')}`],
    ['claude', `Pour Claude${NB}·${NB}${count('claude')}`],
  ]
  return (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" marginTop={1}>
      {tabs.map(([tab, label]) => (
        <Box marginRight={2}>
          <Button key={`tab-${tab}`} plain={true} dimColor={tab !== view.who} label={tab === view.who ? `▸ ${label}` : label} onPress={() => act.setWho(tab)} />
        </Box>
      ))}
    </Box>
  )
}

/** Sous l'en-tête, à la même place : lecture en cours, erreur avec reprise, avertissement. */
const statusZone = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button } = k
  const m = view.meta
  if (m.loading) {
    return (
      <Box key="loading" marginTop={1}>
        {line(k, [spinner(k, view.now, C.tangerine, m.loading), T(k, m.loading, { color: C.tangerine, wrap: 'truncate-end' })])}
      </Box>
    )
  }
  if (m.error) {
    const isNoSection = /^Pas de section/.test(m.error)
    const isNoServer = /^Connecteur/.test(m.error)
    return (
      <Box key="error" flexDirection="column" borderStyle="round" borderColor={C.red} paddingX={1} marginTop={1}>
        {T(k, `⚠${NB}Lecture impossible`, { color: C.red, bold: true })}
        {T(k, m.error, { wrap: 'wrap' })}
        {isNoSection && T(k, 'Attendu dans le CLAUDE.md ou docs/agents/issue-tracker.md : section « Nom » (GID `123…`), ou une ligne de tableau | Section | « Nom », GID `123…` | ; le projet de la même façon pour créer des tâches.', { dim: true, wrap: 'wrap' })}
        {isNoServer && T(k, 'Le connecteur Asana doit être actif dans la session (outils get_tasks et update_tasks).', { dim: true, wrap: 'wrap' })}
        {view.tasks.length > 0 && m.loadedAt !== null && T(k, `La liste ci-dessous date de la dernière lecture réussie, ${ago(view.now - m.loadedAt)}.`, { dim: true, wrap: 'wrap' })}
        <Box marginTop={1}>
          <Button key="retry" variant="primary" label="↻ Réessayer" onPress={() => act.refresh()} />
        </Box>
      </Box>
    )
  }
  if (m.warning) {
    return (
      <Box key="warning" marginTop={1}>
        {T(k, `⚠${NB}${m.warning}`, { color: C.amber, wrap: 'wrap' })}
      </Box>
    )
  }
  return null
}

/** Le retour d'erreur gardé sous une tâche ou sous le formulaire (le reste passe par les toasts). */
const noticeFor = (k: Kit, view: View, gid: string): unknown => {
  const { Box } = k
  const n = view.notice
  if (!n || n.gid !== gid) return null
  return <Box marginTop={1}>{T(k, n.text, { color: n.isError ? C.red : C.green, wrap: 'wrap' })}</Box>
}

const form = (k: Kit, view: View, act: Actions): unknown => {
  const { Box, Button, Input, Select } = k
  const d = view.draft
  const isBusy = view.busy.includes('new')
  const parents = view.tasks.filter(t => !t.completed && t.parent === null && (t.childCount > 0 || /prochaines sessions/i.test(t.name)))
  const field = (key: string, label: string, placeholder: string, value: string, patch: (v: string) => Partial<Draft>, isFirst = false) => {
    const props: Record<string, unknown> = { key, label, placeholder, value, onInput: (v: string) => act.setDraft(patch(v)), onSubmit: (v: string) => act.setDraft(patch(v)) }
    if (isFirst) props.autoFocus = true
    return <Box marginTop={1}>{h(Input, props)}</Box>
  }
  return (
    <Box key="form" flexDirection="column" borderStyle="round" borderColor={BRAND} paddingX={1} marginTop={1}>
      {T(k, '+ Nouvelle tâche', { color: BRAND, bold: true })}
      {field('f-name', 'Titre', 'Verbe + objet concret', d.name, v => ({ name: v }), true)}
      {T(k, 'Préfixe [code] ajouté, sauf si le titre commence par « [ ».', { dim: true, wrap: 'wrap' })}
      <Box marginTop={1}>
        {line(
          k,
          [
            <Select key="f-statut" label="Statut" options={STATUTS.map(s => ({ value: s, label: s }))} value={d.statut} onSelect={(v: string) => act.setDraft({ statut: v })} />,
            <Select
              key="f-who"
              label="Pour"
              options={[
                { value: 'claude', label: 'Claude (non assignée)' },
                { value: 'toi', label: 'Toi' },
              ]}
              value={d.who}
              onSelect={(v: string) => act.setDraft({ who: v })}
            />,
            <Select
              key="f-where"
              label="Emplacement"
              options={[{ value: 'section', label: 'Dans la section' }, ...parents.map(p => ({ value: p.gid, label: `Sous « ${cut(shortName(p.name), 40)} »` }))]}
              value={d.where}
              onSelect={(v: string) => act.setDraft({ where: v })}
            />,
          ],
          true,
        )}
      </Box>
      {field('f-ctx', 'Contexte', '1 à 3 lignes', d.contexte, v => ({ contexte: v }))}
      {field('f-fini', 'Fini quand', 'critère observable', d.fini, v => ({ fini: v }))}
      {field('f-due', 'Échéance', 'JJ/MM/AAAA, facultatif', d.due, v => ({ due: v }))}
      {noticeFor(k, view, 'new')}
      <Box flexDirection="row" alignItems="center" marginTop={1}>
        <Box marginRight={2}>
          <Button key="f-create" variant="primary" label={isBusy ? 'Création…' : '▶ Créer la tâche'} onPress={() => act.create()} />
        </Box>
        <Button key="f-cancel" label="Annuler" onPress={() => act.cancelCreate()} />
      </Box>
    </Box>
  )
}

const editForm = (k: Kit, t: AsanaTask, act: Actions): unknown => {
  const { Box, Button, Input } = k
  const lines = t.notes.split('\n').filter(l => l.trim() && !/^\s*Statut\s*:/i.test(l))
  return (
    <Box key={`e-${t.gid}`} flexDirection="column">
      {T(k, 'Entrée enregistre chaque champ ; un champ vidé retire sa ligne.', { dim: true, wrap: 'wrap' })}
      <Box marginTop={1}>
        <Input key={`e-name-${t.gid}`} label="Titre" value={t.name} submitLabel="Enregistrer" onSubmit={(v: string) => act.rename(t, v)} />
      </Box>
      <Box marginTop={1}>
        <Input
          key={`e-due-${t.gid}`}
          label="Échéance"
          placeholder="JJ/MM/AAAA, vide pour aucune"
          value={t.due ? `${t.due.slice(8, 10)}/${t.due.slice(5, 7)}/${t.due.slice(0, 4)}` : ''}
          submitLabel="Enregistrer"
          onSubmit={(v: string) => act.setDue(t, v)}
        />
      </Box>
      {lines.map((l, i) => {
        const label = labelOf(l)
        return (
          <Box key={`e-l-${t.gid}-${i}`} marginTop={1}>
            <Input
              key={`e-line-${t.gid}-${i}`}
              label={label ?? 'Ligne'}
              value={label ? l.slice(l.indexOf(':') + 1).trim() : l}
              submitLabel="Enregistrer"
              onSubmit={(v: string) => act.editLine(t, l, v.trim() ? (label ? `${label} : ${v.trim()}` : v.trim()) : null)}
            />
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Input key={`e-add-${t.gid}`} label="Ajouter" placeholder="Étiquette : texte" submitLabel="Ajouter" onSubmit={(v: string) => act.addLine(t, v)} />
      </Box>
      <Box marginTop={1}>
        <Button key={`e-end-${t.gid}`} label="Terminer la modification" onPress={() => act.endEdit()} />
      </Box>
    </Box>
  )
}

/** Le détail d'une tâche dépliée : une carte bordée de la couleur de son groupe. */
const taskCard = (k: Kit, view: View, t: AsanaTask, g: Group, act: Actions): unknown => {
  const { Box, Button, Link, Markdown, Select, Input } = k
  const isBusy = view.busy.includes(t.gid)
  // Au terminal, qui écrit l'adresse entière derrière le libellé quand il ne sait pas faire de lien, un bouton qui la copie.
  const url = t.url
  const urlCell = !url
    ? null
    : !k.isRich
      ? <Button key={`copy-${t.gid}`} plain={true} dimColor={true} label={`⧉${NB}Asana`} onPress={(press?: { surface?: string }) => act.copyLink(url, press?.surface)} />
      : Link && <Link key={`link-${t.gid}`} href={url} label="Asana ↗" />
  const isEditing = view.editing === t.gid && Input !== null
  const due = dueOf(t, view.now)
  const statut = statutChoices(t)
  const meta = [
    T(k, t.statut ? `Statut${NB}:${NB}${t.statut}` : `Sans${NB}statut`, { color: t.completed ? C.green : g.color, bold: true, wrap: 'truncate-end' }),
    T(k, `pour${NB}${whoOf(t)}`, { color: whoColor(t) }),
    t.childCount > 0 && T(k, plural(t.childCount, 'sous-tâche'), { dim: true }),
    due && T(k, `échéance${NB}${due.text}`, { color: due.color }),
  ]
  const notes = Markdown ? <Markdown key={`n-${t.gid}`} text={notesMarkdown(t.notes)} /> : T(k, t.notes || 'Pas de description.', { wrap: 'wrap' })
  // Un seul bouton principal : se mettre à la tâche. Le reste en secondaire, la suppression atténuée.
  const actions = [
    <Button key={`w-${t.gid}`} variant="primary" label="▶ Travailler dessus" onPress={() => act.work(t)} />,
    Select && <Select key={`s-${t.gid}`} label="Statut" options={statut.options} value={statut.value} onSelect={(v: string) => act.setStatut(t, v)} />,
    <Button key={`a-${t.gid}`} label={isMe(t.assignee) ? 'Confier à Claude' : "M'assigner"} onPress={() => act.assign(t, isMe(t.assignee) ? null : 'me')} />,
    Input !== null && !isEditing && <Button key={`m-${t.gid}`} label="Modifier" onPress={() => act.startEdit(t.gid)} />,
    !t.completed && <Button key={`ab-${t.gid}`} label="Abandonner" onPress={() => act.abandon(t)} />,
    <Button key={`del-${t.gid}`} plain={true} dimColor={true} label="Supprimer…" onPress={() => act.askDelete(t.gid)} />,
    urlCell,
  ]
  return (
    <Box key={`d-${t.gid}`} flexDirection="column" borderStyle="round" borderColor={t.completed ? C.green : g.color} paddingX={1} marginLeft={4}>
      {t.parentName && T(k, `↳${NB}Dans « ${shortName(t.parentName)} »`, { dim: true, wrap: 'truncate-end' })}
      {line(k, meta, true)}
      <Box marginTop={1} flexDirection="column">
        {isEditing ? editForm(k, t, act) : notes}
      </Box>
      {isBusy && <Box marginTop={1}>{line(k, [spinner(k, view.now, C.tangerine, 'Enregistrement'), T(k, 'Enregistrement dans Asana…', { color: C.tangerine })])}</Box>}
      {noticeFor(k, view, t.gid)}
      <Box marginTop={1}>{line(k, actions, true)}</Box>
      {view.confirmDelete === t.gid && (
        <Box flexDirection="column" borderStyle="round" borderColor={C.red} paddingX={1} marginTop={1}>
          {T(k, `Supprimer « ${shortName(t.name)} »${t.childCount ? ` et ses ${t.childCount} sous-tâches` : ''} ? Difficile à annuler : « Abandonner » garde une trace.`, { color: C.red, wrap: 'wrap' })}
          <Box flexDirection="row" marginTop={1}>
            <Box marginRight={2}>
              <Button key={`dy-${t.gid}`} label="Oui, supprimer" onPress={() => act.remove(t)} />
            </Box>
            <Button key={`dn-${t.gid}`} label="Annuler" onPress={() => act.cancelDelete()} />
          </Box>
        </Box>
      )}
      {Input !== null && (
        <Box marginTop={1}>
          <Input key={`k-${t.gid}`} label="Commentaire" placeholder="Ajouter un commentaire…" submitLabel="Commenter" onSubmit={(v: string) => act.comment(t, v)} />
        </Box>
      )}
    </Box>
  )
}

/** Une tâche en ligne compacte : case, titre tronqué, personne et échéance à droite, flèche. */
const taskRow = (k: Kit, view: View, t: AsanaTask, g: Group, act: Actions): unknown => {
  const { Box, Button } = k
  const isOpen = view.expanded.includes(t.gid)
  const isBusy = view.busy.includes(t.gid)
  const due = dueOf(t, view.now)
  const check = isBusy ? (
    spinner(k, view.now, C.tangerine, 'Enregistrement')
  ) : (
    <Button key={`c-${t.gid}`} plain={true} dimColor={!t.completed} label={t.completed ? '✓' : '○'} onPress={() => act.setDone(t, !t.completed)} />
  )
  const meta = [
    k.width >= 72 && t.childCount > 0 && T(k, plural(t.childCount, 'sous-tâche'), { dim: true }),
    // Sous « Pour toi » ou « Pour Claude », la personne est la même partout : inutile de la répéter.
    k.width >= 56 && view.who === 'tous' && T(k, whoOf(t), { color: whoColor(t) }),
    due && T(k, due.text, { color: due.color }),
  ]
  return (
    <Box key={`t-${t.gid}`} flexDirection="column">
      <Box flexDirection="row" alignItems="center">
        <Box marginRight={1} flexShrink={0} width={3}>
          {check}
        </Box>
        <Box flexShrink={1} flexGrow={1}>
          {T(k, shortName(t.name), { wrap: 'truncate-end', bold: isOpen, dim: t.completed, strike: t.completed })}
        </Box>
        {meta.some(isPresent) && (
          <Box marginLeft={1} flexShrink={0}>
            {line(k, meta)}
          </Box>
        )}
        <Box marginLeft={1} flexShrink={0}>
          <Button key={`x-${t.gid}`} plain={true} dimColor={true} label={isOpen ? '▾' : '▸'} onPress={() => act.flipTask(t.gid)} />
        </Box>
      </Box>
      {isOpen && taskCard(k, view, t, g, act)}
    </Box>
  )
}

/** Un groupe : titre glyphe + mot coloré, compte, puis ses tâches plafonnées. */
const groupBlock = (
  k: Kit,
  view: View,
  key: string,
  head: { glyph: string; title: string; color: string },
  items: AsanaTask[],
  isOpen: boolean,
  onFlip: () => unknown,
  act: Actions,
  note = '',
): unknown => {
  const { Box, Button } = k
  const isAll = view.showAll.includes(key)
  const shown = isAll ? items : items.slice(0, CAP)
  const g = groupBy(key)
  return (
    <Box key={`g-${key}`} flexDirection="column" marginTop={1}>
      {line(k, [
        <Button key={`fold-${key}`} plain={true} dimColor={true} label={isOpen ? '▾' : '▸'} onPress={() => onFlip()} />,
        T(k, `${head.glyph}${NB}${head.title}`, { color: head.color, bold: true }),
        T(k, String(items.length), { dim: true }),
      ])}
      {isOpen && note !== '' && <Box paddingLeft={2}>{T(k, note, { dim: true, wrap: 'truncate-end' })}</Box>}
      {isOpen && shown.map(t => taskRow(k, view, t, key === 'done' ? g : groupBy(groupOf(t)), act))}
      {isOpen && items.length > CAP && (
        <Box paddingLeft={2}>
          <Button key={`more-${key}`} plain={true} dimColor={true} label={isAll ? '▾ réduire' : `▸ tout voir (${items.length})`} onPress={() => act.flipAll(key)} />
        </Box>
      )}
    </Box>
  )
}

/** Rien à lister : on dit pourquoi, selon le filtre. */
const emptyCard = (k: Kit, view: View): unknown => {
  const { Box } = k
  const [title, hint] =
    view.who === 'toi'
      ? ['Aucune tâche pour toi.', 'L’onglet « Tous » montre celles des autres et de Claude.']
      : view.who === 'claude'
        ? ['Aucune tâche pour Claude.', 'Une tâche non assignée est une tâche pour Claude.']
        : [`✓${NB}Aucune tâche ouverte dans cette section.`, 'Les tâches terminées ne sont pas chargées. « + Nouvelle tâche » pour en créer une.']
  return (
    <Box key="empty" flexDirection="column" borderStyle="round" borderDimColor={true} paddingX={1} marginTop={1}>
      {T(k, title, { color: view.who === 'tous' ? C.green : C.gray, bold: true })}
      {T(k, hint, { dim: true, wrap: 'wrap' })}
    </Box>
  )
}

export const drawPane = (k: Kit, view: View, act: Actions): unknown => {
  const { Box } = k
  const m = view.meta
  const visible = view.tasks.filter(t => isShown(t))
  const list = visible.filter(t => matchesWho(t, view.who))
  // Les comptes de l'en-tête suivent le filtre (la légende le dit) ; les onglets, non.
  const counts = countsOf(list, view.now)
  const open = visible.filter(t => !t.completed)
  const groups = GROUPS.map(g => ({ g, items: list.filter(t => !t.completed && groupOf(t) === g.key).sort(byDueThenName) })).filter(x => x.items.length > 0)
  const done = list.filter(t => t.completed).sort(byDueThenName)
  // Avant la première lecture réussie, aucun compte : l'accueil, pas un « 0 tâche ouverte » faux.
  const hasData = m.loadedAt !== null
  const isMobile = k.Input === null || k.Select === null
  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      {hasData ? hero(k, view, act, counts) : welcome(k, view, act)}
      {hasData && tabsRow(k, view, open, act)}
      {statusZone(k, view, act)}
      {isMobile &&
        hasData && (
          <Box key="mobile" marginTop={1}>
            {T(k, 'Mobile : pas de saisie (création, statut, commentaire).', { dim: true, wrap: 'wrap' })}
          </Box>
        )}
      {view.creating && !isMobile && form(k, view, act)}
      {groups.map(({ g, items }) => groupBlock(k, view, g.key, g, items, !view.collapsed.includes(g.key), () => act.flipGroup(g.key), act))}
      {/* Seulement les tâches cochées depuis la dernière lecture : on peut encore les décocher. */}
      {done.length > 0 &&
        groupBlock(k, view, 'done', { glyph: '✓', title: 'Terminées', color: C.green }, done, view.showDone, () => act.flipDone(), act, 'Cochées depuis la dernière lecture : décoche pour annuler.')}
      {m.loadedAt !== null && !m.loading && groups.length === 0 && done.length === 0 && emptyCard(k, view)}
    </Box>
  )
}

// ─── Bandeau ──────────────────────────────────────────────────────────────

/** Glyphes comptés pour deux cellules, par prudence : certains terminaux les dessinent larges. */
const WIDE = new Set([...'⚖◉⏸○⚠◆✓'])
/** Le bouton du bandeau qui ouvre le panneau, sans la commande : l'étiquette « Asana » nomme déjà le plugin. */
const OPEN_LABEL = '▸ Ouvrir'
/** Largeur estimée d'un texte, en cellules. */
const cellsOf = (text: string): number => [...text].reduce((n, ch) => n + (WIDE.has(ch) ? 2 : 1), 0)
/** À droite de la ligne 1 : marge, « ▸ Ouvrir », marge, « x ». */
const BAND_RIGHT = 1 + cellsOf(OPEN_LABEL) + 1 + 1
/** Ce que le nom de section garde au moins quand il est montré ; au-delà il se tronque. */
const SECTION_MIN = 20
/** La mini-barre : 60 px en SVG, 8 blocs sur le terminal. */
const MINI_CELLS = 8

/** Ce que la ligne 1 montre : les paliers fixent le plus riche, le budget retire le reste. */
type BandPlan = { hasTag: boolean; isWords: boolean; hasSection: boolean; hasMini: boolean; hasMine: boolean; hasQuiet: boolean; isLongLate: boolean }

/** Ce qu'on retire, dans l'ordre, tant que la ligne 1 ne tient pas dans sa largeur. */
// Le nom de section part avant les comptes en toutes lettres : l'étiquette ASANA dit déjà
// de quoi il s'agit. L'étiquette elle-même ne part qu'en dernier, sur un bandeau très étroit.
const DEGRADE: ((p: BandPlan) => BandPlan)[] = [
  p => ({ ...p, hasSection: false }),
  p => ({ ...p, isWords: false }),
  p => ({ ...p, hasMine: false }),
  p => ({ ...p, hasMini: false }),
  p => ({ ...p, hasQuiet: false }),
  p => ({ ...p, isLongLate: false }),
  p => ({ ...p, hasTag: false }),
]

/** Les éléments de la ligne 1 selon un plan, et la largeur qu'ils prennent, marges comprises. */
const bandPieces = (k: Kit, view: BandView, counts: Counts, plan: BandPlan): { items: unknown[]; cells: number } => {
  const { Box } = k
  const pieces: { cells: number; node: unknown }[] = []
  const text = (value: string, style: Style) => pieces.push({ cells: cellsOf(value), node: T(k, value, { ...style, wrap: 'truncate-end' }) })
  pieces.push(plan.hasTag ? { cells: TAG_CELLS, node: bandTag(k, 'Asana', TAG_COLOR) } : { cells: 1, node: bandTag(k, null, TAG_COLOR) })
  const section = view.meta.section ?? 'Asana'
  if (plan.hasSection) pieces.push({ cells: Math.min(cellsOf(section), SECTION_MIN), node: <Box flexShrink={1}>{T(k, section, { bold: true, wrap: 'truncate-end' })}</Box> })
  if (plan.hasMini && counts.open > 0) {
    const parts = barParts(counts)
    pieces.push({ cells: MINI_CELLS, node: k.isRich ? svgOf(k, barSvg(parts, counts.open, 60, 7), countsAlt(counts)) : blocks(k, parts, counts.open, MINI_CELLS) })
  }
  for (const g of COUNT_ORDER) {
    const n = counts.byGroup[g.key]
    if (n === 0 || (g.isQuiet && !plan.hasQuiet)) continue
    // Seuls les groupes où il y a à faire sont en gras ; l'attente d'autres est atténuée.
    text(plan.isWords ? `${n}${NB}${g.short}` : `${g.glyph}${n}`, { color: g.color, bold: !g.isQuiet && g.key !== 'autre', dim: g.isQuiet })
  }
  if (counts.open === 0) text(`✓${NB}aucune${NB}tâche${NB}ouverte`, { color: C.green })
  if (counts.overdue > 0) text(plan.isLongLate ? `⚠${NB}${counts.overdue}${NB}en${NB}retard` : `⚠${counts.overdue}`, { color: C.red, bold: true })
  if (plan.hasMine && counts.mine > 0) text(`pour${NB}toi${NB}:${NB}${counts.mine}`, { color: C.amber })
  return { items: pieces.map(p => p.node), cells: pieces.reduce((n, p) => n + p.cells, 0) + pieces.length - 1 }
}




/** Largeur du nom dans la colonne d'étiquette, la même dans les bandeaux Git, Flow et Asana. */
const LABEL_CELLS = 5
/** La colonne d'étiquette : la barre, une espace, le nom calé sur LABEL_CELLS. */
export const TAG_CELLS = 2 + LABEL_CELLS
/** La couleur d'Asana dans les bandeaux (rose, comme son logo). */
const TAG_COLOR = C.pink

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
 * Une ligne, deux au plus. Ligne 1 : étiquette ▍ Asana, [section ≥ 90], [répartition ≥ 64], comptes par
 * groupe (à trancher, en cours, à faire, sans statut ; en attente atténué en dernier),
 * retards, [pour toi ≥ 72] ; à droite ▸ Ouvrir et x. Les paliers fixent le plus riche ; si
 * ça ne tient pas, la section s'en va, puis les comptes passent en glyphes (⚖1 ◉1 ○2), puis
 * « pour toi », la répartition, l'attente, la forme longue du retard et l'étiquette s'en vont.
 * Ligne 2 (≥ 56) : seulement la lecture en cours ou l'erreur d'une relecture demandée. Ni
 * échéance ni retard détaillés : les retards sont comptés en ligne 1 (« ⚠ N en retard »). Les comptes ne suivent pas le filtre du panneau.
 */
export const drawBand = (k: Kit, view: BandView, act: Actions): unknown => {
  const m = view.meta
  if (m.loadedAt === null || view.isBandHidden) return null
  const { Box, Button } = k
  const width = Math.max(1, Math.floor(view.columns))
  const counts = countsOf(view.tasks, view.now)
  let plan: BandPlan = { hasTag: true, isWords: true, hasSection: width >= 90, hasMini: width >= 64, hasMine: width >= 72, hasQuiet: true, isLongLate: true }
  let first = bandPieces(k, view, counts, plan)
  for (const step of DEGRADE) {
    if (first.cells + BAND_RIGHT <= width) break
    plan = step(plan)
    first = bandPieces(k, view, counts, plan)
  }
  const second =
    width < 56
      ? null
      : m.loading
        ? line(k, [spinner(k, view.now, C.tangerine, 'Lecture Asana'), T(k, m.loading, { color: C.tangerine, wrap: 'truncate-end' })])
        : m.error
          ? T(k, `⚠${NB}${m.error}`, { color: C.red, wrap: 'truncate-end' })
          : null
  return (
    <Box key="asana-band" flexDirection="column" width={width}>
      <Box flexDirection="row" alignItems="center" justifyContent="space-between">
        <Box flexShrink={1}>{line(k, first.items)}</Box>
        <Box flexDirection="row" flexShrink={0} marginLeft={1}>
          <Box marginRight={1}>
            <Button key="asana-band-open" plain={true} dimColor={true} label={OPEN_LABEL} onPress={() => act.openPane()} />
          </Box>
          {/* Pas de role="dismiss" : plusieurs bandeaux empilés auraient leur fermeture native au même endroit. */}
          <Button key="asana-band-hide" plain={true} dimColor={true} label="x" onPress={() => act.hideBand()} />
        </Box>
      </Box>
      {second !== null && (
        <Box flexDirection="row">
          {bandTag(k, plan.hasTag ? '' : null, TAG_COLOR)}
          <Box flexShrink={1} marginLeft={1}>
            {second}
          </Box>
        </Box>
      )}
    </Box>
  )
}

/**
 * La ligne d'un appel d'écriture de Claude dans la conversation : « Asana · coche « X » »,
 * à la place des GID et du JSON de l'appel. Atténuée tant que l'appel tourne.
 */
export const drawWrite = (k: Kit, text: string, isRunning: boolean): unknown =>
  line(k, [T(k, 'Asana', { color: BRAND, bold: true }), T(k, `·${NB}${text}${isRunning ? '…' : ''}`, { dim: isRunning, wrap: 'truncate-end' })])
