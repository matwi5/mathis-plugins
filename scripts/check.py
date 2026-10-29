#!/usr/bin/env python3
"""Contrôles d'un plugin du dépôt, dans l'ordre, arrêtés au premier échec.

    scripts/check.sh <plugin>...           tous les contrôles des plugins nommés (scripts\\check.cmd sous Windows)
    scripts/check.sh --all                 tous les plugins
    scripts/check.sh <plugin> --no-desktop sans le Claude Code de l'app desktop (poste sans l'app)
    scripts/check.sh --staged              le hook pre-commit : les plugins dont un fichier est indexé
    scripts/check.sh --fix <plugin>...     réécrit l'arbre « Architecture » du README, sans rien contrôler
    scripts/check.sh --test <fichier> <plugin>  ce seul fichier de test (nom nu ou chemin), terminal seulement

Les contrôles d'un plugin, chacun seulement s'il s'applique :
1. pas de renvoi aux tickets ni aux dossiers de travail (`travail/`, absent de la version publique) ;
2. l'arbre « Architecture » du README cite chaque fichier de `hooks/` et de `tests/` (`--fix` l'écrit,
   en gardant le commentaire de chaque ligne existante) ;
   les termes retirés du plugin (`termes-retires.txt`, une version et un terme par ligne) sont absents
   de son README, de ses consignes (`hooks/`, `skills/`, `commands/`) et des entrées de son CHANGELOG
   plus récentes que la version qui les a retirés ;
   le code (hors `tests/`) n'étale pas une liste dans `Math.min` ou `Math.max` (au-delà de 100 000
   éléments, l'étalement lève une erreur) et n'a pas de bloc `/** */` suivi directement d'un autre
   (le premier ne documente plus rien) ;
   la forme du CHANGELOG : chaque entrée (`## <version> — <date>`) précédée d'une ligne `---`, versions
   uniques, de la plus récente à la plus ancienne, la première égale à la version de `plugin.json`
   (un séparateur perdu au déplacement d'une entrée n'avait été vu qu'au compte rendu) ;
   la version : une version que la branche a changée (face au point où elle part de `main`, puis
   de `origin/main`) est strictement plus grande que celle de cette référence (une autre discussion
   avait publié le même numéro) ; aucun marqueur « 0.xx.0 » du README écrit avant la dernière montée
   de version (`scripts/bump-version.py` les remplace) ;
   les appels `$.<espace>.<membre>` des hooks existent dans le Claude Code de l'app (les types qu'il
   embarque, décompressés par `zstd`) : une API qu'il ne connaît pas efface le mod dans l'app, et le
   faux moteur des tests ne la voit pas ; sauté avec un avertissement sans l'app ou sans `zstd` ;
3. types : `tsc` d'une version fixée de TypeScript, par npx (aucune installation globale). Les types
   du moteur (`.claude-plugin/types/`, ignorés par git) manquent dans un worktree : ils sont copiés
   depuis le clone principal ;
4. `node --test` des tests Node des skills et du plugin (`skills/**/*.test.mjs`, `tests/**/*.test.mjs` :
   ceux qui lisent les sources, ce que `claude plugin test` ne permet pas) ;
5. `claude plugin test` avec le Claude Code du terminal, puis avec le binaire le plus récent de
   l'app desktop, trouvé ici (Mac et Windows) ;
6. `claude plugin validate` du plugin, puis du dépôt ;
7. les versions des plugins contrôlés citées dans la liste « État » d'ETAT_DU_PROJET.md (fichier
   personnel, lu seulement ; contrôle sans objet sans lui) égales à celles de leur `plugin.json`.

--staged (hook pre-commit, décision « Hook »), tout sur une copie de l'index : d'abord la forme du CHANGELOG, la version et
la liste « État » de chaque plugin dont le CHANGELOG ou le `plugin.json` est indexé, même
pour un commit de documentation seule ; puis rien de
plus pour un commit de documentation seule ; sinon, sur une copie de l'index (`git checkout-index`, le
contenu qui part, pas l'arbre de travail), `validate` du dépôt, puis `validate`, `tsc` (pour un plugin qui a un `tsconfig.json`) et tests
(terminal seulement) des plugins touchés : 39 erreurs de types étaient passées inaperçues sur trois
groupes quand le hook ne lançait que `validate` et les tests. Le test avec l'app desktop reste à
`check.sh <plugin>`, avant le push. Un plugin dont tous les contrôles viennent de passer garde
l'empreinte de son dossier (arbre de travail, fichiers ignorés exclus) ; le hook saute ses contrôles
quand l'index à commiter porte exactement cette empreinte (un commit juste après `check.sh`).

Une commande en échec affiche ses lignes d'échec (tests, erreurs de types) avec un peu de contexte,
puis sa fin ; sa sortie entière est écrite dans un fichier temporaire dont le chemin s'affiche.

Sans dépendance hors de la bibliothèque standard ; Python 3.9 ou plus récent.
"""

