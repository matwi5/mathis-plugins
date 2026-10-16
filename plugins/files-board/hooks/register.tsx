// Navigateur de fichiers (/files) pour Claude Code CLI, à la manière de celui de l'app desktop :
// arborescence, recherche de fichiers, onglets d'aperçu, éditeur, menus contextuels, options.
//
// - Ce module est le seul à parler au moteur (`$`) : état, fichiers, presse-papiers, prompt,
//   applications externes. La région interactive (browser.tsx) dessine et lit le clavier et la
//   souris ; elle demande tout le reste par messages (`ui.message`), accusés par `seen`.
// - Terminal seulement : ailleurs (app desktop, VS Code, mobile), le panneau le dit en une ligne.
// - `/files-board:files` (commands/files.md) est connue dès le premier message ; `/files`,
//   déclarée au démarrage, sort du menu mais reste utilisable tapée en entier.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { App, Doc, DocView, Entry, Find, Listing, Op, OptionKey, Options, Os, Platform, Post, Reveal, Seen, Tab, View, Wheel } from '../types'
import {
  DEFAULT_OPTIONS,
  EDIT_LIMIT,
  MAX_ENTRIES,
  MAX_INDEX,
  MAX_READ,
  WINDOW_CHARS,
  WINDOW_LINES,
  ancestors,
  baseName,
  clamp,
  compareNames,
  flattenRows,
  folderName,
  joinRel,
  mention,
  normalizeOptions,
  relFrom,
  resolveFrom,
  searchPaths,
  toAbs,
} from './model.ts'

const PANE = 'files'
const TITLE = 'Fichiers'
/** La commande déclarée par `commands/files.md`, préfixée du nom du plugin. */
const STATIC_FILES = 'files-board:files'
const ARG_HINT = '[dossier|fichier|toggle|close]'
/** La clé de la région dans le panneau : `$.ui.focus` la vise. */
const CLIENT_KEY = 'browser'

const EMPTY_FIND: Find = { query: '', results: [], total: 0, isLoading: false }

// Gardés par l'hôte : survivent au rechargement à chaud du module.
const rootAtom = atom({ plugin: 'files-board', key: 'root' } as const, null as string | null)
const expandedAtom = atom({ plugin: 'files-board', key: 'expanded' } as const, [] as string[])
const listingsAtom = atom({ plugin: 'files-board', key: 'listings' } as const, {} as Record<string, Listing>)
const tabsAtom = atom({ plugin: 'files-board', key: 'tabs' } as const, [] as Tab[])
const activeAtom = atom({ plugin: 'files-board', key: 'active' } as const, null as string | null)
const docsAtom = atom({ plugin: 'files-board', key: 'docs' } as const, {} as Record<string, Doc>)
const findAtom = atom({ plugin: 'files-board', key: 'find' } as const, EMPTY_FIND)
const optionsAtom = atom({ plugin: 'files-board', key: 'options' } as const, DEFAULT_OPTIONS)
const seenAtom = atom({ plugin: 'files-board', key: 'seen' } as const, { inst: '', seq: 0 } as Seen)
const wheelAtom = atom({ plugin: 'files-board', key: 'wheel' } as const, { n: 0, by: 0, column: 0, row: 0 } as Wheel)
const revealAtom = atom({ plugin: 'files-board', key: 'reveal' } as const, { path: '', n: 0 } as Reveal)
const maximizedAtom = atom({ plugin: 'files-board', key: 'isMaximized' } as const, false)
const platformAtom = atom({ plugin: 'files-board', key: 'platform' } as const, { os: 'linux', sep: '/', apps: [], isReady: false } as Platform)
const touchedAtom = atom({ plugin: 'files-board', key: 'touched' } as const, [] as string[])

