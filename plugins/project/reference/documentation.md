# Documentation d'un projet : quel fichier, mis à jour quand

Ce document est lu à partir de la section « Documentation » de `config/rules/project.md` (règles du plugin `project`, importées par le CLAUDE.md global) : ses règles valent comme si elles y étaient écrites. Le `CLAUDE.md` d'un projet l'emporte là où il fixe sa propre convention.

> La documentation est ce qui transmet le contexte d'une session à l'autre. Les projets suivent la convention du plugin `project` (`conventions.md`, dans ce même dossier) ; les projets anciens sont migrés par `/project:audit`. Un projet n'utilise que les fichiers qu'il a.

| Fichier | Rôle | Mis à jour quand |
|------|---------|--------------|
| `CLAUDE.md` (racine et sous-dossiers) | Commandes, conventions, pièges connus, protocole de session | Un piège non évident est trouvé ou une règle est posée : écrire la règle et sa raison, pas l'incident |
| `BRIEF.md` | Objectif, utilisateurs, périmètre, contraintes, critères de réussite | L'utilisateur redéfinit l'un d'eux |
| `DECISIONS.md` | Une entrée par décision de conception : contexte, décision, alternatives écartées, conséquences | Une décision au raisonnement non trivial est prise ; une décision remplacée reçoit le statut « remplacée par <date> », jamais effacée |
| `ETAT_DU_PROJET.md` | « État » et « Journal » daté, le plus récent en premier | À la fin de chaque session qui a changé le projet |
| `docs/specs/` | Spécifications des fonctionnalités, écrites avant l'implémentation | Une fonctionnalité démarre ou son comportement attendu change |
| `docs/references/` | Références des API tierces | Une intégration d'API externe change |
| `docs/operations.md` | État opérationnel que le code ne porte pas | Cet état change |
| `travail/tasks/AAAA-MM-JJ_<sujet>.md` | **Plan de travail, facultatif** : pour un travail assez gros pour que Claude s'y perde (une grosse tâche ou plusieurs tickets), un fichier par sujet. En tête : les tickets couverts (id Asana), l'objectif, le critère de fin, les cas où s'arrêter pour demander, les faits vérifiés (règle « Vérifier avant d'écrire ») et les étapes. Ensuite le suivi : Fait, En cours, À faire, décisions prises en route, travail à moitié fait. Il ne recopie pas l'état des tickets ; il reste comme trace et se relit d'une discussion à l'autre | Avant l'exécution, puis à mesure de l'avancement ; en fin de discussion, l'essentiel part dans le journal de `ETAT_DU_PROJET.md` |
| Asana, projet de suivi | Tickets : les vraies tâches à faire, en cours ou faites | Voir la règle « Suivi Asana » |

- `/project:push` revérifie ces documents contre le diff non poussé et corrige les écarts ; c'est le filet de sécurité, pas l'endroit où le travail se fait.
- **Quand ne pas écrire** : pas d'entrée dans `DECISIONS.md` pour un choix contraint (une seule option viable) ; pas de piège dans CLAUDE.md pour une faute de frappe, une erreur de lint ou un incident isolé, ni quand une ligne existante le couvre déjà.
