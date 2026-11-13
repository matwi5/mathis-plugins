#!/usr/bin/env python3
"""Remplace un texte unique dans un fichier, avec assertion ; ou un lot de remplacements, tout ou rien ;
ou ajoute un texte à la fin d'un fichier ; ou remplace une plage de lignes vérifiée ; ou déplace un bloc
de lignes d'un fichier à un autre, l'identité prouvée ; ou insère un texte avant ou après une ligne
repère ; ou coche un critère d'un ticket.

    python3 scripts/patch.py <fichier> <ancien> <nouveau>
    python3 scripts/patch.py <fichier> @<fichier de l'ancien texte> @<fichier du nouveau texte>
    python3 scripts/patch.py --lot <fichier de paires>
    python3 scripts/patch.py --append <fichier> <texte>
    python3 scripts/patch.py --plage <fichier> <première ligne> <dernière ligne> <nouveau> --debut <texte> --fin <texte>
    python3 scripts/patch.py --deplace [--essai] <source> <début> <fin> <cible> <ancre>
    python3 scripts/patch.py --insere <fichier> <ancre> <texte> [--avant]
    python3 scripts/patch.py --coche <fichier de ticket> <début du critère> [<note>]

Pour une édition que l'outil Edit ne peut pas faire et qu'aucun script jetable ne devrait refaire :
un paragraphe trop long, ou une commande composée que le garde-fou d'un worktree refuse (un heredoc
ou un `sed` dont le texte cite git). Un argument qui commence par `@` est lu dans le fichier qu'il
nomme (UTF-8), sans sa fin de ligne finale (`\\n` ou `\\r\\n`) : un texte qui doit finir par une fin
de ligne en met deux dans son fichier ; `@@` au début écrit un `@` littéral. L'ancien texte doit
paraître exactement une fois : sinon rien n'est écrit, et le message dit ce qui ne va pas, pour le
corriger sans relire le fichier : un ancien texte absent donne « absent ; ligne la plus proche : <n> :
<texte> », la ligne du fichier la plus proche de sa première ligne (la même mesure que `show.py`) ;
un ancien texte présent plusieurs fois donne « présent N fois, lignes <n1>, <n2>… », la ligne où
commence chaque occurrence.
La forme simple refuse un fichier dont la première ligne est `::: fichier …` (un fichier de paires) :
elle l'aurait modifié au lieu d'appliquer ses paires, et renvoie à `--lot`.
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
(ancien texte absent ou non unique, fichier introuvable, lot mal formé : le message montre alors
l'exemple d'une paire ci-dessus, sur ses six lignes), aucun fichier n'est écrit,
et le message liste chaque paire en échec, avec son numéro et le message d'un remplacement simple
(ses numéros de ligne sont ceux du texte que laissent les paires précédentes du même fichier, et le
message le dit quand une paire précédente l'a changé) ; une écriture refusée (droits, ou un lien apparu
depuis le contrôle) ou coupée arrête le lot, et le message nomme les fichiers déjà écrits, chacun par
le nom que lui donne le lot.

`--append` ajoute le texte (argument, ou `@<fichier>`, marqueur `{{u}}` compris) à la fin du fichier,
suivi d'une fin de ligne, comme un heredoc `cat >> <fichier> <<EOF` que le garde-fou d'un worktree
refuse dès que le texte cite git : les fins de ligne du fichier sont gardées (CRLF s'il en a), une
fin de ligne s'ajoute d'abord si le fichier n'en a pas à sa fin, et un fichier absent est une erreur,
sans création. Un texte argument qui finit déjà par une fin de ligne la perd d'abord, comme un
`@<fichier>`, sans ligne vide de plus ; une seule est retirée (`abc\\n\\n` garde sa ligne vide), et
un texte fait seulement d'une fin de ligne la garde (il ajoute deux fins de ligne, comme avant).

`--plage` remplace les lignes <première> à <dernière> (numérotées comme Read, bornes comprises) par le
nouveau texte, après avoir vérifié que la première ligne porte le texte de `--debut` et la dernière
celui de `--fin` (une sous-chaîne, comme le motif de `show.py`) : une plage qui a bougé est refusée sans
rien écrire, et le message dit sur quelles lignes ces textes se trouvent maintenant. Le nouveau texte
(argument ou `@<fichier>`, marqueur `{{u}}` compris, comme les textes de `--debut` et `--fin`) est coupé
à ses fins de ligne, chaque morceau devenant une ligne écrite à la fin de ligne du fichier (CRLF s'il
en a) : « A\\nB » donne deux lignes, « A\\nB\\n » trois, la dernière vide ; vide, il retire la plage ; une
dernière ligne du fichier sans fin de ligne le reste. Un texte cherché (de `--debut`, `--fin`, <début>,
<fin> ou <ancre>) qui n'est sur aucune ligne donne, comme l'ancien texte d'un remplacement, la ligne
la plus proche.

`--deplace` déplace un bloc de lignes de <source> à <cible> : le bloc va de la ligne qui porte le texte
<début> à celle qui porte <fin> (bornes comprises, chacune la seule de la source à porter son texte,
la même ligne si les deux textes y sont), et s'insère dans <cible> après la seule ligne qui porte
<ancre>. Tout ou rien : un texte absent ou présent sur plusieurs lignes, une fin avant le début, ou une
source qui est aussi la cible arrêtent le script avant toute écriture, avec la raison. Les lignes
insérées prennent les fins de ligne de la cible (une ancre en dernière ligne sans fin de ligne en
reçoit une, comme la dernière ligne du bloc quand il finit la source sans fin de ligne) ; la source
perd ses lignes sans autre changement. Avant d'écrire, puis après avoir relu
les deux fichiers sur le disque, le script prouve que les lignes insérées sont celles du bloc, octet
pour octet (fins de ligne comprises quand les deux fichiers ont les mêmes ; sinon le message dit la
conversion), et que la source n'a perdu que le bloc ; sinon il n'écrit rien, ou remet les deux
fichiers tels qu'avant. Il écrit la cible d'abord, la source ensuite, et une écriture refusée remet ce
qui était déjà écrit. `--essai` dit ce qui serait fait, sans rien écrire.

`--insere` insère le texte (argument ou `@<fichier>`, marqueur `{{u}}` compris ; la fin de ligne finale
d'un texte argument se retire comme pour `--append`), coupé à ses fins de ligne, sur ses propres lignes
juste après l'unique ligne qui porte l'ancre (une sous-chaîne, comme le motif de `show.py`), ou juste
avant avec `--avant` (l'option seulement en dernier argument : ailleurs, un texte), aux fins de ligne du fichier (CRLF s'il en a) : « A\\nB » donne deux lignes. Une
ancre en dernière ligne sans fin de ligne en reçoit une, et la dernière ligne insérée reste sans fin
de ligne, comme le fichier. Une ancre absente ou présente sur plusieurs lignes, ou un texte vide : rien
n'est écrit, et le message donne les lignes trouvées (ou la ligne la plus proche).

`--coche` passe l'unique critère ouvert « `- [ ] <début du critère>…` » (indentation permise) à
« `- [x] …` », et lui ajoute « ` — <note>` » au bout de la ligne quand une note est donnée (sur une
seule ligne) : pour cocher un critère d'un ticket avec le test qui le couvre. Une ligne d'un bloc de
code (entre deux lignes ``` ou ~~~) n'est pas un critère. Un critère absent, déjà coché (`- [x]`), ou un
début commun à plusieurs critères ouverts : rien n'est écrit, et le message donne les lignes ; sauf
quand le texte entier d'un seul d'entre eux est ce début, qui est alors coché.

Chaque mode qui écrit (remplacement simple, `--lot`, `--append`, `--plage`, `--deplace`, `--insere`,
`--coche`) refuse, avant
toute lecture, puis de nouveau juste avant chaque écriture : un chemin dont une composante est `.git`
(casse ignorée, dans le chemin donné comme dans le chemin réel) ; une cible qui est un lien symbolique ;
pour un chemin relatif, un dossier du chemin donné qui en est un, sous le dossier courant (ceux
au-dessus, comme `/var` sur macOS, ne sont pas vérifiés, ni un préfixe qui en sort par `..`, ni les
dossiers d'un chemin absolu). Le refus
nomme le chemin et la raison et n'écrit rien : en `--lot`, aucun fichier, chaque nom de chaque paire
contrôlé ; en `--deplace`, ni la source ni la cible. Le script n'est pas enfermé dans le dépôt : un
fichier ordinaire hors du clone (dossier temporaire d'une session) s'écrit comme avant.
Sans dépendance hors de la bibliothèque standard.
"""

