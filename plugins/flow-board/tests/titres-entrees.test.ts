// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { cooStatement, statementText, type CooRoadmap } from '../hooks/coo.ts'
import { emptyBoard } from '../hooks/model.ts'
import { parseRoadmap, roadmapTextPrint, type RoadmapEntry } from '../hooks/roadmap.ts'
import { partialTitles, planTitles, titleOf, untitledIds } from '../hooks/titles.ts'
import { PANE, PLUGIN, TOOL, openCoo, seatOf, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { storageMode } from './stockage.ts'

// Les titres des entrées « À reprendre ». Invariant : « Écrire, changer ou perdre un titre ne modifie jamais le texte
// d'une entrée, ne la fait jamais disparaître et ne la fait jamais passer pour changée ; un titre ne s'affiche que pour
// le texte pour lequel il a été écrit. »

// ─── Le module pur ────────────────────────────────────────────────────────

const ROADMAP_TEXT = `# Feuille de route

## Jalons
## Prochaines étapes
## Idées
- [I1] à lancer · 2026-11-02 · Alex · une idée
## À reprendre
- [R1] à décider · 2026-11-02 · mission « Titre », compte rendu · une chose à reprendre, assez longue pour être coupée à quatre-vingts caractères dans la vue
- [R2] plus tard · 2026-11-03 · mission « Titre », compte rendu · une autre chose
- [R3] écartée : doublon · 2026-11-03 · mission « Titre », compte rendu · une chose close
`
const entries = (): RoadmapEntry[] => {
  const r = parseRoadmap(ROADMAP_TEXT)
  if (!r.ok) throw new Error('feuille de route de test hors format')
  return r.entries
}
const entry = (id: string): RoadmapEntry => entries().find(e => e.id === id)!

test('formes à l’écriture : un id hors forme, une entrée absente ou d’une autre section, un titre vide, trop long, sur plusieurs lignes ou avec un caractère de contrôle sont refusés, jamais coupés', () => {
  const plan = planTitles(
    [
      { id: 'r1', title: 'x' },
      { id: 'R9', title: 'absente' },
      { id: 'I1', title: 'une idée' },
      { id: 'R1', title: '   ' },
      { id: 'R1', title: 'x'.repeat(81) },
      { id: 'R1', title: 'deux\nlignes' },
      { id: 'R1', title: `séparateur${String.fromCodePoint(0x2028)}` },
      { id: 'R1', title: 'tab\tici' },
      { id: 'R1', title: String.fromCodePoint(0x200b) },
      { id: 'R1', title: `mot${String.fromCodePoint(0xfeff)}caché` },
      { id: 'R1', title: `bidi${String.fromCodePoint(0x202e)}` },
      { id: 'R2', title: 'y'.repeat(80) },
    ],
    entries(),
  )
  expect(plan.refused.map(r => r.id)).toEqual(['r1', 'R9', 'I1', 'R1', 'R1', 'R1', 'R1', 'R1', 'R1', 'R1', 'R1'])
  // Un titre fait seulement d'invisibles se montrerait vide : refusé.
  expect(plan.refused[8]!.why).toBe('a line break, a control or an invisible character')
  expect(plan.kept).toEqual({ R2: { title: 'y'.repeat(80), print: roadmapTextPrint(entry('R2').text) } })
})

test('un deuxième titre pour le même id remplace le premier ; l’empreinte est prise sur le texte du moment, jamais lue de l’envoi', () => {
  const plan = planTitles([{ id: 'R1', title: 'premier' }, { id: 'R1', title: 'second', print: 'tforge' }], entries())
  expect(plan.kept.R1).toEqual({ title: 'second', print: roadmapTextPrint(entry('R1').text) })
})

test('à la lecture : un titre ne s’affiche que pour le texte pour lequel il a été écrit ; texte changé, il ne s’affiche plus et l’entrée revient « sans titre »', () => {
  const titles = { R1: { title: 'Un titre', print: roadmapTextPrint(entry('R1').text) } }
  expect(titleOf(titles, entry('R1'))).toBe('Un titre')
  const changed = { ...entry('R1'), text: 'un autre texte' }
  expect(titleOf(titles, changed)).toBeUndefined()
  expect(untitledIds([changed, entry('R2'), entry('R3')], titles)).toEqual(['R1', 'R2'])
  // Un changement de statut ne touche pas le titre.
  const later: RoadmapEntry = { ...entry('R1'), status: 'plus tard' }
  expect(titleOf(titles, later)).toBe('Un titre')
})

test('une entrée close garde son titre, sans compter « sans titre » ; une entrée absente de la lecture n’est pas comptée', () => {
  const titles = { R1: { title: 'Un titre', print: roadmapTextPrint(entry('R1').text) }, R3: { title: 'Close', print: roadmapTextPrint(entry('R3').text) } }
  expect(untitledIds([entry('R2')], titles)).toEqual(['R2'])
  expect(titleOf(titles, entry('R1'))).toBe('Un titre')
  expect(untitledIds(entries(), titles)).toEqual(['R2'])
})

test('à la lecture de l’état : un id ou un titre hors forme est écarté (l’état se met de côté), les titres en forme restent', () => {
  const print = roadmapTextPrint('x')
  const read = partialTitles({ R1: { title: 'bon', print }, r2: { title: 'id hors forme', print }, R3: { title: '', print }, R4: { title: 'sans empreinte' }, R5: 'pas un objet' })
  expect(read.titles).toEqual({ R1: { title: 'bon', print } })
  expect(read.isWhole).toBe(false)
  expect(partialTitles(undefined)).toEqual({ titles: {}, isWhole: true })
  expect(partialTitles([1])).toEqual({ titles: {}, isWhole: false })
})

// ─── Le relevé du COO ─────────────────────────────────────────────────────

const roadmapOf = (titles?: CooRoadmap['titles']): CooRoadmap => ({ where: 'poste', path: '/x/feuille-de-route.md', read: parseRoadmap(ROADMAP_TEXT), gone: [], ...(titles ? { titles } : {}) })
const statementOf = (r: CooRoadmap): string => statementText(cooStatement(emptyBoard('', 'p'), { now: 610_000_000, roadmap: r }))

test('le relevé nomme le compte et les ids des entrées ouvertes sans titre attaché à leur texte, sans jamais recopier un titre', () => {
  const said = statementOf(roadmapOf({ R1: { title: 'TITRE-SECRET-UN', print: roadmapTextPrint(entry('R1').text) }, R3: { title: 'TITRE-SECRET-TROIS', print: roadmapTextPrint(entry('R3').text) } }))
  expect(said).toContain('- Titles: 1 open « À reprendre » entry has no title attached to the current text: « R2 ».')
  // L'appel dicté se lit comme du JSON, tel qu'écrit.
  const dictated = /with (\{"coordinate": .*?\}\]\}\}), 50 per call/.exec(said)?.[1]
  expect(JSON.parse(dictated!)).toEqual({ coordinate: { titles: [{ id: '<entry id>', title: '<short title>' }] } })
  expect(said).not.toContain('TITRE-SECRET')
  // Le texte gardé reste celui du fichier, cité comme avant.
  expect(said).toContain('une chose à reprendre, assez longue')
})

