// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { newRun } from '../hooks/model.ts'
import { keptPrint, missionReportKey, reportRoundOf } from '../hooks/register.tsx'
import { relayFileSlug } from '../hooks/relay.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, coordFile, entries, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// Le rapport d'une mission lu et validé chez le COO. Invariant : « Un rapport n'est validé que par un
// clic de l'utilisateur sur la version qu'il a lue ; un rapport changé depuis n'est pas validé. »

const T0 = 400_000_000
const REPORT = '# Compte rendu : Mission de B\n\n**En bref** : tout est fait.\n\n## Fait\n- Ticket 1 : fait.'

const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

/**
 * Le rapport d'une mission gardé par le mod : son fichier (`~/.claude/flow-board/rapports/<mission>.md`) quand
 * le mod sait où est ~/.claude, `$.store` sinon ; posé ici aux deux endroits, par la fin du chemin du fichier.
 */
const reportTail = (runId: string): string => `flow-board/rapports/${relayFileSlug(runId)}.md`
/** Le texte du rapport gardé, sans sa ligne de tour. */
const reportOf = (_$: any, w: World, runId: string): unknown => {
  const path = Object.keys(w.files).find(p => p.endsWith(`/${reportTail(runId)}`))
  const body = path ? w.files[path] : w.mem[missionReportKey(runId)]
  return typeof body === 'string' ? body.replace(/^<!-- flow-board report round [0-9.]+ -->\n/, '') : body
}
/** Pose le rapport d'une mission pour son tour du compte rendu (`round`, celui en cours par défaut). */
const putReport = (_$: any, w: World, run: Run, text: string, round = reportRoundOf(run)) => {
  const body = `<!-- flow-board report round ${round} -->\n${text}`
  w.files[reportTail(run.id)] = body
  w.mem[missionReportKey(run.id)] = body
}
/** L'empreinte de la version qu'affiche le COO : le tour en cours et le texte. */
const printFor = (run: Run, text: string): string => keptPrint({ round: reportRoundOf(run)!, text })
const runOf = (w: World, id: string): Run => stored(w).runs.find(r => r.id === id)!

/** Une mission d'une autre discussion, à son compte rendu (le lot fait). */
const atReport = (now: number, status: Run['status'] = 'active'): Run => {
  const run = newRun('implement', now - 60_000, 'Mission de B')
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 30_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'active' as const, startedAt: now - 30_000, steps: [], items: [] }
  return { ...run, phases: [done, report], cursor: 1, status, ...(status === 'active' ? { owner: 'session-B' } : {}), updatedAt: now - 1_000 } as Run
}

/** La mission de cette discussion, à son compte rendu. */
const openAtReport = async ($: any, clock: any, w: World, text = REPORT): Promise<string> => {
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Ma mission', complete: true } as any)
  await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'r' })
  await $.tool.call({ tool: TOOL, report: text, step: 'validate' } as any)
  await settle(clock, 2)
  return stored(w).activeId!
}

const validations = (w: World) => w.prompts.filter(p => /J'ai validé le compte rendu/.test(p))

// ─── Le manager garde son rapport ─────────────────────────────────────────

test('le manager donne son rapport par le champ « report » : le mod le garde pour la mission, remplacé en entier', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openAtReport($, clock, w)
  expect(reportOf($, w, runId)).toBe(REPORT)
  const r = String(((await $.tool.call({ tool: TOOL, report: 'Version 2' } as any)) as any).result)
  expect(r).toMatch(/report is kept/i)
  expect(reportOf($, w, runId)).toBe('Version 2')
})

test('le champ « report » d’un manager hors du compte rendu n’est pas gardé', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Ma mission' } as any)
  await settle(clock, 1)
  const r = String(((await $.tool.call({ tool: TOOL, report: REPORT } as any)) as any).result)
  expect(r).toMatch(/not kept/i)
  expect(reportOf($, w, stored(w).activeId!)).toBeUndefined()
})

// ─── Le COO l'affiche et le valide ────────────────────────────────────────

test('chez le COO : « Rapport de <mission> à valider », lu en entier, puis « ✓ Valider » écrit l’empreinte de la version lue', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = atReport(T0)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  putReport($, w, run, REPORT)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/Rapport de « Mission de B » à valider/)
  // Pas de validation avant la lecture.
  expect(await pane.find({ key: `coo-report-validate-${run.id}` })).toBeUndefined()
  await pane.press({ key: `coo-report-read-${run.id}` })
  await pane.unmount()
  const open = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(open)).toMatch(/tout est fait/)
  await open.press({ key: `coo-report-validate-${run.id}` })
  await open.unmount()
  await settle(clock, 2)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'validate', run: run.id, print: printFor(run, REPORT) })])
  // Un second clic sur la même version n'écrit rien de plus.
  const again = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(again)).toMatch(/validation en cours/)
  expect(await again.find({ key: `coo-report-validate-${run.id}` })).toBeUndefined()
  await again.unmount()
  expect(entries(w)).toHaveLength(1)
})

