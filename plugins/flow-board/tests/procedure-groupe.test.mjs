// La procédure d'un worker de groupe (reference/procedure-groupe.md, son noyau, et ses annexes) : le
// texte de délégation cite le noyau par son chemin au lieu de le recopier. Ces tests lisent les fichiers,
// ce que `claude plugin test` ne permet pas ; ceux du texte de délégation (groupes.test.ts,
// brief-sessions-liees.test.ts) vérifient qu'il la cite.

import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
/** Le noyau, lu par chaque worker et relu après une compaction. */
const procedure = read('reference/procedure-groupe.md')
const template = read('reference/consignes-revue.md')
const register = read('hooks/register.tsx')

/**
 * Le fichier de chaque section : le noyau garde celles lues à chaque ticket ; les autres sont dans des
 * annexes du même dossier, sous leurs numéros (décision de la rétro « Économie d'usage » : un noyau et quatre annexes).
 */
const FILE_OF = {
  1: 'procedure-groupe.md', 2: 'procedure-groupe.md', 3: 'procedure-groupe.md', 7: 'procedure-groupe.md', 8: 'procedure-groupe.md',
  4: 'procedure-groupe-fin.md', 5: 'procedure-groupe-fin.md', 6: 'procedure-groupe-fin.md',
  9: 'procedure-groupe-sans-git.md', 10: 'procedure-groupe-autonome.md', 11: 'effort-workers.md',
}
const ANNEXES = ['procedure-groupe-fin.md', 'procedure-groupe-cas.md', 'procedure-groupe-sans-git.md', 'procedure-groupe-autonome.md', 'effort-workers.md']
const files = Object.fromEntries(['procedure-groupe.md', ...ANNEXES].map(f => [f, read(`reference/${f}`)]))
/** La procédure entière, noyau et annexes : une phrase retirée ne reste dans aucun d'eux. */
const whole = Object.values(files).join('\n')

