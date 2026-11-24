#!/usr/bin/env python3
"""Relit les renvois `chemin:ligne` d'une spec ou d'un ticket contre le code du dépôt.

    python3 scripts/renvois.py <fichier>...
    python3 scripts/renvois.py --fix [--essai] <fichier>...

Un renvoi est un chemin qui porte un `/` ou finit par une extension, suivi de `:<ligne>` (ou de
`:<ligne>-<ligne>`), le chemin entre accents graves ou non (« `chemin`:<ligne> » compte aussi) ; l'hôte
d'une adresse (`https://hôte:8080`) n'en est pas un. Chaque renvoi des fichiers nommés se juge ainsi :
- un chemin absolu, avec un segment « .. », qui sort du dépôt (lien symbolique compris) ou qui n'est
  pas dans `git ls-files` (chemin comparé tel qu'écrit, et le fichier qu'il vise aussi) : « refusé,
  non lu », sans échec ;
- une ligne (la première ou la dernière d'une plage) au-delà de la fin du fichier : « hors fichier » ;
- sinon, le nom entre accents graves le plus proche du renvoi dans la même phrase (un identifiant, pas
  un chemin ni un nom de fichier ; la distance se compte du bord du renvoi, avant ou après lui ; à
  égalité, celui d'avant) : présent à 3 lignes au plus de la plage citée, le renvoi est juste ; présent
  ailleurs dans le fichier, « décalé : <nom> est ligne <n> » ; absent du fichier, « absent ». Un nom
  qualifié (`Type.membre`) se cherche entier, sinon par son dernier membre (`membre`), qu'un fichier
  déclare seul ;
- sans nom dans la phrase, le renvoi est juste si la ligne existe.

Une phrase va jusqu'à « . », « ! », « ? » ou « ; » suivis d'un blanc (pas après « cf. », « ex. » ni
« p. »), à travers les retours à la ligne d'un paragraphe ; une ligne vide, ou une ligne qui commence
une rangée de tableau, une puce, un titre, une citation ou un point numéroté (`|`, `-`, `*`, `+`, `#`,
`>`, `1.`), commence un autre paragraphe. Un bloc de code (entre « ``` » ou « ~~~ ») n'est pas relu :
une sortie de commande qu'il cite garde les numéros de son temps. Une ligne par renvoi faux ou refusé (son fichier et sa
ligne), puis le compte.

Les citations de décisions se relisent aussi, comptées à part : « <id> de `<chemin>/DECISIONS.md` » et
« série <n> de `<chemin>/DECISIONS.md` » (le chemin entre accents graves, juste après « de » ; un
`DECISIONS.md` nu, sans dossier, n'est pas contrôlé, ni deviné). Un id est une à six majuscules suivies
d'un à trois chiffres (S10, Q9) ou une à six majuscules, un tiret et une à six majuscules ou chiffres
(INV-09, CR-AUTO). L'id doit paraître en mot entier dans le fichier, la série y avoir son titre
« ## Série <n> », sinon « absent : <id ou série> n'est pas dans <fichier> » ; une phrase entre guillemets
français qui suit directement la citation après deux-points (« série 2 de `…` : « … » », guillemets
imbriqués gardés) doit se trouver mot pour mot, blancs réduits, dans la série citée ou, pour un id, dans
le fichier, sinon « citation absente ». Le fichier cité passe par les mêmes gardes qu'un renvoi (refusé,
non lu, sans échec) et se lit sous la racine de ce dépôt seulement : dans un worktree, une série écrite au
clone principal après le départ de la branche y manque. Le pre-commit (`check.py --staged`) lance ce
contrôle sur les lignes qu'un commit ajoute aux tickets, specs et fichiers de décisions de `travail/`, le
fichier cité lu alors dans l'index, et une citation fausse que `HEAD` portait déjà n'y compte pas ; une
citation fausse y refuse le commit d'un ticket ou d'une spec, et n'avertit que dans un fichier de décisions.

Code 1 dès qu'un renvoi est décalé, absent ou hors fichier, ou qu'une citation est fausse ; 2 quand un
fichier nommé est illisible (les autres sont relus quand même) ou que `git ls-files` échoue (rien
n'est relu). Un fichier cité admis mais illisible est refusé, non lu. Les fichiers nommés
se lisent tels quels, suivis par git ou non (un ticket se relit avant sa publication) ; parmi les
chemins qu'ils citent, le script n'ouvre que des fichiers suivis par git sous la racine du dépôt,
nommés par un chemin relatif sans « .. », par le chemin résolu qu'il a contrôlé (fichiers de décisions
cités compris). Sans `--fix`, il n'écrit rien, et sa seule commande, `git ls-files`, ne reçoit aucun
texte lu dans un ticket ou une spec.

Avec `--fix`, il réécrit dans les fichiers nommés le numéro de chaque renvoi « décalé » dont le nom est
une déclaration de premier niveau unique du fichier cité (lue comme `scripts/show.py --decl` : fonction ou
classe d'un fichier Python ; fonction, classe, constante, type… d'un fichier JavaScript ou TypeScript ;
pas une constante Python) : le numéro devient la ligne de son
mot-clé, une plage `a-b` garde sa longueur, et rien d'autre ne change, à l'octet près (fins de ligne
comprises). Une ligne « corrigé : <constat> → <numéro> » par renvoi réécrit ; il laisse, avec la raison,
un renvoi dont le nom n'est pas une déclaration unique (absente, déclarée plusieurs fois, ou d'une lecture
que `show.py` dit incertaine), dont le nom est qualifié (`Type.membre` : un membre), dont la phrase nomme
aussi une autre déclaration du fichier cité (le renvoi la visait peut-être), dont la plage décalée sortirait
du fichier, un renvoi « absent » ou « hors
fichier » (les renvois refusés restent sur leur ligne « refusé, non lu », hors du compte des laissés) ; il
n'écrit pas, et le dit (« non écrit »), un fichier nommé qui est un lien symbolique, hors du dépôt, non
suivi par git, nommé par un chemin qui passe par un dossier lien symbolique sous la racine, aux fins de
ligne en retour chariot seul (relu alors comme en texte, mais pas réécrit), ou changé entre sa lecture et
l'écriture (relu juste avant) ; l'écriture passe par un
fichier voisin neuf mis à sa place, et ratée, elle laisse le fichier d'avant. Relancé sur un fichier
corrigé, il ne change rien. Le code de sortie reste 1 tant qu'un renvoi faux demeure. `--fix --essai`
montre ce qui changerait (« corrigerait : … ») sans rien écrire, et les fichiers que `--fix` n'écrirait pas
(« non écrit », pour les mêmes raisons, sauf un changement pendant le passage) ; `--essai` seul est refusé
(code 2). Les renvois de
ligne se périment dès qu'une autre mission touche le fichier : un ticket nomme plutôt une déclaration
par son nom (`scripts/show.py --decl <fichier> <nom>`), et un renvoi cite son chemin depuis la racine
du dépôt (un nom de fichier seul est refusé, non lu).
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

REPO = Path(__file__).resolve().parent.parent
# Un renvoi : un chemin qui porte un `/` ou finit par une extension, au besoin fermé par un accent grave,
# `:`, une ligne, et au besoin `-` et une autre ligne (un mot seul sans extension, « ligne:3 », n'en est
# pas un).
REF = re.compile(r"(?<![\w./~\\-])((?:[\w.~\\-]*/)+[\w.~\\-]+|[\w./~\\-]*\.[A-Za-z]\w*)`?:(\d+)(?:-(\d+))?(?![\w-])")
NAME = re.compile(r"`([A-Za-z_$][\w$.]*)(?:\(\))?`")
# Un nom de fichier n'est pas un nom de déclaration à chercher.
# Des extensions qu'un nom de membre ne prend pas (`self.cfg`, `this.lock` restent des noms).
FILE_NAME = re.compile(r"\.(?:py|pyi|ts|tsx|mts|cts|js|mjs|cjs|jsx|md|json|jsonl|sh|cmd|ps1|txt|ya?ml|toml|"
                       r"css|html|svg|png)$")
# Une fin de phrase, sauf après « cf. », « ex. » ou « p. » (« p. ex. »).
SENTENCE_END = re.compile(r"(?<!\bcf\.)(?<!\bex\.)(?<!\bp\.)(?<=[.!?;])\s+")
# Une ligne qui commence un autre paragraphe : rangée de tableau, puce, titre, citation, point numéroté.
BLOCK_START = re.compile(r"^\s*(?:[|*+#>]|-\s|\d+[.)]\s)")
WINDOW = 3
# Un id de décision : une à six majuscules suivies d'un à trois chiffres (S10, Q9, R80, T6), ou une à six
# majuscules, un tiret et une à six majuscules ou chiffres (INV-09, FERM-0, CR-AUTO) ; jamais un mot
# capitalisé ordinaire. Les bornes de `DECISION_ID` de `decisions.py` (ni lettre, chiffre, `_` ni tiret de
# part et d'autre), mais plus de formes que lui (une seule majuscule et des chiffres).
DECISION_ID = r"(?<![\w-])(?:[A-Z]{1,6}\d{1,3}|[A-Z]{1,6}-[A-Z0-9]{1,6})(?![\w-])"
# Une citation de décision : « <id> de `<chemin>/DECISIONS.md` » ou « série <n> de `<chemin>/DECISIONS.md` »,
# l'id au besoin entre accents graves, le chemin toujours, quel qu'il soit (absolu compris : `admitted` le
# refuse ensuite) ; un `DECISIONS.md` nu, sans dossier, n'est pas contrôlé.
CITATION = re.compile(r"(?:`?(?P<id>" + DECISION_ID + r")`?|(?<![\w-])[Ss]érie\s+(?P<serie>\d+))\s+de\s+"
                      r"`(?P<path>[^`\s]*[/\\]DECISIONS\.md)`")
# Ce qui sépare une citation de la phrase qu'elle cite : deux-points, puis un guillemet ouvrant.
QUOTE_START = re.compile(r"\s*:\s*«")
# Le titre d'une série d'un fichier de décisions (« ## Série <n> — <titre> (<date>) ») ; un autre titre de
# niveau 2 clôt la série.
SERIES_TITLE = re.compile(r"^##\s+Série\s+(\d+)(?!\d)", re.M)
NEXT_TITLE = re.compile(r"^##\s", re.M)


def tracked(root):
    """Les chemins suivis par git sous `root` (index compris), tels que `git ls-files` les écrit ; None
    quand git échoue."""
    try:
        out = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=60)
    except (OSError, subprocess.TimeoutExpired) as err:
        print(f"ÉCHEC : git ls-files : {err}")
        return None
    if out.returncode != 0:
        print(f"ÉCHEC : git ls-files : {out.stderr.strip()}")
        return None
    return {p for p in out.stdout.split("\0") if p}


def admitted(path, root, known):
    """(le chemin résolu à ouvrir, None) pour un chemin cité qui peut l'être, sinon (None, la raison de
    ne pas l'ouvrir)."""
    if path.startswith(("/", "~", "\\")) or re.match(r"^[A-Za-z]:", path):
        return None, "chemin absolu"
    if ".." in re.split(r"[/\\]", path):
        return None, "segment « .. »"
    if path not in known:
        return None, "non suivi par git"
    target, top = (root / path).resolve(), root.resolve()
    if not target.is_relative_to(top):
        return None, "hors du dépôt"
    # Un lien symbolique suivi vers un fichier non suivi du dépôt (`.git/config`, un `.env`) : refusé aussi.
    if target.relative_to(top).as_posix() not in known:
        return None, "vise un fichier non suivi"
    if not target.is_file():
        return None, "pas un fichier"
    return target, None


