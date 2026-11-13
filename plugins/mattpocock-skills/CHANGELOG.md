# Historique des versions

Les versions suivent celles de l'amont ([mattpocock/skills](https://github.com/mattpocock/skills)), suivies de `-mathis.<n>` dès que la copie s'en écarte (voir « Numéro de version » dans le README).

---

## 1.3.1-mathis.10 — 2026-11-13

### Modifié
- **`grilling`** : un tour se borne à un tableau et à quatre questions courtes, le reste de la frontière gardé pour les tours suivants.
- **`to-tickets`** : chaque ticket sensible porte une ligne d'invariant, et les critères sont écrits pour ne pas tromper la session qui les code.
- **`research`** : quand Chrome est autorisé, la discussion choisit le navigateur avant de lancer l'agent, et la consigne sans Chrome est dans le prompt de l'agent.
- **`diagnosing-bugs`** : cède aux consignes de flow-board, la chasse au bug passant en Implémentation.

---

## 1.3.1-mathis.9 — 2026-11-10

### Modifié
- **README** : la liste des écarts avec l'amont nomme tous les ajouts locaux, et la copie se met à jour par une fusion à trois (amont d'avant, amont nouveau, copie locale).

### Corrigé
- **CHANGELOG** : l'entrée 1.3.1-mathis.7 décrit le changement de mots tel qu'il a été fait.

---

## 1.3.1-mathis.8 — 2026-11-08

### Modifié
- **`to-tickets`** : un ticket sensible nomme aussi, par une recherche citée, les chemins qui lisent sa donnée pour décider, et ce que devient une valeur déjà gardée hors forme ; un ticket qui change un prédicat de rattachement porte le tableau des formes qu'il reçoit ; un critère sur les tests existants cite la recherche des tests qui lisent la fonction changée ; la mesure de ce que charge une session se fait en session interactive, et un critère de fini ne compare que les fichiers du ticket.
- **`to-spec`** : les mêmes ajouts pour une spec en zone sensible (chemins qui lisent la donnée pour décider, valeur hors forme, tableau des formes d'un prédicat de rattachement).
- **`diagnosing-bugs`** : le test de régression affirme mot pour mot l'attente écrite par l'utilisateur ; s'il ne peut pas passer, Claude le dit et demande avant de l'assouplir.
- **`grilling`** : chaque question se lit seule, sans le rapport qui l'a amenée.

---

## 1.3.1-mathis.7 — 2026-11-03

### Modifié
- **`retro` et `tdd`** disent « worker » là où ils disaient « linked session » ; README au vocabulaire des missions. Le texte de Matt Pocock ne change pas.

---

## 1.3.1-mathis.6 — 2026-11-01

### Modifié
- **`to-spec` et `to-tickets`** : la même liste des cas du cycle de vie d'un champ persisté (lecture et écriture ratées, bornes, effacement, copie forgée, transitions de l'objet marqué). `to-tickets` relit chaque critère d'un ticket sensible contre son invariant avant la validation, et demande qu'un ticket de mesure fasse citer à chaque résultat écrit sa ligne de journal.

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
