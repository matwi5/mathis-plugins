import { expect, mock, test } from 'claude-code/testing'
import { memoryDisk } from './disque-memoire.ts'

import { applyReport, applySkill, emptyBoard, newRun, renameRun, startLinkedGroups } from '../hooks/model.ts'
import { cancelLinkedGroup, linkSession } from '../hooks/link.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board, Run } from '../types'
import { withItemsLink } from './lien-pistes.ts'

// Titre réfléchi et renommage de la discussion (spec « Titres », série 1 Q13 à Q15, série 2 Q6 à Q8).

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const NAME = (title: string) => `name this discussion "${title}"`
const KEEPS = 'this discussion keeps its name'

const empty = (session = 's'): Board => ({ ...emptyBoard('', 'p'), session, deleted: [], runs: [], activeId: null })
const opened = (board: Board, skill = 'mattpocock-skills:to-spec', args = '# CONTEXTE Modifications à apporter à flow board, voici mon long prompt') =>
  applySkill(board, skill, { now: 1_000, isMain: true, args })!.board
const runOf = (board: Board) => activeRun(board)!

test('une mission ouverte par un skill ne prend pas son titre dans les arguments ; il naît dans cette discussion', () => {
  const run = runOf(opened(empty()))
  expect(run.title).not.toMatch(/CONTEXTE/)
  expect(run.isTitled).toBe(false)
  expect(run.bornIn).toBe('s')
})

test('au premier titre, la discussion prend le même nom ; le titre attend le moteur, hors du board', () => {
  const out = applyReport(opened(empty()), { title: 'Frise, groupes et titres' }, 2_000)
  expect(runOf(out.board).title).toBe('Frise, groupes et titres')
  expect(out.text).toContain(NAME('Frise, groupes et titres'))
  expect(out.fx.discussionTitle).toBe('Frise, groupes et titres')
  // Rien sur la mission partagée : une autre discussion ne peut pas ramener le titre (série 5, Q2).
  expect(JSON.stringify(out.board)).not.toContain('titleToSend')
  // Le titre suivant ne change rien : seul le premier compte.
  const again = applyReport(out.board, { title: 'Autre' }, 3_000)
  expect(again.text).not.toContain('name this discussion')
  expect(again.text).not.toContain(KEEPS)
})

test('une autre mission déjà né ici, même fini ou archivé : seul la nouvelle mission reçoit son titre', () => {
  for (const status of ['paused', 'done'] as const) {
    let board = opened(empty())
    board = applyReport(board, { title: 'Premier' }, 2_000).board
    board = { ...board, runs: board.runs.map(r => ({ ...r, status, owner: undefined, ...(status === 'done' ? { archivedAt: 2_500 } : {}) })), activeId: null }
    const out = applyReport(board, { open: { title: 'Second' } }, 3_000)
    expect(runOf(out.board).title).toBe('Second')
    expect(out.text).toContain(KEEPS)
    expect(out.fx.discussionTitle).toBeUndefined()
  }
})

test('une mission supprimée, ou d’avant ce changement (sans discussion de naissance), ne bloque pas le renommage', () => {
  const old: Run = { ...newRun('implement', 500, 'Ancien'), status: 'paused' }
  expect(old.bornIn).toBeUndefined()
  const board = opened({ ...empty(), runs: [old] })
  expect(applyReport(board, { title: 'Nouveau' }, 2_000).text).toContain(NAME('Nouveau'))
})

test('une mission né dans une autre discussion ne la renomme pas', () => {
  let board = opened(empty('ailleurs'))
  // Repris ici : la discussion de naissance ne change pas.
  board = { ...board, session: 's', runs: board.runs.map(r => ({ ...r, owner: 's' })) }
  const out = applyReport(board, { title: 'Repris' }, 2_000)
  expect(out.text).toContain(KEEPS)
  expect(runOf(out.board).bornIn).toBe('ailleurs')
})

test('open et un lot de tickets sans skill prennent le title de Claude, et nomment la discussion', () => {
  const open = applyReport(empty(), { open: { title: 'Requêtes PowerBI' } }, 2_000)
  expect(runOf(open.board)).toMatchObject({ title: 'Requêtes PowerBI', bornIn: 's' })
  expect(open.fx.discussionTitle).toBe('Requêtes PowerBI')
  expect(open.text).toContain(NAME('Requêtes PowerBI'))
  const lot = applyReport(empty(), { title: 'Lot de tickets', tickets: [{ id: 't1', name: 'Un' }] }, 2_000)
  expect(runOf(lot.board)).toMatchObject({ title: 'Lot de tickets', bornIn: 's' })
  expect(lot.text).toContain(NAME('Lot de tickets'))
})

