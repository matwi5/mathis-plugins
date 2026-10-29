#!/usr/bin/env python3
"""Pose la version d'un plugin du dépôt partout où elle s'écrit.

    python3 scripts/bump-version.py <plugin> <x.y.z>              (python sous Windows)
    python3 scripts/bump-version.py --root <copie> <plugin> <x.y.z>

Met à jour, en gardant la mise en forme de chaque fichier :
1. `plugins/<plugin>/.claude-plugin/plugin.json` (`"version"`) ;
2. l'entrée du plugin dans `.claude-plugin/marketplace.json` (`"version"`) ;
3. la ligne « Version actuelle : **x.y.z** » du README du plugin ;
4. les marqueurs « 0.xx.0 » de ce README (« depuis la 0.xx.0 », écrit quand la version n'était pas
   encore connue), remplacés par la nouvelle version.

Ne touche ni au CHANGELOG (son entrée reste à écrire : `scripts/check.sh` refuse une première entrée
qui diffère de `plugin.json`) ni à la liste « État » d'ETAT_DU_PROJET.md (contrôlée aussi). Un
numéro posé à la main en sept endroits, puis renuméroté après une collision, avait tout refait au `sed`.

Sans dépendance hors de la bibliothèque standard ; Python 3.9 ou plus récent.
"""

import argparse
import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

VERSION = re.compile(r"\d+\.\d+\.\d+(?:-mathis\.\d+)?")
PLACEHOLDER = "0.xx.0"
CURRENT_LINE = re.compile(r"(Version actuelle : \*\*)([^*]+)(\*\*)")
VERSION_FIELD = re.compile(r'("version"\s*:\s*")([^"]*)(")')


class Failed(Exception):
    pass


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def bump_manifest(path, version):
    """Le premier champ `"version"` du `plugin.json` ; rend l'ancienne version."""
    text = path.read_text(encoding="utf-8")
    m = VERSION_FIELD.search(text)
    if not m:
        raise Failed(f"{path} : pas de champ \"version\"")
    write(path, text[:m.start(2)] + version + text[m.end(2):])
    return m.group(2)


def bump_marketplace(path, name, version):
    """Le champ `"version"` de l'entrée du plugin dans la marketplace : celui qui suit son `"name"`,
    avant l'entrée suivante."""
    text = path.read_text(encoding="utf-8")
    entry = re.search(r'"name"\s*:\s*"' + re.escape(name) + r'"', text)
    if not entry:
        raise Failed(f"{path} : pas d'entrée « {name} »")
    end = text.find('"name"', entry.end())
    end = len(text) if end < 0 else end
    m = VERSION_FIELD.search(text, entry.end(), end)
    if not m:
        raise Failed(f"{path} : l'entrée « {name} » n'a pas de champ \"version\"")
    write(path, text[:m.start(2)] + version + text[m.end(2):])
    return m.group(2)


def bump_readme(path, version):
    """La ligne « Version actuelle » et les marqueurs « 0.xx.0 » ; rend (ligne trouvée, marqueurs remplacés)."""
    if not path.is_file():
        return False, 0
    text = path.read_text(encoding="utf-8")
    text, lines = CURRENT_LINE.subn(lambda m: m.group(1) + version + m.group(3), text, count=1)
    markers = text.count(PLACEHOLDER)
    write(path, text.replace(PLACEHOLDER, version))
    return lines == 1, markers


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plugin", help="nom du dossier du plugin, sous plugins/")
    parser.add_argument("version", help="la nouvelle version, x.y.z (ou x.y.z-mathis.n)")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent, help="racine du dépôt (une copie, pour un essai)")
    args = parser.parse_args()
    try:
        if not VERSION.fullmatch(args.version):
            raise Failed(f"version « {args.version} » : x.y.z attendu")
        plugin = args.root / "plugins" / args.plugin
        manifest = plugin / ".claude-plugin" / "plugin.json"
        if not manifest.is_file():
            raise Failed(f"plugin inconnu : {args.plugin} (pas de {manifest})")
        old = bump_manifest(manifest, args.version)
        listed = bump_marketplace(args.root / ".claude-plugin" / "marketplace.json", args.plugin, args.version)
        has_line, markers = bump_readme(plugin / "README.md", args.version)
    except (Failed, OSError) as err:
        print(f"ÉCHEC : {err}")
        sys.exit(1)
    print(f"{args.plugin} : {old} → {args.version}")
    print(f"  plugin.json : {old} → {args.version}")
    print(f"  marketplace.json : {listed} → {args.version}")
    print(f"  README, ligne « Version actuelle » : {'à jour' if has_line else 'absente'}")
    print(f"  README, marqueurs « {PLACEHOLDER} » remplacés : {markers}")
    print(f"Reste à écrire : l'entrée {args.version} du CHANGELOG du plugin, et sa version dans la liste « État » "
          "d'ETAT_DU_PROJET.md s'il en a une ; scripts/check.sh les contrôle.")


if __name__ == "__main__":
    main()
