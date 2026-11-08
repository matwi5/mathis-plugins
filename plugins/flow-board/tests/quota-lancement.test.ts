import { expect, mock, test } from 'claude-code/testing'

import { coordinationRows } from '../hooks/coo-view.tsx'
import { cooStatement } from '../hooks/coo.ts'
import { GROUP_EFFORT, quotaText, type QuotaWindow } from '../hooks/effort.ts'
import { emptyBoard } from '../hooks/model.ts'

// Le quota de la discussion avant un lancement : la limite hebdomadaire était tombée 5 minutes après le
// lancement d'un groupe en xhigh, et sa session était restée arrêtée 24 h. La carte de lancement le montre,
// et la demande le cite dans la question d'effort xhigh ; sans quota lu, rien ne change.

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const NOW = Date.parse('2026-11-08T10:00:00Z')
const HOUR = 3_600_000
const QUOTA: QuotaWindow[] = [
  { kind: 'five_hour', percentUsed: 42.4, resetsAt: new Date(NOW + 2 * HOUR + 5 * 60_000).toISOString() },
  { kind: 'seven_day', percentUsed: 80, resetsAt: new Date(NOW + 3 * 24 * HOUR).toISOString() },
]
const QUOTA_TEXT = '5 h : 42 % (remise dans 2 h 05) · 7 j : 80 % (remise dans 3 j)'
/** La ligne de la carte : « quota de la discussion », un point entre deux espaces insécables, puis le quota. */
const QUOTA_LINE = new RegExp(`^quota de la discussion\u00a0·\u00a0${QUOTA_TEXT.replace(/[()]/g, '\\$&')}$`)

const FB = 'plugins/flow-board/hooks/model.ts'
const LOT = {
  tickets: [
    { id: 'a1', name: 'Code', files: [FB], sensitive: false, logic: true },
    { id: 'b1', name: 'Autre', files: ['plugins/stats-board/hooks/register.tsx'], sensitive: false, logic: true },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'B', name: 'Autre', tickets: ['b1'] },
  ],
}

/**
 * Monte le tableau de bord d'une mission à deux groupes prêts, le quota rendu par le moteur valant
 * `limits` (absent : `session.usage` ne répond pas de quota) ; rend si la carte « Ensuite » montre une
 * ligne de quota (`shown`), si c'est celle de `QUOTA` (`exact`), si la carte porte bien le lancement des
 * groupes (`isLaunchDrawn`), et la demande de chaque appui de `presses` (une par appui : `texts`).
 */
const mount = async ($: any, on: any, limits: unknown, presses: string[]): Promise<{ shown: boolean; exact: boolean; isLaunchDrawn: boolean; texts: string[] }> => {
  mock.clock(on, { now: NOW })
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: '/proj', remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, ...(limits === undefined ? {} : { rateLimits: limits }) } }) as any)
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }) as any)
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    throw new Error(`absent : ${e.path}`)
  })
  on('fs.exists', () => ({ value: false }) as any)
  on('fs.write', (_$: unknown, e: { path: string }) => {
    throw new Error(`pas de disque : ${e.path}`)
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    throw new Error(`pas de disque : ${e.path}`)
  })
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const shown = (await ui.find({ type: 'Text', text: /^quota de la discussion/ })) !== undefined
  const exact = (await ui.find({ type: 'Text', text: QUOTA_LINE })) !== undefined
  // La carte « Ensuite » du lancement des deux groupes indépendants (« ⇉ A ∥ B en parallèle · workers »).
  const isLaunchDrawn = ((await ui.findAll({ type: 'Button' })) as { key?: unknown; props: { key?: unknown } }[]).some(b => String(b.key ?? b.props.key) === 'next-parallel-linked')
  const texts: string[] = []
  for (const key of presses) {
    const before = filled.length
    await ui.press({ key })
    // Chaque appui remplit le prompt : sinon le texte d'avant serait relu à tort.
    expect(filled.length).toBe(before + 1)
    texts.push(filled.at(-1)!)
  }
  await ui.unmount()
  return { shown, exact, isLaunchDrawn, texts }
}

