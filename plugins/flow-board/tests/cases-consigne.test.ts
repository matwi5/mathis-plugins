// Les cases d'autonomie dans la consigne du mode auto : le bloc « mode auto » gagne la phrase des cases seulement quand une
// case au moins est cochée (aucune case cochée, fichier absent ou illisible : le texte d'avant, mot pour mot) ; la
// consigne d'allumage garde posée une question déjà posée ; la réponse de l'outil flow redit l'état des cases quand il a
// changé depuis le dernier état dit à la discussion, au manager d'une mission en auto comme au worker d'une telle
// mission ; le premier clic sur « ⚡ Auto » liste les cases cochées. Invariant des cases (fixé par la personne) : « Une
// mission ne tranche jamais seule une sorte de question dont tu n'as pas coché la case par un clic ; une case absente,
// illisible ou mal lue vaut décochée, et la question t'est posée. »

import { expect, mock, test } from 'claude-code/testing'

import { AUTO_BRIEF_IN_TURN, autoBriefInTurn, autoBriefText, autoNote, autonomyLine, autoOnNotice } from '../hooks/auto-consignes.ts'
import { AUTONOMY_CHANGED_HEAD, autonomyChangeNotice, markAutonomySaid } from '../hooks/autonomy-notice.ts'
import { autonomySettingPath } from '../hooks/autonomy-store.ts'
import { AUTONOMY_EXCEPT_EN } from '../hooks/catalog.ts'
import type { AutonomyCases } from '../hooks/autonomy-setting.ts'
import { applyReport, emptyBoard, newRun, switchOnAuto } from '../hooks/model.ts'
import { autoTickedLine } from '../hooks/view.tsx'
import type { Board, Run } from '../types'

const OFF: AutonomyCases = { experience: false, invariant: false, contradiction: false, spend: false, reread: false }
const ALREADY_ASKED = 'A question already asked in that last message stays asked, even when its autonomy box is ticked'
/** Les phases qui ont un bloc propre en auto, et le cadrage. */
const PHASE_IDS = ['grill-with-docs', 'triage', 'to-spec', 'to-tickets', 'implement', 'code-review', 'compte-rendu']
const run = (): Run => newRun('to-spec', 1_000, 'Boutique')

test('aucune case cochée (absentes, illisibles ou toutes décochées) : le bloc de chaque phase et la consigne d’allumage sont ceux d’avant, mot pour mot', () => {
  const r = run()
  for (const id of PHASE_IDS) {
    const before = autoNote(id, r)
    expect(autoNote(id, r, null)).toEqual(before)
    expect(autoNote(id, r, OFF)).toEqual(before)
  }
  expect(autoBriefText(r, OFF)).toBe(autoBriefText(r))
  expect(autoBriefText(r, null)).toBe(autoBriefText(r))
  expect(autoOnNotice(r, OFF)).toBe(autoOnNotice(r))
  expect(autoBriefInTurn(OFF)).toBe(AUTO_BRIEF_IN_TURN)
  expect(autoBriefInTurn(null)).toBe(AUTO_BRIEF_IN_TURN)
  expect(autonomyLine(OFF)).toBeNull()
})

test('une case cochée : le bloc ne gagne qu’une ligne, juste après celle des six sortes, qui nomme la case et dit quoi faire (et le renvoi aux cases dans les phrases du cadrage et du découpage)', () => {
  const r = run()
  const strip = (l: string) => l.replaceAll(`, ${AUTONOMY_EXCEPT_EN}`, '')
  for (const id of PHASE_IDS) {
    const before = autoNote(id, r)
    const after = autoNote(id, r, { ...OFF, experience: true })
    const added = after.filter(l => !before.includes(strip(l)))
    expect(added.length).toBe(1)
    expect(after.filter(l => l !== added[0]).map(strip)).toEqual(before)
    expect(after.indexOf(added[0]!)).toBe(after.findIndex(l => l.startsWith('- Six kinds of decisions stay with the user')) + 1)
  }
  const line = autonomyLine({ ...OFF, experience: true })!
  expect(line).toContain("ticked for this project (the « Réglages » page of the COO's Coordination view): « Choix d'expérience ».")
  expect(line).toContain('do not ask it; consult the advisor')
  expect(line).toContain('take your recommended answer')
  expect(line).toContain('the question and its options in full, as « acceptée par réglage (<box>) »')
  expect(line).toContain('declare it before coding it, its "what" beginning with « Réglage : <box> : » (boxes joined by « + », a space on each side, for a question of several kinds')
  expect(line).not.toContain('« Dépense ou action externe »')
})

