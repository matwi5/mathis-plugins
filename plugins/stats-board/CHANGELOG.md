# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième. Les versions précédentes sont dans l'historique git de `mathis-plugins` ; celles d'avant la 0.3.0 aussi dans `~/.claude/mods-archives/stats-board-<version>` sur le PC Windows.

---

## 0.12.0 — 2026-10-29

### Changé
- **« ▸ Ouvrir » dans le bandeau**, au lieu de « ▸ /ccstats » : l'étiquette du bandeau nomme déjà le plugin, et un bouton ne dit plus la commande. Il ouvre toujours le panneau ; `/ccstats` reste. La notification « Bandeau Stats masqué : /ccstats show pour le réafficher » ne change pas.

---

## 0.11.0 — 2026-10-28

### Ajouté
- **Temps cumulé, à côté du temps actif** : la somme des temps actifs de chaque discussion (deux discussions en même temps comptent deux fois), quand le temps actif ne compte qu'une fois leur période commune. Journée : tuile « Temps cumulé » et temps cumulé de chaque projet. Aperçu : tuile « Temps cumulé » avec sa moyenne par jour actif. Évolution en durée et Rythme : bascule « temps actif / temps cumulé » sur la carte. Projets : temps cumulé de chaque projet. Pour une seule discussion (onglet Discussion, Sessions), il vaut son temps actif : rien de plus. Récap (`/stats-board:recap`) : temps cumulé du jour, de chaque projet et d'un parcours. Choix de Mathis : « Mettre à côté ».
- **Attente de ta réponse, hors temps actif** : pendant une question à boutons (`AskUserQuestion`) ou un plan à valider (`ExitPlanMode`), la requête attend ; le mod note ce moment dans le fichier de relevé (`waits`) et l'enlève du temps actif, de l'heure, de la durée d'une requête pour les médianes et du temps cumulé. Les appels au modèle de ses sous-agents pendant ce temps (`busy`) restent actifs. Une nuit devant une question ne compte donc plus. Onglet Discussion : tuile « Attente de ta réponse », et « attente » sur une requête qui en a une ; récap de la discussion : « attente de ta réponse ». Une attente restée ouverte (redémarrage pendant la question) s'arrête à la fin de sa requête. Une demande d'autorisation d'outil n'est pas comptée : le moteur ne dit pas quand on y répond. Les requêtes relevées avant la 0.11.0 gardent leurs durées. Choix de Mathis : « Ne plus compter le temps où Claude t'attend ».
- **Temps cumulé publié dans claude-usage**, au même format 1 : `cumulMs` sur chaque ligne `active`, `cumul` sur chaque ligne `hours`. Un poste pas encore à jour ne les publie pas : ses jours s'affichent « — » en temps cumulé, et l'Aperçu les compte à part (« N jours sans mesure »).

### Changé
- **Totaux par mois** : une ligne sans temps cumulé (écrite avant la 0.11.0, ou par une session pas encore à jour) fait relire tous les fichiers de relevé du mois au relevé suivant. Le format des mois reste le 1, pour qu'une session encore en 0.10 ne les écarte pas.

### Développement
- Le crochet `tool.call` de chaque outil d'attente est une fonction du module, nommée outil par outil : un nom d'outil en variable dans le filtre fait déborder la mémoire de `tsc`, et le moteur refuse un crochet déclaré dans `register`.

---

## 0.10.1 — 2026-10-28

