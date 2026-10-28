import { expect, mock, test } from 'claude-code/testing'

import { laneCells, rulerCells } from '../hooks/cells.ts'
import { C } from '../hooks/catalog.ts'
import { familyGlyphs, relayGlyphs } from '../hooks/view.tsx'
import type { SessionRegistry } from '../types'

const PLUGIN = 'flow-board'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const
const ALL = ['terminal', 'desktop', 'vscode', 'mobile'] as const

/** Le moteur sous le plugin : la session « s-frise », un stockage en mémoire. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-frise' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  return mem
}

/**
 * Un sous-agent qui réfléchit 2 s, écrit un Read (0,5 s), le lance (0,3 s), puis demande une
 * commande : l'autorisation le fait attendre `waitMs` (5 s par défaut), la commande tourne 1 s ; il
 * rédige 1 s, puis finit.
 */
const scenario = async ($: any, on: any, clock: any, waitMs = 5_000) => {
  let plan: 'read' | 'bash' | 'report' = 'read'
  on('turn.step', async function* (_$: unknown, e: any) {
    if (e.agentId === undefined) return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    yield { kind: 'thinking', index: 0, text: '' }
    await clock.advance(2_000)
    if (plan === 'report') {
      yield { kind: 'text', index: 1, text: 'Rapport' }
      await clock.advance(1_000)
    } else {
      yield { kind: 'tool', index: 1, id: plan === 'read' ? 'tu-read' : 'tu-bash', name: plan === 'read' ? 'Read' : 'Bash' }
      await clock.advance(500)
    }
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' }
    yield { kind: 'stop', stopReason: plan === 'report' ? 'end_turn' : 'tool_use', usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  on('tool.call', { tool: 'Read' }, async () => {
    await clock.advance(300)
    return { result: { ok: true } }
  })
  on('tool.call', { tool: 'Bash' }, async () => {
    // L'autorisation demandée, accordée 5 s plus tard, puis 1 s de commande.
    await $.classic.PermissionRequest({ tool_name: 'Bash', agent_id: 'a1', tool_input: {}, session_id: 's-frise', transcript_path: 't', cwd: '/p', hook_event_name: 'PermissionRequest' })
    await clock.advance(waitMs + 1_000)
    await $.classic.PostToolUse({ tool_name: 'Bash', tool_use_id: 'tu-bash', duration_ms: 1_000, agent_id: 'a1', tool_input: {}, tool_response: {}, session_id: 's-frise', transcript_path: 't', cwd: '/p', hook_event_name: 'PostToolUse' })
    return { result: { stdout: 'ok' } }
  })
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }))

  await $.tool.call({ tool: 'Agent', description: 'Explorer le module', prompt: 'p', run_in_background: true, tool_use_id: 'call-1' })
  const step = async (index: number) => {
    for await (const _ of $.turn.step({ turnId: 'ta', index, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' })) {
      // la réponse du sous-agent
    }
  }
  await step(0)
  await $.tool.call({ tool: 'Read', file_path: '/p/hooks/view.tsx', tool_use_id: 'tu-read', agentId: 'a1' })
  plan = 'bash'
  await step(1)
  await $.tool.call({ tool: 'Bash', command: 'touch b.txt', tool_use_id: 'tu-bash', agentId: 'a1' })
  plan = 'report'
  await step(2)
  // Une requête de plus du sous-agent : réflexion 2 s, rédaction 1 s.
  return () => step(3)
}

test('les requêtes et les outils d’un sous-agent deviennent des segments datés de sa piste', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 40_000_000 })
  const mem = world(on)
  await scenario($, on, clock)
  await clock.advance(1_000)
  const reg = mem['agents:s-frise'] as SessionRegistry
  const segs = reg.agents[0]!.segments!.map(s => `${s.k}${s.f ? `/${s.f}` : ''}:${(s.e ?? NaN) - s.s}${s.a ? `:${s.a}` : ''}`)
  expect(segs).toEqual(['think:2000', 'tool/read:800:hooks/view.tsx', 'think:2000', 'tool/run:500:touch b.txt', 'waitPerson:5000', 'tool/run:1000:touch b.txt', 'think:2000', 'write:1000'])
  // Le départ est relevé sur la piste de l'orchestrateur.
  expect(reg.main?.marks?.map(m => m.k)).toEqual(['relay'])
})

