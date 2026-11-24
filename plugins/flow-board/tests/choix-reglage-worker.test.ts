import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, newRun, switchOnAuto } from '../hooks/model.ts'
import { autonomySettingPath } from '../hooks/autonomy-store.ts'
import type { Board, Run } from '../types'

// Dans un worker, un choix « Réglage : <case> : … » passe la vérification des cases avant le relais : refusé (case
// décochée, illisible, inconnue, mission hors auto), il n'est jamais écrit dans le fichier de relais, et la réponse dit
// de poser la question au manager par message. Invariant : « Une mission ne tranche jamais seule une sorte de question
// dont tu n'as pas coché la case par un clic ; une case absente, illisible ou mal lue vaut décochée, et la question t'est
// posée. »

const T0 = 1_000_000
const TOOL = 'mcp__flow-board__flow'
const ROOT = 'C:/proj'
const CASES = autonomySettingPath('/h/.claude', ROOT)
const OFF = { experience: false, invariant: false, contradiction: false, spend: false, reread: false }

/** La mission du manager, tenue par sa discussion « session-M » : auto allumé ou éteint. */
const managerBoard = (isAuto: boolean): Board => {
  const run: Run = { ...newRun('implement', T0, 'Boutique'), id: 'mboutique1', owner: 'session-M', claim: { boot: 'boot-M', at: T0 } }
  const board: Board = { ...emptyBoard('', 'p'), root: ROOT, session: 'session-M', boot: 'boot-M', deleted: [], runs: [run], activeId: run.id }
  return isAuto ? switchOnAuto(board, 'session-M', T0 + 1_000)!.board : board
}

type World = { mem: Record<string, unknown>; files: Record<string, string>; main: { text: string | null } }

