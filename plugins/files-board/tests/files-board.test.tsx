import { describe, expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'files-board'
const ROOT = '/w'
const NOW = 1_759_510_000_000
const PANE_PROPS = { title: 'Fichiers', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }

const BIG = Array.from({ length: 12000 }, (_, i) => `ligne numéro ${i + 1} du gros fichier`).join('\n')

const FILES: Record<string, string> = {
  '/w/README.md': '# Titre\n\nUn paragraphe.\n\n## Section\n\n- un\n- deux\n',
  '/w/src/app.ts': 'export const x = 1\nfunction f() {\n  return "s"\n}\n',
  '/w/src/util/helpers.ts': 'export const help = () => 42\n',
  '/w/docs/specs/flash-bets.md': '# Flash Bets\n\nParis contextuels.\n',
  '/w/.gitignore': 'node_modules\n',
  '/w/notes windows.txt': 'a\r\nb\r\n',
  '/w/big.txt': BIG,
  '/w/bin.dat': 'abc\u0000def',
}

// Disposition à 110 × 30 : arborescence de 31 colonnes, séparateur, contenu à partir de la
// colonne 32 ; le texte de l'éditeur commence à la colonne 35 (gouttière de 3).
const ROW = { gitignore: 2, big: 3, bin: 4, docs: 5, notes: 6, readme: 7, src: 8, app: 9, util: 10 }
const TEXT_X = 35
const ICON = { find: 102, menu: 104, max: 106, close: 108 }
// Entrées sélectionnables, dans l'ordre (les séparateurs et les entrées grisées sont sautés).
const VIEW = ['showTree', 'previewTabs', 'autoSave', 'tabIndents', 'wordWrap', 'indentGuides', 'showWhitespace', 'scrollBeyondLastLine', 'tabSize']
const ENTRY = ['attach', 'copy', 'openIn', 'reveal', 'copyContent']
const TAB = ['attach', 'copy', 'openIn', 'reveal', 'revealInTree', 'find', 'copyContent', 'reload', 'keepOpen', 'close']
// Un onglet épinglé : « Garder ouvert » est grisé, donc sauté.
const TAB_PINNED = TAB.filter((id) => id !== 'keepOpen')

// Le monde sous le plugin : un disque en mémoire, le prompt, le presse-papiers, les toasts.
function world(on: any, files: Record<string, string> = { ...FILES }, surfaces = ['terminal']) {
  const toasts: string[] = []
  const copies: string[] = []
  const filled: string[] = []
  const runs: string[][] = []
  const opened: any[] = []
  const closed: string[] = []
  const mtimes: Record<string, number> = {}
  // Le moteur rend les chemins absolus à sa façon (`C:\w` sous Windows) : on revient à `/w`.
  const norm = (p: string) => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  const isDir = (p: string) => p === ROOT || Object.keys(files).some((f) => f.startsWith(`${p}/`))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', () => ({ value: {} }))
  on('ui.open', ($: any, e: any) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.focus', () => ({}))
  on('ui.close', ($: any, e: any) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: opened.length && !closed.length ? [{ id: 'files', title: 'Fichiers', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', ($: any, e: any) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('prompt.fill', ($: any, e: any) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('process.run', ($: any, e: any) => {
    runs.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: 'pas de dépôt git' } }
  })
  on('fs.list', ($: any, e: any) => {
    const dir = norm(e.path)
    if (!isDir(dir)) return Promise.reject(new Error(`ENOENT: ${dir}`))
    const names = new Map<string, 'file' | 'dir'>()
    for (const f of Object.keys(files)) {
      if (!f.startsWith(`${dir}/`)) continue
      const rest = f.slice(dir.length + 1)
      names.set(rest.split('/')[0]!, rest.includes('/') ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.stat', ($: any, e: any) => {
    const p = norm(e.path)
    if (files[p] !== undefined) return { value: { kind: 'file', size: files[p]!.length, mtimeMs: mtimes[p] ?? 1, isLink: false } }
    if (isDir(p)) return { value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false } }
    return Promise.reject(new Error(`ENOENT: ${p}`))
  })
  on('fs.read', ($: any, e: any) => {
    const p = norm(e.path)
    if (files[p] === undefined) return Promise.reject(new Error(`ENOENT: ${p}`))
    return { value: files[p] }
  })
  on('fs.write', ($: any, e: any) => {
    const p = norm(e.path)
    files[p] = e.text
    mtimes[p] = (mtimes[p] ?? 1) + 1
    return { value: undefined }
  })
  // Les outils de Claude : le test change le disque lui-même (`touch`) ; un chemin contenant
  // « refus » rend une erreur, comme un Edit raté.
  on('tool.call', ($: any, e: any) =>
    String(e.file_path ?? '').includes('refus') ? { result: {}, text: 'échec', isError: true } : { result: {}, text: 'ok' },
  )
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  const store: Record<string, unknown> = {}
  on('store.get', ($: any, e: any) => ({ value: store[e.key] }))
  on('store.set', ($: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  mock.env(on, {})
  return {
    files,
    store,
    toasts,
    copies,
    filled,
    runs,
    opened,
    closed,
    /** Change un fichier « hors de la session ». */
    touch: (p: string, text: string) => {
      files[p] = text
      mtimes[p] = (mtimes[p] ?? 1) + 10
    },
  }
}

async function open($: any, args = '', columns = 110, rows = 30, surface = 'terminal') {
  await $.session.start({ surface, isInteractive: true, cwd: ROOT })
  await $.command.run({ command: 'files', args })
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: 'files',
    props: { ...PANE_PROPS, bodyColumns: columns, scroll: { offset: 0, bodyRows: rows } },
  })
  if (surface === 'terminal') await ui.resize({ columns, rows, in: 'browser' })
  return ui
}

/** Le texte dessiné par la région, rangée par rangée (les colonnes du corps à la suite). */
async function screen(ui: any): Promise<string> {
  const tree = await ui.drawn({ in: 'browser' })
  const lines: string[] = []
  const textOf = (n: any): string => {
    if (typeof n === 'string') return n
    if (!n || typeof n !== 'object') return ''
    if (n.type === 'Markdown') return `[md:${n.props?.text ?? ''}]`
    return (n.children ?? []).map(textOf).join('')
  }
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'Box' && n.props?.height === 1) lines.push(textOf(n))
    else if (n.type === 'Markdown') lines.push(textOf(n))
    else for (const c of n.children ?? []) walk(c)
  }
  walk(tree)
  return lines.join('\n')
}

