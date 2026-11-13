import { expect, mock, test } from 'claude-code/testing'

import { copiedIn, keepsItems, roadmapText, withoutCopied } from '../hooks/a-reprendre.ts'
import { cooStatement, statementText, type CooGlean } from '../hooks/coo.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { relayFileSlug } from '../hooks/relay.ts'
import { reportRoundOf, validatedRoundOf } from '../hooks/register.tsx'
import type { Board, Run } from '../types'

// La boîte « À reprendre ». Invariants :
// - « Une chose mise de côté par une mission ne sort de la liste que par ta décision ; elle ne disparaît
//   jamais seule. »
// - « Une chose déclarée n'est retirée de sa boîte qu'une fois recopiée dans la feuille de route. »

const TOOL = 'mcp__flow-board__flow'
const PLUGIN = 'flow-board'
const COO = 'flow-board:coo'
const ROOT = '/proj'
const ROADMAP = '/proj/travail/feuille-de-route.md'
const NOW = 400_000_000
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 90 }, view: {} },
} as const
const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')
const isStateFile = (path: string): boolean => path.includes('/flow-board/coordination/') && path.endsWith('.feuille-de-route.json')
const isCoordFile = (path: string): boolean => path.includes('/flow-board/coordination/') && path.endsWith('.json') && !path.includes('feuille-de-route') && !path.includes('.illisible-') && !path.includes('.nuit')
const isBoxFile = (path: string): boolean => path.includes('/flow-board/a-reprendre/')
const STATE_KEY = `coo-roadmap:${ROOT}`
const BOARD_KEY = `board:${ROOT}`

