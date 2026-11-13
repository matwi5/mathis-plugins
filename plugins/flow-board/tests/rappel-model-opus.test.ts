// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { isFableModelId, isFableStuck } from '../hooks/effort.ts'
import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { openCoo, start, world, writeBoard } from './monde-coordination.ts'

// Après le cadrage, un manager resté sur Fable (un `/model fable` tapé, ou Fable modèle par défaut du poste) voit
// « tape /model opus » au bandeau et dans la demande de lancement des groupes ; le fait se lit sur le modèle de la
// session, relu à chaque fois.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const WORDS = 'tape /model opus'
const NOW = 82_000_000

const LOT = {
  tickets: [
    { id: 'a1', name: 'Code', files: ['src/a.ts'], sensitive: false, logic: true },
    { id: 'b1', name: 'Autre', files: ['src/b.ts'], sensitive: false, logic: true },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Autre', tickets: ['b1'] },
  ],
}

/** Le moteur sous le plugin ; `model.id` : ce que rend `$.session.model()` (undefined : l'appel lève). */
const engine = (on: any, model: { id?: string }) => {
  mock.clock(on, { now: NOW })
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: '/proj', remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.model', () => {
    if (model.id === undefined) throw new Error('illisible')
    return { value: model.id }
  })
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }) as any)
  on('fs.write', (_$: unknown, e: { path: string }) => {
    throw new Error(`pas de disque : ${e.path}`)
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    throw new Error(`pas de disque : ${e.path}`)
  })
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return { filled }
}

/** Les textes du bandeau, au terminal et sur desktop (espaces insécables rendues). */
const bandTexts = async ($: any): Promise<string> => {
  const out: string[] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    out.push(...(await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '').replace(/ /g, ' ')))
    await band.unmount()
  }
  return out.join('\n')
}

/** La demande de lancement du groupe A. */
const launchA = async ($: any, filled: string[]): Promise<string> => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  return filled.at(-1) ?? ''
}

/** Une mission découpée ici, le découpage fini. */
const cut = async ($: any) => {
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
}

test('un id de Fable se reconnaît à son préfixe, sans dépendre de sa version', () => {
  expect(isFableModelId('claude-fable-5-2')).toBe(true)
  expect(isFableModelId('claude-fable-5-1')).toBe(true)
  expect(isFableModelId('claude-opus-5-5')).toBe(false)
  expect(isFableModelId('fable')).toBe(false)
  expect(isFableModelId(undefined)).toBe(false)
  expect(isFableModelId(42)).toBe(false)
})

/** Une mission découpée (Tickets faite), à deux groupes, au suivi de ses groupes. */
const followed = (): Run => {
  const run = newRun('to-tickets', NOW, 'Ici')
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const out = applyReport(board, { tickets: LOT.tickets, groups: LOT.groups } as any, NOW + 1).board.runs[0] as Run
  const at = out.phases.findIndex(p => p.skill === 'to-tickets')
  return { ...out, status: 'active', phases: out.phases.map((p, i) => (i === at ? { ...p, status: 'done' as const, finishedAt: NOW + 2 } : p)), cursor: Math.max(at, out.cursor) }
}

test('le fait « resté sur Fable » : au suivi des groupes, pas pendant un détour de cadrage, ni sur Opus, ni sans mission active', () => {
  const run = followed()
  expect(isFableStuck(run, 'claude-fable-5-2')).toBe(true)
  expect(isFableStuck(run, 'claude-opus-5-5')).toBe(false)
  expect(isFableStuck(run, undefined)).toBe(false)
  expect(isFableStuck(null, 'claude-fable-5-2')).toBe(false)
  expect(isFableStuck({ ...run, status: 'paused' }, 'claude-fable-5-2')).toBe(false)
  // Un /grilling en détour pendant le suivi (une question remontée) : c'est du cadrage, rien.
  const detour = { skill: 'grilling', status: 'active' as const, startedAt: NOW + 3, steps: [], items: [] }
  const grilled: Run = { ...run, phases: run.phases.map((p, i) => (i === run.cursor ? { ...p, detours: [...p.detours, detour] } : p)) }
  expect(isFableStuck(grilled, 'claude-fable-5-2')).toBe(false)
})

