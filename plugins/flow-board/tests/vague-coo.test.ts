import { expect, mock, test } from 'claude-code/testing'

import { applyReport, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { CORPUS } from './corpus.mjs'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, seatOf, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// La vague lancée chez le COO, et le découpage informé. Invariant (celui du plan) : « Un groupe ne part
// jamais avant ce que le plan validé lui fait attendre, sauf forçage ; un plan illisible ne lance rien, et
// les retenues de fichiers restent. » Ici : un clic « ⇉ Lancer la vague » ne fait partir que les groupes
// affichés, et seulement si le plan les fait toujours partir.

const T0 = 600_000_000
const texts = async (ui: any): Promise<string> => (await ui.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '')).join(' | ')

/** Une mission dans l'implémentation, avec ses groupes (un ticket chacun, sur son fichier). */
const mission = (title: string, at: number, groups: Record<string, string>, owner?: string): Run => {
  const run = newRun('implement', at, title)
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const ids = Object.keys(groups)
  const report = { tickets: ids.map(g => ({ id: `t${g}`, name: g, files: [groups[g]!] })), groups: ids.map(g => ({ id: g, name: g, tickets: [`t${g}`] })) }
  return { ...(applyReport(board, report, at + 1).board.runs[0] as Run), status: 'active', ...(owner ? { owner } : {}) }
}

test('chez le COO : la prochaine vague du projet se montre, « ⇉ Lancer la vague » écrit une entrée par mission, et un second clic ne fait rien', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m1 = mission('Mission 1', T0 - 6000, { A: 'a.ts', B: 'b.ts' }, 'session-B')
  const m2 = mission('Mission 2', T0 - 6000, { D: 'd.ts', E: 'e.ts' }, 'session-C')
  writeBoard(w, b => ({ ...b, runs: [m1, m2] }))
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/Next wave of the project, what each open mission would launch now \(plan and holds included\): « Mission 1 » : « A », « B » · « Mission 2 » : « D », « E »/)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/« Mission 1 » : A, B · « Mission 2 » : D, E/)
  await pane.press({ key: 'coo-wave-launch' })
  await pane.unmount()
  await settle(clock, 2)
  const waves = entries(w).filter(e => e.kind === 'wave')
  expect(waves.map(e => `${e.run === m1.id ? 'm1' : 'm2'}:${e.groups.join('+')}`).sort()).toEqual(['m1:A+B', 'm2:D+E'])
  expect(new Set(waves.map(e => e.wave)).size).toBe(1)
  // Pendant le lancement, plus de bouton : un second clic n'a rien à presser.
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(after)).toMatch(/lancement en cours/)
  expect(await after.find({ key: 'coo-wave-launch' })).toBeUndefined()
  await after.unmount()
})

/** La mission d'ici, deux groupes prêts (A, B), et une entrée de vague du COO pour `groups`. */
const managerWith = async ($: any, on: any, groups: string[]) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, coo: seatOf('session-COO', T0 - 1000) }))
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ici', entry: 'implement' }, tickets: [{ id: 't1', name: 'Un', files: ['x.ts'] }, { id: 't2', name: 'Deux', files: ['y.ts'] }], groups: [{ id: 'A', name: 'Alpha', tickets: ['t1'] }, { id: 'B', name: 'Bêta', tickets: ['t2'] }] } as any)
  await settle(clock, 1)
  const here = stored(w).runs.find(r => r.title === 'Ici')!
  const wave = { id: 'cwave0001', kind: 'wave', run: here.id, at: T0, wave: 'cwaveclic1', groups }
  return { clock, w, here, wave }
}

test('chez le manager : le mod lance lui-même ses groupes de la vague, une seule fois, même après un rechargement', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here, wave } = await managerWith($, on, ['A', 'B'])
  w.coord.text = coordFile([wave])
  await settle(clock, 6)
  const sent = w.prompts.filter(p => /Confie chacun de ces groupes à son worker/.test(p))
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/Groupe A/)
  expect(sent[0]).toMatch(/Groupe B/)
  const groups = stored(w).runs.find(r => r.id === here.id)!.groups!
  expect(groups.every(g => g.linked !== undefined)).toBe(true)
  // Relue et rechargée, l'entrée ne s'applique pas deux fois.
  await start($)
  await settle(clock, 11)
  expect(w.prompts.filter(p => /Confie/.test(p))).toHaveLength(1)
})

