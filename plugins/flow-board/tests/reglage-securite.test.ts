import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, newRun } from '../hooks/model.ts'
import type { Run } from '../types'

// Le réglage « revue de sécurité » d'un projet, gardé sur le poste. Invariant : « la revue d'un projet où
// tu l'as activée n'est jamais désactivée sans un clic de toi ». Une lecture ratée vaut « activée ».
// Le disque est en mémoire : le mod écrit le réglage dans un fichier sous le dossier personnel que lui donne
// l'environnement (`HOME_DIR`), le même quel que soit l'emplacement du mod (suite complète comme `--test`).

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const ROOT = '/proj'
const NOW = 140_000_000
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const SETTING_KEY = `security-review:${ROOT}`
/** Le dossier personnel que dit l'environnement du test. */
const HOME_DIR = '/h'
const isSettingFile = (path: string): boolean => /\/flow-board\/coordination\/[^/]+\.revue-securite\.json$/.test(path)
const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')

type World = {
  mem: Record<string, unknown>
  files: Record<string, string>
  toasts: string[]
  /** Le texte du réglage posé par une autre discussion (ou abîmé) ; absent : jamais réglé. */
  seed: { text?: string }
  fault: { read: boolean; write: boolean; repo: false | 'throw' | 'null' }
  /**
   * `root` : la racine du dépôt principal que dit le moteur ; `repoRoot` : celle qu'il dit (une autre casse au besoin) ;
   * `vars` : les variables que lit `$.env.get` ; `throwing` : celles dont la lecture lève.
   */
  env: { root: string; repoRoot: string; vars: Record<string, string>; throwing: string[] }
  /** Ce que le mod a écrit ou effacé (chemins de fichier, clés de `$.store`) et les commandes qu'il a lancées. */
  touched: string[]
  /** Les chemins de réglage que le mod a lus (mode fichier). */
  reads: string[]
}

/** Le moteur sous le plugin, dans le projet /proj : disque et stockage en mémoire, pannes à la demande. */
const world = (on: any): World => {
  const w: World = { mem: {}, files: {}, toasts: [], seed: {}, fault: { read: false, write: false, repo: false }, env: { root: ROOT, repoRoot: ROOT, vars: { HOME: HOME_DIR }, throwing: [] }, touched: [], reads: [] }
  on('env.get', (_$: unknown, e: { name: string }) => {
    if (w.env.throwing.includes(e.name)) throw new Error(`variable ${e.name} refusée`)
    return { value: w.env.vars[e.name] }
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'session-A' }))
  on('session.root', () => ({ value: w.env.root }))
  on('session.repo', () => {
    if (w.fault.repo === 'throw') throw new Error('pas de réponse')
    return { value: w.fault.repo === 'null' ? null : { root: w.env.repoRoot, remote: null, internal: false, name: null } }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('process.run', (_$: unknown, e: { argv?: string[] }) => {
    w.touched.push(`run ${(e.argv ?? []).join(' ')}`)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  // Le stockage : le réglage posé par le test se lit sous sa clé tant que le mod n'a rien écrit.
  on('store.get', (_$: unknown, e: { key: string }) => {
    if (e.key === SETTING_KEY) {
      if (w.fault.read) throw new Error('lecture ratée')
      if (!(e.key in w.mem) && w.seed.text !== undefined) {
        try {
          return { value: JSON.parse(w.seed.text) }
        } catch {
          return { value: w.seed.text }
        }
      }
    }
    return { value: w.mem[e.key] }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (w.fault.write && e.key.startsWith(SETTING_KEY)) throw new Error('refusé')
    w.touched.push(`set ${e.key}`)
    w.mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    w.touched.push(`delete ${e.key}`)
    delete w.mem[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(w.mem) }))
  // Le disque : le fichier des missions posé par le test sous `board:/proj`, le réglage sous `seed`.
  const fileOf = (path: string): string | undefined =>
    path in w.files
      ? w.files[path]
      : isSettingFile(path)
        ? w.seed.text
        : isBoardFile(path) && w.mem[`board:${ROOT}`] !== undefined
          ? JSON.stringify(w.mem[`board:${ROOT}`])
          : undefined
  on('fs.exists', (_$: unknown, e: { path: string }) => {
    if (w.fault.read && isSettingFile(e.path)) throw new Error(`EIO ${e.path}`)
    return { value: fileOf(e.path) !== undefined } as any
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isSettingFile(e.path)) w.reads.push(e.path)
    if (w.fault.read && isSettingFile(e.path)) throw new Error(`EACCES ${e.path}`)
    const text = fileOf(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text } as any
  })
  // Un dossier listé : ses fichiers écrits ; sur une lecture refusée, le fichier lu y est (présent mais illisible).
  on('fs.list', (_$: unknown, e: { path?: string }) => {
    const dir = (e.path ?? '').replace(/\/+$/, '')
    const paths = [...Object.keys(w.files), ...(w.fault.read || w.seed.text !== undefined ? w.reads : [])]
    const names = new Set(paths.filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1).split('/')[0]!))
    return { value: [...names].map(name => ({ name, kind: 'file', size: 0, mtimeMs: 0, isLink: false })) } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (w.fault.write && e.path.includes('.revue-securite.json')) throw new Error('EACCES')
    w.touched.push(`write ${e.path}`)
    w.files[e.path] = e.text
    return { value: undefined } as any
  })
  return w
}

