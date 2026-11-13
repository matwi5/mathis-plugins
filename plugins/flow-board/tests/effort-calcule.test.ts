import { expect, mock, test } from 'claude-code/testing'

import { AUTO_GROUP_EFFORT, GROUP_EFFORT, SONNET_APP_ID, SONNET_CLI_ALIAS, SONNET_LAUNCH_FR } from '../hooks/effort.ts'

// Le mod calcule l'effort de chaque groupe et l'écrit sur sa ligne de la demande de lancement : Claude
// lisait lui-même la règle d'effort, parfois autrement que le mod (3 lancements plus haut, 5 plus bas).

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const NOW = 81_000_000
const TMP = '/var/tmp/essai'

type Lot = { tickets: Record<string, unknown>[]; groups: Record<string, unknown>[] }

/**
 * La demande de lancement après `presses` ; `isBrief` : le dossier temporaire accepte les briefs (la
 * demande les cite), sinon elle fait rédiger le brief à Claude (le repli) ; `written` reçoit les briefs écrits, par chemin.
 */
const launch = async ($: any, on: any, lot: Lot, presses: string[], isBrief = false, written: Record<string, string> = {}): Promise<string[]> => {
  mock.clock(on, { now: NOW })
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: '/proj', remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: '/proj' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('env.get', (_$: unknown, e: { name: string }) => ({ value: e.name === 'TMPDIR' && isBrief ? `${TMP}/` : undefined }) as any)
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    if (e.path === TMP) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } } as any
    if (e.path in written) return { value: { kind: 'file', size: written[e.path]!.length, mtimeMs: 0, isLink: false, realPath: e.path } } as any
    throw new Error(`absent : ${e.path}`)
  })
  on('fs.exists', () => ({ value: false }) as any)
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isBrief && e.path.includes('flow-board-brief-')) {
      written[e.path] = e.text
      return { value: undefined }
    }
    throw new Error(`pas de disque : ${e.path}`)
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (e.path in written) return { value: written[e.path] } as any
    throw new Error(`pas de disque : ${e.path}`)
  })
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...lot } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  // Une demande par appui, dans l'ordre.
  const texts: string[] = []
  for (const key of presses) {
    await ui.press({ key })
    texts.push(filled.at(-1)!)
  }
  await ui.unmount()
  return texts
}

const FB = 'plugins/flow-board/hooks/model.ts'

// A : un seul module, rien de sensible ; B : un ticket sensible ; C : un ticket muet ; D : deux plugins.
const LOT: Lot = {
  tickets: [
    { id: 'a1', name: 'Code', files: [FB, 'plugins/flow-board/README.md', 'travail/x/issues/01.md'], sensitive: false, logic: true },
    { id: 'b1', name: 'Garde', files: [FB], sensitive: true, logic: true },
    { id: 'c1', name: 'Muet', files: [FB] },
    { id: 'd1', name: 'Deux plugins', files: [FB, 'plugins/stats-board/hooks/register.tsx'], sensitive: false, logic: true },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Garde', tickets: ['b1'] },
    { id: 'C', name: 'Muet', tickets: ['c1'] },
    { id: 'D', name: 'Deux plugins', tickets: ['d1'] },
  ],
}

/** La ligne du groupe dans la demande : de « Groupe <id> » au séparateur suivant. */
const lineOf = (text: string, id: string): string => new RegExp(`Groupe ${id} \\([^)]*\\) : [^∥]*?(?= ∥ |\\. Avant de lancer)`).exec(text)?.[0] ?? ''

/**
 * L'appel delegate qu'un texte dicte (le premier qui porte `"model": "fable"` si `isFable`, sinon le premier
 * sans), rejoué tel quel contre l'outil, la référence du manager remplie : la réponse de l'outil, en texte.
 * Le premier appel delegate de la session, comme pour un worker neuf.
 */
const replayDelegate = async ($: any, text: string, isFable: boolean): Promise<string> => {
  const calls = [...text.matchAll(/\{"delegate": [^{}]*\}/g)].map(m => m[0])
  const call = calls.find(c => c.includes('"model": "fable"') === isFable)
  expect(call).toBeDefined()
  const input = JSON.parse(call!.replace('[<ref>]', '[abc123]'))
  return JSON.stringify(await $.tool.call({ tool: TOOL, ...input }))
}

/** Ce que dit la réponse de l'outil à un premier appel delegate qui pose la marque « worker Fable ». */
const FABLE_WORKER = 'This session is a Fable worker'

