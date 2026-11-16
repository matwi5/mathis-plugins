"""Les lignes de commentaire d'un module TypeScript, pour le pre-commit (`scripts/check.py`), qui saute la
suite d'un plugin quand un commit ne change que des commentaires de `hooks/`.

Un petit lecteur de jetons : il ne sait pas tout de TypeScript, et dans le doute il ne conclut rien
(`lex` rend None) : le pre-commit lance alors la suite entière. Un faux « commentaire » ferait sauter
la suite pour un vrai changement de code ; un faux doute ne coûte que la suite."""

import re
# Après ces caractères (ou en tête de fichier), un « / » ouvre une expression régulière, pas une division.
EXPRESSION_AFTER = set("(,=:[!&|?{;+-*%<>~^")
# Après ces mots aussi (réservés dans un module : jamais le nom d'une variable ; derrière un « . », un
# mot est toujours un nom de propriété, donc une valeur).
EXPRESSION_WORDS = {"return", "typeof", "case", "do", "else", "in", "new", "delete", "void", "throw",
                    "instanceof", "yield", "await", "default", "extends"}
# Après une valeur (un mot qui n'est pas réservé, un nombre, une chaîne, une expression régulière, un
# gabarit, « ) » ou « ] »), un « / » est une division. Les mots réservés qui ne sont pas des valeurs
# (`RESERVED` hors `VALUE_WORDS` et `EXPRESSION_WORDS`), « } » (fin d'un bloc ou d'un objet) et « ++ »
# ou « -- » (préfixe ou suffixe) laissent un doute : un « / » qui les suit fait douter la lecture, un
# « < » d'un `.tsx` y coupe la lecture comme du JSX.
VALUE_END = ("a", ")", "]")
AMBIGUOUS = "ambigu"  # un jeton après lequel on ne sait pas : jamais un caractère de `EXPRESSION_AFTER`
VALUE_WORDS = {"this", "super", "null", "true", "false", "undefined"}
RESERVED = {"break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
            "else", "enum", "export", "extends", "finally", "for", "function", "if", "import", "in",
            "instanceof", "let", "new", "return", "switch", "throw", "try", "typeof", "var", "void", "while",
            "with", "yield", "await", "of", "as", "satisfies", "keyof", "type", "interface", "declare",
            "namespace", "abstract", "implements", "private", "protected", "public", "readonly", "static",
            "async", "get", "set", "is", "infer", "asserts", "unique", "module", "package"}
SPACES = " \t\r\f\v"
# Un commentaire qui change la compilation (pragma JSX, directive de TypeScript, référence `/// <…>`)
# compte comme du code : sa ligne porte du code et son texte entre dans la projection.
PRAGMA = re.compile(r"@jsx|@ts-|^///\s*<")


# La raison du dernier doute de `lex` et sa ligne : pour les tests et pour qui cherche pourquoi un
# commit de commentaires a fait tourner la suite (le pre-commit ne l'affiche pas).
LAST_DOUBT = ["", 0]


def doubt(why, line):
    LAST_DOUBT[:] = [why, line]
    return None


def is_word(c):
    return c.isalnum() or c in "_$" or ord(c) > 127


