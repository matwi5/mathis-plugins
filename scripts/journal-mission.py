#!/usr/bin/env python3
"""Sort le journal d'une mission de flow-board entrelacé avec les arrêts et reprises de ses discussions.

    python3 scripts/journal-mission.py <titre ou id de la mission>

Pour trouver pourquoi une mission s'est détachée de sa discussion, il fallait croiser à la main le journal
de la mission (le fichier des missions de flow-board) et les fins et reprises des sessions, lues dans leurs
transcripts. Le script le fait, en lecture seule :

1. il cherche la mission dans les fichiers des missions, `~/.claude/flow-board/parcours/*.json` (un par
   dossier de projet ou de worktree ; `CLAUDE_CONFIG_DIR` remplace `~/.claude`) : par son id exact, sinon
   par son titre exact (sans tenir compte de la casse), sinon par un titre qui contient le texte donné ; plusieurs
   missions désignées : il donne leur liste (id, titre, fichier) et s'arrête (code 1) ; la même mission dans
   plusieurs fichiers : il prend celle mise à jour en dernier et nomme les autres ;
2. il lit les discussions qui l'ont tenue ou où elle est née, `owner` et `bornIn` de la mission : un id qui
   n'a pas la forme d'un id de session (lettres et chiffres ASCII et `-`, 100 signes au plus) n'entre dans
   aucun chemin, il est ignoré et signalé ; le transcript d'un id en forme se cherche sous
   `~/.claude/projects/<dossier>/<id>.jsonl`, un fichier ordinaire (pas un lien) dont le chemin résolu reste
   sous `projects/` ; un transcript absent se dit ;
3. de chaque transcript, il ne garde que le type de quelques entrées et leur date, jamais le texte d'un
   message : le démarrage (la première entrée datée), chaque fin de processus (une entrée `cost-state`,
   que Claude Code écrit en quittant, sans date : la ligne dit « dernière activité », la date de la
   dernière entrée datée avant elle, qui peut précéder de longtemps la fin réelle d'une session restée
   ouverte), chaque reprise (« première entrée datée » après une fin, souvent le premier message, qui
   peut suivre de longtemps la réouverture), chaque réouverture refermée sans rien écrire de daté (une
   autre `cost-state` aux totaux différents juste après, comptée sur la ligne de la fin ; une
   continuation `continued-in` coupe cette suite), chaque
   compaction (`compact_boundary`, avec son déclencheur, `manual` ou `auto`) et chaque continuation sous
   un autre id (une entrée `continued-in`, qu'un autre processus écrit après la fin, sortie « continuée
   dans la discussion <id> », jamais comme une reprise ; un id hors forme s'y cite sans entrer dans un
   chemin, et la discussion où elle continue n'est pas lue). Un processus tué n'écrit pas de fin : sa
   reprise ne se voit alors pas ;
4. il sort une ligne par événement, triée par date (UTC) : les lignes du journal de la mission et,
   entrelacés, les événements de ses discussions, chacun avec le début de l'id de sa discussion.

Une date hors de 2020 à 2100, sans fuseau, ou qui ne se lit pas, est écartée à la lecture, comme une ligne
de transcript illisible. Codes : 0 journal sorti, 1 mission introuvable ou désignée plusieurs fois,
2 mauvais arguments. Sans dépendance hors de la bibliothèque standard.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SESSION_ID = re.compile(r"[A-Za-z0-9-]{1,100}", re.ASCII)
# Les dates plausibles, en millisecondes depuis 1970 : une date hors de ces bornes est écartée.
EARLIEST = datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
LATEST = datetime(2100, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
# Les rôles d'une discussion pour la mission, dans l'ordre où ils se disent.
ROLES = (("owner", "titulaire"), ("bornIn", "née dans"))
SHORT = 8


def base_dir():
    """Le dossier de configuration de Claude Code : `CLAUDE_CONFIG_DIR`, sinon `~/.claude`."""
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")


def as_ms(value):
    """Une date du journal (millisecondes) ou d'un transcript (ISO 8601) en millisecondes, bornée ; None si
    elle ne se lit pas ou sort des bornes."""
    if isinstance(value, bool):
        return None
    try:
        if isinstance(value, (int, float)):
            ms = float(value)
        elif isinstance(value, str) and len(value) <= 40:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
            # Sans fuseau, la date serait lue à l'heure locale puis montrée en UTC : écartée.
            if moment.tzinfo is None:
                return None
            ms = moment.timestamp() * 1000
        else:
            return None
    except (ValueError, OverflowError, OSError):
        return None
    return ms if ms == ms and EARLIEST <= ms <= LATEST else None


def shown(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def quoted(value, limit=60):
    """Une valeur lue d'un fichier, citée sans caractère de contrôle ni saut de ligne (`ascii`), tronquée."""
    # Une valeur qui n'est pas un scalaire (liste, objet, peut-être très imbriqué) se cite par son type seul.
    text = ascii(value) if isinstance(value, (str, int, float, bool, type(None))) else f"<{type(value).__name__}>"
    return text if len(text) <= limit else text[:limit] + "…"


