#!/usr/bin/env python3
"""Mesure le contexte de départ d'une session interactive du terminal, puis efface ses propres transcripts.

    python3 scripts/mesure-depart.py <dossier>... [--tours 2] [--garder]

Pour chaque dossier, une session interactive de Claude Code du terminal tourne dans tmux, en Haiku et en
effort low, mods coupés (les plugins installés dont `hooks/hooks.json` déclare des modules), avec un
`--session-id` tiré ici. Elle reçoit « Réponds seulement : ok », puis, à partir du deuxième tour,
« Réponds seulement : ok, encore » : les connecteurs claude.ai n'arrivent qu'après la première requête.
Le script lit dans le transcript l'usage de chaque requête (entrée, cache écrit, cache lu) et l'affiche par
dossier et par tour, avec la ligne du transcript dont il vient.

Puis il arrête la session et efface ce que ce lancement a créé sous `~/.claude/projects/`, un dossier que
partagent les vraies discussions du projet mesuré : le transcript `<id>.jsonl` et le dossier `<id>/` du
dossier de projet, et ce dossier de projet s'il l'a créé et qu'il est resté vide. Il n'efface un
transcript qu'après avoir relu que chaque ligne qui porte un `sessionId` porte cet id, que chaque ligne
qui porte un `cwd` porte le dossier mesuré, et que ses seules entrées de l'utilisateur sont ses deux
messages, en texte seul ; un lien
symbolique, une ligne illisible ou un doute gardent tout. Il liste ce qu'il a effacé et ce qui reste ;
les autres traces de la session sous `~/.claude` ne sont pas les siennes à effacer : il nomme celles qui
portent son id (file-history, session-env, debug, tasks, sessions), et laisse sans les nommer ses lignes
de `~/.claude/history.jsonl`, fichier commun à toutes les sessions. Rien ne s'efface tant que la session
tourne encore (relu juste avant chaque effacement) ; le
premier effacement qui échoue arrête le nettoyage de tous les dossiers.

Un id tiré qui a déjà une trace sous `~/.claude` fait abandonner avant tout lancement. Une session qui ne
répond pas en 120 s à un tour est arrêtée, et son transcript s'efface quand même s'il porte cet id. Un
Ctrl-C passe par le même nettoyage avant de sortir. `--garder` n'efface rien et donne les chemins.

Mac et Linux (tmux requis) ; sans dépendance hors de la bibliothèque standard.
"""

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sonde import SESSION_ID, project_dir_name, roots_of

PROMPTS = ("Réponds seulement : ok", "Réponds seulement : ok, encore")
TURN_TIMEOUT = 120
# Avant le deuxième tour : le temps que les connecteurs claude.ai arrivent.
PAUSE = 20
# Le délai d'un transcript stable avant de tenir un tour pour fini, et celui de la sortie de la session.
SETTLE = 3
EXIT_TIMEOUT = 15
MODEL, EFFORT = "haiku", "low"
# Les variables d'une session parente qui feraient de la session mesurée une session enfant, ou qui
# déplaceraient son ~/.claude (celui que le nettoyage relit).
INHERITED = ("CLAUDE_CONFIG_DIR", "CLAUDE_JOB_DIR", "CLAUDE_EFFORT", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT",
             "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_MESSAGING_SOCKET",
             "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_BRIDGE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_PID")
COUNTERS = (("entree", "input_tokens"), ("cache_ecrit", "cache_creation_input_tokens"), ("cache_lu", "cache_read_input_tokens"))
# Un compteur plausible : un entier positif, borné (au-delà, un fichier abîmé ou d'un autre format).
MAX_TOKENS = 10_000_000
INTERRUPTED = "interrompu (Ctrl-C)"
# L'id d'un plugin installé, lu dans un fichier que d'autres sessions écrivent : il entre dans les réglages
# passés à la session mesurée.
PLUGIN_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}@[A-Za-z0-9][A-Za-z0-9._-]{0,99}")


def log(msg=""):
    print(msg, flush=True)


# --- ce que le lancement crée, et ce qui le prouve ---------------------------


def claude_home():
    """Le ~/.claude que la session mesurée lit : `CLAUDE_CONFIG_DIR` est retiré de son environnement."""
    return Path.home() / ".claude"