def lex(text, tsx=False):
    """(lignes qui portent du code, lignes qui portent un commentaire, projection du code, position du
    JSX) de `text`, lignes numérotées depuis 1, ou None dans le doute. Une ligne « porte du code » dès qu'un de ses
    caractères n'est ni un blanc ni dans un commentaire ; le texte d'une chaîne ou d'un gabarit est du
    code, une ligne vide d'un gabarit aussi. La projection est la suite des jetons de code, chaque
    commentaire remplacé par un blanc et chaque suite de blancs réduite à un saut de ligne (si elle en
    porte un, qui compte pour l'insertion automatique des points-virgules) ou à une espace : deux versions
    aux projections égales ne diffèrent que par leurs commentaires et leurs blancs.

    Doutes (None, `LAST_DOUBT` dit pourquoi) : un commentaire, une chaîne, un gabarit ou une expression
    régulière non fermés ; une chaîne ou une expression régulière coupée par un saut de ligne ; un « / »
    dont on ne sait pas s'il ouvre une expression régulière ou divise (`VALUE_END`, plus haut) ; sur une
    ligne où un « / » a été lu comme une division, un commentaire `/* */` ou un gabarit ouvert plus loin
    qui continue sur la ligne suivante (une expression régulière lue à tort comme une division aurait pu
    porter leur ouverture, et tout ce qui suit serait mal lu ; ouverts et fermés sur la même ligne, ils
    ne changent que cette ligne, qui porte déjà du code).

    Dans un `.tsx`, un « < » suivi d'une lettre ou de « > » ailleurs qu'après une valeur ouvre du JSX,
    dont le texte n'est pas du code et que ce lecteur ne sait pas lire : la lecture s'arrête là, et le
    quatrième élément du résultat est la position de ce « < » dans `text` (None sans JSX) ; ce qui le suit
    n'est ni dans les lignes de code ni dans celles de commentaire, et sa ligne compte comme du code."""
    n = len(text)
    code, comment = set(), set()
    tokens = []
    pending = ""  # le blanc en attente : "", " " ou "\n"
    last = ""  # le dernier jeton significatif : un caractère, un mot-clé, ou « a » pour un mot ou un nombre
    braces = []  # pour chaque `${` ouvert : la profondeur d'accolades depuis lui
    division_line = 0  # la dernière ligne où un « / » a été lu comme une division
    division_braces = 0  # le nombre de `${` ouverts à ce moment
    line = 1
    i = 0

    def blank(kind):
        nonlocal pending
        if kind == "\n" or not pending:
            pending = kind

    def emit(tok):
        nonlocal pending
        if pending and tokens:
            tokens.append(pending)
        pending = ""
        tokens.append(tok)

    def template(start):
        """Lit un gabarit depuis `start` (après « ` » ou « } »), jusqu'à « ` » ou « ${ » : rend (fin, ouvert)."""
        nonlocal line
        j = start
        while j < n:
            c = text[j]
            if c == "\n" or (c == "\\" and j + 1 < n and text[j + 1] == "\n"):
                if division_line == line:
                    return doubt("gabarit qui continue après une division", line)
            if c == "\\":
                j += 1
                if j < n and text[j] == "\n":
                    line += 1
                code.add(line)
            elif c == "`":
                return j + 1, False
            elif c == "$" and j + 1 < n and text[j + 1] == "{":
                return j + 2, True
            elif c == "\n":
                line += 1
            code.add(line)
            j += 1
        return doubt("gabarit non fermé", line)

    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if c == "\n":
            if division_line == line and len(braces) > division_braces:
                return doubt("gabarit qui continue après une division", line)
            blank("\n")
            line += 1
            i += 1
            continue
        if c in SPACES:
            blank(" ")
            i += 1
            continue
        if c == "/" and nxt == "/":
            end = text.find("\n", i)
            end = n if end < 0 else end
            if PRAGMA.search(text[i:end]):
                code.add(line)
                emit(text[i:end])
            else:
                comment.add(line)
                blank(" ")
            i = end
            continue
        if c == "/" and nxt == "*":
            end = text.find("*/", i + 2)
            if end < 0:
                return doubt("commentaire non fermé", line)
            body = text[i : end + 2]
            if division_line == line and "\n" in body:
                return doubt("commentaire qui continue après une division", line)
            pragma = PRAGMA.search(body) is not None
            for k in range(body.count("\n") + 1):
                (code if pragma else comment).add(line + k)
            line += body.count("\n")
            if pragma:
                emit(body)
            else:
                blank("\n" if "\n" in body else " ")
            i = end + 2
            continue
        code.add(line)
        expression = last == "" or last in EXPRESSION_AFTER or last in EXPRESSION_WORDS
        value = last in VALUE_END
        if c in "'\"":
            j = i + 1
            while j < n and text[j] != c:
                if text[j] == "\\":
                    j += 1
                elif text[j] == "\n":
                    return doubt("chaîne coupée par un saut de ligne", line)
                j += 1
            if j >= n:
                return doubt("chaîne non fermée", line)
            piece = text[i : j + 1]
            for k in range(piece.count("\n") + 1):
                code.add(line + k)
            line += piece.count("\n")
            emit(piece)
            last = "a"
            i = j + 1
            continue
        if c == "`":
            read = template(i + 1)
            if read is None:
                return doubt("gabarit non fermé", line)
            end, opened = read
            emit(text[i:end])
            if opened:
                braces.append(0)
                last = "{"
            else:
                last = "a"
            i = end
            continue
        if c == "/":
            if expression:
                j, in_class = i + 1, False
                while j < n:
                    d = text[j]
                    if d == "\\":
                        j += 1
                    elif d == "\n":
                        return doubt("expression régulière coupée par un saut de ligne", line)
                    elif d == "[":
                        in_class = True
                    elif d == "]":
                        in_class = False
                    elif d == "/" and not in_class:
                        break
                    j += 1
                if j >= n:
                    return doubt("expression régulière non fermée", line)
                j += 1
                while j < n and is_word(text[j]):
                    j += 1
                emit(text[i:j])
                last = "a"
                i = j
                continue
            if not value:
                return doubt("« / » entre division et expression régulière", line)
            division_line, division_braces = line, len(braces)
            emit(c)
            last = c
            i += 1
            continue
        if tsx and c == "<" and not value and (nxt.isalpha() or nxt == ">"):
            return code, comment, tokens, i
        if is_word(c):
            j = i
            while j < n and is_word(text[j]):
                j += 1
            word = text[i:j]
            emit(word)
            if last == ".":
                last = "a"
            elif word in EXPRESSION_WORDS:
                last = word
            elif word in RESERVED and word not in VALUE_WORDS:
                last = AMBIGUOUS
            else:
                last = "a"
            i = j
            continue
        if c in "+-" and nxt == c:
            emit(c + c)
            last = AMBIGUOUS
            i += 2
            continue
        if c == "{" and braces:
            braces[-1] += 1
        elif c == "}" and braces:
            if braces[-1] == 0:
                braces.pop()
                read = template(i + 1)
                if read is None:
                    return doubt("gabarit non fermé", line)
                end, opened = read
                emit(text[i:end])
                if opened:
                    braces.append(0)
                    last = "{"
                else:
                    last = "a"
                i = end
                continue
            braces[-1] -= 1
        emit(c)
        # Un « ! » derrière un mot, « ) » ou « ] » est l'assertion non nulle de TypeScript : il termine
        # une valeur, et un « / » qui le suit est une division.
        last = ")" if c == "!" and last in ("a", ")", "]") else c
        i += 1
    if braces:
        return doubt("gabarit non fermé", line)
    return code, comment, tokens, None


def comment_only(old, new, removed, added, tsx=False):
    """Vrai si passer de `old` à `new` ne change que des commentaires : chaque ligne retirée (numéros de
    `old`) et chaque ligne ajoutée (numéros de `new`) ne porte aucun code (un commentaire, ou une ligne
    vide hors d'un gabarit), et le code des deux versions est le même jeton pour jeton (`lex`). Dans un
    `.tsx` qui a du JSX, seulement avant lui : chaque ligne changée est avant la ligne de son premier
    « < », et le texte des deux versions est le même octet pour octet depuis ce « < ». Faux dans le doute,
    et sans aucune ligne changée."""
    if not removed and not added:
        return False
    before, after = lex(old, tsx), lex(new, tsx)
    if before is None or after is None:
        return False
    if (before[3] is None) != (after[3] is None):
        return False
    if before[3] is not None:
        if old[before[3]:] != new[after[3]:]:
            return False
        cut_old, cut_new = old.count("\n", 0, before[3]) + 1, new.count("\n", 0, after[3]) + 1
        if any(n >= cut_old for n in removed) or any(n >= cut_new for n in added):
            return False
    if any(n in before[0] for n in removed) or any(n in after[0] for n in added):
        return False
    return before[2] == after[2]
