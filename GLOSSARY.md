# mathis-plugins

La config Claude Code partagée de Mathis : ses plugins, sa config globale et sa synchro entre postes. Ce glossaire fixe les mots de la mesure de l'usage (session-tools, stats-board) et du suivi des agents (flow-board).

Depuis le 01/11/2026, Mission, Manager, Worker, Spécialiste et Affectation remplacent parcours, orchestrateur, session liée, sous-agent et lien, et le COO s'ajoute au-dessus des managers ; l'ancien mot reste dans les fichiers pas encore renommés.

## Mesure de l'usage

**Requête** :
Tout le travail fait pour répondre à un message de l'utilisateur : les tours du fil principal, les spécialistes, les tâches de fond et les tours relancés par leurs notifications. Elle se rattache par filiation : ce qu'elle a lancé lui reste compté même après le message suivant, donc deux requêtes peuvent se chevaucher.
_Avoid_: tour, réponse, appel

**Appel** :
Une requête unique au modèle, du fil principal ou d'un spécialiste. Une requête en contient en général plusieurs.
_Avoid_: requête API

**Tâche de fond** :
Un travail lancé en arrière-plan par une requête (spécialiste, workflow, shell, Monitor), qui tourne pendant que le fil principal a la main ou après qu'il a fini.

**Durée réelle** :
Le temps écoulé à l'horloge entre l'envoi du message et la fin du dernier tour du fil principal de sa requête, tours relancés par ses tâches de fond compris. Une tâche de fond qui ne relance jamais de tour (un serveur) ne l'allonge pas.
_Avoid_: chrono, durée murale

**Durée API** :
La somme des temps de tous les appels d'une requête, spécialistes compris, de l'envoi de chaque appel à son dernier morceau de réponse. Outils et attentes n'en font pas partie. Des appels parallèles s'additionnent, donc elle peut dépasser la durée réelle.
_Avoid_: temps de calcul, temps agents

**Temps actif** :
Le temps, sur une période (discussion, jour, projet), pendant lequel au moins une requête était en cours : pauses exclues, attentes de la réponse de l'utilisateur à une question ou à un plan exclues (sauf le travail de ses spécialistes pendant ce temps), chevauchements comptés une fois.
_Avoid_: durée de session, durée de la discussion

**Temps cumulé** :
Le travail de tous les fils d'une période, chacun compté : la somme des temps actifs de chaque discussion, plus, dans chaque discussion, chaque fil en plus du premier qui travaille en même temps (son fil principal pendant un tour, ses spécialistes de fond pendant le leur). Deux discussions, ou deux spécialistes de fond, en même temps comptent deux fois ; un spécialiste qui bloque son parent ne compte pas à part.
_Avoid_: temps total, temps additionné

**Temps gagné** :
Le temps cumulé moins le temps actif d'une même période : ce que le parallélisme (entre discussions et dans une discussion) a fait en plus du temps passé.
_Avoid_: temps économisé, gain de parallélisme

**Vitesse** :
Les tokens générés par un modèle divisés par le temps passé à les générer, du premier morceau de réponse au dernier, sur l'ensemble de ses appels.
_Avoid_: débit, tokens/s moyen

## Missions et feuille de route

**Mission** :
Un travail suivi de bout en bout par flow-board, de son point de départ jusqu'à la livraison. Le skill qui l'ouvre fixe ses phases. Elle est en cours, en pause ou terminée, et avance en auto ou en manuel.
_Avoid_: parcours, projet, chantier, workflow

