# mathis-plugins

> **In English.** A Claude Code plugin marketplace and the working rules that go with it: cost-routed sub-agents (Haiku to map code, Sonnet to research docs, Opus to write and review), written guardrails (the agent never pushes, never prints a secret, never writes to Asana without approval), live panels and bands inside Claude Code (git, files, usage stats, Asana, ticket workflows), and an installer, `/setup:install`, that asks which plugins you want and wires them in. The docs and rules are in French.

Une marketplace de plugins Claude Code et les règles de travail qui vont avec : des sous-agents routés par coût, des garde-fous écrits, des panneaux et bandeaux dans l'interface de Claude Code, et un installateur qui demande quels plugins installer et les met en place.

## Installer

```bash
claude plugin marketplace add matwi5/mathis-plugins
claude plugin install setup@mathis-plugins
```

Puis, dans Claude Code : `/setup:install`. Il vérifie le poste (version de Claude Code, `git`, `gh`, Node.js, Python, connecteur Asana), demande les plugins voulus, ajoute leurs dépendances, montre un plan complet (commandes et diff de chaque fichier), et n'écrit rien avant votre accord. Détails : [`plugins/setup`](plugins/setup/README.md).

Les mods (panneaux et bandeaux) demandent Claude Code 2.1.286 ou plus récent, 2.1.289 pour `files-board`.

## Plugins

| Plugin | Rôle | Entrées | Version |
|---|---|---|---|
| [`setup`](plugins/setup/README.md) | Installateur : choix, dépendances, prérequis, réglages, règles | `/setup:install` | 0.2.0 |
| [`agents`](plugins/agents/README.md) | Sous-agents routés par coût : cartographie, recherche documentaire, implémentation | `agents:explorer`, `agents:researcher`, `agents:worker` | 1.0.1 |
| [`project`](plugins/project/README.md) | Convention de projet et commandes git que seul l'utilisateur lance | `/project:new`, `audit`, `commit`, `sync`, `push`, `pr`, `version` | 1.2.10 |
| [`mattpocock-skills`](plugins/mattpocock-skills/README.md) | Copie figée des skills de Matt Pocock (MIT) : grilling, spec, tickets, TDD, revue | `/mattpocock-skills:*` | 1.3.1 |
| [`flow-board`](plugins/flow-board/README.md) | Tableau de bord des parcours mattpocock-skills : phases, tickets, revues, et onglet Agents (orchestrateur, sessions liées, sous-agents en frise) | `/flow`, skill `compte-rendu` | 0.58.0 |
| [`asana-board`](plugins/asana-board/README.md) | Tâches Asana du projet en panneau et en bandeau, skill de suivi | `/asana`, skill `suivi-asana` | 0.7.2 |
| [`git-board`](plugins/git-board/README.md) | Panneau Git : branche, écarts, modifications, historique, PR, CI | `/git` | 0.4.5 |
| [`files-board`](plugins/files-board/README.md) | Navigateur de fichiers dans le terminal | `/files` | 0.3.3 |
| [`stats-board`](plugins/stats-board/README.md) | Statistiques d'usage, de coût et de durée de Claude Code, partagées entre postes si on le souhaite | `/ccstats`, `/stats-board:recap` | 0.10.0 |
| [`session-tools`](plugins/session-tools/README.md) | Pied du prompt (chrono de la requête, tokens/s, cache, heure) et boutons Réécrire, Effort auto, Fichiers, Diff | `/session-tools:start` | 0.22.0 |

## Sous-agents routés par coût

Chaque tâche déléguée part au modèle le moins cher qui la fait bien. Les modèles sont fixés dans l'en-tête de chaque agent ([`plugins/agents/agents/`](plugins/agents/agents)), et la règle qui dit quand déléguer et à qui est dans [`config/rules/agents.md`](config/rules/agents.md).

| Agent | Travail | Modèle | Effort |
|---|---|---|---|
| `agents:explorer` | Cartographier le code, en lecture seule ; plusieurs en parallèle, un par domaine | Haiku | high |
| `agents:researcher` | Chercher la documentation et répondre avec les sources | Sonnet | high |
| `agents:worker` | Faire une modification délimitée et la vérifier | Opus | medium |
| Revues de code et de sécurité | Dans un sous-agent dédié, petits diffs compris : modèle, effort, fichier de consignes et cible dans la section « Revues dans un sous-agent Opus, effort selon l'enjeu » de [`config/rules/agents.md`](config/rules/agents.md) | selon la règle | selon la règle |

Hors de l'explorateur, aucun sous-agent ne part sur Haiku. Une délégation doit valoir son coût : reconstituer le contexte et relire le rapport.

## Garde-fous écrits

