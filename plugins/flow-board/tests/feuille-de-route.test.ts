import { expect, mock, test } from 'claude-code/testing'

import { ROADMAP_EXAMPLE, isRoadmapId, parseRoadmap, partialSeen, roadmapTextPrint, soundSeen, unionSeen, watchRoadmap, type RoadmapSeen } from '../hooks/roadmap.ts'
import { roadmapAsk, roadmapMoveAsk } from '../hooks/register.tsx'
import { cooStatement, roadmapNow, statementText, type CooRoadmap } from '../hooks/coo.ts'
import { emptyBoard } from '../hooks/model.ts'
import { CORPUS } from './corpus.mjs'

// La feuille de route du COO. Invariant : « La feuille de route ne perd jamais une entrée sans ta
// décision ; une disparition est montrée et se répare. »

const FILE = `# Feuille de route

## Jalons
- [J1] en cours · 2026-11-02 · Mathis · Le COO suit les missions — fin : chaque mission passe par lui

## Prochaines étapes
- [E1] à faire · 2026-11-02 · COO · Lancer le groupe C

## Idées
- [I1] à lancer · 2026-11-01 · Mathis · un tableau des coûts · par mission
- [I2] écartée : trop tôt · 2026-11-01 · Mathis · tout refaire en Rust

## À reprendre
- [R1] rattachée à Mode auto · 2026-11-02 · mission « Mode auto », compte rendu · le README cite encore travail/tasks/
`

test('le format strict se lit : sections, ids, statuts, dates, sources et le texte tel qu’écrit', () => {
  const read = parseRoadmap(FILE)
  expect(read.ok).toBe(true)
  if (!read.ok) return
  expect(read.entries.map(e => [e.id, e.section, e.status, e.source])).toEqual([
    ['J1', 'Jalons', 'en cours', 'Mathis'],
    ['E1', 'Prochaines étapes', 'à faire', 'COO'],
    ['I1', 'Idées', 'à lancer', 'Mathis'],
    ['I2', 'Idées', 'écartée : trop tôt', 'Mathis'],
    ['R1', 'À reprendre', 'rattachée à Mode auto', 'mission « Mode auto », compte rendu'],
  ])
  // Le texte va jusqu'au bout de la ligne, « · » compris.
  expect(read.entries[2]!.text).toBe('un tableau des coûts · par mission')
})

test('une ligne hors format, un statut inconnu, un id en double ou une section inconnue : la lecture le dit, sans entrée', () => {
  const cases: [string, RegExp][] = [
    [`${FILE}- [I9] peut-être · 2026-11-02 · Mathis · x\n`, /statut « peut-être » inconnu/],
    [`${FILE}- [I1] à lancer · 2026-11-02 · Mathis · doublon\n`, /id « I1 » en double/],
    [`${FILE}## Divers\n`, /section inconnue/],
    [`${FILE}texte libre\n`, /hors format/],
    ['- [I1] à lancer · 2026-11-02 · Mathis · x\n', /avant toute section/],
    [`${FILE}## Idées\n`, /en double/],
  ]
  for (const [text, why] of cases) {
    const read = parseRoadmap(text)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.why).toMatch(why)
  }
})

test('une entrée qui disparaît d’une lecture à l’autre est rendue avec sa dernière version, et reste gardée', () => {
  const first = watchRoadmap({}, parseRoadmap(FILE), 1_000)
  expect(first.gone).toEqual([])
  expect(Object.keys(first.seen).sort()).toEqual(['E1', 'I1', 'I2', 'J1', 'R1'])
  // I1 change de statut, puis R1 disparaît.
  const edited = FILE.replace('[I1] à lancer', '[I1] plus tard').replace(/^- \[R1\].*\n/m, '')
  const second = watchRoadmap(first.seen, parseRoadmap(edited), 2_000)
  expect(second.gone.map(g => g.id)).toEqual(['R1'])
  expect(second.gone[0]!.line).toMatch(/^- \[R1\] rattachée à Mode auto/)
  expect(second.seen.R1).toEqual(first.seen.R1)
  expect(second.seen.I1!.line).toMatch(/\[I1\] plus tard/)
  // Remise telle quelle : plus d'alerte.
  const third = watchRoadmap(second.seen, parseRoadmap(FILE), 3_000)
  expect(third.gone).toEqual([])
})

test('une lecture hors format ne montre rien de faux et ne touche pas aux entrées gardées', () => {
  const seen: RoadmapSeen = watchRoadmap({}, parseRoadmap(FILE), 1_000).seen
  const broken = watchRoadmap(seen, parseRoadmap(`${FILE}texte libre\n`), 2_000)
  expect(broken.gone).toEqual([])
  expect(broken.seen).toBe(seen)
  // Un fichier vidé (bien formé, sans entrée) : chaque entrée vue est une disparition.
  const emptied = watchRoadmap(seen, parseRoadmap('# Feuille de route\n'), 3_000)
  expect(emptied.gone.map(g => g.id).sort()).toEqual(['E1', 'I1', 'I2', 'J1', 'R1'])
  expect(Object.keys(emptied.seen).sort()).toEqual(['E1', 'I1', 'I2', 'J1', 'R1'])
})

// ─── Le mod ───────────────────────────────────────────────────────────────

const PLUGIN = 'flow-board'
const COO = 'flow-board:coo'
const ROOT = '/proj'
const FILE_PATH = '/proj/travail/feuille-de-route.md'
const NOW = 130_000_000
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const
const isBoardFile = (path: string): boolean => path.includes('/flow-board/parcours/')
const isStateFile = (path: string): boolean => path.includes('/flow-board/coordination/') && path.endsWith('.feuille-de-route.json')
const STATE_KEY = `coo-roadmap:${ROOT}`
/** Ce que le mod garde de la feuille de route : son fichier du poste s'il en a écrit un, sinon `$.store`. */
const state = (w: { mem: Record<string, unknown>; files: Record<string, string> }): { where?: string; seen?: Record<string, { line: string }> } | undefined => {
  const path = Object.keys(w.files).find(isStateFile)
  return (path ? JSON.parse(w.files[path]!) : w.mem[STATE_KEY]) as { where?: string; seen?: Record<string, { line: string }> } | undefined
}

