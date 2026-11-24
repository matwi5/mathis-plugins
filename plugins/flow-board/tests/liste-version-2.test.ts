// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { parseCard, type LaunchCard } from '../hooks/launch.ts'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { allTexts } from './page-coo.ts'
import { storageMode } from './stockage.ts'

// La liste des cartes en version 2 (l'ancien mod ne la lit pas, donc ne la réécrit jamais) : le mod lit les versions 1 et 2 et
// écrit la 2 ; une liste de version 1 que rien n'écrit reste telle quelle. Invariant : « La liste des cartes d'un projet
// n'est écrite que par la discussion qui tient le siège du COO. Une écriture n'y fait jamais disparaître ni revenir une
// carte qu'elle ne visait pas, et une liste qui ne se lit pas n'est jamais réécrite. »

const NOW = 990_000_000
const MIN = 60_000
const PROJECT = 'sans-projet-811c9dc5'
const LIST = `flow-board/coordination/${PROJECT}.cartes.json`
const KEY = 'coo-cards:'
const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'manual', effort: 'high', folder: 'export-csv', goal: 'Objectif de test.' }
const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const statement = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))

const listPath = (w: World): string | undefined => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${LIST}`))
/** Le texte de la liste tel que gardé : au fichier (son chemin entier une fois écrit, sinon celui posé) ou dans le stockage du mod. */
const listText = (w: World): string | undefined => {
  if (storageMode() === 'fichier') return w.files[listPath(w) ?? LIST]
  const kept = w.mem[KEY]
  return kept === undefined ? undefined : typeof kept === 'string' ? kept : JSON.stringify(kept)
}
/** Pose la liste telle quelle (un texte) au fichier, à son chemin entier s'il est déjà écrit, et dans le stockage. */
const putText = (w: World, text: string) => {
  w.files[LIST] = text
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/${LIST}`)) w.files[k] = text
  w.mem[KEY] = JSON.parse(text)
}
const listAt = (v: unknown, cards: unknown[]) => JSON.stringify({ v, root: '', cards })

const card = (id: string, over: Partial<LaunchCard> = {}): LaunchCard => {
  const parsed = parseCard({ ...CARD, title: `Carte ${id}`, folder: `dossier-${id}` }, NOW - 30 * MIN, id)
  if ('refused' in parsed) throw new Error(parsed.refused)
  return { ...parsed.card, ...over }
}
const A = card('kcartea01')
const B = card('kcarteb01')
/** Une entrée hors forme gardée dans la liste : elle reste telle quelle, à sa place. */
const ODD = { id: 'kbad0001', title: 5, note: 'hors forme' }

/** Le COO ouvert ici, le siège pris par cette discussion ; la liste posée avant le démarrage du mod. */
const cooHere = async ($: any, on: any, text: string) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  putText(w, text)
  writeBoard(w, b => ({ ...b, runs: [] }))
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  return { clock, w }
}

/** Ce que la vue et le relevé montrent des cartes. */
const seen = async ($: any) => {
  const ui = await pane($)
  const shown = await allTexts(ui)
  await ui.unmount()
  const said = await statement($)
  return { shown, said }
}

for (const v of [1, 2])
  test(`une liste de version ${v} se lit : ses cartes sont montrées et relevées, sans alerte`, { timeoutMs: 30000 }, async ($, on) => {
    await cooHere($, on, listAt(v, [A, ODD, B]))
    const { shown, said } = await seen($)
    expect(shown).not.toContain('Liste des cartes illisible')
    expect(shown).toContain('Carte kcartea01')
    expect(shown).toContain('Carte kcarteb01')
    expect(said).not.toContain('UNREADABLE')
    expect(said).toContain('kcartea01')
    expect(said).toContain('kcarteb01')
  })

test('une écriture sur une liste de version 1 l’écrit en version 2 : hors de la carte visée, chaque entrée d’avant telle quelle et dans le même ordre, hors forme comprise', { timeoutMs: 30000 }, async ($, on) => {
  const { w } = await cooHere($, on, listAt(1, [A, ODD, B]))
  expect(await call($, { card: CARD })).toMatch(/Launch card k[a-z0-9]+/)
  const written = JSON.parse(listText(w) ?? '{}')
  expect([written.v, written.root]).toEqual([2, ''])
  expect(written.cards.slice(0, 3)).toEqual(JSON.parse(JSON.stringify([A, ODD, B])))
  expect(written.cards).toHaveLength(4)
  expect(written.cards[3]).toMatchObject({ title: CARD.title, folder: CARD.folder })
})

test('une liste de version 1 que rien n’écrit reste identique octet pour octet après des lectures, des relevés et un rechargement du mod', { timeoutMs: 60000 }, async ($, on) => {
  const text = listAt(1, [A, ODD, B])
  const { clock, w } = await cooHere($, on, text)
  // L'effet d'abord : la liste est bien relue (ses cartes montrées et relevées), puis aucune réécriture.
  const read = async () => {
    const { shown, said } = await seen($)
    expect(shown).toContain('Carte kcartea01')
    expect(said).toContain('kcarteb01')
  }
  await read()
  await settle(clock, 6)
  await read()
  // Le mod rechargé : il reprend le siège, relit la liste au démarrage et au relevé du titulaire.
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  await read()
  expect(listText(w)).toBe(text)
})
