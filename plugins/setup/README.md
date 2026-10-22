# setup

L'installateur de la marketplace `mathis-plugins`. `/setup:install` demande quels plugins installer, vérifie leurs dépendances et prérequis, les installe, règle ce qui doit l'être, et écrit leurs règles dans un `CLAUDE.md`. Rien ne s'écrit avant l'accord sur le plan complet.

Version actuelle : **0.1.1**. Historique des versions : [CHANGELOG.md](CHANGELOG.md).

## Démarrer

```bash
claude plugin marketplace add matwi5/mathis-plugins
claude plugin install setup@mathis-plugins
```

Puis, dans Claude Code : `/setup:install`.

## Ce que fait `/setup:install`

1. **État du poste**, en lecture seule : version de Claude Code, marketplace, plugins déjà installés, `git`, `gh`, Node.js, Python, connecteur Asana, `CLAUDE.md` existants.
2. **Choix** par boutons : le socle (`agents`, `project`, parcours de tickets avec `mattpocock-skills` et `flow-board`), les panneaux (`git-board`, `files-board`, `stats-board`, `session-tools`), le suivi Asana, les règles et l'endroit où les écrire. Les dépendances obligatoires s'ajoutent seules, les conseillées se proposent.
3. **Réglages** des plugins choisis : projet Asana de suivi (lu par le connecteur, jamais créé), dépôt de partage des usages et nom du poste (le dépôt est le vôtre, jamais créé), plein écran pour `files-board`, barre d'état.
4. **Plan** : chaque commande et chaque diff de fichier, montrés en une fois ; accord par boutons.
5. **Exécution** du plan accepté, et rien d'autre ; `settings.json` est sauvegardé avant d'être modifié.
6. **Vérification** et ce qui reste à faire : redémarrer Claude Code pour les mods, autoriser les imports d'un `CLAUDE.md` de projet, brancher le connecteur Asana.

## Le bloc de règles

Les règles vivent dans `config/rules/` du dépôt, une par plugin, plus des règles générales. `/setup:install` ne les recopie pas : il écrit des lignes d'import entre deux marqueurs, ce qui fait suivre les mises à jour de la marketplace.

```markdown
<!-- mathis-plugins:début (écrit par /setup:install ; le relancer pour changer) -->
@~/.claude/plugins/marketplaces/mathis-plugins/config/rules/general.md
@~/.claude/plugins/marketplaces/mathis-plugins/config/rules/agents.md
<!-- mathis-plugins:fin -->
```

Relancer `/setup:install` remplace ce bloc ; le reste du fichier n'est pas touché.

## Fichiers

```
setup/
├── .claude-plugin/plugin.json
├── skills/install/
│   ├── SKILL.md       le déroulé
│   └── catalogue.md   plugins, dépendances, prérequis, réglages, règles
├── README.md
└── CHANGELOG.md
```
