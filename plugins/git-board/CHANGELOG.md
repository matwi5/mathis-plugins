# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième. Chaque version précédente est sauvegardée dans `~/.claude/mods-archives/git-board-<version>`.

---

## 0.4.3 — 2026-10-17

### Corrigé
- **Fausse « CI échouée »** : une exécution annulée puis remplacée sur le même commit (`concurrency: cancel-in-progress`, deux déclenchements rapprochés) comptait comme un échec, alors que l'exécution qui l'a remplacée avait réussi. Un check annulé ne compte plus quand un homonyme (même workflow, même nom) ne l'est pas, avec ou sans PR ; un check annulé seul reste un échec.

---

## 0.4.2 — 2026-10-16

### Documentation
- Commandes de développement en chemins relatifs au dépôt (`plugins/<plugin>`), quel que soit l'emplacement du clone.

---

## 0.4.1 — 2026-10-16

### Changé
- **Couleur du mod renommée** : la clé de palette de cette teinte (`#E8913A`) s'appelle désormais `tangerine`, sans changement à l'écran.
- **Licence MIT** déclarée ; README : la marketplace est publique.

---

## 0.4.0 — 2026-10-16

### Ajouté
- **Suivi de la CI après un push** : après un `git push` de Claude ou un `/project:push` lancé du panneau, les checks du commit poussé sont relus toutes les 25 s jusqu'à ce qu'ils soient tous finis (plafond de 20 min). Avec une PR par `gh pr view`, sans PR par `gh run list --commit`. Le bandeau et le panneau disent « en attente » (rien encore lancé, distinct de « aucun check »), « en cours 1/3 », « réussie » ou « échouée » avec le nom du premier check en échec ; un toast à la fin. Arrêt au changement de branche ou de dossier ; sans `gh` ou sans connexion, rien ne change.
- **`/project:push` en suggestion grisée** : à la fin d'un tour principal, avec des commits à pousser, un arbre propre et aucune commande `/project` en file ou en cours, la commande est proposée dans le prompt (Tab pour la prendre).

---

## 0.3.2 — 2026-10-14

### Corrigé
- **`weight` et `tabular` retirés** (adoptés en 0.3.1) : l'app desktop embarque son propre Claude Code (2.1.295 sur le Mac le 14/10), qui les refuse (« Text prop "tabular" is not allowed ») et dessine alors à la place du board, qui disparaît. Le gras repasse par `bold`, au même rendu. Le correctif des tours de sous-agents de la 0.3.1 reste.

---

## 0.3.1 — 2026-10-14

### Corrigé
- **Une commande `/project` en file n'est plus close à tort par le tour en cours.** Depuis Claude Code 2.1.299, `turn.start` se déclenche aussi pour les sous-agents : celui d'un sous-agent du tour en cours faisait démarrer la commande, que la fin de ce tour marquait ensuite comme terminée.

### Modifié
- **Gras au nouveau format** : le gras passe par `weight: 'semibold'`, et non plus par `bold`, déprécié depuis Claude Code 2.1.299. Le rendu ne change pas (`bold` y était lu comme `semibold`).

---

## 0.3.0 — 2026-10-08

### Ajouté
- **`/project:version` avant le push** : quand il y a quelque chose à pousser, le tiroir Push suggère de monter d'abord le numéro de version et le CHANGELOG, avec un bouton « ▶ D'abord · /project:version ». La commande part comme les autres (dès que Claude est libre) et n'est finie qu'avec le tour de Claude, faute de repère dans le dépôt. Rien n'est suggéré quand il n'y a rien à pousser.

---

## 0.2.5 — 2026-10-08

### Corrigé
- **Ancienne PR fusionnée reprise par une branche réutilisée** : `gh pr view <branche>` rend la dernière PR de la branche, même fusionnée. Après une fusion, les nouveaux commits poussés sur la même branche (`dev`) affichaient l'ancienne PR et une route PR → Checks → Fusion toute faite. Le panneau lit maintenant la tête de la PR (`headRefOid`) : une PR fusionnée ou fermée dont la tête n'est plus HEAD est ignorée, la route repart à « PR à ouvrir » et l'étape suggérée redevient la PR.

---

## 0.2.4 — 2026-10-06

### Corrigé
- **Route de livraison** : dès qu'une étape n'est pas faite, les suivantes sont « à venir ». Un commit à pousser n'affiche plus PR, Checks et Fusion comme faits ; seul le numéro d'une PR encore ouverte reste affiché.
- **Commande `/project` bloquée « en cours »** : une commande lancée du panneau est finie dès que le dépôt relu montre son effet (commit : HEAD a bougé ; sync : un fetch depuis le lancement et plus rien à récupérer ; push : plus rien à pousser ; PR : une PR existe pour la branche), sans attendre la fin du tour de Claude, qui peut enchaîner sur autre chose. Message « … : fait d'après le dépôt. ». La fin du tour reste le repli.

---

## 0.2.3 — 2026-10-05

### Modifié
- **Étiquette d'outil refaite** : une barre verticale « ▍ » et le nom du mod en gras, de la couleur du mod (mandarine), dans une colonne de même largeur que celles des autres mods. La barre continue sur la ligne 2. Remplace le bloc de couleur plein.
- **Plus de trait horizontal** entre les bandeaux : le desktop ne bornait pas sa hauteur et un bout de trait passait à la ligne. Les bandeaux se distinguent par la barre et le nom.

---

## 0.2.2 — 2026-10-05

