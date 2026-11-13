import { expect, mock, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { memoryDisk } from './disque-memoire.ts'
import { applyReport, applySkill, emptyBoard, finishActive, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'

// Mission « Pistes de rétro en tickets » : la mission « Intégrer Fable 5.2 au workflow » avait perdu son
// titre. Son cadrage fini, /to-spec tapé dans la même discussion avait ouvert une seconde mission sans titre, nommée
// « De la spec au code », et le manager avait envoyé {"step"} sans {"title"} : les workers en avaient pris le faux nom.
// Invariant validé par Mathis le 12/11/2026 : le titre repris ne vient jamais que d'une mission de la même discussion
// (tenue par elle, ou née chez elle et tenue par personne) ; reprendre un titre ne change aucun champ de la mission finie.

const HOUR = 60 * 60 * 1000
const TOOL = 'mcp__flow-board__flow'
const NOW = 100 * HOUR
const TITLE = 'Intégrer Fable 5.2 au workflow'

const boardOf = (runs: Run[], session: string): Board => ({ ...emptyBoard('c:/dev/p', 'p'), session, runs, activeId: null, deleted: [] })

/** Un cadrage fini (Grilling, dont /to-spec est une suite proposée), tenu par la discussion Y. */
const finished = (over: Partial<Run> = {}): Run => {
  const run = newRun('grill-me', NOW - 2 * HOUR, TITLE)
  run.phases[0]!.status = 'done'
  run.phases[0]!.finishedAt = NOW - HOUR
  run.phases[1]!.status = 'skipped'
  return { ...run, status: 'done', owner: 'Y', bornIn: 'Y', updatedAt: NOW - HOUR, finishedAt: NOW - HOUR, ...over }
}

const openSpec = (board: Board): Run => activeRun(applySkill(board, 'mattpocock-skills:to-spec', { now: NOW, isMain: true })!.board)!

const currentStep = (run: Run): string | undefined => run.phases[run.cursor]!.steps.find(s => s.status === 'active')?.id

test('par le vrai chemin : un Grilling titré puis fini, et /to-spec dans la même discussion garde le titre', () => {
  const t0 = NOW - 2 * HOUR
  let board = applySkill(boardOf([], 'Y'), 'mattpocock-skills:grill-me', { now: t0, isMain: true })!.board
  board = applyReport(board, { title: TITLE }, t0 + 1_000).board
  board = applyReport(board, { complete: true }, t0 + 2_000).board
  // La phase facultative /to-spec reste en attente : la mission se clôt (« ✓ Clore la mission »).
  board = finishActive(board, t0 + 3_000)!.board
  const done = board.runs[0]!
  expect(done.status).toBe('done')
  expect(activeRun(board)).toBe(null)
  const before = JSON.stringify(done)
  const out = applySkill(board, 'mattpocock-skills:to-spec', { now: NOW, isMain: true })!.board
  const opened = activeRun(out)!
  expect(opened.id === done.id).toBe(false)
  expect(opened.title).toBe(TITLE)
  expect(opened.isTitled).toBe(true)
  expect(JSON.stringify(out.runs.find(r => r.id === done.id))).toBe(before)
})

test('suite d’une mission finie : la nouvelle mission prend son titre tel quel, et la mission finie ne change pas', () => {
  const done = finished()
  const before = JSON.stringify(done)
  const out = applySkill(boardOf([done], 'Y'), 'mattpocock-skills:to-spec', { now: NOW, isMain: true })!.board
  const opened = activeRun(out)!
  expect(opened.id === done.id).toBe(false)
  expect(opened.title).toBe(TITLE)
  expect(opened.isTitled).toBe(true)
  expect(JSON.stringify(out.runs.find(r => r.id === done.id))).toBe(before)
})

test('suite d’une mission finie née ici et tenue par personne : le titre est repris aussi', () => {
  const done = finished({ owner: undefined })
  expect(openSpec(boardOf([done], 'Y')).title).toBe(TITLE)
})

test('sans mission d’avant : mission sans titre, comme aujourd’hui', () => {
  const opened = openSpec(boardOf([], 'Y'))
  expect(opened.isTitled).toBe(false)
  expect(opened.title).toBe('De la spec au code')
})

test('mission d’une autre discussion : pas de reprise', () => {
  // Tenue par X (même née ici), ou née et tenue ailleurs.
  for (const other of [finished({ owner: 'X' }), finished({ owner: 'X', bornIn: 'X' }), finished({ owner: undefined, bornIn: 'X' })]) {
    const before = JSON.stringify(other)
    const out = applySkill(boardOf([other], 'Y'), 'mattpocock-skills:to-spec', { now: NOW, isMain: true })!.board
    expect(activeRun(out)!.isTitled).toBe(false)
    expect(JSON.stringify(out.runs.find(r => r.id === other.id))).toBe(before)
  }
})

test('skill sans rapport : pas de reprise quand ce skill n’est pas une suite proposée de sa dernière phase faite', () => {
  // /triage n'est pas une suite du Grilling.
  const out = applySkill(boardOf([finished()], 'Y'), 'mattpocock-skills:triage', { now: NOW, isMain: true })!.board
  expect(activeRun(out)!.isTitled).toBe(false)
})

test('mission suivie sans titre : pas de reprise d’un titre jamais choisi, vide ou hors forme', () => {
  for (const over of [{ isTitled: false, title: 'Réflexion' }, { title: '' }, { title: '   ' }, { title: 42 as unknown as string }]) {
    expect(openSpec(boardOf([finished(over)], 'Y')).isTitled).toBe(false)
  }
})

test('seule la mission la plus récente de la discussion compte, et une mission finie archivée ou mise de côté ne donne rien', () => {
  // La plus récente se juge à la date de fin d'une mission finie (une relecture peut bouger updatedAt).
  const older = finished({ updatedAt: NOW - HOUR / 2, finishedAt: NOW - 3 * HOUR })
  const newer = { ...newRun('triage', NOW - 2 * HOUR, 'Autre travail'), status: 'done' as const, owner: 'Y', bornIn: 'Y', updatedAt: NOW - HOUR, finishedAt: NOW - HOUR }
  newer.phases[0]!.status = 'done'
  expect(openSpec(boardOf([newer, older], 'Y')).isTitled).toBe(false)
  expect(openSpec(boardOf([finished({ archivedAt: NOW - HOUR })], 'Y')).isTitled).toBe(false)
  expect(openSpec(boardOf([finished({ asideAt: NOW - HOUR })], 'Y')).isTitled).toBe(false)
})

test('un step sans title sur une mission sans titre est refusé, sans rien enregistrer', () => {
  const board = applySkill(boardOf([], 'Y'), 'mattpocock-skills:to-spec', { now: NOW, isMain: true })!.board
  const out = applyReport(board, { step: 'write', note: 'une note' }, NOW + 1_000)
  expect(out.text).toContain('has no title yet')
  expect(JSON.stringify(out.board)).toBe(JSON.stringify(board))
  // Avec un titre, le même appel passe.
  const ok = applyReport(board, { title: 'Spec de la mission', step: 'write' }, NOW + 2_000)
  expect(activeRun(ok.board)!.isTitled).toBe(true)
  expect(activeRun(ok.board)!.title).toBe('Spec de la mission')
  expect(currentStep(activeRun(ok.board)!)).toBe('write')
})

test('une mission lancée par le COO : sa carte ne la titre pas (attachLaunch ne pose que launch), le refus vaut aussi, et son titre le lève', () => {
  // Choix déclaré : le ticket la croyait « titrée par sa carte » ; le code ne pose aucun titre au rattachement.
  const board = applySkill(boardOf([], 'Y'), 'mattpocock-skills:to-spec', { now: NOW, isMain: true, isLaunched: true })!.board
  const run = activeRun(board)!
  run.launch = { id: 'l1', card: 'c1', at: NOW, folder: 'sujet', start: 'to-spec', mode: 'auto' }
  expect(run.isTitled).toBe(false)
  expect(applyReport(board, { step: 'write' }, NOW + 1_000).text).toContain('has no title yet')
  const out = applyReport(board, { title: 'Titre de la carte', step: 'write' }, NOW + 1_000)
  expect(currentStep(activeRun(out.board)!)).toBe('write')
})

test('un titre donné par fix, une reprise ou une ouverture dans le même appel lève le refus', () => {
  const board = applySkill(boardOf([], 'Y'), 'mattpocock-skills:to-spec', { now: NOW, isMain: true })!.board
  const fixed = applyReport(board, { fix: { title: 'Titre corrigé' }, step: 'write' }, NOW + 1_000)
  expect(fixed.text.includes('has no title yet')).toBe(false)
  expect(activeRun(fixed.board)!.title).toBe('Titre corrigé')
  expect(applyReport(board, { open: { title: 'Autre mission' }, step: 'write' }, NOW + 1_000).text.includes('has no title yet')).toBe(false)
  // Une reprise d'une autre mission de cette discussion : l'étape va à celle-ci.
  const other = { ...newRun('implement', NOW - HOUR, 'Lot d’avant'), status: 'paused' as const, bornIn: 'Y' }
  const withOther = { ...board, runs: [...board.runs, other] }
  expect(applyReport(withOther, { resume: other.id, step: 'read' }, NOW + 1_000).text.includes('has no title yet')).toBe(false)
})

test('la reprise se dit au journal de la nouvelle mission', () => {
  const opened = openSpec(boardOf([finished()], 'Y'))
  expect(opened.log.some(l => l.text === `Titre repris de la mission finie « ${TITLE} »`)).toBe(true)
})

test('le même skill après une mission finie par lui ne reprend pas le titre (ses noms de worktree et de branche resteraient pris)', () => {
  const lot = { ...newRun('implement', NOW - 2 * HOUR, 'Onglet Agents'), status: 'done' as const, owner: 'Y', bornIn: 'Y', finishedAt: NOW - HOUR }
  lot.phases[0]!.status = 'done'
  const out = applySkill(boardOf([lot], 'Y'), 'mattpocock-skills:implement', { now: NOW, isMain: true })!.board
  expect(activeRun(out)!.isTitled).toBe(false)
})

test('une rétro après une mission livrée prend « Rétrospective · <titre> », jamais le titre nu', () => {
  const shipped = { ...newRun('implement', NOW - 2 * HOUR, 'Onglet Agents'), status: 'done' as const, owner: 'Y', bornIn: 'Y', finishedAt: NOW - HOUR }
  for (const p of shipped.phases) p.status = 'done'
  const out = applySkill(boardOf([shipped], 'Y'), 'mattpocock-skills:retro', { now: NOW, isMain: true })!.board
  expect(activeRun(out)!.title).toBe('Rétrospective · Onglet Agents')
})

test('une mission lancée par le COO ne reprend aucun titre, même après une mission finie ici', () => {
  const out = applySkill(boardOf([finished()], 'Y'), 'mattpocock-skills:to-spec', { now: NOW, isMain: true, isLaunched: true })!.board
  expect(activeRun(out)!.isTitled).toBe(false)
})

test('fix.step sans titre est refusé comme step', () => {
  const board = applySkill(boardOf([], 'Y'), 'mattpocock-skills:to-spec', { now: NOW, isMain: true })!.board
  const out = applyReport(board, { fix: { step: 'write' } }, NOW + 1_000)
  expect(out.text).toContain('has no title yet')
  expect(out.text).toContain('send this whole call again')
  expect(out.text).toContain('(fix.step included)')
  expect(JSON.stringify(out.board)).toBe(JSON.stringify(board))
  // L'appel que la réponse dicte, rejoué tel quel : son titre et son étape s'enregistrent.
  const replayed = activeRun(applyReport(board, { title: 'Spec de la mission', fix: { step: 'write' } }, NOW + 2_000).board)!
  expect(replayed.title).toBe('Spec de la mission')
  expect(currentStep(replayed)).toBe('write')
})

test('par l’outil : l’appel refusé ne passe pas plus loin, mise de côté comprise ; avec son titre, il passe', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  memoryDisk(on)
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('prompt.fill', () => ({ isFilled: true }))
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  const call = { tool: TOOL, step: 'write', setAside: [{ text: 'Une idée pour plus tard' }] }
  const refused = String(((await $.tool.call(call as any)) as any).result)
  expect(refused).toContain('has no title yet')
  expect(refused).not.toMatch(/set.aside|Déclaration/i)
  expect(refused).not.toMatch(/Rédiger la spec/)
  // L'appel que la réponse dicte, rejoué tel quel avec son titre : la mise de côté est traitée, l'étape enregistrée.
  const ok = String(((await $.tool.call({ ...call, title: 'Spec de la mission' } as any)) as any).result)
  // La mise de côté a été lue (le disque de ce test la refuse : la réponse le dit).
  expect(ok).toMatch(/set.aside|Déclaration non enregistrée/i)
  expect(ok).toMatch(/Spec de la mission · Spec > Rédiger la spec/)
})

test('un champ présent sans effet ne lève pas le refus : reprise de la mission active, open d’une autre forme, fix.title égal au titre par défaut', () => {
  const board = applySkill(boardOf([], 'Y'), 'mattpocock-skills:to-spec', { now: NOW, isMain: true })!.board
  const active = activeRun(board)!
  for (const input of [
    { resume: active.id, step: 'write' },
    { open: 'x', step: 'write' },
    { open: false, step: 'write' },
    { fix: { title: 'De la spec au code' }, step: 'write' },
    // Une ouverture sans titre : la mission ouverte n'en aurait pas.
    { open: true, step: 'write' },
    { open: { entry: 'to-spec' }, step: 'write' },
  ]) {
    const out = applyReport(board, input, NOW + 1_000)
    expect(out.text).toContain('has no title yet')
    expect(JSON.stringify(out.board)).toBe(JSON.stringify(board))
  }
})

test('le refus juge la mission qui reçoit l’étape : la reprise d’une autre mission sans titre est refusée, même depuis une mission titrée', () => {
  const untitled = { ...newRun('implement', NOW - HOUR), status: 'paused' as const, bornIn: 'Y' }
  const titled = applySkill(boardOf([finished()], 'Y'), 'mattpocock-skills:to-spec', { now: NOW, isMain: true })!.board
  const board = { ...titled, runs: [...titled.runs, untitled] }
  const out = applyReport(board, { resume: untitled.id, step: 'read' }, NOW + 1_000)
  expect(out.text).toContain('has no title yet')
  expect(JSON.stringify(out.board)).toBe(JSON.stringify(board))
})

test('un lot de tickets sans mission ouverte n’est pas concerné : la mission créée par l’appel n’était pas active avant', () => {
  const out = applyReport(boardOf([], 'Y'), { tickets: [{ id: 't1', name: 'Un ticket' }], step: 'pick' }, NOW)
  expect(out.text.includes('has no title yet')).toBe(false)
  expect(activeRun(out.board)!.tickets.map(t => t.id)).toEqual(['t1'])
})

test('une mission déjà titrée reçoit un step sans title', () => {
  const board = applySkill(boardOf([finished()], 'Y'), 'mattpocock-skills:to-spec', { now: NOW, isMain: true })!.board
  const out = applyReport(board, { step: 'write' }, NOW + 1_000)
  expect(currentStep(activeRun(out.board)!)).toBe('write')
})
