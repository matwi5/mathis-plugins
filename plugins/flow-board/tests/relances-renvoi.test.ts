// Les relances et les revues d'un groupe renvoyé en mode auto. Invariants : une même action auto n'est
// jamais envoyée deux fois ; un groupe renvoyé n'est jamais clos par l'auto sans revue de son dernier
// envoi ; un groupe ne reste jamais écarté sans question ni pause.

// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { applyReport, applySkill, autoDecision, awaitedExternals, emptyBoard, isGroupLotStuck, hereReviewMark, linkedReviewMark, markAutoLaunched, markAutoSent, newRun, raiseStaleAutoSends, resendAutoMark, startLinkedGroups } from '../hooks/model.ts'
import { cancelLinkedGroup, linkGroupSession } from '../hooks/link.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board, Run } from '../types'

const T0 = 160_000_000
const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
/** Le début du message de consigne que le mod envoie à Claude quand l'auto s'allume au repos. */
const BRIEF = '⚡ flow-board: the auto mode instructions for this mission'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 200 }, view: {} },
} as const

const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')

/** Le moteur sous le plugin : le board au fichier commun ou dans `$.store`, les textes que le mod envoie et met dans le prompt. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const disk: { board?: string; isUsed: boolean } = { isUsed: false }
  const commands: string[] = []
  const texts: string[] = []
  const filled: string[] = []
  const notices: string[] = []
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'sa' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
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
      if (disk.board === undefined) throw new Error(`EIO ${e.path}`)
      return { value: disk.board } as any
    }
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      disk.board = e.text
    } else files[e.path] = e.text
    return { value: undefined } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'sa' }))
  on('command.list', () => ({ value: [] }))
  on('command.run', (_$: unknown, e: { command: string }) => {
    commands.push(e.command)
    return { text: '' }
  })
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    // La consigne de l'allumage, que le mod envoie à Claude au repos : à part des demandes qu'il soumet.
    if (e.text.startsWith(BRIEF)) return { text: e.text }
    texts.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.suggest', () => ({ isShown: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.notify', (_$: unknown, e: { text: string }) => {
    notices.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  const stored = (): Board | undefined => (disk.isUsed && disk.board !== undefined ? JSON.parse(disk.board) : (mem['board:'] as Board | undefined))
  return { mem, disk, commands, texts, filled, notices, stored }
}
type World = ReturnType<typeof world>

const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key })
  await pane.unmount()
}
let turns = 0
const turnEnd = async ($: any, clock: { advance: (ms: number) => Promise<void> }) => {
  turns += 1
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: `t${turns}`, reason: 'answer' })
  await settle(clock, 1)
}

/**
 * Deux groupes indépendants, A et B, de deux tickets chacun (a0 et b0 faits avec a1 et b1) : un groupe d'un seul
 * ticket n'a pas de revue du groupe, et ces tests portent sur elle.
 */
const LOT = {
  tickets: [
    { id: 'a0', name: 'Worker prép', files: ['src/a.ts'] },
    { id: 'a1', name: 'Worker', files: ['src/a.ts'] },
    { id: 'b0', name: 'App prép', files: ['src/b.ts'] },
    { id: 'b1', name: 'App', files: ['src/b.ts'] },
  ],
  groups: [
    { id: 'A', name: 'Worker', tickets: ['a0', 'a1'], files: ['src/a.ts'] },
    { id: 'B', name: 'App', tickets: ['b0', 'b1'], files: ['src/b.ts'] },
  ],
}

/** Le lot découpé, actif dans la discussion « sa », auto allumé (ou non) : la première vague part à la fin du tour. */
const implementing = async ($: any, on: any, o: { isAuto?: boolean } = {}) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  if (o.isAuto !== false) {
    await press($, 'auto-on')
    await press($, 'auto-confirm')
  }
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await turnEnd($, clock)
  // Le découpage fini sous l'auto : une compaction, une fois, avant la première vague (compaction stratégique).
  expect(w.commands).toEqual(o.isAuto !== false ? ['compact'] : [])
  w.commands.length = 0
  return { clock, ...w }
}

const groupOf = (w: World, id: string) => w.stored()!.runs[0]!.groups!.find(g => g.id === id)!
const autoOf = (w: World) => w.stored()?.runs[0]?.auto
const keysOf = (w: World) => (w.stored()!.runs[0]!.autoSent ?? []).map(m => m.key)

test('Le retrait par Claude d’une question « relance: » est refusé tant que le groupe attend sa relance ; la question reste ; ses tickets faits, il est accepté', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on)
  expect(w.texts.length).toBe(1)
  await $.tool.call({ tool: TOOL, set: [{ id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }], returned: ['B'], reviewed: ['B'], security: { group: 'B', advised: false, why: 'rien' } } as any)
  await $.tool.call({ tool: TOOL, returned: ['A'] } as any)
  await turnEnd($, clock)
  await $.tool.call({ tool: TOOL, returned: ['A'] } as any)
  await turnEnd($, clock)
  // L'effet d'abord : la question du renvoi de trop est posée, l'auto en pause.
  expect((w.stored()!.runs[0]!.waiting ?? []).map(q => q.id)).toEqual(['relance:A#3'])
  const refused = String((await $.tool.call({ tool: TOOL, waiting: [{ id: 'relance:A#3', answered: true }] } as any)).result)
  expect(refused).toContain('"relance:A#3": the group still waits for its relaunch')
  expect(refused).toContain('relaunch the group (« ↗ Worker »)')
  await settle(clock, 2)
  expect((w.stored()!.runs[0]!.waiting ?? []).map(q => q.id)).toEqual(['relance:A#3'])
  // Ses tickets faits à la main : le groupe n'attend plus de relance, le retrait est accepté.
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }] } as any)
  const accepted = String((await $.tool.call({ tool: TOOL, waiting: [{ id: 'relance:A#3', answered: true }] } as any)).result)
  expect(accepted).not.toContain('still waits for its relaunch')
  await settle(clock, 2)
  expect(w.stored()!.runs[0]!.waiting ?? []).toEqual([])
})

