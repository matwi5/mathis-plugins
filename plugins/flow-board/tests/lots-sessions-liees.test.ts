import { expect, mock, test } from 'claude-code/testing'

import {
  activeRun,
  applyReport,
  applyRelay,
  applySkill,
  backgroundLaunches,
  cancelLinkedGroup,
  currentPhase,
  detachOnLoad,
  emptyBoard,
  groupPlan,
  linkGroupSession,
  markDecisionsSeen,
  mergeBoards,
  newRun,
  relayForGroup,
  countTickets,
  decidedFileText,
  openBlockers,
  startLinkedGroups,
  suggestionsFor,
  withRelay,
} from '../hooks/model.ts'
import type { Board } from '../types'

const PLUGIN = 'flow-board'
const TOOL = 'mcp__flow-board__flow'
const START = 'mcp__ccd_session__start_session'
const KEY = 'board:'
const PANE = {
  component: 'Pane',
  requestId: 'flow-board',
  props: { title: 'Parcours', isFocused: false, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 140 }, view: {} },
} as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

/** Un parcours actif dans la discussion `session`, après un appel de l'outil `flow`. */
const boardWith = (input: Record<string, unknown>, session = 's'): Board => {
  const run = { ...newRun('implement', 1_000, 'Lot'), owner: session }
  const board: Board = { ...emptyBoard('', 'p'), session, deleted: [], runs: [run], activeId: run.id }
  return applyReport(board, input, 2_000).board
}
const planOf = (board: Board) => groupPlan(activeRun(board)!)!
const viewOf = (board: Board, id: string) => planOf(board).groups.find(g => g.group.id === id)!

// Un tableau de bord de ventes : A et C partagent le dossier des tables, A, C et D la page Commandes ;
// B attend le Statut de commande de C, sauf son export qui peut partir ; E ne fait que des requêtes.
const VENTES = {
  tickets: [
    { id: 'a1', name: 'Séparer la synchro', files: ['pbi/model/tables/ventes.tmdl'] },
    { id: 'a2', name: 'Filtre Canal de vente', blockedBy: ['a1'], files: ['pbi/report/pages/commandes', 'pbi/report/pages/geographie'] },
    { id: 'c1', name: 'Statut de commande', files: ['pbi/report/pages/commandes'] },
    { id: 'b1', name: 'Export des retours', files: ['travail/regles'] },
    { id: 'b2', name: 'Changement de transporteur', blockedBy: ['c1'] },
    { id: 'd1', name: 'Délai de livraison', files: ['pbi/report/pages/commandes'] },
    { id: 'e1', name: 'Enquête transporteur', files: ['travail/sql'] },
  ],
  groups: [
    { id: 'A', name: 'Synchro', tickets: ['a1', 'a2'], continuesHere: true },
    { id: 'C', name: 'Statut de commande', tickets: ['c1'], files: ['pbi/model/tables'] },
    { id: 'B', name: 'Règles', tickets: ['b1', 'b2'] },
    { id: 'D', name: 'Commandes', tickets: ['d1'] },
    { id: 'E', name: 'Enquêtes', tickets: ['e1'] },
  ],
}

test('les fichiers des tickets comptent : le lot garde A ∥ E, et chaque groupe écarté dit pourquoi', () => {
  const board = boardWith(VENTES)
  const plan = planOf(board)
  expect(plan.parallelBatch).toEqual(['A', 'E'])
  // Le dossier de C contient la table de A ; la page de D est aussi celle d'un ticket de A.
  expect(viewOf(board, 'C').conflicts).toEqual([{ with: 'A', on: 'tables' }])
  expect(viewOf(board, 'D').conflicts).toEqual([{ with: 'A', on: 'commandes' }])
  expect(viewOf(board, 'E').conflicts).toEqual([])
  // D'autres lots, ouverts chacun par un groupe écarté.
  expect(plan.otherBatches).toEqual([
    ['C', 'E'],
    ['D', 'E'],
  ])
  // B attend C, mais son export n'attend rien : il peut partir seul.
  const b = viewOf(board, 'B')
  expect(b.state).toBe('waiting')
  expect(b.readyNow.map(t => t.id)).toEqual(['b1'])
  // Un ticket fait ne retient plus personne : A fini, D n'est plus retenu que par C (même page).
  const later = applyReport(board, { set: [{ id: 'a1', status: 'done' }, { id: 'a2', status: 'done' }] }, 3_000).board
  expect(planOf(later).parallelBatch).toEqual(['C', 'E'])
  expect(viewOf(later, 'D').conflicts).toEqual([{ with: 'C', on: 'commandes' }])
})

test('Claude est prévenu quand un dossier déclaré couvre les fichiers d’un autre groupe', () => {
  const run = { ...newRun('implement', 1_000), owner: 's' }
  const board: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [], runs: [run], activeId: run.id }
  const answer = applyReport(board, VENTES, 2_000).text
  expect(answer).toMatch(/C declares the folder "pbi\/model\/tables", which covers A's "pbi\/model\/tables\/ventes\.tmdl"/)
  expect(answer).toMatch(/list the files the group really touches instead, unless it creates files in that folder/)
})

test('une ressource commune (une appli pilotée à l’écran) empêche le parallèle, sans fichier commun', () => {
  const board = boardWith({
    tickets: [
      { id: 'p1', name: 'Page' },
      { id: 'q1', name: 'Mesure' },
      { id: 'r1', name: 'Requête' },
    ],
    groups: [
      { id: 'P', name: 'Pages', tickets: ['p1'], files: ['pages'], resources: ['PowerBI Desktop'] },
      { id: 'Q', name: 'Mesures', tickets: ['q1'], files: ['tables'], resources: ['powerbi  desktop', 'PowerBI Desktop'] },
      { id: 'R', name: 'Requêtes', tickets: ['r1'], files: ['sql'] },
    ],
  })
  const plan = planOf(board)
  expect(plan.parallelBatch).toEqual(['P', 'R'])
  expect(viewOf(board, 'Q').group.resources).toEqual(['powerbi desktop'])
  expect(viewOf(board, 'Q').conflicts).toEqual([{ with: 'P', on: 'PowerBI Desktop' }])
  expect(plan.otherBatches).toEqual([['Q', 'R']])
})

const THREE = {
  tickets: [
    { id: 'p1', name: 'Un' },
    { id: 'q1', name: 'Deux' },
    { id: 'r1', name: 'Trois', files: ['a/x.ts'] },
  ],
  groups: [
    { id: 'P', name: 'Pe', tickets: ['p1'], files: ['a'] },
    { id: 'Q', name: 'Qu', tickets: ['q1'], files: ['b'] },
    { id: 'R', name: 'Er', tickets: ['r1'] },
  ],
}