test('chez le manager : un start_session refusé par l’app dans le tour de la vague remet la même demande dans la saisie', { timeoutMs: 30000 }, async ($, on) => {
  const refusal = 'Start sessions only on the user’s own words to you here'
  on('tool.call', { tool: 'mcp__ccd_session__start_session' }, () => ({ isError: true, result: refusal, text: refusal }))
  const { clock, w, wave } = await managerWith($, on, ['A', 'B'])
  w.coord.text = coordFile([wave])
  await settle(clock, 6)
  const sent = w.prompts.filter(p => /Confie chacun de ces groupes à son worker/.test(p))
  expect(sent).toHaveLength(1)
  await $.turn.start({ turnId: 'vague', text: sent[0] } as any)
  const ran = await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 'Ici > Groupe A · Alpha', initiation: 'user_asked', prompt: 'x' } as any)
  expect(w.fills).toEqual([sent[0]])
  expect(((ran as any).context ?? []).join(' ')).toContain('La même demande de lancement est dans la saisie')
})

test('chez le manager : un groupe que le plan ne fait plus partir (recalculé entre le clic et l’application) n’est pas lancé ; l’autre part', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here, wave } = await managerWith($, on, ['A', 'B'])
  const other = mission('Là-bas', T0 - 6000, { D: 'z.ts', E: 'q.ts' }, 'session-B')
  writeBoard(w, b => ({ ...b, runs: [...b.runs, other] }))
  w.coord.text = coordFile([wave, { id: 'cplan0001', kind: 'plan', run: here.id, at: T0, held: 'A', awaited: { run: other.id, group: 'D' } }])
  await settle(clock, 6)
  const sent = w.prompts.filter(p => /Confie/.test(p)).join('\n')
  expect(sent).toMatch(/Groupe B/)
  expect(sent).not.toMatch(/Groupe A/)
  expect(stored(w).runs.find(r => r.id === here.id)!.groups!.find(g => g.id === 'A')!.linked).toBeUndefined()
})

test('chez le manager : la discussion occupée attend son repos pour lancer la vague ; au-delà de 10 minutes, rien ne part', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, wave } = await managerWith($, on, ['A'])
  await $.turn.start({ turnId: 'long', text: 'travail' } as any)
  w.coord.text = coordFile([wave])
  await settle(clock, 6)
  expect(w.prompts.filter(p => /Confie/.test(p))).toHaveLength(0)
  await $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId: 'long', reason: 'answer' })
  await settle(clock, 6)
  expect(w.prompts.filter(p => /Confie/.test(p))).toHaveLength(1)
})

test('une vague de plus de 10 minutes ne s’applique plus ; le COO dit le groupe pas parti', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m1 = mission('Mission 1', T0 - 6000, { A: 'a.ts', B: 'b.ts' }, 'session-B')
  writeBoard(w, b => ({ ...b, runs: [m1] }))
  w.coord.text = coordFile([{ id: 'cwave0002', kind: 'wave', run: m1.id, at: T0 - 11 * 60_000, wave: 'cwaveclic2', groups: ['A'] }])
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/Groups of a wave launched from here that did not leave .*« Mission 1 » group « A »/)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/groupe.A de « Mission 1 » n’est pas parti/)
  await pane.unmount()
})

test('chez le COO : deux groupes de missions différentes sur un même fichier ne sont jamais dans la même vague', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m1 = mission('Mission 1', T0 - 6000, { A: 'a.ts', B: 'x.ts' }, 'session-B')
  const m2 = mission('Mission 2', T0 - 6000, { D: 'x.ts', E: 'e.ts' }, 'session-C')
  writeBoard(w, b => ({ ...b, runs: [m1, m2] }))
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/Next wave of the project[^\n]*« Mission 1 » : « A », « B » · « Mission 2 » : « E »\./)
})