test('Un groupe relu sans avis de sécurité envoyé : l’auto ne reste pas en cours en silence, il se met en pause « plus rien ne peut avancer sans toi » une fois la discussion au repos', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }], returned: ['A', 'B'], reviewed: ['A', 'B'], security: { group: 'B', advised: false, why: 'rien' } } as any)
  await turnEnd($, clock)
  // Juste après la fin du tour : Claude peut encore envoyer l'avis au tour suivant.
  expect(autoOf(w)?.offAt).toBeUndefined()
  await settle(clock, 35)
  expect(autoOf(w)).toMatchObject({ offWhy: 'plus rien ne peut avancer sans toi' })
  expect(w.notices).toContain('Mission Boutique : auto en pause (plus rien ne peut avancer sans toi)')
  expect(w.commands).toEqual([])
})

test('Un avis envoyé au tour suivant : pas de pause ; le lot clos, le compte rendu part', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }], returned: ['A', 'B'], reviewed: ['A', 'B'], security: { group: 'B', advised: false, why: 'rien' } } as any)
  await turnEnd($, clock)
  await $.tool.call({ tool: TOOL, security: { group: 'A', advised: false, why: 'rien' } } as any)
  await turnEnd($, clock)
  expect(w.commands).toEqual(['flow-board:compte-rendu'])
  await settle(clock, 35)
  expect(autoOf(w)?.offAt).toBeUndefined()
})

test('Un groupe fini ici avec une revue de sécurité conseillée et pas lancée : pause « plus rien ne peut avancer sans toi » au repos', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on, { isAuto: false })
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }] } as any)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  // Le second clic, au repos, envoie à Claude la consigne de l'allumage ; la fin du tour de ce message décide.
  await turnEnd($, clock)
  // La revue des groupes finis ici part (/code-review), puis Claude conseille la sécurité de A sans la lancer.
  expect(w.commands).toEqual(['code-review'])
  await $.skill.prompt({ skill: 'code-review', text: 'x' })
  await $.tool.call({ tool: TOOL, security: { group: 'A', advised: true, why: 'un chemin construit' } } as any)
  await $.tool.call({ tool: TOOL, security: { group: 'B', advised: false, why: 'rien' } } as any)
  await turnEnd($, clock)
  expect(autoOf(w)?.offAt).toBeUndefined()
  await settle(clock, 35)
  expect(autoOf(w)).toMatchObject({ offWhy: 'plus rien ne peut avancer sans toi' })
})

test('Une revue lancée dont le résultat n’est pas encore là n’est pas un blocage : l’auto l’attend sans se mettre en pause', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on, { isAuto: false })
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }] } as any)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  // Le second clic, au repos, envoie à Claude la consigne de l'allumage ; la fin du tour de ce message décide.
  await turnEnd($, clock)
  // La revue des groupes finis ici part, et rien ne dit encore qu'elle a tourné : l'auto attend son résultat.
  expect(w.commands).toEqual(['code-review'])
  await turnEnd($, clock)
  await settle(clock, 35)
  expect(autoOf(w)?.offAt).toBeUndefined()
})

test('Un groupe gardé vide après un envoi annulé retient le lot : sans rien en vol ni à envoyer, le lot est dit bloqué ; clos ou en vol, non', () => {
  const run = newRun('implement', T0, 'Boutique')
  let b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(b, LOT, T0 + 1).board
  b = startLinkedGroups(b, ['A', 'B'], T0 + 2)!.board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }], returned: ['A', 'B'], reviewed: ['A', 'B'] }, T0 + 3).board
  b = applyReport(b, { security: { group: 'A', advised: false, why: 'rien' } }, T0 + 4).board
  b = applyReport(b, { security: { group: 'B', advised: false, why: 'rien' } }, T0 + 5).board
  const over = activeRun(b)!
  // L'effet d'abord : le lot clos part en compte rendu, il n'est pas bloqué.
  expect(autoDecision(over, {}, false)).toMatchObject({ kind: 'send', action: { skill: 'compte-rendu' } })
  expect(isGroupLotStuck(over, false)).toBe(false)
  // Un groupe C confié puis annulé, gardé vide par un plan changé : il ne se clôt jamais, rien ne part.
  const kept: Run = { ...over, groups: [...over.groups!, { id: 'C', name: 'Vide', tickets: [], sends: 1 }] }
  expect(autoDecision(kept, {}, false).kind).toBe('none')
  expect(isGroupLotStuck(kept, false)).toBe(true)
  // Une tâche de fond en vol : on attend son retour.
  expect(isGroupLotStuck(kept, true)).toBe(false)
})

/** Le lot de deux groupes dont B attend une dépendance externe (`kind` : task ou decision), pas encore faite. */
const outsideLot = (kind: 'task' | 'decision', extra: string[] = []) => ({
  tickets: LOT.tickets.map(t => (t.id.startsWith('b') ? { ...t, blockedBy: ['ext-1', ...extra] } : t)),
  groups: LOT.groups,
  externals: [{ id: 'ext-1', name: kind === 'task' ? 'Revue du diagnostic' : 'Choix du format', kind, status: 'todo' }],
})

