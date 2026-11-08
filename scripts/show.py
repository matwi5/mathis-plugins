#!/usr/bin/env python3
"""Affiche une plage d'un fichier, à partir de la première ligne qui contient un motif ; ou chaque
occurrence du motif, avec un extrait borné ; ou une déclaration de premier niveau entière.

    python3 scripts/show.py <fichier> <motif> [+N]
    python3 scripts/show.py --liste <fichier> <motif>
    python3 scripts/show.py --decl <fichier> <nom>

Le motif est un texte littéral (ni expression régulière, ni joker) : la plage commence à la première
ligne qui le contient et compte N lignes de plus (30 sans `+N`), chacune précédée de son numéro et
d'une tabulation, comme l'outil Read. Les autres lignes qui le contiennent sont citées à la fin. Pour
lire une plage sans `grep -n` suivi d'un `sed -n` au numéro recopié, ni valeur calculée dans la
commande, que le garde-fou d'un worktree refuse. Un motif absent : rien n'est affiché, code 1, et le
message donne la ligne la plus proche du motif (son numéro et son texte, borné autour du passage
proche), pour corriger le motif sans relire le fichier.

`--liste` donne une ligne par occurrence du motif (plusieurs pour une ligne qui le porte plusieurs
fois) : son numéro, une tabulation, et un extrait de 100 caractères au plus de part et d'autre du
motif, « … » marquant une coupure. Pour chercher dans un fichier aux lignes de plusieurs milliers de
caractères (le README) sans `grep -n … | cut -c1-300`, qui coupe l'extrait avant le motif.

`--decl` affiche la déclaration de premier niveau qui porte ce nom (les mots-clés que reconnaît `DECL`
de `deplace.py`, que ce script importe : exportée ou non), numérotée comme Read, avec les lignes de
commentaire collées au-dessus d'elle (`/** */`, `//`), jusqu'à l'instruction de premier niveau suivante
(sans son commentaire de tête, ni les lignes vides ou de commentaire qui la précèdent). Pour lire une
fonction entière d'un gros module sans deviner un nombre de lignes. Une instruction de premier niveau
commence par un mot (ou `@`) en colonne 0, hors d'un littéral : le lecteur de `deplace.py` (son masque,
qui saute commentaires, chaînes, gabarits et expressions régulières) les trouve. Il ne connaît pas le
JSX : sur un fichier qu'il ne lit pas sans littéral laissé ouvert (un `.tsx`, le plus souvent), la
lecture se fait par lignes, toute ligne en colonne 0 qui commence par un mot ouvrant une instruction ;
une ligne d'un gabarit qui commence ainsi la couperait, et le message prévient quand la déclaration
affichée porte un nombre impair d'accents graves hors de ses lignes de commentaire. Un nom absent (le
message cite les noms déclarés les plus proches) ou déclaré plusieurs fois au premier niveau (le
message donne ses lignes) : rien n'est affiché, code 1.
Sans dépendance hors de la bibliothèque standard.
"""

import difflib
import re
import sys
from pathlib import Path

# `deplace.py`, à côté de ce script, donne l'expression d'une déclaration de premier niveau et son
# lecteur : importés par `--decl` seulement (`declarations`), pour que la plage, `--liste` et les
# messages que `patch.py` importe d'ici marchent même quand `deplace.py` ne se charge pas ; chemin ajouté
# à la main (un lancement par `python3 -I` n'ajoute pas le dossier du script).
sys.path.insert(0, str(Path(__file__).resolve().parent))

DEFAULT_AFTER = 30
# Les formes de la commande, lues dans la docstring, dans son ordre : la plage, `--liste`, puis `--decl`.
USAGE = [line.strip() for line in __doc__.splitlines() if line.strip().startswith("python3 scripts/")]
# Les caractères gardés de part et d'autre du motif dans un extrait de `--liste`.
AROUND = 100
# Les caractères comparés au plus d'un texte cherché, pour la ligne la plus proche, et les caractères
# du texte de cette ligne gardés de part et d'autre du passage proche, dans le message.
NEAR_NEEDLE = 200
NEAR_SHOWN = 80
# Une instruction de premier niveau, à la lecture par lignes : une ligne qui commence en colonne 0 par
# un mot (ou `@`), la règle de `Module.statements` (deplace.py) sans le masque.
STATEMENT = re.compile(r"[A-Za-z_$@]")
# Le groupe de `DECL` (deplace.py) qui porte le nom déclaré.
DECL_NAME = 4
COMMENT = ("//", "/*", "*")
# Les numéros de ligne cités au plus dans un message (« lignes 3, 8, … »), le compte restant entier.
SHOWN_LINES = 10


