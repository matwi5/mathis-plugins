import { expect, mock, test } from 'claude-code/testing'

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
}

// Une spec validée d'un clic dans le chat avait plu ; rien ne le demandait, et rien n'empêchait non
// plus une question à boutons de doublonner un bouton du tableau de bord.
test('l’accord d’un grilling, la spec et le découpage se valident par une question à boutons', async ($, on) => {
  mock.clock(on, { now: 52_000_000 })
  mock.store(on)
  world(on)
  for (const skill of ['grill-with-docs', 'to-spec', 'to-tickets']) {
    const text = (await $.skill.prompt({ skill: `mattpocock-skills:${skill}`, text: 'x' })).text as string
    expect(text).toContain('a button question (AskUserQuestion)')
    expect(text).toContain('« Valider (Recommandé) » and « À reprendre »')
    expect(text).toContain('none in a linked session: there the validation goes up to the main discussion')
  }
  const spec = (await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })).text as string
  expect(spec).toContain('publish (once the user validates it with a button question (AskUserQuestion)')
})

test('le compte rendu renvoie au bouton « Valider le rapport », jamais à une question à boutons', async ($, on) => {
  mock.clock(on, { now: 53_000_000 })
  mock.store(on)
  world(on)
  // Le compte rendu n'a d'étapes que dans un parcours.
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: 'mcp__flow-board__flow', title: 'Lot', tickets: [{ id: 'a1', name: 'Règle', status: 'done' }] } as any)
  await $.tool.call({ tool: 'mcp__flow-board__flow', complete: true } as any)
  const text = (await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })).text as string
  expect(text).toContain('validate (in one line of text, tell the user to click « ✓ Valider le rapport » in the dashboard, never with a button question; then wait')
})
