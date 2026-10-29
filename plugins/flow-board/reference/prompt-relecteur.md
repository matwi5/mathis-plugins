# Gabarit du prompt du relecteur d'un ticket (flow-board)

Le prompt du sous-agent relecteur unique qui fait les deux axes (Standards et Spec) de la revue d'un ticket (point 4 de la section 2 de `procedure-groupe.md`, dans le dossier de ce fichier). La session le lance par l'outil Agent, modèle opus, effort high, passés explicitement. Copier le texte sous la ligne, remplir chaque `<…>`, retirer les lignes entre crochets qui ne s'appliquent pas (et les crochets des autres) : le fichier de consignes (gabarit `consignes-revue.md`) porte le reste, ce prompt ne le recopie pas.

---

Tu fais la revue du ticket <id> « <titre> », sur ses deux axes, Standards et Spec, toi-même et dans cet ordre. N'invoque pas le skill code-review et ne lance aucun sous-agent : fais toi-même les deux axes.

Lis d'abord ton fichier de consignes, `<chemin du fichier de consignes>` : il donne la cible, le ticket, ce qui fait foi, ce qui est réservé et la consigne des relecteurs, qui vaut pour toute ta revue.

- Diff : `<commande de diff du fichier de consignes>` ; commits : `<git log --oneline de la même plage, ou « aucun : instantané »>`.
- [Instantané : les fichiers se lisent à la référence (`git show <référence>:<chemin>`), jamais dans l'arbre de travail, qui porte peut-être déjà le ticket suivant.]

**Axe Standards** : le diff suit-il les règles écrites du projet ? Sources : le `CLAUDE.md` du projet[, `<racine>/CODING_STANDARDS.md`][, <autres fichiers de règles>], et la liste d'odeurs de code de l'étape 3 du skill code-review (`<chemin du SKILL.md du skill code-review>`), que les règles du projet surpassent et qui reste un jugement, jamais une violation dure. Pour chaque constat : le fichier et la ligne, la règle (fichier et règle) ou l'odeur nommée, et sa classe (le motif). Rien de ce qu'un contrôle automatique vérifie déjà.

**Axe Spec** : le diff fait-il ce que le ticket demande ? Source : le ticket et, de la spec, les seules sections qu'il cite. Pour chaque constat, la phrase du ticket ou de la spec citée : (a) un critère manquant ou partiel, (b) un comportement que rien ne demande, (c) un critère qui semble fait mais dont la mise en œuvre semble fausse. Chaque critère coché du ticket se vérifie, avec le test que la session a nommé à côté.

Rapport, sous deux titres `## Standards` et `## Spec`, sans fusionner ni reclasser les constats d'un axe à l'autre : chaque constat étiqueté Important ou Antérieur, avec son scénario (ce qui casse, pour quelle entrée) ; les Mineurs en un compte par axe, sans détail. En dernière ligne, le nombre d'Importants par axe et le plus grave de chacun. 400 mots au plus par axe.
