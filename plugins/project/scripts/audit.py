#!/usr/bin/env python3
"""Inventory a project against the `project` plugin convention.

Prints a Markdown report of deterministic checks: expected files, legacy
structure, CLAUDE.md size and protocol markers, ETAT_DU_PROJET.md layout,
and signals from the prompt-audit guide (caps emphasis, dated idioms,
backticked paths that no longer exist). Judgment calls stay with Claude.

Usage: python3 audit.py [project_root]
Standard library only; read-only.
"""

import re
import sys
from pathlib import Path

CLAUDE_MD_MAX_LINES = 200
RECENT_JOURNAL_ENTRIES = 5

EXPECTED = ["CLAUDE.md", "BRIEF.md", "DECISIONS.md", "ETAT_DU_PROJET.md"]
EXPECTED_DIRS = ["docs", "travail/tasks"]
PR_TEMPLATES = [".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md",
                ".github/PULL_REQUEST_TEMPLATE", "PULL_REQUEST_TEMPLATE.md", "docs/PULL_REQUEST_TEMPLATE.md"]

# Legacy paths from the old git-command / core / super-review plugins.
LEGACY = {
    "TODO.md": "tâches à verser dans Asana, puis supprimer",
    ".claude/plugins.config.yaml": "ancienne configuration des plugins, à supprimer",
    ".claude/agent-memory": "mémoire d'agents maison, remplacée par la mémoire automatique",
    "docs/00-context": "ancienne couche contexte (system-state, architecture)",
    "docs/01-product": "ancienne couche produit, à fondre dans BRIEF.md",
    "docs/02-features": "anciennes fiches de fonctionnalités",
    "docs/03-logs": "anciens journaux (implementation, bug, decisions, insights)",
    "docs/04-process": "ancienne couche processus",
    "docs/review": "fichiers temporaires de super-review",
    "docs/superpowers": "plans de super-review",
}
LEGACY_GLOBS = {
    "docs/**/system-state.md": "état système dupliqué du code",
    "docs/**/tech-design.md": "description du code existant",
    "docs/**/dev-tasks.md": "tâches : Asana",
    "docs/**/test-plan.md": "plan de test : les tests eux-mêmes",
    "docs/**/implementation-log.md": "doublon de git log",
    "docs/**/schema.sql": "copie du schéma : source de vérité dans les migrations",
    "docs/**/migrations": "migrations rangées dans docs/",
}

ASANA_MARKERS = [
    (r"GID\s*`?\d{6,}", "GID du projet ou de la section"),
    (r"\[code\]", "tâche mère « [code] » du travail de Claude"),
    (r"Statut\s*:", "ligne « Statut : » des descriptions"),
    (r"sous-tâches", "lecture des sous-tâches par leur tâche mère"),
    (r"À reporter dans Asana|sans connecteur Asana|Sans connecteur Asana", "repli sans connecteur"),
]

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".expo"}

# Signals from the prompt-audit guide (Group 1a, 1b, 1d).
CAPS_EMPHASIS = re.compile(r"\b(MUST|NEVER|ALWAYS|CRITICAL|IMPORTANT|JAMAIS|TOUJOURS|OBLIGATOIRE)\b")
DATED_IDIOMS = re.compile(
    r"think step by step|take a deep breath|réfléchis étape par étape|<scratchpad>|"
    r"claude-2|claude-3|claude-instant|sonnet 3\.[57]|opus 4\.[0-5]\b",
    re.IGNORECASE,
)
BACKTICK = re.compile(r"`([^`\n]+)`")
PATH_LIKE = re.compile(r"^[\w.\-/]+$")
KNOWN_EXT = re.compile(r"\.(md|py|ts|tsx|js|json|ya?ml|toml|sql|sh|txt|cfg)$")
DATE_HEADING = re.compile(r"^#{2,4}\s+(\d{4}-\d{2}-\d{2})")


def rel(root: Path, p: Path) -> str:
    return p.relative_to(root).as_posix()


def walk(root: Path, pattern: str):
    for p in root.glob(pattern):
        if not any(part in SKIP_DIRS for part in p.relative_to(root).parts):
            yield p


def instruction_files(root: Path):
    """CLAUDE.md / AGENTS.md at any level, rules, skills, agents, commands."""
    seen = set()
    for pattern in ("**/CLAUDE.md", "**/CLAUDE.local.md", "**/AGENTS.md",
                    ".claude/rules/**/*.md", ".claude/skills/**/SKILL.md",
                    ".claude/agents/*.md", ".claude/commands/**/*.md"):
        for p in walk(root, pattern):
            if p.is_file() and p not in seen:
                seen.add(p)
                yield p


def looks_like_project_path(token: str) -> bool:
    if not PATH_LIKE.match(token) or token.startswith(("/", "~", "http")):
        return False
    return "/" in token or bool(KNOWN_EXT.search(token))