/**
 * Le moteur sous le plugin, dans le projet /proj (sa racine est celle du dépôt) : le fichier des missions
 * et la feuille de route en mémoire (`files`), le stockage (`mem`), les messages que le mod envoie à
 * Claude (`asked`) et ceux que lit Claude (`sent`).
 */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const sent: { text: string; context?: readonly string[]; origin?: { kind?: string } }[] = []
  const fault = { state: false }
  on('session.end', () => ({ sessionId: 'session-A' }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[]; origin?: { kind?: string } }) => {
    sent.push(e)
    return { text: e.text }
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.root', () => ({ value: ROOT }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  // Le dossier personnel, sous lequel vit le réglage « revue de sécurité ».
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('store.get', (_$: unknown, e: { key: string }) => {
    if (fault.state && e.key === STATE_KEY) throw new Error('lecture ratée')
    return { value: mem[e.key] }
  })
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  // Le fichier des missions, quand le mod sait où il est : celui que le test a posé dans `$.store` tant qu'aucun n'est écrit.
  // Ce que le mod garde de la feuille de route : son fichier du poste, posé par le test dans `$.store` tant qu'aucun n'est écrit.
  const boardFile = (path: string): string | undefined =>
    path in files
      ? files[path]
      : isBoardFile(path) && mem[`board:${ROOT}`] !== undefined
        ? JSON.stringify(mem[`board:${ROOT}`])
        : isStateFile(path) && mem[STATE_KEY] !== undefined
          ? JSON.stringify(mem[STATE_KEY])
          : undefined
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: boardFile(e.path) !== undefined }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const text = boardFile(e.path)
    if (fault.state && isStateFile(e.path)) throw new Error(`EIO ${e.path}`)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  // La feuille de route commitée dans le projet : la personne l'a choisi.
  mem[STATE_KEY] = { where: 'repo', seen: {} }
  return { mem, files, sent, fault }
}
const start = ($: any) => $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
const settle = async (clock: { advance: (ms: number) => Promise<void> }, seconds: number) => {
  for (let i = 0; i < seconds; i++) await clock.advance(1000)
}
const openCoo = async ($: any, clock: { advance: (ms: number) => Promise<void> }): Promise<string> => {
  const loading = $.skill.prompt({ skill: COO, text: 'consignes du COO' })
  await settle(clock, 4)
  return (await loading).text
}
const pane = ($: any, surface: 'terminal' | 'desktop' = 'desktop') => $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
/** Ce que le mod a demandé au Claude du COO depuis la vue (ses envois, d'origine plugin). */
const asks = (sent: readonly { text: string; origin?: { kind?: string } }[]) => sent.filter(s => s.text.startsWith('◆ COO')).map(s => s.text)

test('le titulaire du siège lit la feuille de route : la vue montre le jalon, les étapes, les idées, et le point prend la prochaine étape', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[FILE_PATH] = FILE
  await start($)
  const opening = await openCoo($, clock)
  expect(opening).toMatch(/Roadmap file \(write it there only\): « \/proj\/travail\/feuille-de-route\.md », committed in the project/)
  expect(opening).toMatch(/Next steps \(1\): « E1 » « à faire »: « Lancer le groupe C »/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    for (const text of [/^Feuille de route$/, /^Le COO suit les missions — fin : chaque mission passe par lui$/, /^Lancer le groupe C$/, /^un tableau des coûts · par mission$/, /^Prochaine étape du projet : Lancer le groupe C \(E1\)\.$/]) {
      expect(await ui.find({ type: 'Text', text }), `${surface} ${text}`).toBeDefined()
    }
    // Une idée écartée ne se montre plus, mais reste dans le fichier.
    expect(await ui.find({ type: 'Text', text: /tout refaire en Rust/ })).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
  // Les entrées vues sont gardées, avec leur dernière version.
  expect(Object.keys(state(w)?.seen ?? {}).sort()).toEqual(['E1', 'I1', 'I2', 'J1', 'R1'])
})

test('une entrée qui disparaît est montrée en alerte avec sa dernière version, et « ↺ Remettre » demande au COO de la remettre', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[FILE_PATH] = FILE
  await start($)
  await openCoo($, clock)
  // R1 disparaît du fichier (une écriture qui l'a perdue).
  w.files[FILE_PATH] = FILE.replace(/^- \[R1\].*\n/m, '')
  await settle(clock, 6)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /Entrées disparues de la feuille de route · 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- \[R1\] rattachée à Mode auto/ })).toBeDefined()
  await ui.press({ key: 'coo-restore-R1' })
  await ui.unmount()
  const ask = asks(w.sent).at(-1) ?? ''
  expect(ask).toMatch(/l'entrée R1 a disparu de la feuille de route\. Remets-la exactement telle qu'elle était à sa dernière lecture, dans la section « À reprendre », puis commite-la par son chemin/)
  expect(ask).toContain('rattach\\u00e9e \\u00e0 Mode auto')
  // Rien de ce qui est gardé ne part : R1 reste vue, avec sa dernière version.
  expect(state(w)?.seen?.R1?.line).toMatch(/^- \[R1\]/)
  // Le relevé du tour suivant le dit aussi à Claude.
  await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any)
  const statement = (w.sent.at(-1)?.context ?? []).find(c => /COO statement/.test(c)) ?? ''
  expect(statement).toMatch(/ENTRIES THAT DISAPPEARED \(1\)/)
})

test('un fichier hors format : rien n’en est montré, « ↺ Réparer » le demande, et les entrées gardées ne bougent pas', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[FILE_PATH] = FILE
  await start($)
  await openCoo($, clock)
  const kept = JSON.stringify(state(w)?.seen)
  w.files[FILE_PATH] = `${FILE}texte libre\n`
  await settle(clock, 6)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /Feuille de route hors format/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Lancer le groupe C$/ })).toBeUndefined()
  await ui.press({ key: 'coo-repair' })
  await ui.unmount()
  expect(asks(w.sent).at(-1)).toMatch(/la feuille de route est hors format\. Répare-la/)
  expect(JSON.stringify(state(w)?.seen)).toBe(kept)
})