/**
 * Le moteur sous le plugin, dans le projet /proj : fichiers en mémoire (`files`, dont la feuille de route
 * commitée), stockage (`mem`), messages au Claude (`sent`). `ids.now` : l'id de cette discussion.
 * `fault.box` fait échouer la lecture des boîtes.
 */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const sent: { text: string; context?: readonly string[] }[] = []
  const ids = { now: 'session-A' }
  const fault = { box: false }
  /** Les comptes rendus gardés dans le dossier du relais (leurs noms), et les dossiers que le mod a listés. */
  const reports: string[] = []
  const listed: string[] = []
  on('session.end', () => ({ sessionId: ids.now }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    sent.push(e)
    return { text: e.text, context: e.context }
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: ids.now }))
  on('session.root', () => ({ value: ROOT }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => {
    if (fault.box && e.key.startsWith('a-reprendre:')) throw new Error('lecture ratée')
    return { value: mem[e.key] }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  // Un fichier posé par la fin de son chemin (« flow-board/rapports/… ») : le premier dont le chemin finit ainsi.
  const tailOf = (path: string): string | undefined => Object.keys(files).find(k => !k.startsWith('/') && path.endsWith(`/${k}`))
  const fileOf = (path: string): string | undefined =>
    path in files
      ? files[path]
      : tailOf(path) !== undefined
        ? files[tailOf(path)!]
        : isBoardFile(path) && mem[BOARD_KEY] !== undefined
        ? JSON.stringify(mem[BOARD_KEY])
        : isStateFile(path) && mem[STATE_KEY] !== undefined
          ? JSON.stringify(mem[STATE_KEY])
          : undefined
  on('fs.exists', (_$: unknown, e: { path: string }) => {
    if (fault.box && isBoxFile(e.path)) throw new Error('EIO')
    const dir = `${e.path.replace(/\/+$/, '')}/`
    return { value: fileOf(e.path) !== undefined || Object.keys(files).some(p => p.startsWith(dir)) } as any
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (fault.box && isBoxFile(e.path)) throw new Error('EIO')
    const text = fileOf(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('fs.list', (_$: unknown, e: { path: string }) => {
    listed.push(e.path)
    if (e.path.endsWith('/flow-board/relais')) return { value: reports.map(name => ({ name, kind: 'file', mtimeMs: 1 })) } as any
    const dir = `${e.path.replace(/\/+$/, '')}/`
    return { value: Object.keys(files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/')).map(p => ({ name: p.slice(dir.length), kind: 'file', mtimeMs: 1 })) } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('prompt.fill', () => ({ isFilled: true }))
  mem[STATE_KEY] = { where: 'repo', seen: {} }
  return { mem, files, sent, ids, fault, reports, listed }
}
type World = ReturnType<typeof world>
const start = ($: any) => $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
const openCoo = async ($: any, clock: { advance: (ms: number) => Promise<void> }): Promise<string> => {
  const loading = $.skill.prompt({ skill: COO, text: 'consignes du COO' })
  await settle(clock, 4)
  return (await loading).text
}
/** La boîte d'une discussion, au fichier comme dans le stockage. */
const boxOf = (w: World, session: string): { items: any[] } | undefined => {
  const path = Object.keys(w.files).find(p => isBoxFile(p) && p.endsWith(`.${session}.json`))
  return (path ? JSON.parse(w.files[path]!) : w.mem[`a-reprendre:${ROOT}:${session}`]) as { items: any[] } | undefined
}
const coordEntries = (w: World): any[] => {
  const path = Object.keys(w.files).find(isCoordFile)
  const file = path ? JSON.parse(w.files[path]!) : w.mem[`coo-coordination:${ROOT}`]
  return (file as { entries?: any[] } | undefined)?.entries ?? []
}
const roadmapWith = (pending: string[]) => ['# Feuille de route', '', '## Jalons', '', '## Prochaines étapes', '', '## Idées', '', '## À reprendre', ...pending, ''].join('\n')
const declare = async ($: any, text: string, source = 'ticket 12') => String(((await $.tool.call({ tool: TOOL, setAside: [{ text, source }] } as any)) as any).result)

// ─── Le module pur ────────────────────────────────────────────────────────

test('une boîte ne perd jamais une déclaration pas recopiée ; recopiée, elle part ; mal formée, elle reste', () => {
  const a = { id: 'aabc1234', text: 'Un', source: 's', at: 1 }
  const b = { id: 'adef5678', text: 'Deux', source: 's', at: 2 }
  const broken = { id: 'pas-un-id', text: 3 }
  const copied = new Set(['aabc1234'])
  expect(withoutCopied([a, b, broken], copied)).toEqual([b, broken])
  expect(keepsItems([a, b, broken], [b, broken], copied)).toBe(true)
  expect(keepsItems([a, b, broken], [b], copied)).toBe(false)
  expect(keepsItems([a, b], [], new Set())).toBe(false)
  // Recopiée : sa source commence par la boîte, son texte est celui déclaré, dans la section « À reprendre » seulement.
  const texts = new Map([
    ['aabc1234', 'Un'],
    ['adef5678', 'Deux\nlignes · ici'],
  ])
  expect([...copiedIn([{ section: 'À reprendre', source: 'boîte aabc1234, mission M', text: 'Un' }, { section: 'Idées', source: 'boîte adef5678', text: 'Deux / lignes - ici' }], texts)]).toEqual(['aabc1234'])
  expect([...copiedIn([{ section: 'À reprendre', source: 'boîte adef5678', text: 'Deux / lignes - ici' }], texts)]).toEqual(['adef5678'])
  // Une copie résumée, ou un id cité ailleurs que en tête de la source, ne vide jamais la boîte.
  expect([...copiedIn([{ section: 'À reprendre', source: 'boîte aabc1234', text: 'Un résumé' }], texts)]).toEqual([])
  expect([...copiedIn([{ section: 'À reprendre', source: 'suite de la boîte aabc1234', text: 'Un' }], texts)]).toEqual([])
  expect(roadmapText('a\n  b · c')).toBe('a / b - c')
})

// ─── Le mod ───────────────────────────────────────────────────────────────

test('un manager déclare ce qu’il met de côté : sa boîte le garde, la réponse le dit ; une boîte illisible n’est jamais réécrite', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  const text = await declare($, 'Revoir le délai du siège quand le poste dort')
  expect(text).toMatch(/Set aside for the COO's « À reprendre » list: 1/)
  expect(boxOf(w, 'session-A')!.items).toEqual([expect.objectContaining({ text: 'Revoir le délai du siège quand le poste dort', source: 'ticket 12', at: NOW })])
  // Ce qui n'entre pas se dit : un texte trop long n'est jamais écarté en silence.
  const partial = String(((await $.tool.call({ tool: TOOL, setAside: [{ text: 'x'.repeat(2500) }, { text: 'court' }] } as any)) as any).result)
  expect(partial).toMatch(/Set aside for the COO's « À reprendre » list: 1/)
  expect(partial).toMatch(/NOT recorded: item 1 \(2500 characters, 2000 at most: split it\)/)
  w.fault.box = true
  const refused = await declare($, 'Une autre')
  expect(refused).toMatch(/Déclaration non enregistrée : redemande-la/)
  w.fault.box = false
  expect(boxOf(w, 'session-A')!.items).toHaveLength(2)
  await settle(clock, 1)
})

test('le COO voit la déclaration dans « À reprendre » : il la note recopiée, et la boîte de la discussion déclarante s’en vide, elle seule', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  // La discussion d'ici déclare deux choses, puis devient le COO (sa mission mise de côté).
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  await declare($, 'Première')
  await declare($, 'Seconde')
  const [first, second] = boxOf(w, 'session-A')!.items
  await $.tool.call({ tool: TOOL, set: [] } as any)
  await $.command.run({ command: 'flow', args: 'pause' } as any).catch(() => undefined)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/Set aside by the managers, to copy into the roadmap section « À reprendre » \(2\)/)
  expect(opening).toContain('"Premi\\u00e8re"')
  // Le Claude du COO recopie la première seulement.
  w.files[ROADMAP] = roadmapWith([`- [R1] à décider · 2026-11-02 · boîte ${first.id}, ticket 12 · Première`])
  // Une relecture : le COO note la première recopiée, et la boîte qui la porte la retire, elle seule.
  await settle(clock, 5)
  expect(coordEntries(w)).toEqual([expect.objectContaining({ kind: 'copied', decl: first.id })])
  expect(boxOf(w, 'session-A')!.items.map((i: any) => i.id)).toEqual([second.id])
  // La relecture suivante : plus aucune boîte ne porte la première, sa marque se libère ; la seconde reste à recopier.
  await settle(clock, 5)
  expect(coordEntries(w).filter(e => e.kind === 'copied')).toEqual([])
  const turn = await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any)
  expect(JSON.stringify(turn)).toMatch(/« À reprendre » \(1\)/)
})

// Rejeu de l'appel que dicte la description de setAside (citer l'entrée qui porte déjà le sujet) : le texte « R49: … »
// arrive tel quel au relevé du COO, qui le recopie en une entrée qui nomme R49 ; recopiée, la boîte s'en vide.
test('une mise de côté qui commence par l’id d’une entrée existante (« R49: … ») arrive telle quelle au COO, et sa recopie vide la boîte', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  expect(await declare($, 'R49: couvre aussi le signal de vie des workers')).not.toMatch(/refused|Nothing set aside/)
  const [item] = boxOf(w, 'session-A')!.items
  expect(item.text).toBe('R49: couvre aussi le signal de vie des workers')
  await $.tool.call({ tool: TOOL, set: [] } as any)
  await $.command.run({ command: 'flow', args: 'pause' } as any).catch(() => undefined)
  const opening = await openCoo($, clock)
  expect(opening).toContain('"R49: couvre aussi le signal de vie des workers"')
  w.files[ROADMAP] = roadmapWith([`- [R2] à décider · 2026-11-02 · boîte ${item.id}, ticket 12 · R49: couvre aussi le signal de vie des workers`])
  await settle(clock, 5)
  expect(coordEntries(w)).toEqual([expect.objectContaining({ kind: 'copied', decl: item.id })])
  expect(boxOf(w, 'session-A')?.items ?? []).toEqual([])
})

test('une mission supprimée avant la recopie : la déclaration reste dans sa boîte, et dans le relevé du COO', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  await declare($, 'À garder')
  await settle(clock, 1)
  const runId = (w.mem[BOARD_KEY] as Board | undefined)?.activeId ?? JSON.parse(Object.entries(w.files).find(([p]) => isBoardFile(p))?.[1] ?? '{}').activeId
  // Une autre discussion supprime la mission : sa pierre tombale dans le fichier des missions.
  const board = (w.mem[BOARD_KEY] ?? JSON.parse(Object.entries(w.files).find(([p]) => isBoardFile(p))![1])) as Board
  const dropped = { ...board, runs: board.runs.filter(r => r.id !== runId), activeId: null, deleted: [{ id: runId, at: NOW + 1000 }] }
  w.mem[BOARD_KEY] = dropped
  for (const p of Object.keys(w.files)) if (isBoardFile(p)) w.files[p] = JSON.stringify(dropped)
  await settle(clock, 11)
  expect(boxOf(w, 'session-A')!.items).toEqual([expect.objectContaining({ text: 'À garder' })])
  const opening = await openCoo($, clock)
  expect(opening).toContain('"\\u00c0 garder"')
})

test('une mission close se relève une fois : ses comptes rendus et ses pistes non choisies au relevé, puis « gleaned » ; le premier relevé de l’existant se garde', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const closed: Run = { ...newRun('implement', NOW - 9000, 'Close'), status: 'done', finishedAt: NOW - 5000 }
  w.mem[BOARD_KEY] = { ...emptyBoard(ROOT, 'proj'), deleted: [], runs: [closed] }
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/First opening in this project: glean once/)
  expect(opening).toMatch(/Closed mission « Close » \(mission id « [^»]+ »\) is not gleaned yet/)
  const out = String(((await $.tool.call({ tool: TOOL, coordinate: { gleaned: [closed.id], gleanedExisting: true } } as any)) as any).result)
  expect(out).toMatch(/Gleaned: 1 mission/)
  expect(out).toMatch(/first gleaning .* is recorded/)
  expect(coordEntries(w)).toEqual([expect.objectContaining({ kind: 'gleaned', run: closed.id })])
  const turn = JSON.stringify(await $.prompt.submit({ text: 'et ?', origin: { kind: 'composer' } } as any))
  expect(turn).not.toMatch(/First opening in this project/)
  expect(turn).not.toMatch(/Closed mission « Close »/)
})

test('le relevé d’une mission close lit aussi le rapport de son compte rendu, quand il est gardé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const closed: Run = { ...newRun('implement', NOW - 9000, 'Close'), status: 'done', finishedAt: NOW - 5000 }
  w.mem[BOARD_KEY] = { ...emptyBoard(ROOT, 'proj'), deleted: [], runs: [closed] }
  // Le rapport est un fichier quand le mod sait où est ~/.claude (ses fichiers de flow-board s'écrivent alors sur le
  // disque) ; sans lui (`$.store`), le relevé ne peut pas le nommer.
  const tail = `flow-board/rapports/${relayFileSlug(closed.id)}.md`
  w.files[tail] = '# Compte rendu : Close'
  await start($)
  const opening = await openCoo($, clock)
  const isOnDisk = Object.keys(w.files).some(p => p.startsWith('/') && p.includes('/flow-board/'))
  if (isOnDisk) expect(opening).toMatch(new RegExp(`its own report \\(« [^»]*/${tail.replace(/[.]/g, '\\.')} »\\)`))
  else expect(opening).not.toMatch(/its own report/)
})

test('« À reprendre » dans la vue : ses quatre boutons demandent la décision au Claude du COO, sans rien retirer', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[ROADMAP] = roadmapWith(['- [R1] à décider · 2026-11-02 · boîte aabc1234, ticket 3 · Revoir le délai'])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    for (const key of ['coo-pending-launch-R1', 'coo-pending-attach-R1', 'coo-pending-later-R1', 'coo-pending-drop-R1']) expect(await pane.find({ key }), `${surface} ${key}`).toBeDefined()
    if (surface === 'terminal') expect(await pane.find({ type: 'Svg' })).toBeUndefined()
    await pane.unmount()
  }
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key: 'coo-pending-drop-R1' })
  await pane.unmount()
  await settle(clock, 1)
  expect(w.sent.at(-1)!.text).toMatch(/écarter la chose à reprendre R1\. Demande-moi d'abord ma raison/)
})

