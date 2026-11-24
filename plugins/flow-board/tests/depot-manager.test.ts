// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { PANE, TOOL, settle, start, stored, world, writeBoard } from './monde-coordination.ts'
import { storageMode } from './stockage.ts'

import { activeRun } from '../hooks/basics.ts'
import { closingProcedure, closingScript } from '../hooks/closing.ts'
import { keepManagerReports, managerReportSessions } from '../hooks/depot-manager.ts'
import { earlierOf } from '../hooks/link.ts'
import { applyReport, emptyBoard, groupReportOf, mergeBoards, newRun, relayedReportAt, startLinkedGroups } from '../hooks/model.ts'
import { applyRelay } from '../hooks/relay.ts'
import type { Board, GroupLink, Run } from '../types'

// Quand l'outil flow manque au worker, il écrit son compte rendu dans un fichier de son worktree et en
// donne le chemin au manager, qui le dépose pour le groupe par `{"reportPath", "group"}`. Le dépôt est une marque
// sur le lien de l'envoi (sa date, la longueur du texte), le texte entier dans un fichier du relais.
// Invariant, fixé par la personne qui porte la mission (« relais-repli ») : « Un compte rendu déposé par le
// manager pour un groupe ne remplace jamais celui que le worker a déposé lui-même, ne s'écrit jamais pour une
// mission effacée, et ne se lit que dans le worktree noté de ce groupe. »

const T0 = 930_000_000
const REPO = '/repo'
const WT = `${REPO}/.claude/worktrees/groupe-boutique-A`
const OTHER_WT = `${REPO}/.claude/worktrees/groupe-boutique-C`
const REPORT = 'Compte rendu du groupe A\n\n- a1 : fait (abc1234)\n- revue : 0 constat'

/** Le monde des tests de coordination, avec un disque qui dit l'état de ses fichiers et de ses dossiers (`fs.stat`). */
const engine = (on: any, links: Record<string, string> = {}) => {
  const w = world(on)
  const dirs = new Set([REPO, WT, OTHER_WT, `${REPO}/.claude/worktrees`])
  on('session.repo', () => ({ value: { root: REPO } }))
  on('env.get', () => ({ value: undefined }) as any)
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    // `links` : un dossier qui est un lien vers un autre (son chemin résolu).
    if (dirs.has(e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: e.path in links, realPath: links[e.path] ?? e.path } } as any
    if (!(e.path in w.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file', size: new TextEncoder().encode(w.files[e.path]!).length, mtimeMs: 1, isLink: false, realPath: e.path } } as any
  })
  return w
}

/** La mission de cette discussion : deux groupes, A envoyé à un worker (session notée, worktree noté), C jamais envoyé. */
const mission = (w: ReturnType<typeof world>, link: Partial<GroupLink> = {}): Run => {
  const run = newRun('implement', T0 - 9000, 'Boutique')
  const base: Board = { ...emptyBoard('', 'p'), session: 'session-A', deleted: [], runs: [run], activeId: run.id }
  const plan = {
    tickets: [
      { id: 'a1', name: 'Synchro', files: ['a.ts'] },
      { id: 'c1', name: 'Statut', files: ['c.ts'] },
    ],
    groups: [
      { id: 'A', name: 'Synchro', tickets: ['a1'] },
      { id: 'C', name: 'Statut', tickets: ['c1'] },
    ],
  }
  const planned = applyReport(base, plan, T0 - 8000).board.runs[0] as Run
  const sent: Run = {
    ...planned,
    status: 'active',
    owner: 'session-A',
    groups: planned.groups!.map(g => (g.id === 'A' ? { ...g, sends: 1, linked: { at: T0 - 7000, session: 'abcd1234', worktreeName: 'groupe-boutique-A', ...link } } : g)),
  }
  writeBoard(w, b => ({ ...b, session: 'session-A', runs: [sent], activeId: sent.id }))
  return sent
}

const groupA = (w: ReturnType<typeof world>): any => stored(w).runs[0]!.groups!.find(g => g.id === 'A')
const managerFiles = (w: ReturnType<typeof world>): [string, string][] => Object.entries(w.files).filter(([p]) => /\/flow-board\/relais\/[^/]*\.manager-[^/]*\.report\.md$/.test(p))
/** Le mod sait où est ~/.claude (le fichier commun des missions) : le texte entier d'un dépôt peut s'y écrire. */
const isFileMode = storageMode() === 'fichier'