/** Les données passées à la région (props du Client). */
async function view(ui: any): Promise<any> {
  const tree = (await ui.drawn()) as any
  return tree.children[0].props.props
}

const click = (ui: any, x: number, y: number, button: 'left' | 'right' | 'middle' = 'left') => ui.pointer({ type: 'down', x, y, button, in: 'browser' })
const key = (ui: any, k: string, mods: Record<string, boolean> = {}) => ui.key({ key: k, ...mods, in: 'browser' })
const type = async (ui: any, text: string) => {
  for (const c of text) await key(ui, c)
}

/** Choisit l'entrée `id` du menu ouvert, par le clavier ; `sub` choisit dans son sous-menu. */
async function pick(ui: any, order: string[], id: string, sub = -1) {
  for (let i = 0; i < order.indexOf(id); i++) await key(ui, 'down')
  await key(ui, 'return')
  if (sub < 0) return
  for (let i = 0; i < sub; i++) await key(ui, 'down')
  await key(ui, 'return')
}

const viewMenu = async (ui: any, id: string, sub = -1) => {
  await click(ui, ICON.menu, 0)
  await pick(ui, VIEW, id, sub)
}

async function openApp(ui: any) {
  await click(ui, 5, ROW.src)
  await click(ui, 7, ROW.app)
}

