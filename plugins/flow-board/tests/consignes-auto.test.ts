// Les consignes du mode auto : un parcours en auto, qui envoie d'ici, reçoit à la fin de la consigne de
// chaque skill un bloc commun (l'accord du second clic, les choix déclarés avec leur origine, les six
// catégories qui restent des questions bloquantes, la notification au texte fixé) et le bloc de sa phase
// (cadrage, spec, découpage, implémentation, revues, compte rendu). Hors auto, ou en pause ici, rien ne change.

import { expect, mock, test } from 'claude-code/testing'

import { autoQuestionsNotice } from '../hooks/model.ts'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const

/**
 * Le moteur sous le plugin : `$.store` et les fichiers en mémoire (le fichier commun des parcours sert quand le
 * dossier du mod est sous un `.claude/`, comme dans un worktree), l'id de la discussion que le test change pour jouer un `/clear`.
 */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const ids = { now: 'sa' }
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: e.path in files }) as any)
  on('fs.read', (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path] } as any
  })
  on('fs.write', (_$: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text
    return { value: undefined } as any
  })
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: ids.now }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = e.value === undefined ? undefined : JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: ids.now }))
  on('command.list', () => ({ value: [] }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  return { ids }
}

const press = async ($: any, key: string) => {
  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  await pane.press({ key })
  await pane.unmount()
}

const skill = async ($: any, name: string): Promise<string> => String((await $.skill.prompt({ skill: name.includes(':') ? name : `mattpocock-skills:${name}`, text: 'x' })).text)

/** Un parcours ouvert par `entry`, actif dans la discussion « sa », titré « Boutique », auto allumé ou non. */
const opened = async ($: any, on: any, entry: string, isAuto: boolean) => {
  const clock = mock.clock(on, { now: 70_000_000 })
  const w = world(on)
  await $.session.start({ cwd: '', surface: null, isInteractive: true })
  await skill($, entry)
  await $.tool.call({ tool: TOOL, title: 'Boutique' } as any)
  if (isAuto) {
    await press($, 'auto-on')
    await press($, 'auto-confirm')
  }
  await clock.advance(1000)
  return { clock, ...w }
}

const COMMON = ['Auto mode is on for this run', '"origin": "recommendation"', '"origin": "skipped-validation"', 'Six kinds of decisions stay with the user', '{"waiting": [{"id"', 'PushNotification']
// Le texte de la notification vient de la même fonction que celui du mod (`autoNotices`).
const NOTICE = `« ${autoQuestionsNotice('Boutique', 'N')} »`

/** Les phases d'une « Nouvelle fonctionnalité » après son cadrage, et la phrase propre à chacune. */
const PHASES: [string, string][] = [
  ['to-spec', 'Spec in auto mode: the seams are not asked: settle them by your recommended answer'],
  ['to-tickets', 'Ticket split in auto mode: the breakdown is not approved by a button question'],
  ['implement', 'Implementation in auto mode: flow-board itself sends, at the end of a turn, the request to launch the next wave of groups'],
  ['flow-board:compte-rendu', 'Report in auto mode: the auto mode stops once the report is written'],
]

test('En auto, le cadrage reçoit le bloc commun et celui d’un seul tour d’intention', { timeoutMs: 20000 }, async ($, on) => {
  // Un questionnaire, puis le cadrage, phase suivante du même parcours.
  await opened($, on, 'to-questionnaire', true)
  const grill = await skill($, 'grill-with-docs')
  for (const part of COMMON) expect(grill).toContain(part)
  expect(grill).toContain(NOTICE)
  expect(grill).toContain('one round only with the user, on intent (the goal, the scope, what is out of scope)')
  expect(grill).toContain('« acceptée en auto (reco) »')
  expect(grill).toContain('The final agreement is not asked')
  // Les six catégories, dans l'ordre du premier clic sur « ⚡ Auto », xhigh sans question.
  expect(grill).toMatch(/1\) a sensitive area .*2\) a question with no defensible recommendation.*3\) a design change that contradicts DECISIONS\.md.*4\) leaving a security finding unfixed.*5\) an xhigh effort .*stay in high and declare that xhigh was not offered.*6\) a spending or an external action outside the run/)
  // Le bloc du mode auto vient en dernier : il l'emporte sur les demandes de validation qui précèdent.
  expect(grill.indexOf('Auto mode is on for this run')).toBeGreaterThan(grill.indexOf('Dashboard (flow-board)'))
})