test('le renvoi aux cases, une case cochée : au découpage, au cadrage et dans la consigne d’allumage ; jamais à la spec ni sans case', () => {
  const r = run()
  const ticked = { ...OFF, invariant: true }
  expect(autoNote('to-tickets', r, ticked).join('\n')).toContain(`stay blocking questions on this phase ("phase": "to-tickets"), ${AUTONOMY_EXCEPT_EN}.`)
  expect(autoNote('grill-with-docs', r, ticked).join('\n')).toContain(`to be settled by you, stays a blocking question, ${AUTONOMY_EXCEPT_EN}. `)
  expect(autoBriefText(r, ticked)).toContain(`that is of the six kinds below is a blocking question (${AUTONOMY_EXCEPT_EN}),`)
  // La spec : un invariant qu'on y propose reste posé, la phrase des cases le dit ; son bloc n'a pas de renvoi.
  const spec = autoNote('to-spec', r, ticked)
  expect(spec.filter(l => l.includes(AUTONOMY_EXCEPT_EN))).toEqual([])
  for (const id of PHASE_IDS) expect(autoNote(id, r, OFF).join('\n')).not.toContain(AUTONOMY_EXCEPT_EN)
  expect(autoBriefText(r, OFF)).not.toContain(AUTONOMY_EXCEPT_EN)
})

test('plusieurs cases cochées : chacune nommée par son libellé, dans l’ordre de la page', () => {
  const line = autonomyLine({ ...OFF, spend: true, experience: true, reread: true })!
  expect(line).toContain(": « Choix d'expérience », « Dépense ou action externe », « Relecture après la fusion ».")
})

test('la phrase l’emporte sur celle des six sortes pour les sortes cochées, et redit ce qui reste toujours posé', () => {
  const line = autonomyLine({ ...OFF, spend: true })!
  expect(line).toContain('this line wins over the line of the six kinds (« always as blocking questions »), as the line of the sensitive area does')
  expect(line).toContain("Still always asked, with no box: a deletion with no way back or an exposure of the user's data outside this machine, leaving a security finding unfixed, the Fable path, an invariant already validated to weaken, rewrite, read, clarify or extend, and any question one of whose kinds has no ticked box.")
  expect(line).toContain('The flow tool refuses that choice when a box it names is not ticked or cannot be read: then ask the question.')
})

test('case « Invariant d’un ticket » : seulement l’invariant d’un ticket, après la recherche des invariants déjà écrits ; au cadrage ou à la spec, posé', () => {
  const line = autonomyLine({ ...OFF, invariant: true })!
  expect(line).toContain("The box « Invariant d'un ticket » covers only the invariant of a ticket, written at the ticket split or during the implementation (a very sensitive ticket's included), once you have searched the decision files for the invariants already written that name the same data and quoted them; an invariant proposed during the framing or the spec, before a ticket carries it, stays asked.")
  expect(autonomyLine({ ...OFF, spend: true })).not.toContain("The box « Invariant d'un ticket »")
})

test('case « Décision déjà prise contredite » : la nouvelle série cite la décision remplacée et la marque remplacée', () => {
  expect(autonomyLine({ ...OFF, contradiction: true })).toContain('Under « Décision déjà prise contredite », the new series quotes the decision it replaces and marks it replaced')
  expect(autonomyLine({ ...OFF, spend: true })).not.toContain('Décision déjà prise contredite')
})

test('consigne d’allumage, une case cochée : une question déjà posée dans le dernier message reste posée ; sans case, rien de plus', () => {
  const r = run()
  const cases = { ...OFF, spend: true }
  expect(autoBriefText(r, cases)).toContain(ALREADY_ASKED)
  expect(autoOnNotice(r, cases)).toContain(ALREADY_ASKED)
  expect(autoBriefInTurn(cases)).toContain(ALREADY_ASKED)
  expect(autoBriefText(r, cases)).toContain('« Dépense ou action externe »')
  expect(autoBriefText(r)).not.toContain(ALREADY_ASKED)
})

