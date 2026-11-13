import { expect, mock, test } from 'claude-code/testing'

import { briefFileName, tempDirForm } from '../hooks/closing.ts'
import { BRIEF_RUBRICS } from '../hooks/register.tsx'

// Rétro « Coordinateur de parcours » (décision : un fichier par lancement, dans le dossier temporaire du système) : chaque lancement faisait rédiger
// à Claude un brief d'après une consigne d'environ 6 000 signes, et un `sed` sur une apostrophe avait
// cassé une commande de lancement. Le mod écrit lui-même le brief de chaque groupe dans le dossier
// temporaire du système ; Claude le passe tel quel et n'y ajoute que ce qui varie.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const LOT = {
  tickets: [
    { id: 'a1', name: 'Code', files: ['src/a.ts'] },
    { id: 'e1', name: 'Icône « finale » [v2]', files: ['assets/icon.svg'] },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'E', name: 'Icône', tickets: ['e1'], resources: ['PowerBI Desktop'] },
  ],
}

const NOW = 80_000_000
const TMP = '/var/tmp/essai'

type Disk = { tmp?: unknown; isWritable?: boolean; isTaken?: boolean; asLink?: boolean; altered?: boolean; presses?: string[]; tmpIsLink?: boolean; elsewhere?: boolean }

/** Le monde du test : `disk.tmp` est la valeur de TMPDIR (absente : non posée), les briefs écrits sont rendus. */
const launch = async ($: any, on: any, disk: Disk = {}): Promise<{ text: string; written: Record<string, string> }> => {
  mock.clock(on, { now: NOW })
  const mem: Record<string, unknown> = {}
  const written: Record<string, string> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: '/proj', remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: '/proj' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'TMPDIR' ? disk.tmp : undefined }) as any)
  const isTmp = (path: string): boolean => path === TMP || path === tempDirForm(disk.tmp)
  // Le dossier temporaire se résout ailleurs (comme /var → /private/var sous macOS) : la relecture compare les chemins résolus.
  const real = (path: string): string => `/private${path}`
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    if (isTmp(e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: disk.tmpIsLink === true, realPath: real(e.path) } } as any
    if (disk.isTaken && e.path.includes('/flow-board-brief-')) return { value: { kind: 'other', size: 0, mtimeMs: 0, isLink: true } } as any
    if (e.path in written) return { value: { kind: disk.asLink ? 'other' : 'file', size: written[e.path]!.length, mtimeMs: 0, isLink: disk.asLink === true, realPath: disk.elsewhere ? `/ailleurs${e.path}` : e.path } } as any
    throw new Error(`absent : ${e.path}`)
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path === '/proj/config/rules' }) as any)
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (e.path.includes('flow-board-brief-') && disk.isWritable !== false) {
      written[e.path] = e.text
      return { value: undefined }
    }
    throw new Error(`pas de disque : ${e.path}`)
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (e.path in written) return { value: disk.altered ? `${written[e.path]}x` : written[e.path] } as any
    throw new Error(`pas de disque : ${e.path}`)
  })
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  for (const key of disk.presses ?? ['launch-linked-E']) await ui.press({ key })
  await ui.unmount()
  return { text: filled.at(-1)!, written }
}

test('le brief s’écrit dans le dossier temporaire du système, à un nom fait des ids et de l’heure ; la demande cite son chemin et la commande qui le passe', async ($, on) => {
  const { text, written } = await launch($, on, { tmp: `${TMP}/` })
  const paths = Object.keys(written)
  // Un seul brief par groupe, l'Opus, hors « ↗ Fable ».
  expect(paths.length).toBe(1)
  // Cité tel que le disque le nomme : le dossier résolu (ici /var → /private/var).
  expect(paths[0]).toMatch(new RegExp(`^/private${TMP}/flow-board-brief-[A-Za-z0-9_-]+-E-${NOW}\\.md$`))
  // Le chemin cité pour le shell, et la commande qui le passe tel quel (CLI) ou par start_session (app).
  expect(text).toContain(`brief du groupe E : '${paths[0]}'`)
  expect(text).not.toContain('brief Fable')
  expect(text).toContain(`test -s <brief> && claude --bg`)
  expect(text).toContain(`"$(cat <brief> '<ajout>')"`)
  expect(text).toContain('s\'il manque, ne lance pas cette session et dis-le-moi')
  expect(text).toContain('start_session')
  expect(text).toContain('background : le texte du fichier du brief, lu par cat, tel quel')
  expect(text).toContain('ne le réécris pas et ne le modifie pas')
  // La demande ne fait plus rédiger le brief.
  expect(text).not.toContain('Rédige toi-même le background')
  expect(text).not.toContain("Le brief n'a pas pu être écrit")
  // Ce que le mod ne sait pas reste à Claude : la référence, les autres missions, une décision fraîche.
  expect(text).toContain('ta référence entre crochets et ton nom du moment')
  expect(text).toContain('ce que font en même temps les autres missions')
  expect(text).toContain('pour un groupe renvoyé, ce que la session précédente a trouvé')
  // Sans fichier des choix (ce monde n'a pas de ~/.claude), leur liste va dans ce qui varie.
  expect(text).toContain('Ajoute aussi à ce qui varie la liste des choix déjà déclarés')
  // La partie du manager ne change pas.
  expect(text).toContain('{"returned": ["<id du groupe>"]}')
})

