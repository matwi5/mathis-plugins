import { expect, test } from 'claude-code/testing'

import { closingProcedure, closingScript, isKeptForReport, isScriptPath } from '../hooks/closing.ts'
import { closingText, newRun } from '../hooks/model.ts'
import type { Run } from '../types'

// La réponse de l'outil pour un groupe clos cite la commande du script de vérification et les gestes à faire
// sur son verdict, au lieu des 11 000 caractères de la procédure entière, que la discussion de la mission
// exécutait commande par commande. Le script est celui du plugin installé (`closingScript`, posé au chargement).

const SCRIPT = '/opt/poste/.claude/plugins/cache/m/flow-board/1.0.0/scripts/fermeture.mjs'
/**
 * Le plafond du texte court d'une session du CLI : la procédure entière en faisait environ 11 000. Relevé de 1 800 à
 * 2 200 quand le point 4 a dit où lire le sessionId (la ligne « session : » du script) et où reste le compte rendu (le relais),
 * puis à 2 600 quand les points 2 et 3 ont renvoyé à la ligne « en une fois » du script, avec le repli de claude rm sur
 * un DÉJÀ RETIRÉ constaté (une ligne arrêtée après le retrait) et la session gardée quand la ligne le retient : le
 * texte reste quatre fois plus court.
 */
const SHORT_MAX = 2_600
/** Celui d'une session de l'app, qui ajoute le geste d'archivage et son accord (relevé de 2 600 à 3 000 de même). */
const SHORT_APP_MAX = 3_000

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
  // La ligne « en une fois » du script : le retrait, son constat et claude rm, celui-ci seulement sous --avec-rm.
  expect(text).toContain(" --session 'abc12345' --avec-rm")
  expect(text).toContain('2) après l’arrêt fait sur SÛR, la même commande avec --apres-arret : seulement sur SÛR, la ligne « en une fois » qu’il imprime, telle quelle (le retrait, puis son constat, puis claude rm ; sans elle, sa commande de retrait) ; sur ATTENDRE, la relancer comme le dit sa dernière ligne ; la branche reste : ne la supprime pas')
  // claude rm au bout de la ligne, ou, sans lui dans la ligne ou la ligne arrêtée après le retrait, sur DÉJÀ RETIRÉ : jamais sauté sans un mot.
  expect(text).toContain("3) claude rm 'abc12345', sans aucune option, seulement après le retrait constaté : au bout de la ligne qui le porte ; une telle ligne arrêtée après le retrait : seulement quand la même commande relancée avec --apres-arret rend DÉJÀ RETIRÉ, sa ligne « session : » la disant arrêtée ; « claude rm : pas dans la ligne », ou pas de ligne : pas de claude rm, rapporte \"state\": \"stopped\" sans \"worktree\" (session gardée)")
  // Le chemin normal : un DÉJÀ RETIRÉ au premier lancement (rien vu retiré ici) ne mène pas à claude rm ; un
  // DÉJÀ RETIRÉ constaté après le retrait fait ici, si : les deux cas sont nommés, sans contradiction.
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
    // --avec-rm seulement là où claude rm se fait : jamais sans compte rendu au relais, pour l'app, les pistes ni sans session.
    expect(noReport).not.toContain('--avec-rm')
    expect(noReport).toContain('la ligne « en une fois » qu’il imprime, telle quelle (le retrait, puis son constat ; sans elle, sa commande de retrait) ;')
    const app = closingProcedure({ run: run(), target: group, isRepo: true, session: 'local_abc', hasReport: true })
    expect(app.length).toBeLessThan(SHORT_APP_MAX)
    expect(app).toContain('pas de claude rm : une session de l’app')
    expect(app).toContain('2) seulement quand sa dernière ligne le demande (sur SÛR, ou sur DÉJÀ RETIRÉ) et une fois ListAgents la montrant au repos (busy : n’arrête rien, remets la fermeture à plus tard), arrêter une session de l’app, c’est l’archiver : si l’app te donne l’outil archive_session')
    expect(app).toContain("--session 'local_abc'")
    expect(app).not.toContain('--avec-rm')
    const items = closingProcedure({ run: run(), target: { kind: 'items', skill: 'retro' }, isRepo: true, session: 'abc12345', hasReport: true })
    expect(items).toContain('pas de claude rm : la session des pistes')
    expect(items).not.toContain('--avec-rm')
    expect(closingProcedure({ run: run(), target: group, isRepo: true, hasReport: true })).not.toContain('--avec-rm')
    // Un envoi suivant : ses noms à lui, jamais groupe-<id> (celui du premier envoi d'avant la 0.59.0).
    const second = closingProcedure({ run: run(), target: group, isRepo: true, session: 'abc12345', seq: 2, hasReport: true })
    expect(second).toContain("--worktree 'groupe-boutique-A-2' --branche 'worktree-groupe-boutique-A-2' --branche 'groupe-boutique-A-2' --session")
    expect(second).not.toContain("'groupe-A'")
    // Sans id de session, aucune option --session : le script trouve la session par son dossier.
    expect(closingProcedure({ run: run(), target: group, isRepo: true, hasReport: true })).not.toContain('--session')
  })
})

test('le rapport que dicte un constat du retrait non nul (stopped, sans worktree) ne fait jamais lancer claude rm par la fermeture suivante', () => {
  // Rejoué contre le modèle : « stopped » sans "worktree" n'est pas une session gardée faute de compte rendu
  // (isKeptForReport), qui mènerait la fermeture suivante à claude rm sur un DÉJÀ RETIRÉ dès son premier lancement.
  const dictated = { state: 'stopped', at: 2_000, why: 'retrait non constaté : session relancée' } as const
  expect(isKeptForReport(run(), group, undefined, dictated as never)).toBe(false)
  withScript(SCRIPT, () => {
    const next = closingProcedure({ run: run(), target: group, isRepo: true, session: 'abc12345', hasReport: true, noted: dictated as never })
    expect(next).toContain('DÉJÀ RETIRÉ dès ce premier lancement : pas de claude rm (le worktree n’a pas été vu retiré ici)')
  })
  // Avec "worktree", le cas d'avant : gardée faute de compte rendu.
  expect(isKeptForReport(run(), group, undefined, { ...dictated, worktree: '/d/.claude/worktrees/groupe-boutique-A' } as never)).toBe(true)
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
