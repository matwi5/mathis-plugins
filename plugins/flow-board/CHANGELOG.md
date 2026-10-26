# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième. Chaque version précédente est sauvegardée dans `~/.claude/mods-archives/flow-board-<version>`.

---

## 0.57.0 — 2026-10-26

D'après l'article « How the Claude Code team does code review » (26/10/2026) : pour un auteur agent, une remarque mineure coûte un commit et un nouveau tour de revue, là où un humain l'écarte en une seconde.

### Modifié
- **Constats de revue triés** : la consigne des relecteurs (`REVIEWER_BRIEF`, et sa version française donnée aux sessions liées) leur fait étiqueter chaque constat « Important », « Nit » (mineur) ou « Pre-existing » (code antérieur au lot, déjà classé à part). Seuls les importants sont corrigés ; les remarques mineures (style, nommage, nettoyage sans effet sur le comportement) sont listées sans être corrigées. Pour un défaut, le relecteur nomme sa classe, pour que toutes ses occurrences soient corrigées et non la seule ligne relevée.

---

## 0.56.0 — 2026-10-26

Constaté le 26/10/2026 dans la rétro d'un parcours à 22 tickets et 7 sessions liées : `/code-review` tourne en exécution dérivée et ne reçoit que ses arguments, si bien qu'une revue `--fix` a modifié une route que le brief réservait au porteur, qu'une autre a relu un seul commit (un hash seul lui avait été donné), que des relecteurs ont relancé des tests et que l'un a modifié l'arbre de travail pour tenter une preuve rouge.

