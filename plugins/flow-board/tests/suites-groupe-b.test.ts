import { expect, mock, test } from 'claude-code/testing'

import { runsCarriedBy, withCarriedRuns } from '../hooks/history.ts'
import { isSameProject } from '../hooks/linked.ts'
import { newRun } from '../hooks/model.ts'
import { applyTraces, removeArgv } from '../hooks/erase.ts'
import { emptyRegistry, failedAgentsOf, mergeRegistry, noteCarried, parseOwnRegistry, parseRegistry, PROMPT_MAX, startCall } from '../hooks/registry.ts'
import { maskSecrets } from '../hooks/timeline.ts'
import { drainWithin, isTranscriptPath, readArgv, SUBAGENT_FILE, type TranscriptAgent } from '../hooks/transcript.ts'
import type { Run, SessionRegistry } from '../types'

// Les suites de la revue du groupe B, de sa revue de sécurité et de ses passes
// « bogues » (DECISIONS.md, série 16 ; S27 pour Q-a), et le test instable.

// Les faux secrets se composent à l'exécution : écrits d'un bloc, gitleaks les prendrait pour des vrais.
const fake = (...parts: string[]) => parts.join('')
/** L'option `-u` de curl, composée elle aussi : `curl -u nom:mot` écrit d'un bloc passe pour un vrai identifiant. */
const U = fake('-', 'u')

// ─── F5 : les trous du masquage, un test par motif ──────────────────────────

