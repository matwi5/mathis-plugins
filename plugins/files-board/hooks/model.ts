// Données pures du navigateur de fichiers, partagées par le module des hooks (register.tsx)
// et la région interactive (browser.tsx) : options, chemins, tri, arborescence, recherche
// floue, colonnes d'affichage et retour à la ligne, coloration syntaxique, édition, menus.
// Rien ici ne parle au moteur.

import type { App, Listing, OptionKey, Options, Os } from '../types'

// ─── Options et plafonds ────────────────────────────────────────────────────

/** Les options par défaut : celles cochées dans le menu ⋮ de l'app desktop. */
export const DEFAULT_OPTIONS: Options = {
  showTree: true,
  previewTabs: true,
  autoSave: true,
  tabIndents: true,
  wordWrap: true,
  indentGuides: true,
  showWhitespace: false,
  scrollBeyondLastLine: false,
  tabSize: 4,
  sidebarWidth: 0,
}

export const TAB_SIZES = [2, 4, 8]

/** Des options lues du stockage : chaque champ inconnu ou mal typé reprend sa valeur par défaut. */
export function normalizeOptions(raw: unknown): Options {
  const o: Options = { ...DEFAULT_OPTIONS }
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULT_OPTIONS) as OptionKey[]) {
      const value = (raw as Record<string, unknown>)[key]
      if (typeof value === typeof o[key]) (o as Record<string, unknown>)[key] = value
    }
  }
  if (!TAB_SIZES.includes(o.tabSize)) o.tabSize = 4
  o.sidebarWidth = clamp(Math.round(o.sidebarWidth), 0, 200)
  return o
}

// Les données de la région passent par ses props, bornées à 100 000 caractères sérialisés :
// au-delà de EDIT_LIMIT, un fichier est lu par fenêtres de lignes, en lecture seule.
export const EDIT_LIMIT = 60_000
export const WINDOW_CHARS = 30_000
export const WINDOW_LINES = 600
/** Lignes de l'arborescence envoyées à la région, au plus. */
export const MAX_ROWS = 1200
/** Entrées gardées par dossier. */
export const MAX_ENTRIES = 2000
/** Résultats de recherche envoyés. */
export const MAX_RESULTS = 150
/** Chemins indexés pour la recherche de fichiers. */
export const MAX_INDEX = 30_000
/** Ce que `$.fs.read` accepte. */
export const MAX_READ = 4 * 1024 * 1024

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// ─── Chemins ────────────────────────────────────────────────────────────────
// Dans le mod, un chemin relatif à la racine est séparé par `/` ; '' est la racine.

export const joinRel = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
export const parentOf = (rel: string) => {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}
export const baseName = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1)