describe('files-board : panneau et arborescence', () => {
  test("/files ouvre le panneau ; l'arborescence mêle dossiers et fichiers comme le desktop", async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    const s = await screen(ui)
    expect(w.opened[0]).toMatchObject({ id: 'files', title: 'Fichiers', focus: true })
    const order = ['.gitignore', 'big.txt', 'bin.dat', 'docs', 'notes windows.txt', 'README.md', 'src'].map((n) => s.indexOf(` ${n}`))
    expect(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]!))).toBe(true)
    expect(s).toContain('Rechercher des fichiers')
    expect(s).toContain('Aucun fichier ouvert')
    for (const glyph of ['≡', '⌕', '⋮', '□', '×']) expect(s.split('\n')[0]).toContain(glyph)
  })

  test('un clic déplie un dossier, la flèche gauche le replie ; une lettre tapée lance la recherche', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await click(ui, 5, ROW.src)
    expect(await screen(ui)).toMatch(/▾ src[\s\S]*app\.ts[\s\S]*▸ util/)
    await key(ui, 'left')
    expect(await screen(ui)).not.toContain('app.ts')
    await key(ui, 'right')
    await key(ui, 'down')
    expect((await view(ui)).rows.join(',')).toContain('fapp.ts')
    await key(ui, 'return')
    expect((await view(ui)).active).toBe('src/app.ts')
    await click(ui, 5, ROW.readme)
    await key(ui, 'h')
    const s = await screen(ui)
    expect(s).toContain('⌕ h')
    expect((await view(ui)).find.query).toBe('h')
  })

  test('hors du terminal, la commande et le panneau disent que le navigateur est réservé au CLI', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on, { ...FILES }, ['desktop'])
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: ROOT })
    const res = await $.command.run({ command: 'files', args: '' })
    expect(res.text).toMatch(/réservé à Claude Code CLI/)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'files', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /réservé à Claude Code CLI/ })).toBeDefined()
  })

  test('/files <fichier> ouvre le fichier et le montre dans l’arborescence ; /files close ferme', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($, 'src/util/helpers.ts')
    const v = await view(ui)
    expect(v.active).toBe('src/util/helpers.ts')
    expect(v.tabs).toEqual([{ path: 'src/util/helpers.ts', isPreview: false }])
    expect(await screen(ui)).toMatch(/▾ util[\s\S]*helpers\.ts/)
    await $.command.run({ command: 'files', args: 'close' })
    expect(w.closed).toEqual(['files'])
  })

  test('/files toggle ouvre le panneau fermé et ferme le panneau ouvert', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
    await $.command.run({ command: 'files-board:files', args: 'toggle' })
    expect(w.opened.map((o) => o.id)).toEqual(['files'])
    expect(w.closed).toEqual([])
    await $.command.run({ command: 'files-board:files', args: 'toggle' })
    expect(w.closed).toEqual(['files'])
  })

  test('étroit : l’arborescence ou le fichier, pas les deux', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($, '', 60, 24)
    await click(ui, 5, ROW.src)
    await click(ui, 7, ROW.app)
    expect(await screen(ui)).toContain('Rechercher des fichiers')
    await key(ui, 'down')
    await key(ui, 'up')
    await key(ui, 'return')
    const s = await screen(ui)
    expect(s).not.toContain('Rechercher des fichiers')
    expect(s).toContain('export const x = 1')
  })
})

describe('files-board : onglets', () => {
  test("onglets d'aperçu : un clic remplace l'aperçu, un double clic l'épingle", async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await openApp(ui)
    expect((await view(ui)).tabs).toEqual([{ path: 'src/app.ts', isPreview: true }])
    await click(ui, 5, ROW.readme)
    expect((await view(ui)).tabs).toEqual([{ path: 'README.md', isPreview: true }])
    await click(ui, 5, ROW.readme)
    expect((await view(ui)).tabs).toEqual([{ path: 'README.md', isPreview: false }])
    await click(ui, 7, ROW.app)
    expect((await view(ui)).tabs).toEqual([
      { path: 'README.md', isPreview: false },
      { path: 'src/app.ts', isPreview: true },
    ])
  })

  test('sans onglets d’aperçu, chaque fichier ouvert garde son onglet', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await viewMenu(ui, 'previewTabs')
    expect((await view(ui)).options.previewTabs).toBe(false)
    await openApp(ui)
    await click(ui, 5, ROW.readme)
    expect((await view(ui)).tabs.map((t: any) => t.isPreview)).toEqual([false, false])
  })

  test('menu d’onglet : garder ouvert, rechercher, afficher dans l’arborescence, fermer', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await click(ui, 5, ROW.readme)
    await click(ui, 4, 0, 'right')
    await pick(ui, TAB, 'keepOpen')
    expect((await view(ui)).tabs[0].isPreview).toBe(false)
    // Rechercher dans le fichier : la barre s'ouvre, l'aperçu Markdown passe au source.
    await click(ui, 4, 0, 'right')
    await pick(ui, TAB_PINNED, 'find')
    await type(ui, 'section')
    expect(await screen(ui)).toContain('1/1')
    await click(ui, 4, 0, 'right')
    await pick(ui, TAB_PINNED, 'close')
    expect((await view(ui)).tabs).toEqual([])
  })

  test('un clic du milieu ou la croix ferme un onglet', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await click(ui, 5, ROW.readme)
    await click(ui, 5, ROW.readme)
    await openApp(ui)
    expect((await view(ui)).tabs).toHaveLength(2)
    await click(ui, 4, 0, 'middle')
    expect((await view(ui)).tabs.map((t: any) => t.path)).toEqual(['src/app.ts'])
    const s = (await screen(ui)).split('\n')[0]!
    await click(ui, s.indexOf('×'), 0)
    expect((await view(ui)).tabs).toEqual([])
  })
})

