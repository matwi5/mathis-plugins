import { expect, mock, test } from 'claude-code/testing'

import { compactionInstructions, compactionRoleOf, retroTranscriptNote, suggestsCompaction, withCompactionInstructions } from '../hooks/compaction.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { emptyRegistry, lastCompactionAt, parseRegistry } from '../hooks/registry.ts'
import type { SessionRegistry } from '../types'

// ─── La compaction de la discussion : repère, consignes, proposition, rétro ──

const SESSION = 's-cmp'
const KEY = `agents:${SESSION}`

const TOOL = 'mcp__flow-board__flow'
const START = 'mcp__ccd_session__start_session'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const
const LOT = {
  tickets: [
    { id: 'a1', name: 'Code', files: ['src/a.ts'] },
    { id: 'b1', name: 'Doc', files: ['docs/b.md'] },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Doc', tickets: ['b1'] },
  ],
}

const world = (on: any, session = SESSION) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const filled: string[] = []
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: session }))
  on('session.repo', () => ({ value: { root: '/proj', remote: null, internal: false, name: null } }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('classic.UserPromptSubmit', () => ({}))
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  const shown: string[] = []
  on('prompt.suggest', (_$: unknown, e: { text: string }) => {
    shown.push(e.text)
    return { isShown: true }
  })
  const toasts: string[] = []
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('tool.call', { tool: START }, (_$: unknown, e: { title: string }) => ({
    result: { text: `Started session local_${/Groupe (\w+)/.exec(e.title)?.[1] ?? 'x'}42.` },
  }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text
    return { value: undefined } as any
  })
  return { mem, files, filled, shown, toasts }
}

const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/** Un parcours à deux groupes, tickets publiés : l'orchestrateur après `/to-tickets` (`complete` pour le finir). */
const ticketed = async ($: any, isComplete = false) => {
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique en ligne', ...LOT, ...(isComplete ? { complete: true } : {}) } as any)
}

const endTurn = ($: any, answer: string) => $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })

/** Le bouton « ⇣ Compacter d'abord » de la carte « Ensuite », s'il y est. */
const compactButton = async ($: any) => {
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  const button = await ui.find({ key: 'next-compact' })
  if (button) await ui.press({ key: 'next-compact' })
  await ui.unmount()
  return button !== undefined
}

/** Le registre enregistré de la session, sur le disque simulé ou dans `$.store`. */
const saved = (mem: Record<string, unknown>, files: Record<string, string>): SessionRegistry | null => {
  const path = Object.keys(files).find(p => p.endsWith(`/flow-board/agents/${SESSION}.json`))
  const value = path !== undefined ? files[path] : mem[KEY]
  return value === undefined ? null : parseRegistry(value)
}

/** Un message de conversation : sans `messages`, le moteur de test saute le hook de flow-board en silence. */
const MESSAGES = [{ role: 'user', text: 'x', toolUses: [] }]

/**
 * Le moteur sous le plugin : relève les consignes que flow-board lui passe et répond un résumé.
 * Un message est d'abord ajouté à la session, que la compaction résume.
 */
const summarizer = async ($: any, on: any, refuses: (e: any) => boolean = () => false) => {
  mock.session(on)
  const seen: { trigger?: string; agentId?: string; instructions?: string }[] = []
  on('session.compact', (_$: unknown, e: any) => {
    seen.push({ trigger: e.trigger, agentId: e.agentId, instructions: e.instructions })
    return refuses(e) ? { skip: 'refusée' } : { messages: [{ role: 'user', text: 'résumé', toolUses: [] }] }
  })
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: 'bonjour' }] } })
  return seen
}

const compact = ($: any, args: { trigger: string; agentId?: string; instructions?: string }) => $.session.compact({ ...args, messages: MESSAGES })

const compactMarks = (reg: SessionRegistry | null): number[] => (reg?.main?.marks ?? []).filter(m => m.k === 'compact').map(m => m.at)

// ─── Le repère ⇣, réservé aux vraies compactions de la discussion ──

test('lastCompactionAt : aucune compaction sans repère, sinon l’heure de la dernière', () => {
  expect(lastCompactionAt(null)).toBeNull()
  const reg = emptyRegistry(SESSION, '/p', 0)
  expect(lastCompactionAt(reg)).toBeNull()
  const one: SessionRegistry = { ...reg, main: { marks: [{ k: 'msg', at: 500 }, { k: 'compact', at: 1_000 }] } }
  expect(lastCompactionAt(one)).toBe(1_000)
  const two: SessionRegistry = { ...reg, main: { marks: [{ k: 'compact', at: 3_000 }, { k: 'compact', at: 1_000 }, { k: 'msg', at: 9_000 }] } }
  expect(lastCompactionAt(two)).toBe(3_000)
})

