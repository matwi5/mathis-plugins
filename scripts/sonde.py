#!/usr/bin/env python3
"""Lance une session Claude Code avec la sonde des événements du moteur, dans tmux.

    python3 scripts/sonde.py                 Claude Code du terminal
    python3 scripts/sonde.py --desktop       le Claude Code embarqué par l'app desktop (le plus récent)
    python3 scripts/sonde.py --dir <dossier> dans ce dossier plutôt que dans un dossier jetable neuf
    python3 scripts/sonde.py --titre "<t>"   la sonde renvoie ce titre dans `sessionTitle` (une fois)
    python3 scripts/sonde.py --dir <dossier> --reprise   reprend la dernière session du dossier (--continue)

La session tourne dans une session tmux détachée (nom : --name, « sonde » par défaut), en Haiku et
en effort low (--model, --effort), avec la sonde chargée par --plugin-dir. Pour jouer les
scénarios : `tmux attach -t sonde`, puis les quitter par Ctrl-b d. Chaque session de Claude Code
écrit son journal dans scripts/sonde/journaux/ (ignoré par git). Mode d'emploi et résultats :
docs/evenements-moteur.md.

Mac et Linux (tmux requis) ; sans dépendance hors de la bibliothèque standard.
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from check import desktop_claude

SONDE = Path(__file__).resolve().parent / "sonde"
# Les variables qu'une session Claude Code passe à ses commandes et qui lient la sonde à elle.
INHERITED = ("CLAUDE_CODE_SESSION_ID", "CLAUDECODE", "CLAUDE_CODE_SESSION_ATTENDED")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--desktop", action="store_true", help="le Claude Code de l'app desktop")
    parser.add_argument("--dir", type=Path, help="dossier de la session (défaut : un dossier jetable neuf)")
    parser.add_argument("--name", default="sonde", help="nom de la session tmux")
    parser.add_argument("--model", default="haiku")
    parser.add_argument("--effort", default="low")
    parser.add_argument("--reprise", action="store_true", help="reprendre la dernière session du dossier (--continue ; avec --dir)")
    parser.add_argument("--titre", help="titre que la sonde renvoie une fois dans sessionTitle (SessionStart ou premier message)")
    args = parser.parse_args()

    tmux = shutil.which("tmux")
    if not tmux:
        sys.exit("tmux introuvable (brew install tmux)")
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
    # Lancée depuis une session Claude Code, la sonde hériterait de son id de session (et de son
    # titre, qui passait devant `sessionTitle` : constaté le 28/10/2026) : ces variables sont retirées.
    command = [tmux, "new-session", "-d", "-s", args.name, "-c", str(folder), "--",
               "env", *[a for v in INHERITED for a in ("-u", v)],
               str(claude), "--plugin-dir", str(SONDE), "--model", args.model, "--effort", args.effort,
               *(["--continue"] if args.reprise else [])]
    res = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if res.returncode != 0:
        sys.exit(f"tmux : {res.stderr.strip()} (une session « {args.name} » existe déjà ? --name pour en ouvrir une autre)")
    print(f"Session tmux « {args.name} » : Claude Code {label}, dans {folder}")
    print(f"  tmux attach -t {args.name}        jouer les scénarios (Ctrl-b d pour se détacher)")
    print(f"  tmux kill-session -t {args.name}  fermer")
    print(f"Journaux : {SONDE / 'journaux'}")
    if args.titre:
        print(f"Titre renvoyé une fois dans sessionTitle : « {args.titre} » (session_title du hook suivant dit s'il a pris)")


if __name__ == "__main__":
    main()
