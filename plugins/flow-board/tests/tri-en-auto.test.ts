// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).
// Le tri en mode auto : un bloc propre au tri (pas d'attente après la recommandation, le partage déclaré comme une
// validation sautée, « écarte » et « renvoie » sans effet sur une entrée existante avant l'accord, la sous-ligne
// renvoyée mise de côté tout de suite, la ligne « question » posée sur la phase Compte rendu), `demande.md` d'abord
// pour une mission que le COO a lancée en auto, et, dans le modèle, une question posée sur le Compte rendu qui ne
// retient ni le découpage ni les groupes, seulement le compte rendu (ce que le code faisait déjà).

import { expect, mock, test } from 'claude-code/testing'

import { activeRun } from '../hooks/basics.ts'
import { launchKey, type LaunchRecord } from '../hooks/launch.ts'
import { AUTO_STOPS, applyReport, applySkill, autoDecision, emptyBoard, startLinkedGroups, type AutoDecision } from '../hooks/model.ts'
import type { Board } from '../types'
import { start, settle, world as coordination } from './monde-coordination.ts'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const

/** Le moteur sous le plugin : `$.store` et les fichiers en mémoire (le fichier commun des missions sert sous un `.claude/`). */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'sa' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'sa' }))
  on('command.list', () => ({ value: [] }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
}

const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key })
  await pane.unmount()
}

const triage = async ($: any): Promise<string> => String((await $.skill.prompt({ skill: 'mattpocock-skills:triage', text: 'x' })).text)

/** Un tri tapé à la main, auto allumé ou non par « ⚡ Auto » puis « Confirmer », et le texte rendu au chargement suivant de /triage. */
const typed = async ($: any, on: any, isAuto: boolean): Promise<string> => {
  const clock = mock.clock(on, { now: 90_000_000 })
  world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await triage($)
  await $.tool.call({ tool: TOOL, title: 'Tri' } as any)
  if (isAuto) {
    await press($, 'auto-on')
    await press($, 'auto-confirm')
  }
  await clock.advance(1000)
  return triage($)
}

const TRIAGE_BLOCK = [
  'Triage in auto mode: do not wait after your recommendation',
  'declare the partition as a skipped validation ({"decided": [{"what": "Partage du tri : <the path of tri.md>", "origin": "skipped-validation"}]})',
  'flow-board itself sends /to-tickets, which starts from the « corrige » rows',
  'an « écarte » row or an entry in state « renvoie » changes neither code nor roadmap',
  'Only a sub-line in state « renvoie » is declared set aside right away, once tri.md is written ({"setAside": [{"text": "<the id of the entry it comes from>: <the sub-line>", "source": "tri.md"}]}): the roadmap\'s owner (the COO) copies it as a new entry « à décider », where only the user decides; no existing entry changes state',
  'A « question » row is a blocking question on the Report phase ({"waiting": [{"id": "<short id>", "phase": "compte-rendu", "text": "<short>"}]}): it holds back only the report, never the ticket split nor the groups',
  'write the answer in the decision file, the question and the answer word for word; update tri.md; when the answer gives a fix while the triage is still under way, its row becomes « corrige » in tri.md and no ticket is sent (the Tickets phase splits it: a ticket sent during the triage would skip that phase); when it comes later, add a ticket to the lot ({"tickets": […]}): in a mission with groups, with its group (the whole plan again in {"groups": […]}); without groups (a plan of one group is ignored), do that ticket in this discussion, with the steps of a ticket of the lot (its checks, its review, its commit: the procedure /implement gives), before withdrawing the question',
]

test('auto allumé, /triage porte le bloc propre au tri, après le bloc commun', { timeoutMs: 20000 }, async ($, on) => {
  const text = await typed($, on, true)
  expect(text).toContain('Auto mode is on for this mission')
  for (const part of TRIAGE_BLOCK) expect(text).toContain(part)
  // Tapé à la main, sans carte du COO : pas de demande.md.
  expect(text).not.toContain('demande.md')
})

test('auto éteint, /triage n’a pas le bloc du tri', { timeoutMs: 20000 }, async ($, on) => {
  const text = await typed($, on, false)
  // Le contrôle positif : la consigne de flow-board est bien là.
  expect(text).toContain('Dashboard (flow-board)')
  expect(text).not.toContain('Triage in auto mode')
  expect(text).not.toContain('Auto mode is on for this mission')
})

/** Une carte « Lancer en auto » du COO en /triage, consommée par la discussion lancée ; la réponse de l'outil, puis le rechargement de /triage. */
const launched = async ($: any, on: any, mode: 'auto' | 'manual') => {
  const now = 410_000_000
  const clock = mock.clock(on, { now })
  const w = coordination(on)
  w.ids.now = 'session-N'
  const r: LaunchRecord = { v: 1, id: 'ltriage1234', card: 'ktriage12', root: '', title: 'Bugs du parcours', start: 'triage', mode, effort: 'high', folder: 'bugs-du-parcours', at: now - 30_000, by: 'session-COO' }
  w.mem[launchKey(r.id)] = r
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:triage', text: 'x' })
  const call = $.tool.call({ tool: TOOL, launch: r.id, title: 'Bugs du parcours' } as any)
  await settle(clock, 3)
  const answer = String(((await call) as any).result)
  return { answer, reloaded: String((await $.skill.prompt({ skill: 'mattpocock-skills:triage', text: 'x' })).text) }
}

