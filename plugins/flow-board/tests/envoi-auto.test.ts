// L'envoi du mode auto : à la fin d'un tour de la discussion qui porte le parcours, la phase finie, le
// mod envoie lui-même la suite du bouton de l'étape suivante, par `$.command.run`, après avoir relu le
// fichier de parcours et posé sa marque « envoyée » dedans. Invariant : une même action auto n'est
// jamais envoyée deux fois. Une lecture ratée n'envoie rien et éteint l'auto ; une écriture ratée de
// la marque n'envoie rien et le met en pause ; un envoi resté sans suite devient une question avec
// « ↻ Renvoyer » ; le rapport écrit et le quota l'arrêtent ; un fichier seul ne le rallume pas.

import { expect, mock, test } from 'claude-code/testing'

import { applyReport, autoActionOf, autoDecision, autoMarksOf, clampFuture, emptyBoard, isAutoLitBy, markAutoSent, markAutoStarted, mergeBoards, newRun, openQuestions, raiseRelaunchQuestions, raiseStaleAutoSends, resendAutoMark, unmarkAutoSent } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const T0 = 120_000_000
const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 140, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')

/**
 * Le moteur sous le plugin : le board dans le fichier commun (ou `$.store`), l'id de la discussion
 * (`ids.now`), une lecture ou une écriture du fichier de parcours que le test fait rater, `$.store` qui
 * refuse d'écrire, et les commandes que le mod lance (`runs`, avec le board écrit au moment de l'appel),
 * dont la prochaine peut être refusée (`refuseNext`).
 */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const disk: { board?: string; isUsed: boolean } = { isUsed: false }
  const ids = { now: 'sa' }
  const flags = { unreadable: false, unwritable: false, storeRefuses: false, refuseNext: false }
  const runs: { command: string; args: string; origin: any; stored: Board | undefined }[] = []
  const notices: string[] = []
  const stored = (): Board | undefined => (disk.isUsed && disk.board !== undefined ? JSON.parse(disk.board) : (mem['board:'] as Board | undefined))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: ids.now }))
  on('store.get', (_$: unknown, e: { key: string }) => {
    if (flags.unreadable && e.key === 'board:') throw new Error('EIO')
    return { value: mem[e.key] }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (flags.storeRefuses && e.key.startsWith('auto-confirm:')) throw new Error('EACCES')
    if (flags.unwritable && e.key === 'board:') throw new Error('EROFS')
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    delete mem[e.key]
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isBoardFile(e.path) ? disk.board !== undefined : e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      if (flags.unreadable || disk.board === undefined) throw new Error(`EIO ${e.path}`)
      return { value: disk.board } as any
    }
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      if (flags.unwritable) throw new Error(`EROFS ${e.path}`)
      disk.board = e.text
    } else files[e.path] = e.text
    return { value: undefined } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: ids.now }))
  on('command.list', () => ({ value: [] }))
  on('command.run', (_$: unknown, e: { command: string; args: string; origin: any }) => {
    runs.push({ command: e.command, args: e.args, origin: e.origin, stored: stored() })
    if (flags.refuseNext) {
      flags.refuseNext = false
      throw new Error('refusée par l’hôte')
    }
    return { text: '' }
  })
  on('prompt.fill', () => ({ isFilled: true }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('prompt.suggest', () => ({ isShown: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.notify', (_$: unknown, e: { text: string }) => {
    notices.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('classic.StopFailure', () => ({}))
  on('classic.SessionStart', () => ({}))
  return { mem, disk, ids, flags, runs, notices, stored }
}
type World = ReturnType<typeof world>
/** Pose un board enregistré, au fichier commun comme dans `$.store` (selon que le dossier du mod dit où est ~/.claude). */
const seed = (w: World, value: unknown) => {
  w.mem['board:'] = JSON.parse(JSON.stringify(value))
  w.disk.board = JSON.stringify(value)
}

const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key })
  await pane.unmount()
}
const paneHas = async ($: any, key: string): Promise<boolean> => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const found = (await pane.find({ key })) !== undefined
  await pane.unmount()
  return found
}
const bandText = async ($: any): Promise<string> => {
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  const texts = (await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '')).join(' | ')
  await band.unmount()
  return texts
}
/** Une fin de tour répondu de la discussion, puis le délai de l'envoi. */
const turnEnd = async ($: any, clock: { advance: (ms: number) => Promise<void> }, turnId = 't1') => {
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId, reason: 'answer' })
  await settle(clock, 1)
}
const autoOf = (w: World) => w.stored()?.runs[0]?.auto
const marksOf = (w: World) => w.stored()?.runs[0]?.autoSent ?? []

/** Un parcours « De la spec au code », actif dans la discussion « sa », titré, auto allumé (ou non), spec finie (ou non). */
const specDone = async ($: any, on: any, o: { isAuto?: boolean; isDone?: boolean } = {}) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique' } as any)
  if (o.isAuto !== false) {
    await press($, 'auto-on')
    await press($, 'auto-confirm')
    // Le clic, au repos, fait évaluer l'auto : la phase n'étant pas finie, rien ne part.
    await settle(clock, 1)
  }
  if (o.isDone !== false) await $.tool.call({ tool: TOOL, complete: true } as any)
  await settle(clock, 1)
  return { clock, ...w }
}

