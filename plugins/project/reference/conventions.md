# Convention de projet pour Claude Code

Ce document est la référence des skills `/project:new` et `/project:audit`. Il décrit la structure d'un projet, ce que contient chaque fichier, et les règles de rédaction des fichiers d'instructions. Les sources sont listées à la fin ; ce qui n'y figure pas est un choix de la convention, pas une recommandation d'Anthropic.

## 1. Structure

```
<projet>/
├── CLAUDE.md              # instructions chargées à chaque session, moins de 200 lignes
├── BRIEF.md               # cadrage : objectif, utilisateurs, périmètre, contraintes
├── DECISIONS.md           # décisions de conception, avec les alternatives écartées
├── ETAT_DU_PROJET.md      # section « État » réécrite + « Journal » daté, entrée la plus récente en tête
├── docs/                  # specs écrites avant d'implémenter, références que le code ne porte pas
├── <sous-dossier>/CLAUDE.md   # consignes propres à ce dossier, chargées quand Claude y lit un fichier
├── .github/
│   └── pull_request_template.md   # section publique (notes de version) + détails internes pour la revue
├── travail/
│   └── tasks/             # un plan de travail par gros travail : AAAA-MM-JJ_<sujet>.md
└── .claude/
    └── skills/            # workflows propres au projet
```

Les tâches du projet vivent dans Asana, dans le projet de suivi que nomme le bloc « Suivi Asana » du `CLAUDE.md` global (ou de celui du projet). Il n'y a pas de `TODO.md` : une seule source de vérité pour le travail restant. Organisation, mise à jour par la skill `asana-board:suivi-asana` :

- une section par projet ; `CLAUDE.md` cite le GID du projet Asana et celui de la section, pour que Claude y aille sans chercher ;
- le travail de Claude est rangé sous une tâche mère non assignée « [code] <section> : prochaines sessions Claude Code » ; les tâches assignées au porteur sont les siennes ;
- chaque description de tâche commence par une ligne « Statut : » (à faire, en cours, en attente, à trancher, à confirmer, à proposer) ;
- la liste d'une section ne renvoie pas les sous-tâches : au démarrage, Claude lit chaque tâche mère ;
- sans connecteur Asana, le découvert est noté dans le journal de `ETAT_DU_PROJET.md` sous « À reporter dans Asana », et reporté à la session suivante ;
- ce qui peut être écrit dans Asana (données internes, confidentielles) est dit dans `CLAUDE.md` quand le projet a une règle.

## 2. Rôle de chaque fichier

| Fichier | Contient | Ne contient pas | Mis à jour |
|---|---|---|---|
| `CLAUDE.md` | Commandes (installer, lancer, vérifier), conventions qui s'écartent des usages, pièges connus, protocole de session, pointeurs vers les autres fichiers | Ce que Claude peut lire dans le code, descriptions fichier par fichier, informations qui changent souvent, tutoriels | Quand une règle manque ou devient fausse |
| `BRIEF.md` | Objectif, utilisateurs, périmètre et hors périmètre, contraintes, critères de réussite | Détails techniques | Sur décision du porteur |
| `DECISIONS.md` | Une entrée par décision : contexte, décision, alternatives écartées et pourquoi, conséquences | Le journal des actions | À chaque décision de conception |
| `ETAT_DU_PROJET.md` | « État » : où en est le projet, en cours, prochaine étape, bloquants. « Journal » : une entrée datée par session | La liste des commits (git la tient), le détail des tâches (Asana) | En fin de chaque session qui modifie le projet |
| `docs/` | Specs de fonctionnalités écrites avant d'implémenter ; références pour ce qui n'est pas lisible comme du code (modèle Power BI, dictionnaire de données externe, API tierce) | Descriptions du code existant (tech-design, liste des routes, copie du schéma de base) | Quand le comportement prévu change |
| `.github/pull_request_template.md` | Une section publique entre `<!-- PUBLIC -->` et `<!-- INTERNAL -->` (ce que voient les utilisateurs, extractible par la CI), puis résumé, projets concernés, changements, détails techniques, vérification, tickets | Des vérifications cochées sans avoir été lancées | Quand le format des PR change |
| `travail/tasks/` | Plan de travail facultatif d'un gros travail : tickets couverts, faits vérifiés, étapes, puis Fait, En cours, À faire | L'état des tickets (Asana) | Avant et pendant l'exécution ; conservé ensuite comme trace |

Chargement : `CLAUDE.md` est chargé à chaque session. `BRIEF.md` peut y être importé (`@BRIEF.md`) s'il reste court et stable. `DECISIONS.md` et le journal ne sont jamais importés : ils grossissent et se consultent par recherche. Au démarrage, Claude lit la section « État » et les 5 dernières entrées du journal, pas le fichier entier.

## 3. Choisir le bon mécanisme