/** Un appel de dépôt, puis le temps que le board s'écrive. */
const deposit = async ($: any, clock: { advance: (ms: number) => Promise<void> }, path: string, group: unknown = 'A'): Promise<string> => {
  const out = (await $.tool.call({ tool: TOOL, reportPath: path, group } as any)) as { result: string }
  await settle(clock, 4)
  return out.result
}

/** Rien n'est déposé : ni marque sur aucun lien, ni fichier au relais. */
const nothingDeposited = (w: ReturnType<typeof world>) => {
  for (const g of stored(w).runs[0]!.groups ?? []) for (const l of [g.linked, g.delegated]) expect(l?.managerReport).toBeUndefined()
  expect(managerFiles(w)).toEqual([])
}

test('le manager dépose le compte rendu d’un groupe, lu dans son worktree noté : une marque sur le lien, le texte entier au relais', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  const run = mission(w)
  await start($)
  w.files[`${WT}/compte-rendu.md`] = REPORT
  const out = await deposit($, clock, `${WT}/compte-rendu.md`)
  if (!isFileMode) {
    // Sans dossier de Claude (stockage `$.store`), le texte entier ne peut pas se garder : rien n'est déposé.
    expect(out).toContain('"reportPath" with "group" refused: the Claude folder is unknown')
    nothingDeposited(w)
    return
  }
  expect(out).toContain('final report of group A deposited by you (the manager)')
  expect(out).toContain('; its closing counts it, and a report its worker leaves later prevails. Now, only if git status')
  // Le chemin que le mod calcule, celui du fichier écrit, jamais la forme courte ~/.claude/….
  expect(out).toContain(`whole in ${managerFiles(w)[0]![0]};`)
  expect(managerFiles(w)[0]![0]).toMatch(new RegExp(`/flow-board/relais/${run.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\\.manager-a-${T0}\\.report\\.md$`))
  expect(out).not.toContain('~/.claude/flow-board/relais/')
  expect(groupA(w).linked.managerReport).toEqual({ at: T0, length: REPORT.length })
  const kept = managerFiles(w)
  expect(kept).toHaveLength(1)
  expect(kept[0]![1]).toBe(REPORT)
  // L'entrée de relais du worker n'est jamais écrite par le manager.
  expect(Object.keys(w.files).some(p => p.endsWith('.entry.json'))).toBe(false)
  expect(Object.keys(w.mem).some(k => k.startsWith(`relay:${run.id}`))).toBe(false)
  // Le journal le dit.
  expect(stored(w).runs[0]!.log.some(l => l.text.includes('Compte rendu du groupe A déposé par le manager'))).toBe(true)
})

test('un groupe absent du plan, ou jamais envoyé à un worker : refusé, rien d’écrit', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  mission(w)
  await start($)
  w.files[`${WT}/cr.md`] = REPORT
  expect(await deposit($, clock, `${WT}/cr.md`, 'Z')).toContain('"reportPath" with "group" refused: no group Z in the plan; nothing was deposited.')
  w.files[`${OTHER_WT}/cr.md`] = REPORT
  expect(await deposit($, clock, `${OTHER_WT}/cr.md`, 'C')).toContain('refused: group C was never sent to a worker')
  nothingDeposited(w)
})

test('un groupe dont le worker a déposé son compte rendu : refusé, rien de remplacé', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  const run = mission(w)
  const started = applyRelay(undefined, run.id, 'abcd1234-ffff', { kind: 'start', group: 'A' }, T0 - 6000)!
  const relay = applyRelay(started, run.id, 'abcd1234-ffff', { kind: 'report', text: 'Le sien' }, T0 - 5000)!
  // Le relais, au fichier (posé par la fin de son chemin) comme dans `$.store`.
  w.mem[`relay:${run.id}`] = relay
  w.files[`flow-board/relais/${run.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`] = JSON.stringify(relay)
  await start($)
  w.files[`${WT}/cr.md`] = REPORT
  expect(await deposit($, clock, `${WT}/cr.md`)).toContain('refused: the worker of group A left its own report in the relay: it stays, and nothing replaces it')
  nothingDeposited(w)
})