test('La phase finie, la fin du tour envoie la suite une fois, par $.command.run au nom du mod, sa marque déjà dans le fichier ; ni deux fois, ni après /reload-plugins', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on)
  await turnEnd($, clock)
  expect(w.runs.map(r => r.command)).toEqual(['mattpocock-skills:to-tickets'])
  expect(w.runs[0]!.origin).toMatchObject({ kind: 'plugin', name: PLUGIN })
  // La marque « envoyée » est écrite dans le fichier de parcours avant l'envoi.
  expect(w.runs[0]!.stored!.runs[0]!.autoSent).toEqual([expect.objectContaining({ key: 'phase:to-tickets#1', at: expect.any(Number) })])
  // Revenue de l'envoi, la commande a démarré.
  await settle(clock, 1)
  expect(marksOf(w)[0]).toMatchObject({ key: 'phase:to-tickets#1', startedAt: expect.any(Number) })
  // Le tour suivant (le skill n'a pas fait avancer la phase ici) ne la renvoie pas.
  await turnEnd($, clock, 't2')
  // /reload-plugins : le mod redémarre, l'état reste ; rien ne repart.
  await start($)
  await turnEnd($, clock, 't3')
  expect(w.runs.length).toBe(1)
})

test('Rien ne part sans l’auto, ni d’une autre discussion après un /clear, ni quand une question bloque la suite ; une question et rien en vol : pause « plus rien ne peut avancer sans toi »', { timeoutMs: 30000 }, async ($, on) => {
  // Sans auto : la phase finie ne fait rien partir.
  const off = await specDone($, on, { isAuto: false })
  await turnEnd($, off.clock)
  expect(off.runs).toEqual([])
  // Allumé ici, une question qui bloque la phase suivante : rien ne part, et l'auto se met en pause.
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', phase: 'to-tickets', text: 'Quelle granularité ?' }] } as any)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await turnEnd($, off.clock, 't2')
  expect(off.runs).toEqual([])
  expect(autoOf(off)).toMatchObject({ offWhy: 'plus rien ne peut avancer sans toi' })
  expect(off.notices).toContain("Parcours Boutique : auto en pause (plus rien ne peut avancer sans toi)")
  // Répondue et rallumé : la suite part (le contrôle positif des deux cas ci-dessus).
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'q1', answered: true }] } as any)
  // Rallumé pendant un tour : la suite attend la fin d'un tour.
  await $.turn.start({ text: 'x', turnId: 't3a' })
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(off.clock, 1)
  expect(off.runs).toEqual([])
  // Après un /clear (une autre discussion), rien ne part.
  // Comme le moteur : `session.end` (clear), puis `classic.SessionStart` sous le nouvel id.
  const clear = async (id: string) => {
    await $.session.end({ reason: 'clear' } as any)
    off.ids.now = id
    await ($ as any).classic.SessionStart({ session_id: id, transcript_path: '/t', cwd: '', hook_event_name: 'SessionStart', source: 'clear' })
  }
  await clear('sa-apres-clear')
  await turnEnd($, off.clock, 't3')
  expect(off.runs).toEqual([])
  await clear('sa')
  await turnEnd($, off.clock, 't4')
  expect(off.runs.map(r => r.command)).toEqual(['mattpocock-skills:to-tickets'])
})

test('Un fichier de parcours qui pose « allumé à » et « allumé par » sans clic dans cette discussion ne fait rien envoyer ; le bandeau dit « allumage non confirmé ici »', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on, { isAuto: false })
  // Le fichier, forgé : l'auto « allumé » au nom de cette discussion, sans la date d'un clic gardée ici.
  const forged = w.stored()!
  forged.runs[0]!.auto = { onAt: T0 + 5_000, onBy: 'sa' }
  forged.runs[0]!.updatedAt = T0 + 5_000
  seed(w, forged)
  await settle(clock, 5)
  expect(autoOf(w)).toMatchObject({ onAt: T0 + 5_000, onBy: 'sa' })
  await turnEnd($, clock)
  expect(w.runs).toEqual([])
  expect(await bandText($)).toMatch(/⚡\sAuto\sen\spause\s:\sallumage\snon\sconfirmé\sici/)
  // Deux clics d'ici le rallument : la suite part (contrôle positif).
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await turnEnd($, clock, 't2')
  expect(w.runs.map(r => r.command)).toEqual(['mattpocock-skills:to-tickets'])
})

test('Une lecture ratée du fichier juste avant l’envoi : rien ne part, l’auto s’éteint « lecture du parcours ratée »', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on)
  w.flags.unreadable = true
  await turnEnd($, clock)
  expect(w.runs).toEqual([])
  expect(await bandText($)).toMatch(/⚡\sAuto\sen\spause\s:\slecture\sdu\sparcours\sratée/)
  // L'écriture suivante, une fois le fichier relisible, porte l'arrêt.
  w.flags.unreadable = false
  await $.tool.call({ tool: TOOL, note: 'suite' } as any)
  await settle(clock, 2)
  expect(autoOf(w)).toMatchObject({ offWhy: 'lecture du parcours ratée' })
  expect(marksOf(w)).toEqual([])
})

