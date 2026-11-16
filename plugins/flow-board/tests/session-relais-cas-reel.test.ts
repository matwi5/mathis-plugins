import { expect, mock, test } from 'claude-code/testing'
import { memoryDisk } from './disque-memoire.ts'

import { applyRelay } from '../hooks/relay.ts'
import type { Board } from '../types'

// Le cas du 13/11/2026 (le groupe A d'une mission à deux groupes, en auto), rejoué dans le moteur avec des valeurs de la
// forme réelle : un lancement `claude --bg … 2>&1 | tail -3` dont la sortie ne garde que « claude attach », « claude
// logs » et « claude stop » (sans la ligne « backgrounded »), l'entrée de relais du worker commencée 36 s après
// l'envoi et déclarant le groupe « A » (un UUID en minuscules), ses statuts relayés pendant l'envoi, puis son retour.
// La session est notée d'après cette entrée et le reste au retour. Elle ne l'avait pas été parce que le mod qui tournait
// dans la discussion du manager était le 0.83.0, d'avant ce filet : rouge sur ce code
// (`scripts/check.sh --test <ce fichier> --contre 6e0c16e2 flow-board`, le commit de la 0.83.0), vert depuis la 0.84.0.

const TOOL = 'mcp__flow-board__flow'
const PLUGIN = 'flow-board'
const KEY = 'board:'
// L'envoi du 13/11 à 09:41:06.488 ; l'entrée du worker commencée à 09:41:42.484.
const ENVOI = 1_794_559_266_488
const DEBUT_WORKER = ENVOI + 35_996
// Un id complet de la forme qu'écrit le relais (le sessionId, un UUID en minuscules) ; `claude --bg` en montre 8 signes.
const SESSION = 'c7a14d02-58e3-4f6b-9d21-3e8b0a5f7c19'

const PLAN = {
  tickets: [
    { id: '01', name: 'Drapeau « Jugement » d’un ticket' },
    { id: '02', name: 'Opus xhigh pendant un ticket de jugement' },
    { id: '05', name: 'Explorateur en Haiku xhigh' },
  ],
  groups: [
    { id: 'A', name: 'Le mod : drapeau, xhigh par ticket, lancement, cadrage', tickets: ['01', '02'] },
    { id: 'B', name: 'Auto, compte rendu et réglages', tickets: ['05'] },
  ],
}

/** Le moteur sous le plugin : un stockage en mémoire, un shell qui répond comme `claude --bg … | tail -3` le 13/11. */
const world = (on: any) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-manager' }))
  on('session.repo', () => ({ value: { root: 'C:/proj', remote: null, internal: false, name: null } }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(mem) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => ({ value: undefined }))
  // Les trois dernières lignes de la sortie de `claude --bg`, telles que le 13/11 : la ligne « backgrounded » n'y est plus.
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '  claude attach c7a14d02    open in this terminal\n  claude logs c7a14d02      show recent output\n  claude stop c7a14d02      stop this session\n' },
  }))
  return { mem }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

const groupA = (mem: Record<string, unknown>, runId: string) => (mem[KEY] as Board).runs.find(r => r.id === runId)!.groups!.find(g => g.id === 'A')!

test('le cas du 13/11 : sortie coupée par | tail -3, la session du groupe A vient de son entrée de relais et reste au retour', async ($, on) => {
  const clock = mock.clock(on, { now: ENVOI })
  memoryDisk(on)
  const { mem } = world(on)
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Répartition des modèles et efforts', ...PLAN } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'flow-board', props: { title: 'Mission', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} } } as any)
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  await $.tool.call({
    tool: 'Bash',
    command: `test -s '/tmp/flow-board-brief-A.md' && claude --bg -n 'Répartition des modèles et… > Groupe A · Le mod' --effort high --permission-mode auto -w 'groupe-repartition-des-A' "$(cat '/tmp/flow-board-brief-A.md' '/tmp/ajout-A.md')" 2>&1 | tail -3`,
  } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const runId = (mem[KEY] as Board).runs.find(r => r.title === 'Répartition des modèles et efforts')!.id
  expect(groupA(mem, runId).linked?.session).toBeUndefined()
  // Le worker s'est déclaré 36 s après l'envoi (son appel delegate), puis a relayé le statut de son premier ticket :
  // l'horloge du manager arrive d'abord à ces dates, comme le 13/11.
  await clock.advance(DEBUT_WORKER + 2_000 - ENVOI - 6_000)
  const started = applyRelay(null, runId, SESSION, { kind: 'start', group: 'A' }, DEBUT_WORKER)!
  const relay = applyRelay(started, runId, SESSION, { kind: 'tickets', changes: [{ id: '01', status: 'done' }] }, DEBUT_WORKER + 1_000) ?? started
  mem[`relay:${runId}:${SESSION}`] = { v: 1, run: runId, session: SESSION, entry: relay.sessions[SESSION] }
  for (let i = 0; i < 12; i++) await clock.advance(1000)
  expect(groupA(mem, runId).linked?.session).toBe('c7a14d02')
  expect(groupA(mem, runId).linked?.sessionClash).toBeUndefined()
  // Rendu : l'id noté part avec le retour, celui que la fermeture passe à claude stop et claude rm.
  await $.tool.call({ tool: TOOL, set: [{ id: '01', status: 'done' }, { id: '02', status: 'done' }], returned: ['A'] } as any)
  for (let i = 0; i < 3; i++) await clock.advance(1000)
  expect(groupA(mem, runId).delegated?.session).toBe('c7a14d02')
})
