# git-board

Panneau Git et bandeau au-dessus du prompt, dans Claude Code. Il montre la branche, son écart avec le distant, les fichiers modifiés, les branches, l'historique et la pull request.

- **Il lit, il n'écrit pas.** Le mod ne lance que des lectures git, `git fetch` et `git switch`.
- **Il délègue la livraison.** Commit, pull, push et PR passent par les commandes du plugin `project` (`/project:commit`, `/project:sync`, `/project:push`, `/project:pr`).
- **Il suit le dépôt tout seul.** Une relecture suit chaque outil d'écriture de Claude, et un coup d'œil léger repère toutes les 10 s les changements faits ailleurs. Après un push, il suit la CI jusqu'à la fin de ses checks.
- **Il propose le push.** À la fin d'un tour, des commits à pousser sur un arbre propre : `/project:push` apparaît grisé dans le prompt, Tab pour le prendre.

Version actuelle : **0.5.0**. Historique des versions : [CHANGELOG.md](CHANGELOG.md).

---

## Sommaire

1. [Installation](#installation)
2. [Utilisation](#utilisation)
3. [Le panneau](#le-panneau)
4. [Le bandeau](#le-bandeau)
5. [Commandes](#commandes)
6. [Données et rafraîchissement](#données-et-rafraîchissement)
7. [Architecture](#architecture)
8. [Développement](#développement)
9. [Limites connues](#limites-connues)

---

## Installation

Le mod est distribué par la marketplace `mathis-plugins` (dépôt GitHub `matwi5/mathis-plugins`, source dans `plugins/git-board/`). Installation d'un poste et protocole de développement : README à la racine du dépôt.

```bash
claude plugin marketplace update mathis-plugins
claude plugin install git-board@mathis-plugins
```

Pour une nouvelle version : modifier la source dans le clone de travail (`plugins/git-board`), monter `version` dans `.claude-plugin/plugin.json` et dans l'entrée du mod de `.claude-plugin/marketplace.json` à la racine du dépôt, commiter et pousser, puis :

```bash
claude plugin marketplace update mathis-plugins
claude plugin update git-board@mathis-plugins
```

Une mise à jour s'applique aux discussions démarrées après elle, ou après `/reload-plugins`.

**Prérequis**
- Claude Code avec les *function hooks* : mods de la version 2.1.286 ou plus récente.
- `git` dans le `PATH`.
- Facultatifs :
  - le plugin `project`, pour les boutons Commit, Pull, Push et PR ;
  - la CLI GitHub `gh`, pour lire la pull request et suivre la CI.

---

## Utilisation

- Dans un dépôt git, le **bandeau** apparaît au-dessus du prompt dès le démarrage de la session.
- `/git-board:git` (ou `/git`) ouvre le **panneau**. L'ouverture relit tout : `git fetch`, puis le dépôt, puis la PR.
- `/git <dossier>` suit un autre dépôt que celui de la session. Le bouton « ↩ session » de l'en-tête ramène au dossier de la session.

Le panneau ne s'ouvre jamais seul : seulement par une commande ou par « ▸ /git » dans le bandeau.

---

## Le panneau

De haut en bas :

1. **La carte d'en-tête.**
   - Ligne 1 : la pastille de la branche (violette au repos, rouge pendant une opération ou un conflit, tronquée si le nom est long), la commande `/project` en file ou en cours, « ↩ session » quand un autre dossier est suivi, « ↻ Relire ».
   - Ligne 2 : la jauge ↑/↓ (SVG, sur le desktop, VS Code et le mobile), puis sur une ligne le nom du dépôt, la branche suivie et l'âge du fetch. « fetch jamais » quand aucun n'est connu. Un fetch en échec s'affiche en rouge.
   - Les pastilles d'état, par gravité : opération en cours, conflits, à récupérer et à pousser (sur le terminal ; ailleurs la jauge les montre), à jour, ou pour une branche sans distante « ○ vide » (aucun commit depuis sa création, d'après son reflog), « ✓ fusionnée » (tous ses commits sont dans la branche par défaut locale), « ⤞ N à fusionner » (worktree lié : sa branche ne se pousse pas, elle se fusionne en local) ou « ◌ non publiée », modifiés, nouveaux, stash.
   - La pull request, sur une ligne : numéro, état, relecture, checks, titre, lien (« Ouvrir ↗ » ; sur le terminal, qui écrivait l'adresse entière, un bouton « ⧉ PR » la copie et un toast le confirme). Sans PR : « pas encore de pull request ». Pendant le suivi de la CI (voir [Suivi de la CI](#suivi-de-la-ci)), son état remplace les checks ; sans PR, il a sa propre ligne. Une PR fusionnée ou fermée ne compte que tant que HEAD est encore sa tête : une branche réutilisée après une fusion (`dev`, par exemple) repart à « PR à ouvrir » dès qu'elle a de nouveaux commits.
   - La route de livraison : Commit → Push → PR → Checks → Fusion (SVG, ou glyphes reliés sur le terminal). Elle se parcourt dans l'ordre : dès qu'une étape n'est pas faite, les suivantes sont « à venir » (un commit à pousser rend caducs la PR, les checks et la fusion d'avant ; seul le numéro d'une PR encore ouverte reste). Sans distante, Push dit le même état que les pastilles et compte comme fait pour une branche fusionnée ; pour une branche vide, il reste l'étape en cours. Le tiroir Push d'une branche vide, fusionnée ou à fusionner le dit (« rien à pousser d'ici », « à fusionner dans main d'abord ») sans proposer `/project:version` ni `/project:push`. Sur le terminal étroit, les libellés qui ne tiennent pas prennent une forme courte (« Com. », « CI », « Fus. »).
2. **La zone d'activité**, toujours sous l'en-tête : lecture en cours, bascule, commande `/project` en file ou en cours, dernier message. C'est le seul endroit où une lecture s'affiche. Une erreur reste jusqu'à son « x ». Une commande `/project` est finie dès que le dépôt relu montre son effet (« … : fait d'après le dépôt. ») : commit, HEAD a bougé ; sync, un fetch depuis le lancement et plus rien à récupérer ; push, plus rien à pousser ; PR, une PR existe. Sinon, la fin du tour de Claude la clôt, sans « ✓ » (« tour terminé » ou « interrompue »).
3. **La carte d'opération** (rebase, merge…), en rouge, quand il y en a une.
4. **La barre d'actions** : ✓ Commit, ↓ Pull, ↑ Push, ⇄ Pull request, sans comptes (l'en-tête les dit). Seule l'étape suggérée est mise en avant, tant que son tiroir est fermé. Chacune ouvre un tiroir sobre avec « ▶ Lancer · /project:… » ; son « ✕ » ne ferme que le tiroir. Quand il y a quelque chose à pousser, le tiroir Push suggère de lancer d'abord `/project:version` (numéro de version et CHANGELOG), avec un bouton « ▶ D'abord · /project:version » ; sans repère dans le dépôt, cette commande n'est finie qu'avec le tour de Claude. En HEAD détachée, les tiroirs Pull, Push et PR disent seulement de basculer sur une branche. Le tiroir d'une PR ouverte a son lien « Ouvrir sur GitHub ↗ », « ⧉ PR » sur le terminal. Sans copie possible, le toast donne l'adresse à recopier.
5. **Les onglets**, avec leurs comptes :
   - **Modifications** : total `+a −r lignes` et barre de diff, puis les fichiers groupés (En conflit, Indexés, Modifiés, Nouveaux).
   - **Branches** : création, filtre, branches locales en lignes compactes, branches seulement distantes repliées. Chaque liste a sa bascule « tout voir ».
   - **Historique** : commits en lignes compactes, tags, commits pas encore poussés, et le lien de chaque commit sur GitHub (« ↗ » ; sur le terminal, un bouton « ⧉ » qui copie son adresse).

Les listes longues sont plafonnées (20 fichiers, 12 branches, 12 commits) avec « ▸ tout voir (N) ».

Le retour des actions passe par un toast et par la zone d'activité.

**Mobile.** Le mobile n'a ni champ de saisie ni liste de choix. Le panneau s'y dessine quand même et dit en une ligne atténuée ce qui n'est pas disponible (indice de commit, création de branche, choix de la base de PR…).

---

## Le bandeau

Une ligne, deux au plus, dans un dépôt git seulement.

```
⎇ feat/export  ↑2 ↓1  ● 3 + 1 · +13 −1  ⇄ #7 Ouverte ✓ 1 ◌ 1  fetch il y a 4 min      ▸ /git  x
  ▶ /project:commit en file
```

- Ligne 1 : branche, ↑/↓ ou « ✓ à jour », ou sans distante « ○ vide », « ✓ fusionnée », « ⤞ N à fusionner » ou « ◌ non publiée » (comme les pastilles du panneau), conflits, modifiés et nouveaux.
  - À partir de 72 colonnes : total `+a −r` (séparé des fichiers par « · ») et PR.
  - À partir de 90 colonnes : âge du fetch (« fetch jamais » quand aucun n'est connu), et nom du dépôt s'il diffère de celui de la session.
  - Un fetch en échec s'affiche dès 64 colonnes.
- Ligne 2 (à partir de 56 colonnes, seulement s'il y a quelque chose) : opération en cours en rouge, sinon commande `/project` en file (« ▶ ») ou en cours (spinner), sinon bascule en cours.
- Pendant le suivi de la CI, son état court remplace les checks de la PR (`◌ CI`, `◌ CI 1/3`, `✓ CI`, `✗ CI <check>`) ; sans PR, il prend sa place, à partir de 72 colonnes.
- « ▸ /git » ouvre le panneau. « x » masque le bandeau pour la session ; la ligne d'état sous le prompt prend alors le relais. `/git show` le réaffiche.

Le bandeau s'empile avec ceux des autres mods (flow-board, asana-board…) : il ne les efface jamais. Les sources du moteur ne fixent pas l'ordre vertical entre plugins. En tête, une barre « ▍ » et le nom du mod, de sa couleur, alignés avec ceux des autres bandeaux.

---

## Commandes

| Commande | Effet |
|---|---|
| `/git-board:git` | Ouvre le panneau et relit tout. Connue dès le premier message. |
| `/git` | La même commande, déclarée au démarrage du mod. Masquée du menu, utilisable tapée en entier. |
| `/git changes`, `/git branches`, `/git history` | Ouvre le panneau sur cet onglet (`modifications` et `historique` marchent aussi). |
| `/git hide` | Masque le bandeau ; la ligne d'état prend le relais. |
| `/git show` | Réaffiche le bandeau et ouvre le panneau. |
| `/git <dossier>` | Suit le dépôt de ce dossier. |

`hide`, `show` et les noms d'onglets sont réservés : un dossier qui porte ce nom s'ouvre avec son chemin (`./history`).

**Dès le premier message : `/git-board:git`.** Sur le desktop, le mod ne démarre qu'à l'envoi du premier message : avant, `/git` n'existe pas. `/git-board:git`, déclarée par `commands/git.md`, est là tout de suite. Le mod y répond lui-même, sans passer par le modèle.

---

## Données et rafraîchissement

| Donnée | Emplacement | Portée |
|---|---|---|
| Dépôt lu, PR, onglet, tiroir, formulaires, bandeau masqué, listes dépliées | État de session (`$.state`) | Une discussion |

Le mod n'écrit rien sur disque.

| Lecture | Quand |
|---|---|
| Lecture locale (sans fetch), puis PR (un appel `gh`) | Au démarrage, en arrière-plan, une seule fois, si le dépôt n'est pas déjà lu |
| PR | À la demande, ou quand la branche a changé |
| Lecture complète (fetch, dépôt, PR) | `/git`, « ↻ Relire », changement de dossier |
| Lecture du dépôt | 500 ms après le dernier outil d'écriture de Claude (avec la PR après `git push` ou `gh pr`) ; à la fin d'une commande `/project` lancée du panneau |
| Coup d'œil (`status` + `diff --numstat`) | Toutes les 10 s ; relecture seulement si quelque chose a bougé |
| Checks du commit poussé (un appel `gh`) | Après un push, toutes les 25 s jusqu'à la fin des checks (voir ci-dessous) |

Il n'y a pas de fetch périodique : l'âge du fetch est affiché dans l'en-tête et dans le bandeau large. Il vient du dernier fetch de la session ou, s'il est plus récent, de la date de `.git/FETCH_HEAD` (un fetch fait hors de la session compte donc aussi).

Les âges affichés se redessinent toutes les 5 s pendant une activité, toutes les 30 s au repos.

### Suivi de la CI

- **Quand.** Après un `git push` lancé par Claude (outil Bash), et après un `/project:push` lancé du panneau, une fois le dépôt relu : seulement sur un distant GitHub, et si le commit est bien arrivé sur l'amont (plus rien à pousser).
- **Comment.** Toutes les 25 s, sur le commit poussé (HEAD en entier) : avec une PR ouverte, `gh pr view` (ses checks se mettent aussi à jour dans le panneau ; tant que la PR montre encore l'ancienne tête, c'est « en attente ») ; sans PR, `gh run list --commit <sha> --json status,conclusion,name,url` (exécutions GitHub Actions).
- **Affichage.** « ◌ CI en attente » tant que rien n'est lancé, « ◌ CI 1/3 » en cours (finis/total), « ✓ CI réussie », « ✗ CI échouée : <premier check en échec> ». Un check annulé dont un homonyme (même workflow, même nom) ne l'est pas a été remplacé, par exemple par `concurrency: cancel-in-progress` : il ne compte pas ; seul, il reste un échec. Sur la route, l'étape Checks dit « attente » au lieu de « aucun ». Sans suivi, une PR sans checks et une PR dont les checks ne sont pas encore lancés s'affichent pareil (« aucun » sur la route) : seul le suivi les distingue.
- **Fin.** Un toast et la zone d'activité à la fin (réussie, ou échouée avec le nom du check). Au bout de 20 min, le suivi s'arrête sur « CI encore en cours (suivi arrêté) ». Toujours aucun check au bout de 3 min : « aucun check », sans toast.
- **Arrêt.** Au changement de branche ou de dossier. `gh` absent, non connecté ou illisible : le suivi s'arrête sans rien afficher, le panneau reste comme avant.

### Suggestion de fin de tour

À la fin d'un tour principal (pas celui d'un sous-agent), après une relecture du dépôt : si la branche a des commits en avance sur son amont, que l'arbre est propre (aucun fichier modifié, nouveau ou en conflit), qu'aucune opération (rebase, merge…) n'est en cours, que le dépôt suivi est celui de la session et qu'aucune commande `/project` n'est en file ou en cours, `/project:push` est proposé en suggestion grisée dans le prompt (`$.prompt.suggest`). Le moteur ne la montre pas si le prompt contient déjà du texte. flow-board l'écarte pendant un parcours.

---

## Architecture

```
git-board/
├── .claude-plugin/plugin.json   manifeste (nom, version, contrat de types)
├── .claude-plugin/types/        types du moteur (copiés d'asana-board), pour tsconfig.json
├── commands/git.md              /git-board:git, connue avant le démarrage du mod
├── hooks/
│   ├── hooks.json               déclare le module register.tsx
│   ├── register.tsx             branchement : événements, état, lectures git et gh, commande /git
│   ├── model.ts                 données pures : palette, analyse des sorties git et gh, étape suggérée
│   ├── view.tsx                 dessin du panneau et du bandeau, toutes surfaces, sans `$`
│   └── svg.ts                   SVG copiés de flow-board, plus la jauge ↑/↓
├── types/index.d.ts             contrat de l'état (`PluginState`)
├── tsconfig.json
└── tests/git-board.test.tsx     60 tests `claude plugin test`
```

Tous les appels au moteur (`$`) restent dans `register.tsx` : `claude plugin validate` lit les clés d'état et les appels d'après ce fichier.

La table d'éléments de `$.ui.resolve(e)` contient tous les éléments sur toutes les surfaces : un élément absent y dessine un fragment vide. `register.tsx` lit donc les capacités de la surface dans le contrat du moteur (pas de `Svg` sur le terminal, ni `Input` ni `Select` sur le mobile) et les passe à `kitOf`.

---

## Développement

```bash
cd ~
claude plugin validate plugins/git-board
claude plugin test plugins/git-board
```

- Lancer les commandes depuis un chemin court (`~`) : depuis un dossier au chemin trop long, Windows refuse le dossier courant.
- Les tests simulent git et gh (`fakeRepo`). Le mock repère la sous-commande après `color.ui=never` : ne pas changer l'ordre des options de `git()`.
- Ils montent le panneau sur `terminal`, `desktop`, `vscode` et `mobile`, à 40, 80 et 140 colonnes, et le bandeau sur `terminal` et `desktop`, à 30, 80, 120 et 160 colonnes et de part et d'autre de chaque palier (55/56, 63/64, 71/72, 89/90).
- Dans le kit de test, un hook qui remplace une opération du moteur (`process.run`, `session.cwd`…) doit rendre `{ value }`.
- Les versions précédentes sont dans l'historique git du dépôt ; celles d'avant le passage à git restent dans `~/.claude/mods-archives/git-board-<version>` sur le PC Windows.

---

## Limites connues

- **Animations.** Les dessins sont des images : sur le desktop, les animations SVG ne tournent probablement pas.
- **Fraîcheur du distant.** Sans fetch périodique, « à jour » et « à récupérer » datent du dernier fetch : son âge est affiché (« fetch jamais » quand ni la session ni `FETCH_HEAD` n'en donnent ; un dépôt tout juste cloné n'a pas encore de `FETCH_HEAD`).
- **Hooks du dépôt.** `$.process.run` ne lance pas les hooks git : c'est pour ça que commit, pull, push et PR passent par `/project:*`.
- **CI hors GitHub Actions sans PR.** Sans PR, seules les exécutions GitHub Actions du commit sont lues (`gh run list`) : les checks d'autres services n'apparaissent qu'avec une PR.
- **Ordre des bandeaux.** Avec plusieurs mods, l'ordre vertical des bandeaux dépend de l'ordre de chargement des plugins.