test('le brief écrit porte chaque rubrique, dans l’ordre, et tout ce que la demande d’avant faisait rédiger', async ($, on) => {
  const { written } = await launch($, on, { tmp: TMP })
  const brief = Object.values(written)[0]!
  let at = -1
  for (const rubric of BRIEF_RUBRICS) {
    const i = brief.indexOf(`\n\n${rubric} — `) >= 0 ? brief.indexOf(`\n\n${rubric} — `) : brief.startsWith(`${rubric} — `) ? 0 : -1
    expect(i).toBeGreaterThan(at)
    at = i
  }
  // Le groupe et ses tickets, valeurs relues neutralisées ; la ressource à ne pas partager ; les autres sessions.
  expect(brief).toContain('E « Icône », tickets dans l\'ordre : 1) e1 — Icône “ finale ” (v2).')
  expect(brief).toContain('PowerBI Desktop')
  expect(brief).toContain('aucun autre groupe lancé en même temps')
  // Les décisions par renvoi, au chemin du dossier du manager ; le geste humain ; le dossier config/rules.
  expect(brief).toContain('par son chemin absolu dans le dossier du manager (/proj), lu par Read')
  expect(brief).toContain('mise à jour du porteur')
  expect(brief).toContain('se confirme par moi directement dans ta session')
  expect(brief).toContain('leur version du dépôt fait foi sur celle installée sous ~/.claude')
  // Les trois points du prompt, avec le groupe en clair dans l'appel delegate.
  expect(brief).toMatch(/1\) d'abord, appeler une seule fois l'outil flow de flow-board avec \{"delegate": "[A-Za-z0-9_-]+", "group": "E", "main": "\[<ref>\]"\}/)
  expect(brief).toMatch(/2\) puis lire la procédure d'un worker de groupe, \S*reference\/procedure-groupe\.md, et la suivre jusqu'au bout/)
  expect(brief).toContain('compte rendu déposé au relais puis une ligne à la discussion principale')
  expect(brief).toContain('TDD : /mattpocock-skills:tdd')
  expect(brief).toContain('revue du ticket : /mattpocock-skills:code-review')
  expect(brief).toContain('que son dossier est un dépôt git')
  // La discussion principale : par sa référence, ses sœurs exclues, le message final.
  expect(brief).toContain('trouve la ligne qui porte cette référence')
  expect(brief).toContain('tes sœurs')
  expect(brief).toContain('Termine toujours par un message à cette discussion')
  expect(brief.trimEnd().endsWith('dans le message qui suit ce brief)')).toBe(true)
})

test('un groupe déjà dans un worker se nomme dans les autres sessions du brief suivant, jamais le groupe lui-même', async ($, on) => {
  const { written } = await launch($, on, { tmp: TMP, presses: ['launch-linked-A', 'launch-linked-E'] })
  const brief = Object.entries(written).find(([path]) => path.includes('-E-'))![1]
  expect(brief).toContain('Autres sessions — aucun autre groupe lancé en même temps ; déjà dans un worker : A « Code »')
  expect(brief).not.toContain('déjà dans un worker : E')
  const first = Object.entries(written).find(([path]) => path.includes('-A-'))![1]
  expect(first).toContain('aucun autre groupe de la mission dans un worker')
})

test('le brief porte le point 3 de la demande d’avant mot pour mot', async ($, on) => {
  const { written } = await launch($, on, { tmp: TMP })
  const brief = Object.values(written)[0]!
  const point3 = (s: string): string => s.slice(s.indexOf('3) ce qui varie, que la procédure attend du prompt'), s.indexOf('. ', s.indexOf('3) ce qui varie')) + 1)
  expect(point3(brief).length).toBeGreaterThan(100)
  // La même consigne que la demande de repli (un seul constructeur pour les deux).
  expect(point3(brief)).toContain("et qu'elle n'est pas un worker autonome (aucun ticket « Jugement : oui » dans son groupe)")
})

