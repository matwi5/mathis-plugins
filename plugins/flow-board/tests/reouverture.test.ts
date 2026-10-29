import { expect, mock, test } from 'claude-code/testing'

import { reopenText } from '../hooks/closing.ts'
import { newRun } from '../hooks/model.ts'
import type { Closing } from '../types'

// Rouvrir une session liée fermée : le bouton « ↺ Rouvrir » copie une commande qui recrée son
// worktree sur sa branche gardée, sans rien forcer, puis reprend sa conversation dans ce worktree ;
// une session de l'app se désarchive dans l'app. Le bouton ne change aucune donnée enregistrée :
// l'état « closed » ne recule jamais.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const START = 'mcp__ccd_session__start_session'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const ROOT = '/Users/m/proj'
const UUID = '178bd61c-0416-4d88-8317-cc583d9f0d47'
const WT = `${ROOT}/.claude/worktrees/groupe-boutique-A`
const run = { ...newRun('implement', 1_000, 'Boutique') }
const group = { kind: 'group', id: 'A', name: 'Alpha' } as const
const closed = (more: Partial<Closing> = {}): Closing => ({ state: 'closed', at: 5_000, sessionId: UUID, branch: 'worktree-groupe-boutique-A', worktree: WT, ...more })
// La branche vérifiée d'abord (série 14, Q2.2) : un nom qui donnerait une HEAD détachée ne crée rien.
const SHOW = `git -C '${ROOT}' show-ref --verify 'refs/heads/worktree-groupe-boutique-A'`
const COMMAND = `${SHOW} && git -C '${ROOT}' worktree add '${WT}' 'worktree-groupe-boutique-A' && cd '${WT}' && claude --resume '${UUID}'`

test('session du CLI : une commande en une ligne, worktree recréé sans rien forcer, puis la conversation reprise dedans', () => {
  const out = reopenText({ run, target: group, closing: closed(), root: ROOT })!
  expect(out.text).toBe(COMMAND)
  expect(out.isApp).toBe(false)
  // Rien qui force : git worktree add échoue sans rien toucher si le chemin existe ou si la branche manque.
  for (const forced of [' -f', ' -B', '--force', '--discard-unpushed']) expect(out.text).not.toContain(forced)
  // Chaque valeur est citée pour le shell : un dépôt au nom espacé passe, cité.
  const spacedRoot = '/Users/m/mes projets'
  const inSpaced = `${spacedRoot}/.claude/worktrees/groupe-boutique-a`
  expect(reopenText({ run, target: group, closing: closed({ worktree: inSpaced }), root: spacedRoot })!.text).toBe(
    `git -C '${spacedRoot}' show-ref --verify 'refs/heads/worktree-groupe-boutique-A' && git -C '${spacedRoot}' worktree add '${inSpaced}' 'worktree-groupe-boutique-A' && cd '${inSpaced}' && claude --resume '${UUID}'`,
  )
  // Le nom du worktree, lui, n'a que de l'ASCII (série 14, Q2.1) : ni espace, ni accent, ni apostrophe.
  // Le signe kelvin (U+212A) devient « k » en minuscules : le nom se juge tel qu'écrit.
  for (const name of ['autre groupe', "l'autre", 'équipe', '-x', '.x', 'groupe-K']) {
    expect(reopenText({ run, target: group, closing: closed({ worktree: `${ROOT}/.claude/worktrees/${name}` }), root: ROOT })).toBeNull()
  }
  // Une valeur du tableau de bord qui n'est pas une chaîne ne fait rien tomber : pas de bouton.
  for (const worktree of [42, { path: WT }, ['x']]) {
    expect(reopenText({ run, target: group, closing: closed({ worktree: worktree as unknown as string }), root: ROOT })).toBeNull()
  }
})

