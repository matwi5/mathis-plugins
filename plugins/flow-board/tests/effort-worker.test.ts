// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { playStep, stepUsage, stoppedStep } from './flux-turn-step.ts'
import { TOOL, settle, start, world, writeBoard } from './monde-coordination.ts'

import { leadEffortPill, workerTicketEffort } from '../hooks/effort.ts'
import { applyReport, emptyBoard, newRun, restoreDelegate } from '../hooks/model.ts'
import { FABLE_MARK_NOT_SET } from '../hooks/register.tsx'
import { updateDelegateMain } from '../hooks/relay.ts'
import type { Board, Run, Ticket } from '../types'

// L'effort d'un worker de groupe, requête par requête : high au moins pendant un ticket sensible en cours
// (le ticket que son relais dit « doing », sa sensibilité lue dans la mission), l'effort de la session sinon.

const T0 = 900_000_000

/**
 * Le moteur des tests de coordination, et l'effort de chaque requête telle qu'elle part ; `sessionModel` : ce que
 * rend `$.session.model()` (sans lui, l'appel n'a pas de réponse : le mod n'impose aucun modèle) ; `models` : le
 * modèle de chaque requête telle qu'elle part.
 */
const engine = (on: any, o: { sessionModel?: string } = {}) => {
  const w = world(on)
  const sent: { agentId?: string; effort?: string }[] = []
  const models: string[] = []
  if (o.sessionModel !== undefined) on('session.model', () => ({ value: o.sessionModel }))
  const answer = stoppedStep(stepUsage('claude-opus-5-5'))
  on('turn.step', async function* ($: unknown, e: any) {
    sent.push({ agentId: e.agentId, effort: e.effort })
    models.push(e.model)
    return yield* answer($, e)
  })
  return { w, sent, models }
}

/** La mission du groupe A dans le fichier des missions : t1 sensible, t2 non, t3 muet. */
const missionWith = (w: ReturnType<typeof world>, tickets: Ticket[]): Run => {
  const run = newRun('implement', T0 - 6000, 'Boutique')
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = { tickets, groups: [{ id: 'A', name: 'A', tickets: tickets.map(t => t.id) }, { id: 'B', name: 'B', tickets: [] }] }
  const mission = { ...(applyReport(base, report, T0 - 5000).board.runs[0] as Run), status: 'active' as const, owner: 'session-B' }
  writeBoard(w, b => ({ ...b, runs: [mission] }))
  return mission
}

const TICKETS: Ticket[] = [
  { id: 't1', name: 'Un', status: 'todo', sensitive: true, files: ['a.ts'] },
  { id: 't2', name: 'Deux', status: 'todo', sensitive: false, files: ['b.ts'] },
  { id: 't3', name: 'Trois', status: 'todo', files: ['c.ts'] },
]

const say = ($: any, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input } as any)

test('un worker sur un ticket « doing » sensible part en high, puis à l’effort de sa session sur un ticket non sensible', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  await say($, { set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(sent.map(s => s.effort)).toEqual(['high', 'medium'])
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 160, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

/** Les textes du bandeau, au terminal et sur desktop (espaces insécables rendues). */
const bandTexts = async ($: any): Promise<string[][]> => {
  const out: string[][] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'flow-board', surface, ...BAND })
    out.push((await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '').replace(/ /g, ' ')))
    await band.unmount()
  }
  return out
}

test('le bandeau du worker dit l’effort imposé et sa raison quand la règle change l’effort, rien sinon', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : high, ticket sensible t1 en cours')
  // Un ticket non sensible : rien d'imposé, rien au bandeau.
  await say($, { set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts.some(t => t.startsWith('effort'))).toBe(false)
})