/** Les dossiers qui contiennent `rel`, du plus haut au plus proche : `a/b/c.md` → `a`, `a/b`. */
export function ancestors(rel: string): string[] {
  const parts = rel.split('/').filter(Boolean)
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

/**
 * Les marques « modifié par Claude » de l'arborescence : les fichiers touchés, et leurs dossiers
 * parents pour qu'on les trouve même repliés.
 */
export function touchedMarks(touched: readonly string[]): { files: Set<string>; dirs: Set<string> } {
  const dirs = new Set<string>()
  for (const f of touched) for (const a of ancestors(f)) dirs.add(a)
  return { files: new Set(touched), dirs }
}

export const isAbsolutePath = (p: string) => /^([A-Za-z]:[\\/]|[\\/])/.test(p)

/** Le chemin absolu d'un chemin relatif à la racine, avec le séparateur du système. */
export function toAbs(root: string, rel: string, sep: string): string {
  if (!rel) return root
  const base = root.replace(/[\\/]+$/, '')
  return `${base}${sep}${rel.split('/').join(sep)}`
}

/** Un chemin tapé (relatif à `base` ou absolu) rendu absolu, `.` et `..` résolus. */
export function resolveFrom(base: string, input: string, sep: '\\' | '/'): string {
  const p = input.trim().replace(/^["']|["']$/g, '')
  const abs = isAbsolutePath(p) ? p : `${base.replace(/[\\/]+$/, '')}/${p}`
  const drive = /^[A-Za-z]:/.exec(abs)?.[0] ?? ''
  const parts: string[] = []
  for (const s of abs.slice(drive.length).split(/[\\/]+/)) {
    if (!s || s === '.') continue
    if (s === '..') parts.pop()
    else parts.push(s)
  }
  return `${drive}${sep}${parts.join(sep)}`
}

/** `abs` relatif à `root` (séparé par `/`), ou null quand il est en dehors. */
export function relFrom(root: string, abs: string, os: Os): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = norm(root)
  const a = norm(abs)
  const same = (x: string, y: string) => (os === 'linux' ? x === y : x.toLowerCase() === y.toLowerCase())
  if (same(a, r)) return ''
  if (a.length > r.length && same(a.slice(0, r.length + 1), `${r}/`)) return a.slice(r.length + 1)
  return null
}

/** Le nom d'un dossier absolu, pour l'en-tête. */
export const folderName = (abs: string) => abs.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || abs

/** La mention `@chemin` que le prompt de Claude Code lit comme un fichier joint. */
export const mention = (rel: string, isDir: boolean) => {
  const p = isDir && rel ? `${rel}/` : rel || '.'
  return /\s/.test(p) ? `@"${p}"` : `@${p}`
}

// ─── Tri et arborescence ────────────────────────────────────────────────────

/**
 * Ordre de l'app desktop : dossiers et fichiers mêlés, sans tenir compte de la casse, les
 * nombres dans l'ordre naturel (`fichier2` avant `fichier10`).
 */
export function compareNames(a: string, b: string): number {
  const parts = (s: string) => s.toLowerCase().match(/\d+|\D+/g) ?? []
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i]!
    const q = y[i]!
    if (p === q) continue
    if (/^\d/.test(p) && /^\d/.test(q)) {
      const d = Number(p) - Number(q)
      if (d !== 0) return d
      continue
    }
    return p < q ? -1 : 1
  }
  if (x.length !== y.length) return x.length - y.length
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Une ligne de l'arborescence, codée en une chaîne pour tenir dans les props : la profondeur
 * en base 36, une lettre de sorte, le nom. `f` fichier, `d` dossier replié, `o` dossier
 * déplié, `l` dossier en cours de lecture, `x` une note (erreur, dossier vide, entrées masquées).
 */
export type RowKind = 'f' | 'd' | 'o' | 'l' | 'x'
export type TreeRow = { depth: number; kind: RowKind; name: string; path: string }

export const encodeRow = (depth: number, kind: RowKind, name: string) => `${Math.min(depth, 35).toString(36)}${kind}${name}`

/** Les lignes décodées, chacune avec son chemin relatif (celui du dossier pour une note). */
export function decodeRows(rows: readonly string[]): TreeRow[] {
  const stack: string[] = []
  return rows.map((r) => {
    const depth = parseInt(r[0] ?? '0', 36)
    const kind = (r[1] ?? 'x') as RowKind
    const name = r.slice(2)
    stack.length = depth
    const parent = stack.join('/')
    const path = kind === 'l' || kind === 'x' ? parent : joinRel(parent, name)
    if (kind === 'o') stack[depth] = name
    return { depth, kind, name, path }
  })
}

/** Les lignes visibles : chaque dossier déplié suivi de son contenu, plafonnées à `max`. */
export function flattenRows(listings: Readonly<Record<string, Listing>>, expanded: ReadonlySet<string>, max = MAX_ROWS) {
  const rows: string[] = []
  let hidden = 0
  const push = (depth: number, kind: RowKind, name: string) => {
    if (rows.length < max) rows.push(encodeRow(depth, kind, name))
    else hidden += 1
  }
  const walk = (dir: string, depth: number) => {
    const l = listings[dir]
    if (!l) return push(depth, 'l', 'Lecture…')
    if (l.error) return push(depth, 'x', l.error)
    if (l.entries.length === 0) return push(depth, 'x', 'Dossier vide')
    for (const entry of l.entries) {
      const path = joinRel(dir, entry.name)
      if (entry.kind === 'dir') {
        const isOpen = expanded.has(path)
        push(depth, isOpen ? 'o' : 'd', entry.name)
        if (isOpen) walk(path, depth + 1)
      } else push(depth, 'f', entry.name)
    }
    if (l.hidden > 0) push(depth, 'x', `… ${l.hidden} autres entrées`)
  }
  walk('', 0)
  return { rows, hidden }
}

// ─── Recherche floue ────────────────────────────────────────────────────────

const BOUNDARY = /[\\/\-_. ]/

function subsequence(query: string, text: string): number {
  let from = 0
  let prev = -2
  let score = 0
  for (const ch of query) {
    const i = text.indexOf(ch, from)
    if (i < 0) return -1
    score += 1
    if (i === prev + 1) score += 4
    if (i === 0 || BOUNDARY.test(text[i - 1] ?? '')) score += 3
    prev = i
    from = i + 1
  }
  return score
}

/**
 * La note d'un chemin pour une recherche : -1 quand les lettres n'y sont pas dans l'ordre ;
 * plus haut quand elles tombent dans le nom, se suivent ou commencent des mots.
 */
export function fuzzyScore(rawQuery: string, path: string): number {
  const query = rawQuery.toLowerCase().replace(/\s+/g, '')
  if (!query) return 0
  const lower = path.toLowerCase()
  const whole = subsequence(query, lower)
  if (whole < 0) return -1
  const trimmed = lower.replace(/\/$/, '')
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  let score = whole
  const inBase = subsequence(query, base)
  if (inBase >= 0) score += 30 + inBase
  if (base === query) score += 100
  else if (base.startsWith(query)) score += 40
  if (lower.includes(query)) score += 25
  return score - path.length * 0.05
}

/** Les meilleurs chemins pour `query`, et combien correspondaient en tout. */
export function searchPaths(paths: readonly string[], query: string, limit = MAX_RESULTS) {
  const hits: { path: string; score: number }[] = []
  for (const path of paths) {
    const score = fuzzyScore(query, path)
    if (score >= 0) hits.push({ path, score })
  }
  hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length || compareNames(a.path, b.path))
  return { results: hits.slice(0, limit).map((h) => h.path), total: hits.length }
}

// ─── Colonnes d'affichage ───────────────────────────────────────────────────

const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
]

/** Colonnes qu'occupe un caractère : 0 pour une marque combinante, 2 pour un caractère large. */
export function charWidth(cp: number): number {
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
  for (const [lo, hi] of WIDE) if (cp >= lo && cp <= hi) return 2
  return 1
}

export function strWidth(s: string): number {
  let w = 0
  for (const ch of s) w += charWidth(ch.codePointAt(0) ?? 32)
  return w
}

/** `s` coupé à `width` colonnes, avec « … » s'il a fallu couper. */
export function fit(s: string, width: number): string {
  if (width <= 0) return ''
  if (strWidth(s) <= width) return s
  let out = ''
  let w = 0
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0) ?? 32)
    if (w + cw > width - 1) break
    out += ch
    w += cw
  }
  return `${out}…`
}

/** `s` coupé ou complété d'espaces à exactement `width` colonnes. */
export const pad = (s: string, width: number) => {
  const t = fit(s, width)
  return t + ' '.repeat(Math.max(0, width - strWidth(t)))
}

/**
 * Un caractère d'une ligne tel qu'affiché : `i` son indice dans la ligne, `n` ses unités
 * de code, `col` sa colonne, `w` sa largeur (une tabulation va au prochain taquet).
 */
export type Glyph = { i: number; n: number; col: number; w: number; ch: string }

