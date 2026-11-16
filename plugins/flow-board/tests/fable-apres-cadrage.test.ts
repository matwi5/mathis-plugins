import { expect, mock, test } from 'claude-code/testing'

import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'

import { isFableModelId } from '../hooks/effort.ts'
import { memoryDisk } from './disque-memoire.ts'
import type { Ticket } from '../types'
import { settle } from './horloge.ts'

// Mission « Fable resté après le cadrage » : un manager dont la session elle-même
// est sur Fable (bascule de l'app, `/model fable`, Fable par défaut du poste) gardait Fable après la fin du
// découpage ; seul le rappel « tape /model opus » le signalait. Décision de Mathis du 14/11/2026 : hors du cadrage, chaque requête du fil principal partie sur Fable revient sur Opus, même après un
// `/model` tapé, à l'effort de sa règle (manager, COO ; les workers : effort-worker.test.ts).

const NOW = 300_000_000
/** Une heure plausible : le relevé du registre (`cleanSent`) refuse une heure d'avant 2020. */
const LATER = 1_800_000_000_000
const TOOL = 'mcp__flow-board__flow'
const FABLE_ID = 'claude-fable-5-2'
const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({ id, name: `T${id}`, status: 'todo', sensitive: false, files: ['plugins/flow-board/hooks/model.ts'], ...over })
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

/**
 * Le moteur sous le plugin, la session sur Fable ; `models` et `efforts` : le modèle et l'effort de chaque requête
 * telle qu'elle part ; `prompts` : les messages tels qu'ils arrivent à Claude (contexte compris).
 */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const models: string[] = []
  const efforts: (string | undefined)[] = []
  const prompts: { text: string; context?: readonly string[] }[] = []
  on('session.model', () => ({ value: FABLE_ID }))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-M' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('classic.PostModelSwitch', () => ({}))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    prompts.push(e)
    return { text: e.text }
  })
  // Le modèle qui répond est celui qui part : un alias se résout comme le moteur le fait.
  on('turn.step', async function* ($: unknown, e: any) {
    models.push(e.model)
    efforts.push(e.effort)
    return yield* stoppedStep(stepUsage(e.model === 'opus' ? 'claude-opus-5-5' : e.model === 'fable' ? FABLE_ID : e.model))($, e)
  })
  return { mem, models, efforts, prompts }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

/** Un découpage en deux groupes, fini : la mission entre dans le suivi de ses groupes. */
const cut = async ($: any) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await playStep($, { model: FABLE_ID, effort: 'medium' })
  await $.tool.call({
    tool: TOOL,
    tickets: [ticket('1'), ticket('2', { files: ['plugins/stats-board/hooks/register.tsx'] })],
    groups: [{ id: 'A', name: 'Un', tickets: ['1'] }, { id: 'B', name: 'Deux', tickets: ['2'] }],
    complete: true,
  } as any)
}

/** Un `/model` tapé : la session passe sur `to`. */
const typedModel = ($: any, to: string) =>
  $.classic.PostModelSwitch({ session_id: 'session-M', transcript_path: '/t', cwd: '', hook_event_name: 'PostModelSwitch', from_model: 'claude-opus-5-5', to_model: to, requested_model: null, source: 'command', context_tokens: 0 })

/** Les textes du bandeau, par surface (espaces insécables rendues). */
const bandTexts = async ($: any): Promise<string[][]> => {
  const out: string[][] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'flow-board', surface, ...BAND })
    out.push((await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '').replace(/ /g, ' ')))
    await band.unmount()
  }
  return out
}

const onFable = (m: string): 'Fable' | 'hors Fable' => (isFableModelId(m) || m === 'fable' ? 'Fable' : 'hors Fable')

test('session sur Fable : le découpage fini, chaque requête du fil principal part hors de Fable', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await cut($)
  await playStep($, { model: FABLE_ID, effort: 'medium' })
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await playStep($, { model: FABLE_ID, effort: 'medium' })
  expect(w.models.slice(1).map(onFable)).toEqual(['hors Fable', 'hors Fable'])
})

test('le découpage reste sur Fable ; ensuite Opus (alias opus), à l’effort de la règle : medium au suivi des groupes (xhigh laissé), high au compte rendu', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await cut($)
  await playStep($, { model: FABLE_ID, effort: 'high' })
  await playStep($, { model: FABLE_ID, effort: 'xhigh' })
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'x' })
  await playStep($, { model: FABLE_ID, effort: 'medium' })
  expect(w.models).toEqual(['fable', 'opus', 'opus', 'opus'])
  expect(w.efforts).toEqual(['medium', 'medium', 'xhigh', 'high'])
})

test('un /model fable tapé n’arrête pas le retour sur Opus hors du cadrage', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await cut($)
  await typedModel($, FABLE_ID)
  await playStep($, { model: FABLE_ID, effort: 'medium' })
  expect(w.models.at(-1)).toBe('opus')
})

test('gardes : un spécialiste, une requête repliée hors de Fable et une discussion sans mission ne sont jamais réécrits', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  // Sans mission : rien.
  await playStep($, { model: FABLE_ID, effort: 'medium' })
  await cut($)
  await playStep($, { model: FABLE_ID, effort: 'high', agentId: 'a1' })
  await playStep($, { model: 'claude-opus-4-8', effort: 'medium' })
  expect(w.models).toEqual([FABLE_ID, 'fable', FABLE_ID, 'claude-opus-4-8'])
})

test('la discussion du COO sur Fable : ses requêtes partent sur Opus en medium', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  memoryDisk(on)
  const w = world(on)
  await start($)
  const loading = $.skill.prompt({ skill: 'flow-board:coo', text: 'consignes du COO' })
  await settle(clock, 4)
  await loading
  await playStep($, { model: FABLE_ID, effort: 'high' })
  expect(w.models).toEqual(['opus'])
  expect(w.efforts).toEqual(['medium'])
})

test('ce que voient Mathis et Claude : le bandeau nomme Opus 5.5 et garde « tape /model opus », la note à Claude dit Opus 5.5', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await cut($)
  await playStep($, { model: FABLE_ID, effort: 'high' })
  for (const texts of await bandTexts($)) {
    expect(texts).toContain('modèle : Opus 5.5 medium, suivi des groupes')
    expect(texts).toContain('tape /model opus')
  }
  await $.prompt.submit({ text: 'Quel modèle utilises-tu ?', origin: { kind: 'composer' } } as any)
  expect((w.prompts.at(-1)?.context ?? []).join('\n')).toContain('tes requêtes partent sur Opus 5.5 en medium (suivi des groupes)')
})

test('le registre relève la requête ramenée sur Opus, sous le réglage Fable de la session', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on)
  await start($)
  await cut($)
  await playStep($, { model: FABLE_ID, effort: 'high' })
  await clock.advance(1_000)
  const raw = w.mem['agents:session-M']
  const reg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { main?: { sent?: Record<string, unknown> } } | null
  expect(reg?.main?.sent).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium', session: { model: FABLE_ID, effort: 'high' } })
})
