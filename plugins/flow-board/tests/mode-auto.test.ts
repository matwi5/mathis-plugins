// Mode auto d'un parcours : son état (« allumé à », « allumé par », « éteint à », raison), sa fusion
// entre deux copies du board, le bouton « ⚡ Auto » et le bandeau. Invariant : le mode auto n'est
// jamais allumé sans le second clic de l'utilisateur ; une fusion, une reconstruction ou une
// lecture ratée du fichier de parcours le laisse éteint ou l'éteint, jamais l'inverse.

import { expect, mock, test } from 'claude-code/testing'

import { applyReport, archiveRun, autoStateOf, clampFuture, emptyBoard, finishActive, isAutoOn, mergeBoards, newRun, openRun, parkActive, resumeRun, setAsideActive, stopAutoUnread, switchOffAuto, switchOnAuto } from '../hooks/model.ts'
import type { Board, Run } from '../types'

const T0 = 90_000_000

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 140, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const SURFACES = ['terminal', 'desktop'] as const

/** Le fichier commun des parcours, quel que soit le dossier d'où le mod est lancé. */
const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')

/**
 * Le moteur sous le plugin : le board s'enregistre dans le fichier commun quand le dossier du mod dit
 * où est ~/.claude (`disk`), dans `$.store` sinon (`mem`, clé `board:`) ; l'id de la discussion, que
 * le test change pour jouer un `/clear` (`ids.now`) ; et une lecture du board que le test fait rater
 * (`unreadable.board`) : le fichier comme le stockage répondent une erreur.
 */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const disk: { board?: string; isUsed: boolean } = { isUsed: false }
  const ids = { now: 'sa' }
  const unreadable = { board: false, file: false }
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: ids.now }))
  on('store.get', (_$: unknown, e: { key: string }) => {
    if (unreadable.board && e.key === 'board:') throw new Error('EIO')
    return { value: mem[e.key] }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isBoardFile(e.path) ? disk.board !== undefined : e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      if (unreadable.board || unreadable.file || disk.board === undefined) throw new Error(`EIO ${e.path}`)
      return { value: disk.board } as any
    }
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBoardFile(e.path)) {
      disk.isUsed = true
      disk.board = e.text
    } else files[e.path] = e.text
    return { value: undefined } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: ids.now }))
  on('command.list', () => ({ value: [] }))
  on('prompt.fill', () => ({ isFilled: true }))
  return { mem, disk, ids, unreadable }
}
type World = ReturnType<typeof world>
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })
const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
/** Le board enregistré : dans le fichier commun s'il sert, sinon dans `$.store`. */
const storedBoard = (w: Pick<World, 'mem' | 'disk'>): Board => (w.disk.isUsed && w.disk.board !== undefined ? JSON.parse(w.disk.board) : w.mem['board:']) as Board
const storedRun = (w: Pick<World, 'mem' | 'disk'>): Run => storedBoard(w).runs[0]!
/** Pose une valeur enregistrée, au fichier commun comme dans `$.store`. */
const seed = (w: Pick<World, 'mem' | 'disk'>, value: unknown) => {
  w.mem['board:'] = value
  w.disk.board = JSON.stringify(value)
}

/** Le texte du bandeau, sur une surface. */
const bandText = async ($: any, surface: (typeof SURFACES)[number]): Promise<string> => {
  const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
  const texts = (await band.findAll({ type: 'Text' })).map((t: any) => String(t.text ?? '')).join(' | ')
  await band.unmount()
  return texts
}
const bandKeys = async ($: any, surface: (typeof SURFACES)[number]): Promise<string[]> => {
  const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
  const keys = (await band.findAll({ type: 'Button' })).map((b: any) => String(b.key ?? b.props.key))
  await band.unmount()
  return keys
}
const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key })
  await pane.unmount()
}

/** Un parcours en phase Tickets (sa carte « Ensuite » propose une suite), actif dans la discussion « sa ». */
const running = async ($: any, on: any, now: number) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', tickets: [{ id: 't1', name: 'Un' }] } as any)
  return { clock, ...w }
}