def line_list(numbers):
    """Les numéros de ligne d'un message, séparés par des virgules, les SHOWN_LINES premiers seulement,
    « … » marquant la suite (un texte court peut paraître des milliers de fois)."""
    shown = ", ".join(map(str, numbers[:SHOWN_LINES]))
    return shown + (", …" if len(numbers) > SHOWN_LINES else "")


def read_lines(path):
    """Les lignes du fichier, coupées au seul `\\n` comme les compte l'outil Read (`splitlines`
    couperait aussi à U+2028), sans leur `\\r` ni la ligne vide qui suit une fin de ligne finale."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    lines = [line.rstrip("\r") for line in text.split("\n")]
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def nearest(lines, needle):
    """La ligne la plus proche du texte cherché, (numéro, extrait), ou None (fichier ou texte vide).

    Le texte cherché est sa première ligne non vide, sans ses blancs de bord, bornée à NEAR_NEEDLE
    caractères : un motif de show.py, ou l'ancien texte de patch.py, est souvent un fragment de ligne.
    Chaque ligne se compare par une fenêtre de la longueur du texte (plus une marge), centrée sur leur
    plus longue sous-chaîne commune : le score est la part du texte retrouvée dans la fenêtre, puis le
    ratio de difflib, puis l'ordre ; une longue ligne n'est donc ni avantagée ni pénalisée par sa
    longueur. L'extrait garde NEAR_SHOWN caractères de part et d'autre de la fenêtre."""
    first = next((part.strip() for part in needle.split("\n") if part.strip()), "")[:NEAR_NEEDLE]
    if not first:
        return None
    size, slack = len(first), max(4, len(first) // 4)
    best = None
    for n, line in enumerate(lines, 1):
        if not line.strip():
            continue
        match = difflib.SequenceMatcher(None, first, line, autojunk=False).find_longest_match(0, size, 0, len(line))
        if match.size == 0:
            continue
        start = max(0, match.b - match.a - slack)
        end = min(len(line), match.b - match.a + size + slack)
        window = difflib.SequenceMatcher(None, first, line[start:end], autojunk=False)
        found = sum(block.size for block in window.get_matching_blocks())
        score = (found / size, window.ratio())
        if best is None or score > best[0]:
            best = (score, n, start, end)
    if best is None:
        return None
    _, n, start, end = best
    line = lines[n - 1]
    a, b = max(0, start - NEAR_SHOWN), min(len(line), end + NEAR_SHOWN)
    return n, ("…" if a else "") + line[a:b] + ("…" if b < len(line) else "")


def nearest_text(lines, needle):
    """La fin d'un message d'absence : « ; ligne la plus proche : <n> : <texte> », ou rien."""
    near = nearest(lines, needle)
    return f" ; ligne la plus proche : {near[0]} : {near[1]}" if near else ""


def show(path, motif, after=DEFAULT_AFTER):
    """Les lignes à afficher (numéro, texte), et les numéros des autres lignes qui contiennent le motif ;
    ValueError si le motif est absent, avec la ligne la plus proche."""
    lines = read_lines(path)
    hits = [n for n, line in enumerate(lines, 1) if motif in line]
    if not hits:
        raise ValueError(f"{path} : motif absent : « {motif} »{nearest_text(lines, motif)}")
    start = hits[0]
    shown = [(n, lines[n - 1]) for n in range(start, min(len(lines), start + after) + 1)]
    return shown, hits[1:]


def occurrences(path, motif, around=AROUND):
    """Chaque occurrence du motif, dans l'ordre : (numéro de ligne, extrait), l'extrait borné à
    `around` caractères de part et d'autre du motif, « … » marquant une coupure ; ValueError si le
    motif est absent, avec la ligne la plus proche."""
    lines = read_lines(path)
    found = []
    for n, line in enumerate(lines, 1):
        at = line.find(motif)
        while at >= 0:
            start, end = max(0, at - around), min(len(line), at + len(motif) + around)
            found.append((n, ("…" if start else "") + line[start:end] + ("…" if end < len(line) else "")))
            at = line.find(motif, at + len(motif))
    if not found:
        raise ValueError(f"{path} : motif absent : « {motif} »{nearest_text(lines, motif)}")
    return found


def declarations(path, lines):
    """Les déclarations de premier niveau : [(nom, première ligne, ligne du mot-clé, dernière ligne,
    peut-être coupée)], numérotées depuis 1. Les débuts d'instruction viennent du masque de deplace.py
    quand il lit le fichier sans littéral laissé ouvert, sinon de la lecture par lignes (voir la
    docstring). La première ligne est celle du commentaire collé au-dessus (lignes contiguës qui
    commencent par `//`, `/*` ou `*`) ; la dernière, la dernière ligne qui n'est ni vide ni de
    commentaire avant le commentaire de tête de l'instruction suivante. « Peut-être coupée » : à la
    lecture par lignes, la déclaration porte un nombre impair d'accents graves hors de ses lignes de
    commentaire (un gabarit dont une ligne commence en colonne 0 par un mot)."""
    from deplace import DECL, Module

    module = Module(Path(path), "\n".join(lines) + "\n")
    is_masked = module.unclosed == 0
    starts = module.statements if is_masked else [k for k, line in enumerate(lines) if STATEMENT.match(line)]

    def is_comment(k):
        # Lu par le masque : une ligne non vide que le masque blanchit est un commentaire (`  * facteur`, une
        # suite d'expression, reste du code ; une expression régulière seule sur sa ligne, blanchie elle aussi,
        # en est exclue) ; lu par lignes, celle qui commence par `//`, `/*` ou `*`.
        if is_masked:
            raw = lines[k].lstrip()
            is_regex = raw.startswith("/") and not raw.startswith(("//", "/*"))
            return bool(raw) and not module.mlines[k].strip() and not is_regex
        return lines[k].lstrip().startswith(COMMENT)

    def head(k):
        while k > 0 and lines[k - 1].strip() and is_comment(k - 1):
            k -= 1
        return k

    found = []
    for at, s in enumerate(starts):
        m = DECL.match(lines[s])
        if not m:
            continue
        following = head(starts[at + 1]) if at + 1 < len(starts) else len(lines)
        end = max(k for k in range(s, max(following, s + 1))
                  if k == s or (lines[k].strip() and not is_comment(k)))
        ticks = sum(lines[k].count("`") - lines[k].count("\\`") for k in range(s, end + 1)
                    if not is_comment(k))
        found.append((m.group(DECL_NAME), head(s) + 1, s + 1, end + 1, not is_masked and ticks % 2 == 1))
    return found


def declaration(path, name):
    """Les lignes (numéro, texte) de la déclaration de premier niveau `name` ; ValueError si elle est
    absente (avec les noms déclarés les plus proches) ou déclarée plusieurs fois au premier niveau."""
    lines = read_lines(path)
    decls = declarations(path, lines)
    mine = [d for d in decls if d[0] == name]
    if not mine:
        close = difflib.get_close_matches(name, sorted({d[0] for d in decls}), n=3, cutoff=0.6)
        hint = f" ; noms proches : {', '.join(close)}" if close else ""
        raise ValueError(f"{path} : aucune déclaration de premier niveau « {name} »{hint}")
    if len(mine) > 1:
        raise ValueError(f"{path} : « {name} » est déclaré {len(mine)} fois au premier niveau, "
                         f"lignes {line_list([d[2] for d in mine])}")
    _, first, _, last, is_cut = mine[0]
    return [(n, lines[n - 1]) for n in range(first, last + 1)], is_cut


def decl(argv):
    """`--decl <fichier> <nom>` : la déclaration entière, numérotée comme Read."""
    if len(argv) != 2 or argv[1] == "":
        print(USAGE[2], file=sys.stderr)
        return 2
    path, name = argv
    if not Path(path).is_file():
        print(f"ÉCHEC : fichier introuvable : {path}", file=sys.stderr)
        return 1
    try:
        shown, is_cut = declaration(path, name)
    except ValueError as err:
        print(f"ÉCHEC : {err}", file=sys.stderr)
        return 1
    for n, line in shown:
        print(f"{n}\t{line}")
    if is_cut:
        print(f"ATTENTION : « {name} » porte un nombre impair d'accents graves, et ce fichier se lit par lignes "
              f"(un littéral que le lecteur ne sait pas fermer) : la déclaration est peut-être coupée à la "
              f"ligne {shown[-1][0]}, dans un gabarit", file=sys.stderr)
    return 0


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
    if argv[:1] == ["--decl"]:
        return decl(argv[1:])
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
