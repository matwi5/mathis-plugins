"""Imprime les règles des outils de l'app Claude Desktop dont dépendent des textes de flow-board.

    python3 -I scripts/regles-app.py [--asar <chemin de app.asar>] [--garder <dossier>]

Lit `app.asar` de l'app installée (sur le Mac, /Applications/Claude.app/Contents/Resources/app.asar
seul ; ailleurs, le chemin se donne par --asar) et imprime la version de l'app, puis, pour
`start_session`, `archive_session` et `set_session_title`, leur description et leurs messages de refus.
Sans --garder, lecture seule. À relancer après une mise à jour de l'app : docs/regles-app-desktop.md
relie chaque règle au texte de flow-board qui en dépend.

`--garder <dossier>` garde aussi la sortie imprimée, telle quelle (en UTF-8, fins de ligne `\\n`), dans
`<dossier>/<version>.txt`, pour comparer une version à la précédente ; ses messages vont sur la sortie
d'erreur, la sortie standard restant le rapport seul. La version n'entre dans le nom que si elle est
faite de 2 à 4 nombres ASCII séparés par des points ; sinon rien n'est écrit. Le dossier donné est
créé s'il manque (lui seul, pas ses parents, par son chemin), et refusé s'il est un lien ou autre chose
qu'un dossier (ses parents ne sont pas vérifiés : ils font partie du chemin donné) ; il est ensuite
ouvert sans suivre de lien, et toutes les écritures dans le dossier se font par rapport à lui (`dir_fd`),
jamais par un chemin rebâti. Là où le système ne le permet pas (Windows), --garder est refusé, sans
rien écrire. La première sortie d'une version s'écrit dans un temporaire du dossier, puis prend
son nom par un lien dur, qui échoue si le nom existe déjà : un fichier gardé n'est jamais écrasé.
Déjà gardée à l'identique (octet pour octet) : rien n'est réécrit. Gardée avec un autre contenu : le
fichier reste tel quel, la nouvelle sortie va dans `<version>.nouveau.txt` (réécrit à chaque fois, par
un renommage, jamais par une écriture dans l'ancien fichier), et le script sort en erreur. Un fichier
`<version>.txt` qui est un lien ou pas un fichier ordinaire : refusé, rien n'est écrit ; de même pour
`<version>.nouveau.txt` quand il faudrait l'écrire (sortie identique : il est seulement signalé, s'il
est là). Les temporaires de la session sont retirés à toute sortie, et le message dit celui qui reste. Toute erreur de --garder sort en code 1 ; la lecture de l'archive garde ses codes.

Le code de l'app est minifié et ses noms changent d'une version à l'autre : la description d'un outil
se retrouve par son alias (`X="start_session"`, puis `{name:X,description:…,inputSchema:`), ou, quand
un autre fichier déclare l'outil (app 4.23118.0), par le nom sous lequel le fichier de l'alias l'exporte
(`{name:t.y_,description:…`, `t` le module requis de ce fichier) ; un message
de refus, par une phrase repère fixée ici (REFUSAL_MARKERS), dont le texte entier est imprimé. Un repère
introuvable est dit : la règle a peut-être changé, et le texte se relit dans app.asar. Bibliothèque
standard seule.
"""

import argparse
import json
import os
import re
import shlex
import stat
import struct
import sys
import textwrap
from pathlib import Path

# Sous Windows, une sortie redirigée prend l'encodage local (cp1252), qui n'a pas « → » (cité par la
# description d'`archive_session`) : le script y échouait à l'impression.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DEFAULT_ASAR = Path("/Applications/Claude.app/Contents/Resources/app.asar")
TOOLS = ("start_session", "archive_session", "set_session_title")
# La seule forme de version qui entre dans un nom de fichier de `--garder` : 2 à 4 nombres ASCII séparés
# par des points (ni `\d`, qui prend les chiffres Unicode, ni `$`, qui laisse passer un saut de ligne final).
VERSION = re.compile(r"[0-9]{1,10}(?:\.[0-9]{1,10}){1,3}")
# Les écritures de `--garder` se font par rapport au dossier ouvert (`dir_fd`) ; sans lui, --garder est refusé.
# Chaque fonction appelée par rapport au dossier est vérifiée ici (`Folder` renomme par `os.rename`).
USE_DIR_FD = (hasattr(os, "O_DIRECTORY") and hasattr(os, "O_NOFOLLOW")
              and {os.open, os.stat, os.link, os.rename, os.unlink} <= os.supports_dir_fd
              and os.link in os.supports_follow_symlinks)
