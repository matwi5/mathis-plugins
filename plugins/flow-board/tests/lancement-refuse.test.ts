// Un lancement de groupe que l'auto envoie au nom du mod (prompt.submit) : l'app Desktop compte ce tour
// comme un événement automatique et refuse start_session. Le mod capte le refus : il remet la même
// demande dans la saisie, pour que la personne la lance d'un Entrée (un tour à elle), et dit à Claude
// de ne rien relancer lui-même. Décision de Mathis du 02/11/2026 (« refus capté »).

import { expect, mock, test } from 'claude-code/testing'

import type { Board } from '../types'

const T0 = 140_000_000
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
  const texts: { text: string; origin: any }[] = []
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
  // `refusals` : les prochaines demandes du mod que le moteur ne fait pas entrer (un hook rend `drop`).
  const flags = { refusals: 0 }
  on('prompt.submit', (_$: unknown, e: { text: string; origin: any }) => {
    // La consigne de l'allumage, que le mod envoie à Claude au repos : à part des demandes qu'il soumet.
    if (e.text.startsWith(BRIEF)) return { text: e.text }
    texts.push({ text: e.text, origin: e.origin })
    if (flags.refusals > 0) {
      flags.refusals -= 1
      return { drop: 'refusé par un hook' }
    }
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
  on('ui.notify', (_$: unknown, e: { text: string }) => {
    notices.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  const stored = (): Board | undefined => (disk.isUsed && disk.board !== undefined ? JSON.parse(disk.board) : (mem['board:'] as Board | undefined))
  return { mem, disk, commands, texts, notices, stored, filled, flags }
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
const turnEnd = async ($: any, clock: { advance: (ms: number) => Promise<void> }) => {
  turns += 1
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: `t${turns}`, reason: 'answer' })
  await settle(clock, 1)
}

/** Trois groupes : A et B indépendants (la première vague), C qui partage un fichier avec A (la suivante). */
const LOT = {
  tickets: [
    { id: 'a1', name: 'Worker', files: ['src/a.ts'] },
    { id: 'b1', name: 'App', files: ['src/b.ts'] },
    { id: 'c1', name: 'Worker bis', files: ['src/a.ts'] },
  ],
  groups: [
    { id: 'A', name: 'Worker', tickets: ['a1'], files: ['src/a.ts'] },
    { id: 'B', name: 'App', tickets: ['b1'], files: ['src/b.ts'] },
    { id: 'C', name: 'Worker bis', tickets: ['c1'], files: ['src/a.ts'] },
  ],
}

/**
 * Une mission dont les tickets sont découpés en groupes, actif dans la discussion « sa », auto allumé
 * (ou non), la phase des tickets finie (`questions` : déclarées avant la fin du tour) : la carte « Ensuite »
 * propose les groupes, que l'auto lance à la fin du tour.
 */
const implementing = async ($: any, on: any, lot: Record<string, unknown> = LOT, o: { isAuto?: boolean; questions?: unknown[]; refusals?: number } = {}) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  w.flags.refusals = o.refusals ?? 0
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...lot } as any)
  if (o.isAuto !== false) {
    await press($, 'auto-on')
    await press($, 'auto-confirm')
  }
  await $.tool.call({ tool: TOOL, complete: true, ...(o.questions ? { waiting: o.questions } : {}) } as any)
  await turnEnd($, clock)
  // Avec des groupes, la suite n'est pas /implement : c'est le lancement des groupes, après une compaction quand
  // le découpage a fini sous l'auto (compaction stratégique).
  expect(w.commands).toEqual(o.isAuto !== false ? ['compact'] : [])
  w.commands.length = 0
  return { clock, ...w }
}

const START = 'mcp__ccd_session__start_session'
const REFUSAL = "Start sessions only on the user's own words to you here; this turn runs an automated event, another session's message, or the task another session gave you."

