#!/usr/bin/env python3
"""Sort le journal d'une mission de flow-board entrelacé avec les arrêts et reprises de ses discussions.

    python3 scripts/journal-mission.py <titre ou id de la mission>
    python3 scripts/journal-mission.py --modeles <titre ou id de la mission>
    python3 scripts/journal-mission.py --relances <titre ou id de la mission>

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
4. il sort une ligne par événement, triée par date : les lignes du journal de la mission et, entrelacés,
   les événements de ses discussions, chacun avec le début de l'id de sa discussion ; les dates sont en
   UTC, et la dernière ligne de l'en-tête (juste avant la ligne vide, avec chaque option) le dit ;
5. un journal au plafond (`LOG_CAP` entrées ou plus, lisibles ou non : le mod n'en garde que les plus
   récentes) le dit en tête, après la ligne « Mission … » : la date de la plus ancienne entrée gardée (ce
   qui précède est perdu ; avec des entrées sans date lisible, celle de la plus ancienne entrée datée, et
   leur nombre), le début de la mission (le `startedAt` de sa première phase) et le premier
   démarrage des discussions lues, qui n'est pas celui de la mission ; sous le plafond, rien.

Avec `--modeles`, il sort à la place du journal, pour les mêmes discussions (étapes 1 et 2), qui a tourné sur
quel modèle et à quel effort, dans l'ordre du temps et toujours sans le texte d'aucun message : une ligne par
requête du fil principal (une entrée `api-request` de `querySource` `repl_main_thread`, ou `sdk` sous Claude
Desktop quand sa réponse est hors fil secondaire ; les autres se comptent sur une ligne à part), avec le modèle et
l'effort envoyés (`params.model`, `params.output_config.effort`) et le modèle qui a répondu (`message.model`
de la première réponse `assistant` hors fil secondaire dont `requestRef` est l'id de la requête ; « ? » sans
réponse) ; et, à leur place, les bascules : le modèle annoncé à la session (pièce jointe `model`), un
`remote_session_change` (avec le modèle que nomme sa ligne `Co-Authored-By`, quand elle en nomme un), et les
commandes `/model`, `/effort` et `/reload-plugins` tapées (leurs arguments seulement quand ils sont un mot
court de lettres, chiffres, `.`, `_` et `-` ; un autre argument se dit « (argument masqué) »). Les lignes du
journal de la mission n'y sont pas.

Avec `--relances`, il sort à la place du journal, pour les mêmes discussions, une ligne par reprise (la date de
la ligne « reprise » du journal) avec ce qui l'a relancée : l'origine (clé `origin`) de la première entrée
`user` du fil principal, hors résultat d'outil, qui en porte une sous forme d'objet, de la reprise à la fin
suivante. Seul son genre en sort : « utilisateur » (`human`), « mod » (`plugin`, suivi de son nom quand il a
la forme d'un nom de plugin), « autre session » (`peer` ; « autre session, par le mod » et le nom quand elle
porte une clé `plugin`), « fin d'une tâche de fond » (`task-notification`), sinon « autre » (suivi du genre
quand il est un mot court), suivi de « (après N entrée(s) sans origine) » quand des entrées `user` sans origine
la précèdent (l'origine lue n'est alors peut-être pas ce qui a relancé la discussion) ; sans origine objet, « origine non notée », et sans message, « aucun message avant
la fin suivante » (ou « avant la fin du transcript »). Jamais `body`, `from` ni le `name` d'une autre session,
ni le texte d'un message. Comme pour le journal, un processus tué n'écrit pas de fin : sa reprise ne se voit pas.

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
# Le plafond du journal d'une mission : `LIMITS.log` de plugins/flow-board/hooks/basics.ts (le mod y garde les
# entrées les plus récentes). Un test compare les deux valeurs.
LOG_CAP = 80
# La dernière ligne de l'en-tête : les dates sorties (`shown`) sont en UTC, jamais à l'heure locale.
UTC_LINE = "heures en UTC (temps universel, pas l'heure locale)"


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


# Un nom de plugin montré par `--relances` (`flow-board`) ; un genre d'origine inconnu (`cron-tick`).
PLUGIN_NAME = re.compile(r"[a-z0-9-]{1,40}", re.ASCII)
KIND_WORD = re.compile(r"[A-Za-z0-9-]{1,40}", re.ASCII)
ORIGINS = {"human": "utilisateur", "task-notification": "fin d'une tâche de fond"}


def named(value, form):
    """`value` précédé d'une espace s'il est une chaîne en `form`, sinon rien."""
    return f" {value}" if isinstance(value, str) and form.fullmatch(value) else ""


def origin_said(origin):
    """Le genre d'une origine (la clé `origin` d'une entrée `user`, un objet), sans aucun texte : jamais `body`,
    `from` ni le `name` d'une autre session ; seuls un nom de plugin ou un genre en forme en sortent."""
    kind = origin.get("kind")
    if not isinstance(kind, str):
        return "autre"
    if kind in ORIGINS:
        return ORIGINS[kind]
    if kind == "plugin":
        return "mod" + named(origin.get("name"), PLUGIN_NAME)
    if kind == "peer":
        return ("autre session, par le mod" + named(origin.get("plugin"), PLUGIN_NAME) if "plugin" in origin
                else "autre session")
    return "autre" + named(kind, KIND_WORD)


