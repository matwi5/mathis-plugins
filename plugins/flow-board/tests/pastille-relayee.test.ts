// Stockage : les deux modes (scripts/check.py relance ce fichier dans le mode qu'il n'a pas eu : tests/stockage.ts).

import { expect, mock, test } from 'claude-code/testing'

import { memoryDisk } from './disque-memoire.ts'
import { TOOL, start, world, writeBoard } from './monde-coordination.ts'

import { applyReport, emptyBoard, groupProgress, newRun } from '../hooks/model.ts'
import { applyRelay, relayForGroup, ticketFilesIn, unsureTicketFilesIn } from '../hooks/relay.ts'
import type { Board, Run } from '../types'

// Le 0 de la pastille d'un groupe confié (« ↗C 0/1 ») alors que son worker avait passé le ticket « fait » dans sa
// branche (07/11/2026 : un ticket « fait » dans le worktree du groupe, « ready-for-agent » sur main). Chaque chemin par lequel un worker passe un ticket « fait » est rejoué : le statut relayé, puis la
// pastille que le manager en tire.
// Invariant du ticket : « Le statut relayé d'un ticket est toujours celui du fichier que l'outil du worker vient
// d'écrire ou de nommer, jamais celui d'une autre copie du même ticket ; quand ce fichier ne peut pas être visé avec
// certitude, rien n'est relayé pour lui. »
// Le monde : le moteur résout un chemin relatif sous le dossier de travail de la session (`$.fs`, types du moteur ;
// le faux moteur fait de même) ; la copie posée par son chemin relatif est donc celle de ce dossier, une autre copie
// est posée par son chemin absolu (`/wt/…`, le worktree du groupe).

const T0 = 930_000_000
const REL = 'travail/eco/issues/31-un.md'
const WT = `/wt/${REL}`
const READY = '# 31: Un\n\n**Status:** ready-for-agent\n\n- [ ] critère\n'
const DONE = '# 31: Un\n\n**Status:** fait\n\n- [x] critère\n'

/** La mission du manager : le 31 confié au groupe C, le 32 au groupe D. */
const missionOf = (w: ReturnType<typeof world>): Run => {
  const run = newRun('implement', T0 - 6000, 'Économie')
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const report = { tickets: [{ id: '31', name: 'Un', files: ['a.ts'] }, { id: '32', name: 'Deux', files: ['b.ts'] }], groups: [{ id: 'C', name: 'C', tickets: ['31'] }, { id: 'D', name: 'D', tickets: ['32'] }] }
  const mission = { ...(applyReport(base, report as any, T0 - 5000).board.runs[0] as Run), status: 'active' as const, owner: 'session-B' }
  writeBoard(w, b => ({ ...b, runs: [mission] }))
  return mission
}

/** Le worker du groupe C, délégué ; `here` : la copie du ticket dans le dossier de la session, `there` : celle du worktree. */
const workerOf = async ($: any, on: any, here: string, there: string) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  for (const tool of ['Edit', 'Write', 'Bash']) on('tool.call', { tool: tool as any }, () => ({ result: { text: 'ok', stdout: '' } }))
  const mission = missionOf(w)
  await start($)
  await $.tool.call({ tool: TOOL, delegate: mission.id, group: 'C', main: '[abc123]' } as any)
  w.files[REL] = here
  w.files[WT] = there
  await clock.advance(1000)
  return { w, clock, mission }
}

/** L'entrée de relais du worker, la plus récente de ses deux copies. */
const entryOf = (w: ReturnType<typeof world>, runId: string): any => {
  const file = Object.entries(w.files).find(([path]) => path.endsWith('.entry.json') && path.includes(runId))?.[1]
  const fromFile = file !== undefined ? JSON.parse(file).entry : undefined
  const fromStore = (w.mem[`relay:${runId}:session-A`] as any)?.entry
  return [fromFile, fromStore].filter(Boolean).sort((x, y) => y.at - x.at)[0]
}

