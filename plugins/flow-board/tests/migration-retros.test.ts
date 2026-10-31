import { expect, mock, test } from 'claude-code/testing'

import {
  activeRun,
  applyReport,
  applySkill,
  detachOnLoad,
  emptyBoard,
  mergeBoards,
  newRun,
  nextCommandSkill,
  nextLaunchFor,
  suggestionsFor,
  upgradeRun,
} from '../hooks/model.ts'
import type { Board, FlowPhase, LinkedWork, Run } from '../types'

// Un parcours de rétro créé avant que la Rétro ait sa suite n'a que la phase Rétro : à la lecture,
// il reçoit la suite d'un parcours neuf (Implémentation, Compte rendu, Version, PR), une fois sa
// session de pistes fermée. Invariant : la migration n'ajoute que des phases après la rétro ; elle
// ne retire ni ne réécrit jamais une phase, un lien de pistes ou une piste.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const PISTES = [
  { id: 'p1', label: 'Hooks : revue des pistes', status: 'doing' as const },
  { id: 'p2', label: 'Contrôles : délai', status: 'todo' as const },
  { id: 'p3', label: 'Docs : README', status: 'doing' as const },
]
const OPEN: LinkedWork = { items: ['p1', 'p3'], at: 2_000, seq: 2, session: '9f9f9f9f' }

const shape = (run: Run) => run.phases.map(p => `${p.skill}${p.isOptional ? '?' : ''}:${p.status}`)

/**
 * Une rétro d'avant sa suite, en cours, sur son étape de session liée, la session précédente fermée :
 * par défaut, p1 et p3 chez la session de pistes 9f9f9f9f (2e envoi) ; `link` la remplace.
 */
const oldRetro = (link: unknown = OPEN, items: FlowPhase['items'] = PISTES): Run => {
  const run = newRun('retro', 1_000, 'Rétrospective · Fermeture auto')
  const first = run.phases[0]!
  const retro: FlowPhase = {
    ...first,
    items,
    // Les étapes d'avant le découpage : les quatre premières, puis l'étape de session liée.
    steps: [...first.steps.slice(0, 4).map((s, i) => ({ id: s.id, status: 'done' as const, at: 1_100 + i })), { id: 'apply', status: 'active' as const, at: 2_000 }],
    linked: link as LinkedWork,
    linkedEarlier: { at: 1_200, session: '8e8e8e8e', seq: 1, closing: { state: 'closed', at: 1_800, branch: 'worktree-pistes-retrospective-1' } },
    linkedSends: 2,
  }
  return { ...run, owner: 's', phases: [retro], updatedAt: 2_500 }
}
/** La même, ses pistes jugées (p1 et p3 faites) et sa session fermée. */
const closedRetro = (): Run =>
  oldRetro(
    { ...OPEN, closing: { state: 'closed', at: 2_400, branch: 'worktree-pistes-retrospective-2' } },
    PISTES.map(i => ({ ...i, status: i.id === 'p2' ? ('todo' as const) : ('done' as const) })),
  )

/** Le tableau de bord d'un projet qui n'a que ce parcours ; actif dans la discussion `active` quand elle est donnée. */
const board = (run: Run, active?: string): Board => ({ ...emptyBoard('/w/p', 'p'), session: active ?? 's', deleted: [], runs: [run], activeId: active ? run.id : null })

test('une rétro d’avant sa suite, sa session de pistes fermée, reçoit Implémentation, Compte rendu, Version, PR, comme un parcours neuf', () => {
  const old = closedRetro()
  const kept = JSON.parse(JSON.stringify(old.phases[0])) as FlowPhase
  const run = upgradeRun(old)
  expect(shape(run)).toEqual(['retro:active', 'implement?:pending', 'compte-rendu?:pending', 'project:version?:pending', 'project:pr?:pending'])
  // Les phases ajoutées sont celles d'un parcours neuf, à faire, sans date.
  expect(run.phases.slice(1)).toEqual(newRun('retro', 9_000).phases.slice(1))
  expect(run.phases.slice(1).every(p => p.startedAt === undefined && p.steps.every(s => s.status === 'pending'))).toBe(true)
  // La Rétro, ses étapes, ses pistes et son lien de pistes ne bougent pas ; le curseur non plus.
  expect(run.phases[0]).toEqual(kept)
  expect(run.cursor).toBe(0)
  expect(run.status).toBe('active')
  expect(run.updatedAt).toBe(2_500)
})

