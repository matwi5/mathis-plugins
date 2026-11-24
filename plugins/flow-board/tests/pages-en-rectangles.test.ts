import { expect, test } from 'claude-code/testing'

import { C } from '../hooks/catalog.ts'
import { cooStatement } from '../hooks/coo.ts'
import { coordinationRows, type CooRow } from '../hooks/coo-view.tsx'
import { emptyBoard } from '../hooks/model.ts'
import { PAGES_SHOWN, loadedPages } from './pages-chargees.ts'
import { keysOf } from './vue-chargee.ts'

// Les pages « Idées », « À reprendre », « Pistes » et « Réglages » en rectangles : aucune clé de ligne ni de bouton
// perdue, chacune lue sur le code d'avant (liste figée), dans le même ordre.

const KEYS: Record<keyof typeof PAGES_SHOWN, readonly string[]> = {
  ideas: ['coo-roadmap', 'coo-milestone-J1', 'coo-step-E1', 'coo-step-E2', 'coo-ideas', 'coo-idea-I1', 'coo-idea-launch-I1', 'coo-later-I1', 'coo-drop-I1', 'coo-complement-R5', 'coo-complement-open-R5', 'coo-idea-I2', 'coo-drop-I2'],
  pending: [
    'coo-pendings',
    'coo-pending-R1',
    'coo-pending-open-R1',
    'coo-pending-R1-text',
    'coo-pending-R1-from',
    'coo-pending-launch-R1',
    'coo-pending-attach-R1',
    'coo-pending-later-R1',
    'coo-pending-drop-R1',
    'coo-complement-R4',
    'coo-complement-open-R4',
    'coo-pending-R2',
    'coo-pending-open-R2',
    'coo-later',
    'coo-later-toggle',
    'coo-later-open',
    'coo-pending-R3',
    'coo-pending-open-R3',
  ],
  pistes: [
    'coo-retro-retro1',
    'coo-retro-all-retro1',
    'coo-retro-pick-retro1',
    'coo-retro-retro1-1',
    'coo-retro-tick-retro1-1',
    'coo-retro-retro1-2',
    'coo-retro-tick-retro1-2',
    'coo-retro-retro1-3-taken',
    'coo-pistes',
    'coo-pistes-all',
    'coo-pistes-all-go',
    'coo-pistes-file-r/p1',
    'coo-piste-r/p1',
    'coo-piste-tick-r/p1',
    'coo-piste-r/p2',
    'coo-piste-tick-r/p2',
    'coo-pistes-file-r/p3',
    'coo-piste-r/p3',
    'coo-piste-tick-r/p3',
    'coo-pistes-more',
    'coo-pistes-hidden',
    'coo-pistes-closed',
    'coo-pistes-cut',
    'coo-pistes-cut-go',
  ],
  settings: ['coo-place', 'coo-place-line', 'coo-place-change', 'coo-place-left', 'coo-security', 'coo-security-line', 'coo-security-toggle'],
}

test('chaque page garde les clés de ses lignes et de ses boutons, dans le même ordre', () => {
  const pages = Object.keys(KEYS) as (keyof typeof KEYS)[]
  expect(Object.fromEntries(pages.map(p => [p, keysOf(coordinationRows(loadedPages(), PAGES_SHOWN[p], 'off'))]))).toEqual(KEYS)
})

const framesOf = (rows: readonly CooRow[]): string[] => rows.filter(r => r.kind !== 'pills').map(r => `${r.key}:${r.frame?.id ?? '-'}${r.inner ? `>${r.inner.id}` : ''}`)
const colorOf = (rows: readonly CooRow[], id: string): string | undefined => rows.find(r => r.frame?.id === id)?.frame?.color

test('Idées : un rectangle vert d’eau « Feuille de route » pour le jalon et les étapes, puis un rectangle violet par idée avec ses boutons et ses compléments', () => {
  const rows = coordinationRows(loadedPages(), PAGES_SHOWN.ideas, 'off')
  expect(framesOf(rows)).toEqual([
    'coo-roadmap:roadmap',
    'coo-milestone-J1:roadmap',
    'coo-step-E1:roadmap',
    'coo-step-E2:roadmap',
    'coo-ideas:-',
    'coo-idea-I1:idea-I1',
    'coo-complement-R5:idea-I1',
    'coo-idea-I2:idea-I2',
  ])
  expect([colorOf(rows, 'roadmap'), colorOf(rows, 'idea-I1'), colorOf(rows, 'idea-I2')]).toEqual([C.teal, C.violet, C.violet])
})