describe('files-board : éditeur', () => {
  test('frappe, enregistrement automatique une seconde après, onglet épinglé', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await openApp(ui)
    await click(ui, TEXT_X + 5, 3)
    await type(ui, 'Z')
    expect((await screen(ui)).split('\n')[0]).toContain('●')
    expect((await view(ui)).tabs[0].isPreview).toBe(false)
    expect(w.files['/w/src/app.ts']).not.toContain('functZion')
    await ui.advance(1200)
    expect(w.files['/w/src/app.ts']).toBe('export const x = 1\nfunctZion f() {\n  return "s"\n}\n')
    expect(await screen(ui)).toContain('✓ Enregistrement auto')
  })

  test('sans enregistrement automatique : brouillon gardé, Ctrl+S enregistre', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await viewMenu(ui, 'autoSave')
    await openApp(ui)
    await click(ui, TEXT_X, 2)
    await key(ui, 'end')
    await type(ui, ';')
    await ui.advance(2000)
    expect(w.files['/w/src/app.ts']).toBe(FILES['/w/src/app.ts'])
    expect((await view(ui)).dirty).toEqual(['src/app.ts'])
    await key(ui, 's', { ctrl: true })
    expect(w.files['/w/src/app.ts']).toMatch(/^export const x = 1;\n/)
    expect((await view(ui)).dirty).toEqual([])
  })

  test('Entrée garde l’indentation, Tab indente, Ctrl+Z annule', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await openApp(ui)
    await click(ui, TEXT_X + 30, 3)
    await key(ui, 'return')
    await type(ui, 'a')
    await key(ui, 'tab')
    await type(ui, 'b')
    await ui.advance(1200)
    // Le fichier indente de 2 espaces : Entrée après « { » en ajoute 2, Tab va au cran suivant.
    expect(w.files['/w/src/app.ts']).toBe('export const x = 1\nfunction f() {\n  a b\n  return "s"\n}\n')
    // Quatre groupes : Entrée, la frappe, Tab, la frappe.
    for (let i = 0; i < 4; i++) await key(ui, 'z', { ctrl: true })
    await ui.advance(1200)
    expect(w.files['/w/src/app.ts']).toBe(FILES['/w/src/app.ts'])
    await key(ui, 'y', { ctrl: true })
    await ui.advance(1200)
    expect(w.files['/w/src/app.ts']).toBe('export const x = 1\nfunction f() {\n  \n  return "s"\n}\n')
  })

  test('les fins de ligne CRLF sont gardées à l’enregistrement', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await click(ui, 5, ROW.notes)
    expect(await screen(ui)).toContain('CRLF')
    await click(ui, TEXT_X, 2)
    await type(ui, 'x')
    await ui.advance(1200)
    expect(w.files['/w/notes windows.txt']).toBe('xa\r\nb\r\n')
  })

  test('fermer un onglet modifié demande quoi faire', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await viewMenu(ui, 'autoSave')
    await openApp(ui)
    await click(ui, TEXT_X, 2)
    await type(ui, 'A')
    await key(ui, 'w', { ctrl: true })
    expect(await screen(ui)).toContain("n'est pas enregistré")
    await key(ui, 'escape-like')
    expect((await view(ui)).tabs).toHaveLength(1)
    await key(ui, 'w', { ctrl: true })
    await key(ui, 'n')
    expect((await view(ui)).tabs).toEqual([])
    expect(w.files['/w/src/app.ts']).toBe(FILES['/w/src/app.ts'])
    await click(ui, 7, ROW.app)
    await click(ui, TEXT_X, 2)
    await type(ui, 'B')
    await key(ui, 'w', { ctrl: true })
    await key(ui, 'return')
    expect((await view(ui)).tabs).toEqual([])
    expect(w.files['/w/src/app.ts']).toMatch(/^Bexport/)
  })

  test('un fichier changé sur le disque se relit ; pendant des modifications, une bannière propose', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await openApp(ui)
    w.touch('/w/src/app.ts', 'const y = 2\n')
    await clock.advance(4100)
    expect(await screen(ui)).toContain('const y = 2')
    await viewMenu(ui, 'autoSave')
    await click(ui, TEXT_X, 2)
    await type(ui, 'Q')
    w.touch('/w/src/app.ts', 'const z = 3\n')
    await clock.advance(4100)
    let s = await screen(ui)
    expect(s).toContain('Modifié sur le disque')
    expect(s).toContain('Qconst y = 2')
    const banner = ' ⚠ Modifié sur le disque pendant vos modifications. '
    await click(ui, 32 + banner.length + 2, 2)
    s = await screen(ui)
    expect(s).not.toContain('Modifié sur le disque')
    expect(s).toContain('const z = 3')
  })

  test('Ctrl+F : la recherche dans le fichier compte les occurrences et y mène', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await openApp(ui)
    await click(ui, TEXT_X, 2)
    await key(ui, 'f', { ctrl: true })
    await type(ui, 'f')
    // « function f() » : deux f sur la ligne 2.
    expect(await screen(ui)).toContain('1/2')
    await key(ui, 'return')
    await key(ui, 'return')
    expect(await screen(ui)).toContain('1/2')
    expect(await screen(ui)).toContain('Ln ')
  })

  test('Markdown : aperçu rendu par défaut, </> bascule au source', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await click(ui, 5, ROW.readme)
    let s = await screen(ui)
    expect(s).toContain('[md:# Titre')
    expect(s).toContain('</>')
    await click(ui, 105, 1)
    s = await screen(ui)
    expect(s).not.toContain('[md:')
    expect(s).toMatch(/1 # Titre/)
  })

  test('un gros fichier se lit par fenêtres, en lecture seule', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await click(ui, 5, ROW.big)
    expect(await screen(ui)).toContain('Lecture seule : fichier volumineux (12000 lignes)')
    await click(ui, TEXT_X + 2, 2)
    await key(ui, 'end')
    await key(ui, 'x')
    const s = await screen(ui)
    expect(s).toContain('ligne numéro 12000 du gros fichier')
    expect(s).not.toContain('xligne')
  })

  test('un binaire ne s’affiche pas ; un bouton l’ouvre dans l’application par défaut', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await click(ui, 5, ROW.bin)
    expect(await screen(ui)).toContain('Fichier binaire')
    await click(ui, 32 + 4, 4)
    await clock.advance(10)
    expect(w.runs.some((r) => r.join(' ').includes('bin.dat') && /xdg-open|explorer|open/.test(r[0]!))).toBe(true)
  })
})

