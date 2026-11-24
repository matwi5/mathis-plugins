// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { newRun } from '../hooks/model.ts'
import { retroCardId, retroFolder } from '../hooks/retro-coo.ts'
import type { Run } from '../types'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, world, writeBoard } from './monde-coordination.ts'
import { allTexts, findAny, pressAny } from './page-coo.ts'

// Plus de plafond pour les cartes de lancement : le Claude du COO propose autant de cartes qu'il veut, et aucune carte
// n'en chasse une autre, ni à la carte proposée ni à la livraison. Invariant : « Une carte de lancement prête ne quitte
// jamais la vue sans un clic de la personne qui la vise : la lancer, la retirer, ou archiver la mission dont elle est la
// rétro ; une carte « Pistes de rétro » posée par un découpage ou par le relevé du COO, et qu'aucune piste ne porte après
// son écriture, repart aussitôt. »

const T0 = 820_000_000
const CARD = { title: 'Export CSV', start: 'grill-with-docs', askMatt: 'l. 19 : une idée encore floue → /grill-with-docs', alts: [], mode: 'manual', modeWhy: 'cadrage', effort: 'high', effortWhy: 'cadrage', folder: 'export-csv', goal: 'Objectif de test.' }

const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })

/** Le Claude du COO propose une carte ; rend la réponse de l'outil. */
const propose = async ($: any, over: Record<string, unknown> = {}): Promise<string> => String(((await $.tool.call({ tool: TOOL, card: { ...CARD, ...over } } as any)) as any).result)

/** L'id de la carte, tel que la réponse de l'outil le donne. */
const cardIdOf = (answer: string): string => /Launch card (k[a-z0-9]+)/.exec(answer)?.[1] ?? ''

const openCooAt = async ($: any, on: any, now: number) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-COO'
  writeBoard(w, b => b)
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  return { clock, w }
}

/** Les titres montrés parmi `titles`, dans l'ordre de la vue. */
const shownInOrder = (text: string, titles: readonly string[]): string[] => titles.filter(t => text.includes(t)).sort((x, y) => text.indexOf(x) - text.indexOf(y))

test('neuf cartes proposées l’une après l’autre, sur neuf dossiers : les neuf sont prêtes, dans l’ordre de leur pose', { timeoutMs: 20000 }, async ($, on) => {
  await openCooAt($, on, T0)
  const titles = Array.from({ length: 9 }, (_, i) => `Carte n°${String(i + 1).padStart(2, '0')}`)
  const ids: string[] = []
  for (let i = 0; i < 9; i++) ids.push(cardIdOf(await propose($, { title: titles[i], folder: `dossier-${i + 1}` })))
  const ui = await pane($)
  const text = await allTexts(ui)
  expect(shownInOrder(text, titles)).toEqual(titles)
  expect(text).toContain('Au départ · 9')
  for (const id of ids) expect(await findAny(ui, { key: `coo-card-manual-${id}` })).toBeDefined()
  await ui.unmount()
})

