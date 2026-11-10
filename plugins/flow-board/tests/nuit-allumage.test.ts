// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { NIGHT_MS, parseNight, parseNightLog } from '../hooks/night.ts'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, stored, world, writeBoard, type World } from './monde-coordination.ts'

// La surveillance de nuit : allumage par « 🌙 Surveillance de nuit » puis « Confirmer », ou par
// `/flow-board:nuit` tapé ; arrêt par « Arrêter », un message de la personne, l'heure de fin, la perte du siège,
// la fin ou le vidage de la discussion du COO. Invariant : « Hors d'une surveillance allumée par Mathis et
// encore valide, aucun geste ne part sans son clic ; […] une lecture ratée de la surveillance vaut éteinte. »

const T0 = 500_000_000
const NIGHT = 'flow-board:nuit'

/** L'enregistrement de la surveillance tel qu'écrit : au fichier à côté de celui de coordination, sinon dans `$.store`. */
const nightText = (w: World): string | undefined => {
  const path = Object.keys(w.files).find(p => p.endsWith('.nuit.json'))
  if (path) return w.files[path]
  const key = Object.keys(w.mem).find(k => k.startsWith('coo-night:'))
  return key ? JSON.stringify(w.mem[key]) : undefined
}
const night = (w: World) => (nightText(w) === undefined ? { state: 'absent' } : parseNight(nightText(w)!, ''))
/** Les lignes du journal, d'où qu'elles soient écrites. */
const journal = (w: World): any[] => {
  const path = Object.keys(w.files).find(p => p.endsWith('.nuit-journal.jsonl'))
  const key = Object.keys(w.mem).find(k => k.startsWith('coo-night-log:'))
  const text = path ? w.files[path] : key ? String(w.mem[key]) : ''
  const read = parseNightLog(text ?? '')
  return read.state === 'read' ? read.lines.map(l => JSON.parse(l)) : []
}
const texts = async (tree: any): Promise<string> => ((await tree.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')

const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  const button = await pane.find({ key })
  if (button) await pane.press({ key })
  await pane.unmount()
  return button
}

/** Allume par les deux clics de la vue Coordination. */
const lightByClick = async ($: any, clock: any) => {
  expect(await press($, 'coo-night-ask')).toBeDefined()
  expect(await press($, 'coo-night-confirm')).toBeDefined()
  await settle(clock, 1)
}

/**
 * `/flow-board:nuit` tapé, comme le moteur l'émet (docs/evenements-moteur.md) : `prompt.submit` avec la commande,
 * le chargement du skill, puis le `turn.start` du tour, dont le texte n'est pas celui du message ; enfin l'appel de
 * l'outil que le skill fait faire.
 */
const openNightTurn = async ($: any, origin: unknown = { kind: 'composer' }) => {
  await $.prompt.submit({ text: '/flow-board:nuit', origin, command: { name: NIGHT, args: '' } } as any)
  await $.skill.prompt({ skill: NIGHT, text: 'consignes de la nuit' } as any)
  await $.turn.start({ turnId: 'nuit', text: '<command-message>flow-board:nuit</command-message>' } as any)
}
const typeNight = async ($: any, origin: unknown = { kind: 'composer' }) => {
  await openNightTurn($, origin)
  return String(((await $.tool.call({ tool: TOOL, coordinate: { nightOn: true } } as any)) as any).result)
}
const endTurn = ($: any, turnId = 'nuit') => $.turn.complete({ answer: 'Fait.', durationMs: 10, isAborted: false, turnId, reason: 'answer' })

const openSeat = async ($: any, on: any) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  writeBoard(w, b => b)
  await start($)
  await openCoo($, clock)
  return { clock, w }
}

test('« 🌙 Surveillance de nuit » puis « Confirmer » l’allume pour 12 heures ; le bandeau la montre avec « Arrêter »', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  // « Annuler » ne fait rien.
  await press($, 'coo-night-ask')
  expect(await press($, 'coo-night-cancel')).toBeDefined()
  expect(night(w).state).toBe('absent')
  await lightByClick($, clock)
  const read = night(w) as any
  expect(read.state).toBe('read')
  expect(read.watch).toMatchObject({ by: 'session-A', how: 'click', seatAt: stored(w).coo!.at })
  expect(read.watch.until - read.watch.at).toBe(NIGHT_MS)
  expect(journal(w)).toEqual([expect.objectContaining({ act: 'start', watch: read.watch.id })])
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} } })
  expect(await texts(band)).toMatch(/🌙\sSurveillance de nuit · jusqu’à \d\d:\d\d/)
  expect(await band.find({ key: 'band-night-stop' })).toBeDefined()
  await band.unmount()
  // Le bouton d'allumage n'est plus là : la vue montre « Arrêter ».
  expect(await press($, 'coo-night-ask')).toBeUndefined()
  expect(await press($, 'coo-night-stop')).toBeDefined()
  await settle(clock, 1)
  expect(night(w)).toMatchObject({ state: 'off', last: { id: read.watch.id, why: 'button' } })
  expect(journal(w).map(l => l.act)).toEqual(['start', 'stop'])
})