describe('files-board : menus contextuels et options', () => {
  test('clic droit sur un fichier : joindre, copier, copier le contenu, afficher, ouvrir dans', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    // Les applications de « Ouvrir dans » se cherchent en arrière-plan.
    await clock.advance(10)
    const menu = async (id: string, sub = -1) => {
      await click(ui, 5, ROW.readme, 'right')
      await pick(ui, ENTRY, id, sub)
    }
    expect(await screen(ui)).not.toContain('Joindre comme contexte')
    await click(ui, 5, ROW.readme, 'right')
    const s = await screen(ui)
    for (const label of ['Joindre comme contexte', 'Copier', 'Ouvrir dans', 'Afficher dans', 'Copier le contenu du fichier']) expect(s).toContain(label)
    await click(ui, 100, 25)
    await menu('attach')
    expect(w.filled).toEqual(['@README.md '])
    await menu('copy', 0)
    await menu('copy', 1)
    await menu('copy', 2)
    expect(w.copies).toEqual(['/w/README.md', 'README.md', 'README.md'])
    await menu('copyContent')
    expect(w.copies[3]).toBe(FILES['/w/README.md'])
    await menu('reveal')
    await menu('openIn', 0)
    await clock.advance(10)
    // Hors de Windows et macOS : le dossier s'ouvre dans le gestionnaire de fichiers, le fichier dans son application.
    expect(w.runs).toContainEqual(['xdg-open', '/w'])
    expect(w.runs).toContainEqual(['xdg-open', '/w/README.md'])
  })

  test('clic droit sur un dossier : joindre @dossier/, pas de « Copier le contenu »', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await click(ui, 5, ROW.src, 'right')
    expect(await screen(ui)).not.toContain('Copier le contenu')
    await key(ui, 'return')
    expect(w.filled).toEqual(['@src/ '])
  })

  test('menu ⋮ : chaque option se coche, change le dessin et reste d’une session à l’autre', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await openApp(ui)
    await click(ui, ICON.menu, 0)
    const s = await screen(ui)
    for (const label of [
      "Afficher l'arborescence de fichiers",
      'Ctrl+Maj+Y',
      "Onglets d'aperçu",
      'Enregistrement automatique',
      'La touche Tab indente',
      'Retour à la ligne automatique',
      "Repères d'indentation",
      'Afficher les espaces',
      'Défilement au-delà de la fin',
      'Taille de tabulation',
    ]) expect(s).toContain(label)
    await click(ui, 50, 25)
    // Repères d'indentation (par défaut) : la ligne indentée commence par │.
    expect(await screen(ui)).toContain('│ return')
    await viewMenu(ui, 'showWhitespace')
    expect(await screen(ui)).toContain('│·return')
    await viewMenu(ui, 'indentGuides')
    expect(await screen(ui)).toContain('··return')
    await viewMenu(ui, 'tabSize', 0)
    expect((await view(ui)).options.tabSize).toBe(2)
    await viewMenu(ui, 'showTree')
    expect(await screen(ui)).not.toContain('Rechercher des fichiers')
    await key(ui, 'y', { ctrl: true, shift: true })
    expect(await screen(ui)).toContain('Rechercher des fichiers')
    await viewMenu(ui, 'wordWrap')
    await viewMenu(ui, 'scrollBeyondLastLine')
    await viewMenu(ui, 'tabIndents')
    const o = (await view(ui)).options
    expect(o).toMatchObject({ showWhitespace: true, indentGuides: false, tabSize: 2, showTree: true, wordWrap: false, scrollBeyondLastLine: true, tabIndents: false })
    // Gardées d'une session à l'autre.
    expect(w.store.options).toMatchObject({ showWhitespace: true, tabSize: 2 })
  })

  test('sans « La touche Tab indente », Tab passe d’une zone à l’autre', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await viewMenu(ui, 'tabIndents')
    await openApp(ui)
    await click(ui, TEXT_X, 2)
    await key(ui, 'tab')
    await type(ui, 'q')
    await ui.advance(1200)
    expect(w.files['/w/src/app.ts']).toBe(FILES['/w/src/app.ts'])
    expect((await view(ui)).find.query).toBe('q')
  })

  test('retour à la ligne : une longue ligne se replie, sinon elle défile', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const files = { ...FILES, '/w/long.txt': `${'mot '.repeat(40)}FIN\n` }
    world(on, files)
    const ui = await open($)
    await click(ui, 5, 6) // long.txt, entre docs et notes
    let s = await screen(ui)
    expect(s).toContain('FIN')
    await viewMenu(ui, 'wordWrap')
    s = await screen(ui)
    expect(s).not.toContain('FIN')
    await click(ui, TEXT_X, 2)
    await key(ui, 'end')
    expect(await screen(ui)).toContain('FIN')
  })
})

