// La relance de l'auto pour un lot sans groupes : la revue du lot à relire part une fois par passage,
// sous `review:lot@<date de la dernière revue du lot, 0 sans revue>~<dernière fin de ticket>`, avant le compte rendu, même après
// un `{"complete": true}` de l'Implémentation ; puis la revue de sécurité conseillée par un avis
// postérieur à la dernière fin de ticket et à la dernière revue, pas lancée, une fois par revue du lot,
// sous `security:lot@<date de cette revue>`. Ni l'une ni l'autre ne part
// tant qu'une tâche de fond tourne, ni quand une question bloque la phase. Invariant : la liste des
// marques d'envoi n'est jamais réécrite vide ni privée des marques d'une autre discussion ; une revue du
// lot n'est jamais envoyée deux fois par l'auto pour le même passage, et une marque d'un passage
// précédent n'empêche jamais la revue d'un passage suivant.

import { expect, mock, test } from 'claude-code/testing'

import { autoDecision, clampFuture, emptyBoard, hereReviewMark, mergeBoards, needsReview, newRun } from '../hooks/model.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board, Run } from '../types'

const T0 = 150_000_000
const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
/** Le début du message de consigne que le mod envoie à Claude quand l'auto s'allume au repos. */
const BRIEF = '⚡ flow-board: the auto mode instructions for this mission'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const

const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')

/** Le moteur sous le plugin : le board au fichier commun ou dans `$.store`, les commandes et les textes que le mod envoie. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const disk: { board?: string; isUsed: boolean } = { isUsed: false }
  const commands: string[] = []
  const texts: string[] = []
  const flags = { refusals: 0 }
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
  // `refusals` : les prochaines commandes du mod que le moteur refuse.
  on('command.run', (_$: unknown, e: { command: string }) => {
    commands.push(e.command)
    if (flags.refusals > 0) {
      flags.refusals -= 1
      throw new Error('commande refusée')
    }
    return { text: '' }
  })
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    if (!e.text.startsWith(BRIEF)) texts.push(e.text)
    return { text: e.text }
  })
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.suggest', () => ({ isShown: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: undefined }))
  on('classic.Stop', () => ({}))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  const stored = (): Board | undefined => (disk.isUsed && disk.board !== undefined ? JSON.parse(disk.board) : (mem['board:'] as Board | undefined))
  return { commands, texts, stored, flags, filled }
}

const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key })
  await pane.unmount()
}
let turns = 0
/** La fin d'un tour : `classic.Stop` (avec ses tâches de fond encore en cours), puis `turn.complete`. */
const turnEnd = async ($: any, clock: { advance: (ms: number) => Promise<void> }, background: unknown[] = []) => {
  turns += 1
  await $.classic.Stop({ session_id: 'sa', transcript_path: '/t', cwd: '', hook_event_name: 'Stop', stop_hook_active: false, background_tasks: background })
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: `t${turns}`, reason: 'answer' })
  await settle(clock, 1)
}

const CODE = { sensitive: false, logic: true }
const LIGHT = { sensitive: false, logic: false }

/**
 * Un lot sans groupes, actif dans la discussion « sa », ses tickets faits (avec `complete` s'il le
 * faut) ; l'auto s'allume ensuite au repos (`isAuto`), et la fin du tour du message de consigne décide.
 */
const doneLot = async ($: any, on: any, o: { flags?: Record<string, unknown>; isComplete?: boolean; isAuto?: boolean; questions?: unknown[] } = {}) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  const flags = o.flags ?? CODE
  await $.tool.call({ tool: TOOL, title: 'Boutique', tickets: [{ id: 'c1', name: 'Un', ...flags }, { id: 'c2', name: 'Deux', ...flags }] } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'c1', status: 'done' }, { id: 'c2', status: 'done' }], ...(o.isComplete !== false ? { complete: true } : {}), ...(o.questions ? { waiting: o.questions } : {}) } as any)
  if (o.isAuto !== false) {
    await press($, 'auto-on')
    await press($, 'auto-confirm')
    await settle(clock, 1)
  }
  return { clock, ...w }
}