test('Une écriture ratée de la marque : rien ne part, la marque est retirée, pause « écriture du parcours ratée »', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on)
  w.flags.unwritable = true
  await turnEnd($, clock)
  expect(w.runs).toEqual([])
  expect(await bandText($)).toMatch(/⚡\sAuto\sen\spause\s:\sécriture\sdu\sparcours\sratée/)
  // L'écriture suivante, une fois le fichier de nouveau écrivable, porte la pause et aucune marque.
  w.flags.unwritable = false
  await $.tool.call({ tool: TOOL, note: 'suite' } as any)
  await settle(clock, 2)
  expect(autoOf(w)).toMatchObject({ offWhy: 'écriture du parcours ratée' })
  expect(marksOf(w)).toEqual([])
  // Retirée avec sa trace : une copie qui l'aurait reçue ne la fait pas revenir « envoyée ».
  expect(w.stored()!.runs[0]!.autoResent).toEqual([expect.objectContaining({ key: 'phase:to-tickets#1' })])
  expect(w.notices).toContain('Parcours Boutique : auto en pause (écriture du parcours ratée)')
  // Rallumé au repos, la suite part tout de suite, une fois, sans attendre une fin de tour.
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  expect(w.runs.map(r => r.command)).toEqual(['mattpocock-skills:to-tickets'])
  await turnEnd($, clock, 't2')
  expect(w.runs.map(r => r.command)).toEqual(['mattpocock-skills:to-tickets'])
})

test('Un envoi refusé devient la question « envoi resté sans suite » avec « ↻ Renvoyer » ; le clic efface la marque et l’auto renvoie une fois', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on)
  w.flags.refuseNext = true
  await turnEnd($, clock)
  await settle(clock, 1)
  expect(w.runs.length).toBe(1)
  const run = w.stored()!.runs[0]!
  expect(run.waiting).toEqual([expect.objectContaining({ id: 'sans-suite:phase:to-tickets#1', blocks: { kind: 'phase', id: 'to-tickets' } })])
  expect(await paneHas($, 'auto-resend-phase:to-tickets#1')).toBe(true)
  // Une autre fin de tour ne renvoie rien tant que la marque attend.
  await turnEnd($, clock, 't2')
  expect(w.runs.length).toBe(1)
  await press($, 'auto-resend-phase:to-tickets#1')
  await settle(clock, 2)
  expect(w.runs.map(r => r.command)).toEqual(['mattpocock-skills:to-tickets', 'mattpocock-skills:to-tickets'])
  const after = w.stored()!.runs[0]!
  expect(after.waiting ?? []).toEqual([])
  expect(after.autoResent).toEqual([expect.objectContaining({ key: 'phase:to-tickets#1' })])
  expect(autoMarksOf(after)[0]).toMatchObject({ key: 'phase:to-tickets#1', startedAt: expect.any(Number) })
})

test('Une marque sans démarrage, la discussion au repos, devient la question « envoi resté sans suite » ; le démarrage tardif la retire', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on, { isDone: false })
  // Une marque posée comme si l'envoi était parti sans que son tour démarre (un rechargement pendant l'envoi).
  const board = mergeBoards(w.stored()!, w.stored()!)
  const marked = markAutoSent({ ...board, activeId: board.runs[0]!.id }, { kind: 'command', key: 'phase:to-tickets#1', skill: 'to-tickets', what: '/to-tickets', blocks: { kind: 'phase', id: 'to-tickets' } }, T0)!.board
  seed(w, { ...marked, activeId: null })
  await settle(clock, 5)
  expect(marksOf(w).length).toBe(1)
  await settle(clock, 150)
  expect(w.stored()!.runs[0]!.waiting).toEqual([expect.objectContaining({ id: 'sans-suite:phase:to-tickets#1' })])
  // Le skill finit par se charger : la marque démarre et la question se retire.
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await settle(clock, 1)
  expect(w.stored()!.runs[0]!.waiting ?? []).toEqual([])
  expect(marksOf(w)[0]).toMatchObject({ startedAt: expect.any(Number) })
})

test('Le prompt.submit de la commande que le mod a envoyée (origine flow-board) fait démarrer sa marque', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on, { isDone: false })
  const board = mergeBoards(w.stored()!, w.stored()!)
  const marked = markAutoSent({ ...board, activeId: board.runs[0]!.id }, { kind: 'command', key: 'phase:to-tickets#1', skill: 'to-tickets', what: '/to-tickets', blocks: { kind: 'phase', id: 'to-tickets' } }, T0)!.board
  seed(w, { ...marked, activeId: null })
  await settle(clock, 5)
  expect(marksOf(w)[0]?.startedAt).toBeUndefined()
  // Celui d'un autre plugin ne la fait pas démarrer ; celui de flow-board, oui.
  await $.prompt.submit({ text: 'x', origin: { kind: 'plugin', name: 'autre-mod' }, command: { name: 'mattpocock-skills:to-tickets', args: '' } } as any)
  await settle(clock, 1)
  expect(marksOf(w)[0]?.startedAt).toBeUndefined()
  await $.prompt.submit({ text: 'x', origin: { kind: 'plugin', name: 'flow-board' }, command: { name: 'mattpocock-skills:to-tickets', args: '' } } as any)
  await settle(clock, 1)
  expect(marksOf(w)[0]).toMatchObject({ key: 'phase:to-tickets#1', startedAt: expect.any(Number) })
})

test('Claude ne retire pas la question « envoi resté sans suite » : l’outil le refuse', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on)
  w.flags.refuseNext = true
  await turnEnd($, clock)
  await settle(clock, 1)
  const answer = String((await $.tool.call({ tool: TOOL, waiting: [{ id: 'sans-suite:phase:to-tickets#1', answered: true }] } as any)).result)
  expect(answer).toContain('a question of the mod')
  expect(w.stored()!.runs[0]!.waiting).toEqual([expect.objectContaining({ id: 'sans-suite:phase:to-tickets#1' })])
})

