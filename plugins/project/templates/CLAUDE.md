# {{PROJECT_NAME}}

{{ONE_LINER}} Le cadrage complet est dans `BRIEF.md`.

## Commandes

{{COMMANDS}}

## Conventions

{{CONVENTIONS}}

## Pièges connus

{{GOTCHAS}}

## Protocole de session

Au démarrage : lire dans `ETAT_DU_PROJET.md` la section « État » et les 5 premières entrées du « Journal » (les plus récentes ; le reste du journal se consulte par recherche), puis le travail restant dans Asana, seule liste des tâches du projet : projet « {{ASANA_PROJECT}} » (GID `{{ASANA_PROJECT_GID}}`), section « {{ASANA_SECTION}} » (GID `{{ASANA_SECTION_GID}}`), tâches de premier niveau et sous-tâches des tâches mères (la liste de la section ne renvoie pas les sous-tâches : lire chaque tâche mère). Le travail de Claude est sous la tâche mère non assignée « [code] {{ASANA_SECTION}} : prochaines sessions Claude Code » ; les tâches assignées au porteur sont les siennes ; chaque description commence par une ligne « Statut : » (à faire, en cours, en attente, à trancher, à confirmer, à proposer). Sans connecteur Asana, le dire au porteur et noter le découvert dans le journal de `ETAT_DU_PROJET.md`, sous « À reporter dans Asana », pour le reporter à la session suivante. Avant de proposer un changement de conception, vérifier dans `DECISIONS.md` qu'il n'a pas déjà été tranché. Les specs et références sont dans `docs/`.

En fin de session, dans la même session que les modifications : ajouter en tête du « Journal » de `ETAT_DU_PROJET.md` une entrée datée et réécrire sa section « État » ; mettre à jour Asana avec la skill `asana-board:suivi-asana` (cocher le fait, ajouter le découvert avec son détail chiffré, compléter les descriptions qui ont évolué et leur ligne « Statut : », assigner au porteur ce qui l'attend, reporter les éléments « À reporter dans Asana » du journal){{ASANA_DATA_RULE}} ; consigner toute décision de conception dans `DECISIONS.md` avec les alternatives écartées ; mettre à jour la spec concernée dans `docs/` si le comportement prévu a changé.{{EXTRA_END_RULES}} Ce qui n'est établi ni par les fichiers ni par le porteur s'écrit « à confirmer », jamais une supposition.

Chaque discussion qui lance une exécution longue a son propre fichier de suivi `travail/tasks/AAAA-MM-JJ_<sujet>.md` : objectif, critère de fin, cas où s'arrêter pour demander, puis trois parties (Fait, En cours, À faire). Il est créé au début et mis à jour à mesure du travail ; Asana reste la référence du travail restant du projet. En fin de discussion, le fait part dans le journal de `ETAT_DU_PROJET.md` et le reste à faire dans Asana ; le fichier reste dans `travail/tasks/` comme trace de la discussion.

À la fin de chaque exécution longue (plusieurs fichiers, ou plus de 30 minutes de travail), terminer par un compte rendu en chat en trois rubriques, en plus du journal :
- **Bloqué par moi** : décisions, accès ou actions qui attendent le porteur, chacune aussi présente dans Asana comme tâche assignée au porteur ;
- **Modifié** : fichiers et comportements changés, avec la vérification faite (commande et résultat) ;
- **Trouvé** : anomalies, « à confirmer » et pistes hors périmètre, ajoutées aussi dans Asana.
