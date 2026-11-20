import { expect, test } from 'claude-code/testing'

import { attachmentOf, cooStatement, statementText, type CooGlean, type CooRoadmap } from '../hooks/coo.ts'
import { coordinationRows } from '../hooks/coo-view.tsx'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { parseRoadmap, watchRoadmap } from '../hooks/roadmap.ts'
import type { Run } from '../types'

// « rattachée à » porte le numéro court de la mission, vérifié par son titre (depuis le 17/11/2026).
// Invariant : « Un état « rattachée à » n'est jamais changé à partir d'une entrée dont le numéro et le titre désignent
// des missions différentes, et aucune entrée déjà écrite n'est réécrite par ce changement. »

const NOW = 700_000_000
const ROOT = '/proj'

const run = (id: string, title: string, status: Run['status']): Run => ({ ...newRun('implement', NOW - 90_000, title), id, status, updatedAt: NOW - 1_000, ...(status === 'done' ? { finishedAt: NOW - 2_000 } : {}) }) as Run

const roadmapOf = (lines: string[]): CooRoadmap => ({
  where: 'poste',
  path: '/x/feuille-de-route.md',
  read: parseRoadmap(`# Feuille de route\n\n## Jalons\n## Prochaines étapes\n## Idées\n## À reprendre\n${lines.map(l => `${l}\n`).join('')}`),
  gone: [],
})
const entry = (id: string, status: string) => `- [${id}] ${status} · 2026-11-10 · COO · la chose ${id}`

const MISSIONS = [{ id: 'm1', title: 'Tri' }, { id: 'm2', title: 'Export' }, { id: 'm4', title: 'M3 - Essai' }]
const NUMBERS = { m1: 5, m2: 7, m4: 8 }

test('la table des formes : chaque forme de « rattachée à » a son sort', () => {
  const of = (status: string, numbers: Record<string, number> = NUMBERS, missions = MISSIONS) => attachmentOf(status, missions, numbers)
  // Sans numéro : par le titre.
  expect(of('rattachée à Tri')).toEqual({ kind: 'mission', id: 'm1', byNumber: false })
  // Avec numéro, M<n> porte ce titre : rattachée à M<n>.
  expect(of('rattachée à M5 - Tri')).toEqual({ kind: 'mission', id: 'm1', byNumber: true })
  // Même forme, M<n> porte un autre titre : désaccord, avec l'entrée, M<n> et les deux titres.
  expect(of('rattachée à M7 - Tri')).toEqual({ kind: 'mismatch', id: 'm2', tag: 'M7', written: 'Tri', current: 'Export' })
  // Même forme, M<n> que la table ne donne à personne (table refaite, effacée, d'un autre poste) : rien ne change.
  expect(of('rattachée à M9 - Tri')).toEqual({ kind: 'unverifiable', tag: 'M9', written: 'Tri', why: 'unheld' })
  // Un titre qui commence par « M<n> - », écrit sans numéro : M3 absent, puis M3 présent avec un autre reste.
  expect(of('rattachée à M3 - Essai')).toEqual({ kind: 'mission', id: 'm4', byNumber: false })
  expect(of('rattachée à M3 - Essai', { ...NUMBERS, m2: 3 })).toEqual({ kind: 'mission', id: 'm4', byNumber: false })
  // Le même, avec son numéro devant.
  expect(of('rattachée à M8 - M3 - Essai')).toEqual({ kind: 'mission', id: 'm4', byNumber: true })
  // Un titre partagé par deux missions : ambigu sans numéro, résolu par un numéro qui concorde.
  const twins = [...MISSIONS, { id: 'm3', title: 'Tri' }]
  expect(of('rattachée à Tri', NUMBERS, twins)).toEqual({ kind: 'shared', title: 'Tri' })
  expect(of('rattachée à M5 - Tri', NUMBERS, twins)).toEqual({ kind: 'mission', id: 'm1', byNumber: true })
  expect(of('rattachée à M9 - Tri', NUMBERS, twins)).toEqual({ kind: 'unverifiable', tag: 'M9', written: 'Tri', why: 'unheld' })
  // Une mission inconnue, et un « · » de titre écrit « - ».
  expect(of('rattachée à Personne')).toEqual({ kind: 'unknown', title: 'Personne' })
  expect(of('rattachée à M5 - Tri - un', NUMBERS, [{ id: 'm1', title: 'Tri · un' }])).toEqual({ kind: 'mission', id: 'm1', byNumber: true })
  // Une table lue qui ne donne M7 à personne : rien ne change, jamais par le titre écrit.
  expect(of('rattachée à M7 - Tri', {})).toEqual({ kind: 'unverifiable', tag: 'M7', written: 'Tri', why: 'unheld' })
  expect(of('à décider')).toBeNull()
})

