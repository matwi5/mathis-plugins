import { expect, mock, test } from 'claude-code/testing'

import { newRun, upgradeRun } from '../hooks/model.ts'
import type { Run } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

/** Le moteur sous le plugin : un projet `C:/proj` dans un dépôt git, et des éditions qui réussissent. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.root', () => ({ value: 'C:/proj' }))
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value
    return { value: undefined }
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: 'x' } }))
  on('tool.call', { tool: 'Write' }, () => ({ result: { filePath: 'x' } }))
  return mem
}

test('le parcours d’implémentation passe par le Compte rendu, puis Version et push, puis Pull request (/project:pr)', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 30_000_000 })
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, complete: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect((await ui.find({ key: 'go-compte-rendu' }))?.props).toMatchObject({ label: '▶ Compte rendu · /flow-board:compte-rendu' })
    expect(await ui.find({ key: 'go-project:version' })).toBeUndefined()
    await ui.unmount()
  }
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })
  // Claude ne peut pas valider le rapport : seule la personne le fait, dans le panneau.
  const refused = await $.tool.call({ tool: TOOL, step: 'validate', complete: true } as any)
  expect(JSON.stringify(refused)).toMatch(/validated by the user from the dashboard/)
  {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
    expect(await ui.find({ key: 'go-project:version' })).toBeUndefined()
    await ui.press({ key: 'report-ok' })
    await ui.unmount()
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    const next = await ui.find({ key: 'go-project:version' })
    expect(next?.props).toMatchObject({ label: '▶ Version et push · /project:version' })
    // La revue n'est pas une phase de la feuille de route.
    expect(await ui.find({ type: 'Text', text: /Revue finale|Revue du groupe/ })).toBeUndefined()
    await ui.unmount()
  }
  // Après la phase combinée (version puis push), la suite est /project:pr.
  await $.skill.prompt({ skill: 'project:version', text: 'y' })
  await $.tool.call({ tool: TOOL, step: 'pushed' })
  await $.tool.call({ tool: TOOL, complete: true })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-project:pr' })).toBeDefined()
  await ui.unmount()
})

test('/project:push lancé sans /project:version ouvre la phase combinée, étapes de version sautées', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 31_000_000 })
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.skill.prompt({ skill: 'project:push', text: 'y' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect((await ui.find({ type: 'Text', text: /^Choix du bump$/ }))?.props).toMatchObject({ strikethrough: true })
  expect((await ui.find({ type: 'Text', text: /^Push : reste à commiter$/ }))?.props).toMatchObject({ bold: true })
  await ui.unmount()
})

test('/project:version puis /project:push : une seule phase, sans nouveau tour', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 32_000_000 })
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.skill.prompt({ skill: 'project:version', text: 'y' })
  await $.tool.call({ tool: TOOL, step: 'tag' })
  await $.skill.prompt({ skill: 'project:push', text: 'z' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /tour\s2/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Commit et tag$/ }))?.props).not.toMatchObject({ strikethrough: true })
  expect((await ui.find({ type: 'Text', text: /^Push : reste à commiter$/ }))?.props).toMatchObject({ bold: true })
  await ui.unmount()
})

test('une commande de livraison seule n’ouvre aucun parcours', async ($, on) => {
  mock.clock(on, { now: 33_000_000 })
  world(on)
  for (const skill of ['project:pr', 'project:push', 'project:sync', 'project:version']) {
    await $.skill.prompt({ skill, text: 'x' })
  }
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Tableau de bord du workflow/ })).toBeDefined()
  await ui.unmount()
})

test('la fin de /project:version ne clôt pas « Version et push » : la suite est /project:push', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 33_000_000 })
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, complete: true })
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'report-ok' })
  await ui.unmount()
  await $.skill.prompt({ skill: 'project:version', text: 'v' })
  await $.tool.call({ tool: TOOL, step: 'tag' })
  const answer = await $.tool.call({ tool: TOOL, complete: true })
  expect(JSON.stringify(answer)).toMatch(/stays open until \/project:push/)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect((await ui.find({ key: 'go-project:push' }))?.props).toMatchObject({ variant: 'primary' })
  expect(await ui.find({ key: 'go-project:pr' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Push : reste à commiter$/ }))?.props.strikethrough).not.toBe(true)
  await ui.unmount()
  // Le push fait, la phase se clôt et la pull request vient.
  await $.skill.prompt({ skill: 'project:push', text: 'p' })
  await $.tool.call({ tool: TOOL, step: 'pushed' })
  await $.tool.call({ tool: TOOL, complete: true })
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'go-project:pr' })).toBeDefined()
  await ui.unmount()
})

test('une phase « Version et push » close sans push par une version antérieure est rouverte au chargement', () => {
  const run = newRun('implement', 1_000)
  const at = run.phases.findIndex(p => p.skill === 'project:version')
  const closed: Run = {
    ...run,
    cursor: at,
    phases: run.phases.map((p, i) =>
      i < at
        ? { ...p, status: 'done' as const }
        : i === at
          ? { ...p, status: 'done' as const, steps: p.steps.map(s => ({ id: s.id, status: (['push', 'checks', 'docs', 'pushed'].includes(s.id) ? 'skipped' : 'done') as 'skipped' | 'done' })) }
          : p,
    ),
  }
  const repaired = upgradeRun(closed)
  expect(repaired.phases[at]!.status).toBe('active')
  expect(repaired.phases[at]!.steps.filter(s => s.status === 'pending').map(s => s.id)).toEqual(['push', 'checks', 'docs', 'pushed'])
  expect(upgradeRun(repaired)).toBe(repaired)
})
