# Projet de suivi : conventions par défaut

Ce fichier ne garde que ce qui vaut pour tous les projets. La section et la tâche mère de Claude d'un projet viennent de son `CLAUDE.md` ou de ses instructions ; la liste renvoyée par `get_project` fait foi pour les sections. Le fichier de conventions que nomme le bloc « Suivi Asana » de l'utilisateur, s'il existe, prime sur celui-ci.

## Section commune

« Inbox à trier » reçoit les conversations ponctuelles et les tâches dont le projet n'est pas identifié. Elle peut ne pas exister : crée-la au premier besoin (`update_project` avec `add_sections`) et lis son GID dans la liste réelle. Aucun GID de section n'est figé ici.

## Convention de nom de section

- Nom du projet seul.
- Préfixe de domaine éventuel (client, équipe), séparé par un point médian entouré d'espaces ` · ` : `Client · <Nom du projet>`, avec entre parenthèses le sous-titre utile.
- Vérifie qu'aucune section existante ne couvre déjà le projet sous un autre nom avant d'en créer une.
- Une section créée pour un projet se note, avec son GID et celui de la tâche mère de Claude, dans le `CLAUDE.md` du projet (ou dans ses instructions pour un projet claude.ai), pas dans ce skill.

## Plan gratuit

Le bloc « Suivi Asana » dit si le compte est au plan gratuit ; dans le doute, fais comme s'il l'était. Au plan gratuit, l'API lit et écrit les tâches, mais refuse (`payment_required`), donc à ne jamais passer :

- `custom_fields`, à la création comme en modification : ni priorité ni statut par champ.
- `search_tasks` : chercher par `get_tasks` + `get_task`.
- Les dépendances (`dependencies`, `dependents`) : ni posées, ni relues. Une attente s'écrit dans « Contexte » ou « Fini quand ».

## Tâches mères

Le travail pour Claude d'un projet se range sous une tâche mère non assignée « [source] <Projet> : prochaines sessions Claude <surface> », dont le GID figure dans le `CLAUDE.md` du projet. Sans GID connu, cherche-la dans la section du projet (`get_tasks`) avant d'en créer une.

## Assignation

L'utilisateur seulement pour ses propres actions ; non assigné pour le travail de Claude.