test('ce que le mod garde de la feuille de route ne se lit pas : rien n’est montré, rien n’est proposé, rien n’est écrit', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[FILE_PATH] = FILE
  await start($)
  await openCoo($, clock)
  const kept = JSON.stringify(state(w))
  w.fault.state = true
  w.files[FILE_PATH] = FILE.replace(/^- \[R1\].*\n/m, '')
  await settle(clock, 6)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /Feuille de route illisible/ })).toBeDefined()
  expect(await ui.find({ key: 'coo-restore-R1' })).toBeUndefined()
  await ui.unmount()
  await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any)
  const statement = (w.sent.at(-1)?.context ?? []).find(c => /COO statement/.test(c)) ?? ''
  expect(statement).toMatch(/Roadmap: it could not be read/)
  w.fault.state = false
  expect(JSON.stringify(state(w))).toBe(kept)
})

test('« Plus tard » et « Écarter » d’une idée demandent au COO, qui seul écrit la feuille de route ; écarter demande d’abord la raison', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[FILE_PATH] = FILE
  await start($)
  await openCoo($, clock)
  const ui = await pane($)
  await ui.press({ key: 'coo-later-I1' })
  await ui.press({ key: 'coo-drop-I1' })
  await ui.unmount()
  const [later, drop] = asks(w.sent)
  expect(later).toMatch(/passe l'idée I1 de la feuille de route au statut « plus tard »/)
  expect(drop).toMatch(/Demande-moi d'abord ma raison/)
  // Le mod n'a rien écrit dans le fichier.
  expect(w.files[FILE_PATH]).toBe(FILE)
})

test('où vit la feuille de route : sans choix, la vue pose la question ; le clic est gardé par projet', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.mem[STATE_KEY] = { seen: {} }
  await start($)
  expect(await openCoo($, clock)).toMatch(/Roadmap file/)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /la commiter dans ce projet \?/ })).toBeDefined()
  await ui.press({ key: 'coo-where-repo' })
  await ui.unmount()
  expect(state(w)?.where).toBe('repo')
  const after = await pane($)
  expect(await after.find({ type: 'Text', text: /la commiter dans ce projet \?/ })).toBeUndefined()
  await after.unmount()
})

test('la vue du COO porte la bascule de la revue de sécurité du projet : jamais réglée, désactivée ; un clic l’active', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  // Un dossier listé : les fichiers écrits dessous (le réglage absent s'y constate).
  on('fs.list', (_$: unknown, e: { path?: string }) => {
    const dir = (e.path ?? '').replace(/\/+$/, '')
    const names = new Set(Object.keys(w.files).filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1).split('/')[0]!))
    return { value: [...names].map(name => ({ name, kind: 'file', size: 0, mtimeMs: 0, isLink: false })) } as any
  })
  w.files[FILE_PATH] = FILE
  await start($)
  await openCoo($, clock)
  const label = async (): Promise<string> => {
    const ui = await pane($)
    const found = String((await ui.find({ key: 'coo-security-toggle' }))?.props?.label ?? '')
    await ui.unmount()
    return found.replace(/ /g, ' ')
  }
  expect(await label()).toBe('⛨ Sécurité : désactivée')
  const ui = await pane($)
  await ui.press({ key: 'coo-security-toggle' })
  await ui.unmount()
  // Gardé à part de la feuille de route : son fichier du poste, ou sa clé de `$.store`.
  const path = Object.keys(w.files).find(p => p.endsWith('.revue-securite.json'))
  expect((path ? JSON.parse(w.files[path]!) : w.mem[`security-review:${ROOT}`])?.review).toBe('on')
  expect(await label()).toBe('⛨ Sécurité : activée')
  // Rien n'est demandé au Claude du COO : le clic écrit le seul réglage.
  expect(asks(w.sent)).toEqual([])
})

test('une discussion qui ne tient pas le siège ne garde rien de la feuille de route', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[FILE_PATH] = FILE
  // Une autre discussion tient le siège, vivante.
  const board = { v: 1, root: ROOT, name: 'proj', runs: [], activeId: null, deleted: [], coo: { by: 'session-B', at: NOW - 1_000, seenAt: NOW - 1_000 } }
  w.mem[`board:${ROOT}`] = board
  await start($)
  expect(await openCoo($, clock)).toMatch(/held by another live discussion/)
  await settle(clock, 6)
  expect(state(w)?.seen ?? {}).toEqual({})
})

test('une entrée relue de la feuille de route n’ajoute ni ligne ni citation au relevé (corpus hostile)', () => {
  const roadmapOf = (token: string): CooRoadmap => ({
    where: 'repo',
    path: '/proj/travail/feuille-de-route.md',
    read: { ok: true, entries: [{ id: 'E1', section: 'Prochaines étapes', status: 'à faire', date: '2026-11-02', source: 'COO', text: `Étape${token}x`, line: `- [E1] à faire · 2026-11-02 · COO · Étape${token}x` }] },
    gone: [{ id: 'R1', line: `- [R1] à décider · 2026-11-02 · COO · Reste${token}x`, section: 'À reprendre', seenAt: 1 }],
    goneTexts: [{ id: 'I1', text: `Vieux${token}x`, line: `- [I1] à lancer · 2026-11-01 · Mathis · Vieux${token}x`, section: 'Idées', seenAt: 1 }],
  })
  const text = (token: string) => statementText(cooStatement({ ...emptyBoard('/p', 'p') }, { now: 1, roadmap: roadmapOf(token) }))
  const reference = text('')
  for (const [name, token] of Object.entries(CORPUS)) {
    const t = text(token)
    expect(t.split('\n').length, name).toBe(reference.split('\n').length)
    expect((t.match(/«/g) ?? []).length, name).toBe((reference.match(/«/g) ?? []).length)
  }
})

// ─── Correctifs de la passe « bogues » ───────────────────────────────────

test('le relevé donne la dernière version d’une entrée disparue exacte, en chaîne JSON entière, avec sa section', () => {
  const line = `- [R1] à décider · 2026-11-02 · mission « Mode auto », compte rendu · ${'très long texte '.repeat(30)}`
  const roadmap: CooRoadmap = { where: 'repo', path: '/proj/travail/feuille-de-route.md', read: { ok: true, entries: [] }, gone: [{ id: 'R1', line, section: 'À reprendre', seenAt: 1 }] }
  const text = statementText(cooStatement({ ...emptyBoard('/p', 'p') }, { now: 1, roadmap }))
  expect(text).toContain(`in section « À reprendre », last version as a JSON string, to copy exactly: ${JSON.stringify(line).replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}`)
})