import hashlib
import os
import re
import stat
import sys
from pathlib import Path

# `show.py`, à côté de ce script, donne la mesure de la ligne la plus proche : chemin ajouté à la main
# (un lancement par `python3 -I` n'ajoute pas le dossier du script).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from show import line_list, nearest_text  # noqa: E402

# Le marqueur qui s'écrit `\u` (voir la docstring), et ses formes échappées : `{{uu}}` s'écrit
# `{{u}}`, `{{uuu}}` s'écrit `{{uu}}`, etc. La barre oblique inverse est donnée par son code.
U_MARKER = re.compile(r"\{\{(u+)\}\}")
U_LITERAL = chr(92) + "u"
# Les formes de la commande, lues dans la docstring.
USAGE = [line.strip() for line in __doc__.splitlines() if line.strip().startswith("python3 scripts/")]
# Le préfixe des lignes de marqueur d'un fichier de paires.
MARK = "::: "
# L'exemple d'une paire de la docstring, sur ses six lignes, de « ::: fichier » à « ::: fin » : montré
# après le message d'un lot mal formé (son format avait été deviné faux plusieurs fois).
_doc = __doc__.splitlines()
_first = next((k for k, line in enumerate(_doc) if line.strip().startswith(MARK + "fichier")), None)
# Sans le retrait de la docstring : `parse_batch` refuse un marqueur précédé d'espaces, et l'exemple
# affiché doit se recopier tel quel.
# Un exemple retiré de la docstring ne casse pas l'import : le message s'en passe (un test l'épingle).
EXAMPLE = [] if _first is None else [line.strip() for line in _doc[_first:_first + 6]]