# Les phrases repères des messages de refus, par outil. Ceux de `set_session_title` portent sur la
# forme du titre ; sa règle d'approbation est dans sa description.
REFUSAL_MARKERS = {
    "start_session": ("Start sessions only on the user's own words",),
    "archive_session": ("was not archived",),
    "set_session_title": ("title must be 1 to", "The title was left unchanged"),
}
IDENT = r"[A-Za-z_$][\w$]*"
QUOTES = "\"'`"
# Ce qui peut précéder le début d'un littéral dans du code : un signe, ou un mot-clé.
BEFORE_LITERAL = re.compile(r"(?:^|[(=,:?+\[!{};&|>]|\b(?:return|throw|case|typeof|void|in|of|await|yield))\s*$")
MAX_LITERAL = 20000
WIDTH = 110


class AsarError(Exception):
    pass


def read_asar(path):
    """Les fichiers d'une archive asar : {"/chemin/interne": contenu}, sans ceux qu'elle garde à côté
    d'elle (`unpacked`). En-tête : la taille du pickle d'en-tête à l'octet 4, la longueur du JSON des
    fichiers à l'octet 12, ce JSON à l'octet 16 ; les contenus commencent après le pickle."""
    data = Path(path).read_bytes()
    try:
        size = struct.unpack_from("<I", data, 4)[0]
        length = struct.unpack_from("<I", data, 12)[0]
        header = json.loads(data[16:16 + length])
    except (struct.error, ValueError) as err:
        raise AsarError(str(err))
    base = 8 + size
    files = {}

    def walk(node, prefix):
        for name, child in node.get("files", {}).items():
            inner = f"{prefix}/{name}"
            if "files" in child:
                walk(child, inner)
            elif "offset" in child and not child.get("unpacked"):
                start = base + int(child["offset"])
                files[inner] = data[start:start + int(child["size"])]

    if not isinstance(header, dict):
        raise AsarError("en-tête sans objet « files »")
    walk(header, "")
    return files


def literal_end(text, start):
    """La fin (exclue) du littéral de chaîne qui commence à `start` ("…", '…' ou `…` avec ses `${…}`
    imbriqués) ; None si ce n'en est pas un."""
    quote, i, limit = text[start], start + 1, min(len(text), start + MAX_LITERAL)
    while i < limit:
        c = text[i]
        if c == "\\":
            i += 2
        elif c == quote:
            return i + 1
        elif c == "\n" and quote != "`":
            return None
        elif quote == "`" and text.startswith("${", i):
            i = expression_end(text, i + 2, limit)
            if i is None:
                return None
        else:
            i += 1
    return None


def expression_end(text, i, limit):
    """La position qui suit le `}` fermant d'une expression `${…}` commencée en `i`."""
    depth = 0
    while i < limit:
        c = text[i]
        if c in QUOTES:
            end = literal_end(text, i)
            if end is None:
                return None
            i = end
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            if depth == 0:
                return i + 1
            depth -= 1
        i += 1
    return None


def unescape(body):
    """Le texte d'un littéral sans ses échappements (\\n, \\uXXXX, \\` …)."""
    def repl(m):
        code = m.group(1)
        if code[0] == "u":
            return chr(int(code.strip("u{}"), 16))
        if code[0] == "x":
            return chr(int(code[1:], 16))
        return {"n": "\n", "t": "\t", "r": ""}.get(code, code)
    text = re.sub(r"\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)", repl, body, flags=re.S)
    # Un caractère hors du plan de base s'écrit en deux `\uXXXX` (une paire de substituts) : les réunir,
    # sans quoi l'impression échoue sur un substitut seul.
    return text.encode("utf-16", "surrogatepass").decode("utf-16", "replace")


