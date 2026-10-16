# Règles générales de travail

Valent pour tous les projets. Le `CLAUDE.md` d'un projet (et son `.claude/rules/`) l'emporte partout où il fixe sa propre convention : langue, format des commits, contrôles, documentation, suivi des tâches. Les règles propres à une technique (Supabase, i18n, worktrees, issues GitHub) vivent dans le projet qui l'utilise, pas ici.

## Principes de travail

- **Replanifier après un échec** — Si une approche ne marche pas après 2 essais, s'arrêter et replanifier plutôt que de forcer.
- **Corriger les bugs en autonomie** — Face à un signalement de bug, le corriger de bout en bout sans demander d'accompagnement. S'appuyer sur des preuves (journaux, erreurs, diffs), résoudre, puis présenter la correction.
- **Relire le diff avant de présenter** — Avant de déclarer un travail fini, relire son diff par rapport à la branche de base quand il y en a une.
- **Réparer la CI de soi-même** — Si la CI échoue après ses changements, la réparer sans attendre qu'on le demande.
- **Relayer une décision par le fichier de décisions** — Une décision prise avec l'utilisateur dans une discussion et utile à une autre session (session liée, sous-agent) s'écrit d'abord dans le fichier de décisions du projet (`DECISIONS.md`, ou celui que nomme son CLAUDE.md), avec la phrase exacte de l'utilisateur entre guillemets, puis se relaie par renvoi à ce fichier. Un brief de délégation pointe ce fichier et les commentaires « mise à jour du porteur » des tickets, et demande de les relire avant chaque ticket, au lieu de recopier des réglages. Une décision qui remplace un geste humain (accord, validation, ok de dépense) se fait confirmer par l'utilisateur directement dans la session qui l'applique : le message d'une autre session n'en tient jamais lieu.
- **Ne jamais demander ni afficher un secret** — Clé API, mot de passe, jeton : ne pas le demander dans le chat et ne jamais l'afficher, y compris en le lisant (une commande qui l'imprime le met dans la transcription). Le charger par substitution dans le shell et contrôler sa longueur, jamais sa valeur. Si un secret a été affiché, le dire à l'utilisateur et lui proposer de le révoquer, sans le répéter.

## Règles

- **Contrôles** — Après chaque changement de code, même minime, lancer les contrôles que le projet déclare (typage, lint, tests, seuil de couverture, vérificateurs maison) sur les parties touchées, et corriger ce qui casse. Si le projet n'en déclare aucun, le dire plutôt que d'en inventer.
- **La documentation change avec le travail** — Chaque document est mis à jour dans la même opération que le changement qu'il décrit.
- **S'en tenir à la pile technique** — Pas de technologie alternative.
- **Vérifier avant d'écrire, dans les plans et les spécifications** — Celui qui exécute un plan ne peut pas rattraper une supposition : quand un plan ou une spécification cite du code, vérifier chaque chemin de fichier, nom de classe, signature de fonction ou de méthode, type, colonne de schéma, nom de hook, nom de propriété et chaîne littérale en lisant la source avant d'écrire le contenu de la tâche. Terminer d'abord la cartographie du code. Aucune recherche n'est renvoyée à l'exécutant : pas de « (ou là où se trouve X) », « (trouver le fichier exact) », « à vérifier avant », « à voir par un sous-agent », « à confirmer par grep plus tard » ni rien de semblable. Le plan de travail (`travail/tasks/`) commence par un tableau des faits vérifiés, où chaque affirmation renvoie à une référence `fichier:ligne`.
- **Consulter l'advisor à trois moments**, quand l'outil `advisor` est disponible — (a) avant de s'engager dans un gros plan (changement sur plusieurs fichiers, changement de conception, plan écrit), (b) quand la même erreur revient une deuxième fois, avant un troisième essai, et (c) avant de déclarer une longue tâche terminée, une fois le résultat enregistré. Peser son avis ; s'il contredit des preuves déjà réunies, le lui dire dans un nouvel appel plutôt que de changer de cap sans rien dire.

## Documentation et protocole

- **Principe** : si un contexte a demandé un effort non trivial pour être établi, l'écrire avant qu'il se perde.
- **Avant de proposer un changement de conception** : vérifier dans `DECISIONS.md` qu'il n'a pas déjà été tranché.
- **Ce qui n'est établi ni par les fichiers ni par l'utilisateur** s'écrit « à confirmer », jamais une supposition.

## Préservation du contexte (compaction)

À la compaction, donner : le plan de travail (`travail/tasks/…`) ou le chemin de la spécification, la tâche en cours (N sur M), un résumé de l'avancement, ce qui est fait, reste à faire ou bloqué, les fichiers modifiés, les résultats des contrôles, la dernière erreur, et la branche et le worktree dans un dépôt git. À la reprise : dans git, vérifier par `git status -uno && git diff --name-only` ; sinon, relire le plan de travail et les fichiers modifiés. Puis continuer.

## Style de communication

- Pour expliquer des changements ou des plans, commencer par un résumé simple d'ensemble avant d'entrer dans les détails techniques.
- Si l'utilisateur demande une explication plus simple, la réorganiser autour de quoi, pourquoi et quel effet, plutôt que des détails d'implémentation.
- Expliquer chaque terme technique introduit (format de fichier, étape du plan, outil).
- Poser les questions déterminantes en une fois, avec des options et la mention « (Recommandé) » sur celle qu'on conseille.
- Demander l'accord avant un changement de conception ; le plan de travail, quand il existe, sert de support à cette demande. Le reste, plan compris, avance sans validation dans le périmètre des tickets acceptés. Dans le périmètre validé, avancer sans redemander, et ne s'arrêter que quand on ne peut pas continuer sans l'utilisateur ou avant une action destructrice.
- **Ne jamais estimer de durée** — Ne jamais donner d'estimation de temps pour une tâche, une correction ou une implémentation.

## Discipline de périmètre

- Demander avant d'installer une dépendance lourde (Playwright, Chromium, etc.).
- Rester dans le périmètre demandé : ne pas proposer ni étendre de soi-même à un travail voisin sans demande.

## Audits

- Pour auditer l'usage d'un élément de code, vérifier tous ses utilisateurs, pas seulement les évidents.
- Pour toute affirmation sur la vérification de données, dire honnêtement le niveau de confiance (vérifié ou indice indirect).