test('un chemin hors du worktree noté du groupe : refusé, la raison dite', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  mission(w)
  await start($)
  // Le worktree d'un autre groupe, le dossier du projet, un chemin en .. qui sort du worktree noté.
  w.files[`${OTHER_WT}/cr.md`] = REPORT
  w.files[`${REPO}/cr.md`] = REPORT
  expect(await deposit($, clock, `${OTHER_WT}/cr.md`)).toContain('refused: outside the worktree noted for this send of the group')
  expect(await deposit($, clock, `${REPO}/cr.md`)).toContain('refused: outside the worktree noted for this send of the group')
  // Les gardes de `readReportPath` restent : un fichier absent, un chemin relatif, un fichier qui n'est ni .md ni .txt.
  expect(await deposit($, clock, `${WT}/absent.md`)).toContain('refused: no such file')
  expect(await deposit($, clock, 'cr.md')).toContain('refused: not an absolute path')
  w.files[`${WT}/cr.json`] = REPORT
  expect(await deposit($, clock, `${WT}/cr.json`)).toContain('refused: only a .md or .txt file is read')
  nothingDeposited(w)
})

test('un relais lu en partie, ou un fichier de dépôt qui existe déjà : refusé, rien de remplacé', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  const run = mission(w)
  await start($)
  w.files[`${WT}/cr.md`] = REPORT
  // Une entrée de relais illisible (une autre session) : elle pourrait cacher le compte rendu du worker.
  w.mem[`relay:${run.id}:illisible`] = 'pas une entrée'
  expect(await deposit($, clock, `${WT}/cr.md`)).toContain('refused: the relay of the mission could not be read in full')
  nothingDeposited(w)
  delete w.mem[`relay:${run.id}:illisible`]
  if (!isFileMode) return
  // Un fichier du même nom au relais : jamais remplacé.
  const name = `flow-board/relais/${run.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.manager-a-${T0 + 4_000}.report.md`
  w.files[name] = 'Déjà là'
  expect(await deposit($, clock, `${WT}/cr.md`)).toContain('refused: a deposit file of that name already exists, and nothing replaces it')
  expect(w.files[name]).toBe('Déjà là')
  expect(groupA(w).linked.managerReport).toBeUndefined()
})

test('à la fermeture, un relais lu en partie : le dépôt du manager ne compte pas', () => {
  const run = runWith({ managerReport: { at: 5_000, length: 10 } })
  const g = run.groups!.find(x => x.id === 'A')!
  expect(groupReportOf(null, g, run.groups, g.delegated, Infinity, false)).toBeUndefined()
  expect(groupReportOf(null, g, run.groups, g.delegated, Infinity, true)).toEqual({ at: 5_000, isByManager: true })
  // La même lecture pour une fermeture gardée qui se repropose (`isCloseCandidate`) : sinon elle se reproposait sans fin.
  expect(relayedReportAt(null, g, run.groups, g.delegated, Infinity, false)).toBeUndefined()
  expect(relayedReportAt(null, g, run.groups, g.delegated, Infinity, true)).toBe(5_000)
})

test('un envoi sans worktree noté, ou aux noms en conflit : rien ne se lit', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  mission(w, { worktreeName: undefined })
  await start($)
  w.files[`${WT}/cr.md`] = REPORT
  expect(await deposit($, clock, `${WT}/cr.md`)).toContain('refused: no worktree noted at the launch of this send of group A')
  nothingDeposited(w)
})

test('un envoi marqué en conflit de noms de worktree : refusé', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  mission(w, { worktreeClash: true })
  await start($)
  w.files[`${WT}/cr.md`] = REPORT
  expect(await deposit($, clock, `${WT}/cr.md`)).toContain('refused: no worktree noted at the launch of this send of group A')
  nothingDeposited(w)
})

test('un second dépôt du manager pour le même envoi : le premier reste, le second est refusé', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  mission(w)
  await start($)
  if (!isFileMode) return
  w.files[`${WT}/cr.md`] = REPORT
  await deposit($, clock, `${WT}/cr.md`)
  w.files[`${WT}/autre.md`] = 'Autre texte'
  expect(await deposit($, clock, `${WT}/autre.md`)).toContain('refused: you already deposited a report for this send of group A')
  expect(groupA(w).linked.managerReport).toEqual({ at: T0, length: REPORT.length })
  expect(managerFiles(w).map(([, t]) => t)).toEqual([REPORT])
})