def is_message(entry):
    """Une entrée `user` du fil principal qui n'est pas un résultat d'outil."""
    if entry.get("type") != "user" or entry.get("isSidechain") or "toolUseResult" in entry:
        return False
    message = entry.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    return not (isinstance(content, list) and any(isinstance(p, dict) and p.get("type") == "tool_result"
                                                  for p in content))


def transcript_events(path, session, relances=False):
    """Les événements d'un transcript : (ms, discussion, texte), sans le texte d'aucun message. Une fin est
    datée de la dernière activité avant elle, une reprise de la première entrée datée après elle ; des
    `cost-state` de suite sans entrée datée entre elles, aux totaux différents, sont autant de processus
    rouverts puis refermés sans rien écrire de daté : ils se comptent sur la ligne de la fin.

    Avec `relances`, seulement les reprises, chacune avec l'origine de la première entrée `user` du fil principal
    (hors résultat d'outil) qui porte une origine objet, de la reprise à la fin suivante (`origin_said`), suivie du
    nombre d'entrées `user` sans origine qui la précèdent, quand il y en a ; à défaut,
    « origine non notée » quand des entrées `user` n'en portaient pas, sinon « aucun message avant la fin suivante »
    (ou « avant la fin du transcript » quand aucune fin ne suit)."""
    events, last, ended, quiet, seen, fin = [], None, False, 0, None, None
    resumes, pending = [], None

    def close(next_end):
        # La reprise en cours n'a trouvé aucune origine objet avant la fin suivante (ou celle du transcript).
        if pending is not None:
            resumes.append((pending[0], session, "reprise — origine : " + (
                "origine non notée" if pending[1] else
                "aucun message avant la fin suivante" if next_end else "aucun message avant la fin du transcript")))

    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                entry = json.loads(line)
            except (ValueError, RecursionError):
                continue
            if not isinstance(entry, dict):
                continue
            if entry.get("type") == "cost-state":
                close(True)
                pending = None
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
                pending = [ms, 0]
            if pending is not None and is_message(entry):
                origin = entry.get("origin")
                if isinstance(origin, dict):
                    # Des entrées `user` sans origine avant elle : l'origine lue peut ne pas être ce qui a relancé.
                    before = f" (après {pending[1]} entrée(s) sans origine)" if pending[1] else ""
                    resumes.append((pending[0], session, f"reprise — origine : {origin_said(origin)}{before}"))
                    pending = None
                else:
                    pending[1] += 1
            ended = False
            last = ms
            if entry.get("type") == "system" and entry.get("subtype") == "compact_boundary":
                meta = entry.get("compactMetadata")
                trigger = meta.get("trigger") if isinstance(meta, dict) else None
                events.append([ms, session, "compaction" + (f" ({trigger})" if trigger in ("manual", "auto") else "")])
    close(False)
    return resumes if relances else [tuple(event) for event in events]