**Point de départ** :
Le skill par lequel une mission commence (cadrage, spec, tickets, implémentation, diagnostic d'un bug…), que le COO recommande avant le lancement.
_Avoid_: entrée, skill d'entrée

**Livraison** :
L'envoi en une fois de toutes les missions au rapport validé d'un projet : version, push, pull request et étapes propres au projet, lancé par un clic de l'utilisateur chez le COO.
_Avoid_: livraison de la mission, release

**Mission livrée** :
Une mission terminée par une livraison, qui n'a plus rien à livrer. Elle reste visible jusqu'à ce que l'utilisateur l'archive ou lance sa rétro.
_Avoid_: mission poussée, mission archivée

**Archiver une mission** :
La retirer des missions en cours, sur un choix de l'utilisateur ; elle se reprend plus tard si besoin.
_Avoid_: clore, fermer

**Feuille de route** :
La suite des jalons d'un projet, du jalon en cours aux suivants, que le COO tient pour mener l'utilisateur jusqu'à la fin ; le cap vient des objectifs du projet.
_Avoid_: roadmap, planning, backlog

**Jalon** :
Une étape de la feuille de route, avec un but, un critère de fin et ses missions. Pour un projet sans fin, la fin visée est celle du jalon en cours.
_Avoid_: milestone, étape, sprint

**Idée** :
Ce que l'utilisateur confie au COO sans le lancer tout de suite, écrit par le COO en français clair sans en changer le sens, et gardé jusqu'à devenir une mission ou être écartée ; elle ne s'efface jamais.
_Avoid_: brouillon, suggestion, note

**À reprendre** :
Une chose qu'une mission a mise de côté (correction mineure, piste, constat, décision à prendre), gardée par le COO jusqu'à ce que l'utilisateur la lance, la rattache à une mission, la garde pour plus tard ou l'écarte ; elle ne disparaît jamais seule.
_Avoid_: backlog, pour plus tard, TODO, reste à faire

### Où sont ces fichiers sur le poste

| Fichier | Chemin |
|---|---|
| Fichier des missions | `~/.claude/flow-board/parcours/<racine du projet>.json`, un par projet |
| Relais des workers | `~/.claude/flow-board/relais/<id de la mission>.<id de la session>.entry.json`, un par worker |
| Feuille de route | `travail/feuille-de-route.md` du projet, ou `~/.claude/flow-board/coordination/<projet>.feuille-de-route.md` quand elle reste sur le poste |
| Boîte « À reprendre » | `~/.claude/flow-board/a-reprendre/<projet>.<discussion>.json`, une par discussion |

Dans ces chemins, `<racine du projet>` est le chemin de la racine du projet mis en forme de nom de fichier, `<projet>` ce même nom (raccourci) suivi d'une empreinte de la racine, et `<discussion>` l'id de la discussion. La règle exacte de ces noms, les autres fichiers de flow-board et ce qui se passe quand le mod ne trouve pas `~/.claude` sont dans la section « Données et stockage » du README de flow-board (`plugins/flow-board/README.md`).

## Suivi des agents

**COO** :
Le directeur des opérations : la discussion, unique pour un projet sur un poste, qui suit toutes ses missions et fait le lien entre elles. Il les empêche de se gêner, garde la feuille de route, les idées et ce qui est à reprendre, lance les missions, livre sur un clic de l'utilisateur, et ne remonte à l'utilisateur que l'essentiel. Il répond lui-même à une question sur le code et fait faire une petite modification sans logique, mais ne code pas, ne cadre pas et ne porte jamais de mission lui-même.
_Avoid_: coordinateur, coordinator, chief of staff, chef de projet, PMO, directeur de programme

**Siège du COO** :
Le droit d'écrire comme COO d'un projet, tenu par une seule discussion à la fois ; une autre le prend par « Reprendre ici », et celle qui l'a perdu n'écrit plus rien.
_Avoid_: verrou, rôle actif

**Consigne transmise** :
Ce que le COO transmet à un manager pour sa mission, écrit dans le fichier de décisions de cette mission. Celle que l'utilisateur dicte porte sa phrase exacte et vaut sa décision ; celle que le COO envoie de lui-même n'est qu'une information, qui ne remplace jamais un geste ni une décision de l'utilisateur.
_Avoid_: consigne (seul), message libre, ordre, instruction

**Surveillance de nuit** :
La période, allumée par l'utilisateur, pendant laquelle le COO débloque seul les groupes des missions en auto (lancer un groupe de la vague, renvoyer, relancer, forcer une retenue tenue par un worker mort, couper l'auto, rouvrir une mission). Elle s'arrête au retour de l'utilisateur, et le COO n'y prend jamais une décision qui lui revient.
_Avoid_: mode nuit, veille, pilote automatique

