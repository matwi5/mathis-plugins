#!/usr/bin/env python3
"""Ajoute une série à un fichier de décisions partagé (`travail/<sujet>/DECISIONS.md`) et ne commite qu'elle ;
crée ce fichier dans le clone principal quand il n'existe pas encore.

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
2. il refuse, sans rien écrire, un fichier de décisions d'un worktree lié (son dossier git n'est pas le
   dossier git commun : le worktree a son propre fichier et son propre HEAD, et une série y prendrait le
   numéro qu'une autre prend dans le clone principal), avant le verrou ; le dépôt se lit depuis le
   chemin du fichier, quel que soit le dossier courant, et le message donne le chemin du même fichier
   dans le clone principal, où les séries s'écrivent, et sa branche ; sans chemin à relancer quand la
   racine du clone principal est introuvable (dépôt nu, `--separate-git-dir`, sous-module), ou quand le
   worktree porte des numéros de série qu'il n'a pas (« les amener d'abord ») : une relance y reprendrait
   un numéro déjà pris. Quand le clone principal n'a ce fichier ni dans son arbre ni dans son HEAD, il
   le crée là (étape 2 bis), jamais dans le worktree. Il refuse aussi un index qui porte déjà quelque
   chose (il liste ces fichiers), une fusion, un rebase, un cherry-pick ou un revert en cours, un fichier
   présent mais pas suivi dans HEAD, ou suivi dans HEAD mais retiré de l'arbre, un lien symbolique, un
   chemin qui n'est pas un fichier de décisions d'un chantier (`DECISIONS_FILE` de `check.py`), un git
   plus ancien que 2.36 (sans `git hook run`), et un fichier de travail qui n'a plus toutes les séries
   de HEAD (lu pendant qu'un autre l'écrivait) ;
2 bis. la création : un fichier de décisions n'existe qu'à un seul endroit, le clone principal. Absent
   de son arbre et de son HEAD, lus sous le verrou (deux lancements avec le chemin du clone principal
   sur le même fichier absent : le premier le crée, le second y ajoute la série 2 ; lancé avec le chemin
   d'un worktree lié, le choix entre créer et renvoyer au clone principal se fait avant le verrou), il est
   créé quand rien d'autre dans le dépôt ne le porte, à la casse près (l'arbre, l'index ou le HEAD d'un
   worktree, une branche locale, même sans worktree, ou distante relevée, `refs/remotes` : sinon refus,
   « l'amener d'abord dans le clone principal » ; une lecture de git ratée refuse aussi), quand le sujet
   du chantier n'a que des lettres et des chiffres ASCII, `.`, `_` et `-` (`SUBJECT`, sans point final),
   sans chantier du même nom à la casse près, et quand le chemin ne
   passe par aucun lien symbolique qui mène dans le dépôt ou s'y trouve : le dossier `travail/<sujet>/` au
   besoin, puis le fichier, titré `# Décisions — <sujet>`, suivi de la série 1, par un fichier voisin lié
   à son nom (`os.link`, qui n'écrase jamais un fichier posé entre-temps), commité comme à l'étape 5, sur
   un HEAD relu juste avant qui ne le suit toujours pas ; la sortie dit « créé » et donne son chemin. Une
   création ratée avant le commit (écriture impossible, hook en échec, interruption) retire le fichier,
   s'il porte encore les seuls octets écrits par ce lancement et que ni HEAD ni l'index ne le suivent, et
   les dossiers créés par ce lancement, s'ils sont vides (code 4) ; sinon elle le laisse et dit ce qui
   reste (code 3), et si un commit d'une autre discussion a pris la série 1 de ce lancement, qu'elle est
   commitée et qu'il ne faut pas relancer ;
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
   commit suivi de la série (`git hash-object`, `git update-index --add --cacheinfo`) ; le hook pre-commit
   tourne sur cet index (`git hook run pre-commit`, `GIT_INDEX_FILE`), puis l'arbre (`git write-tree`)
   doit ne changer que ce fichier, au blob de la série ; le commit (`git commit-tree -p <HEAD lu>`,
   avec le message donné par `-m` ou `-F`) est fait ;
6. il remplace HEAD et l'index partagé ensemble, comme `git commit` : il prend `index.lock` (le verrou
   de l'index de git, qui arrête les `git add` et les commits des autres pendant ce temps), vérifie
   que l'entrée du fichier porte encore le blob de HEAD, ou qu'il n'en a toujours pas pour une création
   (sinon une autre discussion l'a indexée pendant le hook : il s'arrête sans commiter), écrit l'index
   où le fichier vaut le blob commité, remplace
   HEAD s'il n'a pas bougé (`git update-ref HEAD <nouveau> <ancien>`), puis installe cet index. Un
   HEAD qui a bougé fait recommencer sur le nouveau, trois fois au plus, sauf si le nouveau porte déjà
   le numéro pris, ou, pour une création, s'il suit maintenant le fichier (code 3). L'ajout non commité d'une autre discussion reste dans l'arbre, et ce
   qu'elle indexe hors de ce fichier reste dans l'index partagé ;
7. il rend « Série <n> : commit <hash> » sur la sortie, le hash étant celui qu'imprime `git commit-tree`
   (aussi quand le commit est fait avec un reste à vérifier, code 3), suivi pour une création de
   « (fichier créé : <chemin dans le clone principal>) ».

`git commit-tree` ne fait pas tout ce que fait `git commit` : seul le hook pre-commit tourne (le dépôt
n'en a pas d'autre), le commit n'est pas signé, et le message est pris tel quel, sans nettoyage ; le
journal de HEAD reçoit « commit: <sujet> ». Un hook en échec laisse la série écrite dans le fichier,
non commitée, et l'index partagé tel qu'avant : le message le dit (code 3). Jamais `git reset`,
`restore` ni `checkout`, qui effaceraient l'index ou l'arbre des autres. Les variables `GIT_*` de
l'environnement sont retirées des appels git (sous un hook, elles viseraient un autre index), et les
chemins des appels du script sont lus littéralement (`GIT_LITERAL_PATHSPECS`, pas pour le hook).
Codes : 0 série commitée, 1 refus sans rien écrire, 2 mauvais arguments, 3 à vérifier avant toute
relance, ce que dit le message : série écrite mais non commitée, commitée avec un reste à vérifier, ou
création défaite dont le fichier a été remplacé par un autre ; 4 création ratée et défaite (fichier
retiré, et les dossiers créés par ce lancement s'ils sont vides). Sans dépendance hors de la
bibliothèque standard.
"""