test('le relevé : sans titre, toutes les entrées ouvertes sont nommées ; toutes titrées, la ligne disparaît ; une entrée close n’y entre jamais', () => {
  expect(statementOf(roadmapOf())).toContain('- Titles: 2 open « À reprendre » entries have no title attached to the current text: « R1 », « R2 ».')
  const all = { R1: { title: 'a', print: roadmapTextPrint(entry('R1').text) }, R2: { title: 'b', print: roadmapTextPrint(entry('R2').text) } }
  expect(statementOf(roadmapOf(all))).not.toContain('- Titles:')
  // Un titre dont l'empreinte n'est plus celle du texte : l'entrée revient dans la liste.
  expect(statementOf(roadmapOf({ ...all, R2: { title: 'b', print: roadmapTextPrint('un ancien texte') } }))).toContain('entry has no title attached to the current text: « R2 ».')
})

// ─── L'outil et l'état gardé, chez le titulaire du siège ──────────────────
// En mode fichier, la feuille de route et son état gardé vivent sur le poste ; en mode `$.store` (sans dossier de Claude),
// la feuille de route vit dans le projet et l'état sous la clé `coo-roadmap:`.

const NOW = 610_000_000
const PROJECT = 'sans-projet-811c9dc5'
const POSTE_FILE = `flow-board/coordination/${PROJECT}.feuille-de-route.md`
const REPO_FILE = 'travail/feuille-de-route.md'
const STATE_FILE = `flow-board/coordination/${PROJECT}.feuille-de-route.json`
const STATE_KEY = 'coo-roadmap:'
const isFileMode = (): boolean => storageMode() === 'fichier'
const ROADMAP_FILE = isFileMode() ? POSTE_FILE : REPO_FILE
const WHERE = isFileMode() ? 'poste' : 'repo'
/**
 * Sous `$.store`, ce monde n'a ni dossier de Claude ni racine de projet (`''`) : la feuille de route n'a aucun chemin et ne se
 * lit pas. Les tests qui la relisent ne tournent qu'en mode fichier ; ceux de l'état gardé seul (sa clé `coo-roadmap:`, ses
 * titres hors forme mis de côté, le choix d'endroit qui les porte, l'envoi sans le siège ou de plus de 50) tournent dans les deux modes.
 */