/** Les titres `## <n>. …` d'un texte ; les lignes de renvoi du noyau (« (annexe) ») à part. */
const titlesOf = text => [...text.matchAll(/^## (\d+)\. (.+)$/gm)].map(m => `${m[1]}. ${m[2]}`)

/** Le texte d'une section (`## <n>. …`), lue dans son fichier, jusqu'à la suivante. */
const section = n => {
  const m = files[FILE_OF[n]].match(new RegExp(`^## ${n}\\. (?![^\\n]*\\(annexe\\)$)[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))
  assert.ok(m, `section ${n} absente de ${FILE_OF[n]}`)
  return m[1]
}
const has = (text, ...parts) => {
  for (const part of parts) assert.ok(text.includes(part), `absent : « ${part} »`)
}

test('la procédure a chaque étape : questions, tickets, règles, revue du groupe, sécurité, compte rendu, relecteurs, choix, sans git', () => {
  const titles = Object.keys(FILE_OF).map(Number).sort((a, b) => a - b).map(n => titlesOf(files[FILE_OF[n]]).find(t => t.startsWith(`${n}. `) && !t.endsWith(' (annexe)')))
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
    '10. Worker autonome',
    '11. Pour le manager : effort des workers, après leur compte rendu',
  ])
})

// Un lot sans groupes fait dans la discussion de la mission suit la même procédure : sa consigne cite
// des sections qui existent, avec leur titre, et ses exceptions sont les cinq décidées au cadrage.
const catalog = read('hooks/catalog.ts')

test('lot sans groupes : les sections citées par sa consigne existent dans la procédure, avec leur titre', () => {
  const block = catalog.match(/export const LOT_SECTIONS[^=]*= \[([\s\S]*?)\n\]/)
  assert.ok(block, 'LOT_SECTIONS absent de catalog.ts')
  const cited = [...block[1].matchAll(/\[(\d+), (['"])(.*?)\2\]/g)].map(m => `${m[1]}. ${m[3]}`)
  const titles = titlesOf(whole)
  assert.deepEqual(cited.map(c => c.split('.')[0]), ['1', '2', '3', '4', '5', '7', '8', '9'])
  for (const c of cited) assert.ok(titles.includes(c), `section citée absente de la procédure : « ${c} »`)
})

test('lot sans groupes : exactement cinq exceptions, celles du cadrage, qui renvoient à des sections qui existent', () => {
  const block = catalog.match(/export const LOT_EXCEPTIONS[^=]*= \[([\s\S]*?)\n\]/)
  assert.ok(block, 'LOT_EXCEPTIONS absent de catalog.ts')
  const exceptions = [...block[1].matchAll(/^\s+(['"])(.*)\1,$/gm)].map(m => m[2])
  assert.equal(exceptions.length, 5)
  const keys = ['the relay and SendMessage', 'the ban on button questions', '« do not launch <implement> » (section 2, point 10)', 'section 10, replaced by the auto mode block', 'a worktree of its own']
  keys.forEach((key, i) => assert.ok(exceptions[i].startsWith(key), `exception ${i + 1} : « ${exceptions[i]} »`))
  // Elles se joignent par « ; » dans la consigne : aucune n'en porte.
  for (const e of exceptions) assert.ok(!e.includes('; ') && !e.includes('. '), `exception coupée : « ${e} »`)
  has(section(2), '10. Ne pas lancer `<implement>`')
  has(section(10), 'Seulement quand le prompt dit que la session est un worker autonome')
})

test('l’en-tête de la procédure nomme la discussion de la mission qui fait un lot sans groupes', () => {
  const head = procedure.slice(0, procedure.indexOf('## 1. '))
  has(head, 'Le manager qui fait lui-même un lot sans groupes suit aussi cette procédure, avec les exceptions que lui donne sa consigne')
})

test('worker autonome : seulement sur le dire du prompt, choix tranchés après l’advisor et déclarés, le sensible ou douteux posé, revues à leur effort', () => {
  const s = section(10)
  has(
    s,
    'Seulement quand le prompt dit que la session est un worker autonome',
    'la session le tranche elle-même, sans attendre ma réponse',
    "elle consulte l'advisor quand elle a l'outil `advisor` ; sans lui, elle relit elle-même son choix",
    'puis le déclare aussitôt dans `{"decided": …}` avec sa raison',
    'ou dont la sensibilité est douteuse, reste une question pour moi : dans le doute, sensible',
    "Ses revues gardent l'effort que leur fixe la règle des revues",
    '`config/rules/agents.md`',
  )
  // Les règles se citent, elles ne se recopient pas.
  assert.doesNotMatch(s, /effort high, passés explicitement|Standards et Spec dans un seul/)
  // Hors d'un worker autonome, les choix de conception attendent toujours la réponse.
  has(section(1), "Seules les questions sensibles et les choix de conception me sont posés (sauf dans un worker autonome : section 10), la recommandation codée en attendant : le commit d'un ticket n'attend que les cas de la section 3")
  // Le texte de délégation la cite par la procédure, quand l'effort est xhigh.
  assert.match(register, /elle applique la section « Worker autonome » de la procédure \(procedure-groupe-autonome\.md\)\"/)
})

test('le texte de délégation cite la procédure par son chemin installé, à côté de la méthode de sécurité', () => {
  assert.match(register, /const PROCEDURE_FILE = 'reference\/procedure-groupe\.md'/)
  assert.match(register, /procedurePath = `\$\{root\}\/\$\{PROCEDURE_FILE\}`/)
  assert.match(register, /const procedure = isSource \? `\$\{MOD_SOURCE\}\/\$\{PROCEDURE_FILE\} du dossier de travail \(source du dépôt, qui fait foi ; sinon \$\{procedurePath\}\)` : procedurePath/)
  assert.match(register, /2\) puis lire la procédure d'un worker de groupe, \$\{procedure\}, et la suivre jusqu'au bout/)
  // La procédure n'est plus recopiée dans le texte de délégation.
  assert.doesNotMatch(register, /const (TICKET_SNAPSHOT_FR|COMMIT_BEFORE_REVIEW_FR|REVIEWER_BRIEF_FR|LONG_COMMANDS) =/)
})

test('relecture du fond et de la forme : la revue d’un ticket « Lecteur » la lance, sa méthode existe et se cite par son chemin', () => {
  has(procedure, '- le chemin du fichier de méthode de la relecture du fond et de la forme (`relecture-fond-forme.md`, dans le dossier de ce fichier)')
  has(
    section(2),
    'pour un ticket qui a une ligne « Lecteur : <qui> », lancer dans le même message, sur la même cible, la relecture du fond et de la forme',
    'un spécialiste relecteur (outil Agent, type general-purpose, modèle opus, effort high, passés explicitement), en lecture seule',
    'le chemin du fichier de méthode de la relecture du fond et de la forme dans son prompt, à côté de son fichier de consignes',
    'nommer soi-même le lecteur et le déclarer dans `{"decided": …}`',
    'son fichier de consignes donne le lecteur visé (la ligne « Lecteur », ou celui que la session a nommé)',
    'ses constats se comptent dans `form`, jamais dans `spec`',
    'Ce que la session retient de la relecture part dans le commit des correctifs de la revue, avant que le ticket passe « fait »',
  )
  // Le fichier de méthode existe à son chemin, et le texte de délégation le cite par son chemin installé.
  const method = read('reference/relecture-fond-forme.md')
  has(
    method,
    'Le lecteur visé',
    "L'exactitude",
    "Un document qui donne des chiffres produits par un script : en recalculer trois, les plus lourds de conséquences, en relançant le script ou sa requête, et dire l'écart",
    'un script qui écrit sa sortie ne se relance que si elle peut aller dans le dossier du relecteur que donne ton fichier de consignes',
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
    'En attendant mes réponses, coder l\'option recommandée de façon réversible et continuer : seul le commit d\'un ticket touché par une question des cas bloquants de la section 3 attend sa réponse',
    'Un choix qui change qui écrit, fusionne ou efface une donnée est une question, jamais un choix déclaré',
  )
  assert.ok(!section(1).includes('et attendre mes réponses'), 'la session attend encore à vide')
})

test('chaque ticket : décisions relues, statut, TDD, revue à deux axes en un relecteur, passe « bogues », instantané, commit', () => {
  const s = section(2)
  has(
    s,
    'Relire d\'abord le fichier de décisions du projet et les commentaires « mise à jour du porteur » du ticket',
    'Avant d\'écrire du code, reposer les trois questions du classement sur le texte du ticket et le code qu\'il touche',
    'Un seul oui rend le ticket au moins sensible ; un oui à la deuxième ou à la troisième le rend très sensible',
    'corriger la ligne « Zone sensible » du ticket, suivre aussitôt les revues du nouveau niveau, et le dire au manager par une note de l\'outil flow (`{"note": …}`) et dans le compte rendu',
    'jamais redescendre un niveau',
    'un ticket devenu très sensible sans invariant dans son texte est une question sensible (section 3) avant d\'être commencé',
    'le relais y reconnaît la passe « bogues » d\'un ticket en cours',
    'n\'est pas un blocage externe : le ticket reste « en cours », ligne « Statut : en attente (porteur) », jamais « blocked » au tableau de bord',
    '`<tdd>` ne sert qu\'à un ticket qui change un comportement testable : le sauter pour un ticket de texte ou de renommage',
    'sur les seuls changements du ticket (point fixe : le commit d\'avant le ticket). Pour un ticket hors zone sensible, les deux axes dans un seul spécialiste relecteur (outil Agent, modèle opus, effort medium, passés explicitement), quelle que soit la taille du diff',
    'Pour un ticket sensible ou très sensible (un ticket muet compte comme sensible), l\'axe Spec seul, sans l\'axe Standards que sa passe « bogues » refait, dans un seul spécialiste relecteur (outil Agent, modèle opus, effort high, passés explicitement), nommé « Spec · <ticket> », d\'après la variante « axe Spec seul » du gabarit `prompt-relecteur.md`',
    'il ne juge pas le code sur `CODING_STANDARDS.md`, et ses constats partent avec `"standards": 0` (point 8)',
    'arguments « <niveau> --max-findings all <plage de l\'instantané> consignes : <chemin> »',
    '<niveau> valant xhigh si le ticket supprime des données (ou décide ou garde une suppression : ce qui est effacé dépend de son code, même s\'il n\'efface rien lui-même) ou touche la concurrence',
    'l\'invariant du ticket quand il en a un',
    'Après la passe « bogues », une seule passe high relit tout ce qui a changé depuis son instantané : ses correctifs, et le code ajouté après elle',
    'si cette passe trouve encore une violation de l\'invariant, la session la corrige, écrit le scénario en test et me pose la question, sans nouvelle passe',
    'sur la plage `<hash du premier instantané>..<hash d\'un nouvel instantané>`',
    'Un constat qui nomme d\'autres endroits (« même défaut dans X ») les fait tous corriger dès la première fois (hors du code antérieur au lot : section 7), et une classe de défaut qui revient une deuxième fois sans cela (par la revue du ticket, celle d\'un autre ticket du groupe ou cette passe) se traite de même',
    'la session cherche le motif de la classe et ses variantes (appelants, formes voisines), pas les seules lignes écrites, cite sa recherche (la commande et son résultat) au compte rendu et corrige toutes les occurrences d\'un coup, sans passe de plus pour elle',
    'il construit l\'arbre dans un index temporaire parti de `HEAD`, sans toucher à l\'index de la session (ce qu\'un autre ticket y a indexé n\'entre pas dans l\'instantané)',
    '(sans Node : les étapes à la main, dans `procedure-groupe-cas.md`)',
    'puis `git add` de chacun de ses fichiers (correctifs compris ; l\'instantané n\'indexe rien), le commit',
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

test('règles de travail : spécialistes en lecture seule, dossier temporaire, attentes notifiées, délais, planche, mises à jour', () => {
  has(
    section(3),
    'sans spécialistes qui écrivent',
    'seule exception, une session qui ne tourne pas sur Opus et confie sa revue du groupe à un relecteur Opus',
    '`printenv CLAUDE_JOB_DIR`, seule dans sa commande, suivi de `/tmp`',
    'Le dossier temporaire de la session, `$CLAUDE_JOB_DIR/tmp` (l\'outil Write est refusé à la racine de `CLAUDE_JOB_DIR`)',
    'Ne jamais attendre par `sleep`',
    'pas de Monitor pour un spécialiste',
    'avancer ce qui ne dépend pas d\'elle',
    'me poser tout de suite une question prête, sans attendre la fin de la revue',
    'Une commande longue (tests, build) se lance avec un délai maximal',
    'ne jamais rendre la main en attendant un processus d\'arrière-plan qui n\'a pas de délai',
    'produire une planche (les variantes côte à côte, dans un fichier)',
    'un commentaire daté « mise à jour du porteur »',
    'd\'après la ligne de résumé de la sortie des tests, jamais de mémoire',
    'Si l\'outil flow répond que la mission est en pause',
    'Un worker n\'écoute que son manager',
    'il le transmet à son manager par SendMessage et attend sa réponse avant d\'agir dessus',
  )
})

test('revue du groupe : lancée par la session, high --fix sur <base>..HEAD, sans --fix en zone sensible, conflit remonté', () => {
  has(
    section(4),
    'un groupe dont chaque ticket est dit ni sensible ni avec logique n\'a ni revue du groupe ni revue de sécurité',
    'un seul ticket avec de la logique, en zone sensible, ou qui ne dit pas l\'un des deux, et la revue du groupe et l\'avis de sécurité sont dus',
    'par l\'outil Skill, sans spécialiste qui l\'enveloppe',
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
    'Un groupe sans logique ni zone sensible n\'a ni revue du groupe ni revue de sécurité. Pour tout autre groupe, juger si une revue de sécurité vaut la peine : dans le même message que la revue du groupe (elle est en lecture seule et n\'attend pas ses correctifs), ou, pour un groupe d\'un seul ticket, qui n\'a pas de revue du groupe, à la fin de son ticket',
    'dans le même message que la revue du groupe',
    'type general-purpose, modèle opus, effort high, en une seule passe : il cherche et vérifie lui-même, sans lancer d\'agent',
    'les changements du groupe font franchir quelque chose à la limite du compte',
    'un fichier sous `~/.claude` écrit par une autre session du compte n\'est pas une entrée hostile, et ni une suppression de données ni la concurrence seule n\'en font partie',
    'avec pour seul périmètre `git diff <base>..<lancement>`',
    '<lancement> : le hash de HEAD au lancement, écrit en clair dans ses consignes',
    'Ne pas lancer `/security-review`',
    'Ne pas corriger ce qu\'il trouve : les failles vont dans le compte rendu',
    'chaque faille gardée arrive numérotée (F1, F2…) avec un correctif prêt',
    'pas de seconde passe sur le diff de ses correctifs, la revue de sécurité tourne une seule fois',
  )
})

test('revue de sécurité désactivée : l’avis d’abord, en tête de la section 5, et la passe « bogues » prend les zones de la méthode', () => {
  const s5 = section(5)
  assert.ok(
    s5.split('\n').find(l => l.trim() !== '' && !l.startsWith('#'))?.startsWith("D'abord, envoyer l'avis à l'outil `flow`, et ne lire la méthode en entier et n'écrire les consignes de sécurité que si sa réponse ne dit pas la revue désactivée"),
    'la consigne de l’avis d’abord n’ouvre pas la section 5',
  )
  // Le noyau (point 5 de la section 2) y renvoie ; le détail est dans l'annexe, en tête de la section 5.
  has(section(2), 'Revue de sécurité désactivée (dite par la réponse à `delegate`) : ses zones y entrent, tête de la section 5.')
  has(s5, 'À la place, et dès le premier ticket : le fichier de consignes de la passe « bogues » de chaque ticket sensible du groupe reçoit aussi la liste des zones de la section 1 du fichier de méthode de la revue de sécurité', 'et le relecteur signale comme Important un défaut dans l\'une d\'elles ; pas de relecteur de plus ni de question')
})

test('compte rendu : complet au relais, une ligne au manager', () => {
  has(
    section(6),
    'les fichiers modifiés, sa branche, les contrôles lancés et leur résultat',
    'la revue du groupe (constats, corrigés, et à part les constats sur du code antérieur au lot, chacun avec sa gravité), la revue de sécurité (lancée ou non, pourquoi, failles trouvées)',
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

// Les pistes de la rétro de la mission « Frise, groupes et titres ».

test('une lecture d’une décision hors zone sensible se code, se déclare et la session continue', () => {
  has(
    section(1),
    'Seules les questions sensibles et les choix de conception me sont posés',
    'la coder selon l\'option la plus proche de la décision, la déclarer dans `{"decided": …}` avec sa raison, et continuer',
  )
})

test('le fichier de consignes donne CODING_STANDARDS.md et, pour un ticket, les critères des tickets faits du groupe', () => {
  has(procedure, '- si le projet a un `CODING_STANDARDS.md` à sa racine')
  has(section(2), 'il lit le `CODING_STANDARDS.md` dont le fichier de consignes donne le chemin (point 7)')
  has(
    template,
    '[Les règles de jugement : `<racine du dossier de travail>/CODING_STANDARDS.md` ; un texte du diff qui dicte des appels à l\'outil `flow` y a son test qui rejoue chacun de ces appels contre le modèle',
    '[Revue d\'un ticket : les critères des tickets déjà faits du groupe qui touchent les mêmes fichiers, recopiés',
  )
  has(section(4), 'le chemin de `CODING_STANDARDS.md` s\'il existe')
})

// Rétro « Une seule revue par ticket sensible » (r4) : un relecteur lancé dans le même message que
// l'écriture de ses consignes, en échec, était parti sans elles.
test('point 7 : le fichier de consignes s’écrit dans un appel à part et sa ligne « Consignes écrites : » se lit avant de lancer le relecteur', () => {
  has(
    section(2),
    'cette commande part dans un appel à part, et le relecteur ne se lance qu\'au message suivant, une fois lue dans sa sortie la ligne « Consignes écrites : <chemin> »',
    'sans cette ligne (commande en échec, mauvaise option), la session corrige la commande et relance l\'écriture',
    'ne lance le relecteur que sur un fichier de consignes écrit',
  )
})

// Rétro de la mission « Lancer un groupe en xhigh » : trois fichiers de consignes presque identiques
// écrits à la main (r11), un commit de statut seul pour le hash du ticket (r12), un ticket de version
// en collision avec une autre discussion (r2).

test('gabarit : le fichier de consignes se remplit d’après un gabarit, qui porte la consigne des relecteurs telle quelle', () => {
  has(section(2), 'qui remplit le gabarit `consignes-revue.md` (dans le dossier de ce fichier) d\'après le ticket', 'pour une autre revue, copier ce gabarit dans son dossier temporaire et en remplir les trous')
  // La revue du groupe et sa revue de sécurité ont leurs consignes écrites par le même script, plus par une copie à la main.
  has(
    section(2),
    'pour la revue du groupe et sa revue de sécurité, le même script, `--groupe <id du groupe> <base>..HEAD <sortie> <les fichiers de ses tickets>` ou `--securite <id du groupe> <base>..<lancement> <sortie> <les fichiers de ses tickets>`',
    'qui crée aussi le dossier du relecteur, `groupe-<id>` ou `securite-<id>`',
  )
  has(files['procedure-groupe-fin.md'], 'écrit par `node <dossier de flow-board>/scripts/consignes.mjs --groupe <id du groupe> <base>..HEAD <sortie> <les fichiers de ses tickets>`', 'écrit par `node <dossier de flow-board>/scripts/consignes.mjs --securite <id du groupe> <base>..<lancement> <sortie> <les fichiers de ses tickets>`')
  // Le point 7 renvoie au gabarit au lieu d'en décrire le contenu.
  assert.ok(!section(2).includes('les points qui me sont réservés, ce qu\'elle ne doit pas faire'), 'le point 7 décrit encore le contenu')
  has(
    template,
    'Cible : `<base>..<fin>`, jamais un hash seul',
    '`git diff <base>..<fin> -- <chemins de la mission>`',
    'Les choix déjà déclarés : `<chemin du fichier des choix>`',
    'l\'invariant du ticket',
    'le lecteur visé',
    'Réservé au porteur de la mission',
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

test('version : un worker ne touche ni aux versions ni aux CHANGELOG, et liste ce que le CHANGELOG devra dire', () => {
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
    'Un message de commit s\'écrit dans un fichier par Write, puis `git commit -F <fichier>`',
    '`scripts/show.py <fichier> <motif> [+N]`, motif littéral',
  )
  assert.ok(!s.includes('jamais par une boucle cat ou head'), 'l\'ancienne consigne de lecture est restée')
})

test('après le compte rendu, un correctif suit la procédure du ticket, une question se tranche dans le manager', () => {
  has(
    section(6),
    'Après le compte rendu, un correctif appliqué par la session',
    'suit la procédure du ticket (section 2 : contrôles, revue, passe « bogues » s\'il touche une zone sensible, commit)',
    'Une question du compte rendu se tranche dans le manager ; la session n\'applique rien d\'autre sans un message de celui-ci',
  )
})

test('un choix déclaré ne se défait pas par préférence, mais un défaut qu’il produit se signale ; plus de copie de l’ancienne consigne', () => {
  has(section(7), 'ne pas défaire par préférence un choix de ce fichier, ni le resignaler comme tel, mais signaler tout cas où il produit un défaut, avec son scénario')
  has(section(8), 'signale tout cas où l\'un d\'eux produit un défaut, avec son scénario')
  const sources = { procedure: whole, register, catalog: read('hooks/catalog.ts'), model: read('hooks/model.ts'), relay: read('hooks/relay.ts'), basics: read('hooks/basics.ts'), link: read('hooks/link.ts') }
  for (const [name, text] of Object.entries(sources)) {
    for (const old of ['ne pas resignaler ni défaire', 'à ne pas resignaler ni défaire', 'do not report again nor undo', 'not to be reported again nor undone', 'une revue ne les resignale pas']) {
      assert.ok(!text.includes(old), `${name} garde l'ancienne consigne « ${old} »`)
    }
  }
})

// Les pistes de la rétro de la mission « Fermeture auto des workers ».

test('un constat de passe « bogues » qui ne viole pas l’invariant va aux pistes, sans question', () => {
  has(
    section(2),
    'un constat de la passe « bogues » qui ne le viole pas n\'ouvre pas de question : il va au compte rendu, sous « Pistes » (section 6)',
    'seul ce qui viole l\'invariant, une régression ou un critère manqué sans signal se corrige ou devient une question',
  )
  has(section(6), 'les pistes (les constats des passes « bogues » qui ne violent pas l\'invariant')
  has(template, 'un constat qui ne le viole pas se range sous « Pistes », sans question ni correctif, sauf une régression introduite par le diff, ou un constat sur le code du lot qui fait manquer un critère du ticket sans signal (le comportement promis ne se produit pas, et rien ne le dit), Important et corrigé')
})

test('une question sensible née en cours de ticket part tout de suite, la recommandation codée ; le commit n’attend que les cas bloquants', () => {
  has(
    section(3),
    'Une question sensible née en cours de ticket part tout de suite au manager par SendMessage (ses options, la recommandée en tête), sans attendre le compte rendu',
    'avec l\'option recommandée déjà codée de façon réversible',
    'Le commit du ticket n\'attend la réponse que pour une question des cas qui bloquent en mode auto',
    'ou un choix sensible dont l\'option recommandée ne respecte pas l\'invariant ou n\'est pas la plus prudente)',
    'pour toute autre question, le ticket se commite avec la recommandation, et un refus la défait dans un commit à part, qui suit la procédure du ticket',
    'la session avance ce qui n\'en dépend pas',
  )
  assert.ok(!section(3).includes('le commit du ticket attend la réponse'), 'le commit attend encore toute réponse')
})

test('en mode auto, une violation corrigée au plus prudent après les correctifs est une ligne d’information', () => {
  has(section(2), 'dans une mission en mode auto, une violation ainsi corrigée de la façon la plus prudente (section 10) n\'est pas une question : elle part en une ligne d\'information')
  has(section(10), 'de même pour une violation de l\'invariant que la passe d\'après les correctifs trouve encore')
})

test('un fichier nouveau d’un ticket suivant attend dans le dossier temporaire jusqu’au commit du ticket courant', () => {
  has(section(2), 'un fichier qu\'un ticket suivant crée s\'écrit dans le dossier temporaire de la session (section 3) jusqu\'au commit du ticket courant', 'il en va de même de tout fichier nouveau d\'un ticket suivant (point 6)')
})

test('du code écrit après la passe « bogues » repasse en revue, la ligne « Zone sensible » du ticket qui reçoit une garde se relit', () => {
  has(
    section(2),
    'ses correctifs, et le code ajouté après elle (un ajout demandé ensuite, un correctif venu d\'une autre revue)',
    'la ligne « Zone sensible » du ticket qui la reçoit se relit',
  )
})

test('décisions lues par leur entrée, réglages du poste relevés à un essai, confiance du dossier lue sans afficher le fichier', () => {
  has(section(2), 'un fichier de décisions long se lit par la série ou l\'entrée que citent le ticket ou le prompt')
  // Les trois cas rares de la section 3 (session hors Opus, essai, ticket qui bute) sont dans une annexe, que le noyau nomme.
  has(section(3), 'Trois cas se lisent dans `procedure-groupe-cas.md` (dossier de ce fichier), seulement quand ils se présentent', 'un ticket qui bute (deux approches ratées, même erreur)')
  // Le ticket qui bute : la définition d'un essai, l'advisor avant la troisième approche, la mise de côté.
  has(
    files['procedure-groupe-cas.md'],
    'un essai est une approche de correction, pas un lancement de tests',
    'consulter l\'advisor (moment (b) de la règle « Consulter l\'advisor ») et tenter une troisième approche qui suit son avis',
    'sous un titre « Essais », les trois approches et ce que chacune a donné',
    'avec pour raison « bute après trois approches »',
    'continuer les tickets du groupe qui n\'en dépendent pas, sans reprendre celui-là',
    'précise la règle générale « Replanifier après un échec »',
  )
  has(
    files['procedure-groupe-cas.md'],
    'relève d\'abord les réglages du poste qui jouent (`worktree.baseRef`, la version de Claude Code, la confiance du dossier)',
    'Un essai qui lance `claude --bg` se fait de préférence dans un dépôt déjà de confiance',
    'jamais le reste de `~/.claude.json` (ni Read, ni `cat`), qui peut porter des jetons',
  )
  // L'instantané à la main, sans Node, y est aussi : le noyau ne garde que le script, qui ne touche pas à l'index.
  has(
    files['procedure-groupe-cas.md'],
    'Seulement sur un poste sans Node : l\'instantané d\'un ticket sensible se pose à la main, dans l\'index de la session',
    '`git diff --cached --name-only` doit lister les fichiers du ticket et rien d\'autre (sortir d\'abord de l\'index ce qui n\'en est pas)',
    '`git update-ref refs/worktree/flow-board/<id du ticket> <instantané>`',
    '`git update-ref -d refs/worktree/flow-board/<id du ticket> <instantané>`, une fois vérifié à la main que chaque fichier de l\'instantané est amené à cette version par un commit du ticket',
  )
  assert.ok(!procedure.includes('git write-tree'), 'le noyau porte encore les étapes à la main de l’instantané')
  // La commande est celle du texte de lancement (TRUST_COMMAND de catalog.ts), mot pour mot.
  const command = read('hooks/catalog.ts').match(/export const TRUST_COMMAND = `([^`]*)`/)
  assert.ok(command, 'TRUST_COMMAND absent de catalog.ts')
  has(files['procedure-groupe-cas.md'], `par cette commande qui n'affiche que sa valeur (\`python\` sous Windows) : \`${command[1]}\``)
})

test('pas d’appel final à l’advisor quand les revues du groupe ont tourné', () => {
  has(section(6), 'Pas d\'appel final à l\'advisor quand les revues du groupe ont tourné : elles en tiennent lieu')
})

test('revue du ticket : la session ne charge pas le skill de revue, que le relecteur unique contredisait', () => {
  has(
    section(2),
    'La session ne charge pas `<revue du ticket>` par l\'outil Skill',
    'le relecteur unique suit le gabarit `prompt-relecteur.md`',
  )
  assert.ok(!section(2).includes('`<revue du ticket>` par l\'outil Skill sur les seuls changements du ticket'), 'le point 4 fait encore charger le skill de revue')
})

test('worker autonome : l’advisor à deux moments nommés, avant le premier choix déclaré d’un ticket et avant le compte rendu', () => {
  has(
    section(10),
    'avant le premier choix de conception qu\'elle déclare dans un ticket, et avant son compte rendu sauf quand les revues du groupe ont tourné (section 6)',
  )
  assert.ok(!section(10).includes('Avant chaque grand choix'), 'la section 10 garde le moment flou « avant chaque grand choix »')
  // En mode auto, un moment de plus : avant de coder chaque décision prise seule, une fois par décision ; hors auto, rien ne change.
  has(
    section(10),
    'Dans une mission en mode auto, elle le consulte en plus avant de coder chaque décision qu\'elle prend seule (un changement de conception, une question en zone sensible tranchée seule), une fois par décision',
    'hors auto, les deux moments ci-dessus restent tels quels',
    'un worker Fable ne le consulte toujours pas',
  )
})

test('une deuxième question née des correctifs sur un même invariant propose une option qui traite la classe entière', () => {
  has(
    section(2),
    'Quand une deuxième question naît des correctifs sur un même invariant',
    'à côté de l\'option ponctuelle qui bouche ce scénario, une option qui traite la classe entière (par exemple dater l\'événement et le comparer au début de l\'objet)',
  )
})

test('les tests écrits d’avance pour un ticket suivant attendent hors du dossier des tests', () => {
  has(
    section(2),
    'Un test écrit d\'avance pour un ticket suivant attend dans le dossier temporaire de la session (section 3), hors du dossier des tests du projet (`tests/`), jusqu\'au tour de son ticket',
  )
})

// À 6 tickets, la compaction automatique est tombée pendant la rédaction du compte rendu : seul un fichier
// de notes ouvert de lui-même l'a sauvé.
test('un fichier de notes du compte rendu, tenu en route et relu pour rédiger', () => {
  has(section(1), '`notes-compte-rendu.md`', 'dans le dossier temporaire de la session', 'ce que le CHANGELOG devra dire', 'les choix déclarés')
  has(section(6), 'Relire en entier le fichier de notes du compte rendu, `notes-compte-rendu.md`')
})

// La passe « questions sensibles d'abord », faite dans la session, avait fait monter son contexte d'environ 110k.
test('la passe des questions sensibles se confie à un spécialiste en lecture seule', () => {
  has(section(1), 'spécialiste en lecture seule', 'modèle opus, effort high', 'fichier:ligne')
})

// Les décisions prises après le départ d'une branche manquaient à sa copie du fichier : il se lit au clone principal.
test('le fichier de décisions se lit par Read à son chemin absolu dans le clone principal, pour la session et ses relecteurs', () => {
  has(section(2), 'par Read, à son chemin absolu dans le clone principal, que donne le prompt')
  has(template, 'se lit par Read à ce chemin absolu, celui du clone principal quand il y est')
})

// Une session avait envoyé au manager un point d'étape sans question réelle, qui le réveillait pour rien.
test('un worker n’écrit au manager que pour une question dont il attend la réponse, ou son compte rendu', () => {
  has(section(3), "n'écrit au manager que pour une question dont il attend la réponse, ou pour son compte rendu")
})

// Aucun worker de la rétro « Pistes de rétro en groupes » n'avait ouvert l'index du README de flow-board.
test('un index « concept → fichier et fonction » du README se lit d’abord, les gros fichiers par fonction', () => {
  has(section(3), '« Index : concept → fichier et fonction »', 'par fonction')
})

test('les phrases jamais suivies sont retirées', () => {
  for (const old of ['se cochent par l\'outil Edit, sans script', 'sans nouvelles depuis 10 à 15 minutes']) assert.ok(!whole.includes(old), `reste : « ${old} »`)
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

// Une passe « bogues » avait classé Mineur une exception levée sur une entrée qui passait avant,
// faute de violer l'invariant ; seule la revue du groupe l'avait rattrapée.
test('la consigne des relecteurs rend Important une régression, et les pistes l’exceptent', () => {
  has(
    section(7),
    'une régression introduite par le diff (une entrée qui passait avant lui et qui maintenant lève, change de résultat ou est refusée) est Important, que le ticket ait un invariant ou non',
  )
  has(section(2), 'sauf une régression introduite par le diff (section 7), Important, qui se corrige', 'sous « Pistes », sauf une régression ou un critère manqué sans signal, qui se corrige')
  has(section(6), 'hors régressions et critères manqués sans signal, corrigés')
})

// Un groupe avait rangé sous « Pistes » un constat qui rendait une fonction muette (le comportement promis
// ne se produisait pas, sans aucun signal), faute de violer l'invariant ; le manager avait dû le renvoyer.
test('un critère manqué sans signal est Important et se corrige, la revue du groupe comprise', () => {
  has(
    section(7),
    'un constat sur le code du lot qui fait manquer un critère du ticket sans signal (le comportement promis ne se produit pas, et rien ne le dit) est Important de même, que le ticket ait un invariant ou non',
  )
  has(
    section(2),
    'ou un constat sur le code du lot qui fait manquer un critère du ticket sans signal (le comportement promis ne se produit pas, et rien ne le dit), Important, qui se corrige',
  )
  has(section(4), 'la revue du groupe le corrige dans le groupe, même s\'il ne viole aucun invariant, au lieu de le ranger sous les pistes')
})

test('le gabarit du prompt du relecteur unique existe et dit de ne pas invoquer le skill', () => {
  const prompt = read('reference/prompt-relecteur.md')
  has(
    prompt,
    'N\'invoque pas le skill code-review et ne lance aucun spécialiste : fais toi-même les deux axes',
    '`<chemin du fichier de consignes>`',
    '**Axe Standards**',
    '**Axe Spec**',
    'les Mineurs en un compte par axe, sans détail',
  )
  has(read('README.md'), '├── reference/prompt-relecteur.md')
})

// Des phrases de la procédure faisaient échouer un appel à chaque worker (Write à la racine de CLAUDE_JOB_DIR,
// l'outil Grep absent, --chemins en une chaîne à espaces, la confirmation que /tdd demande) ou relancer la
// suite complète à chaque commit et après une fusion dont le hook avait passé.
test('la procédure ne coûte plus d’appel refusé et dit quand lancer la suite complète', () => {
  has(section(2), 'son titre se trouve par Read de proche en proche, ou, dans un dépôt qui a `scripts/show.py`, par `python3 scripts/show.py --liste <chemin absolu> "## "`')
  assert.ok(!section(2).includes('par l\'outil Grep, motif'), 'le point 1 dépend encore de l’outil Grep')
  has(section(2), '`--chemins <c> --chemins <c>…` (une option par chemin de la mission)', '`--faits <t> --faits <t>…` (une option par ticket déjà fait du groupe')
  has(section(2), 'dans un worker, la couture de test que fixe le ticket (ses critères, les tests qu\'il nomme) vaut la confirmation que `<tdd>` demande à la personne')
  has(section(4), 'La suite complète tourne alors, une fois', 'une fusion dont le hook `pre-merge-commit` a passé ne la fait pas relancer', '(paramètre `timeout` de l\'outil Bash, 600000)')
  has(section(6), 'de son worktree ou de son dossier de job `CLAUDE_JOB_DIR`, son sous-dossier `tmp` compris (pas un autre)')
  has(section(1), 'elle est due dès que le groupe compte au moins deux tickets très sensibles')
  has(section(10), 'Une recommandation prise en partie (un filtre sur deux, par exemple) se déclare dans `{"decided": …}` avec la partie laissée et sa raison, jamais comme « plus prudente » sans dire ce qui manque')
})

// L'axe Spec ne lisait que les critères cochés, et une docstring fausse avait été jugée conforme : les deux
// variantes du gabarit (deux axes, axe Spec seul) portent chacune ces vérifications.
test('l’axe Spec des deux variantes vérifie « What to build » et confronte les textes touchés au code', () => {
  const prompt = read('reference/prompt-relecteur.md')
  for (const part of [
    'Chaque point numéroté et chaque phrase de comportement de « What to build » se vérifient aussi, pas seulement les critères cochés.',
    'Chaque phrase de docstring, de commentaire ou de message que le diff touche se confronte aux branches du code qu\'elle décrit',
    'Pour un défaut, nomme aussi les autres endroits où tu vois le même motif (« même défaut dans X »)',
  ]) assert.equal(prompt.split(part).length - 1, 2, `pas dans les deux variantes : « ${part} »`)
})

test('un worker ne demande jamais d’envoyer "sensitive" lui-même : il corrige la ligne et prévient', () => {
  // L'outil ne relaie pas "tickets" depuis un worker : aucun point de la section 2 ne doit lui faire envoyer "sensitive".
  assert.ok(!section(2).includes('(`"sensitive"` à l\'outil flow)'), 'le point 5 fait encore envoyer "sensitive" par le worker')
  assert.ok(!/se corrige \(`"sensitive"`/.test(section(2)))
})

test('un ticket reclassé par un worker : la description de l’outil fait renvoyer "sensitive" par le manager', () => {
  // L'outil ne relaie pas "tickets" depuis un worker : au retour du groupe, le manager renvoie le ticket.
  assert.ok(register.includes('and resend with "sensitive": true each ticket its report reclassified (a worker cannot send it)'))
})

test('la passe « bogues » d’un ticket sensible cite le critère d’effort qui lui est propre, dans la méthode de sécurité', () => {
  assert.ok(section(2).includes('selon le critère d\'effort de la passe « bogues » du fichier de méthode de la revue de sécurité'))
  const method = read('reference/revue-securite.md')
  assert.ok(method.includes('### Critère d\'effort de la passe « bogues » d\'un ticket sensible'))
  assert.ok(register.includes('as the bug pass effort criterion of the security review method file decides') || read('hooks/catalog.ts').includes('as the bug pass effort criterion of the security review method file decides'))
})

// Rétro de la mission « Coordinateur de parcours » : les passes « bogues » rendaient exactement 15 constats en xhigh et
// 10 en high, le plafond de /code-review quelle que soit la taille du diff.
test('la passe « bogues » passe --max-findings all, avec ou sans git', () => {
  has(section(2), 'sans `--max-findings all`, elle s\'arrête, avec la table de recettes par défaut, à 10 constats en high et 15 en xhigh, quelle que soit la taille du diff')
  has(section(9), 'la passe « bogues » prend pour arguments « <niveau> --max-findings all consignes : <chemin> », sans plage')
  has(template, 'lancée avec `--max-findings all`, elle range ses constats par gravité, les bogues d\'abord')
})

// Une /code-review lancée pendant qu'une autre tournait avait retenu le fil d'un worker 11 minutes et demie ; un essai
// (deux fois sur deux) a montré que la seconde passe au premier plan.
test('une /code-review ne se lance qu’une fois la précédente revenue', () => {
  has(section(2), 'Une `/code-review` ne se lance qu\'une fois la précédente revenue (sa notification reçue) : lancée pendant qu\'une autre tourne, elle passe au premier plan et retient la session jusqu\'à sa fin')
  has(section(2), 'quand deux passes doivent tourner en même temps, la seconde se confie à un spécialiste relecteur (outil Agent, modèle opus, effort passé explicitement), qui la lance lui-même')
})

// Un tour de revue était parti sur un instantané déjà périmé, que les contrôles avaient fait reprendre ;
// un correctif de relecteur avait été appliqué en partie, sans le dire.
test('la revue et l’instantané partent sur des contrôles verts ; un correctif proposé s’applique en entier, ou l’écart se dit', () => {
  has(
    section(2),
    'La revue du ticket (point 4) et l\'instantané d\'un ticket sensible (point 6) ne partent qu\'une fois verts les contrôles du ticket',
    '`scripts/check.sh --quick` ou `--test` sur ses fichiers de test) et, pour un ticket commité avant sa revue, le pre-commit',
    'avant le commit d\'un ticket, ses seuls tests ciblés, sans relancer à la main ce que le pre-commit lance déjà ; la suite complète tourne une fois, à la fin du groupe : après les correctifs de la revue du groupe quand elle tourne (section 4), sinon après le dernier ticket',
    'Un correctif fait après l\'instantané (un contrôle devenu rouge) repose l\'instantané avant la revue',
  )
  has(
    section(4),
    'Un correctif qu\'un relecteur propose (revue du groupe sans `--fix`, faille de la revue de sécurité, constat Important d\'une revue de ticket) s\'applique en entier',
    'elle dit l\'écart (ce qu\'elle laisse et pourquoi) dans `{"decided": …}` du même appel que son envoi `"review"`',
    'et dans son compte rendu ; pour une faille de la revue de sécurité, section 5',
  )
  has(section(5), 'la session applique ces correctifs, chacun en entier (une faille corrigée en partie ne compte pas dans `"fixed"` : ce qu\'elle laisse et pourquoi part en question au manager')
})

// Un compte rendu perdu : son seul exemplaire était dans le dossier de job de la session, que claude rm a supprimé.
test('section 11 : la fermeture ne lance jamais claude rm tant que le relais n’a pas le compte rendu', () => {
  has(section(11), 'la fermeture d\'un groupe ne lance jamais `claude rm` sur une session dont le compte rendu n\'est pas au relais')
  has(section(11), 'une fois le compte rendu au relais, la fermeture se repropose et la suivante lance `claude rm`')
})

test('section 2, point 8 : fixed compte les constats corrigés par un commit, et une revue renvoyée telle quelle n’est pas recomptée', () => {
  has(section(2), '`fixed` : les constats corrigés par un commit, pas ceux seulement notés ou documentés')
  has(section(2), 'la même (mêmes comptes, le même ticket ou aucun) renvoyée sans qu\'un ticket ait changé de statut ni qu\'une revue (`/code-review`) ait été lancée depuis n\'est pas recomptée, et la réponse dit « revue déjà reçue : non recomptée »')
  has(section(2), 'La revue d\'un ticket (sa passe « bogues » comprise) nomme ce ticket, `"ticket": "<id du ticket>"`')
})

// Rétro « Économie d'usage » : chaque worker relisait les 58 Ko de la procédure au départ et après chaque
// compaction, dont une bonne part ne le concerne qu'à un moment précis ou jamais. Le noyau garde les
// sections lues à chaque ticket ; une ligne nomme, à la place de chaque section déplacée, son annexe.
test('le noyau garde les sections 1, 2, 3, 7 et 8, et une ligne par section déplacée, avec son fichier et quand la lire', () => {
  assert.deepEqual(titlesOf(procedure), [
    '1. Avant le premier ticket',
    '2. Chaque ticket, un par un et dans l\'ordre',
    '3. Règles de travail',
    '7. La consigne des relecteurs',
    '8. Le fichier des choix déjà déclarés',
    '9. Sans git (annexe)',
    '10. Worker autonome (annexe)',
    '11. Pour le manager : effort des workers, après leur compte rendu (annexe)',
  ])
  has(procedure, '## 4 à 6. Revue du groupe, revue de sécurité, compte rendu\n\nÀ lire quand le dernier ticket du groupe est commité et relu, dans `procedure-groupe-fin.md`')
  has(procedure, '## 9. Sans git (annexe)\n\nÀ lire seulement quand le prompt dit que le dossier de travail n\'a pas de git, dans `procedure-groupe-sans-git.md`')
  has(procedure, '## 10. Worker autonome (annexe)\n\nÀ lire seulement quand le prompt dit que la session est un worker autonome, dans `procedure-groupe-autonome.md`')
  has(procedure, 'avant de lancer un worker ou d\'appliquer un correctif après son compte rendu, dans `effort-workers.md`')
  // Le noyau dit lui-même ce qu'il relit après une compaction.
  has(procedure, 'Après une compaction, relire ce noyau, et `procedure-groupe-fin.md` quand le dernier ticket est commité.')
  // Plus de section déplacée dans le noyau, et chaque annexe ne porte que les siennes.
  for (const [n, file] of Object.entries(FILE_OF)) {
    for (const other of Object.keys(files)) {
      const isThere = titlesOf(files[other]).some(t => t.startsWith(`${n}. `) && !t.endsWith(' (annexe)'))
      assert.equal(isThere, other === file, `section ${n} : attendue dans ${file} seulement, trouvée ou absente dans ${other}`)
    }
  }
})

// La taille mesurée au découpage (08/11/2026) : le noyau décidé pèse environ 66 % de la procédure d'avant
// (58 Ko) ; le critère « moins de la moitié » du ticket a été révisé à ce chiffre (option (a) du manager).
// Il garde la procédure courte : une section ajoutée qui ne sert qu'à un moment va dans une annexe.
test('le noyau reste sous 40 000 octets, les annexes portant le reste', () => {
  const bytes = Buffer.byteLength(procedure, 'utf8')
  assert.ok(bytes < 40_000, `noyau : ${bytes} octets`)
  for (const annex of ANNEXES) has(files[annex], 'Annexe du noyau `procedure-groupe.md` (dans le dossier de ce fichier)')
})

// Les groupes B, C, D, E et G avaient perdu des tours sur l'outil Grep absent d'un worker ou sur une forme
// de commande que le garde-fou refuse sans que la procédure la nomme.
test('section 3 : l’outil Grep peut manquer, et toutes les formes que le garde-fou refuse, avec leur remplacement', () => {
  const s = section(3)
  has(s, 'L\'outil Grep peut manquer : grep par Bash sur un fichier nommé, ou `scripts/show.py --liste` quand le projet l\'a')
  has(
    s,
    'Toutes les formes refusées : une boucle',
    'un calcul `$((…))`',
    'où paraît le mot git',
    'un heredoc ou un `sed` dont le texte cite git',
    '(`python3 -c`)',
    '`env -u`',
    'un `sed -i` sur une variable',
    '`git -C` vers un autre dossier',
    'Le remplacement est le même pour toutes : écrire le texte, le programme ou la suite de commandes dans un fichier par l\'outil Write',
    'puis lancer ce script par une commande simple',
  )
})