### Modifié
- **Étiquette « GIT »** en tête du bandeau, foncée sur mandarine, de la même largeur que celles de Flow et d'Asana pour que les bandeaux s'alignent. La ligne 2 s'aligne sous le contenu.
- **Trait de séparation sans « … »** : le trait passe à la ligne au lieu d'être tronqué, et sa boîte d'une rangée en cache le surplus. La troncature ajoutait « … » en bout de ligne sur le desktop.

---

## 0.2.1 — 2026-10-05

### Modifié
- **Trait de séparation** : empilé sous le bandeau d'un autre mod, le bandeau Git en est séparé par une ligne « ─ » atténuée.

---

## 0.2.0 — 2026-10-05

### Ajouté
- **Bandeau au-dessus du prompt**, dans un dépôt git : branche, ↑/↓, fichiers, et selon la largeur total `+/−`, PR et âge du fetch. Une deuxième ligne montre l'opération en cours, la commande `/project` en file ou la bascule. Il s'empile avec les bandeaux des autres mods sans les effacer.
- **Masquer le bandeau** : « x » ou `/git hide`, pour la session ; la ligne d'état prend le relais. `/git show` le réaffiche.
- **`/git-board:git`** (`commands/git.md`), connue dès le premier message, y compris sur le desktop. `/git` sort du menu mais reste utilisable tapée en entier.
- **Arguments d'onglet** : `/git changes`, `/git branches`, `/git history`.
- **Retour au dossier de la session** : bouton « ↩ session » dans l'en-tête quand un autre dossier est suivi.
- **Données dès le démarrage** : lecture locale (sans fetch), puis la PR en arrière-plan.
- **Toasts** pour le retour des actions (bascule, création de branche, lancement d'une commande, erreurs), et un message de fin quand une commande `/project` lancée du panneau a fini son tour.
- **Visuels SVG** sur le desktop, VS Code et le mobile : jauge ↑/↓, route de livraison Commit → Push → PR → Checks → Fusion, barre de diff, indicateurs d'activité. Repli en glyphes et en blocs sur le terminal.

### Modifié
- **Panneau refait au niveau de flow-board** : carte d'en-tête avec pastille de la branche et pastilles d'état par gravité, zone d'activité à un emplacement fixe, un seul bouton mis en avant (l'étape suggérée), tiroirs plus courts, onglets comptés.
- **Listes compactes** : une ligne par fichier, branche ou commit (plus de carte bordée par branche). Fichiers groupés : En conflit, Indexés, Modifiés, Nouveaux. Listes plafonnées avec « ▸ tout voir (N) ».
- **Âges relatifs** : « fetch il y a 4 min » au lieu d'une heure. Un fetch en échec est visible dans l'en-tête et dans le bandeau.
- **Commits pas encore poussés** comptés sur tout HEAD (jusqu'à 500), et plus seulement sur les 25 commits affichés.
- **La ligne d'état** ne sert plus que de relais quand le bandeau est masqué.
- **Mobile** : le panneau dit ce qui n'y est pas disponible (champs et listes de choix) au lieu de le cacher.
- Code découpé : `register.tsx` (moteur), `view.tsx` (dessin), `model.ts` (données pures), `svg.ts` (dessins). Ajout de `tsconfig.json` et des types du moteur.
- Rafraîchissement : redessin toutes les 5 s pendant une activité, toutes les 30 s au repos ; coup d'œil toujours toutes les 10 s.
- **En-tête court** : nom du dépôt et méta sur une ligne, PR sur une ligne, ↑/↓ dits une seule fois (jauge SVG sur le desktop, VS Code et le mobile, pastilles sur le terminal), pastille de branche tronquée, couleur au repos violette (marque du mod).
- **Route de livraison** : chaque étape garde son état (une PR ouverte reste « faite » pendant qu'un nouveau commit attend) ; sur le terminal étroit, formes courtes (« Com. », « CI », « Fus. ») plutôt que des libellés coupés.
- **Fraîcheur** : l'âge du fetch s'affiche dès le démarrage, d'après la date de `FETCH_HEAD`, ou « fetch jamais ».
- **Barre d'actions** sans comptes ; l'étape suggérée n'est plus mise en avant quand son tiroir est ouvert. Le « ✕ » d'un tiroir ne ferme que le tiroir.
- **Fin d'une commande `/project`** : « tour terminé » ou « interrompue », sans « ✓ ».
- **Glyphes et couleurs** alignés partout : conflit « ✖ » rouge, nouveau « + » sarcelle, « non publiée » ; Pull et Push en cyan (distant) ; commande en file « ▶ » dans le bandeau, spinner une fois lancée ; « · » entre les fichiers et le total des lignes.
- Les branches seulement distantes ont leur propre « ▸ tout voir (N) ».

### Corrigé
- L'enregistrement de `/git` au démarrage ne bloque plus la minuterie ni la première lecture s'il est refusé.
- Le mobile ne recevait pas la mention des champs absents : la table d'éléments du moteur contient des fragments vides pour les éléments qu'une surface n'a pas.
- Une réponse de `gh` sans numéro ni adresse de PR ne fait plus refuser tout le panneau : elle est relevée comme une erreur, le dépôt reste lu.
- En HEAD détachée, les tiroirs Pull, Push et PR disent de basculer sur une branche au lieu de messages contradictoires (« pas encore publiée », « branche par défaut »).

---

## 0.1.0

Première version : panneau `/git` (modifications, branches, historique, pull request), commit, pull, push et PR via les commandes du plugin `project`, ligne d'état.