test('un tri lancé en auto par le COO lit d’abord demande.md de son dossier : dans la réponse de l’allumage et au chargement de /triage', { timeoutMs: 20000 }, async ($, on) => {
  const { answer, reloaded } = await launched($, on, 'auto')
  expect(answer).toMatch(/Auto mode is ON for this mission now/)
  for (const text of [answer, reloaded]) {
    expect(text).toContain('Triage in auto mode, for a mission launched by the COO: the COO gathered the intent round (the goal, the scope, what is out of scope) with the user in travail/bugs-du-parcours/demande.md. Read that file first.')
    expect(text).toContain('When it does not exist, go on from the entries the first message names, without an intent round.')
    // Le tri n'est pas un grilling : ni la suite du cadrage en auto ni son tour d'intention.
    expect(text).not.toContain('The final agreement is not asked')
    expect(text).toContain('Triage in auto mode: do not wait after your recommendation')
  }
})

test('un tri lancé en manuel par le COO ne renvoie pas à demande.md', { timeoutMs: 20000 }, async ($, on) => {
  const { answer, reloaded } = await launched($, on, 'manual')
  expect(answer).toMatch(/It runs in manual/)
  expect(reloaded).toContain('Dashboard (flow-board)')
  expect(reloaded).not.toContain('demande.md')
})

// ─── Le modèle : une question du tri posée sur le Compte rendu ───────────────

const T0 = 1_000
const NO_LOGIC = { sensitive: false, logic: false }
const QUESTION = { id: 'q-r62', phase: 'compte-rendu', text: 'R62-b : garder le lien ?' }

const boardOf = (): Board => applySkill({ ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [], activeId: null }, 'mattpocock-skills:triage', { now: T0, isMain: true })!.board

const sent = (d: AutoDecision): string | null => (d.kind !== 'send' ? null : d.action.kind === 'command' ? d.action.skill : d.action.kind)
const decide = (b: Board): AutoDecision => autoDecision(activeRun(b)!, {}, false)

/** Le tri fini avec une question ouverte sur le Compte rendu, puis le découpage chargé par l'auto. */
const triagedWithQuestion = (): Board => {
  let b = applyReport(boardOf(), { waiting: [QUESTION] }, T0 + 100).board
  expect(activeRun(b)!.waiting?.map(q => q.blocks)).toEqual([{ kind: 'phase', id: 'compte-rendu' }])
  b = applyReport(b, { complete: true }, T0 + 200).board
  // À la fin du tri, l'auto envoie /to-tickets malgré la question.
  expect(sent(decide(b))).toBe('to-tickets')
  return applySkill(b, 'mattpocock-skills:to-tickets', { now: T0 + 300, isMain: true })!.board
}

test('une question du tri sur le Compte rendu : /to-tickets part, les groupes partent, le compte rendu attend la réponse, puis part', () => {
  let b = triagedWithQuestion()
  b = applyReport(b, {
    tickets: [{ id: 't1', name: 'Hook', ...NO_LOGIC }, { id: 't2', name: 'Script', ...NO_LOGIC }],
    groups: [{ id: 'A', name: 'Hook', tickets: ['t1'] }, { id: 'B', name: 'Script', tickets: ['t2'] }],
    complete: true,
  }, T0 + 400).board
  // Le découpage fini, l'auto lance les groupes.
  const wave = decide(b)
  expect(wave.kind === 'send' && wave.action.kind === 'groups' ? wave.action.groups : null).toEqual(['A', 'B'])
  b = startLinkedGroups(b, ['A', 'B'], T0 + 500)!.board
  b = applyReport(b, { set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'done' }], returned: ['A', 'B'] }, T0 + 600).board
  b = applyReport(b, { closed: [{ group: 'A', state: 'closed' }, { group: 'B', state: 'closed' }] }, T0 + 700).board
  // Les groupes clos : le compte rendu ne part pas, l'auto se met en pause sur la question.
  const held = decide(b)
  expect(held).toEqual({ kind: 'stop', why: AUTO_STOPS.stuck, relaunch: [] })
  // La question retirée, il part.
  b = applyReport(b, { waiting: [{ id: QUESTION.id, answered: true }] }, T0 + 800).board
  expect(sent(decide(b))).toBe('compte-rendu')
})

test('même question, lot sans groupes : l’auto envoie /implement, puis retient le compte rendu de la même façon', () => {
  let b = triagedWithQuestion()
  b = applyReport(b, { tickets: [{ id: 't1', name: 'Hook', ...NO_LOGIC }], complete: true }, T0 + 400).board
  expect(sent(decide(b))).toBe('implement')
  b = applySkill(b, 'mattpocock-skills:implement', { now: T0 + 500, isMain: true })!.board
  b = applyReport(b, { set: [{ id: 't1', status: 'done' }], complete: true }, T0 + 600).board
  expect(decide(b)).toEqual({ kind: 'stop', why: AUTO_STOPS.stuck, relaunch: [] })
  b = applyReport(b, { waiting: [{ id: QUESTION.id, answered: true }] }, T0 + 700).board
  expect(sent(decide(b))).toBe('compte-rendu')
})

