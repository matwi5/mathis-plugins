# Événements du moteur : ordre observé et filiation des requêtes

Ce document décrit les événements de Claude Code tels qu'une sonde les a vus passer, et les règles qui rattachent le travail à une requête. Il sert à trois choses :

- écrire du code qui suit une requête : le chrono de `session-tools` (`plugins/session-tools/hooks/register.tsx`) et le suivi des requêtes de `stats-board` (`plugins/stats-board/hooks/requests.ts` et `register.tsx`) ;
- écrire les faux moteurs de leurs tests, qui doivent émettre les événements dans cet ordre ;
- refaire l'essai sur une nouvelle version de Claude Code, avec la sonde (`scripts/sonde.py`).

Les mots (requête, tâche de fond, durée réelle…) sont ceux de `GLOSSARY.md`. Les types du moteur (`.claude-plugin/types/claude-code/index.d.ts`) disent ce que chaque événement porte ; ce document dit ce que les types ne disent pas : l'ordre, et ce qui manque dans certains cas.

**Avant d'utiliser l'API du moteur** (`$.clock`, `$.fs`, `$.state`, minuteries, éléments d'interface), charger le skill `plugin-authoring` plutôt que de fouiller `index.d.ts`. Exemple de piège : `$.clock.after(ms, fn)` rend une minuterie à annuler (`cancel()`), pas une promesse à attendre ; pour attendre, c'est `$.clock.sleep(ms)`.

## Versions essayées

| Date | Claude Code | Scénarios |
|---|---|---|
| 26/10/2026 | 2.1.310, terminal | tous ceux du tableau ci-dessous |
| 26/10/2026 | 2.1.308, moteur embarqué par l'app desktop, lancé dans le terminal | tous, sauf le message envoyé pendant une tâche de fond |
| 27/10/2026 | 2.1.311, terminal | un message simple (ordre `prompt.submit`, `turn.start`, `classic.Stop`, `turn.complete`) |

Le moteur est le même dans les deux binaires. L'interface graphique de l'app desktop n'a pas été pilotée : son dessin reste couvert par les tests des mods sur la surface `desktop`. Les deux versions se comportent pareil sur tous les points ci-dessous, sauf ceux qu'un seul essai montre (signalés).

| Scénario | Vu |
|---|---|
| Commande shell de fond (`sleep 20`), puis sa notification au repos | oui |
| Sous-agent de fond, puis sa notification au repos (dont un sous-agent qui lance lui-même des shells de fond) | oui |
| Message envoyé pendant qu'une commande de fond de la requête précédente tourne | terminal seulement |
| Interruption (Échap) pendant une commande au premier plan, avec une commande de fond en cours | oui |
| Interruption avec un sous-agent de fond en cours | non testé |
| Notification livrée pendant un tour en cours | non testé |
| Monitor, workflow, sous-agent de sous-agent, `/loop`, réveils planifiés | non testés |

## Ordre des événements

1. **Un prompt reçu au repos** : `prompt.submit`, puis `turn.start` du fil principal, avec le même texte. Le `turn.start` arrive **avant** que le `next()` de `prompt.submit` rende la main (quelques millisecondes). Un plugin ne doit donc pas compter sur un état posé après `next()` dans `prompt.submit` pour reconnaître son tour : il relie `turn.start` à son prompt par le texte, identique dans les deux événements.
2. **Fin normale d'un tour du fil principal** : `classic.Stop`, puis `turn.complete` du même tour (3 à 28 ms après), toujours.
3. **`background_tasks`** : présent à chaque `classic.Stop`, il liste les tâches de fond encore en cours (type `shell` ou `subagent`, statut `running`), y compris celles qu'un sous-agent a lancées. Il est vide au `classic.Stop` du tour qui suit la dernière notification. `classic.SubagentStop` porte aussi une liste à jour, même pour des agents internes de Claude Code (titre, suggestion de prompt : leur rôle est à confirmer) qui n'ont pas d'`agent.spawn`. `classic.SubagentStart` ne la porte pas.
4. **Tour d'une notification** : toujours `prompt.submit`, puis `turn.start` du fil principal, avec le même texte. Deux origines :
   - `origin.kind: "task-notification"`, texte `<task-notification>` avec `<task-id>` : la fin d'une commande shell de fond, et aussi celle d'un sous-agent (`<task-id>` égal à son `agentId`) ;
   - `origin.kind: "peer"`, texte `<agent-message from="<agentId>">` : le message de retour d'un sous-agent. Un même sous-agent peut envoyer les deux, d'abord la `task-notification`, puis son message de retour.

   L'identifiant d'une tâche de `background_tasks` est celui qu'annonce sa notification : `task-id` pour un shell, `agentId` (celui d'`agent.spawn` et de `turn.start`) pour un sous-agent.
5. **Interruption (Échap)** : `turn.complete` arrive avec `reason: "aborted"` et `isAborted: true`, et **aucun `classic.Stop`** n'est émis. Une commande de fond lancée dans le tour interrompu n'apparaît donc dans aucune liste. Sa notification arrive plus tard (`task-notification`, au repos) et relance un tour normal (vu au terminal seulement). Pour une erreur d'API ou un refus, les types annoncent `StopFailure` à la place de `classic.Stop` : à confirmer.
6. **Sous-agents** : `agent.spawn` (`background: true`, `parentAgentId` absent pour un agent lancé par le fil principal) arrive en même temps que le premier `turn.start` de l'agent (`agentId`). Ses `turn.step` et ses `turn.complete` portent son `agentId`. Un agent **réveillé** (il attendait ses propres tâches de fond et reçoit une notification) reçoit un **nouvel `agent.spawn`** et un nouveau `classic.SubagentStart`, avec le même `agentId`. `$.agent.list()` le donne `running`, puis `waiting` quand il attend ses tâches, puis `completed`.