test('un ticket muet, ou une mission qui ne se lit pas, donne high ; un relais illisible aussi', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  // t3 ne dit pas s'il est sensible : il compte comme sensible.
  await say($, { set: [{ id: 't3', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : high, ticket t3 en cours, sensibilité inconnue')
  // Un ticket absent de la mission : sa sensibilité ne se lit pas.
  await say($, { set: [{ id: 't3', status: 'done' }, { id: 't9', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'low' })
  // Le relais de la session illisible : on ne sait pas quel ticket est en cours.
  w.mem[`relay:${mission.id}:session-A`] = 'pas une entrée'
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : high, ticket en cours illisible')
  expect(sent.map(s => s.effort)).toEqual(['high', 'high', 'high'])
})

test('une mission que ni le board d’ici ni celui du dépôt principal ne donne : high pendant un ticket en cours', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { sent } = engine(on)
  await start($)
  await say($, { delegate: 'run-w', group: 'A', main: '[abc123]' })
  await say($, { set: [{ id: 't2', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(sent.map(s => s.effort)).toEqual(['high'])
})

test('aucun ticket en cours : l’effort de la session reste ; xhigh reste xhigh ; un spécialiste n’est jamais touché', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  for (const effort of ['low', 'medium']) await playStep($, { model: 'claude-opus-5-5', effort })
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'xhigh' })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium', agentId: 'a1' })
  for (const texts of await bandTexts($)) expect(texts.some(t => t.startsWith('effort'))).toBe(false)
  expect(sent).toEqual([{ effort: 'low' }, { effort: 'medium' }, { effort: 'xhigh' }, { agentId: 'a1', effort: 'medium' }].map(s => ({ agentId: undefined, ...s })))
})

test('une discussion qui faisait un lot puis devient un worker : sans ticket en cours, son effort est celui de son lancement', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { sent } = engine(on)
  await start($)
  // D'abord un lot ouvert ici : sa règle impose son niveau à une requête.
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await say($, { tickets: [{ id: '1', name: 'Un', status: 'todo', sensitive: true, files: ['a.ts'] }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'low' })
  await say($, { delegate: 'run-w', group: 'A', main: '[abc123]' })
  for (const effort of ['low', 'medium', 'xhigh']) await playStep($, { model: 'claude-opus-5-5', effort })
  for (const texts of await bandTexts($)) expect(texts.some(t => t.startsWith('effort'))).toBe(false)
  expect(sent.map(s => s.effort)).toEqual(['medium', 'low', 'medium', 'xhigh'])
})

test('un id de ticket hors forme (celle d’isSafeId, 24 signes au plus) n’est pas écrit au bandeau ; le high reste', () => {
  const mission = { tickets: [] } as unknown as Run
  for (const id of ['a'.repeat(25), 'a b', '#12', 'x\u2028y']) {
    const rule = workerTicketEffort([id], mission)
    expect(rule).toEqual({ level: 'high', rule: 'sensitive', how: 'floor', isUnknown: true })
    expect(leadEffortPill(rule!, 'medium')).toBe('effort : high, ticket en cours illisible')
  }
  expect(workerTicketEffort(['a'.repeat(24)], mission)?.ticket).toBe('a'.repeat(24))
})

// ─── La marque « worker Fable » de la délégation ──────────────
// Invariant fixé par Mathis : une session ne tourne sur Fable que si sa délégation porte une marque valide, posée
// par son premier appel `delegate` ; une marque absente, illisible, hors forme ou perdue la laisse sur Opus.

const FABLE_WORKER = 'This session is a Fable worker'
const DELEGATE_KEY = 'delegate:session-A'

/** La délégation gardée dans le magasin de la session, telle que `keepDelegate` l'écrit. */
const keptOf = (w: ReturnType<typeof world>): Record<string, unknown> | null => (w.mem[DELEGATE_KEY] ?? null) as Record<string, unknown> | null

test('marque Fable : le premier appel delegate qui la porte la pose, la réponse le dit, le magasin la garde', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  const first = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(first).toContain(FABLE_WORKER)
  expect(keptOf(w)).toMatchObject({ run: mission.id, group: 'A', model: 'fable' })
  // Un appel suivant pour la même mission, sans model : la marque reste ; avec "fable" : inchangée.
  const again = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]' }))
  expect(again).toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBe('fable')
  const twice = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(twice).toContain(FABLE_WORKER)
  expect(twice).not.toContain('\\"model\\" ignored')
  expect(keptOf(w)?.model).toBe('fable')
  // Un appel sans delegate ne touche pas à la marque.
  await say($, { note: 'x', model: 'fable' })
  expect(keptOf(w)?.model).toBe('fable')
})

test('marque Fable : un premier appel sans marque suivi d’un appel avec "fable" reste sans marque', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  const later = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(later).toContain('\\"model\\" ignored')
  expect(later).not.toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBeUndefined()
  // Un appel sans delegate qui porte model ne la pose jamais non plus.
  await say($, { note: 'x', model: 'fable' })
  expect(keptOf(w)?.model).toBeUndefined()
})

test('marque Fable : une délégation pour une autre mission repart sans marque, même avec "fable"', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' })
  expect(keptOf(w)?.model).toBe('fable')
  const other = JSON.stringify(await say($, { delegate: 'run-autre', group: 'B', main: '[abc123]', model: 'fable' }))
  expect(other).toContain('never set on a delegation to another mission')
  expect(other).not.toContain(FABLE_WORKER)
  expect(keptOf(w)).toMatchObject({ run: 'run-autre', group: 'B' })
  expect(keptOf(w)?.model).toBeUndefined()
})

for (const [label, model] of [['opus', 'opus'], ['vide', ''], ['nombre', 42], ['200 signes', 'f'.repeat(200)], ['majuscule', 'Fable'], ['objet', { v: 'fable' }]] as [string, unknown][]) {
  test(`marque Fable : "model" hors forme (${label}) est refusé pour ce seul champ, sans marque, le reste de l’appel appliqué`, { timeoutMs: 20000 }, async ($, on) => {
    mock.clock(on, { now: T0 })
    const { w } = engine(on)
    const mission = missionWith(w, TICKETS)
    await start($)
    const answer = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model }))
    expect(answer).toContain('\\"model\\" refused')
    expect(answer).not.toContain(FABLE_WORKER)
    // Le reste de l'appel s'applique : la délégation est posée, avec son groupe et sa référence.
    expect(keptOf(w)).toMatchObject({ run: mission.id, group: 'A', main: '[abc123]' })
    expect(keptOf(w)?.model).toBeUndefined()
    // Et un appel suivant avec "fable" ne la pose plus : seul le premier appel le pouvait.
    await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' })
    expect(keptOf(w)?.model).toBeUndefined()
  })
}