class PatchError(Exception):
    pass


class CutWrite(PatchError):
    """Une écriture coupée après l'ouverture, qui a déjà vidé le fichier : il est à remettre."""


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


def decode(path, outcome="rien n'est écrit"):
    try:
        return path.read_bytes().decode("utf-8")
    except UnicodeDecodeError as err:
        raise PatchError(f"{path} n'est pas en UTF-8 ({err.reason}, octet {err.start}) ; {outcome}")


def replace_once(path, text, old, new):
    """Le texte où l'unique occurrence de `old` devient `new`, et la ligne où elle commence."""
    if old == "":
        raise PatchError("ancien texte vide")
    starts, at = [], text.find(old)
    while at >= 0:
        starts.append(at)
        at = text.find(old, at + len(old))
    if not starts:
        lines = [line.rstrip("\r") for line in text.split("\n")]
        raise PatchError(f"{path} : l'ancien texte est absent{nearest_text(lines, old)} ; rien n'est écrit")
    lines_at = [text.count("\n", 0, at) + 1 for at in starts]
    if len(starts) > 1:
        raise PatchError(f"{path} : l'ancien texte est présent {len(starts)} fois, lignes "
                         f"{line_list(lines_at)} ; il doit paraître exactement une fois ; rien n'est écrit")
    return text.replace(old, new), lines_at[0]


def refusal(path):
    """Pourquoi `path` ne peut pas être écrit, ou None : un chemin dont une composante est `.git` (casse
    ignorée, dans le chemin donné comme dans le chemin réel), une cible qui est un lien symbolique, ou,
    pour un chemin relatif, un dossier du chemin donné qui en est un (sous le dossier courant : ceux
    au-dessus, comme `/var` sur macOS, ne sont pas vérifiés, ni un préfixe qui en sort par `..`, ni les
    dossiers d'un chemin absolu)."""
    path = Path(path)
    try:
        real = path.resolve()
    except (OSError, RuntimeError):
        real = path
    if any(part.casefold() == ".git" for part in (*path.parts, *real.parts)):
        return "chemin d'un dossier .git"
    prefixes = [] if path.is_absolute() else [Path(*path.parts[:i]) for i in range(1, len(path.parts))]
    # Seuls les préfixes strictement sous le dossier courant sont vérifiés, d'après leur chemin absolu
    # lexical : `..` et `../tmp` en sortent (non vérifiés), `../ici/lien` y revient (vérifié). Un préfixe
    # d'avant un `..` (`sous` de `sous/../x`) l'est aussi, et un lien y est refusé avant que `..` le suive.
    cwd = os.path.abspath(os.curdir)
    inside = [p for p in prefixes if os.path.abspath(p).startswith(cwd.rstrip(os.sep) + os.sep)]
    for candidate in (*inside, path):
        try:
            kind = link_kind(candidate)
        except OSError as err:
            return f"chemin illisible ({candidate} : {err.strerror})"
        if kind:
            return f"{kind}{'' if candidate == path else f' ({candidate})'}"
    return None


def link_kind(path):
    """« lien symbolique » ou « jonction ou lien Windows » (`mklink /J`, que `is_symlink` ne voit pas),
    ou None ; un chemin absent n'en est pas un ; une autre erreur de lecture lève."""
    try:
        st = os.lstat(path)
    except (FileNotFoundError, NotADirectoryError):
        return None
    if stat.S_ISLNK(st.st_mode):
        return "lien symbolique"
    # Windows : seuls les points d'analyse qui renvoient ailleurs (lien, jonction) comptent ; un fichier
    # OneDrive ou dédupliqué porte aussi l'attribut, avec une autre étiquette, et reste écrit.
    tags = {getattr(stat, "IO_REPARSE_TAG_SYMLINK", None), getattr(stat, "IO_REPARSE_TAG_MOUNT_POINT", None)} - {None}
    if getattr(st, "st_reparse_tag", 0) in tags:
        return "jonction ou lien Windows"
    return None