def check_paths(root: Path, path: Path, text: str):
    """Backticked project paths that do not exist (prompt-audit Group 2)."""
    missing = []
    for n, line in enumerate(text.splitlines(), 1):
        for token in BACKTICK.findall(line):
            token = token.strip().rstrip("/")
            if not looks_like_project_path(token):
                continue
            # Relative to the file, then to the root; glob-free tokens only.
            if not ((path.parent / token).exists() or (root / token).exists()):
                missing.append((n, token))
    return missing


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    if not root.is_dir():
        print(f"Dossier introuvable : {root}")
        return 2

    out = [f"# Audit de convention : {root.name}", ""]
    counts = {"ok": 0, "todo": 0, "legacy": 0}

    def line(kind: str, msg: str):
        counts[kind] += 1
        tag = {"ok": "[OK]", "todo": "[À FAIRE]", "legacy": "[ANCIEN]"}[kind]
        out.append(f"- {tag} {msg}")

    out += ["## Fichiers attendus", ""]
    for name in EXPECTED:
        if (root / name).is_file():
            line("ok", f"`{name}`")
        else:
            line("todo", f"`{name}` absent")
    for name in EXPECTED_DIRS:
        if (root / name).is_dir():
            line("ok", f"`{name}/`")
        else:
            line("todo", f"`{name}/` absent")
    out.append(f"- [INFO] dépôt git : {'oui' if (root / '.git').exists() else 'non'}")
    templates = [n for n in PR_TEMPLATES if (root / n).exists()]
    out.append(f"- [INFO] modèle de PR : {', '.join(f'`{t}`' for t in templates) if templates else 'aucun'}")

    out += ["", "## Structure ancienne", ""]
    found_legacy = False
    for name, why in LEGACY.items():
        if (root / name).exists():
            found_legacy = True
            line("legacy", f"`{name}` : {why}")
    for pattern, why in LEGACY_GLOBS.items():
        hits = sorted(rel(root, p) for p in walk(root, pattern))
        if hits:
            found_legacy = True
            shown = ", ".join(f"`{h}`" for h in hits[:5])
            more = f" et {len(hits) - 5} autres" if len(hits) > 5 else ""
            line("legacy", f"{len(hits)} × {pattern.split('/')[-1]} ({why}) : {shown}{more}")
    if not found_legacy:
        out.append("- aucune")

    claude_md = root / "CLAUDE.md"
    out += ["", "## CLAUDE.md", ""]
    if claude_md.is_file():
        text = claude_md.read_text(encoding="utf-8", errors="replace")
        n_lines = len(text.splitlines())
        if n_lines <= CLAUDE_MD_MAX_LINES:
            line("ok", f"{n_lines} lignes (cible : {CLAUDE_MD_MAX_LINES} au plus)")
        else:
            line("todo", f"{n_lines} lignes, au-delà de la cible de {CLAUDE_MD_MAX_LINES} : lancer /doctor")
        for marker, label in (("## Commandes", "section « Commandes »"),
                              ("## Protocole de session", "section « Protocole de session »")):
            if marker in text:
                line("ok", label)
            else:
                line("todo", f"{label} absente")
        if "Asana" in text:
            line("ok", "Asana référencé comme source des tâches")
            # Asana organization expected by the session protocol (conventions, section 1).
            for pattern, label in ASANA_MARKERS:
                if re.search(pattern, text):
                    line("ok", f"Asana : {label}")
                else:
                    line("todo", f"Asana : {label} absent")
        else:
            line("todo", "Asana non mentionné")
        if "TODO.md" in text:
            line("legacy", "mentionne encore `TODO.md`")
        imports = re.findall(r"(?m)^\s*@([\w./\-]+)", text)
        for imp in imports:
            if Path(imp).name in ("DECISIONS.md", "ETAT_DU_PROJET.md"):
                line("todo", f"importe `@{imp}` : fichier qui grossit, à lire à la demande")
            else:
                out.append(f"- [INFO] import `@{imp}`")
    else:
        out.append("- absent")

    etat = root / "ETAT_DU_PROJET.md"
    out += ["", "## ETAT_DU_PROJET.md", ""]
    if etat.is_file():
        text = etat.read_text(encoding="utf-8", errors="replace")
        has_state = re.search(r"(?m)^## État\b", text) is not None
        has_journal = re.search(r"(?m)^## Journal\b", text) is not None
        line("ok" if has_state else "todo", "section « État »" + ("" if has_state else " absente"))
        line("ok" if has_journal else "todo", "section « Journal »" + ("" if has_journal else " absente"))
        dates = [m.group(1) for l in text.splitlines() if (m := DATE_HEADING.match(l))]
        out.append(f"- [INFO] {len(dates)} entrées datées")
        if len(dates) >= 2:
            if dates == sorted(dates, reverse=True):
                line("ok", "journal du plus récent au plus ancien")
            else:
                line("todo", f"journal pas trié du plus récent au plus ancien (lecture des {RECENT_JOURNAL_ENTRIES} premières entrées faussée)")
    else:
        out.append("- absent")

    out += ["", "## Fichiers d'instructions (signaux prompt-audit)", ""]
    files = list(instruction_files(root))
    if not files:
        out.append("- aucun")
    for p in files:
        text = p.read_text(encoding="utf-8", errors="replace")
        caps = [n for n, l in enumerate(text.splitlines(), 1) if CAPS_EMPHASIS.search(l)]
        idioms = [n for n, l in enumerate(text.splitlines(), 1) if DATED_IDIOMS.search(l)]
        missing = check_paths(root, p, text)
        details = []
        if len(caps) >= 3:
            details.append(f"emphase en majuscules sur {len(caps)} lignes ({', '.join(map(str, caps[:8]))})")
        if idioms:
            details.append(f"tournures datées (lignes {', '.join(map(str, idioms))})")
        if missing:
            shown = ", ".join(f"`{t}` (l.{n})" for n, t in missing[:6])
            details.append(f"chemins introuvables ({len(missing)}) : {shown}")
        if details:
            line("todo", f"`{rel(root, p)}` : " + " ; ".join(details))
        else:
            line("ok", f"`{rel(root, p)}`")

    out += ["", f"**Total** : {counts['ok']} OK, {counts['todo']} à faire, {counts['legacy']} éléments anciens.",
            "", "Contrôles mécaniques seulement : le fond (doublons avec le code, contradictions, règles "
            "sans raison) reste à juger en lisant les fichiers."]
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
