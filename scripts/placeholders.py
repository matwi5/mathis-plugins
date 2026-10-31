"""Les marqueurs « 0.xx.0 » d'un README de plugin que `scripts/bump-version.py` remplace, une seule règle
pour lui et pour le contrôle de `scripts/check.py` (qui dit, pour chaque marqueur signalé, si
`bump-version.py` le remplacera) : deux copies de la règle divergeaient sur les espaces de fin de ligne
et sur deux lignes identiques.

Sans dépendance hors de la bibliothèque standard ; Python 3.9 ou plus récent.
"""

import subprocess
from collections import Counter

# Le marqueur d'une version pas encore connue (« depuis la 0.xx.0 »).
PLACEHOLDER = "0.xx.0"


def git_show(root, spec):
    """Le contenu d'un objet git (`HEAD:<chemin>`, `:<chemin>` pour l'index), tel quel : la sortie
    standard seule, sans la sortie d'erreur ni blancs retirés ; None en échec ou sans dépôt git."""
    try:
        res = subprocess.run(["git", "show", spec], cwd=str(root), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             text=True, encoding="utf-8", errors="replace", timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return res.stdout if res.returncode == 0 else None


def replaced_lines(committed, lines):
    """Les numéros (à partir de 1) des lignes de `lines` (sans fin de ligne) dont `bump-version.py`
    remplace le marqueur : celles que le texte commité `committed` (le README de `HEAD`) porte déjà, à
    l'identique, autant de fois qu'il les porte. Une autre ligne marquée vient d'un texte pas encore
    commité, peut-être d'une autre discussion, qui attend sa propre version."""
    known = Counter(line for line in (committed or "").splitlines() if PLACEHOLDER in line)
    replaced = set()
    for n, line in enumerate(lines, 1):
        if PLACEHOLDER in line and known[line] > 0:
            known[line] -= 1
            replaced.add(n)
    return replaced