test('chez le COO : le rapport changé entre la lecture et le clic n’est pas validé ; « Le rapport a changé depuis : relis-le »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = atReport(T0)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  putReport($, w, run, REPORT)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: `coo-report-read-${run.id}` })
  await pane.unmount()
  const open = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  putReport($, w, run, `${REPORT}\n- Ajout de dernière minute.`)
  await open.press({ key: `coo-report-validate-${run.id}` })
  await open.unmount()
  await settle(clock, 2)
  expect(entries(w)).toEqual([])
  expect(w.toasts.join('\n')).toMatch(/Le rapport a changé depuis : relis-le/)
})

test('chez le COO : la mission en pause n’a pas de « ✓ Valider » : « Rapport prêt, mission en pause : reprends-la pour valider »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = atReport(T0, 'paused')
  writeBoard(w, b => ({ ...b, runs: [run] }))
  putReport($, w, run, REPORT)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/Rapport prêt, mission en pause : reprends-la pour valider/)
  await pane.press({ key: `coo-report-read-${run.id}` })
  await pane.unmount()
  const open = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await open.find({ key: `coo-report-validate-${run.id}` })).toBeUndefined()
  await open.unmount()
})

// ─── Le manager applique la validation ────────────────────────────────────

test('le mod du manager applique la validation du COO sur la version lue : phase close, message de validation, une seule fois', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openAtReport($, clock, w)
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'validate', run: runId, at: T0, print: printFor(runOf(w, runId), REPORT) }])
  await settle(clock, 6)
  expect(stored(w).runs.find(r => r.id === runId)!.reportValidatedAt).toBeDefined()
  expect(validations(w)).toHaveLength(1)
  // Un double clic (deux entrées sur la même version) : rien ne se refait.
  w.coord.text = coordFile([
    { id: 'cabc1234', kind: 'validate', run: runId, at: T0, print: printFor(runOf(w, runId), REPORT) },
    { id: 'cdef5678', kind: 'validate', run: runId, at: T0 + 1, print: printFor(runOf(w, runId), REPORT) },
  ])
  await settle(clock, 10)
  expect(validations(w)).toHaveLength(1)
})

test('le mod du manager ne valide pas un rapport réécrit depuis la lecture du COO', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openAtReport($, clock, w)
  await $.tool.call({ tool: TOOL, report: `${REPORT}\n- Une correction.` } as any)
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'validate', run: runId, at: T0, print: printFor(runOf(w, runId), REPORT) }])
  await settle(clock, 8)
  // Le relais a tourné : l'entrée est notée appliquée, sans rien valider.
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
  expect(stored(w).runs.find(r => r.id === runId)!.reportValidatedAt).toBeUndefined()
  expect(validations(w)).toEqual([])
})

// ─── « ✎ À reprendre » ────────────────────────────────────────────────────

test('« ✎ À reprendre » chez le COO met dans la saisie le début de la demande, avec l’id de la mission', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = atReport(T0)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  putReport($, w, run, REPORT)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: `coo-report-read-${run.id}` })
  await pane.unmount()
  const open = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await open.press({ key: `coo-report-redo-${run.id}` })
  await open.unmount()
  expect(w.fills.at(-1)).toBe(`À reprendre dans le rapport de la mission « Mission de B » (id "${run.id}") : `)
  expect(entries(w)).toEqual([])
})

test('« redo » relayé : le manager le dit à son Claude une fois, avec le DECISIONS.md et la série', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openAtReport($, clock, w)
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'redo', run: runId, at: T0, file: 'travail/sujet/DECISIONS.md', series: 4, round: reportRoundOf(runOf(w, runId)) }])
  await settle(clock, 6)
  const sent = w.prompts.filter(p => /rapport/i.test(p) && /travail\/sujet\/DECISIONS\.md/.test(p))
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/série 4/)
  expect(stored(w).runs.find(r => r.id === runId)!.reportValidatedAt).toBeUndefined()
  await settle(clock, 10)
  expect(w.prompts.filter(p => /rapport/i.test(p) && /travail\/sujet\/DECISIONS\.md/.test(p))).toHaveLength(1)
})

test('chez le COO, « redo » se note seulement avec un DECISIONS.md existant sous travail/', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = atReport(T0)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  putReport($, w, run, REPORT)
  w.files['travail/sujet/DECISIONS.md'] = '# Décisions\n'
  await start($)
  await openCoo($, clock)
  const call = async (file: string) => String(((await $.tool.call({ tool: TOOL, coordinate: { redo: [{ mission: run.id, file, series: 4 }] } } as any)) as any).result)
  expect(await call('travail/../DECISIONS.md')).toMatch(/refused/i)
  expect(await call('travail/absent/DECISIONS.md')).toMatch(/refused/i)
  expect(entries(w)).toEqual([])
  expect(await call('travail/sujet/DECISIONS.md')).toMatch(/recorded/i)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'redo', run: run.id, file: 'travail/sujet/DECISIONS.md', series: 4 })])
})

