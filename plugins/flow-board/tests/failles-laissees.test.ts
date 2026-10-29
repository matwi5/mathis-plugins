import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyRelay, applyReport, applySkill, emptyBoard, isSecuritySettled, mergeBoards, newRun, relayForGroup, startLinkedGroups } from '../hooks/model.ts'
import type { Board } from '../types'

// Les failles qu'une revue de sécurité a gardées et que la personne décide de ne pas corriger
// (« laissées », `dismissed`) : la sécurité d'un groupe est tranchée quand chacune est corrigée ou
// laissée. Invariant : le compte des failles laissées n'est jamais perdu ni remis à zéro par un
// retour, un renvoi des groupes, une reprise ou une fusion de copies ; seul un nouvel envoi de
// `security` pour ce groupe le change.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const KEY = 'board:'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const LOT = {
  tickets: [
    { id: 'a1', name: 'Un', files: ['a'] },
    { id: 'b1', name: 'Deux', files: ['b'] },
  ],
  groups: [
    { id: 'A', name: 'Alpha', tickets: ['a1'], files: ['a'] },
    { id: 'B', name: 'Bêta', tickets: ['b1'], files: ['b'] },
  ],
}

/** Un parcours actif dans la discussion `session`, après un appel de l'outil `flow`. */
const boardWith = (input: Record<string, unknown>, session = 's'): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: session }
  const board: Board = { ...emptyBoard('', 'p'), session, deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}
const groupOf = (board: Board, id: string) => activeRun(board)!.groups!.find(g => g.id === id)!

/** Le groupe A fait, relu ici, revue de sécurité lancée : 2 failles gardées, 1 corrigée. */
const reviewedA = (): Board => {
  let b = boardWith(LOT)
  b = applyReport(b, { set: [{ id: 'a1', status: 'done' }], reviewed: ['A'] }, 3_000).board
  return applyReport(b, { security: { group: 'A', advised: true, why: 'chemins', findings: 2, fixed: 1 } }, 4_000).board
}

test('« dismissed » est gardé à côté de « fixed », dit dans la réponse et le journal ; un envoi sans lui ne l’efface pas', () => {
  const before = reviewedA()
  expect(isSecuritySettled(groupOf(before, 'A').security)).toBe(false)
  const out = applyReport(before, { security: { group: 'A', dismissed: 1 } }, 5_000)
  expect(groupOf(out.board, 'A').security).toMatchObject({ findings: 2, fixed: 1, dismissed: 1 })
  expect(isSecuritySettled(groupOf(out.board, 'A').security)).toBe(true)
  expect(out.text).toContain('security of group A: 2 findings, 1 fixed, 1 dismissed')
  expect(activeRun(out.board)!.log[0]).toMatchObject({ text: 'Sécurité du groupe A : 1 laissée', tone: 'ok' })
  // Un nouvel envoi des comptes sans « dismissed » le garde ; seul un envoi de « dismissed » le change.
  const again = applyReport(out.board, { security: { group: 'A', findings: 2, fixed: 1 } }, 6_000).board
  expect(groupOf(again, 'A').security).toMatchObject({ findings: 2, fixed: 1, dismissed: 1 })
  expect(isSecuritySettled(groupOf(again, 'A').security)).toBe(true)
  // Un envoi de « fixed » seul garde les failles : il ne les remet pas à zéro.
  const fixedOnly = applyReport(again, { security: { group: 'A', fixed: 2 } }, 6_500).board
  expect(groupOf(fixedOnly, 'A').security).toMatchObject({ findings: 2, fixed: 2, dismissed: 1 })
  const zero = applyReport(again, { security: { group: 'A', dismissed: 0 } }, 7_000).board
  expect(groupOf(zero, 'A').security?.dismissed).toBe(0)
  // Un nombre invalide est ignoré.
  expect(groupOf(applyReport(out.board, { security: { group: 'A', dismissed: -2 } }, 7_000).board, 'A').security?.dismissed).toBe(1)
})

