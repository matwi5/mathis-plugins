import { expect, mock, test } from 'claude-code/testing'

import { ANYTIME_GROUPS } from '../hooks/catalog.ts'

const PLUGIN = 'flow-board'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const KEYS = ['any-wait-what', 'any-research', 'any-prototype', 'any-to-questionnaire', 'any-ask-matt', 'any-grilling', 'any-domain-modeling', 'any-compact', 'any-handoff']

const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

test('l’ordre d’usage : comprendre, s’orienter, puis le contexte (alléger, passer la main)', () => {
  expect(ANYTIME_GROUPS.map(g => g.title)).toEqual(['Comprendre', 'S’orienter', 'Contexte'])
  expect(ANYTIME_GROUPS.flatMap(g => g.tools.map(t => `any-${t.key}`))).toEqual(KEYS)
})

test('pendant un parcours, la barre « À tout moment » est en bas de la page Parcours et remplit le prompt', async ($, on) => {
  mock.clock(on, { now: 50_000_000 })
  mock.store(on)
  const filled = engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^À tout moment$/ })).toBeDefined()
    for (const key of KEYS) expect(await ui.find({ key })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Comprendre$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Contexte$/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  for (const key of KEYS) await ui.press({ key })
  await ui.unmount()
  // Reformulation part telle quelle ; « Et maintenant ? » dit où l'on en est ; les autres attendent un sujet ou des consignes.
  expect(filled).toEqual([
    '/mattpocock-skills:wait-what',
    '/mattpocock-skills:research ',
    '/mattpocock-skills:prototype ',
    '/mattpocock-skills:to-questionnaire ',
    '/mattpocock-skills:ask-matt Je suis dans le parcours « De la spec au code », phase Spec, étape Config du tracker : quelle est la suite ?',
    '/mattpocock-skills:grilling ',
    '/mattpocock-skills:domain-modeling ',
    '/compact ',
    '/mattpocock-skills:handoff ',
  ])
})

test('les libellés des boutons ajoutés : Et maintenant ?, Challenger, Préciser un terme', async ($, on) => {
  mock.clock(on, { now: 50_500_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(String((await ui.find({ key: 'any-prototype' }))?.props.label)).toMatch(/^✦.Tester.une.idée$/)
  expect(String((await ui.find({ key: 'any-ask-matt' }))?.props.label)).toMatch(/^✱.Et.maintenant.\?$/)
  expect(String((await ui.find({ key: 'any-grilling' }))?.props.label)).toMatch(/^◇.Challenger$/)
  expect(String((await ui.find({ key: 'any-domain-modeling' }))?.props.label)).toMatch(/^§.Préciser.un.terme$/)
  await ui.unmount()
})

test('sans aucun parcours dans le projet, la barre suit le lanceur', async ($, on) => {
  mock.clock(on, { now: 51_000_000 })
  mock.store(on)
  const filled = engine(on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Démarrer un parcours$/ })).toBeDefined()
  expect(await ui.find({ key: 'any-compact' })).toBeDefined()
  expect(await ui.find({ key: 'any-handoff' })).toBeDefined()
  // Sans parcours, « Et maintenant ? » demande par où commencer.
  await ui.press({ key: 'any-ask-matt' })
  expect(filled.at(-1)).toBe('/mattpocock-skills:ask-matt Aucun parcours en cours : par où commencer ?')
  // Le lanceur suit le flux, puis les autres points d'entrée ; TDD, Apprendre et Orientation n'y sont plus.
  for (const skill of ['grill-with-docs', 'to-spec', 'to-tickets', 'implement', 'diagnosing-bugs', 'branch-review', 'triage', 'improve-codebase-architecture']) {
    expect(await ui.find({ key: `new-${skill}` })).toBeDefined()
  }
  for (const skill of ['tdd', 'teach', 'ask-matt', 'wayfinder']) expect(await ui.find({ key: `new-${skill}` })).toBeUndefined()
  await ui.unmount()
})

test('l’onglet Commandes garde chaque skill une seule fois, lanceur compris', async ($, on) => {
  mock.clock(on, { now: 52_000_000 })
  mock.store(on)
  engine(on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-commands' })
  // Le /code-review de Matt reste dans Qualité ; le lanceur relit une branche avec celui de Claude Code.
  for (const skill of ['tdd', 'teach', 'ask-matt', 'prototype', 'code-review']) expect(await ui.find({ key: `cmd-${skill}` })).toBeDefined()
  // Retirés de la copie mattpocock-skills : plus de commande.
  for (const skill of ['implement-spec', 'wayfinder']) expect(await ui.find({ key: `cmd-${skill}` })).toBeUndefined()
  for (const skill of ['to-spec', 'to-tickets', 'branch-review']) {
    expect(await ui.find({ key: `cmd-${skill}` })).toBeUndefined()
    expect(await ui.find({ key: `new-${skill}` })).toBeDefined()
  }
  await ui.unmount()
})