/** A rendu, relu, sécurité jugée inutile : il ne reste que B, qui attend l'externe. */
const onlyOutsideLeft = (kind: 'task' | 'decision', extra: string[] = []): Board => {
  const run = newRun('implement', T0, 'Boutique')
  let b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(b, outsideLot(kind, extra), T0 + 1).board
  b = startLinkedGroups(b, ['A'], T0 + 2)!.board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'] }, T0 + 3).board
  return applyReport(b, { security: { group: 'A', advised: false, why: 'rien' } }, T0 + 4).board
}

test('Une tâche externe pas faite que tout le reste attend n’est pas un blocage ; levée, B part ; une décision externe, ou un bloqueur inconnu en plus, l’est', () => {
  const b = onlyOutsideLeft('task')
  const waiting = activeRun(b)!
  const before = JSON.stringify(waiting)
  expect(autoDecision(waiting, {}, false).kind).toBe('none')
  // L'effet d'abord : l'auto attend la tâche, qu'il nomme ; le lot n'est donc pas dit bloqué.
  expect(awaitedExternals(waiting, false).map(x => x.name)).toEqual(['Revue du diagnostic'])
  expect(isGroupLotStuck(waiting, false)).toBe(false)
  // La simulation de la tâche faite ne touche pas la mission.
  expect(JSON.stringify(waiting)).toBe(before)
  // La tâche marquée faite : B part.
  const lifted = applyReport(b, { externals: [{ id: 'ext-1', status: 'done' }] }, T0 + 5).board
  expect(autoDecision(activeRun(lifted)!, {}, false)).toMatchObject({ kind: 'send' })
  expect(awaitedExternals(activeRun(lifted)!, false)).toEqual([])
  // Une décision externe attend la personne : le lot est bloqué, comme avant (pause « plus rien ne peut avancer sans toi »).
  const decision = activeRun(onlyOutsideLeft('decision'))!
  expect(isGroupLotStuck(decision, false)).toBe(true)
  expect(awaitedExternals(decision, false)).toEqual([])
  // B bloqué aussi par un id que la mission ne connaît pas : lever la tâche ne le libère pas, le lot reste bloqué.
  const unknown = activeRun(onlyOutsideLeft('task', ['inconnu-9']))!
  expect(isGroupLotStuck(unknown, false)).toBe(true)
  expect(awaitedExternals(unknown, false)).toEqual([])
  // Une tâche de fond en vol : rien à nommer, on attend son retour.
  expect(awaitedExternals(waiting, true)).toEqual([])
  // Un lot sans groupes dont chaque ticket ouvert attend la tâche : elle est nommée (le bandeau la dit).
  const solo = newRun('implement', T0, 'Solo')
  let s: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [solo], activeId: solo.id }
  s = applyReport(s, { tickets: [{ id: 'x1', name: 'Un', blockedBy: ['ext-1'] }, { id: 'x2', name: 'Deux' }], externals: [{ id: 'ext-1', name: 'Revue du diagnostic', kind: 'task', status: 'todo' }] }, T0 + 1).board
  // Un ticket encore libre : rien n'attend la tâche.
  expect(awaitedExternals(activeRun(s)!, false)).toEqual([])
  s = applyReport(s, { set: [{ id: 'x2', status: 'done' }] }, T0 + 2).board
  expect(awaitedExternals(activeRun(s)!, false).map(x => x.id)).toEqual(['ext-1'])
  // Pendant un découpage pas fini, l'auto n'attend aucune tâche : rien n'est nommé.
  const cutting = newRun('to-tickets', T0, 'Découpe')
  let c: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [cutting], activeId: cutting.id }
  c = applyReport(c, { tickets: [{ id: 'x1', name: 'Un', blockedBy: ['ext-1'] }], externals: [{ id: 'ext-1', name: 'Revue du diagnostic', kind: 'task', status: 'todo' }] }, T0 + 1).board
  expect(awaitedExternals(activeRun(c)!, false)).toEqual([])
  // Un nom illisible relu du fichier partagé n'écarte pas la tâche : elle reste attendue (le bandeau la nomme par son id).
  const unnamed = { ...activeRun(s)!, externals: [{ id: 'ext-1', name: 42, status: 'todo', isDecision: false }] } as unknown as Run
  expect(awaitedExternals(unnamed, false).map(x => x.id)).toEqual(['ext-1'])
  // Une entrée hors forme (null, id pas texte) n'est ni trouvée ni attendue, et rien ne lève : le ticket reste bloqué.
  const forged = { ...activeRun(s)!, externals: [null, { id: 42, name: 'X', status: 'todo', isDecision: false }] } as unknown as Run
  expect(awaitedExternals(forged, false)).toEqual([])
})