/** La pastille que le manager tire de cette entrée : « ↗C <faits>/<total> » (`relayPills`). */
const pillOf = (mission: Run, entry: any): string => {
  const g = { ...mission.groups!.find(x => x.id === 'C')!, linked: { at: T0 - 1, session: 'session-A' } } as any
  const relay = { v: 1 as const, run: mission.id, sessions: entry ? { 'session-A': entry } : {} }
  const { done, total } = groupProgress(mission, g, relayForGroup(relay as any, g, mission.groups))
  return `↗C ${done}/${total}`
}

const relayed = (w: ReturnType<typeof world>, mission: Run) => entryOf(w, mission.id)?.tickets?.['31']?.status

/** L'entrée que le worker a vraiment écrite par `set`, que la pastille du bandeau du manager relit plus bas (ce fichier tourne dans l'ordre). */
const written: Record<string, any> = {}

test('outil Edit sur le chemin absolu du worktree : « fait » relayé, la pastille monte', { timeoutMs: 20000 }, async ($, on) => {
  const { w, mission } = await workerOf($, on, READY, DONE)
  await $.tool.call({ tool: 'Edit', file_path: WT, old_string: 'ready-for-agent', new_string: 'fait' } as any)
  expect(relayed(w, mission)).toBe('done')
  expect(pillOf(mission, entryOf(w, mission.id))).toBe('↗C 1/1')
})

test('outil Write : le texte écrit fait foi, « fait » relayé', { timeoutMs: 20000 }, async ($, on) => {
  const { w, mission } = await workerOf($, on, READY, READY)
  await $.tool.call({ tool: 'Write', file_path: WT, content: DONE } as any)
  expect(relayed(w, mission)).toBe('done')
  expect(pillOf(mission, entryOf(w, mission.id))).toBe('↗C 1/1')
})

test('commande scripts/patch.py au chemin relatif, la session dans le worktree : « fait » relayé', { timeoutMs: 20000 }, async ($, on) => {
  // Le dossier de la session est le worktree : sa copie (le chemin relatif) est la bonne.
  const { w, mission } = await workerOf($, on, DONE, DONE)
  await $.tool.call({ tool: 'Bash', command: `python3 scripts/patch.py ${REL} "**Status:** en cours" "**Status:** fait"` } as any)
  expect(relayed(w, mission)).toBe('done')
  expect(pillOf(mission, entryOf(w, mission.id))).toBe('↗C 1/1')
})

test('commande au chemin absolu, la session dans un autre dossier : la copie nommée, « fait » relayé', { timeoutMs: 20000 }, async ($, on) => {
  const { w, mission } = await workerOf($, on, READY, DONE)
  await $.tool.call({ tool: 'Bash', command: `python3 scripts/patch.py ${WT} "**Status:** en cours" "**Status:** fait"` } as any)
  expect(relayed(w, mission)).toBe('done')
  expect(pillOf(mission, entryOf(w, mission.id))).toBe('↗C 1/1')
})

test('statut envoyé par l’outil flow (set) : « fait » relayé', { timeoutMs: 20000 }, async ($, on) => {
  const { w, mission } = await workerOf($, on, READY, READY)
  await $.tool.call({ tool: TOOL, set: [{ id: '31', status: 'done' }] } as any)
  expect(relayed(w, mission)).toBe('done')
  expect(pillOf(mission, entryOf(w, mission.id))).toBe('↗C 1/1')
  written.set = entryOf(w, mission.id)
})

// ─── Le 0 reproduit : une commande qui change de dossier avant de nommer le ticket par un chemin relatif ───

