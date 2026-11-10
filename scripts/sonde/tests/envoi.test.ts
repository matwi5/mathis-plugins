import { expect, mock, test } from 'claude-code/testing'

import { parseEnvoi, parseEnvoiA, splitCommand } from '../hooks/register.tsx'

// Le moteur sous la sonde : la session, la commande enregistrée, et les envois du mod consignés.
const engine = (on: any, env: Record<string, string> = { SONDE_JOURNAUX: '/j' }) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const submitted: { text: string; origin?: { kind?: string; asUser?: boolean } }[] = []
  const commands: { command: string; args: string; origin?: { kind?: string } }[] = []
  const journal: string[] = []
  const paths: string[] = []
  // Le journal de la sonde : gardé ici, écrit nulle part.
  on('fs.write', (_$: unknown, e: any) => {
    journal.push(e.text)
    paths.push(e.path)
    return { value: undefined } as any
  })
  on('env.get', (_$: unknown, e: any) => ({ value: env[e.name] }) as any)
  on('session.start', (_$: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }) as any)
  on('command.run', (_$: unknown, e: any) => {
    commands.push(e)
    return { text: '' }
  })
  on('prompt.submit', (_$: unknown, e: any) => {
    submitted.push(e)
    return { text: e.text }
  })
  return { clock, submitted, commands, journal, paths }
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' } as any)

test('le délai en tête et --commande sont lus, le reste est le texte', () => {
  expect(parseEnvoi('20 bonjour')).toEqual({ delayS: 20, viaCommand: false, text: 'bonjour' })
  expect(parseEnvoi('bonjour')).toEqual({ delayS: 0, viaCommand: false, text: 'bonjour' })
  expect(parseEnvoi('  1.5   --commande  /sonde-essai:reserve x ')).toEqual({ delayS: 1.5, viaCommand: true, text: '/sonde-essai:reserve x' })
  expect(parseEnvoi('--commande /clear')).toEqual({ delayS: 0, viaCommand: true, text: '/clear' })
  // Un nombre seul est le texte, pas un délai sans texte ; `--commandes` n'est pas l'option.
  expect(parseEnvoi('42')).toEqual({ delayS: 0, viaCommand: false, text: '42' })
  expect(parseEnvoi('--commandes')).toEqual({ delayS: 0, viaCommand: false, text: '--commandes' })
  expect(splitCommand('/sonde-essai:reserve un deux')).toEqual({ command: 'sonde-essai:reserve', args: 'un deux' })
  expect(splitCommand('compact')).toEqual({ command: 'compact', args: '' })
})

test('/sonde-envoi envoie le texte au nom du mod, sans asUser, une fois le délai passé', async ($, on) => {
  const { clock, submitted, journal } = engine(on)
  await start($)
  const r = await $.command.run({ command: 'sonde-envoi', args: '20 Bonjour de la sonde' } as any)
  expect(r.text).toMatch(/part dans 20 s par \$\.prompt\.submit/)
  await clock.advance(19_000)
  expect(submitted).toHaveLength(0)
  await clock.advance(1_000)
  await clock.settle()
  expect(submitted).toHaveLength(1)
  expect(submitted[0]!.text).toBe('Bonjour de la sonde')
  expect(submitted[0]!.origin?.kind).toBe('plugin')
  expect(submitted[0]!.origin?.asUser).toBeUndefined()
  // Le journal note l'envoi et ce que le moteur en a fait.
  expect(journal.at(-1)).toMatch(/"ev":"envoi:résultat"/)
})

test('/sonde-envoi --commande passe par $.command.run, le nom sans sa barre', async ($, on) => {
  const { clock, submitted, commands } = engine(on)
  await start($)
  await $.command.run({ command: 'sonde-envoi', args: '--commande /sonde-essai:reserve x' } as any)
  await clock.settle()
  const sent = commands.filter(c => c.command === 'sonde-essai:reserve')
  expect(sent).toHaveLength(1)
  expect(sent[0]!.args).toBe('x')
  expect(sent[0]!.origin?.kind).toBe('plugin')
  expect(submitted).toHaveLength(0)
})

test('/sonde-envoi sans texte rend son usage et n’envoie rien', async ($, on) => {
  const { clock, submitted, commands } = engine(on)
  await start($)
  const r = await $.command.run({ command: 'sonde-envoi', args: '' } as any)
  expect(r.text).toMatch(/^usage/)
  await clock.advance(60_000)
  expect(submitted).toHaveLength(0)
  expect(commands.filter(c => c.command !== 'sonde-envoi')).toHaveLength(0)
})