test('tant que sa session de pistes n’est pas fermée, la rétro garde sa seule phase ; fermée, elle reçoit sa suite', () => {
  // Session au travail, pistes jugées sans fermeture, fermeture arrêtée ou à archiver, envoi pas lancé,
  // session relevée sur une liste confiée relue hors forme.
  const held = [
    oldRetro(),
    oldRetro(OPEN, closedRetro().phases[0]!.items),
    oldRetro({ ...OPEN, closing: { state: 'stopped', at: 2_400, why: '.env ignoré' } }, closedRetro().phases[0]!.items),
    oldRetro({ ...OPEN, closing: { state: 'app', at: 2_400 } }, closedRetro().phases[0]!.items),
    oldRetro({ items: ['p1', 'p3'], at: 2_000, seq: 2 }),
    oldRetro({ items: 5, at: 2_000, session: '9f9f9f9f' }),
  ]
  for (const run of held) expect(upgradeRun(run)).toBe(run)
  // Sans lien du tout, la session fermée, ou un lien relu qui n'est pas une session (comme pour le choix
  // des pistes) : la suite vient, et le lien, tel quel, reste.
  const unlinked = oldRetro(OPEN, PISTES.map(i => ({ ...i, status: 'todo' as const })))
  const { linked: _, linkedEarlier: __, linkedSends: ___, ...bare } = unlinked.phases[0]!
  expect(shape(upgradeRun({ ...unlinked, phases: [bare] }))).toHaveLength(5)
  expect(shape(upgradeRun(closedRetro()))).toHaveLength(5)
  for (const odd of [null, 'lien', [], { items: {} }]) {
    const run = upgradeRun(oldRetro(odd))
    expect(shape(run)).toHaveLength(5)
    expect(run.phases[0]!.linked as unknown).toEqual(odd)
  }
  // Une liste confiée hors forme ne fait tomber ni le chargement ni la fusion du tableau de bord.
  const bad = oldRetro({ items: 5 })
  expect(() => detachOnLoad(board(bad), 3_000, 's')).not.toThrow()
  expect(() => mergeBoards(board(bad), board(closedRetro()))).not.toThrow()
})

test('une rétro tenue par sa session de pistes ne se quitte pas par /implement et ne reçoit pas de lot', () => {
  const held = board(oldRetro(), 's')
  const linkBefore = JSON.parse(JSON.stringify(oldRetro().phases[0]!.linked)) as LinkedWork
  // /implement tapé : la rétro passe en pause, son lien et sa Rétro tels quels, jamais « terminée ».
  const typed = applySkill(held, 'mattpocock-skills:implement', { now: 3_000, isMain: true })!.board
  const retro = typed.runs.find(r => r.entry === 'retro')!
  expect(retro.status).toBe('paused')
  expect(shape(retro)).toEqual(['retro:active'])
  expect(retro.phases[0]!.linked).toEqual(linkBefore)
  // Un découpage envoyé avant la fermeture : refusé, rien d'enregistré, même un choix déclaré ; la
  // réponse dit comment fermer la session, selon où elle en est.
  const lot = { tickets: [{ id: '06', name: 'Revue', sensitive: false, logic: true }], groups: [{ id: 'A', name: 'Pistes', tickets: ['06'] }], complete: true }
  const cut = applyReport(held, { items: PISTES, ...lot, decided: [{ what: 'un choix' }] }, 3_000)
  expect(cut.board).toBe(held)
  expect(cut.text).toContain('nothing of this call was recorded, whatever it carried')
  expect(cut.text).toContain('the pistes session of this retro is not closed yet: its linked session is still applying items')
  const remedies: [unknown, FlowPhase['items'], string][] = [
    [{ items: ['p1', 'p3'], at: 2_000, seq: 2 }, PISTES, '« Redemander », « Annuler »'],
    [{ ...OPEN, closing: { state: 'stopped', at: 2_400 } }, closedRetro().phases[0]!.items, '« ↻ Relancer la fermeture »'],
    [{ ...OPEN, closing: { state: 'app', at: 2_400 } }, closedRetro().phases[0]!.items, 'To archive in the app'],
    [OPEN, closedRetro().phases[0]!.items, 'its items are judged'],
  ]
  for (const [link, items, remedy] of remedies) expect(applyReport(board(oldRetro(link, items), 's'), lot, 3_000).text).toContain(remedy)
  // Un détour ouvert sur la Rétro (un grilling pour trancher une piste) ne fait pas passer le lot.
  const detour = applySkill(held, 'mattpocock-skills:grilling', { now: 3_000, isMain: true })!.board
  expect(applyReport(detour, lot, 3_100).board).toBe(detour)
  // Une liste confiée relue hors forme ne fait pas tomber la note de fin.
  const odd = board(oldRetro({ items: 5, at: 2_000, session: '9f9f9f9f' }), 's')
  expect(() => applyReport(odd, { items: closedRetro().phases[0]!.items }, 3_000)).not.toThrow()
})

