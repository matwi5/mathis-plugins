#!/usr/bin/env python3
"""Lance une session Claude Code avec la sonde des événements du moteur, dans tmux.

    python3 scripts/sonde.py                 Claude Code du terminal
    python3 scripts/sonde.py --desktop       le Claude Code embarqué par l'app desktop (le plus récent)
    python3 scripts/sonde.py --dir <dossier> dans ce dossier plutôt que dans un dossier jetable neuf
    python3 scripts/sonde.py --titre "<t>"   la sonde renvoie ce titre dans `sessionTitle` (une fois)
    python3 scripts/sonde.py --dir <dossier> --reprise   reprend la dernière session du dossier (--continue)
    python3 scripts/sonde.py --env CLE=VALEUR   passe cette variable à la session (répétable)
    python3 scripts/sonde.py --plugin scripts/sonde-essai   charge aussi ce plugin (répétable)
    python3 scripts/sonde.py --envoyer "<texte>" [--attendre <s>] [--voir]   tape ce texte puis Entrée dans la sonde lancée
    python3 scripts/sonde.py --touches Down Enter [--voir]   envoie ces touches tmux (choix d'un dialogue)
    python3 scripts/sonde.py --voir [--attendre <s>] [--lignes <n>]          la fin du volet de la sonde lancée
    python3 scripts/sonde.py --garder        lancer un essai sans nettoyage sous ~/.claude à sa fin
    python3 scripts/sonde.py --nettoyer <sonde-xxxxxxxx>   nettoie après un essai interrompu (kill-session)

La session tourne dans une session tmux détachée (nom : --name, « sonde » par défaut), en Haiku et
en effort low (--model, --effort), avec la sonde chargée par --plugin-dir. Pour jouer les
scénarios : `tmux attach -t sonde`, puis les quitter par Ctrl-b d ; ou, sans s'attacher, par
`--touches`, `--envoyer` et `--voir`, qui attendent eux-mêmes le délai demandé (une session Claude Code
ne peut pas lancer `sleep` au premier plan). Chaque processus de Claude Code (`/clear` compris) écrit son journal dans
le dossier `journaux/` du dossier jetable de la session (avec --dir, un dossier jetable à part), hors du
dépôt, dont le chemin s'affiche ; copier dans travail/ ce qui doit rester. Mode d'emploi et résultats :
docs/evenements-moteur.md.

Le journal de la sonde (`journaux/sonde.log`) porte `claude --version` du binaire essayé, au lancement et
à la sortie de Claude Code. À cette sortie (`/exit`), dans un dossier jetable neuf, la sonde supprime
sous `~/.claude` ce que ce lancement a laissé, et rien d'autre, ses sessions lues dans le journal de la
sonde (`sid`) : d'abord les registres d'agents de flow-board de ses sessions (`flow-board/agents/<id>.N.json`
puis `<id>.json`, la tête ayant ce dossier pour racine), puis les traces rangées par id des sessions qu'il
a ouvertes (un `classic.SessionStart` au démarrage ou par `/clear`, pas une reprise) : `session-env/<id>/`
(sans lien, entrée illisible ni sous-dossier non effaçable) et les relevés de stats-board
`stats-board/requetes/<id>_<heure en ms>.json` (de vrais fichiers), nés dans la fenêtre du lancement (de
la date de sa marque à la dernière écriture d'un journal de la sonde ; un session-env jamais là où le
système ne donne pas la date de création, comme Linux), puis son fichier de mission
(`flow-board/parcours/<nom>.json`, même racine, si le dossier de transcripts part aussi), enfin son dossier
de transcripts (s'il ne porte que les sessions de ce lancement, chaque transcript citant ce dossier),
arrêtée à la première suppression qui échoue ; `~/.claude.json`, fichier partagé, n'est ni lu ni écrit.
Au lancement, la sonde note dans la marque de son dossier jetable la clé `model` de `~/.claude/settings.json`
(le modèle par défaut du poste, qu'un `/model` tapé dans la sonde réécrit), sans toucher au fichier ; à la
sortie (et par `--nettoyer`), elle remet cette seule clé à la valeur notée (la retire si elle manquait),
seulement quand la valeur du moment est celle que le dernier `/model` de sa propre session a demandée (lue
dans son journal, `classic.PostModelSwitch`) et que le fichier date de ce `/model` (à quelques secondes
près), une fois par lancement, par un fichier voisin renommé sur l'ancien ; sinon (autre session, `sync.py`,
fichier absent, illisible ou changé entre-temps, `/model default`, `--garder`, `--dir`, `CLAUDE_CONFIG_DIR`
passé ou hérité), elle n'écrit rien, et son rapport donne la valeur d'avant et la commande `/model` qui la
remet.
Elle liste ce qu'elle a
supprimé et ce qui reste, au journal et dans le volet, qui reste ouvert jusqu'à Entrée. `--garder`, au
lancement, ne supprime rien (à prendre pour reprendre ensuite la session par `--dir … --reprise`). Rien
n'est nettoyé avec `--dir`, ni avec `--env CLAUDE_CONFIG_DIR=…`. Après un `tmux kill-session`, qui saute
cette étape : `--nettoyer <nom du dossier jetable>`, qui refuse un dossier sans le fichier que pose le
lancement (un essai d'avant cette version, ou une copie du dossier), un dossier qui a servi à un lancement `--dir`,
un dossier ou son fichier du lancement qui n'appartient pas à l'utilisateur courant ou qui est ouvert en
écriture au groupe ou aux autres (hors Windows ; l'étape de fin fait le même contrôle), et un dossier où
une session tourne encore.

Mac et Linux (tmux requis) ; sans dépendance hors de la bibliothèque standard.
"""

import argparse
import calendar
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

from check import desktop_claude

