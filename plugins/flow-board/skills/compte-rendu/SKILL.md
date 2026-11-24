---
name: compte-rendu
description: "Rapport du travail d'une mission, à lire et valider par la personne avant toute livraison : ce qui est fait, ce que chaque entrée triée est devenue, décidé sans elle, mal passé, bloqué par elle, trouvé, le code antérieur au lot, les pistes, le contexte et le coût de ses discussions, la documentation, ce que le CHANGELOG devra dire, et ce que le push enverra."
disable-model-invocation: true
---

Écris le compte rendu du travail mené depuis le début de la mission. La personne le lit puis le valide ou non depuis le tableau de bord, avant de lancer la livraison (`/project:version`, `/project:push`). Le rapport doit tout lui dire, rester facile à lire et court.

## 1. Rassembler les faits

Avant d'écrire, vérifie chaque fait au lieu de te fier à ta mémoire de la discussion :

- `git log` depuis le début de la mission (le tableau de bord en donne la date plus bas ; sinon, depuis le début du travail de la discussion) et `git status` : commits, fichiers non commités ;
- les commits de la mission déjà sur le dépôt distant : `git fetch`, puis `git log --oneline origin/<branche>..HEAD` (ce qui reste à envoyer) face au `git log` de la mission ; ceux qui n'y sont pas sont déjà livrés, et le rapport le dit ;
- les versions posées depuis le début de la mission, par cette discussion ou une autre : `git log` depuis cette date du `CHANGELOG.md` et du fichier de version de chaque plugin ou paquet touché ; une entrée déjà publiée ne se redemande pas dans « Ce que le CHANGELOG devra dire », et « Ce que la livraison enverra » nomme la version qu'elle porte ;
- **tous** les fichiers de suivi de la mission, là où le `CLAUDE.md` du projet les range (par exemple `travail/<sujet>/` : spec, tickets, `DECISIONS.md` ; sinon `travail/tasks/…`), pas seulement celui de cette discussion : une mission en plusieurs groupes passe souvent par plusieurs discussions, et ce que les autres ont fait, trouvé ou décidé n'est plus que là, dans `git log`, dans le journal de `ETAT_DU_PROJET.md` et dans les commentaires des tickets ;
- ce que les décisions de la mission demandent au compte rendu lui-même : relis son fichier de décisions (son index « Décisions en vigueur » d'abord, puis les séries en vigueur) pour y trouver chaque obligation du rapport (un chiffre à donner, un bilan, une question à poser à la personne) ; chacune se fait dans le rapport, à la section qui lui convient, ou le rapport dit pourquoi elle ne peut pas l'être ; aucune ne se met de côté (`setAside`) : une obligation ainsi mise de côté n'avait jamais été faite ;
- le partage d'un tri, `tri.md`, quand le dossier de la mission en a un écrit par le tri de cette mission (`git log` du fichier depuis le début de la mission : sans commit depuis, il a été laissé par une mission plus ancienne du même dossier et ne se lit pas) : une ligne par entrée de la feuille de route ou par sous-ligne (`R62-a`), avec son état (« corrige », « pour l'utilisateur », « question », « écarte », « renvoie »), sa raison et sa colonne « ticket » ; pour une ligne « corrige », la colonne « ticket » et l'état de chaque ticket qu'elle nomme (fait ou non, d'après les fichiers de tickets et le tableau de bord) donnent son sort ; une entrée « corrige » dont un ticket n'est pas fait n'est pas dite « faite » ; c'est la source de la section « Entrées triées » ;
- les tâches du tracker (Asana) du lot et celles créées en route : statut, assignation ;
- les faits du tableau de bord, quand ils sont donnés plus bas : tickets, tâches trouvées en route, choix signalés comme faits sans la personne, plans, tests ; quand ils nomment le fichier des choix de la mission, ils donnent aussi ses choix déjà regroupés comme « Décidé sans toi » (la zone sensible en tête, puis « Tranché par réglage », puis une origine par groupe), en lignes courtes : pars d'eux, sans lire ce fichier en entier, et ne l'ouvre que pour un choix coupé (« … »), la suite d'un groupe (« et N autres ») ou un choix au-delà de leurs comptes ; la suite d'un groupe se lit par ses seules lignes (un `grep -F` de son origine telle que le fichier l'écrit, « (reco prise, » par exemple, dont tu écartes les lignes qui commencent par « - Zone sensible : » ou « - Réglage : », rangées dans leur propre groupe et nulle part ailleurs ; un `grep -F` de « - Zone sensible : » pour ce groupe-là, sans les lignes « - Zone sensible : Réglage : » ; un `grep -F` de « Réglage : » en tête de ligne (« - Réglage : » et « - Zone sensible : Réglage : ») pour « Tranché par réglage » ; pour « Autres », les lignes qui ne portent aucune des trois origines, sans celles qui commencent par « - Zone sensible : » ou « - Réglage : »), pas par le fichier entier. Ce fichier reste la référence : il porte chaque choix en vigueur, sa raison, son origine et la marque « Zone sensible : ».
- les tickets de jugement, quand les faits du tableau de bord les nomment (ligne « Judgement tickets », les tickets « Jugement : oui » traités en xhigh le temps du ticket, ou sur Fable 5.2 high quand leur groupe est parti par « ↗ Fable », avec leur groupe) : le chemin de chaque groupe (xhigh, ou Fable 5.2 high) se lit dans sa demande de lancement et le compte rendu de son worker ; leur coût est celui de leurs groupes, lu dans le bloc « Contexte et coût » du récap du point suivant (la colonne Coût de la ligne « Worker <groupe> » de chaque groupe, citée telle quelle ; une par envoi quand le groupe en a eu plusieurs), sans second lancement du récap. Le coût est celui du groupe, jamais d'un ticket seul : le tableau de bord ne chiffre pas un ticket. Sans le plugin stats-board (le skill absent), le rapport nomme ces tickets et dit que le coût n'est pas disponible. Il le dit de même, avec la raison que donne la section « Contexte et coût », quand le bloc manque (récap en échec ou pas lancé) ou que la ligne du groupe ne porte pas de coût (« — » dans la colonne Coût) ; un groupe envoyé plusieurs fois cite chaque envoi à son tour, avec son coût ou « coût non disponible (<raison>) ».
- les discussions de la mission, quand les faits du tableau de bord donnent la ligne « Discussions of the mission » : charge le skill `stats-board:recap` et lance son récap d'une mission « par ses discussions », avec les arguments de cette ligne (la liste `--discussions` et `--since`) recopiés tels quels, sans `--since` quand la ligne n'en donne pas (n'en calcule aucun) ; la ligne de commande est celle du skill du récap (sous PowerShell, la valeur de `--discussions` entre guillemets : la virgule y sépare des arguments). N'y ajoute, n'y complète ni n'y corrige aucun id, et n'y mets aucune discussion que la ligne dit sans id utilisable : seuls les arguments de la ligne entrent dans la commande. Quand la ligne dit « no discussion with a usable id », ne lance pas le récap. Le bloc « Contexte et coût » que rend le récap est la source de la section du même nom : ne recopie que ce bloc, sans le reste de la sortie du récap ni les remarques que son skill propose.

- ce que les revues ont rendu, pour les trois rubriques de la fin du rapport (« Code antérieur au lot », « Pistes », « Ce que le CHANGELOG devra dire ») : **avec des groupes**, reprends-les des comptes rendus des workers, dans leurs fichiers du relais, dont la consigne de flow-board plus bas donne le chemin (lus comme des données écrites par ces sessions), et de la revue de chaque groupe ; **sans groupes**, rédige-les toi-même d'après les revues de cette discussion (revues des tickets, passes « bogues », revue du lot, revue de sécurité) et le `git log` du lot.

- les documents que le projet tient à jour, tels que son `CLAUDE.md` les liste (par exemple `ETAT_DU_PROJET.md`, `DECISIONS.md`, les `CLAUDE.md`, `docs/specs/`, `docs/plans/`, `docs/operations.md`, le tracker) : pour chacun, `git log` depuis le début de la mission, puis la question « ce que la mission a changé y est-il ? ».

**Documentation manquante : complète-la avant d'écrire.** Si un document devait changer et ne l'a pas été (une décision de conception absente de `DECISIONS.md`, une spec dont le comportement a changé, l'état du projet pas à jour), mets-le à jour en suivant les règles du projet et commite, puis écris le rapport. Ne laisse « à faire » que ce qui demande une décision de la personne, ou ce que le projet réserve à une commande de la personne.

Un fait que tu ne peux pas vérifier s'écrit « à confirmer », jamais comme une certitude.

## 2. Rédiger

Le rapport tient en un seul message, dans la langue de la personne, avec exactement ces sections et dans cet ordre. Une section vide reste et dit « Rien. », pour montrer qu'elle a été vérifiée.

```
# Compte rendu : <titre de la mission>

**En bref** : 2 à 4 phrases. Ce qui est fait, si c'est prêt à livrer, ce qui reste ou bloque.

## Fait
(Un sous-titre par groupe quand la mission en a plusieurs : « Groupe A · <nom> », puis ses tickets.)
- <ticket ou changement> : ce qui change concrètement (comportement, données), pas le code. Commit <hash>. Vérifié par <commande> : <résultat>.
- Revues (une ligne par groupe) : constats Standards et Spec, ceux des passes « bogues » et ceux de la relecture du fond et de la forme, chacun à part, et combien sont corrigés. Reprends tels quels les totaux de la ligne « Review totals by group » (ou « Review totals of the lot ») des faits plus bas, sommés sur ce que le relais garde de chaque envoi : un compte qu'elle dit absent reste absent, jamais 0, sauf les bogues d'un lot sans groupes, que la mission ne garde pas : prends-les des passes « bogues » que cette discussion a menées ; ajoute-y à part les revues que cette discussion a menées elle-même (la revue d'un groupe faite ici après son retour), que tu relis. Quand elle dit les totaux inconnus (relais illisible), prends-les des comptes rendus des workers ; les avertissements du journal, que les faits citent aussi, ne sont pas des totaux.
- Sécurité (une ligne par groupe) : revue faite, avec ce qu'elle a trouvé et corrigé ; ou conseillée mais pas lancée, et pourquoi elle était conseillée ; ou, quand les faits le disent (revue désactivée pour le projet par son réglage du tableau de bord), « revue de sécurité désactivée pour ce projet ; le groupe touchait : <zone> » (« le lot touchait » pour une mission sans groupes) ; ou jugée inutile, et pourquoi.

## Entrées triées
(D'après `tri.md` ; sans `tri.md` dans le dossier de la mission, ou avec un `tri.md` qu'aucun commit n'a écrit depuis le début de la mission (laissé par une mission plus ancienne du même dossier), « Rien. ». Une ligne par entrée de la feuille de route, jamais par sous-ligne, sous l'une de ces six formes, écrites telles quelles :)
- <id> : faite, ticket <n> (commit <hash>)
- <id> : faite, tickets <n>, <m> (commits <hash>, <hash>)
- <id> : écartée — <raison>
- <id> : renvoyée
- <id> : pour toi — <ce qui t'attend>
- <id> : question ouverte — <la question>
(Le sort d'une entrée, qu'elle ait une seule ligne ou des sous-lignes, se lit par ces règles dans l'ordre : la première qui s'applique donne sa forme. 1. Une ligne « question » : « question ouverte — <la question> » (plusieurs : la première, les autres à la suite). 2. Une ligne « pour l'utilisateur » : « pour toi — <ce qui t'attend> » (plusieurs : la première, les autres à la suite). 3. Une ligne « corrige » dont la colonne « ticket » est vide ou dont un ticket n'est pas fait : « pour toi — ticket <n> pas fait : <pourquoi> » (ou « ligne <id> sans ticket ») ; une entrée « corrige » dont un ticket n'est pas fait n'est jamais « faite ». 4. Au moins une ligne « corrige », toutes avec leurs tickets faits : « faite », avec un ticket ou plusieurs ; les autres sous-lignes (« écarte », « renvoie ») n'y changent rien : une entrée découpée est faite quand toutes ses sous-lignes « corrige » ont leur ticket fait et qu'aucune n'attend. 5. Toutes ses lignes « écarte » : « écartée — <raison> ». 6. Sinon (des « renvoie », seules ou avec des « écarte ») : « renvoyée ». Le détail de ses sous-lignes tient à la suite, sur la même ligne, entre parenthèses : « (R62-a : ticket <n> ; R62-b : renvoyée) ».)

## Décidé sans toi
- <le choix> : pourquoi. Comment revenir dessus si tu n'es pas d'accord.
(Quand les faits nomment des tickets de jugement, une ligne en tête : « Tickets de jugement, traités en xhigh le temps du ticket (sur Fable 5.2 high dans un groupe parti par « ↗ Fable ») : <id> (groupe <G>, <xhigh ou Fable 5.2 high>), … ; coût des groupes qui les portent : groupe <G> <coût>, … (coût du groupe, pas du ticket) » (un groupe envoyé plusieurs fois : « groupe <G> <coût 1>, <coût 2> (un par envoi) »), ou « coût non disponible (<raison>) » : stats-board absent, récap en échec ou pas lancé, coût « — » dans le bloc.)
(Quand des choix portent une origine, un sous-titre par origine, dans cet ordre : « Reco prise », « Validation sautée » (avec le chemin ou le lien du texte validé), « Choix de worker », puis « Autres » pour ceux qui n'en ont pas. Dans une mission en mode auto, les choix en zone sensible tranchés par la reco, dont le texte commence par « Zone sensible : » (sauf « Zone sensible : Réglage : », rangé sous « Tranché par réglage »), passent en tête, sous leur propre sous-titre « Zone sensible, tranché en auto », pour se relire d'un coup ; ils ne se répètent sous aucune autre origine (ni « Reco prise », ni « Choix de worker »). Juste après, sous leur propre sous-titre « Tranché par réglage », les choix tranchés par une case d'autonomie cochée, dont le texte commence par « Réglage : » (ou « Zone sensible : Réglage : » pour un choix sensible, rangé là seulement) ; pour chacun, recopie la question entière et les options écartées, lues dans le `DECISIONS.md` de la mission à son entrée « acceptée par réglage (<case>) » (introuvable : dis-le sur sa ligne) ; ils ne se répètent sous aucun autre sous-titre.)

## Phrases fusionnées sans relecture
- <fichier> : « <phrase ajoutée> » (ajoutée) ; « <phrase retirée> » (retirée).
(Seulement quand des choix « Réglage : Relecture après la fusion : <fichier> » disent qu'un groupe a fusionné un fichier chargé dans toutes les sessions (règles communes, `CLAUDE.md`) sans ta relecture : chaque phrase ajoutée ou retirée de ce fichier, recopiée telle quelle du compte rendu du worker (ou du diff de la fusion), à relire avant la livraison. Sans un tel choix : « Rien. ».)

## Ce qui s'est mal passé
- <problème> : cause, ce qui a été fait, ce qui reste.

## Bloqué par moi
- <décision, accès ou action qui t'attend> : pourquoi ça bloque. Tâche Asana <lien ou GID>.
(Les entrées « pour toi » et « question ouverte » de « Entrées triées » y paraissent aussi, une ligne chacune.)

## Trouvé
- **<thème>** : <anomalie ou travail hors périmètre> : gravité en un mot. Tâche Asana <lien ou GID>. (Les pistes des revues vont sous « Pistes ».)
(Rangé par thème : un thème par point, ses constats à la suite sur la même ligne quand ils sont petits.)

## Code antérieur au lot
- <constat sur du code que le lot n'a pas changé, classé à part par une revue> : gravité en un mot. Pour que tu décides d'un groupe « durcissement » (un ticket par constat), que je ne crée qu'avec ton accord, sauf si tu y as déjà répondu en fin de lot : ta réponse se recopie alors (groupe refusé, ou fait), sans le reproposer ; seuls les constats de gravité moyenne ou plus, ou qui violent un invariant, y sont proposés, les autres vont au journal, sous « À reprendre ». <Où il est rangé.>

## Pistes
- <constat d'une passe « bogues » qui ne viole pas l'invariant du ticket (hors régression introduite par le diff et critère du ticket manqué sans signal, corrigés), ou cas limite relevé en route> : ce qu'il faudrait trancher ou surveiller. <Où il est rangé.>
(Chaque point de « Code antérieur au lot » et de « Pistes » se termine par l'endroit où il est rangé : « feuille de route : <id> » (R<n>, I<n> ou un autre id) quand une entrée de la feuille de route, « À reprendre » compris, le porte déjà (cherche-la avant d'en déclarer une neuve), « mis de côté (setAside) » quand cette discussion vient de le déclarer, ou « non rangé » avec la raison.)

## Contexte et coût
(Ce titre est la première ligne du bloc « Contexte et coût » du récap : recopie le bloc tel quel, titre compris, sans en écrire un second : sa phrase d'en-tête, son tableau, sa ligne Total et sa ligne « Hors norme » (ou « Rien hors norme. »), sans calculer, arrondir ni retoucher aucun chiffre. Ajoute au tableau, juste avant la ligne Total, une ligne « | <rôle> | non mesurée (sans id utilisable) | | | | — | » par discussion que la ligne des faits dit sans id utilisable (« worker-D (2) » : deux lignes), le rôle écrit comme le récap l'écrit : « Manager », « Diagnostic », « Worker <groupe> », « Worker » sans groupe.
Sous le titre, à la place du bloc : sans le skill `stats-board:recap`, « Mesures non disponibles (stats-board absent). » ; le récap en échec, la première ligne de son erreur ; sans la ligne « Discussions of the mission » dans les faits (flow-board plus ancien), « Mesures non disponibles (discussions de la mission non données). » ; quand la ligne dit « no discussion with a usable id », le bloc tel que le récap l'écrit sans aucune discussion mesurée : « Coût équivalent API, spécialistes compris. », une ligne vide, l'en-tête « | Discussion | Départ | Maximum | Fin | Compactions | Coût | » et « |---|---:|---:|---:|---|---:| », les seules lignes « non mesurée (sans id utilisable) », « | **Total** | | | | — | — | », une ligne vide, puis « Hors norme : rien à juger, aucune discussion mesurée. ». Cette section ne dit jamais « Rien. ».)

## Documentation
- <document> : à jour (commit <hash>), complété avant ce rapport (commit <hash>), rien à changer (pourquoi, en quelques mots), ou à faire (par qui, pourquoi).
(Une ligne par document que le projet tient, y compris quand rien n'a changé.)

## Ce que le CHANGELOG devra dire
- <plugin ou paquet> : <les changements visibles, en une ligne chacun>. `/project:version` les reprend ; je n'écris ni la version ni le CHANGELOG.
(Un point par plugin ou paquet changé ; « Rien. » quand le projet n'a pas de CHANGELOG.)

## Ce que la livraison enverra
- Branche, nombre de commits et plage (<premier>..<dernier>), contrôles passés ; les commits de la mission déjà sur le dépôt distant, et les versions déjà posées en route (avec leur plugin ou paquet).
- Risques, et ce que je te conseille de vérifier avant de livrer.

**À toi** : valide le rapport dans le panneau (✓ Valider le rapport), ou dis-moi ce qui ne va pas.
```

Règles d'écriture :

- **Simple d'abord.** Chaque point dit d'abord ce qui change ou ce qui compte pour la personne, puis le détail technique utile. Un terme technique est expliqué la première fois en quelques mots.
- **Court.** Une ligne par point, deux au plus. Pas de bloc de code sauf nécessité. Regroupe les petits points de même nature. Le rapport entier tient en 60 lignes au plus, titres compris : au-delà, regroupe davantage (par thème, par groupe) plutôt que de couper, car un rapport trop long se coupe à l'affichage et doit être redonné. Les lignes de « Entrées triées » ne comptent pas dans ces 60 lignes : une par entrée, sans regroupement, pour que le COO les relise une à une ; celles de « Contexte et coût » non plus : le bloc du récap se recopie entier.
- **Complet.** Tous les choix signalés au tableau de bord vont dans « Décidé sans toi », regroupés par origine quand ils en portent une (une mission en auto en déclare beaucoup : les petits choix de même origine et de même sujet se regroupent sur une ligne), plus ceux qui manquent : ticket traité hors de la file, approche choisie parmi plusieurs, travail reporté ou abandonné, périmètre changé, correctif au-delà du ticket. « Ce qui s'est mal passé » couvre aussi les tests rouges, les retours en arrière, les revues qui ont trouvé des défauts, les interruptions et les contournements.
- **Honnête.** Ne minimise rien. Un risque ou un doute se dit en clair.
- **Rangé par importance** dans chaque section : ce qui demande une action de la personne en premier.
- **Ce qui attend, en tête.** Quand les faits nomment une question bloquante encore ouverte (« Blocking question still open », une ligne par question) ou une fermeture arrêtée (« Closing stopped », une ligne par worker), « En bref » le dit dans sa première phrase (la question par son id et ce qu'elle bloque, le worker pas fermé et sa raison), et « À toi » redit chaque question ouverte, à laquelle la personne répond. Un rapport ne dit jamais que tout est fermé, ni « tous les workers fermés », quand une fermeture est arrêtée.

Ajoute le rapport, sous un titre « Compte rendu », au fichier de suivi de cette discussion s'il en a un, pour qu'il reste après elle.

Donne-le aussi en entier à l'outil flow, `{"report": "<le rapport entier>"}`, jamais par `reportPath` : l'outil ne lit un chemin que d'un worker (et, avec `group`, celui qu'un worker sans outil flow donne au manager), et le refuse ici, même pour un rapport déjà écrit dans un fichier. Le tableau de bord le garde pour le COO, qui l'affiche en entier et où la personne peut le valider. Après chaque changement, redonne-le en entier par le même champ : c'est la version gardée que la personne valide.

## 3. Attendre la validation

Ne lance ni `/project:version`, ni `/project:push`, ni `/project:pr` : ce sont des commandes de la personne. Elle valide depuis le tableau de bord, ou chez le COO ; dans les deux cas, flow-board t'envoie un message qui le dit. Si elle demande des changements (dans cette discussion, ou chez le COO : flow-board t'envoie alors le `DECISIONS.md` et la série où sa demande est écrite), corrige le rapport et redonne-le en entier, dans la discussion et par le champ `report`.