Les règles sont dans [`config/rules/`](config/rules), un fichier par plugin, plus les règles générales. Là où un mécanisme de Claude Code peut les appuyer, il le fait :

| Garde-fou | Règle | Appui dans le code |
|---|---|---|
| L'agent ne pousse jamais | [`config/rules/project.md`](config/rules/project.md) : seul l'utilisateur lance `/project:push` ; seule exception, un correctif de CI | `disable-model-invocation: true` sur `/project:push`, `pr`, `sync`, `version`, `new`, `audit` ([exemple](plugins/project/skills/push/SKILL.md)) : Claude ne peut pas lancer ces skills lui-même |
| Un secret ne s'affiche jamais | [`config/rules/general.md`](config/rules/general.md) : ni demandé, ni affiché, chargé par substitution et contrôlé par sa longueur | [`plugins/project/reference/git.md`](plugins/project/reference/git.md) : fichiers ajoutés par chemin, `.env*` et clés jamais commités, aucun hook contourné |
| Accord avant toute écriture | [`config/rules/asana-board.md`](config/rules/asana-board.md) : la liste des changements est montrée avant d'écrire dans Asana | Le panneau Asana n'écrit que sur un clic et confirme une suppression ; `/setup:install` montre son plan avant toute écriture |

Une exception assumée : `stats-board` pousse lui-même ses relevés d'usage dans le dépôt de partage que l'utilisateur lui a donné (des données, pas du code).

## Ce qui se règle

| Quoi | Où | Comment |
|---|---|---|
| Plugins installés | `claude plugin` | `/setup:install`, relançable pour en ajouter ou en retirer |
| Règles importées | bloc entre `<!-- mathis-plugins:début -->` et `<!-- mathis-plugins:fin -->` du `CLAUDE.md` global ou du projet | `/setup:install` écrit des lignes `@~/.claude/plugins/marketplaces/mathis-plugins/config/rules/<plugin>.md` ; le `CLAUDE.md` d'un projet l'emporte sur elles |
| Projet Asana de suivi | bloc « Suivi Asana » du même `CLAUDE.md` | nom, GID, espace de travail, plan ; lu par le connecteur à l'installation |
| Partage des usages entre postes | `~/.claude/claude-usage` (votre dépôt git privé) et `.machine` | facultatif ; sans lui, `stats-board` montre ce poste seul |
| Barre d'état | `statusLine` de `~/.claude/settings.json` | `bash ~/.claude/plugins/marketplaces/mathis-plugins/config/statusline.sh` (Python 3) |
| Réglages d'exemple | [`config/settings.example.json`](config/settings.example.json) | modèles, effort par modèle, plugins, barre d'état : à recopier selon ses goûts |

## Arborescence

```
mathis-plugins/
├── .claude-plugin/marketplace.json   la marketplace : 10 plugins, version de chacun
├── plugins/<plugin>/                 un plugin : manifeste, skills, agents ou mod (hooks/), tests, README, CHANGELOG
├── config/
│   ├── rules/                        règles par plugin, à importer dans un CLAUDE.md
│   ├── CLAUDE.global.md              importe toutes les règles
│   ├── settings.example.json         réglages d'exemple
│   └── statusline.sh, statusline.py  barre d'état
├── CLAUDE.md                         consignes pour travailler dans ce dépôt
└── LICENSE                           MIT
```

## Développer

```bash
scripts/check.sh <plugin>
```

`scripts/check.sh` (`scripts\check.cmd` sous Windows) enchaîne les contrôles d'un plugin et s'arrête au premier échec : types par `npx` (sans installation de TypeScript), tests avec le Claude Code du terminal puis celui de l'app desktop, `claude plugin validate`. `git config core.hooksPath scripts/hooks` installe le hook pre-commit, qui lance `validate` et les tests des plugins touchés à chaque commit.

Les conventions (version à deux endroits, CHANGELOG, tests avec le Claude Code du terminal et celui de l'app desktop) sont dans [`CLAUDE.md`](CLAUDE.md).

## Crédits

- **[mattpocock-skills](https://github.com/mattpocock/skills)** de Matt Pocock, sous licence MIT, copié sans modification dans [`plugins/mattpocock-skills`](plugins/mattpocock-skills) avec sa licence ; la section Summary de son skill `pr` reprend le skill `show-me` de Dex Horthy ([crédits](plugins/mattpocock-skills/skills/engineering/pr/CREDITS.md)).
- **[ccusage](https://github.com/ccusage/ccusage)** de ryoppippi, sous licence MIT, lancé par `stats-board` (`npx ccusage`) pour relever l'usage ; il n'est pas redistribué ici.

## Licence

[MIT](LICENSE), sauf `plugins/mattpocock-skills`, sous sa propre licence MIT (Matt Pocock).