const MOTIFS: [string, string, string][] = [
  ['une valeur entre guillemets avec espaces, en entier (option)', `deploy --password "${fake('ma phrase', ' de passe')}" --env prod`, fake('ma phrase', ' de passe')],
  ['une valeur entre guillemets avec espaces, en entier (affectation)', `export DB_PASSWORD='${fake('trois mots', ' ici')}'`, fake('trois mots', ' ici')],
  ['la forme « nom: valeur » (token:)', `token: ${fake('abc', 'def123456')}`, fake('abc', 'def123456')],
  ['la forme « nom: valeur » (client_secret:)', `client_secret: ${fake('Zz9', '-qwerty-77')}`, fake('Zz9', '-qwerty-77')],
  ['l’option -u de curl, nom et mot de passe', `curl ${U} admin:${fake('hun', 'ter22')} https://exemple.test/api`, fake('hun', 'ter22')],
  ['mysql -pmot de passe', `mysql -u root -p${fake('s3', 'cret99')} base`, fake('s3', 'cret99')],
  ['un en-tête Cookie', `curl -H "Cookie: session=${fake('abc', '123')}; csrf=${fake('x', 'yz')}" https://exemple.test`, fake('abc', '123')],
  ['une clé Stripe sk_live_', `STRIPE=${''} ${fake('sk_live_', 'AbCdEfGhIjKlMnOpQrSt1234')}`, fake('sk_live_', 'AbCdEfGhIjKlMnOpQrSt1234')],
  ['un jeton Hugging Face hf_', `huggingface-cli login ${fake('hf_', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345')}`, fake('hf_', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345')],
  ['un bloc PEM', `${fake('-----BEGIN ', 'PRIVATE KEY-----')}\nMIIEv${fake('QIBADANBgkq', 'hkiG9w0BAQ')}\n${fake('-----END ', 'PRIVATE KEY-----')} fin`, fake('QIBADANBgkq', 'hkiG9w0BAQ')],
  ['« Bearer x » seul', `Utilise Bearer ${fake('eyAb', 'cd1234efgh')} pour appeler`, fake('eyAb', 'cd1234efgh')],
  ['un Cookie entre guillemets (JSON)', `{"Cookie": "session=${fake('abc', '123xyz')}"}`, fake('abc', '123xyz')],
  ['un Cookie entre guillemets (objet JS)', `headers: { Cookie: 'sid=${fake('abc', '123xyz')}' }`, fake('abc', '123xyz')],
  ['curl -u entre guillemets, avec espaces', `curl ${U} "admin:${fake('mon mot', ' de passe')}" https://exemple.test`, fake('mon mot', ' de passe')],
  ['Authorization entre guillemets, avec espaces', `Authorization: Bearer "${fake('abc', ' def 123')}"`, fake('abc', ' def 123')],
]

for (const [motif, text, secret] of MOTIFS) {
  test(`F5 : le masque couvre ${motif}`, () => {
    const masked = maskSecrets(text)
    expect(masked.includes(secret)).toBe(false)
    expect(masked).toMatch(/‹masqué›/)
  })
}

test('F5 : une valeur masquée garde ses guillemets, et le texte autour reste lisible', () => {
  expect(maskSecrets(`deploy --password "${fake('a b', ' c')}" --env prod`)).toBe('deploy --password "‹masqué›" --env prod')
  expect(maskSecrets(`curl ${U} admin:${fake('x', 'y')} https://exemple.test`)).toBe(`curl ${U} admin:‹masqué› https://exemple.test`)
  expect(maskSecrets(`curl ${U} 'admin:${fake('a b', ' c')}' x`)).toBe(`curl ${U} 'admin:‹masqué›' x`)
  expect(maskSecrets(`{"Cookie": "sid=${fake('a', 'b')}"}`)).toBe('{"Cookie": "‹masqué›"}')
  expect(maskSecrets(`${fake('-----BEGIN ', 'CERTIFICATE-----')}\nAAAA\n${fake('-----END ', 'CERTIFICATE-----')} puis la suite`)).toBe('‹masqué› puis la suite')
  // Ce qui n'est pas un secret reste lisible.
  expect(maskSecrets('git commit -m "fix token parsing"')).toBe('git commit -m "fix token parsing"')
  expect(maskSecrets('mysql -u root -p base')).toBe('mysql -u root -p base')
  expect(maskSecrets('curl -u admin https://exemple.test')).toBe('curl -u admin https://exemple.test')
  expect(maskSecrets('Le Bearer authentication est décrit plus bas.')).toBe('Le Bearer authentication est décrit plus bas.')
})

// ─── F1 (revue de sécurité du groupe C) : des guillemets qui ne se ferment pas à temps ─

/** Un jeton de session de 617 signes, sans espace (la forme d'un jeton AWS STS), composé à l'exécution. */
const LONG = fake('IQoJb3JpZ2luX2Vj', 'A'.repeat(601))

const F1_CASES: [string, string, string][] = [
  ['une affectation exportée, jeton de plus de 400 signes', `export AWS_SESSION_TOKEN="${LONG}"`, LONG.slice(0, 40)],
  ['une option, jeton de plus de 400 signes', `aws s3 ls --session-token "${LONG}"`, LONG.slice(0, 40)],
  ['une affectation en tête de commande, jeton de plus de 400 signes', `AWS_SESSION_TOKEN="${LONG}" aws s3 ls`, LONG.slice(0, 40)],
  ['« nom: valeur », jeton de plus de 400 signes', `aws_session_token: "${LONG}"`, LONG.slice(0, 40)],
  ['un guillemet qui ne se ferme pas (option)', `deploy --token "${fake('abc', 'def123')}`, fake('abc', 'def123')],
  ['une valeur sur plusieurs lignes', `deploy --password "${fake('s3cr', '3t99')}\nsuite"`, fake('s3cr', '3t99')],
  ['un guillemet qui ne se ferme pas (affectation)', `PASSWORD="${fake('hunt', 'er22')} x`, fake('hunt', 'er22')],
]

for (const [motif, text, secret] of F1_CASES) {
  test(`F1 : le masque couvre ${motif}`, () => {
    const masked = maskSecrets(text)
    expect(masked.includes(secret)).toBe(false)
    expect(masked).toMatch(/‹masqué›/)
  })
}

test('F1 : un guillemet fermant n’apparaît que s’il était là ; une valeur fermée reste masquée en entier', () => {
  expect(maskSecrets(`deploy --token "${fake('abc', 'def123')}`)).toBe('deploy --token "‹masqué›')
  expect(maskSecrets(`export AWS_SESSION_TOKEN="${LONG}"`)).toBe('export AWS_SESSION_TOKEN="‹masqué›"')
  expect(maskSecrets(`deploy --password "${fake('a b', ' c')}" --env prod`)).toBe('deploy --password "‹masqué›" --env prod')
  expect(maskSecrets(`PASSWORD=${fake('abc', '123')};x`)).toBe('PASSWORD=‹masqué›;x')
})

test('F1 : le prompt gardé d’un sous-agent masque un jeton long entre guillemets', () => {
  const prompt = `Configure le compte : export AWS_SESSION_TOKEN="${LONG}" puis lance les tests.`
  const kept = startCall(emptyRegistry('s1', '/p', 0), { key: 't1', name: 'Config', isBackground: true, prompt }, 1)!.agents[0]!.prompt!
  expect(kept.includes(LONG.slice(0, 40))).toBe(false)
  expect(kept).toContain('puis lance les tests.')
})

test('F5 : un bloc PEM coupé par la tranche gardée d’un prompt ne laisse rien de la clé', () => {
  const key = Array.from({ length: 60 }, (_, i) => fake('MIIEvQIBADAN', String(i).padStart(4, '0'), 'BgkqhkiG9w0B')).join('\n')
  const prompt = `${'Relis ce fichier. '.repeat(Math.ceil((PROMPT_MAX - 300) / 18))}${fake('-----BEGIN ', 'RSA PRIVATE KEY-----')}\n${key}\n${fake('-----END ', 'RSA PRIVATE KEY-----')}`
  const kept = startCall(emptyRegistry('s1', '/p', 0), { key: 't1', name: 'Revue', isBackground: true, prompt }, 1)!.agents[0]!.prompt!
  expect(kept.length).toBeLessThanOrEqual(PROMPT_MAX)
  expect(kept.includes('MIIEvQIBADAN')).toBe(false)
  expect(kept.startsWith('Relis ce fichier.')).toBe(true)
})

// ─── F4 : la lecture des transcripts ────────────────────────────────────────

test('F4 : un transcript ne se lit que sous <dossier Claude>/projects/, sans « .. » ; sans dossier connu, aucun', () => {
  expect(isTranscriptPath('/h/.claude/projects/-p/abc.jsonl', '/h/.claude')).toBe(true)
  expect(isTranscriptPath('/h/.claude/projects/-p/abc/subagents/agent-a1.jsonl', '/h/.claude/')).toBe(true)
  expect(isTranscriptPath('/etc/passwd', '/h/.claude')).toBe(false)
  expect(isTranscriptPath('/h/.claude/settings.jsonl', '/h/.claude')).toBe(false)
  expect(isTranscriptPath('/h/.claude/projects/../secrets.jsonl', '/h/.claude')).toBe(false)
  expect(isTranscriptPath('/h/.claude/projects-autres/x.jsonl', '/h/.claude')).toBe(false)
  expect(isTranscriptPath('/h/.claude/projects/-p/abc.json', '/h/.claude')).toBe(false)
  expect(isTranscriptPath('/h/.claude/projects/-p/abc.jsonl', null)).toBe(false)
  // Des barres doublées (un CLAUDE_CONFIG_DIR à barre finale) comptent pour une.
  expect(isTranscriptPath('/c/.claude//projects/p/s.jsonl', '/c/.claude/')).toBe(true)
  expect(isTranscriptPath('/c/.claude//projects//../x.jsonl', '/c/.claude')).toBe(false)
  // Sous Windows : sans la casse ni le sens des barres.
  expect(isTranscriptPath('c:\\Users\\M\\.claude\\projects\\-p\\abc.jsonl', 'C:/Users/m/.claude')).toBe(true)
  expect(isTranscriptPath('C:\\Users\\M\\.claude\\projects\\..\\x.jsonl', 'C:\\Users\\M\\.claude')).toBe(false)
})

test('F4 et F6 : la commande de lecture est « cat -- » ; sous Windows, un chemin aux caractères spéciaux de cmd.exe n’en a pas', () => {
  expect(readArgv('/h/.claude/projects/-p/-x.jsonl')).toEqual(['cat', '--', '/h/.claude/projects/-p/-x.jsonl'])
  expect(readArgv('C:/Users/M/.claude/projects/-p/a.jsonl')).toEqual(['cmd.exe', '/d', '/c', 'type', 'C:\\Users\\M\\.claude\\projects\\-p\\a.jsonl'])
  // S30 : les séparateurs d'arguments de cmd.exe aussi, la même garde que `del`.
  for (const c of ['&', '|', '^', '%', '<', '>', '"', ';', ',', '=']) {
    expect(readArgv(`C:\\Users\\M\\.claude\\projects\\-p\\a${c}b.jsonl`)).toBeNull()
    expect(removeArgv(`C:\\Users\\M\\.claude\\flow-board\\agents\\a${c}b.json`)).toBeNull()
  }
})

test('F4 : un fichier de sous-agent a un nom strict, agent-<lettres, chiffres, _ et ->.jsonl', () => {
  expect(SUBAGENT_FILE.exec('agent-a1B_2-c.jsonl')?.[1]).toBe('a1B_2-c')
  for (const name of ['agent-a&b.jsonl', 'agent-.jsonl', 'agent-a b.jsonl', 'agent-a%x.jsonl', 'xagent-a1.jsonl', 'agent-a1.jsonl.bak']) expect(SUBAGENT_FILE.test(name)).toBe(false)
})

test('F6 : la lecture en flux d’un transcript s’arrête à son délai, sans rien rendre ; finie avant, elle rend tout', async () => {
  let isReturned = false
  const stuck: AsyncIterable<{ stream?: string; text?: unknown }> = {
    [Symbol.asyncIterator]: () => {
      let n = 0
      return {
        next: () => (n++ === 0 ? Promise.resolve({ done: false, value: { stream: 'stdout', text: 'début' } }) : new Promise<IteratorResult<{ stream?: string; text?: unknown }>>(() => undefined)),
        return: () => {
          isReturned = true
          return Promise.resolve({ done: true, value: undefined })
        },
      }
    },
  }
  let fire: () => void = () => undefined
  const deadline = new Promise<void>(resolve => (fire = resolve))
  const reading = drainWithin(stuck, deadline)
  fire()
  expect(await reading).toBeNull()
  expect(isReturned).toBe(true)
  async function* done() {
    yield { stream: 'stdout', text: 'a' }
    yield { stream: 'stderr', text: 'bruit' }
    yield { stream: 'stdout', text: 'b' }
  }
  expect(await drainWithin(done(), new Promise<void>(() => undefined))).toBe('ab')
})

// ─── F6 : en-têtes, projet, chmod, ids ──────────────────────────────────────

test('F6 : un en-tête dont la session ne correspond pas à son nom de fichier est refusé', () => {
  const head = JSON.stringify(emptyRegistry('s-vraie', '/p', 0))
  expect(parseOwnRegistry(head, 's-vraie')?.session).toBe('s-vraie')
  expect(parseOwnRegistry(head, 's-autre')).toBeNull()
  // Le nom de fichier est l'id passé en minuscules, chaque autre signe en tiret.
  expect(parseOwnRegistry(JSON.stringify(emptyRegistry('S.Une', '/p', 0)), 's-une')?.session).toBe('S.Une')
})

test('F6 : « même projet » = le projet et ses worktrees (.claude/worktrees/<nom>), pas tout sous-dossier', () => {
  expect(isSameProject('/p/proj', '/p/proj')).toBe(true)
  expect(isSameProject('/p/proj', '/p/proj/.claude/worktrees/groupe-a')).toBe(true)
  expect(isSameProject('C:\\p\\Proj', 'c:/p/proj/.claude/worktrees/x/')).toBe(true)
  expect(isSameProject('/p/proj', '/p/proj/sous-dossier')).toBe(false)
  // Un nom de worktree peut avoir des « / » (EnterWorktree).
  expect(isSameProject('/p/proj', '/p/proj/.claude/worktrees/feature/x')).toBe(true)
  expect(isSameProject('/p/proj', '/p/proj/.claude/worktrees')).toBe(false)
  expect(isSameProject('/p/proj', '/p/proj/.claude/autre')).toBe(false)
  expect(isSameProject('/p/proj', '/p/proj-voisin')).toBe(false)
  expect(isSameProject('', '/p/proj')).toBe(false)
})

// ─── Q-a, Q-c : parcours d'une entrée rattrapée, échecs du compte rendu ─────

const T0 = 70_000_000
const lane = (startedAt: number) => ({ segments: [], toolCount: 0, startedAt, endedAt: startedAt + 1_000 })
const seen = (agentId: string, startedAt: number, toolUseId?: string): TranscriptAgent => ({ agentId, lane: lane(startedAt), meta: { description: agentId, ...(toolUseId ? { toolUseId } : {}) } })

test('Q-a (S27) : un sous-agent rattrapé rejoint le parcours que la discussion portait à son départ ; les entrées connues ne changent pas', () => {
  const mine = { ...newRun('implement', T0, 'Le mien'), owner: 's-qa', updatedAt: T0 + 600_000 } as Run
  const ticketed = { ...newRun('implement', T0 + 3_600_000, 'Par un ticket'), status: 'done', updatedAt: T0 + 4_000_000, finishedAt: T0 + 4_000_000, tickets: [{ id: '1', name: 'Un', status: 'done', by: 's-qa' }] } as unknown as Run
  const other = { ...newRun('implement', T0 + 7_200_000, 'D’une autre discussion'), owner: 's-autre', updatedAt: T0 + 7_800_000 } as Run
  let reg = startCall(emptyRegistry('s-qa', '/p', T0), { key: 'vu', name: 'Vu en direct', isBackground: true }, T0 + 10_000)!
  reg = { ...reg, agents: reg.agents.map(a => ({ ...a, agentId: 'a-vu' })) }
  const carried = runsCarriedBy([mine, ticketed, other], reg)
  expect(carried.map(r => r.title)).toEqual(['Le mien', 'Par un ticket'])
  const out = withCarriedRuns([seen('a-vu', T0 + 10_000), seen('a-1', T0 + 20_000), seen('a-2', T0 + 3_700_000), seen('a-3', T0 + 7_300_000), seen('a-4', T0 - 3_600_000)], reg, carried)
  expect(out.map(a => [a.agentId, a.run])).toEqual([
    // Déjà au registre : il garde ce qu'il a (ici, aucun parcours).
    ['a-vu', undefined],
    ['a-1', mine.id],
    ['a-2', ticketed.id],
    // Pendant le parcours d'une autre discussion, ou hors de toute période : aucun.
    ['a-3', undefined],
    ['a-4', undefined],
  ])
})

test('S28 : l’en-tête garde les ids des parcours portés ; le rattrapage s’en sert, la fusion les unit, la suppression d’un parcours retire le sien', () => {
  const done = { ...newRun('implement', T0, 'Fini'), status: 'done', updatedAt: T0 + 600_000, finishedAt: T0 + 600_000 } as Run
  const reg = noteCarried(emptyRegistry('s-qa', '/p', T0), [done.id])!
  expect(reg.carried).toEqual([done.id])
  // Déjà noté : rien ne change.
  expect(noteCarried(reg, [done.id])).toBeNull()
  // Fini, sans propriétaire ni ticket « en cours » : il compte encore, d'après l'en-tête.
  expect(runsCarriedBy([done], reg).map(r => r.id)).toEqual([done.id])
  expect(withCarriedRuns([seen('a-1', T0 + 20_000)], reg, runsCarriedBy([done], reg))[0]!.run).toBe(done.id)
  // Deux processus de la même session : l'union.
  expect(mergeRegistry(reg, { ...reg, carried: ['autre'] }).carried).toEqual([done.id, 'autre'])
  // Le parcours supprimé quitte la liste.
  expect(applyTraces(reg, [{ id: `run:${done.id}`, at: T0 + 700_000 }])?.carried ?? []).toEqual([])
  expect(parseRegistry(JSON.stringify({ ...reg, carried: [done.id, 42] }))?.carried).toEqual([done.id])
})

test('Q-c : le compte rendu compte les sous-agents en échec du parcours dans tous les registres, chacun une fois', () => {
  const failed = (session: string, keys: string[], run: string): SessionRegistry => ({
    ...emptyRegistry(session, '/p', 0),
    agents: keys.map(key => ({ key, name: key, isBackground: true, status: 'failed' as const, startedAt: 1, source: 'live' as const, run })),
  })
  const self = failed('s-orch', ['o1'], 'r1')
  const linked = failed('s-lie', ['l1', 'l2'], 'r1')
  const otherRun = failed('s-x', ['x1'], 'r2')
  expect(failedAgentsOf('r1', [self, linked, linked, otherRun, null])).toBe(3)
})

// ─── Par le mod entier ──────────────────────────────────────────────────────

const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

/**
 * Le moteur sous le plugin, la session `s-sgb`, un stockage en mémoire et un disque simulé qui tient
 * les transcripts ; le dossier du registre n'y va qu'avec `isRegistryOnDisk` (sinon `$.store`).
 */
const world = (on: any, seed: Record<string, unknown> = {}, opts: { files?: Record<string, string>; chmodExit?: () => number; isRegistryOnDisk?: boolean; tracesAccepted?: number; traceFailing?: number } = {}) => {
  const isRefused = (path: string) => !opts.isRegistryOnDisk && path.includes('/flow-board/')
  const mem: Record<string, unknown> = { ...seed }
  const files: Record<string, string> = { ...opts.files }
  const reads: string[] = []
  const runs: string[][] = []
  const toasts: string[] = []
  // `tracesAccepted` : le stockage accepte tant de traces, puis refuse (disque plein).
  let traces = 0
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 's-sgb' }))
  on('session.root', () => ({ value: '/p' }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    // `traceFailing` : seule cette écriture de trace (la n-ième) est refusée, les suivantes passent.
    if (e.key.endsWith(':erased')) traces += 1
    if (opts.tracesAccepted !== undefined && e.key.endsWith(':erased') && traces > opts.tracesAccepted) throw new Error('plein')
    if (opts.traceFailing !== undefined && e.key.endsWith(':erased') && traces === opts.traceFailing) throw new Error('refusée')
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_$: unknown, e: { key: string }) => {
    delete mem[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: !isRefused(e.path) && e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    reads.push(e.path)
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    if (isRefused(e.path)) throw new Error('EACCES')
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('fs.list', (_$: unknown, e: { path?: string }) => {
    const dir = `${String(e.path ?? '').replace(/\/$/, '')}/`
    const names = Object.keys(files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    if (names.length === 0) throw new Error(`ENOENT ${e.path}`)
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file', size: files[p]!.length, mtimeMs: 1, isLink: false })) } as any
  })
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    runs.push([...e.argv])
    return { value: { exitCode: e.argv[0] === 'chmod' && opts.chmodExit ? opts.chmodExit() : 1, stdout: '', stderr: '' } }
  })
  on('ui.toast', (_$: unknown, e: unknown) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('classic.UserPromptSubmit', () => ({}))
  return { mem, files, reads, runs, toasts, refused: () => traces }
}

const prompt = ($: any, transcript: string) =>
  $.classic.UserPromptSubmit({ session_id: 's-sgb', transcript_path: transcript, cwd: '/p', hook_event_name: 'UserPromptSubmit', prompt: 'x' })

test('le test instable : les écritures du registre sous l’horloge simulée ne coûtent pas une seconde de temps réel chacune', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  world(on)
  let n = 0
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: `a${++n}` } }))
  const started = Date.now()
  for (let i = 0; i < 4; i++) {
    await $.tool.call({ tool: 'Agent', description: `Agent ${i}`, prompt: 'p', run_in_background: true, tool_use_id: `c${i}` } as any)
    // Au-delà des 600 ms d'attente : une écriture à chaque tour.
    await clock.advance(1_000)
  }
  expect(Date.now() - started).toBeLessThan(2_000)
})