# Un argument de commande montré : un mot court (`opus`, `claude-fable-5-2`, `high`), jamais un texte libre.
WORD = re.compile(r"[A-Za-z0-9._-]{1,40}", re.ASCII)
# Le modèle que nomme la ligne d'attribution d'un `remote_session_change` (« Claude Opus 5.5 »).
ATTRIBUTED = re.compile(r"Co-Authored-By: Claude ([A-Za-z]+ \d+(?:\.\d+)?)", re.ASCII)
SWITCHES = ("/model", "/effort", "/reload-plugins")


def model_events(path, session):
    """Les requêtes du fil principal et les bascules de modèle d'un transcript : (ms, discussion, texte), sans
    le texte d'aucun message (seuls des noms de modèle, des efforts et des noms de commande en sortent)."""
    requests, answered, events = [], {}, []
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                entry = json.loads(line)
            except (ValueError, RecursionError):
                continue
            if not isinstance(entry, dict):
                continue
            kind = entry.get("type")
            if kind == "assistant":
                message = entry.get("message")
                ref = entry.get("requestRef")
                if not entry.get("isSidechain") and isinstance(ref, str) and isinstance(message, dict):
                    answered.setdefault(ref, message.get("model"))
                continue
            ms = as_ms(entry.get("timestamp"))
            if ms is None:
                continue
            if kind == "api-request":
                params = entry.get("params") if isinstance(entry.get("params"), dict) else {}
                config = params.get("output_config") if isinstance(params.get("output_config"), dict) else {}
                requests.append((ms, entry.get("id"), params.get("model"), config.get("effort"), entry.get("querySource")))
            elif kind == "attachment" and isinstance(entry.get("attachment"), dict):
                attachment = entry["attachment"]
                if attachment.get("type") == "model":
                    identity = attachment.get("identity") if isinstance(attachment.get("identity"), dict) else {}
                    events.append((ms, session, f"bascule : modèle annoncé {model_name(identity.get('modelId'))}"))
                elif attachment.get("type") == "remote_session_change":
                    named = ATTRIBUTED.search(attachment.get("commit") if isinstance(attachment.get("commit"), str) else "")
                    events.append((ms, session, "bascule : remote_session_change" + (f" ({named[1]})" if named else "")))
            elif kind == "user" and not entry.get("isSidechain"):
                command = typed_command(entry.get("message"))
                if command:
                    events.append((ms, session, f"bascule : {command}"))
    skipped = []
    for ms, request, sent, effort, source in requests:
        answer = answered.get(request) if isinstance(request, str) else None
        # Le fil principal : `repl_main_thread` au terminal ; `sdk` sous Claude Desktop, quand sa réponse est hors
        # fil secondaire. Toute autre requête (un spécialiste, un appel `sdk` sans réponse du fil principal) est
        # comptée à part, pour qu'un écart se voie.
        if source == "repl_main_thread" or (source == "sdk" and isinstance(request, str) and request in answered):
            events.append((ms, session, f"requête : envoyé {model_name(sent)} / {model_name(effort, 'sans effort')} "
                                        f"→ répondu {model_name(answer, '?')}"))
        else:
            skipped.append(ms)
    if skipped:
        events.append((max(skipped), session, f"{len(skipped)} requête(s) hors du fil principal écartée(s) (autre "
                                              f"source, ou sdk sans réponse du fil principal)"))
    return events


def model_name(value, missing="?"):
    """Un nom de modèle ou d'effort lu dans un transcript : un mot court, sinon cité (`quoted`)."""
    if value is None:
        return missing
    return value if isinstance(value, str) and WORD.fullmatch(value) else quoted(value, 40)


