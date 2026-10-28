# mattpocock-skills (copie figée)

Copie du plugin [`mattpocock-skills`](https://github.com/mattpocock/skills) de **Matt Pocock**, sous licence MIT (voir [`LICENSE`](LICENSE)), sans autre modification que les retraits listés plus bas. Tout le mérite de ces skills lui revient ; la section Summary du skill `pr` reprend le skill `show-me` de Dex Horthy (voir [`skills/engineering/pr/CREDITS.md`](skills/engineering/pr/CREDITS.md)).

Version actuelle : **1.3.1-mathis.1**, commit amont `49dd158d1076134a641b33efb035946536778336` (9 octobre 2026). Historique : [CHANGELOG.md](CHANGELOG.md).

## Pourquoi une copie

Le plugin `flow-board` suit les parcours de ces skills étape par étape : son catalogue (`plugins/flow-board/hooks/catalog.ts`) connaît leurs noms et leurs étapes. Une mise à jour de l'amont peut renommer un skill ou changer ses étapes et casser le tableau de bord. La copie fige la version que `flow-board` connaît ; elle garde le nom `mattpocock-skills`, que `flow-board` attend (`catalog.ts`, constante `PLUGIN`).

Seuls les fichiers du plugin sont copiés : `.claude-plugin/plugin.json`, les skills qu'il déclare (25 sur les 27 de l'amont), `LICENSE`. La documentation, les scripts de développement et les skills non publiés de l'amont n'y sont pas.

## Écarts avec l'amont

Retirés le 28/10/2026 (1.3.1-mathis.1), jamais lancés et couverts autrement par `flow-board` :

- **`implement-spec`** : son dossier et sa ligne de `plugin.json`. Le parallèle passe par les groupes de tickets confiés à des sessions liées, chacune avec `/implement`, et la revue se fait par ticket et par groupe.
- **`wayfinder`** : son dossier et sa ligne de `plugin.json`. Un grand chantier passe par un ou plusieurs grillings, un `travail/<chantier>/DECISIONS.md`, puis `/to-spec` et `/to-tickets`.
- Ce qui les citait : dans `ask-matt`, l'option `/implement-spec` de l'étape 3 (et sa phrase sur la revue), l'entrée `/wayfinder` des « On-ramps » et sa mention sous `/grilling` ; dans les trois fiches de tracker de `setup-matt-pocock-skills` (`issue-tracker-github.md`, `issue-tracker-gitlab.md`, `issue-tracker-local.md`), la section « Wayfinding operations ».

## Numéro de version

`<version amont>-mathis.<n>` : la version de l'amont, puis le rang de nos écarts sur cette version (`1.3.1-mathis.1`, puis `1.3.1-mathis.2` pour un nouvel écart). Claude Code met un plugin à jour dès que la chaîne de version change, sans la comparer au sens semver ; ne jamais écrire `+mathis.<n>`, rangé dans le même dossier de cache que `-mathis.<n>`, au risque d'une mise à jour qui passe pour déjà faite.

## Ne pas l'installer deux fois

Claude Code accepte deux plugins `mattpocock-skills` venus de deux marketplaces, actifs ensemble : chaque skill apparaîtrait alors deux fois. Avec cette copie, désactiver ou désinstaller celui de la marketplace `mattpocock` ou `claude-plugins-official` (`/setup:install` le propose).

## Mettre à jour la copie

1. Lire le CHANGELOG amont et vérifier que les noms et les étapes des skills que cite `catalog.ts` n'ont pas changé.
2. Recopier `.claude-plugin/plugin.json`, `LICENSE` et chaque dossier de skill listé dans `plugin.json` depuis le commit amont choisi.
3. Refaire les retraits de « Écarts avec l'amont » sur les fichiers recopiés.
4. Mettre à jour la version (`<version amont>-mathis.1`) et le commit ci-dessus, l'entrée de `.claude-plugin/marketplace.json`, l'en-tête de `catalog.ts` et le `CHANGELOG.md`.
5. Lancer les tests de `flow-board`.
