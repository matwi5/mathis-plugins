import { expect, mock, test } from 'claude-code/testing'

import { applyReport, emptyBoard, groupPlan, newRun } from '../hooks/model.ts'
import { activeRun } from '../hooks/basics.ts'
import type { Board } from '../types'

/** Un parcours actif après un appel de l'outil `flow`. */
const boardWith = (input: Record<string, unknown>): Board => {
  const run = { ...newRun('to-tickets', 1_000, 'Lot'), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}

// Un seul ticket sur quinze disait s'il touchait une zone sensible : l'avis « zone sensible » a été
// suivi par un groupe et ignoré par un autre. Chaque ticket le dit, et l'outil le garde.
test('un ticket porte sa zone sensible et sa logique ; une mise à jour sans ces champs les garde', () => {
  let board = boardWith({
    tickets: [
      { id: 't1', name: 'Retrait du mode privé', sensitive: true, logic: true },
      { id: 't2', name: 'Icône', sensitive: false, logic: false },
      { id: 't3', name: 'Sans avis' },
    ],
  })
  const ticket = (id: string) => activeRun(board)!.tickets.find(t => t.id === id)!
  expect(ticket('t1')).toMatchObject({ sensitive: true, logic: true })
  expect(ticket('t2')).toMatchObject({ sensitive: false, logic: false })
  expect(ticket('t3').sensitive).toBeUndefined()
  expect(ticket('t3').logic).toBeUndefined()
  board = applyReport(board, { tickets: [{ id: 't1', name: 'Retrait du mode privé', status: 'doing' }] }, 3_000).board
  expect(ticket('t1')).toMatchObject({ sensitive: true, logic: true, status: 'doing' })
})

// README et DECISIONS.md, cités par presque tous les tickets, empêchaient tout groupe en parallèle.
test('les documents communs (README, DECISIONS.md, carte du code) n’empêchent pas deux groupes de tourner ensemble', () => {
  const board = boardWith({
    tickets: [
      { id: 'a1', name: 'Worker', files: ['src/worker.ts', 'README.md', 'DECISIONS.md'] },
      { id: 'b1', name: 'App', files: ['src/app.ts', 'docs/README.md', 'docs/agents/carte-du-code.md'] },
    ],
    groups: [
      { id: 'A', name: 'Worker', tickets: ['a1'], files: ['docs/agents/carte-du-code.md'] },
      { id: 'B', name: 'App', tickets: ['b1'], files: ['readme.md'] },
    ],
  })
  expect(groupPlan(activeRun(board)!)!.parallelBatch).toEqual(['A', 'B'])
  // Un vrai fichier commun bloque toujours.
  const shared = boardWith({
    tickets: [
      { id: 'a1', name: 'Worker', files: ['src/shared.ts', 'README.md'] },
      { id: 'b1', name: 'App', files: ['src/shared.ts'] },
    ],
    groups: [
      { id: 'A', name: 'Worker', tickets: ['a1'] },
      { id: 'B', name: 'App', tickets: ['b1'] },
    ],
  })
  expect(groupPlan(activeRun(shared)!)!.groups.find(g => g.group.id === 'B')!.conflicts).toEqual([{ with: 'A', on: 'shared.ts' }])
})

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
}

test('/to-tickets fait dire à chaque ticket sa zone sensible et sa logique, et garde CLAUDE.md et les documents communs hors des tickets de groupe', async ($, on) => {
  mock.clock(on, { now: 50_000_000 })
  mock.store(on)
  world(on)
  const text = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text as string
  expect(text).toContain('« Zone sensible : oui/non (pourquoi) »')
  expect(text).toContain('« Logique : oui/non »')
  expect(text).toContain('"sensitive": true|false')
  expect(text).toContain('"logic": true|false')
  // Une session liée ne peut pas écrire CLAUDE.md : un ticket resté 19 heures en attente.
  expect(text).toContain('A write to CLAUDE.md never goes into the done criteria of a group ticket')
  expect(text).toContain('README, DECISIONS.md and the code map (carte-du-code.md, CODEMAP.md) stay out of "files"')
})

test('/to-spec et le grilling cherchent les conséquences sensibles et vérifient l’exposition avant une question de confidentialité', async ($, on) => {
  mock.clock(on, { now: 51_000_000 })
  mock.store(on)
  world(on)
  const spec = (await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })).text as string
  expect(spec).toContain('sensitive (')
  expect(spec).toContain('what the change, or a removal, leaves behind')
  const grill = (await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })).text as string
  expect(grill).toContain('what the change, or a removal, leaves behind')
  for (const text of [spec, grill]) {
    expect(text).toContain('Before a privacy question, have a read-only subagent check the real exposure')
    expect(text).toContain('"à confirmer"')
  }
})

// Un ticket sensible s'écrit d'après le code, et une commande ou un chemin construit d'une valeur
// lue ailleurs est une zone sensible (le ticket « ↺ Rouvrir », dit non sensible, était passé sans
// passe « bogues »).
test('/to-spec et /to-tickets font lire le code avant un ticket sensible, et listent la zone des commandes construites', async ($, on) => {
  mock.clock(on, { now: 52_000_000 })
  mock.store(on)
  world(on)
  for (const skill of ['mattpocock-skills:to-spec', 'mattpocock-skills:to-tickets']) {
    const text = (await $.skill.prompt({ skill, text: 'x' })).text as string
    expect(text).toContain('read the function it names before writing a done criterion or an option offered to the user')
    expect(text).toContain('by a search quoted in the ticket (the command and its result)')
    expect(text).toContain('the name at the second send, who writes the data, when it goes stale, how what gets deleted is designated')
    expect(text).toContain('leave no « à confirmer » in a ticket: it is a question at framing')
    expect(text).toContain('concurrency, a command or path built from a value read elsewhere: a shared file, another session, a report)')
  }
})