test('un groupe confié à une session liée : hors des lots, il retient ceux qui touchent ses fichiers', () => {
  const sent = startLinkedGroups(boardWith(THREE), ['P'], 3_000)!.board
  const plan = planOf(sent)
  expect(plan.delegated).toEqual(['P'])
  expect(plan.busy).toEqual([])
  expect(viewOf(sent, 'P').isDelegated).toBe(true)
  // R touche un fichier du dossier de P : il attend ; Q reste seul, donc pas de lot.
  expect(viewOf(sent, 'R').conflicts).toEqual([{ with: 'P', on: 'a' }])
  expect(plan.parallelBatch).toEqual([])
  // Déjà confié : pas une deuxième fois.
  expect(startLinkedGroups(sent, ['P'], 3_100)).toBeNull()

  // Deux groupes en attente de session : le titre dit lequel ; sans titre, on ne devine pas.
  const both = startLinkedGroups(sent, ['Q'], 3_200)!.board
  expect(linkGroupSession(both, 'Revue', 'local_x', 3_300)).toBeNull()
  const linked = linkGroupSession(both, 'Groupe Q · Qu', 'local_q', 3_300)!.board
  expect(activeRun(linked)!.groups!.find(g => g.id === 'Q')!.linked).toEqual({ at: 3_200, session: 'local_q' })
  // Le titre du parcours en tête peut nommer un autre groupe : seule compte la partie après « › ».
  const prefixed = linkGroupSession(both, 'Revue du groupe P › Groupe Q · Qu', 'local_q2', 3_300)!.board
  expect(activeRun(prefixed)!.groups!.find(g => g.id === 'Q')!.linked?.session).toBe('local_q2')
  expect(activeRun(prefixed)!.groups!.find(g => g.id === 'P')!.linked?.session).toBeUndefined()
  expect(linkGroupSession(both, 'Revue du groupe P › Bug · Erreur', 'local_b', 3_300)).toBeNull()
  // Plus qu'un groupe en attente : il prend la session suivante.
  const all = linkGroupSession(linked, 'Session', 'local_p', 3_400)!.board
  expect(activeRun(all)!.groups!.find(g => g.id === 'P')!.linked?.session).toBe('local_p')

  // Annuler : seulement avant le lancement.
  expect(cancelLinkedGroup(all, 'P', 3_500)).toBeNull()
  const undone = cancelLinkedGroup(both, 'P', 3_500)!.board
  expect(viewOf(undone, 'P').isDelegated).toBe(false)

  // Un plan renvoyé garde les sessions liées ; « returned » rend le groupe.
  const resent = applyReport(all, { groups: THREE.groups }, 4_000).board
  expect(viewOf(resent, 'Q').isDelegated).toBe(true)
  const back = applyReport(resent, { set: [{ id: 'q1', status: 'done' }], returned: ['Q', 'Z'] }, 5_000)
  expect(activeRun(back.board)!.groups!.find(g => g.id === 'Q')!.linked).toBeUndefined()
  expect(back.text).toMatch(/returned: no group in a linked session among Z/)
})

test('« cette discussion » est celle qui a envoyé le plan', () => {
  const board = boardWith(VENTES, 'session-de-decoupage')
  expect(viewOf(board, 'A').group).toMatchObject({ continuesHere: true, continuesIn: 'session-de-decoupage' })
  expect(viewOf(board, 'C').group.continuesIn).toBeUndefined()
})

test('une session déléguée n’ouvre ni ne reprend aucun parcours, et n’écrit rien', () => {
  const main = boardWith(THREE, 'main')
  const runId = activeRun(main)!.id
  // La session liée lit le stockage : le parcours y est actif dans la discussion principale.
  const loaded = detachOnLoad({ ...main, session: 'main' }, 3_000, 'linked')
  // Un parcours absent d'ici (session dans un worktree, qui a son propre fichier) : déléguée quand même.
  const away = applyReport(loaded, { delegate: 'inconnu' }, 3_100, { delegateTitle: 'Boutique' })
  expect(away.board.delegate).toEqual({ run: 'inconnu', at: 3_100, title: 'Boutique' })
  expect(away.text).toMatch(/works for the workflow "Boutique".*not on this folder's dashboard/)
  expect(applyReport(loaded, { delegate: 'inconnu' }, 3_100).text).toMatch(/works for the workflow "inconnu"/)
  const out = applyReport(loaded, { delegate: runId }, 3_100)
  expect(out.board.delegate).toEqual({ run: runId, at: 3_100 })
  expect(out.text).toMatch(/This discussion works for the workflow "Lot", which stays in the main discussion/)
  const delegated = out.board
  // Ses skills ne touchent à rien, même longtemps après (pas de reprise d'un parcours « abandonné »).
  expect(applySkill(delegated, 'mattpocock-skills:implement', { now: 99_000_000, isMain: true })).toBeNull()
  expect(applySkill(delegated, 'mattpocock-skills:code-review', { now: 99_000_000, isMain: true })).toBeNull()
  // Ses rapports non plus.
  const report = applyReport(delegated, { step: 'read', tickets: [{ id: 'x9', name: 'Nouveau' }] }, 3_200)
  expect(report.board).toBe(delegated)
  expect(report.text).toMatch(/relayed to the main discussion's dashboard on its own/)
  expect(report.text).not.toMatch(/Do not call this tool again/)
  // Un `set` part au relais (écrit par l'enregistrement), jamais sur le parcours.
  const relayed = applyReport(delegated, { set: [{ id: 'p1', status: 'done' }] }, 3_250)
  expect(relayed.board).toBe(delegated)
  expect(relayed.text).toMatch(/^Relayed to the main discussion's dashboard: 1 ticket status/)
  // Le groupe déclaré est gardé avec la délégation.
  expect(applyReport(loaded, { delegate: runId, group: 'P' }, 3_100).board.delegate).toEqual({ run: runId, at: 3_100, group: 'P' })
  // Propre à la discussion : gardé à la fusion, jamais repris du stockage.
  expect(mergeBoards(delegated, main).delegate).toEqual({ run: runId, at: 3_100 })
  expect(detachOnLoad(delegated, 3_300, 'other').delegate).toBeUndefined()
})

test('une session déléguée garde l’adresse de la discussion principale et la rappelle à chaque réponse', () => {
  const main = boardWith(THREE, 'main')
  const runId = activeRun(main)!.id
  const loaded = detachOnLoad({ ...main, session: 'main' }, 3_000, 'linked')
  // Sans adresse : la réponse renvoie au nom et à la référence du brief, sans rien inventer.
  const bare = applyReport(loaded, { delegate: runId, group: 'P' }, 3_100)
  expect(bare.text).toMatch(/Reach the main discussion by the name and \[ref\] your brief gives/)
  // Avec l'adresse « <nom> [ref] » : gardée, et rappelée à la déclaration comme aux relais.
  const out = applyReport(loaded, { delegate: runId, group: 'P', main: 'Lot SC [05e2f6]' }, 3_100)
  expect(out.board.delegate).toEqual({ run: runId, at: 3_100, group: 'P', main: 'Lot SC [05e2f6]' })
  expect(out.text).toMatch(/Reach the main discussion, "Lot SC \[05e2f6\]"/)
  expect(out.text).toMatch(/call ListAgents, find the row whose \[ref\] is the one your brief gives, and send to that row's "<name> \[ref\]" exactly as listed/)
  const relayed = applyReport(out.board, { set: [{ id: 'p1', status: 'done' }] }, 3_200)
  expect(relayed.board).toBe(out.board)
  expect(relayed.text).toMatch(/Nothing else of this call was recorded\. Reach the main discussion, "Lot SC \[05e2f6\]"/)
})

// ─── Panneau ──────────────────────────────────────────────────────────────

/** Le moteur sous le plugin, avec un stockage en mémoire et une discussion « session-A ». */
const world = (on: any, opts: { repo: boolean }) => {
  const mem: Record<string, unknown> = {}
  on('skill.prompt', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as const)
  on('session.id', () => ({ value: 'session-A' }))
  on('session.repo', () => ({ value: opts.repo ? { root: 'C:/proj', remote: null, internal: false, name: null } : null }))
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  // L'app répond au lancement d'une session liée avec son id, tiré du groupe que le titre nomme.
  on('tool.call', { tool: START }, (_$: unknown, e: { title: string }) => ({
    result: { text: `Started session local_${/Groupe (\w+)/.exec(e.title)?.[1] ?? 'x'}42.` },
  }))
  const filled: string[] = []
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  return { mem, filled }
}
const start = ($: any) => $.session.start({ cwd: '', surface: null, isInteractive: true })

test('sans git : les lots partent en sessions liées, pas par /implement-spec ; raisons et autres lots affichés', async ($, on) => {
  const clock = mock.clock(on, { now: 70_000_000 })
  const { mem, filled } = world(on, { repo: false })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...VENTES } as any)

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'launch-parallel' })).toBeUndefined()
  expect(String((await ui.find({ key: 'launch-parallel-linked' }))?.props.label)).toMatch(/^⇉.A ∥ E en parallèle · sessions liées$/)
  expect(await ui.find({ type: 'Text', text: /\/implement-spec demande un dépôt git/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^∦.A.:.tables$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Autres lots possibles :$/ })).toBeDefined()
  expect(String((await ui.find({ key: 'launch-parallel-linked-1' }))?.props.label)).toMatch(/^⇉.C ∥ E en parallèle · sessions liées$/)
  expect(await ui.find({ key: 'launch-parallel-1' })).toBeUndefined()
  // « Cette discussion » : celle qui a envoyé le plan, ici.
  expect(await ui.find({ type: 'Text', text: /cette.discussion/ })).toBeDefined()

  // B attend C, mais son export peut partir seul.
  await ui.press({ key: 'launch-ready-B' })
  expect(filled.at(-1)).toBe('/mattpocock-skills:implement Groupe B (Règles), tickets déjà prêts, un par un et dans cet ordre : 1) b1 — Export des retours')

  // Un autre lot, en sessions liées : une session par groupe, le parcours reste ici.
  await ui.press({ key: 'launch-parallel-linked-1' })
  const text = filled.at(-1)!
  expect(text).toMatch(/^Confie chacun de ces groupes à sa session liée, en parallèle, pour le parcours « Boutique » : Groupe C \(Statut de commande\) : 1\) c1 — Statut de commande ∥ Groupe E \(Enquêtes\) : 1\) e1 — Enquête transporteur\./)
  expect(text).toMatch(/Puis lance une session par groupe, avec un titre qui commence par « Boutique › Groupe <id> · »/)
  expect(text).toMatch(/start_session une fois par groupe, avec initiation user_asked/)
  expect(text).toMatch(/puis lance chaque session par le shell : claude --bg -n "Boutique › Groupe <id> · <thème>" --effort <effort>/)
  // Plusieurs groupes : l'effort se choisit groupe par groupe.
  expect(text).toContain("Effort de chaque session (<effort>, choisi groupe par groupe) : medium par défaut ; high si son groupe a un ticket qui touche une zone sensible")
  expect(text).toContain("Dis-moi en une ligne l'effort choisi pour chaque groupe et pourquoi.")
  expect(text).toMatch(/use_worktree false \(ce dossier n’a pas de git\)/)
  expect(text).toMatch(/, ce que font les autres sessions en même temps/)
  expect(text).toMatch(/suivre les sessions sans les attendre activement/)
  expect(await ui.find({ key: 'launch-group-C' })).toBeUndefined()
  expect(await ui.find({ key: 'launch-group-E' })).toBeUndefined()
  await ui.unmount()

  // Deux sessions lancées, dans un ordre quelconque : chacune va au groupe que son titre nomme.
  await $.tool.call({ tool: START, title: 'Groupe E · Enquêtes', prompt: 'x' } as any)
  await $.tool.call({ tool: START, title: 'Groupe C · Statut de commande', prompt: 'x' } as any)
  const answer = await $.tool.call({ tool: TOOL } as any)
  expect(JSON.stringify(answer)).not.toMatch(/works for the workflow/)
  const ui2 = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui2.find({ type: 'Text', text: /C, E en session liée/ })).toBeDefined()
  expect(await ui2.find({ type: 'Text', text: /session.liée.à.lancer/ })).toBeUndefined()
  await ui2.unmount()
  // Enregistré (l'écriture est différée de quelques secondes).
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const run = (mem[KEY] as Board).runs.find(r => r.title === 'Boutique')
  expect(run?.groups?.filter(g => g.linked).map(g => `${g.id}:${g.linked!.session}`)).toEqual(['C:local_C42', 'E:local_E42'])
})

