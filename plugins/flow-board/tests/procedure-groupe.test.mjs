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

test('avant le premier ticket : les questions sensibles en une fois, trouvées par une passe en lecture seule, sans attendre à vide', () => {
  has(
    section(1),
    'Me poser en une fois les questions sensibles du groupe',
    'une passe en lecture seule « ce qui viole l\'invariant » sur chaque ticket sensible et le code qu\'il touche',
    'remonte toutes ses questions d\'un coup',
    'En attendant mes réponses, avancer les tickets qui n\'en dépendent pas',
    'Un choix qui change qui écrit, fusionne ou efface une donnée est une question, jamais un choix déclaré',
  )
  assert.ok(!section(1).includes('et attendre mes réponses'), 'la session attend encore à vide')
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
    'dont le prompt se remplit d\'après le gabarit `prompt-relecteur.md` (dans le dossier de ce fichier)',
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
    'un groupe dont chaque ticket est dit ni sensible ni avec logique n\'a ni revue du groupe ni revue de sécurité',
    'un seul ticket avec de la logique, en zone sensible, ou qui ne dit pas l\'un des deux, et la revue du groupe et l\'avis de sécurité sont dus',
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
    'Un groupe sans revue du groupe (section 4) n\'a pas non plus de revue de sécurité',
    'dans le même message que la revue du groupe',
    'type general-purpose, modèle opus, effort high ou xhigh selon le critère du fichier de méthode',
    'avec pour seul périmètre `git diff <base>..<lancement>`',
    '<lancement> : le hash de HEAD au lancement, écrit en clair dans ses consignes',
    'pour sa recherche ; ses vérifications tournent en high',
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

test('une lecture d’une décision hors zone sensible se code, se déclare et la session continue', () => {
  has(
    section(1),
    'Seules les questions sensibles et les choix de conception attendent ma réponse',
    'la coder selon l\'option la plus proche de la décision, la déclarer dans `{"decided": …}` avec sa raison, et continuer',
  )
})

test('le fichier de consignes donne CODING_STANDARDS.md et, pour un ticket, les critères des tickets faits du groupe', () => {
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

test('les critères du ticket cochés avant son commit, chacun avec son test', () => {
  has(section(2), 'avant le commit, cocher chaque critère du fichier de ticket (`- [x]`) et nommer à côté le test qui le couvre')
})

test('les règles de travail disent ce que le garde-fou refuse vraiment, sans cd ni enveloppe timeout inutile', () => {
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

test('après le compte rendu, un correctif suit la procédure du ticket, une question se tranche dans la discussion principale', () => {
  has(
    section(6),
    'Après le compte rendu, un correctif appliqué par la session',
    'suit la procédure du ticket (section 2 : contrôles, revue, passe « bogues » s\'il touche une zone sensible, commit)',
    'Une question du compte rendu se tranche dans la discussion principale ; la session n\'applique rien d\'autre sans un message de celle-ci',
  )
})

test('un choix déclaré ne se défait pas par préférence, mais un défaut qu’il produit se signale ; plus de copie de l’ancienne consigne', () => {
  has(section(7), 'ne pas défaire par préférence un choix de ce fichier, ni le resignaler comme tel, mais signaler tout cas où il produit un défaut, avec son scénario')
  has(section(8), 'signale tout cas où l\'un d\'eux produit un défaut, avec son scénario')
  const sources = { procedure, register, catalog: read('hooks/catalog.ts'), model: read('hooks/model.ts') }
  for (const [name, text] of Object.entries(sources)) {
    for (const old of ['ne pas resignaler ni défaire', 'à ne pas resignaler ni défaire', 'do not report again nor undo', 'not to be reported again nor undone', 'une revue ne les resignale pas']) {
      assert.ok(!text.includes(old), `${name} garde l'ancienne consigne « ${old} »`)
    }
  }
})

// Les pistes de la rétro du parcours « Fermeture auto des sessions liées ».

test('un constat de passe « bogues » qui ne viole pas l’invariant va aux pistes, sans question', () => {
  has(
    section(2),
    'un constat de la passe « bogues » qui ne le viole pas n\'ouvre pas de question : il va au compte rendu, sous « Pistes » (section 6)',
    'seul ce qui viole l\'invariant se corrige ou devient une question',
  )
  has(section(6), 'les pistes (les constats des passes « bogues » qui ne violent pas l\'invariant')
  has(template, 'un constat qui ne le viole pas se range sous « Pistes », sans question ni correctif')
})

test('une question sensible née en cours de ticket part tout de suite, le commit attend la réponse', () => {
  has(
    section(3),
    'Une question sensible née en cours de ticket part tout de suite à la discussion principale par SendMessage (ses options, la recommandée en tête), sans attendre le compte rendu',
    'le commit du ticket attend la réponse, et la session avance ce qui n\'en dépend pas',
  )
})

test('du code écrit après la passe « bogues » repasse en revue, la ligne « Zone sensible » du ticket qui reçoit une garde se relit', () => {
  has(
    section(2),
    'Du code écrit après la passe « bogues » (un ajout demandé ensuite, un correctif venu d\'une autre revue) repasse en revue avant son commit',
    'la ligne « Zone sensible » du ticket qui la reçoit se relit',
  )
})

test('décisions lues par leur entrée, réglages du poste relevés à un essai, confiance du dossier lue sans afficher le fichier', () => {
  has(section(2), 'un fichier de décisions long se lit par la série ou l\'entrée que citent le ticket ou le prompt')
  has(
    section(3),
    'relève d\'abord les réglages du poste qui jouent (`worktree.baseRef`, la version de Claude Code, la confiance du dossier)',
    'Un essai qui lance `claude --bg` se fait de préférence dans un dépôt déjà de confiance',
    'jamais le reste de `~/.claude.json` (ni Read, ni `cat`), qui peut porter des jetons',
  )
  // La commande est celle du texte de lancement (TRUST_COMMAND de catalog.ts), mot pour mot.
  const command = read('hooks/catalog.ts').match(/export const TRUST_COMMAND = `([^`]*)`/)
  assert.ok(command, 'TRUST_COMMAND absent de catalog.ts')
  has(section(3), `par cette commande qui n'affiche que sa valeur (\`python\` sous Windows) : \`${command[1]}\``)
})

test('pas d’appel final à l’advisor quand les revues du groupe ont tourné', () => {
  has(section(6), 'Pas d\'appel final à l\'advisor quand les revues du groupe ont tourné : elles en tiennent lieu')
})

test('les phrases jamais suivies sont retirées', () => {
  for (const old of ['se cochent par l\'outil Edit, sans script', 'sans nouvelles depuis 10 à 15 minutes']) assert.ok(!procedure.includes(old), `reste : « ${old} »`)
})

test('la consigne des relecteurs classe l’antérieur qui viole l’invariant, le texte rendu faux, les tests voisins', () => {
  has(
    section(7),
    'sauf un constat sur du code antérieur qui viole l\'invariant du ticket : il est Important et se corrige',
    'dans un groupe « durcissement », le code qu\'il vise n\'est pas antérieur au lot',
    'une description, un commentaire ou un texte de documentation que le diff rend faux est Important',
    'l\'absence dans le fichier de décisions d\'un choix pris en session n\'est pas un constat',
    'la revue d\'un ticket cherche aussi les tests voisins qui lisent le même observable',
  )
})

test('le gabarit du prompt du relecteur unique existe et dit de ne pas invoquer le skill', () => {
  const prompt = read('reference/prompt-relecteur.md')
  has(
    prompt,
    'N\'invoque pas le skill code-review et ne lance aucun sous-agent : fais toi-même les deux axes',
    '`<chemin du fichier de consignes>`',
    '**Axe Standards**',
    '**Axe Spec**',
    'les Mineurs en un compte par axe, sans détail',
  )
  has(read('README.md'), '├── reference/prompt-relecteur.md')
})
