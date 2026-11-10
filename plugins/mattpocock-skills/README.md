# mattpocock-skills (copie figée)

Copie du plugin [`mattpocock-skills`](https://github.com/mattpocock/skills) de **Matt Pocock**, sous licence MIT (voir [`LICENSE`](LICENSE)), sans autre modification que les écarts listés plus bas. Tout le mérite de ces skills lui revient ; la section Summary du skill `pr` reprend le skill `show-me` de Dex Horthy (voir [`skills/engineering/pr/CREDITS.md`](skills/engineering/pr/CREDITS.md)).

Version actuelle : **1.3.1-mathis.9**, commit amont `49dd158d1076134a641b33efb035946536778336` (9 octobre 2026). Historique : [CHANGELOG.md](CHANGELOG.md).

La v1.3.2 de l'amont (29/10/2026) a été comparée à cette copie le 08/11/2026 : 15 de ses 20 changements y étaient déjà (le commit amont de la copie est postérieur au tag v1.3.1). Des 5 autres, 2 ne touchent pas la copie (`chief-of-staff`, non publié, et `wayfinder`, retiré) ; 2 ne servent qu'avec un tracker GitHub ou GitLab (#1169, #1228, qui répare aussi le renvoi à **Blocking** signalé plus bas) ; le dernier (#1341) fait démarrer chaque sous-agent avec un contexte neuf, ce que Claude Code fait déjà par défaut. Sa reprise est reportée à la prochaine version de l'amont, avec laquelle elle se fera ; ce jour-là, ne pas prendre `glab mr list -O json` de la fiche GitLab, une régression ([issue amont #1346](https://github.com/mattpocock/skills/issues/1346)).

## Pourquoi une copie

Le plugin `flow-board` suit les missions de ces skills étape par étape : son catalogue (`plugins/flow-board/hooks/catalog.ts`) connaît leurs noms et leurs étapes. Une mise à jour de l'amont peut renommer un skill ou changer ses étapes et casser le tableau de bord. La copie fige la version que `flow-board` connaît ; elle garde le nom `mattpocock-skills`, que `flow-board` attend (`catalog.ts`, constante `PLUGIN`).

Seuls les fichiers du plugin sont copiés : `.claude-plugin/plugin.json`, les skills qu'il déclare (25 sur les 27 de l'amont), `LICENSE`. La documentation, les scripts de développement et les skills non publiés de l'amont n'y sont pas.

## Écarts avec l'amont

### Retirés

Le 28/10/2026 (1.3.1-mathis.1), jamais lancés et couverts autrement par `flow-board` :

- **`implement-spec`** : son dossier et sa ligne de `plugin.json`. Le parallèle passe par les groupes de tickets confiés à des workers, chacun avec `/implement`, et la revue se fait par ticket et par groupe.
- **`wayfinder`** : son dossier et sa ligne de `plugin.json`. Un grand chantier passe par un ou plusieurs grillings, un `travail/<chantier>/DECISIONS.md`, puis `/to-spec` et `/to-tickets`.
- Ce qui les citait : dans `ask-matt`, l'option `/implement-spec` de l'étape 3 (et sa phrase sur la revue), l'entrée `/wayfinder` des « On-ramps » et sa mention sous `/grilling` ; dans les trois fiches de tracker de `setup-matt-pocock-skills` (`issue-tracker-github.md`, `issue-tracker-gitlab.md`, `issue-tracker-local.md`), la section « Wayfinding operations ». Effet de bord connu : dans `issue-tracker-github.md`, la puce sur les sous-issues renvoie encore à « **Blocking** below », une puce qui n'était que dans cette section ; la v1.3.2 de l'amont remonte **Blocking** dans les Conventions, ce que la prochaine mise à jour apportera. Les fiches GitLab et locale y ont aussi perdu leur seule convention **Blocking**, que la 1.3.2 ne remonte pas pour elles.

### Ajoutés et modifiés

Par skill, chaque fois avec la version qui l'a posé ; le détail de chaque version est dans le [CHANGELOG.md](CHANGELOG.md).

- **`retro`, pistes sur mathis-plugins** (28/10/2026, 1.3.1-mathis.2) : un paragraphe de l'étape 4. Une piste qui change un fichier servi par la marketplace `mathis-plugins` (ses plugins, cette copie, les règles `config/rules/*.md`) se présente comme une issue à ouvrir sur le dépôt public `matwi5/mathis-plugins`, et non comme une modification à faire, sauf quand le `CLAUDE.md` de l'utilisateur dit qu'il maintient mathis-plugins. Une issue par piste, rédigée dans la langue de l'utilisateur, sans rien de son projet (ni code, ni chemin, ni nom, ni extrait de transcript), montrée en entier et ouverte seulement sur son oui (`gh issue create`, sinon un lien prérempli). Depuis la 1.3.1-mathis.3 (28/10/2026), la rétro cherche d'abord dans les issues ouvertes et fermées du dépôt (`gh`, sinon l'API publique de GitHub) et propose pour chaque piste une nouvelle issue, un 👍 sur l'issue qui la couvre déjà, un commentaire avec seulement l'apport, une mise à jour de la marketplace (ou une issue « Regression of #N ») si l'issue est fermée comme corrigée, ou rien si elle a été refusée ; commentaires et 👍 suivent les règles des issues, et les mots-clés de recherche la même règle de confidentialité.
- **`retro`, découpage par flow-board** (1.3.1-mathis.5) : quand le tableau de bord `flow-board` suit la rétro, sa présentation des pistes se termine en annonçant leur découpage en tickets par le bouton « ✂ Découper » ; depuis la 1.3.1-mathis.7, ce paragraphe dit « worker » au lieu de « linked session ».
- **`tdd`** (1.3.1-mathis.4) : les seams déjà fixés par la spec, le ticket ou le dépôt valent confirmés, ce qui permet à une session sans l'utilisateur (un worker) de tester sans lui poser la question ; depuis la 1.3.1-mathis.7, la phrase dit « worker » au lieu de « linked session ».
- **`grilling`** : quand l'utilisateur impose un mécanisme, la première question du tour suivant porte sur ce mécanisme, ses réglages viennent après (1.3.1-mathis.4) ; chaque question se lit seule, en redisant le fait sur lequel elle repose (1.3.1-mathis.8).
- **`to-spec`** : en zone sensible, la spec s'écrit d'après le code, chaque fonction nommée lue et la recherche des chemins qui écrivent, fusionnent ou effacent la donnée citée, avec la question du cycle de vie, sans « à confirmer » ; la spec se termine par « tape /mattpocock-skills:to-tickets », sans promettre de le lancer (1.3.1-mathis.4). La liste des cas du cycle de vie d'un champ persisté (1.3.1-mathis.6). Les chemins qui lisent la donnée pour décider, le sort d'une valeur déjà gardée hors forme, le tableau des formes d'un prédicat de rattachement (1.3.1-mathis.8).
- **`to-tickets`** : les mêmes règles pour un ticket en zone sensible (1.3.1-mathis.4, .6 et .8) ; en plus, la relecture de chaque critère d'un ticket sensible contre son invariant avant la validation, et un ticket de mesure qui cite pour chaque résultat sa ligne de journal (1.3.1-mathis.6) ; un critère sur les tests existants qui cite la recherche des tests lisant la fonction changée, la mesure de ce que charge une session faite en session interactive, et un critère de fini qui ne compare que les fichiers du ticket ; avant la validation, chaque clause de l'invariant d'un ticket relue contre le code actuel, champ par champ, une clause que le code viole déjà devenant une question (1.3.1-mathis.8).
- **`diagnosing-bugs`** (1.3.1-mathis.8) : le test de régression affirme mot pour mot l'attente écrite par l'utilisateur ; s'il ne peut pas passer, Claude le dit et demande avant de l'assouplir.

## Numéro de version

`<version amont>-mathis.<n>` : la version de l'amont, puis le rang de nos écarts sur cette version (`1.3.1-mathis.1`, puis `1.3.1-mathis.2` pour un nouvel écart). Claude Code met un plugin à jour dès que la chaîne de version change, sans la comparer au sens semver ; ne jamais écrire `+mathis.<n>`, rangé dans le même dossier de cache que `-mathis.<n>`, au risque d'une mise à jour qui passe pour déjà faite.

## Ne pas l'installer deux fois

Claude Code accepte deux plugins `mattpocock-skills` venus de deux marketplaces, actifs ensemble : chaque skill apparaîtrait alors deux fois. Avec cette copie, désactiver ou désinstaller celui de la marketplace `mattpocock` ou `claude-plugins-official` (`/setup:install` le propose).

## Mettre à jour la copie

La mise à jour part du commit amont de la copie (ligne « Version actuelle »), pas du tag de la version amont précédente : la copie peut avoir été prise entre deux versions, et le CHANGELOG amont annonce alors des changements qu'elle a déjà. Elle se fait dans un clone de l'amont rangé dans un dossier temporaire, hors de ce dépôt, dont on ne lance aucun script.

1. Lister ce qui a changé : `git log <commit amont de la copie>..<nouveau tag>` et `git diff --name-status <commit amont de la copie> <nouveau tag> -- skills/ .claude-plugin/ LICENSE`. Aucun skill de la copie ne doit être renommé ni supprimé, et les étapes des skills que cite `catalog.ts` ne doivent pas changer : sinon, s'arrêter et demander. Un nouveau skill amont n'entre pas dans la copie sans décision.
2. Pour chaque fichier de la copie que l'amont a changé, une fusion à trois voies, qui garde nos écarts sans les refaire : `git merge-file <fichier de la copie> <ce fichier au commit amont de la copie> <ce fichier au nouveau tag>` (les deux derniers extraits par `git show <ref>:<chemin>` dans le dossier temporaire ; jamais un commit de ce dépôt comme base, qui effacerait nos écarts sans conflit). Un conflit dans une section que nous avons retirée (« Wayfinding operations ») se résout en gardant le retrait ; dans `plugin.json`, le conflit sur `version` se résout à l'étape 4 et la liste `skills` ne garde que les skills de la copie ; tout autre conflit se résout en relisant l'écart concerné plus haut. Un fichier que l'amont ajoute dans un skill de la copie se copie tel quel ; un fichier qu'il y supprime se supprime aussi, sauf s'il porte un écart (alors : demander). Puis relire chaque changement amont pris sans conflit et retirer ceux qu'une note de ce README écarte (sous « Version actuelle »).
3. Vérifier le résultat : `diff -r` entre `skills/` du nouveau tag et celui de la copie ne montre plus que les écarts listés plus haut, et les dossiers que la copie ne prend pas (`deprecated/`, `in-progress/`, `misc/`, les `README.md` de catégorie) ; le `diff` des deux `plugin.json` ne montre que la version et les lignes des skills retirés.
4. Mettre à jour la version (`<version amont>-mathis.1`) et le commit ci-dessus, l'entrée de `.claude-plugin/marketplace.json`, l'en-tête de `catalog.ts` et le `CHANGELOG.md` ; dans ce README, retirer ou réécrire la note sur la dernière version amont comparée (sous « Version actuelle ») et les effets de bord que la mise à jour a réparés (« Retirés »).
5. Lancer les tests de `flow-board`.
