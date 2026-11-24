import { expect, test } from 'claude-code/testing'

import { newRun, reportFacts, stoppedClosings } from '../hooks/model.ts'
import type { Run } from '../types'

// Les faits du compte rendu nomment ce qui attend encore (piste cr1) : chaque question bloquante ouverte et chaque
// fermeture arrêtée, pour que le rapport le dise en tête, dans « En bref ». Le 18/11, le compte rendu était parti
// avec la question COURSE-05 ouverte et le worker B pas fermé, dit seulement en fin de texte.

/** Une mission à deux groupes rendus : B à la fermeture arrêtée (sa raison notée), C fermé. */
const mission = (): Run => {
  const run = newRun('implement', 1_000, 'Course')
  run.tickets = [
    { id: 'b1', name: 'Course', status: 'done' },
    { id: 'c1', name: 'Code', status: 'done' },
  ] as Run['tickets']
  run.groups = [
    { id: 'B', name: 'Course', tickets: ['b1'], delegated: { at: 2_000, closing: { state: 'stopped', at: 3_000, why: 'question COURSE-05 ouverte' } } },
    { id: 'C', name: 'Code', tickets: ['c1'], delegated: { at: 2_000, closing: { state: 'closed', at: 3_000 } } },
  ]
  return run
}

const facts = (run: Run): string => reportFacts(run).join('\n')

test('une question bloquante ouverte sur un groupe et une fermeture arrêtée ont chacune leur ligne, avec ce qu’elle bloque et la raison notée', () => {
  const run = mission()
  run.waiting = [
    { id: 'COURSE-05', blocks: { kind: 'group', id: 'B' }, text: 'La course se garde-t-elle ?', at: 2_500 },
    { id: 'Q2', blocks: { kind: 'ticket', id: 'c1' }, text: 'Et le code ?', at: 2_600 },
  ]
  const lines = reportFacts(run)
  // Une ligne par question, une par fermeture arrêtée.
  expect(lines).toContain('- Blocking question still open (say it first in « En bref », and ask it again in « À toi »): COURSE-05 (blocks group B): La course se garde-t-elle ?.')
  expect(lines).toContain('- Blocking question still open (say it first in « En bref », and ask it again in « À toi »): Q2 (blocks ticket c1): Et le code ?.')
  expect(lines).toContain('- Closing stopped (that worker is not closed: say it first in « En bref », never write that everything is closed): group B (reason noted: question COURSE-05 ouverte).')
  // Le groupe fermé n'y est pas.
  expect(lines.join('\n')).not.toContain('group C (reason')
})

test('sans question ni fermeture arrêtée, aucune ligne de plus', () => {
  const run = mission()
  run.groups![0]!.delegated!.closing = { state: 'closed', at: 3_000 }
  const text = facts(run)
  expect(text).not.toContain('Blocking question still open')
  expect(text).not.toContain('Closing stopped')
  expect(stoppedClosings(run)).toEqual([])
})

test('une question sans cible bloque toute la mission ; un texte relu ne s’ouvre pas en ligne ; une fermeture sans raison le dit', () => {
  const run = mission()
  // Relue d'un fichier partagé : une question sans cible (le type la veut, un fichier abîmé peut l'omettre).
  run.waiting = [{ id: 'Q1', text: 'première\nligne', at: 2_500 } as never]
  run.groups![0]!.delegated!.closing = { state: 'stopped', at: 3_000 }
  const lines = reportFacts(run)
  const q = lines.find(l => l.startsWith('- Blocking question still open'))!
  expect(q).toContain('Q1 (blocks the whole mission): ')
  expect(q.includes('\n')).toBe(false)
  expect(lines.find(l => l.startsWith('- Closing stopped'))).toContain('group B (no reason noted)')
})

test('une raison relue très longue est bornée (closingReason) ; la session des pistes d’une phase compte, son id hors forme jamais recopié', () => {
  const run = mission()
  run.groups![0]!.delegated!.closing = { state: 'stopped', at: 3_000, why: 'x'.repeat(50_000) }
  const line = reportFacts(run).find(l => l.startsWith('- Closing stopped'))!
  expect(line.length < 600).toBe(true)
  run.phases = [
    { skill: 'retro', status: 'active', linked: { at: 2_000, session: 's1', closing: { state: 'stopped', at: 3_000, why: 'compte rendu absent' } } },
    { skill: 'x y\n«', status: 'active', linked: { at: 2_000, session: 's2', closing: { state: 'stopped', at: 3_000 } } },
  ] as never
  const who = stoppedClosings(run).map(s => s.who)
  expect(who).toContain('items session of the phase retro')
  expect(who).toContain('items session of the phase (id out of form)')
})

test('la fermeture arrêtée d’un envoi précédent compte aussi ; une entrée hors forme est ignorée', () => {
  const run = mission()
  run.groups![1]!.delegated = { at: 4_000, earlier: [{ at: 2_000, seq: 1, closing: { state: 'stopped', at: 3_000, why: 'arbre pas propre' } }] } as never
  ;(run.groups as unknown[]).push(null)
  expect(stoppedClosings(run)).toEqual([
    { who: 'group B', label: 'du groupe B', why: 'question COURSE-05 ouverte', isRelaunchable: true },
    { who: 'group C, earlier send 1', label: 'du groupe C, envoi 1', why: 'arbre pas propre', isRelaunchable: false },
  ])
})

test('un id de skill à espace de noms (« plugin:skill ») se nomme tel quel, sans être dit hors forme', () => {
  const run = { ...newRun('to-spec', 1_000, 'Course'), phases: [{ skill: 'mattpocock-skills:triage', status: 'active', linked: { at: 2_000, session: 's1', closing: { state: 'stopped', at: 3_000 } } }] } as unknown as Run
  expect(stoppedClosings(run).map(s => s.who)).toEqual(['items session of the phase mattpocock-skills:triage'])
})