describe('files-board : recherche de fichiers', () => {
  test('la recherche floue trouve par le nom, Entrée ouvre', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await click(ui, 5, 1)
    await type(ui, 'hlprs')
    expect(await screen(ui)).toMatch(/helpers\.ts\s+src\/util/)
    await key(ui, 'return')
    expect((await view(ui)).active).toBe('src/util/helpers.ts')
  })

  test('trop de résultats : le message du desktop invite à affiner', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const files: Record<string, string> = { ...FILES }
    for (let i = 0; i < 200; i++) files[`/w/gen/fichier-${i}.txt`] = 'x'
    world(on, files)
    const ui = await open($)
    await click(ui, 5, 1)
    await type(ui, 'fichier')
    expect((await screen(ui)).replace(/\s+/g, ' ')).toContain('Certaines entrées peuvent ne pas être affichées. Continuez à saisir pour affiner.')
    expect((await view(ui)).find.total).toBe(200)
  })

  test('un dossier trouvé se montre dans l’arborescence', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await click(ui, 5, 1)
    await type(ui, 'specs')
    await key(ui, 'return')
    const s = await screen(ui)
    expect(s).toContain('Rechercher des fichiers')
    expect(s).toMatch(/▾ docs[\s\S]*specs/)
  })
})

describe('files-board : souris et clavier', () => {
  test('Maj+F10 ouvre le menu de la ligne choisie ; un clic ailleurs le ferme', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await click(ui, 5, ROW.readme)
    await key(ui, 'f10', { shift: true })
    expect(await screen(ui)).toContain('Joindre comme contexte')
    await click(ui, 80, 25)
    expect(await screen(ui)).not.toContain('Joindre comme contexte')
  })

  test('le séparateur se glisse : la largeur de l’arborescence est gardée', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await ui.pointer({ type: 'down', x: 31, y: 12, button: 'left', in: 'browser' })
    await ui.pointer({ type: 'move', x: 44, y: 12, button: 'left', in: 'browser' })
    await ui.pointer({ type: 'up', x: 44, y: 12, button: 'left', in: 'browser' })
    expect((await view(ui)).options.sidebarWidth).toBe(44)
    expect(w.store.options).toMatchObject({ sidebarWidth: 44 })
  })

  test('la barre de défilement se glisse jusqu’en bas d’un gros fichier', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await click(ui, 5, ROW.big)
    await ui.pointer({ type: 'down', x: 109, y: 28, button: 'left', in: 'browser' })
    await ui.pointer({ type: 'up', x: 109, y: 28, button: 'left', in: 'browser' })
    expect(await screen(ui)).toContain('ligne numéro 12000 du gros fichier')
  })

  test('□ agrandit le panneau, × le ferme', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await click(ui, ICON.max, 0)
    expect((await view(ui)).isMaximized).toBe(true)
    expect(w.opened.length).toBe(2)
    expect(await screen(ui)).toContain('▣')
    await click(ui, ICON.close, 0)
    expect(w.closed).toEqual(['files'])
  })

  test('menu d’onglet : afficher dans l’arborescence, recharger le fichier', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await viewMenu(ui, 'autoSave')
    await openApp(ui)
    await click(ui, 5, ROW.src)
    expect(await screen(ui)).not.toMatch(/^\s+app\.ts/m)
    await click(ui, 4, 0, 'right')
    await pick(ui, TAB, 'revealInTree')
    expect(await screen(ui)).toMatch(/▾ src[\s\S]*app\.ts/)
    await click(ui, TEXT_X, 2)
    await type(ui, 'W')
    expect(await screen(ui)).toContain('Wexport')
    await click(ui, 4, 0, 'right')
    await pick(ui, TAB_PINNED, 'reload')
    expect(await screen(ui)).not.toContain('Wexport')
    expect(w.files['/w/src/app.ts']).toBe(FILES['/w/src/app.ts'])
  })

  test('Ctrl+F deux fois ferme la barre de recherche', async ($: any, on: any) => {
    mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await openApp(ui)
    await click(ui, TEXT_X, 2)
    await key(ui, 'f', { ctrl: true })
    expect(await screen(ui)).toContain('↑  ↓  ×')
    await key(ui, 'f', { ctrl: true })
    expect(await screen(ui)).not.toContain('↑  ↓  ×')
  })

  test('« Garder les miennes » ferme la bannière et l’enregistrement écrase le disque', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await viewMenu(ui, 'autoSave')
    await openApp(ui)
    await click(ui, TEXT_X, 2)
    await type(ui, 'K')
    w.touch('/w/src/app.ts', 'autre\n')
    await clock.advance(4100)
    expect(await screen(ui)).toContain('Modifié sur le disque')
    const banner = ' ⚠ Modifié sur le disque pendant vos modifications. '
    await click(ui, 32 + banner.length + 15, 2)
    expect(await screen(ui)).not.toContain('Modifié sur le disque')
    await key(ui, 's', { ctrl: true })
    expect(w.files['/w/src/app.ts']).toMatch(/^Kexport/)
  })
})

