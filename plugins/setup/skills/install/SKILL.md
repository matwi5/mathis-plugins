---
name: install
description: Installe et initialise les plugins de la marketplace mathis-plugins choisis par l'utilisateur - choix par groupes, dépendances et prérequis, installation, réglages (Asana, partage des usages, barre d'état) et bloc de règles dans le CLAUDE.md global ou du projet, montré avant écriture. Relançable pour ajouter ou retirer des plugins.
disable-model-invocation: true
allowed-tools: Bash(claude --version) Bash(claude plugin list *) Bash(claude plugin list) Bash(claude plugin marketplace list) Bash(git --version) Bash(gh --version) Bash(gh auth status) Bash(node --version) Bash(python3 --version) Bash(python --version) Read(/${CLAUDE_PLUGIN_ROOT}/**) Read(~/.claude/**)
---

# Installer les plugins mathis-plugins

Installe les plugins que l'utilisateur choisit, règle ce qui doit l'être et écrit leurs règles dans un `CLAUDE.md`. Lis d'abord `${CLAUDE_PLUGIN_ROOT}/skills/install/catalogue.md` : plugins, dépendances, prérequis, réglages et fichiers de règles.

Tiens une liste de tâches de Claude Code, une entrée par étape ci-dessous, à jour au fil du travail.

**Rien ne s'écrit avant l'étape 5** : ni installation, ni fichier, ni réglage. Toute écriture part d'un plan montré et accepté. Ne crée jamais de dépôt, de projet Asana ou de compte ; ne pousse rien.

## 1. État du poste

En lecture seule, une commande à la fois :

- `claude --version` : les mods demandent 2.1.286 ou plus, `files-board` 2.1.289.
- `claude plugin marketplace list` : la marketplace `mathis-plugins` doit être connue, sous ce nom. Les règles et la barre d'état sont lues dans `~/.claude/plugins/marketplaces/mathis-plugins/` ; sans elle, dis à l'utilisateur de lancer `claude plugin marketplace add matwi5/mathis-plugins` et arrête-toi.
- `claude plugin list` : plugins déjà installés, dont un éventuel `mattpocock-skills` d'une autre marketplace.
- `git --version`, `gh --version` puis `gh auth status`, `node --version`, `python3 --version` (`python --version` sous Windows) : un outil absent n'est pas une erreur, il écarte ou limite un plugin (voir le catalogue).
- Connecteur Asana : cherche (`ToolSearch`, « asana get_tasks ») des outils qui finissent par `__get_tasks` et `__update_tasks`.
- `~/.claude/CLAUDE.md` et, dans un projet, son `CLAUDE.md` : repère un bloc `<!-- mathis-plugins:début` déjà écrit (relance) et la mention « Géré par mathis-plugins (scripts/sync.py) » (poste synchronisé par le script de l'auteur : ne pas toucher à ce fichier).

## 2. Choix

Pose les questions par boutons (`AskUserQuestion`), en un ou deux appels, avec « (Recommandé) » sur l'option conseillée. Une relance part des plugins déjà installés et propose aussi d'en retirer.

1. **Socle** (choix multiple) : `agents`, `project`, « Parcours de tickets » (`mattpocock-skills` + `flow-board`).
2. **Panneaux et bandeaux** (choix multiple) : `git-board`, `files-board`, `stats-board`, `session-tools`. Grise dans la description ceux dont la version de Claude Code ou un outil manque.
3. **Suivi Asana** : `asana-board` oui ou non ; sans connecteur, dis ce qu'il faudra faire (`claude mcp add --transport http asana https://mcp.asana.com/v2/mcp`, puis `/mcp`).
4. **Règles** : les générales et celles des plugins choisis (Recommandé), celles des plugins seulement, ou aucune ; et où les écrire : `~/.claude/CLAUDE.md` (tous les projets, Recommandé) ou le `CLAUDE.md` du projet courant.

Ajoute les dépendances obligatoires du catalogue et propose les conseillées.

## 3. Réglages des plugins choisis

Seulement pour les plugins retenus :

- **asana-board** : lis le titulaire et ses espaces de travail (`get_me`), puis les projets de l'espace (`get_projects`). Demande lequel sert de projet de suivi (une section par projet) et si le compte est au plan gratuit. Sans projet adapté, dis-le : l'utilisateur le crée lui-même dans Asana, puis relance. En mode automatique, propose d'ajouter les outils Asana du mod (`get_me`, `get_tasks`, `get_task`, `update_tasks`, `create_tasks`, `add_comment`, `delete_task`, avec le préfixe du connecteur) à `permissions.allow` de `~/.claude/settings.json`.
- **stats-board** : demande si l'utilisateur veut partager ses usages entre plusieurs postes. Si oui : l'URL de son dépôt git privé (il le crée lui-même) et le nom de ce poste.
- **files-board** : propose `"tui": "fullscreen"` dans `~/.claude/settings.json`.
- **Barre d'état** : propose-la (catalogue), sauf si `statusLine` est déjà réglé : montre alors l'actuel et demande s'il faut le remplacer.

## 4. Plan

Montre en une fois, puis demande l'accord par boutons (« Tout faire », « Choisir », « Rien ») :

- les commandes : `claude plugin install <plugin>@mathis-plugins` pour chaque plugin, `claude plugin disable <id>` pour un doublon de `mattpocock-skills`, `git clone …` pour le partage des usages ;
- chaque fichier touché et son diff : le bloc du `CLAUDE.md`, les clés de `~/.claude/settings.json`, `.machine` et `.gitignore` du dépôt d'usages.

Le bloc du `CLAUDE.md`, entre ses marqueurs, remplace l'ancien s'il existe, sinon s'ajoute à la fin :

```markdown
<!-- mathis-plugins:début (écrit par /setup:install ; le relancer pour changer) -->
@~/.claude/plugins/marketplaces/mathis-plugins/config/rules/general.md
@~/.claude/plugins/marketplaces/mathis-plugins/config/rules/<plugin>.md

## Suivi Asana

| Élément | Valeur |
|---|---|
| Projet de suivi | « <nom> », GID `<gid>` |
| Espace de travail | GID `<gid>` |
| Plan | gratuit |
<!-- mathis-plugins:fin -->
```

Une ligne d'import par fichier de règles retenu ; la section « Suivi Asana » seulement avec `asana-board`. Dans le `CLAUDE.md` d'un projet, préviens que Claude Code demandera d'autoriser ces imports extérieurs au premier lancement.

## 5. Exécuter

Exactement le plan accepté, rien de plus, une commande à la fin de l'autre. Lis le résultat de chacune ; un échec s'arrête là, se dit avec sa sortie, et ce qui en dépend n'est pas fait. Dans `settings.json`, modifie seulement les clés du plan et garde le reste du fichier tel quel ; sauvegarde-le d'abord à côté (`settings.json.bak-setup-<date>`).

Pour le partage des usages : `git clone <url> ~/.claude/claude-usage`, puis le nom du poste dans `.machine`, et `.machine` ajouté au `.gitignore` du dépôt s'il n'y est pas (commit local seulement ; l'utilisateur pousse).

## 6. Vérifier et conclure

- `claude plugin list` : chaque plugin choisi est installé et activé, le doublon éventuel est coupé.
- Relis les fichiers écrits.

Termine par : ce qui est installé et réglé, ce qui reste à faire par l'utilisateur (redémarrer Claude Code pour charger les mods, autoriser les imports d'un `CLAUDE.md` de projet, brancher le connecteur Asana, pousser le `.gitignore` du dépôt d'usages), et les commandes pour commencer (`/flow`, `/asana`, `/git`, `/files`, `/ccstats`, `/session-tools:start`, `/project:new`).
