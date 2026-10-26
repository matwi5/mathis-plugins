# session-tools

Petits mods de confort pour Claude Code, réunis dans un seul module (`hooks/register.tsx`).

Version actuelle : **0.20.0**. S'appelait `mods-mathis` jusqu'à la 0.17.0. Une installation existante de `mods-mathis` est à désinstaller (`claude plugin uninstall mods-mathis@mathis-plugins`), sinon les deux tournent ensemble et doublent boutons et chrono. Avant le passage dans `mathis-plugins`, ce mod n'avait ni README ni CHANGELOG : l'historique commence avec le dépôt. Historique des versions : [CHANGELOG.md](CHANGELOG.md).

## Ce qu'il fait

- **Pied du prompt** :
  - la durée de la dernière réponse : le chrono part à l'envoi d'un message et s'arrête quand l'agent a fini ;
  - la vitesse du modèle en tokens/s, calculée sur le temps de génération seul, sans les outils ni les sous-agents ;
  - le temps restant avant que le cache de prompt expire ;
  - l'heure.
- **Boutons** :
  - Réécrire partout : le brouillon du champ de saisie est réécrit en prompt par le modèle de l'option `model` (Opus par défaut, effort low), avec une version du skill prompt-architect adaptée au mod (`hooks/rewrite-system.ts`), puis remplace le brouillon sans l'envoyer. Si le brouillon change pendant la réécriture, il est laissé tel quel. Temps et coût selon le modèle : voir « Modèle des boutons » ;
  - Effort auto partout : le même modèle choisit le niveau d'effort du brouillon avec une version du skill choix-effort adaptée au mod (`hooks/effort-system.ts` : pas de question, le brouillon seul), puis le demande par `/effort` avant l'envoi ; une notification donne le niveau demandé et sa raison. Comme un `/effort` tapé, le niveau devient aussi l'effort par défaut des nouvelles sessions (sauf `max`), et Claude Code peut demander de confirmer un changement en cours de discussion. Ses repères chiffrés sont ceux d'Opus 5.5. Temps et coût du choix selon le modèle : voir « Modèle des boutons » ; changer d'effort en cours de discussion fait aussi repayer le cache du contexte ;
  - Ultracode on/off partout : il lance `/effort ultracode on|off`, et l'état suit aussi un `/effort` tapé à la main ;
  - Fichiers (navigateur de `files-board`) et Diff, au terminal seulement, car l'app desktop a les siens.
- **App desktop** : son pied est trop étroit, donc le chrono, les tokens/s et le cache passent dans un bandeau au-dessus du prompt.
- **`/session-tools:start`** : un premier message qui démarre la session et tous les mods, avec leurs bandeaux, sans solliciter le modèle.

Le panneau Asana, qui vivait ici, est maintenant le plugin `asana-board`.

## Modèle des boutons

L'option `model` (`opus` par défaut, `sonnet` ou `haiku`, toujours en effort low) vaut pour Réécrire et Effort auto. Elle se choisit à l'installation (`/setup:install`, ou l'écran d'options de `claude plugin install`), puis dans `/config`. Estimations mesurées sur 7 brouillons réels, au tarif public, sans cache :

| Modèle | Réécrire : qualité | Réécrire : temps médian, coût | Effort auto : lisibilité, constance, accord avec Opus | Effort auto : temps médian, coût |
|---|---|---|---|---|
| `opus` | 8,1/10 ; 7 inventions | 6,7 s, 0,11 $ | 21 sur 21 ; 6 sur 7 ; référence | 2,1 s, 0,03 $ |
| `sonnet` | 7,2/10 ; 20 inventions | 5,6 s, 0,05 $ | 21 sur 21 ; 7 sur 7 ; 18 sur 21 | 1,8 s, 0,02 $ |
| `haiku` | 5,1/10 ; 41 inventions, 9 demandes perdues | 5,7 s, 0,003 $ | 18 sur 21 ; 4 sur 7 ; 16 sur 18 | 3,5 s, 0,001 $ |

La qualité de Réécrire est notée à l'aveugle par des juges Opus, qui peuvent avantager les textes d'Opus ; « inventions » : faits ou exigences ajoutés que le brouillon ne contient pas. Pour Effort auto, il n'y a pas de bonne réponse connue : réponses lisibles, brouillons qui reçoivent le même niveau aux 3 essais, et accord avec Opus pris comme référence.

## Installation

Il est distribué par la marketplace `mathis-plugins` (dépôt GitHub `matwi5/mathis-plugins`, source dans `plugins/session-tools/`). Pour installer un poste et suivre le protocole de développement, voir le README à la racine du dépôt.

```bash
claude plugin install session-tools@mathis-plugins
```

**Prérequis** : Claude Code 2.1.286 ou plus récent, c'est-à-dire avec les mods.

## Développement

```bash
claude plugin validate plugins/session-tools
claude plugin test plugins/session-tools
```

Pour une nouvelle version, monter `version` dans `.claude-plugin/plugin.json` et dans l'entrée `session-tools` de `.claude-plugin/marketplace.json` à la racine du dépôt.