// Outils après lesquels des fichiers ont pu changer.
const WRITERS = new Set(['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** Plafond des fichiers marqués « modifié par Claude » : les props de la région sont bornées. */
const MAX_TOUCHED = 200
// Dossiers sautés quand la recherche parcourt le disque (hors dépôt git).
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build', 'target', '.cache'])

// État du module, perdu au rechargement : rien que des caches.
let chain: Promise<void> = Promise.resolve()
let fileIndex: { root: string; paths: string[] } | null = null
/** Les lignes des fichiers trop gros pour la région, lues par fenêtres. */
const bigDocs = new Map<string, string[]>()
let refreshTimer: { cancel: () => void } | null = null
let viewport = { columns: 120, rows: 40 }
let optionsLoaded = false

type Run = { exitCode: number; stdout: string; stderr: string }

/** Un effet raté (pas d'écran, surface sans panneau, prompt occupé) ne doit rien emporter. */
async function quietly<T>(effect: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await effect()
  } catch {
    return undefined
  }
}

const short = (err: unknown) => String((err as { message?: unknown })?.message ?? err).split('\n')[0]?.slice(0, 200) ?? ''
const toast = ($: any, text: string) => quietly(() => $.ui.toast(text))

// ─── Commande /files ────────────────────────────────────────────────────────

const answerFiles = async ($: any, e: { args: string; origin?: { kind: string }; presentation?: { columns: number; isFullscreen: boolean } }) => {
  const surfaces: readonly string[] = (await quietly(() => $.session.surfaces())) ?? []
  if (!surfaces.includes('terminal')) {
    return { text: "Le navigateur de fichiers files-board est réservé à Claude Code CLI (terminal) : l'app desktop a déjà le sien." }
  }
  // Lancée par un autre plugin (le bouton « Fichiers » du pied du prompt) : pas de ligne dans
  // la conversation, ni de texte pour le modèle.
  const isQuiet = e.origin?.kind === 'plugin'
  let arg = e.args.trim()
  if (/^toggle$/i.test(arg)) {
    const panes: readonly { id: string }[] = (await quietly(() => $.ui.panes())) ?? []
    if (panes.some((p) => p.id === PANE)) arg = 'close'
    else arg = ''
  }
  if (/^(close|fermer)$/i.test(arg)) {
    await quietly(() => $.ui.close({ id: PANE }))
    return isQuiet ? {} : { text: 'Navigateur de fichiers fermé.' }
  }
  await loadOptions($)
  const p = await quickPlatform($)
  let text = 'Navigateur de fichiers ouvert.'
  if (arg) {
    const cwd: string = await $.session.cwd()
    let target = arg
    if (/^~([\\/]|$)/.test(arg)) {
      const home = (await quietly(() => $.env.get('USERPROFILE'))) ?? (await quietly(() => $.env.get('HOME')))
      if (home) target = `${home}${arg.slice(1)}`
    }
    const abs = resolveFrom(cwd, target, p.sep)
    const stat = await quietly(() => $.fs.stat(abs))
    if (!stat) return { text: `Introuvable : ${abs}` }
    if (stat.kind === 'dir') {
      await setRoot($, abs)
      text = `Navigateur de fichiers ouvert sur ${abs}.`
    } else {
      let rel = relFrom(await rootOf($), abs, p.os)
      if (rel === null) {
        await setRoot($, abs.slice(0, Math.max(abs.lastIndexOf('\\'), abs.lastIndexOf('/'))) || abs)
        rel = relFrom(await rootOf($), abs, p.os) ?? baseName(abs.replace(/\\/g, '/'))
      }
      await openFile($, rel, false)
      await revealInTree($, rel)
      text = `${rel} ouvert dans le navigateur de fichiers.`
    }
  }
  await ensureListings($)
  if (e.presentation) viewport = { ...viewport, columns: e.presentation.columns }
  await quietly(() => $.ui.open({ id: PANE, title: TITLE, focus: true, ...paneSize(false) }))
  // La région prend le clavier après un clic ; on essaie aussi de lui passer le focus d'emblée.
  const focused = await quietly(() => $.ui.focus({ requestId: PANE, key: CLIENT_KEY }))
  if (focused?.deny) await quietly(() => $.ui.log(`focus de la région refusé : ${focused.deny}`, { to: 'debug' }))
  if (e.presentation && !e.presentation.isFullscreen) {
    text += " Affichage principal : la souris n'atteint pas le navigateur ; l'affichage plein écran (par défaut) est conseillé."
  }
  // Les applications de « Ouvrir dans » se cherchent en arrière-plan.
  $.clock.after(0, () => void platform($))
  return isQuiet ? {} : { text }
}

// `/files` reste utilisable tapée en entier, mais sort du menu : `/files-board:files`, déjà là
// avant le premier message, y suffit et le doublon disparaît.
const hideDuplicate = async ($: any, e: any, next: any) => ({ ...(await next(e)), isHidden: true })

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await quietly(() =>
      $.command.register({
        name: 'files',
        description: 'Navigateur de fichiers : arborescence, recherche, onglets, éditeur',
        argumentHint: ARG_HINT,
      }),
    )
    await loadOptions($)
    // Toutes les 4 s, panneau ouvert : les fichiers changés hors de la session.
    $.clock.every(4000, () => void watch($))
    return result
  })

  on('command.run', { command: 'files' }, answerFiles)
  on('command.describe', { command: 'files' }, hideDuplicate)
  // En panne, le mod s'efface : la commande statique dit alors qu'il n'est pas actif.
  on('command.run', { command: STATIC_FILES }, answerFiles).catch(() => undefined)

  // Claude modifie des fichiers : les onglets et l'arborescence se relisent juste après. Le
  // fichier nommé par l'appel (Edit, Write, MultiEdit, NotebookEdit) est marqué avant la relecture,
  // qui sait ainsi que c'est Claude ; Bash et PowerShell ne nomment pas de fichier : relecture seule.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (!WRITERS.has(String(e.tool))) return result
    const r = result as { deny?: unknown; isError?: unknown } | undefined
    if (!r?.deny && !r?.isError) await quietly(() => markTouched($, e as unknown as Record<string, unknown>))
    schedule($)
    return result
  }).catch(() => undefined)

  // Les marques « modifié par Claude » durent jusqu'au message suivant de la personne (tapé ou
  // envoyé par Remote Control) ; une commande comme /files ne les efface pas.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    if ((kind === 'composer' || kind === 'bridge') && !e.command) await quietly(() => clearTouched($))
    return next(e)
  }).catch(() => undefined)

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e) as any
    const { Box, Text } = elements
    if (e.surface !== 'terminal') {
      return <Text dimColor>Le navigateur de fichiers files-board est réservé à Claude Code CLI (terminal).</Text>
    }
    if (e.viewport) viewport = { columns: e.viewport.columns, rows: e.viewport.rows }
    const view = await buildView($, e.props.bodyColumns, e.props.scroll.bodyRows, e.viewport?.isFullscreen !== false)
    const { Client } = elements
    return (
      <Box flexDirection="column">
        <Client key={CLIENT_KEY} module="./browser.tsx" props={view} width={e.props.bodyColumns} height={e.props.scroll.bodyRows} />
      </Box>
    )
  })

  // La molette sur le panneau : relayée à la région, qui défile elle-même (le panneau, lui, tient
  // tout entier dans son cadre et n'a rien à faire défiler).
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || !e.pointer) return next(e)
    const { column, row } = e.pointer
    await update($, wheelAtom, (w) => ({ n: w.n + 1, by: e.by, column, row }))
    return {}
  }).catch(() => undefined)

  // Les demandes de la région, une à la fois, dans l'ordre de leurs numéros.
  on('ui.message', async ($, e) => {
    const post = asPost(e.data)
    if (!post) return {}
    const job = chain.then(() => handlePost($, post, e.surface))
    chain = job.catch(() => undefined)
    await job.catch(() => undefined)
    return {}
  })
}

