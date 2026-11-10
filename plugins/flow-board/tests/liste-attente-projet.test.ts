// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { emptyWaitlist, pistesOf, type Piste, type Waitlist } from '../hooks/pistes.ts'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, type World, world } from './monde-coordination.ts'

// Le choix de commiter la liste d'attente des rétros dans le projet. Invariant de la liste : « Une écriture d'une
// rétro ou du COO n'efface ni ne change jamais en silence la piste d'une autre ; une piste ne quitte jamais le
// fichier, et une piste en exécution ne change plus. »

const NOW = 730_000_000
/** Le nom des fichiers du projet de ces tests (racine vide) sur ce poste, comme `coordinationName`. */
const PROJECT = 'sans-projet-811c9dc5'
/** La liste dans le projet : son chemin fixe, résolu depuis la racine (vide ici). */
const REPO = '/travail/pistes-retros.json'

const piste = (id: string, over: Partial<Piste> = {}): Piste => ({ id, retro: id.slice(0, id.indexOf('/')), text: `Texte de ${id}`, files: [], state: 'pending', by: id.slice(0, id.indexOf('/')), at: NOW - 1000, history: [], comments: [], ...over })
const listWith = (pistes: unknown[], root = ''): Waitlist => ({ ...emptyWaitlist(root), pistes })