**Manager** :
La discussion qui lance les autres : celle qui porte une mission, ou, sans mission, la discussion où l'on regarde. Elle ne parle qu'à ses workers et au COO, jamais à un autre manager.
_Avoid_: orchestrateur, discussion mère, session mère, discussion principale

**Worker** :
Une discussion lancée par un manager pour lui confier un travail (un groupe de tickets, un bug, des pistes), qui tourne à côté de lui et n'écoute que lui.
_Avoid_: session liée, session fille, session déléguée, équipe

**Spécialiste** :
Un agent lancé à l'intérieur d'une discussion (COO, manager ou worker), qui travaille pour elle et lui rend un rapport.
_Avoid_: sous-agent, agent, worker, expert

**Advisor** :
Un modèle relecteur, plus fort, qu'une discussion ou un spécialiste consulte en lui passant toute son histoire ; il conseille sans agir.
_Avoid_: conseiller, reviewer

**Attente** :
Un moment où un agent ne travaille pas lui-même parce qu'il attend quelqu'un d'autre : un spécialiste, une tâche de fond, l'advisor, ou la réponse de l'utilisateur.
_Avoid_: blocage

**Pause** :
Un moment où personne ne travaille : ni le manager, ni ses spécialistes, ni ses workers ; seuls attendent l'utilisateur, sa réponse ou son prochain message.
_Avoid_: inactivité, trou

**Transcript** :
Le fichier qui garde toute l'histoire d'une discussion ou d'un spécialiste, message par message, compactions comprises : ce que la compaction retire du contexte y reste.
_Avoid_: log, journal, historique

**Compaction** :
Le remplacement de l'histoire d'une discussion, dans son contexte, par un résumé ; tapée (`/compact`), automatique au seuil, ou calculée à l'avance. Le transcript, lui, garde tout.
_Avoid_: compactage, résumé, compression

**Consignes de compaction** :
Ce qu'on demande au résumé de garder lors d'une compaction, selon le rôle de la discussion (COO, manager, worker de groupe).
_Avoid_: consignes de /compact, instructions de résumé

**Contexte de départ** :
Ce qu'une discussion ou un spécialiste porte avant son premier échange (règles chargées, outils, liste des skills), et qu'il relit à chaque requête jusqu'à sa première compaction.
_Avoid_: contexte initial, overhead, frais fixes

## Échanges avec l'utilisateur

**Question à boutons** :
L'encadré que Claude ouvre dans le chat pour poser une question avec des réponses à cliquer, plus une réponse libre.
_Avoid_: encadré de suggestions, bouton dans le chat

**Bouton du tableau de bord** :
Un bouton du panneau d'un mod (flow-board, git-board) qui prépare ou lance une action. Ce qu'il porte n'est jamais redemandé par une question à boutons.
_Avoid_: bouton du panneau, bouton flow

**Bandeau** :
La ligne qu'un mod garde au-dessus du prompt, toujours visible, qui résume son état et ouvre son panneau.
_Avoid_: bandeau du haut, barre

**Bouton de l'étape suivante** :
Le bouton qui propose la prochaine action à faire, le même dans le panneau d'un mod et dans son bandeau.
_Avoid_: bouton Ensuite, bouton suivant