const canReadRoadmap = isFileMode()

/** Le chemin entier d'un fichier que le mod a écrit, ou la fin de chemin posée par le test. */
const fileAt = (w: World, tail: string): string | undefined => Object.keys(w.files).find(k => k.startsWith('/') && k.endsWith(`/${tail}`)) ?? (tail in w.files ? tail : undefined)
const roadmapAt = (w: World): string => fileAt(w, ROADMAP_FILE)!
/** L'état gardé de la feuille de route : son fichier du poste, ou sa clé de `$.store`. */
const stateOf = (w: World): any => {
  if (!isFileMode()) return w.mem[STATE_KEY]
  const at = fileAt(w, STATE_FILE)
  return at ? JSON.parse(w.files[at]!) : undefined
}
/** Un état gardé posé tel quel (un texte coupé : la clé de `$.store` reçoit ce texte, qui ne se lit pas comme un état). */
const putState = (w: World, value: Record<string, unknown> | string) => {
  if (!isFileMode()) w.mem[STATE_KEY] = value
  else w.files[fileAt(w, STATE_FILE) ?? STATE_FILE] = typeof value === 'string' ? value : JSON.stringify(value)
}
/** La lecture (fichier ou clé) de l'état gardé. */
const isStateRead = (key: string): boolean => (isFileMode() ? key.endsWith(`/${STATE_FILE}`) : key === STATE_KEY)
const hasAside = (w: World): boolean => Object.keys(w.asides).some(k => k.includes('.feuille-de-route.json.illisible-') || k.startsWith(`${STATE_KEY}:illisible:`))

const seatedWithRoadmap = async ($: any, on: any, state: Record<string, unknown> = { root: '', where: WHERE, seen: {} }) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  writeBoard(w, b => ({ ...b, runs: [] }))
  w.files[ROADMAP_FILE] = ROADMAP_TEXT
  putState(w, state)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  return { clock, w }
}
const titlesCall = async ($: any, titles: unknown): Promise<string> => String(((await $.tool.call({ tool: TOOL, coordinate: { titles } } as any)) as any).result)
const pendingPage = async ($: any) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-page-pending' })
  return pane
}