test('un dépôt n’est pas lu ailleurs que dans la discussion de la mission : un worker et un spécialiste n’y ont pas droit', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  mission(w)
  await start($)
  w.files[`${WT}/cr.md`] = REPORT
  // Un spécialiste du manager : le chemin n'est pas lu, rien ne part.
  const out = (await $.tool.call({ tool: TOOL, reportPath: `${WT}/cr.md`, group: 'A', agentId: 'agent-1' } as any)) as { result: string }
  await settle(clock, 4)
  expect(out.result).toContain('"reportPath" not read')
  nothingDeposited(w)
  // Sans "group", le chemin n'est pas lu, et la réponse dit quand il l'est.
  const bare = (await $.tool.call({ tool: TOOL, reportPath: `${WT}/cr.md` } as any)) as { result: string }
  await settle(clock, 4)
  expect(bare.result).toContain('"reportPath" not read: only the worker of a group gives its final report by a path (here, a path is read only with "group": the report of a worker that lacks the flow tool, deposited for its group); your own report goes by "report"')
  nothingDeposited(w)
})

test('une mission close (effacée ou plus menée ici) : refusé, rien d’écrit', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  mission(w)
  writeBoard(w, b => ({ ...b, runs: [], activeId: null }))
  await start($)
  w.files[`${WT}/cr.md`] = REPORT
  expect(await deposit($, clock, `${WT}/cr.md`)).toContain('refused: no mission is led in this discussion')
  expect(managerFiles(w)).toEqual([])
})

// ─── La marque et sa vie : fermeture, renvoi, fusion, effacement ─────────────

const runWith = (link: Partial<GroupLink>): Run => {
  const run = { ...newRun('implement', 1_000, 'Boutique'), id: 'm1' } as Run
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const planned = applyReport(base, { tickets: [{ id: 'a1', name: 'Synchro' }, { id: 'c1', name: 'Statut' }], groups: [{ id: 'A', name: 'Synchro', tickets: ['a1'] }, { id: 'C', name: 'Statut', tickets: ['c1'] }] }, 2_000).board.runs[0] as Run
  return { ...planned, groups: planned.groups!.map(g => (g.id === 'A' ? { ...g, sends: 1, delegated: { at: 3_000, session: 'abcd1234', worktreeName: 'groupe-boutique-A', ...link } } : g)) }
}

const SCRIPT = '/opt/poste/.claude/plugins/cache/m/flow-board/1.0.0/scripts/fermeture.mjs'

test('la fermeture compte le dépôt du manager comme un compte rendu présent, et la procédure dit d’où il vient', () => {
  const run = runWith({ managerReport: { at: 5_000, length: 10 } })
  const g = run.groups!.find(x => x.id === 'A')!
  expect(relayedReportAt(null, g, run.groups)).toBe(5_000)
  expect(groupReportOf(null, g, run.groups)).toEqual({ at: 5_000, isByManager: true })
  const before = closingScript.path
  closingScript.path = SCRIPT
  try {
    const text = closingProcedure({ run, target: { kind: 'group', id: 'A', name: 'Synchro' }, isRepo: true, session: 'abcd1234', hasReport: true, isReportByManager: true })
    expect(text).toContain(`claude rm 'abcd1234'`)
    expect(text).toContain('son compte rendu, que tu as déposé pour lui (l’outil flow lui manquait), reste au relais')
    expect(text).toContain('~/.claude/flow-board/relais/m1.manager-a-*.report.md')
    // Le compte rendu du worker : la note d'avant, sans le dépôt.
    const own = closingProcedure({ run, target: { kind: 'group', id: 'A', name: 'Synchro' }, isRepo: true, session: 'abcd1234', hasReport: true })
    expect(own).toContain('il est dans le champ « report » de l’entrée de sa session')
    expect(own).not.toContain('que tu as déposé pour lui')
  } finally {
    closingScript.path = before
  }
  // Sans session notée, rien ne compte, comme pour un compte rendu du worker ; une marque hors forme non plus.
  expect(relayedReportAt(null, g, run.groups, { ...g.delegated!, session: undefined })).toBeUndefined()
  const broken = runWith({ managerReport: { at: 'hier', length: 10 } as any })
  expect(relayedReportAt(null, broken.groups!.find(x => x.id === 'A')!, broken.groups)).toBeUndefined()
})

