#!/usr/bin/env python3
"""Remplace un texte unique dans un fichier, avec assertion.

    python3 scripts/patch.py <fichier> <ancien> <nouveau>
    python3 scripts/patch.py <fichier> @<fichier de l'ancien texte> @<fichier du nouveau texte>

Pour une édition que l'outil Edit ne peut pas faire et qu'aucun script jetable ne devrait refaire :
un paragraphe trop long, ou une commande composée que le garde-fou d'un worktree refuse (un heredoc
ou un `sed` dont le texte cite git). Un argument qui commence par `@` est lu dans le fichier qu'il
nomme (UTF-8, tel quel, fin de ligne finale comprise : la retirer si le texte n'en a pas) ; `@@`
au début écrit un `@` littéral. L'ancien texte doit paraître exactement une fois : sinon rien
n'est écrit, et le message dit combien de fois il paraît. Le fichier garde son encodage UTF-8 et
ses fins de ligne. Sans dépendance hors de la bibliothèque standard.
"""

import sys
from pathlib import Path


class PatchError(Exception):
    pass


def argument(value):
    """Un argument : le texte lui-même, ou le contenu du fichier qu'il nomme après `@`."""
    if value.startswith("@@"):
        return value[1:]
    if value.startswith("@"):
        path = Path(value[1:])
        if not path.is_file():
            raise PatchError(f"fichier de texte introuvable : {path}")
        return decode(path)
    return value


def decode(path):
    try:
        return path.read_bytes().decode("utf-8")
    except UnicodeDecodeError as err:
        raise PatchError(f"{path} n'est pas en UTF-8 ({err.reason}, octet {err.start}) ; rien n'est écrit")


def patch(path, old, new):
    """Remplace dans `path` l'unique occurrence de `old` par `new` ; rend la ligne où elle commence."""
    path = Path(path)
    if not path.is_file():
        raise PatchError(f"fichier introuvable : {path}")
    if old == "":
        raise PatchError("ancien texte vide")
    text = decode(path)
    count = text.count(old)
    if count != 1:
        raise PatchError(f"{path} : l'ancien texte paraît {count} fois, il doit paraître exactement une fois ; rien n'est écrit")
    at = text.index(old)
    path.write_bytes(text.replace(old, new).encode("utf-8"))
    return text.count("\n", 0, at) + 1


def main(argv):
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    try:
        line = patch(argv[0], argument(argv[1]), argument(argv[2]))
    except PatchError as err:
        print(f"ÉCHEC : {err}", file=sys.stderr)
        return 1
    print(f"{argv[0]} : remplacé (ligne {line})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