**Mode auto** :
L'état d'une mission que l'utilisateur a allumé par un clic de sa part (« ⚡ Auto » puis « Confirmer » dans la mission ou sur sa ligne de la vue Coordination du COO, ou « Lancer en auto » chez le COO) : la mission avance sans lui jusqu'au rapport du compte rendu, le mod envoyant lui-même chaque suite, et Claude prenant ses propres recommandations. Il vaut pour cette mission seulement, depuis la discussion où il a été allumé ; l'utilisateur le coupe à tout moment (« ⚡ Couper l'auto » dans la mission, « ✋ Couper l'auto » sur sa ligne de la vue Coordination), le COO peut le couper sans jamais l'allumer, et le mod le met en pause dans certains cas (une lecture ratée ; plus rien qui puisse avancer sans l'utilisateur, seule pause qui reprend alors d'elle-même, une fois ses questions répondues). Une mission qui n'est pas en auto est en manuel.
_Avoid_: pilote automatique, mode autonome

**Choix d'expérience** :
Une décision sur ce que l'utilisateur voit et fait (mise en page, maquette, libellés, boutons, notifications), ou toute question où les options se valent techniquement et ne diffèrent que par sa préférence. En mode auto, c'est la première des décisions qui restent des questions bloquantes.
_Avoid_: choix de goût, choix perso

**Question bloquante** :
Une décision qui reste à l'utilisateur même en mode auto, déclarée avec ce qu'elle bloque (une phase, un groupe ou un ticket) : seule cette partie de la mission l'attend, le reste avance. Elle se retire une fois répondue.
_Avoid_: question en attente, blocage

**Validation sautée** :
Une validation à boutons (accord du cadrage, spec, découpage, plan, écritures Asana de la mission) que le mode auto ne demande pas, déclarée dans « Décidé sans toi » avec le chemin ou le lien du texte validé, pour que l'utilisateur la relise au rapport.
_Avoid_: validation automatique, accord implicite

## Lots de tickets

**Lot** :
Les tickets qu'une mission implémente. Il se répartit en groupes confiés à des workers ; un lot qui n'aurait qu'un groupe est fait par le manager lui-même, de la même façon qu'un worker ferait ce groupe.
_Avoid_: liste de tickets, file, groupe

**Groupe** :
Des tickets qui partagent un contexte (mêmes fichiers, ou une chaîne de dépendances), confiés ensemble à un worker. Un lot qui n'en aurait qu'un n'a pas de groupe.
_Avoid_: lot, paquet, équipe

**Vague** :
Un ensemble de groupes qui peuvent tourner en même temps, chacun dans son worker.
_Avoid_: niveau, étape

**Retenue** :
L'attente imposée à un groupe qui touche un fichier déjà touché par un groupe en cours d'une autre mission : il ne part qu'une fois ce groupe fusionné, ou si l'utilisateur force son lancement.
_Avoid_: blocage, conflit, verrou

**Piste** :
Une amélioration qu'une rétro propose pour les prochaines sessions. Une fois choisie, elle entre dans un ticket, seule ou avec des pistes voisines, et se traite comme lui. Une piste déjà choisie par une autre mission y reste ; la seconde rétro la marque « déjà prise ».
_Avoid_: amélioration, correction de rétro

**Liste d'attente des rétros** :
Les pistes de toutes les rétros d'un projet, en un seul endroit, chacune avec son état (pas encore validée, validée, écartée, en ticket, en exécution, faite) et les fichiers qu'elle touche. Une piste n'en sort jamais : elle change d'état, et une piste en exécution ne change plus.
_Avoid_: backlog des rétros, file des pistes

**Groupe rendu** :
Un groupe dont le worker a rendu son compte rendu, et dont le manager a vérifié le travail et rendu les statuts au tableau de bord.
_Avoid_: groupe fini, groupe revenu