test('À reprendre : la liste dans un rectangle ambre, l’entrée dépliée dans un rectangle intérieur ; « Plus tard » dans un rectangle gris ; une seule entrée dépliée', () => {
  const rows = coordinationRows(loadedPages(), PAGES_SHOWN.pending, 'off')
  expect(framesOf(rows)).toEqual([
    'coo-pendings:pendings',
    'coo-pending-R1:pendings>pending-R1',
    'coo-pending-R1-text:pendings>pending-R1',
    'coo-pending-R1-from:pendings>pending-R1',
    'coo-complement-R4:pendings',
    'coo-pending-R2:pendings',
    'coo-later:later',
    'coo-later-toggle:later',
    'coo-pending-R3:later',
  ])
  expect([colorOf(rows, 'pendings'), rows.find(r => r.key === 'coo-pending-R1')?.inner?.color, colorOf(rows, 'later')]).toEqual([C.amber, C.amber, C.gray])
  // R3 déplié (dans « Plus tard ») : R1 se replie, R3 a son rectangle intérieur gris.
  const other = coordinationRows(loadedPages(), { ...PAGES_SHOWN.pending, open: 'R3 plus tard' }, 'off')
  expect(other.filter(r => r.inner).map(r => `${r.key}>${r.inner?.id}:${r.inner?.color}`)).toEqual([
    `coo-pending-R3>pending-R3:${C.gray}`,
    `coo-pending-R3-text>pending-R3:${C.gray}`,
    `coo-pending-R3-from>pending-R3:${C.gray}`,
  ])
})

test('Pistes : un rectangle ambre par rétro à cocher, un vert d’eau par fichier avec ses pistes ; les comptes et le découpage sous eux, sans rectangle', () => {
  const rows = coordinationRows(loadedPages(), PAGES_SHOWN.pistes, 'off')
  expect(framesOf(rows)).toEqual([
    'coo-retro-retro1:retro-retro1',
    'coo-retro-retro1-1:retro-retro1',
    'coo-retro-retro1-2:retro-retro1',
    'coo-retro-retro1-3-taken:retro-retro1',
    'coo-pistes:-',
    'coo-pistes-all:-',
    'coo-pistes-file-r/p1:pistes-file-r/p1',
    'coo-piste-r/p1:pistes-file-r/p1',
    'coo-piste-r/p2:pistes-file-r/p1',
    'coo-pistes-file-r/p3:pistes-file-r/p3',
    'coo-piste-r/p3:pistes-file-r/p3',
    'coo-pistes-more:-',
    'coo-pistes-hidden:-',
    'coo-pistes-closed:-',
    'coo-pistes-cut:-',
  ])
  expect([colorOf(rows, 'retro-retro1'), colorOf(rows, 'pistes-file-r/p1')]).toEqual([C.amber, C.teal])
  const sent = coordinationRows({ ...loadedPages(), retroPicks: [{ ...loadedPages().retroPicks![0]!, isSent: true }] }, PAGES_SHOWN.pistes, 'off')
  expect(colorOf(sent, 'retro-retro1')).toBe(C.teal)
})

test('Réglages : un rectangle gris par réglage, ambre pour une revue de sécurité dont l’état ne se lit pas', () => {
  const rows = coordinationRows(loadedPages(), PAGES_SHOWN.settings, 'off')
  expect(framesOf(rows)).toEqual(['coo-place:place', 'coo-place-line:place', 'coo-place-left:place', 'coo-security:security', 'coo-security-line:security'])
  expect([colorOf(rows, 'place'), colorOf(rows, 'security')]).toEqual([C.gray, C.gray])
  expect(colorOf(coordinationRows(loadedPages(), PAGES_SHOWN.settings, 'unread'), 'security')).toBe(C.amber)
})

test('une feuille de route illisible : le renvoi reste une ligne sans rectangle ; une page vide dit « Rien pour l’instant. »', () => {
  const unread = { ...loadedPages(), roadmap: { ...loadedPages().roadmap!, read: 'unread' as const } }
  for (const page of ['ideas', 'pending'] as const) {
    const rows = coordinationRows(unread, PAGES_SHOWN[page], 'off')
    expect(rows.filter(r => r.kind !== 'pills').map(r => [r.key, r.frame])).toEqual([[`coo-page-${page}-unread`, undefined]])
  }
  const empty = coordinationRows(cooStatement(emptyBoard('', 'p'), { now: 1 }), { page: 'pistes' }, 'off').filter(r => r.kind !== 'pills')
  expect(empty.map(r => r.parts.map(p => p.text).join(''))).toEqual(['Rien pour l’instant.'])
})