test('dans un dépôt git, chaque lot propose aussi /implement-spec', async ($, on) => {
  mock.clock(on, { now: 71_000_000 })
  const { filled } = world(on, { repo: true })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...VENTES } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'launch-parallel' })).toBeDefined()
  await ui.press({ key: 'launch-parallel-2' })
  await ui.unmount()
  expect(filled.at(-1)).toMatch(/^\/mattpocock-skills:implement-spec Groupes en parallèle, .* Groupes : D \(Commandes\) : 1\) d1 — Délai de livraison ∥ E \(Enquêtes\)/)
})

test('la session liée se déclare : son panneau le dit, ses skills ne lancent aucun parcours', async ($, on) => {
  const clock = mock.clock(on, { now: 72_000_000 })
  const { mem } = world(on, { repo: false })
  // La discussion principale (B) a écrit son parcours, actif chez elle.
  const main = boardWith({ title: 'Boutique', ...VENTES }, 'session-B')
  mem[KEY] = main
  const runId = activeRun(main)!.id
  await start($)

  const answer = await $.tool.call({ tool: TOOL, delegate: runId } as any)
  expect(JSON.stringify(answer)).toMatch(/works for the workflow/)
  // Le skill chargé ensuite n'ouvre rien : pas de consigne du tableau de bord ajoutée.
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'brief' })
  expect(note.text).toBe('brief')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Session.liée du parcours « Lot »/ })).toBeDefined()
  await ui.unmount()
  // Après l'écriture différée : toujours le seul parcours de la discussion principale.
  await $.tool.call({ tool: TOOL, tickets: [{ id: 'x9', name: 'Nouveau' }] } as any)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const stored = mem[KEY] as Board
  expect(stored.runs.map(r => r.id)).toEqual([runId])
  expect(stored.runs[0]!.tickets.some(t => t.id === 'x9')).toBe(false)
})

test('vu d’une autre discussion, le groupe « continue ici » dit « discussion de découpage » et garde sa session liée', async ($, on) => {
  mock.clock(on, { now: 73_000_000 })
  const { mem } = world(on, { repo: false })
  const elsewhere = boardWith({ title: 'Boutique', ...VENTES }, 'session-B')
  // Mise de côté dans la discussion de découpage : une autre peut la reprendre.
  mem[KEY] = { ...elsewhere, runs: elsewhere.runs.map(r => ({ ...r, status: 'paused', owner: undefined })) }
  await start($)
  await $.tool.call({ tool: TOOL, resume: activeRun(elsewhere)!.id } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /discussion.de.découpage/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cette.discussion/ })).toBeUndefined()
  expect(await ui.find({ key: 'launch-linked-A' })).toBeDefined()
  await ui.unmount()
})

// ─── Sessions liées lancées par le CLI (claude --bg) ──────────────────────

test('claude --bg : l’id et le titre affichés sont relevés, seulement pour un vrai lancement', () => {
  const out = 'Starting background service…\nbackgrounded · 60481870 · Groupe A · Synchro\r\n  claude agents             list sessions\n  claude attach 60481870    open in this terminal\n'
  expect(backgroundLaunches('claude --bg -n "Groupe A · Synchro" -w groupe-a "$(cat /tmp/brief-a.txt)"', out)).toEqual([{ id: '60481870', title: 'Groupe A · Synchro' }])
  // Deux lancements dans une commande ; un point médian déformé par la page de code.
  const two = 'backgrounded · 60481870 · Groupe A · Synchro\nbackgrounded Â· 4c9ac344 Â· Groupe B · Règles\n'
  expect(backgroundLaunches('claude --background -n "Groupe A · Synchro" "a" && claude.exe --bg -n "Groupe B · Règles" "b"', two)).toEqual([
    { id: '60481870', title: 'Groupe A · Synchro' },
    { id: '4c9ac344', title: 'Groupe B · Règles' },
  ])
  // Une sortie relue (grep, cat) ou une commande qui ne fait que citer claude --bg : rien.
  expect(backgroundLaunches('grep backgrounded journal.txt', out)).toEqual([])
  expect(backgroundLaunches('echo "claude --bg"', out)).toEqual([])
  expect(backgroundLaunches('claude agents --json', out)).toEqual([])
})