/** Le réglage écrit par le mod : son fichier s'il en a écrit un, sinon `$.store` ; absent : rien d'écrit. */
const setting = (w: World): { v?: number; root?: string; review?: string; at?: number } | undefined => {
  const path = Object.keys(w.files).find(isSettingFile)
  return (path ? JSON.parse(w.files[path]!) : w.mem[SETTING_KEY]) as { v?: number; root?: string; review?: string; at?: number } | undefined
}
/** Les copies mises de côté d'un réglage hors forme : fichiers `.illisible-<date>`, ou clés `:illisible:<date>`. */
const asides = (w: World): string[] => [
  ...Object.entries(w.files).filter(([p]) => /\.revue-securite\.json\.illisible-\d+$/.test(p)).map(([, t]) => t),
  ...Object.entries(w.mem).filter(([k]) => k.startsWith(`${SETTING_KEY}:illisible:`)).map(([, v]) => String(v)),
]

const LOT = [
  { id: 'A1', name: 'Un', blockedBy: [] },
  { id: 'B1', name: 'Deux', blockedBy: [] },
]
const GROUPS = [
  { id: 'A', name: 'Worker', tickets: ['A1'], files: ['worker'] },
  { id: 'B', name: 'App', tickets: ['B1'], files: ['app'] },
]

/** Une mission à groupes dont le groupe A est fini, avec l'avis « conseillée » : sa ligne de sécurité porte la bascule. */
const advisedGroup = async ($: any) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: LOT, groups: GROUPS } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }] } as any)
  await $.tool.call({ tool: TOOL, security: { group: 'A', advised: true, why: 'touche les jetons' } } as any)
}
const pane = ($: any, surface: 'terminal' | 'desktop' = 'desktop') => $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
const toggleLabel = async ($: any): Promise<string> => {
  const ui = await pane($)
  const label = String((await ui.find({ key: 'security-toggle-A' }))?.props?.label ?? '')
  await ui.unmount()
  return label.replace(/ /g, ' ')
}
const press = async ($: any, key: string) => {
  const ui = await pane($)
  await ui.press({ key })
  await ui.unmount()
}
const unreadLine = async ($: any): Promise<boolean> => {
  const ui = await pane($)
  const found = (await ui.find({ type: 'Text', text: /Réglage de la revue de sécurité illisible : revue considérée comme activée/ })) !== undefined
  await ui.unmount()
  return found
}
const record = (review: string, root = ROOT) => JSON.stringify({ v: 1, root, review, at: NOW - 1_000 })

test('projet jamais réglé : désactivée ; un clic l’active, un autre la désactive, chaque écriture pose la valeur entière', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await advisedGroup($)
  // Le bouton « ⛨ Revue de sécurité » reste, la bascule est à côté.
  const ui = await pane($)
  expect(await ui.find({ key: 'security-group-A' })).toBeDefined()
  await ui.unmount()
  expect(await toggleLabel($)).toBe('⛨ Sécurité : désactivée')
  expect(await unreadLine($)).toBe(false)
  expect(setting(w)).toBeUndefined()
  await press($, 'security-toggle-A')
  expect(setting(w)).toEqual({ v: 1, root: ROOT, review: 'on', at: NOW })
  expect(w.toasts.at(-1)).toBe('⛨ Revue de sécurité activée pour ce projet, sur ce poste.')
  expect(await toggleLabel($)).toBe('⛨ Sécurité : activée')
  await press($, 'security-toggle-A')
  expect(setting(w)?.review).toBe('off')
  expect(await toggleLabel($)).toBe('⛨ Sécurité : désactivée')
})

