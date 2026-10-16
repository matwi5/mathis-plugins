import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyReport, archiveRun, cancelLinked, currentPhase, dropRun, emptyBoard, linkSession, newRun, startLinkedItems } from '../hooks/model.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const START = 'mcp__ccd_session__start_session'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  // L'app répond au lancement d'une session liée avec son id.
  on('tool.call', { tool: START }, () => ({ result: { text: 'Started session local_abc123 (name: retro-pistes).' } }))
  return filled
}

const PISTES = [
  { id: 'p1', label: 'Contrôles : tables chargées', status: 'todo' },
  { id: 'p2', label: 'Accès : bucket parc_EAS', status: 'todo' },
  { id: 'p3', label: 'Outils : clé Jira dans le titre', status: 'todo' },
]

const retro = (): Board => {
  const run = { ...newRun('retro', 1_000, 'Rétro du groupe A'), owner: 's' }
  const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, { items: PISTES, step: 'present' }, 1_500).board
}

test('confier des pistes : étape « Modifications en cours », pistes en cours, la clôture attend la session', () => {
  const sent = startLinkedItems(retro(), ['p3', 'p1'], 2_000)!.board
  const phase = currentPhase(activeRun(sent)!)
  expect(phase.steps.find(s => s.status === 'active')?.id).toBe('apply')
  expect(phase.steps.find(s => s.id === 'present')?.status).toBe('done')
  // Dans l'ordre de la liste, pas dans l'ordre du clic.
  expect(phase.linked).toEqual({ items: ['p1', 'p3'], at: 2_000 })
  expect(phase.items.map(i => i.status)).toEqual(['doing', 'todo', 'doing'])
  // Déjà confiées : pas une deuxième fois.
  expect(startLinkedItems(sent, ['p1'], 2_100)).toBeNull()

  // L'id de la session, une seule fois.
  const linked = linkSession(sent, 'local_abc', 2_200)!.board
  expect(currentPhase(activeRun(linked)!).linked?.session).toBe('local_abc')
  expect(linkSession(linked, 'local_other', 2_300)).toBeNull()

  // Clôture refusée tant que des pistes sont chez la session.
  const early = applyReport(linked, { complete: true }, 3_000)
  expect(early.text).toMatch(/still being applied by the linked session/)
  expect(activeRun(early.board)?.status).toBe('active')

  // La note de fin rendue : la phase se clôt.
  const back = applyReport(linked, { items: [{ ...PISTES[0], status: 'done' }, PISTES[1], { ...PISTES[2], status: 'dropped' }], complete: true }, 4_000)
  expect(back.board.runs[0]!.status).toBe('done')
})

test('annuler un envoi sans session ; un parcours ouvert avant l’étape la reçoit', () => {
  const board = retro()
  // Un parcours de la version d'avant : pas d'étape « apply ».
  const old: Board = { ...board, runs: board.runs.map(r => ({ ...r, phases: r.phases.map(p => ({ ...p, steps: p.steps.filter(s => s.id !== 'apply') })) })) }
  const sent = startLinkedItems(old, ['p2'], 2_000)!.board
  expect(currentPhase(activeRun(sent)!).steps.at(-1)).toMatchObject({ id: 'apply', status: 'active' })

  const undone = cancelLinked(sent, 2_500)!.board
  const phase = currentPhase(activeRun(undone)!)
  expect(phase.linked).toBeUndefined()
  expect(phase.items.every(i => i.status === 'todo')).toBe(true)
  expect(phase.steps.find(s => s.status === 'active')?.id).toBe('present')
  // Une session lancée ne s'annule pas d'ici.
  expect(cancelLinked(linkSession(sent, 'local_x', 2_600)!.board, 2_700)).toBeNull()
})