test('la frise se dessine sur les 4 surfaces : SVG décrit par son texte alt, cases au terminal, préréglages « dernière heure » et « tout »', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 41_000_000 })
  world(on)
  await scenario($, on, clock)
  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Button', text: /Orchestrateur$/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Explorer le module$/ })).toBeDefined()
    if (surface === 'terminal') {
      // Une grille de cases, ou à défaut des barres de glyphes : la réflexion « ▒ » s'y lit.
      const drawn = JSON.stringify(await ui.drawn())
      expect(/"Raster"|▒/.test(drawn)).toBe(true)
    } else {
      const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
      expect(alts).toContain('Explorer le module : réflexion, outil ⌕, réflexion, outil ❯, attend ta réponse, outil ❯, réflexion, rédaction')
    }
    expect(await ui.find({ type: 'Text', text: /rédaction/ })).toBeDefined()
    await ui.press({ key: 'agents-hour' })
    expect(await ui.find({ key: 'agents-all' })).toBeDefined()
    await ui.press({ key: 'agents-all' })
    await ui.press({ key: 'tab-flow' })
    await ui.unmount()
  }
})

test('un sous-agent sans fin vue garde son segment en cours, qui s’allonge', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 42_000_000 })
  const mem = world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }))
  on('tool.call', { tool: 'Grep' as any }, async () => {
    await clock.advance(60_000)
    return { result: {} }
  })
  await $.tool.call({ tool: 'Agent', description: 'Chercheur', prompt: 'p', run_in_background: true, tool_use_id: 'call-1' } as any)
  await ($ as any).agent.spawn({ prompt: 'p', description: 'Chercheur', background: true, tool_use_id: 'call-1' })
  const pending = $.tool.call({ tool: 'Grep', pattern: 'x', tool_use_id: 'tu-1', agentId: 'a1' } as any)
  await clock.advance(1_000)
  const reg = mem['agents:s-frise'] as SessionRegistry
  expect(reg.agents[0]!.segments?.[0]).toMatchObject({ k: 'tool', f: 'read', a: 'x' })
  expect(reg.agents[0]!.segments?.[0]!.e).toBeUndefined()
  await pending
})

test('le retour d’un sous-agent se pose sur la piste du lanceur quand son message arrive ; un tour interrompu ferme ses segments', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 43_000_000 })
  const mem = world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }))
  on('classic.SubagentStop', () => ({}))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.step', async function* (_$: unknown, e: any) {
    yield { kind: 'thinking', index: 0, text: '' }
    await clock.advance(1_000)
    throw new Error('interrompu')
  })
  await $.tool.call({ tool: 'Agent', description: 'Chercheur', prompt: 'p', run_in_background: true, tool_use_id: 'call-1' } as any)
  await ($ as any).agent.spawn({ prompt: 'p', description: 'Chercheur', background: true, tool_use_id: 'call-1' })
  try {
    for await (const _ of $.turn.step({ turnId: 'ta', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' } as any)) {
      // la réponse, coupée
    }
  } catch {
    // l'interruption remonte au moteur
  }
  // Une fin de tour du sous-agent ne pose pas de retour : il n'a encore rien rendu au fil principal.
  await ($ as any).classic.SubagentStop({ agent_id: 'a1', agent_type: 'general-purpose', agent_transcript_path: 'x', stop_hook_active: false })
  await $.prompt.submit({ text: '<agent-message from="a1">Rapport</agent-message>', origin: { kind: 'peer' } } as any)
  await clock.advance(1_000)
  const reg = mem['agents:s-frise'] as SessionRegistry
  expect(reg.agents[0]!.segments!.every(s => s.e !== undefined)).toBe(true)
  expect(reg.main!.marks!.map(m => m.k)).toEqual(['relay', 'back'])
})

