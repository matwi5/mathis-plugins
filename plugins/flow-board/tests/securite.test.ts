import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} },
} as const

const world = (on: any) => {
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}

const LOT = [
  { id: 'A1', name: 'Un', blockedBy: [] },
  { id: 'A2', name: 'Deux', blockedBy: ['A1'] },
  { id: 'B1', name: 'Trois', blockedBy: ['A2'] },
]
const GROUPS = [
  { id: 'A', name: 'Worker', tickets: ['A1', 'A2'], files: ['worker'] },
  { id: 'B', name: 'App', tickets: ['B1'], files: ['app'] },
]

test('revue de sécurité : l’avis de Claude après la revue du groupe, le bouton, puis « sécurité relue »', { timeoutMs: 15000 }, async ($, on) => {
  mock.clock(on, { now: 97_000_000 })
  mock.store(on)
  const filled = world(on)
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  const coaching = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text
  // Claude sait dès l'implémentation qu'il donnera son avis, puis lancera lui-même le sous-agent relecteur, jamais /security-review.
  expect(coaching).toContain('"advised": true|false')
  expect(coaching).toContain('launch it yourself: a reviewer subagent (Agent tool, general-purpose, model opus, effort high or xhigh as the criterion of the method file decides), read-only, limited to git diff <group base>..HEAD')
  // Ticket 13 : la méthode fixe, citée par son chemin (tiré de la racine du mod), sans être recopiée.
  expect(coaching).toMatch(/the path of the security review method file, \S+\/reference\/revue-securite\.md \(it follows it:/)
  expect(coaching).not.toContain('effort xhigh)')
  // Les correctifs proposés, acceptés en une ligne ; findings ne compte que les failles gardées.
  expect(coaching).toContain('each kept finding comes numbered (F1, F2…) with a ready fix')
  expect(coaching).toContain('a reply such as "fix F1 and F3" is enough: apply those fixes, test them, commit them, then send "fixed"')
  expect(coaching).toContain('"findings": <kept findings, not the to-watch list>')
  expect(coaching).toContain('never /security-review')
  expect(coaching).not.toContain('Never run /security-review yourself')
  await $.tool.call({ tool: TOOL, tickets: LOT, groups: GROUPS } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }, { id: 'A2', status: 'done' }] } as any)
  const review = (await $.skill.prompt({ skill: 'code-review', text: 'r' })).text
  expect(review).toContain('"security"')
  // Un événement ne termine pas la phase en cours.
  expect(review).not.toContain('{"complete": true}')

  // Sans avis, rien sur la carte du groupe.
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'security-group-A' })).toBeUndefined()
  await ui.unmount()

  // Groupe nommé omis : le dernier groupe fini.
  await $.tool.call({ tool: TOOL, security: { advised: true, why: 'touche les règles RLS' } } as any)
  // Le plan renvoyé garde l'avis.
  await $.tool.call({ tool: TOOL, groups: GROUPS } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(String((await ui.find({ key: 'security-group-A' }))?.props?.label)).toMatch(/^⛨.Revue de sécurité · sous-agent relecteur$/)
  expect(await ui.find({ type: 'Text', text: /conseillée : touche les règles RLS/ })).toBeDefined()
  // Facultative : la carte « Ensuite » ne la propose jamais, et B reste la suite.
  expect(await ui.find({ key: 'go-security-review' })).toBeUndefined()
  await ui.press({ key: 'security-group-A' })
  await ui.unmount()
  // Le bouton demande à Claude le sous-agent relecteur, limité au diff du groupe : plus de /security-review.
  expect(filled.at(-1)).toMatch(/^Lance la revue de sécurité du groupe A \(Worker\) : confie-la à un sous-agent relecteur/)
  expect(filled.at(-1)).toContain("git diff <base>..HEAD (<base> : le commit d'avant le premier ticket du groupe A)")
  expect(filled.at(-1)).toContain('je décide de leur correction')
  expect(filled.at(-1)).toMatch(/effort high ou xhigh selon le critère du fichier de méthode\)/)
  expect(filled.at(-1)).toMatch(/le chemin du fichier de méthode de la revue de sécurité, \S+\/reference\/revue-securite\.md/)
  expect(filled.at(-1)).toContain('une réponse comme « corrige F1 et F3 » suffit')
  expect(filled.at(-1)).not.toContain('effort xhigh')
  expect(filled.at(-1)).not.toMatch(/copie/)

  // Les constats du sous-agent, sans skill chargé : la revue compte comme faite.
  await $.tool.call({ tool: TOOL, security: { group: 'A', findings: 2, fixed: 1 } } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'security-group-A' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^⛨.sécurité relue · 2.constats · 1 corrigé$/ })).toBeDefined()
  await ui.unmount()

  // Le compte rendu sait ce qu'il en est, groupe par groupe.
  await $.tool.call({ tool: TOOL, set: [{ id: 'B1', status: 'done' }] } as any)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, security: { group: 'B', advised: false, why: 'que de l’affichage' } } as any)
  await $.tool.call({ tool: TOOL, complete: true } as any)
  const report = (await $.skill.prompt({ skill: 'flow-board:compte-rendu', text: 'c' })).text
  expect(report).toContain('A (Worker): 2/2 done, reviewed by /code-review, security review run (2 findings, 1 fixed)')
  expect(report).toContain('B (App): 1/1 done, reviewed by /code-review, security review judged not needed (que de l’affichage)')
})