test('dans le CLI : la session lancée par claude --bg va au groupe que son titre nomme, et « Annuler » disparaît', async ($, on) => {
  const clock = mock.clock(on, { now: 74_000_000 })
  const { mem, filled } = world(on, { repo: true })
  // Le shell répond comme claude --bg : une ligne par session lancée.
  on('tool.call', { tool: 'Bash' }, (_$: unknown, e: { command: string }) => ({
    result: { stdout: `backgrounded · 9f3e21aa · ${/-n "([^"]+)"/.exec(e.command)?.[1] ?? ''}\n  claude attach 9f3e21aa    open in this terminal\n` },
  }))
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...VENTES } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  // Dans un dépôt git, la session du CLI a son worktree, et rend sa branche.
  expect(filled.at(-1)).toContain('claude --bg -n "Boutique › Groupe <id> · <thème>" --effort <effort> -w groupe-<id> (un worktree à elle) "<prompt>"')
  expect(filled.at(-1)).toMatch(/les fichiers modifiés, sa branche, les contrôles lancés/)
  expect(await ui.find({ key: 'group-linked-cancel-E' })).toBeDefined()
  await ui.unmount()

  // Une commande qui n'est pas un lancement ne relie rien ; le lancement, si.
  await $.tool.call({ tool: 'Bash', command: 'claude agents --json -n "Groupe E · Enquêtes"' } as any)
  let ui2 = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui2.find({ key: 'group-linked-cancel-E' })).toBeDefined()
  await ui2.unmount()
  await $.tool.call({ tool: 'Bash', command: 'claude --bg -n "Boutique › Groupe E · Enquêtes" -w groupe-e "$(cat /tmp/brief-e.txt)"' } as any)
  ui2 = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui2.find({ key: 'group-linked-cancel-E' })).toBeUndefined()
  expect(await ui2.find({ type: 'Text', text: /E en session liée/ })).toBeDefined()
  await ui2.unmount()
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const run = (mem[KEY] as Board).runs.find(r => r.title === 'Boutique')
  expect(run?.groups?.find(g => g.id === 'E')?.linked?.session).toBe('9f3e21aa')
})

test('le titre d’une session liée commence par le titre du parcours, raccourci et sans guillemets', async ($, on) => {
  mock.clock(on, { now: 74_000_000 })
  const { filled } = world(on, { repo: true })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Tickets lots, espace privé, "prompts" et $variantes', ...VENTES } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  expect(filled.at(-1)).toContain('avec un titre qui commence par « Tickets lots, espace privé… › Groupe <id> · »')
  expect(filled.at(-1)).toContain('claude --bg -n "Tickets lots, espace privé… › Groupe <id> · <thème>" --effort <effort> -w groupe-<id>')
  // Dans un dépôt git, le relecteur de sécurité a pour seul périmètre le diff de la branche.
  expect(filled.at(-1)).toContain("avec pour seul périmètre git diff <base>..HEAD (<base> : le commit d'où part sa branche)")
  expect(filled.at(-1)).not.toMatch(/la base de sa branche/)
  // Avec git, le point fixe des revues reste le commit : pas de copies.
  expect(filled.at(-1)).toContain("sur les seuls changements du ticket (point fixe : le commit d'avant le ticket), même pour un petit diff")
  expect(filled.at(-1)).toContain("sur le même périmètre (point fixe : le commit d'avant le ticket)")
  expect(filled.at(-1)).toContain('sur sa branche face à sa base')
  expect(filled.at(-1)).not.toMatch(/copie/)
})

test('une session liée dans un worktree se déclare quand même : le titre vient du board du dépôt principal', async ($, on) => {
  mock.clock(on, { now: 75_000_000 })
  const { mem } = world(on, { repo: true })
  // Sa racine est celle du worktree ; le parcours vit dans le board du dépôt principal.
  on('session.root', () => ({ value: 'C:/proj/.claude/worktrees/groupe-e' }))
  const main = { ...boardWith({ title: 'Boutique', ...VENTES }, 'session-B'), root: 'C:/proj' }
  mem['board:c:/proj'] = main
  const runId = activeRun(main)!.id
  await start($)

  const answer = JSON.stringify(await $.tool.call({ tool: TOOL, delegate: runId } as any))
  expect(answer).toMatch(/works for the workflow \\"Lot\\"/)
  expect(answer).toMatch(/not on this folder's dashboard/)
  // Ses skills n'ouvrent aucun parcours dans le board du worktree.
  const note = await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'brief' })
  expect(note.text).toBe('brief')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Session.liée du parcours « Lot »/ })).toBeDefined()
  await ui.unmount()
  // Le board du dépôt principal n'a pas été touché.
  expect(mem['board:c:/proj']).toEqual(main)
})

test('claude --bg après un brief écrit par heredoc : les apostrophes du brief ne cachent pas le lancement', () => {
  // La forme réelle du lancement : le brief en heredoc, du français plein d'apostrophes, puis claude --bg.
  const command = [
    'F=$(mktemp -t groupeA).md; cat > "$F" <<\'EOF\'',
    "## Contexte",
    "Lis d'abord `CLAUDE.md` ; puis lance /implement dans l'ordre && rends compte.",
    'EOF',
    'cd /Users/x/projet && claude --bg -n "Groupe A · File d\'attente" -w groupe-A --permission-mode auto "$(cat "$F")" 2>&1 | tail -5',
  ].join('\n')
  const out = "backgrounded · 9f3f6a75 · Groupe A · File d'attente\n  claude attach 9f3f6a75    open in this terminal\n"
  expect(backgroundLaunches(command, out)).toEqual([{ id: '9f3f6a75', title: "Groupe A · File d'attente" }])
  // Un heredoc qui ne fait que citer claude --bg n'est pas un lancement.
  expect(backgroundLaunches("cat > brief.md <<EOF\nclaude --bg -n \"Groupe A\" \"x\"\nEOF", out)).toEqual([])
})

test('un push avant l’implémentation ne la ferme pas : confier un groupe, ou lancer /implement, y revient', () => {
  const ticketed = (() => {
    let b: Board = { ...emptyBoard('', 'p'), session: 's', deleted: [] }
    b = applySkill(b, 'mattpocock-skills:to-tickets', { now: 1_000, isMain: true })!.board
    b = applyReport(b, { title: 'Lot', ...VENTES }, 2_000).board
    return applyReport(b, { complete: true }, 3_000).board
  })()
  // /project:push des documents du découpage : la livraison passe devant l'implémentation.
  const pushed = applySkill(ticketed, 'project:push', { now: 4_000, isMain: true })!.board
  expect(currentPhase(activeRun(pushed)!).skill).toBe('project:version')

  // Confier un groupe : la phase Implémentation reprend, la livraison redevient à faire.
  const sent = startLinkedGroups(pushed, ['E'], 5_000)!.board
  const run = activeRun(sent)!
  expect(currentPhase(run)).toMatchObject({ skill: 'implement', status: 'active' })
  expect(run.phases.find(p => p.skill === 'project:version')!.status).toBe('pending')
  expect(viewOf(sent, 'E').isDelegated).toBe(true)

  // Lancer /implement ici : le même parcours revient à l'implémentation, aucun autre n'est ouvert.
  const local = applySkill(pushed, 'mattpocock-skills:implement', { now: 5_000, isMain: true })!.board
  expect(local.runs.map(r => r.id)).toEqual([activeRun(pushed)!.id])
  expect(currentPhase(activeRun(local)!)).toMatchObject({ skill: 'implement', status: 'active' })

  // Sans push intercalé, confier un groupe ouvre aussi l'implémentation après le découpage.
  const direct = activeRun(startLinkedGroups(ticketed, ['E'], 5_000)!.board)!
  expect(currentPhase(direct)).toMatchObject({ skill: 'implement', status: 'active' })
})

test('dans la session liée, le bandeau dit pour quel parcours elle travaille, pas « Aucun workflow »', async ($, on) => {
  mock.clock(on, { now: 76_000_000 })
  const { mem } = world(on, { repo: false })
  const main = boardWith({ title: 'Boutique', ...VENTES }, 'session-B')
  mem[KEY] = main
  await start($)
  await $.tool.call({ tool: TOOL, delegate: activeRun(main)!.id } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /Aucun.workflow/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Session.liée/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /« Lot »/ })).toBeDefined()
    expect(await ui.find({ key: 'band-resume' })).toBeUndefined()
    await ui.unmount()
  }
})

// ─── Relais : l'avancement d'une session liée, affiché dans la discussion principale ──────

const ASANA = 'mcp__claude_ai_Asana__update_tasks'

