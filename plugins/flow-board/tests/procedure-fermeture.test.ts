import { expect, test } from 'claude-code/testing'

import { closingProcedure } from '../hooks/closing.ts'
import { newRun } from '../hooks/model.ts'

// La procédure de fermeture d'une session liée : vérifier d'abord, n'arrêter et ne retirer
// qu'ensuite. Invariant : une fermeture ne fait jamais perdre un commit, un fichier modifié ou non
// suivi, ni la conversation d'une session liée ; la branche n'est jamais supprimée ; une session qui
// travaille encore n'est jamais arrêtée.

const run = { ...newRun('implement', 1_000, 'Fermeture auto') }
const group = { kind: 'group', id: 'B', name: 'Fermeture' } as const
const cli = closingProcedure({ run, target: group, isRepo: true, session: '178bd61c' })
const app = closingProcedure({ run, target: group, isRepo: true, session: 'local_ab12' })
const unknown = closingProcedure({ run, target: group, isRepo: true })
const pistes = closingProcedure({ run, target: { kind: 'items', skill: 'retro' }, isRepo: true, session: '9f9f9f9f' })
const noGit = closingProcedure({ run, target: group, isRepo: false, session: '178bd61c' })
const all = [cli, app, unknown, pistes, noGit]

test('la procédure ne force jamais rien, ne fusionne jamais et garde la branche', () => {
  for (const text of all) {
    for (const forbidden of ['--discard-unpushed', '--force', '--force-remove-worktree', 'git branch -d', 'git branch -D', 'git merge', ' -f ']) {
      expect(text).not.toContain(forbidden)
    }
  }
  for (const text of [cli, app, unknown, pistes]) {
    expect(text).toContain('la branche reste : ne la supprime pas')
    expect(text).toContain('la fermeture ne fusionne jamais')
  }
})

test('la liste jetable, mot pour mot ; tout autre fichier ignoré, modifié ou non suivi arrête la fermeture', () => {
  for (const text of [cli, app, unknown, pistes]) {
    expect(text).toContain(
      'liste jetable : les liens symboliques, quelle que soit leur cible (test -L) ; __pycache__/ et *.pyc ; .show-your-work/ ; .pytest_cache/, .mypy_cache/, .ruff_cache/, node_modules/, .DS_Store',
    )
    expect(text).toContain('les dossiers de la liste exclus ci-dessus (__pycache__/, .show-your-work/, .pytest_cache/, .mypy_cache/, .ruff_cache/, node_modules/) sont jetables en entier, quel que soit leur contenu ; les types générés d’un mod, eux, seulement après ce diff -rq ; un lien, un .pyc ou un .DS_Store le sont où qu’ils soient')
    expect(text).toContain("git -C '<worktree>' status --porcelain --untracked-files=all")
    // Les dossiers jetables exclus de la liste : un .env ne se perd pas dans node_modules/.
    expect(text).toContain("git -C '<worktree>' ls-files --others --ignored --exclude-standard -- . ':(exclude,glob)**/__pycache__/**' ':(exclude,glob)**/.show-your-work/**' ':(exclude,glob)**/.pytest_cache/**' ':(exclude,glob)**/.mypy_cache/**' ':(exclude,glob)**/.ruff_cache/**' ':(exclude,glob)**/node_modules/**'")
    expect(text).toMatch(/tout autre fichier ignoré, tout fichier modifié ou non suivi arrête la fermeture : liste-les-moi, ne retire rien/)
  }
})

test('les étapes dans l’ordre : branche, ligne du worktree, fusion, arbre, instantanés, activité, arrêt, nouvelle vérification, retrait, claude rm', () => {
  // Chaque étape se trouve après la précédente.
  let from = 0
  for (const step of [
    "git log '<branche>' --oneline",
    'git worktree list --porcelain',
    'git branch --show-current',
    "git branch --merged '<branche de travail>'",
    "git -C '<worktree>' status --porcelain",
    "git -C '<worktree>' for-each-ref refs/worktree/flow-board/",
    '"status": "idle"',
    "claude stop '178bd61c'",
    'claude agents --json --all',
    "git worktree unlock '<worktree>'",
    "git worktree remove '<worktree>'",
    "claude rm '178bd61c'",
  ]) {
    const i = cli.indexOf(step, from)
    expect(`${step} @ ${i}`).not.toBe(`${step} @ -1`)
    from = i + step.length
  }
  // Le worktree se désigne par sa ligne, retrouvée par la branche vérifiée, jamais par un chemin deviné.
  expect(cli).toContain('jamais par un chemin deviné')
  // Le déverrouillage seulement sur une ligne « locked », une fois la session montrée arrêtée.
  expect(cli).toMatch(/seulement si sa ligne de git worktree list --porcelain porte locked, .* et une fois la session montrée arrêtée/)
  // Le signe « ne travaille plus » : status idle, pas state ; arrêtée : sans pid.
  expect(cli).toContain('"status": "idle"')
  expect(cli).toMatch(/sans pid, en "state": "stopped" ou "done"/)
  // claude rm sans option, après le retrait du worktree.
  expect(cli).toMatch(/claude rm '178bd61c', sans aucune option/)
})