test('un compte rendu du worker arrivé après le dépôt du manager fait foi ; le dépôt reste noté', () => {
  const run = runWith({ managerReport: { at: 5_000, length: 10 } })
  const g = run.groups!.find(x => x.id === 'A')!
  const started = applyRelay(undefined, 'm1', 'abcd1234-ffff', { kind: 'start', group: 'A' }, 4_000)!
  const relay = applyRelay(started, 'm1', 'abcd1234-ffff', { kind: 'report', text: 'Le sien' }, 6_000)!
  expect(groupReportOf(relay, g, run.groups)).toEqual({ at: 6_000, isByManager: false })
  // Un compte rendu du worker coupé sans fichier, ou d'une autre session : il n'est pas remplacé par le dépôt, rien ne compte.
  const cut = applyRelay(started, 'm1', 'abcd1234-ffff', { kind: 'report', text: 'x'.repeat(9_000) }, 6_000)!
  expect(groupReportOf(cut, g, run.groups)).toBeUndefined()
  const other = applyRelay(applyRelay(undefined, 'm1', 'eeee9999', { kind: 'start', group: 'A' }, 4_000)!, 'm1', 'eeee9999', { kind: 'report', text: 'Autre' }, 6_000)!
  expect(groupReportOf(other, g, run.groups)).toBeUndefined()
  expect(g.delegated!.managerReport).toEqual({ at: 5_000, length: 10 })
})

test('renvoyé, le groupe garde le dépôt avec son envoi ; le nouvel envoi n’en a pas', () => {
  const run = runWith({ managerReport: { at: 5_000, length: 10 } })
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const sent = startLinkedGroups(board, ['A'], 7_000)!.board
  const back = applyReport(sent, { returned: ['A'] }, 9_000).board
  const g = activeRun(back)!.groups!.find(x => x.id === 'A')!
  expect(g.delegated!.managerReport).toBeUndefined()
  expect(earlierOf(g.delegated).map(e => e.managerReport)).toEqual([{ at: 5_000, length: 10 }])
  expect(managerReportSessions(activeRun(back)!)).toEqual(['manager-A-5000'])
})

test('la fusion de deux copies garde le dépôt présent, le plus ancien des deux, dans les deux ordres ; une marque hors forme n’est pas reprise', () => {
  const none = runWith({})
  const early = runWith({ managerReport: { at: 5_000, length: 10 } })
  const late = runWith({ managerReport: { at: 6_000, length: 12 } })
  const markOf = (r: Run) => r.groups!.find(x => x.id === 'A')!.delegated!.managerReport
  expect(markOf(keepManagerReports(none, early))).toEqual({ at: 5_000, length: 10 })
  expect(markOf(keepManagerReports(early, none))).toEqual({ at: 5_000, length: 10 })
  expect(markOf(keepManagerReports(late, early))).toEqual({ at: 5_000, length: 10 })
  expect(markOf(keepManagerReports(early, late))).toEqual({ at: 5_000, length: 10 })
  for (const bad of [{ at: 'hier', length: 1 }, { at: 1e20, length: 1 }, { at: 5_000, length: -1 }, 'x', null]) expect(markOf(keepManagerReports(none, runWith({ managerReport: bad as any })))).toBeUndefined()
  // Un autre envoi (une autre date d'envoi) ne prête pas son dépôt.
  const other = runWith({ at: 4_000, managerReport: { at: 5_000, length: 10 } })
  expect(markOf(keepManagerReports(none, other))).toBeUndefined()
  // La fusion entière des missions garde aussi le dépôt.
  expect(markOf(mergeBoards({ ...emptyBoard('', 'p'), runs: [{ ...none, updatedAt: 9_000 }] } as Board, { ...emptyBoard('', 'p'), runs: [{ ...early, updatedAt: 8_000 }] } as Board).runs[0]!)).toEqual({ at: 5_000, length: 10 })
})

test('l’effacement de la mission efface le fichier de chaque dépôt, par son chemin calculé d’après les marques', () => {
  const run = runWith({ managerReport: { at: 5_000, length: 10 } })
  expect(managerReportSessions(run)).toEqual(['manager-A-5000'])
  expect(managerReportSessions(runWith({}))).toEqual([])
  expect(managerReportSessions(runWith({ managerReport: { at: 'x' } as any }))).toEqual([])
})