for (const command of [
  `( cd /wt && python3 scripts/patch.py ${REL} "**Status:** en cours" "**Status:** fait" )`,
  `cd /wt && git add ${REL}`,
  `git -C /wt add ${REL}`,
  `pushd /wt; sed -n 1,5p ${REL}; popd`,
]) {
  test(`« ${command} » : le chemin relatif ne vise pas avec certitude le fichier écrit, rien n’est relayé pour lui`, { timeoutMs: 20000 }, async ($, on) => {
    // La session tourne dans le clone principal (sa copie : « ready-for-agent ») ; le worker a passé le ticket « fait » dans le worktree.
    const { w, mission } = await workerOf($, on, READY, DONE)
    await $.tool.call({ tool: 'Edit', file_path: WT, old_string: 'ready-for-agent', new_string: 'fait' } as any)
    expect(relayed(w, mission)).toBe('done')
    await $.tool.call({ tool: 'Bash', command } as any)
    // Avant le correctif : la copie du clone principal était relue, « à faire » relayé, et la pastille retombait à 0.
    expect(relayed(w, mission)).toBe('done')
    expect(pillOf(mission, entryOf(w, mission.id))).toBe('↗C 1/1')
  })
}

test('un statut passé par une commande qui change de dossier, sans autre geste : rien n’est relayé, le résultat de l’outil le dit, et un set le relaie', { timeoutMs: 20000 }, async ($, on) => {
  const { w, mission } = await workerOf($, on, READY, DONE)
  const out: any = await $.tool.call({ tool: 'Bash', command: `( cd /wt && python3 scripts/patch.py ${REL} "**Status:** en cours" "**Status:** fait" )` } as any)
  expect(relayed(w, mission)).toBeUndefined()
  // Pas en silence : le résultat de l'outil nomme le fichier non relayé et le geste qui le relaie.
  const said = (out?.context ?? []).join('\n')
  expect(said).toContain(REL)
  expect(said).toContain('not relayed')
  expect(said).toContain('"set"')
  await $.tool.call({ tool: TOOL, set: [{ id: '31', status: 'done' }] } as any)
  expect(pillOf(mission, entryOf(w, mission.id))).toBe('↗C 1/1')
})

test('les chemins qu’une commande nomme : relatifs gardés sans changement de dossier, absolus toujours, relatifs écartés après cd, pushd, Set-Location ou -C', () => {
  expect(ticketFilesIn(`sed -i '' 's/a/b/' ${REL}`)).toEqual([REL])
  expect(ticketFilesIn(`python3 scripts/patch.py --coche ${REL} "Le critère"`)).toEqual([REL])
  expect(ticketFilesIn(`cd /wt && sed -i '' 's/a/b/' ${WT}`)).toEqual([WT])
  expect(ticketFilesIn(`git -C C:\\wt add C:\\wt\\travail\\eco\\issues\\31-un.md`)).toEqual(['C:\\wt\\travail\\eco\\issues\\31-un.md'])
  for (const moving of [`cd /wt && sed -n 1p ${REL}`, `( cd /wt && sed -n 1p ${REL} )`, `pushd /wt && sed -n 1p ${REL}`, `Set-Location C:\\wt; Get-Content ${REL}`, `set-location C:\\wt; Get-Content ${REL}`, `git -C /wt add ${REL}`, `make -C /wt ${REL}`, `bash -c 'cd /wt && sed -n 1p ${REL}'`, `git --work-tree=/wt add ${REL}`, `git --git-dir /wt/.git add ${REL}`])
    expect(ticketFilesIn(moving)).toEqual([])
  // Un mot qui contient « cd » ou « -C » sans en être un ne compte pas.
  expect(ticketFilesIn(`abcd ${REL}`)).toEqual([REL])
  expect(ticketFilesIn(`sed -n 1p ${REL} --no-C`)).toEqual([REL])
  // Un changement de dossier appelé comme une méthode, une option -C collée à son dossier, un cd après le chemin : écartés aussi.
  for (const moving of [`python3 -c "import os; os.chdir('/wt'); print(open('${REL}').read())"`, `node -e "process.chdir('/wt'); require('fs').readFileSync('${REL}')"`, `make -C/wt ${REL}`, `sed -i '' 's/a/b/' ${REL} && cd ..`])
    expect(ticketFilesIn(moving)).toEqual([])
  for (const moving of [`env --chdir=/wt sed -n 1p ${REL}`, `sl C:\\wt; Get-Content ${REL}`, `[Environment]::CurrentDirectory = 'C:\\wt'; Get-Content ${REL}`, `grep -C 2 Status ${REL}`])
    expect(ticketFilesIn(moving)).toEqual([])
  // Entre guillemets, en argument d'un programme, par .NET, après une barre oblique inverse, --dir : écartés aussi.
  for (const moving of [`python3 -c "import subprocess; subprocess.run(['git','-C','/wt','add','${REL}'])"`, `python3 -c "import subprocess; subprocess.run(['sed','-n','1p','${REL}'], cwd='/wt')"`, `node -e "require('child_process').execSync('sed -n 1p ${REL}', {cwd: '/wt'})"`, `git "--work-tree=/wt" add ${REL}`, `[System.IO.Directory]::SetCurrentDirectory('C:\\wt'); Get-Content ${REL}`, `\\cd /wt && sed -n 1p ${REL}`, `pnpm --dir /wt exec sed -n 1p ${REL}`])
    expect(ticketFilesIn(moving)).toEqual([])
  // Revue du groupe : cd collé, variables de git, options de dossier d'autres outils, fchdir, -WorkingDirectory.
  for (const moving of [`cd..; Get-Content ${REL}`, `GIT_WORK_TREE=/wt git checkout HEAD -- ${REL}`, `GIT_DIR=/wt/.git git show HEAD:${REL}`, `npm --prefix /wt run x ${REL}`, `docker run --workdir /wt img cat ${REL}`, `Start-Process sed -WorkingDirectory C:\\wt -ArgumentList ${REL}`, `python3 -c "import os; os.fchdir(3); print(open('${REL}').read())"`, `node -e "x({ cwd })" ${REL}`])
    expect(ticketFilesIn(moving)).toEqual([])
  // Un nom de fichier qui contient « cwd » n'est pas un changement de dossier.
  expect(ticketFilesIn('sed -n 1p travail/x/issues/07-cwd-fix.md')).toEqual(['travail/x/issues/07-cwd-fix.md'])
  // Un spécialiste (dossier peut-être à lui) : ses seuls chemins absolus.
  expect(ticketFilesIn(`sed -n 1p ${REL} ${WT}`, false)).toEqual([WT])
  // « -c » n'est pas « -C » : un bash -c sans changement de dossier garde le chemin.
  expect(ticketFilesIn(`bash -c 'sed -n 1p ${REL}'`)).toEqual([REL])
  expect(ticketFilesIn(`echo cdrom ${REL}`)).toEqual([REL])
})