test('« ⚡ Auto » : le premier clic montre ce que l’activation vaut, « Confirmer » l’allume pour cette discussion, le bandeau le dit sur les deux surfaces sans perdre son bouton, un clic le coupe', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, ...w } = await running($, on, T0)
  const keysBefore = await bandKeys($, 'desktop')
  // Premier clic : le texte de ce que l'activation vaut, les six catégories, « Confirmer » ; rien d'allumé.
  await press($, 'auto-on')
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await pane.find({ type: 'Text', text: /Allumer le mode auto de ce parcours/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /validations à boutons.*écritures Asana/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^6\.$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /effort xhigh/ })).toBeDefined()
    expect((await pane.find({ key: 'auto-confirm' }))?.props.label).toBe('Confirmer')
    await pane.unmount()
  }
  expect(await bandText($, 'desktop')).not.toMatch(/⚡\sAuto/)
  await settle(clock, 1)
  expect(storedRun(w).auto).toBeUndefined()
  // Second clic : allumé, par cette discussion, et le bandeau le dit ; ses boutons ne changent pas.
  await press($, 'auto-confirm')
  await settle(clock, 1)
  expect(storedRun(w).auto).toMatchObject({ onAt: expect.any(Number), onBy: 'sa' })
  for (const surface of SURFACES) expect(await bandText($, surface)).toMatch(/⚡\sAuto\s·\sen\scours/)
  expect(await bandKeys($, 'desktop')).toEqual(keysBefore)
  // Un clic sur le même bouton (« Couper l'auto ») l'éteint, sans confirmation.
  await press($, 'auto-off')
  await settle(clock, 1)
  expect(storedRun(w).auto).toMatchObject({ offWhy: 'coupé par toi' })
  expect(storedRun(w).auto!.offAt!).toBeGreaterThan(storedRun(w).auto!.onAt!)
  for (const surface of SURFACES) expect(await bandText($, surface)).not.toMatch(/⚡\sAuto/)
})

test('« Annuler » laisse l’auto éteint et referme la confirmation', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, ...w } = await running($, on, T0)
  await press($, 'auto-on')
  await press($, 'auto-cancel')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'auto-confirm' })).toBeUndefined()
  expect(await pane.find({ key: 'auto-on' })).toBeDefined()
  await pane.unmount()
  await settle(clock, 1)
  expect(storedRun(w).auto).toBeUndefined()
})

test('Après un /clear (nouvel id de discussion), l’auto est en pause « discussion changée » ; après /reload-plugins, il est tel quel', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, ids } = await running($, on, T0)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  // /reload-plugins : le mod redémarre, l'état reste.
  await start($)
  for (const surface of SURFACES) expect(await bandText($, surface)).toMatch(/⚡\sAuto\s·\sen\scours/)
  // /clear : la discussion prend un nouvel id, sans recharger le mod.
  await $.session.end({ reason: 'clear' } as any)
  ids.now = 'sa-apres-clear'
  await settle(clock, 1)
  for (const surface of SURFACES) expect(await bandText($, surface)).toMatch(/⚡\sAuto\sen\spause\s:\sdiscussion\schangée/)
  // Deux clics le rallument pour la discussion d'après le /clear.
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'auto-on' })).toBeDefined()
  await pane.unmount()
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  expect(await bandText($, 'terminal')).toMatch(/⚡\sAuto\s·\sen\scours/)
})

test('Un parcours dont la discussion porteuse a planté garde l’auto allumé, en pause ; repris ici, il ne repart pas sans deux clics, et un clic le coupe', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60_000 })
  const w = world(on)
  // Le parcours d'une discussion morte (pas d'événement de fin) : actif, vieux de plus de 30 min, allumé par elle.
  const run: Run = { ...newRun('implement', T0 - 3_600_000, 'Orphelin'), owner: 'morte', updatedAt: T0 - 3_600_000, auto: { onAt: T0 - 3_600_000, onBy: 'morte' } }
  seed(w, { ...emptyBoard('', 'p'), session: 'morte', deleted: [], runs: [run], activeId: run.id })
  await start($)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    expect(await pane.find({ type: 'Text', text: /⚡\sAuto en pause : parcours en pause/ })).toBeDefined()
    await pane.unmount()
  }
  // Repris dans cette discussion : la pause se déduit (« discussion changée ») ; les deux boutons sont là.
  await press($, `resume-${run.id}`)
  for (const surface of SURFACES) expect(await bandText($, surface)).toMatch(/⚡\sAuto\sen\spause\s:\sdiscussion\schangée/)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ key: 'auto-on' })).toBeDefined()
  expect(await pane.find({ key: 'auto-off' })).toBeDefined()
  await pane.unmount()
  // Un clic le coupe, d'ici.
  await press($, 'auto-off')
  await settle(clock, 1)
  expect(storedRun(w).auto).toMatchObject({ offWhy: 'coupé par toi' })
  expect(await bandText($, 'terminal')).not.toMatch(/⚡\sAuto/)
})