SONDE = Path(__file__).resolve().parent / "sonde"
# Les variables qu'une session Claude Code passe à ses commandes et qui lient la sonde à elle.
INHERITED = ("CLAUDE_CODE_SESSION_ID", "CLAUDECODE", "CLAUDE_CODE_SESSION_ATTENDED")
# Une affectation `--env CLE=VALEUR`.
ENV_ASSIGN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=.*", re.S)
# Le nom d'un dossier jetable de la sonde, tel que `mkdtemp(prefix="sonde-")` le donne (huit signes de
# `[a-z0-9_]`) : seul un tel nom désigne ce qu'un nettoyage peut supprimer.
JETABLE = re.compile(r"sonde-[a-z0-9_]{8}")
# Le fichier que le lancement pose dans son dossier jetable : sans lui, le dossier n'est pas de ce
# lancement (un essai plus ancien, un dossier venu d'ailleurs) et rien ne se supprime.
MARKER = ".sonde-lancement"
# Le journal de la sonde elle-même, dans le dossier des journaux : versions de Claude Code, nettoyage.
LOG_NAME = "sonde.log"
# L'id d'une session de Claude Code (le nom de son transcript) : seul un tel id entre dans un chemin.
SESSION_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# La fin du nom d'un morceau de registre de flow-board après l'id de session (`<id>.1.json`), en
# chiffres ASCII seulement.
CHUNK = re.compile(r"\.[0-9]{1,6}\.json")
# Le fichier qu'un lancement `--dir` pose dans un dossier jetable déjà marqué : ce dossier porte alors les
# traces d'un autre lancement, et `--nettoyer` le refuse.
REUSED = ".sonde-reprise"
# Les `source` d'un `classic.SessionStart` qui ouvrent une session sous un id neuf : le démarrage et `/clear`
# (pas la reprise, `resume`, ni la compaction, `compact`, qui garde l'id).
OPENING_SOURCES = ("startup", "clear")
# La fin du nom d'un relevé de requêtes de stats-board après l'id de session (`<id>_<heure d'ouverture en
# ms>.json`), en chiffres ASCII seulement.
REQUEST = re.compile(r"_[0-9]{1,20}\.json")
# La clé du modèle par défaut dans `~/.claude/settings.json`, qu'un `/model` tapé dans la sonde réécrit.
MODEL_KEY = "model"
# Le fichier que la remise du modèle pose dans le dossier jetable à sa première décision : un second
# nettoyage ne décide plus rien (une autre session a pu choisir entre-temps le même modèle).
MODEL_DONE = ".sonde-modele"
# Les `source` d'un `classic.PostModelSwitch` qui écrivent le défaut du poste : `/model` et le sélecteur.
SWITCH_SOURCES = ("command", "picker")
# La forme d'un nom de modèle que la sonde accepte de noter, de redire et d'écrire (un alias, un id, `opus[1m]`,
# un id Vertex `…@…` ou Bedrock `…:0`, un ARN), en signes ASCII, sans espace ni caractère de contrôle.
MODEL_FORM = re.compile(r"[A-Za-z0-9._:@/\[\]-]{1,200}", re.ASCII)
# Le nom d'un journal de la sonde : son heure d'ouverture, `toISOString()` aux `:` et `.` changés en `-`.
JOURNAL_STAMP = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2})-([0-9]{2})-([0-9]{2})-([0-9]{3})Z\.jsonl")
# L'écart toléré entre l'heure du dernier `/model` de la sonde et la date de modification de settings.json :
# au-delà, un autre a pu écrire le fichier depuis (marge estimée : l'ordre de l'écriture et de l'événement
# dans le moteur n'est pas observé).
SWITCH_SLACK_NS = 5_000_000_000


class SondeError(Exception):
    pass


def project_dir_name(folder):
    """Le nom du dossier de transcripts de Claude Code pour `folder` : chaque signe hors `[A-Za-z0-9]`
    devient `-`, sans fusion."""
    return re.sub(r"[^A-Za-z0-9]", "-", str(folder))


def mission_slug(folder):
    """Le nom du fichier de mission de flow-board pour `folder` (`sharedPath` de ses hooks) : en
    minuscules, chaque suite de signes hors `[a-z0-9]` fusionnée en `-`, `sans-projet` si vide."""
    slug = re.sub(r"[^a-z0-9]+", "-", str(folder).replace("\\", "/").rstrip("/").lower()).strip("-")
    return slug or "sans-projet"


def access_doubt(path):
    """La raison de ne pas tenir `path` (le dossier jetable ou sa marque) pour celui de ce compte, ou None :
    un autre propriétaire que l'utilisateur courant, ou des droits d'écriture au groupe ou aux autres
    (un autre compte du poste aurait pu le poser ou le modifier). Sans `os.getuid` (Windows, où les droits
    POSIX sont factices), rien n'est contrôlé ici."""
    getuid = getattr(os, "getuid", None)
    if getuid is None:
        return None
    # `os.lstat` en direct : le lien lui-même, jamais sa cible. Disparu ou illisible entre-temps : un refus.
    try:
        st = os.lstat(path)
    except OSError as err:
        return f"{path} illisible ({err.strerror or err})"
    if st.st_uid != getuid():
        return f"{path} appartient à un autre compte (uid {st.st_uid})"
    if st.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        return f"{path} est ouvert en écriture au groupe ou aux autres (droits {stat.S_IMODE(st.st_mode):o})"
    return None


def launch_folder(ref, tmp=None):
    """Le dossier jetable de ce lancement que nomme `ref` (son nom, ou son chemin absolu que donne
    l'étape de fin) : un nom de `mkdtemp`, un vrai dossier (pas un lien) qui appartient à l'utilisateur
    courant et n'est ouvert en écriture ni au groupe ni aux autres, qui porte le fichier du lancement
    (soumis aux mêmes contrôles de propriétaire et de droits, et qui nomme ce dossier) et pas celui d'une
    reprise par `--dir` ;
    sinon SondeError. Sous Windows, propriétaire et droits ne sont pas contrôlés (`access_doubt`)."""
    if not isinstance(ref, str):
        raise SondeError("nom de dossier jetable absent")
    given = Path(ref)
    name = given.name if given.is_absolute() else ref
    if not JETABLE.fullmatch(name):
        raise SondeError(f"« {ref} » n'est pas un dossier jetable de la sonde (sonde- puis 8 signes de [a-z0-9_])")
    folder = given if given.is_absolute() else Path(tmp or tempfile.gettempdir()) / name
    if folder.is_symlink() or not folder.is_dir():
        raise SondeError(f"{folder} : pas un dossier (ou un lien symbolique) ; rien à nettoyer")
    doubt = access_doubt(folder)
    if doubt:
        raise SondeError(f"{doubt} : rien ne se supprime")
    marker = read_json(folder / MARKER)
    if not isinstance(marker, dict):
        raise SondeError(f"{folder} n'a pas le fichier {MARKER} d'un lancement de la sonde : rien ne se supprime")
    doubt = access_doubt(folder / MARKER)
    if doubt:
        # Pas de « chmod » conseillé : une marque restée ouverte au groupe a pu être modifiée (son `claude` est
        # lancé par `--nettoyer`), et la fermer après coup la ferait accepter telle quelle.
        raise SondeError(f"{doubt} : rien ne se supprime")
    # La marque nomme le dossier où le lancement l'a posée : une copie du dossier (marque comprise) n'est
    # pas ce lancement.
    if marker.get("dossier") != os.path.realpath(folder):
        raise SondeError(f"{folder} n'est pas le dossier où le lancement a posé {MARKER} (copie ?) : rien ne se supprime")
    if (folder / REUSED).exists() or (folder / REUSED).is_symlink():
        raise SondeError(f"{folder} a servi à un lancement --dir ({REUSED}) : ses traces ne sont plus seulement "
                         "celles du lancement d'origine, rien ne se supprime")
    return folder