test('`/flow-board:nuit` tapé l’allume dans son tour ; un appel hors de ce tour, ou une commande lancée par un mod, est refusé', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  // Sans la commande : refusé.
  expect(String(((await $.tool.call({ tool: TOOL, coordinate: { nightOn: true } } as any)) as any).result)).toMatch(/only in the turn opened by \/flow-board:nuit/)
  // Lancée par un mod : refusé.
  expect(await typeNight($, { kind: 'plugin', name: 'flow-board' })).toMatch(/only in the turn opened by \/flow-board:nuit/)
  await endTurn($)
  expect(night(w).state).toBe('absent')
  // Tapée : allumée.
  expect(await typeNight($)).toMatch(/Night watch on until/)
  expect((night(w) as any).watch).toMatchObject({ how: 'command' })
  // Un second appel dans le même tour : déjà allumée, rien n'est remplacé.
  const id = (night(w) as any).watch.id
  expect(String(((await $.tool.call({ tool: TOOL, coordinate: { nightOn: true } } as any)) as any).result)).toMatch(/already on/)
  expect((night(w) as any).watch.id).toBe(id)
  await endTurn($)
  // Le tour fini : un appel de plus est refusé, la surveillance reste.
  await settle(clock, 1)
  expect(String(((await $.tool.call({ tool: TOOL, coordinate: { nightOn: true } } as any)) as any).result)).toMatch(/only in the turn opened by \/flow-board:nuit/)
  expect((night(w) as any).state).toBe('read')
})

test('un message tapé pendant le tour de la commande, avant l’appel, annule l’allumage', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await openSeat($, on)
  await openNightTurn($)
  await $.prompt.submit({ text: 'non, attends', origin: { kind: 'composer' }, turnId: 'nuit' } as any)
  expect(String(((await $.tool.call({ tool: TOOL, coordinate: { nightOn: true } } as any)) as any).result)).toMatch(/only in the turn opened by \/flow-board:nuit/)
  expect(night(w).state).toBe('absent')
})

test('un message de la personne l’arrête ; un tour du mod, un message d’une autre session ou une notification non', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  await lightByClick($, clock)
  for (const origin of [{ kind: 'plugin', name: 'flow-board' }, { kind: 'peer' }, { kind: 'peer-send-message' }, { kind: 'task-notification' }]) {
    await $.prompt.submit({ text: 'x', origin } as any)
    expect(night(w).state).toBe('read')
  }
  await $.prompt.submit({ text: 'bonjour', origin: { kind: 'composer' } } as any)
  expect(night(w)).toMatchObject({ state: 'off', last: { why: 'person' } })
  expect(journal(w).map(l => [l.act, l.why])).toEqual([
    ['start', 'clic « Confirmer »'],
    ['stop', 'message de la personne'],
  ])
})

test('l’heure de fin l’éteint ; la vue revient au bouton d’allumage', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  await lightByClick($, clock)
  // L'horloge du faux moteur n'avance pas de 12 heures d'un coup : la même surveillance, à 2 s de sa fin.
  const lit = (night(w) as any).watch
  const ending = JSON.stringify({ ...lit, at: lit.at - NIGHT_MS + 2000, until: lit.at + 2000 })
  const path = Object.keys(w.files).find(p => p.endsWith('.nuit.json'))
  if (path) w.files[path] = ending
  else w.mem[Object.keys(w.mem).find(k => k.startsWith('coo-night:'))!] = JSON.parse(ending)
  await settle(clock, 7)
  expect(night(w)).toMatchObject({ state: 'off', last: { why: 'ended' } })
  expect(await press($, 'coo-night-ask')).toBeDefined()
})

test('le /clear de la discussion du COO l’arrête', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  await lightByClick($, clock)
  await $.session.end({ reason: 'clear' } as any)
  expect(night(w)).toMatchObject({ state: 'off', last: { why: 'clear' } })
})

test('la fin de la discussion du COO l’arrête, avant de libérer le siège', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  await lightByClick($, clock)
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  expect(night(w)).toMatchObject({ state: 'off', last: { why: 'closed' } })
  expect(stored(w).coo?.releasedAt).toBeDefined()
})