test('pas de commande sans sessionId sûr, sans fermeture notée « closed », ni sans branche et worktree sûrs', () => {
  expect(reopenText({ run, target: group, closing: closed({ sessionId: undefined }), root: ROOT })).toBeNull()
  expect(reopenText({ run, target: group, closing: undefined, root: ROOT })).toBeNull()
  for (const state of ['app', 'stopped'] as const) expect(reopenText({ run, target: group, closing: closed({ state }), root: ROOT })).toBeNull()
  // Une donnée lue du tableau de bord (un fichier partagé) se revérifie : rien de hors forme n'entre dans la commande.
  for (const bad of [
    { sessionId: '$(x)' },
    { sessionId: '-rf' },
    { branch: 'a;b' },
    { branch: undefined },
    // Une référence entière ou HEAD : git worktree add en ferait une HEAD détachée.
    { branch: 'refs/heads/worktree-groupe-boutique-A' },
    { branch: 'HEAD' },
    { worktree: '/tmp/x' },
    { worktree: undefined },
    // Une apostrophe typographique ferme aussi une chaîne de PowerShell.
    { worktree: `${ROOT}/.claude/worktrees/x’; Remove-Item ~; ’` },
  ]) {
    expect(reopenText({ run, target: group, closing: closed(bad), root: ROOT })).toBeNull()
  }
  // git -C vise le dépôt de la racine du projet, pas un préfixe tiré du chemin noté.
  expect(reopenText({ run, target: group, closing: closed({ worktree: `/users/m/proj/.claude/worktrees/groupe-boutique-A` }), root: ROOT })!.text).toMatch(/^git -C '\/Users\/m\/proj' show-ref .* && git -C '\/Users\/m\/proj' worktree add /)
})

const ADD = `${SHOW} && git -C '${ROOT}' worktree add '${WT}' 'worktree-groupe-boutique-A'`
const UNARCHIVE = 'Puis désarchive dans l’app Claude Desktop la session dont le titre commence par « Boutique > Groupe A · » : elle reprend dans ce worktree.'

test('session de l’app : seule la commande qui recrée le worktree se copie ; la consigne de la désarchiver va dans le toast', () => {
  const out = reopenText({ run, target: group, closing: closed(), session: 'local_A42', root: ROOT })!
  expect(out.isApp).toBe(true)
  // Rien que la commande (série 14, Q2.3) : le titre du parcours, non cité, n'entre jamais dans le presse-papiers.
  expect(out.text).toBe(ADD)
  expect(out.text).not.toContain('Boutique')
  // L'app reprend la conversation elle-même : pas de claude --resume, quel que soit le sessionId noté.
  expect(out.text).not.toContain('claude --resume')
  expect(reopenText({ run, target: group, closing: closed({ sessionId: 'local_A42' }), root: ROOT })!.text).toBe(ADD)
  expect(out.copied).toBe(
    `Commande copiée, à coller dans un terminal : elle recrée le worktree de la session sur sa branche gardée. ${UNARCHIVE} Le worktree recréé n’a pas les copies (.worktreeinclude) ni les liens que le lancement y avait mis. Une session rouverte ne se referme pas d’office : demande à Claude de la refermer.`,
  )
  expect(out.uncopied).toBe(`Copie impossible : recopie cette commande dans un terminal : ${ADD}. ${UNARCHIVE}`)
  // Sans branche ni worktree sûrs, rien à copier : pas de bouton.
  expect(reopenText({ run, target: group, closing: closed({ branch: undefined, sessionId: 'local_A42' }), root: ROOT })).toBeNull()
  // La session des pistes : son titre à elle, dans le toast.
  expect(reopenText({ run, target: { kind: 'items', skill: 'retro' }, closing: closed(), session: 'local_P1', root: ROOT })!.copied).toContain('« Boutique > Pistes · »')
})

test('claude --resume ne reprend qu’un sessionId complet : un id court du CLI ne donne pas de commande', () => {
  expect(reopenText({ run, target: group, closing: closed({ sessionId: 'abcd1234' }), root: ROOT })).toBeNull()
})

test('un chemin Windows : la commande pour PowerShell, sans « && », claude --resume seulement si Set-Location a réussi, et le toast le dit', () => {
  const wt = 'C:/proj/.claude/worktrees/groupe-boutique-A'
  const out = reopenText({ run, target: group, closing: closed({ worktree: wt }), root: 'C:\\proj' })!
  expect(out.text).toBe(
    `git -C 'C:/proj' show-ref --verify 'refs/heads/worktree-groupe-boutique-A'; if ($?) { git -C 'C:/proj' worktree add '${wt}' 'worktree-groupe-boutique-A'; if ($?) { Set-Location -LiteralPath '${wt}'; if ($?) { claude --resume '${UUID}' } } }`,
  )
  // L'app sous Windows : la même vérification, puis la recréation seule.
  expect(reopenText({ run, target: group, closing: closed({ worktree: wt }), session: 'local_A42', root: 'C:\\proj' })!.text).toBe(
    `git -C 'C:/proj' show-ref --verify 'refs/heads/worktree-groupe-boutique-A'; if ($?) { git -C 'C:/proj' worktree add '${wt}' 'worktree-groupe-boutique-A' }`,
  )
  expect(out.text).not.toContain('&&')
  expect(out.copied).toBe(
    'Commande copiée, à coller dans PowerShell : elle recrée le worktree de la session sur sa branche gardée, puis reprend sa conversation. Le worktree recréé n’a pas les copies (.worktreeinclude) ni les liens que le lancement y avait mis. Une session rouverte ne se referme pas d’office : demande à Claude de la refermer.',
  )
  expect(out.uncopied).toBe(`Copie impossible : recopie cette commande dans PowerShell : ${out.text}`)
})

