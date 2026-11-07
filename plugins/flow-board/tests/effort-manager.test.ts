import { expect, mock, test } from 'claude-code/testing'

import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'

import { COO_EFFORT, codeModuleOf, effortSent, groupEffortLevel, leadEffort, leadEffortPill, managerWorkEffort } from '../hooks/effort.ts'
import { memoryDisk } from './disque-memoire.ts'
import { newRun } from '../hooks/model.ts'
import type { Run, Ticket } from '../types'

// L'effort d'un manager qui fait lui-même le travail d'un worker : la règle de ce worker, par la même
// fonction ; rien hors de ce travail.

const NOW = 300_000_000
const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({ id, name: `T${id}`, status: 'todo', sensitive: false, files: ['plugins/flow-board/hooks/model.ts'], ...over })
const lot = (entry: string, tickets: Ticket[], groups: Run['groups'] = []): Run => ({ ...newRun(entry, NOW, 'Lot'), status: 'active', tickets, groups }) as Run

test('la règle d’un worker de groupe au lancement : medium par défaut, high pour des choix de conception ou plusieurs modules de code', () => {
  expect(groupEffortLevel({ hasDesignChoices: false, isMultiModule: false })).toBe('medium')
  expect(groupEffortLevel({ hasDesignChoices: true, isMultiModule: false })).toBe('high')
  expect(groupEffortLevel({ hasDesignChoices: false, isMultiModule: true })).toBe('high')
})

test('« plusieurs modules de code » : la documentation et travail/ ne comptent pas, un module est un dossier de premier niveau ou un paquet, la racine en est un', () => {
  const files = (...paths: string[]) => managerWorkEffort(lot('implement', [ticket('1', { files: paths })]))?.level
  expect(files('plugins/flow-board/hooks/model.ts', 'plugins/flow-board/README.md', 'travail/x/issues/01.md')).toBe('medium')
  expect(files('plugins/flow-board/hooks/model.ts', 'plugins/stats-board/hooks/register.tsx')).toBe('high')
  expect(files('scripts/check.py', 'scripts/hooks/refuse-cd.py')).toBe('medium')
  expect(files('scripts/check.py', '.claude/settings.json')).toBe('high')
  expect(files('package.json', 'scripts/check.py')).toBe('high')
  expect(files('docs/check-sh.md', 'config/rules/flow-board.md', 'scripts/check.py')).toBe('medium')
  expect(codeModuleOf('package.json')).toBe('racine')
  expect(codeModuleOf('./src/app.ts')).toBe('src')
  expect(codeModuleOf('packages/ui/src/x.ts')).toBe('packages/ui')
  expect(codeModuleOf('docs/sonde.py')).toBeNull()
  expect(codeModuleOf('NOTES.TXT')).toBeNull()
  // Un dossier, que les `files` d'un ticket permettent, compte pour le module qu'il désigne.
  expect(codeModuleOf('scripts/')).toBe('scripts')
  expect(codeModuleOf('plugins/new-plugin/')).toBe('plugins/new-plugin')
  expect(codeModuleOf('plugins/flow-board')).toBe('plugins/flow-board')
  expect(files('scripts/', 'scripts/check.py')).toBe('medium')
  expect(files('plugins/new-plugin/', 'plugins/new-plugin/hooks/x.ts')).toBe('medium')
  expect(files('plugins/flow-board/', 'plugins/stats-board/')).toBe('high')
})

