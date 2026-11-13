# Gabarit du prompt du relecteur d'un ticket (flow-board)

Le prompt du spécialiste relecteur unique de la revue d'un ticket (point 4 de la section 2 de `procedure-groupe.md`, dans le dossier de ce fichier) : les deux axes (Standards et Spec) pour un ticket hors zone sensible, en effort medium ; l'axe Spec seul pour un ticket sensible ou très sensible, en effort high (variante en fin de fichier), puisque sa passe « bogues » refait l'axe Standards. La session le lance par l'outil Agent, modèle opus et effort passés explicitement. Copier le texte sous la ligne, remplir chaque `<…>`, retirer les lignes entre crochets qui ne s'appliquent pas (et les crochets des autres) : le fichier de consignes (gabarit `consignes-revue.md`) porte le reste, ce prompt ne le recopie pas.

---

Tu fais la revue du ticket <id> « <titre> », sur ses deux axes, Standards et Spec, toi-même et dans cet ordre. N'invoque pas le skill code-review et ne lance aucun spécialiste : fais toi-même les deux axes. Ne consulte pas l'advisor : la discussion qui t'a lancé relit ton rapport.

Lis d'abord ton fichier de consignes, `<chemin du fichier de consignes>` : il donne la cible, le ticket, ce qui fait foi, ce qui est réservé et la consigne des relecteurs, qui vaut pour toute ta revue.