def guard(path, outcome):
    """PatchError si `path` ne peut pas être écrit (`refusal`), le message fini par `outcome` (ce qui est
    écrit ou non à ce moment : « rien n'est écrit » avant toute écriture)."""
    why = refusal(path)
    if why:
        raise PatchError(f"{path} : refusé, {why} ; {outcome}")


def read_target(path, outcome="rien n'est écrit"):
    """Le texte d'un fichier à écrire, contrôlé d'abord (`guard`), avant toute lecture ; `outcome` dit, dans
    le message d'un refus, ce qui est écrit ou non à ce moment."""
    guard(path, outcome)
    path = Path(path)
    if not path.is_file():
        raise PatchError(f"fichier introuvable : {path} ; {outcome}")
    return decode(path, outcome)


def write_target(path, text, original=None):
    """Écrit `text` dans le fichier existant `path`, contrôlé de nouveau juste avant, ouvert sans suivre un
    lien (O_NOFOLLOW là où il existe) et sans le créer. Le texte est encodé avant l'ouverture, qui vide le
    fichier ; un refus (contrôle, lien apparu entre-temps, fichier disparu) est une PatchError qui nomme
    le chemin et la raison. Une écriture coupée après l'ouverture (CutWrite) remet `original`, le texte
    d'avant, quand il est donné, et le message dit si elle l'a pu."""
    try:
        write_bytes_checked(path, text)
    except CutWrite as err:
        if original is None:
            raise
        try:
            write_bytes_checked(path, original)
        except PatchError:
            raise CutWrite(f"{err} ; NON REMIS tel qu'avant, à vérifier à la main")
        raise CutWrite(f"{str(err).replace(' ; le fichier est peut-être tronqué', '')} ; remis tel qu'avant")


def write_bytes_checked(path, text):
    """L'écriture de `write_target`, sans la remise d'une écriture coupée."""
    try:
        data = text.encode("utf-8")
    except UnicodeEncodeError as err:
        raise PatchError(f"{path} : le texte n'est pas encodable en UTF-8 ({err.reason}) ; ce fichier n'est pas écrit")
    guard(path, "ce fichier n'est pas écrit")
    flags = os.O_WRONLY | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    try:
        fd = os.open(path, flags)
    except OSError as err:
        raise PatchError(f"{path} : écriture refusée ({err.strerror}) ; ce fichier n'est pas écrit")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
    except OSError as err:
        raise CutWrite(f"{path} : écriture coupée ({err.strerror}) ; le fichier est peut-être tronqué")


def patch(path, old, new):
    """Remplace dans `path` l'unique occurrence de `old` par `new` ; rend la ligne où elle commence. Un
    fichier de paires (première ligne `::: fichier …`) est refusé : la forme simple l'aurait modifié
    au lieu d'appliquer ses paires, que `--lot` applique."""
    current = read_target(path)
    if current.split("\n", 1)[0].rstrip("\r").startswith(MARK + "fichier"):
        raise PatchError(f"{path} est un fichier de paires (première ligne « {MARK}fichier … ») : "
                         f"python3 scripts/patch.py --lot {path} applique ses paires")
    text, line = replace_once(path, current, old, new)
    write_target(path, text, current)
    return line


def append(path, text):
    """Ajoute `text` à la fin de `path`, suivi d'une fin de ligne, comme un heredoc `cat >>` : aux
    fins de ligne du fichier (CRLF s'il en a), après une fin de ligne de plus si le fichier n'en a pas
    à sa fin ; rend le nombre de lignes ajoutées. Un fichier absent est une erreur, sans création."""
    if text == "":
        raise PatchError("texte vide ; rien n'est écrit")
    current = read_target(path)
    newline = "\r\n" if "\r\n" in current else "\n"
    lines = text.replace("\r\n", "\n").split("\n")
    added = newline.join(lines) + newline
    if current and not current.endswith("\n"):
        added = newline + added
    write_target(path, current + added, current)
    return len(lines)


