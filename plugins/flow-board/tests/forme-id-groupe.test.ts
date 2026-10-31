import { expect, test } from 'claude-code/testing'

import { GROUP_ID_FORM, GROUP_ID_FORM_FR, closingProcedure, groupWorktree, groupWorktreeTemplate, isGroupId } from '../hooks/closing.ts'
import { activeRun, applyRelay, applyReport, closingText, emptyBoard, newRun, startLinkedGroups } from '../hooks/model.ts'
import type { Board } from '../types'

// La forme d'un id de groupe : une règle, contrôlée partout. Invariant : la procédure de fermeture ne
// vise jamais un worktree ni une branche tirés d'un id de groupe hors forme : elle s'arrête et le dit,
// sans rien retirer.

const REPO = { isRepo: true }

const lotWith = (ids: string[]): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('/p', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const b = applyReport(board, { tickets: ids.map((_, i) => ({ id: `t${i}`, name: `T${i}`, sensitive: false, logic: true })), groups: [{ id: 'A', name: 'Alpha', tickets: ['t0'] }] }, 2_000).board
  // Les ids hors forme ne passent plus par l'outil : enregistrés par une version d'avant, ou un fichier modifié.
  activeRun(b)!.groups = ids.map((id, i) => ({ id, name: `G${i}`, tickets: [`t${i}`] }))
  return b
}

test('le nom de worktree d’un groupe refuse lui-même un id hors forme, quel que soit l’appelant', () => {
  const run = newRun('implement', 1_000, 'Boutique')
  expect(groupWorktree(run, 'A')).toBe('groupe-boutique-A')
  for (const id of ['a/b', ' A', 'A B', '../x', '']) expect(groupWorktree(run, id)).toBeNull()
  // Le gabarit d'un brief garde sa place à l'id, sans passer par la garde.
  expect(groupWorktreeTemplate(run)).toBe('groupe-boutique-<id>')
})

test('un id à blancs ou qui n’est pas une chaîne n’est jamais confondu avec un id enregistré en forme', () => {
  let b = lotWith(['A', ' A'])
  b = startLinkedGroups(b, ['A'], 3_000)!.board
  b = applyReport(b, { set: [{ id: 't0', status: 'done' }], returned: ['A'] }, 3_500, REPO).board
  // A est rendu : un arrêt envoyé pour lui se noterait. Celui envoyé pour « A » avec son blanc ne s'inscrit pas sur A.
  expect(activeRun(b)!.groups!.find(g => g.id === 'A')!.delegated).toBeDefined()
  const out = applyReport(b, { closed: [{ group: ' A', state: 'stopped', why: 'hors forme' }] }, 4_000, REPO)
  expect(activeRun(out.board)!.groups!.find(g => g.id === 'A')!.delegated?.closing).toBeUndefined()
  expect(activeRun(applyReport(b, { closed: [{ group: 'A', state: 'stopped', why: 'à revoir' }] }, 4_000, REPO).board)!.groups!.find(g => g.id === 'A')!.delegated?.closing?.state).toBe('stopped')
  // Un id qui n'est pas une chaîne, enregistré ou envoyé, ne fait pas tomber l'appel.
  const odd = lotWith(['A'])
  ;(activeRun(odd)!.groups as unknown as { id: unknown }[]).push({ id: 7, name: 'Sept', tickets: [] } as never)
  expect(() => applyReport(odd, { reviewed: ['A'], closed: [{ group: 7, state: 'stopped' }] }, 4_000, REPO)).not.toThrow()
})

test('« Not closed yet » et ce qui manque montrent un id hors forme neutralisé et distinct', () => {
  let b = lotWith(['A', 'x]1', 'x)1', 'y·\nz'])
  const run = activeRun(b)!
  // Des groupes hors forme, rendus, sans revue : la réponse les dit chacun sous son id exact, échappé en JSON.
  run.groups = run.groups!.map(g => (g.id === 'A' ? g : { ...g, delegated: { at: 3_000 } }))
  b = applyReport(b, { set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'done' }, { id: 't3', status: 'done' }] }, 4_000, REPO).board
  const text = closingText(activeRun(b)!, null, true)
  expect(text).toContain('Not closed yet: group "x]1" (G1)')
  expect(text).toContain('Not closed yet: group "x)1" (G2)')
  // Ni « · » qui ouvrirait une section, ni fin de ligne : échappés.
  expect(text).toContain('Not closed yet: group "y\\u00b7\\nz" (G3)')
  expect(text).toContain('{"reviewed": ["y\\u00b7\\nz"]}')
  expect(text).not.toContain('y·')
})

