import { describe, expect, test } from 'claude-code/testing'

import {
  ancestors,
  compareNames,
  decodeRows,
  deleteBack,
  detectIndent,
  entryMenu,
  flattenRows,
  fuzzyScore,
  glyphs,
  colOf,
  indexAt,
  mdBlocks,
  mention,
  newline,
  normalizeOptions,
  relFrom,
  resolveFrom,
  searchPaths,
  tabMenu,
  tokenize,
  toAbs,
  touchedMarks,
  wrapRows,
} from '../hooks/model.ts'

describe('model : chemins', () => {
  test('relFrom, toAbs, resolveFrom sous Windows et ailleurs', async () => {
    expect(relFrom('C:\\Users\\m\\projet', 'c:\\users\\M\\projet\\src\\a.ts', 'windows')).toBe('src/a.ts')
    expect(relFrom('C:\\Users\\m\\projet', 'C:\\Users\\m\\autre\\a.ts', 'windows')).toBeNull()
    expect(relFrom('/home/m/p', '/home/m/P/a.ts', 'linux')).toBeNull()
    expect(toAbs('C:\\p\\', 'docs/specs/a.md', '\\')).toBe('C:\\p\\docs\\specs\\a.md')
    expect(resolveFrom('C:\\p\\src', '..\\docs\\.\\a.md', '\\')).toBe('C:\\p\\docs\\a.md')
    expect(resolveFrom('/home/m', 'p/../q', '/')).toBe('/home/m/q')
    expect(ancestors('a/b/c.md')).toEqual(['a', 'a/b'])
  })

  test('touchedMarks : les fichiers modifiés par Claude et tous leurs dossiers parents', async () => {
    const m = touchedMarks(['src/util/a.ts', 'README.md'])
    expect([...m.files]).toEqual(['src/util/a.ts', 'README.md'])
    expect([...m.dirs].sort()).toEqual(['src', 'src/util'])
  })

  test('mention : le dossier finit par /, un espace met des guillemets', async () => {
    expect(mention('src/app.ts', false)).toBe('@src/app.ts')
    expect(mention('src', true)).toBe('@src/')
    expect(mention('notes windows.txt', false)).toBe('@"notes windows.txt"')
  })
})

describe('model : arborescence et recherche', () => {
  test("l'ordre du desktop : sans casse, nombres naturels, dossiers et fichiers mêlés", async () => {
    const names = ['CLAUDE.md', 'app', '.git', 'brag-output', 'BRIEF.md', '.gitattributes', 'f10', 'f2', '.githooks', '.github']
    expect([...names].sort(compareNames)).toEqual(['.git', '.gitattributes', '.githooks', '.github', 'app', 'brag-output', 'BRIEF.md', 'CLAUDE.md', 'f2', 'f10'])
  })

  test('lignes codées : les chemins se reconstruisent', async () => {
    const listings = {
      '': { entries: [{ name: 'docs', kind: 'dir' as const }, { name: 'a.md', kind: 'file' as const }], hidden: 0, error: null },
      docs: { entries: [{ name: 'specs', kind: 'dir' as const }], hidden: 0, error: null },
    }
    const { rows } = flattenRows(listings, new Set(['docs', 'docs/specs']))
    expect(decodeRows(rows).map((r) => `${r.kind}:${r.path}`)).toEqual(['o:docs', 'o:docs/specs', 'l:docs/specs', 'f:a.md'])
    const capped = flattenRows(listings, new Set(['docs']), 2)
    expect(capped.rows).toHaveLength(2)
    expect(capped.hidden).toBe(1)
  })

  test('recherche floue : le nom compte plus que le dossier', async () => {
    expect(fuzzyScore('hlp', 'src/util/helpers.ts')).toBeGreaterThan(0)
    expect(fuzzyScore('xyz', 'src/util/helpers.ts')).toBe(-1)
    const { results, total } = searchPaths(['help/zzz.ts', 'src/helpers.ts', 'docs/help.md'], 'help')
    expect(total).toBe(3)
    expect(results[0]).toBe('docs/help.md')
    expect(results.indexOf('src/helpers.ts')).toBeLessThan(results.indexOf('help/zzz.ts'))
  })
})