// ─── Vue de la région ───────────────────────────────────────────────────────

async function buildView($: any, columns: number, lines: number, isFullscreen: boolean): Promise<View> {
  const root = await rootOf($)
  const p = await read($, platformAtom)
  const sep = p.isReady ? p.sep : guessSep(root)
  const os = p.isReady ? p.os : guessOs(root)
  const options = await read($, optionsAtom)
  const expanded = await read($, expandedAtom)
  const listings = await read($, listingsAtom)
  const tabs = await read($, tabsAtom)
  const active = await read($, activeAtom)
  const docs = await read($, docsAtom)
  const flat = flattenRows(listings, new Set(expanded))
  const doc = active ? docs[active] : undefined
  const view: View = {
    root,
    rootName: folderName(root),
    sep,
    os,
    options,
    rows: flat.rows,
    rowsHidden: flat.hidden,
    find: await read($, findAtom),
    tabs,
    active,
    dirty: tabs.filter((t) => docs[t.path]?.draft != null).map((t) => t.path),
    touched: await touchedRel($, root, os),
    doc: doc ? docView(doc) : null,
    ack: await read($, seenAtom),
    wheel: await read($, wheelAtom),
    reveal: await read($, revealAtom),
    apps: p.apps,
    isMaximized: await read($, maximizedAtom),
    isFullscreen,
    columns,
    lines,
  }
  // Les props de la région sont bornées (100 000 caractères) : l'arborescence cède la place.
  while (view.rows.length > 50 && JSON.stringify(view).length > 95_000) {
    const keep = Math.floor(view.rows.length * 0.7)
    view.rowsHidden += view.rows.length - keep
    view.rows = view.rows.slice(0, keep)
  }
  return view
}

function docView(d: Doc): DocView {
  return {
    path: d.path,
    state: d.state,
    error: d.error,
    text: d.state === 'ready' ? (d.draft ?? d.text) : '',
    isDirty: d.draft != null,
    rev: d.rev,
    origin: d.origin,
    changedOnDisk: d.changedOnDisk,
    lineCount: d.lineCount,
    window: d.window,
    size: d.size,
    eol: d.eol,
  }
}

// ─── Demandes de la région ──────────────────────────────────────────────────

function asPost(data: unknown): Post | null {
  if (!data || typeof data !== 'object') return null
  const { inst, ops } = data as { inst?: unknown; ops?: unknown }
  if (typeof inst !== 'string' || !Array.isArray(ops)) return null
  return { inst, ops: ops.filter((o) => o && typeof o === 'object' && typeof o.seq === 'number' && typeof o.k === 'string') }
}

async function handlePost($: any, post: Post, surface: string) {
  let seen = await read($, seenAtom)
  if (seen.inst !== post.inst) seen = { inst: post.inst, seq: 0 }
  const ops = post.ops.filter((o) => o.seq > seen.seq).sort((a, b) => a.seq - b.seq)
  for (const op of ops) {
    try {
      await applyOp($, op, post.inst, op.seq, surface)
    } catch (err) {
      await toast($, `Fichiers : ${short(err)}`)
    }
    seen = { inst: post.inst, seq: op.seq }
    // Accusée au fil de l'eau : la région retire l'opération de sa file dès le redessin.
    await update($, seenAtom, () => seen)
  }
  if ((await read($, seenAtom)).inst !== post.inst) await update($, seenAtom, () => seen)
}