test('une suite garde « <libellé> · <titre du parent> » et ne renomme pas la discussion', () => {
  const board = applyReport(opened(empty()), { title: 'Export CSV' }, 2_000).board
  const out = applySkill(board, 'mattpocock-skills:retro', { now: 3_000, isMain: true, args: 'rétro' })!
  expect(runOf(out.board)).toMatchObject({ title: 'Rétrospective · Export CSV', isTitled: true, bornIn: 's' })
  expect(out.fx.discussionTitle).toBeUndefined()
})

test('fix.title et /flow rename renomment la discussion avant un worker, pas après', () => {
  const groups = { tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }], groups: [{ id: 'A', name: 'Un', tickets: ['a1'] }, { id: 'B', name: 'Deux', tickets: ['b1'] }] }
  let board = applyReport(opened(empty(), 'mattpocock-skills:implement'), { title: 'Lot', ...groups }, 2_000).board
  const fixed = applyReport(board, { fix: { title: 'Lot corrigé' } }, 3_000)
  expect(fixed.text).toContain(NAME('Lot corrigé'))
  expect(fixed.fx.discussionTitle).toBe('Lot corrigé')
  const renamed = renameRun(fixed.board, runOf(fixed.board).id, 'Lot renommé', 3_500)!
  expect(renamed.fx.discussionTitle).toBe('Lot renommé')
  // Un worker lancé : le nom donné dans son brief ne bouge plus.
  board = startLinkedGroups(renamed.board, ['A'], 4_000)!.board
  const late = applyReport(board, { fix: { title: 'Trop tard' } }, 5_000)
  expect(runOf(late.board).title).toBe('Trop tard')
  expect(late.text).toContain(KEEPS)
  expect(late.fx.discussionTitle).toBeUndefined()
  expect(renameRun(board, runOf(board).id, 'Encore', 6_000)!.fx.discussionTitle).toBeUndefined()
})

test('un worker lancé pour des éléments bloque le renommage, même quand ils reviennent à faire', () => {
  let board = applyReport(opened(empty(), 'mattpocock-skills:retro'), { title: 'Rétro', items: [{ id: 'r1', label: 'Piste' }] }, 2_000).board
  board = withItemsLink(board, ['r1'], 3_000)
  board = linkSession(board, 'local_pistes', 3_500)!.board
  // Les éléments reviennent à faire : la phase ne suit plus la session, la mission s'en souvient.
  board = { ...board, runs: board.runs.map(r => ({ ...r, phases: r.phases.map(p => ({ ...p, linked: undefined })) })) }
  const late = applyReport(board, { fix: { title: 'Rétro corrigée' } }, 4_000)
  expect(late.text).toContain(KEEPS)
  expect(late.fx.discussionTitle).toBeUndefined()
})

test('le premier titre ne renomme pas la discussion une fois un worker demandée ; « Annuler » la libère', () => {
  const groups = { tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }], groups: [{ id: 'A', name: 'Un', tickets: ['a1'] }, { id: 'B', name: 'Deux', tickets: ['b1'] }] }
  let board = applyReport(opened(empty(), 'mattpocock-skills:implement'), groups, 2_000).board
  board = startLinkedGroups(board, ['A'], 3_000)!.board
  // Le brief, déjà dans le prompt, nomme la discussion : le titre arrivé ensuite ne la renomme pas.
  const late = applyReport(board, { title: 'Lot' }, 4_000)
  expect(late.text).toContain(KEEPS)
  expect(late.fx.discussionTitle).toBeUndefined()
  // La demande annulée sans session lancée : plus rien ne nomme la discussion.
  const cancelled = cancelLinkedGroup(late.board, 'A', 5_000)!.board
  const renamed = renameRun(cancelled, runOf(cancelled).id, 'Lot renommé', 6_000)!
  expect(renamed.fx.discussionTitle).toBe('Lot renommé')
})