test('Une décision externe pas tranchée qui bloque un groupe l’emporte sur une tâche attendue ailleurs : le lot est bloqué, la pause la fait voir', () => {
  const run = newRun('implement', T0, 'Boutique')
  let b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const lot = {
    tickets: [
      ...LOT.tickets.map(t => (t.id.startsWith('b') ? { ...t, blockedBy: ['dec-1'] } : t)),
      { id: 'c0', name: 'Doc prép', files: ['src/c.ts'], blockedBy: ['ext-1'] },
      { id: 'c1', name: 'Doc', files: ['src/c.ts'], blockedBy: ['ext-1'] },
    ],
    groups: [...LOT.groups, { id: 'C', name: 'Doc', tickets: ['c0', 'c1'], files: ['src/c.ts'] }],
    externals: [
      { id: 'dec-1', name: 'Choix du format', kind: 'decision', status: 'todo' },
      { id: 'ext-1', name: 'Revue du diagnostic', kind: 'task', status: 'todo' },
    ],
  }
  b = applyReport(b, lot, T0 + 1).board
  b = startLinkedGroups(b, ['A'], T0 + 2)!.board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'] }, T0 + 3).board
  b = applyReport(b, { security: { group: 'A', advised: false, why: 'rien' } }, T0 + 4).board
  const mixed = activeRun(b)!
  // L'effet d'abord : le lot est bloqué (la décision attend la personne), et rien n'est dit attendu.
  expect(isGroupLotStuck(mixed, false)).toBe(true)
  expect(awaitedExternals(mixed, false)).toEqual([])
  // La décision tranchée : B part (C attend toujours sa tâche).
  const decided = activeRun(applyReport(b, { externals: [{ id: 'dec-1', status: 'done' }] }, T0 + 5).board)!
  expect(autoDecision(decided, {}, false)).toMatchObject({ kind: 'send' })
})

test('Une tâche externe sans nom lisible, seule à retenir le lot, est attendue : l’auto ne se met pas en pause', () => {
  const b = onlyOutsideLeft('task')
  const run = activeRun(b)!
  const unnamed = { ...run, externals: run.externals!.map(x => ({ ...x, name: undefined })) } as unknown as Run
  expect(awaitedExternals(unnamed, false).map(x => x.id)).toEqual(['ext-1'])
  expect(isGroupLotStuck(unnamed, false)).toBe(false)
})

test('Une tâche externe dont la levée n’ouvre qu’une relance (groupe revenu deux fois) est attendue, pas un blocage', () => {
  const run = newRun('implement', T0, 'Boutique')
  let b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(b, { ...outsideLot('task'), externals: [{ id: 'ext-1', name: 'Revue du diagnostic', kind: 'task', status: 'done' }] }, T0 + 1).board
  b = startLinkedGroups(b, ['A', 'B'], T0 + 2)!.board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A', 'B'], reviewed: ['A'] }, T0 + 3).board
  b = applyReport(b, { security: { group: 'A', advised: false, why: 'rien' } }, T0 + 4).board
  b = startLinkedGroups(b, ['B'], T0 + 5)!.board
  b = applyReport(b, { returned: ['B'] }, T0 + 6).board
  // La tâche rouverte : B, revenu deux fois, attend la tâche avant que sa relance (une question) se pose.
  b = applyReport(b, { externals: [{ id: 'ext-1', status: 'todo' }] }, T0 + 7).board
  const waiting = activeRun(b)!
  const lifted = { ...waiting, externals: waiting.externals!.map(x => ({ ...x, status: 'done' as const })) }
  expect(autoDecision(lifted, {}, false).relaunch.length).toBeGreaterThan(0)
  expect(awaitedExternals(waiting, false).map(x => x.id)).toEqual(['ext-1'])
  expect(isGroupLotStuck(waiting, false)).toBe(false)
})

test('L’auto attend une tâche externe sans se mettre en pause, le dit au bandeau, et repart quand elle est marquée faite', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...outsideLot('task') } as any)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await turnEnd($, clock)
  // Seul A part : B attend la tâche externe.
  expect(w.texts.length).toBe(1)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false, why: 'rien' } } as any)
  await turnEnd($, clock)
  await settle(clock, 35)
  // L'effet d'abord : le bandeau dit l'attente de la tâche ; puis pas de pause, rien d'envoyé.
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as any)
  expect(await band.find({ type: 'Text', text: /Auto.·.en.attente.de.Revue.du.diagnostic/ })).toBeDefined()
  await band.unmount()
  expect(autoOf(w)?.offAt).toBeUndefined()
  expect(w.texts.length).toBe(1)
  // La tâche marquée faite dans un tour : B part à la fin du tour.
  await $.tool.call({ tool: TOOL, externals: [{ id: 'ext-1', status: 'done' }] } as any)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(2)
  expect(autoOf(w)?.offAt).toBeUndefined()
})

test('Une décision externe pas tranchée que tout le reste attend met l’auto en pause, comme avant', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...outsideLot('decision') } as any)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await turnEnd($, clock)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false, why: 'rien' } } as any)
  await turnEnd($, clock)
  await settle(clock, 35)
  expect(autoOf(w)).toMatchObject({ offWhy: 'plus rien ne peut avancer sans toi' })
  expect(w.texts.length).toBe(1)
})

test('Une tâche externe marquée faite dans un tour interrompu : l’auto repart quand même, sans attendre un autre tour', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...outsideLot('task') } as any)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await turnEnd($, clock)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false, why: 'rien' } } as any)
  await turnEnd($, clock)
  await settle(clock, 35)
  expect(w.texts.length).toBe(1)
  // Le tour s'ouvre, la tâche est marquée faite, et Claude travaille encore plus de deux passages du guet avant l'interruption.
  turns += 1
  await $.turn.start({ turnId: `t${turns}`, text: 'la revue est faite' } as any)
  await $.tool.call({ tool: TOOL, externals: [{ id: 'ext-1', status: 'done' }] } as any)
  await settle(clock, 12)
  expect(w.texts.length).toBe(1)
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: `t${turns}`, reason: 'aborted' } as any)
  await settle(clock, 40)
  expect(w.texts.length).toBe(2)
  expect(autoOf(w)?.offAt).toBeUndefined()
})

