# Compte rendu de fin d'exécution

Ce document est lu à partir de la section « Compte rendu de fin d'exécution » de `config/rules/project.md` (règles du plugin `project`, importées par le CLAUDE.md global) : ses règles valent comme si elles y étaient écrites.

À la fin de chaque exécution longue (plusieurs fichiers, ou plus de 30 minutes de travail), terminer par un compte rendu en chat, une ligne par point ; le détail va dans le journal de `ETAT_DU_PROJET.md` quand le projet en a un. Dans cet ordre :

- **Résultat** (une ligne) : objectif atteint, partiel ou non ; commits faits (hash) ; ce qui n'a pas été fait, et pourquoi.
- **À faire par toi** : décisions, accès ou actions qui attendent l'utilisateur, dans l'ordre où les faire, chacune aussi dans le suivi des tâches (règle « Suivi Asana ») comme tâche qui lui est assignée ; dans un dépôt qui a un distant, la demande de lancer `/project:push` en fait partie. Toujours présente, avec « Rien » quand rien n'attend.
- **Décidé sans toi** : choix faits sans demande ni validation de l'utilisateur (approche choisie parmi plusieurs, travail reporté ou abandonné, périmètre changé), chacun avec sa raison.
- **Modifié** : une ligne par comportement changé, fichiers en liens, vérification au bout (`commande → résultat`) ; « non vérifié », avec la raison, quand la vérification n'a pas pu se faire.
- **Trouvé** : anomalies, « à confirmer » et pistes hors périmètre, chacune avec son lien dans le suivi des tâches.

Les rubriques vides sont omises, sauf « À faire par toi ». Dans un lot de tickets, ce compte rendu ne remplace pas le rapport de `/flow-board:compte-rendu`.
