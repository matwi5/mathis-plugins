import { expect, mock, test } from 'claude-code/testing'

import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'

// Un groupe ne se lance qu'en session liée (spec « Groupes et vagues », série 1 Q10) : plus de
// lancement ici ni par /implement-spec ; les tickets choisis à la main gardent leurs lancements.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
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

/** Un dépôt git : c'est là qu'un lancement en parallèle dans cette discussion se proposait. */
const inRepo = (on: any) => on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))

// A ∥ B prêts ; C attend A, mais c0 n'attend rien (un « prêt » dans un groupe qui attend).
const TICKETS = [
  { id: 'a1', name: 'Un', blockedBy: [] },
  { id: 'b1', name: 'Deux', blockedBy: [] },
  { id: 'c0', name: 'Trois', blockedBy: [] },
  { id: 'c1', name: 'Quatre', blockedBy: ['a1'] },
]
const GROUPS = [
  { id: 'A', name: 'Worker', tickets: ['a1'], files: ['worker'], continuesHere: true },
  { id: 'B', name: 'App', tickets: ['b1'], files: ['app'] },
  { id: 'C', name: 'Suite', tickets: ['c0', 'c1'], files: ['suite'] },
]

const start = async ($: any) => {
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  return $.tool.call({ tool: TOOL, title: 'Lot', tickets: TICKETS, groups: GROUPS } as any)
}

test('un groupe ne se lance qu’en session liée, sur chaque surface', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 70_000_000 })
  mock.store(on)
  engine(on)
  inRepo(on)
  const answer = await start($)
  // Un continuesHere reçu est ignoré, sans erreur.
  expect(JSON.stringify(answer)).not.toMatch(/continuesHere|error/i)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    for (const id of ['A', 'B', 'C']) expect(await ui.find({ key: `launch-group-${id}` })).toBeUndefined()
    expect(await ui.find({ key: 'launch-ready-C' })).toBeUndefined()
    expect(await ui.find({ key: 'launch-parallel' })).toBeUndefined()
    expect(await ui.find({ key: 'next-parallel' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /cette discussion|discussion de découpage|nouvelle discussion/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\/implement-spec/ })).toBeUndefined()
    // Restent : la session liée de chaque groupe prêt, et le lot en sessions liées.
    expect(await ui.find({ key: 'launch-linked-A' })).toBeDefined()
    expect(await ui.find({ key: 'launch-linked-B' })).toBeDefined()
    expect(String((await ui.find({ key: 'launch-parallel-linked' }))?.props.label)).toMatch(/^⇉.A ∥ B en parallèle · sessions liées$/)
    expect(String((await ui.find({ key: 'next-parallel-linked' }))?.props.label)).toMatch(/^⇉.A ∥ B en parallèle · sessions liées$/)
    await ui.unmount()
  }
})

