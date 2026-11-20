import { expect, mock, test } from 'claude-code/testing'

import { SHORT_LAUNCH_FALLBACK, SHORT_LAUNCH_FOLLOW, isLaunchReceived, isShortLaunch, launchHow, shortLaunchHow } from '../hooks/decoupage.ts'
import type { Board } from '../types'

// Rétro (pistes mwinsd64-jvrt/p3 et mwinrqje-gkoq/p8) : la demande de lancement d'un groupe pesait environ 8 Ko et
// revenait presque identique à chaque groupe ; elle parlait d'Asana dans un projet sans Asana et faisait rappeler
// ListAgents alors que le mod venait d'écrire la référence du manager. À partir de la deuxième demande reçue dans une
// même discussion (depuis le démarrage du processus et sa dernière compaction), ses parties communes se remplacent par
// un renvoi à la demande entière ; la référence que ce processus a écrite est donnée telle quelle.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const LOT = {
  tickets: [
    { id: 'a1', name: 'Premier', files: ['a.ts'], sensitive: false, logic: true },
    { id: 'b1', name: 'Second', files: ['b.ts'], sensitive: false, logic: true },
    { id: 'c1', name: 'Troisième', files: ['c.ts'], sensitive: false, logic: true },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Données', tickets: ['b1'] },
    { id: 'C', name: 'Vue', tickets: ['c1'] },
  ],
}

const NOW = 80_000_000
const TMP = '/var/tmp/essai'
/** Un message de conversation : sans `messages`, le moteur de test saute le hook de compaction en silence. */
const MESSAGES = [{ role: 'user', text: 'x', toolUses: [] }]
const SHORT = shortLaunchHow(false)

type World = { mem: Record<string, unknown>; files: Record<string, string>; filled: string[]; turns: number }

const world = (on: any): World => {
  const w: World = { mem: {}, files: {}, filled: [], turns: 0 }
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: '/proj', remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'résumé', toolUses: [] }] }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: w.mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    w.mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('command.list', () => ({ value: [] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'TMPDIR' ? TMP : undefined }) as any)
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    if (e.path === TMP) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } } as any
    if (e.path in w.files) return { value: { kind: 'file', size: w.files[e.path]!.length, mtimeMs: 0, isLink: false, realPath: e.path } } as any
    throw new Error(`absent : ${e.path}`)
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in w.files }) as any)
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    w.files[e.path] = e.text
    return { value: undefined } as any
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in w.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: w.files[e.path] } as any
  })
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    w.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  return w
}

const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/** Une mission à trois groupes portée par cette discussion : rend son id. */
const mission = async ($: any, clock: any, w: World): Promise<string> => {
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  await clock.advance(1_000)
  const shared = Object.entries(w.files).find(([p]) => p.includes('/flow-board/parcours/'))?.[1]
  return ((shared ? JSON.parse(shared) : w.mem['board:']) as Board).runs[0]!.id
}

/** Le clic « lancer » d'un groupe : rend la demande mise dans la saisie. */
const launch = async ($: any, clock: any, w: World, group: string): Promise<string> => {
  const before = w.filled.length
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: `launch-linked-${group}` })
  await ui.unmount()
  await clock.advance(1_000)
  expect(w.filled.length).toBe(before + 1)
  return w.filled.at(-1)!
}

/** La demande envoyée (Entrée) : son tour commence, avec son texte. */
const received = async ($: any, w: World, text: string): Promise<void> => {
  await $.turn.start({ turnId: `t-${++w.turns}`, text } as any)
}

test('la deuxième demande reçue dans la discussion prend la forme courte ; après une compaction, la demande entière revient', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await mission($, clock, w)
  const first = await launch($, clock, w, 'A')
  // La première : entière, sans Asana dans un projet qui n'en a pas.
  expect(first).toContain('start_session')
  expect(first).toContain("Puis rendre les statuts des tickets faits pendant l'arrêt d'après le suivi des tickets. ")
  expect(first).not.toContain('Asana')
  expect(first).not.toContain(SHORT)
  await received($, w, first)
  const second = await launch($, clock, w, 'B')
  // Ce qui est propre au groupe reste : le groupe, son brief ; le reste renvoie à la demande entière.
  expect(second).toContain('Confie ce groupe à un worker')
  expect(second).toContain('Groupe B (Données)')
  expect(second).toMatch(/brief du groupe B : '[^']+flow-board-brief-[^']+-B-\d+\.md'/)
  expect(second).toContain(SHORT)
  expect(second).toContain(SHORT_LAUNCH_FOLLOW)
  // Décidée à l'écriture : une compaction ou un /clear avant l'envoi ôterait la demande entière ; la forme courte dit alors de ne rien lancer.
  expect(second).toContain("Si cette demande entière n'est plus dans ta conversation, mot pour mot (une compaction ou un /clear depuis), ne lance rien et dis-le-moi")
  expect(SHORT).toContain(SHORT_LAUNCH_FALLBACK)
  expect(second).not.toContain('start_session')
  expect(second).not.toContain('{"returned": ["<id du groupe>"]}')
  expect(second.length).toBeLessThan(first.length / 2)
  // Une compaction : la demande entière n'est plus sûre d'être dans la conversation.
  await $.session.compact({ trigger: 'manual', messages: MESSAGES } as any)
  const third = await launch($, clock, w, 'C')
  expect(third).toContain('start_session')
  expect(third).toContain('{"returned": ["<id du groupe>"]}')
  expect(third).not.toContain(SHORT)
})