test('marque Fable : un rechargement rend la marque gardée, et la première réponse le dit', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  w.mem[DELEGATE_KEY] = { run: mission.id, at: T0 - 1000, group: 'A', main: '[abc123]', model: 'fable' }
  await start($)
  // Le board vient du stockage : la délégation gardée revient avec sa marque.
  const restored = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]' }))
  expect(restored).toContain(FABLE_WORKER)
  // Puis le mod se recharge : la première réponse dit la marque gardée.
  await start($)
  expect(JSON.stringify(await say($, { note: 'reprise' }))).toContain('Fable worker mark kept')
})

test('marque Fable : une valeur relue hors forme laisse la délégation revenir sans marque', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  w.mem[DELEGATE_KEY] = { run: mission.id, at: T0 - 1000, group: 'A', main: '[abc123]', model: 'opus' }
  await start($)
  const restored = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(restored).not.toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBeUndefined()
})

test('restoreDelegate : la marque ne revient que sous sa forme valide ; un magasin illisible ne rend ni délégation ni marque', () => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 'main' }
  const loaded: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: null }
  const kept = { run: run.id, at: 1_000, group: 'A' }
  expect(restoreDelegate(loaded, { ...kept, model: 'fable' }, 2_000).delegate?.model).toBe('fable')
  for (const model of ['opus', '', 'Fable', 42, null, { v: 'fable' }, 'f'.repeat(200)]) {
    const d = restoreDelegate(loaded, { ...kept, model }, 2_000).delegate
    expect(d).toMatchObject({ run: run.id, group: 'A' })
    expect(d?.model).toBeUndefined()
  }
  // Lecture ratée du magasin (rien, ou une valeur qui n'est pas une délégation) : pas de délégation, donc pas de marque.
  for (const unread of [undefined, null, 'pas une délégation', { model: 'fable' }]) expect(restoreDelegate(loaded, unread, 2_000).delegate).toBeUndefined()
  // Une délégation périmée (plus de trois jours) ne revient pas, sa marque non plus.
  expect(restoreDelegate(loaded, { ...kept, model: 'fable' }, 1_000 + 4 * 24 * 3_600_000).delegate).toBeUndefined()
})

test('la mise à jour de la référence du manager garde la marque', () => {
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [], activeId: null, delegate: { run: 'run-1', at: 1_000, main: '[old]', model: 'fable' } }
  expect(updateDelegateMain(board, { v: 1, run: 'run-1', main: '[new]', at: 2_000 })?.delegate).toMatchObject({ main: '[new]', model: 'fable' })
})

test('marque Fable : la clé de la délégation illisible au chargement, l’appel suivant avec "fable" ne pose aucune marque', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  w.probe.refuseRead = key => key === DELEGATE_KEY
  await start($)
  const answer = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(answer).toContain('cannot be sure this call is the session')
  expect(answer).not.toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBeUndefined()
})

test('marque Fable : une délégation écartée au chargement (trop ancienne) ne se fait pas remarquer par l’appel suivant', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  // Gardée sans marque il y a quatre jours : le chargement l'écarte, la session n'en a plus aucune.
  w.mem[DELEGATE_KEY] = { run: mission.id, at: T0 - 4 * 24 * 3_600_000, group: 'A', main: '[abc123]' }
  await start($)
  const answer = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(answer).toContain('cannot be sure this call is the session')
  expect(answer).not.toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBeUndefined()
})

