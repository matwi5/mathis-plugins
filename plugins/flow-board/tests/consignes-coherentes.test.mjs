// Les consignes recopiées sur plusieurs surfaces disent la même chose : la règle d'effort d'une
// session de groupe (xhigh) et la relecture du fond et de la forme vivent chacune dans la règle des
// lots, le README, les textes du mod et, selon le cas, la procédure ou la règle des revues ; 4 des
// 5 constats importants d'une revue de groupe étaient des copies qui divergeaient. Chaque surface
// porte les mots-clés de chaque consigne qu'elle recopie. Un test Node (node --test, lancé par
// scripts/check.sh) : il lit les sources, et les règles communes du dépôt quand elles sont là.

import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const at = file => new URL(`../${file}`, import.meta.url)
const read = file => readFileSync(at(file), 'utf8')
/** Une règle commune, à la racine du dépôt ; null hors du dépôt (plugin installé seul). */
const repoFile = file => (existsSync(at(`../../${file}`)) ? read(`../../${file}`) : null)

const SURFACES = {
  'config/rules/flow-board.md': repoFile('config/rules/flow-board.md'),
  'config/rules/general.md': repoFile('config/rules/general.md'),
  'config/rules/asana-board.md': repoFile('config/rules/asana-board.md'),
  'GLOSSARY.md': repoFile('GLOSSARY.md'),
  'config/reference/revues.md': repoFile('config/reference/revues.md'),
  'config/rules/agents.md': repoFile('config/rules/agents.md'),
  'reference/procedure-groupe.md': read('reference/procedure-groupe.md'),
  'reference/procedure-groupe-fin.md': read('reference/procedure-groupe-fin.md'),
  'reference/procedure-groupe-sans-git.md': read('reference/procedure-groupe-sans-git.md'),
  'reference/procedure-groupe-autonome.md': read('reference/procedure-groupe-autonome.md'),
  'reference/effort-workers.md': read('reference/effort-workers.md'),
  // La procédure entière (noyau et annexes), pour une consigne dont les mots-clés se partagent entre eux.
  'reference/procedure-groupe*.md': ['procedure-groupe.md', 'procedure-groupe-fin.md', 'procedure-groupe-sans-git.md', 'procedure-groupe-autonome.md', 'effort-workers.md'].map(f => read(`reference/${f}`)).join('\n'),
  'reference/revue-securite.md': read('reference/revue-securite.md'),
  'reference/consignes-revue.md': read('reference/consignes-revue.md'),
  'reference/prompt-relecteur.md': read('reference/prompt-relecteur.md'),
  'reference/relecture-fond-forme.md': read('reference/relecture-fond-forme.md'),
  'agents/researcher.md': repoFile('plugins/agents/agents/researcher.md'),
  'agents/explorer.md': repoFile('plugins/agents/agents/explorer.md'),
  'agents/README.md': repoFile('plugins/agents/README.md'),
  'README.md': read('README.md'),
  'hooks/register.tsx': read('hooks/register.tsx'),
  'hooks/catalog.ts': read('hooks/catalog.ts'),
  'hooks/compaction.ts': read('hooks/compaction.ts'),
  'hooks/effort.ts': read('hooks/effort.ts'),
  'hooks/view.tsx': read('hooks/view.tsx'),
  'hooks/model.ts': read('hooks/model.ts'),
  'skills/compte-rendu/SKILL.md': read('skills/compte-rendu/SKILL.md'),
  'skills/coo/SKILL.md': read('skills/coo/SKILL.md'),
  'to-spec/SKILL.md': repoFile('plugins/mattpocock-skills/skills/engineering/to-spec/SKILL.md'),
  'to-tickets/SKILL.md': repoFile('plugins/mattpocock-skills/skills/engineering/to-tickets/SKILL.md'),
  'grilling/SKILL.md': repoFile('plugins/mattpocock-skills/skills/productivity/grilling/SKILL.md'),
  'docs/evenements-moteur.md': repoFile('docs/evenements-moteur.md'),
  'asana-board/suivi-asana/SKILL.md': repoFile('plugins/asana-board/skills/suivi-asana/SKILL.md'),
}

/**
 * Chaque consigne : ses mots-clés, les surfaces qui la recopient, et ses anciennes formulations (`old`), refusées
 * partout. Ce tableau est la carte des
 * endroits qui recopient une règle : une règle changée se reporte sur chacune de ses surfaces.
 */
