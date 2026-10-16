# agents

Les trois sous-agents que le `CLAUDE.md` global fait utiliser à Claude. Un agent fourni par un plugin porte le nom du plugin en préfixe : on les appelle `agents:explorer`, `agents:researcher` et `agents:worker` (paramètre `subagent_type` de l'outil `Agent`, ou `@agent-agents:explorer` dans le prompt).

| Agent | Rôle | Modèle | Effort | Outils |
|---|---|---|---|---|
| `agents:explorer` | Cartographier le code ou les fichiers d'un projet, en lecture seule, et en rendre une synthèse courte | Haiku | high | Read, Grep, Glob, Bash |
| `agents:researcher` | Chercher la documentation (web, docs officielles, fichiers de référence) et répondre avec les sources | Sonnet | high | Read, Grep, Glob, WebFetch, WebSearch |
| `agents:worker` | Exécuter une modification délimitée puis la vérifier par les tests ou contrôles du projet | Opus | medium | tous (hérités) |

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