test('quotaText : les fenêtres de 5 h et de 7 jours, leur pourcentage et leur remise ; rien sans elles', () => {
  expect(quotaText(QUOTA, NOW)).toBe(QUOTA_TEXT)
  // L'ordre du moteur ne compte pas ; une passerelle (spend_limit) est laissée de côté.
  expect(quotaText([{ kind: 'spend_limit', percentUsed: 10 }, ...[...QUOTA].reverse()], NOW)).toBe(QUOTA_TEXT)
  expect(quotaText([{ kind: 'spend_limit', percentUsed: 10 }], NOW)).toBeNull()
  // Hors abonnement ou avant la première réponse : rien.
  expect(quotaText([], NOW)).toBeNull()
  expect(quotaText(undefined, NOW)).toBeNull()
  expect(quotaText(null, NOW)).toBeNull()
  // Une remise passée ou illisible est tue ; un pourcentage illisible écarte la fenêtre.
  expect(quotaText([{ kind: 'five_hour', percentUsed: 7, resetsAt: new Date(NOW - 1000).toISOString() }], NOW)).toBe('5 h : 7 %')
  expect(quotaText([{ kind: 'five_hour', percentUsed: 7, resetsAt: 'demain' }], NOW)).toBe('5 h : 7 %')
  expect(quotaText([{ kind: 'five_hour', percentUsed: Number.NaN }, { kind: 'seven_day', percentUsed: 3 }], NOW)).toBe('7 j : 3 %')
  // Une remise proche se dit en minutes.
  expect(quotaText([{ kind: 'five_hour', percentUsed: 99, resetsAt: new Date(NOW + 40 * 60_000).toISOString() }], NOW)).toBe('5 h : 99 % (remise dans 40 min)')
})

test('la carte de lancement des groupes montre le quota de la discussion quand le moteur le donne', async ($, on) => {
  const { shown, exact, isLaunchDrawn } = await mount($, on, QUOTA, [])
  expect(isLaunchDrawn).toBe(true)
  expect(shown).toBe(true)
  expect(exact).toBe(true)
})

for (const [label, limits] of [
  ['sans quota (hors abonnement)', []],
  ['avant la première réponse (pas de rateLimits)', undefined],
] as const) {
  test(`${label}, la carte de lancement est inchangée et la demande ne parle pas de quota`, async ($, on) => {
    const { shown, isLaunchDrawn, texts } = await mount($, on, limits, ['launch-linked-A', 'launch-xhigh-B'])
    // La carte du lancement est bien dessinée et chaque appui a rempli le prompt : seule la ligne de quota manque.
    expect(isLaunchDrawn).toBe(true)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('xhigh (Recommandé) / high')
    expect(texts[1]).toContain("Effort de la session (<effort>) : xhigh, choisi par moi au tableau de bord")
    expect(shown).toBe(false)
    for (const text of texts) expect(text).not.toContain('quota')
  })
}

test('la demande de lancement cite le quota dans la question d’effort xhigh, et sous un xhigh imposé', async ($, on) => {
  const { texts } = await mount($, on, QUOTA, ['launch-linked-A', 'launch-xhigh-B'])
  const [asked = '', imposed = ''] = texts
  expect(asked).toContain(`question à boutons « xhigh (Recommandé) / high » avec une ligne qui nomme le ticket et la sorte de jugement, et une ligne qui cite le quota de cette discussion, relevé à l'écriture de cette demande (${QUOTA_TEXT})`)
  expect(imposed).toContain(`ne me pose aucune question sur l'effort ; en lançant, cite-moi en une ligne, sans attendre de réponse, le quota de cette discussion, relevé à l'écriture de cette demande (${QUOTA_TEXT})`)
})

test('GROUP_EFFORT sans quota garde son texte d’avant', () => {
  for (const imposed of [undefined, 'xhigh'] as const) {
    expect(GROUP_EFFORT(false, imposed, 'high', 'P', null)).toBe(GROUP_EFFORT(false, imposed, 'high', 'P'))
    expect(GROUP_EFFORT(false, imposed, 'high', 'P')).not.toContain('quota')
  }
})

test('chez le COO : le quota sous une carte prête en xhigh, jamais sous une carte en high ni sans quota', () => {
  const card = (effort: 'high' | 'xhigh') => ({ id: 'kabcdef12', title: 'Export CSV', start: 'grill-with-docs' as const, askMatt: 'l. 19', alts: [], mode: 'manual' as const, modeWhy: '', effort, effortWhy: '', folder: 'export-csv', at: 1 })
  const quotaRow = (effort: 'high' | 'xhigh', quota?: string) => {
    const s = cooStatement(emptyBoard('', 'p'), { now: 2, cards: [card(effort)] })
    return coordinationRows(quota ? { ...s, quota } : s).find(row => row.key === 'coo-card-quota-kabcdef12')?.parts.map(p => p.text.replace(/\u00a0/g, ' ')).join('')
  }
  expect(quotaRow('xhigh', QUOTA_TEXT)).toBe(`quota de la discussion · ${QUOTA_TEXT}`)
  expect(quotaRow('high', QUOTA_TEXT)).toBeUndefined()
  expect(quotaRow('xhigh')).toBeUndefined()
})