test('la sécurité tranchée : « inutile », ou revue lancée avec findings ≤ fixed + dismissed ; sinon non', () => {
  expect(isSecuritySettled(undefined)).toBe(false)
  expect(isSecuritySettled({ isAdvised: false })).toBe(true)
  expect(isSecuritySettled({ isAdvised: true })).toBe(false)
  // Lancée sans comptes : pas encore tranchée.
  expect(isSecuritySettled({ isAdvised: true, ranAt: 1 })).toBe(false)
  expect(isSecuritySettled({ isAdvised: true, ranAt: 1, findings: 0, fixed: 0 })).toBe(true)
  expect(isSecuritySettled({ isAdvised: true, ranAt: 1, findings: 3, fixed: 1, dismissed: 2 })).toBe(true)
  expect(isSecuritySettled({ isAdvised: true, ranAt: 1, findings: 3, fixed: 1, dismissed: 1 })).toBe(false)
  // Jugée inutile mais lancée quand même : ses failles comptent.
  expect(isSecuritySettled({ isAdvised: false, ranAt: 1, findings: 1, fixed: 0 })).toBe(false)
})

test('un /security-review lancé pour un autre groupe ne fait pas perdre « tranchée » à un groupe jugé inutile', () => {
  let b = boardWith(LOT)
  b = applyReport(b, { set: [{ id: 'a1', status: 'done' }, { id: 'b1', status: 'done' }], reviewed: ['A', 'B'] }, 3_000).board
  b = applyReport(b, { security: { group: 'A', advised: false, why: 'texte seul' } }, 3_100).board
  b = applyReport(b, { security: { group: 'B', advised: true, why: 'chemins' } }, 3_200).board
  // La commande pose ranAt sur les groupes finis qui n'en ont pas, A compris.
  b = applySkill(b, 'security-review', { now: 3_300, isMain: true })!.board
  b = applyReport(b, { security: { group: 'B', findings: 0, fixed: 0 } }, 3_400).board
  expect(groupOf(b, 'A').security?.ranAt).toBeDefined()
  expect(isSecuritySettled(groupOf(b, 'A').security)).toBe(true)
  expect(isSecuritySettled(groupOf(b, 'B').security)).toBe(true)
})

test('sans groupes, « dismissed » vaut pour le lot entier', () => {
  let b = boardWith({ tickets: LOT.tickets })
  b = applyReport(b, { security: { findings: 1, fixed: 0 } }, 3_000).board
  const out = applyReport(b, { security: { dismissed: 1 } }, 4_000)
  expect(activeRun(out.board)!.security).toMatchObject({ findings: 1, fixed: 0, dismissed: 1 })
  expect(out.text).toContain('security of the lot: 1 finding, 0 fixed, 1 dismissed')
})

test('le compte des failles laissées survit au renvoi des groupes et à une fusion face à une copie plus ancienne', () => {
  const before = reviewedA()
  const kept = applyReport(before, { security: { group: 'A', dismissed: 1 } }, 5_000).board
  // Le plan renvoyé.
  const resent = applyReport(kept, { groups: LOT.groups }, 6_000).board
  expect(groupOf(resent, 'A').security?.dismissed).toBe(1)
  // La fusion avec la copie du même parcours d'avant l'envoi : la plus récente l'emporte, locale ou stockée.
  const runId = activeRun(resent)!.id
  expect(activeRun(before)!.id).toBe(runId)
  const runOf = (b: Board) => b.runs.find(r => r.id === runId)!.groups!.find(g => g.id === 'A')!
  expect(runOf(mergeBoards(resent, before)).security?.dismissed).toBe(1)
  const elsewhere = (b: Board): Board => ({ ...b, session: 'autre', activeId: null })
  expect(runOf(mergeBoards(elsewhere(before), resent)).security?.dismissed).toBe(1)
})