test('Le rapport écrit arrête l’auto (« rapport prêt »), qui ne valide rien et n’envoie plus rien', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on, { isDone: false })
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'x' })
  await $.tool.call({ tool: TOOL, step: 'validate' } as any)
  await settle(clock, 1)
  expect(autoOf(w)).toMatchObject({ offWhy: 'rapport prêt' })
  expect(w.notices).toContain('Parcours Boutique : auto en pause (rapport prêt)')
  expect(await bandText($)).toMatch(/⚡\sAuto\sen\spause\s:\srapport\sprêt/)
})

test('Une erreur de quota en fin de tour met l’auto en pause « quota atteint » ; une autre erreur, non', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on, { isDone: false })
  await ($ as any).classic.StopFailure({ session_id: 'sa', transcript_path: '/t', cwd: '', hook_event_name: 'StopFailure', error: 'overloaded' })
  await settle(clock, 1)
  expect(autoOf(w)?.offAt).toBeUndefined()
  await ($ as any).classic.StopFailure({ session_id: 'sa', transcript_path: '/t', cwd: '', hook_event_name: 'StopFailure', error: 'rate_limit' })
  await settle(clock, 1)
  expect(autoOf(w)).toMatchObject({ offWhy: 'quota atteint' })
})

test('Le parcours effacé par une autre discussion : rien ne part ensuite', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on)
  // D'abord l'effet : la spec finie, la suite part ; son skill se charge, puis sa phase se finit à son tour.
  await turnEnd($, clock)
  expect(w.runs.map(r => r.command)).toEqual(['mattpocock-skills:to-tickets'])
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await settle(clock, 1)
  const was = w.stored()!
  const id = was.runs[0]!.id
  // L'autre discussion l'efface : le fichier n'a plus que sa trace de suppression ; /implement ne part pas.
  seed(w, { ...was, runs: [], deleted: [{ id, at: was.runs[0]!.updatedAt + 1 }] })
  await settle(clock, 6)
  await turnEnd($, clock, 't2')
  expect(w.runs.length).toBe(1)
})

test('Le second clic garde sa date dans $.store : refusée, l’auto ne s’allume pas ; coupé, la date s’efface', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on, { isAuto: false, isDone: false })
  const key = `auto-confirm:${w.stored()!.runs[0]!.id}`
  w.flags.storeRefuses = true
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  expect(autoOf(w)).toBeUndefined()
  w.flags.storeRefuses = false
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  expect(w.mem[key]).toEqual({ by: 'sa', onAt: autoOf(w)!.onAt, boot: expect.any(String) })
  await press($, 'auto-off')
  await settle(clock, 1)
  expect(w.mem[key]).toBeUndefined()
})

// ─── Traces de retrait liées à la discussion qui les écrit ─────────────────
//
// Invariant : une trace lue dans le fichier partagé, que la discussion d'où l'auto agit n'a pas
// écrite, ne fait jamais repartir une action ni retirer une question pour l'auto de cette discussion.

const KEY = 'phase:to-tickets#1'
const tracesKey = (w: World) => `auto-traces:${w.stored()!.runs[0]!.id}`

test('Une copie rejouée avec une trace « ↻ Renvoyer » et une trace « répondue » que cette discussion n’a pas écrites ne fait rien renvoyer : la marque et la question restent ici ; « ↻ Renvoyer » d’ici relance une fois', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on)
  w.flags.refuseNext = true
  await turnEnd($, clock)
  await settle(clock, 1)
  expect(w.runs.length).toBe(1)
  const was = w.stored()!
  const run = was.runs[0]!
  const mark = autoMarksOf(run)[0]!
  const question = openQuestions(run)[0]!
  expect(question.id).toBe(`sans-suite:${KEY}`)
  // La copie forgée : ni la marque ni la question, mais les traces de leur retrait, datées après elles.
  seed(w, { ...was, runs: [{ ...run, autoSent: [], waiting: [], autoResent: [{ key: KEY, at: mark.at + 1 }], answered: [{ id: question.id, at: question.at! }] }] })
  await settle(clock, 6)
  await turnEnd($, clock, 't2')
  expect(w.runs.length).toBe(1)
  // Ici, la question reste avec son bouton ; le fichier réécrit garde la marque, la question et l'union des traces.
  expect(await paneHas($, `auto-resend-${KEY}`)).toBe(true)
  await $.tool.call({ tool: TOOL, note: 'suite' } as any)
  await settle(clock, 2)
  const after = w.stored()!.runs[0]!
  expect(autoMarksOf(after)).toEqual([expect.objectContaining({ key: KEY, at: mark.at })])
  expect(openQuestions(after).map(q => q.id)).toEqual([question.id])
  expect(after.autoResent).toEqual([{ key: KEY, at: mark.at + 1 }])
  // Le retrait d'ici reste : « ↻ Renvoyer » efface la marque (trace gardée ici aussi) et l'auto relance l'action, une fois.
  await press($, `auto-resend-${KEY}`)
  await settle(clock, 2)
  expect(w.runs.length).toBe(2)
  expect(w.mem[tracesKey(w)]).toMatchObject({ by: 'sa', boot: expect.any(String), resent: [{ key: KEY, at: expect.any(Number) }] })
  await turnEnd($, clock, 't3')
  expect(w.runs.length).toBe(2)
})

