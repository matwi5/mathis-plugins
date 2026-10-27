import { expect, mock, test } from 'claude-code/testing'

import { emptyRegistry, joinRegistry, parseRegistry, PART_MAX_BYTES, splitRegistry, startCall, utf8Length } from '../hooks/registry.ts'
import { maskSecrets, shortArg } from '../hooks/timeline.ts'
import type { RegistryAgent, SessionRegistry } from '../types'

// ─── R1 : un registre découpé en morceaux numérotés, sans perte ─────────────

/** Un sous-agent au long prompt accentué (2 octets par « é ») et à la longue piste. */
const bigAgent = (i: number): RegistryAgent => ({
  key: `call-${i}`,
  agentId: `a${i}`,
  name: `Relecture ${i}`,
  prompt: 'é'.repeat(7_000),
  isBackground: true,
  status: 'done',
  startedAt: 1_000 + i,
  finishedAt: 2_000 + i,
  source: 'live',
  segments: Array.from({ length: 300 }, (_, j) => ({ k: 'tool' as const, s: 10_000 * i + j * 10, e: 10_000 * i + j * 10 + 5, f: 'read' as const, t: 'Read', a: `hooks/fichier-${j}.ts` })),
})

const bigRegistry = (n: number): SessionRegistry => ({
  ...emptyRegistry('s-gros', '/p', 1),
  agents: Array.from({ length: n }, (_, i) => bigAgent(i)),
  main: { segments: Array.from({ length: 5_000 }, (_, j) => ({ k: 'think' as const, s: j * 100, e: j * 100 + 50 })) },
})

test('R1 : un registre trop gros pour un fichier se découpe en morceaux de moins de 4 Mio, que la lecture réunit sans rien perdre', () => {
  const reg = bigRegistry(400)
  // Plus de 4 Mio d'un seul tenant : une écriture serait refusée.
  expect(utf8Length(JSON.stringify(reg))).toBeGreaterThan(4 * 1024 * 1024)
  const { head, parts } = splitRegistry(reg, new Map())
  expect(parts.length).toBeGreaterThan(1)
  for (const text of [JSON.stringify(head), ...parts.map(p => JSON.stringify(p))]) expect(utf8Length(text)).toBeLessThanOrEqual(PART_MAX_BYTES)
  // Relus (texte du disque), les morceaux redonnent tout : sous-agents, prompts, pistes, piste de l'orchestrateur.
  const joined = joinRegistry(parseRegistry(JSON.stringify(head))!, parts.map(p => JSON.parse(JSON.stringify(p)))).reg
  expect(joined.agents.map(a => a.key).sort()).toEqual(reg.agents.map(a => a.key).sort())
  expect(joined.agents.find(a => a.key === 'call-399')!.segments).toHaveLength(300)
  expect(joined.agents.find(a => a.key === 'call-0')!.prompt).toHaveLength(7_000)
  expect(joined.main!.segments).toHaveLength(5_000)
})

test('R1 : un sous-agent garde son morceau d’une écriture à l’autre ; seul le trop-plein monte au morceau suivant', () => {
  const reg = bigRegistry(400)
  const first = splitRegistry(reg, new Map())
  const { placed } = joinRegistry(first.head, first.parts)
  // Un nouveau sous-agent, et le premier qui grandit : les autres ne bougent pas, aucun ne descend.
  const grown: SessionRegistry = {
    ...reg,
    agents: [...reg.agents.map(a => (a.key === 'call-0' ? { ...a, segments: [...a.segments!, { k: 'write' as const, s: 1, e: 2 }] } : a)), bigAgent(400)],
  }
  const second = splitRegistry(grown, placed)
  const again = joinRegistry(second.head, second.parts)
  for (const [key, part] of placed) if (key !== 'a|call-0') expect(again.placed.get(key)! >= part).toBe(true)
  expect(again.placed.get('a|call-400')).toBe(second.parts.length)
  expect(again.reg.agents).toHaveLength(401)
})

test('R1 : un morceau illisible (écriture coupée) n’empêche pas de lire les autres', () => {
  const { head, parts } = splitRegistry(bigRegistry(400), new Map())
  const joined = joinRegistry(head, [null, ...parts.slice(1)]).reg
  expect(joined.agents.length).toBeGreaterThan(0)
  expect(joined.agents.length).toBeLessThan(400)
})