test('un envoi de titres : enregistrés avec l’empreinte du texte, refusés nommés avec leur raison, le compte des entrées sans titre ; la feuille de route identique octet pour octet', { timeoutMs: 20000 }, async ($, on) => {
  if (!canReadRoadmap) return
  const { w } = await seatedWithRoadmap($, on)
  const roadmapBefore = w.files[roadmapAt(w)]
  const said = await titlesCall($, [{ id: 'R1', title: 'Une chose à reprendre' }, { id: 'R9', title: 'absente' }, { id: 'R2', title: '' }])
  expect(said).toContain('Titles recorded: R1')
  expect(said).toContain('R9 (no such entry')
  expect(said).toContain('R2 (empty title)')
  expect(said).toContain('1 open « À reprendre » entry has no title yet')
  expect(stateOf(w).titles).toEqual({ R1: { title: 'Une chose à reprendre', print: roadmapTextPrint(entry('R1').text) } })
  expect(w.files[roadmapAt(w)]).toBe(roadmapBefore)
  // Les entrées vues restent.
  expect(Object.keys(stateOf(w).seen)).toEqual(expect.arrayContaining(['R1', 'R2', 'R3']))
})

test('au-delà de 50 titres par appel, rien n’est enregistré', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await seatedWithRoadmap($, on)
  const said = await titlesCall($, Array.from({ length: 51 }, () => ({ id: 'R1', title: 'x' })))
  expect(said).toContain('nothing recorded')
  expect(stateOf(w).titles).toBeUndefined()
})

test('un envoi sans le siège est refusé, rien n’est écrit', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await seatedWithRoadmap($, on)
  writeBoard(w, b => ({ ...b, coo: seatOf('session-Z', NOW + 7_000) }))
  const said = await titlesCall($, [{ id: 'R1', title: 'Un titre' }])
  expect(said).toContain('nothing recorded')
  expect(stateOf(w).titles).toBeUndefined()
})

test('feuille de route hors format ou qui ne se lit pas, état gardé illisible : tout l’envoi est refusé ; écriture ratée : rien de partiel', { timeoutMs: 20000 }, async ($, on) => {
  if (!canReadRoadmap) return
  const { w } = await seatedWithRoadmap($, on)
  const at = roadmapAt(w)
  w.files[at] = '# Feuille de route\n\n## Pas une section\n'
  expect(await titlesCall($, [{ id: 'R1', title: 'Un titre' }])).toContain('Titles refused, nothing recorded: the roadmap, or what the dashboard keeps of it, could not be read, or the roadmap is out of format')
  w.files[at] = ROADMAP_TEXT
  w.probe.refuseRead = key => key.endsWith(`/${ROADMAP_FILE}`)
  expect(await titlesCall($, [{ id: 'R1', title: 'Un titre' }])).toContain('nothing recorded')
  w.probe.refuseRead = isStateRead
  expect(await titlesCall($, [{ id: 'R1', title: 'Un titre' }])).toContain('what the dashboard keeps of it, could not be read')
  w.probe.refuseRead = undefined
  if (isFileMode()) {
    const stateAt = fileAt(w, STATE_FILE)!
    w.probe.refuseWrite = path => path === stateAt
  } else w.probe.refuseStore = key => key === STATE_KEY
  expect(await titlesCall($, [{ id: 'R1', title: 'Un titre' }])).toContain('nothing recorded')
  w.probe.refuseWrite = undefined
  w.probe.refuseStore = undefined
  expect(stateOf(w).titles).toBeUndefined()
  // Tout relu : le même envoi s'enregistre.
  expect(await titlesCall($, [{ id: 'R1', title: 'Un titre' }])).toContain('Titles recorded: R1')
})

