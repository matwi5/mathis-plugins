import { expect, mock, test } from 'claude-code/testing'

import { parseEnvoi, splitCommand } from '../hooks/register.tsx'

// Le moteur sous la sonde : la session, la commande enregistrée, et les envois du mod consignés.
const engine = (on: any) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const submitted: { text: string; origin?: { kind?: string; asUser?: boolean } }[] = []
  const commands: { command: string; args: string; origin?: { kind?: string } }[] = []
  const journal: string[] = []
  // Le journal de la sonde : gardé ici, écrit nulle part.
  on('fs.write', (_$: unknown, e: any) => {
    journal.push(e.text)
    return { value: undefined } as any
  })
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
  return { clock, submitted, commands, journal }
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
