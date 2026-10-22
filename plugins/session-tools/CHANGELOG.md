# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième. L'historique commence avec le dépôt `mathis-plugins` (0.16.2) ; les versions d'avant n'ont pas de trace écrite.

---

## 0.18.0 — 2026-10-22

### Changé
- **Renommé `mods-mathis` → `session-tools`**, un nom qui dit ce qu'il fait (mesures de la session et boutons d'action autour du champ de saisie). La commande devient `/session-tools:start`. Les états gardés par l'hôte (Ultracode, chrono) repartent à zéro une fois. Une installation existante de `mods-mathis` est à désinstaller (`claude plugin uninstall mods-mathis@mathis-plugins`), sinon les deux tournent ensemble et doublent boutons et chrono. Sur les postes de Mathis, `scripts/sync.py` (privé) le fait seul. Choix de Mathis : « session-tools ».

---

## 0.17.0 — 2026-10-22

### Ajouté
- **Bouton « Réécrire »** dans le pied du prompt, au terminal et sur desktop : le brouillon du champ de saisie (`$.prompt.read`) est réécrit en prompt par Opus en effort low (`$.model.complete`, sans outils ni historique, jusqu'à 4000 tokens de réponse), puis remplace le brouillon (`$.prompt.fill`) sans être envoyé. La consigne (`hooks/rewrite-system.ts`) est le skill prompt-architect adapté : ni entretien ni fichier, la réponse est le prompt seul, rien d'inventé de ce que l'agent de la session peut trouver. Le brouillon est relu juste avant d'écrire : modifié pendant la réécriture, il est laissé tel quel. Un champ vide ou une réponse vide ne touchent à rien, un double clic ne lance qu'un appel.
- **Choix du modèle** : banc d'essai sur 7 brouillons réels, notés à l'aveugle par des juges Opus (qualité, puis temps, puis coût). Opus low 8,1/10 et 7 inventions relevées, Sonnet low 7,2 (20), Sonnet medium 6,7 (19), Haiku low 5,1 (41), Haiku medium 5,1 (36). Opus medium a la même qualité qu'Opus low mais met deux fois plus de temps (11,6 s contre 5,9 s). Choix de Mathis : « Toujours opus low ».

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
