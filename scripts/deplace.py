#!/usr/bin/env python3
"""Déplace des déclarations de premier niveau d'un module `hooks/` d'un plugin vers un autre, imports compris.

    python3 scripts/deplace.py [--essai] <module source> <module cible> <nom>...

Chaque nom désigne une déclaration de premier niveau de la source (`function`, `const`, `let`, `class`,
`enum`, `type`, `interface`, exportée ou non), qui part avec les lignes de commentaire collées au-dessus
d'elle et s'ajoute à la fin de la cible (créée si elle manque), après une ligne vide. Autour du
déplacement, le script :
- réécrit les imports : la cible reçoit ceux dont le code déplacé a besoin (même forme, `import type`
  compris ; une déclaration restée dans la source s'importe de la source), la source perd ceux que seul
  le code déplacé utilisait (`noUnusedLocals` de tsc) et importe de la cible les noms déplacés qu'elle
  utilise encore, et chaque fichier du plugin (hooks et tests) qui importait un nom déplacé de la source
  l'importe de la cible ; une ligne d'import nouvelle se place après le dernier import du fichier ;
- signale, sans les modifier, les renvois : les lignes qui nomment le module source à côté d'un nom
  déplacé (commentaires, textes, documentation du plugin) ;
- prouve l'identité : chaque déclaration, relue dans le nouveau texte de la cible par la même règle de
  bornes, a les mêmes octets qu'avant (sha256 imprimé).

`--essai` fait tout le calcul et l'imprime (dépendances restées dans la source, fichiers qui importent
les noms déplacés, renvois, noms exportés qu'aucun autre fichier ne nommera plus, refus), sans rien
écrire. Tout ou rien : un nom introuvable, une
déclaration déjà présente dans la cible (déclarée ou importée d'ailleurs), un cycle d'imports créé
entre les modules de `hooks/` (`import type` compris), une déclaration non exportée que la source
utilise encore, une dépendance non exportée de la source, un export par défaut, un import `* as` ou
un `export { } from` qui vise un nom déplacé, une source et une cible hors d'un même dossier `hooks/`,
ou une lecture qui déraille (un littéral laissé ouvert dans la source ou la cible, avant ou après,
ou une déclaration restée qui change) arrêtent le script avant toute écriture (code 1), avec la
raison ; un nom importé sous un autre nom (`nom as autre`) par la cible aussi. Les fichiers
s'écrivent cible d'abord, source en dernier ; une écriture refusée remet ceux déjà écrits.

Le lecteur reprend celui du test anti-cycle de flow-board (`tests/modules-sans-cycle.test.mjs`) : il
saute commentaires, chaînes, gabarits (leurs `${…}` relus comme du code) et expressions régulières,
sur un masque de même longueur que la source. Il ne connaît pas le JSX : dans un `.tsx`, seuls les
imports d'en-tête sont lus, sauf pour la source et la cible, qui doivent se lire sans littéral ouvert.
Une instruction de premier niveau commence par un mot en colonne 0 (un accent grave ou une suite
d'expression en colonne 0 continue la précédente). Les usages d'un nom se trouvent par mot dans le
code (une propriété `a.nom`, une clé `{ nom: }`, un membre de type `nom?:` ou la déclaration d'une
méthode `nom() {`, avec ou sans `async`, `static`, `get`, `set`, n'en est pas un ; un appel `nom(…)`,
ou un nom local qui en masque un de premier niveau, si) : l'essai les montre, et `tsc`
(`scripts/check.sh --tsc <plugin>`) les contrôle après coup. Un import ajouté prend le guillemet et le
point-virgule du premier import du fichier qui le reçoit ; sans import, `'…'` sans point-virgule.
Sans dépendance hors de la bibliothèque standard.
"""

import hashlib
import os
import re
import sys
from pathlib import Path

EXTENSIONS = (".ts", ".tsx", ".mts", ".js", ".mjs")
READERS = {".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs"}
TEXTS = READERS | {".md"}
DECL = re.compile(r"(export\s+)?(?:declare\s+)?(default\s+)?(?:async\s+)?(?:abstract\s+)?"
                  r"(function\s*\*?|const\s+enum|const|let|var|class|enum|type|interface|namespace)\s+([A-Za-z_$][\w$]*)")
