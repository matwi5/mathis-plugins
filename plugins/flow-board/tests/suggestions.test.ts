import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__flow-board__flow'

// Ce que le moteur ferait sous les plugins : le texte du skill tel quel, la réponse du tour, et la
// suggestion montrée (gardée pour le test).
const engine = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  const shown: { text: string; origin: unknown }[] = []
  on('prompt.suggest', (_$: unknown, e: { text: string; origin: unknown }) => {
    shown.push({ text: e.text, origin: e.origin })
    return { isShown: true }
  })
  return shown
}

const endTurn = ($: any, answer: string, agentId?: string) =>
  $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer', ...(agentId ? { agentId } : {}) })

test('la fin d’un tour principal propose la commande de la suite, grisée', async ($, on) => {
  mock.clock(on, { now: 50_000_000 })
  mock.store(on)
  const shown = engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Spec du lot', complete: true } as any)
  // Le tour d'un sous-agent ne propose rien.
  await endTurn($, 'fini', 'agent-1')
  expect(shown).toHaveLength(0)
  await endTurn($, 'La spec est écrite.')
  expect(shown).toHaveLength(1)
  expect(shown[0]!.text).toMatch(/^\/\S*to-tickets$/)
  expect(shown[0]!.origin).toEqual({ kind: 'plugin', name: 'flow-board' })
})

test('rien n’est proposé quand une question attend la personne', async ($, on) => {
  mock.clock(on, { now: 50_000_000 })
  mock.store(on)
  const shown = engine(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Spec du lot', complete: true } as any)
  await endTurn($, 'La spec est écrite. Je passe au découpage ?')
  expect(shown).toHaveLength(0)
})

test('rien n’est proposé sans parcours, ni quand la suite est le lancement d’un groupe', async ($, on) => {
  mock.clock(on, { now: 50_000_000 })
  mock.store(on)
  const shown = engine(on)
  await endTurn($, 'Bonjour.')
  expect(shown).toHaveLength(0)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({
    tool: TOOL,
    title: 'Lot',
    tickets: [{ id: 'a1', name: 'Un' }, { id: 'b1', name: 'Deux', blockedBy: ['a1'] }],
    groups: [{ id: 'A', name: 'Un', tickets: ['a1'] }, { id: 'B', name: 'Deux', tickets: ['b1'] }],
  } as any)
  await endTurn($, 'Le plan est prêt.')
  expect(shown).toHaveLength(0)
})

test('la suggestion de git-board s’écarte pendant un parcours et passe hors parcours', async ($, on) => {
  mock.clock(on, { now: 50_000_000 })
  mock.store(on)
  const shown = engine(on)
  const fromGitBoard = { text: '/project:push', origin: { kind: 'plugin', name: 'git-board' } }
  // Hors parcours : elle passe.
  expect(await ($ as any).prompt.suggest(fromGitBoard)).toEqual({ isShown: true })
  expect(shown.map(s => s.text)).toEqual(['/project:push'])
  // Parcours actif : elle s'écarte, celle du moteur passe toujours.
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  expect(await ($ as any).prompt.suggest(fromGitBoard)).toEqual({ isShown: false })
  expect(await ($ as any).prompt.suggest({ text: 'ok', origin: { kind: 'suggestion' } })).toEqual({ isShown: true })
  expect(shown.map(s => s.text)).toEqual(['/project:push', 'ok'])
  // Parcours clos : elle revient.
  await ($ as any).command.run({ command: 'flow-board:flow', args: 'done' })
  expect(await ($ as any).prompt.suggest(fromGitBoard)).toEqual({ isShown: true })
  expect(shown.map(s => s.text)).toEqual(['/project:push', 'ok', '/project:push'])
})