// Les décisions d'un parcours avaient posé, ticket par ticket, des questions prévisibles au cadrage :
// les étapes de /to-spec et /to-tickets listent les cas du cycle de vie d'un champ persisté.
test('/to-spec et /to-tickets listent les cas du cycle de vie d’un champ persisté et les transitions de l’objet qui porte une marque', async ($, on) => {
  mock.clock(on, { now: 53_000_000 })
  mock.store(on)
  world(on)
  for (const skill of ['mattpocock-skills:to-spec', 'mattpocock-skills:to-tickets']) {
    const text = (await $.skill.prompt({ skill, text: 'x' })).text as string
    expect(text).toContain('a failed read, a failed write, its bounds (empty, too long, a date in the future or the past), the erasure of what must be kept, a forged copy')
    expect(text).toContain('each transition of the object that carries a mark (sent, cancelled, sent again, back), with what the mark becomes at each one')
  }
})

// Le découpage des pistes d'une rétro ne passe pas par /to-tickets : son étape porte les mêmes
// consignes, et /to-tickets relit aussi les critères d'un ticket sensible avant la validation.
test('/to-tickets et le découpage d’une rétro relisent chaque critère d’un ticket sensible contre son invariant, et le découpage pose le cycle de vie', async ($, on) => {
  mock.clock(on, { now: 55_000_000 })
  mock.store(on)
  world(on)
  for (const skill of ['mattpocock-skills:to-tickets', 'mattpocock-skills:retro']) {
    const text = (await $.skill.prompt({ skill, text: 'x' })).text as string
    // En mode auto, la validation est sautée et déclarée : la relecture garde son moment.
    expect(text).toContain('before the breakdown is validated (by the user, or, when that validation is skipped, before declaring it skipped), reread each done criterion of a sensitive ticket against its invariant')
  }
  const retro = (await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })).text as string
  expect(retro).toContain('each transition of the object that carries a mark (sent, cancelled, sent again, back)')
  // Le découpage d'une rétro reçoit aussi la logique d'une règle et la fusion en question.
  expect(retro).toContain('a ticket that changes the common rules (config/rules), a reference file or a skill says « Logique : oui »')
  expect(retro).toContain('a choice of how a persisted field merges (several discussions or sessions write it) is a concurrency question for the user')
  // Et, comme /to-tickets, l'advisor avant la validation et la vérification d'une API du moteur.
  expect(retro).toContain('consult the advisor (advisor tool), not a reviewer subagent, before the button question')
  expect(retro).toContain('load the plugin-authoring skill and ask the explorer a question')
})

// À /to-tickets, l'étape explore avait été sautée (aucun code lu pour 8 tickets dont 5 sensibles), le
// découpage validé sans advisor, un ticket de règles communes dit sans logique, et un choix de fusion
// d'un champ persisté déclaré au lieu d'être posé.
test('/to-tickets fait lire le code des tickets sensibles, consulter l’advisor avant la validation, dire la logique d’une règle et poser une fusion en question', async ($, on) => {
  mock.clock(on, { now: 56_000_000 })
  mock.store(on)
  world(on)
  const text = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text as string
  expect(text).toContain('read the code of each sensitive ticket (the functions it names, the paths that write, merge or erase its data) before writing it, even when the spec seems to say enough')
  expect(text).toContain('consult the advisor (advisor tool), not a reviewer subagent, before the button question, or, when that validation is skipped, before declaring it skipped; without that tool, reread the breakdown yourself in this discussion')
  expect(text).toContain('a ticket that changes the common rules (config/rules), a reference file or a skill says « Logique : oui », even when it makes Claude run no command: these texts steer what Claude does')
  expect(text).toContain('a choice of how a persisted field merges (several discussions or sessions write it) is a concurrency question for the user, never a declared choice')
})

// Une spec avait écrit « $.prompt.submit » pour lancer une commande, que les types donnaient à
// $.command.run, et supposé une notification du mod visible partout (no-surface sur l'app desktop).
test('/to-spec et /to-tickets font vérifier une API du moteur par plugin-authoring et une question, et les surfaces d’une notification', async ($, on) => {
  mock.clock(on, { now: 54_000_000 })
  mock.store(on)
  world(on)
  for (const skill of ['mattpocock-skills:to-spec', 'mattpocock-skills:to-tickets']) {
    const text = (await $.skill.prompt({ skill, text: 'x' })).text as string
    expect(text).toContain('before writing a call of the Claude Code engine ($.…) into a spec or a ticket, load the plugin-authoring skill and ask the explorer a question (which call does it, and what does it return when it does not), never a hypothesis to confirm')
    expect(text).toContain('before specifying a notification, check its surfaces in the engine types: $.ui.notify answers no-surface')
    // Sans terminal (l'app desktop), les hooks Notification de la personne tournent encore ; non liée ou en fermeture, aucun.
    expect(text).toContain('only the Notification hooks of the person then run, no channel writes) and, with no hook run at all, before a session is bound or while it is exiting')
  }
})