IMPORT = re.compile(r"import(\s+type\b)?\s*([^'\"]*?)\s*(?:\bfrom\s*)?(['\"])", re.S)
EXPORT_FROM = re.compile(r"export(\s+type\b)?\s*(\{[^}]*\}|\*(?:\s*as\s+[\w$]+)?)\s*from\s*(['\"])", re.S)
WORD = re.compile(r"[A-Za-z_$][\w$]*")
# La fin d'une déclaration de méthode, après la parenthèse fermante de ses paramètres : un type de retour
# éventuel (un nom de type, sans parenthèse ni accolade), puis le corps `{`, sur la même ligne.
# Les mots après lesquels une ligne continue sur la suivante (`extends`, `return`…).
CONTINUING_WORDS = {"extends", "implements", "return", "new", "await", "yield", "typeof", "void", "delete",
                    "in", "of", "instanceof", "case", "throw"}
METHOD_BODY = re.compile(r"[ \t]*(?::[ \t]*[\w$][\w$.<>\[\]|&, \t]*)?\{")
SPECIFIER = re.compile(r"^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$")
REGEX_AFTER = (re.compile(r"(?:^|[(,=:[&|?{};+\-*%~^<>])\s*$"), re.compile(r"(?:^|[^\w$)\]])\s*!\s*$"),
               re.compile(r"(?:^|[^\w$.])(?:return|typeof|instanceof|new|delete|throw|case|do|else|in|of|void|yield|await)\s*$"))


class MoveError(Exception):
    pass


# --- lecture -------------------------------------------------------------------


def mask(source):
    """Le masque de la source, de même longueur : commentaires, corps des chaînes (leurs guillemets
    gardés), texte des gabarits (leurs accents graves gardés, leurs `${…}` relus comme du code) et
    expressions régulières blanchis, sauts de ligne gardés ; et le nombre de littéraux laissés ouverts."""
    out = list(source)
    n = len(source)
    unclosed = 0

    def blank(a, b):
        for k in range(a, min(b, n)):
            if out[k] != "\n":
                out[k] = " "

    def regex_end(i):
        is_in_class = False
        while i < n and source[i] != "\n":
            c = source[i]
            if c == "\\":
                i += 2
            elif is_in_class:
                is_in_class = c != "]"
                i += 1
            elif c == "[":
                is_in_class = True
                i += 1
            elif c == "/":
                i += 1
                while i < n and source[i].isalpha():
                    i += 1
                return i, True
            else:
                i += 1
        return min(i, n), False

    def template(i):
        nonlocal unclosed
        while i < n and source[i] != "`":
            if source[i] == "\\":
                blank(i, i + 2)
                i += 2
            elif source[i] == "$" and i + 1 < n and source[i + 1] == "{":
                blank(i, i + 2)
                i = code(i + 2, True)
            else:
                blank(i, i + 1)
                i += 1
        if i >= n:
            unclosed += 1
            return n
        return i + 1

    def code(i, is_in_template):
        nonlocal unclosed
        depth = 0
        tail = ""
        while i < n:
            c = source[i]
            nxt = source[i + 1] if i + 1 < n else ""
            if c == "/" and nxt == "/":
                end = source.find("\n", i)
                end = n if end == -1 else end
                blank(i, end)
                i = end
            elif c == "/" and nxt == "*":
                end = source.find("*/", i + 2)
                if end == -1:
                    unclosed += 1
                stop = n if end == -1 else end + 2
                blank(i, stop)
                i = stop
                tail += " "
            elif c in "'\"":
                j = i + 1
                while j < n and source[j] != c and source[j] != "\n":
                    j += 2 if source[j] == "\\" else 1
                is_closed = j < n and source[j] == c
                if not is_closed:
                    unclosed += 1
                blank(i + 1, j)
                i = j + 1 if is_closed else min(j, n)
                tail += "x"
            elif c == "`":
                i = template(i + 1)
                tail += "x"
            elif c == "/" and any(p.search(tail) for p in REGEX_AFTER):
                end, is_closed = regex_end(i + 1)
                if not is_closed:
                    unclosed += 1
                blank(i, end)
                i = end
                tail += "x"
            else:
                if is_in_template and c == "{":
                    depth += 1
                elif is_in_template and c == "}":
                    if depth == 0:
                        blank(i, i + 1)
                        return i + 1
                    depth -= 1
                tail += " " if c.isspace() else c
                i += 1
            tail = tail[-12:]
        return i

    code(0, False)
    return "".join(out), unclosed


