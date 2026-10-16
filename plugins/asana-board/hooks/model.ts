// Données du panneau Asana, sans `$` : lecture des tâches renvoyées par le connecteur,
// rangement par la ligne « Statut : », comptes du bandeau et de l'en-tête, échéances.
// Tout ce qui touche à Asana ou à l'état passe par register.tsx.

import type { AsanaTask } from '../types'

// Couleurs brutes (hex) mi-tons, copiées de flow-board (hooks/catalog.ts:9-31) : lisibles
// en thème clair comme sombre, sur le terminal comme sur le desktop.
export const C = {
  violet: '#9B7BEA',
  lilac: '#B79BF5',
  blue: '#4A9EE8',
  cyan: '#2EB8C9',
  teal: '#3FB68B',
  tangerine: '#E8913A',
  coral: '#EF7D57',
  amber: '#D9A520',
  green: '#4CB782',
  red: '#E5534B',
  pink: '#E06C9F',
  magenta: '#C36BD9',
  indigo: '#7C83F2',
  sky: '#56B4E9',
  sand: '#C9A66B',
  slate: '#7F8EA3',
  gray: '#8B8B93',
  /** Texte foncé posé sur un aplat de couleur. */
  ink: '#17171C',
} as const

/** La couleur du mod : celle d'Asana (le violet reste celle de flow-board, pour distinguer les bandeaux empilés). */
export const BRAND = C.coral

export const FIELDS = 'name,completed,assignee.name,notes,due_on,modified_at,num_subtasks,permalink_url'
// Les fichiers du projet où chercher la section, dans l'ordre : un projet peut garder ses GID
// hors du CLAUDE.md (PolePredict les tient dans docs/agents/issue-tracker.md).
export const ASANA_FILES = ['CLAUDE.md', 'docs/agents/issue-tracker.md'] as const
// Dans le texte : « section « Mon projet » (GID `1200000000000002`) », retours à la ligne compris.
export const SECTION = /section\s*«\s*([^»]+?)\s*»\s*\(GID\s*`(\d+)`\)/
export const PROJECT = /projet\s*«\s*[^»]+?\s*»\s*\(GID\s*`(\d+)`\)/
// En tableau : « | Section | « Mon projet », GID `1200000000000002` | ».
const SECTION_ROW = /\|\s*Section\s*\|\s*«\s*([^»]+?)\s*»\s*,\s*GID\s*`(\d+)`/i
const PROJECT_ROW = /\|\s*Projet\s*\|\s*«\s*[^»]+?\s*»\s*,\s*GID\s*`(\d+)`/i

export type AsanaTarget = { section: string; sectionGid: string; projectGid: string | null }

/**
 * La section Asana du projet, lue dans les textes des fichiers (`ASANA_FILES`, dans l'ordre) :
 * la première section trouvée, et le projet du même fichier, sinon du premier qui en nomme un.
 */
export function findAsana(texts: string[]): AsanaTarget | null {
  const sectionOf = (s: string) => s.match(SECTION) ?? s.match(SECTION_ROW)
  const projectOf = (s: string) => (s.match(PROJECT) ?? s.match(PROJECT_ROW))?.[1] ?? null
  const i = texts.findIndex(s => sectionOf(s) !== null)
  if (i < 0) return null
  const found = sectionOf(texts[i]!)!
  const projectGid = projectOf(texts[i]!) ?? texts.map(projectOf).find(g => g !== null) ?? null
  return { section: found[1]!, sectionGid: found[2]!, projectGid }
}

/**
 * Le fichier où Claude Code a rangé une réponse d'outil trop longue, ou null. `$.mcp.call`
 * rend le texte que voit le modèle : au-delà d'un seuil (une section de 22 tâches, 55 Ko, le
 * 14/10/2026), c'est un encart « <persisted-output> Output too large (…). Full output saved
 * to: <chemin> » suivi d'un aperçu, et non plus le JSON d'Asana. Second format, vu le
 * 16/10/2026 (74 Ko) : « Error: result (… characters) exceeds maximum allowed tokens. Output
 * has been saved to <chemin>. » suivi de conseils de lecture ; le point final n'est pas au chemin.
 */
export function persistedPath(text: string): string | null {
  const head = text.trimStart()
  if (head.startsWith('<persisted-output>')) return text.match(/Full output saved to:\s*(.+?)\s*$/m)?.[1] ?? null
  if (/^Error: result \([^)]*\) exceeds maximum allowed tokens/.test(head)) return head.match(/Output has been saved to\s+(.+?)\.?\s*$/m)?.[1] ?? null
  return null
}