test('un fichier absent alors que des entrées ont été vues : le relevé fait rétablir, jamais repartir de zéro', () => {
  const roadmap: CooRoadmap = { where: 'repo', path: '/proj/travail/feuille-de-route.md', read: null, gone: [{ id: 'J1', line: '- [J1] en cours · 2026-11-02 · Mathis · But', section: 'Jalons', seenAt: 1 }], previous: '/c/flow-board/coordination/proj.feuille-de-route.md' }
  const text = statementText(cooStatement({ ...emptyBoard('/p', 'p') }, { now: 1, roadmap }))
  expect(text).toMatch(/missing at this path although 1 entries were seen: rebuild it/)
  expect(text).toMatch(/Its previous place still holds a file/)
  expect(text).not.toMatch(/does not exist yet/)
})

test('les demandes des boutons : un commit seulement quand la feuille de route vit dans le projet ; un id hors forme ne demande rien', () => {
  const base: CooRoadmap = { where: 'poste', path: '/h/x.feuille-de-route.md', read: { ok: true, entries: [] }, gone: [{ id: 'R1', line: '- [R1] à décider · 2026-11-02 · COO · x', section: 'À reprendre', seenAt: 1 }] }
  for (const d of [{ kind: 'later', id: 'I1' }, { kind: 'drop', id: 'I1' }, { kind: 'restore', id: 'R1' }, { kind: 'repair' }] as const) {
    expect(roadmapAsk(d, base)).toMatch(/pas de commit/)
    expect(roadmapAsk(d, base)).not.toMatch(/commite/)
    expect(roadmapAsk(d, { ...base, where: 'repo' })).toMatch(/commite-la par son chemin/)
  }
  expect(roadmapAsk({ kind: 'later', id: 'I1"; rm' }, base)).toBeNull()
  expect(roadmapAsk({ kind: 'restore', id: 'R9' }, base)).toBeNull()
  expect(roadmapAsk({ kind: 'later', id: 'I1' }, { ...base, read: 'unread' })).toBeNull()
})

test('les entrées vues : une valeur hors forme ne se lit pas (null), l’union ne retire rien, une lecture inchangée ne réécrit rien', () => {
  expect(soundSeen({ R1: { line: 'x', section: 'À reprendre', seenAt: 1 } })).toEqual({ R1: { line: 'x', section: 'À reprendre', seenAt: 1 } })
  for (const bad of ['texte', [1], { R1: { section: 'À reprendre', seenAt: 1 } }, { 'r-1': { line: 'x', section: 'À reprendre', seenAt: 1 } }, { R1: { line: 'x', section: 'Autre', seenAt: 1 } }]) expect(soundSeen(bad)).toBeNull()
  const a = { R1: { line: 'a', section: 'À reprendre' as const, seenAt: 1 } }
  const b = { I1: { line: 'b', section: 'Idées' as const, seenAt: 2 }, R1: { line: 'a2', section: 'À reprendre' as const, seenAt: 3 } }
  // Pour un même id, la version vue le plus récemment ; l'autre texte reste parmi ses textes précédents.
  expect(unionSeen(a, b)).toEqual({ R1: { line: 'a2', section: 'À reprendre', seenAt: 3, earlier: [{ text: 'a', line: 'a', section: 'À reprendre', seenAt: 1 }] }, I1: { line: 'b', section: 'Idées', seenAt: 2 } })
  expect(Object.keys(unionSeen(b, { E1: { line: 'c', section: 'Prochaines étapes', seenAt: 1 } })).sort()).toEqual(['E1', 'I1', 'R1'])
  const first = watchRoadmap({}, parseRoadmap(FILE), 1_000)
  expect(watchRoadmap(first.seen, parseRoadmap(FILE), 2_000).seen).toEqual(first.seen)
})

test('l’id d’une entrée (isRoadmapId) refuse chaque entrée du corpus hostile', () => {
  expect(isRoadmapId('R12')).toBe(true)
  expect(Object.entries(CORPUS).filter(([, token]) => isRoadmapId(`R${token}1`)).map(([name]) => name)).toEqual([])
})

test('l’exemple de format, recopié dans les consignes du COO, se lit (feuille-de-route-consignes.test.mjs vérifie la copie)', () => {
  expect(parseRoadmap(ROADMAP_EXAMPLE).ok).toBe(true)
})

// ─── Correctifs de la passe qui relit les correctifs ─────────────────────

test('changer d’endroit n’écrase jamais : le nouveau fichier qui existe déjà reçoit seulement les entrées qui lui manquent', () => {
  const merge = roadmapMoveAsk('/h/x.feuille-de-route.md', '/proj/travail/feuille-de-route.md', true, 'repo')
  expect(merge).toMatch(/existe déjà : ajoute-lui, sans rien y retirer ni remplacer, les entrées de l'ancien/)
  expect(merge).not.toMatch(/Recopie-la telle quelle/)
  const copy = roadmapMoveAsk('/h/x.feuille-de-route.md', '/proj/travail/feuille-de-route.md', false, 'poste')
  expect(copy).toMatch(/Recopie-la telle quelle/)
  expect(copy).not.toMatch(/commite/)
})

test('sans choix ici, une feuille de route déjà commitée dans le projet est signalée, jamais à recopier sur le poste', () => {
  const roadmap: CooRoadmap = { where: 'unasked', path: '/c/x.feuille-de-route.md', read: null, gone: [], committed: '/proj/travail/feuille-de-route.md' }
  const text = statementText(cooStatement({ ...emptyBoard('/p', 'p') }, { now: 1, roadmap }))
  expect(text).toMatch(/already holds a committed roadmap/)
  expect(text).not.toMatch(/previous place/)
})

test('un état gardé hors forme est mis de côté tel quel, jamais effacé, et la surveillance repart', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[FILE_PATH] = FILE
  // Ce que le mod gardait ne se lit plus comme un état (une écriture coupée, une retouche).
  w.mem[STATE_KEY] = 'pas un état'
  const stateFile = Object.keys(w.files).find(isStateFile)
  if (stateFile) w.files[stateFile] = '{ coupé'
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  // La copie mise de côté garde le texte relu tel quel (au fichier du poste, ou dans `$.store`).
  const aside = [...Object.entries(w.files).filter(([k]) => k.includes('.feuille-de-route.json.illisible-')), ...Object.entries(w.mem).filter(([k]) => k.startsWith(`${STATE_KEY}:illisible:`))]
  expect(aside.length).toBe(1)
  // Le choix de l'endroit était dans l'état perdu : la vue repose la question, et la réponse fait reprendre la surveillance.
  const ask = await pane($)
  await ask.press({ key: 'coo-where-repo' })
  await ask.unmount()
  await settle(clock, 6)
  expect(Object.keys(state(w)?.seen ?? {}).sort()).toEqual(['E1', 'I1', 'I2', 'J1', 'R1'])
  // La surveillance a repris : une entrée retirée est de nouveau signalée.
  w.files[FILE_PATH] = FILE.replace(/^- \[R1\].*\n/m, '')
  await settle(clock, 6)
  const ui = await pane($)
  expect(await ui.find({ key: 'coo-restore-R1' })).toBeDefined()
  await ui.unmount()
})

