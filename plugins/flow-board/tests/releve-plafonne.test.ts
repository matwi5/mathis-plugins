import { expect, test } from 'claude-code/testing'

import { STATEMENT_CAP, cooStatement, statementText, type CooStatement, type CooWaitlist } from '../hooks/coo.ts'
import { emptyBoard, newRun } from '../hooks/model.ts'
import { parseRoadmap } from '../hooks/roadmap.ts'
import type { Piste } from '../hooks/pistes.ts'
import type { Board, Run } from '../types'

// Le relevé du COO plafonné : le moteur n'affiche plus un contexte à partir
// d'environ 100 000 signes ; le relevé tient sous 50 000 signes, ses longues listes réduites à leur compte, au
// chemin de leur fichier et à la façon de le lire.

const NOW = 1_800_000_000_000
const WORDS = 'le relevé du COO doit tenir en entier pour que rien ne passe sous silence pendant plusieurs tours '

/** Un texte réaliste de la longueur voulue. */
const prose = (n: number, tag: string): string => `${tag} ${WORDS.repeat(Math.ceil(n / WORDS.length))}`.slice(0, n)

/** Une mission en auto, ses questions bloquantes ouvertes. */
const inAuto = (i: number, questions: number): Run =>
  ({
    ...newRun('implement', NOW - 3_600_000, prose(60, `Mission ${i}`)),
    status: 'active',
    owner: `session-${i}`,
    auto: { onAt: NOW - 1_800_000, onBy: `session-${i}` },
    waiting: Array.from({ length: questions }, (_, q) => ({ id: `Q${q + 1}`, blocks: { phase: 'implement' }, text: prose(300, `Question ${i}.${q}`), at: NOW - 60_000 })),
    tickets: Array.from({ length: 8 }, (_, t) => ({ id: String(t + 1), name: `Ticket ${t + 1}`, status: t < 3 ? 'done' : 'todo' })),
  }) as unknown as Run

/** 30 missions, dont les dix premières portent deux questions et les vingt suivantes une : 40 questions. */
const heavyBoard = (): Board => ({ ...emptyBoard('/p', 'p'), runs: Array.from({ length: 30 }, (_, i) => inAuto(i + 1, i < 10 ? 2 : 1)) })

/** Une feuille de route de 300 entrées ouvertes de « À reprendre » (« à décider » et « plus tard »), textes de 400 signes. */
const heavyRoadmap = (): string => {
  const pending = Array.from({ length: 300 }, (_, i) => `- [R${i + 1}] ${i % 3 === 0 ? 'plus tard' : 'à décider'} · 2026-11-20 · boîte b${i}, mission « M » · ${prose(400, `Entrée-${i + 1}`)}`)
  return `# Feuille de route\n\n## Jalons\n- [J1] en cours · 2026-11-02 · Mathis · Le COO suit les missions — fin : chaque mission passe par lui\n\n## Prochaines étapes\n- [E1] à faire · 2026-11-02 · COO · Lancer le groupe C\n\n## Idées\n- [I1] à lancer · 2026-11-01 · Mathis · un tableau des coûts\n\n## À reprendre\n${pending.join('\n')}\n`
}

const piste = (i: number): Piste => ({
  id: `retro-${i % 7}/p${i}`,
  retro: `retro-${i % 7}`,
  text: prose(400, `Piste-${i}`),
  files: ['plugins/flow-board/hooks/coo.ts'],
  state: i % 4 === 0 ? 'validated' : i % 9 === 0 ? 'done' : 'pending',
  by: 'session-r',
  at: NOW - 1_000,
  history: [],
  comments: [{ text: prose(200, `Note-${i}`), by: 'coo', at: NOW - 500 }],
})

const heavyWaitlist = (): CooWaitlist => ({ state: 'read', pistes: Array.from({ length: 200 }, (_, i) => piste(i)), refused: [], boxesUnread: [], where: 'poste', path: '/home/x/.claude/flow-board/pistes/projet.json' })

const ROADMAP_PATH = '/home/x/.claude/flow-board/feuilles/projet.md'

const heavy = (extra: Partial<CooStatement> = {}): CooStatement => ({
  ...cooStatement(heavyBoard(), { now: NOW, effort: 'high', hasBrief: true, roadmap: { where: 'poste', path: ROADMAP_PATH, read: parseRoadmap(heavyRoadmap()), gone: [] } }),
  waitlist: heavyWaitlist(),
  ...extra,
})

test('un état lourd (300 entrées ouvertes, 200 pistes, 30 missions, 40 questions) donne un relevé sous 50 000 signes', () => {
  const s = heavy()
  expect(s.missions.length).toBe(30)
  expect(s.waits.length).toBe(40)
  const text = statementText(s)
  expect(STATEMENT_CAP).toBe(50_000)
  expect(text.length).toBeLessThan(STATEMENT_CAP)
  // Les missions et les questions bloquantes sont toutes là.
  for (let i = 1; i <= 30; i++) expect(text).toContain(`Mission ${i} `)
  expect((text.match(/question « Q\d+ »/g) ?? []).length).toBe(40)
})

