import { expect, mock, test } from 'claude-code/testing'

import { emptyBoard, newRun, restoreDelegate } from '../hooks/model.ts'
import { isMainRefNewer, MAIN_REF_FUTURE_MS, mainRefAsk, mainRefAskText, newestMainRef, parseMainRef, type MainRef } from '../hooks/relay.ts'
import type { Board, Run } from '../types'

// La référence du manager réécrite à son démarrage : après un redémarrage sans `resume`, les réponses de
// l'outil avaient donné l'ancienne référence au groupe D pendant une heure. Le mod ne connaît pas la
// référence « [ref] » que ListAgents montre : à chaque démarrage ou rechargement, une mission portée ici avec
// des groupes confiés la demande à Claude, qui l'envoie avec `resume`, seul chemin qui l'écrit.
// Invariant : la référence n'est écrite que par la discussion qui porte la mission ; jamais réécrite
// vide ni remplacée par une plus ancienne.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const
const NOW = 90_000_000
const LOT = {
  tickets: [
    { id: 'a1', name: 'Premier', files: ['a.ts'], sensitive: false, logic: true },
    { id: 'b1', name: 'Second', files: ['b.ts'], sensitive: false, logic: true },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Données', tickets: ['b1'] },
  ],
}

type World = { mem: Record<string, unknown>; files: Record<string, string>; context: string[][]; failWrite: { file: boolean; store: boolean }; failRead: boolean; hangStore: boolean; sid: string }

const world = (on: any): World => {
  const w: World = { mem: {}, files: {}, context: [], failWrite: { file: false, store: false }, failRead: false, hangStore: false, sid: 'session-A' }
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  // L'id du moment : un /clear en donne un nouveau, sans recharger le mod.
  on('session.id', () => ({ value: w.sid }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: w.sid }))
  on('command.list', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }) as any)
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: w.mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (w.failWrite.store && e.key.startsWith('relay-main:')) throw new Error('stockage plein')
    if (w.hangStore && e.key.startsWith('relay-main:')) return new Promise(() => undefined)
    w.mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in w.files }) as any)
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    throw new Error(`absent : ${e.path}`)
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (w.failRead && e.path.includes('/flow-board/parcours/')) throw new Error(`EIO ${e.path}`)
    if (!(e.path in w.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: w.files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (w.failWrite.file && e.path.endsWith('.main.json')) throw new Error('disque plein')
    w.files[e.path] = e.text
    return { value: undefined } as any
  })
  on('prompt.fill', () => ({ isFilled: true }))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    w.context.push([...(e.context ?? [])])
    return { text: e.text }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  return w
}

const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/** L'id de la mission : dans le fichier commun des missions quand il s'écrit, dans `$.store` sinon. */
const runIdOf = (w: World): string => {
  const shared = Object.entries(w.files).find(([p]) => p.includes('/flow-board/parcours/'))?.[1]
  return ((shared ? JSON.parse(shared) : w.mem['board:']) as Board).runs[0]!.id
}

/** Le chemin du fichier de la référence, quand le dossier du mod dit où est ~/.claude (sinon, `$.store` seul). */
const refFile = (w: World): string | undefined => Object.keys(w.files).find(p => p.endsWith('.main.json'))

/** Les deux copies de la référence, et la plus récente : ce que lit un worker. */
const refs = (w: World, runId: string): { file: MainRef | null; store: MainRef | null; newest: MainRef | null } => {
  const path = refFile(w)
  const file = path ? parseMainRef(JSON.parse(w.files[path]!), runId) : null
  const store = parseMainRef(w.mem[`relay-main:${runId}`], runId)
  return { file, store, newest: newestMainRef(file, store) }
}

/** Une mission à deux groupes dans cette discussion, le groupe A confié à un worker : rend son id. */
const missionWithWorker = async ($: any, clock: any, w: World): Promise<string> => {
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Relais', ...LOT } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  // La sauvegarde de la mission part sur une minuterie.
  await clock.advance(1_000)
  return runIdOf(w)
}