test('un spécialiste qui nomme un ticket par un chemin relatif (son dossier est peut-être un autre worktree) : rien n’est relayé ; par un chemin absolu, oui', { timeoutMs: 20000 }, async ($, on) => {
  const { w, mission } = await workerOf($, on, READY, DONE)
  const out: any = await $.tool.call({ tool: 'Bash', command: `sed -i '' 's/a/b/' ${REL}`, agentId: 'agent-1' } as any)
  expect(relayed(w, mission)).toBeUndefined()
  // Pas en silence : le résultat de son outil le dit.
  expect((out?.context ?? []).join('\n')).toContain(`not relayed: ${REL}`)
  await $.tool.call({ tool: 'Bash', command: `sed -i '' 's/a/b/' ${WT}`, agentId: 'agent-1' } as any)
  expect(relayed(w, mission)).toBe('done')
})

test('le signal ne nomme que de vrais fichiers de tickets locaux', () => {
  expect(unsureTicketFilesIn(`cd /wt && cat myissues/31-un.md ${REL}`)).toEqual([REL])
})

test('cause 2, reproduite et non corrigée : une commande qui ne nomme pas le fichier (patch.py --lot) ne relaie rien pour lui ; set le relaie', { timeoutMs: 20000 }, async ($, on) => {
  const { w, mission } = await workerOf($, on, DONE, DONE)
  await $.tool.call({ tool: 'Bash', command: 'python3 scripts/patch.py --lot /tmp/lot-31.txt' } as any)
  expect(relayed(w, mission)).toBeUndefined()
  expect(pillOf(mission, entryOf(w, mission.id))).toBe('↗C 0/1')
  await $.tool.call({ tool: TOOL, set: [{ id: '31', status: 'done' }] } as any)
  expect(pillOf(mission, entryOf(w, mission.id))).toBe('↗C 1/1')
})