// ─── Texte changé sous le même id ────────────────────────────────────────
// « Une entrée » comprend chacun de ses textes déjà vus : un ancien texte qui n'est plus nulle part dans
// le fichier est une disparition.

test('un texte réécrit sous le même id alerte une fois ; un ancien texte encore présent sous un autre id n’alerte pas comme texte changé', () => {
  const first = watchRoadmap({}, parseRoadmap(FILE), 1_000)
  // Renumérotation : I1 prend un autre texte, et son ancien texte passe sous I7.
  const moved = FILE.replace('[I1] à lancer · 2026-11-01 · Mathis · un tableau des coûts · par mission', '[I1] à lancer · 2026-11-01 · Mathis · une page des réglages\n- [I7] à lancer · 2026-11-01 · Mathis · un tableau des coûts · par mission')
  const renumbered = watchRoadmap(first.seen, parseRoadmap(moved), 2_000)
  expect(renumbered.seen.I1!.earlier?.map(t => t.text)).toEqual(['un tableau des coûts · par mission'])
  expect(renumbered.goneTexts).toEqual([])
  expect(renumbered.gone).toEqual([])
  // Un id retiré dont le texte vit sous un autre id reste, lui, une entrée disparue (alerte d'entrée).
  expect(watchRoadmap(first.seen, parseRoadmap(FILE.replace('[I1] à lancer', '[I7] à lancer')), 2_000).gone.map(g => g.id)).toEqual(['I1'])
  // Une autre chose écrite sous I1 : l'ancien texte n'est plus nulle part.
  const rewritten = watchRoadmap(first.seen, parseRoadmap(FILE.replace('un tableau des coûts · par mission', 'une page des réglages')), 2_000)
  expect(rewritten.gone).toEqual([])
  expect(rewritten.goneTexts.map(g => [g.id, g.text, g.section])).toEqual([['I1', 'un tableau des coûts · par mission', 'Idées']])
  expect(rewritten.goneTexts[0]!.line).toBe('- [I1] à lancer · 2026-11-01 · Mathis · un tableau des coûts · par mission')
  // Les deux textes restent gardés pour I1, le nouveau comme dernière version.
  expect(rewritten.seen.I1!.line).toMatch(/une page des réglages$/)
  expect(rewritten.seen.I1!.earlier?.map(t => t.text)).toEqual(['un tableau des coûts · par mission'])
  // Remis sous un id neuf : plus d'alerte, rien n'est retiré.
  const restored = watchRoadmap(rewritten.seen, parseRoadmap(`${FILE.replace('un tableau des coûts · par mission', 'une page des réglages')}- [I8] à lancer · 2026-11-01 · Mathis · un tableau des coûts · par mission\n`), 3_000)
  expect(restored.goneTexts).toEqual([])
  expect(restored.seen.I1!.earlier?.map(t => t.text)).toEqual(['un tableau des coûts · par mission'])
})

test('un même texte n’alerte qu’une fois : ni à côté de l’alerte d’une entrée disparue qui le porte, ni sous deux ids', () => {
  const two = '## Idées\n- [I1] à lancer · 2026-11-01 · Mathis · a\n- [I2] à lancer · 2026-11-01 · Mathis · b\n'
  const first = watchRoadmap({}, parseRoadmap(two), 1)
  // I1 et I2 échangent leurs textes (aucune alerte), puis le fichier est vidé.
  const swapped = watchRoadmap(first.seen, parseRoadmap(two.replace('· a\n', '· x\n').replace('· b\n', '· a\n').replace('· x\n', '· b\n')), 2)
  expect(swapped.goneTexts).toEqual([])
  const emptied = watchRoadmap(swapped.seen, parseRoadmap('## Idées\n'), 3)
  expect(emptied.gone.map(g => g.id).sort()).toEqual(['I1', 'I2'])
  expect(emptied.goneTexts).toEqual([])
  // « a » remis sous I8 puis réécrit en « c » : « a » est l'ancien texte de I1 et de I8, une seule alerte.
  const one = '## Idées\n- [I1] à lancer · 2026-11-01 · Mathis · a\n'
  const s1 = watchRoadmap({}, parseRoadmap(one), 1).seen
  const s2 = watchRoadmap(s1, parseRoadmap(one.replace('· a', '· b')), 2).seen
  const s3 = watchRoadmap(s2, parseRoadmap(`${one.replace('· a', '· b')}- [I8] à lancer · 2026-11-01 · Mathis · a\n`), 3).seen
  // I8 passe « plus tard » avant d'être réécrit : l'alerte garde sa version, la plus récente, pas celle de I1.
  const s35 = watchRoadmap(s3, parseRoadmap(`${one.replace('· a', '· b')}- [I8] plus tard · 2026-11-01 · Mathis · a\n`), 3.5).seen
  const s4 = watchRoadmap(s35, parseRoadmap(`${one.replace('· a', '· b')}- [I8] plus tard · 2026-11-01 · Mathis · c\n`), 4)
  expect(s4.goneTexts.map(g => [g.id, g.line, g.section])).toEqual([['I8', '- [I8] plus tard · 2026-11-01 · Mathis · a', 'Idées']])
})