def name_near(sentence, start, end):
    """Le nom entre accents graves de la phrase le plus proche du renvoi qui va de `start` à `end`, la
    distance comptée du bord du renvoi, avant ou après lui (à égalité, celui d'avant) ; None sans nom."""
    best = None
    for m in NAME.finditer(sentence):
        name = m.group(1)
        if FILE_NAME.search(name) or start < m.end() and m.start() < end:
            continue
        distance = start - m.end() if m.end() <= start else m.start() - end
        if best is None or distance < best[0]:
            best = (distance, name)
    return best[1] if best else None


def lines_with(lines, name):
    """Les numéros (à partir de 1) des lignes où le nom paraît comme mot entier."""
    word = re.compile(rf"(?<![\w$]){re.escape(name)}(?![\w$])")
    return [n for n, line in enumerate(lines, 1) if word.search(line)]


def read_cited(target):
    """Les lignes d'un fichier cité, par le chemin résolu qu'`admitted` a contrôlé : la seule lecture d'un
    chemin tiré d'un texte."""
    lines = target.read_text(encoding="utf-8", errors="replace").split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def resolved(lines, name):
    """Le nom cherché et ses lignes : le nom entier, ou, absent du fichier, le dernier membre d'un nom
    qualifié (`Type.membre` → `membre`)."""
    found = lines_with(lines, name)
    if not found and "." in name.strip("."):
        name = name.strip(".").rsplit(".", 1)[1]
        found = lines_with(lines, name)
    return name, found


