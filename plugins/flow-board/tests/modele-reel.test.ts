import { expect, mock, test } from 'claude-code/testing'

import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'
import { leadEffort, leadEffortPill } from '../hooks/effort.ts'
import { newRun } from '../hooks/model.ts'
import { cleanLane, emptyRegistry, mergeRegistry, noteSent } from '../hooks/registry.ts'
import { clipLane } from '../hooks/history.ts'
import type { Run, SentRequest } from '../types'

// Test de régression : un cadrage dont la session passe sur Fable 5.2 en cours de route
// doit partir en Fable 5.2 medium, comme la règle du cadrage le veut. Constaté : Fable 5.2 high.

const NOW = 300_000_000

/** Le moteur sous le plugin ; `session.model` rend `state.model`, qu'un test change en cours de route. */
const world = (on: any, state: { model: string }) => {
  const mem: Record<string, unknown> = {}
  const sent: { model: string; effort?: string }[] = []
  const during: unknown[] = []
  on('session.model', () => ({ value: state.model }))
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
  on('classic.PostModelSwitch', () => ({}))
  const answer = stoppedStep(stepUsage('claude-fable-5-2'))
  on('turn.step', async function* ($: unknown, e: any) {
    sent.push({ model: e.model, effort: e.effort })
    // Le registre tel que la barre d'état le relirait pendant la requête.
    during.push(JSON.parse(JSON.stringify(mem['agents:session-M'] ?? null)))
    return yield* answer($, e)
  })
  return { sent, mem, during }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
const switchTo = ($: any, from: string, to: string, requested: string | null, source: string) =>
  $.classic.PostModelSwitch({ session_id: 'session-M', transcript_path: '/t', cwd: '', hook_event_name: 'PostModelSwitch', from_model: from, to_model: to, requested_model: requested, source, context_tokens: 0 })

/** Le modèle qui répond vraiment : l'alias `fable` du mod et l'id complet d'un Fable sont tous deux Fable 5.2. */
const isFable = (m: string) => m === 'fable' || m.startsWith('claude-fable-')

for (const source of ['command', 'picker', 'sdk', 'resume', 'auto']) {
  test(`cadrage, session passée sur Fable par « ${source} » : la requête part en Fable 5.2 medium`, { timeoutMs: 20000 }, async ($, on) => {
    mock.clock(on, { now: NOW })
    const state = { model: 'claude-opus-5-5' }
    const w = world(on, state)
    await start($)
    await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
    await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
    // La session passe sur Fable 5.2 medium (un /model, le sélecteur, l'app qui applique son choix de lancement…).
    state.model = 'claude-fable-5-2'
    await switchTo($, 'claude-opus-5-5', 'claude-fable-5-2', 'fable', source)
    await playStep($, { model: 'claude-fable-5-2', effort: 'medium' })
    expect(w.sent.map(s => `${isFable(s.model) ? 'fable' : s.model}/${s.effort}`)).toEqual(['fable/medium', 'fable/medium'])
  })
}

// La règle du cadrage sur Fable vaut aussi pour une session passée sur Fable par un /model tapé : Fable 5.2
// medium (high quand l'auto envoie d'ici), quel que soit l'effort de la session : choix de Mathis du 14/11/2026
// (un /model tapé arrête le changement de modèle, pas la règle du cadrage sur Fable).
test('cadrage, /model fable tapé puis un effort high ou low : la requête part en Fable 5.2 medium', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const state = { model: 'claude-opus-5-5' }
  const w = world(on, state)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  state.model = 'claude-fable-5-2'
  await switchTo($, 'claude-opus-5-5', 'claude-fable-5-2', 'fable', 'command')
  await playStep($, { model: 'claude-fable-5-2', effort: 'high' })
  await playStep($, { model: 'claude-fable-5-2', effort: 'low' })
  expect(w.sent.map(s => `${isFable(s.model) ? 'fable' : s.model}/${s.effort}`)).toEqual(['fable/medium', 'fable/medium', 'fable/medium'])
})