test('En auto, la spec, le découpage, l’implémentation et le compte rendu reçoivent le bloc commun et le leur', { timeoutMs: 20000 }, async ($, on) => {
  await opened($, on, 'grill-with-docs', true)
  for (const [name, own] of PHASES) {
    const text = await skill($, name)
    for (const part of COMMON) expect(text).toContain(part)
    expect(text).toContain(own)
    expect(text).not.toContain('Framing in auto mode')
    expect(text.indexOf('Auto mode is on for this run')).toBeGreaterThan(text.indexOf('Dashboard (flow-board)'))
    if (name === 'to-spec') expect(text).toContain('write them in the decision file as « acceptée en auto (reco) » and declare them ("origin": "recommendation")')
    if (name === 'implement') {
      expect(text).toContain('fix every kept finding without asking the user')
      expect(text).toContain('do not propose a « durcissement » group; list them for the report')
      expect(text).toContain('never xhigh: do not ask the xhigh question, declare instead that xhigh was not offered')
    }
  }
})

test('Hors auto, la consigne de chaque phase est la même qu’avant : aucun bloc du mode auto', { timeoutMs: 20000 }, async ($, on) => {
  await opened($, on, 'to-questionnaire', false)
  for (const name of ['grill-with-docs', ...PHASES.map(([n]) => n)]) {
    const text = await skill($, name)
    // Le contrôle positif : la consigne de flow-board est bien là.
    expect(text).toContain('Dashboard (flow-board)')
    expect(text).not.toContain('Auto mode is on for this run')
    expect(text).not.toContain('in auto mode')
    expect(text).not.toContain('PushNotification')
  }
})

test('Après un /clear, l’auto est en pause ici : la consigne n’a plus le bloc du mode auto', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, ids } = await opened($, on, 'grill-with-docs', true)
  // D'abord l'effet : allumé ici, la consigne porte le bloc.
  expect(await skill($, 'to-spec')).toContain('Auto mode is on for this run')
  await $.session.end({ reason: 'clear' } as any)
  ids.now = 'sa-apres-clear'
  await clock.advance(1000)
  const text = await skill($, 'to-tickets')
  expect(text).toContain('Dashboard (flow-board)')
  expect(text).not.toContain('Auto mode is on for this run')
})

test('Coupé après une consigne qui portait le bloc du mode auto, la réponse suivante de l’outil le dit, une fois', { timeoutMs: 20000 }, async ($, on) => {
  const { clock } = await opened($, on, 'grill-with-docs', true)
  const OFF = 'Auto mode is OFF for this run now'
  expect(await skill($, 'to-spec')).toContain('Auto mode is on for this run')
  // Allumé : la réponse de l'outil n'en dit rien (après l'effet : la consigne portait le bloc).
  expect(String((await $.tool.call({ tool: TOOL, step: 'explore' } as any)).result)).not.toContain(OFF)
  await press($, 'auto-off')
  await clock.advance(1000)
  const cut = String((await $.tool.call({ tool: TOOL, step: 'seams' } as any)).result)
  expect(cut).toContain(OFF)
  expect(cut).toContain('ask the user for every validation (button question) and every tracker write')
  // Une fois seulement.
  expect(String((await $.tool.call({ tool: TOOL, step: 'write' } as any)).result)).not.toContain(OFF)
})
