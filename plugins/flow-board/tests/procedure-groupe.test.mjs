// La procédure d'une session liée de groupe (reference/procedure-groupe.md) : le texte de délégation
// la cite par son chemin au lieu de la recopier. Ces tests lisent le fichier, ce que `claude plugin
// test` ne permet pas ; ceux du texte de délégation (groupes.test.ts, brief-sessions-liees.test.ts)
// vérifient qu'il la cite.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const procedure = read('reference/procedure-groupe.md')
const template = read('reference/consignes-revue.md')
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
    '10. Session autonome',
  ])
})

test('session autonome : seulement sur le dire du prompt, choix tranchés après l’advisor et déclarés, le sensible ou douteux posé, revues à leur effort', () => {
  const s = section(10)
  has(
    s,
    'Seulement quand le prompt dit que la session est une session autonome',
    'la session le tranche elle-même, sans attendre ma réponse',
    "elle consulte l'advisor quand elle a l'outil `advisor` ; sans lui, elle relit elle-même son choix",
    'puis le déclare aussitôt dans `{"decided": …}` avec sa raison',
    'ou dont la sensibilité est douteuse, reste une question pour moi : dans le doute, sensible',
    "Ses revues gardent l'effort que leur fixe la règle des revues",
    '`config/rules/agents.md`',
  )
  // Les règles se citent, elles ne se recopient pas.
  assert.doesNotMatch(s, /effort high, passés explicitement|Standards et Spec dans un seul/)
  // Hors d'une session autonome, les choix de conception attendent toujours la réponse.
  has(section(1), "Seules les questions sensibles et les choix de conception attendent ma réponse (sauf dans une session autonome : section 10)")
  // Le texte de délégation la cite par la procédure, quand l'effort est xhigh.
  assert.match(register, /elle applique la section « Session autonome » de la procédure\"/)
})

test('le texte de délégation cite la procédure par son chemin installé, à côté de la méthode de sécurité', () => {
  assert.match(register, /const PROCEDURE_FILE = 'reference\/procedure-groupe\.md'/)
  assert.match(register, /procedurePath = `\$\{root\}\/\$\{PROCEDURE_FILE\}`/)
  assert.match(register, /const procedure = isSource \? `\$\{MOD_SOURCE\}\/\$\{PROCEDURE_FILE\} du dossier de travail \(source du dépôt, qui fait foi ; sinon \$\{procedurePath\}\)` : procedurePath/)
  assert.match(register, /2\) puis lire la procédure d'une session liée de groupe, \$\{procedure\}, et la suivre jusqu'au bout/)
  // La procédure n'est plus recopiée dans le texte de délégation.
  assert.doesNotMatch(register, /const (TICKET_SNAPSHOT_FR|COMMIT_BEFORE_REVIEW_FR|REVIEWER_BRIEF_FR|LONG_COMMANDS) =/)
})

test('relecture du fond et de la forme : la revue d’un ticket « Lecteur » la lance, sa méthode existe et se cite par son chemin', () => {
  has(procedure, '- le chemin du fichier de méthode de la relecture du fond et de la forme (`relecture-fond-forme.md`, dans le dossier de ce fichier)')
  has(
    section(2),
    'pour un ticket qui a une ligne « Lecteur : <qui> », lancer dans le même message, sur la même cible, la relecture du fond et de la forme',
    'un sous-agent relecteur (outil Agent, type general-purpose, modèle opus, effort high, passés explicitement), en lecture seule',
    'le chemin du fichier de méthode de la relecture du fond et de la forme dans son prompt, à côté de son fichier de consignes',
    'nommer soi-même le lecteur et le déclarer dans `{"decided": …}`',
    'son fichier de consignes donne le lecteur visé (la ligne « Lecteur », ou celui que la session a nommé)',
    'ses constats comptent avec ceux de l\'axe Spec',
    'Ce que la session retient de la relecture part dans le commit des correctifs de la revue, avant que le ticket passe « fait »',
  )
  // Le fichier de méthode existe à son chemin, et le texte de délégation le cite par son chemin installé.
  const method = read('reference/relecture-fond-forme.md')
  has(
    method,
    'Le lecteur visé',
    "L'exactitude",
    'La complétude pour ce lecteur',
    'La cohérence des termes',
    'Lecture seule',
    'numérotés R1, R2…, du plus important au moins important',
    'Correction proposée',
    'Les constats mineurs se rendent en un compte, sans détail',
  )
  assert.match(register, /const READING_METHOD_FILE = 'reference\/relecture-fond-forme\.md'/)
  assert.match(register, /le fichier de méthode de la relecture du fond et de la forme, \$\{cite\(readingMethod, READING_METHOD_FILE\)\}/)
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
  has(section(2), 'il lit le `CODING_STANDARDS.md` dont le fichier de consignes donne le chemin (point 7)')
  has(
    template,
    '[Les règles de jugement : `<racine du dossier de travail>/CODING_STANDARDS.md`.]',
    '[Revue d\'un ticket : les critères des tickets déjà faits du groupe qui touchent les mêmes fichiers, recopiés',
  )
  has(section(4), 'le chemin de `CODING_STANDARDS.md` s\'il existe')
})

// Rétro du parcours « Lancer un groupe en xhigh » : trois fichiers de consignes presque identiques
// écrits à la main (r11), un commit de statut seul pour le hash du ticket (r12), un ticket de version
// en collision avec une autre discussion (r2).

test('gabarit : le fichier de consignes se remplit d’après un gabarit, qui porte la consigne des relecteurs telle quelle', () => {
  has(section(2), 'copier dans son dossier temporaire le gabarit `consignes-revue.md` (dans le dossier de ce fichier), en remplir les trous')
  // Le point 7 renvoie au gabarit au lieu d'en décrire le contenu.
  assert.ok(!section(2).includes('les points qui me sont réservés, ce qu\'elle ne doit pas faire'), 'le point 7 décrit encore le contenu')
  has(
    template,
    'Cible : `<base>..<fin>`, jamais un hash seul',
    '`git diff <base>..<fin> -- <chemins du parcours>`',
    'Les choix déjà déclarés : `<chemin du fichier des choix>`',
    'l\'invariant du ticket',
    'le lecteur visé',
    'Réservé au porteur du parcours',
    'À ne pas faire',
  )
  // La consigne des relecteurs : la même, mot pour mot, que la section 7.
  const quote = text => text.split('\n').find(line => line.startsWith('> '))
  assert.equal(quote(template), quote(section(7)))
})

test('statut : la ligne Status: dit « fait » sans hash, jamais dans un commit de statut seul', () => {
  has(
    section(2),
    'Un ticket local (un fichier) dit « fait » dans sa ligne `Status:` sans hash',
    'jamais à un commit de statut seul',
    'Critères et ligne `Status:` se cochent par l\'outil Edit, sans script',
  )
})

test('version : une session liée ne touche ni aux versions ni aux CHANGELOG, et liste ce que le CHANGELOG devra dire', () => {
  has(
    section(3),
    'Ne toucher ni aux versions (fichiers de version, entrée d\'une marketplace) ni aux CHANGELOG, même si un ticket le demande',
    'par `/project:version`, que je lance',
  )
  has(section(6), 'ce que le CHANGELOG devra dire, plugin ou paquet par plugin ou paquet')
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