// Une entrée rattachée paraît après les entrées ouvertes, comptée dans le titre, avec son état et deux
// boutons seulement, qui envoient au COO les mêmes demandes que pour une entrée ouverte.
test('« À reprendre » dans la vue : une entrée rattachée paraît après les ouvertes, avec « Plus tard » et « Écarter » seulement', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[ROADMAP] = roadmapWith([
    '- [R2] rattachée à Mode auto · 2026-11-02 · COO · Relire le README',
    '- [R1] à décider · 2026-11-02 · boîte aabc1234, ticket 3 · Revoir le délai',
    '- [R3] lancée · 2026-11-02 · COO · Déjà lancée',
    '- [R4] écartée : doublon · 2026-11-02 · COO · Écartée',
    '- [R5] faite : Mode auto, ticket 03 · 2026-11-02 · COO · Faite',
  ])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    const tree = ((await pane.findAll({ type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')
    expect(tree, surface).toMatch(/Idées · À reprendre · 2/)
    expect(tree.indexOf('Revoir le délai'), surface).toBeGreaterThan(-1)
    expect(tree.indexOf('Relire le README'), surface).toBeGreaterThan(tree.indexOf('Revoir le délai'))
    expect(tree, surface).toMatch(/R2 · rattachée à Mode auto/)
    for (const text of ['Déjà lancée', 'Écartée', 'Faite']) expect(tree.split('\n'), `${surface} ${text}`).not.toContain(text)
    expect(tree.split('\n'), surface).toContain('Relire le README')
    for (const key of ['coo-pending-later-R2', 'coo-pending-drop-R2']) expect(await pane.find({ key }), `${surface} ${key}`).toBeDefined()
    for (const key of ['coo-pending-launch-R2', 'coo-pending-attach-R2']) expect(await pane.find({ key }), `${surface} ${key}`).toBeUndefined()
    await pane.unmount()
  }
  for (const [key, re] of [['coo-pending-later-R2', /passe la chose à reprendre R2 au statut « plus tard », sans rien changer d'autre/], ['coo-pending-drop-R2', /écarter la chose à reprendre R2\. Demande-moi d'abord ma raison/]] as const) {
    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
    await pane.press({ key })
    await pane.unmount()
    await settle(clock, 1)
    expect(w.sent.at(-1)!.text).toMatch(re)
  }
})

test('« À reprendre » dans la vue : une section qui n’a que des entrées rattachées se dessine', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[ROADMAP] = roadmapWith(['- [R2] rattachée à Mode auto · 2026-11-02 · COO · Relire le README'])
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await pane.find({ type: 'Text', text: /Idées · À reprendre · 1/ })).toBeDefined()
  // La clé se compose à l'exécution : écrite d'un bloc derrière « key: », gitleaks la prend pour une clé d'API.
  expect(await pane.find({ key: ['coo-pending-later', 'R2'].join('-') })).toBeDefined()
  await pane.unmount()
})