test('l’id du fichier se rapproche de celui du lot : « 31 », « 031 » et « #31 » désignent le même ticket (cause 3 écartée)', () => {
  const run = { ...newRun('implement', T0, 'Économie') } as Run
  const base: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  for (const id of ['31', '#31', '031']) {
    const report = { tickets: [{ id, name: 'Un', files: ['a.ts'] }, { id: '32', name: 'Deux', files: ['b.ts'] }], groups: [{ id: 'C', name: 'C', tickets: [id] }, { id: 'D', name: 'D', tickets: ['32'] }] }
    const mission = applyReport(base, report as any, T0).board.runs[0] as Run
    const entry = applyRelay(undefined, mission.id, 'session-A', { kind: 'tickets', changes: [{ id: '31', status: 'done' }] }, T0 + 1)!.sessions['session-A']
    expect(pillOf(mission, entry)).toBe('↗C 1/1')
  }
})

// ─── Chez le manager : la pastille du bandeau lit le statut relayé ───

const PLUGIN = 'flow-board'
const bandAt = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} } } as const
const PANE = { component: 'Pane', requestId: 'flow-board', props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} } } as const

for (const [path, pill] of [['set', '↗C.1/1'], ['todo', '↗C.0/1']] as const) {
  test(`chez le manager, l’entrée de session du worker (${path}) : la pastille du bandeau dit ${pill.replace('.', ' ')}`, { timeoutMs: 30000 }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    memoryDisk(on)
    const mem: Record<string, unknown> = {}
    on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
    on('session.id', () => ({ value: 'session-M' }))
    on('session.repo', () => ({ value: null }))
    on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
    on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
      mem[e.key] = JSON.parse(JSON.stringify(e.value))
      return { value: undefined }
    })
    on('store.keys', () => ({ value: Object.keys(mem) }))
    on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
    on('command.list', () => ({ value: [] }))
    on('tool.call', { tool: 'mcp__ccd_session__start_session' }, () => ({ result: { text: 'Started session local_C42.' } }))
    on('prompt.fill', () => ({ isFilled: true }))
    await $.session.start({ cwd: '', surface: null, isInteractive: true })
    await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
    await $.tool.call({ tool: TOOL, title: 'Économie', tickets: [{ id: '31', name: 'Un', files: ['a.ts'] }, { id: '32', name: 'Deux', files: ['b.ts'] }], groups: [{ id: 'C', name: 'Un', tickets: ['31'] }, { id: 'D', name: 'Deux', tickets: ['32'] }] } as any)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
    await ui.press({ key: 'launch-linked-C' })
    await ui.unmount()
    await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 'Économie › Groupe C · Un', prompt: 'x' } as any)
    for (let i = 0; i < 2; i++) await clock.advance(1000)
    const runId = (mem['board:'] as Board).runs.find(r => r.title === 'Économie')!.id
    // L'entrée telle que le worker l'a écrite plus haut (son groupe, ses tickets relayés), posée à sa clé de session, que
    // le manager relit et fusionne (`readRelay`) ; seules ses dates suivent ce monde (après l'envoi du groupe).
    const kept = path === 'todo' ? applyRelay(undefined, runId, 'fille', { kind: 'tickets', changes: [{ id: '31', status: 'todo' }] }, T0)!.sessions.fille : written[path]
    if (kept === undefined) throw new Error(`entrée du worker « ${path} » absente : le test qui l'écrit n'a pas tourné avant`)
    const entry = { ...kept, group: 'C', startedAt: T0 + 1500, at: T0 + 1600 }
    mem[`relay:${runId}:fille`] = { v: 1, run: runId, session: 'fille', entry }
    for (let i = 0; i < 6; i++) await clock.advance(1000)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...bandAt })
    await band.drawn()
    expect(await band.find({ type: 'Text', text: new RegExp(`^${pill}$`) })).toBeDefined()
    await band.unmount()
  })
}
