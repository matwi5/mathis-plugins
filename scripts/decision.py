#!/usr/bin/env python3
"""Ajoute une série à un fichier de décisions partagé (`travail/<sujet>/DECISIONS.md`) et ne commite qu'elle.

    python3 scripts/decision.py <DECISIONS.md> <fichier de la série> -m <message>
    python3 scripts/decision.py <DECISIONS.md> <fichier de la série> -F <fichier du message>

Plusieurs discussions écrivent dans le même fichier de décisions : le numéro d'une série se prenait à
la main, et le commit devait isoler ses lignes des ajouts non commités d'une autre discussion. Le
script fait tout le geste, et ne rend la main qu'avec la série commitée, ou le dit :

1. il prend un verrou exclusif, `decisions.lock` dans le dossier git commun du dépôt (celui de tous ses
   worktrees) : un verrou du système (`flock`, `msvcrt.locking` sous Windows), que le système relâche
   à la mort du processus, ce qui reprend un verrou laissé par un lancement tué ; le pid de celui qui
   le tient y est écrit, pour le message. Un second lancement attend au plus 10 s (la variable
   d'environnement `DECISION_ATTENTE` change ce délai, en secondes), puis abandonne sans rien écrire ;
2. il refuse, sans rien écrire, un index qui porte déjà quelque chose (il liste ces fichiers), une
   fusion, un rebase, un cherry-pick ou un revert en cours, un fichier qui n'est pas suivi dans HEAD,
   un lien symbolique, un chemin qui n'est pas un fichier de décisions d'un chantier (`DECISIONS_FILE`
   de `check.py`), un git plus ancien que 2.36 (sans `git hook run`), et un fichier de travail qui n'a
   plus toutes les séries de HEAD (lu pendant qu'un autre l'écrivait) ;
3. il prend le premier numéro libre au moment d'écrire : le plus grand numéro de série (`SERIES_TITLE`
   de `check.py`) de l'arbre de travail et de HEAD, plus un ; les séries non commitées d'une autre
   discussion comptent donc ;
4. il ajoute la série à la fin du fichier, titrée `## Série <n> — <titre> (<jj/mm/aaaa>)`, après une
   ligne vide : le titre est la première ligne du fichier de la série, le corps ce qui suit (lignes
   vides de bord retirées). Un titre vide, un corps vide, ou une ligne du corps qui serait un titre de
   série sont refusés. L'écriture passe par un fichier voisin, renommé sur l'ancien (pas de fichier
   tronqué) ; un fichier changé entre la lecture et le renommage (un Edit d'une autre discussion) fait
   recommencer la lecture, trois fois au plus ;
5. il commite son seul ajout, sans passer par l'index partagé, que d'autres discussions indexent
   pendant ce temps : un index privé, construit du commit HEAD lu sous le verrou, reçoit le blob de ce
   commit suivi de la série (`git hash-object`, `git update-index --cacheinfo`) ; le hook pre-commit
   tourne sur cet index (`git hook run pre-commit`, `GIT_INDEX_FILE`), puis l'arbre (`git write-tree`)
   doit ne changer que ce fichier, au blob de la série ; le commit (`git commit-tree -p <HEAD lu>`,
   avec le message donné par `-m` ou `-F`) est fait ;
6. il remplace HEAD et l'index partagé ensemble, comme `git commit` : il prend `index.lock` (le verrou
   de l'index de git, qui arrête les `git add` et les commits des autres pendant ce temps), vérifie
   que l'entrée du fichier porte encore le blob de HEAD (sinon une autre discussion l'a indexée pendant
   le hook : il s'arrête sans commiter), écrit l'index où le fichier vaut le blob commité, remplace
   HEAD s'il n'a pas bougé (`git update-ref HEAD <nouveau> <ancien>`), puis installe cet index. Un
   HEAD qui a bougé fait recommencer sur le nouveau, trois fois au plus, sauf si le nouveau porte déjà
   le numéro pris (code 3). L'ajout non commité d'une autre discussion reste dans l'arbre, et ce
   qu'elle indexe hors de ce fichier reste dans l'index partagé ;
7. il rend « Série <n> : commit <hash> » sur la sortie, le hash étant celui qu'imprime `git commit-tree`
   (aussi quand le commit est fait avec un reste à vérifier, code 3).

`git commit-tree` ne fait pas tout ce que fait `git commit` : seul le hook pre-commit tourne (le dépôt
n'en a pas d'autre), le commit n'est pas signé, et le message est pris tel quel, sans nettoyage ; le
journal de HEAD reçoit « commit: <sujet> ». Un hook en échec laisse la série écrite dans le fichier,
non commitée, et l'index partagé tel qu'avant : le message le dit (code 3). Jamais `git reset`,
`restore` ni `checkout`, qui effaceraient l'index ou l'arbre des autres. Les variables `GIT_*` de
l'environnement sont retirées des appels git (sous un hook, elles viseraient un autre index), et les
chemins des appels du script sont lus littéralement (`GIT_LITERAL_PATHSPECS`, pas pour le hook).
Codes : 0 série commitée, 1 refus sans rien écrire, 2 mauvais arguments, 3 série écrite mais non
commitée, ou commitée avec un reste à vérifier. Sans dépendance hors de la bibliothèque standard.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

try:
    import fcntl
except ImportError:  # Windows
    fcntl = None
    import msvcrt

# `check.py`, à côté de ce script, donne la forme d'un fichier de décisions et d'un titre de série :
# chemin ajouté à la main (un lancement par `python3 -I` n'ajoute pas le dossier du script).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from check import DECISIONS_FILE, SERIES_TITLE  # noqa: E402

USAGE = [line.strip() for line in __doc__.splitlines() if line.strip().startswith("python3 scripts/")]
LOCK_NAME = "decisions.lock"
# L'octet verrouillé sous Windows (`msvcrt.locking` verrouille une plage d'octets, de façon impérative) :
# loin après le pid écrit en tête, qui se lit donc encore quand un autre tient le verrou.
LOCK_OFFSET = 4096
DEFAULT_WAIT = 10.0
# Les essais d'écriture quand le fichier change entre la lecture et le renommage, et les essais du
# commit quand HEAD bouge entre sa lecture et son remplacement.
WRITE_TRIES = 3
COMMIT_TRIES = 3
# Les essais de prise de `index.lock` quand un autre git le tient, à 0,1 s d'intervalle.
INDEX_TRIES = 50
# Le premier git qui a `git hook run`.
HOOK_RUN_SINCE = (2, 36)
# Ce qui dit qu'une opération est en cours dans le dépôt, par `git rev-parse --git-path`.
IN_PROGRESS = ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply")
WRITTEN = " ; rien n'est écrit"


class DecisionError(Exception):
    """Un refus avant toute écriture (code 1, ou 2 pour de mauvais arguments), ou, avec `code=3`, une
    série écrite mais non commitée, ou commitée avec un reste à vérifier (`commit` porte alors son hash)."""

    def __init__(self, message, code=1, commit=None):
        super().__init__(message)
        self.code = code
        self.commit = commit
        self.number = None


def git_env(index=None, literal=True):
    """L'environnement d'un appel git : sans les variables GIT_* (sous un hook, elles viseraient un autre
    index), les chemins lus littéralement (sauf pour le hook, dont les commandes gardent leurs motifs),
    et l'index privé `index` quand il est donné."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    if literal:
        env["GIT_LITERAL_PATHSPECS"] = "1"
    if index is not None:
        env["GIT_INDEX_FILE"] = str(index)
    return env