test('Allumé, le bandeau garde le bouton de l’étape suivante à toute largeur où il l’avait : la pastille de l’auto se coupe d’abord', { timeoutMs: 20000 }, async ($, on) => {
  await running($, on, T0)
  // L'étape finie : le bandeau propose la suite.
  await $.tool.call({ tool: TOOL, complete: true } as any)
  const BAND_AT = (bodyColumns: number) => ({ ...BAND, props: { ...BAND.props, bodyColumns } })
  const keysAt = async (surface: (typeof SURFACES)[number], width: number): Promise<string[]> => {
    const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND_AT(width) })
    const keys = (await band.findAll({ type: 'Button' })).map((b: any) => String(b.key ?? b.props.key))
    await band.unmount()
    return keys
  }
  const widths = [50, 64, 72, 90, 120]
  const before = new Map<string, string[]>()
  for (const surface of SURFACES) for (const width of widths) before.set(`${surface}${width}`, await keysAt(surface, width))
  expect(before.get('desktop120')!.length).toBeGreaterThan(2)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  for (const surface of SURFACES) for (const width of widths) expect(await keysAt(surface, width)).toEqual(before.get(`${surface}${width}`)!)
})

test('Une lecture ratée du stockage avant une sauvegarde éteint l’auto (« lecture du parcours ratée ») au lieu d’écraser une coupure faite ailleurs', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, ...w } = await running($, on, T0)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  expect(storedRun(w).auto?.offAt).toBeUndefined()
  // La lecture du board rate (le stockage répond une erreur) : la sauvegarde suivante éteint l'auto.
  w.unreadable.board = true
  await $.tool.call({ tool: TOOL, note: 'un pas' } as any)
  await settle(clock, 1)
  expect(storedRun(w).auto).toMatchObject({ offWhy: 'lecture du parcours ratée' })
  for (const surface of SURFACES) expect(await bandText($, surface)).toMatch(/⚡\sAuto\sen\spause\s:\slecture\sdu\sparcours\sratée/)
  // Relu de nouveau, l'auto reste éteint jusqu'au prochain second clic.
  w.unreadable.board = false
  await $.tool.call({ tool: TOOL, note: 'un autre pas' } as any)
  await settle(clock, 1)
  expect(isAutoOn(storedRun(w))).toBe(false)
})

test('Le fichier commun illisible et une copie de secours où l’auto est rallumé : ce qui s’écrit a l’auto éteint', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, ...w } = await running($, on, T0)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await press($, 'auto-off')
  await settle(clock, 1)
  // Sans fichier commun (le dossier du mod ne dit pas où est ~/.claude), pas de copie de secours :
  // le cas ne se joue que quand le board s'écrit dans le fichier (contrôles de tout le plugin).
  if (!w.disk.isUsed) return
  // Une copie de secours (`$.store`) porte un allumage plus récent que la coupure d'ici.
  const stale = storedBoard(w)
  w.mem['board:'] = { ...stale, runs: stale.runs.map(r => ({ ...r, auto: { onAt: (r.auto?.offAt ?? T0) + 5, onBy: 'sb' } })) }
  w.unreadable.file = true
  await $.tool.call({ tool: TOOL, note: 'un pas' } as any)
  await settle(clock, 1)
  w.unreadable.file = false
  expect(isAutoOn(storedRun(w))).toBe(false)
  expect(storedRun(w).auto).toMatchObject({ offWhy: 'lecture du parcours ratée' })
})