// Le titulaire du compte Asana, lu une fois par get_me : ses tâches s'affichent « Toi ».
// Tant qu'il est inconnu, aucune tâche n'est la sienne.
let me: string | null = null
export function setMe(name: string | null): void {
  me = name
}
export const isMe = (assignee: string | null): boolean => assignee !== null && assignee === me

export function toTask(t: any, parent: AsanaTask | null): AsanaTask {
  const notes: string = t.notes ?? ''
  return {
    gid: t.gid,
    name: t.name ?? '',
    completed: Boolean(t.completed),
    assignee: t.assignee?.name ?? null,
    notes,
    statut: notes.match(/^\s*Statut\s*:\s*(.+)$/m)?.[1]?.trim() ?? null,
    due: t.due_on ?? null,
    modified: t.modified_at ?? null,
    url: t.permalink_url ?? null,
    parent: parent?.gid ?? null,
    parentName: parent?.name ?? null,
    childCount: t.num_subtasks ?? 0,
  }
}

// ─── Statut et saisie ─────────────────────────────────────────────────────

export const STATUTS = ['à faire', 'en cours', 'en attente', 'à trancher', 'à confirmer', 'à proposer']
// Le mot-clé de tête de la ligne « Statut : », seul remplacé : la parenthèse et la suite restent.
export const STATUT_LINE = /^(\s*Statut\s*:\s*)([àa] faire|en cours|en attente|[àa] trancher|[àa] confirmer|[àa] proposer|pr[êe]t|fait|abandonn[ée]e)?/im

export function statutKeyword(t: AsanaTask) {
  const kw = t.statut?.toLowerCase().replace(/^a /, 'à ')
  return STATUTS.find(s => kw?.startsWith(s))
}

export function withStatut(notes: string, value: string) {
  if (!/^\s*Statut\s*:/im.test(notes)) return `Statut : ${value}\n${notes}`
  return notes.replace(STATUT_LINE, (_all, head: string, kw?: string) => (kw ? `${head}${value}` : `${head}${value} · `))
}

// Cochée, décochée ou abandonnée : toute la ligne est remplacée, la parenthèse (qui ou quoi
// on attendait) ne vaut plus.
export function withWholeStatut(notes: string, value: string) {
  if (!/^\s*Statut\s*:/im.test(notes)) return notes ? `Statut : ${value}\n${notes}` : `Statut : ${value}`
  return notes.replace(/^(\s*Statut\s*:\s*).*$/im, (_all, head: string) => `${head}${value}`)
}

/**
 * Les choix du Select de statut et la valeur à montrer, jamais `undefined` : une tâche
 * « prêt » ou sans statut reçoit une option de plus, qui la décrit sans rien écrire.
 */
export function statutChoices(t: AsanaTask): { options: { value: string; label: string }[]; value: string } {
  const options = STATUTS.map(s => ({ value: s, label: s }))
  const kw = statutKeyword(t)
  if (kw) return { options, value: kw }
  const current = t.statut ? (/^pr[êe]t/i.test(t.statut) ? 'prêt' : t.statut.split(/[\s(·]/)[0] || 'autre') : 'sans statut'
  const value = `=${current}`
  return { options: [{ value, label: current }, ...options], value }
}

// « Contexte : … » → « Contexte » ; une ligne sans étiquette → null.
export function labelOf(line: string) {
  return line.match(/^\s*([A-ZÀ-Ý][^:]{0,40}?)\s*:\s/)?.[1] ?? null
}

// « 12/10/2026 » ou « 12/10 » (année en cours) → « 2026-10-12 » ; vide → null.
export function isoDate(text: string) {
  const v = text.trim()
  if (!v) return null
  const d = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/)
  if (!d) throw new Error('Échéance attendue au format JJ/MM/AAAA.')
  const year = d[3] ?? String(new Date().getFullYear())
  return `${year}-${d[2]!.padStart(2, '0')}-${d[1]!.padStart(2, '0')}`
}

// ─── Rangement ────────────────────────────────────────────────────────────

export type GroupKey = 'trancher' | 'cours' | 'attente' | 'faire' | 'autre'

export type Group = {
  key: GroupKey
  title: string
  short: string
  glyph: string
  color: string
  /** Rien à y faire soi-même : atténué dans le bandeau. */
  isQuiet: boolean
  match: RegExp
}

// Rôles de la palette : ambre pour ce qui attend une décision, mandarine pour ce qui avance,
// gris pour l'attente d'autres, bleu ciel pour ce qui est prêt à faire.
export const GROUPS: Group[] = [
  { key: 'trancher', title: 'À trancher', short: 'à trancher', glyph: '⚖', color: C.amber, isQuiet: false, match: /^([àa] trancher|[àa] confirmer|[àa] proposer)/i },
  { key: 'cours', title: 'En cours', short: 'en cours', glyph: '◉', color: C.tangerine, isQuiet: false, match: /^en cours/i },
  { key: 'attente', title: "En attente d'autres", short: 'en attente', glyph: '⏸', color: C.gray, isQuiet: true, match: /^en attente/i },
  { key: 'faire', title: 'À faire', short: 'à faire', glyph: '○', color: C.sky, isQuiet: false, match: /^([àa] faire|pr[êe]t)/i },
  { key: 'autre', title: 'Sans statut', short: 'sans statut', glyph: '·', color: C.slate, isQuiet: false, match: /.*/ },
]