test('la perte du siège : la surveillance ne vaut plus, et l’ancien titulaire n’écrit plus rien', { timeoutMs: 30000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  await lightByClick($, clock)
  const before = nightText(w)
  writeBoard(w, b => ({ ...b, coo: { by: 'session-Z', at: T0 + 10_000, seenAt: T0 + 10_000 } }))
  await settle(clock, 6)
  // La vue ne la montre plus allumée ; l'enregistrement n'est pas réécrit par une discussion qui n'a plus le siège.
  expect(nightText(w)).toBe(before)
  await $.prompt.submit({ text: 'bonjour', origin: { kind: 'composer' } } as any)
  expect(nightText(w)).toBe(before)
})

test('un enregistrement illisible : éteinte, et rien ne s’écrit par-dessus au clic', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  await lightByClick($, clock)
  const path = Object.keys(w.files).find(p => p.endsWith('.nuit.json'))
  const key = Object.keys(w.mem).find(k => k.startsWith('coo-night:'))
  if (path) w.files[path] = '{"v":1,"id":"n'
  else w.mem[key!] = 'coupé'
  await settle(clock, 6)
  expect(await press($, 'coo-night-ask')).toBeDefined()
  await press($, 'coo-night-confirm')
  await settle(clock, 1)
  expect(night(w).state).toBe('unread')
  expect(w.toasts.join('\n')).toMatch(/Surveillance de nuit illisible/)
})

test('un tour qui commence sans le chargement du skill (une notification en file) n’allume pas', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await openSeat($, on)
  await $.prompt.submit({ text: '/flow-board:nuit', origin: { kind: 'composer' }, command: { name: NIGHT, args: '' } } as any)
  await $.turn.start({ turnId: 'autre', text: '<task-notification>fini</task-notification>' } as any)
  await $.skill.prompt({ skill: NIGHT, text: 'consignes de la nuit' } as any)
  expect(String(((await $.tool.call({ tool: TOOL, coordinate: { nightOn: true } } as any)) as any).result)).toMatch(/only in the turn opened by \/flow-board:nuit/)
  expect(night(w).state).toBe('absent')
})

test('« Arrêter » vaut aussi pendant un tour du COO', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  await lightByClick($, clock)
  await $.turn.start({ turnId: 't1', text: 'travail' } as any)
  expect(await press($, 'coo-night-stop')).toBeDefined()
  expect(night(w)).toMatchObject({ state: 'off', last: { why: 'button' } })
  expect(w.toasts.join('\n')).toMatch(/Surveillance de nuit arrêtée/)
})

test('un arrêt qui ne s’écrit pas le dit, sans prétendre qu’aucune surveillance n’était allumée', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  await lightByClick($, clock)
  const before = nightText(w)
  // L'écriture de l'enregistrement échoue (fichier ou `$.store`).
  const refused = Promise.reject(new Error('EROFS'))
  refused.catch(() => undefined)
  w.probe.holdNight = refused
  await press($, 'coo-night-stop')
  expect(w.toasts.join('\n')).toMatch(/L’arrêt de la surveillance de nuit n’a pas pu s’écrire/)
  expect(nightText(w)).toBe(before)
  expect(night(w).state).toBe('read')
})


test('le premier clic d’allumage ne survit pas à un allumage ou à un arrêt d’ailleurs : « Confirmer » redemande le premier clic', { timeoutMs: 20000 }, async ($, on) => {
  const { w } = await openSeat($, on)
  await press($, 'coo-night-ask')
  await typeNight($)
  await endTurn($)
  await $.prompt.submit({ text: 'bonjour', origin: { kind: 'composer' } } as any)
  expect(night(w).state).toBe('off')
  expect(await press($, 'coo-night-confirm')).toBeUndefined()
  expect(await press($, 'coo-night-ask')).toBeDefined()
})

test('un allumage dont l’écriture tarde au-delà de 15 s ne se pose jamais après un arrêt demandé ensuite', { timeoutMs: 40000 }, async ($, on) => {
  const { clock, w } = await openSeat($, on)
  let release = () => {}
  w.probe.holdNight = new Promise<void>(resolve => (release = resolve))
  await press($, 'coo-night-ask')
  const clicked = press($, 'coo-night-confirm')
  await settle(clock, 16)
  await clicked
  expect(w.toasts.join('\n')).toMatch(/non allumée : l’écriture a échoué/)
  // La personne écrit : son arrêt attend l'allumage réel, qui se pose ensuite.
  const said = $.prompt.submit({ text: 'finalement non', origin: { kind: 'composer' } } as any)
  await settle(clock, 2)
  w.probe.holdNight = undefined
  release()
  await settle(clock, 16)
  await said
  await settle(clock, 2)
  expect(night(w)).toMatchObject({ state: 'off', last: { why: 'person' } })
  expect(journal(w).map(l => l.act)).toEqual(['start', 'stop'])
})