test('la fermeture enregistrée donne sa suite à la rétro dans le même appel : un découpage, ou une fin sans lot', () => {
  const judged = applyReport(board(oldRetro(), 's'), { items: closedRetro().phases[0]!.items }, 3_000).board
  // Fermeture et fin dans le même appel, sans lot : la suite arrive, puis le parcours se termine.
  const ended = applyReport(judged, { closed: [{ items: 'retro', state: 'closed' }], complete: true }, 3_100)
  const done = ended.board.runs[0]!
  expect(shape(done)).toEqual(['retro:done', 'implement?:pending', 'compte-rendu?:pending', 'project:version?:pending', 'project:pr?:pending'])
  expect(done.status).toBe('done')
  // Fermeture, découpage et fin dans le même appel : la fermeture compte, le lot passe.
  const together = applyReport(judged, { closed: [{ items: 'retro', state: 'closed' }], tickets: [{ id: '06', name: 'Revue', sensitive: false, logic: true }], groups: [{ id: 'A', name: 'Pistes', tickets: ['06'] }], complete: true }, 3_100).board
  expect(activeRun(together)!.phases[0]!.linked?.closing?.state).toBe('closed')
  expect(shape(activeRun(together)!)).toEqual(['retro:done', 'implement:pending', 'compte-rendu?:pending', 'project:version?:pending', 'project:pr?:pending'])
  // Fermeture, puis découpage et fin dans l'appel suivant, sans relecture entre les deux : le lot attend ses groupes.
  const closed = applyReport(judged, { closed: [{ items: 'retro', state: 'closed' }] }, 3_100).board
  expect(shape(activeRun(closed)!)).toHaveLength(5)
  const cut = applyReport(closed, { tickets: [{ id: '06', name: 'Revue', sensitive: false, logic: true }], groups: [{ id: 'A', name: 'Pistes', tickets: ['06'] }], complete: true }, 3_200).board
  const run = activeRun(cut)!
  expect(run.status).toBe('active')
  expect(shape(run)).toEqual(['retro:done', 'implement:pending', 'compte-rendu?:pending', 'project:version?:pending', 'project:pr?:pending'])
  expect(nextLaunchFor(run)).toEqual({ kind: 'group', group: 'A', isDelegable: true })
})

test('relue deux fois, chargée, ou fusionnée de deux copies (migrée ou non), la rétro donne le même parcours', () => {
  const migrated = upgradeRun(closedRetro())
  expect(upgradeRun(migrated)).toBe(migrated)
  expect(detachOnLoad(board(closedRetro()), 3_000, 's').runs[0]!.phases).toEqual(migrated.phases)
  // Deux discussions : l'une a la copie d'avant, l'autre la copie migrée, l'une ou l'autre plus récente.
  const copies: [Run, Run][] = [
    [closedRetro(), { ...migrated, updatedAt: 2_600 }],
    [migrated, { ...closedRetro(), updatedAt: 2_600 }],
  ]
  for (const [older, newer] of copies) {
    const sides: [Run, Run][] = [
      [older, newer],
      [newer, older],
    ]
    for (const [local, stored] of sides) {
      const merged = mergeBoards(board(local), board(stored)).runs[0]!
      expect(merged.phases).toEqual(migrated.phases)
    }
  }
  // La copie d'une discussion qui a vu la session ouverte, plus récente, et celle qui l'a vue fermée :
  // la fermeture est gardée par la fusion, puis la suite vient.
  const merged = mergeBoards(board({ ...oldRetro(OPEN, closedRetro().phases[0]!.items), updatedAt: 2_700 }), board(closedRetro())).runs[0]!
  expect(merged.phases[0]!.linked?.closing?.state).toBe('closed')
  expect(shape(merged)).toHaveLength(5)
})

