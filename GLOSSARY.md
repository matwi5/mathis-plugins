# mathis-plugins

La config Claude Code partagée de Mathis : ses plugins, sa config globale et sa synchro entre postes. Ce glossaire fixe les mots de la mesure de l'usage (session-tools, stats-board) et du suivi des agents (flow-board).

## Mesure de l'usage

**Requête** :
Tout le travail fait pour répondre à un message de l'utilisateur : les tours du fil principal, les sous-agents, les tâches de fond et les tours relancés par leurs notifications. Elle se rattache par filiation : ce qu'elle a lancé lui reste compté même après le message suivant, donc deux requêtes peuvent se chevaucher.
_Avoid_: tour, réponse, appel

**Appel** :
Une requête unique au modèle, du fil principal ou d'un sous-agent. Une requête en contient en général plusieurs.
_Avoid_: requête API

**Tâche de fond** :
Un travail lancé en arrière-plan par une requête (sous-agent, workflow, shell, Monitor), qui tourne pendant que le fil principal a la main ou après qu'il a fini.

**Durée réelle** :
Le temps écoulé à l'horloge entre l'envoi du message et la fin du dernier tour du fil principal de sa requête, tours relancés par ses tâches de fond compris. Une tâche de fond qui ne relance jamais de tour (un serveur) ne l'allonge pas.
_Avoid_: chrono, durée murale

**Durée API** :
La somme des temps de tous les appels d'une requête, sous-agents compris, de l'envoi de chaque appel à son dernier morceau de réponse. Outils et attentes n'en font pas partie. Des appels parallèles s'additionnent, donc elle peut dépasser la durée réelle.
_Avoid_: temps de calcul, temps agents

**Temps actif** :
Le temps, sur une période (discussion, jour, projet), pendant lequel au moins une requête était en cours : pauses exclues, chevauchements comptés une fois.
_Avoid_: durée de session, durée de la discussion

**Vitesse** :
Les tokens générés par un modèle divisés par le temps passé à les générer, du premier morceau de réponse au dernier, sur l'ensemble de ses appels.
_Avoid_: débit, tokens/s moyen

## Suivi des agents

**Orchestrateur** :
La discussion qui lance les autres : celle qui porte le parcours, ou, sans parcours, la discussion où l'on regarde.
_Avoid_: discussion mère, session mère, discussion principale

**Session liée** :
Une discussion lancée par l'orchestrateur pour lui confier un travail (un groupe de tickets, un bug, des pistes), qui tourne à côté de lui.
_Avoid_: session fille, session déléguée

**Sous-agent** :
Un agent lancé à l'intérieur d'une discussion (orchestrateur ou session liée), qui travaille pour elle et lui rend un rapport.
_Avoid_: agent, worker

**Advisor** :
Un modèle relecteur, plus fort, qu'une discussion ou un sous-agent consulte en lui passant toute son histoire ; il conseille sans agir.
_Avoid_: conseiller, reviewer

**Attente** :
Un moment où un agent ne travaille pas lui-même parce qu'il attend quelqu'un d'autre : un sous-agent, une tâche de fond, l'advisor, ou la réponse de l'utilisateur.
_Avoid_: blocage

**Pause** :
Un moment où personne ne travaille : ni l'orchestrateur, ni ses sous-agents, ni ses sessions liées ; seuls attendent l'utilisateur, sa réponse ou son prochain message.
_Avoid_: inactivité, trou

**Transcript** :
Le fichier qui garde toute l'histoire d'une discussion ou d'un sous-agent, message par message, compactions comprises : ce que la compaction retire du contexte y reste.
_Avoid_: log, journal, historique

**Compaction** :
Le remplacement de l'histoire d'une discussion, dans son contexte, par un résumé ; tapée (`/compact`), automatique au seuil, ou calculée à l'avance. Le transcript, lui, garde tout.
_Avoid_: compactage, résumé, compression

**Consignes de compaction** :
Ce qu'on demande au résumé de garder lors d'une compaction, selon le rôle de la discussion (orchestrateur, session liée de groupe).
_Avoid_: consignes de /compact, instructions de résumé

## Échanges avec l'utilisateur

**Question à boutons** :
L'encadré que Claude ouvre dans le chat pour poser une question avec des réponses à cliquer, plus une réponse libre.
_Avoid_: encadré de suggestions, bouton dans le chat

**Bouton du tableau de bord** :
Un bouton du panneau d'un mod (flow-board, git-board) qui prépare ou lance une action. Ce qu'il porte n'est jamais redemandé par une question à boutons.
_Avoid_: bouton du panneau, bouton flow

## Lots de tickets

**Groupe** :
Des tickets qui partagent un contexte (mêmes fichiers, ou une chaîne de dépendances), confiés ensemble à une session liée. Un lot qui n'en aurait qu'un n'a pas de groupe.
_Avoid_: lot, paquet

**Vague** :
Un ensemble de groupes qui peuvent tourner en même temps, chacun dans sa session liée.
_Avoid_: niveau, étape

**Groupe rendu** :
Un groupe dont la session liée a rendu son compte rendu, et dont l'orchestrateur a vérifié le travail et rendu les statuts au tableau de bord.
_Avoid_: groupe fini, groupe revenu

**Groupe clos** :
Un groupe rendu dont la branche est fusionnée dans la branche de travail, la revue faite, la sécurité tranchée (jugée inutile, ou chaque faille gardée corrigée ou laissée par l'utilisateur), et qui n'a plus de question en attente de l'utilisateur.
_Avoid_: groupe totalement fini, groupe terminé

**Fermer un groupe** :
Arrêter la session liée d'un groupe clos et retirer son worktree ; sa branche et sa conversation restent.
_Avoid_: archiver le groupe, nettoyer le groupe

**Tâche de jugement** :
Une tâche dont la difficulté est de comprendre ou de définir, pas de produire le changement. Deux sortes : le *jugement sur un existant* (intervenir dans ce qui marche déjà, en tenant compte de ses contraintes implicites : ce dont d'autres dépendent, ce qui ne doit pas bouger, ce que la demande ne dit pas) et l'*objectif ouvert* (le but est donné sans le chemin, et le résultat ne se vérifie pas tout de suite).
_Avoid_: tâche difficile, tâche large

**Tâche d'exécution** :
Une tâche à la consigne explicite, dont le résultat se vérifie tout de suite : on sait déjà quoi faire.
_Avoid_: tâche simple

**Session autonome** :
Une session liée de groupe lancée à l'effort le plus haut (xhigh), qui tranche elle-même ses choix de conception hors zone sensible et les déclare, au lieu d'attendre la réponse de l'utilisateur. Elle sert aux tâches de jugement.
_Avoid_: mode xhigh, session xhigh
