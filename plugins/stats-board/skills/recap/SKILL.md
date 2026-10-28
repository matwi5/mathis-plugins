---
name: recap
description: Récap de l'usage Claude Code en chat, d'après ccusage et les relevés de requêtes de stats-board — la discussion en cours (coût, tokens, cache, durée, temps actif, temps API, requêtes et la plus chère, modèles, sous-agents) et la journée (coût, tokens, temps actif et temps API de ce poste, par projet et par modèle, discussions actives, bloc de 5 h et son rythme, autres postes publiés dans claude-usage), ou un parcours entier (discussion principale, sessions liées et sous-agents, retrouvés par le début de leur titre ou par les worktrees groupe-* d'un projet, avec leur temps actif sans double compte). À utiliser sur « /stats-board:recap », « récap de l'usage », « combien m'a coûté cette discussion », « combien j'ai consommé aujourd'hui », « coût de la journée », « récap du parcours », « combien a coûté le parcours ». Pas pour ouvrir le panneau de statistiques, qui passe par /ccstats.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/recap.mjs" *)
---

# Récap d'usage : discussion et journée, ou parcours

Tous les chiffres viennent du script, qui interroge ccusage et lit les fichiers de relevé des requêtes de stats-board (temps actif, temps API, requêtes ; « — » pour une discussion d'avant la 0.10.0). N'en calcule ni n'en arrondis aucun toi-même.

1. Lance, avec un délai de 300 000 ms (le premier appel de la journée peut télécharger ccusage), selon la demande :

   - discussion et journée (par défaut) :

     ```bash
     node "${CLAUDE_SKILL_DIR}/recap.mjs" "${CLAUDE_SESSION_ID}"
     ```

   - un parcours, par le titre de sa discussion principale ou son début (les sessions liées de flow-board, dont le titre reprend celui du parcours coupé et suivi de « … > Groupe X », « … › Groupe X » avant flow-board 0.61.0, sont retrouvées aussi) :

     ```bash
     node "${CLAUDE_SKILL_DIR}/recap.mjs" --parcours "<début du titre>"
     ```

   - un parcours, par les worktrees `groupe-*` d'un projet ; ajoute `"${CLAUDE_SESSION_ID}"` seulement si cette discussion est la discussion principale du parcours :

     ```bash
     node "${CLAUDE_SKILL_DIR}/recap.mjs" --worktrees "<dossier du projet>" --since <AAAA-MM-JJ>
     ```

   Les sessions sont prises sur les 60 derniers jours ; `--since AAAA-MM-JJ` et `--until AAAA-MM-JJ` (début et fin du parcours) les restreignent. Avec `--worktrees`, donne-les toujours si tu les connais : les worktrees `groupe-*` resservent d'un parcours à l'autre. Si l'utilisateur demande un parcours sans en donner le titre ni le projet, demande-lui le début du titre de sa discussion principale.

2. Recopie sa sortie telle quelle : c'est du Markdown prêt à afficher.
3. Ajoute au plus deux remarques d'une ligne, seulement si elles se lisent directement dans la sortie : par exemple un projet qui fait plus de la moitié du jour, un rythme « intense » ou « en feu », une discussion devinée, une discussion principale non comptée, un fichier de relevé illisible (relancer le récap).

Si le script échoue, cite la première ligne de son erreur et propose le panneau (`/ccstats`). Ne relance pas ccusage à la main.
