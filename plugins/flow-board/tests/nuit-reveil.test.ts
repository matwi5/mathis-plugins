// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { AUTO_STOPS, newRun } from '../hooks/model.ts'
import { NIGHT_WAKE_MS, NIGHT_WAKE_TEXT } from '../hooks/night.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'

// Le réveil de nuit : pendant une surveillance valide, le mod du COO envoie à sa discussion un tour au texte fixe
// quand il voit un blocage d'une mission en auto ; jamais pendant un tour, au plus une fois par 10 minutes,
// jamais deux fois pour le même ensemble de blocages ; hors surveillance, jamais. Le relevé porte la section « Nuit ».

const T0 = 600_000_000

const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const button = await pane.find({ key })
  if (button) await pane.press({ key })
  await pane.unmount()
  return button
}
const light = async ($: any, clock: any) => {
  expect(await press($, 'coo-night-ask')).toBeDefined()
  expect(await press($, 'coo-night-confirm')).toBeDefined()
  await settle(clock, 1)
}

/** Une mission en auto ouverte dans une autre discussion, avec les questions du mod données. */
const inAuto = (id: string, title: string, waiting: unknown[], extra: Partial<Run> = {}): Run =>
  ({
    ...newRun('implement', T0 - 60_000, title),
    id,
    status: 'active',
    owner: 'session-B',
    auto: { onAt: T0 - 30_000, onBy: 'session-B' },
    tickets: [
      { id: '1', name: 'Un', status: 'done' },
      { id: '2', name: 'Deux', status: 'todo' },
    ],
    groups: [
      { id: 'A', name: 'A', tickets: ['1'] },
      { id: 'B', name: 'B', tickets: ['2'] },
    ],
    waiting,
    ...extra,
  }) as unknown as Run
const staleQ = { id: 'sans-suite:B#1', blocks: { kind: 'group', id: 'B' }, text: 'Envoi resté sans suite', at: T0 - 10_000 }
const relaunchQ = { id: 'relance:B', blocks: { kind: 'group', id: 'B' }, text: 'Revenu deux fois', at: T0 - 5_000 }

const wakes = (w: World) => w.prompts.filter(p => p === NIGHT_WAKE_TEXT).length

const openSeat = async ($: any, on: any, runs: Run[]) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs }))
  await start($)
  await openCoo($, clock)
  return { clock, w }
}

/** Le relevé que reçoit le Claude du COO avec un message d'une autre session (qui n'arrête pas la surveillance). */
const statement = async ($: any): Promise<string> => {
  const out = (await $.prompt.submit({ text: 'Message', origin: { kind: 'peer' } } as any)) as any
  await $.turn.start({ turnId: 'peer', text: 'Message' } as any)
  await $.turn.complete({ answer: 'Vu.', durationMs: 10, isAborted: false, turnId: 'peer', reason: 'answer' } as any)
  return ((out?.context ?? []) as string[]).join('\n')
}

test('hors surveillance, aucun réveil, même avec des missions bloquées ; et le relevé n’a pas de section « Nuit »', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on, [inAuto('run-1', 'Bloquée', [staleQ])])
  await settle(clock, 30)
  expect(wakes(w)).toBe(0)
  const text = await statement($)
  expect(text).toMatch(/COO statement, computed by flow-board/)
  expect(text).not.toMatch(/Night watch/)
  // Témoin : les mêmes blocages, la surveillance allumée, réveillent la discussion.
  await light($, clock)
  await settle(clock, 10)
  expect(wakes(w)).toBe(1)
})

test('un réveil que le moteur n’a pas fait entrer ne compte pas comme signalé : la relecture suivante le refait', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on, [inAuto('run-1', 'Bloquée', [staleQ])])
  w.submit.drop = true
  await light($, clock)
  await settle(clock, 10)
  expect(wakes(w)).toBe(0)
  w.submit.drop = false
  await settle(clock, 10)
  expect(wakes(w)).toBe(1)
})

