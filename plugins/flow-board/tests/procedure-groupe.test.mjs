// La procédure d'une session liée de groupe (reference/procedure-groupe.md) : le texte de délégation
// la cite par son chemin au lieu de la recopier. Ces tests lisent le fichier, ce que `claude plugin
// test` ne permet pas ; ceux du texte de délégation (groupes.test.ts, brief-sessions-liees.test.ts)
// vérifient qu'il la cite.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const procedure = read('reference/procedure-groupe.md')
const register = read('hooks/register.tsx')

/** Le texte d'une section (`## <n>. …`) de la procédure, jusqu'à la suivante. */
const section = n => {
  const m = procedure.match(new RegExp(`^## ${n}\\. [^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))
  assert.ok(m, `section ${n} absente`)
  return m[1]
}
const has = (text, ...parts) => {
  for (const part of parts) assert.ok(text.includes(part), `absent : « ${part} »`)
}

test('la procédure a chaque étape : questions, tickets, règles, revue du groupe, sécurité, compte rendu, relecteurs, choix, sans git', () => {
  const titles = [...procedure.matchAll(/^## (\d+)\. (.+)$/gm)].map(m => `${m[1]}. ${m[2]}`)
  assert.deepEqual(titles, [
    '1. Avant le premier ticket',
    '2. Chaque ticket, un par un et dans l\'ordre',
    '3. Règles de travail',
    '4. Revue du groupe',
    '5. Revue de sécurité',
    '6. Compte rendu',
    '7. La consigne des relecteurs',
    '8. Le fichier des choix déjà déclarés',
    '9. Sans git',
  ])
})

test('le texte de délégation cite la procédure par son chemin installé, à côté de la méthode de sécurité', () => {
  assert.match(register, /const PROCEDURE_FILE = 'reference\/procedure-groupe\.md'/)
  assert.match(register, /procedurePath = `\$\{root\}\/\$\{PROCEDURE_FILE\}`/)
  assert.match(register, /2\) puis lire la procédure d'une session liée de groupe, \$\{procedurePath\}, et la suivre jusqu'au bout/)
  // La procédure n'est plus recopiée dans le texte de délégation.
  assert.doesNotMatch(register, /const (TICKET_SNAPSHOT_FR|COMMIT_BEFORE_REVIEW_FR|REVIEWER_BRIEF_FR|LONG_COMMANDS) =/)
})

test('avant le premier ticket : les questions sensibles en une fois', () => {
  has(section(1), 'Me poser en une fois les questions sensibles du groupe', 'et attendre mes réponses')
})

test('chaque ticket : décisions relues, statut, TDD, revue à deux axes en un relecteur, passe « bogues », instantané, commit', () => {
  const s = section(2)
  has(
    s,
    'Relire d\'abord le fichier de décisions du projet et les commentaires « mise à jour du porteur » du ticket',
    'le relais y reconnaît la passe « bogues » d\'un ticket en cours',
    'n\'est pas un blocage externe : le ticket reste « en cours », ligne « Statut : en attente (porteur) », jamais « blocked » au tableau de bord',
    '`<tdd>` par l\'outil Skill (le sauter pour un ticket sans comportement testable : une ressource visuelle, un document)',
    'sur les seuls changements du ticket (point fixe : le commit d\'avant le ticket), les deux axes dans un seul sous-agent relecteur (outil Agent, modèle opus, effort high, passés explicitement), quelle que soit la taille du diff',
    'arguments « <niveau> <plage de l\'instantané> consignes : <chemin> »',
    '<niveau> valant xhigh si le ticket supprime des données ou touche la concurrence',
    'l\'invariant du ticket quand il en a un',
    '`git update-ref refs/worktree/flow-board/<id du ticket> <instantané>`',
    'les deux revues lisent alors la plage `refs/worktree/flow-board/<id du ticket>^..refs/worktree/flow-board/<id du ticket>`',
    'le vrai commit du ticket vient toujours après sa revue',
    '`/code-review <niveau> <base>..HEAD consignes : <chemin>`',
    'jamais un hash seul',
    'envoyer ses constats à l\'outil flow, `{"review": {"standards": <n>, "spec": <n>, "fixed": <corrigés>}}`',
    '`{"security": {"group": "<id du groupe>", "advised": true|false, "why": "<raison>", "findings": <failles gardées>, "fixed": <corrigées>}}`',
    'sa cible est alors `<commit d\'avant le ticket>..<commit du ticket>`, jamais `..HEAD`',
    'Ne pas lancer `<implement>` par l\'outil Skill : il est réservé à l\'utilisateur',
  )
})

