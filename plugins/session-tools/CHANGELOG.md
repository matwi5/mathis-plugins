# Historique des versions

Les versions suivent [SemVer](https://semver.org/lang/fr/) : un correctif monte le dernier chiffre, une fonctionnalité le deuxième. L'historique commence avec le dépôt `mathis-plugins` (0.16.2) ; les versions d'avant n'ont pas de trace écrite.

---

## 0.23.0 — 2026-10-28

### Changé
- **Réécrire n'ajoute plus ce que la session fixe déjà.** La consigne (`hooks/rewrite-system.ts`) ne met plus dans le prompt de règle d'arrêt, de compte rendu, de fichier de suivi, de délégation à des sous-agents ni de contrôle générique : la consigne de Claude Code et les CLAUDE.md les portent déjà, et deux de ces blocs les contredisaient (« arrête-toi seulement si… », qui écartait les questions et accords que fixent les règles ; un ordre de compte rendu différent). Elle se limite à la demande : la rendre claire, sans rien perdre ni inventer, avec son état final, ses exclusions et la forme du livrable. Demande de Mathis : « Si c'est deja dans le claude.md alors il faut retirer les choses inutiles/en double dans la reecriture ».
- **Une commande slash en tête du brouillon reste au début, inchangée, par le code** : seul le texte qui la suit part au modèle (dans une balise `<commande>`), puis la commande est remise devant sa réponse, sans doublon si le modèle l'a recopiée. Une commande seule ne lance pas le modèle (notification) ; un chemin comme `/Users/x` n'est pas une commande. Une réponse à une question de l'agent (« ok pour a », « Q3 : b ») n'est que corrigée, sans squelette. Pour que Réécrire marche avec les skills de flow-board et de mattpocock-skills, sans en dépendre.
- **Une phrase ambiguë ne se tranche pas** : la réécriture la reprend ou nomme ses lectures possibles, sans en choisir une, et ne la change jamais en action plus forte, surtout une suppression (« on ne les garde pas ici » devenait « supprime-les »).
- **Banc d'essai** sur 16 brouillons (les 7 de la 0.17.0 et 9 de parcours flow-board et mattpocock), notés à l'aveugle par Opus face au brouillon accompagné des règles de la session : note globale 8,0 contre 4,5 pour la consigne d'avant, préférée 31 fois sur 32 ; 2 inventions contre 70, aucune contradiction avec les règles contre 67 ; 38 mots médians contre 156 ; 0,066 $ par réécriture à froid contre 0,103 $. Ces chiffres suivent la règle sur les phrases ambiguës, ajoutée après une première série à cause de deux de ses brouillons, puis six brouillons notés de nouveau ; la première série, avant toute retouche, donnait déjà 7,9 contre 4,5, préférée 29 fois sur 32, 6 inventions contre 69. Un appel par brouillon, juges Opus.
- Retirés aussi : les restes de l'entretien du skill d'origine (lignes « Salve », mode binôme, phrases à dire à l'utilisateur), le gabarit de relecture de code (qui ajoutait « problèmes bloquants seulement »), les modules Actions, Délégation et Suivi (Actions devient « Périmètre d'écriture », pris du brouillon seul). Exemples refaits sur ce modèle, dont une réponse en cours d'échange et une commande slash ; plafonds de longueur abaissés.

---

## 0.22.0 — 2026-10-27

### Retiré
- **Le bouton Ultracode on/off** du pied du prompt, au terminal comme sur desktop, avec l'état qu'il gardait et le suivi de `/effort` qui le tenait à jour. Demande de Mathis : « supprimes le bouton ultracod on/off dans le plugin des tools ». `/effort ultracode on|off` reste disponible à la main.

---

## 0.21.0 — 2026-10-26

### Ajouté
- Le nombre de tâches de fond que la requête attend encore, à côté du chrono (`Réponse 2:14 · 1 en fond`).

### Corrigé
- **Le chrono ne s'arrête plus quand une tâche de fond tourne encore, et ne repart plus de zéro à son retour.** Demande de Mathis : « Il faut que ce soit le timer jusqu'a la fin complete de la requete quand claude a fini de repondre sans aucune tache en arriere plan qui tourne. » Il mesure maintenant toute la requête (« requête » et « tâche de fond » sont définis dans `GLOSSARY.md`) : il court tant que le fil principal travaille ou qu'une tâche de fond de la requête tourne, et ne pose la ✓ qu'à la vraie fin. Le message de retour d'un sous-agent de la requête la prolonge, même après que l'agent a quitté la liste des tâches. La liste des tâches vient de `background_tasks` (`classic.Stop`, et `classic.SubagentStop` pour une tâche qui finit sans relancer de tour) ; sans elle, les agents actifs de `$.agent.list()`. Une interruption, qui n'a pas de `classic.Stop`, garde les tâches déjà connues, sauf celles qui ont notifié leur fin depuis, et les agents encore actifs ; une erreur d'API ou un refus font de même (`StopFailure` remplace alors `classic.Stop` d'après les types du moteur, à confirmer).
- Cause du retour à zéro (essai du 26/10/2026 avec Claude Code 2.1.310 et le moteur 2.1.308 de l'app desktop) : `turn.start` lisait le prompt en cours après que `prompt.submit` l'avait déjà oublié, et prenait alors la notification pour un message. `turn.start` retrouve maintenant son prompt par le texte, sans dépendre de l'ordre d'exécution, en prenant le plus récent : un prompt resté sans tour (refusé, consommé par un hook) ne prête pas son heure à un message identique envoyé plus tard.
- Une requête finie normalement ne se rouvre plus pour une tâche qu'elle n'a pas lancée (un shell d'une tâche planifiée, par exemple) ; seule une requête finie par une interruption le peut. Après un rechargement du plugin, une notification se reconnaît à son texte et ne remet plus le chrono à zéro. Choix de Mathis sur les points laissés par la revue du groupe : « oui pour tout ».
- Un message tapé pendant que Claude répond, et que le moteur livre au tour suivant, ne relance plus le chrono une seconde fois : sa requête part à son envoi, une seule fois (groupe « durcissement », choix de Mathis : « Chrono relancé (Recommandé) »).
- Tests du chrono sur le moteur tel qu'observé : retour d'un shell ou d'un sous-agent, plusieurs tâches, nouveau message pendant une tâche d'avant, serveur sans fin, interruption (dont celle du tour relancé par la dernière tâche), notification livrée pendant un tour, erreur d'API, prompt resté sans tour, pair d'une autre session, tâche planifiée, version sans `background_tasks`, au terminal et sur desktop.

### Développement
- Le contrôle de types (`tsc`, lancé par `scripts/check.sh`) passe : l'identifiant d'une notification est `null` quand le texte n'en porte pas, au lieu d'`undefined`.
- Tous les tests du chrono et de la vitesse suivent l'ordre réel des événements du moteur (`docs/evenements-moteur.md`) : `prompt.submit` rend la main avant le `turn.start` de son tour.
- La tête de `hooks/register.tsx` nomme le suivi des requêtes de stats-board, qui applique la même filiation, et ce qui doit rester aligné entre les deux ; les commentaires renvoient à `docs/evenements-moteur.md` au lieu de la spec du parcours.

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