test('pendant la surveillance, un blocage réveille la discussion du COO une fois ; le même ensemble ne la réveille plus', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on, [inAuto('run-1', 'Bloquée', [staleQ])])
  await light($, clock)
  await settle(clock, 10)
  expect(wakes(w)).toBe(1)
  // Le relevé porte la section « Nuit », le blocage et son geste ; le groupe B, que la vague propose, n'y est pas encore.
  const first = await statement($)
  expect(first).toMatch(/Night watch \(« Nuit »\): on until \d\d:\d\d UTC/)
  expect(first).toMatch(/- mission « Bloquée » \(mission id « run-1 »\): group « B », question « sans-suite:B#1 »[^\n]*night gesture: resend/)
  expect(first).not.toMatch(/night gesture: wave/)
  // Proposé depuis 10 minutes sans partir : un blocage de plus, un second réveil.
  await settle(clock, 10 * 60)
  expect(wakes(w)).toBe(2)
  expect(await statement($)).toMatch(/- mission « Bloquée » \(mission id « run-1 »\): group « B » of the current wave does not leave; night gesture: wave/)
  // Le même ensemble, longtemps après : plus de réveil.
  await settle(clock, 15 * 60)
  expect(wakes(w)).toBe(2)
})

test('un ensemble de blocages changé ne réveille qu’à 10 minutes du réveil précédent', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on, [inAuto('run-1', 'Bloquée', [staleQ])])
  await light($, clock)
  await settle(clock, 10)
  expect(wakes(w)).toBe(1)
  writeBoard(w, b => ({ ...b, runs: [inAuto('run-1', 'Bloquée', [staleQ, relaunchQ])] }))
  await settle(clock, 30)
  expect(wakes(w)).toBe(1)
  await clock.advance(NIGHT_WAKE_MS - 40_000)
  await settle(clock, 10)
  expect(wakes(w)).toBe(2)
  expect(await statement($)).toMatch(/group « B » came back from its worker with open tickets \(question « relance:B »\); night gesture: relaunch/)
})

test('pendant un tour, le réveil attend sa fin', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on, [inAuto('run-1', 'Bloquée', [staleQ])])
  // Le tour s'ouvre avant la relecture de 5 s qui suit l'allumage.
  expect(await press($, 'coo-night-ask')).toBeDefined()
  expect(await press($, 'coo-night-confirm')).toBeDefined()
  await $.turn.start({ turnId: 'long', text: 'Un tour' } as any)
  await settle(clock, 20)
  expect(wakes(w)).toBe(0)
  await $.turn.complete({ answer: 'Fini.', durationMs: 10, isAborted: false, turnId: 'long', reason: 'answer' } as any)
  await settle(clock, 10)
  expect(wakes(w)).toBe(1)
})

test('une mission en auto arrêtée avec des groupes ouverts, ouverte nulle part, est à rouvrir ; coupée par le COO, elle ne l’est pas', { timeoutMs: 40000 }, async ($, on) => {
  const ended = inAuto('run-1', 'Fermée', [], { status: 'paused', owner: undefined, auto: { onAt: T0 - 30_000, offAt: T0 - 1000, offWhy: AUTO_STOPS.ended } } as Partial<Run>)
  const cut = inAuto('run-2', 'Coupée', [], { status: 'paused', owner: undefined, auto: { onAt: T0 - 30_000, offAt: T0 - 1000, offWhy: AUTO_STOPS.coo } } as Partial<Run>)
  const { clock, w } = await openSeat($, on, [ended, cut])
  await light($, clock)
  await settle(clock, 10)
  // Dessinée dans l'app, la discussion ne peut pas rouvrir la nuit : ce blocage seul ne la réveille pas.
  expect(wakes(w)).toBe(0)
  const text = await statement($)
  expect(text).toMatch(/- mission « Fermée » \(mission id « run-1 »\): auto paused by the dashboard with open groups, the mission open in no discussion; night gesture: reopen/)
  expect(text).not.toMatch(/mission « Coupée » \(mission id « run-2 »\): /)
})