class Module:
    """Un fichier lu : ses lignes (fin de ligne comprise), son masque, ses déclarations de premier
    niveau et ses imports d'en-tête."""

    def __init__(self, path, text):
        self.path = path
        self.text = text
        self.mask, self.unclosed = mask(text)
        self.lines = text.split("\n")
        self.mlines = self.mask.split("\n")
        self.starts = [0]
        for line in self.lines[:-1]:
            self.starts.append(self.starts[-1] + len(line) + 1)
        depth, self.depth_at = 0, []
        for mline in self.mlines:
            self.depth_at.append(depth)
            for c in mline:
                if c in "([{":
                    depth += 1
                elif c in ")]}":
                    depth = max(0, depth - 1)
        # Une instruction de premier niveau commence par un mot en colonne 0 : l'accent grave qui ferme un
        # gabarit, ou une suite d'expression (`.map(…)`), en colonne 0 aussi, la continue.
        self.statements = [k for k, m in enumerate(self.mlines)
                           if self.depth_at[k] == 0 and re.match(r"[A-Za-z_$@]", m)]
        self.decls = self.read_decls()
        self.imports = self.read_imports()

    def offset(self, line):
        return self.starts[line] if line < len(self.starts) else len(self.text)

    def line_end(self, line):
        """L'offset qui suit la fin de ligne de `line` (la fin du texte pour la dernière)."""
        return self.offset(line + 1) if line + 1 < len(self.lines) else len(self.text)

    def read_decls(self):
        decls = {}
        for at, s in enumerate(self.statements):
            m = DECL.match(self.mlines[s])
            if not m:
                continue
            following = self.statements[at + 1] if at + 1 < len(self.statements) else len(self.lines)
            end = max(k for k in range(s, following) if self.mlines[k].strip())
            first = s
            while first > 0 and not self.mlines[first - 1].strip() \
                    and self.lines[first - 1].lstrip().startswith(("//", "/*", "*")):
                first -= 1
            decls.setdefault(m.group(4), {"exported": bool(m.group(1)), "default": bool(m.group(2)),
                                          "kind": m.group(3), "first": first, "line": s, "end": end})
        return decls

    def chunk(self, name):
        d = self.decls[name]
        return self.text[self.offset(d["first"]):self.line_end(d["end"])]

    def read_imports(self):
        """Les imports et `export … from` d'en-tête : ceux des instructions de premier niveau qui
        précèdent la première autre instruction."""
        found = []
        for s in self.statements:
            at = self.offset(s)
            m = IMPORT.match(self.mask, at) if self.mlines[s].startswith("import") else None
            is_export = False
            if m is None and self.mlines[s].startswith("export"):
                m = EXPORT_FROM.match(self.mask, at)
                is_export = m is not None
            if m is None or (not is_export and self.mask[at + 6:at + 7] == "("):
                break
            quote = m.start(3)
            close = self.mask.find(m.group(3), quote + 1)
            if close == -1:
                break
            end = close + 1
            if self.text[end:end + 1] == ";":
                end += 1
            clause = m.group(2)
            named = None
            braces = re.search(r"\{([^}]*)\}", clause)
            if braces:
                named = [s.strip() for s in braces.group(1).split(",") if s.strip()]
            rest = re.sub(r"\{[^}]*\}", "", clause).strip().strip(",").strip()
            namespace = re.search(r"\*\s*as\s+([\w$]+)", rest)
            default = None if is_export or namespace or not rest else rest.rstrip(",").strip() or None
            # Le retrait d'un spécificateur d'une liste sur plusieurs lignes, gardé à la réécriture.
            indent = re.search(r"\n([ \t]*)\S", braces.group(1)) if braces else None
            found.append({
                "start": at, "end": end, "line": s, "type": bool(m.group(1)), "export": is_export,
                "named": named, "default": default, "namespace": namespace.group(1) if namespace else None,
                "star": is_export and clause.startswith("*"),
                "spec": self.text[quote + 1:close], "quote": m.group(3), "semi": self.text[end - 1] == ";",
                "multiline": braces is not None and "\n" in braces.group(1),
                "indent": indent.group(1) if indent else "  ",
            })
        return found

    def import_end(self):
        """L'offset où placer une ligne d'import nouvelle : après le dernier import d'en-tête."""
        return self.line_end(max(self.text.count("\n", 0, i["end"]) for i in self.imports)) if self.imports else 0


def uses(mask_text, ranges):
    """Les noms employés comme valeurs ou types dans les plages `ranges` d'un masque : ni une
    propriété (`a.nom`), ni une clé d'objet ou un membre de type (`nom:` ou `nom?:` après `{`, `,`,
    `;`, `(` ou en tête de ligne), ni la déclaration d'une méthode (`is_method_declaration`)."""
    found = set()
    for a, b in ranges:
        for m in WORD.finditer(mask_text, a, b):
            i = m.start()
            if i > 0 and mask_text[i - 1] == "." and not mask_text[max(0, i - 3):i] == "...":
                continue
            after = mask_text[m.end():m.end() + 4].lstrip(" \t")
            before = mask_text[:i].rstrip(" \t")[-1:] or "\n"
            if re.match(r"\??:(?!:)", after) and before in "{,;(\n":
                continue
            if is_method_declaration(mask_text, m.start(), m.end()):
                continue
            found.add(m.group(0))
    return found


