#!/usr/bin/env python3
"""Pose la version d'un plugin du dépôt partout où elle s'écrit.

    python3 scripts/bump-version.py <plugin> <x.y.z>              (python sous Windows)
    python3 scripts/bump-version.py --root <copie> <plugin> <x.y.z>

Met à jour, en gardant la mise en forme de chaque fichier :
1. `plugins/<plugin>/.claude-plugin/plugin.json` (`"version"`) ;
2. l'entrée du plugin dans `.claude-plugin/marketplace.json` (`"version"`) ;
3. la ligne « Version actuelle : **x.y.z** » du README du plugin ;
4. les marqueurs « 0.xx.0 » de ce README (« depuis la 0.xx.0 », écrit quand la version n'était pas
   encore connue), remplacés par la nouvelle version, seulement sur les lignes que le README de
   `HEAD` porte déjà : un marqueur d'une ligne pas encore commitée (le travail en cours d'une autre
   discussion, qui attend sa propre version) reste, et le rapport donne sa ligne. Sans README
   commité (plugin neuf, copie hors git), aucun marqueur n'est remplacé ;
5. les lignes de `plugins/<plugin>/termes-retires.txt` qui portent l'ancienne version (celle de
   `plugin.json` avant la pose) et manquent au fichier du dernier commit qui a changé la version de
   `plugin.json` : elles passent à la nouvelle version, et le rapport les liste, en marquant celles que
   `HEAD` ne porte pas encore (peut-être d'une autre discussion, qui attend sa version). Le CHANGELOG de la
   nouvelle version peut alors citer les termes qu'elle retire. Le reste du fichier ne change pas d'un
   octet ; sans fichier de termes, sans git ou sans commit de version, rien ne bouge et le rapport le dit.

Ne touche ni au CHANGELOG (son entrée reste à écrire : `scripts/check.sh` refuse une première entrée
qui diffère de `plugin.json`) ni à la liste « État » d'ETAT_DU_PROJET.md (contrôlée aussi). Un
numéro posé à la main en sept endroits, puis renuméroté après une collision, avait tout refait au `sed`.

Sans dépendance hors de la bibliothèque standard ; Python 3.9 ou plus récent.
"""

import argparse
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

from placeholders import PLACEHOLDER, git_show, replaced_lines

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

VERSION = re.compile(r"\d+\.\d+\.\d+(?:-mathis\.\d+)?")
CURRENT_LINE = re.compile(r"(Version actuelle : \*\*)([^*]+)(\*\*)")
VERSION_FIELD = re.compile(r'("version"\s*:\s*")([^"]*)(")')
# La liste des termes retirés d'un plugin, à sa racine (lue par scripts/check.py).
RETIRED_FILE = "termes-retires.txt"


class Failed(Exception):
    pass


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def bump_manifest(path, version):
    """Le premier champ `"version"` du `plugin.json` ; rend l'ancienne version."""
    text = path.read_text(encoding="utf-8")
    m = VERSION_FIELD.search(text)
    if not m:
        raise Failed(f"{path} : pas de champ \"version\"")
    write(path, text[:m.start(2)] + version + text[m.end(2):])
    return m.group(2)


def bump_marketplace(path, name, version):
    """Le champ `"version"` de l'entrée du plugin dans la marketplace : celui qui suit son `"name"`,
    avant l'entrée suivante."""
    text = path.read_text(encoding="utf-8")
    entry = re.search(r'"name"\s*:\s*"' + re.escape(name) + r'"', text)
    if not entry:
        raise Failed(f"{path} : pas d'entrée « {name} »")
    end = text.find('"name"', entry.end())
    end = len(text) if end < 0 else end
    m = VERSION_FIELD.search(text, entry.end(), end)
    if not m:
        raise Failed(f"{path} : l'entrée « {name} » n'a pas de champ \"version\"")
    write(path, text[:m.start(2)] + version + text[m.end(2):])
    return m.group(2)


def bump_readme(path, version, committed=""):
    """La ligne « Version actuelle » et les marqueurs « 0.xx.0 » des lignes commitées (`committed`, le
    README de `HEAD` ; règle de `placeholders.replaced_lines`) ; rend (ligne trouvée, marqueurs
    remplacés, numéros des lignes laissées). Une ligne marquée absente de `HEAD` vient d'un texte pas
    encore commité, peut-être d'une autre discussion, qui attend sa propre version : en posant la
    0.70.0, un tel marqueur avait été remplacé et la phrase annonçait la mauvaise version."""
    if not path.is_file():
        return False, 0, []
    text = path.read_text(encoding="utf-8")
    text, lines = CURRENT_LINE.subn(lambda m: m.group(1) + version + m.group(3), text, count=1)
    replaced = replaced_lines(committed, text.splitlines())
    out, markers, left = [], 0, []
    for n, line in enumerate(text.splitlines(keepends=True), 1):
        if n in replaced:
            markers += line.count(PLACEHOLDER)
            line = line.replace(PLACEHOLDER, version)
        elif PLACEHOLDER in line:
            left.append(n)
        out.append(line)
    write(path, "".join(out))
    return lines == 1, markers, left