test('l’avis d’un changement des cases : dit quand l’état relu change, rien sinon ; « aucune case » après une décoche', () => {
  // Mémoire vide : « aucune case cochée » ; une lecture ratée vaut aucune case.
  expect(autonomyChangeNotice('m-avis', OFF)).toBe('')
  expect(autonomyChangeNotice('m-avis', null)).toBe('')
  const ticked = autonomyChangeNotice('m-avis', { ...OFF, spend: true })
  expect(ticked).toContain(AUTONOMY_CHANGED_HEAD)
  expect(ticked).toContain('« Dépense ou action externe »')
  expect(ticked).toContain('A question already asked stays asked until the user answers it.')
  expect(autonomyChangeNotice('m-avis', { ...OFF, spend: true })).toBe('')
  const unticked = autonomyChangeNotice('m-avis', OFF)
  expect(unticked).toContain('No autonomy box is ticked now')
  expect(autonomyChangeNotice('m-avis', null)).toBe('')
  // L'état reçu par le bloc ou la consigne d'allumage compte comme dit.
  markAutonomySaid('m-bloc', { ...OFF, invariant: true })
  expect(autonomyChangeNotice('m-bloc', { ...OFF, invariant: true })).toBe('')
})

/**
 * L'appel `decided` que dicte la phrase des cases, tiré de son texte, rejoué contre le modèle : une case, plusieurs
 * (jointes par « + » entre espaces), la forme sensible ; gardé case cochée, refusé case décochée (ce que dit l'avis
 * « aucune case cochée »).
 */
test('l’appel que dicte la phrase des cases, rejoué contre le modèle : gardé case cochée, refusé sinon', () => {
  const line = autonomyLine({ ...OFF, experience: true, spend: true })!
  const call = /(\{"decided": \[\{"what": "[^"]+", "why": "\.\.\.", "origin": "recommendation"\}\]\})/.exec(line)![1]!
  const lotRun: Run = { ...newRun('implement', 1_000, 'Boutique'), owner: 'sa' }
  const lot = applyReport({ ...emptyBoard('', 'p'), session: 'sa', deleted: [], runs: [lotRun], activeId: lotRun.id }, { tickets: [{ id: 't1', name: 'Un' }, { id: 't2', name: 'Deux' }], groups: [{ id: 'A', name: 'Code', tickets: ['t1'] }, { id: 'B', name: 'Données', tickets: ['t2'] }] }, 1_001).board
  const board = switchOnAuto(lot, 'sa', 1_002)!.board
  const ticked = { ...OFF, experience: true, spend: true }
  for (const [box, choice] of [["Choix d'expérience", 'libellé « Valider »'], ["Choix d'expérience + Dépense ou action externe", 'installer jq'], ["Choix d'expérience", 'x']] as const) {
    const input = JSON.parse(call.replace('<box>', box).replace('<the choice>', choice)) as { decided: { what: string }[] }
    const what = choice === 'x' ? `Zone sensible : ${input.decided[0]!.what}` : input.decided[0]!.what
    const kept = applyReport(board, { decided: [{ ...input.decided[0]!, what }] }, 1_010, { autonomy: ticked })
    expect([what, (kept.board.runs[0]!.decided ?? []).map(d => d.what)]).toEqual([what, [what]])
    const refused = applyReport(board, { decided: [{ ...input.decided[0]!, what }] }, 1_010, { autonomy: OFF })
    expect([what, (refused.board.runs[0]!.decided ?? []).length]).toEqual([what, 0])
    expect(refused.text).toContain('refused')
  }
})

test('le premier clic sur « ⚡ Auto » : la ligne des cases cochées, texte validé', () => {
  expect(autoTickedLine(["Choix d'expérience", 'Dépense ou action externe'])).toBe("Tranché seul d'après tes réglages : Choix d'expérience, Dépense ou action externe")
})

// ── Par l'outil flow et le panneau, sur un faux moteur ─────────────────────────────────────────────────────────────

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const ROOT = 'C:/proj'
const CASES = autonomySettingPath('/h/.claude', ROOT)
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const

/** Le moteur d'une discussion « sa » dans le dépôt « C:/proj » : fichiers et `$.store` en mémoire, les cases sous `/h`. */
const world = (on: any, session = 'sa') => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('fs.list', (_$: unknown, e: { path: string }) => {
    const names = Object.keys(files).filter(p => p.startsWith(`${e.path}/`)).map(p => p.slice(e.path.length + 1).split('/')[0]!)
    if (names.length === 0 && e.path !== '/h/.claude/flow-board/coordination') throw new Error(`ENOENT ${e.path}`)
    return { value: [...new Set(names)].map(name => ({ name })) } as any
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: session }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  const setCases = (cases: Partial<AutonomyCases> | 'abîmé' | 'autre racine') => {
    files[CASES] = cases === 'abîmé' ? '{"v":1,' : JSON.stringify({ v: 1, root: cases === 'autre racine' ? 'D:/autre' : ROOT, cases: cases === 'autre racine' ? { spend: true } : { ...OFF, ...cases }, at: 1 })
  }
  return { mem, files, setCases }
}

const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key })
  await pane.unmount()
}
const skill = async ($: any, name: string): Promise<string> => String((await $.skill.prompt({ skill: `mattpocock-skills:${name}`, text: 'x' })).text)
const flow = async ($: any, input: Record<string, unknown>): Promise<string> => String((await $.tool.call({ tool: TOOL, ...input } as any)).result)

