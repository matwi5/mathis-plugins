#!/usr/bin/env python3
"""Remplace un texte unique dans un fichier, avec assertion ; ou un lot de remplacements, tout ou rien.

    python3 scripts/patch.py <fichier> <ancien> <nouveau>
    python3 scripts/patch.py <fichier> @<fichier de l'ancien texte> @<fichier du nouveau texte>
    python3 scripts/patch.py --lot <fichier de paires>

Pour une édition que l'outil Edit ne peut pas faire et qu'aucun script jetable ne devrait refaire :
un paragraphe trop long, ou une commande composée que le garde-fou d'un worktree refuse (un heredoc
ou un `sed` dont le texte cite git). Un argument qui commence par `@` est lu dans le fichier qu'il
nomme (UTF-8), sans sa fin de ligne finale (`\\n` ou `\\r\\n`) : un texte qui doit finir par une fin
de ligne en met deux dans son fichier ; `@@` au début écrit un `@` littéral. L'ancien texte doit
paraître exactement une fois : sinon rien n'est écrit, et le message dit combien de fois il paraît.
Le fichier garde son encodage UTF-8 et ses fins de ligne. Dans chaque texte (argument, `@fichier`
ou lot), le marqueur `{{u}}` devient `\\u` : l'outil Write change un échappement à quatre chiffres
hexadécimaux en caractère brut, alors que `{{u}}2028` donne l'échappement `\\u2028` tel quel ; le
texte `{{u}}` lui-même s'écrit `{{uu}}` (un `u` de plus, retiré à la lecture).

Le fichier de paires de `--lot`, écrit par Write, sans rien à échapper :

    ::: fichier <chemin>
    ::: ancien
    <ancien texte, sur autant de lignes qu'il faut>
    ::: nouveau
    <nouveau texte>
    ::: fin

Une ligne `::: fichier` vaut pour les paires qui la suivent, jusqu'à la suivante ; le texte d'une
paire est fait des lignes entre ses marqueurs, sans la fin de ligne qui précède le marqueur suivant ;
les lignes vides entre deux paires sont permises, aucun autre texte. Les paires s'appliquent dans
l'ordre, une paire sur le texte que laissent les précédentes. Tout ou rien : si une paire échoue
(ancien texte absent ou non unique, fichier introuvable, lot mal formé), aucun fichier n'est écrit,
et le message liste chaque paire en échec ; une écriture refusée par le système (droits) arrête le
lot, et le message nomme les fichiers déjà écrits. Sans dépendance hors de la bibliothèque standard.
"""

import re
import sys
from pathlib import Path

# Le marqueur qui s'écrit `\u` (voir la docstring), et ses formes échappées : `{{uu}}` s'écrit
# `{{u}}`, `{{uuu}}` s'écrit `{{uu}}`, etc. La barre oblique inverse est donnée par son code.
U_MARKER = re.compile(r"\{\{(u+)\}\}")
U_LITERAL = chr(92) + "u"
# Le préfixe des lignes de marqueur d'un fichier de paires.
MARK = "::: "


class PatchError(Exception):
    pass


def unmark(text):
    """Le texte où chaque marqueur `{{u}}` devient `\\u`, et chaque `{{uu…}}` perd un `u`."""
    return U_MARKER.sub(lambda m: U_LITERAL if m[1] == "u" else "{{" + m[1][1:] + "}}", text)


def strip_final_newline(text):
    if text.endswith("\r\n"):
        return text[:-2]
    return text[:-1] if text.endswith("\n") else text


def argument(value):
    """Un argument : le texte lui-même, ou le contenu du fichier qu'il nomme après `@`, sans sa fin
    de ligne finale ; le marqueur `{{u}}` remplacé."""
    if value.startswith("@@"):
        return unmark(value[1:])
    if value.startswith("@"):
        path = Path(value[1:])
        if not path.is_file():
            raise PatchError(f"fichier de texte introuvable : {path}")
        return unmark(strip_final_newline(decode(path)))
    return unmark(value)


def decode(path):
    try:
        return path.read_bytes().decode("utf-8")
    except UnicodeDecodeError as err:
        raise PatchError(f"{path} n'est pas en UTF-8 ({err.reason}, octet {err.start}) ; rien n'est écrit")


def replace_once(path, text, old, new):
    """Le texte où l'unique occurrence de `old` devient `new`, et la ligne où elle commence."""
    if old == "":
        raise PatchError("ancien texte vide")
    count = text.count(old)
    if count != 1:
        raise PatchError(f"{path} : l'ancien texte paraît {count} fois, il doit paraître exactement une fois ; rien n'est écrit")
    at = text.index(old)
    return text.replace(old, new), text.count("\n", 0, at) + 1