test('un worker (delegate) ne prend jamais de titre', () => {
  const linked: Board = { ...opened(empty()), delegate: { run: 'ailleurs', at: 1_500 } }
  // L'outil y refuse tout ; la règle elle-même refuse aussi.
  const out = applyReport({ ...linked, delegate: undefined }, { title: 'Témoin' }, 2_000)
  expect(out.text).toContain(NAME('Témoin'))
  const run = { ...runOf(opened(empty())) }
  const fromLinked = renameRun({ ...linked, runs: [run], activeId: run.id }, run.id, 'Worker', 3_000)!
  expect(fromLinked.fx.discussionTitle).toBeUndefined()
})

// ─── Par le faux moteur ───────────────────────────────────────────────────

const world = (on: any) => {
  on('session.id', () => ({ value: 's-titre' }))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.SessionStart', () => ({}))
}
const prompt = ($: any, session_title?: string) =>
  $.classic.UserPromptSubmit({ session_id: 's-titre', transcript_path: '/t/s-titre.jsonl', cwd: '/p', hook_event_name: 'UserPromptSubmit', prompt: 'x', ...(session_title ? { session_title } : {}) })

test('la consigne « First call » demande un titre réfléchi, sans recopier le message, et le renommage par l’outil de l’app', async ($, on) => {
  mock.clock(on, { now: 100_000_000 })
  memoryDisk(on)
  mock.store(on)
  world(on)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })).text
  expect(note).toContain('- First call: {"title": "<a short title you choose that sums up the whole work, 3 to 6 words, in the user\'s language; never their message itself>"}.')
  expect(note).toContain('If you have a tool that renames this discussion (in the app: set_session_title), call it right away with the same title, unless the answer says this discussion keeps its name.')
})

test('le titre part une fois dans sessionTitle, au prochain message', async ($, on) => {
  mock.clock(on, { now: 101_000_000 })
  memoryDisk(on)
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  expect(String((await $.tool.call({ tool: TOOL, title: 'Export CSV' } as any)).result)).toContain(NAME('Export CSV'))
  expect(await prompt($, 'Session tools start')).toMatchObject({ sessionTitle: 'Export CSV' })
  expect((await prompt($, 'Export CSV')).sessionTitle).toBeUndefined()
})

test('pas de sessionTitle quand la discussion porte déjà le bon titre (renommée par l’outil de l’app)', async ($, on) => {
  mock.clock(on, { now: 102_000_000 })
  memoryDisk(on)
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Export CSV' } as any)
  expect((await prompt($, 'Export CSV')).sessionTitle).toBeUndefined()
  // Effacé : il ne repart pas, même si le titre change ensuite.
  expect((await prompt($, 'Autre')).sessionTitle).toBeUndefined()
})

test('pas de sessionTitle quand une autre mission est né ici', async ($, on) => {
  mock.clock(on, { now: 103_000_000 })
  memoryDisk(on)
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Premier' } as any)
  await prompt($, 'Premier')
  await $.tool.call({ tool: TOOL, open: { title: 'Second' } } as any)
  expect((await prompt($, 'Premier')).sessionTitle).toBeUndefined()
})

test('une reprise par SessionStart envoie un titre qui attend encore', async ($, on) => {
  mock.clock(on, { now: 104_000_000 })
  memoryDisk(on)
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Export CSV' } as any)
  const start = await ($ as any).classic.SessionStart({ session_id: 's-titre', transcript_path: '/t/s-titre.jsonl', cwd: '/p', hook_event_name: 'SessionStart', source: 'resume', session_title: 'Ancien' })
  expect(start).toMatchObject({ sessionTitle: 'Export CSV' })
  expect((await prompt($, 'Ancien')).sessionTitle).toBeUndefined()
})

test('dans un worker, aucun sessionTitle, même si elle a la mission du manager', async ($, on) => {
  mock.clock(on, { now: 104_500_000 })
  memoryDisk(on)
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  const runId = String((await $.tool.call({ tool: TOOL, title: 'Principal' } as any)).result)
  expect(runId).toContain(NAME('Principal'))
  // La discussion devient le worker d'une autre mission avant son prochain message : rien ne part plus ici.
  await $.tool.call({ tool: TOOL, delegate: 'autre-parcours' } as any)
  expect((await prompt($, 'Avant')).sessionTitle).toBe('Principal')
  await $.tool.call({ tool: TOOL, fix: { title: 'Corrigé' } } as any)
  expect((await prompt($, 'Avant')).sessionTitle).toBeUndefined()
})