def insert(path, anchor, text, before=False):
    """Insère `text`, coupé à ses fins de ligne, sur ses propres lignes après (ou, avec `before`, avant)
    l'unique ligne de `path` qui porte `anchor`, aux fins de ligne du fichier ; rend (lignes insérées,
    ligne de l'ancre). Une ancre en dernière ligne sans fin de ligne en reçoit une, et la dernière ligne
    insérée reste alors sans fin de ligne, comme le fichier."""
    if anchor == "" or text == "":
        raise PatchError("ancre ou texte vide ; rien n'est écrit")
    current = read_target(path)
    lines = split_lines(current)
    hits, where = located(lines, anchor)
    if len(hits) != 1:
        raise PatchError(f"{path} : ancre « {anchor} » {where} ; elle doit être sur une seule ligne ; rien n'est écrit")
    k = hits[0]
    newline = newline_of(current)
    added = [(line, newline) for line in text.replace("\r\n", "\n").split("\n")]
    if before:
        result = lines[:k - 1] + added + lines[k - 1:]
    else:
        anchor_line = lines[k - 1]
        if anchor_line[1] == "":
            anchor_line, added[-1] = (anchor_line[0], newline), (added[-1][0], "")
        result = lines[:k - 1] + [anchor_line] + added + lines[k:]
    write_target(path, join_lines(result), current)
    return len(added), k


# Un critère de ticket : sa case (ouverte ou cochée), après une indentation, puis son texte.
CRITERION = re.compile(r"(\s*- \[)([ xX])(\] )(.*)")


def check(path, start, note=None):
    """Coche l'unique critère ouvert (« - [ ] <start>… ») de `path` et lui ajoute « — <note> » quand une
    note est donnée ; rend sa ligne. Un critère absent, déjà coché, ou désigné par un début commun à
    plusieurs critères ouverts est refusé, sans rien écrire."""
    if start == "":
        raise PatchError("début du critère vide ; rien n'est écrit")
    if note is not None and (note == "" or "\n" in note or "\r" in note):
        raise PatchError("note vide ou sur plusieurs lignes : elle s'ajoute au bout de la ligne du critère ; "
                         "rien n'est écrit")
    current = read_target(path)
    lines = split_lines(current)
    # Les critères hors des blocs de code (``` ou ~~~) : un exemple cité dans un bloc n'en est pas un.
    candidates, fence = [], None
    for n, (content, _) in enumerate(lines, 1):
        mark = content.lstrip()[:3]
        if mark in ("```", "~~~"):
            fence = None if fence == mark else (fence or mark)
            continue
        if fence is None and (m := CRITERION.fullmatch(content)):
            candidates.append((n, m))
    matches = [(n, m) for n, m in candidates if m[4].startswith(start)]
    opened = [(n, m) for n, m in matches if m[2] == " "]
    # Un critère dont le texte entier est le début donné l'emporte : sinon un critère qui est le début d'un
    # autre ne pourrait jamais être coché.
    exact = [(n, m) for n, m in opened if m[4].rstrip() == start.rstrip()]
    if len(opened) > 1 and len(exact) == 1:
        opened = exact
    open_ = [n for n, _ in opened]
    if not open_:
        done = [n for n, m in matches if m[2] != " "]
        if done:
            raise PatchError(f"{path} : le critère « {start}… » est déjà coché, ligne{'s' if len(done) > 1 else ''} "
                             f"{line_list(done)} ; rien n'est écrit")
        raise PatchError(f"{path} : aucun critère ouvert « - [ ] {start}… »"
                         f"{nearest_text([content for content, _ in lines], start)} ; rien n'est écrit")
    if len(open_) > 1:
        raise PatchError(f"{path} : {len(open_)} critères commencent ainsi, lignes {line_list(open_)} ; "
                         f"donner un début propre à un seul ; rien n'est écrit")
    n, m = opened[0]
    lines[n - 1] = (f"{m[1]}x{m[3]}{m[4]}" + (f" — {note}" if note is not None else ""), lines[n - 1][1])
    write_target(path, join_lines(lines), current)
    return n


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
    text = decode(Path(lot))
    try:
        pairs = parse_batch(text)
    except PatchError as err:
        raise PatchError(f"{err}\nexemple d'une paire :\n" + "\n".join(EXAMPLE))
    # Rangés par chemin résolu : un même fichier nommé deux fois (`a.md`, `./a.md`) garde chaque remplacement.
    # Chaque nom est contrôlé (`guard`), même quand un autre nom du même fichier a déjà été lu : un lien
    # vers un fichier déjà nommé passait sinon sans contrôle. Le fichier s'écrit par le premier nom
    # donné, contrôlé, jamais par son chemin résolu, qui suivrait un lien.
    texts, names, originals, done, errors = {}, {}, {}, [], []
    changed = set()  # les fichiers qu'une paire réussie a déjà changés
    for number, target, old, new in pairs:
        key = Path(target).resolve()
        try:
            if key not in texts:
                texts[key] = originals[key] = read_target(target)
                names[key] = target
            else:
                guard(target, "rien n'est écrit")
            texts[key], line = replace_once(target, texts[key], old, new)
            done.append((number, target, line))
            changed.add(key)
        except PatchError as err:
            note = " (lignes du texte laissé par les paires précédentes)" if key in changed else ""
            errors.append(f"paire {number} : {err}{note}")
    if errors:
        raise PatchError("aucun fichier écrit :\n  " + "\n  ".join(errors))
    written = []
    for key, text in texts.items():
        try:
            write_target(names[key], text, originals[key])
        except PatchError as err:
            already = ", ".join(map(str, written)) or "aucun"
            raise PatchError(f"{err} ; fichiers déjà écrits : {already}")
        written.append(names[key])
    return done