test('les questions du compte rendu, le worktree en HEAD détachée, et la fusion revérifiée après l’arrêt', () => {
  for (const text of [cli, app, unknown, pistes]) {
    expect(text).toContain('0) ses questions : relis son compte rendu ; si une question qu’il pose attend encore une réponse (de moi ou d’ici), ne ferme rien et dis-le-moi')
    expect(text.indexOf('0) ses questions')).toBeLessThan(text.indexOf('1) la branche'))
  }
  // « Déjà retiré » seulement si aucun bloc ne porte le dossier de la session ; la fusion se vérifie quand même.
  expect(cli).toContain(
    "s’il y en a un (HEAD détachée, rebase ou bisect en cours), arrête la fermeture et dis-le-moi ; seulement si aucun bloc ne le porte et que test -e '<dossier>' échoue (le dossier n’existe plus), le worktree est déjà retiré : fais quand même le point 3",
  )
  expect(cli).toContain('refais d’abord les deux vérifications de core.fsmonitor, dans ce dossier puis sur le worktree (la session a pu la poser avant son arrêt : une valeur qui n’est pas un booléen arrête la fermeture comme au début), puis les vérifications des points 3, 4 et 5')
  expect(cli).toContain(
    "seulement une fois le worktree retiré par cette fermeture (git worktree remove a réussi, git worktree list --porcelain n’a plus de bloc pour <worktree> et test -e '<worktree>' échoue ; sinon arrête-toi) : claude rm '178bd61c'",
  )
})

test('un worktree constaté déjà retiré au départ : pas de claude rm, la session reste dans claude agents et Claude le dit (série 14, Q1)', () => {
  // L'effet d'abord : claude rm suit bien un retrait fait par la fermeture.
  expect(cli).toContain("claude rm '178bd61c', sans aucune option")
  expect(cli).toContain(
    "le worktree est déjà retiré : fais quand même le point 3, puis passe au point 6, sans les points 8, 9 et 10 : pas de claude rm (son worktree n’a pas été vu retiré ici) ; une session du CLI que le point 6 trouve encore dans claude agents y reste : dis-le-moi",
  )
  expect(cli).toContain('un worktree constaté déjà retiré au point 2 : pas de claude rm, dis-moi que la session reste dans la liste de claude agents')
  expect(cli).not.toContain('ou constaté déjà retiré au point 2')
  expect(cli).not.toContain('sans les points 8 et 9)')
})

test('les reports et les arrêts : session qui travaille, déjà fait, commits pas fusionnés, instantané', () => {
  expect(cli).toMatch(/si elle travaille \("status": "busy", ou "state": "working"\), remets la fermeture à plus tard, sans erreur : n’arrête rien/)
  expect(cli).toContain('une session déjà arrêtée ou un worktree déjà retiré comptent comme déjà faits, pas comme une erreur')
  expect(cli).toMatch(/des commits pas fusionnés arrêtent la fermeture/)
  expect(cli).toMatch(/identique à l’arbre d’un commit déjà dans la branche de travail.*continue, et dis-le dans le compte rendu ; sinon, arrête la fermeture/)
})

test('la ligne « commits dans la branche de travail » et la conversation gardée, dans chaque compte rendu', () => {
  for (const text of [cli, app, unknown, pistes]) {
    expect(text).toContain('« les N commits de <branche> sont dans <branche de travail> (vérifié) ; ils partiront au push de fin de parcours »')
    expect(text).toContain('claude --resume <sessionId>')
  }
})

