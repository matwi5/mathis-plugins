// Un relevé chargé de la vue Coordination et la liste figée des clés de lignes et de boutons que la page « Vue
// d'ensemble » en tire : les tickets de la présentation de la vue la relisent pour prouver qu'aucune clé n'est perdue
// (une chose déplacée dans un rectangle garde sa clé), et ceux qui retirent un en-tête en retirent sa clé.
// Un module d'aide, pas un fichier de test.

import { cooStatement, type CooStatement } from '../hooks/coo.ts'
import type { CooRow } from '../hooks/coo-view.tsx'
import { parseCard, soundCard, type LaunchCard } from '../hooks/launch.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { retroCard } from '../hooks/retro-coo.ts'
import type { Run } from '../types'

export const LOADED_NOW = 640_000_000

const auto = (): Run =>
  ({
    ...newRun('implement', LOADED_NOW - 60_000, 'Mission en auto'),
    id: 'mauto0001',
    status: 'active',
    owner: 'session-M',
    updatedAt: LOADED_NOW - 1_000,
    auto: { onAt: LOADED_NOW - 30_000, onBy: 'session-M' },
    waiting: [
      { id: 'q1', blocks: { phase: 'implement' }, text: 'Garder le refus ?', at: LOADED_NOW - 10_000 },
      { id: 'g1', blocks: { phase: 'implement' }, gesture: 'spend', text: 'Dépense de 3 €', at: LOADED_NOW - 9_000 },
    ],
  }) as unknown as Run
const manual = (): Run => ({ ...newRun('implement', LOADED_NOW - 60_000, 'Mission en manuel'), id: 'mmanu0001', status: 'active', owner: 'session-B', updatedAt: LOADED_NOW - 1_000, waitsUser: { since: LOADED_NOW - 5_000, kind: 'validation' } }) as unknown as Run
const held = (): Run => ({ ...newRun('implement', LOADED_NOW - 60_000, 'Mission retenue'), id: 'mheld0001', status: 'active', owner: 'session-C', updatedAt: LOADED_NOW - 1_000 }) as Run
const done = (): Run => ({ ...newRun('implement', LOADED_NOW - 900_000, 'Mission livrée'), id: 'mdone0001', status: 'done', bornIn: 'session-D', updatedAt: LOADED_NOW - 60_000 }) as Run

const card = (id: string, over: Record<string, unknown> = {}): LaunchCard => {
  const parsed = parseCard({ title: `Carte ${id}`, start: 'grill-with-docs', askMatt: 'l. 19', alts: ['to-spec'], mode: 'manual', effort: 'high', folder: `dossier-${id}`, goal: `Objectif de ${id}.`, ...over }, LOADED_NOW - 1_000, id)
  if ('refused' in parsed) throw new Error(parsed.refused)
  return parsed.card
}

/**
 * Un relevé chargé : questions et geste d'une mission en auto, une mission qui attend, une retenue « à forcer » et une
 * grise, un rapport, une mission livrée, la livraison, une alerte, le plan et la vague, quatre cartes (une rétro, une
 * xhigh, une en lancement, une sans objectif), la surveillance de nuit.
 */
export const loadedStatement = (): CooStatement => {
  const runs = [auto(), manual(), held(), done()]
  const old = card('kcarte004')
  const { goal: _, ...before } = old
  const cards = [retroCard(done(), null, LOADED_NOW - 2_000), card('kcarte002', { effort: 'xhigh' }), { ...card('kcarte003'), launch: { id: 'lcarte00031', at: LOADED_NOW - 1_000, mode: 'manual' as const } }, soundCard(before)!]
  const s = cooStatement({ ...emptyBoard('', 'p'), runs }, { now: LOADED_NOW, cards, night: { until: LOADED_NOW + 3_600_000 } } as any)
  return {
    ...s,
    quota: '42 % de la limite de 5 h',
    reports: [{ missionId: 'mreport01', mission: 'Mission au rapport', print: 'p1', text: 'ligne', isOpen: true, isMissionOpen: true, state: 'ready' }],
    delivery: { state: 'ready', missions: ['Mission livrée'], commits: [], waitFor: [], waitCommits: [], key: 'k1', isArmed: false },
    delivered: { list: [{ id: 'mdone0001', title: 'Mission livrée', card: cards[0]!.id }], print: 'd1' },
    holds: [
      { held: 'A', run: 'mheld0001', title: 'Mission retenue', group: 'A', shared: 'hooks/x.ts', on: 'file', missionId: 'mmanu0001', mission: 'Mission en manuel', deadSince: LOADED_NOW - 60_000, isToForce: true },
      { held: 'B', run: 'mheld0001', title: 'Mission retenue', group: 'B', shared: 'hooks/y.ts', on: 'file', missionId: 'mmanu0001', mission: 'Mission en manuel' },
    ],
    roadmap: { where: 'unasked', path: '/x/feuille-de-route.md', read: { ok: true, entries: [] }, gone: [{ id: 'I9', line: '- [I9] à lancer · 2026-11-01 · Alex · partie' }] },
    plan: { computed: { waves: [{ units: [{ run: 'mauto0001', title: 'Mission en auto', group: 'A' }] }, { units: [{ run: 'mmanu0001', title: 'Mission en manuel', group: 'B' }] }], waits: [], delivery: [{ run: 'mauto0001', title: 'Mission en auto' }] }, key: 'k', isValidated: false },
    wave: { next: [{ id: 'mauto0001', title: 'Mission en auto', groups: ['A'] }], key: 'w1', isLaunching: false, report: [] },
  } as unknown as CooStatement
}