test('les consignes ne demandent plus de renommer la discussion à la main', async ($, on) => {
  mock.clock(on, { now: 105_000_000 })
  memoryDisk(on)
  mock.store(on)
  world(on)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot', tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }], groups: [{ id: 'A', name: 'Un', tickets: ['a1'] }, { id: 'B', name: 'Deux', tickets: ['b1'] }] } as any)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })).text
  expect(note).not.toMatch(/rename this discussion/)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'flow-board', props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} } })
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  expect(filled.at(-1)).toMatch(/^Confie ce groupe à un worker/)
  expect(filled.at(-1)).not.toMatch(/renommer cette discussion/)
})

// ─── Renommer dès la fin du tour de naissance (décision de Mathis du 02/11/2026) ───

/** Le moteur du renommage : les outils de la session, `/rename` (accepté ou refusé) et la fin d'un tour. */
const renameWorld = (on: any, o: { tools?: string[]; isRefused?: boolean; source?: string } = {}) => {
  world(on)
  const renamed: string[] = []
  on('tool.list', () => ({ value: (o.tools ?? []).map(name => ({ name, description: '' })) }))
  on('command.list', () => ({ value: [{ name: 'rename', description: 'Rename the current conversation', source: o.source ?? 'builtin' }] }))
  on('command.run', { command: 'rename' }, (_$: unknown, e: { args: string }) => {
    if (o.isRefused) throw new Error('unknown command')
    renamed.push(e.args)
    return { text: `Session renamed to: ${e.args}` }
  })
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  return renamed
}
const endTurn = async ($: any, clock: { advance: (ms: number) => Promise<void> }) => {
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  for (let i = 0; i < 2; i++) await clock.advance(1000)
}

test('dans le CLI, la discussion prend le titre dès la fin du tour où la mission naît, par /rename ; le message suivant ne le renvoie pas', async ($, on) => {
  const clock = mock.clock(on, { now: 110_000_000 })
  memoryDisk(on)
  mock.store(on)
  const renamed = renameWorld(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Écarts flow-board sur session app' } as any)
  await endTurn($, clock)
  expect(renamed).toEqual(['Écarts flow-board sur session app'])
  expect((await prompt($, 'Écarts flow-board sur session app')).sessionTitle).toBeUndefined()
  // Une seule fois : la fin de tour suivante ne renomme plus.
  await endTurn($, clock)
  expect(renamed.length).toBe(1)
})

test('dans l’app (Claude a set_session_title), pas de /rename : Claude renomme, et le message suivant reste le filet', async ($, on) => {
  const clock = mock.clock(on, { now: 111_000_000 })
  memoryDisk(on)
  mock.store(on)
  const renamed = renameWorld(on, { tools: ['mcp__ccd_session__set_session_title'] })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Export CSV' } as any)
  await endTurn($, clock)
  expect(renamed).toEqual([])
  expect(await prompt($, 'Session tools start')).toMatchObject({ sessionTitle: 'Export CSV' })
})

test('une commande rename qui ne vient pas de Claude Code (projet, MCP, autre plugin) n’est pas lancée : le message suivant pose le titre', async ($, on) => {
  const clock = mock.clock(on, { now: 113_000_000 })
  memoryDisk(on)
  mock.store(on)
  const renamed = renameWorld(on, { source: 'plugin' })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Export CSV' } as any)
  await endTurn($, clock)
  expect(renamed).toEqual([])
  expect(await prompt($, 'Session tools start')).toMatchObject({ sessionTitle: 'Export CSV' })
})

test('le titre passé à /rename perd ses caractères invisibles et bidirectionnels', async ($, on) => {
  const clock = mock.clock(on, { now: 114_000_000 })
  memoryDisk(on)
  mock.store(on)
  const renamed = renameWorld(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: `Export${String.fromCodePoint(0x202e)} CSV${String.fromCodePoint(0x200b)}` } as any)
  await endTurn($, clock)
  expect(renamed).toEqual(['Export CSV'])
})

test('un /rename refusé laisse le titre au message suivant', async ($, on) => {
  const clock = mock.clock(on, { now: 112_000_000 })
  memoryDisk(on)
  mock.store(on)
  renameWorld(on, { isRefused: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Export CSV' } as any)
  await endTurn($, clock)
  expect(await prompt($, 'Session tools start')).toMatchObject({ sessionTitle: 'Export CSV' })
})