def read_target(path):
    path = Path(path)
    if not path.is_file():
        raise PatchError(f"fichier introuvable : {path}")
    return decode(path)


def patch(path, old, new):
    """Remplace dans `path` l'unique occurrence de `old` par `new` ; rend la ligne où elle commence."""
    text, line = replace_once(path, read_target(path), old, new)
    Path(path).write_bytes(text.encode("utf-8"))
    return line


def pair_text(buffer):
    """Le texte d'une paire, sans la fin de ligne qui précède le marqueur suivant, `\\r\\n` compris :
    un fichier de paires en CRLF gardait sinon un `\\r` final, que `@<fichier>` retire."""
    text = "\n".join(buffer)
    return text[:-1] if text.endswith("\r") else text


def parse_batch(text):
    """Les paires d'un fichier de paires : [(numéro, chemin, ancien, nouveau)] ; PatchError s'il est mal formé."""
    pairs = []
    target = None
    state = None  # None hors d'une paire, sinon "ancien" ou "nouveau"
    old, buffer, start = None, [], 0
    for n, raw in enumerate(text.split("\n"), 1):
        line = raw.rstrip("\r")
        mark = line[len(MARK):] if line.startswith(MARK) else None
        if state is None:
            if mark is not None and mark.startswith("fichier "):
                target = mark[len("fichier "):].strip()
            elif mark == "ancien":
                if not target:
                    raise PatchError(f"lot, ligne {n} : paire sans ligne « {MARK}fichier <chemin> » avant elle")
                state, buffer, start = "ancien", [], n
            elif line.strip():
                raise PatchError(f"lot, ligne {n} : « {MARK}fichier <chemin> » ou « {MARK}ancien » attendu, pas « {line[:60]} »")
        elif mark == "nouveau" and state == "ancien":
            old, state, buffer = pair_text(buffer), "nouveau", []
        elif mark == "fin" and state == "nouveau":
            pairs.append((len(pairs) + 1, target, unmark(old), unmark(pair_text(buffer))))
            state = None
        elif mark in {"fichier", "ancien", "nouveau", "fin"} or (mark or "").startswith("fichier "):
            expected = "nouveau" if state == "ancien" else "fin"
            raise PatchError(f"lot, ligne {n} : « {MARK}{expected} » attendu dans la paire ouverte ligne {start}")
        else:
            buffer.append(raw)
    if state is not None:
        raise PatchError(f"lot : la paire ouverte ligne {start} n'a pas de « {MARK}fin »")
    if not pairs:
        raise PatchError("lot : aucune paire")
    return pairs


def patch_batch(lot):
    """Applique les paires du fichier `lot`, tout ou rien ; rend [(numéro, chemin, ligne)]."""
    if not Path(lot).is_file():
        raise PatchError(f"fichier de paires introuvable : {lot}")
    pairs = parse_batch(decode(Path(lot)))
    # Rangés par chemin résolu : un même fichier nommé deux fois (`a.md`, `./a.md`) garde chaque remplacement.
    texts, done, errors = {}, [], []
    for number, target, old, new in pairs:
        key = Path(target).resolve()
        try:
            if key not in texts:
                texts[key] = read_target(target)
            texts[key], line = replace_once(target, texts[key], old, new)
            done.append((number, target, line))
        except PatchError as err:
            errors.append(f"paire {number} : {err}")
    if errors:
        raise PatchError("aucun fichier écrit :\n  " + "\n  ".join(errors))
    written = []
    for key, text in texts.items():
        try:
            key.write_bytes(text.encode("utf-8"))
        except OSError as err:
            already = ", ".join(map(str, written)) or "aucun"
            raise PatchError(f"écriture de {key} refusée ({err.strerror}) ; fichiers déjà écrits : {already}")
        written.append(key)
    return done


def main(argv):
    try:
        if argv[:1] == ["--lot"] and len(argv) == 2:
            done = patch_batch(argv[1])
            for number, target, line in done:
                print(f"paire {number} : {target} : remplacé (ligne {line})")
            files = len({Path(target).resolve() for _, target, _ in done})
            print(f"{len(done)} remplacement{'s' if len(done) > 1 else ''} dans {files} fichier{'s' if files > 1 else ''}")
            return 0
        if len(argv) != 3 or argv[0] == "--lot":
            print("\n".join(line.strip() for line in __doc__.strip().splitlines()[2:5]), file=sys.stderr)
            return 2
        line = patch(argv[0], argument(argv[1]), argument(argv[2]))
    except PatchError as err:
        print(f"ÉCHEC : {err}", file=sys.stderr)
        return 1
    print(f"{argv[0]} : remplacé (ligne {line})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
