import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

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

// Un lot de 4 tickets Asana : B après A, C après A et B, D libre.
const A = '1200000000000111'
const B = '1200000000000114'
const C = '1200000000000112'
const D = '1200000000000109'
const LOT = [
  { id: A, name: 'Règle SC unique', blockedBy: [] },
  { id: B, name: 'Fermetures VSC', blockedBy: [A] },
  { id: C, name: 'App alignée', blockedBy: [A, B] },
  { id: D, name: 'CLAUDE.md', blockedBy: [] },
]

test('un ticket bloqué ne se choisit qu’après ses bloqueurs ; l’ordre de sélection est gardé', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 50_000_000 })
  mock.store(on)
  const filled = engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot SC', tickets: LOT } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    // B et C attendent A : pas de bouton de choix, une mention des dépendances.
    expect(await ui.find({ key: `pick-${B}` })).toBeUndefined()
    expect(await ui.find({ key: `pick-${C}` })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /après : Règle SC unique, Fermetures VSC/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /en attente/ })).toBeDefined()

    // D, puis A : B devient possible (A choisi avant), puis C (A et B choisis avant).
    await ui.press({ key: `pick-${D}` })
    await ui.press({ key: `pick-${A}` })
    expect(await ui.find({ key: `pick-${C}` })).toBeUndefined()
    await ui.press({ key: `pick-${B}` })
    await ui.press({ key: `pick-${C}` })
    expect((await ui.find({ key: `pick-${C}` }))?.props).toMatchObject({ label: '④' })

    // Retirer A retire aussi B et C, qui ne tenaient que grâce à lui.
    await ui.press({ key: `pick-${A}` })
    expect((await ui.find({ key: `pick-${D}` }))?.props).toMatchObject({ label: '①' })
    expect(await ui.find({ key: `pick-${B}` })).toBeUndefined()
    await ui.press({ key: 'clear-picks' })
    await ui.unmount()
  }

  // Lancement : la commande /implement avec les tickets dans l'ordre choisi.
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: `pick-${A}` })
  await ui.press({ key: `pick-${D}` })
  await ui.press({ key: 'launch-picks' })
  expect(await ui.find({ type: 'Text', text: /^#1$/ })).toBeDefined()
  await ui.unmount()
  expect(filled.at(-1)).toBe(
    `/mattpocock-skills:implement Tickets à traiter, un par un et dans cet ordre : 1) ${A} — Règle SC unique ; 2) ${D} — CLAUDE.md`,
  )

  // La note donnée à Claude au chargement d'/implement reprend la file.
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'y' })
  expect(note.text).toMatch(/Ticket queue chosen by the user, in order: 1\) Règle SC unique/)
})

test('après la spec et les tickets, la sélection ne propose que /implement ; lien Asana sur les GID', async ($, on) => {
  mock.clock(on, { now: 51_000_000 })
  mock.store(on)
  const filled = engine(on)
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, complete: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'y' })
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'z' })
  expect(note.text).toMatch(/blockedBy/)
  await $.tool.call({ tool: TOOL, tickets: LOT, complete: true } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Link' })).toBeDefined()
  await ui.press({ key: `pick-${D}` })
  expect(await ui.find({ key: 'launch-picks-parallel' })).toBeUndefined()
  await ui.press({ key: 'launch-picks' })
  await ui.unmount()
  expect(filled.at(-1)).toMatch(/^\/mattpocock-skills:implement Tickets à traiter, un par un et dans cet ordre : 1\) /)
})

test('au terminal, le lien Asana devient un bouton qui copie son adresse ; ailleurs, il reste un lien', async ($, on) => {
  mock.clock(on, { now: 52_000_000 })
  mock.store(on)
  engine(on)
  const copies: { text: string; surface?: string }[] = []
  on('ui.copy', (_$: unknown, e: { text: string; surface?: string }) => {
    copies.push(e)
    return { value: { isCopied: true } }
  })
  const toasts: string[] = []
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Lot SC', tickets: LOT } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  expect((await ui.find({ key: `copy-${A}` }))?.props).toMatchObject({ label: '⧉\u00a0Asana' })
  await ui.press({ key: `copy-${A}` })
  await ui.unmount()
  expect(copies).toEqual([expect.objectContaining({ text: `https://app.asana.com/0/0/${A}` })])
  expect(toasts.at(-1)).toBe('Lien Asana copié')

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await desktop.find({ type: 'Link' })).toBeDefined()
  expect(await desktop.find({ key: `copy-${A}` })).toBeUndefined()
  await desktop.unmount()
})