test('le journal va dans le dossier que donne SONDE_JOURNAUX (le dossier jetable de sonde.py), hors du dépôt', async ($, on) => {
  const { paths } = engine(on, { SONDE_JOURNAUX: '/tmp/sonde-x/journaux' })
  await start($)
  expect(paths.length).toBeGreaterThan(0)
  expect(paths.every(p => /^\/tmp\/sonde-x\/journaux\/[^/]+\.jsonl$/.test(p))).toBe(true)
})

// Les essais du COO : contexte ajouté à chaque message, effort réécrit par `turn.step`, message à une
// autre discussion, compaction lancée par le mod (docs/evenements-moteur.md, « Ce que le COO peut faire »).

test('SONDE_CONTEXTE ajoute sa note au contexte d’un message', async ($, on) => {
  const { submitted } = engine(on, { SONDE_JOURNAUX: '/j', SONDE_CONTEXTE: 'pamplemousse' })
  await start($)
  await $.prompt.submit({ text: 'Quel est le mot du jour ?' } as any)
  const seen = submitted.at(-1) as any
  expect(seen.text).toBe('Quel est le mot du jour ?')
  expect((seen.context ?? []).some((c: string) => c.includes('pamplemousse'))).toBe(true)
})

test('sans SONDE_CONTEXTE, rien n’est ajouté au contexte', async ($, on) => {
  const { submitted, journal } = engine(on)
  await start($)
  await $.prompt.submit({ text: 'Bonjour' } as any)
  // Le hook de la sonde a bien vu le message (contrôle positif), puis rien n'a été ajouté.
  expect(journal.at(-1)).toMatch(/"ev":"prompt.submit:after"/)
  expect(journal.at(-1)).not.toMatch(/"ev":"contexte:ajouté"/)
  expect((submitted.at(-1) as any).text).toBe('Bonjour')
  expect((submitted.at(-1) as any).context ?? []).toEqual([])
})

test('SONDE_EFFORT réécrit l’effort des étapes du fil principal, pas celles d’un spécialiste', async ($, on) => {
  engine(on, { SONDE_JOURNAUX: '/j', SONDE_EFFORT: 'max' })
  const efforts: (string | undefined)[] = []
  on('turn.step', async function* (_$: unknown, e: any) {
    efforts.push(e.effort)
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  await start($)
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, effort: 'low' } as any)) {
    // la réponse du fil principal
  }
  for await (const _ of $.turn.step({ turnId: 't', index: 1, model: 'm', messageCount: 1, effort: 'low', agentId: 'a1' } as any)) {
    // la réponse d'un spécialiste
  }
  expect(efforts).toEqual(['max', 'low'])
})

// Le moteur d'une étape : il note le modèle et l'effort de chaque requête, et répond par `model`.
const stepEngine = (on: any, served = 'claude-fable-5-2') => {
  const asked: { model: string; agentId?: string }[] = []
  on('turn.step', async function* (_$: unknown, e: any) {
    asked.push({ model: e.model, agentId: e.agentId })
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: served }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], serverToolUses: [{ id: 's1', name: 'advisor', input: {} }], stopReason: 'end_turn' as const, usage }
  })
  return asked
}

const step = async ($: any, index: number, agentId?: string) => {
  for await (const _ of $.turn.step({ turnId: 't', index, model: 'claude-opus-5-5', messageCount: 1, effort: 'medium', ...(agentId ? { agentId } : {}) } as any)) {
    // la réponse
  }
}

test('/sonde-modele fable envoie les requêtes du fil principal sur fable, jamais celles d’un spécialiste ou d’un fork, et /sonde-modele seul les ramène', async ($, on) => {
  const { journal } = engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as any)
  const asked = stepEngine(on)
  await start($)
  await step($, 0)
  const r = await $.command.run({ command: 'sonde-modele', args: 'fable' } as any)
  expect(r.text).toMatch(/fable/)
  await step($, 1)
  await step($, 2, 'fork-1')
  const back = await $.command.run({ command: 'sonde-modele', args: '' } as any)
  expect(back.text).toMatch(/modèle de la session/)
  await step($, 3)
  expect(asked).toEqual([
    { model: 'claude-opus-5-5', agentId: undefined },
    { model: 'fable', agentId: undefined },
    { model: 'claude-opus-5-5', agentId: 'fork-1' },
    { model: 'claude-opus-5-5', agentId: undefined },
  ])
  // Le journal note la réécriture, le modèle de la session pendant elle, et ce que dit la réponse
  // (modèle qui a répondu, outils du serveur comme l'advisor).
  const lines = journal.at(-1)!.trim().split('\n').map(l => JSON.parse(l))
  const rewritten = lines.filter(l => l.ev === 'modele:réécrit')
  expect(rewritten).toHaveLength(1)
  expect(rewritten[0]).toMatchObject({ de: 'claude-opus-5-5', vers: 'fable', index: 1, sessionModel: 'claude-opus-5-5' })
  const result = lines.find(l => l.ev === 'turn.step:result' && l.index === 1)
  expect(result).toMatchObject({ agentId: null, model: 'claude-fable-5-2', stopReason: 'end_turn', serverTools: ['advisor'] })
})

