---
name: recap
description: Récap de l'usage Claude Code en chat, d'après ccusage et les relevés de requêtes de stats-board — la discussion en cours (coût, tokens, cache, durée, temps actif, attente de ta réponse, temps API, requêtes et la plus chère, modèles, spécialistes) et la journée (coût, tokens, temps actif, temps cumulé et temps API de ce poste, par projet et par modèle, discussions actives, bloc de 5 h et son rythme, autres postes publiés dans claude-usage), ou une mission entière (manager, workers et spécialistes, retrouvés par le début de leur titre ou par les worktrees groupe-* d'un projet, avec leur temps actif sans double compte et leur temps cumulé). À utiliser sur « /stats-board:recap », « récap de l'usage », « combien m'a coûté cette discussion », « combien j'ai consommé aujourd'hui », « coût de la journée », « récap de la mission », « combien a coûté la mission », « récap du parcours », « combien a coûté le parcours ». Pas pour ouvrir le panneau de statistiques, qui passe par /ccstats.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/recap.mjs" *)
---

# Récap d'usage : discussion et journée, ou mission

Tous les chiffres viennent du script, qui interroge ccusage et lit les fichiers de relevé des requêtes de stats-board (temps actif, temps cumulé et temps gagné, spécialistes de fond en parallèle compris, attente de ta réponse, temps API, requêtes ; « — » pour une discussion d'avant la 0.10.0). N'en calcule ni n'en arrondis aucun toi-même.

1. Lance, avec un délai de 300 000 ms (le premier appel de la journée peut télécharger ccusage), selon la demande :

   - discussion et journée (par défaut) :

     ```bash
     node "${CLAUDE_SKILL_DIR}/recap.mjs" "${CLAUDE_SESSION_ID}"
     ```

   - une mission, par le titre de son manager ou son début (les workers de flow-board, dont le titre reprend celui de la mission coupé et suivi de « … > Groupe X », « … › Groupe X » avant flow-board 0.61.0, sont retrouvés aussi) :

     ```bash
     node "${CLAUDE_SKILL_DIR}/recap.mjs" --parcours "<début du titre>"
     ```

   - une mission, par les worktrees `groupe-*` d'un projet ; ajoute `"${CLAUDE_SESSION_ID}"` seulement si cette discussion est le manager de la mission :

     ```bash
     node "${CLAUDE_SKILL_DIR}/recap.mjs" --worktrees "<dossier du projet>" --since <AAAA-MM-JJ>
     ```

   Les sessions sont prises sur les 60 derniers jours ; `--since AAAA-MM-JJ` et `--until AAAA-MM-JJ` (début et fin de la mission) les restreignent. Avec `--worktrees`, donne-les toujours si tu les connais : les worktrees `groupe-*` resservent d'une mission à l'autre. Si l'utilisateur demande une mission sans en donner le titre ni le projet, demande-lui le début du titre de son manager.

2. Recopie sa sortie telle quelle : c'est du Markdown prêt à afficher.
3. Ajoute au plus deux remarques d'une ligne, seulement si elles se lisent directement dans la sortie : par exemple un projet qui fait plus de la moitié du jour, un rythme « intense » ou « en feu », une discussion devinée, un manager non compté, un fichier de relevé illisible (relancer le récap).

Si le script échoue, cite la première ligne de son erreur et propose le panneau (`/ccstats`). Ne relance pas ccusage à la main.
