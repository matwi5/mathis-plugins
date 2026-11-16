import { expect, mock, test } from 'claude-code/testing'

import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'
import { modelName } from '../hooks/effort.ts'

// Test de régression : quand le mod envoie un autre modèle ou un autre effort que ceux de la
// session, le message suivant de la personne arrive à Claude avec une note qui les nomme, ajoutée au
// contexte du message par `prompt.submit` (le canal que la sonde a essayé : docs/evenements-moteur.md,
// essai 1 de « Ce que le COO peut faire »). L'en-tête du prompt système (« You are powered by the model
// named Opus 5.5 ») et CLAUDE_EFFORT donnent ceux de la session : sans la note, Claude répond « Opus » ou
// cite la règle (« medium ») sans pouvoir la lire.

const NOW = 300_000_000
/** Une heure plausible : le relevé du registre (`cleanSent`) refuse une heure d'avant 2020. */
const LATER = 1_800_000_000_000
const TOOL = 'mcp__flow-board__flow'

/** Le moteur sous le plugin ; `model` : le modèle de la session (`$.session.model()`). */
const world = (on: any, model = 'claude-opus-5-5') => {
  const mem: Record<string, unknown> = {}
  const sent: { text: string; context?: readonly string[] }[] = []
  on('session.model', () => ({ value: model }))
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
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    sent.push(e)
    return { text: e.text }
  })
  on('turn.step', stoppedStep(stepUsage('claude-fable-5-2')))
  on('classic.PostModelSwitch', () => ({}))
  on('command.run', { command: 'effort' }, () => ({ text: '' }))
  return { sent }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
const ask = ($: any) => $.prompt.submit({ text: 'Quel modèle et quel effort utilises-tu ?', origin: { kind: 'composer' } } as any)
const contextOf = (w: { sent: { context?: readonly string[] }[] }) => (w.sent.at(-1)?.context ?? []).join('\n')

test('cadrage réécrit en Fable 5.2 medium sur une session Opus 5.5 high : le message suivant porte une note qui le dit', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await ask($)
  expect(contextOf(w)).toContain('Fable 5.2')
  expect(contextOf(w)).toContain('medium')
})

test('le tour de /flow-board:coo porte la note lui aussi', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await $.prompt.submit({ text: '/flow-board:coo', origin: { kind: 'composer' }, command: { name: 'flow-board:coo', args: '' } } as any)
  expect(contextOf(w)).toContain('tes requêtes partent sur Fable 5.2 en medium (cadrage)')
})

test('sans mission, rien n’est imposé : aucune note',{ timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await ask($)
  expect(contextOf(w)).not.toContain('Fable 5.2')
})

test('session déjà sur Fable 5.2 medium, en cadrage : rien ne diffère du réglage, aucune note', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on, 'claude-fable-5-2')
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-fable-5-2', effort: 'medium' })
  await ask($)
  expect(contextOf(w)).toBe('')
})

test('la note nomme ce qui part et le réglage de la session', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await ask($)
  expect(contextOf(w)).toBe('flow-board : tes requêtes partent sur Fable 5.2 en medium (cadrage) ; l\'en-tête « You are powered by » et CLAUDE_EFFORT donnent le réglage de la session (Opus 5.5, high).')
})

test('la réponse de l’outil flow porte la note quand l’appel change ce qui part, une seule fois', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on)
  await start($)
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  const first = JSON.stringify(await $.tool.call({ tool: TOOL, title: 'Cadrage de test' } as any))
  expect(first).toContain('tes requêtes partent sur Fable 5.2 en medium (cadrage)')
  const second = JSON.stringify(await $.tool.call({ tool: TOOL, step: 'tree' } as any))
  expect(second).not.toContain('tes requêtes partent')
})

test('modelName : alias Fable, ids complets, suffixe laissé ; toute autre forme se tait', () => {
  expect(modelName('fable')).toBe('Fable 5.2')
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-fable-5-2[1m]')).toBe('Fable 5.2')
  expect(modelName('claude-sonnet-5-5-20261001')).toBe('Sonnet 5.5')
  expect(modelName('opus; rm -rf')).toBeNull()
  expect(modelName(undefined)).toBeNull()
})

/** Un `/model` tapé (`source: 'command'`) : la réécriture du modèle s'arrête, la règle du cadrage devient un plancher high. */
const typedModel = ($: any, to: string) =>
  $.classic.PostModelSwitch({ session_id: 'session-M', transcript_path: '/t', cwd: '', hook_event_name: 'PostModelSwitch', from_model: 'claude-opus-5-5', to_model: to, requested_model: 'opus', source: 'command', context_tokens: 0 })

test('un /effort tapé avec un niveau : la note suivante compte avec cet effort, pas avec l’ancien', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: LATER })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await typedModel($, 'claude-opus-5-5')
  await $.command.run({ command: 'effort', args: 'low', origin: { kind: 'composer' } } as any)
  await ask($)
  // Cadrage sur Opus après un /model : plancher high ; la session en low part donc en high.
  expect(contextOf(w)).toContain('tes requêtes partent sur Opus 5.5 en high (cadrage)')
  expect(contextOf(w)).toContain('(Opus 5.5, low)')
})

test('plus rien d’imposé après une note, hors de l’outil flow : le message suivant dit le retour au réglage', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: LATER })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  await ask($)
  expect(contextOf(w)).toContain('tes requêtes partent sur Fable 5.2 en medium (cadrage)')
  // Un /model opus tapé : plus de Fable, le plancher high égale l'effort de la session.
  await typedModel($, 'claude-opus-5-5')
  // L'effort de la session n'est connu qu'à la requête suivante : rien de neuf d'ici là.
  await ask($)
  expect(contextOf(w)).not.toContain('tes requêtes')
  await playStep($, { model: 'claude-opus-5-5', effort: 'high', index: 1 })
  await ask($)
  expect(contextOf(w)).toContain('tes requêtes repartent sur le réglage de la session (Opus 5.5, high)')
  await ask($)
  expect(contextOf(w)).not.toContain('tes requêtes')
})

test('une session sur un modèle sans effort, en cadrage : turn.step ne réécrit rien, la note ne dit rien', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: LATER })
  const w = world(on, 'claude-haiku-5-5')
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  await playStep($, { model: 'claude-haiku-5-5' })
  await ask($)
  expect(contextOf(w)).not.toContain('tes requêtes')
})
