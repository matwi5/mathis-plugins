---
name: compte-rendu
description: "Rapport du travail d'un parcours, à lire et valider par la personne avant toute livraison : ce qui est fait, décidé sans elle, mal passé, bloqué par elle, trouvé, documentation, et ce que le push enverra."
disable-model-invocation: true
---

Écris le compte rendu du travail mené depuis le début du parcours. La personne le lit puis le valide ou non depuis le tableau de bord, avant de lancer la livraison (`/project:version`, `/project:push`). Le rapport doit tout lui dire, rester facile à lire et court.

## 1. Rassembler les faits

Avant d'écrire, vérifie chaque fait au lieu de te fier à ta mémoire de la discussion :

- `git log` depuis le début du parcours (le tableau de bord en donne la date plus bas ; sinon, depuis le début du travail de la discussion) et `git status` : commits, fichiers non commités ;
- **tous** les fichiers de suivi du parcours (`travail/tasks/…`), pas seulement celui de cette discussion : un parcours en plusieurs groupes passe souvent par plusieurs discussions, et ce que les autres ont fait, trouvé ou décidé n'est plus que là, dans `git log`, dans le journal de `ETAT_DU_PROJET.md` et dans les commentaires des tickets ;
- les tâches du tracker (Asana) du lot et celles créées en route : statut, assignation ;
- les faits du tableau de bord, quand ils sont donnés plus bas : tickets, tâches trouvées en route, choix signalés comme faits sans la personne, plans, tests.

- les documents que le projet tient à jour, tels que son `CLAUDE.md` les liste (par exemple `ETAT_DU_PROJET.md`, `DECISIONS.md`, les `CLAUDE.md`, `docs/specs/`, `docs/plans/`, `docs/operations.md`, le tracker) : pour chacun, `git log` depuis le début du parcours, puis la question « ce que le parcours a changé y est-il ? ».

**Documentation manquante : complète-la avant d'écrire.** Si un document devait changer et ne l'a pas été (une décision de conception absente de `DECISIONS.md`, une spec dont le comportement a changé, l'état du projet pas à jour), mets-le à jour en suivant les règles du projet et commite, puis écris le rapport. Ne laisse « à faire » que ce qui demande une décision de la personne, ou ce que le projet réserve à une commande de la personne.

Un fait que tu ne peux pas vérifier s'écrit « à confirmer », jamais comme une certitude.

## 2. Rédiger

Le rapport tient en un seul message, dans la langue de la personne, avec exactement ces sections et dans cet ordre. Une section vide reste et dit « Rien. », pour montrer qu'elle a été vérifiée.

```
# Compte rendu : <titre du parcours>

**En bref** : 2 à 4 phrases. Ce qui est fait, si c'est prêt à livrer, ce qui reste ou bloque.

## Fait
(Un sous-titre par groupe quand le parcours en a plusieurs : « Groupe A · <nom> », puis ses tickets.)
- <ticket ou changement> : ce qui change concrètement (comportement, données), pas le code. Commit <hash>. Vérifié par <commande> : <résultat>.
- Sécurité (une ligne par groupe) : revue faite, avec ce qu'elle a trouvé et corrigé ; ou conseillée mais pas lancée, et pourquoi elle était conseillée ; ou jugée inutile, et pourquoi.

## Décidé sans toi
- <le choix> : pourquoi. Comment revenir dessus si tu n'es pas d'accord.

## Ce qui s'est mal passé
- <problème> : cause, ce qui a été fait, ce qui reste.

## Bloqué par moi
- <décision, accès ou action qui t'attend> : pourquoi ça bloque. Tâche Asana <lien ou GID>.

## Trouvé
- **<thème>** : <anomalie ou piste hors périmètre> : gravité en un mot. Tâche Asana <lien ou GID>.
(Rangé par thème : un thème par point, ses pistes à la suite sur la même ligne quand elles sont petites.)

## Documentation
- <document> : à jour (commit <hash>), complété avant ce rapport (commit <hash>), rien à changer (pourquoi, en quelques mots), ou à faire (par qui, pourquoi).
(Une ligne par document que le projet tient, y compris quand rien n'a changé.)

## Ce que la livraison enverra
- Branche, nombre de commits et plage (<premier>..<dernier>), contrôles passés.
- Risques, et ce que je te conseille de vérifier avant de livrer.

**À toi** : valide le rapport dans le panneau (✓ Valider le rapport), ou dis-moi ce qui ne va pas.
```

Règles d'écriture :

- **Simple d'abord.** Chaque point dit d'abord ce qui change ou ce qui compte pour la personne, puis le détail technique utile. Un terme technique est expliqué la première fois en quelques mots.
- **Court.** Une ligne par point, deux au plus. Pas de bloc de code sauf nécessité. Regroupe les petits points de même nature. Le rapport entier tient en 60 lignes au plus, titres compris : au-delà, regroupe davantage (par thème, par groupe) plutôt que de couper, car un rapport trop long se coupe à l'affichage et doit être redonné.
- **Complet.** Tous les choix signalés au tableau de bord vont dans « Décidé sans toi », plus ceux qui manquent : ticket traité hors de la file, approche choisie parmi plusieurs, travail reporté ou abandonné, périmètre changé, correctif au-delà du ticket. « Ce qui s'est mal passé » couvre aussi les tests rouges, les retours en arrière, les revues qui ont trouvé des défauts, les interruptions et les contournements.
- **Honnête.** Ne minimise rien. Un risque ou un doute se dit en clair.
- **Rangé par importance** dans chaque section : ce qui demande une action de la personne en premier.

Ajoute le rapport, sous un titre « Compte rendu », au fichier de suivi de cette discussion s'il en a un, pour qu'il reste après elle.

## 3. Attendre la validation

Ne lance ni `/project:version`, ni `/project:push`, ni `/project:pr` : ce sont des commandes de la personne. Elle valide depuis le tableau de bord. Si elle demande des changements, corrige le rapport et redonne-le en entier.
