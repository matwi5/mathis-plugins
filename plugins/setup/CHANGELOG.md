# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième.

---

## 0.2.0 — 2026-10-24

### Ajouté
- **Modèle de `session-tools`** : `/setup:install` demande le modèle des boutons Réécrire et Effort auto (Opus, Sonnet ou Haiku, en effort low), chaque option décrite par ses estimations mesurées (qualité ou fiabilité, temps, coût, dans le catalogue), puis le règle par `claude plugin configure` et le vérifie.

---

## 0.1.2 — 2026-10-22

### Documentation
- Catalogue : `session-tools` a aussi un bouton Effort auto.

---

## 0.1.1 — 2026-10-22

### Documentation
- Le plugin `mods-mathis` s'appelle désormais `session-tools` : catalogue, choix des panneaux et commande `/session-tools:start`.

---

## 0.1.0 — 2026-10-16

### Ajouté
- **`/setup:install`** : choix des plugins par groupes (socle, panneaux, suivi Asana, règles), dépendances et prérequis (version de Claude Code, git, gh, Node.js, Python, connecteur Asana), installation, doublon de `mattpocock-skills` coupé, réglages d'asana-board (bloc « Suivi Asana » à partir de `get_me` et `get_projects`), du partage des usages de stats-board et de la barre d'état, et bloc de règles entre marqueurs dans le `CLAUDE.md` global ou du projet. Rien ne s'écrit avant l'accord sur le plan ; relançable.