test('un tri sans correction mais avec une question : la phase Tickets finit sans ticket, rien ne part vers l’Implémentation, l’auto se met en pause', () => {
  let b = triagedWithQuestion()
  b = applyReport(b, { complete: true }, T0 + 400).board
  const run = activeRun(b)!
  expect(run.phases.find(p => p.skill === 'to-tickets')!.status).toBe('done')
  expect(run.tickets.length).toBe(0)
  expect(run.status).toBe('active')
  expect(decide(b)).toEqual({ kind: 'stop', why: AUTO_STOPS.stuck, relaunch: [] })
})

// ─── Les appels que dicte le bloc du tri, rejoués ────────────────────────────

test('pendant le tri, le partage déclaré comme validation sautée est gardé avec son origine', () => {
  const b = applyReport(boardOf(), { decided: [{ what: 'Partage du tri : travail/bugs/tri.md', origin: 'skipped-validation' }] }, T0 + 100).board
  expect(activeRun(b)!.decided).toEqual([expect.objectContaining({ what: 'Partage du tri : travail/bugs/tri.md', origin: 'skipped-validation' })])
})

test('pendant le tri en auto, une sous-ligne renvoyée se met de côté pour le COO', { timeoutMs: 20000 }, async ($, on) => {
  await typed($, on, true)
  const out = String(((await $.tool.call({ tool: TOOL, setAside: [{ text: 'R62: R62-b, le lien de la carte', source: 'tri.md' }] } as any)) as any).result)
  expect(out).toContain("Set aside for the COO's « À reprendre » list: 1")
  expect(out).not.toContain('NOT recorded')
})

test('la réponse arrivée pendant le tri : sa ligne passe « corrige », aucun ticket, et /to-tickets part à la fin du tri', () => {
  let b = applyReport(boardOf(), { waiting: [QUESTION] }, T0 + 100).board
  b = applyReport(b, { waiting: [{ id: QUESTION.id, answered: true }] }, T0 + 150).board
  b = applyReport(b, { complete: true }, T0 + 200).board
  expect(activeRun(b)!.tickets.length).toBe(0)
  expect(sent(decide(b))).toBe('to-tickets')
})

test('la réponse qui donne une correction, avec groupes : le ticket neuf et le plan entier renvoyé, la question retirée, le groupe neuf part', () => {
  let b = triagedWithQuestion()
  const groups = [{ id: 'A', name: 'Hook', tickets: ['t1'] }, { id: 'B', name: 'Script', tickets: ['t2'] }]
  b = applyReport(b, { tickets: [{ id: 't1', name: 'Hook', ...NO_LOGIC }, { id: 't2', name: 'Script', ...NO_LOGIC }], groups, complete: true }, T0 + 400).board
  b = startLinkedGroups(b, ['A', 'B'], T0 + 500)!.board
  b = applyReport(b, { set: [{ id: 't1', status: 'done' }, { id: 't2', status: 'done' }], returned: ['A', 'B'] }, T0 + 600).board
  b = applyReport(b, { closed: [{ group: 'A', state: 'closed' }, { group: 'B', state: 'closed' }] }, T0 + 700).board
  b = applyReport(b, { tickets: [{ id: 't3', name: 'Lien', ...NO_LOGIC }], groups: [...groups, { id: 'C', name: 'Lien', tickets: ['t3'] }] }, T0 + 800).board
  b = applyReport(b, { waiting: [{ id: QUESTION.id, answered: true }] }, T0 + 900).board
  const next = decide(b)
  expect(next.kind === 'send' && next.action.kind === 'groups' ? next.action.groups : null).toEqual(['C'])
})

test('la réponse qui donne une correction, sans groupes : le ticket neuf entre au lot, fait ici, puis le compte rendu part', () => {
  let b = triagedWithQuestion()
  b = applyReport(b, { tickets: [{ id: 't1', name: 'Hook', ...NO_LOGIC }], complete: true }, T0 + 400).board
  b = applySkill(b, 'mattpocock-skills:implement', { now: T0 + 500, isMain: true })!.board
  b = applyReport(b, { set: [{ id: 't1', status: 'done' }], complete: true }, T0 + 600).board
  b = applyReport(b, { tickets: [{ id: 't2', name: 'Lien', ...NO_LOGIC }] }, T0 + 700).board
  expect(activeRun(b)!.tickets.map(t => t.id)).toEqual(['t1', 't2'])
  b = applyReport(b, { set: [{ id: 't2', status: 'done' }] }, T0 + 800).board
  b = applyReport(b, { waiting: [{ id: QUESTION.id, answered: true }] }, T0 + 900).board
  expect(sent(decide(b))).toBe('compte-rendu')
})