def enclosing_literal(text, pos, length):
    """Le texte du plus petit littéral de chaîne qui contient text[pos:pos + length] ; None sans lui."""
    for start in range(pos - 1, max(-1, pos - MAX_LITERAL), -1):
        if text[start] not in QUOTES or not BEFORE_LITERAL.search(text[max(0, start - 10):start]):
            continue
        end = literal_end(text, start)
        if end is not None and end >= pos + length + 1:
            return unescape(text[start + 1:end - 1])
    return None


def assigned_literal(text, name):
    """Le texte du littéral affecté à `name` (`name="…"`, `name=` + gabarit) ; None sans lui."""
    for m in re.finditer(rf"(?<![\w$.]){re.escape(name)}=(?=[{QUOTES}])", text):
        end = literal_end(text, m.end())
        if end is not None:
            return unescape(text[m.end() + 1:end - 1])
    return None


def description(text, tool):
    """Les morceaux de la description d'un outil dans un fichier, [(texte, sous condition)] : le texte
    des variables et des littéraux que somme son champ `description`, chacun marqué s'il est la branche
    d'une condition (`e?qf:""` : `qf`, sous condition ; `e`, la condition, laissée de côté) ; None si
    le fichier ne déclare pas cet outil, ou si aucun morceau de sa description ne s'y lit."""
    for alias in re.finditer(rf"(?<![\w$.])({IDENT})=\"{tool}\"", text):
        m = re.search(rf"\{{name:{re.escape(alias.group(1))},description:(.*?),inputSchema:", text)
        parts = described(m.group(1), text) if m else None
        if parts:
            return parts
    return None


def exported_description(scripts, tool):
    """La description d'un outil déclaré dans un autre fichier que son alias (forme de l'app 4.23118.0) :
    le fichier de l'alias l'exporte (`Object.defineProperty(exports,"y_",{…return aga}})`), un autre le
    requiert (`t=require("./<fichier de l'alias>")`) et déclare l'outil par ce nom (`{name:t.y_,
    description:…,inputSchema:`), sa description lue dans ce second fichier ; None sans cette forme.
    `scripts` : [(chemin interne, texte)]."""
    for path, text in scripts:
        module = re.escape(path.rsplit("/", 1)[-1])
        for alias in re.finditer(rf"(?<![\w$.])({IDENT})=\"{tool}\"", text):
            exports = re.finditer(rf"defineProperty\(exports,\"({IDENT})\",\{{enumerable:!0,get:function\(\){{return {re.escape(alias.group(1))}}}\}}\)", text)
            for exported in exports:
                for other_path, other in scripts:
                    if other_path == path:
                        continue
                    for bound in re.finditer(rf"(?<![\w$.])({IDENT})=require\(\"\./{module}\"\)", other):
                        m = re.search(rf"\{{name:{re.escape(bound.group(1))}\.{re.escape(exported.group(1))},description:(.*?),inputSchema:", other)
                        parts = described(m.group(1), other) if m else None
                        if parts:
                            return parts
    return None


def described(expr, text):
    """Les morceaux d'une expression `description` lue dans `text`, [(texte, sous condition)] (voir
    `description`) ; liste vide si aucun ne s'y lit : une description dont aucun morceau ne se lit est
    dite introuvable, pas imprimée vide."""
    parts, i = [], 0
    while i < len(expr):
        conditional = bool(re.search(r"[?:]\s*$", expr[:i]))
        if expr[i] in QUOTES:
            # Un littéral se lit en entier : ce qu'il contient n'est ni un nom ni un autre littéral.
            end = literal_end(expr, i)
            if end is None:
                break
            found, i = unescape(expr[i + 1:end - 1]), end
        else:
            name = re.match(IDENT, expr[i:]) if not re.match(r"[\w$.]", expr[i - 1:i]) else None
            if name is None:
                i += 1
                continue
            i += name.end()
            # Seul un nom qui vaut lui-même un morceau se résout : pas une condition (`e?`, `e.x?`,
            # `e===1?`, `a&&`), ni un membre ou un appel (`e.x`, `f(…)`), dont un `e="…"` quelconque
            # du fichier donnerait un texte étranger.
            found = assigned_literal(text, name.group(0)) if re.match(r"\s*(?:[+,):]|$)", expr[i:]) else None
        if found:
            parts.append((found, conditional))
    return parts


