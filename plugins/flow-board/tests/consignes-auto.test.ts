// Les consignes du mode auto : une mission en auto, qui envoie d'ici, reçoit à la fin de la consigne de
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
  props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 160 }, view: {} },
} as const

/**
 * Le moteur sous le plugin : `$.store` et les fichiers en mémoire (le fichier commun des missions sert quand le
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
  // Le message de consigne que le mod envoie au repos (mode auto allumé) entre dans la session.
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
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

/** Une mission ouverte par `entry`, actif dans la discussion « sa », titré « Boutique », auto allumé ou non. */
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

const COMMON = ['Auto mode is on for this mission', '"origin": "recommendation"', '"origin": "skipped-validation"', 'Six kinds of decisions stay with the user', '{"waiting": [{"id"', 'PushNotification', 'Before coding a decision you take alone outside the framing (a design change, a question in a sensitive area settled by you), consult the advisor (the advisor tool, when you have it), once per decision']
// Le texte de la notification vient de la même fonction que celui du mod (`autoNotices`).
const NOTICE = `« ${autoQuestionsNotice('Boutique', 'N')} »`

/** Les phases d'une « Nouvelle fonctionnalité » après son cadrage, et la phrase propre à chacune. */
const PHASES: [string, string][] = [
  ['to-spec', 'Spec in auto mode: the seams are not asked: settle them by your recommended answer'],
  ['to-tickets', 'Ticket split in auto mode: the breakdown is not approved by a button question'],
  // Cette mission n'a pas de groupes : le bloc du lot (celui d'une mission à groupes, dans note-revue-du-lot.test.ts).
  ['implement', 'Implementation in auto mode, without groups: launch the lot review yourself'],
  ['flow-board:compte-rendu', 'Report in auto mode: the auto mode stops once the report is written'],
]

test('En auto, le cadrage reçoit le bloc commun et celui d’un seul tour d’intention', { timeoutMs: 20000 }, async ($, on) => {
  // Un questionnaire, puis le cadrage, phase suivante de la même mission.
  await opened($, on, 'to-questionnaire', true)
  const grill = await skill($, 'grill-with-docs')
  for (const part of COMMON) expect(grill).toContain(part)
  expect(grill).toContain(NOTICE)
  expect(grill).toContain('one round only with the user, on intent (the goal, the scope, what is out of scope)')
  expect(grill).toContain('« acceptée en auto (reco) »')
  expect(grill).toContain('The final agreement is not asked')
  // Les six catégories, dans l'ordre du premier clic sur « ⚡ Auto » : le chemin Fable, xhigh par la ligne « Jugement ».
  expect(grill).toMatch(/1\) an experience choice: .*2\) setting or weakening an invariant, or a design change that contradicts DECISIONS\.md.*3\) a deletion with no way back, or an exposure of the user's data outside this machine.*4\) leaving a security finding unfixed.*5\) the Fable path for a worker: never take it yourself; suggest it only for a bug Opus did not solve; xhigh comes from a ticket's « Jugement » line, declared at the split.*6\) a spending or an external action outside the mission/)
  // Une question en zone sensible se tranche seule à sa condition, déclarée comme une reco prise marquée « Zone sensible : ».
  expect(grill).toMatch(/A question in a sensitive area .* is settled by you when its recommended option respects the invariant already validated \(when there is one\) and is the most prudent one .*« Zone sensible : ».*otherwise it stays a blocking question\. A breach of the invariant that the high pass after the bug pass's fixes still finds, fixed in the most prudent way, is written as a test and goes out as one line of information, declared as a recommendation taken beginning with « Zone sensible : », not as a question\. In auto mode, this wins over any line above that says a sensitive choice is never declared/)
  // Le bloc du mode auto vient en dernier : il l'emporte sur les demandes de validation qui précèdent.
  expect(grill.indexOf('Auto mode is on for this mission')).toBeGreaterThan(grill.indexOf('Dashboard (flow-board)'))
})