test('le repère ⇣ se pose pour une compaction tapée ou automatique de la discussion, pas pour un calcul à l’avance ni pour un sous-agent', async ($, on) => {
  const clock = mock.clock(on, { now: 60_000_000 })
  const { mem, files } = world(on)
  const seen = await summarizer($, on)
  await compact($, { trigger: 'precompute' })
  await compact($, { trigger: 'auto', agentId: 'a1' })
  await clock.advance(1_000)
  expect(compactMarks(saved(mem, files))).toEqual([])
  await compact($, { trigger: 'manual' })
  await clock.advance(1_000)
  await compact($, { trigger: 'auto' })
  await clock.advance(1_000)
  expect(compactMarks(saved(mem, files))).toEqual([60_001_000, 60_002_000])
  expect(lastCompactionAt(saved(mem, files))).toBe(60_002_000)
  // Le moteur a bien vu passer les quatre compactions.
  expect(seen.map(s => s.trigger)).toEqual(['precompute', 'auto', 'manual', 'auto'])
})

test('une compaction refusée par un hook plus bas ne pose pas de repère', async ($, on) => {
  const clock = mock.clock(on, { now: 60_500_000 })
  const { mem, files } = world(on)
  await summarizer($, on, e => e.trigger === 'manual')
  await compact($, { trigger: 'manual' })
  await clock.advance(1_000)
  expect(compactMarks(saved(mem, files))).toEqual([])
  expect(lastCompactionAt(saved(mem, files))).toBeNull()
})

// ─── Les consignes de compaction, selon le rôle de la discussion ──

test('compactionInstructions : l’orchestrateur garde des renvois, valeurs inconnues omises', () => {
  const text = compactionInstructions({
    kind: 'orchestrator',
    run: { id: 'r1', title: 'Boutique', phase: 'Implémentation' },
    groups: [
      { id: 'A', name: 'Code', done: 1, total: 2, session: 'local_a42' },
      { id: 'B', name: 'Doc', done: 0, total: 1 },
    ],
    transcript: '/h/.claude/projects/-p/s1.jsonl',
  })
  expect(text).toContain('orchestrator')
  expect(text).toContain('"Boutique" (id r1), phase Implémentation')
  expect(text).toContain('A "Code": 1/2 tickets done, linked session local_a42')
  expect(text).toContain('B "Doc": 0/1 tickets done')
  expect(text).toContain('DECISIONS.md')
  expect(text).toContain('mcp__flow-board__flow')
  expect(text).toContain('This discussion was compacted: for the retro, reread its transcript /h/.claude/projects/-p/s1.jsonl.')
  // Sans transcript ni groupe : rien d'inventé.
  const bare = compactionInstructions({ kind: 'orchestrator', run: { id: 'r1', title: 'Boutique', phase: 'Implémentation' }, groups: [] })
  expect(bare).not.toContain('Groups:')
  expect(bare).not.toContain('undefined')
  expect(bare).toContain('reread its transcript (the .jsonl file of this session under ~/.claude/projects/).')
})

test('les sessions liées des pistes d’une phase entrent aussi dans les consignes de l’orchestrateur', () => {
  const run = newRun('diagnosing-bugs', 1_000, 'Bug du panier')
  run.phases[0]!.linked = { items: ['p1'], at: 2_000, session: 'local_p1' }
  run.groups = [{ id: 'A', name: 'Code', tickets: [] }]
  const board = { ...emptyBoard('/p', 'p'), runs: [run], activeId: run.id }
  const role = compactionRoleOf(board, null)
  expect(role).toMatchObject({ kind: 'orchestrator', sessions: ['local_p1'] })
  expect(compactionInstructions(role!)).toContain('- Other linked sessions: local_p1.')
  // Sans autre session : pas de ligne.
  run.phases[0]!.linked = undefined
  expect(compactionInstructions(compactionRoleOf(board, null)!)).not.toContain('Other linked sessions')
})

test('compactionInstructions : la session de groupe garde de quoi reprendre son ticket et joindre l’orchestrateur', () => {
  const text = compactionInstructions({ kind: 'group', run: 'r1', runTitle: 'Boutique', group: 'E', main: 'Orchestrateur [e5eb08]' })
  expect(text).toContain('group E of the run "Boutique" (id r1)')
  expect(text).toContain('the current task (N of M)')
  expect(text).toContain('the branch and the worktree')
  expect(text).toContain('refs/worktree/flow-board/<ticket>')
  expect(text).toContain('commit hash of each ticket done')
  expect(text).toContain('Orchestrateur [e5eb08]')
  expect(text).toContain('DECISIONS.md')
  const bare = compactionInstructions({ kind: 'group', run: 'r1', group: 'E' })
  expect(bare).not.toContain('undefined')
  expect(bare).toContain('group E of the run r1')
})