### Ajouté
- **Zone sensible et logique de chaque ticket** : la consigne de `/to-tickets` fait écrire à chaque ticket « Zone sensible : oui/non (pourquoi) » et « Logique : oui/non », envoyés à l'outil (`sensitive`, `logic`) et gardés avec le ticket ; un seul ticket sur quinze le disait, et l'avis « zone sensible » avait été suivi par un groupe et ignoré par un autre.
- **Étape « Conséquences sensibles »** au cadrage (`/to-spec`, grilling) : ce qu'un changement ou un retrait laisse derrière lui en zone sensible (fichiers en clair, journaux qui dépendent d'un mode, données gardées), chaque point devenant une question.
- **Fermer la session et le worktree d'un groupe rendu** : un bouton « ✕ Fermer la session et le worktree » sur la ligne d'un groupe rendu met dans le prompt une demande à Claude : `claude stop <id>` (une session de l'app se ferme à la main), puis `git worktree remove` sans rien forcer, seulement si l'arbre est propre et la branche fusionnée ; la branche reste. Des sessions de groupe restaient ouvertes après leur fusion. Le mod n'a pas d'API pour arrêter une session.

### Modifié
- **Commit avant la revue d'un ticket hors zone sensible** (choix de Mathis, « Non sensible seulement ») : la consigne du commit le fait passer dès les contrôles, avant la revue, pour que le ticket suivant démarre pendant qu'elle tourne ; ses correctifs arrivent dans un commit à part. Un ticket sensible garde sa revue avant son commit. Sans git, rien ne change.
- **Bouton « ◆ Revue du groupe » sans `--fix` pour un groupe sensible** (choix de Mathis, « Sans --fix si sensible ») : il mettait toujours `/code-review high --fix`. Il met `/code-review high` quand un ticket du groupe est sensible ou ne l'a pas dit (dans le doute, sensible), comme la carte « Ensuite » et la suggestion du prompt. Le commit avant la revue ne vaut que pour un ticket dit non sensible.
- **Rechargement du mod** : la première réponse de l'outil après un rechargement dit l'état retrouvé (tickets, groupes, phase, ou la délégation) et qu'il n'y a rien à renvoyer ; la description de l'outil le dit aussi. La pause au redémarrage ne change pas.
- **Groupe confié en cours** : « ↗ en cours · session liée » dès que l'id de sa session est relevé, et compté au bandeau avant le premier signal relayé.
- **Plus de filet `notify_when_idle`** : il avait réveillé la discussion principale cinq fois pendant un groupe, dont quatre pour rien ; le message final de la session suffit, le relais rattrape un message perdu.
- **Exposition vérifiée avant une question de confidentialité** : la consigne des skills de cadrage fait vérifier l'exposition réelle par un sous-agent en lecture seule ; sans cette vérification, la question la dit « à confirmer ».
- **`CLAUDE.md` hors des tickets de groupe** : la consigne de `/to-tickets` garde une écriture de `CLAUDE.md` hors du « Fini quand » d'un ticket de groupe (un ticket était resté 19 heures en attente) ; c'est un geste de la discussion principale.
- **Documents communs hors du parallélisme** : `README.md`, `DECISIONS.md` et la carte du code (`carte-du-code.md`, `CODEMAP.md`) n'empêchent plus deux groupes de tourner ensemble, et `/to-tickets` les laisse hors de `files`.
- **Groupe d'un seul ticket sans logique** : un groupe d'un seul ticket ni sensible ni avec logique n'attend plus de revue du groupe (« ✓ revu par son ticket ») ; un groupe d'une icône avait eu quatre revues Opus en cascade.
- **Seuil de taille** : les « moins de 100 lignes » qui font relire les deux axes par un seul relecteur se comptent par `git diff --numstat`, sans les fichiers générés ni les binaires (346 lignes de SVG généré avaient compté).
- **Sécurité avec la revue du groupe** : la revue de sécurité, en lecture seule, part dans le même message que la revue du groupe, puis relit seulement le diff des correctifs ; la carte affiche « Revue du groupe ∥ Revue de sécurité ».
- **Constats sur du code antérieur au lot** : la consigne des relecteurs les fait classer à part, sans les corriger ; ils sont proposés en fin de lot comme un groupe « durcissement » (6 tickets sur 22 en venaient, traités au fil de l'eau).
- **Brief des sessions liées** : installation du worktree déclarée par le projet en première commande, avant toute lecture ; discussion principale désignée par sa seule référence `[ref]`, résolue par `ListAgents` (aussi dans `main` de `delegate`, et dans la réponse de l'outil à la session) ; compte rendu complet au relais seulement, une ligne de renvoi par SendMessage et en réponse finale (il était écrit trois fois) ; questions sensibles avant le premier ticket ; relecteur sans nouvelles depuis 10 à 15 minutes relancé ; sous-agent attendu par sa notification, sans Monitor ; `/tdd` sauté pour un ticket sans comportement testable ; Edit pour une modification unique ; visuel à valider : planche, intégration réversible, choix déclaré, validation au retour.
- **Sécurité corrigée après coup** : au retour d'un groupe, la discussion principale renvoie `security` avec les failles corrigées après coup ; le tableau de bord affichait « 0 corrigé » pour deux constats corrigés ensuite.
- **Consignes de revue par un fichier** : chaque revue reçoit ses consignes (périmètre, chemin du fichier des choix, points réservés au porteur, interdits, consigne des relecteurs) dans un fichier du dossier temporaire, dont le chemin suit la cible : `/code-review <niveau> <base>..HEAD consignes : <chemin>` ; un relecteur lancé par l'outil Agent le reçoit dans son prompt. Forme essayée avec Claude Code 2.1.310 (niveaux `low` et `high`, avec et sans `--fix`) : le fichier est lu d'abord et ne devient pas la cible. Consignes d'`/implement`, des revues, brief des sessions liées, revue d'un groupe rendu, revues de sécurité.
- **Cible en plage** : la revue d'un groupe vise `<base>..HEAD` (le repli « lui donner le nom de la branche » disparaît) ; celle d'un groupe rendu, la plage de ses commits, jamais un hash seul.
- **Zone sensible sans `--fix`** : quand un ticket du groupe touche une zone sensible, la revue du groupe tourne sans `--fix` et son relecteur n'applique que les constats qu'il retient.
- **Consigne des relecteurs** : un relecteur n'écrit jamais dans l'arbre de travail, même un instant ; la preuve rouge reste à la session ; seules les revues de groupe écrivent leurs correctifs.
- **Renvois à la règle des revues** : le tableau des revues du README renvoie à la section « Revues dans un sous-agent Opus » de `config/rules/agents.md` au lieu de redire modèle et effort.

### Corrigé
- **Délégation gardée** : dans une session liée, `delegate` est gardé par session (trois jours au plus, jamais sur un parcours fini) et revient quand le mod recharge le tableau de bord ; il se perdait.

---

## 0.55.0 — 2026-10-26

### Modifié
- **Effort de la session de diagnostic de bug** : « 🐞 Bug · session liée » ne laisse plus la session prendre l'effort de la discussion. La demande dit à Claude de la lancer en high pour une première tentative, en xhigh pour une deuxième quand une session de bug du parcours a déjà essayé de corriger ce même bug et qu'il est toujours là (son brief donne alors ce que la première a trouvé et essayé), de le passer à `start_session` (`effort`) ou à `claude --bg` (`--effort`) et de te le dire en une ligne. Pas de troisième session après un second échec : on replanifie ensemble. À la note de fin, si le bug est toujours là, Claude te le dit et propose la deuxième tentative au lieu de reprendre le parcours.

---

## 0.54.0 — 2026-10-22

Constaté le 22/10/2026 dans la rétro d'un parcours à quatre sessions liées : la discussion principale a changé de nom et de référence trois fois (redémarrages, renommages), le compte rendu d'un groupe n'est jamais arrivé et le premier envoi d'un autre a échoué ; les briefs recopiaient les règles du projet et l'effort des revues, et une copie s'est périmée (`xhigh` imposé alors que la règle venait de passer à `high`) ; la liste des choix déclarés, recopiée à la main dans sept ou huit consignes de revue par session, n'a pas empêché une passe `--fix` d'appliquer un correctif exclu, et un relecteur a rendu son rapport sans attendre le second axe ; deux sessions ont rendu la main en attendant une commande de tests sans délai maximal qui ne finissait pas ; `claude logs` rendait une sortie illisible.

### Ajouté
- **Compte rendu déposé au relais** : une session liée envoie son compte rendu final par SendMessage et le dépose aussi par l'outil (`{"report": "…"}`), dans le relais du parcours (`~/.claude/flow-board/relais/<id du parcours>.json`). Dans la discussion principale, chaque réponse de l'outil cite les comptes rendus déposés par les sessions des groupes pas encore rendus, : en entier la première fois et à chaque reprise (`resume`, ou discussion redémarrée), puis en une ligne qui renvoie au relais. Une session redémarrée sous un autre id ne masque pas le compte rendu de la précédente.
- **Fichier des choix déclarés** : la discussion principale tient `~/.claude/flow-board/choix/<id du parcours>.md` d'après le parcours et le relais (ses choix et ceux des sessions liées), réécrit à chaque changement. Les briefs, la revue d'un groupe rendu, les consignes d'`/implement`, d'`/implement-spec` et des revues citent son chemin au lieu de recopier la liste.
- **Consigne des relecteurs**, donnée telle quelle à chaque relecteur : attendre tous les axes d'une revue (Standards et Spec) avant de rendre son rapport, sans en relancer un ; ne pas relancer les tests ni les contrôles ; ne rien signaler ni appliquer de ce que la spec, le ticket ou le fichier des choix laisse à un autre groupe ; ne pas resignaler ni défaire les choix du fichier.
- **Renommer la discussion avant la première session liée** : la demande de lancement de la première session liée d'un parcours fait d'abord demander à la personne de renommer la discussion de son nom définitif ; la consigne d'`/implement` le rappelle au début de l'implémentation quand le parcours a plusieurs groupes.

### Modifié
- **Background par renvoi** : la consigne « Rédige toi-même le background » (groupes et pistes de rétro) ne fait plus recopier les règles (écritures permises, gestes réservés, dépôt public, modèle et effort des revues) : le background cite le document du projet pour les sessions déléguées, son `CLAUDE.md` et les règles communes par leur chemin, et ne garde que ce qui varie (tickets, autres sessions, décisions par renvoi, fichier des choix).
- **Commandes longues** : les règles de travail des sessions de groupe demandent un délai maximal pour chaque commande longue et interdisent de rendre la main en attendant un processus d'arrière-plan qui n'en a pas (le surveiller par Monitor ou l'arrêter).
- **Suivi sans `claude logs`** : la discussion principale suit une session liée par l'état git de son worktree, le tracker et `ListAgents` ; « ↻ Reprendre les pistes » et la rétro globale lisent le transcript `.jsonl` au besoin, plus `claude logs`.
- **Choix sensible jamais déclaré** : la description de `decided`, la réponse donnée aux sessions liées et une consigne ajoutée aux skills de cadrage (`grilling`, `grill-with-docs`, `grill-me`, `to-questionnaire`, `to-spec`, `to-tickets`, `domain-modeling`) font d'un choix qui touche une zone sensible une question à la personne ; une entrée de décision recopie la question et la réponse acceptées au lieu de les résumer.
- **Rétro et autres dépôts** : la consigne de `/retro`, la rétro globale et la demande de session liée des pistes gardent hors des items les pistes qui touchent un autre dépôt (plugins, config commune) et les rendent en une liste de corrections prête à confier à un agent de ce dépôt ; seules les pistes du dépôt courant vont à une session liée.

## 0.53.0 — 2026-10-20

Décidé le 20/10/2026 : les sessions liées d'un groupe prenaient l'effort de la discussion principale (high), alors que leurs tickets sont cadrés par une spec et que leurs revues tournent dans des sous-agents à l'effort explicite depuis la 0.52.0. L'outil `start_session` de l'app Desktop accepte un `effort` (sans jamais en donner un plus haut que celui de la discussion), et `claude --bg` accepte `--effort`.

### Modifié
- **Effort des sessions de groupe** : la demande de lancement dit à Claude de choisir l'effort de chaque session, medium par défaut, high si le groupe a un ticket qui touche une zone sensible (confidentialité, suppression de données, chiffrement, concurrence), s'il reste des choix de conception ou s'il touche plusieurs modules, de le passer à `start_session` (`effort`) ou à `claude --bg` (`--effort`) et de te le dire en une ligne. Les sessions de diagnostic de bug et de pistes de rétro gardent l'effort de la discussion.

## 0.52.0 — 2026-10-20

Décidé le 20/10/2026, après une recherche sur les forums et les comparaisons publiées : aucune ne montre qu'un effort `xhigh` relise mieux qu'un effort `high`, et la revue d'un groupe repasse déjà sur ce que chaque ticket a pu laisser. Par ailleurs, `/code-review` de Claude Code partait sans niveau : sans argument, il reprend le dernier niveau tapé, et le nombre de constats variait d'une revue à l'autre.

### Modifié
- **Revue d'un groupe en effort `high`** : son sous-agent relecteur passe d'Opus `xhigh` à Opus `high`, dans la discussion comme dans le brief des sessions liées.
- **Niveau de `/code-review` toujours passé** : `/code-review high --fix` pour la revue d'un groupe (bouton « ◆ Revue du groupe », brief des sessions liées, consignes) et `/code-review xhigh` pour la passe « bogues » d'un ticket qui touche une zone sensible. Ce niveau fixe le nombre de constats, pas l'effort de raisonnement.
- La revue de sécurité reste confiée à un sous-agent Opus `xhigh`.

## 0.51.0 — 2026-10-19

Constaté le 19/10/2026 dans une rétro de 18 pistes : 17 pistes envoyées « à une session liée » depuis le tableau de bord ont été enregistrées comme confiées (journal « 17 pistes confiés à une session liée », étape « Modifications en cours » ouverte, pistes « en cours ») alors qu'aucune session n'a été lancée. Le tableau de bord enregistrait l'envoi au clic, avant même que Claude reçoive la demande, et n'avait aucun moyen de voir qu'aucune session ne la prenait. Le message de « ↻ Reprendre les pistes » supposait ensuite une session lancée par le CLI (« claude agents, puis claude logs ») et demandait de rendre chaque piste faite ou écartée, puis de clore : appliqué à une session jamais lancée, il aurait clos la rétro en abandonnant les 17 pistes.

### Modifié
- **Pistes en cours au lancement seulement** : le clic sur « ↗ Traiter N pistes · session liée » met la demande dans le prompt et note « Session liée demandée pour N pistes » ; les pistes passent « en cours » et l'étape « Modifications en cours » s'ouvre quand la session est lancée (id relevé dans la réponse de `start_session` ou la sortie de `claude --bg`). D'ici là, elles portent ↗ dans la liste. Des pistes ajoutées à un envoi encore sans session le rejoignent, et la demande les liste toutes.
- **Pas de nouvel envoi pendant qu'une session a des pistes** : il aurait lancé une seconde session que le tableau de bord ne pouvait pas suivre, et ses pistes seraient restées « en cours » sans personne. Tant qu'elle travaille, chaque réponse de l'outil rappelle à Claude de garder ses pistes « doing » dans une liste renvoyée en route.
- **Message de reprise neutre et sans abandon** : « ↻ Reprendre les pistes » vaut pour l'app Desktop comme pour le CLI (outils de session de l'app, `claude agents` et `claude logs`, ou le transcript). Sans id de session relevé, Claude cherche d'abord la session ; s'il n'y en a aucune, il ne rend aucune piste et ne clôt pas la rétro.
- **Pistes pas faites rendues au choix** : à la note de fin, une piste que la session n'a pas faite revient « à faire » et à ton choix au lieu d'être écartée ; « écartée » est réservé aux pistes auxquelles tu renonces. Rendre des pistes au choix et clore dans le même appel est refusé. La demande de lancement, l'étape de la rétro et le refus de clôture le disent aussi.
- **Lancement impossible** : la demande de lancement dit à Claude de signaler un lancement impossible (outil absent, refus, erreur) au lieu de rendre les pistes ; le refus de clôture d'un envoi jamais lancé lui dit de ne les marquer ni faites ni écartées.

### Ajouté
- **« ⚠ Aucun lancement relevé »** : quand le tour qui suit ton message se finit sans session lancée, la carte le dit, avec « ↻ Redemander » et « Annuler » (les pistes reviennent au choix). Un tour ouvert par une notification ou une autre session ne compte pas. Le lancement, même plus tard, efface la marque.
- **« ↻ Redemander »**, grisé dès l'envoi et mis en avant après un tour sans lancement : la demande revient dans le prompt, précédée d'une consigne de vérifier d'abord qu'aucune session n'est partie sans que son id soit relevé.

### Corrigé
- Une session lancée pour un groupe ou un bug (« … › Groupe A · », « … › Bug · », même avec « › » et « · » déformés par la page de code du CLI Windows) pendant qu'un envoi de pistes attend n'est plus prise pour la session des pistes.
- « Annuler » sur un envoi fait avant cette version (étape déjà ouverte, pistes déjà « en cours ») remet toujours les pistes au choix et l'étape d'avant.

---

## 0.50.0 — 2026-10-19

Constaté le 19/10/2026 : une spec écrite par `/to-spec` a été relue, avant d'être montrée, par un sous-agent Opus en effort xhigh. La règle « un texte soumis à l'accord passe la revue » avait hérité du sous-agent des revues de code, alors que l'advisor, qui voit toute la discussion, est le contrôle voulu pour une spec.

### Modifié
- **Spec relue par l'advisor** : l'étape « Rédiger la spec » de `/to-spec` demande de consulter l'advisor avant de montrer ou de publier la spec, pas un sous-agent de revue ; sans outil `advisor`, Claude la relit lui-même dans la discussion.

---

## 0.49.0 — 2026-10-19

Constaté le 19/10/2026 dans une session liée : la règle des revues (toute revue dans un sous-agent Opus, effort xhigh) et le brief (« sans sous-agents qui écrivent », puis `/code-review --fix` lancée par la session) se contredisaient, et aucun texte ne disait comment s'applique `--fix` quand la revue est confiée à un sous-agent. La session a fait relire le groupe en lecture seule, puis a écrit elle-même les correctifs : avec son modèle et son effort, et sans que le relecteur les relise.

### Modifié
- **Revue du groupe dans un sous-agent relecteur qui écrit ses correctifs** : `/code-review --fix` tourne dans un sous-agent (general-purpose, Opus, effort xhigh) qui lance la revue et applique lui-même ses correctifs ; Claude relit ensuite le diff de ces correctifs, relance les contrôles et les commite. Même consigne partout : brief des sessions liées (point 4, et le point 3 nomme ce relecteur comme seule exception à « sans sous-agents qui écrivent »), demande de revue d'un groupe rendu sans revue, étapes d'`/implement` et note ajoutée à `/code-review` dans la discussion principale (qui dit aussi de passer ses consignes au sous-agent : il ne les reçoit pas). L'interdiction venait d'une suggestion d'une session de rétro, pour un travail en séquence ; un relecteur seul, lancé une fois les tickets commités, ne la contredit pas (lecture de Claude, la raison n'était pas écrite).
- **Revue de sécurité en effort xhigh** : le sous-agent relecteur reçoit `effort xhigh` en plus du modèle Opus (brief, bouton, avis), comme le veut la règle des revues : sans effort, il prenait celui du poste.

---

## 0.48.1 — 2026-10-16

### Documentation
- Commandes de développement en chemins relatifs au dépôt (`plugins/<plugin>`), quel que soit l'emplacement du clone.

---

## 0.48.0 — 2026-10-16

Rétro d'un parcours du 16/10/2026, pistes validées par Mathis.

### Modifié
- **Délégation à une session liée, `notify_when_idle` réservé au CLI** : dans l'app Desktop, l'avis d'inactivité est inopérant ; la demande ne l'y fait plus envoyer (lancement d'un groupe, revue d'un groupe revenu sans revue). `wake_when_done` et le compte rendu par `SendMessage` suffisent.
- **Décisions relayées par renvoi** : le background d'une session liée renvoie au fichier de décisions du projet et aux commentaires « mise à jour du porteur » au lieu de recopier des réglages ; une décision prise dans la discussion principale s'y écrit avant d'être relayée, avec la phrase exacte de Mathis ; une décision qui remplace un geste humain (accord, validation, ok de dépense) se confirme par Mathis directement dans la session liée. La session relit ces décisions et commentaires avant chaque ticket.
- **Geste de Mathis prévu par le groupe** : il ne bloque pas le ticket au tableau de bord ; le ticket reste « en cours », ligne « Statut : en attente (porteur) ».
- **Pause au redémarrage** : si l'app ou la discussion redémarre, le parcours passe en pause et ne reçoit plus les relais ; la demande dit de le reprendre par `{"resume": "<id>"}` avant toute autre écriture, puis de rendre les statuts faits entre-temps d'après le tracker ; une session liée qui trouve le parcours en pause continue ses tickets et le signale.

---

## 0.47.1 — 2026-10-16

### Changé
- **Couleur renommée et licence** : la clé de palette de cette teinte (`#E8913A`) s'appelle désormais `tangerine`, sans changement à l'écran ; licence MIT déclarée.
- **mattpocock-skills fourni par la marketplace** : une copie figée de la 1.3.1 est dans `plugins/mattpocock-skills`, installée sous le même nom ; une mise à jour de l'amont ne peut plus casser le catalogue. L'en-tête de `catalog.ts` le dit.

### Tests
- Exemples neutres : le cas de découpage en groupes et les parcours d'exemple ne reprennent plus de vrais projets.

---

## 0.47.0 — 2026-10-16

Demandé par Mathis : l'outil `flow` se veut une tenue de compte silencieuse, mais chaque appel restait dans la conversation avec son JSON et sa réponse ; et la commande suivante du parcours peut se proposer d'elle-même dans le prompt.

### Ajouté
- **Ligne compacte des appels de l'outil `flow`** : la ligne de l'appel (`ToolUse`) devient une seule ligne grisée qui dit ce qu'il enregistre, lue sur son entrée (« flow-board · étape review », « flow-board · 2 tickets faits », « flow-board · 1 décision »…) ; son résultat (`ToolResult`) ne dessine plus rien. Un appel en erreur ou interrompu garde le dessin de Claude Code, comme les autres outils.
- **Suggestion grisée de la suite** : à la fin d'un tour de la discussion principale, la commande du bouton principal de la carte « Ensuite » se propose dans le prompt vide (`$.prompt.suggest`), `/flow-board:compte-rendu` une fois tous les tickets faits et relus. Rien quand une question attend la personne (question du grilling, réponse qui finit par « ? »), dans une session liée, quand la suite n'est pas une commande (lancer un groupe, attendre une session liée, revue sur la ligne d'un groupe) ni pour la rétro d'un parcours à sessions liées. Un second essai part 300 ms plus tard si le premier tombe encore dans le tour.
- **Pas de push suggéré en cours de parcours** : tant qu'un parcours est actif, la suggestion de git-board (`/project:push`) est écartée ; elle revient hors parcours.

### Corrigé
- La ligne « Version actuelle » du README, restée à 0.46.0.

---

## 0.46.1 — 2026-10-16

Constaté dans un projet sans git (dossier synchronisé dans le cloud) : les consignes de revue disaient « point fixe : le commit d'avant le ticket », qui n'existe pas hors d'un dépôt. Les sessions improvisaient : l'une relisait des fichiers entiers d'après la liste des fichiers modifiés (la revue du groupe relisait alors en entier ce que chaque revue de ticket avait déjà relu), une autre gardait une copie des versions d'avant chaque ticket et relisait de vraies différences. Ce correctif fait de la seconde méthode la règle.

### Corrigé
- **Point fixe des revues sans git : la copie d'avant le ticket.** Quand le projet n'est pas un dépôt git, avant de toucher au premier fichier d'un ticket, Claude copie les fichiers qu'il va modifier dans le dossier temporaire de la session (chemin absolu), un sous-dossier par ticket qui garde le chemin dans le projet. Le point fixe d'un ticket est sa copie ; celui d'un groupe est, fichier par fichier, la plus ancienne copie parmi ses tickets (un fichier touché seulement par un ticket suivant n'a pas de copie du premier). Les revues comparent la copie au fichier actuel (diff unifié ; `git diff --no-index` marche hors d'un dépôt) au lieu de relire les fichiers entiers ; un fichier créé par le ticket se lit en entier. La règle est écrite partout où un point fixe est donné : étapes « Revue du ticket » et « Revue du groupe » envoyées avec `/implement` (champ `noGitHint` des étapes du catalogue), passe « bogues », consigne de la revue d'un groupe, avis de sécurité, reprise d'un ticket interrompu, brief des sessions liées (tickets, revue du groupe, sécurité), demande de revue d'un groupe rendu sans revue, et bouton « ⛨ Revue de sécurité ». Dans un dépôt git, le texte ne change pas.
- La consigne envoyée avec un skill mesure le dépôt au moment où elle part, comme le brief des sessions liées (une seule fonction, `measureRepo`) ; le bouton « ⛨ Revue de sécurité » le mesure aussi, et ne donne plus `git diff <base>..HEAD` dans un projet sans git.

---

## 0.46.0 — 2026-10-15

Demandé par Mathis : la règle des revues vit dans flow-board (le `CLAUDE.md` global n'y renvoie plus que par une ligne), le tableau de bord montre leur ordre, et Claude lance lui-même la revue de sécurité.

### Ajouté
- **Ordre des étapes et des revues sur la carte de l'Implémentation** : deux lignes grisées, « Par ticket : Lire spec et ticket › Boucle TDD › Contrôles › Revue du ticket › Commit et suivi » et « Par groupe, ses tickets faits : Revue du groupe › Revue de sécurité › Rendu du groupe ». Les étapes d'un groupe (`groupSteps` du catalogue) ne sont pas suivies : les revues restent des événements marqués sur la ligne du groupe.
- **Consignes de revue dans les étapes** : la consigne de « Revue du ticket » (axes Standards et Spec, point fixe ; passe « bogues » `/code-review` dans le même message pour une zone sensible, avec la liste des choix déclarés) et celles de chaque groupe partent vers Claude avec `/implement`. La revue d'un groupe lancée par la personne reçoit aussi sa consigne : interactions entre les tickets, choix déclarés à ne pas resignaler, et un conflit entre la spec et une consigne qu'elle ne tranche pas mais remonte. Le brief des sessions liées le dit aussi.

### Modifié
- **Revue de sécurité lancée par Claude, partout** (décision de Mathis du 15/10/2026) : après la revue du groupe, Claude juge si elle vaut la peine et, si oui, lance lui-même un sous-agent relecteur (general-purpose, Opus, lecture seule) limité à `git diff <base du groupe>..HEAD`, sans corriger ce qu'il trouve ; les failles vont à la personne, qui décide. Plus de `/security-review` (il relit toute la branche face à la branche par défaut) : le bouton du groupe devient « ⛨ Revue de sécurité · sous-agent relecteur » et met cette demande dans le prompt ; la commande quitte l'onglet Commandes. Le champ `security` de l'outil garde son rôle (avis, puis constats et corrigés).
- Étapes renommées : « Vérifications » devient « Contrôles », « Revue de code » « Revue du ticket », « Commit » « Commit et suivi » (ids inchangés).

### Corrigé
- **La passe « bogues » ne marque plus un groupe relu** : un `/code-review` chargé pendant qu'un ticket est en cours dans la discussion, à son étape Contrôles ou Revue du ticket (ou qu'un ticket relayé l'est, dans une session liée) est la passe « bogues » de ce ticket. Il marquait relus les groupes finis (et, relayé, tout le groupe de la session), si bien que le bouton de la revue du groupe disparaissait sans revue. Il ne laisse plus qu'une ligne au journal, et sa consigne est celle d'une passe « bogues ». Le brief demande à la session de passer chaque ticket « en cours » dans le tracker en le commençant : c'est ce statut relayé qui fait reconnaître la passe.

---

## 0.45.1 — 2026-10-15

Rétrospective d'un parcours en sessions liées : revues en double ou hors périmètre, règle shell peu suivie.

### Modifié
- **Revue de sécurité d'un groupe par un sous-agent relecteur** : le brief ne fait plus lancer `/security-review`, qui ignore la base qu'on lui donne et calcule son diff contre la branche par défaut (les fichiers des autres groupes y passaient). La session confie la revue à un sous-agent relecteur (general-purpose, Opus, lecture seule) avec pour seul périmètre `git diff <base>..HEAD` (sans git : les changements du groupe ; groupe rendu sans revue : ses commits) et les critères de `/security-review`. Les failles vont toujours au compte rendu, sans correction. Le relais ne voit plus cette revue par lui-même (il relevait le lancement de `/security-review`) : l'état de sécurité du groupe vient du `{"security": …}` que la discussion principale envoie d'après le compte rendu.
- **Passe « bogues » en même temps que la revue du ticket** : pour un ticket qui touche une zone sensible, `/code-review` de Claude Code part dans le même message que `/mattpocock-skills:code-review`, sur le même périmètre (point fixe : le commit d'avant le ticket), avec la liste des choix déjà déclarés (`decided`) à ne pas resignaler.
- **Revue du groupe ciblée** : `/code-review --fix` reçoit la liste des choix déjà déclarés et se concentre sur les interactions entre les tickets, chacun ayant eu sa revue. Même consigne pour la revue d'un groupe rendu sans revue.
- **Règle shell en une ligne positive** : « écrire le script par Write, puis le lancer par une commande simple » ; le dossier temporaire se désigne par son chemin absolu, lu une fois (`printenv CLAUDE_JOB_DIR`, seule dans sa commande), puis écrit en clair, au lieu d'une variable d'environnement que la garde du worktree refusait dans une commande composée.
- La description de l'outil `flow` le dit aussi.

---

## 0.45.0 — 2026-10-15

Rétrospective d'un parcours en sessions liées : une session fille a envoyé son compte rendu au nom de la discussion mère, renommée entre-temps ; le message est parti nulle part (« No agent named … is reachable »).

### Ajouté
- **Adresse stable de la discussion principale** : le brief demande à la mère de lire dans `ListAgents` son nom et sa référence entre crochets (« <nom> [ref] » : le nom peut changer, la référence non) et de les donner à chaque session. Si le nom ne répond plus, la session relit `ListAgents`, trouve la ligne de cette référence et envoie à « <nom du moment> [ref] » tel que la liste l'affiche (SendMessage ne résout une référence que lue à l'instant dans une liste) ; sinon elle le dit en tête de son message final.
- **Champ `main` de l'outil** : la session le passe avec `delegate` ; il est gardé avec la délégation (`Board.delegate.main`) et chaque réponse de l'outil dans la session rappelle comment joindre la discussion principale. Sans `main`, la réponse renvoie au nom et à la référence du brief : flow-board ne connaît ni le nom ni la référence de la mère par lui-même.

---

## 0.44.4 — 2026-10-15

Signalé par Mathis : la ligne qui décrit un groupe s'étalait sur plusieurs lignes avec tous les chemins de ses fichiers.

### Modifié
- **Fichiers d'un groupe résumés** : la ligne d'un groupe montre le nombre de ses fichiers (« 7 fichiers ») au lieu de leurs chemins complets. Les chemins restent enregistrés et servent toujours à décider quels groupes peuvent tourner en parallèle.

---

## 0.44.3 — 2026-10-15

Signalé par Mathis : des sous-agents finis depuis longtemps restaient « en cours » (39 h) dans la carte Sous-agents.

### Corrigé
- **Sous-agent rendu fini** : un appel Agent sans `run_in_background` était pris pour un lancement en fond ; quand il rendait un sous-agent déjà fini (`completed`), son SubagentStop était passé avant que son id soit connu, et la ligne restait « en cours » pour toujours. Le statut rendu par l'appel fait maintenant foi.
- **Fins manquées rattrapées** : au début et à la fin de chaque tour de la boucle principale, les sous-agents encore « en cours » sont confrontés à `$.agent.list()`. Un sous-agent fini, échoué ou arrêté, ou absent de la liste, passe fini (ou échoué, ou annulé), sans durée affichée puisque sa fin réelle n'est pas connue. La fin du tour d'un sous-agent le marque aussi fini.

---

## 0.44.2 — 2026-10-15

Demandé par Mathis après la 0.44.1 : corriger les autres endroits du tableau de bord où une partie du contenu restait invisible.

### Corrigé
- **Éléments d'une phase** : jusqu'à 60 gardés au lieu de 30 ; au-delà de 30, les suivants étaient perdus à l'enregistrement.
- **Livrables** : au-delà de 14, un bouton « ▸ tout voir (N) » / « ▾ réduire » ; les suivants n'étaient signalés nulle part.
- **Sous-agents** : au-delà des 3 derniers terminés, « ▸ tous les terminés (N) » montre les autres (le parcours garde 12 sous-agents au plus, en cours compris).
- **Tickets et journal** : « tout voir » montre tout ce qui est gardé (150 tickets, 80 entrées), au lieu de s'arrêter à 60.
- **Textes coupés** : dans le panneau, les libellés d'éléments, les noms de tickets, les « après : » et « attend : », les décisions à prendre, la ligne d'un groupe, les noms de sous-agents, le détail d'un livrable et les entrées du journal passent à la ligne au lieu de finir en « … ». Les titres et le bandeau restent sur une ligne. Les textes sont gardés jusqu'à 300 caractères (120 ou 160 avant).

---

## 0.44.1 — 2026-10-15

Signalé par Mathis : au-delà de 14 éléments (décisions d'un grilling, hypothèses d'une chasse au bug…), la liste finissait par « +7 » sans moyen de voir le reste.

### Corrigé
- **Liste des éléments dépliable** : le « +N » muet devient un bouton « ▸ tout voir (21) », qui affiche tous les éléments, puis « ▾ réduire ». Vaut aussi pour la liste d'un détour.

---

## 0.44.0 — 2026-10-15

Pistes de la rétro du parcours « Tickets lots, espace privé, prompts » (qwen-image-local), transmises par la session de cadrage.

### Ajouté
- **Choix d'une session liée relayés aussitôt** : en mode `delegate`, l'outil accepte `decided` en plus de `set` et `note`. Le choix part au relais ; la discussion principale le montre tout de suite dans « ⚑ Décidé sans toi », marqué de son groupe (« ↗ Groupe A »), et le compte dans le bandeau. « ✓ Relu » l'enregistre relu ; sinon il s'enregistre au retour du groupe. Avant, une session liée ne pouvait donner ses choix que dans son compte rendu final.
- **Règles de travail dans le brief d'une session liée** (« Confie ce groupe à une session liée ») : écrire un script par Write puis le lancer par une commande simple (sans heredoc, `cd` ni variable de chemin) ; ne pas attendre par `sleep` ; un commentaire daté « mise à jour du porteur » sur un ticket quand Mathis change d'avis ; citer un nombre de tests d'après la ligne de résumé de la sortie. Dans un dépôt git, `/security-review` reçoit la base de la branche, sans laquelle elle relisait tous les groupes depuis le début.

---

## 0.43.0 — 2026-10-15

Demandé par Mathis : le bouton Rétro doit faire faire la rétro dans la session mère et dans les sessions filles, avec un compte rendu global dans la mère ; et pas de bouton de revue pour un groupe déjà relu. Pour les sessions filles, Mathis a choisi des sous-agents qui relisent leurs transcripts plutôt qu'une demande envoyée à chaque session.

### Ajouté
- **Rétro d'un parcours à sessions liées** : le bouton Rétro (carte « Ensuite », « Autres commandes ») met `/retro` dans le prompt avec une demande à Claude : un sous-agent par session fille, en parallèle, fait la rétro de sa session sur son transcript (étapes du skill transmises) ; la mère fait la sienne, puis un compte rendu global, pistes fusionnées par sévérité avec leurs sessions d'origine. Sans session fille, `/retro` seul.

### Corrigé
- Un groupe relu dans sa session liée sans que le relais le voie revenait avec le bouton « Revue du groupe · session liée ». La demande de délégation dit désormais d'envoyer `reviewed` avec `returned` quand le compte rendu de la session confirme la revue, et l'outil l'accepte dans le même appel : le groupe revient relu, sans bouton. La réponse à un `returned` sans revue le rappelle.

---

## 0.42.0 — 2026-10-14

Demandé par Mathis : dans l'Implémentation, la carte « Ensuite » proposait « Revue du groupe · /code-review --fix », alors que les sessions liées relisent leur groupe ; elle doit recommander quoi lancer.

### Modifié
- **Carte « Ensuite » d'un parcours à groupes, pendant l'Implémentation** : elle recommande le lot de groupes en parallèle (sessions liées, ou `/implement-spec`), sinon le prochain groupe prêt (session liée, ou ici), le groupe commencé ici d'abord ; un groupe gardé pour la discussion du découpage (« cette discussion ») propose d'abord « Lancer ici ». Elle dit quand un ticket est en cours ici, quand il ne reste qu'à attendre des groupes en session liée, puis quels groupes attendent leur revue. Plus de bouton `/implement` ni `/code-review` dans la carte ; la Rétro reste. Sans groupes, rien ne change (la revue du lot reste dans la carte).
- La revue d'un groupe ne se propose plus que sur sa ligne.

### Corrigé
- Un groupe rendu par sa session liée avant la 0.39.0 n'avait pas de trace `delegated` : sa ligne proposait `/code-review --fix` ici, sur une branche déjà fusionnée. Elle est retrouvée dans le journal du parcours, et le bouton devient « Revue du groupe · session liée ».

---

## 0.41.0 — 2026-10-14

Demandé par Mathis : le mod ne lance plus `/anthropic-skills:renommer-discussion`.

### Retiré
- **Titre de la discussion en fin d'exécution** : quand une exécution de tickets (file lancée depuis le panneau, ou tickets passés « en cours ») se terminait, le mod lançait `/anthropic-skills:renommer-discussion`. Il ne le fait plus ; le skill reste disponible à la main.

---

## 0.40.0 — 2026-10-14

Demandé par Mathis en regardant un parcours dont le groupe A tourne en session liée : compteurs figés, « fait ↗ à vérifier », « ↩ cette discussion » à côté de « session liée au travail », une ligne d'avancement en double, un état « À toi de jouer » faux, et un bandeau trop chargé.

### Ajouté
- **Tickets relayés comptés à l'affichage** : compteur du haut, du groupe et du bandeau. Un ticket fait dans la session lève ses dépendances dans son groupe, pas dans les autres (autre branche). Le parcours enregistré n'avance toujours qu'au retour du groupe. Tant qu'un groupe est confié, ni le compte rendu ni la livraison ne sont proposés, même tous ses tickets relayés faits.
- L'en-tête dit « Session liée au travail » tant qu'un groupe confié a sa session en cours.
- Un ticket en cours porté par une autre discussion le dit sur sa ligne (« ⇆ autre discussion »).

### Modifié
- Ticket fait : coche verte et titre grisé, sans libellé (« fait », « fait ↗ à vérifier »).
- Un groupe confié montre tous ses tickets et ne dit plus « ↩ cette discussion » ; son en-tête passe en ambre (« session terminée il y a … ») si la session s'arrête avec des tickets ouverts. Il reste au travail tant qu'il n'est pas rendu, même tous ses tickets relayés faits.
- Carte de l'Implémentation : plus de suivi ticket par ticket (ticket en cours, étapes) ; les vagues et les groupes suffisent.
- Bandeau sur une ligne : parcours, feuille de route, phase, tickets, groupes en session liée, sous-agents, « ⚑ à relire ». Plus d'état de la session, d'étape, de pourcentage ni de ligne des tickets en cours.

### Retiré
- La ligne bleue « ↗ il y a … · 1/4 faits · … » d'un groupe confié.

---

## 0.39.0 — 2026-10-14

Demandé par Mathis : le bouton « Revue du groupe » reste-t-il utile maintenant que la session liée relit son groupe ? Oui pour un groupe fait dans la discussion ; pour un groupe fait en session liée et rendu sans revue, il lançait `/code-review` sur une branche déjà fusionnée, sans rien à lire, et marquait pourtant le groupe relu.

### Ajouté
- **« ◆ Revue du groupe · session liée »** sur un groupe fini, fait par une session liée et rendu sans revue : la demande va dans le prompt, et Claude fait faire la revue par la session (branche remise au niveau de la branche principale, `/code-review --fix` sur les commits du groupe, correctifs commités, `/security-review` si utile).
- Champ `reviewed` de l'outil : marque relus des groupes finis dont la revue a tourné ailleurs (leur session liée).
- Un groupe rendu garde la trace de sa session liée (`delegated`), y compris quand le plan des groupes est renvoyé.

### Modifié
- La carte « Ensuite » ne propose plus `/code-review --fix` quand les seuls groupes à relire ont été faits par une session liée ; la livraison attend toujours leur revue.

---

## 0.38.0 — 2026-10-14

Demandé par Mathis après la relecture du groupe A de qwen-image-local, fusionné et poussé sans revue du groupe : un groupe confié à une session liée n'avait aucun endroit où sa revue marchait.

### Ajouté
- **La session liée relit son groupe elle-même** : une fois ses tickets commités, elle lance `/code-review --fix`, relit et commite ses correctifs, puis `/security-review` si elle la juge utile (sans en corriger les failles, qui vont dans son compte rendu).
- **Les revues passent par le relais** : leur chargement dans la session liée s'y inscrit (`reviewedAt`, `securedAt`), la ligne du groupe affiche « ◆ revu » et « ⛨ sécurité relue », et un groupe rendu (`returned`) garde ces revues : il est relu, et « Version et push » n'attend plus.

### Modifié
- La demande de lancement écrit en clair les étapes d'`/implement` (`/mattpocock-skills:tdd`, contrôles, `/mattpocock-skills:code-review` par ticket même pour un petit diff, commit) : `/mattpocock-skills:implement` est réservé à l'utilisateur et la session ne pouvait pas le lancer.
- La discussion principale ne fusionne la branche qu'une fois la revue du groupe faite d'après le compte rendu de la session, et envoie l'avis et les constats de sécurité de la session (`security`). Un groupe rendu sans revue relayée le fait dire dans la réponse de l'outil, pour que Claude le signale.
- La description de l'outil fait une exception, pour les sessions liées, à « la personne lance /security-review, jamais Claude ».

---

## 0.37.0 — 2026-10-14

Demandé par Mathis après les groupes A et B de qwen-image-local : voir dans la liste des discussions que les sessions filles viennent de la même discussion mère.

### Ajouté
- **Titre des sessions liées préfixé par le parcours** : « <parcours> › Groupe A · File d'attente », et de même « <parcours> › Bug · … » et « <parcours> › Pistes · … ». Le titre du parcours est coupé à 28 caractères (« … » au-delà) et perd ses guillemets, `$`, `\` et accents graves, puisqu'il passe aussi dans `claude --bg -n "…"`.

### Modifié
- Le groupe d'une session liée se lit dans son titre après le dernier « › » : le titre du parcours, en tête, peut lui-même nommer un groupe.

---

## 0.36.0 — 2026-10-14

Demandé par Mathis après la 0.35.1 : voir avancer un groupe confié à une session liée, pas seulement à la fin.

### Ajouté
- **Avancement en direct des sessions liées.** La session liée relaie, dans `~/.claude/flow-board/relais/<id du parcours>.json` (une entrée par session, repli sur `$.store`), les statuts de ses tickets d'après ses mises à jour Asana, ses commits, ses tests et sa fin de session. La discussion principale le relit toutes les 5 secondes tant qu'un groupe est confié, et l'affiche sur le groupe (ligne « ↗ il y a … · 1/4 faits · en cours : … »), sur ses tickets (« en cours ↗ », « fait ↗ à vérifier ») et dans le bandeau (« ↗A 1/4 »).
- `delegate` accepte `group` (l'id du groupe), que la demande de lancement donne à la session.

### Modifié
- Une session liée peut encore envoyer `set` (un statut changé sans mise à jour Asana) et `note` : ils vont au relais. Le reste d'un appel de l'outil reste refusé, et la réponse ne dit plus « ne plus appeler l'outil ».
- Les statuts relayés restent un affichage : les tickets du parcours n'avancent qu'au compte rendu final (`set` + `returned`), après vérification et fusion.

---

## 0.35.1 — 2026-10-14

Constaté sur le groupe A de qwen-image-local, confié à une session liée depuis le CLI : la discussion principale restait sur Tickets et la session liée affichait « Aucun workflow sélectionné ».

### Corrigé
- **Confier un groupe ouvre la phase Implémentation** : le parcours restait sur la phase d'avant (Tickets), puisque seul le chargement de `/implement` changeait de phase, et la discussion principale ne le charge pas.
- **Un push avant l'implémentation ne la ferme plus** : `/project:push` des documents du découpage sautait Implémentation et Compte rendu pour aller à Version et push, et le parcours ne pouvait plus y revenir (un `/implement` ouvrait même un nouveau parcours). Lancer `/implement` ou confier un groupe revient maintenant à la phase sautée, quand rien n'a été fait depuis hors livraison ; la livraison redevient à faire.
- **Id de la session lancée par `claude --bg` après un brief en heredoc** : les apostrophes du brief ouvraient une fausse chaîne qui cachait le `claude --bg` de la ligne suivante, et le groupe restait « session liée à lancer ». Le corps d'un heredoc est maintenant sauté au découpage de la commande.
- **Bandeau de la session liée** : il disait « Aucun workflow sélectionné » ; il dit « ↗ Session liée · « <parcours> » », comme le panneau, sans proposer de reprise.

---

## 0.35.0 — 2026-10-14

Les sessions liées supposaient l'app Desktop : les demandes dictaient `start_session`, que le CLI n'a pas, et la « note de fin » qui relance la discussion principale vient de l'app. Constaté en comparant Desktop et CLI le 14/10.

### Ajouté
- **Sessions liées depuis le CLI.** Les demandes des trois boutons (« ↗ Session liée » et « ⇉ … · sessions liées » sur les groupes, « 🐞 Bug · session liée », « ↗ Traiter N pistes ») valent dans les deux : Claude choisit selon ses outils, pas selon la surface (une session du CLI ouverte dans VS Code n'a pas `start_session` non plus). Dans le CLI : `ListAgents` pour connaître le nom de la discussion principale, `claude --bg -n "<titre>"` (avec `-w` dans un dépôt git), puis la fille envoie son compte rendu final par `SendMessage`, ce qui réveille la discussion principale même inactive (vérifié le 14/10) ; `notify_when_idle` sert de filet.
- **Id des sessions lancées par `claude --bg`** relevé dans sa sortie (« backgrounded · <id> · <titre> ») : la session va au groupe que son titre nomme, comme avec `start_session`. Seul un vrai lancement compte (un segment de commande qui commence par `claude … --bg`), pas une sortie relue.

### Corrigé
- **Session liée dans un worktree** : sa racine est celle du worktree, donc son fichier de parcours n'est pas celui du projet. `delegate` y répondait « No workflow » sans la mettre à part, et ses skills pouvaient ouvrir un parcours. `delegate` accepte maintenant un parcours absent d'ici et lit son titre, en lecture seule, dans le board du dépôt principal ; le panneau d'un board vide dit « ↗ Session liée du parcours « … » » au lieu de l'accueil.
- **Diagnostic de bug en session liée** : la session reprend le parcours (`resume`), elle doit donc lire le même fichier. La demande dit maintenant de rester dans ce dossier (`use_worktree false`, pas de `-w`) ; avant, l'app pouvait la lancer dans un worktree.
- **« ↻ Reprendre les pistes »** s'affiche dès que des pistes sont chez une session, même si son id n'a pas été relevé.

### Modifié
- Les comptes rendus demandés aux sessions dans un dépôt git donnent leur branche, que la discussion principale fusionne.

---

## 0.34.2 — 2026-10-14

### Corrigé
- **`weight` et `tabular` retirés** (adoptés en 0.34.1) : l'app desktop embarque son propre Claude Code (2.1.295 sur le Mac le 14/10), qui les refuse (« Text prop "tabular" is not allowed ») et dessine alors à la place du board, qui disparaît. Le gras repasse par `bold`, au même rendu. Le correctif des tours de sous-agents de la 0.34.1 reste.

---

## 0.34.1 — 2026-10-14

### Corrigé
- **Le bandeau ne dit plus « Claude travaille » quand un sous-agent de fond démarre** pendant que la main est à la personne. Depuis Claude Code 2.1.299, `turn.start` se déclenche aussi pour les tours des sous-agents ; seul le fil principal compte désormais.

### Modifié
- **Durée de l'état en direct en chiffres de largeur fixe** (`tabular`) : sur desktop, elle ne bouge plus d'une seconde à l'autre.
- **Gras au nouveau format** : le gras passe par `weight: 'semibold'`, et non plus par `bold`, déprécié depuis Claude Code 2.1.299. Le rendu ne change pas (`bold` y était lu comme `semibold`).

---

## 0.34.0 — 2026-10-14

Revue du parcours d'une session du 13/10 : le bouton « ⇉ A ∥ D ∥ E · /implement-spec » y était proposé à tort (A et D modifient la même page, un seul PowerBI peut être piloté, pas de git), C n'expliquait pas pourquoi il restait hors du lot, l'export qui attendait le retour d'un expert restait caché dans un groupe en attente, et le groupe « ↩ cette discussion » ne pouvait pas partir en session liée.

### Ajouté
- **Ressources exclusives** (`groups[].resources`) : ce qu'un groupe ne partage pas avec un autre qui travaille en même temps (une application pilotée à l'écran comme « PowerBI Desktop », une base, un appareil, un compte). Deux groupes qui en partagent une ne vont pas dans le même lot, même sans fichier commun. Les noms se comparent sans casse ni espaces doublés.
- **Fichiers par ticket** (`tickets[].files`), lus dans ses critères d'acceptation : ils s'ajoutent à ceux de son groupe tant que le ticket est ouvert. La réponse de l'outil signale un groupe qui déclare un dossier contenant un fichier nommé par un autre groupe.
- **Raisons et autres lots** : un groupe prêt resté hors du lot dit pourquoi (« ∦ A : tables », le groupe et le fichier ou la ressource en commun), y compris face à un groupe en session liée ou en cours ici. Chaque groupe écarté ouvre un autre lot possible (trois au plus, « Autres lots possibles »).
- **Tickets prêts d'un groupe qui attend** : « ▶ Lancer le prêt » (ou « les N prêts ») lance avec `/implement` les tickets sans bloqueur ouvert d'un groupe dont d'autres tickets attendent.
- **Lots en sessions liées** : « ⇉ A ∥ B en parallèle · sessions liées » confie chaque groupe du lot à sa session liée. La demande fait régler d'abord avec la personne ce dont les sessions auront besoin, lancer une session par groupe avec un titre « Groupe <id> · … » (le mod relie ainsi chaque id de session à son groupe), et rédiger le brief : `{"delegate": "<id du parcours>"}` d'abord, puis `/implement`, le `CLAUDE.md` du projet, pas de sous-agents qui écrivent, un compte rendu par ticket.
- **Mode `delegate`** de l'outil : la session liée se déclare ; ses skills n'ouvrent ni ne reprennent aucun parcours (avant, un `/implement` lancé dans une session liée pouvait reprendre le parcours de la discussion principale restée inactive plus de 30 minutes), l'outil n'y enregistre rien, et son panneau dit « ↗ Session liée du parcours « … » ».
- **`returned`** : à la note de fin d'une session liée, Claude envoie les statuts de ses tickets dans `set` avec `{"returned": ["<id du groupe>"]}`, qui rend le groupe au tableau de bord. Un groupe confié reste hors des lots et des lancements, mais ses fichiers et ressources retiennent ceux qui les partagent ; « Annuler » le rend tant que sa session n'est pas lancée.

### Modifié
- **« ↗ Session liée » sur un groupe** confie le groupe à une session liée qui travaille pour la discussion principale, au lieu de lui faire reprendre le parcours (`resume`) : plusieurs groupes peuvent ainsi avancer en même temps, chacun dans sa session, avec un seul écrivain sur le parcours. Le bouton est proposé sur tout groupe prêt, celui qui « continue ici » compris. Le diagnostic de bug en session liée garde `resume`.
- **`/implement-spec` seulement dans un dépôt git** : hors d'un dépôt, ni le bouton du lot ni celui de la sélection ne le proposent, et un lancement est refusé (le skill a besoin d'une branche d'intégration et de worktrees). Le mod relève la présence du dépôt au démarrage (`sync.isRepo`).
- La demande à `/implement-spec` lève la contradiction avec le skill : un implémenteur par groupe, à la place d'un par ticket (étape 4), dans son worktree, un commit par ticket, le merger fusionnant la branche du groupe une fois fini ; le reste du skill s'applique.
- **« ↩ cette discussion »** n'est dit que dans la discussion qui a envoyé le plan (le mod la retient, `continuesIn`) ; vu d'ailleurs, « ↩ discussion de découpage ». Pas de lien cliquable : le mod ne connaît que l'id de transcription d'une discussion.
- La consigne de `/to-tickets` demande les fichiers de chaque ticket, les ressources de chaque groupe (en renvoyant au `CLAUDE.md` du projet pour les trouver), et conseille de sortir dans un groupe à part un ticket qui peut partir tout de suite (un export, une requête). Un plan renvoyé garde les sessions liées de ses groupes.

---

## 0.33.0 — 2026-10-13

### Ajouté
- **Pistes de la rétro traitées dans une session liée** : une case par piste (○ / ●) et « Tout sélectionner » dans la carte de la rétro, puis « ↗ Traiter N pistes · session liée ». Les pistes choisies passent en cours, la nouvelle étape « Modifications en cours » s'ouvre, et la demande va dans le prompt pour Claude. Le parcours reste dans la discussion principale : la session liée ne le reprend pas ; Claude la suit, rend le statut de chaque piste à sa note de fin, puis clôt la rétro, qui refuse de se clore tant que des pistes sont chez la session.
- La demande fait rédiger le brief par Claude dans la discussion principale, qui connaît la session étudiée : d'abord régler avec la personne les pistes qui attendent son information ou sa décision ; `start_session` en `context` « fresh », `wake_when_done`, un worktree (ou le dossier s'il n'a pas de git) ; un background (projet, session étudiée, décisions, contraintes), une section par piste (problème, correction, fichiers, critère de fin), un travail en séquence sans sous-agents qui écrivent, les contrôles du projet, un compte rendu final par piste. Suggestions d'une session qui avait fait l'exercice à la main.
- Suivi de la session dans la carte : « ↗ Session liée à lancer » (avec « Annuler »), « ↗ Session liée au travail · N pistes en cours » une fois son id relevé dans la réponse de `start_session`, « ✓ Session liée terminée » ; l'en-tête dit « Session liée au travail ». « ↻ Reprendre les pistes » demande à Claude de vérifier une session arrêtée sans note de fin et de rendre ses pistes.
- **Supprimer un parcours archivé** : « ✗ Supprimer » dans « Archivés », après une confirmation. La suppression laisse une trace pour que les autres discussions du projet l'oublient aussi.

### Modifié
- **L'en-tête ne montre que le parcours choisi dans la discussion** : sans parcours choisi (aucun, mis de côté, en pause ou suivi ailleurs), il dit « Aucun parcours sélectionné ». Avant, il montrait le dernier parcours touché. La carte de l'onglet Parcours nomme ce dernier parcours (« Le dernier parcours, « … », est mis de côté. »).

---

## 0.32.0 — 2026-10-13

### Ajouté
- **Claude ouvre un parcours sans skill** (outil `flow`, champ `open` : `{"title", "entry"}`), même quand un autre est actif dans la discussion : l'autre passe en pause tel quel, et tout le reste de l'appel (tickets, groupes…) va au nouveau. `entry` fixe ses phases (un skill de départ, `implement` par défaut ; un nom qui n'en est pas un y retombe, et la réponse le dit). Constat du 13/10/2026 dans un projet : trois tickets indépendants avaient atterri dans le parcours actif, terminé, et il avait fallu les retirer.
- **Claude corrige un parcours** (champ `fix` : `title`, `phase`, `step`) : un titre déjà posé, la phase en cours en arrière (les phases d'après redeviennent à faire) ou en avant (un compte rendu non validé passe « sauté », jamais « fait »), l'étape en arrière comprise. Un `title` simple reste sans effet sur un titre posé.
- La description de l'outil réserve `open` et `fix` à la demande de la personne ou à la réparation d'une erreur ; sans parcours actif, la réponse de l'outil rappelle que `open` n'est qu'à sa demande et donne l'id de chaque parcours à reprendre.
- **Mettre de côté le parcours en cours** : « ‖ Mettre de côté » dans l'onglet Parcours, ou `/flow pause`. Le parcours passe en pause tel quel, sans être clos même si tout est fait, ni archivé ; la discussion peut en ouvrir un autre. Seuls « Reprendre » et le champ `resume` le rouvrent, dans le même état : relancer un de ses skills ouvre un nouveau parcours. Il s'affiche « ‖ mis de côté » dans l'Historique et le panneau, « set aside by the user » pour Claude.
- **Plusieurs tickets en cours à la fois** : la carte de la phase les liste tous (« ◉ N tickets en cours en parallèle »), chacun avec son groupe et la discussion qui le porte (« ici » ou « ⇆ autre discussion ») ; le bandeau les nomme avec leur groupe (« 2 en cours : A·…, B·… »). Un ticket retient la discussion qui l'a passé en cours (`by`). Avant, seul le premier ticket en cours s'affichait.

### Modifié
- Un ticket qui passe en cours pendant qu'un autre l'est déjà ne remet plus les étapes de l'Implémentation à zéro ; un ticket qui suit un ticket fini, si.
- La ligne des tickets en cours s'affiche dans toutes les phases, plus seulement dans l'Implémentation.

---

## 0.31.1 — 2026-10-12

### Corrigé
- **`rename <titre>` dans l'aide de `/flow`** : la description et l'indication d'arguments de la commande enregistrée au démarrage la listaient sans `rename` (seul `commands/flow.md` était à jour).

---

## 0.31.0 — 2026-10-12

### Ajouté
- **`/flow rename <titre>`** renomme le parcours en cours. Le titre d'un parcours est fixé à son lancement (texte tapé après la commande, ou premier titre envoyé par Claude) et un titre envoyé ensuite ne l'écrase pas : il n'y avait jusqu'ici aucun moyen de le corriger. Le nouveau titre (70 caractères au plus, espaces réduites) reste posé, une ligne « ✎ Parcours renommé » s'ajoute au journal et un toast le confirme. Listée dans l'onglet Commandes et dans l'aide de `/flow-board:flow`.

---

## 0.30.0 — 2026-10-12

### Modifié
- **Grand chantier (`/wayfinder`) et Santé du code (`/improve-codebase-architecture`) finissent comme les autres parcours qui codent** : Implémentation, puis Compte rendu, Version et push et Pull request (ces deux dernières facultatives). Avant, ils s'arrêtaient à l'Implémentation : pas de rapport à valider ni de livraison proposée, et le parcours pouvait se clore sans compte rendu.
- **Compte rendu conditionnel** dans ces deux parcours et dans le Triage : facultatif tant qu'on n'a pas codé, obligatoire dès que l'Implémentation (ou `/implement-spec`) démarre. Un triage ou une carte arrêtés sans code se clôturent ; le Triage restait jusqu'ici en pause faute de compte rendu. Les parcours déjà ouverts gardent leurs phases.

---

## 0.29.0 — 2026-10-12

### Ajouté
- **« ✦ Tester une idée »** (`/prototype`) dans « À tout moment », famille « Comprendre », après Recherche : une question de conception réglée par du code jetable, souvent pendant le cadrage. C'est un détour : la phase en cours continue ; sans parcours, il ouvre le sien. L'assistant guidé (`/wizard`) reste dans l'onglet Commandes.

---

## 0.28.0 — 2026-10-12

### Ajouté
- **Parcours « Relecture de branche »** : `/code-review` de Claude Code lancé sans parcours actif dans la discussion l'ouvre (Relecture → Compte rendu → Version et push → Pull request, les deux derniers facultatifs). Pendant un parcours, la commande reste la revue du groupe. Claude reçoit la consigne : la cible et les options sont dans les arguments, sinon la branche courante contre sa base.
- **Avis sécurité pour un parcours sans groupes** : après la Relecture de branche, la revue Claude Code d'un lot sans groupes, et la phase Revue (le `/code-review` de Matt) de Chasse au bug, TDD ou Revue de code, Claude dit si `/security-review` vaut la peine pour tout le lot (`security` sans `group`). Le bouton « ⛨ Revue de sécurité » et l'état « ⛨ sécurité relue » s'affichent dans la carte de la phase. Avant, cet avis n'existait que sous un groupe.

### Modifié
- **« Relire une branche ou une PR »** du lanceur met `/code-review` de Claude Code dans le prompt (sans `--fix` : ajouter la cible, `--fix` ou `--comment`), au lieu du `/code-review` de Matt, qui revient dans l'onglet Commandes (Qualité). Le lanceur affiche la commande réelle de chaque entrée.

---

## 0.27.1 — 2026-10-12

### Modifié
- **« § Terme ou décision » devient « § Préciser un terme »** et rejoint « S'orienter » ; la famille « Consigner » disparaît. `/domain-modeling` questionne avant d'écrire (termes flous, cas limites, écarts avec le code) : l'ancien libellé laissait croire à une simple prise de notes.

---

## 0.27.0 — 2026-10-12

### Modifié
- **« Démarrer un parcours » revu**, dans l'ordre du flux puis les autres points d'entrée : Cadrer une fonctionnalité, **Rédiger la spec de ce qu'on a discuté** (`/to-spec`), **Découper un plan en tickets** (`/to-tickets`), Implémenter un ticket, Diagnostiquer un bug, **Relire une branche ou une PR** (`/code-review` de Matt), Trier les issues, Explorer un grand chantier, Santé de l'architecture. Sortis vers l'onglet Commandes : Écrire en TDD (`/implement` fait déjà le TDD) et Apprendre un sujet (une leçon, pas un parcours de travail). « Je ne sais pas par où commencer » devient « Et maintenant ? » dans « À tout moment ».
- Onglet Commandes : chaque skill y reste une fois, lanceur compris (`/tdd`, `/ask-matt` et `/teach` y reviennent ; `/to-spec`, `/to-tickets` et `/code-review` passent au lanceur).

### Ajouté
- **« À tout moment » : deux familles**, entre « Comprendre » et « Contexte ». « S'orienter » : ✱ **Et maintenant ?** (`/ask-matt`, prérempli avec le parcours, la phase, l'étape et le détour en cours, ou « par où commencer ? » sans parcours) et ◇ **Challenger** (`/grilling`). « Consigner » : § **Terme ou décision** (`/domain-modeling`). Tous restent des détours ou des événements : la phase en cours continue.
- Un outil de la barre peut remplacer le libellé et le glyphe de son skill (`label`, `glyph`), et préremplir sa question avec l'état du parcours (`withState`).

---

## 0.26.0 — 2026-10-12

### Ajouté
- **« 🐞 Bug · session liée »** dans la barre « À tout moment », famille « Déléguer ». Il s'affiche seulement quand le parcours actif ici est en Implémentation, Implémentation de spec, TDD, Revue ou Compte rendu. Il met dans le prompt une demande à Claude, terminée par « Bug : » à compléter : lancer une session liée qui reprend le parcours (`resume`), lance `/diagnosing-bugs` avec la description, corrige selon le `CLAUDE.md` du projet, propose en tâche ce qui reste ouvert, puis clôt le détour (`complete`). À sa note de fin, Claude vérifie le travail et reprend le parcours dans la discussion principale.

### Modifié
- **`/diagnosing-bugs` pendant une phase de code ou de revue devient un détour** de la phase en cours, au lieu d'ouvrir une « Chasse au bug » et de mettre le lot en pause. Le bug reste ainsi rattaché au lot qui l'a fait apparaître. Ailleurs (cadrage, spec, tickets…), comme sans parcours, il ouvre toujours sa « Chasse au bug ». Nouveau champ `detourIn` du catalogue : la liste de ces phases, lue aussi par le bouton.

---

## 0.25.0 — 2026-10-12

### Ajouté
- **« ↗ Session liée » sur un groupe « ↗ nouvelle discussion »**, à côté de « ▶ Lancer » (qui reste, pour lancer le groupe depuis la discussion où l'on est). Le bouton enregistre la file du groupe et met dans le prompt une demande à Claude : lancer le groupe dans une session liée (une vraie discussion de l'application, visible dans la barre latérale), avec le brief : reprendre le parcours, puis `/implement` avec les tickets du groupe dans l'ordre, en suivant le `CLAUDE.md` du projet. À la note de fin de la session, Claude vérifie son travail et reprend le parcours dans la discussion principale. L'astuce « Groupe suivant dans une nouvelle discussion » cite le bouton.
- **Champ `resume` de l'outil `flow`** : l'id d'un parcours du projet à reprendre dans cette discussion avant le reste du rapport, comme « ↻ Reprendre ici ». Une session liée n'a pas de bouton à cliquer ; sans ce champ, le tableau de bord refusait d'y enregistrer l'avancement. Avant la reprise, la discussion relit ce que les autres ont enregistré. Un id inconnu n'écrit rien et le dit à Claude.

---

## 0.24.0 — 2026-10-12

### Ajouté
- **Barre « À tout moment » en bas de l'onglet Parcours**, pendant un parcours comme sans parcours : cinq boutons en deux familles, dans l'ordre d'usage. « Comprendre » : ? Reformulation (`/wait-what`), ✧ Recherche (`/research`), ≡ Questionnaire (`/to-questionnaire`). « Contexte » : ⇣ Compact (`/compact`, commande de Claude Code), ➜ Passation (`/handoff`). Chaque bouton met la commande dans le prompt ; seule Reformulation part telle quelle, les autres attendent un sujet ou des consignes. Aucun ne clôt la phase en cours.
- Action `fillCommand` : met une commande de Claude Code dans le prompt, hors du catalogue des skills.

---

## 0.23.0 — 2026-10-08

### Ajouté
- **Revue de sécurité facultative par groupe.** Une fois `/code-review` passé sur un groupe fini, Claude juge si `/security-review` (Claude Code) en vaut la peine et envoie son avis au tableau de bord (`security` : `advised`, `why`). Sous le groupe : « ⛨ Revue de sécurité · /security-review » avec la raison, ou « sécurité jugée inutile » et « La lancer quand même ». Lancée, elle marque le groupe ; Claude en rend les constats (`findings`, `fixed`) et le groupe passe « ⛨ sécurité relue ». Elle ne bloque jamais la livraison, n'est jamais la suite proposée, et Claude ne la lance jamais lui-même.
- Le compte rendu dit, groupe par groupe, si la revue de sécurité a été faite (et ce qu'elle a trouvé), conseillée sans être lancée, ou jugée inutile.
- `/security-review` dans l'onglet Commandes, famille « Qualité ».
- `/code-review` reçoit désormais les consignes du tableau de bord (l'avis de sécurité à donner), sans `complete` : une revue ne clôt pas l'Implémentation.

### Corrigé
- `/flow reset` est décrit comme « archive » dans l'onglet Commandes (il archive depuis la 0.22.0).

---

## 0.22.0 — 2026-10-07

### Modifié
- **Archiver au lieu de supprimer.** Dans l'Historique, « Supprimer » devient « ▣ Archiver » ; `/flow reset` archive aussi le parcours en cours au lieu de l'effacer. Les archivés sont cachés par défaut, sous « ▸ Archivés (N) », et « ▢ Désarchiver » les remet dans l'historique tels qu'ils étaient. Ils ne comptent pas dans les 15 parcours d'un projet (100 archivés gardés au plus), ne sont ni proposés à la reprise ni repris par un skill ; « Reprendre » sur un archivé le désarchive.
- Une trace de suppression n'efface plus un parcours touché après elle : la copie plus récente survit à la fusion, et la trace tombe. Avant, une trace effaçait toute copie, ce qui empêchait de restaurer un parcours supprimé.

---

## 0.21.0 — 2026-10-07

### Modifié
- **Un seul stockage pour le desktop et le CLI.** Les parcours vivent dans `~/.claude/flow-board/parcours/<projet>.json`, lu et écrit par `$.fs`, au lieu de `$.store`, que Claude Code range selon la façon dont le mod est chargé : `inline` dans le desktop, `mods-locaux` dans le CLI. Un parcours créé dans le CLI n'apparaissait pas dans le desktop, et l'inverse. `$.store` reste le secours si le fichier commun est hors d'atteinte.
- Au premier démarrage de chaque mode de chargement, l'ancien `$.store` du projet est fusionné dans le fichier commun (le plus récent par parcours, traces de suppression comprises) ; une marque dans `$.store` évite de le refaire.

---

## 0.20.0 — 2026-10-06

### Ajouté
- **L'état du compte rendu dans chaque réponse de l'outil `flow`** (et de `/flow`), dès que le parcours a une phase « Compte rendu » : « rapport : validé (AAAA-MM-JJ HH:MM UTC) », « rapport : en attente de validation », « rapport : non validé (sauté) » ou « rapport : pas encore rédigé ». Claude n'avait aucun moyen de lire la validation faite au panneau (« ✓ Valider le rapport ») : constaté dans polepredict, où il a écrit « compte rendu validé » dans un fichier par déduction. L'état se lit dans la phase elle-même, sans nouveau champ stocké.

---

## 0.19.6 — 2026-10-06

### Modifié
- La pull request se lance avec `--auto` : les boutons du panneau mettent `/project:pr --auto` dans le prompt, depuis la carte « Ensuite » comme depuis l'onglet Commandes.

---

## 0.19.5 — 2026-10-06

### Corrigé
- La fin de `/project:version` closait toute la phase « Version et push » : Claude envoyait « terminé », et le push, pas encore fait, passait « sauté ». La phase reste maintenant ouverte jusqu'au push ; l'outil dit à Claude d'annoncer `/project:push`, et la carte « Ensuite » propose `/project:push` sans proposer la pull request avant. Une phase close ainsi par une version antérieure (version faite, étapes du push toutes sautées) est rouverte au chargement.

---

## 0.19.4 — 2026-10-06

### Ajouté
- « Trouvé en route » se masque entièrement (« × masquer ») : il ne reste que le titre et ses comptes, tâches qui attendent la personne comprises ; « ▸ afficher » rouvre la liste.

---

## 0.19.3 — 2026-10-06

### Ajouté
- **Rubrique « Documentation » au compte rendu**, avant « Ce que la livraison enverra » : une ligne par document que le projet tient (d'après son `CLAUDE.md`) : à jour, complété avant le rapport, rien à changer, ou à faire. Le skill fait vérifier chaque document par `git log` depuis le début du parcours et compléter ce qui manque avant d'écrire, pour ne laisser « à faire » que ce qui demande une décision de la personne. Constaté dans polepredict : deux décisions de conception manquaient dans `DECISIONS.md` sans que le rapport le dise.

---

## 0.19.2 — 2026-10-06

### Corrigé
- Le compte rendu d'un parcours mené en plusieurs discussions (un groupe par discussion) ne relisait que le fichier de suivi de la discussion en cours : le groupe A, fait ailleurs, risquait d'être résumé de mémoire ou oublié. Les fichiers `travail/tasks/…` deviennent des livrables « Suivi », rattachés au groupe en cours. Le compte rendu reçoit l'état de chaque groupe et la liste de ces fichiers, et le skill demande de les relire tous et d'écrire « Fait » groupe par groupe.

---

## 0.19.1 — 2026-10-06

### Modifié
- La revue du groupe se lance avec `--fix` : les boutons « ◆ Revue du groupe » et « ▶ Revue du groupe » mettent `/code-review --fix` dans le prompt, pour que les correctifs trouvés soient appliqués à la copie de travail. Un skill du catalogue peut maintenant porter des arguments (`args`), ajoutés à sa commande par le panneau.

---

## 0.19.0 — 2026-10-06

### Modifié
- **Revue comptée par Claude.** Les chiffres de revue ne sont plus lus dans le texte des réponses : Claude les envoie après chaque revue (champ `review` : constats Standards, Spec, corrigés). La carte affiche le nombre de revues et les totaux de la phase. Avant, le mod ne comptait que les puces de la première section `## Standards` d'une seule réponse, sous-points et « rien à signaler » compris (« Standards 6 · Spec 2 » dans polepredict, venus de la revue des tickets 1 et 2 seulement). Ces anciens chiffres sont effacés au chargement.
- **Panneau allégé.** « Décidé sans toi » plie les choix relus en une ligne (« ▸ voir »), sans heure par ligne ; il avait son pliage lié au « tout voir » du journal. « Trouvé en route » met en tête ce qui t'attend, montre l'état par le glyphe de tête et plie au-delà de 4 lignes (« ▸ N de plus »). L'astuce « nouvelle discussion » tient en une ligne.
- Un ticket ajouté au lot pendant qu'un groupe s'exécute rejoint ce groupe, à sa place dans la chaîne, au lieu d'aller dans « Autres ».

### Corrigé
- Un groupe fini ne se dépliait plus : « tout voir » montre maintenant aussi ses tickets.
- Un commit fait après la clôture d'une phase y rallumait l'étape « Commit » (« Commit · 7 h » sur une Implémentation « ✓ fait »). Une phase finie ne bouge plus sur un signal déduit.
- Une Implémentation close à la fin d'un groupe par une version antérieure, avec des tickets encore ouverts, redevient « en cours » au chargement.

---

## 0.18.3 — 2026-10-06

### Corrigé
- Claude pouvait clore l'Implémentation à la fin d'un groupe alors que d'autres tickets du lot restaient ouverts, puis proposer le compte rendu et la livraison. Dans polepredict, il l'a fait à la fin du groupe A, avec le groupe B encore à faire. La phase `/implement` ou `/implement-spec` reste maintenant ouverte tant qu'un ticket du lot l'est, et l'outil dit à Claude d'annoncer le groupe suivant (▶ Lancer), pas le compte rendu. Sa consigne le dit aussi dès le chargement du skill.
- La description de l'outil précise que « Décidé sans toi » n'est pas pour les propositions soumises à la personne.

---

## 0.18.2 — 2026-10-05

### Corrigé
- La barre des tickets comptait en ambre un ticket « bloqué » sans raison qui n'attendait qu'un ticket encore ouvert, alors que sa ligne l'affichait « ⏸ en attente » (le ticket 4 de polepredict). Seuls les vrais blocages, hors du lot, sont ambre ; une attente reste grise, comme un ticket à faire.

---

## 0.18.1 — 2026-10-05

### Corrigé
- Un ticket ajouté au lot en cours de route, sans groupe, restait dans « Autres » même quand il faisait partie de la chaîne d'un groupe. Dans polepredict, le rattrapage et le recalage retenaient le dernier ticket du groupe A, qui passait alors en vague 2. Il rejoint maintenant le groupe des tickets qu'il retient, placé avant le premier, sinon celui des tickets qu'il attend. Le rattachement est calculé à l'affichage, sans toucher au plan enregistré, et un ticket rattaché ne rend pas un groupe « commencé ». La description de l'outil demande aussi à Claude de renvoyer les groupes quand il ajoute un ticket.
- Dans « Trouvé en route », un nom de tâche long poussait le lien Asana hors du panneau sur le desktop : le nom passe à la ligne, sans l'étiquette `[code]` du début.
- Un parcours déjà terminé ne reçoit plus de phase « Compte rendu » à son chargement.

---

## 0.18.0 — 2026-10-05

### Ajouté
- **Phase « Compte rendu »** (`/flow-board:compte-rendu`, réservé à la personne), entre l'implémentation et « Version et push » dans tous les parcours qui livrent. Claude écrit un rapport court, en sections fixes (En bref, Fait, Décidé sans toi, Ce qui s'est mal passé, Bloqué par moi, Trouvé, Ce que la livraison enverra), à partir des faits du tableau de bord qu'il vérifie par git et le tracker. La personne le valide dans le panneau (« ✓ Valider le rapport » ou « ✎ À reprendre ») ; Claude ne peut pas clore la phase.

### Modifié
- La livraison n'est plus proposée avant la validation du rapport, ni le rapport avant la fin des tickets et de leur revue. Lancer `/project:version` sans rapport validé saute le compte rendu et l'écrit au journal.
- Les parcours existants reçoivent la phase au chargement, avant leur « Version et push » à venir.

---

## 0.17.0 — 2026-10-05

### Ajouté
- **Décidé sans toi** : Claude signale chaque choix qu'il fait sans que tu l'aies demandé ni validé (ticket traité hors de la file, approche choisie parmi plusieurs, travail reporté, périmètre changé, correctif au-delà du ticket), avec sa raison, par le champ `decided` de l'outil. La règle est dans la description de l'outil. La carte de la phase les affiche en haut, le bandeau compte « ⚑ N à relire », et « ✓ Relu » les replie ; le journal les garde.

---

## 0.16.0 — 2026-10-05

### Ajouté
- **Trouvé en route** : une tâche créée dans le tracker pendant le parcours (constat de revue hors du ticket, anomalie découverte, action pour la personne) s'affiche sous les tickets, à part du lot. Elle a son statut, la raison d'un blocage, « pour toi » quand elle est assignée et son lien Asana. Elle ne compte pas dans la barre des tickets et ne retient pas la livraison. Le mod lit les `create_tasks` d'Asana et les `gh issue create`, sauf pendant les skills qui publient le lot (`/to-tickets`, `/to-spec`, `/triage`, `/wayfinder`). Claude fait entrer dans le lot celles dont le lot dépend, en les envoyant dans `tickets`.
- **Raison d'un blocage** : `tickets` et `set` acceptent `why`, affiché sous le ticket (« ! attend : ton accord sur le plan »). La ligne « Statut : » d'Asana (en attente, à trancher, à confirmer) donne aussi la raison. Elle disparaît quand le ticket n'est plus bloqué.
- **Plans dans les livrables** : un fichier de `docs/plans/` devient un livrable « Plan · <sujet> », rattaché au ticket que le plan cite en tête.

### Modifié
- La description de l'outil porte les règles des statuts et des trouvailles. Claude les a même quand aucun skill n'a apporté sa consigne : c'était le cas d'une discussion où `/mattpocock-skills:implement`, écrit au milieu d'un message, n'avait pas été lancé.
- Une issue créée par `gh issue create` hors des skills qui publient le lot va dans « Trouvé en route » ; avant, elle entrait dans le lot et retenait la livraison.

### Corrigé
- Les tâches créées pendant `/implement` n'apparaissaient pas : le mod ne lisait que les modifications de tâches Asana, et Claude n'envoyait au panneau que celles qui retenaient le ticket en cours. Dans polepredict, quatre tâches sur six manquaient.
- Un ticket qui n'attendait qu'un autre ticket, mis « bloqué » par Claude, s'affichait « ! bloqué » au lieu de « ⏸ en attente ». Un ticket bloqué par une décision, dont les tickets requis étaient faits, montrait seulement « après : … ✓ » sans dire ce qu'il attendait ; il dit maintenant sa raison, ou « raison non précisée ».

---

## 0.15.0 — 2026-10-05

### Modifié
- **Deux façons d'exécuter les groupes** : un groupe se fait en séquence avec `/implement` ; des groupes indépendants partent ensemble avec `/implement-spec`. Le lot parallèle réunit les groupes prêts (aucun bloqueur encore ouvert) et pas encore commencés, chacun retenu s'il ne partage aucun fichier avec ceux déjà retenus. Une dépendance levée ne compte plus : les groupes d'une vague suivante deviennent parallélisables une fois la précédente finie.
- **Un groupe à la fois** : tant qu'un groupe est commencé et pas fini, aucun lot ne part, et le panneau dit pourquoi (« ⇉ B ∥ C en parallèle une fois A fini »). L'astuce « nouvelle discussion » précise qu'elle démarre une fois le groupe en cours fini.
- « ⇉ … en parallèle » ne lance plus tout le plan, vagues comprises : seulement le lot, et la file ne contient que ses tickets.
- La consigne de `/to-tickets` décrit les deux sortes d'exécution, accepte un groupe d'un seul ticket quand son contexte lui est propre, et demande les fichiers touchés par chaque groupe.

### Corrigé
- Le README affichait « Version actuelle : 0.8.1 » depuis sa création ; il suit maintenant la version, et décrit la règle « une discussion par parcours » et la limite de 12 groupes.
- Trois groupes dont deux partagent un fichier (A et B) et un troisième indépendant (C) partaient tous ensemble, A et B compris : le lot ne retient plus que A et C.

---

## 0.14.5 — 2026-10-05

### Corrigé
- **Reprise après une interruption** : la file transmise à Claude au chargement d'`/implement` ou d'`/implement-spec` porte l'état de chaque ticket. Un ticket fait est marqué « commité, à sauter » ; un ticket en cours, « du travail non commité peut déjà être dans la copie de travail ». Une ligne de plus demande à Claude de regarder `git status` et `git diff` et de reprendre ce travail plutôt que de repartir de zéro. Avant, la file listait tous les tickets sans leur état, et une discussion reprise pouvait refaire des tickets déjà commités.

---

## 0.14.4 — 2026-10-05

### Modifié
- **Étiquette d'outil** alignée sur git-board 0.2.3 et asana-board 0.2.4 : une barre « ▍ » violette suivie de « Flow », au lieu de la pastille « FLOW ». La ligne 2 reprend la barre, colonne vide, pour rester alignée. Aussi dans le bandeau d'accueil.

### Supprimé
- Le trait de séparation entre bandeaux empilés : sur le desktop, un « ─ » est plus large qu'une cellule, la ligne débordait et un bout de trait passait à la ligne. L'empilement redevient le bandeau du dessous, puis celui de flow-board.

---

## 0.14.3 — 2026-10-05

### Modifié
- **Étiquette « FLOW »** en tête de la ligne 1 du bandeau, avant le glyphe du parcours, aussi dans le bandeau d'accueil : la même pastille de 7 cellules que git-board 0.2.2 et asana-board 0.2.3. La ligne 2 est décalée d'autant pour rester alignée.

### Corrigé
- Le trait de séparation n'affiche plus « … » au bout de la ligne sur le desktop, où un « ─ » est un peu plus large qu'une cellule : la ligne est rognée par sa boîte (une ligne de haut) au lieu d'être tronquée.

---

## 0.14.2 — 2026-10-05

### Modifié
- **Trait de séparation** entre le bandeau de flow-board et celui d'un autre mod empilé au-dessus (git-board, asana-board…) : une ligne de « ─ » atténuée sur toute la largeur, comme ces deux mods. Seul au-dessus du prompt, le bandeau n'en a pas.

---

## 0.14.1 — 2026-10-05

### Corrigé
- **Sans distant `origin`**, l'encadré « ✓ À jour avec le distant » n'est plus affiché : le `git fetch` échouait sans bruit, et le mod concluait à tort que tout était à jour. Aucun fetch n'est plus tenté.
- **Sans GitHub**, la phase « Pull request » (`/project:pr`) disparaît de la feuille de route, du bandeau et de la carte « Ensuite », et la suite annoncée en fin de « Version et push » ne la cite plus. Le mod lit l'adresse de `origin` : seule une adresse github.com garde la PR. Le parcours stocké n'est pas modifié.

---

## 0.14.0 — 2026-10-05

### Ajouté
- **Bandeau d'accueil** dès le début d'une discussion, sans parcours actif : « Aucun workflow sélectionné », « ▸ /flow » et « x ». Si le projet a un parcours en pause ou suivi dans une autre discussion, le plus récent est proposé (glyphe, titre tronqué, « ↻ Reprendre », qui passe par la reprise habituelle). Dès qu'un parcours est actif, le bandeau normal reprend sa place. Le masquage (« x », `/flow hide`) vaut pour les deux, et l'empilement avec les bandeaux des autres mods est inchangé.

---

## 0.13.1 — 2026-10-05

### Modifié
- **Revue par groupe** au lieu d'une revue finale : la phase « Revue finale » de la 0.13.0 disparaît de la feuille de route, y compris des parcours déjà mis à niveau. Quand tous les tickets d'un groupe sont faits, son en-tête affiche « ◆ Revue du groupe · /code-review », et la carte « Ensuite » la propose. Lancer `/code-review` (Claude Code) marque le groupe « ✓ revu ». Sans groupes, la revue porte sur le lot entier, une fois ses tickets faits.
- « Version et push » n'est proposé qu'une fois les groupes faits et relus.
- Un plan de groupes renvoyé par Claude garde les revues déjà faites.

---

## 0.13.0 — 2026-10-05

### Ajouté
- **Phase « Revue finale »** entre Implémentation et Version et push, dans les parcours qui implémentent : `/code-review` de Claude Code sur tout le diff de la campagne, lancé par la personne une fois tous les tickets faits. Elle apparaît dans la feuille de route, le bandeau et la carte « Ensuite » (« ▶ Revue finale · /code-review »). Les anciens parcours la reçoivent à leur chargement.

### Modifié
- **Revue par ticket** : la consigne d'`/implement` demande à Claude `/mattpocock-skills:code-review` sur les changements de chaque ticket, avant son commit, et de ne pas lancer lui-même `/code-review`. Un commit sans revue du ticket marque l'étape « sautée » ; la revue n'est plus différée à la fin du lot.
- Les commandes affichées suivent la commande réelle d'un skill (`/code-review` pour la revue finale).

---

## 0.12.2 — 2026-10-05

### Corrigé
- **Étapes ticket par ticket** : pendant `/implement`, quand un ticket passe en cours après un autre, les étapes repartent de « Lire spec et ticket ». Le ticket en cours est nommé au-dessus des étapes, avec sa place dans la file.
- **Vérifications reconnues** : un lint ou un typecheck au vert, ou la suite de tests complète au vert, mènent à l'étape « Vérifications ». Elle était toujours marquée sautée au commit, même quand les contrôles avaient tourné.
- **La revue attend la fin du lot** : le commit d'un ticket ne marque plus « Revue de code » comme sautée tant que d'autres tickets restent ; le skill demande un `/code-review` après le dernier.
- Les tests lancés par le python d'un environnement virtuel (`.venv/Scripts/python -m pytest`) ou par une variable posée dans la commande (`PY=…; $PY -m pytest`) sont reconnus.
- Avec une file de plusieurs tickets, la consigne d'`/implement` demande à Claude de signaler les étapes pour chaque ticket, et la revue une seule fois à la fin.

---

## 0.12.1 — 2026-10-05

### Modifié
- **Le titre de la discussion suit la fin d'une exécution de tickets**, et non plus « Version et push ». Le renommage part quand tous les tickets de la file lancée depuis le panneau (un ticket, un groupe, une sélection) sont faits, ou, sans file, quand les tickets passés « en cours » sont tous faits. Un ticket remis à faire ne déclenche rien ; une reprise sur une file déjà finie non plus.

---

## 0.12.0 — 2026-10-05

### Ajouté
- **Titre de la discussion à la livraison** : quand `/project:version` ouvre la phase « Version et push » (ou `/project:push` lancé seul), le mod lance `/anthropic-skills:renommer-discussion` comme si la personne l'avait tapé, dans la file des commandes, une fois le tour en cours fini. Une fois par livraison ; ignoré quand le skill n'est pas dans la session.

---

## 0.11.0 — 2026-10-05

### Ajouté
- **Retrait de tickets** (`remove`) dans l'outil : un ticket envoyé par erreur quitte le parcours, ses groupes, la file et les dépendances des autres tickets. Le retrait est daté et l'emporte donc à la fusion, sans retouche du stockage à la main.

### Modifié
- **Pas de lot fantôme** : une discussion sans parcours actif n'enregistre rien tant que le projet a un parcours en pause ou suivi dans une autre discussion. L'outil répond à Claude avec la liste de ces parcours et lui demande de faire reprendre le bon.
- `/flow` sans parcours actif nomme les parcours à reprendre, au lieu de « aucun parcours en cours ».

### Corrigé
- Une date d'activité dans le futur (stockage retouché à la main, autre horloge) n'annule plus les reprises : elle est ramenée à la dernière activité réelle du parcours à chaque lecture du stockage.

---

## 0.10.1 — 2026-10-05

### Modifié
- **La rétro n'est plus une phase** des parcours : elle n'apparaît plus dans la feuille de route ni dans le bandeau, mais reste proposée à tout moment dans la carte « Ensuite ».
- **La livraison attend les tickets** : tant qu'un ticket du parcours reste ouvert pendant une phase à tickets, « Version et push », « Pull request » et « Corps de PR » ne sont plus proposés.

### Corrigé
- **Anciens parcours mis à niveau** au chargement et à chaque relecture du stockage : la rétro à venir disparaît, et un « Corps de PR » à venir devient « Version et push » puis « Pull request ». Ce qui est fait ou en cours n'est pas touché.
- Un sous-agent dont le lancement est refusé ou interrompu s'affiche « ⊘ annulé », et non plus « ✗ » comme un échec. Un vrai échec porte désormais la mention « échoué ».

---

## 0.10.0 — 2026-10-05

### Ajouté
- **Groupes de tickets** (`groups`), envoyés par Claude à la fin de `/to-tickets` : les tickets qui partagent leur contexte (mêmes fichiers, chaîne de dépendances) se font dans une même discussion, les autres dans une nouvelle. Chaque groupe a sa raison et ses fichiers ; un seul peut porter « ↩ cette discussion ».
- **Vagues et parallélisme**, calculés par le mod : un groupe attend ceux qui détiennent ses bloqueurs ouverts ; deux groupes d'une même vague, sans attente ni fichier commun, sont marqués ∥. Une attente circulaire est signalée « ⚠ ordre à revoir » sans bloquer le calcul.
- Boutons « ▶ Lancer A » (`/implement` avec les tickets du groupe, dans l'ordre) et « ⇉ A ∥ B en parallèle » (`/implement-spec`, un sous-agent par groupe, vague par vague).
- Les ids de tickets inconnus cités dans un groupe sont signalés à Claude dans la réponse de l'outil.

### Modifié
- `/implement-spec` est aussi proposé sans spec, dès que deux groupes prêts peuvent avancer en parallèle ; le prompt lui précise alors que les tickets et leurs dépendances suffisent.

---

## 0.9.1 — 2026-10-05

### Modifié
- `/flow` n'apparaît plus dans le menu des commandes : `/flow-board:flow` y est seule, du premier message à la fin de la discussion. `/flow` tapée en entier fonctionne toujours.

---

## 0.9.0 — 2026-10-05

### Ajouté
- **`/flow-board:flow`**, déclarée par `commands/flow.md` : disponible dès le premier message d'une discussion, alors que `/flow` n'existe qu'une fois le mod démarré (sur le desktop, à l'envoi du premier message). Mêmes arguments que `/flow` ; le mod y répond sans passer par le modèle.

---

## 0.8.1 — 2026-10-05

### Modifié
- **Synchronisation** : quand la branche distante a bougé, seul `/project:sync` est proposé, même si main est aussi en avance. `/project:sync base` ne vient qu'ensuite, si main a encore des commits d'avance après ce premier sync. C'est le cas courant d'une branche remise sur main après chaque fusion, comme `dev` dans polepredict.

---

## 0.8.0 — 2026-10-05

### Ajouté
- **Dépendances externes** (`externals`) : tâches hors du lot dont un ticket dépend, de type décision ou tâche. Elles bloquent leurs tickets jusqu'à être cochées dans Asana, et leur levée est notée dans le journal.
- **Décisions** : une dépendance de type décision, ou une tâche Asana dont le statut passe « à trancher » ou « à confirmer », s'affiche « ⚖ Décision à prendre » avec son lien Asana.
- Consigne de `/to-tickets` : vérifier les dépendances vers des tâches hors du lot, ajouter les tickets de code au lot et déclarer les autres comme externes.

### Modifié
- Un bloqueur inconnu du parcours s'affiche « (inconnu) » et bloque par prudence.
- Une mise à jour d'une dépendance externe sans type précisé garde son étiquette « décision ».

---

## 0.7.0 — 2026-10-05

### Ajouté
- **Sélection des tickets** dans l'onglet Parcours, dans l'ordre voulu (①, ②, ③…). Un ticket bloqué n'est sélectionnable que si ses bloqueurs sont faits ou choisis avant lui. Retirer un bloqueur retire aussi les tickets qui ne tenaient que grâce à lui.
- **Lancement de la sélection** : « ▶ Implémenter N tickets » met `/mattpocock-skills:implement` dans le prompt, avec la liste ordonnée. La file est enregistrée dans le parcours et transmise à Claude.
- **`/implement-spec` en parallèle**, proposé seulement quand les phases Spec et Tickets du parcours sont faites.
- **Dépendances entre tickets** (`blockedBy`), demandées à Claude à la fin de `/to-tickets` et affichées « ⛓ après : … ».
- **Lien Asana** sur les tickets identifiés par un GID.

---

## 0.6.0 — 2026-10-05

### Modifié
- **`/project:sync` n'est demandé que si le distant a avancé.**
  - Le mod lance `git fetch` en arrière-plan : au démarrage, au début d'une phase qui touche au code, puis toutes les 5 minutes.
  - Il compte les commits de `origin/main` et de la branche suivie qui manquent à la branche locale.
  - La demande est faite une fois par avancée du distant.
  - `/project:sync base` est proposé hors de main.
- L'encadré du parcours affiche « ✓ À jour avec origin/main » ou le retard mesuré.

---

## 0.5.1 — 2026-10-05

### Corrigé
- Une liste de tickets envoyée par Claude **ajoute ou met à jour** des tickets au lieu de remplacer toute la liste. Une discussion qui n'implémentait que 2 tickets d'un lot effaçait les autres.

---

## 0.5.0 — 2026-10-05

### Ajouté
- **Phase « Version et push »** avant la pull request : `/project:version` puis `/project:push`, combinés en 8 étapes. Lancer `/project:push` seul marque les étapes de version comme sautées.
- **Phase « Pull request »** sur `/project:pr`, à la place de `/mattpocock-skills:pr`, qui sert désormais à rédiger le corps.
- Famille « Livrer (plugin project) » dans l'onglet Commandes.
- Demande de `/project:sync` avant la première modification de code d'une phase qui touche au code (remplacée par la mesure git en 0.6.0).

### Modifié
- Les commandes `/project:*` n'ouvrent jamais de parcours à elles seules.

---

## 0.4.0 — 2026-10-05

### Ajouté
- **Onglet Commandes** : « Démarrer un parcours », les 18 autres skills groupés par famille avec leur description, et les commandes `/flow`.
- `/flow commands`.

### Modifié
- L'Historique ne montre plus que les parcours. L'onglet Parcours garde le lanceur quand aucun parcours n'est en cours.

---

## 0.3.0 — 2026-10-05

### Ajouté
- **Plusieurs discussions sur un même projet** :
  - sauvegarde par fusion (la version la plus récente de chaque parcours l'emporte) ;
  - mémoire des suppressions ;
  - relecture du stockage toutes les 5 secondes.
- Chaque discussion a son propre parcours en cours : « ⇆ autre discussion » et « Reprendre ici ».
- À la fin d'une discussion, son parcours passe en pause, sauf après un `/clear`.

### Corrigé
- La dernière discussion à enregistrer effaçait les parcours des autres.
- Le démarrage du mod continue même si l'enregistrement de l'outil ou de la commande échoue.

---

## 0.2.2 — 2026-10-05

### Corrigé
- Reprendre un parcours en pause sur sa phase en cours garde ses étapes et son tour.
- Lancer une suite proposée clôt la phase en cours, même quand elle ouvre un autre parcours.
- Un titre déjà posé n'est plus écrasé par un titre envoyé ensuite.

---

## 0.2.1 — 2026-10-04

### Corrigé
- Un saut d'étape déduit d'un signal (commit, tests, sous-skill) marque les étapes enjambées comme sautées, et non comme faites. Une étape annoncée par Claude garde les étapes d'avant comme faites.
- L'Historique ne répète plus le nom de la phase quand c'est celui du parcours.

---

## 0.2.0 — 2026-10-04

### Corrigé
- À la clôture d'une phase, les étapes jamais atteintes sont sautées (grisées et barrées), plus cochées.
- Les commandes shell sont lues segment par segment : `grep "git commit"` n'est plus un commit. Un test suivi d'un `|` ou d'un `;` est jugé sur sa sortie.
- Les fichiers écrits hors du projet ne comptent plus, sauf la passation et le rapport d'architecture.
- Au chargement d'une nouvelle discussion, le parcours resté actif passe en pause.
- Les boutons de la carte « Prochaine étape » mettent la commande dans le prompt au lieu de la lancer.
- Les termes de glossaire en liste simple (`- Terme : définition`) sont comptés.
- Le passage d'un ticket « en cours » est noté dans le journal, et les libellés sont accordés (« Spec terminée »).

---

## 0.1.1 — 2026-10-04

### Corrigé
- Les dessins SVG sont affichés en image : plus de fond blanc ni de clignotement sur le desktop.
- Les durées sont redessinées toutes les 5 secondes pendant le travail et toutes les 30 secondes au repos, au lieu de chaque seconde.

---

## 0.1.0 — 2026-10-04

Première version. Elle remplace le mod `ticket-board`, qui ne suivait que la phase d'implémentation.

### Ajouté
- **Parcours adapté au skill de départ**, pour les 27 skills mattpocock : phases, étapes internes, détours, pause et reprise.
- **Panneau** à onglets Parcours, Activité et Historique, avec en-tête, anneau de progression et feuille de route animée.
- **Carte de phase** : étapes, éléments suivis, tickets, tests et revue.
- **Bandeau** au-dessus du prompt, avec mini feuille de route et état en direct.
- **Outil `mcp__flow-board__flow`** pour les comptes rendus de Claude, guidé par une note ajoutée au texte de chaque skill.
- **Suivi automatique** : sous-agents, tests (cycles rouge → vert), commits, branches, merges, `gh issue` et `gh pr`, livrables du workflow, tâches Asana, questions du grilling, synthèse de revue.
- **Parcours gardés par projet**, entre les sessions.
- Commande `/flow` : `history`, `activity`, `hide`, `show`, `done`, `reset`.
