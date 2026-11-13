// Le tri reçoit les consignes d'un cadrage (un choix sensible posé en question, une décision recopiée mot pour
// mot), sans passer sur Fable 5.2 : il est un cadrage pour les consignes, pas pour le modèle. `/grilling` chargé à
// l'étape « Approfondir » d'un tri reçoit ces deux règles, et seulement elles : il ne recevait rien.

import { expect, mock, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { leadEffort } from '../hooks/effort.ts'
import { applyReport, applySkill, emptyBoard } from '../hooks/model.ts'
import type { Board } from '../types'

const TOOL = 'mcp__flow-board__flow'
const SENSITIVE_RULE = 'is never a declared choice ({"decided": …}): ask the user while framing, with options, and wait for the answer'
const WORD_FOR_WORD = 'copies the question asked and the accepted answer word for word'

/** Le moteur sous le plugin : `$.store` et les fichiers en mémoire (le fichier commun des missions sert sous un `.claude/`). */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'sa' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'sa' }))
  on('command.list', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
}

const skill = async ($: any, name: string): Promise<string> => String((await $.skill.prompt({ skill: name.includes(':') ? name : `mattpocock-skills:${name}`, text: 'x' })).text)

const opened = async ($: any, on: any, entry: string) => {
  mock.clock(on, { now: 80_000_000 })
  world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  const text = await skill($, entry)
  await $.tool.call({ tool: TOOL, title: 'Tri' } as any)
  return text
}

const T0 = 1_000
const boardOf = (entry: string): Board => applySkill({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [], activeId: null }, `mattpocock-skills:${entry}`, { now: T0, isMain: true })!.board

test('le chargement de /triage porte les deux règles de cadrage', { timeoutMs: 20000 }, async ($, on) => {
  const text = await opened($, on, 'triage')
  expect(text).toContain(SENSITIVE_RULE)
  expect(text).toContain(WORD_FOR_WORD)
})

test('/grilling chargé pendant un tri reçoit les deux règles, et seulement elles : ni les étapes ni les éléments du grilling', { timeoutMs: 20000 }, async ($, on) => {
  await opened($, on, 'triage')
  const text = await skill($, 'grilling')
  expect(text).toContain(SENSITIVE_RULE)
  expect(text).toContain(WORD_FOR_WORD)
  expect(text).toContain('which keeps its own steps and items')
  expect(text).not.toContain('Steps of')
  expect(text).not.toContain('Items:')
  expect(text).not.toContain('{"complete": true}')
  expect(text).not.toContain('Auto mode is on')
})

test('/grilling pendant un tri : l’étape grill passe en cours, les éléments du tri restent, aucune phase ni détour en plus', () => {
  let board = applyReport(boardOf('triage'), { step: 'verify', items: [{ id: 'R96', label: 'R96 Lot vide', status: 'doing' }] }, T0 + 100).board
  const before = activeRun(board)!
  const out = applySkill(board, 'mattpocock-skills:grilling', { now: T0 + 200, isMain: true })!
  board = out.board
  const after = activeRun(board)!
  expect(out.fx.note).toBe('none')
  expect(out.fx.usedBy).toEqual({ owner: 'triage', step: 'grill' })
  expect(after.id).toBe(before.id)
  expect(after.phases.map(p => p.skill)).toEqual(before.phases.map(p => p.skill))
  expect(after.phases[0]!.items).toEqual(before.phases[0]!.items)
  expect(after.phases[0]!.steps.find(s => s.status === 'active')?.id).toBe('grill')
  expect(after.phases.some(p => p.detours.length > 0)).toBe(false)
})

test('rien d’autre ne change : un sous-skill rattaché à aucune étape, ou d’une phase qui n’est pas un cadrage, ne reçoit rien', { timeoutMs: 30000 }, async ($, on) => {
  // Le hook a tourné : le skill d'entrée porte sa consigne, avant l'absence vérifiée ensuite.
  expect(await opened($, on, 'grill-with-docs')).toContain(SENSITIVE_RULE)
  expect(await skill($, 'grilling')).toBe('x')
  expect(await skill($, 'domain-modeling')).toBe('x')
})

test('rien d’autre ne change : domain-modeling pendant un tri ne reçoit rien', { timeoutMs: 20000 }, async ($, on) => {
  expect(await opened($, on, 'triage')).toContain(SENSITIVE_RULE)
  expect(await skill($, 'domain-modeling')).toBe('x')
})

test('rien d’autre ne change : /grilling pendant « Santé du code » ne reçoit rien', { timeoutMs: 20000 }, async ($, on) => {
  expect(await opened($, on, 'improve-codebase-architecture')).toContain('Steps of improve-codebase-architecture')
  expect(await skill($, 'grilling')).toBe('x')
})

test('une mission en tri ne passe pas sur Fable : règle « other », plancher high, même quand le mod peut réécrire le modèle', () => {
  const run = { ...activeRun(boardOf('triage'))!, status: 'active' as const }
  expect(run.phases[0]!.status).toBe('active')
  expect(leadEffort(run, true)).toEqual({ level: 'high', rule: 'other', how: 'floor' })
  expect(leadEffort(run, true, { isAutoHere: true })).toEqual({ level: 'high', rule: 'other', how: 'floor' })
})
