"""Imprime les règles des outils de l'app Claude Desktop dont dépendent des textes de flow-board.

    python3 -I scripts/regles-app.py [--asar <chemin de app.asar>]

Lit `app.asar` de l'app installée (sur le Mac, /Applications/Claude.app/Contents/Resources/app.asar
seul ; ailleurs, le chemin se donne par --asar) et imprime la version de l'app, puis, pour
`start_session`, `archive_session` et `set_session_title`, leur description et leurs messages de refus.
Lecture seule. À relancer après une mise à jour de l'app : docs/regles-app-desktop.md relie chaque
règle au texte de flow-board qui en dépend.

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
import re
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
    except ValueError:
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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--asar", metavar="CHEMIN", help="le fichier app.asar de l'app (sur le Mac, trouvé seul)")
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
    print(report(rules, asar))
    return 0


if __name__ == "__main__":
    sys.exit(main())