test('« Supprimer » une mission dont le COO n’a pas relevé les comptes rendus le dit',{ timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const archived: Run = { ...newRun('implement', NOW - 9000, 'Ancienne'), status: 'done', finishedAt: NOW - 8000, archivedAt: NOW - 7000 }
  w.mem[BOARD_KEY] = { ...emptyBoard(ROOT, 'proj'), deleted: [], runs: [archived] }
  // Un compte rendu de worker gardé à côté du relais (le mod le trouve dans le dossier du relais).
  w.reports.push(`${relayFileSlug(archived.id)}.s1.report.md`)
  await start($)
  await settle(clock, 1)
  const isDisk = Object.keys(w.files).some(isBoardFile) || w.listed.some(p => p.endsWith('/flow-board/relais'))
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await pane.press({ key: 'tab-history' })
  await pane.press({ key: 'archived-toggle' })
  await pane.press({ key: `drop-${archived.id}` })
  await settle(clock, 1)
  const shown = await pane.find({ type: 'Text', text: /1 compte rendu pas encore relevé par le COO/ })
  await pane.unmount()
  // Sans dossier de Claude, les comptes rendus vivent dans le stockage : rien à compter (la suite complète le voit).
  if (isDisk) expect(shown).toBeDefined()
  else expect(shown).toBeUndefined()
})