test('un ancien texte plus récent que l’entrée disparue qui le porte alerte aussi : sa version plus récente n’est pas perdue', () => {
  const s1 = watchRoadmap({}, parseRoadmap('## Idées\n- [I2] à lancer · 2026-11-01 · Mathis · a\n'), 1).seen
  // I2 est retiré ; plus tard, I1 porte « a » écartée, puis est réécrit en « b ».
  const s2 = watchRoadmap(s1, parseRoadmap('## Idées\n- [I1] écartée : raison X · 2026-11-01 · Mathis · a\n'), 5).seen
  const s3 = watchRoadmap(s2, parseRoadmap('## Idées\n- [I1] écartée : raison X · 2026-11-01 · Mathis · b\n'), 6)
  expect(s3.gone.map(g => [g.id, g.line])).toEqual([['I2', '- [I2] à lancer · 2026-11-01 · Mathis · a']])
  expect(s3.goneTexts.map(g => [g.id, g.line])).toEqual([['I1', '- [I1] écartée : raison X · 2026-11-01 · Mathis · a']])
  // I1 retiré à son tour : « b » est son entrée disparue, « a » reste l'alerte de sa version la plus récente.
  const s4 = watchRoadmap(s3.seen, parseRoadmap('## Idées\n'), 7)
  expect(s4.gone.map(g => g.id).sort()).toEqual(['I1', 'I2'])
  expect(s4.goneTexts.map(g => [g.id, g.text])).toEqual([['I1', 'a']])
})

test('un changement de statut, de date ou de source seul n’ajoute pas de texte', () => {
  const first = watchRoadmap({}, parseRoadmap(FILE), 1_000)
  const edited = FILE.replace('[I1] à lancer · 2026-11-01 · Mathis', '[I1] plus tard · 2026-11-03 · COO')
  const second = watchRoadmap(first.seen, parseRoadmap(edited), 2_000)
  expect(second.seen.I1!.line).toMatch(/\[I1\] plus tard · 2026-11-03 · COO/)
  expect(second.seen.I1!.earlier).toBeUndefined()
  expect(second.goneTexts).toEqual([])
})

test('l’ancien texte d’une entrée disparue alerte aussi ; son dernier texte reste l’alerte d’entrée disparue', () => {
  const first = watchRoadmap({}, parseRoadmap(FILE), 1_000)
  const rewritten = watchRoadmap(first.seen, parseRoadmap(FILE.replace('Lancer le groupe C', 'Lancer le groupe D')), 2_000).seen
  const emptied = watchRoadmap(rewritten, parseRoadmap(FILE.replace(/^- \[E1\].*\n/m, '')), 3_000)
  expect(emptied.gone.map(g => [g.id, g.line])).toEqual([['E1', '- [E1] à faire · 2026-11-02 · COO · Lancer le groupe D']])
  expect(emptied.goneTexts.map(g => [g.id, g.text])).toEqual([['E1', 'Lancer le groupe C']])
})

test('l’union de deux copies garde l’union des textes de chaque id, sans rien retirer, l’ancienne forme comprise', () => {
  const line = (t: string) => `- [I1] à lancer · 2026-11-01 · Mathis · ${t}`
  // Copie A : a vu « a » puis « b ». Copie B, d'une forme sans textes précédents : a vu « c », plus tard.
  const a: RoadmapSeen = { I1: { line: line('b'), section: 'Idées', seenAt: 2, earlier: [{ text: 'a', line: line('a'), section: 'Idées', seenAt: 1 }] } }
  const b: RoadmapSeen = { I1: { line: line('c'), section: 'Idées', seenAt: 3 } }
  for (const u of [unionSeen(a, b), unionSeen(b, a)]) {
    expect(u.I1!.line).toBe(line('c'))
    expect(u.I1!.earlier?.map(t => t.text)).toEqual(['a', 'b'])
  }
  // Deux copies de l'ancienne forme restent dans l'ancienne forme.
  expect(unionSeen({ R1: { line: 'x', section: 'À reprendre', seenAt: 1 } }, {})).toEqual({ R1: { line: 'x', section: 'À reprendre', seenAt: 1 } })
  // L'union garde chaque texte vu par l'une ou l'autre, et la surveillance qui suit les montre tous.
  const read = parseRoadmap(`## Idées\n${line('autre chose')}\n`)
  expect(watchRoadmap(unionSeen(a, b), read, 4).goneTexts.map(g => g.text).sort()).toEqual(['a', 'b', 'c'])
})

test('les entrées vues relues : avec ou sans textes précédents ; des textes précédents hors forme ne se lisent pas', () => {
  const ok = { I1: { line: 'x', section: 'Idées', seenAt: 2, earlier: [{ text: 'a', line: '- [I1] à lancer · 2026-11-01 · Mathis · a', section: 'Idées', seenAt: 1 }] } }
  expect(soundSeen(ok)).toEqual(ok)
  expect(partialSeen(ok)).toEqual({ seen: ok, isWhole: true })
  for (const earlier of ['a', [{ text: 1, line: 'x', section: 'Idées', seenAt: 1 }], [{ text: 'a', line: 'x', section: 'Autre', seenAt: 1 }], [{ text: 'a', line: 'x', section: 'Idées' }], [null]]) {
    const bad = { I1: { line: 'x', section: 'Idées', seenAt: 2, earlier } }
    expect(soundSeen(bad), JSON.stringify(earlier)).toBeNull()
    // Relue entrée par entrée : I1 garde sa dernière version, sans ses textes hors forme ; l'état n'est pas entier (mis de côté, B8).
    expect(partialSeen({ ...bad, R1: { line: 'y', section: 'À reprendre', seenAt: 1 } })).toEqual({ seen: { I1: { line: 'x', section: 'Idées', seenAt: 2 }, R1: { line: 'y', section: 'À reprendre', seenAt: 1 } }, isWhole: false })
  }
  // Un seul texte précédent hors forme : les autres restent.
  const mixed = { I1: { line: 'x', section: 'Idées', seenAt: 3, earlier: [{ text: 'a', line: 'la', section: 'Idées', seenAt: 1 }, { text: 'b', line: 'lb', section: 'Idées' }] } }
  expect(partialSeen(mixed)).toEqual({ seen: { I1: { line: 'x', section: 'Idées', seenAt: 3, earlier: [{ text: 'a', line: 'la', section: 'Idées', seenAt: 1 }] } }, isWhole: false })
  // Une entrée dont la dernière version est hors forme ne se lit pas.
  expect(partialSeen({ I1: { section: 'Idées', seenAt: 2, earlier: [] } })).toEqual({ seen: {}, isWhole: false })
})