test('un lot sans groupes prend la règle d’un worker de groupe ; un diagnostic, celle d’un worker de diagnostic', () => {
  expect(managerWorkEffort(lot('implement', [ticket('1'), ticket('2')]))).toEqual({ level: 'medium', rule: 'group' })
  // Un ticket sensible ne compte que pendant qu'il est en cours (« doing »).
  expect(managerWorkEffort(lot('implement', [ticket('1'), ticket('2', { sensitive: true })]))).toEqual({ level: 'medium', rule: 'group' })
  expect(managerWorkEffort(lot('implement', [ticket('1'), ticket('2', { sensitive: true, status: 'doing' })]))).toEqual({ level: 'high', rule: 'group' })
  expect(managerWorkEffort(lot('implement', [ticket('1', { status: 'doing' }), ticket('2', { sensitive: true })]))).toEqual({ level: 'medium', rule: 'group' })
  // Un ticket muet sur sa sensibilité, en cours, compte comme sensible.
  expect(managerWorkEffort(lot('implement', [ticket('1', { sensitive: undefined })]))).toEqual({ level: 'medium', rule: 'group' })
  expect(managerWorkEffort(lot('implement', [ticket('1', { sensitive: undefined, status: 'doing' })]))).toEqual({ level: 'high', rule: 'group' })
  expect(managerWorkEffort(lot('implement', [ticket('1'), ticket('2', { files: ['plugins/stats-board/hooks/register.tsx'] })]))).toEqual({ level: 'high', rule: 'group' })
  // Un ticket fait ne compte plus.
  expect(managerWorkEffort(lot('implement', [ticket('1'), ticket('2', { status: 'done', sensitive: true })]))).toEqual({ level: 'medium', rule: 'group' })
  expect(managerWorkEffort(lot('tdd', []))).toEqual({ level: 'medium', rule: 'group' })
  expect(managerWorkEffort(lot('diagnosing-bugs', []))).toEqual({ level: 'high', rule: 'diagnosis' })
})

test('hors du travail d’un worker, rien : une mission à groupes, une phase de cadrage, une mission en pause', () => {
  expect(managerWorkEffort(lot('implement', [ticket('1')], [{ id: 'A', name: 'A', tickets: ['1'] }] as Run['groups']))).toBeNull()
  expect(managerWorkEffort(lot('grill-with-docs', []))).toBeNull()
  expect(managerWorkEffort({ ...lot('implement', [ticket('1')]), status: 'paused' })).toBeNull()
})

// ─── Le mod ───────────────────────────────────────────────────────────────

const TOOL = 'mcp__flow-board__flow'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

/** Le moteur sous le plugin, et l'effort de chaque requête telle qu'elle part (fil principal ou spécialiste). */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const sent: { agentId?: string; effort?: string }[] = []
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-M' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  const answer = stoppedStep(stepUsage('claude-opus-5-5'))
  on('turn.step', async function* ($: unknown, e: any) {
    sent.push({ agentId: e.agentId, effort: e.effort })
    return yield* answer($, e)
  })
  return { mem, sent }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/** Un lot sans groupes : la mission démarre à /implement, avec ses tickets. */
const openLot = async ($: any, tickets: Ticket[]) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets } as any)
}

test('un manager qui fait lui-même un lot : chaque requête du fil principal part à l’effort de la règle des workers, et le bandeau le dit', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openLot($, [ticket('1'), ticket('2')])
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  // Un spécialiste garde l'effort que lui donne son lanceur.
  await playStep($, { model: 'claude-opus-5-5', effort: 'high', agentId: 'a1' })
  expect(w.sent).toEqual([{ agentId: undefined, effort: 'medium' }, { agentId: 'a1', effort: 'high' }])
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'flow-board', surface, ...BAND })
    const texts = (await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '').replace(/\u00a0/g, ' '))
    expect(texts).toContain('effort du lot : medium, règle des workers')
    await band.unmount()
  }
})

test('un lot part en high pendant un ticket sensible en cours, et à l’effort calculé avant lui ; jamais en xhigh, même quand la discussion y est', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openLot($, [ticket('1', { sensitive: true })])
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  // Le manager passe le ticket « en cours » par l'outil, comme un worker.
  await $.tool.call({ tool: TOOL, set: [{ id: '1', status: 'doing' }] } as any)
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'max' })
  expect(w.sent.map(s => s.effort)).toEqual(['medium', 'high', 'high'])
})

test('hors du travail d’un worker : sans mission, l’effort part tel quel ; un manager en cadrage part en high au moins, un effort plus haut reste', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(w.sent.map(s => s.effort)).toEqual(['medium', 'xhigh', 'high'])
})

test('après le lot, l’effort suit la phase : le compte rendu d’une mission partie en medium part en high', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await openLot($, [ticket('1')])
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  await $.tool.call({ tool: TOOL, set: [{ id: '1', status: 'done' }], step: 'review' } as any)
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(w.sent.map(s => s.effort)).toEqual(['medium', 'high'])
})