// ─── F3 : une entrée invalide est ignorée, le reste se lit ───────────────────

test('F3 : la lecture valide chaque entrée ; une entrée abîmée est ignorée sans perdre le fichier', () => {
  const good = startCall(emptyRegistry('s1', '/p', 0), { key: 't1', name: 'Bonne entrée', isBackground: true }, 1_000)!
  const text = JSON.stringify({
    ...good,
    agents: [
      ...good.agents,
      { key: 't2', name: 'Statut inconnu', isBackground: true, status: 'perdu', startedAt: 2, source: 'live' },
      { key: 't3', name: 'Début en texte', isBackground: true, status: 'done', startedAt: 'hier', source: 'live' },
      null,
      {
        key: 't4',
        name: 'Segments mêlés',
        isBackground: true,
        status: 'done',
        startedAt: 5,
        source: 'live',
        type: 'pirate',
        tokens: { input: 'beaucoup', output: 1, cacheRead: 0, cacheWrite: 0 },
        segments: [{ k: 'tool', s: 6, e: 7, f: 'read', t: 'Read' }, { k: 'danse', s: 8 }, { k: 'tool', s: 9, f: 'magie' }, { k: 'write', s: 'x' }],
        marks: [{ k: 'fail', at: 9 }, { k: 'boum', at: 10 }],
      },
    ],
    main: { segments: [{ k: 'think', s: 1, e: 2 }, { k: 'think', s: null }] },
  })
  const reg = parseRegistry(text)!
  expect(reg.agents.map(a => a.key)).toEqual(['t1', 't4'])
  const t4 = reg.agents[1]!
  expect(t4.segments).toEqual([{ k: 'tool', s: 6, e: 7, f: 'read', t: 'Read' }, { k: 'tool', s: 9 }])
  expect(t4.marks).toEqual([{ k: 'fail', at: 9 }])
  expect(t4.type).toBeUndefined()
  expect(t4.tokens).toBeUndefined()
  expect(reg.main!.segments).toEqual([{ k: 'think', s: 1, e: 2 }])
  // Un en-tête abîmé, lui, rend le fichier illisible (S8).
  expect(parseRegistry(JSON.stringify({ ...good, session: 42 }))).toBeNull()
})

// ─── F2 : les secrets masqués dans les arguments courts et les prompts ───────