import os
import re
import shutil
import signal
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
# Le sujet d'un chantier que le script crée (`travail/<sujet>/`) : il entre dans un chemin et dans le titre
# du fichier, où un saut de ligne glisserait un faux titre de série ; liste blanche ASCII, 100 signes au plus,
# sans point final (Windows le retire d'un nom de dossier : `x.` y serait le chantier `x`).
SUBJECT = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_-])?", re.ASCII)
CREATED_TITLE = "# Décisions — {}"
# Le mode d'un fichier de décisions créé, dans l'arbre de git.
CREATED_MODE = "100644"
# Le code d'une création ratée et défaite : fichier retiré, et dossiers créés par ce lancement s'ils sont vides.
UNDONE = 4


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
    """Le fichier de décisions où écrire (résolu, présent ou à créer), la racine de son dépôt et son chemin
    dans le dépôt : pour le fichier d'un worktree lié que le clone principal n'a pas encore, ceux du clone
    principal, où il sera créé ; DecisionError pour un lien symbolique, un dossier, un chemin hors de l'arbre
    de travail ou de `DECISIONS_FILE`, ou le fichier d'un worktree lié que le clone principal a
    (`writer_root`)."""
    path = Path(path)
    if path.is_symlink():
        raise DecisionError(f"{path} est un lien symbolique : donner le fichier lui-même{WRITTEN}")
    if path.exists() and not path.is_file():
        raise DecisionError(f"{path} n'est pas un fichier{WRITTEN}")
    # `realpath` résout aussi un chemin dont la fin n'existe pas encore (le fichier, son dossier de chantier).
    real = Path(os.path.realpath(path))
    anchor = real.parent
    while not anchor.is_dir():
        if anchor.parent == anchor:
            raise DecisionError(f"aucun dossier existant au-dessus de {path}{WRITTEN}")
        anchor = anchor.parent
    top = Path(out(anchor, "rev-parse", "--show-toplevel")).resolve()
    try:
        rel = real.relative_to(top).as_posix()
    except ValueError:
        raise DecisionError(f"{path} n'est pas dans l'arbre de travail de son dépôt ({top}){WRITTEN}")
    if not DECISIONS_FILE.fullmatch(rel):
        raise DecisionError(f"{rel} n'est pas un fichier de décisions d'un chantier (travail/<sujet>/DECISIONS.md)"
                            f"{WRITTEN}")
    if not os.path.lexists(real):
        # Un fichier à créer ne passe par aucun lien symbolique qui mène dans un dossier du dépôt ou qui s'y
        # trouve (un dossier de chantier lié à un autre, ou au chantier d'un autre dépôt) ; ceux d'au-dessus du
        # dépôt (`/var` sous macOS, un raccourci vers la racine du dépôt) ne comptent pas.
        given = Path(os.path.abspath(path))
        links = [a for a in given.parents
                 if a.is_symlink() and (top in Path(os.path.realpath(a)).parents
                                        or (p := Path(os.path.realpath(a.parent))) == top or top in p.parents)]
        if links:
            raise DecisionError(f"{path} passe par un lien symbolique du dépôt ({links[0]}) : il n'est pas créé"
                                f"{WRITTEN}")
    root = writer_root(top, real, rel)
    return root / rel, root, rel


