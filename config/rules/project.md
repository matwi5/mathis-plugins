# Projets, commits et livraison (plugin `project`)

## Commits

Seulement dans un dépôt git ; pas besoin d'attendre une demande. Lancer `/project:commit`, ou git directement avec les règles git communes (`~/.claude/plugins/marketplaces/mathis-plugins/plugins/project/reference/git.md`). Message rédigé à partir du diff réel, au format fixé par le CLAUDE.md du projet, sinon comme les derniers messages de son `git log`. Ajouter les fichiers par chemin ; ne jamais ajouter de secrets (`.env*` sauf `.env.example`, clés, identifiants) ; ne jamais contourner un hook en échec par `--no-verify`.

## Claude ne pousse jamais

Les skills `/project:sync`, `/project:push`, `/project:pr`, `/project:version`, `/project:new` et `/project:audit` sont lancés par l'utilisateur seulement (ils portent `disable-model-invocation`). Claude ne pousse jamais : quand le travail est prêt, demander à l'utilisateur de lancer `/project:push`. Seule exception : un commit qui corrige un échec de CI se pousse directement sur la branche de travail, puis Claude le dit à l'utilisateur. Ce que chacun demande : rien pour `/project:new` et `/project:audit` ; un dépôt git pour `/project:commit` et `/project:version` (qui lit les commits depuis la dernière version) ; un dépôt distant pour `/project:push` et `/project:sync` ; GitHub pour `/project:pr`. Ne pas proposer une commande dont la condition manque. Jamais de question à boutons (`AskUserQuestion`) pour proposer `/project:push`, `/project:version`, `/project:pr`, `/project:sync` ou `/project:commit` : git-board les porte dans tous les projets, et flow-board en fin de parcours ; une ligne de texte suffit, et celle du compte rendu (« lance `/project:push` ») reste.

## Documentation

- **Quel document mettre à jour, et quand** — avant de créer ou de mettre à jour un document d'un projet (`CLAUDE.md`, `BRIEF.md`, `DECISIONS.md`, `ETAT_DU_PROJET.md`, `docs/`, plan de `travail/tasks/`) : lire `~/.claude/plugins/marketplaces/mathis-plugins/plugins/project/reference/documentation.md` (rôle de chaque fichier, moment de sa mise à jour, quand ne pas écrire).
- **Écrits par des skills** : `CHANGELOG.md` et les fichiers de version par `/project:version` (demander à l'utilisateur de le lancer). Les fichiers `CLAUDE.md` par `claude-md-management:revise-claude-md` ou `claude-md-management:claude-md-improver` ; une modification directe est permise quand l'utilisateur demande un changement précis, valide une proposition de `/mattpocock-skills:retro` (rétrospective qu'il lance, qui propose sans écrire), ou qu'un skill lancé par l'utilisateur, comme `/project:audit`, le demande.

## Protocole de session

**Au démarrage** d'une session : lire `~/.claude/plugins/marketplaces/mathis-plugins/plugins/project/reference/demarrage.md` et le suivre (état du projet, journal, travail restant).

## Compte rendu de fin d'exécution

**Fin d'une exécution longue** (plusieurs fichiers, ou plus de 30 minutes de travail) : terminer par le compte rendu décrit dans `~/.claude/plugins/marketplaces/mathis-plugins/plugins/project/reference/compte-rendu.md` (Résultat, À faire par toi, Décidé sans toi, Modifié, Trouvé).