def git(cwd, *args, data=None, check=True, index=None, literal=True):
    """Lance git dans `cwd` ; rend le résultat (octets). Un échec, avec `check`, est un refus (code 1) :
    après l'écriture, `add_series` le redit en code 3."""
    result = subprocess.run(["git", *args], cwd=cwd, input=data, capture_output=True,
                            env=git_env(index, literal))
    if check and result.returncode != 0:
        raise DecisionError(f"git {' '.join(args[:2])} a échoué : {result.stderr.decode('utf-8', 'replace').strip()}"
                            f"{WRITTEN}")
    return result


def out(cwd, *args, index=None):
    return git(cwd, *args, index=index).stdout.decode("utf-8").strip()


def read_series(path):
    """Le titre et le corps d'un fichier de série ; DecisionError s'il est mal formé."""
    path = Path(path)
    if not path.is_file():
        raise DecisionError(f"fichier de la série introuvable : {path}")
    lines = path.read_text(encoding="utf-8").replace("\r\n", "\n").split("\n")
    title = lines[0].strip() if lines else ""
    body = lines[1:]
    while body and not body[0].strip():
        body.pop(0)
    while body and not body[-1].strip():
        body.pop()
    if not title:
        raise DecisionError(f"{path} : la première ligne, le titre de la série, est vide{WRITTEN}")
    if SERIES_TITLE.search(title) or title.startswith("#"):
        raise DecisionError(f"{path} : le titre se donne nu (« Réponses du cadrage »), le script le met en "
                            f"« ## Série <n> — … »{WRITTEN}")
    if not body:
        raise DecisionError(f"{path} : le corps de la série est vide{WRITTEN}")
    doubled = [n for n, line in enumerate(body, 3) if SERIES_TITLE.match(line)]
    if doubled:
        raise DecisionError(f"{path} : la ligne {doubled[0]} du corps est un titre de série (« ## Série N ») : elle "
                            f"fausserait le numéro{WRITTEN}")
    return title, body


