# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième. Chaque version précédente est sauvegardée dans `~/.claude/mods-archives/files-board-<version>`.

---

## 0.3.3 — 2026-10-22

### Documentation
- Le bouton « Fichiers » vient du mod `session-tools` (anciennement `mods-mathis`).

---

## 0.3.2 — 2026-10-16

### Documentation
- Commandes de développement en chemins relatifs au dépôt (`plugins/<plugin>`), quel que soit l'emplacement du clone.

---

## 0.3.1 — 2026-10-16

### Changé
- **Licence MIT** déclarée ; README : la marketplace est publique.

---

## 0.3.0 — 2026-10-16

### Ajouté
- **Fichiers modifiés par Claude marqués** : après un Edit, un Write, un MultiEdit ou un NotebookEdit réussi, le fichier porte `◆` (magenta) dans l'arborescence et sur son onglet, et ses dossiers parents `◇`, pour le trouver même replié. Les marques s'effacent au message suivant de la personne (tapé ou par Remote Control) ; une commande comme `/files` ou un message d'un plugin les laisse. Après Bash ou PowerShell, tout se relit comme avant, sans marque : ces outils ne nomment pas de fichier.
- **Rechargement dit** : un onglet ouvert relu parce que Claude vient de le modifier affiche « ◆ Rechargé : modifié par Claude » dans le fil d'Ariane, au lieu d'être rechargé en silence ; ouvert après coup, « ◆ Modifié par Claude ».

---

## 0.2.2 — 2026-10-14

### Corrigé
- **Gras de nouveau par `bold`** : `weight`, adopté en 0.2.1, est refusé par le Claude Code de l'app desktop (2.1.295 sur le Mac le 14/10), qui dessinait alors à la place du board. Le rendu est le même.

---

## 0.2.1 — 2026-10-14

### Modifié
- **Gras au nouveau format** : le gras passe par `weight: 'semibold'`, et non plus par `bold`, déprécié depuis Claude Code 2.1.299. Le rendu ne change pas (`bold` y était lu comme `semibold`).

---

## 0.2.0 — 2026-10-07

### Ajouté
- **`/files toggle`** : ouvre le panneau s'il est fermé, le ferme sinon. Lancée par un autre plugin, la commande ne laisse ni ligne dans la conversation ni texte pour le modèle : c'est ce qu'utilise le bouton « Fichiers » du pied du prompt (mods-mathis 0.13.0).

---

## 0.1.0 — 2026-10-07

### Ajouté
- **Navigateur de fichiers** pour Claude Code CLI (`/files`, `/files-board:files`), à la manière de celui de l'app desktop, réservé au terminal.
- **Arborescence** triée comme le desktop (dossiers et fichiers mêlés, sans casse), dépliage à la souris et au clavier, largeur réglable en glissant le séparateur.
- **Recherche de fichiers** floue (`git ls-files` ou parcours du disque), avec le message « Certaines entrées peuvent ne pas être affichées. Continuez à saisir pour affiner. ».
- **Onglets** avec onglets d'aperçu, épinglage (double clic, modification, « Garder ouvert »), fermeture par `×` ou clic du milieu, confirmation pour un onglet modifié.
- **Éditeur** : coloration syntaxique, curseur, indentation détectée, annulation, enregistrement automatique ou Ctrl+S, brouillons gardés, fins de ligne CRLF préservées, recherche dans le fichier (Ctrl+F), bannière quand le fichier change sur le disque.
- **Markdown** rendu par défaut, `</>` pour le source.
- **Menus contextuels** du desktop : Joindre comme contexte (`@chemin` dans le prompt), Copier (chemin absolu, relatif, nom), Ouvrir dans, Afficher dans l'Explorateur, Copier le contenu, Afficher dans l'arborescence, Rechercher dans le fichier, Recharger, Garder ouvert, Fermer.
- **Menu ⋮** avec toutes les options du desktop, gardées d'une session à l'autre : arborescence (Ctrl+Maj+Y), onglets d'aperçu, enregistrement automatique, Tab indente, retour à la ligne, repères d'indentation, afficher les espaces, défilement au-delà de la fin, taille de tabulation (2, 4, 8).
- **Gros fichiers** en lecture seule par fenêtres de lignes ; binaires ouverts dans l'application par défaut.