def project_dirs(home, folder):
    """Les dossiers de projet de `folder` sous `home/projects`, une par écriture de son chemin."""
    return sorted({home / "projects" / project_dir_name(root) for root in roots_of(folder)})


def json_file(path):
    """Le JSON d'un fichier ordinaire (pas un lien), ou None."""
    try:
        if path.is_symlink() or not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def id_traces(home, sid):
    """Les traces d'une session `sid` sous `home` : transcript ou dossier d'un dossier de projet, fichiers
    nommés par son id, session ouverte (`sessions/*.json`). Vide : l'id est libre."""
    found = [p for p in (home / "projects").glob(f"*/{sid}*") if p.name in (sid, f"{sid}.jsonl")]
    found += [p for p in (home / "file-history" / sid, home / "session-env" / sid, home / "debug" / f"{sid}.txt",
                          home / "tasks" / sid) if p.exists() or p.is_symlink()]
    found += open_sessions(home, sid)
    return [str(p) for p in found]


def open_sessions(home, sid):
    """Les registres de sessions ouvertes (`sessions/<pid>.json`) qui portent le `sessionId` `sid`."""
    return [p for p in sorted((home / "sessions").glob("*.json"))
            if isinstance(entry := json_file(p), dict) and entry.get("sessionId") == sid]


def is_input(entry):
    """Vrai pour une entrée apportée par l'utilisateur : une ligne `user` hors méta, hors sous-agent et hors
    résultat d'outil, ou un message mis en file pendant que le modèle travaille (pièce jointe
    `queued_command`)."""
    if entry.get("type") == "attachment":
        attachment = entry.get("attachment")
        return isinstance(attachment, dict) and attachment.get("type") == "queued_command"
    if entry.get("type") != "user" or entry.get("isMeta") or entry.get("isSidechain") or "toolUseResult" in entry:
        return False
    message = entry.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    blocks = content if isinstance(content, list) else []
    return not (blocks and all(isinstance(b, dict) and b.get("type") == "tool_result" for b in blocks))