def split_lines(text):
    """Les lignes d'un texte : [(contenu, fin de ligne)], la fin valant `\\r\\n`, `\\n`, ou `""` pour une
    dernière ligne sans fin de ligne ; un texte vide n'a aucune ligne."""
    parts = text.split("\n")
    lines = [(part[:-1], "\r\n") if part.endswith("\r") else (part, "\n") for part in parts[:-1]]
    if parts[-1]:
        lines.append((parts[-1], ""))
    return lines


def join_lines(lines):
    return "".join(content + end for content, end in lines)


def newline_of(text):
    """La fin de ligne d'un fichier : CRLF s'il en a, comme `--append`."""
    return "\r\n" if "\r\n" in text else "\n"


def located(lines, needle):
    """Où se trouve un texte : « sur aucune ligne », « ligne <n> » ou « présent sur N lignes (…) »."""
    hits = [n for n, (content, _) in enumerate(lines, 1) if needle in content]
    if not hits:
        return hits, "sur aucune ligne" + nearest_text([content for content, _ in lines], needle)
    if len(hits) == 1:
        return hits, f"ligne {hits[0]}"
    return hits, f"présent sur {len(hits)} lignes ({line_list(hits)})"


def replace_range(path, first, last, new, start_text, end_text):
    """Remplace les lignes `first` à `last` de `path` par `new`, une fois vérifié que la première porte
    `start_text` et la dernière `end_text` ; rend le nombre de lignes écrites à la place."""
    if start_text == "" or end_text == "":
        raise PatchError("texte de --debut ou de --fin vide ; rien n'est écrit")
    current = read_target(path)
    lines = split_lines(current)
    if not 1 <= first <= last <= len(lines):
        raise PatchError(f"{path} : la plage {first} à {last} sort du fichier ({len(lines)} lignes) ou finit "
                         f"avant de commencer ; rien n'est écrit")
    moved = []
    for n, needle in ((first, start_text), (last, end_text)):
        if needle not in lines[n - 1][0]:
            moved.append(f"la ligne {n} ne porte pas « {needle} » (« {needle} » : {located(lines, needle)[1]})")
    if moved:
        raise PatchError(f"{path} : la plage a bougé : {' ; '.join(moved)} ; rien n'est écrit")
    newline = newline_of(current)
    added = [] if new == "" else [(line, newline) for line in new.replace("\r\n", "\n").split("\n")]
    if added and lines[last - 1][1] == "":
        added[-1] = (added[-1][0], "")
    write_target(path, join_lines(lines[:first - 1] + added + lines[last:]), current)
    return len(added)


def plan_move(source, start_text, end_text, target, anchor):
    """Le déplacement calculé, sans rien écrire : un dict (lignes du bloc, ligne de l'ancre, textes
    d'avant et d'après des deux fichiers, empreinte, conversion des fins de ligne) ; PatchError sinon."""
    if "" in (start_text, end_text, anchor):
        raise PatchError("texte de début, de fin ou d'ancre vide ; rien n'est écrit")
    if Path(source).resolve() == Path(target).resolve():
        raise PatchError(f"{source} et {target} sont le même fichier : le déplacement va d'un fichier à un autre ; "
                         f"rien n'est écrit")
    src, dst = read_target(source), read_target(target)
    s_lines, t_lines = split_lines(src), split_lines(dst)
    errors, found = [], {}
    for label, lines, needle, where in (("début", s_lines, start_text, source), ("fin", s_lines, end_text, source),
                                        ("ancre", t_lines, anchor, target)):
        hits, text = located(lines, needle)
        if len(hits) != 1:
            errors.append(f"{label} « {needle} » : {text} dans {where}")
        else:
            found[label] = hits[0]
    if not errors and found["fin"] < found["début"]:
        errors.append(f"la fin (ligne {found['fin']}) précède le début (ligne {found['début']})")
    if errors:
        raise PatchError("rien n'est écrit :\n  " + "\n  ".join(errors))
    a, b, k = found["début"], found["fin"], found["ancre"]
    block = s_lines[a - 1:b]
    newline = newline_of(dst) if "\n" in dst else newline_of(src)
    inserted = [(content, newline) for content, _ in block]
    anchor_line = t_lines[k - 1] if t_lines[k - 1][1] else (t_lines[k - 1][0], newline)
    new_dst = join_lines(t_lines[:k - 1] + [anchor_line] + inserted + t_lines[k:])
    new_src = join_lines(s_lines[:a - 1] + s_lines[b:])
    moved_bytes = join_lines(block).encode("utf-8")
    ends = {end for _, end in block if end}
    name = {"\r\n": "CRLF", "\n": "LF"}
    others = sorted(name[end] for end in ends - {newline})
    conversion = f"fins de ligne {', '.join(others)} → {name[newline]}" if others else None
    return {"first": a, "last": b, "anchor": k, "block": block, "newline": newline, "src": src, "dst": dst,
            "new_src": new_src, "new_dst": new_dst, "sha": hashlib.sha256(moved_bytes).hexdigest(),
            "conversion": conversion}


