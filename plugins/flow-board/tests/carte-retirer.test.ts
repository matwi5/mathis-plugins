// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { cooStatement } from '../hooks/coo.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { parseCard, pistesCard } from '../hooks/launch.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, world, writeBoard, type World } from './monde-coordination.ts'
import { allTexts, findAny, findAllAny, pressAny } from './page-coo.ts'

// « ✕ Retirer » sur une carte de lancement ordinaire prête : même libellé et même geste que pour une carte de rétro, sur
// les seules cartes ordinaires (une carte de rétro et une carte « Pistes de rétro » gardent leurs conditions).
// Invariant : « Une carte de lancement prête ne quitte jamais la vue sans un clic de la personne qui la vise : la lancer, la retirer, ou archiver la mission dont elle est la rétro ; une carte
// « Pistes de rétro » posée par un découpage ou par le relevé du COO, et qu'aucune piste ne porte après son écriture,
// repart aussitôt. »

const CARD = { title: 'Export CSV des tickets', idea: 'I1', start: 'grill-with-docs', askMatt: 'l. 19 : une idée encore floue → /grill-with-docs', alts: ['to-spec'], mode: 'manual', modeWhy: 'tu veux suivre le cadrage', effort: 'high', effortWhy: 'cadrage', folder: 'export-csv', goal: 'Objectif de test.' }

const pane = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })

/** L'id de la carte, tel que la réponse de l'outil le donne. */
const cardIdOf = (answer: string): string => /Launch card (k[a-z0-9]+)/.exec(answer)?.[1] ?? ''

/** Le Claude du COO propose une carte ; rend son id. */
const propose = async ($: any, over: Record<string, unknown> = {}): Promise<string> => cardIdOf(String(((await $.tool.call({ tool: TOOL, card: { ...CARD, ...over } } as any)) as any).result))

/** Les enregistrements de lancement du stockage du mod. */
const launches = (w: World): { folder: string }[] => Object.entries(w.mem).filter(([k]) => k.startsWith('coo-launch:')).map(([, v]) => v as { folder: string })

/** Le relevé du COO, tel que le tour suivant le reçoit. */
const statement = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))

/** Les écritures de fichiers vers la feuille de route, relevées par la sonde d'écriture du monde. */
const roadmapWrites = (w: World): string[] => {
  const seen: string[] = []
  w.probe.refuseWrite = path => {
    if (path.includes('feuille-de-route')) seen.push(path)
    return false
  }
  return seen
}

const openCooWith = async ($: any, on: any, now: number) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-COO'
  writeBoard(w, b => b)
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by this discussion/)
  return { clock, w }
}

/** Les titres de cartes montrés parmi `titles`, dans l'ordre de la vue. */
const shownCards = async (ui: any, titles: readonly string[]): Promise<string[]> => {
  const text = await allTexts(ui)
  return titles.filter(t => text.includes(t)).sort((x, y) => text.indexOf(x) - text.indexOf(y))
}

