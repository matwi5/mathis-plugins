# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième. L'historique commence avec le dépôt `mathis-plugins` (0.16.2) ; les versions d'avant n'ont pas de trace écrite.

---

## 0.20.0 — 2026-10-24

### Ajouté
- **Option `model`** (`opus` par défaut, `sonnet` ou `haiku`, toujours en effort low) pour les boutons Réécrire et Effort auto, déclarée dans `userConfig` : choisie par `/setup:install` ou l'écran d'options de `claude plugin install`, puis dans `/config`. Demande de Mathis : choisir entre Haiku low, Sonnet low et Opus low à l'installation, avec les estimations mesurées le 22 et le 24/10/2026 (tableau dans le README).
- Mesure d'Effort auto avec les trois modèles (7 brouillons, 3 répétitions) : Opus 2,1 s et 0,03 $, 21 réponses lisibles sur 21 ; Sonnet 1,8 s et 0,02 $, 21 sur 21, d'accord avec Opus 18 fois sur 21 ; Haiku 3,5 s et 0,001 $, 18 sur 21 (il répond parfois au brouillon), d'accord 16 fois sur 18.

---

## 0.19.0 — 2026-10-22

### Ajouté
- **Bouton « Effort auto »** dans le pied du prompt, au terminal et sur desktop : Opus en effort low (`$.model.complete`) choisit le niveau d'effort du brouillon (low à max) avec le skill choix-effort adapté (`hooks/effort-system.ts`), puis le mod le demande par `/effort` avant l'envoi ; une notification donne le niveau demandé et sa raison. Comme un `/effort` tapé, le niveau devient l'effort par défaut des nouvelles sessions (sauf `max`, lu dans le code de Claude Code 2.1.304, à confirmer), et un changement en cours de discussion peut demander une confirmation et fait repayer le cache. Choix de Mathis, entre ce réglage et un effort limité au message (`turn.step`) : « Par /effort ». Un brouillon envoyé ou changé pendant le choix garde l'effort tel quel. Le bouton ne pose pas les questions du skill : il déduit du brouillon le contrôle voulu et l'enjeu, et suppose « autonome après cadrage » sans indice ; il ne lit pas la discussion. Les repères chiffrés de la consigne sont ceux d'Opus 5.5. Choix de Mathis : « Déduire du brouillon », « un bouton à part mais ne pas le nommer juste effort », « Brouillon seul ».
- Essai réel sur 7 brouillons : niveaux de low à xhigh, 1,5 à 6,4 s et environ 0,03 $ par choix.

### Changé
- Réécrire et Effort auto partagent la lecture du brouillon et la garde contre le double clic.

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