test('une rétro terminée, une rétro qui a déjà une phase après la Rétro, ou un parcours d’un autre skill ne sont pas touchés', () => {
  const done: Run = { ...closedRetro(), status: 'done', finishedAt: 3_000 }
  expect(upgradeRun(done)).toBe(done)
  const extended = upgradeRun(closedRetro())
  const cut: Run = { ...extended, phases: extended.phases.slice(0, 2) }
  expect(upgradeRun(cut)).toBe(cut)
  const design = newRun('codebase-design', 1_000)
  expect(upgradeRun(design)).toBe(design)
  // Un parcours d'un autre skill dont la dernière phase serait une rétro (forme d'avant la 0.5.0) : pas une rétro.
  const lot = newRun('implement', 1_000)
  const withRetro: Run = { ...lot, phases: [{ ...lot.phases[0]!, status: 'done' }, closedRetro().phases[0]!], cursor: 1 }
  expect(upgradeRun(withRetro)).toBe(withRetro)
})

test('une phase dont les pistes sont chez une session liée pas encore fermée ne propose aucune suite', () => {
  // Une rétro à suite dont une session de pistes est ouverte (par une discussion d'une version antérieure) :
  // quitter la Rétro avant la note de fin la rangerait dans une autre phase.
  const fresh = newRun('retro', 1_000, 'Rétrospective · Fermeture auto')
  const run: Run = { ...fresh, owner: 's', phases: [oldRetro().phases[0]!, ...fresh.phases.slice(1)] }
  const busy = suggestionsFor(run)
  expect(busy.primary).toBeNull()
  expect(busy.others).not.toContain('implement')
  expect(nextCommandSkill(run)).toBeNull()
  // Pistes jugées, session pas encore fermée : toujours rien.
  const judged = applyReport(board(run, 's'), { items: PISTES.map(i => ({ ...i, status: 'done' })) }, 3_000).board
  expect(suggestionsFor(activeRun(judged)!).primary).toBeNull()
  // Fermée : la suite revient.
  const closed = applyReport(judged, { closed: [{ items: 'retro', state: 'closed' }] }, 3_100).board
  expect(suggestionsFor(activeRun(closed)!).primary).toBe('implement')
})

test('chargée puis rechargée, une rétro en cours garde sa session de pistes, sa note de fin et sa fermeture, puis reçoit sa suite', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: 90_000_000 })
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's2' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  const toasts: string[] = []
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // Le tableau de bord d'une version d'avant : la rétro n'a que sa phase, en pause, sa session de pistes au travail.
  const old = { ...oldRetro(), owner: undefined, status: 'paused' as const }
  mem['board:'] = { ...emptyBoard('', 'p'), deleted: [], runs: [old], activeId: null }
  const start = () => $.session.start({ cwd: '', surface: null, isInteractive: true })
  await start()
  await $.tool.call({ tool: TOOL, resume: old.id } as any)
  for (const step of ['chargée', 'rechargée']) {
    if (step === 'rechargée') await start()
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /Session.liée.au.travail/ })).toBeDefined()
    // La session est ouverte : la rétro garde sa seule phase, et la piste restée au choix attend sa fermeture.
    expect(await ui.find({ type: 'Text', text: /^Code\s*$/ })).toBeUndefined()
    expect(await ui.find({ key: 'item-pick-p2' })).toBeUndefined()
    await ui.unmount()
  }
  // La note de fin : les pistes jugées, la session est à fermer, puis fermée.
  const judged = JSON.stringify(await $.tool.call({ tool: TOOL, items: PISTES.map(i => ({ ...i, status: i.id === 'p2' ? 'todo' : 'done' })) } as any))
  expect(judged).toContain('Close now: the linked session of the Pistes')
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /fermer d.abord la session précédente/ })).toBeDefined()
  await ui.unmount()
  await $.tool.call({ tool: TOOL, closed: [{ items: 'retro', state: 'closed' }] } as any)
  // La fermeture enregistrée : la suite arrive aussitôt, et p2 se choisit de nouveau.
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Code\s*$/ })).toBeDefined()
  expect(await ui.find({ key: 'item-pick-p2' })).toBeDefined()
  await ui.unmount()
  // La Rétro terminée sans ticket finit le parcours.
  await $.tool.call({ tool: TOOL, complete: true } as any)
  expect(toasts).toContain('★ Parcours terminé : Rétrospective · Fermeture auto')
})
