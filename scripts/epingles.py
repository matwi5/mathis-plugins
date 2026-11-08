#!/usr/bin/env python3
"""Les fichiers de test qui épinglent une phrase de consigne, ou un de ses fragments de 30 signes et plus.

    python3 scripts/epingles.py "<phrase>" [<plugin>]

Cherche dans les dossiers de tests du dépôt (`plugins/*/tests/` et `scripts/tests/`, ou les seuls
`plugins/<plugin>/tests/` quand un plugin est nommé) et donne, pour chaque fichier, chaque ligne qui
porte la phrase ou un fragment d'au moins 30 signes, avec le plus long fragment trouvé. Un calcul à la
demande, à la place d'une table « consigne → tests » écrite à la main qui se périmerait : à lancer avant
de changer une phrase, pour savoir quels tests la recopient.

Les lignes des tests se lisent sans leurs échappements (`\\'`, `\\"`, `` \\` ``, `\\.`… : la barre
oblique devant un signe qui n'est ni une lettre ni un chiffre est retirée), et les blancs se comptent
pour un, des deux côtés. Une phrase de moins de 30 signes se cherche entière.

Sortie 0, « aucun test » compris ; 2 pour un appel mal formé ou un plugin inconnu.
"""

import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIN = 30
SUFFIXES = {".ts", ".tsx", ".mjs", ".js", ".mts", ".py"}


def normal(text):
    """Le texte sans les échappements d'une chaîne de code, les blancs ramenés à une espace."""
    return re.sub(r"\s+", " ", re.sub(r"\\([^0-9A-Za-z])", r"\1", text)).strip()


def test_dirs(plugin):
    if plugin is not None:
        return [ROOT / "plugins" / plugin / "tests"]
    return sorted((ROOT / "plugins").glob("*/tests")) + [ROOT / "scripts" / "tests"]


def fragment(phrase, line, grams):
    """Le plus long fragment de la phrase porté par la ligne, s'il compte au moins `MIN` signes."""
    size = min(MIN, len(phrase))
    if not any(line[i : i + size] in grams for i in range(len(line) - size + 1)):
        return None
    match = SequenceMatcher(None, phrase, line, autojunk=False).find_longest_match(0, len(phrase), 0, len(line))
    return phrase[match.a : match.a + match.size] if match.size >= size else None


def main(argv):
    if len(argv) not in (1, 2) or not argv[0].strip():
        print('usage : python3 scripts/epingles.py "<phrase>" [<plugin>]', file=sys.stderr)
        return 2
    plugin = argv[1] if len(argv) == 2 else None
    if plugin is not None and not (re.fullmatch(r"[a-z0-9][a-z0-9-]*", plugin) and (ROOT / "plugins" / plugin).is_dir()):
        print(f"plugin inconnu : {plugin}", file=sys.stderr)
        return 2
    phrase = normal(argv[0])
    size = min(MIN, len(phrase))
    grams = {phrase[i : i + size] for i in range(len(phrase) - size + 1)}
    found = 0
    for folder in test_dirs(plugin):
        if not folder.is_dir():
            continue
        for path in sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix in SUFFIXES):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except (OSError, UnicodeDecodeError):
                continue
            hits = [(n, f) for n, raw in enumerate(lines, 1) for f in [fragment(phrase, normal(raw), grams)] if f]
            if not hits:
                continue
            found += 1
            print(path.relative_to(ROOT).as_posix())
            for n, f in hits:
                print(f"  {n} : « {f} »")
    print(f"{found} fichier(s) de test" if found else f"aucun test n'épingle cette phrase, ni un fragment de {size} signes et plus")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