const world = (on: any, start: string) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'main' }))
  on('session.root', () => ({ value: ROOT }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('tool.call', { tool: START }, () => ({ result: { text: `Started session ${start}.` } }))
  on('prompt.fill', () => ({ isFilled: true }))
  const copies: string[] = []
  let canCopy = true
  on('ui.copy', (_$: unknown, e: { text: string }) => {
    copies.push(e.text)
    return { value: { isCopied: canCopy } }
  })
  const toasts: string[] = []
  const toastMs: (number | undefined)[] = []
  on('ui.toast', (_$: unknown, e: { text: string; timeoutMs?: number }) => {
    toasts.push(e.text)
    toastMs.push(e.timeoutMs)
    return { value: undefined }
  })
  return { mem, copies, toasts, toastMs, noCopy: () => (canCopy = false) }
}

const LOT = {
  tickets: [
    { id: 'a1', name: 'Code', files: ['a'] },
    { id: 'b1', name: 'Doc', files: ['b'] },
  ],
  groups: [
    { id: 'A', name: 'Alpha', tickets: ['a1'], files: ['a'] },
    { id: 'B', name: 'Bêta', tickets: ['b1'], files: ['b'] },
  ],
}

/** Le groupe A confié, lancé (session `start`), rendu, relu, sécurité jugée inutile. */
const returnedA = async ($: any, clock: any, start: string) => {
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  await $.tool.call({ tool: START, title: `Boutique > Groupe A · Alpha (${start})` } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }], returned: ['A'], reviewed: ['A'], security: { group: 'A', advised: false, why: 'texte' } } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
}
const mount = async ($: any, clock: any, surface: 'terminal' | 'desktop') => {
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  return $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
}

test('le bouton « ↺ Rouvrir » : absent sans sessionId, présent une fois fermé avec lui ; il copie la commande et le dit, sans rien changer', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 93_000_000 })
  const w = world(on, 'abcd1234')
  await returnedA($, clock, 'abcd1234')
  // Arrêtée, puis fermée sans sessionId : pas de bouton.
  await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'stopped', why: '.env' }] } as any)
  let u = await mount($, clock, 'terminal')
  expect(await u.find({ key: 'close-linked-A' })).toBeDefined()
  expect(await u.find({ key: 'reopen-A' })).toBeUndefined()
  await u.unmount()
  await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'closed' }] } as any)
  u = await mount($, clock, 'terminal')
  expect(await u.find({ type: 'Text', text: /session et worktree fermés/ })).toBeDefined()
  expect(await u.find({ key: 'reopen-A' })).toBeUndefined()
  await u.unmount()
  // Fermée avec son sessionId, sa branche et son worktree : le bouton, sur chaque surface.
  await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'closed', sessionId: UUID, branch: 'worktree-groupe-boutique-A', worktree: WT }] } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    u = await mount($, clock, surface)
    expect(String((await u.find({ key: 'reopen-A' }))?.props?.label)).toMatch(/^↺.Rouvrir$/)
    await u.unmount()
  }
  const before = JSON.stringify(w.mem)
  u = await mount($, clock, 'terminal')
  await u.press({ key: 'reopen-A' })
  await u.unmount()
  expect(w.copies).toEqual([COMMAND])
  // Le toast dit ce qu'il reste à faire : il reste 30 s, pas les 4 s par défaut.
  expect(w.toastMs.at(-1)).toBe(30_000)
  expect(w.toasts.at(-1)).toBe(
    'Commande copiée, à coller dans un terminal : elle recrée le worktree de la session sur sa branche gardée, puis reprend sa conversation. Le worktree recréé n’a pas les copies (.worktreeinclude) ni les liens que le lancement y avait mis. Une session rouverte ne se referme pas d’office : demande à Claude de la refermer.',
  )
  // Le bouton ne change aucune donnée enregistrée.
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  expect(JSON.stringify(w.mem)).toBe(before)
  // Sans copie possible (un terminal sans presse-papiers), la commande s'affiche en clair pour être recopiée.
  w.noCopy()
  u = await mount($, clock, 'terminal')
  await u.press({ key: 'reopen-A' })
  await u.unmount()
  expect(w.toasts.at(-1)).toBe(`Copie impossible : recopie cette commande dans un terminal : ${COMMAND}`)
})