test('marque Fable : l’appel delegate d’un spécialiste ne pose jamais la marque', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  const answer = JSON.stringify(await say($, { agentId: 'a-specialiste', delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(answer).toContain("a subagent's call never sets the Fable mark")
  expect(answer).not.toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBeUndefined()
  // Puis le fil principal : la délégation est déjà là, sans marque ; la marque ne vient plus.
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' })
  expect(keptOf(w)?.model).toBeUndefined()
})

test('marque Fable : une délégation écartée au chargement (mission finie) ne se fait pas remarquer par l’appel suivant', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  writeBoard(w, b => ({ ...b, runs: [{ ...mission, status: 'done' as const }] }))
  w.mem[DELEGATE_KEY] = { run: mission.id, at: T0 - 1000, group: 'A', main: '[abc123]' }
  await start($)
  const answer = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(answer).toContain('cannot be sure this call is the session')
  expect(answer).not.toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBeUndefined()
})

test('marque Fable : une valeur hors forme sur un appel suivant laisse la marque telle quelle, et la réponse le dit ; "model" sans delegate est dit ignoré', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' })
  const later = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'opus' }))
  expect(later).toContain('stays as it was')
  expect(later).not.toContain('no Fable mark was set')
  expect(later).toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBe('fable')
  const alone = JSON.stringify(await say($, { note: 'x', model: 'fable' }))
  expect(alone).toContain('\\"model\\" ignored: it is read only with \\"delegate\\"')
})

test('marque Fable : après un premier appel delegate sans marque et une écriture ratée, un changement de racine qui relit la clé vide ne rouvre pas le premier appel', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const root = { v: '' }
  on('session.root', () => ({ value: root.v }))
  const mission = missionWith(w, TICKETS)
  // La délégation ne s'écrit jamais dans le magasin : relue après le changement de racine, la clé est vide.
  w.probe.refuseStore = key => key === DELEGATE_KEY
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  root.v = '/ailleurs'
  await clock.advance(6000)
  const answer = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  // Le board rechargé n'a plus la délégation (pas la réponse « même mission ») : seul le verrou fermé l'en garde.
  expect(answer).toContain('cannot be sure this call is the session')
  expect(answer).not.toContain(FABLE_WORKER)
})

test('marque Fable : un premier appel dont l’état ne s’écrit pas (il bouge à chaque essai) ne dit jamais « Fable worker », dit la marque non posée, et ne ferme pas le verrou', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  let isRefused = false
  on('state.set', (_$: unknown, e: any, next: any) => (isRefused && e.key === 'board' && e.ifVersion !== undefined ? { value: { isSet: false, version: e.ifVersion + 1 } } : next(e)))
  const mission = missionWith(w, TICKETS)
  await start($)
  isRefused = true
  const lost = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  isRefused = false
  expect(lost).toContain('Nothing of this \\"delegate\\" call was recorded')
  expect(lost).toContain(JSON.stringify(FABLE_MARK_NOT_SET).slice(1, -1))
  expect(lost).not.toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBeUndefined()
  // Rien n'étant enregistré, le même appel renvoyé est encore le premier : la marque se pose.
  const again = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(again).toContain(FABLE_WORKER)
  expect(keptOf(w)).toMatchObject({ run: mission.id, model: 'fable' })
  // Écrite, la délégation ferme le verrou : un appel suivant ne la change plus.
  const third = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]' }))
  expect(third).toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBe('fable')
})

test('marque Fable : un premier appel refusé avant toute écriture dit la marque non posée et rend le verrou ; le renvoi la pose', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  // "coordinate" hors forme : refusé en entier, rien de l'appel ne s'écrit.
  const refused = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable', coordinate: 'x' }))
  expect(refused).toContain('nothing of this call was recorded')
  expect(refused).toContain(JSON.stringify(FABLE_MARK_NOT_SET).slice(1, -1))
  expect(refused).not.toContain(FABLE_WORKER)
  expect(keptOf(w)).toBeNull()
  // Rien n'étant enregistré, le renvoi est encore le premier appel : la marque se pose.
  const again = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(again).toContain(FABLE_WORKER)
  expect(again).not.toContain(JSON.stringify(FABLE_MARK_NOT_SET).slice(1, -1))
  expect(keptOf(w)).toMatchObject({ run: mission.id, model: 'fable' })
})