/** Un tour du fil principal : rend le contexte que le mod lui a ajouté. */
const turn = async ($: any, w: World): Promise<string[]> => {
  await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any)
  return w.context.at(-1) ?? []
}

const askOf = (context: string[]): string | undefined => context.find(c => c.includes('"main": "[<ref>]"'))

test('une écriture de la référence qui ne rend jamais la main compte comme ratée : ni l’outil ni l’écriture suivante ne l’attendent', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const runId = await missionWithWorker($, clock, w)
  w.hangStore = true
  const pending = $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)
  for (let i = 0; i < 16; i++) await clock.advance(1_000)
  expect(((await pending).result as string)).toContain('send it again later')
  // L'écriture suivante n'attend pas la suspendue.
  w.hangStore = false
  await clock.advance(1_000)
  expect(((await $.tool.call({ tool: TOOL, resume: runId, main: '[d4e5f6]' } as any)).result as string)).toContain('Your reference of the moment is written next to the relay')
})

test('une mission portée ici avec un groupe confié : chaque démarrage ou rechargement demande la référence, que la reprise écrit', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const runId = await missionWithWorker($, clock, w)
  // Le premier tour depuis ce démarrage : la demande, avec la commande exacte.
  const ask = askOf(await turn($, w))
  expect(ask).toContain(`{"resume": ${JSON.stringify(runId)}, "main": "[<ref>]"}`)
  expect(ask).toContain('Call ListAgents')
  await clock.advance(1_000)
  const answer = (await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)).result as string
  expect(answer).toContain('Your reference of the moment is written next to the relay')
  expect(refs(w, runId).newest).toMatchObject({ main: '[a1b2c3]', at: NOW + 2_000 })
  // Écrite : plus de demande jusqu'au prochain démarrage.
  expect(askOf(await turn($, w))).toBeUndefined()
  // /reload-plugins (ou un redémarrage) : la référence a pu changer, la demande revient.
  await clock.advance(60_000)
  await start($)
  expect(askOf(await turn($, w))).toBeDefined()
  await clock.advance(1_000)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[d4e5f6]' } as any)
  const after = refs(w, runId)
  expect(after.newest).toMatchObject({ main: '[d4e5f6]', at: NOW + 63_000 })
  // Les deux copies sont écrites (le fichier quand le dossier du mod le permet).
  expect(after.store).toMatchObject({ main: '[d4e5f6]' })
  if (refFile(w)) expect(after.file).toMatchObject({ main: '[d4e5f6]' })
})

test('après un /clear, la discussion porte toujours la mission : la référence se redemande et s’écrit', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const runId = await missionWithWorker($, clock, w)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)
  // /clear : nouvel id du moment, la mission reste active ici (son owner suit l'id de la discussion, pas celui du moment).
  await $.session.end({ reason: 'clear' } as any)
  w.sid = 'session-B'
  await start($)
  expect(askOf(await turn($, w))).toBeDefined()
  await clock.advance(1_000)
  const answer = (await $.tool.call({ tool: TOOL, resume: runId, main: '[b2c3d4]' } as any)).result as string
  expect(answer).toContain('Your reference of the moment is written next to the relay')
  expect(refs(w, runId).newest).toMatchObject({ main: '[b2c3d4]' })
})

test('une mission laissée en pause (fin de la discussion) : rien n’est demandé, puis la reprise la redemande', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const runId = await missionWithWorker($, clock, w)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)
  // La discussion se ferme : la mission passe en pause, sans owner ; personne ne la porte.
  await $.session.end({ reason: 'exit' } as any)
  await start($)
  expect(askOf(await turn($, w))).toBeUndefined()
  // Reprise sans référence : la mission est de nouveau portée ici, la demande vient au tour suivant.
  await clock.advance(1_000)
  await $.tool.call({ tool: TOOL, resume: runId } as any)
  expect(askOf(await turn($, w))).toBeDefined()
  await clock.advance(1_000)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[e5f6g7]' } as any)
  expect(refs(w, runId).newest).toMatchObject({ main: '[e5f6g7]' })
  expect(askOf(await turn($, w))).toBeUndefined()
})

