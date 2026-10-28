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
| 28/10/2026 | 2.1.312, terminal | démarrage et reprise (`session.start`, `classic.SessionStart`), `sessionTitle` renvoyé par `classic.SessionStart` (sonde `--titre`, `--reprise`) |
| 28/10/2026 | 2.1.312, terminal | compaction tapée et automatique (`session.compact`), fenêtre réduite par `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` |

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

7. **Démarrage et reprise** : `session.start`, puis `classic.SessionStart` dans la même milliseconde (ou la suivante), au démarrage (`source: "startup"`) comme à la reprise par `--continue` (`source: "resume"`, qui porte alors `session_title`, le titre de la session reprise). Un hook de `classic.SessionStart` peut donc lire ce que `session.start` a chargé, sous réserve des `await` de la sonde (voir « Refaire l'essai ») : un mod qui en dépend garde un repli. Vu le 28/10/2026 avec 2.1.312 au terminal ; `/clear` et l'app desktop non mesurés.

**Non vérifié** : l'`agentId` des agents de workflow, `parentAgentId` d'un sous-agent de sous-agent, le Monitor, `/loop` et les réveils planifiés, une notification livrée pendant un tour en cours, une interruption avec un sous-agent de fond. Pour ces cas, les règles ci-dessous suivent les types du moteur.

## Titre de la session (`sessionTitle`)

Un hook classique peut renommer la session : `hookSpecificOutput.sessionTitle` de `classic.UserPromptSubmit` ou de `classic.SessionStart` (dans un mod, le champ `sessionTitle` du résultat). Le hook suivant reçoit le titre en cours dans `session_title`.

| Essai | Claude Code | Vu |
|---|---|---|
| `classic.UserPromptSubmit` renvoie un titre (mod d'essai dans tmux) | 2.1.311 et 2.1.308 (embarqué par l'app), terminal, 27/10/2026 | le titre s'affiche sur le bord du prompt et revient dans `session_title` du hook suivant |
| Titre posé par un hook de projet | app desktop, 27/10/2026 (constaté par Mathis) | le titre de la discussion change dans l'app |
| `classic.SessionStart` au démarrage renvoie un titre (sonde `--titre`) | 2.1.312, terminal, 28/10/2026 | appliqué : bord du prompt, puis `session_title` du premier `classic.UserPromptSubmit` |
| `classic.SessionStart` à la reprise (`--continue`) renvoie un titre | 2.1.312, terminal, 28/10/2026 | appliqué : il remplace le titre de la session reprise |
| Session lancée depuis le shell d'une autre session Claude Code (variables `CLAUDE_CODE_SESSION_ID`, `CLAUDECODE` héritées) | 2.1.312, terminal, 28/10/2026 | le `sessionTitle` du démarrage ne prend pas : la session porte le titre de la session parente. `scripts/sonde.py` retire ces variables |

Ce que flow-board en tire : le titre qu'une discussion doit prendre part une fois, au prochain message ou à la reprise, et seulement s'il diffère de `session_title`.

## Compaction (`session.compact`)

Toute compaction vue dans cet essai (tapée, automatique) passe par `session.compact` ; le cas d'un résumé calculé à l'avance reste à confirmer (voir le tableau). Un hook peut y réécrire `instructions` (ce que le résumé doit garder) avant `next(e)`. Essai du 28/10/2026, Claude Code 2.1.312, terminal, Haiku, avec `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` pour atteindre le seuil vite (l'invite système seule pèse près de 78 000 tokens avec les plugins de Mathis).

| Essai | Vu |
|---|---|
| `/compact garde le mot banane` | `trigger: "manual"`, `instructions` = le texte tapé ; `next(e)` rend `{ messages, tokensBefore, tokensAfter, usage }` (78 041 → 21 472 tokens) |
| Seuil atteint à l'envoi d'un message | `trigger: "auto"`, sans `instructions`, après `prompt.submit`, à la même milliseconde que `turn.start` (ordre entre les deux non tranché par la sonde), avant le premier appel du modèle |
| Seuil atteint en plein tour (lectures de gros fichiers) | dans le même tour, une compaction `auto` à l'envoi puis deux entre deux appels du modèle ; le tour finit en `reason: "error"` après la troisième |
| Compaction automatique sans résultat | deux `session.compact` (`auto`) sans retour de `next(e)` (rejet ou abandon : la sonde ne note pas l'erreur) |
| Résumé calculé à l'avance (`precompute`) | jamais vu dans cet essai (`idleCompaction: false` dans les réglages de Mathis) : on ne sait pas encore si une compaction automatique qui réutilise un résumé calculé à l'avance repasse par l'événement (à confirmer) |

Ce que flow-board en tire : il ajoute ses consignes de compaction sur tous les déclencheurs, `precompute` compris, et ne pose le repère ⇣ qu'une fois que `next(e)` a rendu des `messages` (une compaction rejetée ou refusée n'en pose pas).

## Appels à l'advisor dans un transcript

Relevé le 27/10/2026 et revérifié le 28/10/2026 (noms de champs seulement, jamais le contenu). Un appel à l'advisor laisse dans la réponse du modèle (lignes `assistant` qui partagent un `message.id`) :

- un bloc `server_tool_use` nommé `advisor`, avec son `id` et un `input` vide ;
- puis un bloc `advisor_tool_result`, avec `tool_use_id` (l'`id` du bloc précédent) et `content` de type `advisor_redacted_result`, dont le texte est chiffré (`encrypted_content`) : il ne se lit pas ;
- dans `message.usage.iterations`, répété sur chaque ligne de la réponse, une entrée de type `advisor_message` par appel, dans l'ordre des blocs : `model`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` (et le détail `cache_creation`). Ces tokens ne sont pas dans l'`usage` de premier niveau de la réponse.

Les mêmes blocs paraissent aussi dans des lignes `api-request-blob`. Le rattrapage de flow-board (`plugins/flow-board/hooks/transcript.ts`) apparie les blocs `server_tool_use` aux entrées `advisor_message`, dans l'ordre, et date la fin d'un appel par son `advisor_tool_result`.

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

**`$.session.compact` sans `messages` saute les hooks des plugins, sans erreur.** Dans `claude plugin test`, une compaction lancée sans conversation à résumer ne passe par aucun hook `session.compact` : le test continue et ses vérifications d'absence (« pas de consignes », « pas de repère ») passent à vide. Un premier essai de flow-board passait ainsi, et plusieurs tests « rien n'est proposé » étaient verts avant le code (constaté le 28/10/2026). Pour qu'un hook tourne : poser `mock.session(on)`, ajouter un message à la session par `$.session.append` avant la compaction, et passer au moins un message valide à l'appel, `$.session.compact({ trigger, messages: [{ role: 'user', text: 'x', toolUses: [] }] })`. Exemple : l'aide `summarizer` de `plugins/flow-board/tests/compaction.test.ts`. Un test d'absence vérifie aussi d'abord un effet du plugin (règle « contrôle positif » de `CODING_STANDARDS.md`).

## Refaire l'essai

```bash
python3 scripts/sonde.py              # Claude Code du terminal
python3 scripts/sonde.py --desktop    # le Claude Code embarqué par l'app desktop, le plus récent
python3 scripts/sonde.py --titre "Essai"            # la sonde renvoie ce titre dans sessionTitle, une fois
python3 scripts/sonde.py --dir <dossier> --reprise  # reprend la dernière session du dossier (--continue)
python3 scripts/sonde.py --env CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000  # variable passée à la session (répétable)
tmux attach -t sonde                  # jouer les scénarios, puis Ctrl-b d
python3 scripts/sonde.py --touches Down Enter      # sans s'attacher : des touches tmux (le dialogue de confiance d'un dossier neuf)
python3 scripts/sonde.py --envoyer "/compact garde le mot banane" --attendre 30 --voir  # un texte puis Entrée, 30 s d'attente, la fin du volet
python3 scripts/sonde.py --voir --lignes 60        # la fin du volet (40 lignes par défaut)
tmux kill-session -t sonde            # fermer
```

Claude peut ainsi mener un essai seul, depuis sa propre session : `--touches`, `--envoyer` et `--voir` agissent sur la sonde déjà lancée (`--name` si ce n'est pas « sonde ») et attendent eux-mêmes `--attendre` secondes, là où un `sleep` au premier plan est refusé dans une session Claude Code (donner au Bash un délai plus long que l'attente). Un dossier jetable neuf ouvre d'abord le dialogue de confiance, curseur sur « No, exit » : `--touches Down Enter` le passe. Essai du 28/10/2026 (Claude Code 2.1.312, terminal) : `--env SONDE_ESSAI=42`, puis un `echo $SONDE_ESSAI` demandé par `--envoyer` a rendu `42`, lu par `--voir`.

Le script ouvre une session tmux détachée dans un dossier jetable, en Haiku et en effort low, avec la sonde (`scripts/sonde/`) chargée par `--plugin-dir`. Chaque session de Claude Code écrit son journal dans `scripts/sonde/journaux/<heure d'ouverture>.jsonl`, que git ignore : une ligne par événement, avec le temps écoulé depuis le premier (`t`, en ms), l'heure, et l'état du chrono de `session-tools` quand il est installé (`chrono`). La sonde note aussi `session.start`, `classic.SessionStart` (source, titre), `classic.UserPromptSubmit` (titre en cours) et `session.compact` (déclencheur, consignes, puis le résultat de `next(e)`). Avec `--titre`, elle renvoie ce titre dans `sessionTitle` au premier de ces deux hooks, une fois par processus (fichier `scripts/sonde/titre.txt`, ignoré par git), et le journal le note (`…:sessionTitle`). Elle retire de son environnement les variables qui la lieraient à la session Claude Code qui la lance. La sonde fait elle-même des `await` dans ses hooks : deux événements à moins d'une milliseconde l'un de l'autre peuvent s'y noter dans un ordre différent de celui que verrait un plugin sans attente.

Après l'essai, mettre à jour le tableau des versions, les points qui changent, et les faux moteurs des tests s'il le faut.