test('le refus de claude rm pour commits non poussés, et le geste dans l’app : rien de forcé, dit en clair', () => {
  expect(cli).toContain(
    'si claude rm refuse pour des commits non poussés, ne force rien : dis-moi que la session reste dans la liste de claude agents, que ses N commits sont tous dans <branche de travail> (vérifié), et qu’un ctrl+x de ma part ne supprimerait que la branche <branche>, pas ces commits',
  )
  // Une session de l'app : archivée par l'outil de l'app s'il existe, sinon le geste écrit à la personne.
  expect(app).toContain('c’est une session de l’app Desktop')
  expect(app).toContain('archive-la par l’outil de session de l’app s’il t’en donne un (stop_session n’interrompt qu’un tour, il ne l’archive pas)')
  expect(app).toContain(
    'écris-moi en clair, sans attendre ma réponse pour continuer le reste du parcours (les autres groupes, pas les points 8 à 10 de cette fermeture, qui attendent « archivée ») : « Archive dans la liste des sessions de l’app Claude Desktop la session dont le titre commence par « Fermeture auto > Groupe B · »',
  )
  expect(app).toContain('ses N commits sont tous dans <branche de travail> (vérifié), rien n’est perdu même si l’app parle de changements ; dis-moi « archivée » et je retire son worktree. »')
  expect(app).toContain('pour l’app, archivée, ce qui vaut « montrée arrêtée »), refais d’abord les deux vérifications de core.fsmonitor')
  expect(app).not.toContain('claude stop local_ab12')
  expect(app).not.toContain('claude rm local_ab12')
  // Id inconnu : on la cherche par son titre, et une session que le CLI ne connaît pas est une session de l'app.
  expect(unknown).toContain('« Fermeture auto > Groupe B · »')
  expect(unknown).toContain('seule une session que ListAgents montre en « Claude Desktop session » est de l’app')
  // Absente de claude agents --json --all : déjà retirée du CLI, pas une session de l'app (S4).
  expect(cli).toContain('absente des deux, et sans ligne dans ListAgents dont le titre commence par « Fermeture auto > Groupe B · »')
  expect(cli).toContain('elle est déjà retirée du CLI (déjà fait) ; une telle ligne (busy ou idle) est une session encore là')
  // Retenue seulement si son cwd est le worktree vérifié ; le verrou d'un autre arrête tout.
  expect(cli).toContain('retenue seulement si son cwd est <worktree>')
  expect(cli).toContain('que la raison du verrou nomme cette session')
  expect(cli).toContain('un autre verrou (posé à la main, une autre session) arrête la fermeture')
  expect(cli).toContain("N, le nombre de ses commits que le CLI dit non poussés : git rev-list --count '<branche>' --not --remotes")
})

test('les branches d’un envoi suivant d’un groupe portent son numéro', () => {
  const second = closingProcedure({ run, target: group, isRepo: true, session: '178bd61c', seq: 2 })
  expect(second).toContain('worktree-groupe-fermeture-auto-B-2 (lancée par le CLI), groupe-fermeture-auto-B-2 ou claude/groupe-fermeture-auto-B-2-<suffixe> (lancée par l’app) ;')
  // Ni le nom d'avant la 0.59.0, ni le titre du premier envoi : le sien, numéroté.
  expect(second).not.toContain('groupe-B pour un groupe lancé avant')
  expect(second).toContain('« Fermeture auto > Groupe B (envoi 2) · »')
  expect(second).not.toContain('« Fermeture auto > Groupe B · »')
  // Le premier envoi exclut les noms et titres des suivants.
  expect(cli).toContain('jamais celles d’un envoi suivant du groupe (groupe-fermeture-auto-B-2, claude/groupe-fermeture-auto-B-2-<suffixe>…), ni une session au titre « Groupe B (envoi <n°>) · »')
  expect(closingProcedure({ run, target: group, isRepo: true, session: '178bd61c', seq: 1 })).toBe(cli)
})

test('les branches possibles du groupe et de la session de pistes', () => {
  expect(cli).toContain('worktree-groupe-fermeture-auto-B (lancée par le CLI)')
  expect(cli).toContain('claude/groupe-fermeture-auto-B-<suffixe>')
  expect(cli).toContain('groupe-B pour un groupe lancé avant la 0.59.0')
  expect(pistes).toContain('la session des pistes de la phase Rétro')
  expect(pistes).toContain('worktree-pistes (lancée par le CLI)')
  expect(pistes).toContain('« Fermeture auto > Pistes · »')
  expect(pistes).toContain("claude stop '9f9f9f9f'")
})

test('sans git : l’arrêt seul, après avoir vérifié que les tickets sont faits et que la session ne travaille plus', () => {
  expect(noGit).toContain('ce dossier n’a pas de git, donc pas de worktree')
  expect(noGit).toContain('vérifie d’abord que ses tickets sont faits et rendus ici')
  expect(noGit).toContain('"status": "idle"')
  expect(noGit).toContain("claude stop '178bd61c'")
  const body = (text: string) => text.replace('ce dossier n’a pas de git, donc pas de worktree', '')
  expect(body(noGit)).not.toMatch(/git |worktree|claude rm|branche de travail/)
  expect(noGit).toContain('claude --resume <sessionId>')
  const noGitApp = closingProcedure({ run, target: group, isRepo: false, session: 'local_ab12' })
  expect(body(noGitApp)).not.toMatch(/git |worktree|claude rm|branche de travail|claude --resume <sessionId> \(le champ/)
  expect(noGitApp).toContain('sa conversation est gardée dans l’app')
})
