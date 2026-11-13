import { expect, test } from 'claude-code/testing'

import { closingProcedure, closingScript, isScriptPath } from '../hooks/closing.ts'
import { closingText, newRun } from '../hooks/model.ts'
import type { Run } from '../types'

// La réponse de l'outil pour un groupe clos cite la commande du script de vérification et les gestes à faire
// sur son verdict, au lieu des 11 000 caractères de la procédure entière, que la discussion de la mission
// exécutait commande par commande. Le script est celui du plugin installé (`closingScript`, posé au chargement).

const SCRIPT = '/opt/poste/.claude/plugins/cache/m/flow-board/1.0.0/scripts/fermeture.mjs'
/** Le plafond du texte court d'une session du CLI (quelques centaines de caractères) : la procédure entière en faisait environ 11 000. */
const SHORT_MAX = 1_800
/** Celui d'une session de l'app, qui ajoute le geste d'archivage et son accord. */
const SHORT_APP_MAX = 2_600

const run = (): Run => ({ ...newRun('implement', 1_000, 'Boutique'), id: 'm1' }) as Run
const group = { kind: 'group', id: 'A', name: 'Code' } as const

const withScript = <T,>(path: string | null, fn: () => T): T => {
  const before = closingScript.path
  closingScript.path = path
  try {
    return fn()
  } finally {
    closingScript.path = before
  }
}

test('avec le script, la fermeture tient en quelques lignes : la commande, puis les gestes sur son verdict', () => {
  const text = withScript(SCRIPT, () => closingProcedure({ run: run(), target: group, isRepo: true, session: 'abc12345', hasReport: true }))
  expect(text.length).toBeLessThan(SHORT_MAX)
  expect(text).toContain(`node '${SCRIPT}' --worktree 'groupe-boutique-A' --branche 'worktree-groupe-boutique-A' --branche 'groupe-boutique-A' --branche 'groupe-A' --session 'abc12345'`)
  // Les gestes : celui que la dernière ligne du script donne pour son verdict, retirer seulement sur SÛR de la même
  // commande après l'arrêt, la branche gardée.
  expect(text).toContain('sa première ligne est le verdict, sa dernière (« suite : ») le seul geste à faire')
  expect(text).toContain('sans verdict en première ligne (node ou le script introuvable) : rien n’est sûr, envoie "state": "stopped" avec sa sortie')
  expect(text).toContain('2) après l’arrêt fait sur SÛR, la même commande avec --apres-arret : seulement sur SÛR, la commande de retrait qu’il imprime ; sur ATTENDRE, la relancer comme le dit sa dernière ligne ; la branche reste : ne la supprime pas')
  expect(text).toContain("3) seulement une fois le retrait constaté (la même commande relancée rend DÉJÀ RETIRÉ) : claude rm 'abc12345', sans aucune option")
  // Le chemin normal : un DÉJÀ RETIRÉ au premier lancement (rien vu retiré ici) ne mène pas à claude rm ; celui du
  // lancement d'après le retrait, si : les deux cas sont nommés, sans contradiction.
  expect(text).toContain('DÉJÀ RETIRÉ dès ce premier lancement : pas de claude rm (le worktree n’a pas été vu retiré ici)')
  // Plus de procédure recopiée : ni les commandes de vérification une à une, ni la liste jetable.
  expect(text).not.toContain('git worktree list --porcelain')
  expect(text).not.toContain('ls-files --others')
  // Sans le script (racine inconnue), la procédure entière revient.
  const whole = withScript(null, () => closingProcedure({ run: run(), target: group, isRepo: true, session: 'abc12345', hasReport: true }))
  expect(whole.length).toBeGreaterThan(9_000)
  expect(whole).toContain('git worktree list --porcelain')
})