test('une demande jamais envoyée ne compte pas ; après un rechargement, la demande entière revient', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await mission($, clock, w)
  const first = await launch($, clock, w, 'A')
  // Mise dans la saisie mais pas envoyée (ou retouchée avant Entrée) : la suivante reste entière.
  await received($, w, first.replace('start_session', 'start-session'))
  const second = await launch($, clock, w, 'B')
  expect(second).toContain('start_session')
  expect(second).not.toContain(SHORT)
  // Reçue cette fois (un texte plus long qui la contient compte), puis /reload-plugins : la demande entière revient.
  await received($, w, `${second}\n\nmerci`)
  await start($)
  const third = await launch($, clock, w, 'C')
  expect(third).toContain('start_session')
  expect(third).not.toContain(SHORT)
})

test('la référence écrite par ce processus est donnée sans ListAgents ; après un rechargement, ListAgents revient', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const runId = await mission($, clock, w)
  const first = await launch($, clock, w, 'A')
  expect(first).toContain("appelle d'abord ListAgents pour lire le nom de cette discussion et sa référence entre crochets")
  expect(first).toContain('ta référence entre crochets et ton nom du moment (lus par ListAgents)')
  await clock.advance(1_000)
  expect(((await $.tool.call({ tool: TOOL, resume: runId, main: '« Boutique » [a1b2c3]' } as any)).result as string)).toContain('Your reference of the moment is written next to the relay')
  const second = await launch($, clock, w, 'B')
  expect(second).toContain('Dans le CLI (pas de start_session) : ta référence est [a1b2c3] (flow-board la tient de ton dernier envoi')
  expect(second).toContain("ta référence entre crochets, [a1b2c3] (flow-board la tient de ton dernier envoi, depuis le démarrage de ce processus : ne rappelle pas ListAgents pour elle), avec en repli ton nom du moment s'il est déjà dans cette discussion")
  expect(second).not.toContain("appelle d'abord ListAgents")
  // Reçue, puis /reload-plugins (ou un redémarrage) : la référence a pu changer, ListAgents revient, et la demande est entière.
  await received($, w, second)
  await start($)
  const third = await launch($, clock, w, 'C')
  expect(third).toContain("appelle d'abord ListAgents pour lire le nom de cette discussion et sa référence entre crochets")
  expect(third).not.toContain('[a1b2c3]')
})

test('les fonctions pures : reçue seulement avec ses deux parties ; courte seulement aux parties identiques ; sans référence, le texte d’avant', () => {
  const parts = { how: 'comment lancer', follow: 'comment suivre' }
  expect(isLaunchReceived('… comment lancer … comment suivre', parts)).toBe(true)
  expect(isLaunchReceived('… comment lancer …', parts)).toBe(false)
  expect(isLaunchReceived(undefined, parts)).toBe(false)
  expect(isLaunchReceived('x', null)).toBe(false)
  expect(isLaunchReceived('x', { how: '', follow: '' })).toBe(false)
  expect(isShortLaunch(null, parts)).toBe(false)
  expect(isShortLaunch({ ...parts }, parts)).toBe(true)
  expect(isShortLaunch({ ...parts, how: 'comment lancer ' }, parts)).toBe(false)
  const o = { many: false, isRepo: true, ownFolder: true, title: 'Groupe <id> · <thème>', worktree: 'groupe-x-<id>', brief: true }
  expect(launchHow({ ...o, ref: null })).toBe(launchHow(o))
  expect(launchHow({ ...o, ref: '[a1b2c3]' })).not.toBe(launchHow(o))
})