test('une attente de l’autorisation de plus d’une minute se compresse, son attente ambre gardée dans la piste', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 44_000_000 })
  world(on)
  await scenario($, on, clock, 20 * 60_000)
  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Text', text: /┊\spauses\scompressées\s:\s20\smin/ })).toBeDefined()
    if (surface !== 'terminal') {
      const alts = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt).replace(/\u00a0/g, ' '))
      // La pause est nommée là où elle coupe la piste, l'attente qu'elle écrase gardée.
      expect(alts).toContain('Explorer le module : réflexion, outil ⌕, réflexion, outil ❯, attend ta réponse, pause de 20 min, outil ❯, réflexion, rédaction')
    } else {
      // Au terminal, la pause coupe le rail : « ┊ », plus « ⫽ ».
      const drawn = JSON.stringify(await ui.drawn())
      expect(drawn.includes('⫽')).toBe(false)
    }
    await ui.unmount()
  }
})

test('la légende nomme chaque attente et la pause ; la légende détaillée, repliée, s’ouvre et se referme', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 45_000_000 })
  world(on)
  await scenario($, on, clock)
  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    for (const word of [/attend\sun\ssous-agent/, /attend\sta\sréponse/, /attend\sune\stâche\sde\sfond/, /pause\s:\spersonne\sne\stravaillait/]) {
      expect(await ui.find({ type: 'Text', text: word })).toBeDefined()
    }
    // Repliée par défaut : aucun outil n'y est listé.
    expect(await ui.find({ type: 'Text', text: /NotebookEdit/ })).toBeUndefined()
    await ui.press({ key: 'agents-legend' })
    for (const tool of [/Grep/, /MultiEdit/, /PowerShell/, /WebSearch/, /SendMessage/]) {
      expect(await ui.find({ type: 'Text', text: tool })).toBeDefined()
    }
    // Les types d'agents et les repères aussi.
    expect(await ui.find({ type: 'Text', text: /Relecture\sde\scode/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /compaction/ })).toBeDefined()
    await ui.press({ key: 'agents-legend' })
    expect(await ui.find({ type: 'Text', text: /NotebookEdit/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('la légende montre les glyphes de la surface : ceux du SVG sur les surfaces riches, ceux des cases au terminal', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 46_000_000 })
  world(on)
  await scenario($, on, clock)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    await ui.press({ key: 'agents-legend' })
    const has = async (glyph: string) => (await ui.find({ type: 'Text', text: new RegExp(glyph) })) !== undefined
    expect(await Promise.all(['🌐', '●', '○', '◍', '↳'].map(has))).toEqual([true, true, true, false, false])
    await ui.unmount()
  }
  // Le faux moteur prête le SVG à toutes ses surfaces : le terminal se vérifie sur ses tables.
  const terminal = { isRich: false } as Parameters<typeof familyGlyphs>[0]
  expect(familyGlyphs(terminal).web).toBe('◍')
  expect(relayGlyphs(terminal)).toEqual(['↳', '↲'])
})

/** Le texte `alt` de la piste du sous-agent, blancs insécables ramenés à des espaces. */
const explorerAlt = async (ui: any): Promise<string> =>
  (await ui.findAll({ type: 'Svg' })).map((svg: any) => String(svg.props.alt).replace(/\u00a0/g, ' ')).find((alt: string) => alt.startsWith('Explorer le module')) ?? ''