test('supprimer la mission efface le fichier de son dépôt, même quand le dossier du relais ne se liste pas', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  const removed: string[] = []
  on('process.run', (_$: unknown, e: { readonly argv: readonly string[] }) => {
    const path = e.argv[e.argv.length - 1]!
    removed.push(path)
    for (const key of Object.keys(w.files)) if (path === key || path.endsWith(`/${key}`)) delete w.files[key]
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
  })
  const run = { ...runWith({ managerReport: { at: 5_000, length: 10 } }), status: 'done', archivedAt: T0 - 8_000_000 } as Run
  writeBoard(w, b => ({ ...b, session: 'session-A', runs: [run], activeId: null }))
  // Le fichier du dépôt, posé par la fin de son chemin (le monde ne liste pas le dossier du relais).
  const file = 'flow-board/relais/m1.manager-a-5000.report.md'
  w.files[file] = 'Compte rendu'
  await start($)
  await settle(clock, 6)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-history' })
  await ui.press({ key: 'archived-toggle' })
  await ui.press({ key: `drop-${run.id}` })
  await ui.press({ key: `drop-yes-${run.id}` })
  await settle(clock, 2)
  await ui.unmount()
  expect(stored(w).runs.some(r => r.id === run.id)).toBe(false)
  if (isFileMode) {
    expect(removed.some(p => p.endsWith(`/${file}`))).toBe(true)
    expect(w.files[file]).toBeUndefined()
  }
})

test('un worktree noté qui est un lien vers le worktree d’un autre groupe : rien ne s’y lit', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on, { [WT]: OTHER_WT })
  mission(w)
  await start($)
  w.files[`${OTHER_WT}/cr.md`] = REPORT
  expect(await deposit($, clock, `${OTHER_WT}/cr.md`)).toContain('refused: outside the worktree noted for this send of the group')
  nothingDeposited(w)
})

test('la réponse du dépôt dit si la fermeture le compte, et de retirer le fichier du worktree', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  // Une session de l'app : la fermeture ne compte jamais un compte rendu pour elle (ni claude rm).
  mission(w, { session: 'local_abc' })
  await start($)
  if (!isFileMode) return
  w.files[`${WT}/cr.md`] = REPORT
  const out = await deposit($, clock, `${WT}/cr.md`)
  expect(out).toContain('its closing does not count it (no CLI session noted for this send): it keeps the session')
  expect(out).toContain(`Now, only if git status in its worktree shows it untracked, delete the file it was read from, "${WT}/cr.md" (its text is kept): an untracked file there stops the closing; a committed one stays.`)
  expect(groupA(w).linked.managerReport).toEqual({ at: T0, length: REPORT.length })
})

test('un chemin à segment .. ou une mission reprise par une autre discussion : refusé, rien d’écrit', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  const run = mission(w)
  await start($)
  w.files[`${WT}/cr.md`] = REPORT
  expect(await deposit($, clock, `${WT}/x/../cr.md`)).toContain('refused: a path with a . or .. segment is not read')
  nothingDeposited(w)
  // La mission reprise ailleurs : son owner n'est plus cette discussion.
  writeBoard(w, b => ({ ...b, runs: [{ ...run, owner: 'session-B', updatedAt: T0 + 5_000 }] }))
  await settle(clock, 4)
  expect(await deposit($, clock, `${WT}/cr.md`)).toContain('refused: no mission is led in this discussion')
  nothingDeposited(w)
})

test('le dépôt, envoyé avec le retour du groupe relu et clos : la fermeture de la même réponse le compte déjà', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = engine(on)
  const run = mission(w)
  writeBoard(w, b => ({
    ...b,
    runs: [{ ...run, tickets: run.tickets.map(t => (t.id === 'a1' ? { ...t, status: 'done' as const } : t)), groups: run.groups!.map(g => (g.id === 'A' ? { ...g, reviewedAt: T0 - 3000, security: { isAdvised: false, why: 'rien' } } : g)) }],
  }))
  await start($)
  if (!isFileMode) return
  w.files[`${WT}/cr.md`] = REPORT
  const out = (await $.tool.call({ tool: TOOL, reportPath: `${WT}/cr.md`, group: 'A', returned: ['A'] } as any)) as { result: string }
  await settle(clock, 4)
  expect(out.result).toContain('final report of group A deposited by you')
  expect(out.result).toContain('Close now: group A')
  expect(out.result).not.toContain('le relais n’a pas son compte rendu')
  expect(groupA(w).delegated.managerReport).toEqual({ at: T0, length: REPORT.length })
})