/** Une clé de marque sans l'empreinte des tickets faits qui finit la clé d'une revue du lot. */
const bare = (key: string): string => key.replace(/^(review:lot@[^~]+~[^~]+)~[0-9a-z]+$/, '$1')
const marksOf = (w: { stored: () => Board | undefined }) => (w.stored()!.runs[0]!.autoSent ?? []).map(m => bare(m.key))

test('lot fini, non relu, après un complete : la revue du lot part une fois, sous la clé du passage', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on)
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review'])
  expect(marksOf(w)).toEqual([`review:lot@0~${T0}`])
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review'])
})

test('Implémentation encore active : la revue du lot part de même, avant le compte rendu', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on, { isComplete: false })
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review'])
})

test('relu, sécurité conseillée et pas lancée : elle part une fois ; tranchée, le compte rendu suit', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on)
  await turnEnd($, clock)
  // La revue se charge (son tour) : le lot est relu ; sans avis, rien d'autre ne part.
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await settle(clock, 1)
  const reviewedAt = w.stored()!.runs[0]!.reviewedAt!
  expect(reviewedAt).toBeGreaterThan(T0)
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review'])
  expect(w.texts).toEqual([])
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'un chemin lu ailleurs' } } as any)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(1)
  expect(w.texts[0]).toMatch(/^Avant de la lancer, envoie à l'outil flow \{"security": \{"advised": true, "why": "<raison>"\}\} : l'avis de ce passage\. Lance la revue de sécurité de cette mission/)
  expect(marksOf(w)).toEqual([`review:lot@0~${T0}`, `security:lot@${reviewedAt}`])
  await turnEnd($, clock)
  expect(w.texts.length).toBe(1)
  await $.tool.call({ tool: TOOL, security: { findings: 0, fixed: 0 } } as any)
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review', 'flow-board:compte-rendu'])
})

test('un ticket ajouté puis fini après la revue : une nouvelle revue part sous une autre clé', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on)
  await turnEnd($, clock)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await settle(clock, 1)
  const reviewedAt = w.stored()!.runs[0]!.reviewedAt!
  expect(reviewedAt).toBeGreaterThan(T0)
  await $.tool.call({ tool: TOOL, security: { advised: false, why: 'rien' } } as any)
  await settle(clock, 1)
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'c3', name: 'Trois', ...CODE }] } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'c3', status: 'done' }] } as any)
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review', 'code-review'])
  const c3End = w.stored()!.runs[0]!.tickets.find(t => t.id === 'c3')!.finishedAt!
  expect(marksOf(w)).toEqual([`review:lot@0~${T0}`, `review:lot@${reviewedAt}~${c3End}`])
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review', 'code-review'])
})

test('« ◆ Revue » lancé à la main : la même clé se pose démarrée, rien ne repart', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on, { isAuto: false })
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await press($, 'go-final-review')
  await settle(clock, 1)
  await turnEnd($, clock)
  expect(w.commands).toEqual([])
  const marks = w.stored()!.runs[0]!.autoSent ?? []
  expect(marks.map(m => bare(m.key))).toEqual([`review:lot@0~${T0}`])
  expect(marks[0]!.startedAt).toBeDefined()
})

test('« ⛨ Revue de sécurité » lancé à la main sur le lot : sa clé se pose démarrée, rien ne repart ; la demande fait envoyer l’avis avec les comptes', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on)
  await turnEnd($, clock)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'un chemin lu ailleurs' } } as any)
  await press($, 'security-group-lot')
  await settle(clock, 1)
  const reviewedAt = w.stored()!.runs[0]!.reviewedAt!
  expect(w.filled.at(-1)).toContain('{"security": {"advised": true, "why": "<raison>"}}')
  expect(w.filled.at(-1)).toContain('Puis envoie à l\'outil flow {"security": {"findings": <failles gardées>, "fixed": <corrigées>}}')
  await turnEnd($, clock)
  expect(w.texts).toEqual([])
  const marks = w.stored()!.runs[0]!.autoSent ?? []
  expect(marks.map(m => bare(m.key))).toEqual([`review:lot@0~${T0}`, `security:lot@${reviewedAt}`])
  expect(marks[1]!.startedAt).toBeDefined()
})