test('un ancien texte disparu est montré en alerte, avec son id et sa section, et « ↺ Remettre » le fait remettre sous un id neuf', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  w.files[FILE_PATH] = FILE
  await start($)
  await openCoo($, clock)
  // Une autre chose écrite sous I1.
  w.files[FILE_PATH] = FILE.replace('un tableau des coûts · par mission', 'une page des réglages')
  await settle(clock, 6)
  // L'état gardé, partagé par l'app et le terminal, garde les deux textes.
  expect(state(w)?.seen?.I1?.line).toMatch(/une page des réglages$/)
  expect(JSON.stringify(state(w)?.seen?.I1)).toContain('un tableau des co')
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /Textes changés sous le même id · 1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- \[I1\] à lancer · 2026-11-01 · Mathis · un tableau des coûts · par mission$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ancien texte de I1 · Idées/ })).toBeDefined()
  // Pas de bouton pour accepter qu'il disparaisse : seulement « ↺ Remettre ».
  const key = `coo-restore-text-I1-${roadmapTextPrint('un tableau des coûts · par mission')}`
  expect(await ui.find({ key })).toBeDefined()
  await ui.press({ key })
  await ui.unmount()
  const ask = asks(w.sent).at(-1) ?? ''
  expect(ask).toMatch(/un ancien texte de l'entrée I1 n'est plus dans la feuille de route/)
  expect(ask).toMatch(/comme une nouvelle entrée sous un id neuf \(jamais utilisé\), dans la section « Idées »/)
  expect(ask).toMatch(/puis commite-la par son chemin/)
  expect(ask).toContain('un tableau des co\\u00fbts')
  // Le relevé du tour suivant le dit aussi à Claude.
  await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any)
  const statement = (w.sent.at(-1)?.context ?? []).find(c => /COO statement/.test(c)) ?? ''
  expect(statement).toMatch(/TEXTS CHANGED UNDER THE SAME ID \(1\)/)
  expect(statement).not.toMatch(/ENTRIES THAT DISAPPEARED/)
})

test('la demande de remise d’un ancien texte : seulement pour un texte relevé, désigné par son empreinte', () => {
  const g = { id: 'I1', text: 'a', line: '- [I1] à lancer · 2026-11-01 · Mathis · a', section: 'Idées' as const, seenAt: 1 }
  const base: CooRoadmap = { where: 'poste', path: '/h/x.feuille-de-route.md', read: { ok: true, entries: [] }, gone: [], goneTexts: [g] }
  const print = roadmapTextPrint(g.text)
  expect(roadmapAsk({ kind: 'restore-text', id: 'I1', print }, base)).toMatch(/pas de commit/)
  expect(roadmapAsk({ kind: 'restore-text', id: 'I1', print: roadmapTextPrint('b') }, base)).toBeNull()
  // L'id du bouton peut dater d'un relevé plus ancien : la demande prend celui du relevé du moment.
  expect(roadmapAsk({ kind: 'restore-text', id: 'I2', print }, base)).toMatch(/un ancien texte de l'entrée I1 /)
  expect(roadmapAsk({ kind: 'restore-text', id: 'I1"; rm', print }, base)).toBeNull()
})

// ─── Copie mise de côté de l'état gardé (B8, C6) ─────────────────────────
// Le COO signale chaque copie de l'état gardé qui ne se lisait plus, pour que la personne la recopie avec lui ; rien n'est effacé.

test('le relevé nomme chaque copie mise de côté de l’état gardé et la fait montrer à la personne, sans jamais l’effacer', () => {
  const file = '/c/flow-board/coordination/proj-ab12.feuille-de-route.json.illisible-1000'
  const key = 'coo-roadmap:/proj:illisible:2000'
  const roadmap: CooRoadmap = { where: 'repo', path: '/proj/travail/feuille-de-route.md', read: { ok: true, entries: [] }, gone: [], asides: [file, key] }
  const text = statementText(cooStatement({ ...emptyBoard('/p', 'p') }, { now: 1, roadmap }))
  expect(text).toContain(`What the dashboard kept of the roadmap could not be read and was set aside as it was, at « ${file} »`)
  expect(text).toMatch(/show it to the user and copy back together what it held \(the place chosen for the roadmap, the entries seen\): compare the entries it lists, with their last versions, to the roadmap file, and put back in the roadmap file, with the user's agreement, each one missing from it/)
  // La copie se recopie dans la feuille de route, jamais dans l'état gardé, et l'endroit se rechoisit par les boutons de la vue.
  expect(text).toMatch(/chosen again with the two buttons of the Coordination view; never write what the dashboard keeps by hand, and never delete the copy/)
  expect(text).toContain(`in the dashboard's own storage, under the key « ${key} » (no file you can read)`)
  // Une feuille de route illisible n'empêche pas de signaler la copie.
  const unread = statementText(cooStatement({ ...emptyBoard('/p', 'p') }, { now: 1, roadmap: { ...roadmap, read: 'unread' } }))
  expect(unread).toContain(`at « ${file} »`)
})

test('un état gardé mis de côté : la vue le montre sur une ligne et le relevé le nomme ; une lecture ratée des copies ne montre rien et ne bloque rien', { timeoutMs: 25000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on)
  const listFault = { on: false }
  on('fs.list', (_$: unknown, e: { path: string }) => {
    if (listFault.on) throw new Error(`EIO ${e.path}`)
    const prefix = `${e.path.replace(/\/+$/, '')}/`
    return { value: Object.keys(w.files).filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(k => ({ name: k.slice(prefix.length), kind: 'file' })) } as any
  })
  on('store.keys', () => {
    if (listFault.on) throw new Error('lecture ratée')
    return { value: Object.keys(w.mem) } as any
  })
  w.files[FILE_PATH] = FILE
  w.mem[STATE_KEY] = 'pas un état'
  await start($)
  await openCoo($, clock)
  await settle(clock, 6)
  const aside = [...Object.keys(w.files).filter(k => k.includes('.feuille-de-route.json.illisible-')), ...Object.keys(w.mem).filter(k => k.startsWith(`${STATE_KEY}:illisible:`))]
  expect(aside.length).toBe(1)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: `État de la feuille de route mis de côté : ${aside[0]}` }), surface).toBeDefined()
    await ui.unmount()
  }
  await $.prompt.submit({ text: 'où en est-on ?', origin: { kind: 'composer' } } as any)
  const statement = (w.sent.at(-1)?.context ?? []).find(c => /COO statement/.test(c)) ?? ''
  expect(statement).toContain(`« ${aside[0]} »`)
  // La liste des copies ne se lit plus : aucune ligne fausse, et le reste de la vue reste montré.
  listFault.on = true
  await settle(clock, 6)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /mis de côté/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /la commiter dans ce projet \?/ })).toBeDefined()
  await ui.unmount()
  // La copie n'est jamais effacée.
  expect([...Object.keys(w.files), ...Object.keys(w.mem)]).toContain(aside[0])
})