test('une session liée relaie « dismissed » ; au retour, c’est une proposition : seul un envoi de l’orchestrateur tranche', () => {
  const sent = startLinkedGroups(boardWith(LOT), ['B'], 5_000)!.board
  const runId = activeRun(sent)!.id
  // La session déléguée l'envoie : il part au relais.
  const delegated = applyReport(sent, { delegate: runId, group: 'B' }, 5_100).board
  const told = applyReport(delegated, { security: { group: 'B', findings: 2, fixed: 1, dismissed: 1 } }, 5_200)
  expect(told.text).toContain('the security review')
  let relay = applyRelay(undefined, runId, 'fille', { kind: 'start', group: 'B' }, 5_500)!
  relay = applyRelay(relay, runId, 'fille', { kind: 'counts', security: { advised: true, findings: 2, fixed: 1, dismissed: 1 } }, 6_000)!
  expect(relayForGroup(relay, groupOf(sent, 'B'))?.security).toMatchObject({ findings: 2, fixed: 1, dismissed: 1 })
  const returned = applyReport(sent, { set: [{ id: 'b1', status: 'done' }], returned: ['B'], reviewed: ['B'] }, 7_000, { relay })
  const back = returned.board
  expect(groupOf(back, 'B').security).toMatchObject({ findings: 2, fixed: 1, proposedDismissed: 1 })
  expect(groupOf(back, 'B').security?.dismissed).toBeUndefined()
  expect(isSecuritySettled(groupOf(back, 'B').security)).toBe(false)
  // La réponse dit la proposition : à confirmer avec la personne, puis à envoyer d'ici.
  expect(applyReport(back, { note: 'point' }, 7_100).text).toContain('its linked session proposes 1 dismissed: confirm with the user, then send {"security": {"group": "B", "dismissed": <n>}}')
  // L'envoi de l'orchestrateur tranche, et la proposition tombe.
  const confirmed = applyReport(back, { security: { group: 'B', dismissed: 1 } }, 7_200).board
  expect(groupOf(confirmed, 'B').security).toMatchObject({ findings: 2, fixed: 1, dismissed: 1 })
  expect(groupOf(confirmed, 'B').security?.proposedDismissed).toBeUndefined()
  expect(isSecuritySettled(groupOf(confirmed, 'B').security)).toBe(true)
  // Un « dismissed » d'ici avant le retour reste ; le relayé n'est qu'une proposition à côté.
  const both = applyReport(sent, { security: { group: 'B', findings: 2, fixed: 1, dismissed: 0 } }, 6_500).board
  expect(groupOf(applyReport(both, { set: [{ id: 'b1', status: 'done' }], returned: ['B'] }, 7_000, { relay }).board, 'B').security).toMatchObject({ findings: 2, fixed: 1, dismissed: 0, proposedDismissed: 1 })
})

test('au relais, une revue suivante avec d’autres failles et sans « dismissed » fait tomber l’ancienne proposition', () => {
  const sent = startLinkedGroups(boardWith(LOT), ['B'], 5_000)!.board
  const runId = activeRun(sent)!.id
  let relay = applyRelay(undefined, runId, 'f', { kind: 'start', group: 'B' }, 5_500)!
  relay = applyRelay(relay, runId, 'f', { kind: 'counts', security: { findings: 3, fixed: 1, dismissed: 2 } }, 6_000)!
  relay = applyRelay(relay, runId, 'f2', { kind: 'start', group: 'B' }, 6_500)!
  relay = applyRelay(relay, runId, 'f2', { kind: 'counts', security: { findings: 5, fixed: 2 } }, 7_000)!
  expect(relayForGroup(relay, groupOf(sent, 'B'))?.security?.dismissed).toBeUndefined()
  const back = applyReport(sent, { set: [{ id: 'b1', status: 'done' }], returned: ['B'] }, 8_000, { relay }).board
  expect(groupOf(back, 'B').security?.proposedDismissed).toBeUndefined()
})

test('un envoi qui change « findings » sans « dismissed » remet les failles laissées à 0 ; sans changement, il les garde', () => {
  const kept = applyReport(reviewedA(), { security: { group: 'A', dismissed: 1 } }, 5_000).board
  // Les mêmes failles, renvoyées avec « fixed » à jour : le compte laissé reste.
  expect(groupOf(applyReport(kept, { security: { group: 'A', findings: 2, fixed: 1 } }, 6_000).board, 'A').security).toMatchObject({ findings: 2, fixed: 1, dismissed: 1 })
  // Une nouvelle revue avec d'autres failles : le compte laissé repart de 0.
  const fresh = applyReport(kept, { security: { group: 'A', findings: 3, fixed: 0 } }, 6_000)
  expect(groupOf(fresh.board, 'A').security).toMatchObject({ findings: 3, fixed: 0, dismissed: 0 })
  expect(isSecuritySettled(groupOf(fresh.board, 'A').security)).toBe(false)
  // Avec « dismissed » dans le même envoi, c'est lui qui compte.
  expect(groupOf(applyReport(kept, { security: { group: 'A', findings: 3, fixed: 0, dismissed: 3 } }, 6_000).board, 'A').security).toMatchObject({ dismissed: 3 })
})