**Groupe clos** :
Un groupe rendu dont la branche est fusionnée dans la branche de travail, la revue faite, la sécurité tranchée (jugée inutile, ou chaque faille gardée corrigée ou laissée par l'utilisateur), et qui n'a plus de question en attente de l'utilisateur.
_Avoid_: groupe totalement fini, groupe terminé

**Fermer un groupe** :
Arrêter le worker d'un groupe clos et retirer son worktree ; sa conversation reste, et sa branche jusqu'à la validation du compte rendu de la mission, qui la supprime par `git branch -d` si elle est notée sous un nom de son worker et contenue dans la branche de travail. Le worker des pistes d'une rétro se ferme de même.
_Avoid_: archiver le groupe, nettoyer le groupe

**Affectation** :
L'envoi d'un groupe ou de pistes à un worker, de son lancement à sa fermeture, avec les envois précédents.
_Avoid_: lien, délégation, envoi (pour l'ensemble)

**Relais** :
Ce qu'un worker transmet à son manager pendant qu'il tourne : avancement, revues, compte rendu.
_Avoid_: retour, remontée

**Tâche de jugement** :
Une tâche dont la difficulté est de comprendre ou de définir, pas de produire le changement. Deux sortes : le *jugement sur un existant* (intervenir dans ce qui marche déjà, en tenant compte de ses contraintes implicites : ce dont d'autres dépendent, ce qui ne doit pas bouger, ce que la demande ne dit pas) et l'*objectif ouvert* (le but est donné sans le chemin, et le résultat ne se vérifie pas tout de suite).
_Avoid_: tâche difficile, tâche large

**Tâche d'exécution** :
Une tâche à la consigne explicite, dont le résultat se vérifie tout de suite : on sait déjà quoi faire.
_Avoid_: tâche simple

**Worker autonome** :
Un worker de groupe qui tranche lui-même ses choix de conception hors zone sensible et les déclare, au lieu d'attendre la réponse de l'utilisateur : celui lancé pour une tâche de jugement, sur Opus xhigh (sécurité, document lu par d'autres, design) ou en worker Fable (jugement de code), et, quel que soit son effort, celui d'une mission en mode auto, qui tranche aussi un choix en zone sensible quand la recommandation respecte l'invariant déjà validé (quand il y en a un) et qu'elle est la plus prudente.
_Avoid_: session autonome, mode xhigh, session xhigh

**Worker Fable** :
Un worker de groupe dont le fil principal tourne sur Fable 5.2 high par son mod, d'après la marque `"model": "fable"` que son brief lui fait poser dans sa délégation ; lancé pour un jugement de code, sur la réponse « Fable 5.2 high » à la question d'effort ou par le bouton « ↗ Fable », il part sur Opus, est un worker autonome, et confie toutes ses revues à un relecteur Opus.
_Avoid_: session Fable, worker sur Fable

**Relecture du fond et de la forme** :
La relecture d'un document par quelqu'un d'autre que son auteur, pour le lecteur visé : ce qu'il dit (exact, complet) et comment il le dit (structure, clarté, ton).
_Avoid_: relecture, revue de doc


**Niveau de sensibilité** :
La place d'un ticket selon ce que coûterait un défaut : *non sensible*, *sensible* (confidentialité, chiffrement, commande ou chemin construit à partir d'une valeur lue ailleurs) ou *très sensible* (suppression de données, ou plusieurs sessions qui écrivent les mêmes données). Il décide des revues du ticket.
_Avoid_: ticket critique, ticket à risque

**Invariant** :
La phrase, fixée avec l'utilisateur, de ce que les données gardées d'un ticket très sensible ne doivent jamais devenir, quoi qu'il arrive.
_Avoid_: règle du ticket, garantie

**Passe « bogues »** :
La revue d'un ticket sensible ou très sensible qui cherche ce qui peut casser, et d'abord ce qui viole son invariant.
_Avoid_: revue de bogues, bug pass, chasse aux bogues

**Axe Spec** :
La vérification qu'un ticket fait ce qu'il promet, critère par critère.
_Avoid_: revue de conformité, relecture du ticket

**Axe Standards** :
La vérification qu'un ticket respecte les règles de code écrites du projet.
_Avoid_: revue de style, relecture du code

**Classe de défaut** :
Une sorte de défaut qui peut se répéter à plusieurs endroits du code (par exemple une date relue sans borne) ; dès qu'un constat nomme d'autres endroits (« même défaut dans X »), ou quand elle revient une deuxième fois, elle se cherche par son motif et ses variantes et se corrige partout d'un coup.
_Avoid_: bogue récurrent, famille de bogues