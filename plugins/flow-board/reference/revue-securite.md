# Méthode de la revue de sécurité (flow-board)

Ce fichier est la méthode fixe que suit le spécialiste relecteur d'une revue de sécurité lancée par flow-board : après la revue d'un groupe, après celle d'une mission sans groupes, ou par le bouton « ⛨ Revue de sécurité ». Il reprend la méthode de `/security-review` de Claude Code (catégories, exclusions, une recherche puis une vérification par faille, seuil de confiance, rapport détaillé) et garde ce que la revue de flow-board fait en plus : la plage exacte du groupe, le contexte du projet, les choix déclarés, la lecture seule.

Le prompt du relecteur donne le chemin de ce fichier et celui de son fichier de consignes (périmètre, fichier des choix déclarés, points réservés à la personne). Lis les deux, puis lance tout de suite la recherche (section 5) : ne relis pas le diff toi-même avant, c'est la sous-tâche de recherche qui le lit avec son contexte (une relecture préalable avait coûté 7 minutes sans rien changer à la suite).

## 1. Quand une revue de sécurité tourne, et à quel effort

Le compte de la personne est la frontière de confiance. Une revue de sécurité ne se conseille que si les changements font franchir quelque chose à la limite du compte, une zone de cette liste : secrets et jetons (masquage compris), dépendances et code tiers lancé, publication, réseau ou export public, droits des fichiers et accès (qui d'autre que le compte peut lire ou écrire ce que le diff enregistre) ; l'accès comprend l'authentification et les règles d'accès d'une application, et le réseau vaut dans les deux sens : une règle d'accès d'une base, d'une API ou d'une route qui change, ou une entrée venue du réseau (requête d'un client, réponse d'un service) qui atteint une requête, une commande ou un chemin, en font partie. En dehors : un fichier sous `~/.claude` écrit par une autre session du compte n'est pas une entrée hostile, et ni une suppression de données ni la concurrence seule n'en font partie. Une valeur relue d'un tel fichier qui entre dans une commande, un chemin ou un texte ne fait donc pas entrer le diff dans la liste (un fichier forgé sous `~/.claude` est un risque accepté) ; les défauts d'une suppression ou de la concurrence relèvent de la passe « bogues » et de la revue du groupe, qui les trouvent. Hors de cette liste, l'avis est « revue jugée inutile » (`"advised": false`) : une valeur relue qui entre dans une commande shell ou un chemin revient alors à la revue du groupe, du lot ou de la mission, dont les consignes ont une ligne « sécurité » pour elle. Sur les revues relues le 02/11/2026, les failles gardées venaient des secrets, des dépendances et des données qui sortent du poste (environ 15 failles sur 7 revues) ; les revues décidées par une valeur relue sous `~/.claude` ou par une suppression n'en gardaient presque aucune (4 failles sur 17 revues, 0 sur 8).

Elle tourne en `high`, recherche et vérifications comprises, en une seule passe : celui qui lance le relecteur lui passe `model: "opus"` et `effort: "high"`, et le relecteur passe le même à ses sous-tâches. Le relecteur écrit en tête de son rapport la zone de la liste qui a décidé la revue. Pour la juger, la liste des fichiers du diff suffit : pas de lecture du diff.

### Critère d'effort de la passe « bogues » d'un ticket sensible

Ce critère ne sert plus à la revue de sécurité, mais à la passe « bogues » d'un ticket sensible qui ne supprime pas de données et ne touche pas la concurrence (celle d'un ticket très sensible est en `xhigh`). `xhigh` coûte nettement plus que `high` : environ 2,5 fois medium contre 1,5 fois d'après la documentation de Claude, et 4,4 fois la durée de `high` sur une passe « bogues » mesurée. Ne le prendre que si l'un de ces cas est vrai.
- **Enjeu** : le diff touche une zone de la liste ci-dessus.
- **Taille** : le diff dépasse 400 lignes modifiées (comptées par `git diff --numstat`, sans tests, fichiers générés ni binaires) **et** touche des accès au réseau ou aux fichiers.

Sinon `high` : petit diff, affichage, lecture de fichiers propres au plugin, réorganisation sans nouvelle entrée venue de l'extérieur. Dans le doute entre les deux, `high`.

## 2. Périmètre et contexte