async function applyOp($: any, op: Op, inst: string, seq: number, surface: string) {
  switch (op.k) {
    case 'toggle':
      return toggleDir($, op.path)
    case 'expand':
      return expandDirs($, op.paths)
    case 'open':
      return openFile($, op.path, op.preview)
    case 'activate':
      if ((await read($, tabsAtom)).some((t) => t.path === op.path)) await update($, activeAtom, () => op.path)
      return
    case 'pin':
      return pinTab($, op.path)
    case 'close':
      return closeTab($, op.path)
    case 'save':
      return saveDoc($, op.path, op.text, `save:${inst}:${seq}`)
    case 'draft':
      return setDraft($, op.path, op.text)
    case 'reload':
      return reloadDoc($, op.path, true)
    case 'keep':
      return patchDoc($, op.path, { changedOnDisk: false })
    case 'window':
      return moveWindow($, op.path, op.from)
    case 'find':
      return runFind($, op.query)
    case 'option':
      return setOption($, op.key, op.value)
    case 'act':
      return act($, op.id, op.path, op.isDir, surface)
    case 'pane':
      return op.what === 'close' ? quietly(() => $.ui.close({ id: PANE })) : toggleMaximized($)
    case 'refresh':
      fileIndex = null
      return refreshAll($)
  }
}

// ─── Racine, plateforme, options ────────────────────────────────────────────

const guessSep = (root: string): '\\' | '/' => (/^[A-Za-z]:|\\/.test(root) ? '\\' : '/')
const guessOs = (root: string): Os => (guessSep(root) === '\\' ? 'windows' : 'linux')

async function rootOf($: any): Promise<string> {
  return (await read($, rootAtom)) ?? (await $.session.cwd())
}

/** Le séparateur et le système, sans attendre la recherche des applications. */
async function quickPlatform($: any): Promise<{ os: Os; sep: '\\' | '/' }> {
  const p = await read($, platformAtom)
  if (p.isReady) return p
  const cwd: string = await $.session.cwd()
  return { os: guessOs(cwd), sep: guessSep(cwd) }
}

async function run($: any, argv: string[], timeoutMs = 15_000, cwd?: string): Promise<Run> {
  try {
    return await $.process.run(argv, { timeoutMs, ...(cwd ? { cwd } : {}) })
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: short(err) }
  }
}

/** Le système et les applications de « Ouvrir dans », cherchées une fois par session. */
async function platform($: any): Promise<Platform> {
  const known = await read($, platformAtom)
  if (known.isReady) return known
  const { sep } = await quickPlatform($)
  const osEnv = await quietly(() => $.env.get('OS'))
  let os: Os = osEnv === 'Windows_NT' || sep === '\\' ? 'windows' : 'linux'
  if (os !== 'windows' && /darwin/i.test((await run($, ['uname', '-s'], 5000)).stdout)) os = 'mac'
  const has = async (cmd: string) => (await run($, [os === 'windows' ? 'where' : 'which', cmd], 5000)).exitCode === 0
  const apps: App[] = [{ id: 'default', label: 'Application par défaut' }]
  if (await has('code')) apps.push({ id: 'code', label: 'Visual Studio Code' })
  if (await has('cursor')) apps.push({ id: 'cursor', label: 'Cursor' })
  if (os === 'windows') apps.push({ id: 'notepad', label: 'Bloc-notes' })
  if (os === 'mac') apps.push({ id: 'textedit', label: 'TextEdit' })
  const next: Platform = { os, sep, apps, isReady: true }
  await update($, platformAtom, () => next)
  return next
}

/** Les options du menu ⋮, gardées d'une session à l'autre. */
async function loadOptions($: any) {
  if (optionsLoaded) return
  optionsLoaded = true
  const stored = await quietly(() => $.store.get('options'))
  if (stored !== undefined) await update($, optionsAtom, () => normalizeOptions(stored))
}

async function setOption($: any, key: OptionKey, value: boolean | number) {
  const next: Options = normalizeOptions({ ...(await read($, optionsAtom)), [key]: value })
  await update($, optionsAtom, () => next)
  await quietly(() => $.store.set('options', next))
}

async function setRoot($: any, abs: string) {
  const old = await rootOf($)
  if (old === abs) return
  const { os, sep } = await quickPlatform($)
  // Les onglets suivent la nouvelle racine quand leur fichier est dessous ; les autres se ferment.
  const tabs = await read($, tabsAtom)
  const docs = await read($, docsAtom)
  const moved: Tab[] = []
  const movedDocs: Record<string, Doc> = {}
  let lost = 0
  for (const t of tabs) {
    const rel = relFrom(abs, toAbs(old, t.path, sep), os)
    if (rel === null || rel === '') {
      if (docs[t.path]?.draft != null) lost += 1
      continue
    }
    moved.push({ ...t, path: rel })
    const d = docs[t.path]
    if (d) movedDocs[rel] = { ...d, path: rel }
  }
  const active = await read($, activeAtom)
  const activeRel = active ? relFrom(abs, toAbs(old, active, sep), os) : null
  await update($, rootAtom, () => abs)
  await update($, expandedAtom, () => [])
  await update($, listingsAtom, () => ({}))
  await update($, findAtom, () => EMPTY_FIND)
  await update($, tabsAtom, () => moved)
  await update($, docsAtom, () => movedDocs)
  await update($, activeAtom, () => (activeRel && moved.some((t) => t.path === activeRel) ? activeRel : (moved[0]?.path ?? null)))
  bigDocs.clear()
  fileIndex = null
  if (lost) await toast($, `${lost} brouillon(s) hors du nouveau dossier abandonné(s).`)
}

// ─── Arborescence ───────────────────────────────────────────────────────────