test('marque Fable : un premier appel sur un tableau de bord indisponible (l’état bouge pendant le chargement) dit la marque non posée ; le renvoi la pose', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  let isRefused = false
  on('state.set', (_$: unknown, e: any, next: any) => (isRefused && e.key === 'board' && e.ifVersion !== undefined ? { value: { isSet: false, version: e.ifVersion + 1 } } : next(e)))
  on('session.root', () => ({ value: '/proj/.claude/worktrees/groupe-A' }))
  on('session.repo', () => ({ value: { root: '/proj', remote: null, internal: false, name: null } }))
  const mission = missionWith(w, TICKETS)
  // Au démarrage, rien ne se charge : le premier appel charge le board lui-même, et l'état bouge à chaque essai.
  w.disk.unreadable = true
  w.probe.refuseRead = key => key.startsWith('board:')
  await start($)
  w.disk.unreadable = false
  w.probe.refuseRead = undefined
  isRefused = true
  const lost = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  isRefused = false
  expect(lost).toContain('Dashboard unavailable')
  expect(lost).toContain(JSON.stringify(FABLE_MARK_NOT_SET).slice(1, -1))
  expect(lost).not.toContain(FABLE_WORKER)
  expect(keptOf(w)).toBeNull()
  const again = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(again).toContain(FABLE_WORKER)
  expect(keptOf(w)).toMatchObject({ run: mission.id, model: 'fable' })
})

test('marque Fable : deux appels delegate parallèles avec "fable" : un seul tient le premier appel, et la réponse ne dit « Fable worker » que sous la marque gardée', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const mission = missionWith(w, TICKETS)
  await start($)
  const answers = (await Promise.all([
    say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }),
    say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }),
  ])).map(a => JSON.stringify(a))
  // Seul celui qui tient le verrou peut poser la marque ; l'autre, jamais le premier, la garde telle qu'il la trouve.
  // Quel que soit l'ordre des écritures, une réponse ne dit « Fable worker » que sous la marque gardée.
  const marked = keptOf(w)?.model === 'fable'
  expect(keptOf(w)?.run).toBe(mission.id)
  expect(answers.some(a => a.includes(FABLE_WORKER))).toBe(marked)
  expect(answers.filter(a => a.includes('cannot be sure this call is the session')).length).toBeLessThanOrEqual(1)
})

test('marque Fable : après un rechargement du mod, un changement de racine qui relit la clé vide ne fait pas d’un appel delegate le premier', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w } = engine(on)
  const root = { v: '' }
  on('session.root', () => ({ value: root.v }))
  const mission = missionWith(w, TICKETS)
  await start($)
  // Le mod se recharge (le board reste en mémoire) : la session a pu faire son premier appel avant.
  await start($)
  root.v = '/ailleurs'
  await clock.advance(6000)
  const answer = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(answer).toContain('cannot be sure this call is the session')
  expect(answer).not.toContain(FABLE_WORKER)
  expect(keptOf(w)?.model).toBeUndefined()
})

test('marque Fable : un chargement du démarrage sorti tôt (fichier du dépôt principal illisible) laisse le premier appel delegate poser la marque', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w } = engine(on)
  on('session.root', () => ({ value: '/proj/.claude/worktrees/groupe-A' }))
  on('session.repo', () => ({ value: { root: '/proj', remote: null, internal: false, name: null } }))
  const mission = missionWith(w, TICKETS)
  // Au démarrage, le fichier du dépôt principal ne se lit pas : rien ne se charge, le verrou n'est pas encore lu.
  w.disk.unreadable = true
  w.probe.refuseRead = key => key.startsWith('board:')
  await start($)
  w.disk.unreadable = false
  w.probe.refuseRead = undefined
  // Le premier appel delegate charge lui-même le board de son worktree (clé lue vide) et prend le verrou.
  const first = JSON.stringify(await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' }))
  expect(first).toContain(FABLE_WORKER)
  expect(keptOf(w)).toMatchObject({ run: mission.id, model: 'fable' })
})

// ─── Le worker Fable : ses requêtes sur Fable 5.2 high ─────────────────────────────────────

const OPUS = 'claude-opus-5-5'

test('worker Fable : chaque requête du fil principal part sur Fable 5.2 en high exact, le bandeau le dit ; un spécialiste n’est jamais réécrit', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent, models } = engine(on, { sessionModel: OPUS })
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' })
  for (const effort of ['medium', 'xhigh', 'low']) await playStep($, { model: OPUS, effort })
  await playStep($, { model: OPUS, effort: 'medium', agentId: 'a1' })
  for (const texts of await bandTexts($)) expect(texts).toContain('modèle : Fable 5.2 high, worker Fable')
  // Un ticket sensible en cours ne change rien : déjà high, toujours Fable.
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await playStep($, { model: OPUS, effort: 'medium' })
  expect(models).toEqual(['fable', 'fable', 'fable', OPUS, 'fable'])
  expect(sent.map(s => s.effort)).toEqual(['high', 'high', 'high', 'medium', 'high'])
})

