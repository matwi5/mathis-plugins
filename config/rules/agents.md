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
- Revues de code et de sécurité : Opus, effort xhigh, toujours (voir plus bas).
- **`agents:explorer` coûte peu (Haiku) : ne pas hésiter à l'utiliser**, plus tôt que le seuil ci-dessus, et à en lancer plusieurs en parallèle (un seul message) dès que les questions sont indépendantes ; `agents:researcher` (Sonnet) aussi, dès qu'une question de documentation se pose. Le coût qui reste est la relecture de leurs rapports : leur demander des synthèses courtes. `agents:worker` reste sur Opus et suit le seuil ci-dessus.
- Hors de `agents:explorer`, ne jamais confier un sous-agent à Haiku, relecteurs compris : Sonnet au minimum, Opus quand la tâche le justifie.
- **Vagues de sous-agents** : une tâche qui demande beaucoup de sous-agents (lecture sur pièces, revue en tranches) les lance par vagues de taille bornée (8 au plus, en un seul message), suit l'avancement dans un fichier d'état (une ligne par mission : état, tentatives) plutôt que dans la conversation, valide chaque vague avant la suivante et relance par nom ce qui manque ; quota tombé : arrêter, noter, reprendre plus tard depuis le fichier. L'outil `Workflow` ne s'emploie qu'avec l'accord explicite de l'utilisateur, jamais par défaut.

## Revues dans un sous-agent Opus, effort xhigh

Toute revue de code (`/code-review`, `/mattpocock-skills:code-review`, passe « bogues », revue d'un groupe) et toute revue de sécurité tourne dans un sous-agent lancé par l'outil `Agent` avec `model: "opus"` et `effort: "xhigh"`, petits diffs compris ; jamais dans la discussion ni en exécution dérivée (fork) de la discussion, qui prendrait son modèle et son effort. Pour un skill de revue, le sous-agent lance lui-même le skill et rend son rapport ; les sous-agents que le skill lance à son tour (axes Standards et Spec de `/mattpocock-skills:code-review`) reçoivent eux aussi `model: "opus"` et `effort: "xhigh"`, passés explicitement : le skill n'en fixe aucun, et sans `effort` un sous-agent prend l'effort par défaut d'Opus du poste (`modelSettings`), qui n'est pas `xhigh` partout. Une revue qui applique ses correctifs (`/code-review --fix`, revue d'un groupe) les écrit dans ce même sous-agent, qui lance le skill avec `--fix` : c'est l'exception à toute consigne « sans sous-agents qui écrivent » (brief d'une session liée compris), puisqu'il tourne seul, une fois le travail commité ; la discussion relit ensuite le diff de ses correctifs, relance les contrôles et les commite. Une revue de sécurité est un relecteur en lecture seule limité au diff.