test('Une lecture ratée à la relecture périodique, sans aucune copie de secours, éteint aussi l’auto ; un clic efface la pause', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, ...w } = await running($, on, T0)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  // Le fichier et le stockage ne se lisent plus ; aucun appel ne fait sauvegarder : la relecture des 5 s le voit.
  w.unreadable.board = true
  await settle(clock, 6)
  for (const surface of SURFACES) expect(await bandText($, surface)).toMatch(/⚡\sAuto\sen\spause\s:\slecture\sdu\sparcours\sratée/)
  w.unreadable.board = false
  // La pause posée par le mod s'efface d'un clic : le bandeau n'en dit plus rien, l'auto reste éteint.
  await press($, 'auto-off')
  for (const surface of SURFACES) expect(await bandText($, surface)).not.toMatch(/⚡\sAuto/)
  await settle(clock, 1)
  expect(storedRun(w).auto).toMatchObject({ offWhy: 'coupé par toi' })
  expect(isAutoOn(storedRun(w))).toBe(false)
})

test('Une valeur relue qui n’est pas le board du projet compte comme une lecture ratée', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, ...w } = await running($, on, T0)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await settle(clock, 1)
  seed(w, { v: 1, abîmé: true })
  await $.tool.call({ tool: TOOL, note: 'un pas' } as any)
  await settle(clock, 1)
  expect(storedRun(w).auto).toMatchObject({ offWhy: 'lecture du parcours ratée' })
})

test('La fin de la discussion porteuse éteint l’auto (« discussion fermée ») ; un /clear ne pose rien', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, ...w } = await running($, on, T0)
  await press($, 'auto-on')
  await press($, 'auto-confirm')
  await $.session.end({ reason: 'clear' } as any)
  await settle(clock, 1)
  expect(storedRun(w).auto?.offAt).toBeUndefined()
  await $.session.end({ reason: 'prompt_input_exit' } as any)
  expect(storedRun(w).auto).toMatchObject({ offWhy: 'discussion fermée' })
})

/** La discussion A, où le parcours est actif, et la copie de la discussion B, faite au même instant. */
const twoCopies = () => {
  const run: Run = { ...newRun('implement', T0, 'Auto'), owner: 'sa' }
  const a: Board = { ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [run], activeId: run.id }
  const b: Board = { ...(JSON.parse(JSON.stringify(a)) as Board), session: 'sb', activeId: null }
  return { a, b }
}

const runOf = (board: Board): Run => board.runs[0]!
const isOn = (board: Board): boolean => autoStateOf(runOf(board), board, 'sa').kind === 'on'

test('Une copie en retard, auto allumé, ne rallume jamais une copie éteinte, dans les deux sens, prise en main comprise', () => {
  const { a } = twoCopies()
  const on = switchOnAuto(a, 'sa', T0 + 1)!.board
  expect(isOn(on)).toBe(true)
  // La copie de B, faite pendant que l'auto était allumé, puis touchée après la coupure d'ici : plus récente.
  const stale: Board = { ...(JSON.parse(JSON.stringify(on)) as Board), session: 'sb', activeId: null }
  const staleNewer: Board = { ...stale, runs: stale.runs.map(r => ({ ...r, status: 'paused' as const, owner: undefined, updatedAt: T0 + 9 })) }
  const off = switchOffAuto(on, T0 + 3)!.board
  expect(isOn(off)).toBe(false)
  // Ici, la copie la plus récente du reste du parcours (celle de B) gagnerait : pas l'auto.
  expect(isOn(mergeBoards(off, staleNewer))).toBe(false)
  expect(runOf(mergeBoards(off, staleNewer)).auto?.offAt).toBe(T0 + 3)
  // Dans l'autre sens (la discussion B fusionne la copie d'ici) : éteint aussi.
  expect(autoStateOf(runOf(mergeBoards(staleNewer, off)), mergeBoards(staleNewer, off), 'sa').kind).not.toBe('on')
  expect(runOf(mergeBoards(staleNewer, off)).auto?.offAt).toBe(T0 + 3)
  // Prise en main par une copie active de B, plus récente : la coupure d'ici revient sur elle.
  const takenOver: Board = { ...stale, runs: stale.runs.map(r => ({ ...r, status: 'active' as const, owner: 'sb', updatedAt: T0 + 9 })) }
  const taken = mergeBoards(off, takenOver)
  expect(taken.activeId).toBeNull()
  expect(runOf(taken).auto?.offAt).toBe(T0 + 3)
})