# Les déclarations lues de chaque fichier cité pendant un passage de --fix, par (chemin, lignes lues) : un
# fichier n'est lu qu'une fois, quel que soit le nombre de ses renvois et de noms de leurs phrases.
DECLARATIONS = {}


def declarations_of(target, lines):
    """(les déclarations de premier niveau du fichier cité, None) lues comme `scripts/show.py --decl`, ou
    (None, la raison de ne pas s'y fier)."""
    key = (str(target), hash("\n".join(lines)))
    if key in DECLARATIONS:
        return DECLARATIONS[key]
    # Chargé seulement pour --fix (il charge deplace.py), depuis le dossier de ce script même lancé par
    # `python3 -I`, qui ne l'ajoute pas au chemin des modules ; ajouté une fois.
    here = str(Path(__file__).resolve().parent)
    if here not in sys.path:
        sys.path.insert(0, here)
    suffix, warning, found = target.suffix.lower(), None, None
    try:
        import show

        if suffix in show.PY_SUFFIXES:
            decls, warning = show.py_declarations(lines)
        elif suffix in show.JS_SUFFIXES:
            decls = show.declarations(target, lines)
        else:
            found = (None, "fichier ni Python, ni JavaScript, ni TypeScript : pas de déclaration à lire")
    except Exception as err:  # un lecteur qui déraille laisse le renvoi, sans arrêter le passage
        found = (None, f"déclarations illisibles : {err}")
    if found is None:
        found = (None, "lecture des déclarations incertaine (le fichier ne se lit pas en Python)") if warning \
            else (decls, None)
    DECLARATIONS[key] = found
    return found