test('« Do not close » ne demande rien à une session précédente encore active, et sans git aussi', () => {
  const b = lotWith(['a/b'])
  const run = activeRun(b)!
  run.groups = [{ ...run.groups![0]!, delegated: { at: 3_000, earlier: [{ at: 2_500, session: 'abc123' }] } } as never]
  // Sans git : la fermeture s'arrête, sans worktree ni branche tirés de l'id.
  const noGit = closingText(run, null, false)
  expect(noGit).toContain('Do not close')
  expect(noGit).not.toContain('groupe-')
  // La session précédente travaille encore (activité relayée après son compte rendu) : rien ne lui est demandé.
  let relay = applyRelay(undefined, run.id, 'abc123', { kind: 'start', group: 'a/b' }, 2_600)!
  relay = applyRelay(relay, run.id, 'abc123', { kind: 'report', text: 'fini' }, 2_700)!
  relay = applyRelay(relay, run.id, 'abc123', { kind: 'note', text: 'encore un correctif' }, 2_800)!
  expect(closingText(run, relay, false)).not.toContain('Do not close')
  const procedure = closingProcedure({ run, target: { kind: 'group', id: 'a/b', name: 'G0' }, isRepo: false })
  expect(procedure).toContain('Ne ferme rien')
  expect(procedure.match(/Ne ferme rien/g)).toHaveLength(1)
})

test('la forme d’un id de groupe dite en clair suit la règle : sa borne est celle d’isGroupId', () => {
  expect(isGroupId('a'.repeat(12))).toBe(true)
  expect(isGroupId('a'.repeat(13))).toBe(false)
  for (const text of [GROUP_ID_FORM, GROUP_ID_FORM_FR]) expect(text).toContain('12')
})

test('« closed » ou « app » est refusé pour un groupe hors forme ; seul « stopped » se note', () => {
  let b = lotWith(['A', 'a/b'])
  const run = activeRun(b)!
  run.groups = run.groups!.map(g => (g.id === 'a/b' ? { ...g, delegated: { at: 3_000 } } : g))
  for (const state of ['closed', 'app'] as const) {
    const out = applyReport(b, { closed: [{ group: 'a/b', state }] }, 4_000, REPO)
    expect(activeRun(out.board)!.groups!.find(g => g.id === 'a/b')!.delegated?.closing).toBeUndefined()
    expect(out.text).toContain('closed: refused for "a/b" (its id is out of form: nothing is closed from here, only "stopped" is noted)')
  }
  b = applyReport(b, { closed: [{ group: 'a/b', state: 'stopped', why: 'id hors forme' }] }, 4_100, REPO).board
  expect(activeRun(b)!.groups!.find(g => g.id === 'a/b')!.delegated?.closing?.state).toBe('stopped')
})

test('« closed » est refusé aussi pour la session précédente d’un groupe hors forme, et l’id s’y montre échappé', () => {
  const b = lotWith(['A', 'y·\nz'])
  const run = activeRun(b)!
  run.groups = run.groups!.map(g => (g.id === 'A' ? g : { ...g, delegated: { at: 3_000, earlier: [{ at: 2_500, session: 'abc123' }] } } as never))
  const out = applyReport(b, { closed: [{ group: 'y·\nz', link: 2_500, state: 'closed' }] }, 4_000, REPO)
  const g = activeRun(out.board)!.groups!.find(x => x.id === 'y·\nz')!
  expect(g.delegated?.earlier?.[0]?.closing).toBeUndefined()
  expect(out.text).toContain('closed: refused for "y\\u00b7\\nz" (sent at 2500: its id is out of form: nothing is closed from here, only "stopped" is noted)')
  expect(out.text).not.toContain('y·')
})
