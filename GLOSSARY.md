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
