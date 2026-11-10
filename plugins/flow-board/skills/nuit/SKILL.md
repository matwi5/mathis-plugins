---
name: nuit
description: "Allume la surveillance de nuit du COO : pendant 12 heures au plus, le COO débloque les missions en auto par les seuls gestes de nuit ; ton prochain message l'arrête."
disable-model-invocation: true
---

La personne vient de taper `/flow-board:nuit` dans la discussion du COO : elle allume la surveillance de nuit, son accord pour les gestes de déblocage de cette nuit-là.

Appelle maintenant l'outil `flow`, seul dans son appel, avec `{"coordinate": {"nightOn": true}}`. Le tableau de bord ne l'accepte que dans ce tour, ouvert par la commande tapée, et seulement si cette discussion tient le siège du COO. Dis ensuite à la personne, en une ou deux phrases, ce que la réponse de l'outil a donné : jusqu'à quelle heure la surveillance vaut, ou pourquoi elle ne s'est pas allumée.

La surveillance s'arrête à son prochain message dans cette discussion, sur « Arrêter » au bandeau ou dans la vue Coordination, au bout de 12 heures, ou quand cette discussion perd le siège, se ferme ou est vidée. Rien d'autre à faire dans ce tour.