test('un lot dont tous les tickets sont faits n’est plus le travail d’un worker ; un détour de diagnostic compte d’abord', () => {
  expect(managerWorkEffort(lot('implement', [ticket('1', { status: 'done' })]))).toBeNull()
  const detoured = lot('implement', [ticket('1')])
  const phase = detoured.phases[detoured.cursor]!
  phase.detours = [{ skill: 'diagnosing-bugs', status: 'active', steps: [] } as any]
  expect(managerWorkEffort(detoured)).toEqual({ level: 'high', rule: 'diagnosis' })
})

test('un diagnostic : high au moins, sans jamais baisser un effort plus haut (la deuxième tentative en xhigh d’un worker de diagnostic)', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  expect(w.sent.map(s => s.effort)).toEqual(['high', 'xhigh'])
})

// ─── L'effort selon le rôle et la phase : COO, suivi des groupes, cadrage, compte rendu, rétrospective ───

/** Les textes du bandeau de la discussion, au terminal et sur l'ordinateur, espaces insécables remplacées. */
const bandTexts = async ($: any): Promise<string[][]> => {
  const out: string[][] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'flow-board', surface, ...BAND })
    out.push((await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '').replace(/ /g, ' ')))
    await band.unmount()
  }
  return out
}

const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}

test('la discussion qui tient le siège du COO : medium à chaque requête, high et low ramenés, xhigh et max laissés ; un spécialiste n’est pas touché', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  memoryDisk(on)
  const w = world(on)
  await start($)
  const loading = $.skill.prompt({ skill: 'flow-board:coo', text: 'consignes du COO' })
  await settle(clock, 4)
  await loading
  for (const effort of ['xhigh', 'max', 'low', 'medium', 'high']) await playStep($, { model: 'claude-opus-5-5', effort })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high', agentId: 'a1' })
  expect(w.sent.map(s => s.effort)).toEqual(['xhigh', 'max', 'medium', 'medium', 'medium', 'high'])

  for (const texts of await bandTexts($)) expect(texts).toContain('effort : medium, règle du COO')
})

test('le manager d’une mission à groupes : high au moins pendant le découpage, medium de sa fin au compte rendu (xhigh et max laissés), high au compte rendu', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : high, cadrage')
  // Un effort déjà à high : la règle ne change rien, le bandeau se tait.
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  for (const texts of await bandTexts($)) expect(texts.some(t => t.startsWith('effort'))).toBe(false)
  await $.tool.call({
    tool: TOOL,
    tickets: [ticket('1'), ticket('2', { files: ['plugins/stats-board/hooks/register.tsx'] })],
    groups: [{ id: 'A', name: 'Un', tickets: ['1'] }, { id: 'B', name: 'Deux', tickets: ['2'] }],
    complete: true,
  } as any)
  // Fin du découpage, sans compaction (le mod ne lit aucun état de compaction) : le suivi des groupes commence.
  for (const effort of ['xhigh', 'max']) await playStep($, { model: 'claude-opus-5-5', effort })
  // max laissé : le bandeau ne dit pas un medium qui ne part pas.
  for (const texts of await bandTexts($)) expect(texts.some(t => t.startsWith('effort'))).toBe(false)
  for (const effort of ['high', 'low']) await playStep($, { model: 'claude-opus-5-5', effort })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : medium, suivi des groupes')
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  // Un spécialiste garde l'effort de son lanceur.
  await playStep($, { model: 'claude-opus-5-5', effort: 'high', agentId: 'a1' })
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : high, compte rendu')
  expect(w.sent.map(s => s.effort)).toEqual(['high', 'high', 'xhigh', 'max', 'medium', 'medium', 'medium', 'high', 'high'])
})

test('une rétrospective et une phase hors liste (recherche), rejouées : high au moins, un effort plus haut laissé', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:research', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'low' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : high, règle du manager')
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : high, rétrospective')
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  expect(w.sent.map(s => s.effort)).toEqual(['high', 'high', 'xhigh'])
})