def continues_expression(mask_text, line_end):
    """La ligne qui finit à `line_end` (son saut de ligne) laisse-t-elle une expression ouverte : un
    opérateur, une parenthèse ou un mot comme `extends` en dernier ? La ligne d'après la continue alors
    (`class A extends\\n  mixin(Base) {` : un appel, pas une méthode). Seuls les blancs sont relus."""
    i = line_end
    while i >= 0 and mask_text[i].isspace():
        i -= 1
    if i < 0:
        return False
    if mask_text[i] in "=([?:!&|+-*/%<>^~.":
        return True
    word = re.search(r"[\w$]+$", mask_text[max(0, i - 15):i + 1])
    return bool(word) and word.group(0) in CONTINUING_WORDS


def is_method_declaration(mask_text, start, end):
    """Le mot de `start` à `end` déclare-t-il une méthode : en tête de membre (après `{`, `,`, `;`, en
    tête de ligne, ou après `async`, `static`, `get`, `set`), suivi de ses paramètres, d'un type de
    retour éventuel (un nom de type, sans parenthèse ni accolade), puis d'un corps `{` sur la même ligne ?
    Un appel `nom(…)` hors d'une déclaration n'en est pas une, même suivi d'un bloc à la ligne d'après ou
    d'un `: { … }` de ternaire. Seule la ligne du mot est relue : relire tout ce qui le précède rendait
    `uses` quadratique (53 s sur un module de 400 Ko)."""
    head = mask_text[mask_text.rfind("\n", 0, start) + 1:start].rstrip(" \t")
    while True:
        modifier = re.search(r"(?<![\w$])(?:async|static|get|set)$", head)
        if not modifier:
            break
        head = head[:modifier.start()].rstrip(" \t")
    if (head[-1:] or "\n") not in "{,;\n":
        return False
    if not head and continues_expression(mask_text, mask_text.rfind("\n", 0, start)):
        return False
    at = end
    while at < len(mask_text) and mask_text[at] in " \t":
        at += 1
    if mask_text[at:at + 1] != "(":
        return False
    depth = 0
    for i in range(at, len(mask_text)):
        if mask_text[i] == "(":
            depth += 1
        elif mask_text[i] == ")":
            depth -= 1
            if depth == 0:
                return METHOD_BODY.match(mask_text, i + 1) is not None
    return False


def specifier_names(text):
    """(nom importé, nom local, `type` en ligne) d'un spécificateur `type A as B`."""
    m = SPECIFIER.match(text)
    if not m:
        return text, text, False
    return m.group(2), m.group(3) or m.group(2), bool(m.group(1))


def module_key(path, spec):
    """Le module que désigne un spécificateur relatif, sans extension ; None pour un paquet."""
    if not spec.startswith("."):
        return None
    full = os.path.normpath(os.path.join(str(path.parent), spec))
    for ext in EXTENSIONS:
        if full.endswith(ext):
            return full[:-len(ext)]
    return full


def key_of(path):
    full = os.path.normpath(str(path))
    return full[:-len(path.suffix)] if path.suffix else full


def renamed_spec(spec, target):
    """Le spécificateur d'un import de la source changé en celui de la cible : son dernier segment,
    extension gardée si l'ancien en avait une."""
    head, _, last = spec.rpartition("/")
    has_ext = any(last.endswith(ext) for ext in EXTENSIONS)
    return f"{head}/{target.name if has_ext else target.stem}" if head else (target.name if has_ext else target.stem)


# --- réécriture des imports ------------------------------------------------------


