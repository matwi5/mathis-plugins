import { expect, test } from 'claude-code/testing'

import { cooStatement, nightViewsOf, statementText } from '../hooks/coo.ts'
import { AUTO_STOPS, emptyBoard, newRun } from '../hooks/model.ts'
import { NIGHT_DEAD_MS, NIGHT_WAKE_MS, NIGHT_WAKE_TEXT, isNightWakeDue, withNightWake, nightBlocks, nightBlocksPrint, type NightMissionView } from '../hooks/night.ts'
import type { Board, Run } from '../types'
import { CORPUS } from './corpus.mjs'

// Les blocages que voit la surveillance de nuit dans les missions en auto, chacun avec le geste de nuit qui le
// lève (`wave`, `resend`, `relaunch`, `reopen`, `force`), le réveil de la discussion du COO, et la section
// « Nuit » de son relevé.

const NOW = 300_000_000

const view = (over: Partial<NightMissionView> = {}): NightMissionView => ({
  id: 'm1',
  title: 'Mission',
  isAuto: true,
  isPaused: false,
  isOpen: true,
  isRelaunchPause: false,
  heldByUser: [],
  hasOpenGroups: true,
  questions: [],
  waveDue: [],
  holds: [],
  ...over,
})
const none = () => undefined

test('chaque blocage d’une mission en auto donne le geste de nuit qui le lève', () => {
  const blocks = nightBlocks(
    [
      view({ waveDue: ['B'], questions: [{ id: 'sans-suite:A#1', group: 'A' }, { id: 'relance:C#2', group: 'C' }, { id: 'q1' }] }),
      view({ id: 'm2', title: 'Arrêtée', isAuto: false, isPaused: true, isOpen: false }),
    ],
    none,
    NOW,
  )
  expect(blocks).toEqual([
    { mission: 'm1', title: 'Mission', act: 'wave', group: 'B' },
    { mission: 'm1', title: 'Mission', act: 'resend', question: 'sans-suite:A#1', group: 'A' },
    { mission: 'm1', title: 'Mission', act: 'relaunch', question: 'relance:C#2', group: 'C' },
    { mission: 'm2', title: 'Arrêtée', act: 'reopen' },
  ])
})

test('une mission en manuel ne bloque rien ; une mission en pause ne lance pas sa vague, et n’est à rouvrir qu’ouverte nulle part et avec des groupes ouverts', () => {
  expect(nightBlocks([view({ isAuto: false, waveDue: ['B'], questions: [{ id: 'sans-suite:A#1' }] })], none, NOW)).toEqual([])
  const paused = view({ isAuto: false, isPaused: true, waveDue: ['B'] })
  expect(nightBlocks([paused], none, NOW)).toEqual([])
  expect(nightBlocks([{ ...paused, isOpen: false, hasOpenGroups: false }], none, NOW)).toEqual([])
  expect(nightBlocks([{ ...paused, isOpen: false }], none, NOW).map(b => b.act)).toEqual(['reopen'])
  // Une question « relance: » sans groupe n'a rien à relancer.
  expect(nightBlocks([view({ questions: [{ id: 'relance:x' }] })], none, NOW)).toEqual([])
  // En pause du mod (le retour de trop l'y a mise) : la relance seule, pas le renvoi.
  const stopped = view({ isAuto: false, isPaused: true, isRelaunchPause: true, questions: [{ id: 'relance:A#2', group: 'A' }, { id: 'sans-suite:B#1', group: 'B' }] })
  expect(nightBlocks([stopped], none, NOW).map(b => `${b.act}:${b.group}`)).toEqual(['relaunch:A'])
  // Un groupe qu'une question de la personne bloque : ni vague, ni relance (la question du mod seule ne bloque pas).
  const asked = view({ waveDue: ['B'], questions: [{ id: 'relance:C#2', group: 'C' }] })
  expect(nightBlocks([asked], none, NOW).map(b => `${b.act}:${b.group}`)).toEqual(['wave:B', 'relaunch:C'])
  expect(nightBlocks([{ ...asked, heldByUser: ['B', 'C'] }], none, NOW)).toEqual([])
  // Une autre pause (coupée par toi, ou par le COO) : pas de relance.
  expect(nightBlocks([{ ...stopped, isRelaunchPause: false }], none, NOW)).toEqual([])
})