test('une question bloquante sur la phase Implémentation retient la revue du lot, puis sa sécurité ; répondue, chacune part', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on, { questions: [{ id: 'qi', phase: 'implement', text: 'Invariant du ticket c2 ?' }] })
  expect((w.stored()!.runs[0]!.waiting ?? []).map(q => q.id)).toEqual(['qi'])
  await turnEnd($, clock)
  expect(w.commands).toEqual([])
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'qi', answered: true }] } as any)
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review'])
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'un chemin lu ailleurs' }, waiting: [{ id: 'qs', phase: 'implement', text: 'Laisser F1 ?' }] } as any)
  await turnEnd($, clock)
  expect(w.texts).toEqual([])
  // Plus rien n'avance sans toi : l'auto se met en pause, comme pour toute question qui retient la suite.
  expect(w.stored()!.runs[0]!.auto).toMatchObject({ offWhy: 'plus rien ne peut avancer sans toi' })
  await $.tool.call({ tool: TOOL, waiting: [{ id: 'qs', answered: true }] } as any)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(1)
})

test('un /code-review rechargé fait tomber l’avis : rien ne repart sur l’ancien ; le nouvel avis de cette revue fait relancer la sécurité, une fois', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on)
  await turnEnd($, clock)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'un chemin lu ailleurs' } } as any)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(1)
  // Une seconde passe de revue se charge avant les comptes : l'avis d'avant elle ne compte plus.
  await settle(clock, 1)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await settle(clock, 1)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(1)
  expect(w.commands).toEqual(['code-review'])
  // L'avis de cette revue : la sécurité se relance sous la clé de cette revue, une fois.
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'un chemin lu ailleurs' } } as any)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(2)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(2)
})

test('lot dispensé avec un avis de sécurité explicite : l’auto ne demande rien', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on, { flags: LIGHT, isComplete: false })
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'un chemin lu ailleurs' } } as any)
  await turnEnd($, clock)
  expect(w.stored()!.runs[0]!.security?.isAdvised).toBe(true)
  expect(w.commands).toEqual([])
  expect(w.texts).toEqual([])
})

test('une tâche de fond en cours retient la revue du lot ; au tour suivant, toujours due, elle part', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on)
  await turnEnd($, clock, [{ id: 'bg1', description: 'relecteur de sécurité' }])
  expect(w.commands).toEqual([])
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review'])
})

test('une tâche de fond en cours retient la sécurité conseillée du lot', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on)
  await turnEnd($, clock)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'un chemin lu ailleurs' } } as any)
  await turnEnd($, clock, [{ id: 'bg1', description: 'relecteur de sécurité' }])
  expect(w.texts).toEqual([])
  await turnEnd($, clock)
  expect(w.texts.length).toBe(1)
})

test('lot dispensé : rien ne part pour sa revue ni sa sécurité, le compte rendu suit', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on, { flags: LIGHT })
  await turnEnd($, clock)
  expect(w.commands).toEqual(['flow-board:compte-rendu'])
  expect(w.texts).toEqual([])
})

test('une revue du lot refusée devient la question « envoi resté sans suite », sur la phase', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await doneLot($, on)
  w.flags.refusals = 1
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review'])
  const run = w.stored()!.runs[0]!
  expect((run.waiting ?? []).map(q => `sans-suite:${bare(q.id.slice('sans-suite:'.length))}`)).toEqual([`sans-suite:review:lot@0~${T0}`])
  expect(run.waiting).toEqual([expect.objectContaining({ blocks: { kind: 'phase', id: 'implement' } })])
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review'])
})

