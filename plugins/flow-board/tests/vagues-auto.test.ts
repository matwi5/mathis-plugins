// Les vagues, les revues et les relances du mode auto : en implémentation, l'auto lance la vague prête
// (tout le lot parallèle, sans les groupes bloqués par une question), attend qu'elle soit close avant
// la suivante, lance la revue du groupe et la revue de sécurité conseillée au retour d'un groupe, et
// renvoie une fois un groupe revenu avec des tickets ouverts avant de le bloquer par une question. Les
// sessions liées d'un parcours en auto sont des sessions autonomes, jamais en xhigh. Invariant : une
// même action auto (phase, vague, groupe, revue) n'est jamais envoyée deux fois.

import { expect, mock, test } from 'claude-code/testing'

import type { Board } from '../types'

const T0 = 140_000_000
const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
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
 * Un parcours dont les tickets sont découpés en groupes, actif dans la discussion « sa », auto allumé
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
  // Avec des groupes, la suite n'est pas /implement : c'est le lancement des groupes.
  expect(w.commands).toEqual([])
  return { clock, ...w }
}

const groupOf = (w: { stored: () => Board | undefined }, id: string) => w.stored()!.runs[0]!.groups!.find(g => g.id === id)!

test('La vague prête part une fois, en un seul texte au nom du mod ; la suivante attend que la vague en cours soit close', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on)
  expect(w.texts.length).toBe(1)
  const wave = w.texts[0]!
  expect(wave.origin).toMatchObject({ kind: 'plugin', name: PLUGIN })
  expect(wave.text).toContain('Confie chacun de ces groupes à sa session liée, en parallèle')
  expect(wave.text).toContain('Groupe A (Worker)')
  expect(wave.text).toContain('Groupe B (App)')
  expect(wave.text).not.toContain('Groupe C')
  expect(groupOf(w, 'A').linked).toBeDefined()
  expect(groupOf(w, 'B').linked).toBeDefined()
  // Rien d'autre ne part tant que la vague n'est pas close : ni C, ni un second envoi de A ou B.
  await turnEnd($, clock)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false, why: 'rien de sensible' } } as any)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(1)
  // B rendu, relu, sa sécurité tranchée : la vague est close, C part.
  await $.tool.call({ tool: TOOL, set: [{ id: 'b1', status: 'done' }], returned: ['B'], reviewed: ['B'], security: { group: 'B', advised: false, why: 'rien de sensible' } } as any)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(2)
  expect(w.texts[1]!.text).toContain('Confie ce groupe à une session liée')
  expect(w.texts[1]!.text).toContain('Groupe C (Worker bis)')
  await turnEnd($, clock)
  expect(w.texts.length).toBe(2)
})

test('Le brief d’un parcours en auto : sessions autonomes quel que soit leur effort, jamais xhigh, sans question d’effort', { timeoutMs: 40000 }, async ($, on) => {
  const { ...w } = await implementing($, on)
  const text = w.texts[0]!.text
  expect(text).toContain('quel que soit son effort')
  expect(text).toContain('jamais xhigh')
  expect(text).toContain('ne me pose pas la question « xhigh (Recommandé) / high »')
  expect(text).toContain('déclare dans decided que xhigh n’a pas été proposé')
  expect(text).not.toContain('pose-moi une question à boutons « xhigh (Recommandé) / high »')
  expect(text).not.toContain('et, si son effort est xhigh,')
})

test('Hors auto, rien ne part, et la demande de « ⇉ en parallèle » est celle d’avant', { timeoutMs: 40000 }, async ($, on) => {
  const { ...w } = await implementing($, on, LOT, { isAuto: false })
  expect(w.texts).toEqual([])
  // Le contrôle positif : le bouton remplit bien la demande, sans rien du mode auto.
  await press($, 'next-parallel-linked')
  const filled = w.filled.at(-1)!
  expect(filled).toContain('Confie chacun de ces groupes à sa session liée, en parallèle')
  expect(filled).toContain('et, si son effort est xhigh,')
  expect(filled).toContain('pose-moi une question à boutons « xhigh (Recommandé) / high »')
  expect(filled).not.toContain('quel que soit son effort')
  expect(filled).not.toContain('mode auto')
})

test('Un groupe bloqué par une question reste de côté ; les autres partent', { timeoutMs: 40000 }, async ($, on) => {
  const { ...w } = await implementing($, on, LOT, { questions: [{ id: 'qa', group: 'A', text: 'Quel format ?' }] })
  expect(w.texts.length).toBe(1)
  expect(w.texts[0]!.text).toContain('Groupe B (App)')
  expect(w.texts[0]!.text).not.toContain('Groupe A (Worker)')
  expect(groupOf(w, 'A').linked).toBeUndefined()
})

test('Au retour d’un groupe sans revue, la revue du groupe part une fois ; puis la revue de sécurité conseillée, une fois', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on)
  expect(w.texts.length).toBe(1)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }], returned: ['A'] } as any)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(2)
  expect(w.texts[1]!.text).toContain('Fais faire la revue du groupe A (Worker)')
  await turnEnd($, clock)
  expect(w.texts.length).toBe(2)
  await $.tool.call({ tool: TOOL, reviewed: ['A'], security: { group: 'A', advised: true, why: 'un chemin construit' } } as any)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(3)
  expect(w.texts[2]!.text).toContain('Lance la revue de sécurité du groupe A (Worker)')
  await turnEnd($, clock)
  expect(w.texts.length).toBe(3)
})