// L'effort d'un worker (sans ticket en cours : celui de son lancement ; high au moins pendant un ticket
// sensible) : tests/effort-worker.test.ts, dont le faux moteur répond aux lectures de son relais.

test('un cadrage pendant le suivi des groupes (un détour /grilling, un découpage relancé) part en high au moins', () => {
  const groups = [{ id: 'A', name: 'A', tickets: ['1'] }, { id: 'B', name: 'B', tickets: ['2'] }] as Run['groups']
  const run = lot('to-tickets', [ticket('1'), ticket('2')], groups)
  const cut = run.phases[run.cursor]!
  cut.status = 'done'
  cut.finishedAt = NOW
  expect(leadEffort(run)).toEqual({ level: 'medium', rule: 'groups', how: 'medium' })
  cut.detours = [{ skill: 'grilling', status: 'active', steps: [] } as any]
  expect(leadEffort(run)).toEqual({ level: 'high', rule: 'framing', how: 'floor' })
  cut.detours = []
  cut.status = 'active'
  expect(leadEffort(run)).toEqual({ level: 'high', rule: 'framing', how: 'floor' })
})

test('un effort numérique (un budget) : un lot impose son niveau, une autre règle le laisse', () => {
  expect(effortSent({ level: 'medium', rule: 'group', how: 'exact' }, 32000)).toBe('medium')
  expect(effortSent({ level: 'high', rule: 'framing', how: 'floor' }, 32000)).toBe(32000)
  expect(effortSent(COO_EFFORT, 32000)).toBe(32000)
  // Le registre relève l'effort en texte : un budget laissé tel quel ne fait rien dire au bandeau.
  expect(leadEffortPill(COO_EFFORT, '32000')).toBeNull()
  expect(leadEffortPill({ level: 'high', rule: 'framing', how: 'floor' }, '32000')).toBeNull()
})

test('une rétrospective et une phase hors liste (recherche) : high au moins, avec leur raison', () => {
  const retro = lot('retro', [])
  expect(leadEffort(retro)).toEqual({ level: 'high', rule: 'retro', how: 'floor' })
  expect(leadEffortPill(leadEffort(retro)!, 'medium')).toBe('effort : high, rétrospective')
  expect(leadEffortPill(leadEffort(retro)!, 'high')).toBeNull()
  expect(leadEffortPill(leadEffort(retro)!, undefined)).toBeNull()
  const research = lot('research', [])
  expect(leadEffort(research)).toEqual({ level: 'high', rule: 'other', how: 'floor' })
  expect(leadEffortPill(leadEffort(research)!, 'low')).toBe('effort : high, règle du manager')
  // Medium imposé ne se dit que quand il change l'effort relevé.
  expect(leadEffortPill(COO_EFFORT, 'high')).toBe('effort : medium, règle du COO')
  expect(leadEffortPill(COO_EFFORT, 'medium')).toBeNull()
  expect(leadEffortPill(COO_EFFORT, 'max')).toBeNull()
  expect(leadEffortPill(COO_EFFORT, undefined)).toBeNull()
  expect(effortSent(leadEffort(research)!, 'low')).toBe('high')
  expect(effortSent(leadEffort(research)!, 'xhigh')).toBe('xhigh')
  // Une mission à groupes encore au découpage reste en cadrage ; sans mission, rien.
  expect(leadEffort(lot('to-tickets', [ticket('1')], [{ id: 'A', name: 'A', tickets: ['1'] }, { id: 'B', name: 'B', tickets: [] }] as Run['groups']))?.rule).toBe('framing')
  expect(leadEffort(null)).toBeNull()
  expect(leadEffort({ ...research, status: 'paused' })).toBeNull()
})

test('un lot sans groupes et un diagnostic gardent la règle des workers', () => {
  expect(leadEffort(lot('implement', [ticket('1')]))).toEqual({ level: 'medium', rule: 'group', how: 'exact' })
  expect(leadEffort(lot('diagnosing-bugs', []))).toEqual({ level: 'high', rule: 'diagnosis', how: 'floor' })
  expect(effortSent({ level: 'medium', rule: 'group', how: 'exact' }, 'xhigh')).toBe('medium')
})
