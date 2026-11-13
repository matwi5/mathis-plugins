# Spécialistes routés par coût (plugin `agents`)

Chaque tâche déléguée va au modèle le moins cher qui la fait bien : Haiku pour lire et cartographier, Sonnet pour chercher de la documentation, Opus pour écrire du code et relire. Les modèles par défaut de `agents:explorer` et `agents:researcher` sont fixés dans leur en-tête (`plugins/agents/agents/*.md`) ; un agent sans en-tête, comme `general-purpose`, reçoit les siens à l'appel.

## Explorer avant de lire soi-même

Une exploration de documentation ou de code sur plusieurs fichiers ou plusieurs domaines passe par l'agent `agents:explorer` (lecture seule). **Exception** : les recherches rapides et ciblées (un fichier, un grep, un chemin connu) se font directement avec Glob, Grep ou Read.

- Pour un bug : demander à l'agent de lire d'abord la documentation concernée, puis le code.
- **Agents `agents:explorer` en parallèle dès que l'exploration touche plusieurs domaines** (ils tournent sur Haiku, peu coûteux), découpés par **domaine ou fonctionnalité** (par exemple un pour l'authentification, un pour la facturation), jamais par couche (un pour la documentation, un pour le code).

## Déléguer quand le gain dépasse le coût

Un spécialiste doit reconstituer le contexte, puis il faut relire son rapport : déléguer (outil `Agent`) seulement quand (a) le travail noierait le contexte principal (lecture de nombreux fichiers, analyse sur plusieurs fichiers, revue de code de plus de 500 lignes, enquête de débogage, relecture de plan) ou (b) deux tâches conséquentes et indépendantes ou plus peuvent tourner en parallèle (un seul message, plusieurs appels `Agent`). Garder le travail dans la boucle principale quand la cible est déjà connue, quand quelques lectures ou modifications suffisent, ou quand il faut itérer avec l'utilisateur en cours de tâche.

Spécialistes : `agents:explorer` pour cartographier le code, `agents:researcher` pour chercher de la documentation, et `general-purpose` pour une implémentation délimitée, un débogage méthodique ou une recherche ouverte. Une question de documentation (Claude Code, une API, un outil) passe par un seul agent, `agents:researcher` ou `claude-code-guide` avec `model: "sonnet"` passé à l'appel (sans lui, il tourne sur Haiku), jamais par un workflow multi-agents.