test('une carte ordinaire prête porte « ✕ Retirer » après ses boutons ; le clic la retire et la nomme', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openCooWith($, on, 400_000_000)
  const id = await propose($)
  const ui = await pane($)
  const keys = ((await findAllAny(ui, { type: 'Button' })) as any[]).map(b => String(b.props?.key ?? b.key)).filter(k => k.includes(id))
  expect(keys).toEqual([`coo-card-manual-${id}`, `coo-card-auto-${id}`, `coo-card-alt-${id}-to-spec`, `coo-card-remove-${id}`])
  const remove = await findAny(ui, { key: `coo-card-remove-${id}` })
  expect(String(remove?.props.label ?? '').replace(/\s/g, ' ')).toBe('✕ Retirer')
  await pressAny(ui, { key: `coo-card-remove-${id}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(w.toasts.at(-1)).toBe('◆ Carte retirée : « Export CSV des tickets ».')
  const after = await pane($)
  expect(await allTexts(after)).not.toContain('Export CSV des tickets')
  await after.unmount()
})

test('trois cartes, celle du milieu retirée : les deux autres restent prêtes, dans le même ordre', { timeoutMs: 20000 }, async ($, on) => {
  const { clock } = await openCooWith($, on, 401_000_000)
  const a = await propose($, { title: 'Carte A', folder: 'dossier-a' })
  const b = await propose($, { title: 'Carte B', folder: 'dossier-b' })
  const c = await propose($, { title: 'Carte C', folder: 'dossier-c' })
  const ui = await pane($)
  expect(await shownCards(ui, ['Carte A', 'Carte B', 'Carte C'])).toEqual(['Carte A', 'Carte B', 'Carte C'])
  await pressAny(ui, { key: `coo-card-remove-${b}` })
  await ui.unmount()
  await settle(clock, 2)
  const after = await pane($)
  expect(await shownCards(after, ['Carte A', 'Carte B', 'Carte C'])).toEqual(['Carte A', 'Carte C'])
  // Encore prêtes : leurs boutons de lancement et de retrait sont là.
  for (const k of [a, c]) {
    expect(await findAny(after, { key: `coo-card-manual-${k}` })).toBeDefined()
    expect(await findAny(after, { key: `coo-card-remove-${k}` })).toBeDefined()
  }
  await after.unmount()
})

test('une carte en lancement ou lancée n’a pas « ✕ Retirer »', { timeoutMs: 20000 }, async ($, on) => {
  const now = 402_000_000
  const { clock, w } = await openCooWith($, on, now)
  const id = await propose($)
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-manual-${id}` })
  await ui.unmount()
  const launching = await pane($)
  expect(await findAny(launching, { type: 'Text', text: /lancement en cours/ })).toBeDefined()
  expect(await findAny(launching, { key: `coo-card-remove-${id}` })).toBeUndefined()
  await launching.unmount()
  // Une mission la porte : lancée, elle n'est plus montrée, ni son bouton.
  writeBoard(w, b => ({ ...b, runs: [{ ...newRun('grill-with-docs', now, 'Export CSV des tickets'), status: 'active', owner: 'session-M', launch: { id: 'labcdefgh12', card: id, at: now, folder: 'export-csv', start: 'grill-with-docs', mode: 'manual' } }] }))
  await settle(clock, 6)
  const launched = await pane($)
  expect(await findAny(launched, { key: `coo-card-remove-${id}` })).toBeUndefined()
  await launched.unmount()
})