test('une retenue ne se force que tenue par une mission ouverte nulle part dont le worker a un signe sûr de plus de 30 minutes', () => {
  const held = view({ holds: [{ held: 'B', mission: 'm2', group: 'A', isPlan: false }] })
  const holder = view({ id: 'm2', title: 'Tient', isAuto: false, isOpen: false })
  const old = (m: string, g: string) => (m === 'm2' && g === 'A' ? NOW - NIGHT_DEAD_MS - 1 : undefined)
  expect(nightBlocks([held, holder], old, NOW)).toEqual([{ mission: 'm1', title: 'Mission', act: 'force', group: 'B', awaited: [{ mission: 'm2', group: 'A' }] }])
  // Sans signe sûr, avec un signe récent, ou la mission qui retient ouverte : rien.
  expect(nightBlocks([held, holder], none, NOW)).toEqual([])
  expect(nightBlocks([held, holder], () => NOW - NIGHT_DEAD_MS, NOW)).toEqual([])
  expect(nightBlocks([held, { ...holder, isOpen: true }], old, NOW)).toEqual([])
  // La mission qui retient absente des vues (close, archivée) : rien.
  expect(nightBlocks([held], old, NOW)).toEqual([])
  // Retenu par deux missions mortes : un seul blocage, ses deux paires ; l'une encore vivante : aucun (forcer l'autre ne le ferait pas partir).
  const twice = view({ holds: [{ held: 'B', mission: 'm2', group: 'A', isPlan: false }, { held: 'B', mission: 'm3', group: 'C', isPlan: true }] })
  const third = view({ id: 'm3', title: 'Aussi', isAuto: false, isOpen: false })
  const both = (m: string, g: string) => ((m === 'm2' && g === 'A') || (m === 'm3' && g === 'C') ? NOW - NIGHT_DEAD_MS - 1 : undefined)
  expect(nightBlocks([twice, holder, third], both, NOW)).toEqual([{ mission: 'm1', title: 'Mission', act: 'force', group: 'B', awaited: [{ mission: 'm2', group: 'A' }, { mission: 'm3', group: 'C', on: 'plan' }] }])
  expect(nightBlocks([twice, holder, third], old, NOW)).toEqual([])
})

test('l’empreinte d’un ensemble de blocages ne dépend pas de l’ordre, et change quand un blocage change', () => {
  const a = nightBlocks([view({ questions: [{ id: 'sans-suite:A#1', group: 'A' }, { id: 'relance:C#2', group: 'C' }] })], none, NOW)
  expect(nightBlocksPrint([...a].reverse())).toBe(nightBlocksPrint(a))
  expect(nightBlocksPrint(a.slice(1))).not.toBe(nightBlocksPrint(a))
  expect(nightBlocksPrint([])).toBe('')
})

test('le réveil part pendant une surveillance valide, hors d’un tour, au plus une fois par 10 minutes, jamais deux fois pour le même ensemble', () => {
  const due = (o: Partial<Parameters<typeof isNightWakeDue>[0]>) => isNightWakeDue({ watch: 'n1', isTurnOpen: false, print: 'p1', last: null, now: NOW, ...o })
  expect(due({})).toBe(true)
  expect(due({ watch: null })).toBe(false)
  expect(due({ isTurnOpen: true })).toBe(false)
  expect(due({ print: '' })).toBe(false)
  // Le même ensemble déjà signalé : jamais, même longtemps après.
  expect(due({ last: { watch: 'n1', prints: ['p1'], at: NOW - 10 * NIGHT_WAKE_MS } })).toBe(false)
  // Un ensemble changé : seulement 10 minutes après le dernier réveil.
  expect(due({ print: 'p2', last: { watch: 'n1', prints: ['p1'], at: NOW - NIGHT_WAKE_MS + 1 } })).toBe(false)
  expect(due({ print: 'p2', last: { watch: 'n1', prints: ['p1'], at: NOW - NIGHT_WAKE_MS } })).toBe(true)
  // A, puis B, puis A de nouveau : A est déjà signalé, rien ne part.
  const ab = withNightWake(withNightWake(null, 'n1', 'p1', NOW - 3 * NIGHT_WAKE_MS), 'n1', 'p2', NOW - 2 * NIGHT_WAKE_MS)
  expect(ab).toEqual({ watch: 'n1', prints: ['p1', 'p2'], at: NOW - 2 * NIGHT_WAKE_MS })
  expect(due({ print: 'p1', last: ab })).toBe(false)
  expect(due({ print: 'p3', last: ab })).toBe(true)
  // Une nouvelle surveillance repart de zéro.
  expect(due({ watch: 'n2', last: { watch: 'n1', prints: ['p1'], at: NOW } })).toBe(true)
  expect(withNightWake(ab, 'n2', 'p1', NOW)).toEqual({ watch: 'n2', prints: ['p1'], at: NOW })
  expect(NIGHT_WAKE_TEXT).toBe("Surveillance de nuit : relis ton relevé et débloque ce qui peut l'être, avec les seuls gestes de nuit.")
})

/** Une mission en auto, ouverte ailleurs, avec deux groupes et une question du mod. */
const inAuto = (title: string, extra: Partial<Run> = {}): Run =>
  ({
    ...newRun('implement', NOW - 60_000, title),
    id: 'run-1',
    status: 'active',
    owner: 'session-M',
    auto: { onAt: NOW - 30_000, onBy: 'session-M' },
    tickets: [
      { id: '1', name: 'Un', status: 'done' },
      { id: '2', name: 'Deux', status: 'todo' },
    ],
    groups: [
      { id: 'A', name: 'A', tickets: ['1'] },
      { id: 'B', name: 'B', tickets: ['2'] },
    ],
    waiting: [{ id: 'sans-suite:B#1', blocks: { kind: 'group', id: 'B' }, text: 'Envoi resté sans suite', at: NOW - 10_000 }],
    ...extra,
  }) as unknown as Run