test('F2 : les arguments courts masquent jetons, en-têtes Authorization, --token, password= et mots de passe d’URL', () => {
  const bash = (command: string) => shortArg('Bash', { command })!
  // Les faux secrets se composent à l'exécution : écrits d'un bloc, gitleaks les prendrait pour des vrais.
  const fake = (...parts: string[]) => parts.join('')
  const cases: [string, string][] = [
    [`curl -H "Authorization: Bearer ${fake('abcdef', '0123456789')}" https://api.example.com/v1`, fake('abcdef', '0123456789')],
    [`gh auth login --with-token ${fake('ghp_', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012345')}`, fake('ghp_', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012345')],
    [`mysql --password=${fake('hun', 'ter2')} -u root`, fake('hun', 'ter2')],
    [`deploy --token ${fake('s3cr3t', '-value')} --env prod`, fake('s3cr3t', '-value')],
    [`GITHUB_TOKEN=${fake('tok_', '1234567890')} npm publish`, fake('tok_', '1234567890')],
    [`git clone https://x:${fake('p4ss', 'w0rd')}@localhost/x/y.git`, fake('p4ss', 'w0rd')],
    [`export ANTHROPIC_API_KEY=${fake('sk-ant-', 'api03-abcdefghijklmnopqrstuv')}`, fake('sk-ant-', 'api03-abcdefghijklmnopqrstuv')],
  ]
  for (const [command, secret] of cases) {
    const arg = bash(command)
    expect(arg.includes(secret)).toBe(false)
    expect(arg).toMatch(/‹masqué›/)
  }
  // Masqué avant d'être coupé : un jeton en fin de longue commande ne laisse pas son début.
  expect(bash(`${'echo une très longue commande '.repeat(3)}--token ${fake('AAAABBBB', 'CCCCDDDD')}`).includes('AAAA')).toBe(false)
  // Une adresse garde son hôte, pas son mot de passe.
  expect(shortArg('WebFetch', { url: 'https://x:motdepasse@localhost/page' })).toBe('x:‹masqué›@localhost/page')
  // Ce qui n'est pas un secret reste lisible.
  expect(bash('git commit -m "fix token parsing"')).toBe('git commit -m "fix token parsing"')
  expect(bash('npm test')).toBe('npm test')
})

test('F2 : un en-tête Authorization entre guillemets (JSON, fetch) est masqué aussi', () => {
  const token = ['Bearer ', 'abcdef', '0123456789'].join('')
  expect(maskSecrets(`{"Authorization": "${token}"}`).includes('0123456789')).toBe(false)
  expect(maskSecrets(`fetch(url, { headers: { Authorization: '${token}' } })`).includes('0123456789')).toBe(false)
})

test('F2 : le masque reste rapide sur un texte qui le pousse au pire (pas de retour arrière sans fin)', () => {
  const started = Date.now()
  for (const text of ['x-'.repeat(30_000), 'a'.repeat(60_000), `${'-'.repeat(30_000)}token`, `http://${'a'.repeat(30_000)}`]) maskSecrets(text)
  expect(Date.now() - started).toBeLessThan(2_000)
})

test('F3 : un nombre de morceaux abîmé est borné, et un morceau qui se dit d’un autre rang est ignoré', () => {
  const head = parseRegistry(JSON.stringify({ ...emptyRegistry('s1', '/p', 0), parts: 1e9 }))!
  expect(head.parts).toBeLessThanOrEqual(64)
  expect(parseRegistry(JSON.stringify({ v: 1, session: 's1', part: 1e9, agents: [] }))).toBeNull()
})

test('R1 : un très grand nombre d’unités se découpe sans erreur', () => {
  const reg: SessionRegistry = { ...emptyRegistry('s1', '/p', 0), main: { segments: Array.from({ length: 150_000 }, (_, i) => ({ k: 'think' as const, s: i, e: i + 1 })) } }
  const first = splitRegistry(reg, new Map())
  const { placed } = joinRegistry(first.head, first.parts)
  const again = splitRegistry(reg, placed)
  expect(joinRegistry(again.head, again.parts).reg.main!.segments).toHaveLength(150_000)
})

test('F2 (S16) : le prompt gardé d’un sous-agent masque les mêmes motifs, le reste intact', () => {
  const prompt = `Teste l’API avec la clé ${['sk-ant-', 'api03-abcdefghijklmnopqrstuv'].join('')} puis rends le rapport.`
  expect(maskSecrets(prompt)).toBe('Teste l’API avec la clé ‹masqué› puis rends le rapport.')
  const reg = startCall(emptyRegistry('s1', '/p', 0), { key: 't1', name: 'Test API', isBackground: true, prompt }, 1)!
  expect(reg.agents[0]!.prompt).toBe('Teste l’API avec la clé ‹masqué› puis rends le rapport.')
})

// ─── Par le mod entier : R2, R3, F1, chmod ──────────────────────────────────

const KEY = 'agents:s-dur'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 92, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const world = (on: any, opts: { storeGet?: (key: string, mem: Record<string, unknown>) => unknown; isFull?: boolean; isReadFailing?: () => boolean } = {}) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const runs: { argv: string[]; cwd?: string; env?: Record<string, string> }[] = []
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-dur' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: opts.storeGet ? opts.storeGet(e.key, mem) : mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    if (opts.isFull && e.key.startsWith('agents:')) throw new Error('trop gros')
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  // Un disque simulé : le registre y va quand le dossier de Claude se déduit du dossier du mod.
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    if (opts.isReadFailing?.()) throw new Error('EBUSY')
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (opts.isFull) throw new Error('disque plein')
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('process.run', (_$: unknown, e: { argv: string[]; init?: { cwd?: string; env?: Record<string, string> } }) => {
    runs.push({ argv: [...e.argv], cwd: e.init?.cwd, env: e.init?.env })
    // Le chmod réussit (F6 : raté, il se retenterait) ; ccusage échoue.
    return { value: { exitCode: e.argv[0] === 'chmod' ? 0 : 1, stdout: '', stderr: 'non' } }
  })
  return { mem, files, runs }
}

/** Le registre enregistré de la session, sur le disque simulé ou dans `$.store`. */
const saved = (mem: Record<string, unknown>, files: Record<string, string>): SessionRegistry | null => {
  const path = Object.keys(files).find(p => p.endsWith('/flow-board/agents/s-dur.json'))
  const value = path !== undefined ? files[path] : mem[KEY]
  return value === undefined ? null : parseRegistry(value)
}

test('R2 : des lancements simultanés passent tous par la file d’écriture, aucun ne se perd', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 40_000_000 })
  const { mem, files } = world(on)
  let n = 0
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: `a${++n}` } }))
  await Promise.all(Array.from({ length: 24 }, (_, i) => $.tool.call({ tool: 'Agent', description: `Agent ${i}`, prompt: 'p', run_in_background: true, tool_use_id: `c${i}` } as any)))
  await clock.advance(6_000)
  expect(saved(mem, files)!.agents).toHaveLength(24)
  expect(saved(mem, files)!.agents.every(a => a.agentId !== undefined)).toBe(true)
})