test('worker sans marque : aucun modèle imposé, la règle d’un worker d’aujourd’hui', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent, models } = engine(on, { sessionModel: OPUS })
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  await playStep($, { model: OPUS, effort: 'medium' })
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await playStep($, { model: OPUS, effort: 'medium' })
  expect(models).toEqual([OPUS, OPUS])
  expect(sent.map(s => s.effort)).toEqual(['medium', 'high'])
})

test('worker Fable : une marque relue hors forme ne fait rien passer sur Fable', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent, models } = engine(on, { sessionModel: OPUS })
  const mission = missionWith(w, TICKETS)
  w.mem[DELEGATE_KEY] = { run: mission.id, at: T0 - 1000, group: 'A', main: '[abc123]', model: 'Fable' }
  await start($)
  // La délégation revient bien (la règle d'un worker joue : high pendant un ticket sensible), sans Fable.
  await say($, { set: [{ id: 't1', status: 'doing' }] })
  await playStep($, { model: OPUS, effort: 'medium' })
  expect(sent.map(s => s.effort)).toEqual(['high'])
  expect(models).toEqual([OPUS])
})

test('worker Fable : une requête repliée sur un autre modèle part telle quelle, à la règle d’un worker ; un /model tapé arrête la réécriture', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent, models } = engine(on, { sessionModel: OPUS })
  on('classic.PostModelSwitch', () => ({}))
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' })
  await playStep($, { model: 'claude-opus-4-8', effort: 'medium' })
  await playStep($, { model: OPUS, effort: 'medium' })
  await ($ as any).classic.PostModelSwitch({ session_id: 'session-A', transcript_path: '/t', cwd: '', hook_event_name: 'PostModelSwitch', from_model: OPUS, to_model: OPUS, requested_model: 'opus', source: 'command', context_tokens: 0 })
  await playStep($, { model: OPUS, effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts.some(t => t.startsWith('modèle'))).toBe(false)
  expect(models).toEqual(['claude-opus-4-8', 'fable', OPUS])
  expect(sent.map(s => s.effort)).toEqual(['medium', 'high', 'medium'])
})

// ─── Le repli « Fable indisponible » ───────────────────────────────────────────────────────

/** Un échec de tour, comme le moteur l'émet sur une limite atteinte. */
const stopFailure = ($: any, error: string) =>
  $.classic.StopFailure({ session_id: 'session-A', transcript_path: '/t', cwd: '', hook_event_name: 'StopFailure', error })

const FABLE_OFF_TOAST = 'Fable indisponible : retour sur Opus jusqu’à la fin de la session'
const FABLE_RESUME = 'Fable indisponible : reprends sur Opus là où tu t’es arrêté'

for (const error of ['rate_limit', 'billing_error']) {
  test(`repli Fable (${error}) : un worker Fable repart sur Opus en xhigh, un seul toast, un seul message de reprise, rien au deuxième échec`, { timeoutMs: 20000 }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const { w, sent, models } = engine(on, { sessionModel: OPUS })
    on('classic.StopFailure', () => ({}))
    const mission = missionWith(w, TICKETS)
    await start($)
    await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' })
    await playStep($, { model: OPUS, effort: 'medium' })
    await stopFailure($, error)
    await clock.advance(1000)
    await playStep($, { model: OPUS, effort: 'medium' })
    for (const texts of await bandTexts($)) {
      expect(texts).toContain('effort : xhigh, repli sur Opus')
      expect(texts.some(t => t.includes('Fable'))).toBe(false)
    }
    // Un deuxième échec, après une requête sur Opus (quota global) : ni toast ni message de plus.
    await stopFailure($, error)
    await clock.advance(1000)
    await playStep($, { model: OPUS, effort: 'medium' })
    expect(models).toEqual(['fable', OPUS, OPUS])
    expect(sent.map(s => s.effort)).toEqual(['high', 'xhigh', 'xhigh'])
    expect(w.toasts.filter(t => t === FABLE_OFF_TOAST)).toHaveLength(1)
    expect(w.prompts.filter(p => p.includes(FABLE_RESUME))).toHaveLength(1)
  })
}

test('repli Fable : un échec après une requête partie sur Opus, ou une autre erreur, n’éteint rien', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w, models } = engine(on, { sessionModel: OPUS })
  on('classic.StopFailure', () => ({}))
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' })
  // Une requête repliée (autre modèle) puis une limite : la requête n'était pas sur Fable.
  await playStep($, { model: 'claude-opus-4-8', effort: 'medium' })
  await stopFailure($, 'rate_limit')
  await playStep($, { model: OPUS, effort: 'medium' })
  // Une autre erreur après une requête Fable : rien non plus.
  await stopFailure($, 'overloaded')
  await clock.advance(1000)
  await playStep($, { model: OPUS, effort: 'medium' })
  expect(models).toEqual(['claude-opus-4-8', 'fable', 'fable'])
  expect(w.toasts.filter(t => t === FABLE_OFF_TOAST)).toHaveLength(0)
  expect(w.prompts.filter(p => p.includes(FABLE_RESUME))).toHaveLength(0)
})

