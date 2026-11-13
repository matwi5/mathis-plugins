# Règles des outils de l'app Desktop dont dépend flow-board

Dans l'app Claude Desktop, Claude lance, archive et renomme les sessions par des outils de l'app (`start_session`, `archive_session`, `set_session_title`). Leurs règles ne sont écrites que dans le code de l'app (`app.asar`), et deux bugs de flow-board venaient d'un texte qui les contredisait : un lancement de groupe envoyé par le mode auto, refusé par l'app ; une procédure de fermeture qui faisait archiver une session sans l'accord de la personne.

Ce document relie chaque règle au code de flow-board qui en dépend. Les textes cités ont été lus dans l'app 4.4212.0, le 02/11/2026, puis relus dans l'app 4.23118.0, le 08/11/2026 (ce qui diffère des textes de 4.4212.0, ou n'y avait pas été relevé, est daté à sa place), par :

```bash
python3 -I scripts/regles-app.py                  # sur le Mac : /Applications/Claude.app/Contents/Resources/app.asar
python3 -I scripts/regles-app.py --asar <chemin>  # ailleurs (le PC), ou une autre copie de l'app
python3 -I scripts/regles-app.py --garder <dossier>  # et garde la sortie dans <dossier>/<version>.txt
```

Le script imprime la version de l'app, puis, pour chaque outil, sa description et ses messages de refus. Il ne contrôle rien de lui-même : **après une mise à jour de l'app, le relancer** et comparer sa sortie aux phrases citées ici ; une règle changée se reporte ici et dans le code qui en dépend. **À chaque relecture, le lancer avec `--garder <dossier>`**, un dossier qui ne part dans aucune version publique (la sortie recopie les textes de l'app d'un tiers), toujours le même : il y garde la sortie, telle qu'imprimée, dans `<version>.txt`. **Avant d'écrire qu'une règle est inchangée, comparer ce fichier à celui de la version précédente** (`diff <dossier>/<ancienne version>.txt <dossier>/<nouvelle version>.txt`) : une règle dite « inchangée » sans cette comparaison n'est pas prouvée. Relancé sur une version déjà gardée, le script ne réécrit rien si la sortie est la même ; si elle diffère (une autre copie de l'app, dont le chemin est sur la première ligne, ou un repère du script changé), il n'écrase pas le fichier gardé, écrit la nouvelle sortie à côté, dans `<version>.nouveau.txt`, donne les deux chemins à comparer et sort en erreur. Une version de l'app hors forme (autre chose que des nombres séparés par des points), un dossier qui est un lien ou dont le parent n'existe pas : rien n'est gardé, et le script sort en erreur. Sous Windows, `--garder` est refusé (le système n'y permet pas d'écrire par rapport au dossier ouvert) : pour garder la sortie de l'app du PC, copier son `app.asar` sur le Mac et l'y lire par `--asar <copie> --garder <dossier>`. Il dit « introuvable » quand la description d'un outil ou une phrase repère d'un refus (`REFUSAL_MARKERS`, dans le script) n'est plus là : la règle a peut-être changé, et le texte se relit dans `app.asar`. Un refus qui citait « Remote Control », vu un jour sur le PC, n'a pas été retrouvé mot pour mot ; le refus d'`archive_session` ci-dessous en nomme un (« a Remote Control client »), qui est peut-être celui-là : le script, lancé sur le PC avec `--asar`, le tranche.

## `start_session` : pas de lancement sur un tour que la personne n'a pas tapé

Refus de l'app : « Start sessions only on the user's own words to you here; this turn runs an automated event, another session's message, or the task another session gave you. » Un message que flow-board envoie lui-même (`$.prompt.submit`) ouvre un tour de ce genre : un groupe que lance le mode auto y est refusé.

Ce qui en dépend, dans `plugins/flow-board/hooks/register.tsx` :

- `autoLaunch` : la demande de lancement gardée avant l'envoi, posée par `sendAutoAction` (une vague de l'auto) et par `applyWaves` (une vague lancée chez le COO) ;
- `refusedLaunch` et `refusedLaunchContext` : un refus de `start_session` dans le tour de cette demande remet la demande dans la saisie (la personne la lance d'un Entrée) et dit à Claude de ne rien relancer ; appelés par le hook `tool.call` de `register` ;
- test : `plugins/flow-board/tests/lancement-refuse.test.ts`.

Le reste de la description touche le texte de lancement : `initiation` « user_asked » lance tout de suite, et demande un `prompt` (le brief) ; `context` « fresh » demande aussi un `background`, d'une longueur minimale (`${dS}` caractères dans le code de l'app 4.4212.0, `${Ox}` dans 4.23118.0, une valeur que le script ne résout pas). Dans 4.23118.0 (lu le 08/11/2026), la description ajoute une troisième `initiation`, « offer » : appelée avec un titre seul, pour une tâche que la personne vient de nommer, elle montre une carte « New session » / « Do it here » et attend sa réponse (« so it must be the only call in that message ») ; « user_asked » et « own_initiative » demandent toutes deux un `prompt` (« the call is refused without it; `background` does not stand in for it »). Dans cette version, l'outil n'est plus déclaré à côté de son alias : le script suit le nom sous lequel le fichier de l'alias l'exporte jusqu'au fichier qui le déclare. Ce qui en dépend : `missionLaunchText` (le lancement d'une mission depuis une carte de lancement du COO) et `launchHow` (le lancement des groupes), dans `register.tsx`.