const board = (...runs: Run[]): Board => ({ ...emptyBoard('/p', 'p'), runs })
const noWave = () => []

test('les vues de la nuit : auto allumé, pause du mod, coupure du COO écartée, groupes ouverts, questions et groupe bloqué', () => {
  const [v] = nightViewsOf(board(inAuto('Titre')), { waveDue: id => (id === 'run-1' ? ['B'] : []) })
  expect(v).toMatchObject({ id: 'run-1', isAuto: true, isPaused: false, isOpen: true, hasOpenGroups: true, questions: [{ id: 'sans-suite:B#1', group: 'B' }], waveDue: ['B'], holds: [] })
  const ended = inAuto('Fermée', { status: 'paused', owner: undefined, auto: { onAt: NOW - 30_000, offAt: NOW - 1000, offWhy: AUTO_STOPS.ended } } as Partial<Run>)
  expect(nightViewsOf(board(ended), { waveDue: noWave })[0]).toMatchObject({ isAuto: false, isPaused: true, isOpen: false })
  const cut = inAuto('Coupée', { auto: { onAt: NOW - 30_000, offAt: NOW - 1000, offWhy: AUTO_STOPS.coo } } as Partial<Run>)
  expect(nightViewsOf(board(cut), { waveDue: noWave })[0]).toMatchObject({ isAuto: false, isPaused: false })
  const allDone = inAuto('Finie', { tickets: [{ id: '1', name: 'Un', status: 'done' }, { id: '2', name: 'Deux', status: 'done' }] } as Partial<Run>)
  expect(nightViewsOf(board(allDone), { waveDue: noWave })[0]?.hasOpenGroups).toBe(false)
  // Une mission close ou archivée n'est pas vue.
  expect(nightViewsOf(board(inAuto('Close', { status: 'done' } as Partial<Run>), inAuto('Archivée', { archivedAt: NOW } as Partial<Run>)), { waveDue: noWave })).toEqual([])
})

const nightOf = (b: Board) => ({ until: NOW + 3_600_000, id: 'nabcdefgh1', blocks: nightBlocks(nightViewsOf(b, { waveDue: noWave }), none, NOW) })

test('la section « Nuit » du relevé : la surveillance, son heure de fin, chaque blocage et son geste ; absente hors surveillance', () => {
  const b = board(inAuto('Titre'))
  const text = statementText(cooStatement(b, { now: NOW, night: nightOf(b) }))
  expect(text).toMatch(/Night watch \(« Nuit »\): on until \d\d:\d\d UTC/)
  expect(text).toMatch(/- mission « Titre » \(mission id « run-1 »\): group « B », question « sans-suite:B#1 », a send of the mod left without follow-up; night gesture: resend/)
  expect(text).toMatch(/never answer a blocking question, validate a plan or a report, deliver, or switch auto on/)
  expect(statementText(cooStatement(b, { now: NOW }))).not.toMatch(/Night watch/)
  // Sans blocage : la section le dit.
  const quiet = board(inAuto('Calme', { waiting: [] } as Partial<Run>))
  expect(statementText(cooStatement(quiet, { now: NOW, night: nightOf(quiet) }))).toMatch(/Night watch[^\n]*\(0\):\n- none/)
})

test('un titre relu d’une mission n’ajoute ni ligne ni citation à la section « Nuit » (corpus hostile)', () => {
  // Une mission en auto (renvoi, retenue tenue par une autre mission du même titre) et une mission en pause du mod à rouvrir :
  // chaque genre de ligne qui cite un titre.
  const pair = (title: string) => {
    const auto = inAuto(title)
    const paused = { ...inAuto(title, { status: 'paused', owner: undefined, auto: { onAt: NOW - 30_000, offAt: NOW - 1000, offWhy: AUTO_STOPS.ended } } as Partial<Run>), id: 'run-3' } as Run
    const b = board(auto, paused)
    const [first, second] = nightViewsOf(b, { waveDue: noWave })
    const holder = { ...first!, id: 'run-2', title, isAuto: false, isPaused: false, isOpen: false }
    const blocks = nightBlocks([{ ...first!, holds: [{ held: 'B', mission: 'run-2', group: 'A', isPlan: false }] }, second!, holder], () => 0, NOW)
    return { b, blocks }
  }
  const ref = pair('Titre')
  const reference = statementText(cooStatement(ref.b, { now: NOW, night: { until: NOW + 1000, id: 'nabcdefgh1', blocks: ref.blocks } }))
  expect(ref.blocks.map(x => x.act)).toEqual(['resend', 'force', 'reopen'])
  for (const [name, token] of Object.entries(CORPUS)) {
    const { b, blocks } = pair(`Titre${token}x`)
    const text = statementText(cooStatement(b, { now: NOW, night: { until: NOW + 1000, id: 'nabcdefgh1', blocks } }))
    expect(text.split('\n').length, name).toBe(reference.split('\n').length)
    expect((text.match(/«/g) ?? []).length, name).toBe((reference.match(/«/g) ?? []).length)
  }
})