async function loadListing($: any, root: string, rel: string, sep: string): Promise<Listing> {
  try {
    const raw: { name: string; kind: string; isLink: boolean }[] = await $.fs.list(toAbs(root, rel, sep))
    const entries: Entry[] = []
    for (const e of raw) {
      let kind: Entry['kind'] = e.kind === 'dir' ? 'dir' : 'file'
      if (e.kind === 'other' && e.isLink) {
        const st = await quietly(() => $.fs.stat(toAbs(root, joinRel(rel, e.name), sep)))
        if (st?.kind === 'dir') kind = 'dir'
      }
      entries.push({ name: e.name, kind })
    }
    entries.sort((a, b) => compareNames(a.name, b.name))
    return { entries: entries.slice(0, MAX_ENTRIES), hidden: Math.max(0, entries.length - MAX_ENTRIES), error: null }
  } catch (err) {
    return { entries: [], hidden: 0, error: `Lecture impossible : ${short(err)}` }
  }
}

/** Lit les dossiers affichés qui ne le sont pas encore (la racine et les dossiers dépliés). */
async function ensureListings($: any) {
  const root = await rootOf($)
  const { sep } = await quickPlatform($)
  const listings = await read($, listingsAtom)
  const missing = ['', ...(await read($, expandedAtom))].filter((d) => !listings[d])
  if (!missing.length) return
  const loaded = await Promise.all(missing.map((d) => loadListing($, root, d, sep)))
  await update($, listingsAtom, (l) => {
    const next = { ...l }
    missing.forEach((d, i) => {
      next[d] = loaded[i]!
    })
    return next
  })
}

async function toggleDir($: any, path: string) {
  const expanded = await read($, expandedAtom)
  if (expanded.includes(path)) await update($, expandedAtom, (x) => x.filter((p) => p !== path))
  else await update($, expandedAtom, (x) => [...x, path])
  await ensureListings($)
}

async function expandDirs($: any, paths: string[]) {
  await update($, expandedAtom, (x) => [...new Set([...x, ...paths.filter(Boolean)])])
  await ensureListings($)
}

/** Montre `path` dans l'arborescence : ses dossiers dépliés, la région le sélectionne. */
async function revealInTree($: any, path: string) {
  await expandDirs($, ancestors(path))
  const options = await read($, optionsAtom)
  if (!options.showTree) await setOption($, 'showTree', true)
  await update($, revealAtom, (r) => ({ path, n: r.n + 1 }))
}

// ─── Documents ──────────────────────────────────────────────────────────────

const emptyDoc = (path: string): Doc => ({
  path,
  state: 'loading',
  error: null,
  text: '',
  draft: null,
  eol: '\n',
  rev: 0,
  origin: 'disk',
  changedOnDisk: false,
  lineCount: 0,
  window: null,
  size: 0,
  mtimeMs: 0,
})

/** Une fenêtre de lignes d'un fichier volumineux, bornée en lignes et en caractères. */
function windowOf(lines: readonly string[], from: number) {
  const start = clamp(from, 0, Math.max(0, lines.length - 1))
  const out: string[] = []
  let size = 0
  for (let i = start; i < lines.length && out.length < WINDOW_LINES && size < WINDOW_CHARS; i++) {
    const line = lines[i] ?? ''
    const shown = line.length > 2000 ? `${line.slice(0, 2000)}…` : line
    out.push(shown)
    size += shown.length + 1
  }
  return { from: start, text: out.join('\n') }
}

/** Le fichier tel qu'il est sur le disque, à partir du document connu (son brouillon gardé). */
async function readDoc($: any, path: string, prev: Doc | undefined): Promise<Doc> {
  const root = await rootOf($)
  const { sep } = await quickPlatform($)
  const abs = toAbs(root, path, sep)
  const base = prev ?? emptyDoc(path)
  const fail = (error: string, size = 0): Doc => ({ ...base, state: 'error', error, text: '', window: null, rev: base.rev + 1, origin: 'disk', size })
  const stat = await quietly(() => $.fs.stat(abs))
  if (!stat) return fail('Fichier introuvable : il a été supprimé ou déplacé.')
  if (stat.kind === 'dir') return fail("C'est un dossier.")
  if (stat.size > MAX_READ) return fail('Fichier trop volumineux (plus de 4 Mio) : ouvrez-le dans une autre application.', stat.size)
  let raw: string
  try {
    raw = await $.fs.read(abs)
  } catch (err) {
    return fail(`Lecture impossible : ${short(err)}`, stat.size)
  }
  const common = { error: null, rev: base.rev + 1, origin: 'disk', size: stat.size, mtimeMs: stat.mtimeMs, changedOnDisk: false }
  if (raw.slice(0, 8000).includes('\u0000')) {
    bigDocs.delete(path)
    return { ...base, ...common, state: 'binary', text: '', window: null, lineCount: 0 }
  }
  const eol: Doc['eol'] = raw.includes('\r\n') ? '\r\n' : '\n'
  const text = raw.replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  if (JSON.stringify(text).length > EDIT_LIMIT) {
    bigDocs.set(path, lines)
    return { ...base, ...common, state: 'large', text: '', draft: null, eol, lineCount: lines.length, window: windowOf(lines, base.window?.from ?? 0) }
  }
  bigDocs.delete(path)
  return { ...base, ...common, state: 'ready', text, eol, lineCount: lines.length, window: null }
}