const CONSIGNES = [
  {
    // Un ticket sensible ou très sensible n'a que l'axe Spec, en high : l'axe Standards refait sa passe « bogues ».
    name: "le relecteur de l'axe Spec seul d'un ticket sensible",
    keywords: ['axe Spec seul'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'config/rules/agents.md', 'reference/procedure-groupe.md', 'README.md'],
  },
  { name: "le relecteur de l'axe Spec seul, en anglais", keywords: ['the Spec axis alone'], surfaces: ['hooks/catalog.ts'] },
  {
    // Un groupe d'un seul ticket n'a pas de revue du groupe ; son avis de sécurité reste dû.
    name: "le groupe d'un seul ticket",
    keywords: ["un seul ticket n'a pas de revue du groupe", 'avis de sécurité reste dû'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'README.md'],
  },
  { name: "le groupe d'un seul ticket, dans la procédure", keywords: ["un groupe d'un seul ticket, rattachés compris, n'a pas de revue du groupe", 'avis de sécurité reste dû'], surfaces: ['reference/procedure-groupe-fin.md'] },
  { name: "le groupe d'un seul ticket, en anglais", keywords: ['A group of a single ticket (attached ones included) has no group review'], surfaces: ['hooks/catalog.ts'] },
  {
    // La revue de sécurité ne se conseille que pour ce qui franchit la limite du compte (sa frontière de confiance) :
    // un fichier sous ~/.claude écrit par une autre session n'est pas une entrée hostile ; ni suppression ni concurrence seule.
    name: 'la liste qui déclenche la revue de sécurité',
    keywords: [
      'la limite du compte',
      'secrets et jetons (masquage compris), dépendances et code tiers lancé, publication, réseau ou export public, droits des fichiers et accès',
      "un fichier sous `~/.claude` écrit par une autre session du compte n'est pas une entrée hostile",
      "ni une suppression de données ni la concurrence seule n'en font partie",
      "l'accès comprend l'authentification et les règles d'accès d'une application, et le réseau vaut dans les deux sens",
    ],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe-fin.md', 'reference/revue-securite.md', 'README.md'],
    // La liste d'avant la limite du compte (02/11/2026), qui faisait entrer une valeur relue sous ~/.claude et la suppression ;
    // une copie restée dans le README passait le test à mots-clés, qui les trouvait ailleurs dans le même fichier.
    old: ["entrées de l'utilisateur jusqu'à une requête", 'user input reaching a query', 'uploads, dependencies', 'accès réseau ou fichiers, envois de fichiers', "commande ou chemin construit à partir d'une entrée", 'a command or a path built from an input', 'données personnelles ou contenu de messages', 'personal data or message content stored on disk', "n'est **pas** de confiance"],
  },
  {
    name: 'la liste qui déclenche la revue de sécurité, en anglais',
    keywords: [
      "crosses the boundary of the user's account",
      'secrets and tokens (masking included), dependencies and third-party code run, publishing, network or public export, file permissions and access',
      'a file under ~/.claude written by another session of the account is not a hostile input',
      'neither a data deletion nor concurrency alone calls for it',
      "access includes authentication and an application's access rules, and network goes both ways",
    ],
    surfaces: ['hooks/catalog.ts'],
  },
  {
    // La revue d'un groupe ou d'un lot signale une valeur relue qui entre dans une commande ou un chemin : le gabarit
    // des consignes (sessions liées), la consigne du mod (revue d'un groupe fini, d'un lot), le README.
    name: 'la ligne « sécurité » de la revue du groupe',
    keywords: ['qui entre dans une commande shell ou un chemin', 'sauf là où un contrôle du projet la vérifie déjà'],
    surfaces: ['reference/consignes-revue.md', 'README.md'],
  },
  { name: 'la ligne « sécurité » de la revue du groupe, en anglais', keywords: ['that reaches a shell command or a path is reported as a bug, Important, except where a check of the project already controls it'], surfaces: ['hooks/catalog.ts'] },
  {
    // Trois questions vérifient le classement d'un ticket, au découpage puis avant chaque ticket.
    name: 'les trois questions du classement',
    keywords: ['trois questions', 'valeur lue ailleurs', 'supprime'],
    surfaces: ['config/rules/flow-board.md', 'reference/procedure-groupe.md', 'README.md'],
  },
  { name: 'les trois questions du classement, en anglais', keywords: ['three questions'], surfaces: ['hooks/register.tsx'] },
  {
    // Une classe de défaut trouvée une deuxième fois se corrige partout d'un coup.
    name: 'la classe de défaut corrigée partout',
    keywords: ['classe de défaut'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe.md', 'README.md'],
  },
  {
    name: "l'effort d'une session de groupe",
    keywords: ['medium par défaut', 'xhigh (Recommandé) / high', 'tâche de jugement', "tâche d'exécution", 'worker autonome'],
    // Le brief d'un worker la tient de hooks/effort.ts ; la règle des lots la renvoie à la section 11 de la procédure,
    // qui s'adresse au manager : elle n'est plus chargée dans chaque session.
    surfaces: ['reference/effort-workers.md', 'README.md', 'hooks/effort.ts'],
  },
  {
    // Le mod calcule l'effort de chaque groupe et l'écrit dans la demande ; Claude ne juge que le choix de conception restant.
    name: "l'effort calculé au lancement",
    keywords: ['effort calculé', 'choix de conception', "s'écarte du calcul", 'section 11'],
    surfaces: ['reference/effort-workers.md', 'README.md', 'hooks/effort.ts'],
  },
  {
    // Option fusion : un groupe sans logique part en worker Sonnet high ; ses revues restent sur Opus.
    name: "l'option fusion",
    keywords: ['option fusion', 'Sonnet high', '--model sonnet --effort high', 'Zone sensible : non', 'Logique : non'],
    surfaces: ['reference/effort-workers.md', 'README.md'],
  },
  { name: "l'option fusion, dans la demande de lancement", keywords: ['Sonnet high, sans logique', 'Un groupe annoncé « Sonnet high » part sur Sonnet'], surfaces: ['hooks/effort.ts'] },
  {
    // Un worker sur Sonnet garde le moment (c) de l'advisor : l'advisor (Opus) relit un modèle moins fort que lui.
    name: "le moment (c) de l'advisor pour un worker sur Sonnet",
    keywords: ['worker sur Sonnet', 'moment (c)'],
    surfaces: ['config/rules/general.md', 'reference/procedure-groupe*.md', 'README.md'],
  },
  {
    // Le mod impose l'effort du COO (medium) et du manager selon sa phase (medium pendant le suivi des groupes).
    name: "l'effort du COO et du manager selon la phase",
    keywords: ['siège du COO', 'fin du découpage', 'xhigh et max'],
    surfaces: ['reference/effort-workers.md', 'README.md', 'hooks/effort.ts'],
    old: ['COO tourne en high', 'Un manager tourne en high', 'un manager tournent en high', "l'effort revient à high après le lot"],
  },
  {
    // « Plusieurs modules » : du code, pas de la documentation ; la même définition pour Claude et pour le mod (codeModuleOf).
    // Le mod calcule l'effort au lancement : la demande ne donne plus la définition, la section 11 de la procédure la porte.
    name: 'plusieurs modules de code',
    keywords: ['plusieurs modules de code', 'paquet sous', 'la racine comptant pour un', 'ne comptent pas'],
    surfaces: ['reference/effort-workers.md', 'README.md'],
    old: ['touche plusieurs modules à la fois', 'touchent plusieurs modules)', "s'il touche plusieurs modules,"],
  },
  { name: "l'effort du COO, dans son skill", keywords: ['Le COO tourne en medium', 'xhigh et max'], surfaces: ['skills/coo/SKILL.md', 'README.md'] },
  {
    // La règle des lots ne garde de l'effort des workers et du retour d'un worker que le renvoi à la section 11.
    name: 'le renvoi de la règle des lots à la section 11 de la procédure',
    keywords: ["section 11 de la procédure d'un worker de groupe (`reference/effort-workers.md` de flow-board)", 'reference/procedure-groupe-autonome.md'],
    surfaces: ['config/rules/flow-board.md'],
  },
  {
    // Seuls les constats antérieurs de gravité moyenne ou plus, ou qui violent un invariant, font un groupe « durcissement ».
    name: 'le filtre du groupe « durcissement »',
    keywords: ['Seuls les constats de gravité moyenne ou plus, ou qui violent un invariant, sont proposés comme groupe « durcissement » ; les autres vont au journal, sous « À reprendre ».'],
    surfaces: ['config/rules/flow-board.md'],
  },
  { name: 'le filtre du groupe « durcissement », ailleurs', keywords: ['gravité moyenne ou plus, ou qui violent un invariant', 'sous « À reprendre »'], surfaces: ['README.md', 'skills/compte-rendu/SKILL.md'] },
  // Le filtre a besoin d'une gravité : la consigne des relecteurs la fait donner à chaque constat antérieur.
  { name: 'la gravité d’un constat antérieur, dans la consigne des relecteurs', keywords: ['avec sa gravité : haute, moyenne ou basse', 'ceux de gravité moyenne ou plus me sont proposés'], surfaces: ['reference/procedure-groupe.md', 'reference/consignes-revue.md'] },
  { name: 'la gravité d’un constat antérieur, en anglais', keywords: ['with its severity: high, medium or low', 'those of medium severity or more go to the user'], surfaces: ['hooks/catalog.ts'] },
  {
    // Le groupe « durcissement » proposé attend la réponse : la consigne de fin de lot et le README disent la même chose.
    name: 'le groupe « durcissement » proposé attend la réponse, en anglais',
    keywords: ['declare that question in "waiting" on the implement phase instead of sending {"complete": true}', 'send {"complete": true} only once the answer came', 'suggests neither /flow-board:compte-rendu nor the delivery', 'In auto mode there is no « durcissement » group'],
    surfaces: ['hooks/register.tsx'],
  },
  {
    name: 'le groupe « durcissement » proposé attend la réponse, au README',
    keywords: ['Claude la déclare en question (`waiting`) sur la phase d\'implémentation au lieu de dire le lot fini (`complete`)', 'ne propose ni le compte rendu ni la livraison'],
    surfaces: ['README.md'],
  },
  { name: 'le filtre du groupe « durcissement », en anglais', keywords: ['propose those of medium severity or more, or that break an invariant', 'the others go to the journal, under « À reprendre »'], surfaces: ['hooks/register.tsx'] },
  {
    // La règle asana-board chargée partout n'en garde que le résumé : le détail est dans une référence du skill.
    name: 'le renvoi de la règle asana-board à sa référence',
    keywords: ['references/regles.md'],
    surfaces: ['config/rules/asana-board.md', 'asana-board/suivi-asana/SKILL.md'],
  },
  { name: 'le worker autonome', keywords: ['worker autonome', 'Worker autonome'], surfaces: ['reference/procedure-groupe.md'] },
  {
    name: 'la relecture du fond et de la forme',
    keywords: ['Lecteur', 'relecture-fond-forme.md', 'fond et de la forme'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe.md', 'README.md', 'hooks/register.tsx'],
  },
  {
    // La liste des zones sensibles : la commande ou le chemin construit d'une valeur lue ailleurs y est partout
    // (en anglais, SENSITIVE_AREAS de catalog.ts, que model.ts reprend : test cadrage-zone-sensible et rappels-outil).
    name: 'la liste des zones sensibles',
    keywords: ["concurrence, commande ou chemin construit à partir d'une valeur lue ailleurs"],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe.md', 'README.md', 'hooks/register.tsx'],
  },
  {
    // Un groupe sans logique ni zone sensible : ni revue du groupe ni revue de sécurité, quel que soit son nombre de tickets.
    name: "les revues d'un groupe sans logique ni zone sensible",
    keywords: ['ni revue du groupe ni revue de sécurité'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe-fin.md', 'README.md', 'hooks/register.tsx'],
  },
  {
    // Après la passe « bogues » d'un ticket sensible : une seule passe high sur tout ce qui a changé depuis son instantané.
    name: 'la passe unique après la passe « bogues »',
    keywords: ['une seule passe high', 'depuis son instantané', 'un nouveau, posé après les correctifs'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'README.md'],
  },
  {
    // Un changement sans effet sur le comportement n'a ni passe « bogues » ni nouvelle passe : la dispense est
    // définie dans la règle des revues, et la procédure la cite par son nom (aux deux passes qu'elle saute).
    name: 'la dispense d’un changement sans effet sur le comportement',
    keywords: ['« Changement sans effet sur le comportement »', 'sans effet sur le comportement'],
    surfaces: ['config/reference/revues.md', 'reference/procedure-groupe.md'],
  },
  { name: 'la dispense d’un changement sans effet, ailleurs', keywords: ['sans effet sur le comportement'], surfaces: ['config/rules/flow-board.md', 'README.md'] },
  { name: 'la dispense d’un changement sans effet, en anglais', keywords: ['no effect on behaviour', '« Changement sans effet sur le comportement »'], surfaces: ['hooks/catalog.ts'] },
  {
    name: 'la plage de la passe unique, dans la procédure',
    keywords: ['une seule passe high', 'depuis son instantané', '<hash d\'un nouvel instantané>'],
    surfaces: ['reference/procedure-groupe.md'],
  },
  {
    // Un texte qui fait agir Claude (une règle, une procédure, un skill) est « Logique : oui » : la règle des lots, le README, et la consigne de découpage en anglais.
    name: 'la logique d’un texte qui fait agir Claude',
    keywords: ['fait lancer une commande à Claude ou construire un chemin'],
    surfaces: ['config/rules/flow-board.md', 'README.md'],
  },
  { name: 'la logique d’un texte qui fait agir Claude, en anglais', keywords: ['makes Claude act'], surfaces: ['hooks/register.tsx'] },
  {
    // Les pistes d'une rétro passent par le découpage en tickets : ses bornes et la règle des fichiers chargés partout.
    name: 'le découpage des pistes d’une rétro',
    keywords: ['1 à 3', 'un seul groupe', 'chaque phrase ajoutée ou retirée'],
    surfaces: ['config/rules/flow-board.md', 'README.md', 'hooks/register.tsx'],
  },
  {
    // La même règle dans les consignes en anglais : au découpage (register.tsx) et pendant l'implémentation (catalog.ts).
    name: "les revues d'un groupe sans logique ni zone sensible, en anglais",
    keywords: ['has neither a group review nor a security review'],
    surfaces: ['hooks/catalog.ts', 'hooks/register.tsx'],
  },
  {
    // Les six catégories qui restent à la personne en auto, le choix d'expérience défini là où la liste le nomme :
    // la règle des lots, le premier clic sur « ⚡ Auto » (view.tsx), le README, la procédure d'un worker autonome.
    name: 'les six catégories qui bloquent en mode auto',
    keywords: ['expérience', 'mise en page, maquette, libellés, boutons, notifications', 'se valent techniquement et ne diffèrent que par', 'affaiblir un invariant', 'contredit une décision déjà prise', 'suppression sans retour', 'hors du poste', 'faille de sécurité sans correctif', 'effort xhigh', 'action externe hors de la mission'],
    surfaces: ['config/rules/flow-board.md', 'README.md', 'hooks/view.tsx', 'reference/procedure-groupe-autonome.md'],
  },
  {
    // Une question en zone sensible se tranche seule en auto, à une condition : les mêmes surfaces.
    name: 'la question sensible tranchée seule en mode auto',
    keywords: ['invariant déjà validé', 'la plus prudente', 'ne perd rien, n', 'ne supprime rien sans retour', '« Décidé sans toi »'],
    surfaces: ['config/rules/flow-board.md', 'README.md', 'hooks/view.tsx'],
  },
  {
    // --clean supprime la référence d'un instantané dès que chaque fichier figé est dans un commit de la branche,
    // fichier par fichier, fusions exclues (rétro « Coordinateur de parcours ») : la procédure et sa copie anglaise.
    name: 'la référence d’instantané supprimée fichier par fichier',
    keywords: ['fusions exclues, pas forcément le même pour tous', 'juste avant le `git add` des correctifs'],
    surfaces: ['reference/procedure-groupe.md'],
    old: ["si un commit de la branche depuis le parent de l'instantané porte chaque fichier", 'only once a commit of the branch carries every file of the snapshot', '`--clean` compare le commit à ce dernier instantané'],
  },
  { name: 'la référence d’instantané supprimée fichier par fichier, au README', keywords: ['fichier par fichier, fusions exclues', 'juste avant le `git add` des correctifs'], surfaces: ['README.md'] },
  { name: 'la référence d’instantané supprimée fichier par fichier, en anglais', keywords: ['merges excluded, not necessarily the same one for all', 'right before the git add of the fixes'], surfaces: ['hooks/catalog.ts'] },
  {
    // Sans --max-findings, /code-review s'arrête à 10 constats en high et 15 en xhigh, quel que soit le diff : la passe
    // « bogues » passe --max-findings all (rétro « Coordinateur de parcours »). La règle des revues, la procédure (avec
    // sa variante sans git), la consigne du mod et le README.
    name: 'le plafond de constats de la passe « bogues »',
    keywords: ['--max-findings all', '10 constats en high et 15 en xhigh'],
    surfaces: ['config/reference/revues.md', 'reference/procedure-groupe.md', 'README.md'],
  },
  { name: 'le plafond de constats de la passe « bogues », en anglais', keywords: ['<level> --max-findings all', '10 findings in high and 15 in xhigh'], surfaces: ['hooks/catalog.ts'] },
  {
    // Un groupe dont tous les tickets sont sensibles compte 3 à 4 tickets, et un ticket sensible lourd et indépendant
    // passe en premier : la règle des lots, le README, et la consigne de découpage en anglais.
    name: 'la taille d’un groupe de tickets sensibles',
    keywords: ['3 à 4', 'lourd et indépendant'],
    surfaces: ['config/rules/flow-board.md', 'README.md'],
  },
  { name: 'la taille d’un groupe de tickets sensibles, en anglais', keywords: ['holds 3 to 4 tickets', 'heavy and independent'], surfaces: ['hooks/register.tsx'], old: ['goes first only when it blocks the next one'] },
  {
    // En auto, une violation de l'invariant que la passe d'après les correctifs trouve encore, corrigée de la
    // façon la plus prudente, part en une ligne d'information, pas en question : la règle « Mode auto », le README.
    name: 'la violation corrigée au plus prudent, en mode auto',
    keywords: ["Une violation de l'invariant que trouve encore la passe high d'après les correctifs de la passe « bogues », corrigée de la façon la plus prudente, s'écrit en test et part en une ligne d'information, déclarée comme une reco prise « Zone sensible : … », pas en question"],
    surfaces: ['config/rules/flow-board.md'],
  },
  { name: 'la violation corrigée au plus prudent, en mode auto, ailleurs', keywords: ["corrigée de la façon la plus prudente", "une ligne d'information"], surfaces: ['README.md', 'reference/procedure-groupe.md'] },
  { name: 'la violation corrigée au plus prudent, en mode auto, en anglais', keywords: ['fixed in the most prudent way, is written as a test and goes out as one line of information'], surfaces: ['hooks/register.tsx'] },
  {
    // Le choix sensible tranché en auto se reconnaît à son texte, et le compte rendu le range à part.
    name: 'la marque d’un choix sensible tranché en auto',
    keywords: ['« Zone sensible : »'],
    surfaces: ['config/rules/flow-board.md', 'README.md', 'reference/procedure-groupe-autonome.md', 'skills/compte-rendu/SKILL.md', 'hooks/register.tsx'],
  },
  {
    // Le worker d'une mission en auto : la condition dans sa procédure, et le renvoi de la réponse de l'outil flow.
    name: 'la question sensible tranchée seule par un worker autonome',
    keywords: ['invariant déjà validé', 'la plus prudente', 'Seules les décisions qui restent bloquantes en mode auto montent au manager'],
    surfaces: ['reference/procedure-groupe-autonome.md'],
  },
  {
    // Les blocs de la spec et du découpage en auto : seuls l'invariant et la question sensible hors condition y bloquent.
    name: 'la question sensible à la spec et au découpage en mode auto',
    keywords: ['qui ne remplissent pas la condition pour se trancher seules'],
    surfaces: ['README.md'],
  },
  { name: 'la question sensible à la spec et au découpage en mode auto, en anglais', keywords: ['does not meet the condition above to be settled by you, stay blocking questions on this phase ("phase": "to-tickets")', 'and setting or weakening an invariant, stay blocking questions on this phase ("phase": "to-spec")'], surfaces: ['hooks/register.tsx'] },
  {
    // Les questions répondues par écrit chez le COO : les mêmes catégories que la liste bloquante.
    name: 'les questions répondues par écrit chez le COO',
    keywords: ["un choix d'expérience, une zone sensible, un invariant ou une contradiction, une suppression ou une exposition"],
    surfaces: ['skills/coo/SKILL.md'],
  },
  { name: 'les questions répondues par écrit chez le COO, en anglais', keywords: ['an experience choice, a sensitive area, an invariant or a contradiction, a deletion or an exposure'], surfaces: ['hooks/register.tsx'] },
  { name: 'la question sensible tranchée seule par un worker autonome, en anglais', keywords: ['a worker of a mission in auto mode', '« Worker autonome »'], surfaces: ['hooks/model.ts'] },
  {
    // Les origines d'un choix déclaré en auto, et la notification au texte fixé : la règle des lots et le README.
    name: 'les choix et la notification du mode auto',
    keywords: ['« reco prise »', '« validation sautée »', 'PushNotification', "N question(s) t'attendent"],
    surfaces: ['config/rules/flow-board.md', 'README.md'],
  },
  {
    // Ce que le second clic accorde : les validations sautées, la même liste dans la règle des lots, le glossaire et le README.
    name: 'les validations sautées du mode auto',
    keywords: ['accord du cadrage, spec, découpage, plan, écritures Asana de la mission'],
    surfaces: ['config/rules/flow-board.md', 'GLOSSARY.md', 'README.md'],
  },
  { name: 'les validations sautées du mode auto, en anglais', keywords: ['framing agreement, spec, ticket split, work plan', 'the tickets created, their statuses'], surfaces: ['hooks/register.tsx'] },
  {
    // Les écritures Asana que le second clic accorde : la règle « Mode auto » des lots et le premier clic sur « ⚡ Auto ».
    name: 'les écritures Asana accordées en mode auto',
    keywords: ['création des tickets, statuts'],
    surfaces: ['config/rules/flow-board.md', 'hooks/view.tsx'],
  },
  {
    // Les règles chargées partout ne recopient pas les exceptions du mode auto : un renvoi au bloc de la consigne, qui les porte.
    name: 'le renvoi au bloc « mode auto » des règles communes',
    keywords: ["En mode auto, le bloc « mode auto » de la consigne flow-board l'emporte"],
    surfaces: ['config/rules/general.md', 'config/rules/asana-board.md', 'config/rules/flow-board.md'],
  },
  {
    // L'accord du mode auto et le tour d'intention recueilli par le COO : la règle des lots et le README.
    name: 'l’accord du mode auto et le tour d’intention du COO',
    keywords: ['« Lancer en auto »', 'à la seule discussion lancée pour lui, dans les 10 minutes', 'une fusion, une reconstruction ou une lecture ratée laisse l\'auto éteint ou l\'éteint, jamais l\'inverse', 'travail/<sujet>/demande.md'],
    surfaces: ['config/rules/flow-board.md', 'README.md'],
  },
  {
    // Le worker autonome et l'effort en mode auto : à tout effort, jamais xhigh proposé ; les groupes suivants lancés par le mod.
    name: 'le worker autonome et l’effort en mode auto',
    keywords: ['quel que soit son effort', 'ne propose jamais xhigh', 'le mod lance lui-même les groupes suivants', 'jamais par une question à boutons'],
    surfaces: ['config/rules/flow-board.md'],
  },
  {
    // Un ticket qui modifie une règle, une référence ou un skill a de la logique (étape slice de catalog.ts) :
    // la règle des lots et la règle des revues le disent, et plus aucune surface ne dit qu'une règle n'en a pas.
    name: 'la logique d’un ticket qui modifie une règle, une référence ou un skill',
    keywords: ['ticket qui modifie les règles communes (`config/rules`), un fichier de référence ou un skill', 'ces textes guident ce que fait Claude'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md'],
    old: ['une règle qui ne fait rien lancer'],
  },
  {
    // Au retour d'un groupe, le manager vérifie que la revue du groupe a tourné, sauf là où elle n'est pas due :
    // la consigne de délégation (register.tsx) et le README.
    name: "les revues vérifiées au retour d'un groupe",
    keywords: ['que la revue du groupe a tourné', "pas de revue du groupe pour un groupe d'un seul ticket", 'ni revue du groupe ni revue de sécurité sans logique ni zone sensible', '"returned"', '"reviewed"'],
    surfaces: ['README.md', 'hooks/register.tsx'],
  },
  { name: 'le worker autonome en mode auto, au glossaire', keywords: ['quel que soit son effort', 'mode auto'], surfaces: ['GLOSSARY.md'] },
  {
    // Une session liée d'un parcours en mode auto est autonome à tout effort : la règle, la procédure, la demande de délégation, le README.
    name: 'le worker autonome à tout effort en mode auto',
    keywords: ['quel que soit son effort'],
    surfaces: ['config/rules/flow-board.md', 'reference/procedure-groupe.md', 'hooks/register.tsx', 'README.md'],
  },
  {
    // Les mêmes, en anglais, dans la consigne du mode auto, avec ses deux origines de choix et la question sensible tranchée seule.
    name: 'les six catégories qui bloquent en mode auto, en anglais',
    keywords: ['an experience choice', 'layout, mockup, labels, buttons, notifications', 'technically equal and differ only by', 'setting or weakening an invariant', 'contradicts DECISIONS.md', 'a deletion with no way back', 'outside this machine', 'leaving a security finding unfixed', 'declare that xhigh was not offered', 'external action outside the mission', '« reco prise »', '« validation sautée »', 'the invariant already validated', 'the most prudent one'],
    surfaces: ['hooks/register.tsx'],
  },
  {
    // Les cas du cycle de vie d'un champ persisté, posés au cadrage plutôt que ticket par ticket pendant
    // l'implémentation : les deux skills de cadrage et les étapes de /to-spec et /to-tickets (catalog.ts).
    name: 'les cas du cycle de vie d’un champ persisté',
    keywords: ['a failed read', 'a failed write', 'its bounds', 'the erasure of what must be kept', 'a forged copy', 'each transition of the object that carries a mark (sent, cancelled, sent again, back)', 'a value already kept out of form when a new one arrives'],
    surfaces: ['to-spec/SKILL.md', 'to-tickets/SKILL.md', 'hooks/catalog.ts'],
  },
  {
    // Trois questions de suite sur un même prédicat de rattachement, dont une option recommandée qui perdait
    // un nom raté : le cadrage pose le tableau des formes reçues, que chaque option d'une question reprend.
    name: 'le tableau des formes reçues par un prédicat de rattachement',
    keywords: ['attachment predicate', 'absent, template not filled in, old id (out of form), valid but unknown to the plan', 'the test that fixes it', 'repeats that table under each of its options'],
    surfaces: ['to-spec/SKILL.md', 'to-tickets/SKILL.md', 'hooks/catalog.ts'],
  },
  {
    name: 'le tableau des formes repris par une question sensible née en cours de ticket',
    keywords: ['prédicat de rattachement', 'le tableau des formes reçues (absente, modèle non rempli, ancien id hors forme, valide mais inconnue du plan)'],
    surfaces: ['reference/procedure-groupe.md'],
  },
  {
    // Un critère d'un ticket sensible qui contredisait son invariant n'était vu qu'à l'implémentation.
    name: 'la relecture des critères d’un ticket sensible contre son invariant',
    keywords: ['against its invariant'],
    surfaces: ['to-tickets/SKILL.md', 'hooks/catalog.ts'],
  },
  {
    // Un invariant nommait des champs que le code enfreignait déjà par conception, vu seulement à l'implémentation.
    name: 'chaque clause de l’invariant relue contre le code',
    keywords: ['each clause of the invariant', 'against the current code, field by field', 'breaks by design becomes a question for the user now', 'naming those fields and the function the ticket changes'],
    surfaces: ['to-tickets/SKILL.md', 'hooks/catalog.ts'],
  },
  {
    // Un critère « les tests existants passent sans changer leurs attentes », écrit sans recherche, était faux.
    name: 'le critère sur les tests existants appuyé d’une recherche',
    keywords: ['criterion about the existing tests', 'in any ticket', 'the tests that read the function the ticket changes', 'the command and its result'],
    surfaces: ['to-tickets/SKILL.md', 'hooks/catalog.ts'],
  },
  {
    // Deux constats importants d'un groupe venaient d'un texte écrit avant la mesure et jamais recoupé ; une mesure
    // de départ par `claude -p` avait dû être refaite en session interactive, et un critère sur un fichier partagé
    // entier ne pouvait pas tenir face à une autre discussion qui commite.
    name: 'le ticket de mesure qui cite ses lignes de journal',
    keywords: ['measurement ticket', 'quotes its log line', 'runs in an interactive session: a `-p` run loads neither connectors nor deferred tools', 'compares only the files the ticket changes (a diff limited to its paths)'],
    surfaces: ['to-tickets/SKILL.md'],
  },
  {
    // Une API du moteur se vérifie avant d'entrer dans une spec : la consigne de cadrage (catalog.ts) et
    // le document des événements, qui dit ce que le moteur refuse (le « / » de $.prompt.submit, no-surface).
    name: 'ce que le moteur refuse, vérifié au cadrage',
    keywords: ['plugin-authoring', '$.command.run', 'no-surface'],
    surfaces: ['hooks/catalog.ts', 'docs/evenements-moteur.md'],
  },
  {
    name: 'ce que le moteur refuse, avec ses sources',
    keywords: ['## Ce que le moteur refuse', 'a text beginning with / would run a command as the user', 'UiNotifyResult', 'écrits par Claude Code 2.1.310', 'essai du 30/10/2026', 'With no terminal the hooks alone run; unbound or exiting, none'],
    surfaces: ['docs/evenements-moteur.md'],
  },
  {
    // Les trois moments de l'advisor valent pour une discussion ; un spécialiste ne le consulte jamais, puisque
    // la discussion qui le lance relit son rapport (21 % de la dépense, surtout des relecteurs avant leur rapport).
    name: "l'advisor réservé aux discussions, dans la règle commune",
    keywords: ['dans une discussion (COO, manager, worker, discussion ordinaire)', "Un spécialiste ne consulte jamais l'advisor"],
    surfaces: ['config/rules/general.md'],
  },
  {
    // Chaque relecteur porte la ligne dans ce qu'il lit d'abord : le bloc de ses consignes (fork de /code-review
    // compris), son prompt, sa méthode, et la consigne du mod qui le lance (catalog.ts, importée par register.tsx).
    name: "la ligne « Ne consulte pas l'advisor » des relecteurs",
    keywords: ["Ne consulte pas l'advisor : la discussion qui t'a lancé relit ton rapport."],
    surfaces: ['reference/consignes-revue.md', 'reference/procedure-groupe.md', 'reference/prompt-relecteur.md', 'reference/revue-securite.md', 'reference/relecture-fond-forme.md', 'hooks/catalog.ts'],
  },
  { name: "la ligne de l'advisor, dans les consignes du mod qui lancent un relecteur", keywords: ['NO_ADVISOR_LINE'], surfaces: ['hooks/register.tsx'] },
  {
    // Une passe « bogues » avait classé Mineur une exception levée sur une entrée qui passait avant, faute
    // de violer l'invariant : la régression est Important, et chaque règle des pistes l'excepte.
    name: 'la régression Important, dans la consigne des relecteurs',
    keywords: ['une régression introduite par le diff (une entrée qui passait avant lui et qui maintenant lève, change de résultat ou est refusée) est Important, que le ticket ait un invariant ou non', 'même sur une ligne que le diff n\'a pas changée (l\'appelant d\'une fonction dont il change le contrat) : elle n\'est pas Antérieure'],
    surfaces: ['reference/consignes-revue.md', 'reference/procedure-groupe.md'],
  },
  {
    name: 'la régression Important, dans la consigne des relecteurs, en anglais',
    keywords: ['a regression the diff introduces (an input that passed before it and now throws, gives another result or is refused) is Important, whether or not the ticket has an invariant', 'even on a line the diff did not change (the caller of a function whose contract it changes): it is not Pre-existing', 'except a regression the diff introduces, which gets fixed'],
    surfaces: ['hooks/catalog.ts'],
  },
  {
    // La consigne de compaction d'un worker garde ses pistes pour le compte rendu : une régression corrigée n'en est pas une.
    name: 'la régression exceptée des pistes, en anglais',
    keywords: ['except a regression the diff introduces, which gets fixed'],
    surfaces: ['hooks/catalog.ts', 'hooks/compaction.ts'],
  },
  {
    name: 'la régression exceptée des pistes',
    keywords: ['sauf une régression introduite par le diff (une entrée qui passait et qui maintenant lève, change de résultat ou est refusée), Important, qui se corrige'],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md'],
  },
  {
    // Le relecteur de sécurité cherche et vérifie lui-même : une revue coûtait 2 à 5 agents, chacun avec environ
    // 70k de contexte de départ, et 82 % des revues ne trouvaient rien. Les sous-tâches ne reviennent nulle part.
    name: 'la revue de sécurité en un seul agent',
    keywords: ['cherche et vérifie lui-même, sans lancer d\'agent'],
    surfaces: ['reference/revue-securite.md', 'reference/procedure-groupe-fin.md', 'config/reference/revues.md', 'hooks/register.tsx', 'README.md'],
    old: ['sous-tâche de vérification', 'sous-tâche de recherche', 'verification subtask', 'à ses sous-tâches', 'recherche et vérifications comprises', 'pour sa recherche et ses vérifications', 'for its search and its verifications'],
  },
  { name: 'la revue de sécurité en un seul agent, en anglais', keywords: ['it searches and verifies by itself, launching no agent'], surfaces: ['hooks/register.tsx'] },
  {
    // La revue de sécurité désactivée pour un projet (réglage du tableau de bord) : l'avis se juge et s'envoie quand
    // même, sans relecteur, et le compte rendu le note ; chaque règle qui dit quand la conseiller le rappelle.
    name: 'la revue de sécurité désactivée pour le projet',
    keywords: ["sauf si la revue de sécurité est désactivée pour le projet : l'avis se donne quand même et se note au compte rendu"],
    surfaces: ['config/rules/flow-board.md', 'config/reference/revues.md', 'reference/procedure-groupe-fin.md'],
  },
  { name: 'la revue de sécurité désactivée, dans la méthode', keywords: ["Sauf si la revue de sécurité est désactivée pour le projet : l'avis se donne quand même et se note au compte rendu"], surfaces: ['reference/revue-securite.md'] },
  { name: 'la revue de sécurité désactivée, dans le critère anglais', keywords: ['unless the security review is turned off for the project: the advice is still given and noted in the report'], surfaces: ['hooks/catalog.ts'] },
  { name: 'la revue de sécurité désactivée, dans les consignes d’avis', keywords: ['launch no security reviewer', 'SECURITY_OFF_NOTE'], surfaces: ['hooks/register.tsx'] },
  { name: 'la ligne du compte rendu de la revue désactivée', keywords: ['revue de sécurité désactivée pour ce projet ; ', 'touchait :'], surfaces: ['hooks/model.ts', 'hooks/catalog.ts', 'skills/compte-rendu/SKILL.md'] },
  { name: 'la ligne du compte rendu de la revue désactivée, pour un groupe et pour un lot', keywords: ['le groupe touchait :', 'le lot touchait'], surfaces: ['skills/compte-rendu/SKILL.md'] },
  {
    // Les agents de plugin refusent l'outil dans leur en-tête, et leur consigne le dit.
    name: "l'advisor refusé aux agents de plugin",
    keywords: ['disallowedTools: advisor', "N'appelle jamais l'outil `advisor`"],
    surfaces: ['agents/researcher.md', 'agents/explorer.md'],
  },
  {
    // Un explorateur, pourtant en lecture seule, avait redirigé une sortie vers un fichier (`> /tmp/none`).
    name: "l'explorateur sans redirection vers un fichier",
    keywords: ['aucune redirection vers un fichier (`>`, `>>`, `tee`), seulement `2>/dev/null` pour taire les erreurs'],
    surfaces: ['agents/explorer.md'],
  },
  {
    // Le README d'agents décrit la même règle : il la suit quand elle change.
    name: "l'explorateur sans redirection, dans le README d'agents",
    keywords: ['(`>`, `>>`, `tee`)', '`2>/dev/null`'],
    surfaces: ['agents/explorer.md', 'agents/README.md'],
  },
  {
    // Une question de cadrage qui renvoyait au rapport (« voir section C2 ») avait dû être réexpliquée.
    name: 'la question de grilling lisible seule',
    keywords: ['Each question reads on its own: it restates in one or two sentences the fact or the finding it rests on'],
    surfaces: ['grilling/SKILL.md'],
  },
]

test("la ligne de l'advisor est dans les deux variantes du prompt du relecteur de ticket", () => {
  const line = "Ne consulte pas l'advisor : la discussion qui t'a lancé relit ton rapport."
  assert.equal(SURFACES['reference/prompt-relecteur.md'].split(line).length - 1, 2)
})

for (const consigne of CONSIGNES) {
  test(`${consigne.name} : chaque surface qui la recopie en porte les mots-clés`, () => {
    const missing = []
    for (const surface of consigne.surfaces) {
      const text = SURFACES[surface]
      if (text === null) continue
      for (const keyword of consigne.keywords) if (!text.includes(keyword)) missing.push(`${surface} : « ${keyword} »`)
    }
    assert.deepEqual(missing, [], `mots-clés absents de ${consigne.name}`)
  })
  // Une copie restée à l'ancienne formulation dans un fichier qui porte aussi la nouvelle passait le test à
  // mots-clés : les anciennes formulations d'une consigne sont refusées dans toutes les surfaces.
  if (consigne.old)
    test(`${consigne.name} : plus aucune surface ne garde son ancienne formulation`, () => {
      const stale = Object.entries(SURFACES).flatMap(([name, text]) => (text === null ? [] : consigne.old.filter(k => text.includes(k)).map(k => `${name} : « ${k} »`)))
      assert.deepEqual(stale, [])
    })
}

// Hors de la règle « Mode auto » des lots, les règles chargées dans toutes les sessions ne parlent du mode auto
// que par le renvoi au bloc de la consigne (et la définition d'un worker autonome) : une exception recopiée
// y ajoutait des centaines de mots qui ne valent que dans la discussion d'où l'auto agit.
const AUTO_RULES = ['config/rules/general.md', 'config/rules/asana-board.md', 'config/rules/flow-board.md']
const AUTO_ALLOWED = ["En mode auto, le bloc « mode auto » de la consigne flow-board l'emporte", 'ou par une mission en mode auto quel que soit son effort']

test('les règles communes ne recopient pas les exceptions du mode auto, hors de la règle « Mode auto »', () => {
  const copied = []
  for (const surface of AUTO_RULES) {
    const text = SURFACES[surface]
    if (text === null) continue
    for (const line of text.split('\n')) {
      if (line.startsWith('- **Mode auto**')) continue
      let rest = line
      for (const allowed of AUTO_ALLOWED) rest = rest.split(allowed).join('')
      if (/mode auto|en auto\b|« ⚡ Auto »/.test(rest)) copied.push(`${surface} : ${line.slice(0, 80)}…`)
    }
  }
  assert.deepEqual(copied, [], 'exceptions du mode auto recopiées hors de la règle « Mode auto »')
})