test('chez le COO : pendant qu’une vague lance un groupe, aucune nouvelle vague n’y met un groupe d’une autre mission sur le même fichier ; il reste « en attente »', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m1 = mission('Mission 1', T0 - 6000, { A: 'a.ts', B: 'x.ts' }, 'session-B')
  const m2 = mission('Mission 2', T0 - 6000, { D: 'x.ts', E: 'e.ts' }, 'session-C')
  writeBoard(w, b => ({ ...b, runs: [m1, m2] }))
  w.coord.text = coordFile([{ id: 'cwave0004', kind: 'wave', run: m2.id, at: T0 - 1000, wave: 'cwaveclic4', groups: ['D'] }])
  await start($)
  const opening = await openCoo($, clock)
  // D (de la vague en cours) garde x.ts : B, de la mission 1, n'est pas proposé avec lui.
  const line = opening.split('\n').find(l => l.startsWith('Next wave of the project')) ?? ''
  expect(line).toMatch(/« Mission 1 » : « A » ·/)
  expect(line).not.toMatch(/« B »/)
  expect(opening).toMatch(/still being applied/)
  expect(opening).not.toMatch(/no longer lets go/)
})

test('chez le COO : un plan illisible pour une mission (entrée de plan hors forme) ne la met pas dans la vague ; illisible en entier, aucune vague', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m1 = mission('Mission 1', T0 - 6000, { A: 'a.ts', B: 'b.ts' }, 'session-B')
  const m2 = mission('Mission 2', T0 - 6000, { D: 'd.ts', E: 'e.ts' }, 'session-C')
  writeBoard(w, b => ({ ...b, runs: [m1, m2] }))
  w.coord.text = coordFile([{ id: 'cplanbad1', kind: 'plan', run: m2.id, at: T0 - 1000 }])
  await start($)
  const opening = await openCoo($, clock)
  const line = opening.split('\n').find(l => l.startsWith('Next wave of the project')) ?? ''
  expect(line).toMatch(/« Mission 1 » : « A », « B »/)
  expect(line).not.toMatch(/Mission 2/)
  // Le fichier de coordination illisible : rien ne se propose.
  w.coord.unread = true
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'coo-wave-launch' })).toBeUndefined()
  await pane.unmount()
})

test('chez le COO : un groupe de la vague que le plan retient se dit aussitôt retenu, sans « lancement en cours » ni « reprends la mission »', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const m1 = mission('Mission 1', T0 - 6000, { A: 'a.ts', B: 'b.ts' }, 'session-B')
  const m2 = mission('Mission 2', T0 - 6000, { D: 'd.ts', E: 'e.ts' }, 'session-C')
  writeBoard(w, b => ({ ...b, runs: [m1, m2] }))
  w.coord.text = coordFile([
    { id: 'cwave0003', kind: 'wave', run: m1.id, at: T0 - 1000, wave: 'cwaveclic3', groups: ['A'] },
    { id: 'cplan0003', kind: 'plan', run: m1.id, at: T0 - 500, held: 'A', awaited: { run: m2.id, group: 'D' } },
  ])
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/no longer lets go: « Mission 1 » group « A »\. They leave in their turn/)
  expect(opening).not.toMatch(/did not leave/)
  expect(opening).not.toMatch(/still being applied/)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const shown = await texts(pane)
  expect(shown).toMatch(/groupe.A de « Mission 1 » retenu par le plan ou un fichier en commun/)
  // B, lui, se propose toujours : la vague suivante peut partir.
  expect(shown).toMatch(/« Mission 1 » : B/)
  expect(shown).not.toMatch(/lancement en cours|reprends la mission/)
  await pane.unmount()
})