test('Chaque date prend la plus récente des deux copies : un nouveau second clic gagne sur une coupure plus ancienne, une coupure plus récente gagne sur un allumage', () => {
  const { a } = twoCopies()
  const off = switchOffAuto(switchOnAuto(a, 'sa', T0 + 1)!.board, T0 + 3)!.board
  // Rallumé plus tard dans la copie de B (B porte le parcours, son clic) : l'auto est allumé par B.
  const relit = switchOnAuto({ ...(JSON.parse(JSON.stringify(off)) as Board), session: 'sb' }, 'sb', T0 + 5)!.board
  const merged = mergeBoards(off, relit)
  expect(runOf(merged).auto).toMatchObject({ onAt: T0 + 5, onBy: 'sb', offAt: T0 + 3 })
  // Puis coupé ici après : la coupure la plus récente gagne, quel que soit l'ordre.
  const offAgain = switchOffAuto(merged, T0 + 7)!.board
  expect(runOf(mergeBoards(offAgain, relit)).auto?.offAt).toBe(T0 + 7)
  expect(runOf(mergeBoards(relit, offAgain)).auto?.offAt).toBe(T0 + 7)
})

test('Une date hors forme ne rallume jamais : un « éteint à » abîmé dans une copie éteint l’auto fusionné, un « allumé à » abîmé ne compte pas', () => {
  const { a } = twoCopies()
  const on = switchOnAuto(a, 'sa', T0 + 1)!.board
  const damaged = (auto: unknown): Board => ({ ...on, runs: on.runs.map(r => ({ ...r, auto, updatedAt: T0 + 2 }) as Run) })
  // « Éteint à » illisible dans la copie relue : éteint, quel que soit l'ordre.
  const badOff = damaged({ onAt: T0 + 1, onBy: 'sa', offAt: 'hier' })
  expect(isOn(badOff)).toBe(false)
  expect(isOn(mergeBoards(on, badOff))).toBe(false)
  expect(isOn(mergeBoards(badOff, on))).toBe(false)
  expect(runOf(mergeBoards(on, badOff)).auto?.offWhy).toBe('lecture du parcours ratée')
  // « Allumé à » illisible : jamais allumé, et la fusion ne le reprend pas.
  const badOn = damaged({ onAt: '2026', onBy: 'sa' })
  expect(isOn(badOn)).toBe(false)
  expect(isOn(mergeBoards(a, badOn))).toBe(false)
  // Un état qui n'est pas un objet : éteint.
  expect(isOn(damaged('oui'))).toBe(false)
  expect(isOn(damaged(true))).toBe(false)
  // Le second clic suivant rallume, après la date abîmée retirée.
  const relit = switchOnAuto(badOff, 'sa', T0 + 3)!.board
  expect(isOn(relit)).toBe(true)
  expect(typeof runOf(relit).auto?.offAt === 'string').toBe(false)
})

test('Une copie abîmée éteint l’auto fusionné, même face à un second clic plus récent de l’autre copie : sa coupure perdue a pu venir après ; le clic suivant rallume', () => {
  const { a } = twoCopies()
  const on = switchOnAuto(a, 'sa', T0 + 1)!.board
  // Le fichier : allumé à T0 + 1, puis coupé à une date devenue illisible (peut-être T0 + 300).
  const damaged: Board = { ...on, runs: on.runs.map(r => ({ ...r, auto: { onAt: T0 + 1, onBy: 'sa', offAt: 'hier' } }) as unknown as Run) }
  // Un second clic ici, à T0 + 5, avant de relire ce fichier.
  const relit = switchOnAuto(on, 'sb', T0 + 5)!.board
  for (const merged of [mergeBoards(relit, damaged), mergeBoards(damaged, relit)]) {
    expect(isAutoOn(runOf(merged))).toBe(false)
    expect(runOf(merged).auto).toMatchObject({ onAt: T0 + 5, offAt: T0 + 5, offWhy: 'lecture du parcours ratée' })
  }
  // L'état fusionné, écrit propre, ne retient plus le clic suivant.
  const written = mergeBoards(relit, damaged)
  const again = switchOnAuto(written, 'sb', T0 + 6)!.board
  expect(isAutoOn(runOf(mergeBoards(again, written)))).toBe(true)
  // Une copie abîmée sans « allumé à » lisible : éteint aussi.
  const undated: Board = { ...on, runs: on.runs.map(r => ({ ...r, auto: { offAt: 'hier' } }) as unknown as Run) }
  expect(isAutoOn(runOf(mergeBoards(relit, undated)))).toBe(false)
  expect(isAutoOn(runOf(mergeBoards(undated, relit)))).toBe(false)
})