test('« ◆ Revue du groupe · worker » pose la marque de l’auto, démarrée : rallumé, l’auto demande la revue de B, pas celle de A', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on)
  // L'auto coupé : la mission a été en auto. A et B rendus finis, sans revue.
  await press($, 'auto-off')
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }], returned: ['A', 'B'] } as any)
  await press($, 'review-linked-A')
  await settle(clock, 2)
  expect(w.filled.at(-1)).toContain('Fais faire la revue du groupe A (Worker)')
  expect(w.stored()!.runs[0]!.autoSent).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'review:A#1', startedAt: expect.any(Number) })]))
  // Rallumé : l'auto évalue et demande la revue de B (l'effet), jamais celle de A, lancée à la main.
  const sent = w.texts.length
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  await turnEnd($, clock)
  await turnEnd($, clock)
  expect(w.texts.slice(sent).filter(t => t.includes('Fais faire la revue du groupe B (App)')).length).toBe(1)
  expect(w.texts.slice(sent).some(t => t.includes('Fais faire la revue du groupe A'))).toBe(false)
})

test('« ⛨ Revue de sécurité » pose la marque de l’auto, démarrée : rallumé, l’auto demande la revue de sécurité de B, pas celle de A', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on)
  await press($, 'auto-off')
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }], returned: ['A', 'B'], reviewed: ['A', 'B'] } as any)
  await $.tool.call({ tool: TOOL, security: { group: 'A', advised: true, why: 'un chemin construit' } } as any)
  await $.tool.call({ tool: TOOL, security: { group: 'B', advised: true, why: 'un chemin construit' } } as any)
  await press($, 'security-group-A')
  await settle(clock, 2)
  expect(w.stored()!.runs[0]!.autoSent).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'security:A#1', startedAt: expect.any(Number) })]))
  const sent = w.texts.length
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  await turnEnd($, clock)
  await turnEnd($, clock)
  expect(w.texts.slice(sent).filter(t => t.includes('Lance la revue de sécurité du groupe B (App)')).length).toBe(1)
  expect(w.texts.slice(sent).some(t => t.includes('Lance la revue de sécurité du groupe A'))).toBe(false)
})

test('« ◆ Revue du groupe » des groupes finis ici pose la marque du /code-review de l’auto, démarrée : rallumé, l’auto ne le relance pas', { timeoutMs: 60000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on, { isAuto: false })
  // Allumé puis coupé : la mission a été en auto, rien n'est fini.
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await press($, 'auto-off')
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }] } as any)
  await press($, 'review-group-A')
  await settle(clock, 2)
  expect(w.filled.at(-1)).toContain('/code-review')
  expect(w.stored()!.runs[0]!.autoSent).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'review:A#0+B#0', startedAt: expect.any(Number) })]))
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  await turnEnd($, clock)
  expect(w.commands).toEqual([])
})

/** Le lot dont A a été confié une fois et rendu avec son ticket ouvert, relu et à la sécurité tranchée à ce premier envoi. */
const resentRun = (): Run => {
  const run = newRun('implement', T0, 'Boutique')
  let b: Board = { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(b, LOT, T0 + 1).board
  b = startLinkedGroups(b, ['A'], T0 + 2)!.board
  b = linkGroupSession(b, 'Boutique > Groupe A · Worker', 'local_a1', T0 + 3)!.board
  b = applyReport(b, { returned: ['A'] }, T0 + 4).board
  const r = activeRun(b)!
  const a = r.groups!.find(g => g.id === 'A')!
  a.reviewedAt = T0 + 5
  a.security = { isAdvised: false, why: 'rien au premier envoi', ranAt: T0 + 5 }
  return r
}

test('Un groupe renvoyé est relu sur son dernier envoi : la revue et la sécurité du premier ne comptent plus, la revue et la sécurité du second partent une fois chacune', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 10_000 })
  const w = world(on)
  const run = resentRun()
  const board: Board = { ...emptyBoard('', 'p'), deleted: [], runs: [{ ...run, status: 'paused', owner: undefined }], activeId: null }
  w.mem['board:'] = JSON.parse(JSON.stringify(board))
  w.disk.board = JSON.stringify(board)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.tool.call({ tool: TOOL, resume: run.id } as any)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  // Le second clic, au repos, envoie à Claude la consigne de l'allumage ; la fin du tour de ce message décide.
  await turnEnd($, clock)
  // Le renvoi de A part (deuxième envoi) ; ce qui vient du premier envoi quitte le groupe, et le journal le dit.
  expect(w.texts.length).toBe(1)
  expect(w.texts[0]).toContain('Groupe A (Worker)')
  expect(groupOf(w, 'A').linked).toMatchObject({ seq: 2 })
  expect(groupOf(w, 'A').reviewedAt).toBeUndefined()
  expect(groupOf(w, 'A').security).toBeUndefined()
  expect(w.stored()!.runs[0]!.log.some(l => l.text.includes('envoi 1') && l.text.includes('revue') && l.text.includes('sécurité'))).toBe(true)
  // Un avis de sécurité qui arrive pendant le nouvel envoi (celui de l'envoi précédent, en retard) ne se pose pas sur lui.
  const late = String((await $.tool.call({ tool: TOOL, security: { group: 'A', advised: false, why: 'du premier envoi' } } as any)).result)
  expect(late).toContain('security: group A is in a worker again (send 2), not returned yet')
  await settle(clock, 2)
  expect(groupOf(w, 'A').security).toBeUndefined()
  // Rendu fini : sa revue part, sous la clé de cet envoi, une fois.
  await $.tool.call({ tool: TOOL, set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }], returned: ['A', 'B'], reviewed: ['B'], security: { group: 'B', advised: false, why: 'rien' } } as any)
  await turnEnd($, clock)
  expect(w.texts.at(-1)).toContain('Fais faire la revue du groupe A (Worker)')
  expect(keysOf(w)).toContain('review:A#2')
  const afterReview = w.texts.length
  await turnEnd($, clock)
  expect(w.texts.length).toBe(afterReview)
  // Relu, sécurité conseillée : sa revue de sécurité part, une fois.
  await $.tool.call({ tool: TOOL, reviewed: ['A'], security: { group: 'A', advised: true, why: 'un chemin construit' } } as any)
  await turnEnd($, clock)
  expect(w.texts.at(-1)).toContain('Lance la revue de sécurité du groupe A (Worker)')
  expect(keysOf(w)).toContain('security:A#2')
  const afterSecurity = w.texts.length
  await turnEnd($, clock)
  expect(w.texts.length).toBe(afterSecurity)
})