test('les entrées ouvertes de « À reprendre » sont un compte, le chemin de la feuille de route et la façon de la lire, sans leur texte', () => {
  const text = statementText(heavy())
  expect(text).toMatch(/Set aside, open « À reprendre » entries: 300 \(200 « à décider », 100 « plus tard »\), not listed here: read them in the roadmap file above \(.+feuilles\/projet\.md.+\) by searching for an id or a word .*one entry per line, never in one read call/)
  expect(text).not.toMatch(/Entrée-1 /)
  expect(text).not.toMatch(/Set aside, to decide \(/)
  // Les jalons, étapes et idées restent listés.
  expect(text).toMatch(/Current milestone \(1\): « J1 »/)
  expect(text).toMatch(/Open ideas \(1\): « I1 »/)
})

test('la liste d’attente des rétros est donnée par ses comptes par état et son chemin, sans aucune piste recopiée', () => {
  const text = statementText(heavy())
  expect(text).toMatch(/Retro waitlist of the project \(200 piste\(s\), \d+ open: \d+ pas encore validée, \d+ validée, \d+ faite; the dashboard alone writes it\)/)
  expect(text).toMatch(/at « \/home\/x\/\.claude\/flow-board\/pistes\/projet\.json »/)
  expect(text).toMatch(/one piste per line/)
  expect(text).not.toMatch(/Piste-\d+/)
  expect(text).not.toMatch(/Note-\d+/)
})

test('une liste d’attente gardée hors fichier (`$.store`) le dit : pas de fichier à lire, la vue Coordination la montre', () => {
  const text = statementText(heavy({ waitlist: { ...heavyWaitlist(), path: null } }))
  expect(text).toMatch(/kept by the dashboard without a file on this machine: no file to read; the Coordination view shows it/)
  expect(text).not.toMatch(/Piste-\d+/)
})

test('restent dans le relevé : les entrées disparues, les titres à écrire', () => {
  const read = parseRoadmap(heavyRoadmap())
  const s = heavy({ roadmap: { where: 'poste', path: ROADMAP_PATH, read, gone: [{ id: 'R999', section: 'À reprendre', line: '- [R999] à décider · 2026-11-01 · COO · une entrée disparue', seenAt: NOW - 1 }] } })
  const text = statementText(s)
  expect(text).toMatch(/ENTRIES THAT DISAPPEARED \(1\)/)
  expect(text).toMatch(/Titles: 300 « À reprendre » entries to title \(open, or a complement\) have no title/)
})

/** Des cartes de lancement, un plan, des décisions antérieures et des retenues, en nombres choisis, pour dépasser le plafond avec l'état lourd. */
const crowded = (n: { cards: number; waves: number; earlier: number; holds: number }): Partial<CooStatement> => ({
  cards: Array.from({ length: n.cards }, (_, i) => ({ id: `c${i}`, title: prose(60, `Carte ${i}`), start: 'implement', askMatt: prose(200, `Pourquoi ${i}`), alts: [], mode: 'auto', modeWhy: prose(100, `Mode ${i}`), effort: 'high', effortWhy: prose(100, `Effort ${i}`), folder: `sujet-${i}`, at: NOW, state: { kind: 'ready' } })) as never,
  plan: { isValidated: true, key: 'k', computed: { waves: Array.from({ length: n.waves }, (_, i) => ({ units: [{ run: `m${i}`, title: prose(60, `Vague ${i}`), group: 'A' }, { run: `m${i}`, title: prose(60, `Vague ${i}`), group: 'B' }] })), waits: [], delivery: [] } } as never,
  decisions: { items: [{ mission: 'm1', title: 'Mission 1', text: 'Une décision nouvelle', ref: 'DECISIONS.md, série 1' }], more: 0, earlier: Array.from({ length: n.earlier }, (_, i) => ({ mission: `m${i}`, title: prose(60, `Antérieure ${i}`), file: `travail/s${i}/DECISIONS.md`, decided: [prose(400, `Choix ${i}`), prose(400, `Autre choix ${i}`)] })), contradictions: [], compatibles: [] } as never,
  holds: Array.from({ length: n.holds }, (_, i) => ({ missionId: `h${i}`, mission: prose(60, `Retenue ${i}`), held: 'A', group: 'B', title: prose(60, `Attendue ${i}`), on: 'file', shared: 'plugins/flow-board/hooks/coo.ts' })) as never,
})

test('au-delà du plafond, les sections se réduisent dans l’ordre (cartes, plan et vague, décisions antérieures, retenues et attentes), nommées en tête', () => {
  // Les cartes seules font dépasser : elles seules se réduisent.
  const few = statementText(heavy(crowded({ cards: 60, waves: 5, earlier: 5, holds: 5 })))
  expect(few.length).toBeLessThan(STATEMENT_CAP)
  const head = few.split('\n').slice(0, 2).join('\n')
  expect(head).toMatch(/reduced to their count to stay under 50000 characters: launch cards; read each/)
  expect(few).toMatch(/Launch cards not launched yet: 60, reduced: the user sees them in the Coordination view under « Au départ », page « Vue d'ensemble »/)
  expect(few).not.toMatch(/Pourquoi \d+/)
  expect(few).toMatch(/Choix 4/)
  expect(few).toMatch(/Retenue 4/)
  // Les décisions nouvelles et les missions ne sont jamais réduites.
  expect(few).toMatch(/New decisions of the missions since your last review \(1\)/)
  expect(few).toMatch(/Une décision nouvelle/)
  // Toutes les sections réductibles pleines : les quatre se réduisent, dans l'ordre.
  const many = statementText(heavy(crowded({ cards: 120, waves: 120, earlier: 30, holds: 60 })))
  expect(many.length).toBeLessThan(STATEMENT_CAP)
  const head2 = many.split('\n').slice(0, 2).join('\n')
  expect(head2).toMatch(/launch cards, plan and wave, earlier decisions to compare, holds and waits; read each/)
  expect(many).toMatch(/Plan of the project \(validated\): 120 wave\(s\), reduced/)
  expect(many).not.toMatch(/Vague \d+/)
  // Sans fichier des choix, les choix déclarés restent dits, chacun coupé à 120 signes : de quoi comparer.
  expect(many).toMatch(/its declared choices \(no file holds them; each cut at 120 characters\): « Choix 0 /)
  expect(many).not.toContain(prose(400, 'Choix 0'))
  expect(many).toMatch(/Earlier decisions of the missions not archived, to compare with: 30 mission\(s\), reduced/)
  expect(many).toMatch(/« travail\/s0\/DECISIONS\.md »/)
  expect(many).not.toMatch(/Retenue \d+/)
  expect(many).toMatch(/Holds between missions, .*\(60\), reduced/)
  for (let i = 1; i <= 30; i++) expect(many).toContain(`Mission ${i} `)
  expect((many.match(/question « Q\d+ »/g) ?? []).length).toBe(40)
  // Rien n'est réduit sous le plafond.
  expect(statementText(cooStatement(heavyBoard(), { now: NOW }))).not.toMatch(/reduced to their count/)
})

test('cartes réduites : une carte lancée encore listée garde sa ligne entière (l’entrée à rattacher, l’idée devenue mission)', () => {
  const read = parseRoadmap(heavyRoadmap())
  const launched = { id: 'cl', title: 'R7 Lancée', start: 'implement', askMatt: 'l. 1', alts: [], mode: 'auto', modeWhy: '-', effort: 'high', effortWhy: '-', folder: 'lancee', at: NOW, entries: ['R7', 'I1'], state: { kind: 'launched', run: { id: 'm-l', title: 'Mission lancée' } } }
  const cards = [...((crowded({ cards: 60, waves: 5, earlier: 5, holds: 5 }).cards as unknown as object[]) ?? []), launched]
  const text = statementText(heavy({ ...crowded({ cards: 60, waves: 5, earlier: 5, holds: 5 }), cards: cards as never, roadmap: { where: 'poste', path: ROADMAP_PATH, read, gone: [] } }))
  expect(text.split('\n').slice(0, 2).join('\n')).toMatch(/: launch cards; read each/)
  expect(text).toMatch(/Launch cards not launched yet: 60, reduced/)
  expect(text).toMatch(/launch card « cl » « R7 Lancée »/)
  expect(text).toMatch(/The idea « I1 » of the roadmap became this mission/)
})

test('les chemins entrent cités pour le shell dans les commandes de lecture (apostrophe, dollar, guillemet)', () => {
  const odd = `/home/x/l'a "b" $HOME/projet.json`
  const text = statementText(heavy({ waitlist: { ...heavyWaitlist(), path: odd }, roadmap: { where: 'poste', path: '/home/x/$d/l\'a.md', read: parseRoadmap(heavyRoadmap()), gone: [] } }))
  expect(text).toContain(`.pistes) if (JSON.stringify(p).toLowerCase().includes(w.toLowerCase())) console.log(JSON.stringify(p))" '/home/x/l'\\''a "b" $HOME/projet.json' '<id or word>'`)
  expect(text).toContain(`grep -n -i -- '<id or word>' '/home/x/$d/l'\\''a.md'`)
})

test('encore au-delà une fois les sections réduites (hors des volumes prévus), le relevé le dit en tête et ne coupe rien', () => {
  const runs = Array.from({ length: 70 }, (_, i) => inAuto(i + 1, 2))
  const s = { ...cooStatement({ ...emptyBoard('/p', 'p'), runs }, { now: NOW }), ...crowded({ cards: 10, waves: 10, earlier: 10, holds: 10 }) }
  const text = statementText(s)
  expect(text.length).toBeGreaterThan(STATEMENT_CAP)
  const head = text.split('\n').slice(0, 3).join('\n')
  expect(head).toMatch(/reduced to their count to stay under 50000 characters: launch cards, plan and wave, earlier decisions to compare, holds and waits/)
  expect(head).toMatch(/STILL OVER the cap of 50000 characters after reducing every section that may be reduced/)
  expect((text.match(/question « Q\d+ »/g) ?? []).length).toBe(140)
})