test('Un parcours qui se termine (dernière phase finie, ou mis en pause tout fait) éteint l’auto, sans pause affichée : relancé, il ne repart pas sans un nouveau second clic', () => {
  const { a } = twoCopies()
  const on = switchOnAuto(a, 'sa', T0 + 1)!.board
  // Le lot fait et relu, le compte rendu validé, la livraison sautée : la dernière phase finie le termine.
  const lastPhase = applyReport(on, { fix: { phase: 'project:pr' } }, T0 + 2).board
  const finished = applyReport(lastPhase, { complete: true }, T0 + 3).board
  expect(runOf(finished).status).toBe('done')
  expect(runOf(finished).auto).toMatchObject({ offWhy: 'parcours terminé' })
  expect(autoStateOf(runOf(finished), finished, 'sa')).toEqual({ kind: 'off' })
  // Mis en pause tout fait par l'ouverture d'un autre parcours : terminé, éteint aussi.
  const allDone = applyReport(on, { fix: { phase: 'project:pr' } }, T0 + 2).board
  const doneRun = { ...runOf(allDone), phases: runOf(allDone).phases.map(p => ({ ...p, status: 'done' as const })) }
  const opened = openRun({ ...allDone, runs: [doneRun] }, { title: 'Autre' }, T0 + 4).board
  const shelved = opened.runs.find(r => r.id === doneRun.id)!
  expect(shelved.status).toBe('done')
  expect(isAutoOn(shelved)).toBe(false)
})

test('Un état auto abîmé autrement (pas un objet, « allumé à » illisible) éteint aussi l’auto fusionné, dans les deux sens', () => {
  const { a } = twoCopies()
  const on = switchOnAuto(a, 'sa', T0 + 1)!.board
  for (const auto of ['x', null, [], { onAt: '2026', offWhy: 'coupé par toi' }, { onAt: '2026' }]) {
    const damaged: Board = { ...on, runs: on.runs.map(r => ({ ...r, auto, updatedAt: T0 + 9 }) as Run) }
    expect(isAutoOn(runOf(mergeBoards(on, damaged)))).toBe(false)
    expect(isAutoOn(runOf(mergeBoards(damaged, on)))).toBe(false)
  }
})

test('Une date de l’auto dans le futur est ramenée à maintenant à la relecture : une coupure posée après elle l’emporte', () => {
  const { a } = twoCopies()
  const now = T0 + 1_000_000
  // Allumé à une date future (fichier retouché, horloge recalée), dans la copie relue.
  const ahead: Board = { ...a, runs: a.runs.map(r => ({ ...r, auto: { onAt: now + 600_000, onBy: 'sa' } })) }
  const clamped = clampFuture(ahead, now)
  expect(runOf(clamped).auto!.onAt).toBe(now)
  // Une coupure faite ici une seconde après, d'une copie qui ne l'avait pas vu : elle gagne la fusion.
  const cut: Board = { ...a, runs: a.runs.map(r => ({ ...r, auto: { onAt: T0, onBy: 'sa', offAt: now + 1_000, offWhy: 'parcours archivé' } })) }
  expect(isAutoOn(runOf(mergeBoards(cut, clamped)))).toBe(false)
  expect(isAutoOn(runOf(mergeBoards(clamped, cut)))).toBe(false)
  // La copie d'ici, allumée avant un recalage de l'horloge, est ramenée elle aussi avant la fusion (saveNow, pull).
  expect(isAutoOn(runOf(mergeBoards(clampFuture(ahead, now), cut)))).toBe(false)
  expect(isAutoOn(runOf(mergeBoards(ahead, cut)))).toBe(true)
  // Éteint avec des dates futures, il le reste une fois ramené.
  const offAhead: Board = { ...a, runs: a.runs.map(r => ({ ...r, auto: { onAt: now + 600_000, onBy: 'sa', offAt: now + 700_000, offWhy: 'coupé par toi' } })) }
  expect(isAutoOn(runOf(clampFuture(offAhead, now)))).toBe(false)
  // Le clic suivant rallume, à une date lisible.
  const relit = switchOnAuto(clampFuture(offAhead, now), 'sa', now + 1)!.board
  expect(isAutoOn(runOf(relit))).toBe(true)
})