import argparse
import hashlib
import json
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
PLUGINS = REPO / "plugins"
TYPESCRIPT = "typescript@5.9.3"
# Dossiers de l'app desktop qui gardent ses Claude Code embarqués, un sous-dossier par version.
DESKTOP_DIRS = {
    "darwin": Path.home() / "Library" / "Application Support" / "Claude" / "claude-code",
    "win32": Path(os.environ.get("APPDATA", "")) / "Claude" / "claude-code",
}
# Renvois au suivi d'un parcours (tickets numérotés, questions de revue, dossiers de travail) : ils
# pointent vers `travail/`, qui ne part pas dans la version publique. Nommer la décision à la place.
TICKET_REFS = re.compile(r"\btickets?\s+(?:n°\s*)?\d{2}\b|\bQ\d+ de la revue\b|\btravail/(?!tasks/)[\w-]+/", re.I)
# Renvois aux décisions d'un parcours (« Q3 », « S15 », « série 19 ») : leur fichier de décisions est
# dans `travail/` aussi. Ceux relevés le 29/10/2026 restent admis, fichier par fichier, à leur nombre
# de ce jour (`scripts/renvois-admis.json`), jusqu'à ce qu'on les nettoie : un renvoi de plus échoue.
DECISION_REFS = re.compile(r"(?<![\w-])(?:Q\d+(?:\.\d+)?|S\d{1,3})(?![\w-])|\b[Ss]éries?\s+\d+\b")
ADMITTED_REFS = Path(__file__).resolve().parent / "renvois-admis.json"
CODE_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh"}
# Contrôles 1 et 2 pas encore tenus par un plugin : signalés sans échec, jusqu'à leur reprise.
PENDING = {}
# Les lignes qui disent un échec dans la sortie d'une commande : `(fail)` de `claude plugin test`,
# `not ok` et `✖` de `node --test`, `error TS` de `tsc`. Une sortie coupée à sa fin les cachait :
# « 466 pass / 2 fail » sans aucun nom de test.
FAIL_LINE = re.compile(r"\(fail\)|^\s*not ok\b|✖|\berror TS\d+")
FAIL_CONTEXT = 2
FAIL_MAX = 40
TAIL = 60
# La liste des termes retirés d'un plugin, à sa racine.
RETIRED_FILE = "termes-retires.txt"
# Les dossiers des consignes d'un plugin (le texte que Claude lit), où un terme retiré ne revient pas.
INSTRUCTION_DIRS = ("hooks", "skills", "commands")
MINMAX_CALL = re.compile(r"\bMath\.(min|max)\(")
# Le titre d'une entrée de CHANGELOG. `-mathis.<n>` (mattpocock-skills) est un écart local sur la
# version de l'amont, rangé après elle (README de ce plugin), au contraire d'une pré-version SemVer.
CHANGELOG_ENTRY = re.compile(r"^## (\d+)\.(\d+)\.(\d+)(?:-mathis\.(\d+))?(?=\s|$)")
VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)(?:-mathis\.(\d+))?")
# Les références face auxquelles une version posée doit avancer : une autre discussion avait publié
# sur `main` la même 0.66.0 qu'un groupe, vue seulement au conflit de la fusion.
VERSION_REFS = ("main", "origin/main")
# Le marqueur d'une version pas encore connue (« depuis la 0.xx.0 ») dans un README, que
# `scripts/bump-version.py` remplace par la version posée.
PLACEHOLDER = "0.xx.0"
# Les plugins d'une liste « `nom` X.Y.Z » de la section « État » d'ETAT_DU_PROJET.md (fichier personnel,
# absent de la version publique : lu seulement).
STATE_FILE = "ETAT_DU_PROJET.md"
STATE_ENTRY = re.compile(r"`([\w-]+)` (\d+\.\d+\.\d+(?:-mathis\.\d+)?)(?![\w.-])")
# Les appels de l'API du moteur dans les hooks d'un mod, et le début d'un bloc zstd (les types que le
# Claude Code de l'app embarque y sont compressés).
API_CALL = re.compile(r"\$\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)")
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
ENGINE_INTERFACE = "export interface CoreEngineInterface {"


class Failed(Exception):
    pass


def log(msg=""):
    print(msg, flush=True)


def run(args, timeout, cwd=REPO, env=None):
    """Lance une commande, rend (code, sortie) ; une commande qui ne finit pas compte comme un échec."""
    try:
        res = subprocess.run([str(a) for a in args], cwd=str(cwd), capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=timeout,
                             env={**os.environ, **env} if env else None)
    except subprocess.TimeoutExpired:
        return 124, f"pas fini en {timeout} s"
    except OSError as err:
        return 127, str(err)
    return res.returncode, (res.stdout or "") + (res.stderr or "")


def failure_excerpt(out):
    """Les lignes d'échec d'une sortie, chacune avec quelques lignes autour, puis sa fin."""
    lines = out.rstrip().splitlines()
    hits = [i for i, line in enumerate(lines) if FAIL_LINE.search(line)][:FAIL_MAX]
    tail_from = max(0, len(lines) - TAIL)
    # Les lignes d'échec que la fin de la sortie montre déjà ne se répètent pas.
    shown = sorted({j for i in hits for j in range(max(0, i - FAIL_CONTEXT), min(len(lines), i + FAIL_CONTEXT + 1)) if j < tail_from})
    excerpt = []
    if shown:
        excerpt.append(f"  lignes d'échec ({len(hits)}{' au moins' if len(hits) == FAIL_MAX else ''}), avant la fin de la sortie :")
        for n, j in enumerate(shown):
            if n > 0 and j > shown[n - 1] + 1:
                excerpt.append("  …")
            excerpt.append(lines[j])
        excerpt.append(f"  fin de la sortie ({len(lines) - tail_from} dernières lignes) :")
    excerpt.extend(lines[tail_from:])
    return "\n".join(excerpt)


def keep_log(title, out):
    """Écrit la sortie entière dans un fichier temporaire et rend son chemin (None si l'écriture échoue)."""
    slug = re.sub(r"[^\w.-]+", "-", title)[:40].strip("-") or "commande"
    try:
        fd, path = tempfile.mkstemp(prefix=f"check-{slug}-", suffix=".log")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(out)
        return path
    except OSError:
        return None


def step(title, args, timeout, summary=None):
    log(f"→ {title}")
    code, out = run(args, timeout)
    if code != 0:
        log(failure_excerpt(out))
        path = keep_log(title, out)
        if path:
            log(f"  sortie entière : {path}")
        raise Failed(f"{title} : échec (code {code})")
    found = re.findall(summary, out) if summary else []
    log(f"  ok{' (' + found[-1] + ')' if found else ''}")


def tool(name):
    path = shutil.which(name)
    if not path:
        raise Failed(f"{name} introuvable : voir les prérequis du README")
    return path


def version_of(text):
    m = re.search(r"\d+(?:\.\d+)+", text)
    return tuple(int(n) for n in m.group(0).split(".")) if m else None