test('les titres passent à travers les autres écritures de l’état : entrées vues, choix d’endroit, relevé de l’existant', { timeoutMs: 20000 }, async ($, on) => {
  if (!canReadRoadmap) return
  const { clock, w } = await seatedWithRoadmap($, on)
  await titlesCall($, [{ id: 'R1', title: 'Un titre' }])
  const kept = stateOf(w).titles
  // Une entrée de plus : les entrées vues s'écrivent.
  w.files[roadmapAt(w)] = `${ROADMAP_TEXT}- [R4] à décider · 2026-11-04 · mission « Titre », compte rendu · une chose de plus\n`
  await settle(clock, 6)
  expect(Object.keys(stateOf(w).seen)).toContain('R4')
  expect(stateOf(w).titles).toEqual(kept)
  // Le relevé de l'existant, une fois.
  await $.tool.call({ tool: TOOL, coordinate: { gleanedExisting: true } } as any)
  expect(stateOf(w).gleanedAt).toBeDefined()
  expect(stateOf(w).titles).toEqual(kept)
})

test('un état gardé hors forme est mis de côté et repart de neuf : titres perdus, chaque entrée montre le début de son texte, feuille de route et entrées vues intactes', { timeoutMs: 20000 }, async ($, on) => {
  if (!canReadRoadmap) return
  const { clock, w } = await seatedWithRoadmap($, on)
  await titlesCall($, [{ id: 'R1', title: 'Un titre' }])
  const roadmapBefore = w.files[roadmapAt(w)]
  putState(w, '{"root": "", "seen": ')
  await settle(clock, 6)
  expect(hasAside(w)).toBe(true)
  expect(stateOf(w).titles).toBeUndefined()
  expect(Object.keys(stateOf(w).seen)).toEqual(expect.arrayContaining(['R1', 'R2', 'R3']))
  expect(w.files[roadmapAt(w)]).toBe(roadmapBefore)
  const pane = await pendingPage($)
  expect(await pane.find({ type: 'Text', text: /^Un titre$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^une chose à reprendre, assez longue/ })).toBeDefined()
  await pane.unmount()
})

test('un état gardé qui ne se lit pas : aucun titre ne se montre (la feuille de route se dit illisible), rien n’est réécrit', { timeoutMs: 20000 }, async ($, on) => {
  if (!canReadRoadmap) return
  const { clock, w } = await seatedWithRoadmap($, on)
  await titlesCall($, [{ id: 'R1', title: 'Un titre' }])
  const shown = await pendingPage($)
  expect(await shown.find({ type: 'Text', text: /^Un titre$/ })).toBeDefined()
  await shown.unmount()
  const before = JSON.stringify(stateOf(w))
  w.probe.refuseRead = isStateRead
  await settle(clock, 6)
  const pane = await pendingPage($)
  expect(await pane.find({ type: 'Text', text: /^Un titre$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Feuille de route illisible/ })).toBeDefined()
  await pane.unmount()
  w.probe.refuseRead = undefined
  expect(JSON.stringify(stateOf(w))).toBe(before)
})

test('un titre hors forme dans l’état gardé est écarté, l’état mis de côté, les titres en forme gardés', { timeoutMs: 20000 }, async ($, on) => {
  const print = roadmapTextPrint(entry('R1').text)
  const { w } = await seatedWithRoadmap($, on, { root: '', where: WHERE, seen: {}, titles: { R1: { title: 'Bon', print }, R2: { title: 'deux\nlignes', print } } })
  expect(stateOf(w).titles).toEqual({ R1: { title: 'Bon', print } })
  expect(hasAside(w)).toBe(true)
})

test('la page « À reprendre » montre le titre de l’entrée à la place du début de son texte ; le texte déplié reste celui du fichier', { timeoutMs: 20000 }, async ($, on) => {
  if (!canReadRoadmap) return
  await seatedWithRoadmap($, on)
  await titlesCall($, [{ id: 'R1', title: 'Le titre court' }])
  const pane = await pendingPage($)
  await pane.press({ key: 'coo-pending-open-R1' })
  await pane.unmount()
  const shown = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await shown.find({ type: 'Text', text: /^Le titre court$/ })).toBeDefined()
  expect(await shown.find({ type: 'Text', text: new RegExp(`^${entry('R1').text}$`) })).toBeDefined()
  await shown.unmount()
})