/** Une mission ouverte par le cadrage dans « sa », titrée, l'auto allumé ou non. */
const opened = async ($: any, on: any, isAuto: boolean) => {
  const clock = mock.clock(on, { now: 70_000_000 })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await skill($, 'grill-with-docs')
  await flow($, { title: 'Boutique' })
  if (isAuto) {
    await press($, 'auto-on')
    await press($, 'auto-confirm')
  }
  await clock.advance(1000)
  return { clock, ...w }
}

test('par le vrai chemin, fichier absent, toutes décochées, abîmé ou d’un autre projet : la consigne du skill est la même, sans phrase des cases', { timeoutMs: 30000 }, async ($, on) => {
  const w = await opened($, on, true)
  const absent = await skill($, 'to-spec')
  expect(absent).toContain('Six kinds of decisions stay with the user')
  for (const cases of [OFF, 'abîmé', 'autre racine'] as const) {
    w.setCases(cases)
    expect([cases, await skill($, 'to-spec')]).toEqual([cases, absent])
  }
  w.setCases({ spend: true })
  const ticked = await skill($, 'to-spec')
  expect(ticked).toContain('Autonomy boxes the user ticked for this project')
  expect(ticked).toContain('« Dépense ou action externe »')
})

test('manager en auto : une case cochée entre deux appels se dit une fois, sa décoche aussi, rien sans changement', { timeoutMs: 30000 }, async ($, on) => {
  const w = await opened($, on, true)
  await skill($, 'to-spec')
  expect(await flow($, { step: 'explore' })).not.toContain(AUTONOMY_CHANGED_HEAD)
  w.setCases({ experience: true })
  const ticked = await flow($, { step: 'seams' })
  expect(ticked).toContain(AUTONOMY_CHANGED_HEAD)
  expect(ticked).toContain("« Choix d'expérience »")
  expect(await flow($, { step: 'write' })).not.toContain(AUTONOMY_CHANGED_HEAD)
  w.setCases(OFF)
  const unticked = await flow($, { step: 'explore' })
  expect(unticked).toContain(AUTONOMY_CHANGED_HEAD)
  expect(unticked).toContain('No autonomy box is ticked now')
  expect(await flow($, { step: 'seams' })).not.toContain(AUTONOMY_CHANGED_HEAD)
})

test('manager en auto : l’état reçu par la consigne d’un skill du fil principal ne se redit pas à l’appel suivant', { timeoutMs: 30000 }, async ($, on) => {
  // Le skill tapé par la personne : sa consigne arrive au fil principal.
  on('command.run', () => ({ value: undefined }) as any)
  const w = await opened($, on, true)
  w.setCases({ spend: true })
  await $.command.run({ command: 'mattpocock-skills:to-spec', args: '' } as any).catch(() => undefined)
  expect(String((await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x', source: 'plugin', frontmatter: {} } as any)).text)).toContain('« Dépense ou action externe »')
  expect(await flow($, { step: 'explore' })).not.toContain(AUTONOMY_CHANGED_HEAD)
})

test('manager en auto : un skill qui n’arrive pas au fil principal ne compte pas l’état comme dit', { timeoutMs: 30000 }, async ($, on) => {
  const w = await opened($, on, true)
  w.setCases({ spend: true })
  // Ni appelé par l'outil Skill ni tapé : sa consigne ne parvient pas à Claude, l'outil redit donc l'état.
  expect(await skill($, 'to-spec')).toContain('« Dépense ou action externe »')
  expect(await flow($, { step: 'explore' })).toContain(AUTONOMY_CHANGED_HEAD)
})

test('hors auto : aucune case n’est dite, ni dans la consigne ni dans la réponse de l’outil', { timeoutMs: 30000 }, async ($, on) => {
  const w = await opened($, on, false)
  w.setCases({ spend: true })
  expect(await skill($, 'to-spec')).not.toContain('Autonomy boxes')
  expect(await flow($, { step: 'explore' })).not.toContain(AUTONOMY_CHANGED_HEAD)
})

test('premier clic sur « ⚡ Auto », une case cochée : la ligne « Tranché seul d’après tes réglages : … » sous la liste', { timeoutMs: 30000 }, async ($, on) => {
  const w = await opened($, on, false)
  w.setCases({ experience: true, spend: true })
  await press($, 'auto-on')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ type: 'Text', text: /Allumer le mode auto de cette mission/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: "Tranché seul d'après tes réglages : Choix d'expérience, Dépense ou action externe" })).toBeDefined()
  await pane.unmount()
})