def app_rules(files):
    """La version de l'app et, par outil, sa description (ses morceaux, et pour chacun s'il est ajouté
    sous condition), ses messages de refus et les repères de refus introuvables."""
    try:
        version = json.loads(files.get("/package.json", b"{}")).get("version")
    except (ValueError, AttributeError):  # pas du JSON, ou pas un objet
        version = None
    named = [(path, data.decode("utf-8", "replace")) for path, data in sorted(files.items()) if path.endswith(".js")]
    scripts = [text for _, text in named]
    tools = {}
    for tool in TOOLS:
        # D'abord l'outil déclaré à côté de son alias (jusqu'à l'app 4.4212.0), puis par le nom exporté
        # de l'alias dans un autre fichier (app 4.23118.0).
        parts = next((p for text in scripts for p in [description(text, tool)] if p is not None), None)
        if parts is None:
            parts = exported_description(named, tool)
        refusals, missing = [], []
        for marker in REFUSAL_MARKERS[tool]:
            found = []
            for text in scripts:
                at = text.find(marker)
                while at != -1:
                    literal = enclosing_literal(text, at, len(marker))
                    if literal and literal not in found:
                        found.append(literal)
                    at = text.find(marker, at + len(marker))
            refusals += [f for f in found if f not in refusals]
            if not found:
                missing.append(marker)
        tools[tool] = {"description": None if parts is None else [text for text, _ in parts],
                       "conditional": None if parts is None else [flag for _, flag in parts],
                       "refusals": refusals, "missing": missing}
    return {"version": version, "tools": tools}


def wrapped(text, indent):
    """Le texte enroulé à WIDTH colonnes, ses sauts de ligne gardés, chaque ligne décalée de `indent`."""
    lines = []
    for paragraph in text.split("\n"):
        lines += textwrap.wrap(paragraph, WIDTH - len(indent)) or [""]
    return "\n".join(indent + line if line else "" for line in lines)


def report(rules, asar):
    out = [f"App Claude {rules['version'] or '(version introuvable)'} — {asar}"]
    for tool, rule in rules["tools"].items():
        out += ["", f"## {tool}", "Description :"]
        parts = rule["description"]
        if parts is None:
            out.append("  introuvable (l'alias ou la forme du code ont changé : relire app.asar)")
        else:
            for part, conditional in zip(parts, rule["conditional"]):
                if conditional:
                    out.append("  (suite, ajoutée sous condition :)")
                out.append(wrapped(part.strip("\n"), "  "))
        out.append("Refus :")
        out += [wrapped(r, "    ").replace("    ", "  - ", 1) for r in rule["refusals"]]
        out += [f"  repère « {m} » introuvable : la règle a peut-être changé, relire app.asar" for m in rule["missing"]]
    return "\n".join(out)


class KeepError(Exception):
    """Une sortie qui ne peut pas être gardée : le message dit pourquoi et ce qui a été écrit."""