| Besoin | Mécanisme |
|---|---|
| Règle valable pour tout le projet | `CLAUDE.md` |
| Règle valable pour une partie du projet (migrations, locales, config native, un sous-projet) | `CLAUDE.md` du sous-dossier concerné, chargé quand Claude y lit un fichier |
| Connaissance ou consigne utile seulement pour certaines tâches | Skill dans `.claude/skills/`, chargé quand la tâche s'y prête |
| Procédure répétable (release, synchronisation de base) | Skill dans `.claude/skills/`, invocable par `/<nom>` |
| Action qui doit se produire à chaque fois, sans exception (lint après édition, blocage d'un dossier) | Hook dans `.claude/settings.json` : une instruction en prose reste un conseil |
| Préférences et apprentissages de Claude | Mémoire automatique (native) |
| Tâche qui lit beaucoup de fichiers | Sous-agent, pour garder le contexte principal propre |

Critère pour chaque ligne de `CLAUDE.md` : « Est-ce que la retirer ferait faire une erreur à Claude ? » Sinon, la retirer.

Ces choix suivent la forme par défaut de `/doctor` (CLAUDE.md imbriqués et skills), pour que la convention et l'outil ne se contredisent pas. Les `.claude/rules/` avec `paths:` qu'un projet a déjà restent valides ; on n'en crée pas de nouvelles.

## 4. Rédaction des fichiers d'instructions

Ces règles s'appliquent à `CLAUDE.md`, aux règles, aux skills et aux agents. Elles reprennent la méthode `prompt-audit` du skill `claude-api` fourni avec Claude Code (`/claude-api prompt-audit`), qui sert aussi d'outil d'audit. `/doctor` complète : il coupe d'un `CLAUDE.md` du dépôt ce que Claude peut déduire du code (arborescences, listes de dépendances, vues d'architecture) en gardant pièges, raisons et conventions, dédoublonne les `CLAUDE.md` locaux contre ceux du dépôt, et déplace la consigne qui n'a pas besoin d'être chargée à chaque session vers des `CLAUDE.md` imbriqués et des skills.

**Le cadre** : chaque instruction doit apporter ce que le modèle ne peut pas savoir. Le but n'est pas de raccourcir. Le contexte (public, produit, environnement, exigence de qualité, raison d'une contrainte) n'est jamais superflu.

| Motif à éviter | Pourquoi | À la place |
|---|---|---|
| Emphase en série : `IMPORTANT`, `CRITICAL`, `MUST`, `NEVER` en majuscules | Les modèles actuels suivent les instructions de près ; l'emphase généralisée provoque sur-déclenchement et rigidité, et ne distingue plus rien | Dire la règle à voix normale, avec sa raison. Réserver l'emphase à une instruction dont on a constaté qu'elle était ignorée |
| Adoucissements sur une exigence : « si possible », « essayer de » | Lus littéralement comme une permission de ne pas le faire | Énoncer l'exigence |
| « Réfléchis étape par étape », « planifie avant d'agir » | Le raisonnement est natif ; ces consignes provoquent de la sur-planification | Supprimer ; régler la profondeur avec l'effort |
| Scénario numéroté pour une tâche de jugement | Le plan du modèle vaut généralement mieux qu'un script écrit à la main | Décrire le résultat, les contraintes et la vérification. Garder les étapes exactes pour les opérations fragiles (git, suppression, migration) |
| Liste d'interdictions sans raison | Une interdiction contre une erreur que le modèle n'allait pas faire peut l'y attirer | Garder celles qui portent une contrainte réelle, avec la raison ; reformuler les autres en positif |
| Règle née d'un seul incident | La session suivante contourne un trou qui n'existe plus | Garder seulement ce qui aurait aidé la plupart des sessions |
| Chemins, commandes, versions codés en dur | Ils pourrissent quand le code évolue | Vérifier qu'ils existent ; préférer décrire l'architecture et les workflows |
| Deux fichiers qui tranchent différemment le même point | Claude ne sait pas lequel est à jour | Une information à un seul endroit ; une règle plus étroite (`CLAUDE.md` d'un sous-dossier, skill) qui en remplace une autre est une exception légitime |
| Récit historique : « depuis la PR 42 », « maintenant », « n'est plus » | L'autorité d'une règle vient de ce qu'elle prescrit | Écrire la règle actuelle comme si c'était la seule |
| Consignes qui suppriment les points d'étape (« ne commente pas », « tout garder pour la fin ») | Les modèles récents rendent compte moins qu'avant quand ces consignes sont présentes | Les retirer ; dire quand un point d'étape est attendu si besoin |
| Plafonds chiffrés de longueur (« au plus 100 mots ») | Réglés contre des modèles bavards, ils brident le raisonnement | Décrire le lecteur et le besoin (« une réponse qui se lit d'un coup d'œil ») |

À garder même si une recherche automatique les signale : le contexte, les étapes exactes des opérations fragiles, les interdictions qui portent une contrainte réelle, un court rôle en tête, un rappel final des quelques règles clés, la description (frontmatter `description`) d'un skill qui doit se déclencher, et les redondances qui fonctionnent sans se contredire.

## 5. Recommandations Claude Code et Opus 5.5

- **Vérification** : donner à Claude une commande qui renvoie réussite ou échec (tests, build, lint) et l'écrire dans la section « Commandes » de `CLAUDE.md`. C'est ce qui permet de le laisser travailler sans surveiller chaque étape.
- **Explorer, planifier, coder** : mode plan pour les changements qui touchent plusieurs fichiers ou une approche incertaine ; pas de plan pour ce qui se décrit en une phrase.
- **Spec avant les grosses fonctionnalités** : faire interviewer le porteur, écrire la spec dans `docs/`, puis implémenter dans une session neuve.
- **Contexte** : `/clear` entre deux tâches sans rapport ; sous-agents pour les recherches qui lisent beaucoup de fichiers.
- **Revue** : `/code-review` pendant le développement ; `/code-review ultra` avant de fusionner un changement important ; `/security-review` sur ce qui touche l'authentification ou les données.
- **Déléguer la tâche entière** : donner la tâche complète avec ce que « fini » veut dire et les cas où Claude doit s'arrêter pour demander (en tête du fichier `travail/tasks/`). À la fin d'une exécution longue, lire d'abord ce qu'il attend du porteur : c'est la rubrique « Bloqué par moi » du compte rendu.
- **Cache et contexte** : choisir le modèle au début de la session plutôt qu'en cours de route, compacter avant de s'absenter plutôt qu'après, vérifier avec `/usage` la part de lectures en cache. Ne fournir que le contexte nécessaire.
- **Effort** : sur Opus 5.5, l'effort est le réglage principal de la profondeur de raisonnement (le raisonnement est toujours actif). La documentation API conseille de partir de `medium` et de réserver `xhigh` et `max` aux tâches où un gain a été mesuré. Pour réduire le raisonnement, baisser l'effort plutôt qu'ajouter des consignes en prose.
- **État entre sessions** : notes libres pour la progression (`ETAT_DU_PROJET.md`, fichiers `travail/tasks/`), git pour l'historique, format structuré (JSON) pour un suivi d'état que Claude met à jour en autonomie longue.
- **Entretien des fichiers d'instructions** : lancer `/doctor` quand `CLAUDE.md` dépasse 200 lignes ou que Claude Code affiche un avertissement de taille au démarrage, après une migration, et de temps en temps ; il signale aussi les skills, serveurs MCP et plugins inutilisés au regard de leur coût en contexte. Il montre ses constats et demande confirmation avant de modifier quoi que ce soit (coupe de `CLAUDE.md` : Claude Code v2.1.206 ou plus).
- **Anciens modèles** : au changement de modèle, relancer `/claude-api prompt-audit` sur les fichiers d'instructions (v2.1.221 ou plus) ; une consigne utile sur une génération peut être nuisible sur la suivante.

## 6. Anciennes structures à migrer

| Élément ancien | Devenir |
|---|---|
| `TODO.md` | Tâches ouvertes versées dans Asana (section, tâche mère « [code] », lignes « Statut : »), puis suppression, ou déplacement dans `archives/TODO_AAAA-MM-JJ.md` quand le dossier interdit la suppression |
| `docs/00-context/system-state.md`, `architecture.md` | Le non-évident va dans `CLAUDE.md` ; le reste se lit dans le code |
| `docs/02-features/*/tech-design.md`, `dev-tasks.md`, `test-plan.md` | Supprimés ; `feature-spec.md` devient une spec dans `docs/` si l'intention est encore utile |
| `docs/03-logs/implementation-log.md` | Supprimé : `git log` tient cet historique |
| `docs/03-logs/decisions-log.md` | Fusionné dans `DECISIONS.md` |
| `docs/03-logs/bug-log.md`, `insights.md` | Les pièges récurrents vont dans `CLAUDE.md` ou le `CLAUDE.md` du sous-dossier concerné ; le reste est archivé ou supprimé |
| Copie de `schema.sql`, migrations ou Edge Functions sous `docs/` | Déplacés vers leur emplacement standard (`supabase/migrations/`, `supabase/functions/`) |
| `.claude/plugins.config.yaml`, `.claude/agent-memory/` | Supprimés : remplacés par `CLAUDE.md` et la mémoire automatique |
| `docs/review/`, `docs/superpowers/plans/` | Supprimés s'ils ne servent plus |

## Sources

- Best practices for Claude Code : https://code.claude.com/docs/en/best-practices
- How Claude remembers your project (CLAUDE.md, `.claude/rules/`, mémoire automatique) : https://code.claude.com/docs/en/memory
- Skills : https://code.claude.com/docs/en/skills
- Commandes (`/doctor`, `/claude-api`) : https://code.claude.com/docs/en/commands
- Prompting best practices : https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Prompting Claude Opus 5.5 : https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
- Coding sessions are longer and use more context. Claude Opus 5.5 is built with that in mind : https://claude.com/blog/claude-opus-5-5-built-for-coding-sessions-that-use-more-context
- Getting the most out of Opus 5.5 in Claude and Claude Code : https://claude.dev/blog/getting-the-most-out-of-opus-5-5/ (page non lue directement : l'accès était bloqué ; les trois conseils repris ici viennent des extraits de recherche, à confirmer sur la page)
- Effective harnesses for long-running agents (26 novembre 2025) : https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Skill `claude-api`, guide `shared/prompt-audit.md` (fourni avec Claude Code, version 2.1.283 consultée)
