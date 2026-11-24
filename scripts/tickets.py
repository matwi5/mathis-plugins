#!/usr/bin/env python3
"""Cherche des termes dans les tickets pas encore faits de toutes les missions, et rend tous les résultats.

    python3 scripts/tickets.py [--tous] [--entier] <terme>...

Avant de toucher un symbole, trouver les tickets ouverts d'autres missions qui le nomment avait pris six
minutes de `grep` dans `travail/*/issues`. Le script lit les tickets `travail/<mission>/issues/*.md` du
clone principal, celui où les missions écrivent leurs tickets, même lancé depuis un worktree lié (dont la
copie date du départ de sa branche) ; le dépôt est celui du dossier courant.

Chaque terme est un texte littéral, cherché sans tenir compte de la casse ; un ticket qui en nomme au moins un
est listé une fois. Les tickets se rendent groupés par mission (le dossier sous `travail/`), chacun avec son
numéro (le début du nom de son fichier), son titre (sa première ligne « # … », sans le numéro) et son statut
(sa ligne `**Status:**`, `Status:`, `**Statut :**` ou `Statut :`, hors des blocs de code, lue dans le
vocabulaire `STATUS_VOCABULARY` de `check.py`), puis chaque ligne trouvée avec son numéro, et enfin le total.
Un ticket fait (fait, done, terminé) ou retiré n'est pas listé, sauf avec `--tous` ; un ticket sans ligne de
statut, ou dont la valeur est hors du vocabulaire, est listé et dit « statut illisible ». Aucun résultat
n'est omis : une ligne de plus de 300 signes est coupée autour du premier terme qu'elle porte, avec la marque
« … (coupée) », et `--entier` la rend entière. Aucun ticket : « aucun ticket ouvert ne nomme … », code 0.

Lecture seule : le script n'écrit rien, et un terme n'entre dans aucune commande ni aucun chemin (les
fichiers se trouvent par un motif fixe). Codes : 0 recherche faite (résultats ou non), 1 git absent ou plus
ancien que 2.36, ou dossier courant hors d'un dépôt, 2 sans terme (l'aide est rendue).
"""

import re
import sys
from pathlib import Path

# `decisions.py`, à côté : la racine du clone principal et la coupe des longues lignes ; `check.py` : la ligne de
# statut d'un ticket et son vocabulaire.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from check import STATUS_VOCABULARY, status_line, status_phrase  # noqa: E402
from decision import DecisionError, check_git_version  # noqa: E402
from decisions import repo_root, shown  # noqa: E402

USAGE = "python3 scripts/tickets.py [--tous] [--entier] <terme>..."
# Un ticket qui n'a plus à se faire : fait (statut « done » du vocabulaire) ou retiré (admis, sans effet).
CLOSED = {value for value, status in STATUS_VOCABULARY.items() if status in ("done", None)}
TITLE = re.compile(r"^#\s+(?:\d+\s*:\s*)?(.*\S)\s*$")
NUMBER = re.compile(r"^(\d+)")


def ticket_files(root):
    """Les fichiers de tickets de `root`, `travail/<mission>/issues/*.md`, dans l'ordre de leurs chemins."""
    return [f for f in sorted((root / "travail").glob("*/issues/*.md")) if f.is_file()]


def describe(path, text):
    """(numéro, titre, statut rendu, fermé) d'un ticket : le statut rendu est « statut : <valeur> » ou
    « statut illisible (…) » ; fermé dit s'il est fait ou retiré."""
    number = NUMBER.match(path.name)
    title = next((m.group(1) for line in text.split("\n") if (m := TITLE.match(line))), path.stem)
    found = status_line(text)
    if found is None:
        return (number.group(1) if number else path.stem), title, "statut illisible (aucune ligne de statut)", False
    value = found[1]
    phrase = status_phrase(value)
    if phrase is None:
        return (number.group(1) if number else path.stem), title, f"statut illisible ({value or 'vide'})", False
    return (number.group(1) if number else path.stem), title, f"statut : {value}", phrase in CLOSED


def search(root, terms, everything, whole):
    """Les tickets qui nomment un des termes : {mission: [(numéro, titre, statut, [(numéro de ligne, ligne
    rendue)])]}, dans l'ordre des chemins ; les tickets fermés omis sauf `everything`."""
    patterns = [re.compile(re.escape(term), re.IGNORECASE) for term in terms]
    found = {}
    for path in ticket_files(root):
        try:
            text = path.read_bytes().decode("utf-8", "replace").replace("\r\n", "\n")
        except OSError as err:
            # Un fichier illisible (droits, retiré entre-temps) se dit à sa place : rien n'est omis en silence.
            hits, described = [(0, f"{type(err).__name__} : {err}")], (path.stem, path.name, "fichier illisible", False)
        else:
            hits = []
            for number, line in enumerate(text.split("\n"), 1):
                match = next((m for p in patterns if (m := p.search(line))), None)
                if match:
                    hits.append((number, shown(line, match, whole)))
            described = describe(path, text)
        if not hits or (described[3] and not everything):
            continue
        mission = path.relative_to(root).parts[1]
        found.setdefault(mission, []).append((*described[:3], hits))
    return found


def report(terms, found, everything):
    """Le texte rendu."""
    named = ", ".join(f"« {term} »" for term in terms)
    if not found:
        return f"aucun ticket {'' if everything else 'ouvert '}ne nomme {named}"
    total = sum(len(tickets) for tickets in found.values())
    plural = "s" if total > 1 else ""
    out = [f"{named} : {total} ticket{plural}{'' if everything else ' ouvert' + plural}"]
    for mission, tickets in found.items():
        out.append(f"travail/{mission} ({len(tickets)} ticket{'s' if len(tickets) > 1 else ''})")
        for number, title, status, hits in tickets:
            out.append(f"  {number} · {title} · {status}")
            out.extend(f"    {line_number} : {line}" for line_number, line in hits)
    out.append(f"total : {total} ticket{'s' if total > 1 else ''} dans {len(found)} mission{'s' if len(found) > 1 else ''}")
    return "\n".join(out)


def main(argv):
    if argv[:1] in (["--aide"], ["-h"], ["--help"]):
        print(__doc__)
        return 0
    everything, whole = "--tous" in argv, "--entier" in argv
    terms = [a for a in argv if a not in ("--tous", "--entier")]
    if not terms or any(not t.strip() for t in terms):
        print(USAGE, file=sys.stderr)
        print(__doc__, file=sys.stderr)
        return 2
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
    print(f"Tickets {'' if everything else 'ouverts '}de {root}")
    print(report(terms, search(root, terms, everything, whole), everything))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