test('En auto, la spec, le découpage, l’implémentation et le compte rendu reçoivent le bloc commun et le leur', { timeoutMs: 20000 }, async ($, on) => {
  await opened($, on, 'grill-with-docs', true)
  for (const [name, own] of PHASES) {
    const text = await skill($, name)
    for (const part of COMMON) expect(text).toContain(part)
    expect(text).toContain(own)
    expect(text).not.toContain('Framing in auto mode')
    expect(text.indexOf('Auto mode is on for this mission')).toBeGreaterThan(text.indexOf('Dashboard (flow-board)'))
    if (name === 'to-spec') expect(text).toContain('write them in the decision file as « acceptée en auto (reco) » and declare them ("origin": "recommendation")')
    // Les lignes « Jugement » se déclarent en un seul choix, au libellé que Mathis a choisi le 12/11/2026, ou en
    // plusieurs au même libellé quand ce choix dépasserait 300 signes (un choix est coupé là).
    if (name === 'to-tickets') expect(text).toContain('declare the judgement tickets in a single choice, its "what" worded « Tickets de jugement, en xhigh le temps du ticket : <id> (<critère>), … »')
    if (name === 'implement') {
      expect(text).toContain('fix every kept finding without asking the user')
      expect(text).toContain('do not propose a « durcissement » group; list them for the report')
      expect(text).toContain("flow-board itself sends it at the end of a turn, then the lot's advised security review when it was not launched")
    }
  }
})

test('Hors auto, la consigne de chaque phase est la même qu’avant : aucun bloc du mode auto', { timeoutMs: 20000 }, async ($, on) => {
  await opened($, on, 'to-questionnaire', false)
  for (const name of ['grill-with-docs', ...PHASES.map(([n]) => n)]) {
    const text = await skill($, name)
    // Le contrôle positif : la consigne de flow-board est bien là.
    expect(text).toContain('Dashboard (flow-board)')
    expect(text).not.toContain('Auto mode is on for this mission')
    expect(text).not.toContain('in auto mode')
    expect(text).not.toContain('PushNotification')
  }
})

test('Après un /clear, l’auto est en pause ici : la consigne n’a plus le bloc du mode auto', { timeoutMs: 20000 }, async ($, on) => {
  const { clock, ids } = await opened($, on, 'grill-with-docs', true)
  // D'abord l'effet : allumé ici, la consigne porte le bloc.
  expect(await skill($, 'to-spec')).toContain('Auto mode is on for this mission')
  await $.session.end({ reason: 'clear' } as any)
  ids.now = 'sa-apres-clear'
  await clock.advance(1000)
  const text = await skill($, 'to-tickets')
  expect(text).toContain('Dashboard (flow-board)')
  expect(text).not.toContain('Auto mode is on for this mission')
})

test('Coupé après une consigne qui portait le bloc du mode auto, la réponse suivante de l’outil le dit, une fois', { timeoutMs: 20000 }, async ($, on) => {
  const { clock } = await opened($, on, 'grill-with-docs', true)
  const OFF = 'Auto mode is OFF for this mission now'
  expect(await skill($, 'to-spec')).toContain('Auto mode is on for this mission')
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

// La fin de lot hors auto fait déclarer le groupe « durcissement » proposé en question et retenir `complete` :
// en auto, cette consigne n'est pas donnée (elle arrêterait la mission sur une question qui ne lui est pas réservée).
test('En auto, la fin de lot ne fait proposer aucun groupe « durcissement » ni déclarer de question qui retienne complete', { timeoutMs: 20000 }, async ($, on) => {
  await opened($, on, 'grill-with-docs', true)
  const text = await skill($, 'implement')
  expect(text).toContain('In auto mode there is no « durcissement » group: list the findings that reviews kept apart on code older than the lot for the report, without a question.')
  expect(text).not.toContain('unless you propose a « durcissement » group')
  expect(text).not.toContain('declare that question in "waiting" on the implement phase')
})