test('la règle d’une requête déjà sur Fable en cadrage : medium exact, high exact quand l’auto envoie d’ici, et le bandeau nomme Fable 5.2', () => {
  const run = { ...newRun('grill-with-docs', NOW, 'Cadrage'), status: 'active' } as Run
  const onFable = leadEffort(run, false, { isOnFable: true })
  expect(onFable).toEqual({ level: 'medium', rule: 'framing', how: 'exact', isOnFable: true })
  expect(leadEffortPill(onFable!, 'medium')).toBe('modèle : Fable 5.2 medium, cadrage')
  const auto = leadEffort(run, false, { isOnFable: true, isAutoHere: true })
  expect(auto).toEqual({ level: 'high', rule: 'framingAuto', how: 'exact', isOnFable: true })
  expect(leadEffortPill(auto!, 'medium')).toBe('modèle : Fable 5.2 high, cadrage en auto')
  // Sur Opus (un /model opus tapé), rien ne change : high au moins.
  expect(leadEffort(run, false)).toEqual({ level: 'high', rule: 'framing', how: 'floor' })
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

/** Les textes du bandeau, au terminal et sur l'ordinateur, espaces insécables remplacées. */
const bandTexts = async ($: any): Promise<string[][]> => {
  const out: string[][] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'flow-board', surface, ...BAND })
    out.push((await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '').replace(/ /g, ' ')))
    await band.unmount()
  }
  return out
}

test('le bandeau nomme Fable 5.2 sur une session passée sur Fable, et plus dès qu’un /model opus la ramène', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const state = { model: 'claude-opus-5-5' }
  world(on, state)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  state.model = 'claude-fable-5-2'
  await switchTo($, 'claude-opus-5-5', 'claude-fable-5-2', 'fable', 'command')
  await playStep($, { model: 'claude-fable-5-2', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('modèle : Fable 5.2 medium, cadrage')
  // Sans attendre une requête, le bandeau ne dit plus Fable une fois la session revenue sur Opus.
  state.model = 'claude-opus-5-5'
  await switchTo($, 'claude-fable-5-2', 'claude-opus-5-5', 'opus', 'command')
  for (const texts of await bandTexts($)) expect(texts.some(t => t.includes('Fable'))).toBe(false)
})

// La barre d'état et l'onglet Agents lisaient le réglage de la session, jamais ce que le mod envoie : le registre
// de la session relève la requête du fil principal telle qu'elle part (`main.sent`), avec le réglage sous lequel
// elle part ; `main.effort` garde l'effort de la session, que le bandeau compare à l'effort envoyé. Une heure
// plausible : `cleanSent` refuse un relevé daté d'avant 2020.
const LATER = 1_800_000_000_000

/** Le registre de la session tel que le mod l'a écrit (`$.store` des tests). */
const registryOf = (raw: unknown) => (typeof raw === 'string' ? JSON.parse(raw) : raw) as { main?: { effort?: string; sent?: Record<string, unknown> } } | null

test('cadrage réécrit d’Opus 5.5 high en Fable medium : le registre relève la requête partie, l’effort de la session reste', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on, { model: 'claude-opus-5-5' })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await clock.advance(1_000)
  const reg = registryOf(w.mem['agents:session-M'])
  expect(reg?.main?.sent).toMatchObject({ model: 'claude-fable-5-2', effort: 'medium', session: { model: 'claude-opus-5-5', effort: 'high' } })
  expect(reg?.main?.effort).toBe('high')
})

test('pendant la requête, le registre écrit montre déjà ce qui part, sans attendre sa fin', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: LATER })
  const w = world(on, { model: 'claude-opus-5-5' })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  expect(registryOf(w.during[0])?.main?.sent).toMatchObject({ model: 'fable', effort: 'medium', session: { model: 'claude-opus-5-5', effort: 'high' } })
  // L'effort de la session aussi, dès la première requête : l'onglet compare l'un à l'autre.
  expect(registryOf(w.during[0])?.main?.effort).toBe('high')
})

test('après un /model vers un modèle sans effort, ses requêtes sans effort laissent le relevé du réglage : ni effort envoyé ni effort de session', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const state = { model: 'claude-opus-5-5' }
  const w = world(on, state)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  state.model = 'claude-haiku-5-5'
  await switchTo($, 'claude-opus-5-5', 'claude-haiku-5-5', 'haiku', 'command')
  await playStep($, { model: 'claude-haiku-5-5' })
  await playStep($, { model: 'claude-haiku-5-5', index: 1 })
  await clock.advance(1_000)
  const sent = registryOf(w.mem['agents:session-M'])?.main?.sent
  expect(sent?.session).toEqual({ model: 'claude-haiku-5-5' })
  expect(sent?.effort).toBeUndefined()
})