def writer_root(top, real, rel):
    """La racine où la série s'écrit : `top` dans le clone principal ; pour un worktree lié (son dossier git
    n'est pas le dossier git commun), le clone principal quand il n'a ce fichier ni dans son arbre ni dans
    son HEAD (il y sera créé, jamais dans le worktree), sinon DecisionError : chaque worktree a son fichier
    et son HEAD, et deux séries y prendraient le même numéro. Le message donne le chemin du même fichier
    dans le clone principal, où les séries s'écrivent, seulement quand la relance y est sûre : sa racine
    est trouvée, il a ce fichier, et il porte déjà tous les numéros de série du worktree (son fichier et
    son HEAD) ; sinon il dit quoi faire d'abord, sans chemin à relancer."""
    git_dir = Path(out(top, "rev-parse", "--absolute-git-dir")).resolve()
    common = Path(out(top, "rev-parse", "--path-format=absolute", "--git-common-dir")).resolve()
    if git_dir == common:
        return top
    root = main_clone(common)
    main = None if root is None else root / rel
    if root is None:
        # Pas de relance proposée : vers une racine non vérifiée, elle sauterait les contrôles ci-dessous.
        where = ("racine du clone principal introuvable (dépôt nu, `--separate-git-dir`, sous-module) : ce script "
                 "ne peut pas désigner où écrire la série")
    elif not os.path.lexists(main) and head_state(root, rel) is None:
        # Absent du clone principal : il y sera créé, si aucun worktree ne le porte (`check_creation`).
        return root
    elif main.is_symlink() or not main.is_file():
        where = (f"le clone principal a ce chemin ({main}) sans y avoir un fichier ordinaire (lien, dossier, ou "
                 f"suivi dans son HEAD mais retiré de son arbre) : le rétablir d'abord")
    else:
        missing = sorted(series_numbers(top, real, rel) - series_numbers(root, root / rel, rel))
        if missing:
            where = (f"ce worktree porte des séries que le clone principal n'a pas ({', '.join(map(str, missing))}) : "
                     f"les amener d'abord dans le clone principal (chacune par ce script, avec le chemin "
                     f"{root / rel} ; un commit de ce fichier hors de la branche principale est refusé au pre-commit), "
                     f"puis y écrire la série")
        else:
            branch = git(root, "symbolic-ref", "--short", "-q", "HEAD", check=False).stdout.decode("utf-8", "replace")
            where = (f"les séries s'écrivent dans le clone principal, sur sa branche "
                     f"{branch.strip() or '(HEAD détaché)'} : relancer avec {root / rel}")
    raise DecisionError(f"{top} est un worktree lié, dont le fichier et le HEAD sont les siens : ne pas y écrire la "
                        f"série à la main ; {where}{WRITTEN}")


def main_clone(common):
    """La racine du clone principal : le dossier parent du dossier git commun, comme `main_clone` de
    `check.py`, gardé seulement s'il est la racine d'un arbre de travail dont le dossier git est ce
    dossier commun ; None sinon (dépôt nu, `--separate-git-dir`, sous-module)."""
    root = common.parent
    # Lancé hors d'un arbre de travail (dans un dépôt nu), `--show-toplevel` échoue.
    found = git(root, "rev-parse", "--show-toplevel", "--absolute-git-dir", check=False)
    lines = found.stdout.decode("utf-8", "replace").split("\n")
    if found.returncode != 0 or len(lines) < 2 or Path(lines[0]).resolve() != root \
            or Path(lines[1]).resolve() != common:
        return None
    return root


def series_numbers(top, path, rel):
    """Les numéros de série du fichier de décisions de l'arbre de `top` (aucun s'il n'y est pas) et de son
    HEAD ; DecisionError si le fichier ne se lit pas (droits, retiré entre-temps)."""
    try:
        text = path.read_bytes().decode("utf-8", "replace") if os.path.lexists(path) else ""
    except OSError as err:
        raise DecisionError(f"{path} illisible ({err}){WRITTEN}")
    head = git(top, "show", f"HEAD:{rel}", check=False)
    return numbers(text) | numbers(head.stdout.decode("utf-8", "replace") if head.returncode == 0 else "")


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