test('le fichier du réglage est sous le dossier personnel, USERPROFILE avant HOME ; sans dossier lisible, activée et le clic refuse', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await advisedGroup($)
  // HOME seul : le fichier sous <HOME>/.claude/flow-board/coordination/, quel que soit l'emplacement du mod.
  await press($, 'security-toggle-A')
  expect(Object.keys(w.files).filter(isSettingFile).map(p => p.startsWith(`${HOME_DIR}/.claude/flow-board/coordination/`))).toEqual([true])
  // USERPROFILE avant HOME (l'ordre de Claude Code sous Windows), barre finale mise à part.
  w.files = {}
  w.env.vars = { USERPROFILE: '/up/x/', HOME: HOME_DIR }
  await press($, 'security-toggle-A')
  expect(Object.keys(w.files).filter(isSettingFile).map(p => p.startsWith('/up/x/.claude/flow-board/coordination/'))).toEqual([true])
  // Une variable dont la lecture lève n'emporte pas l'autre.
  w.files = {}
  w.env.throwing = ['USERPROFILE']
  await press($, 'security-toggle-A')
  expect(Object.keys(w.files).filter(isSettingFile).map(p => p.startsWith(`${HOME_DIR}/.claude/`))).toEqual([true])
  // Aucun dossier personnel lisible : illisible, donc activée, et le clic n'écrit rien.
  w.files = {}
  w.env.vars = {}
  expect(await toggleLabel($)).toBe('⛨ Sécurité : activée')
  expect(await unreadLine($)).toBe(true)
  await press($, 'security-toggle-A')
  expect(w.toasts.at(-1)).toBe('⛨ Le réglage de la revue de sécurité ne se lit pas : rien n’est changé, réessaie.')
  expect(Object.keys(w.files).filter(isSettingFile)).toEqual([])
  expect(Object.keys(w.mem).filter(k => k.startsWith(SETTING_KEY))).toEqual([])
})

test('la valeur d’une autre discussion du projet se relit au rendu suivant, et un worktree lit celle du dépôt principal', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  // Une discussion d'un worktree de groupe : sa racine n'est pas celle du dépôt principal.
  w.seed.text = record('on')
  await advisedGroup($)
  expect(await toggleLabel($)).toBe('⛨ Sécurité : activée')
  const mainPaths = [...new Set(w.reads)]
  w.reads.length = 0
  w.env.root = `${ROOT}/.claude/worktrees/groupe-a`
  // Le moteur dit la racine dans une autre casse (un worktree sous Windows), et la racine écrite aussi : c'est
  // le même projet, au même fichier ou à la même clé.
  w.env.repoRoot = '/PROJ'
  w.seed.text = record('on', '/Proj')
  expect(await toggleLabel($)).toBe('⛨ Sécurité : activée')
  // En mode fichier, le worktree lit le fichier même que le dépôt principal.
  expect([...new Set(w.reads)]).toEqual(mainPaths)
  // Un clic d'ici écrit à la clé du dépôt principal (mode `$.store`) ou au même fichier.
  await press($, 'security-toggle-A')
  expect(setting(w)?.review).toBe('off')
  if (Object.keys(w.files).some(isSettingFile)) expect(Object.keys(w.files).filter(isSettingFile)).toEqual(mainPaths)
  // Une autre discussion clique : aucune valeur gardée, le rendu suivant la montre.
  w.seed.text = record('off')
  expect(await toggleLabel($)).toBe('⛨ Sécurité : désactivée')
})

test('le clic porte l’état visé : un réglage déjà dans cet état (affichage périmé) ne s’écrit pas', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await advisedGroup($)
  // L'écran montre « désactivée » ; entre-temps une autre discussion l'active.
  const ui = await pane($)
  w.seed.text = record('on')
  await ui.press({ key: 'security-toggle-A' })
  await ui.unmount()
  // Le clic visait « activée » : rien n'est écrit, jamais l'inverse.
  expect(setting(w)).toBeUndefined()
  expect(w.toasts.at(-1)).toBe('⛨ La revue de sécurité est déjà activée pour ce projet : rien n’est changé.')
})

test('fichier abîmé, vide, d’un autre projet ou à valeur inconnue : activée et signalée ; au clic, copié à côté puis remplacé, jamais effacé', { timeoutMs: 30000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await advisedGroup($)
  for (const text of ['{"v":1,"root":"/proj","review":"o', '', '   ', 'null', record('on', '/autre'), record('peut-être'), JSON.stringify({ v: 1, review: 'off' }), '[]']) {
    w.seed.text = text
    expect(await toggleLabel($), JSON.stringify(text)).toBe('⛨ Sécurité : activée')
    expect(await unreadLine($), JSON.stringify(text)).toBe(true)
  }
  const broken = '{"v":1,"root":"/proj","review":"o'
  w.seed.text = broken
  await press($, 'security-toggle-A')
  expect(asides(w)).toEqual([broken])
  expect(setting(w)?.review).toBe('off')
  expect(await unreadLine($)).toBe(false)
})

