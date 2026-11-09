// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { missionSessionId, missionSessionsArchiveText } from '../hooks/closing.ts'
import { closeDelivered, emptyBoard, newRun } from '../hooks/model.ts'
import type { Board, Run } from '../types'
import { PANE, PLUGIN, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// Archiver une mission livrée demande au Claude du COO d'archiver aussi sa discussion dans l'app : l'accord se demande
// toujours, en une ligne (celui de /flow archive on ne vaut que pour les sessions des workers), une seule demande pour
// « ✓ Tout archiver (n) ».

const T0 = 900_000_000
const UUID = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const LOCAL = 'local_4f2a9c'

/** Une mission au rapport validé, sa phase « Version et push » à faire, en pause : prête à livrer. */
const validated = (now: number, title: string): Run => {
  const run = newRun('implement', now - 90_000, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: now - 50_000, finishedAt: now - 40_000, steps: [], items: [] }
  const version = newRun('project:version', run.startedAt, 'v').phases[0]!
  const pending = { ...version, status: 'pending' as const, startedAt: undefined, steps: version.steps.map(s => ({ id: s.id, status: 'pending' as const })) }
  return { ...run, phases: [done, report, pending], cursor: 1, status: 'paused', reportValidatedAt: now - 40_000, updatedAt: now - 1_000 } as Run
}

/** La même, close comme livrée par le COO, née dans la discussion `bornIn`. */
const delivered = (now: number, title: string, bornIn?: string): Run => {
  const run = { ...validated(now, title), ...(bornIn !== undefined ? { bornIn } : {}) }
  const board: Board = { ...emptyBoard('', 'projet'), runs: [run] }
  return closeDelivered(board, run.id, now - 500, { version: '0.80.0', push: 'main' })!.board.runs[0]!
}

test('les quatre formes de l’id : absent et hors forme se cherchent par le titre, sans id ; valide, il est passé, introuvable se dit', () => {
  const absent = missionSessionsArchiveText([{ title: '« A »' }])
  expect(absent).toContain('la discussion de la mission « A » (pas d’id sûr : cherche-la par ce titre)')
  const bad = missionSessionsArchiveText([{ title: '« A »', id: 'abc"; rm -rf' }])
  expect(bad).not.toContain('rm -rf')
  expect(bad).toContain('pas d’id sûr : cherche-la par ce titre')
  // Valide, connue ou pas de l'app : l'id est passé, et le texte dit quoi faire d'une session introuvable ou déjà archivée.
  const valid = missionSessionsArchiveText([{ title: '« A »', id: UUID }])
  expect(valid).toContain(`la discussion de la mission « A » (id de session ${UUID})`)
  expect(valid).toContain('introuvable ou déjà archivée : dis-le, sans autre geste')
  // L'accord se demande toujours, en une ligne qui nomme la discussion ; au terminal, rien.
  expect(valid).toContain('demande-le-moi en une ligne, en nommant la discussion')
  expect(valid).not.toContain('ne me le redemande pas')
  expect(valid).toContain('S’il n’y a pas d’outil archive_session ici (au terminal), ne fais rien')
  expect(valid).toContain('(« flow-board : mission livrée, archivée »)')
  expect(valid.startsWith('/')).toBe(false)
  expect(valid).toContain('Sa discussion dans l’app')
  // Par le titre exact seulement, jamais celle où tourne le COO.
  expect(valid).toContain('aucune ou plusieurs sessions à ce titre exact, introuvable ou déjà archivée : dis-le, sans autre geste')
  expect(valid).toContain('Jamais la discussion où tu tournes')
  expect(missionSessionsArchiveText([{ title: '« A »', day: '2026-11-08' }])).toContain('la discussion de la mission « A », livrée le 2026-11-08 (pas d’id sûr')
})

test('deux missions nées dans la même discussion : elle n’est nommée qu’une fois, avec les deux titres', () => {
  const text = missionSessionsArchiveText([{ title: '« A »', id: UUID }, { title: '« B »', id: UUID }])
  expect(text).toContain(`la discussion de la mission « A » ou « B » (id de session ${UUID})`)
  expect(text.split(UUID).length).toBe(2)
  expect(text).toContain('ces missions livrées sont archivées')
  expect(text).toContain('cette discussion : demande-le-moi en une ligne')
})

test('la demande refusée à l’envoi : elle ne se refait pas, et le toast le dit sans « reclique »', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  writeBoard(w, x => ({ ...x, runs: [a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  w.submit.drop = true
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await view.press({ key: `coo-archive-${a.id}` })
  await view.unmount()
  await settle(clock, 2)
  w.submit.drop = false
  expect(stored(w).runs.find(r => r.id === a.id)!.archivedAt).toBeDefined()
  const toast = w.toasts.find(t => t.includes('La demande d’archiver sa discussion dans l’app n’est pas partie')) ?? ''
  expect(toast).toContain('archive-la à la main si tu veux')
  expect(toast).not.toContain('reclique')
})

test('l’écriture de « ✓ Tout archiver (2) » différée : le toast dit d’archiver à la main les seules discussions que la demande aurait nommées', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  // Née dans une discussion encore au travail sur une autre mission : jamais nommée, même au toast.
  const b = delivered(T0, 'Mission B', LOCAL)
  const busy = { ...newRun('implement', T0, 'Autre'), owner: LOCAL }
  writeBoard(w, x => ({ ...x, runs: [a, b, busy] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  w.probe.refuseBoard = text => text.includes('Mission archivée')
  const before = w.prompts.length
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await view.press({ key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  w.probe.refuseBoard = undefined
  const toast = w.toasts.find(t => t.includes('L’archivage n’est peut-être pas encore écrit')) ?? ''
  expect(toast).toContain('Sa discussion dans l’app ne t’est pas proposée à l’archivage : archive-la à la main si tu veux.')
  expect(w.prompts.slice(before).some(t => t.includes('peut s’archiver aussi'))).toBe(false)
})

test('plusieurs discussions : une seule demande, qui les nomme toutes et demande l’accord en une ligne', () => {
  const text = missionSessionsArchiveText([{ title: '« A »', id: UUID }, { title: '« B »', id: LOCAL }])
  expect(text).toContain(`« A » (id de session ${UUID}) ; la discussion de la mission « B » (id de session ${LOCAL})`)
  expect(text).toContain('demande mon accord pour ces discussions : demande-le-moi en une ligne, en nommant chacune')
  expect(text).toContain('Leur discussion dans l’app')
})

test('l’id passé : bornIn, puis owner, le premier en forme ; jamais celui d’ici ni celui d’une autre mission non archivée', () => {
  const run = delivered(T0, 'M')
  expect(missionSessionId(run, [run], LOCAL)).toBeUndefined()
  expect(missionSessionId({ ...run, bornIn: 'pas-un-id', owner: UUID }, [run], LOCAL)).toBe(UUID)
  expect(missionSessionId({ ...run, bornIn: UUID, owner: 'local_autre' }, [run], LOCAL)).toBe(UUID)
  // La discussion d'ici (le COO) : jamais nommée, même par son titre.
  expect(missionSessionId({ ...run, bornIn: LOCAL }, [run], LOCAL)).toBeNull()
  // Partagée avec une mission encore au travail : jamais nommée ; avec une mission archivée, si.
  const other = { ...newRun('implement', T0, 'Autre'), owner: UUID }
  expect(missionSessionId({ ...run, bornIn: UUID }, [run, other], LOCAL)).toBeNull()
  expect(missionSessionId({ ...run, bornIn: UUID }, [run, { ...other, archivedAt: T0 }], LOCAL)).toBe(UUID)
})

test('« ✓ Tout archiver (2) » : une seule demande au Claude du COO, qui nomme les deux discussions', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  const b = delivered(T0, 'Mission B')
  writeBoard(w, x => ({ ...x, runs: [a, b] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const before = w.prompts.length
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await view.press({ key: 'coo-archive-all' })
  await view.unmount()
  await settle(clock, 2)
  expect(stored(w).runs.every(r => r.archivedAt !== undefined)).toBe(true)
  const asks = w.prompts.slice(before).filter(t => t.includes('peut s’archiver aussi'))
  expect(asks.length).toBe(1)
  // Le jour de la livraison, écrit comme dans la discussion de la mission (« Livrée par le COO le … »).
  expect(asks[0]).toMatch(new RegExp(`la discussion de la mission « Mission A », livrée le \\d{2}/\\d{2}/\\d{4} \\(id de session ${UUID}\\)`))
  expect(asks[0]).toMatch(/la discussion de la mission « Mission B », livrée le \d{2}\/\d{2}\/\d{4} \(pas d’id sûr : cherche-la par ce titre\)/)
})

test('rien d’archivé (liste changée) : aucune demande d’archiver une discussion', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  const a = delivered(T0, 'Mission A', UUID)
  writeBoard(w, x => ({ ...x, runs: [a] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  w.probe.onBoardRead = () => {
    w.probe.onBoardRead = undefined
    writeBoard(w, x => ({ ...x, runs: [...x.runs, delivered(T0, 'Mission C')] }))
  }
  const before = w.prompts.length
  const view = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await view.press({ key: `coo-archive-${a.id}` })
  await view.unmount()
  await settle(clock, 2)
  expect(w.toasts.some(t => t.includes("La liste a changé depuis : rien n'est archivé"))).toBe(true)
  expect(stored(w).runs.find(r => r.id === a.id)!.archivedAt).toBeUndefined()
  expect(w.prompts.slice(before).some(t => t.includes('peut s’archiver aussi'))).toBe(false)
})
