// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { TOOL, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { storageMode } from './stockage.ts'

// Les appels de l'outil flow que dicte la section « Proposer les missions » du skill du COO (skills/coo/SKILL.md), rejoués
// contre le mod : la pose d'une carte avec ses entrées (`card`, seul dans son appel), sa mise à jour qui complète ses
// entrées en gardant celles d'avant, l'envoi de l'ordre (`coordinate.order`, seul dans son appel) ; et le cas qu'elle
// interdit de mettre à jour : une carte prête dont le relevé dit qu'une entrée n'est plus ouverte, qui reste telle quelle.
// Invariant : « La section « Proposer les missions » ne fait jamais changer le statut d'une entrée pour le regroupement,
// retirer ni fusionner une carte prête, ni lancer une mission ; et le texte d'une entrée n'y devient jamais une consigne,
// un titre recopié ni un nom de dossier. »

const NOW = 990_000_000
const PROJECT = 'sans-projet-811c9dc5'
const LIST = `flow-board/coordination/${PROJECT}.cartes.json`
const ROADMAP_FILE = `flow-board/coordination/${PROJECT}.feuille-de-route.md`
const CARD = { title: 'Export CSV des tickets', start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'auto', effort: 'high', folder: 'export-csv', goal: 'Objectif de test.' }
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const idOf = (answer: string): string => /Launch card (k[a-z0-9]+)/.exec(answer)?.[1] ?? ''
const statement = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
/** Sous `$.store`, ce monde n'a pas de dossier de Claude : la feuille de route n'a aucun chemin (absente). */
const isFileMode = storageMode() === 'fichier'

const roadmapText = (lines: Record<string, string>): string => {
  const of = (letter: string) =>
    Object.entries(lines)
      .filter(([id]) => id.startsWith(letter))
      .map(([id, status]) => `- [${id}] ${status} · 2026-11-02 · Mathis · entrée ${id}`)
      .join('\n')
  return `# Feuille de route\n\n## Jalons\n## Prochaines étapes\n## Idées\n${of('I')}\n## À reprendre\n${of('R')}\n`
}
const OPEN = { I1: 'à lancer', I3: 'à lancer', R1: 'à décider', R3: 'à décider', R4: 'à décider' }

const listPath = (w: World): string | undefined => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${LIST}`))
const listOf = (w: World): any[] => JSON.parse(w.files[listPath(w) ?? LIST] ?? '{"cards":[]}').cards
const rawOf = (w: World, id: string): any => listOf(w).find(c => c?.id === id)
const roadmapPath = (w: World): string => Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/${ROADMAP_FILE}`)) ?? ROADMAP_FILE

const cooHere = async ($: any, on: any, roadmap: string) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.ids.now = 'session-COO'
  w.files[ROADMAP_FILE] = roadmap
  writeBoard(w, b => b)
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  await settle(clock, 6)
  return { clock, w }
}