/** Un lot mêlé : C fini ici, pas relu ; A rendu fini de son worker, pas relu ; B confié, en vol. */
const mixedBoard = (): Board => {
  const run = newRun('implement', T0, 'Boutique')
  let b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(
    b,
    {
      // Deux tickets par groupe, faits ensemble : un groupe d'un seul ticket n'a pas de revue du groupe.
      tickets: [
        { id: 'a0', name: 'Un prép', files: ['a'] },
        { id: 'a1', name: 'Un', files: ['a'] },
        { id: 'b0', name: 'Deux prép', files: ['b'] },
        { id: 'b1', name: 'Deux', files: ['b'] },
        { id: 'c0', name: 'Trois prép', files: ['c'] },
        { id: 'c1', name: 'Trois', files: ['c'] },
      ],
      groups: [
        { id: 'A', tickets: ['a0', 'a1'], files: ['a'] },
        { id: 'B', tickets: ['b0', 'b1'], files: ['b'] },
        { id: 'C', tickets: ['c0', 'c1'], files: ['c'] },
      ],
    },
    T0 + 1,
  ).board
  b = startLinkedGroups(b, ['A', 'B'], T0 + 2)!.board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'c0', status: 'done' }, { id: 'c1', status: 'done' }], returned: ['A'] }, T0 + 3).board
  return b
}

test('Un /code-review lancé ici ne marque relus que les groupes finis ici : jamais un groupe rendu par son worker ni un groupe en vol', () => {
  const b = mixedBoard()
  const reviewed = applySkill(b, 'code-review', { now: T0 + 4, isMain: true })!.board
  const groups = activeRun(reviewed)!.groups!
  // L'effet d'abord : C, fini ici, est relu.
  expect(groups.find(g => g.id === 'C')!.reviewedAt).toBe(T0 + 4)
  expect(groups.find(g => g.id === 'A')!.reviewedAt).toBeUndefined()
  expect(groups.find(g => g.id === 'B')!.reviewedAt).toBeUndefined()
})

test('« reviewed » et un avis de sécurité pour un groupe confié de nouveau et en vol sont refusés ; pour un premier envoi en vol, l’avis d’ici reste accepté', () => {
  // L'effet d'abord, un premier envoi en vol : l'avis envoyé d'ici est gardé (il l'emporte sur le relais).
  const first = applyReport(mixedBoard(), { security: { group: 'B', advised: false, why: 'rien' } }, T0 + 4)
  expect(activeRun(first.board)!.groups!.find(x => x.id === 'B')!.security).toMatchObject({ isAdvised: false })
  // A, rendu, rouvert puis confié de nouveau (envoi 2), ses tickets faits dans sa session : rien n'est posé sur lui.
  let b = applyReport(mixedBoard(), { set: [{ id: 'a1', status: 'todo' }] }, T0 + 4).board
  b = startLinkedGroups(b, ['A'], T0 + 5)!.board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }] }, T0 + 6).board
  const out = applyReport(b, { reviewed: ['A'], security: { group: 'A', advised: false, why: 'du premier envoi' } }, T0 + 7)
  expect(out.text).toContain('group A is in a worker again (send 2), not returned yet: send its review with its return')
  expect(out.text).toContain('security: group A is in a worker again (send 2), not returned yet')
  const g = activeRun(out.board)!.groups!.find(x => x.id === 'A')!
  expect(g.reviewedAt).toBeUndefined()
  expect(g.security).toBeUndefined()
  // Sans « group », l'avis irait au groupe fini retenu par défaut : A, seul fini ; refusé de même.
  const alone = applyReport(b, { set: [{ id: 'c1', status: 'todo' }] }, T0 + 8).board
  const unnamed = applyReport(alone, { security: { advised: false, why: 'du premier envoi' } }, T0 + 9)
  expect(unnamed.text).toContain('security: group A is in a worker again (send 2), not returned yet')
  expect(activeRun(unnamed.board)!.groups!.find(x => x.id === 'A')!.security).toBeUndefined()
})

test('Un groupe au lien rendu relu abîmé (null), confié de nouveau, perd aussi sa revue et sa sécurité d’avant', () => {
  let b = mixedBoard()
  const run = activeRun(b)!
  b = { ...b, runs: [{ ...run, groups: run.groups!.map(g => (g.id === 'A' ? { ...g, delegated: null as unknown as undefined, reviewedAt: T0 + 3, security: { isAdvised: false } } : g)) }] }
  b = applyReport(b, { set: [{ id: 'a1', status: 'todo' }] }, T0 + 4).board
  const sent = startLinkedGroups(b, ['A'], T0 + 5)!.board
  const a = activeRun(sent)!.groups!.find(g => g.id === 'A')!
  expect(a.linked).toBeDefined()
  expect(a.reviewedAt).toBeUndefined()
  expect(a.security).toBeUndefined()
})