test('Un groupe rendu avec des tickets ouverts repart une fois ; au troisième envoi qu’il faudrait, une question le bloque et l’auto se met en pause', { timeoutMs: 40000 }, async ($, on) => {
  const lot = { tickets: LOT.tickets.slice(0, 2), groups: LOT.groups.slice(0, 2) }
  const { clock, ...w } = await implementing($, on, lot)
  expect(w.texts.length).toBe(1)
  // B fini et clos ; A revient sans avoir fini.
  await $.tool.call({ tool: TOOL, set: [{ id: 'b1', status: 'done' }], returned: ['B'], reviewed: ['B'], security: { group: 'B', advised: false, why: 'rien' } } as any)
  await $.tool.call({ tool: TOOL, returned: ['A'] } as any)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(2)
  expect(w.texts[1]!.text).toContain('Groupe A (Worker)')
  expect(w.texts[1]!.text).toContain('Le groupe A repart après un envoi revenu avec des tickets ouverts')
  // Il revient encore sans avoir fini : pas de troisième envoi, une question, et la pause.
  await $.tool.call({ tool: TOOL, returned: ['A'] } as any)
  await turnEnd($, clock)
  expect(w.texts.length).toBe(2)
  const run = w.stored()!.runs[0]!
  expect(run.waiting).toEqual([expect.objectContaining({ id: 'relance:A#3', blocks: { kind: 'group', id: 'A' } })])
  expect(run.auto).toMatchObject({ offWhy: 'deuxième échec du groupe A' })
  expect(w.notices).toContain('Parcours Boutique : auto en pause (deuxième échec du groupe A)')
  // Relancé par la personne (« ↗ Session liée »), comme la question le propose : elle a sa réponse.
  await press($, 'launch-linked-A')
  await settle(clock, 1)
  expect((w.stored()!.runs[0]!.waiting ?? []).map(q => q.id)).not.toContain('relance:A#3')
  expect(groupOf(w, 'A').linked).toBeDefined()
})

test('Une question sur la phase des tickets retient la vague : rien ne part tant qu’elle attend', { timeoutMs: 40000 }, async ($, on) => {
  const { ...w } = await implementing($, on, LOT, { questions: [{ id: 'qt', phase: 'to-tickets', text: 'Invariant du ticket a1 ?' }] })
  expect(w.texts).toEqual([])
  expect(w.stored()!.runs[0]!.groups!.every(g => g.linked === undefined)).toBe(true)
})

test('Une vague restée sans suite : « ↻ Renvoyer » rend ses groupes à lancer, et la vague repart une fois', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, ...w } = await implementing($, on, LOT, { refusals: 1 })
  await settle(clock, 1)
  expect(w.texts.length).toBe(1)
  const key = 'groups:A#1+B#1'
  expect(w.stored()!.runs[0]!.waiting).toEqual([expect.objectContaining({ id: `sans-suite:${key}` })])
  await press($, `auto-resend-${key}`)
  await settle(clock, 2)
  expect(w.texts.length).toBe(2)
  expect(w.texts[1]!.text).toContain('Groupe A (Worker)')
  expect(groupOf(w, 'A').linked).toBeDefined()
  await turnEnd($, clock)
  expect(w.texts.length).toBe(2)
})

test('Dans un parcours en auto, « ↗ Session liée » remplit la demande du mode auto', { timeoutMs: 40000 }, async ($, on) => {
  const { ...w } = await implementing($, on, LOT, { questions: [{ id: 'qa', group: 'A', text: 'Quel format ?' }] })
  await press($, 'launch-linked-A')
  const filled = w.filled.at(-1)!
  expect(filled).toContain('Confie ce groupe à une session liée')
  expect(filled).toContain('quel que soit son effort')
  expect(filled).not.toContain('pose-moi une question à boutons « xhigh (Recommandé) / high »')
})

test('Un groupe bloqué qui tenait seul la place : un autre groupe prêt part à sa place', { timeoutMs: 40000 }, async ($, on) => {
  // A et C partagent un fichier : un seul des deux part ; A est bloqué, C part.
  const lot = { tickets: [LOT.tickets[0]!, LOT.tickets[2]!], groups: [LOT.groups[0]!, LOT.groups[2]!] }
  const { ...w } = await implementing($, on, lot, { questions: [{ id: 'qa', group: 'A', text: 'Quel format ?' }] })
  expect(w.texts.length).toBe(1)
  expect(w.texts[0]!.text).toContain('Groupe C (Worker bis)')
  expect(w.texts[0]!.text).not.toContain('Groupe A (Worker)')
})

test('Tous les groupes rendus, relus et clos : l’auto lance le compte rendu, une fois', { timeoutMs: 40000 }, async ($, on) => {
  const lot = { tickets: LOT.tickets.slice(0, 2), groups: LOT.groups.slice(0, 2) }
  const { clock, ...w } = await implementing($, on, lot)
  expect(w.texts.length).toBe(1)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }, { id: 'b1', status: 'done' }], returned: ['A', 'B'], reviewed: ['A', 'B'], security: { group: 'A', advised: false, why: 'rien' } } as any)
  await $.tool.call({ tool: TOOL, security: { group: 'B', advised: false, why: 'rien' } } as any)
  await turnEnd($, clock)
  expect(w.commands).toEqual(['flow-board:compte-rendu'])
  await turnEnd($, clock)
  expect(w.commands).toEqual(['flow-board:compte-rendu'])
})

test('Un groupe fini ici, sans session liée, a sa revue par /code-review, une fois', { timeoutMs: 40000 }, async ($, on) => {
  const lot = { tickets: LOT.tickets.slice(0, 2), groups: LOT.groups.slice(0, 2) }
  const { clock, ...w } = await implementing($, on, lot, { isAuto: false })
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }, { id: 'b1', status: 'done' }] } as any)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  expect(w.commands).toEqual(['code-review'])
  await turnEnd($, clock)
  expect(w.commands).toEqual(['code-review'])
})
