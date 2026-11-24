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
    python3 scripts/sonde.py --arriere-plan "<demande>"    une session d'arrière-plan (claude --bg), sans tmux
    python3 scripts/sonde.py --arreter <dossier jetable>   claude stop sur la session notée dans ce dossier
    python3 scripts/sonde.py --retirer <dossier jetable>   claude rm sur elle, puis le nettoyage sous ~/.claude

La session tourne dans une session tmux détachée (nom : --name, « sonde » par défaut), en Haiku et
en effort low (--model, --effort), avec la sonde chargée par --plugin-dir. Pour jouer les
scénarios : `tmux attach -t sonde`, puis les quitter par Ctrl-b d ; ou, sans s'attacher, par
`--touches`, `--envoyer` et `--voir`, qui attendent eux-mêmes le délai demandé (une session Claude Code
ne peut pas lancer `sleep` au premier plan). Chaque processus de Claude Code (`/clear` compris) écrit son journal dans
le dossier `journaux/` du dossier jetable de la session (avec --dir, un dossier jetable à part), hors du
dépôt, dont le chemin s'affiche ; copier dans travail/ ce qui doit rester. Mode d'emploi et résultats :
docs/evenements-moteur.md.

Lancée depuis une session Claude Code, la sonde ne prend jamais son identité : les variables d'identité
(`IDENTITY`) sont retirées, une session neuve prend un `--session-id` tiré ici (une reprise garde
`--continue`), et l'id de la session qui la lance part au mod (`SONDE_LANCEUR`), qui refuse sous cet id
chaque envoi, compaction, changement de modèle et titre ; un `--env` qui pose une variable d'identité ou
porte cet id, et une `--reprise` dans un dossier où le lanceur a son transcript, sont refusés avant toute
écriture.

Le journal de la sonde (`journaux/sonde.log`) porte `claude --version` du binaire essayé, au lancement et
à la sortie de Claude Code. À cette sortie (`/exit`), dans un dossier jetable neuf, la sonde supprime
sous `~/.claude` ce que ce lancement a laissé, et rien d'autre, ses sessions lues dans le journal de la
sonde (`sid`), jamais la session qui l'a lancée (son id, noté dans la marque du lancement, en sort avant
toute famille ; une marque d'avant cette note, un id hors forme, ou « inconnu » pour une sonde lancée depuis
une session dont l'id ne se lit pas : rien n'est supprimé, et c'est dit) : d'abord les registres d'agents
de flow-board de ses sessions (`flow-board/agents/<id>.N.json` puis `<id>.json`, la tête ayant ce dossier
pour racine), puis les traces rangées par id des sessions qu'il
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

Le mode d'arrière-plan essaie `claude --bg`, `claude stop` et `claude rm` (docs/commandes-claude.md, « Ce que
laisse une session d'arrière-plan ») : `--arriere-plan "<demande>"` lance `claude --bg` avec cette demande
(`--model`, `--effort`, `--desktop`) dans un dossier jetable neuf marqué comme les autres, sans la sonde ni
tmux (l'environnement de l'appelant ne passe pas à la session), hors de tout dépôt git (un dossier temporaire
non approuvé répond « Workspace not trusted » : TMPDIR=<un dossier dédié, approuvé, hors de tout dépôt>), et note à
côté de la marque l'id court de l'unique ligne « backgrounded · <id> » de sa sortie (`.sonde-arriere-plan`) ;
`--arreter <dossier>` et `--retirer <dossier>` (le chemin imprimé au lancement : un nom seul se cherche sous le
TMPDIR du moment) relisent cet id à chaque geste et ne visent que cette session, listée une seule fois dans ce
dossier par `claude agents --json --all` juste avant (`claude stop`, `claude rm`). Un `claude rm` réussi pose
`.sonde-retrait` (la fin de la fenêtre du lancement), puis le
nettoyage passe par le même plan, quand `claude agents --json --all` ne liste plus aucune session de ce
lancement : le registre de flow-board, les relevés de stats-board nés dans la fenêtre, le fichier de mission
et le dossier de transcripts de la seule session dont l'id prolonge l'id court (aucune ou plusieurs : rien),
hors la session qui a lancé la sonde. Un échec de `claude stop` ou `claude rm`, un id absent ou hors forme,
une liste illisible, une session plus listée (retirée hors de la sonde) : rien n'est lancé ni supprimé, et c'est
dit. `--nettoyer` refait ce nettoyage après une interruption, une fois la session retirée (sans tmux ; avec
`--garder`, rien ne se supprime).

Mac et Linux (tmux requis, sauf pour le mode d'arrière-plan) ; sans dépendance hors de la bibliothèque standard.
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
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from check import desktop_claude

SONDE = Path(__file__).resolve().parent / "sonde"
# Les variables d'identité qu'une session Claude Code passe à ses commandes (et que l'environnement global
# d'un serveur tmux démarré depuis une session garde) : elles lient la session lancée à celle qui la lance.
# Liste partagée avec `scripts/mesure-depart.py`, qui l'importe.
IDENTITY = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ATTENDED",
            "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_BRIDGE_SESSION_ID",
            "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_PID", "CLAUDE_JOB_DIR")
