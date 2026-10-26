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
- **`agents:explorer` coûte peu (Haiku) : ne pas hésiter à l'utiliser**, plus tôt que le seuil ci-dessus, et à en lancer plusieurs en parallèle (un seul message) dès que les questions sont indépendantes ; `agents:researcher` (Sonnet) aussi, dès qu'une question de documentation se pose. Le coût qui reste est la relecture de leurs rapports : leur demander des synthèses courtes. `agents:worker` reste sur Opus et suit le seuil ci-dessus.
- Hors de `agents:explorer`, ne jamais confier un sous-agent à Haiku, relecteurs compris : Sonnet au minimum, Opus quand la tâche le justifie.
- **Vagues de sous-agents** : une tâche qui demande beaucoup de sous-agents (lecture sur pièces, revue en tranches) les lance par vagues de taille bornée (8 au plus, en un seul message), suit l'avancement dans un fichier d'état (une ligne par mission : état, tentatives) plutôt que dans la conversation, valide chaque vague avant la suivante et relance par nom ce qui manque ; quota tombé : arrêter, noter, reprendre plus tard depuis le fichier. L'outil `Workflow` ne s'emploie qu'avec l'accord explicite de l'utilisateur, jamais par défaut.

## Revues dans un sous-agent Opus, effort selon l'enjeu

Toute revue de code (`/code-review`, `/mattpocock-skills:code-review`, passe « bogues », revue d'un groupe) et toute revue de sécurité tourne dans un sous-agent lancé par l'outil `Agent` avec `model: "opus"` et un `effort` passé explicitement, petits diffs compris ; jamais dans la discussion ni en exécution dérivée (fork) de la discussion, qui prendrait son modèle et son effort. L'effort suit le coût d'un défaut manqué :

| Revue | `effort` du sous-agent | Niveau de `/code-review` |
|---|---|---|
| Axes Standards et Spec de `/mattpocock-skills:code-review` (revue d'un ticket, revue hors parcours) | `high` | — |
| Revue d'un groupe, et toute autre `/code-review` (relecture de branche ou de PR) | `high` | `high` |
| Passe « bogues » d'un ticket qui touche une zone sensible | `xhigh` | `xhigh` |
| Revue de sécurité | `xhigh` | — |

Le niveau de `/code-review` de Claude Code (`low` à `max`) règle le nombre de constats, pas l'effort de raisonnement : il se passe toujours en argument (`/code-review high --fix`), sinon le skill reprend le dernier niveau tapé. Pour un skill de revue, le sous-agent lance lui-même le skill et rend son rapport.

- **Modèle et effort** — `/code-review` tourne en exécution dérivée (fork) du sous-agent qui le lance : modèle et effort sont ceux de ce relecteur, sans sous-agent à régler. `/mattpocock-skills:code-review` lance au contraire ses axes Standards et Spec par l'outil `Agent` : chacun reçoit `model: "opus"` et le même `effort`, passés explicitement ; le skill n'en fixe aucun, et sans `effort` un sous-agent prend l'effort par défaut d'Opus du poste (`modelSettings`), qui peut changer d'un poste à l'autre.
- **Consignes par un fichier** — `/code-review` ne reçoit que ses arguments. Celui qui lance une revue écrit ses consignes dans un fichier de son dossier temporaire : le périmètre, le chemin du fichier des choix déjà faits, les points réservés au porteur, ce que la revue ne doit pas faire. Il en passe le chemin après la cible, annoncé par « consignes : » : `/code-review high <base>..HEAD consignes : <chemin>`. La revue lit le fichier d'abord ; un chemin sans cette annonce deviendrait la cible. Un relecteur lancé par l'outil `Agent` reçoit le même chemin dans son prompt.
- **Cible** — Toujours une plage `<base>..HEAD`, ou un nom de branche (relue face à la branche par défaut), jamais un hash seul : la revue ne relirait que ce commit. Avant le commit d'un ticket, le fichier de consignes nomme aussi les changements non commités.
- **Zone sensible** (confidentialité, suppression de données, chiffrement, concurrence) — une revue qui appliquerait ses correctifs (revue d'un groupe) tourne sans `--fix` : elle les propose, et le relecteur qui l'a lancée applique ceux qu'il retient.
- **Écritures** — Un relecteur n'écrit jamais dans l'arbre de travail, même un instant : la preuve rouge (le test qui montre un défaut) reste à la session. Seule exception, une revue qui applique ses correctifs (`/code-review --fix`, revue d'un groupe) : le sous-agent qui lance le skill les écrit lui-même. C'est aussi l'exception à toute consigne « sans sous-agents qui écrivent » (brief d'une session liée compris), puisqu'il tourne seul, une fois le travail commité ; la discussion relit ensuite le diff de ses correctifs, relance les contrôles et les commite.
- **Sécurité** — Une revue de sécurité est un relecteur en lecture seule limité au diff.