test('la session liée relaie ses tickets (Asana, set), ses commits et ses tests, sans toucher au parcours', async ($, on) => {
  const clock = mock.clock(on, { now: 77_000_000 })
  const { mem } = world(on, { repo: false })
  on('tool.call', { tool: ASANA }, () => ({ result: { text: '{"data":[]}' } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '[main 1a2b3c4] Add the bench\n 3 passed\n' } }))
  const main = boardWith({ title: 'Boutique', ...VENTES }, 'session-B')
  mem[KEY] = main
  const runId = activeRun(main)!.id
  await start($)
  await $.tool.call({ tool: TOOL, delegate: runId, group: 'E' } as any)
  await $.tool.call({ tool: ASANA, tasks: [{ task: 'e1', notes: 'Statut : en cours\nContexte : …' }] } as any)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the bench" && pytest' } as any)
  await clock.advance(1000)
  await $.tool.call({ tool: ASANA, tasks: [{ task: 'e1', completed: true }] } as any)
  await $.tool.call({ tool: TOOL, set: [{ id: 'e1', status: 'done' }], note: 'Banc prêt' } as any)
  const relay = mem[`relay:${runId}`] as any
  const entry = relay.sessions['session-A']
  expect(entry).toMatchObject({ group: 'E', commits: 1, lastCommit: 'Add the bench', test: { ok: true } })
  expect(entry.tickets.e1.status).toBe('done')
  expect(entry.last).toMatchObject({ kind: 'note', text: 'Banc prêt' })
  // La revue d'un ticket (/mattpocock-skills:code-review) ne compte pas ; les revues du groupe, que la session lance elle-même, si.
  await $.skill.prompt({ skill: 'mattpocock-skills:code-review', text: 'x' })
  expect((mem[`relay:${runId}`] as any).sessions['session-A'].reviewedAt).toBeUndefined()
  // La passe « bogues » d'un ticket encore en cours non plus : ce n'est pas la revue du groupe.
  await $.tool.call({ tool: ASANA, tasks: [{ task: 'e1', notes: 'Statut : en cours\nContexte : …' }] } as any)
  await $.skill.prompt({ skill: 'code-review', text: 'x' })
  expect((mem[`relay:${runId}`] as any).sessions['session-A'].reviewedAt).toBeUndefined()
  expect((mem[`relay:${runId}`] as any).sessions['session-A'].last).toMatchObject({ kind: 'review', text: 'passe « bogues » du ticket' })
  await $.tool.call({ tool: ASANA, tasks: [{ task: 'e1', completed: true }] } as any)
  expect((mem[`relay:${runId}`] as any).sessions['session-A'].reviewedAt).toBeUndefined()
  await $.skill.prompt({ skill: 'code-review', text: 'x' })
  await $.skill.prompt({ skill: 'security-review', text: 'x' })
  const reviewed = (mem[`relay:${runId}`] as any).sessions['session-A']
  expect(reviewed.reviewedAt).toBeDefined()
  expect(reviewed.securedAt).toBeDefined()
  expect(reviewed.last).toMatchObject({ kind: 'review', text: 'revue /security-review' })
  // Le parcours de la discussion principale n'a pas bougé.
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const stored = mem[KEY] as Board
  expect(stored.runs.find(r => r.id === runId)!.tickets.find(t => t.id === 'e1')!.status).toBe('todo')
})

test('la discussion principale montre l’avancement relayé : compteurs, tickets faits, bandeau et état, sans l’écrire dans le parcours', async ($, on) => {
  const clock = mock.clock(on, { now: 78_000_000 })
  const { mem } = world(on, { repo: false })
  on('tool.call', { tool: 'Bash' }, (_$: unknown, e: { command: string }) => ({
    result: { stdout: `backgrounded · 9f3e21aa · ${/-n "([^"]+)"/.exec(e.command)?.[1] ?? ''}\n` },
  }))
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...VENTES } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  await $.tool.call({ tool: 'Bash', command: 'claude --bg -n "Boutique › Groupe A · Synchro" "$(cat /tmp/brief-a.txt)"' } as any)
  for (let i = 0; i < 2; i++) await clock.advance(1000)
  const runId = (mem[KEY] as Board).runs.find(r => r.title === 'Boutique')!.id
  // La session liée a relayé : a1 fait, a2 en cours.
  let relay = applyRelay(undefined, runId, 'fille', { kind: 'start', group: 'A' }, 78_001_500)!
  relay = applyRelay(relay, runId, 'fille', { kind: 'tickets', changes: [{ id: 'a1', status: 'done' }, { id: 'a2', status: 'doing' }] }, 78_001_600)!
  mem[`relay:${runId}`] = relay
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  let pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  // Compteurs en direct : 1/7 en haut, 1/2 pour A ; l'état dit que la session travaille.
  expect(await pane.find({ type: 'Text', text: /^1\/7/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '1/2' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Session liée au travail' })).toBeDefined()
  // Confié : ni « cette discussion », ni la ligne d'avancement en double ; fait = coche et titre grisé, sans libellé.
  expect(await pane.find({ type: 'Text', text: /cette discussion/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /il y a/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /✓.fait|fait ↗|à vérifier/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'Séparer la synchro' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /en cours ↗/ })).toBeDefined()
  await pane.unmount()
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /↗A.1\/2/ })).toBeDefined()
  await band.unmount()
  // La session s'arrête avec un ticket ouvert : l'en-tête du groupe passe en ambre.
  mem[`relay:${runId}`] = applyRelay(relay, runId, 'fille', { kind: 'end' }, 78_009_000)!
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await pane.find({ type: 'Text', text: /session terminée il y a/ })).toBeDefined()
  await pane.unmount()
  // Le parcours enregistré n'a pas bougé.
  const stored = (mem[KEY] as Board).runs.find(r => r.id === runId)!
  expect(stored.tickets.filter(t => t.id === 'a1' || t.id === 'a2').map(t => t.status)).toEqual(['todo', 'todo'])
})

test('un ticket relayé fait lève ses dépendances dans son groupe, pas dans les autres (autre branche)', () => {
  const sent = startLinkedGroups(boardWith(VENTES), ['A', 'C'], 5_000)!.board
  const run = activeRun(sent)!
  let relay = applyRelay(undefined, run.id, 'fa', { kind: 'start', group: 'A' }, 5_500)!
  relay = applyRelay(relay, run.id, 'fa', { kind: 'tickets', changes: [{ id: 'a1', status: 'done' }] }, 5_600)!
  relay = applyRelay(relay, run.id, 'fc', { kind: 'start', group: 'C' }, 5_500)!
  relay = applyRelay(relay, run.id, 'fc', { kind: 'tickets', changes: [{ id: 'c1', status: 'done' }] }, 5_600)!
  const shown = withRelay(run, relay)
  const ticket = (id: string) => shown.tickets.find(t => t.id === id)!
  expect(openBlockers(shown, ticket('a2'))).toEqual([])
  expect(openBlockers(shown, ticket('b2'))).toEqual(['c1'])
  expect(countTickets(shown.tickets).done).toBe(2)
  // Tous les tickets de C relayés faits : C reste confié, pas fini, tant qu'il n'est pas rendu.
  const c = groupPlan(shown)!.groups.find(g => g.group.id === 'C')!
  expect(c.isDelegated).toBe(true)
  expect(c.state).not.toBe('done')
  // Le parcours lui-même ne bouge pas.
  expect(run.tickets.find(t => t.id === 'a1')!.status).toBe('todo')
  expect(withRelay(run, null)).toBe(run)
})

