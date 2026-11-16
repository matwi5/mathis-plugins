#!/usr/bin/env python3
"""Cherche des termes dans tous les fichiers de décisions du dépôt, et rend tous les résultats.

    python3 scripts/decisions.py [--entier] <terme>...

Avant une question qui touche une règle commune, une clé de réglage ou une décision de conception, la
recherche dans les fichiers de décisions ne doit rien couper en silence : un `grep … | head -40` avait
fait conclure qu'aucune décision n'existait. Le script lit `travail/*/DECISIONS.md` et
`config/personal/DECISIONS.md` du clone principal, celui où les séries s'écrivent, même lancé depuis un
worktree lié (dont la copie date du départ de sa branche) ; le dépôt est celui du dossier courant.

Pour chaque terme, un texte littéral cherché sans tenir compte de la casse, il rend les lignes trouvées
groupées par fichier, chacune avec son numéro, le titre de la série où elle se trouve (« ## Série <n> — … »,
ou « avant la première série ») et les ids de décision qu'elle porte (« Q3 », « R80 », « C7 »), puis le
compte par fichier et le total. Aucun résultat n'est omis : une ligne de plus de 300 signes est coupée autour
du terme, avec la marque « … (coupée) », et `--entier` la rend entière. Aucun résultat : « aucune décision
ne porte « <terme> » », code 0. Lecture seule : le script n'écrit rien, et le terme n'entre dans aucune
commande. Codes : 0 recherche faite (résultats ou non), 1 git absent ou plus ancien que 2.36, ou dépôt
introuvable, 2 mauvais arguments.
"""

import re
import subprocess
import sys
from pathlib import Path

# `decision.py`, à côté : la racine vérifiée du clone principal.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from decision import DecisionError, check_git_version, git_env, main_clone  # noqa: E402

USAGE = "python3 scripts/decisions.py [--entier] <terme>..."
LONG_LINE = 300
# Ce qui se garde de part et d'autre du terme dans une ligne coupée.
CONTEXT = 120
CUT_MARK = "… (coupée)"
SERIES = re.compile(r"^## Série \d+\b.*$")
# Un id de décision : une lettre majuscule suivie d'un à trois chiffres, mot entier (« Q3 », « R80 », « C7 »).
DECISION_ID = re.compile(r"(?<![\w-])[A-Z]\d{1,3}(?![\w-])")


def repo_root(cwd):
    """La racine du clone principal du dépôt de `cwd` (celle d'un worktree lié est remplacée par lui) ; sans
    clone principal vérifiable (dépôt nu, `--separate-git-dir`), la racine de l'arbre de `cwd` ; None hors
    d'un dépôt."""
    found = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"],
                           cwd=cwd, capture_output=True, text=True, env=git_env())
    if found.returncode != 0:
        return None
    common, top = found.stdout.strip().split("\n")[:2]
    return main_clone(Path(common).resolve()) or Path(top).resolve()


def decision_files(root):
    """Les fichiers de décisions de `root`, dans l'ordre de leurs chemins."""
    files = sorted((root / "travail").glob("*/DECISIONS.md"))
    personal = root / "config" / "personal" / "DECISIONS.md"
    return ([personal] if personal.is_file() else []) + [f for f in files if f.is_file()]


def shown(line, match, whole):
    """La ligne telle qu'elle se rend : entière, ou coupée autour du terme quand elle passe `LONG_LINE`."""
    if whole or len(line) <= LONG_LINE:
        return line
    start, end = max(0, match.start() - CONTEXT), min(len(line), match.end() + CONTEXT)
    return ("…" if start else "") + line[start:end] + CUT_MARK


def search(root, term, whole):
    """Les résultats d'un terme : [(chemin relatif, [(numéro, série, ids, ligne rendue)])], fichiers sans
    résultat omis."""
    pattern = re.compile(re.escape(term), re.IGNORECASE)
    found = []
    for path in decision_files(root):
        series, hits = "avant la première série", []
        try:
            text = path.read_bytes().decode("utf-8", "replace")
        except OSError as err:
            # Un fichier illisible (droits, retiré entre-temps) se dit à sa place : rien n'est omis en silence.
            found.append((path.relative_to(root).as_posix(), [(0, "fichier illisible", [], f"{type(err).__name__} : {err}")]))
            continue
        for number, line in enumerate(text.replace("\r\n", "\n").split("\n"), 1):
            if SERIES.match(line):
                series = line.removeprefix("## ").strip()
            match = pattern.search(line)
            if match:
                hits.append((number, series, DECISION_ID.findall(line), shown(line, match, whole)))
        if hits:
            found.append((path.relative_to(root).as_posix(), hits))
    return found


def report(term, found):
    """Le texte rendu pour un terme."""
    total = sum(len(hits) for _, hits in found)
    if not total:
        return f"« {term} » : aucune décision ne porte « {term} »"
    out = [f"« {term} » : {total} ligne{'s' if total > 1 else ''} dans {len(found)} fichier{'s' if len(found) > 1 else ''}"]
    for path, hits in found:
        out.append(f"{path} ({len(hits)})")
        for number, series, ids, line in hits:
            tag = f" · {', '.join(dict.fromkeys(ids))}" if ids else ""
            out.append(f"  {number} · {series}{tag} : {line}")
    out.append(f"total « {term} » : {total}")
    return "\n".join(out)


def main(argv):
    whole = "--entier" in argv
    terms = [a for a in argv if a != "--entier"]
    if argv[:1] in (["--aide"], ["-h"], ["--help"]):
        print(__doc__)
        return 0
    if not terms or any(not t.strip() for t in terms):
        print(USAGE, file=sys.stderr)
        return 2
    # `rev-parse --path-format=absolute` demande git 2.31 : la version se contrôle avant (celle de `decision.py`,
    # 2.36 au moins), pour qu'un git trop ancien ou absent ne se dise pas « pas dans un dépôt ».
    try:
        check_git_version()
    except (DecisionError, OSError) as err:
        print(f"ÉCHEC : git absent ou illisible ({err})" if isinstance(err, OSError) else f"ÉCHEC : {err}",
              file=sys.stderr)
        return 1
    root = repo_root(Path.cwd())
    if root is None:
        print("ÉCHEC : le dossier courant n'est pas dans un dépôt git", file=sys.stderr)
        return 1
    print(f"Fichiers de décisions de {root}")
    print("\n\n".join(report(term, search(root, term, whole)) for term in terms))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