test('une boîte qui ne se lit plus (écriture coupée) : copiée telle quelle à côté, jamais supprimée, et la déclaration repart d’une boîte neuve ; le COO nomme la copie', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  await declare($, 'Avant la coupure')
  // L'écriture suivante a été coupée : la boîte ne se lit plus comme une boîte.
  const path = Object.keys(w.files).find(p => isBoxFile(p) && p.endsWith('.session-A.json'))
  const cut = '{"v":1,"root":"/proj","session":"session-A","items":[{"id":"aabc1234","text":"Avant la cou'
  if (path) w.files[path] = cut
  else w.mem[`a-reprendre:${ROOT}:session-A`] = cut
  const text = await declare($, 'Après la coupure')
  expect(text).toMatch(/Set aside for the COO's « À reprendre » list: 1/)
  expect(boxOf(w, 'session-A')!.items).toEqual([expect.objectContaining({ text: 'Après la coupure' })])
  // La copie de la boîte coupée, telle quelle, à côté.
  const kept = path ? Object.entries(w.files).filter(([p]) => p.includes('.session-A.json.illisible-')).map(([, t]) => t) : Object.entries(w.mem).filter(([k]) => k.includes(':illisible:')).map(([, v]) => v)
  expect(kept).toEqual([path ? cut : JSON.stringify(cut)])
  await $.command.run({ command: 'flow', args: 'pause' } as any).catch(() => undefined)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/copy of an unreadable box, kept/)
})