test('withCompactionInstructions : le texte de la personne reste en tête', () => {
  expect(withCompactionInstructions(undefined, 'FB')).toBe('FB')
  expect(withCompactionInstructions('  ', 'FB')).toBe('FB')
  expect(withCompactionInstructions('garde le plan', 'FB')).toBe('garde le plan\n\nFB')
})

test('l’orchestrateur reçoit ses consignes à chaque compaction de la discussion, calcul à l’avance compris ; un sous-agent n’en reçoit pas', async ($, on) => {
  mock.clock(on, { now: 61_000_000 })
  world(on)
  const seen = await summarizer($, on)
  await ticketed($)
  await $.classic.UserPromptSubmit({ prompt: 'x', session_id: SESSION, transcript_path: '/h/.claude/projects/-proj/s-cmp.jsonl', cwd: '/proj', hook_event_name: 'UserPromptSubmit' } as any)
  await compact($, { trigger: 'manual', instructions: 'garde le plan' })
  await compact($, { trigger: 'precompute' })
  await compact($, { trigger: 'auto', agentId: 'a1', instructions: 'du sous-agent' })
  const [manual, precompute, sub] = seen
  expect(manual!.instructions!.startsWith('garde le plan\n\n')).toBe(true)
  expect(manual!.instructions).toContain('orchestrator')
  expect(manual!.instructions).toContain('"Boutique en ligne"')
  expect(manual!.instructions).toContain('A "Code": 0/1 tickets done')
  expect(manual!.instructions).toContain('reread its transcript /h/.claude/projects/-proj/s-cmp.jsonl')
  expect(precompute!.instructions).toContain('orchestrator')
  expect(sub!.instructions).toBe('du sous-agent')
})

test('une session de groupe reçoit les siennes ; une discussion sans parcours ne reçoit rien', async ($, on) => {
  mock.clock(on, { now: 62_000_000 })
  world(on, 'linked')
  const seen = await summarizer($, on)
  await start($)
  await compact($, { trigger: 'auto' })
  expect(seen[0]!.instructions).toBeUndefined()
  await $.tool.call({ tool: TOOL, delegate: 'run-1', group: 'E', main: '[e5eb08]' } as any)
  await compact($, { trigger: 'auto' })
  expect(seen[1]!.instructions).toContain('group E of the run')
  expect(seen[1]!.instructions).toContain('run-1')
  expect(seen[1]!.instructions).toContain('[e5eb08]')
})

// ─── `/compact` proposé après `/to-tickets`, dans un parcours à groupes ──

test('après /to-tickets dans un parcours à groupes, /compact se propose en gris et dans la carte « Ensuite » ; plus après une compaction', async ($, on) => {
  const clock = mock.clock(on, { now: 63_000_000 })
  const { filled, shown, toasts } = world(on)
  await summarizer($, on)
  // Tickets publiés mais phase pas finie : rien encore.
  await ticketed($)
  await endTurn($, 'Tickets publiés.')
  expect(shown).not.toContain('/compact')
  expect(await compactButton($)).toBe(false)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  await clock.advance(1_000)
  await endTurn($, 'Les tickets sont prêts.')
  expect(shown.at(-1)).toBe('/compact')
  expect(await compactButton($)).toBe(true)
  expect(filled.at(-1)).toBe('/compact ')
  expect(toasts.at(-1)).toContain('flow-board ajoute ses consignes')
  // Une question attend : rien.
  const before = shown.length
  await endTurn($, 'On lance quel groupe ?')
  expect(shown).toHaveLength(before)
  // Compactée depuis : plus de proposition.
  await compact($, { trigger: 'manual' })
  await clock.advance(1_000)
  await endTurn($, 'Compacté.')
  expect(shown.slice(before)).not.toContain('/compact')
  expect(await compactButton($)).toBe(false)
})

