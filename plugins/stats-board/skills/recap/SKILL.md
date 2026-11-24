---
name: recap
description: Récap de l'usage Claude Code en chat, d'après ccusage et les relevés de requêtes de stats-board — la discussion en cours (coût, tokens, cache, durée, temps actif, attente de ta réponse, temps API, requêtes et la plus chère, modèles, spécialistes) et la journée (coût, tokens, temps actif, temps cumulé et temps API de ce poste, par projet et par modèle, discussions actives, bloc de 5 h et son rythme, autres postes publiés dans claude-usage), ou une mission entière (manager, workers et spécialistes, retrouvés par le début de leur titre, par les worktrees groupe-* d'un projet ou par la liste de ses discussions, avec leur temps actif sans double compte, leur temps cumulé et leur bloc « Contexte et coût » : contexte au départ, au maximum et à la fin, compactions, coût). À utiliser sur « /stats-board:recap », « récap de l'usage », « combien m'a coûté cette discussion », « combien j'ai consommé aujourd'hui », « coût de la journée », « récap de la mission », « combien a coûté la mission », « récap du parcours », « combien a coûté le parcours ». Pas pour ouvrir le panneau de statistiques, qui passe par /ccstats.
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

   - une mission, par ses discussions, chacune avec son rôle (la liste que donnent, par exemple, les faits d'un compte rendu de flow-board) :

     ```bash
     node "${CLAUDE_SKILL_DIR}/recap.mjs" --discussions <liste> --since <AAAA-MM-JJ>
     ```

     `<liste>` est une seule valeur : des couples `<rôle>:<id>` séparés par des virgules, sans espace ; le rôle vaut `manager`, `diagnostic` ou `worker-<id du groupe>` (1 à 12 lettres ASCII ou chiffres) ; l'id est un uuid entier ou ses 8 premiers chiffres hexadécimaux. Recopie la liste telle qu'elle t'est donnée, sans y ajouter, compléter ni corriger aucun id, et n'y mets jamais un id qui n'a pas cette forme (un id `local_…`, par exemple) : le script refuse alors toute la commande, sans rien lire. Seules ces discussions sont retenues, ni le titre ni les worktrees ne s'y ajoutent ; `--discussions` ne se combine ni avec `--parcours`, ni avec `--worktrees`, ni avec un id de manager. Une discussion introuvable ou à l'id ambigu paraît dans le bloc « Contexte et coût », nommée par son rôle et le début de son id, « non mesurée » avec sa raison. Le bloc « Contexte et coût » se recopie tel quel dans un compte rendu.

   Les sessions sont prises sur les 60 derniers jours ; `--since AAAA-MM-JJ` et `--until AAAA-MM-JJ` (début et fin de la mission) les restreignent. Avec `--worktrees`, donne-les toujours si tu les connais : les worktrees `groupe-*` resservent d'une mission à l'autre. Si l'utilisateur demande une mission sans en donner le titre ni le projet, demande-lui le début du titre de son manager.

   Le récap d'une mission se termine par le bloc « Contexte et coût » : une ligne par discussion retenue (son rôle, puis son titre : avec `--discussions`, le rôle donné, « Manager », « Worker <id du groupe> » ou « Diagnostic » ; sinon « Manager », « Worker X » ou « Worker » (une session d'un worktree `groupe-*` sans titre de worker) ; la taille de son contexte au départ, à son maximum et à la fin ; ses compactions, avant → après, « automatique », « plugin » ou « voulue » ; son coût et le nombre de ses spécialistes), une ligne Total, puis « Hors norme : … » ou « Rien hors norme. ». Le script lit ces mesures dans le transcript de chaque discussion, en lecture seule : des types d'entrée, des dates et des nombres seulement, jamais le texte d'un message.

2. Recopie sa sortie telle quelle : c'est du Markdown prêt à afficher.
3. Ajoute au plus deux remarques d'une ligne, seulement si elles se lisent directement dans la sortie : par exemple un projet qui fait plus de la moitié du jour, un rythme « intense » ou « en feu », une discussion devinée, un manager non compté, un fichier de relevé illisible (relancer le récap).

Si le script échoue, cite la première ligne de son erreur et propose le panneau (`/ccstats`). Ne relance pas ccusage à la main.
