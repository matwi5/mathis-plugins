import { expect, mock, test } from 'claude-code/testing'

import { closingProcedure } from '../hooks/closing.ts'
import { activeRun, applyReport, cancelLinked, currentPhase, emptyBoard, linkSession, mergeBoards, newRun, pickableItems } from '../hooks/model.ts'
import type { Board } from '../types'
import { withItemsLink } from './lien-pistes.ts'

// La session liée des pistes d'une rétro se ferme comme un groupe, une fois chacune de ses pistes
// jugée. Invariants : l'état de fermeture d'une session liée n'est jamais perdu ni reculé par un
// renvoi, une reprise ou une fusion de copies (une session notée fermée ne redevient jamais à
// fermer, seul un nouvel envoi de `closed` pour elle le change) ; l'id d'une session de pistes non
// fermée n'est jamais écrasé par un nouvel envoi.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const START = 'mcp__ccd_session__start_session'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const
const REPO = { isRepo: true }

const PISTES = [
  { id: 'p1', label: 'Contrôles : tables chargées', status: 'todo' },
  { id: 'p2', label: 'Accès : bucket', status: 'todo' },
  { id: 'p3', label: 'Outils : clé Jira', status: 'todo' },
]

const retro = (): Board => {
  const run = { ...newRun('retro', 1_000, 'Rétro du groupe A'), owner: 's' }
  const board: Board = { ...emptyBoard('c:/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, { items: PISTES, step: 'present' }, 1_500).board
}
/** p1 et p3 confiées à la session 9f9f9f9f, lancée. */
const running = (): Board => linkSession(withItemsLink(retro(), ['p1', 'p3'], 2_000), '9f9f9f9f', 2_200)!.board
/** Les pistes jugées : p1 faite, p3 revenue au choix. */
const judged = (): Board => applyReport(running(), { items: [{ ...PISTES[0], status: 'done' }, PISTES[1], PISTES[2]] }, 4_000, REPO).board
const linkOf = (b: Board) => currentPhase(activeRun(b)!).linked

test('la session de pistes est à fermer une fois chacune de ses pistes jugée, avec la procédure des pistes', () => {
  expect(applyReport(running(), { note: 'point' }, 3_000, REPO).text).not.toContain('Close now')
  const out = applyReport(judged(), { note: 'point' }, 5_000, REPO)
  const run = activeRun(out.board)!
  expect(out.text).toContain('Close now: the linked session of the Pistes of phase Rétro (session 9f9f9f9f) is closed (every item judged).')
  expect(out.text).toContain(closingProcedure({ run, target: { kind: 'items', skill: 'retro' }, isRepo: true, session: '9f9f9f9f', seq: 1 }))
  expect(out.text).toContain('{"closed": [{"items": "retro", "state": "closed"')
  // Une piste revenue au choix ne fait pas oublier la session : son id reste.
  expect(linkOf(judged())).toMatchObject({ session: '9f9f9f9f', items: ['p1'] })
  // Toutes revenues au choix : la session reste à fermer.
  const allBack = applyReport(running(), { items: PISTES }, 4_000, REPO).board
  expect(linkOf(allBack)).toMatchObject({ session: '9f9f9f9f', items: [] })
  expect(applyReport(allBack, { note: 'point' }, 5_000, REPO).text).toContain('Close now: the linked session of the Pistes')
})

test('« closed » avec « items » : noté sur le lien des pistes, ne recule jamais ; « stopped » attend un envoi des pistes', () => {
  const base = judged()
  const closed = applyReport(base, { closed: [{ items: 'retro', state: 'closed', sessionId: '9f9f9f9f-0000-4000-8000-000000000000' }] }, 5_000, REPO)
  expect(closed.text).toContain('closed: Pistes of phase Rétro noted closed')
  expect(linkOf(closed.board)!.closing).toMatchObject({ state: 'closed', at: 5_000, sessionId: '9f9f9f9f-0000-4000-8000-000000000000' })
  expect(applyReport(closed.board, { note: 'point' }, 6_000, REPO).text).not.toContain('Close now')
  const back = applyReport(closed.board, { closed: [{ items: 'retro', state: 'stopped', why: 'x' }] }, 6_000, REPO)
  expect(back.text).toContain('closed: refused for Pistes of phase Rétro (already closed: a closed session never goes back)')
  // Une fusion avec la copie d'avant ne le fait pas reculer.
  expect(linkOf(mergeBoards(base, { ...closed.board, runs: closed.board.runs.map(r => ({ ...r, status: 'paused' as const, updatedAt: 99_999 })) }))!.closing?.state).toBe('closed')
  // Une session dont des pistes sont encore en cours ne se ferme pas.
  expect(applyReport(running(), { closed: [{ items: 'retro', state: 'closed' }] }, 3_000, REPO).text).toContain('closed: refused for Pistes of phase Rétro (items still in progress: send their verdicts first)')
  // La copie où un nouvel envoi a remplacé la session fermée : la fusion lui rend sa fermeture.
  const resent = withItemsLink(closed.board, ['p2'], 6_000)
  const fromEarlier = mergeBoards(base, { ...resent, runs: resent.runs.map(r => ({ ...r, status: 'paused' as const, updatedAt: 99_999 })) })
  expect(linkOf(fromEarlier)!.closing?.state).toBe('closed')
  expect(applyReport(fromEarlier, { note: 'point' }, 99_999_000, REPO).text).not.toContain('Close now')
  // Une session de pistes inconnue est refusée.
  expect(applyReport(retro(), { closed: [{ items: 'retro', state: 'closed' }] }, 5_000, REPO).text).toContain('closed: refused for Pistes of phase Rétro (no linked session to close)')
  // Arrêtée : plus proposée, jusqu'à un envoi des pistes de la phase.
  const stopped = applyReport(judged(), { closed: [{ items: 'retro', state: 'stopped', why: '.env ignoré' }] }, 5_000, REPO).board
  expect(applyReport(stopped, { note: 'point' }, 6_000, REPO).text).not.toContain('Close now')
  expect(applyReport(stopped, { items: [{ ...PISTES[0], status: 'done' }, PISTES[1], PISTES[2]] }, 6_000, REPO).text).toContain('Close now: the linked session of the Pistes')
})

test('une session de pistes non fermée tient la phase ; fermée, ses pistes se choisissent de nouveau et elle reste notée', () => {
  const b = judged()
  expect(pickableItems(currentPhase(activeRun(b)!))).toEqual([])
  expect(linkOf(b)!.session).toBe('9f9f9f9f')
  const closed = applyReport(b, { closed: [{ items: 'retro', state: 'closed', sessionId: '9f9f9f9f-0000-4000-8000-000000000000' }] }, 6_000, REPO).board
  expect(pickableItems(currentPhase(activeRun(closed)!)).map(i => i.id)).toEqual(['p2', 'p3'])
  expect(linkOf(closed)).toMatchObject({ at: 2_000, session: '9f9f9f9f', closing: { state: 'closed', sessionId: '9f9f9f9f-0000-4000-8000-000000000000' } })
  // Un nouvel envoi fait par une version d'avant, puis annulé : la fermeture précédente reste notée.
  const again = withItemsLink(closed, ['p2', 'p3'], 7_000)
  expect(currentPhase(activeRun(again)!).linkedEarlier?.closing?.sessionId).toBe('9f9f9f9f-0000-4000-8000-000000000000')
  const cancelled = cancelLinked(again, 7_200)!.board
  expect(currentPhase(activeRun(cancelled)!).linked).toBeUndefined()
  expect(currentPhase(activeRun(cancelled)!).linkedEarlier?.closing?.sessionId).toBe('9f9f9f9f-0000-4000-8000-000000000000')
})

test('un worktree unique par envoi de pistes, au nom du parcours : pistes-<parcours>-1, puis -2', () => {
  const launched = linkSession(withItemsLink(retro(), ['p1', 'p3'], 2_000), '9f9f9f9f', 2_200)!.board
  const judgedOnce = applyReport(launched, { items: [{ ...PISTES[0], status: 'done' }, PISTES[1], { ...PISTES[2], status: 'done' }] }, 3_000, REPO)
  // La procédure de fermeture nomme la branche de cet envoi.
  expect(judgedOnce.text).toContain('worktree-pistes-retro-du-groupe-a-1 (lancée par le CLI), pistes-retro-du-groupe-a-1 ou claude/pistes-retro-du-groupe-a-1-<suffixe>')
  const closed = applyReport(judgedOnce.board, { closed: [{ items: 'retro', state: 'closed' }] }, 3_100, REPO).board
  // Le deuxième envoi d'une version d'avant : sa fermeture nomme la branche -2.
  const second = linkSession(withItemsLink(closed, ['p2'], 4_000), '8e8e8e8e', 4_100)!.board
  expect(applyReport(second, { items: PISTES.map(i => ({ ...i, status: 'done' })) }, 4_200, REPO).text).toContain('worktree-pistes-retro-du-groupe-a-2 (lancée par le CLI)')
})

test('la rétro ne se clôt pas avant que la session des pistes soit fermée (ou sa fermeture tentée)', () => {
  const early = applyReport(judged(), { complete: true }, 5_000, REPO)
  expect(early.text).toContain('not finished: the linked session of the items is not closed yet')
  expect(activeRun(early.board)?.status).toBe('active')
  expect(early.text).toContain('Close now: the linked session of the Pistes')
  // Le résultat et la clôture dans le même appel : la rétro se clôt.
  expect(applyReport(judged(), { closed: [{ items: 'retro', state: 'closed' }], complete: true }, 5_000, REPO).board.runs[0]!.status).toBe('done')
  expect(applyReport(judged(), { closed: [{ items: 'retro', state: 'stopped', why: 'x' }], complete: true }, 5_000, REPO).board.runs[0]!.status).toBe('done')
  // À archiver dans l'app : la rétro attend l'archivage, puis « closed ».
  expect(activeRun(applyReport(judged(), { closed: [{ items: 'retro', state: 'app', why: 'archive' }], complete: true }, 5_000, REPO).board)?.status).toBe('active')
  // Sans git, la ligne « à archiver » ne parle d'aucun worktree.
  const app = applyReport(judged(), { closed: [{ items: 'retro', state: 'app', why: 'archive' }] }, 5_000, REPO).board
  expect(applyReport(app, { note: 'point' }, 6_000, { isRepo: false }).text).toContain('once the user says it is archived (no git here, so no worktree to remove),')
})

test('le panneau de la rétro : « fermer d’abord la session précédente », puis arrêtée avec « ↻ Relancer la fermeture », à archiver, fermée', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 90_000_000 })
  // Un envoi de p1 enregistré avant la demande de découpage, encore sans session.
  const old = { ...activeRun(withItemsLink(retro(), ['p1'], 2_000))!, status: 'paused' as const, owner: undefined }
  mock.store(on, { 'board:': { ...emptyBoard('', 'p'), deleted: [], runs: [old], activeId: null } })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('tool.call', { tool: START }, () => ({ result: { text: 'Started session local_abc123 (name: retro-pistes).' } }))
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.tool.call({ tool: TOOL, resume: old.id } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'linked-retry' })
  await ui.unmount()
  // Le texte des pistes demande la fermeture après la fusion et les verdicts.
  // Le worktree de cet envoi porte son numéro.
  expect(filled.at(-1)).toMatch(/-w 'pistes-[a-z0-9-]*1' \(un worktree à elle\)/)
  expect(filled.at(-1)).toContain('puis, si la session est close (la réponse de l’outil la liste « Close now »), la fermer selon la procédure qu’elle donne et envoyer {"closed": [...]}, et enfin {"complete": true}')
  await $.tool.call({ tool: START, title: 'Rétro > Pistes · contrôles' } as any)
  await $.tool.call({ tool: TOOL, items: [{ ...PISTES[0], status: 'done' }, PISTES[1], PISTES[2]] } as any)
  const panel = async (surface: 'terminal' | 'desktop') => {
    for (let i = 0; i < 6; i++) await clock.advance(1000)
    const u = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    const found = {
      pick: await u.find({ key: 'item-pick-p2' }),
      first: await u.find({ type: 'Text', text: /fermer d.abord la session précédente/ }),
      stopped: await u.find({ type: 'Text', text: /fermeture arrêtée : \.env ignoré/ }),
      relaunch: await u.find({ key: 'close-linked-items' }),
      app: await u.find({ type: 'Text', text: /à archiver dans l.app/ }),
      closed: await u.find({ type: 'Text', text: /session et worktree fermés/ }),
    }
    return { u, ...found }
  }
  let p = await panel('terminal')
  expect(p.pick).toBeUndefined()
  expect(p.first).toBeDefined()
  expect(p.relaunch).toBeUndefined()
  await p.u.unmount()
  await $.tool.call({ tool: TOOL, closed: [{ items: 'mattpocock-skills:retro', state: 'stopped', why: '.env ignoré' }] } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    p = await panel(surface)
    expect(p.stopped).toBeDefined()
    expect(p.first).toBeDefined()
    expect(String(p.relaunch?.props?.label)).toMatch(/^↻.Relancer la fermeture$/)
    await p.u.unmount()
  }
  p = await panel('terminal')
  await p.u.press({ key: 'close-linked-items' })
  await p.u.unmount()
  expect(filled.at(-1)).toContain('Ferme la session des pistes de la phase Rétro')
  expect(filled.at(-1)).toContain('{"closed": [{"items": "retro", "state": "closed"')
  expect(JSON.stringify(await $.tool.call({ tool: TOOL, note: 'point' } as any))).toContain('Close now: the linked session of the Pistes')
  await $.tool.call({ tool: TOOL, closed: [{ items: 'retro', state: 'app', why: 'session de l’app' }] } as any)
  p = await panel('terminal')
  expect(p.app).toBeDefined()
  await p.u.unmount()
  await $.tool.call({ tool: TOOL, closed: [{ items: 'retro', state: 'closed' }] } as any)
  p = await panel('terminal')
  expect(p.closed).toBeDefined()
  expect(p.first).toBeUndefined()
  expect(p.pick).toBeDefined()
  await p.u.unmount()
})

test('le texte du bug fait arrêter la session à la fin, seulement si elle ne travaille plus et qu’aucune question n’attend', async ($, on) => {
  mock.clock(on, { now: 91_000_000 })
  mock.store(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'a1', name: 'Un' }] } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'any-bug' })
  await ui.unmount()
  const text = filled.at(-1)!
  // Après un correctif vérifié comme après un échec : la session s'arrête, au repos et sans question en attente.
  expect(text).toContain(
    'Dans les deux cas, arrêter la session, seulement si elle ne travaille plus (claude agents --json : "status": "idle", pas "state": "working" ; ListAgents pour une session de l’app) et qu’aucune question de sa part n’attend : claude stop <id> (sa conversation est gardée) ; dans l’app, l’archiver par l’outil de session de l’app, sinon me dire le geste',
  )
  expect(text).toContain('après un échec, avant de me proposer la deuxième tentative (une nouvelle session ; le transcript de la première reste) ou de replanifier ; après un correctif vérifié et commité, une fois le parcours repris ici')
  expect(text.indexOf('arrêter la session')).toBeGreaterThan(text.indexOf('si le bug est toujours là'))
  expect(text.indexOf('arrêter la session')).toBeLessThan(text.indexOf('Bug : '))
})
