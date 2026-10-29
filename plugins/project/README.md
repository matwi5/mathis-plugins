# project

Convention de projet et commandes git génériques, utilisables sur n'importe quel dépôt.

## Installation

Le plugin est distribué par la marketplace `mathis-plugins`. Pour installer un poste, voir le README à la racine du dépôt.

```bash
claude plugin install project@mathis-plugins
```

## Commandes

| Commande | Rôle |
|---|---|
| `/project:new [description]` | Initialise un projet : court entretien, puis `CLAUDE.md` (avec le protocole de session), `BRIEF.md`, `DECISIONS.md`, `ETAT_DU_PROJET.md`, `docs/`, `travail/tasks/` |
| `/project:audit [report]` | Audite un projet existant par rapport à la convention et aux recommandations actuelles (dont `/claude-api prompt-audit` sur les fichiers d'instructions), propose un plan de migration et l'applique après accord, puis vous fait lancer `/doctor`. `report` : rapport seul |
| `/project:commit [indice]` | Commit Conventional Commits rédigé à partir du diff, fichiers indexés un par un, secrets exclus |
| `/project:sync [base]` | Met la branche à jour avec son remote (rebase + autostash), ou avec la branche par défaut avec `base` |
| `/project:push` | Commit du reste, vérifications du projet, mise à jour du journal et des décisions, synchronisation, push sans force, puis suivi de la CI du commit envoyé (par son identifiant complet) |
| `/project:pr [base] [--draft] [--auto]` | Ouvre la pull request vers la branche par défaut ou `base`, avec le modèle de PR du dépôt ou celui du plugin (section publique pour les notes de version + détails internes) ; auto-merge seulement avec `--auto`, si le dépôt l'autorise et avec sa méthode de fusion (sinon la PR reste ouverte et Claude dit quoi faire) |
| `/project:version [patch\|minor\|major\|ota]` | Montée de version SemVer sur tous les fichiers de version détectés, partie par partie dans un dépôt qui en a plusieurs (plugins d'une marketplace, paquets) ; un plugin Claude Code change ensemble son `.claude-plugin/plugin.json` et son entrée de `.claude-plugin/marketplace.json` ; se sert du script de version que nomme le `CLAUDE.md` du projet ; gère le choix natif ou OTA des apps Expo |

Toutes les commandes se lancent à la main (`disable-model-invocation`), car elles écrivent des fichiers ou agissent sur git, sauf `/project:commit`, que Claude peut aussi lancer de lui-même : un commit local se défait, le push reste au porteur.

`/project:push`, `/project:audit`, `/project:new` et `/project:version` commencent par une liste de tâches de Claude Code, une entrée par étape du skill, tenue à jour au fil du travail : le déroulé s'affiche toujours de la même façon, dans le terminal comme dans l'app desktop.

## Convention

Décrite dans [`reference/conventions.md`](reference/conventions.md) : structure, rôle de chaque fichier, choix du mécanisme (`CLAUDE.md`, règles, skills, hooks), règles de rédaction des fichiers d'instructions (appliquées avec `/claude-api prompt-audit` et `/doctor`), recommandations Claude Code et Opus 5.5, migration des anciennes structures. Les tâches du projet vivent dans Asana (le projet de suivi de l'utilisateur) ; il n'y a pas de `TODO.md`.

## Contenu

```
project/
├── .claude-plugin/plugin.json
├── reference/        # conventions.md (la convention), git.md (règles git partagées) ; documentation.md, demarrage.md, compte-rendu.md (lus à partir du CLAUDE.md commun)
├── templates/        # modèles des fichiers générés
├── scripts/audit.py  # contrôles mécaniques, Python standard, lecture seule
└── skills/           # new, audit, commit, sync, push, pr, version
```

`scripts/audit.py` demande Python 3.8 ou plus récent. Sans Python, `/project:new` et `/project:audit` font les mêmes contrôles avec les outils de lecture de Claude Code.