test('« Ensuite » propose la session liée du prochain groupe, jamais un lancement ici, même pour un ancien continuesHere', async ($, on) => {
  mock.clock(on, { now: 71_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  // Trois groupes qui pilotent le même service : jamais en parallèle.
  const service = ['Service']
  await $.tool.call({
    tool: TOOL,
    title: 'Lot',
    tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }],
    groups: [
      { id: 'A', name: 'Un', tickets: ['a1'], resources: service, continuesHere: true },
      { id: 'B', name: 'Deux', tickets: ['b1'], resources: service },
    ],
  } as any)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect((await ui.find({ key: 'next-linked-A' }))?.props).toMatchObject({ label: expect.stringMatching(/^↗.Groupe A · session liée$/), variant: 'primary' })
    expect(await ui.find({ key: 'next-group-A' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Lancer A ici/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('les tickets choisis à la main gardent /implement, sans lancement en parallèle', async ($, on) => {
  mock.clock(on, { now: 72_000_000 })
  mock.store(on)
  const filled = engine(on)
  inRepo(on)
  await start($)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'pick-b1' })
  await ui.press({ key: 'launch-picks' })
  expect(filled.at(-1)).toMatch(/^\/mattpocock-skills:implement Tickets à traiter, un par un et dans cet ordre : 1\) b1 — Deux$/)
  await ui.press({ key: 'pick-b1' })
  expect(await ui.find({ key: 'launch-picks-parallel' })).toBeUndefined()
  await ui.unmount()
})

test('la consigne de /to-tickets : un groupe se fait en session liée, sans groupe qui continue ici', async ($, on) => {
  mock.clock(on, { now: 73_000_000 })
  mock.store(on)
  engine(on)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text
  expect(note).toMatch(/"groups": \[\{"id": "A"/)
  expect(note).not.toMatch(/continuesHere/)
  expect(note).not.toMatch(/context of this discussion/)
  expect(note).toMatch(/Each group runs in a linked session, never in this discussion/)
  expect(note).not.toMatch(/\/implement-spec, one subagent per group/)
})

test('les textes envoyés à Claude ne citent plus « ▶ Lancer » pour le groupe suivant', async ($, on) => {
  mock.clock(on, { now: 74_000_000 })
  mock.store(on)
  engine(on)
  const note = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text
  expect(note).toContain('the next group, which the user launches from the dashboard, in its linked session (↗ Session liée)')
  expect(note).not.toMatch(/▶ Lancer/)
  // La réponse qui refuse de clore la phase tant que des tickets restent ouverts.
  await $.tool.call({ tool: TOOL, title: 'Lot', tickets: TICKETS, groups: GROUPS } as any)
  const answer = JSON.stringify(await $.tool.call({ tool: TOOL, complete: true } as any))
  expect(answer).toContain('in its linked session (↗ Session liée)')
  expect(answer).not.toMatch(/▶ Lancer/)
})

test('« ↗ Session liée » : la règle d’effort propose xhigh pour une tâche de jugement, sans jamais le choisir seule', async ($, on) => {
  mock.clock(on, { now: 75_000_000 })
  mock.store(on)
  const filled = engine(on)
  inRepo(on)
  await start($)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'launch-linked-B' })
  const text = filled.at(-1)!
  // medium et high ne changent pas.
  expect(text).toContain('Effort de la session (<effort>) : medium par défaut ; high si le groupe a un ticket qui touche une zone sensible')
  expect(text).toContain("Dis-moi en une ligne l'effort choisi et pourquoi.")
  // La suggestion : les deux sortes de tâche de jugement, jamais pour une tâche d'exécution.
  expect(text).toContain('tâche de jugement')
  expect(text).toContain('jugement sur un existant')
  expect(text).toContain('objectif ouvert')
  expect(text).toContain("Jamais pour une tâche d'exécution")
  expect(text).toContain('grosse migration')
  expect(text).toContain('sensible mais local, il reste en high')
  // Une question à boutons, jamais xhigh choisi seul.
  expect(text).toContain('question à boutons « xhigh (Recommandé) / high »')
  expect(text).toContain('Tu ne choisis jamais xhigh toi-même')
  // Si xhigh est retenu : session autonome, plafond de l'app, rappel de redescendre.
  expect(text).toMatch(/session autonome : elle applique la section « Session autonome » de la procédure\. Ici : /)
  expect(text).toContain('start_session ne donne jamais à une session un effort plus haut que celui de cette discussion')
  expect(text).toContain("que je peux redescendre l'effort de cette discussion")
  // Le lancement passe toujours l'effort choisi.
  expect(text).toContain('effort "<effort>"')
  expect(text).toContain('--effort <effort>')
  await ui.unmount()
})

/**
 * Un parcours à groupes prêts dans une discussion démarrée, avec son registre des agents : une
 * réponse du modèle à l'effort `effort` (aucune si absent) le relève sur la piste de la discussion.
 */
const xhighWorld = async ($: any, on: any, effort?: string) => {
  mock.clock(on, { now: 76_000_000 })
  mock.store(on)
  const filled = engine(on)
  inRepo(on)
  on('session.id', () => ({ value: 'session-X' }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('turn.step', stoppedStep(stepUsage('claude-opus-5-5')))
  const toasts: string[] = []
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  if (effort) await playStep($, { turnId: 't1', model: 'claude-opus-5-5', effort })
  await start($)
  return { filled, toasts }
}

const XHIGH_TOAST = 'Session liée pour B en xhigh : la demande est dans le prompt, Entrée pour la lancer'

test('« ↗ xhigh » suit « ↗ Session liée » sur chaque groupe prêt, jamais sur le lot parallèle', { timeoutMs: 15000 }, async ($, on) => {
  await xhighWorld($, on)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    for (const id of ['A', 'B']) {
      expect((await ui.find({ key: `launch-xhigh-${id}` }))?.props).toMatchObject({ label: expect.stringMatching(/^↗.xhigh$/), plain: true, dimColor: true })
    }
    // C attend A : ni session liée, ni xhigh.
    expect(await ui.find({ key: 'launch-xhigh-C' })).toBeUndefined()
    // « Prochaine étape » propose le lot parallèle : pas de xhigh.
    expect(await ui.find({ key: 'next-parallel-linked' })).toBeDefined()
    for (const id of ['A', 'B']) expect(await ui.find({ key: `next-xhigh-${id}` })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /« ↗ xhigh » : la même session, lancée en xhigh/ })).toBeDefined()
    await ui.unmount()
  }
})

test('« Prochaine étape » : « ↗ xhigh » suit la session liée du groupe proposé', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 77_000_000 })
  mock.store(on)
  const filled = engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  const service = ['Service']
  await $.tool.call({
    tool: TOOL,
    title: 'Lot',
    tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux' }],
    groups: [
      { id: 'A', name: 'Un', tickets: ['a1'], resources: service },
      { id: 'B', name: 'Deux', tickets: ['b1'], resources: service },
    ],
  } as any)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await ui.find({ key: 'next-linked-A' })).toBeDefined()
    expect((await ui.find({ key: 'next-xhigh-A' }))?.props).toMatchObject({ label: expect.stringMatching(/^↗.xhigh$/), plain: true, dimColor: true })
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'next-xhigh-A' })
  expect(filled.at(-1)).toContain('Effort de la session (<effort>) : xhigh, choisi par moi au tableau de bord')
  await ui.unmount()
})