/** Les clés des lignes et des boutons d'une page, dans l'ordre, sans la rangée des pastilles. */
export const keysOf = (rows: readonly CooRow[]): string[] => rows.filter(r => r.kind !== 'pills').flatMap(r => [r.key, ...(r.actions ?? []).map(a => a.key)])

/**
 * Les clés des lignes et des boutons que « Vue d'ensemble » tire du relevé chargé, figées à la fin du ticket qui l'a
 * créée : celles des pages « À faire » puis « Missions » d'avant, lues sur le code d'avant elle, dans le même ordre. Seuls
 * changements depuis : les deux premières phrases du point, que les tuiles disent, en sont sorties ; la rangée des
 * tuiles (`coo-tiles`), la ligne d'état de chaque couloir (`coo-mission-<id>-state`) et sa frise (`coo-mission-<id>-road`)
 * y sont entrées.
 */
export const OVERVIEW_KEYS: readonly string[] = [
  'coo-point',
  'coo-tiles',
  'coo-point-2',
  'coo-night',
  'coo-night-stop',
  'coo-project',
  'coo-wait-mauto0001-q1-qsgphfp',
  'coo-answer-mauto0001-q1-qsgphfp',
  'coo-wait-mauto0001-g1-q1esfv22',
  'coo-gesture-yes-mauto0001-g1-q1esfv22',
  'coo-gesture-no-mauto0001-g1-q1esfv22',
  'coo-report-mreport01',
  'coo-report-read-mreport01',
  'coo-report-mreport01-line-0',
  'coo-report-mreport01-acts',
  'coo-report-validate-mreport01',
  'coo-report-redo-mreport01',
  'coo-delivery',
  'coo-deliver',
  'coo-waiting-0',
  'coo-hold-mmanu0001~A~mheld0001~A~file',
  'coo-force-mmanu0001~A~mheld0001~A~file',
  'coo-hold-mmanu0001~B~mheld0001~B~file',
  'coo-force-mmanu0001~B~mheld0001~B~file',
  'coo-gone',
  'coo-gone-I9',
  'coo-restore-I9',
  'coo-where',
  'coo-where-ask',
  'coo-where-repo',
  'coo-where-poste',
  'coo-missions',
  'coo-mission-mauto0001',
  'coo-cut-auto-mauto0001',
  'coo-mission-mmanu0001',
  'coo-auto-on-mmanu0001',
  'coo-mission-mheld0001',
  'coo-auto-on-mheld0001',
  'coo-mission-mdone0001',
  'coo-mission-mauto0001-state',
  'coo-mission-mmanu0001-state',
  'coo-mission-mheld0001-state',
  'coo-mission-mdone0001-state',
  'coo-mission-mauto0001-road',
  'coo-mission-mmanu0001-road',
  'coo-mission-mheld0001-road',
  'coo-mission-mdone0001-road',
  'coo-cards',
  'coo-cards-propose',
  'coo-card-kr0lgij9l9',
  'coo-card-auto-kr0lgij9l9',
  'coo-card-manual-kr0lgij9l9',
  'coo-card-archive-kr0lgij9l9',
  'coo-card-goal-kr0lgij9l9',
  'coo-card-kcarte002',
  'coo-card-manual-kcarte002',
  'coo-card-alt-kcarte002-to-spec',
  'coo-card-remove-kcarte002',
  'coo-card-goal-kcarte002',
  'coo-card-quota-kcarte002',
  'coo-card-kcarte003',
  'coo-card-goal-kcarte003',
  'coo-card-kcarte004',
  'coo-card-manual-kcarte004',
  'coo-card-auto-kcarte004',
  'coo-card-alt-kcarte004-to-spec',
  'coo-card-remove-kcarte004',
  'coo-plan',
  'coo-plan-ask',
  'coo-plan-validate',
  'coo-plan-wave-0',
  'coo-plan-wave-1',
  'coo-plan-delivery',
  'coo-wave',
  'coo-wave-next',
  'coo-wave-launch',
]