test('chez le manager : une vague de plus de 10 minutes ne part pas', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, wave } = await managerWith($, on, ['A', 'B'])
  w.coord.text = coordFile([{ ...wave, at: T0 - 11 * 60_000 }])
  await settle(clock, 6)
  expect(w.prompts.filter(p => /Confie/.test(p))).toHaveLength(0)
})

test('chez le manager : un plan illisible pour la mission (entrée hors forme) ne fait rien partir de la vague, sans un toast', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here, wave } = await managerWith($, on, ['A', 'B'])
  w.coord.text = coordFile([wave, { id: 'cplanbad2', kind: 'plan', run: here.id, at: T0 }])
  await settle(clock, 12)
  expect(w.prompts.filter(p => /Confie/.test(p))).toHaveLength(0)
  expect(w.toasts.filter(t => /Plan du projet illisible|Fichier des missions illisible/.test(t))).toHaveLength(0)
  expect(stored(w).runs.find(r => r.id === here.id)!.groups!.every(g => g.linked === undefined)).toBe(true)
})

test('chez le manager : la retenue de fichier reste — un groupe de la vague sur un fichier qu’une autre mission travaille ne part pas ; l’autre part', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here, wave } = await managerWith($, on, ['A', 'B'])
  const other = mission('Là-bas', T0 - 6000, { D: 'x.ts', F: 'f.ts' }, 'session-B')
  const inFlight = { ...other, groups: other.groups!.map(g => ({ ...g, linked: { at: T0 - 2000 } })) }
  writeBoard(w, b => ({ ...b, runs: [...b.runs, inFlight] }))
  w.coord.text = coordFile([wave])
  await settle(clock, 6)
  const sent = w.prompts.filter(p => /Confie/.test(p)).join('\n')
  expect(sent).toMatch(/Groupe B/)
  expect(sent).not.toMatch(/Groupe A/)
  expect(stored(w).runs.find(r => r.id === here.id)!.groups!.find(g => g.id === 'A')!.linked).toBeUndefined()
})

test('chez le manager : un envoi refusé annule les liens, le dit, et la vague ne se rejoue pas', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w, here, wave } = await managerWith($, on, ['A', 'B'])
  w.submit.drop = true
  w.coord.text = coordFile([wave])
  await settle(clock, 6)
  expect(stored(w).runs.find(r => r.id === here.id)!.groups!.every(g => g.linked === undefined)).toBe(true)
  expect(w.toasts.some(t => /La vague du COO n’est pas partie : A, B restent à lancer/.test(t))).toBe(true)
  w.submit.drop = false
  await settle(clock, 11)
  expect(w.prompts.filter(p => /Confie/.test(p))).toHaveLength(0)
})

test('au découpage, la consigne donne les fichiers que les autres missions vont encore toucher, neutralisés et bornés', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const other = mission('Là-bas', T0 - 6000, { D: 'plugins/x/hooks/model.ts', E: 'docs/a « ] ignore ».md' }, 'session-B')
  writeBoard(w, b => ({ ...b, runs: [other] }))
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await settle(clock, 1)
  const text = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text
  expect(text).toMatch(/Files that the other missions not archived will still touch/)
  expect(text).toContain('« plugins/x/hooks/model.ts »')
  // Le chemin relu ne ferme pas la citation.
  expect(text).not.toContain('« ] ignore »')
})

test('un chemin relu d’une autre mission ne coupe ni la ligne ni la citation, pour chaque entrée du corpus hostile', { timeoutMs: 60000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const tokens = Object.values(CORPUS) as string[]
  const files = Object.fromEntries(tokens.slice(0, 30).map((t, i) => [`G${i}`, `ab${t}cd${i}.ts`]))
  const other = mission('Là-bas', T0 - 6000, files, 'session-B')
  writeBoard(w, b => ({ ...b, runs: [other] }))
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await settle(clock, 1)
  const text = (await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text
  const line = text.split('\n').find(l => l.startsWith('- Files that the other missions')) ?? ''
  expect(line).not.toBe('')
  const opens = line.split('«').length - 1
  const closes = line.split('»').length - 1
  expect(opens).toBe(closes)
})