def head_commit(top):
    """Le commit HEAD ; None si le dépôt n'en a pas encore."""
    return git(top, "rev-parse", "--verify", "--quiet", "HEAD^{commit}", check=False).stdout.decode("utf-8").strip() \
        or None


def head_state(top, rel):
    """Le commit HEAD, le blob du fichier dans ce commit et son texte ; None si HEAD n'existe pas ou ne
    suit pas le fichier."""
    head = head_commit(top)
    if not head:
        return None
    found = git(top, "rev-parse", "--verify", "--quiet", f"{head}:{rel}", check=False)
    if found.returncode != 0:
        return None
    blob = found.stdout.decode("utf-8").strip()
    return head, blob, git(top, "cat-file", "blob", blob).stdout.decode("utf-8")


def check_git_version():
    """Refuse un git sans `git hook run` (2.36), ou dont la version ne se lit pas : avant tout autre appel,
    car `rev-parse --path-format=absolute` (git 2.31) du refus du worktree lié et du verrou ne se lirait
    pas sur un git plus ancien."""
    version = re.search(r"(\d+)\.(\d+)", out(None, "version"))
    if not version or tuple(map(int, version.groups())) < HOOK_RUN_SINCE:
        raise DecisionError(f"ce git est plus ancien que 2.36 et n'a pas `git hook run`, qui fait tourner le "
                            f"pre-commit{WRITTEN}")


def check_repo(top, rel, real):
    """Refuse un index non vide, une opération en cours, un fichier présent mais non suivi dans HEAD, suivi
    mais retiré de l'arbre, ou un lien symbolique ; rend le mode de l'entrée du fichier, puis `head_state`,
    puis False. Pour un fichier absent de l'arbre et de HEAD, lu ici sous le verrou, rend ceux d'une
    création (`check_creation`) : le mode d'un fichier ordinaire, HEAD, aucun blob, le texte du titre du
    fichier, puis True."""
    staged = staged_names(top)
    if staged:
        raise DecisionError("l'index porte déjà des changements, qu'un commit d'autrui prendrait avec la série : "
                            f"{', '.join(staged)}{WRITTEN}")
    for name in IN_PROGRESS:
        if Path(out(top, "rev-parse", "--path-format=absolute", "--git-path", name)).exists():
            raise DecisionError(f"une opération git est en cours ({name}){WRITTEN}")
    state = head_state(top, rel)
    entry = out(top, "ls-files", "-s", "--", rel).split()
    present = os.path.lexists(real)
    if present and real.is_symlink():
        raise DecisionError(f"{real} est un lien symbolique : donner le fichier lui-même{WRITTEN}")
    if state is not None and entry and real.is_file():
        return (entry[0], *state, False)
    if state is None and not entry and not present:
        head = head_commit(top)
        if head is None:
            raise DecisionError(f"le dépôt n'a pas encore de commit : {rel} ne s'y crée pas{WRITTEN}")
        return (CREATED_MODE, head, None, check_creation(top, rel, real), True)
    if state is not None and not present:
        raise DecisionError(f"{rel} est suivi dans HEAD mais retiré de l'arbre : le rétablir d'abord (le script ne "
                            f"le recrée pas par-dessus ses séries){WRITTEN}")
    raise DecisionError(f"{rel} n'est pas suivi dans HEAD : le commiter d'abord{WRITTEN}")


