---
name: recap
description: Récap de l'usage Claude Code en chat, d'après ccusage — la discussion en cours (coût, tokens, cache, durée, modèles, sous-agents) et la journée (coût et tokens de ce poste, par projet et par modèle, discussions actives, bloc de 5 h et son rythme, autres postes publiés dans claude-usage). À utiliser sur « /stats-board:recap », « récap de l'usage », « combien m'a coûté cette discussion », « combien j'ai consommé aujourd'hui », « coût de la journée ». Pas pour ouvrir le panneau de statistiques, qui passe par /ccstats.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/recap.mjs" *)
---

# Récap d'usage : discussion et journée

Tous les chiffres viennent du script, qui interroge ccusage. N'en calcule ni n'en arrondis aucun toi-même.

1. Lance, avec un délai de 300 000 ms (le premier appel de la journée peut télécharger ccusage) :

   ```bash
   node "${CLAUDE_SKILL_DIR}/recap.mjs" "${CLAUDE_SESSION_ID}"
   ```

2. Recopie sa sortie telle quelle : c'est du Markdown prêt à afficher.
3. Ajoute au plus deux remarques d'une ligne, seulement si elles se lisent directement dans la sortie : par exemple un projet qui fait plus de la moitié du jour, un rythme « intense » ou « en feu », une discussion devinée.

Si le script échoue, cite la première ligne de son erreur et propose le panneau (`/ccstats`). Ne relance pas ccusage à la main.