test('le panneau : choisir les pistes, tout sélectionner, confier à une session liée et la suivre', async ($, on) => {
  mock.clock(on, { now: 60_000_000 })
  mock.store(on)
  const filled = engine(on)
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  // Claude attend le choix de la personne avant de clore la rétro.
  expect(note.text).toMatch(/Do not send \{"complete": true\} before the user has decided/)
  await $.tool.call({ tool: TOOL, title: 'Rétro du groupe A', items: PISTES, step: 'present' } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Modifications en cours$/ })).toBeDefined()
  expect(await ui.find({ key: 'items-linked' })).toBeUndefined()
  // Tout sélectionner, puis en retirer une.
  await ui.press({ key: 'items-all' })
  expect((await ui.find({ key: 'items-all' }))?.props).toMatchObject({ label: 'Tout désélectionner' })
  await ui.press({ key: 'item-pick-p2' })
  expect((await ui.find({ key: 'item-pick-p2' }))?.props).toMatchObject({ label: '○' })
  expect((await ui.find({ key: 'item-pick-p1' }))?.props).toMatchObject({ label: '●' })
  expect(String((await ui.find({ key: 'items-linked' }))?.props.label).replace(/\s/g, ' ')).toBe('↗ Traiter 2 pistes · session liée')
  await ui.press({ key: 'items-linked' })

  // La demande pour Claude : session liée, le parcours reste ici.
  const text = filled.at(-1)!
  expect(text).toMatch(/^Traite ces pistes de la phase Rétro du parcours « Rétro du groupe A » dans une session liée/)
  expect(text).toMatch(/1\) \[p1\] Contrôles : tables chargées ; 2\) \[p3\] Outils : clé Jira dans le titre\./)
  expect(text).toMatch(/ne pas utiliser l'outil flow/)
  expect(text).not.toMatch(/"resume"/)
  // Ce que Claude doit régler avant, et rédiger dans le brief.
  expect(text).toMatch(/règle-les d'abord avec moi ici/)
  expect(text).toMatch(/context "fresh", wake_when_done true et use_worktree false/)
  expect(text).toMatch(/une section par piste : le problème constaté \(une phrase\), la correction attendue, les fichiers touchés et un critère de fin vérifiable/)
  expect(text).toMatch(/sans sous-agents qui écrivent/)
  expect(text).toMatch(/les contrôles lancés et leur résultat, et ce qui m'attend/)
  expect(text).toContain('claude --bg -n "Rétro du groupe A › Pistes · <sujet>" (sans -w : ce dossier n’a pas de git) "<prompt>"')
  expect(await ui.find({ type: 'Text', text: /Session\sliée\sà\slancer/ })).toBeDefined()
  expect(await ui.find({ key: 'linked-cancel' })).toBeDefined()
  // Sans id relevé, la session a pu partir quand même : la reprise reste proposée.
  expect(await ui.find({ key: 'linked-recover' })).toBeDefined()
  // La piste restante peut encore partir ; les confiées, non.
  expect(await ui.find({ key: 'item-pick-p1' })).toBeUndefined()
  expect(await ui.find({ key: 'item-pick-p2' })).toBeDefined()

  // Claude lance la session : son id est relevé, le panneau la montre au travail.
  await $.tool.call({ tool: START, initiation: 'user_asked', title: 'Pistes de la rétro', prompt: 'x' } as any)
  expect(await ui.find({ type: 'Text', text: /Session\sliée\sau\stravail/ })).toBeDefined()
  expect(await ui.find({ key: 'linked-cancel' })).toBeUndefined()
  // Pas de compteur à 0 pendant que la session travaille : les pistes sont « en cours ».
  expect(await ui.find({ type: 'Text', text: /^2\spistes\sen\scours$/ })).toBeDefined()
  // Une session arrêtée sans note : « Reprendre les pistes » demande à Claude de les rendre.
  await ui.press({ key: 'linked-recover' })
  expect(filled.at(-1)).toMatch(/^Vérifie l'état de la session liée \(local_abc123\) qui traite les pistes du parcours « Rétro du groupe A » : 1\) \[p1\]/)

  // La note de fin rendue par Claude : 2/2, et la rétro se clôt.
  await $.tool.call({ tool: TOOL, items: [{ ...PISTES[0], status: 'done' }, PISTES[1], { ...PISTES[2], status: 'dropped' }] } as any)
  expect(await ui.find({ type: 'Text', text: /^pistes\s:\s2\/2$/ })).toBeDefined()
  await ui.unmount()
})

test('un parcours archivé se supprime après confirmation ; sans parcours choisi, l’en-tête n’en montre aucun', async ($, on) => {
  mock.clock(on, { now: 61_000_000 })
  mock.store(on)
  engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Vieille rétro', items: PISTES } as any)

  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Aucun parcours sélectionné/ })).toBeUndefined()
  await ui.press({ key: 'tab-history' })
  const archive = (await ui.findAll({ type: 'Button' })).find(b => String(b.key ?? '').startsWith('archive-'))
  // Le parcours en cours ici n'a pas de bouton « Archiver » : on le met de côté d'abord.
  expect(archive).toBeUndefined()
  await ui.unmount()
  await $.command.run({ command: 'flow', args: 'pause' } as any)

  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  // Mis de côté : plus de parcours choisi, l'en-tête est vide.
  expect(await ui.find({ type: 'Text', text: /Aucun parcours sélectionné/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^◉ en cours$/ })).toBeUndefined()
  await ui.press({ key: 'tab-history' })
  const id = String((await ui.findAll({ type: 'Button' })).find(b => String(b.key ?? '').startsWith('archive-'))!.key).slice('archive-'.length)
  await ui.press({ key: `archive-${id}` })
  await ui.press({ key: 'archived-toggle' })
  // Un premier clic demande confirmation ; « Annuler » la retire.
  await ui.press({ key: `drop-${id}` })
  expect(await ui.find({ type: 'Text', text: /Supprimer définitivement ce parcours/ })).toBeDefined()
  await ui.press({ key: `drop-no-${id}` })
  expect(await ui.find({ key: `drop-yes-${id}` })).toBeUndefined()
  await ui.press({ key: `drop-${id}` })
  await ui.press({ key: `drop-yes-${id}` })
  expect(await ui.find({ key: `unarchive-${id}` })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Vieille rétro/ })).toBeUndefined()
  await ui.unmount()
})

test('archiver puis supprimer : la suppression laisse une trace pour les autres discussions', () => {
  const board = retro()
  const id = board.runs[0]!.id
  const archived = archiveRun(board, id, 2_000)!.board
  const dropped = dropRun(archived, id, 3_000)!.board
  expect(dropped.runs).toEqual([])
  expect(dropped.deleted).toEqual([{ id, at: 3_000 }])
})