test('Une raison relue hors de la liste se lit « raison inconnue », courte et sans caractère de contrôle', () => {
  const { a } = twoCopies()
  const off = (offWhy: unknown): Board => ({ ...a, runs: a.runs.map(r => ({ ...r, auto: { onAt: T0, onBy: 'sa', offAt: T0 + 1, offWhy } }) as unknown as Run) })
  expect(autoStateOf(runOf(off('x'.repeat(2000))), off(''), 'sa')).toEqual({ kind: 'paused', why: 'raison inconnue' })
  expect(autoStateOf(runOf(off('discussion\nfermée')), off(''), 'sa')).toEqual({ kind: 'paused', why: 'discussion fermée' })
  expect(autoStateOf(runOf(off('discussion fermée')), off(''), 'sa')).toEqual({ kind: 'paused', why: 'discussion fermée' })
  expect(autoStateOf(runOf(off(42)), off(''), 'sa')).toEqual({ kind: 'off' })
})

test('Un geste de la personne après une pause (fin de discussion) en remplace la raison : la pause n’est plus affichée', () => {
  const { a } = twoCopies()
  const parked = parkActive(switchOnAuto(a, 'sa', T0 + 1)!.board, T0 + 2)!.board
  expect(runOf(parked).auto).toMatchObject({ offWhy: 'discussion fermée' })
  const back = resumeRun(parked, runOf(parked).id, T0 + 3)!.board
  expect(autoStateOf(runOf(back), back, 'sa')).toEqual({ kind: 'paused', why: 'discussion fermée' })
  const aside = setAsideActive(back, T0 + 4)!.board
  expect(runOf(aside).auto).toMatchObject({ offWhy: 'parcours mis de côté' })
  expect(runOf(aside).auto!.offAt!).toBeGreaterThan(runOf(parked).auto!.offAt!)
  const again = resumeRun(aside, runOf(aside).id, T0 + 5)!.board
  expect(autoStateOf(runOf(again), again, 'sa')).toEqual({ kind: 'off' })
  // Le nouveau motif gagne la fusion avec la copie d'avant.
  expect(runOf(mergeBoards(parked, aside)).auto).toMatchObject({ offWhy: 'parcours mis de côté' })
})

test('Une coupure tient même quand l’horloge la place avant l’allumage, et un nouveau clic passe après la coupure', () => {
  const { a } = twoCopies()
  // Allumé à une date venue d'une horloge en avance.
  const on = switchOnAuto(a, 'sa', T0 + 100)!.board
  const off = switchOffAuto(on, T0 + 5)!.board
  expect(isOn(off)).toBe(false)
  expect(runOf(off).auto!.offAt!).toBeGreaterThan(runOf(off).auto!.onAt!)
  const relit = switchOnAuto(off, 'sa', T0 + 6)!.board
  expect(isOn(relit)).toBe(true)
})

