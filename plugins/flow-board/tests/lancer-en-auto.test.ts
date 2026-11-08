// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { LAUNCH_STALE, LAUNCH_TTL_MS, launchKey, type LaunchRecord } from '../hooks/launch.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { cooStatement } from '../hooks/coo.ts'
import { emptyBoard, isAutoOn, newRun } from '../hooks/model.ts'
import { PANE, PLUGIN, TOOL, openCoo, settle, start, stored, world, writeBoard } from './monde-coordination.ts'

// « Lancer en auto » chez le COO. Invariant de l'accord du mode auto : « Le mode auto d'une mission n'est jamais allumé
// sans un clic de l'utilisateur : "Confirmer" dans la mission, ou "Lancer en auto" chez le COO. Le clic du
// COO ne sert qu'une fois, à la seule discussion lancée pour lui, dans les 10 minutes. Une fusion, une
// reconstruction ou une lecture ratée laisse l'auto éteint ou l'éteint, jamais l'inverse. »

const record = (over: Partial<LaunchRecord> = {}): LaunchRecord => ({ v: 1, id: 'lautoabc123', card: 'kabcdef12', root: '', title: 'Export CSV', start: 'grill-with-docs', mode: 'auto', effort: 'high', folder: 'export-csv', at: 0, by: 'session-COO', ...over })

const newDiscussion = async ($: any, on: any, now: number, rec: Partial<LaunchRecord> = {}) => {
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-N'
  const r = record({ at: now - 30_000, ...rec })
  w.mem[launchKey(r.id)] = r
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
  return { clock, w, r }
}
const consume = async ($: any, clock: any, id: string): Promise<string> => {
  const call = $.tool.call({ tool: TOOL, launch: id, title: 'Export CSV' } as any)
  await settle(clock, 3)
  return String(((await call) as any).result)
}