def clean(text, limit=300):
    """Le texte d'une ligne du journal de la mission sur une seule ligne, sans caractère de contrôle."""
    text = "".join(c if c.isprintable() else " " for c in str(text))
    return text if len(text) <= limit else text[:limit] + "…"


def missions(base):
    """Les missions de chaque fichier des missions : (fichier, mission) ; un fichier illisible est sauté."""
    folder = base / "flow-board" / "parcours"
    found = []
    try:
        entries = sorted(os.scandir(folder), key=lambda e: e.name)
    except OSError:
        return found
    for entry in entries:
        if not entry.name.endswith(".json") or not entry.is_file(follow_symlinks=False):
            continue
        try:
            data = json.loads(Path(entry.path).read_text(encoding="utf-8"))
        except (OSError, ValueError, RecursionError):
            continue
        runs = data.get("runs") if isinstance(data, dict) else None
        for run in runs if isinstance(runs, list) else []:
            if isinstance(run, dict) and isinstance(run.get("id"), str):
                found.append((Path(entry.path), run))
    return found


def pick(found, wanted):
    """Les missions que désigne `wanted` : id exact, sinon titre exact, sinon titre qui le contient."""
    folded = wanted.casefold()
    title = lambda run: run.get("title") if isinstance(run.get("title"), str) else ""
    for match in (lambda run: run["id"] == wanted, lambda run: title(run).casefold() == folded,
                  lambda run: folded in title(run).casefold()):
        chosen = [(path, run) for path, run in found if match(run)]
        if chosen:
            return chosen
    return []


def transcript_events(path, session):
    """Les événements d'un transcript : (ms, discussion, texte), sans le texte d'aucun message. Une fin est
    datée de la dernière activité avant elle, une reprise de la première entrée datée après elle ; des
    `cost-state` de suite sans entrée datée entre elles, aux totaux différents, sont autant de processus
    rouverts puis refermés sans rien écrire de daté : ils se comptent sur la ligne de la fin."""
    events, last, ended, quiet, seen, fin = [], None, False, 0, None, None
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                entry = json.loads(line)
            except (ValueError, RecursionError):
                continue
            if not isinstance(entry, dict):
                continue
            if entry.get("type") == "cost-state":
                totals = (entry.get("totalDuration"), entry.get("totalCostUSD"))
                if not ended:
                    fin = None
                    if last is not None:
                        fin = len(events)
                        events.append([last, session, "fin du processus (dernière activité)"])
                    quiet = 0
                elif totals != seen and fin is not None:
                    quiet += 1
                    events[fin][2] = (f"fin du processus (dernière activité), puis {quiet} réouverture(s) refermée(s) "
                                      f"sans entrée datée")
                ended, seen = True, totals
                continue
            ms = as_ms(entry.get("timestamp"))
            if ms is None:
                continue
            if entry.get("type") == "continued-in":
                # La discussion continue sous un autre id : ce n'est pas une reprise sur place. Elle coupe la suite
                # des `cost-state` : celles qui la suivent ne sont pas des réouvertures de la fin d'avant.
                other = entry.get("continuedInSessionId")
                if other is None:
                    named = "(id absent)"
                elif isinstance(other, str) and SESSION_ID.fullmatch(other):
                    named = other
                else:
                    named = f"id hors forme {quoted(other)}"
                events.append([ms, session, f"continuée dans la discussion {named}"])
                fin = None
                continue
            if last is None:
                events.append([ms, session, "démarrage"])
            elif ended:
                events.append([ms, session, "reprise (première entrée datée)"])
            ended = False
            last = ms
            if entry.get("type") == "system" and entry.get("subtype") == "compact_boundary":
                meta = entry.get("compactMetadata")
                trigger = meta.get("trigger") if isinstance(meta, dict) else None
                events.append([ms, session, "compaction" + (f" ({trigger})" if trigger in ("manual", "auto") else "")])
    return [tuple(event) for event in events]