### Modifié
- **Récap d'un parcours** : les sessions liées de flow-board dont le titre sépare le parcours par « > » (flow-board 0.61.0) ou par « ' » (l'ancien « › », tel que l'app l'affichait) sont retrouvées comme celles à « › ».
- Les plus grands et plus petits nombres d'une liste se prennent par une boucle (`maxOf`, `minOf`) au lieu d'un étalement dans `Math.max`, qui lève une erreur au-delà de 100 000 éléments ; `scripts/check.py` refuse désormais cet étalement.

---

## 0.10.0 — 2026-10-26

### Ajouté
- **Les requêtes de la discussion.** Chaque message envoyé (tapé, Remote Control, Slack) ouvre une requête, la réponse entière à ce message. Le mod en relève, en direct, les appels au modèle du fil principal : tokens par type, modèle, durée API (de l'envoi de chaque appel au dernier morceau de sa réponse) et temps de génération, et sa durée réelle, de l'envoi à la fin de son dernier tour. Un message envoyé pendant un tour ouvre une nouvelle requête, qui prend la suite du tour.
- **Coût au tarif public de chaque modèle**, recopié de la référence du skill `claude-api` (26/10/2026), cache écrit compté à 2× l'entrée (cache d'une heure). Un modèle sans tarif est estimé au prorata du coût de la discussion et marqué « ≈ ».
- **Onglet Discussion** : tuiles « Temps actif » (le temps où une requête tournait, pauses exclues), « Temps API » et « Coût / h active » ; carte « Requêtes » (nombre, durée et coût médians, les cinq premières triées par coût, durée réelle ou durée API, avec l'heure, le début du message, le coût, les tokens, les deux durées, les sous-agents, le modèle principal et la marque « en cours »), au-dessus des appels les plus chers. Le début du message (60 caractères) n'est gardé qu'en mémoire, dans le module : après un rechargement ou une reprise, seule l'heure s'affiche.
- **Sous-agents et tâches de fond dans leur requête.** Un sous-agent compte pour la requête qui l'a lancé (celle de son parent pour un sous-agent de sous-agent), même s'il finit après le message suivant : ses appels entrent dans le coût, les tokens et la durée API de la requête, et leur nombre dans « sous-agents ». Une tâche de fond (shell, Monitor, sous-agent) est à la requête courante quand elle apparaît, et le tour relancé par sa notification allonge sa durée réelle jusqu'à la fin de ce tour ; une tâche qui ne relance jamais de tour (un serveur) ne l'allonge pas. Deux requêtes peuvent donc se chevaucher ; le temps actif compte une seule fois leur période commune. La carte « Requêtes » dit « N en fond » tant que des tâches d'une requête tournent.
- **Interruption** : une requête interrompue garde ses tâches connues et ses agents encore actifs ; elle seule peut être reprise par la notification d'une tâche que personne n'a vue (lancée dans le tour interrompu).
- **Hors requête** : les appels d'une tâche planifiée ou d'un message d'une autre session sont rangés à part dans le relevé (`outside`).
- **Contrôle du coût** : au-delà de 2 % d'écart entre les requêtes (hors-requête compris) et le coût de la session, la carte « Requêtes » affiche « écart de N % avec le coût de la session », avec les causes connues (ce qui précède le suivi, les boutons Réécrire et Effort auto de session-tools, un tarif manquant).
- **Les durées dans les vues Journée, Aperçu et Évolution.** À chaque relevé, le mod fait des fichiers de relevé de ce poste des totaux de durée : temps actif sans double compte (par jour, projet, discussion et heure locale, coupé à minuit et aux heures), durée API et temps de génération (par jour, projet et modèle), nombre de requêtes. Seuls les fichiers modifiés depuis le relevé précédent sont relus, avec ceux qui touchent les mêmes jours ; un fichier illisible (en cours d'écriture par sa session) garde ses totaux et est relu au relevé suivant ; illisible et inchangé depuis plus d'une heure, il est laissé de côté (ses jours refaits sans lui), jamais réécrit ni supprimé. Journée : tuiles « Temps actif » et « Temps API », temps actif de chaque projet et de chaque discussion du jour. Aperçu : « Temps actif », « Moyenne par jour actif », « Jour record (temps) ». Évolution : « ◷ durée » à côté du coût et des tokens, par jour, semaine ou mois. L'en-tête dit « durée suivie depuis le JJ/MM » ; une durée non mesurée (avant le suivi, un autre poste, le temps actif sous un filtre de modèle) s'affiche « — », jamais 0, et les moyennes ne portent que sur les jours suivis.
- **Les durées dans les vues Projets, Modèles, Sessions et Rythme.** Projets : temps actif et coût par heure active de chaque projet (coût des jours suivis). Modèles : temps API et vitesse de chaque modèle, en moyenne pondérée (tokens générés ÷ temps de génération), avec la médiane des appels (relevée par classes de 10 tok/s dans le fichier de relevé). Sessions : « Durée médiane » et « Plus longue » sur le temps actif, tri « Temps actif », tuile « Durée médiane d'une requête » (ce poste). Rythme : carte « Temps actif par heure » ; les cartes qui ne voient que ce poste le disent dans leur titre.
- **Durées publiées dans claude-usage, et les autres postes dans les vues.** Chaque poste publie ses totaux de durée, arrondis à la minute, jamais ses requêtes, leur heure ni aucun texte : durée API, temps de génération, appels relevés et leurs tokens de sortie de chaque ligne (jour, projet, modèle) ; temps actif, durée API et requêtes de chaque session ; temps actif et requêtes par jour et projet ; temps actif par jour et heure locale. Le format reste le 1 : un poste pas encore mis à jour lit le reste et ignore les durées. Les vues additionnent les postes lus et suivent le filtre « poste » ; « durée suivie depuis » donne la date du poste filtré, sinon la plus ancienne ; la carte « Temps actif par heure » de Rythme compte tous les postes. Un fichier sans durée reste lu, ses durées « — » ; les médianes de requêtes restent sur ce poste.
- **Les durées dans `/stats-board:recap`.** Le récap lit les fichiers de relevé de ce poste, en plus de ccusage : temps actif (sans double compte), temps API, nombre de requêtes et la plus chère de la discussion ; temps actif et temps API du jour, et temps actif par projet ; temps actif d'un parcours sans double compte entre la discussion principale et les sessions liées qui tournent en même temps, temps API total, et temps actif de chaque session. Une discussion sans relevé (d'avant la 0.10.0) affiche « — » ; un fichier illisible récent (en cours d'écriture) est omis et signalé, un fichier illisible depuis plus d'une heure omis sans avertissement.
- **Lecture prudente des relevés** (revue de sécurité) : une requête impossible d'un fichier de relevé (date ou durée infinie, hors bornes, fin avant l'envoi, modèle qui n'est pas un objet) est écartée, dans le mod comme dans le récap, au lieu de bloquer tous les relevés du poste ; un caractère de contrôle en tête de message ne passe plus dans le dessin de la carte « Requêtes » ; un identifiant de tâche ou d'agent tiré d'un texte (`constructor`, `__proto__`) ne rend plus une propriété d'objet.
- **Fichier de relevé** : un JSON par ouverture de session dans `~/.claude/stats-board/requetes/` (`<session>_<heure d'ouverture>.json`), écrit par sa seule session à chaque arrêt du fil principal. Aucun texte de message ; rien n'est jamais supprimé.

### Changé
- **Totaux de durée gardés par mois, hors du store** : `~/.claude/stats-board/totaux/AAAA-MM.json`, sans texte, réécrits seulement quand ils changent, jamais supprimés ni réécrits vides, et pas du tout sans la liste des fichiers de relevé. Un fichier de relevé est indexé dans chaque mois qu'il touche : des mois qui ne s'accordent pas sur lui (deux sessions croisées, une écriture coupée, un mois illisible) le marquent à relire avec tous ses jours, jamais retiré de l'index. Un mois mal formé est ignoré en entier. Un relevé qui n'a pas pu lire proprement le dossier des totaux, tous ses mois et la liste des relevés (un mois illisible modifié depuis moins de 2 minutes est en cours d'écriture ; un poste sans dossier de relevés reste net, et un dossier effacé sous des totaux les garde et publie les coûts) n'écrit ni ne publie rien, le dit et repart sous une minute ; sur un relevé net, un mois qui n'a plus rien est réécrit vide. Un dossier de totaux impossible à écrire se signale dans l'en-tête. Les durées des autres postes ne sont plus gardées dans le store (relues à l'ouverture dans le clone local de claude-usage, sans git), ni deux fois dans le relevé. Choix de Mathis : « Un fichier par mois (Recommandé) », « Retirer le doublon (Recommandé) », « Index dans chaque mois (Recommandé) », « Avertir dans l'en-tête (Recommandé) », « Les relire du clone local (Recommandé) », « Corriger la phrase (Recommandé) », « Attendre s'il est récent (Recommandé) », « Relevé net ou rien (Recommandé) », et à la revue du groupe : « Garder, avertir, sans boucle (Recommandé) », « 2 minutes (Recommandé) », « Comparer à la minute (Recommandé) ».
- **Heures publiées à la minute** : l'heure de début (`first`, vers la minute d'avant) et de fin (`last`, vers la minute d'après, sans la raccourcir, sauf si c'est passer minuit à l'heure du poste : vers la minute d'avant alors, pour qu'elle reste dans son jour) de chaque session publiée dans claude-usage, et la date de publication (`updatedAt`), sont arrondies comme les durées : on ne retrouve plus l'heure exacte d'un message à partir du fichier publié. L'historique git de claude-usage, déjà poussé, garde les anciennes valeurs à la milliseconde. Choix de Mathis avant la livraison : « Arrondir à la minute (Recommandé) », « Ne jamais passer minuit (Recommandé) », « Laisser l'historique (Recommandé) », « L'arrondir dans ce ticket (Recommandé) ».
- **Onglet Discussion** : la tuile « Durée » devient « Ouverte depuis » (pauses comprises).
- **Relevé gardé au format 4** (avec les durées). Un relevé gardé au format 3 garde son historique (jours et sessions que Claude Code a effacés) ; ses durées sont refaites depuis les fichiers de relevé.

### Développement
- `scripts/check.sh stats-board` lance tous les contrôles ; le contrôle de types (`tsc` par npx) passe, sans changement de comportement (types plus stricts dans `durations.ts` et `model.ts`).
- Les commentaires nomment les décisions par leur nom, sans renvoi aux tickets ; la filiation des requêtes renvoie à `docs/evenements-moteur.md`, et `requests.ts` nomme le chrono de session-tools, qui applique la même.
- Le README nomme la source des tarifs (le skill `claude-api`, à charger) et la date du relevé, cite chaque fichier de tests dans l'arbre « Architecture », et sa section « Développement » renvoie à `scripts/check.sh`.
- Les tests retrouvent chaque fichier et dossier simulé par la fin de son chemin (`tail`), au lieu de correctifs propres à un dossier pour Mac.

---

## 0.9.0 — 2026-10-26

### Ajouté
- **Récap d'un parcours.** `/stats-board:recap` totalise un parcours entier (discussion principale, sessions liées, sous-agents compris) sans chercher les identifiants à la main : `--parcours "<titre ou début du titre>"` retient les sessions dont le dernier titre (donné ou renommé, sinon automatique) commence ainsi, sessions liées de flow-board au titre raccourci (« … › Groupe X ») comprises ; `--worktrees <dossier du projet>` celles des worktrees `groupe-*` du projet (plus la discussion principale si son identifiant est passé). Sessions prises sur 60 jours, ou entre `--since` et `--until` (AAAA-MM-JJ). Le récap donne le coût total, les tokens, le coût par modèle et, pour chaque session, ses heures, sa durée et son coût.

---

## 0.8.0 — 2026-10-22

### Ajouté
- **Nom d'affichage d'un projet.** `names.json`, à la racine du dépôt de partage, donne un autre nom à un projet sans déplacer son dossier : `{ "<nom de dossier>": "<nom affiché>" }`. Le panneau (onglets Projets, Sessions, Journée…) et `/stats-board:recap` l'affichent pour tout l'historique du projet, sur tous les postes et pour ses worktrees (« <nom> · dev » dans le récap). Le rapprochement des postes et les fichiers publiés gardent le nom du dossier. Un `names.json` illisible devient un avertissement de l'en-tête.

---

## 0.7.1 — 2026-10-22

### Corrigé
- **Deux sessions dont les `pull` se croisent** sur un poste : la seconde n'affiche plus « Partage entre postes : git pull : error: cannot lock ref 'refs/remotes/origin/main' … ». Comme pour le verrou de l'index, elle réessaie à 2 puis 4 s, puis laisse faire l'autre, sans avertissement ni message de verrou abandonné.

---

## 0.7.0 — 2026-10-17

### Ajouté
- **Journées passées dans l'onglet Journée.** En tête de l'onglet : « ◂ veille », « lendemain ▸ », le jour actif d'avant ou d'après sous les filtres (« ◂◂ 8 oct. », « 12 oct. ▸▸ ») et « ↺ aujourd'hui ». Tout l'onglet suit le jour choisi : coût et courbe des 30 jours qui finissent ce jour-là, veille, moyenne et rang, projets, postes, discussions, modèles, blocs de 5 h, messages. Le choix reste entre le premier jour connu et le jour du relevé ; `/ccstats day` revient au jour du relevé. La note « Relevé du … » ne s'affiche plus que sur le jour du relevé.

### Corrigé
- « Aucune consommation le sam. 10 oct.. » : un seul point après une date abrégée.

---

## 0.6.2 — 2026-10-16

### Documentation
- Commandes de développement en chemins relatifs au dépôt (`plugins/<plugin>`), quel que soit l'emplacement du clone.

---

## 0.6.1 — 2026-10-16

### Changé
- **Couleur renommée et licence** : la clé de palette de cette teinte (`#E8913A`) s'appelle désormais `tangerine`, sans changement à l'écran ; licence MIT déclarée.
- **Partage entre postes** : le message « Partage entre postes désactivé » renvoie à `/setup:install`, et le README parle d'un dépôt de partage à vous, sans nom imposé.

### Tests
- Chemins d'exemple neutres.

---

## 0.6.0 — 2026-10-16

### Modifié
- **Graphiques du terminal en grilles de cases.** Dans le panneau, sur le terminal, le calendrier d'activité et les colonnes (courbes des cartes de coût de la Discussion, de la Journée et de l'Aperçu, barres de la discussion et de l'Évolution, blocs de 5 h, heures de début des sessions) sont dessinés par l'élément `Raster`, une grille par graphique, au lieu de séries de textes. Le calendrier passe de `· ░ ▒ ▓ █` à des cases pleines aux teintes du SVG (ses opacités posées sur un fond foncé). Dans une barre empilée, la frontière entre deux modèles tombe au huitième de case au lieu de la case entière. Mois, jours, légende (« Moins … Plus ») et axes restent en texte ; courbes d'une ligne, jauges, pastilles et bandeau ne changent pas. Le desktop garde ses SVG.
- **Repli.** `Raster` ne sert que si la table de la surface en a un vrai (son constructeur rend un élément `Raster`, pas le fragment vide d'un élément retenu) et jamais là où les SVG se dessinent ; sinon, les glyphes d'avant.

---

## 0.5.1 — 2026-10-16

### Corrigé
- **Projets mal nommés ou rangés dans les brouillons.** Le dossier d'un projet était le premier `"cwd"` de ses plus petites transcriptions, gardé pour toujours une fois lu. Une session commencée dans un brouillon du desktop puis rangée dans un projet cite d'abord le brouillon : sur le Mac, `qwen-image-local` avait ainsi le dossier d'un brouillon et passait tout entier dans « Brouillons du desktop ». Le dossier retenu est maintenant le premier `"cwd"` qui redonne la clé du projet (à défaut, le premier), comme le fait déjà `/stats-board:recap`. Un dossier gardé qui ne redonne pas sa clé est relu au relevé suivant ; s'il n'est plus lisible, l'ancien reste.
- **Projets des autres postes figés.** Le relevé gardait les dossiers des projets des autres postes et ne reprenait plus ceux de leurs fichiers publiés : une correction faite sur un poste n'arrivait pas sur les autres. Seuls ceux de ce poste sont gardés ; les autres reviennent de leurs fichiers à chaque relevé.
- **Sessions SSH du desktop comptées deux fois.** Une session lancée par SSH depuis l'app desktop d'un poste (le PC) sur un autre (le Mac) est comptée par le poste où elle tourne, et le desktop qui l'a lancée en garde une copie sous `ssh-<id de la session>`. La copie est écartée quand le poste où la session a tourné la publie (1,88 $ en double sur trois sessions au 16/10). Les sessions en Remote Control ne sont pas concernées : leur transcription n'existe que sur le poste qui les fait tourner.

### Modifié
- **Un worktree de Claude compte pour son dépôt.** `<dépôt>/.claude/worktrees/<nom>` rejoint le projet du dépôt, sur ce poste comme sur les autres (rapprochement par le nom du dépôt), au lieu d'apparaître comme un projet à son nom (`groupe-A`, `pistes`, `video-promo-30s-478bbe`…).

---

## 0.5.0 — 2026-10-15

### Ajouté
- **Onglet Journée** dans le panneau (`/ccstats day`, ou `journée`, `jour`, `today`, `aujourd'hui`, `récap`) : le récap du jour du relevé. Coût du jour, écart avec la veille et courbe des 30 derniers jours ; tuiles (tokens, cache, veille, moyenne et rang sur 30 jours, discussions, modèle principal, messages quand le cache de /stats compte ce jour-là) ; projets, postes, discussions et modèles du jour ; blocs de 5 h du jour et leur rythme. Les filtres de poste, de projet et de modèle s'appliquent, la période non. Un relevé d'un autre jour montre ce jour-là, comme le bandeau.

---

## 0.4.0 — 2026-10-14

### Ajouté
- **Skill `/stats-board:recap`** : le récap de l'usage dans le chat, d'après ccusage. Pour la discussion en cours : coût, tokens et part lue en cache, durée, modèles, sous-agents de workflow. Pour la journée sur ce poste : coût et tokens, modèles, projets, discussions actives, bloc de 5 h et son rythme. Puis les autres postes publiés dans `claude-usage` et le total. Le script `skills/recap/recap.mjs` fait tous les calculs ; Claude recopie sa sortie.

---

## 0.3.4 — 2026-10-14

### Corrigé
- **`weight` et `tabular` retirés** (adoptés en 0.3.3) : l'app desktop embarque son propre Claude Code (2.1.295 sur le Mac le 14/10), qui les refuse (« Text prop "tabular" is not allowed ») et dessine alors à la place du board, qui disparaît. Le gras repasse par `bold`, au même rendu. Le correctif des tours de sous-agents de la 0.3.3 reste.

---

## 0.3.3 — 2026-10-14

### Modifié
- **Chiffres de largeur fixe** (`tabular`) dans tout texte qui contient un nombre : sur desktop, les colonnes s'alignent et les valeurs en direct ne bougent plus.
- **Gras au nouveau format** : le gras passe par `weight: 'semibold'`, et non plus par `bold`, déprécié depuis Claude Code 2.1.299. Le rendu ne change pas (`bold` y était lu comme `semibold`).

---

## 0.3.2 — 2026-10-13

### Corrigé
- **Message « npx introuvable »** : il cite l'erreur de `npx` lui-même, et non celle du dernier lanceur essayé (`cmd.exe`, qui n'existe que sous Windows), ce qui trompait sur Mac.

---

## 0.3.1 — 2026-10-13

### Corrigé
- **Deux sessions qui publient en même temps** sur un poste : la seconde n'affiche plus « Unable to create …/index.lock ». Elle réessaie à 2 puis 4 s, puis laisse faire l'autre ; seul un verrou de plus de 10 min est signalé.

---

## 0.3.0 — 2026-10-12

### Ajouté
- **Usages de tous les postes.** Chaque poste publie ses lignes et ses sessions dans un dépôt git privé partagé (`claude-usage`) (`~/.claude/claude-usage/machines/<nom>.json`), à chaque relevé qui change quelque chose (commit, `pull --rebase`, push, sans invite), puis lit les fichiers des autres postes. Le nom du poste vient de `~/.claude/claude-usage/.machine` (réglé à l'installation du poste).
- **Filtre par poste** : Tous les postes, puis chaque poste (celui-ci d'abord), à la place de « Les 2 PC / Ce PC / Ancien PC ».
- **Projets rapprochés par nom de dossier** entre postes ; la liste des projets dit la part des autres postes (« dont Mac …, Serveur … ») et chaque session dit son poste.

### Modifié
- **L'ancien PC devient « Serveur »**, un poste comme les autres : son export est maintenant le fichier figé `machines/Serveur.json` du dépôt partagé. `data/ccusage-report-past.json` et le projet fixé `C:\dev\PolePredict` disparaissent du mod.
- Format du relevé gardé : 3. Un relevé d'avant est refait au démarrage, mais ses jours gardés (effacés par Claude Code) sont repris, comme ceux du fichier déjà publié par ce poste.
- « (ce PC) » devient « (ce poste) » pour les messages, heures et blocs de 5 h, qui ne sont pas publiés. Les sessions viennent de tous les postes.

---

## 0.2.1 — 2026-10-07

### Modifié
- **Bandeau du terminal plus compact** : 💬 à la place de « discussion », 🌞 de « aujourd'hui », 📅 du mois, et « tok » à la place de « tokens » (dès 120 colonnes). Le bandeau du desktop garde les mots.

---

## 0.2.0 — 2026-10-07

### Ajouté
- **Onglet Discussion**, en premier : la discussion ouverte. Coût d'après le moteur (le même que `/cost`), contexte, tours, durée, modèle, mis à jour à chaque tour. « ↻ Discussion » (et `/ccstats discussion`) lance `ccusage claude session --id` sur cette seule discussion : tokens par type, frise par tranche empilée par modèle avec le cumul, modèles, appels les plus chers, sous-agents de workflow. Le coût par appel est estimé (ccusage ne donne que le total).
- **Rythme horaire et son feu** : cinq niveaux tirés des blocs de 5 h des quatre dernières semaines (calme < 7, posé 7–14, soutenu 14–22, intense 22–32, en feu ≥ 32 $/h). Flamme SVG sur le desktop (éteinte, puis plus haute et plus rouge ; trois flammes et un halo au dernier niveau), crans colorés et 🔥 sur le terminal, jauge en dégradé avec ses seuils. Dans le bandeau, l'onglet Discussion et la carte du bloc de 5 h.
- **Sous-agents rattachés** : une session de workflow (`…\<discussion>\subagents\…`) est comptée avec la discussion qui l'a lancée.

### Modifié
- **Bandeau** : dans l'ordre, le rythme horaire avec son feu, la discussion (prix et tokens), le jour (prix et tokens), le mois (prix et tokens). Plus de bloc de 5 h ni de projection du mois. Le mot « tokens » et l'âge du relevé à partir de 150 colonnes.
- **Ligne d'état** (bandeau masqué) : rythme, discussion, jour.
- **« ↻ Actualiser »** relance aussi le détail de la discussion.

---

## 0.1.1 — 2026-10-07

### Corrigé
- **L'ancien PC n'est plus un projet à part** : son export, sans projets, est rattaché à PolePredict, le seul projet de l'ancien PC. La ligne PolePredict additionne les deux PC et dit « dont ancien PC … ». Le filtre de machine (Les 2 PC, Ce PC, Ancien PC) est inchangé.
- **Relevé gardé de l'ancien format** : le relevé porte un numéro de format ; celui de la 0.1.0 est écarté au démarrage puis refait, au lieu d'afficher encore le projet « Ancien PC ».

---

## 0.1.0 — 2026-10-07

Première version.

### Ajouté
- **Panneau `/ccstats`** (et `/stats-board:ccstats`, connue dès le premier message), en six onglets : Aperçu, Évolution, Modèles, Projets, Sessions, Rythme.
- **Relevé par ccusage** (`npx ccusage@latest claude daily|session|blocks --json`), dans le fuseau de la machine, avec repli sur les prix embarqués (`--offline`) si le barème en ligne échoue. Bouton « ↻ Actualiser », relevés automatiques quand le dernier a vieilli.
- **Ancien PC** : copie de son export ccusage dans `data/`, additionnée jour par jour et modèle par modèle ; filtre « Les 2 PC · Ce PC · Ancien PC ».
- **Cache de `/stats`** : messages, appels d'outils, heures de début des sessions, plus longue session.
- **Filtres** : période (Tout, 90 j, 30 j, 7 j), machine, « Ce projet », projet et modèle depuis leurs onglets ; mesure en coût ou en tokens.
- **Visualisations** : carte du coût avec variation et courbe, tuiles, calendrier d'activité, barres empilées par modèle avec cumul, anneau et parts des modèles dans le temps, mini-courbes par modèle, jauges des projets, mois en cours et projection, bloc de 5 h en cours, derniers blocs, heures, jours de la semaine, régularité. SVG sur le desktop, VS Code et le mobile ; glyphes colorés sur le terminal.
- **Bandeau au-dessus du prompt** : coût du jour, bloc de 5 h, mois et projection, tokens du jour, bouton « ▸ /ccstats » ; « x » ou `/ccstats hide` le masque, la ligne d'état prend le relais.
- **Projets nommés** d'après le dossier lu dans leurs transcriptions ; brouillons du desktop réunis ; sous-agents de workflow rattachés à leur projet.
- **Historique gardé** : les jours et sessions que Claude Code a effacés restent dans le relevé.