class Folder:
    """Le dossier donné à `--garder`, où se font toutes les écritures : ouvert une fois sans suivre un lien
    (`O_DIRECTORY | O_NOFOLLOW`), chaque nom résolu ensuite par rapport à lui (`dir_fd`), jamais par un
    chemin rebâti : un dossier remplacé par un lien après son contrôle ne déplace aucune écriture."""

    def __init__(self, path):
        self.path = path
        self.fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

    def close(self):
        os.close(self.fd)

    def shown(self, name):
        """Le chemin d'un nom du dossier, pour un message."""
        return os.path.join(self.path, name)

    def lstat(self, name):
        """Le `lstat` d'un nom du dossier, ou None s'il est absent."""
        try:
            return os.stat(name, dir_fd=self.fd, follow_symlinks=False)
        except FileNotFoundError:
            return None

    def read(self, name):
        """Les octets d'un fichier ordinaire du dossier, ouvert sans suivre un lien ni bloquer (une FIFO)."""
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0), dir_fd=self.fd)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise KeepError(f"{self.shown(name)} n'est pas un fichier ordinaire ; rien n'est gardé")
            chunks = []
            while chunk := os.read(fd, 1 << 16):
                chunks.append(chunk)
            return b"".join(chunks)
        finally:
            os.close(fd)

    def temporary(self, data, version, temps):
        """Un fichier neuf du dossier qui porte `data`, créé exclusif (`O_EXCL`, sans suivre un lien) et
        écrit sur le disque (`fsync`) ; son nom, qui ne peut pas avoir la forme `<version>.txt`, noté dans
        `temps` dès sa création, pour que `keep` le retire même si l'écriture échoue."""
        name = f".{version}.tmp-{os.getpid()}-{os.urandom(4).hex()}"
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=self.fd)
        temps.append(name)
        try:
            view = memoryview(data)
            while view:
                view = view[os.write(fd, view):]
            os.fsync(fd)
        finally:
            os.close(fd)
        return name

    def discard(self, name):
        """Retire un temporaire de la session ; rend la fin de message à dire s'il reste (son retrait refusé),
        sans lever : le retrait raté d'un temporaire ne change pas ce qui a été gardé."""
        try:
            os.unlink(name, dir_fd=self.fd)
        except FileNotFoundError:
            pass
        except OSError as err:
            return f" (temporaire {self.shown(name)} laissé : {err.strerror})"
        return ""

    def link(self, src, dst):
        """Un second nom `dst` pour `src`, refusé (`FileExistsError`) si `dst` existe déjà : jamais d'écrasement."""
        os.link(src, dst, src_dir_fd=self.fd, dst_dir_fd=self.fd, follow_symlinks=False)

    def rename(self, src, dst):
        """`dst` remplacé par `src` en un renommage : l'ancien fichier de `dst` n'est jamais écrit."""
        os.rename(src, dst, src_dir_fd=self.fd, dst_dir_fd=self.fd)


def open_folder(value):
    """Le dossier donné à `--garder`, ouvert (`Folder`) : refusé s'il est vide, un lien, autre chose qu'un
    dossier, ou absent sous un parent absent ; un dossier absent est créé, seul (pas ses parents), par son
    chemin, avant d'être ouvert ; refusé aussi là où le système n'écrit pas par rapport à un dossier ouvert."""
    if value == "":
        raise KeepError("dossier de --garder vide ; rien n'est gardé")
    if not USE_DIR_FD:
        raise KeepError("ce système ne permet pas d'écrire par rapport au dossier ouvert (dir_fd, Windows) : "
                        "--garder écrirait par des chemins, qu'un dossier remplacé par un lien déplacerait ; "
                        "rien n'est gardé")
    path = str(Path(value))  # sans barre finale : « lien/ » se lit comme le lien, pas comme sa cible
    try:
        try:
            st = os.lstat(path)
        except FileNotFoundError:
            parent = os.path.dirname(os.path.abspath(path))
            if not os.path.isdir(parent):
                raise KeepError(f"{path} : son dossier parent {parent} n'existe pas ; rien n'est gardé")
            try:
                os.mkdir(path)
            except FileExistsError:
                pass
            st = os.lstat(path)
        if stat.S_ISLNK(st.st_mode):
            raise KeepError(f"{path} : refusé, le dossier donné est un lien ; rien n'est gardé")
        if not stat.S_ISDIR(st.st_mode):
            raise KeepError(f"{path} : pas un dossier ; rien n'est gardé")
        return Folder(path)
    except OSError as err:
        raise KeepError(f"{path} : dossier refusé ({err.strerror}) ; rien n'est gardé")


def keep(data, value, version):
    """Garde `data` (la sortie imprimée, en octets) dans `<dossier>/<version>.txt` ; rend le message à dire
    (écrit, ou déjà là à l'identique) ; KeepError si rien n'est gardé, ou si un contenu différent est déjà
    gardé (la nouvelle sortie écrite alors à côté, sous `<version>.nouveau.txt`). Les temporaires de la
    session sont retirés à toute sortie, interruption comprise, et le message dit celui qui reste."""
    if not (isinstance(version, str) and VERSION.fullmatch(version)):
        raise KeepError(f"version de l'app hors forme ({version!r}, attendu des nombres séparés par des points) : "
                        f"rien n'est gardé")
    folder = open_folder(value)
    temps = []

    def discard_all():
        notes = "".join(folder.discard(name) for name in temps)
        temps.clear()
        return notes

    try:
        try:
            message = keep_in(folder, data, version, temps)
        except OSError as err:
            raise KeepError(f"--garder a échoué dans {folder.path} ({err.strerror}) ; "
                            f"{folder.shown(version + '.txt')} n'est pas modifié, rien de neuf n'est gardé")
    except KeepError as err:
        raise KeepError(f"{err}{discard_all()}") from None
    except BaseException:
        discard_all()
        raise
    else:
        return f"{message}{discard_all()}"
    finally:
        folder.close()