test('sans groupe confié, rien n’est demandé ; une référence vide, un gabarit ou une valeur hors forme n’écrit rien', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Relais', ...LOT } as any)
  await clock.advance(1_000)
  const runId = runIdOf(w)
  // L'effet d'abord : une référence en forme s'écrit, même sans groupe confié (la reprise l'envoie).
  expect((await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)).result as string).toContain('is written next to the relay')
  expect(refs(w, runId).newest).toMatchObject({ main: '[a1b2c3]' })
  // Sans groupe confié, aucune demande.
  expect(askOf(await turn($, w))).toBeUndefined()
  // Une référence vide ne dit rien et n'écrit rien ; un gabarit recopié ou une valeur sans [ref] est refusé et dit.
  await clock.advance(1_000)
  expect((await $.tool.call({ tool: TOOL, resume: runId, main: '   ' } as any)).result as string).not.toContain('reference')
  for (const main of ['[<ref>]', '[?]', 'Manager', '[ab]', '[a1b2c3]\u200b x']) {
    await clock.advance(1_000)
    const answer = (await $.tool.call({ tool: TOOL, resume: runId, main } as any)).result as string
    expect(answer).toContain('Your reference was not written: "main" must end with your [ref]')
  }
  expect(refs(w, runId).newest).toMatchObject({ main: '[a1b2c3]', at: NOW + 1_000 })
  // « <nom> [ref] » est une forme admise.
  await clock.advance(1_000)
  await $.tool.call({ tool: TOOL, resume: runId, main: 'Pistes de rétro [d4e5f6]' } as any)
  expect(refs(w, runId).newest).toMatchObject({ main: 'Pistes de rétro [d4e5f6]' })
})

test('un spécialiste n’écrit jamais la référence du manager', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const runId = await missionWithWorker($, clock, w)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)
  expect(refs(w, runId).newest).toMatchObject({ main: '[a1b2c3]' })
  await clock.advance(1_000)
  await $.tool.call({ tool: TOOL, agentId: 'agent-1', resume: runId, main: '[zzzzzz]' } as any)
  expect(refs(w, runId).newest).toMatchObject({ main: '[a1b2c3]' })
})

test('un worker n’écrit jamais la référence du manager, même avec resume et main', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const runId = await missionWithWorker($, clock, w)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)
  expect(refs(w, runId).newest).toMatchObject({ main: '[a1b2c3]' })
  // Cette discussion devient le worker du groupe A : ni demande, ni écriture.
  await clock.advance(1_000)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'A', main: '[a1b2c3]' } as any)
  expect(askOf(await turn($, w))).toBeUndefined()
  await clock.advance(1_000)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[zzzzzz]' } as any)
  expect(refs(w, runId).newest).toMatchObject({ main: '[a1b2c3]' })
})

test('une référence plus récente en place n’est jamais remplacée ; une date au-delà de la marge ne compte pas', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const runId = await missionWithWorker($, clock, w)
  // Une référence plus récente que l'heure de cette discussion, dans la marge (une autre horloge un peu en avance).
  w.mem[`relay-main:${runId}`] = { v: 1, run: runId, main: '[recent]', at: NOW + 60_000 }
  const refused = (await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)).result as string
  expect(refused).toContain('a newer one is already next to the relay')
  expect(refs(w, runId).newest).toMatchObject({ main: '[recent]' })
  // La demande s'arrête aussi : la reprise a eu lieu.
  expect(askOf(await turn($, w))).toBeUndefined()
  // Au-delà de la marge, la date n'est pas une date : la référence du moment la remplace.
  w.mem[`relay-main:${runId}`] = { v: 1, run: runId, main: '[futur]', at: NOW + MAIN_REF_FUTURE_MS + 120_000 }
  await clock.advance(1_000)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)
  expect(refs(w, runId).store).toMatchObject({ main: '[a1b2c3]', at: NOW + 2_000 })
})