async function setDoc($: any, doc: Doc) {
  await update($, docsAtom, (d) => ({ ...d, [doc.path]: doc }))
}

async function patchDoc($: any, path: string, patch: Partial<Doc>) {
  const doc = (await read($, docsAtom))[path]
  if (doc) await setDoc($, { ...doc, ...patch })
}

async function openFile($: any, path: string, preview: boolean) {
  const options = await read($, optionsAtom)
  const isPreview = preview && options.previewTabs
  const tabs = await read($, tabsAtom)
  const docs = await read($, docsAtom)
  let next: Tab[]
  if (tabs.some((t) => t.path === path)) {
    // Ouvert pour de bon (double clic, Entrée) : l'onglet d'aperçu est épinglé.
    next = tabs.map((t) => (t.path === path && t.isPreview && !isPreview ? { ...t, isPreview: false } : t))
  } else {
    const tab: Tab = { path, isPreview }
    // Un nouvel aperçu prend la place de l'ancien, s'il n'a pas de modifications.
    const old = isPreview ? tabs.findIndex((t) => t.isPreview && docs[t.path]?.draft == null) : -1
    next = [...tabs]
    if (old >= 0) next[old] = tab
    else {
      // Le nouvel onglet se place juste après l'onglet actif.
      const current = await read($, activeAtom)
      const at = tabs.findIndex((t) => t.path === current)
      next.splice(at < 0 ? tabs.length : at + 1, 0, tab)
    }
  }
  const keep = new Set(next.map((t) => t.path))
  await update($, tabsAtom, () => next)
  await update($, activeAtom, () => path)
  await update($, docsAtom, (d) => Object.fromEntries(Object.entries(d).filter(([p]) => keep.has(p))))
  for (const p of bigDocs.keys()) if (!keep.has(p)) bigDocs.delete(p)
  const doc = (await read($, docsAtom))[path]
  if (!doc || doc.state === 'error') {
    await setDoc($, emptyDoc(path))
    await setDoc($, await readDoc($, path, doc))
  }
}

async function pinTab($: any, path: string) {
  const tabs = await read($, tabsAtom)
  if (tabs.some((t) => t.path === path && t.isPreview)) await update($, tabsAtom, (x) => x.map((t) => (t.path === path ? { ...t, isPreview: false } : t)))
}

async function closeTab($: any, path: string) {
  const tabs = await read($, tabsAtom)
  const i = tabs.findIndex((t) => t.path === path)
  if (i < 0) return
  const next = tabs.filter((t) => t.path !== path)
  await update($, tabsAtom, () => next)
  if ((await read($, activeAtom)) === path) await update($, activeAtom, () => next[Math.min(i, next.length - 1)]?.path ?? null)
  await update($, docsAtom, (d) => Object.fromEntries(Object.entries(d).filter(([p]) => p !== path)))
  bigDocs.delete(path)
}

async function saveDoc($: any, path: string, text: string, origin: string) {
  const doc = (await read($, docsAtom))[path]
  const root = await rootOf($)
  const { sep } = await quickPlatform($)
  const abs = toAbs(root, path, sep)
  const eol = doc?.eol ?? '\n'
  try {
    await $.fs.write(abs, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text)
  } catch (err) {
    // Rien n'est perdu : le texte reste en brouillon.
    if (doc) await setDoc($, { ...doc, draft: text })
    await toast($, `Enregistrement impossible : ${short(err)}`)
    return
  }
  const stat = await quietly(() => $.fs.stat(abs))
  const base = doc ?? emptyDoc(path)
  await setDoc($, {
    ...base,
    state: 'ready',
    error: null,
    text,
    draft: null,
    rev: base.rev + 1,
    origin,
    changedOnDisk: false,
    lineCount: text.split('\n').length,
    mtimeMs: stat?.mtimeMs ?? base.mtimeMs,
    size: stat?.size ?? text.length,
  })
  await pinTab($, path)
}

async function setDraft($: any, path: string, text: string | null) {
  await patchDoc($, path, { draft: text })
  // Modifier un aperçu le garde ouvert, comme dans l'app desktop.
  if (text !== null) await pinTab($, path)
}

/**
 * Relit un document ; `force` abandonne le brouillon (Recharger le fichier). `byClaude` : Claude
 * vient de modifier le fichier, la région le dit (« Rechargé : modifié par Claude »).
 */
async function reloadDoc($: any, path: string, force: boolean, byClaude = false) {
  const doc = (await read($, docsAtom))[path]
  if (!doc) return
  const fresh = await readDoc($, path, doc)
  if (force || doc.draft == null) {
    const origin = byClaude && !force && fresh.state !== 'error' ? 'claude' : fresh.origin
    return setDoc($, { ...fresh, origin, draft: null, changedOnDisk: false })
  }
  if (fresh.state === 'ready' && fresh.text === doc.text) return setDoc($, { ...doc, mtimeMs: fresh.mtimeMs, size: fresh.size })
  // Un brouillon est en cours : le disque est retenu, la région propose de recharger.
  await setDoc($, { ...fresh, draft: doc.draft, rev: doc.rev, origin: doc.origin, changedOnDisk: true })
}