def keep_in(folder, data, version, temps):
    """Le travail de `keep` dans le dossier ouvert ; chaque temporaire créé est noté dans `temps`, que
    `keep` retire ensuite."""
    target, fresh = f"{version}.txt", f"{version}.nouveau.txt"
    shown, shown_fresh = folder.shown(target), folder.shown(fresh)
    st = folder.lstat(target)
    temp = None
    if st is None:
        temp = folder.temporary(data, version, temps)
        try:
            folder.link(temp, target)
        except FileExistsError:
            st = folder.lstat(target)  # gardée entre-temps par un autre lancement : comparée ci-dessous
        except OSError as err:
            raise KeepError(f"{shown} : lien dur refusé ({err.strerror}) ; rien n'est gardé")
        else:
            return f"sortie gardée : {shown}"
        if st is None:
            raise KeepError(f"{shown} : déjà pris puis disparu pendant l'écriture (un autre lancement ?) ; "
                            f"rien n'est gardé, relancer")
    if stat.S_ISLNK(st.st_mode):
        raise KeepError(f"{shown} : refusé, c'est un lien ; rien n'est gardé")
    if not stat.S_ISREG(st.st_mode):
        raise KeepError(f"{shown} n'est pas un fichier ordinaire ; rien n'est gardé")
    other = folder.lstat(fresh)
    if folder.read(target) == data:
        stale = f" ; {shown_fresh} existe aussi (une sortie différente d'un lancement précédent ?)" if other else ""
        return f"sortie identique à celle déjà gardée, rien n'est réécrit : {shown}{stale}"
    if other is not None and (stat.S_ISLNK(other.st_mode) or not stat.S_ISREG(other.st_mode)):
        raise KeepError(f"{shown} diffère de cette sortie, et {shown_fresh} est un lien ou pas un fichier "
                        f"ordinaire : refusé, rien n'est gardé")
    if temp is None:
        temp = folder.temporary(data, version, temps)
    try:
        folder.rename(temp, fresh)
    except OSError as err:
        raise KeepError(f"{shown_fresh} : écriture refusée ({err.strerror}) ; {shown} reste tel quel")
    temps.remove(temp)
    raise KeepError(f"{shown} est déjà gardé avec un autre contenu : il n'est pas écrasé ; la nouvelle sortie "
                    f"est dans {shown_fresh} ; comparer : diff {shlex.quote(shown)} {shlex.quote(shown_fresh)}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--asar", metavar="CHEMIN", help="le fichier app.asar de l'app (sur le Mac, trouvé seul)")
    parser.add_argument("--garder", metavar="DOSSIER",
                        help="garde aussi la sortie dans DOSSIER/<version>.txt (un dossier hors de la version publique)")
    args = parser.parse_args(argv)
    if args.asar:
        asar = Path(args.asar)
        if not asar.is_file():
            print(f"{asar} : ce fichier n'existe pas", file=sys.stderr)
            return 2
    elif sys.platform == "darwin" and DEFAULT_ASAR.is_file():
        asar = DEFAULT_ASAR
    else:
        print(f"app.asar de l'app Claude introuvable (cherché sur le Mac seulement : {DEFAULT_ASAR}) : "
              "donner son chemin par --asar <chemin>", file=sys.stderr)
        return 2
    try:
        rules = app_rules(read_asar(asar))
    except (AsarError, OSError) as err:
        print(f"{asar} : pas une archive asar lisible ({err})", file=sys.stderr)
        return 2
    text = report(rules, asar)
    print(text)
    if args.garder is None:
        return 0
    sys.stdout.flush()
    try:
        print(keep((text + "\n").encode("utf-8"), args.garder, rules["version"]), file=sys.stderr)
    except KeepError as err:
        print(err, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