for (const isBrief of [false, true]) {
  const form = isBrief ? 'brief écrit' : 'brief à rédiger'
  test(`chaque ligne de groupe porte son effort calculé et sa raison (${form})`, async ($, on) => {
    const ids = ['A', 'B', 'C', 'D']
    const texts = await launch($, on, LOT, ids.map(id => `launch-linked-${id}`), isBrief)
    const lines: Record<string, string> = Object.fromEntries(ids.map((id, i) => [id, lineOf(texts[i]!, id)]))
    if (isBrief) for (const text of texts) expect(text).toContain('Briefs écrits par flow-board')
    expect(lines.A).toMatch(/ — effort calculé : medium$/)
    // Un ticket sensible (ou muet) ne compte plus au lancement : le mod du worker le passe en high pendant ce ticket.
    expect(lines.B).toMatch(/ — effort calculé : medium$/)
    expect(lines.C).toMatch(/ — effort calculé : medium$/)
    expect(lines.D).toMatch(/ — effort calculé : high \(plusieurs modules de code\)$/)
  })

  test(`un effort imposé par « ↗ xhigh » l'emporte sur le calcul (${form})`, async ($, on) => {
    const [text = ''] = await launch($, on, LOT, ['launch-xhigh-A'], isBrief)
    expect(lineOf(text, 'A')).toMatch(/ — effort : xhigh, imposé$/)
    expect(text).not.toContain('effort calculé')
    expect(text).toContain("Effort de la session (<effort>) : xhigh, choisi par moi au tableau de bord")
  })
}

test('la consigne d’effort : lancer à l’effort calculé, high pour un choix de conception, l’effort pris et tout écart en une ligne ; les critères à la section 11', () => {
  for (const text of [GROUP_EFFORT(true, undefined, undefined, 'P/reference/effort-workers.md'), AUTO_GROUP_EFFORT(true, 'P/reference/effort-workers.md')]) {
    expect(text).toContain('Effort de chaque session (<effort>) : l’effort calculé sur la ligne de son groupe')
    expect(text).toContain('high si un choix de conception reste à faire')
    expect(text).toContain("Dis-moi en une ligne, pour chaque groupe, l'effort pris et, s'il s'écarte du calcul, pourquoi.")
    expect(text).toContain('section 11 de P/reference/effort-workers.md')
    expect(text).toContain('Pendant un ticket sensible, le mod de la session la passe lui-même en high, et pendant un ticket « Jugement : oui », en xhigh : ne relève pas son effort pour ces tickets.')
    expect(text).toContain("Ne me pose aucune question sur l'effort.")
    expect(text).not.toContain('medium par défaut')
    // Plus aucune question d'effort, ni aucun des deux chemins proposés.
    expect(text).not.toContain('question à boutons')
    expect(text).not.toContain('Si je réponds')
    expect(text).not.toContain('(Recommandé)')
  }
  const manual = GROUP_EFFORT(true, undefined, undefined, 'P/reference/effort-workers.md')
  expect(manual).toContain('Tu ne prends jamais Fable seul : seul mon bouton « ↗ Fable » le donne, et tu ne le suggères que pour relancer un ticket qui bute après trois approches (section 11, « Ticket qui bute »).')
  const auto = AUTO_GROUP_EFFORT(false, 'P/reference/effort-workers.md')
  expect(auto).toContain('La mission est en mode auto : jamais Fable ; xhigh vient de la ligne « Jugement » d’un ticket')
  expect(auto).not.toContain('ni Fable ni xhigh')
  expect(auto).not.toContain('pose-moi')
})