const gleanLine = (over: { lines: string[]; numbers?: Record<string, number>; runs?: Run[]; glean?: Partial<CooGlean> }): string => {
  const runs = over.runs ?? [run('m1', 'Tri', 'done'), run('m2', 'Export', 'active')]
  const g: CooGlean = { id: 'm1', title: 'Tri', reports: [], untaken: [], report: '/h/r/m1.md', reportValidated: true, reportRound: '1.0.5', ...over.glean }
  const numbers = { state: 'read' as const, runs: over.numbers ?? { m1: 5, m2: 7 }, cards: {} }
  const s = cooStatement({ ...emptyBoard(ROOT, 'proj'), runs }, { now: NOW, toGlean: [g], roadmap: roadmapOf(over.lines), numbers })
  return statementText(s).split('\n').find(l => l.startsWith('Closed mission '))!
}

test('le relevé d’une mission close liste les entrées qui lui sont rattachées, sous les deux formes, et seulement elles', () => {
  const line = gleanLine({ lines: [entry('R1', 'rattachée à M5 - Tri'), entry('R2', 'rattachée à Tri'), entry('R3', 'rattachée à M7 - Export'), entry('R4', 'rattachée à M9 - Tri'), entry('R5', 'à décider')] })
  expect(line).toMatch(/update only the « À reprendre » entries attached to this mission that this line lists/)
  expect(line).toMatch(/The « À reprendre » entries attached to this mission, as the dashboard reads them \(« rattachée à M5 - <its title> » or « rattachée à <its title> »\): « R1 », « R2 »\./)
  // R4 : un numéro que la table ne donne à personne, jamais parmi les siennes, dit à part.
  expect(line).toMatch(/Entry « R4 » reads « rattachée à M9 - Tri », but no mission holds M9 in the numbers table/)
  expect(line).not.toMatch(/« R3 »|« R5 »/)
})

test('un numéro et un titre qui désignent deux missions : rien ne change d’après l’entrée, et le COO le dit avec l’entrée, M<n> et les deux titres', () => {
  // M5 est la mission relevée, mais le titre écrit n'est pas le sien ; M7 porte un autre titre que celui de la mission relevée.
  const line = gleanLine({ lines: [entry('R1', 'rattachée à M5 - Ancien titre'), entry('R2', 'rattachée à M7 - Tri')] })
  expect(line).toMatch(/: none\./)
  expect(line).toMatch(/Entry « R1 » reads « rattachée à M5 - Ancien titre », but M5 is « Tri » in this statement: its number and its title name two different missions \(a mission renamed since, or archived or deleted with a title another mission now has\): change no state from it, and tell the user, naming the entry, M5 and both titles\./)
  expect(line).toMatch(/Entry « R2 » reads « rattachée à M7 - Tri », but M7 is « Export » in this statement/)
})