- Diff : `<commande de diff du fichier de consignes>` ; commits : `<git log --oneline de la même plage, ou « aucun : instantané »>`.
- [Instantané : les fichiers se lisent à la référence (`git show <référence>:<chemin>`), jamais dans l'arbre de travail, qui porte peut-être déjà le ticket suivant.]
- Où écrire : tes seules écritures (copies extraites, notes) vont dans `<dossier du relecteur>`, le dossier du relecteur que donnent ton fichier de consignes et `snapshot.mjs` (dans le dossier temporaire de la session quand elle en a un, sinon dans le dossier git du worktree ; hors de l'arbre suivi) ; jamais dans `/tmp`, l'arbre de travail ni ailleurs. Un essai (un scénario à rejouer, une commande git d'essai) se fait par un script écrit dans ce dossier par l'outil Write, puis lancé par une commande simple, jamais par un heredoc ni une commande composée, et n'écrit que dans ce dossier. Sans dossier où écrire (ou si l'outil Write y est refusé), n'écris rien : lis par `git show` et `git diff`, et rends ton scénario d'essai en texte.

**Axe Standards** : le diff suit-il les règles écrites du projet ? Sources : le `CLAUDE.md` du projet[, `<racine>/CODING_STANDARDS.md`][, <autres fichiers de règles>], et la liste d'odeurs de code de l'étape 3 du skill code-review (`<chemin du SKILL.md du skill code-review>`), que les règles du projet surpassent et qui reste un jugement, jamais une violation dure. Pour chaque constat : le fichier et la ligne, la règle (fichier et règle) ou l'odeur nommée, et sa classe (le motif), avec les autres endroits où tu vois le même motif (« même défaut dans X »), pour qu'ils soient tous corrigés dès la première fois. Rien de ce qu'un contrôle automatique vérifie déjà.

**Axe Spec** : le diff fait-il ce que le ticket demande ? Source : le ticket et, de la spec, les seules sections qu'il cite. Pour chaque constat, la phrase du ticket ou de la spec citée : (a) un critère manquant ou partiel, (b) un comportement que rien ne demande, (c) un critère qui semble fait mais dont la mise en œuvre semble fausse. Chaque critère coché du ticket se vérifie, avec le test que la session a nommé à côté. Chaque point numéroté et chaque phrase de comportement de « What to build » se vérifient aussi, pas seulement les critères cochés. Chaque phrase de docstring, de commentaire ou de message que le diff touche se confronte aux branches du code qu'elle décrit : une phrase fausse est un constat Important (consigne des relecteurs). Pour un défaut, nomme aussi les autres endroits où tu vois le même motif (« même défaut dans X »), pour qu'ils soient tous corrigés dès la première fois.

Rapport, sous deux titres `## Standards` et `## Spec`, sans fusionner ni reclasser les constats d'un axe à l'autre : chaque constat étiqueté Important ou Antérieur, avec son scénario (ce qui casse, pour quelle entrée) ; les Mineurs en un compte par axe, sans détail. En dernière ligne, le nombre d'Importants par axe et le plus grave de chacun. 400 mots au plus par axe.

## Variante « axe Spec seul » (ticket sensible ou très sensible)

Même usage : copier le texte sous la ligne, remplir chaque `<…>`, retirer les lignes entre crochets qui ne s'appliquent pas. Nom du spécialiste : « Spec · <ticket> ».

---

Tu fais la revue du ticket <id> « <titre> », sur son seul axe Spec, toi-même. N'invoque pas le skill code-review et ne lance aucun spécialiste. Ne consulte pas l'advisor : la discussion qui t'a lancé relit ton rapport. L'axe Standards n'est pas à faire : la passe « bogues » du ticket relit le code en même temps que toi.

Lis d'abord ton fichier de consignes, `<chemin du fichier de consignes>` : il donne la cible, le ticket, ce qui fait foi, ce qui est réservé et la consigne des relecteurs, qui vaut pour toute ta revue.

- Diff : `<commande de diff du fichier de consignes>` ; commits : `<git log --oneline de la même plage, ou « aucun : instantané »>`.
- [Instantané : les fichiers se lisent à la référence (`git show <référence>:<chemin>`), jamais dans l'arbre de travail, qui porte peut-être déjà le ticket suivant.]
- Où écrire : tes seules écritures (copies extraites, notes) vont dans `<dossier du relecteur>`, le dossier du relecteur que donnent ton fichier de consignes et `snapshot.mjs` (dans le dossier temporaire de la session quand elle en a un, sinon dans le dossier git du worktree ; hors de l'arbre suivi) ; jamais dans `/tmp`, l'arbre de travail ni ailleurs. Un essai (un scénario à rejouer, une commande git d'essai) se fait par un script écrit dans ce dossier par l'outil Write, puis lancé par une commande simple, jamais par un heredoc ni une commande composée, et n'écrit que dans ce dossier. Sans dossier où écrire (ou si l'outil Write y est refusé), n'écris rien : lis par `git show` et `git diff`, et rends ton scénario d'essai en texte.

**Axe Spec** : le diff fait-il ce que le ticket demande ? Source : le ticket et, de la spec, les seules sections qu'il cite. Pour chaque constat, la phrase du ticket ou de la spec citée : (a) un critère manquant ou partiel, (b) un comportement que rien ne demande, (c) un critère qui semble fait mais dont la mise en œuvre semble fausse. Chaque critère coché du ticket se vérifie, avec le test que la session a nommé à côté. Chaque point numéroté et chaque phrase de comportement de « What to build » se vérifient aussi, pas seulement les critères cochés. Chaque phrase de docstring, de commentaire ou de message que le diff touche se confronte aux branches du code qu'elle décrit : une phrase fausse est un constat Important (consigne des relecteurs). Pour un défaut, nomme aussi les autres endroits où tu vois le même motif (« même défaut dans X »), pour qu'ils soient tous corrigés dès la première fois. Ne juge pas le code sur les règles écrites du projet (`CODING_STANDARDS.md`, même si ton fichier de consignes le cite) ni sur les odeurs de code.

Rapport, sous le titre `## Spec` : chaque constat étiqueté Important ou Antérieur, avec son scénario (ce qui casse, pour quelle entrée) ; les Mineurs en un compte, sans détail. En dernière ligne, le nombre d'Importants et le plus grave. 400 mots au plus.
