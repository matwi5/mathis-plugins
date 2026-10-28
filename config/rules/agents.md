# Sous-agents routés par coût (plugin `agents`)

Chaque tâche déléguée va au modèle le moins cher qui la fait bien : Haiku pour lire et cartographier, Sonnet pour chercher de la documentation, Opus pour écrire du code et relire. Les modèles par défaut sont fixés dans l'en-tête des agents (`plugins/agents/agents/*.md`).

## Explorer avant de lire soi-même

Une exploration de documentation ou de code sur plusieurs fichiers ou plusieurs domaines passe par l'agent `agents:explorer` (lecture seule). **Exception** : les recherches rapides et ciblées (un fichier, un grep, un chemin connu) se font directement avec Glob, Grep ou Read.

- Pour un bug : demander à l'agent de lire d'abord la documentation concernée, puis le code.
- **Agents `agents:explorer` en parallèle dès que l'exploration touche plusieurs domaines** (ils tournent sur Haiku, peu coûteux), découpés par **domaine ou fonctionnalité** (par exemple un pour l'authentification, un pour la facturation), jamais par couche (un pour la documentation, un pour le code).

## Déléguer quand le gain dépasse le coût

Un sous-agent doit reconstituer le contexte, puis il faut relire son rapport : déléguer (outil `Agent`) seulement quand (a) le travail noierait le contexte principal (lecture de nombreux fichiers, analyse sur plusieurs fichiers, revue de code de plus de 500 lignes, enquête de débogage, relecture de plan) ou (b) deux tâches conséquentes et indépendantes ou plus peuvent tourner en parallèle (un seul message, plusieurs appels `Agent`). Garder le travail dans la boucle principale quand la cible est déjà connue, quand quelques lectures ou modifications suffisent, ou quand il faut itérer avec l'utilisateur en cours de tâche.

Spécialistes : `agents:explorer` pour cartographier le code, `agents:researcher` pour chercher de la documentation, `agents:worker` pour une implémentation délimitée, et `general-purpose` pour un débogage méthodique ou une recherche ouverte. Une question de documentation (Claude Code, une API, un outil) passe par un seul agent `agents:researcher` ou `claude-code-guide`, jamais par un workflow multi-agents.

Modèle et effort de chaque spécialiste (réglés dans son fichier, surchargés à l'appel par les paramètres `model` et `effort` de l'outil `Agent` dans les cas de montée en gamme) :

- `agents:worker` : Opus, effort medium ; effort high pour un bug difficile ou des tests qui échouent.
- `agents:explorer` : Haiku, effort high ; Sonnet, effort high quand il a manqué des liens entre modules.
- `agents:researcher` : Sonnet, effort high.
- Revues de code et de sécurité : Opus, effort high ou xhigh selon l'enjeu, toujours explicite (voir plus bas).
- **`agents:explorer` et `agents:researcher` suivent le seuil ci-dessus, comme `agents:worker`** : leur faible coût (Haiku, Sonnet) ne suffit pas à justifier une délégation, car chaque passage de relais perd du détail et leur rapport reste à relire. Une fois le seuil atteint, en lancer plusieurs en parallèle (un seul message) dès que les questions sont indépendantes, et leur demander des synthèses courtes.
- Hors de `agents:explorer`, ne jamais confier un sous-agent à Haiku, relecteurs compris : Sonnet au minimum, Opus quand la tâche le justifie.
- **Vagues de sous-agents** : une tâche qui demande beaucoup de sous-agents (lecture sur pièces, revue en tranches) les lance par vagues de taille bornée (8 au plus, en un seul message), suit l'avancement dans un fichier d'état (une ligne par mission : état, tentatives) plutôt que dans la conversation, valide chaque vague avant la suivante et relance par nom ce qui manque ; quota tombé : arrêter, noter, reprendre plus tard depuis le fichier. L'outil `Workflow` ne s'emploie qu'avec l'accord explicite de l'utilisateur, jamais par défaut.

## Revues dans un sous-agent Opus, effort selon l'enjeu

Toute revue de code (`/code-review`, `/mattpocock-skills:code-review`, passe « bogues », revue d'un groupe) et toute revue de sécurité tourne sur Opus, avec un effort fixé explicitement selon le coût d'un défaut manqué : `high` par défaut, `xhigh` pour la passe « bogues » d'un ticket qui supprime des données ou touche la concurrence, `high` ou `xhigh` pour la revue de sécurité selon l'enjeu et la taille. Le niveau de `/code-review` se passe toujours en argument. Un relecteur n'écrit jamais dans l'arbre de travail, sauf une revue `--fix` lancée par la session elle-même.

**Avant de lancer, configurer ou relire une revue**, lire le détail : `~/.claude/plugins/marketplaces/mathis-plugins/config/reference/revues.md` (dans le dépôt `mathis-plugins` : `config/reference/revues.md`) — tableau des efforts, niveau de `/code-review`, modèle et effort d'un relecteur, consignes par un fichier, cible, zone sensible, écritures, sécurité.
