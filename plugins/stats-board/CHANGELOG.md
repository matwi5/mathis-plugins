# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième. Les versions précédentes sont dans l'historique git de `mathis-plugins` ; celles d'avant la 0.3.0 aussi dans `~/.claude/mods-archives/stats-board-<version>` sur le PC Windows.

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