test('une requête annexe sans effort, sur un autre modèle que celui de la session, ne remplace pas le relevé', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on, { model: 'claude-opus-5-5' })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await playStep($, { model: 'claude-haiku-5-5' })
  await clock.advance(1_000)
  expect(registryOf(w.mem['agents:session-M'])?.main?.sent).toMatchObject({ effort: 'medium', session: { model: 'claude-opus-5-5', effort: 'high' } })
})

test('un /model qui change le réglage remplace le relevé, sans effort : la barre et l’onglet montrent le réglage', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const state = { model: 'claude-opus-5-5' }
  const w = world(on, state)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await clock.advance(1_000)
  state.model = 'claude-sonnet-5-5'
  await switchTo($, 'claude-opus-5-5', 'claude-sonnet-5-5', 'sonnet', 'command')
  await clock.advance(1_000)
  expect(registryOf(w.mem['agents:session-M'])?.main?.sent).toMatchObject({ model: 'claude-sonnet-5-5', session: { model: 'claude-sonnet-5-5' } })
  expect(registryOf(w.mem['agents:session-M'])?.main?.sent?.effort).toBeUndefined()
})

test('un /effort tapé remplace le relevé, sans effort, avant même le choix', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: LATER })
  const w = world(on, { model: 'claude-opus-5-5' })
  on('command.run', { command: 'effort' }, () => ({ text: '' }))
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await clock.advance(1_000)
  await $.command.run({ command: 'effort', args: '', origin: { kind: 'composer' } } as any)
  await clock.advance(1_000)
  const sent = registryOf(w.mem['agents:session-M'])?.main?.sent
  expect(sent).toMatchObject({ model: 'claude-opus-5-5', session: { model: 'claude-opus-5-5' } })
  expect(sent?.effort).toBeUndefined()
})

const SENT: SentRequest = { model: 'claude-fable-5-2', effort: 'medium', session: { model: 'claude-opus-5-5', effort: 'high' }, at: LATER }

test('la requête partie se relit d’une piste : une forme hors norme ou une heure impossible n’est pas gardée', () => {
  expect(cleanLane({ effort: 'high', sent: SENT }).sent).toEqual(SENT)
  expect(cleanLane({ sent: { ...SENT, model: 42 } }).sent).toBeUndefined()
  expect(cleanLane({ sent: { ...SENT, session: 'claude-opus-5-5' } }).sent).toBeUndefined()
  expect(cleanLane({ sent: { ...SENT, at: String(LATER) } }).sent).toBeUndefined()
  expect(cleanLane({ sent: { ...SENT, at: 1e15 } }).sent).toBeUndefined()
  // La vue d'une mission passée, faite de plusieurs discussions, ne montre la requête partie d'aucune.
  expect(clipLane({ effort: 'high', sent: SENT }, { s: 0, e: LATER }).sent).toBeUndefined()
})

test('deux processus de la même session : la requête partie la plus récente reste, jamais une datée après la fusion', () => {
  const at = (sent: typeof SENT) => ({ ...emptyRegistry('s', '', LATER), main: { sent } })
  const newer = { ...SENT, effort: 'xhigh', at: LATER + 20 }
  expect(mergeRegistry(at(SENT), at(newer)).main?.sent).toEqual(newer)
  expect(mergeRegistry(at(newer), at(SENT)).main?.sent).toEqual(newer)
  // Une horloge recalée en arrière : le fichier porte un relevé daté après la fusion, il ne l'emporte pas.
  expect(mergeRegistry(at(SENT), at(newer), LATER + 10).main?.sent).toEqual(SENT)
  expect(mergeRegistry(emptyRegistry('s', '', LATER), at(newer), LATER + 10).main?.sent).toBeUndefined()
  // Un relevé du même processus (`by`) : le sien en mémoire l'emporte, même daté avant celui qu'il a écrit.
  const own = { ...SENT, by: 'p1' }
  expect(mergeRegistry(at(own), at({ ...newer, by: 'p1' }), LATER + 30).main?.sent).toEqual(own)
  // Le processus vivant remplace toujours son relevé, même par un plus ancien, et l'effort de la session suit.
  expect(noteSent(at(newer), SENT, LATER + 30)?.main?.effort).toBe('high')
  expect(noteSent(at(newer), SENT, LATER + 30)?.main?.sent).toEqual(SENT)
  expect(noteSent(emptyRegistry('s', '', LATER), SENT, LATER + 30)?.main?.sent).toEqual(SENT)
})