test('/sonde-modele fable 2 ne réécrit que les deux premières étapes de chaque tour : la suite du tour repart sur le modèle de la session', async ($, on) => {
  engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as any)
  const asked = stepEngine(on)
  await start($)
  const r = await $.command.run({ command: 'sonde-modele', args: 'fable 2' } as any)
  expect(r.text).toMatch(/2 premières étapes/)
  await step($, 0)
  await step($, 1)
  await step($, 2)
  await step($, 0)
  await $.command.run({ command: 'sonde-modele', args: '' } as any)
  expect(asked.map(a => a.model)).toEqual(['fable', 'fable', 'claude-opus-5-5', 'fable'])
})

test('/sonde-modele fable +1 ne réécrit qu’à partir de la deuxième étape de chaque tour : le début du tour part sur le modèle de la session', async ($, on) => {
  engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as any)
  const asked = stepEngine(on)
  await start($)
  const r = await $.command.run({ command: 'sonde-modele', args: 'fable +1' } as any)
  expect(r.text).toMatch(/à partir de l'étape 1/)
  await step($, 0)
  await step($, 1)
  await step($, 2)
  await step($, 0)
  await step($, 1, 'fork-1')
  await $.command.run({ command: 'sonde-modele', args: '' } as any)
  await step($, 1)
  expect(asked.map(a => a.model)).toEqual(['claude-opus-5-5', 'fable', 'fable', 'claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5'])
})

test('une requête réécrite que l’API refuse est notée au journal, puis l’erreur rendue au moteur', async ($, on) => {
  const { journal } = engine(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as any)
  on('turn.step', async function* (_$: unknown, _e: any) {
    throw new Error('400 invalid_request_error: thinking blocks')
  })
  await start($)
  await $.command.run({ command: 'sonde-modele', args: 'fable' } as any)
  let thrown: unknown = null
  try {
    await step($, 0)
  } catch (err) {
    thrown = err
  }
  await $.command.run({ command: 'sonde-modele', args: '' } as any)
  // Le faux moteur saute un hook de test qui lève : l'erreur qui remonte est celle du moteur sans réponse.
  expect(thrown).not.toBeNull()
  const lines = journal.at(-1)!.trim().split('\n').map(l => JSON.parse(l))
  expect(lines.find(l => l.ev === 'turn.step:erreur')).toMatchObject({ agentId: null, index: 0, model: 'fable' })
  expect(lines.find(l => l.ev === 'turn.step:erreur').error).toBe(String(thrown).slice(0, 300))
})

test('/sonde-envoyer-a envoie le texte par $.session.send, à un id de session ou à un nom', async ($, on) => {
  const { journal } = engine(on)
  const sent: { to: unknown; text: string }[] = []
  on('session.send', (_$: unknown, e: any) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true } as any
  })
  await start($)
  await $.command.run({ command: 'sonde-envoyer-a', args: '0f6c2a1e-1111-4222-8333-444455556666 Bonjour, autre discussion' } as any)
  await $.command.run({ command: 'sonde-envoyer-a', args: 'sonde-b Bonjour' } as any)
  expect(sent).toHaveLength(2)
  expect(sent[0]!.text).toBe('Bonjour, autre discussion')
  expect(parseEnvoiA('0f6c2a1e-1111-4222-8333-444455556666 x')).toEqual({ to: { sessionId: '0f6c2a1e-1111-4222-8333-444455556666' }, text: 'x' })
  expect(parseEnvoiA('sonde-b x')).toEqual({ to: 'sonde-b', text: 'x' })
  expect(JSON.stringify(sent[0]!.to)).toContain('0f6c2a1e-1111-4222-8333-444455556666')
  expect(sent[1]).toEqual({ to: 'sonde-b', text: 'Bonjour' })
  expect(journal.at(-1)).toMatch(/"ev":"envoi-a:résultat"/)
})

test('/sonde-compacte lance $.session.compact avec ses consignes, une fois le délai passé', async ($, on) => {
  const { clock, journal } = engine(on)
  const asked: (string | undefined)[] = []
  on('session.compact', (_$: unknown, e: any) => {
    asked.push(e.instructions)
    return { skip: 'essai' } as any
  })
  await start($)
  const r = await $.command.run({ command: 'sonde-compacte', args: '5 garde le mot banane' } as any)
  expect(r.text).toMatch(/dans 5 s/)
  await clock.advance(4_000)
  expect(asked).toHaveLength(0)
  await clock.advance(1_000)
  await clock.settle()
  expect(asked).toEqual(['garde le mot banane'])
  expect(journal.at(-1)).toMatch(/"ev":"compacte:résultat"/)
})