def transcripts(base, session):
    """Les transcripts d'un id de session en forme : des fichiers ordinaires sous `projects/`."""
    projects = base / "projects"
    try:
        root = projects.resolve()
        folders = sorted(os.scandir(projects), key=lambda e: e.name)
    except OSError:
        return []
    found = []
    for folder in folders:
        if not folder.is_dir(follow_symlinks=False):
            continue
        path = Path(folder.path) / f"{session}.jsonl"
        if path.is_file() and not path.is_symlink() and root in path.resolve().parents:
            found.append(path)
    return found


def journal(wanted, base=None):
    """Les lignes à sortir, et le code de sortie."""
    base = base or base_dir()
    chosen = pick(missions(base), wanted)
    if not chosen:
        return [f"aucune mission ne porte l'id ou le titre {quoted(wanted)} sous {base / 'flow-board' / 'parcours'}"], 1
    if len({run["id"] for _, run in chosen}) > 1:
        lines = [f"{len(chosen)} missions désignées par {quoted(wanted)} : en donner l'id"]
        lines += [f"  {quoted(run['id'])}  {clean(run.get('title', ''))}  ({path.name})" for path, run in chosen]
        return lines, 1
    updated = lambda item: as_ms(item[1].get("updatedAt")) or 0
    path, run = max(chosen, key=updated)
    lines = [f"Mission {clean(run['id'])} « {clean(run.get('title', ''))} » ({path})"]
    others = [p.name for p, _ in chosen if p != path]
    if others:
        lines.append(f"aussi dans : {', '.join(others)} (mise à jour plus tôt)")
    events = []
    log = run.get("log")
    for item in log if isinstance(log, list) else []:
        ms = as_ms(item.get("at")) if isinstance(item, dict) else None
        if ms is not None:
            glyph = clean(item.get("glyph", ""), 4) if isinstance(item.get("glyph"), str) else ""
            events.append((ms, None, f"{glyph} {clean(item.get('text', ''))}".strip()))
    roles = {}
    for key, role in ROLES:
        value = run.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or not SESSION_ID.fullmatch(value):
            lines.append(f"{key} ignoré : {quoted(value)} n'a pas la forme d'un id de session")
            continue
        roles.setdefault(value, []).append(role)
    for session, names in roles.items():
        found = transcripts(base, session)
        label = f"discussion {session} ({', '.join(names)})"
        if not found:
            lines.append(f"{label} : transcript introuvable sous {base / 'projects'}")
            continue
        lines.append(f"{label} : {', '.join(str(p) for p in found)}")
        for transcript in found:
            try:
                events += transcript_events(transcript, session)
            except OSError as err:
                lines.append(f"{label} : transcript illisible ({err})")
    lines.append("")
    for ms, session, text in sorted(events, key=lambda e: e[0]):
        who = "mission" if session is None else f"discussion {session[:SHORT]}"
        lines.append(f"{shown(ms)}  {who:<19}  {text}")
    return lines, 0


def main(argv):
    if argv[:1] in (["--aide"], ["-h"], ["--help"]):
        print(__doc__)
        return 0
    if len(argv) != 1 or not argv[0].strip():
        print("python3 scripts/journal-mission.py <titre ou id de la mission>", file=sys.stderr)
        return 2
    lines, code = journal(argv[0].strip())
    print("\n".join(lines), file=sys.stdout if code == 0 else sys.stderr)
    return code


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