class Edits:
    """Les changements d'un fichier : imports retirés, ajoutés, plages supprimées, texte ajouté à la fin."""

    def __init__(self, module):
        self.module = module
        self.named = {}  # index d'import → liste de spécificateurs
        self.added = []  # (spécificateur du module, clé, type, spécificateur)
        self.cuts = []   # (début, fin)
        self.tail = ""

    def specs_of(self, index):
        return self.named.setdefault(index, list(self.module.imports[index]["named"] or []))

    def remove(self, index, imported):
        specs = self.specs_of(index)
        specs[:] = [s for s in specs if specifier_names(s)[0] != imported]

    def add(self, spec, key, is_type, specifier):
        """Ajoute un spécificateur à un import du même module et de la même forme, ou à une ligne nouvelle."""
        for index, imp in enumerate(self.module.imports):
            if not imp["export"] and imp["type"] == is_type and imp["named"] is not None and not imp["namespace"] \
                    and module_key(self.module.path, imp["spec"]) == key:
                specs = self.specs_of(index)
                if specifier not in specs:
                    specs.append(specifier)
                return
        for added in self.added:
            if added[1] == key and added[2] == is_type:
                if specifier not in added[3]:
                    added[3].append(specifier)
                return
        self.added.append((spec, key, is_type, [specifier]))

    def render(self, imp, specs):
        if not specs and not imp["default"]:
            return None
        parts = [imp["default"]] if imp["default"] else []
        if specs:
            if imp["multiline"]:
                parts.append("{\n" + "".join(f"{imp['indent']}{s},\n" for s in specs) + "}")
            else:
                parts.append("{ " + ", ".join(specs) + " }")
        head = "export" if imp["export"] else "import"
        q = imp["quote"]
        return f"{head} {'type ' if imp['type'] else ''}{', '.join(parts)} from {q}{imp['spec']}{q}{';' if imp['semi'] else ''}"

    def apply(self):
        text = self.module.text
        changes = list(self.cuts)
        replaced = []
        for index, specs in self.named.items():
            imp = self.module.imports[index]
            if specs == (imp["named"] or []):
                continue
            new = self.render(imp, specs)
            if new is None:
                replaced.append((imp["start"], self.module.line_end(imp["line"] + self.module.text.count("\n", imp["start"], imp["end"])), ""))
            else:
                replaced.append((imp["start"], imp["end"], new))
        if self.added:
            # Le guillemet et le point-virgule du premier import du fichier ; sans import, la forme
            # `'…'` sans point-virgule.
            first = next((imp for imp in self.module.imports if not imp["export"]), None)
            q, semi = (first["quote"], ";" if first["semi"] else "") if first else ("'", "")
            lines = "".join(f"import {'type ' if t else ''}{{ {', '.join(specs)} }} from {q}{spec}{q}{semi}\n" for spec, _, t, specs in self.added)
            at = self.module.import_end()
            if at == 0 and text and not self.module.imports:
                lines += "\n"
            replaced.append((at, at, lines))
        edits = [(a, b, "") for a, b in changes] + replaced
        # Les insertions passent après les suppressions qui finissent au même endroit.
        for a, b, new in sorted(edits, key=lambda e: (e[0], e[1]), reverse=True):
            text = text[:a] + new + text[b:]
        if self.tail:
            if text and not text.endswith("\n"):
                text += "\n"
            # Le texte ajouté commence par une ligne vide, sauf dans un fichier vide.
            text += self.tail if text else self.tail.lstrip("\n")
        return text


# --- plan --------------------------------------------------------------------------


def plugin_files(root):
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if path.is_file() and rel.parts[0] != ".claude-plugin" and "node_modules" not in rel.parts and path.suffix in TEXTS:
            yield path


def mutual_pairs(texts, hooks_dir):
    """Les paires de modules de `hooks/` qui s'atteignent l'un l'autre par leurs imports (un cycle)."""
    modules = {key_of(p): p for p in texts if p.parent == hooks_dir and p.suffix in READERS}
    edges = {}
    for key, path in modules.items():
        found = set()
        for imp in Module(path, texts[path]).imports:
            target = module_key(path, imp["spec"])
            if target in modules:
                found.add(target)
        edges[key] = found
    reach = {}
    for start in modules:
        seen, todo = set(), [start]
        while todo:
            for nxt in edges.get(todo.pop(), ()):
                if nxt not in seen:
                    seen.add(nxt)
                    todo.append(nxt)
        reach[start] = seen
    return {tuple(sorted((modules[a].name, modules[b].name))) for a in modules for b in reach[a] if a in reach.get(b, ()) and a != b}


