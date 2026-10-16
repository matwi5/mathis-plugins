# mattpocock-skills (copie figée)

Copie, sans modification, du plugin [`mattpocock-skills`](https://github.com/mattpocock/skills) de **Matt Pocock**, sous licence MIT (voir [`LICENSE`](LICENSE)). Tout le mérite de ces skills lui revient ; la section Summary du skill `pr` reprend le skill `show-me` de Dex Horthy (voir [`skills/engineering/pr/CREDITS.md`](skills/engineering/pr/CREDITS.md)).

Version actuelle : **1.3.1**, commit amont `49dd158d1076134a641b33efb035946536778336` (9 octobre 2026).

## Pourquoi une copie

Le plugin `flow-board` suit les parcours de ces skills étape par étape : son catalogue (`plugins/flow-board/hooks/catalog.ts`) connaît leurs noms et leurs étapes. Une mise à jour de l'amont peut renommer un skill ou changer ses étapes et casser le tableau de bord. La copie fige la version que `flow-board` connaît ; elle garde le nom `mattpocock-skills`, que `flow-board` attend (`catalog.ts`, constante `PLUGIN`).

Seuls les fichiers du plugin sont copiés : `.claude-plugin/plugin.json`, les 27 skills qu'il déclare, `LICENSE`. La documentation, les scripts de développement et les skills non publiés de l'amont n'y sont pas.

## Ne pas l'installer deux fois

Claude Code accepte deux plugins `mattpocock-skills` venus de deux marketplaces, actifs ensemble : chaque skill apparaîtrait alors deux fois. Avec cette copie, désactiver ou désinstaller celui de la marketplace `mattpocock` ou `claude-plugins-official` (`/setup:install` le propose).

## Mettre à jour la copie

1. Lire le CHANGELOG amont et vérifier que les noms et les étapes des skills que cite `catalog.ts` n'ont pas changé.
2. Recopier `.claude-plugin/plugin.json`, `LICENSE` et chaque dossier de skill listé dans `plugin.json` depuis le commit amont choisi.
3. Mettre à jour la version et le commit ci-dessus, l'entrée de `.claude-plugin/marketplace.json`, et l'en-tête de `catalog.ts`.
4. Lancer les tests de `flow-board`.
