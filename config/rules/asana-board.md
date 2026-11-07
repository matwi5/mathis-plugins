# Suivi Asana (plugin `asana-board`)

Dans un projet suivi (bloc « Suivi Asana » du `CLAUDE.md` global ou de celui du projet), une vraie tâche (fonctionnalité, correctif, changement de page, de modèle ou de données, script, travail en plusieurs étapes) a son ticket Asana, créé avant de commencer ; une petite modification ou une mise à jour de documentation va au journal de `ETAT_DU_PROJET.md` ; un travail qui passera par un cadrage n'a ses tickets qu'à `/to-tickets` (d'ici là, ses demandes vont au journal, avec une mission grilling → `/to-spec` → `/to-tickets` proposée).

Jamais d'écriture dans Asana sans l'accord de l'utilisateur sur la liste des changements, même quand `suivi-asana` se déclenche d'office ; seule exception, le suivi des tickets dont il a lancé l'implémentation (ligne « Statut : », commentaire de résultat, cochage). Un plan, une spec ou une décision écrits en local ne remplacent pas Asana : proposer en même temps les écritures Asana correspondantes.
En mode auto, le bloc « mode auto » de la consigne flow-board l'emporte, pour les seules écritures que la mission prévoit.

Le skill `asana-board:suivi-asana` tient ces tickets. Avant de créer un ticket, d'écrire dans Asana ou de faire le point de fin de session, lire le détail de ces règles : `~/.claude/plugins/marketplaces/mathis-plugins/plugins/asana-board/skills/suivi-asana/references/regles.md` (dans le dépôt `mathis-plugins` : `plugins/asana-board/skills/suivi-asana/references/regles.md`).
