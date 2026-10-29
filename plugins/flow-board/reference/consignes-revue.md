# Gabarit du fichier de consignes d'une revue (flow-board)

Le fichier que la session écrit dans son dossier temporaire avant chaque revue (point 7 de la section 2 de `procedure-groupe.md`, dans le dossier de ce fichier) : son chemin suit la cible de `/code-review` (« consignes : <chemin> ») ou va dans le prompt du sous-agent relecteur. Copier le texte sous la ligne, remplir chaque `<…>`, retirer les lignes entre crochets qui ne s'appliquent pas (et les crochets des autres). La consigne des relecteurs, à la fin, reste telle quelle : c'est celle de la section 7 de la procédure.

---

# Consignes de la revue : <ticket <id> « <titre> », ou groupe <id> « <nom> »>

## Périmètre

- Cible : `<base>..<fin>`, jamais un hash seul (<base> : le commit d'avant le ticket, ou celui d'où part la branche du groupe ; <fin> : le commit du ticket, `HEAD`, ou l'instantané `refs/worktree/flow-board/<id>`).
- [Avant le commit du ticket : aussi les changements non commités de <fichiers>.]
- [D'autres parcours commitent sur la branche : seulement `git diff <base>..<fin> -- <chemins du parcours>`.]
- Le ticket : `<chemin du fichier de ticket>` ; dans la spec, les seules sections qu'il cite : <sections>.
- [Revue d'un ticket : les critères des tickets déjà faits du groupe qui touchent les mêmes fichiers, recopiés : <id> : <critère> ; … (la règle d'un ticket non appliquée dans un autre avait fait 3 des 7 constats d'une revue de groupe).]
- [Revue du groupe : se concentrer sur les interactions entre les tickets <ids>, chacun déjà relu.]

## Ce qui fait foi

- Les choix déjà déclarés : `<chemin du fichier des choix>`, plus ceux de la session qui n'y sont pas encore : <liste>.
- Les décisions : `<fichier de décisions du projet>` et les commentaires « mise à jour du porteur » des tickets.
- [Les règles de jugement : `<racine du dossier de travail>/CODING_STANDARDS.md`.]
- [Passe « bogues » : l'invariant du ticket, que le relecteur cherche d'abord à violer : « <invariant> ».]
- [Relecture du fond et de la forme : le lecteur visé : <la ligne « Lecteur » du ticket, ou celui que la session a nommé>.]

## Réservé, et à ne pas faire

- Réservé au porteur du parcours : <une décision, un geste, un accès>.
- À ne pas faire : <ce que ce relecteur ne doit pas faire, en plus de la consigne ci-dessous>.

## Consigne des relecteurs

> Si la revue a plusieurs axes (Standards et Spec), ne rendre son rapport qu'une fois tous les axes revenus, sans relancer un axe déjà lancé ; ne relancer ni les tests ni les contrôles (la session les a lancés) ; classer à part les constats sur du code antérieur au lot (des lignes qu'il n'a pas changées) : ne pas les corriger, ils me sont proposés comme un groupe « durcissement » en fin de lot ; étiqueter chaque constat Important, Mineur ou Antérieur (le code antérieur au lot, juste avant) : seuls les Importants sont corrigés, les Mineurs (style, nommage, nettoyage qui ne change aucun comportement) ne sont pas corrigés et se rendent en un compte, sans détail, pour qu'un constat mineur ne coûte ni commit ni nouveau tour de revue ; pour un défaut, nommer sa classe (le motif, pas seulement la ligne) pour que toutes ses occurrences soient corrigées ; ne signaler comme défaut ni appliquer rien de ce que la spec, le ticket ou le fichier des choix laisse à un autre groupe ou exclut ; ne pas défaire par préférence un choix de ce fichier, ni le resignaler comme tel, mais signaler tout cas où il produit un défaut, avec son scénario ; ne jamais écrire dans l'arbre de travail, même un instant (un test qui prouve un défaut reste à la session) : les seules écritures sont les correctifs que /code-review --fix applique dans une revue de groupe.
