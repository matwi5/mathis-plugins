# mods-mathis

Petits mods de confort pour Claude Code, réunis dans un seul module (`hooks/register.tsx`).

Version actuelle : **0.16.5**. Avant le passage dans `mathis-plugins`, ce mod n'avait ni README ni CHANGELOG : l'historique commence avec le dépôt. Historique des versions : [CHANGELOG.md](CHANGELOG.md).

## Ce qu'il fait

- **Pied du prompt** :
  - la durée de la dernière réponse : le chrono part à l'envoi d'un message et s'arrête quand l'agent a fini ;
  - la vitesse du modèle en tokens/s, calculée sur le temps de génération seul, sans les outils ni les sous-agents ;
  - le temps restant avant que le cache de prompt expire ;
  - l'heure.
- **Boutons** :
  - Ultracode on/off partout : il lance `/effort ultracode on|off`, et l'état suit aussi un `/effort` tapé à la main ;
  - Fichiers (navigateur de `files-board`) et Diff, au terminal seulement, car l'app desktop a les siens.
- **App desktop** : son pied est trop étroit, donc le chrono, les tokens/s et le cache passent dans un bandeau au-dessus du prompt.
- **`/mods-mathis:start`** : un premier message qui démarre la session et tous les mods, avec leurs bandeaux, sans solliciter le modèle.

Le panneau Asana, qui vivait ici, est maintenant le plugin `asana-board`.

## Installation

Il est distribué par la marketplace `mathis-plugins` (dépôt GitHub `matwi5/mathis-plugins`, source dans `plugins/mods-mathis/`). Pour installer un poste et suivre le protocole de développement, voir le README à la racine du dépôt.

```bash
claude plugin install mods-mathis@mathis-plugins
```

**Prérequis** : Claude Code 2.1.286 ou plus récent, c'est-à-dire avec les mods.

## Développement

```bash
claude plugin validate ~/.claude/mathis-plugins/plugins/mods-mathis
claude plugin test ~/.claude/mathis-plugins/plugins/mods-mathis
```

Pour une nouvelle version, monter `version` dans `.claude-plugin/plugin.json` et dans l'entrée `mods-mathis` de `.claude-plugin/marketplace.json` à la racine du dépôt.