test('un deuxième envoi pour le même id remplace le titre ; les autres titres restent', { timeoutMs: 20000 }, async ($, on) => {
  if (!canReadRoadmap) return
  const { w } = await seatedWithRoadmap($, on)
  await titlesCall($, [{ id: 'R1', title: 'Premier' }, { id: 'R2', title: 'Autre' }])
  expect(await titlesCall($, [{ id: 'R1', title: 'Second' }])).toContain('0 open « À reprendre » entries have no title yet')
  expect(stateOf(w).titles).toEqual({ R1: { title: 'Second', print: roadmapTextPrint(entry('R1').text) }, R2: { title: 'Autre', print: roadmapTextPrint(entry('R2').text) } })
})

test('le choix d’endroit garde les titres', { timeoutMs: 20000 }, async ($, on) => {
  const kept = { R1: { title: 'Un titre', print: roadmapTextPrint(entry('R1').text) } }
  const { clock, w } = await seatedWithRoadmap($, on, { root: '', seen: {}, titles: kept })
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: isFileMode() ? 'coo-where-repo' : 'coo-where-poste' })
  await pane.unmount()
  await settle(clock, 6)
  expect(stateOf(w).where).toBe(isFileMode() ? 'repo' : 'poste')
  expect(stateOf(w).titles).toEqual(kept)
})

test('un texte changé sous le même id : le titre ne s’affiche plus, il reste gardé, et la veille garde un seul ancien texte, comme sans titre', { timeoutMs: 20000 }, async ($, on) => {
  if (!canReadRoadmap) return
  const { clock, w } = await seatedWithRoadmap($, on)
  await titlesCall($, [{ id: 'R1', title: 'Le titre court' }])
  const kept = stateOf(w).titles
  const at = roadmapAt(w)
  w.files[at] = w.files[at]!.replace('une chose à reprendre, assez longue', 'un texte réécrit, assez long')
  await settle(clock, 6)
  expect(stateOf(w).titles).toEqual(kept)
  expect(stateOf(w).seen.R1.earlier).toHaveLength(1)
  const pane = await pendingPage($)
  expect(await pane.find({ type: 'Text', text: /^Le titre court$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^un texte réécrit, assez long/ })).toBeDefined()
  await pane.unmount()
})

test('une entrée disparue de la feuille de route garde son titre, pas affiché ; remise avec le même texte, elle le retrouve', { timeoutMs: 20000 }, async ($, on) => {
  if (!canReadRoadmap) return
  const { clock, w } = await seatedWithRoadmap($, on)
  await titlesCall($, [{ id: 'R1', title: 'Le titre court' }])
  const kept = stateOf(w).titles
  const at = roadmapAt(w)
  w.files[at] = ROADMAP_TEXT.replace(/^- \[R1\].*\n/m, '')
  await settle(clock, 6)
  // L'id gardé d'une entrée absente : son titre reste, sans affichage ; l'entrée disparue s'alerte comme sans titre.
  expect(stateOf(w).titles).toEqual(kept)
  const gone = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await gone.find({ key: 'coo-restore-R1' })).toBeDefined()
  await gone.unmount()
  const pane = await pendingPage($)
  expect(await pane.find({ type: 'Text', text: /^Le titre court$/ })).toBeUndefined()
  await pane.unmount()
  w.files[at] = ROADMAP_TEXT
  await settle(clock, 6)
  const back = await pendingPage($)
  expect(await back.find({ type: 'Text', text: /^Le titre court$/ })).toBeDefined()
  await back.unmount()
})

test('l’appel dicté rejoué : une liste vide n’enregistre rien et redit le compte ; une valeur qui n’est pas une liste est refusée', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await seatedWithRoadmap($, on)
  if (canReadRoadmap) expect(await titlesCall($, [])).toContain('No title recorded. 2 open « À reprendre » entries have no title yet.')
  expect(await titlesCall($, { id: 'R1', title: 'Un titre' })).toContain('Titles refused, nothing recorded: "titles" takes a list')
  expect(stateOf(w).titles).toBeUndefined()
})