test('un choix fait sans la personne dans une session liée se relit tout de suite ici, puis s’enregistre au retour du groupe', () => {
  const sent = startLinkedGroups(boardWith(VENTES), ['A', 'C'], 5_000)!.board
  const run = activeRun(sent)!
  // La session liée l'envoie : il part au relais, pas sur le parcours.
  const delegated = applyReport(sent, { delegate: run.id, group: 'A' }, 5_100).board
  const told = applyReport(delegated, { decided: [{ what: 'Cache en mémoire', why: 'plus simple' }] }, 5_200)
  expect(told.board).toBe(delegated)
  expect(told.text).toMatch(/^Relayed to the main discussion's dashboard: 1 choice\(s\) made without the user/)
  let relay = applyRelay(undefined, run.id, 'fa', { kind: 'start', group: 'A' }, 5_500)!
  relay = applyRelay(relay, run.id, 'fa', { kind: 'decided', items: [{ what: 'Cache en mémoire', why: 'plus simple' }] }, 5_600)!
  // Le même choix renvoyé ne change rien.
  expect(applyRelay(relay, run.id, 'fa', { kind: 'decided', items: [{ what: 'Cache en mémoire' }] }, 5_700)).toBeNull()
  expect(relay.sessions['fa']!.last).toMatchObject({ kind: 'decided', text: 'décidé sans toi : Cache en mémoire' })
  // Ici, le tableau de bord le montre à relire, marqué de son groupe, sans l'enregistrer.
  const shown = withRelay(run, relay)
  expect(shown.decided).toEqual([{ at: 5_600, what: 'Cache en mémoire', why: 'plus simple', relayedFrom: 'A' }])
  expect(run.decided).toBeUndefined()
  // « Relu » l'enregistre relu : il ne revient plus.
  const seen = markDecisionsSeen(sent, 6_000, relay)!.board
  expect(activeRun(seen)!.decided).toEqual([{ at: 5_600, what: 'Cache en mémoire', why: 'plus simple', seenAt: 6_000 }])
  expect(withRelay(activeRun(seen)!, relay).decided).toHaveLength(1)
  // Sans « Relu », le retour du groupe l'enregistre, à relire.
  const back = applyReport(sent, { returned: ['A'] }, 7_000, { relay }).board
  expect(activeRun(back)!.decided).toEqual([{ at: 5_600, what: 'Cache en mémoire', why: 'plus simple' }])
  expect(activeRun(back)!.log.some(l => l.text === 'Décidé sans toi (groupe A) : Cache en mémoire')).toBe(true)
  // Un choix relayé pour un autre groupe que celui rendu attend son propre retour.
  relay = applyRelay(relay, run.id, 'fc', { kind: 'start', group: 'C' }, 5_500)!
  relay = applyRelay(relay, run.id, 'fc', { kind: 'decided', items: [{ what: 'Pas de pagination' }] }, 5_800)!
  const backA = activeRun(applyReport(sent, { returned: ['A'] }, 7_000, { relay }).board)!
  expect(backA.decided!.map(d => d.what)).toEqual(['Cache en mémoire'])
  expect(withRelay(backA, relay).decided!.map(d => d.what)).toEqual(['Cache en mémoire', 'Pas de pagination'])
})

test('tous les tickets faits, dont ceux relayés par une session liée : ni compte rendu ni livraison avant le retour du groupe', () => {
  const others = VENTES.tickets.filter(t => t.id !== 'e1').map(t => ({ id: t.id, status: 'done' }))
  // Les autres groupes sont faits et relus : seul E, chez sa session liée, retient la livraison.
  const done = applyReport(applyReport(boardWith(VENTES), { set: others }, 4_000).board, { reviewed: ['A', 'B', 'C', 'D'] }, 4_100).board
  const sent = startLinkedGroups(done, ['E'], 5_000)!.board
  const run = activeRun(sent)!
  let relay = applyRelay(undefined, run.id, 'fe', { kind: 'start', group: 'E' }, 5_500)!
  relay = applyRelay(relay, run.id, 'fe', { kind: 'tickets', changes: [{ id: 'e1', status: 'done' }] }, 5_600)!
  const shown = withRelay(run, relay)
  expect(countTickets(shown.tickets).done).toBe(VENTES.tickets.length)
  const next = suggestionsFor(shown)
  for (const skill of ['compte-rendu', 'project:version', 'project:pr']) expect([next.primary, ...next.others]).not.toContain(skill)
  expect(groupPlan(shown)!.groups.find(g => g.group.id === 'E')!.state).not.toBe('done')
})

test('un groupe rendu par sa session liée garde les revues qu’elle a relayées ; sans elles, il reste à relire', () => {
  const sent = startLinkedGroups(boardWith(VENTES), ['E'], 5_000)!.board
  const runId = activeRun(sent)!.id
  let relay = applyRelay(undefined, runId, 'fille', { kind: 'start', group: 'E' }, 5_500)!
  relay = applyRelay(relay, runId, 'fille', { kind: 'review' }, 6_000)!
  relay = applyRelay(relay, runId, 'fille', { kind: 'security' }, 6_500)!
  const back = { set: [{ id: 'e1', status: 'done' }], returned: ['E'] }
  const done = applyReport(sent, back, 7_000, { relay }).board
  const group = activeRun(done)!.groups!.find(g => g.id === 'E')!
  expect(group.linked).toBeUndefined()
  expect(group.delegated).toEqual({ at: 5_000 })
  expect(group.reviewedAt).toBe(6_000)
  expect(group.security?.ranAt).toBe(6_500)
  expect(activeRun(done)!.log.some(l => /Revue du groupe faite dans sa session liée : E/.test(l.text))).toBe(true)
  // Sans revue relayée, ou le relais d'un autre parcours : le groupe attend sa revue, comme avant.
  expect(applyReport(sent, back, 7_000, { relay }).text).not.toMatch(/without a \/code-review/)
  for (const other of [undefined, { ...relay, run: 'autre' }]) {
    const out = applyReport(sent, back, 7_000, { relay: other })
    expect(out.text).toMatch(/returned without a \/code-review relayed by its linked session: E/)
    const g = activeRun(out.board)!.groups!.find(x => x.id === 'E')!
    expect(g.reviewedAt).toBeUndefined()
    expect(g.security).toBeUndefined()
  }
})

test('un groupe rendu sans revue : « Revue du groupe · session liée » la demande à sa session, puis "reviewed" le marque relu', async ($, on) => {
  const clock = mock.clock(on, { now: 79_000_000 })
  const { mem, filled } = world(on, { repo: true })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...VENTES } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  const back = (await $.tool.call({ tool: TOOL, set: [{ id: 'e1', status: 'done' }], returned: ['E'] } as any)) as any
  expect(JSON.stringify(back)).toMatch(/returned without a \/code-review relayed by its linked session: E/)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  // Sa branche est fusionnée ici : pas de /code-review dans cette discussion, la demande va à la session.
  expect(await ui.find({ key: 'review-group-E' })).toBeUndefined()
  // La carte « Ensuite » ne propose pas non plus /code-review ici.
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const suggested = suggestionsFor((mem[KEY] as Board).runs.find(r => r.title === 'Boutique')!)
  expect([suggested.primary, ...suggested.others]).not.toContain('final-review')
  await ui.press({ key: 'review-linked-E' })
  await ui.unmount()
  const text = filled.at(-1)!
  expect(text).toMatch(/^Fais faire la revue du groupe E \(Enquêtes\) du parcours « Boutique » par sa session liée/)
  expect(text).toContain('« Boutique › Groupe E · » ou « Groupe E · »')
  expect(text).toMatch(/git merge --ff-only /)
  expect(text).toContain('2) lancer elle-même la revue en la confiant à un sous-agent relecteur (outil Agent, type general-purpose, modèle opus, effort high), le seul sous-agent qui écrit : il lance lui-même la revue et applique lui-même ses correctifs ; la revue est /code-review high --fix (outil Skill « code-review », arguments « high --fix ») sur les seuls commits du groupe')
  expect(text).toContain('3) au retour du relecteur, relire le diff de ses correctifs, relancer les contrôles du projet et commiter ;')
  expect(text).toMatch(/en lui donnant la liste des choix déjà déclarés dans \{"decided": …\} de l'outil flow \(ceux que tu connais, ceux de la session compris\), à ne pas resignaler ni défaire et la consigne des relecteurs, à leur donner telle quelle : .*, et en lui demandant de se concentrer sur les interactions entre les tickets/)
  // La sécurité par un sous-agent relecteur limité aux commits du groupe, jamais /security-review.
  expect(text).toMatch(/4\) juger si une revue de sécurité vaut la peine .* la confier à un sous-agent relecteur \(outil Agent, type general-purpose, modèle opus, effort xhigh\), en lecture seule, avec pour seul périmètre les commits du groupe/)
  expect(text).toContain('{"reviewed": ["E"]}')
  expect(text).not.toMatch(/copie/)
  // "reviewed" : le groupe fini est relu ; un groupe inconnu ou pas fini est refusé.
  const out = (await $.tool.call({ tool: TOOL, reviewed: ['E', 'Z'] } as any)) as any
  expect(JSON.stringify(out)).toMatch(/reviewed: no finished group among Z/)
  for (let i = 0; i < 6; i++) await clock.advance(1000)
  const run = (mem[KEY] as Board).runs.find(r => r.title === 'Boutique')!
  expect(run.groups!.find(g => g.id === 'E')!.reviewedAt).toBe(79_006_000)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'review-linked-E' })).toBeUndefined()
  await ui.unmount()
})