test('une fin de ticket datée dans le futur se relit maintenant : la revue suivante relit le lot, l’auto ne la renvoie pas', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  run.tickets = [{ id: 'c1', name: 'Un', status: 'done', finishedAt: 9_000_000, ...CODE } as Run['tickets'][number]]
  const read = activeRun(clampFuture({ ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }, 10_000))!
  expect(read.tickets[0]!.finishedAt).toBe(10_000)
  expect(needsReview(read)).toBe(true)
  expect(needsReview({ ...read, reviewedAt: 11_000 })).toBe(false)
})

test('après une revue refusée à la fusion, la revue du lot repart : la marque « ◆ Revue » de l’autre copie, sur la même revue de base, ne la retient pas', () => {
  // Les deux copies partent de la revue de 5 000 (t1) ; toutes deux ont t3 fini à 6 000. Ici seulement,
  // t2 est fini, sans date lisible : ni la dernière fin ni la revue de base ne distinguent les deux copies.
  const base = { ...newRun('implement', 1_000, 'Lot'), owner: 's', reviewedAt: 5_000 }
  base.auto = { onAt: 1_500, onBy: 's' } as Run['auto']
  const t1 = { id: 't1', name: 'Un', status: 'done', finishedAt: 4_000, ...CODE }
  const t3 = { id: 't3', name: 'Trois', status: 'done', finishedAt: 6_000, ...CODE }
  const t2 = { id: 't2', name: 'Deux', status: 'done', ...CODE }
  const theirs0: Run = { ...base, tickets: [t1, t3] as Run['tickets'] }
  // L'autre copie presse « ◆ Revue » (sa marque, démarrée, sous sa clé), puis relit à 7 000 sans voir t2.
  const pressed = hereReviewMark(theirs0)!
  const theirs: Run = { ...theirs0, reviewedAt: 7_000, autoSent: [{ key: pressed.key, at: 6_900, startedAt: 6_900 }], updatedAt: 7_000 }
  const mine: Run = { ...base, tickets: [t1, t2, t3] as Run['tickets'], updatedAt: 7_100 }
  const board = (run: Run): Board => ({ ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id })
  const merged = activeRun(mergeBoards(board(mine), board(theirs)))!
  expect(merged.reviewedAt).toBe(5_000)
  expect((merged.autoSent ?? []).map(m => m.key)).toEqual([pressed.key])
  const decision = autoDecision(merged, {}, false)
  expect(decision.kind).toBe('send')
  expect(decision.kind === 'send' ? decision.action.key : pressed.key).not.toBe(pressed.key)
})

test('une marque de sécurité d’un passage précédent, même datée dans le futur, ne retient pas la sécurité du passage suivant', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  run.tickets = [
    { id: 'c1', name: 'Un', status: 'done', finishedAt: 2_000, ...CODE },
    { id: 'c3', name: 'Trois', status: 'done', finishedAt: 6_000, ...CODE },
  ] as Run['tickets']
  run.auto = { onAt: 1_500, onBy: 's' } as Run['auto']
  // Passage 1 relu à 3 000, sa sécurité demandée sous une horloge en avance ; passage 2 relu à 7 000, avis à 7 100.
  const marks = [{ key: 'review:lot@0', at: 2_500, startedAt: 2_500 }, { key: 'security:lot@3000', at: 90_000, startedAt: 90_000 }, { key: 'review:lot@3000', at: 6_500, startedAt: 6_500 }]
  const next: Run = { ...run, reviewedAt: 7_000, security: { isAdvised: true, at: 7_100 }, autoSent: marks }
  const decision = autoDecision(next, {}, false)
  expect(decision.kind).toBe('send')
  expect(decision.kind === 'send' ? decision.action.key : '').toBe('security:lot@7000')
  // Marquée pour cette revue, elle ne repart pas.
  const sent: Run = { ...next, autoSent: [...marks, { key: 'security:lot@7000', at: 7_200, startedAt: 7_200 }] }
  expect(autoDecision(sent, {}, false).kind).not.toBe('send')
  // Une revue rechargée (8 000) et son avis (8 100) : la marque de la revue d'avant ne la couvre pas.
  const reloaded: Run = { ...sent, reviewedAt: 8_000, security: { isAdvised: true, at: 8_100 } }
  const again = autoDecision(reloaded, {}, false)
  expect(again.kind === 'send' ? again.action.key : '').toBe('security:lot@8000')
})