def declaration_line(target, lines, name):
    """(la ligne du mot-clé de la déclaration de premier niveau `name` du fichier cité, None) quand il la
    déclare une seule fois au premier niveau (lecture de `scripts/show.py --decl`), sinon (None, la raison
    de ne pas corriger)."""
    decls, why = declarations_of(target, lines)
    if decls is None:
        return None, why
    mine = [d[2] for d in decls if d[0] == name]
    if not mine:
        return None, f"{name} n'est pas une déclaration de premier niveau"
    if len(mine) > 1:
        return None, f"{name} est déclaré {len(mine)} fois au premier niveau"
    if [d for d in decls if d[0] == name][0][4]:
        return None, f"{name} est peut-être coupé dans un gabarit (lecture par lignes)"
    return mine[0], None


def fix_line(target, lines, name, sentence, start, end):
    """(la ligne où --fix récrit un renvoi « décalé » qui va de `start` à `end` dans `sentence`, None), ou
    (None, la raison de le laisser) : le nom qu'a choisi `name_near` doit être, tel qu'écrit, une
    déclaration de premier niveau unique du fichier cité (un nom qualifié réduit à son dernier membre, qui
    désigne un membre, ne l'est pas), et aucun autre nom de la phrase ne doit en être une aussi (l'auteur
    visait peut-être celui-là)."""
    short = resolved(lines, name)[0]
    if short != name:
        return None, f"nom qualifié : {name} n'est pas une déclaration de premier niveau"
    line, why = declaration_line(target, lines, name)
    if not line:
        return None, why
    # Les autres renvois de la phrase : un nom plus proche de l'un d'eux que de celui-ci est le sien.
    others = [(r.start(), r.end()) for r in REF.finditer(sentence)
              if not r.group(1).startswith("//") and (r.start(), r.end()) != (start, end)]

    def gap(m, a, b):
        return a - m.end() if m.end() <= a else m.start() - b

    for m in NAME.finditer(sentence):
        other = m.group(1)
        if other == name or FILE_NAME.search(other) or start < m.end() and m.start() < end:
            continue
        if any(gap(m, a, b) < gap(m, start, end) for a, b in others):
            continue
        if declaration_line(target, lines, other)[0]:
            return None, f"la phrase nomme aussi {other}, déclaré dans le fichier cité : le renvoi visait peut-être lui"
    return line, None