test('un start_session refusé dans le tour d’une vague de l’auto : la même demande revient dans la saisie, et Claude lit de ne rien relancer', { timeoutMs: 40000 }, async ($, on) => {
  on('tool.call', { tool: START }, () => ({ isError: true, result: REFUSAL, text: REFUSAL }))
  const { clock, ...w } = await implementing($, on)
  expect(w.texts.length).toBe(1)
  const wave = w.texts[0]!.text
  await $.turn.start({ text: wave, turnId: 'auto-1' })
  const first = await $.tool.call({ tool: START, title: 'Boutique > Groupe A · Worker', initiation: 'user_asked', prompt: 'x' } as any)
  const second = await $.tool.call({ tool: START, title: 'Boutique > Groupe B · App', initiation: 'user_asked', prompt: 'x' } as any)
  // Rempli une fois, avec exactement la demande envoyée par l'auto.
  expect(w.filled).toEqual([wave])
  for (const r of [first, second]) {
    expect(r.isError).toBe(true)
    expect((r.context ?? []).join(' ')).toContain('Ne relance rien toi-même')
    expect((r.context ?? []).join(' ')).toContain('La même demande de lancement est dans la saisie')
  }
  await turnEnd($, clock)
  // Rien ne repart seul : la vague reste marquée, sans second envoi.
  expect(w.texts.length).toBe(1)
})

test('hors du tour d’une vague de l’auto, un start_session refusé ne remplit rien', { timeoutMs: 40000 }, async ($, on) => {
  on('tool.call', { tool: START }, () => ({ isError: true, result: 'boom', text: 'boom' }))
  const { clock, ...w } = await implementing($, on)
  await $.turn.start({ text: w.texts[0]!.text, turnId: 'auto-1' })
  await turnEnd($, clock)
  // Le tour de la vague est fini : un refus plus tard (un tour de la personne) reste tel quel.
  await $.turn.start({ text: 'lance A', turnId: 'user-1' })
  const r = await $.tool.call({ tool: START, title: 'Boutique > Groupe A · Worker', initiation: 'user_asked', prompt: 'x' } as any)
  expect(w.filled).toEqual([])
  expect(r.context ?? []).toEqual([])
})

test('un tour intercalé avant celui de la vague (message d’une autre session) : son refus ne remplit rien, et le tour de la vague garde le suivi', { timeoutMs: 40000 }, async ($, on) => {
  on('tool.call', { tool: START }, () => ({ isError: true, result: REFUSAL, text: REFUSAL }))
  const { clock, ...w } = await implementing($, on)
  const wave = w.texts[0]!.text
  await $.turn.start({ text: 'Compte rendu du groupe Z', turnId: 'autre-1' })
  const other = await $.tool.call({ tool: START, title: 'Autre', initiation: 'user_asked', prompt: 'x' } as any)
  expect(w.filled).toEqual([])
  expect(other.context ?? []).toEqual([])
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 'autre-1', reason: 'answer' })
  await $.turn.start({ text: wave, turnId: 'auto-1' })
  const r = await $.tool.call({ tool: START, title: 'Boutique > Groupe A · Worker', initiation: 'user_asked', prompt: 'x' } as any)
  expect(w.filled).toEqual([wave])
  expect((r.context ?? []).join(' ')).toContain('Ne relance rien toi-même')
  await turnEnd($, clock)
})

test('un lancement que la personne refuse ou interrompt dans le tour de la vague n’est pas un refus de l’app : rien n’est rempli', { timeoutMs: 40000 }, async ($, on) => {
  const REJECTED = "The user doesn't want to proceed with this tool use. The tool use was rejected."
  on('tool.call', { tool: START }, () => ({ isError: true, result: REJECTED, text: REJECTED }))
  const { clock, ...w } = await implementing($, on)
  await $.turn.start({ text: w.texts[0]!.text, turnId: 'auto-1' })
  const r = await $.tool.call({ tool: START, title: 'Boutique > Groupe A · Worker', initiation: 'user_asked', prompt: 'x' } as any)
  expect(w.filled).toEqual([])
  expect(r.context ?? []).toEqual([])
  await turnEnd($, clock)
})