test('Lancée à la main, une revue dont l’envoi auto est resté sans suite démarre sa marque et retire sa question : « ↻ Renvoyer » n’a plus à la redemander', () => {
  let b = mixedBoard()
  b = { ...b, runs: b.runs.map(r => ({ ...r, auto: { onAt: T0, onBy: 's' } })) }
  const mark = linkedReviewMark(activeRun(b)!, 'A')!
  b = markAutoSent(b, { kind: 'review', group: 'A', ...mark }, T0 + 5)!.board
  b = raiseStaleAutoSends(b, T0 + 6, true)!.board
  expect(activeRun(b)!.waiting).toEqual([expect.objectContaining({ id: `sans-suite:${mark.key}` })])
  const launched = markAutoLaunched(b, mark, T0 + 7)!.board
  const run = activeRun(launched)!
  expect(run.autoSent).toEqual([expect.objectContaining({ key: mark.key, startedAt: T0 + 7 })])
  expect(run.waiting ?? []).toEqual([])
})

test('Un groupe relu ici puis confié pour la première fois perd sa revue et sa sécurité d’ici : la revue de son envoi, sous une autre clé, part une fois', () => {
  const run = newRun('implement', T0, 'Boutique')
  let b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(b, LOT, T0 + 1).board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }] }, T0 + 2).board
  const r = activeRun(b)!
  b = { ...b, runs: [{ ...r, auto: { onAt: T0, onBy: 's' } }] }
  // Relu ici, sous la marque de la revue d'ici (unité #0), sa sécurité jugée inutile.
  b = markAutoLaunched(b, hereReviewMark(activeRun(b)!), T0 + 3)!.board
  expect(activeRun(b)!.autoSent).toEqual([expect.objectContaining({ key: 'review:A#0' })])
  b = applySkill(b, 'code-review', { now: T0 + 4, isMain: true })!.board
  b = applyReport(b, { security: { group: 'A', advised: false, why: 'rien' } }, T0 + 5).board
  expect(activeRun(b)!.groups!.find(g => g.id === 'A')!.reviewedAt).toBe(T0 + 4)
  // Un ticket de suite rouvre A ; A est confié à un worker : sa revue et sa sécurité d'ici ne valent plus.
  b = applyReport(b, { set: [{ id: 'a1', status: 'todo' }] }, T0 + 6).board
  b = startLinkedGroups(b, ['A'], T0 + 7)!.board
  const a = activeRun(b)!.groups!.find(g => g.id === 'A')!
  expect(a.reviewedAt).toBeUndefined()
  expect(a.security).toBeUndefined()
  expect(activeRun(b)!.log.some(l => l.text.includes('faites ici ne comptent plus'))).toBe(true)
  // Rendu fini : la revue de cet envoi (review:A#1) est demandée, pas confondue avec celle d'ici.
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'] }, T0 + 8).board
  expect(autoDecision(activeRun(b)!, {}, false)).toMatchObject({ kind: 'send', action: { kind: 'review', key: 'review:A#1' } })
})

/** A fini, relu ici, avec un avis de sécurité conseillé ; puis rouvert par un ticket de suite. */
const reviewedThenReopened = (): Board => {
  const run = newRun('implement', T0, 'Boutique')
  let b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(b, LOT, T0 + 1).board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }] }, T0 + 2).board
  b = applySkill(b, 'code-review', { now: T0 + 3, isMain: true })!.board
  b = applyReport(b, { security: { group: 'A', advised: true, why: 'à voir' } }, T0 + 4).board
  return applyReport(b, { set: [{ id: 'a1', status: 'todo' }] }, T0 + 5).board
}
const groupIn = (board: Board, id: string) => activeRun(board)!.groups!.find(g => g.id === id)!
const RESET = 'its review and security advice reset at a send not returned yet'
/** L'avis d'une revue de sécurité d'ici lancée avant l'envoi, qui arrive pendant : refusé, rien n'est posé. */
const expectLateAdviceRefused = (b: Board, now: number) => {
  const sec = applyReport(b, { security: { group: 'A', findings: 0, fixed: 0 } }, now)
  expect(sec.text).toContain(RESET)
  expect(groupIn(sec.board, 'A').security).toBeUndefined()
  const rev = applyReport(b, { reviewed: ['A'] }, now)
  expect(rev.text).toContain(`${RESET}: send its review with its return`)
  expect(groupIn(rev.board, 'A').reviewedAt).toBeUndefined()
}

test('Un groupe relu ici puis confié : une revue ou un avis arrivés pendant l’envoi sont refusés jusqu’à son retour, qui efface la marque', () => {
  // A part dans un worker : remise à zéro, le groupe le dit jusqu'au retour d'un envoi.
  let b = startLinkedGroups(reviewedThenReopened(), ['A', 'B'], T0 + 6)!.board
  expect(groupIn(b, 'A').isReset).toBe(true)
  expect(groupIn(b, 'A').security).toBeUndefined()
  // B, jamais relu, part sans marque : son premier envoi garde l'avis envoyé d'ici, comme avant.
  expect(groupIn(b, 'B').isReset).toBeUndefined()
  // Pendant l'envoi : l'avis de la revue de sécurité d'ici, lancée avant, est refusé ; « reviewed » aussi.
  expectLateAdviceRefused(b, T0 + 7)
  // Au retour, l'avis de la session vaut, et la marque s'efface.
  const back = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }], returned: ['A'], security: { group: 'A', advised: true, findings: 1, fixed: 1 } }, T0 + 8).board
  expect(groupIn(back, 'A').security).toMatchObject({ isAdvised: true, findings: 1, fixed: 1 })
  expect(groupIn(back, 'A').delegated).toBeDefined()
  expect(groupIn(back, 'A').isReset).toBeUndefined()
  // Une marque relue d'un autre type ne vaut rien : seul `true` refuse.
  b = { ...b, runs: [{ ...activeRun(b)!, groups: activeRun(b)!.groups!.map(g => (g.id === 'A' ? { ...g, isReset: 'oui' as unknown as true } : g)) }] }
  expect(applyReport(b, { security: { group: 'A', findings: 0, fixed: 0 } }, T0 + 7).text).not.toContain(RESET)
})

