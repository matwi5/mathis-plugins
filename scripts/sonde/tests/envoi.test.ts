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