describe('files-board : fichiers modifiés par Claude', () => {
  const edit = ($: any, file_path: string) => $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })
  const say = ($: any, text: string, origin: object = { kind: 'composer' }) => $.prompt.submit({ text, wait: false, origin } as any)

  test('après un Edit, le fichier porte ◆ et ses dossiers repliés ◇', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    world(on)
    const ui = await open($)
    await edit($, '/w/src/util/helpers.ts')
    await clock.advance(500)
    expect((await view(ui)).touched).toEqual(['src/util/helpers.ts'])
    let s = await screen(ui)
    expect(s).toMatch(/▸ src ◇/)
    expect(s).not.toMatch(/README\.md ◇|docs ◇/)
    await click(ui, 5, ROW.src)
    await click(ui, 7, ROW.util)
    s = await screen(ui)
    expect(s).toMatch(/▾ src ◇[\s\S]*▾ util ◇[\s\S]*helpers\.ts ◆/)
    expect(s).not.toMatch(/app\.ts ◆/)
    // Ouvert après coup : le fil d'Ariane dit que Claude l'a modifié, sans parler de rechargement.
    await click(ui, 9, ROW.util + 1)
    s = await screen(ui)
    expect(s).toContain('◆ Modifié par Claude')
    expect(s).not.toContain('Rechargé')
    expect(s.split('\n')[0]).toContain('helpers.ts ◆')
  })

  test('Write et NotebookEdit marquent aussi ; un fichier créé apparaît marqué', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    w.touch('/w/nouveau.md', '# Nouveau\n')
    await $.tool.call({ tool: 'Write', file_path: '/w/nouveau.md', content: '# Nouveau\n' })
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/w/docs/carnet.ipynb', new_source: 'x' })
    await clock.advance(500)
    expect((await view(ui)).touched).toEqual(['nouveau.md', 'docs/carnet.ipynb'])
    const s = await screen(ui)
    expect(s).toMatch(/nouveau\.md ◆/)
    expect(s).toMatch(/▸ docs ◇/)
  })

  test('après Bash, tout se relit mais rien n’est marqué ; un Edit en erreur ne marque pas', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await openApp(ui)
    w.touch('/w/src/app.ts', 'const parBash = 1\n')
    await $.tool.call({ tool: 'Bash', command: 'sed -i s/x/y/ src/app.ts' })
    await clock.advance(500)
    let s = await screen(ui)
    expect(s).toContain('const parBash = 1')
    expect((await view(ui)).touched).toEqual([])
    expect(s).not.toMatch(/[◆◇]/)
    expect(s).not.toContain('modifié par Claude')
    await edit($, '/w/src/refus.ts')
    await clock.advance(500)
    expect((await view(ui)).touched).toEqual([])
  })

  test('un onglet ouvert relu après un Edit le dit ; le message suivant de la personne efface les marques', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: NOW })
    const w = world(on)
    const ui = await open($)
    await openApp(ui)
    w.touch('/w/src/app.ts', 'const parClaude = 2\n')
    await edit($, '/w/src/app.ts')
    await clock.advance(500)
    let s = await screen(ui)
    expect(s).toContain('const parClaude = 2')
    expect(s.split('\n')[0]).toContain('app.ts ◆')
    expect(s).toContain('◆ Rechargé : modifié par Claude')
    expect(s).toMatch(/app\.ts ◆/)
    // Une commande ou un message d'un plugin n'effacent rien.
    await say($, 'relance', { kind: 'plugin', name: 'autre' })
    expect((await view(ui)).touched).toEqual(['src/app.ts'])
    await say($, 'merci, continue')
    expect((await view(ui)).touched).toEqual([])
    s = await screen(ui)
    expect(s).not.toMatch(/[◆◇]/)
    expect(s).not.toContain('modifié par Claude')
    expect(s.split('\n')[0]).toContain('app.ts ×')
  })
})