test('session de l’app : le bouton copie la seule commande qui recrée son worktree ; le toast dit de la désarchiver', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 93_000_000 })
  const w = world(on, 'local_A42')
  await returnedA($, clock, 'local_A42')
  await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'closed', sessionId: UUID, branch: 'worktree-groupe-boutique-A', worktree: WT }] } as any)
  const u = await mount($, clock, 'desktop')
  await u.press({ key: 'reopen-A' })
  await u.unmount()
  expect(w.copies.at(-1)).toBe(ADD)
  expect(w.toasts.at(-1)).toBe(
    `Commande copiée, à coller dans un terminal : elle recrée le worktree de la session sur sa branche gardée. ${UNARCHIVE} Le worktree recréé n’a pas les copies (.worktreeinclude) ni les liens que le lancement y avait mis. Une session rouverte ne se referme pas d’office : demande à Claude de la refermer.`,
  )
})

test('la session des pistes d’une rétro, fermée avec son sessionId : « ↺ Rouvrir » sur sa ligne, qui copie la commande et dit de la désarchiver', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 90_000_000 })
  const w = world(on, 'local_abc123')
  const PISTES = [
    { id: 'p1', label: 'Contrôles', status: 'todo' },
    { id: 'p2', label: 'Accès', status: 'todo' },
  ]
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  await $.tool.call({ tool: TOOL, items: PISTES, step: 'present' } as any)
  let u = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await u.press({ key: 'item-pick-p1' })
  await u.press({ key: 'items-linked' })
  await u.unmount()
  await $.tool.call({ tool: START, title: 'Rétro > Pistes · contrôles' } as any)
  await $.tool.call({ tool: TOOL, items: [{ ...PISTES[0], status: 'done' }, PISTES[1]] } as any)
  // Fermée sans sessionId : pas de bouton ; avec lui : le bouton.
  await $.tool.call({ tool: TOOL, closed: [{ items: 'retro', state: 'closed' }] } as any)
  u = await mount($, clock, 'terminal')
  expect(await u.find({ type: 'Text', text: /session et worktree fermés/ })).toBeDefined()
  expect(await u.find({ key: 'reopen-items' })).toBeUndefined()
  await u.unmount()
  const wt = `${ROOT}/.claude/worktrees/pistes-1`
  await $.tool.call({ tool: TOOL, closed: [{ items: 'retro', state: 'closed', sessionId: UUID, branch: 'worktree-pistes-1', worktree: wt }] } as any)
  u = await mount($, clock, 'terminal')
  await u.press({ key: 'reopen-items' })
  await u.unmount()
  expect(w.copies.at(-1)).toBe(
    `git -C '${ROOT}' show-ref --verify 'refs/heads/worktree-pistes-1' && git -C '${ROOT}' worktree add '${ROOT}/.claude/worktrees/pistes-1' 'worktree-pistes-1'`,
  )
  expect(w.toasts.at(-1)).toMatch(/Puis désarchive dans l’app Claude Desktop la session dont le titre commence par « .*Pistes · » : elle reprend dans ce worktree\./)
})

test('le bouton survit à un champ hors forme envoyé ensuite : le champ refusé ne remplace pas celui noté', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 93_000_000 })
  const w = world(on, 'abcd1234')
  await returnedA($, clock, 'abcd1234')
  await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'closed', sessionId: UUID, branch: 'worktree-groupe-boutique-A', worktree: WT }] } as any)
  const answer = JSON.stringify(await $.tool.call({ tool: TOOL, closed: [{ group: 'A', state: 'closed', branch: 'x; rm -rf ~' }] } as any))
  expect(answer).toContain('field refused for group A: branch')
  const u = await mount($, clock, 'terminal')
  await u.press({ key: 'reopen-A' })
  await u.unmount()
  expect(w.copies.at(-1)).toBe(COMMAND)
})