async function moveWindow($: any, path: string, from: number) {
  const doc = (await read($, docsAtom))[path]
  if (!doc || doc.state !== 'large') return
  let lines = bigDocs.get(path)
  if (!lines) {
    // Cache perdu (rechargement du module) : on relit le fichier.
    const fresh = await readDoc($, path, doc)
    await setDoc($, fresh)
    lines = bigDocs.get(path)
    if (!lines) return
  }
  await setDoc($, { ...((await read($, docsAtom))[path] ?? doc), window: windowOf(lines, from) })
}

// ─── Recherche de fichiers ──────────────────────────────────────────────────

async function runFind($: any, query: string) {
  if (!query.trim()) return update($, findAtom, () => EMPTY_FIND)
  await update($, findAtom, (f) => ({ ...f, query, isLoading: true }))
  const { results, total } = searchPaths(await indexOf($), query.trim())
  await update($, findAtom, () => ({ query, results, total, isLoading: false }))
}

/** Les chemins du dossier : `git ls-files` dans un dépôt, sinon un parcours du disque. */
async function indexOf($: any): Promise<string[]> {
  const root = await rootOf($)
  if (fileIndex && fileIndex.root === root) return fileIndex.paths
  const git = await run($, ['git', '-c', 'core.quotepath=off', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], 30_000, root)
  const files = git.exitCode === 0 ? git.stdout.split('\0').filter(Boolean).slice(0, MAX_INDEX) : await walk($, root)
  const dirs = new Set<string>()
  for (const f of files) for (const a of ancestors(f)) dirs.add(a)
  const paths = [...files, ...[...dirs].map((d) => `${d}/`)]
  fileIndex = { root, paths }
  return paths
}

async function walk($: any, root: string): Promise<string[]> {
  const { sep } = await quickPlatform($)
  const out: string[] = []
  const queue = ['']
  let visited = 0
  while (queue.length && out.length < MAX_INDEX && visited < 3000) {
    const dir = queue.shift() ?? ''
    visited += 1
    const entries: { name: string; kind: string }[] = (await quietly(() => $.fs.list(toAbs(root, dir, sep)))) ?? []
    for (const e of entries) {
      const p = joinRel(dir, e.name)
      if (e.kind === 'dir') {
        if (!SKIP_DIRS.has(e.name)) queue.push(p)
      } else out.push(p)
    }
  }
  return out
}

// ─── Actions des menus ──────────────────────────────────────────────────────

async function act($: any, id: string, path: string, isDir: boolean, surface: string) {
  const root = await rootOf($)
  const { os, sep } = await quickPlatform($)
  const abs = toAbs(root, path, sep)
  if (id === 'attach') {
    const ref = mention(path, isDir)
    const filled = await quietly(() => $.prompt.fill({ text: `${ref} `, mode: 'insert' }))
    return toast($, filled?.isFilled ? `Joint au prompt : ${ref}` : "Le prompt n'accepte pas de texte pour l'instant (une boîte de dialogue est ouverte ?).")
  }
  if (id === 'copy:abs') return copy($, abs, surface)
  if (id === 'copy:rel') return copy($, path || '.', surface)
  if (id === 'copy:name') return copy($, baseName(path) || folderName(root), surface)
  if (id === 'copyContent') {
    const doc = (await read($, docsAtom))[path]
    const text = doc?.state === 'ready' ? (doc.draft ?? doc.text) : await quietly(() => $.fs.read(abs))
    if (typeof text !== 'string') return toast($, 'Lecture du fichier impossible.')
    return copy($, text, surface, `contenu de ${baseName(path)} (${text.split('\n').length} lignes)`)
  }
  if (id === 'revealInTree') return revealInTree($, path)
  if (id === 'reveal') return launch($, revealArgv(os, abs, isDir), explorerName(os))
  if (id.startsWith('openIn:')) {
    const app = id.slice('openIn:'.length)
    const argv = openArgv(os, app, abs)
    const label = (await read($, platformAtom)).apps.find((a) => a.id === app)?.label ?? app
    return argv ? launch($, argv, label) : toast($, `Application inconnue : ${app}`)
  }
}

async function copy($: any, text: string, surface: string, what?: string) {
  const done = await quietly(() => $.ui.copy({ text, surface }))
  await toast($, done?.isCopied ? `Copié : ${what ?? text}` : `Copie impossible${done?.reason ? ` (${done.reason})` : ''}.`)
}

const explorerName = (os: Os) => (os === 'windows' ? "l'Explorateur" : os === 'mac' ? 'le Finder' : 'le gestionnaire de fichiers')

function revealArgv(os: Os, abs: string, isDir: boolean): string[] {
  if (os === 'windows') return ['explorer.exe', `/select,${abs}`]
  if (os === 'mac') return ['open', '-R', abs]
  return ['xdg-open', isDir ? abs : abs.slice(0, abs.lastIndexOf('/')) || '/']
}

