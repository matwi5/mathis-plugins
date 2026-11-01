#!/usr/bin/env python3
"""Affiche une plage d'un fichier, à partir de la première ligne qui contient un motif.

    python3 scripts/show.py <fichier> <motif> [+N]

Le motif est un texte littéral (ni expression régulière, ni joker) : la plage commence à la première
ligne qui le contient et compte N lignes de plus (30 sans `+N`), chacune précédée de son numéro et
d'une tabulation, comme l'outil Read. Les autres lignes qui le contiennent sont citées à la fin. Pour
lire une plage sans `grep -n` suivi d'un `sed -n` au numéro recopié, ni valeur calculée dans la
commande, que le garde-fou d'un worktree refuse. Un motif absent : rien n'est affiché, code 1.
Sans dépendance hors de la bibliothèque standard.
"""

import sys
from pathlib import Path

DEFAULT_AFTER = 30


def show(path, motif, after=DEFAULT_AFTER):
    """Les lignes à afficher (numéro, texte), et les numéros des autres lignes qui contiennent le motif ;
    ValueError si le motif est absent."""
    # Coupé au seul `\n`, comme le compte l'outil Read : `splitlines` couperait aussi à U+2028.
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    lines = [line.rstrip("\r") for line in text.split("\n")]
    if lines and lines[-1] == "":
        lines.pop()
    hits = [n for n, line in enumerate(lines, 1) if motif in line]
    if not hits:
        raise ValueError(f"{path} : motif absent : « {motif} »")
    start = hits[0]
    shown = [(n, lines[n - 1]) for n in range(start, min(len(lines), start + after) + 1)]
    return shown, hits[1:]


def main(argv):
    after = DEFAULT_AFTER
    if len(argv) == 3 and argv[2].startswith("+") and argv[2][1:].isdigit() and int(argv[2][1:]) > 0:
        after = int(argv[2][1:])
    elif len(argv) != 2:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    path, motif = argv[0], argv[1]
    if motif == "":
        print("ÉCHEC : motif vide", file=sys.stderr)
        return 2
    if not Path(path).is_file():
        print(f"ÉCHEC : fichier introuvable : {path}", file=sys.stderr)
        return 1
    try:
        shown, others = show(path, motif, after)
    except ValueError as err:
        print(f"ÉCHEC : {err}", file=sys.stderr)
        return 1
    for n, line in shown:
        print(f"{n}\t{line}")
    if others:
        print(f"(motif aussi ligne{'s' if len(others) > 1 else ''} {', '.join(map(str, others))})")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