test('consommé dans les 10 minutes par la discussion lancée, le clic « Lancer en auto » allume l’auto à son nom, avec la date du clic', { timeoutMs: 20000 }, async ($, on) => {
  const now = 400_000_000
  const { clock, w, r } = await newDiscussion($, on, now)
  const text = await consume($, clock, r.id)
  expect(text).toMatch(/Auto mode is ON, switched on in the name of this discussion by the user's click « Lancer en auto »/)
  // Claude reçoit la consigne de l'allumage dans la même réponse, avec le cadrage d'une mission lancée par le COO.
  expect(text).toMatch(/Auto mode is ON for this mission now/)
  expect(text).toMatch(/travail\/export-csv\/demande\.md\. Read that file first\. When it exists, skip the intent round/)
  const run = stored(w).runs[0]!
  expect(isAutoOn(run)).toBe(true)
  expect(run.auto?.onBy).toBe('session-N')
  expect(run.auto?.onAt).toBe(r.at)
  // La date du clic est gardée à part, comme celle de « Confirmer ».
  expect(w.mem[`auto-confirm:${run.id}`]).toMatchObject({ by: 'session-N', onAt: r.at })
  expect(w.mem[launchKey(r.id)]).toBeUndefined()
})

test('id forgé, accord périmé : l’auto reste éteint, et la mission le dit (le rejeu d’un id consommé : « une copie ancienne fusionnée… » et la carte de lancement)', { timeoutMs: 30000 }, async ($, on) => {
  const now = 401_000_000
  const { clock, w, r } = await newDiscussion($, on, now, { at: now - LAUNCH_TTL_MS - 1000 })
  // Périmé (posé pendant que la discussion tournait : au chargement, il aurait été effacé).
  w.mem[launchKey(r.id)] = record({ at: now - LAUNCH_TTL_MS - 1000 })
  expect(await consume($, clock, r.id)).toContain(LAUNCH_STALE)
  expect(isAutoOn(stored(w).runs[0]!)).toBe(false)
  // Forgé : aucun lancement de ce projet n'a cet id.
  expect(await consume($, clock, 'lforge12345')).toContain(LAUNCH_STALE)
  expect(isAutoOn(stored(w).runs[0]!)).toBe(false)
  expect(w.mem[`auto-confirm:${stored(w).runs[0]!.id}`]).toBeUndefined()
})

test('un lancement déjà pris par une autre mission ne rallume rien ici', { timeoutMs: 20000 }, async ($, on) => {
  const now = 402_000_000
  const { clock, w, r } = await newDiscussion($, on, now)
  writeBoard(w, b => ({ ...b, runs: [...b.runs, { ...newRun('grill-with-docs', now - 20_000, 'Autre'), status: 'active', owner: 'session-X', launch: { id: r.id, card: r.card, at: r.at, folder: r.folder, start: r.start, mode: 'auto' } }] }))
  expect(await consume($, clock, r.id)).toMatch(/another mission already took it/)
  expect(isAutoOn(stored(w).runs.find(x => x.owner === 'session-N')!)).toBe(false)
})

test('une lecture ratée du fichier des missions pendant la consommation ne consomme rien et n’allume rien', { timeoutMs: 20000 }, async ($, on) => {
  const now = 403_000_000
  const { clock, w, r } = await newDiscussion($, on, now)
  w.disk.unreadable = true
  expect(await consume($, clock, r.id)).toMatch(/send "launch" again in a few seconds/)
  w.disk.unreadable = false
  expect(w.mem[launchKey(r.id)]).toBeDefined()
  expect(isAutoOn(stored(w).runs[0]!)).toBe(false)
})

test('une copie ancienne fusionnée après l’allumage ne l’éteint pas : l’auto suit ses dates ; rejoué ici, l’id ne change rien', { timeoutMs: 20000 }, async ($, on) => {
  const now = 404_000_000
  const { clock, w, r } = await newDiscussion($, on, now)
  await consume($, clock, r.id)
  // Une copie plus récente, venue d'avant l'allumage (sans auto) : la fusion garde l'« allumé à ».
  writeBoard(w, b => ({ ...b, runs: b.runs.map(x => ({ ...x, auto: undefined, updatedAt: x.updatedAt + 10_000 })) }))
  await settle(clock, 6)
  await $.tool.call({ tool: TOOL, note: 'une note' } as any)
  await settle(clock, 3)
  expect(isAutoOn(stored(w).runs[0]!)).toBe(true)
  // Rejoué dans la même mission : déjà rattachée, rien ne change.
  expect(await consume($, clock, r.id)).toMatch(/already attached/)
})

test('un rattachement perdu (écriture ratée après lui) n’allume jamais l’auto', { timeoutMs: 20000 }, async ($, on) => {
  const now = 406_000_000
  const { clock, w, r } = await newDiscussion($, on, now)
  w.probe.refuseBoard = text => {
    if (!text.includes(r.id)) return false
    w.probe.refuseBoard = undefined
    return true
  }
  expect(await consume($, clock, r.id)).not.toMatch(/Auto mode is ON/)
  await $.tool.call({ tool: TOOL, note: 'une note' } as any)
  await settle(clock, 3)
  const run = stored(w).runs[0]!
  expect(run.launch?.lostAt).toBeDefined()
  expect(isAutoOn(run)).toBe(false)
  expect(w.mem[`auto-confirm:${run.id}`]).toBeUndefined()
})

test('un lancement en manuel puis l’auto allumé dans la mission : le cadrage ne renvoie pas à demande.md', { timeoutMs: 20000 }, async ($, on) => {
  const now = 407_000_000
  const { clock, r } = await newDiscussion($, on, now, { mode: 'manual' })
  const text = await consume($, clock, r.id)
  expect(text).toMatch(/It runs in manual/)
  expect(text).not.toMatch(/demande\.md/)
})

test('chez le COO : « Lancer en auto » en tête quand l’auto est recommandé, et jamais sur une carte en xhigh', () => {
  const card = (mode: 'auto' | 'manual', effort: 'high' | 'xhigh') => ({ id: 'kabcdef12', title: 'Export CSV', start: 'grill-with-docs' as const, askMatt: 'l. 19', alts: [], mode, modeWhy: '', effort, effortWhy: '', folder: 'export-csv', at: 1 })
  const labels = (c: ReturnType<typeof card>) => coordinationRows(cooStatement(emptyBoard('', 'p'), { now: 2, cards: [c] })).find(row => row.key === 'coo-card-kabcdef12')?.actions?.map(a => a.label.replace(/\s/g, ' ')) ?? []
  expect(labels(card('auto', 'high'))).toEqual(['▶ Lancer en auto', '▶ Lancer en manuel'])
  expect(labels(card('manual', 'high'))).toEqual(['▶ Lancer en manuel', '▶ Lancer en auto'])
  expect(labels(card('manual', 'xhigh'))).toEqual(['▶ Lancer en manuel'])
})

test('le clic « Lancer en auto » écrit un enregistrement en auto et dit au COO de lancer tout de suite (le tour d’intention se recueille avant le clic)', { timeoutMs: 20000 }, async ($, on) => {
  const now = 405_000_000
  const clock = mock.clock(on, { now })
  const w = world(on)
  w.ids.now = 'session-COO'
  writeBoard(w, b => b)
  await start($)
  await openCoo($, clock)
  const answer = String(((await $.tool.call({ tool: TOOL, card: { title: 'Export CSV', start: 'grill-with-docs', askMatt: 'l. 19', mode: 'auto', effort: 'high', folder: 'export-csv' } } as any)) as any).result)
  const id = /Launch card (k[a-z0-9]+)/.exec(answer)![1]
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: `coo-card-auto-${id}` })
  await ui.unmount()
  const kept = Object.entries(w.mem).filter(([k]) => k.startsWith('coo-launch:')).map(([, v]) => v as LaunchRecord)
  expect(kept).toHaveLength(1)
  expect(kept[0]!.mode).toBe('auto')
  const fill = w.fills.at(-1) ?? ''
  expect(fill).toMatch(/je viens de cliquer « Lancer en auto »/)
  expect(fill).toMatch(/Lance-la tout de suite, sans me poser d'autre question d'abord \(le lancement ne vaut que 10 minutes\) : le tour d'intention se recueille avant le clic, dans travail\/export-csv\/demande\.md/)
})
