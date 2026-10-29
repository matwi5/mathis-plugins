# Méthode de la relecture du fond et de la forme (flow-board)

Ce fichier est la méthode fixe que suit le sous-agent relecteur d'une relecture du fond et de la forme lancée par flow-board : à la revue d'un ticket dont le livrable est un document lu par d'autres (un rapport, un guide, un document pour des utilisateurs), que le ticket signale par une ligne « Lecteur : <qui> ». Elle part dans le même message que les axes Standards et Spec de la revue du ticket, sur la même cible, dans une session liée de groupe comme dans la discussion principale. Ces deux axes relisent les règles de code et la conformité au ticket ; aucun ne relit le document pour celui qui le lira : c'est le rôle de cette relecture.

Le prompt du relecteur donne le chemin de ce fichier et celui de son fichier de consignes (périmètre, lecteur visé, fichier des choix déclarés, points réservés à la personne). Lis les deux, puis le document.

## 1. Le lecteur visé

Le lecteur est celui que nomme la ligne « Lecteur » du ticket, recopiée dans le fichier de consignes ; pour un ticket ancien sans cette ligne, la session l'a nommé elle-même. Toute la relecture se fait pour lui : ce qu'il sait déjà, ce qu'il cherche en ouvrant le document, ce qu'il fera après l'avoir lu. Écris-le en tête de ton rapport, en une ligne. Un document juste mais écrit pour un autre lecteur (trop technique, trop allusif, trop long pour son usage) est un constat.

## 2. Périmètre et sources

- **Le document du ticket** : les fichiers de la cible que donne le fichier de consignes, la même que celle de la revue du ticket (la plage `<commit d'avant le ticket>..<commit du ticket>`, celle d'un instantané, ou des copies sans git). Une section ajoutée à un document plus long se relit dans son contexte, mais les constats portent sur ce que le ticket a écrit ou changé ; ce qui précède le lot va dans une liste à part, sans correction.
- **Les sources du projet** : le ticket et sa spec, le fichier de décisions, le code ou les données que le document décrit, le `CLAUDE.md` du projet, et son glossaire (`GLOSSARY.md` ou celui que nomme son `CLAUDE.md`) quand il existe. C'est par elles que se juge l'exactitude : une affirmation du document qu'aucune source ne porte est un constat.
- **Les choix déclarés** : ceux du fichier des choix, et ceux que le fichier de consignes ajoute, ne se resignalent pas par préférence ; signale tout cas où l'un d'eux rend le document faux ou obscur pour son lecteur, avec ce qui le montre.

## 3. Le fond

- **L'exactitude** : chaque fait, chiffre, nom, chemin, commande ou comportement décrit correspond aux sources. Vérifie-le en les lisant, pas de mémoire ; un point que les sources ne permettent pas de trancher se dit « à confirmer » dans le constat.
- **La complétude pour ce lecteur** : ce dont il a besoin pour comprendre et agir est là (le contexte, le pourquoi, les limites, ce qu'il doit faire, où aller ensuite).
- **Ce qui manque ou est de trop** : une étape, une condition ou un cas que le lecteur rencontrera et que le document tait ; à l'inverse, un détail d'implémentation, une répétition ou un historique qui ne lui sert pas.

## 4. La forme

- **La structure** : l'ordre suit la question du lecteur ; les titres disent ce que contient leur section ; le résumé ou la réponse vient d'abord, les détails ensuite.
- **La clarté** : des phrases qu'on comprend à la première lecture ; chaque terme technique expliqué à son premier emploi quand le lecteur peut ne pas le connaître ; un exemple là où une règle abstraite ne suffit pas.
- **Le ton** : celui que le lecteur attend (un guide, un rapport, une note de version), sans jargon interne ni familiarité déplacée.
- **La longueur** : à la mesure de l'usage ; ce qui peut se dire plus court se dit plus court.
- **La cohérence des termes** : un même objet porte un seul nom, celui du glossaire du projet quand il en a un (et jamais un terme que le glossaire donne « à éviter ») ; les termes du document s'accordent avec ceux de l'interface ou du code qu'il décrit.

## 5. Lecture seule

N'écris rien dans l'arbre de travail, même un instant, et ne lance aucune commande qui modifie quelque chose : la session choisit ce qu'elle applique. Ne relance ni les tests ni les contrôles.

## 6. Rapport

En tête : le lecteur visé (section 1), puis le périmètre relu.

Puis les constats importants, numérotés R1, R2…, du plus important au moins important (un fait faux passe avant un défaut de forme, un manque qui bloque le lecteur avant une longueur) :

```
## R1 : <fond ou forme> : `fichier:ligne`
- Constat : ce qui ne va pas, et pour ce lecteur pourquoi.
- Source : ce qui le montre (la source qui contredit le document, le terme du glossaire), quand il y en a une.
- Correction proposée : le texte à mettre à la place, ou ce qu'il faut ajouter ou retirer, prêt à appliquer.
```

Les constats mineurs se rendent en un compte, sans détail (une virgule, un mot qu'on pourrait mieux choisir, une tournure qui ne gêne pas la lecture) : une remarque mineure ne doit coûter ni correctif ni nouveau tour de relecture. Puis, à part, les constats sur un texte antérieur au lot, sans correction.

## 7. Après la relecture

La session applique ce qu'elle retient dans le commit des correctifs de la revue du ticket, et ne coche le ticket qu'ensuite. Les constats de la relecture comptent avec ceux de l'axe Spec dans le champ `review` de l'outil flow, dans un seul envoi avec ceux des deux axes ; il n'y a pas d'axe à part.