describe('model : affichage', () => {
  test('tabulations au taquet, caractères larges, retour à la ligne aux espaces', async () => {
    const gl = glyphs('a\tb', 4)
    expect(gl.map((g) => [g.col, g.w])).toEqual([
      [0, 1],
      [1, 3],
      [4, 1],
    ])
    expect(colOf(gl, 2)).toBe(4)
    expect(indexAt(gl, 3, 3)).toBe(2)
    expect(glyphs('日本', 4).map((g) => g.w)).toEqual([2, 2])
    expect(glyphs('a\u0001', 4)[1]?.ch).toBe('\uFFFD')
    const row = glyphs('un deux trois quatre', 4)
    expect(wrapRows(row, 10).map((s) => row[s]?.col)).toEqual([0, 8, 14])
  })

  test('blocs Markdown : titres seuls, blocs de code entiers', async () => {
    const blocks = mdBlocks(['# T', 'para', '', '```', 'a', '', 'b', '```', 'fin'])
    expect(blocks.map((b) => b.start)).toEqual([0, 1, 3])
    expect(blocks[2]?.text).toBe('```\na\n\nb\n```\nfin')
  })

  test('coloration : mots-clés, chaînes, commentaires sur plusieurs lignes', async () => {
    const line = tokenize('const s = "x" // note', 'js', '')
    expect(line.toks).toEqual([
      [0, 5, 'k'],
      [10, 13, 's'],
      [14, 21, 'c'],
    ])
    const open = tokenize('a /* début', 'js', '')
    expect(open.state).toBe('bc')
    expect(tokenize('fin */ b', 'js', open.state).toks[0]).toEqual([0, 6, 'c'])
    expect(tokenize('## Titre', 'md', '').toks).toEqual([[0, 8, 'h']])
    expect(tokenize('"cle": 1', 'json', '').toks).toEqual([
      [0, 5, 'p'],
      [7, 8, 'n'],
    ])
  })
})

describe('model : édition', () => {
  test("indentation détectée ; Entrée entre accolades ouvre un bloc ; retour arrière d'un cran", async () => {
    expect(detectIndent(['a', '  b', '    c'])).toBe('  ')
    expect(detectIndent(['a', '\tb'])).toBe('\t')
    expect(detectIndent(['a', 'b'])).toBeNull()
    const c = { lines: ['f() {}'], cy: 0, cx: 5 }
    newline(c, '  ', 'js')
    expect(c.lines).toEqual(['f() {', '  ', '}'])
    expect([c.cy, c.cx]).toEqual([1, 2])
    const d = { lines: ['      x'], cy: 0, cx: 6 }
    deleteBack(d, 4)
    expect(d.lines[0]).toBe('    x')
  })
})

describe('model : menus et options', () => {
  test('les menus du desktop, et des options lues prudemment', async () => {
    const file = entryMenu(false, [{ id: 'default', label: 'Application par défaut' }], 'windows').filter((i) => !i.isSeparator)
    expect(file.map((i) => i.label)).toEqual(['Joindre comme contexte', 'Copier', 'Ouvrir dans', "Afficher dans l'Explorateur", 'Copier le contenu du fichier'])
    expect(file[1]?.sub?.map((i) => i.label)).toEqual(['Chemin absolu', 'Chemin relatif', 'Nom du fichier'])
    const tab = tabMenu(false, [], 'mac').filter((i) => !i.isSeparator)
    expect(tab.map((i) => i.label)).toEqual([
      'Joindre comme contexte',
      'Copier',
      'Ouvrir dans',
      'Afficher dans le Finder',
      "Afficher dans l'arborescence de fichiers",
      'Rechercher dans le fichier',
      'Copier le contenu du fichier',
      'Recharger le fichier',
      'Garder ouvert',
      'Fermer le fichier',
    ])
    expect(tab.find((i) => i.id === 'keepOpen')?.isDisabled).toBe(true)
    expect(normalizeOptions({ tabSize: 3, wordWrap: 'oui', autoSave: false })).toMatchObject({ tabSize: 4, wordWrap: true, autoSave: false })
  })
})
