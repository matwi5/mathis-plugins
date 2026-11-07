#!/usr/bin/env python3
"""Affiche une plage d'un fichier, à partir de la première ligne qui contient un motif ; ou chaque
occurrence du motif, avec un extrait borné.

    python3 scripts/show.py <fichier> <motif> [+N]
    python3 scripts/show.py --liste <fichier> <motif>

Le motif est un texte littéral (ni expression régulière, ni joker) : la plage commence à la première
ligne qui le contient et compte N lignes de plus (30 sans `+N`), chacune précédée de son numéro et
d'une tabulation, comme l'outil Read. Les autres lignes qui le contiennent sont citées à la fin. Pour
lire une plage sans `grep -n` suivi d'un `sed -n` au numéro recopié, ni valeur calculée dans la
commande, que le garde-fou d'un worktree refuse. Un motif absent : rien n'est affiché, code 1.

`--liste` donne une ligne par occurrence du motif (plusieurs pour une ligne qui le porte plusieurs
fois) : son numéro, une tabulation, et un extrait de 100 caractères au plus de part et d'autre du
motif, « … » marquant une coupure. Pour chercher dans un fichier aux lignes de plusieurs milliers de
caractères (le README) sans `grep -n … | cut -c1-300`, qui coupe l'extrait avant le motif.
Sans dépendance hors de la bibliothèque standard.
"""

import sys
from pathlib import Path

DEFAULT_AFTER = 30
# Les deux formes de la commande, lues dans la docstring : la plage, puis `--liste`.
USAGE = [line.strip() for line in __doc__.splitlines() if line.strip().startswith("python3 scripts/")]
# Les caractères gardés de part et d'autre du motif dans un extrait de `--liste`.
AROUND = 100


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


def occurrences(path, motif, around=AROUND):
    """Chaque occurrence du motif, dans l'ordre : (numéro de ligne, extrait), l'extrait borné à
    `around` caractères de part et d'autre du motif, « … » marquant une coupure ; ValueError si le
    motif est absent."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    found = []
    for n, line in enumerate(text.split("\n"), 1):
        line = line.rstrip("\r")
        at = line.find(motif)
        while at >= 0:
            start, end = max(0, at - around), min(len(line), at + len(motif) + around)
            found.append((n, ("…" if start else "") + line[start:end] + ("…" if end < len(line) else "")))
            at = line.find(motif, at + len(motif))
    if not found:
        raise ValueError(f"{path} : motif absent : « {motif} »")
    return found


def liste(argv):
    """`--liste <fichier> <motif>` : une ligne par occurrence, son numéro et son extrait."""
    if len(argv) != 2 or argv[1] == "":
        print(USAGE[1], file=sys.stderr)
        return 2
    path, motif = argv
    if not Path(path).is_file():
        print(f"ÉCHEC : fichier introuvable : {path}", file=sys.stderr)
        return 1
    try:
        found = occurrences(path, motif)
    except ValueError as err:
        print(f"ÉCHEC : {err}", file=sys.stderr)
        return 1
    for n, extract in found:
        print(f"{n}\t{extract}")
    return 0


def main(argv):
    if argv[:1] == ["--liste"]:
        return liste(argv[1:])
    after = DEFAULT_AFTER
    if len(argv) == 3 and argv[2].startswith("+") and argv[2][1:].isdigit() and int(argv[2][1:]) > 0:
        after = int(argv[2][1:])
    elif len(argv) != 2:
        print(USAGE[0], file=sys.stderr)
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