test('le cadrage fini, la session restée sur Fable : le bandeau et la demande de lancement disent « tape /model opus », une fois', { timeoutMs: 20000 }, async ($, on) => {
  const model = { id: 'claude-fable-5-2' }
  const { filled } = engine(on, model)
  await cut($)
  expect(await bandTexts($)).toContain(WORDS)
  const text = await launchA($, filled)
  expect(text.split(WORDS)).toHaveLength(2)
})

test('dès que la session n’est plus sur Fable (/model opus tapé), ni le bandeau ni la demande ne le disent, sans attendre une requête', { timeoutMs: 20000 }, async ($, on) => {
  const model = { id: 'claude-fable-5-2' }
  const { filled } = engine(on, model)
  await cut($)
  expect(await bandTexts($)).toContain(WORDS)
  model.id = 'claude-opus-5-5'
  expect(await bandTexts($)).not.toContain(WORDS)
  expect(await launchA($, filled)).not.toContain(WORDS)
})

test('rien pendant le cadrage (Fable y est voulu, imposé ou choisi)', { timeoutMs: 20000 }, async ($, on) => {
  engine(on, { id: 'claude-fable-5-2' })
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Cadrage' } as any)
  const band = await bandTexts($)
  // Le bandeau du cadrage est bien dessiné (sa mission), sans le rappel.
  expect(band).toContain('Cadrage')
  expect(band).not.toContain(WORDS)
})

// Ni le COO ni un worker n'ont de mission active ici (le COO n'en porte pas, un worker travaille pour celle d'une
// autre discussion) : les gardes `isCooDiscussion` et `delegate` de `isFableStuckHere` doublent `activeRun`, et ce test
// fixe le comportement de bout en bout de ces deux rôles, pas ces gardes seules.
test('rien chez le COO ni dans un worker, sur Fable', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  on('session.model', () => ({ value: 'claude-fable-5-2' }))
  // La mission d'une autre discussion, découpée, au suivi de ses groupes.
  const run = newRun('to-tickets', NOW - 6000, 'Ailleurs')
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const planned = applyReport(base, { tickets: LOT.tickets, groups: LOT.groups } as any, NOW - 5000).board.runs[0] as Run
  const at = planned.phases.findIndex(p => p.skill === 'to-tickets')
  const mission: Run = { ...planned, status: 'active', owner: 'session-B', phases: planned.phases.map((p, i) => (i === at ? { ...p, status: 'done' as const, finishedAt: NOW - 4000 } : p)), cursor: Math.max(at, planned.cursor) }
  writeBoard(w, b => ({ ...b, runs: [mission] }))
  await start($)
  // Le COO : rien.
  expect(await openCoo($, clock)).toMatch(/COO/)
  expect(await bandTexts($)).not.toContain(WORDS)
  // Un worker de cette mission : rien non plus.
  const answer = JSON.stringify(await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'A', main: '[abc123]' } as any))
  expect(answer).toMatch(/works for the mission/)
  expect(await bandTexts($)).not.toContain(WORDS)
})

test('rien sur Opus, ni quand le modèle de la session ne se lit pas', { timeoutMs: 20000 }, async ($, on) => {
  const model: { id?: string } = { id: 'claude-fable-5-2' }
  const { filled } = engine(on, model)
  await cut($)
  // Le modèle illisible : rien.
  model.id = undefined
  expect(await bandTexts($)).not.toContain(WORDS)
  // Le modèle de la session est Opus (le mod imposait Fable au cadrage à ses requêtes) : rien.
  model.id = 'claude-opus-5-5'
  expect(await bandTexts($)).not.toContain(WORDS)
  expect(await launchA($, filled)).not.toContain(WORDS)
})

test('rien dans une discussion sans mission', { timeoutMs: 20000 }, async ($, on) => {
  engine(on, { id: 'claude-fable-5-2' })
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  expect(await bandTexts($)).not.toContain(WORDS)
})
