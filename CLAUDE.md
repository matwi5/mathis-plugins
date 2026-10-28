# CLAUDE.md — mathis-plugins

Marketplace de plugins Claude Code (`plugins/`), règles communes à importer dans un `CLAUDE.md` (`config/rules/`) et barre d'état (`config/statusline.*`). Le mode d'emploi est dans `README.md`.

## Commandes

```bash
scripts/check.sh <plugin>...                # tous les contrôles d'un plugin, arrêtés au premier échec (scripts\check.cmd sous Windows)
scripts/check.sh --fix <plugin>...          # réécrit l'arbre « Architecture » du README (hooks/ et tests/), commentaires gardés
claude plugin validate .                    # la marketplace et ses entrées
git config core.hooksPath scripts/hooks     # installe le hook pre-commit (validate et tests des plugins touchés)
```

`check.sh` lance, chacun quand il s'applique : le refus des renvois aux tickets et à `travail/`, l'arbre « Architecture » du README (chaque fichier de `hooks/` et `tests/`), les termes retirés du plugin (`termes-retires.txt`), les règles du code (pas de liste étalée dans `Math.min`/`Math.max`, pas de bloc `/** */` détaché), `tsc` par npx (TypeScript fixé dans `scripts/check.py`), `node --test` des skills, `claude plugin test` avec le Claude Code du terminal puis celui de l'app desktop (le plus récent, trouvé par le script), `claude plugin validate` du plugin puis du dépôt. `--no-desktop` pour un poste sans l'app.

## Règles

- **Version à deux endroits** pour tout changement d'un plugin : `plugins/<plugin>/.claude-plugin/plugin.json` et l'entrée du plugin dans `.claude-plugin/marketplace.json`. `claude plugin validate .` signale un écart. Sans nouvelle version, Claude Code garde l'ancienne copie en cache. Mettre aussi à jour le `CHANGELOG.md` du plugin et la ligne « Version actuelle » de son README.
- **Commits** en anglais, Conventional Commits, avec la portée du plugin : `feat(flow-board): …`.
- **`plugins/mattpocock-skills/` est une copie figée** de l'amont (Matt Pocock, MIT) : ne pas la modifier ; la mettre à jour selon son README.
- **Aucun secret** ni donnée personnelle dans `config/` ou dans un plugin, tests compris.

## Pièges

- Un agent fourni par un plugin s'appelle `<plugin>:<agent>`, ici `agents:explorer`. Ne pas en recréer dans `~/.claude/agents/` : les deux coexisteraient sous deux noms.
- Un plugin ne peut fournir ni `CLAUDE.md`, ni `statusLine`, ni réglages, à part `agent` et `subagentStatusLine`. D'où `config/` et `/setup:install`.
- Les règles et la barre d'état sont lues dans `~/.claude/plugins/marketplaces/mathis-plugins/` : la marketplace doit garder ce nom.
- `.gitattributes` force les fins de ligne LF, sinon `config/statusline.sh` casse sous bash. Ne pas le retirer.
- `flow-board` retrouve `~/.claude` à partir du chemin où il est installé : il doit rester installé sous `~/.claude`.
- **Un mod se teste avec les deux Claude Code : celui du terminal et celui de l'app desktop.** L'app desktop embarque sa propre version, souvent en retard. Elle refuse une prop d'élément ou une API qu'elle ne connaît pas encore, et dessine alors à la place du mod, qui disparaît. Ce binaire est dans `~/Library/Application Support/Claude/claude-code/<version>/<empreinte>/` sur Mac et `%APPDATA%\Claude\claude-code\<version>\<empreinte>\claude.exe` sur Windows ; tester avec la plus récente. Une nouveauté de Claude Code ne s'adopte que quand la version embarquée par l'app la connaît.
- Les tests des mods simulent des chemins Windows par endroits (`C:\w`, `C:/proj`) : à relancer sur Mac avant de conclure qu'un mod y marche.
- `stats-board` pousse lui-même dans le dépôt de partage des usages (`~/.claude/claude-usage`), quand il existe. Ce sont des données d'usage, pas du code. Ne jamais y écrire à la main un autre fichier que celui d'un poste ; le format est le type `Published` de `plugins/stats-board/types/index.d.ts`.