test('vingt cartes proposées, dont une en lancement et une lancée : aucune ne part', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await openCooAt($, on, T0 + 1_000_000)
  const launching = cardIdOf(await propose($, { title: 'Carte en lancement', folder: 'en-lancement' }))
  const launched = cardIdOf(await propose($, { title: 'Carte lancée', folder: 'lancee', idea: 'I5' }))
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-manual-${launching}` })
  await ui.unmount()
  writeBoard(w, b => ({ ...b, runs: [{ ...newRun('grill-with-docs', T0 + 1_000_000, 'Mission lancée'), status: 'active', owner: 'session-M', launch: { id: 'labcdefgh12', card: launched, at: T0 + 1_000_000, folder: 'lancee', start: 'grill-with-docs', mode: 'manual' } }] }))
  await settle(clock, 6)
  const titles = Array.from({ length: 18 }, (_, i) => `Carte n°${String(i + 1).padStart(2, '0')}`)
  for (let i = 0; i < 18; i++) await propose($, { title: titles[i], folder: `dossier-${i + 1}` })
  const view = await pane($)
  const text = await allTexts(view)
  // Les dix-huit cartes prêtes restent, dans l'ordre ; la carte en lancement aussi (montrée) ; la carte lancée, cachée,
  // reste gardée : le relevé du COO la liste encore, par son id, avec sa mission (son idée n'a pas pu être passée).
  expect(shownInOrder(text, titles)).toEqual(titles)
  expect(text).toContain('Carte en lancement')
  expect(text).toContain('Au départ · 19')
  await view.unmount()
  expect(JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))).toMatch(new RegExp(`launch card « ${launched} » « Carte lancée »: .*launched as mission (M\\d+ )?« Mission lancée »`))
  expect(await propose($, { title: 'Carte lancée', folder: 'lancee' })).toMatch(/already launched/)
  expect(await propose($, { title: 'Carte en lancement', folder: 'EN-lancement' })).toMatch(/being launched/)
})

test('la réponse à une carte proposée ne change pas', { timeoutMs: 20000 }, async ($, on) => {
  await openCooAt($, on, T0 + 2_000_000)
  for (let i = 0; i < 9; i++) await propose($, { title: `Carte ${i}`, folder: `dossier-${i}` })
  const answer = await propose($, { title: 'La dixième', folder: 'dixieme' })
  expect(answer).toMatch(/^Launch card k[a-z0-9]+ shown in the Coordination view: « La dixième », \/grill-with-docs, manual, high, travail\/dixieme\/\. The user launches it with its button; never launch a mission without that click\./)
})

/** Une mission au rapport validé, sa phase « Version et push » à faire, en pause : prête à livrer. */
const validated = (now: number, title: string): Run => {
  const run = newRun('implement', now - 90_000, title)
  const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: now - 60_000 }
  const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: now - 50_000, finishedAt: now - 40_000, steps: [], items: [] }
  const version = newRun('project:version', run.startedAt, 'v').phases[0]!
  const pending = { ...version, status: 'pending' as const, startedAt: undefined, steps: version.steps.map(s => ({ id: s.id, status: 'pending' as const })) }
  return { ...run, phases: [done, report, pending], cursor: 1, status: 'paused', reportValidatedAt: now - 40_000, updatedAt: now - 1_000 } as Run
}

test('une livraison qui pose des cartes de rétro quand neuf cartes ordinaires sont là : les neuf restent, et la réponse ne parle pas de cartes parties', { timeoutMs: 30000 }, async ($, on) => {
  const now = T0 + 3_000_000
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-COO'
  const run = validated(now, 'Mission livrée')
  w.mem['coo-delivery:'] = { v: 1, id: 'd1', missions: [{ id: run.id, title: run.title, validatedAt: run.reportValidatedAt }], steps: [{ key: 'version', status: 'done', at: now - 5_000, detail: '0.80.0' }, { key: 'push', status: 'done', at: now - 4_000 }, { key: 'project', status: 'running', at: now - 3_000 }], startedAt: now - 9_000 }
  writeBoard(w, b => ({ ...b, runs: [run] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const titles = Array.from({ length: 9 }, (_, i) => `Carte n°${String(i + 1).padStart(2, '0')}`)
  for (let i = 0; i < 9; i++) await propose($, { title: titles[i], folder: `dossier-${i + 1}` })
  const answer = String(((await $.tool.call({ tool: TOOL, delivery: { step: 'project', ok: true } } as any)) as any).result)
  await settle(clock, 2)
  expect(answer).toMatch(/Delivery done/)
  expect(answer).toMatch(/1 card\(s\) « Rétrospective · … »/)
  expect(answer).not.toMatch(/To make room|left the view/)
  const view = await pane($)
  const text = await allTexts(view)
  expect(shownInOrder(text, titles)).toEqual(titles)
  expect(text).toContain('Rétrospective · Mission livrée')
  await view.unmount()
})

test('une carte de Claude sur le dossier d’une carte de rétro prête est refusée : la carte de rétro reste, avec sa mission étudiée', { timeoutMs: 30000 }, async ($, on) => {
  const now = T0 + 4_000_000
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-COO'
  const closed: Run = { ...newRun('prototype', now - 600_000, 'Mission close'), status: 'done', finishedAt: now - 540_000, updatedAt: now - 540_000 }
  writeBoard(w, b => ({ ...b, runs: [closed] }))
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const ui = await pane($)
  expect(await allTexts(ui)).toContain('Rétrospective · Mission close')
  const folder = retroFolder(closed)
  expect(await findAny(ui, { key: `coo-card-${retroCardId(closed.id)}` })).toBeDefined()
  await ui.unmount()
  expect(folder).toMatch(/^retro-/)
  const answer = await propose($, { title: 'Une carte ordinaire', folder })
  expect(answer).toMatch(/^No card shown: /)
  expect(answer).toContain(`travail/${folder}/`)
  await settle(clock, 6)
  const after = await pane($)
  const text = await allTexts(after)
  expect(text).toContain('Rétrospective · Mission close')
  expect(text).not.toContain('Une carte ordinaire')
  // C'est toujours la carte de rétro : son « ✓ Archiver » ou son lancement de rétro, pas une carte ordinaire.
  expect(await findAny(after, { key: `coo-card-manual-${retroCardId(closed.id)}` })).toBeDefined()
  await after.unmount()
})