- **Le seul diff donné** : la plage exacte du fichier de consignes (`git diff <base>..<lancement>` d'un groupe, où <lancement> est le hash de HEAD que celui qui lance la revue y a écrit, jamais `HEAD` : les correctifs de la revue du groupe se commitent pendant que tu tournes ; ou les changements de la mission). Jamais `git diff origin/HEAD...` ni la branche face à la branche par défaut : elle contiendrait d'autres groupes.
- **Le contexte du projet** : lis le `CLAUDE.md` du projet, les fichiers que le diff touche en entier, et ce qu'ils appellent, pour connaître ses gardes existantes (validation, échappement, droits) et ce qui vient de l'extérieur du compte (réseau, dépendances et code tiers, dépôt ou export public, sortie d'une commande tierce) ; les fichiers sous `~/.claude` écrits par d'autres sessions du compte sont de confiance (précédent 13).
- **Le code déjà livré** : signale aussi ce que ce diff rend exploitable dans le code des groupes déjà livrés (une garde qu'il contourne, une entrée qu'il fait arriver jusqu'à un ancien chemin dangereux).
- **Les choix déclarés** : ceux du fichier des choix, et ceux que le fichier de consignes ajoute, ne se resignalent pas comme failles. Un choix qui ouvre une vraie faille se dit comme question à la personne, sans être défait.
- **Lecture seule** : n'écris rien dans l'arbre de travail, ne lance aucune commande qui modifie quelque chose. Lire le code suffit à juger une faille. Tes seules écritures (copies extraites, notes) vont dans le dossier du relecteur que donne ton fichier de consignes (ligne « Où écrire »), `git rev-parse --git-path flow-board/revue-securite-<id du groupe>`, que celui qui te lance crée par `snapshot.mjs --dossier securite-<id du groupe>` : propre à ce worktree, hors de l'arbre suivi ; jamais dans `/tmp` (des noms génériques y avaient écrasé les copies d'une autre session) ni ailleurs.

## 3. Catégories à examiner

- **Validation des entrées** : injection SQL ou NoSQL, injection de commande (appels système, sous-processus, `cmd.exe`), injection de gabarit, XXE, traversée de chemin dans les opérations sur les fichiers.
- **Authentification et droits** : contournement d'authentification ou d'autorisation, élévation de privilèges, sessions mal gérées, jetons (JWT) mal vérifiés.
- **Chiffrement et secrets** : clés, mots de passe ou jetons écrits en dur ; algorithmes faibles ; clés mal rangées ; hasard non cryptographique ; vérification de certificat contournée.
- **Exécution de code** : désérialisation dangereuse (pickle, YAML), `eval` ou code dynamique, XSS dans une page web.
- **Exposition de données** : secrets ou données personnelles journalisés ou enregistrés, fuites par une API, informations de débogage exposées.
- **Dépendances** : une dépendance ajoutée ou changée sans version fixée, d'une source non officielle, ou lancée depuis un dossier qu'un tiers contrôle (`npx`, `.npmrc` du projet).
- **Données sensibles sur disque** : ce que le diff enregistre (prompts, arguments de commandes, contenu de messages) et qui le peut lire (droits du dossier, autres comptes, version publique).

Une faille exploitable seulement depuis le réseau local reste une faille.

## 4. Exclusions

Ne rapporte pas :
1. un déni de service, l'épuisement de ressources, la consommation de mémoire ou de processeur, les limites de débit ;
2. le manque de validation d'un champ sans enjeu de sécurité démontré ;
3. une situation de course ou d'horloge seulement théorique (rapporte-la si elle est concrète) ;
4. un défaut de sécurité mémoire dans un langage qui en protège (TypeScript, Rust) ;
5. un fichier qui ne sert qu'aux tests ;
6. l'usurpation de journaux (une entrée non nettoyée dans un journal) ;
7. une SSRF qui ne contrôle que le chemin, pas l'hôte ni le protocole ;
8. du contenu de la personne mis dans un prompt d'IA ;
9. le déni de service par expression régulière (une expression qui s'emballe sur une entrée longue) ; une entrée qui change ce qu'une expression régulière vise (un id non échappé qui fait toucher d'autres fichiers) reste à rapporter ;
10. la documentation (fichiers Markdown) ;
11. l'absence de journal d'audit ;
12. le nettoyage des entrées d'un workflow GitHub Actions, sauf s'il se déclenche clairement par une entrée non fiable.

Contrairement à `/security-review`, **les dépendances et les données sensibles sur disque restent cherchées** (catégories ci-dessus). **L'absence d'une mesure de durcissement** n'est pas une faille : elle va dans la liste « à surveiller ».

Précédents :
1. Un secret de valeur journalisé en clair est une faille ; une adresse journalisée ne l'est pas.
2. Un UUID est tenu pour impossible à deviner, sans validation.
3. Les variables d'environnement et les options de la ligne de commande sont des valeurs de confiance : une attaque qui suppose de les contrôler ne compte pas.
4. Les fuites de ressources (mémoire, descripteurs de fichiers) ne sont pas des failles.
5. Les failles web subtiles ou de faible effet (tabnabbing, XS-Leaks, pollution de prototype, redirections ouvertes) ne se rapportent qu'avec une très forte confiance.
6. React et Angular protègent du XSS : pas de faille XSS dans un composant React ou Angular, ni dans un fichier `.tsx`, sauf s'il passe par une méthode dangereuse (`dangerouslySetInnerHTML`, `bypassSecurityTrustHtml`…).
7. La plupart des failles des workflows GitHub Actions ne s'exploitent pas : n'en garder une qu'avec un chemin d'attaque précis.
8. Le manque de contrôle des droits dans du code JS/TS côté client n'est pas une faille : c'est au serveur de valider ce qu'il reçoit.
9. Une faille moyenne ne se garde que si elle est évidente et concrète.
10. La plupart des failles d'un notebook (`.ipynb`) ne s'exploitent pas : n'en garder une qu'avec une entrée non fiable qui la déclenche.
11. Journaliser des données sans secret ni donnée personnelle n'est pas une faille, même sensibles.
12. Une injection de commande dans un script shell ne compte que si une entrée non fiable l'atteint par un chemin précis.
13. Propre à flow-board (contexte du projet) : le compte de la personne est la frontière de confiance. Un fichier sous `~/.claude` écrit par une autre session de son compte (registre, relais, transcript, fichier des missions) n'est **pas** une entrée hostile : une attaque qui suppose de le forger ne compte pas, comme une variable d'environnement (précédent 3). Une donnée qui sort du poste (publication, export public, réseau), un code tiers lancé ou un fichier que d'autres comptes peuvent lire ou écrire restent à examiner. Qu'un tel fichier soit abîmé (écriture coupée) relève de la passe « bogues », pas de cette revue.

Pour chaque faille qui reste, juge la qualité du signal : un chemin d'attaque concret et exploitable ; un vrai risque plutôt qu'une bonne pratique théorique ; des lignes précises, la garde contournée et la source de l'entrée (section 6), sans étapes prêtes à l'emploi ; un constat sur lequel on peut agir.

## 5. Méthode en trois étapes

1. **Recherche** : la première chose que fait le relecteur, sans relecture préalable du diff : une sous-tâche (outil Agent, `model: "opus"` et l'effort `high`, passés explicitement, description « Sécurité : recherche ») cherche les failles du diff avec tout ce fichier et le fichier de consignes. Elle rend chaque faille avec son `fichier:ligne`, sa catégorie, sa gravité et son scénario (garde, trou, source, effet : section 6).
2. **Vérification** : pour chaque faille trouvée de gravité **moyenne ou haute**, une sous-tâche de vérification (outil Agent, `model: "opus"` et l'effort `high`, passés explicitement, description « Sécurité : vérification <n> », <n> le rang de la faille), toutes lancées en parallèle dans un seul message. Une faille de gravité basse n'est pas vérifiée : elle va droit dans la liste « à surveiller » (vérifier des candidats déjà jugés bas coûtait des passes xhigh sans rien garder). Chaque sous-tâche essaie d'en faire un faux positif en relisant le code (exclusions, précédents, gardes existantes) et rend une note de confiance de 1 à 10 :
   - 1 à 3 : probablement un faux positif ;
   - 4 à 6 : à creuser ;
   - 7 à 10 : probablement une vraie faille.
3. **Tri** : une faille notée **8 ou plus**, de gravité haute ou moyenne, est **gardée**. Une faille notée 5 à 7, ou de gravité basse (non vérifiée), va dans la liste **« à surveiller »**, sans être supprimée. En dessous de 5, elle est écartée.

Gravité :
- **Haute** : exploitable directement, jusqu'à l'exécution de code, une fuite de données ou un contournement d'authentification ;
- **Moyenne** : demande des conditions précises, mais l'effet est important ;
- **Basse** : défense en profondeur, ou effet faible.

## 6. Rapport

En tête : la zone de la liste qui a décidé la revue (section 1), puis le périmètre relu.

Puis chaque faille gardée, numérotée F1, F2… :

```
## F1 : <catégorie> : `fichier:ligne`
- Gravité : haute | moyenne
- Confiance : 8 à 10
- Description : ce qui ne va pas, et d'où vient l'entrée.
- Scénario : la garde en place, le trou qui la contourne, la source de l'entrée, l'effet. Une description, jamais une chaîne d'attaque prête à l'emploi (ni commande ni charge complètes : un filtre avait coupé une recherche qui écrivait un scénario pas à pas).
- Recommandation : le correctif proposé, prêt à appliquer : ce qu'il change, fichier par fichier, et le choix qu'il implique s'il y en a un (à trancher par la personne).
```

Puis la liste « à surveiller » (notées 5 à 7, gravité basse non vérifiée, absence de durcissement), une ligne chacune avec son `fichier:ligne` et sa note. Puis, à part, ce que le diff rend exploitable dans le code déjà livré, et les constats sur du code antérieur au lot.

## 7. Après les correctifs de la revue du groupe

Pas de seconde passe sur le diff des correctifs de la revue du groupe (une seconde passe de 33 minutes sur 111 lignes n'avait rien trouvé) : la revue de sécurité tourne une seule fois (Mathis, 01/11/2026).

## 8. Correctifs

La revue ne corrige rien : elle reste en lecture seule, et la personne décide. Chaque faille gardée arrive avec son correctif proposé (section 6). Une réponse de la personne comme « corrige F1 et F3 » suffit : la session applique ces correctifs, les teste, les commite, puis envoie à l'outil flow le nombre corrigé dans `fixed`. Une faille gardée laissée ouverte reçoit une tâche du suivi.

`findings`, envoyé à l'outil flow, ne compte que les failles gardées, pas la liste « à surveiller ».
