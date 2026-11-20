#!/usr/bin/env python3
"""Relit les renvois `chemin:ligne` d'une spec ou d'un ticket contre le code du dépôt.

    python3 scripts/renvois.py <fichier>...

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
ligne), puis le compte ; code 1 dès qu'un renvoi est décalé, absent ou hors fichier ; 2 quand un
fichier nommé est illisible (les autres sont relus quand même) ou que `git ls-files` échoue (rien
n'est relu). Un fichier cité admis mais illisible est refusé, non lu. Les fichiers nommés
se lisent tels quels, suivis par git ou non (un ticket se relit avant sa publication) ; parmi les
chemins qu'ils citent, le script n'ouvre que des fichiers suivis par git sous la racine du dépôt,
nommés par un chemin relatif sans « .. », par le chemin résolu qu'il a contrôlé. Il n'écrit rien, et
sa seule commande, `git ls-files`, ne reçoit aucun texte lu dans un ticket ou une spec. Les renvois de
ligne se périment dès qu'une autre mission touche le fichier : un ticket nomme plutôt une déclaration
par son nom (`scripts/show.py --decl <fichier> <nom>`), et un renvoi cite son chemin depuis la racine
du dépôt (un nom de fichier seul est refusé, non lu).
"""

import re
import subprocess
import sys
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


def judge(path, lines, first, last, name):
    """Le sort d'un renvoi ouvrable : None s'il est juste, sinon le texte de son défaut. Un nom qualifié
    absent du fichier se cherche par son dernier membre."""
    low, high = min(first, last), max(first, last)
    if high > len(lines) or low < 1:
        return f"hors fichier ({path} a {len(lines)} lignes)"
    if name is None:
        return None
    found = lines_with(lines, name)
    if not found and "." in name.strip("."):
        name = name.strip(".").rsplit(".", 1)[1]
        found = lines_with(lines, name)
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


def check_text(text, label, root, known, cache):
    """Les constats d'un texte : (faux, refusés, relus), chaque constat « <label>:<n> : `<renvoi>` : … ».
    `cache` garde, par chemin cité, ce qu'`admitted` en a dit et les lignes lues."""
    wrong, skipped, seen = [], [], 0
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
                    cache[path] = (reason, lines)
                reason, lines = cache[path]
                if reason:
                    skipped.append(f"{where} : refusé, non lu ({reason})")
                    continue
                said = judge(path, lines, first, last, name_near(sentence, m.start(), m.end()))
                if said:
                    wrong.append(f"{where} : {said}")
    return wrong, skipped, seen


def main(argv=None, root=None):
    args = sys.argv[1:] if argv is None else argv
    if not args or any(a in ("-h", "--help") for a in args):
        print(__doc__.strip())
        return 0 if args else 2
    root = Path(root or REPO)
    known = tracked(root)
    if known is None:
        return 2
    wrong, skipped, seen, unread, cache = [], [], 0, [], {}
    for name in args:
        try:
            text = Path(name).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as err:
            unread.append(f"ÉCHEC : {name} illisible : {err}")
            continue
        w, s, n = check_text(text, name, root, known, cache)
        wrong += w
        skipped += s
        seen += n
    for line in wrong + skipped + unread:
        print(line)
    print(f"{len(wrong)} renvoi(s) faux, {len(skipped)} refusé(s) non lu(s), sur {seen} relu(s)")
    return 2 if unread else 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
