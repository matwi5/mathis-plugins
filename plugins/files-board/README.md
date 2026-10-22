# files-board

Navigateur de fichiers pour Claude Code CLI, à la manière de celui de l'app desktop : arborescence, recherche de fichiers, onglets d'aperçu, éditeur avec enregistrement automatique, menus contextuels et options d'affichage.

- **CLI seulement.** Dans l'app desktop, VS Code ou sur mobile, `/files` répond que le navigateur est réservé au terminal : l'app desktop a déjà le sien.
- **Souris et clavier.** Clic, double clic, clic droit, clic du milieu, glisser ; le clavier atteint le navigateur après un clic dedans, Échap le rend au prompt.
- **Il suit les fichiers.** Les onglets et l'arborescence se relisent après chaque outil d'écriture de Claude, et toutes les 4 s tant que le panneau est ouvert. Un fichier que Claude vient de modifier porte `◆`, ses dossiers `◇`, jusqu'à votre message suivant.

Version actuelle : **0.3.3**. Historique des versions : [CHANGELOG.md](CHANGELOG.md).

---

## Sommaire

1. [Installation](#installation)
2. [Utilisation](#utilisation)
3. [Le panneau](#le-panneau)
4. [Les options du desktop et leur équivalent](#les-options-du-desktop-et-leur-équivalent)
5. [Souris et clavier](#souris-et-clavier)
6. [Commandes](#commandes)
7. [Données et rafraîchissement](#données-et-rafraîchissement)
8. [Architecture](#architecture)
9. [Développement](#développement)
10. [Limites connues](#limites-connues)

---

## Installation

Le mod est distribué par la marketplace `mathis-plugins` (dépôt GitHub `matwi5/mathis-plugins`, source dans `plugins/files-board/`). Installation d'un poste et protocole de développement : README à la racine du dépôt.

```bash
claude plugin marketplace update mathis-plugins
```

```bash
claude plugin install files-board@mathis-plugins
```

Une mise à jour s'applique aux discussions démarrées après elle, ou après `/reload-plugins`.

**Prérequis**
- Claude Code avec les *function hooks* et l'élément `Client` (région interactive) : version 2.1.289 ou plus récente.
- L'affichage plein écran du terminal (par défaut) : sur l'affichage principal (`CLAUDE_CODE_NO_FLICKER=0`, tmux), la souris n'atteint pas le navigateur.
- Facultatifs : `git` (recherche de fichiers plus rapide, `.gitignore` respecté), `code` ou `cursor` dans le `PATH` (« Ouvrir dans »).

---

## Utilisation

- `/files-board:files` (ou `/files`) ouvre le panneau sur le dossier de la session.
- `/files <dossier>` parcourt un autre dossier ; `/files <fichier>` ouvre ce fichier et le montre dans l'arborescence.
- `/files close` ferme le panneau ; `/files toggle` l'ouvre ou le ferme.
- Le bouton « Fichiers » du pied du prompt (mod `session-tools`) fait la même bascule, sans ligne dans la conversation.
- Cliquer dans le panneau lui donne le clavier ; Échap le rend au prompt.

---

## Le panneau

```
≡  app.ts ×   README.md ●                                         ⌕ ⋮ □ ×
 ⌕ Rechercher des fichiers   │ src / app.ts
   .gitignore                │ 1 export const x = 1
 ▸ docs                      │ 2 function f() {
   README.md                 │ 3 │ return "s"
 ▾ src                       │ 4 }
     app.ts                  │
                             │   Ln 2, Col 7 · Espaces : 2 · LF · TypeScript · ✓ Enregistrement auto
```

1. **La barre du haut.** `≡` montre ou masque l'arborescence. Les onglets : l'actif en inverse, un aperçu en italique, `●` quand il a des modifications, `◆` (magenta) quand Claude l'a modifié depuis votre dernier message, sinon `×` ; un clic sur ce signe ferme l'onglet. `‹` et `›` font défiler les onglets qui ne tiennent pas. À droite : `⌕` rechercher dans le fichier, `⋮` options d'affichage, `□` agrandir (`▣` une fois agrandi), `×` fermer le panneau.
2. **L'arborescence.** Dossiers et fichiers mêlés, sans tenir compte de la casse, comme dans l'app desktop. Le fichier actif est en couleur, un fichier modifié porte `●`. Un fichier que Claude a modifié (Edit, Write, MultiEdit, NotebookEdit) porte `◆` en magenta, et chacun de ses dossiers parents `◇`, pour le retrouver même replié. En haut, la case « Rechercher des fichiers » : une recherche floue sur les chemins du dossier ; trop de résultats affichent « Certaines entrées peuvent ne pas être affichées. Continuez à saisir pour affiner. ».
3. **Le fil d'Ariane** (`docs / specs / flash-bets.md`) : un clic sur un dossier le montre dans l'arborescence. Pour un fichier Markdown, `</>` passe au source et « Aperçu » revient au rendu. Quand Claude a modifié le fichier, le fil d'Ariane ajoute « ◆ Rechargé : modifié par Claude » si l'onglet ouvert vient d'être relu, « ◆ Modifié par Claude » s'il a été ouvert après coup.
4. **L'éditeur.** Numéros de ligne, coloration syntaxique (JS/TS, JSON, Python, shell, PowerShell, CSS, HTML/XML, Markdown, YAML/TOML/INI, SQL, langages de la famille C), curseur, barre de défilement. Un fichier Markdown s'ouvre rendu, comme dans l'app desktop.
5. **Les bannières**, au-dessus du texte quand il le faut : la barre de recherche dans le fichier (`n/m`, `↑`, `↓`, `×`), « Modifié sur le disque pendant vos modifications » (`[Recharger]`, `[Garder les miennes]`), « n'est pas enregistré » à la fermeture d'un onglet modifié (`[Enregistrer]`, `[Ne pas enregistrer]`, `[Annuler]`).
6. **La ligne d'état** : position du curseur, indentation détectée, fin de ligne (LF ou CRLF, gardée à l'enregistrement), langage, état d'enregistrement.

Sous 70 colonnes, le panneau montre l'arborescence ou le fichier, pas les deux : ouvrir un fichier passe au fichier, Tab revient à l'arborescence.

---

## Les options du desktop et leur équivalent

**Menu `⋮`** (gardé d'une session à l'autre) :

| Option | Effet |
|---|---|
| Afficher l'arborescence de fichiers (Ctrl+Maj+Y) | Montre ou masque l'arborescence ; `≡` fait de même. |
| Onglets d'aperçu | Un simple clic ouvre un aperçu (italique) que le suivant remplace ; double clic, modification ou « Garder ouvert » l'épinglent. Décochée : chaque fichier garde son onglet. |
| Enregistrement automatique | Enregistre une seconde après la dernière frappe. Décochée : Ctrl+S ; le brouillon est gardé si le panneau se ferme. |
| La touche Tab indente | Tab indente (Maj+Tab désindente) ; décochée, Tab passe de la recherche à l'arborescence puis à l'éditeur. |
| Retour à la ligne automatique | Replie les longues lignes aux espaces ; décochée, défilement horizontal qui suit le curseur. |
| Repères d'indentation | Un `│` à chaque cran d'indentation. |
| Afficher les espaces | `·` pour un espace, `→` pour une tabulation. |
| Défilement au-delà de la fin | La dernière ligne peut monter en haut de l'éditeur. |
| Taille de tabulation › 2, 4, 8 | Largeur d'une tabulation, et cran d'indentation d'un fichier qui n'en a pas encore. |

**Clic droit sur un fichier ou un dossier** : Joindre comme contexte · Copier › (Chemin absolu, Chemin relatif, Nom du fichier) · Ouvrir dans › · Afficher dans l'Explorateur (le Finder sur macOS) · Copier le contenu du fichier (fichiers seulement).

**Clic droit sur un onglet** (ou dans l'éditeur) : les mêmes, plus Afficher dans l'arborescence de fichiers · Rechercher dans le fichier (Ctrl+F) · Recharger le fichier · Garder ouvert (aperçu seulement) · Fermer le fichier.

| Action | Dans le CLI |
|---|---|
| Joindre comme contexte | Insère `@chemin` au curseur du prompt (`@dossier/` pour un dossier, entre guillemets s'il y a une espace). |
| Copier | Presse-papiers du terminal (outil du système ou OSC 52). |
| Ouvrir dans | Application par défaut ; Visual Studio Code et Cursor s'ils sont dans le `PATH` ; Bloc-notes (Windows) ou TextEdit (macOS). |
| Afficher dans l'Explorateur | `explorer /select,` sous Windows, `open -R` sous macOS, le dossier parent avec `xdg-open` ailleurs. |
| Recharger le fichier | Relit le disque et abandonne les modifications non enregistrées. |

---

## Souris et clavier

**Souris**
- Clic : déplie un dossier, ouvre un fichier en aperçu, place le curseur, choisit une entrée de menu.
- Double clic : ouvre un fichier pour de bon (épinglé) ; dans l'aperçu Markdown, passe au source à cet endroit.
- Clic droit : menu de l'entrée, de l'onglet ou du fichier ouvert.
- Clic du milieu sur un onglet : le ferme.
- Glisser le séparateur `│` : largeur de l'arborescence (gardée). Glisser une barre de défilement : défile.
- Molette : relayée à la zone sous le pointeur (à vérifier dans un vrai terminal, voir les limites).

**Clavier** (après un clic dans le panneau)

| Touche | Effet |
|---|---|
| Ctrl+S | Enregistrer |
| Ctrl+F | Rechercher dans le fichier (encore une fois : fermer la barre) |
| Ctrl+P | Aller à la recherche de fichiers |
| Ctrl+W | Fermer l'onglet |
| Ctrl+PageSuiv / Ctrl+PagePréc | Onglet suivant / précédent |
| Ctrl+Maj+Y | Montrer ou masquer l'arborescence |
| Maj+F10 | Menu de la ligne ou de l'onglet choisi |
| Tab / Maj+Tab | Indenter / désindenter, ou changer de zone (voir l'option) |
| Échap | Rendre le clavier au prompt |

- **Arborescence** : ↑ ↓ PageSuiv PagePréc Début Fin pour choisir, → déplie, ← replie ou remonte au dossier parent, Entrée ouvre (et passe à l'éditeur), Espace ouvre en aperçu. Une lettre tapée lance la recherche.
- **Recherche de fichiers** : ↑ ↓ choisissent, Entrée ouvre le fichier ou montre le dossier dans l'arborescence, Ctrl+U efface.
- **Éditeur** : flèches, Ctrl+← →, Début (au premier caractère, puis en début de ligne), Fin, Ctrl+Début/Fin, PageSuiv/PagePréc ; Entrée garde l'indentation (un cran de plus après `{`, `[`, `(`, `:` en Python) ; Retour arrière recule d'un cran dans l'indentation ; Ctrl+Retour arrière efface un mot ; Ctrl+Z annule, Ctrl+Y ou Ctrl+Maj+Z rétablit.
- **Menus** : ↑ ↓, → ouvre un sous-menu, ← le referme, Entrée choisit ; un clic hors du menu le ferme.
- **Fermeture d'un onglet modifié** : Entrée enregistre, `n` n'enregistre pas, une autre touche annule.

---

## Commandes

| Commande | Effet |
|---|---|
| `/files-board:files` | Ouvre le panneau. Connue dès le premier message. |
| `/files` | La même, déclarée au démarrage du mod. Masquée du menu, utilisable tapée en entier. |
| `/files <dossier>` | Parcourt ce dossier (relatif au dossier de la session, absolu, ou `~/…`). |
| `/files <fichier>` | Ouvre ce fichier et le montre dans l'arborescence. |
| `/files close` | Ferme le panneau. |
| `/files toggle` | Ouvre le panneau s'il est fermé, le ferme sinon. Lancée par un autre plugin (bouton « Fichiers »), elle n'écrit rien dans la conversation. |

---

## Données et rafraîchissement

| Donnée | Emplacement | Portée |
|---|---|---|
| Options du menu `⋮`, largeur de l'arborescence | `$.store` du plugin | Toutes les sessions |
| Dossier parcouru, dossiers dépliés, onglets, brouillons, recherche, fichiers modifiés par Claude | État de session (`$.state`) | Une discussion |
| Curseur, défilement, annulations, menus | La région elle-même | Tant que le panneau est ouvert |

| Lecture | Quand |
|---|---|
| Dossier | À son dépliage ; relu après un outil d'écriture de Claude (400 ms après le dernier) et toutes les 4 s panneau ouvert |
| Fichier ouvert | À son ouverture ; relu quand sa date ou sa taille change (mêmes moments) |
| Index de recherche | À la première recherche : `git ls-files` dans un dépôt, sinon un parcours du disque (30 000 fichiers au plus, sans `node_modules`, `.git`, `dist`…) ; refait après un outil d'écriture |

Un fichier changé sur le disque se relit tout seul ; pendant des modifications, la bannière « Modifié sur le disque » laisse choisir. Relu parce que Claude vient de le modifier, il le dit dans le fil d'Ariane (« ◆ Rechargé : modifié par Claude »).

**Marques « modifié par Claude »** (`◆` sur le fichier et son onglet, `◇` sur ses dossiers) :

| Quoi | Comment |
|---|---|
| Posée | Après un Edit, Write, MultiEdit ou NotebookEdit réussi, sur le fichier de l'appel (`file_path`, `notebook_path`), sous-agents compris. Pas après Bash ni PowerShell, qui ne nomment pas de fichier : relecture seule. |
| Effacée | Au message suivant de la personne (tapé, ou par Remote Control). Une commande (`/files`…) ou un message envoyé par un plugin ne l'efface pas. |
| Gardée | État de session (`$.state`), chemins absolus, 200 au plus : elle suit un changement de dossier parcouru. |

---

## Architecture

```
files-board/
├── .claude-plugin/plugin.json   manifeste (nom, version, contrat de types)
├── .claude-plugin/types/        types du moteur, pour tsconfig.json
├── commands/files.md            /files-board:files, connue avant le démarrage du mod
├── hooks/
│   ├── hooks.json               déclare le module register.tsx
│   ├── register.tsx             le seul à parler au moteur : état, disque, presse-papiers, prompt, applications
│   ├── browser.tsx              la région interactive (élément Client) : dessin, clavier, souris, éditeur, menus
│   └── model.ts                 données pures : chemins, tri, recherche floue, colonnes, coloration, édition, menus
├── types/index.d.ts             contrat de l'état (`PluginState`) et des messages
├── tsconfig.json
└── tests/                       `claude plugin test` : le panneau, la région, le modèle
```

- **Deux côtés.** La région (`browser.tsx`) tourne dans le fil de dessin, sans `$`. Elle demande tout le reste au module des hooks par `surface.post` (événement `ui.message`), un envoi par image au plus.
- **Demandes numérotées.** Chaque demande porte un numéro ; la région renvoie celles qui ne sont pas accusées, le module ignore celles déjà faites (`seen`). Une recherche, un brouillon ou une fenêtre de lignes remplacent leur demande précédente encore en file.
- **Props bornées.** Les données de la région passent par ses props, bornées à 100 000 caractères : au-delà de 60 000 caractères sérialisés, un fichier est lu par fenêtres de lignes, en lecture seule ; l'arborescence envoyée est plafonnée à 1 200 lignes.
- **Molette.** La région ne reçoit pas la molette : le module la prend sur le panneau (`ui.scroll`) et la lui relaie.

---

## Développement

```bash
claude plugin validate plugins/files-board
```

```bash
claude plugin test plugins/files-board
```

- Lancer les commandes depuis un chemin court (`~`) : depuis un dossier au chemin trop long, Windows refuse le dossier courant.
- Les tests simulent le disque, le prompt et le presse-papiers (`world`). Le moteur de test rend `/w` en `C:\w` sous Windows : la simulation ramène les chemins à `/w`.
- Le temps de la région avance avec sa minuterie (`ui.advance` dans les tests), pas avec l'horloge réelle.
- Vérification de types : `tsc -p plugins/files-board` avec TypeScript 5.4 ou plus récent (le `tsconfig.json` autorise les imports `./model.ts`). Sans `tsc` installé, l'API `typescript.js` livrée avec VS Code fait l'affaire.

---

## Limites connues

- **Plein écran requis pour la souris.** Sur l'affichage principal du terminal, les clics n'atteignent pas la région ; le panneau le signale.
- **Le clavier après un clic.** La région reçoit les touches une fois cliquée : c'est le chemin sûr.
- **À vérifier dans un vrai terminal** (la 0.2.0 n'a été essayée que par `claude plugin test` et un chargement `claude -p`) :
  - la molette : elle dépend de l'événement `ui.scroll` du panneau, que le moteur ne promet pas quand le contenu tient exactement dans le cadre ; sinon, glisser la barre de défilement ou PageSuiv/PagePréc ;
  - le focus d'emblée : `/files` demande `$.ui.focus` sur la région, sans garantie que le moteur l'accepte ;
  - la largeur des symboles (`≡`, `⌕`, `⋮`, `▐`, `⚠`) dans Windows Terminal : une rangée décalée viendrait d'un écart entre la largeur comptée par le mod et celle du terminal.
- **Pas de sélection de texte** dans l'éditeur : copier tout le fichier passe par « Copier le contenu du fichier ».
- **Gros fichiers en lecture seule** (au-delà d'environ 60 000 caractères), par fenêtres de 600 lignes ; plus de 4 Mio : pas d'ouverture.
- **Pas d'aperçu des images ni des binaires** : un bouton les ouvre dans l'application par défaut.
- **Coloration du mod**, approximative, aux couleurs d'un thème sombre.
- **Aperçu Markdown par blocs** : il défile paragraphe par paragraphe ; les liens relatifs n'y sont pas cliquables.
- **Raccourcis du terminal.** Ctrl+Maj+Y suppose un terminal qui transmet Maj avec Ctrl ; certains terminaux gardent Ctrl+W ou Ctrl+S pour eux.
