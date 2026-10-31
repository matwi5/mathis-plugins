# Historique des versions

Les versions suivent celles de l'amont ([mattpocock/skills](https://github.com/mattpocock/skills)), suivies de `-mathis.<n>` dès que la copie s'en écarte (voir « Numéro de version » dans le README).

---

## 1.3.1-mathis.5 — 2026-10-31

### Modifié
- **`retro`** : en présentant ses pistes, la rétro annonce leur découpage en tickets par le bouton « ✂ Découper » du tableau de bord flow-board.

---

## 1.3.1-mathis.4 — 2026-10-29

### Modifié
- **`to-tickets` et `to-spec`** : un ticket en zone sensible s'écrit d'après le code (la fonction nommée lue, les chemins qui écrivent ou effacent ses données énumérés par une recherche citée, la question du cycle de vie), sans « à confirmer ».
- **`to-spec`** : finit par « tape /mattpocock-skills:to-tickets », sans promettre de le lancer.
- **`grilling`** : quand l'utilisateur impose un mécanisme, la première question porte sur lui, ses réglages viennent au tour suivant.
- **`tdd`** : en session liée, les seams fixés par la spec, le ticket ou le dépôt valent confirmés.

---

## 1.3.1-mathis.3 — 2026-10-28

### Ajouté
- **`retro`** : avant de rédiger une issue sur `matwi5/mathis-plugins`, la rétro cherche dans les issues ouvertes et fermées du dépôt (`gh issue list`, sinon l'API publique de GitHub, sinon la piste est marquée « not checked ») et affiche la suite de chaque piste : nouvelle issue, 👍 sur l'issue ouverte qui la couvre déjà, commentaire avec seulement l'apport, mise à jour de la marketplace ou issue « Regression of #N » pour une issue fermée comme corrigée (selon la version installée), rien ou un commentaire d'argument nouveau pour une issue refusée. Claude tranche quand la correspondance est nette, l'utilisateur sinon. Commentaires et 👍 se publient comme une issue, sur oui, un à la fois ; les mots-clés de recherche suivent la règle de confidentialité du texte publié.

### Corrigé
- **`retro`** : lit la version installée dans `installed_plugins.json` (le cache peut garder d'anciens dossiers de version), et un commentaire sur une issue existante ne porte que ce qui est nouveau.

---

## 1.3.1-mathis.2 — 2026-10-28

### Ajouté
- **`retro`** : une piste qui change un fichier servi par la marketplace `mathis-plugins` (ses plugins, cette copie, ses règles communes) se présente comme une issue à ouvrir sur le dépôt public `matwi5/mathis-plugins`, sauf quand le `CLAUDE.md` de l'utilisateur dit qu'il maintient mathis-plugins. Une issue par piste (fusion si même problème, piste mixte coupée), dans la langue de l'utilisateur, sans rien de son projet, montrée en entier et ouverte seulement sur son oui, par `gh issue create` ou un lien prérempli.

---

## 1.3.1-mathis.1 — 2026-10-28

### Retiré
- **`implement-spec`** et **`wayfinder`** : leurs dossiers et leurs lignes de `plugin.json`, jamais lancés. `flow-board` couvre le premier par les groupes en sessions liées ; le second ne s'accorde pas avec un tracker Asana.
- Ce qui les citait : dans `ask-matt`, l'option `/implement-spec` de l'étape 3, sa phrase sur la revue, l'entrée `/wayfinder` des « On-ramps » et sa mention sous `/grilling` ; la section « Wayfinding operations » des trois fiches de tracker de `setup-matt-pocock-skills`.

---

## 1.3.1 — 2026-10-09

Copie sans modification de l'amont, commit `49dd158d1076134a641b33efb035946536778336`.