test('déjà recopiée sous un autre texte : le relevé demande de corriger l’entrée, sans en ajouter une, et la boîte la garde', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  await $.tool.call({ tool: TOOL, open: { title: 'Ma mission' } } as any)
  await declare($, 'Texte exact\nsur deux lignes')
  const [decl] = boxOf(w, 'session-A')!.items
  await $.command.run({ command: 'flow', args: 'pause' } as any).catch(() => undefined)
  w.files[ROADMAP] = roadmapWith([`- [R3] à décider · 2026-11-02 · boîte ${decl.id}, ticket 12 · Texte résumé`])
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/is already copied as entry « R3 », with another text: correct that entry's text to exactly "Texte exact \/ sur deux lignes"/)
  await settle(clock, 6)
  expect(boxOf(w, 'session-A')!.items.map((i: any) => i.id)).toEqual([decl.id])
  expect(coordEntries(w).filter(e => e.kind === 'copied')).toEqual([])
})

test('un worker, même dans son premier appel « delegate », ne déclare rien dans une boîte', { timeoutMs: 20000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = world(on)
  await start($)
  const text = String(((await $.tool.call({ tool: TOOL, delegate: 'mission-x', group: 'A', main: '[abc123]', setAside: [{ text: 'X' }] } as any)) as any).result)
  expect(text).toMatch(/a worker reports what it sets aside in its final report/)
  expect(boxOf(w, 'session-A')).toBeUndefined()
})

