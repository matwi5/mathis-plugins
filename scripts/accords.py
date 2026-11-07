#!/usr/bin/env python3
"""Relève, après un renommage de vocabulaire, les accords restés à l'ancien nom.

    python3 scripts/accords.py [--fenetre N] <ancien:gn>=<nouveau:gn>... -- <fichiers>

Chaque renommage donne le genre et le nombre de l'ancien mot et du nouveau (`gn` : `ms`, `fs`, `mp` ou
`fp`), par exemple `vague:fs=groupe:ms`. Pour chaque occurrence du nouveau mot dans les fichiers (et de
son pluriel en -s ou -x, qui met les deux mots au pluriel), le script liste, avec le fichier et la ligne :

- un déterminant de l'ancien genre ou nombre juste devant lui (à deux mots au plus : `la groupe`,
  `cette nouveau groupe`) ;
- dans les N mots qui suivent (12 par défaut, `--fenetre`), par-delà la phrase et la ligne, un pronom
  de l'ancien genre ou nombre (`elle`, `celle-ci`, `laquelle`, `elles-mêmes`…) et, quand l'ancien mot
  était féminin et le nouveau ne l'est pas, un participe ou adjectif en -ée ou -ées.

Un relevé, pas une correction : chaque ligne se relit (un pronom peut renvoyer à un autre nom). Une
classe « pronom qui renvoie à l'ancien nom » était revenue quatre fois dans un même lot de renommage,
qu'un relevé limité à la phrase ne voyait pas. Code de sortie : 0 sans relevé, 1 avec, 2 sur une
commande mal formée. Sans dépendance hors de la bibliothèque standard.
"""

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

USAGE = "python3 scripts/accords.py [--fenetre N] <ancien:gn>=<nouveau:gn>... -- <fichiers>"
GN = {"ms": ("m", "s"), "fs": ("f", "s"), "mp": ("m", "p"), "fp": ("f", "p")}
NAMES = {("m", "s"): "masculin singulier", ("f", "s"): "féminin singulier",
         ("m", "p"): "masculin pluriel", ("f", "p"): "féminin pluriel"}
# Les déterminants qui portent un genre ou un nombre (les pluriels n'ont pas de genre).
DETERMINERS = {
    ("m", "s"): {"le", "un", "ce", "cet", "du", "au"},
    ("f", "s"): {"la", "une", "cette"},
    ("m", "p"): {"les", "des", "ces", "aux"},
    ("f", "p"): {"les", "des", "ces", "aux"},
}
PRONOUNS = {
    ("m", "s"): {"il", "celui", "celui-ci", "celui-là", "lequel", "auquel", "duquel", "lui-même"},
    ("f", "s"): {"elle", "celle", "celle-ci", "celle-là", "laquelle", "elle-même"},
    ("m", "p"): {"ils", "ceux", "ceux-ci", "ceux-là", "lesquels", "auxquels", "desquels", "eux", "eux-mêmes"},
    ("f", "p"): {"elles", "celles", "celles-ci", "celles-là", "lesquelles", "auxquelles", "desquelles", "elles-mêmes"},
}
FEMININE_PARTICIPLE = re.compile(r"\w{2,}ées?$")
WORD = re.compile(r"[\w’'-]+")


class UsageError(Exception):
    pass


@dataclass(frozen=True)
class Rename:
    old: str
    old_gn: tuple
    new: str
    new_gn: tuple


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    word: str
    message: str


def parse_rename(text):
    """Un renommage `<ancien:gn>=<nouveau:gn>`."""
    m = re.fullmatch(r"([^\s:=]+):(ms|fs|mp|fp)=([^\s:=]+):(ms|fs|mp|fp)", text)
    if not m:
        raise UsageError(f"renommage hors forme : « {text} » (attendu <ancien:gn>=<nouveau:gn>, gn parmi ms, fs, mp, fp)")
    return Rename(m.group(1), GN[m.group(2)], m.group(3), GN[m.group(4)])


def tokens(text):
    """Les mots du texte avec leur ligne, apostrophes coupées (`l'onglet` donne `l'`, puis `onglet`)."""
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        for m in WORD.finditer(line):
            word = m.group(0)
            cut = max(word.rfind("'"), word.rfind("’"))
            if 0 <= cut < len(word) - 1:
                out.append((n, word[:cut + 1]))
                word = word[cut + 1:]
            out.append((n, word.strip("-")))
    return [(n, w) for n, w in out if w]


def plural(gn):
    return (gn[0], "p")


def occurrence_gn(word, rename):
    """(ancien gn, nouveau gn) pour une occurrence du nouveau mot, None si ce n'en est pas une."""
    low, new = word.lower(), rename.new.lower()
    if low == new:
        return rename.old_gn, rename.new_gn
    if rename.new_gn[1] == "s" and low in (new + "s", new + "x"):
        return plural(rename.old_gn), plural(rename.new_gn)
    return None


def mismatches(renames, paths, window=12):
    """Les accords restés à l'ancien nom, dans l'ordre des fichiers et des lignes."""
    found = []
    for path in paths:
        words = tokens(Path(path).read_text(encoding="utf-8", errors="replace"))
        hits = []
        for i, (_, word) in enumerate(words):
            for rename in renames:
                pair = occurrence_gn(word, rename)
                if pair is None or pair[0] == pair[1]:
                    continue
                old_gn, new_gn = pair
                about = (f"à l'ancien « {rename.old} » ({NAMES[old_gn]}) ; le nouveau « {word} » est {NAMES[new_gn]}")
                for j in range(max(0, i - 2), i):
                    line, det = words[j]
                    if det.lower() in DETERMINERS[old_gn] - DETERMINERS[new_gn]:
                        hits.append((j, Finding(Path(path), line, det, f"déterminant « {det} » accordé {about}")))
                for j in range(i + 1, min(len(words), i + 1 + window)):
                    line, after = words[j]
                    low = after.lower()
                    if low in PRONOUNS[old_gn] - PRONOUNS[new_gn]:
                        hits.append((j, Finding(Path(path), line, after, f"pronom « {after} » accordé {about}")))
                    elif old_gn[0] == "f" and new_gn[0] == "m" and FEMININE_PARTICIPLE.search(low):
                        hits.append((j, Finding(Path(path), line, after, f"accord « {after} » au féminin {about}")))
        seen = set()
        for j, finding in sorted(hits, key=lambda h: h[0]):
            if j not in seen:
                seen.add(j)
                found.append(finding)
    return found


def parse_args(argv):
    if "--" not in argv:
        raise UsageError("séparer les renommages des fichiers par « -- »")
    cut = argv.index("--")
    head, files = argv[:cut], argv[cut + 1:]
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--fenetre", type=int, default=12)
    parser.add_argument("renames", nargs="*")
    try:
        args = parser.parse_args(head)
    except SystemExit:
        raise UsageError("arguments hors forme")
    if not args.renames or not files or args.fenetre < 1:
        raise UsageError("au moins un renommage, une fenêtre d'un mot ou plus, et un fichier")
    missing = [f for f in files if not Path(f).is_file()]
    if missing:
        raise UsageError(f"fichier introuvable : {', '.join(missing)}")
    return [parse_rename(r) for r in args.renames], files, args.fenetre


def main(argv):
    try:
        renames, files, window = parse_args(argv)
    except UsageError as err:
        print(f"ÉCHEC : {err}\n{USAGE}", file=sys.stderr)
        return 2
    found = mismatches(renames, files, window)
    for f in found:
        print(f"{f.path}:{f.line} : {f.message}")
    print(f"{len(found)} accord(s) à relire" if found else "aucun accord resté à l'ancien nom")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