/** Un worker dans un worktree de « C:/proj » : la mission vit dans le board du dépôt principal ; les cases sous `/h`. */
const world = (on: any): World => {
  const w: World = { mem: {}, files: {}, main: { text: null } }
  const isMainFile = (path: string) => path.endsWith('/flow-board/parcours/c-proj.json')
  on('fs.list', (_$: unknown, e: { path: string }) => {
    throw new Error(`ENOENT ${e.path}`)
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-W' }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: 'C:/proj/.claude/worktrees/groupe-b' }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: w.mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    w.mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isMainFile(e.path) ? w.main.text !== null : e.path in w.files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isMainFile(e.path) && w.main.text !== null) return { value: w.main.text } as any
    if (!(e.path in w.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: w.files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (!isMainFile(e.path)) w.files[e.path] = e.text
    return { value: undefined } as any
  })
  return w
}

/** La mission du manager posée dans le dépôt principal, aux deux endroits où le mod peut la lire. */
const seed = (w: World, board: Board) => {
  w.mem['board:c:/proj'] = JSON.parse(JSON.stringify(board))
  w.main.text = JSON.stringify(board)
}
const setCases = (w: World, cases: Partial<typeof OFF>) => {
  w.files[CASES] = JSON.stringify({ v: 1, root: ROOT, cases: { ...OFF, ...cases }, at: T0 })
}
/** Les choix que le relais du worker porte : son fichier d'entrée, ou sa clé de `$.store`. */
const relayed = (w: World): string[] => {
  const texts = [...Object.entries(w.files).filter(([p]) => p.includes('/flow-board/relais/')).map(([, t]) => t), ...Object.entries(w.mem).filter(([k]) => k.startsWith('relay:')).map(([, v]) => JSON.stringify(v))]
  return texts.flatMap(t => [...t.matchAll(/"what":"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse(`"${m[1]}"`) as string))
}
const start = async ($: any) => {
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.tool.call({ tool: TOOL, delegate: 'mboutique1', group: 'B', main: '[0a1b2c]' } as any)
}
const call = async ($: any, what: string): Promise<string> => String((await $.tool.call({ tool: TOOL, decided: [{ what }] } as any)).result)

test('worker, case cochée : le choix de réglage est relayé', async ($, on) => {
  mock.clock(on, { now: T0 + 10_000 })
  const w = world(on)
  seed(w, managerBoard(true))
  setCases(w, { spend: true })
  await start($)
  const text = await call($, 'Réglage : Dépense ou action externe : installer jq')
  expect(text).not.toContain('refused')
  expect(relayed(w)).toContain('Réglage : Dépense ou action externe : installer jq')
})

test('worker, case décochée : refusé avant le relais, jamais écrit dans le fichier de relais, la question au manager par message', async ($, on) => {
  mock.clock(on, { now: T0 + 10_000 })
  const w = world(on)
  seed(w, managerBoard(true))
  setCases(w, { experience: true })
  await start($)
  const text = await call($, 'Réglage : Dépense ou action externe : installer jq')
  expect(text).toContain('the box « Dépense ou action externe » is not ticked')
  expect(text).toContain('ask your manager the question by SendMessage instead')
  expect(relayed(w)).not.toContain('Réglage : Dépense ou action externe : installer jq')
  expect(text).not.toContain('Relayed to the manager\'s dashboard: 1 choice')
})

test('worker : cases illisibles ou mission hors auto, refusé ; un choix ordinaire passe comme avant', async ($, on) => {
  mock.clock(on, { now: T0 + 10_000 })
  const w = world(on)
  seed(w, managerBoard(true))
  w.files[CASES] = '{abîmé'
  await start($)
  expect(await call($, 'Réglage : Invariant d\'un ticket : rien ne s’efface')).toContain('the autonomy boxes cannot be read')
  setCases(w, { invariant: true })
  seed(w, managerBoard(false))
  expect(await call($, 'Réglage : Invariant d\'un ticket : rien ne s’efface')).toContain('not in auto mode')
  expect(relayed(w).some(t => t.startsWith('Réglage'))).toBe(false)
  await call($, 'Option A retenue')
  expect(relayed(w)).toContain('Option A retenue')
})

test('worker, premier appel qui porte « delegate » et un choix de réglage : vérifié avant le relais, refusé sans fichier des cases', async ($, on) => {
  mock.clock(on, { now: T0 + 10_000 })
  const w = world(on)
  seed(w, managerBoard(true))
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  const text = String((await $.tool.call({ tool: TOOL, delegate: 'mboutique1', group: 'B', main: '[0a1b2c]', decided: [{ what: 'Réglage : Dépense ou action externe : installer jq' }] } as any)).result)
  // Sans fichier des cases (et un dossier qui ne se liste pas ici : lecture ratée), le choix est refusé.
  expect(text).toContain('"Réglage : Dépense ou action externe : installer jq" refused, not kept')
  expect(relayed(w).some(t => t.startsWith('Réglage'))).toBe(false)
  expect(text).toContain('the autonomy boxes cannot be read')
})

test('worker, premier appel qui porte « delegate » et un choix de réglage, case cochée : relayé', async ($, on) => {
  mock.clock(on, { now: T0 + 10_000 })
  const w = world(on)
  seed(w, managerBoard(true))
  setCases(w, { spend: true })
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  const text = String((await $.tool.call({ tool: TOOL, delegate: 'mboutique1', group: 'B', main: '[0a1b2c]', decided: [{ what: 'Réglage : Dépense ou action externe : installer jq' }] } as any)).result)
  expect(text).not.toContain('refused, not kept')
  expect(relayed(w)).toContain('Réglage : Dépense ou action externe : installer jq')
})

test('worker : les cases relues à chaque appel, une case décochée entre deux appels fait refuser le second', async ($, on) => {
  mock.clock(on, { now: T0 + 10_000 })
  const w = world(on)
  seed(w, managerBoard(true))
  setCases(w, { reread: true })
  await start($)
  expect(await call($, 'Réglage : Relecture après la fusion : groupe A fusionné')).not.toContain('refused')
  setCases(w, {})
  expect(await call($, 'Réglage : Relecture après la fusion : groupe B fusionné')).toContain('is not ticked')
  expect(relayed(w).filter(t => t.startsWith('Réglage'))).toEqual(['Réglage : Relecture après la fusion : groupe A fusionné'])
})

test('worker : le rappel « choix d’expérience » n’est pas ajouté à un choix gardé sous « Choix d’expérience », il l’est pour un autre', async ($, on) => {
  mock.clock(on, { now: T0 + 10_000 })
  const w = world(on)
  seed(w, managerBoard(true))
  setCases(w, { experience: true })
  await start($)
  expect(await call($, 'Réglage : Choix d\'expérience : libellé du bouton « Lancer »')).not.toContain('reads like an experience choice')
  expect(await call($, 'Libellé du bouton « Arrêter »')).toContain('reads like an experience choice')
})