test('Mis en pause par l’ouverture d’un autre parcours, l’auto allumé d’ici garde sa protection : une copie forgée ne lui retire rien, et repris, il ne renvoie rien', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on)
  w.flags.refuseNext = true
  await turnEnd($, clock)
  await settle(clock, 1)
  const id = w.stored()!.runs[0]!.id
  // Un autre parcours s'ouvre ici : la Boutique passe en pause, son auto reste allumé.
  await $.tool.call({ tool: TOOL, open: { title: 'Autre' } } as any)
  await settle(clock, 2)
  const was = w.stored()!
  const shop = was.runs.find(r => r.id === id)!
  expect(shop.status).toBe('paused')
  const mark = autoMarksOf(shop)[0]!
  const question = openQuestions(shop)[0]!
  seed(w, { ...was, runs: was.runs.map(r => (r.id === id ? { ...r, autoSent: [], waiting: [], autoResent: [{ key: KEY, at: mark.at + 1 }], answered: [{ id: question.id, at: question.at! }] } : r)) })
  await settle(clock, 6)
  // Repris ici : la marque et la question sont toujours là, rien ne repart.
  await $.tool.call({ tool: TOOL, resume: id } as any)
  await settle(clock, 1)
  await turnEnd($, clock, 't2')
  expect(w.runs.length).toBe(1)
  expect(await paneHas($, `auto-resend-${KEY}`)).toBe(true)
  await $.tool.call({ tool: TOOL, note: 'suite' } as any)
  await settle(clock, 2)
  const back = w.stored()!.runs.find(r => r.id === id)!
  expect(autoMarksOf(back)).toEqual([expect.objectContaining({ key: KEY, at: mark.at })])
  expect(openQuestions(back).map(q => q.id)).toEqual([question.id])
})

test('Effacé ailleurs, le parcours emporte les traces gardées ici', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on)
  w.flags.refuseNext = true
  await turnEnd($, clock)
  await settle(clock, 1)
  await press($, `auto-resend-${KEY}`)
  await settle(clock, 2)
  const key = tracesKey(w)
  // L'effet d'abord : la trace de « ↻ Renvoyer » est gardée ici.
  expect(w.mem[key]).toMatchObject({ by: 'sa' })
  const was = w.stored()!
  const run = was.runs[0]!
  seed(w, { ...was, runs: [], deleted: [{ id: run.id, at: run.updatedAt + 1 }] })
  await settle(clock, 6)
  expect(w.stored()!.runs).toEqual([])
  expect(w.mem[key]).toBeUndefined()
})

test('Une trace « répondue » que cette discussion n’a pas écrite ne retire pas ici la question qui bloque la suite : rien ne part', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on, { isDone: false })
  await $.tool.call({ tool: TOOL, complete: true, waiting: [{ id: 'q1', phase: 'to-tickets', text: 'Quelle granularité ?' }] } as any)
  await settle(clock, 1)
  const was = w.stored()!
  const run = was.runs[0]!
  const at = openQuestions(run)[0]!.at!
  seed(w, { ...was, runs: [{ ...run, waiting: [], answered: [{ id: 'q1', at }] }] })
  await settle(clock, 6)
  // La fusion d'ici ne l'a pas retirée : la copie d'ici, réécrite, la porte encore, et la suite ne part pas.
  await $.tool.call({ tool: TOOL, note: 'suite' } as any)
  await settle(clock, 2)
  expect(openQuestions(w.stored()!.runs[0]!).map(q => q.id)).toEqual(['q1'])
  await turnEnd($, clock)
  expect(w.runs).toEqual([])
  expect(autoOf(w)).toMatchObject({ offWhy: 'plus rien ne peut avancer sans toi' })
})

test('Les traces écrites ici se gardent dans $.store avec la discussion et le processus : retrait par Claude compris, gardées après /reload-plugins, effacées à la coupure de l’auto, les 100 plus récentes', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, ...w } = await specDone($, on, { isDone: false })
  // Retirées par Claude ici : chaque retrait laisse sa trace d'ici.
  for (let round = 0; round < 3; round++) {
    const ids = Array.from({ length: 40 }, (_, i) => `q${round}-${i}`)
    await $.tool.call({ tool: TOOL, waiting: ids.map(id => ({ id, phase: 'to-tickets', text: 'Q ?' })) } as any)
    await settle(clock, 1)
    await $.tool.call({ tool: TOOL, waiting: ids.map(id => ({ id, answered: true })) } as any)
    await settle(clock, 1)
  }
  const kept = w.mem[tracesKey(w)] as { by: string; answered: { id: string }[] }
  expect(kept.by).toBe('sa')
  // Les 100 plus récentes : les deux derniers tours entiers, 20 du premier.
  expect(kept.answered.length).toBe(100)
  expect(kept.answered.filter(t => t.id.startsWith('q2-')).length).toBe(40)
  expect(kept.answered.filter(t => t.id.startsWith('q1-')).length).toBe(40)
  expect(kept.answered.filter(t => t.id.startsWith('q0-')).length).toBe(20)
  // /reload-plugins : le mod redémarre, ses traces restent reconnues. Une copie en retard qui ramène une
  // question retirée ici ne la fait pas revenir.
  await start($)
  const was = w.stored()!
  seed(w, { ...was, runs: [{ ...was.runs[0]!, waiting: [{ id: 'q2-39', blocks: { kind: 'phase', id: 'to-tickets' }, text: 'Q ?', at: T0 }], answered: [] }] })
  await settle(clock, 6)
  await $.tool.call({ tool: TOOL, note: 'suite' } as any)
  await settle(clock, 2)
  expect(openQuestions(w.stored()!.runs[0]!).map(q => q.id)).not.toContain('q2-39')
  // La coupure de l'auto les efface, comme la date du clic.
  await press($, 'auto-off')
  await settle(clock, 1)
  expect(w.mem[tracesKey(w)]).toBeUndefined()
})

