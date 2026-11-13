import { expect, mock, test } from 'claude-code/testing'

// Après un tri qui sort des corrections, le découpage partait de la conversation : le partage validé et ses faits
// vérifiés (tri.md) n'étaient nommés nulle part. La consigne de l'étape « Contexte » de /to-tickets distingue trois cas
// quand elle suit un tri dans la même mission ; la condition est dans la phrase, un texte fixe du catalogue.

const TOOL = 'mcp__flow-board__flow'

const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-T' }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
}

/** La consigne de l'étape `context` dans la ligne des étapes du texte rendu. */
const contextHint = (text: string): string => {
  const line = text.split('\n').find(l => l.startsWith('- Steps of to-tickets, in order'))
  expect(line).toBeDefined()
  const from = line!.indexOf(': context (')
  const to = line!.indexOf('; explore (', from)
  expect(from).toBeGreaterThan(0)
  expect(to).toBeGreaterThan(from)
  return line!.slice(from, to)
}

test('après un tri fini, la consigne rendue au chargement de /to-tickets donne tri.md pour source, sous la condition du tri dans la même mission', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 58_000_000 })
  world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await $.skill.prompt({ skill: 'mattpocock-skills:triage', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Tri des scripts', complete: true } as any)
  const hint = contextHint((await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })).text as string)
  // Le cas d'aujourd'hui, inchangé : un tri sans correction.
  expect(hint).toContain('when this phase follows a Triage in the same mission and the triage found no code fix to make, send {"complete": true} without any ticket: the mission can then be closed like a triage without code (in a mission of its own, the Implementation stays due)')
  // Des corrections et un tri.md : la source est le tri.md, introduite par la condition.
  const withFile = "when this phase follows a Triage in the same mission and that triage wrote tri.md in the mission's folder (not a tri.md left there by an earlier mission of the same folder), work from its « corrige » lines and its verified facts, not from the conversation"
  expect(hint).toContain(withFile)
  expect(hint).toContain('each ticket cites the entries it handles')
  expect(hint).toContain("once the tickets are published, write each line's ticket number in the ticket column of tri.md")
  // Sans tri.md : la conversation, comme avant.
  expect(hint).toContain('when this phase follows a Triage that wrote no tri.md, gather the conversation as before')
})