test('une session liée redémarrée qui n’envoie que « dismissed » garde les comptes relayés par la précédente', () => {
  const sent = startLinkedGroups(boardWith(LOT), ['B'], 5_000)!.board
  const runId = activeRun(sent)!.id
  let relay = applyRelay(undefined, runId, 'f1', { kind: 'start', group: 'B' }, 5_500)!
  relay = applyRelay(relay, runId, 'f1', { kind: 'counts', security: { advised: true, findings: 2, fixed: 1 } }, 6_000)!
  relay = applyRelay(relay, runId, 'f2', { kind: 'start', group: 'B' }, 6_500)!
  relay = applyRelay(relay, runId, 'f2', { kind: 'counts', security: { dismissed: 1 } }, 7_000)!
  expect(relayForGroup(relay, groupOf(sent, 'B'))).toMatchObject({ securedAt: 6_000, security: { advised: true, findings: 2, fixed: 1, dismissed: 1 } })
  const back = applyReport(sent, { set: [{ id: 'b1', status: 'done' }], returned: ['B'] }, 8_000, { relay }).board
  expect(groupOf(back, 'B').security).toMatchObject({ isAdvised: true, ranAt: 6_000, findings: 2, fixed: 1, proposedDismissed: 1 })
  expect(isSecuritySettled(groupOf(back, 'B').security)).toBe(false)
})

test('un « dismissed » envoyé sans comptes est gardé et dit, sans trancher la sécurité ; les consignes le font envoyer', async ($, on) => {
  const b = applyReport(boardWith(LOT), { set: [{ id: 'a1', status: 'done' }], reviewed: ['A'] }, 3_000).board
  const out = applyReport(applyReport(b, { security: { group: 'A', advised: true } }, 3_100).board, { security: { group: 'A', dismissed: 1 } }, 3_200)
  expect(out.text).toContain('security of group A: 1 dismissed, kept, but its review has sent no counts yet')
  expect(activeRun(out.board)!.log[0]).toMatchObject({ text: 'Sécurité du groupe A : 1 laissée', tone: 'warn' })
  expect(isSecuritySettled(groupOf(out.board, 'A').security)).toBe(false)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  mock.clock(on, { now: 97_000_000 })
  mock.store(on)
  const coaching = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text
  expect(coaching).toContain('when the user decides to leave a kept finding unfixed, on their confirmation, send {"security": {"group": "<id>", "dismissed": <total of findings left unfixed>}}')
})

test('la ligne de sécurité dit « N laissée(s) » et passe au vert une fois tranchée ; l’état survit à un rechargement', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 90_000_000 })
  const mem: Record<string, unknown> = {}
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, ...LOT } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'a1', status: 'done' }], reviewed: ['A'] } as any)
  await $.tool.call({ tool: TOOL, security: { group: 'A', advised: true, why: 'chemins', findings: 2, fixed: 1 } } as any)
  // Le nombre et son mot sont liés par une espace insécable : \s la prend.
  const colorOf = async (surface: 'desktop' | 'terminal', text: RegExp) => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    const row = await ui.find({ type: 'Text', text })
    const none = await ui.find({ type: 'Text', text: /laissée/ })
    await ui.unmount()
    return { row, color: row?.props?.color as string | undefined, hasDismissed: none !== undefined }
  }
  const open = await colorOf('desktop', /sécurité relue · 2\sconstats · 1 corrigé$/)
  expect(open.row).toBeDefined()
  expect(open.hasDismissed).toBe(false)
  expect((await colorOf('terminal', /sécurité relue · 2\sconstats · 1 corrigé$/)).row).toBeDefined()
  const said = (await $.tool.call({ tool: TOOL, security: { group: 'A', dismissed: 1 } } as any)) as any
  expect(JSON.stringify(said)).toContain('1 dismissed')
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  // Gardé dans le stockage : un rechargement le relit.
  const stored = (mem[KEY] as Board).runs[0]!.groups!.find(g => g.id === 'A')!
  expect(stored.security).toMatchObject({ findings: 2, fixed: 1, dismissed: 1 })
  const settled = await colorOf('desktop', /sécurité relue · 2\sconstats · 1 corrigé · 1 laissée$/)
  expect(settled.row).toBeDefined()
  // Plus en ambre : la couleur de la ligne tranchée est celle d'une revue sans faille ouverte.
  expect(settled.color).not.toBe(open.color)
  expect((await colorOf('terminal', /1 corrigé · 1 laissée$/)).row).toBeDefined()
  await $.tool.call({ tool: TOOL, security: { group: 'B', advised: true, findings: 0, fixed: 0 } } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'b1', status: 'done' }], reviewed: ['B'] } as any)
  const clean = await colorOf('desktop', /sécurité relue · 0\sconstat$/)
  expect(clean.row).toBeDefined()
  expect(settled.color).toBe(clean.color)
})
