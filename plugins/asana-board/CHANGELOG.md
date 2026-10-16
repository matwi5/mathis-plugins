# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième. Chaque version précédente est sauvegardée dans `~/.claude/mods-archives/asana-board-<version>`.

---

## 0.7.2 — 2026-10-16

### Documentation
- Commandes de développement en chemins relatifs au dépôt (`plugins/<plugin>`), quel que soit l'emplacement du clone.

---

## 0.7.1 — 2026-10-16

### Modifié
- **Skill `suivi-asana` : spec ou plan long, description courte et changements en commentaires** (rétro d'un parcours du 16/10/2026) : `update_tasks` sur `notes` réécrit toute la description, et deux sessions qui l'écrivent s'écrasent. La description d'une spec garde les lignes du format et pointe, dans « Origine », la copie locale qui fait foi ; les changements suivants partent en commentaires datés (« mise à jour du porteur » quand ils viennent de lui) ; seule la ligne « Statut : » se réécrit.

---

## 0.7.0 — 2026-10-16

### Changé
- **Couleur renommée et licence** : la clé de palette de cette teinte (`#E8913A`) s'appelle désormais `tangerine`, sans changement à l'écran ; licence MIT déclarée.
- **Titulaire du compte lu par `get_me`** : le panneau n'a plus de nom écrit en dur. Il lit le titulaire du compte Asana une fois par session ; sans réponse, aucune tâche n'est « pour Toi » et le bouton propose « M'assigner ».
- **Skill `suivi-asana` sans projet imposé** : le projet de suivi, l'espace de travail et le plan viennent du bloc « Suivi Asana » du `CLAUDE.md` global, écrit par `/setup:install`. l'ancien fichier de structure du projet devient `references/conventions.md` (conventions par défaut), qu'un fichier de conventions de l'utilisateur complète.

### Tests
- Exemples neutres : noms de section et GID factices ; `get_me` simulé, réussi et en échec.

---

## 0.6.1 — 2026-10-16

### Corrigé
- **« Lecture impossible » sur une grosse section** : au-delà d'un seuil, le moteur ne rend plus toujours l'encart `<persisted-output>` mais un message « Error: result (74 523 characters) exceeds maximum allowed tokens. Output has been saved to <chemin>. ». Le panneau ne reconnaissait que l'encart et affichait « réponse illisible » ; il relit maintenant le fichier dans les deux formats, même si la réponse est marquée en erreur.

---

## 0.6.0 — 2026-10-16

### Ajouté
- **Écritures de Claude lisibles dans la conversation** : la ligne d'un appel `…__update_tasks`, `…__create_tasks`, `…__add_comment` ou `…__delete_task` montrait des GID et du JSON. Elle dit maintenant l'écriture avec le nom des tâches, pris dans celles déjà lues par le panneau (aucune relecture) : « Asana · coche « Corriger le bandeau » », « Asana · statut « en cours » sur « X » », « Asana · commentaire sur « X » », « Asana · crée « Y » », « Asana · supprime « X » ». Un GID inconnu s'affiche tel quel ; plusieurs tâches : trois noms au plus, puis « +n ». La ligne du moteur reste pour un appel en erreur ou interrompu et pour une entrée non reconnue ; le résultat de l'appel n'est pas touché.

---

## 0.5.10 — 2026-10-15

### Corrigé
- **Skill `suivi-asana` : sous-tâches hors du projet** : une sous-tâche se crée avec `parent` seul, sans `project_id`, `section_id` ni `default_project` dans le même appel. Avec un projet, Asana en faisait aussi une tâche du projet, rangée dans sa première section. Le skill fait relire `memberships` après la création et retirer du projet une sous-tâche qui y serait entrée (`remove_projects`). Le panneau créait déjà ses sous-tâches sans projet.

---

## 0.5.9 — 2026-10-14

### Corrigé
- **Cocher met la ligne « Statut : » à « fait »** : la coche du panneau n'écrivait que `completed`, et la tâche cochée gardait par exemple « Statut : en cours ». La ligne entière devient maintenant « Statut : fait » dans la même écriture (sans la parenthèse d'attente) ; décocher la remet à « à faire », abandonner l'écrit « abandonnée ». Une description mise en forme dans Asana n'est pas réécrite : la tâche est cochée quand même, et le toast le dit.
- **Skill `suivi-asana` aligné** : « fait » et « abandonnée » deviennent les valeurs d'une tâche cochée, écrites dans le même `update_tasks` que la coche.