// Le relevé d'une mission de tri close : la section « Entrées triées » de son compte rendu ne se lit que s'il est
// validé (`isReportValidated`). Invariant (fixé par Mathis) : le COO ne change que l'état d'une entrée « À reprendre »
// rattachée à la mission qu'il relève ; elle ne passe à « faite : » que d'après le compte rendu validé de cette mission.
test('le relevé d’une mission close nomme « Entrées triées » seulement quand son compte rendu est validé ; sans compte rendu, la ligne d’avant', () => {
  const line = (g: CooGlean): string => statementText(cooStatement({ ...emptyBoard(ROOT, 'proj'), runs: [] }, { now: NOW, toGlean: [g] })).split('\n').find(l => l.startsWith('Closed mission '))!
  const base: CooGlean = { id: 'm1', title: 'Tri', reports: [], untaken: [] }
  const bare = line(base)
  expect(bare).toMatch(/^Closed mission « Tri » \(mission id « m1 »\) is not gleaned yet: read the « Pistes » sections/)
  expect(bare.endsWith('then send {"coordinate": {"gleaned": ["<mission id>"]}}.')).toBe(true)
  expect(bare).not.toMatch(/Entrées triées/)
  const report = '/h/.claude/flow-board/rapports/m1.md'
  const validated = line({ ...base, report, reportValidated: true, reportRound: '1.0.5' })
  expect(validated.startsWith(bare.slice(0, bare.indexOf('; show the user')))).toBe(true)
  expect(validated).toMatch(/then send \{"coordinate": \{"gleaned": \["<mission id>"\]\}\}\. Before sending « gleaned »: its own report is validated: also read its section « Entrées triées » \(absent or « Rien\. »: nothing changes; a file whose first line « <!-- flow-board report round … --> » does not carry the validated round « 1\.0\.5 » is not the validated version: nothing changes; write these states in this same turn, and not after a statement that no longer shows this mission closed with its report validated\) and update only the « À reprendre » entries at « rattachée à » this mission's title \(each « · » of it written « - »\), as section « Les choses à reprendre » of your instructions says/)
  expect(validated).toMatch(/write « faite : … » for an entry said done; propose « écartée : <raison> » or « à décider » and write them only with the user's agreement; every « · » of a title or a reason put in a state written « - »\)/)
  expect(validated).toMatch(/send « gleaned » only once those states are written or refused by the user, and tell the user which entries stay « rattachée à »\.$/)
  // Non validé (marque absente ou fausse), ou validé sans tour lisible : aucun état ne change, et les entrées encore rattachées se disent.
  for (const g of [{ reportValidated: false }, {}, { reportValidated: true }] as Partial<CooGlean>[]) {
    const open = line({ ...base, report, ...g })
    expect(open).toMatch(/Before sending « gleaned »: its own report is not validated \(or was reopened after its validation\): change no state of the roadmap from its section « Entrées triées », since a state « faite : » is written only from a validated report; tell the user which entries are still « rattachée à » this mission's title\./)
    expect(open).not.toMatch(/write « faite : … »/)
  }
  // Validé, mais le fichier ne se relit pas (la mission attend le relevé suivant) ou ne porte pas le tour validé : dit tel quel.
  const unread = line({ ...base, report, reportRound: '1.0.5', reportUnread: true })
  expect(unread).toMatch(/Before sending « gleaned »: its own report could not be read: change no state of the roadmap from it, and do not send « gleaned » for this mission yet: the next statement reads it again \(what you already showed or added from this mission stays as it is: do not add it again\)\./)
  const other = line({ ...base, report, reportRound: '1.0.5', reportOtherRound: true })
  expect(other).toMatch(/Before sending « gleaned »: its own report is validated, but its file does not carry the validated round \(rewritten since, or kept without it\): change no state of the roadmap from it/)
  for (const l of [unread, other]) expect(l).not.toMatch(/write « faite : … »|is not validated/)
  expect(validated).toMatch(/write these states in this same turn, and not after a statement that no longer shows this mission closed with its report validated/)
  // Une autre mission du même titre : « rattachée à <titre> » ne dit plus laquelle, rien ne change, même validé.
  const shared = line({ ...base, report, reportValidated: true, reportRound: '1.0.5', titleShared: true })
  expect(shared).toMatch(/Before sending « gleaned »: another mission of this project has the same title, so « rattachée à » its title does not tell which one: change no state of the roadmap from its section « Entrées triées », and tell the user/)
  expect(shared).not.toMatch(/write « faite : … »/)
})

// La validation se relit au relevé (`isReportValidated`), et le fichier du rapport doit porter le tour validé : validé, la
// section « Entrées triées » est donnée à lire ; marque absente, fausse, ou rapport rouvert puis fini autrement, rapport
// réécrit à un autre tour, ou titre partagé avec une autre mission : aucun état ne change.
test('le relevé d’une mission close relit la validation de son compte rendu : validé, rouvert, sans marque, marque fausse, réécrit, titre partagé', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const closedWith = (title: string, mark: 'validated' | 'reopened' | 'none' | 'broken'): Run => {
    const run = newRun('implement', NOW - 90_000, title)
    const done = { ...run.phases[0]!, status: 'done' as const, finishedAt: NOW - 60_000 }
    const report = { ...run.phases[0]!, skill: 'compte-rendu', status: 'done' as const, startedAt: NOW - 50_000, finishedAt: NOW - 40_000, steps: [], items: [] }
    const mark_ = mark === 'validated' ? { reportValidatedAt: NOW - 40_000 } : mark === 'reopened' ? { reportValidatedAt: NOW - 45_000 } : mark === 'broken' ? { reportValidatedAt: 'x' } : {}
    return { ...run, phases: [done, report], cursor: 1, status: 'done', finishedAt: NOW - 30_000, ...mark_ } as Run
  }
  const valid = closedWith('Validé', 'validated')
  const rewritten = closedWith('Réécrit', 'validated')
  const twinA = closedWith('Tri · double', 'validated')
  const twinB = { ...closedWith('Tri - double', 'none'), status: 'active' as const, finishedAt: undefined }
  const runs = [valid, closedWith('Rouvert', 'reopened'), closedWith('Sans marque', 'none'), closedWith('Marque fausse', 'broken'), rewritten, twinA, twinB]
  w.mem[BOARD_KEY] = { ...emptyBoard(ROOT, 'proj'), deleted: [], runs }
  const head = (round: string) => `<!-- flow-board report round ${round} -->\n# Compte rendu`
  for (const run of runs) w.files[`flow-board/rapports/${relayFileSlug(run.id)}.md`] = head(validatedRoundOf(valid)!)
  w.files[`flow-board/rapports/${relayFileSlug(rewritten.id)}.md`] = head('1.9.1')
  expect(validatedRoundOf(valid)).toMatch(/^1\.\d+\.\d+$/)
  // Le tour validé est celui que portait le rapport gardé pendant son tour (`reportRoundOf`, phase active, avant la validation).
  const during = { ...valid, status: 'active' as const, reportValidatedAt: undefined, phases: [valid.phases[0]!, { ...valid.phases[1]!, status: 'active' as const, finishedAt: undefined }] } as Run
  expect(reportRoundOf(during)).toBe(validatedRoundOf(valid))
  await start($)
  const opening = await openCoo($, clock)
  const lineOf = (title: string) => opening.split('\n').find(l => l.includes(`Closed mission « ${title} »`)) ?? ''
  for (const run of runs.filter(r => r.status === 'done')) expect(lineOf(run.title), run.title).toMatch(/is not gleaned yet/)
  const isOnDisk = Object.keys(w.files).some(p => p.startsWith('/') && p.includes('/flow-board/'))
  if (!isOnDisk) {
    // Sans ~/.claude connu (`$.store`), le rapport n'est pas nommé : la ligne est celle d'avant, sans « Entrées triées ».
    for (const run of runs.filter(r => r.status === 'done')) expect(lineOf(run.title)).not.toMatch(/Entrées triées/)
    return
  }
  expect(lineOf('Validé')).toMatch(/its own report is validated: also read its section « Entrées triées »/)
  expect(lineOf('Réécrit')).toMatch(/its own report is validated, but its file does not carry the validated round/)
  expect(lineOf('Réécrit')).not.toMatch(/write « faite : … »/)
  for (const title of ['Rouvert', 'Sans marque', 'Marque fausse']) {
    expect(lineOf(title), title).toMatch(/its own report is not validated \(or was reopened after its validation\): change no state of the roadmap/)
    expect(lineOf(title), title).not.toMatch(/write « faite : … »/)
  }
  expect(lineOf('Tri · double')).toMatch(/another mission of this project has the same title/)
  expect(lineOf('Tri · double')).not.toMatch(/write « faite : … »/)
})