# La variable par laquelle la sonde passe à son mod l'id de la session qui la lance : égal au sien, le mod
# refuse ses commandes (`scripts/sonde/hooks/register.tsx`).
LAUNCHER_VAR = "SONDE_LANCEUR"
# La longueur au-delà de laquelle Claude Code coupe le nom encodé d'un dossier de transcripts et lui ajoute
# `-<empreinte>` (lu dans le binaire 2.1.326 le 17/11/2026).
ENCODED_MAX = 200
# Ce que la marque note quand la sonde est lancée depuis une session dont l'id ne se lit pas : hors forme,
# le nettoyage ne supprime alors rien.
UNKNOWN_LAUNCHER = "inconnu"
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
# Le fichier où le mode d'arrière-plan note, à côté de la marque, l'id court que `claude --bg` a imprimé : pas
# dans la marque, dont la date ouvre la fenêtre du lancement (`launch_window`) et qu'une réécriture décalerait.
BACKGROUND = ".sonde-arriere-plan"
# Le fichier que `--retirer` pose dès que `claude rm` a réussi : sa date ferme la fenêtre d'un lancement en
# arrière-plan (sans journal de la sonde : l'environnement de l'appelant ne passe pas à `claude --bg`).
REMOVED = ".sonde-retrait"
# L'id court d'une session d'arrière-plan (les 8 premiers signes de son id), le seul que `claude stop` et
# `claude rm` reçoivent.
SHORT_ID = re.compile(r"[0-9a-f]{8}")
# La ligne par laquelle `claude --bg` dit la session lancée (« backgrounded · 8cfebb73 », suivie ou non de
# « · <titre> ») : relevée le 20/11/2026, Claude Code 2.1.329 (docs/commandes-claude.md).
BACKGROUNDED = re.compile(r"backgrounded · ([0-9a-f]{8})(?: · .*)?")
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


def mark_launch(folder, claude, model=None, launcher=None):
    """Pose dans le dossier jetable la marque de ce lancement : le dossier réel, le Claude Code essayé, la
    session qui lance la sonde (`lanceur` : son id, `UNKNOWN_LAUNCHER` quand le lancement vient d'une session
    dont l'id ne se lit pas, null hors d'une session : `launcher_mark`), que le nettoyage retire des sessions
    du lancement (`launch_launcher`), et, quand il est donné, l'état de la clé `model` du poste au lancement
    (`note_model`). Elle est fermée aux autres (0600), quel que soit l'umask :
    `launch_folder` refuse une marque ouverte en écriture au groupe ou aux autres."""
    data = {"dossier": os.path.realpath(folder), "claude": str(claude), "lanceur": launcher}
    if model is not None:
        data["modele"] = model
    # Dans le dossier neuf de `mkdtemp` : une marque déjà là (ou un lien à sa place) fait échouer le lancement.
    write_private(folder / MARKER, data)


