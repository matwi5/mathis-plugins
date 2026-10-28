#!/usr/bin/env python3
"""Lance une session Claude Code avec la sonde des événements du moteur, dans tmux.

    python3 scripts/sonde.py                 Claude Code du terminal
    python3 scripts/sonde.py --desktop       le Claude Code embarqué par l'app desktop (le plus récent)
    python3 scripts/sonde.py --dir <dossier> dans ce dossier plutôt que dans un dossier jetable neuf
    python3 scripts/sonde.py --titre "<t>"   la sonde renvoie ce titre dans `sessionTitle` (une fois)
    python3 scripts/sonde.py --dir <dossier> --reprise   reprend la dernière session du dossier (--continue)
    python3 scripts/sonde.py --env CLE=VALEUR   passe cette variable à la session (répétable)
    python3 scripts/sonde.py --envoyer "<texte>" [--attendre <s>] [--voir]   tape ce texte puis Entrée dans la sonde lancée
    python3 scripts/sonde.py --touches Down Enter [--voir]   envoie ces touches tmux (choix d'un dialogue)
    python3 scripts/sonde.py --voir [--attendre <s>] [--lignes <n>]          la fin du volet de la sonde lancée

La session tourne dans une session tmux détachée (nom : --name, « sonde » par défaut), en Haiku et
en effort low (--model, --effort), avec la sonde chargée par --plugin-dir. Pour jouer les
scénarios : `tmux attach -t sonde`, puis les quitter par Ctrl-b d ; ou, sans s'attacher, par
`--touches`, `--envoyer` et `--voir`, qui attendent eux-mêmes le délai demandé (une session Claude Code
ne peut pas lancer `sleep` au premier plan). Chaque session de Claude Code écrit son journal dans
scripts/sonde/journaux/ (ignoré par git). Mode d'emploi et résultats : docs/evenements-moteur.md.

Mac et Linux (tmux requis) ; sans dépendance hors de la bibliothèque standard.
"""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from check import desktop_claude

SONDE = Path(__file__).resolve().parent / "sonde"
# Les variables qu'une session Claude Code passe à ses commandes et qui lient la sonde à elle.
INHERITED = ("CLAUDE_CODE_SESSION_ID", "CLAUDECODE", "CLAUDE_CODE_SESSION_ATTENDED")
# Une affectation `--env CLE=VALEUR`.
ENV_ASSIGN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=.*", re.S)


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
    parser.add_argument("--reprise", action="store_true", help="reprendre la dernière session du dossier (--continue ; avec --dir)")
    parser.add_argument("--titre", help="titre que la sonde renvoie une fois dans sessionTitle (SessionStart ou premier message)")
    parser.add_argument("--env", action="append", default=[], metavar="CLE=VALEUR",
                        help="variable passée à la session (répétable), par exemple CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000")
    parser.add_argument("--envoyer", metavar="TEXTE", help="tape ce texte puis Entrée dans la sonde lancée (sans en lancer une)")
    parser.add_argument("--voir", action="store_true", help="affiche la fin du volet de la sonde lancée (sans en lancer une)")
    parser.add_argument("--touches", nargs="+", default=[], metavar="TOUCHE",
                        help="envoie ces touches tmux à la sonde lancée, avant --envoyer (Down, Enter, Escape, C-c…)")
    parser.add_argument("--attendre", type=float, default=0, metavar="S", help="avec --envoyer ou --voir : secondes d'attente avant de lire")
    parser.add_argument("--lignes", type=int, default=40, metavar="N", help="avec --voir : nombre de lignes affichées")
    args = parser.parse_args()

    tmux = shutil.which("tmux")
    if not tmux:
        sys.exit("tmux introuvable (brew install tmux)")
    if args.envoyer is not None or args.voir or args.touches:
        drive(tmux, args)
        return
    bad = [a for a in args.env if not ENV_ASSIGN.fullmatch(a)]
    if bad:
        sys.exit(f"--env attend CLE=VALEUR : {', '.join(bad)}")
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
               "env", *[a for v in INHERITED for a in ("-u", v)], *args.env,
               str(claude), "--plugin-dir", str(SONDE), "--model", args.model, "--effort", args.effort,
               *(["--continue"] if args.reprise else [])]
    res = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if res.returncode != 0:
        sys.exit(f"tmux : {res.stderr.strip()} (une session « {args.name} » existe déjà ? --name pour en ouvrir une autre)")
    print(f"Session tmux « {args.name} » : Claude Code {label}, dans {folder}")
    if args.env:
        print(f"Variables passées : {', '.join(a.split('=', 1)[0] for a in args.env)}")
    print(f"  tmux attach -t {args.name}        jouer les scénarios (Ctrl-b d pour se détacher)")
    print(f"  python3 scripts/sonde.py --name {args.name} --envoyer \"<texte>\" --attendre 10 --voir   sans s'attacher")
    print(f"  tmux kill-session -t {args.name}  fermer")
    print(f"Journaux : {SONDE / 'journaux'}")
    if args.titre:
        print(f"Titre renvoyé une fois dans sessionTitle : « {args.titre} » (session_title du hook suivant dit s'il a pris)")


if __name__ == "__main__":
    main()