export function glyphs(line: string, tabSize: number): Glyph[] {
  const out: Glyph[] = []
  let col = 0
  let i = 0
  while (i < line.length) {
    const cp = line.codePointAt(i) ?? 32
    const n = cp > 0xffff ? 2 : 1
    let ch = String.fromCodePoint(cp)
    let w = charWidth(cp)
    if (cp === 9) {
      ch = '\t'
      w = tabSize - (col % tabSize)
    } else if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) {
      // Un caractère de contrôle ne s'affiche pas tel quel : un losange le signale.
      ch = '�'
      w = 1
    }
    out.push({ i, n, col, w, ch })
    col += w
    i += n
  }
  return out
}

export const glyphsWidth = (gl: readonly Glyph[]) => {
  const last = gl[gl.length - 1]
  return last ? last.col + last.w : 0
}

/** La colonne d'affichage de l'indice `ci` dans la ligne. */
export function colOf(gl: readonly Glyph[], ci: number): number {
  for (const g of gl) if (g.i >= ci) return g.col
  return glyphsWidth(gl)
}

/** L'indice dans la ligne du caractère affiché à la colonne `col` (ou la fin de ligne). */
export function indexAt(gl: readonly Glyph[], col: number, lineLength: number): number {
  for (const g of gl) if (col < g.col + Math.max(1, g.w)) return col >= g.col + g.w / 2 && g.w > 1 ? g.i + g.n : g.i
  return lineLength
}

/**
 * Où commence chaque rangée d'une ligne repliée à `width` colonnes (indices de glyphes) :
 * de préférence après un espace, sinon au milieu d'un mot.
 */
export function wrapRows(gl: readonly Glyph[], width: number): number[] {
  const w = Math.max(2, width)
  const starts = [0]
  let rowStart = 0
  let rowCol = 0
  let lastBreak = -1
  for (let g = 0; g < gl.length; g++) {
    const x = gl[g]!
    if (x.col + x.w - rowCol > w && g > rowStart) {
      const s = lastBreak >= rowStart && lastBreak < g ? lastBreak + 1 : g
      starts.push(s)
      rowStart = s
      rowCol = gl[s]!.col
      lastBreak = -1
    }
    if (x.ch === ' ' || x.ch === '\t') lastBreak = g
  }
  return starts
}

// ─── Coloration syntaxique ──────────────────────────────────────────────────

export type Lang = 'js' | 'c' | 'py' | 'sh' | 'ps' | 'json' | 'yaml' | 'css' | 'html' | 'md' | 'sql' | 'text'

const EXT_LANG: Record<string, Lang> = {
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js',
  c: 'c', h: 'c', cc: 'c', cpp: 'c', hpp: 'c', cs: 'c', java: 'c', kt: 'c', kts: 'c', go: 'c', rs: 'c',
  swift: 'c', php: 'c', dart: 'c', scala: 'c', gradle: 'c', groovy: 'c',
  py: 'py', pyw: 'py', rb: 'py',
  sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh', env: 'sh',
  ps1: 'ps', psm1: 'ps', psd1: 'ps',
  json: 'json', jsonc: 'json', json5: 'json', jsonl: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml', cfg: 'yaml', conf: 'yaml', properties: 'yaml',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html', svelte: 'html', xaml: 'html', csproj: 'html',
  md: 'md', markdown: 'md', mdx: 'md',
  sql: 'sql',
}

const EXT_LABEL: Record<string, string> = {
  js: 'JavaScript', jsx: 'JavaScript JSX', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript JSX',
  mts: 'TypeScript', cts: 'TypeScript', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', cs: 'C#', java: 'Java',
  kt: 'Kotlin', go: 'Go', rs: 'Rust', swift: 'Swift', php: 'PHP', dart: 'Dart', py: 'Python', rb: 'Ruby',
  sh: 'Shell', bash: 'Bash', zsh: 'Zsh', ps1: 'PowerShell', psm1: 'PowerShell', json: 'JSON', jsonc: 'JSON',
  jsonl: 'JSON Lines', yaml: 'YAML', yml: 'YAML', toml: 'TOML', ini: 'INI', css: 'CSS', scss: 'SCSS', less: 'Less',
  html: 'HTML', htm: 'HTML', xml: 'XML', svg: 'SVG', vue: 'Vue', svelte: 'Svelte', md: 'Markdown', mdx: 'MDX',
  sql: 'SQL', txt: 'Texte',
}