def write_private(path, data):
    """Écrit `data` en JSON dans un fichier neuf, fermé aux autres (0600, quel que soit l'umask) : un fichier
    déjà là, ou un lien à sa place, lève OSError (FileExistsError) sans rien écrire."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        if hasattr(os, "fchmod"):
            os.fchmod(f.fileno(), 0o600)
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


# Les états du lanceur de la marque (`launch_launcher`) où le nettoyage ne supprime rien, et ce qu'il en dit.
REFUSED_LAUNCHERS = {
    "hors forme": "lanceur de la marque hors forme ou inconnu (ou marque illisible) : rien n'est supprimé, ses "
                  "fichiers pourraient être ceux de ce lancement",
    "ancien": "marque d'avant la note du lanceur (un lancement d'avant la garde, qui a pu partager l'identité de "
              "son lanceur) : rien n'est supprimé",
}


def launch_launcher(folder):
    """La session qui a lancé la sonde, lue dans la marque du lancement (`mark_launch`) : ("valide", id) ;
    ("aucun", None) pour un lancement hors d'une session (`lanceur` null) ; ("ancien", None) pour une marque
    d'avant cette note (sans la clé : un lancement d'avant la garde, qui a pu partager l'identité de son
    lanceur) ; ("hors forme", None) pour une valeur qui n'est pas un id en forme (`UNKNOWN_LAUNCHER` compris :
    lancée d'une session dont l'id ne se lisait pas), ou une marque illisible. « ancien » et « hors forme » :
    rien ne se supprime (`plan`)."""
    marker = read_json(folder / MARKER)
    if not isinstance(marker, dict):
        return "hors forme", None
    if "lanceur" not in marker:
        return "ancien", None
    value = marker["lanceur"]
    if value is None:
        return "aucun", None
    if isinstance(value, str) and SESSION_ID.fullmatch(value):
        return "valide", value
    return "hors forme", None


def background_state(folder):
    """L'id court que le mode d'arrière-plan a noté à côté de la marque (`BACKGROUND`) : ("aucun", None) sans
    ce fichier (un lancement dans tmux) ; ("valide", id court) pour un fichier ordinaire à soi, fermé en
    écriture au groupe et aux autres, qui porte un id court en forme ; ("douteux", raison) dans tout autre cas
    (lien, illisible, d'un autre compte, ouvert en écriture, id absent ou hors forme) : rien ne s'arrête, ne se
    retire ni ne se supprime."""
    path = folder / BACKGROUND
    if not path.exists() and not path.is_symlink():
        return "aucun", None
    doubt = access_doubt(path)
    if doubt:
        return "douteux", f"{doubt} : rien n'est arrêté, retiré ni supprimé"
    data = read_json(path)
    short = data.get("court") if isinstance(data, dict) else None
    if not isinstance(short, str) or not SHORT_ID.fullmatch(short):
        return "douteux", (f"{path} : pas d'id court en forme (8 signes de [0-9a-f]), ou pas un fichier ordinaire ; "
                           "rien n'est arrêté, retiré ni supprimé")
    return "valide", short


def background_window(folder):
    """La fenêtre d'un lancement en arrière-plan, (début, fin) en nanosecondes : la date de sa marque et celle
    de `REMOVED`, posé dès que `claude rm` a réussi ; None si l'un manque, si `REMOVED` n'est pas un fichier
    ordinaire à soi fermé en écriture aux autres, ou si la fin précède le début."""
    try:
        start = os.lstat(folder / MARKER).st_mtime_ns
        st = os.lstat(folder / REMOVED)
    except OSError:
        return None
    if not stat.S_ISREG(st.st_mode) or access_doubt(folder / REMOVED):
        return None
    return (start, st.st_mtime_ns) if st.st_mtime_ns >= start else None


def background_session(folder, home, short):
    """L'id complet de la session d'arrière-plan d'id court `short` : l'unique id en forme qui commence par
    `<short>-` parmi les transcripts et dossiers de session (`<id>.jsonl`, `<id>/`) des dossiers de projet de
    `folder` et les têtes de registre de flow-board (`flow-board/agents/<id>.json`) dont la racine est
    `folder` ; rend (id, None), ou (None, raison) quand il n'y en a aucun ou plusieurs : rien ne se supprime
    alors. Seuls des noms et la racine d'un registre sont lus."""
    found, prefix = set(), short + "-"
    for name in sorted({project_dir_name(r) for r in roots_of(folder)}):
        project = home / "projects" / name
        if project.is_symlink() or not project.is_dir():
            continue
        for entry in project.iterdir():
            stem = entry.name[:-len(".jsonl")] if entry.name.endswith(".jsonl") else entry.name
            if stem.startswith(prefix) and SESSION_ID.fullmatch(stem):
                found.add(stem)
    agents = home / "flow-board" / "agents"
    if agents.is_dir() and not agents.is_symlink():
        for entry in agents.glob(f"{short}-*.json"):
            stem, reg = entry.name[:-len(".json")], read_json(entry)
            if SESSION_ID.fullmatch(stem) and isinstance(reg, dict) and isinstance(reg.get("root"), str) \
                    and within(reg["root"], folder):
                found.add(stem)
    if len(found) == 1:
        return found.pop(), None
    what = "aucune session de ce dossier" if not found else f"{len(found)} sessions de ce dossier ({', '.join(sorted(found))})"
    return None, f"id court {short} : {what} sous cet id ; rien n'est supprimé"


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
    le dossier jetable), ou un id hérité d'une autre session (une sonde d'avant le 17/11/2026, qui laissait
    passer `--env CLAUDE_CODE_SESSION_ID=…`, refusé depuis)."""
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
    more, reasons = request_traces(home, sessions, window)
    return todo + more, kept + reasons


def request_traces(home, sessions, window):
    """Les relevés de stats-board de ces sessions, `stats-board/requetes/<id>_<heure d'ouverture en ms>.json`
    (de vrais fichiers, le nom vérifié en entier, l'heure de leur nom dans la fenêtre du lancement) ; rend
    ([(chemin, False)], [raisons de garder]). Sans session : rien ; sans fenêtre : rien, et c'est dit."""
    todo, kept = [], []
    if not sessions:
        return todo, kept
    if window is None:
        kept.append("relevés de stats-board des sessions : fenêtre du lancement illisible, rien n'y est pris")
        return todo, kept
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
    en dernier : une reprise relit ses transcripts), et [raisons] de ce qui reste. Pour un lancement en
    arrière-plan (`BACKGROUND`), sa session est celle de son id court (`background_session`), seulement une
    fois retirée (`REMOVED`), et ses traces rangées par id se bornent aux relevés de stats-board, les seules que
    la mesure du 20/11/2026 a montrées (docs/commandes-claude.md)."""
    state, launcher = launch_launcher(folder)
    if state in REFUSED_LAUNCHERS:
        # Un lanceur qu'on ne peut pas exclure : ses fichiers pourraient être pris pour ceux du lancement.
        return [], [REFUSED_LAUNCHERS[state]]
    roots = roots_of(folder)
    background, short = background_state(folder)
    if background == "douteux":
        return [], [short]
    if background == "valide":
        if not (folder / REMOVED).exists() and not (folder / REMOVED).is_symlink():
            return [], [f"session d'arrière-plan {short} pas retirée par la sonde (pas de {REMOVED}) : python3 "
                        f"scripts/sonde.py --retirer {shlex.quote(str(folder))} (claude rm, puis le nettoyage), si claude "
                        "agents la liste encore ; une session retirée hors de la sonde (à la main, ou par un --retirer "
                        "interrompu entre claude rm et ce fichier) n'a pas de fin de fenêtre notée : ses restes sont à "
                        "relever à la main ; rien n'est supprimé"]
        window = background_window(folder)
        if window is None:
            return [], [f"{folder / REMOVED} illisible, douteux ou d'avant la marque : fenêtre du lancement "
                        "inconnue, rien n'est supprimé"]
        session, reason = background_session(folder, home, short)
        if session is None:
            return [], [reason]
        # Le lanceur sort avant toute famille, comme pour un lancement dans tmux.
        sessions = {session} - {launcher}
        if not sessions:
            return [], [f"la session {session} est celle qui a lancé la sonde : rien n'est supprimé"]
    else:
        # Le lanceur sort des sessions du lancement avant toute famille : même si le journal porte son id
        # (identité partagée), rien de lui n'est pris.
        sessions = launch_sessions(folder) - {launcher}
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
    traces, reasons = request_traces(home, sessions, window) if background == "valide" else \
        session_traces(home, opened_sessions(folder) & sessions, launch_window(folder))
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


def launcher_id(environ):
    """L'id de la session Claude Code qui lance la sonde (`CLAUDE_CODE_SESSION_ID` de cet environnement), en
    minuscules, s'il a la forme d'un id ; sinon None (lancée hors d'une session, ou un id hors forme)."""
    value = environ.get("CLAUDE_CODE_SESSION_ID")
    if isinstance(value, str) and SESSION_ID.fullmatch(value.lower()):
        return value.lower()
    return None


def launcher_mark(environ):
    """Ce que la marque du lancement note du lanceur : son id (`launcher_id`) ; `UNKNOWN_LAUNCHER` quand
    `CLAUDECODE` ou `CLAUDE_CODE_SESSION_ID` dit que la sonde est lancée depuis une session dont l'id ne se
    lit pas (le nettoyage ne supprime alors rien) ; None hors d'une session (les autres variables
    d'identité, seules, ne décident pas)."""
    launcher = launcher_id(environ)
    if launcher:
        return launcher
    return UNKNOWN_LAUNCHER if environ.get("CLAUDECODE") or environ.get("CLAUDE_CODE_SESSION_ID") else None


def env_refusal(env, launcher):
    """La raison de refuser les `--env` donnés, ou None : une clé de `IDENTITY` (posée après les `-u`, elle
    relierait la session à une autre, lanceur connu ou non), ou une valeur qui porte l'id du lanceur, quelle
    que soit la clé (casse et tirets ignorés), qui donnerait à la session l'identité de celle qui la lance."""
    keys = [a.split("=", 1)[0] for a in env if a.split("=", 1)[0] in IDENTITY]
    if keys:
        return (f"--env {', '.join(keys)} : variable d'identité d'une session Claude Code, que la sonde retire ; "
                "rien n'est lancé ni écrit")
    if not launcher:
        return None
    bare = launcher.replace("-", "")
    found = [a.split("=", 1)[0] for a in env if bare in a.split("=", 1)[-1].lower().replace("-", "")]
    if found:
        return (f"--env {', '.join(found)} porte l'id de la session qui lance la sonde (le lanceur) : la sonde "
                "tournerait sous son identité ; rien n'est lancé ni écrit")
    return None


def resume_refusal(folder, launcher, config):
    """La raison de refuser une reprise (`--reprise`, soit `claude --continue`) dans `folder`, ou None : le
    transcript de la session qui lance la sonde (`<lanceur>.jsonl`) est dans le dossier de transcripts de
    `folder` (l'une de ses écritures, `roots_of`) sous `config`, le dossier de réglages du lanceur ;
    `--continue`, qui reprend la dernière session du dossier, reprendrait alors la sienne, sous son id.
    Claude Code coupe un nom encodé de plus de `ENCODED_MAX` signes et lui ajoute `-<empreinte>` : ses
    dossiers se cherchent alors par ce début. Seuls des noms (`lstat`, liste de `projects/`) sont lus, rien
    n'est ouvert ; une lecture ratée refuse."""
    if not launcher:
        return None
    projects = Path(config) / "projects"
    for root in sorted(roots_of(folder)):
        name = project_dir_name(root)
        try:
            if len(name) <= ENCODED_MAX:
                dirs = [projects / name]
            else:
                # Sans la casse : sur un disque qui l'ignore (APFS), Claude Code encode la casse du disque.
                head = (name[:ENCODED_MAX] + "-").casefold()
                dirs = [projects / n for n in os.listdir(projects) if n.casefold().startswith(head)] \
                    if projects.exists() else []
            found = []
            for folder_of in dirs:
                try:
                    os.lstat(folder_of / f"{launcher}.jsonl")
                    found.append(folder_of)
                except FileNotFoundError:
                    pass
        except OSError as err:
            return (f"{projects} illisible ({err.strerror or err}) : la reprise pourrait être celle du lanceur ; "
                    "rien n'est lancé ni écrit")
        if found:
            return (f"--reprise dans {folder} : la session qui lance la sonde (le lanceur) y a son transcript, et "
                    "--continue la reprendrait sous son id ; rien n'est lancé ni écrit")
    return None


def session_command(tmux, name, folder, journals, claude, plugins, env, model, effort, resume, clean_name, keep,
                    model_before=None, session_id=None, launcher=None):
    """La commande tmux de la session : Claude Code avec la sonde, puis, à sa sortie, l'étape de fin de
    `sonde.py` (version après l'essai, et le nettoyage du dossier jetable `clean_name`, chemin absolu,
    sauf `keep`), dont le volet reste ouvert jusqu'à Entrée pour qu'on lise ce qu'elle a fait. Les variables
    d'identité (`IDENTITY`) et `LAUNCHER_VAR` sont retirées de l'environnement hérité ; une session neuve
    prend l'id `session_id` (une reprise garde `--continue`) ; l'id du lanceur, s'il est en forme, part au mod
    dans `LAUNCHER_VAR`, après les `--env`, qu'aucun ne masque donc."""
    passed = [f"{LAUNCHER_VAR}={launcher}"] if isinstance(launcher, str) and SESSION_ID.fullmatch(launcher) else []
    session = ["env", *[a for v in (*IDENTITY, LAUNCHER_VAR) for a in ("-u", v)], f"SONDE_JOURNAUX={journals}",
               *env, *passed,
               str(claude), "--plugin-dir", str(SONDE), *[a for p in plugins for a in ("--plugin-dir", str(p))],
               "--model", model, "--effort", effort,
               *(["--continue"] if resume else (["--session-id", session_id] if session_id else []))]
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


def claude_env(environ=None):
    """L'environnement d'une commande lancée par la sonde : sans les variables d'identité (`IDENTITY`) ni
    `LAUNCHER_VAR`, qui la lieraient à la session qui lance la sonde."""
    return {k: v for k, v in (os.environ if environ is None else environ).items()
            if k not in IDENTITY and k != LAUNCHER_VAR}


def launched_short_id(stdout):
    """L'id court de la session que `claude --bg` dit lancée : celui de l'unique ligne « backgrounded · <id> »
    de sa sortie (`BACKGROUNDED`, la ligne entière) ; None sans elle ou avec plusieurs."""
    found = [m.group(1) for m in (BACKGROUNDED.fullmatch(line.strip()) for line in stdout.splitlines()) if m]
    return found[0] if len(found) == 1 else None


def git_tree_of(path):
    """Le premier de `path` et de ses parents qui porte `.git` (la racine d'un dépôt git), ou None."""
    for folder in [path, *path.parents]:
        if os.path.lexists(folder / ".git"):
            return folder
    return None


def launch_background(args, claude, tmp=None, environ=None):
    """`--arriere-plan "<texte>"` : lance `claude --bg` avec cette demande dans un dossier jetable neuf (sous
    `tmp`, le dossier temporaire par défaut : `TMPDIR` le déplace), marqué comme un lancement dans tmux
    (`mark_launch`, sans modèle noté : une session d'arrière-plan ne tape pas `/model`), sans les variables
    d'identité, puis note dans `BACKGROUND` l'id court de l'unique ligne « backgrounded · <id> » de sa sortie.
    Sans elle (code d'erreur, « Workspace not trusted », zéro ou plusieurs lignes), rien n'est noté : SondeError.
    Le plugin de la sonde n'est pas chargé : `claude --bg` ne passe pas l'environnement de l'appelant à la
    session (mesuré le 20/11/2026), qui écrirait son journal dans le dépôt. Rend (dossier, id court)."""
    text = args.arriere_plan
    if not isinstance(text, str) or not text.strip() or text.startswith("-") or "\x00" in text:
        raise SondeError("--arriere-plan attend le texte de la demande, non vide, sans « - » en tête ni caractère nul "
                         "(seule une session lancée avec une demande a été mesurée) ; rien n'est lancé")
    parent = Path(tmp or tempfile.gettempdir())
    repo = git_tree_of(Path(os.path.realpath(parent)))
    if repo is not None:
        raise SondeError(f"{parent} est dans le dépôt git {repo} : une session d'arrière-plan y tournerait dans ce "
                         "dépôt (et une racine git neuve n'est pas approuvée) ; TMPDIR=<un dossier hors de tout dépôt> ; "
                         "rien n'est lancé")
    launcher = launcher_mark(os.environ if environ is None else environ)
    folder = Path(tempfile.mkdtemp(prefix="sonde-", dir=parent))
    journals = folder / "journaux"
    journals.mkdir()
    mark_launch(folder, claude, launcher=launcher)
    log_version(journals, claude, "avant")
    log_line(journals, f"lancement en arrière-plan : claude --bg --model {args.model} --effort {args.effort} <demande> ; "
                       f"lanceur : {launcher or 'aucun'}")
    try:
        res = subprocess.run([str(claude), "--bg", "--model", args.model, "--effort", args.effort, text], cwd=folder,
                             env=claude_env(environ), capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as err:
        log_line(journals, f"claude --bg n'a pas abouti : {err}")
        raise SondeError(f"claude --bg n'a pas abouti ({err}) : aucun id noté dans {folder} ; `claude agents` dit si "
                         "une session est partie quand même")
    for stream, out in (("sortie", res.stdout), ("erreur", res.stderr)):
        for line in out.splitlines():
            log_line(journals, f"claude --bg ({stream}) : {line}")
    short = launched_short_id(res.stdout) if res.returncode == 0 else None
    if short is None:
        said = " ".join((res.stdout + res.stderr).split())[:500] or f"code {res.returncode}, sans sortie"
        hint = ""
        if "Workspace not trusted" in res.stderr:
            # Pas « approuver le dossier temporaire » : tout ce qu'un outil y décompresse hériterait de l'approbation.
            hint = (f" ; {parent} n'est pas approuvé : relancer avec TMPDIR=<un dossier dédié aux essais, approuvé "
                    "(claude lancé une fois dedans, dans un autre terminal, jamais par `!`), hors de tout dépôt git>, "
                    "dont un sous-dossier ordinaire hérite l'approbation")
        elif res.returncode == 0:
            hint = (" ; une session tourne peut-être : claude agents la montre, claude stop puis claude rm l'arrêtent ; "
                    "ses restes sous ~/.claude ne se nettoient pas par la sonde (aucun id noté), à relever à la main")
        log_line(journals, f"aucun id noté (code {res.returncode}){hint}")
        raise SondeError(f"claude --bg n'a pas dit une seule session lancée ({said}) : aucun id noté dans {folder}"
                         f"{hint}")
    try:
        write_private(folder / BACKGROUND, {"court": short})
    except OSError as err:
        raise SondeError(f"session d'arrière-plan {short} lancée, mais son id n'a pas pu être noté ({err}) : la sonde ne "
                         f"l'arrêtera pas ; claude stop {short} puis claude rm {short} à la main, et ses restes sous "
                         "~/.claude, que la sonde ne nettoie pas, à relever à la main")
    log_line(journals, f"session d'arrière-plan {short} notée dans {BACKGROUND}")
    return folder, short


def background_folder(ref, tmp=None):
    """Le dossier jetable d'un lancement en arrière-plan que nomme `ref` (`launch_folder` : mêmes refus), son id
    court (`background_state`, relu à chaque geste) et le Claude Code de sa marque ; sinon SondeError : un
    dossier sans `BACKGROUND` (la marque ne porte aucun id), un fichier douteux, un Claude Code qui n'est pas un
    exécutable."""
    folder = launch_folder(ref, tmp)
    state, short = background_state(folder)
    if state == "aucun":
        raise SondeError(f"{folder} n'a pas de {BACKGROUND} : aucun id de session d'arrière-plan noté par son lancement ; "
                         "rien n'est arrêté, retiré ni supprimé")
    if state == "douteux":
        raise SondeError(short)
    claude = marker_claude(folder)
    if not claude:
        raise SondeError(f"le Claude Code noté dans {folder / MARKER} n'est pas un exécutable : rien n'est arrêté, "
                         "retiré ni supprimé")
    return folder, short, claude


def run_claude(claude, args, journals, timeout=120):
    """Lance `claude <args>` sans les variables d'identité et note sa sortie au journal : (réussi, sortie)."""
    try:
        res = subprocess.run([claude, *args], env=claude_env(), capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as err:
        log_line(journals, f"claude {' '.join(args)} : {err}")
        return False, str(err)
    out = (res.stdout + res.stderr).strip()
    for line in out.splitlines():
        log_line(journals, f"claude {' '.join(args)} : {line}")
    return res.returncode == 0, " ".join(out.split())[:500] or f"code {res.returncode}, sans sortie"


def read_agents(claude):
    """Les sessions que `claude agents --json --all` liste (en cours ou finies, pas retirées), de tous les
    dossiers (mesuré : sans `--cwd`, la liste n'est pas bornée au dossier courant de l'appel, et `/var` et
    `/private/var` y sont deux écritures d'un même dossier) ; (liste de dicts, None), ou (None, raison) quand la
    liste ne se lit pas : une absence non observée ne vaut pas retrait."""
    try:
        res = subprocess.run([claude, "agents", "--json", "--all"], env=claude_env(), capture_output=True, text=True,
                             timeout=60)
    except (OSError, subprocess.SubprocessError) as err:
        return None, f"claude agents illisible ({err})"
    if res.returncode != 0:
        return None, f"claude agents illisible (code {res.returncode} : {' '.join(res.stderr.split())[:200]})"
    try:
        data = json.loads(res.stdout)
    except ValueError:
        return None, "claude agents : sortie qui n'est pas du JSON"
    if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
        return None, "claude agents : sortie qui n'est pas une liste de sessions"
    return data, None


def listed_sessions(claude, folder, journals):
    """Les sessions que `claude agents --json --all` liste encore pour ce lancement : celles dont le dossier
    (`cwd`) est `folder` ou dessous, ou dont l'id court est celui que note `BACKGROUND` ; (liste, None), ou
    (None, raison) quand la liste ne se lit pas (`read_agents`)."""
    state, short = background_state(folder)
    data, doubt = read_agents(claude)
    if doubt:
        return None, doubt
    found = []
    for item in data:
        cwd, ident = item.get("cwd"), item.get("id")
        if (isinstance(cwd, str) and within(cwd, folder)) or (state == "valide" and ident == short):
            found.append(f"{ident} ({item.get('state')})")
    log_line(journals, f"claude agents --json --all : {len(found)} session(s) de ce lancement encore listée(s)")
    return found, None


def check_target(claude, folder, short, journals):
    """Avant `claude stop` ou `claude rm` : `claude agents --json --all` doit lister une seule session d'id court
    `short`, et dans `folder` (son `cwd`) ; sinon SondeError, rien n'est lancé. Une session déjà retirée hors de
    la sonde (à la main, ou par un `--retirer` interrompu avant `REMOVED`) n'est plus listée : la commande
    viserait un id disparu, qu'une autre session pourrait porter dans son nom."""
    data, doubt = read_agents(claude)
    if doubt:
        raise SondeError(f"{doubt} : la session {short} n'est pas vérifiée ; rien n'est lancé")
    same = [item for item in data if item.get("id") == short]
    here = [item for item in same if isinstance(item.get("cwd"), str) and within(item["cwd"], folder)]
    log_line(journals, f"claude agents --json --all : {len(same)} session(s) {short}, dont {len(here)} dans ce dossier")
    if not same:
        raise SondeError(f"claude agents ne liste pas la session {short} (retirée hors de la sonde, à la main ou par un "
                         f"--retirer interrompu entre claude rm et {REMOVED}, peut-être) : rien n'est lancé ; sans "
                         f"{REMOVED}, la sonde ne nettoie pas ses restes sous ~/.claude, à relever à la main")
    if len(same) != 1 or len(here) != 1:
        raise SondeError(f"claude agents liste {len(same)} session(s) {short}, dont {len(here)} dans {folder} : pas "
                         "une seule session de ce lancement sous cet id ; rien n'est lancé")


def clean_background(folder, home, claude, journals, keep=False):
    """Le nettoyage d'un lancement en arrière-plan (`--retirer`, puis `--nettoyer` après une interruption) : rien
    tant que `claude agents` liste une session de ce lancement ou ne se lit pas (une reprise `--bg --resume`
    de la conversation que `claude rm` garde pourrait tourner), sinon `clean` (son `plan` ne prend rien sans
    `REMOVED` ; avec `keep`, rien ne se supprime). Rend le rapport ; SondeError sur un refus."""
    listed, doubt = listed_sessions(claude, folder, journals)
    if doubt:
        raise SondeError(f"{doubt} : une session de ce lancement tourne peut-être encore ; rien n'est supprimé")
    if listed:
        raise SondeError(f"claude agents liste encore {', '.join(listed)} pour {folder} : une session de ce lancement "
                         "tourne ou n'est pas retirée (une reprise --bg --resume, par exemple) ; la retirer à la main "
                         "(claude stop puis claude rm <id listé>), puis python3 scripts/sonde.py --nettoyer "
                         f"{shlex.quote(str(folder))} ; rien n'est supprimé")
    try:
        return clean(folder, home, keep=keep)
    except OSError as err:
        raise SondeError(f"lecture impossible pendant le relevé ({err}) : rien n'est supprimé")


def print_report(folder, journals, report):
    """Le relevé du nettoyage, à l'écran et au journal de la sonde."""
    print(f"Nettoyage de {folder.name} sous ~/.claude :")
    for line in report.lines():
        print(f"  {line}")
        log_line(journals, f"nettoyage {folder.name} : {line}")


def background_gesture(verb, ref, tmp=None, home=None):
    """`--arreter <nom>` (`claude stop`) et `--retirer <nom>` (`claude rm`, puis `REMOVED`, puis le nettoyage)
    sur la seule session dont l'id court est noté dans le dossier jetable que nomme `ref`, et que `claude agents`
    liste une fois, dans ce dossier (`check_target`), juste avant la commande. Un échec de la commande arrête
    tout, rien n'est supprimé ; tout refus va au journal de la sonde. Rend le code de sortie."""
    folder, journals, removed = None, None, False
    try:
        folder, short, claude = background_folder(ref, tmp)
        journals = folder / "journaux"
        if (folder / REMOVED).exists() or (folder / REMOVED).is_symlink():
            raise SondeError(f"la session {short} est déjà retirée ({REMOVED}) : python3 scripts/sonde.py --nettoyer "
                             f"{shlex.quote(str(folder))} refait le nettoyage")
        check_target(claude, folder, short, journals)
        ok, said = run_claude(claude, [verb, short], journals)
        if not ok:
            raise SondeError(f"claude {verb} {short} a échoué ({said}) : "
                             + ("rien d'autre n'est fait" if verb == "stop" else "rien n'est supprimé"))
        print(f"claude {verb} {short} : {said}")
        if verb == "stop":
            return 0
        try:
            write_private(folder / REMOVED, {"court": short})
        except FileExistsError:
            raise SondeError(f"claude rm {short} a réussi, et {REMOVED} a été posé entre-temps par un autre --retirer : "
                             f"python3 scripts/sonde.py --nettoyer {shlex.quote(str(folder))} fait le nettoyage")
        except OSError as err:
            raise SondeError(f"claude rm {short} a réussi, mais {REMOVED} n'a pas pu être posé ({err}) : la fin de la "
                             "fenêtre du lancement manque, rien n'est supprimé ni ne le sera par --nettoyer ; ses "
                             "restes sous ~/.claude sont à relever à la main")
        removed = True
        report = clean_background(folder, home or Path.home() / ".claude", claude, journals)
    except SondeError as err:
        if journals is not None:
            what = ("arrêt refusé" if verb == "stop" else "nettoyage refusé après claude rm" if removed
                    else "retrait refusé ou interrompu")
            log_line(journals, f"{what} : {err}")
        raise
    print_report(folder, journals, report)
    return 1 if report.error else 0


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
        if background_state(folder)[0] != "aucun":
            # Un lancement en arrière-plan (`--arriere-plan`) : pas de volet tmux ni de modèle noté ; son
            # nettoyage attend que `claude agents` ne liste plus sa session, et son `plan` qu'elle soit retirée.
            claude = marker_claude(folder)
            if not claude:
                raise SondeError(f"le Claude Code noté dans {folder / MARKER} n'est pas un exécutable : claude agents "
                                 "ne se lit pas, rien n'est supprimé")
            report = clean_background(folder, home or Path.home() / ".claude", claude, journals, keep=args.garder)
        else:
            report = clean_tmux(args, tmux, folder, journals, home)
    except SondeError as err:
        if journals is not None:
            log_line(journals, f"nettoyage refusé : {err}")
        raise
    print_report(folder, journals, report)
    return 1 if report.error else 0


def clean_tmux(args, tmux, folder, journals, home=None):
    """Le nettoyage d'un lancement dans tmux (`finish`) : rien tant qu'un volet travaille dans le dossier, puis
    la remise du modèle par défaut du poste, puis `clean`. Rend le rapport ; SondeError sur un refus."""
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
        return clean(folder, home or Path.home() / ".claude", keep=args.garder)
    except OSError as err:
        raise SondeError(f"lecture impossible pendant le relevé ({err}) : rien n'est supprimé")


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


def background_ref(ref, tmp=None):
    """Vrai si `ref` nomme un dossier jetable accepté (`launch_folder`) d'un lancement en arrière-plan (il porte
    `BACKGROUND`, valide ou douteux) : son `--nettoyer` ne lit pas tmux. Un refus de `launch_folder` ou une
    lecture ratée : faux (le refus se redit ensuite, ou « tmux introuvable »)."""
    try:
        return background_state(launch_folder(ref, tmp))[0] != "aucun"
    except (SondeError, OSError):
        return False


def background_main(args, tmp=None, home=None):
    """Le mode d'arrière-plan : un seul de `--arriere-plan`, `--arreter` et `--retirer`, sans les options de
    tmux ni du nettoyage (`--model`, `--effort` et `--desktop` seulement, au lancement). Rend le code de sortie."""
    gestures = [name for name, value in (("--arriere-plan", args.arriere_plan), ("--arreter", args.arreter),
                                         ("--retirer", args.retirer)) if value is not None]
    others = [name for name, on in (("--dir", args.dir), ("--reprise", args.reprise), ("--titre", args.titre),
                                    ("--env", args.env), ("--plugin", args.plugin), ("--garder", args.garder),
                                    ("--nettoyer", args.nettoyer is not None), ("--envoyer", args.envoyer is not None),
                                    ("--voir", args.voir), ("--touches", args.touches),
                                    ("--apres-session", args.apres_session),
                                    ("--desktop", args.desktop and args.arriere_plan is None)) if on]
    if len(gestures) != 1 or others:
        raise SondeError(f"{' et '.join(gestures)} : un seul geste d'arrière-plan à la fois, sans "
                         f"{', '.join(others) or 'autre geste'} ; rien n'est lancé")
    if args.arreter is not None:
        return background_gesture("stop", args.arreter, tmp, home)
    if args.retirer is not None:
        return background_gesture("rm", args.retirer, tmp, home)
    if args.desktop:
        found = desktop_claude()
        if not found:
            raise SondeError("Claude Code de l'app desktop introuvable")
        claude = found[0]
    else:
        claude = shutil.which("claude")
        if not claude:
            raise SondeError("claude introuvable")
    folder, short = launch_background(args, claude, tmp)
    print(f"Session d'arrière-plan {short} lancée dans {folder} (Claude Code {claude})")
    print(f"  claude logs {short}        sa sortie récente")
    quoted = shlex.quote(str(folder))
    print(f"  python3 scripts/sonde.py --arreter {quoted}   claude stop {short}")
    print(f"  python3 scripts/sonde.py --retirer {quoted}   claude rm {short}, puis le nettoyage sous ~/.claude")
    if launch_launcher(folder)[0] in REFUSED_LAUNCHERS:
        print("Le nettoyage ne supprimera rien : lancée depuis une session dont l'id ne se lit pas (ses fichiers "
              "pourraient être pris pour ceux du lancement).")
    print(f"Journal : {folder / 'journaux' / LOG_NAME}")
    return 0


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
                        help="nettoie sous ~/.claude ce qu'a laissé l'essai du dossier jetable NOM (sonde-xxxxxxxx), interrompu, et remet le modèle par défaut du poste qu'un /model de l'essai a changé ; un dossier d'avant le 17/11/2026 (marque sans lanceur) n'est plus nettoyé ; un lancement en arrière-plan (--arriere-plan), une fois sa session retirée (--retirer)")
    parser.add_argument("--arriere-plan", metavar="TEXTE",
                        help="lance une session d'arrière-plan (claude --bg) avec cette demande, dans un dossier jetable marqué, sans tmux ; avec --model, --effort et --desktop seulement")
    parser.add_argument("--arreter", metavar="NOM",
                        help="claude stop sur la seule session d'arrière-plan notée dans le dossier jetable NOM (son nom ou son chemin)")
    parser.add_argument("--retirer", metavar="NOM",
                        help="claude rm sur la seule session d'arrière-plan notée dans le dossier jetable NOM, puis nettoie sous ~/.claude ce que ce lancement prouve avoir créé")
    # L'étape de fin, que la session tmux lance à la sortie de Claude Code : pas pour la main.
    parser.add_argument("--apres-session", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--claude", help=argparse.SUPPRESS)
    parser.add_argument("--journaux", help=argparse.SUPPRESS)
    parser.add_argument("--modele-avant", help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.arriere_plan is not None or args.arreter is not None or args.retirer is not None:
        # Avant tmux et avant le fichier de titre : le mode d'arrière-plan n'utilise ni l'un ni l'autre.
        try:
            sys.exit(background_main(args))
        except SondeError as err:
            sys.exit(f"ÉCHEC : {err}")
    tmux = shutil.which("tmux")
    # `--nettoyer` d'un lancement en arrière-plan n'a pas de volet tmux à contrôler : il passe sans tmux.
    if not tmux and not (args.nettoyer is not None and not args.apres_session and args.envoyer is None
                         and not args.voir and not args.touches and background_ref(args.nettoyer)):
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
    # L'id de la session qui lance la sonde, relevé avant que la commande de la session ne le retire ; un
    # `--env` qui le redonnerait est refusé ici, avant toute écriture (titre, dossier jetable, marque, journal).
    launcher = launcher_id(os.environ)
    # Ce que la marque en notera : l'id, « inconnu » (une session dont l'id ne se lit pas) ou rien.
    mark = launcher_mark(os.environ)
    refusal = env_refusal(args.env, launcher)
    if refusal is None and args.reprise and args.dir:
        # Le dossier de réglages du lanceur : le sien hérité, sinon ~/.claude.
        config = os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude"
        # La forme donnée (absolue) : `roots_of` y ajoute la forme réelle.
        refusal = resume_refusal(args.dir.expanduser().absolute(), launcher, config)
    elif refusal is None and args.reprise:
        refusal = "--reprise demande --dir (le dossier de la session à reprendre)"
    if refusal is None and args.reprise and mark == UNKNOWN_LAUNCHER:
        refusal = ("--reprise depuis une session dont l'id ne se lit pas : --continue pourrait reprendre cette "
                   "session sans que la sonde le sache ; rien n'est lancé ni écrit")
    if refusal:
        sys.exit(f"ÉCHEC : {refusal}")
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
        mark_launch(folder, claude, model_before, launcher=mark)
    if not valid_noted(model_before):
        model_line = "modèle par défaut du poste au lancement : illisible, la sonde ne l'écrira pas"
    elif config_moved:
        model_line = (f"modèle par défaut du poste au lancement : {model_label(model_before)} ; la sonde ne l'écrira "
                      "pas (CLAUDE_CONFIG_DIR : son /model écrit ailleurs)")
    else:
        model_line = f"modèle par défaut du poste au lancement : {model_label(model_before)}"
    log_line(journals, model_line)
    log_version(journals, claude, "avant")
    # Lancée depuis une session Claude Code, la sonde hériterait de son identité (son titre passait devant
    # `sessionTitle`, constaté le 28/10/2026 ; un `/rename` envoyé par la sonde a renommé la discussion qui
    # l'avait lancée, le 02/11/2026) : les variables d'identité sont retirées, et une session neuve prend un
    # id tiré ici.
    command = session_command(tmux, args.name, folder, journals, claude, plugins, args.env, args.model, args.effort,
                              args.reprise, clean_name, args.garder, model_before,
                              session_id=None if args.reprise else str(uuid.uuid4()), launcher=launcher)
    log_line(journals, f"session de la sonde : {'reprise (--continue)' if args.reprise else 'id neuf'} ; lanceur : "
                       + (launcher or ("inconnu (lancée depuis une session dont l'id ne se lit pas : le nettoyage "
                                       "ne supprimera rien)" if mark == UNKNOWN_LAUNCHER
                                       else "aucun (pas lancée depuis une session)")))
    # Le client tmux aussi, sans les variables d'identité : s'il démarre le serveur, l'environnement global de
    # celui-ci les garderait pour toutes ses sessions (l'étape de fin, une fenêtre ouverte à la main).
    res = subprocess.run(command, capture_output=True, text=True, timeout=30, env=claude_env())
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
    elif clean_name and mark == UNKNOWN_LAUNCHER:
        print("À la sortie de Claude Code : rien n'est supprimé (lancée depuis une session dont l'id ne se lit pas : "
              "ses fichiers pourraient être pris pour ceux du lancement) ; la liste de ce qui reste va au journal.")
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