def typed_text(entry):
    """Le texte d'une entrée de l'utilisateur fait de texte seul (une chaîne, ou des blocs `text` et rien
    d'autre), ou None : autre entrée, ou contenu d'une autre forme (une image, un document)."""
    message = entry.get("message")
    if not is_input(entry) or entry.get("type") != "user" or not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list) and content:
        texts = [b.get("text") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        if len(texts) == len(content) and all(isinstance(t, str) for t in texts):
            return "\n".join(texts).strip()
    return None


def transcript_doubt(path, sid, roots, own=True):
    """La raison de garder un transcript, ou None : pas un fichier ordinaire, une ligne illisible, un
    `sessionId` autre que `sid`, un `cwd` autre que le dossier mesuré (`roots`, ses écritures exactes, sans
    sous-dossier), aucun `sessionId` ou aucun `cwd` ; pour le transcript de la session (`own`), toute
    entrée de l'utilisateur qui n'est pas exactement l'un de ses messages, en texte seul (une autre demande,
    une image, un document, un message mis en file : une reprise par quelqu'un d'autre)."""
    if path.is_symlink() or not path.is_file():
        return f"{path} n'est pas un fichier ordinaire"
    seen_sid = seen_cwd = False
    try:
        with open(path, encoding="utf-8") as f:
            for n, raw in enumerate(f, 1):
                try:
                    entry = json.loads(raw)
                except ValueError:
                    return f"{path} : ligne {n} illisible"
                if not isinstance(entry, dict):
                    return f"{path} : ligne {n} n'est pas un objet"
                if "sessionId" in entry:
                    if entry["sessionId"] != sid:
                        return f"{path} : ligne {n} d'une autre session ({entry['sessionId']})"
                    seen_sid = True
                if "cwd" in entry:
                    if not isinstance(entry["cwd"], str) or entry["cwd"] not in roots:
                        return f"{path} : ligne {n} d'un autre dossier ({entry['cwd']})"
                    seen_cwd = True
                # Toute entrée de l'utilisateur qui n'est pas exactement un message de la mesure (une autre
                # demande, une image, un message mis en file) : une reprise par quelqu'un d'autre.
                if own and is_input(entry) and typed_text(entry) not in PROMPTS:
                    return f"{path} : ligne {n}, une entrée de l'utilisateur qui n'est pas de la mesure"
    except (OSError, UnicodeDecodeError, TypeError, AttributeError) as err:
        return f"{path} illisible ({type(err).__name__})"
    if not seen_sid or not seen_cwd:
        return f"{path} ne porte {'aucun sessionId' if not seen_sid else 'aucun cwd'}"
    return None


def folder_doubts(folder, sid, roots):
    """Les raisons de garder le dossier `<id>/` d'une session : un lien symbolique, où qu'il soit, ou un
    transcript (`.jsonl`, ceux des sous-agents) qui n'est pas de cette session."""
    if folder.is_symlink() or not folder.is_dir():
        return [f"{folder} n'est pas un dossier ordinaire"]
    doubts = []
    for base, dirs, files in os.walk(folder):
        for name in dirs + files:
            path = Path(base) / name
            if path.is_symlink():
                doubts.append(f"{path} est un lien symbolique")
            elif name.endswith(".jsonl"):
                doubt = transcript_doubt(path, sid, roots, own=False)
                if doubt:
                    doubts.append(doubt)
    return doubts


def plan(home, folder, sid):
    """Ce que le nettoyage efface, dans l'ordre (le dossier `<id>/` d'abord, le transcript qui le prouve en
    dernier), et ce qu'il garde, avec la raison."""
    roots = roots_of(folder)
    todo, kept = [], []
    expected = project_dirs(home, folder)
    for project in expected:
        transcript, own = project / f"{sid}.jsonl", project / sid
        if project.is_symlink():
            kept.append(f"{project} (lien symbolique)")
            continue
        has_dir = own.exists() or own.is_symlink()
        if not transcript.exists() and not transcript.is_symlink():
            if has_dir:
                kept.append(f"{own} (aucun transcript qui prouve qu'il est de ce lancement)")
            continue
        doubts = [d for d in [transcript_doubt(transcript, sid, roots)] if d]
        if not doubts and has_dir:
            doubts = folder_doubts(own, sid, roots)
        if doubts:
            kept += [f"{p} ({'; '.join(doubts)})" for p in ([own] if has_dir else []) + [transcript]]
            continue
        todo += ([(own, True)] if has_dir else []) + [(transcript, False)]
    for stray in sorted((home / "projects").glob(f"*/{sid}.jsonl")):
        if stray.parent not in expected:
            kept.append(f"{stray} (hors des dossiers de projet du dossier mesuré)")
    return todo, kept


@dataclass
class Report:
    deleted: list = field(default_factory=list)
    kept: list = field(default_factory=list)
    pending: list = field(default_factory=list)
    error: str = None

    def remaining(self):
        return [f"{p} (non effacé : {self.error})" for p in self.pending] + self.kept

    def lines(self):
        out = [f"effacé : {p}" for p in self.deleted] + [f"reste : {line}" for line in self.remaining()]
        if self.error:
            out.append(f"ARRÊT : {self.error}")
        return out or ["rien sous ~/.claude/projects pour cette session"]


def recheck(path, is_dir, sid, roots):
    """Juste avant d'effacer : la raison de ne pas le faire, relue à cet instant, ou None."""
    if path.is_symlink():
        return f"{path} est devenu un lien symbolique"
    if is_dir:
        # Le transcript voisin prouve que le dossier est de ce lancement : il se relit aussi, à cet instant.
        doubts = [d for d in [transcript_doubt(path.parent / f"{sid}.jsonl", sid, roots)] if d]
        doubts += folder_doubts(path, sid, roots)
        return "; ".join(doubts) or None
    return transcript_doubt(path, sid, roots)


def clean(home, folder, sid, keep=False, new_dirs=()):
    """Efface sous `home` le transcript et le dossier de la session `sid` lancée dans `folder`, puis les
    dossiers de projet que ce lancement a créés (`new_dirs`) s'ils sont vides ; rien d'autre. Avec `keep`,
    n'efface rien. S'arrête à la première suppression qui échoue ou qu'un Ctrl-C coupe."""
    todo, kept = plan(home, folder, sid)
    report = Report(kept=list(kept))
    if keep:
        report.kept = [f"{p} (--garder)" for p, _ in todo] + report.kept
        return report
    roots = roots_of(folder)
    todo += [(p, None) for p in new_dirs]
    for i, (path, is_dir) in enumerate(todo):
        try:
            if is_dir is None:
                if path.is_symlink() or not path.is_dir() or any(path.iterdir()):
                    if path.exists() or path.is_symlink():
                        report.kept.append(f"{path} (dossier de projet créé par ce lancement, pas vide)")
                    continue
                os.rmdir(path)
            else:
                # Une session rouverte depuis l'arrêt (`claude --resume` de la mesure) : son registre porte
                # cet id ; relu juste avant chaque effacement, pas seulement à l'arrêt.
                reopened = open_sessions(home, sid)
                if reopened:
                    raise OSError(f"la session est rouverte ({reopened[0]})")
                doubt = recheck(path, is_dir, sid, roots)
                if doubt:
                    raise OSError(doubt)
                shutil.rmtree(path) if is_dir else path.unlink()
            if path.exists() or path.is_symlink():
                raise OSError(f"{path} toujours là après la suppression")
        except (OSError, KeyboardInterrupt) as err:
            report.error = f"{path} : {err}" if isinstance(err, OSError) else INTERRUPTED
            report.pending = [str(p) for p, _ in todo[i:] if p.exists() or p.is_symlink()]
            return report
        report.deleted.append(str(path))
    return report


# --- l'usage lu dans le transcript ------------------------------------------


def counter(value):
    """Un compteur de tokens borné, ou None (absent, négatif, non entier, hors bornes)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    if value != int(value) or not 0 <= value <= MAX_TOKENS:
        return None
    return int(value)


def usage_rows(path):
    """L'usage de chaque requête principale (hors sous-agents) d'un transcript, dans l'ordre : son tour
    (le nombre de messages de la mesure tapés avant elle), la ligne d'où il vient (la première de la
    requête, qui peut en écrire plusieurs), son modèle, et ses trois compteurs (None : absent)."""
    rows, seen, tour = [], set(), 0
    with open(path, encoding="utf-8", errors="replace") as f:
        for n, raw in enumerate(f, 1):
            try:
                entry = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(entry, dict):
                continue
            if typed_text(entry) in PROMPTS:
                tour += 1
            message = entry.get("message")
            if entry.get("type") != "assistant" or entry.get("isSidechain") or not isinstance(message, dict):
                continue
            usage = message.get("usage")
            key = message.get("id") if isinstance(message.get("id"), str) else f"ligne {n}"
            if not isinstance(usage, dict) or key in seen:
                continue
            seen.add(key)
            row = {"tour": tour, "ligne": n, "modele": message.get("model") if isinstance(message.get("model"), str) else None}
            row.update({name: counter(usage.get(field_)) for name, field_ in COUNTERS})
            rows.append(row)
    return rows


def shown(value):
    return "—" if value is None else f"{value:,}".replace(",", " ")


def print_usage(folder, transcript):
    log(f"\n{folder}")
    log(f"  transcript : {transcript}")
    rows = usage_rows(transcript) if transcript and transcript.is_file() else []
    if not rows:
        log("  aucune requête lue")
    for row in rows:
        parts = [row[name] for name, _ in COUNTERS]
        total = None if None in parts else sum(parts)
        log(f"  tour {row['tour']} · ligne {row['ligne']} · {row['modele'] or '—'} : entrée {shown(parts[0])}, "
            f"cache écrit {shown(parts[1])}, cache lu {shown(parts[2])}, total {shown(total)}")


# --- le lancement -------------------------------------------------------------


def mods(home):
    """Les plugins installés qui sont des mods (`hooks/hooks.json` déclare des modules), d'après
    `plugins/installed_plugins.json` ; une entrée d'une autre forme, ou un id hors de la forme
    `<plugin>@<marketplace>`, est écartée."""
    data = json_file(home / "plugins" / "installed_plugins.json")
    installed = data.get("plugins") if isinstance(data, dict) else None
    found = []
    for plugin_id, entries in (installed if isinstance(installed, dict) else {}).items():
        if not PLUGIN_ID.fullmatch(plugin_id):
            continue
        for entry in entries if isinstance(entries, list) else [entries]:
            path = entry.get("installPath") if isinstance(entry, dict) else None
            hooks = json_file(Path(path) / "hooks" / "hooks.json") if isinstance(path, str) and os.path.isabs(path) else None
            if isinstance(hooks, dict) and hooks.get("modules"):
                found.append(plugin_id)
                break
    return sorted(found)


@dataclass
class Run:
    folder: Path
    sid: str
    name: str
    new_dirs: list
    transcript: Path = None
    note: str = None
    # Vrai si la session tournait encore après l'arrêt : rien de ce lancement ne s'efface alors.
    alive: bool = False


def tmux_cmd(tmux, *args):
    return subprocess.run([tmux, *args], capture_output=True, text=True, timeout=30)


def running(tmux, home, run):
    """Vrai si la session tourne encore : sa session tmux (nom exact) ou un registre `sessions/<pid>.json`
    dont le `sessionId` est le sien (son nom est celui du processus, jamais l'id)."""
    res = tmux_cmd(tmux, "has-session", "-t", f"={run.name}")
    # Seule une réponse de tmux qui dit la session absente vaut « arrêtée » : toute autre erreur (socket,
    # droits, serveur) laisse croire qu'elle tourne, et rien ne s'efface.
    gone = res.returncode != 0 and any(s in res.stderr for s in ("can't find session", "no server running"))
    return not gone or bool(open_sessions(home, run.sid))


def find_transcript(home, run):
    for project in project_dirs(home, run.folder):
        path = project / f"{run.sid}.jsonl"
        if path.is_file() and not path.is_symlink():
            return path
    return None


def wait_turn(home, run, tour):
    """Attend que le transcript porte la réponse du tour `tour` et ne bouge plus ; False au bout du délai."""
    deadline, last = time.monotonic() + TURN_TIMEOUT, None
    while time.monotonic() < deadline:
        run.transcript = run.transcript or find_transcript(home, run)
        if run.transcript:
            rows = usage_rows(run.transcript)
            size = run.transcript.stat().st_size
            if rows and rows[-1]["tour"] >= tour and size == last:
                return True
            last = size
        time.sleep(SETTLE)
    return False


def launch(tmux, claude, home, run, settings, tours):
    command = ["env", *[a for v in INHERITED for a in ("-u", v)], str(claude), "--model", MODEL, "--effort", EFFORT,
               "--settings", settings, "--session-id", run.sid, PROMPTS[0]]
    # Le programme et ses arguments, chacun à part : tmux les lance sans shell (aucune citation à faire).
    res = tmux_cmd(tmux, "new-session", "-d", "-s", run.name, "-x", "200", "-y", "50", "-c", str(run.folder),
                   "--", *command)
    if res.returncode != 0:
        run.note = f"tmux : {res.stderr.strip()}"
        return
    for tour in range(1, tours + 1):
        if tour > 1:
            time.sleep(PAUSE)
            # Une cible de volet : le nom exact de la session (`=`), suivi de `:` (sans lui, tmux le lit
            # comme un nom de volet et ne le trouve pas).
            for keys in (["-l", "--", PROMPTS[1]], ["Enter"]):
                res = tmux_cmd(tmux, "send-keys", "-t", f"={run.name}:", *keys)
                if res.returncode != 0:
                    run.note = f"tour {tour} pas envoyé (tmux : {res.stderr.strip()})"
                    return
        if not wait_turn(home, run, tour):
            run.note = f"pas de réponse au tour {tour} en {TURN_TIMEOUT} s : session arrêtée"
            return


def stop(tmux, home, run):
    """Arrête la session et attend sa sortie ; False si elle tourne encore (rien ne s'efface alors)."""
    tmux_cmd(tmux, "kill-session", "-t", f"={run.name}")
    deadline = time.monotonic() + EXIT_TIMEOUT
    while time.monotonic() < deadline:
        if not running(tmux, home, run):
            return True
        time.sleep(1)
    return False


def stop_all(tmux, home, runs):
    """Arrête chaque session lancée. Une session dont l'arrêt n'est pas constaté (elle tourne encore, une
    erreur, un nouveau Ctrl-C pendant l'attente) compte comme vivante : rien d'elle ne s'efface."""
    for run in runs:
        try:
            run.alive = not stop(tmux, home, run)
        except (KeyboardInterrupt, Exception):
            run.alive = True


def clean_runs(home, runs, keep):
    """Le nettoyage de chaque lancement, dans l'ordre : rend chaque rapport dès qu'il est fait, pour qu'il
    s'affiche avant le suivant. Le premier effacement qui échoue, ou un Ctrl-C, arrête le nettoyage de tous
    les dossiers : les suivants ne sont plus touchés, et leurs traces sont dites restantes. Une session qui
    tourne encore garde tout, sans arrêter les autres."""
    stopped = None
    for run in runs:
        try:
            traces = id_traces(home, run.sid)
            if stopped:
                report = Report(kept=[f"{p} (nettoyage arrêté plus haut : {stopped})" for p in traces])
            elif run.alive:
                report = Report(kept=traces, error="la session tourne encore : rien ne s'efface")
            else:
                report = clean(home, run.folder, run.sid, keep=keep, new_dirs=run.new_dirs)
                stopped = report.error
                # Les autres traces de la session sous ~/.claude : nommées, jamais effacées.
                report.kept += [f"{p} (trace de la session hors de ~/.claude/projects, laissée)"
                                for p in id_traces(home, run.sid) if Path(p).parent.parent.name != "projects"]
        except KeyboardInterrupt:
            stopped = INTERRUPTED
            report = Report(kept=[f"traces de la session {run.sid} non relues"], error=INTERRUPTED)
        yield run, report


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dossiers", nargs="+", help="les dossiers où mesurer le départ")
    parser.add_argument("--tours", type=int, default=2, help="nombre de tours (2 par défaut : les connecteurs arrivent au deuxième)")
    parser.add_argument("--garder", action="store_true", help="n'efface rien, donne les chemins")
    args = parser.parse_args()
    if args.tours < 1:
        parser.error("--tours : 1 au moins")
    tmux, claude = shutil.which("tmux"), shutil.which("claude")
    if not tmux or not claude:
        sys.exit(f"{'tmux' if not tmux else 'claude'} introuvable")
    home = claude_home()
    runs = []
    for given in args.dossiers:
        folder = Path(os.path.realpath(given))
        if not folder.is_dir():
            sys.exit(f"{given} : pas un dossier")
        sid = str(uuid.uuid4())
        if not SESSION_ID.fullmatch(sid):
            sys.exit(f"id tiré hors forme : {sid}")
        taken = id_traces(home, sid)
        if taken:
            sys.exit(f"id {sid} déjà pris ({', '.join(taken)}) : rien n'est lancé")
        runs.append(Run(folder, sid, f"mesure-{sid}", [p for p in project_dirs(home, folder) if not p.exists() and not p.is_symlink()]))
    settings = json.dumps({"enabledPlugins": {m: False for m in mods(home)}})
    log(f"Mods coupés : {', '.join(json.loads(settings)['enabledPlugins']) or 'aucun'}")
    started, interrupted, failed = [], False, False
    try:
        for run in runs:
            log(f"→ {run.folder} : session {run.sid} (tmux {run.name})")
            started.append(run)
            launch(tmux, claude, home, run, settings, args.tours)
            run.alive = not stop(tmux, home, run)
    except (KeyboardInterrupt, Exception) as err:
        # Un Ctrl-C ou toute autre erreur (tmux qui ne répond plus, transcript disparu) : les sessions
        # lancées s'arrêtent, puis le nettoyage passe quand même.
        interrupted = isinstance(err, KeyboardInterrupt)
        failed = not interrupted
        log("\nInterrompu" if interrupted else f"\nErreur ({type(err).__name__} : {err})")
        log("Arrêt des sessions lancées, puis nettoyage.")
        stop_all(tmux, home, started)
    try:
        for run in started:
            print_usage(run.folder, run.transcript or find_transcript(home, run))
            if run.note:
                log(f"  {run.note}")
    except (KeyboardInterrupt, OSError) as err:
        interrupted = interrupted or isinstance(err, KeyboardInterrupt)
        log("\nAffichage interrompu : nettoyage quand même.")
    log("\nNettoyage" + (" (--garder : rien n'est effacé)" if args.garder else ""))
    try:
        for run, report in clean_runs(home, started, args.garder):
            log(f"{run.folder} · {run.sid}")
            for line in report.lines():
                log(f"  {line}")
            failed = failed or bool(report.error)
            interrupted = interrupted or report.error == INTERRUPTED
    except KeyboardInterrupt:
        interrupted = True
        log("\nNettoyage interrompu (Ctrl-C) : les dossiers suivants ne sont pas nettoyés.")
    sys.exit(130 if interrupted else 1 if failed else 0)


if __name__ == "__main__":
    main()
