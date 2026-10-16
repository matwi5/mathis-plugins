# CLAUDE.md — mathis-plugins

Marketplace de plugins Claude Code (`plugins/`), règles communes à importer dans un `CLAUDE.md` (`config/rules/`) et barre d'état (`config/statusline.*`). Le mode d'emploi est dans `README.md`.

## Commandes

```bash
claude plugin validate .                    # la marketplace et ses entrées
claude plugin validate plugins/<plugin>     # un plugin
claude plugin test plugins/<plugin>         # tests d'un mod
tsc -p plugins/<plugin>                     # types d'un mod (TypeScript 5.4+)
"$(ls -d "$HOME/Library/Application Support/Claude/claude-code/"*/*/claude.app/Contents/MacOS/claude | sort -V | tail -1)" plugin test plugins/<plugin>   # tests d'un mod avec le Claude Code de l'app desktop (Mac, version la plus récente)
```

Sur Windows (PowerShell), le même test avec le Claude Code de l'app desktop :

```powershell
$desktop = Get-ChildItem "$env:APPDATA\Claude\claude-code" -Directory | Sort-Object { [version]$_.Name } | Select-Object -Last 1
& (Get-ChildItem $desktop.FullName -Recurse -Filter claude.exe | Select-Object -First 1).FullName plugin test plugins/<plugin>
```

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