def typed_command(message):
    """La commande de bascule (`SWITCHES`) qu'un message tapé porte, avec son argument s'il est un mot court ;
    None pour tout autre message, dont rien ne sort."""
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str):
        return None
    name = re.search(r"<command-name>(/[A-Za-z0-9:_-]+)</command-name>", content)
    if not name or name[1] not in SWITCHES:
        return None
    args = re.search(r"<command-args>([^<]*)</command-args>", content)
    word = args[1].strip() if args else ""
    if not word:
        return name[1]
    return name[1] + (f" {word}" if WORD.fullmatch(word) else " (argument masqué)")


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


def capped(run, events, count):
    """Les lignes d'en-tête d'un journal au plafond (`count` entrées, lisibles ou non) : la plus ancienne
    entrée datée gardée (et le nombre d'entrées sans date lisible, qui peuvent être plus anciennes), le début
    de la mission (le `startedAt` de sa première phase) et le premier démarrage des discussions lues, pour
    qu'une lecture sache que le début du journal manque."""
    kept = [e[0] for e in events if e[1] is None]
    undated = count - len(kept)
    if not kept:
        oldest = "aucune entrée gardée n'a de date lisible"
    elif undated:
        oldest = f"la plus ancienne entrée datée gardée date du {shown(min(kept))} ({undated} sans date lisible)"
    else:
        oldest = f"la plus ancienne gardée date du {shown(min(kept))}"
    lines = [f"journal au plafond ({LOG_CAP} entrées) : {oldest} ; ce qui précède est perdu"]
    phases = run.get("phases")
    first = phases[0] if isinstance(phases, list) and phases and isinstance(phases[0], dict) else {}
    started = as_ms(first.get("startedAt"))
    lines.append(f"mission commencée le {shown(started)} (début de sa première phase)" if started is not None
                 else "début de la mission inconnu (date de sa première phase absente ou illisible)")
    starts = sorted((e for e in events if e[1] is not None and e[2] == "démarrage"), key=lambda e: e[0])
    lines.append(f"premier démarrage d'une discussion lue : {shown(starts[0][0])} (discussion {starts[0][1][:SHORT]}), "
                 f"le début d'une discussion, pas celui de la mission" if starts
                 else "premier démarrage d'une discussion inconnu (aucun transcript lu, ou sans entrée datée)")
    return lines


def journal(wanted, base=None, models=False, relances=False):
    """Les lignes à sortir, et le code de sortie ; avec `models`, les requêtes et bascules de modèle des
    discussions (`model_events`) à la place du journal et des événements de session ; avec `relances`, les
    reprises des discussions et leur origine (`transcript_events`), sans les lignes du journal."""
    detail = models or relances
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
    for item in log if isinstance(log, list) and not detail else []:
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
                events += (model_events(transcript, session) if models
                           else transcript_events(transcript, session, relances=relances))
            except OSError as err:
                lines.append(f"{label} : transcript illisible ({err})")
    if isinstance(log, list) and len(log) >= LOG_CAP and not detail:
        lines[1:1] = capped(run, events, len(log))
    lines += [UTC_LINE, ""]
    if relances and not events:
        lines.append("aucune reprise dans les transcripts lus")
    for ms, session, text in sorted(events, key=lambda e: e[0]):
        who = "mission" if session is None else f"discussion {session[:SHORT]}"
        lines.append(f"{shown(ms)}  {who:<19}  {text}")
    return lines, 0


def main(argv):
    if argv[:1] in (["--aide"], ["-h"], ["--help"]):
        print(__doc__)
        return 0
    models, relances = argv[:1] == ["--modeles"], argv[:1] == ["--relances"]
    rest = argv[1:] if models or relances else argv
    if len(rest) != 1 or not rest[0].strip() or rest[0] in ("--modeles", "--relances"):
        print("python3 scripts/journal-mission.py <titre ou id de la mission>\npython3 scripts/journal-mission.py --modeles "
              "<titre ou id de la mission>\npython3 scripts/journal-mission.py --relances <titre ou id de la mission>",
              file=sys.stderr)
        return 2
    lines, code = journal(rest[0].strip(), models=models, relances=relances)
    print("\n".join(lines), file=sys.stdout if code == 0 else sys.stderr)
    return code


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