def judge(path, lines, first, last, name):
    """Le sort d'un renvoi ouvrable : None s'il est juste, sinon le texte de son défaut. Un nom qualifié
    absent du fichier se cherche par son dernier membre."""
    low, high = min(first, last), max(first, last)
    if high > len(lines) or low < 1:
        return f"hors fichier ({path} a {len(lines)} lignes)"
    if name is None:
        return None
    name, found = resolved(lines, name)
    if any(low - WINDOW <= n <= high + WINDOW for n in found):
        return None
    if found:
        near = min(found, key=lambda n: abs(n - low))
        return f"décalé : {name} est ligne {near}"
    return f"absent : {name} n'est pas dans {path}"


def paragraphs(text):
    """Les paragraphes d'un texte (lignes non vides qui se suivent, une ligne de `BLOCK_START` en commençant
    un autre, un titre restant seul, les blocs de code entre « ``` » ou « ~~~ » sautés comme des lignes
    vides) : (numéro de leur première ligne, leur texte, lignes jointes par « \\n »)."""
    out, block, start, fence = [], [], None, None
    for n, line in enumerate(text.split("\n"), 1):
        mark = line.lstrip()[:3]
        if fence or mark in ("```", "~~~"):
            fence = None if fence == mark else (fence or mark)
            line = ""
        if block and (not line.strip() or BLOCK_START.match(line) or block[-1].lstrip().startswith("#")):
            out.append((start, "\n".join(block)))
            block = []
        if line.strip():
            if not block:
                start = n
            block.append(line)
    if block:
        out.append((start, "\n".join(block)))
    return out