test('R3 : sans fichier, le registre se crée même si l’ancien stockage répond par une erreur', async ($, on) => {
  const clock = mock.clock(on, { now: 41_000_000 })
  const { mem, files } = world(on, {
    storeGet: (key, m) => {
      if (key.startsWith('agents:')) throw new Error('stockage indisponible')
      return m[key]
    },
  })
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await $.tool.call({ tool: 'Agent', description: 'Premier', prompt: 'p', run_in_background: true } as any)
  await clock.advance(1_000)
  expect(saved(mem, files)?.agents.map(a => a.name)).toEqual(['Premier'])
})

test('F1 : ccusage se lance avec une version exacte, depuis le dossier du mod, le registre npm officiel imposé, au plus une fois par jour même en échec', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 42_000_000 })
  const { runs } = world(on)
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  await $.session.start({ cwd: '/projet', surface: null, isInteractive: true } as any)
  await clock.advance(2_000)
  const npx = runs.filter(r => r.argv.some(a => a.startsWith('ccusage@')))
  expect(npx.length).toBeGreaterThan(0)
  for (const r of npx) {
    expect(r.argv.find(a => a.startsWith('ccusage@'))).toMatch(/^ccusage@\d+\.\d+\.\d+$/)
    expect(r.cwd !== undefined && r.cwd !== '/projet' && r.cwd !== '').toBe(true)
    expect(r.env?.npm_config_registry).toBe('https://registry.npmjs.org/')
  }
  // Un nouveau démarrage le même jour, après un échec : pas de nouvel essai.
  const before = runs.filter(r => r.argv.some(a => a.startsWith('ccusage@'))).length
  await $.session.start({ cwd: '/projet', surface: null, isInteractive: true } as any)
  await clock.advance(2_000)
  expect(runs.filter(r => r.argv.some(a => a.startsWith('ccusage@'))).length).toBe(before)
})

test('F2 : le dossier du registre est fermé aux autres comptes (chmod 700) quand il est sur le disque', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 43_000_000 })
  const { files, runs } = world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await $.tool.call({ tool: 'Agent', description: 'Premier', prompt: 'p', run_in_background: true } as any)
  await clock.advance(1_000)
  await $.tool.call({ tool: 'Agent', description: 'Second', prompt: 'p', run_in_background: true } as any)
  await clock.advance(1_000)
  const path = Object.keys(files).find(p => p.endsWith('/flow-board/agents/s-dur.json'))
  // Le dossier du mod ne dit pas toujours où est ~/.claude (clone hors de ~/.claude) : rien à fermer alors.
  if (path === undefined) return
  const chmods = runs.filter(r => r.argv[0] === 'chmod')
  expect(chmods).toHaveLength(1)
  expect(chmods[0]!.argv).toEqual(['chmod', '700', path.replace(/\/s-dur\.json$/, '')])
})

