#!/usr/bin/env python3
"""Contrôles d'un plugin du dépôt, dans l'ordre, arrêtés au premier échec.

    scripts/check.sh <plugin>...           tous les contrôles des plugins nommés (scripts\\check.cmd sous Windows)
    scripts/check.sh --all                 tous les plugins
    scripts/check.sh <plugin> --no-desktop sans le Claude Code de l'app desktop (poste sans l'app)
    scripts/check.sh --staged              le hook pre-commit : les plugins dont un fichier est indexé

Les contrôles d'un plugin, chacun seulement s'il s'applique :
1. pas de renvoi aux tickets ni aux dossiers de travail (`travail/`, absent de la version publique) ;
2. l'arbre « Architecture » du README cite chaque fichier de `hooks/` et de `tests/` ;
3. types : `tsc` d'une version fixée de TypeScript, par npx (aucune installation globale). Les types
   du moteur (`.claude-plugin/types/`, ignorés par git) manquent dans un worktree : ils sont copiés
   depuis le clone principal ;
4. `node --test` des tests Node des skills (`skills/**/*.test.mjs`) ;
5. `claude plugin test` avec le Claude Code du terminal, puis avec le binaire le plus récent de
   l'app desktop, trouvé ici (Mac et Windows) ;
6. `claude plugin validate` du plugin, puis du dépôt.

--staged (hook pre-commit, décision « Hook ») : rien pour un commit de documentation seule ; sinon
`validate` du dépôt, puis `validate` et tests (terminal seulement) des plugins touchés. Le test avec
l'app desktop reste à `check.sh <plugin>`, avant le push.

Sans dépendance hors de la bibliothèque standard ; Python 3.9 ou plus récent.
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
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
PENDING = {
    "flow-board": "renvois aux tickets et arbre « Architecture » à reprendre avec les pistes de flow-board",
}


class Failed(Exception):
    pass


def log(msg=""):
    print(msg, flush=True)


def run(args, timeout, cwd=REPO):
    """Lance une commande, rend (code, sortie) ; une commande qui ne finit pas compte comme un échec."""
    try:
        res = subprocess.run([str(a) for a in args], cwd=str(cwd), capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, f"pas fini en {timeout} s"
    except OSError as err:
        return 127, str(err)
    return res.returncode, (res.stdout or "") + (res.stderr or "")


def step(title, args, timeout, summary=None):
    log(f"→ {title}")
    code, out = run(args, timeout)
    if code != 0:
        log("\n".join(out.rstrip().splitlines()[-60:]))
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


def architecture_gaps(plugin):
    """Les fichiers de hooks/ et de tests/ que l'arbre « Architecture » du README ne cite pas."""
    readme = plugin / "README.md"
    text = readme.read_text(encoding="utf-8") if readme.is_file() else ""
    section = re.search(r"^## Architecture\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    tree = re.search(r"```[^\n]*\n(.*?)```", section.group(1), re.S) if section else None
    if not tree:
        return None
    missing = []
    for folder in ("hooks", "tests"):
        for path, rel in files_of(plugin):
            if rel.startswith(folder + "/") and not re.search(r"(?<![\w.-])" + re.escape(path.name) + r"(?![\w.-])", tree.group(1)):
                missing.append(f"{plugin.name}/{rel}")
    return missing


def static_checks(plugin):
    pending = PENDING.get(plugin.name)
    log("→ renvois aux tickets et aux dossiers de travail")
    refs = ticket_refs(plugin)
    log("→ arbre « Architecture » du README")
    gaps = architecture_gaps(plugin)
    if gaps is None:
        log("  pas d'arbre « Architecture » : contrôle sans objet")
    problems = refs + [f"{g} : absent de l'arbre « Architecture » du README" for g in gaps or []]
    if problems and pending:
        log(f"  {len(problems)} à reprendre, signalés sans échec ({pending}) :")
        for p in problems:
            log(f"    {p}")
        return
    if problems:
        log("\n".join(f"  {p}" for p in problems))
        raise Failed(f"{plugin.name} : {len(problems)} renvoi(s) aux tickets ou fichier(s) absents de l'arbre")
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
    tests = sorted((plugin / "skills").rglob("*.test.mjs")) if (plugin / "skills").is_dir() else []
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
        if (plugin / ".claude-plugin" / "plugin.json").is_file():
            validate(plugin, claude)
            plugin_tests(plugin, claude, "terminal")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plugins", nargs="*", help="plugins à contrôler (noms des dossiers de plugins/)")
    parser.add_argument("--all", action="store_true", help="tous les plugins")
    parser.add_argument("--no-desktop", action="store_true", help="sans le Claude Code de l'app desktop")
    parser.add_argument("--staged", action="store_true", help="hook pre-commit : les plugins dont un fichier est indexé")
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
