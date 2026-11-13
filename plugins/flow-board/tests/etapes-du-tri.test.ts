import { expect, mock, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { SKILLS } from '../hooks/catalog.ts'
import { applyReport, applySkill, emptyBoard, newRun, suggestionsFor } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// Le tri recommandait entrée par entrée, attendait, puis vérifiait ; ses étapes ne portaient aucune des consignes des
// parcours de cadrage. Un tri en lot vérifie d'abord chaque entrée dans le code, puis rend un seul partage, validé une fois.

const T0 = 1_000

const boardOf = (skill: string): Board => applySkill({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [], activeId: null }, skill, { now: T0, isMain: true })!.board

const triage = (board: Board) => activeRun(board)!.phases.find(p => p.skill === 'triage')!

test('une mission de tri neuve a ses huit étapes, la vérification avant la recommandation', () => {
  const phase = triage(boardOf('mattpocock-skills:triage'))
  expect(phase.steps.map(s => s.id)).toEqual(['queue', 'context', 'verify', 'recommend', 'grill', 'sensitive', 'partition', 'apply'])
})

test('l’étape « Conséquences sensibles » du tri est celle des parcours de cadrage, la même constante', () => {
  const ofTriage = SKILLS.triage!.steps.find(s => s.id === 'sensitive')
  expect(ofTriage).toBeDefined()
  expect(ofTriage).toBe(SKILLS['to-spec']!.steps.find(s => s.id === 'sensitive'))
  expect(ofTriage).toBe(SKILLS['grill-with-docs']!.steps.find(s => s.id === 'sensitive'))
})

test('la Recommandation du tri cherche et cite les décisions comme l’Arbre des décisions des cadrages, mot pour mot', () => {
  const tree = SKILLS['grill-with-docs']!.steps.find(s => s.id === 'tree')!.hint
  const recommend = SKILLS.triage!.steps.find(s => s.id === 'recommend')!.hint
  const where = tree.slice(tree.indexOf('search its term in ') + 'search its term in '.length, tree.indexOf(' and cite in the question '))
  const cite = tree.slice(tree.indexOf('cite in the question ') + 'cite in the question '.length)
  expect(where.startsWith('every decision file')).toBe(true)
  expect(cite.startsWith('the decision found')).toBe(true)
  expect(recommend).toContain(`the entry's term in ${where}`)
  expect(recommend).toContain(`citing ${cite}`)
})

test('la Vérification du tri lit le code d’une entrée sensible avec les mots du découpage, mot pour mot', () => {
  const paths = 'the paths that write, merge, erase its data or read it to make a decision'
  expect(SKILLS['to-tickets']!.steps.find(s => s.id === 'explore')!.hint).toContain(paths)
  expect(SKILLS.triage!.steps.find(s => s.id === 'verify')!.hint).toContain(`read the function it names and ${paths}`)
})

test('une phase de tri à l’ancienne forme, menée dans l’ordre que la consigne dicte aujourd’hui : rien n’est refusé, les étapes neuves s’insèrent avant apply, elle finit comme avant', () => {
  let board = oldTriage()
  for (const [i, step] of ['context', 'verify', 'recommend', 'grill', 'sensitive', 'partition', 'apply'].entries()) {
    const out = applyReport(board, { step }, T0 + 1_000 * (i + 1))
    expect(out.text).not.toContain('is not a step')
    board = out.board
    expect(triage(board).steps.find(s => s.status === 'active')?.id).toBe(step)
  }
  const ids = triage(board).steps.map(s => s.id)
  expect(ids.indexOf('sensitive')).toBeGreaterThan(-1)
  expect(ids.indexOf('partition')).toBeGreaterThan(ids.indexOf('sensitive'))
  expect(ids.indexOf('apply')).toBeGreaterThan(ids.indexOf('partition'))
  board = applyReport(board, { complete: true }, T0 + 9_000).board
  expect(triage(board).status).toBe('done')
  const s = suggestionsFor(activeRun(board)!)
  expect(s.primary).toBe('to-tickets')
  expect(s.others.includes('implement')).toBe(true)
  expect(s.canFinish).toBe(true)
})

test('/grilling chargé pendant un tri fait passer l’étape « Approfondir » en cours', () => {
  let board = boardOf('mattpocock-skills:triage')
  board = applyReport(board, { step: 'verify' }, T0 + 1_000).board
  board = applySkill(board, 'mattpocock-skills:grilling', { now: T0 + 2_000, isMain: true })!.board
  const phase = triage(board)
  expect(phase.steps.find(s => s.status === 'active')?.id).toBe('grill')
  // Le grilling reste une étape du tri : aucune autre phase ni détour ne s'ouvre.
  expect(activeRun(board)!.phases.map(p => p.skill)).toEqual(activeRun(boardOf('mattpocock-skills:triage'))!.phases.map(p => p.skill))
})

test('les éléments du tri : une entrée de la feuille de route, une sous-ligne ou « #n », triée ou écartée', () => {
  const items = [
    { id: 'R96', label: 'R96 Carte de lancement', status: 'done' },
    { id: 'R62-a', label: 'R62-a Lien suivi par --remplace', status: 'done' },
    { id: 'R62-b', label: 'R62-b README de flow-board', status: 'dropped' },
    { id: '#12', label: '#12 Issue du tracker', status: 'doing' },
  ]
  const out = applyReport(boardOf('mattpocock-skills:triage'), { items }, T0 + 1_000)
  const kept = triage(out.board).items ?? []
  expect(kept.map(i => [i.id, i.status])).toEqual([
    ['R96', 'done'],
    ['R62-a', 'done'],
    ['R62-b', 'dropped'],
    ['#12', 'doing'],
  ])
})
/** Une mission de tri enregistrée avant ce changement : ses six anciennes étapes, dans l'ancien ordre. */
const oldTriage = (): Board => {
  const run: Run = { ...newRun('triage', T0, 'Tri'), owner: 's' }
  run.phases[0]!.steps = ['queue', 'context', 'recommend', 'verify', 'grill', 'apply'].map((id, i) => (i === 0 ? { id, status: 'active' as const, at: T0 } : { id, status: 'pending' as const }))
  return { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
}

test('une phase de tri enregistrée à l’ancienne forme garde ses étapes, les accepte, et finit comme aujourd’hui', () => {
  let board = oldTriage()

  for (const [i, step] of ['recommend', 'verify', 'apply'].entries()) {
    const out = applyReport(board, { step }, T0 + 1_000 * (i + 1))
    expect(out.text).not.toContain('is not a step')
    board = out.board
    expect(triage(board).steps.find(s => s.status === 'active')?.id).toBe(step)
  }
  // Ses étapes ne sont pas réécrites aux nouvelles.
  expect(triage(board).steps.map(s => s.id)).toEqual(['queue', 'context', 'recommend', 'verify', 'grill', 'apply'])
  board = applyReport(board, { complete: true }, T0 + 5_000).board
  const run = activeRun(board)!
  expect(triage(board).status).toBe('done')
  const s = suggestionsFor(run)
  expect(s.primary).toBe('to-tickets')
  expect(s.others.includes('implement')).toBe(true)
  expect(s.canFinish).toBe(true)
})

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
}

test('la consigne rendue au chargement de /triage porte les consignes de cadrage, chacune à son étape', async ($, on) => {
  mock.clock(on, { now: 57_000_000 })
  mock.store(on)
  world(on)
  const text = (await $.skill.prompt({ skill: 'mattpocock-skills:triage', text: 'x' })).text as string
  const line = text.split('\n').find(l => l.startsWith('- Steps of triage, in order'))!
  expect(line).toBeDefined()
  /** Le texte d'une étape dans la ligne des étapes : de « <id> ( » à l'étape suivante. */
  const hintOf = (id: string, next?: string): string => {
    const from = line.indexOf(` ${id} (`)
    expect(from).toBeGreaterThan(0)
    const to = next ? line.indexOf(`; ${next} (`, from) : line.length
    expect(to).toBeGreaterThan(from)
    return line.slice(from, to)
  }
  // L'ordre des étapes.
  const order = ['queue', 'context', 'verify', 'recommend', 'grill', 'sensitive', 'partition', 'apply'].map(id => line.indexOf(id === 'queue' ? `: queue (` : `; ${id} (`))
  expect(order.every(i => i > 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  // La recherche des décisions déjà prises, avant de recommander.
  expect(hintOf('recommend', 'grill')).toContain("before recommending, search the decisions already taken: the entry's term in every decision file of the project (those its CLAUDE.md names, not only this mission's)")
  expect(hintOf('recommend', 'grill')).not.toContain('then wait')
  // La lecture de la fonction nommée et la question du cycle de vie, pour une entrée sensible.
  expect(hintOf('verify', 'recommend')).toContain('for an entry in a sensitive area, read the function it names and the paths that write, merge, erase its data or read it to make a decision, and ask its lifecycle question')
  expect(hintOf('verify', 'recommend')).toContain('verify each entry in the code before recommending anything')
  // L'étape « Conséquences sensibles » des cadrages.
  expect(hintOf('sensitive', 'partition')).toContain('list what the change, or a removal, leaves behind in a sensitive area')
  // L'advisor avant de montrer tri.md, puis la question à boutons du partage.
  expect(hintOf('partition', 'apply')).toContain('consult the advisor (advisor tool), not a reviewer subagent, before showing it')
  // Sur un vrai tracker, le déroulé du skill reste : recommander puis attendre, sans partage.
  expect(hintOf('recommend', 'grill')).toContain('on a real tracker, recommend and wait for direction, as the skill says')
  expect(hintOf('partition', 'apply')).toContain('on a real tracker, nothing here')
  expect(hintOf('partition', 'apply')).toContain('then get it validated once, with a button question (AskUserQuestion)')
  expect(hintOf('partition', 'apply')).toContain('tri.md')
  // Aucun ticket pendant le tri.
  expect(hintOf('apply')).toContain('send no ticket during the triage')
  expect(hintOf('apply')).toContain("complete tri.md, write the user's answers to the decision file, and declare the « renvoie » sub-lines set aside")
  // La consigne des éléments : une entrée triée, son id de la feuille de route ou « #n ».
  expect(text).toContain('the entries being triaged: id = the id of the roadmap entry')
  expect(text).toContain('on a real tracker, "#n"')
  expect(text).toContain('done = triaged, dropped = « écarte » or « renvoie »')
})
