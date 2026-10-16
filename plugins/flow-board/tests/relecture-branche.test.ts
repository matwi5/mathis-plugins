import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

test('« Relire une branche ou une PR » met /code-review (Claude Code) sans --fix ; lancé sans parcours, il ouvre une Relecture de branche', async ($, on) => {
  mock.clock(on, { now: 97_000_000 })
  mock.store(on)
  const filled = world(on)

  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^\/code-review\s+·\s+les bugs du diff/})).toBeDefined()
  await ui.press({ key: 'new-branch-review' })
  await ui.unmount()
  expect(filled.at(-1)).toBe('/code-review ')

  // La commande lancée sans parcours : un parcours « Relecture de branche », et sa consigne.
  const note = await $.skill.prompt({ skill: 'code-review', text: 'r' })
  expect(note.text).toMatch(/The review target and options/)
  expect(note.text).toMatch(/without "group": it covers the whole run/)
  expect(note.text).toMatch(/When the work of branch-review is finished: \{"complete": true\}/)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /RELECTURE DE BRANCHE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^◆.Relecture$/ })).toBeDefined()
  expect(await ui.find({ key: 'security-group-lot' })).toBeUndefined()
  await ui.unmount()

  // L'avis de Claude, sans groupe : le bouton de la revue de sécurité pour tout le lot.
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'entrée utilisateur vers une requête' } } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /conseillée : entrée utilisateur vers une requête/ })).toBeDefined()
  await ui.press({ key: 'security-group-lot' })
  await ui.unmount()
  expect(filled.at(-1)).toMatch(/^Lance la revue de sécurité de ce parcours : confie-la à un sous-agent relecteur/)

  // Les constats du sous-agent relecteur : « sécurité relue » pour le lot.
  await $.tool.call({ tool: TOOL, security: { findings: 1, fixed: 1 } } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /sécurité relue · 1.constat · 1 corrigé/ })).toBeDefined()
  await ui.unmount()
})

test('pendant un parcours, /code-review reste la revue du groupe : pas de Relecture de branche', async ($, on) => {
  mock.clock(on, { now: 97_500_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'A1', name: 'Un', blockedBy: [] }], groups: [{ id: 'A', name: 'Tout', tickets: ['A1'] }] } as any)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }] } as any)
  const note = await $.skill.prompt({ skill: 'code-review', text: 'r' })
  // Avec des groupes, l'avis porte sur le groupe.
  expect(note.text).toMatch(/\{"security": \{"group": "<id>"/)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /RELECTURE DE BRANCHE/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^✓.revu$/ })).toBeDefined()
  await ui.unmount()
})

test('la phase Revue d’une Chasse au bug demande l’avis sécurité pour tout le lot', async ($, on) => {
  mock.clock(on, { now: 98_000_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:diagnosing-bugs', text: 'b' })
  await $.tool.call({ tool: TOOL, complete: true } as any)
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:code-review', text: 'r' })
  expect(note.text).toMatch(/without "group": it covers the whole run/)
})