test('Mise de côté, clôture, archivage et fin de la discussion porteuse éteignent l’auto avec leur raison ; la pause par l’ouverture d’un autre parcours ne pose rien', () => {
  const { a } = twoCopies()
  const on = switchOnAuto(a, 'sa', T0 + 1)!.board
  const autoIn = (board: Board) => board.runs.find(r => r.id === runOf(on).id)!.auto
  expect(autoIn(setAsideActive(on, T0 + 2)!.board)).toMatchObject({ offAt: T0 + 2, offWhy: 'parcours mis de côté' })
  expect(autoIn(finishActive(on, T0 + 2)!.board)).toMatchObject({ offAt: T0 + 2, offWhy: 'parcours clos' })
  expect(autoIn(archiveRun(on, runOf(on).id, T0 + 2)!.board)).toMatchObject({ offAt: T0 + 2, offWhy: 'parcours archivé' })
  expect(autoIn(parkActive(on, T0 + 2)!.board)).toMatchObject({ offAt: T0 + 2, offWhy: 'discussion fermée' })
  // Un autre parcours ouvert ici : le premier passe en pause, son auto reste allumé (pause déduite).
  const opened = openRun(on, { title: 'Autre' }, T0 + 2).board
  const first = opened.runs.find(r => r.id === runOf(on).id)!
  expect(first.status).toBe('paused')
  expect(first.auto?.offAt).toBeUndefined()
  expect(autoStateOf(first, opened, 'sa')).toEqual({ kind: 'paused', why: 'parcours en pause' })
  // Revenu actif ici, il envoie de nouveau, sans nouveau clic.
  const back = resumeRun(opened, first.id, T0 + 3)!.board
  expect(autoStateOf(back.runs.find(r => r.id === first.id)!, back, 'sa').kind).toBe('on')
  // La personne coupe : éteint, et le bandeau n'en dit rien (ce n'est pas une pause).
  const cut = switchOffAuto(on, T0 + 2)!.board
  expect(autoStateOf(runOf(cut), cut, 'sa')).toEqual({ kind: 'off' })
})

test('La discussion change (après un /clear, une reprise ailleurs) : l’auto n’envoie plus d’ici, la raison est déduite, et un nouveau clic le rallume pour elle', () => {
  const { a } = twoCopies()
  const on = switchOnAuto(a, 'sa', T0 + 1)!.board
  expect(autoStateOf(runOf(on), on, 'sa-apres-clear')).toEqual({ kind: 'paused', why: 'discussion changée' })
  const relit = switchOnAuto(on, 'sa-apres-clear', T0 + 2)!.board
  expect(autoStateOf(runOf(relit), relit, 'sa-apres-clear').kind).toBe('on')
  expect(autoStateOf(runOf(relit), relit, 'sa').kind).not.toBe('on')
  // Vu d'une autre discussion qui ne le porte pas : il envoie là-bas.
  const seen: Board = { ...relit, session: 'sb', activeId: null, runs: relit.runs.map(r => ({ ...r, owner: 'sa-apres-clear' })) }
  expect(autoStateOf(runOf(seen), seen, 'sb')).toEqual({ kind: 'elsewhere' })
})

test('Une lecture ratée éteint l’auto de chaque parcours de la copie, sans la rendre plus récente pour le reste', () => {
  const { a } = twoCopies()
  const two = switchOnAuto(openRun(switchOnAuto(a, 'sa', T0 + 1)!.board, { title: 'Second' }, T0 + 2).board, 'sa', T0 + 3)!.board
  expect(two.runs.filter(isAutoOn)).toHaveLength(2)
  const unread = stopAutoUnread(two, T0 + 4)!
  expect(unread.runs.filter(isAutoOn)).toHaveLength(0)
  expect(unread.runs.map(r => r.auto?.offWhy)).toEqual(['lecture du parcours ratée', 'lecture du parcours ratée'])
  expect(unread.runs.map(r => r.updatedAt)).toEqual(two.runs.map(r => r.updatedAt))
  // Rien d'allumé : rien à écrire.
  expect(stopAutoUnread(unread, T0 + 5)).toBeNull()
})

test('Deux parcours du même board ont chacun leur état : allumer l’un ne change pas l’autre', () => {
  const { a } = twoCopies()
  const two = openRun(a, { title: 'Second' }, T0 + 1).board
  const on = switchOnAuto(two, 'sa', T0 + 2)!.board
  const second = on.runs.find(r => r.title === 'Second')!
  const first = on.runs.find(r => r.title === 'Auto')!
  expect(isAutoOn(second)).toBe(true)
  expect(first.auto).toBeUndefined()
  // Fusionnés avec une copie où seul le premier est allumé (par une autre discussion), chacun garde le sien.
  const elsewhere: Board = { ...a, runs: a.runs.map(r => ({ ...r, auto: { onAt: T0 + 3, onBy: 'sb' } })) }
  const merged = mergeBoards(on, elsewhere)
  expect(merged.runs.find(r => r.title === 'Second')!.auto).toMatchObject({ onAt: T0 + 2, onBy: 'sa' })
  expect(merged.runs.find(r => r.title === 'Auto')!.auto).toMatchObject({ onAt: T0 + 3, onBy: 'sb' })
})