test('une écriture ratée laisse l’ancienne référence lisible, et la réponse le dit quand rien ne s’écrit', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const runId = await missionWithWorker($, clock, w)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)
  // Le fichier ne s'écrit plus : la copie de `$.store` porte la nouvelle, le fichier garde l'ancienne, lisible.
  w.failWrite.file = true
  await clock.advance(1_000)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[d4e5f6]' } as any)
  const one = refs(w, runId)
  expect(one.newest).toMatchObject({ main: '[d4e5f6]' })
  if (refFile(w)) expect(one.file).toMatchObject({ main: '[a1b2c3]' })
  // Plus rien ne s'écrit : la dernière écrite reste, et la réponse le dit.
  w.failWrite.store = true
  await clock.advance(1_000)
  const failed = (await $.tool.call({ tool: TOOL, resume: runId, main: '[g7h8i9]' } as any)).result as string
  expect(failed).toContain('could not be written next to the relay')
  expect(refs(w, runId).newest).toMatchObject({ main: '[d4e5f6]' })
  // Après un rechargement : la demande revient ; une tentative ratée la laisse, jusqu'à trois (sinon chaque tour la
  // referait, et chaque reprise recite les comptes rendus), la réponse ayant dit de renvoyer plus tard.
  await start($)
  for (let i = 0; i < 3; i++) {
    expect(askOf(await turn($, w))).toBeDefined()
    await clock.advance(1_000)
    expect((await $.tool.call({ tool: TOOL, resume: runId, main: '[j0k1l2]' } as any)).result as string).toContain('send it again later')
  }
  expect(askOf(await turn($, w))).toBeUndefined()
  expect(refs(w, runId).newest).toMatchObject({ main: '[d4e5f6]' })
  // Une reprise ici (sans référence) rouvre la demande.
  await $.tool.call({ tool: TOOL, resume: runId } as any)
  expect(askOf(await turn($, w))).toBeDefined()
})

test('le fichier des missions illisible juste avant l’écriture : rien n’est écrit, et la réponse le dit', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const runId = await missionWithWorker($, clock, w)
  await $.tool.call({ tool: TOOL, resume: runId, main: '[a1b2c3]' } as any)
  const shared = Object.keys(w.files).find(p => p.includes('/flow-board/parcours/'))
  // Sans fichier commun (le dossier du mod ne dit pas où est ~/.claude), rien à rendre illisible.
  if (!shared) return
  expect(refs(w, runId).newest).toMatchObject({ main: '[a1b2c3]' })
  // Une lecture qui échoue (pas un contenu abîmé, que la sauvegarde de la reprise réécrirait avant la relecture).
  w.failRead = true
  await clock.advance(1_000)
  const answer = (await $.tool.call({ tool: TOOL, resume: runId, main: '[d4e5f6]' } as any)).result as string
  expect(answer).toContain('the missions file could not be re-read just before')
  expect(refs(w, runId).newest).toMatchObject({ main: '[a1b2c3]' })
})