test('un clic arrivé trop tard ne retire rien : carte lancée entre-temps, déjà retirée, ou lancement cliqué en même temps', { timeoutMs: 30000 }, async ($, on) => {
  const now = 403_000_000
  const { clock, w } = await openCooWith($, on, now)
  const TOO_LATE = '◆ Rien n’est retiré : relis la carte.'
  // Lancée entre-temps : une mission porte son dossier depuis le dessin.
  const a = await propose($, { title: 'Carte A', folder: 'dossier-a' })
  const ui = await pane($)
  await findAny(ui, { key: `coo-card-remove-${a}` })
  writeBoard(w, b => ({ ...b, runs: [{ ...newRun('grill-with-docs', now, 'Carte A'), status: 'active', owner: 'session-M', launch: { id: 'labcdefgh12', card: a, at: now, folder: 'dossier-a', start: 'grill-with-docs', mode: 'manual' } }] }))
  await ui.press({ key: `coo-card-remove-${a}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(w.toasts.at(-1)).toBe(TOO_LATE)
  expect(await statement($)).toContain('Carte A')
  // Déjà retirée : deux clics sur le même dessin, le second ne trouve plus la carte.
  const b = await propose($, { title: 'Carte B', folder: 'dossier-b' })
  const twice = await pane($)
  await findAny(twice, { key: `coo-card-remove-${b}` })
  await Promise.all([twice.press({ key: `coo-card-remove-${b}` }), twice.press({ key: `coo-card-remove-${b}` })])
  await twice.unmount()
  await settle(clock, 2)
  // L'un des deux clics retire la carte, l'autre ne retire rien (l'ordre de leurs réponses n'est pas fixé).
  expect(w.toasts.slice(-2).sort()).toEqual(['◆ Carte retirée : « Carte B ».', TOO_LATE].sort())
  // Lancement puis retrait cliqués en même temps sur la même carte : le lancement passe, la carte n'est pas retirée.
  const c = await propose($, { title: 'Carte C', folder: 'dossier-c' })
  const both = await pane($)
  await findAny(both, { key: `coo-card-remove-${c}` })
  const before = w.toasts.length
  await Promise.all([both.press({ key: `coo-card-manual-${c}` }), both.press({ key: `coo-card-remove-${c}` })])
  await both.unmount()
  await settle(clock, 2)
  expect(w.toasts.slice(before)).toContain(TOO_LATE)
  expect(w.toasts.slice(before).some(t => t.startsWith('◆ Carte retirée'))).toBe(false)
  const after = await pane($)
  expect(await findAny(after, { type: 'Text', text: /lancement en cours/ })).toBeDefined()
  await after.unmount()
  // Retrait puis lancement, dans cet ordre : le faux moteur fait passer le lancement d'abord (le retrait relit les cartes
  // avant de tenir la carte), comme ci-dessus : le lancement passe et rien n'est retiré.
  const d = await propose($, { title: 'Carte D', folder: 'dossier-d' })
  const other = await pane($)
  await findAny(other, { key: `coo-card-remove-${d}` })
  const from = w.toasts.length
  await Promise.all([other.press({ key: `coo-card-remove-${d}` }), other.press({ key: `coo-card-manual-${d}` })])
  await other.unmount()
  await settle(clock, 2)
  expect(w.toasts.slice(from)).toContain(TOO_LATE)
  expect(launches(w).filter(r => r.folder === 'dossier-d')).toHaveLength(1)
})

test('un lancement gardé illisible, ou un lancement gardé valable qui nomme la carte : rien n’est retiré', { timeoutMs: 20000 }, async ($, on) => {
  const now = 407_000_000
  const { clock, w } = await openCooWith($, on, now)
  const id = await propose($)
  // Les lancements gardés ne se lisent pas (la liste des clés du magasin refusée).
  w.probe.refuseKeys = () => true
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-remove-${id}` })
  await ui.unmount()
  w.probe.refuseKeys = undefined
  await settle(clock, 2)
  expect(w.toasts.at(-1)).toBe('◆ Rien n’est retiré : relis la carte.')
  // Un lancement gardé encore valable porte le dossier de la carte (sa marque perdue) : la carte reste.
  w.mem['coo-launch:lkeptlaunch1'] = { v: 1, id: 'lkeptlaunch1', card: id, root: '', title: 'Export CSV des tickets', start: 'grill-with-docs', mode: 'manual', effort: 'high', folder: 'export-csv', at: now, by: 'session-COO' }
  const again = await pane($)
  await pressAny(again, { key: `coo-card-remove-${id}` })
  await again.unmount()
  await settle(clock, 2)
  expect(w.toasts.at(-1)).toBe('◆ Rien n’est retiré : relis la carte.')
  // Le lancement gardé effacé (un lancement du même dossier dans un autre projet ne compte pas) : le même clic retire
  // la carte (le refus venait bien de lui).
  delete w.mem['coo-launch:lkeptlaunch1']
  w.mem['coo-launch:lautreprojet'] = { v: 1, id: 'lautreprojet', card: 'kautre00001', root: '/autre/projet', title: 'Export ailleurs', start: 'grill-with-docs', mode: 'manual', effort: 'high', folder: 'export-csv', at: now, by: 'session-AUTRE' }
  const last = await pane($)
  await pressAny(last, { key: `coo-card-remove-${id}` })
  await last.unmount()
  await settle(clock, 2)
  expect(w.toasts.at(-1)).toBe('◆ Carte retirée : « Export CSV des tickets ».')
})