export function groupOf(t: AsanaTask): GroupKey {
  return GROUPS.find(g => g.match.test(t.statut ?? ''))!.key
}

export function groupBy(key: string): Group {
  return GROUPS.find(g => g.key === key) ?? GROUPS[GROUPS.length - 1]!
}

/**
 * L'ordre des comptes (bandeau, légende de l'en-tête, ligne d'état) : ce qui demande d'agir,
 * puis les tâches sans statut, et l'attente d'autres, atténuée, en dernier. Les groupes du
 * panneau gardent l'ordre de GROUPS.
 */
export const COUNT_ORDER: Group[] = (['trancher', 'cours', 'faire', 'autre', 'attente'] as const).map(groupBy)

// Une tâche mère sans statut n'est qu'un dossier : ses sous-tâches sont listées à sa place.
export function isShown(t: AsanaTask) {
  return !(t.childCount > 0 && t.statut === null)
}

export function shortName(name: string) {
  // [code] (Claude Code), [chat] (claude.ai) : la source, inutile dans le panneau.
  return name.replace(/^\[(code|chat)\]\s*/, '')
}

export function whoOf(t: AsanaTask) {
  if (!t.assignee) return 'Claude'
  return isMe(t.assignee) ? 'Toi' : t.assignee.split(' ')[0]!
}

export function matchesWho(t: AsanaTask, person: string) {
  if (person === 'toi') return isMe(t.assignee)
  if (person === 'claude') return t.assignee === null
  return true
}

export type Due = { text: string; color: string; days: number }

// Échéance : rouge si dépassée ou sous 2 jours, ambre sous 7 jours, gris au-delà.
export function dueOf(t: AsanaTask, now: number): Due | null {
  if (!t.due || t.completed) return null
  const days = Math.ceil((Date.parse(`${t.due}T23:59:59`) - now) / 86_400_000)
  const text = `${t.due.slice(8, 10)}/${t.due.slice(5, 7)}${days < 0 ? '\u00a0dépassée' : days <= 7 ? `\u00a0J-${days}` : ''}`
  return { text, color: days <= 2 ? C.red : days <= 7 ? C.amber : C.gray, days }
}

/** Dans un groupe : l'échéance la plus proche d'abord, sans échéance ensuite, puis par titre. */
export function byDueThenName(a: AsanaTask, b: AsanaTask) {
  if (a.due !== b.due) {
    if (a.due === null) return 1
    if (b.due === null) return -1
    return a.due < b.due ? -1 : 1
  }
  return shortName(a.name).localeCompare(shortName(b.name), 'fr')
}

// Les descriptions Asana sont du texte brut : une ligne = un paragraphe, et les
// étiquettes de tête (« Contexte : », « Fini quand : ») en gras.
export function notesMarkdown(notes: string) {
  if (!notes.trim()) return '_Pas de description._'
  return notes
    .split(/\n+/)
    .map(line => line.replace(/^([A-ZÀ-Ý][^:\n]{0,40}?)\s*:\s/, '**$1 :** '))
    .join('\n\n')
}

// ─── Comptes ──────────────────────────────────────────────────────────────

export type Counts = {
  /** Tâches ouvertes (non cochées) par groupe. */
  byGroup: Record<GroupKey, number>
  open: number
  /** Cochées depuis la dernière lecture. */
  done: number
  overdue: number
  mine: number
  forClaude: number
}

/** Les comptes d'une liste de tâches (déjà filtrée ou non : c'est à l'appelant de le dire). */
export function countsOf(list: readonly AsanaTask[], now: number): Counts {
  const byGroup: Record<GroupKey, number> = { trancher: 0, cours: 0, attente: 0, faire: 0, autre: 0 }
  let open = 0
  let done = 0
  let overdue = 0
  let mine = 0
  let forClaude = 0
  for (const t of list) {
    if (!isShown(t)) continue
    if (t.completed) {
      done += 1
      continue
    }
    open += 1
    byGroup[groupOf(t)] += 1
    if ((dueOf(t, now)?.days ?? 0) < 0) overdue += 1
    if (isMe(t.assignee)) mine += 1
    if (t.assignee === null) forClaude += 1
  }
  return { byGroup, open, done, overdue, mine, forClaude }
}