/** Pose la liste du poste : au fichier (par la fin de son chemin) et dans le stockage. */
const putPoste = (w: World, pistes: unknown[]) => {
  const list = listWith(pistes)
  w.files[`flow-board/pistes/${PROJECT}.json`] = JSON.stringify(list)
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/flow-board/pistes/${PROJECT}.json`)) w.files[k] = JSON.stringify(list)
  w.mem['coo-pistes:'] = list
}
const posteOf = (w: World): Waitlist => {
  const path = Object.keys(w.files).find(p => p.startsWith('/') && p.endsWith(`/flow-board/pistes/${PROJECT}.json`))
  return (path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes:']) as Waitlist
}
const repoOf = (w: World): Waitlist | undefined => (w.files[REPO] === undefined ? undefined : (JSON.parse(w.files[REPO]!) as Waitlist))
/** Le choix gardé : au fichier du poste, ou dans le stockage. */
const choiceOf = (w: World): unknown => {
  const path = Object.keys(w.files).find(p => p.endsWith(`/flow-board/pistes/${PROJECT}.endroit.json`))
  return path ? JSON.parse(w.files[path]!) : w.mem['coo-pistes-endroit:']
}
const putChoiceText = (w: World, text: string) => {
  w.files[`flow-board/pistes/${PROJECT}.endroit.json`] = text
  for (const k of Object.keys(w.files)) if (k.startsWith('/') && k.endsWith(`/flow-board/pistes/${PROJECT}.endroit.json`)) w.files[k] = text
  w.mem['coo-pistes-endroit:'] = text
}
const texts = async (pane: any): Promise<string> => ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')
const call = async ($: any, input: Record<string, unknown>): Promise<string> => String(((await $.tool.call({ tool: TOOL, ...input } as any)) as any).result)
const mount = ($: any) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
const statement = async ($: any): Promise<string> => JSON.stringify(await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any))
const press = async ($: any, clock: any, key: string) => {
  const pane = await mount($)
  await pane.press({ key })
  await pane.unmount()
  await settle(clock, 2)
}

/** Le COO ouvert ici, la liste du poste relue. */
const cooWith = async ($: any, clock: any, w: World, pistes: unknown[]) => {
  putPoste(w, pistes)
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
}

test('par défaut, la liste reste sur le poste : la vue pose la question avec ses deux boutons, rien n’est écrit dans le projet', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [piste('retroA/p1')])
  expect(await call($, { pistes: [{ op: 'comment', piste: 'retroA/p1', text: 'Voir R12' }] })).toMatch(/applied/)
  expect(pistesOf(posteOf(w))[0]!.comments).toEqual([expect.objectContaining({ text: 'Voir R12' })])
  expect(repoOf(w)).toBeUndefined()
  const pane = await mount($)
  const shown = await texts(pane)
  expect(shown).toContain('Liste d’attente des rétros : la commiter dans ce projet ?')
  expect(shown).toContain('Dans un dépôt public, les pistes seraient publiées. En attendant ton choix, elle reste sur ce poste.')
  expect(String((await pane.find({ key: 'coo-pistes-where-repo' }))?.props.label).replace(/\s/g, ' ')).toBe('Commiter dans travail/')
  expect(String((await pane.find({ key: 'coo-pistes-where-poste' }))?.props.label).replace(/\s/g, ' ')).toBe('Garder sur le poste')
  await pane.unmount()
  expect(await statement($)).not.toMatch(/pistes-retros\.json/)
})

test('« Commiter dans travail/ » : la liste est recopiée au chemin fixe du projet, sans la racine du poste ; le mod y écrit ensuite, la copie du poste reste ; le relevé demande le commit par chemin', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [piste('retroA/p1')])
  const before = posteOf(w)
  await press($, clock, 'coo-pistes-where-repo')
  expect(choiceOf(w)).toEqual(expect.objectContaining({ where: 'repo' }))
  expect(repoOf(w)).toEqual({ ...before, root: '.' })
  // Ce qui part dans le dépôt : ces seules clés, et la racine fixe (jamais le chemin du poste).
  expect(Object.keys(repoOf(w)!).sort()).toEqual(['applied', 'pistes', 'refused', 'root', 'v'])
  expect(w.toasts.join('\n')).toMatch(/Liste d’attente des rétros : elle vivra sous travail\/ de ce projet/)
  // Le mod écrit désormais dans le projet ; la copie du poste ne change plus.
  expect(await call($, { pistes: [{ op: 'comment', piste: 'retroA/p1', text: 'Voir R12' }] })).toMatch(/applied/)
  expect(pistesOf(repoOf(w)!)[0]!.comments).toEqual([expect.objectContaining({ text: 'Voir R12' })])
  expect(posteOf(w)).toEqual(before)
  // Plus de question dans la vue.
  const pane = await mount($)
  expect(await pane.find({ key: 'coo-pistes-where-repo' })).toBeUndefined()
  await pane.unmount()
  const said = await statement($)
  expect(said).toContain('travail/pistes-retros.json')
  expect(said).toMatch(/git pull --ff-only/)
  expect(said).toMatch(/commit it by its path/)
  expect(said).toMatch(/stop and tell the user/)
  // La copie du poste, gardée : le relevé dit que la personne peut la retirer à la main.
  expect(said).toMatch(/former copy on this (computer|poste)/)
})

test('« Garder sur le poste » : le choix est gardé, la question part, rien dans le projet ni de commit au relevé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [piste('retroA/p1')])
  await press($, clock, 'coo-pistes-where-poste')
  expect(choiceOf(w)).toEqual(expect.objectContaining({ where: 'poste' }))
  const pane = await mount($)
  expect(await pane.find({ key: 'coo-pistes-where-repo' })).toBeUndefined()
  await pane.unmount()
  expect(await call($, { pistes: [{ op: 'comment', piste: 'retroA/p1', text: 'Voir' }] })).toMatch(/applied/)
  expect(repoOf(w)).toBeUndefined()
  const said = await statement($)
  expect(said).toMatch(/Retro waitlist of the project/)
  expect(said).not.toMatch(/pistes-retros\.json/)
})

test('un choix hors forme vaut « poste » : la liste se lit et s’écrit sur le poste, la question revient', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putChoiceText(w, '{"v":1,"where":"re')
  await cooWith($, clock, w, [piste('retroA/p1')])
  expect(await call($, { pistes: [{ op: 'comment', piste: 'retroA/p1', text: 'Voir' }] })).toMatch(/applied/)
  expect(pistesOf(posteOf(w))[0]!.comments).toHaveLength(1)
  expect(repoOf(w)).toBeUndefined()
  const pane = await mount($)
  expect(await pane.find({ key: 'coo-pistes-where-repo' })).toBeDefined()
  await pane.unmount()
})

test('un choix hors forme alors que le projet a déjà sa liste (peut-être un « repo » abîmé) : ni la copie du poste ni celle du projet ne s’écrivent', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  putChoiceText(w, '{"v":1,"where":"re')
  const there = JSON.stringify(listWith([piste('retroA/p1', { text: 'Version du projet' })], '.'))
  w.files['travail/pistes-retros.json'] = there
  await cooWith($, clock, w, [piste('retroA/p1')])
  expect(await call($, { pistes: [{ op: 'comment', piste: 'retroA/p1', text: 'Voir' }] })).toMatch(/waiting in the box/)
  await settle(clock, 6)
  expect(pistesOf(posteOf(w))[0]!.comments).toEqual([])
  expect(repoOf(w)).toBeUndefined()
  expect(w.files['travail/pistes-retros.json']).toBe(there)
  const said = await statement($)
  expect(said).toMatch(/The retro waitlist could not be read/)
  // Le relevé nomme le choix hors forme : la personne peut le retirer à la main pour être de nouveau interrogée.
  expect(said).toMatch(/The choice of where the retro waitlist lives \(« [^»]*endroit[^»]* »\) is out of form/)
})

test('une commande du shell lancée avant le clic, la liste encore sur le poste : la copie vers le projet attend qu’elle finisse', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  let release = () => {}
  const held = new Promise<void>(r => (release = r))
  on('tool.call', { tool: 'Bash' }, async () => {
    await held
    return { result: 'ok' } as any
  })
  await cooWith($, clock, w, [piste('retroA/p1')])
  const pulling = $.tool.call({ tool: 'Bash', command: 'git pull --ff-only' } as any)
  await settle(clock, 1)
  await press($, clock, 'coo-pistes-where-repo')
  expect(w.toasts.join('\n')).toMatch(/une commande du shell tourne dans cette discussion/)
  expect(repoOf(w)).toBeUndefined()
  expect(choiceOf(w)).toBeUndefined()
  release()
  await pulling
  await press($, clock, 'coo-pistes-where-repo')
  expect(choiceOf(w)).toEqual(expect.objectContaining({ where: 'repo' }))
  expect(pistesOf(repoOf(w)!).map(p => p.id)).toEqual(['retroA/p1'])
})

test('une feuille de route commitée ne change pas le choix de la liste : elle reste sur le poste, la question reste', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  // L'état de la feuille de route : « repo », au fichier du poste et dans le stockage.
  w.files[`flow-board/coordination/${PROJECT}.feuille-de-route.json`] = JSON.stringify({ root: '', where: 'repo', seen: {} })
  w.mem['coo-roadmap:'] = { root: '', where: 'repo', seen: {} }
  await cooWith($, clock, w, [piste('retroA/p1')])
  expect(await call($, { pistes: [{ op: 'comment', piste: 'retroA/p1', text: 'Voir' }] })).toMatch(/applied/)
  expect(repoOf(w)).toBeUndefined()
  expect(pistesOf(posteOf(w))[0]!.comments).toHaveLength(1)
  expect(choiceOf(w)).toBeUndefined()
  const pane = await mount($)
  expect(await pane.find({ key: 'coo-pistes-where-repo' })).toBeDefined()
  await pane.unmount()
})

test('après un `git pull`, la liste du projet ne porte plus une piste déjà vue : rien n’est écrit par-dessus, sa copie est mise de côté, le relevé dit de s’arrêter', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [piste('retroA/p1'), piste('retroA/p2')])
  await press($, clock, 'coo-pistes-where-repo')
  // L'autre poste a écrasé la liste : p1 n'y est plus.
  const pulled = JSON.stringify(listWith([piste('retroA/p2')], '.'))
  w.files[REPO] = pulled
  await settle(clock, 6)
  expect(await call($, { pistes: [{ op: 'comment', piste: 'retroA/p2', text: 'Voir' }] })).toMatch(/waiting in the box/)
  await settle(clock, 6)
  expect(w.files[REPO]).toBe(pulled)
  expect(Object.values(w.asides)).toContain(pulled)
  // Une liste qui a perdu une piste vue ne se commite pas : le relevé ne le demande plus.
  expect(await statement($)).not.toMatch(/commit it by its path/)
  // La copie mise de côté reste sur le poste, jamais dans le projet.
  expect(Object.keys(w.asides).some(k => k.includes('/travail/'))).toBe(false)
  expect(await statement($)).toMatch(/no longer holds pistes already seen \(« retroA\/p1 »\)/)
})

test('une liste du poste qui a perdu une piste déjà vue ne part jamais dans le projet : le passage est refusé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [piste('retroA/p1'), piste('retroA/p2')])
  putPoste(w, [piste('retroA/p2')])
  await settle(clock, 6)
  await press($, clock, 'coo-pistes-where-repo')
  expect(w.toasts.join('\n')).toMatch(/a perdu des pistes déjà vues ; elle ne part pas dans le projet/)
  expect(repoOf(w)).toBeUndefined()
  expect(choiceOf(w)).toBeUndefined()
})

test('le passage au projet quand le projet a déjà sa liste : accepté si chaque piste et chaque marque d’ici y sont telles quelles, refusé sinon, rien d’écrasé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const other = JSON.stringify(listWith([piste('retroB/q1')], '.'))
  w.files['travail/pistes-retros.json'] = other
  await cooWith($, clock, w, [piste('retroA/p1')])
  await press($, clock, 'coo-pistes-where-repo')
  expect(w.toasts.join('\n')).toMatch(/Rien n’est changé : la liste du projet \(travail\/pistes-retros\.json\) ne porte pas chaque piste/)
  expect(choiceOf(w)).toBeUndefined()
  expect(w.files['travail/pistes-retros.json']).toBe(other)
  expect(w.files[REPO]).toBeUndefined()
  // L'autre poste a déjà commité une liste qui porte p1 telle quelle, et une piste à lui : le passage se fait.
  const superset = JSON.stringify(listWith([piste('retroA/p1'), piste('retroB/q1')], '.'))
  w.files['travail/pistes-retros.json'] = superset
  await press($, clock, 'coo-pistes-where-repo')
  expect(choiceOf(w)).toEqual(expect.objectContaining({ where: 'repo' }))
  expect(pistesOf(JSON.parse(w.files[REPO] ?? superset)).map(p => p.id)).toEqual(['retroA/p1', 'retroB/q1'])
})

test('dans le projet, une marque d’une discussion de l’autre poste n’est jamais libérée ici : son opération ne se rejoue pas là-bas', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [piste('retroA/p1')])
  await press($, clock, 'coo-pistes-where-repo')
  // L'autre poste a appliqué l'opération o1 de sa discussion « session-pc » ; sa boîte n'est pas sur ce poste.
  const pulled = { ...repoOf(w)!, applied: ['session-pc/oaaaaaa01'] }
  w.files[REPO] = JSON.stringify(pulled)
  await settle(clock, 6)
  expect(await call($, { pistes: [{ op: 'comment', piste: 'retroA/p1', text: 'Voir' }] })).toMatch(/applied/)
  // La marque de l'opération d'ici, posée avec son effet.
  expect(repoOf(w)!.applied.some(m => m.startsWith('session-A/'))).toBe(true)
  await settle(clock, 140)
  // Sa boîte vidée, elle se libère ; celle de l'autre poste reste.
  expect(repoOf(w)!.applied).toEqual(['session-pc/oaaaaaa01'])
})

test('une commande du shell de cette discussion (le `git pull` du COO) : le mod n’écrit pas la liste du projet tant qu’elle tourne, puis applique sur ce qu’elle a ramené', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  let release = () => {}
  const held = new Promise<void>(r => (release = r))
  on('tool.call', { tool: 'Bash' }, async () => {
    await held
    // Le pull ramène la piste de l'autre poste.
    const now = repoOf(w)!
    w.files[REPO] = JSON.stringify({ ...now, pistes: [...now.pistes, piste('retroB/q1')] })
    return { result: 'ok' } as any
  })
  await cooWith($, clock, w, [piste('retroA/p1')])
  await press($, clock, 'coo-pistes-where-repo')
  const before = w.files[REPO]
  const pulling = $.tool.call({ tool: 'Bash', command: 'git pull --ff-only' } as any)
  await settle(clock, 1)
  expect(await call($, { pistes: [{ op: 'comment', piste: 'retroA/p1', text: 'Voir' }] })).toMatch(/waiting in the box/)
  await settle(clock, 6)
  expect(w.files[REPO]).toBe(before)
  release()
  await pulling
  await settle(clock, 6)
  const list = repoOf(w)!
  expect(pistesOf(list).map(p => p.id)).toEqual(['retroA/p1', 'retroB/q1'])
  expect(pistesOf(list)[0]!.comments).toEqual([expect.objectContaining({ text: 'Voir' })])
})

test('sur le second poste, une liste déjà commitée dans le projet : la question paraît sans liste d’ici, le relevé le dit, et « Commiter dans travail/ » la prend telle quelle', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const there = JSON.stringify(listWith([piste('retroB/q1')], '.'))
  w.files['travail/pistes-retros.json'] = there
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await mount($)
  expect(await pane.find({ key: 'coo-pistes-where-repo' })).toBeDefined()
  await pane.unmount()
  expect(await statement($)).toMatch(/A retro waitlist file exists in this project/)
  await press($, clock, 'coo-pistes-where-repo')
  expect(choiceOf(w)).toEqual(expect.objectContaining({ where: 'repo' }))
  expect(await call($, { pistes: [{ op: 'comment', piste: 'retroB/q1', text: 'Vu' }] })).toMatch(/applied/)
  expect(pistesOf(repoOf(w)!)[0]!.comments).toEqual([expect.objectContaining({ text: 'Vu' })])
})

test('la liste du projet changée entre sa relecture et l’écriture (un `git pull` de l’autre poste) : rien n’est écrit par-dessus, aucune piste de l’autre poste ne se perd', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await cooWith($, clock, w, [piste('retroA/p1')])
  await press($, clock, 'coo-pistes-where-repo')
  // À chaque relecture du fichier des missions (au début et juste avant l'écriture de la liste), l'autre poste
  // ajoute une piste à la liste du projet.
  let n = 0
  const pulls: string[] = []
  w.probe.onBoardRead = () => {
    const now = repoOf(w)!
    const id = `retroB/q${n++}`
    pulls.push(id)
    w.files[REPO] = JSON.stringify({ ...now, pistes: [...now.pistes, piste(id)] })
  }
  await call($, { pistes: [{ op: 'comment', piste: 'retroA/p1', text: 'Voir' }] })
  w.probe.onBoardRead = undefined
  await settle(clock, 12)
  expect(pulls.length).toBeGreaterThan(1)
  const ids = pistesOf(repoOf(w)!).map(p => p.id)
  for (const id of pulls) expect(ids).toContain(id)
  expect(pistesOf(repoOf(w)!).find(p => p.id === 'retroA/p1')!.comments).toEqual([expect.objectContaining({ text: 'Voir' })])
})