test('la barre de navigation : chaque bouton a sa lettre et son raccourci, la règle graduée est en tête des pistes', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 47_000_000 })
  world(on)
  await scenario($, on, clock, 20 * 60_000)
  for (const surface of ALL) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    for (const [key, letter] of [['agents-zoom-out', 'o'], ['agents-zoom-in', 'i'], ['agents-left', 'h'], ['agents-right', 'l'], ['agents-all', 't']] as const) {
      const button = await ui.find({ key })
      expect(button?.props.hotkey).toBe(letter)
      expect(String(button?.props.label)).toMatch(new RegExp(`${letter}$`))
    }
    expect((await ui.find({ key: 'agents-hour' }))?.props.hotkey).toBeUndefined()
    // L'ancienne bascule a disparu.
    expect(await ui.find({ key: 'agents-range' })).toBeUndefined()
    // Le Svg du terminal du faux moteur ne dessine rien : la règle du terminal se vérifie à part (rulerCells).
    if (surface !== 'terminal') expect((await ui.findAll({ type: 'Svg' })).some(svg => /^règle graduée : /.test(String(svg.props.alt).replace(/\u00a0/g, ' ')))).toBe(true)
    await ui.unmount()
  }
})

const RICH = ['desktop', 'vscode', 'mobile'] as const

/** Le dessin SVG de la piste du sous-agent : il change dès que la fenêtre glisse (le texte `alt` s'arrête à 12 mots). */
const explorerSource = async (ui: any): Promise<string> =>
  String((await ui.findAll({ type: 'Svg' })).find((svg: any) => String(svg.props.alt).startsWith('Explorer'))?.props.source ?? '')

test('zoomer suit le direct : un nouveau segment apparaît ; décalée vers le passé, la fenêtre reste figée', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 48_000_000 })
  world(on)
  const more = await scenario($, on, clock, 20 * 60_000)
  const count = (alt: string) => alt.match(/rédaction/g)?.length ?? 0
  for (const surface of RICH) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    const all = await explorerAlt(ui)
    expect(all).toContain('outil ⌕')
    // Zoom avant : la fin de la frise seulement, le début (la lecture) n'y est plus.
    await ui.press({ key: 'agents-zoom-in' })
    const zoomed = await explorerAlt(ui)
    const zoomedSource = await explorerSource(ui)
    expect(zoomed).not.toContain('outil ⌕')
    expect(count(zoomed)).toBeGreaterThan(0)
    expect(await ui.find({ type: 'Text', text: /→\smaintenant/ })).toBeDefined()
    // Elle suit le direct : une nouvelle requête du sous-agent y entre.
    await clock.advance(5_000)
    await more()
    expect(await explorerSource(ui)).not.toBe(zoomedSource)
    // Décalée vers le passé, elle se fige : une requête de plus ne la change pas.
    await ui.press({ key: 'agents-left' })
    // Le même moment : mêmes heures aux bornes, même contenu. (Les proportions entre une pause et
    // le temps réel peuvent bouger : la fenêtre découpe l'axe entier, qui se recalcule.)
    const frozen = await explorerAlt(ui)
    const bounds = async () => (await ui.find({ type: 'Text', text: /\d\d:\d\d\s→\s\d\d:\d\d/ }))?.props
    expect(await bounds()).toBeDefined()
    const frozenBounds = JSON.stringify(await bounds())
    await clock.advance(5_000)
    await more()
    expect(await explorerAlt(ui)).toBe(frozen)
    expect(JSON.stringify(await bounds())).toBe(frozenBounds)
    // ▶ la ramène au bout : elle suit à nouveau le direct et voit la dernière requête, que la
    // fenêtre figée ne montrait pas (le texte `alt` s'arrête à 12 mots : on compte les rédactions).
    await ui.press({ key: 'agents-right' })
    expect(count(await explorerAlt(ui))).toBeGreaterThan(count(frozen))
    // − la rouvre jusqu'à tout.
    for (let i = 0; i < 4; i++) await ui.press({ key: 'agents-zoom-out' })
    expect(await explorerAlt(ui)).toContain('outil ⌕')
    // « dernière heure » sur moins d'une heure de frise : toute la frise.
    await ui.press({ key: 'agents-zoom-in' })
    await ui.press({ key: 'agents-hour' })
    expect(await explorerAlt(ui)).toContain('outil ⌕')
    // « tout » rend toute la frise.
    await ui.press({ key: 'agents-zoom-in' })
    await ui.press({ key: 'agents-all' })
    expect(await explorerAlt(ui)).toContain('outil ⌕')
    await ui.unmount()
  }
})