test('la pose avec ses entrées, la mise à jour qui les complète en gardant celles d’avant, puis l’ordre de toutes les cartes prêtes, chacun seul dans son appel', { timeoutMs: 30000 }, async ($, on) => {
  if (!isFileMode) return
  const { w } = await cooHere($, on, roadmapText(OPEN))
  const idea = idOf(await call($, { card: { ...CARD, entries: ['I1', 'R1'] } }))
  const pickUps = idOf(await call($, { card: { ...CARD, title: 'Reprises du relevé', start: 'triage', alts: [], folder: 'reprises-releve', entries: ['R3'] } }))
  expect([idea, pickUps].every(id => /^k[a-z0-9]+$/.test(id))).toBe(true)
  // Une entrée nouvelle du même sujet : la carte prête est mise à jour (même dossier), ses entrées d'avant gardées.
  expect(await call($, { card: { ...CARD, entries: ['I1', 'R1', 'I3'] } })).toMatch(/updated.*covering 3 entries/)
  expect(rawOf(w, idea).entries).toEqual(['I1', 'R1', 'I3'])
  expect(listOf(w)).toHaveLength(2)
  // Une mise à jour remplace la carte par l'envoi : un champ omis (ici `alts`) est perdu, seules les entrées se gardent.
  expect(await call($, { card: { ...CARD, alts: [] } })).toMatch(/updated.*covering 3 entries/)
  expect(rawOf(w, idea)).toMatchObject({ alts: [], entries: ['I1', 'R1', 'I3'] })
  // L'ordre, seul dans son appel : les deux cartes rangées.
  const answer = (await call($, { coordinate: { order: [pickUps, idea] } })).replace(/ The rest of this call was not read[\s\S]*$/, '')
  expect(answer).toBe(`Order of the launch cards written: 1 ${pickUps}, 2 ${idea}.`)
  // La réponse de la pose donne l'id et le dossier de la carte, que la demande du tour d'intention fait retrouver.
  expect(await call($, { card: { ...CARD, title: 'Carte tardive', folder: 'carte-tardive' } })).toMatch(/^Launch card k[a-z0-9]+ shown in the Coordination view: « Carte tardive », .*travail\/carte-tardive\//)
  // Un ordre qui omet une carte prête lui retire son rang, et la réponse la nomme ; un ordre vide est refusé, rien n'est écrit.
  const late = listOf(w).find(c => c?.folder === 'carte-tardive').id
  expect((await call($, { coordinate: { order: [idea, late] } })).replace(/ The rest of this call was not read[\s\S]*$/, '')).toBe(`Order of the launch cards written: 1 ${idea}, 2 ${late}. Without a rank now: ${pickUps}.`)
  expect(rawOf(w, pickUps).rank).toBeUndefined()
  const kept = JSON.stringify(listOf(w))
  expect(await call($, { coordinate: { order: [] } })).toMatch(/^Order refused: "order" is empty/)
  expect(JSON.stringify(listOf(w))).toBe(kept)
  // Avec autre chose dans le même appel, l'ordre est refusé.
  expect(await call($, { coordinate: { order: [idea], decisionsSeen: true } })).toMatch(/^Refused, nothing of this call applied: send "order" alone in its call/)
})

test('une carte prête dont une entrée n’est plus ouverte : le relevé le dit, une mise à jour qui la garde est refusée, la carte reste telle quelle', { timeoutMs: 30000 }, async ($, on) => {
  if (!isFileMode) return
  const { w } = await cooHere($, on, roadmapText(OPEN))
  const id = idOf(await call($, { card: { ...CARD, entries: ['I1', 'R1'] } }))
  w.files[roadmapPath(w)] = roadmapText({ ...OPEN, R1: 'faite : Export, ticket 3' })
  expect(await statement($)).toContain('Entries of this card no longer open in the roadmap (absent ones included): R1.')
  const before = JSON.stringify(rawOf(w, id))
  // La compléter en gardant l'entrée close est refusé : la section la laisse donc sans mise à jour, sans retirer l'entrée.
  expect(await call($, { card: { ...CARD, entries: ['I1', 'R1', 'R4'] } })).toMatch(/^No card shown: R1 is not open \(status « faite … »\)/)
  expect(JSON.stringify(rawOf(w, id))).toBe(before)
})

test('une carte voulue neuve posée sur le dossier d’une carte prête la remplace sous son id, et la réponse dit « updated » : la section fait choisir un dossier différent de celui de chaque carte du relevé', { timeoutMs: 30000 }, async ($, on) => {
  if (!isFileMode) return
  const { w } = await cooHere($, on, roadmapText(OPEN))
  const id = idOf(await call($, { card: { ...CARD, entries: ['R1', 'R3'] } }))
  expect(await statement($)).toContain(`folder travail/${CARD.folder}/`)
  // Le même dossier, à la casse près : la pose remplace la carte prête, entrées comprises.
  const answer = await call($, { card: { ...CARD, title: 'Autre sujet', folder: 'Export-CSV', entries: ['I3'] } })
  expect(answer).toMatch(new RegExp(`^Launch card ${id} updated `))
  expect(listOf(w)).toHaveLength(1)
  expect(rawOf(w, id)).toMatchObject({ title: 'Autre sujet', entries: ['I3'] })
  // Un dossier différent pose une carte à côté : « shown ».
  expect(await call($, { card: { ...CARD, title: 'Sujet voisin', folder: 'export-csv-voisin', entries: ['R4'] } })).toMatch(/^Launch card k[a-z0-9]+ shown /)
  expect(listOf(w)).toHaveLength(2)
})