def plan(source_path, target_path, names):
    """Le plan du déplacement : (textes nouveaux par chemin, rapport, refus)."""
    problems, report = [], []
    source_path, target_path = Path(os.path.normpath(os.path.abspath(source_path))), Path(os.path.normpath(os.path.abspath(target_path)))
    hooks_dir = source_path.parent
    if hooks_dir.name != "hooks" or target_path.parent != hooks_dir:
        raise MoveError("la source et la cible doivent être deux modules du même dossier hooks/ d'un plugin")
    if source_path == target_path:
        raise MoveError("la source et la cible sont le même module")
    if source_path.suffix not in READERS or target_path.suffix not in READERS:
        raise MoveError("la source et la cible doivent être des modules .ts ou .tsx")
    if not source_path.is_file():
        raise MoveError(f"source introuvable : {source_path}")
    root = hooks_dir.parent
    rel = lambda p: p.relative_to(root).as_posix()
    texts = {p: p.read_bytes().decode("utf-8") for p in plugin_files(root)}
    source = Module(source_path, texts[source_path])
    target = Module(target_path, texts.get(target_path, ""))
    for module in (source, target):
        if module.unclosed:
            raise MoveError(f"{rel(module.path)} : {module.unclosed} littéral(aux) laissé(s) ouvert(s), la lecture a déraillé ; rien n'est écrit")
    missing = [n for n in names if n not in source.decls]
    if missing:
        raise MoveError(f"{rel(source_path)} : déclaration de premier niveau introuvable : {', '.join(missing)}")
    moved = sorted(dict.fromkeys(names), key=lambda n: source.decls[n]["line"])
    source_key, target_key = key_of(source_path), key_of(target_path)
    chunks = {n: source.chunk(n) for n in moved}
    for n in moved:
        d = source.decls[n]
        report.append(f"déclaration : {n} ({rel(source_path)}:{d['first'] + 1}-{d['end'] + 1}, commentaire compris)")
        if d["default"]:
            problems.append(f"{n} : export par défaut, non déplacé")

    # Les plages du masque : code déplacé, code restant (hors imports d'en-tête et hors code déplacé).
    moved_ranges = [(source.offset(source.decls[n]["line"]), source.line_end(source.decls[n]["end"])) for n in moved]
    cut_ranges = [(source.offset(source.decls[n]["first"]), source.line_end(source.decls[n]["end"])) for n in moved]
    header_end = max((i["end"] for i in source.imports), default=0)
    remaining_ranges, at = [], header_end
    for a, b in sorted(cut_ranges):
        remaining_ranges.append((at, a))
        at = b
    remaining_ranges.append((at, len(source.text)))
    used_by_moved = uses(source.mask, moved_ranges)
    used_by_rest = uses(source.mask, remaining_ranges)

    source_edits, target_edits = Edits(source), Edits(target)
    # Ce que la cible a déjà : ses déclarations, et les noms qu'elle importe ou réexporte ; un
    # `export { } from` ne lie aucun nom local (`target_bound` n'a que les imports).
    target_imported, target_bound = {}, {}
    for index, imp in enumerate(target.imports):
        for s in imp["named"] or []:
            imported, local, _ = specifier_names(s)
            key = module_key(target_path, imp["spec"])
            target_imported[local] = (index, imported, key)
            if not imp["export"]:
                target_bound[local] = (index, imported, key)
            # Un nom déplacé que la cible importait de la source sous un autre nom : ses usages ne se
            # réécrivent pas.
            if key == source_key and imported in moved and local != imported:
                problems.append(f"{imported} : importé sous un autre nom dans {rel(target_path)} (`{s}`) : renommer ses usages d'abord")
    for n in moved:
        if n in target.decls:
            problems.append(f"{n} : déjà déclaré dans {rel(target_path)}")
        elif n in target_imported:
            index, imported, key = target_imported[n]
            if key == source_key and imported == n:
                target_edits.remove(index, imported)
            else:
                problems.append(f"{n} : déjà importé dans {rel(target_path)} d'un autre module")

    # Les dépendances du code déplacé restées dans la source : ses imports, pas ses `export { } from`,
    # qui ne lient aucun nom local (un mot du code déplacé qui en porte le nom n'en dépend pas, et la
    # réexportation reste).
    source_imported = {}
    for index, imp in enumerate(source.imports):
        if imp["export"]:
            continue
        for s in imp["named"] or []:
            imported, local, _ = specifier_names(s)
            source_imported[local] = (index, imp, s)
        if imp["default"]:
            source_imported[imp["default"]] = (index, imp, None)
        if imp["namespace"]:
            source_imported[imp["namespace"]] = (index, imp, None)
    # Dans l'ordre des imports de la source, puis des déclarations restées.
    order = lambda name: (0, source_imported[name][0], name) if name in source_imported else (1, source.decls.get(name, {}).get("line", 0), name)
    for name in sorted(used_by_moved - set(moved), key=order):
        if name in source.decls:
            d = source.decls[name]
            if not d["exported"]:
                problems.append(f"{name} : déclaration de la source que le code déplacé utilise, non exportée : l'exporter d'abord, ou la déplacer aussi")
                report.append(f"dépendance restée dans la source : {name} (déclaration non exportée)")
                continue
            report.append(f"dépendance restée dans la source : {name} (déclaration exportée, importée de la source par la cible)")
            if name in target.decls or (name in target_bound and target_bound[name][2] != source_key):
                problems.append(f"{name} : la cible a déjà un autre {name}")
            elif name not in target_bound:
                target_edits.add(f"./{source_path.name}", source_key, d["kind"] in ("type", "interface"), name)
        elif name in source_imported:
            index, imp, s = source_imported[name]
            key = module_key(source_path, imp["spec"])
            report.append(f"dépendance restée dans la source : {name} (import de '{imp['spec']}', ajouté à la cible)")
            if s is None:
                problems.append(f"{name} : import par défaut ou `* as` de la source, non recopié : l'importer à la main dans la cible")
            elif key == target_key:
                pass
            elif name in target.decls or (name in target_bound and target_bound[name][2] != key):
                problems.append(f"{name} : la cible a déjà un autre {name}")
            elif name not in target_bound:
                target_edits.add(imp["spec"], key or imp["spec"], imp["type"], s)
            if name not in used_by_rest and s is not None:
                source_edits.remove(index, specifier_names(s)[0])

    # La source qui utilise encore un nom déplacé l'importe de la cible.
    for n in moved:
        if n in used_by_rest:
            if not source.decls[n]["exported"]:
                problems.append(f"{n} : non exporté, mais la source l'utilise encore : l'exporter d'abord")
            else:
                report.append(f"la source utilise encore {n} : importé de ./{target_path.name}")
                source_edits.add(f"./{target_path.name}", target_key, source.decls[n]["kind"] in ("type", "interface"), n)
    source_edits.cuts = cut_ranges_with_blank(source, sorted(cut_ranges))
    target_text_tail = "".join("\n" + chunks[n] + ("" if chunks[n].endswith("\n") else "\n") for n in moved)
    target_edits.tail = target_text_tail

    # Les fichiers du plugin qui importent un nom déplacé de la source.
    new_texts = {}
    importers = []
    for path, text in texts.items():
        if path in (source_path, target_path) or path.suffix not in READERS:
            continue
        module = Module(path, text)
        edits = Edits(module)
        touched = False
        for index, imp in enumerate(module.imports):
            if module_key(path, imp["spec"]) != source_key:
                continue
            if imp["namespace"] or imp["star"]:
                if any(re.search(rf"(?<![\w$]){re.escape(imp['namespace'] or '')}\.{re.escape(n)}(?![\w$])", text) for n in moved) or imp["star"]:
                    problems.append(f"{rel(path)} : `* as` ou `export *` de la source : les noms déplacés n'y sont pas réécrits")
                continue
            for s in imp["named"] or []:
                imported, _, _ = specifier_names(s)
                if imported in moved:
                    if imp["export"]:
                        problems.append(f"{rel(path)} : `export {{ {s} }} from '{imp['spec']}'` vise un nom déplacé : le réécrire à la main")
                        continue
                    edits.remove(index, imported)
                    edits.add(renamed_spec(imp["spec"], target_path), target_key, imp["type"], s)
                    touched = True
        if touched:
            importers.append(rel(path))
            new_texts[path] = edits.apply()
    new_texts[source_path] = source_edits.apply()
    new_texts[target_path] = target_edits.apply()
    report.append("fichiers qui importent les noms déplacés : " + (", ".join(importers) or "aucun"))

    # Les renvois : les lignes qui nomment le module source (`relay.ts`, ou `relay` entre accents graves)
    # à côté d'un nom déplacé ; le nom nu se confondrait avec une variable du même nom.
    stem = re.compile(rf"(?<![\w-]){re.escape(source_path.stem)}\.tsx?(?![\w-])|`{re.escape(source_path.stem)}`")
    found = []
    for path, text in texts.items():
        for k, line in enumerate(text.split("\n"), 1):
            if re.match(r"\s*(?:import|export)\b.*\bfrom\b", line) or not stem.search(line):
                continue
            if any(re.search(rf"(?<![\w$]){re.escape(n)}(?![\w$])", line) for n in moved):
                found.append(f"{rel(path)}:{k} « {line.strip()[:100]} »")
    report.append("renvois à relire (non modifiés) : " + ("aucun" if not found else "\n  " + "\n  ".join(found)))

    # Un cycle d'imports nouveau entre les modules de hooks/.
    after = dict(texts)
    after.update(new_texts)
    created = mutual_pairs(after, hooks_dir) - mutual_pairs(texts, hooks_dir)
    if created:
        problems.append("cycle d'imports créé : " + ", ".join(f"{a} ↔ {b}" for a, b in sorted(created)))
    else:
        report.append("cycle d'imports : aucun nouveau")

    # Un nom déplacé exporté que plus aucun autre fichier de code du plugin ne nomme (souvent : seule la
    # cible l'importait) : le contrôle des exports morts de check.sh le refusera, et sa liste d'admis ne
    # peut pas monter pour la cible ; à retirer de l'export à la main, les octets restant prouvés ici.
    readers = [set(WORD.findall(text)) for path, text in after.items() if path != target_path and path.suffix in READERS]
    dead = [n for n in moved if source.decls[n]["exported"] and source.decls[n]["kind"] not in ("type", "interface", "namespace")
            and not any(n in words for words in readers)]
    if dead:
        report.append("exporté sans autre lecteur après le déplacement (refusé par le contrôle des exports morts de check.sh) : "
                      + ", ".join(dead) + " ; retirer « export » dans la cible")

    # La preuve d'identité, sur les nouveaux textes, avant toute écriture.
    proofs = []
    if not problems:
        new_target = Module(target_path, new_texts[target_path])
        new_source = Module(source_path, new_texts[source_path])
        # Une déclaration mal bornée laisse un littéral ouvert ou change une déclaration restée.
        for module in (new_source, new_target):
            if module.unclosed:
                problems.append(f"{rel(module.path)} : le nouveau texte laisse {module.unclosed} littéral(aux) ouvert(s) : déclaration mal bornée ; rien n'est écrit")
        for name in source.decls:
            if name not in moved and (name not in new_source.decls or new_source.chunk(name) != source.chunk(name)):
                problems.append(f"{name} : la déclaration restée dans la source change ; rien n'est écrit")
        for n in moved:
            again = new_target.chunk(n) if n in new_target.decls else None
            if again != chunks[n] or n in new_source.decls:
                problems.append(f"{n} : la déclaration relue dans la cible n'a pas les mêmes octets qu'avant ; rien n'est écrit")
            else:
                data = chunks[n].encode("utf-8")
                proofs.append(f"{n} : {chunks[n].count(chr(10))} lignes, {len(data)} octets, identiques avant et après (sha256 {hashlib.sha256(data).hexdigest()[:16]})")
    # La cible s'écrit d'abord et la source en dernier : une déclaration n'est jamais absente des deux.
    order = sorted(new_texts, key=lambda p: (p != target_path, p == source_path))
    changed = {p: new_texts[p] for p in order if new_texts[p] != texts.get(p)}
    return changed, report, proofs, problems