test('plus de proposition de /compact une fois un groupe lancé', async ($, on) => {
  const clock = mock.clock(on, { now: 64_000_000 })
  const { shown } = world(on)
  await ticketed($, true)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  await $.tool.call({ tool: START, title: 'Boutique en ligne › Groupe A · Code' } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  await endTurn($, 'Groupe A lancé.')
  expect(shown).not.toContain('/compact')
  expect(await compactButton($)).toBe(false)
})

test('les pistes d’une phase confiées à une session liée avant les tickets n’empêchent pas la proposition ; un groupe lancé, si', () => {
  const run = newRun('to-tickets', 1_000, 'Boutique')
  run.tickets = LOT.tickets.map(t => ({ ...t, status: 'todo' as const }))
  run.groups = LOT.groups.map(g => ({ ...g }))
  run.phases[0] = { ...run.phases[0]!, status: 'done', finishedAt: 2_000, linked: { items: ['p1'], at: 1_500, session: 'local_p1' } }
  run.phases[1] = { ...run.phases[1]!, status: 'active', startedAt: 2_000 }
  run.cursor = 1
  const board = { ...emptyBoard('/p', 'p'), runs: [run], activeId: run.id }
  expect(suggestsCompaction(board, null)).toBe(true)
  run.groups[0] = { ...run.groups[0]!, linked: { at: 3_000 } }
  expect(suggestsCompaction(board, null)).toBe(false)
})

test('rien n’est proposé pour un lot sans groupes ni dans une session liée', async ($, on) => {
  mock.clock(on, { now: 65_000_000 })
  const { shown } = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Petit lot', tickets: [{ id: 't1', name: 'Seul' }], complete: true } as any)
  await endTurn($, 'Prêt.')
  expect(shown).not.toContain('/compact')
  expect(await compactButton($)).toBe(false)
})

test('une session liée de groupe ne se voit pas proposer /compact', async ($, on) => {
  mock.clock(on, { now: 66_000_000 })
  const { shown } = world(on, 'linked')
  await ticketed($, true)
  await $.tool.call({ tool: TOOL, delegate: 'run-x', group: 'A', main: '[e5eb08]' } as any)
  await endTurn($, 'Ticket fait.')
  expect(shown).not.toContain('/compact')
})

// ─── La rétro relit le transcript après une compaction ──

const TRANSCRIPT = '/h/.claude/projects/-proj/s-cmp.jsonl'
const noteTranscript = ($: any) =>
  $.classic.UserPromptSubmit({ prompt: 'x', session_id: SESSION, transcript_path: TRANSCRIPT, cwd: '/proj', hook_event_name: 'UserPromptSubmit' } as any)
const retroText = async ($: any): Promise<string> => (await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'RETRO' })).text

test('/retro dans une discussion compactée porte la consigne de transcript, avec un parcours actif', async ($, on) => {
  const clock = mock.clock(on, { now: 67_000_000 })
  world(on)
  await summarizer($, on)
  await ticketed($, true)
  await noteTranscript($)
  // Pas de compaction vue ici : la consigne conditionnelle (une reprise dans un nouveau fichier n'a pas de repère).
  const before = await retroText($)
  expect(before).toContain(`grep`)
  expect(before).toContain(TRANSCRIPT)
  expect(before).not.toContain('Transcript (flow-board): this discussion was compacted')
  await compact($, { trigger: 'auto' })
  await clock.advance(1_000)
  const text = await retroText($)
  expect(text).toContain('Transcript (flow-board): this discussion was compacted')
  expect(text).not.toContain('If it does')
  expect(text.startsWith('RETRO')).toBe(true)
  expect(text).toContain(TRANSCRIPT)
  expect(text).toContain('compact_boundary')
  expect(text).toContain('read-only')
  expect(text).toContain('logicalParentUuid')
})

test('/retro sans parcours actif : la consigne de transcript, conditionnelle avant compaction', async ($, on) => {
  const clock = mock.clock(on, { now: 68_000_000 })
  world(on)
  await summarizer($, on)
  await start($)
  await noteTranscript($)
  expect(await retroText($)).toContain('If it does')
  await compact($, { trigger: 'manual' })
  await clock.advance(1_000)
  const text = await retroText($)
  expect(text).toContain(TRANSCRIPT)
  expect(text).toContain('compact_boundary')
})

test('le bouton Rétro d’un parcours à sessions liées transmet la règle du fichier d’origine à leurs lecteurs', async ($, on) => {
  const clock = mock.clock(on, { now: 69_000_000 })
  const { filled } = world(on)
  await ticketed($, true)
  let ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  await $.tool.call({ tool: START, title: 'Boutique en ligne › Groupe A · Code' } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'go-retro' })
  await ui.unmount()
  expect(filled.at(-1)).toContain('Rétro globale')
  expect(filled.at(-1)).toContain('logicalParentUuid')
})

test('retroTranscriptNote : affirmative quand la compaction est vue, sinon une vérification par grep ; la règle du fichier d’origine dans les deux', () => {
  const seen = retroTranscriptNote('/t/s.jsonl', 's', true)
  expect(seen).toContain('Transcript (flow-board): this discussion was compacted')
  expect(seen).not.toContain('grep')
  const unseen = retroTranscriptNote('/t/s.jsonl', 's', false)
  expect(unseen).toContain(`grep -c '"subtype":"compact_boundary"' "/t/s.jsonl"`)
  // Le texte du skill entre dans le transcript, échappé en JSON : il ne doit pas répondre lui-même au grep.
  for (const note of [seen, unseen]) expect(JSON.stringify(note)).not.toContain('"subtype":"compact_boundary"')
  expect(unseen).toContain('If it does')
  for (const note of [seen, unseen]) expect(note).toContain('logicalParentUuid')
  expect(retroTranscriptNote(undefined, 's1', false)).toContain('~/.claude/projects/<project folder>/s1.jsonl')
})