test('sans git, la revue d’un groupe rendu porte sur les copies que sa session a prises, pas sur des commits', async ($, on) => {
  mock.clock(on, { now: 79_500_000 })
  const { filled } = world(on, { repo: false })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...VENTES } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  await $.tool.call({ tool: TOOL, set: [{ id: 'e1', status: 'done' }], returned: ['E'] } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'review-linked-E' })
  await ui.unmount()
  const text = filled.at(-1)!
  expect(text).toContain('1) travailler sur le code actuel ; ')
  expect(text).toContain("arguments « high --fix ») sur les seuls changements du groupe, lus sur le code actuel (point fixe : pour chaque fichier, la plus ancienne copie parmi les tickets du groupe")
  expect(text).toContain('sa session a pris ces copies dans son dossier temporaire)')
  expect(text).toMatch(/avec pour seul périmètre les changements du groupe \(point fixe : pour chaque fichier, la plus ancienne copie/)
  expect(text).not.toMatch(/commits du groupe|git merge/)
})

test('un groupe rendu avec "reviewed" dans le même appel : la revue que son compte rendu confirme vaut, plus de bouton', async ($, on) => {
  const sent = startLinkedGroups(boardWith(VENTES), ['E'], 5_000)!.board
  // Le relais n'a pas vu la revue ; le compte rendu de la session la dit faite.
  const out = applyReport(sent, { set: [{ id: 'e1', status: 'done' }], returned: ['E'], reviewed: ['E'] }, 7_000)
  expect(out.text).not.toMatch(/without a \/code-review/)
  expect(activeRun(out.board)!.groups!.find(g => g.id === 'E')!.reviewedAt).toBe(7_000)
  // Sans "reviewed", la réponse dit quoi envoyer si le compte rendu confirme la revue.
  const bare = applyReport(sent, { set: [{ id: 'e1', status: 'done' }], returned: ['E'] }, 7_000)
  expect(bare.text).toContain('If its final report says the group review ran there, send {"reviewed": ["E"]}')

  mock.clock(on, { now: 79_500_000 })
  const { filled } = world(on, { repo: true })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...VENTES } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  // La demande de délégation dit d'envoyer "reviewed" avec "returned" quand la revue a tourné.
  expect(filled.at(-1)).toContain('si son compte rendu dit que la revue du groupe a tourné, {"reviewed": ["<id du groupe>"]}')
  await $.tool.call({ tool: TOOL, set: [{ id: 'e1', status: 'done' }], returned: ['E'], reviewed: ['E'] } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'review-linked-E' })).toBeUndefined()
  expect(await ui.find({ key: 'review-group-E' })).toBeUndefined()
  await ui.unmount()
})

test('la rétro d’un parcours à sessions liées : la mère fait la sienne, un sous-agent par fille fait celle de sa session, puis un compte rendu global', async ($, on) => {
  mock.clock(on, { now: 79_800_000 })
  const { filled } = world(on, { repo: true })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...VENTES } as any)
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  // Sans session fille : /retro seul.
  await ui.press({ key: 'go-retro' })
  expect(filled.at(-1)).toBe('/mattpocock-skills:retro')
  await ui.press({ key: 'launch-linked-E' })
  await ui.unmount()
  await $.tool.call({ tool: START, title: 'Boutique › Groupe E · Enquêtes' } as any)
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'go-retro' })
  await ui.unmount()
  const text = filled.at(-1)!
  expect(text).toMatch(/^\/mattpocock-skills:retro Rétro globale du parcours « Boutique » : cette discussion \(la session mère\) et ses sessions filles/)
  expect(text).toContain('« Boutique › » (ids relevés : local_E42)')
  expect(text).toContain('lance un sous-agent par session fille, tous en parallèle et en lecture seule')
  expect(text).toContain('lit le transcript de sa session')
  expect(text).not.toContain('SendMessage')
  expect(text).toContain('fais le compte rendu global')
})

test('le relais d’une session d’avant l’envoi du groupe ne compte pas ; le groupe se reconnaît aussi par ses tickets', () => {
  const sent = startLinkedGroups(boardWith(VENTES), ['E'], 5_000)!.board
  const group = activeRun(sent)!.groups!.find(g => g.id === 'E')!
  const old = applyRelay(undefined, 'r', 'avant', { kind: 'tickets', changes: [{ id: 'e1', status: 'done' }] }, 4_000)!
  expect(relayForGroup(old, group)).toBeNull()
  const now = applyRelay(old, 'r', 'apres', { kind: 'tickets', changes: [{ id: 'e1', status: 'doing' }] }, 6_000)!
  expect(relayForGroup(now, group)).toMatchObject({ doing: 1, done: 0, total: 1 })
  // Rien de nouveau : pas d'écriture.
  expect(applyRelay(now, 'r', 'apres', { kind: 'tickets', changes: [{ id: 'e1', status: 'doing' }] }, 7_000)).toBeNull()
  // Le groupe nommé « Groupe E » est E ; un nom qui ne dit rien laisse les tickets décider.
  const named = applyRelay(undefined, 'r', 'nommee', { kind: 'start', group: 'Groupe E · Enquêtes' }, 6_500)!
  expect(relayForGroup(named, group)).toMatchObject({ done: 0, total: 1 })
  const vague = applyRelay(applyRelay(undefined, 'r', 'floue', { kind: 'start', group: '<id du groupe>' }, 6_500)!, 'r', 'floue', { kind: 'tickets', changes: [{ id: 'e1', status: 'done' }] }, 6_600)!
  expect(relayForGroup(vague, group)).toMatchObject({ done: 1 })
  // Se redéclarer pour un autre groupe change le groupe de l'entrée.
  expect(applyRelay(named, 'r', 'nommee', { kind: 'start', group: 'B' }, 6_700)!.sessions.nommee!.group).toBe('B')
  // La fin de la session est relayée une fois.
  const ended = applyRelay(now, 'r', 'apres', { kind: 'end' }, 8_000)!
  expect(relayForGroup(ended, group)?.endedAt).toBe(8_000)
  expect(applyRelay(ended, 'r', 'apres', { kind: 'end' }, 9_000)).toBeNull()
})

// ─── Rétro du 22/10/2026 : compte rendu perdu, choix recopiés, brief qui recopie des règles ──────