test('F4 par le mod : un transcript hors de <dossier Claude>/projects/ n’est jamais lu', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/h/.claude' })
  const { reads } = world(on, {}, { files: { '/ailleurs/s-sgb.jsonl': '', '/ailleurs/s-sgb/subagents/agent-a1.jsonl': '' } })
  await prompt($, '/ailleurs/s-sgb.jsonl')
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await clock.advance(1_000)
  expect(reads.filter(p => p.startsWith('/ailleurs/'))).toEqual([])
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('F6 par le mod : le chmod du dossier du registre n’est noté fait qu’une fois réussi ; raté, il se retente', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const exits = [1, 0]
  const { files, runs } = world(on, {}, { chmodExit: () => exits.shift() ?? 0, isRegistryOnDisk: true })
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  for (const name of ['Premier', 'Second', 'Troisième']) {
    await $.tool.call({ tool: 'Agent', description: name, prompt: 'p', run_in_background: true } as any)
    await clock.advance(1_000)
  }
  // Le dossier du mod ne dit pas toujours où est ~/.claude (clone hors de ~/.claude) : rien à fermer alors.
  if (!Object.keys(files).some(p => p.endsWith('/flow-board/agents/s-sgb.json'))) return
  // Raté au premier, réussi au deuxième, plus rien ensuite.
  expect(runs.filter(r => r[0] === 'chmod')).toHaveLength(2)
})