def cut_ranges_with_blank(module, ranges):
    """Les plages des déclarations retirées, chacune avec une ligne vide voisine quand elle est entre deux
    lignes vides (ou en fin de fichier), pour ne pas laisser deux lignes vides de suite."""
    out = []
    for a, b in ranges:
        last = module.text.count("\n", 0, b - 1) if b > 0 else 0
        first = module.text.count("\n", 0, a)
        before_blank = first == 0 or not module.lines[first - 1].strip()
        after_line = last + 1
        after_blank = after_line >= len(module.lines) or not module.lines[after_line].strip()
        if before_blank and after_blank and after_line < len(module.lines) and b < len(module.text):
            b = module.line_end(after_line)
        elif before_blank and after_line >= len(module.lines) - 1 and first > 0:
            a = module.offset(first - 1)
        out.append((a, b))
    return out


def write_all(changed):
    """Écrit les nouveaux textes, tout ou rien : sur une écriture refusée, remet les fichiers déjà
    écrits dans leur état d'avant (une cible créée est retirée) ; rend le message d'échec, ou None."""
    before = {p: p.read_bytes() if p.is_file() else None for p in changed}
    written = []
    for path, text in changed.items():
        try:
            path.write_bytes(text.encode("utf-8"))
            written.append(path)
        except OSError as err:
            failed = []
            for done in written:
                try:
                    if before[done] is None:
                        done.unlink()
                    else:
                        done.write_bytes(before[done])
                except OSError:
                    failed.append(str(done))
            if failed:
                return f"écriture de {path} refusée ({err.strerror}) ; non remis dans leur état d'avant : {', '.join(failed)}"
            return f"écriture de {path} refusée ({err.strerror}) ; les fichiers déjà écrits sont remis : rien n'est écrit"
    return None


def main(argv):
    is_trial = argv[:1] == ["--essai"]
    args = argv[1:] if is_trial else argv
    if len(args) < 3:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    try:
        changed, report, proofs, problems = plan(args[0], args[1], args[2:])
    except (MoveError, OSError, UnicodeDecodeError) as err:
        print(f"ÉCHEC : {err}", file=sys.stderr)
        return 1
    print("\n".join(report))
    if problems:
        print("ÉCHEC, rien n'est écrit :\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    root = Path(os.path.abspath(args[0])).parent.parent
    if is_trial:
        print("essai : rien n'est écrit ; fichiers qui changeraient : " + ", ".join(p.relative_to(root).as_posix() for p in changed))
        print("\n".join(proofs))
        return 0
    error = write_all(changed)
    if error:
        print(f"ÉCHEC : {error}", file=sys.stderr)
        return 1
    print("écrits : " + ", ".join(p.relative_to(root).as_posix() for p in changed))
    print("\n".join(proofs))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
