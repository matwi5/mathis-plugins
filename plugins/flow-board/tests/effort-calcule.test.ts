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
 * demande les cite), sinon elle fait rédiger le brief à Claude (le repli).
 */
const launch = async ($: any, on: any, lot: Lot, presses: string[], isBrief = false): Promise<string[]> => {
  mock.clock(on, { now: NOW })
  const mem: Record<string, unknown> = {}
  const written: Record<string, string> = {}
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
    expect(text).toContain('Pendant un ticket sensible, le mod de la session la passe lui-même en high')
    expect(text).not.toContain('medium par défaut')
  }
  const manual = GROUP_EFFORT(true, undefined, undefined, 'P/reference/effort-workers.md')
  expect(manual).toContain('xhigh (Recommandé) / high')
  expect(manual).toContain('tâche de jugement')
  expect(AUTO_GROUP_EFFORT(false, 'P/reference/effort-workers.md')).toContain('jamais xhigh')
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
    // Un groupe passé en xhigh à la question à boutons ne garde pas Sonnet : xhigh vaut pour une tâche de jugement.
    expect(docs).toContain('ni pour un groupe que je fais passer en xhigh')
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