test('deux copies fusionnées : aucune marque du lot perdue, et la revue ne repart pas', () => {
  const base = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  base.tickets = [{ id: 'c1', name: 'Un', status: 'done', finishedAt: 2_000, ...CODE } as Run['tickets'][number]]
  base.auto = { onAt: 1_500, onBy: 's' } as Run['auto']
  const mine: Run = { ...base, reviewedAt: 3_000, autoSent: [{ key: 'review:lot@0', at: 2_500, startedAt: 2_500 }], updatedAt: 3_000 }
  const theirs: Run = { ...base, reviewedAt: 3_000, security: { isAdvised: true, at: 3_100 }, autoSent: [{ key: 'review:lot@0', at: 2_500, startedAt: 2_500 }, { key: 'security:lot@3000', at: 3_200, startedAt: 3_200 }], updatedAt: 3_200 }
  const board = (run: Run): Board => ({ ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id })
  for (const [a, b] of [[mine, theirs], [theirs, mine]] as const) {
    const run = activeRun(mergeBoards(board(a), board(b)))!
    expect((run.autoSent ?? []).map(m => m.key).sort()).toEqual(['review:lot@0', 'security:lot@3000'])
    expect(autoDecision(run, {}, false).kind).not.toBe('send')
  }
})

test('une revue du lot datée dans le futur se relit à refaire : la revue repart sous une clé neuve, et les marques lot@0 d’avant ne la couvrent pas', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  run.tickets = [{ id: 'c1', name: 'Un', status: 'done', finishedAt: 2_000, ...CODE } as Run['tickets'][number]]
  run.auto = { onAt: 1_500, onBy: 's' } as Run['auto']
  // Un passage d'avant, sans revue lisible, a déjà ses marques lot@0 ; puis une revue datée dans le futur.
  const marks = [{ key: 'review:lot@0~2000', at: 2_500, startedAt: 2_500 }, { key: 'security:lot@0', at: 2_600, startedAt: 2_600 }, { key: 'security:lot@99000000', at: 2_700, startedAt: 2_700 }]
  const future: Run = { ...run, reviewedAt: 99_000_000, security: { isAdvised: true, at: 99_000_100 }, autoSent: marks }
  const read = activeRun(clampFuture({ ...emptyBoard('/w/p', 'p'), session: 's', deleted: [], runs: [future], activeId: future.id }, 10_000))!
  // Rien n'est effacé : la date reste dans le fichier, en négatif, et ne compte plus comme une revue.
  expect(read.reviewedAt).toBe(-99_000_000)
  expect(needsReview(read)).toBe(true)
  const decision = autoDecision(read, {}, false)
  expect(decision.kind).toBe('send')
  const key = decision.kind === 'send' ? decision.action.key : ''
  expect(key.startsWith('review:lot@')).toBe(true)
  expect(bare(key)).not.toBe('review:lot@0~2000')
  expect(key).not.toBe(hereReviewMark({ ...run, reviewedAt: undefined })!.key)
  // La revue suivante la remplace ; l'avis donné après elle part, aucune marque d'avant ne le couvre.
  const reviewed: Run = { ...read, reviewedAt: 11_000, security: { isAdvised: true, at: 11_100 }, autoSent: [...marks, { key, at: 10_500, startedAt: 10_500 }] }
  const next = autoDecision(reviewed, {}, false)
  expect(next.kind === 'send' ? next.action.key : '').toBe('security:lot@11000')
})