// ─── Couture 2 : la fusion des marques, et le choix de l'action ───────────

const runWith = (run: Partial<Run>): Run => ({ ...newRun('to-spec', 1_000, 'Lot'), owner: 's', ...run })
const boardOf = (run: Run): Board => ({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id })

test('La fusion garde l’union des marques, « démarrée » l’emporte, et la trace d’un « ↻ Renvoyer » n’est défaite par aucune copie en retard', () => {
  const base = boardOf(runWith({ updatedAt: 2_000 }))
  const action = { kind: 'command' as const, key: 'phase:to-tickets#1', skill: 'to-tickets', what: '/to-tickets', blocks: { kind: 'phase' as const, id: 'to-tickets' } }
  const sent = markAutoSent(base, action, 3_000)!.board
  const started = markAutoStarted(sent, m => m.key === action.key, 4_000)!.board
  // Une copie sans la marque, plus récente pour le reste : la marque reste, démarrée.
  const fresher: Board = { ...base, runs: [{ ...base.runs[0]!, updatedAt: 9_000 }] }
  for (const [a, b] of [[started, fresher], [fresher, started], [sent, started], [started, sent]] as const) {
    const merged = mergeBoards({ ...a, activeId: null }, b)
    expect(autoMarksOf(merged.runs[0]!)).toEqual([expect.objectContaining({ key: action.key, at: 3_000, startedAt: 4_000 })])
  }
  // « ↻ Renvoyer » sur une marque restée sans suite, puis un nouvel envoi : une copie en retard (l'ancienne marque) ne la fait pas revenir.
  const stale = raiseStaleAutoSends(sent, 5_000, true)!.board
  const resent = resendAutoMark(stale, stale.activeId!, action.key, 6_000)!.board
  // Le bouton d'un autre parcours ne touche pas à celui-ci, même sous la même clé.
  expect(resendAutoMark(stale, 'autre', action.key, 6_000)).toBeNull()
  expect(autoMarksOf(resent.runs[0]!)).toEqual([])
  const again = markAutoSent(resent, action, 7_000)!.board
  for (const [a, b] of [[again, stale], [stale, again]] as const) {
    const merged = mergeBoards({ ...a, activeId: null }, b)
    expect(autoMarksOf(merged.runs[0]!)).toEqual([expect.objectContaining({ key: action.key, at: 7_000 })])
    expect(merged.runs[0]!.autoResent).toEqual([{ key: action.key, at: 6_000 }])
  }
  // Une marque en attente retirée à côté d'une marque démarrée de la même clé : la démarrée reste, même après fusion.
  const both: Board = { ...started, runs: [{ ...started.runs[0]!, autoSent: [...(started.runs[0]!.autoSent ?? []), { key: action.key, at: 8_000 }] }] }
  const retracted = unmarkAutoSent(both, action.key, 9_000)!.board
  for (const [a, b] of [[retracted, both], [both, retracted]] as const) {
    const merged = mergeBoards({ ...a, activeId: null }, b)
    // La démarrée reste, la retirée ne revient pas d'une copie qui l'avait encore.
    expect(autoMarksOf(merged.runs[0]!)).toEqual([expect.objectContaining({ key: action.key, at: 3_000, startedAt: 4_000 })])
    expect(autoDecision(merged.runs[0]!, {}, false).kind).toBe('none')
  }
  // Une trace ne fait jamais tomber une marque démarrée venue d'une autre copie : l'action ne repart pas.
  const tracedOnly: Board = { ...sent, runs: [{ ...sent.runs[0]!, autoSent: [], autoResent: [{ key: action.key, at: 5_000 }] }] }
  for (const [a, b] of [[tracedOnly, started], [started, tracedOnly]] as const) {
    expect(autoMarksOf(mergeBoards({ ...a, activeId: null }, b).runs[0]!)).toEqual([expect.objectContaining({ key: action.key, startedAt: 4_000 })])
  }
  // Une liste de marques abîmée bloque tout envoi : la pause « lecture du parcours ratée ».
  const damaged = runWith({ autoSent: 'x' as unknown as Run['autoSent'] })
  expect(autoDecision(damaged, {}, false)).toEqual({ kind: 'stop', why: 'lecture du parcours ratée', relaunch: [] })
})

test('L’action de l’auto suit le bouton de l’étape suivante : la phase qui suit, seulement les phases du parcours, jamais la livraison', () => {
  const done = (run: Run, at: number): Run => ({ ...run, cursor: at, phases: run.phases.map((p, i) => (i <= at ? { ...p, status: 'done' as const } : p)) })
  const spec = runWith({})
  expect(autoActionOf(spec)).toBeNull()
  expect(autoActionOf(done(spec, 0))).toMatchObject({ kind: 'command', skill: 'to-tickets', key: 'phase:to-tickets#1' })
  // Après le compte rendu, la suite est la version : l'auto ne la lance pas.
  const report = spec.phases.findIndex(p => p.skill === 'compte-rendu')
  expect(report).toBeGreaterThan(0)
  expect(autoActionOf(done(spec, report))).toBeNull()
})