// Une chose à reprendre corrigée par une mission prend l'état « faite : <mission>, ticket <n> » (ou « tickets
// <n>, <m> »), écrit par le COO au relevé de la mission close. Invariant : une feuille de route lisible avant le
// reste ; une entrée « faite : » ne quitte jamais le fichier ni la mémoire du mod, et n'est jamais montrée ouverte.
const DONE = `${FILE}- [R2] faite : Parcours de triage fiable, ticket 03 · 2026-11-04 · mission « Tri », compte rendu · un texte\n- [R3] faite : Titre, tickets 03, 07 · 2026-11-05 · COO · un autre texte\n- [R4] à décider · 2026-11-05 · COO · encore ouvert\n- [R5] plus tard · 2026-11-05 · COO · pour plus tard\n`

test('une chose à reprendre « faite : <mission>, ticket(s) … » se lit avec son id, sa date, sa source et son texte', () => {
  const read = parseRoadmap(DONE)
  expect(read.ok).toBe(true)
  if (!read.ok) return
  const done = read.entries.filter(e => e.status.startsWith('faite : '))
  expect(done.map(e => [e.id, e.section, e.status, e.date, e.source, e.text])).toEqual([
    ['R2', 'À reprendre', 'faite : Parcours de triage fiable, ticket 03', '2026-11-04', 'mission « Tri », compte rendu', 'un texte'],
    ['R3', 'À reprendre', 'faite : Titre, tickets 03, 07', '2026-11-05', 'COO', 'un autre texte'],
  ])
  // La feuille de route d'avant se lit toujours, avec les mêmes entrées.
  const before = parseRoadmap(FILE)
  expect(before.ok).toBe(true)
  if (before.ok) expect(read.entries.slice(0, before.entries.length)).toEqual(before.entries)
})

test('« faite : » sans suite ou « faite » seul dans « À reprendre », et « faite : x » ailleurs qu’à reprendre, sont refusés ; « faite » reste une étape', () => {
  const cases: [string, RegExp][] = [
    [`${FILE}- [R9] faite : · 2026-11-02 · COO · x\n`, /statut « faite : » inconnu dans « À reprendre »/],
    [`${FILE}- [R9] faite · 2026-11-02 · COO · x\n`, /statut « faite » inconnu dans « À reprendre »/],
    [`${FILE}- [R9] faite: Titre, ticket 03 · 2026-11-02 · COO · x\n`, /statut « faite: Titre, ticket 03 » inconnu dans « À reprendre »/],
    [FILE.replace('## Idées\n', '## Idées\n- [I9] faite : Titre, ticket 03 · 2026-11-02 · COO · x\n'), /inconnu dans « Idées »/],
    [FILE.replace('## Jalons\n', '## Jalons\n- [J9] faite : Titre, ticket 03 · 2026-11-02 · COO · x\n'), /inconnu dans « Jalons »/],
  ]
  for (const [text, why] of cases) {
    const read = parseRoadmap(text)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.why).toMatch(why)
  }
  const step = parseRoadmap(FILE.replace('[E1] à faire', '[E1] faite'))
  expect(step.ok && step.entries.find(e => e.id === 'E1')!.status).toBe('faite')
})

test('une chose « faite : … » n’est pas parmi les choses à reprendre ouvertes que montrent la vue et le relevé', () => {
  const now = roadmapNow({ where: 'poste', path: '/x/feuille-de-route.md', read: parseRoadmap(DONE), gone: [] })
  expect(now.pending.map(e => e.id)).toEqual(['R4', 'R5'])
})

// Les entrées rattachées viennent d'une liste à part ; `pending`, que lisent le relevé et le point
// d'ouverture du COO, ne les prend jamais.
test('une chose « rattachée à … » est dans la liste à part des entrées rattachées, jamais parmi les choses à reprendre ouvertes', () => {
  const text = `${DONE}- [R6] lancée · 2026-11-05 · COO · déjà lancée\n- [R7] écartée : doublon · 2026-11-05 · COO · écartée\n`
  const now = roadmapNow({ where: 'poste', path: '/x/feuille-de-route.md', read: parseRoadmap(text), gone: [] })
  expect(now.pending.map(e => e.id)).toEqual(['R4', 'R5'])
  expect(now.attached.map(e => [e.id, e.status])).toEqual([['R1', 'rattachée à Mode auto']])
  const opening = statementText(cooStatement(emptyBoard('/p', 'p'), { now: 1, roadmap: { where: 'poste', path: '/x/feuille-de-route.md', read: parseRoadmap(text), gone: [] } }))
  expect(opening).toMatch(/Set aside, to decide \(2\): .*encore ouvert/)
  expect(opening).not.toMatch(/le README cite encore/)
})

test('une entrée qui passe de « rattachée à … » à « faite : … » n’est ni disparue ni dite changée de texte, et reste gardée', () => {
  const first = watchRoadmap({}, parseRoadmap(FILE), 1_000)
  const edited = FILE.replace('[R1] rattachée à Mode auto · 2026-11-02', '[R1] faite : Mode auto, ticket 03 · 2026-11-02')
  const second = watchRoadmap(first.seen, parseRoadmap(edited), 2_000)
  expect(second.gone).toEqual([])
  expect(second.goneTexts).toEqual([])
  expect(second.seen.R1!.line).toMatch(/\[R1\] faite : Mode auto, ticket 03 · /)
  expect(second.seen.R1!.earlier).toBeUndefined()
  // Une lecture hors format ensuite ne retire rien de ce qui est gardé.
  const broken = watchRoadmap(second.seen, parseRoadmap(`${edited}texte libre\n`), 3_000)
  expect(broken.seen.R1!.line).toBe(second.seen.R1!.line)
})