test('l’appui sur « ↗ xhigh » : xhigh imposé sans suggestion, session autonome, plafond avec l’effort relevé ; avertissement sur desktop', { timeoutMs: 15000 }, async ($, on) => {
  const { filled, toasts } = await xhighWorld($, on, 'high')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'launch-xhigh-B' })
  const text = filled.at(-1)!
  expect(text).toMatch(/^Confie ce groupe à une session liée, pour le parcours « Lot » : Groupe B \(App\)/)
  expect(text).toContain("Effort de la session (<effort>) : xhigh, choisi par moi au tableau de bord ; ne me pose aucune question sur l'effort.")
  expect(text).not.toContain('Tu ne choisis jamais xhigh toi-même')
  expect(text).not.toContain('medium par défaut')
  expect(text).toMatch(/et qu'elle est une session autonome : elle applique la section « Session autonome » de la procédure\. Ici : /)
  expect(text).toContain("start_session ne donne jamais à une session un effort plus haut que celui de cette discussion (son effort relevé à l'écriture de cette demande : high ; je l'ai peut-être monté depuis, avant Entrée)")
  expect(text).toContain("que je peux redescendre l'effort de cette discussion")
  expect(text).toContain('effort "<effort>"')
  expect(text).toContain('--effort <effort>')
  // Même chemin que « ↗ Session liée » : le groupe attend son lancement.
  expect(await ui.find({ key: 'group-linked-cancel-B' })).toBeDefined()
  expect(toasts.at(-1)).toBe(`${XHIGH_TOAST}. Avant Entrée, passe cette discussion en xhigh (elle est en high) : l'app ne donne jamais à la session un effort plus haut`)
  await ui.unmount()
})

test('pas d’avertissement au terminal, même avec un effort relevé high',{ timeoutMs: 15000 }, async ($, on) => {
  const { toasts } = await xhighWorld($, on, 'high')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-xhigh-B' })
  expect(toasts.at(-1)).toBe(XHIGH_TOAST)
  await ui.unmount()
})

test('pas d’avertissement sur desktop sans effort relevé', { timeoutMs: 15000 }, async ($, on) => {
  const { filled, toasts } = await xhighWorld($, on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'launch-xhigh-B' })
  expect(toasts.at(-1)).toBe(XHIGH_TOAST)
  expect(filled.at(-1)).not.toContain('son effort relevé')
  await ui.unmount()
})

test('pas d’avertissement sur desktop avec un effort relevé xhigh', { timeoutMs: 15000 }, async ($, on) => {
  const { filled, toasts } = await xhighWorld($, on, 'xhigh')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'launch-xhigh-B' })
  expect(toasts.at(-1)).toBe(XHIGH_TOAST)
  expect(filled.at(-1)).toContain("(son effort relevé à l'écriture de cette demande : xhigh ;")
  await ui.unmount()
})