## `start_session` : `model`, un modèle de la même famille ou moins cher

Paramètre `model`, lu dans l'app 4.23118.0 le 06/11/2026 et relu le 08/11/2026 (texte cherché directement dans `app.asar` : il est dans le schéma des paramètres de l'outil, que le script n'imprime pas) : « "fresh" only, optional: a cheaper model id for mechanical or read-only pieces (e.g. a Sonnet or Haiku id). Same family or cheaper than yours; anything higher is ignored. Omit to inherit yours. » Les groupes partent déjà en `context` « fresh » ; Sonnet est moins cher qu'Opus, donc accepté depuis une discussion sur Opus. Dans le CLI, `claude --bg` prend `--model` (« Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name », Claude Code 2.1.319).

Ce qui en dépend : l'option fusion, qui lance un groupe sans logique en worker Sonnet high.

- `SONNET_APP_ID`, `SONNET_CLI_ALIAS` et `SONNET_LAUNCH_FR` (`plugins/flow-board/hooks/effort.ts`) : l'id passé à `model`, l'alias de `--model` et la phrase de la demande de lancement qui les donne ;
- `groupLaunchNote` (`effort.ts`) et `delegationText` (`plugins/flow-board/hooks/register.tsx`) : la ligne « Sonnet high, sans logique » d'un groupe sans logique (`isNoLogicGroup`), jamais sous un effort imposé ;
- test : `plugins/flow-board/tests/effort-calcule.test.ts`.

Une discussion sur un modèle moins cher que Sonnet (Haiku) verrait ce `model` ignoré : le groupe partirait sur le modèle de la discussion. À revoir si l'app change cette règle, ou à la sortie d'un nouveau Sonnet (l'id de `SONNET_APP_ID`).

## `archive_session` : un accord explicite, pour une session précise

Description (phrase identique dans 4.23118.0) : « Only call it after the user has explicitly agreed to archive a specific session — never speculatively. » Refus (« Session … was not archived: … ») : une session n'est pas archivée quand elle travaille encore (un tour en cours, ou laissé en cours sur son hôte SSH), qu'elle a du travail vivant (un agent, un client Remote Control, un message en file ou une tâche de fond), qu'elle garde l'ordinateur éveillé (« has "Keep computer awake" turned on », un refus à part), ou que l'app la garde pour la personne (« pinned or in use »).

Le reste de la description, lu dans 4.23118.0 le 08/11/2026 (la sortie de 4.4212.0 n'a pas été gardée : ce qui est nouveau n'est pas établi) : l'app demande l'accord de la personne à chaque appel, sauf en mode auto (« it may approve without asking ») et en mode bypass permissions (« it does not ask »), où l'appel peut prendre effet aussitôt ; archiver une session archive aussi ses sessions annexes qui partagent son worktree ou ont fini ; une session épinglée, ou ouverte à l'écran, n'est pas archivée, « unless the user allowed this call on the desktop app's own card or runs bypass permissions mode » ; et, sous condition, « Archiving is the reversible verb » : `unarchive_session` rend une session, `delete_session` (qui demande toujours l'accord) la supprime sans retour. En mode auto, l'accord de la personne n'est donc plus forcément redemandé par l'app : la règle « accord explicite, pour une session précise » reste à flow-board.

Ce qui en dépend, dans `plugins/flow-board/hooks/closing.ts` :

- `archiveConsent` : l'accord donné d'avance par `/flow archive on`, venu d'un geste de la personne ;
- `appArchive` : cite cet accord en nommant la session, ou demande l'accord en une ligne ;
- `closingProcedure` : la procédure de fermeture d'un groupe rendu, qui l'emploie pour une session de l'app ;
- `missionSessionsArchiveText` et `missionSessionId` : la demande d'archiver la discussion d'une mission livrée et archivée, l'accord toujours demandé en une ligne (test : `plugins/flow-board/tests/discussion-archivee.test.ts`) ;
- test : `plugins/flow-board/tests/archivage-d-office.test.ts`.

## `set_session_title` : un titre posé par la personne se fait approuver

Description (phrase identique dans 4.23118.0) : « If the user set the current title themselves, the app first asks them to approve the new one (not in bypass permissions mode, which does not ask; and in unattended sessions, where nobody can approve, it declines); titles the app generated are replaced without asking. » Ses refus, définis à côté de sa description dans le code de l'app, portent sur la forme du titre : de 1 à 200 caractères, sans caractère de contrôle ni invisible (« The title was left unchanged; resend it without them. »).

Ce qui en dépend :

- `nameDiscussion` (`plugins/flow-board/hooks/model.ts`) : dit à Claude de nommer la discussion par cet outil quand il l'a ;
- `coachingNote` (`plugins/flow-board/hooks/register.tsx`) : la consigne que flow-board ajoute aux skills d'un parcours, qui la donne aussi pour le premier appel à l'outil flow ;
- `renameNow` et `SET_TITLE_TOOL` (`register.tsx`) : `/rename` par le mod seulement quand la session n'a pas cet outil ;
- test : `plugins/flow-board/tests/titre-renommage.test.ts`.