// Une mission archivée ou supprimée garde son numéro dans la table : son numéro ne passe jamais à une autre mission du
// même titre par le titre écrit.
test('un numéro gardé par une mission archivée ou supprimée : l’entrée n’est jamais rattachée par son titre à une autre mission', () => {
  const archived = { ...run('a', 'Tri v1', 'done'), archivedAt: NOW - 500 } as Run
  const runs = [run('m1', 'Tri', 'done'), archived]
  const line = gleanLine({ runs, numbers: { m1: 9, a: 5 }, lines: [entry('R1', 'rattachée à M5 - Tri'), entry('R2', 'rattachée à M6 - Tri'), entry('R3', 'rattachée à M4 - Tri')] })
  // M5 : archivée, sous un autre titre ; M6 : un id que le fichier des missions n'a plus ; M4 : donné à personne.
  const deleted = gleanLine({ runs, numbers: { m1: 9, a: 5, gone: 6 }, lines: [entry('R1', 'rattachée à M5 - Tri'), entry('R2', 'rattachée à M6 - Tri'), entry('R3', 'rattachée à M4 - Tri')] })
  expect(line).toMatch(/: none\./)
  expect(line).toMatch(/Entry « R1 » reads « rattachée à M5 - Tri », but M5 is « Tri v1 » \(an archived mission, not in this statement\): its number and its title name two different missions/)
  expect(deleted).toMatch(/: none\./)
  expect(deleted).toMatch(/Entry « R2 » reads « rattachée à M6 - Tri », but M6 is given by the numbers table to a mission no longer in the missions file:/)
  // M4, donné à personne : rien ne change, et le relevé le dit.
  expect(deleted).toMatch(/Entry « R3 » reads « rattachée à M4 - Tri », but no mission holds M4 in the numbers table \(a table started again or deleted, or another machine's\), so M4 cannot be checked: change no state from it, and tell the user, naming the entry and M4\./)
})

// Le scénario tranché le 18/11/2026 (numéro absent de la table) : A « Tri » (M5) supprimée, table neuve, B « Tri » close.
test('une mission supprimée puis une table neuve : son numéro ne se rattache jamais par le titre à la mission close du même titre, et le relevé le dit', () => {
  const line = gleanLine({ runs: [run('b', 'Tri', 'done')], numbers: { b: 12 }, lines: [entry('R1', 'rattachée à M5 - Tri')], glean: { id: 'b' } })
  expect(line).toMatch(/: none\./)
  expect(line).toMatch(/Entry « R1 » reads « rattachée à M5 - Tri », but no mission holds M5 in the numbers table/)
  // Sans mission close de ce titre, l'entrée se dit quand même, à part, dans la feuille de route du relevé.
  const alone = statementText(cooStatement({ ...emptyBoard(ROOT, 'proj'), runs: [run('c', 'Autre', 'active')] }, { now: NOW, roadmap: roadmapOf([entry('R1', 'rattachée à M5 - Tri v2')]), numbers: { state: 'read', runs: { c: 12 }, cards: {} } }))
  expect(alone).toMatch(/- Set aside, attached by a number that cannot be checked \(1\): « R1 » \(« rattachée à M5 - Tri v2 », no mission holds M5 in the numbers table \(a table started again or deleted, or another machine's\)\)\. No state of theirs changes from any mission's report: tell the user once/)
  // Sans numéro, l'entrée se lit toujours par son titre.
  expect(gleanLine({ runs: [run('b', 'Tri', 'done')], numbers: { b: 12 }, lines: [entry('R1', 'rattachée à Tri')], glean: { id: 'b' } })).toMatch(/: « R1 »\./)
})

// Le scénario tranché le 18/11/2026 : A « Tri » (M5) archivée, B « Tri » (M9) close, R1 « rattachée à M5 - Tri » : R1 reste à A,
// ne change pas d'après le compte rendu de B, et le relevé le dit (à la clôture de B, et dans la feuille de route).
test('une entrée rattachée par son numéro à une archivée du même titre reste à elle, jamais à la mission close du même titre, et le relevé la nomme', () => {
  const runs = [run('m1', 'Tri', 'done'), { ...run('a', 'Tri', 'done'), archivedAt: NOW - 500 } as Run]
  const same = gleanLine({ runs, numbers: { m1: 9, a: 5 }, lines: [entry('R1', 'rattachée à M5 - Tri')] })
  expect(same).toMatch(/: none\./)
  expect(same).toMatch(/Entry « R1 » reads « rattachée à M5 - Tri »: M5 is an archived mission of that title, not this one, and the entry stays attached to it: change no state from it, and tell the user, naming the entry and M5\./)
  const g: CooGlean = { id: 'm1', title: 'Tri', reports: [], untaken: [], report: '/h/r/m1.md', reportValidated: true, reportRound: '1.0.5' }
  const text = statementText(cooStatement({ ...emptyBoard(ROOT, 'proj'), runs }, { now: NOW, toGlean: [g], roadmap: roadmapOf([entry('R1', 'rattachée à M5 - Tri')]), numbers: { state: 'read', runs: { m1: 9, a: 5 }, cards: {} } }))
  expect(text).toMatch(/- Set aside, attached to an archived mission \(1\): « R1 » \(« rattachée à M5 - Tri »\)\. They stay attached to it: change no state from another mission's report/)
  expect(attachmentOf('rattachée à M5 - Tri', [{ id: 'm1', title: 'Tri' }], { m1: 9, a: 5 }, { a: 'Tri' })).toEqual({ kind: 'archived', id: 'a', tag: 'M5', written: 'Tri' })
})

// Une mission archivée avant d'avoir été relevée garde ses entrées : la ligne des archivées ne les lui retire pas.
test('une mission close archivée avant son relevé : ses entrées numérotées sont à elle, et la ligne des archivées ne les nomme pas', () => {
  const closed = { ...run('a', 'Tri', 'done'), archivedAt: NOW - 500 } as Run
  const g: CooGlean = { id: 'a', title: 'Tri', reports: [], untaken: [], report: '/h/r/a.md', reportValidated: true, reportRound: '1.0.5' }
  const text = statementText(cooStatement({ ...emptyBoard(ROOT, 'proj'), runs: [closed] }, { now: NOW, toGlean: [g], roadmap: roadmapOf([entry('R1', 'rattachée à M5 - Tri')]), numbers: { state: 'read', runs: { a: 5 }, cards: {} } }))
  expect(text).toMatch(/as the dashboard reads them \(« rattachée à M5 - <its title> » or « rattachée à <its title> »\): « R1 »\./)
  expect(text).not.toMatch(/attached to an archived mission/)
})
test('une table des numéros illisible : une entrée écrite avec un numéro ne change pas, et le relevé le dit ; sans numéro, par le titre', () => {
  expect(attachmentOf('rattachée à M5 - Tri', MISSIONS, null)).toEqual({ kind: 'unverifiable', tag: 'M5', written: 'Tri', why: 'unread' })
  expect(attachmentOf('rattachée à Tri', MISSIONS, null)).toEqual({ kind: 'mission', id: 'm1', byNumber: false })
  // Un titre qui commence lui-même par « M3 - » reste lu par ce titre.
  expect(attachmentOf('rattachée à M3 - Essai', MISSIONS, null)).toEqual({ kind: 'mission', id: 'm4', byNumber: false })
  for (const state of ['unread', 'bad'] as const) {
    const g: CooGlean = { id: 'm1', title: 'Tri', reports: [], untaken: [], report: '/h/r/m1.md', reportValidated: true, reportRound: '1.0.5' }
    const s = cooStatement({ ...emptyBoard(ROOT, 'proj'), runs: [run('m1', 'Tri', 'done')] }, { now: NOW, toGlean: [g], roadmap: roadmapOf([entry('R1', 'rattachée à M5 - Tri'), entry('R2', 'rattachée à Tri')]), numbers: { state, runs: {}, cards: {} } })
    const line = statementText(s).split('\n').find(l => l.startsWith('Closed mission '))!
    expect(line).toMatch(/: « R2 »\./)
    expect(line).toMatch(/Entry « R1 » reads « rattachée à M5 - Tri », but the numbers table is not read \(not read yet, not created yet on this machine, or unreadable\), so M5 cannot be checked: change no state from it, and tell the user, naming the entry and M5\./)
    // Déjà dite par le relevé de clôture de « Tri » : pas une seconde fois dans la ligne à part.
    expect(statementText(s)).not.toMatch(/attached by a number that cannot be checked/)
  }
  // Sans table encore relue ni mission close de ce titre : la ligne à part, avec la même raison.
  const pending = statementText(cooStatement({ ...emptyBoard(ROOT, 'proj'), runs: [run('m1', 'Tri', 'active')] }, { now: NOW, roadmap: roadmapOf([entry('R1', 'rattachée à M5 - Tri')]) }))
  expect(pending).toMatch(/- Set aside, attached by a number that cannot be checked \(1\): « R1 » \(« rattachée à M5 - Tri », the numbers table is not read \(not read yet, not created yet on this machine, or unreadable\)\)\./)
})

test('les titres se comparent sous la forme que le relevé montre au COO : crochets, guillemets, coupe à 80 signes', () => {
  const missions = [{ id: 'm1', title: 'Corriger [R12] le «tri»' }, { id: 'm2', title: `Un titre long ${'x'.repeat(90)}` }]
  const numbers = { m1: 5, m2: 6 }
  expect(attachmentOf('rattachée à M5 - Corriger (R12) le “tri”', missions, numbers)).toEqual({ kind: 'mission', id: 'm1', byNumber: true })
  expect(attachmentOf('rattachée à Corriger (R12) le “tri”', missions, numbers)).toEqual({ kind: 'mission', id: 'm1', byNumber: false })
  expect(attachmentOf(`rattachée à M6 - Un titre long ${'x'.repeat(65)}…`, missions, numbers)).toEqual({ kind: 'mission', id: 'm2', byNumber: true })
  // Un numéro écrit avec un zéro en tête n'est pas un numéro du relevé.
  expect(attachmentOf('rattachée à M05 - Corriger (R12) le “tri”', missions, numbers)).toEqual({ kind: 'unknown', title: 'M05 - Corriger (R12) le “tri”' })
})

test('un titre partagé ne bloque que les entrées sans numéro qui le confirme', () => {
  const runs = [run('m1', 'Tri', 'done'), run('m3', 'Tri', 'active')]
  const line = gleanLine({ runs, numbers: { m1: 5, m3: 6 }, lines: [entry('R1', 'rattachée à M5 - Tri'), entry('R2', 'rattachée à Tri'), entry('R3', 'rattachée à M6 - Tri')], glean: { titleShared: true } })
  expect(line).toMatch(/: « R1 »\./)
  expect(line).toMatch(/Entries « R2 » name this mission's title without a number that confirms it, and that title is also another mission's: change no state from these entries \(the others listed above still change\), and tell the user, naming them\./)
  // Le skill du COO ne lit pas cette ligne comme son « titre partagé » qui fige tout le compte rendu.
  expect(line).not.toMatch(/another mission of this project has the same title/)
  expect(line).not.toMatch(/« R3 »/)
  expect(line).toMatch(/write « faite : … »/)
})

test('sans feuille de route lisible, le relevé garde sa ligne d’avant et dit la règle des deux formes', () => {
  const g: CooGlean = { id: 'm1', title: 'Tri', reports: [], untaken: [], report: '/h/r/m1.md', reportValidated: true, reportRound: '1.0.5' }
  const s = cooStatement({ ...emptyBoard(ROOT, 'proj'), runs: [run('m1', 'Tri', 'done')] }, { now: NOW, toGlean: [g], numbers: { state: 'read', runs: { m1: 5 }, cards: {} } })
  const line = statementText(s).split('\n').find(l => l.startsWith('Closed mission '))!
  expect(line).toMatch(/update only the « À reprendre » entries at « rattachée à » this mission's title \(each « · » of it written « - »; an entry « rattachée à M<n> - <its title> » counts only when M<n> is M5, this mission's number; any other number changes nothing from that entry and is told to the user, since this statement does not show archived missions' numbers\)/)
  const bare = cooStatement({ ...emptyBoard(ROOT, 'proj'), runs: [run('m1', 'Tri', 'done')] }, { now: NOW, toGlean: [g] })
  expect(statementText(bare)).toMatch(/it has no number, so an entry « rattachée à M<n> - <its title> » never counts; any other number changes nothing/)
})

// Le fichier lui-même n'est jamais réécrit : feuille-de-route.test.ts le vérifie sur le mod chargé (dernier test).
test('la feuille de route se lit sous les deux formes, sans ligne hors format, et garde chaque ligne telle qu’écrite', () => {
  const text = `# Feuille de route\n\n## Jalons\n## Prochaines étapes\n## Idées\n## À reprendre\n${entry('R1', 'rattachée à M5 - Tri')}\n${entry('R2', 'rattachée à Tri')}\n`
  const read = parseRoadmap(text)
  expect(read.ok).toBe(true)
  if (!read.ok) return
  expect(read.entries.map(e => e.status)).toEqual(['rattachée à M5 - Tri', 'rattachée à Tri'])
  const seen = watchRoadmap({}, read, 1_000)
  expect(seen.seen.R1!.line).toBe(entry('R1', 'rattachée à M5 - Tri'))
  expect(seen.seen.R2!.line).toBe(entry('R2', 'rattachée à Tri'))
})

test('la vue Coordination compte et montre les entrées rattachées sous les deux formes', () => {
  const s = cooStatement({ ...emptyBoard(ROOT, 'proj'), runs: [run('m1', 'Tri', 'active')] }, { now: NOW, roadmap: roadmapOf([entry('R1', 'rattachée à M5 - Tri'), entry('R2', 'rattachée à Tri'), entry('R3', 'à décider')]), numbers: { state: 'read', runs: { m1: 5 }, cards: {} } })
  const rows = coordinationRows(s, { page: 'pending' })
  expect(rows[0]!.pills!.find(p => p.page === 'pending')!.count).toBe(3)
  const shown = rows.map(r => (r.parts ?? []).map(p => p.text).join(' ')).join('\n')
  expect(shown).toMatch(/R1 · rattachée à M5 - Tri/)
  expect(shown).toMatch(/R2 · rattachée à Tri/)
})