---

## 0.5.8 — 2026-10-14

### Corrigé
- **Section longue de nouveau lisible** : au-delà d'un seuil, Claude Code range la réponse d'un outil dans un fichier et rend à la place un encart `<persisted-output>` avec son chemin, y compris à `$.mcp.call`. Une section de 22 tâches (55 Ko) affichait alors « Lecture impossible : JSON Parse error: Unrecognized token '<' ». Le panneau relit maintenant la réponse dans ce fichier.
- **Erreur de lecture plus parlante** : une réponse qui n'est pas du JSON est signalée avec son début, et non plus par le seul message de l'analyseur.

---

## 0.5.7 — 2026-10-14

### Corrigé
- **Gras de nouveau par `bold`** : `weight`, adopté en 0.5.6, est refusé par le Claude Code de l'app desktop (2.1.295 sur le Mac le 14/10), qui dessinait alors à la place du board. Le rendu est le même.

---

## 0.5.6 — 2026-10-14

### Modifié
- **Gras au nouveau format** : le gras passe par `weight: 'semibold'`, et non plus par `bold`, déprécié depuis Claude Code 2.1.299. Le rendu ne change pas (`bold` y était lu comme `semibold`).

---

## 0.5.5 — 2026-10-14

### Modifié
- **Skill `suivi-asana` : tickets au découpage, pas avant.** Quand la demande annonce un travail qui passera par un grilling, un questionnaire ou un cadrage, le skill ne propose plus de créer ses tickets : il note les demandes dans le journal de `ETAT_DU_PROJET.md` et propose le parcours grilling → `/to-spec` → `/to-tickets`. Restent permis le ticket découvert pendant l'implémentation et la tâche rapide. Même règle ajoutée à la règle 7 du `CLAUDE.md` global.

---

## 0.5.4 — 2026-10-12

### Modifié
- **Description du skill `suivi-asana` alignée** sur l'exception de la 0.5.3 : le suivi des tickets dont Mathis a lancé l'implémentation (statut, commentaire de résultat, cochage) s'écrit sans demander.

---

## 0.5.3 — 2026-10-12

### Modifié
- **Skill `suivi-asana` : suivi d'implémentation sans validation.** Pendant l'implémentation de tickets que Mathis a lancée, leur suivi (ligne « Statut : » `en cours` ou `en attente (<qui>)`, commentaire de résultat, cochage à la fin) s'écrit sans passer par l'étape 4. Toute autre écriture sur ces tickets (contenu, périmètre, nouveau ticket découvert en route, suppression) reste soumise à l'accord. Même exception dans la règle 7 du `CLAUDE.md` global.

---

## 0.5.2 — 2026-10-12

### Modifié
- **Skill `suivi-asana` : plus de `TODO.md`.** L'étape 1 ne lit plus de `TODO.md` et ne parle plus de son archive : tout le travail d'un projet passe par un ticket Asana (règle 7 du `CLAUDE.md` global, réécrite le même jour), `ETAT_DU_PROJET.md` fait foi sur l'état et garde le journal.

---

## 0.5.1 — 2026-10-12

### Corrigé
- **Test « prompt indisponible »** : le faux hook `prompt.fill` du test rendait `{ value: { isFilled } }` ; le kit de test attend `{ isFilled }` directement (seuls les hooks qui remplacent une opération comme `fs.read` ou `ui.open` rendent `{ value }`). Le moteur sautait donc le hook, et le cas « prompt indisponible » n'était jamais exercé. Le code du plugin (`fillPrompt`) n'est pas modifié.

---

## 0.5.0 — 2026-10-12