test('écriture refusée : l’état reste et un toast le dit ; aucun nouvel essai', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await advisedGroup($)
  w.fault.write = true
  await press($, 'security-toggle-A')
  expect(setting(w)).toBeUndefined()
  expect(w.toasts.at(-1)).toBe('⛨ Réglage non enregistré : la revue de sécurité reste désactivée.')
  expect(await toggleLabel($)).toBe('⛨ Sécurité : désactivée')
  // Activée, puis une désactivation refusée : elle reste activée.
  w.fault.write = false
  await press($, 'security-toggle-A')
  w.fault.write = true
  await press($, 'security-toggle-A')
  expect(setting(w)?.review).toBe('on')
  expect(w.toasts.at(-1)).toBe('⛨ Réglage non enregistré : la revue de sécurité reste activée.')
  // Un texte abîmé dont la copie à côté échoue : rien n'est écrit, ni la copie ni le réglage (le texte du
  // test remplace d'abord ce que le mod a écrit, qui le masquerait).
  for (const path of Object.keys(w.files).filter(isSettingFile)) delete w.files[path]
  delete w.mem[SETTING_KEY]
  w.seed.text = '{abîmé'
  w.fault.write = true
  await press($, 'security-toggle-A')
  expect(setting(w)).toBeUndefined()
  expect(asides(w)).toEqual([])
  expect(w.toasts.at(-1)).toBe('⛨ Réglage non enregistré : la revue de sécurité reste activée.')
})

test('moteur qui ne dit pas le dépôt, ou lecture qui lève : activée et signalée ; le clic refuse sans rien écrire', { timeoutMs: 30000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await advisedGroup($)
  for (const fault of ['throw', 'null'] as const) {
    w.fault.repo = fault
    expect(await toggleLabel($), fault).toBe('⛨ Sécurité : activée')
    expect(await unreadLine($), fault).toBe(true)
    await press($, 'security-toggle-A')
    // Un moteur qui ne répond pas : réessayer ; un projet hors git : pas de clé, la revue y reste activée.
    expect(w.toasts.at(-1)).toBe(fault === 'throw' ? '⛨ Le réglage de la revue de sécurité ne se lit pas : rien n’est changé, réessaie.' : '⛨ Ce projet n’a pas de dépôt git : son réglage ne se garde pas, la revue de sécurité y reste activée.')
  }
  w.fault.repo = false
  w.fault.read = true
  expect(await toggleLabel($)).toBe('⛨ Sécurité : activée')
  await press($, 'security-toggle-A')
  expect(w.toasts.at(-1)).toBe('⛨ Le réglage de la revue de sécurité ne se lit pas : rien n’est changé, réessaie.')
  expect(setting(w)).toBeUndefined()
  expect(asides(w)).toEqual([])
})

test('après un rechargement du mod, la même valeur se relit', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await advisedGroup($)
  await press($, 'security-toggle-A')
  // Le mod rechargé : `session.start` repasse ; le réglage se relit de son fichier ou de sa clé.
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true } as any)
  expect(await toggleLabel($)).toBe('⛨ Sécurité : activée')
  expect(setting(w)?.review).toBe('on')
})

test('la ligne de sécurité du lot sans groupes porte la bascule', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'T1', name: 'Un', blockedBy: [], logic: true }] } as any)
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'touche les jetons' } } as any)
  const ui = await pane($)
  expect(String((await ui.find({ key: 'security-toggle-lot' }))?.props?.label).replace(/ /g, ' ')).toBe('⛨ Sécurité : désactivée')
  await ui.press({ key: 'security-toggle-lot' })
  await ui.unmount()
  expect(setting(w)?.review).toBe('on')
})

test('l’effacement d’une mission laisse le réglage intact', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const run = { ...newRun('implement', NOW - 9_000_000, 'Lot à jeter'), status: 'done', archivedAt: NOW - 8_000_000, agents: [] } as Run
  w.mem[`board:${ROOT}`] = { ...emptyBoard(ROOT, 'proj'), runs: [run] }
  // Le réglage posé : le mod le lit à son vrai chemin (fichier) comme sous sa clé (`$.store`).
  w.seed.text = record('on')
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  w.touched.length = 0
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: 'archived-toggle' })
  await ui.press({ key: `drop-${run.id}` })
  await ui.press({ key: `drop-yes-${run.id}` })
  for (let i = 0; i < 2; i++) await clock.advance(1000)
  await ui.unmount()
  // La mission est bien effacée…
  const boardPath = Object.keys(w.files).find(isBoardFile)
  const board = (boardPath ? JSON.parse(w.files[boardPath]!) : w.mem[`board:${ROOT}`]) as { runs: Run[] }
  expect(board.runs.find(r => r.id === run.id)).toBeUndefined()
  // … et rien n'a touché au réglage : ni écriture, ni effacement, ni commande qui le nomme, dans les deux modes.
  expect(w.touched.length).toBeGreaterThan(0)
  expect(w.touched.filter(t => t.includes('revue-securite') || t.includes(SETTING_KEY))).toEqual([])
})