def version_key(version):
    """La clé de tri d'une version X.Y.Z, `-mathis.<n>` rangé après X.Y.Z ; None hors de cette forme."""
    m = VERSION.fullmatch(version or "")
    return (int(m[1]), int(m[2]), int(m[3]), 0 if m[4] is None else 1, int(m[4] or 0)) if m else None


def git(args, timeout=30):
    """La sortie d'une commande git, sans blancs autour ; None en échec."""
    code, out = run(["git", *args], timeout)
    return out.strip() if code == 0 else None


def desktop_claude():
    """Le Claude Code embarqué par l'app desktop dans sa version la plus récente, et cette version
    (le nom de son dossier) ; None sans l'app."""
    root = DESKTOP_DIRS.get(sys.platform)
    if not root or not root.is_dir():
        return None
    versions = sorted((v, d) for d in root.iterdir() if d.is_dir() for v in [version_of(d.name)] if v)
    for _, folder in reversed(versions):
        if sys.platform == "win32":
            found = sorted(folder.rglob("claude.exe"))
        else:
            found = sorted(folder.glob("*/claude.app/Contents/MacOS/claude"))
        if found:
            return found[0], folder.name
    return None


# --- contrôles statiques ------------------------------------------------------


def files_of(plugin):
    for path in sorted(plugin.rglob("*")):
        rel = path.relative_to(plugin).as_posix()
        if path.is_file() and not rel.startswith(".claude-plugin/types/") and "node_modules" not in path.parts:
            yield path, rel


def comment_of(line, suffix):
    """La partie commentaire d'une ligne de code ; tout le texte d'un document."""
    if suffix not in CODE_SUFFIXES:
        return line
    m = re.search(r"(?:^|\s)(//|/\*|\*|#)", line) if suffix in {".py", ".sh"} else re.search(r"(?:^|\s)(//|/\*|\*)", line)
    return line[m.start():] if m else ""


