# stats-board

Panneau de statistiques Claude Code et bandeau au-dessus du prompt, sur le terminal comme sur le desktop. Il montre la discussion ouverte (coût, contexte, rythme horaire et son feu), le récap de la journée, le coût équivalent API, les tokens, les modèles, les projets, les sessions, les blocs de 5 h, un calendrier d'activité et le rythme de travail.

- **Les prix viennent de ccusage.** Le relevé lance `npx ccusage@latest` (rapports `claude daily`, `session` et `blocks`, en JSON). Les prix sont ceux du barème en ligne, ou les prix embarqués de ccusage si le réseau manque.
- **Tous les postes, dans un même panneau.** Chaque poste publie ses usages dans un dépôt git privé à vous (par exemple `claude-usage`), cloné dans `~/.claude/claude-usage`, et lit ceux des autres : Portable (le PC Windows), Mac et Serveur (l'ancien PC, figé). Un même projet sur deux postes est reconnu à son nom de dossier : `C:\dev\PolePredict` et `~/dev/PolePredict` ne font qu'un. Voir « Partage entre postes ».
- **Messages, outils, heures et blocs de 5 h ne concernent que ce poste.** Ils viennent du cache de `/stats` (`~/.claude/stats-cache.json`) et de ccusage, qui ne sont pas publiés.
- **Ce qu'il écrit** : son propre stockage (`$.store`) et, dans `~/.claude/claude-usage`, le seul fichier de ce poste (`machines/<nom>.json`), qu'il commite et pousse.

Version actuelle : **0.8.0**. Historique des versions : [CHANGELOG.md](CHANGELOG.md).

---

## Sommaire

1. [Installation](#installation)
2. [Utilisation](#utilisation)
3. [Le panneau](#le-panneau)
4. [Le bandeau](#le-bandeau)
5. [Commandes](#commandes)
6. [Données et relevés](#données-et-relevés)
7. [Architecture](#architecture)
8. [Développement](#développement)
9. [Limites connues](#limites-connues)

---

## Installation

Le mod est distribué par la marketplace `mathis-plugins` (dépôt GitHub `matwi5/mathis-plugins`, source dans `plugins/stats-board/`). Installation d'un poste et protocole de développement : README à la racine du dépôt.

```bash
claude plugin marketplace update mathis-plugins
claude plugin install stats-board@mathis-plugins
```

Pour une nouvelle version : modifier la source dans le clone de travail (`plugins/stats-board`), monter `version` dans `.claude-plugin/plugin.json` et dans l'entrée du mod de `.claude-plugin/marketplace.json` à la racine du dépôt, commiter et pousser, puis :

```bash
claude plugin marketplace update mathis-plugins
claude plugin update stats-board@mathis-plugins
```

Une mise à jour s'applique aux discussions démarrées après elle, ou après `/reload-plugins`.

**Prérequis**
- Claude Code avec les *function hooks* : mods de la version 2.1.286 ou plus récente.
- Node.js (`node` et `npx` dans le `PATH`) : ccusage s'installe à la volée par `npx`.
- Le réseau pour le premier relevé (téléchargement de ccusage) et pour les prix en ligne.
- Pour le partage entre postes : `git`, un dépôt git privé à vous, accessible sans invite (`gh auth setup-git`), cloné dans `~/.claude/claude-usage`, avec le nom du poste. `/setup:install` s'en charge. Sans eux, le mod marche pour ce poste seul et le dit dans l'en-tête.

---

## Utilisation

- Le **bandeau** apparaît au-dessus du prompt dès le démarrage de la session. « ▸ /ccstats » ouvre le panneau.
- `/stats-board:ccstats` (ou `/ccstats`) ouvre le **panneau**.
- « ↻ Actualiser » dans le panneau relance ccusage.

Le panneau ne s'ouvre jamais seul : seulement par une commande ou par « ▸ /ccstats » dans le bandeau.

- `/stats-board:recap` (ou une demande comme « combien m'a coûté cette discussion », « récap de la journée ») fait le **récap dans le chat** : voir [Le skill recap](#le-skill-recap).

---

## Le panneau

De haut en bas :

1. **La carte d'en-tête.**
   - Ligne 1 : la pastille « ◆ Stats Claude Code », l'âge du relevé et « ↻ Actualiser ».
   - Ligne 2 : la période (Tout, 90 j, 30 j, 7 j), le poste (Tous les postes, puis chaque poste, celui-ci d'abord ; absent avec un seul poste) et « ⌂ Ce projet », qui filtre sur le dossier de la session.
   - Les filtres de projet ou de modèle posés depuis les onglets, chacun avec son « ✕ ».
   - La couverture : premier et dernier jour, nombre de jours, version de ccusage, « prix hors ligne » le cas échéant.
   - Les avertissements : modèles sans prix chez ccusage (comptés 0 $), jours gardés par le mod, partage entre postes en échec ou désactivé, fichier d'un autre poste illisible.
2. **La zone d'activité** : le relevé en cours avec ses secondes, puis le dernier message. Une erreur reste jusqu'à son « x ».
3. **Les onglets.**
   - **Discussion** : la discussion ouverte. Les filtres de l'en-tête ne s'y appliquent pas.
     - En direct, d'après le moteur : son coût (le même que `/cost`), le remplissage du contexte, ses tours, son modèle, sa durée.
     - Le rythme : la dépense de la dernière heure d'appels (ou, à défaut, la moyenne depuis le début), avec sa flamme, sa jauge et les cinq niveaux.
     - Au « ↻ Discussion » (ou à la première ouverture par `/ccstats discussion`), le détail de ccusage sur cette seule discussion : tokens par type, frise du coût ou des tokens par tranche de 5 min à 2 j, empilée par modèle avec le cumul, modèles, appels les plus chers, sous-agents de workflow qu'elle a lancés.
     - ccusage ne donne que le total : le coût de chaque appel est **estimé**, en répartissant ce total selon les tokens de l'appel et le barème relatif d'Anthropic (entrée 1, cache écrit 1,25, cache lu 0,1, sortie 5), au prix moyen de son modèle sur tout le relevé.
     - Les tokens affichés sont ceux du détail (ou de la session dans le relevé), plus ceux des tours finis depuis, d'après le moteur.
   - **Journée** : le récap d'une journée. Par défaut le jour du relevé, comme le bandeau (aujourd'hui, ou le jour d'un relevé plus ancien, signalé avec « ↻ Actualiser »). Les filtres de poste, de projet et de modèle s'y appliquent ; la période, non.
     - En tête, le choix du jour : « ◂ veille » et « lendemain ▸ », le jour actif d'avant ou d'après quand ce n'est pas la veille ou le lendemain (« ◂◂ 8 oct. », « 12 oct. ▸▸ », sous les filtres), et « ↺ aujourd'hui » pour revenir au jour du relevé. Rien avant le premier jour connu ni après le relevé. `/ccstats day` revient au jour du relevé.
     - La carte du coût du jour : son écart avec la veille et la courbe des 30 jours qui finissent ce jour-là.
     - Des tuiles : tokens, part lue en cache, la veille, la moyenne par jour actif sur 30 jours et l'écart, le rang du jour parmi les jours actifs des 30 derniers, les discussions et leurs sous-agents, le modèle principal, et les messages de ce poste quand le cache de /stats compte déjà ce jour-là (il a en général un jour de retard).
     - Les projets du jour (part, jauge, discussions, part des autres postes), la part de chaque poste quand plusieurs ont travaillé ce jour-là (jusqu'à leur dernière publication), les discussions du jour, les modèles du jour, puis les blocs de 5 h du jour (ce poste) avec leur rythme. Projets et discussions s'arrêtent à 8, le reste additionné sur une ligne.
     - Une discussion du jour est commencée ou terminée ce jour-là (ccusage ne donne que la première et la dernière activité) ; elle compte avec tous ses sous-agents de workflow. Son coût est son total, jours précédents compris : ccusage ne le découpe pas par jour.
     - Le rythme d'un bloc fini est sa dépense par heure active, comme les seuils du feu ; celui du bloc en cours vient de ccusage.
   - **Aperçu** : la carte du coût équivalent API, en grand, avec sa variation par rapport à la période d'avant et la courbe de la période. Puis des tuiles : tokens, part lue en cache, jours actifs et séries, modèle favori, jour record, sessions, messages, heure de pointe, plus longue session. Ensuite le calendrier d'activité (en coût ou en tokens, niveaux par quartiles comme GitHub) et une comparaison avec un livre.
   - **Évolution** : coût ou tokens par jour, semaine ou mois, en barres empilées par modèle avec la courbe du cumul. Suivent le mois en cours (dépensé, projection à la fin du mois, mois d'avant à la même date), le bloc de 5 h en cours (temps écoulé, coût, rythme, projection) et les jours les plus chargés.
   - **Modèles** : l'anneau de répartition, la part de chaque modèle dans le temps, puis le détail par modèle (entrée, sortie, cache lu et écrit, coût, mini-courbe), avec « ⌕ filtrer ».
   - **Projets** : les projets classés par coût ou tokens, avec part, jauge, sessions, dernier jour et dossier, et « ⌕ filtrer ». Les brouillons du desktop (`scratch-workspaces`) sont réunis en un seul projet. Un worktree de Claude (`<dépôt>/.claude/worktrees/<nom>`) compte pour le projet de son dépôt. Un projet travaillé sur plusieurs postes les additionne et dit la part des autres (« dont Mac …, Serveur … »).
   - **Sessions** : nombre, coût moyen, durée médiane, plus longue, puis la liste triée par coût, date ou durée ; avec plusieurs postes, chaque session dit le sien. Le Serveur n'a publié que des totaux : pas de sessions. Ensuite les derniers blocs de 5 h (ce poste).
   - **Rythme** : les heures de début des sessions, la charge par jour de la semaine, les messages et appels d'outils, la régularité (jours actifs, série record, série en cours).

Les listes longues sont plafonnées (6 modèles, 8 projets, 10 sessions, 5 jours) avec « ▸ tout voir ».

Sur le desktop, VS Code et le mobile, les graphiques sont des SVG. Sur le terminal, le calendrier et les colonnes (courbes des cartes de coût, barres de l'Évolution et de la discussion, blocs de 5 h, heures de début) sont des grilles de cases (`Raster`, une par graphique) : chaque jour du calendrier est une case pleine à la teinte de son niveau (les opacités du SVG, posées sur un fond foncé), et dans une barre empilée la frontière entre deux modèles tombe au huitième de case (part du bas en avant-plan, part du haut en fond). Le reste du terminal reste en glyphes : courbes d'une ligne, jauges en blocs, pastilles, bandeau. Sans `Raster` dans la table de la surface, le calendrier revient à `· ░ ▒ ▓ █` et les colonnes aux huitièmes de bloc en texte.

---

## Le bandeau

Une ligne, deux pendant un relevé.

Sur le terminal, compact (un émoji par libellé, « tok ») :

```
▍ Stats  ▰▰▰▰ 🔥 44 $/h · 💬 47,12 $ 101 M tok · 🌞 134 $ 210 M tok · 📅 1 179 $ 2,3 Md tok     ▸ /ccstats  x
          ⠋ Relevé ccusage : sessions et blocs de 5 h…
```

Sur le desktop, en mots :

```
▍ Stats  🔥 44 $/h · discussion 47,12 $ 101 M · aujourd'hui 134 $ 210 M · oct. 1 179 $ 2,3 Md     ▸ /ccstats  x
```

Dans l'ordre :

1. **Le rythme horaire** du bloc de 5 h en cours (ccusage), avec son feu : une flamme SVG sur le desktop, quatre crans colorés sur le terminal (et 🔥 au dernier niveau). Absent hors d'un bloc.
2. **La discussion ouverte** (💬 sur le terminal) : son coût d'après le moteur (le même que `/cost`, mis à jour à chaque tour) et ses tokens (voir l'onglet Discussion).
3. **Le jour** (🌞) : coût et tokens. Un relevé d'un autre jour affiche son jour (« le 6 oct. », « 🌞 6 oct. »), pas 0 $. À partir de 64 colonnes.
4. **Le mois en cours** (📅) : coût et tokens. À partir de 92 colonnes.
5. L'unité après chaque nombre de tokens : « tok » sur le terminal à partir de 120 colonnes, « tokens » sur le desktop à partir de 150. L'âge du relevé à partir de 150 colonnes.

Les trois émojis occupent deux cellules et n'ont pas de sélecteur de variante : leur largeur est la même dans tous les terminaux qui affichent les émojis.

Les niveaux du rythme viennent des 45 blocs de 5 h du 9 septembre au 7 octobre 2026 (dépense par heure active : 1er quartile 6,9 $/h, médiane 13,5, 3e quartile 21,7, 9e décile 31,9, maximum 71). Ils sont fixés dans `RATE_LEVELS` (`model.ts`) :

| Niveau | Rythme | Feu |
|---|---|---|
| calme | < 7 $/h | flamme éteinte, crans vides |
| posé | 7 à 14 $/h | petite flamme jaune, 1 cran |
| soutenu | 14 à 22 $/h | flamme mandarine, 2 crans |
| intense | 22 à 32 $/h | grande flamme rouge-orangé, 3 crans |
| en feu | ≥ 32 $/h | trois flammes et un halo, 4 crans et 🔥 |

- « ▸ /ccstats » ouvre le panneau. « x » masque le bandeau pour la session ; la ligne d'état sous le prompt prend alors le relais. `/ccstats show` le réaffiche.

Le bandeau s'empile avec ceux des autres mods (git-board, flow-board, asana-board) sans les effacer. En tête, une barre « ▍ » et le nom du mod en bleu ciel, alignés avec ceux des autres bandeaux.

---

## Commandes

| Commande | Effet |
|---|---|
| `/stats-board:ccstats` | Ouvre le panneau. Connue dès le premier message. |
| `/ccstats` | La même commande, déclarée au démarrage du mod. Masquée du menu, utilisable tapée en entier. |
| `/ccstats discussion` | Ouvre l'onglet Discussion et, s'il n'y en a pas encore, lance le détail de ccusage sur la discussion ouverte. |
| `/ccstats day` | Ouvre l'onglet Journée sur le jour du relevé (aussi `journée`, `jour`, `today`, `aujourd'hui`, `récap`). |
| `/ccstats overview`, `trend`, `models`, `projects`, `sessions`, `rhythm` | Ouvre le panneau sur cet onglet (les noms français marchent aussi : `aperçu`, `évolution`, `modèles`, `projets`, `rythme`). |
| `/ccstats refresh` | Ouvre le panneau et relance un relevé. |
| `/ccstats hide` | Masque le bandeau ; la ligne d'état prend le relais. |
| `/ccstats show` | Réaffiche le bandeau et ouvre le panneau. |

Pas de `/stats` : c'est le nom de la commande intégrée de Claude Code.

### Le skill recap

`/stats-board:recap` écrit le récap de l'usage dans la conversation, en Markdown. Claude lance `skills/recap/recap.mjs` avec l'identifiant de la discussion (`${CLAUDE_SESSION_ID}`), recopie sa sortie et ajoute au plus deux remarques. Tous les chiffres viennent du script.

| Partie | Contenu | Source |
|---|---|---|
| Cette discussion | Coût, tokens et part lue en cache, sortie, heures et durée, projet, coût par modèle, sous-agents de workflow (inclus) | `ccusage claude session --since <7 jours>` : sa ligne et celles de ses sous-agents |
| Aujourd'hui sur ce poste | Coût et tokens, coût par modèle, tableau des projets (coût, part, tokens) | `ccusage claude daily --since <aujourd'hui> --instances --breakdown` |
| Discussions actives aujourd'hui | Les 5 plus chères (projet, heures, coût total), le reste regroupé | Les sessions dont la dernière activité est aujourd'hui |
| Bloc de 5 h en cours | Coût, rythme et son niveau (mêmes seuils que le bandeau), projection | `ccusage claude blocks --active` |
| Autres postes | Coût et tokens du jour, heure de publication, total de tous les postes | `~/.claude/claude-usage/machines/*.json` |

- Le script ne passe pas par le mod : il marche même si le mod n'est pas chargé, et ne touche ni au relevé gardé ni au dépôt `claude-usage`.
- Il lance ccusage comme le mod (`--json --timezone <fuseau>`, nouvel essai avec `--offline` si le barème en ligne échoue). Une quinzaine de secondes au premier appel, moins d'une seconde quand ccusage est en cache.
- Sans identifiant de discussion, il prend la transcription la plus récente du dossier courant et le signale (« Discussion devinée »).
- Le coût de la discussion est celui de ccusage : il peut différer un peu du 💬 du bandeau, qui est celui du moteur (`/cost`).
- Le coût d'une discussion active aujourd'hui est son total, jours précédents compris.
- Les noms de projet sont ceux du fichier publié par ce poste, ou le dernier segment d'un `cwd` des transcriptions, à condition que ce chemin redonne la clé du projet. Un projet nommé dans `names.json` (voir « Partage entre postes ») prend ce nom ; un worktree de Claude de ce projet s'affiche « <nom> · <worktree> » ; sans nom dans `names.json`, un worktree garde son nom seul. Un `names.json` illisible est ignoré sans avertissement (le panneau, lui, le signale).
- Les formats (`fmtCost`, `fmtTokens`…), les seuils de rythme (`RATE_LEVELS`) et la lecture de `names.json` (`parseLabels`, `LABEL_MAX`) sont recopiés de `model.ts` : les garder alignés à la main.

---

## Données et relevés

| Donnée | Source | Portée |
|---|---|---|
| Coût, tokens par jour, projet et modèle | `npx ccusage@latest claude daily --instances --breakdown --json` | Ce poste, publié |
| Sessions (début, fin, coût, modèles) | `npx ccusage@latest claude session --json` | Ce poste, publié |
| Les autres postes | `~/.claude/claude-usage/machines/*.json` (dépôt partagé) | Leurs lignes et sessions ; Serveur : totaux par jour sur PolePredict |
| Blocs de 5 h (rythme, projection) | `npx ccusage@latest claude blocks --breakdown --json` | Ce poste, tous projets |
| Messages, appels d'outils, heures | `~/.claude/stats-cache.json` (cache de `/stats`, un jour de retard) | Ce poste, tous projets |
| Nom d'affichage d'un projet | `~/.claude/claude-usage/names.json` (dépôt partagé), écrit à la main | Tous les postes ; jamais publié |
| Nom et dossier des projets | Le premier `"cwd"` des transcriptions (`~/.claude/projects/<clé>/*.jsonl`) qui redonne la clé du projet, à défaut le premier tout court, lu par Node | Gardé une fois trouvé ; relu s'il ne redonne pas la clé |

Chaque rapport passe `--json --order asc --timezone <fuseau de la machine>`. Le fuseau est lu par Node (`Intl`), qui donne aussi le jour local du mod.

| Relevé | Quand |
|---|---|
| Au démarrage | 3 s après, si le dernier relevé a plus de 20 min |
| À l'ouverture du panneau | Si le dernier relevé a plus de 5 min |
| Après un tour de la conversation | Si le dernier relevé a plus de 20 min |
| « ↻ Actualiser », `/ccstats refresh` | Toujours |

Un relevé prend une quinzaine de secondes. Le premier rapport installe ccusage dans le cache de npx ; les deux suivants partent ensemble, avec la version de ccusage. Si le barème en ligne échoue, ccusage est relancé avec `--offline`, et l'en-tête affiche « prix hors ligne ».

| Donnée gardée | Emplacement | Portée |
|---|---|---|
| Dernier relevé | `$.store` (`snapshot`) et état de session | D'une session à l'autre |
| Onglet, période, machine, filtres, listes dépliées, bandeau masqué | État de session (`$.state`) | Une discussion |

**Historique gardé.** Claude Code efface ses journaux après `cleanupPeriodDays` jours, et ccusage ne voit alors plus ces jours. Le mod garde ceux de ce poste dans le relevé précédent qui sont plus anciens que le premier jour du nouveau, et le dit dans l'en-tête (« ↺ N jours gardés par le mod »). Il fait de même pour les sessions. Comme ce poste publie ce qu'il garde, son historique reste aussi dans `claude-usage`.

### Partage entre postes

- **Nom du poste** : une ligne dans `~/.claude/claude-usage/.machine` (Portable, Mac…), propre au poste et ignorée par git. Sans nom, le mod s'affiche « Ce poste », ne publie rien et lit quand même les autres.
- **À chaque relevé** :
  1. écrire `machines/<nom>.json`, seulement si ses lignes, sessions ou projets ont changé (l'heure seule ne compte pas) ;
  2. `git add`, puis `git commit` ;
  3. `git pull --rebase`, puis `git push` s'il y a quelque chose à pousser ;
  4. lire les fichiers des autres postes.
- **git sans invite** (`GIT_TERMINAL_PROMPT=0`) : un échec (hors ligne, identifiants) devient un avertissement. Les fichiers déjà là sont lus quand même, et le relevé suivant réessaie.
- **Pas de conflit** : chaque poste n'écrit que son fichier.
- **Rapprochement des projets** : un projet d'un autre poste prend la clé du projet de ce poste qui a le même nom de dossier (sans la casse). Sinon, il garde la sienne, avec son dossier. Un worktree de Claude est rapproché sous le nom de son dépôt. Une session lancée par SSH depuis le desktop, que le poste qui l'a lancée garde sous `ssh-<id>`, est écartée de ce poste quand celui où elle a tourné la publie : elle ne compte qu'une fois. Deux projets différents du même nom sont donc additionnés. Les brouillons du desktop gardent leur clé et se regroupent seuls.
- **Historique de ce poste** : avant de publier, le mod réunit tout ce qu'il connaît de ce poste. Il prend le relevé gardé, y compris celui d'avant la 0.3.0 et les lignes encore marquées « Ce poste », et le fichier que ce poste a déjà publié. Ni une mise à jour, ni un premier nommage, ni un nouveau clone ne perdent donc les jours que Claude Code a effacés. Un poste resté inactif plus longtemps que ses journaux garde aussi son historique au lieu de publier un fichier vide.
- **Commit raté** (par exemple sans identité git) : le relevé suivant voit le fichier non commité et réessaie. Un `pull --rebase` qui échoue est annulé (`rebase --abort`).
- **Plusieurs sessions sur un même poste** : elles font parfois leur relevé en même temps, et git refuse alors la seconde : verrou de l'index (`index.lock`), ou `cannot lock ref` quand son `pull` trouve `origin/main` déjà avancé par l'autre. Celle-ci réessaie deux fois, à 2 puis 4 s. Si ça bloque encore, elle laisse la publication à l'autre, sans avertissement. Seul un verrou d'index qui date de plus de 10 min (git arrêté en route) est signalé, avec son chemin.
- **Nom d'affichage d'un projet** : `names.json`, à la racine du dépôt de partage, donne un autre nom à un projet sans déplacer son dossier, par exemple `{ "qwen-image-local": "Chambre noire" }`. La clé est le nom du dossier (sans la casse, le dernier segment de son chemin, aussi pour le dossier personnel), le même sur tous les postes ; la valeur, le nom affiché (60 caractères au plus). Le panneau et `/stats-board:recap` l'affichent partout, worktrees compris. Le rapprochement des postes et les fichiers publiés gardent le nom du dossier : retirer une ligne rend l'ancien nom au relevé suivant. Ce fichier s'écrit à la main, puis commit et push dans le dépôt de partage : une modification non commitée bloque la publication du poste (le `pull --rebase` refuse), avec un avertissement, jusqu'au commit. Un fichier illisible devient un avertissement de l'en-tête ; un BOM en tête (PowerShell) est accepté.
- **Renommer un poste** : changer la ligne de `.machine`, et renommer aussi son fichier publié (`machines/<ancien>.json` en `machines/<nouveau>.json`, avec le champ `machine`, puis commit et push dans le dépôt de partage), sinon ses usages compteraient deux fois.
- **Postes sans sessions** : un poste qui n'a publié aucune session (le Serveur) affiche « n'a publié que des totaux par jour » sous son filtre.
- **Stockage** : si le relevé de tous les postes dépasse ce que `$.store` accepte, seul ce poste y est gardé. Les autres reviennent au relevé suivant.
- **Format du fichier publié** : type `Published` de `types/index.d.ts`.

---

## Architecture

```
stats-board/
├── .claude-plugin/plugin.json   manifeste (nom, version, contrat de types)
├── .claude-plugin/types/        types du moteur (Claude Code 2.1.289), pour tsconfig.json
├── commands/ccstats.md          /stats-board:ccstats, connue avant le démarrage du mod
├── skills/recap/
│   ├── SKILL.md                 /stats-board:recap : le récap de la discussion et de la journée dans le chat
│   ├── recap.mjs                script Node autonome : rapports ccusage, autres postes, rendu en Markdown
│   └── recap.test.mjs           tests du rendu (`node --test`)
├── hooks/
│   ├── hooks.json               déclare le module register.tsx
│   ├── register.tsx             branchement : événements, état, relevé (npx, Node, fichiers), partage par git, commande /ccstats
│   ├── model.ts                 données pures : palette, lecture de ccusage et de /stats, fichiers publiés et fusion des postes, filtres, agrégats, formats français
│   ├── view.tsx                 dessin du panneau et du bandeau, toutes surfaces, sans `$`
│   ├── svg.ts                   graphiques SVG (carte du coût, calendrier, barres empilées, anneau, colonnes, bloc de 5 h)
│   └── raster.ts                grilles de cases du terminal (`Raster`) : calendrier, sa légende, colonnes ; empaquetage des cases en base64
├── types/index.d.ts             contrat de l'état (`PluginState`)
├── tsconfig.json
└── tests/                       `claude plugin test` : le modèle, les grilles de cases, le panneau, le bandeau
```

Tous les appels au moteur (`$`) restent dans `register.tsx` : `claude plugin validate` lit les clés d'état et les appels d'après ce fichier.

La table d'éléments de `$.ui.resolve(e)` contient tous les éléments sur toutes les surfaces : un élément absent y dessine un fragment vide. `register.tsx` dit donc à la vue si la surface dessine les SVG (pas le terminal). Pour `Raster`, `kitOf` (view.tsx) essaie le constructeur de la table : il ne sert que s'il rend vraiment un élément `Raster` (pas un fragment), et jamais sur une surface qui dessine les SVG.

---

## Développement

```bash
claude plugin validate plugins/stats-board
```

```bash
claude plugin test plugins/stats-board
```

```bash
node --test plugins/stats-board/skills/recap/recap.test.mjs
```

- Lancer les commandes depuis un chemin court (`~`) : depuis un dossier au chemin trop long, Windows refuse le dossier courant.
- Les tests simulent ccusage, Node, le disque et le store (`world`). Ils montent le panneau sur `terminal` et `desktop`, et chaque onglet sur les quatre surfaces à 40, 80 et 140 colonnes.
- Vérification de types : `tsc -p plugins/stats-board` avec TypeScript 5.4 ou plus récent. Sans `tsc` installé, l'API `typescript.js` livrée avec VS Code fait l'affaire.
- Pour regarder le rendu sans session : un test temporaire peut monter le panneau avec de vraies sorties de ccusage et afficher `pane.drawn()` par `console.log`. Les arbres (Box, Text, Button, Svg, Raster) se convertissent facilement en HTML.
- Les versions précédentes sont dans l'historique git du dépôt ; celles d'avant le passage à git restent dans `~/.claude/mods-archives/stats-board-<version>` sur le PC Windows.

---

## Limites connues

- **Serveur sans détail.** Son export n'a que des totaux par jour et par modèle : pas de sessions, de blocs ni de messages.
- **Blocs, messages et heures de ce poste seul.** Ils ne sont pas publiés : sous le filtre d'un autre poste, ces cartes disparaissent ; elles portent la mention « ce poste ».
- **Projets rapprochés par leur nom.** Deux projets différents qui portent le même nom de dossier sur deux postes sont additionnés.
- **Publication à chaque relevé qui change quelque chose** : le dépôt `claude-usage` reçoit un commit par poste et par relevé actif (au plus toutes les 20 minutes en usage normal).
- **Relevé gardé d'un autre format.** Un relevé dont le format (`schema`) n'est pas celui du mod est écarté au démarrage puis refait : le panneau reste vide quelques secondes.
- **Messages et heures sans filtre.** Le cache de `/stats` ne sépare ni les projets ni les modèles : les tuiles et cartes qui en viennent disparaissent quand un filtre de projet ou de modèle est posé.
- **Blocs de 5 h tous projets.** ccusage ne les sépare pas par projet.
- **Modèles sans prix.** Un modèle que ccusage ne sait pas tarifer compte 0 $ ; l'en-tête le nomme.
- **Fraîcheur.** Pas de relevé périodique (trois processus npx par relevé) : le bloc de 5 h et le coût du jour datent du dernier relevé, dont l'âge est affiché.
- **`@latest`.** ccusage est pris dans sa dernière version à chaque relevé ; un changement de son format JSON pourrait casser la lecture (le mod lit `date` comme `period`, et `sessions` comme `session`).
- **Coût par appel estimé.** Voir l'onglet Discussion : le total est celui de ccusage, sa répartition entre les appels est une estimation.
- **Deux coûts pour une discussion.** Le bandeau et l'onglet affichent le coût du moteur (`/cost`). ccusage compte la transcription : il peut différer un peu, et ne voit pas encore une discussion sans appel écrit (« Pas encore d'appel enregistré »).
- **Rythme du bandeau.** C'est celui du bloc de 5 h au dernier relevé : il vieillit avec lui.
- **Rendu réel à vérifier.** Les versions jusqu'à la 0.2.0 ont été vérifiées par `claude plugin test`, un relevé réel en `claude -p` et un aperçu HTML des arbres dessinés, pas encore dans l'app desktop ni dans un vrai terminal.
- **Animations.** Les dessins sont des images : sur le desktop, l'indicateur de relevé ne tourne probablement pas.