test('R2 : une écriture du registre refusée se dit dans l’onglet', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 44_000_000 })
  world(on, { isFull: true })
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await $.tool.call({ tool: 'Agent', description: 'Refusé', prompt: 'p', run_in_background: true } as any)
  await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /n’est plus enregistré/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('P1 : la revue de sécurité et la lecture de transcripts ont des couleurs loin de leurs voisines et du rouge des échecs', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 45_000_000 })
  world(on)
  let n = 0
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: `a${++n}` } }))
  await $.tool.call({ tool: 'Agent', description: 'Revue de sécurité du groupe', prompt: 'p', run_in_background: true } as any)
  await $.tool.call({ tool: 'Agent', description: 'Lecture des transcripts de la rétro', prompt: 'p', run_in_background: true } as any)
  await clock.advance(60_000)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  const svgs = await ui.findAll({ type: 'Svg' })
  const sourceOf = (name: string) => String(svgs.find(svg => String(svg.props.alt).startsWith(name))?.props.source ?? '')
  // Rose pour la sécurité (plus le corail, proche de la mandarine et du rouge) ; vert anis pour les
  // transcripts (plus le ciel, proche du cyan, ni le bleu des hachures « fond » : B1 des suites du groupe B).
  expect(sourceOf('Revue de sécurité du groupe')).toMatch(/#E06C9F/i)
  expect(sourceOf('Revue de sécurité du groupe')).not.toMatch(/#EF7D57/i)
  expect(sourceOf('Lecture des transcripts de la rétro')).toMatch(/#9BC53D/i)
  expect(sourceOf('Lecture des transcripts de la rétro')).not.toMatch(/#56B4E9/i)
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('R3 (S10) : un fichier présent qu’on ne peut pas relire reporte l’écriture, sans l’écraser', { timeoutMs: 15000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 46_000_000 })
  let isBusy = false
  const { mem, files } = world(on, { isReadFailing: () => isBusy })
  let n = 0
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: `a${++n}` } }))
  await $.tool.call({ tool: 'Agent', description: 'Premier', prompt: 'p', run_in_background: true } as any)
  await clock.advance(1_000)
  // Sans disque (clone hors de ~/.claude), le registre va dans `$.store` : rien à relire en erreur.
  if (!Object.keys(files).some(p => p.endsWith('/flow-board/agents/s-dur.json'))) return
  isBusy = true
  await $.tool.call({ tool: 'Agent', description: 'Pendant', prompt: 'p', run_in_background: true } as any)
  await clock.advance(6_000)
  expect(saved(mem, files)!.agents.map(a => a.name)).toEqual(['Premier'])
  isBusy = false
  await $.tool.call({ tool: 'Agent', description: 'Après', prompt: 'p', run_in_background: true } as any)
  await clock.advance(1_000)
  expect(saved(mem, files)!.agents.map(a => a.name)).toEqual(['Premier', 'Pendant', 'Après'])
})

test('R1 : un morceau au-delà du nombre que dit l’en-tête (écriture coupée avant l’en-tête) se lit quand même', async ($, on) => {
  const clock = mock.clock(on, { now: 47_000_000 })
  const { mem, files } = world(on)
  let n = 0
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: `a${++n}` } }))
  await $.tool.call({ tool: 'Agent', description: 'Premier', prompt: 'p', run_in_background: true } as any)
  await clock.advance(1_000)
  // Le morceau 1, né d'une écriture qui s'est coupée avant l'en-tête : l'en-tête ne le compte pas.
  const part = { v: 1, session: 's-dur', part: 1, agents: [{ key: 'monte', agentId: 'm1', name: 'Monté', isBackground: true, status: 'done', startedAt: 46_999_000, finishedAt: 46_999_500, source: 'live' }] }
  const head = Object.keys(files).find(p => p.endsWith('/flow-board/agents/s-dur.json'))
  if (head !== undefined) files[head.replace(/\.json$/, '.1.json')] = JSON.stringify(part)
  else mem[`${KEY}:1`] = part
  await $.tool.call({ tool: 'Agent', description: 'Second', prompt: 'p', run_in_background: true } as any)
  await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Button', text: /Monté$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3\sagents/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('R2 : un changement que l’état refuse sans fin se dit dans l’onglet au lieu de se perdre en silence', async ($, on) => {
  const clock = mock.clock(on, { now: 48_000_000 })
  world(on)
  let isRefused = false
  on('state.set', (_$, e: any, next) => (isRefused && e.key === 'agents' && e.ifVersion !== undefined ? { value: { isSet: false, version: e.ifVersion + 1 } } : next(e)))
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await $.tool.call({ tool: 'Agent', description: 'Avant', prompt: 'p', run_in_background: true } as any)
  isRefused = true
  await $.tool.call({ tool: 'Agent', description: 'Refusé', prompt: 'p', run_in_background: true } as any)
  isRefused = false
  await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: /n’a pas pu s’appliquer/ })).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})