test('La marque de la remise à zéro survit à une annulation puis une relance, et au renvoi d’une vague : l’avis d’avant reste refusé pendant l’envoi suivant', () => {
  // Annulé, puis relancé sans rien à remettre à zéro : la marque reste, l'avis d'avant est refusé.
  const sent = startLinkedGroups(reviewedThenReopened(), ['A'], T0 + 6)!.board
  const cancelled = cancelLinkedGroup(sent, 'A', T0 + 7)!.board
  expect(groupIn(cancelled, 'A').linked).toBeUndefined()
  expect(groupIn(cancelled, 'A').isReset).toBe(true)
  const relaunched = startLinkedGroups(cancelled, ['A'], T0 + 8)!.board
  expect(groupIn(relaunched, 'A').linked).toMatchObject({ seq: 2 })
  expectLateAdviceRefused(relaunched, T0 + 9)
  // Une vague restée sans suite, « ↻ Renvoyer », puis la vague de nouveau : la marque reste aussi.
  const wave = { kind: 'groups' as const, groups: ['A'], key: 'groups:A#1', what: 'groupe A dans un worker', blocks: { kind: 'group' as const, id: 'A' } }
  const marked = markAutoSent(reviewedThenReopened(), wave, T0 + 6)!.board
  const waved = startLinkedGroups(marked, ['A'], T0 + 6)!.board
  const stale = raiseStaleAutoSends(waved, T0 + 7, true)!.board
  const resent = resendAutoMark(stale, stale.activeId!, wave.key, T0 + 8)!.board
  expect(groupIn(resent, 'A').linked).toBeUndefined()
  expect(groupIn(resent, 'A').isReset).toBe(true)
  expectLateAdviceRefused(startLinkedGroups(resent, ['A'], T0 + 9)!.board, T0 + 10)
})

test('Un groupe relu ici, confié puis annulé et fini ici, demande une nouvelle revue d’ici, une fois : la marque de la première ne le retient pas', () => {
  const run = newRun('implement', T0, 'Boutique')
  let b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(b, LOT, T0 + 1).board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }] }, T0 + 2).board
  const r = activeRun(b)!
  b = { ...b, runs: [{ ...r, auto: { onAt: T0, onBy: 's' } }] }
  b = markAutoLaunched(b, hereReviewMark(activeRun(b)!), T0 + 3)!.board
  b = applySkill(b, 'code-review', { now: T0 + 4, isMain: true })!.board
  b = applyReport(b, { security: { group: 'A', advised: false, why: 'rien' } }, T0 + 5).board
  b = applyReport(b, { set: [{ id: 'a1', status: 'todo' }] }, T0 + 6).board
  b = startLinkedGroups(b, ['A'], T0 + 7)!.board
  b = cancelLinkedGroup(b, 'A', T0 + 8)!.board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }] }, T0 + 9).board
  // L'effet : une nouvelle revue d'ici part, sous l'unité de l'envoi annulé.
  const decision = autoDecision(activeRun(b)!, {}, false)
  expect(decision).toMatchObject({ kind: 'send', action: { kind: 'command', key: 'review:A#1' } })
  b = markAutoLaunched(b, hereReviewMark(activeRun(b)!), T0 + 10)!.board
  expect(autoDecision(activeRun(b)!, {}, false)).not.toMatchObject({ kind: 'send', action: { key: 'review:A#1' } })
})

test('Une revue lancée qui nomme deux groupes finis ici les marque relus tous les deux, même quand la file n’en nomme qu’un', () => {
  const run = newRun('implement', T0, 'Boutique')
  let b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  b = applyReport(b, { ...LOT, set: [] }, T0 + 1).board
  b = applyReport(b, { set: [{ id: 'a0', status: 'done' }, { id: 'a1', status: 'done' }, { id: 'b0', status: 'done' }, { id: 'b1', status: 'done' }] }, T0 + 2).board
  const r = activeRun(b)!
  b = { ...b, runs: [{ ...r, auto: { onAt: T0, onBy: 's' }, queue: ['a1'] }] }
  // Sans marque, la file l'emporte : seul A est relu (le comportement d'avant).
  const plain = activeRun(applySkill(b, 'code-review', { now: T0 + 3, isMain: true })!.board)!.groups!
  expect(plain.map(g => [g.id, g.reviewedAt])).toEqual([['A', T0 + 3], ['B', undefined]])
  // Avec la marque de la revue lancée qui nomme A et B : les deux sont relus.
  const marked = markAutoLaunched(b, hereReviewMark(activeRun(b)!), T0 + 3)!.board
  const both = activeRun(applySkill(marked, 'code-review', { now: T0 + 4, isMain: true })!.board)!.groups!
  expect(both.map(g => [g.id, g.reviewedAt])).toEqual([['A', T0 + 4], ['B', T0 + 4]])
})
