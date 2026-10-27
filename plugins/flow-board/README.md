# flow-board

Tableau de bord en direct du workflow [mattpocock-skills](https://github.com/mattpocock/skills) dans Claude Code. Il suit chaque travail sous la forme d'un **parcours**, de l'idée jusqu'à la pull request, et l'affiche dans un panneau et dans un bandeau au-dessus du prompt.

- **Il s'adapte au skill de départ.** `/grill-with-docs`, `/to-spec`, `/diagnosing-bugs`, `/wayfinder` ou `/implement` n'ouvrent pas le même parcours.
- **Il se remplit tout seul.** Il suit les skills chargés, les tickets Asana, les sous-agents, les tests, les commits et les livrables.
- **Il garde les parcours par projet.** Plusieurs discussions peuvent travailler sur le même projet sans se marcher dessus.
- **Il suit les conventions de livraison du plugin `project`** : `/project:sync`, `/project:version`, `/project:push`, `/project:pr`.

Version actuelle : **0.60.0**. Historique des versions : [CHANGELOG.md](CHANGELOG.md).

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

Pour une nouvelle version : modifier la source dans le clone de travail (`plugins/flow-board`), monter `version` dans `.claude-plugin/plugin.json` et dans l'entrée du mod de `.claude-plugin/marketplace.json` à la racine du dépôt, commiter et pousser, puis :

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
| Note de fin | l'app relance la discussion principale quand la fille finit un tour | la fille envoie son message final par `SendMessage` à la discussion principale, ce qui la réveille même inactive ; depuis la 0.56.0, le brief ne donne que la référence stable de la discussion (« [ref] ») : la fille la retrouve toujours dans `ListAgents` et envoie à « <nom du moment> [ref] » (avant, le nom d'abord et la référence en repli, depuis la 0.45.0) ; une session de groupe dépose son compte rendu complet au relais et n'envoie qu'une ligne qui y renvoie ; depuis la 0.56.0, plus de filet `notify_when_idle` (cinq réveils pour un groupe, dont quatre pour rien) : le message final de la fille réveille la discussion, et le relais rattrape un message perdu |

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
| **Orchestrateur** | La discussion qui lance les autres : celle qui porte le parcours, ou, sans parcours, la discussion où l'on regarde. |
| **Session liée** | Une discussion lancée par l'orchestrateur pour lui confier un travail (un groupe de tickets, un bug, des pistes de rétro), qui tourne à côté de lui (`start_session` dans l'app desktop, `claude --bg` dans le CLI). |
| **Sous-agent** | Un agent lancé à l'intérieur d'une discussion (orchestrateur ou session liée) par l'outil `Agent`, qui travaille pour elle et lui rend un rapport. |
| **Frise, piste** | Dans l'onglet Agents, la frise montre le temps de gauche à droite ; chaque agent (l'orchestrateur, une session liée, un sous-agent) y a sa piste, une rangée faite de segments (réflexion, rédaction, appel d'outil, attentes) et de repères (échec, départ et retour, commit…). |

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
3. **Passer à la suite.** La carte « Prochaine étape » propose le skill suivant. Son bouton met la commande dans le prompt sans la lancer : on la complète, puis Entrée. Tant que des tickets restent ouverts, ni le compte rendu ni la livraison (version, push, pull request) n'y sont proposés. Dans l'Implémentation d'un parcours à groupes (depuis la 0.42.0), la carte « Ensuite » recommande plutôt quoi lancer : le lot de groupes indépendants en parallèle (« ⇉ B ∥ C en parallèle · sessions liées »), sinon le prochain groupe prêt (« ↗ Groupe D · session liée » ; depuis la 0.60.0, plus de « ▶ Lancer D ici »), le groupe commencé ici d'abord. Un groupe prêt qui partage un fichier ou une ressource avec un groupe en session liée attend : la carte dit alors quel groupe on attend. Une fois tous les tickets faits, elle dit quels groupes attendent leur revue ; les revues restent sur la ligne de chaque groupe, et le compte rendu vient en tête une fois toutes faites.

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
| Déléguer | 🐞 Bug · session liée | `/diagnosing-bugs` | Depuis la 0.26.0, seulement pendant Implémentation, Implémentation de spec, TDD, Revue ou Compte rendu. Met dans le prompt une demande à Claude, à compléter après « Bug : ». Claude lance une session liée dans ce dossier (pas de worktree : elle doit lire le même fichier de parcours), qui reprend le parcours (`resume`), diagnostique le bug en détour de la phase en cours, le corrige selon le `CLAUDE.md` du projet, puis clôt le détour (`complete`). Depuis la 0.55.0, la session est lancée en effort high, et xhigh pour une deuxième tentative sur un bug toujours là après la première ; pas de troisième session : on replanifie. À sa note de fin, Claude vérifie son travail ; si le bug est toujours là, il le dit et propose la deuxième tentative, sinon il reprend le parcours |

### Le panneau

| Onglet | Contenu |
|---|---|
| **Parcours** | En-tête du parcours choisi dans la discussion (anneau de progression, feuille de route animée) ; sans parcours choisi (aucun, mis de côté, en pause ou suivi ailleurs), l'en-tête dit « Aucun parcours sélectionné » et n'en montre aucun, carte de la phase (tickets en cours, étapes, éléments suivis, tickets, tests, revue, détour), une ligne de résumé des sous-agents (« ◉ N agents au travail · ▸ Agents ») qui mène à l'onglet Agents, prochaine étape, « ‖ Mettre de côté ». Sans parcours en cours, le lanceur « Démarrer un parcours », dans l'ordre du flux : Cadrer une fonctionnalité, Rédiger la spec de ce qu'on a discuté, Découper un plan en tickets, Implémenter un ticket ; puis Diagnostiquer un bug, Relire une branche ou une PR, Trier les issues, Explorer un grand chantier, Santé de l'architecture. En bas, toujours, la barre « À tout moment ». |
| **Agents** (depuis la 0.58.0) | Le suivi de l'orchestrateur, de ses sessions liées et de leurs sous-agents, pendant un parcours comme sans. En tête : un sélecteur d'historique (« Ici, maintenant », les parcours archivés compris, les discussions sans parcours du projet qui ont lancé des agents), une pastille par session liée avec son état (au travail, rendue, échouée, fermée) qui montre sa propre frise, et un résumé (agents, durée, gain par rapport à une exécution en série, coût estimé « ≈ » d'après ccusage). Puis la frise : une piste pour l'orchestrateur, une par session liée, une par sous-agent (type en couleur et en glyphe, enfants en retrait, Workflow repliés), segments de réflexion, rédaction, outil et attentes, repères, pauses compressées. Au-dessus des pistes, une barre de navigation zoome et déplace la frise comme un montage vidéo : `−` (raccourci `o`) double la fenêtre affichée, `＋` (`i`) la divise par deux, `◀` (`h`) et `▶` (`l`) la décalent d'une demi-fenêtre, « dernière heure » et « tout » (`t`) sont des préréglages ; chaque bouton affiche sa lettre, et les raccourcis marchent quand le volet a le focus. Le zoom porte sur la frise affichée, pauses déjà compressées : chaque appui double ou divise ce que tu vois, d'une minute à tout. Une fenêtre qui finit au bout de la frise suit le direct (le zoom garde alors sa fin) ; décalée vers le passé, elle se fige et montre toujours le même moment. Une règle graduée en heures (hh:mm) court au-dessus des pistes, son pas choisi selon le zoom (1, 5, 15, 30 min, 1, 3 ou 6 h) et coupée aux pauses. La fenêtre est propre à la discussion et repart de « tout » à chaque ouverture de l'onglet ; elle vaut aussi pour l'historique et la frise d'une session liée choisie. Une **pause** est un moment de plus d'une minute où personne ne travaille : ni l'orchestrateur, ni ses sous-agents, ni ses sessions liées. Attendre ta réponse (question, autorisation) ou ton prochain message en est une ; réfléchir, rédiger, lancer un outil, attendre un sous-agent ou une tâche de fond, c'est travailler. Un sous-agent compte par ses segments, pas par toute sa période (un sous-agent tout juste lancé, encore sans segment, compte comme au travail). Chaque pause prend une largeur fixe et affiche sa durée, 24 % de la frise au plus pour toutes ; une attente de ta réponse y reste visible, écrasée et hachurée ambre. Une **attente** est une barre hachurée qui dit ce qu'elle attend : gris « attend un sous-agent », ambre « attend ta réponse », bleu « attend une tâche de fond ». Une **pause** n'est pas une barre : elle coupe le rail, deux traits verticaux et sa durée entre eux (`┊ 2 h ┊`), légendée « pause : personne ne travaillait » (au terminal aussi, `┊` à la place de l'ancien `⫽`). Sous la ligne de légende compacte, « ▸ légende détaillée », repliée par défaut, liste chaque famille d'outils avec ses outils (lecture `⌕` : Read, Grep, Glob… ; modification `✎` ; commande `❯` ; web `🌐` ; sous-agents `⇢` ; autres `•`), chaque type d'agent avec son glyphe et sa couleur, et chaque repère. Le texte de remplacement de chaque piste nomme ses attentes et ses pauses avec les mêmes mots. Quand la discussion ou un de ses sous-agents consulte l'**advisor** (le modèle relecteur), une ligne advisor apparaît juste sous l'orchestrateur, une seule pour toute la discussion : or, glyphe ✦, nom « advisor · relecteur », une barre cerclée par appel. Le moteur ne signale l'appel qu'à la fin de l'étape du modèle qui l'a fait : la barre arrive alors, avec ses vraies heures, et la piste de l'appelant montre au même moment une attente or en pointillés (`┄` au terminal), « consulte l'advisor », qui coupe sa réflexion : des pointillés, pas des hachures, pour ne pas la confondre avec l'ambre de « attend ta réponse ». La carte de la ligne liste les appels, leur heure, leur durée et qui les a faits. Dans la frise de l'orchestrateur, les appels d'une session liée ne s'y ajoutent pas : on les voit en choisissant cette session liée. Le modèle, les tokens et le coût de chaque appel arrivent après coup, par le rattrapage : le direct ne les donne pas. Le transcript (de la discussion ou du sous-agent appelant) porte, pour chaque réponse qui a consulté l'advisor, une entrée `advisor_message` dans `usage.iterations` (modèle, tokens) ; ses tokens ne sont pas dans le compte de la réponse, et le mod ne les ajoute jamais à l'appelant. Le contenu de la réponse de l'advisor, chiffré, n'est jamais lu. Le coût est tiré des prix de ccusage, comme celui des sous-agents, et compté une seule fois : à part dans le résumé (« ✦ advisor ≈ 1,89 $ »), sur la carte de la ligne advisor (modèles, appels, tokens, coût), et sur la carte d'un agent appelant en une ligne « ✦ Advisor : 2 appels, ≈ 0,42 $ », hors de son coût et de la somme avec ses sous-agents. Sans prix connu pour le modèle de l'advisor : « coût inconnu », avec les tokens. La ligne advisor existe aussi dans l'historique d'une discussion passée et dans la frise d'une session liée choisie. Le bouton d'une piste ouvre sa carte de détail (prompt, tokens, outils, lignes, coût, transcription). Sur une discussion passée, « ✗ Oublier » l'efface après confirmation. Ouvert dans une session liée, l'onglet dit de qui elle est la session liée. |
| **Activité** | Chiffres (fichiers, commits, merges, termes du glossaire, ADR, tests), livrables écrits, journal des événements. |
| **Historique** | Les parcours du projet, avec « Reprendre », « Reprendre ici », « ◆ Agents » (ouvre l'onglet Agents sur ce parcours, archivés compris) et « ▣ Archiver ». Les archivés sont cachés par défaut, sous « ▸ Archivés (N) », avec « ▢ Désarchiver » et « ✗ Supprimer ». La suppression demande une confirmation (« Supprimer définitivement ce parcours ? ») et ne se défait pas : depuis la 0.58.0, elle efface aussi ses agents, ses sessions liées, son relais et ses choix ; les autres discussions du projet l'oublient aussi. |
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
- met dans le prompt une demande à Claude (depuis la 0.51.0, les pistes ne passent « en cours » et l'étape « Modifications en cours », la dernière de la rétro, ne s'ouvre qu'au lancement de la session, pas au clic), qui rédige lui-même le brief, puisque les pistes n'ont qu'un libellé et que lui connaît la session étudiée :
  - d'abord, régler avec toi les pistes qui attendent une information ou une décision de ta part (un accès, un choix entre options), sinon la session y buterait ;
  - lancer la session par `start_session` avec `context` « fresh » (une discussion de rétro est longue : un fork la transporterait toute), `wake_when_done` et un worktree, ou le dossier lui-même s'il n'a pas de git ; dans le CLI, par `claude --bg` (voir « Sessions liées : Desktop et CLI ») ;
  - seules les pistes de ce dépôt (depuis la 0.54.0) : une piste qui touche un autre dépôt (plugins, config commune, autre projet) n'entre pas dans le prompt de la session ; Claude te la rend dans une liste de corrections prête à confier à un agent de ce dépôt et, une fois la session lancée, la rend « à faire » (elle revient à ton choix) ; si aucune piste choisie n'est de ce dépôt, il ne lance rien et te dit d'utiliser « Annuler » ;
  - un background qui ne reprend pas le texte des règles (depuis la 0.54.0) : il cite le document du projet pour les sessions déléguées, son `CLAUDE.md` et tes règles communes par leur chemin, et ne garde que ce qui varie (le projet, la session étudiée, la ressource unique comme une appli ouverte, les décisions par renvoi) ;
  - une section par piste : le problème constaté, la correction attendue, les fichiers touchés, un critère de fin vérifiable ;
  - un travail en séquence, les pistes qui touchent les mêmes fichiers regroupées, sans sous-agents qui écrivent (en parallèle, seulement des recherches en lecture seule) ; les contrôles du `CLAUDE.md` du projet à la fin ; rien sur le tableau de bord ;
  - un compte rendu final : une ligne par piste (faite, ou pas faite et pourquoi), les fichiers modifiés, les contrôles et leur résultat, ce qui t'attend ;
  - si Claude ne peut pas lancer la session (outil absent, refus, erreur), il le dit avec la raison et ne rend aucune piste ;
- **le parcours reste dans la discussion principale** : la session liée ne le reprend pas. Claude la suit d'ici ; à sa note de fin, il vérifie son travail et rend le statut de chaque piste : faite (vérifiée), à faire si la session ne l'a pas faite (elle revient à ton choix et peut repartir dans un envoi suivant), écartée seulement si tu y renonces. Il ne clôt la rétro que si aucune piste n'est revenue à ton choix. Tant que des pistes sont chez la session, lancée ou non, la rétro ne se clôt pas.

La carte suit l'envoi :
- « ↗ Session liée à lancer » tant qu'aucune session n'est lancée : la demande est dans le prompt, les pistes confiées portent ↗ (ni à choisir, ni en cours) et le journal dit « Session liée demandée », pas « confiées ». Des pistes choisies en plus rejoignent l'envoi, et la nouvelle demande les liste toutes. « Annuler » les remet à ton choix ; « ↻ Redemander », grisé, remet la demande dans le prompt si elle n'y est plus ;
- « ⚠ Aucun lancement relevé » (depuis la 0.51.0) quand le tour qui suit ton message se finit sans session lancée (un tour ouvert par une notification ou une autre session ne compte pas, il n'a pas vu la demande) : Claude a pu te poser une question d'abord (réponds-lui, la marque s'efface au lancement), ou ne pas la lancer du tout. « ↻ Redemander » remet la demande dans le prompt, précédée d'une consigne : vérifier d'abord qu'aucune session n'est partie sans que son id soit relevé, pour ne pas en lancer une seconde. « Annuler » rend les pistes à ton choix ;
- « ↗ Session liée au travail · 3 pistes en cours » une fois la session lancée : son id est relevé dans la réponse de `start_session`, ou dans la sortie de `claude --bg`, sauf si son titre nomme un groupe ou un bug (« … › Groupe A · », « … › Bug · »). Les pistes ne bougent qu'à sa note de fin, d'où « en cours » plutôt qu'un compteur à 0 ; chaque réponse de l'outil le rappelle à Claude, pour qu'une liste renvoyée en route les garde « en cours ». Aucune piste ne peut partir tant que la session en a : une nouvelle demande lancerait une seconde session que le tableau de bord ne suivrait pas ;
- « ✓ Session liée terminée ».

« ↻ Reprendre les pistes », proposé dès l'envoi, met dans le prompt une demande à Claude, qui marche dans l'app Desktop comme dans le CLI (outils de session de l'app, sinon `ListAgents`, l'état git de son worktree, le tracker et au besoin le transcript `.jsonl` sous `~/.claude/projects/` ; depuis la 0.54.0, plus `claude logs`, dont la sortie de terminal est illisible). Avec un id relevé : vérifier l'état de la session et son travail, puis rendre chaque piste comme à la note de fin. Sans id relevé : chercher d'abord une session dont le titre commence par « <parcours> › Pistes · » ; s'il n'y en a aucune, le lancement n'a pas eu lieu, et Claude ne rend aucune piste ni ne clôt la rétro : il te dit ce qui l'a empêché, et tu choisis entre « Redemander » et « Annuler ». Pendant que la session travaille, l'en-tête dit « Session liée au travail » au lieu de « À toi de jouer ». Les pistes restantes, et celles revenues à ton choix, peuvent partir dans un envoi suivant, une fois la session terminée. Rendre des pistes à ton choix et clore dans le même appel est refusé. Une rétro ouverte avant la 0.33.0 reçoit l'étape au premier lancement. Un envoi fait avec la 0.50.0 ou avant, resté sans session (pistes déjà « en cours », étape déjà ouverte), s'affiche « à lancer », puis « ⚠ Aucun lancement relevé » après ton message suivant ; « Annuler » remet ses pistes à ton choix et l'étape d'avant.

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
| Sous-agents (`Agent`, `agent.spawn`, `turn.step`, appels d'outils portant un `agentId`, `SubagentStop`, `turn.complete`), sessions liées (`start_session`, `claude --bg`) | Registre des agents de la session et onglet Agents, avec ou sans parcours : chaque sous-agent (type, modèle, effort, prompt, tokens, outils, lignes, durée, réveils), ses segments et repères datés, la piste de la session elle-même, les sessions liées lancées. Les transcripts de Claude Code rattrapent ce qui a été manqué. Pendant un parcours, le lancement d'un `Agent` fait aussi avancer ses étapes (implementers, relecteurs…). |
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

**Titre du parcours et de la discussion (depuis la 0.60.0)**
- Le titre d'un parcours ne vient plus jamais du texte tapé après la commande (souvent un long prompt) : un parcours ouvert par un skill porte le nom de son flux, « non titré », jusqu'au premier `title` de Claude. La consigne du premier appel lui demande un titre court qu'il choisit, qui résume tout le chantier, dans ta langue, jamais ton message lui-même. Une suite garde « <libellé> · <titre du parent> ». `open` et un lot de tickets sans skill prennent le `title` de Claude.
- Le parcours retient la discussion où il est né (`bornIn`), à sa création, sans jamais l'effacer, même à la mise en pause. À son premier titre, cette discussion prend le même nom, si aucun autre parcours n'y est né (actif, en pause, fini ou archivé ; un parcours supprimé ne compte plus, un parcours d'avant ce changement non plus), si ce n'est pas une session liée et si aucune session liée n'a été demandée par le parcours (son brief nomme la discussion). Sinon, seul le parcours prend le titre. La réponse de l'outil le dit à Claude : « name this discussion "<titre>" » ou « this discussion keeps its name ».
- Deux chemins renomment la discussion : Claude appelle tout de suite l'outil de l'app qui la renomme quand il l'a (`set_session_title`) ; et le mod renvoie le titre au moteur (`sessionTitle` du hook `UserPromptSubmit`) à ton prochain message, ou à la reprise de la discussion (`SessionStart`), une seule fois, et seulement si la discussion ne le porte pas déjà (`session_title`). Le titre en attente est gardé pour la seule discussion de naissance (`$.store`, clé `discussion-title:<session>`), hors du board partagé : une autre discussion ne peut pas le ramener. L'essai du 27/10/2026 a vérifié le chemin `UserPromptSubmit` au terminal (Claude Code 2.1.311, et 2.1.308 embarqué par l'app) et dans l'app desktop ; le chemin `SessionStart` d'une reprise reste à confirmer sur un vrai moteur.
- `/flow rename` et `fix.title` renomment aussi la discussion, aux mêmes conditions, tant qu'aucune session liée n'est demandée ni n'a été lancée par le parcours (« Annuler » une demande avant le lancement la libère) : son brief donne le nom de la discussion orchestratrice, qui ne doit plus bouger ensuite. Les sessions liées gardent le titre fixé à leur lancement. Un titre donné à la main avant le premier parcours est écrasé (le mod ne distingue pas un titre donné à la main d'un titre automatique).
- Les consignes qui te demandaient de renommer la discussion à la main (au début d'`/implement`, avant la première session liée) ont disparu.

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
- Chaque fois que Claude fait un choix que tu n'as ni demandé ni validé, il le signale (`decided`, avec sa raison). La règle est dans la description de l'outil, donc toujours connue de Claude. Depuis la 0.54.0, un choix qui touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence) n'est jamais déclaré : la description de l'outil et la consigne des skills de cadrage (grilling, `/to-spec`, `/to-tickets`, `domain-modeling`) en font une question à te poser, et une entrée de décision recopie la question et ta réponse au lieu de les résumer. Depuis la 0.56.0, avant une question de confidentialité, Claude fait vérifier l'exposition réelle par un sous-agent en lecture seule, sinon la question la dit « à confirmer » ; le grilling et `/to-spec` ont une étape « Conséquences sensibles » (ce qu'un changement ou un retrait laisse derrière lui : fichiers en clair, journaux qui dépendent d'un mode, données gardées).
- **Fichier des choix déclarés** (depuis la 0.54.0) : la discussion principale tient `~/.claude/flow-board/choix/<id du parcours>.md`, réécrit à chaque changement d'après le parcours et le relais (ses choix et ceux des sessions liées). Les briefs et les consignes de revue citent son chemin au lieu de recopier la liste, avec une consigne des relecteurs à donner telle quelle : attendre tous les axes d'une revue avant de rendre son rapport, ne pas relancer les tests, ne rien appliquer de ce qui est laissé à un autre groupe.
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

À la fin de `/to-tickets`, Claude regroupe les tickets selon leur contexte (`groups`). Depuis la 0.60.0, **un groupe ne se fait qu'en session liée** :
- les tickets d'un groupe touchent les mêmes fichiers ou s'enchaînent par leurs dépendances ; sa session liée les fait d'affilée avec `/implement`, en profitant du contexte déjà chargé, et le parcours reste dans la discussion principale ;
- plusieurs groupes indépendants peuvent avancer en même temps, une session liée chacun ;
- un autre contexte fait un autre groupe, et un groupe d'un seul ticket convient quand son contexte lui est propre ;
- **pas de groupe seul** (depuis la 0.60.0) : un lot qui n'aurait qu'un groupe n'en a pas. La consigne de `/to-tickets` dit à Claude de ne pas envoyer de groupes dans ce cas, et le mod ignore quand même un plan reçu qui, une fois ses tickets rangés, ne compte qu'un groupe (un groupe plus des tickets restés hors de lui compte aussi pour un seul) ; la réponse de l'outil le dit à Claude en une ligne. Un plan déjà en place n'est jamais remplacé ni vidé par cette règle. Un lot sans groupe qui a des tickets ouverts se lance d'un geste par « ▶ Tout implémenter ici · /implement » (pas pendant `/to-tickets`, où les groupes peuvent encore venir) : `/implement` sur tous ses tickets ouverts, dans l'ordre du lot.

Avant la 0.60.0, un groupe pouvait aussi se lancer dans la discussion courante (« ▶ Lancer A », « ▶ Lancer le prêt »), un lot de groupes par `/implement-spec` (un sous-agent par groupe), et un groupe marqué `continuesHere` se gardait pour la discussion du découpage (« ↩ cette discussion »). Ces lancements et ce champ ont disparu : un `continuesHere` reçu est ignoré, celui des anciens fichiers reste sans effet. Un groupe déjà commencé ici avant ce changement garde son suivi (« Un groupe à la fois » ci-dessous). Les tickets choisis à la main, hors groupes, gardent `/implement` et `/implement-spec` (« Lancer une sélection de tickets »).

Pour chaque groupe, Claude donne la raison du regroupement, les fichiers touchés (`files`) et, depuis la 0.34.0, ses **ressources** (`resources`) : ce qu'il ne peut pas partager avec un autre groupe qui travaille en même temps, comme une application pilotée à l'écran (« PowerBI Desktop »), une base, un appareil ou un compte uniques. Chaque ticket peut aussi porter ses propres fichiers (`files`), lus dans ses critères d'acceptation : ils s'ajoutent à ceux de son groupe tant qu'il est ouvert. Quand un groupe déclare un dossier qui contient un fichier nommé par un autre groupe, la réponse de l'outil le signale à Claude : un dossier bloque tous ceux qui touchent un fichier dedans. Une nouvelle liste de groupes remplace la précédente, en gardant les revues et les sessions liées de chaque groupe ; des tickets envoyés sans groupes ne la touchent pas.

Depuis la 0.56.0, chaque ticket dit aussi « Zone sensible : oui/non (pourquoi) » et « Logique : oui/non » (pas de logique : une ressource visuelle, un document), envoyés à l'outil (`sensitive`, `logic`) et gardés avec le ticket. Une écriture de `CLAUDE.md` n'entre jamais dans le « Fini quand » d'un ticket de groupe : une session liée ne peut pas la faire, c'est un geste de la discussion principale.

Le mod en déduit le reste :

| Calcul | Règle |
|---|---|
| Attente | Un groupe attend un autre quand l'un de ses tickets a un bloqueur encore ouvert dans cet autre. |
| Vagues | Une vague est un ensemble de groupes qui peuvent tourner en même temps, chacun dans sa session liée (glossaire). Le mod range les groupes par niveau d'attente : un groupe passe dès que ceux qu'il attend sont passés. Une attente circulaire met ses groupes au même niveau, marqués « ⚠ ordre à revoir ». Depuis la 0.60.0, les titres « Vague N » ne s'affichent que si au moins un niveau a deux groupes ou plus qui peuvent avancer ensemble (sans fichier ni ressource en commun, hors attente circulaire) ; sinon les groupes se suivent dans l'ordre, chacun avec son « attend A ». |
| Lot parallèle (∥) | Les groupes **prêts** (aucun bloqueur encore ouvert), **pas encore commencés** (aucun ticket en cours ni fait) et pas confiés à une session liée, pris dans l'ordre ; un groupe n'est retenu que s'il ne partage **aucun fichier ni aucune ressource** avec ceux déjà retenus ou confiés à une session liée (un dossier recouvre les fichiers qu'il contient ; les fichiers d'un groupe sont les siens et ceux de ses tickets ouverts), car un fichier ou une ressource en commun vaut une dépendance. Depuis la 0.56.0, les documents que presque tous les tickets citent (`README.md`, `DECISIONS.md`, la carte du code `carte-du-code.md` ou `CODEMAP.md`, où qu'ils soient) ne comptent pas : leurs ajouts se fusionnent sans peine. Il faut au moins deux groupes. |
| Raisons (∦) | Un groupe prêt resté hors du lot dit pourquoi : « ∦ A : tables » (le groupe, et le fichier ou la ressource en commun). Il le dit aussi face à un groupe confié à une session liée ou en cours ici. |
| Autres lots | Chaque groupe prêt resté hors du lot principal en ouvre un autre, formé de la même façon à partir de lui (trois au plus) : « Autres lots possibles ». |
| Un groupe à la fois | Tant qu'un groupe est commencé ici et pas fini, aucun lot ne part : le panneau affiche « ⇉ B ∥ C en parallèle une fois A fini ». Un groupe confié à une session liée n'occupe pas le parcours. |
| Autres | Un ticket ajouté au lot pendant qu'un groupe s'exécute rejoint ce groupe (avant le premier de ses tickets qu'il retient), sauf si Claude renvoie lui-même les groupes. Un ticket ajouté autrement, sans groupe, rejoint la chaîne dont il fait partie : le groupe des tickets qu'il retient (placé avant le premier), sinon celui des tickets qu'il attend (à la fin). Seuls les tickets qui ne tiennent à aucun groupe, ou à plusieurs, restent dans « Autres ». Claude est aussi invité à renvoyer les groupes quand il ajoute un ticket. |

Dans l'onglet Parcours, les tickets sont alors rangés par niveau d'attente (titré « Vague N » quand une vague existe vraiment), puis par groupe :
- « ↗ Session liée », sur tout groupe prêt, confie le groupe à une session liée ;
- « ⇉ A ∥ B en parallèle · sessions liées » confie chaque groupe du lot à la sienne. Les groupes qui attendaient (niveau d'attente suivant) deviennent parallélisables à leur tour une fois leurs bloqueurs faits ;
- la carte « Ensuite » propose de même la session liée du prochain groupe prêt, ou les sessions liées du lot, jamais un lancement ici.

Le fonctionnement des sessions liées est détaillé plus bas.

**Groupes en session liée** (depuis la 0.34.0 ; avant, la session liée d'un groupe reprenait le parcours)

« ↗ Session liée » ou « ⇉ … · sessions liées » met dans le prompt une demande à Claude, et le groupe passe « ↗ session liée à lancer » (avec « Annuler »). La demande lui fait :
- régler d'abord avec la personne ce dont les sessions auront besoin (une décision, un accès, un geste qui lui est réservé) ;
- lancer une session par groupe, avec un titre de la forme « <parcours> › Groupe <id> · <thème> » : `start_session` dans l'app (`context` « fresh », `wake_when_done`, un worktree, ou le dossier s'il n'a pas de git), `claude --bg -n "<parcours> › Groupe <id> · …"` dans le CLI (`-w groupe-<id>` dans un dépôt git). Depuis la 0.53.0, Claude choisit l'effort de chaque session (`effort` de `start_session`, `--effort` de `claude --bg`) : medium par défaut, high si le groupe a un ticket qui touche une zone sensible, s'il reste des choix de conception ou s'il touche plusieurs modules, et il le dit en une ligne ; avant, la session prenait l'effort de la discussion (l'app ne lui en donne jamais un plus haut). Le mod relève l'id de la session dans la réponse de `start_session` ou dans la sortie de `claude --bg`, et le range au groupe que le titre nomme (« ↗ en cours · session liée » depuis la 0.56.0, « ↗ session liée au travail » avant) ;
- de la 0.54.0 à la 0.59.1, avant la première session liée du parcours, te demander de renommer la discussion de son nom définitif ; depuis la 0.60.0, ce nom est fixé par la règle du titre (« Titre du parcours et de la discussion ») et ne bouge plus une fois une session liée demandée ;
- rédiger le background sans y reprendre le texte des règles (depuis la 0.54.0 : écritures permises, gestes réservés, dépôt public, modèle et effort des revues se citent par leur document, une copie se périmait) ; il ne garde que ce qui varie : le projet, les tickets, ce que font les autres sessions, les décisions par renvoi, le chemin du fichier des choix déclarés ; puis le prompt de chaque session : appeler d'abord l'outil avec `{"delegate": "<id du parcours>", "group": "<id du groupe>", "main": "[ref]"}` (`main` : la discussion principale, depuis la 0.45.0, par sa seule référence depuis la 0.56.0 ; chaque réponse de l'outil rappelle alors comment la joindre) ; puis faire les tickets du groupe dans l'ordre, chacun avec `/mattpocock-skills:tdd`, les contrôles, `/mattpocock-skills:code-review` sur le seul ticket (même pour un petit diff) et un commit ; pour un ticket qui touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence), la passe « bogues » `/code-review <niveau>` (voir le tableau des revues) part dans le même message que cette revue, sur le même périmètre, avec le chemin du fichier des choix déjà déclarés (depuis la 0.54.0 ; avant, leur liste) et la consigne des relecteurs ; une fois tous commités, lancer elle-même `/code-review high --fix` sur le groupe, dans un sous-agent relecteur (general-purpose, Opus, effort high depuis la 0.52.0) qui applique lui-même ses correctifs (depuis la 0.49.0 ; le seul sous-agent qui écrit), avec cette même liste et la consigne de se concentrer sur les interactions entre les tickets (elle ne tranche pas un conflit entre la spec et une consigne : elle le remonte, depuis la 0.46.0), puis relire le diff de ses correctifs, relancer les contrôles et les commiter ; puis, si elle la juge utile, confier la revue de sécurité à un sous-agent relecteur (general-purpose, Opus, lecture seule ; effort `xhigh` jusqu’à la 0.57.1, `high` ou `xhigh` selon la méthode depuis la 0.58.0) limité à `git diff <base>..HEAD`, avec les critères de `/security-review`, sans corriger ses failles (depuis la 0.45.1 ; avant, elle lançait `/security-review`, qui calcule son diff contre la branche par défaut et relisait aussi les autres groupes) ; sans autre sous-agent qui écrit ; écrire chaque script par Write puis le lancer par une commande simple, avec le chemin absolu de son dossier temporaire écrit en clair (lu une fois par `printenv CLAUDE_JOB_DIR`) ; donner un délai maximal à chaque commande longue et ne jamais rendre la main en attendant un processus d'arrière-plan qui n'en a pas (le surveiller par Monitor ou l'arrêter, depuis la 0.54.0) ; et finir par un compte rendu (tickets, revue du groupe, revue de sécurité), envoyé par SendMessage et, depuis la 0.54.0, déposé aussi par l'outil (`{"report": "…"}`) dans le relais du parcours. Depuis la 0.38.0, les étapes d'`/implement` sont écrites en clair : `/mattpocock-skills:implement` est réservé à l'utilisateur, une session ne peut pas le lancer par l'outil Skill.
- pendant le travail, suivre chaque session par l'état git de son worktree, le tracker et `ListAgents`, jamais par `claude logs` (depuis la 0.54.0) ; un compte rendu perdu en route (discussion renommée ou redémarrée) revient par le relais : tant que son groupe n'est pas rendu, chaque réponse de l'outil dans la discussion principale cite le compte rendu déposé, en entier la première fois et à chaque reprise, puis en une ligne qui renvoie au relais ;
- à la note de fin, dans la discussion principale : vérifier dans le compte rendu de la session que la revue du groupe a tourné (sinon, la lui demander) avant de fusionner sa branche, puis rendre le groupe (`set`, `returned`) et envoyer l'avis et les constats de sécurité de la session (`security`).

**Brief des sessions liées (depuis la 0.56.0).** Dans un dépôt git, la discussion principale écrit en tête du background l'installation de worktree que le projet déclare : c'est la première commande de la session, avant toute lecture (le document des sessions déléguées manquait tant qu'elle n'avait pas tourné), ou la mention qu'il n'y en a pas. La discussion principale est désignée par sa seule référence `[ref]` (aussi dans `main` de `delegate`), résolue par `ListAgents` : son nom pouvait être périmé. Le compte rendu complet va au relais (`{"report"}`) ; SendMessage et la réponse finale n'en portent qu'une ligne qui y renvoie (décision du 26/10/2026, « Le relais »). La session pose ses questions sensibles avant le premier ticket ; elle relance un relecteur sans nouvelles depuis 10 à 15 minutes (SendMessage, ou son axe seul) ; elle attend un sous-agent par sa notification, sans Monitor ; elle saute `/mattpocock-skills:tdd` pour un ticket sans comportement testable ; elle passe par Edit pour une modification unique, par un script au-delà de quelques remplacements liés ; pour un visuel à valider, elle produit une planche, l'intègre de façon réversible, déclare le choix et laisse la validation au retour. Au retour, une faille de sécurité corrigée après coup se renvoie à l'outil (`security`, `fixed`), sinon le tableau de bord gardait « 0 corrigé ».

**Cycle de vie (depuis la 0.56.0).** Après un rechargement du mod (`/reload-plugins`), la première réponse de l'outil dit l'état retrouvé (« State found after a plugin reload: N tickets, M groups, phase … ; nothing to send again ») et sa description dit qu'un rechargement ne demande jamais de tout renvoyer : le 22/10, l'état était intact, mais Claude avait tout renvoyé par précaution. Le rechargement se reconnaît à un tableau de bord déjà en mémoire au démarrage des hooks, hors d'un `/clear` (que `session.start` suive bien un `/clear` reste à confirmer) ; que `session.start` passe bien à `/reload-plugins` reste à confirmer. La pause au redémarrage (0.48.0) ne change pas. Un groupe confié s'affiche « ↗ en cours · session liée » dès que l'id de sa session est relevé, et le bandeau le compte (« ↗A 0/2 ») avant même le premier signal relayé. Un groupe rendu par sa session liée, une fois relu, a un bouton « ✕ Fermer la session et le worktree » : il met dans le prompt une demande à Claude, qui vérifie d'abord (la ligne de `groupe-<id>` dans `git worktree list` et ses commits ; `git branch --merged` liste sa branche ; `git -C <worktree> status --porcelain --ignored` est vide, des fichiers ignorés se listent à la personne avant tout retrait), puis seulement arrête la session (`claude stop <id>`, sa conversation est gardée ; une session de l'app, id `local_…`, se ferme à la main, aucun outil connu ne l'arrête : Claude attend que la personne confirme qu'elle est fermée), refait la vérification de `status --porcelain --ignored` une fois la session arrêtée, et retire le worktree par `git worktree remove`, sans rien forcer ; sinon il n'arrête et ne retire rien, et le dit. La branche reste ; sans git, seule la session se ferme. Le bouton laisse ensuite place à « fermeture demandée ». Le mod n'a pas d'API pour arrêter une session : il ne peut que le demander.

**Titre des sessions liées** (depuis la 0.37.0). Toute session liée (groupe, bug, pistes de la rétro) a un titre qui commence par le titre du parcours, coupé à 28 caractères (« … » au-delà), puis « › » : « Tickets lots, espace privé… › Groupe A · File d'attente ». Dans la liste des discussions, les sessions filles d'une même discussion mère se reconnaissent ainsi. Les guillemets, `$`, `\` et accents graves du titre du parcours en sont retirés, puisque le titre passe aussi entre guillemets dans `claude --bg -n`. Le groupe de la session se lit après le dernier « › » : un titre de parcours qui nomme lui-même un groupe (« Revue du groupe P ») ne trompe pas le tableau de bord.

Confier un groupe fait passer le parcours en phase Implémentation s'il n'y est pas encore (depuis la 0.35.1 ; avant, il restait sur Tickets). `delegate` met la session liée à part : ses skills n'ouvrent ni ne reprennent aucun parcours, et l'outil n'y enregistre rien (il répond qu'il ne faut plus l'appeler) ; son panneau dit « ↗ Session liée du parcours « … » », et son bandeau « ↗ Session liée · « … » » (depuis la 0.35.1 ; avant, « Aucun workflow sélectionné »). Une session dans un worktree a son propre fichier de parcours (sa racine est celle du worktree) : `delegate` la met à part quand même, et lit le titre du parcours dans le board du dépôt principal (depuis la 0.35.0). **Avancement en direct** (depuis la 0.36.0). La session liée n'écrit pas sur le parcours, mais elle relaie son avancement dans un fichier à part (`~/.claude/flow-board/relais/<id du parcours>.json`, une entrée par session) : les statuts de ses tickets d'après ses mises à jour Asana (ligne « Statut : », cochage), ses commits et ses tests, sa fin de session. Un statut changé sans mise à jour Asana peut partir par `{"set": [...]}`, un choix fait sans toi par `{"decided": [...]}` (depuis la 0.44.0), et le compte rendu final par `{"report": "…"}` (depuis la 0.54.0) ; le reste d'un appel de l'outil est refusé. Un choix relayé s'affiche aussitôt dans « ⚑ Décidé sans toi » de la discussion principale, avec « (↗ Groupe A) », et compte dans le « à relire » du bandeau. « ✓ Relu » l'enregistre relu dans le parcours ; sinon, il s'y enregistre au retour du groupe (`returned`), à relire, avec une ligne au journal. La discussion principale relit ce fichier toutes les 5 secondes tant qu'un groupe est confié : ses tickets et le bandeau (« ↗A 1/4 ») le montrent (voir plus bas ; jusqu'à la 0.39.0, une ligne « ↗ il y a 2 min · 1/4 faits · … » et des tickets « fait ↗ à vérifier »). Une session terminée avec des tickets ouverts passe en ambre. Ces statuts restent un affichage : ils n'entrent pas dans les tickets du parcours, pour qu'un ticket fait dans une branche pas encore fusionnée ne libère pas ceux qui l'attendent. Un relais plus ancien que l'envoi du groupe (session précédente) est ignoré.

**Affichage d'un groupe confié (depuis la 0.40.0).** Les tickets relayés comptent à l'affichage : le compteur du haut, celui du groupe et le bandeau les incluent. Un ticket fait dans la session prend la coche verte et le titre grisé, sans libellé ; un ticket en cours garde « ◉ en cours ↗ ». Fait ainsi, il lève ses dépendances dans son groupe, mais pas dans les autres groupes, qui travaillent sur une autre branche. Le parcours enregistré, lui, n'avance qu'au retour du groupe. Le groupe confié montre tous ses tickets, ne dit plus « ↩ cette discussion », et son en-tête passe de « ↗ en cours · session liée » (« ↗ session liée au travail » avant la 0.56.0) à « ↗ session terminée il y a … » (ambre) si la session s'arrête avec des tickets ouverts, ou « ↗ session terminée · à rendre » s'ils sont tous faits ; la ligne bleue « ↗ il y a … · 1/4 faits · … » a disparu. Tant qu'une session liée travaille, l'état de l'en-tête dit « Session liée au travail ».

Le parcours reste dans la discussion principale, seul écrivain : à la note de fin de chaque session, Claude y vérifie le travail, puis envoie les statuts des tickets dans `set` avec `{"returned": ["<id du groupe>"]}`, qui rend le groupe au tableau de bord. Pendant ce temps, la discussion principale peut confier d'autres groupes ou travailler sur un groupe qui ne partage rien avec ceux qui sont dehors.

**Reprise après une interruption**

Si une discussion s'arrête au milieu d'un ticket, le parcours garde son état : tickets faits, ticket en cours, file lancée. Le travail commencé reste dans la copie de travail, non commité. À la reprise (« ↻ Reprendre », puis `/implement`), la consigne donnée à Claude indique l'état de chaque ticket de la file. Claude saute les tickets faits, et pour un ticket en cours, il regarde `git status` et `git diff` avant d'écrire, pour reprendre le travail déjà fait. Relancer `/implement` remet aussi les étapes à zéro.

**Étapes ticket par ticket**

Pendant `/implement`, les étapes (lire spec et ticket, boucle TDD, contrôles, revue du ticket, commit et suivi) valent pour le ticket en cours. Depuis la 0.40.0, la carte de l'Implémentation n'affiche plus l'étape en cours, ni le ticket en cours au-dessus d'elles : les groupes partent en parallèle ou en sessions liées, et les vagues et les groupes disent où en est chacun. Le mod les suit toujours (consigne à Claude, reprise après interruption). Quand le ticket suivant passe en cours, elles repartent de la première. Sont comptées comme contrôles : un lint ou un typecheck au vert, et la suite de tests complète au vert ; des tests ciblés (un fichier, un filtre) restent dans la boucle TDD.

Depuis la 0.46.0, la carte de l'Implémentation montre l'ordre des choses en deux lignes grisées : « Par ticket : Lire spec et ticket › Boucle TDD › Contrôles › Revue du ticket › Commit et suivi », puis « Par groupe, ses tickets faits : Revue du groupe ∥ Revue de sécurité › Rendu du groupe » (depuis la 0.56.0, « ∥ » : la revue de sécurité part dans le même message que la revue du groupe). Le contenu de chaque étape est la consigne envoyée à Claude avec le skill (`hint` de `catalog.ts` ; `groupSteps` pour ce qui suit chaque groupe) : c'est là que vit la règle des revues ; la règle des lots (`config/rules/flow-board.md`) en résume les allègements et renvoie à ces étapes pour le reste.

**Les revues**

Modèle et effort des relecteurs, fichier de consignes, cible (une plage `<base>..HEAD`, jamais un hash seul), zone sensible sans `--fix` et écritures : section « Revues dans un sous-agent Opus, effort selon l'enjeu » de [`config/rules/agents.md`](../../config/rules/agents.md). Les consignes de flow-board y renvoient depuis la 0.56.0.

| Quand | Commande | Ce qu'elle vérifie | Où elle apparaît |
|---|---|---|---|
| Chaque ticket, avant son commit (après, pour un ticket hors zone sensible, depuis la 0.56.0 : cible `<commit d'avant>..<commit du ticket>`, correctifs dans un commit à part) | `/mattpocock-skills:code-review` (axes Standards et Spec), lancée par Claude, point fixe : le commit d'avant le ticket | Le code du ticket face à son ticket (axe Spec) et aux standards du dépôt | Étape « Revue du ticket » de l'Implémentation |
| Chaque ticket qui touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence), avant son commit | Passe « bogues » : `/code-review <niveau>` de Claude Code (niveau `xhigh` de la 0.52.0 à la 0.58.0 ; depuis la 0.59.0, `xhigh` si le ticket supprime des données ou touche la concurrence, sinon `high` ou `xhigh` selon le critère d'effort de la méthode de sécurité), lancée par Claude **dans le même message** que la revue du ticket, sur le même périmètre, avec les choix déjà déclarés à ne pas resignaler (depuis la 0.45.1 ; depuis la 0.54.0, le chemin de leur fichier et la consigne des relecteurs) | Les bugs du diff du ticket, que les axes Standards et Spec ne cherchent pas | Une ligne du journal (« Passe « bogues » du ticket en cours ») ; depuis la 0.46.0, elle ne marque plus aucun groupe relu, ici comme dans une session liée |
| Chaque groupe fini | `/code-review high --fix` de Claude Code (sans `--fix` pour un groupe qui a un ticket sensible, bouton compris, depuis la 0.56.0) (niveau `high` depuis la 0.52.0), lancée par la personne dans la discussion du groupe ; pour un groupe en session liée, par la session elle-même (depuis la 0.38.0) ; dans un sous-agent relecteur (voir la règle) qui applique lui-même ses correctifs, que Claude relit et commite (depuis la 0.49.0) ; avec les choix déjà déclarés (depuis la 0.54.0, le chemin de leur fichier et la consigne des relecteurs), centrée sur les interactions entre les tickets | Les bugs sur le diff du groupe, y compris avec les groupes déjà faits ; `--fix` applique les correctifs à la copie de travail ; un conflit entre la spec et une consigne (CLAUDE.md, ta demande) n'est pas tranché : la revue ne corrige pas ce point et te le remonte | En-tête du groupe fini : « ◆ Revue du groupe · /code-review high --fix » (ou `high` sans `--fix` pour un groupe sensible), puis « ✓ revu » (plus dans la carte « Ensuite » depuis la 0.42.0) |
| Un groupe relu, si Claude la juge utile (facultative) | Depuis la 0.46.0, un sous-agent relecteur en lecture seule (voir la règle) que Claude lance lui-même, dans la discussion principale comme dans une session liée, limité à `git diff <base du groupe>..HEAD` ; plus `/security-review`, qui calcule son diff contre la branche par défaut | Les failles de sécurité du diff ; il rend un rapport sans rien corriger : tu décides de leur correction | Sous le groupe fini : « conseillée » et la raison de l'avis, ou « sécurité jugée inutile » ; puis « ⛨ sécurité relue », avec ses constats. Le bouton « ⛨ Revue de sécurité · sous-agent relecteur » (ou « La lancer quand même ») la demande à Claude s'il ne l'a pas lancée |

**Revues sans git (depuis la 0.46.1).** Dans un projet qui n'est pas un dépôt git, aucun commit ne marque le début d'un ticket : les consignes (étapes d'`/implement`, passe « bogues », revue du groupe, revue de sécurité, brief des sessions liées, boutons) remplacent le commit par une copie. Avant de toucher au premier fichier d'un ticket, Claude copie les fichiers qu'il va modifier dans le dossier temporaire de la session (chemin absolu), un sous-dossier par ticket qui garde le chemin dans le projet. Le point fixe d'un ticket est sa copie ; celui d'un groupe est, fichier par fichier, la plus ancienne copie parmi ses tickets. Les revues lisent la différence entre la copie et le fichier actuel (`git diff --no-index` marche hors d'un dépôt) au lieu de relire les fichiers entiers ; un fichier créé par le ticket n'a pas de copie et se lit en entier. Dans un dépôt git, les consignes ne changent pas. La mesure vient de `$.session.repo()`, prise au moment où la consigne part.

La revue d'un groupe n'est pas une phase de la feuille de route : c'est un événement de l'Implémentation. Lancer `/code-review` marque relus les groupes finis, en priorité ceux de la file lancée dans la discussion ; sans groupes, c'est le lot entier, une fois tous ses tickets faits. « Version et push » n'est proposé qu'une fois les groupes faits et relus. La consigne d'`/implement` demande à Claude la revue de chaque ticket, et de ne lancer `/code-review` lui-même que pour la passe « bogues » d'un ticket sensible. Un `/code-review` chargé pendant qu'un ticket est en cours dans la discussion, à son étape Contrôles ou Revue du ticket (ou, dans une session liée, pendant qu'un ticket relayé l'est) est cette passe « bogues » : il ne marque aucun groupe relu (depuis la 0.46.0).

**Relecture de branche (depuis la 0.28.0).** `/code-review` de Claude Code lancé **sans parcours en cours** dans la discussion (bouton « Relire une branche ou une PR » du lanceur, qui le met dans le prompt sans `--fix` : ajouter la cible et les options) ouvre le parcours « Relecture de branche ». Pendant un parcours, la même commande reste la revue du groupe.

**Avis sécurité sans groupes (depuis la 0.28.0).** Dans un parcours sans groupes (Relecture de branche, et la phase Revue de Chasse au bug, TDD ou Revue de code), Claude juge si une revue de sécurité vaut la peine pour **tout le lot**, une fois la revue faite, et la lance lui-même si oui (sous-agent relecteur limité aux changements relus, depuis la 0.46.0) ; l'avis et le bouton « ⛨ Revue de sécurité » s'affichent dans la carte de la phase, puis « ⛨ sécurité relue ».

**Revues d'un groupe en session liée (depuis la 0.38.0).** La session liée lance elle-même `/code-review --fix` une fois ses tickets commités, puis (depuis la 0.56.0 : dans le même message) la revue de sécurité si elle la juge utile (un sous-agent relecteur depuis la 0.45.1) ; elle ne corrige pas les failles trouvées, qui vont dans son compte rendu. De la 0.49.0 à la 0.58.0, `/code-review --fix` tournait dans un sous-agent relecteur qui lançait la revue et écrivait ses correctifs ; depuis la 0.59.0, la session la lance elle-même par l'outil Skill (exécution dérivée, à l'effort de son niveau `high`), sans sous-agent qui l'enveloppe (il refaisait l'analyse), puis relit le diff de ses correctifs, relance les contrôles et les commite. Le chargement de ces revues dans la session part au relais : la ligne du groupe affiche « ◆ revu » et « ⛨ sécurité relue ». Quand la discussion principale rend le groupe (`returned`), une revue relayée depuis l'envoi du groupe compte comme la sienne : le groupe est relu, et « Version et push » n'attend plus. Sans revue relayée, le groupe rendu attend sa revue, et la réponse de l'outil le dit à Claude.

**Groupe rendu sans revue (depuis la 0.39.0).** Un groupe fait par une session liée garde cette trace (`delegated`) une fois rendu. S'il revient sans revue, son bouton n'est plus « ◆ Revue du groupe · /code-review --fix » : dans la discussion principale, sa branche est déjà fusionnée, et `/code-review` sans cible n'aurait rien à lire tout en marquant le groupe relu. Le bouton devient « ◆ Revue du groupe · session liée ». Il met dans le prompt une demande à Claude : retrouver la session (ListAgents), lui faire remettre sa branche au niveau de la branche principale, lancer `/code-review --fix` sur les seuls commits du groupe, elle-même par l'outil Skill (depuis la 0.59.0, sans sous-agent qui l'enveloppe), relire ses correctifs et les commiter, puis la revue de sécurité par un sous-agent relecteur si utile. Au compte rendu, Claude fusionne et envoie `{"reviewed": ["<id>"]}`, qui marque le groupe relu, et `security`. Depuis la 0.43.0, quand le compte rendu final de la session dit que la revue du groupe a tourné mais que le relais ne l'a pas vue, Claude envoie `reviewed` avec `returned`, dans le même appel : le groupe revient relu, sans bouton de revue. Les groupes faits dans la discussion gardent le bouton `/code-review --fix`. Un groupe rendu avant la 0.39.0 retrouve cette trace dans le journal du parcours (« ↩ Groupe A rendu par sa session liée »), depuis la 0.42.0. À confirmer à l'usage : que `/code-review` sans cible relise bien, dans un worktree, la branche face à sa base (le brief dit sinon de lui donner le nom de la branche) ; et, depuis la 0.49.0, qu'un sous-agent general-purpose puisse lancer `/code-review --fix` par l'outil Skill et y appliquer ses correctifs.

**Revues allégées (depuis la 0.56.0).** Un groupe d'un seul ticket envoyé avec `"sensitive": false` et `"logic": false` (une icône, un document) n'a pas de revue du groupe : la revue de son ticket suffit, et la ligne du groupe fini affiche « ✓ revu par son ticket » au lieu du bouton. La revue d'un ticket se fait dans un seul relecteur pour les deux axes, quelle que soit la taille du diff (depuis la 0.59.0 ; avant, sous 100 lignes seulement) : il lit `CODING_STANDARDS.md` en plus du `CLAUDE.md` et rend ses Mineurs en un compte. La revue de sécurité, en lecture seule, part dans le même message que la revue du groupe ; depuis la 0.59.0, elle ne relit le diff des correctifs de la revue du groupe que s'il touche une zone coûteuse de sa méthode ou dépasse 150 lignes hors tests. Les constats sur du code antérieur au lot sont classés à part par les relecteurs, non corrigés, et proposés en fin de lot comme un groupe « durcissement ».

**Constats triés (depuis la 0.57.0).** La consigne des relecteurs leur fait étiqueter chaque constat « Important », « Nit » (mineur) ou « Pre-existing » (antérieur au lot). Seuls les importants sont corrigés ; les remarques mineures (style, nommage, nettoyage sans effet sur le comportement) sont listées sans être corrigées, pour qu'elles ne coûtent ni commit ni nouveau tour de revue. Pour un défaut, le relecteur nomme sa classe, pour que toutes ses occurrences soient corrigées.

La revue de sécurité ne bloque jamais la livraison et n'est jamais la suite proposée. Avec `/code-review --fix` d'un groupe (avant la 0.56.0 : une fois passé), Claude juge si une revue de sécurité en vaut la peine (authentification, droits ou règles d'accès, entrées de l'utilisateur jusqu'à une requête, un chemin ou du HTML, secrets, accès réseau ou fichiers, envois de fichiers, dépendances), le dit en une ligne et l'envoie au tableau de bord. Depuis la 0.46.0 (décision de Mathis du 15/10/2026), il la lance alors lui-même, partout : un sous-agent relecteur (general-purpose, Opus, lecture seule ; effort `xhigh` jusqu’à la 0.57.1, `high` ou `xhigh` selon la méthode depuis la 0.58.0) limité à `git diff <base du groupe>..HEAD`, qui ne corrige rien ; avant, la personne lançait `/security-review`, qui relit toute la branche face à la branche par défaut. Claude dit ce que le sous-agent a trouvé, ne corrige qu'avec ton accord et crée une tâche pour chaque faille laissée ouverte. Un `/security-review` tapé à la main reste reconnu. Le compte rendu donne, groupe par groupe, ce qu'il en est.

**Méthode de la revue de sécurité (depuis la 0.58.0).** Le relecteur suit une méthode fixe, `reference/revue-securite.md` dans le dossier du mod, dont le chemin va dans son prompt à côté de son fichier de consignes ; les consignes du mod (avis après la revue d'un groupe ou du lot, brief des sessions liées, bouton « ⛨ Revue de sécurité ») la citent sans la recopier. Elle reprend celle de `/security-review` de Claude Code (catégories, gravité, exclusions, une sous-tâche qui cherche puis une sous-tâche de vérification par faille, en parallèle, seuil de confiance 8/10, rapport `fichier:ligne` avec scénario d'attaque et recommandation) et garde la plage exacte du groupe, le contexte du projet, les choix déclarés et la lecture seule. Les dépendances et les données sensibles sur disque restent cherchées ; l'absence de durcissement, les failles notées 5 à 7 et celles de gravité basse vont dans une liste « à surveiller ». L'effort, `high` ou `xhigh`, se choisit par le critère du fichier (l'enjeu, la taille), le même pour le relecteur et ses vérifications, et le rapport le dit en tête. Chaque faille gardée arrive numérotée (F1, F2…) avec un correctif prêt : une réponse comme « corrige F1 et F3 » suffit pour que Claude les applique, les teste et les commite. `findings`, envoyé à l'outil flow, ne compte que les failles gardées, pas la liste « à surveiller ».

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
- **Là où l'on code** (depuis la 0.59.1) : l'encadré mesure le worktree de la session quand elle travaille dans un autre worktree du dépôt que la racine du projet (par exemple `.claude/worktrees/dev`, le dossier principal restant sur `main` pour un service), et le nomme (« À jour avec origin/main dans .claude/worktrees/dev ») ; sinon, la racine du projet. Le refus, lui, se juge sur le worktree du fichier modifié (`git rev-parse --show-toplevel` depuis son dossier) : un worktree dont la branche contient déjà `origin/main` ne déclenche ni avis ni refus, même si le dossier principal est en retard.
- Si le distant a avancé :
  - un encadré l'indique, avec la commande à lancer ;
  - la première modification de code est refusée **une fois par avancée du distant**, pour que Claude demande le sync. Une seconde tentative passe.
- La commande proposée :
  - `/project:sync` d'abord, si la branche distante a bougé ;
  - `/project:sync base` ensuite, seulement si main est encore en avance après ce premier sync ;
  - sur main, sans aucun commit local en avance sur `origin/main` : une mise à jour en avance rapide, `git pull --ff-only` dans ce dossier, au lieu de `/project:sync`. Le bouton met dans le prompt une demande à Claude ; le refus lui dit de la proposer et d'attendre l'accord. Quand l'avance ne se mesure pas, `/project:sync` reste proposé.
- Sans dépôt git, sans distant ou sans réseau, rien n'est demandé. Sans distant `origin`, l'encadré « À jour » n'est pas affiché non plus : il n'y a rien à quoi se comparer.
- flow-board fonctionne avec n'importe quel hébergeur git (GitHub, GitLab, Bitbucket, serveur maison) : seule la phase « Pull request » est propre à GitHub.

---

## Plusieurs discussions sur un même projet

- Le stockage est partagé : chaque discussion fusionne sa copie au lieu de l'écraser. Pour chaque parcours, la version la plus récente l'emporte, et une suppression est mémorisée.
- Les parcours enregistrés par les autres discussions sont relus toutes les 5 secondes.
- Chaque discussion a son propre parcours en cours. Celui d'une autre discussion apparaît « ⇆ autre discussion », et « Reprendre ici » le récupère.
- **Un parcours n'est suivi que par une discussion à la fois.** « Reprendre ici » le retire à l'autre discussion, qui n'enregistre plus rien sur lui. Pour faire avancer plusieurs groupes en même temps, passer par « ⇉ … en parallèle » : des sessions liées qui travaillent pour la discussion principale sans écrire sur le parcours (`/implement-spec` dans un dépôt git ne sert plus qu'à une sélection de tickets, depuis la 0.60.0). Un ticket qu'une autre discussion a laissé « en cours » s'affiche « ⇆ autre discussion ».
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
| `/flow rename <titre>` | Renomme le parcours en cours, titre déjà posé compris ; la discussion suit si le parcours y est né et qu'aucune session liée n'a été demandée (voir « Titre du parcours et de la discussion »). |

**Dès le premier message : `/flow-board:flow`.** `/flow` est déclaré par le mod au démarrage de la session. Sur le desktop, ce démarrage n'a lieu qu'à l'envoi du premier message : avant, `/flow` n'apparaît pas dans le menu. `/flow-board:flow`, déclaré par le fichier `commands/flow.md`, est disponible tout de suite et accepte les mêmes arguments (`/flow-board:flow history`…). Le mod y répond lui-même, sans passer par le modèle. Une fois le mod démarré, `/flow` sort du menu pour éviter le doublon, mais reste utilisable tapée en entier : les deux font la même chose.

---

## Données et stockage

| Donnée | Emplacement | Portée |
|---|---|---|
| Parcours du projet | `~/.claude/flow-board/parcours/<racine du projet>.json`, un fichier par projet | Partagée par toutes les discussions, desktop comme CLI |
| Ancien stockage (secours) | `~/.claude/plugins/store/flow-board_<source>-<hash>.json`, clé `board:<racine du projet>` | Utilisé seulement si le fichier commun est hors d'atteinte ; versé une fois dans le fichier commun |
| Relais des sessions liées (depuis la 0.36.0) | `~/.claude/flow-board/relais/<id du parcours>.json`, une entrée par session liée (compte rendu final compris, depuis la 0.54.0) ; à défaut `$.store`, clé `relay:<id du parcours>` | Écrit par chaque session liée pour son entrée, lu par la discussion principale |
| Choix déclarés (depuis la 0.54.0) | `~/.claude/flow-board/choix/<id du parcours>.md` | Écrit par la discussion principale, lu par les sessions liées et les relecteurs |
| Registre des agents (depuis la 0.58.0) | `~/.claude/flow-board/agents/<session>.json`, découpé en `<session>.1.json`, `.2.json`… au-delà de 3 Mo ; à défaut `$.store`, clé `agents:<session>` | Écrit par sa session seule (relu et fusionné à chaque écriture), lu par l'onglet Agents de toutes les discussions du poste |
| Fichiers à part (depuis la 0.58.0) | `~/.claude/flow-board/agents/<session>.rebuilt.json` (ce que le rattrapage reconstruit pour une autre session) et `run-<parcours>.rebuilt.json` (les anciens sous-agents d'un parcours) | Écrits seulement par le rattrapage et la reprise, relus et fusionnés à chaque écriture |
| Traces d'effacement (depuis la 0.58.0) | `~/.claude/flow-board/agents/<id>.<date>.erased.json` : l'id effacé (session, parcours, sous-agent) et la date, rien d'autre ; un fichier par trace, jamais réécrit | Respectées par toutes les lectures et par le rattrapage |
| Prix des modèles (depuis la 0.58.0) | `$.store`, clé `agentPrices`, relevés par ccusage au plus une fois par jour | Toutes les discussions du poste |
| Parcours en cours, onglet, sélection, mesure git | État de session (`$.state`) | Une discussion |

Pourquoi un fichier à part : `$.store` range ses données selon la façon dont le mod est chargé. Le desktop passe ses plugins aux sessions (`inline`), le CLI charge le plugin installé (`mathis-plugins`) ; chacun avait son propre stockage, et un parcours créé dans l'un n'existait pas dans l'autre. Le fichier commun est trouvé à partir de l'emplacement du mod, toujours sous `~/.claude`. Au premier démarrage de chaque mode de chargement, son ancien `$.store` est fusionné dans le fichier commun (marque `migrated:board:<racine>` dans `$.store`).

Un parcours n'est plus supprimé : il est archivé. Les archives ne comptent pas dans les 15 parcours d'un projet (jusqu'à 100 archivés gardés), ne sont ni proposées à la reprise ni reprises par un skill ; « Reprendre » sur un archivé le désarchive. À la fusion entre discussions, une ancienne trace de suppression n'efface plus un parcours touché après elle.

Limites appliquées : 15 parcours par projet ; par parcours, 150 tickets, 40 tâches trouvées en route, 30 choix « décidé sans toi », 12 groupes (12 fichiers chacun), 80 lignes de journal et 40 livrables.

**Conservation et effacement des agents** (depuis la 0.58.0) : l'historique des agents n'a ni limite de nombre ni d'âge, et archiver un parcours n'y touche pas. Supprimer un parcours efface ses agents, ceux de ses sessions liées, ses lancements, son relais et ses choix ; « ✗ Oublier » efface une discussion passée et ses sessions liées reconnues sûrement (pas celles reconnues par leur seul titre). Un fichier effacé est d'abord réécrit vide, puis supprimé par `rm` (`del` sous Windows) ; sans commande, ou si elle échoue, le fichier vide reste. Une session encore ouverte n'est jamais touchée par une autre : elle relit les traces avant chacune de ses écritures et se compacte elle-même ; une fois fermée (30 min sans écriture ni sous-agent au travail, ou fin connue), ce qui reste se reprend. Si les traces ne peuvent pas toutes s'écrire, celles déjà posées sont retirées et l'effacement est annulé ; une session ouverte a pu se compacter d'après elles entre-temps, et le message le dit (si le retrait échoue aussi, il dit « effacement partiel »). Pendant l'effacement, la discussion qui efface affiche « ⏳ Effacement en cours » ; un second effacement du même parcours ou de la même discussion ne fait rien tant que le premier tourne. Avant d'effacer un parcours, « Supprimer » relit les transcripts des discussions qui l'ont porté, pour qu'un sous-agent manqué parte aussi ; un transcript illisible n'arrête rien et se dit. Les transcripts de Claude Code ne sont jamais touchés.

**Confidentialité des agents** : le registre garde les descriptions, les prompts (8 000 caractères au plus) et des arguments courts d'outils, jamais un rapport ni un texte de message ; les secrets reconnaissables (en-têtes `Authorization` et `Cookie`, `Bearer x`, `--token`, `password=`, `token: …`, `curl -u`, `mysql -p`, blocs PEM, jetons) y sont masqués (« ‹masqué› »), une valeur entre guillemets en entier. Sur Mac et Linux, le dossier `~/.claude/flow-board/agents/` est fermé aux autres comptes (`chmod 700`, retenté à l'écriture suivante s'il échoue) ; sous Windows, ou sans `$.process.run`, ce réglage n'est pas fait. Le rattrapage ne lit que les transcripts rangés sous `<dossier de Claude>/projects/` (`CLAUDE_CONFIG_DIR`, sinon le dossier d'où le mod est installé), par un chemin absolu. Rien de ce dossier ne quitte le poste.

Le mod n'écrit ni dans les projets, ni dans Asana, ni dans git. Il ne fait que lire : `git fetch` met seulement à jour les références distantes. Pour le coût estimé, il lance `npx -y ccusage@20.0.30` (une fois par jour au plus, depuis le dossier du mod, registre npm officiel).

---

## Architecture

```
flow-board/
├── .claude-plugin/plugin.json   manifeste (nom, version, contrat de types)
├── commands/flow.md             /flow-board:flow, connue avant le démarrage du mod
├── hooks/
│   ├── hooks.json               déclare le module register.tsx
│   ├── register.tsx             branchement : événements, outil flow, commande /flow, stockage, git
│   ├── registry-file.ts         file d'écriture du registre des agents : lecture, morceaux, file, écriture différée
│   ├── catch-up.ts              rattrapage du registre par les transcripts, fichiers à part
│   ├── erase-run.ts             effacement d'un parcours ou d'une discussion : fichiers, clés, traces
│   ├── catalog.ts               les 27 skills mattpocock, les 4 commandes project, la revue de groupe et le compte rendu : étapes, couleurs, parcours
│   ├── model.ts                 moteur : transitions pures du parcours (testables sans interface)
│   ├── view.tsx                 dessin du panneau et du bandeau, toutes surfaces
│   ├── svg.ts                   feuille de route, anneau, barres, indicateurs, pistes de la frise
│   ├── registry.ts              registre des agents : entrées, fusion, morceaux, lecture validée (pur)
│   ├── timeline.ts              frise : axe, pauses, parts, résumé, masquage des secrets (pur)
│   ├── cells.ts                 frise en grille de cases pour le terminal (pur)
│   ├── cost.ts                  prix unitaires tirés de ccusage, coût d'un sous-agent (pur)
│   ├── linked.ts                sessions liées : reconnaissance et état (pur)
│   ├── transcript.ts            rattrapage par les transcripts de Claude Code (pur)
│   ├── history.ts               historique : sélecteur, fichiers à part, vue d'un parcours passé (pur)
│   └── erase.ts                 effacement : traces, sessions fermées, confirmation (pur)
├── reference/revue-securite.md  méthode fixe de la revue de sécurité, citée par son chemin
├── skills/compte-rendu/SKILL.md /flow-board:compte-rendu, le rapport à valider avant la livraison
├── types/index.d.ts             contrat de l'état (`PluginState`)
└── tests/                       423 tests `claude plugin test` et 9 tests `node --test` (0.59.0)
    ├── a-tout-moment.test.ts
    ├── accueil.test.ts
    ├── advisor.test.ts
    ├── archives.test.ts
    ├── brief-sessions-liees.test.ts
    ├── cadrage-zone-sensible.test.ts
    ├── chantier.test.ts
    ├── compte-rendu.test.ts
    ├── consignes-revue.test.ts
    ├── cout.test.ts
    ├── cycle-de-vie.test.ts
    ├── decisions.test.ts
    ├── defauts-demo.test.ts
    ├── dessin.test.mjs   (node --test : lit les sources, règles de dessin)
    ├── durcissement.test.ts
    ├── effacement-onglet.test.ts
    ├── effacement.test.ts
    ├── en-cours-parallele.test.ts
    ├── ensuite.test.ts
    ├── etapes.test.ts
    ├── externes.test.ts
    ├── flow-board.test.tsx
    ├── frise-onglet.test.ts
    ├── frise.test.ts
    ├── groupes-session-liee.test.ts
    ├── groupes.test.ts
    ├── historique-agents.test.ts
    ├── imbrication.test.ts
    ├── ligne-compacte.test.tsx
    ├── lisibilite.test.ts
    ├── livraison.test.ts
    ├── lots-sessions-liees.test.ts
    ├── masque-proprietes.test.ts
    ├── mise-de-cote.test.ts
    ├── multi-sessions.test.ts
    ├── ouverture.test.ts
    ├── parallele.test.ts
    ├── pas-de-groupe-seul.test.ts
    ├── pistes-session-liee.test.ts
    ├── rattrapage.test.ts
    ├── registre-agents.test.ts
    ├── registre-session.test.ts
    ├── relais-pistes.test.ts
    ├── relecture-branche.test.ts
    ├── renommer.test.ts
    ├── reprise.test.ts
    ├── retrait.test.ts
    ├── retro-livraison.test.ts
    ├── revue-groupe.test.ts
    ├── revues-allegees.test.ts
    ├── securite.test.ts
    ├── selection.test.ts
    ├── sessions-liees-agents.test.ts
    ├── sessions-liees-onglet.test.ts
    ├── suggestions.test.ts
    ├── suites-groupe-b.test.ts
    ├── suites-groupe-c.test.ts
    ├── suites-onglet-agents.test.ts
    ├── sync.test.ts
    ├── titre-renommage.test.ts
    ├── trouvailles.test.ts
    ├── types-detail.test.ts
    └── vagues.test.ts
```

Le moteur (`model.ts`) ne fait que des transitions pures : chacune prend le parcours, applique un signal et rend le nouveau parcours avec les effets d'interface à jouer. `register.tsx` relie ces transitions aux événements de Claude Code et écrit l'état de façon conditionnelle (`ifVersion`).

---

## Développement

```bash
claude plugin validate plugins/flow-board
claude plugin test plugins/flow-board
```

- Les tests montent le panneau et le bandeau sur les surfaces `terminal`, `desktop`, `vscode` et `mobile`. Ils simulent le stockage, git et une seconde discussion.
- Les modules qui touchent au moteur hors de `register.tsx` (`registry-file.ts`, `catch-up.ts`, `erase-run.ts`) suivent deux règles du chargeur de Claude Code : une fonction qui reçoit `$` et franchit un import s'écrit `function nom($, …) { … }`, jamais `const nom = ($, …) =>` (sinon le module ne charge pas) ; un fichier qui lit ou met à jour un atome le déclare lui-même, avec un plugin et une clé littéraux (le défaut partagé de l'interface est `EMPTY_UI`, dans `model.ts`). Un `let` importé ne s'écrit que par une fonction de son module (`markRebuildNeeded`, `clearHistoryShown`).
- Dans le kit de test, un hook qui remplace une opération du moteur (`store.get`, `session.id`, `process.run`…) doit rendre `{ value }`.
- Les versions précédentes sont dans l'historique git du dépôt ; celles d'avant le passage à git restent dans `~/.claude/mods-archives/flow-board-<version>` sur le PC Windows.

---

**Rétro de l'onglet Agents (depuis la 0.59.0).**
- **Instantané d'un ticket sensible** : avant sa passe « bogues », la session fige le ticket sur `refs/worktree/flow-board/<ticket>`, une référence propre à son worktree (`git add` de ses fichiers, index vérifié par `git diff --cached --name-only`, `git write-tree`, `git commit-tree -p HEAD`, `git update-ref`, chaque commande seule) ; les deux revues relisent `<ref>^..<ref>` et les fichiers à cette référence, et la session avance pendant ce temps ce qui ne touche aucun fichier du ticket (pas d'autre dossier : le garde-fou d'un worktree y refuse git). Au commit, chaque fichier du ticket se ré-ajoute, correctifs compris.
- **Fichiers à côté du relais** (`~/.claude/flow-board/relais/`) : `<parcours>.main.json`, la référence du moment de la discussion principale, écrite par elle seule à la reprise (`{"resume": …, "main": "[<ref>]"}`) et relue par chaque session liée à son appel de l'outil flow ; `<parcours>.<session>.report.md`, le compte rendu entier d'une session liée, écrit par elle seule. Supprimer le parcours efface les deux, leurs chemins calculés d'après les ids. Sans le dossier, la référence passe par `$.store` (`relay-main:<parcours>`) et le compte rendu reste coupé à 8 000 caractères, ce que la réponse dit.
- **`review`, `security` et `withdrawn` en session liée** : relayés ; au retour du groupe, les constats s'ajoutent aux statistiques de l'implémentation et la revue de sécurité vaut celle du groupe, sauf si la discussion principale en a déjà envoyé une.
- **Rétro** : lancée pendant le parcours de la discussion, elle ouvre son propre parcours, « Rétrospective · <parcours> », au lieu de reprendre un autre parcours en pause qui aurait une phase Rétro.
- **`/implement` d'un groupe déjà passé** : quand ses arguments nomment un groupe (« groupe B ») ou un id de ticket du parcours de la discussion, le parcours revient à son implémentation (nouveau tour) et son compte rendu redevient à faire.

## Limites connues

- **Animations.** Les dessins sont des images : sur le desktop, les animations SVG ne tournent probablement plus. Le mode interactif tournait, mais il donnait un fond blanc qui clignotait à chaque redessin.
- **Demande de sync.** Un fichier de code modifié par une commande shell, et non par l'outil d'édition, échappe au refus. La consigne donnée à Claude couvre ce cas. Depuis la 0.59.1, l'encadré suit le dossier de la session (`$.session.cwd()`) : qu'il suive un `cd` du shell vers un worktree reste à confirmer à l'usage, et un `cd` seul ne relance pas la mesure (elle attend la vérification suivante, toutes les 5 minutes, ou un `git fetch`, `pull`, `rebase` ou `merge`). Le refus « une fois par avancée du distant » garde une seule mémoire : des modifications qui alternent entre deux worktrees en retard tous les deux sont refusées une fois à chaque changement de worktree.
- **Ligne compacte de l'outil `flow`.** Claude Code ne dit pas à un mod si la vue détaillée (ctrl+o) est ouverte sur une ligne d'outil : la ligne compacte y reste, sans le JSON de l'appel.
- **Données de suivi.** Elles dépendent en partie des comptes rendus de Claude : étapes, éléments suivis, dépendances.
- **Trouvé en route.** Seules les créations par `create_tasks` d'Asana et `gh issue create` sont vues. Une tâche créée autrement (interface d'Asana, autre outil) n'apparaît que si Claude l'envoie au panneau.
- **Une discussion par parcours.** Deux discussions ne peuvent pas suivre le même parcours en même temps : un seul écrivain à la fois, sinon deux discussions qui cochent des tickets du même parcours s'écraseraient (la fusion garde le parcours le plus récent en entier). Le parallélisme des groupes passe par des sessions liées qui n'écrivent pas sur le parcours (`delegate`) ; `/implement-spec`, dans une seule discussion, ne lance plus qu'une sélection de tickets.
- **Groupes en session liée.** Le panneau ne suit pas les étapes d'une session liée (lecture, TDD, revue…). Depuis la 0.36.0, ses tickets, commits et tests s'affichent en direct, relayés ; les tickets du parcours n'avancent qu'au moment où Claude, dans la discussion principale, rend leurs statuts à sa note de fin. Le relais compte sur les mises à jour Asana de la session : un projet sans suivi Asana n'en montre que les commits et les tests, sauf `set` envoyé par la session. Plusieurs sessions liées écrivent le même fichier de relais : deux écritures simultanées peuvent perdre un signal, rattrapé au signal suivant de la même session (elle réécrit toute son entrée). Le mode `delegate` est propre à la discussion ; depuis la 0.56.0, il est gardé par session (`$.store`, clé `delegate:<session>`, trois jours au plus, jamais sur un parcours fini, lu dans le board du dépôt principal quand la session est dans un worktree) et revient quand le mod recharge le tableau de bord (à confirmer à l'usage avec `/reload-plugins` dans une session liée). Le mod ne connaît pas l'id d'application d'une discussion (`$.session.id()` donne celui de sa transcription) : pas de lien cliquable vers la discussion de découpage.
- **Pistes en session liée.** La session liée ne touche pas au tableau de bord : les pistes avancent dans le panneau quand Claude, dans la discussion principale, rend leur statut à la note de fin de la session, pas au fil de son travail. Une session lancée qui s'arrête sans note laisse ses pistes « en cours » : « ↻ Reprendre les pistes » demande à Claude de les rendre (faites ou écartées) pour pouvoir clore la rétro.
- **Discussion d'un ticket en cours.** Le mod ne lit le titre d'une discussion que dans ses propres hooks (`session_title`) : pour un ticket porté ailleurs, il dit « ici » ou « autre discussion », pas laquelle.
- **Stockage.** Le fichier dépend de la façon dont le plugin est chargé. Une session lancée autrement, par exemple en terminal, peut ne pas voir les mêmes parcours. Il est aussi propre à chaque machine : une discussion du PC ne peut pas confier un groupe à une session du Mac, même si les deux se parlent par `SendMessage`.
- **Heredocs.** Depuis la 0.35.1, le corps d'un heredoc n'est pas lu comme des commandes (un brief en prose cachait le `claude --bg` qui le suit) : des tests lancés dans un heredoc (`bash <<EOF` … `pytest` … `EOF`) ne sont donc pas relevés.
- **Sessions liées dans le CLI.** L'id n'est relevé que si `claude --bg` tourne au premier plan (une commande lancée en arrière-plan n'a pas de sortie lisible) ; sans id, le groupe reste « session liée à lancer » avec « Annuler », qui le rendrait relançable alors que la session travaille. Le mode de permission de la fille doit être celui de la discussion principale, sinon ses messages attendent ton accord.