/** La tâche ouverte à l'échéance la plus proche (une dépassée d'abord), ou null. */
export function nextDue(list: readonly AsanaTask[]): AsanaTask | null {
  const dated = list.filter(t => isShown(t) && !t.completed && t.due !== null)
  return dated.sort(byDueThenName)[0] ?? null
}

/** « ◆ Section · 2 à trancher · 1 en cours · ⚠ 1 en retard », pour la ligne d'état. */
export function statusLine(section: string | null, counts: Counts): string {
  // Les tâches sans statut comptent aussi : sinon une section qui n'a qu'elles dirait « aucune tâche ouverte ».
  const parts = COUNT_ORDER.filter(g => counts.byGroup[g.key] > 0).map(g => `${counts.byGroup[g.key]} ${g.short}`)
  if (counts.overdue > 0) parts.push(`⚠ ${counts.overdue} en retard`)
  if (parts.length === 0) parts.push('aucune tâche ouverte')
  return `◆ ${section ?? 'Asana'} · ${parts.join(' · ')}`
}

// ─── Écritures de Claude, lisibles dans la conversation ─────────────────────

/** Les outils d'écriture du connecteur Asana, quel que soit le nom du serveur. */
export const WRITE_TOOLS = /__(update_tasks|create_tasks|add_comment|delete_task)$/

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const quoted = (name: string) => `« ${clip(shortName(name), 40)} »`
const isGid = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** Trois noms au plus ; au-delà, les deux premiers et « +n ». */
function listed(names: string[]): string {
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

/** Ce que fait une modification de `update_tasks`, du plus parlant au plus vague. */
function changeOf(c: Record<string, unknown>): { verb: string; suffix: string } {
  // Cocher porte aussi « Statut : fait » dans les notes : la coche l'emporte.
  if (c.completed === true) return { verb: 'coche', suffix: '' }
  if (c.completed === false) return { verb: 'décoche', suffix: '' }
  const statut = typeof c.notes === 'string' ? /^\s*Statut\s*:\s*(.+?)\s*$/im.exec(c.notes)?.[1] : undefined
  if (statut) return { verb: `statut « ${clip(statut, 30)} » sur`, suffix: '' }
  if (typeof c.name === 'string') return { verb: 'renomme', suffix: ` en ${quoted(c.name)}` }
  if (c.assignee === null) return { verb: 'confie à Claude', suffix: '' }
  if (c.assignee === 'me') return { verb: 'assigne', suffix: ' à toi' }
  if (typeof c.assignee === 'string') return { verb: 'assigne', suffix: '' }
  if (c.due_on === null) return { verb: "retire l'échéance de", suffix: '' }
  if (typeof c.due_on === 'string') return { verb: `échéance ${c.due_on} sur`, suffix: '' }
  return { verb: 'modifie', suffix: '' }
}

/**
 * La ligne courte d'un appel d'écriture de Claude (« coche « X » », « crée « Y » »), les
 * tâches nommées d'après les tâches déjà lues (`names`, gid → nom), sans relecture : un
 * gid inconnu s'affiche tel quel. Null quand l'entrée n'a pas la forme attendue : la
 * ligne du moteur reste alors.
 */
export function describeWrite(tool: string, input: unknown, names: ReadonlyMap<string, string>): string | null {
  const kind = WRITE_TOOLS.exec(tool)?.[1]
  if (!kind || typeof input !== 'object' || input === null) return null
  const args = input as Record<string, unknown>
  const nameOf = (gid: string) => {
    const known = names.get(gid)
    return known ? quoted(known) : `tâche ${gid}`
  }
  if (kind === 'add_comment') return isGid(args.task_id) ? `commentaire sur ${nameOf(args.task_id)}` : null
  if (kind === 'delete_task') return isGid(args.task) ? `supprime ${nameOf(args.task)}` : null
  const items = Array.isArray(args.tasks) ? args.tasks : []
  if (items.length === 0 || !items.every(t => typeof t === 'object' && t !== null)) return null
  const list = items as Record<string, unknown>[]
  if (kind === 'create_tasks') {
    if (!list.every(t => typeof t.name === 'string' && t.name.trim())) return null
    return `crée ${listed(list.map(t => quoted(String(t.name))))}`
  }
  if (!list.every(t => isGid(t.task))) return null
  const changes = list.map(changeOf)
  const targets = listed(list.map(t => nameOf(String(t.task))))
  const first = changes[0]!
  // Une seule sorte de modification : on la dit ; sinon, « modifie » et les tâches.
  const isSame = changes.every(c => c.verb === first.verb && c.suffix === first.suffix)
  return isSame ? `${first.verb} ${targets}${first.suffix}` : `modifie ${targets}`
}