test('chez le COO, une validation consommée sans effet ne bloque « ✓ Valider » que deux minutes', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = atReport(T0)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  putReport($, w, run, REPORT)
  // Une validation d'il y a trois minutes sur ce texte, que la mission n'a pas appliquée (rapport réécrit puis revenu).
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'validate', run: run.id, at: T0 - 3 * 60_000, print: printFor(run, REPORT) }])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).not.toMatch(/validation en cours/)
  await pane.press({ key: `coo-report-read-${run.id}` })
  await pane.unmount()
  const open = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await open.press({ key: `coo-report-validate-${run.id}` })
  await open.unmount()
  await settle(clock, 2)
  expect(entries(w).filter((e: any) => e.kind === 'validate')).toHaveLength(2)
})

test('chez le COO, « redo » pour une mission ouverte nulle part se note et dit de la reprendre', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = atReport(T0, 'paused')
  writeBoard(w, b => ({ ...b, runs: [run] }))
  w.files['travail/sujet/DECISIONS.md'] = '# Décisions\n'
  await start($)
  await openCoo($, clock)
  const out = String(((await $.tool.call({ tool: TOOL, coordinate: { redo: [{ mission: run.id, file: 'travail/sujet/DECISIONS.md', series: 4 }] } } as any)) as any).result)
  expect(out).toMatch(/open in no discussion/)
  expect(out).toMatch(/Reprends-la/)
})

test('chez le COO, le rapport réécrit pendant la lecture : « ✓ Valider » disparaît jusqu’à « ↻ Relire »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = atReport(T0)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  putReport($, w, run, REPORT)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: `coo-report-read-${run.id}` })
  await pane.unmount()
  // Le manager redonne une version pendant la lecture ; la relecture des 5 s la voit.
  putReport($, w, run, `${REPORT}\n- Une ligne changée.`)
  await settle(clock, 6)
  const stale = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(stale)).toMatch(/Le rapport a changé depuis : relis-le/)
  expect(await stale.find({ key: `coo-report-validate-${run.id}` })).toBeUndefined()
  await stale.press({ key: `coo-report-read-${run.id}` })
  await stale.unmount()
  const reread = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(reread)).toMatch(/Une ligne changée/)
  await reread.press({ key: `coo-report-validate-${run.id}` })
  await reread.unmount()
  await settle(clock, 2)
  expect(entries(w)).toEqual([expect.objectContaining({ kind: 'validate', print: printFor(run, `${REPORT}\n- Une ligne changée.`) })])
})

test('chez le COO, le rapport d’un tour précédent du compte rendu ne se montre pas', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const run = atReport(T0)
  writeBoard(w, b => ({ ...b, runs: [run] }))
  // Gardé au tour 1 ; la phase est au tour 2 (relancée, ou revenue de l'implémentation).
  const again = { ...run, phases: [run.phases[0]!, { ...run.phases[1]!, round: 2, startedAt: T0 - 10_000 }] } as Run
  writeBoard(w, b => ({ ...b, runs: [again] }))
  putReport($, w, again, REPORT, reportRoundOf(run)!)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await texts(pane)).toMatch(/Mission de B/)
  expect(await texts(pane)).not.toMatch(/Rapport de « Mission de B » à valider/)
  await pane.unmount()
})

test('le mod du manager ne valide pas avec une validation d’un autre tour du compte rendu, ni ne garde un rapport après la validation', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const runId = await openAtReport($, clock, w)
  // L'empreinte du même texte à un autre tour (le tour 1 d'avant une relance) : jamais appliquée à celui-ci.
  const other = keptPrint({ round: '9.9.9', text: REPORT })
  w.coord.text = coordFile([{ id: 'cabc1234', kind: 'validate', run: runId, at: T0, print: other }])
  await settle(clock, 6)
  expect(w.mem[`coo-applied:${runId}`]).toEqual(['cabc1234'])
  expect(runOf(w, runId).reportValidatedAt).toBeUndefined()
  // Validé (ici sur la bonne version), un nouveau rapport n'est plus gardé : la version validée reste.
  w.coord.text = coordFile([{ id: 'cdef5678', kind: 'validate', run: runId, at: T0 + 1, print: printFor(runOf(w, runId), REPORT) }])
  await settle(clock, 6)
  expect(runOf(w, runId).reportValidatedAt).toBeDefined()
  const r = String(((await $.tool.call({ tool: TOOL, report: 'Une autre version' } as any)) as any).result)
  expect(r).toMatch(/not kept/)
  expect(reportOf($, w, runId)).toBe(REPORT)
})
