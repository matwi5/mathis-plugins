import { expect, mock, test } from 'claude-code/testing'

import { activeRun, applyReport, archiveRun, cancelLinked, currentPhase, dropRun, emptyBoard, linkSession, newRun, noteUnlaunched, retryLinked, startLinkedItems } from '../hooks/model.ts'
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
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
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

test('confier des pistes : rien ne passe « en cours » avant le lancement de la session, la clôture l’attend', () => {
  const sent = startLinkedItems(retro(), ['p3', 'p1'], 2_000)!.board
  const phase = currentPhase(activeRun(sent)!)
  // La demande est seulement dans le prompt : ni étape « Modifications en cours », ni pistes en cours.
  expect(phase.steps.find(s => s.status === 'active')?.id).toBe('present')
  expect(phase.items.map(i => i.status)).toEqual(['todo', 'todo', 'todo'])
  expect(activeRun(sent)!.log[0]!.text).toBe('Session liée demandée pour 2 pistes : la demande est dans le prompt')
  // Dans l'ordre de la liste, pas dans l'ordre du clic.
  expect(phase.linked).toEqual({ items: ['p1', 'p3'], at: 2_000 })
  // Déjà confiées : pas une deuxième fois.
  expect(startLinkedItems(sent, ['p1'], 2_100)).toBeNull()

  // Pas de session : la clôture est refusée, sans pousser à rendre les pistes faites ou écartées.
  const unlaunched = applyReport(sent, { complete: true }, 2_150)
  expect(unlaunched.text).toMatch(/never launched \(.+\)\. Do not mark them done or dropped/)
  expect(activeRun(unlaunched.board)?.status).toBe('active')
  // Avant le lancement, « todo » est leur état normal : elles restent confiées.
  const relisted = applyReport(sent, { items: PISTES }, 2_160).board
  expect(currentPhase(activeRun(relisted)!).linked?.items).toEqual(['p1', 'p3'])

  // Le lancement : l'id de la session, une seule fois, l'étape et les pistes en cours.
  const linked = linkSession(sent, 'local_abc', 2_200)!.board
  const running = currentPhase(activeRun(linked)!)
  expect(running.linked?.session).toBe('local_abc')
  expect(running.steps.find(s => s.status === 'active')?.id).toBe('apply')
  expect(running.steps.find(s => s.id === 'present')?.status).toBe('done')
  expect(running.items.map(i => i.status)).toEqual(['doing', 'todo', 'doing'])
  expect(activeRun(linked)!.log[0]!.text).toBe('Session liée lancée : 2 pistes en cours')
  expect(linkSession(linked, 'local_other', 2_300)).toBeNull()

  // Clôture refusée tant que des pistes sont chez la session.
  const early = applyReport(linked, { complete: true }, 3_000)
  expect(early.text).toMatch(/still being applied by the linked session/)
  expect(early.text).toMatch(/todo if not done: it goes back to the user's choice; dropped only when the user gives it up/)
  expect(activeRun(early.board)?.status).toBe('active')

  // La note de fin rendue : la phase se clôt.
  const back = applyReport(linked, { items: [{ ...PISTES[0], status: 'done' }, PISTES[1], { ...PISTES[2], status: 'dropped' }], complete: true }, 4_000)
  expect(back.board.runs[0]!.status).toBe('done')
})

test('un ajout à un envoi sans session le rejoint ; une session au travail n’en prend pas d’autres', () => {
  const sent = startLinkedItems(retro(), ['p1'], 2_000)!.board
  const more = startLinkedItems(sent, ['p3'], 2_100)!.board
  expect(currentPhase(activeRun(more)!).linked).toEqual({ items: ['p1', 'p3'], at: 2_100 })
  const running = linkSession(more, 'local_abc', 2_200)!.board
  expect(startLinkedItems(running, ['p2'], 2_300)).toBeNull()
  // Claude, qui ne voit pas les pistes passer « en cours », le lit dans chaque réponse.
  expect(applyReport(running, { note: 'x' }, 2_400).text).toMatch(/with the linked session until its final note, keep them "doing" in any items list: Contrôles : tables chargées; Outils : clé Jira dans le titre/)
})

test('rendre des pistes au choix et clore dans le même appel : la clôture est refusée', () => {
  const linked = linkSession(startLinkedItems(retro(), ['p1', 'p3'], 2_000)!.board, 'local_abc', 2_200)!.board
  const out = applyReport(linked, { items: [{ ...PISTES[0], status: 'done' }, PISTES[1], PISTES[2]], complete: true }, 4_000)
  expect(out.text).toMatch(/1 item\(s\) just went back to the user's choice \(todo\)\. Do not complete/)
  expect(activeRun(out.board)?.status).toBe('active')
  expect(currentPhase(activeRun(out.board)!).linked?.items).toEqual(['p1'])
})

test('une piste que la session n’a pas faite revient au choix, sans être écartée', () => {
  const linked = linkSession(startLinkedItems(retro(), ['p1', 'p3'], 2_000)!.board, 'local_abc', 2_200)!.board
  const back = applyReport(linked, { items: [{ ...PISTES[0], status: 'done' }, PISTES[1], PISTES[2]] }, 4_000).board
  const phase = currentPhase(activeRun(back)!)
  expect(phase.linked?.items).toEqual(['p1'])
  expect(phase.items.map(i => i.status)).toEqual(['done', 'todo', 'todo'])
  expect(activeRun(back)!.log[0]!.text).toBe('À choisir de nouveau, pas fait par la session liée : Outils : clé Jira dans le titre')
  // Rien n'est plus chez la session : la rétro peut se clore, et la piste se renvoyer.
  expect(startLinkedItems(back, ['p3'], 4_100)).not.toBeNull()
  expect(applyReport(back, { complete: true }, 4_200).board.runs[0]!.status).toBe('done')
})

test('aucune session après un tour de Claude : le panneau le marque, la relance ou le lancement l’effacent', () => {
  const sent = startLinkedItems(retro(), ['p1', 'p2'], 2_000)!.board
  // Un tour commencé avant l'envoi ne le concerne pas.
  expect(noteUnlaunched(sent, 1_900, 2_500)).toBeNull()
  const missed = noteUnlaunched(sent, 2_100, 2_500)!.board
  expect(currentPhase(activeRun(missed)!).linked).toEqual({ items: ['p1', 'p2'], at: 2_000, missedAt: 2_500 })
  expect(activeRun(missed)!.log[0]).toMatchObject({ text: 'Aucune session liée lancée pour 2 pistes : Claude a rendu la main sans la lancer', tone: 'warn' })
  // Marqué une seule fois.
  expect(noteUnlaunched(missed, 2_600, 2_700)).toBeNull()

  // « Redemander » : la demande repart, la marque s'efface ; un tour d'avant la relance ne compte plus.
  const retried = retryLinked(missed, 3_000)!.board
  expect(currentPhase(activeRun(retried)!).linked).toEqual({ items: ['p1', 'p2'], at: 3_000 })
  expect(noteUnlaunched(retried, 2_600, 3_100)).toBeNull()

  // Lancée plus tard (après une question de Claude) : la marque s'efface, les pistes passent en cours.
  const late = linkSession(missed, 'local_late', 3_500)!.board
  expect(currentPhase(activeRun(late)!).linked).toEqual({ items: ['p1', 'p2'], at: 2_000, session: 'local_late' })
  expect(noteUnlaunched(late, 3_600, 3_700)).toBeNull()
  expect(retryLinked(late, 3_800)).toBeNull()
})

test('une session lancée pour un groupe ou un bug n’est pas celle des pistes', () => {
  const sent = startLinkedItems(retro(), ['p1'], 2_000)!.board
  expect(linkSession(sent, 'local_g', 2_100, 'Rétro du groupe A › Groupe B · Synchro')).toBeNull()
  expect(linkSession(sent, 'local_b', 2_100, 'Rétro du groupe A › Bug · export vide')).toBeNull()
  // Page de code déformée (CLI Windows) : « › » en « â€º », « · » en « Â· ».
  expect(linkSession(sent, 'local_w', 2_100, 'Rétro du groupe A â€º Bug Â· export vide')).toBeNull()
  expect(linkSession(sent, 'local_w', 2_100, 'Rétro du groupe A â€º Pistes Â· contrôles')).not.toBeNull()
  // Le titre du parcours, devant « › », peut nommer un groupe.
  expect(linkSession(sent, 'local_p', 2_100, 'Rétro du groupe A › Pistes · contrôles')).not.toBeNull()
})

test('annuler un envoi sans session ; un parcours ouvert avant l’étape la reçoit', () => {
  const board = retro()
  // Un parcours de la version d'avant : pas d'étape « apply ».
  const old: Board = { ...board, runs: board.runs.map(r => ({ ...r, phases: r.phases.map(p => ({ ...p, steps: p.steps.filter(s => s.id !== 'apply') })) })) }
  const sent = startLinkedItems(old, ['p2'], 2_000)!.board
  expect(currentPhase(activeRun(sent)!).steps.some(s => s.id === 'apply')).toBe(false)
  expect(currentPhase(activeRun(linkSession(sent, 'local_x', 2_100)!.board)!).steps.at(-1)).toMatchObject({ id: 'apply', status: 'active' })

  const undone = cancelLinked(sent, 2_500)!.board
  const phase = currentPhase(activeRun(undone)!)
  expect(phase.linked).toBeUndefined()
  expect(phase.items.every(i => i.status === 'todo')).toBe(true)
  expect(phase.steps.find(s => s.status === 'active')?.id).toBe('present')
  // Une session lancée ne s'annule pas d'ici.
  expect(cancelLinked(linkSession(sent, 'local_x', 2_600)!.board, 2_700)).toBeNull()
})

test('un envoi d’avant la 0.51.0, resté sans session : « Annuler » remet les pistes au choix et l’étape d’avant', () => {
  // La 0.50.0 ouvrait l'étape et passait les pistes en cours dès le clic.
  const board = retro()
  const run = board.runs[0]!
  const phase = currentPhase(run)
  const stuck: Board = {
    ...board,
    runs: [
      {
        ...run,
        phases: [
          {
            ...phase,
            steps: phase.steps.map(s => (s.id === 'present' ? { id: s.id, status: 'done' as const, at: 1_500 } : s.id === 'apply' ? { id: s.id, status: 'active' as const, at: 2_000 } : s)),
            items: phase.items.map(i => (i.id === 'p3' ? i : { ...i, status: 'doing' as const })),
            linked: { items: ['p1', 'p2'], at: 2_000 },
          },
        ],
      },
    ],
  }
  const undone = currentPhase(activeRun(cancelLinked(stuck, 3_000)!.board)!)
  expect(undone.items.map(i => i.status)).toEqual(['todo', 'todo', 'todo'])
  expect(undone.steps.find(s => s.status === 'active')?.id).toBe('present')
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
  // La piste restante peut encore partir ; les confiées, non, et attendent la session (↗), pas « en cours ».
  expect(await ui.find({ key: 'item-pick-p1' })).toBeUndefined()
  expect(await ui.find({ key: 'item-pick-p2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^↗$/ })).toBeDefined()
  expect(text).toMatch(/Si tu ne peux pas la lancer \(outil absent, refus, erreur\), dis-le-moi avec la raison et n'envoie rien sur ces pistes/)
  expect(text).toMatch(/todo si elle n'a pas été faite \(elle revient à mon choix, sans être écartée\) ; dropped seulement si je décide de l'abandonner/)
  // « Redemander » est là dès l'envoi, en grisé : la demande a pu quitter le prompt.
  expect((await ui.find({ key: 'linked-retry' }))?.props).toMatchObject({ dimColor: true })

  // Un tour qui n'a pas vu la demande (une notification) ne compte pas.
  await $.prompt.submit({ text: 'tâche finie', origin: { kind: 'task-notification' } } as any)
  await $.turn.start({ text: 'tâche finie', turnId: 't0' } as any)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't0', reason: 'answer' } as any)
  expect(await ui.find({ type: 'Text', text: /Aucun\slancement\srelevé/ })).toBeUndefined()

  // Claude rend la main sans lancer de session : le panneau le dit, « Redemander » ressort.
  await $.prompt.submit({ text, origin: { kind: 'composer' } } as any)
  await $.turn.start({ text: text, turnId: 't1' } as any)
  await $.turn.complete({ answer: 'Il me faut d’abord ton accord sur la piste 1.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as any)
  expect(await ui.find({ type: 'Text', text: /Aucun\slancement\srelevé/ })).toBeDefined()
  expect((await ui.find({ key: 'linked-retry' }))?.props).toMatchObject({ dimColor: false })
  expect(await ui.find({ key: 'linked-cancel' })).toBeDefined()
  // « Reprendre » sans session relevée : chercher la session, et ne rien rendre si elle n'existe pas.
  await ui.press({ key: 'linked-recover' })
  const lost = filled.at(-1)!
  expect(lost).toMatch(/^Aucune session n'a été relevée pour les pistes du parcours « Rétro du groupe A » : 1\) \[p1\]/)
  expect(lost).toContain('un titre qui commence par « Rétro du groupe A › Pistes · »')
  expect(lost).toMatch(/n'envoie aucun statut à l'outil flow et ne clos pas la phase/)
  expect(lost).not.toMatch(/lancée par le CLI|dropped/)
  // « Redemander » : vérifier d'abord qu'aucune session n'est partie, puis la même demande ; l'envoi redevient « à lancer ».
  await ui.press({ key: 'linked-retry' })
  const again = filled.at(-1)!
  expect(again).toMatch(/^D'abord, vérifie qu'aucune session n'a déjà été lancée pour ces pistes : .*« Rétro du groupe A › Pistes · »\)\. Si tu en trouves une, ne lance rien/)
  expect(again).toMatch(/Sinon : Traite ces pistes de la phase Rétro du parcours « Rétro du groupe A » dans une session liée : 1\) \[p1\] Contrôles : tables chargées ; 2\) \[p3\]/)
  expect(await ui.find({ type: 'Text', text: /Session\sliée\sà\slancer/ })).toBeDefined()
  expect((await ui.find({ key: 'linked-retry' }))?.props).toMatchObject({ dimColor: true })

  // Claude lance la session : son id est relevé, le panneau la montre au travail.
  await $.tool.call({ tool: START, initiation: 'user_asked', title: 'Pistes de la rétro', prompt: 'x' } as any)
  expect(await ui.find({ type: 'Text', text: /Session\sliée\sau\stravail/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^↗$/ })).toBeUndefined()
  expect(await ui.find({ key: 'linked-cancel' })).toBeUndefined()
  expect(await ui.find({ key: 'linked-retry' })).toBeUndefined()
  // Une session au travail : pas de nouvel envoi, qui lancerait une seconde session.
  expect(await ui.find({ key: 'item-pick-p2' })).toBeUndefined()
  expect(await ui.find({ key: 'items-all' })).toBeUndefined()
  // Pas de compteur à 0 pendant que la session travaille : les pistes sont « en cours ».
  expect(await ui.find({ type: 'Text', text: /^2\spistes\sen\scours$/ })).toBeDefined()
  // Une session arrêtée sans note : « Reprendre les pistes » demande à Claude de les rendre.
  await ui.press({ key: 'linked-recover' })
  const check = filled.at(-1)!
  expect(check).toMatch(/^Vérifie l'état de la session liée \(local_abc123\) qui traite les pistes du parcours « Rétro du groupe A » : 1\) \[p1\]/)
  // Ni le CLI supposé, ni l'abandon des pistes pas faites.
  expect(check).toContain("avec tes outils de session de l'app Desktop si tu les as, sinon par ListAgents (est-elle encore là), l'état git de son worktree")
  expect(check).not.toMatch(/sinon claude logs|claude logs <id>/)
  expect(check).toMatch(/todo si elle n'a pas été faite/)
  expect(check).toMatch(/\{"complete": true\} seulement si aucune n'est revenue à todo/)

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
