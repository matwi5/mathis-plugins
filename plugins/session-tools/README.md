# session-tools

Petits mods de confort pour Claude Code, réunis dans un seul module (`hooks/register.tsx`).

Version actuelle : **0.18.0**. S'appelait `mods-mathis` jusqu'à la 0.17.0. Une installation existante de `mods-mathis` est à désinstaller (`claude plugin uninstall mods-mathis@mathis-plugins`), sinon les deux tournent ensemble et doublent boutons et chrono. Avant le passage dans `mathis-plugins`, ce mod n'avait ni README ni CHANGELOG : l'historique commence avec le dépôt. Historique des versions : [CHANGELOG.md](CHANGELOG.md).

## Ce qu'il fait

- **Pied du prompt** :
  - la durée de la dernière réponse : le chrono part à l'envoi d'un message et s'arrête quand l'agent a fini ;
  - la vitesse du modèle en tokens/s, calculée sur le temps de génération seul, sans les outils ni les sous-agents ;
  - le temps restant avant que le cache de prompt expire ;
  - l'heure.
- **Boutons** :
  - Réécrire partout : le brouillon du champ de saisie est réécrit en prompt par Opus (effort low, fixé), avec une version du skill prompt-architect adaptée au mod (`hooks/rewrite-system.ts`), puis remplace le brouillon sans l'envoyer. Si le brouillon change pendant la réécriture, il est laissé tel quel. Coût : environ 0,10 $ au tarif public par réécriture, quelques secondes d'attente ;
  - Ultracode on/off partout : il lance `/effort ultracode on|off`, et l'état suit aussi un `/effort` tapé à la main ;
  - Fichiers (navigateur de `files-board`) et Diff, au terminal seulement, car l'app desktop a les siens.
- **App desktop** : son pied est trop étroit, donc le chrono, les tokens/s et le cache passent dans un bandeau au-dessus du prompt.
- **`/session-tools:start`** : un premier message qui démarre la session et tous les mods, avec leurs bandeaux, sans solliciter le modèle.

Le panneau Asana, qui vivait ici, est maintenant le plugin `asana-board`.

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
