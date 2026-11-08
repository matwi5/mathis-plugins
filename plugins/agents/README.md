# agents

Les deux spécialistes que le `CLAUDE.md` global fait utiliser à Claude. Un agent fourni par un plugin porte le nom du plugin en préfixe : on les appelle `agents:explorer` et `agents:researcher` (paramètre `subagent_type` de l'outil `Agent`, ou `@agent-agents:explorer` dans le prompt).

| Agent | Rôle | Modèle | Effort | Outils |
|---|---|---|---|---|
| `agents:explorer` | Cartographier le code ou les fichiers d'un projet, en lecture seule, et en rendre une synthèse courte | Haiku | high | Read, Grep, Glob, Bash |
| `agents:researcher` | Chercher la documentation (web, docs officielles, fichiers de référence) et répondre avec les sources | Sonnet | high | Read, Grep, Glob, WebFetch, WebSearch |

Ni `agents:explorer` ni `agents:researcher` n'appellent l'advisor : un explorateur Haiku l'avait appelé alors que `tools:` ne le listait pas, et l'avis du modèle Fable avait coûté 15 fois son propre travail ; aucun spécialiste ne le consulte, puisque la discussion qui le lance relit son rapport (règle « Consulter l'advisor »). Leur en-tête le retire (`disallowedTools: advisor`, sans effet documenté sur un outil serveur, à confirmer) et leur consigne le leur interdit.

`agents:explorer` démarre aussi sans les fichiers `CLAUDE.md` (règles communes, `CLAUDE.md` du projet, mémoire) : son en-tête porte `omitClaudeMd: true` (Claude Code 2.1.271 ou plus récent), et son texte recopie les quatre règles qui lui servent : répondre en français, ne jamais afficher un secret, pas de `cd` dans un sous-dossier, et une commande simple par appel, sans `|`, `&&` ni `;`, un glob entre guillemets (dans un worktree, le garde-fou refuse une commande composée où paraît le mot git, et zsh refuse un glob sans guillemets : chaque refus coûtait un tour). Mesuré le 06/11/2026 sur trois explorations de la même question dans ce dépôt, sa première requête passe de 36 795 à 6 229 tokens, et aucun `CLAUDE.md` n'arrive plus dans son transcript. Sa consigne de lecture seule, en tête de son texte, lui interdit aussi toute redirection de sortie vers un fichier (`>`, `>>`, `tee`), seul `2>/dev/null` restant permis pour taire les erreurs : la sortie de chaque commande lui revient dans le résultat de l'outil (un explorateur, pourtant en lecture seule, avait écrit dans `/tmp/none`).

Installation (marketplace `mathis-plugins`, voir le README à la racine du dépôt) :

```bash
claude plugin install agents@mathis-plugins
```

Le modèle et l'effort se surchargent à l'appel par les paramètres `model` et `effort` de l'outil `Agent` (règles du plugin, `config/rules/agents.md`).

## Limites d'un agent de plugin

D'après la documentation de Claude Code (`plugins/components`, « Frontmatter fields in plugin agents ») :

- champs pris en charge : `name`, `description`, `model`, `effort`, `tools`, `disallowedTools`, `skills`, `memory`, `maxTurns`, `background`, `isolation`, `color` ;
- champs ignorés pour des raisons de sécurité : `hooks`, `mcpServers`, `permissionMode`.

Un agent du même nom dans `~/.claude/agents/` ne le remplace pas : les noms diffèrent (`explorer` contre `agents:explorer`) et les deux coexistent. Ne pas en recréer dans `~/.claude/agents/`.

## Modifier un agent

Éditer `agents/<nom>.md`, monter `version` dans `.claude-plugin/plugin.json` et dans l'entrée `agents` de `.claude-plugin/marketplace.json` à la racine du dépôt, puis suivre le protocole du README du dépôt.