def mark_launch(folder, claude, model=None):
    """Pose dans le dossier jetable la marque de ce lancement : le dossier réel, le Claude Code essayé et,
    quand il est donné, l'état de la clé `model` du poste au lancement (`note_model`). Elle est fermée aux
    autres (0600), quel que soit l'umask : `launch_folder` refuse une marque ouverte en écriture au groupe ou
    aux autres."""
    # Dans le dossier neuf de `mkdtemp` : une marque déjà là (ou un lien à sa place) fait échouer le lancement.
    fd = os.open(folder / MARKER, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        if hasattr(os, "fchmod"):
            os.fchmod(f.fileno(), 0o600)
        data = {"dossier": os.path.realpath(folder), "claude": str(claude)}
        if model is not None:
            data["modele"] = model
        f.write(json.dumps(data) + "\n")


def note_model(settings):
    """L'état de la clé `model` du fichier de réglages du poste (`~/.claude/settings.json`), lu sans rien y
    écrire : {"etat": "valeur", "valeur": <texte>}, {"etat": "absent"} (fichier lisible sans la clé), ou
    {"etat": "illisible"} (fichier absent, lien, JSON invalide ou autre qu'un objet, valeur autre qu'un
    texte de la forme `MODEL_FORM`) : la sonde n'écrit alors jamais ce fichier."""
    data = read_json(settings)
    if not isinstance(data, dict):
        return {"etat": "illisible"}
    if MODEL_KEY not in data:
        return {"etat": "absent"}
    value = data[MODEL_KEY]
    return {"etat": "valeur", "valeur": value} if valid_model(value) else {"etat": "illisible"}


def valid_model(value):
    """Vrai pour un nom de modèle de la forme `MODEL_FORM` (un alias, un id, `opus[1m]`) : seule une telle
    valeur entre dans le rapport, la commande de l'étape de fin ou le fichier."""
    return isinstance(value, str) and MODEL_FORM.fullmatch(value) is not None


def valid_noted(noted):
    """Vrai pour une valeur notée au lancement que la remise peut écrire : « absent », ou « valeur » d'une
    forme valide (`valid_model`)."""
    return isinstance(noted, dict) and (noted.get("etat") == "absent"
                                        or (noted.get("etat") == "valeur" and valid_model(noted.get("valeur"))))


def model_label(noted):
    """La valeur notée au lancement et la commande `/model` qui la remet, en texte pour le rapport."""
    if noted.get("etat") == "valeur":
        return f"« {noted['valeur']} » (/model {noted['valeur']} la remet)"
    return "absente (/model default la remet)"


def journal_start_ns(path):
    """L'heure d'ouverture d'un journal de la sonde, lue dans son nom (`2026-11-16T10-00-00-000Z.jsonl`, que
    pose `register.tsx`), en nanosecondes depuis l'époque ; None pour un autre nom."""
    m = JOURNAL_STAMP.fullmatch(path.name)
    if not m:
        return None
    y, mo, d, h, mi, s, ms = (int(g) for g in m.groups())
    try:
        return (calendar.timegm((y, mo, d, h, mi, s, 0, 0, 0)) * 1000 + ms) * 1_000_000
    except (ValueError, OverflowError):
        return None


def last_model_switch(folder):
    """Le dernier `/model` des sessions de ce lancement (`classic.PostModelSwitch` du journal de la sonde,
    source `command` ou `picker` : un changement automatique ou une reprise n'écrit pas le défaut du poste),
    dans l'ordre des journaux (leur nom est l'heure d'ouverture), borné à la lecture : {"demande": le
    `requested_model` s'il est d'une forme valide, sinon None, "defaut": vrai pour `/model default`
    (`requested_model` nul), "a_ns": son heure (ouverture du journal plus son `t`, None si l'un manque ou
    est mal formé)} ; None sans lui. Lève OSError sur un journal illisible."""
    last = None
    for path in sorted((folder / "journaux").glob("*.jsonl")):
        if path.is_symlink() or not path.is_file():
            continue
        start = journal_start_ns(path)
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if isinstance(entry, dict) and entry.get("ev") == "classic.PostModelSwitch" \
                        and entry.get("source") in SWITCH_SOURCES:
                    asked, t = entry.get("requested_model"), entry.get("t")
                    ok_t = isinstance(t, (int, float)) and not isinstance(t, bool) and 0 <= t < 10 ** 12
                    last = {"demande": asked if valid_model(asked) else None,
                            "defaut": "requested_model" in entry and asked is None,
                            "a_ns": start + int(t * 1_000_000) if start is not None and ok_t else None}
    return last


def write_guarded(settings, raw, data, mtime=None):
    """Écrit `data` à la place de `settings` (mise en forme de `scripts/sync.py`), par un fichier voisin
    créé seul (O_EXCL, droits de l'original) puis renommé sur l'ancien, seulement si `settings` porte encore
    les octets `raw` lus avant et, quand elle est donnée, la date de modification `mtime` lue avec eux (une
    réécriture aux mêmes octets par un autre la change) : relus juste avant le renommage, il reste une fenêtre de quelques
    microsecondes. Lève OSError (le fichier voisin retiré) sur un échec ou un fichier changé entre-temps, et
    ValueError, avant toute écriture, pour un nombre que JSON n'écrit pas (`1e400` relu en infini)."""
    text = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    mode = stat.S_IMODE(os.lstat(settings).st_mode)
    neighbour = settings.with_name(f"{settings.name}.sonde-{os.getpid()}")
    fd = os.open(neighbour, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
            if hasattr(os, "fchmod"):
                os.fchmod(f.fileno(), mode)
        if settings.is_symlink() or settings.read_bytes() != raw \
                or (mtime is not None and os.lstat(settings).st_mtime_ns != mtime):
            raise OSError("le fichier a changé entre la lecture et l'écriture : pas écrasé")
        os.replace(neighbour, settings)
    except BaseException:
        try:
            neighbour.unlink()
        except OSError:
            pass
        raise


def restore_model(folder, home, keep=False):
    """Remet la clé `model` de `home/settings.json` à la valeur notée au lancement (marque du dossier
    jetable), et seulement quand la valeur du moment est celle que le dernier `/model` d'une session de ce
    lancement y a posée : son alias ou id demandé (`requested_model`, `last_model_switch`), et un fichier
    modifié pour la dernière fois à moins de `SWITCH_SLACK_NS` de l'heure de ce `/model` (sinon un autre a pu
    l'écrire depuis, la même valeur comprise) ; une clé absente au lancement est retirée. Toute autre clé garde
    sa valeur et sa place. Rien n'est écrit : avec `keep`, sans valeur notée valide (`valid_noted`), sur un
    fichier absent, illisible ou changé entre la lecture et le renommage, quand la valeur est celle d'un autre
    (autre session, `sync.py`), après un `/model default` de la sonde (ce qu'il écrit n'est pas observé), sur
    un journal illisible, ni après une première décision (`MODEL_DONE`, posé dans le dossier jetable au premier
    passage, quelle qu'en soit l'issue). Rend les lignes du rapport."""
    marker = read_json(folder / MARKER)
    noted = marker.get("modele") if isinstance(marker, dict) else None
    if not valid_noted(noted):
        return ["modèle par défaut du poste : rien d'écrit (valeur au lancement illisible ou non notée)"]
    before = model_label(noted)
    if noted.get("ailleurs"):
        return [f"modèle par défaut du poste : rien d'écrit (CLAUDE_CONFIG_DIR : le /model de la sonde écrit ailleurs) ; "
                f"valeur au lancement : {before}"]
    if keep:
        return [f"modèle par défaut du poste : rien d'écrit (--garder) ; valeur au lancement : {before}"]
    try:
        fd = os.open(folder / MODEL_DONE, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.close(fd)
    except FileExistsError:
        return [f"modèle par défaut du poste : rien d'écrit (décidé au premier nettoyage de ce lancement) ; valeur "
                f"au lancement : {before}"]
    except OSError as err:
        return [f"modèle par défaut du poste : rien d'écrit ({folder / MODEL_DONE} : {err}) ; valeur au lancement : {before}"]
    settings = home / "settings.json"
    try:
        raw = settings.read_bytes() if not settings.is_symlink() and settings.is_file() else None
        data = json.loads(raw) if raw is not None else None
        mtime = os.lstat(settings).st_mtime_ns if raw is not None else None
    except (OSError, ValueError):
        data = None
    if not isinstance(data, dict):
        return [f"modèle par défaut du poste : rien d'écrit ({settings} absent ou illisible) ; valeur au lancement : {before}"]
    present, current = MODEL_KEY in data, data.get(MODEL_KEY)
    if (noted["etat"] == "absent" and not present) or (noted["etat"] == "valeur" and current == noted["valeur"]):
        return [f"modèle par défaut du poste : rien à remettre, valeur au lancement inchangée : {before}"]
    shown = (f"« {current} »" if valid_model(current) else "d'une forme inattendue") if present else "absente"
    try:
        last = last_model_switch(folder)
    except OSError as err:
        return [f"modèle par défaut du poste : rien d'écrit (journal de la sonde illisible : {err}) ; la clé vaut "
                f"{shown}, valeur au lancement : {before}"]
    if last is not None and last["defaut"]:
        return [f"modèle par défaut du poste : rien d'écrit (le dernier /model de cette sonde était /model default, "
                f"dont l'écriture n'est pas observée ; la clé vaut {shown}) ; valeur au lancement : {before}"]
    if last is None or last["demande"] is None or current != last["demande"]:
        return [f"modèle par défaut du poste : rien d'écrit (la clé vaut {shown}, qu'aucun /model de cette sonde "
                f"n'a posé : une autre session ou sync.py) ; valeur au lancement : {before}"]
    if last["a_ns"] is None or abs(mtime - last["a_ns"]) > SWITCH_SLACK_NS:
        when = f"à {stamp(last['a_ns'])}" if last["a_ns"] is not None else "à une heure illisible"
        return [f"modèle par défaut du poste : rien d'écrit ({settings} modifié à {stamp(mtime)}, le dernier /model "
                f"de cette sonde {when} : un autre a pu l'écrire depuis) ; la clé vaut {shown}, valeur au "
                f"lancement : {before}"]
    restored = dict(data)
    if noted["etat"] == "absent":
        del restored[MODEL_KEY]
    else:
        restored[MODEL_KEY] = noted["valeur"]
    try:
        write_guarded(settings, raw, restored, mtime)
    except (OSError, ValueError) as err:
        return [f"modèle par défaut du poste : écriture ratée ({err}) ; la clé vaut {shown}, "
                f"valeur au lancement : {before}"]
    back = f"« {noted['valeur']} »" if noted["etat"] == "valeur" else "absente (clé retirée)"
    return [f"modèle par défaut du poste : remis de {shown} à {back}"]


def stamp(ns):
    """Une heure en nanosecondes depuis l'époque, en texte UTC à la milliseconde, pour le rapport."""
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(ns // 1_000_000_000)) + f".{ns // 1_000_000 % 1000:03d} UTC"


def mark_reused(folder):
    """Après un lancement `--dir` réussi dans un dossier jetable marqué : le signale, pour que `--nettoyer`
    le refuse (ses traces ne sont plus seulement celles du lancement d'origine)."""
    if (folder / MARKER).exists():
        (folder / REUSED).write_text("lancement --dir\n", encoding="utf-8")


def launch_sessions(folder):
    """Les sessions de ce lancement : les `sid` que le journal de la sonde (`journaux/*.jsonl` du dossier
    jetable) a notés, en forme d'id. Une session lancée ensuite dans le dossier, sans la sonde, n'y est pas."""
    found = set()
    for path in sorted((folder / "journaux").glob("*.jsonl")):
        if path.is_symlink() or not path.is_file():
            continue
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    sid = json.loads(line).get("sid")
                except (ValueError, AttributeError):
                    continue
                if isinstance(sid, str) and SESSION_ID.fullmatch(sid):
                    found.add(sid)
    return found


def opened_sessions(folder):
    """Les sessions que ce lancement a ouvertes : parmi celles du journal (`launch_sessions`), celles qu'un
    `classic.SessionStart` y dit ouvertes au démarrage ou par `/clear` (`source` « startup » ou « clear »),
    sous un id neuf. Une session reprise dans la sonde (`/resume`, `source` « resume ») n'y est pas : ses
    traces rangées par id sont d'avant le lancement."""
    found = set()
    for path in sorted((folder / "journaux").glob("*.jsonl")):
        if path.is_symlink() or not path.is_file():
            continue
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(entry, dict) or entry.get("ev") != "classic.SessionStart" \
                        or entry.get("source") not in OPENING_SOURCES:
                    continue
                sid = entry.get("sid")
                if isinstance(sid, str) and SESSION_ID.fullmatch(sid):
                    found.add(sid)
    return found


def launch_window(folder):
    """La fenêtre de ce lancement, (début, fin) en nanosecondes : la date de sa marque (posée avant la
    première session), et la dernière écriture d'un journal de la sonde (`journaux/*.jsonl`, réécrit à
    chaque événement de ses sessions) ; None si l'une manque. Une trace rangée par id hors de cette fenêtre
    n'est pas de ce lancement : la même session reprise ensuite hors de la sonde (`claude --continue` dans
    le dossier jetable), ou un id hérité d'une autre session (`--env CLAUDE_CODE_SESSION_ID=…`)."""
    try:
        start = os.lstat(folder / MARKER).st_mtime_ns
    except OSError:
        return None
    ends = []
    for path in (folder / "journaux").glob("*.jsonl"):
        try:
            st = os.lstat(path)
        except OSError:
            continue
        if stat.S_ISREG(st.st_mode):
            ends.append(st.st_mtime_ns)
    return (start, max(ends)) if ends and max(ends) >= start else None


def tree_doubts(path, window=None):
    """Les raisons de garder un dossier à supprimer en entier : un lien symbolique, à tout niveau, une
    entrée illisible (ce qui n'a pas été relu ne se supprime pas), un dossier où l'on ne peut pas
    effacer (sans droit d'écriture et de traversée : `rmtree` s'arrêterait à moitié, et le nettoyage avec),
    ou, avec `window`, une entrée née ou modifiée hors de la fenêtre du lancement (la date du dossier du
    haut ne dit rien de celles de son contenu). Vide : `rmtree` n'effacerait que des entrées relues, aucune
    cible de lien."""
    doubts, unreadable = [], []
    if not os.access(path, os.W_OK | os.X_OK):
        doubts.append(f"{path.name} non effaçable (droits)")
    for base, dirs, files in os.walk(path, onerror=unreadable.append):
        for name in dirs + files:
            entry = Path(base) / name
            # `os.lstat` relu pour chaque entrée : dans un dossier lisible mais non traversable, `os.walk`
            # range ses entrées sans les relire, et sans appeler `onerror`.
            try:
                st = os.lstat(entry)
            except OSError as err:
                doubts.append(f"{entry.relative_to(path)} illisible ({err.strerror or err})")
                continue
            mode = st.st_mode
            if stat.S_ISLNK(mode):
                doubts.append(f"{entry.relative_to(path)} est un lien symbolique")
            elif stat.S_ISDIR(mode) and not os.access(entry, os.W_OK | os.X_OK):
                doubts.append(f"{entry.relative_to(path)} non effaçable (droits)")
            elif window is not None and not born_in(st, window):
                doubts.append(f"{entry.relative_to(path)} créé ou modifié hors de la fenêtre du lancement")
    doubts += [f"{err.filename} illisible ({err.strerror or err})" for err in unreadable]
    return doubts


def real_dirs(home, *parts):
    """Si `home/parts…` est fait de vrais dossiers où l'on peut effacer : (vrai, None) ; si l'un manque :
    (faux, None) ; si l'un est un lien symbolique, autre chose qu'un dossier ou illisible, ou si le dernier
    n'est pas effaçable : (faux, la raison de ne rien y prendre)."""
    path = home
    for part in parts:
        path = path / part
        try:
            st = os.lstat(path)
        except FileNotFoundError:
            return False, None
        except OSError as err:
            return False, f"{path} illisible ({err.strerror or err}) : rien n'y est pris"
        if not stat.S_ISDIR(st.st_mode):
            return False, f"{path} (lien symbolique ou pas un dossier : rien n'y est pris)"
    if not os.access(path, os.W_OK | os.X_OK):
        return False, f"{path} non effaçable (droits) : rien n'y est pris"
    return True, None


def in_window(ns, window):
    return window[0] <= ns <= window[1]


def birth_ns(st):
    """La date de création d'une entrée en nanosecondes, là où le système la donne (macOS), sinon None."""
    ns = getattr(st, "st_birthtime_ns", None)
    if ns is None and hasattr(st, "st_birthtime"):
        ns = int(st.st_birthtime * 1_000_000_000)
    return ns


def born_in(st, window):
    """Vrai si l'entrée de ce `lstat` est née et a été modifiée dans la fenêtre du lancement : sa date de
    création et sa date de modification. Sans date de création (Linux), faux : une entrée d'avant le
    lancement réécrite pendant lui aurait une date de modification dans la fenêtre."""
    birth = birth_ns(st)
    return birth is not None and in_window(birth, window) and in_window(st.st_mtime_ns, window)


def session_traces(home, sessions, window):
    """Les traces que ces sessions laissent sous `home`, rangées par leur id, nées dans la fenêtre du
    lancement (`launch_window`) : `session-env/<id>/` (un vrai dossier dont chaque entrée, lui compris, est
    née et a été modifiée dans la fenêtre, `born_in` : jamais là où le système ne donne pas la date de
    création ; sans lien ni entrée illisible ni sous-dossier non effaçable) et les relevés de stats-board
    `stats-board/requetes/<id>_<heure d'ouverture en ms>.json` (de vrais fichiers, le nom vérifié en entier,
    l'heure de leur nom dans la fenêtre) ; rend ([(chemin, est un dossier)], [raisons de garder])."""
    todo, kept = [], []
    if not sessions:
        return todo, kept
    if window is None:
        # Une horloge revenue en arrière, des journaux absents ou en lien : rien n'est pris, et c'est dit.
        kept.append("traces rangées par id des sessions (session-env, relevés de stats-board) : fenêtre du "
                    "lancement illisible (marque ou journaux), rien n'y est pris")
        return todo, kept
    ok, reason = real_dirs(home, "session-env")
    kept += [reason] if reason else []
    for session in sorted(sessions) if ok else []:
        path = home / "session-env" / session
        try:
            st = os.lstat(path)
        except FileNotFoundError:
            continue
        except OSError as err:
            kept.append(f"{path} (illisible : {err.strerror or err})")
            continue
        if not stat.S_ISDIR(st.st_mode):
            kept.append(f"{path} (lien symbolique ou pas un dossier)")
        elif birth_ns(st) is None:
            kept.append(f"{path} (date de création inconnue sur ce système : rien ne prouve qu'il est de ce lancement)")
        elif not born_in(st, window):
            kept.append(f"{path} (créé ou modifié hors de la fenêtre du lancement)")
        else:
            doubts = tree_doubts(path, window)
            if doubts:
                kept.append(f"{path} ({' ; '.join(doubts)})")
            else:
                todo.append((path, True))
    ok, reason = real_dirs(home, "stats-board", "requetes")
    kept += [reason] if reason else []
    requests = home / "stats-board" / "requetes"
    try:
        names = sorted(os.listdir(requests)) if ok else []
    except OSError as err:
        kept.append(f"{requests} illisible ({err.strerror or err}) : rien n'y est pris")
        names = []
    for name in names:
        session, tail = name[:36], name[36:]
        if session not in sessions or not REQUEST.fullmatch(tail):
            continue
        path = requests / name
        if not in_window(int(tail[1:-5]) * 1_000_000, window):
            kept.append(f"{path} (ouvert hors de la fenêtre du lancement)")
            continue
        try:
            st = os.lstat(path)
        except OSError as err:
            kept.append(f"{path} (illisible : {err.strerror or err})")
            continue
        if stat.S_ISREG(st.st_mode):
            todo.append((path, False))
        else:
            kept.append(f"{path} (lien symbolique ou pas un fichier ordinaire)")
    return todo, kept


def roots_of(folder):
    """Les écritures d'un même dossier : son chemin donné et son chemin réel (`/private/var` sur Mac)."""
    return {str(folder).rstrip("/"), os.path.realpath(folder).rstrip("/")}


def within(path, folder):
    """Vrai si `path` est `folder` ou un de ses sous-dossiers, sous l'une de ses écritures."""
    path = str(path).rstrip("/")
    return any(path == root or path.startswith(root + "/") for root in roots_of(folder))


def read_json(path):
    """Le JSON d'un fichier ordinaire (pas un lien), ou None."""
    try:
        if path.is_symlink() or not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def transcript_doubt(path, folder):
    """La raison de douter d'un transcript (un `.jsonl`), ou None : pas un fichier ordinaire, aucun dossier
    de travail (`cwd`) lisible, ou un dossier hors de `folder` (un voisin au même nom encodé)."""
    if path.is_symlink() or not path.is_file():
        return f"{path.name} n'est pas un fichier ordinaire"
    cwds = set()
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    cwd = json.loads(line).get("cwd")
                except (ValueError, AttributeError):
                    continue
                if isinstance(cwd, str):
                    cwds.add(cwd)
    except OSError as err:
        return f"{path.name} illisible ({err.strerror})"
    foreign = sorted(c for c in cwds if not within(c, folder))
    if not cwds:
        return f"{path.name} ne cite aucun dossier lisible"
    return f"{path.name} cite {', '.join(foreign)}" if foreign else None


def project_doubts(project, folder, sessions):
    """Les raisons de garder un dossier de transcripts : une entrée qui n'est ni le transcript d'une session
    de ce lancement (`<id>.jsonl`), ni son dossier (`<id>/`), ni `memory/` ; un lien symbolique, où qu'il
    soit ; un transcript douteux, à tout niveau. Vide : tout ce que `rmtree` effacerait a été lu."""
    doubts = []
    entries = sorted(project.iterdir())
    if not any(e.suffix == ".jsonl" and e.stem in sessions for e in entries):
        doubts.append("aucun transcript d'une session de ce lancement")
    for entry in entries:
        name = entry.name
        if entry.is_symlink():
            doubts.append(f"{name} est un lien symbolique")
        elif entry.is_file() and entry.suffix == ".jsonl":
            if entry.stem not in sessions:
                doubts.append(f"{name} : session hors de ce lancement")
        elif entry.is_dir() and (name in sessions or name == "memory"):
            pass
        elif entry.is_dir() and SESSION_ID.fullmatch(name):
            doubts.append(f"{name}/ : session hors de ce lancement")
        else:
            doubts.append(f"{name} : entrée inconnue")
    for path in sorted(project.rglob("*")):
        if path.is_symlink() and path.parent != project:
            doubts.append(f"{path.relative_to(project)} est un lien symbolique")
        elif path.suffix == ".jsonl" and (path.parent != project or path.stem in sessions):
            reason = transcript_doubt(path, folder)
            if reason:
                doubts.append(f"{path.relative_to(project).parent}/{reason}" if path.parent != project else reason)
    return doubts


@dataclass
class Report:
    deleted: list = field(default_factory=list)
    kept: list = field(default_factory=list)
    pending: list = field(default_factory=list)
    error: str = None

    def remaining(self):
        return [f"{p} (non supprimé : {self.error})" for p in self.pending] + self.kept

    def lines(self):
        out = [f"supprimé : {p}" for p in self.deleted] + [f"resté : {line}" for line in self.remaining()]
        if self.error:
            out.append(f"ARRÊT : {self.error}")
        return out or ["rien sous ~/.claude pour ce dossier"]


def registry_files(agents, session, folder):
    """Les fichiers du registre de flow-board d'une session : ses morceaux `<id>.N.json` (leur champ
    `session` égal à l'id), puis sa tête `<id>.json`, dont la racine (`root`) doit être `folder` ;
    rend ([à supprimer], [raisons de garder]). Les morceaux passent avant la tête : un nettoyage arrêté
    entre les deux retrouve encore la tête, qui les rattache."""
    head = agents / f"{session}.json"
    reg = read_json(head)
    if not isinstance(reg, dict) or not isinstance(reg.get("root"), str) or not within(reg["root"], folder) \
            or str(reg.get("session", "")).lower() != session:
        if head.exists() or head.is_symlink():
            return [], [f"{head} (pas un registre de ce dossier)"]
        return [], []
    parts, kept = [], []
    for path in sorted(agents.glob(f"{session}.*.json")):
        if not CHUNK.fullmatch(path.name[len(session):]):
            continue
        piece = read_json(path)
        if isinstance(piece, dict) and str(piece.get("session", "")).lower() == session:
            parts.append(path)
        else:
            kept.append(f"{path} (pas un morceau de ce registre)")
    return parts + [head], kept


def plan(folder, home):
    """Ce que ce lancement a laissé sous `home` : [(chemin, est un dossier)] à supprimer, dans l'ordre
    (registres, traces rangées par id des sessions qu'il a ouvertes, fichier de mission, dossier de projet
    en dernier : une reprise relit ses transcripts), et [raisons] de ce qui reste."""
    roots = roots_of(folder)
    sessions = launch_sessions(folder)
    todo, kept = [], []
    project_ok, doubtful = [], False
    for project in [home / "projects" / name for name in sorted({project_dir_name(r) for r in roots})]:
        if not project.exists() and not project.is_symlink():
            continue
        if project.is_symlink() or not project.is_dir():
            kept.append(f"{project} (lien symbolique ou pas un dossier)")
            doubtful = True
            continue
        doubts = project_doubts(project, folder, sessions)
        if doubts:
            kept.append(f"{project} ({' ; '.join(doubts)})")
            doubtful = True
            continue
        project_ok.append(project)
    agents = home / "flow-board" / "agents"
    for session in sorted(sessions):
        files, reasons = registry_files(agents, session, folder) if agents.is_dir() else ([], [])
        todo += [(p, False) for p in files]
        kept += reasons
    traces, reasons = session_traces(home, opened_sessions(folder) & sessions, launch_window(folder))
    todo += traces
    kept += reasons
    for slug in sorted({mission_slug(r) for r in roots}):
        path = home / "flow-board" / "parcours" / f"{slug}.json"
        if not path.exists() and not path.is_symlink():
            continue
        mission = read_json(path)
        if not isinstance(mission, dict) or str(mission.get("root", "")).rstrip("/") not in roots:
            kept.append(f"{path} (fichier de mission d'une autre racine)")
        elif doubtful or not project_ok:
            # Le fichier de mission sert toutes les sessions du dossier : il part seulement quand le dossier
            # de transcripts ne porte que celles de ce lancement.
            kept.append(f"{path} (le dossier peut avoir servi à une session hors de ce lancement)")
        else:
            todo.append((path, False))
    todo += [(p, True) for p in project_ok]
    return todo, kept


def clean(folder, home, keep=False):
    """Supprime sous `home` (le `~/.claude` du poste) ce que le lancement de `folder` a laissé, et rien
    d'autre ; avec `keep`, ne supprime rien. S'arrête à la première suppression qui échoue."""
    todo, kept = plan(folder, home)
    report = Report(kept=list(kept))
    if keep:
        report.kept = [f"{p} (--garder)" for p, _ in todo] + report.kept
        return report
    window = None
    for i, (path, is_dir) in enumerate(todo):
        try:
            if path.is_symlink():
                raise OSError(f"{path} est devenu un lien symbolique")
            if is_dir and path.parent == home / "session-env":
                # Relu juste avant de l'effacer : une session reprise ailleurs entre-temps y a pu écrire.
                window = window or launch_window(folder)
                doubts = ([] if window and born_in(os.lstat(path), window) else ["hors de la fenêtre du lancement"]) \
                    + (tree_doubts(path, window) if window else [])
                if doubts:
                    raise OSError(f"changé depuis le relevé ({' ; '.join(doubts)})")
            shutil.rmtree(path) if is_dir else path.unlink()
            if path.exists() or path.is_symlink():
                raise OSError("toujours là après la suppression")
        except OSError as err:
            report.error = f"{path} : {err}"
            report.pending = [str(p) for p, _ in todo[i:]]
            return report
        report.deleted.append(str(path))
    return report


def log_line(journals, text):
    """Ajoute une ligne datée au journal de la sonde."""
    journals.mkdir(parents=True, exist_ok=True)
    with open(journals / LOG_NAME, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {text}\n")


def log_version(journals, claude, when):
    """Écrit au journal la version du Claude Code essayé (`claude --version`), avant ou après l'essai."""
    try:
        res = subprocess.run([str(claude), "--version"], capture_output=True, text=True, timeout=60)
        version = res.stdout.strip().splitlines()[0] if res.returncode == 0 and res.stdout.strip() else f"inconnue (code {res.returncode})"
    except (OSError, subprocess.SubprocessError) as err:
        version = f"inconnue ({err})"
    log_line(journals, f"claude --version {when} l'essai : {version} ({claude})")
    return version


def clean_target(folder, given_dir, env):
    """Le dossier jetable que nettoiera l'étape de fin, ou None : jamais un dossier donné par `--dir`
    (un vrai projet, une reprise), ni un ~/.claude déplacé par `CLAUDE_CONFIG_DIR`."""
    if given_dir or any(a.startswith("CLAUDE_CONFIG_DIR=") for a in env) or not JETABLE.fullmatch(folder.name):
        return None
    return folder


def session_command(tmux, name, folder, journals, claude, plugins, env, model, effort, resume, clean_name, keep,
                    model_before=None):
    """La commande tmux de la session : Claude Code avec la sonde, puis, à sa sortie, l'étape de fin de
    `sonde.py` (version après l'essai, et le nettoyage du dossier jetable `clean_name`, chemin absolu,
    sauf `keep`), dont le volet reste ouvert jusqu'à Entrée pour qu'on lise ce qu'elle a fait."""
    session = ["env", *[a for v in INHERITED for a in ("-u", v)], f"SONDE_JOURNAUX={journals}", *env,
               str(claude), "--plugin-dir", str(SONDE), *[a for p in plugins for a in ("--plugin-dir", str(p))],
               "--model", model, "--effort", effort, *(["--continue"] if resume else [])]
    end = [sys.executable, str(Path(__file__).resolve()), "--apres-session", "--claude", str(claude),
           "--journaux", str(journals), *(["--nettoyer", str(clean_name)] if clean_name else []),
           *(["--garder"] if keep else []),
           # Sans dossier jetable à nettoyer (`--dir`, CLAUDE_CONFIG_DIR) : la valeur notée, que l'étape de fin redit.
           *(["--modele-avant", json.dumps(model_before)] if model_before is not None and not clean_name else [])]
    pause = "printf '%s' 'Étape de fin finie (journal : sonde.log). Entrée ferme la session. '; read _"
    return [tmux, "new-session", "-d", "-s", name, "-c", str(folder), "--", "sh", "-c",
            f"{shlex.join(session)}; {shlex.join(end)}; {pause}"]


def busy_panes(tmux, folder, own=None):
    """Les volets tmux (hors `own`, celui de l'étape de fin) qui travaillent dans `folder` ou dessous.
    Une lecture ratée compte comme un volet occupé : on ne supprime pas sur une absence non observée."""
    try:
        res = subprocess.run([tmux, "list-panes", "-a", "-F", "#{pane_id} #{pane_current_path}"],
                             capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as err:
        return [f"tmux illisible ({err})"]
    if res.returncode != 0:
        # Aucun serveur tmux : aucun volet. Toute autre erreur : on ne sait pas, donc occupé.
        return [] if "no server running" in res.stderr else [
            f"tmux illisible ({res.stderr.strip()} ; un serveur tmux arrêté laisse sa socket : tmux kill-server)"]
    busy = []
    for line in res.stdout.splitlines():
        pane, _, path = line.partition(" ")
        if pane != own and path and within(os.path.realpath(path), folder):
            busy.append(f"volet {pane} dans {path}")
    return busy


def marker_claude(folder):
    """Le Claude Code noté dans le fichier du lancement, s'il désigne un fichier exécutable ; sinon None."""
    data = read_json(folder / MARKER)
    # Le Claude Code lancé avec --version doit être un exécutable ; la marque vient de ce lancement.
    claude = data.get("claude") if isinstance(data, dict) else None
    if isinstance(claude, str) and os.path.isabs(claude) and os.path.isfile(claude) and os.access(claude, os.X_OK):
        return claude
    return None


def finish(args, tmux, home=None, tmp=None):
    """`--nettoyer <nom>` (un essai interrompu) et l'étape de fin d'une session (`--apres-session`) :
    version de Claude Code après l'essai, puis le nettoyage du dossier jetable nommé, s'il en a un.
    Tout refus va aussi au journal : le volet de l'étape de fin peut se fermer avant qu'on le lise."""
    journals = Path(args.journaux) if args.journaux else None
    if args.apres_session and journals is not None and args.claude:
        log_version(journals, args.claude, "après")
    try:
        folder = launch_folder(args.nettoyer, tmp) if args.nettoyer else None
        if folder is None:
            # `--dir` ou CLAUDE_CONFIG_DIR : rien ne se nettoie ni ne s'écrit ; le rapport dit la valeur d'avant.
            before = getattr(args, "modele_avant", None)
            try:
                noted = json.loads(before) if isinstance(before, str) else None
            except ValueError:
                noted = {}
            if noted is not None and journals is not None:
                line = ("modèle par défaut du poste : rien d'écrit (dossier --dir ou CLAUDE_CONFIG_DIR) ; valeur au "
                        f"lancement : {model_label(noted)}" if valid_noted(noted) else
                        "modèle par défaut du poste : rien d'écrit (valeur au lancement illisible)")
                print(line)
                log_line(journals, line)
            return 0
        if journals is None:
            journals = folder / "journaux"
        if not args.apres_session:
            claude = marker_claude(folder)
            if claude:
                log_version(journals, claude, "après")
        busy = busy_panes(tmux, folder, os.environ.get("TMUX_PANE") if args.apres_session else None)
        if busy:
            raise SondeError(f"une session travaille encore dans {folder} ({'; '.join(busy)}) : la quitter d'abord ; "
                             f"rien n'est supprimé")
        # Après le contrôle des volets (une session encore ouverte pourrait refaire un /model), et quoi que
        # donne le nettoyage : une remise ratée se dit sans l'arrêter, et ce qu'elle a fait se dit tout de
        # suite, avant le relevé du nettoyage, qui peut lever.
        try:
            model_lines = restore_model(folder, home or Path.home() / ".claude", keep=args.garder)
        except Exception as err:  # aucune erreur de la remise n'arrête le nettoyage
            model_lines = [f"modèle par défaut du poste : remise interrompue, rien d'écrit ou écriture à vérifier ({err})"]
        for line in model_lines:
            print(line)
            log_line(journals, f"{folder.name} : {line}")
        try:
            report = clean(folder, home or Path.home() / ".claude", keep=args.garder)
        except OSError as err:
            raise SondeError(f"lecture impossible pendant le relevé ({err}) : rien n'est supprimé")
    except SondeError as err:
        if journals is not None:
            log_line(journals, f"nettoyage refusé : {err}")
        raise
    print(f"Nettoyage de {folder.name} sous ~/.claude :")
    for line in report.lines():
        print(f"  {line}")
        log_line(journals, f"nettoyage {folder.name} : {line}")
    return 1 if report.error else 0


def drive(tmux, args):
    """Pilote la sonde déjà lancée : envoie des touches, tape un texte puis Entrée, attend, affiche la
    fin de son volet."""
    def tmux_run(*cmd):
        res = subprocess.run([tmux, *cmd], capture_output=True, text=True, timeout=30)
        if res.returncode != 0:
            sys.exit(f"tmux : {res.stderr.strip()} (la session « {args.name} » est-elle lancée ?)")
        return res.stdout
    for key in args.touches:
        tmux_run("send-keys", "-t", args.name, key)
        time.sleep(0.3)
    if args.envoyer is not None:
        tmux_run("send-keys", "-t", args.name, "-l", "--", args.envoyer)
        # Entrée à part, un peu après : collée au texte, Claude Code la prendrait pour un retour à la ligne.
        time.sleep(0.5)
        tmux_run("send-keys", "-t", args.name, "Enter")
    if args.attendre:
        time.sleep(args.attendre)
    if args.voir:
        lines = tmux_run("capture-pane", "-p", "-t", args.name).rstrip().splitlines()
        print("\n".join(lines[-args.lignes:]))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--desktop", action="store_true", help="le Claude Code de l'app desktop")
    parser.add_argument("--dir", type=Path, help="dossier de la session (défaut : un dossier jetable neuf)")
    parser.add_argument("--name", default="sonde", help="nom de la session tmux")
    parser.add_argument("--model", default="haiku")
    parser.add_argument("--effort", default="low")
    parser.add_argument("--reprise", action="store_true",
                        help="reprendre la dernière session du dossier (--continue ; avec --dir ; lancer d'abord l'essai avec --garder, sinon ses transcripts sont supprimés à sa fin)")
    parser.add_argument("--titre", help="titre que la sonde renvoie une fois dans sessionTitle (SessionStart ou premier message)")
    parser.add_argument("--env", action="append", default=[], metavar="CLE=VALEUR",
                        help="variable passée à la session (répétable), par exemple CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000")
    parser.add_argument("--plugin", action="append", default=[], type=Path, metavar="DOSSIER",
                        help="plugin chargé en plus de la sonde (répétable), par exemple scripts/sonde-essai")
    parser.add_argument("--envoyer", metavar="TEXTE", help="tape ce texte puis Entrée dans la sonde lancée (sans en lancer une)")
    parser.add_argument("--voir", action="store_true", help="affiche la fin du volet de la sonde lancée (sans en lancer une)")
    parser.add_argument("--touches", nargs="+", default=[], metavar="TOUCHE",
                        help="envoie ces touches tmux à la sonde lancée, avant --envoyer (Down, Enter, Escape, C-c…)")
    parser.add_argument("--attendre", type=float, default=0, metavar="S", help="avec --envoyer ou --voir : secondes d'attente avant de lire")
    parser.add_argument("--lignes", type=int, default=40, metavar="N", help="avec --voir : nombre de lignes affichées")
    parser.add_argument("--garder", action="store_true",
                        help="au lancement : ne rien supprimer sous ~/.claude à la fin de l'essai, ni remettre le modèle par défaut du poste (la liste de ce qui reste et la valeur d'avant vont au journal)")
    parser.add_argument("--nettoyer", metavar="NOM",
                        help="nettoie sous ~/.claude ce qu'a laissé l'essai du dossier jetable NOM (sonde-xxxxxxxx), interrompu, et remet le modèle par défaut du poste qu'un /model de l'essai a changé")
    # L'étape de fin, que la session tmux lance à la sortie de Claude Code : pas pour la main.
    parser.add_argument("--apres-session", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--claude", help=argparse.SUPPRESS)
    parser.add_argument("--journaux", help=argparse.SUPPRESS)
    parser.add_argument("--modele-avant", help=argparse.SUPPRESS)
    args = parser.parse_args()

    tmux = shutil.which("tmux")
    if not tmux:
        sys.exit("tmux introuvable (brew install tmux)")
    if args.envoyer is not None or args.voir or args.touches:
        drive(tmux, args)
        return
    if args.nettoyer is not None or args.apres_session:
        try:
            sys.exit(finish(args, tmux))
        except SondeError as err:
            sys.exit(f"ÉCHEC : {err}")
    bad = [a for a in args.env if not ENV_ASSIGN.fullmatch(a)]
    if bad:
        sys.exit(f"--env attend CLE=VALEUR : {', '.join(bad)}")
    # Résolus ici : la session tourne dans un autre dossier.
    plugins = [p.expanduser().resolve() for p in args.plugin]
    missing = [str(p) for p in plugins if not (p / ".claude-plugin" / "plugin.json").is_file()]
    if missing:
        sys.exit(f"--plugin attend un dossier de plugin (.claude-plugin/plugin.json) : {', '.join(missing)}")
    if args.desktop:
        found = desktop_claude()
        if not found:
            sys.exit("Claude Code de l'app desktop introuvable")
        claude, version = found
        label = f"desktop {version}"
    else:
        claude = shutil.which("claude")
        if not claude:
            sys.exit("claude introuvable")
        label = "terminal"
    # Le mode titre : la sonde lit ce fichier au premier hook qui peut renvoyer `sessionTitle`.
    title_file = SONDE / "titre.txt"
    if args.titre:
        title_file.write_text(args.titre + "\n", encoding="utf-8")
    elif title_file.exists():
        title_file.unlink()
    folder = args.dir.expanduser().resolve() if args.dir else Path(tempfile.mkdtemp(prefix="sonde-"))
    folder.mkdir(parents=True, exist_ok=True)
    if args.reprise and not args.dir:
        sys.exit("--reprise demande --dir (le dossier de la session à reprendre)")
    # Les journaux, hors du dépôt : des journaux bruts restés dans scripts/sonde/ avaient arrêté la
    # fermeture d'un groupe. Un dossier donné par --dir peut être un dépôt : ils vont alors à part.
    journals = folder / "journaux" if not args.dir else Path(tempfile.mkdtemp(prefix="sonde-journaux-"))
    journals.mkdir(parents=True, exist_ok=True)
    # Le nettoyage ne vise que le dossier jetable neuf de ce lancement, marqué ici ; jamais un dossier
    # donné par --dir (un vrai projet, une reprise), ni un ~/.claude déplacé par CLAUDE_CONFIG_DIR.
    moved = any(a.startswith("CLAUDE_CONFIG_DIR=") for a in args.env)
    clean_name = clean_target(folder, args.dir, args.env)
    # Le modèle par défaut du poste au lancement, lu sans rien écrire : remis à la sortie s'il le faut. Pas
    # noté (donc jamais écrit) quand la session lit ses réglages ailleurs (CLAUDE_CONFIG_DIR, passé par --env
    # ou hérité) : son /model n'écrirait pas ~/.claude/settings.json.
    config_moved = moved or bool(os.environ.get("CLAUDE_CONFIG_DIR"))
    model_before = note_model(Path.home() / ".claude" / "settings.json")
    if config_moved:
        # Noté pour le rapport, jamais écrit (`restore_model` s'arrête sur « ailleurs »).
        model_before = {**model_before, "ailleurs": True}
    if clean_name:
        mark_launch(folder, claude, model_before)
    if not valid_noted(model_before):
        model_line = "modèle par défaut du poste au lancement : illisible, la sonde ne l'écrira pas"
    elif config_moved:
        model_line = (f"modèle par défaut du poste au lancement : {model_label(model_before)} ; la sonde ne l'écrira "
                      "pas (CLAUDE_CONFIG_DIR : son /model écrit ailleurs)")
    else:
        model_line = f"modèle par défaut du poste au lancement : {model_label(model_before)}"
    log_line(journals, model_line)
    log_version(journals, claude, "avant")
    # Lancée depuis une session Claude Code, la sonde hériterait de son id de session (et de son
    # titre, qui passait devant `sessionTitle` : constaté le 28/10/2026) : ces variables sont retirées.
    command = session_command(tmux, args.name, folder, journals, claude, plugins, args.env, args.model, args.effort,
                              args.reprise, clean_name, args.garder, model_before)
    res = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if res.returncode != 0:
        sys.exit(f"tmux : {res.stderr.strip()} (une session « {args.name} » existe déjà ? --name pour en ouvrir une autre)")
    if args.dir:
        mark_reused(folder)
    print(f"Session tmux « {args.name} » : Claude Code {label}, dans {folder}")
    if args.env:
        print(f"Variables passées : {', '.join(a.split('=', 1)[0] for a in args.env)}")
    if plugins:
        print(f"Plugins chargés en plus : {', '.join(str(p) for p in plugins)}")
    print(f"  tmux attach -t {args.name}        jouer les scénarios (Ctrl-b d pour se détacher)")
    print(f"  python3 scripts/sonde.py --name {args.name} --envoyer \"<texte>\" --attendre 10 --voir   sans s'attacher")
    print("  /exit dans la session        fermer : l'étape de fin (version, nettoyage) s'affiche, puis Entrée ferme la session")
    print(f"  tmux kill-session -t {args.name}  fermer sans l'étape de fin")
    if clean_name and args.garder:
        print("À la sortie de Claude Code : rien n'est supprimé (--garder) ; la liste de ce qui reste va au journal.")
    elif clean_name:
        print(f"À la sortie de Claude Code : ce que ce lancement a laissé sous ~/.claude est supprimé, la liste au journal ;"
              f" après un kill-session : python3 scripts/sonde.py --nettoyer {folder}")
    else:
        print("Aucun nettoyage sous ~/.claude : " + ("CLAUDE_CONFIG_DIR passé à la session" if moved else "dossier donné par --dir"))
    print(model_line + (" ; remis à la sortie si un /model de l'essai le change (~/.claude/settings.json)"
                        if clean_name and not args.garder and not config_moved and valid_noted(model_before) else ""))
    print(f"Journaux : {journals} (versions de Claude Code et nettoyage : {LOG_NAME})")
    if args.titre:
        print(f"Titre renvoyé une fois dans sessionTitle : « {args.titre} » (session_title du hook suivant dit s'il a pris)")


if __name__ == "__main__":
    main()
