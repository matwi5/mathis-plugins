# Gabarit du fichier de consignes d'une revue (flow-board)

Le fichier que la session écrit dans son dossier temporaire avant chaque revue (point 7 de la section 2 de `procedure-groupe.md`, dans le dossier de ce fichier) : son chemin suit la cible de `/code-review` (« consignes : <chemin> ») ou va dans le prompt du spécialiste relecteur. Copier le texte sous la ligne, remplir chaque `<…>`, retirer les lignes entre crochets qui ne s'appliquent pas (et les crochets des autres). La consigne des relecteurs, à la fin, reste telle quelle : c'est celle de la section 7 de la procédure. Pour la revue d'un ticket, le script `scripts/consignes.mjs` (dans le dossier de flow-board) écrit ce fichier depuis ce gabarit, une commande simple au lieu d'une copie à la main (la procédure en donne la forme)  : il garde le texte de chaque ligne et en remplit les trous ; une ligne qu'il ne sait pas classer, ou un trou qu'il ne connaît pas, le fait échouer : l'ajouter aussi au script.

---

# Consignes de la revue : <ticket <id> « <titre> », ou groupe <id> « <nom> »>

## Périmètre

- Cible : `<base>..<fin>`, jamais un hash seul (<base> : le commit d'avant le ticket, ou celui d'où part la branche du groupe ; <fin> : le commit du ticket, `HEAD`, ou l'instantané `refs/worktree/flow-board/<id>`).
- [Avant le commit du ticket : aussi les changements non commités de <fichiers>.]
- [D'autres missions commitent sur la branche : seulement `git diff <base>..<fin> -- <chemins de la mission>`.]
- Le ticket : `<chemin du fichier de ticket>` ; dans la spec, les seules sections qu'il cite : <sections>.
- [Revue d'un ticket : les critères des tickets déjà faits du groupe qui touchent les mêmes fichiers, recopiés : <id> : <critère> ; … (la règle d'un ticket non appliquée dans un autre avait fait 3 des 7 constats d'une revue de groupe).]
- [Revue du groupe : se concentrer sur les interactions entre les tickets <ids>, chacun déjà relu.]
- [Revue du groupe, sécurité : une valeur relue (un fichier, une autre session, un compte rendu, la sortie d'une commande) qui entre dans une commande shell ou un chemin se signale comme un bogue, Important, sauf là où un contrôle du projet la vérifie déjà (dans le dépôt de flow-board : `check.sh`, pour ses hooks) ; la revue de sécurité ne la cherche plus, car le compte de la personne est sa frontière de confiance.]

## Ce qui fait foi

- Les choix déjà déclarés : `<chemin du fichier des choix>`, plus ceux de la session qui n'y sont pas encore : <liste>.
- Les décisions : `<fichier de décisions du projet>` et les commentaires « mise à jour du porteur » des tickets.
- [Les règles de jugement : `<racine du dossier de travail>/CODING_STANDARDS.md`.]
- [Passe « bogues » : l'invariant du ticket, que le relecteur cherche d'abord à violer : « <invariant> » ; un constat qui ne le viole pas se range sous « Pistes », sans question ni correctif.]
- [Relecture du fond et de la forme : le lecteur visé : <la ligne « Lecteur » du ticket, ou celui que la session a nommé>.]

## Réservé, et à ne pas faire

- Réservé au porteur de la mission : <une décision, un geste, un accès>.
- À ne pas faire : <ce que ce relecteur ne doit pas faire, en plus de la consigne ci-dessous>.
- [Où écrire : seulement `<dossier du relecteur>` (copies extraites, notes), le dossier qu'imprime `scripts/snapshot.mjs` (son instantané, ou sa forme `--dossier`) : propre à ce worktree, hors de l'arbre suivi, effacé avec lui (dans le clone principal, commun à ses discussions : un id propre à la mission) ; jamais `/tmp` (des noms génériques y avaient écrasé les copies d'une autre session) ni l'arbre de travail, hors des correctifs qu'applique une revue `--fix` du groupe (consigne ci-dessous).]

## Consigne des relecteurs

> Si la revue a plusieurs axes (Standards et Spec), ne rendre son rapport qu'une fois tous les axes revenus, sans relancer un axe déjà lancé ; ne relancer ni les tests ni les contrôles (la session les a lancés) ; classer à part les constats sur du code antérieur au lot (des lignes qu'il n'a pas changées) : ne pas les corriger, ils me sont proposés comme un groupe « durcissement » en fin de lot, sauf un constat sur du code antérieur qui viole l'invariant du ticket : il est Important et se corrige (dans un groupe « durcissement », le code qu'il vise n'est pas antérieur au lot) ; étiqueter chaque constat Important, Mineur ou Antérieur (le code antérieur au lot, juste avant) : seuls les Importants sont corrigés, les Mineurs (style, nommage, nettoyage qui ne change aucun comportement) ne sont pas corrigés et se rendent en un compte, sans détail, pour qu'un constat mineur ne coûte ni commit ni nouveau tour de revue ; une description, un commentaire ou un texte de documentation que le diff rend faux est Important ; l'absence dans le fichier de décisions d'un choix pris en session n'est pas un constat ; la revue d'un ticket cherche aussi les tests voisins qui lisent le même observable (un test qui fixe ailleurs l'ancien comportement) ; pour un défaut, nommer sa classe (le motif, pas seulement la ligne) pour que toutes ses occurrences soient corrigées ; ne signaler comme défaut ni appliquer rien de ce que la spec, le ticket ou le fichier des choix laisse à un autre groupe ou exclut ; ne pas défaire par préférence un choix de ce fichier, ni le resignaler comme tel, mais signaler tout cas où il produit un défaut, avec son scénario ; ne jamais écrire dans l'arbre de travail, même un instant (un test qui prouve un défaut reste à la session) : les seules écritures sont les correctifs que /code-review --fix applique dans une revue de groupe.
