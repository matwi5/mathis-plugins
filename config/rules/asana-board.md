# Suivi Asana (plugin `asana-board`)

Les tâches de tous les projets vivent dans un seul projet Asana de suivi, une section par projet. Ce projet est décrit par un bloc « Suivi Asana » du `CLAUDE.md` global (ou de celui du projet), que `/setup:install` écrit :

```markdown
## Suivi Asana

| Élément | Valeur |
|---|---|
| Projet de suivi | « Suivi des tâches », GID `1200000000000001` |
| Espace de travail | GID `1200000000000000` |
| Plan | gratuit |
| Conventions | `~/chemin/vers/mes-conventions.md` (facultatif) |
```

## Les vraies tâches passent par un ticket

Une vraie tâche d'un projet (fonctionnalité, correctif, changement de page, de modèle ou de données, script, travail en plusieurs étapes) a son ticket : une tâche du projet de suivi, sous la tâche mère de Claude du projet. Il est créé avant de commencer et suivi pendant l'implémentation : « Statut : en cours » au démarrage, puis coché à la fin, avec « Statut : fait » dans la même écriture et un commentaire qui dit le résultat. Pas de ticket pour une petite modification qui n'est pas une vraie tâche (coquille, libellé, réglage ponctuel) ni pour une mise à jour de documentation : elles sont notées au journal de `ETAT_DU_PROJET.md`. Pas de ticket par précaution : dans le doute, demander à l'utilisateur plutôt que d'en créer un. Le skill `asana-board:suivi-asana` tient ces tickets ; le CLAUDE.md du projet donne les GID de sa section et de sa tâche mère.

**Tickets au découpage, pas avant** : quand une demande annonce un travail qui passera par un grilling, un questionnaire ou un cadrage (revue, retour d'experts, plusieurs chantiers), ne pas proposer de tickets : noter les demandes dans le journal de `ETAT_DU_PROJET.md` et proposer le parcours grilling → `/to-spec` → `/to-tickets`. Les tickets naissent à `/to-tickets`. Restent permis : le ticket découvert pendant l'implémentation et la tâche rapide qui ne justifie pas de workflow.

## Jamais d'écriture dans Asana sans accord

Avant de créer, modifier, cocher ou déplacer une tâche, proposer la liste des changements et attendre le oui de l'utilisateur, même quand `suivi-asana` se déclenche d'office ; lancer `/to-spec` ou `/to-tickets` vaut demande, mais la liste se montre quand même avant l'écriture ; la lecture reste libre. Exception : pendant l'implémentation de tickets que l'utilisateur a lancée, leur suivi s'écrit sans demander : ligne « Statut : » (`en cours`, `en attente (<qui>)`), commentaire de résultat, cochage à la fin avec « Statut : fait » ; toute autre écriture (création, changement de contenu ou de périmètre, nouveau ticket découvert en route, suppression) reste soumise à l'accord. L'accord ne dispense pas de la proposition : un plan, une spec ou une décision écrits en local ne remplacent pas Asana ; proposer en même temps les écritures Asana correspondantes.

## Tenue à jour

Une tâche ouverte garde sa ligne « Statut : » à jour (`en cours`, `en attente (<qui>)`). En fin de session, vérifier qu'Asana reflète la session (rien de fait qui reste ouvert, rien de découvert qui manque, lignes « Statut : » à jour) et proposer les écritures qui manquent. Sans connecteur Asana, le dire à l'utilisateur et noter le découvert dans le journal de `ETAT_DU_PROJET.md`, sous « À reporter dans Asana », pour le reporter à la session suivante.
