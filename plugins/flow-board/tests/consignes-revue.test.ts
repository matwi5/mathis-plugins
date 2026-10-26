import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const

const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return filled
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

const LOT = {
  tickets: [
    { id: 'a1', name: 'Un', files: ['src/a.ts'] },
    { id: 'e1', name: 'Enquête', files: ['travail/sql'] },
  ],
  groups: [
    { id: 'A', name: 'Code', tickets: ['a1'] },
    { id: 'E', name: 'Enquêtes', tickets: ['e1'] },
  ],
}

// /code-review tourne en exécution dérivée et ne reçoit que ses arguments : ses consignes passent par
// un fichier dont le chemin suit la cible (forme essayée avec Claude Code 2.1.310), et la cible est une plage.
test('dans la discussion, chaque revue reçoit ses consignes par un fichier, sur une plage, et le relecteur n’écrit pas', async ($, on) => {
  mock.clock(on, { now: 96_000_000 })
  world(on)
  await start($)
  const implement = (await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })).text as string
  expect(implement).toContain('/code-review <level> <base>..HEAD consignes : <path>')
  expect(implement).toContain('never a commit hash alone')
  expect(implement).toContain('the points left to the user')
  // Une zone sensible : pas de --fix, le relecteur n'applique que ce qu'il retient.
  expect(implement).toContain('without --fix: the reviewer applies itself only the findings it keeps')
  // Un relecteur n'écrit jamais dans l'arbre : la preuve rouge reste à la session.
  expect(implement).toContain('never write in the working tree, not even for a moment')
  // Les constats triés : seuls les importants sont corrigés, une remarque mineure ne coûte pas un tour de revue.
  expect(implement).toContain('tag every finding Important, Nit or Pre-existing')
  expect(implement).toContain('the Nits (style, naming, a cleanup that changes no behaviour) are listed and not fixed')
  expect(implement).toContain('for a defect, name its class')
  expect(implement).toContain('config/rules/agents.md')
})

test('dans une session liée, les consignes de revue passent par un fichier et la revue du groupe vise une plage', async ($, on) => {
  mock.clock(on, { now: 96_500_000 })
  const filled = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...LOT } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  const text = filled.at(-1)!
  expect(text).toContain('/code-review <niveau> <base>..HEAD consignes : <chemin>')
  expect(text).toContain('jamais un hash seul')
  expect(text).toContain("ne jamais écrire dans l'arbre de travail, même un instant")
  expect(text).toContain('étiqueter chaque constat Important, Mineur ou Antérieur')
  expect(text).toContain('les Mineurs (style, nommage, nettoyage qui ne change aucun comportement) sont listés sans être corrigés')
  expect(text).toContain('pour un défaut, nommer sa classe')
  expect(text).toContain("sans --fix : le relecteur applique lui-même les seuls constats qu'il retient")
  // Les arguments donnés au skill portent la cible et le chemin des consignes.
  expect(text).toContain('arguments « high --fix <base>..HEAD consignes : <chemin> »')
  expect(text).toContain('arguments « xhigh <base>..HEAD consignes : <chemin> »')
  // La revue du groupe a pour cible la plage de sa branche, sans « le nom de la branche » en repli.
  expect(text).toContain("avec pour cible <base>..HEAD (<base> : le commit d'où part sa branche)")
  expect(text).not.toContain('lui donner le nom de la branche')
})