test('À la fusion, pour le parcours qui envoie d’ici, seules les traces écrites ici retirent une marque en attente ou une question ; les traces restent l’union ; ailleurs, l’union s’applique', () => {
  const action = { kind: 'command' as const, key: KEY, skill: 'to-tickets', what: '/to-tickets', blocks: { kind: 'phase' as const, id: 'to-tickets' } }
  const sent = markAutoSent(boardOf(runWith({ updatedAt: 2_000 })), action, 3_000)!.board
  const asked = applyReport(sent, { waiting: [{ id: 'q1', phase: 'to-tickets', text: 'Q ?' }] }, 3_500).board
  const run = asked.runs[0]!
  const forged: Board = { ...asked, activeId: null, runs: [{ ...run, autoSent: [], waiting: [], autoResent: [{ key: KEY, at: 4_000 }], answered: [{ id: 'q1', at: 4_000 }] }] }
  // Aucune trace écrite ici : la marque et la question restent, les traces s'unissent.
  const here = mergeBoards(asked, forged, { runId: run.id, resent: [], answered: [] })
  expect(autoMarksOf(here.runs[0]!)).toEqual([expect.objectContaining({ key: KEY, at: 3_000 })])
  expect(openQuestions(here.runs[0]!).map(q => q.id)).toEqual(['q1'])
  expect(here.runs[0]!.autoResent).toEqual([{ key: KEY, at: 4_000 }])
  expect(here.runs[0]!.answered).toEqual([expect.objectContaining({ id: 'q1', at: 4_000 })])
  // Dans les deux sens de la fusion.
  const back = mergeBoards({ ...forged, activeId: run.id }, asked, { runId: run.id, resent: [], answered: [] })
  expect(autoMarksOf(back.runs[0]!).map(m => m.key)).toEqual([KEY])
  expect(openQuestions(back.runs[0]!).map(q => q.id)).toEqual(['q1'])
  // Les mêmes traces, écrites ici : elles retirent.
  const mine = mergeBoards(asked, forged, { runId: run.id, resent: [{ key: KEY, at: 4_000 }], answered: [{ id: 'q1', at: 4_000 }] })
  expect(autoMarksOf(mine.runs[0]!)).toEqual([])
  expect(openQuestions(mine.runs[0]!)).toEqual([])
  // Une trace d'ici plus ancienne que l'entrée ne la retire pas.
  const older = mergeBoards(asked, forged, { runId: run.id, resent: [{ key: KEY, at: 2_500 }], answered: [{ id: 'q1', at: 3_000 }] })
  expect(autoMarksOf(older.runs[0]!).map(m => m.key)).toEqual([KEY])
  expect(openQuestions(older.runs[0]!).map(q => q.id)).toEqual(['q1'])
  // Sans traces d'ici (une autre discussion, ou l'auto qui n'envoie pas d'ici) : l'union des traces s'applique.
  const elsewhere = mergeBoards({ ...asked, activeId: null }, forged)
  expect(autoMarksOf(elsewhere.runs[0]!)).toEqual([])
  expect(openQuestions(elsewhere.runs[0]!)).toEqual([])
})

test('Pour un parcours dont l’auto est allumé d’ici, l’entrée d’ici d’une question l’emporte sur celle de même id de l’autre copie : une copie forgée ne la recible pas', () => {
  const asked = applyReport(boardOf(runWith({ updatedAt: 2_000 })), { waiting: [{ id: 'q1', phase: 'to-tickets', text: 'Q ?' }] }, 3_000).board
  const run = asked.runs[0]!
  // La copie forgée : la même question, plus récente, qui bloque une autre phase.
  const forged: Board = { ...asked, activeId: null, runs: [{ ...run, waiting: [{ id: 'q1', blocks: { kind: 'phase', id: 'implement' }, text: 'Q ?', at: 9_000 }] }] }
  const here = mergeBoards(asked, forged, { runId: run.id, resent: [], answered: [] })
  expect(openQuestions(here.runs[0]!)).toEqual([expect.objectContaining({ id: 'q1', blocks: { kind: 'phase', id: 'to-tickets' } })])
  // Un id absent d'ici s'ajoute toujours.
  const added: Board = { ...forged, runs: [{ ...forged.runs[0]!, waiting: [...(forged.runs[0]!.waiting ?? []), { id: 'q2', blocks: { kind: 'phase', id: 'implement' }, text: 'Autre ?', at: 9_000 }] }] }
  expect(openQuestions(mergeBoards(asked, added, { runId: run.id, resent: [], answered: [] }).runs[0]!).map(q => q.id).sort()).toEqual(['q1', 'q2'])
  // Ailleurs (pas allumé d'ici) : l'union, la plus récente l'emporte, comme avant.
  expect(openQuestions(mergeBoards({ ...asked, activeId: null }, forged).runs[0]!)).toEqual([expect.objectContaining({ id: 'q1', blocks: { kind: 'phase', id: 'implement' } })])
  // Le parcours mis en pause ici (un autre ouvert), l'auto toujours allumé d'ici : la copie forgée, plus
  // récente, est la gardée ; l'entrée d'ici l'emporte quand même.
  const paused: Board = { ...asked, activeId: null }
  const newer: Board = { ...forged, runs: [{ ...forged.runs[0]!, updatedAt: 99_000 }] }
  expect(openQuestions(mergeBoards(paused, newer).runs[0]!)).toEqual([expect.objectContaining({ id: 'q1', blocks: { kind: 'phase', id: 'implement' } })])
  expect(openQuestions(mergeBoards(paused, newer, { runId: run.id, resent: [], answered: [] }).runs[0]!)).toEqual([expect.objectContaining({ id: 'q1', blocks: { kind: 'phase', id: 'to-tickets' } })])
  // Retirée ici (trace d'ici), elle ne cache pas l'entrée de même id reposée ailleurs après la trace.
  const withdrawn = applyReport(asked, { waiting: [{ id: 'q1', answered: true }] }, 4_000).board
  const own = { runId: run.id, resent: [], answered: [{ id: 'q1', at: 4_000 }] }
  expect(openQuestions(mergeBoards(withdrawn, forged, own).runs[0]!)).toEqual([expect.objectContaining({ id: 'q1', blocks: { kind: 'phase', id: 'implement' } })])
})