def check_text(text, label, root, known, cache, fixes=None):
    """Les constats d'un texte : (faux, refusés, relus), chaque constat « <label>:<n> : `<renvoi>` : … ».
    `cache` garde, par chemin cité, ce qu'`admitted` en a dit, les lignes lues et le chemin résolu. Avec
    `fixes` (une liste, pour --fix), chaque renvoi « décalé » y ajoute sa correction : (constat, None,
    [(début, fin, chiffres)…] : la place dans `text` des chiffres de chaque numéro et leur nouvelle valeur)
    quand son nom est une déclaration de premier niveau unique du fichier cité, sa plage gardant sa
    longueur ; sinon (constat, raison de le laisser, [])."""
    wrong, skipped, seen = [], [], 0
    # La place de chaque ligne dans le texte : un paragraphe garde ses lignes telles quelles.
    line_at = [0]
    for line in text.split("\n"):
        line_at.append(line_at[-1] + len(line) + 1)
    for start, block in paragraphs(text):
        offset = 0
        for sentence in SENTENCE_END.split(block):
            at = block.index(sentence, offset)
            offset = at + len(sentence)
            for m in REF.finditer(sentence):
                path, first = m.group(1), int(m.group(2))
                if path.startswith("//"):  # l'hôte d'une adresse, pas un fichier
                    continue
                seen += 1
                last = int(m.group(3)) if m.group(3) else first
                n = start + block.count("\n", 0, at + m.start())
                where = f"{label}:{n} : `{m.group(0)}`"
                if path not in cache:
                    target, reason = admitted(path, root, known)
                    lines = None
                    if target:
                        try:
                            lines = read_cited(target)
                        except OSError as err:
                            reason = f"illisible : {err.strerror or err}"
                    cache[path] = (reason, lines, target)
                reason, lines, target = cache[path]
                if reason:
                    skipped.append(f"{where} : refusé, non lu ({reason})")
                    continue
                name = name_near(sentence, m.start(), m.end())
                said = judge(path, lines, first, last, name)
                if not said:
                    continue
                wrong.append(f"{where} : {said}")
                if fixes is None:
                    continue
                if not said.startswith("décalé"):
                    fixes.append((wrong[-1], None, []))
                    continue
                line, why = fix_line(target, lines, name, sentence, m.start(), m.end())
                shift = line - first if line else 0
                if line and not 1 <= last + shift <= len(lines):
                    line, why = None, f"la plage décalée sortirait du fichier ({len(lines)} lignes)"
                if not line:
                    fixes.append((wrong[-1], why, []))
                    continue
                base = line_at[start - 1] + at
                edits = [(base + m.start(2), base + m.end(2), str(first + shift))]
                if m.group(3):
                    edits.append((base + m.start(3), base + m.end(3), str(last + shift)))
                fixes.append((wrong[-1], None, edits))
    return wrong, skipped, seen


def quoted_after(block, at):
    """La phrase entre guillemets français qui suit directement la position `at` après deux-points (les
    guillemets imbriqués gardés entiers), et la position de son guillemet fermant ; None sans elle ou
    quand elle ne se ferme pas dans le paragraphe."""
    opening = QUOTE_START.match(block, at)
    if not opening:
        return None
    depth, start = 1, opening.end()
    for k in range(start, len(block)):
        depth += {"«": 1, "»": -1}.get(block[k], 0)
        if depth == 0:
            return block[start:k], k
    return None


def flat(text):
    """Le texte, chaque suite de blancs (retours à la ligne compris) réduite à une espace."""
    return " ".join(text.split())


def series_of(text, number):
    """Le texte de la série `number` d'un fichier de décisions, de son titre « ## Série <n> » au titre de
    niveau 2 suivant ; None quand le fichier ne la titre pas (la première, s'il la titre deux fois)."""
    for m in SERIES_TITLE.finditer(text):
        if int(m.group(1)) == number:
            end = NEXT_TITLE.search(text, m.end())
            return text[m.start():end.start() if end else len(text)]
    return None


def judge_citation(path, text, cited_id, number, quote):
    """Le sort d'une citation de décision ouvrable : None si l'id ou la série sont dans le fichier, et la
    phrase citée mot pour mot (blancs réduits) dans la série citée ou, pour un id, dans le fichier ;
    sinon le texte de son défaut."""
    scope = text
    if number is not None:
        scope = series_of(text, number)
        if scope is None:
            return f"absent : série {number} n'est pas dans {path}"
    elif not re.search(rf"(?<![\w-]){re.escape(cited_id)}(?![\w-])", text):
        return f"absent : {cited_id} n'est pas dans {path}"
    if quote is not None and flat(quote) not in flat(scope):
        where = f"la série {number} de {path}" if number is not None else path
        return f"citation absente : « {flat(quote)[:80]} » n'est pas dans {where}"
    return None