test('mainRefAsk : seulement la discussion qui porte la mission active, avec un groupe confié, pas encore écrite', () => {
  const linked: Run = { ...newRun('implement', 1_000, 'Lot'), owner: 's', groups: [{ id: 'A', name: 'Code', tickets: ['a1'], linked: { at: 1_500 } }] } as Run
  const board = (run: Run, extra: Partial<Board> = {}): Board => ({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id, ...extra })
  expect(mainRefAsk(board(linked), 's', new Set())).toBe(linked)
  // Une autre discussion (ou un id inconnu), un worker, une mission sans groupe confié, une mission déjà écrite : rien.
  expect(mainRefAsk(board(linked), 'autre', new Set())).toBeNull()
  expect(mainRefAsk(board(linked), '', new Set())).toBeNull()
  expect(mainRefAsk(board(linked, { delegate: { run: linked.id, at: 2_000 } }), 's', new Set())).toBeNull()
  expect(mainRefAsk(board({ ...linked, groups: [{ id: 'A', name: 'Code', tickets: ['a1'] }] }), 's', new Set())).toBeNull()
  expect(mainRefAsk(board(linked), 's', new Set([linked.id]))).toBeNull()
  expect(mainRefAsk(board({ ...linked, status: 'paused' }), 's', new Set())).toBeNull()
  expect(mainRefAsk(null, 's', new Set())).toBeNull()
  // Le titre passe neutralisé, l'id en JSON.
  expect(mainRefAskText({ ...linked, title: 'Lot\u0000 [x]' })).not.toContain('\u0000')
})

test('isMainRefNewer et newestMainRef : jamais une plus ancienne sur une plus récente', () => {
  const ref = (main: string, at: number): MainRef => ({ v: 1, run: 'r', main, at })
  expect(isMainRefNewer(null, ref('[a]', 10))).toBe(true)
  expect(isMainRefNewer(ref('[a]', 10), ref('[b]', 11))).toBe(true)
  expect(isMainRefNewer(ref('[a]', 10), ref('[b]', 10))).toBe(false)
  expect(isMainRefNewer(ref('[a]', 20), ref('[b]', 10))).toBe(false)
  expect(newestMainRef(ref('[a]', 10), ref('[b]', 20))).toMatchObject({ main: '[b]' })
  expect(newestMainRef(ref('[a]', 20), ref('[b]', 10))).toMatchObject({ main: '[a]' })
  expect(newestMainRef(null, ref('[b]', 10))).toMatchObject({ main: '[b]' })
  expect(newestMainRef(ref('[a]', 10), null)).toMatchObject({ main: '[a]' })
  expect(newestMainRef(null, null)).toBeNull()
})

test('restoreDelegate garde la date de la référence suivie, bornée', () => {
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [], activeId: null }
  const kept = { run: 'r1', at: 5_000, group: 'A', main: '[newref]', mainAt: 6_000 }
  expect(restoreDelegate(board, kept, 7_000).delegate).toMatchObject({ main: '[newref]', mainAt: 6_000 })
  // Une date avant la déclaration, illisible, au-delà de 1e13 ou de la marge dans le futur, sans référence ou hors forme : pas de date suivie.
  for (const bad of [{ ...kept, mainAt: 4_000 }, { ...kept, mainAt: 'x' }, { ...kept, mainAt: 2e13 }, { ...kept, mainAt: Number.NaN }, { ...kept, mainAt: 7_000 + MAIN_REF_FUTURE_MS + 1 }, { ...kept, main: '' }, { ...kept, main: '[x]' }]) {
    expect(restoreDelegate(board, bad, 7_000).delegate?.mainAt).toBeUndefined()
  }
})


test('parseMainRef : une référence en forme, une date dans la marge', () => {
  expect(parseMainRef({ run: 'r', main: '[a1b2c3]', at: 10 }, 'r')).toMatchObject({ main: '[a1b2c3]' })
  expect(parseMainRef({ run: 'r', main: 'Nom [a1b2c3]', at: 10 }, 'r')).toMatchObject({ main: 'Nom [a1b2c3]' })
  for (const main of ['[<ref>]', '', '   ', '[A1B2]', 'a1b2c3']) expect(parseMainRef({ run: 'r', main, at: 10 }, 'r')).toBeNull()
  expect(parseMainRef({ run: 'r', main: '[a1b2c3]', at: 10 + MAIN_REF_FUTURE_MS + 1 }, 'r', 10)).toBeNull()
  expect(parseMainRef({ run: 'r', main: '[a1b2c3]', at: 10 + MAIN_REF_FUTURE_MS }, 'r', 10)).toMatchObject({ main: '[a1b2c3]' })
})