test('premier clic sur « ⚡ Auto », aucune case cochée : pas de ligne des réglages', { timeoutMs: 30000 }, async ($, on) => {
  const w = await opened($, on, false)
  w.setCases(OFF)
  await press($, 'auto-on')
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ type: 'Text', text: /Allumer le mode auto de cette mission/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Tranché seul d'après tes réglages/ })).toBeUndefined()
  await pane.unmount()
})

// ── Le worker d'une mission en auto ───────────────────────────────────────────────────────────────────────────────

const T0 = 1_000_000

/** La mission du manager, tenue par sa discussion « session-M », l'auto allumé. */
const managerBoard = (): Board => {
  const r: Run = { ...newRun('implement', T0, 'Boutique'), id: 'mboutique1', owner: 'session-M', claim: { boot: 'boot-M', at: T0 } }
  const board: Board = { ...emptyBoard('', 'p'), root: ROOT, session: 'session-M', boot: 'boot-M', deleted: [], runs: [r], activeId: r.id }
  return switchOnAuto(board, 'session-M', T0 + 1_000)!.board
}

/** Un worker dans un worktree de « C:/proj » : la mission vit dans le board du dépôt principal. */
const workerWorld = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const main = { text: null as string | null }
  const isMainFile = (path: string) => path.endsWith('/flow-board/parcours/c-proj.json')
  on('fs.list', (_$: unknown, e: { path: string }) => {
    throw new Error(`ENOENT ${e.path}`)
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-W' }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: 'C:/proj/.claude/worktrees/groupe-b' }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: isMainFile(e.path) ? main.text !== null : e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (isMainFile(e.path) && main.text !== null) return { value: main.text } as any
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (!isMainFile(e.path)) files[e.path] = e.text
    return { value: undefined } as any
  })
  const board = managerBoard()
  mem['board:c:/proj'] = JSON.parse(JSON.stringify(board))
  main.text = JSON.stringify(board)
  const setCases = (cases: Partial<AutonomyCases>) => {
    files[CASES] = JSON.stringify({ v: 1, root: ROOT, cases: { ...OFF, ...cases }, at: T0 })
  }
  return { setCases }
}

const delegate = async ($: any): Promise<string> => {
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  return flow($, { delegate: 'mboutique1', group: 'B', main: '[0a1b2c]' })
}

test('worker d’une mission en auto, une case cochée : sa première déclaration reçoit la phrase des cases, puis chaque changement', { timeoutMs: 30000 }, async ($, on) => {
  mock.clock(on, { now: T0 + 10_000 })
  const w = workerWorld(on)
  w.setCases({ spend: true })
  const first = await delegate($)
  expect(first).toContain(AUTONOMY_CHANGED_HEAD)
  expect(first).toContain('« Dépense ou action externe »')
  expect(await flow($, { note: 'rien de neuf' })).not.toContain(AUTONOMY_CHANGED_HEAD)
  w.setCases({ spend: true, experience: true })
  const changed = await flow($, { note: 'encore' })
  expect(changed).toContain(AUTONOMY_CHANGED_HEAD)
  expect(changed).toContain("« Choix d'expérience », « Dépense ou action externe »")
})

test('worker d’une mission en auto, aucune case cochée : sa réponse ne dit rien des cases', { timeoutMs: 30000 }, async ($, on) => {
  mock.clock(on, { now: T0 + 10_000 })
  const w = workerWorld(on)
  w.setCases(OFF)
  const first = await delegate($)
  expect(first).toContain('This discussion works for the mission')
  expect(first).not.toContain(AUTONOMY_CHANGED_HEAD)
  expect(first).not.toContain('Autonomy boxes')
})
