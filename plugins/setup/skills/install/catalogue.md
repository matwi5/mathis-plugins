# Catalogue des plugins de la marketplace `mathis-plugins`

Lu par `/setup:install`. Une ligne par plugin : ce qu'il apporte, ce qu'il exige, ce qu'il faut régler, et le fichier de règles à importer. Chemin des règles : `~/.claude/plugins/marketplaces/mathis-plugins/config/rules/`.

## Plugins

| Plugin | Apporte | Dépend de | Prérequis | Réglage à l'installation | Règles |
|---|---|---|---|---|---|
| `agents` | Sous-agents routés par coût : `agents:explorer` (Haiku, lecture seule), `agents:researcher` (Sonnet, documentation), `agents:worker` (Opus, implémentation) | — | — | — | `agents.md` |
| `project` | Convention de projet (`/project:new`, `/project:audit`) et commandes git (`commit`, `sync`, `push`, `pr`, `version`) que seul l'utilisateur lance | — | `git` ; `gh` pour `pr` et le suivi de CI ; Python 3.8+ pour `/project:audit` | — | `project.md` |
| `mattpocock-skills` | Copie figée des skills de Matt Pocock (grilling, spec, tickets, TDD, revue de code) | — | — | Doublon amont à couper (voir plus bas) | — |
| `flow-board` | Tableau de bord des parcours mattpocock-skills (`/flow`) | `mattpocock-skills` (obligatoire) ; `project` (conseillé : étapes de livraison) | Claude Code 2.1.286+ | — | `flow-board.md` |
| `asana-board` | Tâches Asana du projet en panneau et bandeau (`/asana`), skill `suivi-asana` | — | Claude Code 2.1.286+ ; connecteur Asana | Bloc « Suivi Asana » ; en mode auto, outils Asana dans `permissions.allow` | `asana-board.md` |
| `git-board` | Panneau Git (`/git`) : branche, écarts, modifications, historique, PR, CI | `project` (conseillé : ses boutons lancent `/project:*`) | Claude Code 2.1.286+ ; `git` ; `gh` facultatif | — | — |
| `files-board` | Navigateur de fichiers dans le terminal (`/files`) | — | Claude Code 2.1.289+ ; terminal (pas l'app de bureau) | `tui: fullscreen` conseillé | — |
| `stats-board` | Statistiques d'usage et de coût (`/ccstats`, `/stats-board:recap`) | — | Claude Code 2.1.286+ ; Node.js (`npx ccusage`) | Partage entre postes, facultatif : dépôt git privé de l'utilisateur et nom du poste | — |
| `session-tools` | Pied du prompt (chrono, tokens/s, cache, heure) et boutons Réécrire, Effort auto, Ultracode, Fichiers, Diff | `files-board` (conseillé : bouton Fichiers) | Claude Code 2.1.286+ | Modèle des boutons Réécrire et Effort auto (voir plus bas) | — |

Les règles générales (`general.md`) valent sans plugin : principes de travail, secrets, contrôles, style. Elles se proposent toujours.

## Doublon de mattpocock-skills

Claude Code accepte deux plugins `mattpocock-skills` venus de deux marketplaces, actifs ensemble : chaque skill apparaîtrait deux fois. Si `mattpocock-skills@mattpocock` ou `mattpocock-skills@claude-plugins-official` est installé, proposer `claude plugin disable <id>` (ou `claude plugin uninstall <id>`).

## Bloc « Suivi Asana »

Lu par le skill `asana-board:suivi-asana` dans le `CLAUDE.md` où il est écrit :

```markdown
## Suivi Asana

| Élément | Valeur |
|---|---|
| Projet de suivi | « <nom du projet> », GID `<gid>` |
| Espace de travail | GID `<gid>` |
| Plan | gratuit ou payant |
```

Outils du connecteur, à reconnaître par leur suffixe (le préfixe dépend du compte) : `get_me` (titulaire et espaces de travail), `get_projects` (projets d'un espace), `create_project` seulement si l'utilisateur le demande.

## Partage des usages (stats-board)

- Le dépôt est à l'utilisateur, privé, et existe déjà : le skill ne crée aucun dépôt.
- Clone : `git clone <url> ~/.claude/claude-usage` (avec `CLAUDE_CONFIG_DIR`, dans ce dossier à la place de `~/.claude`).
- Nom du poste : une ligne dans `~/.claude/claude-usage/.machine` ; `.machine` doit figurer dans le `.gitignore` de ce dépôt.
- L'accès sans invite se règle par `gh auth setup-git`.

## Modèle de session-tools (Réécrire et Effort auto)

Option `model` du plugin : `opus` (par défaut), `sonnet` ou `haiku`, toujours en effort low, la même pour les deux boutons. Estimations mesurées le 22 et le 24/10/2026 sur 7 brouillons réels, au tarif public, sans cache (un clic isolé) ; la qualité de Réécrire est notée à l'aveugle par des juges Opus.

| Modèle | Réécrire : qualité | Réécrire : temps médian (9 fois sur 10), coût | Effort auto : lisibilité, constance, accord avec Opus | Effort auto : temps médian, coût |
|---|---|---|---|---|
| `opus` (Recommandé) | 8,1/10 ; 7 inventions, aucune demande perdue | 6,7 s (11 s), 0,11 $ | 21 réponses lisibles sur 21 ; même niveau aux 3 essais pour 6 brouillons sur 7 ; référence | 2,1 s, 0,03 $ |
| `sonnet` | 7,2/10 ; 20 inventions, aucune perdue | 5,6 s (9 s), 0,05 $ | 21 sur 21 ; 7 sur 7 ; 18 sur 21 (plus bas qu'Opus sur une alerte de sécurité) | 1,8 s, 0,02 $ |
| `haiku` | 5,1/10 ; 41 inventions, 9 demandes perdues | 5,7 s (9 s), 0,003 $ | 18 sur 21 (répond parfois au brouillon au lieu de choisir) ; 4 sur 7 ; 16 sur 18 | 3,5 s, 0,001 $ |

« Inventions » : faits ou exigences ajoutés que le brouillon ne contient pas, relevés et cités par les juges ; des juges Opus peuvent avantager les textes d'Opus. Pour Effort auto, il n'y a pas de bonne réponse connue : Opus sert de référence, et la constance compte les brouillons qui reçoivent le même niveau aux 3 essais. Les coûts sont ceux du tarif public : sur un abonnement, c'est du quota consommé. Réglage, la version 0.20.0 ou plus installée : `printf '{"model": "<choix>"}' | claude plugin configure session-tools@mathis-plugins --values-stdin` ; lecture : `claude plugin configure session-tools@mathis-plugins --json`. L'utilisateur peut le changer ensuite dans `/config`.

## Barre d'état (facultative)

`statusLine` de `~/.claude/settings.json` : `{"type": "command", "command": "bash ~/.claude/plugins/marketplaces/mathis-plugins/config/statusline.sh"}`. Elle affiche dossier, modèle et effort, contexte, quotas 5 h et semaine ; il lui faut Python 3.