def git_lines(root, *args):
    """Les lignes de la sortie d'une commande git lancée dans `root` ; None en échec ou sans dépôt git."""
    try:
        res = subprocess.run(["git", *args], cwd=str(root), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             text=True, encoding="utf-8", errors="replace", timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return res.stdout.splitlines() if res.returncode == 0 else None


def manifest_version(text):
    m = VERSION_FIELD.search(text or "")
    return m.group(2) if m else None


def last_version_commit(root, manifest_rel):
    """Le dernier commit qui a changé la version du `plugin.json` (`manifest_rel`, relatif à `root`) :
    sa version diffère de celle de son parent (un commit sans parent, ou sans ce fichier chez son parent,
    compte). Pas `git log -G` : un `plugin.json` sur une seule ligne ferait passer tout commit du
    fichier pour un commit de version. (None, raison) sans git ou sans un tel commit."""
    commits = git_lines(root, "log", "--format=%H", "--", manifest_rel)
    if commits is None:
        return None, "pas de dépôt git"
    for sha in commits:
        version = manifest_version(git_show(root, f"{sha}:{manifest_rel}"))
        # Un commit qui retire le fichier ne pose aucune version.
        if version is not None and version != manifest_version(git_show(root, f"{sha}^:{manifest_rel}")):
            return sha, None
    return None, "aucun commit n'a posé sa version"


def bump_retired(path, root, manifest_rel, terms_rel, old, version):
    """Les lignes de `termes-retires.txt` qui portent l'ancienne version `old` et manquent au fichier
    du dernier commit de version (comptées une à une, comme les marqueurs du README) passent à
    `version` ; le reste du fichier ne change pas d'un octet. Rend (lignes déplacées, chacune avec
    « absente de HEAD » vrai ou faux, raison de n'avoir rien regardé ou None). Une ligne absente de
    `HEAD` passe aussi (décision C10), mais elle peut venir d'une autre discussion, qui attend sa propre
    version : le rapport la marque pour qu'on la relise. Ne lève pas : `plugin.json` est déjà écrit quand
    cette étape tourne. Le CHANGELOG de la nouvelle version peut ainsi citer les termes qu'elle retire
    (scripts/check.py refuse un terme dans une entrée plus récente que la version de sa ligne)."""
    if not path.is_file():
        return [], "pas de fichier de termes retirés"
    sha, why = last_version_commit(root, manifest_rel)
    if sha is None:
        return [], why
    known = Counter((git_show(root, f"{sha}:{terms_rel}") or "").replace("\r\n", "\n").split("\n"))
    in_head = Counter((git_show(root, f"HEAD:{terms_rel}") or "").replace("\r\n", "\n").split("\n"))
    text = path.read_bytes().decode("utf-8")
    out, moved = [], []
    for line in text.splitlines(keepends=True):
        bare = line.rstrip("\r\n")
        head, sep, tail = bare.partition("\t")
        if sep and head.strip() == old:
            if known[bare] > 0:
                known[bare] -= 1
            else:
                uncommitted = in_head[bare] <= 0
                if not uncommitted:
                    in_head[bare] -= 1
                line = head.replace(old, version, 1) + sep + tail + line[len(bare):]
                moved.append((line.rstrip("\r\n"), uncommitted))
        out.append(line)
    if moved:
        path.write_bytes("".join(out).encode("utf-8"))
    return moved, None


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plugin", help="nom du dossier du plugin, sous plugins/")
    parser.add_argument("version", help="la nouvelle version, x.y.z (ou x.y.z-mathis.n)")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent, help="racine du dépôt (une copie, pour un essai)")
    args = parser.parse_args()
    try:
        if not VERSION.fullmatch(args.version):
            raise Failed(f"version « {args.version} » : x.y.z attendu")
        plugin = args.root / "plugins" / args.plugin
        manifest = plugin / ".claude-plugin" / "plugin.json"
        if not manifest.is_file():
            raise Failed(f"plugin inconnu : {args.plugin} (pas de {manifest})")
        old = bump_manifest(manifest, args.version)
        listed = bump_marketplace(args.root / ".claude-plugin" / "marketplace.json", args.plugin, args.version)
        readme = plugin / "README.md"
        has_line, markers, left = bump_readme(readme, args.version, git_show(args.root, f"HEAD:plugins/{args.plugin}/README.md"))
    except (Failed, OSError) as err:
        print(f"ÉCHEC : {err}")
        sys.exit(1)
    terms = plugin / RETIRED_FILE
    try:
        moved, unseen = bump_retired(terms, args.root, f"plugins/{args.plugin}/.claude-plugin/plugin.json",
                                     f"plugins/{args.plugin}/{RETIRED_FILE}", old, args.version)
    except (OSError, UnicodeDecodeError) as err:
        moved, unseen = [], f"lecture ou écriture impossible ({err})"
    print(f"{args.plugin} : {old} → {args.version}")
    print(f"  plugin.json : {old} → {args.version}")
    print(f"  marketplace.json : {listed} → {args.version}")
    print(f"  README, ligne « Version actuelle » : {'à jour' if has_line else 'absente'}")
    print(f"  README, marqueurs « {PLACEHOLDER} » remplacés : {markers}")
    if left:
        print(f"  README, marqueurs « {PLACEHOLDER} » laissés dans du texte non commité : "
              f"{', '.join(f'ligne {n}' for n in left)} ({readme})")
    if unseen:
        print(f"  {RETIRED_FILE} : aucune ligne déplacée ({unseen})")
    else:
        print(f"  {RETIRED_FILE}, lignes passées de {old} à {args.version} : {len(moved)}")
        for line, uncommitted in moved:
            print(f"    {line}" + (" (pas encore commitée : vérifier que cette version retire bien ce terme)"
                                   if uncommitted else ""))
    print(f"Reste à écrire : l'entrée {args.version} du CHANGELOG du plugin, et sa version dans la liste « État » "
          "d'ETAT_DU_PROJET.md s'il en a une ; scripts/check.sh les contrôle.")


if __name__ == "__main__":
    main()