for (const isBrief of [false, true]) {
  const form = isBrief ? 'brief écrit' : 'brief à rédiger'
  test(`« ↗ Fable » impose le chemin Fable, sans question ni arrêt pour l’effort, avec le seul brief Fable (${form})`, async ($, on) => {
    const written: Record<string, string> = {}
    const [text = ''] = await launch($, on, LOT, ['launch-fable-A'], isBrief, written)
    expect(lineOf(text, 'A')).toMatch(/ — Fable 5.2 high, imposé$/)
    expect(text).toContain("Effort de la session (<effort>) : high, pour le worker Fable (Fable 5.2 high, choisi par moi au tableau de bord ; ne me pose aucune question sur l'effort).")
    expect(text).toContain('aucun model dans start_session ni dans claude --bg')
    expect(text).not.toContain('pose-moi une question à boutons')
    expect(text).not.toContain('arrête-toi avant de lancer')
    expect(text).not.toContain('effort calculé')
    if (isBrief) {
      // Un seul brief, le Fable : sa marque dans l'appel delegate, worker Fable et worker autonome.
      const briefs = Object.entries(written)
      expect(briefs).toHaveLength(1)
      const [path = '', brief = ''] = briefs[0]!
      expect(path).toMatch(/-A-\d+-fable\.md$/)
      expect(text).toContain(`brief Fable du groupe A : '${path}'`)
      expect(text).not.toContain('brief Opus')
      expect(brief).toContain('tu es le worker Fable du groupe A')
      expect(brief).toMatch(/\{"delegate": "[^"]+", "group": "A", "main": "\[<ref>\]", "model": "fable"\}/)
      // Rejoué contre l'outil, l'appel du brief pose bien la marque.
      expect(await replayDelegate($, brief, true)).toContain(FABLE_WORKER)
      expect(brief).toContain("qu'elle est un worker Fable")
      expect(brief).toContain('et un worker autonome : elle applique la section « Worker autonome »')
    } else {
      // Le prompt rédigé par Claude porte la marque dans son appel delegate.
      expect(text).toMatch(/\{"delegate": "[^"]+", "group": "A", "main": "\[<ref>\]", "model": "fable"\}/)
      expect(await replayDelegate($, text, true)).toContain(FABLE_WORKER)
      expect(text).toContain("qu'elle est un worker Fable")
    }
  })

  test(`« ↗ Worker » sur un groupe avec logique : un seul brief, l’Opus, sans marque Fable ni question (${form})`, async ($, on) => {
    const written: Record<string, string> = {}
    const [text = ''] = await launch($, on, LOT, ['launch-linked-A'], isBrief, written)
    if (isBrief) {
      const briefs = Object.entries(written)
      expect(briefs).toHaveLength(1)
      const [path = '', brief = ''] = briefs[0]!
      expect(path).not.toMatch(/-fable\.md$/)
      expect(text).toContain(`brief du groupe A : '${path}'`)
      expect(brief).not.toContain('"model"')
      expect(brief).toContain('tu es le worker du groupe A')
      // Sans ticket de jugement, la session n'est pas un worker autonome (mission hors auto).
      expect(brief).toContain("et qu'elle n'est pas un worker autonome (aucun ticket « Jugement : oui » dans son groupe)")
      expect(await replayDelegate($, brief, false)).not.toContain(FABLE_WORKER)
    } else {
      expect(text).toContain("et qu'elle n'est pas un worker autonome (aucun ticket « Jugement : oui » dans son groupe)")
      expect(await replayDelegate($, text, false)).not.toContain(FABLE_WORKER)
    }
    expect(text).not.toContain('brief Fable')
    expect(text).not.toContain('brief Opus')
    expect(text).not.toContain('"model": "fable"')
    expect(text).not.toContain('Si je réponds')
  })

  test(`un groupe sans logique : un seul brief, sans rien du chemin Fable (${form})`, async ($, on) => {
    const written: Record<string, string> = {}
    const [text = ''] = await launch($, on, FUSION, ['launch-linked-E'], isBrief, written)
    if (isBrief) {
      expect(Object.keys(written)).toHaveLength(1)
      expect(Object.keys(written)[0]).not.toMatch(/-fable\.md$/)
      expect(text).toContain('Briefs écrits par flow-board (un par groupe, à passer tels quels)')
    }
    expect(text).not.toContain('brief Fable du groupe')
    expect(text).not.toContain('Si je réponds Fable 5.2 high : appel')
    expect(Object.values(written).join('')).not.toContain('"model"')
  })
}

test('« ↗ xhigh » inchangé : le seul brief Opus, xhigh imposé, l’arrêt pour monter l’effort gardé', async ($, on) => {
  const written: Record<string, string> = {}
  const [text = ''] = await launch($, on, LOT, ['launch-xhigh-A'], true, written)
  expect(Object.keys(written)).toHaveLength(1)
  expect(Object.keys(written)[0]).not.toMatch(/-fable\.md$/)
  expect(Object.values(written)[0]).not.toContain('"model"')
  // Rejoué contre l'outil, l'appel du brief Opus ne pose aucune marque.
  const answer = await replayDelegate($, Object.values(written)[0]!, false)
  expect(answer).toContain('This discussion works for the mission')
  expect(answer).not.toContain('Fable worker')
  expect(text).toContain('arrête-toi avant de lancer et demande-moi de passer cette discussion en xhigh')
  expect(text).not.toContain('"model": "fable"')
  expect(text).not.toContain('brief Fable')
  expect(text).not.toContain("l'Opus et le Fable")
})

test('un lot mêlant un groupe Sonnet et un groupe avec logique : un seul brief par groupe, sans brief Fable', async ($, on) => {
  const written: Record<string, string> = {}
  const [text = ''] = await launch($, on, FUSION, ['launch-parallel-linked'], true, written)
  expect(text).toMatch(/(: |; )brief du groupe A : '[^']+'/)
  expect(text).toMatch(/(: |; )brief du groupe E : '/)
  expect(text).not.toContain('brief Fable')
  expect(text).not.toContain('brief Opus')
  expect(Object.keys(written).some(p => p.endsWith('-fable.md'))).toBe(false)
  expect(text).toContain('un fichier par groupe (liste ci-dessous)')
})

// Option fusion : un groupe dont chaque ticket dit « Zone sensible : non » et « Logique : non » part en
// worker Sonnet high ; tout autre groupe hérite du modèle de la discussion (Opus), un effort imposé aussi.
const FUSION: Lot = {
  tickets: [
    { id: 'a1', name: 'Code', files: [FB], sensitive: false, logic: true },
    { id: 'e1', name: 'Doc', files: ['docs/x.md'], sensitive: false, logic: false },
    { id: 'e2', name: 'Réglage', files: ['config/x.json'], sensitive: false, logic: false },
    { id: 'm1', name: 'Muet', files: ['docs/y.md'], sensitive: false },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'E', name: 'Docs', tickets: ['e1', 'e2'] },
    { id: 'M', name: 'Muet', tickets: ['m1'] },
  ],
}

for (const isBrief of [false, true]) {
  const form = isBrief ? 'brief écrit' : 'brief à rédiger'
  test(`un groupe sans logique part en Sonnet high, les autres sans modèle (${form})`, async ($, on) => {
    const [docs = '', code = '', mute = ''] = await launch($, on, FUSION, ['launch-linked-E', 'launch-linked-A', 'launch-linked-M'], isBrief)
    expect(lineOf(docs, 'E')).toMatch(/ — Sonnet high, sans logique$/)
    expect(docs).toContain(SONNET_LAUNCH_FR)
    // Un groupe qui porte un ticket de jugement ne va jamais à Sonnet.
    expect(docs).toContain('un groupe qui porte un ticket de jugement ne va jamais à Sonnet). ')
    // La phrase suit la consigne d'effort après une espace, jamais collée à son point final.
    expect(docs).toContain(`. ${SONNET_LAUNCH_FR}`)
    expect(docs).toContain(`model "${SONNET_APP_ID}"`)
    expect(docs).toContain(`--model ${SONNET_CLI_ALIAS} --effort high`)
    // Un ticket à logique, ou muet sur sa logique : Opus, aucun texte Sonnet.
    for (const [text, id] of [[code, 'A'], [mute, 'M']] as const) {
      expect(lineOf(text, id)).toMatch(/ — effort calculé : medium$/)
      expect(text).not.toContain('Sonnet')
    }
  })
}

test('un groupe sans logique imposé en xhigh reste sur Opus', async ($, on) => {
  const [text = ''] = await launch($, on, FUSION, ['launch-xhigh-E'])
  expect(lineOf(text, 'E')).toMatch(/ — effort : xhigh, imposé$/)
  expect(text).not.toContain('Sonnet')
})

test('une demande pour plusieurs groupes mêle Sonnet et Opus groupe par groupe', async ($, on) => {
  const [text = ''] = await launch($, on, FUSION, ['launch-parallel-linked'])
  expect(lineOf(text, 'A')).toMatch(/ — effort calculé : medium$/)
  expect(lineOf(text, 'E')).toMatch(/ — Sonnet high, sans logique$/)
  expect(text).toContain(SONNET_LAUNCH_FR)
})

// Un ticket « Jugement : oui » ouvert : la ligne du groupe le dit après l'effort calculé, le groupe ne part jamais
// sur Sonnet (même sans logique ni zone sensible) et son worker est autonome, en manuel comme en auto ; rien de tel
// sous un effort imposé par un bouton.
const JUDGED: Lot = {
  tickets: [
    { id: 'j1', name: 'Refonte', files: [FB], sensitive: false, logic: true, judgment: true },
    { id: 'n1', name: 'Code', files: [FB], sensitive: false, logic: true, judgment: false },
    { id: 'jd', name: 'Doc long', files: ['docs/x.md'], sensitive: false, logic: false, judgment: true },
    { id: 'jf', name: 'Fait', files: [FB], sensitive: false, logic: true, judgment: true },
    { id: 'f2', name: 'Suite', files: [FB], sensitive: false, logic: true, judgment: false },
  ],
  groups: [
    { id: 'J', name: 'Jugement', tickets: ['j1'] },
    { id: 'N', name: 'Exécution', tickets: ['n1'] },
    { id: 'D', name: 'Document', tickets: ['jd'] },
    { id: 'F', name: 'Fini', tickets: ['jf', 'f2'] },
  ],
}

for (const isBrief of [false, true]) {
  const form = isBrief ? 'brief écrit' : 'brief à rédiger'
  test(`un groupe qui porte un ticket de jugement : « xhigh pendant un ticket de jugement » sur sa ligne, worker autonome, jamais Sonnet (${form})`, async ($, on) => {
    const written: Record<string, string> = {}
    const [judged = '', plain = '', doc = ''] = await launch($, on, JUDGED, ['launch-linked-J', 'launch-linked-N', 'launch-linked-D'], isBrief, written)
    expect(lineOf(judged, 'J')).toMatch(/ — effort calculé : medium, xhigh pendant un ticket de jugement$/)
    expect(lineOf(plain, 'N')).toMatch(/ — effort calculé : medium$/)
    // Sans logique ni zone sensible, mais avec un ticket de jugement : pas de Sonnet.
    expect(lineOf(doc, 'D')).toMatch(/ — effort calculé : medium, xhigh pendant un ticket de jugement$/)
    expect(doc).not.toContain('Sonnet')
    for (const text of [judged, plain, doc]) expect(text).not.toContain('question à boutons')
    const autonomous = "qu'elle est un worker autonome : elle applique la section « Worker autonome » de la procédure (procedure-groupe-autonome.md) (son groupe porte un ticket « Jugement : oui »)"
    if (isBrief) {
      const briefs = Object.values(written)
      expect(briefs).toHaveLength(3)
      expect(briefs.filter(b => b.includes(autonomous))).toHaveLength(2)
      expect(briefs.filter(b => b.includes("et qu'elle n'est pas un worker autonome"))).toHaveLength(1)
    } else {
      expect(judged).toContain(autonomous)
      expect(doc).toContain(autonomous)
      expect(plain).toContain("et qu'elle n'est pas un worker autonome (aucun ticket « Jugement : oui » dans son groupe)")
    }
  })
}

test('un ticket de jugement fait ne compte plus : ni mention sur la ligne, ni autonomie', async ($, on) => {
  const lot: Lot = { ...JUDGED, tickets: JUDGED.tickets.map(t => (t.id === 'jf' ? { ...t, status: 'done' } : t)) }
  const [text = ''] = await launch($, on, lot, ['launch-linked-F'])
  expect(lineOf(text, 'F')).toMatch(/ — effort calculé : medium$/)
  expect(text).toContain("et qu'elle n'est pas un worker autonome")
})

test('sous un effort imposé, rien du ticket de jugement sur la ligne ; « ↗ xhigh » et « ↗ Fable » gardent leur chemin et leur autonomie', async ($, on) => {
  const [xhigh = '', fable = ''] = await launch($, on, JUDGED, ['launch-xhigh-J', 'launch-fable-D'])
  expect(lineOf(xhigh, 'J')).toMatch(/ — effort : xhigh, imposé$/)
  expect(lineOf(fable, 'D')).toMatch(/ — Fable 5.2 high, imposé$/)
  expect(xhigh).toContain('arrête-toi avant de lancer et demande-moi de passer cette discussion en xhigh')
  expect(xhigh).toContain("et qu'elle est un worker autonome")
  expect(fable).toContain("qu'elle est un worker Fable")
  expect(fable).not.toContain('Sonnet')
})

test('une demande pour plusieurs groupes, sans brief écrit, dit l’autonomie au conditionnel du ticket de jugement', async ($, on) => {
  const [text = ''] = await launch($, on, JUDGED, ['launch-parallel-linked'])
  expect(text).toContain("et, si son groupe porte un ticket « Jugement : oui », qu'elle est un worker autonome")
})