test('F6 par le mod : l’id d’une session effacée est pris tel quel ; ses signes ne visent pas les morceaux d’une autre', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const old = T0 - 2 * 3_600_000
  const theirs = { ...startCall(emptyRegistry('s.1', '/p', old), { key: 'k1', name: 'À oublier', isBackground: true }, old)!, updatedAt: old }
  const { mem } = world(on, {
    'agents:s.1': { ...theirs, agents: theirs.agents.map(a => ({ ...a, agentId: 'id-k1', status: 'done' })) },
    'agents:sx1': { ...emptyRegistry('sx1', '/p', old), updatedAt: old },
    'agents:sx1:1': { v: 1, session: 'sx1', part: 1, agents: [] },
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-history' })
  await ui.press({ key: 'agents-history-session:s.1' })
  await clock.advance(200)
  await ui.press({ key: 'agents-forget' })
  await ui.press({ key: 'agents-forget-yes' })
  for (let i = 0; i < 2; i++) await clock.advance(1_000)
  expect(mem['agents:s.1']).toBeUndefined()
  expect(mem['agents:sx1:1']).toBeDefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('Q-b par le mod : « ✗ Oublier » pose aussi une trace par sous-agent ; réveillé ensuite, il ne revient pas dans l’historique', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const old = T0 - 2 * 3_600_000
  const theirs = { ...startCall(emptyRegistry('s-oubli', '/p', old), { key: 'k-fond', name: 'Agent de fond', isBackground: true }, old)!, updatedAt: old }
  const { mem } = world(on, { 'agents:s-oubli': { ...theirs, agents: theirs.agents.map(a => ({ ...a, agentId: 'id-fond', status: 'done' })) } })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-history' })
  await ui.press({ key: 'agents-history-session:s-oubli' })
  await clock.advance(200)
  await ui.press({ key: 'agents-forget' })
  await ui.press({ key: 'agents-forget-yes' })
  for (let i = 0; i < 2; i++) await clock.advance(1_000)
  const traces = Object.entries(mem).filter(([k]) => k.endsWith(':erased')).map(([, v]) => (v as { id: string }).id).sort()
  expect(traces).toEqual(['agent:id-fond', 'call:k-fond', 's-oubli'])
  // La discussion oubliée était ouverte en vrai : son sous-agent de fond se réveille après l'oubli
  // (une entrée plus récente que la trace de la session, qui ne la couvre donc pas) et elle le réécrit.
  for (let i = 0; i < 20; i++) await clock.advance(1_000)
  const awake = T0 + 25_000
  const woken = { ...emptyRegistry('s-oubli', '/p', awake), agents: [{ key: 'agent:id-fond', agentId: 'id-fond', name: 'Agent de fond', isBackground: true, status: 'running', startedAt: awake, source: 'live' }], updatedAt: awake }
  mem['agents:s-oubli'] = woken
  for (let i = 0; i < 6; i++) await clock.advance(1_000)
  await ui.press({ key: 'agents-history' })
  expect(await ui.find({ key: 'agents-history-session:s-oubli' })).toBeUndefined()
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('S29 par le mod : si une trace d’« ✗ Oublier » ne s’écrit pas, celles déjà posées sont retirées et l’effacement est annulé', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const old = T0 - 2 * 3_600_000
  let theirs = startCall(emptyRegistry('s-plein', '/p', old), { key: 'k1', name: 'Un', isBackground: true }, old)!
  theirs = startCall(theirs, { key: 'k2', name: 'Deux', isBackground: true }, old)!
  // Le stockage accepte deux traces, puis refuse (disque plein).
  const { mem, toasts, refused } = world(on, { 'agents:s-plein': { ...theirs, agents: theirs.agents.map(a => ({ ...a, agentId: `id-${a.key}`, status: 'done' })), updatedAt: old } }, { tracesAccepted: 2 })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-history' })
  await ui.press({ key: 'agents-history-session:s-plein' })
  await clock.advance(200)
  await ui.press({ key: 'agents-forget' })
  await ui.press({ key: 'agents-forget-yes' })
  for (let i = 0; i < 2; i++) await clock.advance(1_000)
  expect(refused()).toBeGreaterThan(2)
  expect(Object.keys(mem).filter(k => k.endsWith(':erased'))).toEqual([])
  expect(parseRegistry(mem['agents:s-plein'])?.agents).toHaveLength(2)
  // S33 : une session ouverte a pu se compacter d'après les traces avant leur retrait ; le message le dit.
  expect(toasts.some(t => t.includes('Effacement annulé') && t.includes('une session ouverte a pu en effacer une partie entre-temps'))).toBe(true)
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('S29 et D2 (b) par le mod : le retrait ne touche jamais une trace plus ancienne de la même discussion, qui reste lue', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const old = T0 - 2 * 3_600_000
  const theirs = startCall(emptyRegistry('s-deux', '/p', old), { key: 'k1', name: 'Un', isBackground: true }, old)!
  // Une trace plus ancienne de la même discussion (un premier « Oublier », avant ses sous-agents d'ici).
  const before = { id: 's-deux', at: old - 60_000 }
  const { mem, toasts } = world(
    on,
    { 'agents:s-deux': { ...theirs, agents: theirs.agents.map(a => ({ ...a, agentId: 'id-k1', status: 'done' })), updatedAt: old }, 'agents:s-deux:erased': before },
    // La trace de la discussion passe, celle de son sous-agent est refusée ; le retrait passe.
    { traceFailing: 2 },
  )
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1_000)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await ui.press({ key: 'agents-history' })
  await ui.press({ key: 'agents-history-session:s-deux' })
  await clock.advance(200)
  await ui.press({ key: 'agents-forget' })
  await ui.press({ key: 'agents-forget-yes' })
  for (let i = 0; i < 2; i++) await clock.advance(1_000)
  expect(mem['agents:s-deux:erased']).toEqual(before)
  expect(Object.keys(mem).filter(k => k.endsWith(':erased'))).toEqual(['agents:s-deux:erased'])
  expect(toasts.some(t => t.includes('Effacement annulé'))).toBe(true)
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('Q-a par le mod : à l’ouverture de l’onglet, un sous-agent manqué pendant le parcours actif lui est rattaché', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 30_000 })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/h/.claude' })
  const iso = (ms: number) => new Date(ms).toISOString()
  const agent = [
    { type: 'api-request', timestamp: iso(T0 + 40_000) },
    { type: 'assistant', isSidechain: true, timestamp: iso(T0 + 41_000), message: { id: 'm1', model: 'claude-haiku-5-5', content: [{ type: 'text', text: '' }], usage: { input_tokens: 1, output_tokens: 1 } } },
  ]
    .map(l => JSON.stringify(l))
    .join('\n')
  const dir = '/h/.claude/projects/-p'
  const { mem } = world(on, {}, {
    files: {
      [`${dir}/s-sgb.jsonl`]: '',
      [`${dir}/s-sgb/subagents/agent-a-manque.jsonl`]: agent,
      [`${dir}/s-sgb/subagents/agent-a-manque.meta.json`]: JSON.stringify({ description: 'Manqué en direct', toolUseId: 'call-manque', finished: true }),
    },
  })
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  // Le parcours démarre ici : cette discussion le porte.
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await clock.advance(20_000)
  await prompt($, `${dir}/s-sgb.jsonl`)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await clock.advance(1_000)
  const board = Object.entries(mem).find(([k]) => k.startsWith('board'))?.[1] as { runs: Run[] } | undefined
  const run = board?.runs.find(r => r.status === 'active')
  expect(run).toBeDefined()
  expect(parseRegistry(mem['agents:s-sgb'])?.agents.find(a => a.agentId === 'a-manque')?.run).toBe(run!.id)
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})

test('S28 par le mod : un parcours actif ici est noté dans l’en-tête du registre à l’écriture', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const { mem } = world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await $.session.start({ cwd: '', surface: null, isInteractive: true } as any)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: 'Agent', description: 'Explorer', prompt: 'p', run_in_background: true } as any)
  await clock.advance(1_000)
  const board = Object.entries(mem).find(([k]) => k.startsWith('board'))?.[1] as { runs: Run[] } | undefined
  const run = board?.runs.find(r => r.status === 'active')
  expect(parseRegistry(mem['agents:s-sgb'])?.carried).toEqual([run!.id])
})

test('B1 et lilas : les transcripts ne sont plus du bleu des hachures « fond », les pistes des sessions liées s’écartent du violet', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  world(on)
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched', agentId: 'a1' } }))
  await $.tool.call({ tool: 'Agent', description: 'Lecture des transcripts de la rétro', prompt: 'p', run_in_background: true } as any)
  await clock.advance(60_000)
  const ui = await $.ui.mount({ plugin: 'flow-board', surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-agents' })
  const svgs = await ui.findAll({ type: 'Svg' })
  const source = String(svgs.find(svg => String(svg.props.alt).startsWith('Lecture des transcripts'))?.props.source ?? '')
  expect(source).toMatch(/#9BC53D/i)
  expect(source).not.toMatch(/#4A9EE8/i)
  await ui.press({ key: 'tab-flow' })
  await ui.unmount()
})
