# asana-board

Les tâches Asana du projet dans Claude Code, en **panneau** et en **bandeau** au-dessus du prompt. Le mod lit la section Asana nommée dans le `CLAUDE.md` du dossier (ou dans `docs/agents/issue-tracker.md`), puis ses tâches non terminées et leurs sous-tâches, rangées par la ligne « Statut : » du skill `asana-board:suivi-asana`.

- **Il se remplit dès le début.** Au démarrage, si le `CLAUDE.md` nomme une section Asana, une lecture de fond remplit le bandeau, sans rien bloquer.
- **Il permet d'agir.** Créer, cocher, changer le statut, assigner, commenter, modifier, abandonner ou supprimer une tâche, sans quitter Claude Code.
- **Il suit Claude.** Quand Claude écrit dans Asana pendant la discussion, le panneau se relit, et la ligne de l'appel dit l'écriture avec le nom des tâches (« Asana · coche « Corriger le bandeau » ») au lieu des GID et du JSON.

Version actuelle : **0.9.0**. Historique des versions : [CHANGELOG.md](CHANGELOG.md).

---

## Sommaire

1. [Installation](#installation)
2. [Utilisation](#utilisation)
3. [Le panneau](#le-panneau)
4. [Le bandeau](#le-bandeau)
5. [Écritures de Claude dans la conversation](#écritures-de-claude-dans-la-conversation)
6. [Commandes](#commandes)
7. [Lectures, erreurs et silence](#lectures-erreurs-et-silence)
8. [Données et stockage](#données-et-stockage)
9. [Architecture](#architecture)
10. [Développement](#développement)
11. [Limites connues](#limites-connues)

---

## Installation

Le mod est distribué par la marketplace `mathis-plugins` (dépôt GitHub `matwi5/mathis-plugins`, source dans `plugins/asana-board/`). Installation d'un poste et protocole de développement : README à la racine du dépôt.

```bash
claude plugin marketplace update mathis-plugins
claude plugin install asana-board@mathis-plugins
```

Pour une nouvelle version : modifier la source dans le clone de travail (`plugins/asana-board`), monter `version` dans `.claude-plugin/plugin.json` et dans l'entrée du mod de `.claude-plugin/marketplace.json` à la racine du dépôt, commiter et pousser, puis :

```bash
claude plugin marketplace update mathis-plugins
claude plugin update asana-board@mathis-plugins
```

Une mise à jour s'applique aux discussions démarrées après elle, ou après `/reload-plugins`.

**Prérequis**
- Claude Code avec les *function hooks* : mods de la version 2.1.286 ou plus récente.
- Le connecteur Asana dans la session. Le mod le trouve par ses outils `…__get_tasks` et `…__update_tasks`, quel que soit son nom.
- Une section Asana dans le `CLAUDE.md` du dossier ou dans `docs/agents/issue-tracker.md` (lus dans cet ordre), sous l'une de ces formes :

  ```md
  projet « Suivi des tâches » (GID `1200000000000001`), section « Mon projet » (GID `1200000000000002`)
  ```

  ```md
  | Projet | « Suivi des tâches », GID `1200000000000001` |
  | Section | « Mon projet », GID `1200000000000002` |
  ```

  Le projet est facultatif ; il sert à créer des tâches dans la section. Il est pris dans le fichier de la section, sinon dans l'autre.
- **Mode automatique** : chaque outil Asana appelé par le mod (`get_me`, `get_tasks`, `get_task`, `update_tasks`, `create_tasks`, `add_comment`, `delete_task`) doit être autorisé dans `permissions.allow`. Le classifieur ne juge que les demandes du modèle, pas celles d'un mod.

---

## Utilisation

1. **Ouvrir une discussion** dans un dossier dont le `CLAUDE.md` nomme une section Asana. Le bandeau apparaît après la première lecture réussie.
2. **Ouvrir le panneau** : « ▸ Ouvrir » dans le bandeau (depuis la 0.9.0 ; avant, « ▸ /asana »), `/asana`, ou `/asana-board:asana` en tout premier message.
3. **Agir sur une tâche** : `▸` la déplie. « ▶ Travailler dessus » met la demande dans le prompt, sans l'envoyer : Entrée la lance.

---

## Le panneau

De haut en bas :

| Zone | Contenu |
|---|---|
| **En-tête** | Pastille « ◆ ASANA », état (lecture, erreur, « À jour » en vert pendant 10 min, puis « Lue » en gris) ; anneau de répartition par statut (SVG) ou total et barre en blocs (terminal) ; nom de la section ; tâches ouvertes, filtre, « pour toi », retards, âge de la lecture ; légende des groupes ; « + Nouvelle tâche » (« ▾ Replier le formulaire » quand il est ouvert : le brouillon reste) et « ↻ Relire » (« Lecture… » pendant une lecture, qu'il attend au lieu d'en lancer une seconde). Avant la première lecture réussie, une carte d'accueil remplace l'en-tête : aucun compte n'est affiché tant que rien n'est lu. |
| **Onglets** | « Tous · N », « Pour toi · N », « Pour Claude · N ». Les comptes de l'en-tête suivent le filtre, et le disent. |
| **État** | À la même place : lecture en cours (spinner et progression), carte d'erreur avec « ↻ Réessayer », ou avertissement. |
| **Formulaire** | Titre (focus d'entrée), statut, pour qui, emplacement, contexte, critère de fin, échéance. « Annuler » vide le brouillon. |
| **Groupes** | ⚖ À trancher, ◉ En cours, ⏸ En attente d'autres (replié d'office), ○ À faire, · Sans statut, puis ✓ Terminées (cochées depuis la dernière lecture, pour pouvoir décocher). Dans un groupe, l'échéance la plus proche d'abord, puis le titre. Douze tâches au plus, puis « ▸ tout voir (N) ». |
| **Tâche** | Une ligne : case, titre tronqué, personne (sous l'onglet « Tous » seulement), échéance colorée (rouge si dépassée ou sous 2 jours, ambre sous 7). Dépliée, une carte bordée de la couleur du groupe : statut, description, actions (dont le lien « Asana ↗ » ; sur le terminal, qui écrivait l'adresse entière, un bouton « ⧉ Asana » la copie et un toast le confirme, ou donne l'adresse sans copie possible), commentaire. |

- Le retour d'une action passe par un toast, puisque la tâche peut changer de groupe. Une erreur garde un toast court ; son détail complet reste sous la tâche, dépliée pour qu'il se voie.
- Pendant une écriture, la case de la tâche devient un spinner : un second appui ne relance rien, et un toast dit qu'une écriture est en cours.
- Si le prompt ne peut pas être rempli, « ▶ Travailler dessus » donne la demande à taper dans un toast.
- Cocher passe aussi la ligne « Statut : » à « fait », dans la même écriture ; décocher la remet à « à faire ». Une description mise en forme dans Asana n'est pas réécrite : la tâche est cochée quand même, et le toast dit que le statut n'a pas changé.
- « Oui, supprimer » n'est pas l'action principale : « Abandonner » garde une trace (commentaire, puis coche avec « Statut : abandonnée »).
- Sur le mobile, il n'y a ni champ ni liste de choix. Le panneau le dit en une ligne atténuée : « Mobile : pas de saisie (création, statut, commentaire). »

---

## Le bandeau

Une ligne, deux au plus, sous les bandeaux des autres mods (flow-board, git-board…) :

- **Ligne 1** : barre « ▍ » et nom « Asana » en rose (même colonne que Git et Flow), nom de la section (à partir de 90 colonnes), petite barre de répartition (64), comptes par groupe (à trancher, en cours, à faire, sans statut, puis en attente, atténué), « ⚠ N en retard », « pour toi : N » (72). À droite : « ▸ Ouvrir » ouvre le panneau, `x` masque le bandeau.
- **Ligne 2** (à partir de 56 colonnes, seulement s'il y a quelque chose) : la lecture en cours, l'erreur d'une relecture demandée, rien d'autre : ni échéance ni retard détaillés, les retards sont comptés en ligne 1. En tête, une barre « ▍ » et le nom du mod, de sa couleur, alignés avec ceux des autres bandeaux.
- **La ligne 1 tient toujours sur sa largeur.** Les paliers disent le plus riche ; si ça ne tient pas, le nom de section part, puis les comptes passent en glyphes (`⚖1 ◉1 ○2 ⏸1`), puis s'en vont, dans cet ordre, « pour toi », la barre, le compte « en attente » ; le retard s'abrège en `⚠1`, et le nom part en dernier recours, la barre reste. Sur 80 colonnes, les comptes sont en glyphes.

Les comptes du bandeau ne suivent pas le filtre du panneau. Le bandeau n'apparaît qu'après une lecture réussie ; pendant une relecture, il garde les dernières données.

**Masquer** : `x` ou `/asana hide`. La ligne d'état sous le prompt prend alors le relais. `/asana show` le réaffiche. Ce choix vaut pour la discussion.

---

## Écritures de Claude dans la conversation

Depuis la 0.6.0, quand Claude appelle un outil d'écriture du connecteur Asana (`…__update_tasks`, `…__create_tasks`, `…__add_comment`, `…__delete_task`), la ligne de l'appel dans la conversation devient une phrase courte, sur toutes les surfaces :

| Appel | Ligne |
|---|---|
| `update_tasks` avec `completed: true` (ou `false`) | Asana · coche (décoche) « X » |
| `update_tasks` avec une ligne « Statut : » dans `notes` | Asana · statut « en cours » sur « X » |
| `update_tasks` avec `name`, `assignee`, `due_on` | Asana · renomme « X » en « Y » ; assigne « X » à toi ; confie à Claude « X » ; échéance 2026-10-20 sur « X » |
| `update_tasks` aux modifications de sortes différentes | Asana · modifie « X », « Y » |
| `add_comment` | Asana · commentaire sur « X » |
| `create_tasks` | Asana · crée « Y » (le nom vient de l'appel) |
| `delete_task` | Asana · supprime « X » |

- Les noms viennent des tâches déjà lues par le panneau, sans relecture : un GID inconnu s'affiche tel quel (« tâche 1200… »).
- Plusieurs tâches : trois noms au plus, sinon les deux premiers et « +n ».
- Pendant l'appel, la ligne est atténuée et finit par « … ».
- La ligne du moteur reste pour un appel en erreur ou interrompu, et pour une entrée qui n'a pas la forme attendue. Le résultat de l'appel, sous la ligne, n'est pas touché.

---

## Commandes

| Commande | Effet |
|---|---|
| `/asana` | Ouvre le panneau et relit la section (dossier suivi, sinon celui de la session). |
| `/asana <dossier>` | Suit un autre dossier, dont le `CLAUDE.md` nomme la section. |
| `/asana tous`, `/asana toi`, `/asana claude` | Ouvre le panneau sur cet onglet. |
| `/asana hide` | Masque le bandeau ; une ligne d'état prend le relais. |
| `/asana show` | Réaffiche le bandeau et ouvre le panneau. |

**Skill `suivi-asana`** (`/asana-board:suivi-asana`, depuis la 0.3.0) : la règle d'écriture des tâches (nom `[code] …`, ligne « Statut : », assignation, un seul niveau de sous-tâches) que le panneau suppose. Claude le déclenche de lui-même dès que du travail est fait, découvert ou modifié dans un projet suivi, mais n'écrit dans Asana qu'après l'accord de Mathis sur la liste des changements (depuis la 0.4.0).

**Dès le premier message : `/asana-board:asana`.** `/asana` est déclarée par le mod au démarrage de la session ; sur le desktop, ce démarrage n'a lieu qu'à l'envoi du premier message. `/asana-board:asana`, déclarée par `commands/asana.md`, est disponible tout de suite et accepte les mêmes arguments. Le mod y répond lui-même, sans passer par le modèle. Une fois le mod démarré, `/asana` sort du menu, mais reste utilisable tapée en entier.

---

## Lectures, erreurs et silence

| Lecture | Lancée par | En cas d'échec |
|---|---|---|
| **Demandée** | `/asana`, `↻ Relire`, `↻ Réessayer` | L'erreur s'affiche dans le panneau (carte rouge) et, en ligne 2, dans le bandeau. `/asana` répond « Panneau Asana : <erreur> ». |
| **De fond** | Le démarrage de la session ; une écriture de Claude dans Asana | Rien : ni toast, ni bandeau d'erreur, ni ligne d'état. |

- Au démarrage, sans section Asana dans le `CLAUDE.md` : aucun appel. Connecteur pas encore là : nouvel essai après 5 s, 15 s puis 45 s, puis abandon sans un mot. Un `/asana` fait entre-temps (qui dit « Connecteur Asana introuvable ») n'arrête pas ces essais.
- **Jamais deux lectures en même temps.** Un `/asana` ou un `↻` pendant une lecture l'attend. Une lecture demandée ne repart ensuite que si l'autre n'a pas fait son travail : autre dossier, ou lecture de fond échouée (il faut alors montrer l'erreur).
- `/asana` attend la fin de la lecture pour répondre. Si la lecture dépasse le temps alloué au mod (plus de 10 s de pauses entre essais), la commande répond elle-même (« Lecture Asana trop longue pour attendre ici… ») au lieu de laisser le modèle dire que le mod n'est pas chargé ; si la lecture ne s'achève pas, `↻ Relire` la relance.
- Une erreur ne vide pas la liste : la dernière lecture réussie reste affichée, et la carte d'erreur dit de quand elle date.
- Asana répond parfois 500 sous la charge : la lecture d'une sous-tâche est retentée une fois après 1,5 s, puis la tâche s'affiche sans ses détails, avec un avertissement.

---

## Données et stockage

| Donnée | Emplacement | Portée |
|---|---|---|
| Tâches lues, dossier, filtre, groupes repliés, brouillon, bandeau masqué | État de session (`$.state`) | Une discussion |

Le mod ne garde rien d'une discussion à l'autre. Il écrit dans Asana seulement à la demande de la personne (boutons et champs du panneau).

---

## Architecture

```
asana-board/
├── .claude-plugin/plugin.json   manifeste (nom, version, contrat de types)
├── commands/asana.md            /asana-board:asana, connue avant le démarrage du mod
├── hooks/
│   ├── hooks.json               déclare le module register.tsx
│   ├── register.tsx             tout ce qui passe par $ : état, hooks, lectures et écritures Asana
│   ├── model.ts                 données pures : rangement par statut, comptes, échéances, saisie, lignes des écritures de Claude
│   ├── view.tsx                 dessin du panneau et du bandeau, toutes surfaces
│   └── svg.ts                   anneau de répartition, barres, indicateurs (copiés de flow-board)
├── skills/suivi-asana/          skill de tenue du projet de suivi (SKILL.md, references/)
├── types/index.d.ts             contrat de l'état (`PluginState`)
└── tests/asana-board.test.ts    `claude plugin test`
```

`view.tsx` ne touche jamais `$` : il reçoit l'état lu et les actions en fermetures. `register.tsx` lui dit aussi ce que la surface dessine (SVG, champs de saisie), d'après le contrat des surfaces du moteur.

---

## Développement

```bash
scripts/check.sh asana-board
```

Tous les contrôles, depuis la racine du dépôt (`scripts\check.cmd` sous Windows) : types, tests avec le Claude Code du terminal et celui de l'app desktop, `claude plugin validate`.

- Les tests montent le panneau sur `terminal`, `desktop`, `vscode` et `mobile`, le bandeau sur `terminal` et `desktop`, sous un autre bandeau, et la ligne des écritures de Claude (`ToolUse`) sur `terminal` et `desktop`. Ils simulent Asana, le `CLAUDE.md`, l'horloge et le moteur.
- Dans le kit de test, un hook qui remplace une opération du moteur (`fs.read`, `ui.open`, `mcp.call`…) doit rendre `{ value }`.
- `$.mcp.call` rend le texte que voit le modèle : une réponse trop longue (55 Ko le 14/10/2026) y devient un encart `<persisted-output>` qui donne le chemin du fichier où le moteur l'a rangée, ou (vu le 16/10/2026, 74 Ko) un message « Error: result (… characters) exceeds maximum allowed tokens. Output has been saved to <chemin>. ». `asana()` relit ce fichier dans les deux cas (`persistedPath`), avant de traiter la réponse comme une erreur.
- La table de `$.ui.resolve(e)` porte tous les noms d'éléments, même ceux que la surface ne dessine pas (un fragment vide). On ne peut donc pas tester `typeof table.Svg` : la surface décide.
- Les versions précédentes sont dans l'historique git du dépôt ; celles d'avant le passage à git restent dans `~/.claude/mods-archives/asana-board-<version>` sur le PC Windows.

---

## Limites connues

- **Plus de 100 tâches** dans la section : la liste est tronquée (pas de pagination).
- **Plan gratuit** (depuis la 0.5.0) : ni priorité, ni champ personnalisé, ni dépendance ; Asana les refuse (`payment_required`). Détail dans `skills/suivi-asana/references/conventions.md`.
- **Titulaire** : « Toi » est le nom affiché codé en dur (`ME` dans `hooks/model.ts`).
- **Relecture après une écriture de Claude** : déclenchée par le nom de l'outil (`…__update_tasks`, `…__create_tasks`, `…__add_comment`, `…__delete_task`), quel que soit le serveur.
- **Ligne d'une écriture de Claude** : repérée par le même nom d'outil ; une tâche hors de la section suivie (ou avant la première lecture) s'affiche par son GID. Le moteur ne dit pas si la conversation est en vue détaillée : la ligne courte s'y affiche aussi, le résultat de l'appel restant celui du moteur.
- **Animations** : les dessins sont des images ; sur le desktop, le spinner SVG est probablement figé.
- **Largeurs** : celle de la ligne 1 du bandeau est estimée (les glyphes d'état comptent pour deux cellules, par prudence) ; sur le desktop, la police est proportionnelle.
- **Rechargement à chaud** en pleine écriture ou lecture : le spinner figé est libéré au `session.start` suivant du mod.