test('un avis « inutile » laisse la lancer quand même', async ($, on) => {
  mock.clock(on, { now: 97_500_000 })
  mock.store(on)
  world(on)
  await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  await $.tool.call({ tool: TOOL, tickets: LOT, groups: GROUPS } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }, { id: 'A2', status: 'done' }] } as any)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, security: { group: 'a', advised: false, why: 'rien de sensible' } } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(String((await ui.find({ key: 'security-group-A' }))?.props?.label)).toMatch(/^⛨.La lancer quand même$/)
  expect(await ui.find({ type: 'Text', text: /sécurité.jugée inutile : rien de sensible/ })).toBeDefined()
  await ui.unmount()
})

test('sans git, la revue de sécurité d’un groupe lit ses copies d’avant les tickets, pas un git diff', async ($, on) => {
  mock.clock(on, { now: 97_500_000 })
  mock.store(on)
  const filled = world(on)
  on('session.repo', () => ({ value: null }))
  const coaching = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text
  expect(coaching).toContain("limited to the group's diff (fixed point: for each file, the oldest copy among the group's tickets, diffed against the current file")
  expect(coaching).not.toContain('git diff <group base>..HEAD')
  await $.tool.call({ tool: TOOL, tickets: LOT, groups: GROUPS } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'A1', status: 'done' }, { id: 'A2', status: 'done' }] } as any)
  await $.skill.prompt({ skill: 'code-review', text: 'r' })
  await $.tool.call({ tool: TOOL, security: { group: 'A', advised: true, why: 'touche les règles RLS' } } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await ui.press({ key: 'security-group-A' })
  await ui.unmount()
  expect(filled.at(-1)).toContain('avec pour seul périmètre les changements du groupe A (pour chaque fichier, la différence entre la plus ancienne copie prise avant ses tickets')
  expect(filled.at(-1)).not.toContain('git diff')
})

test('sans groupes, l’avis de sécurité du lot cite aussi le fichier de méthode, sans xhigh d’office', async ($, on) => {
  mock.clock(on, { now: 97_600_000 })
  mock.store(on)
  world(on)
  const text = (await $.skill.prompt({ skill: 'mattpocock-skills:code-review', text: 'x' })).text
  expect(text).toContain('without "group": it covers the whole run')
  expect(text).toMatch(/the path of the security review method file, \S+\/reference\/revue-securite\.md/)
  expect(text).toContain('effort high or xhigh as the criterion of the method file decides')
  expect(text).not.toContain('effort xhigh)')
})