def target(path):
    """Le fichier de décisions résolu, la racine de son dépôt et son chemin dans le dépôt ; DecisionError
    pour un lien symbolique, un fichier absent ou un chemin hors de `DECISIONS_FILE`."""
    path = Path(path)
    if path.is_symlink():
        raise DecisionError(f"{path} est un lien symbolique : donner le fichier lui-même{WRITTEN}")
    if not path.is_file():
        raise DecisionError(f"fichier de décisions introuvable : {path}")
    real = path.resolve()
    top = Path(out(real.parent, "rev-parse", "--show-toplevel")).resolve()
    rel = real.relative_to(top).as_posix()
    if not DECISIONS_FILE.fullmatch(rel):
        raise DecisionError(f"{rel} n'est pas un fichier de décisions d'un chantier (travail/<sujet>/DECISIONS.md)"
                            f"{WRITTEN}")
    return real, top, rel


def take_lock(top, wait):
    """Le fichier du verrou, verrouillé ; DecisionError si un autre le tient au-delà de `wait` secondes."""
    common = Path(out(top, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    handle = open(common / LOCK_NAME, "a+", encoding="utf-8")
    deadline = time.monotonic() + wait
    while True:
        try:
            if fcntl:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            else:
                handle.seek(LOCK_OFFSET)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            break
        except OSError:
            if time.monotonic() >= deadline:
                try:
                    handle.seek(0)
                    holder = handle.read(64).strip() or "inconnu"
                except OSError:
                    holder = "inconnu"
                handle.close()
                raise DecisionError(f"verrou {common / LOCK_NAME} tenu par le processus {holder} depuis plus de "
                                    f"{wait:g} s{WRITTEN}")
            time.sleep(0.1)
    handle.seek(0)
    handle.truncate()
    handle.write(f"{os.getpid()}\n")
    handle.flush()
    return handle


def release(handle):
    try:
        if fcntl:
            fcntl.flock(handle, fcntl.LOCK_UN)
        else:
            handle.seek(LOCK_OFFSET)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    finally:
        handle.close()


def staged_names(top):
    return [n for n in git(top, "diff", "--cached", "--name-only", "-z").stdout.decode("utf-8").split("\0") if n]


def head_state(top, rel):
    """Le commit HEAD, le blob du fichier dans ce commit et son texte ; None si HEAD n'existe pas ou ne
    suit pas le fichier."""
    head = git(top, "rev-parse", "--verify", "--quiet", "HEAD^{commit}", check=False).stdout.decode("utf-8").strip()
    if not head:
        return None
    found = git(top, "rev-parse", "--verify", "--quiet", f"{head}:{rel}", check=False)
    if found.returncode != 0:
        return None
    blob = found.stdout.decode("utf-8").strip()
    return head, blob, git(top, "cat-file", "blob", blob).stdout.decode("utf-8")


def check_repo(top, rel):
    """Refuse un git sans `git hook run`, un index non vide, une opération en cours ou un fichier non
    suivi dans HEAD ; rend le mode de l'entrée du fichier, puis `head_state`."""
    version = re.search(r"(\d+)\.(\d+)", out(top, "version"))
    if not version or tuple(map(int, version.groups())) < HOOK_RUN_SINCE:
        raise DecisionError(f"ce git est plus ancien que 2.36 et n'a pas `git hook run`, qui fait tourner le "
                            f"pre-commit{WRITTEN}")
    staged = staged_names(top)
    if staged:
        raise DecisionError("l'index porte déjà des changements, qu'un commit d'autrui prendrait avec la série : "
                            f"{', '.join(staged)}{WRITTEN}")
    for name in IN_PROGRESS:
        if Path(out(top, "rev-parse", "--path-format=absolute", "--git-path", name)).exists():
            raise DecisionError(f"une opération git est en cours ({name}){WRITTEN}")
    state = head_state(top, rel)
    entry = out(top, "ls-files", "-s", "--", rel).split()
    if state is None or not entry:
        raise DecisionError(f"{rel} n'est pas suivi dans HEAD : le commiter d'abord{WRITTEN}")
    return (entry[0], *state)


def numbers(text):
    return {int(n) for n in SERIES_TITLE.findall(text)}


def appended(text, block_lines):
    """Le texte suivi du bloc, à ses fins de ligne (CRLF s'il en a), après une ligne vide."""
    newline = "\r\n" if "\r\n" in text else "\n"
    if text and not text.endswith("\n"):
        text += newline
    if text.strip() and not text.endswith(newline + newline):
        text += newline
    return text + newline.join(block_lines) + newline


def write_if_unchanged(path, expected, new):
    """Écrit `new` dans `path` par un fichier voisin renommé, si `path` porte encore `expected` juste
    avant le renommage ; rend False sinon, sans rien changer."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".decision-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(new.encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
        shutil.copymode(path, tmp)
        if path.read_bytes() != expected.encode("utf-8"):
            return False
        os.replace(tmp, path)
        tmp = None
        return True
    finally:
        if tmp is not None and os.path.exists(tmp):
            os.unlink(tmp)


def private_path(top, name):
    """Un fichier propre à ce lancement dans le dossier git du worktree, et son `.lock` de git."""
    path = Path(out(top, "rev-parse", "--path-format=absolute", "--git-path", f"{name}-{os.getpid()}"))
    return path, path.with_name(path.name + ".lock")


def commit_tree(top, rel, mode, head, blob, phase):
    """L'arbre du commit : celui de `head` où `rel` vaut `blob`, construit dans un index privé où le hook
    pre-commit tourne ; DecisionError (code 3) si le hook refuse ou si l'arbre change autre chose."""
    index, index_lock = private_path(top, "decision-index")
    try:
        git(top, "read-tree", head, index=index)
        git(top, "update-index", "--cacheinfo", f"{mode},{blob},{rel}", index=index)
        hook = git(top, "hook", "run", "--ignore-missing", "pre-commit", index=index, literal=False, check=False)
        if hook.returncode != 0:
            text = (hook.stdout + hook.stderr).decode("utf-8", "replace").strip()
            raise DecisionError(f"commit refusé par le hook pre-commit :\n{text}\nL'index partagé n'a pas été touché ; "
                                f"{phase['text']}", code=3)
        tree = out(top, "write-tree", index=index)
    finally:
        for leftover in (index, index_lock):
            if leftover.exists():
                leftover.unlink()
    changed = [n for n in git(top, "diff-tree", "-z", "--name-only", "-r", head, tree).stdout.decode("utf-8")
               .split("\0") if n]
    if changed != [rel] or out(top, "rev-parse", f"{tree}:{rel}") != blob:
        raise DecisionError(f"l'arbre à commiter ne change pas que {rel} au blob de la série (le hook a-t-il changé "
                            f"l'index ?) : {', '.join(changed)} ; {phase['text']}", code=3)
    return tree


def take_index_lock(top, phase):
    """Le chemin de l'index partagé, celui de son `index.lock` pris par ce lancement (créé exclusif, comme
    le fait git), et son descripteur ; DecisionError (code 3) si un autre git le tient trop longtemps."""
    index = Path(out(top, "rev-parse", "--path-format=absolute", "--git-path", "index"))
    lock = index.with_name(index.name + ".lock")
    for _ in range(INDEX_TRIES):
        try:
            return index, lock, os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            time.sleep(0.1)
    raise DecisionError(f"{lock} est tenu par un autre git depuis plus de {INDEX_TRIES / 10:g} s ; {phase['text']}",
                        code=3)


def swap_head_and_index(top, rel, mode, head, head_blob, blob, new, subject, phase):
    """Sous `index.lock` : vérifie que l'index partagé porte encore `head_blob` pour `rel`, écrit l'index
    où `rel` vaut `blob`, remplace HEAD par `new` s'il vaut encore `head`, puis installe l'index. Rend
    False si HEAD a bougé (rien n'est changé) ; DecisionError (code 3) si l'index a été touché."""
    staged_copy, staged_copy_lock = private_path(top, "decision-index-partage")
    index, lock, fd = take_index_lock(top, phase)
    installed = False
    try:
        # HEAD d'abord : un commit d'autrui par l'index partagé y met aussi son blob, que la relance reprend.
        if out(top, "rev-parse", "--verify", "HEAD^{commit}") != head:
            return False
        entry = out(top, "ls-files", "-s", "--", rel).split()
        if entry[1:2] != [head_blob]:
            raise DecisionError(f"l'entrée de {rel} dans l'index partagé a changé pendant le hook (une autre discussion "
                                f"l'a indexée) : rien n'est commité, son index est laissé tel quel ; {phase['text']}",
                                code=3)
        shutil.copyfile(index, staged_copy)
        git(top, "update-index", "--cacheinfo", f"{mode},{blob},{rel}", index=staged_copy)
        moved = git(top, "update-ref", "-m", f"commit: {subject}", "HEAD", new, head, check=False)
        if moved.returncode != 0:
            if out(top, "rev-parse", "--verify", "HEAD^{commit}") != head:
                return False
            raise DecisionError(f"git update-ref a échoué : {moved.stderr.decode('utf-8', 'replace').strip()} ; "
                                f"{phase['text']}", code=3)
        phase["commit"] = new
        phase["text"] = f"la série est commitée ({new[:12]}), mais l'index partagé n'a pas été mis à jour : il indexe " \
                        f"le retrait de la série ; pour le réparer : git update-index --cacheinfo {mode},{blob},{rel}"
        try:
            os.write(fd, staged_copy.read_bytes())
            os.fsync(fd)
            os.close(fd)
            fd = None
            os.replace(lock, index)
        except OSError as err:
            raise DecisionError(f"installation de l'index refusée ({err}) ; {phase['text']}", code=3)
        installed = True
        return True
    finally:
        if fd is not None:
            os.close(fd)
        if not installed and lock.exists():
            lock.unlink()
        for leftover in (staged_copy, staged_copy_lock):
            if leftover.exists():
                leftover.unlink()


def commit_series(top, rel, mode, head, head_blob, head_text, block, n, message_args, subject, phase):
    """Commite la série sur HEAD, sans l'index partagé, puis remplace HEAD et l'index ensemble ; rend
    (numéro, hash court, hash complet)."""
    for _ in range(COMMIT_TRIES):
        # Le blob de HEAD suivi de la même série : l'ajout non commité d'une autre discussion n'y est pas.
        blob = git(top, "hash-object", "-w", "--no-filters", "--stdin",
                   data=appended(head_text, block).encode("utf-8")).stdout.decode("utf-8").strip()
        tree = commit_tree(top, rel, mode, head, blob, phase)
        new = out(top, "commit-tree", tree, "-p", head, *message_args)
        if swap_head_and_index(top, rel, mode, head, head_blob, blob, new, subject, phase):
            phase["text"] = f"la série {n} est commitée ({new[:12]}), mais sa vérification a échoué : à vérifier"
            return n, out(top, "rev-parse", "--short", new), new
        # HEAD a bougé (un commit d'une autre discussion) : recommencer sur le nouveau, s'il n'a pas pris le numéro.
        state = head_state(top, rel)
        if state is None:
            raise DecisionError(f"{rel} n'est plus suivi dans le nouveau HEAD ; {phase['text']}", code=3)
        head, head_blob, head_text = state
        if n in numbers(head_text):
            raise DecisionError(f"HEAD a avancé pendant le commit ({head[:12]}) et porte déjà une série {n} (la vôtre, "
                                f"prise par le commit d'une autre discussion, ou la sienne) ; à vérifier dans {rel} ; "
                                f"{phase['text']}", code=3)
    raise DecisionError(f"HEAD a bougé à chaque essai ({COMMIT_TRIES}) ; {phase['text']}", code=3)


def add_series(decisions, series, message_args, subject, wait=DEFAULT_WAIT):
    """Le geste entier ; rend (numéro, hash court, hash complet)."""
    title, body = read_series(series)
    real, top, rel = target(decisions)
    handle = take_lock(top, wait)
    try:
        mode, head, head_blob, head_text = check_repo(top, rel)
        for _ in range(WRITE_TRIES):
            current = real.read_bytes().decode("utf-8")
            if not numbers(head_text) <= numbers(current):
                raise DecisionError(f"{rel} n'a plus toutes les séries de HEAD (lu pendant qu'une autre discussion "
                                    f"l'écrivait ?){WRITTEN}")
            n = max(numbers(current) | numbers(head_text) | {0}) + 1
            block = [f"## Série {n} — {title} ({time.strftime('%d/%m/%Y')})", "", *body]
            if write_if_unchanged(real, current, appended(current, block)):
                break
        else:
            raise DecisionError(f"{rel} a changé à chaque essai entre la lecture et l'écriture{WRITTEN}")
        # La série est écrite : une erreur de git (code 1 de `git()`, « rien n'est écrit ») se redit en
        # code 3, avec ce qui est vrai à ce moment, pour qu'une relance n'ajoute pas la série une seconde fois.
        phase = {"text": f"la série {n} reste écrite dans {rel}, non commitée", "commit": None}
        try:
            return commit_series(top, rel, mode, head, head_blob, head_text, block, n, message_args, subject, phase)
        except (DecisionError, OSError, UnicodeError) as err:
            # Une erreur du système (disque plein, droits) ou de décodage, comme une erreur de git, se redit
            # en code 3 : la série est écrite.
            if not isinstance(err, DecisionError) or err.code != 3:
                reason = str(err).removesuffix(WRITTEN) if isinstance(err, DecisionError) else f"{type(err).__name__} : {err}"
                err = DecisionError(f"{reason} ; {phase['text']}", code=3)
            err.commit, err.number = phase["commit"], n
            raise err
    finally:
        release(handle)


def wait_from_env():
    value = os.environ.get("DECISION_ATTENTE", "")
    try:
        wait = float(value) if value else DEFAULT_WAIT
    except ValueError:
        raise DecisionError(f"DECISION_ATTENTE doit être un nombre de secondes, pas « {value} »", code=2)
    if not 0 <= wait <= 600:
        raise DecisionError(f"DECISION_ATTENTE hors de 0 à 600 s : {value}", code=2)
    return wait


def main(argv):
    if argv[:1] in (["--aide"], ["-h"], ["--help"]):
        print(__doc__)
        return 0
    if len(argv) != 4 or argv[2] not in {"-m", "-F"}:
        print("\n".join(USAGE), file=sys.stderr)
        return 2
    decisions, series, flag, value = argv
    if flag == "-F":
        message = Path(value)
        try:
            text = message.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as err:
            print(f"ÉCHEC : fichier du message illisible ({value}) : {err}", file=sys.stderr)
            return 2
        message_args = ["-F", str(message.resolve())]
    else:
        text = value
        message_args = ["-m", value]
    if not text.strip():
        print("ÉCHEC : message vide", file=sys.stderr)
        return 2
    subject = next(line.strip() for line in text.splitlines() if line.strip())
    try:
        n, short, _ = add_series(decisions, series, message_args, subject, wait_from_env())
    except DecisionError as err:
        if err.commit:
            print(f"Série {err.number} : commit {err.commit[:12]} (reste à vérifier : voir le message d'échec)")
        print(f"ÉCHEC : {err}", file=sys.stderr)
        return err.code
    print(f"Série {n} : commit {short}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