def prove_move(plan, new_src, new_dst):
    """Vrai si `new_dst` porte, juste après la ligne de l'ancre, chaque ligne du bloc à l'identique,
    terminée par la fin de ligne de la cible, le reste de la cible inchangé (l'ancre gagnant au plus une
    fin de ligne), et si `new_src` est la source sans le bloc, octet pour octet."""
    k, block, newline = plan["anchor"], plan["block"], plan["newline"]
    before, after = split_lines(plan["dst"]), split_lines(new_dst)
    if len(after) != len(before) + len(block):
        return False
    same = after[k:k + len(block)] == [(content, newline) for content, _ in block]
    anchor_ok = after[k - 1] == before[k - 1] or (before[k - 1][1] == "" and after[k - 1] == (before[k - 1][0], newline))
    kept = after[:k - 1] == before[:k - 1] and after[k + len(block):] == before[k:]
    s_before = split_lines(plan["src"])
    return same and anchor_ok and kept \
        and new_src == join_lines(s_before[:plan["first"] - 1] + s_before[plan["last"]:])


def move(source, start_text, end_text, target, anchor, dry=False):
    """Déplace le bloc, tout ou rien ; rend le plan calculé (rien n'est écrit avec `dry`)."""
    plan = plan_move(source, start_text, end_text, target, anchor)
    if not prove_move(plan, plan["new_src"], plan["new_dst"]):
        raise PatchError("le calcul ne retrouve pas le bloc à l'identique dans la cible ; rien n'est écrit")
    if dry:
        return plan
    written = []
    try:
        for path, new, old in ((target, plan["new_dst"], plan["dst"]), (source, plan["new_src"], plan["src"])):
            try:
                write_target(path, new)
            except CutWrite:
                written.append((path, old))  # déjà vidé : à remettre aussi
                raise
            written.append((path, old))
    except PatchError as err:
        raise PatchError(f"{err} ; {restore(written)}")
    try:
        proved = prove_move(plan, read_target(source, "relecture refusée"), read_target(target, "relecture refusée"))
    except PatchError as err:
        raise PatchError(f"{err} ; {restore(written)}")
    if not proved:
        raise PatchError(f"les fichiers relus sur le disque ne portent pas le déplacement attendu ; {restore(written)}")
    return plan


def restore(written):
    """Remet chaque fichier déjà écrit à son texte d'avant, en sens inverse, et relit chacun ; rend ce
    qui a été constaté, pour le message : les fichiers remis, et ceux qui ne l'ont pas été."""
    failed = []
    for path, text in reversed(written):
        try:
            write_target(path, text)
            if Path(path).read_bytes() != text.encode("utf-8"):
                failed.append(str(path))
        except (OSError, PatchError):
            failed.append(str(path))
    if failed:
        return f"NON REMIS tels qu'avant, à vérifier à la main : {', '.join(failed)}"
    return f"remis tels qu'avant et relus : {', '.join(str(p) for p, _ in written) or 'aucun fichier écrit'}"


def range_main(argv):
    """`--plage <fichier> <première> <dernière> <nouveau> --debut <texte> --fin <texte>`."""
    rest, texts = [], {}
    k = 0
    while k < len(argv):
        if argv[k] in {"--debut", "--fin"} and k + 1 < len(argv) and argv[k] not in texts:
            texts[argv[k]] = argv[k + 1]
            k += 2
        else:
            rest.append(argv[k])
            k += 1
    if len(rest) != 4 or set(texts) != {"--debut", "--fin"} or \
            not all(n.isascii() and n.isdigit() for n in rest[1:3]):
        print(USAGE[4], file=sys.stderr)
        return 2
    path, first, last, new = rest
    count = replace_range(path, int(first), int(last), argument(new), argument(texts["--debut"]),
                          argument(texts["--fin"]))
    print(f"{path} : lignes {first} à {last} remplacées ({count} ligne{'s' if count > 1 else ''} à la place)")
    return 0