const extOf = (path: string) => {
  const name = baseName(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(dot + 1)
}

export function langOf(path: string): Lang {
  const name = baseName(path).toLowerCase()
  if (name === 'dockerfile' || name === 'makefile' || name.startsWith('.env')) return 'sh'
  if (name === '.gitignore' || name === '.gitattributes' || name === '.editorconfig') return 'sh'
  return EXT_LANG[extOf(path)] ?? 'text'
}

export const languageLabel = (path: string) => EXT_LABEL[extOf(path)] ?? 'Texte brut'

export const isMarkdown = (path: string) => langOf(path) === 'md'

/** Un jeton coloré : début et fin (indices dans la ligne), classe. */
export type Tok = [number, number, string]
/**
 * Ce qui continue d'une ligne à la suivante : '' rien, `bc` un commentaire bloc, `tpl` un
 * gabarit JS, `tq"` ou `tq'` une triple chaîne Python, `fence` un bloc de code Markdown.
 */
export type HlState = string

type Spec = {
  line: string[]
  block: [string, string] | null
  quotes: string
  template?: boolean
  triple?: boolean
  dollar?: boolean
  ci?: boolean
  types?: boolean
  keywords: ReadonlySet<string>
  controls: ReadonlySet<string>
  consts: ReadonlySet<string>
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

const SPECS: Partial<Record<Lang, Spec>> = {
  js: {
    line: ['//'],
    block: ['/*', '*/'],
    quotes: `'"\``,
    template: true,
    types: true,
    keywords: words(
      'const let var function class extends new this super typeof instanceof in of void delete async await static get set yield interface type enum implements namespace declare readonly public private protected abstract as satisfies keyof infer is unique any number string boolean never unknown object symbol bigint',
    ),
    controls: words('if else for while do switch case default break continue return throw try catch finally import export from with'),
    consts: words('true false null undefined NaN Infinity'),
  },
  c: {
    line: ['//'],
    block: ['/*', '*/'],
    quotes: `'"`,
    types: true,
    keywords: words(
      'int float double char void long short unsigned signed struct union enum typedef const static extern auto volatile sizeof class public private protected internal abstract final override virtual new this self super fn let mut pub impl trait mod use crate func var val package interface type namespace using where async await defer go chan map bool string byte rune object dynamic readonly sealed partial operator',
    ),
    controls: words('if else for foreach while do switch case default break continue return throw try catch finally goto match loop in as import yield when'),
    consts: words('true false null nil NULL nullptr None'),
  },
  py: {
    line: ['#'],
    block: null,
    quotes: `'"`,
    triple: true,
    types: true,
    keywords: words('def class lambda global nonlocal pass del and or not is in as async await self cls end module begin'),
    controls: words('if elif else for while break continue return try except finally raise with import from yield assert match case unless until do'),
    consts: words('True False None nil true false'),
  },
  sh: {
    line: ['#'],
    block: null,
    quotes: `'"`,
    dollar: true,
    keywords: words('function local export readonly declare echo cd set unset alias source printf eval exec shift trap FROM RUN CMD COPY ADD ENV WORKDIR ENTRYPOINT ARG EXPOSE'),
    controls: words('if then else elif fi for in do done while until case esac return exit break continue'),
    consts: words('true false'),
  },
  ps: {
    line: ['#'],
    block: ['<#', '#>'],
    quotes: `'"`,
    dollar: true,
    ci: true,
    keywords: words('function param begin process end filter class enum using'),
    controls: words('if elseif else foreach for while do until switch break continue return throw try catch finally exit in'),
    consts: words(''),
  },
  sql: {
    line: ['--'],
    block: ['/*', '*/'],
    quotes: `'"`,
    ci: true,
    keywords: words(
      'select from where insert into values update set delete create table alter drop index view join left right inner outer full cross on as and or not is in like between order by group having limit offset distinct union all primary key foreign references default unique check constraint begin commit rollback grant revoke function returns language replace trigger exists case when then else end with returning cascade',
    ),
    controls: words(''),
    consts: words('true false null'),
  },
}

const IDENT_START = /[A-Za-z_$À-￿]/
const IDENT = /[\w$À-￿]/
const NUMBER = /(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/y
const WORD = /[A-Za-z_$À-￿][\w$À-￿]*/y
const DOLLAR = /\$\{?[\w:?]+\}?/y

/** L'indice du guillemet fermant `q` à partir de `from` (les `\` échappent), ou -1. */
function closing(line: string, from: number, q: string): number {
  for (let i = from; i < line.length; i++) {
    const c = line[i]
    if (c === '\\') i += 1
    else if (c === q) return i
  }
  return -1
}

const nextChar = (line: string, from: number) => {
  for (let i = from; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return line[i]
  return ''
}
const prevChar = (line: string, from: number) => {
  for (let i = from; i >= 0; i--) if (line[i] !== ' ' && line[i] !== '\t') return line[i]
  return ''
}

function tokenizeCode(line: string, spec: Spec, start: HlState): { toks: Tok[]; state: HlState } {
  const toks: Tok[] = []
  const n = line.length
  let state = start
  let i = 0
  if (state === 'bc' && spec.block) {
    const e = line.indexOf(spec.block[1])
    if (e < 0) return { toks: [[0, n, 'c']], state }
    toks.push([0, e + spec.block[1].length, 'c'])
    i = e + spec.block[1].length
    state = ''
  } else if (state === 'tpl') {
    const e = closing(line, 0, '`')
    if (e < 0) return { toks: [[0, n, 's']], state }
    toks.push([0, e + 1, 's'])
    i = e + 1
    state = ''
  } else if (state.startsWith('tq')) {
    const q = state.slice(2).repeat(3)
    const e = line.indexOf(q)
    if (e < 0) return { toks: [[0, n, 's']], state }
    toks.push([0, e + 3, 's'])
    i = e + 3
    state = ''
  }
  while (i < n) {
    const c = line[i]!
    if (c === ' ' || c === '\t') {
      i += 1
      continue
    }
    if (spec.line.some((t) => line.startsWith(t, i))) {
      toks.push([i, n, 'c'])
      break
    }
    if (spec.block && line.startsWith(spec.block[0], i)) {
      const e = line.indexOf(spec.block[1], i + spec.block[0].length)
      if (e < 0) {
        toks.push([i, n, 'c'])
        state = 'bc'
        break
      }
      toks.push([i, e + spec.block[1].length, 'c'])
      i = e + spec.block[1].length
      continue
    }
    if (spec.triple && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
      const q = line.slice(i, i + 3)
      const e = line.indexOf(q, i + 3)
      if (e < 0) {
        toks.push([i, n, 's'])
        state = `tq${q[0]}`
        break
      }
      toks.push([i, e + 3, 's'])
      i = e + 3
      continue
    }
    if (spec.quotes.includes(c)) {
      const e = closing(line, i + 1, c)
      if (e < 0 && c === '`' && spec.template) {
        toks.push([i, n, 's'])
        state = 'tpl'
        break
      }
      const end = e < 0 ? n : e + 1
      toks.push([i, end, 's'])
      i = end
      continue
    }
    if (/[0-9]/.test(c) && !IDENT.test(line[i - 1] ?? ' ')) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(line)
      const len = m ? m[0].length : 1
      toks.push([i, i + len, 'n'])
      i += len
      continue
    }
    if (spec.dollar && c === '$') {
      DOLLAR.lastIndex = i
      const m = DOLLAR.exec(line)
      if (m && m[0].length > 1) {
        toks.push([i, i + m[0].length, 'v'])
        i += m[0].length
        continue
      }
    }
    if (IDENT_START.test(c)) {
      WORD.lastIndex = i
      const w = WORD.exec(line)?.[0] ?? c
      const key = spec.ci ? w.toLowerCase() : w
      let cls = ''
      if (spec.controls.has(key)) cls = 'K'
      else if (spec.keywords.has(key)) cls = 'k'
      else if (spec.consts.has(key)) cls = 'o'
      else if (nextChar(line, i + w.length) === '(') cls = 'f'
      else if (prevChar(line, i - 1) === '.') cls = 'p'
      else if (spec.types && /^[A-Z][a-z0-9]/.test(w)) cls = 't'
      if (cls) toks.push([i, i + w.length, cls])
      i += w.length
      continue
    }
    i += 1
  }
  return { toks, state }
}

function tokenizeJson(line: string, start: HlState): { toks: Tok[]; state: HlState } {
  const toks: Tok[] = []
  let i = 0
  let state = start
  if (state === 'bc') {
    const e = line.indexOf('*/')
    if (e < 0) return { toks: [[0, line.length, 'c']], state }
    toks.push([0, e + 2, 'c'])
    i = e + 2
    state = ''
  }
  while (i < line.length) {
    const c = line[i]!
    if (c === '"') {
      const e = closing(line, i + 1, '"')
      const end = e < 0 ? line.length : e + 1
      toks.push([i, end, nextChar(line, end) === ':' ? 'p' : 's'])
      i = end
    } else if (line.startsWith('//', i)) {
      toks.push([i, line.length, 'c'])
      break
    } else if (line.startsWith('/*', i)) {
      const e = line.indexOf('*/', i + 2)
      if (e < 0) {
        toks.push([i, line.length, 'c'])
        state = 'bc'
        break
      }
      toks.push([i, e + 2, 'c'])
      i = e + 2
    } else if (/[-0-9]/.test(c)) {
      NUMBER.lastIndex = c === '-' ? i + 1 : i
      const m = NUMBER.exec(line)
      const len = (m ? m[0].length : 0) + (c === '-' ? 1 : 0)
      if (len > (c === '-' ? 1 : 0)) toks.push([i, i + len, 'n'])
      i += Math.max(1, len)
    } else if (/[tfn]/.test(c)) {
      const m = /^(true|false|null)\b/.exec(line.slice(i, i + 6))
      if (m) toks.push([i, i + m[0].length, 'o'])
      i += m ? m[0].length : 1
    } else i += 1
  }
  return { toks, state }
}

function tokenizeYaml(line: string): Tok[] {
  const toks: Tok[] = []
  const trimmed = line.trimStart()
  const lead = line.length - trimmed.length
  if (trimmed.startsWith('#') || trimmed.startsWith(';')) return [[lead, line.length, 'c']]
  if (/^\[.*\]\s*$/.test(trimmed)) return [[lead, line.length, 'h']]
  const key = /^(\s*(?:-\s+)?)([^:=#\s][^:=#]*?)\s*[:=](\s|$)/.exec(line)
  let from = 0
  if (key) {
    const ks = key[1]!.length
    toks.push([ks, ks + key[2]!.length, 'p'])
    from = key[0].length
  }
  const rest = line.slice(from)
  const comment = rest.search(/\s#/)
  const valueEnd = comment < 0 ? line.length : from + comment
  const value = line.slice(from, valueEnd).trim()
  if (value) {
    const vs = line.indexOf(value, from)
    if (/^["']/.test(value)) toks.push([vs, vs + value.length, 's'])
    else if (/^-?\d[\d_.]*([eE][+-]?\d+)?$/.test(value)) toks.push([vs, vs + value.length, 'n'])
    else if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) toks.push([vs, vs + value.length, 'o'])
  }
  if (comment >= 0) toks.push([from + comment + 1, line.length, 'c'])
  return toks
}

function tokenizeCss(line: string, start: HlState): { toks: Tok[]; state: HlState } {
  const toks: Tok[] = []
  let i = 0
  let state = start
  if (state === 'bc') {
    const e = line.indexOf('*/')
    if (e < 0) return { toks: [[0, line.length, 'c']], state }
    toks.push([0, e + 2, 'c'])
    i = e + 2
    state = ''
  }
  const isDecl = /^\s*[-\w]+\s*:/.test(line) && !/[{]/.test(line)
  while (i < line.length) {
    const c = line[i]!
    if (line.startsWith('/*', i)) {
      const e = line.indexOf('*/', i + 2)
      if (e < 0) {
        toks.push([i, line.length, 'c'])
        state = 'bc'
        break
      }
      toks.push([i, e + 2, 'c'])
      i = e + 2
    } else if (line.startsWith('//', i) && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
      toks.push([i, line.length, 'c'])
      break
    } else if (c === '"' || c === "'") {
      const e = closing(line, i + 1, c)
      const end = e < 0 ? line.length : e + 1
      toks.push([i, end, 's'])
      i = end
    } else if (c === '@') {
      WORD.lastIndex = i + 1
      const w = WORD.exec(line)?.[0] ?? ''
      toks.push([i, i + 1 + w.length, 'K'])
      i += 1 + w.length
    } else if (c === '#' && isDecl) {
      const m = /^#[0-9a-fA-F]{3,8}/.exec(line.slice(i, i + 9))
      const len = m ? m[0].length : 1
      if (m) toks.push([i, i + len, 'n'])
      i += len
    } else if (/[0-9.]/.test(c) && !IDENT.test(line[i - 1] ?? ' ') && /[0-9]/.test(c === '.' ? (line[i + 1] ?? '') : c)) {
      const m = /^\.?\d[\d.]*[a-zA-Z%]*/.exec(line.slice(i, i + 20))
      const len = m ? m[0].length : 1
      toks.push([i, i + len, 'n'])
      i += len
    } else if (isDecl && /[-\w]/.test(c) && i < line.indexOf(':')) {
      const m = /^[-\w]+/.exec(line.slice(i))
      const len = m ? m[0].length : 1
      toks.push([i, i + len, 'p'])
      i += len
    } else i += 1
  }
  return { toks, state }
}

function tokenizeHtml(line: string, start: HlState): { toks: Tok[]; state: HlState } {
  const toks: Tok[] = []
  let i = 0
  let state = start
  if (state === 'hc') {
    const e = line.indexOf('-->')
    if (e < 0) return { toks: [[0, line.length, 'c']], state }
    toks.push([0, e + 3, 'c'])
    i = e + 3
    state = ''
  }
  let inTag = false
  while (i < line.length) {
    const c = line[i]!
    if (line.startsWith('<!--', i)) {
      const e = line.indexOf('-->', i + 4)
      if (e < 0) {
        toks.push([i, line.length, 'c'])
        state = 'hc'
        break
      }
      toks.push([i, e + 3, 'c'])
      i = e + 3
    } else if (c === '<') {
      const m = /^<\/?[\w:.-]*/.exec(line.slice(i, i + 64))
      const len = m ? m[0].length : 1
      toks.push([i, i + len, 'g'])
      i += len
      inTag = true
    } else if (inTag && (c === '>' || line.startsWith('/>', i))) {
      const len = c === '>' ? 1 : 2
      toks.push([i, i + len, 'g'])
      i += len
      inTag = false
    } else if (inTag && (c === '"' || c === "'")) {
      const e = closing(line, i + 1, c)
      const end = e < 0 ? line.length : e + 1
      toks.push([i, end, 's'])
      i = end
    } else if (inTag && /[\w:@.-]/.test(c)) {
      const m = /^[\w:@.-]+/.exec(line.slice(i))
      const len = m ? m[0].length : 1
      toks.push([i, i + len, 'a'])
      i += len
    } else i += 1
  }
  return { toks, state }
}

function tokenizeMarkdown(line: string, start: HlState): { toks: Tok[]; state: HlState } {
  const isFence = /^\s*(```|~~~)/.test(line)
  if (start === 'fence') return { toks: [[0, line.length, 'm']], state: isFence ? '' : 'fence' }
  if (isFence) return { toks: [[0, line.length, 'm']], state: 'fence' }
  if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) return { toks: [[0, line.length, 'h']], state: '' }
  if (/^\s*>/.test(line)) return { toks: [[0, line.length, 'c']], state: '' }
  const toks: Tok[] = []
  const list = /^\s*([-*+]|\d+[.)])\s/.exec(line)
  if (list) {
    const s = line.indexOf(list[1]!)
    toks.push([s, s + list[1]!.length, 'K'])
  }
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\[[^\]]*\]\([^)]*\)|<https?:[^>]+>)/g
  for (let m = re.exec(line); m; m = re.exec(line)) toks.push([m.index, m.index + m[0].length, m[1] ? 'm' : m[2] ? 'b' : 'l'])
  return { toks, state: '' }
}

/** Les jetons colorés d'une ligne, et ce qui continue sur la suivante. */
export function tokenize(line: string, lang: Lang, state: HlState): { toks: Tok[]; state: HlState } {
  const spec = SPECS[lang]
  if (spec) return tokenizeCode(line, spec, state)
  if (lang === 'json') return tokenizeJson(line, state)
  if (lang === 'yaml') return { toks: tokenizeYaml(line), state: '' }
  if (lang === 'css') return tokenizeCss(line, state)
  if (lang === 'html') return tokenizeHtml(line, state)
  if (lang === 'md') return tokenizeMarkdown(line, state)
  return { toks: [], state: '' }
}

// ─── Markdown rendu ─────────────────────────────────────────────────────────

/** Taille d'un bloc passé à l'élément Markdown (10 000 caractères au plus). */
const BLOCK_CHARS = 6000

/**
 * Les blocs d'un document Markdown (paragraphes, titres, blocs de code), avec leur première
 * ligne : l'aperçu défile bloc par bloc.
 */
export function mdBlocks(lines: readonly string[]): { start: number; text: string }[] {
  const blocks: { start: number; text: string }[] = []
  let cur: string[] = []
  let start = 0
  let fence: string | null = null
  const flush = () => {
    if (cur.length) blocks.push(...splitBlock(start, cur))
    cur = []
  }
  lines.forEach((line, i) => {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1] ?? null
    if (fence === null && line.trim() === '') return flush()
    if (!cur.length) start = i
    cur.push(line)
    if (marker && fence === null) fence = marker
    else if (marker && marker === fence) fence = null
    if (fence === null && /^\s{0,3}#{1,6}\s/.test(line)) flush()
  })
  flush()
  return blocks
}

function splitBlock(start: number, lines: string[]): { start: number; text: string }[] {
  const text = lines.join('\n')
  if (text.length <= BLOCK_CHARS) return [{ start, text }]
  const out: { start: number; text: string }[] = []
  const opener = /^\s*(```|~~~).*$/.exec(lines[0] ?? '')?.[0] ?? null
  let chunk: string[] = []
  let chunkStart = start
  let size = 0
  lines.forEach((line, i) => {
    const piece = line.length > BLOCK_CHARS ? `${line.slice(0, BLOCK_CHARS - 1)}…` : line
    if (size + piece.length + 1 > BLOCK_CHARS && chunk.length) {
      out.push({ start: chunkStart, text: chunk.join('\n') })
      chunk = opener && i > 0 ? [opener.trim()] : []
      chunkStart = start + i
      size = chunk.join('\n').length
    }
    chunk.push(piece)
    size += piece.length + 1
  })
  if (chunk.length) out.push({ start: chunkStart, text: chunk.join('\n') })
  // Un bloc de code coupé en morceaux : chaque morceau garde sa clôture pour s'afficher en code.
  if (opener) {
    const fenceMark = /(```|~~~)/.exec(opener)?.[1] ?? '```'
    for (const part of out) if (!/(```|~~~)\s*$/.test(part.text)) part.text += `\n${fenceMark}`
  }
  return out
}

// ─── Édition ────────────────────────────────────────────────────────────────

/** Un tampon d'édition : ses lignes et le curseur (ligne `cy`, indice `cx` dans la ligne). */
export type Caret = { lines: string[]; cy: number; cx: number }

/**
 * L'unité d'indentation du fichier : une tabulation s'il indente surtout ainsi, sinon le
 * plus petit retrait d'espaces (2, 4 ou 8) ; null quand rien n'est indenté.
 */
export function detectIndent(lines: readonly string[]): string | null {
  let tabs = 0
  let spaces = 0
  let smallest = Infinity
  for (const line of lines.slice(0, 2000)) {
    if (line.startsWith('\t')) tabs += 1
    else if (line.startsWith(' ') && line.trim()) {
      const n = /^ */.exec(line)?.[0].length ?? 0
      // Les ` * ` des commentaires bloc ne disent rien de l'indentation.
      if (/^ +\*/.test(line) && n % 2 === 1) continue
      spaces += 1
      smallest = Math.min(smallest, n)
    }
  }
  if (tabs > spaces) return '\t'
  if (!spaces) return null
  return ' '.repeat(smallest >= 8 ? 8 : smallest >= 4 ? 4 : 2)
}

/** La largeur d'un cran d'indentation, en colonnes. */
export const indentStep = (unit: string, tabSize: number) => (unit === '\t' ? tabSize : unit.length)

export function insertText(b: Caret, raw: string): void {
  const text = raw.replace(/\r\n?/g, '\n')
  const line = b.lines[b.cy] ?? ''
  const before = line.slice(0, b.cx)
  const after = line.slice(b.cx)
  const parts = text.split('\n')
  if (parts.length === 1) {
    b.lines[b.cy] = before + text + after
    b.cx += text.length
    return
  }
  const last = parts[parts.length - 1]!
  const middle = parts.slice(1, -1)
  b.lines.splice(b.cy, 1, before + parts[0], ...middle, last + after)
  b.cy += parts.length - 1
  b.cx = last.length
}

const OPENERS: Record<string, string> = { '{': '}', '[': ']', '(': ')' }

/** Entrée : nouvelle ligne à la même indentation, un cran de plus après `{`, `[`, `(` ou `:`. */
export function newline(b: Caret, unit: string, lang: Lang): void {
  const line = b.lines[b.cy] ?? ''
  const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
  const before = line.slice(0, b.cx).trimEnd()
  const prev = before[before.length - 1] ?? ''
  const next = line[b.cx] ?? ''
  const opens = prev in OPENERS || (prev === ':' && lang === 'py')
  if (opens && OPENERS[prev] === next) {
    insertText(b, `\n${indent}${unit}\n${indent}`)
    b.cy -= 1
    b.cx = indent.length + unit.length
    return
  }
  insertText(b, `\n${indent}${opens ? unit : ''}`)
}

/** Retour arrière ; dans une indentation d'espaces, recule d'un cran (`step` colonnes). */
export function deleteBack(b: Caret, step: number): void {
  if (b.cx === 0) {
    if (b.cy === 0) return
    const prev = b.lines[b.cy - 1] ?? ''
    b.lines.splice(b.cy - 1, 2, prev + (b.lines[b.cy] ?? ''))
    b.cy -= 1
    b.cx = prev.length
    return
  }
  const line = b.lines[b.cy] ?? ''
  const head = line.slice(0, b.cx)
  let count = 1
  if (/^ +$/.test(head)) count = ((head.length - 1) % step) + 1
  else if (b.cx >= 2 && /[\uDC00-\uDFFF]/.test(line[b.cx - 1] ?? '') && /[\uD800-\uDBFF]/.test(line[b.cx - 2] ?? '')) count = 2
  b.lines[b.cy] = line.slice(0, b.cx - count) + line.slice(b.cx)
  b.cx -= count
}

export function deleteForward(b: Caret): void {
  const line = b.lines[b.cy] ?? ''
  if (b.cx >= line.length) {
    if (b.cy >= b.lines.length - 1) return
    b.lines.splice(b.cy, 2, line + (b.lines[b.cy + 1] ?? ''))
    return
  }
  const count = /[\uD800-\uDBFF]/.test(line[b.cx] ?? '') ? 2 : 1
  b.lines[b.cy] = line.slice(0, b.cx) + line.slice(b.cx + count)
}

/** Tab : une tabulation, ou des espaces jusqu'au prochain cran d'indentation. */
export function indent(b: Caret, unit: string, tabSize: number): void {
  if (unit === '\t') return insertText(b, '\t')
  const step = unit.length
  const col = colOf(glyphs(b.lines[b.cy] ?? '', tabSize), b.cx)
  insertText(b, ' '.repeat(step - (col % step)))
}

/** Maj+Tab : retire un cran d'indentation au début de la ligne. */
export function outdent(b: Caret, unit: string, tabSize: number): void {
  const line = b.lines[b.cy] ?? ''
  let count = 0
  if (line.startsWith('\t')) count = 1
  else count = Math.min(/^ */.exec(line)?.[0].length ?? 0, unit === '\t' ? tabSize : unit.length)
  if (!count) return
  b.lines[b.cy] = line.slice(count)
  b.cx = Math.max(0, b.cx - count)
}

const isWordChar = (c: string) => /[\wÀ-￿]/.test(c)

export function wordLeft(line: string, cx: number): number {
  let i = cx
  while (i > 0 && !isWordChar(line[i - 1] ?? '')) i -= 1
  while (i > 0 && isWordChar(line[i - 1] ?? '')) i -= 1
  return i
}

export function wordRight(line: string, cx: number): number {
  let i = cx
  while (i < line.length && !isWordChar(line[i] ?? '')) i += 1
  while (i < line.length && isWordChar(line[i] ?? '')) i += 1
  return i
}

/** Début : le premier caractère non blanc, ou le début de ligne s'il y est déjà. */
export function smartHome(line: string, cx: number): number {
  const first = /^[ \t]*/.exec(line)?.[0].length ?? 0
  return cx === first ? 0 : first
}

/** Les occurrences de `query` (sans tenir compte de la casse) : ligne, début, fin. */
export function findMatches(lines: readonly string[], query: string, max = 5000): [number, number, number][] {
  const out: [number, number, number][] = []
  const q = query.toLowerCase()
  if (!q) return out
  for (let y = 0; y < lines.length && out.length < max; y++) {
    const line = (lines[y] ?? '').toLowerCase()
    for (let i = line.indexOf(q); i >= 0 && out.length < max; i = line.indexOf(q, i + q.length)) out.push([y, i, i + q.length])
  }
  return out
}

// ─── Menus ──────────────────────────────────────────────────────────────────

export type MenuItem = {
  id: string
  label: string
  /** Coche : true cochée, false décochée (la place reste), absente pour une action. */
  check?: boolean
  hint?: string
  sub?: MenuItem[]
  isSeparator?: boolean
  isDisabled?: boolean
}

const SEP: MenuItem = { id: '-', label: '', isSeparator: true }

export const explorerLabel = (os: Os) =>
  os === 'windows' ? "Afficher dans l'Explorateur" : os === 'mac' ? 'Afficher dans le Finder' : 'Afficher dans le gestionnaire de fichiers'

/** Le menu ⋮ : les options d'affichage, cochées comme dans l'app desktop. */
export function viewMenu(o: Options): MenuItem[] {
  return [
    { id: 'opt:showTree', label: "Afficher l'arborescence de fichiers", check: o.showTree, hint: 'Ctrl+Maj+Y' },
    SEP,
    { id: 'opt:previewTabs', label: "Onglets d'aperçu", check: o.previewTabs },
    { id: 'opt:autoSave', label: 'Enregistrement automatique', check: o.autoSave },
    { id: 'opt:tabIndents', label: 'La touche Tab indente', check: o.tabIndents },
    SEP,
    { id: 'opt:wordWrap', label: 'Retour à la ligne automatique', check: o.wordWrap },
    { id: 'opt:indentGuides', label: "Repères d'indentation", check: o.indentGuides },
    { id: 'opt:showWhitespace', label: 'Afficher les espaces', check: o.showWhitespace },
    { id: 'opt:scrollBeyondLastLine', label: 'Défilement au-delà de la fin', check: o.scrollBeyondLastLine },
    {
      id: 'tabSize',
      label: 'Taille de tabulation',
      hint: String(o.tabSize),
      sub: TAB_SIZES.map((n) => ({ id: `tabSize:${n}`, label: String(n), check: o.tabSize === n })),
    },
  ]
}

const copyMenu = (isDir: boolean): MenuItem => ({
  id: 'copy',
  label: 'Copier',
  sub: [
    { id: 'copy:abs', label: 'Chemin absolu' },
    { id: 'copy:rel', label: 'Chemin relatif' },
    { id: 'copy:name', label: isDir ? 'Nom du dossier' : 'Nom du fichier' },
  ],
})

/** Les applications qui ouvrent aussi un dossier. */
const FOLDER_APPS = new Set(['default', 'code', 'cursor'])

const openInMenu = (apps: readonly App[], isDir: boolean): MenuItem => {
  const list = apps.filter((a) => !isDir || FOLDER_APPS.has(a.id))
  return {
    id: 'openIn',
    label: 'Ouvrir dans',
    sub: list.length ? list.map((a) => ({ id: `openIn:${a.id}`, label: a.label })) : [{ id: 'none', label: 'Recherche des applications…', isDisabled: true }],
  }
}

/** Le menu d'une entrée de l'arborescence (clic droit). */
export function entryMenu(isDir: boolean, apps: readonly App[], os: Os): MenuItem[] {
  return [
    { id: 'attach', label: 'Joindre comme contexte' },
    copyMenu(isDir),
    SEP,
    openInMenu(apps, isDir),
    { id: 'reveal', label: explorerLabel(os) },
    ...(isDir ? [] : [SEP, { id: 'copyContent', label: 'Copier le contenu du fichier' }]),
  ]
}

/** Le menu d'un onglet (clic droit). */
export function tabMenu(isPreview: boolean, apps: readonly App[], os: Os): MenuItem[] {
  return [
    { id: 'attach', label: 'Joindre comme contexte' },
    copyMenu(false),
    SEP,
    openInMenu(apps, false),
    { id: 'reveal', label: explorerLabel(os) },
    SEP,
    { id: 'revealInTree', label: "Afficher dans l'arborescence de fichiers" },
    SEP,
    { id: 'find', label: 'Rechercher dans le fichier', hint: 'Ctrl+F' },
    { id: 'copyContent', label: 'Copier le contenu du fichier' },
    { id: 'reload', label: 'Recharger le fichier' },
    SEP,
    { id: 'keepOpen', label: 'Garder ouvert', isDisabled: !isPreview },
    { id: 'close', label: 'Fermer le fichier' },
  ]
}

/** La largeur intérieure d'un menu : coche, libellé, indice ou flèche. */
export function menuWidth(items: readonly MenuItem[]): number {
  let w = 10
  for (const it of items) {
    if (it.isSeparator) continue
    const tail = it.sub ? 2 + (it.hint ? strWidth(it.hint) + 1 : 0) : it.hint ? strWidth(it.hint) + 2 : 0
    w = Math.max(w, 2 + strWidth(it.label) + tail + 1)
  }
  return w + 1
}
