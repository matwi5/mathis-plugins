---
name: compte-rendu
description: "Rapport du travail d'une mission, à lire et valider par la personne avant toute livraison : ce qui est fait, décidé sans elle, mal passé, bloqué par elle, trouvé, le code antérieur au lot, les pistes, la documentation, ce que le CHANGELOG devra dire, et ce que le push enverra."
disable-model-invocation: true
---

Écris le compte rendu du travail mené depuis le début de la mission. La personne le lit puis le valide ou non depuis le tableau de bord, avant de lancer la livraison (`/project:version`, `/project:push`). Le rapport doit tout lui dire, rester facile à lire et court.

## 1. Rassembler les faits

Avant d'écrire, vérifie chaque fait au lieu de te fier à ta mémoire de la discussion :

- `git log` depuis le début de la mission (le tableau de bord en donne la date plus bas ; sinon, depuis le début du travail de la discussion) et `git status` : commits, fichiers non commités ;
- les commits de la mission déjà sur le dépôt distant : `git fetch`, puis `git log --oneline origin/<branche>..HEAD` (ce qui reste à envoyer) face au `git log` de la mission ; ceux qui n'y sont pas sont déjà livrés, et le rapport le dit ;
- les versions posées depuis le début de la mission, par cette discussion ou une autre : `git log` depuis cette date du `CHANGELOG.md` et du fichier de version de chaque plugin ou paquet touché ; une entrée déjà publiée ne se redemande pas dans « Ce que le CHANGELOG devra dire », et « Ce que la livraison enverra » nomme la version qu'elle porte ;
- **tous** les fichiers de suivi de la mission, là où le `CLAUDE.md` du projet les range (par exemple `travail/<sujet>/` : spec, tickets, `DECISIONS.md` ; sinon `travail/tasks/…`), pas seulement celui de cette discussion : une mission en plusieurs groupes passe souvent par plusieurs discussions, et ce que les autres ont fait, trouvé ou décidé n'est plus que là, dans `git log`, dans le journal de `ETAT_DU_PROJET.md` et dans les commentaires des tickets ;
- les tâches du tracker (Asana) du lot et celles créées en route : statut, assignation ;
- les faits du tableau de bord, quand ils sont donnés plus bas : tickets, tâches trouvées en route, choix signalés comme faits sans la personne, plans, tests.

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
- Revues (une ligne par groupe) : constats Standards et Spec, ceux des passes « bogues » et ceux de la relecture du fond et de la forme, chacun à part (les revues envoyées par cette discussion, que tu relis, et les comptes rendus des workers les donnent ; les faits plus bas ne citent du journal que ses alertes), et combien sont corrigés.
- Sécurité (une ligne par groupe) : revue faite, avec ce qu'elle a trouvé et corrigé ; ou conseillée mais pas lancée, et pourquoi elle était conseillée ; ou, quand les faits le disent (revue désactivée pour le projet par son réglage du tableau de bord), « revue de sécurité désactivée pour ce projet ; le groupe touchait : <zone> » (« le lot touchait » pour une mission sans groupes) ; ou jugée inutile, et pourquoi.

## Décidé sans toi
- <le choix> : pourquoi. Comment revenir dessus si tu n'es pas d'accord.
(Quand des choix portent une origine, un sous-titre par origine, dans cet ordre : « Reco prise », « Validation sautée » (avec le chemin ou le lien du texte validé), « Choix de worker », puis « Autres » pour ceux qui n'en ont pas. Dans une mission en mode auto, les choix en zone sensible tranchés par la reco, dont le texte commence par « Zone sensible : », passent en tête, sous leur propre sous-titre « Zone sensible, tranché en auto », pour se relire d'un coup ; ils ne se répètent sous aucune autre origine (ni « Reco prise », ni « Choix de worker »).)

## Ce qui s'est mal passé
- <problème> : cause, ce qui a été fait, ce qui reste.

## Bloqué par moi
- <décision, accès ou action qui t'attend> : pourquoi ça bloque. Tâche Asana <lien ou GID>.

## Trouvé
- **<thème>** : <anomalie ou travail hors périmètre> : gravité en un mot. Tâche Asana <lien ou GID>. (Les pistes des revues vont sous « Pistes ».)
(Rangé par thème : un thème par point, ses constats à la suite sur la même ligne quand ils sont petits.)

## Code antérieur au lot
- <constat sur du code que le lot n'a pas changé, classé à part par une revue> : gravité en un mot. Pour que tu décides d'un groupe « durcissement » (un ticket par constat), que je ne crée qu'avec ton accord, sauf si tu y as déjà répondu en fin de lot : ta réponse se recopie alors (groupe refusé, ou fait), sans le reproposer ; seuls les constats de gravité moyenne ou plus, ou qui violent un invariant, y sont proposés, les autres vont au journal, sous « À reprendre ».

## Pistes
- <constat d'une passe « bogues » qui ne viole pas l'invariant du ticket (hors régression introduite par le diff, corrigée), ou cas limite relevé en route> : ce qu'il faudrait trancher ou surveiller.

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
- **Court.** Une ligne par point, deux au plus. Pas de bloc de code sauf nécessité. Regroupe les petits points de même nature. Le rapport entier tient en 60 lignes au plus, titres compris : au-delà, regroupe davantage (par thème, par groupe) plutôt que de couper, car un rapport trop long se coupe à l'affichage et doit être redonné.
- **Complet.** Tous les choix signalés au tableau de bord vont dans « Décidé sans toi », regroupés par origine quand ils en portent une (une mission en auto en déclare beaucoup : les petits choix de même origine et de même sujet se regroupent sur une ligne), plus ceux qui manquent : ticket traité hors de la file, approche choisie parmi plusieurs, travail reporté ou abandonné, périmètre changé, correctif au-delà du ticket. « Ce qui s'est mal passé » couvre aussi les tests rouges, les retours en arrière, les revues qui ont trouvé des défauts, les interruptions et les contournements.
- **Honnête.** Ne minimise rien. Un risque ou un doute se dit en clair.
- **Rangé par importance** dans chaque section : ce qui demande une action de la personne en premier.

Ajoute le rapport, sous un titre « Compte rendu », au fichier de suivi de cette discussion s'il en a un, pour qu'il reste après elle.

Donne-le aussi en entier à l'outil flow, `{"report": "<le rapport entier>"}` : le tableau de bord le garde pour le COO, qui l'affiche en entier et où la personne peut le valider. Après chaque changement, redonne-le en entier par le même champ : c'est la version gardée que la personne valide.

## 3. Attendre la validation

Ne lance ni `/project:version`, ni `/project:push`, ni `/project:pr` : ce sont des commandes de la personne. Elle valide depuis le tableau de bord, ou chez le COO ; dans les deux cas, flow-board t'envoie un message qui le dit. Si elle demande des changements (dans cette discussion, ou chez le COO : flow-board t'envoie alors le `DECISIONS.md` et la série où sa demande est écrite), corrige le rapport et redonne-le en entier, dans la discussion et par le champ `report`.