def move_main(argv):
    """`--deplace [--essai] <source> <début> <fin> <cible> <ancre>`."""
    dry = "--essai" in argv
    rest = [a for a in argv if a != "--essai"]
    if len(rest) != 5 or argv.count("--essai") > 1:
        print(USAGE[5], file=sys.stderr)
        return 2
    source, start, end, target, anchor = rest
    plan = move(source, argument(start), argument(end), target, argument(anchor), dry)
    count = plan["last"] - plan["first"] + 1
    lines = f"{count} ligne{'s' if count > 1 else ''}"
    if dry:
        print(f"{source} : lignes {plan['first']} à {plan['last']} ({lines}) à retirer ; {target} : à insérer "
              f"après la ligne {plan['anchor']} ; sha256 {plan['sha']} ; essai : rien n'est écrit")
        return 0
    how = f", {plan['conversion']}" if plan["conversion"] else ""
    print(f"{source} : lignes {plan['first']} à {plan['last']} retirées ; {target} : {lines} insérées après la "
          f"ligne {plan['anchor']} ; relus, identiques{how} (sha256 {plan['sha']})")
    return 0


def line_text(value):
    """Un texte de lignes (`--append`, `--insere`) : l'argument, dont la fin de ligne finale se retire comme
    celle d'un `@<fichier>` (une seule, et pas celle d'un texte fait seulement d'une fin de ligne)."""
    text = argument(value)
    if (value.startswith("@@") or not value.startswith("@")) and strip_final_newline(text):
        text = strip_final_newline(text)
    return text


def insert_main(argv):
    """`--insere <fichier> <ancre> <texte> [--avant]`."""
    # `--avant` n'est l'option qu'en dernier : une ancre ou un texte « --avant » restent des textes.
    before = len(argv) == 4 and argv[3] == "--avant"
    rest = argv[:3] if before else argv
    if len(rest) != 3:
        print(USAGE[6], file=sys.stderr)
        return 2
    path, anchor, text = rest
    count, line = insert(path, argument(anchor), line_text(text), before)
    print(f"{path} : {count} ligne{'s insérées' if count > 1 else ' insérée'} {'avant' if before else 'après'} "
          f"la ligne {line}")
    return 0


def check_main(argv):
    """`--coche <fichier de ticket> <début du critère> [<note>]`."""
    if len(argv) not in (2, 3):
        print(USAGE[7], file=sys.stderr)
        return 2
    path, start = argv[0], argument(argv[1])
    line = check(path, start, argument(argv[2]) if len(argv) == 3 else None)
    print(f"{path} : critère coché (ligne {line})")
    return 0


def main(argv):
    try:
        if argv[:1] == ["--plage"]:
            return range_main(argv[1:])
        if argv[:1] == ["--deplace"]:
            return move_main(argv[1:])
        if argv[:1] == ["--insere"]:
            return insert_main(argv[1:])
        if argv[:1] == ["--coche"]:
            return check_main(argv[1:])
        if argv[:1] == ["--lot"] and len(argv) == 2:
            done = patch_batch(argv[1])
            for number, target, line in done:
                print(f"paire {number} : {target} : remplacé (ligne {line})")
            files = len({Path(target).resolve() for _, target, _ in done})
            print(f"{len(done)} remplacement{'s' if len(done) > 1 else ''} dans {files} fichier{'s' if files > 1 else ''}")
            return 0
        if argv[:1] == ["--append"] and len(argv) == 3:
            # Un texte donné en argument perd sa fin de ligne finale, comme un `@<fichier>` : sinon la
            # fin de ligne qu'ajoute `--append` faisait une ligne vide de plus.
            count = append(argv[1], line_text(argv[2]))
            print(f"{argv[1]} : ajouté ({count} ligne{'s' if count > 1 else ''} à la fin)")
            return 0
        if len(argv) != 3 or argv[0] in {"--lot", "--append", "--plage", "--deplace", "--insere", "--coche"}:
            print("\n".join(USAGE), file=sys.stderr)
            return 2
        line = patch(argv[0], argument(argv[1]), argument(argv[2]))
    except PatchError as err:
        print(f"ÉCHEC : {err}", file=sys.stderr)
        return 1
    print(f"{argv[0]} : remplacé (ligne {line})")
    return 0


if __name__ == "__main__":
    # Les messages portent des caractères hors de cp1252 (« → », « … ») : une sortie Windows en cp1252
    # ferait échouer l'affichage après une écriture réussie.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