def admitted_refs():
    """Les renvois aux décisions admis, par fichier (`<plugin>/<chemin>` → nombre)."""
    if not ADMITTED_REFS.is_file():
        return {}
    try:
        data = json.loads(ADMITTED_REFS.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        raise Failed(f"{ADMITTED_REFS.name} illisible : {err}")
    files = data.get("files") if isinstance(data, dict) else None
    if not isinstance(files, dict):
        raise Failed(f"{ADMITTED_REFS.name} : pas d'objet « files »")
    return {k: v for k, v in files.items() if isinstance(v, int)}


def ticket_refs(plugin):
    problems = []
    admitted = admitted_refs()
    for path, rel in files_of(plugin):
        if path.suffix not in CODE_SUFFIXES | {".md"}:
            continue
        found = []
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            text = comment_of(line, path.suffix)
            m = TICKET_REFS.search(text)
            if m:
                problems.append(f"{plugin.name}/{rel}:{n} : « {m.group(0)} »")
            found += [f"{n} « {d.group(0)} »" for d in DECISION_REFS.finditer(text)]
        allowed = admitted.get(f"{plugin.name}/{rel}", 0)
        if len(found) > allowed:
            problems.append(f"{plugin.name}/{rel} : {len(found)} renvois aux décisions d'un parcours (« Q3 », « S15 », « série N »), "
                            f"{allowed} admis ({ADMITTED_REFS.name}) ; nommer la décision à la place : lignes {', '.join(found[:8])}"
                            f"{' …' if len(found) > 8 else ''}")
    return problems


def architecture_tree(text):
    """L'arbre « Architecture » d'un README : (début, fin) de son contenu dans le texte, ou None."""
    section = re.search(r"^## Architecture\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    tree = re.search(r"```[^\n]*\n(.*?)```", section.group(1), re.S) if section else None
    return (section.start(1) + tree.start(1), section.start(1) + tree.end(1)) if tree else None


TREE_ENTRY = re.compile(r"^(?P<lead>(?:│   |    )*)(?P<link>├── |└── )(?P<name>\S+)(?P<rest>.*)$")


def rewrite_folder(lines, folder, names):
    """Les lignes de l'arbre où les enfants de `folder/` sont exactement `names` : les lignes existantes
    gardent leur ordre et leur commentaire, une ligne d'un fichier disparu part, un fichier nouveau
    entre à sa place alphabétique quand la liste est triée, sinon à la fin. None sans ligne `folder/`."""
    at = next((i for i, line in enumerate(lines) if (m := TREE_ENTRY.match(line)) and m["name"] == folder + "/"), None)
    if at is None:
        return None
    head = TREE_ENTRY.match(lines[at])
    inner = head["lead"] + ("│   " if head["link"] == "├── " else "    ")
    end = at + 1
    while end < len(lines) and lines[end].startswith(inner):
        end += 1
    kept = []
    for line in lines[at + 1:end]:
        m = TREE_ENTRY.match(line)
        if m and m["lead"] == inner and m["name"] in names:
            kept.append((m["name"], m["rest"]))
    known = [n for n, _ in kept]
    is_sorted = known == sorted(known)
    for name in names:
        if name in known:
            continue
        place = next((i for i, (n, _) in enumerate(kept) if n > name), len(kept)) if is_sorted else len(kept)
        kept.insert(place, (name, ""))
        known.insert(place, name)
    rows = [f"{inner}{'└── ' if i == len(kept) - 1 else '├── '}{n}{rest}" for i, (n, rest) in enumerate(kept)]
    return lines[:at + 1] + rows + lines[end:]


def fix_architecture(plugin):
    """Réécrit l'arbre « Architecture » du README pour qu'il cite chaque fichier de hooks/ et de tests/."""
    readme = plugin / "README.md"
    text = readme.read_text(encoding="utf-8") if readme.is_file() else ""
    span = architecture_tree(text)
    if not span:
        log(f"  {plugin.name} : pas d'arbre « Architecture » dans le README, rien à réécrire")
        return
    lines = text[span[0]:span[1]].split("\n")
    for folder in ("hooks", "tests"):
        names = sorted(rel[len(folder) + 1:] for _, rel in files_of(plugin) if rel.startswith(folder + "/"))
        if names:
            lines = rewrite_folder(lines, folder, names) or lines
    new = text[:span[0]] + "\n".join(lines) + text[span[1]:]
    if new != text:
        with open(readme, "w", encoding="utf-8", newline="\n") as f:
            f.write(new)
        log(f"  {plugin.name}/README.md : arbre « Architecture » réécrit")
    else:
        log(f"  {plugin.name}/README.md : arbre déjà à jour")


def architecture_gaps(plugin):
    """Les fichiers de hooks/ et de tests/ que l'arbre « Architecture » du README ne cite pas."""
    readme = plugin / "README.md"
    text = readme.read_text(encoding="utf-8") if readme.is_file() else ""
    span = architecture_tree(text)
    if not span:
        return None
    tree = re.match(r"(.*)", text[span[0]:span[1]], re.S)
    missing = []
    for folder in ("hooks", "tests"):
        for path, rel in files_of(plugin):
            if rel.startswith(folder + "/") and not re.search(r"(?<![\w.-])" + re.escape(path.name) + r"(?![\w.-])", tree.group(1)):
                missing.append(f"{plugin.name}/{rel}")
    return missing


def retired_list(plugin):
    """Les termes retirés d'un plugin : [(version qui l'a retiré, terme)], vide sans liste."""
    path = plugin / RETIRED_FILE
    if not path.is_file():
        return []
    terms = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        version, sep, term = line.partition("\t")
        if not sep or not version_of(version) or not term.strip():
            raise Failed(f"{plugin.name}/{RETIRED_FILE}:{n} : « <version><tabulation><terme> » attendu")
        terms.append((version_of(version), term.strip()))
    return terms


def changelog_versions(lines):
    """La version de l'entrée du CHANGELOG à laquelle appartient chaque ligne (None avant la première)."""
    current = None
    for line in lines:
        if line.startswith("## "):
            current = version_of(line) or current
        yield current


def retired_terms(plugin):
    """Les termes retirés encore présents dans le README, les consignes, ou une entrée du CHANGELOG
    plus récente que la version qui les a retirés (les entrées d'avant, et la sienne, les racontent)."""
    terms = retired_list(plugin)
    if not terms:
        return []
    problems = []
    for path, rel in files_of(plugin):
        is_changelog = rel == "CHANGELOG.md"
        if not (rel == "README.md" or is_changelog or rel.split("/")[0] in INSTRUCTION_DIRS):
            continue
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        versions = list(changelog_versions(lines)) if is_changelog else [None] * len(lines)
        for n, (line, at) in enumerate(zip(lines, versions), 1):
            for retired_in, term in terms:
                if term in line and not (is_changelog and (at is None or at <= retired_in)):
                    problems.append(f"{plugin.name}/{rel}:{n} : terme retiré en {'.'.join(map(str, retired_in))} « {term} »")
    return problems


def code_of(line):
    """La partie code d'une ligne JS ou TS : sans commentaire `//`, vide pour une ligne de bloc `/* */`."""
    stripped = line.lstrip()
    if stripped.startswith(("*", "/*", "//")):
        return ""
    m = re.search(r"(?:^|\s)//", line)
    return line[:m.start()] if m else line


def spreads_into_minmax(code):
    """Vrai si un appel `Math.min(` ou `Math.max(` de la ligne étale une liste au premier niveau de ses arguments."""
    for m in MINMAX_CALL.finditer(code):
        depth = 0
        for i in range(m.end(), len(code)):
            c = code[i]
            if c in "([{":
                depth += 1
            elif c in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif depth == 0 and code.startswith("...", i):
                return True
    return False


def code_rules(plugin):
    """Hors tests : pas de liste étalée dans Math.min/max, pas de bloc /** */ suivi directement d'un autre."""
    problems = []
    for path, rel in files_of(plugin):
        if path.suffix not in {".ts", ".tsx", ".js", ".mjs", ".cjs"} or rel.startswith("tests/") or ".test." in path.name:
            continue
        in_doc = False
        prev_end = None
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if spreads_into_minmax(code_of(line)):
                problems.append(f"{plugin.name}/{rel}:{n} : liste étalée dans Math.min/max (une boucle à la place)")
            s = line.strip()
            if not in_doc and s.startswith("/**"):
                if prev_end is not None:
                    problems.append(f"{plugin.name}/{rel}:{n} : bloc /** */ suivi directement d'un autre (ligne {prev_end}) : le premier ne documente rien")
                in_doc = not s.endswith("*/")
                prev_end = None if in_doc else n
            elif in_doc:
                if s.endswith("*/"):
                    in_doc = False
                    prev_end = n
            elif s:
                prev_end = None
    return problems


def changelog_shape(plugin):
    """Les défauts de forme du CHANGELOG d'un plugin (fichier, ligne, défaut) ; None sans CHANGELOG."""
    path = plugin / "CHANGELOG.md"
    if not path.is_file():
        return None
    rel = f"plugins/{plugin.name}/CHANGELOG.md"
    try:
        manifest = json.loads((plugin / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError):
        manifest = None
    problems = []
    seen = {}
    previous = None
    is_separated = False
    in_fence = False
    for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if line.startswith("```"):
            in_fence = not in_fence
        if in_fence:
            continue
        if re.fullmatch(r"---\s*", line):
            is_separated = True
            continue
        if not line.startswith("## "):
            continue
        m = CHANGELOG_ENTRY.match(line)
        if not m:
            problems.append(f"{rel}:{n} : titre d'entrée sans version X.Y.Z en tête : « {line.strip()} »")
            is_separated = False
            continue
        version = line[3:m.end()]
        key = version_key(version)
        if not is_separated:
            problems.append(f"{rel}:{n} : pas de ligne « --- » avant l'entrée {version}")
        if previous is None and manifest is not None and version != manifest:
            problems.append(f"{rel}:{n} : première entrée {version}, mais plugin.json dit {manifest}")
        if key in seen:
            problems.append(f"{rel}:{n} : version {version} en double (déjà ligne {seen[key]})")
        elif previous is not None and key > previous[0]:
            problems.append(f"{rel}:{n} : {version} après {previous[1]} : les versions vont de la plus récente à la plus ancienne")
        seen.setdefault(key, n)
        previous = (key, version)
        is_separated = False
    if previous is None:
        problems.append(f"{rel} : aucune entrée « ## <version> — <date> »")
    return problems


def check_changelog(plugin):
    log("→ forme du CHANGELOG")
    problems = changelog_shape(plugin)
    if problems is None:
        log("  pas de CHANGELOG : contrôle sans objet")
    elif problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{plugin.name} : {len(problems)} défaut(s) de forme du CHANGELOG")
    else:
        log("  ok")


def static_checks(plugin):
    pending = PENDING.get(plugin.name)
    log("→ renvois aux tickets et aux dossiers de travail")
    refs = ticket_refs(plugin)
    log("→ arbre « Architecture » du README")
    gaps = architecture_gaps(plugin)
    if gaps is None:
        log("  pas d'arbre « Architecture » : contrôle sans objet")
    problems = refs + [f"{g} : absent de l'arbre « Architecture » du README (scripts/check.sh --fix {plugin.name} l'écrit)" for g in gaps or []]
    if problems and pending:
        log(f"  {len(problems)} à reprendre, signalés sans échec ({pending}) :")
        for p in problems:
            log(f"    {p}")
    elif problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{plugin.name} : {len(problems)} renvoi(s) aux tickets ou fichier(s) absents de l'arbre")
    else:
        log("  ok")
    log("→ termes retirés")
    retired = retired_terms(plugin)
    log("→ règles du code (Math.min/max étalé, doc détachée)")
    rules = retired + code_rules(plugin)
    if rules:
        log("\n".join(f"  {p}" for p in rules))
        raise Failed(f"{plugin.name} : {len(rules)} terme(s) retiré(s) ou entorse(s) aux règles du code")
    log("  ok")
    check_changelog(plugin)
    check_versions(plugin)


# --- versions -----------------------------------------------------------------


def manifest_rel(plugin):
    return f"plugins/{plugin.name}/.claude-plugin/plugin.json"


def manifest_version(plugin, rev=None):
    """La version de `plugin.json` : dans l'arbre de travail (`rev` None), dans l'index (`rev` vide)
    ou à une révision ; None si le fichier y manque ou ne se lit pas."""
    try:
        if rev is None:
            text = (plugin / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        else:
            text = git(["show", f"{rev}:{manifest_rel(plugin)}"])
            if text is None:
                return None
        version = json.loads(text).get("version")
    except (OSError, ValueError):
        return None
    return version if isinstance(version, str) else None


def version_advance(plugin, rev=None):
    """Une version posée par la branche (différente de celle du point où elle part de la référence)
    doit être strictement plus grande que celle de `main` et de `origin/main` : sinon une autre
    discussion a publié ce numéro, ou un plus grand, entre-temps. Une branche qui n'a pas touché
    à la version ne demande rien, même en retard sur la référence ; pendant une fusion, une version
    qui est celle de la branche fusionnée (`MERGE_HEAD`) vient d'elle, pas de cette branche."""
    current = manifest_version(plugin, rev)
    if current is None:
        return []
    if git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]) is not None and manifest_version(plugin, "MERGE_HEAD") == current:
        return []
    problems = []
    for ref in VERSION_REFS:
        if git(["rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"]) is None:
            continue
        base = git(["merge-base", "HEAD", ref])
        before = manifest_version(plugin, base) if base else None
        there = manifest_version(plugin, ref)
        if before is None or there is None or before == current:
            continue
        if version_key(current) is None or version_key(there) is None or version_key(current) <= version_key(there):
            problems.append(f"{manifest_rel(plugin)} : version {current}, qui n'avance pas sur {ref} ({there}) : "
                            "une autre discussion l'a publiée entre-temps ; prendre la suivante (/project:version)")
    return problems


def leftover_placeholders(plugin, rev=None):
    """Les marqueurs « 0.xx.0 » du README restés après la dernière montée de version : une ligne écrite
    avant elle (git blame), ou toute ligne quand la version change dans l'arbre ou l'index (`rev`).
    Un marqueur écrit après la dernière montée attend la prochaine : il passe."""
    readme = plugin / "README.md"
    if not readme.is_file():
        return []
    marked = [n for n, line in enumerate(readme.read_text(encoding="utf-8", errors="replace").splitlines(), 1) if PLACEHOLDER in line]
    if not marked:
        return []
    current = manifest_version(plugin, rev)
    rel = f"plugins/{plugin.name}/README.md"
    fix = f"scripts/bump-version.py {plugin.name} {current} le remplace"
    if current != manifest_version(plugin, "HEAD"):
        return [f"{rel}:{n} : marqueur « {PLACEHOLDER} » alors que la version passe à {current} : {fix}" for n in marked]
    last = git(["log", "-1", "--format=%H", "-G", '"version"[[:space:]]*:', "--", manifest_rel(plugin)], 60)
    if not last:
        return []
    problems = []
    for n in marked:
        blame = git(["blame", "--porcelain", "-L", f"{n},{n}", "--", rel], 60)
        sha = blame.split(" ", 1)[0] if blame else ""
        if sha and set(sha) != {"0"} and git(["merge-base", "--is-ancestor", sha, last]) is not None:
            problems.append(f"{rel}:{n} : marqueur « {PLACEHOLDER} » resté après la montée en {current} : {fix}")
    return problems


def check_versions(plugin, rev=None):
    log("→ version face à main et origin/main, marqueurs « 0.xx.0 »")
    problems = version_advance(plugin, rev) + leftover_placeholders(plugin, rev)
    if problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{plugin.name} : {len(problems)} défaut(s) de version")
    log("  ok")


def state_mismatches(names, root=REPO):
    """Les versions de la liste « État » d'ETAT_DU_PROJET.md qui diffèrent de celle de `plugin.json`,
    pour les plugins nommés, dans le dépôt ou dans une copie de son index (`root`) ; rien sans ce
    fichier (version publique)."""
    path = root / STATE_FILE
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    section = re.search(r"^## État\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    problems = []
    for m in STATE_ENTRY.finditer(section.group(1) if section else ""):
        name, cited = m.group(1), m.group(2)
        if name not in names:
            continue
        actual = manifest_version(root / "plugins" / name)
        if actual is not None and actual != cited:
            problems.append(f"{STATE_FILE}, section « État » : `{name}` {cited}, mais plugin.json dit {actual}")
    return problems


def check_state(names, root=REPO):
    log(f"→ versions de la liste « État » de {STATE_FILE}")
    problems = state_mismatches(names, root)
    if problems is None:
        log(f"  pas de {STATE_FILE} : contrôle sans objet")
    elif problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{len(problems)} version(s) de la liste « État » à mettre à jour")
    else:
        log("  ok")


# --- API du moteur dans le Claude Code de l'app -------------------------------


def engine_declarations(binary):
    """Les types de l'API des mods que le Claude Code de l'app embarque (compressés en zstd dans son
    binaire), gardés en cache par binaire ; (texte, None), ou (None, raison) s'ils ne se lisent pas."""
    try:
        stat = binary.stat()
    except OSError as err:
        return None, str(err)
    tag = hashlib.sha256(f"{binary}|{stat.st_size}|{stat.st_mtime_ns}".encode("utf-8")).hexdigest()[:16]
    cache = Path(tempfile.gettempdir()) / f"check-engine-{tag}.d.ts"
    if cache.is_file():
        return cache.read_text(encoding="utf-8"), None
    zstd = shutil.which("zstd")
    if not zstd:
        return None, "zstd introuvable (il décompresse les types embarqués)"
    data = binary.read_bytes()
    marker = ENGINE_INTERFACE.encode("utf-8")
    at = data.find(ZSTD_MAGIC)
    while at >= 0:
        try:
            res = subprocess.run([zstd, "-dc", "-q"], input=data[at:at + 8_000_000], capture_output=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired):
            res = None
        if res is not None and marker in res.stdout:
            text = res.stdout.decode("utf-8", errors="replace")
            try:
                cache.write_text(text, encoding="utf-8")
            except OSError:
                pass
            return text, None
        at = data.find(ZSTD_MAGIC, at + 1)
    return None, "types de l'API absents du binaire"


def engine_api(text):
    """{espace: membres} de l'interface du moteur (`$.<espace>.<membre>`), lus à l'indentation des
    types que le moteur écrit : un espace à 6 espaces, ses membres à 10."""
    api = {}
    space = None
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if line.strip() == ENGINE_INTERFACE), None)
    for line in lines[start + 1:] if start is not None else []:
        if line.startswith("  }"):
            break
        top = re.match(r"^      (?:readonly )?(\w+)\??:\s*(\{)?", line)
        if top:
            space = top.group(1)
            api.setdefault(space, set())
            continue
        member = re.match(r"^          (?:readonly )?(\w+)\??\s*[:(<]", line)
        if member and space is not None:
            api[space].add(member.group(1))
    return api


def engine_calls(plugin):
    """Les appels `$.<espace>.<membre>` du code des hooks : [(fichier:ligne, espace, membre)]."""
    calls = []
    for path, rel in files_of(plugin):
        if not rel.startswith("hooks/") or path.suffix not in {".ts", ".tsx", ".js", ".mjs", ".cjs"}:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for m in API_CALL.finditer(code_of(line)):
                calls.append((f"{plugin.name}/{rel}:{n}", m.group(1), m.group(2)))
    return calls


def check_engine_api(plugin, desktop):
    """Chaque appel de l'API du moteur existe dans le Claude Code de l'app : une API qu'il ne connaît
    pas encore efface le mod dans l'app, alors que le faux moteur des tests ne la voit pas."""
    calls = engine_calls(plugin)
    if not calls:
        return
    log("→ API du moteur dans le Claude Code de l'app")
    if desktop is None:
        log("  avertissement : contrôle sauté, sans le Claude Code de l'app")
        return
    binary, version = desktop
    text, reason = engine_declarations(Path(binary))
    if text is None:
        log(f"  avertissement : contrôle sauté, {reason}")
        return
    api = engine_api(text)
    missing = [f"{where} : $.{space}.{member} inconnu du Claude Code de l'app {version}"
               for where, space, member in calls if member not in api.get(space, ())]
    if missing:
        log("\n".join(f"  {p}" for p in missing))
        raise Failed(f"{plugin.name} : {len(missing)} appel(s) d'une API que l'app ne connaît pas encore")
    log(f"  ok ({len({(s, m) for _, s, m in calls})} appels, app {version})")


# --- types --------------------------------------------------------------------


def main_clone():
    """Le clone principal du dépôt : celui dont un worktree partage le dossier .git."""
    code, out = run(["git", "rev-parse", "--git-common-dir"], 30)
    return (REPO / out.strip()).resolve().parent if code == 0 and out.strip() else REPO


def types_written_by(types):
    head = (types / "claude-code" / "index.d.ts")
    if not head.is_file():
        return None
    with open(head, encoding="utf-8", errors="replace") as f:
        m = re.search(r"Written by Claude Code (\S+?)\.?$", f.readline().strip())
    return m.group(1) if m else None


def ensure_types(plugin):
    """Les types du moteur du plugin ; copiés au besoin depuis le clone principal (le même plugin,
    sinon le plus récent d'un autre : ce sont les types du moteur, pas ceux du plugin)."""
    types = plugin / ".claude-plugin" / "types"
    if (types / "tsconfig.json").is_file():
        return types_written_by(types)
    clone = main_clone()
    same = clone / "plugins" / plugin.name / ".claude-plugin" / "types"
    candidates = [same] if (same / "tsconfig.json").is_file() and same != types else []
    if not candidates:
        others = [d for root in {clone, REPO} for d in (root / "plugins").glob("*/.claude-plugin/types")
                  if (d / "tsconfig.json").is_file() and d != types]
        others.sort(key=lambda d: version_of(types_written_by(d) or "") or (), reverse=True)
        candidates = others[:1]
    if not candidates:
        raise Failed(f"types du moteur absents de {plugin.name} et du clone principal : lancer une fois "
                     f"`claude --plugin-dir plugins/{plugin.name}` en session interactive, puis quitter")
    shutil.copytree(candidates[0], types)
    log(f"  types du moteur copiés depuis {candidates[0]}")
    return types_written_by(types)


def typecheck(plugin):
    if not (plugin / "tsconfig.json").is_file():
        return
    log(f"→ types ({TYPESCRIPT} par npx)")
    written = ensure_types(plugin)
    log(f"  types écrits par Claude Code {written or '(version inconnue)'}")
    step(f"tsc -p plugins/{plugin.name}", [tool("npx"), "--yes", "-p", TYPESCRIPT, "tsc", "-p", plugin], 600)


# --- tests et validation ------------------------------------------------------


def node_tests(plugin):
    tests = sorted(t for folder in ("skills", "tests") if (plugin / folder).is_dir() for t in (plugin / folder).rglob("*.test.mjs"))
    if tests:
        step("node --test " + " ".join(t.relative_to(REPO).as_posix() for t in tests),
             [tool("node"), "--test", *tests], 600, r"pass \d+")


def plugin_tests(plugin, claude, label):
    if (plugin / "tests").is_dir():
        step(f"claude plugin test plugins/{plugin.name} ({label})", [claude, "plugin", "test", plugin], 900, r"\d+ pass")


def test_file(plugin, name):
    """Le fichier de test que nomme `name` : un chemin depuis le dépôt ou le plugin, ou un nom nu
    cherché dans `tests/` et `skills/` du plugin."""
    for candidate in (REPO / name, plugin / name):
        if candidate.is_file() and ".test." in candidate.name:
            return candidate.resolve()
    found = sorted(t for folder in ("tests", "skills") if (plugin / folder).is_dir()
                   for t in (plugin / folder).rglob(Path(name).name) if t.is_file() and ".test." in t.name)
    if len(found) != 1:
        where = ", ".join(t.relative_to(REPO).as_posix() for t in found) or "aucun"
        raise Failed(f"fichier de test « {name} » dans plugins/{plugin.name} : {len(found)} trouvé(s) ({where})")
    return found[0]


def single_test(plugin, name):
    """Un seul fichier de test, avec le Claude Code du terminal : un `.test.mjs` par `node --test` en
    place ; un `.test.ts`/`.test.tsx` par `claude plugin test` sur une copie temporaire du plugin qui
    n'a que ce fichier de test (les aides de `tests/` sans `.test.` restent), faute de filtre."""
    path = test_file(plugin, name)
    rel = path.relative_to(REPO).as_posix()
    if path.name.endswith(".test.mjs"):
        step(f"node --test {rel}", [tool("node"), "--test", path], 600, r"pass \d+")
        return
    claude = tool("claude")
    target = path.relative_to(plugin)
    tmp = Path(tempfile.mkdtemp(prefix="check-test-"))
    try:
        copy = tmp / plugin.name
        # Les types du moteur (`.claude-plugin/types/`) ne servent qu'à `tsc` ; le `types/` du plugin reste.
        engine_types = (plugin / ".claude-plugin").resolve()
        shutil.copytree(plugin, copy, ignore=lambda folder, names: [
            n for n in names if n == "node_modules" or (n == "types" and Path(folder).resolve() == engine_types)])
        for other in copy.rglob("*.test.*"):
            if other.relative_to(copy) != target:
                other.unlink()
        code, out = run([claude, "--version"], 60)
        version = out.strip().split(" ")[0] if code == 0 else "?"
        step(f"claude plugin test {rel} (terminal {version})", [claude, "plugin", "test", copy], 900, r"\d+ pass")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def validate(target, claude, label=None):
    name = label or ("." if target == REPO else f"plugins/{target.name}")
    step(f"claude plugin validate {name}", [claude, "plugin", "validate", target], 300)


def check_plugin(plugin, desktop):
    log(f"\n=== {plugin.name}")
    claude = tool("claude")
    static_checks(plugin)
    check_engine_api(plugin, desktop)
    typecheck(plugin)
    node_tests(plugin)
    code, out = run([claude, "--version"], 60)
    plugin_tests(plugin, claude, f"terminal {out.strip().split(' ')[0] if code == 0 else '?'}")
    if desktop is not None:
        binary, version = desktop
        plugin_tests(plugin, binary, f"desktop {version}")
    validate(plugin, claude)
    remember_passed(plugin)


# --- empreinte d'un plugin contrôlé -------------------------------------------


def passed_path(plugin):
    """Le fichier où ce worktree garde l'empreinte du dernier `check.sh` vert d'un plugin (dans son
    dossier git, propre à chaque worktree)."""
    code, out = run(["git", "rev-parse", "--git-path", f"check-ok/{plugin.name}"], 30)
    return (REPO / out.strip()) if code == 0 and out.strip() else None


def fingerprint(plugin, env=None):
    """L'empreinte des fichiers du plugin hors documentation, telle que l'index les porte (l'index
    nommé par `env`, sinon celui du commit en cours) : chemin, mode et contenu de chacun."""
    code, out = run(["git", "ls-files", "-s", "--", f"plugins/{plugin.name}"], 60, env=env)
    if code != 0:
        return None
    rows = [line for line in out.splitlines() if "\t" in line and not is_doc(line.split("\t", 1)[1])]
    return hashlib.sha256("\n".join(sorted(rows)).encode("utf-8")).hexdigest() if rows else None


def remember_passed(plugin):
    """Après un `check.sh` vert : l'empreinte de l'arbre de travail du plugin (fichiers ignorés exclus),
    calculée dans un index temporaire, sans toucher à l'index du dépôt."""
    path = passed_path(plugin)
    if path is None:
        return
    fd, index = tempfile.mkstemp(prefix="check-index-")
    os.close(fd)
    os.unlink(index)
    env = {"GIT_INDEX_FILE": index}
    try:
        code, _ = run(["git", "add", "-A", "--", f"plugins/{plugin.name}"], 120, env=env)
        mark = fingerprint(plugin, env) if code == 0 else None
    finally:
        if os.path.exists(index):
            os.unlink(index)
    if mark:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(mark + "\n", encoding="utf-8")


def passed_already(plugin):
    """Vrai si l'index à commiter porte exactement les fichiers (hors documentation) du dernier
    `check.sh` vert du plugin."""
    path = passed_path(plugin)
    if path is None or not path.is_file():
        return False
    mark = fingerprint(plugin)
    return mark is not None and path.read_text(encoding="utf-8").strip() == mark


# --- hook pre-commit ----------------------------------------------------------


def is_doc(path):
    """Un fichier de documentation : un .md hors des composants d'un plugin (skills, commandes,
    agents), que `validate` relit."""
    parts = path.split("/")
    component = len(parts) > 3 and parts[0] == "plugins" and parts[2] in {"skills", "commands", "agents"}
    return path.endswith(".md") and not component


def export_index():
    """Le contenu de l'index, ce que le commit enregistrera, écrit dans un dossier temporaire : le hook
    contrôle ce qui part, pas l'arbre de travail, où le test inachevé d'une autre discussion avait
    bloqué un commit, et où un fichier indexé cassé passait si sa version de l'arbre était bonne."""
    tmp = Path(tempfile.mkdtemp(prefix="check-staged-"))
    code, out = run(["git", "checkout-index", "--all", f"--prefix={tmp.as_posix()}/"], 300)
    if code != 0:
        shutil.rmtree(tmp, ignore_errors=True)
        raise Failed(f"git checkout-index : {out.strip()}")
    return tmp


def staged_types(plugin, copy):
    """Les types du moteur de la copie d'un plugin (ignorés par git, donc absents de l'index) : ceux
    du plugin dans l'arbre de travail ; à défaut, `typecheck` les cherche dans le clone principal."""
    own = plugin / ".claude-plugin" / "types"
    if (own / "tsconfig.json").is_file():
        shutil.copytree(own, copy / ".claude-plugin" / "types")


def staged():
    code, out = run(["git", "diff", "--cached", "--name-only", "-z"], 60)
    if code != 0:
        raise Failed(f"git diff --cached : {out.strip()}")
    paths = [p for p in out.split("\0") if p]
    # Une édition du CHANGELOG seul est de la documentation : sa forme se contrôle quand même.
    shaped = sorted({p.split("/")[1] for p in paths if re.fullmatch(r"plugins/[^/]+/(?:CHANGELOG\.md|\.claude-plugin/plugin\.json)", p)})
    code_paths = [p for p in paths if not is_doc(p)]
    if not shaped and not code_paths:
        log("pre-commit : documentation seule, pas de contrôle")
        return
    # Tous les contrôles lisent la copie de l'index : ce qui part, jamais l'arbre de travail.
    tree = export_index()
    try:
        for name in shaped:
            if (tree / "plugins" / name / ".claude-plugin" / "plugin.json").is_file():
                log(f"pre-commit : plugins/{name}")
                check_changelog(tree / "plugins" / name)
                check_versions(PLUGINS / name, rev="")
        if shaped:
            check_state(shaped, tree)
        if not code_paths:
            log("pre-commit : documentation seule, pas d'autre contrôle")
            return
        claude = tool("claude")
        log("pre-commit : contrôles du contenu indexé, sur une copie de l'index (Claude Code du terminal)")
        validate(tree, claude, ".")
        touched = sorted({p.split("/")[1] for p in code_paths if p.startswith("plugins/") and p.count("/") >= 2})
        for name in touched:
            plugin, copy = PLUGINS / name, tree / "plugins" / name
            if not (copy / ".claude-plugin" / "plugin.json").is_file():
                continue
            if passed_already(plugin):
                log(f"→ plugins/{name} : identique au dernier check.sh vert, contrôles sautés")
            else:
                staged_types(plugin, copy)
                validate(copy, claude)
                typecheck(copy)
                plugin_tests(copy, claude, "terminal")
    finally:
        shutil.rmtree(tree, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plugins", nargs="*", help="plugins à contrôler (noms des dossiers de plugins/)")
    parser.add_argument("--all", action="store_true", help="tous les plugins")
    parser.add_argument("--no-desktop", action="store_true", help="sans le Claude Code de l'app desktop")
    parser.add_argument("--staged", action="store_true", help="hook pre-commit : les plugins dont un fichier est indexé")
    parser.add_argument("--fix", action="store_true", help="réécrit l'arbre « Architecture » du README des plugins, sans rien contrôler")
    parser.add_argument("--test", metavar="FICHIER", help="lance ce seul fichier de test du plugin nommé (terminal), sans les autres contrôles")
    args = parser.parse_args()
    try:
        if args.staged:
            staged()
            return
        names = sorted(p.parent.parent.name for p in PLUGINS.glob("*/.claude-plugin/plugin.json")) if args.all else args.plugins
        if not names:
            parser.error("nommer au moins un plugin, ou --all")
        unknown = [n for n in names if not (PLUGINS / n / ".claude-plugin" / "plugin.json").is_file()]
        if unknown:
            raise Failed(f"plugin inconnu : {', '.join(unknown)}")
        if args.test:
            if len(names) != 1:
                parser.error("--test : nommer un seul plugin")
            single_test(PLUGINS / names[0], args.test)
            log("\nLe test est passé.")
            return
        if args.fix:
            for name in names:
                fix_architecture(PLUGINS / name)
            log(f"\nRelancer scripts/check.sh {' '.join(names)} pour les contrôles.")
            return
        desktop = None
        if not args.no_desktop:
            desktop = desktop_claude()
            if desktop is None:
                raise Failed("Claude Code de l'app desktop introuvable : installer l'app, ou relancer avec --no-desktop")
        for name in names:
            check_plugin(PLUGINS / name, desktop)
        validate(REPO, tool("claude"))
        check_state(names)
    except Failed as err:
        log(f"\nÉCHEC : {err}")
        sys.exit(1)
    log("\nTous les contrôles sont passés.")


if __name__ == "__main__":
    main()