**Non vérifié** : l'`agentId` des agents de workflow, `parentAgentId` d'un sous-agent de sous-agent, le Monitor, `/loop` et les réveils planifiés, une notification livrée pendant un tour en cours, une interruption avec un sous-agent de fond. Pour ces cas, les règles ci-dessous suivent les types du moteur.

## Filiation d'une requête

Les règles que le chrono de `session-tools` et le suivi des requêtes de `stats-board` appliquent tous les deux. Chacun des deux modules nomme l'autre en tête : une règle changée dans l'un se change dans l'autre, puis ici.

- **Ouverture** : un message de l'utilisateur ouvre une requête, à son heure d'envoi (`prompt.submit`). Sont de l'utilisateur les origines `composer`, `sdk`, `bridge`, `slack-ping` et `unclassified`, une origine absente, et `plugin` avec `asUser`. Une notification, une tâche planifiée ou le message d'une autre session n'en ouvrent jamais.
- **Message pendant un tour** (`prompt.submit` avec `turnId`) : il ouvre une nouvelle requête, à son heure d'envoi, et le reste du tour lui revient. Si le moteur le livre au tour suivant plutôt que dans le tour en cours, ce tour ne la redémarre pas.
- **Agent** : il appartient à la requête de son parent (`parentAgentId` d'`agent.spawn`), à défaut à celle pour laquelle travaille le fil principal. Seul le premier `agent.spawn` d'un identifiant compte : un agent réveillé ne change pas de requête.
- **Tâche de fond** : elle appartient à la requête courante quand elle apparaît pour la première fois dans `background_tasks`.
- **Tour relancé par une notification** (livrée au repos) : il appartient à la requête de la tâche notifiée, retrouvée par l'identifiant que porte le texte. Le message d'un pair inconnu vient d'une autre session : hors requête. Une tâche que personne n'a vue (lancée dans un tour interrompu) va à la requête courante, seulement si celle-ci a fini par une interruption : une requête finie normalement ne se rouvre jamais pour une tâche inconnue.
- **Notification livrée pendant un tour** (`prompt.submit` d'origine `task-notification` avec `turnId`) : elle ne crée pas de tour ; sa tâche quitte sa requête à cet instant, et le travail qui suit reste à la requête du tour en cours.
- **Fin** : le fil principal est au repos, et le `background_tasks` du dernier `classic.Stop` (ou `classic.SubagentStop`) ne contient plus aucune tâche de la requête. Les crons de session (`session_crons`) ne comptent pas. Sans `background_tasks` (une version qui ne le donne pas), les agents encore actifs de `$.agent.list()`.
- **Interruption** (ou erreur) : faute de `classic.Stop`, les tâches qui restent sont celles du dernier `classic.Stop` de la requête, moins celles qui ont notifié leur fin depuis, plus les agents de `$.agent.list()` encore `running`, `pending` ou `waiting` qui lui sont rattachés. Si aucune ne reste, la requête est finie.
- **Rechargement du module** : les prompts en attente de leur tour sont perdus. Une notification se reconnaît alors à son texte (`<task-notification>`, `<agent-message from=`), et tout autre texte non vide compte comme un message.

## Faux moteurs des tests

Les tests de `session-tools` (`realEngine`) et de `stats-board` (`requestEngine`) simulent ce moteur. Ils émettent `prompt.submit`, attendent sa fin, puis émettent `turn.start` avec le même texte ; finissent un tour normal par `classic.Stop` (avec `background_tasks`) puis `turn.complete` ; et une interruption par `turn.complete` seul. Un faux moteur qui démarre le tour à l'intérieur de `prompt.submit` cache les défauts d'ordre : le chrono de `session-tools` passait ainsi ses tests alors qu'il repartait de zéro au retour d'une tâche de fond.

## Refaire l'essai

```bash
python3 scripts/sonde.py              # Claude Code du terminal
python3 scripts/sonde.py --desktop    # le Claude Code embarqué par l'app desktop, le plus récent
tmux attach -t sonde                  # jouer les scénarios, puis Ctrl-b d
tmux kill-session -t sonde            # fermer
```

Le script ouvre une session tmux détachée dans un dossier jetable, en Haiku et en effort low, avec la sonde (`scripts/sonde/`) chargée par `--plugin-dir`. Chaque session de Claude Code écrit son journal dans `scripts/sonde/journaux/<heure d'ouverture>.jsonl`, que git ignore : une ligne par événement, avec le temps écoulé depuis le premier (`t`, en ms), l'heure, et l'état du chrono de `session-tools` quand il est installé (`chrono`). La sonde fait elle-même des `await` dans ses hooks : deux événements à moins d'une milliseconde l'un de l'autre peuvent s'y noter dans un ordre différent de celui que verrait un plugin sans attente.

Après l'essai, mettre à jour le tableau des versions, les points qui changent, et les faux moteurs des tests s'il le faut.
