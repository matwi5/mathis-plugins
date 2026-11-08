# Procédure d'un worker de groupe : sans git (section 9)

Annexe du noyau `procedure-groupe.md` (dans le dossier de ce fichier), à lire seulement quand le prompt dit que le dossier de travail n'a pas de git. Les numéros de section sont ceux de la procédure entière : les sections 1, 2, 3, 7 et 8 sont dans le noyau, les sections 4 à 6 dans `procedure-groupe-fin.md`. « Je », « me » et « moi » désignent la personne qui porte la mission, comme dans le noyau.

## 9. Sans git

Quand le prompt dit que le dossier de travail n'a pas de git (pas de worktree, pas de commit qui marque un ticket) :

- **Copie avant chaque ticket** (section 2, avant le point 3) : avant de toucher à son premier fichier, copier les fichiers qu'il va modifier dans son dossier temporaire (celui de la section 3), un sous-dossier par ticket qui garde le chemin dans le projet (`<dossier temporaire>/<id du ticket>/<chemin dans le projet>`) : ces copies sont le point fixe des revues, qui lisent la différence entre la copie et le fichier actuel (diff unifié ; `git diff --no-index <copie> <fichier>` marche hors d'un dépôt) au lieu de relire les fichiers entiers ; un fichier que le ticket crée n'a pas de copie : il est nouveau et se lit en entier.
- **Point fixe d'un ticket** (section 2, points 4 et 5) : la copie de ses fichiers prise avant le ticket, comparée aux fichiers actuels ; la passe « bogues » prend pour arguments « <niveau> --max-findings all consignes : <chemin> », sans plage ; pas d'instantané (point 6).
- **Fichier de consignes** (point 7) : `/code-review <niveau> consignes : <chemin>` (le fichier liste les copies et les fichiers à comparer).
- **Commit** (point 9) : pas de commit avant la revue ; la revue passe avant le suivi du ticket.
- **Revue du groupe** (section 4) : arguments « high --fix consignes : <chemin> », sur les changements du groupe (point fixe : pour chaque fichier, la plus ancienne copie parmi les tickets du groupe — un fichier touché seulement par un ticket suivant n'a pas de copie du premier —, comparée au fichier actuel, les fichiers nouveaux en entier ; lui donner la liste des copies et des fichiers).
- **Revue de sécurité** (section 5) : pour seul périmètre les changements du groupe, au même point fixe.
- **Compte rendu** (section 6) : sans branche.