### Retiré
- **Priorité** : le projet de suivi est repassé au plan gratuit, qui refuse les champs personnalisés (`payment_required`). Le formulaire « Nouvelle tâche » n'a plus de choix de priorité et la création n'envoie plus `custom_fields` (un seul appel `create_tasks`, sans le second essai). Le skill `suivi-asana` ne pose plus de priorité, ne la vérifie plus et l'a retirée de son compte rendu.

### Modifié
- **Skill `suivi-asana`** : le fichier de référence du projet de suivi (aujourd'hui `references/conventions.md`) décrit les limites du plan gratuit (projet verrouillé dans l'interface web, lisible par l'API, le panneau et l'application mobile). La recherche de doublons passe par `get_tasks` + `get_task`, `search_tasks` étant refusé ; les dépendances Asana ne se posent plus, une attente s'écrit dans « Contexte » ou « Fini quand ».

---

## 0.4.0 — 2026-10-12

### Modifié
- **Skill `suivi-asana` : accord avant écriture.** La lecture d'Asana reste libre, mais aucune écriture (tâche, sous-tâche, section, modification, cochage, déplacement, commentaire, suppression) ne part sans l'accord de Mathis. Nouvelle étape 4 « Faire valider » : la liste complète des changements, soumise en une question (tout écrire, choisir, ne rien écrire) ; les changements refusés vont sous « À reporter dans Asana » du journal du projet. Le déclenchement automatique prépare et propose au lieu d'écrire, y compris après `/to-spec` ou `/to-tickets` et à la vérification de fin de session. Étapes suivantes renumérotées (5 à 8).

---

## 0.3.0 — 2026-10-12

### Ajouté
- **Skill `suivi-asana`** dans `skills/suivi-asana/`, repris de la version du 08/10/2026 (sans correspondance projet → section : la section et la tâche mère viennent du `CLAUDE.md` du projet). Seuls changements : noms d'outils de Claude Code (`ToolSearch`, `AskUserQuestion`) à la place de ceux de claude.ai.

---

## 0.2.4 — 2026-10-05

### Modifié
- **Étiquette d'outil refaite** : une barre verticale « ▍ » et le nom du mod en gras, de la couleur du mod (rose), dans une colonne de même largeur que celles des autres mods. La barre continue sur la ligne 2. Remplace le bloc de couleur plein.
- **Plus de trait horizontal** entre les bandeaux : le desktop ne bornait pas sa hauteur et un bout de trait passait à la ligne. Les bandeaux se distinguent par la barre et le nom.

---

## 0.2.3 — 2026-10-05

### Modifié
- **Étiquette « ASANA »** en tête du bandeau, foncée sur rose, à la place du « ◆ ». Elle ne part qu'en dernier sur un bandeau très étroit.
- **Plus d'échéance dans le bandeau** : la ligne 2 ne montre que la lecture en cours ou l'erreur d'une relecture demandée.
- **Place** : quand la ligne 1 ne tient pas, le nom de section part avant les comptes en toutes lettres.
- **Trait de séparation sans « … »** : le trait passe à la ligne au lieu d'être tronqué, et sa boîte d'une rangée en cache le surplus. La troncature ajoutait « … » en bout de ligne sur le desktop.

---

## 0.2.2 — 2026-10-05

### Modifié
- **Bandeau plus sobre** : les retards ne sont plus détaillés en ligne 2, seulement comptés en ligne 1 (« ⚠ N en retard »). La ligne 2 montre la prochaine échéance à venir.
- **Trait de séparation** : empilé sous le bandeau d'un autre mod, le bandeau Asana en est séparé par une ligne « ─ » atténuée.

---

## 0.2.1 — 2026-10-05

### Corrigé
- **Section introuvable quand les GID ne sont plus dans le `CLAUDE.md`** : le mod lit aussi `docs/agents/issue-tracker.md`, et accepte la forme en tableau (`| Section | « Nom », GID `…` |`) en plus de la forme dans le texte. Le projet est pris dans le même fichier que la section, sinon dans l'autre. Le message d'erreur nomme les deux fichiers et les deux formes.

---

## 0.2.0 — 2026-10-05