test('un clic sur un dessin d’avant une carte reproposée (même dossier, même id) ne retire pas la nouvelle version', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openCooWith($, on, 406_000_000)
  const id = await propose($)
  const ui = await pane($)
  await findAny(ui, { key: `coo-card-remove-${id}` })
  // Le Claude du COO la repropose, autre titre, même dossier, à la même heure : elle garde son id et prend une date
  // plus récente que la carte remplacée.
  // Le clic part pendant que la carte reproposée s'écrit. Le panneau des tests se redessine avant chaque clic, et son
  // bouton n'expose pas le clic d'un dessin d'avant : la date qu'emporte le clic se vérifie sur la vue (test suivant).
  // Quel que soit l'ordre des deux, la version 2 reste.
  const before = w.toasts.length
  await Promise.all([ui.press({ key: `coo-card-remove-${id}` }), propose($, { title: 'Export CSV, version 2' })])
  await ui.unmount()
  await settle(clock, 2)
  expect(w.toasts.slice(before).some(t => t === '◆ Carte retirée : « Export CSV, version 2 ».')).toBe(false)
  const after = await pane($)
  expect(await allTexts(after)).toContain('Export CSV, version 2')
  await after.unmount()
})

test('le clic « ✕ Retirer » d’une carte ordinaire emporte la date de la version montrée ; celui d’une carte « Pistes de rétro » ne change pas', () => {
  const ordinary = (parseCard(CARD, 1234, 'kordinaire1') as { card: any }).card
  const pistes = pistesCard('kpistes0001', 5678)
  const rows = coordinationRows(cooStatement(emptyBoard('', 'p'), { now: 9_999, cards: [ordinary, pistes] }), { page: 'overview' })
  const removeOf = (id: string) => rows.flatMap(r => r.actions ?? []).find(a => a.key === `coo-card-remove-${id}`)?.act
  expect(removeOf('kordinaire1')).toEqual({ kind: 'card-remove', card: 'kordinaire1', at: 1234 })
  expect(removeOf('kpistes0001')).toEqual({ kind: 'card-remove', card: 'kpistes0001' })
})

test('depuis une discussion qui ne tient plus le siège, ou le fichier des missions illisible : rien n’est retiré, le contrôle des gestes le dit', { timeoutMs: 20000 }, async ($, on) => {
  const now = 404_000_000
  const { clock, w } = await openCooWith($, on, now)
  const id = await propose($)
  // Fichier des missions illisible au clic.
  const ui = await pane($)
  await findAny(ui, { key: `coo-card-remove-${id}` })
  w.probe.refuseRead = key => key === 'board:' || key.includes('/flow-board/parcours/')
  await ui.press({ key: `coo-card-remove-${id}` })
  w.probe.refuseRead = undefined
  await settle(clock, 2)
  expect(w.toasts.at(-1)).toMatch(/^◆ Siège du COO illisible/)
  // Une autre discussion a pris le siège.
  writeBoard(w, b => ({ ...b, coo: { by: 'session-AUTRE', at: now + 5_000, seenAt: now + 5_000 } }))
  await ui.press({ key: `coo-card-remove-${id}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(w.toasts.at(-1)).toBe('◆ Cette discussion ne tient plus le siège du COO : rien n’est fait.')
  expect(w.toasts.some(t => t.startsWith('◆ Carte retirée'))).toBe(false)
})

test('rien n’est écrit sur la feuille de route, le relevé ne liste plus la carte, et une carte reproposée revient prête', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openCooWith($, on, 405_000_000)
  const writes = roadmapWrites(w)
  const id = await propose($)
  expect(await statement($)).toContain(`launch card « ${id} »`)
  const ui = await pane($)
  await pressAny(ui, { key: `coo-card-remove-${id}` })
  await ui.unmount()
  await settle(clock, 2)
  expect(writes).toEqual([])
  const said = await statement($)
  expect(said).not.toContain(`launch card « ${id} »`)
  expect(said).not.toContain('Export CSV des tickets')
  // Reproposée sur le même dossier : de nouveau là, prête.
  const again = await propose($)
  expect(again).not.toBe('')
  const back = await pane($)
  expect(await findAny(back, { key: `coo-card-manual-${again}` })).toBeDefined()
  expect(await findAny(back, { key: `coo-card-remove-${again}` })).toBeDefined()
  await back.unmount()
})