def check_citations(text, label, root, known, cache, read=None):
    """Les citations de décisions d'un texte : (fausses, refusées, relues), chaque constat un quadruplet
    (première ligne, dernière ligne, « <label>:<n> : « <citation> » : … », clé), la dernière ligne étant
    celle de la fin de la phrase citée quand il y en a une, la clé la citation et sa phrase citée entière,
    blancs réduits (le hook y reconnaît une citation que `HEAD` portait déjà). `cache` garde, par fichier
    de décisions cité, ce qu'`admitted` en a dit et son texte. Le fichier cité, une fois admis, se lit sur
    le disque sous `root` par le chemin résolu qu'`admitted` a contrôlé ; ou, avec `read` (le hook : le
    contenu de l'index), par `read(<chemin cité>)`, qui rend son texte ou None, jamais par une commande qui
    reçoive ce chemin. Dans un worktree, une série écrite au clone principal après le départ de la branche
    y est absente."""
    wrong, skipped, seen = [], [], 0
    for start, block in paragraphs(text):
        for m in CITATION.finditer(block):
            seen += 1
            path, cited_id = m.group("path"), m.group("id")
            number = int(m.group("serie")) if m.group("serie") else None
            found = quoted_after(block, m.end())
            quote, end = found if found else (None, m.end())
            first = start + block.count("\n", 0, m.start())
            last = start + block.count("\n", 0, end)
            where = f"{label}:{first} : « {flat(m.group(0))} »"
            if path not in cache:
                target, reason = admitted(path, root, known)
                body = None
                if target and read is not None:
                    body = read(path)
                    reason = None if body is not None else "absent de l'index"
                elif target:
                    try:
                        body = "\n".join(read_cited(target))
                    except OSError as err:
                        reason = f"illisible : {err.strerror or err}"
                cache[path] = (reason, body)
            reason, body = cache[path]
            key = (flat(m.group(0)), None if quote is None else flat(quote))
            if reason:
                skipped.append((first, last, f"{where} : refusé, non lu ({reason})", key))
                continue
            said = judge_citation(path, body, cited_id, number, quote)
            if said:
                wrong.append((first, last, f"{where} : {said}", key))
    return wrong, skipped, seen


def main(argv=None, root=None):
    args = sys.argv[1:] if argv is None else argv
    if not args or any(a in ("-h", "--help") for a in args):
        print(__doc__.strip())
        return 0 if args else 2
    fix, trial = "--fix" in args, "--essai" in args
    args = [a for a in args if a not in ("--fix", "--essai")]
    if trial and not fix or not args or any(a.startswith("--") for a in args):
        print("Usage : python3 scripts/renvois.py [--fix [--essai]] <fichier>...")
        return 2
    root = Path(root or REPO)
    known = tracked(root)
    if known is None:
        return 2
    wrong, skipped, seen, unread, cache = [], [], 0, [], {}
    # Les citations de décisions, comptées à part ; leur cache garde le texte entier des fichiers cités.
    cited_wrong, cited_skipped, cited_seen, cited_cache = [], [], 0, {}
    # Avec --fix : ce qui est corrigé (ou le serait, avec --essai), ce qui est laissé, les fichiers non écrits.
    fixed, left, unwritten = [], [], []
    for name in args:
        try:
            # Lu en octets puis décodé : les fins de ligne restent telles quelles, et --fix réécrit le reste
            # du fichier à l'octet près.
            raw = Path(name).read_bytes()
            text = raw.decode("utf-8")
        except (OSError, UnicodeDecodeError) as err:
            unread.append(f"ÉCHEC : {name} illisible : {err}")
            continue
        # Un retour chariot seul (fins de ligne d'un vieux Mac) est une fin de ligne, comme à la lecture en
        # texte : le texte se relit alors normalisé, et --fix n'y écrit rien (ses places seraient fausses).
        lone_cr = re.search(r"\r(?!\n)", text) is not None
        if lone_cr:
            text = text.replace("\r\n", "\n").replace("\r", "\n")
        fixes = [] if fix else None
        w, s, n = check_text(text, name, root, known, cache, fixes)
        skipped += s
        seen += n
        if fix:
            edits = [e for _, why, es in fixes if not why for e in es]
            done = [said for said, why, es in fixes if es]
            refusal = None if not edits else ("retour chariot seul en fin de ligne" if lone_cr else None) \
                or unwritable(Path(name), root, known) or (None if trial else write_fixes(Path(name), raw, text, edits))
            if refusal:
                unwritten.append(f"non écrit : {name} ({refusal})")
            else:
                verb = "corrigerait" if trial else "corrigé"
                fixed += [f"{verb} : {said} → {new}" for said, new in fix_targets(fixes)]
            w = [said for said in w if said not in done or trial or refusal]
            left += [f"laissé : {said}" + (f" ({why})" if why else "") for said, why, es in fixes
                     if not es or refusal]
        wrong += w
        w, s, n = check_citations(text, name, root, known, cited_cache)
        cited_wrong += [said for _, _, said, _ in w]
        cited_skipped += [said for _, _, said, _ in s]
        cited_seen += n
    shown = fixed + left + unwritten if fix else wrong
    for line in shown + cited_wrong + skipped + cited_skipped + unread:
        print(line)
    print(f"{len(wrong)} renvoi(s) faux, {len(skipped)} refusé(s) non lu(s), sur {seen} relu(s)")
    if fix:
        print(f"{len(fixed)} renvoi(s) {'à corriger (essai, rien écrit)' if trial else 'corrigé(s)'}, "
              f"{len(left)} laissé(s), {len(unwritten)} fichier(s) non écrit(s)")
    print(f"{len(cited_wrong)} citation(s) de décisions fausse(s), {len(cited_skipped)} refusée(s) non lue(s), "
          f"sur {cited_seen} relue(s)")
    return 2 if unread else 1 if wrong or cited_wrong else 0