test('le texte court garde les gardes de claude rm : sans compte rendu au relais, de l’app, des pistes, un envoi suivant', () => {
  withScript(SCRIPT, () => {
    const noReport = closingProcedure({ run: run(), target: group, isRepo: true, session: 'abc12345', hasReport: false })
    expect(noReport).toContain('pas de claude rm : le relais n’a pas son compte rendu')
    expect(noReport).not.toContain("claude rm 'abc12345'")
    const app = closingProcedure({ run: run(), target: group, isRepo: true, session: 'local_abc', hasReport: true })
    expect(app.length).toBeLessThan(SHORT_APP_MAX)
    expect(app).toContain('pas de claude rm : une session de l’app')
    expect(app).toContain('2) seulement quand sa dernière ligne le demande (sur SÛR, ou sur DÉJÀ RETIRÉ) et une fois ListAgents la montrant au repos (busy : n’arrête rien, remets la fermeture à plus tard), arrêter une session de l’app, c’est l’archiver : si l’app te donne l’outil archive_session')
    expect(app).toContain("--session 'local_abc'")
    const items = closingProcedure({ run: run(), target: { kind: 'items', skill: 'retro' }, isRepo: true, session: 'abc12345', hasReport: true })
    expect(items).toContain('pas de claude rm : la session des pistes')
    // Un envoi suivant : ses noms à lui, jamais groupe-<id> (celui du premier envoi d'avant la 0.59.0).
    const second = closingProcedure({ run: run(), target: group, isRepo: true, session: 'abc12345', seq: 2, hasReport: true })
    expect(second).toContain("--worktree 'groupe-boutique-A-2' --branche 'worktree-groupe-boutique-A-2' --branche 'groupe-boutique-A-2' --session")
    expect(second).not.toContain("'groupe-A'")
    // Sans id de session, aucune option --session : le script trouve la session par son dossier.
    expect(closingProcedure({ run: run(), target: group, isRepo: true, hasReport: true })).not.toContain('--session')
  })
})

test('les valeurs hors forme arrêtent toujours la fermeture, script ou non ; un chemin de script hors forme rend la procédure entière', () => {
  withScript(SCRIPT, () => {
    expect(closingProcedure({ run: run(), target: group, isRepo: true, session: "x'; rm -rf ~", hasReport: true })).toContain('Ne ferme rien')
    expect(closingProcedure({ run: run(), target: { kind: 'group', id: 'A B', name: 'x' }, isRepo: true, hasReport: true })).toContain('Ne ferme rien')
  })
  for (const bad of ["/a/b'c/fermeture.mjs", 'relatif/fermeture.mjs', '/a/../b/fermeture.mjs', '/a/b/autre.mjs', '/a/$(id)/fermeture.mjs', '/a/b\n/fermeture.mjs']) {
    expect(isScriptPath(bad)).toBe(false)
    expect(withScript(bad, () => closingProcedure({ run: run(), target: group, isRepo: true, hasReport: true }))).toContain('git worktree list --porcelain')
  }
  expect(isScriptPath('D:\\poste\\.claude\\plugins\\fermeture.mjs')).toBe(true)
  expect(isScriptPath(SCRIPT)).toBe(true)
  // Sans git, rien ne change : la fermeture n'arrête que la session.
  expect(withScript(SCRIPT, () => closingProcedure({ run: run(), target: group, isRepo: false, session: 'abc12345', hasReport: true }))).toContain('ce dossier n’a pas de git')
})

test('une session de l’app archivée : la réponse renvoie au point 2 du texte court, pas au point 8 de la procédure entière', () => {
  const r: Run = {
    ...run(),
    tickets: [{ id: 'a1', name: 'x', status: 'done' }],
    groups: [{ id: 'A', name: 'Code', tickets: ['a1'], delegated: { at: 2_000, session: 'local_abc', closing: { state: 'app', at: 3_000 } } }],
  } as unknown as Run
  const text = withScript(SCRIPT, () => closingText(r, null, true))
  expect(text).toContain('To archive in the app')
  expect(text).toContain('by its step 2 (the same script with --apres-arret, removal only on SÛR)')
  expect(text).not.toContain('from its point 8 on')
})
