# flow-board

Tableau de bord en direct du workflow [mattpocock-skills](https://github.com/mattpocock/skills) dans Claude Code. Il suit chaque travail sous la forme d'un **parcours**, de l'idée jusqu'à la pull request, et l'affiche dans un panneau et dans un bandeau au-dessus du prompt.

- **Il s'adapte au skill de départ.** `/grill-with-docs`, `/to-spec`, `/diagnosing-bugs`, `/wayfinder` ou `/implement` n'ouvrent pas le même parcours.
- **Il se remplit tout seul.** Il suit les skills chargés, les tickets Asana, les sous-agents, les tests, les commits et les livrables.
- **Il garde les parcours par projet.** Plusieurs discussions peuvent travailler sur le même projet sans se marcher dessus.
- **Il suit les conventions de livraison du plugin `project`** : `/project:sync`, `/project:version`, `/project:push`, `/project:pr`.

Version actuelle : **0.48.0**. Historique des versions : [CHANGELOG.md](CHANGELOG.md).

---

## Sommaire

1. [Installation](#installation)
2. [Concepts](#concepts)
3. [Utilisation](#utilisation)
4. [Parcours par skill de départ](#parcours-par-skill-de-départ)
5. [Ce qui est suivi automatiquement](#ce-qui-est-suivi-automatiquement)
6. [Tickets, dépendances et lancement](#tickets-dépendances-et-lancement)
7. [Livraison et synchronisation](#livraison-et-synchronisation)
8. [Plusieurs discussions sur un même projet](#plusieurs-discussions-sur-un-même-projet)
9. [Commandes](#commandes)
10. [Données et stockage](#données-et-stockage)
11. [Architecture](#architecture)
12. [Développement](#développement)
13. [Limites connues](#limites-connues)

---

## Installation

Le mod est distribué par la marketplace `mathis-plugins` (dépôt GitHub `matwi5/mathis-plugins`, source dans `plugins/flow-board/`). Installation d'un poste et protocole de développement : README à la racine du dépôt.

```bash
claude plugin marketplace update mathis-plugins
claude plugin install flow-board@mathis-plugins
```

Pour une nouvelle version : modifier la source dans le clone de travail (`~/.claude/mathis-plugins/plugins/flow-board`), monter `version` dans `.claude-plugin/plugin.json` et dans l'entrée du mod de `.claude-plugin/marketplace.json` à la racine du dépôt, commiter et pousser, puis :

```bash
claude plugin marketplace update mathis-plugins
claude plugin update flow-board@mathis-plugins
```

Une mise à jour s'applique aux discussions démarrées après elle, ou après `/reload-plugins`.

**Prérequis**
- Claude Code avec les *function hooks* : mods de la version 2.1.286 ou plus récente.
- Le plugin `mattpocock-skills`, fourni par cette marketplace en copie figée (`plugins/mattpocock-skills`, version 1.3.1 de Matt Pocock).
- Facultatifs :
  - le plugin `project`, pour la phase de livraison ;
  - le connecteur Asana, pour suivre les tickets ;
  - un dépôt git avec un distant, pour la synchronisation.

**Sessions liées : Desktop et CLI** (depuis la 0.35.0). Les boutons « session liée » mettent dans le prompt une demande valable dans les deux ; Claude choisit selon ses outils :

| | App Desktop (onglet Code) | CLI |
|---|---|---|
| Lancement | `start_session` (`context` « fresh », `wake_when_done`) | `claude --bg -n "<titre>"` par le shell, avec `-w <nom>` dans un dépôt git |
| Id relevé | dans la réponse de `start_session` (`local_…`) | dans la sortie « backgrounded · <id> · <titre> » |
| Note de fin | l'app relance la discussion principale quand la fille finit un tour | la fille envoie son compte rendu par `SendMessage` au nom de la discussion principale, ce qui la réveille même inactive ; le brief donne ce nom et la référence stable de la discussion (« <nom> [ref] », lue dans `ListAgents`) : si le nom ne répond plus (discussion renommée), la fille relit `ListAgents` et envoie à la ligne de cette référence, sous son nom du moment (depuis la 0.45.0) ; `notify_when_idle` en filet dans le CLI seulement, inopérant dans l'app Desktop (depuis la 0.48.0) |

Côté CLI, le dossier doit avoir été approuvé dans le CLI (sinon « Workspace not trusted ») ; la combinaison `--bg` + `-w` n'a pas pu être essayée (à confirmer). Les deux discussions doivent être sur la même machine : le fichier des parcours est local.

---

## Concepts

| Terme | Définition |
|---|---|
| **Parcours** | Un travail suivi de bout en bout. Le skill qui l'ouvre fixe ses phases. Un parcours est **en cours**, **en pause** ou **terminé**. Un parcours **mis de côté** est en pause par ta décision : seul « Reprendre » le rouvre. |
| **Phase** | Une étape du parcours, tenue par un skill : Cadrage, Spec, Tickets, Implémentation, Version et push, Pull request… Certaines phases sont facultatives (en pointillé). |
| **Étape** | Une étape interne au skill de la phase. Par exemple, pour `/diagnosing-bugs` : boucle de feedback, reproduire, hypothèses, instrumenter, correctif, nettoyage. Une étape enjambée sans être faite est marquée *sautée*. |
| **Détour** | Un skill lancé hors du fil du parcours (`/prototype`, `/research`, `/handoff`…), affiché en bulle au-dessus de la phase en cours. |
| **Ticket** | Une unité de travail du lot, identifiée par son GID Asana, avec son statut et ses dépendances. |
| **Dépendance externe** | Une tâche hors du lot dont un ticket dépend : une décision à prendre, ou le travail de quelqu'un d'autre. |
| **Décidé sans toi** | Un choix que Claude a fait sans que la personne l'ait demandé ni validé : ticket traité hors de la file, approche choisie parmi plusieurs, travail reporté, périmètre changé. Il reste « à relire » jusqu'à « ✓ Relu ». |
| **Trouvé en route** | Une tâche créée dans le tracker pendant le parcours, hors du lot : constat de revue, anomalie découverte, action pour la personne. Elle s'affiche à part, sans compter dans la progression ni retenir la livraison. |

---

## Utilisation

Dès le début d'une discussion, sans parcours actif, un bandeau d'accueil d'une ligne dit « Aucun workflow sélectionné ». Si le projet a un parcours en pause ou suivi dans une autre discussion, il propose le plus récent, avec son glyphe, son titre et un bouton « ↻ Reprendre ». Le « x » et `/flow hide` le masquent comme le bandeau normal.

Le bandeau s'ouvre sur l'étiquette « ▍ Flow », comme ceux de git-board et d'asana-board ; il tient sur une ligne (depuis la 0.40.0). Empilé sous le bandeau d'un autre mod, il se place juste en dessous.

1. **Lancer un skill mattpocock**, par exemple `/mattpocock-skills:grill-with-docs export CSV`. Le parcours démarre et le panneau s'ouvre tout seul quand la place le permet ; sinon, taper `/flow` (ou `/flow-board:flow` en tout premier message, voir [Commandes](#commandes)).
2. **Suivre l'avancement.** Le bandeau au-dessus du prompt résume, sur une ligne :
   - le parcours et sa feuille de route ;
   - la phase en cours ;
   - les tickets faits, et l'avancement de chaque groupe en session liée (« ↗A 2/5 ») ;
   - les sous-agents au travail, et les choix « ⚑ à relire ».
   L'état de la session (« Claude travaille », « À toi de jouer ») et l'étape sont dans l'en-tête du panneau (`/flow`), plus dans le bandeau (depuis la 0.40.0).
3. **Passer à la suite.** La carte « Prochaine étape » propose le skill suivant. Son bouton met la commande dans le prompt sans la lancer : on la complète, puis Entrée. Tant que des tickets restent ouverts, ni le compte rendu ni la livraison (version, push, pull request) n'y sont proposés. Dans l'Implémentation d'un parcours à groupes (depuis la 0.42.0), la carte « Ensuite » recommande plutôt quoi lancer : le lot de groupes indépendants en parallèle (« ⇉ B ∥ C en parallèle · sessions liées »), sinon le prochain groupe prêt (« ↗ Groupe D · session liée », ou « ▶ Lancer D ici »), le groupe commencé ici d'abord. Un groupe prêt qui partage un fichier ou une ressource avec un groupe en session liée attend : la carte dit alors quel groupe on attend. Une fois tous les tickets faits, elle dit quels groupes attendent leur revue ; les revues restent sur la ligne de chaque groupe, et le compte rendu vient en tête une fois toutes faites.

   **Suggestion grisée de la suite** (depuis la 0.47.0). À la fin de chaque tour de la discussion principale, la commande du bouton principal de la carte (par exemple `/mattpocock-skills:to-tickets`, ou `/flow-board:compte-rendu` une fois tous les tickets faits et relus) se propose en gris dans le prompt vide : Tab (ou la flèche droite) la prend, rien ne part sans toi. Rien n'est proposé quand une question t'attend (question du grilling, réponse qui finit par « ? »), dans une session liée, quand la suite n'est pas une commande (lancer un groupe, attendre une session liée, revue sur la ligne d'un groupe) ni pour la rétro d'un parcours à sessions liées, qui part avec sa consigne. Tant qu'un parcours est actif, la suggestion `/project:push` de git-board est écartée (pas de push en cours de parcours) ; elle revient hors parcours.

### La barre « À tout moment »

En bas de l'onglet Parcours, qu'un parcours soit en cours ou non, un cadre « À tout moment » réunit neuf outils dans l'ordre où on s'en sert, et un dixième pendant les phases de code et de revue. Chaque bouton met la commande dans le prompt sans la lancer, et aucun ne clôt la phase en cours (ce sont des détours ou des événements).

| Famille | Bouton | Commande | Ce qu'il fait |
|---|---|---|---|
| Comprendre | ? Reformulation | `/wait-what` | Le dernier message reformulé, plus simplement ; part tel quel |
| Comprendre | ✧ Recherche | `/research` | Sources primaires, un rapport Markdown ; ajouter le sujet |
| Comprendre | ✦ Tester une idée | `/prototype` | Une question de conception qu'on ne tranche pas en discutant (une logique, un modèle d'états, une interface), réglée par du code jetable ; souvent pendant le cadrage. Sans parcours, il ouvre le sien ; ajouter la question |
| Comprendre | ≡ Questionnaire | `/to-questionnaire` | Une décision qu'on ne tranche pas seul, mise en questionnaire ; ajouter le sujet |
| S'orienter | ✱ Et maintenant ? | `/ask-matt` | Quelle suite, quand on est perdu. Pendant un parcours, la question est préremplie avec le parcours, la phase, l'étape et le détour en cours ; sans parcours : « par où commencer ? ». Part telle quelle, ou complétée |
| S'orienter | ◇ Challenger | `/grilling` | Une décision ou un plan mis à l'épreuve par des questions, sans quitter la phase ; ajouter le sujet |
| S'orienter | § Préciser un terme | `/domain-modeling` | Un terme flou ou une règle métier précisés par des questions (écarts avec le glossaire, cas limites, contradictions avec le code), puis écrits dans le glossaire ou, pour une décision difficile à défaire, dans les décisions du projet. Le cadrage l'appelle déjà : le bouton sert surtout en implémentation ; ajouter le sujet |
| Contexte | ⇣ Compact | `/compact` | Commande de Claude Code qui allège le contexte ; consignes facultatives |
| Contexte | ➜ Passation | `/handoff` | La discussion résumée en document de passation pour une autre session ; ajouter son but |
| Déléguer | 🐞 Bug · session liée | `/diagnosing-bugs` | Depuis la 0.26.0, seulement pendant Implémentation, Implémentation de spec, TDD, Revue ou Compte rendu. Met dans le prompt une demande à Claude, à compléter après « Bug : ». Claude lance une session liée dans ce dossier (pas de worktree : elle doit lire le même fichier de parcours), qui reprend le parcours (`resume`), diagnostique le bug en détour de la phase en cours, le corrige selon le `CLAUDE.md` du projet, puis clôt le détour (`complete`). À sa note de fin, Claude vérifie son travail et reprend le parcours |

### Le panneau

| Onglet | Contenu |
|---|---|
| **Parcours** | En-tête du parcours choisi dans la discussion (anneau de progression, feuille de route animée) ; sans parcours choisi (aucun, mis de côté, en pause ou suivi ailleurs), l'en-tête dit « Aucun parcours sélectionné » et n'en montre aucun, carte de la phase (tickets en cours, étapes, éléments suivis, tickets, tests, revue, détour), sous-agents, prochaine étape, « ‖ Mettre de côté ». Sans parcours en cours, le lanceur « Démarrer un parcours », dans l'ordre du flux : Cadrer une fonctionnalité, Rédiger la spec de ce qu'on a discuté, Découper un plan en tickets, Implémenter un ticket ; puis Diagnostiquer un bug, Relire une branche ou une PR, Trier les issues, Explorer un grand chantier, Santé de l'architecture. En bas, toujours, la barre « À tout moment ». |
| **Activité** | Chiffres (fichiers, commits, merges, termes du glossaire, ADR, tests), livrables écrits, journal des événements. |
| **Historique** | Les parcours du projet, avec « Reprendre », « Reprendre ici » et « ▣ Archiver ». Les archivés sont cachés par défaut, sous « ▸ Archivés (N) », avec « ▢ Désarchiver » et « ✗ Supprimer ». La suppression demande une confirmation (« Supprimer définitivement ce parcours ? ») et ne se défait pas ; les autres discussions du projet l'oublient aussi. |
| **Commandes** | Les points de départ, les 18 autres skills groupés par famille, les commandes de livraison et les commandes `/flow`. |

Les dessins (feuille de route, anneaux, barres) sont en SVG sur le desktop, VS Code et le mobile, et en glyphes sur le terminal.

---

## Parcours par skill de départ

| Skill de départ | Parcours | Phases |
|---|---|---|
| `/grill-with-docs` | Nouvelle fonctionnalité | Cadrage → Spec¹ → Tickets¹ → Implémentation → Compte rendu → Version et push¹ → Pull request¹ |
| `/to-spec` | De la spec au code | Spec → Tickets → Implémentation → Compte rendu → Version et push¹ → Pull request¹ |
| `/to-tickets` | Des tickets au code | Tickets → Implémentation → Compte rendu → Version et push¹ → Pull request¹ |
| `/implement`, `/implement-spec` | Implémentation | Implémentation → Compte rendu → Version et push¹ → Pull request¹ |
| `/diagnosing-bugs` | Chasse au bug | Diagnostic → Revue¹ → Compte rendu → Version et push¹ → Pull request¹ |
| `/tdd` | TDD | TDD → Revue¹ → Compte rendu → Version et push¹ → Pull request¹ |
| `/triage` | Triage | Triage → Implémentation¹ → Compte rendu² → Version et push¹ → Pull request¹ |
| `/wayfinder` | Grand chantier | Wayfinder → Spec¹ → Tickets¹ → Implémentation¹ → Compte rendu² → Version et push¹ → Pull request¹ |
| `/improve-codebase-architecture` | Santé du code | Architecture → Cadrage¹ → Spec¹ → Tickets¹ → Implémentation¹ → Compte rendu² → Version et push¹ → Pull request¹ |
| `/code-review` (Claude Code), sans parcours en cours | Relecture de branche | Relecture → Compte rendu → Version et push¹ → Pull request¹ |
| `/mattpocock-skills:code-review` | Revue de code | Revue → Compte rendu → Version et push¹ → Pull request¹ |
| `/grill-me`, `/prototype`, `/research`, `/teach`, `/wizard`… | Un parcours d'une phase | Les étapes du skill |

¹ Phase facultative.
² Facultatif tant qu'on n'a pas codé, obligatoire dès que l'Implémentation démarre (depuis la 0.30.0) : un triage ou une carte sans code se clôt sans compte rendu.

**Compte rendu.** Avant toute livraison, la phase « Compte rendu » (`/flow-board:compte-rendu`, lancé par toi) fait écrire à Claude un rapport à lire et à valider :
- sections fixes : En bref, Fait, Décidé sans toi, Ce qui s'est mal passé, Bloqué par moi, Trouvé, Documentation, Ce que la livraison enverra ; une section vide dit « Rien. » ;
- « Documentation » donne une ligne par document que le projet tient (état du projet, décisions, CLAUDE.md, specs, plans, tracker…) : à jour, complété avant le rapport, rien à changer, ou à faire. Claude complète ce qui manque avant d'écrire, et ne laisse « à faire » que ce qui demande ta décision ;
- Claude part des faits du tableau de bord (tickets, trouvailles, choix faits sans toi, plans, tests), qu'il vérifie et complète par git et le tracker ; il copie aussi le rapport dans le fichier de suivi `travail/tasks/…` s'il y en a un ;
- toi seul valides, dans le panneau : « ✓ Valider le rapport » clôt la phase, marque les choix « décidé sans toi » comme relus et propose Version et push ; « ✎ À reprendre » met « Rapport non validé : » dans le prompt. Claude ne peut pas clore la phase, mais chaque réponse de l'outil `flow` (et de `/flow`) lui donne l'état du rapport : « rapport : validé (date UTC) », « en attente de validation », « non validé (sauté) » ou « pas encore rédigé » ;
- tant que le rapport n'est pas validé, la livraison n'est pas proposée ; lancer `/project:version` quand même saute le compte rendu, et le journal le dit.

Les parcours existants reçoivent la phase à leur chargement, avant leur « Version et push » à venir.

Un parcours en plusieurs groupes passe souvent par plusieurs discussions ; le compte rendu se rédige dans la dernière. Il couvre quand même tous les groupes : le tableau de bord, partagé, lui donne l'état de chaque groupe (fait, relu) et la liste des fichiers de suivi `travail/tasks/…`, un par discussion, enregistrés comme livrables « Suivi » avec leur groupe. Claude les relit tous, avec `git log` depuis le début du parcours, et écrit « Fait » groupe par groupe.

La rétro (`/retro`) n'est pas une phase : elle reste proposée à tout moment dans la carte « Ensuite ». Un parcours créé par une version antérieure est mis à niveau à son chargement : sa rétro à venir disparaît, et un « Corps de PR » à venir devient « Version et push » puis « Pull request ».

**Rétro d'un parcours à sessions liées** (depuis la 0.43.0). Quand le parcours a eu des sessions filles (un groupe confié ou rendu, des pistes confiées), le bouton Rétro, dans la carte « Ensuite » comme dans « Autres commandes », met dans le prompt `/retro` suivi d'une demande à Claude, dans la discussion principale (la session mère) :
- retrouver les sessions filles par ListAgents, d'après le début de leur titre (« <parcours> › ») et les ids relevés à leur lancement ;
- lancer un sous-agent par session fille, en parallèle et en lecture seule : chacun lit le transcript de sa session et en fait la rétro selon les étapes et les sept axes de `/retro`, que la mère lui transmet, puis rend ses pistes par sévérité. Le transcript se lit même quand la session fille est fermée ou compactée, et la discussion principale ne se charge pas de sa lecture ;
- faire en même temps la rétro de la discussion principale ;
- une fois tous les comptes rendus reçus, faire le compte rendu global : pistes fusionnées et sans doublon, par sévérité, chacune avec ses sessions d'origine. Cette liste devient les pistes de la rétro au tableau de bord.

Sans session fille, le bouton met `/retro` seul. Une session de diagnostic de bug ne laisse pas de trace dans le parcours : elle n'est retrouvée que par son titre, si le parcours a aussi eu une autre session fille.

**Pistes de la rétro en session liée** (depuis la 0.33.0). Une fois les pistes présentées, chacune a sa case (○ / ●) dans la carte de la phase, avec « Tout sélectionner » au-dessus de la liste. Avec au moins une piste choisie, « ↗ Traiter N pistes · session liée » :
- passe les pistes choisies « en cours » et ouvre l'étape « Modifications en cours », la dernière de la rétro ;
- met dans le prompt une demande à Claude, qui rédige lui-même le brief, puisque les pistes n'ont qu'un libellé et que lui connaît la session étudiée :
  - d'abord, régler avec toi les pistes qui attendent une information ou une décision de ta part (un accès, un choix entre options), sinon la session y buterait ;
  - lancer la session par `start_session` avec `context` « fresh » (une discussion de rétro est longue : un fork la transporterait toute), `wake_when_done` et un worktree, ou le dossier lui-même s'il n'a pas de git ; dans le CLI, par `claude --bg` (voir « Sessions liées : Desktop et CLI ») ;
  - un background : le projet, la session étudiée, les décisions déjà prises, les contraintes (ressource unique comme une appli ouverte, écritures autorisées, gestes qui te sont réservés) ;
  - une section par piste : le problème constaté, la correction attendue, les fichiers touchés, un critère de fin vérifiable ;
  - un travail en séquence, les pistes qui touchent les mêmes fichiers regroupées, sans sous-agents qui écrivent (en parallèle, seulement des recherches en lecture seule) ; les contrôles du `CLAUDE.md` du projet à la fin ; rien sur le tableau de bord ;
  - un compte rendu final : une ligne par piste (faite, ou pas faite et pourquoi), les fichiers modifiés, les contrôles et leur résultat, ce qui t'attend ;
- **le parcours reste dans la discussion principale** : la session liée ne le reprend pas. Claude la suit d'ici ; à sa note de fin, il vérifie son travail, rend le statut de chaque piste (faite ou écartée), puis clôt la rétro. Tant que des pistes sont chez la session, la rétro ne se clôt pas.

La carte suit l'envoi : « ↗ Session liée à lancer » tant que la demande n'est pas partie (avec « Annuler », qui remet les pistes à faire), puis « ↗ Session liée au travail · 3 pistes en cours » une fois la session lancée (son id est relevé dans la réponse de `start_session`, ou dans la sortie de `claude --bg` ; les pistes ne bougent qu'à sa note de fin, d'où « en cours » plutôt qu'un compteur à 0), puis « ✓ Session liée terminée ». Si la session s'arrête sans note de fin, « ↻ Reprendre les pistes » (proposé dès l'envoi, même sans id relevé) met dans le prompt une demande à Claude : vérifier son état et son travail, puis rendre chaque piste (faite ou écartée). Pendant ce temps, l'en-tête dit « Session liée au travail » au lieu de « À toi de jouer ». Les pistes restantes peuvent partir dans un envoi suivant. Une rétro ouverte avant la 0.33.0 reçoit l'étape au premier envoi.

**Comment un skill s'insère dans le parcours en cours**
- Un skill **déjà prévu** dans le parcours fait avancer celui-ci jusqu'à sa phase.
- Un **sous-skill** déclaré par la phase fait avancer l'étape correspondante, par exemple `/tdd` pendant `/implement`.
- Un skill **hors du fil** devient un détour.
- Un **autre point de départ** ouvre un nouveau parcours et met le précédent en pause. Le parcours en pause reprend tout seul quand on relance un de ses skills, sauf s'il a été **mis de côté** (voir plus bas) : le skill ouvre alors un nouveau parcours.
- Exception : `/diagnosing-bugs` pendant Implémentation, Implémentation de spec, TDD, Revue ou Compte rendu devient un **détour** (liste `detourIn` du catalogue). Le bug reste dans le lot qui l'a fait apparaître. Ailleurs (cadrage, spec…), il ouvre toujours sa « Chasse au bug ».

---

## Ce qui est suivi automatiquement

| Signal | Effet |
|---|---|
| Chargement d'un skill mattpocock | Démarrage, avancée ou détour du parcours ; une note ajoutée au texte du skill donne à Claude les identifiants d'étapes à signaler. |
| Outil `mcp__flow-board__flow` | Comptes rendus de Claude : titre, étape, éléments suivis (hypothèses, décisions, variantes…), tickets, dépendances, note, fin de phase. Depuis la 0.47.0, chaque appel tient dans la conversation sur une ligne grisée qui dit ce qu'il enregistre (« flow-board · étape review · 2 tickets faits »), sans son JSON ni sa réponse ; un appel en erreur ou interrompu garde le dessin de Claude Code. |
| Sous-agents (`Agent`, `SubagentStop`) | Carte des sous-agents : rôle déduit, modèle, durée, état. |
| Commandes shell | Tests (rouge ou vert, cycles TDD), contrôles, commits, branches, worktrees, merges, `git push`, `gh issue` et `gh pr`. Les commandes sont lues segment par segment : `grep "git commit"` ne compte pas comme un commit. |
| Fichiers écrits | Livrables du workflow : glossaire, ADR, spec et tickets `.scratch/`, plans de `docs/plans/` (avec le ticket que le plan cite en tête), rapport d'architecture, questionnaire, leçons, configuration. Les fichiers hors du projet sont ignorés. |
| Asana (`update_tasks`) | Ticket coché ou ligne « Statut : » (en cours, en attente, à trancher), et levée des dépendances externes. Pour un blocage, le texte de la ligne devient sa raison. |
| Asana (`create_tasks`), `gh issue create` | Hors des skills qui publient le lot (`/to-tickets`, `/to-spec`, `/triage`, `/wayfinder`), la tâche créée va dans « Trouvé en route », avec le statut de sa ligne « Statut : ». |
| Réponses de Claude | Questions du grilling (`❓ **Qn**`) ; une synthèse de revue (`## Standards`) fait avancer l'étape. Les chiffres de revue viennent du champ `review` de l'outil, que Claude remplit après chaque revue : la carte affiche le nombre de revues, les constats (Standards, Spec) et les corrigés, cumulés sur la phase. |

---

## Tickets, dépendances et lancement

**Tickets**
- Les tickets sont identifiés par leur GID Asana, avec un lien « Asana ↗ ».
- Une liste envoyée par Claude **ajoute ou met à jour** des tickets, sans jamais en retirer.
- Un ticket envoyé par erreur se retire explicitement (`remove`) : il quitte aussi les groupes, la file et les dépendances des autres tickets.
- Une discussion sans parcours actif n'enregistre rien tant que le projet a un parcours en pause ou suivi ailleurs : l'outil renvoie à Claude la liste de ces parcours, et `/flow` les nomme, pour qu'on reprenne le bon avec « ↻ Reprendre ici » au lieu d'ouvrir un autre lot.

**Ouvrir ou corriger un parcours sans skill (depuis la 0.32.0)**
- Quand tu le lui demandes (« fais un parcours pour ces trois tickets »), Claude ouvre un parcours par l'outil, champ `open` (`{"title": "…", "entry": "implement"}`), même si un autre est actif dans la discussion. L'autre est mis en pause avec ses tickets, comme quand un autre skill de départ ouvre un parcours (son détour en cours se clôt, et il est terminé s'il ne lui reste rien d'obligatoire) ; tout le reste du même appel (tickets, groupes…) va au nouveau. `entry` donne la forme du parcours (un skill de départ : `implement` par défaut, `to-tickets`, `grill-with-docs`, `diagnosing-bugs`…).
- Il corrige le parcours actif par `fix` : le titre, même déjà posé ; la phase en cours, en arrière (les phases d'après redeviennent à faire) comme en avant (celles d'avant sont closes ou sautées, et un compte rendu non validé passe « sauté », jamais « fait ») ; l'étape, en arrière comprise. Les tickets et les groupes se corrigent par `tickets`, `set`, `remove` et `groups`. Un `title` simple ne remplace toujours pas un titre posé.
- La description de l'outil le borne : seulement à ta demande ou pour réparer une erreur, jamais de sa propre initiative. Sans parcours actif, la réponse de l'outil nomme les parcours à reprendre et rappelle que `open` n'est qu'à ta demande. Pour sortir des tickets d'un mauvais parcours, Claude envoie `remove` dans un appel d'abord, puis `open`.

**Mettre de côté (depuis la 0.32.0)**
- « ‖ Mettre de côté », sous la carte « Ensuite », ou `/flow pause` : le parcours actif passe en pause tel quel (étapes, détour, tickets en cours), sans être clos même si tout est fait, ni archivé, et la discussion n'en a plus d'actif. Tu peux alors en ouvrir un autre.
- Il s'affiche « ‖ mis de côté » dans l'Historique. Seuls « ↻ Reprendre » (Historique, bandeau d'accueil) et le champ `resume` de l'outil le rouvrent, dans l'état où tu l'as laissé ; relancer un de ses skills ouvre un nouveau parcours au lieu de le reprendre.
- Un rapport de l'outil sans parcours actif n'écrit rien dessus : Claude reçoit sa liste avec l'état « set aside by the user » et te demande lequel reprendre.

**Tickets en cours en parallèle (depuis la 0.32.0)**
- Plusieurs tickets peuvent être « en cours » à la fois : les sous-agents de `/implement-spec`, ou un ticket laissé en cours par une autre discussion. Depuis la 0.40.0, ils se lisent dans leur groupe (« ◉ en cours »), et un ticket porté par une autre discussion le dit sur sa ligne (« ⇆ autre discussion »). Pendant l'Implémentation, la carte de la phase ne les répète plus à part, et le bandeau ne les nomme plus.
- Le ticket retient la discussion qui l'a passé « en cours » (champ `by`), et l'oublie quand il en sort. Un ticket qui rejoint d'autres tickets déjà en cours ne remet pas les étapes à zéro ; un ticket qui en suit un autre, si.

**Dépendances**
- À la fin de `/to-tickets`, Claude envoie pour chaque ticket la liste des tickets qui le bloquent (`blockedBy`).
- Il signale aussi les dépendances hors du lot (`externals`), de type décision ou tâche. Une décision attendue s'affiche « ⚖ Décision à prendre ».
- Une dépendance externe se lève quand la tâche est cochée dans Asana. Un bloqueur inconnu du parcours bloque par prudence.
- Un ticket qui n'attend que d'autres tickets reste « à faire » et s'affiche « ⏸ en attente ». Le statut « bloqué » est pour une attente hors du lot (une décision ou un accord de la personne, un accès, le travail de quelqu'un d'autre) : Claude en donne la raison (`why`), affichée sous le ticket (« ! attend : ton accord sur le plan »). Un ticket bloqué sans raison derrière un ticket ouvert s'affiche en attente ; sans raison ni ticket ouvert, « raison non précisée ».

**Décidé sans toi**
- Chaque fois que Claude fait un choix que tu n'as ni demandé ni validé, il le signale (`decided`, avec sa raison). La règle est dans la description de l'outil, donc toujours connue de Claude.
- La carte de la phase l'affiche en haut, sous « ⚑ Décidé sans toi », et le bandeau compte « ⚑ N à relire ».
- « ✓ Relu » marque tout comme relu : les choix relus se replient en une ligne (« 17 relus »), que « ▸ voir » déplie ; le journal de l'onglet Activité les garde.

**Trouvé en route**
- Les tâches créées pendant le parcours (constats de revue hors du ticket, anomalies, actions pour la personne) s'affichent sous les tickets, dans « Trouvé en route » : l'état en glyphe de tête, la raison d'un blocage, « pour toi » quand la tâche est assignée, le lien Asana. Celles qui t'attendent (bloquées, ou assignées à toi) viennent en tête et restent toujours visibles ; les autres s'affichent jusqu'à 4, le reste derrière « ▸ N de plus ». « × masquer » réduit toute la liste à son titre et ses comptes ; « ▸ afficher » la rouvre.
- Elles ne comptent pas dans la barre des tickets et ne retiennent pas la livraison.
- Claude fait entrer dans le lot celles dont le lot dépend, en les envoyant dans `tickets` avec leurs `blockedBy` ; elles quittent alors « Trouvé en route ». `remove` en retire une.
- Les règles des statuts et des trouvailles sont dans la description de l'outil : Claude les a même quand aucun skill n'a apporté sa consigne (par exemple `/mattpocock-skills:implement` écrit au milieu d'un message, qui n'est pas lancé).

**Lancer une sélection de tickets** (par exemple depuis une nouvelle discussion)
1. Historique, puis « Reprendre » sur le parcours.
2. Dans l'onglet Parcours, choisir les tickets avec ○, dans l'ordre voulu (①, ②, ③…). Un ticket bloqué n'est sélectionnable que si ses bloqueurs sont faits, ou choisis avant lui.
3. « ▶ Implémenter N tickets » met `/mattpocock-skills:implement` dans le prompt, avec la liste ordonnée. La file est enregistrée dans le parcours, et Claude la reçoit au chargement du skill.
4. Le bouton « ⇉ En parallèle · /implement-spec » est proposé quand les phases Spec et Tickets du parcours sont faites, ou dès que deux groupes prêts peuvent avancer en parallèle (voir plus bas), et seulement dans un dépôt git. Sans spec, le prompt précise à `/implement-spec` que les tickets et leurs dépendances suffisent.

**Groupes et vagues**

À la fin de `/to-tickets`, Claude regroupe les tickets selon leur contexte (`groups`). Il y a trois façons d'exécuter un groupe :
- **en séquence, avec `/implement`** : les tickets d'un groupe touchent les mêmes fichiers ou s'enchaînent par leurs dépendances ; une discussion les fait d'affilée, en profitant du contexte déjà chargé ;
- **dans une session liée** (depuis la 0.34.0, partout) : Claude lance une session qui fait le groupe avec `/implement`, et le parcours reste dans la discussion principale ; plusieurs groupes indépendants peuvent ainsi avancer en même temps, une session chacun ;
- **en parallèle, avec `/implement-spec`** (dépôt git seulement) : des groupes de contextes différents partent ensemble, un sous-agent par groupe, dans une seule discussion ;
- un autre contexte fait un autre groupe, et un groupe d'un seul ticket convient quand son contexte lui est propre ;
- un seul groupe au plus porte « ↩ cette discussion » : celui à qui le contexte de la discussion de découpage sert. Vu d'une autre discussion, il dit « ↩ discussion de découpage » (le mod retient la discussion qui a envoyé le plan, mais il ne connaît pas son id d'application : pas de lien cliquable).

Pour chaque groupe, Claude donne la raison du regroupement, les fichiers touchés (`files`) et, depuis la 0.34.0, ses **ressources** (`resources`) : ce qu'il ne peut pas partager avec un autre groupe qui travaille en même temps, comme une application pilotée à l'écran (« PowerBI Desktop »), une base, un appareil ou un compte uniques. Chaque ticket peut aussi porter ses propres fichiers (`files`), lus dans ses critères d'acceptation : ils s'ajoutent à ceux de son groupe tant qu'il est ouvert. Quand un groupe déclare un dossier qui contient un fichier nommé par un autre groupe, la réponse de l'outil le signale à Claude : un dossier bloque tous ceux qui touchent un fichier dedans. Une nouvelle liste de groupes remplace la précédente, en gardant les revues et les sessions liées de chaque groupe ; des tickets envoyés sans groupes ne la touchent pas.

Le mod en déduit le reste :

| Calcul | Règle |
|---|---|
| Attente | Un groupe attend un autre quand l'un de ses tickets a un bloqueur encore ouvert dans cet autre. |
| Vagues | Un groupe passe dès que ceux qu'il attend sont passés. Une attente circulaire met ses groupes dans la même vague, marqués « ⚠ ordre à revoir ». |
| Lot parallèle (∥) | Les groupes **prêts** (aucun bloqueur encore ouvert), **pas encore commencés** (aucun ticket en cours ni fait) et pas confiés à une session liée, pris dans l'ordre ; un groupe n'est retenu que s'il ne partage **aucun fichier ni aucune ressource** avec ceux déjà retenus ou confiés à une session liée (un dossier recouvre les fichiers qu'il contient ; les fichiers d'un groupe sont les siens et ceux de ses tickets ouverts), car un fichier ou une ressource en commun vaut une dépendance. Il faut au moins deux groupes. |
| Raisons (∦) | Un groupe prêt resté hors du lot dit pourquoi : « ∦ A : tables » (le groupe, et le fichier ou la ressource en commun). Il le dit aussi face à un groupe confié à une session liée ou en cours ici. |
| Autres lots | Chaque groupe prêt resté hors du lot principal en ouvre un autre, formé de la même façon à partir de lui (trois au plus) : « Autres lots possibles ». |
| Tickets prêts | Dans un groupe qui attend, les tickets sans bloqueur ouvert peuvent partir seuls : « ▶ Lancer le prêt ». |
| Un groupe à la fois | Tant qu'un groupe est commencé ici et pas fini, aucun lot ne part : le panneau affiche « ⇉ B ∥ C en parallèle une fois A fini ». Un groupe confié à une session liée n'occupe pas le parcours. |
| Autres | Un ticket ajouté au lot pendant qu'un groupe s'exécute rejoint ce groupe (avant le premier de ses tickets qu'il retient), sauf si Claude renvoie lui-même les groupes. Un ticket ajouté autrement, sans groupe, rejoint la chaîne dont il fait partie : le groupe des tickets qu'il retient (placé avant le premier), sinon celui des tickets qu'il attend (à la fin). Seuls les tickets qui ne tiennent à aucun groupe, ou à plusieurs, restent dans « Autres ». Claude est aussi invité à renvoyer les groupes quand il ajoute un ticket. |

Dans l'onglet Parcours, les tickets sont alors rangés par vague puis par groupe :
- « ▶ Lancer A » met `/implement` dans le prompt avec les tickets ouverts du groupe, dans l'ordre ;
- « ▶ Lancer le prêt » (ou « les N prêts »), sur un groupe qui attend, fait de même avec ses seuls tickets prêts ;
- « ↗ Session liée » (sur tout groupe prêt, celui qui continue ici compris) confie le groupe à une session liée, et « ⇉ A ∥ B en parallèle · sessions liées » confie chaque groupe du lot à la sienne. Le fonctionnement est détaillé plus bas ;
- « ⇉ A ∥ B en parallèle · /implement-spec » (dépôt git seulement) lance le lot dans cette discussion : un sous-agent implémenteur par groupe, à la place d'un par ticket comme le prévoit le skill, dans son worktree, qui traite ses tickets dans l'ordre avec un commit par ticket ; le merger fusionne sa branche quand le groupe est fini. Hors d'un dépôt git, le bouton n'apparaît pas : le skill a besoin d'une branche d'intégration et de worktrees. Les groupes qui attendaient (vague suivante) deviennent parallélisables à leur tour une fois leurs bloqueurs faits ;
- un groupe peut aussi se faire dans une autre discussion, **une fois le groupe en cours fini** : ouvrir une discussion, `/flow-board:flow`, « Reprendre ici », puis « ▶ Lancer ». Deux discussions ne suivent pas en même temps un même parcours.

**Groupes en session liée** (depuis la 0.34.0 ; avant, la session liée d'un groupe reprenait le parcours)

« ↗ Session liée » ou « ⇉ … · sessions liées » met dans le prompt une demande à Claude, et le groupe passe « ↗ session liée à lancer » (avec « Annuler »). La demande lui fait :
- régler d'abord avec la personne ce dont les sessions auront besoin (une décision, un accès, un geste qui lui est réservé) ;
- lancer une session par groupe, avec un titre de la forme « <parcours> › Groupe <id> · <thème> » : `start_session` dans l'app (`context` « fresh », `wake_when_done`, un worktree, ou le dossier s'il n'a pas de git), `claude --bg -n "<parcours> › Groupe <id> · …"` dans le CLI (`-w groupe-<id>` dans un dépôt git). Le mod relève l'id de la session dans la réponse de `start_session` ou dans la sortie de `claude --bg`, et le range au groupe que le titre nomme (« ↗ session liée au travail ») ;
- rédiger le background (projet, décisions, contraintes, ce que font les autres sessions) et le prompt de chaque session : appeler d'abord l'outil avec `{"delegate": "<id du parcours>", "group": "<id du groupe>", "main": "<nom> [ref]"}` (`main` : la discussion principale, depuis la 0.45.0 ; chaque réponse de l'outil rappelle alors comment la joindre) ; puis faire les tickets du groupe dans l'ordre, chacun avec `/mattpocock-skills:tdd`, les contrôles, `/mattpocock-skills:code-review` sur le seul ticket (même pour un petit diff) et un commit ; pour un ticket qui touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence), la passe « bogues » `/code-review` part dans le même message que cette revue, sur le même périmètre, avec la liste des choix déjà déclarés (`decided`) à ne pas resignaler ; une fois tous commités, lancer elle-même `/code-review --fix` sur le groupe, avec cette même liste et la consigne de se concentrer sur les interactions entre les tickets (elle ne tranche pas un conflit entre la spec et une consigne : elle le remonte, depuis la 0.46.0), relire et commiter ses correctifs ; puis, si elle la juge utile, confier la revue de sécurité à un sous-agent relecteur (general-purpose, Opus, lecture seule) limité à `git diff <base>..HEAD`, avec les critères de `/security-review`, sans corriger ses failles (depuis la 0.45.1 ; avant, elle lançait `/security-review`, qui calcule son diff contre la branche par défaut et relisait aussi les autres groupes) ; sans sous-agents qui écrivent ; écrire chaque script par Write puis le lancer par une commande simple, avec le chemin absolu de son dossier temporaire écrit en clair (lu une fois par `printenv CLAUDE_JOB_DIR`) ; et finir par un compte rendu (tickets, revue du groupe, revue de sécurité). Depuis la 0.38.0, les étapes d'`/implement` sont écrites en clair : `/mattpocock-skills:implement` est réservé à l'utilisateur, une session ne peut pas le lancer par l'outil Skill.
- à la note de fin, dans la discussion principale : vérifier dans le compte rendu de la session que la revue du groupe a tourné (sinon, la lui demander) avant de fusionner sa branche, puis rendre le groupe (`set`, `returned`) et envoyer l'avis et les constats de sécurité de la session (`security`).

**Titre des sessions liées** (depuis la 0.37.0). Toute session liée (groupe, bug, pistes de la rétro) a un titre qui commence par le titre du parcours, coupé à 28 caractères (« … » au-delà), puis « › » : « Tickets lots, espace privé… › Groupe A · File d'attente ». Dans la liste des discussions, les sessions filles d'une même discussion mère se reconnaissent ainsi. Les guillemets, `$`, `\` et accents graves du titre du parcours en sont retirés, puisque le titre passe aussi entre guillemets dans `claude --bg -n`. Le groupe de la session se lit après le dernier « › » : un titre de parcours qui nomme lui-même un groupe (« Revue du groupe P ») ne trompe pas le tableau de bord.

Confier un groupe fait passer le parcours en phase Implémentation s'il n'y est pas encore (depuis la 0.35.1 ; avant, il restait sur Tickets). `delegate` met la session liée à part : ses skills n'ouvrent ni ne reprennent aucun parcours, et l'outil n'y enregistre rien (il répond qu'il ne faut plus l'appeler) ; son panneau dit « ↗ Session liée du parcours « … » », et son bandeau « ↗ Session liée · « … » » (depuis la 0.35.1 ; avant, « Aucun workflow sélectionné »). Une session dans un worktree a son propre fichier de parcours (sa racine est celle du worktree) : `delegate` la met à part quand même, et lit le titre du parcours dans le board du dépôt principal (depuis la 0.35.0). **Avancement en direct** (depuis la 0.36.0). La session liée n'écrit pas sur le parcours, mais elle relaie son avancement dans un fichier à part (`~/.claude/flow-board/relais/<id du parcours>.json`, une entrée par session) : les statuts de ses tickets d'après ses mises à jour Asana (ligne « Statut : », cochage), ses commits et ses tests, sa fin de session. Un statut changé sans mise à jour Asana peut partir par `{"set": [...]}`, et un choix fait sans Mathis par `{"decided": [...]}` (depuis la 0.44.0) ; le reste d'un appel de l'outil est refusé. Un choix relayé s'affiche aussitôt dans « ⚑ Décidé sans toi » de la discussion principale, avec « (↗ Groupe A) », et compte dans le « à relire » du bandeau. « ✓ Relu » l'enregistre relu dans le parcours ; sinon, il s'y enregistre au retour du groupe (`returned`), à relire, avec une ligne au journal. La discussion principale relit ce fichier toutes les 5 secondes tant qu'un groupe est confié : ses tickets et le bandeau (« ↗A 1/4 ») le montrent (voir plus bas ; jusqu'à la 0.39.0, une ligne « ↗ il y a 2 min · 1/4 faits · … » et des tickets « fait ↗ à vérifier »). Une session terminée avec des tickets ouverts passe en ambre. Ces statuts restent un affichage : ils n'entrent pas dans les tickets du parcours, pour qu'un ticket fait dans une branche pas encore fusionnée ne libère pas ceux qui l'attendent. Un relais plus ancien que l'envoi du groupe (session précédente) est ignoré.

**Affichage d'un groupe confié (depuis la 0.40.0).** Les tickets relayés comptent à l'affichage : le compteur du haut, celui du groupe et le bandeau les incluent. Un ticket fait dans la session prend la coche verte et le titre grisé, sans libellé ; un ticket en cours garde « ◉ en cours ↗ ». Fait ainsi, il lève ses dépendances dans son groupe, mais pas dans les autres groupes, qui travaillent sur une autre branche. Le parcours enregistré, lui, n'avance qu'au retour du groupe. Le groupe confié montre tous ses tickets, ne dit plus « ↩ cette discussion », et son en-tête passe de « ↗ session liée au travail » à « ↗ session terminée il y a … » (ambre) si la session s'arrête avec des tickets ouverts ; la ligne bleue « ↗ il y a … · 1/4 faits · … » a disparu. Tant qu'une session liée travaille, l'état de l'en-tête dit « Session liée au travail ».

Le parcours reste dans la discussion principale, seul écrivain : à la note de fin de chaque session, Claude y vérifie le travail, puis envoie les statuts des tickets dans `set` avec `{"returned": ["<id du groupe>"]}`, qui rend le groupe au tableau de bord. Pendant ce temps, la discussion principale peut confier d'autres groupes ou travailler sur un groupe qui ne partage rien avec ceux qui sont dehors.

**Reprise après une interruption**

Si une discussion s'arrête au milieu d'un ticket, le parcours garde son état : tickets faits, ticket en cours, file lancée. Le travail commencé reste dans la copie de travail, non commité. À la reprise (« ↻ Reprendre », puis `/implement`), la consigne donnée à Claude indique l'état de chaque ticket de la file. Claude saute les tickets faits, et pour un ticket en cours, il regarde `git status` et `git diff` avant d'écrire, pour reprendre le travail déjà fait. Relancer `/implement` remet aussi les étapes à zéro.

**Étapes ticket par ticket**

Pendant `/implement`, les étapes (lire spec et ticket, boucle TDD, contrôles, revue du ticket, commit et suivi) valent pour le ticket en cours. Depuis la 0.40.0, la carte de l'Implémentation n'affiche plus l'étape en cours, ni le ticket en cours au-dessus d'elles : les groupes partent en parallèle ou en sessions liées, et les vagues et les groupes disent où en est chacun. Le mod les suit toujours (consigne à Claude, reprise après interruption). Quand le ticket suivant passe en cours, elles repartent de la première. Sont comptées comme contrôles : un lint ou un typecheck au vert, et la suite de tests complète au vert ; des tests ciblés (un fichier, un filtre) restent dans la boucle TDD.

Depuis la 0.46.0, la carte de l'Implémentation montre l'ordre des choses en deux lignes grisées : « Par ticket : Lire spec et ticket › Boucle TDD › Contrôles › Revue du ticket › Commit et suivi », puis « Par groupe, ses tickets faits : Revue du groupe › Revue de sécurité › Rendu du groupe ». Le contenu de chaque étape est la consigne envoyée à Claude avec le skill (`hint` de `catalog.ts` ; `groupSteps` pour ce qui suit chaque groupe) : c'est là que vit la règle des revues, et le `CLAUDE.md` global n'y fait que renvoyer.

**Les revues**

| Quand | Commande | Ce qu'elle vérifie | Où elle apparaît |
|---|---|---|---|
| Chaque ticket, avant son commit | `/mattpocock-skills:code-review` (axes Standards et Spec), lancée par Claude, point fixe : le commit d'avant le ticket | Le code du ticket face à son ticket (axe Spec) et aux standards du dépôt | Étape « Revue du ticket » de l'Implémentation |
| Chaque ticket qui touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence), avant son commit | Passe « bogues » : `/code-review` de Claude Code, lancée par Claude **dans le même message** que la revue du ticket, sur le même périmètre, avec la liste des choix déjà déclarés (`decided`) à ne pas resignaler (depuis la 0.45.1) | Les bugs du diff du ticket, que les axes Standards et Spec ne cherchent pas | Une ligne du journal (« Passe « bogues » du ticket en cours ») ; depuis la 0.46.0, elle ne marque plus aucun groupe relu, ici comme dans une session liée |
| Chaque groupe fini | `/code-review --fix` de Claude Code, lancée par la personne dans la discussion du groupe ; pour un groupe en session liée, par la session elle-même (depuis la 0.38.0) ; avec la liste des choix déjà déclarés, centrée sur les interactions entre les tickets | Les bugs sur le diff du groupe, y compris avec les groupes déjà faits ; `--fix` applique les correctifs à la copie de travail ; un conflit entre la spec et une consigne (CLAUDE.md, ta demande) n'est pas tranché : la revue ne corrige pas ce point et te le remonte | En-tête du groupe fini : « ◆ Revue du groupe · /code-review --fix », puis « ✓ revu » (plus dans la carte « Ensuite » depuis la 0.42.0) |
| Un groupe relu, si Claude la juge utile (facultative) | Depuis la 0.46.0, un sous-agent relecteur (general-purpose, Opus, lecture seule) que Claude lance lui-même, dans la discussion principale comme dans une session liée, limité à `git diff <base du groupe>..HEAD` ; plus `/security-review`, qui calcule son diff contre la branche par défaut | Les failles de sécurité du diff ; il rend un rapport sans rien corriger : tu décides de leur correction | Sous le groupe fini : « conseillée » et la raison de l'avis, ou « sécurité jugée inutile » ; puis « ⛨ sécurité relue », avec ses constats. Le bouton « ⛨ Revue de sécurité · sous-agent relecteur » (ou « La lancer quand même ») la demande à Claude s'il ne l'a pas lancée |

**Revues sans git (depuis la 0.46.1).** Dans un projet qui n'est pas un dépôt git, aucun commit ne marque le début d'un ticket : les consignes (étapes d'`/implement`, passe « bogues », revue du groupe, revue de sécurité, brief des sessions liées, boutons) remplacent le commit par une copie. Avant de toucher au premier fichier d'un ticket, Claude copie les fichiers qu'il va modifier dans le dossier temporaire de la session (chemin absolu), un sous-dossier par ticket qui garde le chemin dans le projet. Le point fixe d'un ticket est sa copie ; celui d'un groupe est, fichier par fichier, la plus ancienne copie parmi ses tickets. Les revues lisent la différence entre la copie et le fichier actuel (`git diff --no-index` marche hors d'un dépôt) au lieu de relire les fichiers entiers ; un fichier créé par le ticket n'a pas de copie et se lit en entier. Dans un dépôt git, les consignes ne changent pas. La mesure vient de `$.session.repo()`, prise au moment où la consigne part.

La revue d'un groupe n'est pas une phase de la feuille de route : c'est un événement de l'Implémentation. Lancer `/code-review` marque relus les groupes finis, en priorité ceux de la file lancée dans la discussion ; sans groupes, c'est le lot entier, une fois tous ses tickets faits. « Version et push » n'est proposé qu'une fois les groupes faits et relus. La consigne d'`/implement` demande à Claude la revue de chaque ticket, et de ne lancer `/code-review` lui-même que pour la passe « bogues » d'un ticket sensible. Un `/code-review` chargé pendant qu'un ticket est en cours dans la discussion, à son étape Contrôles ou Revue du ticket (ou, dans une session liée, pendant qu'un ticket relayé l'est) est cette passe « bogues » : il ne marque aucun groupe relu (depuis la 0.46.0).

**Relecture de branche (depuis la 0.28.0).** `/code-review` de Claude Code lancé **sans parcours en cours** dans la discussion (bouton « Relire une branche ou une PR » du lanceur, qui le met dans le prompt sans `--fix` : ajouter la cible et les options) ouvre le parcours « Relecture de branche ». Pendant un parcours, la même commande reste la revue du groupe.

**Avis sécurité sans groupes (depuis la 0.28.0).** Dans un parcours sans groupes (Relecture de branche, et la phase Revue de Chasse au bug, TDD ou Revue de code), Claude juge si une revue de sécurité vaut la peine pour **tout le lot**, une fois la revue faite, et la lance lui-même si oui (sous-agent relecteur limité aux changements relus, depuis la 0.46.0) ; l'avis et le bouton « ⛨ Revue de sécurité » s'affichent dans la carte de la phase, puis « ⛨ sécurité relue ».

**Revues d'un groupe en session liée (depuis la 0.38.0).** La session liée lance elle-même `/code-review --fix` une fois ses tickets commités, puis la revue de sécurité si elle la juge utile (un sous-agent relecteur depuis la 0.45.1) ; elle ne corrige pas les failles trouvées, qui vont dans son compte rendu. Le chargement de ces revues dans la session part au relais : la ligne du groupe affiche « ◆ revu » et « ⛨ sécurité relue ». Quand la discussion principale rend le groupe (`returned`), une revue relayée depuis l'envoi du groupe compte comme la sienne : le groupe est relu, et « Version et push » n'attend plus. Sans revue relayée, le groupe rendu attend sa revue, et la réponse de l'outil le dit à Claude.

**Groupe rendu sans revue (depuis la 0.39.0).** Un groupe fait par une session liée garde cette trace (`delegated`) une fois rendu. S'il revient sans revue, son bouton n'est plus « ◆ Revue du groupe · /code-review --fix » : dans la discussion principale, sa branche est déjà fusionnée, et `/code-review` sans cible n'aurait rien à lire tout en marquant le groupe relu. Le bouton devient « ◆ Revue du groupe · session liée ». Il met dans le prompt une demande à Claude : retrouver la session (ListAgents), lui faire remettre sa branche au niveau de la branche principale, lancer `/code-review --fix` sur les seuls commits du groupe, commiter les correctifs, puis la revue de sécurité par un sous-agent relecteur si utile. Au compte rendu, Claude fusionne et envoie `{"reviewed": ["<id>"]}`, qui marque le groupe relu, et `security`. Depuis la 0.43.0, quand le compte rendu final de la session dit que la revue du groupe a tourné mais que le relais ne l'a pas vue, Claude envoie `reviewed` avec `returned`, dans le même appel : le groupe revient relu, sans bouton de revue. Les groupes faits dans la discussion gardent le bouton `/code-review --fix`. Un groupe rendu avant la 0.39.0 retrouve cette trace dans le journal du parcours (« ↩ Groupe A rendu par sa session liée »), depuis la 0.42.0. À confirmer à l'usage : que `/code-review` sans cible relise bien, dans un worktree, la branche face à sa base (le brief dit sinon de lui donner le nom de la branche).

La revue de sécurité ne bloque jamais la livraison et n'est jamais la suite proposée. Une fois `/code-review --fix` passé sur un groupe, Claude juge si une revue de sécurité en vaut la peine (authentification, droits ou règles d'accès, entrées de l'utilisateur jusqu'à une requête, un chemin ou du HTML, secrets, accès réseau ou fichiers, envois de fichiers, dépendances), le dit en une ligne et l'envoie au tableau de bord. Depuis la 0.46.0 (décision de Mathis du 15/10/2026), il la lance alors lui-même, partout : un sous-agent relecteur (general-purpose, Opus, lecture seule) limité à `git diff <base du groupe>..HEAD`, qui ne corrige rien ; avant, la personne lançait `/security-review`, qui relit toute la branche face à la branche par défaut. Claude dit ce que le sous-agent a trouvé, ne corrige qu'avec ton accord et crée une tâche pour chaque faille laissée ouverte. Un `/security-review` tapé à la main reste reconnu. Le compte rendu donne, groupe par groupe, ce qu'il en est.

---

## Livraison et synchronisation

**Livraison**
- Avant la pull request, la phase **Version et push** combine `/project:version` puis `/project:push`. Lancer directement `/project:push` ouvre la phase à l'étape push, avec les étapes de version marquées sautées.
- Un push fait avant l'implémentation (les documents du découpage, par exemple) enjambe la phase Implémentation, qui passe sautée. Depuis la 0.35.1, elle n'est pas perdue : lancer `/implement` ou confier un groupe à une session liée y ramène le même parcours, et la livraison redevient à faire.
- La phase **Pull request** suit `/project:pr`. `/mattpocock-skills:pr` reste disponible pour rédiger le corps.
- **Sans GitHub**, la phase « Pull request » disparaît de l'affichage et n'est plus proposée : le mod lit l'adresse de `origin`, et seule une adresse github.com garde la PR. Après « Version et push », le parcours peut alors être clos. Le parcours stocké garde la phase, qui revient si le projet passe sur GitHub.
- Les commandes `/project:*` n'ouvrent jamais de parcours à elles seules. Elles sont réservées à la personne : le mod les met dans le prompt sans les lancer.

**Synchronisation avant de modifier le code**
- Le mod lance `git fetch` en arrière-plan : au démarrage, au début d'une phase qui touche au code, puis toutes les 5 minutes.
- Il compte ensuite les commits de `origin/main` et de la branche distante suivie qui manquent à la branche locale. Les modifications locales ne comptent pas, `/project:sync` s'en charge.
- Si le distant a avancé :
  - un encadré l'indique, avec la commande à lancer ;
  - la première modification de code est refusée **une fois par avancée du distant**, pour que Claude demande le sync. Une seconde tentative passe.
- La commande proposée :
  - `/project:sync` d'abord, si la branche distante a bougé ;
  - `/project:sync base` ensuite, seulement si main est encore en avance après ce premier sync.
- Sans dépôt git, sans distant ou sans réseau, rien n'est demandé. Sans distant `origin`, l'encadré « À jour » n'est pas affiché non plus : il n'y a rien à quoi se comparer.
- flow-board fonctionne avec n'importe quel hébergeur git (GitHub, GitLab, Bitbucket, serveur maison) : seule la phase « Pull request » est propre à GitHub.

---

## Plusieurs discussions sur un même projet

- Le stockage est partagé : chaque discussion fusionne sa copie au lieu de l'écraser. Pour chaque parcours, la version la plus récente l'emporte, et une suppression est mémorisée.
- Les parcours enregistrés par les autres discussions sont relus toutes les 5 secondes.
- Chaque discussion a son propre parcours en cours. Celui d'une autre discussion apparaît « ⇆ autre discussion », et « Reprendre ici » le récupère.
- **Un parcours n'est suivi que par une discussion à la fois.** « Reprendre ici » le retire à l'autre discussion, qui n'enregistre plus rien sur lui. Pour faire avancer plusieurs groupes en même temps, passer par « ⇉ … en parallèle » : des sessions liées qui travaillent pour la discussion principale sans écrire sur le parcours, ou `/implement-spec` dans un dépôt git. Un ticket qu'une autre discussion a laissé « en cours » s'affiche « ⇆ autre discussion ».
- Une discussion sans parcours actif n'enregistre rien tant que le projet a un parcours en pause ou suivi ailleurs : l'outil et `/flow` nomment ces parcours, pour reprendre le bon.
- À la fin d'une discussion, son parcours passe en pause, sauf après un `/clear`. Au chargement, un parcours abandonné depuis plus de 30 minutes passe aussi en pause.

---

## Commandes

| Commande | Effet |
|---|---|
| `/flow` | Ouvre le panneau sur l'onglet Parcours. |
| `/flow activity` | Onglet Activité. |
| `/flow history` | Onglet Historique. |
| `/flow commands` | Onglet Commandes. |
| `/flow hide` | Masque le bandeau ; une ligne d'état prend le relais. |
| `/flow show` | Réaffiche le bandeau et ouvre le panneau. |
| `/flow pause` | Met de côté le parcours en cours, sans le clore : « Reprendre » le rouvre tel quel. |
| `/flow done` | Clôt le parcours en cours (il reste dans l'Historique). |
| `/flow reset` | Archive le parcours en cours (il reste dans « Archivés », d'où il se rouvre). |
| `/flow rename <titre>` | Renomme le parcours en cours, même quand son titre vient du texte tapé après la commande qui l'a lancé. |

**Dès le premier message : `/flow-board:flow`.** `/flow` est déclaré par le mod au démarrage de la session. Sur le desktop, ce démarrage n'a lieu qu'à l'envoi du premier message : avant, `/flow` n'apparaît pas dans le menu. `/flow-board:flow`, déclaré par le fichier `commands/flow.md`, est disponible tout de suite et accepte les mêmes arguments (`/flow-board:flow history`…). Le mod y répond lui-même, sans passer par le modèle. Une fois le mod démarré, `/flow` sort du menu pour éviter le doublon, mais reste utilisable tapée en entier : les deux font la même chose.

---

## Données et stockage

| Donnée | Emplacement | Portée |
|---|---|---|
| Parcours du projet | `~/.claude/flow-board/parcours/<racine du projet>.json`, un fichier par projet | Partagée par toutes les discussions, desktop comme CLI |
| Ancien stockage (secours) | `~/.claude/plugins/store/flow-board_<source>-<hash>.json`, clé `board:<racine du projet>` | Utilisé seulement si le fichier commun est hors d'atteinte ; versé une fois dans le fichier commun |
| Relais des sessions liées (depuis la 0.36.0) | `~/.claude/flow-board/relais/<id du parcours>.json`, une entrée par session liée ; à défaut `$.store`, clé `relay:<id du parcours>` | Écrit par chaque session liée pour son entrée, lu par la discussion principale |
| Parcours en cours, onglet, sélection, mesure git | État de session (`$.state`) | Une discussion |

Pourquoi un fichier à part : `$.store` range ses données selon la façon dont le mod est chargé. Le desktop passe ses plugins aux sessions (`inline`), le CLI charge le plugin installé (`mathis-plugins`) ; chacun avait son propre stockage, et un parcours créé dans l'un n'existait pas dans l'autre. Le fichier commun est trouvé à partir de l'emplacement du mod, toujours sous `~/.claude`. Au premier démarrage de chaque mode de chargement, son ancien `$.store` est fusionné dans le fichier commun (marque `migrated:board:<racine>` dans `$.store`).

Un parcours n'est plus supprimé : il est archivé. Les archives ne comptent pas dans les 15 parcours d'un projet (jusqu'à 100 archivés gardés), ne sont ni proposées à la reprise ni reprises par un skill ; « Reprendre » sur un archivé le désarchive. À la fusion entre discussions, une ancienne trace de suppression n'efface plus un parcours touché après elle.

Limites appliquées : 15 parcours par projet ; par parcours, 150 tickets, 40 tâches trouvées en route, 30 choix « décidé sans toi », 12 groupes (12 fichiers chacun), 80 lignes de journal et 40 livrables.

Le mod n'écrit ni dans les projets, ni dans Asana, ni dans git. Il ne fait que lire : `git fetch` met seulement à jour les références distantes.

---

## Architecture

```
flow-board/
├── .claude-plugin/plugin.json   manifeste (nom, version, contrat de types)
├── commands/flow.md             /flow-board:flow, connue avant le démarrage du mod
├── hooks/
│   ├── hooks.json               déclare le module register.tsx
│   ├── register.tsx             branchement : événements, outil flow, commande /flow, stockage, git
│   ├── catalog.ts               les 27 skills mattpocock, les 4 commandes project, la revue de groupe et le compte rendu : étapes, couleurs, parcours
│   ├── model.ts                 moteur : transitions pures du parcours (testables sans interface)
│   ├── view.tsx                 dessin du panneau et du bandeau, toutes surfaces
│   └── svg.ts                   feuille de route, anneau, barres, indicateurs
├── skills/compte-rendu/SKILL.md /flow-board:compte-rendu, le rapport à valider avant la livraison
├── types/index.d.ts             contrat de l'état (`PluginState`)
└── tests/                       200 tests `claude plugin test`
```

Le moteur (`model.ts`) ne fait que des transitions pures : chacune prend le parcours, applique un signal et rend le nouveau parcours avec les effets d'interface à jouer. `register.tsx` relie ces transitions aux événements de Claude Code et écrit l'état de façon conditionnelle (`ifVersion`).

---

## Développement

```bash
claude plugin validate ~/.claude/mathis-plugins/plugins/flow-board
claude plugin test ~/.claude/mathis-plugins/plugins/flow-board
```

- Les tests montent le panneau et le bandeau sur les surfaces `terminal`, `desktop`, `vscode` et `mobile`. Ils simulent le stockage, git et une seconde discussion.
- Dans le kit de test, un hook qui remplace une opération du moteur (`store.get`, `session.id`, `process.run`…) doit rendre `{ value }`.
- Les versions précédentes sont dans l'historique git du dépôt ; celles d'avant le passage à git restent dans `~/.claude/mods-archives/flow-board-<version>` sur le PC Windows.

---

## Limites connues

- **Animations.** Les dessins sont des images : sur le desktop, les animations SVG ne tournent probablement plus. Le mode interactif tournait, mais il donnait un fond blanc qui clignotait à chaque redessin.
- **Demande de sync.** Un fichier de code modifié par une commande shell, et non par l'outil d'édition, échappe au refus. La consigne donnée à Claude couvre ce cas.
- **Ligne compacte de l'outil `flow`.** Claude Code ne dit pas à un mod si la vue détaillée (ctrl+o) est ouverte sur une ligne d'outil : la ligne compacte y reste, sans le JSON de l'appel.
- **Données de suivi.** Elles dépendent en partie des comptes rendus de Claude : étapes, éléments suivis, dépendances.
- **Trouvé en route.** Seules les créations par `create_tasks` d'Asana et `gh issue create` sont vues. Une tâche créée autrement (interface d'Asana, autre outil) n'apparaît que si Claude l'envoie au panneau.
- **Une discussion par parcours.** Deux discussions ne peuvent pas suivre le même parcours en même temps : un seul écrivain à la fois, sinon deux discussions qui cochent des tickets du même parcours s'écraseraient (la fusion garde le parcours le plus récent en entier). Le parallélisme passe par des sessions liées qui n'écrivent pas sur le parcours (`delegate`), ou par `/implement-spec` dans une seule discussion.
- **Groupes en session liée.** Le panneau ne suit pas les étapes d'une session liée (lecture, TDD, revue…). Depuis la 0.36.0, ses tickets, commits et tests s'affichent en direct, relayés ; les tickets du parcours n'avancent qu'au moment où Claude, dans la discussion principale, rend leurs statuts à sa note de fin. Le relais compte sur les mises à jour Asana de la session : un projet sans suivi Asana n'en montre que les commits et les tests, sauf `set` envoyé par la session. Plusieurs sessions liées écrivent le même fichier de relais : deux écritures simultanées peuvent perdre un signal, rattrapé au signal suivant de la même session (elle réécrit toute son entrée). Le mode `delegate` est propre à la discussion et se perd si le mod se recharge dans la session liée (`/reload-plugins`) : ses skills pourraient alors ouvrir un parcours, à supprimer à la main. Le mod ne connaît pas l'id d'application d'une discussion (`$.session.id()` donne celui de sa transcription) : pas de lien cliquable vers la discussion de découpage.
- **Pistes en session liée.** La session liée ne touche pas au tableau de bord : les pistes avancent dans le panneau quand Claude, dans la discussion principale, rend leur statut à la note de fin de la session, pas au fil de son travail. Une session lancée qui s'arrête sans note laisse ses pistes « en cours » : « ↻ Reprendre les pistes » demande à Claude de les rendre (faites ou écartées) pour pouvoir clore la rétro.
- **Discussion d'un ticket en cours.** Le mod n'a pas le titre des discussions : il dit « ici » ou « autre discussion », pas laquelle.
- **Stockage.** Le fichier dépend de la façon dont le plugin est chargé. Une session lancée autrement, par exemple en terminal, peut ne pas voir les mêmes parcours. Il est aussi propre à chaque machine : une discussion du PC ne peut pas confier un groupe à une session du Mac, même si les deux se parlent par `SendMessage`.
- **Heredocs.** Depuis la 0.35.1, le corps d'un heredoc n'est pas lu comme des commandes (un brief en prose cachait le `claude --bg` qui le suit) : des tests lancés dans un heredoc (`bash <<EOF` … `pytest` … `EOF`) ne sont donc pas relevés.
- **Sessions liées dans le CLI.** L'id n'est relevé que si `claude --bg` tourne au premier plan (une commande lancée en arrière-plan n'a pas de sortie lisible) ; sans id, le groupe reste « session liée à lancer » avec « Annuler », qui le rendrait relançable alors que la session travaille. Le mode de permission de la fille doit être celui de la discussion principale, sinon ses messages attendent ton accord.