test('une écriture refusée retombe sur la demande d’avant, en le disant', async ($, on) => {
  const { text, written } = await launch($, on, { tmp: TMP, isWritable: false })
  expect(Object.keys(written).length).toBe(0)
  expect(text.startsWith('Confie ce groupe à un worker')).toBe(true)
  expect(text).toContain("Le brief n'a pas pu être écrit par flow-board (écriture du brief du groupe E refusée dans le dossier temporaire) : rédige-le toi-même, comme suit. Rédige toi-même le background")
  expect(text).toContain('"main": "[<ref>]"')
})

test('un dossier temporaire hors forme ou inconnu : rien ne s’écrit, la demande d’avant le dit', async ($, on) => {
  const { text, written } = await launch($, on, { tmp: "/var/tmp/l'essai" })
  expect(Object.keys(written).length).toBe(0)
  expect(text).toContain("Le brief n'a pas pu être écrit par flow-board (dossier temporaire du système introuvable ou hors forme)")
  // La valeur hors forme n'est pas recopiée.
  expect(text).not.toContain("l'essai")
})

test('sans variable du dossier temporaire : pas de repli sur un /tmp partagé, la demande d’avant', async ($, on) => {
  const { text, written } = await launch($, on, {})
  expect(Object.keys(written).length).toBe(0)
  expect(text).toContain("Le brief n'a pas pu être écrit par flow-board (dossier temporaire du système introuvable ou hors forme)")
})

test('un brief relu qui est un lien : la demande d’avant', async ($, on) => {
  const { text } = await launch($, on, { tmp: TMP, asLink: true })
  expect(text).toContain("Le brief n'a pas pu être écrit par flow-board")
})

test('un TMPDIR qui est lui-même un lien (vers un dossier partagé) : la demande d’avant', async ($, on) => {
  const { text, written } = await launch($, on, { tmp: TMP, tmpIsLink: true })
  expect(Object.keys(written).length).toBe(0)
  expect(text).toContain("Le brief n'a pas pu être écrit par flow-board (dossier temporaire du système introuvable ou hors forme)")
})

test('un brief relu qui se résout hors du dossier temporaire : la demande d’avant', async ($, on) => {
  const { text } = await launch($, on, { tmp: TMP, elsewhere: true })
  expect(text).toContain("Le brief n'a pas pu être écrit par flow-board (écriture du brief du groupe E refusée")
})

test('un brief relu dont le texte a changé : la demande d’avant', async ($, on) => {
  const { text } = await launch($, on, { tmp: TMP, altered: true })
  expect(text).toContain("Le brief n'a pas pu être écrit par flow-board")
})

test('un fichier ou un lien déjà au nom du brief n’est jamais réécrit', async ($, on) => {
  const { text, written } = await launch($, on, { tmp: TMP, isTaken: true })
  expect(Object.keys(written).length).toBe(0)
  expect(text).toContain("Le brief n'a pas pu être écrit par flow-board")
})

test('le nom du brief et le dossier temporaire : formes contrôlées', () => {
  expect(briefFileName('mvzwrmcd-2jce', 'D', 1_700_000_000_000)).toBe('flow-board-brief-mvzwrmcd-2jce-D-1700000000000.md')
  expect(briefFileName('mvzwrmcd-2jce', 'D', 1_700_000_000_000, true)).toBe('flow-board-brief-mvzwrmcd-2jce-D-1700000000000-fable.md')
  expect(briefFileName('../x', 'D', 1, true)).toBeNull()
  expect(briefFileName('../x', 'D', 1)).toBeNull()
  expect(briefFileName('abc', 'D/..', 1)).toBeNull()
  expect(briefFileName('abc', 'D', 1.5)).toBeNull()
  expect(briefFileName('abc', 'D', -1)).toBeNull()
  expect(briefFileName('a b', 'D', 1)).toBeNull()
  expect(tempDirForm('/var/folders/x/T/')).toBe('/var/folders/x/T')
  expect(tempDirForm('C:\\Users\\m\\AppData\\Local\\Temp')).toBe('C:/Users/m/AppData/Local/Temp')
  for (const bad of ['tmp', './tmp', '/tmp/../etc', "/tmp/it's", '/tmp/$(x)', '/tmp/`x`', '//server/share', '\\\\server\\share', '/', 'C:\\', '/tmp/a\nb', '/tmp//x', 3, null]) {
    expect(tempDirForm(bad)).toBeNull()
  }
})