test('Une trace gardée ici ne compte jamais plus tard que celle du parcours de même clé : une marque posée après la trace ramenée reste', () => {
  const action = { kind: 'command' as const, key: KEY, skill: 'to-tickets', what: '/to-tickets', blocks: { kind: 'phase' as const, id: 'to-tickets' } }
  const run = runWith({ autoResent: [{ key: KEY, at: 5_000 }], answered: [{ id: 'q1', at: 5_000 }], updatedAt: 2_000 })
  const sent = markAutoSent(boardOf(run), action, 6_000)!.board
  const asked = applyReport(sent, { waiting: [{ id: 'q1', phase: 'to-tickets', text: 'Q ?' }] }, 6_500).board
  // Gardée ici loin dans le futur (horloge recalée, marque forgée retirée) : elle ne dépasse pas la trace du parcours.
  const merged = mergeBoards(asked, asked, { runId: run.id, resent: [{ key: KEY, at: 9e12 }], answered: [{ id: 'q1', at: 9e12 }] })
  expect(autoMarksOf(merged.runs[0]!)).toEqual([expect.objectContaining({ key: KEY, at: 6_000 })])
  expect(openQuestions(merged.runs[0]!).map(q => q.id)).toEqual(['q1'])
})

test('L’auto compte allumé d’ici pour la fusion seulement à son nom, avec la date du clic gardée ici, ou quand cette date ne s’est pas lue', () => {
  const on = runWith({ auto: { onAt: 3_000, onBy: 'sa' }, updatedAt: 2_000 })
  expect(isAutoLitBy(on, 'sa', 3_000)).toBe(true)
  expect(isAutoLitBy(on, 'sa', 'unread')).toBe(true)
  expect(isAutoLitBy(on, 'sa', null)).toBe(false)
  expect(isAutoLitBy(on, 'sa', 2_999)).toBe(false)
  expect(isAutoLitBy(on, 'sb', 3_000)).toBe(false)
  expect(isAutoLitBy({ ...on, auto: { onAt: 3_000, onBy: 'sa', offAt: 4_000, offWhy: 'coupé par toi' } }, 'sa', 'unread')).toBe(false)
})

test('La question d’un groupe revenu trop de fois : une réponse d’ailleurs ne l’empêche pas d’être reposée, datée après la trace ; une réponse d’ici, si', () => {
  const run = runWith({ answered: [{ id: 'relance:A#3', at: 9_000 }], updatedAt: 2_000 })
  const board = boardOf(run)
  const foreign = raiseRelaunchQuestions(board, ['A#3'], 5_000, { runId: run.id, resent: [], answered: [] })
  expect(openQuestions(foreign!.board.runs[0]!)).toEqual([expect.objectContaining({ id: 'relance:A#3', at: 9_001 })])
  // Reposée après la trace : une fusion avec une copie qui a la trace ne l'efface pas.
  expect(openQuestions(mergeBoards({ ...foreign!.board, activeId: null }, board).runs[0]!).map(q => q.id)).toEqual(['relance:A#3'])
  expect(raiseRelaunchQuestions(board, ['A#3'], 5_000, { runId: run.id, resent: [], answered: [{ id: 'relance:A#3', at: 9_000 }] })).toBeNull()
  // Sans traces d'ici (l'auto n'envoie pas d'ici) : l'union, la réponse suffit.
  expect(raiseRelaunchQuestions(board, ['A#3'], 5_000)).toBeNull()
})

test('Une trace « ↻ Renvoyer » ou « répondue » datée dans le futur est ramenée à maintenant à la lecture ; une marque posée ensuite n’est plus effacée', () => {
  const future = 50_000_000
  const run = runWith({ autoResent: [{ key: KEY, at: future }], answered: [{ id: 'q1', at: future }], updatedAt: 2_000 })
  const clamped = clampFuture(boardOf(run), 5_000)
  expect(clamped.runs[0]!.autoResent).toEqual([{ key: KEY, at: 5_000 }])
  expect(clamped.runs[0]!.answered).toEqual([{ id: 'q1', at: 5_000 }])
  // Dans la tolérance d'une minute : rien ne change.
  const near = runWith({ autoResent: [{ key: KEY, at: 5_000 + 30_000 }], updatedAt: 2_000 })
  expect(clampFuture(boardOf(near), 5_000).runs[0]!.autoResent).toEqual([{ key: KEY, at: 35_000 }])
  // Ramenée, la trace n'efface plus une marque posée après : la fusion la garde, l'action ne repart pas.
  const action = { kind: 'command' as const, key: KEY, skill: 'to-tickets', what: '/to-tickets', blocks: { kind: 'phase' as const, id: 'to-tickets' } }
  const sent = markAutoSent(clamped, action, 6_000)!.board
  expect(autoMarksOf(mergeBoards({ ...sent, activeId: null }, clamped).runs[0]!)).toEqual([expect.objectContaining({ key: KEY, at: 6_000 })])
  // Sans la lecture qui la ramène, la trace future aurait effacé cette marque (le contrôle de ce qui précède).
  expect(autoMarksOf(mergeBoards({ ...sent, activeId: null }, boardOf(run)).runs[0]!)).toEqual([])
})