def fix_targets(fixes):
    """(constat, renvoi corrigé) de chaque correction : le numéro (ou la plage) qu'elle écrit."""
    return [(said, "-".join(new for _, _, new in es)) for said, why, es in fixes if es]


def unwritable(path, root, known):
    """La raison de ne jamais écrire le fichier nommé `path` (un lien symbolique, un fichier hors du dépôt
    ou non suivi par git, un chemin qui passe par un dossier lien symbolique sous la racine), ou None :
    jugée aussi par `--essai`, qui n'annonce que ce que `--fix` écrirait."""
    if path.is_symlink():
        return "lien symbolique"
    try:
        rel = path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return "hors du dépôt"
    if rel not in known:
        return "non suivi par git"
    # Aucun dossier du chemin tel que nommé n'est un lien symbolique sous la racine du dépôt (un lien au-dessus
    # d'elle, `/tmp` vers `/private/tmp` par exemple, ne compte pas) : remonter ses dossiers jusqu'à la racine.
    top, folder = root.resolve(), Path(os.path.abspath(path)).parent
    while folder.resolve() != top and folder.parent != folder:
        if folder.is_symlink():
            return "chemin qui passe par un lien symbolique"
        folder = folder.parent
    return None


def write_fixes(path, raw, text, edits):
    """Écrit dans le fichier nommé `path`, qu'`unwritable` a admis, le texte `text` (lu de `raw`) aux
    chiffres remplacés par `edits` ([(début, fin, chiffres)…]), rien d'autre ; None une fois écrit, sinon
    la raison de ne pas l'écrire : changé depuis sa lecture (relu juste avant l'écriture), ou écriture
    ratée. L'écriture passe par un fichier voisin qui le remplace : ratée, elle laisse le fichier d'avant."""
    for start, end, new in sorted(edits, reverse=True):
        if not text[start:end].isdigit():
            return "numéro introuvable à sa place"
        text = text[:start] + new + text[end:]
    try:
        if path.read_bytes() != raw:
            return "changé pendant le passage"
        # Un fichier voisin neuf, créé seul (jamais un fichier existant), puis mis à la place du fichier nommé.
        handle, name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".renvois")
        tmp = Path(name)
        try:
            with os.fdopen(handle, "wb") as out:
                out.write(text.encode("utf-8"))
            shutil.copymode(path, tmp)
            os.replace(tmp, path)
        finally:
            if tmp.exists():
                tmp.unlink()
    except OSError as err:
        return f"écriture ratée : {err.strerror or err}"
    return None


if __name__ == "__main__":
    sys.exit(main())
