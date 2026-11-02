# Règles des outils de l'app Desktop dont dépend flow-board

Dans l'app Claude Desktop, Claude lance, archive et renomme les sessions par des outils de l'app (`start_session`, `archive_session`, `set_session_title`). Leurs règles ne sont écrites que dans le code de l'app (`app.asar`), et deux bugs de flow-board venaient d'un texte qui les contredisait : un lancement de groupe envoyé par le mode auto, refusé par l'app ; une procédure de fermeture qui faisait archiver une session sans l'accord de la personne.

Ce document relie chaque règle au code de flow-board qui en dépend. Les textes cités ont été lus dans l'app 4.4212.0, le 02/11/2026, par :

```bash
python3 -I scripts/regles-app.py                  # sur le Mac : /Applications/Claude.app/Contents/Resources/app.asar
python3 -I scripts/regles-app.py --asar <chemin>  # ailleurs (le PC), ou une autre copie de l'app
```

Le script imprime la version de l'app, puis, pour chaque outil, sa description et ses messages de refus. Il ne contrôle rien de lui-même : **après une mise à jour de l'app, le relancer** et comparer sa sortie aux phrases citées ici ; une règle changée se reporte ici et dans le code qui en dépend. Il dit « introuvable » quand la description d'un outil ou une phrase repère d'un refus (`REFUSAL_MARKERS`, dans le script) n'est plus là : la règle a peut-être changé, et le texte se relit dans `app.asar`. Un refus qui citait « Remote Control », vu un jour sur le PC, n'a pas été retrouvé mot pour mot ; le refus d'`archive_session` ci-dessous en nomme un (« a Remote Control client »), qui est peut-être celui-là : le script, lancé sur le PC avec `--asar`, le tranche.

## `start_session` : pas de lancement sur un tour que la personne n'a pas tapé

Refus de l'app : « Start sessions only on the user's own words to you here; this turn runs an automated event, another session's message, or the task another session gave you. » Un message que flow-board envoie lui-même (`$.prompt.submit`) ouvre un tour de ce genre : un groupe que lance le mode auto y est refusé.

Ce qui en dépend, dans `plugins/flow-board/hooks/register.tsx` :

- `autoLaunch` : la demande de lancement gardée avant l'envoi, posée par `sendAutoAction` (une vague de l'auto) et par `applyWaves` (une vague lancée chez le COO) ;
- `refusedLaunch` et `refusedLaunchContext` : un refus de `start_session` dans le tour de cette demande remet la demande dans la saisie (la personne la lance d'un Entrée) et dit à Claude de ne rien relancer ; appelés par le hook `tool.call` de `register` ;
- test : `plugins/flow-board/tests/lancement-refuse.test.ts`.

Le reste de la description touche le texte de lancement : `initiation` « user_asked » lance tout de suite, et demande un `prompt` (le brief) ; `context` « fresh » demande aussi un `background`, d'une longueur minimale (`${dS}` caractères dans le code de l'app, une valeur que le script ne résout pas). Ce qui en dépend : `missionLaunchText` (le lancement d'une mission depuis une carte de lancement du COO) et `launchHow` (le lancement des groupes), dans `register.tsx`.

## `archive_session` : un accord explicite, pour une session précise

Description : « Only call it after the user has explicitly agreed to archive a specific session — never speculatively. » Refus (« Session … was not archived: … ») : une session n'est pas archivée quand elle travaille encore (un tour en cours), qu'elle a du travail vivant (un agent, un client Remote Control, un message en file ou une tâche de fond), qu'elle garde l'ordinateur éveillé, ou que l'app la garde pour la personne (épinglée ou ouverte).

Ce qui en dépend, dans `plugins/flow-board/hooks/closing.ts` :

- `archiveConsent` : l'accord donné d'avance par `/flow archive on`, venu d'un geste de la personne ;
- `appArchive` : cite cet accord en nommant la session, ou demande l'accord en une ligne ;
- `closingProcedure` : la procédure de fermeture d'un groupe rendu, qui l'emploie pour une session de l'app ;
- test : `plugins/flow-board/tests/archivage-d-office.test.ts`.

## `set_session_title` : un titre posé par la personne se fait approuver

Description : « If the user set the current title themselves, the app first asks them to approve the new one (not in bypass permissions mode, which does not ask; and in unattended sessions, where nobody can approve, it declines); titles the app generated are replaced without asking. » Ses refus, définis à côté de sa description dans le code de l'app, portent sur la forme du titre : de 1 à 200 caractères, sans caractère de contrôle ni invisible (« The title was left unchanged; resend it without them. »).

Ce qui en dépend :

- `nameDiscussion` (`plugins/flow-board/hooks/model.ts`) : dit à Claude de nommer la discussion par cet outil quand il l'a ;
- `coachingNote` (`plugins/flow-board/hooks/register.tsx`) : la consigne que flow-board ajoute aux skills d'un parcours, qui la donne aussi pour le premier appel à l'outil flow ;
- `renameNow` et `SET_TITLE_TOOL` (`register.tsx`) : `/rename` par le mod seulement quand la session n'a pas cet outil ;
- test : `plugins/flow-board/tests/titre-renommage.test.ts`.