Modèle et effort de chaque spécialiste (réglés dans son fichier quand il en a un, sinon passés à l'appel ; surchargés à l'appel par les paramètres `model` et `effort` de l'outil `Agent` dans les cas de montée en gamme) :

- `general-purpose` pour une implémentation délimitée : Opus, effort medium, passés à l'appel ; effort high pour un bug difficile ou des tests qui échouent.
- `agents:explorer` : Haiku, effort xhigh ; Sonnet, effort high quand il a manqué des liens entre modules.
- `agents:researcher` : Sonnet, effort high.
- `claude-code-guide` : Sonnet, effort high, passés à l'appel.
- Revues de code et de sécurité : Opus, effort medium, high ou xhigh selon l'enjeu, toujours explicite (voir plus bas).
- Cadrage d'une mission flow-board (grilling, spec, découpage) : Fable 5.2 medium, high quand l'auto de la mission envoie de cette discussion, que le mod de flow-board impose au fil principal du manager jusqu'à la fin du découpage ; un `/model` tapé l'arrête pour le reste de la session.
- Tâche de jugement d'une mission flow-board (ticket « Jugement : oui ») : Opus xhigh le temps du ticket, imposé par le mod ; Fable 5.2 high (le worker Fable) seulement par le bouton « ↗ Fable » de l'utilisateur, jamais choisi ni proposé par Claude, sauf la relance suggérée pour un bug qu'Opus n'a pas résolu ; tout le code et toutes les revues restent sur Opus.
- Un spécialiste dont l'en-tête ne fixe pas d'effort (`general-purpose`, `Explore`, `Plan`) reçoit le sien à l'appel : sans lui, il prend l'effort par défaut du poste (`modelSettings`, high pour Opus).
- **Coût de l'effort** (sur l'abonnement, coût par tâche d'Artificial Analysis du 11/11/2026) : sur Opus, high coûte 1,4 fois medium pour 4 points d'indice de plus, xhigh 1,8 fois high pour 5,5 points, max 1,6 fois xhigh pour 1,5 point ; Fable 5.2 medium coûte 2,7 fois Opus high, et Fable 5.2 high 3,6 fois Opus xhigh pour 4,5 points ; le temps peut croître plus vite (4,4 fois la durée de high pour xhigh, sur une passe « bogues » mesurée). xhigh ne se prend que là où une règle le nomme, jamais « dans le doute ».
- **Jamais d'effort max, Haiku en xhigh pour l'explorateur seulement** : Claude ne choisit ni ne propose jamais l'effort max, ni Fable en xhigh, pour lui-même comme pour un spécialiste ou un worker ; Haiku ne monte en xhigh que pour `agents:explorer` ; `/effort max` reste à l'utilisateur, qui le tape lui-même. Mesures (Artificial Analysis, coût sur l'abonnement) : de xhigh à max, Opus gagne 1,5 point pour 1,6 fois le coût ; de high à xhigh, Haiku gagne 4,5 points pour 1,6 fois le coût, et Fable 0,3 point pour 1,7 fois.
- **`agents:explorer` et `agents:researcher` suivent le seuil ci-dessus, comme une implémentation déléguée** : leur faible coût (Haiku, Sonnet) ne suffit pas à justifier une délégation, car chaque passage de relais perd du détail et leur rapport reste à relire. Une fois le seuil atteint, en lancer plusieurs en parallèle (un seul message) dès que les questions sont indépendantes, et leur demander des synthèses courtes.
- Hors de `agents:explorer`, ne jamais confier un spécialiste à Haiku, relecteurs compris : Sonnet au minimum, Opus quand la tâche le justifie.
- **Vagues de spécialistes** : une tâche qui demande beaucoup de spécialistes (lecture sur pièces, revue en tranches) les lance par vagues de taille bornée (8 au plus, en un seul message), suit l'avancement dans un fichier d'état (une ligne par spécialiste lancé : état, tentatives) plutôt que dans la conversation, valide chaque vague avant la suivante et relance par nom ce qui manque ; quota tombé : arrêter, noter, reprendre plus tard depuis le fichier. L'outil `Workflow` ne s'emploie qu'avec l'accord explicite de l'utilisateur, jamais par défaut.

## Revues dans un spécialiste Opus, effort selon l'enjeu

Toute revue de code (`/code-review`, `/mattpocock-skills:code-review`, passe « bogues », revue d'un groupe) et toute revue de sécurité tourne sur Opus, avec un effort fixé explicitement selon le coût d'un défaut manqué : `medium` pour les axes Standards et Spec d'un ticket hors zone sensible, `high` pour l'axe Spec seul d'un ticket sensible (sans l'axe Standards, que sa passe « bogues » refait) et par défaut ailleurs, `xhigh` pour la passe « bogues » d'un ticket qui supprime des données (ou décide ou garde une suppression, même sans rien effacer lui-même) ou touche la concurrence, `high` pour la revue de sécurité, qui ne tourne que sur une zone de la liste de sa méthode. Le niveau de `/code-review` se passe toujours en argument. Un relecteur n'écrit jamais dans l'arbre de travail, sauf une revue `--fix` lancée par la session elle-même.

**Avant de lancer, configurer ou relire une revue**, lire le détail : `~/.claude/plugins/marketplaces/mathis-plugins/config/reference/revues.md` (dans le dépôt `mathis-plugins` : `config/reference/revues.md`) — tableau des efforts, niveau de `/code-review`, modèle et effort d'un relecteur, consignes par un fichier, cible, zone sensible, écritures, sécurité.