test('une frise qui n’est plus en direct ne dit pas « maintenant » au bout de sa fenêtre', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 48_500_000 })
  world(on)
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  await scenario($, on, clock, 20 * 60_000)
  // Le sous-agent rend sa réponse : plus rien ne tourne.
  await ($ as any).turn.complete({ turnId: 'ta', agentId: 'a1', answer: 'Rapport', isAborted: false })
  await clock.advance(10 * 60_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-zoom-in' })
  expect(await ui.find({ type: 'Text', text: /maintenant/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\d\d:\d\d\s→\s\d\d:\d\d/ })).toBeDefined()
  await ui.unmount()
})

test('la fenêtre repart de « tout » à la réouverture de l’onglet', { timeoutMs: 20000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 49_000_000 })
  world(on)
  await scenario($, on, clock, 20 * 60_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-zoom-in' })
  expect(await explorerAlt(ui)).not.toContain('outil ⌕')
  await ui.press({ key: 'tab-flow' })
  await ui.press({ key: 'tab-agents' })
  expect(await explorerAlt(ui)).toContain('outil ⌕')
  await ui.unmount()
})

// Le terminal du faux moteur a un Svg que le vrai terminal n'a pas : un Svg n'y dessine rien, et
// les assertions « terminal » qui le cherchaient étaient vides. La frise du terminal se teste par
// ses cases (laneCells, rulerCells), et l'onglet n'y émet jamais de Svg.
test('au terminal, l’onglet Agents n’émet aucun Svg, légende détaillée et zoom compris', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 47_000_000 })
  world(on)
  await scenario($, on, clock, 20 * 60_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  await ui.press({ key: 'agents-legend' })
  await ui.press({ key: 'agents-zoom-in' })
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  await ui.unmount()
})

test('les cases d’une piste au terminal : réflexion, outil et son glyphe, attente, pause coupée, repère', () => {
  const parts = [
    { kind: 'think' as const, x0: 0, x1: 0.2, s: 0, e: 2 },
    { kind: 'tool' as const, family: 'read' as const, x0: 0.2, x1: 0.4, s: 2, e: 4 },
    { kind: 'waitPerson' as const, x0: 0.4, x1: 0.5, s: 4, e: 5 },
  ]
  const pauses = [{ x0: 0.6, x1: 0.9, label: '2 h' }]
  const cells = laneCells(parts, [{ k: 'back', at: 0, x: 0.95 } as any], pauses, 20, C.blue, true)
  expect(cells.map(c => c.glyph).join('')).toBe(`▒▒▒▒⌕███╱╱··┊2 h ┊·${cells[19]!.glyph}`)
  expect(cells[19]!.glyph).not.toBe('·')
  // La réflexion est plus pâle que l'outil ; l'attente de la personne est ambre ; le glyphe d'outil se pose sur la couleur de la piste.
  expect(cells[0]!.alpha).toBeLessThan(cells[5]!.alpha!)
  expect(cells[8]!.color).toBe(C.amber)
  expect(cells[4]!.bg).toBe(C.blue)
  // La ligne advisor : des cases cerclées à la place des blocs pleins.
  expect(laneCells(parts.slice(0, 1), [], [], 10, C.gold, false, true).map(c => c.glyph).join('')).toBe('▭▭········')
})

test('la règle graduée au terminal : « ╵ » et l’heure quand elle tient, « ┊ » aux bords des pauses', () => {
  const ruler = rulerCells([{ x: 0, label: '10:00' }, { x: 0.5, label: '10:30' }], [{ x0: 0.8, x1: 0.9 }], 20)
  expect(ruler.replace(/\u00a0/g, ' ')).toBe('╵10:00    ╵10:30┊┊  ')
  // Une heure qui toucherait la graduation suivante ne s'écrit pas.
  expect(rulerCells([{ x: 0, label: '10:00' }, { x: 0.1, label: '10:05' }], [], 10).replace(/\u00a0/g, ' ')).toBe('╵╵10:05   ')
})
