#!/usr/bin/env python3
"""Contrôles d'un plugin du dépôt, dans l'ordre, arrêtés au premier échec.

    scripts/check.sh <plugin>...           tous les contrôles des plugins nommés (scripts\\check.cmd sous Windows)
    scripts/check.sh --all                 tous les plugins
    scripts/check.sh <plugin> --no-desktop sans le Claude Code de l'app desktop (poste sans l'app)
    scripts/check.sh --staged              le hook pre-commit : les plugins dont un fichier est indexé
    scripts/check.sh --fix <plugin>...     réécrit l'arbre « Architecture » du README, sans rien contrôler

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
3. types : `tsc` d'une version fixée de TypeScript, par npx (aucune installation globale). Les types
   du moteur (`.claude-plugin/types/`, ignorés par git) manquent dans un worktree : ils sont copiés
   depuis le clone principal ;
4. `node --test` des tests Node des skills et du plugin (`skills/**/*.test.mjs`, `tests/**/*.test.mjs` :
   ceux qui lisent les sources, ce que `claude plugin test` ne permet pas) ;
5. `claude plugin test` avec le Claude Code du terminal, puis avec le binaire le plus récent de
   l'app desktop, trouvé ici (Mac et Windows) ;
6. `claude plugin validate` du plugin, puis du dépôt.

--staged (hook pre-commit, décision « Hook ») : rien pour un commit de documentation seule ; sinon
`validate` du dépôt, puis `validate`, `tsc` (pour un plugin qui a un `tsconfig.json`) et tests
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


def ticket_refs(plugin):
    problems = []
    for path, rel in files_of(plugin):
        if path.suffix not in CODE_SUFFIXES | {".md"}:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            m = TICKET_REFS.search(comment_of(line, path.suffix))
            if m:
                problems.append(f"{plugin.name}/{rel}:{n} : « {m.group(0)} »")
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


def validate(target, claude):
    name = "." if target == REPO else f"plugins/{target.name}"
    step(f"claude plugin validate {name}", [claude, "plugin", "validate", target], 300)


def check_plugin(plugin, desktop):
    log(f"\n=== {plugin.name}")
    claude = tool("claude")
    static_checks(plugin)
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


def staged():
    code, out = run(["git", "diff", "--cached", "--name-only", "-z"], 60)
    if code != 0:
        raise Failed(f"git diff --cached : {out.strip()}")
    paths = [p for p in out.split("\0") if p]
    code_paths = [p for p in paths if not is_doc(p)]
    if not code_paths:
        log("pre-commit : documentation seule, pas de contrôle")
        return
    claude = tool("claude")
    log("pre-commit : contrôles des fichiers indexés (Claude Code du terminal)")
    validate(REPO, claude)
    touched = sorted({p.split("/")[1] for p in code_paths if p.startswith("plugins/") and p.count("/") >= 2})
    for name in touched:
        plugin = PLUGINS / name
        if not (plugin / ".claude-plugin" / "plugin.json").is_file():
            continue
        if passed_already(plugin):
            log(f"→ plugins/{name} : identique au dernier check.sh vert, contrôles sautés")
        else:
            validate(plugin, claude)
            typecheck(plugin)
            plugin_tests(plugin, claude, "terminal")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plugins", nargs="*", help="plugins à contrôler (noms des dossiers de plugins/)")
    parser.add_argument("--all", action="store_true", help="tous les plugins")
    parser.add_argument("--no-desktop", action="store_true", help="sans le Claude Code de l'app desktop")
    parser.add_argument("--staged", action="store_true", help="hook pre-commit : les plugins dont un fichier est indexé")
    parser.add_argument("--fix", action="store_true", help="réécrit l'arbre « Architecture » du README des plugins, sans rien contrôler")
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
    except Failed as err:
        log(f"\nÉCHEC : {err}")
        sys.exit(1)
    log("\nTous les contrôles sont passés.")


if __name__ == "__main__":
    main()