test('le compte rendu final d’une session liée passe aussi par le relais : la discussion principale le reçoit tant que le groupe n’est pas rendu', () => {
  const sent = startLinkedGroups(boardWith(VENTES), ['A', 'C'], 5_000)!.board
  const run = activeRun(sent)!
  // La session liée le dépose par l'outil : il part au relais, pas sur le parcours.
  const delegated = applyReport(sent, { delegate: run.id, group: 'C' }, 5_100)
  expect(delegated.text).toContain('also leave it here, {"report": "<the whole report>"}')
  const told = applyReport(delegated.board, { report: 'c1 fait (commit 1a2b3c4), contrôles verts' }, 5_200)
  expect(told.board).toBe(delegated.board)
  expect(told.text).toMatch(/^Relayed to the main discussion's dashboard: the final report\./)
  let relay = applyRelay(undefined, run.id, 'fc', { kind: 'start', group: 'C' }, 5_500)!
  relay = applyRelay(relay, run.id, 'fc', { kind: 'report', text: 'c1 fait (commit 1a2b3c4), contrôles verts' }, 60_000)!
  expect(relay.sessions['fc']!.report).toEqual({ text: 'c1 fait (commit 1a2b3c4), contrôles verts', at: 60_000 })
  expect(relay.sessions['fc']!.last).toMatchObject({ kind: 'report', text: 'compte rendu final déposé' })
  // Le même compte rendu renvoyé ne change rien.
  expect(applyRelay(relay, run.id, 'fc', { kind: 'report', text: 'c1 fait (commit 1a2b3c4), contrôles verts' }, 61_000)).toBeNull()
  // Ici, toute réponse de l'outil le cite, même si le SendMessage ne l'a jamais apporté.
  const any = applyReport(sent, { note: 'point' }, 62_000, { relay })
  expect(any.text).toContain('Final report(s) left in the relay by linked sessions whose group is not returned yet')
  expect(any.text).toContain('Group C (1970-01-01 00:01 UTC): c1 fait (commit 1a2b3c4), contrôles verts')
  expect(any.text).not.toContain('Group A (')
  // Déjà cité en entier : une ligne qui renvoie au relais, sans recopier le texte.
  const seen = new Set([`${run.id}:C:60000`])
  const again = applyReport(sent, { note: 'point' }, 62_500, { relay, seenReports: seen })
  expect(again.text).toContain('Not returned yet, final report already given above: group C (1970-01-01 00:01 UTC)')
  expect(again.text).not.toContain('contrôles verts')
  // Une session redémarrée sous un autre id ne masque pas le compte rendu de la précédente.
  const restarted = applyRelay(relay, run.id, 'fc2', { kind: 'start', group: 'C' }, 61_500)!
  expect(applyReport(sent, { note: 'point' }, 62_600, { relay: restarted }).text).toContain('Group C (1970-01-01 00:01 UTC): c1 fait')
  // Le relais d'un autre parcours ne compte pas.
  expect(applyReport(sent, { note: 'point' }, 62_000, { relay: { ...relay, run: 'autre' } }).text).not.toContain('Final report')
  // Le groupe rendu, le compte rendu n'est plus cité.
  const back = applyReport(sent, { set: [{ id: 'c1', status: 'done' }], returned: ['C'] }, 63_000, { relay })
  expect(back.text).not.toContain('Final report')
  expect(applyReport(back.board, { note: 'suite' }, 64_000, { relay }).text).not.toContain('Final report')
})

test('le fichier des choix déjà déclarés reprend ceux du parcours et ceux que les sessions liées ont relayés', () => {
  const sent = startLinkedGroups(boardWith(VENTES), ['A'], 5_000)!.board
  const here = applyReport(sent, { decided: [{ what: 'Export en CSV', why: 'demandé par la compta' }] }, 5_100).board
  const run = activeRun(here)!
  expect(decidedFileText(run, null)).toBe(
    [
      '# Choix déjà déclarés · Lot',
      '',
      "Tenu par flow-board d'après le champ « decided » de l'outil flow (discussion principale et sessions liées), réécrit à chaque changement : ne pas le modifier à la main. Ces choix ont été faits sans le porteur et attendent sa relecture : une revue ne les resignale pas et une passe --fix ne les défait pas.",
      '',
      '- Export en CSV — demandé par la compta (1970-01-01 00:00 UTC)',
      '',
    ].join('\n'),
  )
  let relay = applyRelay(undefined, run.id, 'fa', { kind: 'start', group: 'A' }, 5_500)!
  relay = applyRelay(relay, run.id, 'fa', { kind: 'decided', items: [{ what: 'Cache en mémoire' }] }, 120_000)!
  expect(decidedFileText(run, relay)).toContain('- Cache en mémoire (groupe A, 1970-01-01 00:02 UTC)')
  expect(decidedFileText({ ...run, decided: undefined }, null)).toContain("Aucun choix déclaré pour l'instant.")
})

test('le brief des sessions de groupe : renommer d’abord la discussion, background par renvoi, compte rendu déposé, délais et suivi sans claude logs', async ($, on) => {
  mock.clock(on, { now: 74_000_000 })
  const { filled } = world(on, { repo: true })
  await start($)
  await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...VENTES } as any)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  await ui.press({ key: 'launch-linked-E' })
  const first = filled.at(-1)!
  expect(first).toContain("C'est la première session liée de ce parcours : si ce n'est pas déjà fait (la consigne d'/implement l'a peut-être demandé), demande-moi d'abord de renommer cette discussion de son nom définitif")
  // Le background renvoie aux règles au lieu de les recopier, et cite le fichier des choix.
  expect(first).toContain('sans y reprendre le texte des règles')
  expect(first).toContain("dans le document du projet pour les sessions déléguées s'il en a un")
  expect(first).toContain('config/rules/agents.md')
  expect(first).not.toMatch(/Rédige toi-même le background : le projet, les contraintes \(ressource à ne pas partager, écritures autorisées/)
  // La consigne des relecteurs et le compte rendu déposé au relais.
  expect(first).toContain("si la revue a plusieurs axes (Standards et Spec), ne rendre son rapport qu'une fois tous les axes revenus")
  expect(first).toContain("ne signaler comme défaut ni appliquer rien de ce que la spec, le ticket ou le fichier des choix laisse à un autre groupe")
  // Hors d'atteinte (pas de ~/.claude ici), le fichier n'est pas cité : la liste se donne.
  expect(first).toContain("les choix déjà déclarés (ceux envoyés dans decided) se donnent en liste")
  expect(first).toContain('le déposer aussi par l\'outil flow, {"report": "<le compte rendu entier>"}')
  expect(first).toContain("Un compte rendu qui n'arrive pas par SendMessage est dans le relais")
  // Une commande longue a un délai maximal ; la session ne rend pas la main sur un processus sans délai.
  expect(first).toContain("une commande longue (tests, build) se lance avec un délai maximal")
  expect(first).toContain("ne jamais rendre la main en attendant un processus d'arrière-plan qui n'a pas de délai : le surveiller (outil Monitor) ou l'arrêter")
  // Le suivi passe par le worktree, le tracker et ListAgents.
  expect(first).toContain("l'état git de son worktree (git -C <worktree> log --oneline et git -C <worktree> status), le tracker (statuts des tickets) et ListAgents")
  expect(first).toContain('jamais claude logs')
  // Un groupe déjà confié : la discussion a déjà son nom, pas de nouvelle demande.
  await ui.press({ key: 'launch-linked-A' })
  await ui.unmount()
  expect(filled.at(-1)).toContain('Confie ce groupe à une session liée')
  expect(filled.at(-1)).not.toContain('première session liée')
})

test('les consignes ajoutées aux skills : choix sensible en question au cadrage, fichier des choix pour les revues, pistes d’un autre dépôt à part', async ($, on) => {
  mock.clock(on, { now: 74_000_000 })
  world(on, { repo: true })
  await start($)
  const spec = await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'x' })
  expect(spec.text).toContain('is never a declared choice ({"decided": …}): ask the user while framing')
  expect(spec.text).toContain('copies the question asked and the accepted answer word for word')
  const tickets = await $.skill.prompt({ skill: 'mattpocock-skills:to-tickets', text: 'x' })
  expect(tickets.text).toContain('is never a declared choice')
  await $.tool.call({ tool: TOOL, title: 'Boutique', ...VENTES } as any)
  const impl = await $.skill.prompt({ skill: 'mattpocock-skills:implement', text: 'x' })
  expect(impl.text).toContain('- Declared choices: ')
  expect(impl.text).toContain('when the review has several axes (Standards and Spec), report only once all of them are back')
  expect(impl.text).toContain('ask the user once to rename this discussion to its final name')
  expect(impl.text).not.toContain('is never a declared choice')
  const retro = await $.skill.prompt({ skill: 'mattpocock-skills:retro', text: 'x' })
  expect(retro.text).toContain('Improvements that touch another repository')
  expect(retro.text).toContain('Only the improvements of this repository go to the items')
})