test('règles de travail : sous-agents en lecture seule, dossier temporaire, attentes notifiées, délais, planche, mises à jour', () => {
  has(
    section(3),
    'sans sous-agents qui écrivent',
    'seule exception, une session qui ne tourne pas sur Opus et confie sa revue du groupe à un relecteur Opus',
    '`printenv CLAUDE_JOB_DIR`, seule dans sa commande',
    'Ne jamais attendre par `sleep`',
    'pas de Monitor pour un sous-agent',
    'avancer ce qui ne dépend pas d\'elle',
    'me poser tout de suite une question prête, sans attendre la fin de la revue',
    'sans nouvelles depuis 10 à 15 minutes',
    'Une commande longue (tests, build) se lance avec un délai maximal',
    'ne jamais rendre la main en attendant un processus d\'arrière-plan qui n\'a pas de délai',
    'produire une planche (les variantes côte à côte, dans un fichier)',
    'un commentaire daté « mise à jour du porteur »',
    'd\'après la ligne de résumé de la sortie des tests, jamais de mémoire',
    'Si l\'outil flow répond que le parcours est en pause',
  )
})

test('revue du groupe : lancée par la session, high --fix sur <base>..HEAD, sans --fix en zone sensible, conflit remonté', () => {
  has(
    section(4),
    'un groupe d\'un seul ticket ni sensible ni avec logique n\'a pas de revue du groupe',
    'par l\'outil Skill, sans sous-agent qui l\'enveloppe',
    'arguments « high --fix <base>..HEAD consignes : <chemin> »',
    'avec pour cible `<base>..HEAD` (<base> : le commit d\'où part sa branche)',
    'se concentrer sur les interactions entre les tickets',
    'sans `--fix` : la session applique elle-même les seuls constats qu\'elle retient',
    'Elle ne tranche pas un conflit entre la spec et une consigne (CLAUDE.md, une demande de ma part) : elle ne corrige pas ce point et me le remonte',
    'relire le diff de ses correctifs, relancer les contrôles et les commiter',
  )
})

test('revue de sécurité : relecteur en lecture seule sur le diff du groupe, jamais /security-review, failles numérotées, pas de seconde passe', () => {
  has(
    section(5),
    'Dans le même message que la revue du groupe',
    'type general-purpose, modèle opus, effort high ou xhigh selon le critère du fichier de méthode',
    'avec pour seul périmètre `git diff <base>..HEAD`',
    'Ne pas lancer `/security-review`',
    'Ne pas corriger ce qu\'il trouve : les failles vont dans le compte rendu',
    'chaque faille gardée arrive numérotée (F1, F2…) avec un correctif prêt',
    'pas de seconde passe sur le diff de ses correctifs, sauf s\'il touche une zone coûteuse du fichier de méthode (sa section 1) ou dépasse 150 lignes modifiées hors tests',
  )
})

test('compte rendu : complet au relais, une ligne à la discussion principale', () => {
  has(
    section(6),
    'les fichiers modifiés, sa branche, les contrôles lancés et leur résultat',
    'la revue du groupe (constats, corrigés, et à part les constats sur du code antérieur au lot), la revue de sécurité (lancée ou non, pourquoi, failles trouvées)',
    '`{"report": "<le compte rendu entier>"}`',
    'une seule ligne qui renvoie au relais',
  )
})

test('la consigne des relecteurs : tous les axes avant le rapport, tri des constats, classe du défaut, lecture seule', () => {
  has(
    section(7),
    'Si la revue a plusieurs axes (Standards et Spec), ne rendre son rapport qu\'une fois tous les axes revenus',
    'étiqueter chaque constat Important, Mineur ou Antérieur',
    'les Mineurs (style, nommage, nettoyage qui ne change aucun comportement) ne sont pas corrigés et se rendent en un compte, sans détail',
    'pour un défaut, nommer sa classe',
    'ne signaler comme défaut ni appliquer rien de ce que la spec, le ticket ou le fichier des choix laisse à un autre groupe',
    'ne jamais écrire dans l\'arbre de travail, même un instant',
  )
})