### Ajouté
- **Bandeau au-dessus du prompt** : section, répartition, comptes par statut, retards, « pour toi » ; en ligne 2, la lecture en cours ou la prochaine échéance. Il s'empile sous les bandeaux des autres mods sans les effacer, et rend la main pendant un sondage. `x` ou `/asana hide` le masque (la ligne d'état prend le relais), `/asana show` le rend.
- **`/asana-board:asana`**, déclarée par `commands/asana.md` : disponible dès le premier message, même sur le desktop. Le mod y répond lui-même. `/asana` sort du menu, mais reste utilisable tapée en entier.
- **Lecture au démarrage**, en arrière-plan, quand le `CLAUDE.md` nomme une section Asana. Connecteur absent : nouveaux essais à 5 s, 15 s et 45 s. Une lecture de fond qui échoue reste muette.
- `/asana tous|toi|claude` ouvre le panneau sur un onglet.
- Toasts pour le retour des actions, suppression comprise. Protection contre le double appui pendant une écriture.

### Modifié
- **Panneau refait sur le modèle de flow-board** : carte d'en-tête (pastille, anneau de répartition en SVG ou barre en blocs, âge de la lecture, `↻ Relire`), filtre en onglets avec comptes, zone d'état fixe, groupes titrés glyphe et mot coloré, tâches en lignes compactes qui se déplient en carte, listes plafonnées à 12 avec « ▸ tout voir (N) », états vides explicites, erreur dans une carte avec « ↻ Réessayer ».
- Dans un groupe, les tâches sont triées par échéance, puis par titre.
- Formulaire de création regroupé, listes de choix étiquetées, focus sur le titre ; « Annuler » vide le brouillon.
- « Oui, supprimer » n'est plus l'action principale.
- Sur le mobile, le panneau dit ce qui n'y est pas disponible (champs et listes de choix).
- Redessin toutes les 5 s pendant une lecture ou une écriture, toutes les 30 s au repos ; âges relatifs (« il y a 4 min »).
- Code découpé en `register.tsx` (tout `$`), `view.tsx`, `model.ts` et `svg.ts`.

### Corrigé
- La liste de statut d'une tâche « prêt » ou sans statut recevait une valeur indéfinie.
- Un enregistrement de `/asana` refusé ne bloque plus le reste du démarrage.
- Relecture avant livraison :
  - **Bandeau** : la ligne 1 tient dans sa largeur à tous les paliers (comptes en glyphes jusque vers 120 colonnes, éléments facultatifs retirés dans un ordre fixe). Les tâches sans statut y sont comptées, comme dans la ligne d'état. Ordre des comptes : à trancher, en cours, à faire, sans statut, puis en attente. Une échéance passée s'y lit « ⚠ En retard », plus « Prochaine échéance ». Sous 24 colonnes, il ne se dit plus plus large que sa place.
  - **Lectures** : jamais deux en même temps (un `/asana` ou `↻` pendant la lecture de fond l'attend). Un `/asana` fait avant l'arrivée du connecteur n'arrête plus les nouveaux essais. Une commande qui dépasse le temps du mod, ou qui échoue, répond elle-même au lieu de laisser le modèle dire que le mod n'est pas chargé. Une commande lancée sans `args` par un autre plugin ne lève plus d'erreur.
  - **Rechargement à chaud** : une écriture ou une lecture coupée en route ne laisse plus de spinner figé ni de tâche bloquée.
  - **Panneau** : carte d'accueil, et non « 0 tâche ouverte », tant que rien n'est lu. « Lue » en gris au-delà de 10 min, « À jour » avant. Un seul spinner pendant une lecture, et « ↻ Relire » devient « Lecture… ». « ▾ Replier le formulaire » quand il est ouvert. Personne sur chaque ligne seulement sous « Tous ». Un seul rappel du filtre. Avis mobile en une ligne courte.
  - **Toasts** : erreur courte, détail sous la tâche dépliée ; un second appui pendant une écriture le dit ; repli de « ▶ Travailler dessus » avec la demande à taper.

---

## 0.1.0

- Panneau `/asana` : tâches non terminées de la section, rangées par statut, avec création, coche, statut, assignation, commentaire, modification, abandon et suppression.