test('repli Fable : un message de reprise refusé (le message n’entre pas) se dit par un toast', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w } = engine(on, { sessionModel: OPUS })
  on('classic.StopFailure', () => ({}))
  const mission = missionWith(w, TICKETS)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' })
  await playStep($, { model: OPUS, effort: 'medium' })
  w.submit.drop = true
  await stopFailure($, 'rate_limit')
  await clock.advance(1000)
  expect(w.prompts.filter(p => p.includes(FABLE_RESUME))).toHaveLength(0)
  expect(w.toasts).toContain('Fable indisponible : le message de reprise n’est pas entré, le worker reste arrêté ; dis-lui de reprendre sur Opus')
})

// ─── Un ticket de jugement en cours chez un worker ──────────────────────
// Invariant (décision de Mathis du 13/11/2026, celui de la ligne « Jugement ») : un ticket n'est traité en xhigh que
// si la mission le dit « Jugement : oui » ; un drapeau absent, illisible ou hors forme, ou une mission qui ne se lit
// pas, laisse le ticket à l'effort calculé, jamais l'inverse.

/**
 * La mission du groupe A : j1 de jugement, j2 de jugement et sensible, n1 à false, n2 sans drapeau, h1 hors forme.
 * `missionWith` passe par l'envoi, qui ignore la valeur hors forme de h1 : un test qui l'éprouve la réécrit dans le
 * fichier des missions (`writeBoard`).
 */
const JUDGED: Ticket[] = [
  { id: 'j1', name: 'Jugement', status: 'todo', sensitive: false, judgment: true, files: ['a.ts'] },
  { id: 'j2', name: 'Jugement sensible', status: 'todo', sensitive: true, judgment: true, files: ['b.ts'] },
  { id: 'n1', name: 'Non', status: 'todo', sensitive: false, judgment: false, files: ['c.ts'] },
  { id: 'n2', name: 'Muet', status: 'todo', sensitive: false, files: ['d.ts'] },
  { id: 'h1', name: 'Hors forme', status: 'todo', sensitive: false, judgment: 'oui' as unknown as boolean, files: ['e.ts'] },
]