function openArgv(os: Os, app: string, abs: string): string[] | null {
  if (os === 'windows') {
    if (app === 'default') return ['explorer.exe', abs]
    if (app === 'code' || app === 'cursor') return ['cmd', '/c', app, abs]
    // `start` rend la main tout de suite : le Bloc-notes, lui, attendrait sa fermeture.
    if (app === 'notepad') return ['cmd', '/c', 'start', 'notepad.exe', abs]
    return null
  }
  if (os === 'mac') {
    if (app === 'default') return ['open', abs]
    if (app === 'code') return ['open', '-a', 'Visual Studio Code', abs]
    if (app === 'cursor') return ['open', '-a', 'Cursor', abs]
    if (app === 'textedit') return ['open', '-a', 'TextEdit', abs]
    return null
  }
  if (app === 'default') return ['xdg-open', abs]
  if (app === 'code' || app === 'cursor') return [app, abs]
  return null
}

/** Lance une application hors de la file des demandes : elle peut mettre du temps à rendre la main. */
function launch($: any, argv: string[], label: string) {
  $.clock.after(0, async () => {
    const res = await run($, argv, 20_000)
    // L'Explorateur rend un code d'erreur même quand il a ouvert la fenêtre.
    const isExplorer = /explorer\.exe$/i.test(argv[0] ?? '')
    if (res.exitCode !== 0 && !isExplorer) await toast($, `Ouverture dans ${label} impossible : ${res.stderr.split('\n')[0] || `code ${res.exitCode}`}`)
  })
  return toast($, `Ouverture dans ${label}…`)
}

// ─── Panneau ────────────────────────────────────────────────────────────────

function paneSize(isMaximized: boolean) {
  if (isMaximized) return { rows: Math.max(20, viewport.rows - 4), columns: Math.max(80, viewport.columns - 16) }
  return { rows: 32, columns: clamp(Math.round(viewport.columns * 0.62), 90, 150) }
}

async function toggleMaximized($: any) {
  const next = !(await read($, maximizedAtom))
  await update($, maximizedAtom, () => next)
  await quietly(() => $.ui.open({ id: PANE, title: TITLE, ...paneSize(next) }))
}

// ─── Fraîcheur ──────────────────────────────────────────────────────────────

// Après un outil de Claude : une relecture groupée, 400 ms après le dernier.
function schedule($: any) {
  refreshTimer?.cancel()
  refreshTimer = $.clock.after(400, () => {
    refreshTimer = null
    fileIndex = null
    void refreshAll($)
  })
}

async function watch($: any) {
  const panes: readonly { id: string }[] = (await quietly(() => $.ui.panes())) ?? []
  if (panes.some((p) => p.id === PANE)) await refreshAll($)
}

async function refreshAll($: any) {
  await refreshListings($)
  await refreshDocs($)
}

async function refreshListings($: any) {
  const listings = await read($, listingsAtom)
  const dirs = Object.keys(listings)
  if (!dirs.length) return
  const root = await rootOf($)
  const { sep } = await quickPlatform($)
  const fresh = await Promise.all(dirs.map((d) => loadListing($, root, d, sep)))
  const changed = dirs.filter((d, i) => JSON.stringify(listings[d]) !== JSON.stringify(fresh[i]))
  if (!changed.length) return
  await update($, listingsAtom, (l) => {
    const next = { ...l }
    dirs.forEach((d, i) => {
      if (changed.includes(d)) next[d] = fresh[i]!
    })
    return next
  })
}

async function refreshDocs($: any) {
  const docs = await read($, docsAtom)
  const root = await rootOf($)
  const { os, sep } = await quickPlatform($)
  const touched = new Set(await touchedRel($, root, os))
  for (const doc of Object.values(docs)) {
    if (doc.state === 'loading') continue
    const stat = await quietly(() => $.fs.stat(toAbs(root, doc.path, sep)))
    if (stat && stat.mtimeMs === doc.mtimeMs && stat.size === doc.size && doc.state !== 'error') continue
    if (!stat && doc.state === 'error') continue
    await reloadDoc($, doc.path, false, touched.has(doc.path))
  }
}

// ─── Fichiers modifiés par Claude ───────────────────────────────────────────

/** Marque le fichier nommé par un appel d'outil d'écriture (`file_path`, `notebook_path`). */
async function markTouched($: any, input: Record<string, unknown>) {
  const raw = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
  if (!raw.trim()) return
  const { sep } = await quickPlatform($)
  const abs = resolveFrom(await $.session.cwd(), raw, sep)
  await update($, touchedAtom, (t) => [...t.filter((p) => p !== abs), abs].slice(-MAX_TOUCHED))
}

async function clearTouched($: any) {
  if ((await read($, touchedAtom)).length) await update($, touchedAtom, () => [])
  // La note « Rechargé : modifié par Claude » s'efface avec les marques.
  const docs = await read($, docsAtom)
  if (Object.values(docs).some((d) => d.origin === 'claude')) {
    await update($, docsAtom, (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.origin === 'claude' ? { ...v, origin: 'disk' } : v])))
  }
}

/** Les fichiers marqués qui sont sous la racine, relatifs à elle. */
async function touchedRel($: any, root: string, os: Os): Promise<string[]> {
  const out: string[] = []
  for (const abs of await read($, touchedAtom)) {
    const rel = relFrom(root, abs, os)
    if (rel) out.push(rel)
  }
  return out
}