def check_creation(root, rel, real):
    """Avant de créer `rel` dans le clone principal `root` : refuse (DecisionError) un sujet hors de `SUBJECT`,
    un chemin qui passe par un lien symbolique, un chantier du même nom à la casse près dans l'arbre ou le
    HEAD du clone principal (sur un disque qui ignore la casse, le fichier irait dans l'autre dossier), et
    un fichier de décisions de ce chantier, à la casse près, déjà porté ailleurs dans le dépôt : l'arbre ou
    l'index d'un worktree, le HEAD d'un worktree, une branche locale, même sans worktree, ou une branche
    distante relevée (`refs/remotes`, poussée d'un autre poste et pas encore fusionnée) ; un fichier de
    décisions n'existe qu'à un seul endroit. Une lecture qui échoue refuse aussi : dans le doute, rien n'est
    créé. Rend le texte du titre du fichier à créer."""
    subject = rel.split("/")[1]
    if not SUBJECT.fullmatch(subject):
        raise DecisionError(f"le sujet « {subject!r} » n'est pas créé : lettres et chiffres ASCII, « . », « _ » et "
                            f"« - » seulement, sans point final, 100 signes au plus{WRITTEN}")
    if Path(os.path.realpath(real)) != real:
        raise DecisionError(f"{real} passe par un lien symbolique : il n'est pas créé{WRITTEN}")
    try:
        names = set(os.listdir(root / "travail")) if (root / "travail").is_dir() else set()
    except OSError as err:
        raise DecisionError(f"{root / 'travail'} ne se lit pas ({err}) : {rel} n'est pas créé{WRITTEN}")
    head = head_commit(root)
    if head:
        listed = git(root, "ls-tree", "--name-only", "-z", head, "--", "travail/").stdout.decode("utf-8", "replace")
        names |= {name.split("/", 1)[1] for name in listed.split("\0") if name.startswith("travail/")}
    twins = sorted(n for n in names if n != subject and n.casefold() == subject.casefold())
    if twins:
        raise DecisionError(f"un chantier du même nom à la casse près existe déjà (travail/{twins[0]}) : {rel} n'est "
                            f"pas créé, utiliser ce chantier{WRITTEN}")
    held, objects = [], []
    for path, wt_head, branch in worktrees(root):
        if path == root:
            continue
        where = []
        if os.path.lexists(path / rel):
            where.append("son arbre")
        if path.is_dir():
            # Le chemin vient de `git worktree list` : sans son fichier `.git`, git y remonterait vers un autre
            # dépôt (dans le doute, l'index est dit illisible, ce qui refuse) ; jamais de programme `core.fsmonitor`.
            index = git(path, "-c", "core.fsmonitor=false", "ls-files", "--cached", "--", rel, check=False) \
                if (path / ".git").is_file() else None
            if index is None or index.returncode != 0:
                where.append("son index, illisible")
            elif index.stdout.strip():
                where.append("son index")
        if where:
            held.append(f"le worktree {path} ({', '.join(where)})")
        if wt_head and not branch:
            # Un HEAD détaché ; celui d'un worktree sur une branche se lit avec les branches.
            objects.append((wt_head, f"le HEAD détaché du worktree {path}"))
    refs = git(root, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes").stdout
    for ref in refs.decode("utf-8", "replace").split():
        if not ref.endswith("/HEAD"):
            objects.append((ref, f"la branche {ref.removeprefix('refs/heads/').removeprefix('refs/')}"))
    folded = rel.casefold()
    for obj, where in objects:
        listed = git(root, "ls-tree", "-r", "--name-only", "-z", obj, "--", "travail/", check=False)
        if listed.returncode != 0:
            raise DecisionError(f"{where} ne se lit pas : {rel} n'est pas créé{WRITTEN}")
        found = [p for p in listed.stdout.decode("utf-8", "replace").split("\0") if p.casefold() == folded]
        if found:
            held.append(f"{where} ({found[0]})")
    if held:
        raise DecisionError(f"le clone principal n'a pas {rel}, mais il existe déjà ailleurs dans le dépôt : "
                            f"{' ; '.join(held)} ; un fichier de décisions n'existe qu'à un seul endroit : l'amener "
                            f"d'abord dans le clone principal (le commiter s'il ne l'est pas, puis fusionner la branche "
                            f"qui le porte), puis y écrire la série{WRITTEN}")
    return CREATED_TITLE.format(subject) + "\n"


def worktrees(root):
    """Les worktrees du dépôt (`git worktree list --porcelain -z`), sauf un dépôt nu : chemin résolu, commit
    HEAD (None s'il n'en a pas) et branche (None pour un HEAD détaché)."""
    listed = git(root, "worktree", "list", "--porcelain", "-z").stdout.decode("utf-8", "replace")
    found = []
    for record in listed.split("\0\0"):
        fields = dict(f.split(" ", 1) if " " in f else (f, "") for f in record.split("\0") if f)
        if "worktree" in fields and "bare" not in fields:
            found.append((Path(fields["worktree"]).resolve(), fields.get("HEAD") or None, fields.get("branch") or None))
    return found


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
        git(top, "update-index", "--add", "--cacheinfo", f"{mode},{blob},{rel}", index=index)
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
    """Sous `index.lock` : vérifie que l'index partagé porte encore `head_blob` pour `rel` (aucune entrée
    quand `head_blob` est None, pour une création), écrit l'index où `rel` vaut `blob`, remplace HEAD par
    `new` s'il vaut encore `head`, puis installe l'index. Rend False si HEAD a bougé (rien n'est changé) ;
    DecisionError (code 3) si l'index a été touché."""
    staged_copy, staged_copy_lock = private_path(top, "decision-index-partage")
    index, lock, fd = take_index_lock(top, phase)
    installed = False
    try:
        # HEAD d'abord : un commit d'autrui par l'index partagé y met aussi son blob, que la relance reprend.
        if out(top, "rev-parse", "--verify", "HEAD^{commit}") != head:
            return False
        entry = out(top, "ls-files", "-s", "--", rel).split()
        if entry[1:2] != ([head_blob] if head_blob else []):
            raise DecisionError(f"l'entrée de {rel} dans l'index partagé a changé pendant le hook (une autre discussion "
                                f"l'a indexée) : rien n'est commité, son index est laissé tel quel ; {phase['text']}",
                                code=3)
        shutil.copyfile(index, staged_copy)
        git(top, "update-index", "--add", "--cacheinfo", f"{mode},{blob},{rel}", index=staged_copy)
        moved = git(top, "update-ref", "-m", f"commit: {subject}", "HEAD", new, head, check=False)
        if moved.returncode != 0:
            if out(top, "rev-parse", "--verify", "HEAD^{commit}") != head:
                return False
            raise DecisionError(f"git update-ref a échoué : {moved.stderr.decode('utf-8', 'replace').strip()} ; "
                                f"{phase['text']}", code=3)
        phase["commit"] = new
        phase["text"] = f"la série est commitée ({new[:12]}), mais l'index partagé n'a pas été mis à jour : il indexe " \
                        f"le retrait de la série ; pour le réparer : git update-index --add --cacheinfo {mode},{blob},{rel}"
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
    (numéro, hash court, hash complet). Pour une création (`head_blob` None), `head_text` est le titre du
    fichier, et un nouveau HEAD qui suit maintenant le fichier arrête (code 3)."""
    creating = head_blob is None
    for _ in range(COMMIT_TRIES):
        if creating:
            # Le HEAD sur lequel le commit se construit (lu par `check_repo` en deux appels, puis relu à chaque
            # reprise) ne doit toujours pas suivre le fichier.
            refuse_taken(top, rel, head, appended(head_text, block))
        # Le blob de HEAD suivi de la même série : l'ajout non commité d'une autre discussion n'y est pas.
        blob = git(top, "hash-object", "-w", "--no-filters", "--stdin",
                   data=appended(head_text, block).encode("utf-8")).stdout.decode("utf-8").strip()
        tree = commit_tree(top, rel, mode, head, blob, phase)
        new = out(top, "commit-tree", tree, "-p", head, *message_args)
        if swap_head_and_index(top, rel, mode, head, head_blob, blob, new, subject, phase):
            phase["text"] = f"la série {n} est commitée ({new[:12]}), mais sa vérification a échoué : à vérifier"
            return n, out(top, "rev-parse", "--short", new), new
        # HEAD a bougé (un commit d'une autre discussion) : recommencer sur le nouveau, s'il n'a pas pris le numéro.
        if creating:
            head = head_commit(top)
            continue
        state = head_state(top, rel)
        if state is None:
            raise DecisionError(f"{rel} n'est plus suivi dans le nouveau HEAD ; {phase['text']}", code=3)
        head, head_blob, head_text = state
        if n in numbers(head_text):
            raise DecisionError(f"HEAD a avancé pendant le commit ({head[:12]}) et porte déjà une série {n} (la vôtre, "
                                f"prise par le commit d'une autre discussion, ou la sienne) ; à vérifier dans {rel} ; "
                                f"{phase['text']}", code=3)
    raise DecisionError(f"HEAD a bougé à chaque essai ({COMMIT_TRIES}) ; {phase['text']}", code=3)


def refuse_taken(top, rel, head, written):
    """Pour une création : DecisionError (code 3) si le commit `head` suit déjà `rel` (un commit d'une autre
    discussion, fait par son propre index ou en prenant le fichier non suivi), en disant si c'est la série 1
    de ce lancement qu'il a prise (elle est alors commitée : ne pas relancer, `commit` porte ce HEAD) ou un
    autre fichier."""
    if head is None:
        raise DecisionError("HEAD n'a plus de commit (une branche neuve prise entre-temps) : à vérifier", code=3)
    found = git(top, "cat-file", "blob", f"{head}:{rel}", check=False)
    if found.returncode != 0:
        if git(top, "cat-file", "-e", head, check=False).returncode != 0:
            raise DecisionError(f"HEAD ({head[:12]}) ne se lit pas : à vérifier", code=3)
        return
    if found.stdout.decode("utf-8", "replace") == written:
        taken = DecisionError(f"HEAD ({head[:12]}) porte déjà {rel} avec la série 1 de ce lancement, prise par le commit "
                              f"d'une autre discussion : elle est commitée, ne pas relancer", code=3, commit=head)
        taken.number = 1
        raise taken
    raise DecisionError(f"HEAD ({head[:12]}) suit maintenant {rel}, créé ailleurs entre-temps : à vérifier avant toute "
                        f"relance", code=3)


def add_series(decisions, series, message_args, subject, wait=DEFAULT_WAIT):
    """Le geste entier ; rend (numéro, hash court, hash complet, chemin du fichier créé ou None)."""
    check_git_version()
    real, top, rel = target(decisions)
    title, body = read_series(series)
    if not os.path.lexists(real) and head_state(top, rel) is None:
        # Un refus sûr dès maintenant, sans fichier de verrou ; tout se relit sous le verrou (`check_repo`).
        check_creation(top, rel, real)
    handle = take_lock(top, wait)
    try:
        mode, head, head_blob, head_text, creating = check_repo(top, rel, real)
        if creating:
            return (*create_with_series(top, rel, real, mode, head, head_text, title, body, message_args, subject),
                    real)
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
            return (*commit_series(top, rel, mode, head, head_blob, head_text, block, n, message_args, subject, phase),
                    None)
        except BaseException as err:
            # Toute erreur, une erreur du système (disque plein, droits) ou de décodage comme une erreur de git
            # ou une interruption (Ctrl-C, SIGTERM et SIGHUP que `main` change en SystemExit), se redit en
            # code 3 : la série est écrite, et le message dit ce qui reste (l'astuce de réparation de l'index
            # quand HEAD a déjà pris la série).
            if not isinstance(err, DecisionError) or err.code != 3:
                if isinstance(err, DecisionError):
                    reason = str(err).removesuffix(WRITTEN)
                elif isinstance(err, (KeyboardInterrupt, SystemExit)):
                    reason = f"interrompu ({type(err).__name__})"
                else:
                    reason = f"{type(err).__name__} : {err}"
                err = DecisionError(f"{reason} ; {phase['text']}", code=3)
            err.commit, err.number = phase["commit"], n
            raise err
    finally:
        release(handle)


def create_with_series(top, rel, real, mode, head, head_text, title, body, message_args, subject):
    """Sous le verrou : crée `real` (son dossier de chantier au besoin), titré de `head_text` et suivi de la
    série 1, puis le commite comme une série (`commit_series`) ; rend (1, hash court, hash complet). Une
    création ratée avant le commit est défaite (`undo_creation`, code 4) quand le fichier porte encore ses
    seuls octets ; sinon code 3, le fichier laissé."""
    block = [f"## Série 1 — {title} ({time.strftime('%d/%m/%Y')})", "", *body]
    written = appended(head_text, block)
    made = []
    try:
        make_dirs(top, real.parent, made)
        linked = link_new(real, written)
    except OSError as err:
        raise DecisionError(f"écriture impossible ({type(err).__name__} : {err}) ; {undone_text(rel, made)}",
                            code=UNDONE)
    if not linked:
        kept = remove_dirs(made)
        raise DecisionError(f"{rel} est apparu pendant la création (écrit hors de ce script) : laissé tel quel"
                            f"{' ; dossier gardé : ' + ', '.join(map(str, kept)) if kept else ''}{WRITTEN}")
    # Avant le commit, une erreur défait la création ; après, elle se redit seulement (`phase["commit"]`).
    phase = {"text": f"création de {rel} ratée avant son commit", "commit": None}
    try:
        return commit_series(top, rel, mode, head, None, head_text, block, 1, message_args, subject, phase)
    except BaseException as err:
        # Toute erreur, interruption comprise (Ctrl-C, SIGTERM et SIGHUP que `main` change en SystemExit), finit
        # ici par une DecisionError qui dit ce qui reste : jamais une trace au code 1, « rien n'est écrit ».
        if isinstance(err, DecisionError):
            reason = str(err).removesuffix(WRITTEN)
        elif isinstance(err, (KeyboardInterrupt, SystemExit)):
            reason = f"interrompu ({type(err).__name__})"
        else:
            reason = f"{type(err).__name__} : {err}"
        if isinstance(err, DecisionError) and err.commit:
            # Un commit d'une autre discussion a pris la série 1 de ce lancement : rien à défaire.
            raise err
        if phase["commit"] is not None:
            # Commité : jamais défait (le reste à vérifier est dans le message).
            if not isinstance(err, DecisionError) or err.code != 3:
                err = DecisionError(f"{reason} ; {phase['text']}", code=3)
            err.commit, err.number = phase["commit"], 1
            raise err
        undone, note = undo_creation(top, rel, real, written)
        if not undone:
            failed = DecisionError(f"{reason} ; {note}", code=3)
            failed.number = 1
            raise failed
        raise DecisionError(f"{reason} ; {undone_text(rel, made)}", code=UNDONE)


def undone_text(rel, made):
    """Ce que dit une création défaite, après le retrait des dossiers créés par ce lancement."""
    kept = remove_dirs(made)
    return f"création défaite : {rel} n'est pas laissé" + (
        f", mais un dossier créé est gardé, il porte autre chose : {', '.join(map(str, kept))}" if kept else "")


def make_dirs(top, folder, made):
    """Crée les dossiers manquants de `folder`, sous `top`, et ajoute à `made` chacun de ceux que ce lancement
    a créés, du plus haut au plus bas, dès sa création (une erreur en route les y laisse ; un dossier créé
    entre-temps par un autre n'en est pas)."""
    missing = []
    while not folder.is_dir() and folder != top and top in folder.parents:
        missing.append(folder)
        folder = folder.parent
    for folder in reversed(missing):
        try:
            folder.mkdir()
        except FileExistsError:
            continue
        made.append(folder)


def remove_dirs(made):
    """Retire les dossiers créés par ce lancement, du plus bas au plus haut, seulement s'ils sont vides
    (`rmdir`) ; rend ceux qui restent, constatés après."""
    for folder in reversed(made):
        try:
            folder.rmdir()
        except OSError:
            pass
    return [folder for folder in made if os.path.lexists(folder)]


def link_new(path, text):
    """Crée `path` avec `text` par un fichier voisin lié à son nom (`os.link`), qui n'écrase jamais un
    fichier ou un lien posé entre-temps : rend False dans ce cas, sans rien changer."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".decision-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(text.encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
        # `mkstemp` crée en 0600 : le fichier prend le mode d'un fichier neuf (0666 moins le umask).
        mask = os.umask(0)
        os.umask(mask)
        os.chmod(tmp, 0o666 & ~mask)
        try:
            os.link(tmp, path)
        except FileExistsError:
            return False
        return True
    finally:
        # Le fichier voisin seul : une erreur ici ne doit pas faire croire que le fichier n'est pas posé.
        try:
            os.unlink(tmp)
        except OSError:
            pass


def undo_creation(top, rel, real, written):
    """Retire le fichier créé par ce lancement, seulement s'il porte encore ses seuls octets (`written`) et
    que ni HEAD ni l'index partagé ne le suivent : mis de côté sous un nom privé, comparé, puis supprimé, ou
    remis à son nom s'il a changé ; rend (retiré, constaté après ; ce qui est laissé, sinon)."""
    try:
        if head_state(top, rel) is not None or out(top, "ls-files", "--", rel):
            return False, f"{rel} est laissé tel quel : HEAD ou l'index le suivent maintenant, à vérifier avant toute relance"
    except DecisionError as err:
        return False, f"{rel} est laissé tel quel : son suivi ne se lit pas ({err}), à vérifier avant toute relance"
    # Un nom neuf, pris par `mkstemp` : le renommage ne remplace que ce fichier vide de ce lancement.
    try:
        fd, aside = tempfile.mkstemp(dir=real.parent, prefix=".decision-retrait-", suffix=".tmp")
        os.close(fd)
        aside = Path(aside)
    except OSError as err:
        return False, f"{rel} est laissé, sa série 1 écrite et non commitée : il ne se met pas de côté ({err})"
    try:
        os.replace(real, aside)
    except OSError as err:
        aside.unlink(missing_ok=True)
        return False, f"{rel} est laissé, sa série 1 écrite et non commitée : il ne se met pas de côté ({err})"
    try:
        same = aside.read_bytes() == written.encode("utf-8")
    except OSError:
        same = False
    if same:
        os.unlink(aside)
        if os.path.lexists(real):
            return False, (f"la série 1 de ce lancement est retirée, mais un autre fichier a pris sa place à {rel} : "
                           f"laissé tel quel, à vérifier")
        return True, ""
    try:
        os.link(aside, real)
        os.unlink(aside)
        return False, (f"{rel} est laissé : il porte autre chose que la série de ce lancement (sa série 1 y reste "
                       f"écrite, non commitée)")
    except OSError as err:
        return False, f"{rel} a changé pendant la création et reste sous {aside} ({err})"


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
    # SIGTERM et SIGHUP (l'arrêt de la commande ou de la session) deviennent SystemExit : une création en
    # cours se défait alors comme sur Ctrl-C, au lieu de laisser un fichier non suivi.
    def stop(signum, _frame):
        raise SystemExit(128 + signum)
    for name in ("SIGTERM", "SIGHUP"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), stop)
    try:
        n, short, _, created = add_series(decisions, series, message_args, subject, wait_from_env())
    except DecisionError as err:
        if err.commit:
            print(f"Série {err.number} : commit {err.commit[:12]} (reste à vérifier : voir le message d'échec)")
        print(f"ÉCHEC : {err}", file=sys.stderr)
        return err.code
    print(f"Série {n} : commit {short}" + (f" (fichier créé : {created})" if created else ""))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