test('jugement : un ticket « Jugement : oui » en cours part en xhigh au moins ; sensible aussi, xhigh ; un effort plus haut reste', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, JUDGED)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  await say($, { set: [{ id: 'j1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts).toContain('effort : xhigh, ticket de jugement j1 en cours')
  await playStep($, { model: 'claude-opus-5-5', effort: 'max' })
  await say($, { set: [{ id: 'j1', status: 'done' }, { id: 'j2', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'high' })
  expect(sent.map(s => s.effort)).toEqual(['xhigh', 'max', 'xhigh'])
})

test('jugement : drapeau à false, absent ou hors forme : la règle d’avant (rien pour un ticket non sensible), jamais xhigh', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, JUDGED)
  // Une valeur hors forme déjà gardée dans la mission (l'envoi l'aurait ignorée) : écrite telle quelle.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => ({ ...r, tickets: r.tickets.map(t => (t.id === 'h1' ? ({ ...t, judgment: 'oui' } as unknown as Ticket) : t)) })) }))
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  // L'effet d'abord : un ticket de jugement en cours part en xhigh dans les mêmes conditions.
  await say($, { set: [{ id: 'j1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  await say($, { set: [{ id: 'j1', status: 'done' }] })
  for (const id of ['n1', 'n2', 'h1']) {
    await say($, { set: [{ id, status: 'doing' }] })
    await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
    await say($, { set: [{ id, status: 'done' }] })
  }
  expect(sent.map(s => s.effort)).toEqual(['xhigh', 'medium', 'medium', 'medium'])
})

test('jugement : plusieurs tickets passés en cours ensemble, dont un de jugement, donnent xhigh ; fait, ou revenu à faire, plus de xhigh', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, JUDGED)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  await say($, { set: [{ id: 'n1', status: 'doing' }, { id: 'j1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  // Revenu « à faire » : plus de xhigh, n1 (non sensible) reste seul en cours.
  await say($, { set: [{ id: 'j1', status: 'todo' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  // Repris puis fait : plus de xhigh non plus.
  await say($, { set: [{ id: 'j1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  await say($, { set: [{ id: 'j1', status: 'done' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(sent.map(s => s.effort)).toEqual(['xhigh', 'medium', 'xhigh', 'medium'])
})

test('jugement : le ticket en cours est le dernier passé « doing » ; un ticket de jugement en attente de sa revue ne donne pas son xhigh au suivant', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, JUDGED)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  await say($, { set: [{ id: 'j1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  // j1 commité, sa revue en cours : il reste « doing », et le worker commence n1 (exécution).
  await clock.advance(1000)
  await say($, { set: [{ id: 'n1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  for (const texts of await bandTexts($)) expect(texts.some(t => t.includes('ticket de jugement'))).toBe(false)
  // n1 fait : j1, encore « doing », redevient le seul ticket en cours (les correctifs de sa revue).
  await clock.advance(1000)
  await say($, { set: [{ id: 'n1', status: 'done' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(sent.map(s => s.effort)).toEqual(['xhigh', 'medium', 'xhigh'])
})

test('jugement : relais illisible, ticket absent de la mission, mission illisible : high (inchangé), jamais xhigh', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, JUDGED)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  // Un ticket absent de la mission.
  await say($, { set: [{ id: 'j9', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  // Un ticket de jugement en cours, mais le relais de la session illisible : on ne sait pas lequel.
  await say($, { set: [{ id: 'j9', status: 'done' }, { id: 'j1', status: 'doing' }] })
  w.mem[`relay:${mission.id}:session-A`] = 'pas une entrée'
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(sent.map(s => s.effort)).toEqual(['high', 'high'])
})

test('jugement : une mission qui ne se lit pas laisse le ticket à high, jamais xhigh ; workerTicketEffort ne donne xhigh que sur true', () => {
  expect(workerTicketEffort(['j1'], undefined)).toEqual({ level: 'high', rule: 'sensitive', how: 'floor', ticket: 'j1', isUnknown: true })
  const mission = { tickets: JUDGED } as unknown as Run
  expect(workerTicketEffort(['j1'], mission)).toEqual({ level: 'xhigh', rule: 'judgment', how: 'floor', ticket: 'j1' })
  expect(workerTicketEffort(['j2'], mission)?.level).toBe('xhigh')
  expect(workerTicketEffort(['n1'], mission)).toBeNull()
  expect(workerTicketEffort(['n2'], mission)).toBeNull()
  expect(workerTicketEffort(['h1'], mission)).toBeNull()
  expect(workerTicketEffort(['n1', 'j1'], mission)?.level).toBe('xhigh')
  expect(workerTicketEffort(null, mission)?.level).toBe('high')
  // Les formes relues hors forme ne donnent jamais xhigh.
  for (const judgment of ['oui', 'true', 1, null, {}, []] as unknown[]) {
    const odd = { tickets: [{ id: 'x1', name: 'X', status: 'todo', sensitive: false, judgment }] } as unknown as Run
    expect(workerTicketEffort(['x1'], odd)).toBeNull()
  }
  // Un id hors de la forme affichable : xhigh, sans id au bandeau.
  const long = { tickets: [{ id: 'a'.repeat(25), name: 'X', status: 'todo', judgment: true }] } as unknown as Run
  const rule = workerTicketEffort(['a'.repeat(25)], long)!
  expect(rule).toEqual({ level: 'xhigh', rule: 'judgment', how: 'floor' })
  expect(leadEffortPill(rule, 'medium')).toBe('effort : xhigh, ticket de jugement en cours')
})

test('jugement : le drapeau passé à false pendant le ticket, la requête suivante revient à la règle d’avant', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { w, sent } = engine(on)
  const mission = missionWith(w, JUDGED)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]' })
  await say($, { set: [{ id: 'j1', status: 'doing' }] })
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  // La discussion qui tient la mission renvoie le ticket avec "judgment": false.
  writeBoard(w, b => ({ ...b, runs: b.runs.map(r => (r.id === mission.id ? { ...r, updatedAt: r.updatedAt + 10_000, tickets: r.tickets.map(t => (t.id === 'j1' ? { ...t, judgment: false } : t)) } : r)) }))
  await settle(clock, 6)
  await playStep($, { model: 'claude-opus-5-5', effort: 'medium' })
  expect(sent.map(s => s.effort)).toEqual(['xhigh', 'medium'])
})

test('jugement : un worker Fable avec un ticket de jugement en cours reste sur Fable 5.2 high exact', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const { w, sent, models } = engine(on, { sessionModel: OPUS })
  const mission = missionWith(w, JUDGED)
  await start($)
  await say($, { delegate: mission.id, group: 'A', main: '[abc123]', model: 'fable' })
  await say($, { set: [{ id: 'j1', status: 'doing' }] })
  await playStep($, { model: OPUS, effort: 'medium' })
  expect(sent.map(s => s.effort)).toEqual(['high'])
  expect(models).toEqual(['fable'])
})