test('sans git : copies avant chaque ticket, points fixes et périmètres par ces copies, pas d\'instantané', () => {
  has(
    section(9),
    'un sous-dossier par ticket qui garde le chemin dans le projet (`<dossier temporaire>/<id du ticket>/<chemin dans le projet>`)',
    'un fichier que le ticket crée n\'a pas de copie : il est nouveau et se lit en entier',
    'la copie de ses fichiers prise avant le ticket, comparée aux fichiers actuels',
    '`/code-review <niveau> consignes : <chemin>` (le fichier liste les copies et les fichiers à comparer)',
    'arguments « high --fix consignes : <chemin> », sur les changements du groupe (point fixe : pour chaque fichier, la plus ancienne copie parmi les tickets du groupe',
    'pas d\'instantané',
  )
})

// Les pistes de la rétro du parcours « Frise, groupes et titres ».

test('r20 : une lecture d’une décision hors zone sensible se code, se déclare et la session continue', () => {
  has(
    section(1),
    'Seules les questions sensibles et les choix de conception attendent ma réponse',
    'la coder selon l\'option la plus proche de la décision, la déclarer dans `{"decided": …}` avec sa raison, et continuer',
  )
})

test('r6 et r22 : le fichier de consignes donne CODING_STANDARDS.md et, pour un ticket, les critères des tickets faits du groupe', () => {
  has(procedure, '- si le projet a un `CODING_STANDARDS.md` à sa racine')
  has(
    section(2),
    'il lit le `CODING_STANDARDS.md` dont le fichier de consignes donne le chemin (point 7)',
    'le chemin de `CODING_STANDARDS.md` à la racine du dossier de travail quand le prompt dit que le projet en a un',
    'pour la revue d\'un ticket, aussi les critères des tickets déjà faits du groupe qui touchent les mêmes fichiers, recopiés',
  )
  has(section(4), 'le chemin de `CODING_STANDARDS.md` s\'il existe')
})

test('r11 : les critères du ticket cochés avant son commit, chacun avec son test', () => {
  has(section(2), 'avant le commit, cocher chaque critère du fichier de ticket (`- [x]`) et nommer à côté le test qui le couvre')
})

test('r21 : les règles de travail disent ce que le garde-fou refuse vraiment, sans cd ni enveloppe timeout inutile', () => {
  const s = section(3)
  has(
    s,
    'Le garde-fou d\'un worktree refuse les commandes qu\'il ne sait pas lire',
    'Pas de `cd` dans un sous-dossier',
    'la commande `timeout` n\'existe pas sur macOS',
    'un script de contrôles qui fixe déjà son délai (le CLAUDE.md du projet le dit) se lance sans enveloppe',
  )
  assert.ok(!s.includes('jamais par une boucle cat ou head'), 'l\'ancienne consigne de lecture est restée')
})

test('r3 : après le compte rendu, un correctif suit la procédure du ticket, une question se tranche dans la discussion principale', () => {
  has(
    section(6),
    'Après le compte rendu, un correctif appliqué par la session',
    'suit la procédure du ticket (section 2 : contrôles, revue, passe « bogues » s\'il touche une zone sensible, commit)',
    'Une question du compte rendu se tranche dans la discussion principale ; la session n\'applique rien d\'autre sans un message de celle-ci',
  )
})

test('r5 : un choix déclaré ne se défait pas par préférence, mais un défaut qu’il produit se signale ; plus de copie de l’ancienne consigne', () => {
  has(section(7), 'ne pas défaire par préférence un choix de ce fichier, ni le resignaler comme tel, mais signaler tout cas où il produit un défaut, avec son scénario')
  has(section(8), 'signale tout cas où l\'un d\'eux produit un défaut, avec son scénario')
  const sources = { procedure, register, catalog: read('hooks/catalog.ts'), model: read('hooks/model.ts') }
  for (const [name, text] of Object.entries(sources)) {
    for (const old of ['ne pas resignaler ni défaire', 'à ne pas resignaler ni défaire', 'do not report again nor undo', 'not to be reported again nor undone', 'une revue ne les resignale pas']) {
      assert.ok(!text.includes(old), `${name} garde l'ancienne consigne « ${old} »`)
    }
  }
})
