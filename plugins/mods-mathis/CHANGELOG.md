# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième. L'historique commence avec le dépôt `mathis-plugins` (0.16.2) ; les versions d'avant n'ont pas de trace écrite.

---

## 0.16.6 — 2026-10-16

### Documentation
- Commandes de développement en chemins relatifs au dépôt (`plugins/<plugin>`), quel que soit l'emplacement du clone.

---

## 0.16.5 — 2026-10-16

### Changé
- **Licence MIT** déclarée ; README : la marketplace est publique.

---

## 0.16.4 — 2026-10-14

### Corrigé
- **`tabular` retiré** (adopté en 0.16.3) : l'app desktop embarque son propre Claude Code (2.1.295 sur le Mac le 14/10), qui refuse cette prop de `Text` et dessine alors à la place du mod. Les valeurs du pied reprennent leurs chiffres ordinaires.

---

## 0.16.3 — 2026-10-14

### Corrigé
- **Chrono et sous-agents** : depuis Claude Code 2.1.299, `turn.start` se déclenche aussi pour les tours des sous-agents ; le chrono de réponse repartait de zéro au lancement de chacun. Un tour de sous-agent (`agentId`) ne touche plus au chrono du fil principal.

### Modifié
- Chiffres de largeur fixe (`tabular`) pour les valeurs du pied, qui changent d'elles-mêmes (chrono, compte à rebours du cache).

---

## 0.16.2 — 2026-10-12

### Ajouté
- Entrée dans `mathis-plugins` : chrono de réponse, tokens/s, compte à rebours du cache de prompt, heure et boutons (Ultracode, Fichiers, Diff) dans le pied de la saisie ; sur desktop, les mesures dans le bandeau au-dessus de la saisie ; commande `/mods-mathis:start`.
